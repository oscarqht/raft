import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './db.js';
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
