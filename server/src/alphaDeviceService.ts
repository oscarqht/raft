import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import os from 'node:os';

export interface AlphaDeviceStatus {
  connected: boolean;
  status: 'connected' | 'connecting' | 'needs_auth' | 'pairing' | 'disconnected';
  clientId?: string;
  clientName?: string;
  userEmail?: string;
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

function extractEmailFromJwt(token?: string): string | undefined {
  if (!token) return undefined;
  try {
    const parts = token.split('.');
    if (parts.length >= 2) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return payload.email || undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 600_000;
const RECONNECT_DELAY_MS = 5_000;
const DEFAULT_REFRESH_SKEW_SECONDS = 300; // 5 minutes before expiry
const MAX_STREAM_CAPTURE_BYTES = 350_000; // 350KB safe buffer per stream
const MAX_PAYLOAD_SAFE_BYTES = 900_000; // Hard ceiling below remote 1,048,576 byte limit

export function isTokenExpiring(expiresAt?: number, skewSeconds = DEFAULT_REFRESH_SKEW_SECONDS): boolean {
  if (!expiresAt) return false;
  return expiresAt - skewSeconds <= Math.floor(Date.now() / 1000);
}

export class AlphaDeviceService extends EventEmitter {
  private socket: WebSocket | null = null;
  private status: AlphaDeviceStatus['status'] = 'disconnected';
  private clientId?: string;
  private clientName?: string;
  private userEmail?: string;
  private loginUrl?: string;
  private lastError?: string;
  private lastConnectedAt?: number;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private activeWorktreePath: string = process.cwd();
  private baseUrl: string = '';
  private stopped: boolean = false;

  constructor() {
    super();
    this.tokenFilePath = join(homedir(), '.raft', 'alphamouse_credentials.json');
    this.loadTokens().catch(() => {});
  }

  private tokenFilePath: string;

  private notifyStatusChange(): void {
    this.emit('status_change', this.getStatus());
  }

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

  public async getUserEmail(): Promise<string | undefined> {
    if (this.userEmail) {
      return this.userEmail;
    }
    const tokens = await this.loadTokens();
    if (tokens) {
      this.populateFromTokens(tokens);
    }
    return this.userEmail;
  }

  private populateFromTokens(tokens: AlphaTokenRecord): void {
    if (tokens.clientId) {
      this.clientId = tokens.clientId;
    }
    if (tokens.client?.name) {
      this.clientName = tokens.client.name;
    }
    const email = extractEmailFromJwt(tokens.token) || extractEmailFromJwt(tokens.refreshToken);
    if (email) {
      this.userEmail = email;
    }
  }

  public getStatus(): AlphaDeviceStatus {
    return {
      connected: this.status === 'connected',
      status: this.status,
      clientId: this.clientId,
      clientName: this.clientName,
      userEmail: this.userEmail,
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
    this.refreshPromise = null;
    this.currentRefreshKey = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.socket) {
      const oldSocket = this.socket;
      this.socket = null;
      try {
        oldSocket.removeAllListeners();
        oldSocket.on('error', () => {});
        if (oldSocket.readyState === WebSocket.OPEN) {
          oldSocket.close(1000, 'User disconnect');
        } else {
          oldSocket.terminate();
        }
      } catch {
        // ignore
      }
    }
    this.status = 'disconnected';
    this.notifyStatusChange();
  }

  private refreshPromise: Promise<AlphaTokenRecord | null> | null = null;
  private currentRefreshKey: string | null = null;

  public async refreshTokens(refreshToken: string): Promise<AlphaTokenRecord | null> {
    if (!this.baseUrl || !refreshToken) {
      return null;
    }

    const key = `${this.baseUrl}:${refreshToken}`;
    if (this.refreshPromise && this.currentRefreshKey === key) {
      return this.refreshPromise;
    }

    this.currentRefreshKey = key;
    this.refreshPromise = this.doRefreshTokens(refreshToken).finally(() => {
      if (this.currentRefreshKey === key) {
        this.refreshPromise = null;
        this.currentRefreshKey = null;
      }
    });

    return this.refreshPromise;
  }

  private async doRefreshTokens(refreshToken: string): Promise<AlphaTokenRecord | null> {
    if (!this.baseUrl) return null;
    let refreshUrl: string;
    try {
      refreshUrl = new URL('/webapi/client/auth/refresh', this.baseUrl).toString();
    } catch {
      return null;
    }
    console.log(`[AlphaDevice] Refreshing tokens via ${refreshUrl}`);

    try {
      const response = await fetch(refreshUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.warn(`[AlphaDevice] Token refresh returned HTTP ${response.status}: ${errorText}`);
        return null;
      }

      const data = (await response.json()) as any;
      if (!data?.token) {
        console.warn('[AlphaDevice] Token refresh response missing token field', data);
        return null;
      }

      const newTokens: AlphaTokenRecord = {
        clientId: data.client?.clientId || data.clientId || this.clientId,
        client: data.client,
        token: data.token,
        refreshToken: data.refreshToken || refreshToken,
        tokenExpiresAt: data.tokenExpiresAt || Math.floor(Date.now() / 1000) + 7200,
        refreshTokenExpiresAt: data.refreshTokenExpiresAt || Math.floor(Date.now() / 1000) + 2592000,
      };

      this.populateFromTokens(newTokens);
      await this.saveTokens(newTokens);
      console.log(`[AlphaDevice] Successfully refreshed tokens for clientId=${newTokens.clientId}`);
      this.scheduleTokenRefresh(newTokens);
      return newTokens;
    } catch (err: any) {
      console.error('[AlphaDevice] Failed to refresh tokens:', err.message);
      return null;
    }
  }

  private scheduleTokenRefresh(tokens: AlphaTokenRecord): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (!tokens.tokenExpiresAt || !tokens.refreshToken) return;

    const refreshAtMs = (tokens.tokenExpiresAt - DEFAULT_REFRESH_SKEW_SECONDS) * 1000;
    const delayMs = Math.max(10_000, refreshAtMs - Date.now());
    console.log(`[AlphaDevice] Scheduling next token refresh in ${Math.round(delayMs / 1000)}s`);

    this.refreshTimer = setTimeout(async () => {
      this.refreshTimer = null;
      if (this.stopped || !tokens.refreshToken) return;
      console.log('[AlphaDevice] Proactive token refresh timer fired');
      const refreshed = await this.refreshTokens(tokens.refreshToken);
      if (refreshed?.token && this.socket && this.socket.readyState === WebSocket.OPEN) {
        // Reconnect seamlessly with new token
        this.connect(true);
      }
    }, delayMs);
    this.refreshTimer.unref?.();
  }

  public async ensureConnected(timeoutMs = 10_000): Promise<boolean> {
    if (this.status === 'connected' && this.socket && this.socket.readyState === WebSocket.OPEN) {
      return true;
    }
    if (!this.baseUrl) {
      return false;
    }

    this.stopped = false;
    await this.connect();

    if (this.status === 'connected') {
      return true;
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.off('status_change', checkStatus);
        resolve(this.status === 'connected');
      }, timeoutMs);

      const checkStatus = (status: AlphaDeviceStatus) => {
        if (status.status === 'connected') {
          clearTimeout(timer);
          this.off('status_change', checkStatus);
          resolve(true);
        } else if (status.status === 'disconnected' || status.status === 'needs_auth') {
          clearTimeout(timer);
          this.off('status_change', checkStatus);
          resolve(false);
        }
      };

      this.on('status_change', checkStatus);
    });
  }

  private getTokenPaths(): string[] {
    const home = homedir();
    const paths: string[] = [];
    if (this.baseUrl) {
      try {
        const digest = createHash('sha256').update(this.baseUrl.trim().replace(/\/+$/, '')).digest('hex').slice(0, 16);
        paths.push(join(home, '.alphamouse', 'terminal-tokens', `${digest}.json`));
        paths.push(join(home, '.device-mcp', 'terminal-tokens', `${digest}.json`));
      } catch {
        // ignore
      }
    }
    paths.push(this.tokenFilePath);
    return paths;
  }

  private async loadTokens(): Promise<AlphaTokenRecord | null> {
    for (const path of this.getTokenPaths()) {
      try {
        const data = await readFile(path, 'utf8');
        const parsed = JSON.parse(data) as AlphaTokenRecord;
        if (parsed && (parsed.token || parsed.clientId)) {
          this.populateFromTokens(parsed);
          return parsed;
        }
      } catch {
        // continue checking next path
      }
    }
    return null;
  }

  private async saveTokens(tokens: AlphaTokenRecord): Promise<void> {
    const home = homedir();
    if (this.baseUrl) {
      try {
        const digest = createHash('sha256').update(this.baseUrl.trim().replace(/\/+$/, '')).digest('hex').slice(0, 16);
        const alphaDir = join(home, '.alphamouse', 'terminal-tokens');
        await mkdir(alphaDir, { recursive: true });
        await writeFile(join(alphaDir, `${digest}.json`), JSON.stringify(tokens, null, 2), 'utf8');
      } catch (err) {
        // non-fatal
      }
    }
    try {
      await mkdir(join(home, '.raft'), { recursive: true });
      await writeFile(this.tokenFilePath, JSON.stringify(tokens, null, 2), 'utf8');
    } catch (err) {
      console.error('[AlphaDevice] Failed to save tokens:', err);
    }
  }

  public async connect(force = false): Promise<void> {
    if (this.stopped || !this.baseUrl) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Guard against duplicate connection attempts while already connected or connecting
    if (!force && this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      console.log(`[AlphaDevice] Already connected or connecting (state=${this.socket.readyState}), skipping connect()`);
      return;
    }

    // Clean up any old socket before opening a new one
    if (this.socket) {
      const oldSocket = this.socket;
      this.socket = null;
      try {
        oldSocket.removeAllListeners();
        oldSocket.on('error', () => {});
        if (oldSocket.readyState === WebSocket.OPEN) {
          oldSocket.close(1000, 'Replaced by new connection');
        } else {
          oldSocket.terminate();
        }
      } catch {}
    }

    this.status = 'connecting';
    this.lastError = undefined;
    this.notifyStatusChange();

    let tokens = await this.loadTokens();
    if (tokens?.token) {
      // Check if access token is expired or expiring soon, refresh if possible
      if (tokens.refreshToken && isTokenExpiring(tokens.tokenExpiresAt)) {
        console.log('[AlphaDevice] Stored token expired or expiring soon, refreshing before connect...');
        const refreshed = await this.refreshTokens(tokens.refreshToken);
        if (refreshed?.token) {
          tokens = refreshed;
        } else {
          console.warn('[AlphaDevice] Token refresh failed, falling back to setup mode');
          this.connectSetup();
          return;
        }
      }
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
    if (!wsUrl) return;
    console.log(`[AlphaDevice] Connecting authenticated to ${wsUrl}`);

    try {
      const socket = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${tokens.token}`,
        },
      });
      this.socket = socket;

      socket.on('open', () => {
        if (this.socket !== socket) return;
        console.log('[AlphaDevice] WebSocket opened (authenticated)');
        this.status = 'connected';
        if (tokens.clientId) {
          this.clientId = tokens.clientId;
        }
        this.lastConnectedAt = Date.now();
        this.lastError = undefined;
        this.notifyStatusChange();
        this.scheduleTokenRefresh(tokens);
      });

      socket.on('message', (raw) => {
        this.handleMessage(raw.toString(), tokens, socket);
      });

      socket.on('unexpected-response', (req, res) => {
        console.error(`[AlphaDevice] Handshake rejected with HTTP ${res.statusCode} ${res.statusMessage}`);
        res.resume();
        try {
          socket.terminate();
        } catch {}
        if (this.socket === socket) {
          this.socket = null;
          if (res.statusCode === 401 || res.statusCode === 403) {
            void this.handleAuthFailure(tokens);
          } else {
            this.lastError = `Server returned HTTP ${res.statusCode} ${res.statusMessage}`;
            this.status = 'disconnected';
            this.notifyStatusChange();
            this.scheduleReconnect();
          }
        }
      });

      socket.on('close', (code, reason) => {
        console.log(`[AlphaDevice] Closed (${code}): ${reason}`);
        if (this.socket === socket) {
          this.socket = null;
          if (code === 4001 || code === 4003 || code === 4401) {
            // Token expired or invalid, switch to refresh / setup
            void this.handleAuthFailure(tokens);
          } else if (code === 1009) {
            this.lastError = 'Message payload exceeded server size limit';
            this.status = 'disconnected';
            this.notifyStatusChange();
            this.scheduleReconnect();
          } else {
            this.status = 'disconnected';
            this.notifyStatusChange();
            this.scheduleReconnect();
          }
        }
      });

      socket.on('error', (err) => {
        console.error('[AlphaDevice] Socket error:', err.message);
        if (this.socket === socket) {
          this.lastError = err.message;
          if (this.status === 'connecting') {
            this.status = 'disconnected';
            this.scheduleReconnect();
          }
          this.notifyStatusChange();
        }
      });
    } catch (err: any) {
      console.error('[AlphaDevice] Connection failed:', err);
      this.lastError = err.message;
      this.status = 'disconnected';
      this.notifyStatusChange();
      this.scheduleReconnect();
    }
  }

  private async handleAuthFailure(tokens: AlphaTokenRecord): Promise<void> {
    if (this.stopped) return;
    if (tokens.refreshToken) {
      console.log('[AlphaDevice] Authentication failed, attempting token refresh...');
      const refreshed = await this.refreshTokens(tokens.refreshToken);
      if (refreshed?.token) {
        console.log('[AlphaDevice] Token refreshed after auth failure, reconnecting...');
        this.connectAuthenticated(refreshed);
        return;
      }
    }
    console.warn('[AlphaDevice] Unable to refresh token, switching to setup mode');
    this.connectSetup();
  }

  private connectSetup(): void {
    const wsUrl = this.buildWsUrl('/webapi/client/auth/ws');
    if (!wsUrl) return;
    console.log(`[AlphaDevice] Connecting setup to ${wsUrl}`);

    try {
      const socket = new WebSocket(wsUrl);
      this.socket = socket;

      socket.on('open', () => {
        if (this.socket !== socket) return;
        console.log('[AlphaDevice] Setup WebSocket opened, sending init');
        socket.send(
          JSON.stringify({
            name: `Raft Terminal (${os.hostname()})`,
            clientType: 1, // CLIENT_TYPE_DESKTOP
            deviceInfo: JSON.stringify({
              platform: process.platform,
              type: os.type(),
              release: os.release(),
              version: os.version(),
              arch: process.arch,
              hostname: os.hostname(),
              nodeVersion: process.version,
              cwd: this.activeWorktreePath || process.cwd(),
            }),
            tools: JSON.stringify(this.getToolDefinitions()),
          })
        );
      });

      socket.on('message', (raw) => {
        this.handleMessage(raw.toString(), null, socket);
      });

      socket.on('unexpected-response', (req, res) => {
        console.error(`[AlphaDevice] Setup handshake rejected with HTTP ${res.statusCode} ${res.statusMessage}`);
        res.resume();
        try {
          socket.terminate();
        } catch {}
        if (this.socket === socket) {
          this.socket = null;
          this.lastError = `Setup returned HTTP ${res.statusCode} ${res.statusMessage}`;
          this.status = 'disconnected';
          this.notifyStatusChange();
          this.scheduleReconnect();
        }
      });

      socket.on('close', (code, reason) => {
        console.log(`[AlphaDevice] Setup closed (${code}): ${reason}`);
        if (this.socket === socket) {
          this.socket = null;
          this.status = 'disconnected';
          this.notifyStatusChange();
          this.scheduleReconnect();
        }
      });

      socket.on('error', (err) => {
        console.error('[AlphaDevice] Setup error:', err.message);
        if (this.socket === socket) {
          this.lastError = err.message;
          if (this.status === 'connecting') {
            this.status = 'disconnected';
            this.scheduleReconnect();
          }
          this.notifyStatusChange();
        }
      });
    } catch (err: any) {
      console.error('[AlphaDevice] Setup connection failed:', err);
      this.lastError = err.message;
      this.status = 'disconnected';
      this.notifyStatusChange();
      this.scheduleReconnect();
    }
  }

  private buildWsUrl(path: string): string {
    if (!this.baseUrl) return '';
    try {
      const url = new URL(this.baseUrl);
      const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${url.host}${path}`;
    } catch {
      return '';
    }
  }

  private withLoginSuccessRedirect(loginUrl: string): string {
    try {
      const url = new URL(loginUrl);
      const redir = new URL('/login-success', this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`).toString();
      url.searchParams.set('redir_url', redir);
      return url.toString();
    } catch {
      return loginUrl;
    }
  }

  private async handleMessage(raw: string, currentTokens: AlphaTokenRecord | null, socket: WebSocket): Promise<void> {
    try {
      const data = JSON.parse(raw);

      // Handle Auth Session (needs login)
      if (data.type === 'auth_session') {
        this.status = 'needs_auth';
        const rawLoginUrl = data.loginURL || (data.loginPath ? `${this.baseUrl}${data.loginPath}` : undefined);
        this.loginUrl = rawLoginUrl ? this.withLoginSuccessRedirect(rawLoginUrl) : undefined;
        console.log(`[AlphaDevice] Auth required. Login URL: ${this.loginUrl}`);
        this.notifyStatusChange();
        return;
      }

      // Handle Auth Result (authenticated)
      if (data.type === 'auth_result' && data.client) {
        this.status = 'connected';
        this.clientId = data.client.clientId;
        this.clientName = data.client.name;
        this.lastConnectedAt = Date.now();
        this.loginUrl = undefined;
        this.lastError = undefined;
        if (data.token) {
          const email = extractEmailFromJwt(data.token);
          if (email) this.userEmail = email;
        }
        console.log(`[AlphaDevice] Successfully connected as ${this.clientId} (${this.clientName || 'unnamed'})`);
        this.notifyStatusChange();

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
          if (currentTokens.client?.name) {
            this.clientName = currentTokens.client.name;
          }
        }
        return;
      }

      // Handle JSON-RPC 2.0 requests
      if (data.jsonrpc === '2.0' && data.method) {
        await this.handleJsonRpc(data, socket);
      }
    } catch (err) {
      console.error('[AlphaDevice] Error parsing message:', err, raw);
    }
  }

  private async handleJsonRpc(
    req: { jsonrpc: '2.0'; id: any; method: string; params?: any },
    socket: WebSocket
  ): Promise<void> {
    const { id, method, params } = req;

    if (method === 'tools/list') {
      this.sendResult(socket, id, { tools: this.getToolDefinitions() });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      console.log(`[AlphaDevice] Calling tool: ${toolName}`, toolArgs);

      if (toolName === 'get_info') {
        const home = homedir();
        const effectiveCwd = this.activeWorktreePath || home;
        const info = {
          deviceInfo: {
            platform: process.platform,
            type: os.type(),
            release: os.release(),
            version: os.version(),
            arch: process.arch,
            hostname: os.hostname(),
            nodeVersion: process.version,
            cwd: effectiveCwd,
            homeDir: home,
            downloadsDir: join(home, 'Downloads'),
            user: os.userInfo?.().username || process.env.USER || '',
          },
          runtime: {
            defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
            maxTimeoutMs: MAX_TIMEOUT_MS,
          },
          accessScope: {
            unrestricted: true,
            roots: [effectiveCwd, home],
          },
          commandWhitelist: {
            unrestricted: true,
            commands: [],
          },
          currentWorktree: this.activeWorktreePath,
        };
        this.sendResult(socket, id, {
          structuredContent: info,
          content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
          isError: false,
        });
        return;
      }

      if (toolName === 'run_command') {
        try {
          const result = await this.executeCommand(toolArgs);
          this.sendResult(socket, id, {
            structuredContent: result,
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: false,
          });
        } catch (err: any) {
          this.sendResult(socket, id, {
            content: [{ type: 'text', text: err.message || 'Execution error' }],
            isError: true,
          });
        }
        return;
      }

      this.sendResult(socket, id, {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      });
      return;
    }

    if (method === 'ping') {
      this.sendResult(socket, id, { pong: true });
      return;
    }

    this.sendError(socket, id, -32601, `Method not found: ${method}`);
  }

  private sendResult(socket: WebSocket, id: any, result: any): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error(`[AlphaDevice] Failed to send result for req id=${id}: socket not open (state=${socket?.readyState})`);
      return;
    }

    let finalResult = result;
    let payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      result: finalResult,
    });

    // Guard against exceeding the remote server's 1MB (1,048,576 byte) read limit
    if (Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_SAFE_BYTES) {
      console.warn(`[AlphaDevice] Result payload size (${Buffer.byteLength(payload, 'utf8')} bytes) exceeds safe limit (${MAX_PAYLOAD_SAFE_BYTES} bytes), trimming content`);
      if (finalResult && typeof finalResult === 'object') {
        const sc = finalResult.structuredContent ? { ...finalResult.structuredContent } : undefined;
        if (sc) {
          if (typeof sc.stdout === 'string' && sc.stdout.length > 200_000) {
            sc.stdout = sc.stdout.slice(0, 200_000) + '\n\n[stdout truncated to stay within 1MB message limit]';
          }
          if (typeof sc.stderr === 'string' && sc.stderr.length > 50_000) {
            sc.stderr = sc.stderr.slice(0, 50_000) + '\n\n[stderr truncated to stay within 1MB message limit]';
          }
        }
        finalResult = {
          ...finalResult,
          structuredContent: sc,
          content: [
            {
              type: 'text',
              text: sc?.stdout
                ? sc.stdout.slice(0, 200_000) + '\n\n[Output truncated to stay within 1MB message limit]'
                : (typeof sc?.stderr === 'string' ? sc.stderr : 'Output truncated to stay within 1MB message limit.'),
            },
          ],
        };
        payload = JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: finalResult,
        });
      }
    }

    console.log(`[AlphaDevice] Sent JSON-RPC result for req id=${id} (${Buffer.byteLength(payload, 'utf8')} bytes)`);
    socket.send(payload);
  }

  private sendError(socket: WebSocket, id: any, code: number, message: string): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error(`[AlphaDevice] Failed to send error for req id=${id}: socket not open (state=${socket?.readyState})`);
      return;
    }
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    });
    console.log(`[AlphaDevice] Sent JSON-RPC error for req id=${id}: ${message}`);
    socket.send(payload);
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

    let effectiveCwd = args.cwd?.trim() || this.activeWorktreePath || homedir();
    if (effectiveCwd === '~' || effectiveCwd.startsWith('~/')) {
      effectiveCwd = join(homedir(), effectiveCwd.replace(/^~(?:\/|$)/, ''));
    }
    if (!existsSync(effectiveCwd)) {
      effectiveCwd = homedir();
    }

    const cmdArgs = (Array.isArray(args.args) ? args.args : []).map((arg) => {
      if (typeof arg === 'string' && (arg === '~' || arg.startsWith('~/'))) {
        return join(homedir(), arg.replace(/^~(?:\/|$)/, ''));
      }
      return String(arg);
    });
    const timeout = Math.min(Math.max(1000, args.timeoutMs || DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS);

    const startTime = Date.now();
    let timedOut = false;
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

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

      child.stdout.on('data', (d: string) => {
        if (stdout.length < MAX_STREAM_CAPTURE_BYTES) {
          const remaining = MAX_STREAM_CAPTURE_BYTES - stdout.length;
          if (d.length > remaining) {
            stdout += d.slice(0, remaining);
            stdoutTruncated = true;
          } else {
            stdout += d;
          }
        } else {
          stdoutTruncated = true;
        }
      });

      child.stderr.on('data', (d: string) => {
        if (stderr.length < MAX_STREAM_CAPTURE_BYTES) {
          const remaining = MAX_STREAM_CAPTURE_BYTES - stderr.length;
          if (d.length > remaining) {
            stderr += d.slice(0, remaining);
            stderrTruncated = true;
          } else {
            stderr += d;
          }
        } else {
          stderrTruncated = true;
        }
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (stdoutTruncated) {
          stdout += `\n\n[stdout truncated: exceeded maximum capture limit of ${Math.round(MAX_STREAM_CAPTURE_BYTES / 1024)}KB]`;
        }
        if (stderrTruncated) {
          stderr += `\n\n[stderr truncated: exceeded maximum error limit of ${Math.round(MAX_STREAM_CAPTURE_BYTES / 1024)}KB]`;
        }
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
