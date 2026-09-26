import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptManager } from './scriptManager.js';

test('scriptManager starts an execution and completes with exitCode 0', async () => {
  const execution = scriptManager.startExecution({
    taskId: 'test-task-1',
    projectId: 'test-proj-1',
    scriptName: 'Echo Test',
    command: 'node -e "console.log(\'testing script output\')"',
    worktreePath: process.cwd(),
  });

  assert.equal(execution.status, 'running');
  assert.equal(execution.scriptName, 'Echo Test');

  // Wait for completion
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      const item = scriptManager.getExecution(execution.id);
      if (item && item.status !== 'running') {
        clearInterval(check);
        assert.equal(item.status, 'completed');
        assert.equal(item.exitCode, 0);
        assert.ok(item.output.includes('testing script output'));
        resolve();
      }
    }, 50);
  });
});

test('scriptManager can cancel a running execution', async () => {
  const execution = scriptManager.startExecution({
    taskId: 'test-task-2',
    projectId: 'test-proj-2',
    scriptName: 'Long running',
    command: 'node -e "setInterval(() => console.log(\'tick\'), 50)"',
    worktreePath: process.cwd(),
  });

  assert.equal(execution.status, 'running');

  // Give process brief moment to spawn
  await new Promise((r) => setTimeout(r, 100));

  const canceled = scriptManager.cancelExecution(execution.id, true);
  assert.ok(canceled);

  // Wait for status update
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      const item = scriptManager.getExecution(execution.id);
      if (item && item.status !== 'running') {
        clearInterval(check);
        assert.equal(item.status, 'canceled');
        resolve();
      }
    }, 50);
  });
});

test('scriptManager can dismiss an execution', async () => {
  const execution = scriptManager.startExecution({
    taskId: 'test-task-3',
    projectId: 'test-proj-3',
    scriptName: 'Dismiss test',
    command: 'node -e "console.log(\'done\')"',
    worktreePath: process.cwd(),
  });

  // Wait for finish
  await new Promise((r) => setTimeout(r, 200));

  const dismissed = scriptManager.dismissExecution(execution.id);
  assert.ok(dismissed);
  assert.equal(scriptManager.getExecution(execution.id), undefined);
});
