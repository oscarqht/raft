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
    args.push('--output-format', 'stream-json');
    args.push('--verbose');
    args.push('--include-partial-messages');
    args.push('--dangerously-skip-permissions');
    return args;
  }

  const claudeFirstTurn = buildClaudeArgs(null, 'claude-uuid-1111', 'hello');
  assert.ok(claudeFirstTurn.includes('--session-id'));
  assert.equal(claudeFirstTurn[claudeFirstTurn.indexOf('--session-id') + 1], 'claude-uuid-1111');
  assert.ok(claudeFirstTurn.includes('--output-format'));
  assert.equal(claudeFirstTurn[claudeFirstTurn.indexOf('--output-format') + 1], 'stream-json');
  assert.ok(claudeFirstTurn.includes('--verbose'));
  assert.ok(claudeFirstTurn.includes('--include-partial-messages'));

  const claudeSecondTurn = buildClaudeArgs('claude-uuid-1111', 'claude-uuid-2222', '1');
  assert.ok(claudeSecondTurn.includes('--resume'));
  assert.equal(claudeSecondTurn[claudeSecondTurn.indexOf('--resume') + 1], 'claude-uuid-1111');
  assert.ok(claudeSecondTurn.includes('--output-format'));
  assert.ok(claudeSecondTurn.includes('--verbose'));
  assert.ok(claudeSecondTurn.includes('--include-partial-messages'));
});

test('AUTH_REQUIRED_REGEX accurately detects authentication and session expiry errors', async () => {
  const { AUTH_REQUIRED_REGEX } = await import('./agentRunner.js');

  // Claude error from user screenshot
  assert.ok(AUTH_REQUIRED_REGEX.test('Failed to authenticate: OAuth session expired and could not be refreshed'));
  assert.ok(AUTH_REQUIRED_REGEX.test('For your security, sign in again to keep using Claude.'));
  assert.ok(AUTH_REQUIRED_REGEX.test('Please sign in with your Anthropic account'));
  assert.ok(AUTH_REQUIRED_REGEX.test('Run `claude` to sign in'));

  // Codex error
  assert.ok(AUTH_REQUIRED_REGEX.test('Authentication required. Run `codex login` to sign in.'));
  assert.ok(AUTH_REQUIRED_REGEX.test('codex login required'));

  // AGY error
  assert.ok(AUTH_REQUIRED_REGEX.test('Google authentication required. Please re-authenticate with google.'));
  assert.ok(AUTH_REQUIRED_REGEX.test('Google OAuth credentials expired'));

  // False positives that should NOT match
  assert.ok(!AUTH_REQUIRED_REGEX.test('You hit your spend cap set by the owner.'));
  assert.ok(!AUTH_REQUIRED_REGEX.test('File not found: /src/app.tsx'));
  assert.ok(!AUTH_REQUIRED_REGEX.test('SyntaxError: Unexpected token < in JSON at position 0'));
});

test('SPEND_CAP_REGEX accurately detects true spend limit errors without false-positive on conversational text', async () => {
  const { SPEND_CAP_REGEX } = await import('./agentRunner.js');

  // Real spend cap errors
  assert.ok(SPEND_CAP_REGEX.test('You hit your spend cap set by the owner of your workspace. Ask an owner to increase your spend cap to continue.'));
  assert.ok(SPEND_CAP_REGEX.test('Your credit balance is too low to access the Anthropic API'));
  assert.ok(SPEND_CAP_REGEX.test('ERROR: You have exceeded your monthly budget.'));
  assert.ok(SPEND_CAP_REGEX.test('Error: insufficient_quota'));
  assert.ok(SPEND_CAP_REGEX.test('usage cap reached'));

  // Conversational phrases that MUST NOT match (including text from user screenshot)
  assert.ok(!SPEND_CAP_REGEX.test('Render a dedicated error card directly in the message stream (matching the existing Spend Cap pattern), featuring an amber/gold authentication badge'));
  assert.ok(!SPEND_CAP_REGEX.test('uses unified models for spend caps; generalizing auth detection ensures a consistent experience across all CLI agents.'));
  assert.ok(!SPEND_CAP_REGEX.test('We should calculate the budget for this project and monitor expenses.'));
  assert.ok(!SPEND_CAP_REGEX.test('Here is Round 1 of our design tree to properly handle agent authentication'));
});

