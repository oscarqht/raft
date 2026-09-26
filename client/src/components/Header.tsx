import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Terminal, Sparkles, Settings as SettingsIcon, ChevronRight, FolderGit2, Pencil } from 'lucide-react';
import { Settings } from '../types';

interface HeaderProps {
  currentPath?: {
    projectId?: string;
    projectName?: string;
    taskId?: string;
    taskName?: string;
  };
  onNavigate?: (page: 'home' | 'project' | 'task' | 'settings', params?: any) => void;
  settings: Settings | null;
  onEditTask?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentPath,
  onNavigate,
  settings,
  onEditTask,
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
    <header className="h-14 border-b border-cozy-border bg-cozy-surface/80 backdrop-blur px-4 flex items-center justify-between shrink-0 select-none">
      {/* Left: Brand & Breadcrumbs */}
      <div className="flex items-center space-x-3 text-sm">
        <Link
          to="/"
          onClick={() => onNavigate?.('home')}
          className="flex items-center space-x-2 text-sky-400 font-semibold hover:text-sky-300 transition-colors"
        >
          <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-sky-400" />
          </div>
          <span className="text-base tracking-tight text-cozy-text flex items-center gap-1.5 font-medium">
            termai
            <Sparkles className="w-3.5 h-3.5 text-amber-400 inline" />
          </span>
        </Link>

        {currentPath?.projectName && currentPath?.projectId && (
          <div className="flex items-center space-x-2 text-cozy-muted">
            <ChevronRight className="w-4 h-4 text-cozy-border" />
            <Link
              to={`/projects/${currentPath.projectId}`}
              onClick={() => onNavigate?.('project', { projectId: currentPath.projectId })}
              className="flex items-center gap-1.5 hover:text-cozy-text transition-colors max-w-[160px] truncate"
            >
              <FolderGit2 className="w-3.5 h-3.5 text-cozy-muted" />
              <span className="truncate">{currentPath.projectName}</span>
            </Link>
          </div>
        )}

        {currentPath?.taskName && (
          <div className="flex items-center space-x-2 text-cozy-muted">
            <ChevronRight className="w-4 h-4 text-cozy-border" />
            <button
              type="button"
              onClick={onEditTask}
              disabled={!onEditTask}
              className={`flex items-center gap-1.5 ${
                onEditTask ? 'group cursor-pointer hover:text-sky-400' : 'cursor-default'
              } transition-colors text-left`}
              title={onEditTask ? 'Click to edit task details' : undefined}
            >
              <span className="text-cozy-text font-medium max-w-[200px] truncate group-hover:text-sky-400">
                {currentPath.taskName}
              </span>
              {onEditTask && (
                <Pencil className="w-3 h-3 text-cozy-muted opacity-0 group-hover:opacity-100 group-hover:text-sky-400 transition-opacity shrink-0" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* Right: Agent Status & Controls */}
      <div className="flex items-center space-x-2.5">
        {settings && (
          <Link
            to="/settings"
            onClick={() => onNavigate?.('settings')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono bg-cozy-subtle border border-cozy-border text-cozy-muted hover:text-cozy-text hover:border-sky-500/30 transition-all"
            title="Active AI Agent CLI"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <span className="font-semibold text-sky-400">{settings.agent_cli}</span>
            <span className="text-cozy-border">|</span>
            <span className="text-cozy-muted truncate max-w-[120px]">{settings.default_model || 'default'}</span>
          </Link>
        )}

        <Link
          to="/settings"
          onClick={() => onNavigate?.('settings')}
          className="p-1.5 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle border border-transparent hover:border-cozy-border transition-colors"
          title="Settings"
        >
          <SettingsIcon className="w-4 h-4" />
        </Link>
      </div>
    </header>
  );
};
