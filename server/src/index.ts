import http from 'node:http';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { db, getSetting, setSetting } from './db.js';
import { GitService } from './gitService.js';
import {
  getAvailableClis,
  getModelsForCli,
  installCliProcess,
  runCommitMessageAgent,
  runDiscoveryAgent,
  runRebaseAgent,
  runSubmitAgent,
  spawnAgentCli,
  CommitMessageResult,
  StreamEvent,
} from './agentRunner.js';
import { devServerManager } from './devServerManager.js';
import { scriptManager } from './scriptManager.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3100;
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

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
  res.json({ agent_cli, default_model, thinking_effort, theme });
});

app.put('/api/settings', (req: Request, res: Response) => {
  const { agent_cli, default_model, thinking_effort, theme } = req.body;
  if (agent_cli !== undefined) setSetting('agent_cli', agent_cli);
  if (default_model !== undefined) setSetting('default_model', default_model);
  if (thinking_effort !== undefined) setSetting('thinking_effort', thinking_effort);
  if (theme !== undefined) setSetting('theme', theme);
  res.json({ success: true });
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
    sendEvent({ type: 'output', chunk: `\n[termai error] ${err.message}\n` });
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

function formatProject(p: any) {
  if (!p) return null;
  return {
    ...p,
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
  const { path: rawPath, name: customName, dev_cmd, dev_port, build_cmd, test_cmd, branch_convention, custom_scripts } = req.body;
  const projectPath = path.resolve(rawPath);
  const repoInfo = GitService.getRepoInfo(projectPath);
  if (!repoInfo.isRepo) {
    return res.status(400).json({ error: 'Specified path is not a valid git repository' });
  }

  const id = uuidv4();
  const name = customName || path.basename(projectPath);
  const now = Date.now();

  try {
    const stmt = db.prepare(`
      INSERT INTO projects (
        id, name, path, dev_cmd, dev_port, build_cmd, test_cmd, branch_convention,
        default_agent_cli, default_model, custom_scripts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      name,
      projectPath,
      dev_cmd || 'npm run dev',
      dev_port || 5173,
      build_cmd || 'npm run build',
      test_cmd || 'npm test',
      branch_convention || repoInfo.currentBranch || 'main',
      getEffectiveAgentCli(),
      getSetting('default_model', ''),
      custom_scripts ? JSON.stringify(custom_scripts) : '[]',
      now,
      now
    );

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.json(formatProject(project));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    branch_convention,
    default_agent_cli,
    default_model,
    custom_scripts,
  } = req.body;
  const now = Date.now();

  const parsedPort =
    dev_port !== undefined && dev_port !== null && dev_port !== ''
      ? parseInt(String(dev_port), 10)
      : null;

  db.prepare(`
    UPDATE projects SET
      name = coalesce(?, name),
      dev_cmd = coalesce(?, dev_cmd),
      dev_port = coalesce(?, dev_port),
      build_cmd = coalesce(?, build_cmd),
      test_cmd = coalesce(?, test_cmd),
      branch_convention = coalesce(?, branch_convention),
      default_agent_cli = coalesce(?, default_agent_cli),
      default_model = coalesce(?, default_model),
      custom_scripts = coalesce(?, custom_scripts),
      updated_at = ?
    WHERE id = ?
  `).run(
    name !== undefined ? name : null,
    dev_cmd !== undefined ? dev_cmd : null,
    parsedPort !== null && !isNaN(parsedPort) ? parsedPort : null,
    build_cmd !== undefined ? build_cmd : null,
    test_cmd !== undefined ? test_cmd : null,
    branch_convention !== undefined ? branch_convention : null,
    default_agent_cli !== undefined ? default_agent_cli : null,
    default_model !== undefined ? default_model : null,
    custom_scripts !== undefined ? JSON.stringify(custom_scripts) : null,
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
  const worktreePath = task.worktree_path || project?.path;

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
  const tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC').all(req.params.projectId);
  res.json(tasks);
});

app.post('/api/projects/:projectId/tasks', (req: Request, res: Response) => {
  const { name, baseBranch } = req.body;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId) as any;
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const { worktreePath, branch } = GitService.createWorktree(project.path, name, baseBranch || project.branch_convention || 'main');
    const id = uuidv4();
    const now = Date.now();

    db.prepare(`
      INSERT INTO tasks (id, project_id, name, branch, base_branch, worktree_path, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, project.id, name, branch, baseBranch || 'main', worktreePath, 'active', now, now);

    // Create default initial chat session tab
    const chatSessionId = uuidv4();
    const defaultCli = getEffectiveAgentCli();
    const defaultModel = getSetting('default_model', '');
    const defaultEffort = getSetting('thinking_effort', 'medium');

    db.prepare(`
      INSERT INTO chat_sessions (id, task_id, title, agent_cli, model, thinking_effort, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(chatSessionId, id, 'Chat 1', defaultCli, defaultModel, defaultEffort, 'idle', now, now);

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

  const { status, name, base_branch, baseBranch } = req.body;
  const targetBaseBranch = base_branch !== undefined ? base_branch : baseBranch;

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
      updated_at = ?
    WHERE id = ?
  `).run(status ?? null, trimmedName, targetBaseBranch ?? null, now, req.params.id);
  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  const project = updated ? db.prepare('SELECT * FROM projects WHERE id = ?').get(updated.project_id) : undefined;
  res.json({ ...updated, project });
});

// Git status & diff for task
app.get('/api/tasks/:id/git/status', (req: Request, res: Response) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const status = GitService.getGitStatus(task.worktree_path, task.branch, task.base_branch);
  res.json(status);
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
    const result = await runCommitMessageAgent(
      task.worktree_path,
      task.name,
      task.branch,
      defaultCli,
      defaultModel,
      defaultEffort
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate commit message' });
  }
});

// Dev Server Control
app.get('/api/tasks/:id/dev-server', (req: Request, res: Response) => {
  const taskId = req.params.id as string;
  const state = devServerManager.getServerState(taskId);
  res.json(state);
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
  devServerManager.stopServer(taskId);
  res.json({ success: true });
});

app.post('/api/tasks/:id/dev-server/restart', (req: Request, res: Response) => {
  const taskId = req.params.id as string;
  const state = devServerManager.restartServer(taskId);
  res.json(state);
});

// Chat sessions & messages
app.get('/api/tasks/:taskId/chats', (req: Request, res: Response) => {
  const chats = db.prepare('SELECT * FROM chat_sessions WHERE task_id = ? ORDER BY created_at ASC').all(req.params.taskId);
  res.json(chats);
});

app.post('/api/tasks/:taskId/chats', (req: Request, res: Response) => {
  const { title, agent_cli, model, thinking_effort } = req.body;
  const id = uuidv4();
  const now = Date.now();
  const cli = agent_cli || getEffectiveAgentCli();
  const mod = model || getSetting('default_model', '');
  const effort = thinking_effort || getSetting('thinking_effort', 'medium');

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

app.patch('/api/chats/:id', (req: Request, res: Response) => {
  const chatId = req.params.id as string;
  const { title, agent_cli, model, thinking_effort } = req.body;
  const existing = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(chatId) as any;
  if (!existing) {
    return res.status(404).json({ error: 'Chat session not found' });
  }

  const newTitle = typeof title === 'string' && title.trim().length > 0 ? title.trim() : existing.title;
  const newCli = agent_cli !== undefined ? agent_cli : existing.agent_cli;
  const newModel = model !== undefined ? model : existing.model;
  const newEffort = thinking_effort !== undefined ? thinking_effort : existing.thinking_effort;
  const now = Date.now();

  db.prepare(`
    UPDATE chat_sessions
    SET title = ?, agent_cli = ?, model = ?, thinking_effort = ?, updated_at = ?
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

app.get('/api/chats/:id/messages', (req: Request, res: Response) => {
  const chatId = req.params.id as string;
  const messages = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC').all(chatId) as any[];

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

  res.json(messages);
});

// ===================== WEBSOCKETS =====================

wss.on('connection', (ws: WebSocket) => {
  let activeProc: any = null;
  let devLogListener: ((log: string) => void) | null = null;
  let devStateListener: ((state: any) => void) | null = null;
  let currentTaskId: string | null = null;

  const send = (data: any) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  };

  ws.on('message', async (raw: string) => {
    try {
      const msg = JSON.parse(raw.toString());

      // 1. Discovery session
      if (msg.type === 'start_discovery') {
        const { projectPath, agentCli, model, thinkingEffort } = msg;
        const cli = agentCli || getEffectiveAgentCli();
        const modelToUse = model || getSetting<string>('default_model', '');
        const effortToUse = thinkingEffort || getSetting<string>('thinking_effort', 'medium');
        send({ type: 'status', text: `Scanning repository at ${projectPath}...` });

        try {
          const result = await runDiscoveryAgent(projectPath, cli, modelToUse, effortToUse, (ev) => {
            send({ type: 'discovery_event', event: ev });
          });
          send({ type: 'discovery_done', result });
        } catch (err: any) {
          send({ type: 'error', error: err.message });
        }
      }

      // 2. Dev server stream subscribe
      else if (msg.type === 'subscribe_dev_server') {
        const { taskId } = msg;
        currentTaskId = taskId;
        const state = devServerManager.getServerState(taskId);
        send({ type: 'dev_server_state', state });

        // Send existing logs
        for (const log of state.logs) {
          send({ type: 'dev_server_log', log });
        }

        devLogListener = (log: string) => {
          send({ type: 'dev_server_log', log });
        };
        devStateListener = (updatedState: any) => {
          send({ type: 'dev_server_state', state: updatedState });
        };

        devServerManager.on(`log:${taskId}`, devLogListener);
        devServerManager.on(`state:${taskId}`, devStateListener);
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
            send({ type: 'rebase_event', event: ev });
          },
          project?.path,
          task.branch
        );
      }

      // 4. Submit agent (Commit & Push)
      else if (msg.type === 'start_submit') {
        const { taskId, commitMessage } = msg;
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
        if (!task) return send({ type: 'error', error: 'Task not found' });

        const defaultCli = getEffectiveAgentCli();
        const defaultModel = getSetting<string>('default_model', '');
        const defaultEffort = getSetting<string>('thinking_effort', 'medium');

        activeProc = runSubmitAgent(task.worktree_path, task.branch, commitMessage, defaultCli, defaultModel, defaultEffort, (ev) => {
          send({ type: 'submit_event', event: ev });
        });
      }

      // Generate Commit Message Agent
      else if (msg.type === 'generate_commit_message') {
        const { taskId } = msg;
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
        if (!task) return send({ type: 'error', error: 'Task not found' });

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
            }
          );
          send({ type: 'commit_message_result', result });
        } catch (err: any) {
          send({ type: 'error', error: err.message || 'Failed to generate commit message' });
        }
      }

      // 5. Chat message prompt
      else if (msg.type === 'send_chat_message') {
        const { sessionId, prompt, agentCli, model, thinkingEffort } = msg;
        const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId) as any;
        if (!session) return send({ type: 'error', error: 'Chat session not found' });
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(session.task_id) as any;
        if (!task) return send({ type: 'error', error: 'Task not found' });

        // If a previous agent run is active for this session, abort it first
        if (activeChatSessions.has(sessionId)) {
          activeChatSessions.get(sessionId)?.abort();
        }

        // Save user message to database
        const userMsgId = msg.messageId || uuidv4();
        const now = Date.now();
        db.prepare(`
          INSERT INTO chat_messages (id, session_id, role, content, metadata, timestamp)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(userMsgId, sessionId, 'user', prompt, null, now);

        broadcastWs({
          type: 'message_saved',
          sessionId,
          message: {
            id: userMsgId,
            session_id: sessionId,
            role: 'user',
            content: prompt,
            timestamp: now,
          },
        });

        const cliToUse = agentCli || session.agent_cli || getEffectiveAgentCli();
        const modelToUse = model || session.model;
        const effortToUse = thinkingEffort || session.thinking_effort;

        // Construct CLI args for agent turn
        const args: string[] = [];
        if (cliToUse === 'agy') {
          args.push('-p', prompt);
          if (modelToUse) args.push('--model', modelToUse);
          const agyEffort = (effortToUse && effortToUse !== 'none') ? effortToUse : 'medium';
          args.push('--effort', agyEffort);
          args.push('--output-format', 'stream-json');
          args.push('--dangerously-skip-permissions');
        } else if (cliToUse === 'claude') {
          args.push('-p', prompt);
          if (modelToUse) args.push('--model', modelToUse);
          if (effortToUse && effortToUse !== 'none') args.push('--effort', effortToUse);
          args.push('--dangerously-skip-permissions');
        } else {
          // codex
          args.push('exec', prompt);
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

        db.prepare('UPDATE chat_sessions SET status = ?, updated_at = ? WHERE id = ?').run('running', now, sessionId);

        let assistantThoughts = '';
        let assistantResponse = '';

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

        const saveAssistantProgress = (force = false) => {
          const currentNow = Date.now();
          if (force || currentNow - lastDbSaveTime > 300) {
            lastDbSaveTime = currentNow;
            try {
              db.prepare(`
                UPDATE chat_messages SET content = ?, timestamp = ? WHERE id = ?
              `).run(assistantContent, currentNow, assistantMsgId);
            } catch {}
          }
        };

        const proc = spawnAgentCli(cliToUse, args, task.worktree_path, (ev: StreamEvent) => {
          if (ev.type === 'thought' && ev.content) {
            assistantThoughts += ev.content;
            assistantContent = compileAssistantContent();
            saveAssistantProgress(false);
          } else if (ev.type === 'chunk' && ev.content) {
            if (ev.metadata?.isFinalResult) {
              assistantResponse = ev.content;
            } else {
              assistantResponse += ev.content;
            }
            assistantContent = compileAssistantContent();
            saveAssistantProgress(false);
          }

          broadcastWs({
            type: 'chat_stream',
            event: ev,
            sessionId,
            messageId: assistantMsgId,
            fullContent: assistantContent,
          });

          if (ev.type === 'done' || ev.type === 'error') {
            const finishedAt = Date.now();
            if (!assistantResponse.trim() && ev.type === 'done') {
              if (assistantThoughts.trim()) {
                const actionCount = (assistantThoughts.match(/→/g) || []).length;
                assistantResponse = `Completed ${actionCount > 0 ? `${actionCount} ` : ''}workspace actions and finished tasks.`;
              } else {
                assistantResponse = 'Task completed.';
              }
              assistantContent = compileAssistantContent();
            }

            saveAssistantProgress(true);
            activeChatSessions.delete(sessionId);

            db.prepare('UPDATE chat_sessions SET status = ?, updated_at = ? WHERE id = ?').run('idle', finishedAt, sessionId);

            broadcastWs({
              type: 'chat_turn_complete',
              sessionId,
              message: {
                id: assistantMsgId,
                session_id: sessionId,
                role: 'assistant',
                content: assistantContent || (ev.type === 'error' ? `Error: ${ev.content}` : '(Completed)'),
                timestamp: finishedAt,
              },
            });
          }
        });

        const abortSession = () => {
          try {
            proc.kill('SIGINT');
          } catch {}
          saveAssistantProgress(true);
          activeChatSessions.delete(sessionId);
          db.prepare('UPDATE chat_sessions SET status = ?, updated_at = ? WHERE id = ?').run('idle', Date.now(), sessionId);
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
    if (devLogListener && currentTaskId) {
      devServerManager.off(`log:${currentTaskId}`, devLogListener);
    }
    if (devStateListener && currentTaskId) {
      devServerManager.off(`state:${currentTaskId}`, devStateListener);
    }
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

server.listen(PORT, () => {
  console.log(`[termai-server] listening on http://localhost:${PORT}`);
});

