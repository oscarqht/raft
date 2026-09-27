import React, { useState, useEffect, useRef } from 'react';
import { X, GitMerge, CheckCircle2, AlertTriangle, Play, RefreshCw, Terminal } from 'lucide-react';
import { Task } from '../types';

interface RebaseDrawerProps {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  ws: WebSocket | null;
}

export const RebaseDrawer: React.FC<RebaseDrawerProps> = ({
  task,
  isOpen,
  onClose,
  ws,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [isSuccess, setIsSuccess] = useState<boolean | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'rebase_event') {
          const ev = msg.event;
          if (ev.content) {
            setLogs((prev) => [...prev, ev.content]);
          }
          if (ev.type === 'status') {
            setStatusText(ev.content);
          } else if (ev.type === 'done') {
            setIsRunning(false);
            setIsSuccess(true);
            setStatusText(ev.content || 'Rebase and sync complete!');
          } else if (ev.type === 'error') {
            setIsRunning(false);
            setIsSuccess(false);
            setStatusText(`Error: ${ev.content}`);
          }
        } else if (msg.type === 'aborted') {
          setIsRunning(false);
          setStatusText('Rebase cancelled.');
        }
      } catch {}
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleStartRebase = () => {
    if (!ws || isRunning) return;
    setIsRunning(true);
    setIsSuccess(null);
    setLogs([]);
    setStatusText(`Syncing ${task.base_branch} and rebasing ${task.branch}...`);

    ws.send(JSON.stringify({ type: 'start_rebase', taskId: task.id }));
  };

  const handleAbortRebase = () => {
    if (!ws || !isRunning) return;
    ws.send(JSON.stringify({ type: 'abort' }));
    setIsRunning(false);
    setStatusText('Rebase cancelled by user.');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg glass-panel border-l border-white/80 dark:border-white/10 h-full flex flex-col shadow-soft-xl">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-cozy-border/50 flex items-center justify-between bg-cozy-subtle/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-500 shadow-soft-sm shrink-0">
              <GitMerge className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-cozy-text">Sync & Rebase Branch</h3>
              <p className="text-xs text-cozy-muted mt-0.5">
                Rebase <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">{task.branch}</span> on <span className="font-mono text-cozy-muted font-semibold">{task.base_branch}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-cozy-muted hover:text-teal-500 hover:bg-cozy-subtle transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          <div className="p-4 rounded-2xl bg-cozy-subtle/80 border border-cozy-border/70 text-xs text-cozy-muted space-y-2 shadow-soft-sm">
            <div className="flex items-start space-x-2">
              <span className="font-semibold text-cozy-text">How it works:</span>
            </div>
            <p className="leading-relaxed">
              Raft fetches latest commits from <code className="text-amber-500 font-mono font-medium">origin/{task.base_branch}</code>, synchronizes your local base branch, and performs a clean git rebase with autostash. If merge conflicts arise, an autonomous AI agent is launched to inspect and resolve them cleanly.
            </p>
          </div>

          {/* Action Button & Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={handleStartRebase}
                disabled={isRunning}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black transition-all shadow-soft cursor-pointer"
              >
                {isRunning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>{isRunning ? 'Rebasing in progress...' : 'Start Pull & Rebase'}</span>
              </button>
              {isRunning && (
                <button
                  onClick={handleAbortRebase}
                  className="px-3.5 py-2 rounded-full text-xs font-semibold bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 transition-all"
                >
                  Cancel
                </button>
              )}
            </div>

            {isSuccess !== null && (
              <div className="flex items-center gap-1.5 text-xs font-medium">
                {isSuccess ? (
                  <span className="flex items-center gap-1 text-emerald-500 font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> Cleanly Rebased
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red-500 font-semibold">
                    <AlertTriangle className="w-4 h-4" /> Rebase Failed
                  </span>
                )}
              </div>
            )}
          </div>

          {statusText && (
            <div className={`text-xs font-mono px-3.5 py-2.5 rounded-2xl shadow-soft-sm ${
              isSuccess === false
                ? 'text-red-500 bg-red-500/10 border border-red-500/20'
                : isSuccess === true
                ? 'text-emerald-500 bg-emerald-500/10 border border-emerald-400/20'
                : 'text-teal-600 dark:text-teal-400 bg-teal-500/10 border border-teal-400/20'
            }`}>
              {statusText}
            </div>
          )}

          {/* Live Agent Terminal Stream */}
          <div className="rounded-2xl border border-cozy-border/70 bg-cozy-surface/90 overflow-hidden flex flex-col h-80 shadow-soft-inner">
            <div className="px-3.5 py-2 bg-cozy-subtle/60 border-b border-cozy-border/50 flex items-center justify-between text-xs text-cozy-muted">
              <div className="flex items-center space-x-2 font-mono text-[11px] font-medium">
                <Terminal className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-cozy-text">Agent Output Stream</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3.5 font-mono text-xs text-cozy-muted leading-relaxed whitespace-pre-wrap select-text">
              {logs.length === 0 ? (
                <span className="opacity-40">Ready to rebase. Click 'Start Pull & Rebase' to begin.</span>
              ) : (
                logs.map((line, idx) => <div key={idx}>{line}</div>)
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-cozy-border/50 bg-cozy-subtle/40 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-full text-xs font-medium bg-cozy-subtle hover:bg-cozy-surface text-cozy-text border border-cozy-border transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
