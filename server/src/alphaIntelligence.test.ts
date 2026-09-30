import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './index.js';
import { db, setSetting } from './db.js';
import { normalizeAlphaApiUrl, isDeviceSelectionInput, buildAlphaPromptWithContext, executeAlphaAuxiliaryJob } from './alphaAgentRunner.js';
import { getAvailableClis, getModelsForCli } from './agentRunner.js';
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

test.after(() => {
  alphaDeviceService.disconnect();
  db.prepare('DELETE FROM settings WHERE key LIKE ?').run('alpha_intelligence_%');
});
