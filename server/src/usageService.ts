import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
let cachedUsages: Record<string, AgentUsageSnapshot> | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 60 * 1000;

export function formatRelativeTime(dateInput: string | number | Date | null | undefined): string | null {
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

export function resolveCodexbarPath(): string | null {
  const candidates = [
    '/opt/homebrew/bin/codexbar',
    '/usr/local/bin/codexbar',
    path.join(os.homedir(), '.local', 'bin', 'codexbar'),
    path.join(os.homedir(), '.cargo', 'bin', 'codexbar'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        fs.accessSync(c, fs.constants.X_OK);
        return c;
      } catch {}
    }
  }

  const resolved = resolveCliPath('codexbar');
  if (resolved) return resolved;

  try {
    const out = execSync('which codexbar', { encoding: 'utf8', timeout: 2000 }).trim();
    if (out && fs.existsSync(out)) return out;
  } catch {}

  return null;
}

async function runCodexbarUsage(): Promise<any[]> {
  const codexbarPath = resolveCodexbarPath();
  if (!codexbarPath) {
    throw new Error('CodexBar CLI not found in system PATH. Install via: brew install steipete/tap/codexbar');
  }

  const env = getCrossPlatformEnv();
  const { stdout } = await execAsync(`"${codexbarPath}" usage --format json --pretty`, {
    env,
    timeout: 15000,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  return JSON.parse(stdout);
}

function parseCodexData(item: any, now: number): AgentUsageSnapshot {
  const codexPath = resolveCliPath('codex');
  const accountEmail =
    item.usage?.accountEmail ||
    item.openaiDashboard?.signedInEmail ||
    item.usage?.identity?.accountEmail ||
    null;

  const accountPlan =
    item.openaiDashboard?.accountPlan ||
    (item.usage?.loginMethod
      ? item.usage.loginMethod.charAt(0).toUpperCase() + item.usage.loginMethod.slice(1)
      : 'Business');

  const rawCredit =
    item.credits?.codexCreditLimit ||
    item.openaiDashboard?.codexCreditLimit ||
    item.usage?.providerCost ||
    null;

  let costLimit: AgentCostLimit | null = null;
  if (rawCredit) {
    const limit = parseSafeNumber(rawCredit.limit);
    const used = parseSafeNumber(rawCredit.used);
    const remaining =
      rawCredit.remaining !== undefined
        ? parseSafeNumber(rawCredit.remaining)
        : limit !== null && used !== null
        ? Math.max(0, limit - used)
        : null;

    let remainingPercent: number | null = null;
    if (typeof rawCredit.remainingPercent === 'number') {
      remainingPercent = Math.round(rawCredit.remainingPercent);
    } else if (limit && remaining !== null) {
      remainingPercent = Math.max(0, Math.min(100, Math.round((remaining / limit) * 100)));
    }

    let usedPercent: number | null = null;
    if (remainingPercent !== null) {
      usedPercent = Math.max(0, 100 - remainingPercent);
    } else if (limit && used !== null) {
      usedPercent = Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
    }

    const resetsAt = rawCredit.resetsAt || null;

    costLimit = {
      limit,
      used,
      remaining,
      remainingPercent,
      usedPercent,
      currency: 'Credits',
      period: rawCredit.title || rawCredit.period || 'Monthly credit limit',
      resetsAt,
      resetDescription: formatRelativeTime(resetsAt),
    };
  }

  let primaryWindow: AgentRateWindow | null = null;
  if (item.usage?.primary && !item.usage.primary.isSyntheticPlaceholder) {
    const p = item.usage.primary;
    const used = typeof p.usedPercent === 'number' ? Math.round(p.usedPercent) : 0;
    primaryWindow = {
      usedPercent: used,
      remainingPercent: Math.max(0, 100 - used),
      windowMinutes: p.windowMinutes || 300,
      resetsAt: p.resetsAt || null,
      resetDescription: formatRelativeTime(p.resetsAt),
    };
  }

  let secondaryWindow: AgentRateWindow | null = null;
  if (item.usage?.secondary && !item.usage.secondary.isSyntheticPlaceholder) {
    const s = item.usage.secondary;
    const used = typeof s.usedPercent === 'number' ? Math.round(s.usedPercent) : 0;
    secondaryWindow = {
      usedPercent: used,
      remainingPercent: Math.max(0, 100 - used),
      windowMinutes: s.windowMinutes || 10080,
      resetsAt: s.resetsAt || null,
      resetDescription: formatRelativeTime(s.resetsAt),
    };
  }

  const isLimitReached =
    (costLimit?.remainingPercent === 0) ||
    (costLimit?.limit !== null && costLimit?.used !== null && (costLimit?.used || 0) >= (costLimit?.limit || 0));

  return {
    cli: 'codex',
    providerName: 'OpenAI Codex',
    accountEmail,
    accountPlan,
    costLimit,
    primaryWindow,
    secondaryWindow,
    statusMessage: isLimitReached ? 'Monthly credit limit reached' : null,
    isAvailable: !!codexPath,
    updatedAt: now,
  };
}

function parseClaudeData(item: any, now: number): AgentUsageSnapshot {
  const claudePath = resolveCliPath('claude');
  const accountEmail =
    item.usage?.accountEmail ||
    item.usage?.identity?.accountEmail ||
    null;

  const organization =
    item.usage?.accountOrganization ||
    item.usage?.identity?.accountOrganization ||
    null;

  const accountPlan =
    item.usage?.loginMethod ||
    item.usage?.identity?.loginMethod ||
    'Claude Enterprise';

  const rawCost = item.usage?.providerCost || null;
  let costLimit: AgentCostLimit | null = null;

  if (rawCost) {
    const limit = parseSafeNumber(rawCost.limit);
    const used = parseSafeNumber(rawCost.used);
    const remaining =
      limit !== null && used !== null
        ? Math.max(0, parseFloat((limit - used).toFixed(2)))
        : null;

    let remainingPercent: number | null = null;
    if (limit && used !== null) {
      remainingPercent = Math.max(0, Math.min(100, Math.round(((limit - used) / limit) * 100)));
    }

    let usedPercent: number | null = null;
    if (limit && used !== null) {
      usedPercent = Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
    }

    const resetsAt = rawCost.resetsAt || null;

    costLimit = {
      limit,
      used,
      remaining,
      remainingPercent,
      usedPercent,
      currency: rawCost.currencyCode || 'USD',
      period: rawCost.period || 'Monthly cap',
      resetsAt,
      resetDescription: formatRelativeTime(resetsAt),
    };
  }

  let primaryWindow: AgentRateWindow | null = null;
  if (item.usage?.primary && !item.usage.primary.isSyntheticPlaceholder) {
    const p = item.usage.primary;
    const used = typeof p.usedPercent === 'number' ? Math.round(p.usedPercent) : 0;
    primaryWindow = {
      usedPercent: used,
      remainingPercent: Math.max(0, 100 - used),
      windowMinutes: p.windowMinutes || 300,
      resetsAt: p.resetsAt || null,
      resetDescription: formatRelativeTime(p.resetsAt),
    };
  }

  let secondaryWindow: AgentRateWindow | null = null;
  if (item.usage?.secondary && !item.usage.secondary.isSyntheticPlaceholder) {
    const s = item.usage.secondary;
    const used = typeof s.usedPercent === 'number' ? Math.round(s.usedPercent) : 0;
    secondaryWindow = {
      usedPercent: used,
      remainingPercent: Math.max(0, 100 - used),
      windowMinutes: s.windowMinutes || 10080,
      resetsAt: s.resetsAt || null,
      resetDescription: formatRelativeTime(s.resetsAt),
    };
  }

  const isLimitReached =
    costLimit?.remainingPercent === 0 ||
    (costLimit?.limit !== null && costLimit?.used !== null && (costLimit?.used || 0) >= (costLimit?.limit || 0));

  return {
    cli: 'claude',
    providerName: 'Claude Code',
    accountEmail,
    organization,
    accountPlan,
    costLimit,
    primaryWindow,
    secondaryWindow,
    statusMessage: isLimitReached ? 'Monthly spend cap reached' : null,
    isAvailable: !!claudePath,
    updatedAt: now,
  };
}

function parseAntigravityData(item: any, now: number): AgentUsageSnapshot {
  const agyPath = resolveCliPath('agy');
  const accountEmail =
    item.usage?.accountEmail ||
    item.usage?.identity?.accountEmail ||
    null;

  const accountPlan =
    item.usage?.loginMethod ||
    item.usage?.identity?.loginMethod ||
    'Gemini Enterprise Plus';

  const extraWindows = item.usage?.extraRateWindows || [];
  const buckets: AgentQuotaBucket[] = [];

  for (const w of extraWindows) {
    const rawUsed = typeof w.window?.usedPercent === 'number' ? Math.round(w.window.usedPercent) : 0;
    const remainingPercent = Math.max(0, 100 - rawUsed);
    const remainingFraction = remainingPercent / 100;
    const name = (w.title || w.id || 'Model').replace(/^All Models\s+/, '');

    buckets.push({
      id: w.id || name,
      name,
      remainingFraction,
      remainingPercent,
      usedPercent: rawUsed,
      groupName: 'All Models',
      resetDescription: null,
    });
  }

  let primaryWindow: AgentRateWindow | null = null;
  if (item.usage?.primary && !item.usage.primary.isSyntheticPlaceholder) {
    const p = item.usage.primary;
    const used = typeof p.usedPercent === 'number' ? Math.round(p.usedPercent) : 0;
    primaryWindow = {
      usedPercent: used,
      remainingPercent: Math.max(0, 100 - used),
      windowMinutes: p.windowMinutes || 300,
      resetsAt: p.resetsAt || null,
      resetDescription: formatRelativeTime(p.resetsAt),
    };
  }

  return {
    cli: 'agy',
    providerName: 'Antigravity',
    accountEmail,
    accountPlan,
    buckets,
    primaryWindow,
    isAvailable: !!agyPath,
    updatedAt: now,
  };
}

export async function fetchAllFromCodexbar(): Promise<Record<string, AgentUsageSnapshot>> {
  const now = Date.now();
  const result: Record<string, AgentUsageSnapshot> = {};

  try {
    const items = await runCodexbarUsage();

    for (const item of items) {
      const provider = String(item.provider || '').toLowerCase();
      if (provider === 'codex') {
        result['codex'] = parseCodexData(item, now);
      } else if (provider === 'claude') {
        result['claude'] = parseClaudeData(item, now);
      } else if (provider === 'antigravity' || provider === 'agy') {
        result['agy'] = parseAntigravityData(item, now);
      }
    }
  } catch (err: any) {
    const isMissingCli = err.message?.includes('CodexBar CLI not found');
    const errorMsg = isMissingCli
      ? 'CodexBar CLI not found. Install via: brew install steipete/tap/codexbar'
      : `Failed to retrieve usage from CodexBar: ${err.message}`;

    const clis = ['codex', 'agy', 'claude'];
    for (const cli of clis) {
      const providerName =
        cli === 'codex' ? 'OpenAI Codex' : cli === 'claude' ? 'Claude Code' : 'Antigravity';
      result[cli] = {
        cli,
        providerName,
        isAvailable: !!resolveCliPath(cli),
        error: errorMsg,
        updatedAt: now,
      };
    }
  }

  // Ensure all 3 providers exist in map
  const defaultProviders: Array<{ cli: string; name: string }> = [
    { cli: 'codex', name: 'OpenAI Codex' },
    { cli: 'agy', name: 'Antigravity' },
    { cli: 'claude', name: 'Claude Code' },
  ];

  for (const p of defaultProviders) {
    if (!result[p.cli]) {
      result[p.cli] = {
        cli: p.cli,
        providerName: p.name,
        isAvailable: !!resolveCliPath(p.cli),
        error: 'No usage data found for this provider in CodexBar',
        updatedAt: now,
      };
    }
  }

  return result;
}

export async function getAllAgentUsages(forceRefresh = false): Promise<Record<string, AgentUsageSnapshot>> {
  if (!forceRefresh && cachedUsages && cacheExpiresAt > Date.now()) {
    return cachedUsages;
  }

  const usages = await fetchAllFromCodexbar();
  cachedUsages = usages;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return usages;
}

export async function getAgentUsage(cli: string, forceRefresh = false): Promise<AgentUsageSnapshot> {
  const normalized = cli.toLowerCase().trim();
  const all = await getAllAgentUsages(forceRefresh);
  if (all[normalized]) {
    return all[normalized];
  }

  return {
    cli: normalized,
    providerName: normalized.toUpperCase(),
    isAvailable: false,
    error: `Unsupported CLI provider: ${normalized}`,
    updatedAt: Date.now(),
  };
}
