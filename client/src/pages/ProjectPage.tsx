import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Plus,
  ArrowLeft,
  GitBranch,
  Terminal,
  Trash2,
  ArrowRight,
  FolderGit2,
  CheckCircle2,
  Clock,
  Sliders,
  Sparkles,
  Pencil,
} from 'lucide-react';
import { Project, Task, Settings } from '../types';
import { getProject, getProjectTasks, createTask, deleteTask, validateProjectPath } from '../api';
import { ProjectConfigModal } from '../components/ProjectConfigModal';

interface ProjectPageProps {
  projectId?: string;
  onBack?: () => void;
  onSelectTask?: (taskId: string) => void;
  settings?: Settings | null;
  ws?: WebSocket | null;
}

export const ProjectPage: React.FC<ProjectPageProps> = ({
  projectId: propProjectId,
  onBack: propOnBack,
  onSelectTask: propOnSelectTask,
  settings,
  ws,
}) => {
  const params = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const projectId = propProjectId || params.projectId || '';
  const onBack = propOnBack || (() => navigate('/'));
  const onSelectTask = propOnSelectTask || ((taskId: string) => navigate(`/projects/${projectId}/tasks/${taskId}`));

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
  const [taskName, setTaskName] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [availableBranches, setAvailableBranches] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [configModalMode, setConfigModalMode] = useState<'manual' | 'discover'>('manual');

  const loadData = async () => {
    if (!projectId) {
      setError('Project ID is missing');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const p = await getProject(projectId);
      setProject(p);
      setBaseBranch(p.branch_convention || 'main');

      const t = await getProjectTasks(projectId);
      setTasks(t);

      // Fetch repo branches
      try {
        const validation = await validateProjectPath(p.path);
        if (validation.branches && validation.branches.length > 0) {
          setAvailableBranches(validation.branches);
        } else {
          setAvailableBranches([p.branch_convention || 'main']);
        }
      } catch {}
    } catch (err: any) {
      setError(err?.message || 'Failed to load project');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [projectId]);

  const handleCreateTask = async () => {
    if (!taskName.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const newTask = await createTask(projectId, taskName.trim(), baseBranch || project?.branch_convention || 'main');
      setIsNewTaskOpen(false);
      setTaskName('');
      onSelectTask(newTask.id);
    } catch (err: any) {
      alert(`Error creating task: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteTask = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this task and clean up its git worktree?')) {
      await deleteTask(id);
      loadData();
    }
  };

  const handleOpenConfigModal = (mode: 'manual' | 'discover' = 'manual') => {
    setConfigModalMode(mode);
    setIsConfigModalOpen(true);
  };

  const handleConfigUpdated = (updatedProject: Project) => {
    setProject(updatedProject);
    setBaseBranch(updatedProject.branch_convention || 'main');
  };

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <p className="text-rose-400 text-sm mb-4">{error}</p>
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white transition-all shadow-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Projects</span>
        </button>
      </div>
    );
  }

  if (loading || !project) {
    return (
      <div className="flex-1 flex items-center justify-center text-cozy-muted text-sm">
        Loading project...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8 max-w-6xl mx-auto w-full">
      {/* Top Navigation */}
      <div className="mb-6 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-cozy-muted hover:text-cozy-text transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Projects</span>
        </button>

        <button
          onClick={() => setIsNewTaskOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white transition-all shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>Start New Task</span>
        </button>
      </div>

      {/* Project Overview Card */}
      <div className="p-6 rounded-2xl bg-cozy-surface border border-cozy-border mb-8 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0">
              <FolderGit2 className="w-6 h-6 text-sky-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-cozy-text truncate">{project.name}</h1>
              <p className="text-xs font-mono text-cozy-muted truncate" title={project.path}>
                {project.path}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleOpenConfigModal('discover')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 transition-all shadow-sm"
              title="Let AI agent inspect repository and update configuration"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Re-discover</span>
            </button>
            <button
              onClick={() => handleOpenConfigModal('manual')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-cozy-subtle hover:bg-cozy-border text-cozy-text border border-cozy-border transition-all shadow-sm"
              title="Manually edit project configuration"
            >
              <Sliders className="w-3.5 h-3.5 text-cozy-muted" />
              <span>Edit Config</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 pt-4 border-t border-cozy-border/60 text-xs">
          <div
            onClick={() => handleOpenConfigModal('manual')}
            className="p-3 rounded-xl bg-cozy-subtle border border-cozy-border hover:border-sky-500/40 cursor-pointer transition-all group relative"
            title="Click to edit Base Branch"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-cozy-muted text-[11px] block">Base Branch</span>
              <Pencil className="w-3 h-3 text-cozy-muted opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <span className="font-mono text-sky-400 font-semibold">{project.branch_convention || 'main'}</span>
          </div>

          <div
            onClick={() => handleOpenConfigModal('manual')}
            className="p-3 rounded-xl bg-cozy-subtle border border-cozy-border hover:border-emerald-500/40 cursor-pointer transition-all group relative"
            title="Click to edit Dev Command"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-cozy-muted text-[11px] block">Dev Command</span>
              <Pencil className="w-3 h-3 text-cozy-muted opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <span className="font-mono text-emerald-400 font-semibold truncate block" title={project.dev_cmd}>
              {project.dev_cmd}
            </span>
          </div>

          <div
            onClick={() => handleOpenConfigModal('manual')}
            className="p-3 rounded-xl bg-cozy-subtle border border-cozy-border hover:border-amber-500/40 cursor-pointer transition-all group relative"
            title="Click to edit Port"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-cozy-muted text-[11px] block">Port</span>
              <Pencil className="w-3 h-3 text-cozy-muted opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <span className="font-mono text-amber-400 font-semibold">:{project.dev_port}</span>
          </div>

          <div
            onClick={() => handleOpenConfigModal('manual')}
            className="p-3 rounded-xl bg-cozy-subtle border border-cozy-border hover:border-sky-500/40 cursor-pointer transition-all group relative"
            title="Click to edit Build Command"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-cozy-muted text-[11px] block">Build Command</span>
              <Pencil className="w-3 h-3 text-cozy-muted opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <span className="font-mono text-cozy-text font-semibold truncate block" title={project.build_cmd}>
              {project.build_cmd}
            </span>
          </div>

          <div
            onClick={() => handleOpenConfigModal('manual')}
            className="p-3 rounded-xl bg-cozy-subtle border border-cozy-border hover:border-sky-500/40 cursor-pointer transition-all group relative col-span-2 sm:col-span-1"
            title="Click to edit Test Command"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-cozy-muted text-[11px] block">Test Command</span>
              <Pencil className="w-3 h-3 text-cozy-muted opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <span className="font-mono text-cozy-text font-semibold truncate block" title={project.test_cmd || 'None'}>
              {project.test_cmd || 'npm test'}
            </span>
          </div>
        </div>
      </div>

      {/* Task List Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-cozy-text flex items-center gap-2">
          Ongoing & Completed Tasks
          <span className="px-2 py-0.5 rounded-full text-xs bg-cozy-subtle text-cozy-muted border border-cozy-border">
            {tasks.length}
          </span>
        </h2>
      </div>

      {/* Tasks Grid */}
      {tasks.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-dashed border-cozy-border bg-cozy-surface/40 flex flex-col items-center">
          <div className="w-12 h-12 rounded-2xl bg-cozy-subtle border border-cozy-border flex items-center justify-center mb-3">
            <GitBranch className="w-6 h-6 text-sky-400" />
          </div>
          <h3 className="text-sm font-semibold text-cozy-text mb-1">No tasks created yet</h3>
          <p className="text-xs text-cozy-muted max-w-sm mb-4">
            Start a task to create an isolated git worktree and branch. You can run multiple AI agents concurrently on it without affecting your main repo work.
          </p>
          <button
            onClick={() => setIsNewTaskOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create First Task</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => (
            <div
              key={t.id}
              onClick={() => onSelectTask(t.id)}
              className="group p-4 rounded-xl bg-cozy-surface border border-cozy-border hover:border-sky-500/40 hover:shadow-md transition-all cursor-pointer flex items-center justify-between"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0">
                  <GitBranch className="w-4 h-4 text-sky-400" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <h4 className="text-sm font-semibold text-cozy-text truncate group-hover:text-sky-400 transition-colors">
                      {t.name}
                    </h4>
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-sky-500/10 text-sky-400 border border-sky-500/20">
                      {t.branch}
                    </span>
                  </div>
                  <p className="text-xs text-cozy-muted font-mono truncate mt-0.5" title={t.worktree_path}>
                    Based on {t.base_branch} &bull; {t.worktree_path}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3 shrink-0">
                <span className="text-[11px] text-cozy-muted hidden sm:inline flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(t.created_at).toLocaleDateString()}
                </span>

                <button
                  onClick={(e) => handleDeleteTask(t.id, e)}
                  className="p-1.5 rounded-lg text-cozy-muted opacity-0 group-hover:opacity-100 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                  title="Delete task and worktree"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <div className="w-8 h-8 rounded-lg bg-cozy-subtle flex items-center justify-center text-cozy-muted group-hover:text-sky-400 group-hover:bg-sky-500/10 transition-colors">
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Task Modal */}
      {isNewTaskOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-cozy-surface border border-cozy-border rounded-2xl shadow-2xl p-6">
            <h3 className="text-base font-semibold text-cozy-text mb-1 flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-sky-400" />
              Start New Coding Task
            </h3>
            <p className="text-xs text-cozy-muted mb-4">
              Termai will create a new git worktree and branch out from your chosen base branch.
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-cozy-text block mb-1">Base Branch</label>
                <select
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  className="w-full bg-cozy-bg border border-cozy-border rounded-xl px-3 py-2 text-xs font-mono text-cozy-text focus:outline-none focus:border-sky-500"
                >
                  {availableBranches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-cozy-text block mb-1">Task Name / Feature Slug</label>
                <input
                  type="text"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="e.g. auth-flow, fix-search-bar"
                  className="w-full bg-cozy-bg border border-cozy-border rounded-xl px-3.5 py-2.5 text-xs text-cozy-text focus:outline-none focus:border-sky-500"
                  autoFocus
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end space-x-2">
              <button
                onClick={() => setIsNewTaskOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium bg-cozy-subtle hover:bg-cozy-subtle/80 text-cozy-text border border-cozy-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTask}
                disabled={isCreating || !taskName.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white transition-all shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isCreating ? 'Creating Worktree...' : 'Launch Task'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project Configuration Modal (Manual Edit + AI Re-discovery) */}
      {project && (
        <ProjectConfigModal
          project={project}
          isOpen={isConfigModalOpen}
          onClose={() => setIsConfigModalOpen(false)}
          onSuccess={handleConfigUpdated}
          settings={settings || null}
          ws={ws || null}
          initialMode={configModalMode}
          availableBranches={availableBranches}
        />
      )}
    </div>
  );
};
