import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './index.js';
import { db, setSetting } from './db.js';
import {
  normalizeAlphaApiUrl,
  isDeviceSelectionInput,
  buildAlphaPromptWithContext,
  executeAlphaAuxiliaryJob,
  runAlphaIntelligenceTurn,
  AlphaConversationExpiredError,
  isAlphaConversationExpiredError,
} from './alphaAgentRunner.js';
import { getAvailableClis, getModelsForCli, formatConversationHistory } from './agentRunner.js';
import { alphaDeviceService, isTokenExpiring } from './alphaDeviceService.js';

test('normalizes Alpha Intelligence API URLs correctly', () => {
  assert.equal(
    normalizeAlphaApiUrl('https://alpha.example.com/api/superagents/agent-123'),
    'https://alpha.example.com/api/superagents/agent-123/run?stream=true'
  );
  assert.equal(
    normalizeAlphaApiUrl('https://alpha.example.com/api/chatflows/chatflow-456/run'),
    'https://alpha.example.com/api/chatflows/chatflow-456/run?stream=true'
  );
  assert.equal(
    normalizeAlphaApiUrl('https://alpha.example.com/api/chatflows/chatflow-456/run/'),
    'https://alpha.example.com/api/chatflows/chatflow-456/run?stream=true'
  );
  assert.equal(
    normalizeAlphaApiUrl('https://ai.insea.io/api/superagents/27785/run?stream=true'),
    'https://ai.insea.io/api/superagents/27785/run?stream=true'
  );
  assert.equal(
    normalizeAlphaApiUrl('https://ai.insea.io/api/superagents/27785/run/dev?stream=true'),
    'https://ai.insea.io/api/superagents/27785/run/dev?stream=true'
  );
  assert.equal(
    normalizeAlphaApiUrl('https://ai.insea.io/superagents/27785'),
    'https://ai.insea.io/api/superagents/27785/run?stream=true'
  );
  assert.equal(
    normalizeAlphaApiUrl('https://ai.insea.io/app/superagents/27785'),
    'https://ai.insea.io/api/superagents/27785/run?stream=true'
  );
  assert.equal(
    normalizeAlphaApiUrl('https://ai.insea.io/chatflows/12345'),
    'https://ai.insea.io/api/chatflows/12345/run?stream=true'
  );
});

test('detects AlphaMouse device selection prompt accurately', () => {
  const devicePrompt = {
    widget: {
      elements: [
        {
          type: 'button_group',
          button_group: [
            { label: 'MacBook Pro', value: 'client_1', client_type: 1 },
            { label: 'Cloud Runner', value: 'client_2', client_type: 2 },
          ],
        },
      ],
    },
  };
  assert.equal(isDeviceSelectionInput(devicePrompt), true);

  const normalPrompt = {
    widget: {
      elements: [
        {
          type: 'button_group',
          button_group: [
            { label: 'Approve', value: 'yes' },
            { label: 'Reject', value: 'no' },
          ],
        },
      ],
    },
  };
  assert.equal(isDeviceSelectionInput(normalPrompt), false);

  assert.equal(isDeviceSelectionInput(null), false);
  assert.equal(isDeviceSelectionInput({}), false);
});

test('exposes Alpha Intelligence settings and status via REST endpoints', async () => {
  const testServer = app.listen(0);
  const port = (testServer.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    const putRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alpha_intelligence_api_url: 'https://alpha.test.com/api/superagents/test-agent',
        alpha_intelligence_api_key: 'test-bearer-token',
      }),
    });
    assert.equal(putRes.status, 200);
    const putData = await putRes.json() as any;
    assert.equal(putData.success, true);

    const getRes = await fetch(`${baseUrl}/api/settings`);
    assert.equal(getRes.status, 200);
    const settings = await getRes.json() as any;
    assert.equal(settings.alpha_intelligence_api_url, 'https://alpha.test.com/api/superagents/test-agent');
    assert.equal(settings.alpha_intelligence_api_key, 'test-bearer-token');

    const statusRes = await fetch(`${baseUrl}/api/alpha/status`);
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json() as any;
    assert.equal(statusData.configured, true);
    assert.equal(statusData.apiUrl, 'https://alpha.test.com/api/superagents/test-agent');
    assert.ok(statusData.device);
    assert.ok('connected' in statusData.device);
    assert.ok('status' in statusData.device);
  } finally {
    testServer.close();
  }
});

