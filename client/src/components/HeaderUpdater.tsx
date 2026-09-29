import React, { useState, useEffect, useRef } from 'react';
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  X,
  ArrowRight,
  Download,
} from 'lucide-react';
import { UpdateStatus } from '../types';
import { getUpdaterStatus, checkUpdate, installUpdate } from '../api';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export const HeaderUpdater: React.FC = () => {
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [status, setStatus] = useState<UpdateStatus>({ status: 'Idle' });
  const [isOpen, setIsOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchStatus = async () => {
    try {
      const data = await getUpdaterStatus();
      if (data.current_version) {
        setCurrentVersion(data.current_version);
      }
      if (data.status) {
        setStatus(data.status);
      }
    } catch {
      // Backend may be restarting
    }
  };

  useEffect(() => {
    fetchStatus();

    const onFocus = () => {
      fetchStatus();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Poll while checking, downloading, popover open, or restarting
  useEffect(() => {
    const isBusy = status.status === 'Checking' || status.status === 'Downloading';
    if (!isBusy && !isOpen && !isRestarting) return;

    let pollAttempts = 0;
    const intervalMs = isRestarting ? 1500 : isBusy ? 1000 : 3000;
    const interval = setInterval(() => {
      if (isRestarting) {
        pollAttempts += 1;
        // Wait at least 3 intervals (~4.5s) before polling so the relaunch sequence has begun
        if (pollAttempts >= 3) {
          fetch('/api/settings')
            .then((r) => {
              if (r.ok) {
                clearInterval(interval);
                window.location.reload();
              }
            })
            .catch(() => {});
        }
      } else {
        fetchStatus();
      }
    }, intervalMs);

    return () => clearInterval(interval);
  }, [status.status, isOpen, isRestarting]);

  // Click outside and escape key handling
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleCheckNow = async () => {
    setStatus({ status: 'Checking' });
    try {
      await checkUpdate();
      fetchStatus();
    } catch (err: any) {
      setStatus({
        status: 'Error',
        data: { message: err?.message || 'Failed to check for updates' },
      });
    }
  };

  const handleInstall = async () => {
    setIsRestarting(true);
    try {
      await installUpdate();
    } catch (err: any) {
      setIsRestarting(false);
      setStatus({
        status: 'Error',
        data: { message: err?.message || 'Failed to install update' },
      });
    }
  };

  const hasUpdateReady = status.status === 'Downloaded';
  const isDownloading = status.status === 'Downloading';
  const isChecking = status.status === 'Checking';

  return (
    <div className="relative inline-flex items-center" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shadow-soft-sm transition-all cursor-pointer shrink-0 border ${
          hasUpdateReady
            ? 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-400/40 text-emerald-600 dark:text-emerald-400 font-semibold'
            : isDownloading
            ? 'bg-teal-500/15 hover:bg-teal-500/20 border-teal-400/40 text-teal-600 dark:text-teal-400 font-semibold'
            : isChecking
            ? 'bg-cozy-subtle/80 hover:bg-cozy-subtle border-cozy-border/80 text-cozy-muted'
            : 'bg-cozy-subtle/80 hover:bg-cozy-subtle border-cozy-border/80 hover:border-teal-400/40 text-cozy-muted hover:text-cozy-text'
        }`}
        title="Software Updates"
        aria-label="Software Updates"
      >
        {isChecking ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-500 shrink-0" />
            <span>Checking…</span>
          </>
        ) : isDownloading ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-500 shrink-0" />
            <span>Updating {status.data.percent}%</span>
          </>
        ) : hasUpdateReady ? (
          <>
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-glow-ocean animate-pulse shrink-0" />
            <span>Update v{status.data.version} ready</span>
          </>
        ) : (
          <span>{currentVersion ? `v${currentVersion}` : 'Updates'}</span>
        )}
      </button>

      {isOpen && (
        <div className="absolute top-[calc(100%+10px)] right-0 w-84 sm:w-96 rounded-2xl glass-panel popup-surface border border-cozy-border/80 shadow-2xl z-50 p-4.5 animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-cozy-border/60">
            <div className="flex flex-col text-left">
              <span className="text-sm font-semibold text-cozy-text">Software Update</span>
              {currentVersion && (
                <span className="text-xs text-cozy-muted">Current: v{currentVersion}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors cursor-pointer"
              aria-label="Close update panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex flex-col items-center text-center">
            {isRestarting ? (
              <div className="py-4 flex flex-col items-center">
                <Loader2 className="w-9 h-9 animate-spin text-teal-500 mb-3" />
                <p className="text-sm font-semibold text-cozy-text mb-1">Restarting Raft…</p>
                <p className="text-xs text-cozy-muted leading-relaxed max-w-xs">
                  Installing update and relaunching the server. This page will reconnect automatically once Raft is back online.
                </p>
              </div>
            ) : status.status === 'Checking' ? (
              <div className="py-4 flex flex-col items-center">
                <Loader2 className="w-7 h-7 animate-spin text-teal-500 mb-2.5" />
                <p className="text-sm font-semibold text-cozy-text mb-1">Checking for updates…</p>
                <p className="text-xs text-cozy-muted">Contacting release server for the latest version.</p>
              </div>
            ) : status.status === 'UpToDate' ? (
              currentVersion && status.data.current_version && currentVersion !== status.data.current_version ? (
                <div className="py-3 flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-500 flex items-center justify-center mb-2.5">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-semibold text-cozy-text mb-1">Restart required</p>
                  <p className="text-xs text-cozy-muted leading-relaxed mb-4 max-w-xs">
                    Raft has updated to <strong className="text-cozy-text">v{status.data.current_version}</strong>, but the background server is running <strong className="text-cozy-text">v{currentVersion}</strong>. Restart to complete the update.
                  </p>
                  <button
                    type="button"
                    onClick={handleInstall}
                    className="px-4 py-1.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white shadow-glow-ocean transition-all cursor-pointer"
                  >
                    Restart server
                  </button>
                </div>
              ) : (
                <div className="py-3 flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 flex items-center justify-center mb-2.5">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-semibold text-cozy-text mb-1">You're up to date!</p>
                  <p className="text-xs text-cozy-muted leading-relaxed mb-4">
                    Raft <strong className="text-cozy-text">v{currentVersion || status.data.current_version}</strong> is the latest version available.
                  </p>
                  <button
                    type="button"
                    onClick={handleCheckNow}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-cozy-subtle/80 hover:bg-cozy-subtle border border-cozy-border/80 hover:border-teal-400/40 text-cozy-text shadow-soft-sm transition-all cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-cozy-muted" />
                    <span>Check again</span>
                  </button>
                </div>
              )
            ) : status.status === 'Downloading' ? (
              <div className="w-full py-2 flex flex-col items-center">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-cozy-subtle border border-cozy-border/70 text-cozy-muted">
                    v{status.data.current_version}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-cozy-muted" />
                  <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-teal-500/15 border border-teal-500/30 text-teal-600 dark:text-teal-400">
                    v{status.data.version}
                  </span>
                </div>
                <p className="text-sm font-semibold text-cozy-text mb-2.5">Downloading update…</p>
                <div className="w-full h-2 bg-cozy-subtle/80 rounded-full border border-cozy-border/60 overflow-hidden mb-2">
                  <div
                    className="h-full bg-gradient-to-r from-teal-500 to-cyan-500 rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(5, Math.min(status.data.percent, 100))}%` }}
                  />
                </div>
                <div className="w-full flex justify-between text-xs text-cozy-muted">
                  <span>{status.data.percent}%</span>
                  <span>
                    {formatBytes(status.data.downloaded)}
                    {status.data.total ? ` / ${formatBytes(status.data.total)}` : ''}
                  </span>
                </div>
              </div>
            ) : status.status === 'Downloaded' ? (
              <div className="w-full py-2 flex flex-col items-center">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-cozy-subtle border border-cozy-border/70 text-cozy-muted">
                    v{status.data.current_version}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-cozy-muted" />
                  <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                    v{status.data.version}
                  </span>
                </div>
                <p className="text-sm font-semibold text-cozy-text mb-1">New version ready to install</p>
                {status.data.body ? (
                  <div className="w-full max-h-36 overflow-y-auto text-left bg-cozy-subtle/50 border border-cozy-border/60 rounded-xl p-3 my-2.5">
                    <div className="text-[11px] font-semibold text-cozy-muted uppercase tracking-wider mb-1">
                      Release Notes
                    </div>
                    <div className="text-xs text-cozy-text whitespace-pre-wrap leading-relaxed font-mono">
                      {status.data.body}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-cozy-muted mb-4">
                    Download completed. Restart Raft now to apply the update.
                  </p>
                )}
                <div className="flex items-center justify-end gap-2 w-full mt-2">
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-all cursor-pointer"
                  >
                    Later
                  </button>
                  <button
                    type="button"
                    onClick={handleCheckNow}
                    className="px-3 py-1.5 rounded-full text-xs font-medium bg-cozy-subtle border border-cozy-border/70 hover:border-teal-400/40 text-cozy-text transition-all cursor-pointer"
                  >
                    Check again
                  </button>
                  <button
                    type="button"
                    onClick={handleInstall}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white shadow-glow-ocean transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Install &amp; Relaunch</span>
                  </button>
                </div>
              </div>
            ) : status.status === 'Error' ? (
              <div className="py-3 flex flex-col items-center">
                <div className="w-10 h-10 rounded-full bg-red-500/15 border border-red-500/30 text-red-500 flex items-center justify-center mb-2.5">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <p className="text-sm font-semibold text-cozy-text mb-1">
                  {status.data.message?.toLowerCase().includes('install')
                    ? 'Update Installation Failed'
                    : status.data.message?.toLowerCase().includes('download')
                    ? 'Update Download Failed'
                    : 'Update Check Failed'}
                </p>
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400 mb-3 max-w-xs break-words">
                  {status.data.message}
                </div>
                <button
                  type="button"
                  onClick={handleCheckNow}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-cozy-subtle/80 hover:bg-cozy-subtle border border-cozy-border/80 hover:border-teal-400/40 text-cozy-text shadow-soft-sm transition-all cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-cozy-muted" />
                  <span>Try again</span>
                </button>
              </div>
            ) : (
              // Idle
              <div className="py-3 flex flex-col items-center">
                <p className="text-sm font-semibold text-cozy-text mb-1">
                  Raft {currentVersion ? `v${currentVersion}` : ''}
                </p>
                <p className="text-xs text-cozy-muted leading-relaxed mb-4 max-w-xs">
                  Check for the latest features, improvements, and bug fixes.
                </p>
                <button
                  type="button"
                  onClick={handleCheckNow}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white shadow-glow-ocean transition-all cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Check for updates</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
