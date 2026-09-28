import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { getCrossPlatformEnv, resolveCliPath } from './agentRunner.js';

const execAsync = promisify(exec);

export interface AgentRateWindow {
  usedPercent: number;
  remainingPercent: number;
  windowMinutes?: number | null;
  resetsAt?: string | null;
  resetDescription?: string | null;
}

export interface AgentQuotaBucket {
  id: string;
  name: string;
  remainingFraction: number;
  usedPercent: number;
  remainingPercent: number;
  resetTime?: string | null;
  resetDescription?: string | null;
  groupName?: string;
}

export interface AgentCostLimit {
  limit?: number | null;
  used?: number | null;
  remaining?: number | null;
  usedPercent?: number | null;
  remainingPercent?: number | null;
  currency?: string | null;
  period?: string | null;
  resetsAt?: string | null;
  resetDescription?: string | null;
}

export interface AgentUsageSnapshot {
  cli: string;
  providerName: string;
  accountEmail?: string | null;
  accountPlan?: string | null;
  organization?: string | null;
  statusMessage?: string | null;
  primaryWindow?: AgentRateWindow | null;
  secondaryWindow?: AgentRateWindow | null;
  buckets?: AgentQuotaBucket[];
  costLimit?: AgentCostLimit | null;
  updatedAt: number;
  isAvailable: boolean;
  error?: string | null;
}

// In-memory cache with 60-second TTL
const cache: Record<string, { snapshot: AgentUsageSnapshot; expiresAt: number }> = {};
const CACHE_TTL_MS = 60 * 1000;

function formatRelativeTime(dateInput: string | number | Date | null | undefined): string | null {
  if (!dateInput) return null;
  try {
    let targetMs: number;
    if (typeof dateInput === 'number') {
      targetMs = dateInput > 1e11 ? dateInput : dateInput * 1000;
    } else if (typeof dateInput === 'string') {
      targetMs = new Date(dateInput).getTime();
    } else {
      targetMs = dateInput.getTime();
    }
    if (isNaN(targetMs) || targetMs <= 0 || targetMs === new Date('1970-01-01T00:00:00Z').getTime()) {
      return null;
    }
    const diffMs = targetMs - Date.now();
    if (diffMs <= 0) return 'Resets soon';

    const diffMinutes = Math.floor(diffMs / (60 * 1000));
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      const remainingHours = diffHours % 24;
      return remainingHours > 0
        ? `Resets in ${diffDays}d ${remainingHours}h`
        : `Resets in ${diffDays}d`;
    }
    if (diffHours > 0) {
      const remainingMins = diffMinutes % 60;
      return remainingMins > 0
        ? `Resets in ${diffHours}h ${remainingMins}m`
        : `Resets in ${diffHours}h`;
    }
    return `Resets in ${Math.max(1, diffMinutes)}m`;
  } catch {
    return null;
  }
}

function parseSafeNumber(val: any): number | null {
  if (val === undefined || val === null || val === '') return null;
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(num) ? null : num;
}

