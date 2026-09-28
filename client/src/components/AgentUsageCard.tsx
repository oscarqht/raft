import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  RefreshCw,
  Clock,
  Coins,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Layers,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { AgentUsageSnapshot, AgentRateWindow, AgentQuotaBucket, AgentCostLimit, CliInfo } from '../types';
import { getAgentUsage, getAllAgentUsages } from '../api';

interface AgentUsageCardProps {
  activeCli: string;
  clis: CliInfo[];
  onSelectCli?: (cli: string) => void;
}

export const AgentUsageCard: React.FC<AgentUsageCardProps> = ({
  activeCli,
  clis,
  onSelectCli,
}) => {
  const [selectedCli, setSelectedCli] = useState<string>(activeCli);
  const [usages, setUsages] = useState<Record<string, AgentUsageSnapshot>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync selected CLI tab when prop changes
  useEffect(() => {
    setSelectedCli(activeCli);
  }, [activeCli]);

  const loadAllUsages = useCallback(async (refresh = false) => {
    try {
      if (refresh) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      const data = await getAllAgentUsages(refresh);
      setUsages(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch AI agent usage');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAllUsages(false);
  }, [loadAllUsages]);

  const handleRefresh = () => {
    loadAllUsages(true);
  };

  const currentSnapshot = usages[selectedCli.toLowerCase()] || null;
  const isSelectedCliReady = clis.some(
    (c) => c.name.toLowerCase() === selectedCli.toLowerCase() && c.available
  );

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

  const formatNumber = (num: number | null | undefined) => {
    if (num === null || num === undefined) return '0';
    return Number(num).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  };

  return (
    <div className="p-6 sm:p-7 rounded-squircle glass-card border border-white/80 dark:border-white/10 shadow-soft space-y-6">
      {/* 1. Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-cozy-text flex items-center gap-2">
              <Activity className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              AI Agent Usage &amp; Remaining Quotas
            </h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 font-medium">
              CodexBar Engine
            </span>
          </div>
          <p className="text-xs text-cozy-muted mt-1">
            Real-time usage windows, remaining quotas, and reset countdowns for your AI assistants.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoading || isRefreshing}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-cozy-subtle hover:bg-cozy-surface border border-cozy-border text-cozy-muted hover:text-cozy-text transition-all disabled:opacity-50 shadow-soft-sm cursor-pointer whitespace-nowrap"
            title="Refresh usage statistics from provider APIs"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Updating...' : 'Refresh Quotas'}</span>
          </button>
        </div>
      </div>

      {/* 2. Provider Tabs */}
      <div className="flex items-center gap-2 border-b border-cozy-border/60 pb-3 overflow-x-auto">
        {['codex', 'agy', 'claude'].map((cliKey) => {
          const cliInfo = clis.find((c) => c.name.toLowerCase() === cliKey);
          const snap = usages[cliKey];
          const isSelected = selectedCli.toLowerCase() === cliKey;
          const isInstalled = !!cliInfo?.available;

          let dotClass = 'bg-zinc-400';
          if (snap) {
            if (snap.statusMessage || snap.costLimit?.remainingPercent === 0) {
              dotClass = 'bg-rose-500';
            } else if (snap.primaryWindow && snap.primaryWindow.remainingPercent < 20) {
              dotClass = 'bg-amber-500';
            } else if (isInstalled) {
              dotClass = 'bg-emerald-500';
            }
          }

          const labelMap: Record<string, string> = {
            codex: 'OpenAI Codex',
            agy: 'Antigravity (agy)',
            claude: 'Claude Code',
          };

          return (
            <button
              key={cliKey}
              type="button"
              onClick={() => {
                setSelectedCli(cliKey);
                if (onSelectCli && cliKey !== activeCli && isInstalled) {
                  // User can view other CLIs or optionally switch
                }
              }}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap border ${
                isSelected
                  ? 'bg-teal-500/10 border-teal-400/40 text-teal-700 dark:text-teal-300 shadow-sm'
                  : 'bg-cozy-subtle/50 border-cozy-border text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${dotClass} shrink-0`} />
              <span>{labelMap[cliKey] || cliKey.toUpperCase()}</span>
              {activeCli.toLowerCase() === cliKey && (
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-teal-500/20 text-teal-600 dark:text-teal-300 uppercase font-mono font-bold">
                  Active
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 3. Loading state */}
      {isLoading && !currentSnapshot && (
        <div className="p-8 rounded-2xl bg-cozy-subtle/30 border border-cozy-border/70 flex flex-col items-center justify-center gap-3 text-center">
          <RefreshCw className="w-5 h-5 text-teal-500 animate-spin" />
          <div className="text-xs font-medium text-cozy-muted">
            Fetching live usage and quota status...
          </div>
        </div>
      )}

      {/* 4. Error state */}
      {error && !currentSnapshot && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 5. Snapshot Display */}
      {currentSnapshot && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {/* Account & Status Header Bar */}
          <div className="p-3.5 rounded-2xl bg-cozy-subtle/50 border border-cozy-border flex flex-wrap items-center justify-between gap-3 text-xs">
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

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-cozy-muted/80">
                Updated {new Date(currentSnapshot.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              {isSelectedCliReady ? (
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

          {/* Warning Banner if limit reached */}
          {currentSnapshot.statusMessage && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/25 flex items-start gap-3 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="text-xs font-bold">{currentSnapshot.statusMessage}</div>
                <div className="text-[11px] opacity-90">
                  {currentSnapshot.costLimit?.resetDescription
                    ? `Capacity will replenish automatically (${currentSnapshot.costLimit.resetDescription}).`
                    : 'You have reached your allocated quota window for this cycle.'}
                </div>
              </div>
            </div>
          )}

          {/* Rate Windows & Spend Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Primary Session Window (e.g. 5-Hour Limit) */}
            {currentSnapshot.primaryWindow && (
              <div className="p-4 rounded-2xl bg-cozy-surface border border-cozy-border space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-teal-500" />
                    <span className="text-xs font-bold text-cozy-text">
                      {currentSnapshot.cli === 'agy' ? 'Constrained Pool' : 'Session Window (5h)'}
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

            {/* Secondary Window (e.g. Weekly Limit) */}
            {currentSnapshot.secondaryWindow && (
              <div className="p-4 rounded-2xl bg-cozy-surface border border-cozy-border space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="text-xs font-bold text-cozy-text">Weekly Quota (7d)</span>
                  </div>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${getBadgeColorClass(
                      currentSnapshot.secondaryWindow.remainingPercent
                    )}`}
                  >
                    {currentSnapshot.secondaryWindow.remainingPercent}% remaining
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="h-2.5 w-full bg-cozy-subtle rounded-full overflow-hidden border border-cozy-border/60">
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${getMeterColorClass(
                      currentSnapshot.secondaryWindow.remainingPercent
                    )}`}
                    style={{ width: `${Math.max(3, currentSnapshot.secondaryWindow.remainingPercent)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-cozy-muted font-mono">
                  <span>Used: {currentSnapshot.secondaryWindow.usedPercent}%</span>
                  <span>{currentSnapshot.secondaryWindow.resetDescription || 'Weekly cycle'}</span>
                </div>
              </div>
            )}

            {/* Spend Control / Credit Limit */}
            {currentSnapshot.costLimit && (
              <div className="p-4 rounded-2xl bg-cozy-surface border border-cozy-border space-y-3 md:col-span-2">
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
                        {formatNumber(currentSnapshot.costLimit.used)} / {formatNumber(currentSnapshot.costLimit.limit)}{' '}
                        {currentSnapshot.costLimit.currency || 'Credits'}
                      </span>
                    )}
                  </div>
                  <span>{currentSnapshot.costLimit.resetDescription || 'Resets with next billing cycle'}</span>
                </div>
              </div>
            )}
          </div>

          {/* 6. Detailed Model Buckets (e.g. Antigravity) */}
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

          {/* 7. Footer helper or Quick Switch */}
          {selectedCli.toLowerCase() !== activeCli.toLowerCase() && isSelectedCliReady && onSelectCli && (
            <div className="p-3 rounded-xl bg-teal-500/5 border border-teal-500/20 flex items-center justify-between gap-3 text-xs">
              <span className="text-cozy-muted">
                Currently configured agent is <strong className="text-cozy-text capitalize">{activeCli}</strong>.
              </span>
              <button
                type="button"
                onClick={() => onSelectCli(selectedCli)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white transition-all shadow-sm cursor-pointer"
              >
                Switch to {currentSnapshot.providerName}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
