import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Browser-testing MCP servers (expect-cli) can outlive the agent that launched them,
// get re-parented to init/launchd and keep headless Chromium + ffmpeg recording for hours.
// This module finds those orphans and terminates them together with their descendants.

export interface ProcessInfo {
  pid: number;
  ppid: number;
  command: string;
}

export interface ReapTarget extends ProcessInfo {
  /** PID of the orphaned root this process belongs to (itself for roots). */
  rootPid: number;
}

const BROWSER_MCP_PATTERN = /expect-cli[\\/](?:.*[\\/])?browser-mcp\.(?:c|m)?js\b/;
const ARTIFACTS_DIR_NAME = 'expect-artifacts';
// Recorders that reference the expect artifacts dir and were left behind on their own.
const ARTIFACT_RECORDER_PATTERN = /(?:^|[\\/\s])ffmpeg(?:\.exe)?\s.*expect-artifacts/;
// Processes that adopt orphans: init/launchd, or a per-user subreaper such as `systemd --user`.
const ADOPTER_PATTERN = /^(?:\S*[\\/])?(?:launchd|init|systemd)(?:\s|$)/;

export function parseProcessList(output: string): ProcessInfo[] {
  const processes: ProcessInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(ppid)) continue;
    processes.push({ pid, ppid, command: match[3] });
  }
  return processes;
}

export function isBrowserMcpCommand(command: string): boolean {
  return BROWSER_MCP_PATTERN.test(command);
}

function isOrphan(proc: ProcessInfo, byPid: Map<number, ProcessInfo>): boolean {
  if (proc.ppid <= 1) return true;
  const parent = byPid.get(proc.ppid);
  if (!parent) return true;
  return ADOPTER_PATTERN.test(parent.command);
}

/**
 * Select orphaned browser-mcp processes (and stray expect artifact recorders) plus their
 * descendant trees. A browser-mcp whose parent is still a live, non-init process belongs
 * to a running agent and is never selected.
 */
export function selectOrphanTargets(processes: ProcessInfo[], selfPid = process.pid): ReapTarget[] {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const children = new Map<number, ProcessInfo[]>();
  for (const p of processes) {
    const list = children.get(p.ppid);
    if (list) list.push(p);
    else children.set(p.ppid, [p]);
  }

  const roots = processes.filter((p) =>
    p.pid !== selfPid &&
    p.pid > 1 &&
    (isBrowserMcpCommand(p.command) || ARTIFACT_RECORDER_PATTERN.test(p.command)) &&
    isOrphan(p, byPid));

  const targets: ReapTarget[] = [];
  const seen = new Set<number>();
  for (const root of roots) {
    const stack: ProcessInfo[] = [root];
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current.pid) || current.pid === selfPid || current.pid <= 1) continue;
      seen.add(current.pid);
      targets.push({ ...current, rootPid: root.pid });
      stack.push(...(children.get(current.pid) ?? []));
    }
  }
  return targets;
}

export function listProcesses(): Promise<ProcessInfo[]> {
  return new Promise((resolve, reject) => {
    execFile('ps', ['-axo', 'pid=,ppid=,command='], { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(parseProcessList(stdout));
    });
  });
}

export interface ReaperDeps {
  platform: NodeJS.Platform;
  listProcesses: () => Promise<ProcessInfo[]>;
  kill: (pid: number, signal: NodeJS.Signals) => void;
  sleep: (ms: number) => Promise<void>;
  cleanArtifacts: () => Promise<number>;
  log: (message: string) => void;
}

export interface ReapResult {
  terminated: ReapTarget[];
  forceKilled: number[];
  artifactsRemoved: number;
}

/** Remove expect artifacts older than maxAgeMs from the known tmp locations. */
export async function cleanStaleArtifacts(maxAgeMs = 60 * 60 * 1000, now = Date.now(), dirs?: string[]): Promise<number> {
  const candidates = dirs ?? [...new Set([path.join('/tmp', ARTIFACTS_DIR_NAME), path.join(os.tmpdir(), ARTIFACTS_DIR_NAME)])];
  let removed = 0;
  for (const dir of candidates) {
    let entries: string[];
    try { entries = await fs.readdir(dir); } catch { continue; }
    for (const name of entries) {
      const entryPath = path.join(dir, name);
      try {
        const stat = await fs.lstat(entryPath);
        if (now - stat.mtimeMs < maxAgeMs) continue;
        await fs.rm(entryPath, { recursive: true, force: true });
        removed++;
      } catch {
        // Ignore entries that vanish or cannot be removed.
      }
    }
  }
  return removed;
}

const defaultDeps: ReaperDeps = {
  platform: process.platform,
  listProcesses,
  kill: (pid, signal) => process.kill(pid, signal),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  cleanArtifacts: () => cleanStaleArtifacts(),
  log: (message) => console.log(`[orphan-reaper] ${message}`),
};

export async function reapOrphanedBrowserProcesses(options: { graceMs?: number; deps?: Partial<ReaperDeps> } = {}): Promise<ReapResult> {
  const deps = { ...defaultDeps, ...options.deps };
  const graceMs = options.graceMs ?? 3000;
  const result: ReapResult = { terminated: [], forceKilled: [], artifactsRemoved: 0 };
  // Windows has no ps/ppid reparenting semantics we can rely on here; skip safely.
  if (deps.platform === 'win32') return result;

  const before = await deps.listProcesses();
  const targets = selectOrphanTargets(before);
  for (const target of targets) {
    try { deps.kill(target.pid, 'SIGTERM'); result.terminated.push(target); } catch { /* already gone */ }
  }

  if (result.terminated.length) {
    for (const root of result.terminated.filter((t) => t.pid === t.rootPid)) {
      const tree = result.terminated.filter((t) => t.rootPid === root.pid).length;
      deps.log(`terminated orphaned pid ${root.pid} (+${tree - 1} descendants): ${root.command.slice(0, 200)}`);
    }
    await deps.sleep(graceMs);
    const after = new Map((await deps.listProcesses()).map((p) => [p.pid, p]));
    for (const target of result.terminated) {
      const still = after.get(target.pid);
      // Guard against PID reuse: only escalate if the same command is still running.
      if (!still || still.command !== target.command) continue;
      try { deps.kill(target.pid, 'SIGKILL'); result.forceKilled.push(target.pid); } catch { /* exited */ }
    }
    if (result.forceKilled.length) deps.log(`force-killed ${result.forceKilled.length} process(es) that ignored SIGTERM`);
  }

  // Only touch artifacts once no browser-mcp is alive anywhere, so active recordings are safe.
  const current = result.terminated.length ? await deps.listProcesses() : before;
  if (!current.some((p) => isBrowserMcpCommand(p.command))) {
    result.artifactsRemoved = await deps.cleanArtifacts();
    if (result.artifactsRemoved) deps.log(`removed ${result.artifactsRemoved} stale expect artifact(s)`);
  }
  return result;
}

export interface OrphanReaperHandle {
  stop: () => void;
}

/** Run the reaper now and then every intervalMs. Never throws; the timer does not keep the process alive. */
export function startOrphanReaper(intervalMs = 10 * 60 * 1000, deps?: Partial<ReaperDeps>): OrphanReaperHandle {
  let running = false;
  let stopped = false;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try { await reapOrphanedBrowserProcesses({ deps }); }
    catch (err) { console.warn('[orphan-reaper] sweep failed:', err instanceof Error ? err.message : err); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void run(); }, intervalMs);
  timer.unref();
  void run();
  return { stop: () => { stopped = true; clearInterval(timer); } };
}
