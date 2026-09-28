import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string;
  isMain: boolean;
}

export interface TaskPrInfo {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'merged' | 'closed';
  mergedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface TaskGitStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  hasLocalChanges: boolean;
  unpushedCount: number;
  unpushedCommits: { hash: string; message: string }[];
  behindCount: number;
  aheadCount: number;
  isMerged: boolean;
  pr: TaskPrInfo | null;
  createPrUrl: string | null;
  baseBranch: string;
  branch: string;
  lifecycleStage: 'in_progress' | 'pr_open' | 'merged' | 'clean';
  remoteUrl?: string;
  checkedAt: number;
}

export interface RemoteRepoDetails {
  provider: 'github' | 'gitlab' | 'other';
  host: string;
  owner: string;
  repo: string;
  projectPath: string;
  remoteUrl: string;
}

export function parseRemoteUrl(remoteUrl: string): RemoteRepoDetails | null {
  if (!remoteUrl) return null;
  const cleanUrl = remoteUrl.trim();
  let host = '';
  let projectPath = '';

  if (cleanUrl.startsWith('git@')) {
    const match = cleanUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (match) {
      host = match[1].toLowerCase();
      projectPath = match[2].replace(/\.git$/, '');
    }
  } else if (cleanUrl.includes('://')) {
    try {
      const parsed = new URL(cleanUrl);
      host = parsed.hostname.toLowerCase();
      projectPath = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/, '');
    } catch {}
  }

  if (!host || !projectPath) return null;

  let provider: 'github' | 'gitlab' | 'other' = 'other';
  if (host.includes('github')) provider = 'github';
  else if (host.includes('gitlab')) provider = 'gitlab';

  const parts = projectPath.split('/');
  const owner = parts[0] || '';
  const repo = parts[parts.length - 1] || '';

  return {
    provider,
    host,
    owner,
    repo,
    projectPath,
    remoteUrl: cleanUrl,
  };
}

export function getCreatePrUrl(remoteInfo: RemoteRepoDetails | null, branch: string, baseBranch: string): string | null {
  if (!remoteInfo || !branch || !baseBranch) return null;
  const { provider, host, projectPath } = remoteInfo;
  if (provider === 'github') {
    return `https://${host}/${projectPath}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branch)}?expand=1`;
  }
  if (provider === 'gitlab') {
    return `https://${host}/${projectPath}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(branch)}&merge_request%5Btarget_branch%5D=${encodeURIComponent(baseBranch)}`;
  }
  return null;
}

