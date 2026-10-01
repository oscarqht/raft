import { spawn, execSync, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { getCrossPlatformEnv } from './agentRunner.js';
import { startDevServerProxy, DevServerProxyInstance } from './previewProxy.js';

export interface DevServerState {
  taskId: string;
  status: 'stopped' | 'starting' | 'running' | 'error';
  port?: number;
  proxyPort?: number;
  url?: string;
  proxyUrl?: string;
  logs: string[];
  devCmd: string;
  worktreePath: string;
}

export function detectDevServerPort(output: string): number | undefined {
  const plain = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  // Only accept a listening address, not warnings such as "Port 3000 is in use".
  const match = [...plain.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):([0-9]{1,5})/gi)].at(-1) ||
    plain.match(/(?:listening[^\n]*?port|port:)\s*([0-9]{1,5})/i);
  const port = match ? Number(match[1]) : 0;
  return port > 0 && port <= 65535 ? port : undefined;
}

export class DevServerManager extends EventEmitter {
  private servers: Map<string, {
    proc: ChildProcess | null;
    state: DevServerState;
    proxy?: DevServerProxyInstance | null;
    targetPort?: number;
    stopping?: Promise<boolean>;
    portConfirmed?: boolean;
    output?: string;
  }> = new Map();

  private subscribers: Map<string, Set<any>> = new Map();
  private pendingStops: Map<string, NodeJS.Timeout> = new Map();

  private recoveryFile?: string;
  private pendingStarts = new Map<string, Promise<DevServerState>>();

