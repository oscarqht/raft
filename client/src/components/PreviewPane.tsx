import React, { useState, useEffect, useRef } from 'react';
import Ansi from 'ansi-to-react';
import { Play, Pause, Square, RotateCw, RefreshCw, ExternalLink, Terminal, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Globe, Trash2, Camera, Loader2, AlertCircle, Package, CheckCircle2, X } from 'lucide-react';
import { Task, DevServerState, FileAttachment } from '../types';
import { getDevServerState, startDevServer, stopDevServer, restartDevServer, pingDevServer } from '../api';
import { useOptionalScriptExecution } from '../contexts/ScriptExecutionContext';
import { usePreviewExtension } from '../usePreviewExtension';
import { statusFromError } from '../previewExtension';
import { PreviewExtensionDialog } from './PreviewExtensionDialog';
import { PreviewFrame } from './PreviewFrame';

const PreviewAnnotationOverlay = React.lazy(() =>
  import('./PreviewAnnotationOverlay').then((m) => ({ default: m.PreviewAnnotationOverlay }))
);

const MAX_RETRY_ATTEMPTS = 30; // 30 seconds
const RETRY_INTERVAL_MS = 1500; // 1.5s gentle polling

interface PreviewPaneProps {
  task: Task;
  ws: WebSocket | null;
  onAttachToChat?: (attachments: FileAttachment[], url?: string) => void;
  onClose?: () => void;
}

