import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('../src/content.js', import.meta.url), 'utf8');
test('preview state follows browser Navigation API for replace, duplicate push and traversal', async () => {
  let receiver;
  const events = {};
  const sent = [];
  const location = { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:4000', href: 'http://localhost:4000/a', pathname: '/a', search: '', hash: '' };
  const navigation = { currentEntry: {}, canGoBack: false, canGoForward: false, addEventListener(name, callback) { events[name] = callback; } };
  const window = { top: {}, navigation, addEventListener() {} };
  const chrome = { runtime: { onMessage: { addListener(fn) { receiver = fn; } }, sendMessage(message) { sent.push(message); return Promise.resolve(); } } };
  vm.runInNewContext(code, { window, location, navigation, chrome });
  const state = () => { let result; receiver({ type: 'navigationState' }, {}, value => { result = value; }); return result; };
  assert.equal(state().navigationAvailable, true);
  assert.equal(state().canGoBack, false);
  // ReplaceState changes the URL without creating a history entry.
  location.href = 'http://localhost:4000/replaced'; location.pathname = '/replaced';
  events.currententrychange();
  assert.equal(state().canGoBack, false);
  assert.equal(state().url, location.href);
  // Pushing an identical URL still creates a back entry in the browser.
  navigation.canGoBack = true; events.currententrychange();
  assert.equal(state().canGoBack, true);
  // Traversal changes navigation flags even with identical URLs.
  navigation.canGoBack = false; navigation.canGoForward = true; events.currententrychange();
  assert.equal(state().canGoForward, true);
  assert.equal(state().canGoBack, false);
  assert.equal(sent.length, 4);
});
test('top bridge identifies only the marked iframe window, never sibling or nested windows', async () => {
  let handler;
  const sent = [];
  const markedWindow = {};
  const location = { protocol: 'http:', hostname: 'bro.example.com', origin: 'http://bro.example.com:3300' };
  const window = { addEventListener(name, callback) { if (name === 'message') handler = callback; }, postMessage() {} };
  window.top = window;
  const document = { querySelectorAll() { return [{ dataset: { alphaBroPreview: 'session' }, contentWindow: markedWindow }]; } };
  const chrome = { runtime: { onMessage: { addListener() {} }, sendMessage(message) { sent.push(message); return Promise.resolve(); } } };
  vm.runInNewContext(code, { window, location, document, chrome });
  const data = { source: 'alpha-bro-frame-identity', token: 'challenge', sessionId: 'session' };
  await handler({ source: {}, data });
  await handler({ source: window, data });
  await handler({ source: markedWindow, data: { ...data, sessionId: 'old-session' } });
  assert.equal(sent.length, 0);
  await handler({ source: markedWindow, data });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'identified');
  assert.equal(sent[0].token, 'challenge');
});
test('external iframe responds to identity challenge through its parent window', () => {
  let receiver;
  const posted = [];
  const location = { protocol: 'https:', hostname: 'login.example.com' };
  const window = { top: {}, parent: { postMessage(...args) { posted.push(args); } }, addEventListener() {} };
  const chrome = { runtime: { onMessage: { addListener(fn) { receiver = fn; } }, sendMessage() { return Promise.resolve(); } } };
  vm.runInNewContext(code, { window, location, chrome });
  receiver({ type: 'identify', token: 'opaque', sessionId: 'preview' }, {}, () => {});
  assert.equal(posted.length, 1);
  assert.equal(posted[0][0].source, 'alpha-bro-frame-identity');
  assert.equal(posted[0][0].token, 'opaque');
});
