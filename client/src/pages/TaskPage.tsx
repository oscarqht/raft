import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Task, Project, Settings, CliInfo, ProjectCustomScript } from '../types';
import { getTask, getProject, createTask, validateProjectPath, getDevServerState } from '../api';
import { getCachedTask, setCachedTask, getCachedProject, setCachedProject } from '../cache';
import { DraggableSplit } from '../components/DraggableSplit';
import { ChatPane } from '../components/ChatPane';
import { PreviewPane } from '../components/PreviewPane';
import { RebaseDrawer } from '../components/RebaseDrawer';
import { SubmitModal } from '../components/SubmitModal';
import { ScriptExecutionProvider } from '../contexts/ScriptExecutionContext';
import { ScriptDock } from '../components/ScriptDock';
import { ScriptTerminalModal } from '../components/ScriptTerminalModal';
import { RunScriptModal } from '../components/RunScriptModal';
import { ManageScriptsModal } from '../components/ManageScriptsModal';
import { ProjectsTasksSidebar } from '../components/ProjectsTasksSidebar';
import { NewTaskPane } from '../components/NewTaskPane';
import { ProjectConfigModal } from '../components/ProjectConfigModal';
import { ArrowLeft, MessageSquare, Globe, PanelLeftOpen, Loader2 } from 'lucide-react';

interface TaskPageProps {
  taskId?: string;
  settings: Settings | null;
  clis: CliInfo[];
  ws: WebSocket | null;
  onDeleteTask?: () => void;
  isDeletingTask?: boolean;
}

