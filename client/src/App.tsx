import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, matchPath } from 'react-router-dom';
import { Settings, CliInfo, Project, Task } from './types';
import { getSettings, getClis, getProject, getTask, deleteTask } from './api';
import { getCachedTask, setCachedTask, deleteCachedTask } from './cache';
import { Header } from './components/Header';
import { EditTaskModal } from './components/EditTaskModal';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { TaskPage } from './pages/TaskPage';
import { SettingsPage } from './pages/SettingsPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loader2, Square, X } from 'lucide-react';

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();

  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [isEditTaskOpen, setIsEditTaskOpen] = useState(false);
  const [isDeletingTask, setIsDeletingTask] = useState(false);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [clis, setClis] = useState<CliInfo[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [toastMessage, setToastMessage] = useState<{ id: number; text: string } | null>(null);

  useEffect(() => {
    const handleToast = (e: Event) => {
      const customEvent = e as CustomEvent<{ taskId: string; taskName?: string }>;
      const taskName = customEvent.detail?.taskName || 'Task';
      const text = `Dev server stopped for ${taskName}`;
      const toastId = Date.now();
      setToastMessage({ id: toastId, text });
      setTimeout(() => {
        setToastMessage((cur) => (cur?.id === toastId ? null : cur));
      }, 3500);
    };

    window.addEventListener('show-dev-server-stopped-toast', handleToast);
    return () => window.removeEventListener('show-dev-server-stopped-toast', handleToast);
  }, []);

  // Extract current project/task IDs from URL pathname
  const projectTaskMatch = matchPath('/projects/:projectId/tasks/:taskId', location.pathname);
  const projectMatch = matchPath('/projects/:projectId', location.pathname);
  const taskMatch = matchPath('/tasks/:taskId', location.pathname);

  const currentProjectId = projectTaskMatch?.params.projectId || projectMatch?.params.projectId || null;
  const currentTaskId = projectTaskMatch?.params.taskId || taskMatch?.params.taskId || null;

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
    }).catch(() => {});

    getClis().then(setClis).catch(() => {});
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
      getProject(currentProjectId).then(setActiveProject).catch(() => {});
    } else if (!currentTaskId) {
      setActiveProject(null);
    }
  }, [currentProjectId, currentTaskId]);

  useEffect(() => {
    if (currentTaskId) {
      const cached = getCachedTask(currentTaskId);
      if (cached) {
        setActiveTask(cached);
        if (cached.project) setActiveProject(cached.project);
      }
      getTask(currentTaskId).then((t) => {
        setActiveTask(t);
        if (t.project) setActiveProject(t.project);
      }).catch(() => {});
    } else {
      setActiveTask(null);
    }
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

  const handleDeleteActiveTask = async () => {
    if (!activeTask || isDeletingTask) return;
    if (!confirm('Delete this task and clean up its git worktree?')) return;

    setIsDeletingTask(true);
    try {
      await deleteTask(activeTask.id);
      deleteCachedTask(activeTask.id);
      const targetProjectId = activeTask.project_id || currentProjectId;
      setActiveTask(null);
      if (targetProjectId) {
        navigate(`/projects/${targetProjectId}`);
      } else {
        navigate('/');
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to delete task');
    } finally {
      setIsDeletingTask(false);
    }
  };

  const isProjectPage = Boolean(projectMatch && !projectTaskMatch);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-cozy-bg text-cozy-text font-sans">
      <Header
        currentPath={{
          projectId: currentProjectId || activeTask?.project_id || undefined,
          projectName: activeProject?.name || activeTask?.project?.name,
          projectIcon: activeProject?.icon || activeTask?.project?.icon,
          taskId: currentTaskId || undefined,
          taskName: activeTask?.name,
        }}
        onNavigate={handleNavigate}
        settings={settings}
        onEditTask={currentTaskId && activeTask ? () => setIsEditTaskOpen(true) : undefined}
        onDeleteTask={currentTaskId && activeTask ? handleDeleteActiveTask : undefined}
        isDeletingTask={isDeletingTask}
        onNewTask={isProjectPage ? () => window.dispatchEvent(new CustomEvent('open-new-task')) : undefined}
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
                <ProjectPage
                  onBack={() => navigate('/')}
                  onSelectTask={(taskId, task) => {
                    if (currentProjectId) {
                      navigate(`/projects/${currentProjectId}/tasks/${taskId}`, { state: { task } });
                    }
                  }}
                  settings={settings}
                  ws={ws}
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

      {/* Deleting Task Overlay */}
      {isDeletingTask && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 select-none">
          <div className="bg-cozy-surface border border-cozy-border/80 shadow-soft-2xl rounded-2.5xl p-6 flex flex-col items-center text-center max-w-sm mx-4 animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-3 text-red-500 shadow-soft-sm">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
            <h3 className="text-sm font-semibold text-cozy-text mb-1">Deleting Task</h3>
            <p className="text-xs text-cozy-muted leading-relaxed">
              Cleaning up git worktree and removing task data... Please wait.
            </p>
          </div>
        </div>
      )}

      {/* Floating Bottom Dev Server Stopped Toast */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-cozy-surface/95 dark:bg-zinc-900/95 border border-cozy-border/80 shadow-soft-xl text-xs text-cozy-text backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200 select-none">
          <div className="w-5 h-5 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
            <Square className="w-3 h-3 fill-current" />
          </div>
          <span className="font-medium text-cozy-text">{toastMessage.text}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="p-1 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-border/40 transition-colors ml-1"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