export const PreviewPane: React.FC<PreviewPaneProps> = ({ task, ws, onAttachToChat, onClose }) => {
  const [devState, setDevState] = useState<DevServerState>({
    taskId: task.id,
    status: 'stopped',
    logs: [],
    devCmd: '',
    worktreePath: '',
  });

  const [pathInput, setPathInput] = useState('/');
  const [isAddressFocused, setIsAddressFocused] = useState(false);
  const isAddressFocusedRef = useRef(false);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const currentIframePathRef = useRef('/');
  const [iframeKey, setIframeKey] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [showConsole, setShowConsole] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [isPreviewSleeping, setIsPreviewSleeping] = useState(false);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [showExtensionDialog, setShowExtensionDialog] = useState(false);
  const currentTaskRef = useRef(task.id);
  currentTaskRef.current = task.id;

  useEffect(() => {
    if (isAddressFocused) {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
    }
  }, [isAddressFocused]);

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth;
    }
    return 800;
  });

  useEffect(() => {
    if (!panelRef.current) return;
    const updateWidth = () => {
      if (panelRef.current) {
        setPanelWidth(panelRef.current.offsetWidth);
      }
    };
    updateWidth();

    let rafId: number | null = null;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry?.contentRect) {
        const nextWidth = Math.round(entry.contentRect.width);
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          setPanelWidth((prev) => (Math.abs(prev - nextWidth) >= 4 ? nextWidth : prev));
        });
      }
    });
    observer.observe(panelRef.current);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  const isCompact = panelWidth < 620;

  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [activeScreenshot, setActiveScreenshot] = useState<{
    dataUrl: string;
    width: number;
    height: number;
    url?: string;
  } | null>(null);

  // Dev server connection readiness polling states
  const [isServerReady, setIsServerReady] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  // Script execution context tracking for dependency installation
  const scriptCtx = useOptionalScriptExecution();
  const [bypassInstallFailure, setBypassInstallFailure] = useState(false);
  const [showInstalledToast, setShowInstalledToast] = useState(false);
  const prevInstallingRef = useRef<boolean>(false);

  // Find the latest execution for "Install Dependencies"
  const installExecution = scriptCtx?.executions?.find(
    (e) => e.taskId === task.id && (e.scriptName === 'Install Dependencies' || (task.project?.install_cmd && e.command === task.project.install_cmd))
  );

  const isInstalling = installExecution?.status === 'running';
  const installFailed = Boolean(
    installExecution &&
    (installExecution.status === 'failed' || installExecution.status === 'canceled') &&
    !bypassInstallFailure
  );
  const installCompleted = installExecution?.status === 'completed';

  // Watch for completion transition to notify the user
  useEffect(() => {
    if (prevInstallingRef.current && installCompleted) {
      setShowInstalledToast(true);
      const timer = setTimeout(() => setShowInstalledToast(false), 5000);
      return () => clearTimeout(timer);
    }
    prevInstallingRef.current = Boolean(isInstalling);
  }, [isInstalling, installCompleted]);

  // Reset preview state when switching tasks
  useEffect(() => {
    setDevState({ taskId: task.id, status: 'stopped', logs: [], devCmd: '', worktreePath: '' });
    setLogs([]);
    setIsServerReady(false);
    setIsTimedOut(false);
    setAttemptCount(0);
    setCanGoBack(false);
    setCanGoForward(false);
    setPathInput('/');
    currentIframePathRef.current = '/';
    setActiveScreenshot(null);
    setIsCapturing(false);
    setIsStopping(false);
  }, [task.id]);

  // Subscribe to dev server WebSocket events
  useEffect(() => {
    if (!ws) return;

    // Send subscribe message once connected
    const subscribe = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'subscribe_dev_server', taskId: task.id }));
      }
    };

    if (ws.readyState === WebSocket.OPEN) {
      subscribe();
    } else {
      ws.addEventListener('open', subscribe, { once: true });
    }

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'dev_server_state' && msg.state?.taskId === task.id) {
          setDevState(msg.state);
          if (msg.state?.status === 'stopped' || msg.state?.status === 'error') {
            setIsStopping(false);
          }
          if (msg.state?.logs && msg.state.logs.length > 0) {
            setLogs((prev) => (prev.length === 0 ? msg.state.logs : prev));
          }
        } else if (msg.type === 'dev_server_log' && msg.taskId === task.id) {
          setLogs((prev) => [...prev, msg.log]);
        }
      } catch {}
    };

    ws.addEventListener('message', handleMessage);
    return () => {
      ws.removeEventListener('open', subscribe);
      ws.removeEventListener('message', handleMessage);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'unsubscribe_dev_server', taskId: task.id }));
      }
    };
  }, [ws, task.id]);


  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    getDevServerState(task.id)
      .then((state) => {
        if (cancelled) return;
        setDevState(state);
        if (state.logs && state.logs.length > 0) {
          setLogs((prev) => (prev.length === 0 ? state.logs : prev));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [task.id]);

  // Reset readiness when server stops or errors
  useEffect(() => {
    if (devState.status === 'stopped' || devState.status === 'error') {
      setIsServerReady(false);
      setAttemptCount(0);
      setIsTimedOut(false);
      setIsStopping(false);
    }
  }, [devState.status]);

  // Direct local preview; the companion supplies capture and frame navigation.
  const activeDevPort = devState.port || 5173;
  const previewOrigin = new URL(devState.url || `http://localhost:${activeDevPort}`).origin;
  const extension = usePreviewExtension(task.id, previewOrigin,
    devState.taskId === task.id && isServerReady && !isPreviewSleeping && !isStopping && (devState.status === 'running' || devState.status === 'starting'), (value) => {
      currentIframePathRef.current = value.pathname;
      if (!isAddressFocusedRef.current) setPathInput(value.pathname);
      setCanGoBack(Boolean(value.canGoBack));
      setCanGoForward(Boolean(value.canGoForward));
    });

  // Polling readiness check effect
  useEffect(() => {
    // Only poll when server is running or starting, and not yet marked ready or timed out
    if (devState.status !== 'running' && devState.status !== 'starting') return;
    if (isServerReady || isTimedOut) return;

    let isMounted = true;
    let timerId: any = null;

    const checkReady = async () => {
      // Pause polling if user has switched away or minimized the tab
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        if (isMounted) {
          timerId = setTimeout(checkReady, RETRY_INTERVAL_MS * 2);
        }
        return;
      }

      let ready = false;
      let resolvedPreview: { url: string; port: number } | undefined;

      // 1. Backend ping probe (checks TCP/HTTP on host)
      try {
        const ping = await pingDevServer(task.id);
        if (ping.ready) {
          ready = true;
          if (ping.url) resolvedPreview = { url: ping.url, port: ping.port };
        }
      } catch {}

      if (!isMounted) return;

      if (ready) {
        if (resolvedPreview) {
          const resolved = resolvedPreview;
          setDevState((prev) => ({ ...prev, ...resolved }));
        }
        setIsServerReady(true);
        setIsTimedOut(false);
        setAttemptCount(0);
        return;
      }

      setAttemptCount((prev) => {
        const next = prev + 1;
        if (next >= MAX_RETRY_ATTEMPTS) {
          setIsTimedOut(true);
        } else {
          timerId = setTimeout(checkReady, RETRY_INTERVAL_MS);
        }
        return next;
      });
    };

    // Run first check immediately
    checkReady();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !isServerReady && !isTimedOut) {
        checkReady();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (timerId) clearTimeout(timerId);
    };
  }, [devState.status, isServerReady, isTimedOut, task.id, activeDevPort]);

  // Auto scroll console logs
  useEffect(() => {
    if (showConsole) {
      consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showConsole]);

  const handleStart = async () => {
    setLogs([]);
    setIsServerReady(false);
    setIsTimedOut(false);
    setAttemptCount(0);
    const next = await startDevServer(task.id);
    setDevState(next);
  };

  const handleStop = async () => {
    if (isStopping) return;
    setIsStopping(true);
    try {
      setActiveScreenshot(null);
      await stopDevServer(task.id);
      setDevState((prev) => ({ ...prev, status: 'stopped' }));
      setIsServerReady(false);
      setIsTimedOut(false);
      setAttemptCount(0);
      onClose?.();
    } catch (err) {
      console.error('Failed to stop dev server:', err);
    } finally {
      setIsStopping(false);
    }
  };

  const handleRestart = async () => {
    setLogs([]);
    setIsServerReady(false);
    setIsTimedOut(false);
    setAttemptCount(0);
    const next = await restartDevServer(task.id);
    setDevState(next);
    setIframeKey((k) => k + 1);
  };

  const handleReloadIframe = async () => {
    if (extension.registered) {
      try { await extension.navigate('reload'); return; }
      catch (error) { setCaptureError(error instanceof Error ? error.message : 'Could not reload preview'); }
    }
    setIframeKey((key) => key + 1);
  };

  const handleNavigateAddress = async (targetPath?: string) => {
    let raw = (targetPath ?? pathInput).trim();
    if (/^https?:\/\//.test(raw)) {
      try { const url = new URL(raw); raw = url.pathname + url.search + url.hash; } catch {}
    }
    const normalized = '/' + raw.replace(/^\/+/, '');
    setPathInput(normalized);
    currentIframePathRef.current = normalized;
    if (extension.registered) {
      try { await extension.navigate('to', normalized); return; }
      catch (error) { setCaptureError(error instanceof Error ? error.message : 'Could not navigate preview'); }
    }
    setIframeKey((key) => key + 1);
  };

  const handleNavigateBack = () => { void extension.navigate('back').catch((error) => setCaptureError(error.message)); };
  const handleNavigateForward = () => { void extension.navigate('forward').catch((error) => setCaptureError(error.message)); };

// Draws a crisp 1px subtle border around the perimeter of the captured screenshot
// so that light/white pages have clear contrast against the tldraw canvas and chat bubbles.
async function addBorderToScreenshotDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(dataUrl);

        ctx.drawImage(img, 0, 0);

        // Draw crisp 1px inset border around screenshot edge
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.4)'; // Slate 500
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);

        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

  const handleCaptureScreenshot = async () => {
    if (isCapturing || isPreviewSleeping || !iframeRef.current || !previewContainerRef.current) return;
    const captureTaskId = task.id;
    setIsCapturing(true);
    setCaptureError(null);
    try {
      const status = await extension.check();
      if (currentTaskRef.current !== captureTaskId) return;
      if (status !== 'ready' || !extension.registered) {
        setShowExtensionDialog(true);
        return;
      }
      const rect = previewContainerRef.current.getBoundingClientRect();
      const result = await extension.capture(rect, `${previewOrigin}${currentIframePathRef.current || '/'}`);
      if (currentTaskRef.current !== captureTaskId) return;
      const borderedDataUrl = await addBorderToScreenshotDataUrl(result.dataUrl);
      if (currentTaskRef.current !== captureTaskId) return;
      setActiveScreenshot({ dataUrl: borderedDataUrl, width: result.width, height: result.height, url: (() => { const url = new URL(result.url, previewOrigin); return url.pathname + url.search + url.hash; })() });
    } catch (error) {
      if (currentTaskRef.current !== captureTaskId) return;
      if (statusFromError(error)) setShowExtensionDialog(true);
      else setCaptureError(error instanceof Error ? error.message : 'Failed to capture preview screenshot');
    } finally {
      if (currentTaskRef.current === captureTaskId) setIsCapturing(false);
    }
  };

  const currentPath = currentIframePathRef.current || (pathInput.startsWith('/') ? pathInput : '/' + pathInput);

  const handleAttachToChat = (attachments: FileAttachment[]) => {
    const screenshotUrl = activeScreenshot?.url || currentPath;
    setActiveScreenshot(null);
    if (onAttachToChat) {
      onAttachToChat(attachments, screenshotUrl);
    } else {
      window.dispatchEvent(
        new CustomEvent('add-pending-attachments', {
          detail: {
            attachments,
            url: screenshotUrl,
          },
        })
      );
    }
  };

  const initialIframeSrc = `${previewOrigin}${currentPath}`;
  const externalUrl = `${previewOrigin}${currentPath}`;

  return (
    <div ref={panelRef} className="flex-1 flex flex-col h-full bg-transparent min-w-0 overflow-hidden relative">
      {/* Toast Notification when dependencies finish installing */}
      {showInstalledToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500 text-white text-xs font-medium shadow-soft-xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Dependencies installed successfully! You can now start preview.</span>
          <button
            type="button"
            onClick={() => setShowInstalledToast(false)}
            className="ml-2 hover:opacity-80 p-0.5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Address & Controls Toolbar */}
      <div className="h-11 px-3 border-b border-cozy-border bg-cozy-surface flex items-center justify-between shrink-0 gap-2 select-none">
        {/* Server Start/Stop/Restart */}
        <div className="flex items-center space-x-1 shrink-0">
          {devState.status === 'running' || devState.status === 'starting' || isStopping ? (
            <button
              onClick={handleStop}
              disabled={isStopping}
              className={`flex items-center gap-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors ${
                isCompact ? 'w-7 h-7 justify-center p-0' : 'h-7 px-2.5'
              } ${isStopping ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
              title={isStopping ? 'Stopping dev server...' : 'Stop dev server'}
            >
              {isStopping ? (
                <Loader2 className="w-3 h-3 animate-spin text-red-500" />
              ) : (
                <Square className="w-3 h-3 fill-current" />
              )}
              {!isCompact && <span>{isStopping ? 'Stopping...' : 'Stop'}</span>}
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={isInstalling || installFailed}
              className={`flex items-center gap-1.5 rounded-lg text-xs font-medium transition-colors ${
                isCompact ? 'w-7 h-7 justify-center p-0' : 'h-7 px-2.5'
              } ${
                isInstalling || installFailed
                  ? 'bg-cozy-subtle border border-cozy-border text-cozy-muted cursor-not-allowed opacity-60'
                  : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25'
              }`}
              title={
                isInstalling
                  ? 'Installing dependencies... Please wait'
                  : installFailed
                  ? 'Dependency installation failed'
                  : 'Start local dev server'
              }
            >
              {isInstalling ? (
                <Loader2 className="w-3 h-3 animate-spin text-teal-500" />
              ) : (
                <Play className="w-3 h-3 fill-current" />
              )}
              {!isCompact && <span>{isInstalling ? 'Installing...' : 'Start'}</span>}
            </button>
          )}

          <button
            onClick={handleRestart}
            disabled={devState.status !== 'running' || isStopping}
            className="w-7 h-7 rounded-md flex items-center justify-center text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle disabled:opacity-30 transition-colors"
            title="Restart dev server"
            aria-label="Restart dev server"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Back and Forward history buttons */}
        {!isCompact && (
          <div className="flex items-center space-x-0.5 shrink-0">
            <button
              type="button"
              onClick={handleNavigateBack}
              disabled={devState.status !== 'running' || !isServerReady || !extension.registered || !canGoBack}
              className="w-7 h-7 rounded-md flex items-center justify-center text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
              title="Back"
              aria-label="Back"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleNavigateForward}
              disabled={devState.status !== 'running' || !isServerReady || !extension.registered || !canGoForward}
              className="w-7 h-7 rounded-md flex items-center justify-center text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
              title="Forward"
              aria-label="Forward"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* URL Address Bar */}
        {!isCompact && (
          <div
            onClick={() => {
              if (!isAddressFocused) {
                setIsAddressFocused(true);
                isAddressFocusedRef.current = true;
              }
            }}
            className="flex-1 max-w-sm h-7 flex items-center bg-cozy-subtle dark:bg-[#212121] border border-cozy-border rounded-lg px-2 text-xs min-w-0 overflow-hidden transition-colors cursor-text"
          >
            <Globe className="w-3.5 h-3.5 text-cozy-muted mr-1.5 shrink-0" />
            {isAddressFocused ? (
              <div className="flex-1 min-w-0 flex items-center overflow-hidden">
                <span className="text-cozy-muted select-none font-mono text-[11px] shrink-0 truncate max-w-[130px]">
                  {previewOrigin}
                </span>
                <input
                  ref={addressInputRef}
                  type="text"
                  value={pathInput}
                  onFocus={() => {
                    setIsAddressFocused(true);
                    isAddressFocusedRef.current = true;
                  }}
                  onBlur={() => {
                    setIsAddressFocused(false);
                    isAddressFocusedRef.current = false;
                    setPathInput(currentIframePathRef.current);
                  }}
                  onChange={(e) => setPathInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleNavigateAddress();
                      (e.target as HTMLInputElement).blur();
                    } else if (e.key === 'Escape') {
                      setPathInput(currentIframePathRef.current);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  placeholder="/"
                  className="flex-1 bg-transparent text-cozy-text focus:outline-none font-mono px-0.5 ml-0.5 min-w-0"
                />
              </div>
            ) : (
              <div className="flex-1 min-w-0 overflow-hidden">
                <span
                  className="block truncate font-mono text-[11px] text-cozy-muted select-none"
                  title={`http://localhost:${activeDevPort}${pathInput.startsWith('/') ? pathInput : '/' + pathInput}`}
                >
                  {previewOrigin}
                  <span className="text-cozy-text font-medium">
                    {pathInput.startsWith('/') ? pathInput : '/' + pathInput}
                  </span>
                </span>
              </div>
            )}
          </div>
        )}

        {/* Action icons & Status badge at very right edge */}
        <div className="flex items-center space-x-1 shrink-0">
          <button
            onClick={handleReloadIframe}
            disabled={devState.status !== 'running' || !isServerReady}
            className="w-7 h-7 rounded-md flex items-center justify-center text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle disabled:opacity-30 transition-colors"
            title="Reload preview"
            aria-label="Reload preview"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>

          <button type="button" onClick={() => setShowExtensionDialog(true)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle"
            title={extension.registered ? 'Preview extension connected' : 'Enable enhanced preview'} aria-label="Enable enhanced preview">
            <Globe className={`w-3.5 h-3.5 ${extension.registered ? 'text-teal-500' : ''}`} />
          </button>
          {/* Screenshot & Annotate Preview button */}
          <button
            onClick={handleCaptureScreenshot}
            disabled={devState.status !== 'running' || !isServerReady || isCapturing || isPreviewSleeping || extension.preparing}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
              activeScreenshot
                ? 'bg-teal-500/15 text-teal-600 dark:text-teal-400'
                : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle disabled:opacity-30'
            }`}
            title="Take Screenshot & Annotate Preview"
          >
            {isCapturing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-500" />
            ) : (
              <Camera className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Pause / Sleep Preview Toggle */}
          {devState.status === 'running' && isServerReady && (
            <button
              type="button"
              onClick={() => setIsPreviewSleeping(!isPreviewSleeping)}
              className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                isPreviewSleeping
                  ? 'bg-amber-500/15 text-amber-500 hover:bg-amber-500/25'
                  : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle'
              }`}
              title={isPreviewSleeping ? 'Resume preview iframe' : 'Sleep preview iframe to reduce CPU & memory usage'}
            >
              {isPreviewSleeping ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
          )}

          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`w-7 h-7 rounded-md flex items-center justify-center text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors ${
              devState.status !== 'running' || !isServerReady ? 'pointer-events-none opacity-30' : ''
            }`}
            title="Open in external browser window"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <button
            onClick={() => setShowConsole(!showConsole)}
            className={`h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors border ${
              showConsole
                ? 'bg-teal-500/10 border-teal-500/30 text-teal-600 dark:text-teal-400'
                : 'bg-cozy-subtle text-cozy-muted hover:text-cozy-text border-cozy-border'
            }`}
            title="Toggle Console Logs"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="font-mono text-[11px]">{logs.length}</span>
            {showConsole ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          </button>

          {/* Status Pill & Port at very right edge */}
          <div
            className={`h-7 flex items-center gap-1.5 rounded-lg bg-cozy-subtle border border-cozy-border text-xs shrink-0 ${
              isCompact ? 'w-7 justify-center p-0' : 'px-2'
            }`}
            title={
              devState.status === 'running' && isServerReady
                ? `Online :${activeDevPort}`
                : devState.status === 'running' || devState.status === 'starting'
                ? `Starting :${activeDevPort}`
                : 'Offline'
            }
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                devState.status === 'running' && isServerReady
                  ? 'bg-emerald-500'
                  : devState.status === 'running' || devState.status === 'starting'
                  ? 'bg-amber-400'
                  : 'bg-cozy-muted/40'
              }`}
            />
            {!isCompact && (
              <span className="font-mono text-cozy-muted text-[11px] font-medium">
                {devState.status === 'running' && isServerReady
                  ? `:${activeDevPort}`
                  : devState.status === 'running' || devState.status === 'starting'
                  ? `:${activeDevPort}`
                  : 'offline'}
              </span>
            )}
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors cursor-pointer shrink-0"
              title="Close preview panel"
              aria-label="Close preview panel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Preview Frame / Placeholder */}
      <div
        ref={previewContainerRef}
        className="flex-1 relative w-full h-full bg-white dark:bg-[#0e1017] overflow-hidden"
      >
        {/* Error notification banner */}
        {captureError && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 max-w-lg px-4 py-2.5 rounded-xl bg-red-500/95 text-white text-xs shadow-lg backdrop-blur flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 duration-200">
            <span className="flex-1 leading-snug">
              {captureError.includes('https://') ? (
                <>
                  {captureError.split('https://')[0]}
                  <a
                    href={`https://${captureError.split('https://')[1]}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-semibold hover:text-white ml-1 inline-flex items-center gap-1"
                  >
                    https://{captureError.split('https://')[1]}
                    <ExternalLink className="w-3 h-3 inline" />
                  </a>
                </>
              ) : (
                captureError
              )}
            </span>
            <button
              onClick={() => setCaptureError(null)}
              className="text-white/80 hover:text-white text-sm font-semibold px-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {devState.taskId === task.id && (devState.status === 'running' || devState.status === 'starting') ? (
          isServerReady ? (
            isPreviewSleeping ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-cozy-muted bg-cozy-bg/50 select-none">
                <div className="w-14 h-14 rounded-2.5xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center mb-4 text-teal-500 shadow-soft-sm">
                  <Pause className="w-6 h-6" />
                </div>
                <h3 className="text-base font-semibold text-cozy-text mb-1">
                  Preview Paused
                </h3>
                <p className="text-xs max-w-sm mb-5 text-cozy-muted leading-relaxed">
                  The preview iframe is sleeping to save battery, GPU, and CPU cycles while you code and chat. The dev server process remains running.
                </p>
                <button
                  type="button"
                  onClick={() => setIsPreviewSleeping(false)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white transition-all shadow-glow-ocean cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Resume Preview</span>
                </button>
              </div>
            ) : extension.preparing ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-cozy-muted"><Loader2 className="h-4 w-4 animate-spin" />Connecting preview extension…</div>
            ) : (
              <PreviewFrame
                ref={iframeRef}
                data-alpha-bro-preview={extension.sessionId || undefined}
                key={`${task.id}:${previewOrigin}:${iframeKey}`}
                src={initialIframeSrc}
                title="Task Dev Server Preview"
                className="w-full h-full border-0"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
              />
            )
          ) : isTimedOut ? (
            <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-cozy-muted bg-cozy-bg/50 select-none">
              <div className="w-14 h-14 rounded-2.5xl bg-gradient-to-tr from-amber-500/15 via-red-500/15 to-amber-600/10 border border-amber-400/30 flex items-center justify-center mb-4 shadow-soft-sm text-amber-500">
                <AlertCircle className="w-7 h-7" />
              </div>
              <h3 className="text-base font-semibold text-cozy-text mb-1.5">
                Dev Server Took Too Long to Respond
              </h3>
              <p className="text-xs max-w-md mb-2 text-cozy-muted leading-relaxed">
                The dev server process is running, but no HTTP response was received at{' '}
                <span className="font-mono text-cozy-text font-medium">{externalUrl}</span> after {MAX_RETRY_ATTEMPTS} seconds.
              </p>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-[11px] font-mono text-amber-500 mb-6">
                <span>{MAX_RETRY_ATTEMPTS} retries reached</span>
                <span>•</span>
                <span>Port :{activeDevPort}</span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsTimedOut(false);
                    setAttemptCount(0);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white transition-all shadow-glow-ocean cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Retry Connection</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowConsole(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium bg-cozy-surface/90 hover:bg-cozy-subtle text-cozy-text border border-cozy-border/80 transition-all shadow-soft-sm cursor-pointer"
                >
                  <Terminal className="w-3.5 h-3.5 text-teal-500" />
                  <span>View Console Logs ({logs.length})</span>
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={isStopping}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium text-red-500 hover:bg-red-500/10 border border-red-500/20 transition-all ${
                    isStopping ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                  }`}
                  title={isStopping ? 'Stopping dev server...' : 'Stop dev server'}
                >
                  {isStopping ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500" />
                  ) : (
                    <Square className="w-3.5 h-3.5 fill-current" />
                  )}
                  <span>{isStopping ? 'Stopping...' : 'Stop Server'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-cozy-muted bg-cozy-bg/50 select-none">
              <div className="relative mb-5">
                <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-teal-500/15 via-cyan-500/15 to-emerald-500/15 border border-teal-400/25 flex items-center justify-center shadow-soft-sm relative">
                  <Globe className="w-7 h-7 text-teal-500" />
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-cozy-surface border border-cozy-border/70 flex items-center justify-center shadow-sm">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-500" />
                  </div>
                </div>
              </div>

              <h3 className="text-base font-semibold text-cozy-text mb-1">
                Waiting for Dev Server...
              </h3>
              <p className="text-xs font-mono text-teal-600/90 dark:text-teal-400 mb-4 font-medium">
                {previewOrigin}
              </p>

              <div className="w-64 max-w-xs mb-3">
                <div className="flex items-center justify-between text-[11px] font-mono text-cozy-muted mb-1.5">
                  <span>Connecting...</span>
                  <span>{attemptCount} / {MAX_RETRY_ATTEMPTS}s</span>
                </div>
                <div className="w-full h-1.5 bg-cozy-border/60 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-teal-500 to-cyan-500 transition-all duration-300 rounded-full"
                    style={{ width: `${Math.max(5, (attemptCount / MAX_RETRY_ATTEMPTS) * 100)}%` }}
                  />
                </div>
              </div>

              <p className="text-[11px] text-cozy-muted max-w-xs mb-5 leading-relaxed">
                Retrying every 1s. The preview will automatically appear as soon as the dev server is ready.
              </p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowConsole(!showConsole)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-cozy-surface/90 hover:bg-cozy-subtle text-cozy-text border border-cozy-border/80 transition-all shadow-soft-sm cursor-pointer"
                >
                  <Terminal className="w-3.5 h-3.5 text-teal-500" />
                  <span>View Logs ({logs.length})</span>
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={isStopping}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-red-500 hover:bg-red-500/10 border border-red-500/20 transition-all ${
                    isStopping ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                  }`}
                  title={isStopping ? 'Stopping dev server...' : 'Stop dev server'}
                >
                  {isStopping ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500" />
                  ) : (
                    <Square className="w-3.5 h-3.5 fill-current" />
                  )}
                  <span>{isStopping ? 'Stopping...' : 'Stop'}</span>
                </button>
              </div>
            </div>
          )
        ) : isInstalling ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-cozy-muted bg-cozy-bg/50 select-none">
            <div className="relative mb-5">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-indigo-500/15 via-teal-500/15 to-amber-500/15 border border-indigo-400/25 flex items-center justify-center shadow-soft-sm relative">
                <Package className="w-7 h-7 text-indigo-500 animate-pulse" />
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-cozy-surface border border-cozy-border/70 flex items-center justify-center shadow-sm">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                </div>
              </div>
            </div>

            <h3 className="text-base font-semibold text-cozy-text mb-1.5">
              Installing Project Dependencies...
            </h3>
            <div className="mb-3">
              <span className="text-xs font-mono text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1 rounded-full inline-flex items-center gap-1.5">
                <Terminal className="w-3 h-3" />
                {installExecution?.command || 'npm install'}
              </span>
            </div>
            <p className="text-xs text-cozy-muted max-w-sm mb-6 leading-relaxed">
              Since this task is running in a new git worktree, project dependencies are being installed first. Please wait before starting preview.
            </p>

            {scriptCtx && installExecution && (
              <button
                type="button"
                onClick={() => scriptCtx.openModal(installExecution.id)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium bg-cozy-surface hover:bg-cozy-subtle text-cozy-text border border-cozy-border shadow-soft-sm transition-all cursor-pointer"
              >
                <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                <span>View Terminal Logs</span>
              </button>
            )}
          </div>
        ) : installFailed ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-cozy-muted bg-cozy-bg/50 select-none">
            <div className="w-16 h-16 rounded-3xl bg-red-500/15 border border-red-500/30 flex items-center justify-center mb-4 shadow-soft-sm text-red-500">
              <AlertCircle className="w-7 h-7" />
            </div>

            <h3 className="text-base font-semibold text-cozy-text mb-1.5">
              Dependency Installation Failed
            </h3>
            <div className="mb-3">
              <span className="text-xs font-mono text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-1 rounded-full inline-flex items-center gap-1.5">
                <Terminal className="w-3 h-3" />
                {installExecution?.command || 'Install script'} (exit code {installExecution?.exitCode ?? 'err'})
              </span>
            </div>
            <p className="text-xs text-cozy-muted max-w-sm mb-6 leading-relaxed">
              The dependency installation script did not finish successfully. Preview dev server might fail to run without installed packages.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2">
              {scriptCtx && installExecution && (
                <>
                  <button
                    type="button"
                    onClick={() => scriptCtx.openModal(installExecution.id)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium bg-cozy-surface hover:bg-cozy-subtle text-cozy-text border border-cozy-border shadow-soft-sm transition-all cursor-pointer"
                  >
                    <Terminal className="w-3.5 h-3.5 text-red-400" />
                    <span>View Logs</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => scriptCtx.rerunScript(installExecution.id)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-400 border border-indigo-500/30 transition-all cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry Install</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setBypassInstallFailure(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-all cursor-pointer"
              >
                <span>Start Preview Anyway</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-cozy-muted">
            <div className="w-14 h-14 rounded-2.5xl bg-gradient-to-tr from-teal-500/10 via-cyan-500/10 to-emerald-500/10 border border-teal-400/20 flex items-center justify-center mb-3.5 shadow-soft-sm">
              <Globe className="w-6 h-6 text-teal-500" />
            </div>
            <h3 className="text-base font-semibold text-cozy-text mb-1.5">Local Dev Preview</h3>
            <p className="text-xs max-w-sm mb-5 text-cozy-muted leading-relaxed">
              The development server is currently stopped. Launch Vite / Webpack / Next in this task's isolated worktree to preview changes live.
            </p>
            <button
              onClick={handleStart}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white transition-all shadow-glow-ocean cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Launch Dev Server</span>
            </button>
          </div>
        )}

        {/* Live Annotation Overlay */}
        {activeScreenshot && (
          <React.Suspense
            fallback={
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/80">
                <Loader2 className="w-8 h-8 animate-spin text-teal-500" />
              </div>
            }
          >
            <PreviewAnnotationOverlay
              screenshotDataUrl={activeScreenshot.dataUrl}
              screenshotWidth={activeScreenshot.width}
              screenshotHeight={activeScreenshot.height}
              taskId={task.id}
              onAttachToChat={handleAttachToChat}
              onClose={() => setActiveScreenshot(null)}
            />
          </React.Suspense>
        )}
      </div>

      {showExtensionDialog && <PreviewExtensionDialog status={extension.status}
        onClose={() => setShowExtensionDialog(false)} onCheck={extension.retry} onSetup={extension.openSetup} />}
      {extension.error && <div role="status" className="px-3 py-2 text-xs text-cozy-muted">{extension.error} <button className="underline" onClick={() => { void extension.retry(); }}>Reconnect preview extension</button></div>}
      {/* Collapsible Console Logs Drawer */}
      {showConsole && (
        <div className="h-52 border-t border-cozy-border/60 bg-cozy-surface/95 backdrop-blur-md flex flex-col shrink-0 select-text animate-in slide-in-from-bottom duration-200">
          <div className="h-9 border-b border-cozy-border/50 px-3.5 flex items-center justify-between text-xs text-cozy-muted bg-cozy-subtle/50">
            <div className="flex items-center space-x-2 font-medium">
              <Terminal className="w-3.5 h-3.5 text-teal-500" />
              <span className="font-mono text-[11px] text-cozy-text">Dev Server Console</span>
            </div>
            <button
              onClick={() => setLogs([])}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] text-cozy-muted hover:text-red-500 hover:bg-red-500/10 transition-all"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3.5 font-mono text-xs text-cozy-muted leading-relaxed whitespace-pre-wrap select-text">
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
