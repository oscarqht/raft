import { Project, Task, ChatSession, ChatMessage, Settings, CliInfo, ModelOption, DevServerState, GitStatus } from './types';

const API_BASE = '/api';

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

export async function getModels(cli?: string): Promise<ModelOption[]> {
  const url = cli ? `${API_BASE}/models?cli=${encodeURIComponent(cli)}` : `${API_BASE}/models`;
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
