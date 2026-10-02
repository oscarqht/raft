import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  cleanStaleArtifacts,
  isBrowserMcpCommand,
  listProcesses,
  parseProcessList,
  reapOrphanedBrowserProcesses,
  selectOrphanTargets,
  type ProcessInfo,
} from './orphanReaper.js';

const MCP = 'node /Users/me/.npm/_npx/abc/node_modules/expect-cli/dist/browser-mcp.js';

test('parseProcessList parses ps output and skips malformed lines', () => {
  const output = [
    '    1     0 /sbin/launchd',
    ' 4242     1 node /x/expect-cli/dist/browser-mcp.js --flag value',
    'garbage line',
    '',
    ' 4300  4242 /cache/chrome-headless-shell --headless --use-angle=swiftshader',
  ].join('\n');
  assert.deepEqual(parseProcessList(output), [
    { pid: 1, ppid: 0, command: '/sbin/launchd' },
    { pid: 4242, ppid: 1, command: 'node /x/expect-cli/dist/browser-mcp.js --flag value' },
    { pid: 4300, ppid: 4242, command: '/cache/chrome-headless-shell --headless --use-angle=swiftshader' },
  ]);
});

test('isBrowserMcpCommand only matches expect-cli browser-mcp', () => {
  assert.ok(isBrowserMcpCommand(MCP));
  assert.ok(isBrowserMcpCommand('node C:\\npm\\expect-cli\\dist\\browser-mcp.js'));
  assert.ok(!isBrowserMcpCommand('node /other/browser-mcp.js'));
  assert.ok(!isBrowserMcpCommand('vim expect-cli-notes.txt'));
});

test('selectOrphanTargets picks orphaned browser-mcp trees but spares agent-owned ones', () => {
  const procs: ProcessInfo[] = [
    { pid: 1, ppid: 0, command: '/sbin/launchd' },
    { pid: 100, ppid: 1, command: MCP },                                   // orphan (ppid 1)
    { pid: 101, ppid: 100, command: '/cache/chrome-headless-shell --headless' },
    { pid: 102, ppid: 101, command: '/cache/chrome-headless-shell --type=renderer' },
    { pid: 103, ppid: 100, command: 'ffmpeg -i - /tmp/expect-artifacts/run.webm' },
    { pid: 200, ppid: 1, command: 'claude --print' },                      // live agent
    { pid: 201, ppid: 200, command: MCP },                                 // owned by live agent
    { pid: 202, ppid: 201, command: '/cache/chrome-headless-shell --headless' },
    { pid: 300, ppid: 9999, command: MCP },                                // parent vanished
    { pid: 400, ppid: 1, command: 'ffmpeg -i - /tmp/expect-artifacts/old.webm' }, // stray recorder
    { pid: 500, ppid: 1, command: 'ffmpeg -i in.mp4 out.webm' },           // unrelated ffmpeg
    { pid: 600, ppid: 1, command: '/cache/chrome-headless-shell --headless' }, // unrelated chrome
    { pid: 700, ppid: 1, command: '/lib/systemd/systemd --user' },
    { pid: 701, ppid: 700, command: MCP },                                 // adopted by user subreaper
  ];
  const targets = selectOrphanTargets(procs, 42);
  assert.deepEqual(targets.map((t) => t.pid).sort((a, b) => a - b), [100, 101, 102, 103, 300, 400, 701]);
  assert.ok(targets.filter((t) => [101, 102, 103].includes(t.pid)).every((t) => t.rootPid === 100));
});

test('selectOrphanTargets never targets init or the server itself', () => {
  const procs: ProcessInfo[] = [
    { pid: 1, ppid: 0, command: MCP },
    { pid: 50, ppid: 1, command: MCP },
  ];
  assert.deepEqual(selectOrphanTargets(procs, 50), []);
});

test('reaper sends SIGTERM, escalates to SIGKILL only for survivors with the same command', async () => {
  const procs: ProcessInfo[] = [
    { pid: 100, ppid: 1, command: MCP },
    { pid: 101, ppid: 100, command: 'chrome-headless-shell' },
    { pid: 102, ppid: 100, command: 'ffmpeg' },
  ];
  let calls = 0;
  const signals: Array<[number, string]> = [];
  let cleaned = 0;
  const result = await reapOrphanedBrowserProcesses({
    graceMs: 0,
    deps: {
      platform: 'darwin',
      listProcesses: async () => {
        calls++;
        if (calls === 1) return procs;
        if (calls === 2) return [procs[1], { pid: 102, ppid: 1, command: 'reused pid' }];
        return [];
      },
      kill: (pid, signal) => { signals.push([pid, signal]); },
      sleep: async () => {},
      cleanArtifacts: async () => { cleaned++; return 2; },
      log: () => {},
    },
  });
  assert.deepEqual(signals.filter(([, s]) => s === 'SIGTERM').map(([p]) => p).sort(), [100, 101, 102]);
  assert.deepEqual(signals.filter(([, s]) => s === 'SIGKILL'), [[101, 'SIGKILL']]);
  assert.equal(cleaned, 1);
  assert.equal(result.artifactsRemoved, 2);
});

