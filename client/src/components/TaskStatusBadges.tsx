import React from 'react';
import {
  GitBranch,
  GitMerge,
  GitPullRequest,
  ArrowDown,
  ArrowUp,
  FileEdit,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  Check,
} from 'lucide-react';
import { TaskGitStatus } from '../types';

export interface TaskStatusBadgesProps {
  status?: TaskGitStatus | null;
  loading?: boolean;
  compact?: boolean;
  onOpenRebase?: () => void;
  onOpenSubmit?: () => void;
  onRefresh?: () => void;
  onCompleteTask?: () => void;
  className?: string;
}

export const TaskStatusBadges: React.FC<TaskStatusBadgesProps> = ({
  status,
  loading = false,
  compact = false,
  onOpenRebase,
  onOpenSubmit,
  onRefresh,
  onCompleteTask,
  className = '',
}) => {
  if (!status && loading) {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-cozy-subtle/60 text-cozy-muted border border-cozy-border/40 animate-pulse">
          <RefreshCw className="w-2.5 h-2.5 animate-spin" />
          <span>Checking status...</span>
        </div>
      </div>
    );
  }

  if (!status) return null;

  const totalChanges =
    (status.staged?.length || 0) +
    (status.unstaged?.length || 0) +
    (status.untracked?.length || 0);
  const hasLocal = status.hasLocalChanges || totalChanges > 0;
  const unpushed = status.unpushedCount || 0;
  const behind = status.behindCount || 0;
  const ahead = status.aheadCount || 0;
  const isMerged = Boolean(status.isMerged);
  const pr = status.pr;
  const isPrOpen = pr && pr.state === 'open';

  // Can show "Create PR" if changes are pushed, no open PR, not merged, and URL available
  const canCreatePr =
    Boolean(status.createPrUrl) &&
    !isMerged &&
    !isPrOpen &&
    unpushed === 0 &&
    (ahead > 0 || !hasLocal);

  const openUrl = (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className={`flex items-center flex-wrap gap-1.5 text-xs ${className}`}
      onClick={(e) => {
        // Prevent clicking badges inside task cards from triggering card navigation if not desired
        e.stopPropagation();
      }}
    >
      {/* 1. Primary Lifecycle Stage */}
      {isMerged ? (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/25 shadow-soft-xs"
          title="Branch has been merged into base branch"
        >
          <GitMerge className="w-3 h-3 text-purple-500" />
          <span>Merged</span>
        </span>
      ) : isPrOpen ? (
        <button
          type="button"
          onClick={(e) => pr?.url && openUrl(pr.url, e)}
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30 hover:bg-sky-500/25 transition-all shadow-soft-xs cursor-pointer group"
          title={`Pull Request #${pr.number}: ${pr.title} (Click to open)`}
        >
          <GitPullRequest className="w-3 h-3 text-sky-500" />
          <span>PR #{pr.number}</span>
          <ExternalLink className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100 transition-opacity" />
        </button>
      ) : hasLocal || unpushed > 0 ? (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 shadow-soft-xs"
          title="Task has active development in progress"
        >
          <GitBranch className="w-3 h-3 text-teal-500" />
          <span>In Progress</span>
        </span>
      ) : (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-cozy-subtle/70 text-cozy-muted border border-cozy-border/50"
          title="Working directory is clean and up to date"
        >
          <CheckCircle2 className="w-3 h-3 text-emerald-500/70" />
          <span>Clean</span>
        </span>
      )}

      {/* 2. Flag: Behind Base Branch */}
      {behind > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenRebase?.();
          }}
          disabled={!onOpenRebase}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 transition-all ${
            onOpenRebase
              ? 'hover:bg-amber-500/25 cursor-pointer hover:shadow-soft-xs active:scale-95'
              : 'cursor-default'
          }`}
          title={`Task is behind ${status.baseBranch || 'base branch'} by ${behind} commit${
            behind === 1 ? '' : 's'
          }.${onOpenRebase ? ' Click to rebase.' : ''}`}
        >
          <ArrowDown className="w-3 h-3 text-amber-500" />
          <span>Behind {behind}</span>
        </button>
      )}

      {/* 3. Flag: Local Uncommitted Changes */}
      {hasLocal && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSubmit?.();
          }}
          disabled={!onOpenSubmit}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-500/15 text-orange-700 dark:text-orange-400 border border-orange-500/30 transition-all ${
            onOpenSubmit
              ? 'hover:bg-orange-500/25 cursor-pointer hover:shadow-soft-xs active:scale-95'
              : 'cursor-default'
          }`}
          title={`${totalChanges} uncommitted change${
            totalChanges === 1 ? '' : 's'
          } (staged, unstaged, untracked).${onOpenSubmit ? ' Click to commit.' : ''}`}
        >
          <FileEdit className="w-3 h-3 text-orange-500" />
          <span>{totalChanges} uncommitted</span>
        </button>
      )}

      {/* 4. Flag: Unpushed Commits */}
      {unpushed > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSubmit?.();
          }}
          disabled={!onOpenSubmit}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/30 transition-all ${
            onOpenSubmit
              ? 'hover:bg-blue-500/25 cursor-pointer hover:shadow-soft-xs active:scale-95'
              : 'cursor-default'
          }`}
          title={`${unpushed} local commit${
            unpushed === 1 ? '' : 's'
          } not yet pushed to remote.${onOpenSubmit ? ' Click to push.' : ''}`}
        >
          <ArrowUp className="w-3 h-3 text-blue-500" />
          <span>{unpushed} unpushed</span>
        </button>
      )}

      {/* 5. Direct Action: Create PR / MR */}
      {canCreatePr && (
        <button
          type="button"
          onClick={(e) => openUrl(status.createPrUrl!, e)}
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all shadow-soft-xs cursor-pointer group active:scale-95"
          title="All changes pushed. Click to open Pull/Merge Request in browser."
        >
          <GitPullRequest className="w-3 h-3 text-emerald-500" />
          <span>Create PR</span>
          <ExternalLink className="w-2.5 h-2.5 opacity-70 group-hover:opacity-100 transition-opacity" />
        </button>
      )}

      {/* 6. Direct Action: Complete Task when Merged */}
      {isMerged && onCompleteTask && !compact && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCompleteTask();
          }}
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-purple-500 hover:bg-purple-600 text-white transition-all shadow-soft-sm active:scale-95 cursor-pointer ml-1"
          title="Mark this task as completed now that the branch is merged"
        >
          <Check className="w-3 h-3" />
          <span>Complete Task</span>
        </button>
      )}

      {/* 7. Refresh Button (Detailed Header Mode) */}
      {!compact && onRefresh && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRefresh();
          }}
          disabled={loading}
          className="p-1 rounded-full text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-all cursor-pointer ml-0.5"
          title="Refresh Git status"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin text-teal-500' : ''}`} />
        </button>
      )}
    </div>
  );
};
