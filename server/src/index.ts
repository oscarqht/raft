import http from 'node:http';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import fs from 'node:fs';

import { db, getSetting, setSetting } from './db.js';
import { GitService } from './gitService.js';
import {
  getAvailableClis,
  getModelsForCli,
  runDiscoveryAgent,
  runRebaseAgent,
  runSubmitAgent,
  spawnAgentCli,
  StreamEvent,
} from './agentRunner.js';
import { devServerManager } from './devServerManager.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3100;
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ===================== REST APIs =====================

// Settings
app.get('/api/settings', (_req: Request, res: Response) => {
  const agent_cli = getSetting('agent_cli', 'agy');
  const default_model = getSetting('default_model', 'gemini-2.5-pro');
  const thinking_effort = getSetting('thinking_effort', 'medium');
  const theme = getSetting('theme', 'dark');
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

app.get('/api/models', (req: Request, res: Response) => {
  const cli = (req.query.cli as string) || getSetting('agent_cli', 'agy');
  res.json(getModelsForCli(cli));
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

// Projects
app.get('/api/projects', (_req: Request, res: Response) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as any[];
  // Augment with active tasks count
  const taskCountStmt = db.prepare('SELECT count(*) as count FROM tasks WHERE project_id = ?');
  const result = projects.map((p) => {
    const { count } = taskCountStmt.get(p.id) as { count: number };
    return { ...p, task_count: count };
  });
  res.json(result);
});

app.post('/api/projects', (req: Request, res: Response) => {
  const { path: rawPath, name: customName, dev_cmd, dev_port, build_cmd, test_cmd, branch_convention } = req.body;
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
        default_agent_cli, default_model, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      getSetting('agent_cli', 'agy'),
      getSetting('default_model', ''),
      now,
      now
    );

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id', (req: Request, res: Response) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

app.put('/api/projects/:id', (req: Request, res: Response) => {
  const { name, dev_cmd, dev_port, build_cmd, test_cmd, branch_convention } = req.body;
  const now = Date.now();
  db.prepare(`
    UPDATE projects SET
      name = coalesce(?, name),
      dev_cmd = coalesce(?, dev_cmd),
      dev_port = coalesce(?, dev_port),
      build_cmd = coalesce(?, build_cmd),
      test_cmd = coalesce(?, test_cmd),
      branch_convention = coalesce(?, branch_convention),
      updated_at = ?
    WHERE id = ?
  `).run(name, dev_cmd, dev_port, build_cmd, test_cmd, branch_convention, now, req.params.id);

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json(updated);
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
    const defaultCli = getSetting('agent_cli', 'agy');
    const defaultModel = getSetting('default_model', 'gemini-2.5-pro');
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
  res.json({ ...task, project });
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
  const { status, name } = req.body;
  const now = Date.now();
  db.prepare(`
    UPDATE tasks SET
      status = coalesce(?, status),
      name = coalesce(?, name),
      updated_at = ?
    WHERE id = ?
  `).run(status, name, now, req.params.id);
  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// Git status & diff for task
app.get('/api/tasks/:id/git/status', (req: Request, res: Response) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const status = GitService.getGitStatus(task.worktree_path);
  res.json(status);
});

app.get('/api/tasks/:id/git/diff', (req: Request, res: Response) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const diff = GitService.getGitDiff(task.worktree_path);
  res.json({ diff });
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
  const cli = agent_cli || getSetting('agent_cli', 'agy');
  const mod = model || getSetting('default_model', 'gemini-2.5-pro');
  const effort = thinking_effort || getSetting('thinking_effort', 'medium');

  db.prepare(`
    INSERT INTO chat_sessions (id, task_id, title, agent_cli, model, thinking_effort, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.taskId, title || 'New Chat', cli, mod, effort, 'idle', now, now);

  const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);
  res.json(session);
});

app.delete('/api/chats/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/chats/:id/messages', (req: Request, res: Response) => {
  const messages = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC').all(req.params.id);
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
        const { projectPath, agentCli, model } = msg;
        const cli = agentCli || getSetting('agent_cli', 'agy');
        send({ type: 'status', text: `Scanning repository at ${projectPath}...` });

        try {
          const result = await runDiscoveryAgent(projectPath, cli, model, (ev) => {
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

      // 3. Rebase agent
      else if (msg.type === 'start_rebase') {
        const { taskId } = msg;
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
        if (!task) return send({ type: 'error', error: 'Task not found' });

        const defaultCli = getSetting('agent_cli', 'agy');
        const defaultModel = getSetting('default_model', '');

        activeProc = runRebaseAgent(task.worktree_path, task.base_branch, defaultCli, defaultModel, (ev) => {
          send({ type: 'rebase_event', event: ev });
        });
      }

      // 4. Submit agent (Commit & Push)
      else if (msg.type === 'start_submit') {
        const { taskId, commitMessage } = msg;
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
        if (!task) return send({ type: 'error', error: 'Task not found' });

        const defaultCli = getSetting('agent_cli', 'agy');
        const defaultModel = getSetting('default_model', '');

        activeProc = runSubmitAgent(task.worktree_path, task.branch, commitMessage, defaultCli, defaultModel, (ev) => {
          send({ type: 'submit_event', event: ev });
        });
      }

      // 5. Chat message prompt
      else if (msg.type === 'send_chat_message') {
        const { sessionId, prompt, agentCli, model, thinkingEffort } = msg;
        const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId) as any;
        if (!session) return send({ type: 'error', error: 'Chat session not found' });
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(session.task_id) as any;
        if (!task) return send({ type: 'error', error: 'Task not found' });

        // Save user message to database
        const userMsgId = uuidv4();
        const now = Date.now();
        db.prepare(`
          INSERT INTO chat_messages (id, session_id, role, content, metadata, timestamp)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(userMsgId, sessionId, 'user', prompt, null, now);

        send({ type: 'message_saved', message: { id: userMsgId, role: 'user', content: prompt, timestamp: now } });

        const cliToUse = agentCli || session.agent_cli || getSetting('agent_cli', 'agy');
        const modelToUse = model || session.model;
        const effortToUse = thinkingEffort || session.thinking_effort;

        // Construct CLI args for agent turn
        const args: string[] = [];
        if (cliToUse === 'agy') {
          args.push('-p', prompt);
          if (modelToUse) args.push('--model', modelToUse);
          if (effortToUse && effortToUse !== 'none') args.push('--effort', effortToUse);
          args.push('--dangerously-skip-permissions');
        } else if (cliToUse === 'claude') {
          args.push('-p', prompt);
          if (modelToUse) args.push('--model', modelToUse);
          args.push('--dangerously-skip-permissions');
        } else {
          // codex
          args.push('exec', prompt);
          if (modelToUse) args.push('--model', modelToUse);
        }

        let assistantContent = '';
        const assistantMsgId = uuidv4();

        db.prepare('UPDATE chat_sessions SET status = ?, updated_at = ? WHERE id = ?').run('running', now, sessionId);

        activeProc = spawnAgentCli(cliToUse, args, task.worktree_path, (ev: StreamEvent) => {
          send({ type: 'chat_stream', event: ev, sessionId, messageId: assistantMsgId });
          if (ev.content && (ev.type === 'chunk' || ev.type === 'thought')) {
            assistantContent += ev.content;
          }
          if (ev.type === 'done' || ev.type === 'error') {
            const finishedAt = Date.now();
            db.prepare(`
              INSERT INTO chat_messages (id, session_id, role, content, metadata, timestamp)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(assistantMsgId, sessionId, 'assistant', assistantContent || '(No response text)', JSON.stringify({ cli: cliToUse, model: modelToUse }), finishedAt);

            db.prepare('UPDATE chat_sessions SET status = ?, updated_at = ? WHERE id = ?').run('idle', finishedAt, sessionId);

            send({
              type: 'chat_turn_complete',
              sessionId,
              message: {
                id: assistantMsgId,
                role: 'assistant',
                content: assistantContent || '(Done)',
                timestamp: finishedAt,
              },
            });
          }
        });
      }

      // 6. Abort current process
      else if (msg.type === 'abort') {
        if (activeProc) {
          try {
            activeProc.kill('SIGINT');
          } catch {}
          send({ type: 'aborted' });
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

server.listen(PORT, () => {
  console.log(`[termai-server] listening on http://localhost:${PORT}`);
});
