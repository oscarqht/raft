import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const { code } = await transform(await readFile(new URL('../src/previewExtension.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const api = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const listeners = new Set();
let send;
globalThis.window = {
  location: { origin: 'http://localhost:3300' },
  setTimeout, clearTimeout,
  addEventListener(_type, listener) { listeners.add(listener); },
  removeEventListener(_type, listener) { listeners.delete(listener); },
  postMessage(message) { send?.(message); },
};
function dispatch(data, extra = {}) {
  for (const listener of [...listeners]) listener({ data, source: window, origin: window.location.origin, ...extra });
}

test('request accepts only matching response from its own window and cleans up', async () => {
  send = (message) => {
    const response = { source: 'alpha-bro-extension', version: 1, id: message.id, ok: true, result: { width: 400 } };
    dispatch({ ...response, result: 'wrong origin' }, { origin: 'http://localhost:4000' });
    dispatch({ ...response, result: 'wrong frame' }, { source: {} });
    dispatch({ ...response, id: 'unrelated' });
    dispatch(response);
  };
  assert.deepEqual(await api.extensionRequest('capture'), { width: 400 });
  assert.equal(listeners.size, 0);
});

test('missing, updated, and denied extension produce actionable errors', async () => {
  send = undefined;
  await assert.rejects(api.extensionRequest('hello', {}, 5), { code: 'UNAVAILABLE' });
  assert.equal(listeners.size, 0);
  send = ({ id }) => dispatch({ source: 'alpha-bro-extension', version: 2, id, ok: true });
  await assert.rejects(api.extensionRequest('hello'), { code: 'UPDATE_REQUIRED' });
  send = ({ id }) => dispatch({ source: 'alpha-bro-extension', version: 1, id, ok: false, error: { code: 'PERMISSION_REQUIRED', message: 'Grant access' } });
  await assert.rejects(api.extensionRequest('capture'), { code: 'PERMISSION_REQUIRED', message: 'Grant access' });
  assert.equal(api.statusFromError(new api.PreviewExtensionError('EXTENSION_UNAVAILABLE', 'Reload')), 'reload');
  assert.equal(listeners.size, 0);
});

test('navigation updates are isolated by session and listener lifetime', () => {
  const received = [];
  const unsubscribe = api.subscribePreviewNavigation('task-a', (value) => received.push(value));
  const event = { source: 'alpha-bro-extension', version: 1, event: 'navigation', sessionId: 'task-a', payload: { url: 'http://localhost:5173/form?tab=2#email', pathname: '/form?tab=2#email', canGoBack: true, canGoForward: false } };
  dispatch({ ...event, sessionId: 'task-b' });
  dispatch(event, { source: {} });
  dispatch(event);
  unsubscribe();
  dispatch(event);
  assert.deepEqual(received, [event.payload]);
  assert.equal(listeners.size, 0);
});

const addressCode = await transform(await readFile(new URL('../src/previewAddress.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const address = await import('data:text/javascript;base64,' + Buffer.from(addressCode.code).toString('base64'));
test('external preview addresses survive display, remount, navigation and attachment formatting', () => {
  const local = 'http://localhost:5173';
  const external = 'https://auth.example.test/login?client=app#consent';
  assert.equal(address.displayPreviewAddress(external, local), external);
  assert.equal(address.resolvePreviewAddress(address.displayPreviewAddress(external, local), local), external);
  assert.equal(address.resolvePreviewAddress('/callback?code=test', external), 'https://auth.example.test/callback?code=test');
  assert.equal(address.displayPreviewAddress(local + '/returned?ok=1#done', local), '/returned?ok=1#done');
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test', 'https://user:secret@example.test/']) {
    assert.throws(() => address.resolvePreviewAddress(value, local));
  }
});
