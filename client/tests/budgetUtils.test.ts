import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDailyBudgetMetrics, getCycleStartDate } from '../src/utils/budget';

test('getCycleStartDate handles monthly cycles across different months and leap years', () => {
  // Nov 1 -> Oct 1
  const d1 = new Date('2026-11-01T00:00:00.000Z');
  assert.strictEqual(getCycleStartDate(d1, 'Monthly cap').toISOString(), '2026-10-01T00:00:00.000Z');

  // Jan 1 -> Dec 1 of previous year
  const d2 = new Date('2026-01-01T00:00:00.000Z');
  assert.strictEqual(getCycleStartDate(d2, 'Monthly credit limit').toISOString(), '2025-12-01T00:00:00.000Z');

  // March 31 in leap year (2024) -> Feb 29
  const d3 = new Date('2024-03-31T00:00:00.000Z');
  assert.strictEqual(getCycleStartDate(d3, 'Monthly cap').toISOString(), '2024-02-29T00:00:00.000Z');

  // March 31 in non-leap year (2025) -> Feb 28
  const d4 = new Date('2025-03-31T00:00:00.000Z');
  assert.strictEqual(getCycleStartDate(d4, 'Monthly cap').toISOString(), '2025-02-28T00:00:00.000Z');
});

test('getCycleStartDate handles weekly cycles', () => {
  const d = new Date('2026-10-15T12:00:00.000Z');
  assert.strictEqual(getCycleStartDate(d, 'Weekly cap').toISOString(), '2026-10-08T12:00:00.000Z');
});

test('calculateDailyBudgetMetrics computes expected burn rate and allowance', () => {
  const resetsAt = '2026-11-01T00:00:00.000Z';
  const now = Date.parse('2026-10-02T12:00:00.000Z'); // 1.5 days elapsed, 29.5 days left

  const metrics = calculateDailyBudgetMetrics(
    { limit: 1200, used: 60, remaining: 1140, resetsAt, period: 'Monthly credit limit' },
    now
  );

  assert.strictEqual(metrics.daysElapsed, 1.5);
  assert.strictEqual(metrics.daysRemaining, 29.5);
  assert.strictEqual(metrics.dailySpeed, 40); // 60 / 1.5
  assert.strictEqual(metrics.dailyRemainingBudget, 38.64); // 1140 / 29.5
});

test('calculateDailyBudgetMetrics clamps day 1 elapsed days to minimum 1 day', () => {
  const resetsAt = '2026-11-01T00:00:00.000Z';
  const now = Date.parse('2026-10-01T01:00:00.000Z'); // 1 hour elapsed (0.0416 days)

  const metrics = calculateDailyBudgetMetrics(
    { limit: 200, used: 5, remaining: 195, resetsAt, period: 'Monthly cap' },
    now
  );

  assert.strictEqual(metrics.dailySpeed, 5); // 5 / 1 day
  assert.ok(metrics.dailyRemainingBudget !== null && metrics.dailyRemainingBudget > 0);
});

test('calculateDailyBudgetMetrics returns 0 remaining daily budget when remaining is 0', () => {
  const resetsAt = '2026-11-01T00:00:00.000Z';
  const now = Date.parse('2026-10-10T00:00:00.000Z');

  const metrics = calculateDailyBudgetMetrics(
    { limit: 200, used: 200, remaining: 0, resetsAt, period: 'Monthly cap' },
    now
  );

  assert.strictEqual(metrics.dailyRemainingBudget, 0);
  assert.strictEqual(metrics.dailySpeed, 22.22); // 200 / 9 days
});

test('calculateDailyBudgetMetrics handles null/missing resetsAt gracefully', () => {
  const metrics = calculateDailyBudgetMetrics({ limit: 100, used: 10, remaining: 90 });
  assert.strictEqual(metrics.dailySpeed, null);
  assert.strictEqual(metrics.dailyRemainingBudget, null);
});
