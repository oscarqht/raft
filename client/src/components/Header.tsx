import React from 'react';
import { Terminal, Sparkles, Settings as SettingsIcon, Sun, Moon, Home, ChevronRight, FolderGit2 } from 'lucide-react';
import { Settings } from '../types';

interface HeaderProps {
  currentPath?: {
    projectId?: string;
    projectName?: string;
    taskId?: string;
    taskName?: string;
  };
  onNavigate: (page: 'home' | 'project' | 'task' | 'settings', params?: any) => void;
  settings: Settings | null;
  onToggleTheme: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentPath,
  onNavigate,
  settings,
  onToggleTheme,
}) => {
  return (
    <header className="h-14 border-b border-cozy-border bg-cozy-surface/80 backdrop-blur px-4 flex items-center justify-between shrink-0 select-none">
      {/* Left: Brand & Breadcrumbs */}
      <div className="flex items-center space-x-3 text-sm">
        <button
          onClick={() => onNavigate('home')}
          className="flex items-center space-x-2 text-sky-400 font-semibold hover:text-sky-300 transition-colors"
        >
          <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-sky-400" />
          </div>
          <span className="text-base tracking-tight text-white flex items-center gap-1.5 font-medium">
            termai
            <Sparkles className="w-3.5 h-3.5 text-amber-400 inline" />
          </span>
        </button>

        {currentPath?.projectName && (
          <div className="flex items-center space-x-2 text-cozy-muted">
            <ChevronRight className="w-4 h-4 text-cozy-border" />
            <button
              onClick={() => onNavigate('project', { projectId: currentPath.projectId })}
              className="flex items-center gap-1.5 hover:text-cozy-text transition-colors max-w-[160px] truncate"
            >
              <FolderGit2 className="w-3.5 h-3.5 text-cozy-muted" />
              <span className="truncate">{currentPath.projectName}</span>
            </button>
          </div>
        )}

        {currentPath?.taskName && (
          <div className="flex items-center space-x-2 text-cozy-muted">
            <ChevronRight className="w-4 h-4 text-cozy-border" />
            <span className="text-cozy-text font-medium max-w-[180px] truncate">
              {currentPath.taskName}
            </span>
          </div>
        )}
      </div>

      {/* Right: Agent Status & Controls */}
      <div className="flex items-center space-x-2.5">
        {settings && (
          <button
            onClick={() => onNavigate('settings')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono bg-cozy-subtle border border-cozy-border text-cozy-muted hover:text-cozy-text hover:border-sky-500/30 transition-all"
            title="Active AI Agent CLI"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <span className="font-semibold text-sky-400">{settings.agent_cli}</span>
            <span className="text-cozy-border">|</span>
            <span className="text-cozy-muted truncate max-w-[120px]">{settings.default_model || 'default'}</span>
          </button>
        )}

        <button
          onClick={onToggleTheme}
          className="p-1.5 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle border border-transparent hover:border-cozy-border transition-colors"
          title="Toggle theme"
        >
          {settings?.theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>

        <button
          onClick={() => onNavigate('settings')}
          className="p-1.5 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle border border-transparent hover:border-cozy-border transition-colors"
          title="Settings"
        >
          <SettingsIcon className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
