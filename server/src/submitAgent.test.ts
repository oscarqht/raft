import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { runSubmitAgent, detectGitUsername, StreamEvent } from './agentRunner.js';
import { GitService } from './gitService.js';

test('detectGitUsername extracts username from github remote URL', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termai-detect-user-'));
  try {
    GitService.initRepo(tmpDir);
    execSync('git remote add origin https://github.com/oscarqht/arcable.git', { cwd: tmpDir });
    const user = detectGitUsername(tmpDir);
    assert.equal(user, 'oscarqht');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});

test('runSubmitAgent stages, commits, and pushes to origin with live events', async () => {
  const tmpRemote = fs.mkdtempSync(path.join(os.tmpdir(), 'termai-remote-'));
  const tmpLocal = fs.mkdtempSync(path.join(os.tmpdir(), 'termai-local-'));

  try {
    // 1. Setup a bare remote repo
    execSync('git init --bare', { cwd: tmpRemote });

    // 2. Setup local repo with a main branch
    GitService.initRepo(tmpLocal);
    fs.writeFileSync(path.join(tmpLocal, 'README.md'), '# Test\n');
    execSync('git add -A', { cwd: tmpLocal });
    execSync('git commit -m "init"', { cwd: tmpLocal });
    execSync(`git remote add origin "${tmpRemote.replace(/\\/g, '/')}"`, { cwd: tmpLocal });
    execSync('git branch -M main', { cwd: tmpLocal });
    execSync('git push -u origin main', { cwd: tmpLocal });

    // 3. Create a feature branch with pending changes
    execSync('git checkout -b feature-test', { cwd: tmpLocal });
    fs.writeFileSync(path.join(tmpLocal, 'new_feature.ts'), 'export const test = true;\n');

    // 4. Run runSubmitAgent
    const events: StreamEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      const runner = runSubmitAgent(
        tmpLocal,
        'feature-test',
        'feat: implement new test feature\n\n- item 1\n- item 2',
        'agy',
        undefined,
        undefined,
        (ev) => {
          events.push(ev);
          if (ev.type === 'done') resolve();
          if (ev.type === 'error') reject(new Error(ev.content));
        }
      );
      assert.ok(runner.kill, 'Runner should have kill method');
    });

    // 5. Verify git status and commit
    const status = GitService.getGitStatus(tmpLocal);
    assert.equal(status.staged.length, 0);
    assert.equal(status.unstaged.length, 0);
    assert.equal(status.untracked.length, 0);

    const log = execSync('git log -1 --pretty=%B', { cwd: tmpLocal, encoding: 'utf-8' });
    assert.ok(log.includes('feat: implement new test feature'));
    assert.ok(log.includes('- item 1'));

    // Verify events were emitted
    assert.ok(events.some((e) => e.type === 'status'));
    assert.ok(events.some((e) => e.type === 'thought' && e.content?.includes('git add')));
    assert.ok(events.some((e) => e.type === 'thought' && e.content?.includes('git commit')));
    assert.ok(events.some((e) => e.type === 'done'));
  } finally {
    try {
      fs.rmSync(tmpRemote, { recursive: true, force: true });
      fs.rmSync(tmpLocal, { recursive: true, force: true });
    } catch {}
  }
});

test('GitService.getGitStatus detects unpushed commits and runSubmitAgent pushes them with 0 file changes', async () => {
  const tmpRemote = fs.mkdtempSync(path.join(os.tmpdir(), 'termai-remote2-'));
  const tmpLocal = fs.mkdtempSync(path.join(os.tmpdir(), 'termai-local2-'));

  try {
    // 1. Remote repo
    execSync('git init --bare', { cwd: tmpRemote });

    // 2. Local repo
    GitService.initRepo(tmpLocal);
    fs.writeFileSync(path.join(tmpLocal, 'README.md'), '# Test\n');
    execSync('git add -A', { cwd: tmpLocal });
    execSync('git commit -m "init"', { cwd: tmpLocal });
    execSync(`git remote add origin "${tmpRemote.replace(/\\/g, '/')}"`, { cwd: tmpLocal });
    execSync('git branch -M main', { cwd: tmpLocal });
    execSync('git push -u origin main', { cwd: tmpLocal });

    // 3. Feature branch with an already committed change (0 uncommitted file changes)
    execSync('git checkout -b feature-unpushed', { cwd: tmpLocal });
    fs.writeFileSync(path.join(tmpLocal, 'committed_feature.ts'), 'export const ready = true;\n');
    execSync('git add -A', { cwd: tmpLocal });
    execSync('git commit -m "feat: committed locally already"', { cwd: tmpLocal });

    // 4. Verify GitService detects 0 file changes but 1 unpushed commit
    const statusBefore = GitService.getGitStatus(tmpLocal, 'feature-unpushed', 'main');
    assert.equal(statusBefore.staged.length, 0);
    assert.equal(statusBefore.unstaged.length, 0);
    assert.equal(statusBefore.untracked.length, 0);
    assert.equal(statusBefore.unpushedCount, 1);
    assert.equal(statusBefore.unpushedCommits.length, 1);
    assert.equal(statusBefore.unpushedCommits[0].message, 'feat: committed locally already');

    // 5. Run runSubmitAgent without new commit message (push only)
    await new Promise<void>((resolve, reject) => {
      runSubmitAgent(
        tmpLocal,
        'feature-unpushed',
        '',
        'agy',
        undefined,
        undefined,
        (ev) => {
          if (ev.type === 'done') resolve();
          if (ev.type === 'error') reject(new Error(ev.content));
        }
      );
    });

    // 6. Verify unpushedCount is now 0 after push
    const statusAfter = GitService.getGitStatus(tmpLocal, 'feature-unpushed', 'main');
    assert.equal(statusAfter.unpushedCount, 0);
    assert.equal(statusAfter.unpushedCommits.length, 0);
  } finally {
    try {
      fs.rmSync(tmpRemote, { recursive: true, force: true });
      fs.rmSync(tmpLocal, { recursive: true, force: true });
    } catch {}
  }
});

