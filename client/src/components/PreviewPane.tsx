import React, { useState, useEffect, useRef } from 'react';
import Ansi from 'ansi-to-react';
import { Play, Square, RotateCw, RefreshCw, ExternalLink, Terminal, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Globe, Trash2, Camera, Loader2, AlertCircle } from 'lucide-react';
import { Task, DevServerState, FileAttachment } from '../types';
import { getDevServerState, startDevServer, stopDevServer, restartDevServer, captureDevServerScreenshot, pingDevServer } from '../api';

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
  const [showConsole, setShowConsole] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

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

  // Listen for in-flight injected tracking script URL updates from iframe
  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      try {
        const data = event.data;
        if (!data || data.type !== 'TERMAI_PREVIEW_URL_CHANGED') return;
        if (data.taskId && data.taskId !== task.id) return;

        if (typeof data.pathname === 'string') {
          let targetPath = data.pathname;
          const prefix = `/api/preview/${task.id}`;
          if (targetPath.startsWith(prefix)) {
            targetPath = targetPath.slice(prefix.length) || '/';
          }
          setPathInput(targetPath);
        }
      } catch {}
    };

    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, [task.id]);

  // Initial fetch
  useEffect(() => {
    getDevServerState(task.id)
      .then((state) => {
        setDevState(state);
        if (state.logs) setLogs(state.logs);
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
    setIsServerReady(false);
    setIsTimedOut(false);
    setAttemptCount(0);
    const next = await startDevServer(task.id);
    setDevState(next);
  };

  const handleStop = async () => {
    await stopDevServer(task.id);
    setDevState((prev) => ({ ...prev, status: 'stopped' }));
    setIsServerReady(false);
    setIsTimedOut(false);
    setAttemptCount(0);
  };

  const handleRestart = async () => {
    setIsServerReady(false);
    setIsTimedOut(false);
    setAttemptCount(0);
    const next = await restartDevServer(task.id);
    setDevState(next);
    setIframeKey((k) => k + 1);
  };

  const handleReloadIframe = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'TERMAI_PREVIEW_RELOAD' }, '*');
    }
    setIframeKey((k) => k + 1);
  };

  const handleGoBack = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'TERMAI_PREVIEW_NAVIGATE_BACK' }, '*');
    }
  };

  const handleGoForward = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'TERMAI_PREVIEW_NAVIGATE_FORWARD' }, '*');
    }
  };

  const handleNavigateToPath = (inputPath: string) => {
    const formatted = inputPath.startsWith('/') ? inputPath : '/' + inputPath;
    setPathInput(formatted);
    const proxyTarget = `/api/preview/${task.id}${formatted}`;
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'TERMAI_PREVIEW_NAVIGATE_TO', url: proxyTarget }, '*');
    } else {
      setIframeKey((k) => k + 1);
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
    try {
      setIsCapturing(true);
      setCaptureError(null);
      const container = previewContainerRef.current;
      const rect = container.getBoundingClientRect();
      const targetWidth = Math.max(100, Math.round(rect.width));
      const targetHeight = Math.max(100, Math.round(rect.height));

      // 1. Browser-native live preview capture (Captures the EXACT live page, session, and interactions on user's screen)
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getDisplayMedia) {
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              displaySurface: 'browser',
            } as any,
            audio: false,
            preferCurrentTab: true,
            selfBrowserSurface: 'include',
            surfaceSwitching: 'include',
            systemAudio: 'exclude',
          } as any);

          const track = stream.getVideoTracks()[0];
          let drawSource: CanvasImageSource | null = null;
          let sourceWidth = 0;
          let sourceHeight = 0;

          // Accelerated GPU frame extraction via ImageCapture if supported (instant, 0ms latency)
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

          // Fallback to video element if ImageCapture is unavailable
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

          track.stop();
          stream.getTracks().forEach((t) => t.stop());

          const rawDataUrl = canvas.toDataURL('image/png');
          const borderedDataUrl = await addBorderToScreenshotDataUrl(rawDataUrl);
          setActiveScreenshot({
            dataUrl: borderedDataUrl,
            width: cropW,
            height: cropH,
          });
          return;
        } catch (displayErr: any) {
          // If user dismissed or cancelled the tab share dialog, gracefully exit
          if (displayErr.name === 'NotAllowedError' || displayErr.name === 'AbortError') {
            return;
          }
          console.warn('Browser getDisplayMedia capture failed, attempting server-side fallback:', displayErr);
        }
      }

      // 2. Server-Side Headless CDP Fallback (For insecure contexts, remote Tailscale web, or headless webviews)
      if (devState.status === 'running' || devState.status === 'starting') {
        try {
          const result = await captureDevServerScreenshot(task.id, {
            path: pathInput,
            width: targetWidth,
            height: targetHeight,
          });

          if (result?.dataUrl) {
            const borderedDataUrl = await addBorderToScreenshotDataUrl(result.dataUrl);
            setActiveScreenshot({
              dataUrl: borderedDataUrl,
              width: result.width || targetWidth,
              height: result.height || targetHeight,
            });
            return;
          }
        } catch (serverErr: any) {
          console.warn('Server-side preview capture fallback failed:', serverErr);
        }
      }

      // 3. Fallback message if neither method succeeded
      const isSecure = typeof window !== 'undefined' ? window.isSecureContext : false;
      const errorMsg = !isSecure
        ? 'Screen capture in the browser requires a secure context (access via http://localhost:5180 or HTTPS) or Edge/Chrome installed on host.'
        : 'Failed to capture preview screenshot. Please verify dev server is running and try again.';
      setCaptureError(errorMsg);
      setTimeout(() => setCaptureError(null), 6000);
    } catch (err: any) {
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        console.error('Failed to capture preview screenshot:', err);
        setCaptureError(err.message || 'Failed to capture preview screenshot');
        setTimeout(() => setCaptureError(null), 6000);
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

  const currentPath = pathInput.startsWith('/') ? pathInput : '/' + pathInput;
  const currentUrl = `http://localhost:${activePort}${currentPath}`;
  const proxyUrl = `/api/preview/${task.id}${currentPath}`;

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent min-w-0 overflow-hidden relative">
      {/* Top Address & Controls Toolbar */}
      <div className="min-h-[64px] py-3.5 px-4 sm:px-5 border-b border-cozy-border/50 bg-cozy-surface/40 backdrop-blur-md flex items-center justify-between shrink-0 gap-3 select-none">
        {/* Server Start/Stop/Restart */}
        <div className="flex items-center space-x-1.5 shrink-0">
          {devState.status === 'running' ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-rose-500/10 border border-rose-500/20 text-rose-500 hover:bg-rose-500/20 transition-all shadow-soft-sm"
              title="Stop dev server"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              onClick={handleStart}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-emerald-500/15 border border-emerald-500/25 text-emerald-500 hover:bg-emerald-500/25 transition-all shadow-glow-mint"
              title="Start local dev server"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start</span>
            </button>
          )}

          <button
            onClick={handleRestart}
            disabled={devState.status !== 'running'}
            className="w-7 h-7 rounded-full flex items-center justify-center text-cozy-muted hover:text-rose-500 hover:bg-cozy-subtle disabled:opacity-30 transition-all"
            title="Restart dev server"
            aria-label="Restart dev server"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Status Pill & Port */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cozy-subtle/80 border border-cozy-border/70 text-xs shadow-soft-sm shrink-0">
          <span
            className={`w-2 h-2 rounded-full ${
              devState.status === 'running' && isServerReady
                ? 'bg-emerald-400 shadow-glow-mint animate-pulse'
                : devState.status === 'running' || devState.status === 'starting'
                ? 'bg-amber-400 animate-ping'
                : 'bg-cozy-muted/40'
            }`}
          />
          <span className="font-mono text-cozy-muted text-[11px] font-medium">
            {devState.status === 'running' && isServerReady
              ? `:${activePort}`
              : devState.status === 'running' || devState.status === 'starting'
              ? `starting :${activePort}`
              : 'offline'}
          </span>
        </div>

        {/* URL Address Bar */}
        <div className="flex-1 max-w-sm flex items-center bg-cozy-surface/90 dark:bg-slate-900/60 border border-cozy-border/80 focus-within:border-rose-400/50 rounded-full px-3 py-1.5 text-xs shadow-soft-sm min-w-0 transition-all">
          <Globe className="w-3.5 h-3.5 text-rose-400 mr-1.5 shrink-0" />
          <span className="text-cozy-muted/60 select-none font-mono hidden md:inline text-[11px]">http://localhost:{activePort}</span>
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleNavigateToPath(pathInput)}
            placeholder="/"
            className="flex-1 bg-transparent text-cozy-text focus:outline-none font-mono px-0.5 ml-0.5 min-w-[30px]"
          />
        </div>

        {/* Action icons */}
        <div className="flex items-center space-x-1 shrink-0">
          <button
            onClick={handleGoBack}
            disabled={devState.status !== 'running' || !isServerReady}
            className="w-7 h-7 rounded-full flex items-center justify-center text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle disabled:opacity-30 transition-all"
            title="Go back"
            aria-label="Go back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            onClick={handleGoForward}
            disabled={devState.status !== 'running' || !isServerReady}
            className="w-7 h-7 rounded-full flex items-center justify-center text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle disabled:opacity-30 transition-all"
            title="Go forward"
            aria-label="Go forward"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

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
                ? 'bg-rose-500/15 text-rose-500'
                : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle disabled:opacity-30'
            }`}
            title="Take Screenshot & Annotate Preview"
          >
            {isCapturing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-500" />
            ) : (
              <Camera className="w-3.5 h-3.5" />
            )}
          </button>

          <a
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`w-7 h-7 rounded-full flex items-center justify-center text-cozy-muted hover:text-rose-500 hover:bg-cozy-subtle transition-all ${
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
                ? 'bg-rose-500/10 border-rose-400/40 text-rose-500'
                : 'bg-cozy-subtle/70 text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle border-cozy-border/70'
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
      <div
        ref={previewContainerRef}
        className="flex-1 relative w-full h-full bg-white dark:bg-[#0e1017] overflow-hidden"
      >
        {/* Error notification banner */}
        {captureError && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 max-w-md px-4 py-2.5 rounded-xl bg-rose-500/95 text-white text-xs shadow-lg backdrop-blur flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 duration-200">
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
              src={proxyUrl}
              title="Task Dev Server Preview"
              className="w-full h-full border-0"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            />
          ) : isTimedOut ? (
            <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-cozy-muted bg-cozy-bg/50 select-none">
              <div className="w-14 h-14 rounded-2.5xl bg-gradient-to-tr from-amber-500/15 via-rose-500/15 to-rose-600/10 border border-amber-400/30 flex items-center justify-center mb-4 shadow-soft-sm text-amber-500">
                <AlertCircle className="w-7 h-7" />
              </div>
              <h3 className="text-base font-semibold text-cozy-text mb-1.5">
                Dev Server Took Too Long to Respond
              </h3>
              <p className="text-xs max-w-md mb-2 text-cozy-muted leading-relaxed">
                The dev server process is running, but no HTTP response was received at{' '}
                <span className="font-mono text-cozy-text font-medium">{currentUrl}</span> after {MAX_RETRY_ATTEMPTS} seconds.
              </p>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-[11px] font-mono text-amber-500 mb-6">
                <span>{MAX_RETRY_ATTEMPTS} retries reached</span>
                <span>•</span>
                <span>Port :{activePort}</span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsTimedOut(false);
                    setAttemptCount(0);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-rose-500 hover:bg-rose-600 text-white transition-all shadow-glow-peach cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Retry Connection</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowConsole(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium bg-cozy-surface/90 hover:bg-cozy-subtle text-cozy-text border border-cozy-border/80 transition-all shadow-soft-sm cursor-pointer"
                >
                  <Terminal className="w-3.5 h-3.5 text-rose-400" />
                  <span>View Console Logs ({logs.length})</span>
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium text-rose-500 hover:bg-rose-500/10 border border-rose-500/20 transition-all cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop Server</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-cozy-muted bg-cozy-bg/50 select-none">
              <div className="relative mb-5">
                <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-rose-500/15 via-amber-500/15 to-emerald-500/15 border border-rose-400/25 flex items-center justify-center shadow-soft-sm relative">
                  <Globe className="w-7 h-7 text-rose-500 animate-pulse" />
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-cozy-surface border border-cozy-border/70 flex items-center justify-center shadow-sm">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-500" />
                  </div>
                </div>
              </div>

              <h3 className="text-base font-semibold text-cozy-text mb-1">
                Waiting for Dev Server...
              </h3>
              <p className="text-xs font-mono text-rose-500/90 dark:text-rose-400 mb-4 font-medium">
                http://localhost:{activePort}
              </p>

              <div className="w-64 max-w-xs mb-3">
                <div className="flex items-center justify-between text-[11px] font-mono text-cozy-muted mb-1.5">
                  <span>Connecting...</span>
                  <span>{attemptCount} / {MAX_RETRY_ATTEMPTS}s</span>
                </div>
                <div className="w-full h-1.5 bg-cozy-border/60 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-rose-500 to-amber-500 transition-all duration-300 rounded-full"
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
                  <Terminal className="w-3.5 h-3.5 text-rose-400" />
                  <span>View Logs ({logs.length})</span>
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-rose-500 hover:bg-rose-500/10 border border-rose-500/20 transition-all cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop</span>
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-cozy-muted">
            <div className="w-14 h-14 rounded-2.5xl bg-gradient-to-tr from-rose-500/10 via-amber-500/10 to-emerald-500/10 border border-rose-400/20 flex items-center justify-center mb-3.5 shadow-soft-sm">
              <Globe className="w-6 h-6 text-rose-400" />
            </div>
            <h3 className="text-base font-semibold text-cozy-text mb-1.5">Local Dev Preview</h3>
            <p className="text-xs max-w-sm mb-5 text-cozy-muted leading-relaxed">
              The development server is currently stopped. Launch Vite / Webpack / Next in this task's isolated worktree to preview changes live.
            </p>
            <button
              onClick={handleStart}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold bg-rose-500 hover:bg-rose-600 text-white transition-all shadow-glow-peach cursor-pointer"
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
                <Loader2 className="w-8 h-8 animate-spin text-rose-500" />
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
              <Terminal className="w-3.5 h-3.5 text-rose-400" />
              <span className="font-mono text-[11px] text-cozy-text">Dev Server Console</span>
            </div>
            <button
              onClick={() => setLogs([])}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] text-cozy-muted hover:text-rose-500 hover:bg-cozy-subtle transition-all"
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
