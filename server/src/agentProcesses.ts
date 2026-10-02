import { ChildProcess, execFileSync } from 'node:child_process';

// Only processes launched into their own group by spawnAgentCli are registered.
const agents = new Map<ChildProcess, { stop: (signal?: NodeJS.Signals) => Promise<void>; force: () => void }>();

export function manageAgentProcess(proc: ChildProcess, graceMs = 1500): void {
  if (!proc.pid) return;
  const pid = proc.pid;
  const originalKill = proc.kill.bind(proc);
  let stopping: Promise<void> | undefined;
  let closed = false;
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(-pid, signal);
      }
    } catch {
      if (!closed && proc.exitCode === null && proc.signalCode === null) originalKill(signal);
    }
  };
  const groupAlive = () => {
    if (process.platform === 'win32') return !closed;
    try { process.kill(-pid, 0); return true; } catch { return false; }
  };
  const stop = (signal: NodeJS.Signals = 'SIGTERM'): Promise<void> => {
    if (stopping) return stopping;
    stopping = new Promise<void>((resolve) => {
      signalGroup(signal);
      const finish = () => { agents.delete(proc); resolve(); };
      if (!groupAlive()) { finish(); return; }
      // Retain ownership even if the leader exits while descendants are still alive.
      const timer = setTimeout(() => {
        if (groupAlive()) signalGroup('SIGKILL');
        if (closed) finish();
        else proc.once('close', finish);
      }, graceMs);
      proc.once('close', () => {
        if (!groupAlive()) { clearTimeout(timer); finish(); }
      });
    });
    return stopping;
  };
  agents.set(proc, { stop, force: () => signalGroup('SIGKILL') });
  proc.kill = (signal: NodeJS.Signals | number = 'SIGTERM') => {
    if (signal === 0) return originalKill(0);
    void stop(typeof signal === 'string' ? signal : 'SIGTERM');
    return true;
  };
  proc.once('close', () => { closed = true; });
  proc.once('exit', () => {
    // A CLI may exit while a tool still owns its stdout/stderr pipes.
    if (groupAlive()) void stop();
    else agents.delete(proc);
  });
  proc.once('error', () => { if (!proc.pid) agents.delete(proc); });
}

export async function stopAllAgentProcesses(): Promise<void> {
  await Promise.all([...agents.values()].map((entry) => entry.stop()));
}

export function forceStopAllAgentProcesses(): void {
  for (const entry of agents.values()) entry.force();
}
