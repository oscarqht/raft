import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderGit2, GitBranch, Terminal, Trash2, ArrowRight, Sparkles, Sliders } from 'lucide-react';
import { Project, Settings, SelectionMeta } from '../types';
import { getProjects, deleteProject, validateProjectPath } from '../api';
import { DiscoveryModal } from '../components/DiscoveryModal';
import { FileSystemBrowser } from '../components/FileSystemBrowser';
import { ProjectConfigModal } from '../components/ProjectConfigModal';

interface HomePageProps {
  onSelectProject?: (projectId: string) => void;
  settings: Settings | null;
  ws: WebSocket | null;
}

export const HomePage: React.FC<HomePageProps> = ({
  onSelectProject,
  settings,
  ws,
}) => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [discoveryPath, setDiscoveryPath] = useState('');
  const [isDiscoveryOpen, setIsDiscoveryOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const handleSelect = (id: string) => {
    if (onSelectProject) {
      onSelectProject(id);
    } else {
      navigate(`/projects/${id}`);
    }
  };

  const loadProjects = async () => {
    try {
      const data = await getProjects();
      setProjects(data);
    } catch {}
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleSelectRepository = async (selectedPath: string, _meta: SelectionMeta) => {
    if (!selectedPath) return;
    try {
      const result = await validateProjectPath(selectedPath.trim());
      setDiscoveryPath(result.repoRoot || selectedPath.trim());
      setIsAddOpen(false);
      setIsDiscoveryOpen(true);
    } catch (err: any) {
      console.error('Validation error:', err);
      // Fallback to selected path
      setDiscoveryPath(selectedPath.trim());
      setIsAddOpen(false);
      setIsDiscoveryOpen(true);
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
              onClick={() => handleSelect(p.id)}
              className="group relative p-5 rounded-2xl bg-cozy-surface border border-cozy-border hover:border-sky-500/40 hover:shadow-lg transition-all cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
                    <FolderGit2 className="w-5 h-5 text-sky-400" />
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingProject(p);
                      }}
                      className="p-1.5 rounded-lg text-cozy-muted hover:text-sky-400 hover:bg-sky-500/10 transition-all"
                      title="Edit project configuration"
                    >
                      <Sliders className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => handleDelete(p.id, e)}
                      className="p-1.5 rounded-lg text-cozy-muted hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                      title="Remove project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
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

      {/* Web-based in-page folder selector (like trident) */}
      <FileSystemBrowser
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        title="Add Local Git Repository"
        selectionMode="repository"
        onSelect={handleSelectRepository}
      />

      {/* Discovery Modal */}
      <DiscoveryModal
        projectPath={discoveryPath}
        isOpen={isDiscoveryOpen}
        onClose={() => setIsDiscoveryOpen(false)}
        onSuccess={(newProject?: Project) => {
          loadProjects();
          if (newProject?.id) {
            handleSelect(newProject.id);
          }
        }}
        settings={settings}
        ws={ws}
      />

      {/* Edit Project Configuration Modal */}
      {editingProject && (
        <ProjectConfigModal
          project={editingProject}
          isOpen={!!editingProject}
          onClose={() => setEditingProject(null)}
          onSuccess={() => {
            loadProjects();
            setEditingProject(null);
          }}
          settings={settings}
          ws={ws}
        />
      )}
    </div>
  );
};
