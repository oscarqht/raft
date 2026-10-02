import test from 'node:test';
import assert from 'node:assert/strict';
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const sessionData = { sessions: [{ tabId: 2, ownerOrigin: 'http://localhost:3000', origin: 'http://localhost:4000', ruleId: 42 }] };
const localData = { connectedOrigins: [] };
let rules = [{ id: 42 }];
let frames = [];
let measurement = { width: 1000, height: 800, rect: { x: 400, y: 100, width: 500, height: 500 } };
let onCapture = async () => {};
let drawn;
globalThis.createImageBitmap = async () => ({ width: 2000, height: 1600, close() {} });
globalThis.OffscreenCanvas = class { constructor(width, height) { this.width = width; this.height = height; } getContext() { return { drawImage(...args) { drawn = args; } }; } async convertToBlob() { return new Blob([new Uint8Array([1, 2, 3])]); } };
const tab = { id: 2, url: 'http://localhost:3000/task', windowId: 1, active: true };
const topSender = { tab, frameId: 0, url: tab.url };
const area = data => ({ async get() { return data; }, async set(value) { Object.assign(data, value); } });
globalThis.chrome = {
  storage: { session: area(sessionData), local: area(localData), onChanged: event() },
  permissions: { async contains() { return true; } },
  declarativeNetRequest: { async getSessionRules() { return rules; }, async updateSessionRules({ removeRuleIds = [], addRules = [] }) { rules = rules.filter(r => !removeRuleIds.includes(r.id)).concat(addRules); } },
  tabs: { async get() { return tab; }, async create() {}, async sendMessage() { return structuredClone(measurement); }, async captureVisibleTab() { await onCapture(); return 'data:image/png;base64,AA=='; }, onRemoved: event() },
  windows: { async get() { return { focused: true }; } },
  runtime: { onMessage: event(), getURL: value => 'chrome-extension://test/' + value },
  webNavigation: { onBeforeNavigate: event(), onCommitted: event(), onHistoryStateUpdated: event(), onReferenceFragmentUpdated: event(), async getAllFrames() { return frames; } },
};
await import('../src/background.js');
function request(action, payload, sender = topSender) {
  return new Promise(resolve => chrome.runtime.onMessage.listeners[0]({ type: 'page', action, payload, viewport: { width: 1000, height: 800 } }, sender, resolve));
}
test('pairing, session replacement, exact tab rules and stale-session rejection', async () => {
  assert.deepEqual((await request('hello')).result, { connected: false, permissions: true, version: 1 });
  assert.equal((await request('registerPreview', { sessionId: 'a', taskId: 'task', url: 'http://localhost:4000' })).error.code, 'NOT_CONNECTED');
  assert.equal(rules.length, 0, 'unpaired restored sessions lose their rules');
  localData.connectedOrigins = ['http://localhost:3000'];
  assert.equal((await request('registerPreview', { sessionId: 'a', taskId: 'task', url: 'http://localhost:4000' })).ok, true);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].condition.tabIds, [2]);
  await request('registerPreview', { sessionId: 'b', taskId: 'next', url: 'http://localhost:5000' });
  assert.equal(rules.length, 1);
  assert.match(rules[0].condition.regexFilter, /5000/);
  assert.equal((await request('capture', { sessionId: 'a' })).error.code, 'PREVIEW_NOT_READY');
  await request('unregisterPreview', { sessionId: 'a' });
  assert.equal(rules.length, 1, 'stale unregistration cannot remove new preview');
  assert.equal((await request('hello', {}, { ...topSender, frameId: 4 })).error.code, 'NOT_CONNECTED');
  await request('unregisterPreview', { sessionId: 'b' });
  assert.equal(rules.length, 0);
});

test('capture crops correctly and rejects tab, layout and task races', async () => {
  await request('registerPreview', { sessionId: 'capture', taskId: 'task', url: 'http://localhost:4000/' });
  frames = [{ frameId: 7, parentFrameId: 0, url: 'http://localhost:4000/' }];
  const payload = { sessionId: 'capture', url: 'http://localhost:4000/', rect: { ...measurement.rect }, viewport: { width: 1000, height: 800 } };
  const success = await request('capture', payload);
  assert.equal(success.ok, true);
  assert.equal(success.result.width, 1000);
  assert.equal(success.result.height, 1000);
  assert.deepEqual(drawn.slice(1), [800, 200, 1000, 1000, 0, 0, 1000, 1000]);
  tab.active = false;
  assert.equal((await request('capture', payload)).error.code, 'TAB_NOT_ACTIVE');
  tab.active = true;
  onCapture = async () => { measurement.rect.x += 10; };
  assert.equal((await request('capture', payload)).error.code, 'STALE_VIEWPORT');
  measurement.rect.x -= 10;
  onCapture = async () => { await request('registerPreview', { sessionId: 'replacement', taskId: 'next', url: 'http://localhost:4000/' }); };
  assert.equal((await request('capture', payload)).error.code, 'STALE_SESSION');
});

test('explicitly paired Tailscale owner can register only a loopback preview', async () => {
  const remoteSender = { tab: { ...tab, id: 8, url: 'http://100.64.1.2:3000/task' }, frameId: 0, url: 'http://100.64.1.2:3000/task' };
  const preview = { sessionId: 'tailscale', taskId: 'task', url: 'http://localhost:4000/' };
  assert.equal((await request('registerPreview', preview, remoteSender)).error.code, 'NOT_CONNECTED');
  localData.connectedOrigins.push('http://100.64.1.2:3000');
  assert.equal((await request('hello', {}, remoteSender)).result.connected, true);
  assert.equal((await request('registerPreview', preview, remoteSender)).ok, true);
  assert.equal((await request('registerPreview', { ...preview, url: 'http://100.64.1.2:4000/' }, remoteSender)).error.code, 'INVALID_URL');
});
