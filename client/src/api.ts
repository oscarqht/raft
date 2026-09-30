import {
  Project,
  Task,
  ChatSession,
  ChatMessage,
  AgentStep,
  Settings,
  CliInfo,
  ModelOption,
  DevServerState,
  GitStatus,
  FSResponse,
  ProjectCustomScript,
  ScriptExecutionItem,
  AgentSkill,
  SkillInstallSummaryItem,
  GitAccount,
  RemoteRepoItem,
  VerifyGitAccountResult,
  FileAttachment,
  AgentUsageSnapshot,
  UpdaterStatusResponse,
  AlphaStatusResponse,
  AlphaDeviceStatus,
} from './types';

const API_BASE = '/api';

export async function getUpdaterStatus(): Promise<UpdaterStatusResponse> {
  const res = await fetch(`${API_BASE}/updater/status`);
  if (!res.ok) {
    throw new Error('Failed to fetch updater status');
  }
  return res.json();
}

export async function checkUpdate(): Promise<void> {
  const res = await fetch(`${API_BASE}/updater/check`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to check for updates');
  }
}

export async function installUpdate(): Promise<void> {
  const res = await fetch(`${API_BASE}/updater/install`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to start installation');
  }
}


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

export async function getSkills(_cli?: string, _worktreePath?: string, _taskId?: string): Promise<AgentSkill[]> {
  const res = await fetch(`${API_BASE}/skills`);
  return res.json();
}

export async function createSkill(skill: { name: string; description?: string; content: string }): Promise<AgentSkill> {
  const res = await fetch(`${API_BASE}/skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(skill),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to create skill');
  }
  return res.json();
}

export async function updateSkill(id: string, skill: { name?: string; description?: string; content?: string }): Promise<AgentSkill> {
  const res = await fetch(`${API_BASE}/skills/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(skill),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update skill');
  }
  return res.json();
}

export async function deleteSkill(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/skills/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete skill');
  }
}

export function installSkillStream(
  command: string,
  onLog: (chunk: string) => void,
  onDone: (result: {
    success: boolean;
    error?: string;
    installedSkills?: SkillInstallSummaryItem[];
    allSkills?: AgentSkill[];
  }) => void,
  onError?: (err: any) => void
): () => void {
  const query = new URLSearchParams({ command });
  const eventSource = new EventSource(`${API_BASE}/skills/install/stream?${query.toString()}`);

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
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to delete task (${res.status})`);
  }
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

export async function getTaskGitStatus(taskId: string, force = false): Promise<GitStatus> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/git/status${force ? '?force=1' : ''}`);
  return res.json();
}

export async function getProjectTasksGitStatus(projectId: string, force = false): Promise<Record<string, GitStatus>> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/tasks-status${force ? '?force=1' : ''}`);
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

export async function getActiveDevServers(): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/dev-servers/active`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.activeTaskIds || [];
  } catch {
    return [];
  }
}

export async function getDevServerState(taskId: string): Promise<DevServerState> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/dev-server`);
  return res.json();
}

export async function pingDevServer(taskId: string): Promise<{ ready: boolean; port: number }> {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/dev-server/ping`);
    if (!res.ok) return { ready: false, port: 5173 };
    return await res.json();
  } catch {
    return { ready: false, port: 5173 };
  }
}

export async function startDevServer(taskId: string): Promise<DevServerState> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/dev-server/start`, { method: 'POST' });
  return res.json();
}

export async function stopDevServer(
  taskId: string,
  options?: { onlyIfNoSubscribers?: boolean }
): Promise<{ success: boolean; wasRunning?: boolean }> {
  const query = options?.onlyIfNoSubscribers ? '?onlyIfNoSubscribers=true' : '';
  const res = await fetch(`${API_BASE}/tasks/${taskId}/dev-server/stop${query}`, { method: 'POST' });
  return res.json();
}

export function scheduleDevServerStop(taskId: string, graceMs: number = 3000): void {
  const url = `${API_BASE}/tasks/${taskId}/dev-server/schedule-stop?graceMs=${graceMs}`;
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    try {
      navigator.sendBeacon(url);
      return;
    } catch {}
  }
  fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
}

export async function cancelDevServerStop(taskId: string): Promise<{ cancelled: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/dev-server/cancel-stop`, { method: 'POST' });
    return res.json();
  } catch {
    return { cancelled: false };
  }
}

