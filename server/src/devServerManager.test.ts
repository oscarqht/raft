import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { devServerManager, detectDevServerPort, DevServerManager } from './devServerManager.js';

test('DevServerManager subscriber tracking and multi-tab awareness', () => {
  const taskId = 'test-task-subscribers';
  const dummyClient1 = { id: 1 };
  const dummyClient2 = { id: 2 };

  assert.strictEqual(devServerManager.getSubscriberCount(taskId), 0);

  devServerManager.addSubscriber(taskId, dummyClient1);
  assert.strictEqual(devServerManager.getSubscriberCount(taskId), 1);

  devServerManager.addSubscriber(taskId, dummyClient2);
  assert.strictEqual(devServerManager.getSubscriberCount(taskId), 2);

  devServerManager.removeSubscriber(taskId, dummyClient1);
  assert.strictEqual(devServerManager.getSubscriberCount(taskId), 1);

  devServerManager.removeSubscriber(taskId, dummyClient2);
  assert.strictEqual(devServerManager.getSubscriberCount(taskId), 0);
});

test('DevServerManager pending stop scheduling and cancellation on reload/reconnect', async () => {
  const taskId = 'test-task-pending-stop';

  // Manually mock an active server state entry
  (devServerManager as any).servers.set(taskId, {
    proc: null,
    state: {
      taskId,
      status: 'running',
      port: 5173,
      logs: [],
      devCmd: 'echo hi',
      worktreePath: '/tmp',
    },
    proxy: null,
  });

  // Schedule pending stop with 50ms grace
  const scheduled = devServerManager.schedulePendingStop(taskId, 50);
  assert.strictEqual(scheduled, true);

  // Cancel immediately (simulating page reload reconnection)
  const cancelled = devServerManager.cancelPendingStop(taskId);
  assert.strictEqual(cancelled, true);

  // Wait 70ms to ensure it did not stop
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.strictEqual(devServerManager.getServerState(taskId).status, 'running');

  // Schedule again and let it expire with no subscribers
  devServerManager.schedulePendingStop(taskId, 50);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.strictEqual(devServerManager.getServerState(taskId).status, 'stopped');

  // Clean up
  (devServerManager as any).servers.delete(taskId);
});

test('DevServerManager stopServer with onlyIfNoSubscribers option', async () => {
  const taskId = 'test-task-multi-tab-stop';
  const dummyClient = { id: 'tab-2' };

  (devServerManager as any).servers.set(taskId, {
    proc: null,
    state: {
      taskId,
      status: 'running',
      port: 5173,
      logs: [],
      devCmd: 'echo hi',
      worktreePath: '/tmp',
    },
    proxy: null,
  });

  devServerManager.addSubscriber(taskId, dummyClient);

  // When another tab is viewing, stop with onlyIfNoSubscribers: true should NOT stop
  const stoppedWithSubscribers = await devServerManager.stopServer(taskId, { onlyIfNoSubscribers: true });
  assert.strictEqual(stoppedWithSubscribers, false);
  assert.strictEqual(devServerManager.getServerState(taskId).status, 'running');

  // Once subscribers leave, stopServer with onlyIfNoSubscribers: true stops it
  devServerManager.removeSubscriber(taskId, dummyClient);
  const stoppedWithoutSubscribers = await devServerManager.stopServer(taskId, { onlyIfNoSubscribers: true });
  assert.strictEqual(stoppedWithoutSubscribers, true);
  assert.strictEqual(devServerManager.getServerState(taskId).status, 'stopped');

  // Clean up
  (devServerManager as any).servers.delete(taskId);
});


test('detectDevServerPort strips ANSI colors and ignores collision warnings', () => {
  assert.strictEqual(detectDevServerPort('Port 3000 is in use, trying another one...'), undefined);
  assert.strictEqual(detectDevServerPort('Local: \x1b[36mhttp://localhost:\x1b[1m3001\x1b[22m/\x1b[39m'), 3001);
  assert.strictEqual(detectDevServerPort('http://[::1]:4000/'), 4000);
  assert.strictEqual(detectDevServerPort('Listening on port 8080'), 8080);
  assert.strictEqual(detectDevServerPort('http://localhost:99999/'), undefined);
});

