import React from 'react';
import { UploadCloud, X, Loader2, Check, AlertTriangle, Maximize2 } from 'lucide-react';
import { useSubmit } from '../contexts/SubmitContext';

export const SubmitDock: React.FC = () => {
  const { jobs, modalTask, openSubmit, dismissJob } = useSubmit();

  // Jobs currently shown in the full modal are not docked
  const docked = Object.values(jobs).filter((j) => j.task.id !== modalTask?.id);
  if (docked.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 z-40 flex flex-col gap-2 max-w-sm pointer-events-none">
      {docked.map(({ task, status }) => {
        const isRunning = status === 'submitting';
        const isFailed = status === 'error';
        return (
          <div
            key={task.id}
            className={`pointer-events-auto rounded-2.5xl glass-panel border p-3.5 w-full sm:w-84 text-xs shadow-soft-lg flex flex-col gap-2.5 ${
              isRunning
                ? 'border-teal-400/40 shadow-glow-ocean/20'
                : isFailed
                ? 'border-red-500/40 bg-red-500/[0.03]'
                : 'border-emerald-500/40 shadow-glow-mint/20'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-bold text-cozy-text truncate text-sm flex items-center gap-1.5">
                  <UploadCloud
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isFailed ? 'text-red-500' : isRunning ? 'text-teal-500' : 'text-emerald-500'
                    }`}
                  />
                  <span className="truncate">Submit: {task.name}</span>
                </div>
                <div className="text-[11px] font-mono text-cozy-muted truncate mt-0.5" title={task.branch}>
                  {task.branch}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                    isRunning
                      ? 'bg-teal-500/15 text-teal-600 dark:text-teal-400 border border-teal-400/30 animate-pulse'
                      : isFailed
                      ? 'bg-red-500/15 text-red-500 border border-red-400/30'
                      : 'bg-emerald-500/15 text-emerald-500 border border-emerald-400/30'
                  }`}
                >
                  {isRunning && <Loader2 className="w-2.5 h-2.5 animate-spin mr-1" />}
                  {status === 'done' && <Check className="w-2.5 h-2.5 mr-1" />}
                  {isFailed && <AlertTriangle className="w-2.5 h-2.5 mr-1" />}
                  {isRunning ? 'submitting' : isFailed ? 'failed' : 'pushed'}
                </span>
                {!isRunning && (
                  <button
                    type="button"
                    className="w-6 h-6 rounded-full flex items-center justify-center text-cozy-muted hover:text-teal-500 hover:bg-cozy-subtle transition-all cursor-pointer"
                    onClick={() => dismissJob(task.id)}
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="pt-2 border-t border-cozy-border/50">
              <button
                type="button"
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-cozy-muted hover:text-cozy-text bg-cozy-subtle/80 hover:bg-cozy-surface border border-cozy-border/60 transition-all text-xs cursor-pointer shadow-soft-sm"
                onClick={() => openSubmit(task)}
                title="Restore submit dialog"
              >
                <Maximize2 className="w-3 h-3" />
                <span>Restore</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
