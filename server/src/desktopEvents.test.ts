import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { DesktopEvents } from './desktopEvents.js';

test('desktop channel pushes immediately and releases disconnected clients', async () => {
  const events = new DesktopEvents();
  let disconnected: Promise<unknown>;
  const server = http.createServer((_req, res) => {
    disconnected = once(res, 'close');
    events.attach(res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as import('node:net').AddressInfo;
  const connect = async () => {
    const req = http.get(`http://127.0.0.1:${address.port}`);
    const [response] = await once(req, 'response');
    return response as http.IncomingMessage;
  };
  try {
    assert.equal(events.send({ type: 'action' }), false);
    const first = await connect();
    assert.match(String((await once(first, 'data'))[0]), /connected/);
    const received = once(first, 'data');
    assert.equal(events.send({ type: 'action', action: 'check' }), true);
    assert.equal(JSON.parse(String((await received)[0])).action, 'check');
    const ended = once(first, 'end');
    const second = await connect();
    await ended;
    const initial = await once(second, 'data');
    assert.match(String(initial[0]), /connected/);
    const notification = once(second, 'data');
    events.send({ type: 'notification', title: 'Done', body: 'Finished' });
    assert.equal(JSON.parse(String((await notification)[0])).title, 'Done');
    second.destroy();
    await once(second, 'close');
    await disconnected!;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  assert.equal(events.send({ type: 'action' }), false);
});
