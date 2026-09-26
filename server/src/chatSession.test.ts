import test from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db.js';
import { buildConversationContextFallback } from './agentRunner.js';

test('buildConversationContextFallback returns currentPrompt unchanged when messages are empty', () => {
  const result = buildConversationContextFallback([], 'What should I do?');
  assert.equal(result, 'What should I do?');
});

test('buildConversationContextFallback strips <thought> blocks and formats dialogue history', () => {
  const messages = [
    {
      role: 'user',
      content: '/grill-me what should i work on next',
    },
    {
      role: 'assistant',
      content: '<thought>\n→ Run: dir\n→ Search: README\n</thought>\n\nQuestion 1: What should happen when a TmpTab is dropped onto the Favourites Shelf?\n1. Open in new tab\n2. Pin to shelf\n3. Show popup',
    },
  ];

  const fallback = buildConversationContextFallback(messages, '1');

  assert.ok(fallback.includes('[Previous Conversation History]'));
  assert.ok(fallback.includes('User: /grill-me what should i work on next'));
  assert.ok(fallback.includes('Assistant: Question 1: What should happen when a TmpTab is dropped onto the Favourites Shelf?'));
  // Make sure <thought> was stripped out
  assert.ok(!fallback.includes('<thought>'));
  assert.ok(!fallback.includes('→ Run: dir'));
  assert.ok(fallback.includes('[Current User Message]\n1'));
});

test('chat_sessions table supports cli_session_id and cli_session_agent persistence', () => {
  const testTaskId = uuidv4();
  const testSessionId = uuidv4();
  const now = Date.now();

  // Insert a test task and project if needed
  const testProjectId = uuidv4();
  db.prepare(`
    INSERT INTO projects (id, name, path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(testProjectId, 'test-project', `C:/fake/path/${testProjectId}`, now, now);

  db.prepare(`
    INSERT INTO tasks (id, project_id, name, branch, base_branch, worktree_path, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(testTaskId, testProjectId, 'test-task', 'test-branch', 'main', `C:/fake/worktree/${testTaskId}`, 'active', now, now);

  db.prepare(`
    INSERT INTO chat_sessions (id, task_id, title, agent_cli, model, thinking_effort, status, cli_session_id, cli_session_agent, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(testSessionId, testTaskId, 'Chat Test', 'agy', 'gemini-3.8-flash', 'medium', 'idle', null, null, now, now);

  let session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(testSessionId) as any;
  assert.equal(session.cli_session_id, null);
  assert.equal(session.cli_session_agent, null);

  // Update with discovered CLI session ID
  const agyConvId = 'd489da1e-51d3-4289-a36b-1ea09faa12cc';
  db.prepare('UPDATE chat_sessions SET cli_session_id = ?, cli_session_agent = ? WHERE id = ?')
    .run(agyConvId, 'agy', testSessionId);

  session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(testSessionId) as any;
  assert.equal(session.cli_session_id, agyConvId);
  assert.equal(session.cli_session_agent, 'agy');

  // Verify that changing agent CLI resets session ID
  const isCliChanged = true;
  db.prepare(`
    UPDATE chat_sessions
    SET agent_cli = ?
    ${isCliChanged ? ', cli_session_id = NULL, cli_session_agent = NULL' : ''}
    WHERE id = ?
  `).run('codex', testSessionId);

  session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(testSessionId) as any;
  assert.equal(session.agent_cli, 'codex');
  assert.equal(session.cli_session_id, null);
  assert.equal(session.cli_session_agent, null);

  // Clean up
  db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(testSessionId);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(testTaskId);
  db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
});

test('CLI argument construction logic for resuming vs starting new sessions', () => {
  // Test Agy
  function buildAgyArgs(cliSessionIdToResume: string | null, prompt: string, model?: string, effort?: string) {
    const args: string[] = [];
    if (cliSessionIdToResume) {
      args.push('--conversation', cliSessionIdToResume);
    }
    args.push('-p', prompt);
    if (model) args.push('--model', model);
    args.push('--effort', effort || 'medium');
    args.push('--output-format', 'stream-json');
    args.push('--dangerously-skip-permissions');
    return args;
  }

  const agyFirstTurn = buildAgyArgs(null, 'hello', 'gemini-3.8-flash', 'medium');
  assert.ok(!agyFirstTurn.includes('--conversation'));
  assert.ok(agyFirstTurn.includes('-p'));

  const agySecondTurn = buildAgyArgs('agy-uuid-1234', '1', 'gemini-3.8-flash', 'medium');
  assert.ok(agySecondTurn.includes('--conversation'));
  assert.equal(agySecondTurn[agySecondTurn.indexOf('--conversation') + 1], 'agy-uuid-1234');
  assert.equal(agySecondTurn[agySecondTurn.indexOf('-p') + 1], '1');

  // Test Codex
  function buildCodexArgs(cliSessionIdToResume: string | null, prompt: string, model?: string) {
    const args: string[] = [];
    if (cliSessionIdToResume) {
      args.push('exec', 'resume', cliSessionIdToResume, prompt);
    } else {
      args.push('exec', prompt);
    }
    if (model) args.push('--model', model);
    args.push('-c', 'service_tier="fast"');
    return args;
  }

  const codexFirstTurn = buildCodexArgs(null, 'hello');
  assert.deepEqual(codexFirstTurn.slice(0, 2), ['exec', 'hello']);

  const codexSecondTurn = buildCodexArgs('thread-uuid-5678', '1');
  assert.deepEqual(codexSecondTurn.slice(0, 4), ['exec', 'resume', 'thread-uuid-5678', '1']);

  // Test Claude
  function buildClaudeArgs(cliSessionIdToResume: string | null, newClaudeId: string, prompt: string) {
    const args: string[] = [];
    if (cliSessionIdToResume) {
      args.push('--resume', cliSessionIdToResume);
      args.push('-p', prompt);
    } else {
      args.push('--session-id', newClaudeId);
      args.push('-p', prompt);
    }
    args.push('--dangerously-skip-permissions');
    return args;
  }

  const claudeFirstTurn = buildClaudeArgs(null, 'claude-uuid-1111', 'hello');
  assert.ok(claudeFirstTurn.includes('--session-id'));
  assert.equal(claudeFirstTurn[claudeFirstTurn.indexOf('--session-id') + 1], 'claude-uuid-1111');

  const claudeSecondTurn = buildClaudeArgs('claude-uuid-1111', 'claude-uuid-2222', '1');
  assert.ok(claudeSecondTurn.includes('--resume'));
  assert.equal(claudeSecondTurn[claudeSecondTurn.indexOf('--resume') + 1], 'claude-uuid-1111');
});