  private processIdentity(pid: number): string | undefined {
    try {
      return execSync(`ps -p ${pid} -o lstart=`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
    } catch { return undefined; }
  }

  // Persist only processes we launched; never kill arbitrary listeners by port.
  initializeRecovery(directory: string): void {
    if (process.platform === 'win32') return;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const name of fs.readdirSync(directory)) {
      if (!/^\d+\.json$/.test(name)) continue;
      const file = path.join(directory, name);
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Number.isInteger(saved.ownerPid) || saved.ownerPid <= 1 || typeof saved.ownerIdentity !== 'string' || !Array.isArray(saved.children)) continue;
        if (this.processIdentity(saved.ownerPid) === saved.ownerIdentity) continue;
        for (const child of saved.children) {
          if (Number.isInteger(child.pid) && child.pid > 1 && typeof child.identity === 'string' && this.processIdentity(child.pid) === child.identity) {
            try { process.kill(-child.pid, 'SIGKILL'); } catch {}
          }
        }
        fs.unlinkSync(file);
      } catch (err) {
        console.error('[DevServerManager] Failed to recover preview processes:', err);
      }
    }
    this.recoveryFile = path.join(directory, `${process.pid}.json`);
    this.persistProcesses();
  }

  private persistProcesses(): void {
    if (!this.recoveryFile) return;
    const children = [...this.servers.values()].flatMap(({ proc }) => {
      const identity = proc?.pid && this.processIdentity(proc.pid);
      return identity ? [{ pid: proc!.pid, identity }] : [];
    });
    const temporaryFile = `${this.recoveryFile}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify({
      ownerPid: process.pid, ownerIdentity: this.processIdentity(process.pid), children,
    }), { mode: 0o600 });
    fs.renameSync(temporaryFile, this.recoveryFile);
  }

  async stopAll(): Promise<void> {
    const taskIds = new Set([...this.servers.keys(), ...this.pendingStarts.keys()]);
    await Promise.all([...taskIds].map((taskId) => this.stopServer(taskId)));
  }

  // Also runs for the desktop parent watchdog's process.exit path.
  forceStopAll(): void {
    for (const { proc } of this.servers.values()) {
      if (!proc?.pid) continue;
      try {
        if (process.platform === 'win32') execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
        else process.kill(-proc.pid, 'SIGKILL');
      } catch {}
    }
  }

  private async portIsOccupied(port: number): Promise<boolean> {
    const probe = (host: string) => new Promise<boolean>((resolve) => {
      const socket = net.connect({ host, port });
      socket.setTimeout(500);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
    });
    return (await probe('127.0.0.1')) || (await probe('::1'));
  }

  addSubscriber(taskId: string, subscriberId: any): void {
    let set = this.subscribers.get(taskId);
    if (!set) {
      set = new Set();
      this.subscribers.set(taskId, set);
    }
    set.add(subscriberId);
    // When a subscriber connects, cancel any pending stop for this task
    this.cancelPendingStop(taskId);
  }

  removeSubscriber(taskId: string, subscriberId: any): void {
    const set = this.subscribers.get(taskId);
    if (set) {
      set.delete(subscriberId);
      if (set.size === 0) {
        this.subscribers.delete(taskId);
      }
    }
  }

  getSubscriberCount(taskId: string): number {
    return this.subscribers.get(taskId)?.size || 0;
  }

  getActiveDevServerTaskIds(): string[] {
    const active: string[] = [];
    for (const [taskId, entry] of this.servers.entries()) {
      if (entry.state.status === 'running' || entry.state.status === 'starting') {
        active.push(taskId);
      }
    }
    return active;
  }

  private emitState(taskId: string, state: DevServerState): void {
    this.emit(`state:${taskId}`, state);
    this.emit('state_change', state);
  }

  schedulePendingStop(taskId: string, delayMs: number = 3000): boolean {
    const entry = this.servers.get(taskId);
    if (!entry || (entry.state.status !== 'running' && entry.state.status !== 'starting')) {
      return false;
    }

    this.cancelPendingStop(taskId);

    const timer = setTimeout(() => {
      this.pendingStops.delete(taskId);
      // Only stop if no active subscribers are viewing this task
      if (this.getSubscriberCount(taskId) <= 0) {
        void this.stopServer(taskId).catch(console.error);
      }
    }, delayMs);

    this.pendingStops.set(taskId, timer);
    return true;
  }

  cancelPendingStop(taskId: string): boolean {
    const timer = this.pendingStops.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.pendingStops.delete(taskId);
      return true;
    }
    return false;
  }

  getServerState(taskId: string): DevServerState {
    const entry = this.servers.get(taskId);
    if (entry) return entry.state;
    return {
      taskId,
      status: 'stopped',
      logs: [],
      devCmd: '',
      worktreePath: '',
    };
  }

  async startServer(taskId: string, worktreePath: string, devCmd: string, defaultPort: number = 5173): Promise<DevServerState> {
    const previous = this.pendingStarts.get(taskId);
    const starting = (async () => {
      if (previous) await previous.catch(() => {});
      return this.launchServer(taskId, worktreePath, devCmd, defaultPort);
    })();
    this.pendingStarts.set(taskId, starting);
    try { return await starting; }
    finally { if (this.pendingStarts.get(taskId) === starting) this.pendingStarts.delete(taskId); }
  }

  private async launchServer(
    taskId: string,
    worktreePath: string,
    devCmd: string,
    defaultPort: number = 5173
  ): Promise<DevServerState> {
    // Wait for the old process group to release its listener before restarting.
    await this.stopEntry(taskId);
    const occupied = await this.portIsOccupied(defaultPort);

    const state: DevServerState = {
      taskId,
      status: 'starting',
      port: defaultPort,
      url: `http://localhost:${defaultPort}`,
      logs: [],
      devCmd,
      worktreePath,
    };

    const env: NodeJS.ProcessEnv = {
      ...getCrossPlatformEnv(),
      FORCE_COLOR: '1',
    };
    // Ensure task dev servers do NOT bind to Tailscale IP or remote interfaces
    delete env.HOST;
    delete env.TAILSCALE_IP;

    const isWin = process.platform === 'win32';
    const proc = spawn(devCmd, {
      cwd: worktreePath,
      shell: true,
      env,
      detached: !isWin, // detached on POSIX for process group kill
    });

    const addLog = (text: string) => {
      state.logs.push(text);
      if (state.logs.length > 2000) state.logs.shift();
      this.emit(`log:${taskId}`, text);

      const entry = this.servers.get(taskId);
      if (!entry || entry.state !== state || entry.stopping) return;
      entry.output = ((entry.output || '') + text).slice(-8192);
      const detectedPort = detectDevServerPort(entry.output);
      if (detectedPort) {
        entry.portConfirmed = true;
        if (state.port !== detectedPort) {
          state.port = detectedPort;
          state.url = `http://localhost:${detectedPort}`;
          this.emitState(taskId, state);
        }
        if (!entry.proxy || entry.targetPort !== detectedPort) void this.ensureProxy(taskId, detectedPort);
      }
    };

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      addLog(text);
      if (state.status === 'starting' && !this.servers.get(taskId)?.stopping) {
        state.status = 'running';
        this.emitState(taskId, state);
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      addLog(text);
    });

    proc.on('close', (code) => {
      addLog(`\n[Dev Server process exited with code ${code}]\n`);
      const entry = this.servers.get(taskId);
      if (entry?.state !== state || entry.stopping) return;
      void this.stopServer(taskId).catch(console.error);
    });

    proc.on('error', (err) => {
      addLog(`\n[Dev Server error: ${err.message}]\n`);
      state.status = 'error';
      this.emitState(taskId, state);
    });

    this.servers.set(taskId, { proc, state, proxy: null, portConfirmed: !occupied });
    this.persistProcesses();
    this.emitState(taskId, state);
    if (!occupied) await this.ensureProxy(taskId, defaultPort);
    return state;
  }

  private ownsListener(pid: number | undefined, port: number): boolean {
    // macOS exposes both IPv4 and IPv6 listener owners through lsof.
    if (process.platform !== 'darwin') return true;
    if (!pid) return false;
    try {
      const pids = execSync(`lsof -nP -t -iTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\s+/);
      return pids.length > 0 && pids.every((listenerPid) => {
        const group = execSync(`ps -p ${Number(listenerPid)} -o pgid=`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        return Number(group) === pid;
      });
    } catch { return false; }
  }

  async ensureProxy(taskId: string, targetPort: number): Promise<void> {
    const entry = this.servers.get(taskId);
    if (!entry || entry.stopping || !entry.portConfirmed || entry.state.port !== targetPort || !this.ownsListener(entry.proc?.pid, targetPort)) return;

    if (entry.proxy && entry.proxy.port && entry.targetPort === targetPort) {
      return;
    }

    if (entry.proxy) {
      entry.proxy.close();
      entry.proxy = null;
    }

    try {
      const proxy = await startDevServerProxy(taskId, targetPort, '127.0.0.1');
      if (this.servers.get(taskId) !== entry || entry.stopping || entry.state.port !== targetPort || entry.state.status === 'stopped' || entry.state.status === 'error') {
        proxy.close();
        return;
      }
      (entry.proxy as DevServerProxyInstance | null)?.close();
      entry.targetPort = targetPort;
      entry.proxy = proxy;
      entry.state.proxyPort = proxy.port;
      entry.state.proxyUrl = `http://localhost:${proxy.port}`;
      this.emitState(taskId, entry.state);
    } catch (err: any) {
      console.error(`[DevServerManager] Failed to start preview proxy for task ${taskId}:`, err);
    }
  }

  async stopServer(taskId: string, options?: { onlyIfNoSubscribers?: boolean }): Promise<boolean> {
    // A Stop arriving while startup probes are pending must not leave a new process behind.
    await this.pendingStarts.get(taskId)?.catch(() => {});
    return this.stopEntry(taskId, options);
  }

  private async stopEntry(taskId: string, options?: { onlyIfNoSubscribers?: boolean }): Promise<boolean> {
    this.cancelPendingStop(taskId);
    if (options?.onlyIfNoSubscribers && this.getSubscriberCount(taskId) > 0) return false;
    const entry = this.servers.get(taskId);
    if (!entry) return false;
    if (entry.stopping) return entry.stopping;
    const wasRunning = entry.state.status === 'running' || entry.state.status === 'starting' || entry.proc !== null;
    entry.proxy?.close();
    entry.proxy = null;
    entry.targetPort = undefined;
    entry.state.proxyPort = undefined;
    entry.state.proxyUrl = undefined;
    entry.portConfirmed = false;

    entry.stopping = (async () => {
      const proc = entry.proc;
      if (proc?.pid) {
        const pid = proc.pid;
        const alive = () => {
          try { process.kill(process.platform === 'win32' ? pid : -pid, 0); return true; }
          catch (err: any) { return err.code !== 'ESRCH'; }
        };
        const kill = (signal: NodeJS.Signals) => {
          try {
            if (process.platform === 'win32') execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
            else process.kill(-pid, signal);
          } catch (err: any) { if (err.code !== 'ESRCH' && alive()) throw err; }
        };
        const wait = async (ms: number) => {
          const deadline = Date.now() + ms;
          while (alive() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
          return !alive();
        };
        kill('SIGTERM');
        if (!await wait(1000)) {
          kill('SIGKILL');
          if (!await wait(1000)) throw new Error('Dev server process group did not terminate');
        }
      }
      entry.proc = null;
      entry.state.status = 'stopped';
      this.persistProcesses();
      this.emitState(taskId, entry.state);
      return wasRunning;
    })();
    try { return await entry.stopping; }
    catch (err) {
      entry.state.status = 'error';
      this.emitState(taskId, entry.state);
      throw err;
    } finally { entry.stopping = undefined; }
  }

  async restartServer(taskId: string, defaultPort?: number): Promise<DevServerState> {
    this.cancelPendingStop(taskId);
    const entry = this.servers.get(taskId);
    if (!entry) throw new Error('No dev server configuration found for task');
    const { worktreePath, devCmd, port } = entry.state;
    return this.startServer(taskId, worktreePath, devCmd, defaultPort || port);
  }

  async checkServerReady(taskId: string): Promise<{ ready: boolean; port: number; proxyPort?: number }> {
    const entry = this.servers.get(taskId);
    if (!entry || entry.stopping || !entry.portConfirmed || !entry.proc || (entry.state.status !== 'running' && entry.state.status !== 'starting')) {
      return { ready: false, port: entry?.state.port || 5173, proxyPort: entry?.state.proxyPort };
    }
    const port = entry.state.port || 5173;
    const proxyPort = entry.state.proxyPort;
    if (!this.ownsListener(entry.proc.pid, port)) return { ready: false, port, proxyPort };

    const probe = (hostname: string): Promise<boolean> => {
      return new Promise((resolve) => {
        const req = http.get(
          {
            hostname,
            port,
            path: '/',
            timeout: 800,
          },
          (res) => {
            res.resume();
            resolve(true);
          }
        );
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
        req.on('error', () => {
          req.destroy();
          resolve(false);
        });
      });
    };

    const isReady127 = await probe('127.0.0.1');
    if (isReady127) {
      await this.ensureProxy(taskId, port);
      entry.proxy?.setTargetHost('127.0.0.1');
      return { ready: Boolean(entry.proxy) && !entry.stopping, port, proxyPort: entry.state.proxyPort };
    }
    const isReadyIpv6 = await probe('::1');
    if (isReadyIpv6) {
      await this.ensureProxy(taskId, port);
      entry.proxy?.setTargetHost('::1');
      return { ready: Boolean(entry.proxy) && !entry.stopping, port, proxyPort: entry.state.proxyPort };
    }
    return { ready: false, port, proxyPort };
  }
}

export const devServerManager = new DevServerManager();
