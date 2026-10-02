import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { manageAgentProcess, stopAllAgentProcesses } from './agentProcesses.js';
import { StreamDelivery } from './streamDelivery.js';

test('cancel escalates when an agent ignores SIGINT', { skip: process.platform === 'win32' }, async () => {
  const child = spawn(process.execPath, ['-e', 'process.on("SIGINT",()=>{}); console.log("ready"); setInterval(()=>{},1000)'], { detached: true, stdio: ['ignore','pipe','pipe'] });
  manageAgentProcess(child, 100);
  await once(child.stdout!, 'data');
  const closed = once(child, 'close');
  child.kill('SIGINT');
  const [, signal] = await closed;
  assert.equal(signal, 'SIGKILL');
});

test('shutdown waits for tracked agents to terminate', async () => {
  const child = spawn(process.execPath, ['-e', 'console.log("ready"); setInterval(()=>{},1000)'], { detached: process.platform !== 'win32', stdio: ['ignore','pipe','pipe'] });
  manageAgentProcess(child, 100);
  await once(child.stdout!, 'data');
  await stopAllAgentProcesses();
  assert.notEqual(child.signalCode, null);
});

test('stream sends snapshots, text replacements and only changed steps', () => {
  const delivery = new StreamDelivery();
  const client = {};
  delivery.enable(client);
  assert.equal(delivery.encode(client, { sessionId: 's' }), null, 'unsubscribed new clients receive no stream');
  delivery.subscribe(client, 's');
  const initial = { type: 'chat_stream', sessionId: 's', messageId: 'm', fullContent: '<thought>hello</thought>', steps: [{ id: 'a', status: 'running' }] };
  assert.equal(delivery.encode(client, initial)?.fullContent, initial.fullContent);
  const next = { ...initial, fullContent: '<thought>hello world</thought>', steps: [{ id: 'a', status: 'completed' }, { id: 'b', status: 'running' }] };
  const patch = delivery.encode(client, next)!;
  assert.equal(patch.fullContent, undefined);
  assert.equal(initial.fullContent.slice(0, patch.contentPatch.prefixLength) + patch.contentPatch.text, next.fullContent);
  assert.equal(patch.stepsPatch.length, 2);
  const unchanged = delivery.encode(client, next)!;
  assert.equal(unchanged.stepsPatch.length, 0);
  delivery.unsubscribe(client, 's');
  assert.equal(delivery.encode(client, next), null);
  delivery.subscribe(client, 's');
  assert.equal(delivery.encode(client, next)?.fullContent, next.fullContent);
  assert.equal(delivery.encode({}, next)?.fullContent, next.fullContent, 'old clients retain snapshot protocol');
});

test('cancel terminates tool descendants even after the agent leader exits', { skip: process.platform === 'win32', timeout: 5000 }, async () => {
  const script = `const {spawn}=require('node:child_process');
    const tool=spawn(process.execPath,['-e','process.on("SIGINT",()=>{}); process.on("SIGTERM",()=>{}); console.log("ready"); setInterval(()=>{},1000)'],{stdio:['ignore','pipe','inherit']});
    tool.stdout.once('data',()=>console.log(tool.pid)); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['-e', script], { detached: true, stdio: ['ignore','pipe','pipe'] });
  manageAgentProcess(child, 100);
  const [output] = await once(child.stdout!, 'data');
  const toolPid = Number(String(output).trim());
  assert.ok(toolPid > 1);
  const closed = once(child, 'close');
  child.kill('SIGINT');
  await closed;
  await stopAllAgentProcesses();
  // On macOS the adopted child can briefly remain as a zombie while launchd reaps it.
  const { execFileSync } = await import('node:child_process');
  let state = '';
  try { state = execFileSync('ps', ['-p', String(toolPid), '-o', 'stat='], { encoding: 'utf8' }).trim(); } catch {}
  assert.ok(!state || state.startsWith('Z'), `tool still running: ${state}`);
});
