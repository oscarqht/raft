import { VERSION, localUrl, ownerUrl, isAutoConnected, failure, embeddingRule, cropBounds } from './core.js';

const sessions = new Map();
let nextRuleId = 1;
const restored = (async () => {
  const saved = await chrome.storage.session.get('sessions');
  for (const session of saved.sessions || []) {
    try {
      const tab = await chrome.tabs.get(session.tabId);
      if (new URL(tab.url).origin === session.ownerOrigin && isAutoConnected(session.ownerOrigin) && await permitted()) {
        sessions.set(session.tabId, session);
        nextRuleId = Math.max(nextRuleId, session.ruleId + 1);
      }
    } catch { /* Closed tabs cannot keep a preview session. */ }
  }
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map(rule => rule.id), addRules: [...sessions.values()].map(s => embeddingRule(s.ruleId, s.tabId)) });
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
const permitted = () => chrome.permissions.contains({ origins: ['<all_urls>'] });
function getSession(sender, payload) {
  const session = sessions.get(sender.tab.id);
  if (!session || session.sessionId !== payload?.sessionId || session.ownerOrigin !== new URL(sender.url).origin) throw failure('PREVIEW_NOT_READY', 'The preview session has changed. Reconnect the preview and try again.');
  return session;
}
function live(session) {
  if (sessions.get(session.tabId) !== session) throw failure('STALE_SESSION', 'The task or preview changed during capture. Please try again.');
}
const challenges = new Map();
async function identifyFrame(session, frameId) {
  const token = crypto.randomUUID();
  let timer;
  const identified = new Promise(resolve => {
    const finish = (value) => { clearTimeout(timer); challenges.delete(token); resolve(value); };
    challenges.set(token, { session, frameId, finish });
    timer = setTimeout(() => finish(false), 700);
  });
  try {
    await chrome.tabs.sendMessage(session.tabId, { type: 'identify', token, sessionId: session.sessionId }, { frameId });
  } catch { challenges.get(token)?.finish(false); }
  return identified;
}
async function frame(session) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId: session.tabId });
  const candidates = frames.filter(candidate => candidate.parentFrameId === 0 && /^https?:\/\//.test(candidate.url));
  const previous = candidates.find(candidate => candidate.frameId === session.frameId);
  if (previous && await identifyFrame(session, previous.frameId)) { live(session); return previous; }
  // The DOM marker, not hostname or frame ordering, is the authority.
  const verified = await Promise.all(candidates.map(async candidate => await identifyFrame(session, candidate.frameId) ? candidate : null));
  live(session);
  const matches = verified.filter(Boolean);
  if (matches.length !== 1) throw failure('PREVIEW_NOT_READY', 'Wait for the preview to load, then try again.');
  session.frameId = matches[0].frameId;
  return matches[0];
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
  const afterFrame = await frame(session);
  if (afterFrame.url !== capturedFrame.url || afterFrame.frameId !== capturedFrame.frameId || afterFrame.documentId !== capturedFrame.documentId) throw failure('STALE_SESSION', 'The preview navigated during capture. Please try again.');
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
  if (!sender.tab || sender.frameId !== 0) throw failure('NOT_CONNECTED', 'Open Alpha Bro on port 3300 to use the companion.');
  const owner = ownerUrl(sender.url);
  const payload = message.payload || {};
  if (message.action === 'hello') return { connected: isAutoConnected(owner.origin), permissions: await permitted(), version: VERSION };
  if (!(isAutoConnected(owner.origin))) throw failure('NOT_CONNECTED', 'The companion works with Alpha Bro addresses on port 3300.');
  if (!(await permitted())) throw failure('PERMISSION_REQUIRED', 'Allow the companion extension access to all sites in browser extension settings.');
  if (message.action === 'registerPreview') return serial(async () => {
    const target = localUrl(payload.url);
    if (typeof payload.sessionId !== 'string' || !payload.sessionId || typeof payload.taskId !== 'string') throw failure('INVALID_SESSION', 'A preview session and task are required.');
    if (target.origin === owner.origin) throw failure('INVALID_URL', 'The preview must use a different origin from Alpha Bro.');
    const previous = sessions.get(sender.tab.id);
    if (previous?.sessionId === payload.sessionId && previous.origin === target.origin) return { sessionId: previous.sessionId, ready: true };
    await drop(sender.tab.id);
    const session = { tabId: sender.tab.id, ownerOrigin: owner.origin, sessionId: payload.sessionId, taskId: payload.taskId, origin: target.origin, url: target.href, ruleId: nextRuleId++, frameId: null };
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: [embeddingRule(session.ruleId, session.tabId)] });
    sessions.set(session.tabId, session);
    await save();
    return { sessionId: session.sessionId, ready: true };
  });
  if (message.action === 'unregisterPreview') return serial(async () => {
    if (sessions.get(sender.tab.id)?.sessionId === payload.sessionId) await drop(sender.tab.id);
    return {};
  });
  if (!['capture', 'navigate'].includes(message.action)) throw failure('INVALID_COMMAND', 'Unknown companion request.');
  const session = getSession(sender, payload);
  if (message.action === 'capture') return capture(session, payload, message.viewport);
  if (message.action === 'navigate') {
    const targetFrame = await frame(session);
    if (!['back', 'forward', 'reload', 'to'].includes(payload.command)) throw failure('INVALID_COMMAND', 'Unknown preview navigation command.');
    let url;
    if (payload.command === 'to') {
      url = ownerUrl(new URL(payload.path || '/', targetFrame.url).href).href;
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
  const metadata = await chrome.webNavigation.getFrame({ tabId: details.tabId, frameId: details.frameId });
  if (!metadata || metadata.parentFrameId !== 0 || !/^https?:\/\//.test(metadata.url)) return;
  if (!(await identifyFrame(session, details.frameId))) return;
  live(session);
  const navigation = await chrome.tabs.sendMessage(session.tabId, { type: 'navigationState' }, { frameId: details.frameId }).catch(() => null);
  live(session);
  const target = ownerUrl(navigation?.url || metadata.url);
  session.frameId = details.frameId;
  session.crossOriginHistory = session.crossOriginHistory || new URL(session.url).origin !== target.origin;
  session.url = target.href;
  // Navigation API bounds exclude cross-origin entries. In that case (or when
  // unavailable), keep native history attempts usable; the browser owns bounds.
  const unknownBounds = session.crossOriginHistory || navigation?.navigationAvailable === false;
  await save();
  await chrome.tabs.sendMessage(session.tabId, { type: 'event', message: { event: 'navigation', sessionId: session.sessionId, payload: { url: target.href, pathname: target.pathname + target.search + target.hash, canGoBack: unknownBounds || (navigation?.canGoBack ?? false), canGoForward: unknownBounds || (navigation?.canGoForward ?? false) } } }, { frameId: 0 }).catch(() => {});
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'identified') {
    const challenge = challenges.get(message.token);
    if (challenge && sender.tab?.id === challenge.session.tabId && sender.frameId === 0 && sender.url && new URL(sender.url).origin === challenge.session.ownerOrigin && message.sessionId === challenge.session.sessionId && sessions.get(sender.tab.id) === challenge.session) challenge.finish(true);
    return;
  }
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
