import {
  Task,
  ChatSession,
  ChatMessage,
  ModelOption,
  AgentUsageSnapshot,
  QueuedMessage,
  Project,
  TaskGitStatus,
  Settings,
  CliInfo,
  GitAccount,
  AgentSkill,
} from './types';

import { idbGet, idbSet, idbDelete } from './idb';

const PREFIX = 'raft:';
const LEGACY_PREFIX = 'termai:';
const MAX_MESSAGES_PER_SESSION = 80;
const MAX_CACHED_SESSIONS = 25;
const MAX_CACHED_TASKS = 25;

// In-Memory synchronous stores for instant 0ms task switching and unlimited active memory
const memoryTasks = new Map<string, Task>();
const memoryChats = new Map<string, ChatSession[]>();
const memoryMessages = new Map<string, ChatMessage[]>();

// LRU tracking index
interface CacheIndex {
  taskIds: string[];
  sessionIds: string[];
}

function getIndex(): CacheIndex {
  try {
    const raw = localStorage.getItem(`${PREFIX}index`) || localStorage.getItem(`${LEGACY_PREFIX}index`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { taskIds: [], sessionIds: [] };
}

function saveIndex(index: CacheIndex) {
  try {
    localStorage.setItem(`${PREFIX}index`, JSON.stringify(index));
  } catch {}
}

function touchTaskId(taskId: string) {
  const index = getIndex();
  index.taskIds = [taskId, ...index.taskIds.filter((id) => id !== taskId)];
  if (index.taskIds.length > MAX_CACHED_TASKS) {
    const evicted = index.taskIds.slice(MAX_CACHED_TASKS);
    index.taskIds = index.taskIds.slice(0, MAX_CACHED_TASKS);
    evicted.forEach((id) => {
      try {
        localStorage.removeItem(`${PREFIX}task:${id}`);
        localStorage.removeItem(`${PREFIX}chats:${id}`);
        localStorage.removeItem(`${PREFIX}active_chat:${id}`);
      } catch {}
    });
  }
  saveIndex(index);
}

function touchSessionId(sessionId: string) {
  const index = getIndex();
  index.sessionIds = [sessionId, ...index.sessionIds.filter((id) => id !== sessionId)];
  if (index.sessionIds.length > MAX_CACHED_SESSIONS) {
    const evicted = index.sessionIds.slice(MAX_CACHED_SESSIONS);
    index.sessionIds = index.sessionIds.slice(0, MAX_CACHED_SESSIONS);
    evicted.forEach((id) => {
      try {
        localStorage.removeItem(`${PREFIX}messages:${id}`);
      } catch {}
    });
  }
  saveIndex(index);
}

// Projects Cache
export function getCachedProjects(): Project[] | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}projects`) || localStorage.getItem(`${LEGACY_PREFIX}projects`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return null;
}

export function setCachedProjects(projects: Project[]): void {
  if (!Array.isArray(projects)) return;
  try {
    localStorage.setItem(`${PREFIX}projects`, JSON.stringify(projects));
  } catch {
    cleanOldCache();
  }
}

// Single Project Cache
export function getCachedProject(projectId: string): Project | null {
  if (!projectId) return null;
  try {
    const raw = localStorage.getItem(`${PREFIX}project:${projectId}`) || localStorage.getItem(`${LEGACY_PREFIX}project:${projectId}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  // Fallback: check if it exists in getCachedProjects()
  const projects = getCachedProjects();
  if (projects) {
    const found = projects.find((p) => p.id === projectId);
    if (found) return found;
  }
  return null;
}

export function setCachedProject(project: Project): void {
  if (!project?.id) return;
  try {
    localStorage.setItem(`${PREFIX}project:${project.id}`, JSON.stringify(project));
  } catch {
    cleanOldCache();
  }
}

export function deleteCachedProject(projectId: string): void {
  if (!projectId) return;
  try {
    localStorage.removeItem(`${PREFIX}project:${projectId}`);
    localStorage.removeItem(`${PREFIX}tasks:${projectId}`);
    localStorage.removeItem(`${PREFIX}tasks_git_status:${projectId}`);
    const projects = getCachedProjects();
    if (projects) {
      const filtered = projects.filter((p) => p.id !== projectId);
      setCachedProjects(filtered);
    }
  } catch {}
}

