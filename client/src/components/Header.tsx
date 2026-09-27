import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, Settings as SettingsIcon, ChevronRight, FolderGit2, Pencil, Plus } from 'lucide-react';
import { Settings } from '../types';
import { TaskQuickSwitcher } from './TaskQuickSwitcher';

interface HeaderProps {
  currentPath?: {
    projectId?: string;
    projectName?: string;
    projectIcon?: string;
    taskId?: string;
    taskName?: string;
  };
  onNavigate?: (page: 'home' | 'project' | 'task' | 'settings', params?: any) => void;
  settings: Settings | null;
  onEditTask?: () => void;
  onNewTask?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentPath,
  onNavigate,
  settings,
  onEditTask,
  onNewTask,
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

  return (
    <header className="relative z-40 h-16 border-b border-cozy-border/60 glass-panel px-4 sm:px-6 flex items-center justify-between shrink-0 select-none gap-3 shadow-soft-sm">
      {/* Left: Brand & Breadcrumbs */}
      <div className="flex items-center space-x-2 sm:space-x-3 text-sm min-w-0">
        <Link
          to="/"
          onClick={() => onNavigate?.('home')}
          className="flex items-center space-x-2.5 text-cozy-text font-semibold hover:opacity-90 transition-all shrink-0 group"
        >
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-teal-500/20 via-cyan-500/15 to-sky-500/20 border border-teal-400/30 flex items-center justify-center overflow-hidden shrink-0 shadow-soft-sm group-hover:scale-105 transition-transform">
            <img src="/logo.png" alt="Raft logo" className="w-6 h-6 object-contain drop-shadow-sm" />
          </div>
          <span className="text-lg tracking-tight font-semibold text-cozy-text flex items-center gap-1.5">
            Raft
            <Sparkles className="w-4 h-4 text-teal-400 fill-teal-400/20 inline animate-pulse" />
          </span>
        </Link>

        {currentPath?.projectName && currentPath?.projectId && (
          <div className="hidden min-[920px]:flex items-center space-x-2 text-cozy-muted min-w-0">
            <ChevronRight className="w-4 h-4 text-cozy-border/80 shrink-0" />
            <Link
              to={`/projects/${currentPath.projectId}`}
              onClick={() => onNavigate?.('project', { projectId: currentPath.projectId })}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-cozy-subtle/70 hover:bg-cozy-subtle border border-cozy-border/60 hover:border-teal-400/30 text-cozy-text hover:text-teal-600 dark:hover:text-teal-400 transition-all max-w-[120px] sm:max-w-[200px] truncate shadow-soft-sm text-xs font-medium"
            >
              {currentPath.projectIcon ? (
                <span className="text-sm shrink-0 leading-none">{currentPath.projectIcon}</span>
              ) : (
                <FolderGit2 className="w-3.5 h-3.5 text-teal-500 shrink-0 hidden sm:inline" />
              )}
              <span className="truncate">{currentPath.projectName}</span>
            </Link>
          </div>
        )}

        {currentPath?.taskName && (
          <div className="hidden min-[920px]:flex items-center space-x-2 text-cozy-muted min-w-0">
            <ChevronRight className="w-4 h-4 text-cozy-border/80 shrink-0" />
            <button
              type="button"
              onClick={onEditTask}
              disabled={!onEditTask}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full bg-cozy-subtle/70 hover:bg-cozy-subtle border border-cozy-border/60 hover:border-teal-400/30 transition-all text-left shadow-soft-sm text-xs font-medium ${
                onEditTask ? 'group cursor-pointer' : 'cursor-default'
              }`}
              title={onEditTask ? 'Click to edit task details' : undefined}
            >
              <span className="text-cozy-text font-medium max-w-[100px] sm:max-w-[220px] truncate group-hover:text-teal-600 dark:group-hover:text-teal-400">
                {currentPath.taskName}
              </span>
              {onEditTask && (
                <Pencil className="w-3 h-3 text-cozy-muted opacity-0 group-hover:opacity-100 group-hover:text-teal-400 transition-opacity shrink-0 hidden sm:inline" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* Right: Task Switcher, Agent Status & Controls */}
      <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
        {onNewTask && (
          <button
            type="button"
            onClick={onNewTask}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white transition-all shadow-glow-ocean cursor-pointer shrink-0"
            title="Start a new task in this project"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Start New Task</span>
          </button>
        )}

        <TaskQuickSwitcher
          currentTaskId={currentPath?.taskId}
          currentTaskName={currentPath?.taskName}
          onNavigate={handleNav}
        />

        {settings && (
          <Link
            to="/settings"
            onClick={() => onNavigate?.('settings')}
            className="hidden min-[920px]:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-cozy-subtle/80 hover:bg-cozy-subtle border border-cozy-border/80 hover:border-teal-400/40 text-cozy-muted hover:text-cozy-text shadow-soft-sm transition-all shrink-0"
            title="Active AI Agent CLI"
          >
            <span className="w-2 h-2 rounded-full bg-teal-400 shadow-glow-ocean"></span>
            <span className="font-semibold text-teal-600 dark:text-teal-400">{settings.agent_cli}</span>
            <span className="text-cozy-border/80 hidden sm:inline">•</span>
            <span className="text-cozy-muted truncate max-w-[130px] hidden sm:inline">{settings.default_model || 'default'}</span>
          </Link>
        )}

        <Link
          to="/settings"
          onClick={() => onNavigate?.('settings')}
          className="w-9 h-9 rounded-full bg-cozy-subtle/80 hover:bg-cozy-surface border border-cozy-border/70 hover:border-teal-400/30 shadow-soft-sm flex items-center justify-center text-cozy-muted hover:text-teal-600 dark:hover:text-teal-400 transition-all"
          title="Settings"
        >
          <SettingsIcon className="w-4 h-4" />
        </Link>
      </div>
    </header>
  );
};