test('includes Alpha in getAvailableClis when credentials configured', () => {
  const clis = getAvailableClis();
  const alphaCli = clis.find((c) => c.name === 'alpha');
  assert.ok(alphaCli, 'Alpha CLI should be registered in CLIs list');
  assert.equal(alphaCli.available, true);
  assert.equal(alphaCli.isCloudProvider, true);
  assert.equal(alphaCli.installGuide, undefined);
});

test('returns latest version model for alpha CLI', async () => {
  const models = await getModelsForCli('alpha');
  assert.ok(Array.isArray(models));
  assert.equal(models.length, 1);
  assert.equal(models[0].id, 'latest');
  assert.equal(models[0].name, 'Latest Version (Alpha Intelligence)');
});

test('supports active worktree switching in alphaDeviceService', () => {
  alphaDeviceService.setActiveWorktree('/tmp/test-worktree');
  assert.equal(alphaDeviceService.getActiveWorktree(), '/tmp/test-worktree');
});

test('buildAlphaPromptWithContext formats complete workspace context and guidance', () => {
  const result = buildAlphaPromptWithContext('Fix the authentication bug', {
    projectName: 'my-project',
    taskName: 'Task #42 - Fix auth',
    worktreePath: '/Users/test/projects/my-project-worktree',
    branch: 'fix-auth',
    baseBranch: 'main',
    systemPrompt: 'Always write unit tests before finishing.',
  });

  assert.ok(result.includes('[Project & Task Context]'));
  assert.ok(result.includes('- Project: my-project'));
  assert.ok(result.includes('- Task: Task #42 - Fix auth'));
  assert.ok(result.includes('- Working Directory: /Users/test/projects/my-project-worktree'));
  assert.ok(result.includes('- Git Branch: fix-auth (base: main)'));
  assert.ok(result.includes('[Project Instructions]\nAlways write unit tests before finishing.'));
  assert.ok(result.includes('[Workspace Execution Guidance]'));
  assert.ok(result.includes('run_command'));
  assert.ok(result.includes('/Users/test/projects/my-project-worktree'));
  assert.ok(result.includes('[User Request]\nFix the authentication bug'));
});

test('buildAlphaPromptWithContext formats cleanly without project system prompt', () => {
  const result = buildAlphaPromptWithContext('Show files', {
    projectName: 'simple-project',
    taskName: 'Explore repo',
    worktreePath: '/Users/test/projects/simple-project',
    branch: 'main',
    baseBranch: 'main',
  });

  assert.ok(result.includes('[Project & Task Context]'));
  assert.ok(result.includes('- Project: simple-project'));
  assert.ok(!result.includes('[Project Instructions]'));
  assert.ok(result.includes('[Workspace Execution Guidance]'));
  assert.ok(result.includes('[User Request]\nShow files'));
});

test('buildAlphaPromptWithContext formats subsequent chat turn reminder', () => {
  const result = buildAlphaPromptWithContext('Can you also add tests?', {
    worktreePath: '/Users/test/projects/my-project-worktree',
    branch: 'feat-new-stuff',
    isAlpha: true,
    isSubsequentTurn: true,
  });

  assert.ok(result.includes('[Active Workspace Reminder]'));
  assert.ok(result.includes('Working Directory: /Users/test/projects/my-project-worktree'));
  assert.ok(result.includes('Branch: feat-new-stuff'));
  assert.ok(!result.includes('[Workspace Execution Guidance]'));
  assert.ok(result.includes('[User Request]\nCan you also add tests?'));
});

test('buildAlphaPromptWithContext omits Alpha execution guidance when isAlpha is false', () => {
  const result = buildAlphaPromptWithContext('Refactor code', {
    projectName: 'other-project',
    taskName: 'Refactor task',
    worktreePath: '/Users/test/projects/other-project',
    branch: 'refactor-1',
    baseBranch: 'main',
    isAlpha: false,
  });

  assert.ok(result.includes('[Project & Task Context]'));
  assert.ok(result.includes('- Project: other-project'));
  assert.ok(!result.includes('[Workspace Execution Guidance]'));
  assert.ok(result.includes('[User Request]\nRefactor code'));
});

