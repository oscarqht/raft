import React, { useState, useEffect, useRef } from 'react';
import {
  Folder,
  FolderGit2,
  ChevronRight,
  CornerLeftUp,
  Plus,
  HardDrive,
  Home,
  X,
  Loader2,
  AlertCircle,
  FolderPlus,
  Check,
  Edit2,
  RefreshCw,
} from 'lucide-react';
import { FSItem, FSResponse, SelectionMeta } from '../types';
import { getFileSystem, createFolder, initGitRepository } from '../api';

interface FileSystemBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string, meta: SelectionMeta) => void;
  initialPath?: string;
  title?: string;
  selectionMode?: 'repository' | 'folder';
  embedded?: boolean;
}

export const FileSystemBrowser: React.FC<FileSystemBrowserProps> = ({
  open,
  onOpenChange,
  onSelect,
  initialPath,
  title = 'Add Local Git Repository',
  selectionMode = 'repository',
  embedded = false,
}) => {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [data, setData] = useState<FSResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false);

  // Path bar manual editing
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('');

  // Folder creation
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Non-repo initialization confirmation dialog
  const [pendingNonRepoPath, setPendingNonRepoPath] = useState<string | null>(null);
  const [isInitializingGit, setIsInitializingGit] = useState(false);

  const listContainerRef = useRef<HTMLDivElement>(null);

  const loadPath = async (targetPath?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await getFileSystem(targetPath);
      setData(res);
      setCurrentPath(res.path);
      setPathInput(res.path);
      setIsEditingPath(false);
      setShowNewFolderInput(false);
      setNewFolderName('');
    } catch (e: any) {
      setError(e.message || 'Failed to open directory');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open && !hasInitialized) {
      loadPath(initialPath);
      setHasInitialized(true);
    }
    if (!open) {
      setHasInitialized(false);
      setError(null);
      setPendingNonRepoPath(null);
      setShowNewFolderInput(false);
    }
  }, [open, initialPath, hasInitialized]);

  // Handle escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') {
        if (pendingNonRepoPath) {
          setPendingNonRepoPath(null);
        } else if (showNewFolderInput) {
          setShowNewFolderInput(false);
        } else if (isEditingPath) {
          setIsEditingPath(false);
        } else {
          onOpenChange(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, pendingNonRepoPath, showNewFolderInput, isEditingPath, onOpenChange]);

  const handleSelectPath = (targetPath: string, isRepo: boolean) => {
    if (!targetPath) return;

    if (selectionMode === 'repository' && !isRepo) {
      // Prompt user to initialize git repo or choose another folder
      setPendingNonRepoPath(targetPath);
      return;
    }

    onSelect(targetPath, { isRepo });
    onOpenChange(false);
  };

  const handleConfirmInitGit = async () => {
    if (!pendingNonRepoPath) return;
    setIsInitializingGit(true);
    try {
      await initGitRepository(pendingNonRepoPath);
      const selected = pendingNonRepoPath;
      setPendingNonRepoPath(null);
      onSelect(selected, { isRepo: true });
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || 'Failed to initialize Git repository');
    } finally {
      setIsInitializingGit(false);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const folderName = newFolderName.trim();
    if (!folderName || !currentPath || isCreatingFolder) return;

    setIsCreatingFolder(true);
    try {
      const res = await createFolder(currentPath, folderName);
      setShowNewFolderInput(false);
      setNewFolderName('');
      await loadPath(res.path);
    } catch (err: any) {
      setError(err.message || 'Failed to create folder');
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handlePathInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pathInput.trim()) return;
    loadPath(pathInput.trim());
  };

  // Split path for interactive breadcrumb navigation
  const getBreadcrumbs = () => {
    if (!currentPath) return [];

    // Check if windows drive path, e.g. C:\Users\...
    const isWin = /^[a-zA-Z]:\\/.test(currentPath);
    const normalized = currentPath.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);

    if (isWin) {
      const driveLetter = currentPath.slice(0, 3); // 'C:\'
      const crumbs = [{ label: driveLetter, path: driveLetter }];
      let accumulated = driveLetter;
      for (let i = 1; i < parts.length; i++) {
        accumulated = accumulated.endsWith('\\') || accumulated.endsWith('/')
          ? `${accumulated}${parts[i]}`
          : `${accumulated}\\${parts[i]}`;
        crumbs.push({ label: parts[i], path: accumulated });
      }
      return crumbs;
    }

    // Unix style /path/to/folder
    const crumbs = [{ label: '/', path: '/' }];
    let accumulated = '';
    for (const part of parts) {
      accumulated = `${accumulated}/${part}`;
      crumbs.push({ label: part, path: accumulated });
    }
    return crumbs;
  };

  if (!open) return null;

  const content = (
    <div className={`flex flex-col overflow-hidden relative ${embedded ? 'w-full h-full' : 'w-full max-w-3xl h-[82vh] rounded-squircle glass-panel border border-white/80 dark:border-white/10 shadow-soft-xl'}`}>
      {/* Header */}
      <div className={`${embedded ? 'p-3 md:p-4' : 'p-4 md:p-5'} border-b border-cozy-border/50 bg-cozy-subtle/50 flex flex-col gap-3 shrink-0`}>
        {!embedded && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-rose-500/15 via-amber-500/10 to-sky-500/15 border border-rose-400/25 flex items-center justify-center text-rose-500 shadow-soft-sm shrink-0">
                <FolderGit2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-cozy-text leading-tight">{title}</h3>
                <p className="text-xs text-cozy-muted mt-0.5">
                  Choose a folder directly in your local filesystem
                </p>
              </div>
            </div>

            <button
              onClick={() => onOpenChange(false)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-cozy-muted hover:text-rose-500 hover:bg-cozy-subtle transition-all cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Quick shortcuts & Windows drives bar */}
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            {data?.drives && data.drives.length > 0 && (
              <div className="flex items-center gap-1 mr-2 border-r border-cozy-border pr-2">
                {data.drives.map((drive) => {
                  const isActive = currentPath.toLowerCase().startsWith(drive.toLowerCase());
                  return (
                    <button
                      key={drive}
                      onClick={() => loadPath(drive)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg font-mono text-[11px] font-medium transition-colors ${
                        isActive
                          ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                          : 'bg-cozy-bg border border-cozy-border text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle'
                      }`}
                      title={`Drive ${drive}`}
                    >
                      <HardDrive className="w-3 h-3" />
                      <span>{drive}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {data?.shortcuts?.map((sc) => {
              const isActive = currentPath.toLowerCase() === sc.path.toLowerCase();
              return (
                <button
                  key={sc.path}
                  onClick={() => loadPath(sc.path)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                    isActive
                      ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                      : 'bg-cozy-bg border border-cozy-border text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle'
                  }`}
                >
                  {sc.name === 'Home' && <Home className="w-3 h-3" />}
                  <span>{sc.name}</span>
                </button>
              );
            })}

            <button
              onClick={() => loadPath(currentPath)}
              className="ml-auto p-1 text-cozy-muted hover:text-cozy-text rounded-md hover:bg-cozy-subtle transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Interactive Breadcrumb / Path Edit Bar */}
          <div className="flex items-center gap-2">
            {isEditingPath ? (
              <form onSubmit={handlePathInputSubmit} className="flex items-center gap-2 w-full">
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  className="flex-1 bg-cozy-bg border border-sky-500/60 rounded-xl px-3 py-1.5 text-xs font-mono text-cozy-text focus:outline-none focus:ring-1 focus:ring-sky-500"
                  autoFocus
                  placeholder="/path/to/folder"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-xl transition-colors shrink-0"
                >
                  Go
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingPath(false);
                    setPathInput(currentPath);
                  }}
                  className="p-1.5 text-cozy-muted hover:text-cozy-text rounded-lg hover:bg-cozy-subtle transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <div className="flex items-center justify-between w-full bg-cozy-bg border border-cozy-border rounded-xl px-2.5 py-1 text-xs">
                <div className="flex items-center gap-1 overflow-x-auto py-0.5 no-scrollbar flex-1 font-mono">
                  {getBreadcrumbs().map((crumb, idx, arr) => (
                    <React.Fragment key={crumb.path}>
                      <button
                        onClick={() => loadPath(crumb.path)}
                        className={`hover:text-sky-400 hover:underline px-1 py-0.5 rounded transition-colors whitespace-nowrap ${
                          idx === arr.length - 1 ? 'font-semibold text-cozy-text' : 'text-cozy-muted'
                        }`}
                        title={crumb.path}
                      >
                        {crumb.label}
                      </button>
                      {idx < arr.length - 1 && (
                        <ChevronRight className="w-3 h-3 text-cozy-muted/50 shrink-0" />
                      )}
                    </React.Fragment>
                  ))}
                </div>

                <button
                  onClick={() => {
                    setPathInput(currentPath);
                    setIsEditingPath(true);
                  }}
                  className="p-1 text-cozy-muted hover:text-cozy-text rounded hover:bg-cozy-subtle transition-colors shrink-0 ml-1"
                  title="Edit or paste path directly"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Directory Listing Body */}
        <div ref={listContainerRef} className="flex-1 overflow-y-auto relative bg-cozy-surface">
          {isLoading && (
            <div className="absolute inset-0 bg-cozy-surface/75 backdrop-blur-[1px] flex items-center justify-center z-20">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-7 h-7 text-sky-500 animate-spin" />
                <span className="text-xs text-cozy-muted font-medium">Reading directory...</span>
              </div>
            </div>
          )}

          {error && (
            <div className="m-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="flex-1">{error}</span>
              <button
                onClick={() => loadPath(data?.parent || undefined)}
                className="underline hover:text-rose-300 ml-2"
              >
                Go Back
              </button>
            </div>
          )}

          {/* New folder input row */}
          {showNewFolderInput && (
            <form
              onSubmit={handleCreateFolder}
              className="px-4 py-2.5 bg-sky-500/5 border-b border-sky-500/20 flex items-center gap-2"
            >
              <FolderPlus className="w-4 h-4 text-sky-400 shrink-0" />
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New folder name"
                className="flex-1 bg-cozy-bg border border-cozy-border rounded-lg px-2.5 py-1 text-xs font-mono text-cozy-text focus:outline-none focus:border-sky-500"
                autoFocus
              />
              <button
                type="submit"
                disabled={isCreatingFolder || !newFolderName.trim()}
                className="px-3 py-1 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors shrink-0"
              >
                {isCreatingFolder ? 'Creating...' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setShowNewFolderInput(false)}
                className="p-1 text-cozy-muted hover:text-cozy-text rounded-md hover:bg-cozy-subtle transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </form>
          )}

          <div className="divide-y divide-cozy-border/50">
            {/* Go Up (Parent Directory) */}
            {data?.parent && (
              <div
                onClick={() => loadPath(data.parent!)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-cozy-subtle/70 cursor-pointer text-cozy-muted hover:text-cozy-text transition-colors group"
                title={`Up to: ${data.parent}`}
              >
                <div className="w-7 h-7 rounded-lg bg-cozy-subtle flex items-center justify-center text-cozy-muted group-hover:text-cozy-text transition-colors">
                  <CornerLeftUp className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-mono font-medium">..</span>
                  <span className="text-[10px] text-cozy-muted truncate">Up to parent directory</span>
                </div>
              </div>
            )}

            {/* Folders List */}
            {data?.folders && data.folders.length > 0 ? (
              data.folders.map((item: FSItem) => (
                <div
                  key={item.path}
                  onClick={() => loadPath(item.path)}
                  className={`flex items-center justify-between px-4 py-2.5 hover:bg-cozy-subtle/80 cursor-pointer group transition-colors ${
                    item.name.startsWith('.') ? 'opacity-60 hover:opacity-100' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 pr-3">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                        item.isRepo
                          ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400 group-hover:bg-amber-500/20'
                          : 'bg-cozy-subtle border border-cozy-border text-cozy-muted group-hover:text-cozy-text'
                      }`}
                    >
                      {item.isRepo ? (
                        <FolderGit2 className="w-4 h-4" />
                      ) : (
                        <Folder className="w-4 h-4" />
                      )}
                    </div>

                    <div className="min-w-0 flex items-center gap-2">
                      <span
                        className={`text-xs font-mono truncate ${
                          item.isRepo ? 'font-semibold text-cozy-text' : 'text-cozy-text'
                        }`}
                      >
                        {item.name}
                      </span>

                      {item.isRepo && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">
                          Git Repo
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectPath(item.path, item.isRepo);
                      }}
                      className={`px-3 py-1 rounded-xl text-xs font-medium transition-all ${
                        item.isRepo
                          ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-sm'
                          : 'bg-cozy-subtle hover:bg-cozy-subtle/80 text-cozy-text border border-cozy-border group-hover:border-cozy-muted/40'
                      }`}
                    >
                      {item.isRepo ? 'Select Repo' : selectionMode === 'folder' ? 'Use Folder' : 'Select'}
                    </button>
                  </div>
                </div>
              ))
            ) : !isLoading && !error ? (
              <div className="py-16 text-center text-cozy-muted flex flex-col items-center">
                <Folder className="w-10 h-10 text-cozy-muted/40 mb-2" />
                <p className="text-xs">No subfolders found in this directory</p>
                <p className="text-[11px] opacity-70 mt-1">
                  You can use the current folder or create a new subfolder below.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-cozy-border bg-cozy-subtle/40 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-cozy-muted truncate w-full sm:w-auto">
            {data?.isRepo ? (
              <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                <FolderGit2 className="w-4 h-4 shrink-0" />
                <span>Current folder is a Git repository</span>
              </div>
            ) : (
              <span>Click folder to open, or select it directly</span>
            )}
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              onClick={() => setShowNewFolderInput(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium bg-cozy-subtle hover:bg-cozy-surface text-cozy-text border border-cozy-border transition-all shadow-soft-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Folder</span>
            </button>

            <button
              onClick={() => handleSelectPath(currentPath, !!data?.isRepo)}
              disabled={isLoading || !currentPath}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold transition-all shadow-glow-peach cursor-pointer ${
                data?.isRepo
                  ? 'bg-rose-500 hover:bg-rose-600 text-white'
                  : 'bg-rose-500 hover:bg-rose-600 text-white'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                {data?.isRepo
                  ? 'Use Current Repo'
                  : selectionMode === 'folder'
                  ? 'Use Current Folder'
                  : 'Select Current Folder'}
              </span>
            </button>
          </div>
        </div>

        {/* Non-Repo Confirmation Modal (when user selects folder that has no git repo) */}
        {pendingNonRepoPath && (
          <div className="absolute inset-0 z-30 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-squircle glass-panel border border-white/80 dark:border-white/10 shadow-soft-xl p-5 sm:p-6 animate-in zoom-in-95 duration-150">
              <div className="flex items-start gap-3.5 mb-3.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-500 shrink-0 shadow-soft-sm">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-cozy-text">Not a Git Repository</h4>
                  <p className="text-xs text-cozy-muted mt-0.5">
                    The chosen folder is not a git repository yet:
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-cozy-surface/90 border border-cozy-border font-mono text-xs text-cozy-text truncate mb-4 shadow-soft-inner">
                {pendingNonRepoPath}
              </div>

              <p className="text-xs text-cozy-muted mb-5 leading-relaxed">
                Would you like to initialize a new Git repository in this folder now?
              </p>

              <div className="flex items-center justify-end gap-2.5">
                <button
                  onClick={() => setPendingNonRepoPath(null)}
                  className="px-4 py-2 rounded-full text-xs font-medium bg-cozy-subtle hover:bg-cozy-surface text-cozy-text border border-cozy-border transition-all"
                >
                  Choose Another
                </button>
                <button
                  onClick={handleConfirmInitGit}
                  disabled={isInitializingGit}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white transition-all shadow-glow-peach cursor-pointer"
                >
                  {isInitializingGit ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Initializing...</span>
                    </>
                  ) : (
                    <>
                      <FolderGit2 className="w-3.5 h-3.5" />
                      <span>Initialize Git Repo</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );

  if (embedded) {
    return content;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      {content}
    </div>
  );
};
