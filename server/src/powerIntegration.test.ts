import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { db } from './db.js';
import { server } from './index.js';
import { stopAllAgentProcesses } from './agentProcesses.js';

test('real websocket path batches streams, restores subscriptions, persists completion, and cancels once', { timeout: 20000, skip: process.platform === 'win32' }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'raft-power-'));
  const cli = path.join(directory, 'fixture-cli');
  writeFileSync(cli, `#!${process.execPath}\nlet n=0; const timer=setInterval(()=>{console.log('chunk-'+(++n));if(n===40){clearInterval(timer);console.log('FINAL');}},10);\n`);
  chmodSync(cli, 0o755);
  execFileSync('git', ['init', '-b', 'main', directory], { stdio: 'ignore' });
  const now = Date.now();
  db.prepare('INSERT INTO projects (id,name,path,created_at,updated_at) VALUES (?,?,?,?,?)').run('power-project','Power',directory,now,now);
  db.prepare('INSERT INTO tasks (id,project_id,name,branch,base_branch,worktree_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('power-task','power-project','Power','main','main',directory,now,now);
  db.prepare('INSERT INTO chat_sessions (id,task_id,title,agent_cli,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('power-chat','power-task','Power',cli,now,now);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as import('node:net').AddressInfo;
  const sockets: WebSocket[] = [];
  const connect = async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    sockets.push(socket);
    const messages: any[] = [];
    socket.on('message', (raw) => messages.push(JSON.parse(String(raw))));
    await once(socket, 'open');
    return { socket, messages };
  };
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 6000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'timed out waiting for stream');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  try {
    const viewer = await connect();
    const other = await connect();
    viewer.socket.send(JSON.stringify({ type: 'subscribe_chat', sessionId: 'power-chat' }));
    other.socket.send(JSON.stringify({ type: 'subscribe_chat', sessionId: 'another-chat' }));
    viewer.socket.send(JSON.stringify({ type: 'send_chat_message', sessionId: 'power-chat', prompt: 'fixture', agentCli: cli }));
    await until(() => viewer.messages.some((m) => m.type === 'chat_stream'));
    const reconnected = await connect();
    reconnected.socket.send(JSON.stringify({ type: 'subscribe_chat', sessionId: 'power-chat' }));
    await until(() => reconnected.messages.some((m) => m.type === 'chat_stream'));
    assert.equal(typeof reconnected.messages.find((m) => m.type === 'chat_stream').fullContent, 'string');
    await until(() => viewer.messages.some((m) => m.type === 'chat_turn_complete'));
    const updates = viewer.messages.filter((m) => m.type === 'chat_stream');
    assert.ok(updates.length < 10, `expected batched updates, received ${updates.length}`);
    assert.ok(updates.some((m) => m.contentPatch));
    assert.equal(other.messages.filter((m) => m.type === 'chat_stream').length, 0);
    const final = viewer.messages.find((m) => m.type === 'chat_turn_complete');
    const saved = db.prepare('SELECT content FROM chat_messages WHERE id = ?').get(final.message.id) as { content: string };
    assert.match(saved.content, /FINAL/);
    assert.equal(saved.content, final.message.content);

    writeFileSync(cli, `#!${process.execPath}\nprocess.on('SIGINT',()=>{});setInterval(()=>console.log('still-running'),20);\n`);
    viewer.messages.length = 0;
    viewer.socket.send(JSON.stringify({ type: 'send_chat_message', sessionId: 'power-chat', prompt: 'cancel fixture', agentCli: cli }));
    await until(() => viewer.messages.some((m) => m.type === 'chat_stream'));
    viewer.socket.send(JSON.stringify({ type: 'abort', sessionId: 'power-chat' }));
    await until(() => viewer.messages.some((m) => m.type === 'aborted'));
    await stopAllAgentProcesses();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(viewer.messages.filter((m) => m.type === 'chat_turn_complete').length, 0, 'late process exit must not overwrite cancellation');
    const aborted = viewer.messages.find((m) => m.type === 'aborted');
    const savedAbort = db.prepare('SELECT content,metadata FROM chat_messages WHERE id = ?').get(aborted.messageId) as { content: string; metadata: string };
    assert.match(savedAbort.content, /still-running/);
    assert.equal(JSON.parse(savedAbort.metadata).interrupted, 'user');
  } finally {
    for (const socket of sockets) socket.terminate();
    await stopAllAgentProcesses();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
