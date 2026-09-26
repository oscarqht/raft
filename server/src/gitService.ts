import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string;
  isMain: boolean;
}

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

  static createWorktree(repoRoot: string, taskSlug: string, baseBranch: string): { worktreePath: string; branch: string } {
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
}
