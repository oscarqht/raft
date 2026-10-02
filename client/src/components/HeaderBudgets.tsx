import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AgentUsageSnapshot } from '../types';
import { getAllAgentUsages } from '../api';
import { getCachedAgentUsages, setCachedAgentUsages } from '../cache';
import { isWindowsPlatform } from '../utils/platform';

export const BUDGET_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

const ICONS: Record<string, string> = {
  claude: '/provider-icons/claude.png',
  codex: '/provider-icons/codex.png',
  agy: '/provider-icons/agy.png',
};

export function getRemainingPercent(snapshot: AgentUsageSnapshot): number | null {
  if (snapshot.error) return null;
  if (snapshot.primaryWindow) return snapshot.primaryWindow.remainingPercent;
  if (typeof snapshot.costLimit?.remainingPercent === 'number') return snapshot.costLimit.remainingPercent;
  if (snapshot.buckets && snapshot.buckets.length > 0) {
    return Math.min(...snapshot.buckets.map((b) => b.remainingPercent));
  }
  return null;
}

const colorClass = (percent: number) =>
  percent > 50
    ? 'text-emerald-600 dark:text-emerald-400'
    : percent >= 20
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-rose-600 dark:text-rose-400';

export const HeaderBudgets: React.FC = () => {
  const [usages, setUsages] = useState<Record<string, AgentUsageSnapshot>>(() => getCachedAgentUsages() || {});
  const isMountedRef = useRef(true);

  const load = useCallback(async (refresh: boolean) => {
    try {
      const data = await getAllAgentUsages(refresh);
      if (data && typeof data === 'object') {
        setCachedAgentUsages(data);
        if (isMountedRef.current) setUsages(data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (isWindowsPlatform()) return;
    isMountedRef.current = true;
    load(false);
    const refresh = () => { if (document.visibilityState === 'visible') void load(true); };
    const interval = setInterval(refresh, BUDGET_REFRESH_INTERVAL_MS);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [load]);

  if (isWindowsPlatform()) return null;

  const items = Object.values(usages)
    .filter((s) => s.cli.toLowerCase() !== 'alpha')
    .map((s) => ({ snapshot: s, percent: getRemainingPercent(s) }))
    .filter((item): item is { snapshot: AgentUsageSnapshot; percent: number } => item.percent !== null);

  if (items.length === 0) return null;

  return (
    <Link
      to="/settings?tab=budgets"
      className="flex items-center gap-2 px-2 h-7 rounded-lg text-xs font-medium text-cozy-muted hover:bg-cozy-subtle hover:text-cozy-text transition-colors shrink-0 whitespace-nowrap"
      title="AI provider budgets left — click for details"
      aria-label="Open budgets settings"
    >
      {items.map(({ snapshot, percent }, i) => (
        <React.Fragment key={snapshot.cli}>
          {i > 0 && <span className="text-cozy-border">|</span>}
          <span className="flex items-center gap-1" title={`${snapshot.providerName}: ${percent}% left`}>
            {ICONS[snapshot.cli.toLowerCase()] ? (
              <img src={ICONS[snapshot.cli.toLowerCase()]} alt={snapshot.providerName} className="w-3.5 h-3.5 object-contain" />
            ) : (
              <span>{snapshot.providerName}</span>
            )}
            <span className={colorClass(percent)}>{percent}%</span>
          </span>
        </React.Fragment>
      ))}
    </Link>
  );
};
