import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db.js';
import { formatBytes, ensureGitIgnoreRaft } from './index.js';

test('formatBytes formats file sizes into human-readable strings', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1048576), '1 MB');
  assert.equal(formatBytes(52428800), '50 MB');
});

test('ensureGitIgnoreRaft writes .raft to .git/info/exclude in regular git directories', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-git-test-'));
  try {
    const gitDir = path.join(tmpDir, '.git');
    fs.mkdirSync(gitDir, { recursive: true });

    ensureGitIgnoreRaft(tmpDir);

    const excludePath = path.join(gitDir, 'info', 'exclude');
    assert.ok(fs.existsSync(excludePath), 'exclude file must exist');
    const content = fs.readFileSync(excludePath, 'utf-8');
    assert.ok(content.includes('.raft'), 'exclude file must contain .raft');
    assert.ok(content.includes('.raft/'), 'exclude file must contain .raft/');

    // Test idempotency
    ensureGitIgnoreRaft(tmpDir);
    const content2 = fs.readFileSync(excludePath, 'utf-8');
    assert.equal(content, content2, 'subsequent calls should not duplicate entries');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});

test('ensureGitIgnoreRaft resolves gitdir references in git worktrees', () => {
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-main-repo-'));
  const tmpWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-worktree-'));
  try {
    const gitAdminDir = path.join(tmpRepo, '.git', 'worktrees', 'task-branch');
    fs.mkdirSync(gitAdminDir, { recursive: true });

    // In a git worktree, .git is a text file containing "gitdir: <path>"
    fs.writeFileSync(path.join(tmpWorktree, '.git'), `gitdir: ${gitAdminDir}\n`, 'utf-8');

    ensureGitIgnoreRaft(tmpWorktree);

    const excludePath = path.join(gitAdminDir, 'info', 'exclude');
    assert.ok(fs.existsSync(excludePath), 'target worktree exclude file must be created');
    const content = fs.readFileSync(excludePath, 'utf-8');
    assert.ok(content.includes('.raft'), 'worktree exclude must contain .raft');
  } finally {
    try {
      fs.rmSync(tmpRepo, { recursive: true, force: true });
      fs.rmSync(tmpWorktree, { recursive: true, force: true });
    } catch {}
  }
});

test('attachments database table inserts and queries by task_id with cascade deletion', () => {
  const projectId = uuidv4();
  const taskId = uuidv4();
  const attachmentId1 = uuidv4();
  const attachmentId2 = uuidv4();
  const now = Date.now();

  try {
    // Create project and task
    db.prepare(`
      INSERT INTO projects (id, name, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(projectId, 'test-project', `/path/${projectId}`, now, now);

    db.prepare(`
      INSERT INTO tasks (id, project_id, name, branch, base_branch, worktree_path, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, projectId, 'test-task', 'branch', 'main', `/path/worktree/${taskId}`, 'active', now, now);

    // Insert attachments
    db.prepare(`
      INSERT INTO attachments (id, task_id, name, size, mime_type, file_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(attachmentId1, taskId, 'screenshot.png', 12345, 'image/png', '.raft/attachments/1.png', now);

    db.prepare(`
      INSERT INTO attachments (id, task_id, name, size, mime_type, file_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(attachmentId2, taskId, 'config.json', 456, 'application/json', '.raft/attachments/2.json', now);

    // Query attachments by task_id
    const rows = db.prepare('SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as any[];
    assert.equal(rows.length, 2);
    assert.equal(rows[0].name, 'screenshot.png');
    assert.equal(rows[1].name, 'config.json');

    // Verify CASCADE delete
    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    const remaining = db.prepare('SELECT * FROM attachments WHERE task_id = ?').all(taskId) as any[];
    assert.equal(remaining.length, 0, 'attachments should be deleted when parent task is deleted');
  } finally {
    try {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    } catch {}
  }
});

test('chat message metadata parses attachments correctly', () => {
  const rawMetadata = JSON.stringify({
    attachments: [
      {
        id: 'att-1',
        name: 'sample.ts',
        size: 1024,
        type: 'text/typescript',
        url: '/api/tasks/task-1/attachments/att-1',
        path: '.raft/attachments/att-1_sample.ts',
      },
    ],
  });

  const parsed = JSON.parse(rawMetadata);
  assert.ok(Array.isArray(parsed.attachments));
  assert.equal(parsed.attachments.length, 1);
  assert.equal(parsed.attachments[0].name, 'sample.ts');
  assert.equal(parsed.attachments[0].path, '.raft/attachments/att-1_sample.ts');
});

test('REST endpoints for attachment upload, content retrieval, and file streaming', async () => {
  const { app } = await import('./index.js');
  const tmpWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-att-worktree-'));
  const projectId = uuidv4();
  const taskId = uuidv4();
  const now = Date.now();

  db.prepare(`
    INSERT INTO projects (id, name, path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(projectId, 'att-proj', tmpWorktree, now, now);

  db.prepare(`
    INSERT INTO tasks (id, project_id, name, branch, base_branch, worktree_path, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(taskId, projectId, 'att-task', 'task-branch', 'main', tmpWorktree, 'active', now, now);

  const testServer = app.listen(0);
  const port = (testServer.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. Upload attachments using multipart/form-data
    const formData = new FormData();
    const testContent = 'console.log("Hello attachments!");';
    const blob = new Blob([testContent], { type: 'text/typescript' });
    formData.append('files', blob, 'hello.ts');

    const uploadRes = await fetch(`${baseUrl}/api/tasks/${taskId}/attachments`, {
      method: 'POST',
      body: formData,
    });
    assert.equal(uploadRes.status, 200);
    const uploaded = (await uploadRes.json()) as any[];
    assert.equal(uploaded.length, 1);
    assert.equal(uploaded[0].name, 'hello.ts');
    assert.equal(uploaded[0].type, 'text/typescript');
    assert.equal(uploaded[0].size, testContent.length);
    assert.ok(uploaded[0].path.startsWith('.raft/attachments/'));

    const attachmentId = uploaded[0].id;

    // 2. Retrieve text content preview via /content
    const contentRes = await fetch(`${baseUrl}/api/tasks/${taskId}/attachments/${attachmentId}/content`);
    assert.equal(contentRes.status, 200);
    const contentData = (await contentRes.json()) as any;
    assert.equal(contentData.content, testContent);
    assert.equal(contentData.isTruncated, false);

    // 3. Download/stream original file via /:attachmentId
    const fileRes = await fetch(`${baseUrl}/api/tasks/${taskId}/attachments/${attachmentId}`);
    assert.equal(fileRes.status, 200);
    const fileText = await fileRes.text();
    assert.equal(fileText, testContent);
  } finally {
    await new Promise<void>((resolve) => testServer.close(() => resolve()));
    try {
      db.prepare('DELETE FROM attachments WHERE task_id = ?').run(taskId);
      db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    } catch {}
    try {
      fs.rmSync(tmpWorktree, { recursive: true, force: true });
    } catch {}
  }
});

