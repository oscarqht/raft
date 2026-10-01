import React, { useState, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, matchPath } from 'react-router-dom';
import { Settings, CliInfo, Project, Task } from './types';
import { getSettings, getClis, getProject, getTask, deleteTask, updateTask } from './api';
import {
  getCachedTask,
  setCachedTask,
  deleteCachedTask,
  restoreCachedTask,
  addPendingDeletingTaskId,
  removePendingDeletingTaskId,
  getCachedSettings,
  setCachedSettings,
  getCachedClis,
  setCachedClis,
  getCachedProject,
  setCachedProject,
  getCachedAllTasks,
  getCachedChats,
  getCachedTaskQueuedCount,
  getCachedQueuedMessages,
  removeUnreadReplyTaskId,
} from './cache';
import { isTaskInBackground, sendTaskNotification, NotificationTriggerType } from './utils/notifications';
import { Header } from './components/Header';
import { EditTaskModal } from './components/EditTaskModal';
import { ProjectsTasksSidebar } from './components/ProjectsTasksSidebar';
import { HomePage } from './pages/HomePage';
import { TaskPage } from './pages/TaskPage';
import { SubmitProvider } from './contexts/SubmitContext';
import { SettingsPage } from './pages/SettingsPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DockItem } from './components/DockStack';
import { Loader2, Square, X, AlertCircle, RotateCw } from 'lucide-react';

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();

  // Extract current project/task IDs from URL pathname early for optimistic state
  const projectTaskMatch = matchPath('/projects/:projectId/tasks/:taskId', location.pathname);
  const projectMatch = matchPath('/projects/:projectId', location.pathname);
  const taskMatch = matchPath('/tasks/:taskId', location.pathname);

  const currentProjectId = projectTaskMatch?.params.projectId || projectMatch?.params.projectId || null;
  const currentTaskId = projectTaskMatch?.params.taskId || taskMatch?.params.taskId || null;

  const [activeProject, setActiveProject] = useState<Project | null>(() => {
    return currentProjectId ? getCachedProject(currentProjectId) : null;
  });
  const [activeTask, setActiveTask] = useState<Task | null>(() => {
    return currentTaskId ? getCachedTask(currentTaskId) : null;
  });
  const [isEditTaskOpen, setIsEditTaskOpen] = useState(false);
  const [isDeletingTask, setIsDeletingTask] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Close mobile sidebar on route change
  useEffect(() => {
    setIsMobileSidebarOpen(false);
  }, [location.pathname]);

  // Close mobile sidebar on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobileSidebarOpen) {
        setIsMobileSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileSidebarOpen]);

  const currentProjectIdRef = useRef<string | null>(currentProjectId);
  const currentTaskIdRef = useRef<string | null>(currentTaskId);
  currentProjectIdRef.current = currentProjectId;
  currentTaskIdRef.current = currentTaskId;

  useEffect(() => {
    currentProjectIdRef.current = currentProjectId;
  }, [currentProjectId]);

  useEffect(() => {
    currentTaskIdRef.current = currentTaskId;
  }, [currentTaskId]);

  const [settings, setSettings] = useState<Settings | null>(() => getCachedSettings());
  const [clis, setClis] = useState<CliInfo[]>(() => getCachedClis() || []);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [toastMessage, setToastMessage] = useState<{
    id: number;
    text: string;
    type?: 'info' | 'error';
    onRetry?: () => void;
  } | null>(null);

  useEffect(() => {
    const handleToast = (e: Event) => {
      const customEvent = e as CustomEvent<{ taskId: string; taskName?: string }>;
      const taskName = customEvent.detail?.taskName || 'Task';
      const text = `Dev server stopped for ${taskName}`;
      const toastId = Date.now();
      setToastMessage({ id: toastId, text, type: 'info' });
      setTimeout(() => {
        setToastMessage((cur) => (cur?.id === toastId ? null : cur));
      }, 3500);
    };

    window.addEventListener('show-dev-server-stopped-toast', handleToast);
    return () => window.removeEventListener('show-dev-server-stopped-toast', handleToast);
  }, []);

  // Listen for notification deep-link navigation
  useEffect(() => {
    const handleNotificationNavigate = (e: Event) => {
      const detail = (e as CustomEvent<{ taskId: string; projectId?: string }>).detail;
      if (detail?.taskId) {
        handleNavigate('task', { taskId: detail.taskId, projectId: detail.projectId });
        removeUnreadReplyTaskId(detail.taskId);
      }
    };

    window.addEventListener('navigate-to-task', handleNotificationNavigate);
    return () => window.removeEventListener('navigate-to-task', handleNotificationNavigate);
  }, [currentProjectId, activeTask]);

  // Always automatically match and sync with current OS theme
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const syncWithOsTheme = () => {
      const isDark = mediaQuery.matches;
      if (isDark) {
        document.documentElement.classList.add('dark');
        document.documentElement.style.backgroundColor = '#212121';
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.style.backgroundColor = '#ffffff';
      }
    };

    syncWithOsTheme();
    mediaQuery.addEventListener('change', syncWithOsTheme);
    return () => mediaQuery.removeEventListener('change', syncWithOsTheme);
  }, []);

  // Load settings & CLIs
  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setCachedSettings(s);
    }).catch(() => {});

    getClis().then((data) => {
      setClis(data);
      setCachedClis(data);
    }).catch(() => {});
  }, []);

  // Maintain WebSocket connection
  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimeout: any = null;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        setWs(socket);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'task_agent_status') {
            window.dispatchEvent(new CustomEvent('task-agent-status-updated', { detail: data }));
          } else if (data.type === 'hitl_input_required') {
            const taskId = data.taskId;
            if (taskId && isTaskInBackground(taskId, currentTaskIdRef.current)) {
              const cachedTask = getCachedTask(taskId);
              const taskName = data.taskName || cachedTask?.name || 'Task';
              const projectId = data.projectId || cachedTask?.project_id || currentProjectIdRef.current || undefined;
              const cachedProject = projectId ? getCachedProject(projectId) : null;
              const projectName = data.projectName || cachedProject?.name || cachedTask?.project?.name;

              sendTaskNotification({
                taskId,
                projectId,
                projectName,
                taskName,
                type: 'hitl',
                onNavigate: () => {
                  handleNavigate('task', { taskId, projectId });
                  removeUnreadReplyTaskId(taskId);
                },
              });
            }
          } else if (data.type === 'chat_turn_complete') {
            let taskId = data.taskId;
            if (!taskId && data.sessionId) {
              const allTasks = getCachedAllTasks() || [];
              for (const t of allTasks) {
                const chats = getCachedChats(t.id);
                if (chats && chats.some((c) => c.id === data.sessionId)) {
                  taskId = t.id;
                  break;
                }
              }
            }

            if (taskId) {
              const taskQueueCount = getCachedTaskQueuedCount(taskId);
              const sessionQueue = data.sessionId ? getCachedQueuedMessages(data.sessionId) : [];
              const hasQueue = taskQueueCount > 0 || sessionQueue.length > 0;

              if (!hasQueue && isTaskInBackground(taskId, currentTaskIdRef.current)) {
                const cachedTask = getCachedTask(taskId);
                const taskName = data.taskName || cachedTask?.name || 'Task';
                const projectId = data.projectId || cachedTask?.project_id || currentProjectIdRef.current || undefined;
                const cachedProject = projectId ? getCachedProject(projectId) : null;
                const projectName = data.projectName || cachedProject?.name || cachedTask?.project?.name;

                let meta: any = {};
                try {
                  if (typeof data.message?.metadata === 'string') {
                    meta = JSON.parse(data.message.metadata);
                  } else if (data.message?.metadata) {
                    meta = data.message.metadata;
                  }
                } catch {}

                const isError = Boolean(
                  meta.error ||
                  meta.isAuthRequired ||
                  data.message?.content?.startsWith('Error:')
                );

                const hasAskQuestion = Array.isArray(data.steps) && data.steps.some((s: any) =>
                  (s.title && s.title.toLowerCase().includes('ask_question')) ||
                  (s.detail && typeof s.detail === 'string' && s.detail.toLowerCase().includes('ask_question'))
                );

                let notifType: NotificationTriggerType = 'done';
                let detail = data.message?.content || '';

                if (isError) {
                  notifType = 'error';
                  detail = meta.errorMessage || meta.content || data.message?.content || 'Execution failed';
                } else if (hasAskQuestion) {
                  notifType = 'question';
                } else {
                  notifType = 'done';
                }

                sendTaskNotification({
                  taskId,
                  projectId,
                  projectName,
                  taskName,
                  type: notifType,
                  detail,
                  onNavigate: () => {
                    handleNavigate('task', { taskId, projectId });
                    removeUnreadReplyTaskId(taskId);
                  },
                });
              }
            }
          }
        } catch {}
      };

      socket.onclose = () => {
        setWs(null);
        reconnectTimeout = setTimeout(connect, 3000);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      socket?.close();
    };
  }, []);

  // Update active project/task details for breadcrumbs based on URL
  useEffect(() => {
    if (currentProjectId) {
      const cached = getCachedProject(currentProjectId);
      if (cached) setActiveProject(cached);
      getProject(currentProjectId).then((p) => {
        setActiveProject(p);
        setCachedProject(p);
      }).catch(() => {});
    } else if (!currentTaskId) {
      setActiveProject(null);
    }
  }, [currentProjectId, currentTaskId]);

  useEffect(() => {
    if (currentTaskId) {
      const cached = getCachedTask(currentTaskId);
      if (cached) {
        setActiveTask(cached);
        if (cached.project) {
          setActiveProject(cached.project);
          setCachedProject(cached.project);
        }
      }
      getTask(currentTaskId).then((t) => {
        setActiveTask(t);
        setCachedTask(t);
        if (t.project) {
          setActiveProject(t.project);
          setCachedProject(t.project);
        }
      }).catch(() => {});
    } else {
      setActiveTask(null);
    }
  }, [currentTaskId]);

  useEffect(() => {
    const handleTaskUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<Task>;
      if (customEvent.detail && customEvent.detail.id === currentTaskId) {
        setActiveTask(customEvent.detail);
      }
    };
    window.addEventListener('task-updated', handleTaskUpdated);
    return () => window.removeEventListener('task-updated', handleTaskUpdated);
  }, [currentTaskId]);

  const handleNavigate = (page: 'home' | 'project' | 'task' | 'settings', params?: any) => {
    if (page === 'home') {
      navigate('/');
    } else if (page === 'project') {
      if (params?.projectId) navigate(`/projects/${params.projectId}`);
    } else if (page === 'task') {
      if (params?.taskId) {
        const pId = params?.projectId || currentProjectId || activeTask?.project_id;
        if (pId) navigate(`/projects/${pId}/tasks/${params.taskId}`);
        else navigate(`/tasks/${params.taskId}`);
      }
    } else if (page === 'settings') {
      navigate('/settings');
    }
  };

  const handleActiveTaskUpdated = (updatedTask: Task) => {
    setActiveTask(updatedTask);
    setCachedTask(updatedTask);
    window.dispatchEvent(new CustomEvent('task-updated', { detail: updatedTask }));
  };

  const handleTogglePinActiveTask = async () => {
    if (!activeTask) return;
    const nextPinned = !Boolean(activeTask.is_pinned);
    const updated = { ...activeTask, is_pinned: nextPinned ? 1 : 0 };
    handleActiveTaskUpdated(updated);
    try {
      await updateTask(activeTask.id, { is_pinned: nextPinned });
    } catch (err) {
      console.error('Failed to toggle pin on active task:', err);
      handleActiveTaskUpdated(activeTask);
    }
  };

  const performDeleteTask = async (taskToDelete: Task, targetProjectId?: string) => {
    addPendingDeletingTaskId(taskToDelete.id);
    try {
      await deleteTask(taskToDelete.id);
      removePendingDeletingTaskId(taskToDelete.id);
    } catch (err: any) {
      removePendingDeletingTaskId(taskToDelete.id);
      console.error('Failed to delete task in background:', err);
      restoreCachedTask(taskToDelete, targetProjectId);
      window.dispatchEvent(
        new CustomEvent('task-restored', { detail: { task: taskToDelete, projectId: targetProjectId } })
      );

      const errorMsg = err?.message || 'Failed to delete task';
      setToastMessage({
        id: Date.now(),
        type: 'error',
        text: `Failed to delete task "${taskToDelete.name}": ${errorMsg}`,
        onRetry: () => {
          setToastMessage(null);
          addPendingDeletingTaskId(taskToDelete.id);
          deleteCachedTask(taskToDelete.id, targetProjectId);
          window.dispatchEvent(
            new CustomEvent('task-deleted', { detail: { taskId: taskToDelete.id, projectId: targetProjectId } })
          );
          performDeleteTask(taskToDelete, targetProjectId);
        },
      });
    }
  };

  const handleDeleteActiveTask = async () => {
    if (!activeTask) return;
    if (!confirm('Delete this task and clean up its git worktree?')) return;

    const taskToDelete = activeTask;
    const targetProjectId = taskToDelete.project_id || currentProjectId || undefined;

    // Immediately mark as pending delete so any background fetches won't resurrect it
    addPendingDeletingTaskId(taskToDelete.id);

    // Optimistically update cache and UI immediately
    deleteCachedTask(taskToDelete.id, targetProjectId);
    window.dispatchEvent(
      new CustomEvent('task-deleted', { detail: { taskId: taskToDelete.id, projectId: targetProjectId } })
    );
    setActiveTask(null);

    if (targetProjectId) {
      navigate(`/projects/${targetProjectId}`);
    } else {
      navigate('/');
    }

    // Run deletion in background
    performDeleteTask(taskToDelete, targetProjectId);
  };

  return (
    <SubmitProvider ws={ws}>
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-cozy-bg text-cozy-text font-sans">
      <Header
        currentPath={{
          projectId: currentProjectId || activeTask?.project_id || undefined,
          projectName: activeProject?.name || activeTask?.project?.name,
          projectIcon: activeProject?.icon || activeTask?.project?.icon,
          taskId: currentTaskId || undefined,
          taskName: activeTask?.name,
          isPinned: Boolean(activeTask?.is_pinned),
        }}
        onNavigate={handleNavigate}
        settings={settings}
        onEditTask={currentTaskId && activeTask ? () => setIsEditTaskOpen(true) : undefined}
        onTogglePinTask={currentTaskId && activeTask ? handleTogglePinActiveTask : undefined}
        isTaskPinned={Boolean(activeTask?.is_pinned)}
        onDeleteTask={currentTaskId && activeTask ? handleDeleteActiveTask : undefined}
        isDeletingTask={isDeletingTask}
        onConfigureProject={
          currentProjectId
            ? () => {
                window.dispatchEvent(new CustomEvent('open-project-config'));
              }
            : undefined
        }
        onToggleMobileSidebar={() => setIsMobileSidebarOpen((prev) => !prev)}
      />

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        <ErrorBoundary>
          <Routes>
            <Route
              path="/"
              element={
                <HomePage
                  onSelectProject={(id) => navigate(`/projects/${id}`)}
                  settings={settings}
                  ws={ws}
                />
              }
            />

            <Route
              path="/settings"
              element={
                <SettingsPage
                  settings={settings}
                  onUpdateSettings={(s) => setSettings(s)}
                  clis={clis}
                  onRefreshClis={() => getClis().then(setClis).catch(() => {})}
                  ws={ws}
                />
              }
            />

            <Route
              path="/projects/:projectId"
              element={
                <TaskPage
                  settings={settings}
                  clis={clis}
                  ws={ws}
                  onDeleteTask={handleDeleteActiveTask}
                  isDeletingTask={isDeletingTask}
                />
              }
            />

            <Route
              path="/projects/:projectId/tasks/:taskId"
              element={
                <TaskPage
                  settings={settings}
                  clis={clis}
                  ws={ws}
                  onDeleteTask={handleDeleteActiveTask}
                  isDeletingTask={isDeletingTask}
                />
              }
            />

            <Route
              path="/tasks/:taskId"
              element={
                <TaskPage
                  settings={settings}
                  clis={clis}
                  ws={ws}
                  onDeleteTask={handleDeleteActiveTask}
                  isDeletingTask={isDeletingTask}
                />
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>

      {/* Mobile Projects & Tasks Slide-over Drawer */}
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 z-50 flex min-[1200px]:hidden">
          {/* Backdrop overlay */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-hidden="true"
          />
          {/* Drawer container */}
          <div className="relative z-10 w-[85vw] max-w-[320px] h-full bg-cozy-surface dark:bg-[#171717] border-r border-cozy-border shadow-2xl flex flex-col animate-in slide-in-from-left duration-200">
            <ProjectsTasksSidebar
              currentTaskId={currentTaskId || undefined}
              currentProjectId={currentProjectId || activeTask?.project_id || undefined}
              onSelectTask={(selectedTaskId, selectedProjectId, selectedTask) => {
                if (selectedTask) {
                  setActiveTask(selectedTask);
                  setCachedTask(selectedTask);
                }
                const route = selectedProjectId
                  ? `/projects/${selectedProjectId}/tasks/${selectedTaskId}`
                  : `/tasks/${selectedTaskId}`;
                navigate(route, { state: { task: selectedTask } });
                setIsMobileSidebarOpen(false);
              }}
              onConfigureProject={(pId) => {
                window.dispatchEvent(new CustomEvent('open-project-config', { detail: { projectId: pId } }));
                setIsMobileSidebarOpen(false);
              }}
              isCollapsed={false}
              onToggleCollapse={() => setIsMobileSidebarOpen(false)}
              isMobile={true}
              onClose={() => setIsMobileSidebarOpen(false)}
              ws={ws}
            />
          </div>
        </div>
      )}

      {/* Edit Task Modal triggered from Header breadcrumb */}
      {isEditTaskOpen && activeTask && (
        <EditTaskModal
          task={activeTask}
          isOpen={isEditTaskOpen}
          onClose={() => setIsEditTaskOpen(false)}
          onSuccess={handleActiveTaskUpdated}
          projectPath={activeProject?.path || activeTask.project?.path}
        />
      )}

      {/* Floating Top-Right Toast */}
      {toastMessage && (
        <DockItem createdAt={toastMessage.id}>
          <div
            className={`pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-2xl ${
              toastMessage.type === 'error'
                ? 'bg-rose-950/95 dark:bg-rose-950/95 border-rose-500/40 text-rose-100 shadow-rose-950/30'
                : 'bg-cozy-surface/95 dark:bg-zinc-900/95 border-cozy-border/80 text-cozy-text shadow-soft-xl'
            } border text-xs backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200 select-none w-full sm:w-84`}
          >
            <div
              className={`w-5 h-5 rounded-lg flex items-center justify-center shrink-0 ${
                toastMessage.type === 'error'
                  ? 'bg-rose-500/20 text-rose-400'
                  : 'bg-teal-500/10 text-teal-600 dark:text-teal-400'
              }`}
            >
              {toastMessage.type === 'error' ? (
                <AlertCircle className="w-3.5 h-3.5" />
              ) : (
                <Square className="w-3 h-3 fill-current" />
              )}
            </div>
            <span className="font-medium flex-1 truncate" title={toastMessage.text}>
              {toastMessage.text}
            </span>
            {toastMessage.onRetry && (
              <button
                type="button"
                onClick={toastMessage.onRetry}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs transition-colors shrink-0 cursor-pointer shadow-xs"
              >
                <RotateCw className="w-3 h-3" />
                <span>Retry</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="p-1 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-border/40 transition-colors ml-1 shrink-0 cursor-pointer"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </DockItem>
      )}
    </div>
    </SubmitProvider>
  );
}
