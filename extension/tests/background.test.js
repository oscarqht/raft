import test from 'node:test';
import assert from 'node:assert/strict';
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const sessionData = { sessions: [{ tabId: 2, ownerOrigin: 'http://localhost:3000', origin: 'http://localhost:4000', ruleId: 42 }] };
let rules = [{ id: 42 }];
let frames = [];
let measurement = { width: 1000, height: 800, rect: { x: 400, y: 100, width: 500, height: 500 } };
let onCapture = async () => {};
let drawn;
let markedFrameId = 7;
const navigationMessages = [];
const commands = [];
const iconChanges = [];
let iconFailure = false;
let navigationFlags = { navigationAvailable: true, canGoBack: true, canGoForward: false };
globalThis.createImageBitmap = async () => ({ width: 2000, height: 1600, close() {} });
globalThis.OffscreenCanvas = class { constructor(width, height) { this.width = width; this.height = height; } getContext() { return { drawImage(...args) { drawn = args; } }; } async convertToBlob() { return new Blob([new Uint8Array([1, 2, 3])]); } };
const tab = { id: 2, url: 'http://localhost:3300/task', windowId: 1, active: true };
const topSender = { tab, frameId: 0, url: tab.url };
const area = data => ({ async get() { return data; }, async set(value) { Object.assign(data, value); } });
globalThis.chrome = {
  action: { async setIcon(details) { iconChanges.push(details); if (iconFailure) throw new Error("Icon unavailable"); } },
  storage: { session: area(sessionData),  },
  permissions: { async contains() { return true; } },
  declarativeNetRequest: { async getSessionRules() { return rules; }, async updateSessionRules({ removeRuleIds = [], addRules = [] }) { rules = rules.filter(r => !removeRuleIds.includes(r.id)).concat(addRules); } },
  tabs: { async get() { return tab; }, async create() {}, async sendMessage(tabId, message, options) {
    if (message.type === 'identify') {
      if (options.frameId === markedFrameId) chrome.runtime.onMessage.listeners[0]({ type: 'identified', token: message.token, sessionId: message.sessionId }, { tab: { ...tab, id: tabId }, frameId: 0, url: tab.url }, () => {});
      return {};
    }
    if (message.type === 'navigationState') return { url: frames.find(frame => frame.frameId === options.frameId)?.url, ...navigationFlags };
    if (message.type === 'event') { navigationMessages.push(message.message); return; }
    if (message.type === 'navigate') { commands.push({ ...message, frameId: options.frameId }); return; }
    return structuredClone(measurement);
  }, async captureVisibleTab() { await onCapture(); return 'data:image/png;base64,AA=='; }, onRemoved: event() },
  windows: { async get() { return { focused: true }; } },
  runtime: { onMessage: event(), getURL: value => 'chrome-extension://test/' + value },
  webNavigation: { onBeforeNavigate: event(), onCommitted: event(), onHistoryStateUpdated: event(), onReferenceFragmentUpdated: event(), async getAllFrames() { return frames; }, async getFrame({ frameId }) { return frames.find(frame => frame.frameId === frameId); } },
};
await import('../src/background.js');
function request(action, payload, sender = topSender) {
  return new Promise(resolve => chrome.runtime.onMessage.listeners[0]({ type: 'page', action, payload, viewport: { width: 1000, height: 800 } }, sender, resolve));
}
test('session replacement, exact tab rules and stale-session rejection', async () => {
  assert.deepEqual((await request('hello')).result, { connected: true, permissions: true, version: 1 });
  assert.equal(rules.length, 0, 'restored sessions from unsupported origins lose their rules');
  assert.equal((await request('registerPreview', { sessionId: 'a', taskId: 'task', url: 'http://localhost:4000' })).ok, true);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].condition.tabIds, [2]);
  await request('registerPreview', { sessionId: 'b', taskId: 'next', url: 'http://localhost:5000' });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].condition.regexFilter, '^https?://');
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

