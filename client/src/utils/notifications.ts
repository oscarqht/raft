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
 * Check if notifications are enabled by user setting.
 */
export function isNotificationEnabled(): boolean {
  try {
    const setting = localStorage.getItem(STORAGE_KEY_NOTIFICATIONS_ENABLED);
    return setting !== 'false';
  } catch {
    return true;
  }
}

/**
 * Dispatch system notification via server fallback endpoint.
 */
export async function sendServerNotification(payload: {
  title: string;
  body: string;
  taskId?: string;
  projectId?: string;
}): Promise<boolean> {
  try {
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (err) {
    console.warn('Failed to dispatch server notification:', err);
    return false;
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

  let browserNotif: Notification | null = null;
  let browserNotifSuccess = false;

  // 1. Try browser Notification if supported and granted
  if (isNotificationSupported() && Notification.permission === 'granted') {
    try {
      browserNotif = new Notification(title, {
        body,
        tag: `raft-task-${taskId}`, // OS deduplication tag
        silent: false, // Play OS default sound
        icon: '/favicon.ico',
      });

      browserNotif.onclick = (e) => {
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

        browserNotif?.close();
      };

      browserNotifSuccess = true;
    } catch (err) {
      console.warn('Browser Notification failed, falling back to server notification:', err);
      browserNotif = null;
    }
  }

  // 2. If browser Notification was not shown (not supported, permission not granted, insecure context, or threw error),
  // send via server endpoint to guarantee native OS notification!
  if (!browserNotifSuccess) {
    sendServerNotification({
      title,
      body,
      taskId,
      projectId,
    }).catch(() => {});
  }

  return browserNotif;
}

/**
 * Send a test desktop notification to verify configuration.
 */
export function sendTestNotification(): Notification | null {
  if (!isNotificationEnabled()) return null;

  const title = '[Alpha Bro] Test Notification';
  const body = 'Agent finished: Desktop notifications are working properly!';

  let browserNotif: Notification | null = null;
  let browserNotifSuccess = false;

  if (isNotificationSupported() && Notification.permission === 'granted') {
    try {
      browserNotif = new Notification(title, {
        body,
        tag: 'raft-test-notification',
        silent: false,
        icon: '/favicon.ico',
      });

      browserNotif.onclick = (e) => {
        e.preventDefault();
        try {
          window.focus();
        } catch {}
        browserNotif?.close();
      };

      browserNotifSuccess = true;
    } catch (err) {
      console.warn('Browser test notification failed, falling back to server notification:', err);
    }
  }

  // Always also send via server notification if browser notification was not shown
  if (!browserNotifSuccess) {
    sendServerNotification({
      title,
      body,
    }).catch(() => {});
  }

  return browserNotif;
}
