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
import { setCachedTask } from '../cache';
import { ProjectConfigModal } from '../components/ProjectConfigModal';
import { EditTaskModal } from '../components/EditTaskModal';

interface ProjectPageProps {
  projectId?: string;
  onBack?: () => void;
  onSelectTask?: (taskId: string, task?: Task) => void;
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
  const onSelectTask =
    propOnSelectTask ||
    ((taskId: string, selectedTask?: Task) =>
      navigate(`/projects/${projectId}/tasks/${taskId}`, { state: { task: selectedTask } }));

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
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

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
      t.forEach((taskItem) => setCachedTask(taskItem));

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
      setCachedTask(newTask);
      setIsNewTaskOpen(false);
      setTaskName('');
      onSelectTask(newTask.id, newTask);
    } catch (err: any) {
      alert(`Error creating task: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenEditTask = (taskToEdit: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTask(taskToEdit);
    setIsEditModalOpen(true);
  };

  const handleTaskUpdated = (updatedTask: Task) => {
    setCachedTask(updatedTask);
    setTasks((prev) => prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)));
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
        <p className="text-red-500 text-sm mb-4">{error}</p>
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white transition-all shadow-sm"
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
    <div className="flex-1 overflow-y-auto p-6 sm:p-8 md:p-10 max-w-6xl mx-auto w-full">
      {/* Top Navigation */}
      <div className="mb-6 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cozy-subtle/80 hover:bg-cozy-subtle border border-cozy-border/70 hover:border-teal-400/40 text-xs font-medium text-cozy-muted hover:text-cozy-text shadow-soft-sm transition-all"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Projects</span>
        </button>

        <button
          onClick={() => setIsNewTaskOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white transition-all shadow-glow-ocean cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Start New Task</span>
        </button>
      </div>

      {/* Project Overview Card */}
      <div className="p-6 sm:p-7 rounded-squircle glass-card border border-white/80 dark:border-white/10 mb-8 shadow-soft">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-teal-500/20 via-cyan-500/15 to-sky-500/20 border border-teal-400/30 flex items-center justify-center text-teal-600 dark:text-teal-400 shadow-soft-sm shrink-0">
              <FolderGit2 className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-cozy-text truncate">{project.name}</h1>
              <p className="text-xs font-mono text-cozy-muted truncate mt-0.5" title={project.path}>
                {project.path}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleOpenConfigModal('discover')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-teal-500/10 hover:bg-teal-500/20 text-teal-600 dark:text-teal-400 border border-teal-400/30 transition-all shadow-soft-sm cursor-pointer"
              title="Let AI agent inspect repository and update configuration"
            >
              <Sparkles className="w-3.5 h-3.5 text-teal-500" />
              <span>AI Re-discover</span>
            </button>
            <button
              onClick={() => handleOpenConfigModal('manual')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-cozy-subtle hover:bg-cozy-surface text-cozy-text border border-cozy-border/80 transition-all shadow-soft-sm cursor-pointer"
              title="Manually edit project configuration"
            >
              <Sliders className="w-3.5 h-3.5 text-cozy-muted" />
              <span>Edit Config</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 pt-5 border-t border-cozy-border/50 text-xs">
          <div
            onClick={() => handleOpenConfigModal('manual')}
            className="p-3.5 rounded-2xl bg-cozy-subtle/80 border border-cozy-border/70 hover:border-teal-400/40 cursor-pointer transition-all group relative shadow-soft-sm"
            title="Click to edit Base Branch"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-cozy-muted text-[11px] block font-medium">Base Branch</span>
              <Pencil className="w-3 h-3 text-cozy-muted opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">{project.branch_convention || 'main'}</span>
          </div>

          <div
            onClick={() => handleOpenConfigModal('manual')}
            className="p-3.5 rounded-2xl bg-cozy-subtle/80 border border-cozy-border/70 hover:border-teal-400/40 cursor-pointer transition-all group relative shadow-soft-sm"
            title="Click to edit Dev Command"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-cozy-muted text-[11px] block font-medium">Dev Command</span>
              <Pencil className="w-3 h-3 text-cozy-muted opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <span className="font-mono text-emerald-500 font-semibold truncate block" title={project.dev_cmd}>
              {project.dev_cmd}
            </span>
          </div>

          <div
            onClick={() => handleOpenConfigModal('manual')}
            className="p-3.5 rounded-2xl bg-cozy-subtle/80 border border-cozy-border/70 hover:border-teal-400/40 cursor-pointer transition-all group relative shadow-soft-sm"
            title="Click to edit Port"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-cozy-muted text-[11px] block font-medium">Port</span>
              <Pencil className="w-3 h-3 text-cozy-muted opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <span className="font-mono text-amber-500 font-semibold">:{project.dev_port}</span>
          </div>

          <div
            onClick={() => handleOpenConfigModal('manual')}
            className="p-3.5 rounded-2xl bg-cozy-subtle/80 border border-cozy-border/70 hover:border-teal-400/40 cursor-pointer transition-all group relative shadow-soft-sm"
            title="Click to edit Build Command"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-cozy-muted text-[11px] block font-medium">Build Command</span>
              <Pencil className="w-3 h-3 text-cozy-muted opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <span className="font-mono text-cozy-text font-semibold truncate block" title={project.build_cmd}>
              {project.build_cmd}
            </span>
          </div>

          <div
            onClick={() => handleOpenConfigModal('manual')}
            className="p-3.5 rounded-2xl bg-cozy-subtle/80 border border-cozy-border/70 hover:border-teal-400/40 cursor-pointer transition-all group relative col-span-2 sm:col-span-1 shadow-soft-sm"
            title="Click to edit Test Command"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-cozy-muted text-[11px] block font-medium">Test Command</span>
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
        <h2 className="text-base font-bold text-cozy-text flex items-center gap-2.5">
          Ongoing & Completed Tasks
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cozy-subtle text-cozy-muted border border-cozy-border/70 shadow-soft-sm">
            {tasks.length}
          </span>
        </h2>
      </div>

      {/* Tasks Grid */}
      {tasks.length === 0 ? (
        <div className="p-12 text-center rounded-squircle border border-dashed border-cozy-border/80 glass-panel shadow-soft flex flex-col items-center">
          <div className="w-14 h-14 rounded-2.5xl bg-gradient-to-tr from-teal-500/15 via-cyan-500/10 to-sky-500/15 border border-teal-400/25 flex items-center justify-center mb-3.5 shadow-soft-sm">
            <GitBranch className="w-6 h-6 text-teal-500" />
          </div>
          <h3 className="text-base font-semibold text-cozy-text mb-1">No tasks created yet</h3>
          <p className="text-xs text-cozy-muted max-w-sm mb-5 leading-relaxed">
            Start a task to create an isolated git worktree and branch. You can run multiple AI agents concurrently on it without affecting your main repo work.
          </p>
          <button
            onClick={() => setIsNewTaskOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white transition-all shadow-glow-ocean"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create First Task</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3.5">
          {tasks.map((t) => (
            <div
              key={t.id}
              onClick={() => onSelectTask(t.id, t)}
              className="group p-5 rounded-2.5xl glass-card border border-white/80 dark:border-white/10 hover:border-teal-400/40 hover:shadow-soft-md hover:-translate-y-0.5 transition-all cursor-pointer flex items-center justify-between"
            >
              <div className="flex items-center space-x-3.5 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-teal-500/15 to-cyan-500/15 border border-teal-400/30 flex items-center justify-center shrink-0 shadow-soft-sm">
                  <GitBranch className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center space-x-2.5">
                    <h4 className="text-sm font-semibold text-cozy-text truncate group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
                      {t.name}
                    </h4>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-400/20 font-medium">
                      {t.branch}
                    </span>
                  </div>
                  <p className="text-xs text-cozy-muted font-mono truncate mt-1" title={t.worktree_path}>
                    Based on {t.base_branch} &bull; {t.worktree_path}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                <span className="text-[11px] text-cozy-muted hidden sm:inline flex items-center gap-1.5 mr-1 font-medium">
                  <Clock className="w-3 h-3" />
                  {new Date(t.created_at).toLocaleDateString()}
                </span>

                <button
                  onClick={(e) => handleOpenEditTask(t, e)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-cozy-muted opacity-0 group-hover:opacity-100 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-cozy-subtle transition-all"
                  title="Edit task name and base branch"
                >
                  <Pencil className="w-4 h-4" />
                </button>

                <button
                  onClick={(e) => handleDeleteTask(t.id, e)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-cozy-muted opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-500/10 transition-all"
                  title="Delete task and worktree"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <div className="w-8 h-8 rounded-full bg-cozy-subtle flex items-center justify-center text-cozy-muted group-hover:text-teal-600 dark:group-hover:text-teal-400 group-hover:bg-teal-500/10 transition-all">
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Task Modal */}
      {isNewTaskOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-squircle glass-panel border border-white/80 dark:border-white/10 shadow-soft-xl p-6 sm:p-7">
            <h3 className="text-base font-bold text-cozy-text mb-1 flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              Start New Coding Task
            </h3>
            <p className="text-xs text-cozy-muted mb-5 leading-relaxed">
              Raft will create a new git worktree and branch out from your chosen base branch.
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-cozy-text block mb-1.5">Base Branch</label>
                <select
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  className="w-full bg-cozy-surface/90 border border-cozy-border/80 rounded-2xl px-3.5 py-2.5 text-xs font-mono text-cozy-text focus:outline-none focus:border-teal-400"
                >
                  {availableBranches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-cozy-text block mb-1.5">Task Name / Feature Slug</label>
                <input
                  type="text"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="e.g. auth-flow, fix-search-bar"
                  className="w-full bg-cozy-surface/90 border border-cozy-border/80 rounded-2xl px-4 py-2.5 text-xs text-cozy-text focus:outline-none focus:border-teal-400"
                  autoFocus
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end space-x-2.5">
              <button
                onClick={() => setIsNewTaskOpen(false)}
                className="px-4 py-2 rounded-full text-xs font-medium bg-cozy-subtle hover:bg-cozy-surface text-cozy-text border border-cozy-border transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTask}
                disabled={isCreating || !taskName.trim()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white transition-all shadow-glow-ocean cursor-pointer"
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

      {/* Edit Task Modal */}
      {editingTask && (
        <EditTaskModal
          task={editingTask}
          isOpen={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setEditingTask(null);
          }}
          onSuccess={handleTaskUpdated}
          availableBranches={availableBranches}
          projectPath={project.path}
        />
      )}
    </div>
  );
};
