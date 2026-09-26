import { Task, ChatSession, ChatMessage } from './types';

const PREFIX = 'termai:';
const MAX_MESSAGES_PER_SESSION = 80;
const MAX_CACHED_SESSIONS = 25;
const MAX_CACHED_TASKS = 25;

// LRU tracking index
interface CacheIndex {
  taskIds: string[];
  sessionIds: string[];
}

function getIndex(): CacheIndex {
  try {
    const raw = localStorage.getItem(`${PREFIX}index`);
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

// Task Cache
export function getCachedTask(taskId: string): Task | null {
  if (!taskId) return null;
  try {
    const raw = localStorage.getItem(`${PREFIX}task:${taskId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCachedTask(task: Task): void {
  if (!task?.id) return;
  try {
    localStorage.setItem(`${PREFIX}task:${task.id}`, JSON.stringify(task));
    touchTaskId(task.id);
  } catch (e) {
    // Quota fallback: clean up old cache entries
    cleanOldCache();
  }
}

// Chat Sessions Cache
export function getCachedChats(taskId: string): ChatSession[] | null {
  if (!taskId) return null;
  try {
    const raw = localStorage.getItem(`${PREFIX}chats:${taskId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCachedChats(taskId: string, chats: ChatSession[]): void {
  if (!taskId) return;
  try {
    localStorage.setItem(`${PREFIX}chats:${taskId}`, JSON.stringify(chats));
    touchTaskId(taskId);
  } catch {
    cleanOldCache();
  }
}

// Active Chat ID Cache
export function getCachedActiveChatId(taskId: string): string | null {
  if (!taskId) return null;
  try {
    return localStorage.getItem(`${PREFIX}active_chat:${taskId}`) || null;
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
  try {
    const raw = localStorage.getItem(`${PREFIX}messages:${sessionId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCachedMessages(sessionId: string, messages: ChatMessage[]): void {
  if (!sessionId) return;
  try {
    // Keep most recent messages up to MAX_MESSAGES_PER_SESSION to avoid hitting storage quotas
    const slice = messages.length > MAX_MESSAGES_PER_SESSION 
      ? messages.slice(-MAX_MESSAGES_PER_SESSION) 
      : messages;
    localStorage.setItem(`${PREFIX}messages:${sessionId}`, JSON.stringify(slice));
    touchSessionId(sessionId);
  } catch {
    cleanOldCache();
  }
}

// Delete cached chat
export function deleteCachedChat(taskId: string, chatId: string): void {
  try {
    localStorage.removeItem(`${PREFIX}messages:${chatId}`);
    const activeId = getCachedActiveChatId(taskId);
    if (activeId === chatId) {
      localStorage.removeItem(`${PREFIX}active_chat:${taskId}`);
    }
    const currentChats = getCachedChats(taskId);
    if (currentChats) {
      const filtered = currentChats.filter((c) => c.id !== chatId);
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
