// Browser Web Notification Service for Raft background tasks

export type NotificationTriggerType = 'done' | 'hitl' | 'error' | 'question';

const STORAGE_KEY_NOTIFICATIONS_ENABLED = 'raft_notifications_enabled';

/**
 * Check if the current browser environment supports the Web Notification API.
 */
export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Get current Notification permission status.
 */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Check if notifications are enabled by user setting and granted by browser.
 */
export function isNotificationEnabled(): boolean {
  if (!isNotificationSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    const setting = localStorage.getItem(STORAGE_KEY_NOTIFICATIONS_ENABLED);
    return setting !== 'false';
  } catch {
    return true;
  }
}

/**
 * Update user preference for desktop notifications.
 */
export function setNotificationEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY_NOTIFICATIONS_ENABLED, enabled ? 'true' : 'false');
    window.dispatchEvent(
      new CustomEvent('notification-preference-changed', {
        detail: { enabled },
      })
    );
  } catch {}
}

/**
 * Request notification permission from the user.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return 'denied';
  try {
    const permission = await Notification.requestPermission();
    window.dispatchEvent(
      new CustomEvent('notification-permission-changed', {
        detail: { permission },
      })
    );
    return permission;
  } catch (err) {
    console.error('Failed to request notification permission:', err);
    return 'denied';
  }
}

/**
 * Trigger permission request on explicit user gesture (e.g. sending a message),
 * only if permission is still in the 'default' state.
 */
export function requestNotificationPermissionOnUserGesture(): void {
  if (!isNotificationSupported()) return;
  if (Notification.permission === 'default') {
    requestNotificationPermission().catch(() => {});
  }
}

/**
 * Determine whether a task is currently in the background.
 * True if:
 * 1. User is on another task or another page (e.g. /projects, /settings, /).
 * 2. OR browser tab is hidden / minimized (document.hidden).
 * 3. OR browser window is unfocused (user switched to another application).
 */
export function isTaskInBackground(taskId: string, currentTaskId: string | null): boolean {
  if (!taskId) return false;
  // If user is on a different task or on a non-task page
  if (currentTaskId !== taskId) return true;

  // If user is on this task, check window visibility and focus
  if (typeof document !== 'undefined') {
    if (document.hidden) return true;
    if (typeof document.hasFocus === 'function' && !document.hasFocus()) return true;
  }

  return false;
}

/**
 * Clean and summarize agent output content for display in a notification body.
 * Strips out <thought>...</thought> tags, code blocks, and markdown noise.
 */
export function cleanNotificationContent(raw: string): string {
  if (!raw) return 'Task completed';
  let clean = raw.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
  clean = clean.replace(/```[\s\S]*?```/g, '[Code snippet]').trim();
  clean = clean.replace(/^[#>\-\*\s]+/gm, '').trim();

  // Get first non-empty line
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  const firstLine = lines[0] || 'Task completed';
  if (firstLine.length > 120) {
    return firstLine.slice(0, 117) + '...';
  }
  return firstLine;
}

export interface TaskNotificationOptions {
  taskId: string;
  projectId?: string;
  projectName?: string;
  taskName?: string;
  type: NotificationTriggerType;
  detail?: string;
  onNavigate?: () => void;
}

/**
 * Dispatches a native browser desktop notification for a task event.
 */
export function sendTaskNotification(options: TaskNotificationOptions): Notification | null {
  if (!isNotificationEnabled()) return null;

  const { taskId, projectId, projectName, taskName, type, detail, onNavigate } = options;
  if (!taskId) return null;

  // Format title: [<Project Name>] <Task Name> or <Task Name>
  const cleanTaskName = (taskName || 'Task').trim();
  const title = projectName?.trim()
    ? `[${projectName.trim()}] ${cleanTaskName}`
    : cleanTaskName;

  // Format body
  let body = '';
  switch (type) {
    case 'done': {
      const summary = cleanNotificationContent(detail || '');
      body = `Agent finished: ${summary}`;
      break;
    }
    case 'hitl': {
      body = 'Attention needed: Agent requested user confirmation / input';
      break;
    }
    case 'error': {
      const snippet = (detail || '').trim();
      body = snippet
        ? `Attention needed: Agent encountered an error (${snippet.length > 90 ? snippet.slice(0, 87) + '...' : snippet})`
        : 'Attention needed: Agent encountered an error';
      break;
    }
    case 'question': {
      body = 'Attention needed: Agent asked a question';
      break;
    }
  }

  try {
    const notification = new Notification(title, {
      body,
      tag: `raft-task-${taskId}`, // OS deduplication tag
      silent: false, // Play OS default sound
      icon: '/favicon.ico',
    });

    notification.onclick = (e) => {
      e.preventDefault();
      try {
        window.focus();
      } catch {}

      if (onNavigate) {
        onNavigate();
      } else {
        window.dispatchEvent(
          new CustomEvent('navigate-to-task', {
            detail: { taskId, projectId },
          })
        );
      }

      notification.close();
    };

    return notification;
  } catch (err) {
    console.error('Failed to display desktop notification:', err);
    return null;
  }
}

/**
 * Send a test desktop notification to verify configuration.
 */
export function sendTestNotification(): Notification | null {
  if (!isNotificationEnabled()) return null;

  try {
    const notification = new Notification('[Alpha Bro] Test Notification', {
      body: 'Agent finished: Desktop notifications are working properly!',
      tag: 'raft-test-notification',
      silent: false,
      icon: '/favicon.ico',
    });

    notification.onclick = (e) => {
      e.preventDefault();
      try {
        window.focus();
      } catch {}
      notification.close();
    };

    return notification;
  } catch (err) {
    console.error('Failed to send test notification:', err);
    return null;
  }
}
