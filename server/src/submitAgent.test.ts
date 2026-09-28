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