export const TaskPage: React.FC<TaskPageProps> = ({
  taskId: propTaskId,
  settings,
  clis,
  ws,
  onDeleteTask,
  isDeletingTask,
}) => {
  const params = useParams<{ projectId?: string; taskId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const taskId = propTaskId || params.taskId || '';
  const routeProjectId = params.projectId;

  // Initialize immediately from router state or localStorage cache
  const [task, setTask] = useState<Task | null>(() => {
    if (!taskId) return null;
    const navTask = (location.state as any)?.task as Task | undefined;
    if (navTask && navTask.id === taskId) {
      return navTask;
    }
    return getCachedTask(taskId);
  });
  const [loading, setLoading] = useState(Boolean(taskId && !task));
  const [error, setError] = useState<string | null>(null);
  const [isRebaseOpen, setIsRebaseOpen] = useState(false);
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);
  const [isRunScriptOpen, setIsRunScriptOpen] = useState(false);
  const [isManageScriptsOpen, setIsManageScriptsOpen] = useState(false);
  const [scripts, setScripts] = useState<ProjectCustomScript[]>(() => task?.project?.custom_scripts || []);
  const [mobileTab, setMobileTab] = useState<'chat' | 'preview'>('chat');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('raft:task-sidebar-collapsed');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  // Project state for "New Task" mode (when on /projects/:projectId with no taskId)
  const [project, setProject] = useState<Project | null>(() =>
    routeProjectId ? getCachedProject(routeProjectId) : null
  );
  const [projectLoading, setProjectLoading] = useState(false);
  const [availableBranches, setAvailableBranches] = useState<string[]>(['main']);
  const [baseBranch, setBaseBranch] = useState<string>('main');
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [newTaskError, setNewTaskError] = useState<string | null>(null);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('raft:task-sidebar-collapsed', String(isSidebarCollapsed));
    } catch {}
  }, [isSidebarCollapsed]);

  const [isDevRunning, setIsDevRunning] = useState(false);
  const isDevRunningRef = useRef(false);
  const taskRef = useRef(task);
  taskRef.current = task;
  const isDeletingTaskRef = useRef(isDeletingTask);
  isDeletingTaskRef.current = isDeletingTask;

  // Listen for open-project-config global event (e.g. from Header)
  useEffect(() => {
    const handleOpenProjectConfig = () => setIsConfigModalOpen(true);
    window.addEventListener('open-project-config', handleOpenProjectConfig);
    return () => window.removeEventListener('open-project-config', handleOpenProjectConfig);
  }, []);

  // Fetch Dev Server state when on an active task
  useEffect(() => {
    if (!taskId) return;

    getDevServerState(taskId)
      .then((s) => {
        const active = s.status === 'running' || s.status === 'starting';
        setIsDevRunning(active);
        isDevRunningRef.current = active;
      })
      .catch(() => {});
  }, [taskId]);

  useEffect(() => {
    if (!ws) return;
    const handleWs = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'dev_server_state' && msg.state) {
          const wasActive = isDevRunningRef.current;
          const active = msg.state.status === 'running' || msg.state.status === 'starting';
          setIsDevRunning(active);
          isDevRunningRef.current = active;
          if (wasActive && msg.state.status === 'stopped') {
            setIsPreviewOpen(false);
          }
        }
      } catch {}
    };
    ws.addEventListener('message', handleWs);
    return () => ws.removeEventListener('message', handleWs);
  }, [ws]);

  useEffect(() => {
    if (task?.project?.custom_scripts) {
      setScripts(task.project.custom_scripts);
    }
  }, [task?.project?.custom_scripts]);

  // Load project details and available branches in "New Task" mode
  useEffect(() => {
    if (taskId || !routeProjectId) return;

    let isCurrent = true;
    const cached = getCachedProject(routeProjectId);
    if (cached) {
      setProject(cached);
      setBaseBranch(cached.branch_convention || 'main');
    } else {
      setProjectLoading(true);
    }
    setNewTaskError(null);

    getProject(routeProjectId)
      .then(async (p) => {
        if (!isCurrent) return;
        setProject(p);
        setCachedProject(p);
        setBaseBranch(p.branch_convention || 'main');

        try {
          const validation = await validateProjectPath(p.path);
          if (!isCurrent) return;
          if (validation.branches && validation.branches.length > 0) {
            setAvailableBranches(validation.branches);
          } else {
            setAvailableBranches([p.branch_convention || 'main']);
          }
        } catch {
          if (!isCurrent) return;
          setAvailableBranches([p.branch_convention || 'main']);
        }
      })
      .catch((err) => {
        if (!isCurrent) return;
        if (!project && !cached) {
          setNewTaskError(err?.message || 'Failed to load project');
        }
      })
      .finally(() => {
        if (!isCurrent) return;
        setProjectLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [taskId, routeProjectId]);

  // Load task details in Task mode
  useEffect(() => {
    if (!taskId) {
      if (routeProjectId) {
        // In "New Task" mode for this project
        setError(null);
        setLoading(false);
        return;
      }
      setError('Task ID is missing');
      setLoading(false);
      return;
    }

    let isCurrent = true;
    if (!task || task.id !== taskId) {
      const navTask = (location.state as any)?.task as Task | undefined;
      const cached = (navTask && navTask.id === taskId) ? navTask : getCachedTask(taskId);
      if (cached) {
        setTask(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }
    }
    setError(null);

    getTask(taskId)
      .then((t) => {
        if (!isCurrent) return;
        setTask(t);
        setCachedTask(t);
        // Canonicalize URL to /projects/:projectId/tasks/:taskId if reached via /tasks/:taskId
        if (!routeProjectId && t.project_id) {
          navigate(`/projects/${t.project_id}/tasks/${taskId}`, { replace: true, state: { task: t } });
        }
      })
      .catch((err) => {
        if (!isCurrent) return;
        if (!task) {
          setError(err?.message || 'Task not found');
        }
      })
      .finally(() => {
        if (!isCurrent) return;
        setLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [taskId, routeProjectId, navigate]);

  useEffect(() => {
    if (!taskId) return;
    const handleTaskUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<Task>;
      if (customEvent.detail && customEvent.detail.id === taskId) {
        setTask(customEvent.detail);
      }
    };
    window.addEventListener('task-updated', handleTaskUpdated);
    return () => window.removeEventListener('task-updated', handleTaskUpdated);
  }, [taskId]);

  useEffect(() => {
    setIsRebaseOpen(false);
    setIsSubmitOpen(false);
    setIsRunScriptOpen(false);
    setIsManageScriptsOpen(false);
  }, [taskId]);

  useEffect(() => {
    const handleOpenSubmit = () => setIsSubmitOpen(true);
    window.addEventListener('open-submit-modal', handleOpenSubmit);
    return () => {
      window.removeEventListener('open-submit-modal', handleOpenSubmit);
    };
  }, []);

  const handleCreateTask = async (taskName: string, selectedBaseBranch: string, initialPrompt: string) => {
    if (!routeProjectId) return;
    setIsCreatingTask(true);
    setNewTaskError(null);
    try {
      const newTask = await createTask(routeProjectId, taskName, selectedBaseBranch);
      setCachedTask(newTask);
      window.dispatchEvent(new CustomEvent('task-updated', { detail: newTask }));
      window.dispatchEvent(new CustomEvent('projects-updated'));
      navigate(`/projects/${routeProjectId}/tasks/${newTask.id}`, {
        state: { task: newTask, initialPrompt: initialPrompt.trim() },
      });
    } catch (err: any) {
      setNewTaskError(err?.message || 'Failed to create task');
      throw err;
    } finally {
      setIsCreatingTask(false);
    }
  };

  // Render "New Task" Mode
  if (!taskId && routeProjectId) {
    return (
      <div className="flex-1 flex flex-row h-[calc(100vh-3rem)] overflow-hidden relative p-0 bg-cozy-bg">
        {/* Left Projects & Tasks Sidebar (Desktop) */}
        <div className="hidden min-[1200px]:flex h-full shrink-0">
          <ProjectsTasksSidebar
            currentTaskId={undefined}
            currentProjectId={routeProjectId}
            onSelectTask={(selectedTaskId, selectedProjectId, selectedTask) => {
              if (selectedTask) {
                setTask(selectedTask);
                setCachedTask(selectedTask);
              }
              const route = selectedProjectId
                ? `/projects/${selectedProjectId}/tasks/${selectedTaskId}`
                : `/tasks/${selectedTaskId}`;
              navigate(route, { state: { task: selectedTask } });
            }}
            onConfigureProject={() => setIsConfigModalOpen(true)}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
            ws={ws}
          />
        </div>

        {/* Main Workspace Area: NewTaskPane */}
        <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
          {/* Collapsed sidebar toggle button (desktop) */}
          {isSidebarCollapsed && (
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed(false)}
              className="hidden min-[1200px]:flex absolute top-2 left-2 z-30 w-7 h-7 rounded-md bg-cozy-surface hover:bg-cozy-subtle border border-cozy-border text-cozy-muted hover:text-cozy-text items-center justify-center transition-colors cursor-pointer"
              title="Expand projects & tasks sidebar"
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            </button>
          )}

          {projectLoading && !project ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-cozy-muted select-none">
              <Loader2 className="w-7 h-7 text-teal-500 animate-spin" />
              <span className="text-xs">Loading project...</span>
            </div>
          ) : project ? (
            <NewTaskPane
              project={project}
              availableBranches={availableBranches}
              baseBranch={baseBranch}
              onBaseBranchChange={setBaseBranch}
              onOpenProjectConfig={() => setIsConfigModalOpen(true)}
              onCreateTask={handleCreateTask}
              isCreating={isCreatingTask}
              error={newTaskError}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none">
              <p className="text-red-500 text-sm mb-4">Project not found</p>
              <button
                onClick={() => navigate('/')}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white transition-all shadow-sm cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Return Home</span>
              </button>
            </div>
          )}
        </div>

        {/* Project Configuration Modal */}
        {isConfigModalOpen && project && (
          <ProjectConfigModal
            project={project}
            isOpen={isConfigModalOpen}
            onClose={() => setIsConfigModalOpen(false)}
            onSuccess={(updated) => {
              setProject(updated);
              setCachedProject(updated);
              setIsConfigModalOpen(false);
            }}
            settings={settings}
            ws={ws}
            availableBranches={availableBranches}
          />
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <p className="text-red-500 text-sm mb-4">{error}</p>
        <button
          onClick={() => {
            const target = routeProjectId || task?.project_id;
            if (target) navigate(`/projects/${target}`);
            else navigate('/');
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white transition-all shadow-sm cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Project</span>
        </button>
      </div>
    );
  }

  if (loading && !task) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-screen bg-cozy-bg text-cozy-muted gap-3 select-none">
        <Loader2 className="w-7 h-7 text-teal-500 animate-spin" />
      </div>
    );
  }

  if (!task) {
    return null;
  }

  return (
    <ScriptExecutionProvider taskId={task.id} projectId={task.project_id} ws={ws}>
      <div className="flex-1 flex flex-row h-[calc(100vh-3rem)] overflow-hidden relative p-0 bg-cozy-bg">
        {/* Left Projects & Tasks Sidebar (Desktop) */}
        <div className="hidden min-[1200px]:flex h-full shrink-0">
          <ProjectsTasksSidebar
            currentTaskId={taskId}
            currentProjectId={task.project_id || routeProjectId}
            onSelectTask={(selectedTaskId, selectedProjectId, selectedTask) => {
              if (selectedTaskId === taskId) return;
              if (selectedTask) {
                setTask(selectedTask);
                setCachedTask(selectedTask);
              }
              const route = selectedProjectId
                ? `/projects/${selectedProjectId}/tasks/${selectedTaskId}`
                : `/tasks/${selectedTaskId}`;
              navigate(route, { state: { task: selectedTask } });
            }}
            onConfigureProject={() => setIsConfigModalOpen(true)}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
            ws={ws}
          />
        </div>

        {/* Main Workspace Area (Chat + Preview) */}
        <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
          {/* Collapsed sidebar toggle button (desktop) */}
          {isSidebarCollapsed && (
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed(false)}
              className="hidden min-[1200px]:flex absolute top-2 left-2 z-30 w-7 h-7 rounded-md bg-cozy-surface hover:bg-cozy-subtle border border-cozy-border text-cozy-muted hover:text-cozy-text items-center justify-center transition-colors cursor-pointer"
              title="Expand projects & tasks sidebar"
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            </button>
          )}

          {/* Mobile Header Tabs */}
          <div className="min-[1200px]:hidden flex items-center border-b border-cozy-border/60 bg-cozy-surface shrink-0 select-none">
            <button
              type="button"
              onClick={() => setMobileTab('chat')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-medium border-b-2 transition-all ${
                mobileTab === 'chat'
                  ? 'border-teal-500 text-teal-600 dark:text-teal-400 font-semibold bg-teal-500/5'
                  : 'border-transparent text-cozy-muted hover:text-cozy-text'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat</span>
            </button>
            <div className="w-[1px] h-4 bg-cozy-border/40 shrink-0" />
            <button
              type="button"
              onClick={() => setMobileTab('preview')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-medium border-b-2 transition-all ${
                mobileTab === 'preview'
                  ? 'border-teal-500 text-teal-600 dark:text-teal-400 font-semibold bg-teal-500/5'
                  : 'border-transparent text-cozy-muted hover:text-cozy-text'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Preview</span>
              <span
                className={`w-2 h-2 rounded-full transition-all ${
                  isDevRunning
                    ? 'bg-emerald-400 shadow-glow-mint'
                    : 'bg-zinc-400/40'
                }`}
                title={isDevRunning ? 'Dev server is running' : 'Dev server is offline'}
              />
            </button>
          </div>

          <DraggableSplit
            mobileActivePane={mobileTab === 'chat' ? 'left' : 'right'}
            rightCollapsed={!isPreviewOpen}
            left={
              <ChatPane
                key={task.id}
                task={task}
                settings={settings}
                clis={clis}
                ws={ws}
                onOpenRebase={() => setIsRebaseOpen(true)}
                onOpenSubmit={() => setIsSubmitOpen(true)}
                onOpenScripts={() => setIsRunScriptOpen(true)}
                onDeleteTask={onDeleteTask}
                isDeletingTask={isDeletingTask}
                isPreviewOpen={isPreviewOpen}
                onTogglePreview={() => {
                  if (window.innerWidth < 1200) {
                    setMobileTab((prev) => (prev === 'chat' ? 'preview' : 'chat'));
                  } else {
                    setIsPreviewOpen((prev) => !prev);
                  }
                }}
                isDevRunning={isDevRunning}
              />
            }
            right={
              <PreviewPane
                key={task.id}
                task={task}
                ws={ws}
                onClose={() => {
                  setIsPreviewOpen(false);
                }}
                onAttachToChat={(attachments, url) => {
                  window.dispatchEvent(
                    new CustomEvent('add-pending-attachments', {
                      detail: { attachments, url },
                    })
                  );
                  setMobileTab('chat');
                }}
              />
            }
          />
        </div>

        {/* Floating Bottom-Right Script Dock */}
        <ScriptDock />

        {/* Live Terminal Modal for running/viewing scripts */}
        <ScriptTerminalModal />

        {/* Run Script Launcher Modal */}
        <RunScriptModal
          taskId={task.id}
          projectId={task.project_id}
          scripts={scripts}
          isOpen={isRunScriptOpen}
          onClose={() => setIsRunScriptOpen(false)}
          onOpenManageScripts={() => setIsManageScriptsOpen(true)}
          onScriptSaved={(updatedScripts) => setScripts(updatedScripts)}
        />

        {/* Manage Project Custom Scripts Modal */}
        <ManageScriptsModal
          projectId={task.project_id}
          scripts={scripts}
          isOpen={isManageScriptsOpen}
          onClose={() => setIsManageScriptsOpen(false)}
          onScriptsUpdated={(updatedScripts) => setScripts(updatedScripts)}
        />

        {/* Slide-over Rebase & Conflict Resolution Drawer */}
        <RebaseDrawer
          key={`rebase-${task.project_id}-${task.id}`}
          task={task}
          isOpen={isRebaseOpen}
          onClose={() => setIsRebaseOpen(false)}
          ws={ws}
        />

        {/* Submit Changes Modal */}
        <SubmitModal
          key={`submit-${task.project_id}-${task.id}`}
          task={task}
          isOpen={isSubmitOpen}
          onClose={() => setIsSubmitOpen(false)}
          ws={ws}
        />

        {/* Project Configuration Modal in Task Mode */}
        {isConfigModalOpen && (task.project || project) && (
          <ProjectConfigModal
            project={(task.project || project)!}
            isOpen={isConfigModalOpen}
            onClose={() => setIsConfigModalOpen(false)}
            onSuccess={(updated) => {
              setTask((prev) => (prev ? { ...prev, project: updated } : prev));
              setProject(updated);
              setCachedProject(updated);
              setIsConfigModalOpen(false);
            }}
            settings={settings}
            ws={ws}
          />
        )}
      </div>
    </ScriptExecutionProvider>
  );
};
