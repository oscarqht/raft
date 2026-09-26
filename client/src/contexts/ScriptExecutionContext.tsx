import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { ScriptExecutionItem, ScriptExecutionStatus } from '../types';
import {
  getScriptExecutions,
  runTaskScript,
  cancelScriptExecution,
  rerunScriptExecution,
  dismissScriptExecution,
} from '../api';

interface ScriptExecutionContextType {
  executions: ScriptExecutionItem[];
  activeModalExecution: ScriptExecutionItem | null;
  runScript: (params: {
    taskId: string;
    name?: string;
    command: string;
    saveToProject?: boolean;
  }) => Promise<ScriptExecutionItem>;
  cancelScript: (executionId: string, force?: boolean) => Promise<void>;
  rerunScript: (executionId: string) => Promise<void>;
  dismissExecution: (executionId: string) => Promise<void>;
  openModal: (executionId: string) => void;
  minimizeModal: () => void;
  closeModal: () => void;
}

const ScriptExecutionContext = createContext<ScriptExecutionContextType | null>(null);

function deduplicateExecutions(items: ScriptExecutionItem[]): ScriptExecutionItem[] {
  const map = new Map<string, ScriptExecutionItem>();
  for (const item of items) {
    if (!item || !item.id) continue;
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
    } else {
      map.set(item.id, {
        ...existing,
        ...item,
        output: (item.output?.length ?? 0) >= (existing.output?.length ?? 0) ? item.output : existing.output,
        isCanceling: item.isCanceling ?? existing.isCanceling,
      });
    }
  }
  return Array.from(map.values());
}

