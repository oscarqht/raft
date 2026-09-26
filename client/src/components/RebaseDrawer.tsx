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
            setStatusText('Rebase and sync complete!');
          } else if (ev.type === 'error') {
            setIsRunning(false);
            setIsSuccess(false);
            setStatusText(`Error: ${ev.content}`);
          }
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
    setStatusText(`Starting AI agent to pull origin/${task.base_branch} and rebase...`);

    ws.send(JSON.stringify({ type: 'start_rebase', taskId: task.id }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-cozy-surface border-l border-cozy-border h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-cozy-border flex items-center justify-between bg-cozy-subtle/40">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <GitMerge className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-cozy-text">Sync & Rebase Branch</h3>
              <p className="text-xs text-cozy-muted">
                Rebase <span className="font-mono text-sky-400">{task.branch}</span> on <span className="font-mono text-cozy-muted">{task.base_branch}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="p-3.5 rounded-xl bg-cozy-subtle border border-cozy-border/80 text-xs text-cozy-muted space-y-2">
            <div className="flex items-start space-x-2">
              <span className="font-medium text-cozy-text">How it works:</span>
            </div>
            <p className="leading-relaxed">
              Termai launches an autonomous AI agent directly in your worktree. It fetches the latest commits from <code className="text-amber-400 font-mono">origin/{task.base_branch}</code>, executes the git rebase, and if merge conflicts are detected, analyzes the diffs to resolve them cleanly.
            </p>
          </div>

          {/* Action Button & Status */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleStartRebase}
              disabled={isRunning}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black transition-all shadow-sm"
            >
              {isRunning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>{isRunning ? 'Rebasing in progress...' : 'Start Pull & Rebase'}</span>
            </button>

            {isSuccess !== null && (
              <div className="flex items-center gap-1.5 text-xs">
                {isSuccess ? (
                  <span className="flex items-center gap-1 text-emerald-400 font-medium">
                    <CheckCircle2 className="w-4 h-4" /> Cleanly Rebased
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-rose-400 font-medium">
                    <AlertTriangle className="w-4 h-4" /> Rebase Failed
                  </span>
                )}
              </div>
            )}
          </div>

          {statusText && (
            <div className="text-xs font-mono text-sky-400 bg-sky-500/10 border border-sky-500/20 px-3 py-2 rounded-lg">
              {statusText}
            </div>
          )}

          {/* Live Agent Terminal Stream */}
          <div className="rounded-xl border border-cozy-border bg-cozy-bg overflow-hidden flex flex-col h-80">
            <div className="px-3 py-2 bg-cozy-subtle/60 border-b border-cozy-border flex items-center justify-between text-xs text-cozy-muted">
              <div className="flex items-center space-x-1.5 font-mono text-[11px]">
                <Terminal className="w-3.5 h-3.5 text-amber-400" />
                <span>Agent Output Stream</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-cozy-muted leading-relaxed whitespace-pre-wrap select-text">
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
        <div className="p-4 border-t border-cozy-border bg-cozy-subtle/30 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-cozy-subtle hover:bg-cozy-subtle/80 text-cozy-text border border-cozy-border transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
