import React, { useState, useEffect, useRef } from 'react';
import { X, UploadCloud, Sparkles, CheckCircle2, AlertTriangle, FileCode, Terminal } from 'lucide-react';
import { Task, GitStatus } from '../types';
import { getTaskGitStatus, getTaskGitDiff } from '../api';

interface SubmitModalProps {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  ws: WebSocket | null;
}

export const SubmitModal: React.FC<SubmitModalProps> = ({
  task,
  isOpen,
  onClose,
  ws,
}) => {
  const [gitStatus, setGitStatus] = useState<GitStatus>({ staged: [], unstaged: [], untracked: [] });
  const [gitDiff, setGitDiff] = useState('');
  const [commitMessage, setCommitMessage] = useState(`feat(${task.name}): implement task features`);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [isSuccess, setIsSuccess] = useState<boolean | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      getTaskGitStatus(task.id).then(setGitStatus).catch(() => {});
      getTaskGitDiff(task.id).then((res) => setGitDiff(res.diff)).catch(() => {});
    }
  }, [isOpen, task.id]);

  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'submit_event') {
          const ev = msg.event;
          if (ev.content) {
            setLogs((prev) => [...prev, ev.content]);
          }
          if (ev.type === 'done') {
            setIsSubmitting(false);
            setIsSuccess(true);
          } else if (ev.type === 'error') {
            setIsSubmitting(false);
            setIsSuccess(false);
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

  const handleSubmit = () => {
    if (!ws || !commitMessage.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setIsSuccess(null);
    setLogs([]);

    ws.send(
      JSON.stringify({
        type: 'start_submit',
        taskId: task.id,
        commitMessage: commitMessage.trim(),
      })
    );
  };

  if (!isOpen) return null;

  const totalChanges = gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-cozy-surface border border-cozy-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-cozy-border flex items-center justify-between bg-cozy-subtle/40">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
              <UploadCloud className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-cozy-text">Submit Changes</h3>
              <p className="text-xs text-cozy-muted">
                Commit & push <span className="font-mono text-sky-400">{task.branch}</span> to remote origin
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
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Changed Files Overview */}
          <div>
            <div className="flex items-center justify-between text-xs text-cozy-muted mb-2">
              <span className="font-medium text-cozy-text flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-sky-400" />
                Changed Files ({totalChanges})
              </span>
            </div>
            <div className="p-3 rounded-xl bg-cozy-bg border border-cozy-border max-h-36 overflow-y-auto space-y-1 font-mono text-xs">
              {totalChanges === 0 && <div className="text-cozy-muted/60">No pending changes detected.</div>}
              {gitStatus.staged.map((f) => (
                <div key={f} className="text-emerald-400 flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold text-emerald-500/70">staged</span> {f}
                </div>
              ))}
              {gitStatus.unstaged.map((f) => (
                <div key={f} className="text-amber-400 flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold text-amber-500/70">modified</span> {f}
                </div>
              ))}
              {gitStatus.untracked.map((f) => (
                <div key={f} className="text-sky-400 flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold text-sky-500/70">untracked</span> {f}
                </div>
              ))}
            </div>
          </div>

          {/* Commit Message */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="font-medium text-cozy-text">Commit Message</label>
              <button
                type="button"
                onClick={() => setCommitMessage(`feat(${task.name}): implement updates and automated changes`)}
                className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 transition-colors"
              >
                <Sparkles className="w-3 h-3" />
                <span>Suggest with AI</span>
              </button>
            </div>
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              rows={2}
              className="w-full bg-cozy-bg border border-cozy-border rounded-xl p-3 text-xs font-mono text-cozy-text focus:outline-none focus:border-sky-500"
              placeholder="e.g. feat: add task preview iframe"
            />
          </div>

          {/* Diff Preview */}
          {gitDiff && gitDiff !== '(No changes)' && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-cozy-muted">Git Diff Summary</span>
              <div className="p-3 rounded-xl bg-cozy-bg border border-cozy-border max-h-36 overflow-y-auto font-mono text-[11px] text-cozy-muted whitespace-pre">
                {gitDiff}
              </div>
            </div>
          )}

          {/* Live Agent Output */}
          {logs.length > 0 && (
            <div className="rounded-xl border border-cozy-border bg-cozy-bg overflow-hidden flex flex-col h-36">
              <div className="px-3 py-1.5 bg-cozy-subtle/60 border-b border-cozy-border flex items-center space-x-1.5 font-mono text-[11px] text-cozy-muted">
                <Terminal className="w-3 h-3 text-sky-400" />
                <span>Agent Execution Stream</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 font-mono text-xs text-cozy-muted leading-relaxed whitespace-pre-wrap select-text">
                {logs.map((line, idx) => (
                  <div key={idx}>{line}</div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}

          {isSuccess !== null && (
            <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
              isSuccess ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
            }`}>
              {isSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Successfully committed and pushed branch to remote origin!</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Failed to push changes. Check the agent log above.</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-cozy-border bg-cozy-subtle/30 flex items-center justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-cozy-subtle hover:bg-cozy-subtle/80 text-cozy-text border border-cozy-border transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !commitMessage.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white transition-all shadow-sm"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>{isSubmitting ? 'Pushing with AI Agent...' : 'Commit & Push'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
