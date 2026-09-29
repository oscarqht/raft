import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import os from 'node:os';

export interface AlphaDeviceStatus {
  connected: boolean;
  status: 'connected' | 'connecting' | 'needs_auth' | 'disconnected';
  clientId?: string;
  loginUrl?: string;
  error?: string;
  lastConnectedAt?: number;
}

export interface AlphaTokenRecord {
  clientId?: string;
  token: string;
  refreshToken: string;
  tokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  client?: {
    id: number;
    clientId: string;
    creatorId: number;
    name: string;
    clientType: number;
  };
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 600_000;
const RECONNECT_DELAY_MS = 5_000;

export class AlphaDeviceService {
  private socket: WebSocket | null = null;
  private status: AlphaDeviceStatus['status'] = 'disconnected';
  private clientId?: string;
  private loginUrl?: string;
  private lastError?: string;
  private lastConnectedAt?: number;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private activeWorktreePath: string = process.cwd();
  private baseUrl: string = '';
  private stopped: boolean = false;

  constructor() {
    this.tokenFilePath = join(homedir(), '.raft', 'alphamouse_credentials.json');
  }

  private tokenFilePath: string;

  public setActiveWorktree(worktreePath: string): void {
    if (worktreePath && worktreePath.trim()) {
      this.activeWorktreePath = worktreePath.trim();
    }
  }

  public getActiveWorktree(): string {
    return this.activeWorktreePath;
  }

  public getClientId(): string | undefined {
    return this.clientId;
  }

  public getStatus(): AlphaDeviceStatus {
    return {
      connected: this.status === 'connected',
      status: this.status,
      clientId: this.clientId,
      loginUrl: this.loginUrl,
      error: this.lastError,
      lastConnectedAt: this.lastConnectedAt,
    };
  }

  public updateBaseUrlFromApiUrl(apiUrl: string): void {
    if (!apiUrl) return;
    try {
      const parsed = new URL(apiUrl.trim());
      const newBase = `${parsed.protocol}//${parsed.host}`;
      if (newBase !== this.baseUrl) {
        this.baseUrl = newBase;
        this.reconnect();
      }
    } catch {
      // invalid URL, ignore
    }
  }

  public reconnect(): void {
    this.disconnect();
    this.stopped = false;
    this.connect();
  }

  public disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close(1000, 'User disconnect');
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.status = 'disconnected';
  }

  private async loadTokens(): Promise<AlphaTokenRecord | null> {
    try {
      const data = await readFile(this.tokenFilePath, 'utf8');
      return JSON.parse(data) as AlphaTokenRecord;
    } catch {
      return null;
    }
  }

  private async saveTokens(tokens: AlphaTokenRecord): Promise<void> {
    try {
      await mkdir(join(homedir(), '.raft'), { recursive: true });
      await writeFile(this.tokenFilePath, JSON.stringify(tokens, null, 2), 'utf8');
    } catch (err) {
      console.error('[AlphaDevice] Failed to save tokens:', err);
    }
  }

