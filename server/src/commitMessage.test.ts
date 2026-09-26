import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runCommitMessageAgent } from './agentRunner.js';
import { GitService } from './gitService.js';

test('runCommitMessageAgent returns sensible commit message for empty / no-change repository', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-test-repo-'));
  try {
    GitService.initRepo(tmpDir);

    const result = await runCommitMessageAgent(
      tmpDir,
      'support-drag-and-drop',
      'support-drag-and-drop',
      'agy'
    );

    assert.ok(result.title, 'Result must have a title');
    assert.equal(typeof result.title, 'string');
    assert.equal(typeof result.isLargeChange, 'boolean');
    assert.equal(typeof result.details, 'string');
    assert.ok(result.fullMessage.includes(result.title));
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});

test('runCommitMessageAgent formats multi-line message when details are present', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-test-repo-'));
  try {
    GitService.initRepo(tmpDir);
    // Add multiple files to simulate a large change
    fs.writeFileSync(path.join(tmpDir, 'file1.ts'), 'export const a = 1;');
    fs.writeFileSync(path.join(tmpDir, 'file2.ts'), 'export const b = 2;');
    fs.writeFileSync(path.join(tmpDir, 'file3.ts'), 'export const c = 3;');
    fs.writeFileSync(path.join(tmpDir, 'file4.ts'), 'export const d = 4;');

    const result = await runCommitMessageAgent(
      tmpDir,
      'support d&d tmp tab to favorite items',
      'support-d-d-tmp-tab',
      'agy'
    );

    assert.ok(result.title, 'Result must have a title');
    assert.ok(result.fullMessage, 'Result must have a fullMessage');
    if (result.details) {
      assert.ok(result.fullMessage.includes(result.details), 'fullMessage should include details');
      assert.ok(result.fullMessage.startsWith(result.title), 'fullMessage should start with title');
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});
