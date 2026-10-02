import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCachedChatScrollPosition,
  setCachedChatScrollPosition,
  clearCachedChatScrollPosition,
  deleteCachedTask,
  deleteCachedChat,
} from '../src/cache';

test('chatScrollCache stores and retrieves scroll position per task and session', () => {
  const taskId = 'task-test-1';
  const session1 = 'session-1';
  const session2 = 'session-2';

  // Initially null
  assert.strictEqual(getCachedChatScrollPosition(taskId, session1), null);

  // Store position for session 1
  setCachedChatScrollPosition(taskId, session1, {
    scrollTop: 350,
    wasAtBottom: false,
    topMessageId: 'msg-1',
    topMessageIndex: 4,
    topMessageOffset: 12,
  });

  // Store position for session 2
  setCachedChatScrollPosition(taskId, session2, {
    scrollTop: 800,
    wasAtBottom: true,
  });

  const pos1 = getCachedChatScrollPosition(taskId, session1);
  assert.ok(pos1);
  assert.strictEqual(pos1.scrollTop, 350);
  assert.strictEqual(pos1.wasAtBottom, false);
  assert.strictEqual(pos1.topMessageId, 'msg-1');
  assert.strictEqual(pos1.topMessageIndex, 4);
  assert.strictEqual(pos1.topMessageOffset, 12);

  const pos2 = getCachedChatScrollPosition(taskId, session2);
  assert.ok(pos2);
  assert.strictEqual(pos2.scrollTop, 800);
  assert.strictEqual(pos2.wasAtBottom, true);
});

test('chatScrollCache clears specific session without clearing other sessions', () => {
  const taskId = 'task-test-2';
  const sessionA = 'session-a';
  const sessionB = 'session-b';

  setCachedChatScrollPosition(taskId, sessionA, { scrollTop: 100, wasAtBottom: false });
  setCachedChatScrollPosition(taskId, sessionB, { scrollTop: 200, wasAtBottom: false });

  clearCachedChatScrollPosition(taskId, sessionA);

  assert.strictEqual(getCachedChatScrollPosition(taskId, sessionA), null);
  assert.notStrictEqual(getCachedChatScrollPosition(taskId, sessionB), null);
});

test('chatScrollCache clears all sessions for a task when taskId is cleared', () => {
  const taskId = 'task-test-3';
  const session1 = 'session-1';
  const session2 = 'session-2';

  setCachedChatScrollPosition(taskId, undefined, { scrollTop: 100, wasAtBottom: false });
  setCachedChatScrollPosition(taskId, session1, { scrollTop: 200, wasAtBottom: false });
  setCachedChatScrollPosition(taskId, session2, { scrollTop: 300, wasAtBottom: false });

  clearCachedChatScrollPosition(taskId);

  assert.strictEqual(getCachedChatScrollPosition(taskId), null);
  assert.strictEqual(getCachedChatScrollPosition(taskId, session1), null);
  assert.strictEqual(getCachedChatScrollPosition(taskId, session2), null);
});

test('deleteCachedTask and deleteCachedChat evict scroll positions', () => {
  const taskId = 'task-test-4';
  const chatId = 'chat-test-4';

  setCachedChatScrollPosition(taskId, chatId, { scrollTop: 450, wasAtBottom: false });
  assert.ok(getCachedChatScrollPosition(taskId, chatId));

  deleteCachedChat(taskId, chatId);
  assert.strictEqual(getCachedChatScrollPosition(taskId, chatId), null);

  setCachedChatScrollPosition(taskId, chatId, { scrollTop: 500, wasAtBottom: false });
  deleteCachedTask(taskId);
  assert.strictEqual(getCachedChatScrollPosition(taskId, chatId), null);
});
