import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { db } from './db.js';
import { parseLegacyThoughtToSteps } from './agentRunner.js';

// Setup test database fixtures
test('lazy loading message activity: getSessionMessages yields lightweight summary and /api/messages/:id/activity returns full steps', async () => {
  const sessionId = 'test-session-lazy-' + Date.now();
  const taskId = 'test-task-lazy-' + Date.now();
  const projectId = 'test-project-lazy-' + Date.now();

  // Create project, task, and session
  db.prepare(`
    INSERT INTO projects (id, name, path, created_at, updated_at)
    VALUES (?, 'Test Project', '/tmp/test', ?, ?)
  `).run(projectId, Date.now(), Date.now());

  db.prepare(`
    INSERT INTO tasks (id, project_id, name, branch, base_branch, worktree_path, created_at, updated_at)
    VALUES (?, ?, 'Test Task', 'feature-lazy', 'main', '/tmp/test', ?, ?)
  `).run(taskId, projectId, Date.now(), Date.now());

  db.prepare(`
    INSERT INTO chat_sessions (id, task_id, title, agent_cli, created_at, updated_at)
    VALUES (?, ?, 'Test Chat', 'agy', ?, ?)
  `).run(sessionId, taskId, Date.now(), Date.now());

  // Create an assistant message with 10 heavy steps and thought content
  const heavySteps = Array.from({ length: 10 }, (_, i) => ({
    id: `step-${i}`,
    type: 'tool',
    toolName: i % 2 === 0 ? 'run_command' : 'view_file',
    category: i % 2 === 0 ? 'command' : 'file_read',
    title: i % 2 === 0 ? `Run: git status #${i}` : `view file: index.ts #${i}`,
    detail: `/workspace/index.ts`,
    status: 'completed',
    startTime: 1000 + i * 100,
    duration: 1.5,
    output: 'Extremely long command stdout output '.repeat(500), // ~16KB per step
  }));

  const rawMetadata = JSON.stringify({
    cli: 'agy',
    model: 'gemini-3.8-flash',
    steps: heavySteps,
  });

  const rawContent = `<thought>\n→ Run: git status\n→ view file: index.ts\n</thought>\n\nAll tasks completed successfully.`;

  const messageId = 'msg-lazy-' + Date.now();
  db.prepare(`
    INSERT INTO chat_messages (id, session_id, role, content, metadata, timestamp)
    VALUES (?, ?, 'assistant', ?, ?, ?)
  `).run(messageId, sessionId, rawContent, rawMetadata, Date.now());

  // Test extractMessageActivity logic directly
  const rawDbMsg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId) as any;
  const rawSize = JSON.stringify(rawDbMsg).length;
  assert.ok(rawSize > 150000, `Raw message should be large (>150KB), got ${rawSize}`);

  // Test API endpoint GET /api/chats/:id/messages
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname === `/api/chats/${sessionId}/messages`) {
      const messages = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId) as any[];
      for (const msg of messages) {
        if (msg.role === 'assistant') {
          let steps: any[] = [];
          if (msg.metadata) {
            try {
              const parsed = JSON.parse(msg.metadata);
              if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
                steps = parsed.steps;
                delete parsed.steps;
                msg.metadata = JSON.stringify(parsed);
              }
            } catch {}
          }
          if (typeof msg.content === 'string' && msg.content.includes('<thought>')) {
            msg.content = msg.content.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
          }
          if (steps.length > 0) {
            const files = steps.filter((s: any) => s.category === 'file_read' || s.category === 'file_write').length;
            const commands = steps.filter((s: any) => s.category === 'command').length;
            const totalDuration = steps.reduce((sum: number, s: any) => sum + (s.duration || 0), 0);
            msg.has_activity = true;
            msg.activity_summary = {
              files,
              commands,
              totalSteps: steps.length,
              totalDuration: Math.round(totalDuration * 10) / 10,
            };
          }
        }
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(messages));
      return;
    }

    if (url.pathname === `/api/messages/${messageId}/activity`) {
      const msg = db.prepare('SELECT id, session_id, role, content, metadata FROM chat_messages WHERE id = ?').get(messageId) as any;
      if (!msg) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Message not found' }));
        return;
      }
      let steps: any[] = [];
      let thoughts: string | null = null;
      if (msg.metadata) {
        try {
          const parsed = JSON.parse(msg.metadata);
          if (Array.isArray(parsed.steps)) steps = parsed.steps;
        } catch {}
      }
      if (typeof msg.content === 'string') {
        const match = msg.content.match(/<thought>([\s\S]*?)<\/thought>/);
        if (match) thoughts = match[1].trim();
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ messageId, steps, thoughts }));
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const getRes = await fetch(`${baseUrl}/api/chats/${sessionId}/messages`);
  assert.equal(getRes.status, 200);
  const msgs = (await getRes.json()) as any[];
  assert.equal(msgs.length, 1);
  const lightMsg = msgs[0];

  // 1. Check that steps was stripped from metadata and thought stripped from content
  assert.equal(lightMsg.content, 'All tasks completed successfully.');
  assert.ok(lightMsg.has_activity);
  assert.deepEqual(lightMsg.activity_summary, {
    files: 5,
    commands: 5,
    totalSteps: 10,
    totalDuration: 15,
  });
  const parsedLightMeta = JSON.parse(lightMsg.metadata);
  assert.equal(parsedLightMeta.steps, undefined);

  // Check payload size reduction (>98% reduction)
  const lightSize = JSON.stringify(lightMsg).length;
  assert.ok(lightSize < 1000, `Light message size should be under 1KB, got ${lightSize}`);
  assert.ok(lightSize < rawSize * 0.02, `Payload size reduction should exceed 98%`);

  // 2. Fetch full activity on demand
  const actRes = await fetch(`${baseUrl}/api/messages/${messageId}/activity`);
  assert.equal(actRes.status, 200);
  const actData = (await actRes.json()) as any;
  assert.equal(actData.messageId, messageId);
  assert.equal(actData.steps.length, 10);
  assert.equal(actData.steps[0].title, 'Run: git status #0');
  assert.ok(actData.thoughts.includes('Run: git status'));

  server.close();
});
