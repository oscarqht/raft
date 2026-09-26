import React, { useState, useEffect, useRef } from 'react';
import Ansi from 'ansi-to-react';
import { Play, Square, RotateCw, ExternalLink, Terminal, ChevronUp, ChevronDown, Globe, Trash2 } from 'lucide-react';
import { Task, DevServerState } from '../types';
import { getDevServerState, startDevServer, stopDevServer, restartDevServer } from '../api';

interface PreviewPaneProps {
  task: Task;
  ws: WebSocket | null;
}

export const PreviewPane: React.FC<PreviewPaneProps> = ({ task, ws }) => {
  const [devState, setDevState] = useState<DevServerState>({
    taskId: task.id,
    status: 'stopped',
    logs: [],
    devCmd: '',
    worktreePath: '',
  });

  const [pathInput, setPathInput] = useState('/');
  const [iframeKey, setIframeKey] = useState(0);
  const [showConsole, setShowConsole] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Subscribe to dev server WebSocket events
  useEffect(() => {
    if (!ws) return;

    // Send subscribe message once connected
    const subscribe = () => {
      ws.send(JSON.stringify({ type: 'subscribe_dev_server', taskId: task.id }));
    };

    if (ws.readyState === WebSocket.OPEN) {
      subscribe();
    } else {
      ws.addEventListener('open', subscribe, { once: true });
    }

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'dev_server_state') {
          setDevState(msg.state);
        } else if (msg.type === 'dev_server_log') {
          setLogs((prev) => [...prev, msg.log]);
        }
      } catch {}
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws, task.id]);

  // Initial fetch
  useEffect(() => {
    getDevServerState(task.id)
      .then((state) => {
        setDevState(state);
        if (state.logs) setLogs(state.logs);
      })
      .catch(() => {});
  }, [task.id]);

  // Auto scroll console logs
  useEffect(() => {
    if (showConsole) {
      consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showConsole]);

  const handleStart = async () => {
    const next = await startDevServer(task.id);
    setDevState(next);
  };

  const handleStop = async () => {
    await stopDevServer(task.id);
    setDevState((prev) => ({ ...prev, status: 'stopped' }));
  };

  const handleRestart = async () => {
    const next = await restartDevServer(task.id);
    setDevState(next);
    setIframeKey((k) => k + 1);
  };

  const handleReloadIframe = () => {
    setIframeKey((k) => k + 1);
  };

  const activePort = devState.port || 5173;
  const currentUrl = `http://localhost:${activePort}${pathInput.startsWith('/') ? pathInput : '/' + pathInput}`;

  return (
    <div className="flex-1 flex flex-col h-full bg-cozy-bg min-w-0 overflow-hidden relative">
      {/* Top Address & Controls Toolbar */}
      <div className="h-11 border-b border-cozy-border bg-cozy-surface/60 px-2 sm:px-3 flex items-center justify-between shrink-0 gap-1.5 sm:gap-2 select-none">
        {/* Server Start/Stop/Restart */}
        <div className="flex items-center space-x-1 shrink-0">
          {devState.status === 'running' ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg text-xs font-medium bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-all"
              title="Stop dev server"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              onClick={handleStart}
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-all"
              title="Start local dev server"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start</span>
            </button>
          )}

          <button
            onClick={handleRestart}
            disabled={devState.status !== 'running'}
            className="p-1 sm:p-1.5 rounded-lg text-cozy-muted hover:text-cozy-text disabled:opacity-30 hover:bg-cozy-subtle transition-colors"
            title="Restart server"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Status Dot & Port */}
        <div className="flex items-center space-x-1.5 text-xs shrink-0">
          <span
            className={`w-2 h-2 rounded-full ${
              devState.status === 'running'
                ? 'bg-emerald-400 animate-pulse'
                : devState.status === 'starting'
                ? 'bg-amber-400 animate-ping'
                : 'bg-cozy-muted/40'
            }`}
          />
          <span className="font-mono text-cozy-muted text-[11px]">
            {devState.status === 'running' ? `:${activePort}` : 'offline'}
          </span>
        </div>

        {/* URL Bar */}
        <div className="flex-1 max-w-sm flex items-center bg-cozy-subtle border border-cozy-border rounded-lg px-2 sm:px-2.5 py-1 text-xs min-w-0">
          <Globe className="w-3.5 h-3.5 text-cozy-muted mr-1 sm:mr-1.5 shrink-0" />
          <span className="text-cozy-muted/60 select-none font-mono hidden sm:inline">http://localhost:{activePort}</span>
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleReloadIframe()}
            placeholder="/"
            className="flex-1 bg-transparent text-cozy-text focus:outline-none font-mono px-0.5 ml-0.5 min-w-[40px]"
          />
        </div>

        {/* Action icons */}
        <div className="flex items-center space-x-0.5 sm:space-x-1 shrink-0">
          <button
            onClick={handleReloadIframe}
            disabled={devState.status !== 'running'}
            className="p-1.5 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle disabled:opacity-30 transition-colors"
            title="Reload preview"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>

          <a
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`p-1.5 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors ${
              devState.status !== 'running' ? 'pointer-events-none opacity-30' : ''
            }`}
            title="Open in external browser window"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <button
            onClick={() => setShowConsole(!showConsole)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors border ${
              showConsole
                ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle border-transparent'
            }`}
            title="Toggle Console Logs"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="font-mono text-[11px]">{logs.length}</span>
            {showConsole ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Main Preview Frame / Placeholder */}
      <div className="flex-1 relative w-full h-full bg-white dark:bg-[#0b0d13] overflow-hidden">
        {devState.status === 'running' ? (
          <iframe
            key={iframeKey}
            src={currentUrl}
            title="Task Dev Server Preview"
            className="w-full h-full border-0"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-cozy-muted">
            <div className="w-12 h-12 rounded-2xl bg-cozy-subtle border border-cozy-border flex items-center justify-center mb-3">
              <Globe className="w-6 h-6 text-sky-400/60" />
            </div>
            <h3 className="text-sm font-medium text-cozy-text mb-1">Local Dev Preview</h3>
            <p className="text-xs max-w-sm mb-4">
              The development server is currently stopped. Click Start above to launch Vite / Webpack / Next in this task's isolated worktree.
            </p>
            <button
              onClick={handleStart}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white transition-all shadow-sm"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Launch Dev Server</span>
            </button>
          </div>
        )}
      </div>

      {/* Collapsible Console Logs Drawer */}
      {showConsole && (
        <div className="h-48 border-t border-cozy-border bg-cozy-surface flex flex-col shrink-0 select-text">
          <div className="h-8 border-b border-cozy-border px-3 flex items-center justify-between text-xs text-cozy-muted bg-cozy-subtle/40">
            <div className="flex items-center space-x-2">
              <Terminal className="w-3.5 h-3.5 text-sky-400" />
              <span className="font-mono text-[11px]">Dev Server Console</span>
            </div>
            <button
              onClick={() => setLogs([])}
              className="flex items-center gap-1 text-[11px] text-cozy-muted hover:text-rose-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-cozy-muted leading-relaxed whitespace-pre-wrap select-text">
            {logs.length === 0 ? (
              <span className="opacity-40">No console output yet...</span>
            ) : (
              logs.map((line, idx) => <div key={idx}><Ansi>{line}</Ansi></div>)
            )}
            <div ref={consoleEndRef} />
          </div>
        </div>
      )}
    </div>
  );
};
