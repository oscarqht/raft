import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GitService } from './gitService.js';

test('GitService.initRepo creates a valid git repository', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termai-fs-test-'));
  try {
    const targetPath = path.join(tempDir, 'sample-repo');
    const result = GitService.initRepo(targetPath);
    assert.equal(result.isRepo, true);
    assert.ok(fs.existsSync(path.join(targetPath, '.git')));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('GitService.getRepoInfo detects git repo and non-repo properly', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termai-fs-test2-'));
  try {
    const nonRepo = path.join(tempDir, 'not-a-repo');
    fs.mkdirSync(nonRepo);
    assert.equal(GitService.getRepoInfo(nonRepo).isRepo, false);

    const isRepo = path.join(tempDir, 'a-repo');
    GitService.initRepo(isRepo);
    assert.equal(GitService.getRepoInfo(isRepo).isRepo, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
