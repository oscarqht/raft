import React, { useState, useEffect } from 'react';
import { Task, Settings, CliInfo } from '../types';
import { getTask } from '../api';
import { DraggableSplit } from '../components/DraggableSplit';
import { ChatPane } from '../components/ChatPane';
import { PreviewPane } from '../components/PreviewPane';
import { RebaseDrawer } from '../components/RebaseDrawer';
import { SubmitModal } from '../components/SubmitModal';

interface TaskPageProps {
  taskId: string;
  settings: Settings | null;
  clis: CliInfo[];
  ws: WebSocket | null;
}

export const TaskPage: React.FC<TaskPageProps> = ({
  taskId,
  settings,
  clis,
  ws,
}) => {
  const [task, setTask] = useState<Task | null>(null);
  const [isRebaseOpen, setIsRebaseOpen] = useState(false);
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);

  useEffect(() => {
    getTask(taskId)
      .then(setTask)
      .catch(() => {});
  }, [taskId]);

  if (!task) {
    return (
      <div className="flex-1 flex items-center justify-center text-cozy-muted text-sm">
        Loading task workspace...
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden">
      <DraggableSplit
        left={
          <ChatPane
            task={task}
            settings={settings}
            clis={clis}
            ws={ws}
            onOpenRebase={() => setIsRebaseOpen(true)}
            onOpenSubmit={() => setIsSubmitOpen(true)}
          />
        }
        right={<PreviewPane task={task} ws={ws} />}
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
  );
};