test('port 3300 auto-connects every HTTP(S) host but only registers local previews', async () => {
  const origins = ['http://localhost:3300', 'http://100.64.1.2:3300', 'https://bro.example.com:3300'];
  let tabId = 30;
  for (const origin of origins) {
    const sender = { tab: { ...tab, id: tabId++, url: origin + '/task' }, frameId: 0, url: origin + '/task' };
    const preview = { sessionId: origin, taskId: 'task', url: 'http://localhost:4000/' };
    assert.equal((await request('hello', {}, sender)).result.connected, true);
    assert.equal((await request('registerPreview', preview, sender)).ok, true);
    assert.equal((await request('registerPreview', { ...preview, url: 'https://example.com:4000/' }, sender)).error.code, 'INVALID_URL');
  }
  const otherPort = { tab: { ...tab, id: 40, url: 'http://localhost:3301/' }, frameId: 0, url: 'http://localhost:3301/' };
  assert.equal((await request('hello', {}, otherPort)).result.connected, false);
  assert.equal((await request('registerPreview', { sessionId: 'other', taskId: 'task', url: 'http://localhost:4000/' }, otherPort)).error.code, 'NOT_CONNECTED');
  const invalidScheme = { ...otherPort, url: 'ftp://localhost:3300/' };
  assert.equal((await request('hello', {}, invalidScheme)).error.code, 'INVALID_URL');
});

test('tab navigation and closure remove only their preview session rules', async () => {
  chrome.webNavigation.onBeforeNavigate.listeners[0]({ tabId: 30, frameId: 0 });
  // A subsequent serialized operation waits for navigation cleanup.
  await request('unregisterPreview', { sessionId: 'unrelated' }, { tab: { ...tab, id: 31 }, frameId: 0, url: 'http://100.64.1.2:3300/' });
  assert.ok(!rules.some(rule => rule.condition.tabIds.includes(30)));
  assert.ok(rules.some(rule => rule.condition.tabIds.includes(31)));
  chrome.tabs.onRemoved.listeners[0](31);
  await request('unregisterPreview', { sessionId: 'unrelated' });
  assert.ok(!rules.some(rule => rule.condition.tabIds.includes(31)));
  assert.ok(rules.some(rule => rule.condition.tabIds.includes(32)));
  assert.equal((await request('openSetup')).error.code, 'INVALID_COMMAND');
});

test('marked iframe can initially redirect externally, navigate and capture while siblings/nested stay unbound', async () => {
  onCapture = async () => {};
  await request('registerPreview', { sessionId: 'external', taskId: 'task', url: 'http://localhost:4000/' });
  frames = [
    { frameId: 7, parentFrameId: 0, url: 'https://login.example.com/auth' },
    { frameId: 9, parentFrameId: 0, url: 'https://sibling.example.com/' },
    { frameId: 10, parentFrameId: 7, url: 'https://nested.example.com/' },
  ];
  const reportFrame = async (frameId) => {
    const current = frames.find(frame => frame.frameId === frameId);
    chrome.runtime.onMessage.listeners[0]({ type: 'frameReady' }, { tab, frameId, url: current.url }, () => {});
    await new Promise(resolve => setTimeout(resolve, 750));
  };
  navigationMessages.length = 0;
  await reportFrame(9);
  await reportFrame(10);
  assert.equal(navigationMessages.length, 0);
  await reportFrame(7);
  assert.equal(navigationMessages.at(-1).payload.url, 'https://login.example.com/auth');
  assert.equal(navigationMessages.at(-1).payload.canGoBack, true);
  assert.equal(navigationMessages.at(-1).payload.canGoForward, true, 'cross-origin forward bounds are unknown, so native attempts remain available');
  const captured = await request('capture', { sessionId: 'external', url: frames[0].url, rect: measurement.rect, viewport: { width: 1000, height: 800 } });
  assert.equal(captured.ok, true);
  assert.equal(captured.result.url, 'https://login.example.com/auth');
  assert.equal((await request('navigate', { sessionId: 'external', command: 'to', path: 'https://app.example.org/done' })).ok, true);
  assert.equal(commands.at(-1).frameId, 7);
  assert.equal(commands.at(-1).url, 'https://app.example.org/done');
  assert.equal((await request('navigate', { sessionId: 'external', command: 'to', path: 'javascript:alert(1)' })).error.code, 'INVALID_URL');
  onCapture = async () => { frames[0] = { ...frames[0], url: 'https://app.example.org/done' }; };
  assert.equal((await request('capture', { sessionId: 'external', url: 'https://login.example.com/auth', rect: measurement.rect, viewport: { width: 1000, height: 800 } })).error.code, 'STALE_SESSION');
  await request('unregisterPreview', { sessionId: 'external' });
  assert.ok(!rules.some(rule => rule.condition.tabIds.includes(tab.id)));
});

