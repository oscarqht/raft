import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, UploadCloud, CheckCircle2, AlertTriangle, FileCode, Terminal, GitCommit, GitPullRequest, ExternalLink } from 'lucide-react';
import { Task, GitStatus } from '../types';
import { getTaskGitStatus, generateTaskCommitMessage } from '../api';
import { setCachedTaskGitStatus } from '../cache';

interface SubmitModalProps {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  ws: WebSocket | null;
}

const getDefaultCommitMessage = (task: Task) =>
  task.name ? `feat(${task.name}): implement updates` : `feat(${task.branch || 'task'}): implement updates`;

export const SubmitModal: React.FC<SubmitModalProps> = ({
  task,
  isOpen,
  onClose,
  ws,
}) => {
  const [gitStatus, setGitStatus] = useState<GitStatus>({ staged: [], unstaged: [], untracked: [] });
  const [commitMessage, setCommitMessage] = useState(() => getDefaultCommitMessage(task));
  const [commitDetails, setCommitDetails] = useState('');
  const [isLargeChange, setIsLargeChange] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [isSuccess, setIsSuccess] = useState<boolean | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const hasUserEditedRef = useRef(false);
  const prevTaskIdRef = useRef(task.id);
  const prevProjectIdRef = useRef(task.project_id);

  const resetToDefault = useCallback((t: Task) => {
    hasUserEditedRef.current = false;
    setCommitMessage(getDefaultCommitMessage(t));
    setCommitDetails('');
    setIsLargeChange(false);
    setIsGenerating(false);
    setIsSubmitting(false);
    setLogs([]);
    setIsSuccess(null);
    setGitStatus({ staged: [], unstaged: [], untracked: [] });
  }, []);

  // Clear previous content and reset to default when switching to another project or task
  useEffect(() => {
    if (task.id !== prevTaskIdRef.current || task.project_id !== prevProjectIdRef.current) {
      prevTaskIdRef.current = task.id;
      prevProjectIdRef.current = task.project_id;
      resetToDefault(task);
    }
  }, [task.id, task.project_id, task.name, task.branch, resetToDefault, task]);

  const totalChanges = gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length;
  const unpushedCount = gitStatus.unpushedCount || 0;
  const isPushOnly = totalChanges === 0 && unpushedCount > 0;
  const hasNothingToSubmit = totalChanges === 0 && unpushedCount === 0;

  const handleGenerateAiCommit = async (forTaskId = task.id) => {
    if (isGenerating || isSubmitting) return;
    setIsGenerating(true);
    try {
      const res = await generateTaskCommitMessage(forTaskId);
      if (prevTaskIdRef.current !== forTaskId) return;
      if (!hasUserEditedRef.current) {
        if (res.title) {
          setCommitMessage(res.title);
        }
        setCommitDetails(res.details || '');
        setIsLargeChange(Boolean(res.isLargeChange));
      }
    } catch (err) {
      if (prevTaskIdRef.current === forTaskId) {
        console.error('Failed to generate commit message:', err);
      }
    } finally {
      if (prevTaskIdRef.current === forTaskId) {
        setIsGenerating(false);
      }
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (task.id !== prevTaskIdRef.current || task.project_id !== prevProjectIdRef.current) {
        prevTaskIdRef.current = task.id;
        prevProjectIdRef.current = task.project_id;
        resetToDefault(task);
      } else {
        hasUserEditedRef.current = false;
        setIsSuccess(null);
        setLogs([]);
        setIsSubmitting(false);
      }

      const targetTaskId = task.id;
      getTaskGitStatus(targetTaskId)
        .then((status) => {
          if (prevTaskIdRef.current !== targetTaskId) return;
          setGitStatus(status);
          const total = status.staged.length + status.unstaged.length + status.untracked.length;
          if (total > 0) {
            handleGenerateAiCommit(targetTaskId);
          } else {
            setCommitMessage('');
            setCommitDetails('');
          }
        })
        .catch(() => {});
    }
  }, [isOpen, task.id, task.project_id, task, resetToDefault]);

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
            getTaskGitStatus(task.id, true).then((s) => {
              setGitStatus(s);
              setCachedTaskGitStatus(task.id, s, task.project_id);
              window.dispatchEvent(new CustomEvent('task-status-updated', { detail: { taskId: task.id, status: s } }));
            }).catch(() => {
              window.dispatchEvent(new CustomEvent('task-status-updated', { detail: { taskId: task.id } }));
            });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-2xl rounded-squircle glass-panel border border-white/80 dark:border-white/10 shadow-soft-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-cozy-border/50 flex items-center justify-between bg-cozy-subtle/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-teal-500/15 via-cyan-500/10 to-sky-500/15 border border-teal-400/25 flex items-center justify-center text-teal-500 shadow-soft-sm shrink-0">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-cozy-text">Submit Changes</h3>
              <p className="text-xs text-cozy-muted mt-0.5">
                Commit & push <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">{task.branch}</span> to remote origin
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
          {/* Changed Files Overview */}
          <div>
            <div className="flex items-center justify-between text-xs text-cozy-muted mb-2">
              <span className="font-medium text-cozy-text flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-teal-500" />
                Changed Files ({totalChanges})
              </span>
            </div>
            <div className="p-3 rounded-xl bg-cozy-bg border border-cozy-border max-h-36 overflow-y-auto space-y-1 font-mono text-xs">
              {totalChanges === 0 && <div className="text-cozy-muted/60">No pending changes detected.</div>}
              {gitStatus.staged.map((f) => (
                <div key={f} className="text-emerald-400 flex items-center gap-2 min-w-0" title={f}>
                  <span className="text-[10px] uppercase font-bold text-emerald-500/70 shrink-0">staged</span>
                  <span className="truncate">{f}</span>
                </div>
              ))}
              {gitStatus.unstaged.map((f) => (
                <div key={f} className="text-amber-400 flex items-center gap-2 min-w-0" title={f}>
                  <span className="text-[10px] uppercase font-bold text-amber-500/70 shrink-0">modified</span>
                  <span className="truncate">{f}</span>
                </div>
              ))}
              {gitStatus.untracked.map((f) => (
                <div key={f} className="text-sky-400 flex items-center gap-2 min-w-0" title={f}>
                  <span className="text-[10px] uppercase font-bold text-sky-500/70 shrink-0">untracked</span>
                  <span className="truncate">{f}</span>
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
                      className="text-[10px] text-cozy-muted hover:text-teal-500 transition-colors"
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
              isSuccess ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-500'
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

          {isSuccess && gitStatus?.createPrUrl && (!gitStatus.pr || gitStatus.pr.state === 'closed') && (
            <div className="p-3.5 rounded-xl bg-teal-500/10 border border-teal-500/25 flex items-center justify-between gap-3 text-xs animate-in fade-in duration-200">
              <div className="flex items-center gap-2 text-teal-700 dark:text-teal-300 font-medium">
                <GitPullRequest className="w-4 h-4 text-teal-500 shrink-0" />
                <span>Ready to request a code review?</span>
              </div>
              <a
                href={gitStatus.createPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white shadow-soft-sm transition-all"
              >
                <span>Create PR</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {isSuccess && gitStatus?.pr && gitStatus.pr.state === 'open' && (
            <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/25 flex items-center justify-between gap-3 text-xs animate-in fade-in duration-200">
              <div className="flex items-center gap-2 text-sky-700 dark:text-sky-300 font-medium truncate">
                <GitPullRequest className="w-4 h-4 text-sky-500 shrink-0" />
                <span className="truncate">PR #{gitStatus.pr.number} is open: {gitStatus.pr.title}</span>
              </div>
              <a
                href={gitStatus.pr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-sky-500 hover:bg-sky-600 text-white shadow-soft-sm transition-all shrink-0"
              >
                <span>View PR</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-cozy-border/50 bg-cozy-subtle/40 flex items-center justify-end space-x-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full text-xs font-medium bg-cozy-subtle hover:bg-cozy-surface text-cozy-text border border-cozy-border transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || isGenerating || hasNothingToSubmit || (totalChanges > 0 && !commitMessage.trim())}
            title={hasNothingToSubmit ? 'No changes to commit or push' : undefined}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-all shadow-glow-ocean cursor-pointer"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>
              {isSuccess
                ? 'Done'
                : isGenerating
                ? 'Summarizing changes'
                : isSubmitting
                ? 'Pushing changes...'
                : 'Submit'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
