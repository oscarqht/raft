import React, { useState, useEffect } from 'react';
import {
  X,
  GitBranch,
  FolderGit2,
  Save,
  Check,
  AlertCircle,
  Pencil,
} from 'lucide-react';
import { Task } from '../types';
import { updateTask, validateProjectPath } from '../api';

export interface EditTaskModalProps {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedTask: Task) => void;
  availableBranches?: string[];
  projectPath?: string;
}

export const EditTaskModal: React.FC<EditTaskModalProps> = ({
  task,
  isOpen,
  onClose,
  onSuccess,
  availableBranches: propBranches,
  projectPath,
}) => {
  const [taskName, setTaskName] = useState(task.name);
  const [baseBranch, setBaseBranch] = useState(task.base_branch || 'main');
  const [branches, setBranches] = useState<string[]>(
    propBranches && propBranches.length > 0
      ? propBranches
      : [task.base_branch || 'main']
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync state when modal opens or task changes
  useEffect(() => {
    if (!isOpen) return;
    setTaskName(task.name);
    setBaseBranch(task.base_branch || 'main');
    setErrorMessage(null);
    setSaveSuccess(false);

    if (propBranches && propBranches.length > 0) {
      setBranches(propBranches);
      if (!propBranches.includes(task.base_branch || 'main')) {
        setBranches((prev) => [task.base_branch || 'main', ...prev]);
      }
    } else if (projectPath) {
      validateProjectPath(projectPath)
        .then((validation) => {
          if (validation.branches && validation.branches.length > 0) {
            const list = validation.branches;
            if (!list.includes(task.base_branch || 'main')) {
              list.unshift(task.base_branch || 'main');
            }
            setBranches(list);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, task, propBranches, projectPath]);

  if (!isOpen) return null;

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = taskName.trim();
    if (!trimmed) {
      setErrorMessage('Task name cannot be empty');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const updated = await updateTask(task.id, {
        name: trimmed,
        base_branch: baseBranch,
      });

      setSaveSuccess(true);
      setTimeout(() => {
        onSuccess(updated);
        onClose();
      }, 350);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to update task');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-cozy-surface border border-cozy-border rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="p-5 border-b border-cozy-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
              <Pencil className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-cozy-text">Edit Task Details</h3>
              <p className="text-[11px] text-cozy-muted">Update task display name and target base branch</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSave} className="p-5 space-y-4">
          {errorMessage && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Task Name */}
          <div>
            <label className="text-xs font-medium text-cozy-text block mb-1">
              Task Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={taskName}
              onChange={(e) => {
                setTaskName(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              placeholder="e.g. support d&d tmp tab to favorite items"
              className="w-full bg-cozy-bg border border-cozy-border rounded-xl px-3.5 py-2.5 text-xs text-cozy-text focus:outline-none focus:border-sky-500"
              autoFocus
            />
          </div>

          {/* Base Branch */}
          <div>
            <label className="text-xs font-medium text-cozy-text block mb-1">
              Base Branch
            </label>
            <select
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              className="w-full bg-cozy-bg border border-cozy-border rounded-xl px-3 py-2 text-xs font-mono text-cozy-text focus:outline-none focus:border-sky-500"
            >
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-cozy-muted mt-1">
              Target branch used for comparing git commits ahead/behind and syncing via rebase.
            </p>
          </div>

          {/* Read-Only Context Information */}
          <div className="p-3.5 rounded-xl bg-cozy-subtle/70 border border-cozy-border space-y-2.5">
            <span className="text-[11px] font-medium text-cozy-muted block uppercase tracking-wider">
              Worktree & Branch Info (Read-Only)
            </span>
            <div className="flex items-center justify-between text-xs">
              <span className="text-cozy-muted flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5 text-sky-400" />
                Git Branch:
              </span>
              <span className="font-mono text-sky-400 font-medium px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/20">
                {task.branch}
              </span>
            </div>
            <div className="text-xs">
              <span className="text-cozy-muted flex items-center gap-1.5 mb-1">
                <FolderGit2 className="w-3.5 h-3.5 text-cozy-muted" />
                Worktree Path:
              </span>
              <span
                className="font-mono text-cozy-muted text-[11px] break-all block bg-cozy-bg/80 p-2 rounded-lg border border-cozy-border/60"
                title={task.worktree_path}
              >
                {task.worktree_path}
              </span>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="pt-2 flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-xl text-xs font-medium bg-cozy-subtle hover:bg-cozy-subtle/80 text-cozy-text border border-cozy-border transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !taskName.trim()}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all shadow-sm ${
                saveSuccess
                  ? 'bg-emerald-600 text-white'
                  : 'bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white'
              }`}
            >
              {saveSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