test('reaper keeps artifacts while any browser-mcp is alive and is a no-op on Windows', async () => {
  let cleaned = 0;
  const deps = {
    listProcesses: async () => [{ pid: 10, ppid: 5, command: 'claude' }, { pid: 11, ppid: 10, command: MCP }, { pid: 5, ppid: 1, command: 'zsh' }],
    kill: () => { throw new Error('should not kill'); },
    sleep: async () => {},
    cleanArtifacts: async () => { cleaned++; return 0; },
    log: () => {},
  };
  await reapOrphanedBrowserProcesses({ deps: { ...deps, platform: 'linux' } });
  assert.equal(cleaned, 0);
  const win = await reapOrphanedBrowserProcesses({ deps: { ...deps, platform: 'win32', listProcesses: async () => { throw new Error('no ps'); } } });
  assert.deepEqual(win, { terminated: [], forceKilled: [], artifactsRemoved: 0 });
});

test('cleanStaleArtifacts removes only entries older than the threshold', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expect-artifacts-test-'));
  try {
    const now = Date.now();
    fs.writeFileSync(path.join(dir, 'old.webm'), 'x');
    fs.mkdirSync(path.join(dir, 'old-run'));
    fs.writeFileSync(path.join(dir, 'old-run', 'frame.png'), 'x');
    fs.writeFileSync(path.join(dir, 'fresh.webm'), 'x');
    const past = new Date(now - 2 * 60 * 60 * 1000);
    fs.utimesSync(path.join(dir, 'old.webm'), past, past);
    fs.utimesSync(path.join(dir, 'old-run'), past, past);
    const removed = await cleanStaleArtifacts(60 * 60 * 1000, now, [dir, path.join(dir, 'missing')]);
    assert.equal(removed, 2);
    assert.deepEqual(fs.readdirSync(dir), ['fresh.webm']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reaper terminates a real orphaned browser-mcp tree', { skip: process.platform === 'win32', timeout: 10000 }, async () => {
  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-reaper-'));
  const mcpDir = path.join(fakeDir, 'expect-cli', 'dist');
  fs.mkdirSync(mcpDir, { recursive: true });
  const mcpScript = path.join(mcpDir, 'browser-mcp.js');
  // Fake MCP ignores SIGTERM and spawns a child, forcing the SIGKILL path for the root.
  fs.writeFileSync(mcpScript, `const {spawn}=require('node:child_process');
    process.on('SIGTERM',()=>{});
    const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    console.log(c.pid); setInterval(()=>{},1000);`);
  fs.writeFileSync(path.join(fakeDir, 'package.json'), '{"type":"commonjs"}');
  // Launcher exits immediately so the MCP is re-parented (orphaned).
  const launcher = spawn(process.execPath, ['-e', `const {spawn}=require('node:child_process');
    const m=spawn(process.execPath,[${JSON.stringify(mcpScript)}],{detached:true,stdio:['ignore','pipe','ignore']});
    m.stdout.once('data',d=>{console.log(m.pid+' '+String(d).trim()); process.exit(0);});`], { stdio: ['ignore', 'pipe', 'ignore'] });
  const [out] = await once(launcher.stdout!, 'data');
  const [mcpPid, childPid] = String(out).trim().split(/\s+/).map(Number);
  await once(launcher, 'close');
  try {
    // Wait until the MCP is no longer owned by the launcher.
    let adopter = 1;
    for (let i = 0; i < 50; i++) {
      const me = (await listProcesses()).find((p) => p.pid === mcpPid);
      if (me && me.ppid !== launcher.pid) { adopter = me.ppid; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    // Some Linux sandboxes/containers adopt orphans with a custom subreaper instead of init;
    // present it as pid 1 (what launchd does on macOS) so the real kill path is exercised.
    const asSeenOnHost = async () => (await listProcesses()).map((p) => (p.ppid === adopter && p.pid === mcpPid ? { ...p, ppid: 1 } : p));
    const result = await reapOrphanedBrowserProcesses({ graceMs: 300, deps: { listProcesses: asSeenOnHost, cleanArtifacts: async () => 0, log: () => {} } });
    const pids = result.terminated.map((t) => t.pid);
    assert.ok(pids.includes(mcpPid), `mcp ${mcpPid} not targeted: ${JSON.stringify(result.terminated)}`);
    assert.ok(pids.includes(childPid));
    assert.ok(result.forceKilled.includes(mcpPid));
    await new Promise((r) => setTimeout(r, 200));
    const alive = (await listProcesses()).filter((p) => (p.pid === mcpPid || p.pid === childPid) && !/defunct/.test(p.command));
    assert.deepEqual(alive, []);
  } finally {
    for (const pid of [mcpPid, childPid]) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    fs.rmSync(fakeDir, { recursive: true, force: true });
  }
});