export async function fetchRemotePrInfo(
  remoteInfo: RemoteRepoDetails,
  branch: string,
  token?: string
): Promise<TaskPrInfo | null> {
  const { provider, host, projectPath, owner, repo } = remoteInfo;
  try {
    if (provider === 'github') {
      const apiUrl = host === 'github.com'
        ? `https://api.github.com/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all`
        : `https://${host}/api/v3/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all`;

      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Raft-App',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(apiUrl, { headers, signal: controller.signal });
        if (!res.ok) return null;
        const prs = (await res.json()) as any[];
        if (!Array.isArray(prs) || prs.length === 0) return null;

        const openPr = prs.find((p) => p.state === 'open');
        const targetPr = openPr || prs[0];
        const isMerged = Boolean(targetPr.merged_at);
        const state: 'open' | 'merged' | 'closed' = isMerged ? 'merged' : targetPr.state === 'open' ? 'open' : 'closed';

        return {
          number: targetPr.number,
          title: targetPr.title || '',
          url: targetPr.html_url || '',
          state,
          mergedAt: targetPr.merged_at || null,
          createdAt: targetPr.created_at || null,
          updatedAt: targetPr.updated_at || null,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (provider === 'gitlab') {
      const encodedId = encodeURIComponent(projectPath);
      const apiUrl = `https://${host}/api/v4/projects/${encodedId}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=all`;

      const headers: Record<string, string> = {
        'User-Agent': 'Raft-App',
      };
      if (token) {
        headers['PRIVATE-TOKEN'] = token;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(apiUrl, { headers, signal: controller.signal });
        if (!res.ok) return null;
        const mrs = (await res.json()) as any[];
        if (!Array.isArray(mrs) || mrs.length === 0) return null;

        const openMr = mrs.find((m) => m.state === 'opened');
        const targetMr = openMr || mrs[0];
        let state: 'open' | 'merged' | 'closed' = 'closed';
        if (targetMr.state === 'opened') state = 'open';
        else if (targetMr.state === 'merged') state = 'merged';

        return {
          number: targetMr.iid,
          title: targetMr.title || '',
          url: targetMr.web_url || '',
          state,
          mergedAt: targetMr.merged_at || null,
          createdAt: targetMr.created_at || null,
          updatedAt: targetMr.updated_at || null,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    }
  } catch {
    return null;
  }
  return null;
}

interface CachedStatusEntry {
  status: TaskGitStatus;
  timestamp: number;
}
const statusCache = new Map<string, CachedStatusEntry>();
const CACHE_TTL_MS = 25000;

export interface RepoInfo {
  isRepo: boolean;
  repoRoot: string;
  currentBranch: string;
  branches: string[];
  worktrees: WorktreeInfo[];
  error?: string;
}

export function sanitizeBranchName(raw: string): string {
  if (!raw) return '';
  let str = raw.trim().toLowerCase();
  str = str.replace(/[\\/]+/g, '-');
  str = str.replace(/[^a-z0-9._-]+/g, '-');
  str = str.replace(/-+/g, '-');
  str = str.replace(/\.+/g, '.');
  str = str.replace(/^[-.]+|[-.]+$/g, '');
  return str;
}

export function normalizePath(p: string): string {
  if (!p) return '';
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

export class GitService {
  static initRepo(targetPath: string): RepoInfo {
    try {
      const resolved = path.resolve(targetPath);
      if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true });
      }
      execSync('git init', {
        cwd: resolved,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return GitService.getRepoInfo(resolved);
    } catch (err: any) {
      return {
        isRepo: false,
        repoRoot: '',
        currentBranch: '',
        branches: [],
        worktrees: [],
        error: err.message,
      };
    }
  }

  static getRepoInfo(targetPath: string): RepoInfo {
    try {
      if (!fs.existsSync(targetPath)) {
        return { isRepo: false, repoRoot: '', currentBranch: '', branches: [], worktrees: [] };
      }

      // Check if git repository
      const repoRoot = execSync('git rev-parse --show-toplevel', {
        cwd: targetPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      // Current branch
      let currentBranch = '';
      try {
        currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: repoRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
      } catch {
        // Detached or empty
      }

      // List all local branches
      const branchOutput = execSync('git branch --list --format="%(refname:short)"', {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const branches = branchOutput
        .split(/\r?\n/)
        .map((b) => b.trim())
        .filter((b) => b && b !== 'HEAD');

      // List worktrees
      const wtOutput = execSync('git worktree list --porcelain', {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const worktrees: WorktreeInfo[] = [];
      const blocks = wtOutput.split(/(?:\r?\n){2,}/).filter(Boolean);
      for (const block of blocks) {
        let wtPath = '';
        let wtHead = '';
        let wtBranch = '';
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('worktree ')) wtPath = line.replace('worktree ', '').trim();
          else if (line.startsWith('HEAD ')) wtHead = line.replace('HEAD ', '').trim();
          else if (line.startsWith('branch ')) {
            wtBranch = line.replace('branch refs/heads/', '').trim();
          }
        }
        if (wtPath) {
          worktrees.push({
            path: wtPath,
            head: wtHead,
            branch: wtBranch,
            isMain: normalizePath(wtPath) === normalizePath(repoRoot),
          });
        }
      }

      return {
        isRepo: true,
        repoRoot,
        currentBranch,
        branches,
        worktrees,
      };
    } catch (err: any) {
      return {
        isRepo: false,
        repoRoot: '',
        currentBranch: '',
        branches: [],
        worktrees: [],
        error: err.message,
      };
    }
  }

  /**
   * Syncs the local base branch with its remote tracking branch (fast-forward or rebase)
   * before creating a new worktree / branch.
   */
  static syncBaseBranchWithRemote(repoRoot: string, baseBranch: string): void {
    if (!baseBranch || !repoRoot) return;

    try {
      // 1. Check if git remotes exist
      const remotesOutput = execSync('git remote', {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      if (!remotesOutput) {
        return; // No remotes configured
      }

      const remotes = remotesOutput.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
      if (remotes.length === 0) return;

      // 2. Determine remote to use
      let remote = '';
      try {
        remote = execSync(`git config --get branch.${baseBranch}.remote`, {
          cwd: repoRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
      } catch {}

      if (!remote || !remotes.includes(remote)) {
        remote = remotes.includes('origin') ? 'origin' : remotes[0];
      }

      // 3. Fetch latest commits for baseBranch from remote
      try {
        execSync(`git fetch ${remote} ${baseBranch}`, {
          cwd: repoRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
      } catch {
        try {
          execSync(`git fetch ${remote}`, {
            cwd: repoRoot,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          });
        } catch {}
      }

      const remoteRef = `refs/remotes/${remote}/${baseBranch}`;
      let remoteExists = false;
      try {
        execSync(`git rev-parse --verify ${remoteRef}`, {
          cwd: repoRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        remoteExists = true;
      } catch {}

      if (!remoteExists) {
        return; // Remote branch does not exist on remote
      }

      // 4. Check if local branch exists
      const localRef = `refs/heads/${baseBranch}`;
      let localExists = false;
      try {
        execSync(`git rev-parse --verify ${localRef}`, {
          cwd: repoRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        localExists = true;
      } catch {}

      if (!localExists) {
        try {
          execSync(`git branch --track "${baseBranch}" "${remote}/${baseBranch}"`, {
            cwd: repoRoot,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          });
        } catch {
          try {
            execSync(`git branch "${baseBranch}" "${remoteRef}"`, {
              cwd: repoRoot,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'ignore'],
            });
          } catch {}
        }
        return;
      }

      // 5. Check if local is behind or diverged from remote
      const revListOutput = execSync(`git rev-list --left-right --count ${localRef}...${remoteRef}`, {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      const [aheadStr, behindStr] = revListOutput.split(/\s+/);
      const ahead = parseInt(aheadStr, 10) || 0;
      const behind = parseInt(behindStr, 10) || 0;

      if (behind === 0) {
        // Local is already up to date with or ahead of remote
        return;
      }

      // 6. Update local baseBranch to incorporate remote changes
      let currentBranch = '';
      try {
        currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: repoRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
      } catch {}

      let worktreeWithBaseBranch = '';
      try {
        const wtOutput = execSync('git worktree list --porcelain', {
          cwd: repoRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        const blocks = wtOutput.split(/(?:\r?\n){2,}/).filter(Boolean);
        for (const block of blocks) {
          let wtPath = '';
          let wtBranch = '';
          for (const line of block.split(/\r?\n/)) {
            if (line.startsWith('worktree ')) wtPath = line.replace('worktree ', '').trim();
            else if (line.startsWith('branch refs/heads/')) {
              wtBranch = line.replace('branch refs/heads/', '').trim();
            }
          }
          if (wtBranch === baseBranch && wtPath) {
            worktreeWithBaseBranch = wtPath;
            break;
          }
        }
      } catch {}

      if (ahead === 0) {
        // Strictly behind: can be fast-forwarded!
        if (currentBranch === baseBranch) {
          execSync(`git merge --ff-only "${remoteRef}"`, {
            cwd: repoRoot,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          });
        } else if (worktreeWithBaseBranch) {
          execSync(`git merge --ff-only "${remoteRef}"`, {
            cwd: worktreeWithBaseBranch,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          });
        } else {
          execSync(`git update-ref "${localRef}" "${remoteRef}"`, {
            cwd: repoRoot,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          });
        }
      } else {
        // Diverged (ahead > 0 and behind > 0): rebase local commits on top of remote
        if (currentBranch === baseBranch) {
          const isDirty = execSync('git status --porcelain', {
            cwd: repoRoot,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }).trim().length > 0;

          if (!isDirty) {
            try {
              execSync(`git rebase "${remoteRef}"`, {
                cwd: repoRoot,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'ignore'],
              });
            } catch {
              try {
                execSync('git rebase --abort', { cwd: repoRoot, stdio: 'ignore' });
              } catch {}
            }
          }
        } else if (worktreeWithBaseBranch) {
          const isDirty = execSync('git status --porcelain', {
            cwd: worktreeWithBaseBranch,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }).trim().length > 0;

          if (!isDirty) {
            try {
              execSync(`git rebase "${remoteRef}"`, {
                cwd: worktreeWithBaseBranch,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'ignore'],
              });
            } catch {
              try {
                execSync('git rebase --abort', { cwd: worktreeWithBaseBranch, stdio: 'ignore' });
              } catch {}
            }
          }
        } else {
          const isDirty = execSync('git status --porcelain', {
            cwd: repoRoot,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }).trim().length > 0;

          if (!isDirty && currentBranch) {
            try {
              execSync(`git checkout "${baseBranch}"`, {
                cwd: repoRoot,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'ignore'],
              });
              try {
                execSync(`git rebase "${remoteRef}"`, {
                  cwd: repoRoot,
                  encoding: 'utf-8',
                  stdio: ['pipe', 'pipe', 'ignore'],
                });
              } catch {
                try {
                  execSync('git rebase --abort', { cwd: repoRoot, stdio: 'ignore' });
                } catch {}
              }
              execSync(`git checkout "${currentBranch}"`, {
                cwd: repoRoot,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'ignore'],
              });
            } catch {}
          }
        }
      }
    } catch (err: any) {
      console.warn(`[GitService] Notice: Could not sync base branch "${baseBranch}" with remote: ${err?.message || err}`);
    }
  }

  static createWorktree(repoRoot: string, taskSlug: string, baseBranch: string): { worktreePath: string; branch: string } {
    // Always sync base branch with its remote (fast-forward or rebase) if behind or diverged
    if (baseBranch) {
      this.syncBaseBranchWithRemote(repoRoot, baseBranch);
    }

    const branch = sanitizeBranchName(taskSlug);
    const worktreesDir = path.join(repoRoot, '.worktrees');
    if (!fs.existsSync(worktreesDir)) {
      fs.mkdirSync(worktreesDir, { recursive: true });
    }

    // Ensure .worktrees is added to .gitignore in repo root
    const gitignorePath = path.join(repoRoot, '.gitignore');
    let gitignoreContent = '';
    if (fs.existsSync(gitignorePath)) {
      gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    }
    if (!gitignoreContent.includes('.worktrees')) {
      const updated = gitignoreContent ? `${gitignoreContent.trim()}\n.worktrees\n` : '.worktrees\n';
      fs.writeFileSync(gitignorePath, updated, 'utf-8');
    }

    const worktreePath = path.resolve(worktreesDir, branch);
    const gitPath = worktreePath.replace(/\\/g, '/');

    // Create worktree branching from baseBranch
    try {
      execSync(`git worktree add -b "${branch}" "${gitPath}" "${baseBranch}"`, {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch (err: any) {
      // If branch already exists, try to checkout existing branch
      if (err.message.includes('already exists')) {
        execSync(`git worktree add "${gitPath}" "${branch}"`, {
          cwd: repoRoot,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      } else {
        throw err;
      }
    }

    return { worktreePath, branch };
  }

  static removeWorktree(repoRoot: string, worktreePath: string, branch?: string): void {
    const gitPath = worktreePath.replace(/\\/g, '/');
    try {
      execSync(`git worktree remove --force "${gitPath}"`, {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch {
      // Fallback cleanup if directory still exists
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      try {
        execSync(`git worktree prune`, { cwd: repoRoot, stdio: 'ignore' });
      } catch {}
    }

    if (branch) {
      try {
        execSync(`git branch -D "${branch}"`, { cwd: repoRoot, stdio: 'ignore' });
      } catch {}
    }
  }

  static getUnpushedCommits(cwd: string, branch?: string, baseBranch?: string): { hash: string; message: string }[] {
    const getLog = (revRange: string) => {
      try {
        const out = execSync(`git log ${revRange} --oneline`, {
          cwd,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        if (!out) return [];
        return out.split(/\r?\n/).map((line) => {
          const spaceIdx = line.indexOf(' ');
          if (spaceIdx === -1) return { hash: line, message: '' };
          return { hash: line.slice(0, spaceIdx), message: line.slice(spaceIdx + 1).trim() };
        });
      } catch {
        return null;
      }
    };

    let commits = getLog('@{u}..HEAD');
    if (commits !== null) return commits;

    if (branch) {
      commits = getLog(`origin/${branch}..HEAD`);
      if (commits !== null) return commits;
    }

    if (baseBranch) {
      commits = getLog(`origin/${baseBranch}..HEAD`);
      if (commits !== null) return commits;
    }

    commits = getLog('origin/main..HEAD');
    if (commits !== null) return commits;

    commits = getLog('origin/master..HEAD');
    if (commits !== null) return commits;

    return [];
  }

  static getGitStatus(cwd: string, branch?: string, baseBranch?: string): {
    staged: string[];
    unstaged: string[];
    untracked: string[];
    unpushedCount: number;
    unpushedCommits: { hash: string; message: string }[];
  } {
    try {
      const statusOutput = execSync('git status --porcelain', {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];

      for (const line of statusOutput.split('\n')) {
        if (!line.trim()) continue;
        const x = line[0];
        const y = line[1];
        const filePath = line.slice(3).trim();

        if (x === '?' && y === '?') {
          untracked.push(filePath);
        } else {
          if (x !== ' ' && x !== '?') {
            staged.push(filePath);
          }
          if (y !== ' ' && y !== '?') {
            unstaged.push(filePath);
          }
        }
      }

      const unpushedCommits = GitService.getUnpushedCommits(cwd, branch, baseBranch);

      return {
        staged,
        unstaged,
        untracked,
        unpushedCount: unpushedCommits.length,
        unpushedCommits,
      };
    } catch {
      return { staged: [], unstaged: [], untracked: [], unpushedCount: 0, unpushedCommits: [] };
    }
  }

  static getRemoteUrl(cwd: string): string {
    if (!cwd || !fs.existsSync(cwd)) return '';
    try {
      const url = execSync('git config --get remote.origin.url', {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      if (url) return url;
    } catch {}

    try {
      const remotes = execSync('git remote', {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim().split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
      if (remotes.length > 0) {
        return execSync(`git config --get remote.${remotes[0]}.url`, {
          cwd,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
      }
    } catch {}

    return '';
  }

  static getDivergence(
    cwd: string,
    branch: string,
    baseBranch: string,
    options?: { forceFetch?: boolean }
  ): { behindCount: number; aheadCount: number; targetRef: string } {
    if (!cwd || !fs.existsSync(cwd)) {
      return { behindCount: 0, aheadCount: 0, targetRef: '' };
    }

    const safeBaseBranch = baseBranch || 'main';

    if (options?.forceFetch) {
      try {
        execSync(`git fetch origin ${safeBaseBranch}`, {
          cwd,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
          timeout: 4000,
        });
      } catch {}
    }

    let targetRef = '';
    try {
      execSync(`git rev-parse --verify refs/remotes/origin/${safeBaseBranch}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      targetRef = `refs/remotes/origin/${safeBaseBranch}`;
    } catch {
      try {
        execSync(`git rev-parse --verify refs/heads/${safeBaseBranch}`, {
          cwd,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        targetRef = `refs/heads/${safeBaseBranch}`;
      } catch {
        targetRef = safeBaseBranch;
      }
    }

    let behindCount = 0;
    let aheadCount = 0;

    try {
      const revListOutput = execSync(`git rev-list --left-right --count ${targetRef}...HEAD`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      const [behindStr, aheadStr] = revListOutput.split(/\s+/);
      behindCount = parseInt(behindStr, 10) || 0;
      aheadCount = parseInt(aheadStr, 10) || 0;
    } catch {}

    return { behindCount, aheadCount, targetRef };
  }

  static invalidateTaskStatus(worktreePath?: string): void {
    if (!worktreePath) {
      statusCache.clear();
      return;
    }
    for (const key of statusCache.keys()) {
      if (key.startsWith(worktreePath)) {
        statusCache.delete(key);
      }
    }
  }

  static async getDetailedTaskStatus(
    worktreePath: string,
    branch: string,
    baseBranch: string,
    options?: { token?: string; forceRefresh?: boolean; taskCreatedAt?: number }
  ): Promise<TaskGitStatus> {
    const safeBaseBranch = baseBranch || 'main';
    const cacheKey = `${worktreePath}:::${branch}`;

    if (!options?.forceRefresh) {
      const cached = statusCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.status;
      }
    }

    if (!worktreePath || !fs.existsSync(worktreePath)) {
      return {
        staged: [],
        unstaged: [],
        untracked: [],
        hasLocalChanges: false,
        unpushedCount: 0,
        unpushedCommits: [],
        behindCount: 0,
        aheadCount: 0,
        isMerged: false,
        pr: null,
        createPrUrl: null,
        baseBranch: safeBaseBranch,
        branch,
        lifecycleStage: 'clean',
        checkedAt: Date.now(),
      };
    }

    const basic = GitService.getGitStatus(worktreePath, branch, safeBaseBranch);
    const hasLocalChanges = basic.staged.length > 0 || basic.unstaged.length > 0 || basic.untracked.length > 0;

    const remoteUrl = GitService.getRemoteUrl(worktreePath);
    const remoteInfo = parseRemoteUrl(remoteUrl);

    const { behindCount, aheadCount, targetRef } = GitService.getDivergence(
      worktreePath,
      branch,
      safeBaseBranch,
      { forceFetch: options?.forceRefresh }
    );

    let pr: TaskPrInfo | null = null;
    if (remoteInfo && (remoteInfo.provider === 'github' || remoteInfo.provider === 'gitlab')) {
      pr = await fetchRemotePrInfo(remoteInfo, branch, options?.token);
    }

    const createPrUrl = getCreatePrUrl(remoteInfo, branch, safeBaseBranch);

    let isMerged = false;
    if (pr && pr.state === 'merged') {
      isMerged = true;
    } else if (targetRef && aheadCount === 0) {
      let isAncestor = false;
      try {
        execSync(`git merge-base --is-ancestor HEAD "${targetRef}"`, { cwd: worktreePath, stdio: 'ignore' });
        isAncestor = true;
      } catch {}

      if (isAncestor) {
        let headCommitTime = 0;
        try {
          headCommitTime =
            parseInt(
              execSync('git log -1 --format="%ct" HEAD', {
                cwd: worktreePath,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'ignore'],
              }).trim(),
              10
            ) * 1000;
        } catch {}

        let branchMentionedInTarget = false;
        try {
          const out = execSync(`git log "${targetRef}" -n 25 --grep="${branch}" --format="%h"`, {
            cwd: worktreePath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }).trim();
          branchMentionedInTarget = out.length > 0;
        } catch {}

        if (
          branchMentionedInTarget ||
          (options?.taskCreatedAt && headCommitTime && headCommitTime >= options.taskCreatedAt - 60000)
        ) {
          isMerged = true;
        }
      }
    }

    let lifecycleStage: 'in_progress' | 'pr_open' | 'merged' | 'clean' = 'clean';
    if (isMerged) {
      lifecycleStage = 'merged';
    } else if (pr && pr.state === 'open') {
      lifecycleStage = 'pr_open';
    } else if (hasLocalChanges || basic.unpushedCount > 0 || aheadCount > 0) {
      lifecycleStage = 'in_progress';
    } else {
      lifecycleStage = 'clean';
    }

    const detailedStatus: TaskGitStatus = {
      staged: basic.staged,
      unstaged: basic.unstaged,
      untracked: basic.untracked,
      hasLocalChanges,
      unpushedCount: basic.unpushedCount,
      unpushedCommits: basic.unpushedCommits,
      behindCount,
      aheadCount,
      isMerged,
      pr,
      createPrUrl,
      baseBranch: safeBaseBranch,
      branch,
      lifecycleStage,
      remoteUrl,
      checkedAt: Date.now(),
    };

    statusCache.set(cacheKey, { status: detailedStatus, timestamp: Date.now() });
    return detailedStatus;
  }

  static getGitDiff(cwd: string): string {
    try {
      const diff = execSync('git diff HEAD', {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return diff || '(No changes)';
    } catch {
      try {
        return execSync('git diff', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
      } catch (err: any) {
        return `Error fetching diff: ${err.message}`;
      }
    }
  }

  static createNewRepo(parentPath: string, folderName: string, defaultBranch = 'main', initReadme = true): RepoInfo {
    const resolvedParent = path.resolve(parentPath);
    if (!fs.existsSync(resolvedParent)) {
      fs.mkdirSync(resolvedParent, { recursive: true });
    }
    const targetPath = path.join(resolvedParent, folderName);
    if (fs.existsSync(targetPath)) {
      throw new Error(`Directory already exists: ${targetPath}`);
    }
    fs.mkdirSync(targetPath, { recursive: true });

    // Initialize repository with specified default branch
    try {
      execSync(`git init -b "${defaultBranch}"`, {
        cwd: targetPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      execSync('git init', {
        cwd: targetPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      try {
        execSync(`git checkout -b "${defaultBranch}"`, {
          cwd: targetPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
      } catch {}
    }

    if (initReadme) {
      // Ensure git user config exists locally if not configured globally
      try {
        execSync('git config user.name', { cwd: targetPath, stdio: 'pipe' });
      } catch {
        execSync('git config user.name "Raft"', { cwd: targetPath, stdio: 'ignore' });
        execSync('git config user.email "raft@local"', { cwd: targetPath, stdio: 'ignore' });
      }

      const readmeContent = `# ${folderName}\n\nCreated with Raft.\n`;
      fs.writeFileSync(path.join(targetPath, 'README.md'), readmeContent, 'utf-8');

      execSync('git add README.md', {
        cwd: targetPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      execSync('git commit -m "Initial commit"', {
        cwd: targetPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    }

    return GitService.getRepoInfo(targetPath);
  }

  static configureRepoCredentials(repoPath: string, remoteUrl: string, token: string, username = 'git'): void {
    try {
      let origin = '';
      if (remoteUrl.startsWith('http://') || remoteUrl.startsWith('https://')) {
        const parsed = new URL(remoteUrl);
        origin = parsed.origin;
      } else if (remoteUrl.includes('@') && remoteUrl.includes(':')) {
        const match = remoteUrl.match(/@([^:]+):/);
        if (match) {
          origin = `https://${match[1]}`;
        }
      }
      if (!origin) return;

      const authBasic = Buffer.from(`${username}:${token}`).toString('base64');
      try {
        execSync(`git config --local --unset-all "http.${origin}.extraheader"`, { cwd: repoPath, stdio: 'ignore' });
        execSync(`git config --local --unset-all "http.${origin}/.extraheader"`, { cwd: repoPath, stdio: 'ignore' });
      } catch {}
      execSync(`git config --local "http.${origin}.extraheader" "AUTHORIZATION: basic ${authBasic}"`, {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch (err) {
      console.warn('Failed to configure local repo credentials:', err);
    }
  }
}
