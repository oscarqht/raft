import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, Settings as SettingsIcon, ChevronRight, FolderGit2, Pencil, Plus, Trash2, Loader2, Pin, Sliders } from 'lucide-react';
import { Settings, TaskGitStatus } from '../types';
import { getTaskGitStatus } from '../api';
import { TaskStatusBadges } from './TaskStatusBadges';
import { HeaderUpdater } from './HeaderUpdater';
import { ProjectIcon } from './ProjectIcon';
import { getCachedTaskGitStatus, setCachedTaskGitStatus } from '../cache';

interface HeaderProps {
  currentPath?: {
    projectId?: string;
    projectName?: string;
    projectIcon?: string;
    taskId?: string;
    taskName?: string;
    isPinned?: boolean;
  };
  onNavigate?: (page: 'home' | 'project' | 'task' | 'settings', params?: any) => void;
  settings: Settings | null;
  onEditTask?: () => void;
  onTogglePinTask?: () => void;
  isTaskPinned?: boolean;
  onDeleteTask?: () => void;
  isDeletingTask?: boolean;
  onNewTask?: () => void;
  onConfigureProject?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentPath,
  onNavigate,
  settings,
  onEditTask,
  onTogglePinTask,
  isTaskPinned,
  onDeleteTask,
  isDeletingTask,
  onNewTask,
  onConfigureProject,
}) => {
  const navigate = useNavigate();

  const handleNav = (page: 'home' | 'project' | 'task' | 'settings', params?: any) => {
    if (onNavigate) {
      onNavigate(page, params);
      return;
    }
    if (page === 'home') navigate('/');
    else if (page === 'settings') navigate('/settings');
    else if (page === 'project' && params?.projectId) navigate(`/projects/${params.projectId}`);
    else if (page === 'task' && params?.taskId) {
      if (params?.projectId || currentPath?.projectId) {
        navigate(`/projects/${params?.projectId || currentPath?.projectId}/tasks/${params.taskId}`);
      } else {
        navigate(`/tasks/${params.taskId}`);
      }
    }
  };

  const [taskStatus, setTaskStatus] = useState<TaskGitStatus | null>(() => {
    return currentPath?.taskId ? getCachedTaskGitStatus(currentPath.taskId) : null;
  });
  const [loadingStatus, setLoadingStatus] = useState(false);

  const fetchTaskStatus = useCallback(async (force = false) => {
    if (!currentPath?.taskId) {
      setTaskStatus(null);
      return;
    }
    setLoadingStatus(true);
    try {
      const s = await getTaskGitStatus(currentPath.taskId, force);
      setTaskStatus(s);
      if (currentPath?.taskId) {
        setCachedTaskGitStatus(currentPath.taskId, s, currentPath.projectId);
      }
    } catch {}
    finally {
      setLoadingStatus(false);
    }
  }, [currentPath?.taskId, currentPath?.projectId]);

  useEffect(() => {
    if (currentPath?.taskId) {
      const cached = getCachedTaskGitStatus(currentPath.taskId);
      if (cached) {
        setTaskStatus(cached);
      }
    }
    fetchTaskStatus(false);
  }, [fetchTaskStatus, currentPath?.taskId]);

  useEffect(() => {
    const handleFocus = () => fetchTaskStatus(false);
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchTaskStatus(false);
      }
    };
    const handleStatusUpdate = (e: any) => {
      if (!e.detail?.taskId || e.detail.taskId === currentPath?.taskId) {
        fetchTaskStatus(true);
      }
    };
    const handleAgentStatusUpdate = (e: any) => {
      if (e.detail?.taskId === currentPath?.taskId && e.detail?.agentStatus) {
        setTaskStatus((prev) => (prev ? { ...prev, agent_status: e.detail.agentStatus } : prev));
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('task-status-updated', handleStatusUpdate);
    window.addEventListener('task-agent-status-updated', handleAgentStatusUpdate);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      fetchTaskStatus(false);
    }, 60000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('task-status-updated', handleStatusUpdate);
      window.removeEventListener('task-agent-status-updated', handleAgentStatusUpdate);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [fetchTaskStatus, currentPath?.taskId]);



  return (
    <header className="relative z-40 h-12 border-b border-cozy-border bg-cozy-surface px-3 sm:px-4 flex items-center justify-between shrink-0 select-none gap-3">
      {/* Left: Brand & Breadcrumbs */}
      <div className="flex items-center space-x-1.5 sm:space-x-2 text-sm min-w-0">
        <Link
          to="/"
          className="flex items-center space-x-2 text-cozy-text font-semibold hover:opacity-85 transition-opacity shrink-0 group mr-1"
        >
          <div className="w-7 h-7 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center overflow-hidden shrink-0">
            <img src="/logo.png" alt="Alpha Bro logo" className="w-5 h-5 object-contain" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-cozy-text flex items-center gap-1">
            Alpha Bro
          </span>
        </Link>

        {currentPath?.projectName && currentPath?.projectId && (
          <div className="hidden min-[1200px]:flex items-center space-x-1.5 text-cozy-muted min-w-0">
            <span className="text-cozy-border select-none">/</span>
            <div className="flex items-center gap-1 min-w-0">
              <Link
                to={`/projects/${currentPath.projectId}`}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-cozy-subtle text-cozy-text hover:text-teal-600 dark:hover:text-teal-400 transition-colors max-w-[140px] sm:max-w-[200px] truncate text-xs font-medium"
              >
                <ProjectIcon icon={currentPath.projectIcon} className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{currentPath.projectName}</span>
              </Link>
              {onConfigureProject && (
                <button
                  type="button"
                  onClick={onConfigureProject}
                  className="w-5 h-5 rounded-md hover:bg-cozy-subtle flex items-center justify-center text-cozy-muted hover:text-teal-600 dark:hover:text-teal-400 transition-colors cursor-pointer shrink-0"
                  title="Configure project settings"
                  aria-label="Configure project settings"
                >
                  <Sliders className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {currentPath?.taskName && (
          <div className="hidden min-[1200px]:flex items-center space-x-1.5 text-cozy-muted min-w-0">
            <span className="text-cozy-border select-none">/</span>
            <div className="flex items-center gap-1.5 min-w-0 flex-nowrap">
              <button
                type="button"
                onClick={onEditTask}
                disabled={!onEditTask || isDeletingTask}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-cozy-subtle transition-colors text-left text-xs font-medium shrink-0 ${
                  onEditTask && !isDeletingTask ? 'group cursor-pointer' : 'cursor-default'
                }`}
                title={onEditTask ? 'Click to edit task details' : undefined}
              >
                <span className="text-cozy-text font-medium max-w-[120px] sm:max-w-[220px] truncate group-hover:text-teal-600 dark:group-hover:text-teal-400">
                  {currentPath.taskName}
                </span>
                {onEditTask && (
                  <Pencil className="w-3 h-3 text-cozy-muted opacity-0 group-hover:opacity-100 group-hover:text-teal-400 transition-opacity shrink-0" />
                )}
              </button>

              {onTogglePinTask && (
                <button
                  type="button"
                  onClick={onTogglePinTask}
                  className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                    isTaskPinned
                      ? 'text-amber-500 hover:text-amber-600 dark:text-amber-400 bg-amber-500/10'
                      : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle'
                  }`}
                  title={isTaskPinned ? 'Unpin task' : 'Pin task'}
                  aria-label={isTaskPinned ? 'Unpin task' : 'Pin task'}
                >
                  <Pin className={`w-3.5 h-3.5 ${isTaskPinned ? 'fill-current' : ''}`} />
                </button>
              )}

              <TaskStatusBadges
                status={taskStatus}
                loading={loadingStatus}
                compact={false}
                onOpenSubmit={() => window.dispatchEvent(new CustomEvent('open-submit-modal'))}
                onRefresh={() => fetchTaskStatus(true)}
                className="flex-nowrap shrink-0"
              />

              {onDeleteTask && (
                <button
                  type="button"
                  onClick={onDeleteTask}
                  disabled={isDeletingTask}
                  className="w-6 h-6 rounded-md hover:bg-red-500/10 flex items-center justify-center text-cozy-muted hover:text-red-500 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                  title="Delete task and clean up git worktree"
                >
                  {isDeletingTask ? (
                    <Loader2 className="w-3 h-3 animate-spin text-red-500" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right: Task Switcher, Agent Status & Controls */}
      <div className="flex items-center space-x-2 shrink-0">
        {currentPath?.taskId && taskStatus && (
          <div className="hidden sm:flex min-[1200px]:hidden items-center shrink-0">
            <TaskStatusBadges
              status={taskStatus}
              loading={loadingStatus}
              compact={true}
              onOpenSubmit={() => window.dispatchEvent(new CustomEvent('open-submit-modal'))}
              className="flex-nowrap shrink-0"
            />
          </div>
        )}

        {onNewTask && (
          <button
            type="button"
            onClick={onNewTask}
            className="h-7 flex items-center gap-1.5 px-3 rounded-lg text-xs font-medium bg-teal-500 hover:bg-teal-600 text-white transition-colors cursor-pointer shrink-0"
            title="Start a new task in this project"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Task</span>
            <span className="sm:hidden">New</span>
          </button>
        )}

        {currentPath?.taskId && onTogglePinTask && (
          <button
            type="button"
            onClick={onTogglePinTask}
            className={`hidden sm:flex min-[1200px]:hidden w-7 h-7 rounded-md items-center justify-center transition-colors cursor-pointer shrink-0 ${
              isTaskPinned
                ? 'text-amber-500 hover:text-amber-600 dark:text-amber-400 bg-amber-500/10'
                : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle'
            }`}
            title={isTaskPinned ? 'Unpin task' : 'Pin task'}
            aria-label={isTaskPinned ? 'Unpin task' : 'Pin task'}
          >
            <Pin className={`w-3.5 h-3.5 ${isTaskPinned ? 'fill-current' : ''}`} />
          </button>
        )}

        {currentPath?.taskId && onDeleteTask && (
          <button
            type="button"
            onClick={onDeleteTask}
            disabled={isDeletingTask}
            className="hidden sm:flex min-[1200px]:hidden w-7 h-7 rounded-md hover:bg-red-500/10 items-center justify-center text-cozy-muted hover:text-red-500 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            title="Delete task and clean up git worktree"
          >
            {isDeletingTask ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
          </button>
        )}

        {settings && (
          <Link
            to="/settings"
            className="hidden min-[1200px]:flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-xs font-medium bg-cozy-subtle hover:bg-cozy-subtle/80 text-cozy-muted hover:text-cozy-text transition-colors shrink-0"
            title="Active AI Agent CLI"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
            <span className="font-medium text-teal-600 dark:text-teal-400">{settings.agent_cli}</span>
            {settings.agent_cli?.toLowerCase() !== 'alpha' && (
              <>
                <span className="text-cozy-border hidden sm:inline">•</span>
                <span className="text-cozy-muted truncate max-w-[130px] hidden sm:inline">{settings.default_model || 'default'}</span>
              </>
            )}
          </Link>
        )}

        <div className="hidden sm:inline-flex items-center">
          <HeaderUpdater />
        </div>

        <Link
          to="/settings"
          className="w-7 h-7 rounded-lg hover:bg-cozy-subtle flex items-center justify-center text-cozy-muted hover:text-cozy-text transition-colors"
          title="Settings"
        >
          <SettingsIcon className="w-4 h-4" />
        </Link>
      </div>
    </header>
  );
};
