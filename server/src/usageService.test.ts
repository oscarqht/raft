import test from 'node:test';
import assert from 'node:assert';
import { getAgentUsage, getAllAgentUsages } from './usageService.js';

test('getAgentUsage returns a structured snapshot for codex', async () => {
  const snapshot = await getAgentUsage('codex', true);
  assert.strictEqual(snapshot.cli, 'codex');
  assert.strictEqual(snapshot.providerName, 'OpenAI Codex');
  assert.strictEqual(typeof snapshot.updatedAt, 'number');
  assert.strictEqual(typeof snapshot.isAvailable, 'boolean');

  if (snapshot.costLimit) {
    assert.ok(snapshot.costLimit.period?.includes('credit') || snapshot.costLimit.period?.includes('limit'));
    if (typeof snapshot.costLimit.usedPercent === 'number') {
      assert.ok(snapshot.costLimit.usedPercent >= 0 && snapshot.costLimit.usedPercent <= 100);
    }
  }
});

test('getAgentUsage returns a structured snapshot for agy', async () => {
  const snapshot = await getAgentUsage('agy', true);
  assert.strictEqual(snapshot.cli, 'agy');
  assert.strictEqual(snapshot.providerName, 'Antigravity');
  assert.strictEqual(typeof snapshot.updatedAt, 'number');

  if (snapshot.buckets && snapshot.buckets.length > 0) {
    const b = snapshot.buckets[0];
    assert.ok(typeof b.name === 'string');
    assert.ok(typeof b.remainingPercent === 'number');
    assert.ok(b.remainingPercent >= 0 && b.remainingPercent <= 100);
  }
});

test('getAgentUsage returns a structured snapshot for claude', async () => {
  const snapshot = await getAgentUsage('claude', true);
  assert.strictEqual(snapshot.cli, 'claude');
  assert.strictEqual(snapshot.providerName, 'Claude Code');
  assert.strictEqual(typeof snapshot.updatedAt, 'number');
});

test('getAgentUsage handles unsupported CLI gracefully', async () => {
  const snapshot = await getAgentUsage('unknown_ai_cli', true);
  assert.strictEqual(snapshot.cli, 'unknown_ai_cli');
  assert.strictEqual(snapshot.isAvailable, false);
  assert.ok(snapshot.error?.includes('Unsupported CLI provider'));
});

test('getAgentUsage excludes alpha from codexbar usage check', async () => {
  const snapshot = await getAgentUsage('alpha', true);
  assert.strictEqual(snapshot.cli, 'alpha');
  assert.strictEqual(snapshot.isAvailable, false);
  assert.ok(snapshot.error?.includes('CodexBar'));
});

test('getAllAgentUsages aggregates all known providers', async () => {
  const all = await getAllAgentUsages(true);
  assert.ok('codex' in all);
  assert.ok('agy' in all);
  assert.ok('claude' in all);
});
