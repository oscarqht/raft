import {
  Project,
  Task,
  ChatSession,
  ChatMessage,
  Settings,
  CliInfo,
  ModelOption,
  DevServerState,
  GitStatus,
  FSResponse,
  ProjectCustomScript,
  ScriptExecutionItem,
  AgentSkill,
  GitAccount,
  RemoteRepoItem,
  VerifyGitAccountResult,
} from './types';

const API_BASE = '/api';

export async function getFileSystem(dirPath?: string): Promise<FSResponse> {
  const url = dirPath ? `${API_BASE}/fs?path=${encodeURIComponent(dirPath)}` : `${API_BASE}/fs`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to read directory');
  }
  return data;
}

export async function createFolder(parentPath: string, name: string): Promise<{ path: string; name: string }> {
  const res = await fetch(`${API_BASE}/fs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: parentPath, name }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to create folder');
  }
  return data;
}

export async function initGitRepository(dirPath: string): Promise<any> {
  const res = await fetch(`${API_BASE}/projects/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dirPath }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to initialize git repository');
  }
  return data;
}


export async function getSettings(): Promise<Settings> {
  const res = await fetch(`${API_BASE}/settings`);
  return res.json();
}

export async function updateSettings(settings: Partial<Settings>): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return res.json();
}

export async function getClis(): Promise<CliInfo[]> {
  const res = await fetch(`${API_BASE}/clis`);
  return res.json();
}

export async function getModels(cli?: string, refresh?: boolean): Promise<ModelOption[]> {
  const params = new URLSearchParams();
  if (cli) params.set('cli', cli);
  if (refresh) params.set('refresh', 'true');
  const url = `${API_BASE}/models?${params.toString()}`;
  const res = await fetch(url);
  return res.json();
}

export async function getSkills(cli?: string, worktreePath?: string, taskId?: string): Promise<AgentSkill[]> {
  const params = new URLSearchParams();
  if (cli) params.set('cli', cli);
  if (worktreePath) params.set('worktreePath', worktreePath);
  if (taskId) params.set('taskId', taskId);
  const url = `${API_BASE}/skills?${params.toString()}`;
  const res = await fetch(url);
  return res.json();
}

export async function validateProjectPath(dirPath: string): Promise<any> {
  const res = await fetch(`${API_BASE}/projects/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dirPath }),
  });
  return res.json();
}

export async function getProjects(): Promise<Project[]> {
  const res = await fetch(`${API_BASE}/projects`);
  return res.json();
}

export async function createProject(data: Partial<Project>): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create project');
  }
  return res.json();
}

export async function updateProject(id: string, data: Partial<Project>): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to update project');
  }
  return res.json();
}

export async function deleteProject(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/projects/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function getProject(id: string): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects/${id}`);
  return res.json();
}

export async function getProjectTasks(projectId: string): Promise<Task[]> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/tasks`);
  return res.json();
}

export async function createTask(projectId: string, name: string, baseBranch: string): Promise<Task> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, baseBranch }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create task');
  }
  return res.json();
}

export async function getTasks(): Promise<Task[]> {
  const res = await fetch(`${API_BASE}/tasks`);
  if (!res.ok) {
    throw new Error('Failed to fetch tasks');
  }
  return res.json();
}

export async function getTask(id: string): Promise<Task> {
  const res = await fetch(`${API_BASE}/tasks/${id}`);
  return res.json();
}

export async function deleteTask(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function updateTask(id: string, data: Partial<Task>): Promise<Task> {
  const res = await fetch(`${API_BASE}/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function getTaskGitStatus(taskId: string): Promise<GitStatus> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/git/status`);
  return res.json();
}

export async function getTaskGitDiff(taskId: string): Promise<{ diff: string }> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/git/diff`);
  return res.json();
}

export interface CommitMessageResult {
  title: string;
  details?: string;
  isLargeChange: boolean;
  fullMessage: string;
}

export async function generateTaskCommitMessage(taskId: string): Promise<CommitMessageResult> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/git/commit-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to generate commit message');
  }
  return data;
}

export async function getDevServerState(taskId: string): Promise<DevServerState> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/dev-server`);
  return res.json();
}

export async function startDevServer(taskId: string): Promise<DevServerState> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/dev-server/start`, { method: 'POST' });
  return res.json();
}

export async function stopDevServer(taskId: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/dev-server/stop`, { method: 'POST' });
  return res.json();
}

export async function restartDevServer(taskId: string): Promise<DevServerState> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/dev-server/restart`, { method: 'POST' });
  return res.json();
}

export async function getTaskChats(taskId: string): Promise<ChatSession[]> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/chats`);
  return res.json();
}

export async function createChatSession(taskId: string, title?: string, agent_cli?: string, model?: string, thinking_effort?: string): Promise<ChatSession> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, agent_cli, model, thinking_effort }),
  });
  return res.json();
}

export async function updateChatSession(id: string, data: Partial<ChatSession>): Promise<ChatSession> {
  const res = await fetch(`${API_BASE}/chats/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to update chat session');
  }
  return res.json();
}

