import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStreamContent, applyStreamSteps } from '../src/streamUpdate';
import { StreamDelivery } from '../../server/src/streamDelivery';

test('client reconstructs streaming text and steps through updates and resubscription', () => {
  const delivery = new StreamDelivery();
  const client = {};
  delivery.subscribe(client, 'chat');
  let content = '';
  let steps: any[] = [];
  for (let i = 0; i < 40; i++) {
    if (i === 20) delivery.subscribe(client, 'chat');
    const expected = `<thought>${'reasoning 🙂 '.repeat(i)}</thought>\n\n${'answer '.repeat(i)}`;
    const expectedSteps = [{ id: 'a', status: i < 10 ? 'running' : 'completed', detail: 'output '.repeat(i) }, ...(i >= 10 ? [{ id: 'b', status: 'running' }] : [])];
    const update = delivery.encode(client, { type: 'chat_stream', sessionId: 'chat', messageId: 'message', fullContent: expected, steps: expectedSteps });
    content = typeof update.fullContent === 'string' ? update.fullContent : applyStreamContent(content, update.contentPatch);
    steps = applyStreamSteps(steps, update)!;
    assert.equal(content, expected);
    assert.deepEqual(steps, expectedSteps);
  }
});