  public async connect(): Promise<void> {
    if (this.stopped || !this.baseUrl) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.status = 'connecting';
    this.lastError = undefined;

    const tokens = await this.loadTokens();
    if (tokens?.token) {
      this.connectAuthenticated(tokens);
    } else {
      this.connectSetup();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private connectAuthenticated(tokens: AlphaTokenRecord): void {
    const wsUrl = this.buildWsUrl('/webapi/client/ws');
    console.log(`[AlphaDevice] Connecting authenticated to ${wsUrl}`);

    try {
      const socket = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${tokens.token}`,
        },
      });
      this.socket = socket;

      socket.on('open', () => {
        console.log('[AlphaDevice] WebSocket opened (authenticated)');
      });

      socket.on('message', (raw) => {
        this.handleMessage(raw.toString(), tokens);
      });

      socket.on('close', (code, reason) => {
        console.log(`[AlphaDevice] Closed (${code}): ${reason}`);
        this.socket = null;
        if (code === 4001 || code === 4003 || code === 4401) {
          // Token expired or invalid, switch to setup
          this.connectSetup();
        } else {
          this.status = 'disconnected';
          this.scheduleReconnect();
        }
      });

      socket.on('error', (err) => {
        console.error('[AlphaDevice] Socket error:', err.message);
        this.lastError = err.message;
      });
    } catch (err: any) {
      console.error('[AlphaDevice] Connection failed:', err);
      this.lastError = err.message;
      this.status = 'disconnected';
      this.scheduleReconnect();
    }
  }

  private connectSetup(): void {
    const wsUrl = this.buildWsUrl('/webapi/client/auth/ws');
    console.log(`[AlphaDevice] Connecting setup to ${wsUrl}`);

    try {
      const socket = new WebSocket(wsUrl);
      this.socket = socket;

      socket.on('open', () => {
        console.log('[AlphaDevice] Setup WebSocket opened, sending init');
        socket.send(
          JSON.stringify({
            name: `Raft (${os.hostname()})`,
            clientType: 1, // CLIENT_TYPE_DESKTOP
            deviceInfo: {
              os: process.platform,
              arch: process.arch,
              appVersion: '0.1.0',
              nodeVersion: process.version,
              hostname: os.hostname(),
            },
            tools: this.getToolDefinitions(),
          })
        );
      });

      socket.on('message', (raw) => {
        this.handleMessage(raw.toString(), null);
      });

      socket.on('close', (code, reason) => {
        console.log(`[AlphaDevice] Setup closed (${code}): ${reason}`);
        this.socket = null;
        this.status = 'disconnected';
        this.scheduleReconnect();
      });

      socket.on('error', (err) => {
        console.error('[AlphaDevice] Setup error:', err.message);
        this.lastError = err.message;
      });
    } catch (err: any) {
      console.error('[AlphaDevice] Setup connection failed:', err);
      this.lastError = err.message;
      this.status = 'disconnected';
      this.scheduleReconnect();
    }
  }

  private buildWsUrl(path: string): string {
    const url = new URL(this.baseUrl);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}${path}`;
  }

  private async handleMessage(raw: string, currentTokens: AlphaTokenRecord | null): Promise<void> {
    try {
      const data = JSON.parse(raw);

      // Handle Auth Session (needs login)
      if (data.type === 'auth_session') {
        this.status = 'needs_auth';
        this.loginUrl = data.loginURL || (data.loginPath ? `${this.baseUrl}${data.loginPath}` : undefined);
        console.log(`[AlphaDevice] Auth required. Login URL: ${this.loginUrl}`);
        return;
      }

      // Handle Auth Result (authenticated)
      if (data.type === 'auth_result' && data.client) {
        this.status = 'connected';
        this.clientId = data.client.clientId;
        this.lastConnectedAt = Date.now();
        this.loginUrl = undefined;
        this.lastError = undefined;
        console.log(`[AlphaDevice] Successfully connected as ${this.clientId}`);

        if (data.token && data.refreshToken) {
          const newTokens: AlphaTokenRecord = {
            clientId: data.client.clientId,
            client: data.client,
            token: data.token,
            refreshToken: data.refreshToken,
            tokenExpiresAt: data.tokenExpiresAt || Math.floor(Date.now() / 1000) + 7200,
            refreshTokenExpiresAt: data.refreshTokenExpiresAt || Math.floor(Date.now() / 1000) + 2592000,
          };
          await this.saveTokens(newTokens);
        } else if (currentTokens) {
          this.clientId = currentTokens.clientId;
        }
        return;
      }

      // Handle JSON-RPC 2.0 requests
      if (data.jsonrpc === '2.0' && data.method) {
        await this.handleJsonRpc(data);
      }
    } catch (err) {
      console.error('[AlphaDevice] Error parsing message:', err, raw);
    }
  }

  private async handleJsonRpc(req: { jsonrpc: '2.0'; id: any; method: string; params?: any }): Promise<void> {
    const { id, method, params } = req;

    if (method === 'tools/list') {
      this.sendResult(id, { tools: this.getToolDefinitions() });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      console.log(`[AlphaDevice] Calling tool: ${toolName}`, toolArgs);

      if (toolName === 'get_info') {
        const info = {
          deviceInfo: {
            os: process.platform,
            arch: process.arch,
            hostname: os.hostname(),
          },
          currentWorktree: this.activeWorktreePath,
          runtime: {
            defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
            maxTimeoutMs: MAX_TIMEOUT_MS,
          },
        };
        this.sendResult(id, {
          content: [{ type: 'text', text: JSON.stringify(info) }],
          isError: false,
        });
        return;
      }

      if (toolName === 'run_command') {
        try {
          const result = await this.executeCommand(toolArgs);
          this.sendResult(id, {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            isError: false,
          });
        } catch (err: any) {
          this.sendResult(id, {
            content: [{ type: 'text', text: err.message || 'Execution error' }],
            isError: true,
          });
        }
        return;
      }

      this.sendResult(id, {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      });
      return;
    }

    if (method === 'ping') {
      this.sendResult(id, { pong: true });
      return;
    }

    this.sendError(id, -32601, `Method not found: ${method}`);
  }

  private sendResult(id: any, result: any): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        result,
      })
    );
  }

  private sendError(id: any, code: number, message: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code, message },
      })
    );
  }

  private getToolDefinitions() {
    return [
      {
        name: 'get_info',
        description: 'Get device info, current worktree, and capabilities of this terminal client.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: 'run_command',
        description: 'Run a terminal command on the local laptop and return stdout and stderr.',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'Command executable to run.',
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional command arguments.',
            },
            cwd: {
              type: 'string',
              description: 'Working directory for the command. Defaults to the current active git worktree.',
            },
            timeoutMs: {
              type: 'number',
              description: `Optional timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS}; max ${MAX_TIMEOUT_MS}.`,
            },
          },
          required: ['command'],
          additionalProperties: false,
        },
      },
    ];
  }

  private async executeCommand(args: {
    command: string;
    args?: string[];
    cwd?: string;
    timeoutMs?: number;
  }): Promise<{
    command: string;
    args: string[];
    cwd: string;
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    durationMs: number;
    timedOut: boolean;
  }> {
    const rawCmd = args.command?.trim();
    if (!rawCmd) throw new Error('command must be a non-empty string.');

    const effectiveCwd = args.cwd?.trim() || this.activeWorktreePath || process.cwd();
    const cmdArgs = Array.isArray(args.args) ? args.args : [];
    const timeout = Math.min(Math.max(1000, args.timeoutMs || DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS);

    const startTime = Date.now();
    let timedOut = false;
    let stdout = '';
    let stderr = '';

    return new Promise((resolve) => {
      // Execute command in shell for flexible developer commands (e.g. pipes, shell scripts)
      const child = spawn(rawCmd, cmdArgs, {
        cwd: effectiveCwd,
        env: process.env,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 2000);
      }, timeout);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (d) => {
        stdout += d;
      });

      child.stderr.on('data', (d) => {
        stderr += d;
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolve({
          command: rawCmd,
          args: cmdArgs,
          cwd: effectiveCwd,
          exitCode: code,
          signal: signal ? String(signal) : null,
          stdout,
          stderr,
          durationMs: Date.now() - startTime,
          timedOut,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          command: rawCmd,
          args: cmdArgs,
          cwd: effectiveCwd,
          exitCode: 1,
          signal: null,
          stdout,
          stderr: stderr ? `${stderr}\n${err.message}` : err.message,
          durationMs: Date.now() - startTime,
          timedOut,
        });
      });
    });
  }
}

// Global singleton instance for the server
export const alphaDeviceService = new AlphaDeviceService();
