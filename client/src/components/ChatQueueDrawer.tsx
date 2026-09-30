import React, { useState } from 'react';
import { Zap, Pencil, Trash2, Check, X, Clock, Paperclip, ChevronDown, ChevronUp } from 'lucide-react';
import { QueuedMessage } from '../types';

interface ChatQueueDrawerProps {
  queue: QueuedMessage[];
  onSteer: (item: QueuedMessage) => void;
  onDelete: (id: string) => void;
  onUpdatePrompt: (id: string, newPrompt: string) => void;
}

export const ChatQueueDrawer: React.FC<ChatQueueDrawerProps> = ({
  queue,
  onSteer,
  onDelete,
  onUpdatePrompt,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (queue.length === 0) return null;

  const handleStartEdit = (item: QueuedMessage) => {
    setEditingId(item.id);
    setEditPrompt(item.prompt);
  };

  const handleSaveEdit = (id: string) => {
    if (editPrompt.trim()) {
      onUpdatePrompt(id, editPrompt.trim());
    }
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditPrompt('');
  };

  return (
    <div className="mb-2 w-full rounded-2xl border border-teal-500/20 bg-cozy-surface/95 dark:bg-[#1f1f1f]/95 shadow-lg backdrop-blur-md overflow-hidden transition-all duration-200">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-cozy-border/60 bg-teal-500/5 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-md bg-teal-500/15 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
            <Clock className="w-3.5 h-3.5 animate-pulse" />
          </div>
          <span className="text-xs font-semibold text-cozy-text flex items-center gap-1.5">
            <span>Queued Messages</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-teal-500/20 text-teal-600 dark:text-teal-300 font-bold">
              {queue.length}
            </span>
          </span>
          <span className="text-[11px] text-cozy-muted hidden sm:inline truncate">
            (Auto-dispatches after current reply finishes)
          </span>
        </div>

        <button
          type="button"
          onClick={() => setIsCollapsed((prev) => !prev)}
          className="text-cozy-muted hover:text-cozy-text p-1 rounded-md hover:bg-cozy-subtle transition-colors"
          title={isCollapsed ? 'Expand queue' : 'Collapse queue'}
        >
          {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>

      {/* Message Items List */}
      {!isCollapsed && (
        <div className="max-h-56 overflow-y-auto divide-y divide-cozy-border/40 p-1.5 space-y-1 scrollbar-thin">
          {queue.map((item, index) => {
            const isEditing = editingId === item.id;
            const hasAttachments = item.attachments && item.attachments.length > 0;

            return (
              <div
                key={item.id}
                className="group flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-2 rounded-xl bg-cozy-subtle/50 hover:bg-cozy-subtle border border-cozy-border/50 transition-colors"
              >
                {/* Left: Index badge & Content */}
                <div className="flex items-start gap-2.5 flex-1 min-w-0">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-cozy-surface text-cozy-muted border border-cozy-border shrink-0 mt-0.5">
                    #{index + 1}
                  </span>

                  {isEditing ? (
                    <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                      <textarea
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                        rows={2}
                        className="w-full text-xs bg-cozy-surface border border-teal-500 rounded-lg p-2 text-cozy-text focus:outline-none resize-none leading-relaxed"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            handleSaveEdit(item.id);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            handleCancelEdit();
                          }
                        }}
                      />
                      <div className="flex items-center gap-1.5 justify-end">
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          className="px-2 py-0.5 rounded text-[11px] font-medium text-cozy-muted hover:text-cozy-text hover:bg-cozy-surface border border-cozy-border transition-colors flex items-center gap-1"
                        >
                          <X className="w-3 h-3" />
                          <span>Cancel</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(item.id)}
                          className="px-2 py-0.5 rounded text-[11px] font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors flex items-center gap-1"
                        >
                          <Check className="w-3 h-3" />
                          <span>Save</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-cozy-text line-clamp-2 leading-relaxed break-words whitespace-pre-wrap">
                        {item.prompt}
                      </p>
                      {hasAttachments && (
                        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-teal-600 dark:text-teal-400 font-medium">
                          <Paperclip className="w-3 h-3" />
                          <span>
                            {item.attachments!.length} attachment
                            {item.attachments!.length > 1 ? 's' : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right Actions: Steer, Edit, Delete */}
                {!isEditing && (
                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                    {/* Steer Button */}
                    <button
                      type="button"
                      onClick={() => onSteer(item)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-teal-500/10 hover:bg-teal-600 text-teal-600 dark:text-teal-400 hover:text-white border border-teal-500/30 hover:border-transparent transition-all shadow-xs cursor-pointer group/steer"
                      title="Interrupt agent and send this message immediately"
                    >
                      <Zap className="w-3.5 h-3.5 fill-current text-teal-500 group-hover/steer:text-white transition-colors" />
                      <span>Steer</span>
                    </button>

                    {/* Edit Button */}
                    <button
                      type="button"
                      onClick={() => handleStartEdit(item)}
                      className="p-1.5 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-surface border border-transparent hover:border-cozy-border transition-colors cursor-pointer"
                      title="Edit queued message"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>

                    {/* Delete Button */}
                    <button
                      type="button"
                      onClick={() => onDelete(item.id)}
                      className="p-1.5 rounded-lg text-cozy-muted hover:text-red-500 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors cursor-pointer"
                      title="Remove from queue"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
