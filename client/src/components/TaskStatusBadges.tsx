import React from 'react';
import {
  GitMerge,
  GitPullRequest,
  ArrowUp,
  FileEdit,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { TaskGitStatus } from '../types';

export interface TaskStatusBadgesProps {
  status?: TaskGitStatus | null;
  agentStatus?: 'WIP' | 'idle';
  loading?: boolean;
  compact?: boolean;
  onOpenSubmit?: () => void;
  onRefresh?: () => void;
  className?: string;
}

export const TaskStatusBadges: React.FC<TaskStatusBadgesProps> = ({
  status,
  agentStatus,
  loading = false,
  compact = false,
  onOpenSubmit,
  onRefresh,
  className = '',
}) => {
  const effectiveAgentStatus: 'WIP' | 'idle' =
    agentStatus || status?.agent_status || 'idle';

  const renderAgentBadge = (agentSt: 'WIP' | 'idle') => {
    if (agentSt === 'WIP') {
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-teal-500/15 text-teal-600 dark:text-teal-400 border border-teal-500/30 shadow-soft-xs shrink-0"
          title="AI Agent is actively working or replying"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse shrink-0" />
          <span>WIP</span>
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-cozy-subtle/70 text-cozy-muted border border-cozy-border/50 shrink-0"
        title="Agent is idle"
      >
        <span>idle</span>
      </span>
    );
  };

  if (!status && loading) {
    return (
      <div className={`flex items-center flex-nowrap gap-1.5 text-xs ${className}`}>
        {renderAgentBadge(effectiveAgentStatus)}
        <div
          className="inline-flex items-center gap-1 px-1.5 min-[1400px]:px-2 py-0.5 rounded-full text-[11px] font-medium bg-cozy-subtle/60 text-cozy-muted border border-cozy-border/40 animate-pulse shrink-0"
          title="Checking Git status..."
        >
          <RefreshCw className="w-2.5 h-2.5 animate-spin shrink-0" />
          <span className="hidden min-[1400px]:inline">Checking status...</span>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className={`flex items-center flex-nowrap gap-1.5 text-xs ${className}`}>
        {renderAgentBadge(effectiveAgentStatus)}
      </div>
    );
  }

  const totalChanges =
    (status.staged?.length || 0) +
    (status.unstaged?.length || 0) +
    (status.untracked?.length || 0);
  const hasLocal = status.hasLocalChanges || totalChanges > 0;
  const unpushed = status.unpushedCount || 0;
  const ahead = status.aheadCount || 0;
  const isMerged = Boolean(status.isMerged);
  const pr = status.pr;
  const isPrOpen = pr && pr.state === 'open';

  // Can show "Create PR" if changes are pushed, no open PR, not merged, URL available, and ahead of base branch
  const canCreatePr =
    Boolean(status.createPrUrl) &&
    !isMerged &&
    !isPrOpen &&
    !hasLocal &&
    unpushed === 0 &&
    ahead > 0;

  const openUrl = (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const renderStatusBadge = () => {
    // 1. Uncommitted local changes
    if (hasLocal) {
      const content = (
        <>
          <FileEdit className="w-3 h-3 text-orange-500 shrink-0" />
          <span>{totalChanges} local {totalChanges === 1 ? 'change' : 'changes'}</span>
        </>
      );
      return onOpenSubmit ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSubmit();
          }}
          className="inline-flex items-center gap-1 px-1.5 min-[1400px]:px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-orange-500/15 text-orange-700 dark:text-orange-400 border border-orange-500/30 hover:bg-orange-500/25 transition-all shadow-soft-xs cursor-pointer active:scale-95 shrink-0"
          title={`${totalChanges} uncommitted local change${totalChanges === 1 ? '' : 's'} (staged, unstaged, untracked). Click to commit.`}
        >
          {content}
        </button>
      ) : (
        <span
          className="inline-flex items-center gap-1 px-1.5 min-[1400px]:px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-orange-500/15 text-orange-700 dark:text-orange-400 border border-orange-500/30 transition-all shrink-0"
          title={`${totalChanges} uncommitted local change${totalChanges === 1 ? '' : 's'} (staged, unstaged, untracked).`}
        >
          {content}
        </span>
      );
    }

    // 2. Clean locally & commits ahead (unpushed)
    if (unpushed > 0) {
      const content = (
        <>
          <ArrowUp className="w-3 h-3 text-blue-500 shrink-0" />
          <span>{unpushed} {unpushed === 1 ? 'commit' : 'commits'} to push</span>
        </>
      );
      return onOpenSubmit ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSubmit();
          }}
          className="inline-flex items-center gap-1 px-1.5 min-[1400px]:px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/30 hover:bg-blue-500/25 transition-all shadow-soft-xs cursor-pointer active:scale-95 shrink-0"
          title={`${unpushed} local commit${unpushed === 1 ? '' : 's'} not yet pushed to remote. Click to push.`}
        >
          {content}
        </button>
      ) : (
        <span
          className="inline-flex items-center gap-1 px-1.5 min-[1400px]:px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/30 transition-all shrink-0"
          title={`${unpushed} local commit${unpushed === 1 ? '' : 's'} not yet pushed to remote.`}
        >
          {content}
        </span>
      );
    }

    // Commits pushed to remote, ahead of base branch, ready to open PR
    if (canCreatePr) {
      return (
        <button
          type="button"
          onClick={(e) => openUrl(status.createPrUrl!, e)}
          className="inline-flex items-center gap-1 px-1.5 min-[1400px]:px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all shadow-soft-xs cursor-pointer group active:scale-95 shrink-0"
          title="All changes pushed. Click to open Pull/Merge Request in browser."
        >
          <GitPullRequest className="w-3 h-3 text-emerald-500 shrink-0" />
          <span>Create PR</span>
          <ExternalLink className="w-2.5 h-2.5 opacity-70 group-hover:opacity-100 transition-opacity hidden min-[1400px]:inline" />
        </button>
      );
    }

    // 3. Branch / PR is merged
    if (isMerged) {
      const content = (
        <>
          <GitMerge className="w-3 h-3 text-purple-500 shrink-0" />
          <span>Merged</span>
          {pr?.url && (
            <ExternalLink className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100 transition-opacity hidden min-[1400px]:inline" />
          )}
        </>
      );
      return pr?.url ? (
        <button
          type="button"
          onClick={(e) => openUrl(pr.url!, e)}
          className="inline-flex items-center gap-1 px-1.5 min-[1400px]:px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/25 hover:bg-purple-500/25 transition-all shadow-soft-xs cursor-pointer group shrink-0"
          title="Branch has been merged into base branch (Click to open PR)"
        >
          {content}
        </button>
      ) : (
        <span
          className="inline-flex items-center gap-1 px-1.5 min-[1400px]:px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/25 shadow-soft-xs shrink-0"
          title="Branch has been merged into base branch"
        >
          {content}
        </span>
      );
    }

    // 4. PR / MR already created and open
    if (isPrOpen) {
      const content = (
        <>
          <GitPullRequest className="w-3 h-3 text-sky-500 shrink-0" />
          <span>PR #{pr.number}</span>
          {pr?.url && (
            <ExternalLink className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100 transition-opacity hidden min-[1400px]:inline" />
          )}
        </>
      );
      return pr?.url ? (
        <button
          type="button"
          onClick={(e) => openUrl(pr.url!, e)}
          className="inline-flex items-center gap-1 px-1.5 min-[1400px]:px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30 hover:bg-sky-500/25 transition-all shadow-soft-xs cursor-pointer group shrink-0"
          title={`Pull Request #${pr.number}: ${pr.title} (Click to open)`}
        >
          {content}
        </button>
      ) : (
        <span
          className="inline-flex items-center gap-1 px-1.5 min-[1400px]:px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30 shadow-soft-xs shrink-0"
          title={`Pull Request #${pr.number}: ${pr.title}`}
        >
          {content}
        </span>
      );
    }

    // 5. Clean and up to date => no status badge
    return null;
  };

  return (
    <div className={`flex items-center flex-nowrap gap-1.5 text-xs ${className}`}>
      {/* 1. Agent Status (WIP / idle) */}
      {renderAgentBadge(effectiveAgentStatus)}

      {/* 2. Simplified Primary Status Badge */}
      {renderStatusBadge()}

      {/* 3. Refresh Button (Detailed Header Mode) */}
      {!compact && onRefresh && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRefresh();
          }}
          disabled={loading}
          className="p-1 rounded-full text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-all cursor-pointer ml-0.5 shrink-0"
          title="Refresh Git status"
        >
          <RefreshCw className={`w-3 h-3 shrink-0 ${loading ? 'animate-spin text-teal-500' : ''}`} />
        </button>
      )}
    </div>
  );
};
