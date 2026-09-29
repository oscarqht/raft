import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderGit2,
  GitBranch,
  Plus,
  Search,
  PanelLeftClose,
  Check,
  Loader2,
  ListTodo,
  Layers,
  X,
} from 'lucide-react';
import { Task } from '../types';
import { getTasks, getActiveDevServers } from '../api';
import { formatRelativeTime } from '../utils/time';

interface ProjectsTasksSidebarProps {
  currentTaskId?: string;
  currentProjectId?: string;
  onSelectTask: (taskId: string, projectId?: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  ws: WebSocket | null;
}

interface ProjectGroup {
  projectId: string;
  projectName: string;
  projectIcon?: string;
  latestUpdatedAt: number;
  tasks: Task[];
}

export const ProjectsTasksSidebar: React.FC<ProjectsTasksSidebarProps> = ({
  currentTaskId,
  currentProjectId,
  onSelectTask,
  isCollapsed,
  onToggleCollapse,
  ws,
}) => {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDevServerTaskIds, setActiveDevServerTaskIds] = useState<Set<string>>(new Set());

  // Load tasks
  const fetchTasks = async () => {
    try {
      if (tasks.length === 0) {
        setLoading(true);
      }
      const data = await getTasks();
      setTasks(data);
    } catch (err) {
      console.error('Failed to load tasks for sidebar:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load active dev servers
  const fetchActiveDevServers = async () => {
    try {
      const activeIds = await getActiveDevServers();
      setActiveDevServerTaskIds(new Set(activeIds));
    } catch (err) {
      console.error('Failed to load active dev servers:', err);
    }
  };

  useEffect(() => {
    fetchTasks();
    fetchActiveDevServers();
  }, []);

  // Listen for task update events
  useEffect(() => {
    const handleTaskUpdated = () => {
      fetchTasks();
    };
    window.addEventListener('task-updated', handleTaskUpdated);
    window.addEventListener('task-status-updated', handleTaskUpdated);
    return () => {
      window.removeEventListener('task-updated', handleTaskUpdated);
      window.removeEventListener('task-status-updated', handleTaskUpdated);
    };
  }, []);

  // Listen for dev server state updates over WebSocket
  useEffect(() => {
    if (!ws) return;

    const handleWs = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'dev_server_state_update' && msg.taskId) {
          const isRunning = msg.status === 'running' || msg.status === 'starting';
          setActiveDevServerTaskIds((prev) => {
            const next = new Set(prev);
            if (isRunning) {
              next.add(msg.taskId);
            } else {
              next.delete(msg.taskId);
            }
            return next;
          });
        } else if (msg.type === 'dev_server_state' && msg.state?.taskId) {
          const isRunning = msg.state.status === 'running' || msg.state.status === 'starting';
          setActiveDevServerTaskIds((prev) => {
            const next = new Set(prev);
            if (isRunning) {
              next.add(msg.state.taskId);
            } else {
              next.delete(msg.state.taskId);
            }
            return next;
          });
        }
      } catch {}
    };

    ws.addEventListener('message', handleWs);
    return () => ws.removeEventListener('message', handleWs);
  }, [ws]);

  // Group tasks by project and sort
  const groupedProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const map = new Map<string, { projectName: string; projectIcon?: string; tasks: Task[] }>();

    for (const task of tasks) {
      const pId = task.project_id || 'unknown';
      const pName = task.project?.name || 'Other Tasks';
      const pIcon = task.project?.icon;

      if (query) {
        const matchTask = task.name.toLowerCase().includes(query) || (task.branch && task.branch.toLowerCase().includes(query));
        const matchProject = pName.toLowerCase().includes(query);
        if (!matchTask && !matchProject) {
          continue;
        }
      }

      if (!map.has(pId)) {
        map.set(pId, { projectName: pName, projectIcon: pIcon, tasks: [] });
      }
      map.get(pId)!.tasks.push(task);
    }

    const groups: ProjectGroup[] = [];
    for (const [projectId, data] of map.entries()) {
      const sortedTasks = [...data.tasks].sort(
        (a, b) => (b.updated_at || b.created_at || 0) - (a.updated_at || a.created_at || 0)
      );

      const latestUpdatedAt = Math.max(
        ...sortedTasks.map((t) => t.updated_at || t.created_at || 0),
        0
      );

      groups.push({
        projectId,
        projectName: data.projectName,
        projectIcon: data.projectIcon,
        latestUpdatedAt,
        tasks: sortedTasks,
      });
    }