// Project Tasks Cache
export function getCachedProjectTasks(projectId: string): Task[] | null {
  if (!projectId) return null;
  try {
    const raw = localStorage.getItem(`${PREFIX}tasks:${projectId}`) || localStorage.getItem(`${LEGACY_PREFIX}tasks:${projectId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return null;
}

export function setCachedProjectTasks(projectId: string, tasks: Task[]): void {
  if (!projectId || !Array.isArray(tasks)) return;
  try {
    localStorage.setItem(`${PREFIX}tasks:${projectId}`, JSON.stringify(tasks));
  } catch {
    cleanOldCache();
  }
}

export function deleteCachedProjectTasks(projectId: string): void {
  if (!projectId) return;
  try {
    localStorage.removeItem(`${PREFIX}tasks:${projectId}`);
    localStorage.removeItem(`${PREFIX}tasks_git_status:${projectId}`);
  } catch {}
}

// Project Tasks Git Status Cache
export function getCachedProjectTasksGitStatus(projectId: string): Record<string, TaskGitStatus> | null {
  if (!projectId) return null;
  try {
    const raw = localStorage.getItem(`${PREFIX}tasks_git_status:${projectId}`) || localStorage.getItem(`${LEGACY_PREFIX}tasks_git_status:${projectId}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function setCachedProjectTasksGitStatus(projectId: string, statuses: Record<string, TaskGitStatus>): void {
  if (!projectId || !statuses) return;
  try {
    localStorage.setItem(`${PREFIX}tasks_git_status:${projectId}`, JSON.stringify(statuses));
  } catch {
    cleanOldCache();
  }
}

// All Tasks Cache (across projects)
export function getCachedAllTasks(): Task[] | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}all_tasks`) || localStorage.getItem(`${LEGACY_PREFIX}all_tasks`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return null;
}

export function setCachedAllTasks(tasks: Task[]): void {
  if (!Array.isArray(tasks)) return;
  try {
    localStorage.setItem(`${PREFIX}all_tasks`, JSON.stringify(tasks));
  } catch {
    cleanOldCache();
  }
}

// Task Cache
export function getCachedTask(taskId: string): Task | null {
  if (!taskId) return null;
  if (memoryTasks.has(taskId)) {
    return memoryTasks.get(taskId)!;
  }
  try {
    const raw = localStorage.getItem(`${PREFIX}task:${taskId}`) || localStorage.getItem(`${LEGACY_PREFIX}task:${taskId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      memoryTasks.set(taskId, parsed);
      return parsed;
    }
  } catch {}

  // Asynchronously backfill from IndexedDB if not found yet
  idbGet<Task>(`${PREFIX}task:${taskId}`).then((t) => {
    if (t) memoryTasks.set(taskId, t);
  }).catch(() => {});

  return null;
}

export function setCachedTask(task: Task): void {
  if (!task?.id) return;
  memoryTasks.set(task.id, task);
  idbSet(`${PREFIX}task:${task.id}`, task).catch(() => {});
  try {
    localStorage.setItem(`${PREFIX}task:${task.id}`, JSON.stringify(task));
    touchTaskId(task.id);
  } catch (e) {
    cleanOldCache();
  }
}