export async function restartDevServer(taskId: string): Promise<DevServerState> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/dev-server/restart`, { method: 'POST' });
  return res.json();
}

export interface GetTaskChatsOptions {
  includeMessages?: boolean;
  activeChatId?: string;
  signal?: AbortSignal;
}

export async function getTaskChats(taskId: string, options?: GetTaskChatsOptions): Promise<ChatSession[]> {
  const params = new URLSearchParams();
  if (options?.includeMessages) params.set('include_messages', 'true');
  if (options?.activeChatId) params.set('active_chat_id', options.activeChatId);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${API_BASE}/tasks/${taskId}/chats${qs}`, { signal: options?.signal });
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

export async function getChatMessages(sessionId: string, signal?: AbortSignal): Promise<ChatMessage[]> {
  const res = await fetch(`${API_BASE}/chats/${sessionId}/messages`, { signal });
  return res.json();
}

export async function deleteChatMessage(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/messages/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function getMessageActivity(
  messageId: string,
  signal?: AbortSignal
): Promise<{ messageId: string; steps: AgentStep[]; thoughts?: string }> {
  const res = await fetch(`${API_BASE}/messages/${messageId}/activity`, { signal });
  if (!res.ok) {
    throw new Error('Failed to load message activity');
  }
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

// ===================== Attachments APIs =====================

export async function uploadTaskAttachments(taskId: string, files: File[]): Promise<FileAttachment[]> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  const res = await fetch(`${API_BASE}/tasks/${taskId}/attachments`, {
    method: 'POST',
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to upload attachments');
  }
  return data;
}

export async function getAttachmentContent(
  taskId: string,
  attachmentId: string
): Promise<{ content: string; isTruncated: boolean; name: string; size: number; type: string }> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/attachments/${attachmentId}/content`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch attachment content');
  }
  return data;
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

export async function getAgentUsage(cli?: string, refresh = false): Promise<AgentUsageSnapshot> {
  const params = new URLSearchParams();
  if (cli) params.set('cli', cli);
  if (refresh) params.set('refresh', 'true');
  const res = await fetch(`${API_BASE}/agent-usage?${params.toString()}`);
  if (!res.ok) {
    throw new Error('Failed to load AI agent usage');
  }
  return res.json();
}

export async function getAllAgentUsages(refresh = false): Promise<Record<string, AgentUsageSnapshot>> {
  const params = new URLSearchParams();
  if (refresh) params.set('refresh', 'true');
  const res = await fetch(`${API_BASE}/agent-usage?${params.toString()}`);
  if (!res.ok) {
    throw new Error('Failed to load AI agent usages');
  }
  return res.json();
}

export async function getAlphaStatus(): Promise<AlphaStatusResponse> {
  const res = await fetch(`${API_BASE}/alpha/status`);
  if (!res.ok) {
    throw new Error('Failed to get Alpha Intelligence status');
  }
  return res.json();
}

export async function reconnectAlphaDevice(): Promise<{ success: boolean; status: AlphaDeviceStatus }> {
  const res = await fetch(`${API_BASE}/alpha/device/reconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error('Failed to reconnect Alpha device');
  }
  return res.json();
}

export async function submitAlphaHitl(
  callback_url: string,
  response: any
): Promise<{ success: boolean; status?: number; body?: string }> {
  const res = await fetch(`${API_BASE}/alpha/hitl-submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_url, response }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to submit HITL response');
  }
  return data;
}
