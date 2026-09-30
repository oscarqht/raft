import http from 'node:http';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  db,
  getSetting,
  setSetting,
  getAllGitAccounts,
  getGitAccountById,
  insertGitAccount,
  deleteGitAccountById,
  findGitAccountForRemote,
  getAllSkills,
  getSkillById,
  getSkillByName,
  insertSkill,
  updateSkillById,
  deleteSkillById,
} from './db.js';
import { GitService } from './gitService.js';
import {
  getAvailableClis,
  getModelsForCli,
  installCliProcess,
  runCommitMessageAgent,
  runDiscoveryAgent,
  detectInstallCommand,
  runRebaseAgent,
  runSubmitAgent,
  spawnAgentCli,
  buildConversationContextFallback,
  parseLegacyThoughtToSteps,
  AUTH_REQUIRED_REGEX,
  SPEND_CAP_REGEX,
  CommitMessageResult,
  StreamEvent,
  AgentStep,
} from './agentRunner.js';
import { devServerManager } from './devServerManager.js';
import { alphaDeviceService } from './alphaDeviceService.js';
import { runAlphaIntelligenceTurn, buildAlphaPromptWithContext } from './alphaAgentRunner.js';
import { scriptManager } from './scriptManager.js';
import { getSkillsForCli, resolveSkillPrompt, extractMatchedSkills, installSkillWithNpxProcess } from './skillService.js';
import { resolveHost, setupTailscaleServe, TailscaleServeResult } from './tailscale.js';
import { getAgentUsage, getAllAgentUsages } from './usageService.js';
import multer from 'multer';

const app = express();
app.use(cors());
app.use(express.json());

let tailscaleServeInfo: TailscaleServeResult | null = null;

const isDev =
  process.env.NODE_ENV !== 'production' &&
  !process.env.RAFT_PRODUCTION &&
  process.env.npm_lifecycle_event !== 'start';
const defaultPort = isDev ? 3301 : 3300;
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : defaultPort;
const { host: HOST, isTailscale, source: hostSource } = resolveHost();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const upload = multer({
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
    files: 10,
  },
  storage: multer.memoryStorage(),
});

export function ensureGitIgnoreRaft(worktreePath: string): void {
  try {
    const gitPath = path.join(worktreePath, '.git');
    let excludeFilePath: string | null = null;
    if (fs.existsSync(gitPath)) {
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory()) {
        excludeFilePath = path.join(gitPath, 'info', 'exclude');
      } else if (stat.isFile()) {
        const content = fs.readFileSync(gitPath, 'utf-8');
        const match = content.match(/gitdir:\s*(.+)/i);
        if (match && match[1]) {
          const resolvedGitDir = path.resolve(worktreePath, match[1].trim());
          excludeFilePath = path.join(resolvedGitDir, 'info', 'exclude');
        }
      }
    }
    if (excludeFilePath) {
      const dir = path.dirname(excludeFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      let existing = '';
      if (fs.existsSync(excludeFilePath)) {
        existing = fs.readFileSync(excludeFilePath, 'utf-8');
      }
      if (!existing.includes('.raft')) {
        const updated = existing ? `${existing.trim()}\n.raft\n.raft/\n` : '.raft\n.raft/\n';
        fs.writeFileSync(excludeFilePath, updated, 'utf-8');
      }
    }
  } catch (err) {
    console.error('Failed to configure git exclude for .raft:', err);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ===================== REST APIs =====================

function getEffectiveAgentCli(): string {
  const availableClis = getAvailableClis();
  const readyCli = availableClis.find((c) => c.available);
  const saved = getSetting<string>('agent_cli', '');
  if (saved) {
    const isSavedAvailable = availableClis.some((c) => c.name.toLowerCase() === saved.toLowerCase() && c.available);
    if (isSavedAvailable || !readyCli) {
      return saved;
    }
  }
  return readyCli ? readyCli.name : 'codex';
}

// Updater state & loopback sync
let currentUpdaterStatus: any = { status: 'Idle' };
let pendingUpdaterAction: 'check' | 'install' | null = null;
let raftVersionOverride = '';
const internalAuthToken = process.env.RAFT_INTERNAL_TOKEN || '';

function getRaftVersion(): string {
  if (raftVersionOverride) {
    return raftVersionOverride;
  }
  if (typeof process.env.RAFT_VERSION === 'string' && process.env.RAFT_VERSION) {
    return process.env.RAFT_VERSION;
  }
  const candidatePkgPaths = [
    path.resolve(process.cwd(), 'package.json'),
    path.resolve(process.cwd(), '../package.json'),
    path.resolve(__dirname, 'package.json'),
    path.resolve(__dirname, '../package.json'),
    path.resolve(__dirname, '../../package.json'),
  ];
  for (const pkgPath of candidatePkgPaths) {
    try {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name === 'raft' && pkg.version) {
          return pkg.version;
        }
        if (pkg.version && pkg.name !== 'raft-server') {
          return pkg.version;
        }
      }
    } catch {}
  }
  return '0.19.0';
}

// Public Updater endpoints (for Web Client HeaderUpdater)
app.get('/api/updater/status', (_req: Request, res: Response) => {
  res.json({
    current_version: getRaftVersion(),
    status: currentUpdaterStatus,
  });
});

app.post('/api/updater/check', (_req: Request, res: Response) => {
  pendingUpdaterAction = 'check';
  if (
    !currentUpdaterStatus ||
    currentUpdaterStatus.status === 'Idle' ||
    currentUpdaterStatus.status === 'UpToDate' ||
    currentUpdaterStatus.status === 'Error'
  ) {
    currentUpdaterStatus = { status: 'Checking' };
  }
  res.json({ success: true });
});

app.post('/api/updater/install', (_req: Request, res: Response) => {
  pendingUpdaterAction = 'install';
  res.json({ success: true });
});

// Internal Updater endpoints (polled/pushed by Tauri loopback sync)
app.post('/api/internal/updater-status', (req: Request, res: Response) => {
  if (internalAuthToken && req.headers['x-raft-token'] !== internalAuthToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (req.body && typeof req.body.current_version === 'string' && req.body.current_version) {
    raftVersionOverride = req.body.current_version;
  }
  currentUpdaterStatus = req.body?.status || req.body;
  res.json({ success: true });
});

app.get('/api/internal/updater-action', (req: Request, res: Response) => {
  if (internalAuthToken && req.headers['x-raft-token'] !== internalAuthToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const action = pendingUpdaterAction;
  pendingUpdaterAction = null;
  res.json({ action });
});

// Settings
app.get('/api/settings', async (_req: Request, res: Response) => {
  const agent_cli = getEffectiveAgentCli();
  let default_model = getSetting<string>('default_model', '');
  if (!default_model) {
    const models = await getModelsForCli(agent_cli);
    default_model = models[0]?.id || '';
  }
  const thinking_effort = getSetting<string>('thinking_effort', 'medium');
  const theme = getSetting<string>('theme', 'auto');
  const alpha_intelligence_api_url = getSetting<string>('alpha_intelligence_api_url', '');
  const alpha_intelligence_api_key = getSetting<string>('alpha_intelligence_api_key', '');
  res.json({
    agent_cli,
    default_model,
    thinking_effort,
    theme,
    alpha_intelligence_api_url,
    alpha_intelligence_api_key,
    tailscale_https_url: tailscaleServeInfo?.httpsUrl || null,
  });
});

app.put('/api/settings', (req: Request, res: Response) => {
  const { agent_cli, default_model, thinking_effort, theme, alpha_intelligence_api_url, alpha_intelligence_api_key } = req.body;
  if (agent_cli !== undefined) setSetting('agent_cli', agent_cli);
  if (default_model !== undefined) setSetting('default_model', default_model);
  if (thinking_effort !== undefined) setSetting('thinking_effort', thinking_effort);
  if (theme !== undefined) setSetting('theme', theme);
  if (alpha_intelligence_api_url !== undefined) {
    setSetting('alpha_intelligence_api_url', alpha_intelligence_api_url);
    alphaDeviceService.updateBaseUrlFromApiUrl(alpha_intelligence_api_url);
  }
  if (alpha_intelligence_api_key !== undefined) {
    setSetting('alpha_intelligence_api_key', alpha_intelligence_api_key);
  }
  res.json({ success: true });
});

// Alpha Intelligence routes
app.get('/api/alpha/status', (_req: Request, res: Response) => {
  const apiUrl = getSetting<string>('alpha_intelligence_api_url', '');
  const apiKey = getSetting<string>('alpha_intelligence_api_key', '');
  const deviceStatus = alphaDeviceService.getStatus();
  res.json({
    configured: Boolean(apiUrl && apiKey),
    apiUrl,
    device: deviceStatus,
  });
});

app.post('/api/alpha/device/reconnect', (_req: Request, res: Response) => {
  alphaDeviceService.reconnect();
  res.json({ success: true, status: alphaDeviceService.getStatus() });
});

app.post('/api/alpha/hitl-submit', async (req: Request, res: Response) => {
  const { callback_url, response: userResponse } = req.body;
  if (!callback_url) {
    return res.status(400).json({ error: 'callback_url is required' });
  }

  try {
    const isObj = typeof userResponse === 'object' && userResponse !== null;
    const body = isObj ? JSON.stringify(userResponse) : String(userResponse ?? '');
    const headers: Record<string, string> = {
      'Content-Type': isObj ? 'application/json' : 'text/plain',
    };
    const upstreamRes = await fetch(callback_url, {
      method: 'POST',
      headers,
      body,
    });
    const resText = await upstreamRes.text().catch(() => '');
    res.json({ success: true, status: upstreamRes.status, body: resText });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to submit HITL response' });
  }
});

// AI Agent Usage & Quotas
app.get('/api/agent-usage', async (req: Request, res: Response) => {
  const cli = typeof req.query.cli === 'string' ? req.query.cli.trim() : '';
  const refresh = req.query.refresh === 'true';
  try {
    if (cli) {
      const usage = await getAgentUsage(cli, refresh);
      return res.json(usage);
    }
    const usages = await getAllAgentUsages(refresh);
    return res.json(usages);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to retrieve agent usage' });
  }
});

app.get('/api/agent-usage/:cli', async (req: Request, res: Response) => {
  const cli = (Array.isArray(req.params.cli) ? req.params.cli[0] : req.params.cli || '').trim();
  const refresh = req.query.refresh === 'true';
  try {
    const usage = await getAgentUsage(cli, refresh);
    return res.json(usage);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to retrieve agent usage' });
  }
});

// CLIs & Models
app.get('/api/clis', (_req: Request, res: Response) => {
  res.json(getAvailableClis());
});

app.get('/api/clis/install/stream', (req: Request, res: Response) => {
  const cli = ((req.query.cli as string) || '').toLowerCase();
  if (!cli) {
    return res.status(400).json({ error: 'cli parameter is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent({ type: 'start', cli });

  try {
    const { proc, promise } = installCliProcess(cli, (chunk) => {
      sendEvent({ type: 'output', chunk });
    });

    req.on('close', () => {
      try {
        proc.kill();
      } catch {}
    });

    promise.then(({ code }) => {
      const clis = getAvailableClis();
      sendEvent({ type: 'done', code, success: code === 0, availableClis: clis });
      res.end();
    });
  } catch (err: any) {
    sendEvent({ type: 'output', chunk: `\n[raft error] ${err.message}\n` });
    sendEvent({ type: 'done', code: 1, success: false });
    res.end();
  }
});

app.get('/api/models', async (req: Request, res: Response) => {
  const cli = (req.query.cli as string) || getEffectiveAgentCli();
  const refresh = req.query.refresh === 'true';
  try {
    const models = await getModelsForCli(cli, refresh);
    res.json(models);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to get models' });
  }
});

// ===================== Custom Skills APIs =====================
app.get('/api/skills', (_req: Request, res: Response) => {
  try {
    const skills = getAllSkills();
    res.json(skills);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to get skills' });
  }
});

app.post('/api/skills', (req: Request, res: Response) => {
  const { name, description, content } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Skill name is required' });
  }
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Skill instructions/content are required' });
  }

  const cleanName = name.trim().toLowerCase().replace(/^\/+/, '');
  if (!/^[a-z0-9_\-]+$/i.test(cleanName)) {
    return res.status(400).json({ error: 'Skill name can only contain letters, numbers, hyphens, and underscores' });
  }

  const existing = getSkillByName(cleanName);
  if (existing) {
    return res.status(400).json({ error: `Skill "/${cleanName}" already exists` });
  }

  try {
    const newSkill = insertSkill({
      id: uuidv4(),
      name: cleanName,
      description: (description || '').trim(),
      content: content.trim(),
    });
    res.status(201).json(newSkill);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to create skill' });
  }
});

app.put('/api/skills/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { name, description, content } = req.body;

  const existing = getSkillById(id);
  if (!existing) {
    return res.status(404).json({ error: 'Skill not found' });
  }

  let cleanName = existing.name;
  if (name !== undefined) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Skill name cannot be empty' });
    }
    cleanName = name.trim().toLowerCase().replace(/^\/+/, '');
    if (!/^[a-z0-9_\-]+$/i.test(cleanName)) {
      return res.status(400).json({ error: 'Skill name can only contain letters, numbers, hyphens, and underscores' });
    }
    const duplicate = getSkillByName(cleanName);
    if (duplicate && duplicate.id !== id) {
      return res.status(400).json({ error: `Skill "/${cleanName}" already exists` });
    }
  }

  if (content !== undefined && (!content || typeof content !== 'string' || !content.trim())) {
    return res.status(400).json({ error: 'Skill instructions/content cannot be empty' });
  }

  try {
    const updated = updateSkillById(id, {
      name: cleanName,
      description: description !== undefined ? description.trim() : undefined,
      content: content !== undefined ? content.trim() : undefined,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to update skill' });
  }
});

app.delete('/api/skills/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const deleted = deleteSkillById(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to delete skill' });
  }
});

