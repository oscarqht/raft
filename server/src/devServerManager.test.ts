import test from 'node:test';
import assert from 'node:assert';
import { devServerManager } from './devServerManager.js';

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

test('DevServerManager stopServer with onlyIfNoSubscribers option', () => {
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
  const stoppedWithSubscribers = devServerManager.stopServer(taskId, { onlyIfNoSubscribers: true });
  assert.strictEqual(stoppedWithSubscribers, false);
  assert.strictEqual(devServerManager.getServerState(taskId).status, 'running');

  // Once subscribers leave, stopServer with onlyIfNoSubscribers: true stops it
  devServerManager.removeSubscriber(taskId, dummyClient);
  const stoppedWithoutSubscribers = devServerManager.stopServer(taskId, { onlyIfNoSubscribers: true });
  assert.strictEqual(stoppedWithoutSubscribers, true);
  assert.strictEqual(devServerManager.getServerState(taskId).status, 'stopped');

  // Clean up
  (devServerManager as any).servers.delete(taskId);
});