test('same-origin bounds remain precise but unavailable Navigation API enables native history attempts', async () => {
  await request('registerPreview', { sessionId: 'bounds', taskId: 'task', url: 'http://localhost:4000/' });
  frames = [{ frameId: 7, parentFrameId: 0, url: 'http://localhost:4000/' }];
  const report = async () => {
    chrome.runtime.onMessage.listeners[0]({ type: 'frameReady' }, { tab, frameId: 7, url: frames[0].url }, () => {});
    await new Promise(resolve => setTimeout(resolve, 10));
    return navigationMessages.at(-1).payload;
  };
  navigationFlags = { navigationAvailable: true, canGoBack: false, canGoForward: false };
  const known = await report();
  assert.equal(known.canGoBack, false);
  assert.equal(known.canGoForward, false);
  navigationFlags.navigationAvailable = false;
  const unknown = await report();
  assert.equal(unknown.canGoBack, true);
  assert.equal(unknown.canGoForward, true);
  navigationFlags.navigationAvailable = true;
  frames[0].url = 'https://auth.example.com/';
  const external = await report();
  assert.equal(external.canGoBack, true);
  assert.equal(external.canGoForward, true);
  frames[0].url = 'http://localhost:4000/callback';
  const callback = await report();
  assert.equal(callback.canGoBack, true, 'origin crossing remains known after returning locally');
  assert.equal(callback.canGoForward, true);
});


test('capture icon stays busy through overlapping requests and restores after success or failure', { timeout: 3000 }, async () => {
  await request('registerPreview', { sessionId: 'icons', taskId: 'task', url: 'http://localhost:4000/' });
  frames = [{ frameId: 7, parentFrameId: 0, url: 'http://localhost:4000/' }];
  const payload = { sessionId: 'icons', url: frames[0].url, rect: { ...measurement.rect }, viewport: { width: 1000, height: 800 } };
  iconChanges.length = 0;
  const releases = [];
  let entered;
  onCapture = () => new Promise(resolve => { releases.push(resolve); entered(); });
  let started = new Promise(resolve => { entered = resolve; });
  const first = request('capture', payload);
  await started;
  assert.deepEqual(iconChanges, [{ tabId: tab.id, path: { 128: 'icons/capturing128.png' } }]);
  started = new Promise(resolve => { entered = resolve; });
  const second = request('capture', payload);
  await started;
  releases[0]();
  assert.equal((await first).ok, true);
  assert.equal(iconChanges.length, 1, 'first completion cannot clear another capture indicator');
  releases[1]();
  assert.equal((await second).ok, true);
  assert.deepEqual(iconChanges.at(-1), { tabId: tab.id, path: { 128: 'icons/icon128.png' } });

  onCapture = async () => { throw new Error('Capture failed'); };
  assert.equal((await request('capture', payload)).error.message, 'Capture failed');
  assert.equal(iconChanges.at(-1).path[128], 'icons/icon128.png');
  tab.active = false;
  assert.equal((await request('capture', payload)).error.code, 'TAB_NOT_ACTIVE');
  assert.equal(iconChanges.at(-1).path[128], 'icons/icon128.png');
  tab.active = true;
  onCapture = async () => {};
  iconFailure = true;
  try { assert.equal((await request('capture', payload)).ok, true, 'cosmetic icon failures must not prevent capture'); }
  finally { iconFailure = false; }
});
