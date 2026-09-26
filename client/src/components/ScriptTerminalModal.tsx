import React, { useEffect, useRef, useState } from 'react';
import Ansi from 'ansi-to-react';
import {
  Terminal,
  X,
  Minus,
  RotateCw,
  Copy,
  Check,
  Square,
  Loader2,
} from 'lucide-react';
import { useScriptExecution } from '../contexts/ScriptExecutionContext';

export const ScriptTerminalModal: React.FC = () => {
  const {
    activeModalExecution,
    minimizeModal,
    closeModal,
    cancelScript,
    rerunScript,
    dismissExecution,
  } = useScriptExecution();

  const [copied, setCopied] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const execution = activeModalExecution;
  const isRunning = execution?.status === 'running';

  // Auto-scroll on new output if user hasn't scrolled up
  useEffect(() => {
    if (!execution) return;
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [execution?.output, autoScroll]);

  // Track if user scrolled up manually
  const handleScroll = () => {
    if (!terminalRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  };

  const handleCopy = async () => {
    if (!execution?.output) return;
    try {
      const cleanText = execution.output.replace(
        // eslint-disable-next-line no-control-regex
        /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
        ''
      );
      await navigator.clipboard.writeText(cleanText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleClose = () => {
    if (!execution) return;
    const execId = execution.id;
    if (execution.status === 'running') {
      cancelScript(execId, true).catch(() => {});
    }
    dismissExecution(execId);
  };

  if (!execution) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={minimizeModal}
    >
      <div
        className="bg-cozy-surface border border-cozy-border rounded-xl shadow-2xl flex flex-col w-full max-w-4xl h-[75vh] max-h-[800px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Terminal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-cozy-border bg-cozy-subtle/50 select-none">
          <div className="flex items-center gap-2.5 min-w-0 pr-4">
            <Terminal className="w-4 h-4 text-sky-400 shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold text-cozy-text text-sm flex items-center gap-2 truncate">
                <span className="truncate">{execution.scriptName}</span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${
                    isRunning
                      ? execution.isCanceling
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse'
                        : 'bg-sky-500/10 text-sky-400 border border-sky-500/20 animate-pulse'
                      : execution.status === 'completed'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : execution.status === 'failed'
                      ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      : 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20'
                  }`}
                >
                  {isRunning && <Loader2 className="w-2.5 h-2.5 animate-spin mr-1" />}
                  {execution.isCanceling ? 'stopping...' : execution.status}
                </span>
              </div>
              <div
                className="text-[11px] font-mono text-cozy-muted truncate mt-0.5"
                title={execution.command}
              >
                {execution.command}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Rerun */}
            <button
              type="button"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors disabled:opacity-50"
              onClick={() => rerunScript(execution.id)}
              disabled={isRunning && !execution.isCanceling}
              title="Rerun script"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Rerun</span>
            </button>

            {/* Copy Output */}
            <button
              type="button"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors"
              onClick={handleCopy}
              title="Copy output"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-medium">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Copy</span>
                </>
              )}
            </button>

            {/* Stop / Force Kill */}
            {isRunning && (
              <button
                type="button"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 transition-all cursor-pointer"
                onClick={() => cancelScript(execution.id, execution.isCanceling)}
                title={execution.isCanceling ? 'Force kill process' : 'Stop process'}
              >
                <Square className="w-3 h-3 fill-current" />
                <span>{execution.isCanceling ? 'Force Kill' : 'Stop'}</span>
              </button>
            )}

            <div className="w-px h-4 bg-cozy-border mx-1" />

            {/* Minimize to Dock */}
            <button
              type="button"
              className="p-1.5 rounded-md text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors cursor-pointer"
              onClick={minimizeModal}
              title="Minimize to dock (keeps running)"
            >
              <Minus className="w-4 h-4" />
            </button>

            {/* Close & Terminate */}
            <button
              type="button"
              className="p-1.5 rounded-md text-cozy-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
              onClick={handleClose}
              title={isRunning ? 'Terminate script and close' : 'Close modal'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Terminal Content */}
        <div
          ref={terminalRef}
          onScroll={handleScroll}
          className="flex-1 bg-black/90 p-4 font-mono text-xs text-zinc-300 overflow-y-auto whitespace-pre-wrap break-all leading-relaxed select-text"
        >
          {execution.output ? (
            <Ansi>{execution.output}</Ansi>
          ) : (
            <div className="text-zinc-500 italic flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
              <span>Waiting for script output...</span>
            </div>
          )}
          <div ref={logEndRef} />
        </div>

        {/* Footer info */}
        <div className="px-4 py-2 border-t border-cozy-border/60 bg-cozy-surface text-[11px] text-cozy-muted flex items-center justify-between">
          <div>
            Started: {new Date(execution.startedAt).toLocaleTimeString()}
            {execution.finishedAt && (
              <> &bull; Finished: {new Date(execution.finishedAt).toLocaleTimeString()}</>
            )}
            {execution.exitCode !== null && (
              <> &bull; Exit Code: <span className="font-mono">{execution.exitCode}</span></>
            )}
          </div>
          <div>
            {!autoScroll && (
              <button
                type="button"
                className="text-sky-400 hover:underline cursor-pointer"
                onClick={() => {
                  setAutoScroll(true);
                  if (terminalRef.current) {
                    terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
                  }
                }}
              >
                Scroll to bottom &darr;
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
