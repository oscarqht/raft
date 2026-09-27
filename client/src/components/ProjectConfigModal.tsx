import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Sparkles,
  Terminal,
  CheckCircle2,
  RefreshCw,
  FolderGit2,
  AlertCircle,
  GitBranch,
  Sliders,
  ChevronDown,
  ChevronUp,
  Save,
  Check,
  Plus,
  Trash2,
  Edit2,
  Package,
} from 'lucide-react';
import { Settings, Project, ProjectCustomScript } from '../types';
import { updateProject, validateProjectPath, createWebSocketConnection } from '../api';

export interface ProjectConfigModalProps {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updated: Project) => void;
  settings: Settings | null;
  ws: WebSocket | null;
  initialMode?: 'manual' | 'discover';
  availableBranches?: string[];
}

export const ProjectConfigModal: React.FC<ProjectConfigModalProps> = ({
  project,
  isOpen,
  onClose,
  onSuccess,
  settings,
  ws,
  initialMode = 'manual',
  availableBranches: propBranches,
}) => {
  const [name, setName] = useState(project.name);
  const [branchConvention, setBranchConvention] = useState(project.branch_convention || 'main');
  const [devCmd, setDevCmd] = useState(project.dev_cmd || 'npm run dev');
  const [devPort, setDevPort] = useState(project.dev_port || 5173);
  const [buildCmd, setBuildCmd] = useState(project.build_cmd || 'npm run build');
  const [testCmd, setTestCmd] = useState(project.test_cmd || 'npm test');
  const [installCmd, setInstallCmd] = useState(project.install_cmd || 'npm install');
  const [customScripts, setCustomScripts] = useState<ProjectCustomScript[]>(project.custom_scripts || []);
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [scriptNameInput, setScriptNameInput] = useState('');
  const [scriptCmdInput, setScriptCmdInput] = useState('');

  const [branches, setBranches] = useState<string[]>(propBranches || [project.branch_convention || 'main']);
  const [isCustomBranch, setIsCustomBranch] = useState(false);

  // AI Discovery states
  const [isScanning, setIsScanning] = useState(false);
  const [scanFailed, setScanFailed] = useState(false);
  const [scanCompleted, setScanCompleted] = useState(false);
  const [logText, setLogText] = useState('');
  const [showLogTerminal, setShowLogTerminal] = useState(initialMode === 'discover');
  const [changedFields, setChangedFields] = useState<Record<string, boolean>>({});

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const activeWsRef = useRef<WebSocket | null>(null);

  // Sync state when project changes or modal opens
  useEffect(() => {
    if (!isOpen) return;

    setName(project.name);
    setBranchConvention(project.branch_convention || 'main');
    setDevCmd(project.dev_cmd || 'npm run dev');
    setDevPort(project.dev_port || 5173);
    setBuildCmd(project.build_cmd || 'npm run build');
    setTestCmd(project.test_cmd || 'npm test');
    setInstallCmd(project.install_cmd || 'npm install');
    setCustomScripts(project.custom_scripts || []);
    setEditingScriptId(null);
    setScriptNameInput('');
    setScriptCmdInput('');
    setChangedFields({});
    setScanFailed(false);
    setScanCompleted(false);
    setErrorMessage(null);
    setSaveSuccess(false);

    // Fetch git branches if not available
    if (propBranches && propBranches.length > 0) {
      setBranches(propBranches);
      setIsCustomBranch(!propBranches.includes(project.branch_convention || 'main'));
    } else {
      validateProjectPath(project.path)
        .then((validation) => {
          if (validation.branches && validation.branches.length > 0) {
            setBranches(validation.branches);
            setIsCustomBranch(!validation.branches.includes(project.branch_convention || 'main'));
          } else {
            setBranches([project.branch_convention || 'main']);
          }
        })
        .catch(() => {
          setBranches([project.branch_convention || 'main']);
        });
    }

    if (initialMode === 'discover') {
      setShowLogTerminal(true);
      // Wait a moment for modal render, then start discovery
      const timer = setTimeout(() => {
        triggerDiscovery();
      }, 100);
      return () => clearTimeout(timer);
    } else {
      setShowLogTerminal(false);
    }
  }, [isOpen, project.id, initialMode]);

  const triggerDiscovery = () => {
    if (!project.path) return;

    setIsScanning(true);
    setScanFailed(false);
    setScanCompleted(false);
    setLogText('');
    setShowLogTerminal(true);
    setErrorMessage(null);

    const s = settingsRef.current;
    const payload = JSON.stringify({
      type: 'start_discovery',
      projectPath: project.path,
      agentCli: s?.agent_cli || project.default_agent_cli || 'agy',
      model: s?.default_model || project.default_model,
      thinkingEffort: s?.thinking_effort,
    });

    const setupSocketListener = (targetWs: WebSocket) => {
      const handleMessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'discovery_event') {
            const ev = msg.event;
            if (ev.content) {
              setLogText((prev) => {
                if (ev.type === 'thought' || ev.type === 'status') {
                  return prev ? `${prev.trimEnd()}\n${ev.content}` : ev.content;
                }
                return prev + ev.content;
              });
              if (
                ev.type === 'error' ||
                (typeof ev.content === 'string' && ev.content.toLowerCase().includes('error:'))
              ) {
                setScanFailed(true);
              }
            }
          } else if (msg.type === 'discovery_done') {
            setIsScanning(false);
            setScanCompleted(true);
            const res = msg.result || {};
            const newChanges: Record<string, boolean> = {};

            if (res.dev_cmd && res.dev_cmd !== devCmd) {
              setDevCmd(res.dev_cmd);
              newChanges.dev_cmd = true;
            }
            if (res.dev_port && res.dev_port !== devPort) {
              setDevPort(res.dev_port);
              newChanges.dev_port = true;
            }
            if (res.build_cmd && res.build_cmd !== buildCmd) {
              setBuildCmd(res.build_cmd);
              newChanges.build_cmd = true;
            }
            if (res.test_cmd && res.test_cmd !== testCmd) {
              setTestCmd(res.test_cmd);
              newChanges.test_cmd = true;
            }
            if (res.install_cmd && res.install_cmd !== installCmd) {
              setInstallCmd(res.install_cmd);
              newChanges.install_cmd = true;
            }
            if (res.branch_convention && res.branch_convention !== branchConvention) {
              setBranchConvention(res.branch_convention);
              newChanges.branch_convention = true;
              setBranches((prev) =>
                prev.includes(res.branch_convention) ? prev : [...prev, res.branch_convention]
              );
            }

            setChangedFields(newChanges);
          } else if (msg.type === 'error') {
            setIsScanning(false);
            setScanFailed(true);
            setLogText((prev) => `${prev}\nError: ${msg.error || 'Discovery failed'}\n`);
          }
        } catch {}
      };

      targetWs.addEventListener('message', handleMessage);
      return () => targetWs.removeEventListener('message', handleMessage);
    };

    // Use passed websocket or fallback
    if (ws && ws.readyState === WebSocket.OPEN) {
      activeWsRef.current = ws;
      setupSocketListener(ws);
      ws.send(payload);
    } else {
      // Connect new websocket
      const localWs = createWebSocketConnection(() => {});
      activeWsRef.current = localWs;
      setupSocketListener(localWs);
      localWs.onopen = () => {
        localWs.send(payload);
      };
    }
  };

  useEffect(() => {
    if (showLogTerminal) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logText, showLogTerminal]);

  const handleSave = async () => {
    if (!name.trim()) {
      setErrorMessage('Project name is required');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const updated = await updateProject(project.id, {
        name: name.trim(),
        branch_convention: branchConvention.trim() || 'main',
        dev_cmd: devCmd.trim(),
        dev_port: devPort,
        build_cmd: buildCmd.trim(),
        test_cmd: testCmd.trim(),
        install_cmd: installCmd.trim(),
        custom_scripts: customScripts,
      });

      setSaveSuccess(true);
      setTimeout(() => {
        onSuccess(updated);
        onClose();
      }, 350);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to update project configuration');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-2xl rounded-squircle glass-panel border border-white/80 dark:border-white/10 shadow-soft-xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-cozy-border/50 flex items-center justify-between bg-cozy-subtle/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-rose-500/15 via-amber-500/10 to-sky-500/15 border border-rose-400/25 flex items-center justify-center text-rose-500 shadow-soft-sm shrink-0">
              <Sliders className="w-4 h-4 text-rose-500" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-cozy-text flex items-center gap-2">
                Project Configuration
                <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-cozy-subtle text-cozy-muted border border-cozy-border/70 shadow-soft-sm">
                  {project.name}
                </span>
              </h3>
              <p className="text-xs text-cozy-muted font-mono truncate max-w-md sm:max-w-lg mt-0.5" title={project.path}>
                {project.path}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-cozy-muted hover:text-rose-500 hover:bg-cozy-subtle transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center gap-2.5 text-xs text-rose-400 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* AI Auto-Discovery Card */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-rose-500/10 via-amber-500/5 to-transparent border border-rose-400/20 text-xs shadow-soft-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-xl bg-rose-500/15 border border-rose-400/30 flex items-center justify-center shrink-0 text-rose-500">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-semibold text-cozy-text text-xs">AI Auto-Discovery</h4>
                  <p className="text-[11px] text-cozy-muted">
                    Inspect repo scripts and files to auto-detect dev command, port, build tools & branch.
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                {isScanning ? (
                  <button
                    type="button"
                    disabled
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-rose-500/50 text-white cursor-wait"
                  >
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Scanning...</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={triggerDiscovery}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-rose-500 hover:bg-rose-600 text-white transition-all shadow-glow-peach cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{scanCompleted || scanFailed ? 'Re-scan with AI' : 'Run AI Discovery'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Discovery Status message */}
            {(isScanning || scanCompleted || scanFailed) && (
              <div className="mt-3 pt-2.5 border-t border-sky-500/10 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  {isScanning ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin text-sky-400" />
                      <span className="text-sky-300">AI Agent is analyzing repository in real-time...</span>
                    </>
                  ) : scanFailed ? (
                    <>
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-amber-300">Discovery completed with fallback values. Review below.</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">
                        Discovery complete! Updated fields are highlighted below.
                      </span>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowLogTerminal((prev) => !prev)}
                  className="flex items-center gap-1 text-cozy-muted hover:text-cozy-text transition-colors text-[11px]"
                >
                  <Terminal className="w-3 h-3 text-sky-400" />
                  <span>{showLogTerminal ? 'Hide Stream' : 'View Stream'}</span>
                  {showLogTerminal ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>
            )}
          </div>

          {/* Live Agent Terminal Stream */}
          {showLogTerminal && (
            <div className="rounded-xl border border-cozy-border bg-cozy-bg overflow-hidden flex flex-col h-40 animate-in fade-in">
              <div className="px-3 py-1.5 bg-cozy-subtle/70 border-b border-cozy-border flex items-center justify-between font-mono text-[11px] text-cozy-muted">
                <div className="flex items-center space-x-1.5">
                  <Terminal className="w-3 h-3 text-sky-400" />
                  <span>AI Discovery Terminal Stream</span>
                </div>
                {isScanning && (
                  <span className="flex items-center space-x-1 text-sky-400">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Analyzing...</span>
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-2.5 font-mono text-xs text-cozy-text leading-relaxed whitespace-pre-wrap select-text">
                {logText ? logText : <span className="text-cozy-muted">Waiting for AI agent discovery output...</span>}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}

          {/* Configuration Form */}
          <div className="space-y-3.5 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-cozy-text uppercase tracking-wider text-[11px]">
                Manual Project Settings
              </span>
              <span className="text-[11px] text-cozy-muted">Modify any field manually or use AI auto-discovery</span>
            </div>

            {/* Row 1: Project Name & Base Branch */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="text-xs font-medium text-cozy-text flex items-center justify-between mb-1">
                  <span>Project Name</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. my-awesome-project"
                  className="w-full bg-cozy-bg border border-cozy-border focus:border-sky-500 rounded-xl px-3.5 py-2 text-xs text-cozy-text focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-cozy-text flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5 text-sky-400" />
                    Base Branch Convention
                  </span>
                  {changedFields.branch_convention && (
                    <span className="text-[10px] text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded font-mono">
                      ✨ AI Updated
                    </span>
                  )}
                </label>

                {isCustomBranch ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={branchConvention}
                      onChange={(e) => setBranchConvention(e.target.value)}
                      placeholder="e.g. main"
                      className="flex-1 bg-cozy-bg border border-cozy-border focus:border-sky-500 rounded-xl px-3.5 py-2 text-xs font-mono text-cozy-text focus:outline-none transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setIsCustomBranch(false)}
                      className="text-[11px] text-sky-400 hover:underline px-2 py-1"
                    >
                      Pick list
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <select
                      value={branchConvention}
                      onChange={(e) => {
                        if (e.target.value === '__custom__') {
                          setIsCustomBranch(true);
                        } else {
                          setBranchConvention(e.target.value);
                        }
                      }}
                      className="flex-1 bg-cozy-bg border border-cozy-border focus:border-sky-500 rounded-xl px-3.5 py-2 text-xs font-mono text-cozy-text focus:outline-none transition-colors"
                    >
                      {branches.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                      <option value="__custom__">+ Custom branch...</option>
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Row 2: Dev Command & Port */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-cozy-text flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                    Dev Server Command
                  </span>
                  {changedFields.dev_cmd && (
                    <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded font-mono">
                      ✨ AI Updated
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={devCmd}
                  onChange={(e) => setDevCmd(e.target.value)}
                  placeholder="e.g. npm run dev or pnpm dev"
                  className={`w-full bg-cozy-bg border rounded-xl px-3.5 py-2 text-xs font-mono text-cozy-text focus:outline-none transition-colors ${
                    changedFields.dev_cmd ? 'border-emerald-500/50' : 'border-cozy-border focus:border-sky-500'
                  }`}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-cozy-text flex items-center justify-between mb-1">
                  <span>Dev Port</span>
                  {changedFields.dev_port && (
                    <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded font-mono">
                      ✨ AI Updated
                    </span>
                  )}
                </label>
                <input
                  type="number"
                  value={devPort}
                  onChange={(e) => setDevPort(parseInt(e.target.value, 10) || 5173)}
                  placeholder="5173"
                  className={`w-full bg-cozy-bg border rounded-xl px-3.5 py-2 text-xs font-mono text-cozy-text focus:outline-none transition-colors ${
                    changedFields.dev_port ? 'border-amber-500/50' : 'border-cozy-border focus:border-sky-500'
                  }`}
                />
              </div>
            </div>

            {/* Row 3: Build Command & Test Command */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="text-xs font-medium text-cozy-text flex items-center justify-between mb-1">
                  <span>Build Command</span>
                  {changedFields.build_cmd && (
                    <span className="text-[10px] text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded font-mono">
                      ✨ AI Updated
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={buildCmd}
                  onChange={(e) => setBuildCmd(e.target.value)}
                  placeholder="e.g. npm run build"
                  className={`w-full bg-cozy-bg border rounded-xl px-3.5 py-2 text-xs font-mono text-cozy-text focus:outline-none transition-colors ${
                    changedFields.build_cmd ? 'border-sky-500/50' : 'border-cozy-border focus:border-sky-500'
                  }`}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-cozy-text flex items-center justify-between mb-1">
                  <span>Test Command</span>
                  {changedFields.test_cmd && (
                    <span className="text-[10px] text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded font-mono">
                      ✨ AI Updated
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={testCmd}
                  onChange={(e) => setTestCmd(e.target.value)}
                  placeholder="e.g. npm test or vitest"
                  className={`w-full bg-cozy-bg border rounded-xl px-3.5 py-2 text-xs font-mono text-cozy-text focus:outline-none transition-colors ${
                    changedFields.test_cmd ? 'border-sky-500/50' : 'border-cozy-border focus:border-sky-500'
                  }`}
                />
              </div>
            </div>

            {/* Row 4: Dependency Install Command */}
            <div>
              <label className="text-xs font-medium text-cozy-text flex items-center justify-between mb-1">
                <span className="flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-indigo-400" />
                  Dependency Install Command
                </span>
                {changedFields.install_cmd && (
                  <span className="text-[10px] text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded font-mono">
                    ✨ AI Updated
                  </span>
                )}
              </label>
              <input
                type="text"
                value={installCmd}
                onChange={(e) => setInstallCmd(e.target.value)}
                placeholder="e.g. npm install, pnpm install, yarn install"
                className={`w-full bg-cozy-bg border rounded-xl px-3.5 py-2 text-xs font-mono text-cozy-text focus:outline-none transition-colors ${
                  changedFields.install_cmd ? 'border-indigo-500/50' : 'border-cozy-border focus:border-sky-500'
                }`}
              />
              <p className="text-[11px] text-cozy-muted mt-1">
                Automatically executed in isolated task worktrees before starting preview.
              </p>
            </div>

            {/* Custom Scripts Section */}
            <div className="pt-3 border-t border-cozy-border/60 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-cozy-text uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-sky-400" />
                    Project Terminal Scripts
                  </span>
                  <p className="text-[11px] text-cozy-muted">
                    Saved terminal commands that can be launched directly from any task workspace
                  </p>
                </div>
                {!editingScriptId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingScriptId('new');
                      setScriptNameInput('');
                      setScriptCmdInput('');
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-sky-400 hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 rounded-lg transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Script</span>
                  </button>
                )}
              </div>

              {/* Editing script form */}
              {editingScriptId && (
                <div className="p-3 bg-cozy-subtle/60 border border-sky-500/30 rounded-xl space-y-2.5">
                  <div className="text-xs font-semibold text-cozy-text">
                    {editingScriptId === 'new' ? 'New Script' : 'Edit Script'}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={scriptNameInput}
                      onChange={(e) => setScriptNameInput(e.target.value)}
                      placeholder="Script Name (e.g. Dev Server)"
                      className="px-3 py-1.5 text-xs bg-cozy-bg border border-cozy-border rounded-lg text-cozy-text focus:outline-none focus:border-sky-500"
                    />
                    <input
                      type="text"
                      value={scriptCmdInput}
                      onChange={(e) => setScriptCmdInput(e.target.value)}
                      placeholder="Command (e.g. npm run dev)"
                      className="px-3 py-1.5 text-xs font-mono bg-cozy-bg border border-cozy-border rounded-lg text-cozy-text focus:outline-none focus:border-sky-500"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const trimmedCmd = scriptCmdInput.trim();
                          if (!trimmedCmd) return;
                          const trimmedName = scriptNameInput.trim() || trimmedCmd;
                          if (editingScriptId === 'new') {
                            setCustomScripts((prev) => [
                              ...prev,
                              { id: `script-${Date.now()}`, name: trimmedName, command: trimmedCmd },
                            ]);
                          } else {
                            setCustomScripts((prev) =>
                              prev.map((s) =>
                                s.id === editingScriptId
                                  ? { ...s, name: trimmedName, command: trimmedCmd }
                                  : s
                              )
                            );
                          }
                          setEditingScriptId(null);
                          setScriptNameInput('');
                          setScriptCmdInput('');
                        }
                      }}
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setEditingScriptId(null)}
                      className="px-2.5 py-1 text-xs text-cozy-muted hover:text-cozy-text rounded-md"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const trimmedCmd = scriptCmdInput.trim();
                        if (!trimmedCmd) return;
                        const trimmedName = scriptNameInput.trim() || trimmedCmd;
                        if (editingScriptId === 'new') {
                          setCustomScripts((prev) => [
                            ...prev,
                            { id: `script-${Date.now()}`, name: trimmedName, command: trimmedCmd },
                          ]);
                        } else {
                          setCustomScripts((prev) =>
                            prev.map((s) =>
                              s.id === editingScriptId
                                ? { ...s, name: trimmedName, command: trimmedCmd }
                                : s
                            )
                          );
                        }
                        setEditingScriptId(null);
                        setScriptNameInput('');
                        setScriptCmdInput('');
                      }}
                      disabled={!scriptCmdInput.trim()}
                      className="px-3 py-1 text-xs font-medium text-white bg-sky-500 hover:bg-sky-600 rounded-md transition-colors disabled:opacity-50"
                    >
                      Save Script
                    </button>
                  </div>
                </div>
              )}

              {/* Script list */}
              {customScripts.length === 0 && !editingScriptId ? (
                <div className="text-center py-4 text-xs text-cozy-muted border border-dashed border-cozy-border rounded-xl">
                  No custom scripts saved yet.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {customScripts.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between p-2.5 bg-cozy-bg border border-cozy-border rounded-lg text-xs"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="font-medium text-cozy-text truncate">{s.name}</div>
                        <div className="text-[11px] font-mono text-cozy-muted truncate mt-0.5">{s.command}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingScriptId(s.id);
                            setScriptNameInput(s.name);
                            setScriptCmdInput(s.command);
                          }}
                          className="p-1 text-cozy-muted hover:text-cozy-text rounded hover:bg-cozy-subtle"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCustomScripts((prev) => prev.filter((item) => item.id !== s.id));
                          }}
                          className="p-1 text-cozy-muted hover:text-rose-400 rounded hover:bg-rose-500/10"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-cozy-border/50 bg-cozy-subtle/40 flex items-center justify-between">
          <div className="text-[11px] text-cozy-muted">
            {saveSuccess ? (
              <span className="text-emerald-400 flex items-center gap-1 font-medium">
                <Check className="w-3.5 h-3.5" /> Settings saved successfully!
              </span>
            ) : isScanning ? (
              <span className="text-rose-500 flex items-center gap-1.5 font-medium">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Running discovery agent...
              </span>
            ) : (
              <span>Changes take effect immediately on new tasks & dev servers.</span>
            )}
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-full text-xs font-medium bg-cozy-subtle hover:bg-cozy-surface text-cozy-text border border-cozy-border transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !name.trim()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white transition-all shadow-glow-peach cursor-pointer"
            >
              {saveSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Saved!</span>
                </>
              ) : isSaving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
