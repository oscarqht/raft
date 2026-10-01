import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Clock,
  Coins,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Layers,
  Copy,
  Check,
} from 'lucide-react';
import { AgentUsageSnapshot, CliInfo } from '../types';
import { getAllAgentUsages } from '../api';
import { getCachedAgentUsages, setCachedAgentUsages } from '../cache';

interface AgentUsageCardProps {
  clis: CliInfo[];
}

export const AgentUsageCard: React.FC<AgentUsageCardProps> = ({
  clis,
}) => {
  const [usages, setUsages] = useState<Record<string, AgentUsageSnapshot>>(() => {
    return getCachedAgentUsages() || {};
  });
  const [isLoading, setIsLoading] = useState(() => {
    const cached = getCachedAgentUsages();
    return !cached || Object.keys(cached).length === 0;
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedBrew, setCopiedBrew] = useState(false);
  const isMountedRef = React.useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadAllUsages = useCallback(async (refresh = false) => {
    try {
      if (refresh) {
        setIsRefreshing(true);
      } else {
        const cached = getCachedAgentUsages();
        if (!cached || Object.keys(cached).length === 0) {
          setIsLoading(true);
        } else {
          setIsRefreshing(true);
        }
      }
      setError(null);
      const data = await getAllAgentUsages(refresh);
      if (data && typeof data === 'object') {
        setCachedAgentUsages(data);
        if (isMountedRef.current) {
          setUsages(data);
        }
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || 'Failed to fetch AI agent usage');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    loadAllUsages(false);
  }, [loadAllUsages]);

  const handleRefresh = () => {
    loadAllUsages(true);
  };

  const handleCopyInstall = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedBrew(true);
      setTimeout(() => setCopiedBrew(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = cmd;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedBrew(true);
      setTimeout(() => setCopiedBrew(false), 2000);
    }
  };

  const snapshots = Object.values(usages).filter((snapshot) => snapshot.cli.toLowerCase() !== 'alpha');
  const missingCodexBar = snapshots.some((snapshot) => snapshot.error?.includes('CodexBar CLI not found'));

  const getMeterColorClass = (remainingPercent: number) => {
    if (remainingPercent > 50) {
      return 'bg-gradient-to-r from-emerald-500 to-teal-400';
    }
    if (remainingPercent >= 20) {
      return 'bg-gradient-to-r from-amber-500 to-amber-400';
    }
    return 'bg-gradient-to-r from-rose-500 to-red-500';
  };

  const getBadgeColorClass = (remainingPercent: number) => {
    if (remainingPercent > 50) {
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-400/30';
    }
    if (remainingPercent >= 20) {
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-400/30';
    }
    return 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-400/30';
  };

  const formatCostAmount = (val: number | null | undefined, currency?: string | null) => {
    if (val === null || val === undefined) return '0';
    const isUsd = (currency || '').toUpperCase() === 'USD';
    if (isUsd) {
      return `$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return Number(val).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  };

  return (
    <div className="space-y-4 pt-1">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isLoading || isRefreshing}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-cozy-surface hover:bg-cozy-subtle border border-cozy-border text-cozy-muted hover:text-cozy-text transition-all disabled:opacity-50 shadow-soft-sm cursor-pointer whitespace-nowrap"
          title="Refresh quotas from CodexBar"
        >
          <RefreshCw className={`w-3 h-3 text-teal-500 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? 'Updating...' : 'Refresh Quotas'}</span>
        </button>
      </div>

      {/* Loading state */}
      {(isLoading || isRefreshing) && snapshots.length === 0 && (
        <div className="p-6 rounded-2xl bg-cozy-subtle/30 border border-cozy-border/70 flex flex-col items-center justify-center gap-2.5 text-center">
          <RefreshCw className="w-5 h-5 text-teal-500 animate-spin" />
          <div className="text-xs font-medium text-cozy-muted">
            Fetching live usage and quota status via CodexBar...
          </div>
        </div>
      )}

      {/* Error state: CodexBar CLI missing banner */}
      {missingCodexBar && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>CodexBar CLI Not Detected</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
              Usage Tracking
            </span>
          </div>
          <p className="text-xs text-cozy-muted">
            Install CodexBar to track real-time AI usage quotas, spend allowances, and monthly credit limits directly in Raft.
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono bg-cozy-surface px-3 py-1.5 rounded-xl border border-cozy-border text-cozy-text flex-1">
              brew install steipete/tap/codexbar
            </code>
            <button
              type="button"
              onClick={() => handleCopyInstall('brew install steipete/tap/codexbar')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white shadow-soft-sm cursor-pointer shrink-0"
            >
              {copiedBrew ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedBrew ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>
      )}

      {/* General error message */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!isLoading && !isRefreshing && !error && snapshots.length === 0 && (
        <div className="p-4 rounded-2xl bg-cozy-subtle/30 border border-cozy-border/70 text-xs text-cozy-muted">
          No provider budget data is available yet. Refresh quotas to try again.
        </div>
      )}

      {/* Usage Snapshots for all non-Alpha providers */}
      {snapshots.map((currentSnapshot) => {
        const isCliReady = clis.some(
          (c) => c.name.toLowerCase() === currentSnapshot.cli.toLowerCase() && c.available
        );
        return (
          <div key={currentSnapshot.cli} className="space-y-4 animate-in fade-in duration-150">
            {/* Account & Status Header Bar */}
            <div className="p-3 sm:p-3.5 rounded-2xl bg-cozy-subtle/50 border border-cozy-border flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="font-bold text-cozy-text flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-teal-500" />
                  {currentSnapshot.providerName}
                </span>

                {currentSnapshot.accountPlan && (
                  <span className="px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 font-semibold text-[11px]">
                    {currentSnapshot.accountPlan}
                  </span>
                )}

                {currentSnapshot.organization && (
                  <span className="px-2 py-0.5 rounded-full bg-cozy-surface text-cozy-muted border border-cozy-border font-medium text-[11px]">
                    Org: {currentSnapshot.organization}
                  </span>
                )}

                {currentSnapshot.accountEmail && (
                  <span className="font-mono text-cozy-muted text-[11px] bg-cozy-surface px-2 py-0.5 rounded-md border border-cozy-border">
                    {currentSnapshot.accountEmail}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <span className="text-[11px] text-cozy-muted/80">
                  {isRefreshing ? (
                    <span className="text-teal-500 flex items-center gap-1 font-medium">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
                      Fetching latest...
                    </span>
                  ) : (
                    `Updated ${new Date(currentSnapshot.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  )}
                </span>

                {isCliReady ? (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Ready
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] text-amber-500 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    CLI Not in PATH
                  </span>
                )}
              </div>
            </div>

            {currentSnapshot.error && !currentSnapshot.error.includes('CodexBar CLI not found') && (
              <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{currentSnapshot.error}</span>
              </div>
            )}

            {/* Warning Banner if limit reached */}
            {currentSnapshot.statusMessage && (
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 flex items-start gap-2.5 text-rose-600 dark:text-rose-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="text-xs font-bold">{currentSnapshot.statusMessage}</div>
                  <div className="text-[11px] opacity-90">
                    {currentSnapshot.costLimit?.resetDescription
                      ? `Quota will replenish automatically (${currentSnapshot.costLimit.resetDescription}).`
                      : 'You have reached your allocated quota window for this cycle.'}
                  </div>
                </div>
              </div>
            )}

            {/* Primary Rate Window (only shown if real non-placeholder window exists) */}
            {currentSnapshot.primaryWindow && (
              <div className="p-4 rounded-2xl bg-cozy-surface border border-cozy-border space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-teal-500" />
                    <span className="text-xs font-bold text-cozy-text">
                      Session Window ({currentSnapshot.primaryWindow.windowMinutes ? `${Math.round(currentSnapshot.primaryWindow.windowMinutes / 60)}h` : '5h'})
                    </span>
                  </div>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${getBadgeColorClass(
                      currentSnapshot.primaryWindow.remainingPercent
                    )}`}
                  >
                    {currentSnapshot.primaryWindow.remainingPercent}% remaining
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="h-2.5 w-full bg-cozy-subtle rounded-full overflow-hidden border border-cozy-border/60">
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${getMeterColorClass(
                      currentSnapshot.primaryWindow.remainingPercent
                    )}`}
                    style={{ width: `${Math.max(3, currentSnapshot.primaryWindow.remainingPercent)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-cozy-muted font-mono">
                  <span>Used: {currentSnapshot.primaryWindow.usedPercent}%</span>
                  <span>{currentSnapshot.primaryWindow.resetDescription || 'Active cycle'}</span>
                </div>
              </div>
            )}

            {/* Spend Control / Credit Limit (codexCreditLimit for Codex, providerCost for Claude) */}
            {currentSnapshot.costLimit && (
              <div className="p-4 rounded-2xl bg-cozy-surface border border-cozy-border space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Coins className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-xs font-bold text-cozy-text">
                      {currentSnapshot.costLimit.period || 'Credit / Spend Limit'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {typeof currentSnapshot.costLimit.remainingPercent === 'number' && (
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${getBadgeColorClass(
                          currentSnapshot.costLimit.remainingPercent
                        )}`}
                      >
                        {currentSnapshot.costLimit.remainingPercent}% remaining
                      </span>
                    )}
                  </div>
                </div>

                {/* Usage Bar */}
                {typeof currentSnapshot.costLimit.remainingPercent === 'number' && (
                  <div className="h-2.5 w-full bg-cozy-subtle rounded-full overflow-hidden border border-cozy-border/60">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${getMeterColorClass(
                        currentSnapshot.costLimit.remainingPercent
                      )}`}
                      style={{ width: `${Math.max(3, currentSnapshot.costLimit.remainingPercent)}%` }}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between text-[11px] text-cozy-muted font-mono">
                  <div>
                    {currentSnapshot.costLimit.limit !== null && (
                      <span>
                        {formatCostAmount(currentSnapshot.costLimit.used, currentSnapshot.costLimit.currency)} /{' '}
                        {formatCostAmount(currentSnapshot.costLimit.limit, currentSnapshot.costLimit.currency)}
                        {(currentSnapshot.costLimit.currency || '').toUpperCase() !== 'USD' && (
                          <span> {currentSnapshot.costLimit.currency || 'Credits'}</span>
                        )}
                      </span>
                    )}
                  </div>
                  <span>{currentSnapshot.costLimit.resetDescription || 'Resets soon'}</span>
                </div>
              </div>
            )}

            {/* Detailed Model Buckets (for Antigravity - keeping current design) */}
            {currentSnapshot.buckets && currentSnapshot.buckets.length > 0 && (
              <div className="p-4 rounded-2xl bg-cozy-surface border border-cozy-border space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-teal-500" />
                    <span className="text-xs font-bold text-cozy-text">Model Quota Allocations</span>
                  </div>
                  <span className="text-[11px] text-cozy-muted font-mono">
                    {currentSnapshot.buckets.length} pools available
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {currentSnapshot.buckets.map((bucket) => (
                    <div
                      key={bucket.id}
                      className="p-3 rounded-xl bg-cozy-subtle/50 border border-cozy-border/70 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-cozy-text truncate" title={bucket.name}>
                          {bucket.name}
                        </span>
                        <span
                          className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded border ${getBadgeColorClass(
                            bucket.remainingPercent
                          )}`}
                        >
                          {bucket.remainingPercent}%
                        </span>
                      </div>

                      <div className="h-1.5 w-full bg-cozy-bg rounded-full overflow-hidden border border-cozy-border/40">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${getMeterColorClass(
                            bucket.remainingPercent
                          )}`}
                          style={{ width: `${Math.max(4, bucket.remainingPercent)}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-cozy-muted font-mono">
                        <span>{bucket.remainingFraction.toFixed(2)} capacity</span>
                        {bucket.resetDescription && <span>{bucket.resetDescription}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
