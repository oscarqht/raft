import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderGit2, Trash2, ArrowRight, Sparkles, Sliders, Loader2 } from 'lucide-react';
import { Project, Settings, SelectionMeta } from '../types';
import { getProjects, deleteProject, validateProjectPath } from '../api';
import { DiscoveryModal } from '../components/DiscoveryModal';
import { AddProjectModal } from '../components/AddProjectModal';
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
  const [loading, setLoading] = useState(true);
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

  const loadProjects = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const data = await getProjects();
      setProjects(data);
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects(true);
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
    <div className="flex-1 overflow-y-auto p-6 sm:p-8 md:p-10 max-w-6xl mx-auto w-full">
      {/* Welcome Banner */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-cozy-text flex items-center gap-2.5">
            Local Projects
            <Sparkles className="w-5 h-5 text-teal-400 fill-teal-400/20" />
          </h1>
          <p className="text-sm text-cozy-muted mt-1 leading-relaxed">
            Manage your Git projects and launch AI-assisted tasks with isolated worktrees.
          </p>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white transition-all shadow-glow-ocean shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Project</span>
        </button>
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 text-cozy-muted text-sm gap-3">
          <Loader2 className="w-7 h-7 text-teal-500 animate-spin" />
          <span className="font-medium">Loading projects...</span>
        </div>
      ) : projects.length === 0 ? (
        <div className="p-12 text-center rounded-squircle border border-dashed border-cozy-border/80 glass-panel shadow-soft flex flex-col items-center">
          <div className="w-20 h-20 rounded-2.5xl flex items-center justify-center mb-4 overflow-hidden drop-shadow-md">
            <img src="/logo.png" alt="Raft otter" className="w-full h-full object-contain" />
          </div>
          <h3 className="text-base font-semibold text-cozy-text mb-1">Welcome to Raft</h3>
          <p className="text-sm text-cozy-muted max-w-md mb-6 leading-relaxed">
            Add a local git repository to start using autonomous AI coding agents in clean git worktrees.
          </p>
          <button
            onClick={() => setIsAddOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white transition-all shadow-glow-ocean"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add First Project</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map((p) => (
            <div
              key={p.id}
              onClick={() => handleSelect(p.id)}
              className="group relative p-6 rounded-squircle glass-card border border-white/80 dark:border-white/10 hover:border-teal-400/40 shadow-soft hover:shadow-soft-lg hover:-translate-y-1 transition-all cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-teal-500/20 via-cyan-500/15 to-sky-500/20 border border-teal-400/30 flex items-center justify-center text-teal-600 dark:text-teal-400 shadow-soft-sm text-2xl select-none">
                    {p.icon ? <span>{p.icon}</span> : <FolderGit2 className="w-6 h-6" />}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingProject(p);
                      }}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-cozy-muted hover:text-teal-600 dark:hover:text-teal-400 hover:bg-cozy-subtle transition-all"
                      title="Edit project configuration"
                    >
                      <Sliders className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => handleDelete(p.id, e)}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-cozy-muted hover:text-red-500 hover:bg-red-500/10 transition-all"
                      title="Remove project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <h3 className="text-base font-semibold text-cozy-text mb-1 truncate group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
                  {p.name}
                </h3>
                <p className="text-xs font-mono text-cozy-muted truncate mb-4" title={p.path}>
                  {p.path}
                </p>


              </div>

              <div className="pt-3.5 border-t border-cozy-border/50 flex items-center justify-between text-xs text-cozy-muted font-medium">
                <span>{p.task_count || 0} active {p.task_count === 1 ? 'task' : 'tasks'}</span>
                <span className="flex items-center gap-1 text-teal-600 dark:text-teal-400 group-hover:translate-x-1 transition-transform font-semibold">
                  Open Project <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Unified Add Project Modal (Open Existing, Clone Remote, Create New) */}
      <AddProjectModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onOpenExisting={handleSelectRepository}
        onCloneSuccess={(clonedPath) => {
          setIsAddOpen(false);
          setDiscoveryPath(clonedPath);
          setIsDiscoveryOpen(true);
        }}
        onCreateSuccess={(newProject) => {
          setIsAddOpen(false);
          loadProjects();
          if (newProject?.id) {
            handleSelect(newProject.id);
          }
        }}
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