test('buildAlphaPromptWithContext formats custom jobRequirementTitle for auxiliary tasks', () => {
  const result = buildAlphaPromptWithContext('Inspect repository and return JSON', {
    projectName: 'aux-project',
    worktreePath: '/Users/test/projects/aux-project',
    isAlpha: true,
    jobRequirementTitle: 'Job Requirement: Auto-Discover Project Settings and Scripts',
  });

  assert.ok(result.includes('[Project & Task Context]'));
  assert.ok(result.includes('[Job Requirement: Auto-Discover Project Settings and Scripts]\nInspect repository and return JSON'));
  assert.ok(!result.includes('[User Request]'));
});

test('executeAlphaAuxiliaryJob throws error if API URL or Key is not configured', async () => {
  db.prepare('DELETE FROM settings WHERE key LIKE ?').run('alpha_intelligence_%');
  await assert.rejects(
    () => executeAlphaAuxiliaryJob({
      prompt: 'Do something',
      worktreePath: '/tmp/test',
    }),
    /Alpha Intelligence is not configured/
  );
});

test('executeAlphaAuxiliaryJob throws error if device bridge is not connected', async () => {
  setSetting('alpha_intelligence_api_url', 'https://ai.insea.io/api/superagents/123/run?stream=true');
  setSetting('alpha_intelligence_api_key', 'test-key');
  alphaDeviceService.disconnect();

  await assert.rejects(
    () => executeAlphaAuxiliaryJob({
      prompt: 'Do something',
      worktreePath: '/tmp/test',
    }),
    /Alpha Intelligence device bridge is not connected/
  );
});

test('isTokenExpiring correctly identifies expired or near-expiry tokens', () => {
  const now = Math.floor(Date.now() / 1000);
  // Token expired in the past
  assert.equal(isTokenExpiring(now - 100), true);
  // Token expiring in 2 minutes (within 300s window)
  assert.equal(isTokenExpiring(now + 120), true);
  // Token expiring in 10 minutes (outside 300s window)
  assert.equal(isTokenExpiring(now + 600), false);
  // Missing expiry
  assert.equal(isTokenExpiring(undefined), false);
});

test('alphaDeviceService truncates large command output to prevent exceeding 1MB limit', async () => {
  // Command that prints 500,000 bytes of output
  const res = await (alphaDeviceService as any).executeCommand({
    command: 'node -e "process.stdout.write(Buffer.alloc(500000, 65).toString())"',
  });

  assert.equal(res.exitCode, 0);
  assert.ok(res.stdout.length <= 400000, `Output should be clamped, got ${res.stdout.length}`);
  assert.ok(res.stdout.includes('[stdout truncated: exceeded maximum capture limit'));
});

