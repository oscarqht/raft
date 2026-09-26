import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, matchPath } from 'react-router-dom';
import { Settings, CliInfo, Project, Task } from './types';
import { getSettings, getClis, getProject, getTask } from './api';
import { getCachedTask } from './cache';
import { Header } from './components/Header';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { TaskPage } from './pages/TaskPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();

  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [clis, setClis] = useState<CliInfo[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);

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
        document.documentElement.style.backgroundColor = '#0f1117';
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.style.backgroundColor = '#f8fafc';
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

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-cozy-bg text-cozy-text font-sans">
      <Header
        currentPath={{
          projectId: currentProjectId || activeTask?.project_id || undefined,
          projectName: activeProject?.name || activeTask?.project?.name,
          taskId: currentTaskId || undefined,
          taskName: activeTask?.name,
        }}
        onNavigate={handleNavigate}
        settings={settings}
      />

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
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
                onBack={() => {
                  if (window.history.length > 1) navigate(-1);
                  else navigate('/');
                }}
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
              />
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
