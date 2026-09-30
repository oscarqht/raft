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
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Task, Project } from '../types';
import { getTasks, getActiveDevServers, getProjects } from '../api';
import { formatRelativeTime } from '../utils/time';
import { ProjectIcon } from './ProjectIcon';

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
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDevServerTaskIds, setActiveDevServerTaskIds] = useState<Set<string>>(new Set());
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set());

  // Load all tasks and projects
  const fetchData = async () => {
    try {
      if (tasks.length === 0 && projects.length === 0) {
        setLoading(true);
      }
      const [tasksData, projectsData] = await Promise.all([
        getTasks(),
        getProjects().catch((err) => {
          console.error('Failed to load projects for sidebar:', err);
          return [] as Project[];
        }),
      ]);
      setTasks(tasksData);
      setProjects(projectsData);
    } catch (err) {
      console.error('Failed to load tasks and projects for sidebar:', err);
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
    fetchData();
    fetchActiveDevServers();
  }, []);

  // Listen for task and project update events
  useEffect(() => {
    const handleUpdate = () => {
      fetchData();
    };
    window.addEventListener('task-updated', handleUpdate);
    window.addEventListener('task-status-updated', handleUpdate);
    window.addEventListener('projects-updated', handleUpdate);
    return () => {
      window.removeEventListener('task-updated', handleUpdate);
      window.removeEventListener('task-status-updated', handleUpdate);
      window.removeEventListener('projects-updated', handleUpdate);
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

  // Ensure project containing the active task is expanded if active task is beyond top 10
  useEffect(() => {
    if (!currentTaskId || tasks.length === 0) return;
    const currentTask = tasks.find((t) => t.id === currentTaskId);
    if (!currentTask || !currentTask.project_id) return;

    const projTasks = tasks
      .filter((t) => t.project_id === currentTask.project_id)
      .sort(
        (a, b) =>
          (b.updated_at || b.created_at || 0) - (a.updated_at || a.created_at || 0)
      );

    const taskIndex = projTasks.findIndex((t) => t.id === currentTaskId);
    if (taskIndex >= 10) {
      setExpandedProjectIds((prev) => {
        const next = new Set(prev);
        next.add(currentTask.project_id);
        return next;
      });
    }
  }, [currentTaskId, tasks]);

  // Group tasks by project and sort
  const groupedProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const map = new Map<
      string,
      { projectName: string; projectIcon?: string; projectUpdatedAt: number; tasks: Task[] }
    >();

    // Seed all known projects so empty projects are included
    for (const project of projects) {
      map.set(project.id, {
        projectName: project.name,
        projectIcon: project.icon,
        projectUpdatedAt: project.updated_at || project.created_at || 0,
        tasks: [],
      });
    }

    for (const task of tasks) {
      const pId = task.project_id || 'unknown';
      const pName = task.project?.name || (task.project_id ? 'Untitled Project' : 'Other Tasks');
      const pIcon = task.project?.icon;

      if (query) {
        const matchTask =
          task.name.toLowerCase().includes(query) ||
          (task.branch && task.branch.toLowerCase().includes(query));
        const matchProject = pName.toLowerCase().includes(query);
        if (!matchTask && !matchProject) {
          continue;
        }
      }

      if (!map.has(pId)) {
        map.set(pId, { projectName: pName, projectIcon: pIcon, projectUpdatedAt: 0, tasks: [] });
      }
      map.get(pId)!.tasks.push(task);
    }

    const groups: ProjectGroup[] = [];
    for (const [projectId, data] of map.entries()) {
      if (query && data.tasks.length === 0 && !data.projectName.toLowerCase().includes(query)) {
        continue;
      }

      const sortedTasks = [...data.tasks].sort(
        (a, b) => (b.updated_at || b.created_at || 0) - (a.updated_at || a.created_at || 0)
      );

      const latestUpdatedAt = Math.max(
        ...sortedTasks.map((t) => t.updated_at || t.created_at || 0),
        data.projectUpdatedAt || 0
      );

      groups.push({
        projectId,
        projectName: data.projectName,
        projectIcon: data.projectIcon,
        latestUpdatedAt,
        tasks: sortedTasks,
      });
    }

    // Sort: current project at top, then by latest activity descending
    groups.sort((a, b) => {
      if (currentProjectId) {
        if (a.projectId === currentProjectId) return -1;
        if (b.projectId === currentProjectId) return 1;
      }
      return b.latestUpdatedAt - a.latestUpdatedAt;
    });

    return groups;
  }, [projects, tasks, searchQuery, currentProjectId]);

  const toggleProjectExpand = (projectId: string) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

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
      className={`h-full shrink-0 flex flex-col transition-all duration-200 ease-in-out select-none overflow-hidden ${
        isCollapsed
          ? 'w-0 opacity-0 pointer-events-none'
          : 'w-64 border-r border-cozy-border bg-cozy-subtle/30 dark:bg-[#171717]'
      }`}
    >
      <div className="w-64 h-full flex flex-col overflow-hidden">
        {/* Sidebar Header */}
        <div className="h-11 px-3 border-b border-cozy-border flex items-center justify-between shrink-0 bg-transparent">
          <div className="flex items-center gap-2 text-xs font-semibold text-cozy-text min-w-0">
            <span className="truncate">Projects & Tasks</span>
            {!loading && (
              <span className="text-[10px] font-medium text-cozy-muted bg-cozy-subtle px-1.5 py-0.2 rounded-full border border-cozy-border/60 shrink-0">
                {tasks.length}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onToggleCollapse}
            className="w-6 h-6 rounded-md text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle flex items-center justify-center transition-colors cursor-pointer"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Search Input */}
        <div className="px-2.5 py-2 shrink-0 border-b border-cozy-border/40">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-cozy-muted absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks..."
              className="w-full pl-8 pr-7 py-1 text-xs bg-cozy-surface dark:bg-[#212121] border border-cozy-border rounded-lg text-cozy-text placeholder:text-cozy-muted outline-none focus:border-teal-500/60 transition-colors"
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
        <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-2 space-y-3">
          {loading && tasks.length === 0 && projects.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-xs text-cozy-muted gap-2">
              <Loader2 className="w-5 h-5 text-teal-500 animate-spin" />
              <span>Loading workspace tasks...</span>
            </div>
          ) : groupedProjects.length === 0 ? (
            <div className="py-12 px-3 text-center text-xs text-cozy-muted flex flex-col items-center justify-center gap-2">
              <ListTodo className="w-8 h-8 opacity-25" />
              <span>{searchQuery ? 'No matching tasks' : 'No projects or tasks yet'}</span>
            </div>
          ) : (
            groupedProjects.map((group) => {
              const isExpanded = expandedProjectIds.has(group.projectId);
              const isSearching = searchQuery.trim().length > 0;
              const visibleTasks = isSearching || isExpanded ? group.tasks : group.tasks.slice(0, 10);
              const hasMoreTasks = !isSearching && group.tasks.length > 10;
              const remainingCount = group.tasks.length - 10;

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
                      <ProjectIcon icon={group.projectIcon} className="w-3.5 h-3.5 shrink-0" />
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

                  {/* Tasks List or Empty State */}
                  {group.tasks.length === 0 ? (
                    <div className="pl-2 pr-1 py-1">
                      <button
                        type="button"
                        onClick={(e) => handleCreateTaskInProject(e, group.projectId)}
                        className="w-full px-2 py-1.5 rounded-lg border border-dashed border-cozy-border/60 hover:border-teal-500/50 hover:bg-teal-500/5 text-left text-[11px] text-cozy-muted hover:text-teal-600 dark:hover:text-teal-400 flex items-center gap-1.5 transition-colors cursor-pointer group/empty"
                      >
                        <Plus className="w-3 h-3 text-cozy-muted group-hover/empty:text-teal-500 transition-colors" />
                        <span>Create first task</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1 pl-1">
                      {visibleTasks.map((task) => {
                        const isActive = task.id === currentTaskId;
                        const hasActiveDevServer = activeDevServerTaskIds.has(task.id);

                        return (
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => onSelectTask(task.id, task.project_id)}
                            className={`w-full px-2 py-1.5 rounded-lg flex items-center justify-between gap-2 text-left transition-colors cursor-pointer group ${
                              isActive
                                ? 'bg-cozy-surface dark:bg-[#242424] text-cozy-text font-medium border border-cozy-border'
                                : 'hover:bg-cozy-subtle dark:hover:bg-[#212121] text-cozy-muted hover:text-cozy-text border border-transparent'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`text-xs truncate font-medium ${
                                    isActive
                                      ? 'text-cozy-text'
                                      : 'text-cozy-muted group-hover:text-cozy-text'
                                  }`}
                                >
                                  {task.name}
                                </span>

                                {hasActiveDevServer && (
                                  <span
                                    className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"
                                    title="Dev server running in background"
                                  />
                                )}
                              </div>

                              <div className="flex items-center gap-2 text-[10px] text-cozy-muted/70 mt-0.5">
                                {task.branch && (
                                  <span className="flex items-center gap-1 font-mono text-[10px] text-cozy-muted/80 max-w-[110px] truncate">
                                    <GitBranch className="w-2.5 h-2.5 text-teal-500/70 shrink-0" />
                                    <span className="truncate">{task.branch}</span>
                                  </span>
                                )}
                                {(task.updated_at || task.created_at) && (
                                  <span className="text-cozy-muted/50 shrink-0">
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

                      {/* Expand / Collapse Button */}
                      {hasMoreTasks && (
                        <button
                          type="button"
                          onClick={() => toggleProjectExpand(group.projectId)}
                          className="w-full mt-1 px-2 py-1.5 rounded-md text-[11px] text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle dark:hover:bg-[#212121] flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-medium"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp className="w-3 h-3 text-cozy-muted" />
                              <span>Show less</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3 h-3 text-cozy-muted" />
                              <span>Show all ({remainingCount} more)</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
};
