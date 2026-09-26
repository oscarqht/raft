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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-xl max-h-[85vh] rounded-squircle glass-panel border border-white/80 dark:border-white/10 shadow-soft-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-cozy-border/50 bg-cozy-subtle/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-rose-500/15 via-amber-500/10 to-sky-500/15 border border-rose-400/25 flex items-center justify-center text-rose-500 shadow-soft-sm shrink-0">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-cozy-text">Run Script</h2>
              <p className="text-xs text-cozy-muted mt-0.5">Execute predefined or custom terminal scripts</p>
            </div>
          </div>
          <button
            type="button"
            className="w-8 h-8 rounded-full flex items-center justify-center text-cozy-muted hover:text-rose-500 hover:bg-cozy-subtle transition-all"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 flex-1 overflow-y-auto space-y-6">
          {error && (
            <div className="flex items-center gap-2 p-3.5 text-xs bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded-2xl shadow-soft-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Section 1: Saved Scripts */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-cozy-text uppercase tracking-wider">
                Saved Project Scripts
              </span>
              <button
                type="button"
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-rose-500 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-400/20 transition-all cursor-pointer shadow-soft-sm"
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
              <div className="p-5 border border-dashed border-cozy-border/80 rounded-2xl text-center bg-cozy-subtle/30 shadow-soft-inner">
                <p className="text-xs text-cozy-muted mb-3">
                  No saved scripts for this project yet.
                </p>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-rose-500 hover:bg-rose-500/20 bg-rose-500/10 border border-rose-400/20 rounded-full transition-all shadow-soft-sm"
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
              <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                {scripts.map((script) => (
                  <div
                    key={script.id}
                    className="flex items-center justify-between p-3.5 bg-cozy-subtle/60 border border-cozy-border/70 hover:border-rose-400/30 rounded-2xl group transition-all shadow-soft-sm hover:shadow-soft"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="text-xs font-semibold text-cozy-text truncate">
                        {script.name}
                      </div>
                      <div className="text-[11px] font-mono text-cozy-muted truncate mt-0.5">
                        {script.command}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-rose-500 text-white hover:bg-rose-600 shadow-glow-peach transition-all shrink-0 disabled:opacity-50 cursor-pointer"
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
              <div className="w-full border-t border-cozy-border/60" />
            </div>
            <div className="relative flex justify-center text-xs uppercase tracking-wider">
              <span className="bg-cozy-surface px-3 text-cozy-muted font-medium">Or run arbitrary command</span>
            </div>
          </div>

          {/* Section 2: Arbitrary Script */}
          <div className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-cozy-text mb-1.5">
                Arbitrary Terminal Command
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={arbitraryCmd}
                  onChange={(e) => setArbitraryCmd(e.target.value)}
                  placeholder="e.g. npm run test:e2e or git status"
                  className="w-full px-4 py-2.5 text-xs font-mono bg-cozy-surface/90 border border-cozy-border/80 rounded-2xl text-cozy-text placeholder:text-cozy-muted/60 focus:outline-none focus:border-rose-400 shadow-soft-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !saveToProject)) {
                      e.preventDefault();
                      handleRunArbitrary();
                    }
                  }}
                />
              </div>
              <p className="text-[11px] text-cozy-muted mt-1.5">
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
                  className="rounded-lg border-cozy-border text-rose-500 focus:ring-0 focus:ring-offset-0 bg-cozy-surface"
                />
                <span className="text-xs text-cozy-text font-medium flex items-center gap-1.5">
                  <BookmarkPlus className="w-3.5 h-3.5 text-rose-500" />
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
                    className="w-full px-3.5 py-2 text-xs bg-cozy-surface/90 border border-cozy-border/80 rounded-xl text-cozy-text placeholder:text-cozy-muted/60 focus:outline-none focus:border-rose-400 shadow-soft-sm"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                className="flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-rose-500 hover:bg-rose-600 rounded-full shadow-glow-peach transition-all disabled:opacity-50 cursor-pointer"
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
