import test from 'node:test';
import assert from 'node:assert/strict';
import { localUrl, ownerUrl, embeddingRule, cropBounds } from '../src/core.js';
test('loopback validation rejects remote origins and credentials', () => {
  for (const value of ['http://localhost:123/', 'http://127.0.0.1:123/', 'http://[::1]:123/']) assert.ok(localUrl(value));
  for (const value of ['https://localhost.evil.test/', 'http://user:secret@localhost/', 'file:///etc/passwd', 'http://100.1.2.3:123/']) assert.throws(() => localUrl(value));
});
test('embedding rule is exact origin and subframe scoped', () => {
  const rule = embeddingRule(1, 7, 'http://127.0.0.1:4000');
  const match = new RegExp(rule.condition.regexFilter);
  assert.ok(match.test('http://127.0.0.1:4000/page'));
  assert.ok(!match.test('http://127.0.0.1:40001/page'));
  assert.ok(!match.test('http://127X0X0X1:4000/page'));
  assert.deepEqual(rule.condition.tabIds, [7]);
  assert.deepEqual(rule.condition.resourceTypes, ['sub_frame']);
});
test('crop uses captured pixel scale and rejects viewport changes or partial preview', () => {
  const rect = { x: 300, y: 50, width: 600, height: 500 };
  const viewport = { width: 1200, height: 800 };
  assert.deepEqual(cropBounds(rect, viewport, { width: 2400, height: 1600 }), { x: 600, y: 100, width: 1200, height: 1000 });
  assert.throws(() => cropBounds({ ...rect, width: 1000 }, viewport, viewport), { code: 'INVALID_BOUNDS' });
  assert.throws(() => cropBounds(rect, viewport, { width: 2400, height: 1200 }), { code: 'STALE_VIEWPORT' });
});

test('owner pages may use Tailscale HTTP or HTTPS but reject other schemes and credentials', () => {
  assert.equal(ownerUrl('http://100.64.1.2:3000/task').origin, 'http://100.64.1.2:3000');
  assert.equal(ownerUrl('https://bro.tailnet.ts.net/task').origin, 'https://bro.tailnet.ts.net');
  assert.throws(() => ownerUrl('file:///example'));
  assert.throws(() => ownerUrl('http://secret@example.com'));
});
