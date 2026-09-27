import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ListTodo, GitBranch, FolderGit2, Check, Clock, ChevronDown, Loader2 } from 'lucide-react';
import { Task } from '../types';
import { getTasks } from '../api';

interface TaskQuickSwitcherProps {
  currentTaskId?: string;
  currentTaskName?: string;
  onNavigate?: (page: 'home' | 'project' | 'task' | 'settings', params?: any) => void;
}

interface ProjectGroup {
  projectId: string;
  projectName: string;
  projectIcon?: string;
  latestUpdatedAt: number;
  tasks: Task[];
}

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return '';
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const TaskQuickSwitcher: React.FC<TaskQuickSwitcherProps> = ({
  currentTaskId,
  currentTaskName,
  onNavigate,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchTasks = async () => {
    try {
      if (tasks.length === 0) {
        setLoading(true);
      }
      const data = await getTasks();
      setTasks(data);
    } catch (err) {
      console.error('Failed to load tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch when dropdown is opened
  useEffect(() => {
    if (isOpen) {
      fetchTasks();
    }
  }, [isOpen]);

  // Listen for task updates across the app
  useEffect(() => {
    const handleTaskUpdated = () => {
      fetchTasks();
    };
    window.addEventListener('task-updated', handleTaskUpdated);
    return () => window.removeEventListener('task-updated', handleTaskUpdated);
  }, []);

  // Handle outside clicks and escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Group tasks by project and sort both groups and tasks by updated_at desc
  const groupedProjects = useMemo(() => {
    const map = new Map<string, { projectName: string; projectIcon?: string; tasks: Task[] }>();

    for (const task of tasks) {
      const pId = task.project_id || 'unknown';
      const pName = task.project?.name || 'Other Tasks';
      const pIcon = task.project?.icon;
      if (!map.has(pId)) {
        map.set(pId, { projectName: pName, projectIcon: pIcon, tasks: [] });
      }
      map.get(pId)!.tasks.push(task);
    }

    const groups: ProjectGroup[] = [];
    for (const [projectId, data] of map.entries()) {
      // Sort tasks within project by updated_at descending
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
  }, [tasks]);

  const handleSelectTask = (task: Task) => {
    setIsOpen(false);
    if (task.id === currentTaskId) return;
    onNavigate?.('task', { taskId: task.id, projectId: task.project_id });
  };

  return (
    <div className="relative z-50" ref={containerRef}>
      {/* Switcher Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all shrink-0 cursor-pointer shadow-soft-sm ${
          isOpen
            ? 'bg-teal-500/10 border-teal-400/50 text-teal-600 dark:text-teal-400 shadow-glow-ocean'
            : 'bg-cozy-subtle/80 hover:bg-cozy-subtle border-cozy-border/70 text-cozy-muted hover:text-cozy-text hover:border-teal-400/30'
        }`}
        title={currentTaskName ? `Active Task: ${currentTaskName} (Click to switch)` : 'Quick switch task'}
      >
        <ListTodo className={`w-3.5 h-3.5 shrink-0 ${currentTaskId ? 'text-teal-500' : 'text-cozy-muted'}`} />
        <span className="max-w-[90px] sm:max-w-[150px] truncate text-cozy-text font-medium">
          {currentTaskName || 'Tasks'}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-cozy-muted shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-teal-500' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-88 max-h-[420px] rounded-squircle popup-surface bg-white dark:bg-[#1a1d2e] z-50 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 p-2.5">
          {/* Header */}
          <div className="px-3.5 py-2.5 rounded-2xl flex items-center justify-between text-xs font-medium text-cozy-muted bg-cozy-subtle/80 select-none shrink-0 mb-1">
            <span className="font-semibold text-cozy-text">Quick Switch Task</span>
            {!loading && (
              <span className="text-[11px] bg-cozy-surface px-2 py-0.5 rounded-full border border-cozy-border/60 text-cozy-muted font-medium shadow-soft-sm">
                {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
              </span>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto overscroll-contain space-y-1 pr-1">
            {loading && tasks.length === 0 ? (
              <div className="py-8 flex flex-col items-center justify-center text-xs text-cozy-muted gap-2">
                <Loader2 className="w-5 h-5 text-teal-500 animate-spin" />
                <span>Loading tasks...</span>
              </div>
            ) : groupedProjects.length === 0 ? (
              <div className="py-8 px-4 text-center text-xs text-cozy-muted flex flex-col items-center justify-center gap-2">
                <ListTodo className="w-8 h-8 opacity-25" />
                <span>No tasks found</span>
              </div>
            ) : (
              groupedProjects.map((group) => (
                <div key={group.projectId} className="flex flex-col space-y-0.5">
                  {/* Project Header */}
                  <div className="px-3 py-1.5 flex items-center gap-2 text-[11px] font-semibold text-cozy-muted tracking-wide select-none">
                    {group.projectIcon ? (
                      <span className="text-xs shrink-0 leading-none">{group.projectIcon}</span>
                    ) : (
                      <FolderGit2 className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                    )}
                    <span className="truncate">{group.projectName}</span>
                    <span className="ml-auto text-[10px] font-normal text-cozy-muted/70 px-1.5 py-0.2 rounded-full bg-cozy-subtle">
                      {group.tasks.length}
                    </span>
                  </div>

                  {/* Tasks List */}
                  <div className="space-y-1">
                    {group.tasks.map((task) => {
                      const isActive = task.id === currentTaskId;
                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => handleSelectTask(task)}
                          className={`w-full px-3 py-2 rounded-2xl flex items-center justify-between gap-2.5 text-left transition-all cursor-pointer group ${
                            isActive
                              ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400 font-medium shadow-soft-sm border border-teal-400/20'
                              : 'hover:bg-cozy-subtle/80 text-cozy-text border border-transparent'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-xs truncate font-medium ${
                                  isActive
                                    ? 'text-teal-600 dark:text-teal-400'
                                    : 'text-cozy-text group-hover:text-teal-500'
                                }`}
                              >
                                {task.name}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 text-[11px] text-cozy-muted mt-0.5">
                              <span className="flex items-center gap-1 max-w-[140px] truncate">
                                <GitBranch className="w-2.5 h-2.5 shrink-0 text-amber-500/80" />
                                <span className="truncate">{task.branch}</span>
                              </span>
                              <span>•</span>
                              <span className="shrink-0 flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5 shrink-0 text-cozy-muted/70" />
                                <span>{formatRelativeTime(task.updated_at || task.created_at)}</span>
                              </span>
                            </div>
                          </div>

                          {isActive && (
                            <Check className="w-4 h-4 text-teal-500 shrink-0 ml-1.5" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
