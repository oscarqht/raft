import React from 'react';
import { Terminal, X, Square, ExternalLink, Loader2, Check } from 'lucide-react';
import { useScriptExecution } from '../contexts/ScriptExecutionContext';
import { ScriptExecutionItem } from '../types';

export const ScriptDock: React.FC = () => {
  const {
    executions,
    activeModalExecution,
    openModal,
    cancelScript,
    dismissExecution,
  } = useScriptExecution();

  // Show executions that are not currently displayed in the full terminal modal
  const docked = executions.filter((e) => e.id !== activeModalExecution?.id);

  if (docked.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 z-40 flex flex-col gap-2 max-w-sm pointer-events-none">
      {docked.map((item: ScriptExecutionItem) => {
        const isRunning = item.status === 'running';
        const isFailed = item.status === 'failed' || (item.exitCode !== null && item.exitCode !== 0);
        const isCompleted = item.status === 'completed' && (item.exitCode === 0 || item.exitCode === null);
        const isCanceled = item.status === 'canceled';

        return (
          <div
            key={item.id}
            className={`pointer-events-auto rounded-2.5xl glass-panel border p-3.5 w-full sm:w-84 text-xs shadow-soft-lg transition-all flex flex-col gap-2.5 ${
              isRunning
                ? 'border-teal-400/40 shadow-glow-ocean/20'
                : isFailed
                ? 'border-red-500/40 shadow-soft-md bg-red-500/[0.03]'
                : isCompleted
                ? 'border-emerald-500/40 shadow-glow-mint/20'
                : 'border-white/60 dark:border-white/10'
            }`}
          >
            {/* Top row: Name, status badge, manual dismiss */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div
                  className="font-bold text-cozy-text truncate text-sm flex items-center gap-1.5"
                  title={item.scriptName}
                >
                  <Terminal
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isFailed
                        ? 'text-red-500'
                        : isRunning
                        ? 'text-teal-500'
                        : isCompleted
                        ? 'text-emerald-500'
                        : 'text-cozy-muted'
                    }`}
                  />
                  <span className="truncate">{item.scriptName}</span>
                </div>
                <div
                  className="text-[11px] font-mono text-cozy-muted truncate mt-0.5"
                  title={item.command}
                >
                  {item.command}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold shadow-soft-sm ${
                    isRunning
                      ? item.isCanceling
                        ? 'bg-amber-500/15 text-amber-500 border border-amber-400/30 animate-pulse'
                        : 'bg-teal-500/15 text-teal-600 dark:text-teal-400 border border-teal-400/30 animate-pulse'
                      : isFailed
                      ? 'bg-red-500/15 text-red-500 border border-red-400/30'
                      : isCompleted
                      ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-400/30'
                      : 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/30'
                  }`}
                >
                  {isRunning && <Loader2 className="w-2.5 h-2.5 animate-spin mr-1" />}
                  {isCompleted && <Check className="w-2.5 h-2.5 mr-1 text-emerald-500" />}
                  {item.isCanceling
                    ? 'stopping...'
                    : isFailed
                    ? `exit code ${item.exitCode ?? 1}`
                    : item.status}
                </span>

                {/* Manual dismiss button */}
                {!isRunning && (
                  <button
                    type="button"
                    className="w-6 h-6 rounded-full flex items-center justify-center text-cozy-muted hover:text-teal-500 hover:bg-cozy-subtle transition-all cursor-pointer"
                    onClick={() => dismissExecution(item.id)}
                    title="Dismiss badge"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Bottom action row: View Logs & Cancel / Force Kill */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-cozy-border/50">
              <button
                type="button"
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-cozy-muted hover:text-cozy-text bg-cozy-subtle/80 hover:bg-cozy-surface border border-cozy-border/60 transition-all text-xs cursor-pointer shadow-soft-sm"
                onClick={() => openModal(item.id)}
                title="View terminal logs"
              >
                <ExternalLink className="w-3 h-3" />
                <span>View Logs</span>
              </button>

              {isRunning ? (
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-500/15 text-red-500 hover:bg-red-500 hover:text-white border border-red-400/30 transition-all cursor-pointer shadow-soft-sm"
                  onClick={() => cancelScript(item.id, item.isCanceling)}
                  title={item.isCanceling ? 'Force kill process' : 'Stop process'}
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>{item.isCanceling ? 'Force Kill' : 'Stop'}</span>
                </button>
              ) : isFailed ? (
                <span className="text-[11px] text-red-500 font-mono font-medium">
                  Failed
                </span>
              ) : isCompleted ? (
                <span className="text-[11px] text-emerald-500 font-mono font-medium">
                  Finished
                </span>
              ) : (
                <span className="text-[11px] text-zinc-400 font-mono">
                  Canceled
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
