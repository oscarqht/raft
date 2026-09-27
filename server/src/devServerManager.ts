import { spawn, execSync, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { getCrossPlatformEnv } from './agentRunner.js';

export interface DevServerState {
  taskId: string;
  status: 'stopped' | 'starting' | 'running' | 'error';
  port?: number;
  url?: string;
  logs: string[];
  devCmd: string;
  worktreePath: string;
}

class DevServerManager extends EventEmitter {
  private servers: Map<string, {
    proc: ChildProcess | null;
    state: DevServerState;
  }> = new Map();

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

  startServer(
    taskId: string,
    worktreePath: string,
    devCmd: string,
    defaultPort: number = 5173
  ): DevServerState {
    // If already running, stop first
    this.stopServer(taskId);

    const state: DevServerState = {
      taskId,
      status: 'starting',
      port: defaultPort,
      url: `http://localhost:${defaultPort}`,
      logs: [],
      devCmd,
      worktreePath,
    };

    const env = {
      ...getCrossPlatformEnv(),
      FORCE_COLOR: '1',
    };

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

      // Detect port from output
      const portMatch = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1):([0-9]{3,5})/i) ||
                        text.match(/(?:port|localhost:)\s*([0-9]{4,5})/i);
      if (portMatch && portMatch[1]) {
        const detectedPort = parseInt(portMatch[1], 10);
        if (state.port !== detectedPort) {
          state.port = detectedPort;
          state.url = `http://localhost:${detectedPort}`;
          state.status = 'running';
          this.emit(`state:${taskId}`, state);
        }
      }
    };

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      addLog(text);
      if (state.status === 'starting') {
        state.status = 'running';
        this.emit(`state:${taskId}`, state);
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      addLog(text);
    });

    proc.on('close', (code) => {
      addLog(`\n[Dev Server process exited with code ${code}]\n`);
      state.status = 'stopped';
      this.emit(`state:${taskId}`, state);
    });

    proc.on('error', (err) => {
      addLog(`\n[Dev Server error: ${err.message}]\n`);
      state.status = 'error';
      this.emit(`state:${taskId}`, state);
    });

    this.servers.set(taskId, { proc, state });
    this.emit(`state:${taskId}`, state);
    return state;
  }

  stopServer(taskId: string): void {
    const entry = this.servers.get(taskId);
    if (!entry || !entry.proc) return;

    try {
      if (entry.proc.pid) {
        if (process.platform === 'win32') {
          // On Windows, use taskkill to kill process tree cleanly
          try {
            execSync(`taskkill /pid ${entry.proc.pid} /T /F`, { stdio: 'ignore' });
          } catch {}
        } else {
          // Kill process group on POSIX
          process.kill(-entry.proc.pid, 'SIGTERM');
        }
      } else {
        entry.proc.kill('SIGTERM');
      }
    } catch {
      try {
        entry.proc.kill('SIGKILL');
      } catch {}
    }

    entry.state.status = 'stopped';
    entry.proc = null;
    this.emit(`state:${taskId}`, entry.state);
  }

  restartServer(taskId: string, defaultPort?: number): DevServerState {
    const entry = this.servers.get(taskId);
    if (!entry) throw new Error('No dev server configuration found for task');
    const { worktreePath, devCmd, port } = entry.state;
    this.stopServer(taskId);
    return this.startServer(taskId, worktreePath, devCmd, defaultPort || port);
  }

  async checkServerReady(taskId: string): Promise<{ ready: boolean; port: number }> {
    const entry = this.servers.get(taskId);
    if (!entry || (entry.state.status !== 'running' && entry.state.status !== 'starting')) {
      return { ready: false, port: entry?.state.port || 5173 };
    }
    const port = entry.state.port || 5173;

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
      return { ready: true, port };
    }
    const isReadyIpv6 = await probe('::1');
    return { ready: isReadyIpv6, port };
  }
}

export const devServerManager = new DevServerManager();
