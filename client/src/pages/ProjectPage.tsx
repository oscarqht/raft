import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Plus,
  ArrowLeft,
  GitBranch,
  Trash2,
  ArrowRight,
  Clock,
  Pencil,
} from 'lucide-react';
import { Project, Task, Settings } from '../types';
import { getProject, getProjectTasks, createTask, deleteTask, validateProjectPath } from '../api';
import { setCachedTask } from '../cache';
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
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  useEffect(() => {
    const handleOpenNewTask = () => setIsNewTaskOpen(true);
    window.addEventListener('open-new-task', handleOpenNewTask);
    return () => window.removeEventListener('open-new-task', handleOpenNewTask);
  }, []);

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
              <div className="flex items-center space-x-3.5 min-w-0 pr-4">
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
                <div className="flex items-center gap-1.5 text-[11px] text-cozy-muted font-medium whitespace-nowrap shrink-0 mr-1">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>{new Date(t.created_at).toLocaleDateString()}</span>
                </div>

                <button
                  type="button"
                  onClick={(e) => handleOpenEditTask(t, e)}
                  className="w-8 h-8 rounded-full bg-cozy-subtle/80 hover:bg-cozy-subtle flex items-center justify-center text-cozy-muted hover:text-teal-600 dark:hover:text-teal-400 transition-all cursor-pointer shadow-soft-sm"
                  title="Edit task name and base branch"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={(e) => handleDeleteTask(t.id, e)}
                  className="w-8 h-8 rounded-full bg-cozy-subtle/80 hover:bg-red-500/15 flex items-center justify-center text-cozy-muted hover:text-red-500 transition-all cursor-pointer shadow-soft-sm"
                  title="Delete task and worktree"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTask(t.id, t);
                  }}
                  className="w-8 h-8 rounded-full bg-cozy-subtle/80 hover:bg-teal-500/15 flex items-center justify-center text-cozy-muted hover:text-teal-600 dark:hover:text-teal-400 transition-all cursor-pointer shadow-soft-sm"
                  title="Go to task page"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
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