function httpsRequestJson<T>(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  }
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: options.timeoutMs || 10000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const data = body ? JSON.parse(body) : ({} as T);
            resolve({ status: res.statusCode || 200, data });
          } catch (err: any) {
            reject(new Error(`Failed to parse response JSON: ${err.message}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${options.timeoutMs || 10000}ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// -------------------------------------------------------------
// Antigravity (agy) Usage Fetcher
// -------------------------------------------------------------
export async function fetchAgyUsage(): Promise<AgentUsageSnapshot> {
  const agyPath = resolveCliPath('agy');
  if (!agyPath) {
    return {
      cli: 'agy',
      providerName: 'Antigravity',
      isAvailable: false,
      error: 'Antigravity (agy) CLI not found in system PATH',
      updatedAt: Date.now(),
    };
  }

  try {
    const env = getCrossPlatformEnv();
    const { stdout } = await execAsync(`"${agyPath}" -p /usage --output-format json`, {
      env,
      timeout: 10000,
      encoding: 'utf8',
    });

    const parsed = JSON.parse(stdout);
    const groups = parsed?.command?.data?.groups || [];
    const buckets: AgentQuotaBucket[] = [];

    for (const group of groups) {
      const groupName = group.displayName || group.name || 'Quota';
      for (const bucket of group.buckets || []) {
        if (bucket.disabled) continue;
        const rawRemaining =
          typeof bucket.remaining_fraction === 'number'
            ? bucket.remaining_fraction
            : typeof bucket.remainingFraction === 'number'
            ? bucket.remainingFraction
            : 1.0;

        const remainingPercent = Math.round(Math.max(0, Math.min(100, rawRemaining * 100)));
        const usedPercent = Math.max(0, 100 - remainingPercent);
        const resetTime = bucket.reset_time || bucket.resetTime || null;

        buckets.push({
          id: bucket.id || bucket.bucketId || bucket.name,
          name: bucket.displayName || bucket.name || bucket.id,
          remainingFraction: rawRemaining,
          remainingPercent,
          usedPercent,
          resetTime,
          resetDescription: formatRelativeTime(resetTime),
          groupName,
        });
      }
    }

    // Identify the lowest remaining % bucket as the primary window indicator
    let primaryWindow: AgentRateWindow | null = null;
    if (buckets.length > 0) {
      const sorted = [...buckets].sort((a, b) => a.remainingPercent - b.remainingPercent);
      const lowest = sorted[0];
      primaryWindow = {
        usedPercent: lowest.usedPercent,
        remainingPercent: lowest.remainingPercent,
        resetsAt: lowest.resetTime,
        resetDescription: lowest.resetDescription,
      };
    }

    return {
      cli: 'agy',
      providerName: 'Antigravity',
      accountPlan: 'Active Quota Pools',
      buckets,
      primaryWindow,
      isAvailable: true,
      updatedAt: Date.now(),
    };
  } catch (err: any) {
    return {
      cli: 'agy',
      providerName: 'Antigravity',
      isAvailable: true,
      error: `Failed to retrieve Antigravity quota: ${err.message}`,
      updatedAt: Date.now(),
    };
  }
}

// -------------------------------------------------------------
// OpenAI Codex Usage Fetcher
// -------------------------------------------------------------
export async function fetchCodexUsage(): Promise<AgentUsageSnapshot> {
  const codexPath = resolveCliPath('codex');
  const homeDir = os.homedir();
  const authPath = process.env.CODEX_HOME
    ? path.join(process.env.CODEX_HOME, 'auth.json')
    : path.join(homeDir, '.codex', 'auth.json');

  let accessToken: string | null = null;
  let accountId: string | null = null;

  if (fs.existsSync(authPath)) {
    try {
      const content = fs.readFileSync(authPath, 'utf8');
      const auth = JSON.parse(content);
      accessToken = auth.tokens?.access_token || null;
      accountId = auth.tokens?.account_id || null;
    } catch {}
  }

  // If token is found, query OpenAI WHAM usage endpoint
  if (accessToken) {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        Accept: 'application/json',
      };
      if (accountId) {
        headers['ChatGPT-Account-Id'] = accountId;
      }

      const res = await httpsRequestJson<any>('https://chatgpt.com/backend-api/wham/usage', {
        headers,
        timeoutMs: 8000,
      });

      if (res.status === 200 && res.data) {
        const data = res.data;
        const planType = data.plan_type
          ? data.plan_type.charAt(0).toUpperCase() + data.plan_type.slice(1)
          : 'Standard';

        let primaryWindow: AgentRateWindow | null = null;
        if (data.rate_limit?.primary_window) {
          const w = data.rate_limit.primary_window;
          const used = Math.round(parseSafeNumber(w.used_percent) || 0);
          primaryWindow = {
            usedPercent: used,
            remainingPercent: Math.max(0, 100 - used),
            windowMinutes: w.limit_window_seconds ? Math.round(w.limit_window_seconds / 60) : 300,
            resetsAt: w.reset_at ? new Date(w.reset_at * 1000).toISOString() : null,
            resetDescription: formatRelativeTime(w.reset_at),
          };
        }

        let secondaryWindow: AgentRateWindow | null = null;
        if (data.rate_limit?.secondary_window) {
          const w = data.rate_limit.secondary_window;
          const used = Math.round(parseSafeNumber(w.used_percent) || 0);
          secondaryWindow = {
            usedPercent: used,
            remainingPercent: Math.max(0, 100 - used),
            windowMinutes: w.limit_window_seconds ? Math.round(w.limit_window_seconds / 60) : 10080,
            resetsAt: w.reset_at ? new Date(w.reset_at * 1000).toISOString() : null,
            resetDescription: formatRelativeTime(w.reset_at),
          };
        }

        let costLimit: AgentCostLimit | null = null;
        if (data.spend_control?.individual_limit) {
          const spend = data.spend_control.individual_limit;
          const limit = parseSafeNumber(spend.limit);
          const used = parseSafeNumber(spend.used);
          const remaining = parseSafeNumber(spend.remaining);
          const usedPercent = parseSafeNumber(spend.used_percent);
          const remainingPercent = parseSafeNumber(spend.remaining_percent);

          costLimit = {
            limit,
            used,
            remaining,
            usedPercent: usedPercent !== null ? Math.round(usedPercent) : null,
            remainingPercent: remainingPercent !== null ? Math.round(remainingPercent) : null,
            currency: spend.unit === 'credit' ? 'Credits' : 'USD',
            period: 'Monthly credit limit',
            resetsAt: spend.reset_at ? new Date(spend.reset_at * 1000).toISOString() : null,
            resetDescription: formatRelativeTime(spend.reset_at),
          };
        }

        const statusMessage = data.rate_limit_upsell?.title || (data.spend_control?.reached ? 'Usage limit reached' : null);

        return {
          cli: 'codex',
          providerName: 'OpenAI Codex',
          accountEmail: data.email || null,
          accountPlan: planType,
          statusMessage,
          primaryWindow,
          secondaryWindow,
          costLimit,
          isAvailable: !!codexPath,
          updatedAt: Date.now(),
        };
      }
    } catch {
      // Fall through to local snapshot cache
    }
  }

  // Fallback: Check CodexBar's cached snapshot if available
  const codexBarSnapshotPath = path.join(
    homeDir,
    'Library',
    'Application Support',
    'CodexBar',
    'codex-account-snapshots.json'
  );
  if (fs.existsSync(codexBarSnapshotPath)) {
    try {
      const snapContent = fs.readFileSync(codexBarSnapshotPath, 'utf8');
      const snapData = JSON.parse(snapContent);
      const record = snapData.records?.[0];
      if (record) {
        const email = record.id || record.snapshot?.accountEmail || null;
        const plan = record.snapshot?.loginMethod || 'Business';
        const cost = record.snapshot?.providerCost;
        let costLimit: AgentCostLimit | null = null;
        if (cost) {
          const used = parseSafeNumber(cost.used);
          const limit = parseSafeNumber(cost.limit);
          const remaining = limit !== null && used !== null ? Math.max(0, limit - used) : null;
          const usedPercent = limit && used ? Math.min(100, Math.round((used / limit) * 100)) : null;
          costLimit = {
            limit,
            used,
            remaining,
            usedPercent,
            remainingPercent: usedPercent !== null ? Math.max(0, 100 - usedPercent) : null,
            currency: cost.currencyCode || 'Credits',
            period: cost.period || 'Monthly credit limit',
            resetsAt: cost.resetsAt ? new Date(cost.resetsAt * 1000).toISOString() : null,
            resetDescription: formatRelativeTime(cost.resetsAt),
          };
        }

        return {
          cli: 'codex',
          providerName: 'OpenAI Codex',
          accountEmail: email,
          accountPlan: plan.charAt(0).toUpperCase() + plan.slice(1),
          costLimit,
          isAvailable: !!codexPath,
          updatedAt: Date.now(),
        };
      }
    } catch {}
  }

  return {
    cli: 'codex',
    providerName: 'OpenAI Codex',
    isAvailable: !!codexPath,
    error: accessToken ? 'Failed to fetch Codex usage from API' : 'Not signed into Codex CLI (~/.codex/auth.json not found)',
    updatedAt: Date.now(),
  };
}

// -------------------------------------------------------------
// Claude Code Usage Fetcher
// -------------------------------------------------------------
export async function fetchClaudeUsage(): Promise<AgentUsageSnapshot> {
  const claudePath = resolveCliPath('claude');
  let authStatus: { loggedIn?: boolean; email?: string; orgName?: string; subscriptionType?: string } = {};

  if (claudePath) {
    try {
      const env = getCrossPlatformEnv();
      const stdout = execSync(`"${claudePath}" auth status --json`, {
        env,
        timeout: 5000,
        encoding: 'utf8',
      });
      authStatus = JSON.parse(stdout);
    } catch {}
  }

  // Attempt to read credentials from macOS Keychain or file
  let accessToken: string | null = null;
  let refreshToken: string | null = null;

  if (process.platform === 'darwin') {
    try {
      const secOutput = execSync('/usr/bin/security find-generic-password -s "Claude Code-credentials" -w', {
        encoding: 'utf8',
        timeout: 4000,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      const parsed = JSON.parse(secOutput);
      accessToken = parsed?.claudeAiOauth?.accessToken || null;
      refreshToken = parsed?.claudeAiOauth?.refreshToken || null;
    } catch {}
  }

  // If we have a refresh token, try to refresh if access token expired
  const oauthClientId = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
  if (refreshToken) {
    try {
      const postData = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: oauthClientId,
      }).toString();

      const refreshRes = await httpsRequestJson<any>('https://platform.claude.com/v1/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'Content-Length': Buffer.byteLength(postData).toString(),
        },
        body: postData,
        timeoutMs: 6000,
      });

      if (refreshRes.status === 200 && refreshRes.data?.access_token) {
        accessToken = refreshRes.data.access_token;
      }
    } catch {}
  }

  if (accessToken) {
    try {
      const usageRes = await httpsRequestJson<any>('https://api.anthropic.com/api/oauth/usage', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'claude-code/2.1.0',
          Accept: 'application/json',
        },
        timeoutMs: 8000,
      });

      if (usageRes.status === 200 && usageRes.data) {
        const data = usageRes.data;

        let primaryWindow: AgentRateWindow | null = null;
        if (data.five_hour && typeof data.five_hour.utilization === 'number') {
          const used = Math.round(data.five_hour.utilization);
          primaryWindow = {
            usedPercent: used,
            remainingPercent: Math.max(0, 100 - used),
            windowMinutes: 300,
            resetsAt: data.five_hour.resets_at || null,
            resetDescription: formatRelativeTime(data.five_hour.resets_at),
          };
        }

        let secondaryWindow: AgentRateWindow | null = null;
        if (data.seven_day && typeof data.seven_day.utilization === 'number') {
          const used = Math.round(data.seven_day.utilization);
          secondaryWindow = {
            usedPercent: used,
            remainingPercent: Math.max(0, 100 - used),
            windowMinutes: 10080,
            resetsAt: data.seven_day.resets_at || null,
            resetDescription: formatRelativeTime(data.seven_day.resets_at),
          };
        }

        let costLimit: AgentCostLimit | null = null;
        if (data.spend || data.extra_usage) {
          const spend = data.spend;
          const extra = data.extra_usage;
          const limit = spend?.limit?.amount_minor ? spend.limit.amount_minor / 100 : extra?.monthly_limit ? extra.monthly_limit / 100 : null;
          const used = spend?.used?.amount_minor ? spend.used.amount_minor / 100 : extra?.used_credits ? extra.used_credits / 100 : null;
          const usedPercent = typeof spend?.percent === 'number' ? spend.percent : extra?.utilization ? Math.round(extra.utilization) : null;

          costLimit = {
            limit,
            used,
            remaining: limit !== null && used !== null ? Math.max(0, limit - used) : null,
            usedPercent,
            remainingPercent: usedPercent !== null ? Math.max(0, 100 - usedPercent) : null,
            currency: spend?.limit?.currency || extra?.currency || 'USD',
            period: 'Monthly spend allowance',
          };
        }

        const plan = authStatus.subscriptionType
          ? authStatus.subscriptionType.charAt(0).toUpperCase() + authStatus.subscriptionType.slice(1)
          : 'Active';

        return {
          cli: 'claude',
          providerName: 'Claude Code',
          accountEmail: authStatus.email || null,
          accountPlan: plan,
          organization: authStatus.orgName || null,
          primaryWindow,
          secondaryWindow,
          costLimit,
          isAvailable: !!claudePath,
          updatedAt: Date.now(),
        };
      }
    } catch {}
  }

  // Fallback: Return basic info if CLI is logged in
  if (authStatus.loggedIn) {
    const plan = authStatus.subscriptionType
      ? authStatus.subscriptionType.charAt(0).toUpperCase() + authStatus.subscriptionType.slice(1)
      : 'Authenticated';

    return {
      cli: 'claude',
      providerName: 'Claude Code',
      accountEmail: authStatus.email || null,
      accountPlan: plan,
      organization: authStatus.orgName || null,
      isAvailable: !!claudePath,
      updatedAt: Date.now(),
    };
  }

  return {
    cli: 'claude',
    providerName: 'Claude Code',
    isAvailable: !!claudePath,
    error: claudePath ? 'Not authenticated in Claude CLI (run `claude login`)' : 'Claude Code CLI not found in PATH',
    updatedAt: Date.now(),
  };
}

// -------------------------------------------------------------
// Unified Dispatcher with In-Memory Caching
// -------------------------------------------------------------
export async function getAgentUsage(cli: string, forceRefresh = false): Promise<AgentUsageSnapshot> {
  const normalized = cli.toLowerCase().trim();
  const cached = cache[normalized];
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.snapshot;
  }

  let snapshot: AgentUsageSnapshot;
  switch (normalized) {
    case 'agy':
      snapshot = await fetchAgyUsage();
      break;
    case 'codex':
      snapshot = await fetchCodexUsage();
      break;
    case 'claude':
      snapshot = await fetchClaudeUsage();
      break;
    default:
      snapshot = {
        cli: normalized,
        providerName: normalized.toUpperCase(),
        isAvailable: false,
        error: `Unsupported CLI provider: ${normalized}`,
        updatedAt: Date.now(),
      };
  }

  cache[normalized] = {
    snapshot,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  return snapshot;
}

export async function getAllAgentUsages(forceRefresh = false): Promise<Record<string, AgentUsageSnapshot>> {
  const clis = ['codex', 'agy', 'claude'];
  const results = await Promise.all(clis.map((c) => getAgentUsage(c, forceRefresh)));
  const map: Record<string, AgentUsageSnapshot> = {};
  for (const item of results) {
    map[item.cli] = item;
  }
  return map;
}
