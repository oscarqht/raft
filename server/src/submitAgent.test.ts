import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { runSubmitAgent, detectGitUsername, StreamEvent } from './agentRunner.js';
import { GitService } from './gitService.js';
import { insertGitAccount, deleteGitAccountById, findGitAccountForRemote } from './db.js';

test('detectGitUsername extracts username from github remote URL', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-detect-user-'));
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
  const tmpRemote = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-remote-'));
  const tmpLocal = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-local-'));

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
  const tmpRemote = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-remote2-'));
  const tmpLocal = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-local2-'));

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

test('findGitAccountForRemote matches github and gitlab accounts accurately', () => {
  const testAccId1 = 'acc-test-github-' + Date.now();
  const testAccId2 = 'acc-test-gitlab-' + Date.now();

  try {
    insertGitAccount({
      id: testAccId1,
      provider: 'github',
      name: 'GitHub User',
      username: 'oscarqht',
      avatar_url: null,
      token: 'ghp_secret_test_token',
      host: 'https://github.com',
      created_at: Date.now(),
    });

    insertGitAccount({
      id: testAccId2,
      provider: 'gitlab',
      name: 'GitLab Enterprise',
      username: 'tangqh',
      avatar_url: null,
      token: 'glpat_secret_gitlab_token',
      host: 'https://git.insea.io',
      created_at: Date.now(),
    });

    // 1. Matches GitHub remote with username in url
    const match1 = findGitAccountForRemote('https://github.com/oscarqht/raft.git');
    assert.ok(match1);
    assert.equal(match1.username, 'oscarqht');
    assert.equal(match1.token, 'ghp_secret_test_token');

    // 2. Matches GitHub remote with detected user
    const match2 = findGitAccountForRemote('https://github.com/someorg/repo.git', 'oscarqht');
    assert.ok(match2);
    assert.equal(match2.username, 'oscarqht');

    // 3. Matches custom enterprise host
    const match3 = findGitAccountForRemote('https://git.insea.io/tangqh/repo.git');
    assert.ok(match3);
    assert.equal(match3.username, 'tangqh');
    assert.equal(match3.token, 'glpat_secret_gitlab_token');

    // 4. Returns undefined for unknown remote host
    const match4 = findGitAccountForRemote('https://bitbucket.org/someone/repo.git');
    assert.equal(match4, undefined);
  } finally {
    deleteGitAccountById(testAccId1);
    deleteGitAccountById(testAccId2);
  }
});

test('runSubmitAgent masks PAT auth header from UI logs during push', async () => {
  const tmpRemote = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-remote-auth-'));
  const tmpLocal = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-local-auth-'));
  const testAccId = 'acc-test-pat-' + Date.now();

  try {
    insertGitAccount({
      id: testAccId,
      provider: 'github',
      name: 'Test Auth User',
      username: 'oscarqht',
      avatar_url: null,
      token: 'ghp_super_secret_pat_99999',
      host: 'https://github.com',
      created_at: Date.now(),
    });

    execSync('git init --bare', { cwd: tmpRemote });
    GitService.initRepo(tmpLocal);
    fs.writeFileSync(path.join(tmpLocal, 'README.md'), '# Test\n');
    execSync('git add -A', { cwd: tmpLocal });
    execSync('git commit -m "init"', { cwd: tmpLocal });
    execSync(`git remote add origin "${tmpRemote.replace(/\\/g, '/')}"`, { cwd: tmpLocal });
    execSync('git branch -M main', { cwd: tmpLocal });
    execSync('git push -u origin main', { cwd: tmpLocal });

    execSync('git checkout -b feature-pat-test', { cwd: tmpLocal });
    fs.writeFileSync(path.join(tmpLocal, 'file.txt'), 'hello\n');

    const thoughts: string[] = [];
    await new Promise<void>((resolve, reject) => {
      runSubmitAgent(
        tmpLocal,
        'feature-pat-test',
        'feat: test pat commit',
        undefined,
        undefined,
        (ev) => {
          if (ev.type === 'thought' && ev.content) thoughts.push(ev.content);
          if (ev.type === 'done') resolve();
          if (ev.type === 'error') reject(new Error(ev.content));
        }
      );
    });

    // Verify token was NOT exposed in thought events
    for (const t of thoughts) {
      assert.ok(!t.includes('ghp_super_secret_pat_99999'), 'PAT must never be in thought events');
      assert.ok(!t.includes('http.extraheader'), 'extraheader should not be shown in thought command line');
    }
  } finally {
    deleteGitAccountById(testAccId);
    try {
      fs.rmSync(tmpRemote, { recursive: true, force: true });
      fs.rmSync(tmpLocal, { recursive: true, force: true });
    } catch {}
  }
});

test('runSubmitAgent pushes to custom named remote (e.g. gitlab) when origin does not exist', async () => {
  const tmpRemote = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-remote-gitlab-'));
  const tmpLocal = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-local-gitlab-'));

  try {
    execSync('git init --bare', { cwd: tmpRemote });
    GitService.initRepo(tmpLocal);
    fs.writeFileSync(path.join(tmpLocal, 'README.md'), '# GitLab Test\n');
    execSync('git add -A', { cwd: tmpLocal });
    execSync('git commit -m "init"', { cwd: tmpLocal });
    // Note: remote is named 'gitlab', NOT 'origin'
    execSync(`git remote add gitlab "${tmpRemote.replace(/\\/g, '/')}"`, { cwd: tmpLocal });
    execSync('git branch -M main', { cwd: tmpLocal });
    execSync('git push -u gitlab main', { cwd: tmpLocal });

    execSync('git checkout -b fix-voice-issue', { cwd: tmpLocal });
    fs.writeFileSync(path.join(tmpLocal, 'voice.txt'), 'fixed voice\n');

    let pushedRemote = '';
    await new Promise<void>((resolve, reject) => {
      runSubmitAgent(
        tmpLocal,
        'fix-voice-issue',
        'fix(voice): fix issue',
        undefined,
        undefined,
        (ev) => {
          if (ev.type === 'status' && ev.content && ev.content.includes('pushed branch')) {
            pushedRemote = ev.content;
          }
          if (ev.type === 'done') resolve();
          if (ev.type === 'error') reject(new Error(ev.content || 'error'));
        },
        'main'
      );
    });

    assert.ok(pushedRemote.includes('gitlab'), `Expected push status to indicate gitlab remote, got: ${pushedRemote}`);

    // Verify remote received the branch
    const remoteBranches = execSync('git branch -a', { cwd: tmpRemote, encoding: 'utf-8' });
    assert.ok(remoteBranches.includes('fix-voice-issue'), 'Remote bare repo should have received fix-voice-issue');
  } finally {
    try {
      fs.rmSync(tmpRemote, { recursive: true, force: true });
      fs.rmSync(tmpLocal, { recursive: true, force: true });
    } catch {}
  }
});

test('runSubmitAgent auto pulls latest base branch and rebases current branch onto base branch before push', async () => {
  const tmpRemote = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-remote-rebase-'));
  const tmpPeer = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-peer-'));
  const tmpLocal = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-local-rebase-'));

  try {
    // 1. Bare remote
    execSync('git init --bare', { cwd: tmpRemote });

    // 2. Peer creates main branch with initial commit and pushes
    GitService.initRepo(tmpPeer);
    fs.writeFileSync(path.join(tmpPeer, 'README.md'), '# Base\n');
    execSync('git add -A', { cwd: tmpPeer });
    execSync('git commit -m "init"', { cwd: tmpPeer });
    execSync(`git remote add origin "${tmpRemote.replace(/\\/g, '/')}"`, { cwd: tmpPeer });
    execSync('git branch -M main', { cwd: tmpPeer });
    execSync('git push -u origin main', { cwd: tmpPeer });

    // 3. Local clones and creates feature branch
    execSync(`git clone "${tmpRemote.replace(/\\/g, '/')}" "${tmpLocal.replace(/\\/g, '/')}"`);
    execSync('git checkout -b feature-auto-rebase', { cwd: tmpLocal });
    fs.writeFileSync(path.join(tmpLocal, 'feature.txt'), 'feature code\n');

    // 4. Peer pushes a new commit to main in remote
    fs.writeFileSync(path.join(tmpPeer, 'upstream_change.txt'), 'upstream content\n');
    execSync('git add -A', { cwd: tmpPeer });
    execSync('git commit -m "feat(upstream): update main"', { cwd: tmpPeer });
    execSync('git push origin main', { cwd: tmpPeer });

    // 5. Local runs runSubmitAgent
    await new Promise<void>((resolve, reject) => {
      runSubmitAgent(
        tmpLocal,
        'feature-auto-rebase',
        'feat: my local feature',
        'agy',
        undefined,
        undefined,
        (ev) => {
          if (ev.type === 'done') resolve();
          if (ev.type === 'error') reject(new Error(ev.content));
        },
        'main'
      );
    });

    // 6. Verify feature-auto-rebase branch now includes upstream_change.txt from rebased main!
    assert.ok(fs.existsSync(path.join(tmpLocal, 'upstream_change.txt')), 'Feature branch should have upstream file after rebase');
    const log = execSync('git log --oneline', { cwd: tmpLocal, encoding: 'utf-8' });
    assert.ok(log.includes('feat(upstream): update main'), 'Git log should include upstream commit');
    assert.ok(log.includes('feat: my local feature'), 'Git log should include local feature commit');
  } finally {
    try {
      fs.rmSync(tmpRemote, { recursive: true, force: true });
      fs.rmSync(tmpPeer, { recursive: true, force: true });
      fs.rmSync(tmpLocal, { recursive: true, force: true });
    } catch {}
  }
});

test('runSubmitAgent pulls and integrates remote changes of current branch before push', async () => {
  const tmpRemote = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-remote-curr-'));
  const tmpPeer = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-peer-curr-'));
  const tmpLocal = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-local-curr-'));

  try {
    execSync('git init --bare', { cwd: tmpRemote });

    // Peer sets up main and feature-shared branch
    GitService.initRepo(tmpPeer);
    fs.writeFileSync(path.join(tmpPeer, 'README.md'), '# Initial\n');
    execSync('git add -A && git commit -m "init"', { cwd: tmpPeer });
    execSync(`git remote add origin "${tmpRemote.replace(/\\/g, '/')}"`, { cwd: tmpPeer });
    execSync('git branch -M main && git push -u origin main', { cwd: tmpPeer });
    execSync('git checkout -b feature-shared && git push -u origin feature-shared', { cwd: tmpPeer });

    // Local clones repo and checks out feature-shared
    execSync(`git clone "${tmpRemote.replace(/\\/g, '/')}" "${tmpLocal.replace(/\\/g, '/')}"`);
    execSync('git checkout feature-shared', { cwd: tmpLocal });

    // Peer pushes a commit to feature-shared
    fs.writeFileSync(path.join(tmpPeer, 'peer_change.txt'), 'peer content\n');
    execSync('git add -A && git commit -m "feat: peer commit" && git push origin feature-shared', { cwd: tmpPeer });

    // Local makes a local change without pulling first
    fs.writeFileSync(path.join(tmpLocal, 'local_change.txt'), 'local content\n');

    // Run runSubmitAgent
    await new Promise<void>((resolve, reject) => {
      runSubmitAgent(
        tmpLocal,
        'feature-shared',
        'feat: local commit',
        'agy',
        undefined,
        undefined,
        (ev) => {
          if (ev.type === 'done') resolve();
          if (ev.type === 'error') reject(new Error(ev.content));
        },
        'main'
      );
    });

    // Both peer and local files should be in local branch and in remote
    assert.ok(fs.existsSync(path.join(tmpLocal, 'peer_change.txt')), 'Local repo should have integrated peer change');
    assert.ok(fs.existsSync(path.join(tmpLocal, 'local_change.txt')), 'Local repo should have local change');

    // Verify remote received the update
    const remoteLog = execSync(`git log --oneline feature-shared`, { cwd: tmpPeer, encoding: 'utf-8' });
    execSync('git pull origin feature-shared', { cwd: tmpPeer });
    assert.ok(fs.existsSync(path.join(tmpPeer, 'local_change.txt')), 'Remote branch should have received local changes');
  } finally {
    try {
      fs.rmSync(tmpRemote, { recursive: true, force: true });
      fs.rmSync(tmpPeer, { recursive: true, force: true });
      fs.rmSync(tmpLocal, { recursive: true, force: true });
    } catch {}
  }
});

test('GitService.createWorktree auto pulls base branch and integrates existing remote branch', () => {
  const tmpRemote = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-remote-wt-'));
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-repo-wt-'));
  const tmpPeer = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-peer-wt-'));

  try {
    execSync('git init --bare', { cwd: tmpRemote });

    // Peer creates main
    GitService.initRepo(tmpPeer);
    fs.writeFileSync(path.join(tmpPeer, 'README.md'), '# Initial\n');
    execSync('git add -A && git commit -m "init"', { cwd: tmpPeer });
    execSync(`git remote add origin "${tmpRemote.replace(/\\/g, '/')}"`, { cwd: tmpPeer });
    execSync('git branch -M main && git push -u origin main', { cwd: tmpPeer });

    // Peer creates remote branch task-feature-1
    execSync('git checkout -b task-feature-1', { cwd: tmpPeer });
    fs.writeFileSync(path.join(tmpPeer, 'task1.txt'), 'task 1\n');
    execSync('git add -A && git commit -m "feat: task 1" && git push -u origin task-feature-1', { cwd: tmpPeer });

    // Peer updates main
    execSync('git checkout main', { cwd: tmpPeer });
    fs.writeFileSync(path.join(tmpPeer, 'main_update.txt'), 'main update\n');
    execSync('git add -A && git commit -m "feat: main update" && git push origin main', { cwd: tmpPeer });

    // Main repo clones
    execSync(`git clone "${tmpRemote.replace(/\\/g, '/')}" "${tmpRepo.replace(/\\/g, '/')}"`);

    // Create worktree for task-feature-1
    const { worktreePath, branch, hasConflicts } = GitService.createWorktree(tmpRepo, 'task-feature-1', 'main');
    assert.equal(branch, 'task-feature-1');
    assert.equal(hasConflicts, false);

    // Verify worktree has both task1.txt and main_update.txt (rebased onto latest main!)
    assert.ok(fs.existsSync(path.join(worktreePath, 'task1.txt')));
    assert.ok(fs.existsSync(path.join(worktreePath, 'main_update.txt')));
  } finally {
    try {
      fs.rmSync(tmpRemote, { recursive: true, force: true });
      fs.rmSync(tmpRepo, { recursive: true, force: true });
      fs.rmSync(tmpPeer, { recursive: true, force: true });
    } catch {}
  }
});



