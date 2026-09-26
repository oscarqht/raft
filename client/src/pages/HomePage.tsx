import React, { useState, useEffect } from 'react';
import { Plus, FolderGit2, GitBranch, Terminal, Trash2, ArrowRight, Sparkles, AlertCircle } from 'lucide-react';
import { Project, Settings } from '../types';
import { getProjects, deleteProject, validateProjectPath } from '../api';
import { DiscoveryModal } from '../components/DiscoveryModal';

interface HomePageProps {
  onSelectProject: (projectId: string) => void;
  settings: Settings | null;
  ws: WebSocket | null;
}

export const HomePage: React.FC<HomePageProps> = ({
  onSelectProject,
  settings,
  ws,
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [inputPath, setInputPath] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [discoveryPath, setDiscoveryPath] = useState('');
  const [isDiscoveryOpen, setIsDiscoveryOpen] = useState(false);

  const loadProjects = async () => {
    try {
      const data = await getProjects();
      setProjects(data);
    } catch {}
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleValidateAndDiscover = async () => {
    if (!inputPath.trim()) return;
    setIsValidating(true);
    setValidationError('');

    try {
      const result = await validateProjectPath(inputPath.trim());
      if (!result.isRepo) {
        setValidationError(result.error || 'The specified folder is not a valid git repository.');
        setIsValidating(false);
        return;
      }
      setDiscoveryPath(result.repoRoot || inputPath.trim());
      setIsAddOpen(false);
      setInputPath('');
      setIsDiscoveryOpen(true);
    } catch (err: any) {
      setValidationError(err.message);
    } finally {
      setIsValidating(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to remove this project? Any active task worktrees will also be removed.')) {
      await deleteProject(id);
      loadProjects();
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8 max-w-6xl mx-auto w-full">
      {/* Welcome Banner */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-cozy-text flex items-center gap-2">
            Local Projects
            <Sparkles className="w-5 h-5 text-amber-400" />
          </h1>
          <p className="text-sm text-cozy-muted mt-1">
            Manage your Git projects and launch AI-assisted tasks with isolated worktrees.
          </p>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-sky-600 hover:bg-sky-500 text-white transition-all shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Project</span>
        </button>
      </div>

      {/* Projects Grid */}
      {projects.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-dashed border-cozy-border bg-cozy-surface/40 flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-cozy-subtle border border-cozy-border flex items-center justify-center mb-4">
            <FolderGit2 className="w-7 h-7 text-sky-400" />
          </div>
          <h3 className="text-base font-semibold text-cozy-text mb-1">No projects added yet</h3>
          <p className="text-sm text-cozy-muted max-w-md mb-6">
            Add a local git repository to start using autonomous AI coding agents in clean git worktrees.
          </p>
          <button
            onClick={() => setIsAddOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add First Project</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <div
              key={p.id}
              onClick={() => onSelectProject(p.id)}
              className="group relative p-5 rounded-2xl bg-cozy-surface border border-cozy-border hover:border-sky-500/40 hover:shadow-lg transition-all cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
                    <FolderGit2 className="w-5 h-5 text-sky-400" />
                  </div>
                  <button
                    onClick={(e) => handleDelete(p.id, e)}
                    className="p-1.5 rounded-lg text-cozy-muted opacity-0 group-hover:opacity-100 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                    title="Remove project"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <h3 className="text-base font-semibold text-cozy-text mb-1 truncate group-hover:text-sky-400 transition-colors">
                  {p.name}
                </h3>
                <p className="text-xs font-mono text-cozy-muted truncate mb-3" title={p.path}>
                  {p.path}
                </p>

                <div className="flex flex-wrap gap-2 text-xs mb-4">
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-cozy-subtle border border-cozy-border text-cozy-muted font-mono text-[11px]">
                    <GitBranch className="w-3 h-3 text-amber-400" />
                    {p.branch_convention || 'main'}
                  </span>
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-cozy-subtle border border-cozy-border text-cozy-muted font-mono text-[11px]">
                    <Terminal className="w-3 h-3 text-emerald-400" />
                    :{p.dev_port || 5173}
                  </span>
                </div>
              </div>

              <div className="pt-3 border-t border-cozy-border/60 flex items-center justify-between text-xs text-cozy-muted">
                <span>{p.task_count || 0} active {p.task_count === 1 ? 'task' : 'tasks'}</span>
                <span className="flex items-center gap-1 text-sky-400 group-hover:translate-x-0.5 transition-transform">
                  Open Project <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Project Path Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-cozy-surface border border-cozy-border rounded-2xl shadow-2xl p-6">
            <h3 className="text-base font-semibold text-cozy-text mb-1 flex items-center gap-2">
              <FolderGit2 className="w-5 h-5 text-sky-400" />
              Add Local Git Repository
            </h3>
            <p className="text-xs text-cozy-muted mb-4">
              Enter the absolute path to your local repository on this machine.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-cozy-text block mb-1">Repository Path</label>
                <input
                  type="text"
                  value={inputPath}
                  onChange={(e) => setInputPath(e.target.value)}
                  placeholder="/Users/username/projects/my-app"
                  className="w-full bg-cozy-bg border border-cozy-border rounded-xl px-3.5 py-2.5 text-xs font-mono text-cozy-text focus:outline-none focus:border-sky-500"
                  autoFocus
                />
              </div>

              {validationError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{validationError}</span>
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end space-x-2">
              <button
                onClick={() => {
                  setIsAddOpen(false);
                  setValidationError('');
                }}
                className="px-4 py-2 rounded-xl text-xs font-medium bg-cozy-subtle hover:bg-cozy-subtle/80 text-cozy-text border border-cozy-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleValidateAndDiscover}
                disabled={isValidating || !inputPath.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white transition-all shadow-sm"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isValidating ? 'Validating...' : 'Auto-Discover with AI'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discovery Modal */}
      <DiscoveryModal
        projectPath={discoveryPath}
        isOpen={isDiscoveryOpen}
        onClose={() => setIsDiscoveryOpen(false)}
        onSuccess={() => {
          loadProjects();
        }}
        settings={settings}
        ws={ws}
      />
    </div>
  );
};