export async function deleteChatSession(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/chats/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function getChatMessages(sessionId: string): Promise<ChatMessage[]> {
  const res = await fetch(`${API_BASE}/chats/${sessionId}/messages`);
  return res.json();
}

// WebSocket client connection helper
export function createWebSocketConnection(onMessage: (msg: any) => void): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  const ws = new WebSocket(wsUrl);
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch {
      // ignore
    }
  };
  return ws;
}

// Stream terminal installer for missing CLI via Server-Sent Events
export function installCliStream(
  cli: string,
  onLog: (chunk: string) => void,
  onDone: (success: boolean, availableClis?: CliInfo[]) => void,
  onError?: (err: any) => void
): () => void {
  const eventSource = new EventSource(`${API_BASE}/clis/install/stream?cli=${encodeURIComponent(cli)}`);

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'output' && data.chunk) {
        onLog(data.chunk);
      } else if (data.type === 'done') {
        onDone(Boolean(data.success), data.availableClis);
        eventSource.close();
      }
    } catch {
      // ignore parsing error
    }
  };

  eventSource.onerror = (err) => {
    if (onError) onError(err);
    eventSource.close();
  };

  return () => {
    eventSource.close();
  };
}

// ===================== Custom Scripts API =====================

export async function getProjectScripts(projectId: string): Promise<ProjectCustomScript[]> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/scripts`);
  if (!res.ok) throw new Error('Failed to fetch project scripts');
  return res.json();
}

export async function updateProjectScripts(
  projectId: string,
  scripts: ProjectCustomScript[]
): Promise<{ success: boolean; scripts: ProjectCustomScript[] }> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/scripts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scripts }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to update project scripts');
  }
  return res.json();
}

export async function getTaskScripts(
  taskId: string
): Promise<{ scripts: ProjectCustomScript[]; executions: ScriptExecutionItem[] }> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/scripts`);
  if (!res.ok) throw new Error('Failed to fetch task scripts');
  return res.json();
}

export async function runTaskScript(
  taskId: string,
  params: { id?: string; name?: string; command: string; saveToProject?: boolean }
): Promise<ScriptExecutionItem> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/scripts/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to run script');
  }
  return res.json();
}

export async function getScriptExecutions(params?: {
  taskId?: string;
  projectId?: string;
}): Promise<ScriptExecutionItem[]> {
  const query = new URLSearchParams();
  if (params?.taskId) query.set('taskId', params.taskId);
  if (params?.projectId) query.set('projectId', params.projectId);
  const res = await fetch(`${API_BASE}/scripts/executions?${query.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch executions');
  return res.json();
}

export async function cancelScriptExecution(
  executionId: string,
  force?: boolean
): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/scripts/${executionId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  });
  return res.json();
}

export async function rerunScriptExecution(executionId: string): Promise<ScriptExecutionItem> {
  const res = await fetch(`${API_BASE}/scripts/${executionId}/rerun`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to rerun script');
  return res.json();
}

export async function dismissScriptExecution(executionId: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/scripts/${executionId}/dismiss`, {
    method: 'POST',
  });
  return res.json();
}

// ===================== Git Accounts APIs =====================

export async function getGitAccounts(): Promise<GitAccount[]> {
  const res = await fetch(`${API_BASE}/git-accounts`);
  return res.json();
}

export async function verifyGitAccount(params: {
  provider: 'github' | 'gitlab';
  token: string;
  host?: string;
}): Promise<VerifyGitAccountResult> {
  const res = await fetch(`${API_BASE}/git-accounts/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Verification failed');
  }
  return data;
}

export async function addGitAccount(params: {
  provider: 'github' | 'gitlab';
  name: string;
  username: string;
  avatar_url?: string | null;
  token: string;
  host?: string;
}): Promise<GitAccount> {
  const res = await fetch(`${API_BASE}/git-accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to link account');
  }
  return data;
}

export async function deleteGitAccount(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/git-accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to remove account');
  }
  return true;
}

export async function getGitAccountRepos(id: string): Promise<RemoteRepoItem[]> {
  const res = await fetch(`${API_BASE}/git-accounts/${encodeURIComponent(id)}/repos`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch repositories');
  }
  return data;
}

// ===================== Clone & Create Project APIs =====================

export function cloneProjectStream(
  params: { url: string; parentPath: string; folderName: string; accountId?: string },
  onLog: (chunk: string) => void,
  onDone: (result: { success: boolean; projectPath?: string; error?: string; repoInfo?: any }) => void,
  onError?: (err: any) => void
): () => void {
  const query = new URLSearchParams({
    url: params.url,
    parentPath: params.parentPath,
    folderName: params.folderName,
  });
  if (params.accountId) {
    query.set('accountId', params.accountId);
  }

  const eventSource = new EventSource(`${API_BASE}/projects/clone/stream?${query.toString()}`);

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'output' && data.chunk) {
        onLog(data.chunk);
      } else if (data.type === 'done') {
        onDone(data);
        eventSource.close();
      }
    } catch {}
  };

  eventSource.onerror = (err) => {
    if (onError) onError(err);
    eventSource.close();
  };

  return () => {
    eventSource.close();
  };
}

export async function createNewProject(params: {
  parentPath: string;
  name: string;
  defaultBranch?: string;
  initReadme?: boolean;
}): Promise<{ project: Project; repoInfo: any }> {
  const res = await fetch(`${API_BASE}/projects/create-new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to create new project');
  }
  return data;
}
