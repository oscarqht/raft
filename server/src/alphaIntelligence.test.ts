import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './index.js';
import { db } from './db.js';
import { normalizeAlphaApiUrl, isDeviceSelectionInput } from './alphaAgentRunner.js';
import { getAvailableClis, getModelsForCli } from './agentRunner.js';
import { alphaDeviceService } from './alphaDeviceService.js';

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

test.after(() => {
  alphaDeviceService.disconnect();
  db.prepare('DELETE FROM settings WHERE key LIKE ?').run('alpha_intelligence_%');
});
