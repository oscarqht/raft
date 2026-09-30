import React, { useState, useEffect, useRef } from 'react';
import { GitBranch, Sparkles, Sliders, Loader2, ArrowRight, FolderGit2 } from 'lucide-react';
import { Project } from '../types';
import { ProjectIcon } from './ProjectIcon';

interface NewTaskPaneProps {
  project: Project;
  availableBranches: string[];
  baseBranch: string;
  onBaseBranchChange: (branch: string) => void;
  onOpenProjectConfig: () => void;
  onCreateTask: (taskName: string, baseBranch: string, initialPrompt: string) => Promise<void>;
  isCreating: boolean;
  error?: string | null;
}

export const NewTaskPane: React.FC<NewTaskPaneProps> = ({
  project,
  availableBranches,
  baseBranch,
  onBaseBranchChange,
  onOpenProjectConfig,
  onCreateTask,
  isCreating,
  error: externalError,
}) => {
  const [taskName, setTaskName] = useState('');
  const [initialPrompt, setInitialPrompt] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [project.id]);

  useEffect(() => {
    const handleReset = () => {
      setTaskName('');
      setInitialPrompt('');
      setLocalError(null);
      inputRef.current?.focus();
    };
    window.addEventListener('reset-new-task-form', handleReset);
    return () => window.removeEventListener('reset-new-task-form', handleReset);
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmedName = taskName.trim();
    if (!trimmedName) {
      setLocalError('Please provide a task name or feature slug');
      inputRef.current?.focus();
      return;
    }
    setLocalError(null);
    try {
      await onCreateTask(trimmedName, baseBranch || project.branch_convention || 'main', initialPrompt.trim());
    } catch (err: any) {
      setLocalError(err?.message || 'Failed to create task');
    }
  };

  const error = externalError || localError;

  return (
    <div className="flex-1 h-full overflow-y-auto flex flex-col items-center justify-center p-4 sm:p-6 md:p-8 bg-cozy-bg select-none">
      <div className="w-full max-w-xl animate-in fade-in zoom-in-95 duration-200">
        {/* Project Header Card */}
        <div className="mb-5 flex items-center justify-between p-3.5 sm:p-4 rounded-2xl bg-cozy-surface border border-cozy-border/70 shadow-soft-sm">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center p-1.5 shrink-0 shadow-soft-sm">
              <ProjectIcon icon={project.icon} className="w-full h-full drop-shadow-sm" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-cozy-text truncate">{project.name}</h2>
              <p className="text-[11px] font-mono text-cozy-muted truncate" title={project.path}>
                {project.path}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenProjectConfig}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-cozy-muted hover:text-cozy-text bg-cozy-subtle/80 hover:bg-cozy-subtle border border-cozy-border/60 transition-all cursor-pointer shrink-0 shadow-soft-xs"
            title="Configure project settings & custom scripts"
          >
            <Sliders className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            <span className="hidden sm:inline">Project Settings</span>
          </button>
        </div>

        {/* Main Task Creator Box */}
        <div className="rounded-squircle bg-cozy-surface border border-cozy-border shadow-soft-xl p-6 sm:p-7">
          <div className="mb-5">
            <h1 className="text-base sm:text-lg font-bold text-cozy-text flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              Start New Coding Task
            </h1>
            <p className="text-xs text-cozy-muted mt-1 leading-relaxed">
              Raft will create an isolated git worktree branch so your agent can code safely without conflicts.
            </p>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-500 flex items-center gap-2">
              <span className="font-semibold">Error:</span>
              <span className="truncate">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Base Branch Selection */}
            <div>
              <label className="text-xs font-semibold text-cozy-text flex items-center gap-1.5 mb-1.5">
                <GitBranch className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                Base Branch
              </label>
              <div className="relative">
                <select
                  value={baseBranch}
                  onChange={(e) => onBaseBranchChange(e.target.value)}
                  disabled={isCreating}
                  className="w-full bg-cozy-bg border border-cozy-border rounded-xl px-3.5 py-2.5 text-xs font-mono text-cozy-text focus:outline-none focus:border-teal-500 transition-colors cursor-pointer appearance-none disabled:opacity-50"
                >
                  {availableBranches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-cozy-muted text-[10px]">
                  ▼
                </div>
              </div>
            </div>

            {/* Task Name Input */}
            <div>
              <label className="text-xs font-semibold text-cozy-text block mb-1.5">
                Task Name / Feature Slug
              </label>
              <input
                ref={inputRef}
                type="text"
                value={taskName}
                onChange={(e) => {
                  setTaskName(e.target.value);
                  if (localError) setLocalError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.shiftKey) {
                    if (taskName.trim() && !isCreating) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }
                }}
                disabled={isCreating}
                placeholder="e.g. auth-flow, redesign-header, fix-login-bug"
                className="w-full bg-cozy-bg border border-cozy-border rounded-xl px-3.5 py-2.5 text-xs text-cozy-text placeholder:text-cozy-muted/60 focus:outline-none focus:border-teal-500 transition-colors disabled:opacity-50 font-mono"
              />
              <p className="text-[11px] text-cozy-muted/80 mt-1">
                Creates a new worktree directory and branch based on <code className="text-cozy-text font-mono">{baseBranch || 'main'}</code>.
              </p>
            </div>

            {/* Optional Initial Prompt */}
            <div>
              <label className="text-xs font-semibold text-cozy-text flex items-center justify-between mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                  Initial Prompt / Goal
                  <span className="text-[10px] text-cozy-muted font-normal">(Optional)</span>
                </span>
                <span className="text-[10px] text-cozy-muted">⌘ + Enter to launch</span>
              </label>
              <textarea
                value={initialPrompt}
                onChange={(e) => setInitialPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    if (taskName.trim() && !isCreating) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }
                }}
                disabled={isCreating}
                rows={4}
                placeholder="Describe what you want the AI agent to do. The agent will begin working on this goal immediately upon launching..."
                className="w-full bg-cozy-bg border border-cozy-border rounded-xl p-3 text-xs text-cozy-text placeholder:text-cozy-muted/60 focus:outline-none focus:border-teal-500 transition-colors resize-none disabled:opacity-50 leading-relaxed"
              />
            </div>

            {/* Launch Action */}
            <div className="pt-2 flex items-center justify-end">
              <button
                type="submit"
                disabled={isCreating || !taskName.trim()}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white transition-all shadow-glow-ocean cursor-pointer"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Creating Worktree & Initializing...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Launch Task</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
