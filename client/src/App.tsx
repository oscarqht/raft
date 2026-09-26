import React, { useState, useEffect } from 'react';
import { Settings, CliInfo, Project, Task } from './types';
import { getSettings, getClis, getProject, getTask, updateSettings } from './api';
import { Header } from './components/Header';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { TaskPage } from './pages/TaskPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  const [currentPage, setCurrentPage] = useState<'home' | 'project' | 'task' | 'settings'>('home');
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [clis, setClis] = useState<CliInfo[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);

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

  // Update active project/task details for breadcrumbs
  useEffect(() => {
    if (currentProjectId) {
      getProject(currentProjectId).then(setActiveProject).catch(() => {});
    } else {
      setActiveProject(null);
    }
  }, [currentProjectId]);

  useEffect(() => {
    if (currentTaskId) {
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
      setCurrentProjectId(null);
      setCurrentTaskId(null);
    } else if (page === 'project') {
      if (params?.projectId) setCurrentProjectId(params.projectId);
      setCurrentTaskId(null);
    } else if (page === 'task') {
      if (params?.taskId) setCurrentTaskId(params.taskId);
    }
    setCurrentPage(page);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-cozy-bg text-cozy-text font-sans">
      <Header
        currentPath={{
          projectId: currentProjectId || undefined,
          projectName: activeProject?.name,
          taskId: currentTaskId || undefined,
          taskName: activeTask?.name,
        }}
        onNavigate={handleNavigate}
        settings={settings}
      />

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {currentPage === 'home' && (
          <HomePage
            onSelectProject={(id) => handleNavigate('project', { projectId: id })}
            settings={settings}
            ws={ws}
          />
        )}

        {currentPage === 'project' && currentProjectId && (
          <ProjectPage
            projectId={currentProjectId}
            onBack={() => handleNavigate('home')}
            onSelectTask={(id) => handleNavigate('task', { taskId: id })}
          />
        )}

        {currentPage === 'task' && currentTaskId && (
          <TaskPage
            taskId={currentTaskId}
            settings={settings}
            clis={clis}
            ws={ws}
          />
        )}

        {currentPage === 'settings' && settings && (
          <SettingsPage
            settings={settings}
            onUpdateSettings={(s) => setSettings(s)}
            clis={clis}
            onRefreshClis={() => getClis().then(setClis).catch(() => {})}
            onBack={() => {
              if (currentTaskId) handleNavigate('task', { taskId: currentTaskId });
              else if (currentProjectId) handleNavigate('project', { projectId: currentProjectId });
              else handleNavigate('home');
            }}
          />
        )}
      </main>
    </div>
  );
}
