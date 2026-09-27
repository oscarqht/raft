import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { db, insertGitAccount, getAllGitAccounts, getGitAccountById, deleteGitAccountById } from './db.js';
import { GitService } from './gitService.js';
import { v4 as uuidv4 } from 'uuid';

test('Project configuration can be updated in SQLite database', () => {
  const projectId = uuidv4();
  const now = Date.now();

  // Insert initial project
  db.prepare(`
    INSERT INTO projects (
      id, name, path, dev_cmd, dev_port, build_cmd, test_cmd, branch_convention,
      default_agent_cli, default_model, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    projectId,
    'test-project',
    '/dummy/path/' + projectId,
    'npm run dev',
    5173,
    'npm run build',
    'npm test',
    'main',
    'agy',
    'gemini-3.8-flash',
    now,
    now
  );

  const initial = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
  assert.equal(initial.name, 'test-project');
  assert.equal(initial.branch_convention, 'main');
  assert.equal(initial.dev_cmd, 'npm run dev');
  assert.equal(initial.dev_port, 5173);

  // Update configuration
  const updatedName = 'updated-project';
  const updatedBranch = 'develop';
  const updatedDevCmd = 'pnpm dev';
  const updatedPort = 3000;
  const updatedBuildCmd = 'pnpm build';
  const updatedTestCmd = 'pnpm test';
  const updateTime = Date.now();

  db.prepare(`
    UPDATE projects SET
      name = coalesce(?, name),
      dev_cmd = coalesce(?, dev_cmd),
      dev_port = coalesce(?, dev_port),
      build_cmd = coalesce(?, build_cmd),
      test_cmd = coalesce(?, test_cmd),
      branch_convention = coalesce(?, branch_convention),
      updated_at = ?
    WHERE id = ?
  `).run(
    updatedName,
    updatedDevCmd,
    updatedPort,
    updatedBuildCmd,
    updatedTestCmd,
    updatedBranch,
    updateTime,
    projectId
  );

  const afterUpdate = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
  assert.equal(afterUpdate.name, updatedName);
  assert.equal(afterUpdate.branch_convention, updatedBranch);
  assert.equal(afterUpdate.dev_cmd, updatedDevCmd);
  assert.equal(afterUpdate.dev_port, updatedPort);
  assert.equal(afterUpdate.build_cmd, updatedBuildCmd);
  assert.equal(afterUpdate.test_cmd, updatedTestCmd);

  // Clean up
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
});

test('Task details (name, base_branch) can be modified in SQLite database', () => {
  const projectId = uuidv4();
  const taskId = uuidv4();
  const now = Date.now();

  // Create project
  db.prepare(`
    INSERT INTO projects (id, name, path, dev_cmd, dev_port, build_cmd, test_cmd, branch_convention, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, 'test-p', '/test/' + projectId, 'npm dev', 3000, 'npm build', 'npm test', 'main', now, now);

  // Create task
  db.prepare(`
    INSERT INTO tasks (id, project_id, name, branch, base_branch, worktree_path, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(taskId, projectId, 'Initial Task Name', 'task-branch-1', 'main', '/test/wt/' + taskId, 'active', now, now);

  const initialTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  assert.equal(initialTask.name, 'Initial Task Name');
  assert.equal(initialTask.base_branch, 'main');

  // Update task
  const updatedName = 'Updated Task Name';
  const updatedBaseBranch = 'develop';
  const updateTime = Date.now() + 100;

  db.prepare(`
    UPDATE tasks SET
      name = coalesce(?, name),
      base_branch = coalesce(?, base_branch),
      updated_at = ?
    WHERE id = ?
  `).run(updatedName, updatedBaseBranch, updateTime, taskId);

  const afterTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  assert.equal(afterTask.name, updatedName);
  assert.equal(afterTask.base_branch, updatedBaseBranch);
  assert.equal(afterTask.updated_at, updateTime);

  // Clean up
  db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
});

test('Project custom scripts can be saved, retrieved, and updated', () => {
  const projectId = uuidv4();
  const now = Date.now();

  const scripts = [
    { id: 's1', name: 'Dev Server', command: 'npm run app:dev' },
    { id: 's2', name: 'Build App', command: 'npm run build' },
  ];

  db.prepare(`
    INSERT INTO projects (
      id, name, path, dev_cmd, dev_port, build_cmd, test_cmd, branch_convention,
      default_agent_cli, default_model, custom_scripts, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    projectId,
    'scripts-test-proj',
    '/dummy/scripts/' + projectId,
    'npm dev',
    5173,
    'npm build',
    'npm test',
    'main',
    'agy',
    'model',
    JSON.stringify(scripts),
    now,
    now
  );

  const row = db.prepare('SELECT custom_scripts FROM projects WHERE id = ?').get(projectId) as any;
  const parsed = JSON.parse(row.custom_scripts);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'Dev Server');
  assert.equal(parsed[0].command, 'npm run app:dev');

  // Update scripts
  const updatedScripts = [
    ...scripts,
    { id: 's3', name: 'Linting', command: 'npm run lint' },
  ];

  db.prepare('UPDATE projects SET custom_scripts = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(updatedScripts),
    Date.now(),
    projectId
  );

  const rowUpdated = db.prepare('SELECT custom_scripts FROM projects WHERE id = ?').get(projectId) as any;
  const parsedUpdated = JSON.parse(rowUpdated.custom_scripts);
  assert.equal(parsedUpdated.length, 3);
  assert.equal(parsedUpdated[2].name, 'Linting');

  // Clean up
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
});

test('GitService.createNewRepo initializes directory with git, readme, and initial commit', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-test-new-repo-'));
  try {
    const repoInfo = GitService.createNewRepo(tmpDir, 'my-brand-new-app', 'main', true);
    assert.equal(repoInfo.isRepo, true);
    assert.equal(repoInfo.currentBranch, 'main');
    const fullPath = path.join(tmpDir, 'my-brand-new-app');
    assert.ok(fs.existsSync(path.join(fullPath, '.git')));
    assert.ok(fs.existsSync(path.join(fullPath, 'README.md')));
    const readmeContent = fs.readFileSync(path.join(fullPath, 'README.md'), 'utf-8');
    assert.ok(readmeContent.includes('my-brand-new-app'));

    // Verify git log has the initial commit
    const log = GitService.getUnpushedCommits(fullPath);
    // There are commits in the repo (or git rev-parse HEAD succeeds)
    assert.ok(repoInfo.repoRoot.length > 0);

    // Verify creating worktree on this repo works because HEAD exists!
    const wt = GitService.createWorktree(fullPath, 'test-task', 'main');
    assert.ok(fs.existsSync(wt.worktreePath));
    GitService.removeWorktree(fullPath, wt.worktreePath, wt.branch);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Git Accounts CRUD persistence in database', () => {
  const accId = uuidv4();
  const testAccount = {
    id: accId,
    provider: 'github' as const,
    name: 'GitHub (testuser)',
    username: 'testuser',
    avatar_url: 'https://example.com/avatar.png',
    token: 'ghp_secret_token_12345',
    host: 'https://github.com',
    created_at: Date.now(),
  };

  insertGitAccount(testAccount);

  const allAccounts = getAllGitAccounts();
  const found = allAccounts.find((a) => a.id === accId);
  assert.ok(found);
  assert.equal(found.username, 'testuser');
  assert.equal(found.provider, 'github');
  // Token should not be in getAllGitAccounts
  assert.equal((found as any).token, undefined);

  const fullAccount = getGitAccountById(accId);
  assert.ok(fullAccount);
  assert.equal(fullAccount.token, 'ghp_secret_token_12345');

  const deleted = deleteGitAccountById(accId);
  assert.equal(deleted, true);
  assert.equal(getGitAccountById(accId), undefined);
});

test('GitService.configureRepoCredentials configures local extraheader', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-creds-'));
  try {
    GitService.createNewRepo(tmpDir, 'auth-repo');
    const repoPath = path.join(tmpDir, 'auth-repo');
    GitService.configureRepoCredentials(repoPath, 'https://github.com/myorg/myrepo.git', 'ghp_secret_token_abc123');

    // Read .git/config
    const gitConfig = fs.readFileSync(path.join(repoPath, '.git', 'config'), 'utf-8');
    assert.ok(gitConfig.includes('extraheader'));
    assert.ok(gitConfig.includes('AUTHORIZATION: basic'));
    // Make sure raw token is base64 encoded and origin URL is not modified with raw token
    assert.ok(!gitConfig.includes('ghp_secret_token_abc123'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('GitService.syncBaseBranchWithRemote fast-forwards base branch when behind remote', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-sync-ff-'));
  const remoteDir = path.join(tmpDir, 'remote.git');
  const localDir = path.join(tmpDir, 'local');
  const peerDir = path.join(tmpDir, 'peer');

  try {
    // 1. Setup bare remote with default branch main
    execSync(`git init --bare -b main "${remoteDir.replace(/\\/g, '/')}"`, { stdio: 'ignore' });

    // 2. Setup local repo and push initial commit
    fs.mkdirSync(localDir, { recursive: true });
    execSync('git init -b main', { cwd: localDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: localDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: localDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(localDir, 'file1.txt'), 'hello 1');
    execSync('git add . && git commit -m "commit 1"', { cwd: localDir, stdio: 'ignore' });
    execSync(`git remote add origin "${remoteDir.replace(/\\/g, '/')}"`, { cwd: localDir, stdio: 'ignore' });
    execSync('git push -u origin main', { cwd: localDir, stdio: 'ignore' });

    // 3. Clone peer, make commit 2, and push to origin
    execSync(`git clone -b main "${remoteDir.replace(/\\/g, '/')}" "${peerDir.replace(/\\/g, '/')}"`, { stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: peerDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: peerDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(peerDir, 'file2.txt'), 'hello 2');
    execSync('git add . && git commit -m "commit 2 from remote"', { cwd: peerDir, stdio: 'ignore' });
    execSync('git push origin main', { cwd: peerDir, stdio: 'ignore' });

    // At this point, localDir is 1 commit behind origin/main!
    const wt = GitService.createWorktree(localDir, 'task-ff', 'main');
    try {
      // Verify file2.txt exists in the new worktree
      assert.ok(fs.existsSync(path.join(wt.worktreePath, 'file2.txt')));
      // Verify local base branch was also fast-forwarded
      assert.ok(fs.existsSync(path.join(localDir, 'file2.txt')));
    } finally {
      GitService.removeWorktree(localDir, wt.worktreePath, wt.branch);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('GitService.syncBaseBranchWithRemote rebases base branch when diverged from remote', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-sync-rebase-'));
  const remoteDir = path.join(tmpDir, 'remote.git');
  const localDir = path.join(tmpDir, 'local');
  const peerDir = path.join(tmpDir, 'peer');

  try {
    // 1. Setup bare remote with default branch main
    execSync(`git init --bare -b main "${remoteDir.replace(/\\/g, '/')}"`, { stdio: 'ignore' });

    // 2. Setup local repo and push initial commit
    fs.mkdirSync(localDir, { recursive: true });
    execSync('git init -b main', { cwd: localDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: localDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: localDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(localDir, 'common.txt'), 'base');
    execSync('git add . && git commit -m "commit base"', { cwd: localDir, stdio: 'ignore' });
    execSync(`git remote add origin "${remoteDir.replace(/\\/g, '/')}"`, { cwd: localDir, stdio: 'ignore' });
    execSync('git push -u origin main', { cwd: localDir, stdio: 'ignore' });

    // 3. Clone peer, make commit A, and push to origin
    execSync(`git clone -b main "${remoteDir.replace(/\\/g, '/')}" "${peerDir.replace(/\\/g, '/')}"`, { stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: peerDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: peerDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(peerDir, 'remote_change.txt'), 'from remote');
    execSync('git add . && git commit -m "remote commit A"', { cwd: peerDir, stdio: 'ignore' });
    execSync('git push origin main', { cwd: peerDir, stdio: 'ignore' });

    // 4. In localDir, make local commit B on main (diverging from origin)
    fs.writeFileSync(path.join(localDir, 'local_change.txt'), 'from local');
    execSync('git add . && git commit -m "local commit B"', { cwd: localDir, stdio: 'ignore' });

    // Now local main has diverged (ahead 1, behind 1)
    const wt = GitService.createWorktree(localDir, 'task-diverged', 'main');
    try {
      // Both files must exist in the worktree because local commits were rebased onto remote!
      assert.ok(fs.existsSync(path.join(wt.worktreePath, 'remote_change.txt')));
      assert.ok(fs.existsSync(path.join(wt.worktreePath, 'local_change.txt')));
      // Local main must also have both files
      assert.ok(fs.existsSync(path.join(localDir, 'remote_change.txt')));
      assert.ok(fs.existsSync(path.join(localDir, 'local_change.txt')));
    } finally {
      GitService.removeWorktree(localDir, wt.worktreePath, wt.branch);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


