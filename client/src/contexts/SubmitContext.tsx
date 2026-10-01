import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Task, GitStatus } from '../types';
import { getTaskGitStatus, generateTaskCommitMessage } from '../api';
import { setCachedTaskGitStatus } from '../cache';
import { SubmitModal } from '../components/SubmitModal';
import { SubmitDock } from '../components/SubmitDock';

export interface SubmitJob {
  task: Task;
  status: 'preparing' | 'submitting' | 'done' | 'error';
  logs: string[];
  createdAt: number;
  gitStatus?: GitStatus;
}

interface SubmitContextType {
  jobs: Record<string, SubmitJob>;
  modalTask: Task | null;
  openSubmit: (task: Task) => void;
  quickSubmit: (task: Task) => void;
  closeSubmit: () => void;
  startSubmit: (task: Task, commitMessage: string) => void;
  dismissJob: (taskId: string) => void;
}

const SubmitContext = createContext<SubmitContextType | null>(null);

export const SubmitProvider: React.FC<{ ws: WebSocket | null; children: React.ReactNode }> = ({ ws, children }) => {
  const [jobs, setJobs] = useState<Record<string, SubmitJob>>({});
  const [modalTask, setModalTask] = useState<Task | null>(null);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const updateJob = useCallback((taskId: string, patch: (job: SubmitJob) => Partial<SubmitJob>) => {
    setJobs((prev) => (prev[taskId] ? { ...prev, [taskId]: { ...prev[taskId], ...patch(prev[taskId]) } } : prev));
  }, []);

  const markDone = useCallback((taskId: string) => {
    const job = jobsRef.current[taskId];
    if (!job || job.status === 'done') return;
    updateJob(taskId, () => ({ status: 'done' }));
    getTaskGitStatus(taskId, true)
      .then((s) => {
        updateJob(taskId, () => ({ gitStatus: s }));
        setCachedTaskGitStatus(taskId, s, job.task.project_id);
        window.dispatchEvent(new CustomEvent('task-status-updated', { detail: { taskId, status: s } }));
      })
      .catch(() => {
        window.dispatchEvent(new CustomEvent('task-status-updated', { detail: { taskId } }));
      });
  }, [updateJob]);

  useEffect(() => {
    if (!ws) return;
    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== 'submit_event' || !msg.taskId) return;
        const taskId: string = msg.taskId;
        const ev = msg.event;
        const job = jobsRef.current[taskId];
        if (!job || job.status === 'done' || job.status === 'error') return;
        if (ev.content) {
          updateJob(taskId, (j) => ({ logs: [...j.logs, ev.content] }));
        }
        if (ev.type === 'done') {
          markDone(taskId);
        } else if (ev.type === 'error') {
          updateJob(taskId, () => ({ status: 'error' }));
        }
      } catch {}
    };
    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws, updateJob, markDone]);

  // After a reconnect, ask the server to re-attach to (or replay the result of) in-flight submits.
  useEffect(() => {
    if (!ws) return;
    const resume = () => {
      for (const job of Object.values(jobsRef.current)) {
        if (job.status === 'submitting') {
          ws.send(JSON.stringify({ type: 'submit_resume', taskId: job.task.id }));
        }
      }
    };
    if (ws.readyState === WebSocket.OPEN) resume();
    ws.addEventListener('open', resume);
    return () => ws.removeEventListener('open', resume);
  }, [ws]);

  // Safety net: if the completion event never arrives (socket dropped, server restarted),
  // infer success from the actual repo state so the job can't stay "submitting" forever.
  const hasSubmitting = Object.values(jobs).some((j) => j.status === 'submitting');
  useEffect(() => {
    if (!hasSubmitting) return;
    const timer = setInterval(() => {
      for (const job of Object.values(jobsRef.current)) {
        if (job.status !== 'submitting' || Date.now() - job.createdAt < 10_000) continue;
        const taskId = job.task.id;
        getTaskGitStatus(taskId, true)
          .then((s) => {
            const current = jobsRef.current[taskId];
            if (!current || current.status !== 'submitting') return;
            const dirty = s.staged.length + s.unstaged.length + s.untracked.length;
            if (dirty === 0 && (s.unpushedCount || 0) === 0) markDone(taskId);
          })
          .catch(() => {});
      }
    }, 8_000);
    return () => clearInterval(timer);
  }, [hasSubmitting, markDone]);

  const startSubmit = useCallback(
    (task: Task, commitMessage: string) => {
      if (!ws) return;
      setJobs((prev) => ({ ...prev, [task.id]: { task, status: 'submitting', logs: [], createdAt: Date.now() } }));
      ws.send(JSON.stringify({ type: 'start_submit', taskId: task.id, commitMessage }));
    },
    [ws]
  );

  const dismissJob = useCallback((taskId: string) => {
    setJobs((prev) => {
      const { [taskId]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  // Tasks whose background "preparing" run must not auto-commit (user restored the dialog)
  const cancelledPrepRef = useRef<Set<string>>(new Set());
  const modalTaskRef = useRef(modalTask);
  modalTaskRef.current = modalTask;

  const openSubmit = useCallback((task: Task) => {
    if (jobsRef.current[task.id]?.status === 'preparing') {
      cancelledPrepRef.current.add(task.id);
      dismissJob(task.id);
    }
    setModalTask(task);
  }, [dismissJob]);

  // Minimized submit: generate the commit message in the background, then commit & push
  // automatically unless the user restored the dialog in the meantime.
  const quickSubmit = useCallback(
    (task: Task) => {
      const existing = jobsRef.current[task.id];
      if (!ws || existing?.status === 'preparing' || existing?.status === 'submitting') return;
      cancelledPrepRef.current.delete(task.id);
      setJobs((prev) => ({ ...prev, [task.id]: { task, status: 'preparing', logs: [], createdAt: Date.now() } }));
      const isCancelled = () => cancelledPrepRef.current.has(task.id) || modalTaskRef.current?.id === task.id;
      const abort = () => {
        if (!cancelledPrepRef.current.has(task.id)) dismissJob(task.id);
        cancelledPrepRef.current.delete(task.id);
      };
      (async () => {
        try {
          const status = await getTaskGitStatus(task.id, true);
          if (isCancelled()) return abort();
          const total = status.staged.length + status.unstaged.length + status.untracked.length;
          let message = '';
          if (total > 0) {
            const res = await generateTaskCommitMessage(task.id);
            if (isCancelled()) return abort();
            const title = res.title?.trim();
            const details = res.details?.trim();
            message = title ? (details ? `${title}\n\n${details}` : title) : '';
            if (!message) message = task.name ? `feat(${task.name}): implement updates` : `feat(${task.branch || 'task'}): implement updates`;
          } else if ((status.unpushedCount || 0) === 0) {
            return abort();
          }
          startSubmit(task, message);
        } catch (err) {
          console.error('Quick submit failed:', err);
          updateJob(task.id, () => ({ status: 'error', logs: [String((err as Error)?.message || err)] }));
        }
      })();
    },
    [ws, startSubmit, dismissJob, updateJob]
  );
  const closeSubmit = useCallback(() => setModalTask(null), []);

  return (
    <SubmitContext.Provider value={{ jobs, modalTask, openSubmit, quickSubmit, closeSubmit, startSubmit, dismissJob }}>
      {children}
      <SubmitDock />
      {modalTask && (
        <SubmitModal
          key={`submit-${modalTask.project_id}-${modalTask.id}`}
          task={modalTask}
          isOpen
          onClose={closeSubmit}
        />
      )}
    </SubmitContext.Provider>
  );
};

export function useSubmit(): SubmitContextType {
  const ctx = useContext(SubmitContext);
  if (!ctx) throw new Error('useSubmit must be used within a SubmitProvider');
  return ctx;
}