const nodeCommand = (source: string) => `"${process.execPath}" -e '${source.replace(/'/g, "'\\''")}'`;
const eventually = async (check: () => boolean | Promise<boolean>) => {
  const deadline = Date.now() + 5000;
  while (!await check()) {
    if (Date.now() >= deadline) assert.fail('Timed out waiting for dev server');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};

test('occupied default port is not previewed; colored split output routes to the actual server', async (t) => {
  const manager = new DevServerManager();
  const unrelated = http.createServer((_req, res) => res.end('other task'));
  await new Promise<void>((resolve) => unrelated.listen(0, '127.0.0.1', resolve));
  const port = (unrelated.address() as any).port;
  t.after(async () => { await manager.stopAll(); unrelated.close(); });
  const source = `const http = require("node:http");
    setTimeout(() => {
      const server = http.createServer((req, res) => res.end("correct task"));
      server.listen(0, "127.0.0.1", () => {
        process.stdout.write("Local: " + String.fromCharCode(27) + "[36mhttp://local");
        setTimeout(() => console.log("host:" + String.fromCharCode(27) + "[1m" + server.address().port + String.fromCharCode(27) + "[22m/"), 30);
      });
    }, 200);`;
  const command = nodeCommand(source);
  await manager.startServer('colored-task', process.cwd(), command, port);
  assert.strictEqual((await manager.checkServerReady('colored-task')).ready, false);
  assert.strictEqual(manager.getServerState('colored-task').proxyPort, undefined);
  await eventually(async () => (await manager.checkServerReady('colored-task')).ready);
  const state = manager.getServerState('colored-task');
  assert.notStrictEqual(state.port, port);
  const body = await new Promise<string>((resolve, reject) => {
    http.get(`http://127.0.0.1:${state.proxyPort}/`, (res) => {
      let body = '';
      res.on('data', (data) => body += data);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
  assert.strictEqual(body, 'correct task');
  await manager.stopServer('colored-task');
  assert.strictEqual(manager.getServerState('colored-task').status, 'stopped');
  assert.strictEqual((await manager.checkServerReady('colored-task')).ready, false);
});

test('stop waits for termination and escalates an ignored SIGTERM', { skip: process.platform === 'win32' }, async (t) => {
  const manager = new DevServerManager();
  t.after(() => manager.stopAll());
  await manager.startServer('ignore-term', process.cwd(), nodeCommand('process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000);'));
  await eventually(() => manager.getServerState('ignore-term').logs.some((line) => line.includes('ready')));
  const stopping = manager.stopServer('ignore-term');
  assert.notStrictEqual(manager.getServerState('ignore-term').status, 'stopped');
  await stopping;
  assert.strictEqual(manager.getServerState('ignore-term').status, 'stopped');
});

test('recovery kills a recorded orphan but preserves live owners and reused PIDs', { skip: process.platform === 'win32' }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-preview-test-'));
  const manager = new DevServerManager();
  manager.initializeRecovery(directory);
  t.after(async () => { await manager.stopAll(); fs.rmSync(directory, { recursive: true, force: true }); });
  await manager.startServer('recover-task', process.cwd(), nodeCommand('console.log("ready"); setInterval(() => {}, 1000);'));
  await eventually(() => manager.getServerState('recover-task').logs.some((line) => line.includes('ready')));
  const file = path.join(directory, `${process.pid}.json`);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(saved.children.length, 1);
  const pid = saved.children[0].pid;
  new DevServerManager().initializeRecovery(directory);
  assert.doesNotThrow(() => process.kill(pid, 0), 'Live backend owner must be preserved');
  const stale = { ...saved, ownerPid: 2147483647, ownerIdentity: 'dead', children: [{ pid, identity: 'different process' }] };
  fs.writeFileSync(path.join(directory, '2147483647.json'), JSON.stringify(stale));
  new DevServerManager().initializeRecovery(directory);
  assert.doesNotThrow(() => process.kill(pid, 0), 'A reused PID must not be killed');
  fs.writeFileSync(path.join(directory, '2147483647.json'), JSON.stringify({ ...stale, children: saved.children }));
  new DevServerManager().initializeRecovery(directory);
  await eventually(() => {
    try { process.kill(pid, 0); return false; } catch { return true; }
  });
  assert.strictEqual(fs.existsSync(path.join(directory, '2147483647.json')), false);
});


test('concurrent starts are serialized and Stop during startup leaves no process', async () => {
  const manager = new DevServerManager();
  const command = nodeCommand('console.log("ready"); setInterval(() => {}, 1000);');
  try {
    const first = manager.startServer('race-task', process.cwd(), command);
    const second = manager.startServer('race-task', process.cwd(), command);
    const stopping = manager.stopServer('race-task');
    await Promise.all([first, second, stopping]);
    assert.strictEqual(manager.getServerState('race-task').status, 'stopped');
    assert.strictEqual(manager.getServerState('race-task').proxyPort, undefined);
    assert.deepStrictEqual(manager.getActiveDevServerTaskIds(), []);
  } finally { await manager.stopAll(); }
});