    // Sort project groups by latest task activity descending
    groups.sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);

    return groups;
  }, [tasks, searchQuery]);

  const handleCreateTaskInProject = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    navigate(`/projects/${projectId}`);
    // Small delay to allow navigation to project page before triggering new task modal
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('open-new-task'));
    }, 120);
  };

  return (
    <aside
      aria-label="Projects and Tasks Sidebar"
      className={`h-full shrink-0 flex flex-col transition-all duration-300 ease-in-out select-none overflow-hidden ${
        isCollapsed
          ? 'w-0 opacity-0 pointer-events-none p-0 border-transparent shadow-none'
          : 'w-64 sm:w-72 p-0 min-[1200px]:mr-3'
      }`}
    >
      <div className="w-64 sm:w-72 h-full flex flex-col rounded-squircle glass-panel border border-white/80 dark:border-white/10 shadow-soft-md overflow-hidden bg-cozy-surface/80">
        {/* Sidebar Header */}
        <div className="px-3.5 py-3 border-b border-cozy-border/60 flex items-center justify-between shrink-0 bg-cozy-surface/50">
          <div className="flex items-center gap-2 text-xs font-semibold text-cozy-text min-w-0">
            <div className="w-6 h-6 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
              <Layers className="w-3.5 h-3.5" />
            </div>
            <span className="truncate">Projects & Tasks</span>
            {!loading && (
              <span className="text-[10px] font-medium text-cozy-muted bg-cozy-subtle px-1.5 py-0.5 rounded-full border border-cozy-border/40 shrink-0">
                {tasks.length}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onToggleCollapse}
            className="w-7 h-7 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle/80 flex items-center justify-center transition-all cursor-pointer"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* Search Input */}
        <div className="px-3 pt-2.5 pb-2 shrink-0">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-cozy-muted/70 absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter tasks..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-cozy-subtle/60 hover:bg-cozy-subtle focus:bg-cozy-surface border border-cozy-border/60 focus:border-teal-500/50 rounded-xl text-cozy-text placeholder:text-cozy-muted/60 outline-none transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 p-0.5 text-cozy-muted hover:text-cozy-text rounded transition-colors"
                title="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Grouped Projects & Tasks List */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-2.5 pb-3 space-y-3">
          {loading && tasks.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-xs text-cozy-muted gap-2">
              <Loader2 className="w-5 h-5 text-teal-500 animate-spin" />
              <span>Loading workspace tasks...</span>
            </div>
          ) : groupedProjects.length === 0 ? (
            <div className="py-12 px-3 text-center text-xs text-cozy-muted flex flex-col items-center justify-center gap-2">
              <ListTodo className="w-8 h-8 opacity-25" />
              <span>{searchQuery ? 'No matching tasks' : 'No tasks created yet'}</span>
            </div>
          ) : (
            groupedProjects.map((group) => {
              const isCurrentProject = group.projectId === currentProjectId;

              return (
                <div key={group.projectId} className="flex flex-col space-y-1">
                  {/* Project Section Header */}
                  <div className="flex items-center justify-between px-2 py-1 rounded-lg group/project text-[11px] font-semibold text-cozy-muted">
                    <button
                      type="button"
                      onClick={() => navigate(`/projects/${group.projectId}`)}
                      className="flex items-center gap-1.5 min-w-0 flex-1 text-left hover:text-cozy-text transition-colors cursor-pointer"
                      title={`Go to project: ${group.projectName}`}
                    >
                      {group.projectIcon ? (
                        <span className="text-xs shrink-0 leading-none">{group.projectIcon}</span>
                      ) : (
                        <FolderGit2 className="w-3.5 h-3.5 text-teal-500/80 shrink-0" />
                      )}
                      <span className="truncate font-semibold text-cozy-text/90 group-hover/project:text-teal-600 dark:group-hover/project:text-teal-400">
                        {group.projectName}
                      </span>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] font-normal text-cozy-muted px-1.5 py-0.2 rounded-full bg-cozy-subtle/80 border border-cozy-border/40">
                        {group.tasks.length}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => handleCreateTaskInProject(e, group.projectId)}
                        className="w-5 h-5 rounded-md text-cozy-muted hover:text-teal-600 dark:hover:text-teal-400 hover:bg-teal-500/10 flex items-center justify-center transition-all opacity-0 group-hover/project:opacity-100"
                        title="New task in this project"
                        aria-label="New task in this project"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Tasks List */}
                  <div className="space-y-1 pl-1">
                    {group.tasks.map((task) => {
                      const isActive = task.id === currentTaskId;
                      const hasActiveDevServer = activeDevServerTaskIds.has(task.id);

                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => onSelectTask(task.id, task.project_id)}
                          className={`w-full px-2.5 py-2 rounded-xl flex items-center justify-between gap-2 text-left transition-all cursor-pointer group ${
                            isActive
                              ? 'bg-teal-500/12 text-teal-700 dark:text-teal-300 font-medium shadow-soft-sm border border-teal-500/30'
                              : 'hover:bg-cozy-subtle/70 text-cozy-text border border-transparent'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-xs truncate font-medium ${
                                  isActive
                                    ? 'text-teal-600 dark:text-teal-400'
                                    : 'text-cozy-text group-hover:text-teal-600 dark:group-hover:text-teal-400'
                                }`}
                              >
                                {task.name}
                              </span>

                              {hasActiveDevServer && (
                                <span
                                  className="w-2 h-2 rounded-full bg-emerald-400 shadow-glow-mint shrink-0"
                                  title="Dev server running in background"
                                />
                              )}
                            </div>

                            <div className="flex items-center gap-2 text-[10px] text-cozy-muted mt-0.5">
                              {task.branch && (
                                <span className="flex items-center gap-1 font-mono text-[10px] text-cozy-muted/80 max-w-[110px] truncate">
                                  <GitBranch className="w-2.5 h-2.5 text-teal-500/70 shrink-0" />
                                  <span className="truncate">{task.branch}</span>
                                </span>
                              )}
                              {(task.updated_at || task.created_at) && (
                                <span className="text-cozy-muted/60 shrink-0">
                                  • {formatRelativeTime(task.updated_at || task.created_at)}
                                </span>
                              )}
                            </div>
                          </div>

                          {isActive && (
                            <Check className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
};
