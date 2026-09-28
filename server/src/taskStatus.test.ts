import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import {
  parseRemoteUrl,
  getCreatePrUrl,
  GitService,
} from './gitService.js';

test('parseRemoteUrl parses GitHub and GitLab ssh and https remotes', () => {
  const ghSsh = parseRemoteUrl('git@github.com:oscarqht/raft.git');
  assert.equal(ghSsh?.provider, 'github');
  assert.equal(ghSsh?.host, 'github.com');
  assert.equal(ghSsh?.owner, 'oscarqht');
  assert.equal(ghSsh?.repo, 'raft');
  assert.equal(ghSsh?.projectPath, 'oscarqht/raft');

  const ghHttps = parseRemoteUrl('https://github.com/facebook/react.git');
  assert.equal(ghHttps?.provider, 'github');
  assert.equal(ghHttps?.owner, 'facebook');
  assert.equal(ghHttps?.repo, 'react');

  const glHttps = parseRemoteUrl('https://gitlab.com/group/subgroup/my-proj.git');
  assert.equal(glHttps?.provider, 'gitlab');
  assert.equal(glHttps?.host, 'gitlab.com');
  assert.equal(glHttps?.projectPath, 'group/subgroup/my-proj');

  const glSsh = parseRemoteUrl('git@gitlab.com:org/app.git');
  assert.equal(glSsh?.provider, 'gitlab');
  assert.equal(glSsh?.projectPath, 'org/app');
});

test('getCreatePrUrl generates comparison and new MR links', () => {
  const gh = parseRemoteUrl('https://github.com/my-org/my-repo.git');
  const ghUrl = getCreatePrUrl(gh, 'feature-auth', 'main');
  assert.equal(ghUrl, 'https://github.com/my-org/my-repo/compare/main...feature-auth?expand=1');

  const gl = parseRemoteUrl('git@gitlab.com:team/project.git');
  const glUrl = getCreatePrUrl(gl, 'feature-ui', 'dev');
  assert.equal(
    glUrl,
    'https://gitlab.com/team/project/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature-ui&merge_request%5Btarget_branch%5D=dev'
  );
});

test('GitService.getDetailedTaskStatus detects behind base branch and local changes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-status-test-'));
  try {
    // 1. Setup local bare remote and clone
    const bareDir = path.join(tmpDir, 'remote.git');
    const repoDir = path.join(tmpDir, 'repo');
    execSync(`git init --bare "${bareDir}"`, { stdio: 'ignore' });
    execSync(`git clone "${bareDir}" "${repoDir}"`, { stdio: 'ignore' });
    execSync('git config user.name "Tester"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'ignore' });

    // Initial commit on main
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# Main', 'utf-8');
    execSync('git add . && git commit -m "init main"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git push origin main', { cwd: repoDir, stdio: 'ignore' });

    // Create a worktree for feature-1
    const wtResult = GitService.createWorktree(repoDir, 'feature-1', 'main');
    const wtPath = wtResult.worktreePath;
    execSync('git config user.name "Tester"', { cwd: wtPath, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: wtPath, stdio: 'ignore' });

    // Status on clean new task
    let status = await GitService.getDetailedTaskStatus(wtPath, 'feature-1', 'main', { forceRefresh: true });
    assert.equal(status.hasLocalChanges, false);
    assert.equal(status.behindCount, 0);
    assert.equal(status.unpushedCount, 0);
    assert.equal(status.isMerged, false);
    assert.equal(status.lifecycleStage, 'clean');

    // 2. Add local changes (unstaged/untracked)
    fs.writeFileSync(path.join(wtPath, 'new-file.txt'), 'hello', 'utf-8');
    status = await GitService.getDetailedTaskStatus(wtPath, 'feature-1', 'main', { forceRefresh: true });
    assert.equal(status.hasLocalChanges, true);
    assert.equal(status.untracked.includes('new-file.txt'), true);
    assert.equal(status.lifecycleStage, 'in_progress');

    // Commit file
    execSync('git add . && git commit -m "feat: new file"', { cwd: wtPath, stdio: 'ignore' });
    status = await GitService.getDetailedTaskStatus(wtPath, 'feature-1', 'main', { forceRefresh: true });
    assert.equal(status.hasLocalChanges, false);
    assert.equal(status.unpushedCount, 1);
    assert.equal(status.lifecycleStage, 'in_progress');

    // 3. Make main advance on remote (to test behind base branch)
    fs.writeFileSync(path.join(repoDir, 'update.txt'), 'main update', 'utf-8');
    execSync('git add . && git commit -m "update main"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git push origin main', { cwd: repoDir, stdio: 'ignore' });

    // Fetch and check divergence
    execSync('git fetch origin main', { cwd: wtPath, stdio: 'ignore' });
    status = await GitService.getDetailedTaskStatus(wtPath, 'feature-1', 'main', { forceRefresh: true });
    assert.equal(status.behindCount, 1);
    assert.equal(status.aheadCount, 1);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});
