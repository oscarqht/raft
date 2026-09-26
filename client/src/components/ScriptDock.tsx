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
            className={`pointer-events-auto bg-cozy-surface/95 backdrop-blur-md border rounded-xl p-3 w-full sm:w-80 text-xs shadow-xl transition-all flex flex-col gap-2.5 ${
              isRunning
                ? 'border-sky-500/40 shadow-sky-500/10'
                : isFailed
                ? 'border-rose-500/40 shadow-rose-500/10 bg-rose-500/[0.03]'
                : isCompleted
                ? 'border-emerald-500/40 shadow-emerald-500/10'
                : 'border-cozy-border'
            }`}
          >
            {/* Top row: Name, status badge, manual dismiss */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div
                  className="font-semibold text-cozy-text truncate text-sm flex items-center gap-1.5"
                  title={item.scriptName}
                >
                  <Terminal
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isFailed
                        ? 'text-rose-400'
                        : isRunning
                        ? 'text-sky-400'
                        : isCompleted
                        ? 'text-emerald-400'
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
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    isRunning
                      ? item.isCanceling
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse'
                        : 'bg-sky-500/10 text-sky-400 border border-sky-500/20 animate-pulse'
                      : isFailed
                      ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      : isCompleted
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20'
                  }`}
                >
                  {isRunning && <Loader2 className="w-2.5 h-2.5 animate-spin mr-1" />}
                  {isCompleted && <Check className="w-2.5 h-2.5 mr-1 text-emerald-400" />}
                  {item.isCanceling
                    ? 'stopping...'
                    : isFailed
                    ? `exit code ${item.exitCode ?? 1}`
                    : item.status}
                </span>

                {/* Manual dismiss button for user to dismiss at any time once not running */}
                {!isRunning && (
                  <button
                    type="button"
                    className="p-1 rounded-md text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors cursor-pointer"
                    onClick={() => dismissExecution(item.id)}
                    title="Dismiss badge"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Bottom action row: View Logs & Cancel / Force Kill */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-cozy-border/60">
              <button
                type="button"
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-all text-xs cursor-pointer"
                onClick={() => openModal(item.id)}
                title="View terminal logs"
              >
                <ExternalLink className="w-3 h-3" />
                <span>View Logs</span>
              </button>

              {isRunning ? (
                <button
                  type="button"
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 transition-all cursor-pointer"
                  onClick={() => cancelScript(item.id, item.isCanceling)}
                  title={item.isCanceling ? 'Force kill process' : 'Stop process'}
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>{item.isCanceling ? 'Force Kill' : 'Stop'}</span>
                </button>
              ) : isFailed ? (
                <span className="text-[11px] text-rose-400 font-mono">
                  Failed
                </span>
              ) : isCompleted ? (
                <span className="text-[11px] text-emerald-400 font-mono">
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
