import React, { useState, useEffect, useRef } from 'react';
import {
  FolderGit2,
  GitFork,
  PlusCircle,
  X,
  Search,
  Lock,
  Globe,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Terminal,
  ExternalLink,
  ChevronRight,
  Folder,
  ArrowRight,
  RefreshCw,
  Github,
  GitBranch,
} from 'lucide-react';
import { FileSystemBrowser } from './FileSystemBrowser';
import { GitAccount, RemoteRepoItem, SelectionMeta, Project } from '../types';
import {
  getGitAccounts,
  getGitAccountRepos,
  cloneProjectStream,
  createNewProject,
  getFileSystem,
} from '../api';

interface AddProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenExisting: (path: string, meta: SelectionMeta) => void;
  onCloneSuccess: (clonedPath: string) => void;
  onCreateSuccess: (project: Project) => void;
  initialTab?: 'existing' | 'clone' | 'create';
}

export const AddProjectModal: React.FC<AddProjectModalProps> = ({
  isOpen,
  onClose,
  onOpenExisting,
  onCloneSuccess,
  onCreateSuccess,
  initialTab = 'existing',
}) => {
  const [activeTab, setActiveTab] = useState<'existing' | 'clone' | 'create'>(initialTab);

  // Common parent directory
  const [parentPath, setParentPath] = useState<string>('');
  const [isBrowseParentOpen, setIsBrowseParentOpen] = useState(false);

  // Git Accounts & Repositories for Clone tab
  const [gitAccounts, setGitAccounts] = useState<GitAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [accountRepos, setAccountRepos] = useState<RemoteRepoItem[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');
  const [cloneMode, setCloneMode] = useState<'account' | 'url'>('url');

  // Clone tab fields
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneFolderName, setCloneFolderName] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [cloneLogs, setCloneLogs] = useState('');
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [cloneSuccess, setCloneSuccess] = useState(false);
  const cloneAbortRef = useRef<(() => void) | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Create New tab fields
  const [newProjectName, setNewProjectName] = useState('');
  const [newDefaultBranch, setNewDefaultBranch] = useState('main');
  const [newInitReadme, setNewInitReadme] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Load home directory as default parent path and load accounts
  useEffect(() => {
    if (!isOpen) return;

    // Reset clone / create state on open
    setCloneError(null);
    setCloneSuccess(false);
    setCloneLogs('');
    setCreateError(null);

    getFileSystem()
      .then((fsData) => {
        if (fsData?.path && !parentPath) {
          setParentPath(fsData.path);
        }
      })
      .catch(() => {});

    getGitAccounts()
      .then((accounts) => {
        setGitAccounts(accounts);
        if (accounts.length > 0) {
          setSelectedAccountId(accounts[0].id);
          setCloneMode('account');
        } else {
          setCloneMode('url');
        }
      })
      .catch(() => {});
  }, [isOpen]);

  // Load remote repos when selected account changes
  useEffect(() => {
    if (!selectedAccountId) {
      setAccountRepos([]);
      return;
    }

    setIsLoadingRepos(true);
    getGitAccountRepos(selectedAccountId)
      .then((repos) => {
        setAccountRepos(repos);
      })
      .catch((err) => {
        console.error('Failed to load repos:', err);
        setAccountRepos([]);
      })
      .finally(() => {
        setIsLoadingRepos(false);
      });
  }, [selectedAccountId]);

  // Auto-scroll terminal when clone logs stream
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [cloneLogs]);

  // Clean up streaming on unmount
  useEffect(() => {
    return () => {
      if (cloneAbortRef.current) {
        cloneAbortRef.current();
      }
    };
  }, []);

  // Helper: auto-extract folder name from git URL
  const handleUrlChange = (url: string) => {
    setCloneUrl(url);
    if (!url.trim()) return;
    try {
      // Handles: https://github.com/owner/repo.git or git@github.com:owner/repo.git
      const clean = url.trim().replace(/\.git$/, '');
      const parts = clean.split(/[/:\\+]/);
      const last = parts[parts.length - 1];
      if (last && last.trim()) {
        setCloneFolderName(last.trim());
      }
    } catch {}
  };

  const handleSelectRemoteRepo = (repo: RemoteRepoItem) => {
    setCloneUrl(repo.cloneUrl);
    setCloneFolderName(repo.name);
  };

  const handleStartClone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneUrl.trim() || !parentPath.trim() || !cloneFolderName.trim()) return;

    setIsCloning(true);
    setCloneLogs('');
    setCloneError(null);
    setCloneSuccess(false);

    const cancel = cloneProjectStream(
      {
        url: cloneUrl.trim(),
        parentPath: parentPath.trim(),
        folderName: cloneFolderName.trim(),
        accountId: selectedAccountId || undefined,
      },
      (chunk) => {
        setCloneLogs((prev) => prev + chunk);
      },
      (res) => {
        setIsCloning(false);
        if (res.success && res.projectPath) {
          setCloneSuccess(true);
          setTimeout(() => {
            onCloneSuccess(res.projectPath!);
          }, 800);
        } else {
          setCloneError(res.error || 'Clone operation failed');
        }
      },
      (err) => {
        setIsCloning(false);
        setCloneError(err?.message || 'Network connection failed during clone');
      }
    );

    cloneAbortRef.current = cancel;
  };

  const handleCreateNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || !parentPath.trim()) return;

    try {
      setIsCreating(true);
      setCreateError(null);

      const result = await createNewProject({
        parentPath: parentPath.trim(),
        name: newProjectName.trim(),
        defaultBranch: newDefaultBranch.trim() || 'main',
        initReadme: newInitReadme,
      });

      if (result.project) {
        onCreateSuccess(result.project);
      }
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create new local repository');
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  const filteredRepos = accountRepos.filter((r) => {
    if (!repoSearch.trim()) return true;
    const query = repoSearch.toLowerCase();
    return (
      r.name.toLowerCase().includes(query) ||
      r.fullName.toLowerCase().includes(query) ||
      (r.description && r.description.toLowerCase().includes(query))
    );
  });

  const selectedAccount = gitAccounts.find((a) => a.id === selectedAccountId);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
        <div className="w-full max-w-3xl h-[84vh] rounded-squircle glass-panel border border-white/80 dark:border-white/10 shadow-soft-xl flex flex-col overflow-hidden relative">
          {/* Top Bar with Title and Tabs */}
          <div className="p-4 md:p-5 border-b border-cozy-border/50 bg-cozy-subtle/50 flex flex-col gap-3 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-cozy-text leading-tight">Add Project</h2>
                <p className="text-xs text-cozy-muted mt-0.5">
                  Open an existing repo, clone from remote, or initialize a new Git project.
                </p>
              </div>

              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center text-cozy-muted hover:text-rose-500 hover:bg-cozy-subtle transition-all cursor-pointer"
                title="Close (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tab Selector */}
            <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-cozy-surface border border-cozy-border/80 shadow-soft-sm">
              <button
                type="button"
                onClick={() => setActiveTab('existing')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'existing'
                    ? 'bg-rose-500 text-white shadow-soft-sm'
                    : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle/60'
                }`}
              >
                <FolderGit2 className="w-3.5 h-3.5" />
                <span>Open Existing</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('clone')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'clone'
                    ? 'bg-rose-500 text-white shadow-soft-sm'
                    : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle/60'
                }`}
              >
                <GitFork className="w-3.5 h-3.5" />
                <span>Clone Remote</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('create')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'create'
                    ? 'bg-rose-500 text-white shadow-soft-sm'
                    : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle/60'
                }`}
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Create New</span>
              </button>
            </div>
          </div>

          {/* Tab 1: Open Existing (FileSystemBrowser) */}
          {activeTab === 'existing' && (
            <div className="flex-1 overflow-hidden flex flex-col">
              <FileSystemBrowser
                embedded={true}
                open={true}
                onOpenChange={() => {}}
                selectionMode="repository"
                onSelect={onOpenExisting}
              />
            </div>
          )}

          {/* Tab 2: Clone Remote */}
          {activeTab === 'clone' && (
            <div className="flex-1 overflow-y-auto p-5 md:p-6 space-y-5">
              {/* Account Selection Bar */}
              <div className="p-4 rounded-2xl bg-cozy-surface border border-cozy-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-soft-sm">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-400/20 flex items-center justify-center text-rose-500 shrink-0">
                    {selectedAccount?.provider === 'gitlab' ? (
                      <GitBranch className="w-4 h-4" />
                    ) : (
                      <Github className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-bold text-cozy-text block">Linked Git Account</label>
                    <span className="text-[11px] text-cozy-muted">
                      Authenticate clones & private repositories
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={selectedAccountId}
                    onChange={(e) => {
                      setSelectedAccountId(e.target.value);
                      if (!e.target.value) setCloneMode('url');
                    }}
                    className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-cozy-subtle border border-cozy-border text-cozy-text focus:outline-none focus:border-rose-400 cursor-pointer"
                  >
                    <option value="">No linked account (Public Git)</option>
                    {gitAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.provider === 'github' ? 'GitHub' : 'GitLab'}: @{acc.username}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Mode Toggle if Account Selected */}
              {selectedAccountId && (
                <div className="flex items-center gap-2 border-b border-cozy-border/60 pb-2">
                  <button
                    type="button"
                    onClick={() => setCloneMode('account')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      cloneMode === 'account'
                        ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-400/30'
                        : 'text-cozy-muted hover:text-cozy-text'
                    }`}
                  >
                    Select from Account ({accountRepos.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setCloneMode('url')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      cloneMode === 'url'
                        ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-400/30'
                        : 'text-cozy-muted hover:text-cozy-text'
                    }`}
                  >
                    Custom Git URL
                  </button>
                </div>
              )}

              {/* Pick from Account Repository List */}
              {selectedAccountId && cloneMode === 'account' && (
                <div className="space-y-2.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-cozy-muted" />
                    <input
                      type="text"
                      value={repoSearch}
                      onChange={(e) => setRepoSearch(e.target.value)}
                      placeholder="Search remote repositories..."
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-cozy-surface border border-cozy-border focus:outline-none focus:border-rose-400 text-cozy-text"
                    />
                  </div>

                  <div className="border border-cozy-border rounded-2xl bg-cozy-surface overflow-hidden max-h-48 overflow-y-auto divide-y divide-cozy-border/50">
                    {isLoadingRepos ? (
                      <div className="p-6 text-center text-xs text-cozy-muted flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-rose-500" />
                        <span>Loading repositories from {selectedAccount?.provider}...</span>
                      </div>
                    ) : filteredRepos.length === 0 ? (
                      <div className="p-6 text-center text-xs text-cozy-muted">
                        No repositories found matching "{repoSearch}".
                      </div>
                    ) : (
                      filteredRepos.map((repo) => {
                        const isSelected = cloneUrl === repo.cloneUrl;
                        return (
                          <div
                            key={repo.fullName}
                            onClick={() => handleSelectRemoteRepo(repo)}
                            className={`p-3 flex items-center justify-between gap-3 cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-rose-500/10 text-cozy-text font-medium'
                                : 'hover:bg-cozy-subtle/60 text-cozy-text'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold truncate">{repo.fullName}</span>
                                {repo.isPrivate ? (
                                  <span className="flex items-center gap-0.5 text-[10px] text-amber-500 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                                    <Lock className="w-2.5 h-2.5" />
                                    <span>Private</span>
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-0.5 text-[10px] text-cozy-muted px-1.5 py-0.5 rounded bg-cozy-subtle border border-cozy-border">
                                    <Globe className="w-2.5 h-2.5" />
                                    <span>Public</span>
                                  </span>
                                )}
                              </div>
                              {repo.description && (
                                <p className="text-[11px] text-cozy-muted truncate mt-0.5">
                                  {repo.description}
                                </p>
                              )}
                            </div>

                            <button
                              type="button"
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 transition-all ${
                                isSelected
                                  ? 'bg-rose-500 text-white'
                                  : 'bg-cozy-subtle text-cozy-muted hover:text-cozy-text'
                              }`}
                            >
                              {isSelected ? 'Selected' : 'Use'}
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Form Inputs */}
              <form onSubmit={handleStartClone} className="space-y-4">
                {/* Git URL Field */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-cozy-text">
                    Git Repository URL <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={cloneUrl}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    placeholder="https://github.com/owner/repository.git"
                    required
                    disabled={isCloning}
                    className="w-full px-3.5 py-2.5 text-xs font-mono rounded-xl bg-cozy-surface border border-cozy-border focus:outline-none focus:border-rose-400 text-cozy-text disabled:opacity-60"
                  />
                </div>

                {/* Parent Folder & Target Folder Name Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-cozy-text">
                        Destination Parent Folder <span className="text-rose-500">*</span>
                      </label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={parentPath}
                        onChange={(e) => setParentPath(e.target.value)}
                        placeholder="/Users/username/Projects"
                        required
                        disabled={isCloning}
                        className="flex-1 px-3 py-2 text-xs font-mono rounded-xl bg-cozy-surface border border-cozy-border focus:outline-none focus:border-rose-400 text-cozy-text disabled:opacity-60 truncate"
                      />
                      <button
                        type="button"
                        onClick={() => setIsBrowseParentOpen(true)}
                        disabled={isCloning}
                        className="px-3 py-2 text-xs font-semibold rounded-xl bg-cozy-subtle hover:bg-cozy-surface border border-cozy-border text-cozy-muted hover:text-cozy-text transition-all shrink-0 cursor-pointer"
                      >
                        Browse...
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-cozy-text">
                      Folder Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={cloneFolderName}
                      onChange={(e) => setCloneFolderName(e.target.value)}
                      placeholder="repo-folder"
                      required
                      disabled={isCloning}
                      className="w-full px-3 py-2 text-xs font-mono rounded-xl bg-cozy-surface border border-cozy-border focus:outline-none focus:border-rose-400 text-cozy-text disabled:opacity-60"
                    />
                  </div>
                </div>

                {/* Path preview */}
                {parentPath && cloneFolderName && (
                  <div className="p-2.5 rounded-xl bg-cozy-subtle/50 border border-cozy-border/60 text-xs text-cozy-muted flex items-center gap-2">
                    <Folder className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span className="text-[11px] font-mono truncate">
                      Will clone to: <strong className="text-cozy-text">{parentPath}/{cloneFolderName}</strong>
                    </span>
                  </div>
                )}

                {/* Streaming Console if Cloning or Done */}
                {(isCloning || cloneLogs) && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs text-cozy-muted">
                      <span className="flex items-center gap-1.5 font-bold">
                        <Terminal className="w-3.5 h-3.5 text-rose-500" />
                        Clone Progress
                      </span>
                      {isCloning && (
                        <span className="flex items-center gap-1 text-sky-500 font-medium">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Cloning repository...
                        </span>
                      )}
                    </div>
                    <div
                      ref={terminalRef}
                      className="p-3 rounded-2xl bg-black/90 border border-white/10 font-mono text-[11px] text-zinc-300 h-32 overflow-y-auto whitespace-pre-wrap leading-relaxed"
                    >
                      {cloneLogs || 'Initializing clone...\n'}
                    </div>
                  </div>
                )}

                {/* Error Banner */}
                {cloneError && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-400/30 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="truncate">{cloneError}</span>
                  </div>
                )}

                {/* Success Banner */}
                {cloneSuccess && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-400/30 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Cloned successfully! Preparing project discovery...</span>
                  </div>
                )}

                {/* Action Button */}
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isCloning}
                    className="px-4 py-2 rounded-full text-xs font-semibold text-cozy-muted hover:text-cozy-text bg-cozy-surface border border-cozy-border transition-all cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={isCloning || !cloneUrl.trim() || !cloneFolderName.trim()}
                    className="flex items-center gap-2 px-5 py-2 rounded-full text-xs font-semibold bg-rose-500 hover:bg-rose-600 text-white transition-all disabled:opacity-50 shadow-glow-peach cursor-pointer"
                  >
                    {isCloning ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Cloning...</span>
                      </>
                    ) : (
                      <>
                        <GitFork className="w-3.5 h-3.5" />
                        <span>Clone Repository</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Tab 3: Create New */}
          {activeTab === 'create' && (
            <div className="flex-1 overflow-y-auto p-5 md:p-6 space-y-5">
              <form onSubmit={handleCreateNew} className="space-y-4">
                {/* Project Name */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-cozy-text">
                    Project Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="my-new-application"
                    required
                    disabled={isCreating}
                    className="w-full px-3.5 py-2.5 text-xs font-mono rounded-xl bg-cozy-surface border border-cozy-border focus:outline-none focus:border-rose-400 text-cozy-text disabled:opacity-60"
                  />
                </div>

                {/* Destination Parent Directory */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-cozy-text">
                    Destination Parent Directory <span className="text-rose-500">*</span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={parentPath}
                      onChange={(e) => setParentPath(e.target.value)}
                      placeholder="/Users/username/Projects"
                      required
                      disabled={isCreating}
                      className="flex-1 px-3 py-2 text-xs font-mono rounded-xl bg-cozy-surface border border-cozy-border focus:outline-none focus:border-rose-400 text-cozy-text disabled:opacity-60 truncate"
                    />
                    <button
                      type="button"
                      onClick={() => setIsBrowseParentOpen(true)}
                      disabled={isCreating}
                      className="px-3 py-2 text-xs font-semibold rounded-xl bg-cozy-subtle hover:bg-cozy-surface border border-cozy-border text-cozy-muted hover:text-cozy-text transition-all shrink-0 cursor-pointer"
                    >
                      Browse...
                    </button>
                  </div>
                </div>

                {/* Default Branch Name */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-cozy-text">
                    Initial Branch Name
                  </label>
                  <input
                    type="text"
                    value={newDefaultBranch}
                    onChange={(e) => setNewDefaultBranch(e.target.value)}
                    placeholder="main"
                    disabled={isCreating}
                    className="w-full px-3 py-2 text-xs font-mono rounded-xl bg-cozy-surface border border-cozy-border focus:outline-none focus:border-rose-400 text-cozy-text disabled:opacity-60"
                  />
                </div>

                {/* Initial Readme Checkbox */}
                <div className="p-3.5 rounded-2xl bg-cozy-surface border border-cozy-border shadow-soft-sm flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="initReadme"
                    checked={newInitReadme}
                    onChange={(e) => setNewInitReadme(e.target.checked)}
                    disabled={isCreating}
                    className="mt-0.5 rounded border-cozy-border text-rose-500 focus:ring-rose-400 cursor-pointer"
                  />
                  <label htmlFor="initReadme" className="text-xs text-cozy-text cursor-pointer select-none">
                    <strong className="block font-bold">Initialize with README.md and initial commit</strong>
                    <span className="text-cozy-muted text-[11px]">
                      Recommended. Ensures Git worktrees and task branches work immediately without needing manual commits.
                    </span>
                  </label>
                </div>

                {/* Path preview */}
                {parentPath && newProjectName && (
                  <div className="p-2.5 rounded-xl bg-cozy-subtle/50 border border-cozy-border/60 text-xs text-cozy-muted flex items-center gap-2">
                    <Folder className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span className="text-[11px] font-mono truncate">
                      Will create repository in: <strong className="text-cozy-text">{parentPath}/{newProjectName}</strong>
                    </span>
                  </div>
                )}

                {/* Error Banner */}
                {createError && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-400/30 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="truncate">{createError}</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isCreating}
                    className="px-4 py-2 rounded-full text-xs font-semibold text-cozy-muted hover:text-cozy-text bg-cozy-surface border border-cozy-border transition-all cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={isCreating || !newProjectName.trim()}
                    className="flex items-center gap-2 px-5 py-2 rounded-full text-xs font-semibold bg-rose-500 hover:bg-rose-600 text-white transition-all disabled:opacity-50 shadow-glow-peach cursor-pointer"
                  >
                    {isCreating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Creating Repo...</span>
                      </>
                    ) : (
                      <>
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>Create & Open Project</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Secondary FileSystemBrowser modal when user clicks 'Browse...' for parent folder */}
      {isBrowseParentOpen && (
        <FileSystemBrowser
          open={isBrowseParentOpen}
          onOpenChange={setIsBrowseParentOpen}
          initialPath={parentPath}
          title="Choose Destination Parent Folder"
          selectionMode="folder"
          onSelect={(selected) => {
            setParentPath(selected);
            setIsBrowseParentOpen(false);
          }}
        />
      )}
    </>
  );
};
