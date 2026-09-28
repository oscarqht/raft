import React, { useState, useEffect, useRef } from 'react';
import Ansi from 'ansi-to-react';
import { Play, Square, RotateCw, RefreshCw, ExternalLink, Terminal, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Globe, Trash2, Camera, Loader2, AlertCircle, Package, CheckCircle2, X } from 'lucide-react';
import { Task, DevServerState, FileAttachment } from '../types';
import { getDevServerState, startDevServer, stopDevServer, restartDevServer, pingDevServer } from '../api';
import { useOptionalScriptExecution } from '../contexts/ScriptExecutionContext';

const PreviewAnnotationOverlay = React.lazy(() =>
  import('./PreviewAnnotationOverlay').then((m) => ({ default: m.PreviewAnnotationOverlay }))
);

const MAX_RETRY_ATTEMPTS = 30; // 30 seconds
const RETRY_INTERVAL_MS = 1000; // 1s

interface PreviewPaneProps {
  task: Task;
  ws: WebSocket | null;
  onAttachToChat?: (attachments: FileAttachment[]) => void;
}

export const PreviewPane: React.FC<PreviewPaneProps> = ({ task, ws, onAttachToChat }) => {
  const [devState, setDevState] = useState<DevServerState>({
    taskId: task.id,
    status: 'stopped',
    logs: [],
    devCmd: '',
    worktreePath: '',
  });

  const [pathInput, setPathInput] = useState('/');
  const [iframeKey, setIframeKey] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [showConsole, setShowConsole] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);

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

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect) {
          setPanelWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, []);

  const isCompact = panelWidth < 620;

  const stopCaptureStream = () => {
    if (captureStreamRef.current) {
      captureStreamRef.current.getTracks().forEach((t) => t.stop());
      captureStreamRef.current = null;
    }
  };

  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [activeScreenshot, setActiveScreenshot] = useState<{
    dataUrl: string;
    width: number;
    height: number;
  } | null>(null);

  // Dev server connection readiness polling states
  const [isServerReady, setIsServerReady] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);
  const [isTimedOut, setIsTimedOut] = useState(false);

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

  // Clean up screen capture stream on component unmount
  useEffect(() => {
    return () => {
      stopCaptureStream();
    };
  }, []);

  // Reset dev server logs, readiness, and active capture stream when switching tasks
  useEffect(() => {
    setLogs([]);
    setIsServerReady(false);
    setIsTimedOut(false);
    setAttemptCount(0);
    setCanGoBack(false);
    setCanGoForward(false);
    setPathInput('/');
    stopCaptureStream();
  }, [task.id]);

  // Listen for URL changes and navigation history depth from injected preview tracker
  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      try {
        if (!event.data || typeof event.data !== 'object') return;
        if (event.data.type === 'RAFT_PREVIEW_URL_CHANGED') {
          if (event.data.taskId && event.data.taskId !== task.id) return;
          if (typeof event.data.pathname === 'string') {
            setPathInput(event.data.pathname);
          }
          if (typeof event.data.canGoBack === 'boolean') {
            setCanGoBack(event.data.canGoBack);
          }
          if (typeof event.data.canGoForward === 'boolean') {
            setCanGoForward(event.data.canGoForward);
          }
        }
      } catch {}
    };

    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
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
        if (msg.type === 'dev_server_state') {
          setDevState(msg.state);
          if (msg.state?.logs && msg.state.logs.length > 0) {
            setLogs((prev) => (prev.length === 0 ? msg.state.logs : prev));
          }
        } else if (msg.type === 'dev_server_log') {
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
    getDevServerState(task.id)
      .then((state) => {
        setDevState(state);
        if (state.logs && state.logs.length > 0) {
          setLogs((prev) => (prev.length === 0 ? state.logs : prev));
        }
      })
      .catch(() => {});
  }, [task.id]);

  // Reset readiness when server stops or errors
  useEffect(() => {
    if (devState.status === 'stopped' || devState.status === 'error') {
      setIsServerReady(false);
      setAttemptCount(0);
      setIsTimedOut(false);
    }
  }, [devState.status]);

  // Polling readiness check effect
  const activePort = devState.port || 5173;
  useEffect(() => {
    // Only poll when server is running or starting, and not yet marked ready or timed out
    if (devState.status !== 'running' && devState.status !== 'starting') return;
    if (isServerReady || isTimedOut) return;

    let isMounted = true;
    let timerId: any = null;

    const checkReady = async () => {
      let ready = false;

      // 1. Backend ping probe (checks TCP/HTTP on host)
      try {
        const ping = await pingDevServer(task.id);
        if (ping.ready) {
          ready = true;
        }
      } catch {}

      // 2. Direct browser fetch fallback probe
      if (!ready) {
        try {
          const controller = new AbortController();
          const abortTimer = setTimeout(() => controller.abort(), 800);
          await fetch(`http://localhost:${activePort}/`, {
            mode: 'no-cors',
            cache: 'no-store',
            signal: controller.signal,
          });
          clearTimeout(abortTimer);
          ready = true;
        } catch {}
      }

      if (!isMounted) return;

      if (ready) {
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

    return () => {
      isMounted = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [devState.status, isServerReady, isTimedOut, task.id, activePort]);

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
    stopCaptureStream();
    await stopDevServer(task.id);
    setDevState((prev) => ({ ...prev, status: 'stopped' }));
    setIsServerReady(false);
    setIsTimedOut(false);
    setAttemptCount(0);
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

  const handleReloadIframe = () => {
    setIframeKey((k) => k + 1);
  };

  const handleNavigateAddress = (targetPath?: string) => {
    const raw = targetPath ?? pathInput;
    const normalized = raw.startsWith('/') ? raw : '/' + raw;
    setPathInput(normalized);

    if (iframeRef.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          {
            type: 'RAFT_PREVIEW_NAVIGATE_TO',
            path: normalized,
          },
          '*'
        );
      } catch {
        handleReloadIframe();
      }
    } else {
      handleReloadIframe();
    }
  };

  const handleNavigateBack = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'RAFT_PREVIEW_NAVIGATE_BACK' }, '*');
    }
  };

  const handleNavigateForward = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'RAFT_PREVIEW_NAVIGATE_FORWARD' }, '*');
    }
  };

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
    if (isCapturing || !previewContainerRef.current) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        setCaptureError(
          'Screen capture requires a Secure Context (HTTPS or localhost). Your browser disables it over plain HTTP on remote/Tailscale IP.'
        );
      } else {
        setCaptureError('Screen capture is not supported in this browser environment.');
      }
      setTimeout(() => setCaptureError(null), 6000);
      return;
    }

    try {
      setIsCapturing(true);
      setCaptureError(null);
      const container = previewContainerRef.current;
      const rect = container.getBoundingClientRect();

      // 1. Check if we have an active live stream from an earlier capture in this session
      let stream = captureStreamRef.current;
      let track = stream?.getVideoTracks().find((t) => t.readyState === 'live');

      // 2. If no active track, request getDisplayMedia (prompts user ONCE per session)
      if (!stream || !track) {
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              displaySurface: 'browser',
            } as any,
            audio: false,
            preferCurrentTab: true,
            selfBrowserSurface: 'include',
            surfaceSwitching: 'include',
            systemAudio: 'exclude',
          } as any);

          track = stream.getVideoTracks()[0];
          if (!track) {
            throw new Error('No video track returned from screen capture');
          }

          // When user stops sharing via browser bar, clear ref
          track.onended = () => {
            if (captureStreamRef.current === stream) {
              captureStreamRef.current = null;
            }
          };

          captureStreamRef.current = stream;
        } catch (displayErr: any) {
          // If user dismissed or cancelled the tab share dialog, gracefully exit
          if (displayErr.name === 'NotAllowedError' || displayErr.name === 'AbortError') {
            return;
          }
          throw displayErr;
        }
      }

      let drawSource: CanvasImageSource | null = null;
      let sourceWidth = 0;
      let sourceHeight = 0;

      // 3. Accelerated GPU frame extraction via ImageCapture if supported (instant, 0ms latency)
      if (typeof (window as any).ImageCapture !== 'undefined') {
        try {
          const imageCapture = new (window as any).ImageCapture(track);
          const bitmap = await imageCapture.grabFrame();
          sourceWidth = bitmap.width;
          sourceHeight = bitmap.height;
          drawSource = bitmap;
        } catch {
          drawSource = null;
        }
      }

      // 4. Fallback to video element if ImageCapture is unavailable
      if (!drawSource) {
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();

        await new Promise<void>((resolve) => {
          if (video.readyState >= 2) return resolve();
          video.onloadeddata = () => resolve();
        });

        // Brief delay for video frame buffer
        await new Promise((r) => setTimeout(r, 60));

        sourceWidth = video.videoWidth;
        sourceHeight = video.videoHeight;
        drawSource = video;
      }

      const windowW = window.innerWidth;
      const windowH = window.innerHeight;

      const scaleX = sourceWidth / windowW;
      const scaleY = sourceHeight / windowH;

      let cropX = Math.max(0, Math.round(rect.left * scaleX));
      let cropY = Math.max(0, Math.round(rect.top * scaleY));
      let cropW = Math.min(sourceWidth - cropX, Math.round(rect.width * scaleX));
      let cropH = Math.min(sourceHeight - cropY, Math.round(rect.height * scaleY));

      if (cropW <= 0 || cropH <= 0) {
        cropX = 0;
        cropY = 0;
        cropW = sourceWidth;
        cropH = sourceHeight;
      }

      const canvas = document.createElement('canvas');
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to create 2d canvas context');

      ctx.drawImage(drawSource, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      // Release ImageBitmap resources if applicable
      if (typeof (drawSource as any).close === 'function') {
        (drawSource as any).close();
      }

      // NOTE: Intentionally keep track and stream active in captureStreamRef for persistent session reuse!

      const rawDataUrl = canvas.toDataURL('image/png');
      const borderedDataUrl = await addBorderToScreenshotDataUrl(rawDataUrl);
      setActiveScreenshot({
        dataUrl: borderedDataUrl,
        width: cropW,
        height: cropH,
      });
    } catch (err: any) {
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        console.error('Failed to capture preview screenshot:', err);
        setCaptureError(err.message || 'Failed to capture preview screenshot');
        setTimeout(() => setCaptureError(null), 5000);
      }
    } finally {
      setIsCapturing(false);
    }
  };

  const handleAttachToChat = (attachments: FileAttachment[]) => {
    setActiveScreenshot(null);
    if (onAttachToChat) {
      onAttachToChat(attachments);
    } else {
      window.dispatchEvent(new CustomEvent('add-pending-attachments', { detail: attachments }));
    }
  };

  const activeDevPort = devState.port || 5173;
  const activeProxyPort = devState.proxyPort || activeDevPort;
  const previewHostname = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? window.location.hostname
    : 'localhost';
  const currentPath = pathInput.startsWith('/') ? pathInput : '/' + pathInput;
  const iframeSrc = `http://${previewHostname}:${activeProxyPort}${currentPath}`;
  const externalUrl = `http://${previewHostname}:${activeDevPort}${currentPath}`;

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
      <div className="min-h-[64px] py-3.5 px-3 sm:px-4 md:px-5 border-b border-cozy-border/50 bg-cozy-surface/40 backdrop-blur-md flex items-center justify-between shrink-0 gap-2 sm:gap-3 select-none">
        {/* Server Start/Stop/Restart */}
        <div className="flex items-center space-x-1.5 shrink-0">
          {devState.status === 'running' ? (
            <button
              onClick={handleStop}
              className={`flex items-center gap-1.5 rounded-full text-xs font-medium bg-red-500/10 border border-red-500/20 text-red-500 hover:bg-red-500/20 transition-all shadow-soft-sm ${
                isCompact ? 'w-8 h-8 justify-center p-0' : 'px-3 py-1.5'
              }`}
              title="Stop dev server"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              {!isCompact && <span>Stop</span>}
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={isInstalling || installFailed}
              className={`flex items-center gap-1.5 rounded-full text-xs font-medium transition-all ${
                isCompact ? 'w-8 h-8 justify-center p-0' : 'px-3.5 py-1.5'
              } ${
                isInstalling || installFailed
                  ? 'bg-cozy-subtle/80 border border-cozy-border text-cozy-muted cursor-not-allowed opacity-60'
                  : 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-500 hover:bg-emerald-500/25 shadow-glow-mint'
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
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              {!isCompact && <span>{isInstalling ? 'Installing...' : 'Start'}</span>}
            </button>
          )}

          <button
            onClick={handleRestart}
            disabled={devState.status !== 'running'}
            className="w-7 h-7 rounded-full flex items-center justify-center text-cozy-muted hover:text-teal-500 hover:bg-cozy-subtle disabled:opacity-30 transition-all"
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
              disabled={devState.status !== 'running' || !isServerReady || !canGoBack}
              className="w-7 h-7 rounded-full flex items-center justify-center text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle disabled:opacity-30 transition-all cursor-pointer disabled:cursor-not-allowed"
              title="Back"
              aria-label="Back"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleNavigateForward}
              disabled={devState.status !== 'running' || !isServerReady || !canGoForward}
              className="w-7 h-7 rounded-full flex items-center justify-center text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle disabled:opacity-30 transition-all cursor-pointer disabled:cursor-not-allowed"
              title="Forward"
              aria-label="Forward"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* URL Address Bar */}
        {!isCompact && (
          <div className="flex-1 max-w-sm flex items-center bg-cozy-surface/90 dark:bg-slate-900/60 border border-cozy-border/80 focus-within:border-teal-400/50 rounded-full px-3 py-1.5 text-xs shadow-soft-sm min-w-0 transition-all">
            <Globe className="w-3.5 h-3.5 text-teal-500 mr-1.5 shrink-0" />
            <span className="text-cozy-muted/60 select-none font-mono hidden md:inline text-[11px]">http://localhost:{activeDevPort}</span>
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNavigateAddress()}
              placeholder="/"
              className="flex-1 bg-transparent text-cozy-text focus:outline-none font-mono px-0.5 ml-0.5 min-w-[30px]"
            />
          </div>
        )}

        {/* Action icons & Status badge at very right edge */}
        <div className="flex items-center space-x-1 shrink-0">
          <button
            onClick={handleReloadIframe}
            disabled={devState.status !== 'running' || !isServerReady}
            className="w-7 h-7 rounded-full flex items-center justify-center text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle disabled:opacity-30 transition-all"
            title="Reload preview"
            aria-label="Reload preview"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>

          {/* Screenshot & Annotate Preview button */}
          <button
            onClick={handleCaptureScreenshot}
            disabled={devState.status !== 'running' || !isServerReady || isCapturing}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
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

          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`w-7 h-7 rounded-full flex items-center justify-center text-cozy-muted hover:text-teal-500 hover:bg-cozy-subtle transition-all ${
              devState.status !== 'running' || !isServerReady ? 'pointer-events-none opacity-30' : ''
            }`}
            title="Open in external browser window"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <button
            onClick={() => setShowConsole(!showConsole)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border shadow-soft-sm ${
              showConsole
                ? 'bg-teal-500/10 border-teal-400/40 text-teal-600 dark:text-teal-400'
                : 'bg-cozy-subtle/70 text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle border-cozy-border/70'
            }`}
            title="Toggle Console Logs"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="font-mono text-[11px]">{logs.length}</span>
            {showConsole ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          </button>

          {/* Status Pill & Port at very right edge */}
          <div
            className={`flex items-center gap-1.5 rounded-full bg-cozy-subtle/80 border border-cozy-border/70 text-xs shadow-soft-sm shrink-0 ml-1 ${
              isCompact ? 'w-8 h-8 justify-center p-0' : 'px-2.5 py-1'
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
              className={`w-2 h-2 rounded-full ${
                devState.status === 'running' && isServerReady
                  ? 'bg-emerald-400 shadow-glow-mint animate-pulse'
                  : devState.status === 'running' || devState.status === 'starting'
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-cozy-muted/40'
              }`}
            />
            {!isCompact && (
              <span className="font-mono text-cozy-muted text-[11px] font-medium">
                {devState.status === 'running' && isServerReady
                  ? `:${activeDevPort}`
                  : devState.status === 'running' || devState.status === 'starting'
                  ? `starting :${activeDevPort}`
                  : 'offline'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Preview Frame / Placeholder */}
      <div
        ref={previewContainerRef}
        className="flex-1 relative w-full h-full bg-white dark:bg-[#0e1017] overflow-hidden"
      >
        {/* Error notification banner */}
        {captureError && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 max-w-md px-4 py-2.5 rounded-xl bg-red-500/95 text-white text-xs shadow-lg backdrop-blur flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 duration-200">
            <span className="flex-1 leading-snug">{captureError}</span>
            <button
              onClick={() => setCaptureError(null)}
              className="text-white/80 hover:text-white text-sm font-semibold px-1"
            >
              ✕
            </button>
          </div>
        )}

        {devState.status === 'running' || devState.status === 'starting' ? (
          isServerReady ? (
            <iframe
              ref={iframeRef}
              key={iframeKey}
              src={iframeSrc}
              title="Task Dev Server Preview"
              className="w-full h-full border-0"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
            />
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
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium text-red-500 hover:bg-red-500/10 border border-red-500/20 transition-all cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop Server</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-cozy-muted bg-cozy-bg/50 select-none">
              <div className="relative mb-5">
                <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-teal-500/15 via-cyan-500/15 to-emerald-500/15 border border-teal-400/25 flex items-center justify-center shadow-soft-sm relative">
                  <Globe className="w-7 h-7 text-teal-500 animate-pulse" />
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-cozy-surface border border-cozy-border/70 flex items-center justify-center shadow-sm">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-500" />
                  </div>
                </div>
              </div>

              <h3 className="text-base font-semibold text-cozy-text mb-1">
                Waiting for Dev Server...
              </h3>
              <p className="text-xs font-mono text-teal-600/90 dark:text-teal-400 mb-4 font-medium">
                http://localhost:{activeDevPort}
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
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-red-500 hover:bg-red-500/10 border border-red-500/20 transition-all cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop</span>
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