app.get('/api/skills/install/stream', (req: Request, res: Response) => {
  const command = (req.query.command as string) || '';
  if (!command.trim()) {
    return res.status(400).json({ error: 'command query parameter is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent({ type: 'start', command });

  try {
    const { proc, promise } = installSkillWithNpxProcess(command, (chunk) => {
      sendEvent({ type: 'output', chunk });
    });

    req.on('close', () => {
      try {
        if (proc) proc.kill();
      } catch {}
    });

    promise.then((result) => {
      const allSkills = getAllSkills();
      sendEvent({
        type: 'done',
        success: result.success,
        error: result.error,
        installedSkills: result.installedSkills,
        allSkills,
      });
      res.end();
    });
  } catch (err: any) {
    sendEvent({ type: 'output', chunk: `\n[raft error] ${err.message}\n` });
    sendEvent({ type: 'done', success: false, error: err.message });
    res.end();
  }
});


// ===================== Git Accounts APIs =====================
app.get('/api/git-accounts', (_req: Request, res: Response) => {
  res.json(getAllGitAccounts());
});

app.post('/api/git-accounts/verify', async (req: Request, res: Response) => {
  const { provider, token, host } = req.body;
  if (!provider || !token) {
    return res.status(400).json({ error: 'provider and token are required' });
  }

  try {
    if (provider === 'github') {
      const baseHost = (host && host.trim()) || 'https://github.com';
      const isEnterprise = !baseHost.includes('github.com');
      const apiUrl = isEnterprise
        ? `${baseHost.replace(/\/+$/, '')}/api/v3/user`
        : 'https://api.github.com/user';

      const resp = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Raft-App',
        },
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return res.status(resp.status).json({ error: `GitHub verification failed (${resp.status}): ${errText}` });
      }

      const data = await resp.json() as any;
      return res.json({
        valid: true,
        username: data.login,
        name: data.name || data.login,
        avatarUrl: data.avatar_url || null,
        provider: 'github',
        host: baseHost,
      });
    } else if (provider === 'gitlab') {
      const baseHost = (host && host.trim()) || 'https://gitlab.com';
      const apiUrl = `${baseHost.replace(/\/+$/, '')}/api/v4/user`;

      const resp = await fetch(apiUrl, {
        headers: {
          'PRIVATE-TOKEN': token.trim(),
          'User-Agent': 'Raft-App',
        },
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return res.status(resp.status).json({ error: `GitLab verification failed (${resp.status}): ${errText}` });
      }

      const data = await resp.json() as any;
      return res.json({
        valid: true,
        username: data.username,
        name: data.name || data.username,
        avatarUrl: data.avatar_url || null,
        provider: 'gitlab',
        host: baseHost,
      });
    } else {
      return res.status(400).json({ error: `Unsupported git provider: ${provider}` });
    }
  } catch (err: any) {
    return res.status(500).json({ error: `Verification network error: ${err.message}` });
  }
});

app.post('/api/git-accounts', (req: Request, res: Response) => {
  const { provider, name, username, avatar_url, token, host } = req.body;
  if (!provider || !name || !username || !token) {
    return res.status(400).json({ error: 'provider, name, username, and token are required' });
  }

  const id = uuidv4();
  const created_at = Date.now();
  const accountHost = (host && host.trim()) || (provider === 'github' ? 'https://github.com' : 'https://gitlab.com');
  insertGitAccount({
    id,
    provider,
    name,
    username,
    avatar_url: avatar_url || null,
    token: token.trim(),
    host: accountHost,
    created_at,
  });

  try {
    const projects = db.prepare('SELECT path FROM projects').all() as { path: string }[];
    for (const proj of projects) {
      if (fs.existsSync(proj.path)) {
        try {
          const remoteUrl = execSync('git config --get remote.origin.url', {
            cwd: proj.path,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }).trim();
          if (remoteUrl) {
            const matched = findGitAccountForRemote(remoteUrl, username);
            if (matched && matched.token) {
              GitService.configureRepoCredentials(proj.path, remoteUrl, matched.token, matched.username);
            }
          }
        } catch {}
      }
    }
  } catch {}

  res.json({
    id,
    provider,
    name,
    username,
    avatar_url: avatar_url || null,
    host: accountHost,
    created_at,
  });
});

app.delete('/api/git-accounts/:id', (req: Request, res: Response) => {
  const success = deleteGitAccountById(req.params.id as string);
  if (!success) {
    return res.status(404).json({ error: 'Git account not found' });
  }
  res.json({ success: true });
});

app.get('/api/git-accounts/:id/repos', async (req: Request, res: Response) => {
  const account = getGitAccountById(req.params.id as string);
  if (!account) {
    return res.status(404).json({ error: 'Git account not found' });
  }

  try {
    if (account.provider === 'github') {
      const isEnterprise = !account.host.includes('github.com');
      const apiUrl = isEnterprise
        ? `${account.host.replace(/\/+$/, '')}/api/v3/user/repos?per_page=100&sort=updated`
        : 'https://api.github.com/user/repos?per_page=100&sort=updated';

      const resp = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${account.token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Raft-App',
        },
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return res.status(resp.status).json({ error: `Failed to fetch GitHub repos (${resp.status}): ${errText}` });
      }

      const repos = (await resp.json()) as any[];
      const items = repos.map((r) => ({
        name: r.name,
        fullName: r.full_name,
        cloneUrl: r.clone_url,
        sshUrl: r.ssh_url,
        isPrivate: !!r.private,
        description: r.description,
        updatedAt: r.updated_at,
      }));
      return res.json(items);
    } else if (account.provider === 'gitlab') {
      const apiUrl = `${account.host.replace(/\/+$/, '')}/api/v4/projects?membership=true&per_page=100&order_by=updated_at`;
      const resp = await fetch(apiUrl, {
        headers: {
          'PRIVATE-TOKEN': account.token,
          'User-Agent': 'Raft-App',
        },
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return res.status(resp.status).json({ error: `Failed to fetch GitLab repos (${resp.status}): ${errText}` });
      }

      const projects = (await resp.json()) as any[];
      const items = projects.map((p) => ({
        name: p.name,
        fullName: p.path_with_namespace,
        cloneUrl: p.http_url_to_repo,
        sshUrl: p.ssh_url_to_repo,
        isPrivate: p.visibility !== 'public',
        description: p.description,
        updatedAt: p.last_activity_at,
      }));
      return res.json(items);
    } else {
      return res.status(400).json({ error: `Unsupported git provider: ${account.provider}` });
    }
  } catch (err: any) {
    return res.status(500).json({ error: `Error fetching remote repositories: ${err.message}` });
  }
});

// Validate path
app.post('/api/projects/validate', (req: Request, res: Response) => {
  const { path: dirPath } = req.body;
  if (!dirPath) {
    return res.status(400).json({ error: 'Path is required' });
  }
  const repoInfo = GitService.getRepoInfo(dirPath);
  res.json(repoInfo);
});

// Initialize Git Repository
app.post('/api/projects/init', (req: Request, res: Response) => {
  const { path: dirPath } = req.body;
  if (!dirPath) {
    return res.status(400).json({ error: 'Path is required' });
  }
  const repoInfo = GitService.initRepo(dirPath);
  if (!repoInfo.isRepo) {
    return res.status(500).json({ error: repoInfo.error || 'Failed to initialize git repository' });
  }
  res.json(repoInfo);
});

// File System Browser API (in-page folder selector)
app.get('/api/fs', async (req: Request, res: Response) => {
  const requestedPath = (req.query.path as string) || '';
  const currentPath = requestedPath ? path.resolve(requestedPath) : os.homedir();

  try {
    const stats = await fs.promises.stat(currentPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    // Check if the current folder itself is a git repository
    let isRepo = false;
    try {
      await fs.promises.access(path.join(currentPath, '.git'), fs.constants.F_OK);
      isRepo = true;
    } catch {
      // not a git repo
    }

    const items = await fs.promises.readdir(currentPath, { withFileTypes: true });
    const directories = items.filter((item) => item.isDirectory());

    const contents: Array<{ name: string; path: string; isRepo: boolean }> = [];
    const BATCH_SIZE = 50;

    for (let i = 0; i < directories.length; i += BATCH_SIZE) {
      const batch = directories.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (item) => {
          const itemPath = path.join(currentPath, item.name);
          let itemIsRepo = false;
          try {
            await fs.promises.access(path.join(itemPath, '.git'), fs.constants.F_OK);
            itemIsRepo = true;
          } catch {
            // not a git repo
          }
          return {
            name: item.name,
            path: itemPath,
            isRepo: itemIsRepo,
          };
        })
      );
      contents.push(...batchResults);
    }

    // Sort: Visible folders first, Repos first within group, then alphabetical
    contents.sort((a, b) => {
      const aHidden = a.name.startsWith('.');
      const bHidden = b.name.startsWith('.');

      if (!aHidden && bHidden) return -1;
      if (aHidden && !bHidden) return 1;

      if (a.isRepo && !b.isRepo) return -1;
      if (!a.isRepo && b.isRepo) return 1;

      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    const parentDir = path.dirname(currentPath);
    const parent = parentDir === currentPath ? null : parentDir;

    // Detect available drives on Windows
    let drives: string[] | undefined;
    if (process.platform === 'win32') {
      drives = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        .split('')
        .map((d) => `${d}:\\`)
        .filter((dPath) => {
          try {
            return fs.existsSync(dPath);
          } catch {
            return false;
          }
        });
    }

    // Quick shortcuts
    const homedir = os.homedir();
    const candidateShortcuts = [
      { name: 'Home', path: homedir },
      { name: 'Desktop', path: path.join(homedir, 'Desktop') },
      { name: 'Downloads', path: path.join(homedir, 'Downloads') },
      { name: 'Documents', path: path.join(homedir, 'Documents') },
    ];
    const shortcuts = candidateShortcuts.filter((s) => {
      try {
        return fs.existsSync(s.path);
      } catch {
        return false;
      }
    });

    res.json({
      path: currentPath,
      isRepo,
      folders: contents,
      parent,
      drives,
      shortcuts,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/fs', async (req: Request, res: Response) => {
  try {
    const rawParentPath = typeof req.body?.path === 'string' ? req.body.path : '';
    const rawFolderName = typeof req.body?.name === 'string' ? req.body.name : '';

    const parentPath = rawParentPath.trim();
    const folderName = rawFolderName.trim();

    if (!parentPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    if (!folderName) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    if (folderName === '.' || folderName === '..') {
      return res.status(400).json({ error: 'Invalid folder name' });
    }
    if (folderName.includes('/') || folderName.includes('\\') || path.basename(folderName) !== folderName) {
      return res.status(400).json({ error: 'Folder name cannot include path separators' });
    }

    const parentStat = await fs.promises.stat(parentPath);
    if (!parentStat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    const folderPath = path.join(parentPath, folderName);
    if (fs.existsSync(folderPath)) {
      return res.status(400).json({ error: 'Folder already exists' });
    }

    await fs.promises.mkdir(folderPath);

    res.json({
      path: folderPath,
      name: folderName,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Helper functions for project custom scripts
function parseScripts(raw: any) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const DEFAULT_PROJECT_ICON = 'purple-triangle';
export const VALID_PROJECT_ICONS = new Set([
  'purple-triangle',
  'coral-circle-smile',
  'blue-square',
  'yellow-diamond-wink',
  'green-star',
  'orange-hexagon-angry',
  'pink-heart',
  'teal-triangle-smile',
  'purple-flower',
  'blue-capsule-sleep',
  'green-square',
  'yellow-star-smile',
  'coral-triangle-squint',
  'orange-circle',
  'purple-pentagon',
  'blue-diamond',
  'purple-cloud-smile',
  'green-heart',
  'coral-hexagon-cross',
  'yellow-triangle',
  'pink-flower',
  'teal-capsule-wink',
  'indigo-square-smile',
  'green-circle',
  'orange-star-angry',
]);

function formatProject(p: any) {
  if (!p) return null;
  const isCustomOrValid = p.icon && (VALID_PROJECT_ICONS.has(p.icon) || p.icon.startsWith('icon-'));
  return {
    ...p,
    icon: isCustomOrValid ? p.icon : DEFAULT_PROJECT_ICON,
    system_prompt: p.system_prompt || '',
    custom_scripts: parseScripts(p.custom_scripts),
  };
}

// Projects
app.get('/api/projects', (_req: Request, res: Response) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as any[];
  // Augment with active tasks count
  const taskCountStmt = db.prepare('SELECT count(*) as count FROM tasks WHERE project_id = ?');
  const result = projects.map((p) => {
    const { count } = taskCountStmt.get(p.id) as { count: number };
    return { ...formatProject(p), task_count: count };
  });
  res.json(result);
});

app.post('/api/projects', (req: Request, res: Response) => {
  const { path: rawPath, name: customName, dev_cmd, dev_port, build_cmd, test_cmd, install_cmd, branch_convention, icon, custom_scripts, system_prompt } = req.body;
  const projectPath = path.resolve(rawPath);
  const repoInfo = GitService.getRepoInfo(projectPath);
  if (!repoInfo.isRepo) {
    return res.status(400).json({ error: 'Specified path is not a valid git repository' });
  }

  const id = uuidv4();
  const name = customName || path.basename(projectPath);
  const now = Date.now();
  const effectiveInstallCmd = install_cmd !== undefined ? install_cmd : detectInstallCommand(projectPath);

  try {
    const stmt = db.prepare(`
      INSERT INTO projects (
        id, name, path, dev_cmd, dev_port, build_cmd, test_cmd, install_cmd, branch_convention, icon,
        default_agent_cli, default_model, custom_scripts, system_prompt, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      name,
      projectPath,
      dev_cmd || 'npm run dev',
      dev_port || 5173,
      build_cmd || 'npm run build',
      test_cmd || 'npm test',
      effectiveInstallCmd,
      branch_convention || repoInfo.currentBranch || 'main',
      icon && (VALID_PROJECT_ICONS.has(icon) || icon.startsWith('icon-')) ? icon : DEFAULT_PROJECT_ICON,
      getEffectiveAgentCli(),
      getSetting('default_model', ''),
      custom_scripts ? JSON.stringify(custom_scripts) : '[]',
      system_prompt || '',
      now,
      now
    );

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);

    try {
      const remoteUrl = execSync('git config --get remote.origin.url', {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      if (remoteUrl) {
        const account = findGitAccountForRemote(remoteUrl);
        if (account && account.token) {
          GitService.configureRepoCredentials(projectPath, remoteUrl, account.token, account.username);
        }
      }
    } catch {}

    res.json(formatProject(project));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Clone Remote Git Repository Stream (SSE)
app.get('/api/projects/clone/stream', async (req: Request, res: Response) => {
  const url = ((req.query.url as string) || '').trim();
  const parentPath = ((req.query.parentPath as string) || '').trim();
  const folderName = ((req.query.folderName as string) || '').trim();
  const accountId = ((req.query.accountId as string) || '').trim();

  if (!url || !parentPath || !folderName) {
    return res.status(400).json({ error: 'url, parentPath, and folderName are required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const resolvedParent = path.resolve(parentPath);
  const targetPath = path.join(resolvedParent, folderName);

  if (fs.existsSync(targetPath)) {
    sendEvent({ type: 'output', chunk: `Error: Destination directory already exists: ${targetPath}\n` });
    sendEvent({ type: 'done', success: false, error: 'Destination directory already exists' });
    return res.end();
  }

  try {
    if (!fs.existsSync(resolvedParent)) {
      fs.mkdirSync(resolvedParent, { recursive: true });
    }
  } catch (err: any) {
    sendEvent({ type: 'output', chunk: `Error creating parent directory: ${err.message}\n` });
    sendEvent({ type: 'done', success: false, error: err.message });
    return res.end();
  }

  const cloneArgs: string[] = ['clone', '--progress'];
  let tokenToMask = '';
  let account: any = null;

  if (accountId) {
    account = getGitAccountById(accountId);
    if (account && account.token) {
      tokenToMask = account.token;
      const authBasic = Buffer.from(`${account.username || 'git'}:${account.token}`).toString('base64');
      cloneArgs.push('-c', `http.extraheader=AUTHORIZATION: basic ${authBasic}`);
    }
  }

  cloneArgs.push(url, targetPath);

  sendEvent({ type: 'output', chunk: `→ git clone --progress ${url} ${targetPath}\n` });

  let proc: any;
  try {
    proc = spawn('git', cloneArgs, {
      cwd: resolvedParent,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    req.on('close', () => {
      try {
        if (proc && !proc.killed) proc.kill();
      } catch {}
    });

    const sanitize = (text: string) => {
      if (!tokenToMask) return text;
      return text.replaceAll(tokenToMask, '***');
    };

    proc.stdout?.on('data', (d: Buffer) => {
      sendEvent({ type: 'output', chunk: sanitize(d.toString('utf-8')) });
    });

    proc.stderr?.on('data', (d: Buffer) => {
      sendEvent({ type: 'output', chunk: sanitize(d.toString('utf-8')) });
    });

    proc.on('close', (code: number) => {
      if (code === 0) {
        if (account && account.token && url.startsWith('http')) {
          GitService.configureRepoCredentials(targetPath, url, account.token, account.username);
        }
        const repoInfo = GitService.getRepoInfo(targetPath);
        sendEvent({
          type: 'done',
          success: true,
          projectPath: targetPath,
          repoInfo,
        });
      } else {
        sendEvent({
          type: 'done',
          success: false,
          error: `git clone failed with exit code ${code}`,
        });
      }
      res.end();
    });

    proc.on('error', (err: any) => {
      sendEvent({ type: 'output', chunk: `\n[error] ${err.message}\n` });
      sendEvent({ type: 'done', success: false, error: err.message });
      res.end();
    });
  } catch (err: any) {
    sendEvent({ type: 'output', chunk: `\n[error] ${err.message}\n` });
    sendEvent({ type: 'done', success: false, error: err.message });
    res.end();
  }
});

// Create New Local Git Repository
app.post('/api/projects/create-new', (req: Request, res: Response) => {
  const { parentPath, name, defaultBranch } = req.body;
  if (!parentPath || !name) {
    return res.status(400).json({ error: 'parentPath and name are required' });
  }

  try {
    const repoInfo = GitService.createNewRepo(parentPath, name, defaultBranch || 'main', true);
    if (!repoInfo.isRepo) {
      return res.status(500).json({ error: repoInfo.error || 'Failed to create git repository' });
    }

    const id = uuidv4();
    const now = Date.now();
    const targetPath = repoInfo.repoRoot;

    const stmt = db.prepare(`
      INSERT INTO projects (
        id, name, path, dev_cmd, dev_port, build_cmd, test_cmd, install_cmd, branch_convention, icon,
        default_agent_cli, default_model, custom_scripts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      name,
      targetPath,
      'npm run dev',
      5173,
      'npm run build',
      'npm test',
      detectInstallCommand(targetPath),
      repoInfo.currentBranch || defaultBranch || 'main',
      DEFAULT_PROJECT_ICON,
      getEffectiveAgentCli(),
      getSetting('default_model', ''),
      '[]',
      now,
      now
    );

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.json({ project: formatProject(project), repoInfo });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create new repository' });
  }
});

app.get('/api/projects/:id', (req: Request, res: Response) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(formatProject(project));
});

app.put('/api/projects/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const {
    name,
    dev_cmd,
    dev_port,
    build_cmd,
    test_cmd,
    install_cmd,
    branch_convention,
    icon,
    default_agent_cli,
    default_model,
    custom_scripts,
    system_prompt,
  } = req.body;
  const now = Date.now();

  const parsedPort =
    dev_port !== undefined && dev_port !== null && dev_port !== ''
      ? parseInt(String(dev_port), 10)
      : null;

  const sanitizedIcon =
    icon !== undefined
      ? (icon && (VALID_PROJECT_ICONS.has(icon) || icon.startsWith('icon-')) ? icon : DEFAULT_PROJECT_ICON)
      : null;

  db.prepare(`
    UPDATE projects SET
      name = coalesce(?, name),
      dev_cmd = coalesce(?, dev_cmd),
      dev_port = coalesce(?, dev_port),
      build_cmd = coalesce(?, build_cmd),
      test_cmd = coalesce(?, test_cmd),
      install_cmd = coalesce(?, install_cmd),
      branch_convention = coalesce(?, branch_convention),
      icon = coalesce(?, icon),
      default_agent_cli = coalesce(?, default_agent_cli),
      default_model = coalesce(?, default_model),
      custom_scripts = coalesce(?, custom_scripts),
      system_prompt = coalesce(?, system_prompt),
      updated_at = ?
    WHERE id = ?
  `).run(
    name !== undefined ? name : null,
    dev_cmd !== undefined ? dev_cmd : null,
    parsedPort !== null && !isNaN(parsedPort) ? parsedPort : null,
    build_cmd !== undefined ? build_cmd : null,
    test_cmd !== undefined ? test_cmd : null,
    install_cmd !== undefined ? install_cmd : null,
    branch_convention !== undefined ? branch_convention : null,
    sanitizedIcon,
    default_agent_cli !== undefined ? default_agent_cli : null,
    default_model !== undefined ? default_model : null,
    custom_scripts !== undefined ? JSON.stringify(custom_scripts) : null,
    system_prompt !== undefined ? system_prompt : null,
    now,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json(formatProject(updated));
});

// Project Custom Scripts Management API
app.get('/api/projects/:id/scripts', (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const project = db.prepare('SELECT custom_scripts FROM projects WHERE id = ?').get(projectId) as any;
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(parseScripts(project.custom_scripts));
});

app.put('/api/projects/:id/scripts', (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const { scripts } = req.body;
  if (!Array.isArray(scripts)) {
    return res.status(400).json({ error: 'scripts must be an array' });
  }
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const now = Date.now();
  db.prepare('UPDATE projects SET custom_scripts = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(scripts),
    now,
    projectId
  );
  res.json({ success: true, scripts });
});

// Task Scripts & Terminal Executions API
app.get('/api/tasks/:taskId/scripts', (req: Request, res: Response) => {
  const taskId = String(req.params.taskId);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id) as any;
  const scripts = parseScripts(project?.custom_scripts);
  const executions = scriptManager.getExecutions({ taskId });
  res.json({ scripts, executions });
});

app.post('/api/tasks/:taskId/scripts/run', (req: Request, res: Response) => {
  const taskId = String(req.params.taskId);
  const { id, name, command, saveToProject } = req.body;

  if (!command || !command.trim()) {
    return res.status(400).json({ error: 'Command is required' });
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id) as any;

  const trimmedCmd = command.trim();
  const scriptName = name?.trim() || trimmedCmd;
  const worktreePath = project?.path
    ? GitService.ensureWorktree(
        project.path,
        task.worktree_path,
        task.branch,
        task.base_branch || project.branch_convention || 'main'
      )
    : (task.worktree_path || project?.path);

  // Optionally save to project custom scripts
  if (saveToProject && project) {
    const existingScripts = parseScripts(project.custom_scripts);
    const exists = existingScripts.some((s: any) => s.command === trimmedCmd);
    if (!exists) {
      existingScripts.push({
        id: uuidv4(),
        name: scriptName,
        command: trimmedCmd,
      });
      db.prepare('UPDATE projects SET custom_scripts = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(existingScripts),
        Date.now(),
        project.id
      );
    }
  }

  const execution = scriptManager.startExecution({
    taskId,
    projectId: task.project_id,
    scriptName,
    command: trimmedCmd,
    worktreePath,
    customId: id || undefined,
  });

  res.json(execution);
});

app.get('/api/scripts/executions', (req: Request, res: Response) => {
  const taskId = req.query.taskId as string | undefined;
  const projectId = req.query.projectId as string | undefined;
  res.json(scriptManager.getExecutions({ taskId, projectId }));
});

app.post('/api/scripts/:executionId/cancel', (req: Request, res: Response) => {
  const executionId = String(req.params.executionId);
  const force = req.body.force === true;
  const ok = scriptManager.cancelExecution(executionId, force);
  res.json({ success: ok });
});

app.post('/api/scripts/:executionId/rerun', (req: Request, res: Response) => {
  const executionId = String(req.params.executionId);
  const next = scriptManager.rerunExecution(executionId);
  if (!next) return res.status(404).json({ error: 'Execution not found' });
  res.json(next);
});

app.post('/api/scripts/:executionId/dismiss', (req: Request, res: Response) => {
  const executionId = String(req.params.executionId);
  const ok = scriptManager.dismissExecution(executionId);
  res.json({ success: ok });
});

app.delete('/api/projects/:id', (req: Request, res: Response) => {
  // Also clean up any associated task worktrees
  const tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ?').all(req.params.id) as any[];
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id) as any;
  if (project) {
    for (const task of tasks) {
      try {
        GitService.removeWorktree(project.path, task.worktree_path, task.branch);
        devServerManager.stopServer(task.id);
      } catch {}
    }
  }
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Tasks
app.get('/api/projects/:projectId/tasks', (req: Request, res: Response) => {
  const tasks = db.prepare(`
    SELECT t.*,
           CASE WHEN EXISTS (SELECT 1 FROM chat_sessions cs WHERE cs.task_id = t.id AND cs.status = 'running')
                THEN 'WIP'
                ELSE 'idle'
           END AS agent_status
    FROM tasks t
    WHERE t.project_id = ?
    ORDER BY t.created_at DESC
  `).all(req.params.projectId);
  res.json(tasks);
});

app.post('/api/projects/:projectId/tasks', async (req: Request, res: Response) => {
  const { name, baseBranch } = req.body;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId) as any;
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const { worktreePath, branch, hasConflicts } = GitService.createWorktree(project.path, name, baseBranch || project.branch_convention || 'main');
    const id = uuidv4();
    const now = Date.now();

    db.prepare(`
      INSERT INTO tasks (id, project_id, name, branch, base_branch, worktree_path, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, project.id, name, branch, baseBranch || 'main', worktreePath, 'active', now, now);

    // Create default initial chat session tab
    const chatSessionId = uuidv4();
    // Global settings take precedence; project defaults are only a snapshot taken at project creation
    const defaultCli = getEffectiveAgentCli() || project.default_agent_cli;
    let defaultModel = getSetting<string>('default_model', '') || project.default_model || '';
    let defaultEffort = getSetting('thinking_effort', 'medium');

    try {
      const available = await getModelsForCli(defaultCli);
      if (Array.isArray(available) && available.length > 0) {
        const matches = defaultModel && available.some((m) => m.id === defaultModel);
        if (!matches) {
          const rec = available.find((m) => m.name.toLowerCase().includes('(recommended)')) || available[0];
          defaultModel = rec.id;
        }
        const modelObj = available.find((m) => m.id === defaultModel);
        if (modelObj) {
          const validEfforts = modelObj.reasoningEfforts || ['none', 'low', 'medium', 'high', 'max'];
          if (!defaultEffort || !validEfforts.map((e) => e.toLowerCase()).includes(defaultEffort.toLowerCase())) {
            defaultEffort = modelObj.defaultEffort || validEfforts[0] || 'medium';
          }
        }
      }
    } catch {}

    db.prepare(`
      INSERT INTO chat_sessions (id, task_id, title, agent_cli, model, thinking_effort, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(chatSessionId, id, 'Chat 1', defaultCli, defaultModel, defaultEffort, 'idle', now, now);

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    const initialChat = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(chatSessionId) as any;
    if (task && initialChat) {
      task.initialChat = initialChat;
      task.chats = [initialChat];
    }

    // Auto-install project dependencies in the new worktree
    const installCmd = (project.install_cmd && project.install_cmd.trim()) || detectInstallCommand(worktreePath);
    if (installCmd && installCmd.trim()) {
      try {
        scriptManager.startExecution({
          taskId: id,
          projectId: project.id,
          scriptName: 'Install Dependencies',
          command: installCmd.trim(),
          worktreePath,
        });
      } catch (err: any) {
        console.warn(`Failed to auto-start dependency install for task ${id}:`, err);
      }
    }

    // If existing branch had merge conflicts against base branch upon worktree creation,
    // launch AI rebase agent in background to resolve them
    if (hasConflicts) {
      try {
        runRebaseAgent(
          worktreePath,
          baseBranch || project.branch_convention || 'main',
          defaultCli,
          defaultModel,
          defaultEffort,
          (ev) => {
            if (ev.type === 'done') {
              GitService.invalidateTaskStatus(worktreePath);
            }
          },
          project.path,
          branch,
          {
            projectName: project.name,
            taskName: task.name,
            systemPrompt: project.system_prompt,
          }
        );
      } catch (agentErr) {
        console.warn(`Failed to spawn background rebase agent for conflicted task ${id}:`, agentErr);
      }
    }

    res.json({
      ...task,
      project: formatProject(project),
      chats: initialChat ? [initialChat] : [],
      initial_chat: initialChat || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks', (_req: Request, res: Response) => {
  try {
    const tasks = db.prepare(`
      SELECT t.*,
             CASE WHEN EXISTS (SELECT 1 FROM chat_sessions cs WHERE cs.task_id = t.id AND cs.status = 'running')
                  THEN 'WIP'
                  ELSE 'idle'
             END AS agent_status,
             MAX(t.updated_at, COALESCE((SELECT MAX(cs.updated_at) FROM chat_sessions cs WHERE cs.task_id = t.id), t.updated_at)) AS effective_updated_at
      FROM tasks t
      ORDER BY effective_updated_at DESC
    `).all() as any[];

    const projects = db.prepare('SELECT * FROM projects').all() as any[];
    const projectMap = new Map(projects.map((p) => [p.id, formatProject(p)]));

    const result = tasks.map((t) => {
      const { effective_updated_at, ...taskFields } = t;
      return {
        ...taskFields,
        updated_at: effective_updated_at || taskFields.updated_at,
        project: projectMap.get(t.project_id) || undefined,
      };
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to list tasks' });
  }
});

app.get('/api/tasks/:id', (req: Request, res: Response) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
  res.json({ ...task, project: formatProject(project) });
});

app.delete('/api/tasks/:id', (req: Request, res: Response) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  if (task) {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id) as any;
    if (project) {
      GitService.removeWorktree(project.path, task.worktree_path, task.branch);
    }
    devServerManager.stopServer(task.id);
  }
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.patch('/api/tasks/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const { status, name, base_branch, baseBranch, is_pinned } = req.body;
  const targetBaseBranch = base_branch !== undefined ? base_branch : baseBranch;
  const targetIsPinned = is_pinned !== undefined ? (is_pinned ? 1 : 0) : null;

  if (name !== undefined && typeof name === 'string' && !name.trim()) {
    return res.status(400).json({ error: 'Task name cannot be empty' });
  }

  const trimmedName = name !== undefined ? name.trim() : null;
  const now = Date.now();
  db.prepare(`
    UPDATE tasks SET
      status = coalesce(?, status),
      name = coalesce(?, name),
      base_branch = coalesce(?, base_branch),
      is_pinned = coalesce(?, is_pinned),
      updated_at = ?
    WHERE id = ?
  `).run(status ?? null, trimmedName, targetBaseBranch ?? null, targetIsPinned, now, req.params.id);
  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  const project = updated ? db.prepare('SELECT * FROM projects WHERE id = ?').get(updated.project_id) : undefined;
  res.json({ ...updated, project: formatProject(project) });
});

// Git status & diff for task
app.get('/api/tasks/:id/git/status', async (req: Request, res: Response) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const force = req.query.force === '1' || req.query.force === 'true';

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id) as any;
  const effectiveWorktreePath = project?.path
    ? GitService.ensureWorktree(
        project.path,
        task.worktree_path,
        task.branch,
        task.base_branch || project.branch_convention || 'main'
      )
    : task.worktree_path;

  if (effectiveWorktreePath && effectiveWorktreePath !== task.worktree_path) {
    try {
      db.prepare('UPDATE tasks SET worktree_path = ? WHERE id = ?').run(effectiveWorktreePath, task.id);
      task.worktree_path = effectiveWorktreePath;
    } catch {}
  }

  const remoteUrl = GitService.getRemoteUrl(task.worktree_path, task.branch);
  const account = remoteUrl ? findGitAccountForRemote(remoteUrl) : undefined;
  const status = await GitService.getDetailedTaskStatus(task.worktree_path, task.branch, task.base_branch, {
    token: account?.token,
    provider: account?.provider as any,
    forceRefresh: force,
    taskCreatedAt: task.created_at,
  });
  const isAgentRunning = Boolean(
    db.prepare("SELECT 1 FROM chat_sessions WHERE task_id = ? AND status = 'running' LIMIT 1").get(task.id)
  );
  res.json({
    ...status,
    agent_status: isAgentRunning ? 'WIP' : 'idle',
  });
});

// Batch Git status for all tasks in a project
app.get('/api/projects/:id/tasks-status', async (req: Request, res: Response) => {
  const tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ?').all(req.params.id) as any[];
  const force = req.query.force === '1' || req.query.force === 'true';
  const results: Record<string, any> = {};

  await Promise.all(
    tasks.map(async (task) => {
      const isAgentRunning = Boolean(
        db.prepare("SELECT 1 FROM chat_sessions WHERE task_id = ? AND status = 'running' LIMIT 1").get(task.id)
      );
      try {
        const remoteUrl = GitService.getRemoteUrl(task.worktree_path, task.branch);
        const account = remoteUrl ? findGitAccountForRemote(remoteUrl) : undefined;
        const status = await GitService.getDetailedTaskStatus(task.worktree_path, task.branch, task.base_branch, {
          token: account?.token,
          provider: account?.provider as any,
          forceRefresh: force,
          taskCreatedAt: task.created_at,
        });
        results[task.id] = {
          ...status,
          agent_status: isAgentRunning ? 'WIP' : 'idle',
        };
      } catch {
        results[task.id] = {
          staged: [],
          unstaged: [],
          untracked: [],
          hasLocalChanges: false,
          unpushedCount: 0,
          unpushedCommits: [],
          behindCount: 0,
          aheadCount: 0,
          isMerged: false,
          pr: null,
          createPrUrl: null,
          baseBranch: task.base_branch || 'main',
          branch: task.branch,
          lifecycleStage: 'clean',
          agent_status: isAgentRunning ? 'WIP' : 'idle',
          checkedAt: Date.now(),
        };
      }
    })
  );

  res.json(results);
});

app.get('/api/tasks/:id/git/diff', (req: Request, res: Response) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const diff = GitService.getGitDiff(task.worktree_path);
  res.json({ diff });
});

app.post('/api/tasks/:id/git/commit-message', async (req: Request, res: Response) => {
  const taskId = req.params.id as string;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const defaultCli = req.body?.cli || getEffectiveAgentCli();
  const defaultModel = req.body?.model || getSetting<string>('default_model', '');
  const defaultEffort = req.body?.thinkingEffort || getSetting<string>('thinking_effort', 'medium');

  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id) as any;
    const result = await runCommitMessageAgent(
      task.worktree_path,
      task.name,
      task.branch,
      defaultCli,
      defaultModel,
      defaultEffort,
      undefined,
      {
        projectName: project?.name,
        baseBranch: task.base_branch || project?.base_branch || project?.branch_convention || 'main',
        systemPrompt: project?.system_prompt,
      }
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate commit message' });
  }
});

// Dev Server Control
app.get('/api/dev-servers/active', (req: Request, res: Response) => {
  const activeTaskIds = devServerManager.getActiveDevServerTaskIds();
  res.json({ activeTaskIds });
});

app.get('/api/tasks/:id/dev-server', (req: Request, res: Response) => {
  const taskId = req.params.id as string;
  const state = devServerManager.getServerState(taskId);
  res.json(state);
});

app.get('/api/tasks/:id/dev-server/ping', async (req: Request, res: Response) => {
  const taskId = req.params.id as string;
  const result = await devServerManager.checkServerReady(taskId);
  res.json(result);
});

app.post('/api/tasks/:id/dev-server/start', (req: Request, res: Response) => {
  const taskId = req.params.id as string;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id) as any;

  const devCmd = project?.dev_cmd || 'npm run dev';
  const port = project?.dev_port || 5173;
  const state = devServerManager.startServer(task.id, task.worktree_path, devCmd, port);
  res.json(state);
});

app.post('/api/tasks/:id/dev-server/stop', (req: Request, res: Response) => {
  const taskId = req.params.id as string;
  const onlyIfNoSubscribers = req.query.onlyIfNoSubscribers === 'true' || req.body?.onlyIfNoSubscribers === true;
  const wasRunning = devServerManager.stopServer(taskId, { onlyIfNoSubscribers });
  res.json({ success: true, wasRunning });
});

app.post('/api/tasks/:id/dev-server/schedule-stop', (req: Request, res: Response) => {
  const taskId = req.params.id as string;
  const rawGrace = req.query.graceMs || req.body?.graceMs;
  const graceMs = rawGrace ? parseInt(String(rawGrace), 10) : 3000;
  const scheduled = devServerManager.schedulePendingStop(taskId, isNaN(graceMs) ? 3000 : graceMs);
  res.json({ scheduled });
});

app.post('/api/tasks/:id/dev-server/cancel-stop', (req: Request, res: Response) => {
  const taskId = req.params.id as string;
  const cancelled = devServerManager.cancelPendingStop(taskId);
  res.json({ cancelled });
});

app.post('/api/tasks/:id/dev-server/restart', (req: Request, res: Response) => {
  const taskId = req.params.id as string;
  const state = devServerManager.restartServer(taskId);
  res.json(state);
});

// Attachments
app.post('/api/tasks/:taskId/attachments', (req: Request, res: Response) => {
  upload.array('files', 10)(req, res, (uploadErr: any) => {
    if (uploadErr instanceof multer.MulterError) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum file size is 50MB per file.' });
      }
      if (uploadErr.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Too many files. Maximum 10 files per message.' });
      }
      return res.status(400).json({ error: uploadErr.message });
    } else if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || 'File upload failed' });
    }

    try {
      const taskId = req.params.taskId as string;
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const worktreePath = task.worktree_path;
      const attachmentsDir = path.join(worktreePath, '.raft', 'attachments');
      if (!fs.existsSync(attachmentsDir)) {
        fs.mkdirSync(attachmentsDir, { recursive: true });
      }

      ensureGitIgnoreRaft(worktreePath);

      const results = [];
      const now = Date.now();

      for (const file of files) {
        const attachmentId = `att-${Date.now()}-${uuidv4().slice(0, 8)}`;
        const originalName = file.originalname || 'attachment';
        const safeOriginalName = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_');
        const storedFilename = `${attachmentId}_${safeOriginalName}`;
        const fullFilePath = path.join(attachmentsDir, storedFilename);

        fs.writeFileSync(fullFilePath, file.buffer);

        const mimeType = file.mimetype || 'application/octet-stream';
        const size = file.size;
        const relativePath = `.raft/attachments/${storedFilename}`;

        db.prepare(`
          INSERT INTO attachments (id, task_id, name, size, mime_type, file_path, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(attachmentId, taskId, originalName, size, mimeType, relativePath, now);

        results.push({
          id: attachmentId,
          name: originalName,
          size,
          type: mimeType,
          path: relativePath,
          url: `/api/tasks/${taskId}/attachments/${attachmentId}`,
        });
      }

      res.json(results);
    } catch (err: any) {
      console.error('Error handling attachment upload:', err);
      res.status(500).json({ error: err.message || 'Failed to upload attachments' });
    }
  });
});

app.get('/api/tasks/:taskId/attachments/:attachmentId', (req: Request, res: Response) => {
  try {
    const { taskId, attachmentId } = req.params;
    const attachment = db.prepare('SELECT * FROM attachments WHERE id = ? AND task_id = ?').get(attachmentId, taskId) as any;
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const fullFilePath = path.resolve(task.worktree_path, attachment.file_path);
    if (!fs.existsSync(fullFilePath)) {
      return res.status(404).json({ error: 'Attachment file not found on disk' });
    }

    const isDownload = req.query.download === '1' || req.query.download === 'true';
    const disposition = isDownload ? 'attachment' : 'inline';

    res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(attachment.name)}"`);

    const fileStream = fs.createReadStream(fullFilePath);
    fileStream.pipe(res);
  } catch (err: any) {
    console.error('Error serving attachment:', err);
    res.status(500).json({ error: 'Failed to serve attachment' });
  }
});

app.get('/api/tasks/:taskId/attachments/:attachmentId/content', (req: Request, res: Response) => {
  try {
    const { taskId, attachmentId } = req.params;
    const attachment = db.prepare('SELECT * FROM attachments WHERE id = ? AND task_id = ?').get(attachmentId, taskId) as any;
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const fullFilePath = path.resolve(task.worktree_path, attachment.file_path);
    if (!fs.existsSync(fullFilePath)) {
      return res.status(404).json({ error: 'Attachment file not found on disk' });
    }

    const stat = fs.statSync(fullFilePath);
    const MAX_TEXT_BYTES = 512 * 1024; // 512 KB
    let isTruncated = false;
    let content = '';

    if (stat.size > MAX_TEXT_BYTES) {
      const fd = fs.openSync(fullFilePath, 'r');
      const buffer = Buffer.alloc(MAX_TEXT_BYTES);
      fs.readSync(fd, buffer, 0, MAX_TEXT_BYTES, 0);
      fs.closeSync(fd);
      content = buffer.toString('utf-8');
      isTruncated = true;
    } else {
      content = fs.readFileSync(fullFilePath, 'utf-8');
    }

    res.json({
      id: attachment.id,
      name: attachment.name,
      size: attachment.size,
      type: attachment.mime_type,
      content,
      isTruncated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to read attachment content' });
  }
});

// Chat sessions & messages
app.get('/api/tasks/:taskId/chats', (req: Request, res: Response) => {
  const chats = db.prepare('SELECT * FROM chat_sessions WHERE task_id = ? ORDER BY created_at ASC').all(req.params.taskId) as any[];
  const includeMessages = req.query.include_messages === 'true';
  const activeChatId = req.query.active_chat_id as string | undefined;

  if (includeMessages && chats.length > 0) {
    const targetChat = (activeChatId && chats.find((c) => c.id === activeChatId)) || chats[0];
    if (targetChat) {
      targetChat.messages = getSessionMessages(targetChat.id);
    }
  }

  res.json(chats);
});

app.post('/api/tasks/:taskId/chats', async (req: Request, res: Response) => {
  const { title, agent_cli, model, thinking_effort, id: clientId } = req.body;
  // Clients may supply the id so they can create the chat optimistically
  const id = typeof clientId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(clientId) ? clientId : uuidv4();
  if (db.prepare('SELECT 1 FROM chat_sessions WHERE id = ?').get(id)) {
    return res.status(409).json({ error: 'Chat session already exists' });
  }
  const now = Date.now();
  const cli = agent_cli || getEffectiveAgentCli();
  let mod = model;
  let effort = thinking_effort;

  try {
    const available = await getModelsForCli(cli);
    if (Array.isArray(available) && available.length > 0) {
      const matches = mod && available.some((m) => m.id === mod);
      if (!matches) {
        const rec = available.find((m) => m.name.toLowerCase().includes('(recommended)')) || available[0];
        mod = rec.id;
      }
      const modelObj = available.find((m) => m.id === mod);
      if (modelObj) {
        const validEfforts = modelObj.reasoningEfforts || ['none', 'low', 'medium', 'high', 'max'];
        if (!effort || !validEfforts.map((e) => e.toLowerCase()).includes(effort.toLowerCase())) {
          effort = modelObj.defaultEffort || validEfforts[0] || 'medium';
        }
      }
    }
  } catch {}

  if (!mod) {
    mod = getSetting('default_model', '');
  }
  if (!effort) {
    effort = getSetting('thinking_effort', 'medium');
  }

  db.prepare(`
    INSERT INTO chat_sessions (id, task_id, title, agent_cli, model, thinking_effort, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.taskId, title || 'New Chat', cli, mod, effort, 'idle', now, now);

  const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);
  res.json(session);
});

// Reset any stale running chat sessions to idle on server startup
db.prepare("UPDATE chat_sessions SET status = 'idle' WHERE status = 'running'").run();

interface ActiveChatSession {
  proc: any;
  sessionId: string;
  assistantMsgId: string;
  getContent: () => string;
  abort: () => void;
}

const activeChatSessions = new Map<string, ActiveChatSession>();

function extractMessageActivity(rawContent: string, rawMetadata: string | null) {
  let steps: any[] = [];
  let thoughts: string | null = null;
  let cleanContent = rawContent || '';

  if (rawMetadata) {
    try {
      const parsed = JSON.parse(rawMetadata);
      if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
        steps = parsed.steps;
      }
    } catch {}
  }

  if (typeof rawContent === 'string') {
    const thoughtMatch = rawContent.match(/<thought>([\s\S]*?)<\/thought>/);
    if (thoughtMatch) {
      thoughts = thoughtMatch[1].trim();
      cleanContent = rawContent.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
    } else {
      const lines = rawContent.split('\n');
      const thoughtLines: string[] = [];
      const contentLines: string[] = [];
      let inThoughts = true;
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          inThoughts &&
          (trimmed.startsWith('→') ||
            trimmed.startsWith('[') ||
            trimmed.startsWith('Run:') ||
            trimmed.startsWith('Search:'))
        ) {
          thoughtLines.push(line);
        } else {
          inThoughts = false;
          contentLines.push(line);
        }
      }
      if (thoughtLines.length > 0) {
        thoughts = thoughtLines.join('\n').trim();
        cleanContent = contentLines.join('\n').trim();
      }
    }

    if (steps.length === 0 && thoughts) {
      steps = parseLegacyThoughtToSteps(thoughts);
    }
  }

  return { steps, thoughts, cleanContent };
}

function getSessionMessages(chatId: string) {
  const messages = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC').all(chatId) as any[];

  for (const msg of messages) {
    let parsedMeta: any = null;
    if (msg.metadata) {
      try {
        parsedMeta = JSON.parse(msg.metadata);
        if (parsedMeta && Array.isArray(parsedMeta.attachments)) {
          msg.attachments = parsedMeta.attachments;
        }
      } catch {}
    }

    if (msg.role === 'assistant') {
      const { steps, cleanContent } = extractMessageActivity(msg.content, msg.metadata);
      if (steps.length > 0) {
        const files = steps.filter((s: any) => s.category === 'file_read' || s.category === 'file_write').length;
        const commands = steps.filter((s: any) => s.category === 'command').length;
        const totalDuration = steps.reduce((sum: number, s: any) => sum + (s.duration || 0), 0);
        msg.has_activity = true;
        msg.activity_summary = {
          files,
          commands,
          totalSteps: steps.length,
          totalDuration: Math.round(totalDuration * 10) / 10,
        };

        // Strip heavy steps from metadata to keep initial payload tiny
        if (parsedMeta && parsedMeta.steps) {
          delete parsedMeta.steps;
          msg.metadata = JSON.stringify(parsedMeta);
        }

        // Clean out heavy thought block from content
        msg.content = cleanContent;
      }
    }
  }

  // If there is an active running session for this chat, sync the in-memory latest content
  const activeSession = activeChatSessions.get(chatId);
  if (activeSession && messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && (lastMsg.id === activeSession.assistantMsgId || lastMsg.role === 'assistant')) {
      const liveText = activeSession.getContent();
      if (liveText) {
        lastMsg.content = liveText;
      }
    }
  }

  return messages;
}

function broadcastWs(data: any) {
  const payload = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch {}
    }
  }
}

function setChatSessionStatus(sessionId: string, status: 'idle' | 'running', timestamp = Date.now()) {
  db.prepare('UPDATE chat_sessions SET status = ?, updated_at = ? WHERE id = ?').run(status, timestamp, sessionId);
  try {
    const session = db.prepare('SELECT task_id FROM chat_sessions WHERE id = ?').get(sessionId) as { task_id: string } | undefined;
    if (session?.task_id) {
      const isRunning = Boolean(
        db.prepare("SELECT 1 FROM chat_sessions WHERE task_id = ? AND status = 'running' LIMIT 1").get(session.task_id)
      );
      const task = db.prepare('SELECT id, name, project_id FROM tasks WHERE id = ?').get(session.task_id) as any;
      const project = task?.project_id ? db.prepare('SELECT id, name FROM projects WHERE id = ?').get(task.project_id) as any : null;
      broadcastWs({
        type: 'task_agent_status',
        taskId: session.task_id,
        sessionId,
        taskName: task?.name,
        projectName: project?.name,
        agentStatus: isRunning ? 'WIP' : 'idle',
      });
    }
  } catch {}
}

// Forward script manager events to all connected clients
scriptManager.on('global_log', ({ id, chunk }) => {
  broadcastWs({ type: 'script_log', executionId: id, log: chunk });
});

scriptManager.on('global_state', (payload) => {
  broadcastWs({ type: 'script_state', execution: payload });
});

scriptManager.on('global_dismissed', ({ id }) => {
  broadcastWs({ type: 'script_dismissed', executionId: id });
});

// Forward Alpha Intelligence device status changes to all connected clients
alphaDeviceService.on('status_change', (deviceStatus) => {
  const apiUrl = getSetting<string>('alpha_intelligence_api_url', '');
  const apiKey = getSetting<string>('alpha_intelligence_api_key', '');
  broadcastWs({
    type: 'alpha_device_status',
    status: {
      configured: Boolean(apiUrl && apiKey),
      apiUrl,
      device: deviceStatus,
    },
  });
});

// Forward dev server state changes to all connected clients
devServerManager.on('state_change', (state) => {
  broadcastWs({
    type: 'dev_server_state_update',
    taskId: state.taskId,
    status: state.status,
  });
});

app.patch('/api/chats/:id', async (req: Request, res: Response) => {
  const chatId = req.params.id as string;
  const { title, agent_cli, model, thinking_effort } = req.body;
  const existing = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(chatId) as any;
  if (!existing) {
    return res.status(404).json({ error: 'Chat session not found' });
  }

  const newTitle = typeof title === 'string' && title.trim().length > 0 ? title.trim() : existing.title;
  const newCli = agent_cli !== undefined ? agent_cli : existing.agent_cli;
  let newModel = model !== undefined ? model : existing.model;
  let newEffort = thinking_effort !== undefined ? thinking_effort : existing.thinking_effort;
  const isCliChanged = agent_cli !== undefined && agent_cli !== existing.agent_cli;

  if (isCliChanged) {
    try {
      const available = await getModelsForCli(newCli);
      if (Array.isArray(available) && available.length > 0) {
        const matchesCurrent = model !== undefined && available.some((m) => m.id === model);
        if (!matchesCurrent) {
          const rec = available.find((m) => m.name.toLowerCase().includes('(recommended)')) || available[0];
          newModel = rec.id;
          const validEfforts = rec.reasoningEfforts || ['none', 'low', 'medium', 'high', 'max'];
          if (!newEffort || !validEfforts.map((e) => e.toLowerCase()).includes(newEffort.toLowerCase())) {
            newEffort = rec.defaultEffort || validEfforts[0] || 'medium';
          }
        }
      }
    } catch {}
  }

  const now = Date.now();

  db.prepare(`
    UPDATE chat_sessions
    SET title = ?, agent_cli = ?, model = ?, thinking_effort = ?, updated_at = ?
    ${isCliChanged ? ', cli_session_id = NULL, cli_session_agent = NULL' : ''}
    WHERE id = ?
  `).run(newTitle, newCli, newModel, newEffort, now, chatId);

  const updated = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(chatId);
  res.json(updated);
});

app.delete('/api/chats/:id', (req: Request, res: Response) => {
  const chatId = req.params.id as string;
  if (activeChatSessions.has(chatId)) {
    activeChatSessions.get(chatId)?.abort();
  }
  db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(chatId);
  res.json({ success: true });
});

app.delete('/api/messages/:id', (req: Request, res: Response) => {
  const messageId = req.params.id as string;
  db.prepare('DELETE FROM chat_messages WHERE id = ?').run(messageId);
  res.json({ success: true });
});

app.get('/api/messages/:id/activity', (req: Request, res: Response) => {
  const messageId = req.params.id as string;
  const msg = db.prepare('SELECT id, session_id, role, content, metadata FROM chat_messages WHERE id = ?').get(messageId) as any;
  if (!msg) {
    return res.status(404).json({ error: 'Message not found' });
  }

  const { steps, thoughts } = extractMessageActivity(msg.content, msg.metadata);
  res.json({
    messageId,
    steps,
    thoughts,
  });
});

app.get('/api/chats/:id/messages', (req: Request, res: Response) => {
  const chatId = req.params.id as string;
  const messages = getSessionMessages(chatId);
  res.json(messages);
});

// ===================== WEBSOCKETS =====================

wss.on('connection', (ws: WebSocket) => {
  let activeProc: any = null;
  let devLogListener: ((log: string) => void) | null = null;
  let devStateListener: ((state: any) => void) | null = null;
  let currentTaskId: string | null = null;

  const cleanupDevServerListeners = () => {
    if (currentTaskId) {
      devServerManager.removeSubscriber(currentTaskId, ws);
    }
    if (devLogListener && currentTaskId) {
      devServerManager.off(`log:${currentTaskId}`, devLogListener);
      devLogListener = null;
    }
    if (devStateListener && currentTaskId) {
      devServerManager.off(`state:${currentTaskId}`, devStateListener);
      devStateListener = null;
    }
  };

  const send = (data: any) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  };

  // Send current Alpha Intelligence status on initial connection
  try {
    const initApiUrl = getSetting<string>('alpha_intelligence_api_url', '');
    const initApiKey = getSetting<string>('alpha_intelligence_api_key', '');
    send({
      type: 'alpha_device_status',
      status: {
        configured: Boolean(initApiUrl && initApiKey),
        apiUrl: initApiUrl,
        device: alphaDeviceService.getStatus(),
      },
    });
  } catch {
    // ignore
  }

  ws.on('message', async (raw: string) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'get_alpha_status') {
        const curApiUrl = getSetting<string>('alpha_intelligence_api_url', '');
        const curApiKey = getSetting<string>('alpha_intelligence_api_key', '');
        send({
          type: 'alpha_device_status',
          status: {
            configured: Boolean(curApiUrl && curApiKey),
            apiUrl: curApiUrl,
            device: alphaDeviceService.getStatus(),
          },
        });
        return;
      }

      // 1. Discovery session
      if (msg.type === 'start_discovery') {
        const { projectPath, agentCli, model, thinkingEffort } = msg;
        const cli = agentCli || getEffectiveAgentCli();
        const modelToUse = model || getSetting<string>('default_model', '');
        const effortToUse = thinkingEffort || getSetting<string>('thinking_effort', 'medium');
        send({ type: 'status', text: `Scanning repository at ${projectPath}...` });

        const project = db.prepare('SELECT * FROM projects WHERE path = ?').get(projectPath) as any;

        try {
          const result = await runDiscoveryAgent(
            projectPath,
            cli,
            modelToUse,
            effortToUse,
            (ev) => {
              send({ type: 'discovery_event', event: ev });
            },
            {
              projectName: project?.name,
              systemPrompt: project?.system_prompt,
            }
          );
          send({ type: 'discovery_done', result });
        } catch (err: any) {
          send({ type: 'error', error: err.message });
        }
      }

      // 2. Dev server stream subscribe
      else if (msg.type === 'subscribe_dev_server') {
        const { taskId } = msg;
        cleanupDevServerListeners();

        currentTaskId = taskId;
        devServerManager.addSubscriber(taskId, ws);
        const state = devServerManager.getServerState(taskId);
        send({ type: 'dev_server_state', state });

        devLogListener = (log: string) => {
          send({ type: 'dev_server_log', log });
        };
        devStateListener = (updatedState: any) => {
          send({ type: 'dev_server_state', state: updatedState });
        };

        devServerManager.on(`log:${taskId}`, devLogListener);
        devServerManager.on(`state:${taskId}`, devStateListener);
      }

      // Dev server stream unsubscribe
      else if (msg.type === 'unsubscribe_dev_server') {
        cleanupDevServerListeners();
        currentTaskId = null;
      }

      // Script executions subscribe
      else if (msg.type === 'subscribe_scripts') {
        const taskId = msg.taskId as string | undefined;
        const executions = scriptManager.getExecutions({ taskId });
        send({ type: 'script_executions_sync', executions });
      }

      // 3. Rebase agent
      else if (msg.type === 'start_rebase') {
        const { taskId } = msg;
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
        if (!task) return send({ type: 'error', error: 'Task not found' });
        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id) as any;

        const defaultCli = getEffectiveAgentCli();
        const defaultModel = getSetting<string>('default_model', '');
        const defaultEffort = getSetting<string>('thinking_effort', 'medium');

        activeProc = runRebaseAgent(
          task.worktree_path,
          task.base_branch,
          defaultCli,
          defaultModel,
          defaultEffort,
          (ev) => {
            if (ev.type === 'done') {
              GitService.invalidateTaskStatus(task.worktree_path);
            }
            send({ type: 'rebase_event', event: ev });
          },
          project?.path,
          task.branch,
          {
            projectName: project?.name,
            taskName: task.name,
            systemPrompt: project?.system_prompt,
          }
        );
      }

      // 4. Submit agent (Commit & Push)
      else if (msg.type === 'start_submit') {
        const { taskId, commitMessage } = msg;
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
        if (!task) return send({ type: 'error', error: 'Task not found' });
        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id) as any;

        const defaultCli = getEffectiveAgentCli();
        const defaultModel = getSetting<string>('default_model', '');
        const defaultEffort = getSetting<string>('thinking_effort', 'medium');

        activeProc = runSubmitAgent(
          task.worktree_path,
          task.branch,
          commitMessage,
          defaultCli,
          defaultModel,
          defaultEffort,
          (ev) => {
            if (ev.type === 'done') {
              GitService.invalidateTaskStatus(task.worktree_path);
            }
            send({ type: 'submit_event', taskId, event: ev });
          },
          task.base_branch,
          {
            projectName: project?.name,
            taskName: task.name,
            systemPrompt: project?.system_prompt,
          }
        );
      }

      // Generate Commit Message Agent
      else if (msg.type === 'generate_commit_message') {
        const { taskId } = msg;
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
        if (!task) return send({ type: 'error', error: 'Task not found' });
        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id) as any;

        const defaultCli = msg.agentCli || getEffectiveAgentCli();
        const defaultModel = msg.model || getSetting<string>('default_model', '');
        const defaultEffort = msg.thinkingEffort || getSetting<string>('thinking_effort', 'medium');

        try {
          const result = await runCommitMessageAgent(
            task.worktree_path,
            task.name,
            task.branch,
            defaultCli,
            defaultModel,
            defaultEffort,
            (ev) => {
              send({ type: 'commit_message_event', event: ev });
            },
            {
              projectName: project?.name,
              baseBranch: task.base_branch || project?.base_branch || project?.branch_convention || 'main',
              systemPrompt: project?.system_prompt,
            }
          );
          send({ type: 'commit_message_result', result });
        } catch (err: any) {
          send({ type: 'error', error: err.message || 'Failed to generate commit message' });
        }
      }

      // 5. Chat message prompt
      else if (msg.type === 'send_chat_message') {
        const { sessionId, prompt, agentCli, model, thinkingEffort, attachments } = msg;
        const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId) as any;
        if (!session) return send({ type: 'error', error: 'Chat session not found' });
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(session.task_id) as any;
        if (!task) return send({ type: 'error', error: 'Task not found' });

        // If a previous agent run is active for this session, abort it first
        if (activeChatSessions.has(sessionId)) {
          activeChatSessions.get(sessionId)?.abort();
        }

        const cliToUse = agentCli || session.agent_cli || getEffectiveAgentCli();

        // Extract any skills or slash commands present in prompt
        const matchedSkills = extractMatchedSkills(cliToUse, prompt, task?.worktree_path);
        const metadataObj: Record<string, any> = {};
        if (Array.isArray(attachments) && attachments.length > 0) {
          metadataObj.attachments = attachments;
        }
        if (matchedSkills.length > 0) {
          metadataObj.skills = matchedSkills.map((s) => ({
            name: s.name,
            description: s.description,
            content: s.content,
          }));
        }
        const userMetadata = Object.keys(metadataObj).length > 0 ? JSON.stringify(metadataObj) : null;

        // Save user message to database
        const userMsgId = msg.messageId || uuidv4();
        const now = Date.now();

        db.prepare(`
          INSERT INTO chat_messages (id, session_id, role, content, metadata, timestamp)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(userMsgId, sessionId, 'user', prompt, userMetadata, now);

        broadcastWs({
          type: 'message_saved',
          sessionId,
          message: {
            id: userMsgId,
            session_id: sessionId,
            role: 'user',
            content: prompt,
            metadata: userMetadata,
            attachments: Array.isArray(attachments) ? attachments : [],
            timestamp: now,
          },
        });

        let modelToUse = model || session.model;
        let effortToUse = thinkingEffort || session.thinking_effort;

        // Validate and reconcile model and thinking effort against available models for cliToUse
        try {
          const availableModelsForCli = await getModelsForCli(cliToUse);
          if (Array.isArray(availableModelsForCli) && availableModelsForCli.length > 0) {
            const matched = availableModelsForCli.find((m) => m.id === modelToUse);
            if (!matched) {
              const rec =
                availableModelsForCli.find((m) => m.name.toLowerCase().includes('(recommended)')) ||
                availableModelsForCli[0];
              modelToUse = rec.id;
            }
            const finalModelObj = availableModelsForCli.find((m) => m.id === modelToUse);
            if (finalModelObj) {
              const validEfforts = finalModelObj.reasoningEfforts || ['none', 'low', 'medium', 'high', 'max'];
              if (!effortToUse || !validEfforts.map((e) => e.toLowerCase()).includes(effortToUse.toLowerCase())) {
                effortToUse = finalModelObj.defaultEffort || validEfforts[0] || 'medium';
              }
            }
          }
        } catch {}

        // Persist the effective agent, model and effort to the session in DB if changed
        if (
          session.agent_cli !== cliToUse ||
          session.model !== modelToUse ||
          session.thinking_effort !== effortToUse
        ) {
          try {
            db.prepare('UPDATE chat_sessions SET agent_cli = ?, model = ?, thinking_effort = ? WHERE id = ?')
              .run(cliToUse, modelToUse, effortToUse, sessionId);
          } catch {}
        }

        // Check if session has an existing CLI conversation/thread matching this engine
        const canResumeCliSession = Boolean(
          session.cli_session_id &&
          session.cli_session_agent &&
          session.cli_session_agent.toLowerCase() === cliToUse.toLowerCase()
        );
        const cliSessionIdToResume = canResumeCliSession ? session.cli_session_id : null;

        // Build effective prompt for AI agent including attachment workspace paths
        let effectiveAgentPrompt = prompt;
        if (Array.isArray(attachments) && attachments.length > 0) {
          const attachmentLines = attachments.map((att: any) => {
            const sizeStr = formatBytes(att.size || 0);
            return `- ${att.path} (${att.name}, ${att.type || 'file'}, ${sizeStr})`;
          });
          effectiveAgentPrompt = `${prompt}\n\n[Attached files in workspace:\n${attachmentLines.join('\n')}\nYou can inspect, read, or process these files directly in the repository workspace.]`;
        }

        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id) as any;
        const effectiveWorktreePath = project?.path
          ? GitService.ensureWorktree(
              project.path,
              task.worktree_path,
              task.branch,
              task.base_branch || project.branch_convention || 'main'
            )
          : task.worktree_path;

        if (effectiveWorktreePath && effectiveWorktreePath !== task.worktree_path) {
          try {
            db.prepare('UPDATE tasks SET worktree_path = ? WHERE id = ?').run(effectiveWorktreePath, task.id);
            task.worktree_path = effectiveWorktreePath;
          } catch {}
        }

        // Auto-inject project system prompt or rich Alpha Intelligence workspace context into first turn of chat session
        const prevUserMessages = db.prepare(`
          SELECT id FROM chat_messages
          WHERE session_id = ? AND role = 'user' AND id != ?
        `).all(sessionId, userMsgId) as Array<{ id: string }>;
        const isFirstTurn = prevUserMessages.length === 0;

        const prevAlphaMessages = db.prepare(`
          SELECT id FROM chat_messages
          WHERE session_id = ? AND role = 'assistant' AND metadata LIKE '%"cli":"alpha"%'
        `).all(sessionId) as Array<{ id: string }>;
        const isFirstAlphaTurn = isFirstTurn || prevAlphaMessages.length === 0;

        if (cliToUse === 'alpha') {
          if (isFirstAlphaTurn) {
            effectiveAgentPrompt = buildAlphaPromptWithContext(effectiveAgentPrompt, {
              projectName: project?.name,
              taskName: task?.name,
              worktreePath: effectiveWorktreePath || project?.path,
              branch: task?.branch,
              baseBranch: task?.base_branch || project?.branch_convention || 'main',
              systemPrompt: project?.system_prompt,
              isAlpha: true,
            });
          } else {
            effectiveAgentPrompt = buildAlphaPromptWithContext(effectiveAgentPrompt, {
              worktreePath: effectiveWorktreePath || project?.path,
              branch: task?.branch,
              isAlpha: true,
              isSubsequentTurn: true,
            });
          }
        } else if (isFirstTurn) {
          effectiveAgentPrompt = buildAlphaPromptWithContext(effectiveAgentPrompt, {
            projectName: project?.name,
            taskName: task?.name,
            worktreePath: effectiveWorktreePath || project?.path,
            branch: task?.branch,
            baseBranch: task?.base_branch || project?.branch_convention || 'main',
            systemPrompt: project?.system_prompt,
            isAlpha: false,
          });
        }

        let effectivePrompt = resolveSkillPrompt(cliToUse, effectiveAgentPrompt, effectiveWorktreePath);
        let promptForAgy = effectivePrompt;

        // If not resuming a native CLI session, provide conversational history fallback
        if (!canResumeCliSession) {
          const prevMessages = db.prepare(`
            SELECT role, content FROM chat_messages
            WHERE session_id = ? AND id != ?
            ORDER BY timestamp ASC
          `).all(sessionId, userMsgId) as Array<{ role: string; content: string }>;

          if (prevMessages.length > 0) {
            promptForAgy = buildConversationContextFallback(prevMessages, effectivePrompt);
            effectivePrompt = buildConversationContextFallback(prevMessages, effectivePrompt);
          }
        }

        // Construct CLI args for agent turn
        const args: string[] = [];
        if (cliToUse === 'agy') {
          if (cliSessionIdToResume) {
            args.push('--conversation', cliSessionIdToResume);
          }
          args.push('-p', promptForAgy);
          if (modelToUse) args.push('--model', modelToUse);
          const agyEffort = (effortToUse && effortToUse !== 'none') ? effortToUse : 'medium';
          args.push('--effort', agyEffort);
          args.push('--output-format', 'stream-json');
          args.push('--dangerously-skip-permissions');
        } else if (cliToUse === 'claude') {
          if (cliSessionIdToResume) {
            args.push('--resume', cliSessionIdToResume);
            args.push('-p', effectivePrompt);
          } else {
            const newClaudeId = uuidv4();
            args.push('--session-id', newClaudeId);
            args.push('-p', effectivePrompt);
            try {
              db.prepare('UPDATE chat_sessions SET cli_session_id = ?, cli_session_agent = ? WHERE id = ?')
                .run(newClaudeId, 'claude', sessionId);
            } catch {}
          }
          if (modelToUse) args.push('--model', modelToUse);
          if (effortToUse && effortToUse !== 'none') args.push('--effort', effortToUse);
          args.push('--output-format', 'stream-json');
          args.push('--verbose');
          args.push('--include-partial-messages');
          args.push('--dangerously-skip-permissions');
        } else {
          // codex
          if (cliSessionIdToResume) {
            args.push('exec', 'resume', '--json', cliSessionIdToResume, effectivePrompt);
          } else {
            args.push('exec', '--json', effectivePrompt);
          }
          if (modelToUse) args.push('--model', modelToUse);
          if (effortToUse && effortToUse !== 'none') {
            args.push('-c', `model_reasoning_effort="${effortToUse}"`);
          }
          args.push('-c', 'service_tier="fast"');
        }

        let assistantContent = '';
        const assistantMsgId = uuidv4();
        let lastDbSaveTime = 0;

        // Pre-create the assistant message in DB immediately so reload always shows it
        db.prepare(`
          INSERT INTO chat_messages (id, session_id, role, content, metadata, timestamp)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          assistantMsgId,
          sessionId,
          'assistant',
          '',
          JSON.stringify({ cli: cliToUse, model: modelToUse }),
          now + 1
        );

        setChatSessionStatus(sessionId, 'running', now);

        let assistantThoughts = '';
        let assistantResponse = '';
        const assistantSteps: AgentStep[] = [];
        let persistedCliSessionId = cliSessionIdToResume || null;

        let lastBroadcastTime = 0;
        let broadcastTimer: NodeJS.Timeout | null = null;
        let lastEventSent: StreamEvent | null = null;

        const flushBroadcast = () => {
          if (broadcastTimer) {
            clearTimeout(broadcastTimer);
            broadcastTimer = null;
          }
          lastBroadcastTime = Date.now();
          broadcastWs({
            type: 'chat_stream',
            event: lastEventSent || { type: 'chunk', content: '' },
            sessionId,
            messageId: assistantMsgId,
            fullContent: assistantContent,
            steps: assistantSteps,
          });
        };

        const queueBroadcast = (ev: StreamEvent, immediate = false) => {
          lastEventSent = ev;
          const currentNow = Date.now();
          if (immediate || currentNow - lastBroadcastTime >= 40) {
            flushBroadcast();
          } else if (!broadcastTimer) {
            const delay = Math.max(10, 40 - (currentNow - lastBroadcastTime));
            broadcastTimer = setTimeout(() => {
              flushBroadcast();
            }, delay);
          }
        };

        const compileAssistantContent = () => {
          const t = assistantThoughts.trim();
          const r = assistantResponse.trim();
          if (t && r) {
            return `<thought>\n${t}\n</thought>\n\n${r}`;
          }
          if (t) {
            return `<thought>\n${t}\n</thought>`;
          }
          return r;
        };

        const saveAssistantProgress = (force = false, isSpendCap = false) => {
          const currentNow = Date.now();
          if (force || currentNow - lastDbSaveTime > 300) {
            lastDbSaveTime = currentNow;
            try {
              const metaObj = {
                cli: cliToUse,
                model: modelToUse,
                steps: assistantSteps,
                ...(isSpendCap ? { error: true, errorType: 'spend_cap', errorMessage: assistantResponse } : {}),
              };
              db.prepare(`
                UPDATE chat_messages SET content = ?, metadata = ?, timestamp = ? WHERE id = ?
              `).run(assistantContent, JSON.stringify(metaObj), currentNow, assistantMsgId);
            } catch {}
          }
        };

        if (cliToUse === 'alpha') {
          const apiUrl = getSetting<string>('alpha_intelligence_api_url', '');
          const apiKey = getSetting<string>('alpha_intelligence_api_key', '');
          if (!apiUrl || !apiKey) {
            assistantResponse = 'Alpha Intelligence is not configured. Please set API URL and API Key in Settings > Alpha Intelligence.';
            assistantContent = compileAssistantContent();
            saveAssistantProgress(true, true);
            flushBroadcast();
            broadcastWs({
              type: 'chat_turn_complete',
              sessionId,
              messageId: assistantMsgId,
              message: {
                id: assistantMsgId,
                session_id: sessionId,
                role: 'assistant',
                content: assistantResponse,
                metadata: JSON.stringify({ cli: 'alpha', model: 'latest', steps: [] }),
                timestamp: Date.now(),
              },
              steps: [],
            });
            activeChatSessions.delete(sessionId);
            setChatSessionStatus(sessionId, 'idle', Date.now());
            return;
          }

          const abortController = new AbortController();

          const handleAlphaEvent = (ev: StreamEvent) => {
            if (ev.type === 'step' && ev.step) {
              const step = ev.step;
              const idx = assistantSteps.findIndex((s) => s.id === step.id);
              if (idx >= 0) {
                assistantSteps[idx] = { ...assistantSteps[idx], ...step };
              } else {
                assistantSteps.push(step);
              }
              saveAssistantProgress(false);
              queueBroadcast(ev, false);
            } else if (ev.type === 'thought' && ev.content) {
              assistantThoughts += ev.content;
              assistantContent = compileAssistantContent();
              saveAssistantProgress(false);
              queueBroadcast(ev, false);
            } else if (ev.type === 'chunk' && ev.content) {
              assistantResponse += ev.content;
              assistantContent = compileAssistantContent();
              saveAssistantProgress(false);
              queueBroadcast(ev, false);
            } else if (ev.type === 'error') {
              const errContent = ev.content || 'Error during execution';
              assistantResponse = errContent;
              assistantContent = compileAssistantContent();
              saveAssistantProgress(true, true);
              queueBroadcast(ev, true);
            }

            if (ev.type === 'done' || ev.type === 'error') {
              flushBroadcast();
              const finishedAt = Date.now();
              if (!assistantResponse.trim() && ev.type === 'done') {
                if (assistantThoughts.trim()) {
                  const actionCount = assistantSteps.length || (assistantThoughts.match(/→/g) || []).length;
                  assistantResponse = `Completed ${actionCount > 0 ? `${actionCount} ` : ''}workspace actions and finished tasks.`;
                } else {
                  assistantResponse = 'Task completed.';
                }
                assistantContent = compileAssistantContent();
              }

              for (const s of assistantSteps) {
                if (s.status === 'running') {
                  s.status = ev.type === 'error' ? 'failed' : 'completed';
                  s.endTime = finishedAt;
                  if (s.startTime && !s.duration) {
                    s.duration = Math.round(((finishedAt - s.startTime) / 1000) * 10) / 10;
                  }
                }
              }

              const metaObj = {
                cli: 'alpha',
                model: 'latest',
                steps: assistantSteps,
                ...(ev.type === 'error' ? {
                  error: true,
                  errorType: 'agent_error',
                  errorMessage: ev.content || 'Error during execution',
                } : {}),
              };

              try {
                db.prepare('UPDATE chat_messages SET content = ?, metadata = ?, timestamp = ? WHERE id = ?')
                  .run(assistantContent || (ev.type === 'error' ? `Error: ${ev.content}` : '(Completed)'), JSON.stringify(metaObj), finishedAt, assistantMsgId);
              } catch {}

              activeChatSessions.delete(sessionId);
              setChatSessionStatus(sessionId, 'idle', finishedAt);

              broadcastWs({
                type: 'chat_turn_complete',
                sessionId,
                taskId: task.id,
                projectId: task.project_id,
                taskName: task.name,
                projectName: project?.name,
                messageId: assistantMsgId,
                message: {
                  id: assistantMsgId,
                  session_id: sessionId,
                  role: 'assistant',
                  content: assistantContent || (ev.type === 'error' ? `Error: ${ev.content}` : '(Completed)'),
                  metadata: JSON.stringify(metaObj),
                  timestamp: finishedAt,
                },
                steps: assistantSteps,
              });
            }
          };

          const abortAlphaSession = () => {
            if (broadcastTimer) {
              clearTimeout(broadcastTimer);
              broadcastTimer = null;
            }
            abortController.abort();
            const currentNow = Date.now();
            for (const s of assistantSteps) {
              if (s.status === 'running') {
                s.status = 'failed';
                s.error = 'Canceled by user';
                s.endTime = currentNow;
              }
            }
            saveAssistantProgress(true);
            activeChatSessions.delete(sessionId);
            setChatSessionStatus(sessionId, 'idle', currentNow);
            broadcastWs({ type: 'aborted', sessionId });
          };

          activeChatSessions.set(sessionId, {
            proc: { kill: () => abortController.abort() },
            sessionId,
            assistantMsgId,
            getContent: () => assistantContent,
            abort: abortAlphaSession,
          });

          runAlphaIntelligenceTurn({
            apiUrl,
            apiKey,
            userEmail: getSetting<string>('alpha_intelligence_email', '') || undefined,
            prompt: effectivePrompt,
            conversationId: cliSessionIdToResume || undefined,
            worktreePath: effectiveWorktreePath,
            sessionId,
            messageId: assistantMsgId,
            signal: abortController.signal,
            onEvent: handleAlphaEvent,
            onHitlRequired: (hitl) => {
              broadcastWs({
                type: 'hitl_input_required',
                sessionId,
                taskId: task.id,
                projectId: task.project_id,
                taskName: task.name,
                projectName: project?.name,
                messageId: assistantMsgId,
                hitl,
              });
            },
            onConversationId: (convId) => {
              try {
                db.prepare('UPDATE chat_sessions SET cli_session_id = ?, cli_session_agent = ? WHERE id = ?')
                  .run(convId, 'alpha', sessionId);
              } catch {}
            },
          }).catch((runErr) => {
            console.error('[AlphaRunner] Execution error:', runErr);
            handleAlphaEvent({ type: 'error', content: runErr.message || 'Alpha Intelligence error' });
          });

          return;
        }

        const proc = spawnAgentCli(cliToUse, args, effectiveWorktreePath, (ev: StreamEvent) => {
          // If a conversation ID was detected from the CLI stream, persist it to chat_sessions once
          if (ev.conversationId && ev.conversationId !== persistedCliSessionId) {
            persistedCliSessionId = ev.conversationId;
            try {
              db.prepare('UPDATE chat_sessions SET cli_session_id = ?, cli_session_agent = ? WHERE id = ?')
                .run(ev.conversationId, cliToUse, sessionId);
            } catch {}
          }

          if (ev.type === 'step' && ev.step) {
            const step = ev.step;
            const idx = assistantSteps.findIndex((s) => s.id === step.id);
            if (idx >= 0) {
              assistantSteps[idx] = { ...assistantSteps[idx], ...step };
            } else {
              assistantSteps.push(step);
            }
            saveAssistantProgress(false);
            queueBroadcast(ev, false);
          } else if (ev.type === 'thought' && ev.content) {
            assistantThoughts += ev.content;
            assistantContent = compileAssistantContent();
            saveAssistantProgress(false);
            queueBroadcast(ev, false);
          } else if (ev.type === 'chunk' && ev.content) {
            if (ev.metadata?.isFinalResult) {
              assistantResponse = ev.content;
            } else {
              assistantResponse += ev.content;
            }
            assistantContent = compileAssistantContent();
            saveAssistantProgress(false);
            queueBroadcast(ev, false);
          } else if (ev.type === 'error' && ev.content) {
            const errContent = ev.content;
            const isSpendCap = ev.metadata?.isSpendCap || SPEND_CAP_REGEX.test(errContent);
            const isAuthRequired = ev.metadata?.isAuthRequired || AUTH_REQUIRED_REGEX.test(errContent);
            assistantResponse = errContent;
            assistantContent = compileAssistantContent();
            try {
              db.prepare('UPDATE chat_messages SET metadata = ? WHERE id = ?')
                .run(JSON.stringify({
                  cli: cliToUse,
                  model: modelToUse,
                  steps: assistantSteps,
                  error: true,
                  errorType: isSpendCap ? 'spend_cap' : (isAuthRequired ? 'auth_required' : 'agent_error'),
                  isSpendCap: Boolean(isSpendCap),
                  isAuthRequired: Boolean(isAuthRequired),
                  errorMessage: errContent,
                }), assistantMsgId);
            } catch {}
            saveAssistantProgress(true, isSpendCap || isAuthRequired);
            queueBroadcast(ev, true);
          } else if (ev.type === 'status' && ev.content) {
            queueBroadcast(ev, false);
          }

          if (ev.type === 'done' || ev.type === 'error') {
            flushBroadcast();
            const finishedAt = Date.now();
            const isExitError = ev.type === 'error' || (ev.metadata?.code !== undefined && ev.metadata.code !== 0);
            const isSpendCap = ev.metadata?.isSpendCap || (isExitError && SPEND_CAP_REGEX.test(assistantResponse));
            const isAuthRequired = ev.metadata?.isAuthRequired || (isExitError && AUTH_REQUIRED_REGEX.test(assistantResponse));
            const isResumeError = isExitError && /session not found|no conversation found|cannot resume session|invalid session|session does not exist|could not resume/i.test(assistantResponse);

            if (cliSessionIdToResume && ev.metadata?.code && ev.metadata.code !== 0) {
              // Preserve CLI session ID on initial auth failure so resuming works once signed in (Round 1 Decision 3B).
              // If resuming failed because the expired session no longer exists upstream, clear it for a clean retry (Round 2 Decision 1A).
              if (!isAuthRequired || isResumeError) {
                try {
                  db.prepare('UPDATE chat_sessions SET cli_session_id = NULL, cli_session_agent = NULL WHERE id = ?')
                    .run(sessionId);
                } catch {}
              }
            }

            // Mark any in-flight steps as finished
            for (const s of assistantSteps) {
              if (s.status === 'running') {
                s.status = ev.type === 'error' ? 'failed' : 'completed';
                s.endTime = finishedAt;
                if (s.startTime && !s.duration) {
                  s.duration = Math.round(((finishedAt - s.startTime) / 1000) * 10) / 10;
                }
              }
            }

            if (isSpendCap) {
              try {
                db.prepare('UPDATE chat_messages SET metadata = ? WHERE id = ?')
                  .run(JSON.stringify({
                    cli: cliToUse,
                    model: modelToUse,
                    steps: assistantSteps,
                    error: true,
                    errorType: 'spend_cap',
                    errorMessage: assistantResponse || 'You hit your spend cap set by the owner of your workspace. Ask an owner to increase your spend cap to continue.',
                  }), assistantMsgId);
              } catch {}
            } else if (isAuthRequired) {
              try {
                db.prepare('UPDATE chat_messages SET metadata = ? WHERE id = ?')
                  .run(JSON.stringify({
                    cli: cliToUse,
                    model: modelToUse,
                    steps: assistantSteps,
                    error: true,
                    errorType: 'auth_required',
                    isAuthRequired: true,
                    errorMessage: assistantResponse || 'Authentication required. Please sign in to continue using this agent.',
                  }), assistantMsgId);
              } catch {}
            } else if (!assistantResponse.trim() && ev.type === 'done') {
              if (assistantThoughts.trim()) {
                const actionCount = assistantSteps.length || (assistantThoughts.match(/→/g) || []).length;
                assistantResponse = `Completed ${actionCount > 0 ? `${actionCount} ` : ''}workspace actions and finished tasks.`;
              } else {
                assistantResponse = 'Task completed.';
              }
              assistantContent = compileAssistantContent();
            }

            const metaObj = {
              cli: cliToUse,
              model: modelToUse,
              steps: assistantSteps,
              ...(isSpendCap ? {
                error: true,
                errorType: 'spend_cap',
                errorMessage: assistantResponse || 'You hit your spend cap set by the owner of your workspace. Ask an owner to increase your spend cap to continue.',
              } : isAuthRequired ? {
                error: true,
                errorType: 'auth_required',
                isAuthRequired: true,
                errorMessage: assistantResponse || 'Authentication required. Please sign in to continue using this agent.',
              } : (ev.type === 'error' ? {
                error: true,
                errorType: 'agent_error',
                errorMessage: ev.content || 'Error during execution',
              } : {})),
            };

            try {
              db.prepare('UPDATE chat_messages SET content = ?, metadata = ?, timestamp = ? WHERE id = ?')
                .run(assistantContent || (ev.type === 'error' ? `Error: ${ev.content}` : '(Completed)'), JSON.stringify(metaObj), finishedAt, assistantMsgId);
            } catch {}

            activeChatSessions.delete(sessionId);
            setChatSessionStatus(sessionId, 'idle', finishedAt);

            broadcastWs({
              type: 'chat_turn_complete',
              sessionId,
              taskId: task.id,
              projectId: task.project_id,
              taskName: task.name,
              projectName: project?.name,
              message: {
                id: assistantMsgId,
                session_id: sessionId,
                role: 'assistant',
                content: assistantContent || (ev.type === 'error' ? `Error: ${ev.content}` : '(Completed)'),
                metadata: JSON.stringify(metaObj),
                timestamp: finishedAt,
              },
              steps: assistantSteps,
            });
          }
        });

        const abortSession = () => {
          if (broadcastTimer) {
            clearTimeout(broadcastTimer);
            broadcastTimer = null;
          }
          try {
            proc.kill('SIGINT');
          } catch {}
          const currentNow = Date.now();
          for (const s of assistantSteps) {
            if (s.status === 'running') {
              s.status = 'failed';
              s.error = 'Canceled by user';
              s.endTime = currentNow;
            }
          }
          saveAssistantProgress(true);
          activeChatSessions.delete(sessionId);
          setChatSessionStatus(sessionId, 'idle', currentNow);
          broadcastWs({ type: 'aborted', sessionId });
        };

        activeChatSessions.set(sessionId, {
          proc,
          sessionId,
          assistantMsgId,
          getContent: () => assistantContent,
          abort: abortSession,
        });
      }

      // 6. Abort current process
      else if (msg.type === 'abort') {
        const targetSessionId = msg.sessionId;
        if (targetSessionId && activeChatSessions.has(targetSessionId)) {
          activeChatSessions.get(targetSessionId)?.abort();
        } else if (activeChatSessions.size > 0) {
          for (const session of activeChatSessions.values()) {
            session.abort();
          }
        }
        if (activeProc) {
          try {
            activeProc.kill('SIGINT');
          } catch {}
          send({ type: 'aborted' });
        }
      }

      // 7. Install CLI via WebSocket
      else if (msg.type === 'install_cli') {
        const cliToInstall = (msg.cli || '').toLowerCase();
        send({ type: 'install_cli_start', cli: cliToInstall });
        try {
          const { proc, promise } = installCliProcess(cliToInstall, (chunk) => {
            send({ type: 'install_cli_log', cli: cliToInstall, chunk });
          });
          promise.then(({ code }) => {
            send({
              type: 'install_cli_done',
              cli: cliToInstall,
              code,
              success: code === 0,
              availableClis: getAvailableClis(),
            });
          });
        } catch (err: any) {
          send({
            type: 'install_cli_done',
            cli: cliToInstall,
            code: 1,
            success: false,
            error: err.message,
          });
        }
      }
    } catch (err: any) {
      send({ type: 'error', error: err.message });
    }
  });

  ws.on('close', () => {
    cleanupDevServerListeners();
    if (activeProc) {
      try {
        activeProc.kill('SIGTERM');
      } catch {}
    }
  });
});

// ===================== CLIENT SPA SERVING & DEEP LINK FALLBACK =====================
const candidateDistDirs = [
  path.resolve(process.cwd(), 'client/dist'),
  path.resolve(process.cwd(), '../client/dist'),
  path.resolve(__dirname, 'client/dist'),
  path.resolve(__dirname, '../client/dist'),
];
const clientDistDir = candidateDistDirs.find((dir) => fs.existsSync(dir));

if (clientDistDir) {
  app.use(express.static(clientDistDir));
  app.get('*', (req: Request, res: Response, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(path.join(clientDistDir, 'index.html'));
  });
}

export { app, server };

const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  process.execArgv.includes('--test') ||
  process.argv.some((arg) => arg.includes('test'));

if (!isTestEnv) {
  const listenHost = isTailscale ? '0.0.0.0' : HOST;
  server.listen(PORT, listenHost, () => {
    const networkType = isTailscale ? 'Tailscale network' : 'local interface';
    console.log(`[raft-server] listening on http://${HOST}:${PORT} (${networkType}, source: ${hostSource})`);
    if (isTailscale) {
      console.log(`[raft-server] also accessible locally at http://localhost:${PORT}`);

      const enableServe = process.env.RAFT_TAILSCALE_SERVE !== '0' && process.env.RAFT_TAILSCALE_SERVE !== 'false';
      if (enableServe) {
        const envPort = process.env.RAFT_TAILSCALE_PORT ? parseInt(process.env.RAFT_TAILSCALE_PORT, 10) : undefined;
        // In dev mode, client runs on port 3300; in production, server serves client on PORT (3300)
        const targetPort = envPort || (isDev ? 3300 : PORT);
        tailscaleServeInfo = setupTailscaleServe(targetPort);
        if (tailscaleServeInfo.enabled && tailscaleServeInfo.httpsUrl) {
          console.log(`[raft-server] 🔒 Tailscale HTTPS active: ${tailscaleServeInfo.httpsUrl} -> http://127.0.0.1:${targetPort}`);
          console.log(`[raft-server] 🔒 Secure context active (screen capture, clipboard, and PWA enabled)`);
        } else if (tailscaleServeInfo.error) {
          console.warn(`[raft-server] Tailscale Serve could not be enabled: ${tailscaleServeInfo.error}`);
        }
      }
    }

    // Initialize Alpha Intelligence device connection if configured
    const initAlphaUrl = getSetting<string>('alpha_intelligence_api_url', '');
    if (initAlphaUrl) {
      alphaDeviceService.updateBaseUrlFromApiUrl(initAlphaUrl);
    }
  });
}

