import test from 'node:test';
import assert from 'node:assert';
import { getAgentUsage, getAllAgentUsages, parseClaudeData, calculateDailyBudgetMetrics } from './usageService.js';

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

const monthlyCost = { currencyCode: 'USD', limit: 200, used: 26.44, period: 'Monthly cap' };

test('Claude monthly cap without a reset timestamp resets at the next UTC month', () => {
  const now = Date.parse('2026-10-01T09:24:18Z');
  const snapshot = parseClaudeData({ usage: { providerCost: monthlyCost } }, now);
  assert.strictEqual(snapshot.costLimit?.resetsAt, '2026-11-01T00:00:00.000Z');
  assert.ok(snapshot.costLimit?.resetDescription);
  assert.notStrictEqual(snapshot.costLimit?.resetDescription, 'Resets soon');
});

test('Claude monthly reset handles year rollover, leap years, and UTC boundaries', () => {
  for (const [now, expected] of [
    ['2026-12-15T00:00:00Z', '2027-01-01T00:00:00.000Z'],
    ['2028-02-29T12:00:00Z', '2028-03-01T00:00:00.000Z'],
    ['2026-11-01T07:59:59+08:00', '2026-11-01T00:00:00.000Z'],
    ['2026-11-01T08:00:00+08:00', '2026-12-01T00:00:00.000Z'],
  ]) {
    const snapshot = parseClaudeData({ usage: { providerCost: monthlyCost } }, Date.parse(now));
    assert.strictEqual(snapshot.costLimit?.resetsAt, expected);
  }
});

test('Claude keeps explicit provider reset dates and does not infer non-monthly resets', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const resetsAt = '2026-10-20T12:00:00Z';
  const explicit = parseClaudeData({ usage: { providerCost: { ...monthlyCost, resetsAt } } }, now);
  assert.strictEqual(explicit.costLimit?.resetsAt, resetsAt);
  const weekly = parseClaudeData({ usage: { providerCost: { ...monthlyCost, period: 'Weekly cap' } } }, now);
  assert.strictEqual(weekly.costLimit?.resetsAt, null);
  assert.strictEqual(weekly.costLimit?.resetDescription, null);
  const defaultMonthly = parseClaudeData({ usage: { providerCost: { limit: 200, used: 10 } } }, now);
  assert.strictEqual(defaultMonthly.costLimit?.resetsAt, '2026-11-01T00:00:00.000Z');
  assert.strictEqual(parseClaudeData({ usage: {} }, now).costLimit, null);
});

test('calculateDailyBudgetMetrics computes daily speed and remaining daily budget correctly', () => {
  // Cycle starts 2026-10-01T00:00:00Z and resets 2026-11-01T00:00:00Z (31 days total)
  const resetsAt = '2026-11-01T00:00:00.000Z';
  const now = Date.parse('2026-10-02T12:00:00Z'); // 1.5 days elapsed, 29.5 days remaining

  const metrics = calculateDailyBudgetMetrics(
    { limit: 200, used: 30, remaining: 170, resetsAt, period: 'Monthly cap' },
    now
  );

  assert.strictEqual(metrics.daysElapsed, 1.5);
  assert.strictEqual(metrics.daysRemaining, 29.5);
  // daily speed = 30 / 1.5 = 20.00
  assert.strictEqual(metrics.dailySpeed, 20);
  // remaining daily budget = 170 / 29.5 = 5.76
  assert.strictEqual(metrics.dailyRemainingBudget, 5.76);
});

test('calculateDailyBudgetMetrics clamps minimum elapsed days to 1 on Day 1 to avoid spikes', () => {
  const resetsAt = '2026-11-01T00:00:00.000Z';
  const now = Date.parse('2026-10-01T02:00:00Z'); // only 2 hours into cycle (0.083 days)

  const metrics = calculateDailyBudgetMetrics(
    { limit: 200, used: 6, remaining: 194, resetsAt, period: 'Monthly cap' },
    now
  );

  // effective elapsed days clamped to 1, so speed is 6 / 1 = 6.00 (not 72/day)
  assert.strictEqual(metrics.dailySpeed, 6);
  assert.ok(metrics.dailyRemainingBudget !== null && metrics.dailyRemainingBudget > 0);
});

test('calculateDailyBudgetMetrics returns 0 remaining daily budget when quota exhausted', () => {
  const resetsAt = '2026-11-01T00:00:00.000Z';
  const now = Date.parse('2026-10-15T00:00:00Z');

  const metrics = calculateDailyBudgetMetrics(
    { limit: 200, used: 200, remaining: 0, resetsAt, period: 'Monthly cap' },
    now
  );

  assert.strictEqual(metrics.dailyRemainingBudget, 0);
  assert.strictEqual(metrics.dailySpeed, 14.29); // 200 / 14 days
});

test('parseClaudeData populates dailySpeed and dailyRemainingBudget on costLimit', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const snapshot = parseClaudeData({ usage: { providerCost: { limit: 200, used: 30 } } }, now);
  assert.ok(snapshot.costLimit);
  assert.strictEqual(snapshot.costLimit.dailySpeed, 20);
  assert.strictEqual(snapshot.costLimit.dailyRemainingBudget, 5.76);
});

