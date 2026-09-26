import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Task, Settings, CliInfo, ProjectCustomScript } from '../types';
import { getTask } from '../api';
import { getCachedTask, setCachedTask } from '../cache';
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
import { ArrowLeft } from 'lucide-react';

interface TaskPageProps {
  taskId?: string;
  settings: Settings | null;
  clis: CliInfo[];
  ws: WebSocket | null;
}

export const TaskPage: React.FC<TaskPageProps> = ({
  taskId: propTaskId,
  settings,
  clis,
  ws,
}) => {
  const params = useParams<{ projectId?: string; taskId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const taskId = propTaskId || params.taskId || '';
  const routeProjectId = params.projectId;

  // Initialize immediately from router state or localStorage cache
  const [task, setTask] = useState<Task | null>(() => {
    const navTask = (location.state as any)?.task as Task | undefined;
    if (navTask && navTask.id === taskId) {
      return navTask;
    }
    return getCachedTask(taskId);
  });
  const [loading, setLoading] = useState(!task);
  const [error, setError] = useState<string | null>(null);
  const [isRebaseOpen, setIsRebaseOpen] = useState(false);
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);
  const [isRunScriptOpen, setIsRunScriptOpen] = useState(false);
  const [isManageScriptsOpen, setIsManageScriptsOpen] = useState(false);
  const [scripts, setScripts] = useState<ProjectCustomScript[]>(() => task?.project?.custom_scripts || []);

  useEffect(() => {
    if (task?.project?.custom_scripts) {
      setScripts(task.project.custom_scripts);
    }
  }, [task?.project?.custom_scripts]);

  useEffect(() => {
    if (!taskId) {
      setError('Task ID is missing');
      setLoading(false);
      return;
    }

    // Only display full-page loading placeholder if we do not already have cached task
    if (!task) {
      setLoading(true);
    }
    setError(null);

    getTask(taskId)
      .then((t) => {
        setTask(t);
        setCachedTask(t);
        // Canonicalize URL to /projects/:projectId/tasks/:taskId if reached via /tasks/:taskId
        if (!routeProjectId && t.project_id) {
          navigate(`/projects/${t.project_id}/tasks/${taskId}`, { replace: true, state: { task: t } });
        }
      })
      .catch((err) => {
        if (!task) {
          setError(err?.message || 'Task not found');
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, [taskId, routeProjectId, navigate]);

  useEffect(() => {
    const handleTaskUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<Task>;
      if (customEvent.detail && customEvent.detail.id === taskId) {
        setTask(customEvent.detail);
      }
    };
    window.addEventListener('task-updated', handleTaskUpdated);
    return () => window.removeEventListener('task-updated', handleTaskUpdated);
  }, [taskId]);

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <p className="text-rose-400 text-sm mb-4">{error}</p>
        <button
          onClick={() => {
            const target = routeProjectId || task?.project_id;
            if (target) navigate(`/projects/${target}`);
            else navigate('/');
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white transition-all shadow-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Project</span>
        </button>
      </div>
    );
  }

  if (loading || !task) {
    return (
      <div className="flex-1 flex items-center justify-center text-cozy-muted text-sm">
        Loading task workspace...
      </div>
    );
  }

  return (
    <ScriptExecutionProvider taskId={task.id} projectId={task.project_id} ws={ws}>
      <div className="flex-1 flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden relative">
        <DraggableSplit
          left={
            <ChatPane
              task={task}
              settings={settings}
              clis={clis}
              ws={ws}
              onOpenRebase={() => setIsRebaseOpen(true)}
              onOpenSubmit={() => setIsSubmitOpen(true)}
              onOpenScripts={() => setIsRunScriptOpen(true)}
            />
          }
          right={<PreviewPane task={task} ws={ws} />}
        />

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
          task={task}
          isOpen={isRebaseOpen}
          onClose={() => setIsRebaseOpen(false)}
          ws={ws}
        />

        {/* Submit Changes Modal */}
        <SubmitModal
          task={task}
          isOpen={isSubmitOpen}
          onClose={() => setIsSubmitOpen(false)}
          ws={ws}
        />
      </div>
    </ScriptExecutionProvider>
  );
};
