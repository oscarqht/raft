import React, { useState } from 'react';
import {
  X,
  Play,
  Terminal,
  Settings,
  Plus,
  BookmarkPlus,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { ProjectCustomScript } from '../types';
import { useScriptExecution } from '../contexts/ScriptExecutionContext';

interface RunScriptModalProps {
  taskId: string;
  projectId: string;
  scripts: ProjectCustomScript[];
  isOpen: boolean;
  onClose: () => void;
  onOpenManageScripts: () => void;
  onScriptSaved?: (scripts: ProjectCustomScript[]) => void;
}

export const RunScriptModal: React.FC<RunScriptModalProps> = ({
  taskId,
  projectId,
  scripts,
  isOpen,
  onClose,
  onOpenManageScripts,
  onScriptSaved,
}) => {
  const { runScript } = useScriptExecution();

  const [arbitraryCmd, setArbitraryCmd] = useState('');
  const [saveToProject, setSaveToProject] = useState(false);
  const [customName, setCustomName] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRunSavedScript = async (script: ProjectCustomScript) => {
    setIsRunning(true);
    setError(null);
    try {
      await runScript({
        taskId,
        name: script.name,
        command: script.command,
        saveToProject: false,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to run script');
    } finally {
      setIsRunning(false);
    }
  };

  const handleRunArbitrary = async () => {
    const trimmed = arbitraryCmd.trim();
    if (!trimmed) {
      setError('Please enter a command to run');
      return;
    }

    setIsRunning(true);
    setError(null);
    try {
      const name = saveToProject && customName.trim() ? customName.trim() : trimmed;
      await runScript({
        taskId,
        name,
        command: trimmed,
        saveToProject,
      });

      if (saveToProject && onScriptSaved) {
        const alreadyExists = scripts.some((s) => s.command === trimmed);
        if (!alreadyExists) {
          onScriptSaved([
            ...scripts,
            { id: `script-${Date.now()}`, name, command: trimmed },
          ]);
        }
      }

      setArbitraryCmd('');
      setSaveToProject(false);
      setCustomName('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to run script');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="bg-cozy-surface border border-cozy-border rounded-xl shadow-2xl flex flex-col w-full max-w-xl max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-cozy-border bg-cozy-subtle/40">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-semibold text-cozy-text">Run Script</h2>
          </div>
          <button
            type="button"
            className="p-1 rounded-md text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex-1 overflow-y-auto space-y-6">
          {error && (
            <div className="flex items-center gap-2 p-3 text-xs bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Section 1: Saved Scripts */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold text-cozy-text uppercase tracking-wider">
                Saved Project Scripts
              </span>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
                onClick={() => {
                  onClose();
                  onOpenManageScripts();
                }}
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Manage Scripts</span>
              </button>
            </div>

            {scripts.length === 0 ? (
              <div className="p-4 border border-dashed border-cozy-border rounded-lg text-center bg-cozy-subtle/20">
                <p className="text-xs text-cozy-muted mb-2.5">
                  No saved scripts for this project yet.
                </p>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-sky-400 hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 rounded-md transition-colors"
                  onClick={() => {
                    onClose();
                    onOpenManageScripts();
                  }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add First Script</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {scripts.map((script) => (
                  <div
                    key={script.id}
                    className="flex items-center justify-between p-2.5 bg-cozy-subtle/40 border border-cozy-border hover:border-cozy-border/80 rounded-lg group transition-all"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="text-xs font-medium text-cozy-text truncate">
                        {script.name}
                      </div>
                      <div className="text-[11px] font-mono text-cozy-muted truncate mt-0.5">
                        {script.command}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-sky-500 text-white hover:bg-sky-600 shadow-sm transition-colors shrink-0 disabled:opacity-50"
                      onClick={() => handleRunSavedScript(script)}
                      disabled={isRunning}
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Run</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-cozy-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-cozy-surface px-2 text-cozy-muted">Or run arbitrary command</span>
            </div>
          </div>

          {/* Section 2: Arbitrary Script */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-cozy-text mb-1.5">
                Arbitrary Terminal Command
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={arbitraryCmd}
                  onChange={(e) => setArbitraryCmd(e.target.value)}
                  placeholder="e.g. npm run test:e2e or git status"
                  className="w-full pl-3 pr-3 py-2 text-xs font-mono bg-cozy-surface border border-cozy-border rounded-lg text-cozy-text placeholder:text-cozy-muted/60 focus:outline-none focus:border-sky-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !saveToProject)) {
                      e.preventDefault();
                      handleRunArbitrary();
                    }
                  }}
                />
              </div>
              <p className="text-[11px] text-cozy-muted mt-1">
                Will execute in the active task worktree directory.
              </p>
            </div>

            {/* Save to project checkbox */}
            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={saveToProject}
                  onChange={(e) => setSaveToProject(e.target.checked)}
                  className="rounded border-cozy-border text-sky-500 focus:ring-0 focus:ring-offset-0 bg-cozy-surface"
                />
                <span className="text-xs text-cozy-text flex items-center gap-1.5">
                  <BookmarkPlus className="w-3.5 h-3.5 text-sky-400" />
                  Save this command to project scripts
                </span>
              </label>

              {saveToProject && (
                <div className="pl-6 animate-in fade-in duration-100">
                  <label className="block text-[11px] font-medium text-cozy-muted mb-1">
                    Script Name (optional)
                  </label>
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="e.g. End-to-End Tests"
                    className="w-full px-3 py-1.5 text-xs bg-cozy-surface border border-cozy-border rounded-md text-cozy-text placeholder:text-cozy-muted/60 focus:outline-none focus:border-sky-500"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-sky-500 hover:bg-sky-600 rounded-lg shadow-sm transition-all disabled:opacity-50"
                onClick={handleRunArbitrary}
                disabled={isRunning || !arbitraryCmd.trim()}
              >
                {isRunning ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 fill-current" />
                )}
                <span>Run Command</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
