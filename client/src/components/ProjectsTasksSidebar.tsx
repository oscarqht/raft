import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderGit2,
  GitBranch,
  Plus,
  Search,
  PanelLeftClose,
  Loader2,
  ListTodo,
  Layers,
  X,
  ChevronDown,
  ChevronUp,
  Pin,
  Sliders,
  Trash2,
} from 'lucide-react';
import { Task, Project, TaskGitStatus } from '../types';
import { getTasks, getActiveDevServers, getProjects, getProjectTasksGitStatus, getTaskChats, updateTask, deleteTask } from '../api';
import { formatShortRelativeTime } from '../utils/time';
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
  getCachedTask,
  setCachedTask,
  getCachedAllTasksGitStatus,
  setCachedAllTasksGitStatus,
  getCachedProjectTasksGitStatus,
  setCachedProjectTasksGitStatus,
  getCachedActiveDevServers,
  setCachedActiveDevServers,
  isTaskPendingDelete,
  addPendingDeletingTaskId,
  removePendingDeletingTaskId,
  deleteCachedTask,
  restoreCachedTask,
} from '../cache';

interface ProjectsTasksSidebarProps {
  currentTaskId?: string;
  currentProjectId?: string;
  onSelectTask: (taskId: string, projectId?: string, task?: Task) => void;
  onConfigureProject?: (projectId: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  ws: WebSocket | null;
  isMobile?: boolean;
  onClose?: () => void;
}

interface ProjectGroup {
  projectId: string;
  projectName: string;
  projectIcon?: string;
  latestUpdatedAt: number;
  tasks: Task[];
}

const SIDEBAR_WIDTH_KEY = 'raft.tasksSidebarWidth';
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 560;
const SIDEBAR_DEFAULT_WIDTH = 256;

const compareTasksByLastActive = (
  a: Task,
  b: Task,
  agentStatuses?: Record<string, 'WIP' | 'idle'>
) => {
  const aWip = (agentStatuses && agentStatuses[a.id] === 'WIP') || a.agent_status === 'WIP';
  const bWip = (agentStatuses && agentStatuses[b.id] === 'WIP') || b.agent_status === 'WIP';
  if (aWip && !bWip) return -1;
  if (!aWip && bWip) return 1;

  const timeA = Math.max(a.updated_at || 0, a.created_at || 0);
  const timeB = Math.max(b.updated_at || 0, b.created_at || 0);
  if (timeB !== timeA) return timeB - timeA;
  return (b.created_at || 0) - (a.created_at || 0);
};

export const ProjectsTasksSidebar: React.FC<ProjectsTasksSidebarProps> = ({
  currentTaskId,
  currentProjectId,
  onSelectTask,
  onConfigureProject,
  isCollapsed,
  onToggleCollapse,
  ws,
  isMobile = false,
  onClose,
}) => {
  const navigate = useNavigate();
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(saved) && saved > 0
      ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, saved))
      : SIDEBAR_DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    let latest = startWidth;
    setIsResizing(true);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    const onMove = (ev: MouseEvent) => {
      latest = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidth + ev.clientX - startX));
      setSidebarWidth(latest);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = prevCursor;
      setIsResizing(false);
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(latest));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const [projects, setProjects] = useState<Project[]>(() => getCachedProjects() || []);
  const [tasks, setTasks] = useState<Task[]>(() => getCachedAllTasks() || []);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDevServerTaskIds, setActiveDevServerTaskIds] = useState<Set<string>>(() => {
    const cached = getCachedActiveDevServers();
    return cached ? new Set(cached) : new Set();
  });
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set());

  // Task Git status and agent status for concise badges and indicator
  const [tasksGitStatus, setTasksGitStatus] = useState<Record<string, TaskGitStatus>>(() => {
    const globalCached = getCachedAllTasksGitStatus();
    if (globalCached && Object.keys(globalCached).length > 0) {
      return globalCached;
    }
    const cachedTasks = getCachedAllTasks() || [];
    const projectIds = Array.from(new Set(cachedTasks.map((t) => t.project_id).filter(Boolean)));
    const aggregated: Record<string, TaskGitStatus> = {};
    for (const pId of projectIds) {
      const pStatus = getCachedProjectTasksGitStatus(pId);
      if (pStatus) {
        Object.assign(aggregated, pStatus);
      }
    }
    if (Object.keys(aggregated).length > 0) {
      setCachedAllTasksGitStatus(aggregated);
    }
    return aggregated;
  });
  const [tasksAgentStatus, setTasksAgentStatus] = useState<Record<string, 'WIP' | 'idle'>>(() => {
    const cachedTasks = getCachedAllTasks() || [];
    const initial: Record<string, 'WIP' | 'idle'> = {};
    cachedTasks.forEach((t) => {
      if (t.agent_status) initial[t.id] = t.agent_status;
    });
    return initial;
  });
  const [unreadTaskIds, setUnreadTaskIds] = useState<string[]>(() => getCachedUnreadReplyTaskIds());

  const tasksAgentStatusRef = useRef<Record<string, 'WIP' | 'idle'>>({});
  tasksAgentStatusRef.current = tasksAgentStatus;

  const currentTaskIdRef = useRef(currentTaskId);
  currentTaskIdRef.current = currentTaskId;

  const lastFetchedGitStatusRef = useRef<number>(0);
  const fetchGitStatuses = useCallback(async (taskList: Task[], force = false) => {
    const projectIds = Array.from(new Set(taskList.map((t) => t.project_id).filter(Boolean)));
    if (projectIds.length === 0) return;

    if (!force && Date.now() - lastFetchedGitStatusRef.current < 15000) {
      return;
    }
    lastFetchedGitStatusRef.current = Date.now();

    try {
      const results = await Promise.allSettled(
        projectIds.map((pId) => getProjectTasksGitStatus(pId, force))
      );
      const combined: Record<string, TaskGitStatus> = {};
      results.forEach((res, index) => {
        if (res.status === 'fulfilled' && res.value) {
          const pId = projectIds[index];
          if (pId) {
            setCachedProjectTasksGitStatus(pId, res.value);
          }
          Object.assign(combined, res.value);
        }
      });
      setTasksGitStatus((prev) => {
        const next = { ...prev, ...combined };
        setCachedAllTasksGitStatus(next);
        return next;
      });
    } catch (err) {
      console.error('Failed to load git statuses for sidebar:', err);
    }
  }, []);

  // Handle agent replying status updates & unread completed reply notifications
  const handleTaskAgentStatus = useCallback(
    (data: { taskId?: string; sessionId?: string; agentStatus?: 'WIP' | 'idle'; updatedAt?: number }) => {
      const { taskId, sessionId, agentStatus, updatedAt } = data;
      if (!taskId || !agentStatus) return;

      const prevStatus = tasksAgentStatusRef.current[taskId] || 'idle';
      setTasksAgentStatus((prev) => {
        const next = { ...prev, [taskId]: agentStatus };
        tasksAgentStatusRef.current = next;
        return next;
      });

      const activeTime = updatedAt || Date.now();
      setTasks((prev) => {
        const next = prev.map((t) =>
          t.id === taskId
            ? { ...t, agent_status: agentStatus, updated_at: Math.max(t.updated_at || 0, activeTime) }
            : t
        );
        setCachedAllTasks(next);
        return next;
      });

      const cached = getCachedTask(taskId);
      if (cached) {
        setCachedTask({
          ...cached,
          agent_status: agentStatus,
          updated_at: Math.max(cached.updated_at || 0, activeTime),
        });
      }

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
      const activeTasks = tasksData.filter((t) => !isTaskPendingDelete(t.id));
      setTasks(activeTasks);
      setProjects(projectsData);
      setCachedAllTasks(activeTasks);
      setCachedProjects(projectsData);

      const initialAgentStatus: Record<string, 'WIP' | 'idle'> = {};
      activeTasks.forEach((t) => {
        setCachedTask(t);
        initialAgentStatus[t.id] = t.agent_status || 'idle';
      });
      setTasksAgentStatus((prev) => {
        const next = { ...initialAgentStatus, ...prev };
        tasksAgentStatusRef.current = next;
        return next;
      });

      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(() => fetchGitStatuses(activeTasks));
      } else {
        setTimeout(() => fetchGitStatuses(activeTasks), 150);
      }
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
      setCachedActiveDevServers(activeIds);
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
    const handleUpdate = (e?: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.id) {
        setTasks((prev) => {
          const exists = prev.some((t) => t.id === detail.id);
          const next = exists
            ? prev.map((t) => (t.id === detail.id ? { ...t, ...detail } : t))
            : [detail, ...prev];
          setCachedAllTasks(next);
          return next;
        });
      }
      fetchData();
    };
    const handleStatusUpdate = (e?: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.taskId && detail?.status) {
        setTasksGitStatus((prev) => {
          const next = { ...prev, [detail.taskId]: detail.status };
          setCachedAllTasksGitStatus(next);
          return next;
        });
      }
      fetchData();
      if (tasks.length > 0) {
        fetchGitStatuses(tasks, true);
      }
    };
    // Keep the sidebar in sync with statuses fetched elsewhere (e.g. the main header)
    const handleGitStatusCached = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (!detail?.taskId || !detail?.status) return;
      setTasksGitStatus((prev) => ({ ...prev, [detail.taskId]: detail.status }));
    };
    const handleTaskDeleted = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      const targetId = detail?.taskId;
      setTasks((prev) => prev.filter((t) => (targetId ? t.id !== targetId : true) && !isTaskPendingDelete(t.id)));
    };
    const handleTaskRestored = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.task) {
        setTasks((prev) => {
          if (prev.some((t) => t.id === detail.task.id)) return prev;
          return [detail.task, ...prev];
        });
      } else {
        fetchData();
      }
    };
    window.addEventListener('task-updated', handleUpdate);
    window.addEventListener('task-deleted', handleTaskDeleted);
    window.addEventListener('task-restored', handleTaskRestored);
    window.addEventListener('task-status-updated', handleStatusUpdate);
    window.addEventListener('task-git-status-cached', handleGitStatusCached);
    window.addEventListener('projects-updated', handleUpdate);
    return () => {
      window.removeEventListener('task-git-status-cached', handleGitStatusCached);
      window.removeEventListener('task-updated', handleUpdate);
      window.removeEventListener('task-deleted', handleTaskDeleted);
      window.removeEventListener('task-restored', handleTaskRestored);
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
        } else if (
          (msg.type === 'message_saved' || msg.type === 'chat_completed' || msg.type === 'task_activity') &&
          msg.taskId
        ) {
          const activeTime = msg.updatedAt || Date.now();
          setTasks((prev) => {
            const next = prev.map((t) =>
              t.id === msg.taskId
                ? { ...t, updated_at: Math.max(t.updated_at || 0, activeTime) }
                : t
            );
            setCachedAllTasks(next);
            return next;
          });
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
      .sort((a, b) => compareTasksByLastActive(a, b, tasksAgentStatus));

    const taskIndex = projTasks.findIndex((t) => t.id === currentTaskId);
    if (taskIndex >= 10) {
      setExpandedProjectIds((prev) => {
        const next = new Set(prev);
        next.add(currentTask.project_id);
        return next;
      });
    }
  }, [currentTaskId, tasks, tasksAgentStatus]);

  // Pinned tasks list (matches search query if active, sorted by latest activity descending)
  const pinnedTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const pinned = tasks.filter((t) => Boolean(t.is_pinned));
    const filtered = query
      ? pinned.filter((task) => {
          const pName = task.project?.name || (task.project_id ? 'Untitled Project' : 'Other Tasks');
          return (
            task.name.toLowerCase().includes(query) ||
            (task.branch && task.branch.toLowerCase().includes(query)) ||
            pName.toLowerCase().includes(query)
          );
        })
      : pinned;

    return filtered.sort((a, b) => compareTasksByLastActive(a, b, tasksAgentStatus));
  }, [tasks, searchQuery, tasksAgentStatus]);

  // Group unpinned tasks by project and sort
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
      // Exclude pinned tasks so they appear exclusively in the dedicated Pinned section
      if (Boolean(task.is_pinned)) {
        continue;
      }

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

      const sortedTasks = [...data.tasks].sort((a, b) =>
        compareTasksByLastActive(a, b, tasksAgentStatus)
      );

      // Latest task activity across all tasks of this project (including pinned tasks)
      const allProjTasks = tasks.filter((t) => (t.project_id || 'unknown') === projectId);
      const latestTaskTime =
        allProjTasks.length > 0
          ? Math.max(
              ...allProjTasks.map((t) => {
                const isWip = (tasksAgentStatus && tasksAgentStatus[t.id] === 'WIP') || t.agent_status === 'WIP';
                const baseTime = Math.max(t.updated_at || 0, t.created_at || 0);
                return isWip ? Math.max(baseTime, Date.now()) : baseTime;
              })
            )
          : 0;

      const latestUpdatedAt = Math.max(
        latestTaskTime,
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

    // Sort strictly by latest activity descending
    groups.sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);

    return groups;
  }, [projects, tasks, searchQuery, tasksAgentStatus]);

  const handleTogglePin = useCallback(async (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    const nextPinned = !Boolean(task.is_pinned);
    const updatedTask: Task = { ...task, is_pinned: nextPinned ? 1 : 0 };

    setTasks((prev) => prev.map((t) => (t.id === task.id ? updatedTask : t)));
    setCachedTask(updatedTask);
    const cachedAll = getCachedAllTasks();
    if (cachedAll) {
      setCachedAllTasks(cachedAll.map((t) => (t.id === task.id ? updatedTask : t)));
    }
    window.dispatchEvent(new CustomEvent('task-updated', { detail: updatedTask }));

    try {
      await updateTask(task.id, { is_pinned: nextPinned });
    } catch (err) {
      console.error('Failed to toggle pin for task:', err);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
      setCachedTask(task);
      if (cachedAll) {
        setCachedAllTasks(cachedAll);
      }
      window.dispatchEvent(new CustomEvent('task-updated', { detail: task }));
    }
  }, []);

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

  const handleDeleteTask = async (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    if (!confirm('Delete this task and clean up its git worktree?')) return;

    // Optimistically remove so background refreshes don't resurrect it
    addPendingDeletingTaskId(task.id);
    deleteCachedTask(task.id, task.project_id);
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    window.dispatchEvent(
      new CustomEvent('task-deleted', { detail: { taskId: task.id, projectId: task.project_id } })
    );
    if (task.id === currentTaskId) {
      navigate(task.project_id ? `/projects/${task.project_id}` : '/');
    }

    try {
      await deleteTask(task.id);
    } catch (err: any) {
      restoreCachedTask(task, task.project_id);
      setTasks((prev) => (prev.some((t) => t.id === task.id) ? prev : [task, ...prev]));
      alert(err?.message || 'Failed to delete task');
    } finally {
      removePendingDeletingTaskId(task.id);
    }
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
    if (isMobile) {
      onClose?.();
    }
  };

  const renderTaskItem = (task: Task, isPinnedSection = false) => {
    if (isTaskPendingDelete(task.id)) return null;
    const isActive = task.id === currentTaskId;
    const hasActiveDevServer = activeDevServerTaskIds.has(task.id);
    const agentStatus = tasksAgentStatus[task.id] || task.agent_status || 'idle';
    const isReplying = agentStatus === 'WIP';
    const hasUnreadReply = !isReplying && unreadTaskIds.includes(task.id);
    const gitStatus = tasksGitStatus[task.id];
    const isPinned = Boolean(task.is_pinned);
    const project = task.project || projects.find((p) => p.id === task.project_id);
    const projectName = project?.name;
    const projectIcon = project?.icon;

    return (
      <div
        key={task.id}
        role="button"
        tabIndex={0}
        onClick={() => {
          onSelectTask(task.id, task.project_id, task);
          if (isMobile) {
            onClose?.();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectTask(task.id, task.project_id, task);
            if (isMobile) {
              onClose?.();
            }
          }
        }}
        onMouseEnter={() => handleTaskMouseEnter(task.id)}
        onMouseLeave={() => handleTaskMouseLeave(task.id)}
        className={`relative w-full px-2 py-1.5 rounded-lg flex items-center gap-1.5 text-left transition-colors cursor-pointer group ${
          isActive
            ? 'bg-cozy-surface dark:bg-[#242424] text-cozy-text font-medium border border-cozy-border'
            : 'hover:bg-cozy-subtle dark:hover:bg-[#212121] text-cozy-muted hover:text-cozy-text border border-transparent'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-xs truncate font-medium min-w-0 ${
                isActive
                  ? 'text-cozy-text'
                  : 'text-cozy-muted group-hover:text-cozy-text'
              }`}
            >
              {task.name}
            </span>

            {isPinnedSection && projectName && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-cozy-subtle text-cozy-muted text-[9px] font-medium border border-cozy-border/40 shrink-0 max-w-[100px] truncate"
                title={`Project: ${projectName}`}
              >
                <ProjectIcon icon={projectIcon} className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate">{projectName}</span>
              </span>
            )}

            {isReplying ? (
              <span title="Agent is replying..." className="inline-flex items-center justify-center shrink-0">
                <Loader2 className="w-3.5 h-3.5 text-teal-500 animate-spin" />
              </span>
            ) : hasUnreadReply ? (
              <span
                className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)] animate-pulse shrink-0"
                title="Agent finished replying"
              />
            ) : null}

            {hasActiveDevServer && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"
                title="Dev server running in background"
              />
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[10px] text-cozy-muted/70 mt-0.5 overflow-hidden">
            {task.branch && (
              <span className="flex items-center gap-0.5 font-mono text-[10px] text-cozy-muted/80 min-w-0 truncate">
                <GitBranch className="w-2.5 h-2.5 text-teal-500/70 shrink-0" />
                <span className="truncate">{task.branch}</span>
              </span>
            )}
            {(task.updated_at || task.created_at) && (
              <span className="text-cozy-muted/50 shrink-0 whitespace-nowrap">
                • {formatShortRelativeTime(task.updated_at || task.created_at)}
              </span>
            )}
            <div className="ml-auto shrink-0">{renderConciseTaskStatusBadge(task, gitStatus)}</div>
          </div>
        </div>

        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-md pl-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto bg-cozy-subtle dark:bg-[#212121] transition-opacity">
          <button
            type="button"
            onClick={(e) => handleTogglePin(e, task)}
            className={`p-1 rounded transition-all cursor-pointer ${
              isPinned
                ? 'text-amber-500 hover:text-amber-600 dark:text-amber-400 hover:bg-amber-500/10'
                : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-border/40'
            }`}
            title={isPinned ? 'Unpin task' : 'Pin task'}
            aria-label={isPinned ? 'Unpin task' : 'Pin task'}
          >
            <Pin className={`w-3 h-3 ${isPinned ? 'fill-current' : ''}`} />
          </button>

          <button
            type="button"
            onClick={(e) => handleDeleteTask(e, task)}
            className="p-1 rounded transition-all cursor-pointer text-cozy-muted hover:text-red-500 hover:bg-red-500/10"
            title="Delete task"
            aria-label="Delete task"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <aside
      aria-label="Projects and Tasks Sidebar"
      style={{ width: isMobile ? '100%' : (isCollapsed ? 0 : sidebarWidth) }}
      className={`relative h-full shrink-0 flex flex-col select-none overflow-hidden ${
        isMobile ? 'w-full' : (isResizing ? '' : 'transition-all duration-200 ease-in-out')
      } ${
        !isMobile && isCollapsed
          ? 'opacity-0 pointer-events-none'
          : 'border-r border-cozy-border bg-cozy-subtle/30 dark:bg-[#171717]'
      }`}
    >
      {!isMobile && !isCollapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={handleResizeStart}
          onDoubleClick={() => {
            setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
            localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_DEFAULT_WIDTH));
          }}
          className={`absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize transition-colors hover:bg-teal-500/40 ${
            isResizing ? 'bg-teal-500/60' : ''
          }`}
        />
      )}
      <div className="h-full flex flex-col overflow-hidden w-full" style={{ width: isMobile ? '100%' : sidebarWidth }}>
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

          {isMobile ? (
            <button
              type="button"
              onClick={onClose || onToggleCollapse}
              className="w-6 h-6 rounded-md text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle flex items-center justify-center transition-colors cursor-pointer"
              title="Close sidebar"
              aria-label="Close sidebar"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="w-6 h-6 rounded-md text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle flex items-center justify-center transition-colors cursor-pointer"
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          )}
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
          ) : pinnedTasks.length === 0 && groupedProjects.length === 0 ? (
            <div className="py-12 px-3 text-center text-xs text-cozy-muted flex flex-col items-center justify-center gap-2">
              <ListTodo className="w-8 h-8 opacity-25" />
              <span>{searchQuery ? 'No matching tasks' : 'No projects or tasks yet'}</span>
            </div>
          ) : (
            <>
              {/* Dedicated Pinned Tasks Section (Hidden if 0 pinned tasks) */}
              {pinnedTasks.length > 0 && (
                <div className="flex flex-col space-y-1 pb-2 mb-1 border-b border-cozy-border/40">
                  <div className="flex items-center justify-between px-2 py-1 rounded-lg text-[11px] font-semibold text-cozy-muted select-none">
                    <div className="flex items-center gap-1.5 text-cozy-text/90">
                      <Pin className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                      <span className="font-semibold uppercase tracking-wider text-[10px] text-cozy-muted">
                        Pinned
                      </span>
                    </div>
                    <span className="text-[10px] font-normal text-cozy-muted px-1.5 py-0.2 rounded-full bg-cozy-subtle/80 border border-cozy-border/40">
                      {pinnedTasks.length}
                    </span>
                  </div>

                  <div className="space-y-1 pl-4">
                    {pinnedTasks.map((task) => renderTaskItem(task, true))}
                  </div>
                </div>
              )}

              {/* Grouped Projects */}
              {groupedProjects.map((group) => {
                const isExpanded = expandedProjectIds.has(group.projectId);
                const isSearching = searchQuery.trim().length > 0;
                const visibleTasks = isSearching || isExpanded ? group.tasks : group.tasks.slice(0, 10);
                const hasMoreTasks = !isSearching && group.tasks.length > 10;
                const remainingCount = group.tasks.length - 10;
                const hasAnyProjectTasks = tasks.some(
                  (t) => (t.project_id || 'unknown') === group.projectId
                );

                const isProjectSelected = !currentTaskId && group.projectId === currentProjectId;

                return (
                  <div key={group.projectId} className="flex flex-col space-y-1">
                    {/* Project Section Header */}
                    <div
                      className={`flex items-center justify-between px-2 py-1.5 rounded-lg group/project text-[13px] font-semibold transition-all ${
                        isProjectSelected
                          ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/25 shadow-soft-xs'
                          : 'text-cozy-muted hover:bg-cozy-subtle/60 border border-transparent'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          navigate(`/projects/${group.projectId}`);
                          if (isMobile) {
                            onClose?.();
                          }
                        }}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left transition-colors cursor-pointer"
                        title={`Select project: ${group.projectName}`}
                      >
                        <ProjectIcon icon={group.projectIcon} className="w-5 h-5 shrink-0" />
                        <span
                          className={`truncate font-semibold ${
                            isProjectSelected
                              ? 'text-teal-600 dark:text-teal-400'
                              : 'text-cozy-text/90 group-hover/project:text-teal-600 dark:group-hover/project:text-teal-400'
                          }`}
                        >
                          {group.projectName}
                        </span>
                        {isProjectSelected && (
                          <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0 animate-pulse ml-0.5" />
                        )}
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        {onConfigureProject && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onConfigureProject(group.projectId);
                              if (isMobile) {
                                onClose?.();
                              }
                            }}
                            className="w-5 h-5 rounded-md text-cozy-muted hover:text-teal-600 dark:hover:text-teal-400 hover:bg-teal-500/10 flex items-center justify-center transition-all opacity-0 group-hover/project:opacity-100"
                            title="Project settings"
                            aria-label="Project settings"
                          >
                            <Sliders className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => handleCreateTaskInProject(e, group.projectId)}
                          className="w-5 h-5 rounded-md text-cozy-muted hover:text-teal-600 dark:hover:text-teal-400 hover:bg-teal-500/10 flex items-center justify-center transition-all opacity-0 group-hover/project:opacity-100"
                          title="New task in this project"
                          aria-label="New task in this project"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        {group.tasks.length > 0 && (
                          <span className="text-[10px] font-normal text-cozy-muted px-1.5 py-0.2 rounded-full bg-cozy-subtle/80 border border-cozy-border/40">
                            {group.tasks.length}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Tasks List or Empty State */}
                    {group.tasks.length === 0 ? (
                      hasAnyProjectTasks ? (
                        <div className="pl-6 pr-2 py-1 text-[10px] text-cozy-muted/60 italic">
                          All tasks in this project are pinned
                        </div>
                      ) : (
                        <div className="pl-4 pr-1 py-1">
                          <button
                            type="button"
                            onClick={(e) => handleCreateTaskInProject(e, group.projectId)}
                            className="w-full px-2 py-1.5 rounded-lg border border-dashed border-cozy-border/60 hover:border-teal-500/50 hover:bg-teal-500/5 text-left text-[11px] text-cozy-muted hover:text-teal-600 dark:hover:text-teal-400 flex items-center gap-1.5 transition-colors cursor-pointer group/empty"
                          >
                            <Plus className="w-3 h-3 text-cozy-muted group-hover/empty:text-teal-500 transition-colors" />
                            <span>Create first task</span>
                          </button>
                        </div>
                      )
                    ) : (
                      <div className="space-y-1 pl-4">
                        {visibleTasks.map((task) => renderTaskItem(task, false))}

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
              })}
            </>
          )}
        </div>
      </div>
    </aside>
  );
};