// Chat Sessions Cache
export function getCachedChats(taskId: string): ChatSession[] | null {
  if (!taskId) return null;
  if (memoryChats.has(taskId)) {
    return memoryChats.get(taskId)!;
  }
  try {
    const raw = localStorage.getItem(`${PREFIX}chats:${taskId}`) || localStorage.getItem(`${LEGACY_PREFIX}chats:${taskId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      memoryChats.set(taskId, parsed);
      return parsed;
    }
  } catch {}

  // Asynchronously backfill from IndexedDB
  idbGet<ChatSession[]>(`${PREFIX}chats:${taskId}`).then((chats) => {
    if (chats) memoryChats.set(taskId, chats);
  }).catch(() => {});

  return null;
}

export function setCachedChats(taskId: string, chats: ChatSession[]): void {
  if (!taskId) return;
  memoryChats.set(taskId, chats);
  idbSet(`${PREFIX}chats:${taskId}`, chats).catch(() => {});
  try {
    localStorage.setItem(`${PREFIX}chats:${taskId}`, JSON.stringify(chats));
    touchTaskId(taskId);
  } catch {
    cleanOldCache();
  }
}

export async function loadCachedChatsAsync(taskId: string): Promise<ChatSession[] | null> {
  if (!taskId) return null;
  const sync = getCachedChats(taskId);
  if (sync && sync.length > 0) return sync;
  const idbData = await idbGet<ChatSession[]>(`${PREFIX}chats:${taskId}`);
  if (idbData && idbData.length > 0) {
    memoryChats.set(taskId, idbData);
    return idbData;
  }
  return null;
}

// Active Chat ID Cache
export function getCachedActiveChatId(taskId: string): string | null {
  if (!taskId) return null;
  try {
    return localStorage.getItem(`${PREFIX}active_chat:${taskId}`) || localStorage.getItem(`${LEGACY_PREFIX}active_chat:${taskId}`) || null;
  } catch {
    return null;
  }
}

export function setCachedActiveChatId(taskId: string, chatId: string): void {
  if (!taskId || !chatId) return;
  try {
    localStorage.setItem(`${PREFIX}active_chat:${taskId}`, chatId);
  } catch {}
}

// Chat Messages Cache
export function getCachedMessages(sessionId: string): ChatMessage[] | null {
  if (!sessionId) return null;
  if (memoryMessages.has(sessionId)) {
    return memoryMessages.get(sessionId)!;
  }
  try {
    const raw = localStorage.getItem(`${PREFIX}messages:${sessionId}`) || localStorage.getItem(`${LEGACY_PREFIX}messages:${sessionId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      memoryMessages.set(sessionId, parsed);
      return parsed;
    }
  } catch {}

  // Asynchronously backfill from IndexedDB
  idbGet<ChatMessage[]>(`${PREFIX}messages:${sessionId}`).then((msgs) => {
    if (msgs) memoryMessages.set(sessionId, msgs);
  }).catch(() => {});

  return null;
}

export function setCachedMessages(sessionId: string, messages: ChatMessage[]): void {
  if (!sessionId) return;
  memoryMessages.set(sessionId, messages);
  // Persist complete message history into IndexedDB without quota truncation
  idbSet(`${PREFIX}messages:${sessionId}`, messages).catch(() => {});
  try {
    // Keep most recent messages in localStorage for instant synchronous cold start
    const slice = messages.length > MAX_MESSAGES_PER_SESSION 
      ? messages.slice(-MAX_MESSAGES_PER_SESSION) 
      : messages;
    localStorage.setItem(`${PREFIX}messages:${sessionId}`, JSON.stringify(slice));
    touchSessionId(sessionId);
  } catch {
    cleanOldCache();
  }
}

export async function loadCachedMessagesAsync(sessionId: string): Promise<ChatMessage[] | null> {
  if (!sessionId) return null;
  const sync = getCachedMessages(sessionId);
  if (sync && sync.length > 0) return sync;
  const idbData = await idbGet<ChatMessage[]>(`${PREFIX}messages:${sessionId}`);
  if (idbData && idbData.length > 0) {
    memoryMessages.set(sessionId, idbData);
    return idbData;
  }
  return null;
}

// Delete cached task
export function deleteCachedTask(taskId: string, projectId?: string): void {
  if (!taskId) return;
  memoryTasks.delete(taskId);
  memoryChats.delete(taskId);
  idbDelete(`${PREFIX}task:${taskId}`).catch(() => {});
  idbDelete(`${PREFIX}chats:${taskId}`).catch(() => {});
  try {
    localStorage.removeItem(`${PREFIX}task:${taskId}`);
    localStorage.removeItem(`${PREFIX}chats:${taskId}`);
    localStorage.removeItem(`${PREFIX}active_chat:${taskId}`);
    localStorage.removeItem(`${PREFIX}task_queue_count:${taskId}`);
    const index = getIndex();
    index.taskIds = index.taskIds.filter((id) => id !== taskId);
    saveIndex(index);
    removeUnreadReplyTaskId(taskId);

    if (projectId) {
      const cached = getCachedProjectTasks(projectId);
      if (cached) {
        setCachedProjectTasks(projectId, cached.filter((t) => t.id !== taskId));
      }
    }
    const allTasks = getCachedAllTasks();
    if (allTasks) {
      setCachedAllTasks(allTasks.filter((t) => t.id !== taskId));
    }
  } catch {}
}

// Delete cached chat
export function deleteCachedChat(taskId: string, chatId: string): void {
  memoryMessages.delete(chatId);
  idbDelete(`${PREFIX}messages:${chatId}`).catch(() => {});
  try {
    localStorage.removeItem(`${PREFIX}messages:${chatId}`);
    const activeId = getCachedActiveChatId(taskId);
    if (activeId === chatId) {
      localStorage.removeItem(`${PREFIX}active_chat:${taskId}`);
    }
    const currentChats = getCachedChats(taskId);
    if (currentChats) {
      const filtered = currentChats.filter((c) => c.id !== chatId);
      memoryChats.set(taskId, filtered);
      idbSet(`${PREFIX}chats:${taskId}`, filtered).catch(() => {});
      localStorage.setItem(`${PREFIX}chats:${taskId}`, JSON.stringify(filtered));
    }
  } catch {}
}

// Emergency cleanup helper if quota is exceeded
function cleanOldCache() {
  try {
    const index = getIndex();
    const halfSessions = index.sessionIds.slice(Math.floor(index.sessionIds.length / 2));
    halfSessions.forEach((id) => {
      localStorage.removeItem(`${PREFIX}messages:${id}`);
    });
    index.sessionIds = index.sessionIds.slice(0, Math.floor(index.sessionIds.length / 2));
    saveIndex(index);
  } catch {}
}

// Provider models cache
export function getCachedModels(cli: string): ModelOption[] {
  try {
    const raw =
      localStorage.getItem(`raft_models_${(cli || '').toLowerCase()}`) ||
      localStorage.getItem(`termai_models_${(cli || '').toLowerCase()}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return [];
}

export function setCachedModels(cli: string, modelsList: ModelOption[]): void {
  try {
    if (modelsList && modelsList.length > 0) {
      localStorage.setItem(`raft_models_${(cli || '').toLowerCase()}`, JSON.stringify(modelsList));
    }
  } catch {}
}

// Provider model/effort preference cache
export function getCachedProviderPreference(cli: string): { model?: string; effort?: string } {
  try {
    const raw =
      localStorage.getItem(`raft_pref_${(cli || '').toLowerCase()}`) ||
      localStorage.getItem(`termai_pref_${(cli || '').toLowerCase()}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  return {};
}

export function setCachedProviderPreference(cli: string, model: string, effort: string): void {
  try {
    localStorage.setItem(`raft_pref_${(cli || '').toLowerCase()}`, JSON.stringify({ model, effort }));
  } catch {}
}

/**
 * Resolves the appropriate model and reasoning effort for a CLI.
 * 1. Checks if preferredModel exists in modelList.
 * 2. Checks saved provider preferences for this CLI.
 * 3. Checks for a recommended model (e.g. marked with "(Recommended)" or id has "recommended").
 * 4. Falls back to the first available model.
 * 5. Reconciles reasoning effort against supported reasoning efforts of the chosen model.
 */
export function resolveModelAndEffort(
  cli: string,
  modelList: ModelOption[],
  preferredModel?: string,
  preferredEffort?: string
): { modelId: string; effort: string } {
  if (!modelList || modelList.length === 0) {
    return {
      modelId: preferredModel || '',
      effort: preferredEffort || 'medium',
    };
  }

  // 1. Try preferredModel if provided and exists in modelList
  let active = preferredModel ? modelList.find((m) => m.id === preferredModel) : undefined;

  // 2. Try cached provider preference
  if (!active) {
    const pref = getCachedProviderPreference(cli);
    if (pref.model) {
      active = modelList.find((m) => m.id === pref.model);
    }
  }

  // 3. Try recommended model (e.g. name has "(Recommended)" or id has "recommended")
  if (!active) {
    active = modelList.find(
      (m) =>
        m.name.toLowerCase().includes('(recommended)') ||
        m.id.toLowerCase().includes('recommended')
    );
  }

  // 4. Fallback to first model
  if (!active) {
    active = modelList[0];
  }

  const modelId = active.id;
  const supportedEfforts =
    active.reasoningEfforts && active.reasoningEfforts.length > 0
      ? active.reasoningEfforts
      : ['none', 'low', 'medium', 'high', 'max'];

  const candidateEffort = preferredEffort || getCachedProviderPreference(cli).effort;
  const effortLower = (candidateEffort || '').toLowerCase();
  const validEffort =
    supportedEfforts.find((s) => s.toLowerCase() === effortLower) ||
    active.defaultEffort ||
    supportedEfforts[0] ||
    'medium';

  return { modelId, effort: validEffort };
}

// Agent usages cache
let inMemoryAgentUsages: Record<string, AgentUsageSnapshot> | null = null;

export function getCachedAgentUsages(): Record<string, AgentUsageSnapshot> | null {
  if (inMemoryAgentUsages && Object.keys(inMemoryAgentUsages).length > 0) {
    return inMemoryAgentUsages;
  }
  try {
    const raw =
      localStorage.getItem(`${PREFIX}agent_usages`) ||
      localStorage.getItem(`${LEGACY_PREFIX}agent_usages`) ||
      localStorage.getItem('raft_agent_usages');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        inMemoryAgentUsages = parsed;
        return parsed;
      }
    }
  } catch {}
  return null;
}

export function setCachedAgentUsages(usages: Record<string, AgentUsageSnapshot>): void {
  if (!usages || typeof usages !== 'object' || Object.keys(usages).length === 0) {
    return;
  }
  inMemoryAgentUsages = usages;
  try {
    localStorage.setItem(`${PREFIX}agent_usages`, JSON.stringify(usages));
  } catch {}
}

// Queued Messages Cache
export function getCachedQueuedMessages(sessionId: string): QueuedMessage[] {
  if (!sessionId) return [];
  try {
    const raw = localStorage.getItem(`${PREFIX}queue:${sessionId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function setCachedQueuedMessages(sessionId: string, queue: QueuedMessage[]): void {
  if (!sessionId) return;
  try {
    if (!queue || queue.length === 0) {
      localStorage.removeItem(`${PREFIX}queue:${sessionId}`);
    } else {
      localStorage.setItem(`${PREFIX}queue:${sessionId}`, JSON.stringify(queue));
    }
  } catch {}
}

export function clearCachedQueuedMessages(sessionId: string): void {
  if (!sessionId) return;
  try {
    localStorage.removeItem(`${PREFIX}queue:${sessionId}`);
  } catch {}
}

// Task Queued Messages Count Cache
export function setCachedTaskQueuedCount(taskId: string, count: number): void {
  if (!taskId) return;
  try {
    if (count <= 0) {
      localStorage.removeItem(`${PREFIX}task_queue_count:${taskId}`);
    } else {
      localStorage.setItem(`${PREFIX}task_queue_count:${taskId}`, String(count));
    }
  } catch {}
}

export function getCachedTaskQueuedCount(taskId: string): number {
  if (!taskId) return 0;
  try {
    const raw = localStorage.getItem(`${PREFIX}task_queue_count:${taskId}`);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

// Unread Task Replies Cache (Blue dot notification)
export function getCachedUnreadReplyTaskIds(): string[] {
  try {
    const raw = localStorage.getItem(`${PREFIX}unread_replies`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function setCachedUnreadReplyTaskIds(taskIds: string[]): void {
  try {
    localStorage.setItem(`${PREFIX}unread_replies`, JSON.stringify(taskIds));
  } catch {}
}

export function addUnreadReplyTaskId(taskId: string): void {
  if (!taskId) return;
  const list = getCachedUnreadReplyTaskIds();
  if (!list.includes(taskId)) {
    setCachedUnreadReplyTaskIds([...list, taskId]);
    window.dispatchEvent(new CustomEvent('unread-task-replies-updated', { detail: { taskId, action: 'add' } }));
  }
}

export function removeUnreadReplyTaskId(taskId: string): void {
  if (!taskId) return;
  const list = getCachedUnreadReplyTaskIds();
  if (list.includes(taskId)) {
    const updated = list.filter((id) => id !== taskId);
    setCachedUnreadReplyTaskIds(updated);
    window.dispatchEvent(new CustomEvent('unread-task-replies-updated', { detail: { taskId, action: 'remove' } }));
  }
}

// Settings Cache
export function getCachedSettings(): Settings | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}settings`) || localStorage.getItem(`${LEGACY_PREFIX}settings`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function setCachedSettings(settings: Settings): void {
  if (!settings) return;
  try {
    localStorage.setItem(`${PREFIX}settings`, JSON.stringify(settings));
  } catch {}
}

// CLIs Cache
export function getCachedClis(): CliInfo[] | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}clis`) || localStorage.getItem(`${LEGACY_PREFIX}clis`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return null;
}

export function setCachedClis(clis: CliInfo[]): void {
  if (!Array.isArray(clis)) return;
  try {
    localStorage.setItem(`${PREFIX}clis`, JSON.stringify(clis));
  } catch {}
}

// Git Accounts Cache
export function getCachedGitAccounts(): GitAccount[] | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}git_accounts`) || localStorage.getItem(`${LEGACY_PREFIX}git_accounts`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return null;
}

export function setCachedGitAccounts(accounts: GitAccount[]): void {
  if (!Array.isArray(accounts)) return;
  try {
    localStorage.setItem(`${PREFIX}git_accounts`, JSON.stringify(accounts));
  } catch {}
}

// Agent Skills Cache
export function getCachedSkills(): AgentSkill[] | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}skills`) || localStorage.getItem(`${LEGACY_PREFIX}skills`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return null;
}

export function setCachedSkills(skills: AgentSkill[]): void {
  if (!Array.isArray(skills)) return;
  try {
    localStorage.setItem(`${PREFIX}skills`, JSON.stringify(skills));
  } catch {}
}