test('alphaDeviceService refreshes token via refresh endpoint', async () => {
  alphaDeviceService.disconnect();
  const http = await import('node:http');
  let refreshCalled = false;
  let receivedRefreshToken = '';

  const server = http.createServer((req, res) => {
    if (req.url === '/webapi/client/auth/refresh' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        refreshCalled = true;
        const parsed = JSON.parse(body);
        receivedRefreshToken = parsed.refreshToken;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          token: 'refreshed-jwt-access-token',
          refreshToken: 'refreshed-refresh-token',
          tokenExpiresAt: Math.floor(Date.now() / 1000) + 7200,
          refreshTokenExpiresAt: Math.floor(Date.now() / 1000) + 2592000,
          client: {
            clientId: 'client_test123',
            name: 'Raft Test Client',
          },
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  (alphaDeviceService as any).baseUrl = `http://localhost:${port}`;

  try {
    const refreshed = await alphaDeviceService.refreshTokens('old-refresh-token-xyz');
    assert.ok(refreshed);
    assert.equal(refreshCalled, true);
    assert.equal(receivedRefreshToken, 'old-refresh-token-xyz');
    assert.equal(refreshed.token, 'refreshed-jwt-access-token');
    assert.equal(refreshed.refreshToken, 'refreshed-refresh-token');
    assert.equal(alphaDeviceService.getClientId(), 'client_test123');
  } finally {
    server.close();
    (alphaDeviceService as any).baseUrl = '';
  }
});

test('isAlphaConversationExpiredError accurately detects 410 and CONVERSATION_EXPIRED', () => {
  // Direct AlphaConversationExpiredError instance
  const errInstance = new AlphaConversationExpiredError('conversation is expired', 'conv_123', 410);
  assert.equal(isAlphaConversationExpiredError(errInstance), true);

  // Exact user error string: HTTP 410 with CONVERSATION_EXPIRED json
  const exactErrorStr = 'Alpha Intelligence API returned HTTP 410: {"error":{"code":"CONVERSATION_EXPIRED","message":"conversation is expired"},"request_id":"3f34cb54eff34812"}';
  assert.equal(isAlphaConversationExpiredError(exactErrorStr), true);
  assert.equal(isAlphaConversationExpiredError(new Error(exactErrorStr)), true);

  // Partial match variations
  assert.equal(isAlphaConversationExpiredError('Error: CONVERSATION_EXPIRED'), true);
  assert.equal(isAlphaConversationExpiredError('Error: conversation is expired on remote server'), true);

  // Non-expired errors should be false
  assert.equal(isAlphaConversationExpiredError(new Error('Alpha Intelligence API returned HTTP 500: internal server error')), false);
  assert.equal(isAlphaConversationExpiredError(new Error('Alpha Intelligence API returned HTTP 401: Unauthorized')), false);
  assert.equal(isAlphaConversationExpiredError(new Error('getaddrinfo ENOTFOUND alpha.example.com')), false);
  assert.equal(isAlphaConversationExpiredError(null), false);
  assert.equal(isAlphaConversationExpiredError(undefined), false);
});

test('formatConversationHistory extracts turns and strips thoughts', () => {
  const history = formatConversationHistory([
    { role: 'user', content: 'Can you implement authentication?' },
    { role: 'assistant', content: '<thought>\nChecking code...\n</thought>\nSure, I will create the auth module.' },
    { role: 'user', content: 'Also add JWT verification' },
  ], 5);

  assert.ok(history.includes('User: Can you implement authentication?'));
  assert.ok(history.includes('Assistant: Sure, I will create the auth module.'));
  assert.ok(history.includes('User: Also add JWT verification'));
  assert.ok(!history.includes('<thought>'));
  assert.ok(!history.includes('Checking code...'));
});

test('buildAlphaPromptWithContext formats complete recovery context with history and recovery notice', () => {
  const historyText = 'User: Implement login\n\nAssistant: Login implemented.';
  const prompt = buildAlphaPromptWithContext('Now add unit tests for login', {
    projectName: 'alpha-bro',
    taskName: 'Task #100 - Auth',
    worktreePath: '/Users/test/alpha-bro',
    branch: 'feature/auth',
    baseBranch: 'main',
    systemPrompt: 'Follow strict TypeScript conventions.',
    isAlpha: true,
    isSubsequentTurn: false,
    recoveryNotice: 'The previous Alpha Intelligence cloud session expired due to timeout. The dialogue history below summarizes recent progress in this task.',
    conversationHistory: historyText,
  });

  assert.ok(prompt.includes('[Project & Task Context]'));
  assert.ok(prompt.includes('- Project: alpha-bro'));
  assert.ok(prompt.includes('- Task: Task #100 - Auth'));
  assert.ok(prompt.includes('[Project Instructions]\nFollow strict TypeScript conventions.'));
  assert.ok(prompt.includes('[Workspace Execution Guidance]'));
  assert.ok(prompt.includes('[Session Recovery]\nThe previous Alpha Intelligence cloud session expired due to timeout.'));
  assert.ok(prompt.includes('[Previous Conversation History]\nUser: Implement login\n\nAssistant: Login implemented.'));
  assert.ok(prompt.includes('[User Request]\nNow add unit tests for login'));
});

test('runAlphaIntelligenceTurn throws AlphaConversationExpiredError on HTTP 410 response', async () => {
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    res.writeHead(410, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: { code: 'CONVERSATION_EXPIRED', message: 'conversation is expired' },
      request_id: 'test-req-expired-123',
    }));
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const mockApiUrl = `http://localhost:${port}/api/superagents/agent-1/run?stream=true`;

  try {
    await assert.rejects(
      () => runAlphaIntelligenceTurn({
        apiUrl: mockApiUrl,
        apiKey: 'test-api-key',
        prompt: 'Hello again',
        conversationId: 'expired-conv-999',
        sessionId: 'session-123',
        messageId: 'msg-123',
        onEvent: () => {},
      }),
      (err: any) => {
        assert.ok(err instanceof AlphaConversationExpiredError);
        assert.equal(err.status, 410);
        assert.equal(err.conversationId, 'expired-conv-999');
        assert.ok(isAlphaConversationExpiredError(err));
        return true;
      }
    );
  } finally {
    server.close();
  }
});

test('auto-recovery pattern on expired conversation recovers and establishes new conversation', async () => {
  const http = await import('node:http');
  let requestCount = 0;
  const receivedBodies: any[] = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requestCount++;
      const parsed = body ? JSON.parse(body) : {};
      receivedBodies.push(parsed);

      if (parsed.conversation_id === 'expired-session-id') {
        // First attempt with expired conversation_id: returns 410 CONVERSATION_EXPIRED
        res.writeHead(410, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: { code: 'CONVERSATION_EXPIRED', message: 'conversation is expired' },
          request_id: 'req-expired-test',
        }));
        return;
      }

      // Second attempt without conversation_id (recovered session): succeeds with SSE stream
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });
      res.write('event: message.start\n');
      res.write('data: {"conversation_id": "new-cloud-session-555"}\n\n');
      res.write('event: message\n');
      res.write('data: {"message": {"type": "text", "text": "I remember the context! Continuing your task."}}\n\n');
      res.write('event: message.end\n');
      res.write('data: {}\n\n');
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const mockApiUrl = `http://localhost:${port}/api/superagents/agent-1/run?stream=true`;

  let activeConvId: string | undefined = 'expired-session-id';
  let capturedNewConvId: string | undefined;
  let receivedChunks = '';
  const eventsReceived: string[] = [];

  // Emulate the executeAlphaWithRecovery loop
  let retried = false;
  let currentPrompt = 'Fix the bug';

  while (true) {
    try {
      await runAlphaIntelligenceTurn({
        apiUrl: mockApiUrl,
        apiKey: 'test-key',
        prompt: currentPrompt,
        conversationId: activeConvId,
        sessionId: 'test-session',
        messageId: 'test-msg',
        onEvent: (ev) => {
          eventsReceived.push(ev.type);
          if (ev.type === 'chunk') {
            receivedChunks += ev.content;
          }
        },
        onConversationId: (convId) => {
          capturedNewConvId = convId;
          activeConvId = convId;
        },
      });
      break;
    } catch (err: any) {
      if (!retried && activeConvId && isAlphaConversationExpiredError(err)) {
        retried = true;
        // Invalidate dead ID
        activeConvId = undefined;
        // Rebuild recovery prompt
        currentPrompt = buildAlphaPromptWithContext('Fix the bug', {
          projectName: 'test-project',
          isAlpha: true,
          recoveryNotice: 'Previous session timed out.',
          conversationHistory: 'User: Start task\nAssistant: Started.',
        });
        continue;
      }
      throw err;
    }
  }

  try {
    assert.equal(requestCount, 2, 'Should have made 2 requests: 1 failed expired, 1 recovered');
    assert.equal(receivedBodies[0].conversation_id, 'expired-session-id');
    assert.equal(receivedBodies[1].conversation_id, undefined);
    assert.ok(receivedBodies[1].query.includes('[Session Recovery]'));
    assert.ok(receivedBodies[1].query.includes('[Previous Conversation History]'));
    assert.equal(capturedNewConvId, 'new-cloud-session-555');
    assert.equal(receivedChunks, 'I remember the context! Continuing your task.');
    assert.ok(eventsReceived.includes('chunk'));
    assert.ok(eventsReceived.includes('done'));
  } finally {
    server.close();
  }
});

test.after(() => {
  alphaDeviceService.disconnect();
  db.prepare('DELETE FROM settings WHERE key LIKE ?').run('alpha_intelligence_%');
});
