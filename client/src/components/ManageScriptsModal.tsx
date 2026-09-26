import React, { useState } from 'react';
import { X, Plus, Trash2, Edit2, Check, Terminal, AlertCircle } from 'lucide-react';
import { ProjectCustomScript } from '../types';
import { updateProjectScripts } from '../api';

interface ManageScriptsModalProps {
  projectId: string;
  scripts: ProjectCustomScript[];
  isOpen: boolean;
  onClose: () => void;
  onScriptsUpdated: (scripts: ProjectCustomScript[]) => void;
}

export const ManageScriptsModal: React.FC<ManageScriptsModalProps> = ({
  projectId,
  scripts,
  isOpen,
  onClose,
  onScriptsUpdated,
}) => {
  const [items, setItems] = useState<ProjectCustomScript[]>(scripts);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [commandInput, setCommandInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync items when opened or scripts prop changes
  React.useEffect(() => {
    setItems(scripts);
    setEditingId(null);
    setNameInput('');
    setCommandInput('');
    setError(null);
  }, [scripts, isOpen]);

  if (!isOpen) return null;

  const handleStartAdd = () => {
    setEditingId('new');
    setNameInput('');
    setCommandInput('');
    setError(null);
  };

  const handleStartEdit = (script: ProjectCustomScript) => {
    setEditingId(script.id);
    setNameInput(script.name);
    setCommandInput(script.command);
    setError(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setNameInput('');
    setCommandInput('');
    setError(null);
  };

  const handleSaveItem = async () => {
    if (!commandInput.trim()) {
      setError('Command cannot be empty');
      return;
    }

    const trimmedName = nameInput.trim() || commandInput.trim();
    const trimmedCommand = commandInput.trim();

    let nextItems: ProjectCustomScript[];
    if (editingId === 'new') {
      const newItem: ProjectCustomScript = {
        id: `script-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: trimmedName,
        command: trimmedCommand,
      };
      nextItems = [...items, newItem];
    } else {
      nextItems = items.map((item) =>
        item.id === editingId
          ? { ...item, name: trimmedName, command: trimmedCommand }
          : item
      );
    }

    setIsSaving(true);
    setError(null);
    try {
      const res = await updateProjectScripts(projectId, nextItems);
      setItems(res.scripts);
      onScriptsUpdated(res.scripts);
      setEditingId(null);
      setNameInput('');
      setCommandInput('');
    } catch (err: any) {
      setError(err.message || 'Failed to save scripts');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteItem = async (id: string) => {
    const nextItems = items.filter((item) => item.id !== id);
    setIsSaving(true);
    setError(null);
    try {
      const res = await updateProjectScripts(projectId, nextItems);
      setItems(res.scripts);
      onScriptsUpdated(res.scripts);
      if (editingId === id) {
        setEditingId(null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete script');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-xl max-h-[85vh] rounded-squircle glass-panel border border-white/80 dark:border-white/10 shadow-soft-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-cozy-border/50 bg-cozy-subtle/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-rose-500/15 via-amber-500/10 to-sky-500/15 border border-rose-400/25 flex items-center justify-center text-rose-500 shadow-soft-sm shrink-0">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-cozy-text">Manage Project Scripts</h2>
              <p className="text-xs text-cozy-muted mt-0.5">Configure reusable commands for this project</p>
            </div>
          </div>
          <button
            type="button"
            className="w-8 h-8 rounded-full flex items-center justify-center text-cozy-muted hover:text-rose-500 hover:bg-cozy-subtle transition-all"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 flex-1 overflow-y-auto space-y-4">
          <p className="text-xs text-cozy-muted leading-relaxed">
            Configure reusable terminal commands for this project (e.g. dev server, build commands, test runners).
            These scripts can be executed directly from any task workspace.
          </p>

          {error && (
            <div className="flex items-center gap-2 p-3.5 text-xs bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded-2xl shadow-soft-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Form when adding or editing */}
          {editingId ? (
            <div className="p-4 sm:p-5 bg-cozy-subtle/70 border border-rose-400/30 rounded-2xl space-y-3.5 shadow-soft-sm">
              <div className="text-xs font-semibold text-cozy-text">
                {editingId === 'new' ? 'Add New Script' : 'Edit Script'}
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-cozy-muted mb-1.5">
                  Script Name (e.g. "Dev Server", "Build")
                </label>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="e.g. App Dev Server"
                  className="w-full px-4 py-2.5 text-xs bg-cozy-surface/90 border border-cozy-border/80 rounded-2xl text-cozy-text placeholder:text-cozy-muted/60 focus:outline-none focus:border-rose-400 shadow-soft-sm"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-cozy-muted mb-1.5">
                  Command
                </label>
                <input
                  type="text"
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  placeholder="e.g. npm run app:dev"
                  className="w-full px-4 py-2.5 text-xs font-mono bg-cozy-surface/90 border border-cozy-border/80 rounded-2xl text-cozy-text placeholder:text-cozy-muted/60 focus:outline-none focus:border-rose-400 shadow-soft-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveItem();
                    }
                  }}
                />
              </div>
              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  className="px-4 py-2 rounded-full text-xs font-medium text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-all"
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold text-white bg-rose-500 hover:bg-rose-600 transition-all shadow-glow-peach disabled:opacity-50 cursor-pointer"
                  onClick={handleSaveItem}
                  disabled={isSaving}
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Saving...' : 'Save Script'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <button
                type="button"
                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-white bg-rose-500 hover:bg-rose-600 shadow-glow-peach transition-all cursor-pointer"
                onClick={handleStartAdd}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Script</span>
              </button>
            </div>
          )}

          {/* List of scripts */}
          <div className="space-y-2.5">
            {items.length === 0 && !editingId ? (
              <div className="text-center py-8 text-xs text-cozy-muted border border-dashed border-cozy-border/80 rounded-2xl bg-cozy-subtle/30">
                No scripts added yet. Click "Add Script" to define your first reusable command.
              </div>
            ) : (
              items.map((script) => (
                <div
                  key={script.id}
                  className="flex items-center justify-between p-3.5 bg-cozy-subtle/40 border border-cozy-border/70 rounded-2xl group hover:border-rose-400/30 hover:shadow-soft-sm transition-all"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="font-semibold text-xs text-cozy-text truncate">
                      {script.name}
                    </div>
                    <div className="text-[11px] font-mono text-cozy-muted truncate mt-0.5">
                      {script.command}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      className="w-8 h-8 rounded-full flex items-center justify-center text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-all"
                      onClick={() => handleStartEdit(script)}
                      title="Edit script"
                      disabled={isSaving || editingId !== null}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className="w-8 h-8 rounded-full flex items-center justify-center text-cozy-muted hover:text-rose-500 hover:bg-rose-500/10 transition-all"
                      onClick={() => handleDeleteItem(script.id)}
                      title="Delete script"
                      disabled={isSaving || editingId !== null}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end p-4 sm:p-5 border-t border-cozy-border/50 bg-cozy-subtle/40">
          <button
            type="button"
            className="px-5 py-2 text-xs font-medium text-cozy-text hover:bg-cozy-surface rounded-full border border-cozy-border transition-all shadow-soft-sm"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