export const ScriptExecutionProvider: React.FC<{
  taskId?: string;
  projectId?: string;
  ws: WebSocket | null;
  children: React.ReactNode;
}> = ({ taskId, projectId, ws, children }) => {
  const [executions, setExecutions] = useState<ScriptExecutionItem[]>([]);
  const [activeModalId, setActiveModalId] = useState<string | null>(null);
  const dismissedIdsRef = React.useRef<Set<string>>(new Set());

  // Initial fetch of executions
  useEffect(() => {
    let isMounted = true;
    getScriptExecutions({ taskId, projectId })
      .then((data) => {
        if (isMounted && Array.isArray(data)) {
          const filtered = data.filter((e) => !dismissedIdsRef.current.has(e.id));
          setExecutions((prev) => deduplicateExecutions([...filtered, ...prev]));
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [taskId, projectId]);

  // Subscribe to WebSocket events
  useEffect(() => {
    if (!ws) return;

    const subscribe = () => {
      ws.send(JSON.stringify({ type: 'subscribe_scripts', taskId }));
    };

    if (ws.readyState === WebSocket.OPEN) {
      subscribe();
    } else {
      ws.addEventListener('open', subscribe, { once: true });
    }

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'script_executions_sync' && Array.isArray(msg.executions)) {
          setExecutions((prev) => {
            const valid = msg.executions.filter((e: ScriptExecutionItem) => !dismissedIdsRef.current.has(e.id));
            const localMap = new Map(prev.map((p) => [p.id, p]));
            const merged = valid.map((item: ScriptExecutionItem) => {
              const local = localMap.get(item.id);
              return local ? { ...item, isCanceling: local.isCanceling } : item;
            });
            return deduplicateExecutions(merged);
          });
        } else if (msg.type === 'script_log') {
          const { executionId, log } = msg;
          if (dismissedIdsRef.current.has(executionId)) return;
          setExecutions((prev) =>
            prev.map((item) =>
              item.id === executionId ? { ...item, output: item.output + log } : item
            )
          );
        } else if (msg.type === 'script_state' && msg.execution) {
          const updated: ScriptExecutionItem = msg.execution;
          if (dismissedIdsRef.current.has(updated.id)) return;
          setExecutions((prev) => {
            const exists = prev.some((e) => e.id === updated.id);
            if (!exists) {
              return deduplicateExecutions([updated, ...prev]);
            }
            return deduplicateExecutions(
              prev.map((e) => (e.id === updated.id ? { ...e, ...updated, isCanceling: false } : e))
            );
          });
        } else if (msg.type === 'script_dismissed' && msg.executionId) {
          const { executionId } = msg;
          dismissedIdsRef.current.add(executionId);
          setExecutions((prev) => prev.filter((e) => e.id !== executionId));
          setActiveModalId((curr) => (curr === executionId ? null : curr));
        }
      } catch {}
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws, taskId]);

  const runScript = useCallback(
    async (params: {
      taskId: string;
      name?: string;
      command: string;
      saveToProject?: boolean;
    }) => {
      const executionId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const tempItem: ScriptExecutionItem = {
        id: executionId,
        taskId: params.taskId,
        projectId: projectId || '',
        scriptName: params.name || params.command,
        command: params.command,
        status: 'running',
        output: `$ ${params.command}\n[Starting...]\n`,
        exitCode: null,
        startedAt: Date.now(),
        finishedAt: null,
      };

      setExecutions((prev) => deduplicateExecutions([tempItem, ...prev]));
      setActiveModalId(executionId);

      try {
        const result = await runTaskScript(params.taskId, {
          ...params,
          id: executionId,
        });
        setExecutions((prev) =>
          deduplicateExecutions(
            prev.map((e) => (e.id === executionId ? { ...e, ...result } : e))
          )
        );
        setActiveModalId((curr) => (curr === executionId ? result.id : curr));
        return result;
      } catch (err: any) {
        const failedItem: ScriptExecutionItem = {
          ...tempItem,
          status: 'failed',
          output: tempItem.output + `\n[Error starting process: ${err.message}]\n`,
          finishedAt: Date.now(),
        };
        setExecutions((prev) =>
          deduplicateExecutions(
            prev.map((e) => (e.id === executionId ? failedItem : e))
          )
        );
        throw err;
      }
    },
    [projectId]
  );

  const cancelScript = useCallback(async (executionId: string, force = false) => {
    setExecutions((prev) =>
      prev.map((e) => (e.id === executionId ? { ...e, isCanceling: true } : e))
    );
    try {
      await cancelScriptExecution(executionId, force);
    } catch {}
  }, []);

  const rerunScript = useCallback(async (executionId: string) => {
    try {
      const next = await rerunScriptExecution(executionId);
      setExecutions((prev) =>
        deduplicateExecutions(prev.map((e) => (e.id === executionId ? next : e)))
      );
      setActiveModalId(next.id);
    } catch {}
  }, []);

  const dismissExecution = useCallback(async (executionId: string) => {
    dismissedIdsRef.current.add(executionId);
    setExecutions((prev) => prev.filter((e) => e.id !== executionId));
    setActiveModalId((curr) => (curr === executionId ? null : curr));
    try {
      await dismissScriptExecution(executionId);
    } catch {}
  }, []);

  const openModal = useCallback((executionId: string) => {
    setActiveModalId(executionId);
  }, []);

  const minimizeModal = useCallback(() => {
    setActiveModalId(null);
  }, []);

  const closeModal = useCallback(() => {
    setActiveModalId(null);
  }, []);

  const activeModalExecution = useMemo(() => {
    if (!activeModalId) return null;
    return executions.find((e) => e.id === activeModalId) || null;
  }, [executions, activeModalId]);

  return (
    <ScriptExecutionContext.Provider
      value={{
        executions,
        activeModalExecution,
        runScript,
        cancelScript,
        rerunScript,
        dismissExecution,
        openModal,
        minimizeModal,
        closeModal,
      }}
    >
      {children}
    </ScriptExecutionContext.Provider>
  );
};

export function useScriptExecution(): ScriptExecutionContextType {
  const context = useContext(ScriptExecutionContext);
  if (!context) {
    throw new Error('useScriptExecution must be used within a ScriptExecutionProvider');
  }
  return context;
}
