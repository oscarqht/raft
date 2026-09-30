import test from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db.js';

test('Task query calculates effective_updated_at across tasks, sessions, and chat messages and sorts by last active time', () => {
  const projectId = uuidv4();
  const now = Date.now();

  // Create project
  db.prepare(`
    INSERT INTO projects (id, name, path, branch_convention, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(projectId, 'Sort Test Project', '/dummy/path/' + projectId, 'main', now, now);

  // Task 1: Created 1 hour ago, no chat activity
  const task1Id = uuidv4();
  const task1Created = now - 3600 * 1000;
  db.prepare(`
    INSERT INTO tasks (id, project_id, name, branch, worktree_path, base_branch, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(task1Id, projectId, 'Task 1 (Old, No activity)', 'branch-1', '/dummy/1', 'main', task1Created, task1Created);

  // Task 2: Created 30 mins ago, no chat activity
  const task2Id = uuidv4();
  const task2Created = now - 1800 * 1000;
  db.prepare(`
    INSERT INTO tasks (id, project_id, name, branch, worktree_path, base_branch, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(task2Id, projectId, 'Task 2 (Medium, No activity)', 'branch-2', '/dummy/2', 'main', task2Created, task2Created);

  // Task 3: Created 2 hours ago (oldest creation), but received chat message 5 mins ago (most recent activity)
  const task3Id = uuidv4();
  const task3Created = now - 7200 * 1000;
  const task3Updated = now - 300 * 1000; // 5 min ago
  db.prepare(`
    INSERT INTO tasks (id, project_id, name, branch, worktree_path, base_branch, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(task3Id, projectId, 'Task 3 (Oldest creation, Most recent activity)', 'branch-3', '/dummy/3', 'main', task3Created, task3Created);

  // Add a chat session and message for Task 3
  const sessionId = uuidv4();
  db.prepare(`
    INSERT INTO chat_sessions (id, task_id, title, agent_cli, model, thinking_effort, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, task3Id, 'Chat 1', 'agy', 'gemini-2.5', 'medium', 'idle', task3Created, task3Updated);

  const messageId = uuidv4();
  db.prepare(`
    INSERT INTO chat_messages (id, session_id, role, content, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(messageId, sessionId, 'user', 'Hello world', task3Updated);

  // Run the effective_updated_at query
  const query = `
    SELECT t.*,
           MAX(
             COALESCE(t.updated_at, 0),
             COALESCE(t.created_at, 0),
             COALESCE((SELECT MAX(cs.updated_at) FROM chat_sessions cs WHERE cs.task_id = t.id), 0),
             COALESCE((SELECT MAX(cs.created_at) FROM chat_sessions cs WHERE cs.task_id = t.id), 0),
             COALESCE((
               SELECT MAX(cm.timestamp)
               FROM chat_messages cm
               JOIN chat_sessions cs ON cm.session_id = cs.id
               WHERE cs.task_id = t.id
             ), 0)
           ) AS effective_updated_at
    FROM tasks t
    WHERE t.project_id = ?
    ORDER BY effective_updated_at DESC
  `;

  const results = db.prepare(query).all(projectId) as any[];

  assert.equal(results.length, 3);
  // Task 3 must be first because of its recent chat activity
  assert.equal(results[0].id, task3Id);
  assert.equal(results[0].effective_updated_at, task3Updated);

  // Task 2 must be second (created 30 mins ago)
  assert.equal(results[1].id, task2Id);
  assert.equal(results[1].effective_updated_at, task2Created);

  // Task 1 must be third (created 1 hour ago)
  assert.equal(results[2].id, task1Id);
  assert.equal(results[2].effective_updated_at, task1Created);
});
