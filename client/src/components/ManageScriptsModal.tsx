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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="bg-cozy-surface border border-cozy-border rounded-xl shadow-2xl flex flex-col w-full max-w-xl max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-cozy-border bg-cozy-subtle/40">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-semibold text-cozy-text">Manage Project Scripts</h2>
          </div>
          <button
            type="button"
            className="p-1 rounded-md text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          <p className="text-xs text-cozy-muted leading-relaxed">
            Configure reusable terminal commands for this project (e.g. dev server, build commands, test runners).
            These scripts can be executed directly from any task workspace.
          </p>

          {error && (
            <div className="flex items-center gap-2 p-3 text-xs bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Form when adding or editing */}
          {editingId ? (
            <div className="p-4 bg-cozy-subtle/60 border border-sky-500/30 rounded-lg space-y-3">
              <div className="text-xs font-semibold text-cozy-text">
                {editingId === 'new' ? 'Add New Script' : 'Edit Script'}
              </div>
              <div>
                <label className="block text-[11px] font-medium text-cozy-muted mb-1">
                  Script Name (e.g. "Dev Server", "Build")
                </label>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="e.g. App Dev Server"
                  className="w-full px-3 py-1.5 text-xs bg-cozy-surface border border-cozy-border rounded-md text-cozy-text placeholder:text-cozy-muted/60 focus:outline-none focus:border-sky-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-cozy-muted mb-1">
                  Command
                </label>
                <input
                  type="text"
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  placeholder="e.g. npm run app:dev"
                  className="w-full px-3 py-1.5 text-xs font-mono bg-cozy-surface border border-cozy-border rounded-md text-cozy-text placeholder:text-cozy-muted/60 focus:outline-none focus:border-sky-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveItem();
                    }
                  }}
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle rounded-md transition-colors"
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-sky-500 hover:bg-sky-600 rounded-md transition-colors disabled:opacity-50"
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
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-sky-500 hover:bg-sky-600 rounded-md shadow-sm transition-colors"
                onClick={handleStartAdd}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Script</span>
              </button>
            </div>
          )}

          {/* List of scripts */}
          <div className="space-y-2">
            {items.length === 0 && !editingId ? (
              <div className="text-center py-8 text-xs text-cozy-muted border border-dashed border-cozy-border rounded-lg">
                No scripts added yet. Click "Add Script" to define your first reusable command.
              </div>
            ) : (
              items.map((script) => (
                <div
                  key={script.id}
                  className="flex items-center justify-between p-3 bg-cozy-subtle/30 border border-cozy-border rounded-lg group hover:border-cozy-border/80 transition-all"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="font-medium text-xs text-cozy-text truncate">
                      {script.name}
                    </div>
                    <div className="text-[11px] font-mono text-cozy-muted truncate mt-0.5">
                      {script.command}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      className="p-1.5 text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle rounded-md transition-colors"
                      onClick={() => handleStartEdit(script)}
                      title="Edit script"
                      disabled={isSaving || editingId !== null}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className="p-1.5 text-cozy-muted hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors"
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
        <div className="flex justify-end px-5 py-3 border-t border-cozy-border bg-cozy-subtle/20">
          <button
            type="button"
            className="px-4 py-1.5 text-xs font-medium text-cozy-text hover:bg-cozy-subtle rounded-md border border-cozy-border transition-colors"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
