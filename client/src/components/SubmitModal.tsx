import React, { useState, useEffect, useRef } from 'react';
import { X, UploadCloud, Sparkles, CheckCircle2, AlertTriangle, FileCode, Terminal, Loader2, GitCommit } from 'lucide-react';
import { Task, GitStatus } from '../types';
import { getTaskGitStatus, generateTaskCommitMessage } from '../api';

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
  const [commitMessage, setCommitMessage] = useState(`feat(${task.name}): implement updates`);
  const [commitDetails, setCommitDetails] = useState('');
  const [isLargeChange, setIsLargeChange] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [isSuccess, setIsSuccess] = useState<boolean | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const hasUserEditedRef = useRef(false);

  const totalChanges = gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length;
  const unpushedCount = gitStatus.unpushedCount || 0;
  const isPushOnly = totalChanges === 0 && unpushedCount > 0;
  const hasNothingToSubmit = totalChanges === 0 && unpushedCount === 0;

  const handleGenerateAiCommit = async (force = false) => {
    if (isGenerating || isSubmitting) return;
    setIsGenerating(true);
    try {
      const res = await generateTaskCommitMessage(task.id);
      if (force || !hasUserEditedRef.current) {
        if (res.title) {
          setCommitMessage(res.title);
        }
        setCommitDetails(res.details || '');
        setIsLargeChange(Boolean(res.isLargeChange));
      }
    } catch (err) {
      console.error('Failed to generate commit message:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      hasUserEditedRef.current = false;
      setIsSuccess(null);
      setLogs([]);
      setIsSubmitting(false);

      getTaskGitStatus(task.id)
        .then((status) => {
          setGitStatus(status);
          const total = status.staged.length + status.unstaged.length + status.untracked.length;
          if (total > 0) {
            handleGenerateAiCommit(false);
          } else {
            setCommitMessage('');
            setCommitDetails('');
          }
        })
        .catch(() => {});
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
            getTaskGitStatus(task.id).then(setGitStatus).catch(() => {});
          } else if (ev.type === 'error') {
            setIsSubmitting(false);
            setIsSuccess(false);
          }
        }
      } catch {}
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws, task.id]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleSubmit = () => {
    if (!ws || isSubmitting || isGenerating || hasNothingToSubmit) return;
    if (totalChanges > 0 && !commitMessage.trim()) return;

    setIsSubmitting(true);
    setIsSuccess(null);
    setLogs([]);

    const trimmedTitle = commitMessage.trim();
    const trimmedDetails = commitDetails.trim();
    const fullMessage = trimmedDetails ? `${trimmedTitle}\n\n${trimmedDetails}` : trimmedTitle;

    ws.send(
      JSON.stringify({
        type: 'start_submit',
        taskId: task.id,
        commitMessage: fullMessage,
      })
    );
  };

  if (!isOpen) return null;

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

          {/* Unpushed Commits Section */}
          {unpushedCount > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-cozy-muted">
                <span className="font-medium text-cozy-text flex items-center gap-1.5">
                  <GitCommit className="w-3.5 h-3.5 text-sky-400" />
                  Unpushed Commits ({unpushedCount})
                </span>
                <span className="text-[11px] text-sky-400/90 font-mono">
                  Ready to push to remote
                </span>
              </div>
              <div className="p-3 rounded-xl bg-cozy-bg border border-sky-500/20 max-h-28 overflow-y-auto space-y-1 font-mono text-xs">
                {gitStatus.unpushedCommits?.map((c) => (
                  <div key={c.hash} className="flex items-center gap-2 text-cozy-text">
                    <span className="text-sky-400 shrink-0 font-bold">{c.hash}</span>
                    <span className="truncate text-cozy-muted">{c.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isPushOnly ? (
            <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-xs text-sky-300 flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
              <span>
                Working tree is clean. You have {unpushedCount} local commit{unpushedCount > 1 ? 's' : ''} ready to push directly to remote origin.
              </span>
            </div>
          ) : (
            <>
              {/* Commit Message */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-medium text-cozy-text flex items-center gap-1.5">
                    Commit Message
                  </label>
                  <button
                    type="button"
                    onClick={() => handleGenerateAiCommit(true)}
                    disabled={isGenerating || isSubmitting || totalChanges === 0}
                    className="text-[11px] text-sky-400 hover:text-sky-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-colors"
                    title={totalChanges === 0 ? 'No local file changes to analyze' : 'Generate commit message using AI Agent'}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin text-sky-400" />
                        <span>Generating with AI...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3" />
                        <span>Suggest with AI</span>
                      </>
                    )}
                  </button>
                </div>
                <input
                  type="text"
                  value={commitMessage}
                  onChange={(e) => {
                    hasUserEditedRef.current = true;
                    setCommitMessage(e.target.value);
                  }}
                  disabled={isSubmitting}
                  className="w-full bg-cozy-bg border border-cozy-border rounded-xl px-3 py-2.5 text-xs font-mono text-cozy-text focus:outline-none focus:border-sky-500 disabled:opacity-60"
                  placeholder={isGenerating ? 'Analyzing changes and generating commit message...' : 'e.g. feat(workspace): support drag-and-drop tabs to favorites'}
                />
              </div>

              {/* Optional Details for Large Changes */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <label className="font-medium text-cozy-muted">
                      Details <span className="text-[10px] text-cozy-muted/70 font-normal">(optional, for large changes)</span>
                    </label>
                    {isLargeChange && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        Large change detected
                      </span>
                    )}
                  </div>
                  {commitDetails && (
                    <button
                      type="button"
                      onClick={() => {
                        hasUserEditedRef.current = true;
                        setCommitDetails('');
                      }}
                      className="text-[10px] text-cozy-muted hover:text-rose-400 transition-colors"
                    >
                      Clear details
                    </button>
                  )}
                </div>
                <textarea
                  value={commitDetails}
                  onChange={(e) => {
                    hasUserEditedRef.current = true;
                    setCommitDetails(e.target.value);
                  }}
                  disabled={isSubmitting}
                  rows={4}
                  className="w-full bg-cozy-bg border border-cozy-border rounded-xl p-3 text-xs font-mono text-cozy-text focus:outline-none focus:border-sky-500 disabled:opacity-60 resize-y"
                  placeholder={isGenerating ? 'Generating technical details for large changes...' : 'Detailed bullet points or technical description (optional)...'}
                />
              </div>
            </>
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
                  <span>
                    {isPushOnly ? 'Successfully pushed branch to remote origin!' : 'Successfully committed and pushed branch to remote origin!'}
                  </span>
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
            disabled={isSubmitting || isGenerating || hasNothingToSubmit || (totalChanges > 0 && !commitMessage.trim())}
            title={hasNothingToSubmit ? 'No changes to commit or push' : undefined}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-all shadow-sm"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>
              {isSubmitting
                ? 'Pushing changes...'
                : hasNothingToSubmit
                ? 'No Changes to Commit'
                : isPushOnly
                ? `Push ${unpushedCount} Commit${unpushedCount > 1 ? 's' : ''}`
                : 'Commit & Push'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
