import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { Task, Project, TaskGitStatus } from '../types';
import { getTasks, getActiveDevServers, getProjects, getProjectTasksGitStatus, getTaskChats } from '../api';
import { formatRelativeTime } from '../utils/time';
import { ProjectIcon } from './ProjectIcon';
import {
  getCachedUnreadReplyTaskIds,
  addUnreadReplyTaskId,
  removeUnreadReplyTaskId,
  getCachedTaskQueuedCount,
  getCachedQueuedMessages,
  getCachedProjects,
  setCachedProjects,
  getCachedAllTasks,
  setCachedAllTasks,
  getCachedChats,
  setCachedChats,
  setCachedMessages,
  setCachedTask,
} from '../cache';

interface ProjectsTasksSidebarProps {
  currentTaskId?: string;
  currentProjectId?: string;
  onSelectTask: (taskId: string, projectId?: string, task?: Task) => void;
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
  const [projects, setProjects] = useState<Project[]>(() => getCachedProjects() || []);
  const [tasks, setTasks] = useState<Task[]>(() => getCachedAllTasks() || []);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDevServerTaskIds, setActiveDevServerTaskIds] = useState<Set<string>>(new Set());
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set());

  // Task Git status and agent status for concise badges and indicator
  const [tasksGitStatus, setTasksGitStatus] = useState<Record<string, TaskGitStatus>>({});
  const [tasksAgentStatus, setTasksAgentStatus] = useState<Record<string, 'WIP' | 'idle'>>({});
  const [unreadTaskIds, setUnreadTaskIds] = useState<string[]>(() => getCachedUnreadReplyTaskIds());

  const tasksAgentStatusRef = useRef<Record<string, 'WIP' | 'idle'>>({});
  tasksAgentStatusRef.current = tasksAgentStatus;

  const currentTaskIdRef = useRef(currentTaskId);
  currentTaskIdRef.current = currentTaskId;

  const fetchGitStatuses = useCallback(async (taskList: Task[], force = false) => {
    const projectIds = Array.from(new Set(taskList.map((t) => t.project_id).filter(Boolean)));
    if (projectIds.length === 0) return;

    try {
      const results = await Promise.allSettled(
        projectIds.map((pId) => getProjectTasksGitStatus(pId, force))
      );
      const combined: Record<string, TaskGitStatus> = {};
      results.forEach((res) => {
        if (res.status === 'fulfilled' && res.value) {
          Object.assign(combined, res.value);
        }
      });
      setTasksGitStatus((prev) => ({ ...prev, ...combined }));
    } catch (err) {
      console.error('Failed to load git statuses for sidebar:', err);
    }
  }, []);

  // Handle agent replying status updates & unread completed reply notifications
  const handleTaskAgentStatus = useCallback(
    (data: { taskId?: string; sessionId?: string; agentStatus?: 'WIP' | 'idle' }) => {
      const { taskId, sessionId, agentStatus } = data;
      if (!taskId || !agentStatus) return;

      const prevStatus = tasksAgentStatusRef.current[taskId] || 'idle';
      setTasksAgentStatus((prev) => {
        const next = { ...prev, [taskId]: agentStatus };
        tasksAgentStatusRef.current = next;
        return next;
      });

      if (agentStatus === 'WIP') {
        removeUnreadReplyTaskId(taskId);
        setUnreadTaskIds((prev) => prev.filter((id) => id !== taskId));
      } else if (agentStatus === 'idle') {
        const wasReplying = prevStatus === 'WIP';
        const taskQueueCount = getCachedTaskQueuedCount(taskId);
        const sessionQueue = sessionId ? getCachedQueuedMessages(sessionId) : [];
        const hasQueue = taskQueueCount > 0 || sessionQueue.length > 0;

        if (wasReplying && !hasQueue) {
          const isCurrentActive = taskId === currentTaskIdRef.current;
          const isFocused = typeof document !== 'undefined' && document.hasFocus();

          if (isCurrentActive && isFocused) {
            removeUnreadReplyTaskId(taskId);
            setUnreadTaskIds((prev) => prev.filter((id) => id !== taskId));
          } else {
            addUnreadReplyTaskId(taskId);
            setUnreadTaskIds((prev) => (prev.includes(taskId) ? prev : [...prev, taskId]));
          }
        }
      }
    },
    []
  );

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
      setCachedAllTasks(tasksData);
      setCachedProjects(projectsData);

      const initialAgentStatus: Record<string, 'WIP' | 'idle'> = {};
      tasksData.forEach((t) => {
        setCachedTask(t);
        initialAgentStatus[t.id] = t.agent_status || 'idle';
      });
      setTasksAgentStatus((prev) => {
        const next = { ...initialAgentStatus, ...prev };
        tasksAgentStatusRef.current = next;
        return next;
      });

      fetchGitStatuses(tasksData);
    } catch (err) {
      console.error('Failed to load tasks and projects for sidebar:', err);
    } finally {
      setLoading(false);
    }
  };

  const hoverTimerRef = useRef<Record<string, any>>({});
  const prefetchedTaskIdsRef = useRef<Set<string>>(new Set());

  const handleTaskMouseEnter = useCallback((taskId: string) => {
    if (prefetchedTaskIdsRef.current.has(taskId)) return;
    if (getCachedChats(taskId)) {
      prefetchedTaskIdsRef.current.add(taskId);
      return;
    }

    if (hoverTimerRef.current[taskId]) {
      clearTimeout(hoverTimerRef.current[taskId]);
    }

    hoverTimerRef.current[taskId] = setTimeout(async () => {
      try {
        prefetchedTaskIdsRef.current.add(taskId);
        const chatsData = await getTaskChats(taskId, { includeMessages: true });
        if (Array.isArray(chatsData) && chatsData.length > 0) {
          setCachedChats(taskId, chatsData);
          const firstWithMsgs = chatsData.find((c) => Array.isArray(c.messages));
          if (firstWithMsgs && firstWithMsgs.messages) {
            setCachedMessages(firstWithMsgs.id, firstWithMsgs.messages);
          }
        }
      } catch {}
    }, 150);
  }, []);

  const handleTaskMouseLeave = useCallback((taskId: string) => {
    if (hoverTimerRef.current[taskId]) {
      clearTimeout(hoverTimerRef.current[taskId]);
      delete hoverTimerRef.current[taskId];
    }
  }, []);

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

  // Clear unread indicator when current task changes
  useEffect(() => {
    if (currentTaskId) {
      removeUnreadReplyTaskId(currentTaskId);
      setUnreadTaskIds((prev) => prev.filter((id) => id !== currentTaskId));
    }
  }, [currentTaskId]);

  // Window focus listener to refresh statuses and clear active task unread notification
  useEffect(() => {
    const handleFocus = () => {
      if (currentTaskIdRef.current) {
        removeUnreadReplyTaskId(currentTaskIdRef.current);
        setUnreadTaskIds((prev) => prev.filter((id) => id !== currentTaskIdRef.current));
      }
      if (tasks.length > 0) {
        fetchGitStatuses(tasks, false);
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [tasks, fetchGitStatuses]);

  // Listen for task and project update events
  useEffect(() => {
    const handleUpdate = () => {
      fetchData();
    };
    const handleStatusUpdate = () => {
      fetchData();
      if (tasks.length > 0) {
        fetchGitStatuses(tasks, true);
      }
    };
    window.addEventListener('task-updated', handleUpdate);
    window.addEventListener('task-status-updated', handleStatusUpdate);
    window.addEventListener('projects-updated', handleUpdate);
    return () => {
      window.removeEventListener('task-updated', handleUpdate);
      window.removeEventListener('task-status-updated', handleStatusUpdate);
      window.removeEventListener('projects-updated', handleUpdate);
    };
  }, [tasks, fetchGitStatuses]);

  // Listen for task agent status updates (custom event & unread notifications)
  useEffect(() => {
    const handleAgentStatusUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        handleTaskAgentStatus(detail);
      }
    };
    const handleUnreadUpdate = () => {
      setUnreadTaskIds(getCachedUnreadReplyTaskIds());
    };

    window.addEventListener('task-agent-status-updated', handleAgentStatusUpdate);
    window.addEventListener('unread-task-replies-updated', handleUnreadUpdate);

    return () => {
      window.removeEventListener('task-agent-status-updated', handleAgentStatusUpdate);
      window.removeEventListener('unread-task-replies-updated', handleUnreadUpdate);
    };
  }, [handleTaskAgentStatus]);

  // Listen for dev server state and agent status updates over WebSocket
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
        } else if (msg.type === 'task_agent_status') {
          handleTaskAgentStatus(msg);
        }
      } catch {}
    };

    ws.addEventListener('message', handleWs);
    return () => ws.removeEventListener('message', handleWs);
  }, [ws, handleTaskAgentStatus]);

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

  const renderConciseTaskStatusBadge = (t: Task, s?: TaskGitStatus) => {
    const isCompleted = t.status === 'completed';

    let gitBadge: React.ReactNode = null;
    if (s) {
      const totalChanges =
        (s.staged?.length || 0) +
        (s.unstaged?.length || 0) +
        (s.untracked?.length || 0);
      const hasLocal = Boolean(s.hasLocalChanges) || totalChanges > 0;
      const unpushed = s.unpushedCount || 0;
      const isMerged = Boolean(s.isMerged);
      const pr = s.pr;
      const isPrOpen = pr && pr.state === 'open';
      const canCreatePr =
        Boolean(s.createPrUrl) &&
        !isMerged &&
        !isPrOpen &&
        !hasLocal &&
        unpushed === 0 &&
        (s.aheadCount || 0) > 0;

      if (hasLocal) {
        gitBadge = (
          <span
            className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-medium bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/25 shrink-0"
            title={`${totalChanges} uncommitted local change${totalChanges === 1 ? '' : 's'}`}
          >
            +{totalChanges}
          </span>
        );
      } else if (unpushed > 0) {
        gitBadge = (
          <span
            className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/25 shrink-0"
            title={`${unpushed} unpushed commit${unpushed === 1 ? '' : 's'}`}
          >
            ↑{unpushed}
          </span>
        );
      } else if (isMerged) {
        gitBadge = (
          <span
            className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-medium bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/25 shrink-0"
            title="Merged into base branch"
          >
            merged
          </span>
        );
      } else if (isPrOpen) {
        gitBadge = (
          <span
            className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 shrink-0"
            title={`PR #${pr?.number || ''} open`}
          >
            PR{pr?.number ? ` #${pr.number}` : ''}
          </span>
        );
      } else if (canCreatePr) {
        gitBadge = (
          <span
            className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-medium bg-teal-500/15 text-teal-600 dark:text-teal-400 border border-teal-500/25 shrink-0"
            title="All changes pushed, ready to open PR"
          >
            ready
          </span>
        );
      } else {
        gitBadge = (
          <span
            className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-medium bg-cozy-subtle/80 text-cozy-muted/80 border border-cozy-border/40 shrink-0"
            title="Working tree clean"
          >
            clean
          </span>
        );
      }
    }

    if (!isCompleted && !gitBadge) return null;

    return (
      <div className="flex items-center gap-1 shrink-0">
        {isCompleted && (
          <span
            className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shrink-0"
            title="Task completed"
          >
            Done
          </span>
        )}
        {gitBadge}
      </div>
    );
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
                        const agentStatus = tasksAgentStatus[task.id] || task.agent_status || 'idle';
                        const isReplying = agentStatus === 'WIP';
                        const hasUnreadReply = !isReplying && unreadTaskIds.includes(task.id);
                        const gitStatus = tasksGitStatus[task.id];

                        return (
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => onSelectTask(task.id, task.project_id, task)}
                            onMouseEnter={() => handleTaskMouseEnter(task.id)}
                            onMouseLeave={() => handleTaskMouseLeave(task.id)}
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

                              <div className="flex items-center gap-1.5 text-[10px] text-cozy-muted/70 mt-0.5 overflow-hidden">
                                {task.branch && (
                                  <span className="flex items-center gap-0.5 font-mono text-[10px] text-cozy-muted/80 max-w-[85px] truncate shrink-0">
                                    <GitBranch className="w-2.5 h-2.5 text-teal-500/70 shrink-0" />
                                    <span className="truncate">{task.branch}</span>
                                  </span>
                                )}
                                {renderConciseTaskStatusBadge(task, gitStatus)}
                                {(task.updated_at || task.created_at) && (
                                  <span className="text-cozy-muted/50 shrink-0 truncate">
                                    • {formatRelativeTime(task.updated_at || task.created_at)}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="shrink-0 flex items-center justify-center pl-1">
                              {isReplying ? (
                                <span title="Agent is replying..." className="inline-flex items-center justify-center">
                                  <Loader2 className="w-3.5 h-3.5 text-teal-500 animate-spin" />
                                </span>
                              ) : hasUnreadReply ? (
                                <span
                                  className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)] animate-pulse"
                                  title="Agent finished replying"
                                />
                              ) : isActive ? (
                                <Check className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                              ) : null}
                            </div>
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
