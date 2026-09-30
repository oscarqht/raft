import React, { useState, useEffect, useRef } from 'react';
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  X,
  Download,
  Sparkles,
  ChevronDown,
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
        setStatus((prev) => {
          if (prev.status === 'Downloaded' && data.status.status === 'Downloading') {
            return prev;
          }
          return data.status;
        });
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
  const displayVersion = currentVersion ? `v${currentVersion}` : 'Updates';

  return (
    <div className="relative inline-flex items-center" ref={containerRef}>
      {/* Navigation Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all shrink-0 cursor-pointer shadow-soft-sm ${
          isOpen
            ? 'bg-teal-500/10 border-teal-400/50 text-teal-600 dark:text-teal-400 shadow-glow-ocean'
            : hasUpdateReady
            ? 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-400/40 text-emerald-600 dark:text-emerald-400 font-semibold shadow-glow-ocean'
            : isDownloading
            ? 'bg-teal-500/15 hover:bg-teal-500/20 border-teal-400/40 text-teal-600 dark:text-teal-400 font-semibold'
            : isChecking
            ? 'bg-cozy-subtle/80 hover:bg-cozy-subtle border-cozy-border/70 text-cozy-muted'
            : 'bg-cozy-subtle/80 hover:bg-cozy-subtle border-cozy-border/70 text-cozy-muted hover:text-cozy-text hover:border-teal-400/30'
        }`}
        title={hasUpdateReady ? 'Update ready to install' : `Alpha Bro ${displayVersion}`}
        aria-label="Software Updates"
      >
        {isChecking ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-500 shrink-0" />
            <span className="font-medium text-cozy-text">Checking…</span>
          </>
        ) : isDownloading ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-500 shrink-0" />
            <span className="font-semibold text-teal-600 dark:text-teal-400">
              Updating {status.data.percent}%
            </span>
          </>
        ) : hasUpdateReady ? (
          <>
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-glow-ocean animate-pulse shrink-0" />
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              Update v{status.data.version} ready
            </span>
          </>
        ) : (
          <>
            <Sparkles className="w-3.5 h-3.5 text-teal-500 shrink-0" />
            <span className="font-medium text-cozy-text">{displayVersion}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-cozy-muted shrink-0 transition-transform duration-200 ${
                isOpen ? 'rotate-180 text-teal-500' : ''
              }`}
            />
          </>
        )}
      </button>

      {/* Popover Card */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-92 rounded-squircle popup-surface bg-white dark:bg-[#1a1d2e] z-50 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 p-2.5 border border-cozy-border/70 shadow-soft-xl">
          {/* Header Pill */}
          <div className="px-3.5 py-2.5 rounded-2xl flex items-center justify-between text-xs font-medium text-cozy-muted bg-cozy-subtle/80 select-none shrink-0 mb-1">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-teal-500/15 border border-teal-500/30 text-teal-600 dark:text-teal-400 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <span className="font-semibold text-cozy-text">Software Update</span>
            </div>
            <div className="flex items-center gap-1.5">
              {currentVersion && (
                <span className="text-[10px] font-mono bg-cozy-surface px-2 py-0.5 rounded-full border border-cozy-border/60 text-cozy-muted font-medium shadow-soft-sm">
                  v{currentVersion}
                </span>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="w-6 h-6 rounded-lg hover:bg-cozy-surface text-cozy-muted hover:text-cozy-text flex items-center justify-center transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex flex-col">
            {isRestarting ? (
              <div className="py-6 px-4 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center mb-3 shadow-soft-sm">
                  <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
                </div>
                <p className="text-sm font-semibold text-cozy-text mb-1">Restarting Alpha Bro…</p>
                <p className="text-xs text-cozy-muted leading-relaxed max-w-xs">
                  Installing update and relaunching the server. This page will reconnect automatically once Alpha Bro is back online.
                </p>
              </div>
            ) : status.status === 'Checking' ? (
              <div className="py-6 px-4 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center mb-3 shadow-soft-sm">
                  <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
                </div>
                <p className="text-sm font-semibold text-cozy-text mb-1">Checking for updates…</p>
                <p className="text-xs text-cozy-muted leading-relaxed">
                  Contacting release feed for the latest version.
                </p>
              </div>
            ) : status.status === 'Downloading' ? (
              <div className="p-3.5 flex flex-col items-stretch text-left">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
                    <span className="text-xs font-semibold text-cozy-text">
                      Downloading v{status.data.version}…
                    </span>
                  </div>
                  <span className="text-xs font-mono font-semibold text-teal-600 dark:text-teal-400">
                    {status.data.percent}%
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-cozy-subtle h-2 rounded-full overflow-hidden mb-2 border border-cozy-border/60">
                  <div
                    className="bg-gradient-to-r from-teal-500 to-emerald-400 h-full transition-all duration-200 rounded-full"
                    style={{ width: `${Math.min(100, Math.max(0, status.data.percent))}%` }}
                  />
                </div>

                <div className="flex justify-between items-center text-[11px] text-cozy-muted mb-2 font-mono">
                  <span>
                    {formatBytes(status.data.downloaded)} / {status.data.total ? formatBytes(status.data.total) : '...'}
                  </span>
                  <span>{status.data.percent === 100 ? 'Verifying package…' : 'Downloading…'}</span>
                </div>

                {status.data.body && (
                  <div className="p-2.5 rounded-xl bg-cozy-subtle/80 border border-cozy-border/60 text-xs text-cozy-muted max-h-24 overflow-y-auto leading-relaxed">
                    {status.data.body}
                  </div>
                )}
              </div>
            ) : status.status === 'Downloaded' ? (
              <div className="p-3 flex flex-col items-stretch text-left">
                <div className="flex items-center gap-3 mb-3 p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 flex items-center justify-center shrink-0 shadow-soft-sm">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-cozy-text">Update Ready</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                        v{status.data.version}
                      </span>
                    </div>
                    <p className="text-xs text-cozy-muted truncate">
                      {currentVersion ? `Upgrading from v${currentVersion}` : 'Ready to install & relaunch'}
                    </p>
                  </div>
                </div>

                {status.data.body && (
                  <div className="p-3 rounded-2xl bg-cozy-subtle/80 border border-cozy-border/70 text-xs text-cozy-muted max-h-36 overflow-y-auto mb-3 leading-relaxed font-sans space-y-1">
                    <div className="font-semibold text-cozy-text text-[11px] uppercase tracking-wider mb-1">
                      Release Notes
                    </div>
                    <div className="whitespace-pre-wrap">{status.data.body}</div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-cozy-border/50">
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
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 active:scale-95 text-white shadow-glow-ocean transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Install &amp; Relaunch</span>
                  </button>
                </div>
              </div>
            ) : status.status === 'UpToDate' ? (
              currentVersion && status.data.current_version && currentVersion !== status.data.current_version ? (
                <div className="py-4 px-3 flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-500 flex items-center justify-center mb-3 shadow-soft-sm">
                    <AlertCircle className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-semibold text-cozy-text mb-1">Restart required</p>
                  <p className="text-xs text-cozy-muted leading-relaxed mb-4 max-w-xs">
                    Alpha Bro has updated to <strong className="text-cozy-text">v{status.data.current_version}</strong>, but the background server is running <strong className="text-cozy-text">v{currentVersion}</strong>. Restart to complete the update.
                  </p>
                  <button
                    type="button"
                    onClick={handleInstall}
                    className="px-4 py-2 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 active:scale-95 text-white shadow-glow-ocean transition-all cursor-pointer"
                  >
                    Restart server
                  </button>
                </div>
              ) : (
                <div className="py-4 px-3 flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 flex items-center justify-center mb-3 shadow-soft-sm">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-semibold text-cozy-text mb-1">You're up to date!</p>
                  <p className="text-xs text-cozy-muted leading-relaxed mb-4 max-w-xs">
                    Alpha Bro <strong className="text-cozy-text font-medium">v{currentVersion || status.data.current_version}</strong> is the latest version available.
                  </p>
                  <button
                    type="button"
                    onClick={handleCheckNow}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-cozy-subtle/80 hover:bg-cozy-subtle border border-cozy-border/80 hover:border-teal-400/40 text-cozy-text shadow-soft-sm active:scale-95 transition-all cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-cozy-muted" />
                    <span>Check again</span>
                  </button>
                </div>
              )
            ) : status.status === 'Error' ? (
              <div className="py-4 px-3 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-500 flex items-center justify-center mb-3 shadow-soft-sm">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-cozy-text mb-1">
                  {status.data.message?.toLowerCase().includes('install')
                    ? 'Update Installation Failed'
                    : status.data.message?.toLowerCase().includes('download')
                    ? 'Update Download Failed'
                    : 'Update Check Failed'}
                </p>
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400 mb-4 max-w-xs break-words">
                  {status.data.message}
                </div>
                <button
                  type="button"
                  onClick={handleCheckNow}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium bg-cozy-subtle/80 hover:bg-cozy-subtle border border-cozy-border/80 hover:border-teal-400/40 text-cozy-text shadow-soft-sm active:scale-95 transition-all cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-cozy-muted" />
                  <span>Try again</span>
                </button>
              </div>
            ) : (
              // Idle state
              <div className="py-4 px-3 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-teal-500/20 via-cyan-500/15 to-sky-500/20 border border-teal-400/30 flex items-center justify-center overflow-hidden mb-3 shadow-soft-sm">
                  <img src="/logo.png" alt="Alpha Bro logo" className="w-8 h-8 object-contain drop-shadow-sm" />
                </div>
                <p className="text-sm font-semibold text-cozy-text mb-1">
                  Alpha Bro {currentVersion ? `v${currentVersion}` : ''}
                </p>
                <p className="text-xs text-cozy-muted leading-relaxed mb-4 max-w-xs">
                  Check for the latest features, improvements, and bug fixes.
                </p>
                <button
                  type="button"
                  onClick={handleCheckNow}
                  className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 active:scale-95 text-white shadow-glow-ocean transition-all cursor-pointer"
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
