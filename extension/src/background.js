import { VERSION, localUrl, ownerUrl, failure, embeddingRule, cropBounds } from './core.js';

const sessions = new Map();
let nextRuleId = 1;
const restored = (async () => {
  const saved = await chrome.storage.session.get('sessions');
  for (const session of saved.sessions || []) {
    try {
      const tab = await chrome.tabs.get(session.tabId);
      if (new URL(tab.url).origin === session.ownerOrigin && await connected(session.ownerOrigin) && await permitted()) {
        sessions.set(session.tabId, session);
        nextRuleId = Math.max(nextRuleId, session.ruleId + 1);
      }
    } catch { /* Closed tabs cannot keep a preview session. */ }
  }
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map(rule => rule.id), addRules: [...sessions.values()].map(s => embeddingRule(s.ruleId, s.tabId, s.origin)) });
})();
let mutation = Promise.resolve();
function serial(fn) {
  const result = mutation.then(() => restored).then(fn);
  mutation = result.catch(() => {});
  return result;
}
const save = () => chrome.storage.session.set({ sessions: [...sessions.values()] });
async function drop(tabId) {
  const session = sessions.get(tabId);
  if (!session) return;
  sessions.delete(tabId);
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [session.ruleId] });
  await save();
}
async function connected(origin) {
  const { connectedOrigins = [] } = await chrome.storage.local.get('connectedOrigins');
  return connectedOrigins.includes(origin);
}
const permitted = () => chrome.permissions.contains({ origins: ['<all_urls>'] });
function getSession(sender, payload) {
  const session = sessions.get(sender.tab.id);
  if (!session || session.sessionId !== payload?.sessionId || session.ownerOrigin !== new URL(sender.url).origin) throw failure('PREVIEW_NOT_READY', 'The preview session has changed. Reconnect the preview and try again.');
  return session;
}
function live(session) {
  if (sessions.get(session.tabId) !== session) throw failure('STALE_SESSION', 'The task or preview changed during capture. Please try again.');
}
async function frame(session) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId: session.tabId });
  const matches = frames.filter(f => f.parentFrameId === 0 && new URL(f.url).origin === session.origin);
  const chosen = matches.find(f => f.frameId === session.frameId) || (matches.length === 1 ? matches[0] : null);
  if (!chosen) throw failure('PREVIEW_NOT_READY', 'Wait for the local preview to load, then try again.');
  session.frameId = chosen.frameId;
  return chosen;
}
async function active(session) {
  const tab = await chrome.tabs.get(session.tabId);
  const window = await chrome.windows.get(tab.windowId);
  if (!tab.active || !window.focused || new URL(tab.url).origin !== session.ownerOrigin) throw failure('TAB_NOT_ACTIVE', 'Keep Alpha Bro in the active browser tab while capturing.');
  return tab;
}
function validateMeasurement(current, measured, rect) {
  if (current.width !== measured.width || current.height !== measured.height || !current.rect || ['x', 'y', 'width', 'height'].some(key => Math.abs(current.rect[key] - rect[key]) > 2)) {
    throw failure('STALE_VIEWPORT', 'The preview changed size or position. Please capture again.');
  }
}
async function capture(session, payload, measured) {
  const capturedFrame = await frame(session);
  if (payload.url && new URL(payload.url).href !== capturedFrame.url) throw failure('STALE_SESSION', 'The preview URL changed. Please try again.');
  if (measured.width !== payload.viewport?.width || measured.height !== payload.viewport?.height) throw failure('STALE_VIEWPORT', 'The preview changed size. Please capture again.');
  // Validate before acquiring pixels; never return an uncropped tab.
  cropBounds(payload.rect, payload.viewport, payload.viewport);
  const tab = await active(session);
  const before = await chrome.tabs.sendMessage(session.tabId, { type: 'measure', sessionId: session.sessionId }, { frameId: 0 });
  validateMeasurement(before, measured, payload.rect);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  await active(session);
  live(session);
  if ((await frame(session)).url !== capturedFrame.url) throw failure('STALE_SESSION', 'The preview navigated during capture. Please try again.');
  const after = await chrome.tabs.sendMessage(session.tabId, { type: 'measure', sessionId: session.sessionId }, { frameId: 0 });
  validateMeasurement(after, measured, payload.rect);
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const bounds = cropBounds(payload.rect, payload.viewport, bitmap);
    const canvas = new OffscreenCanvas(bounds.width, bounds.height);
    canvas.getContext('2d').drawImage(bitmap, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    live(session);
    return { dataUrl: 'data:image/png;base64,' + btoa(binary), width: bounds.width, height: bounds.height, url: capturedFrame.url };
  } finally { bitmap.close(); }
}
async function request(message, sender) {
  await restored;
  if (!sender.tab || sender.frameId !== 0) throw failure('NOT_CONNECTED', 'Connect Alpha Bro through the extension first.');
  const owner = ownerUrl(sender.url);
  const payload = message.payload || {};
  if (message.action === 'hello') return { connected: await connected(owner.origin), permissions: await permitted(), version: VERSION };
  if (message.action === 'openSetup') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') + '?origin=' + encodeURIComponent(owner.origin) });
    return {};
  }
  if (!(await connected(owner.origin))) throw failure('NOT_CONNECTED', 'Connect this Alpha Bro address in the extension.');
  if (!(await permitted())) throw failure('PERMISSION_REQUIRED', 'Allow the companion extension access to all sites in browser extension settings.');
  if (message.action === 'registerPreview') return serial(async () => {
    const target = localUrl(payload.url);
    if (typeof payload.sessionId !== 'string' || !payload.sessionId || typeof payload.taskId !== 'string') throw failure('INVALID_SESSION', 'A preview session and task are required.');
    if (target.origin === owner.origin) throw failure('INVALID_URL', 'The preview must use a different origin from Alpha Bro.');
    const previous = sessions.get(sender.tab.id);
    if (previous?.sessionId === payload.sessionId && previous.origin === target.origin) return { sessionId: previous.sessionId, ready: true };
    await drop(sender.tab.id);
    const session = { tabId: sender.tab.id, ownerOrigin: owner.origin, sessionId: payload.sessionId, taskId: payload.taskId, origin: target.origin, url: target.href, ruleId: nextRuleId++, frameId: null };
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: [embeddingRule(session.ruleId, session.tabId, session.origin)] });
    sessions.set(session.tabId, session);
    await save();
    return { sessionId: session.sessionId, ready: true };
  });
  if (message.action === 'unregisterPreview') return serial(async () => {
    if (sessions.get(sender.tab.id)?.sessionId === payload.sessionId) await drop(sender.tab.id);
    return {};
  });
  const session = getSession(sender, payload);
  if (message.action === 'capture') return capture(session, payload, message.viewport);
  if (message.action === 'navigate') {
    const targetFrame = await frame(session);
    if (!['back', 'forward', 'reload', 'to'].includes(payload.command)) throw failure('INVALID_COMMAND', 'Unknown preview navigation command.');
    let url;
    if (payload.command === 'to') {
      url = new URL(payload.path || '/', session.url).href;
      if (localUrl(url).origin !== session.origin) throw failure('INVALID_URL', 'Preview navigation must stay on the registered local server.');
    }
    await chrome.tabs.sendMessage(session.tabId, { type: 'navigate', command: payload.command, url }, { frameId: targetFrame.frameId });
    return {};
  }
  throw failure('INVALID_COMMAND', 'Unknown companion request.');
}
async function report(details) {
  await restored;
  const session = sessions.get(details.tabId);
  if (!session || details.frameId === 0) return;
  let target;
  try { target = new URL(details.url); } catch { return; }
  if (target.origin !== session.origin) {
    if (session.frameId === details.frameId) {
      await chrome.tabs.sendMessage(session.tabId, { type: 'event', message: { event: 'navigation', sessionId: session.sessionId, payload: { url: target.href, pathname: target.pathname + target.search + target.hash, canGoBack: false, canGoForward: false } } }, { frameId: 0 }).catch(() => {});
    }
    return;
  }
  const metadata = await chrome.webNavigation.getFrame({ tabId: details.tabId, frameId: details.frameId });
  if (!metadata || metadata.parentFrameId !== 0) return;
  if (session.frameId !== null && session.frameId !== details.frameId) {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: session.tabId });
    if (frames.some(item => item.frameId === session.frameId)) return;
    const candidates = frames.filter(item => item.parentFrameId === 0 && new URL(item.url).origin === session.origin);
    if (candidates.length !== 1 || candidates[0].frameId !== details.frameId) return;
  }
  session.frameId = details.frameId;
  session.url = target.href;
  await save();
  const navigation = await chrome.tabs.sendMessage(session.tabId, { type: 'navigationState' }, { frameId: details.frameId }).catch(() => null);
  await chrome.tabs.sendMessage(session.tabId, { type: 'event', message: { event: 'navigation', sessionId: session.sessionId, payload: { url: navigation?.url || target.href, pathname: navigation?.pathname || target.pathname + target.search + target.hash, canGoBack: navigation?.canGoBack ?? false, canGoForward: navigation?.canGoForward ?? false } } }, { frameId: 0 }).catch(() => {});
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'frameReady') {
    if (sender.tab && sender.frameId > 0) report({ tabId: sender.tab.id, frameId: sender.frameId, url: sender.url, transitionQualifiers: message.traverse ? ['forward_back'] : [] }).catch(() => {});
    return;
  }
  if (message.type !== 'page') return;
  request(message, sender).then(result => respond({ ok: true, result }), error => respond({ ok: false, error: { code: error.code || 'CAPTURE_FAILED', message: error.message || 'The companion request failed.' } }));
  return true;
});
chrome.webNavigation.onBeforeNavigate.addListener(details => {
  if (details.frameId === 0) serial(() => drop(details.tabId)).catch(() => {});
});
for (const event of [chrome.webNavigation.onCommitted, chrome.webNavigation.onHistoryStateUpdated, chrome.webNavigation.onReferenceFragmentUpdated]) event.addListener(details => report(details).catch(() => {}));
chrome.tabs.onRemoved.addListener(tabId => serial(() => drop(tabId)).catch(() => {}));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.connectedOrigins) serial(async () => {
    for (const session of [...sessions.values()]) if (!changes.connectedOrigins.newValue?.includes(session.ownerOrigin)) await drop(session.tabId);
  }).catch(() => {});
});
