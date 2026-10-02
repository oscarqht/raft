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
  const navigation = { canGoBack: false, canGoForward: false, addEventListener(name, callback) { events[name] = callback; } };
  const window = { top: {}, navigation, addEventListener() {} };
  const chrome = { runtime: { onMessage: { addListener(fn) { receiver = fn; } }, sendMessage(message) { sent.push(message); return Promise.resolve(); } } };
  vm.runInNewContext(code, { window, location, navigation, chrome });
  const state = () => { let result; receiver({ type: 'navigationState' }, {}, value => { result = value; }); return result; };
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
