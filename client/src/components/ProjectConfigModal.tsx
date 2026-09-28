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
  Smile,
  FileText,
  RotateCcw,
} from 'lucide-react';
import { Settings, Project, ProjectCustomScript } from '../types';
import { updateProject, validateProjectPath, createWebSocketConnection } from '../api';
import { ProjectEmojiPicker } from './ProjectEmojiPicker';

export type ProjectConfigTab = 'settings' | 'system_prompt' | 'scripts';

const renderInlineMarkdown = (text: string): React.ReactNode => {
  if (!text) return null;

  // Match inline tokens: inline code, bold, italic, links, strikethrough
  const tokenRegex = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]*\]\([^)\n]*\)|~~[^~\n]+~~)/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, i) => {
    if (!part) return null;

    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <span key={i} className="text-teal-600 dark:text-teal-300 bg-teal-500/10 px-1 py-0.5 rounded font-mono">
          {part}
        </span>
      );
    }
    if ((part.startsWith('**') && part.endsWith('**') && part.length >= 4) ||
        (part.startsWith('__') && part.endsWith('__') && part.length >= 4)) {
      return (
        <span key={i} className="font-bold text-amber-600 dark:text-amber-300">
          {part}
        </span>
      );
    }
    if ((part.startsWith('*') && part.endsWith('*') && part.length >= 2) ||
        (part.startsWith('_') && part.endsWith('_') && part.length >= 2)) {
      return (
        <span key={i} className="italic text-purple-600 dark:text-purple-300">
          {part}
        </span>
      );
    }
    if (/^\[.*\]\(.*\)$/.test(part)) {
      return (
        <span key={i} className="text-sky-500 dark:text-sky-400 underline decoration-sky-400/50">
          {part}
        </span>
      );
    }
    if (part.startsWith('~~') && part.endsWith('~~') && part.length >= 4) {
      return (
        <span key={i} className="line-through text-cozy-muted">
          {part}
        </span>
      );
    }

    return <span key={i} className="text-cozy-text">{part}</span>;
  });
};

const renderMarkdownLine = (line: string): React.ReactNode => {
  if (line.trim().startsWith('```')) {
    return (
      <span className="font-bold text-teal-600 dark:text-teal-400 bg-teal-500/10 px-1 py-0.5 rounded font-mono">
        {line}
      </span>
    );
  }

  const headingMatch = line.match(/^(#{1,6}\s+)(.*)$/);
  if (headingMatch) {
    return (
      <>
        <span className="font-bold text-teal-600 dark:text-teal-400">
          {headingMatch[1]}
        </span>
        <span className="font-bold text-cozy-text">
          {renderInlineMarkdown(headingMatch[2])}
        </span>
      </>
    );
  }

  const quoteMatch = line.match(/^(>\s*)(.*)$/);
  if (quoteMatch) {
    return (
      <>
        <span className="text-emerald-500 font-bold">{quoteMatch[1]}</span>
        <span className="text-emerald-600 dark:text-emerald-400 italic">
          {renderInlineMarkdown(quoteMatch[2])}
        </span>
      </>
    );
  }

  const bulletMatch = line.match(/^(\s*[-*+]\s+)(.*)$/);
  if (bulletMatch) {
    return (
      <>
        <span className="text-teal-500 font-bold">{bulletMatch[1]}</span>
        <span>{renderInlineMarkdown(bulletMatch[2])}</span>
      </>
    );
  }

  const numMatch = line.match(/^(\s*\d+\.\s+)(.*)$/);
  if (numMatch) {
    return (
      <>
        <span className="text-teal-500 font-bold">{numMatch[1]}</span>
        <span>{renderInlineMarkdown(numMatch[2])}</span>
      </>
    );
  }

  if (/^(\s*---|\s*\*\*\*|\s*___)\s*$/.test(line)) {
    return <span className="text-cozy-muted font-bold">{line}</span>;
  }

  return renderInlineMarkdown(line);
};

const renderMarkdownSyntax = (text: string): React.ReactNode => {
  if (!text) {
    return (
      <span className="text-cozy-muted/40 italic">
        Write project system prompt here in Markdown...
      </span>
    );
  }

  const lines = text.split('\n');
  return lines.map((line, idx) => {
    const isLast = idx === lines.length - 1;
    return (
      <React.Fragment key={idx}>
        {renderMarkdownLine(line)}
        {!isLast && '\n'}
      </React.Fragment>
    );
  });
};

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
  const [icon, setIcon] = useState(project.icon || '📦');
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
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

  const [activeTab, setActiveTab] = useState<ProjectConfigTab>('settings');
  const [systemPrompt, setSystemPrompt] = useState(project.system_prompt || '');
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const promptHighlightRef = useRef<HTMLPreElement>(null);

  const handlePromptScroll = () => {
    if (promptTextareaRef.current && promptHighlightRef.current) {
      promptHighlightRef.current.scrollTop = promptTextareaRef.current.scrollTop;
      promptHighlightRef.current.scrollLeft = promptTextareaRef.current.scrollLeft;
    }
  };

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
    setIcon(project.icon || '📦');
    setIsEmojiPickerOpen(false);
    setBranchConvention(project.branch_convention || 'main');
    setDevCmd(project.dev_cmd || 'npm run dev');
    setDevPort(project.dev_port || 5173);
    setBuildCmd(project.build_cmd || 'npm run build');
    setTestCmd(project.test_cmd || 'npm test');
    setInstallCmd(project.install_cmd || 'npm install');
    setCustomScripts(project.custom_scripts || []);
    setSystemPrompt(project.system_prompt || '');
    setActiveTab('settings');
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
        icon: icon || '📦',
        dev_cmd: devCmd.trim(),
        dev_port: devPort,
        build_cmd: buildCmd.trim(),
        test_cmd: testCmd.trim(),
        install_cmd: installCmd.trim(),
        custom_scripts: customScripts,
        system_prompt: systemPrompt,
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
        <div className="p-4 sm:p-5 border-b border-cozy-border/50 flex items-center justify-between bg-cozy-subtle/50 relative z-20">
          <div className="flex items-center space-x-3">
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsEmojiPickerOpen((prev) => !prev)}
                className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-teal-500/15 via-cyan-500/10 to-sky-500/15 border border-teal-400/25 hover:border-teal-400/50 flex items-center justify-center text-xl shadow-soft-sm shrink-0 cursor-pointer active:scale-95 transition-all group relative"
                title="Click to change project emoji icon"
              >
                <span>{icon || '📦'}</span>
                <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-teal-500 text-white flex items-center justify-center shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
                  <Smile className="w-2.5 h-2.5" />
                </span>
              </button>

              {isEmojiPickerOpen && (
                <div className="absolute top-full left-0 mt-2 z-50">
                  <ProjectEmojiPicker
                    onSelectEmoji={(selectedEmoji) => {
                      setIcon(selectedEmoji);
                      setIsEmojiPickerOpen(false);
                    }}
                    onClose={() => setIsEmojiPickerOpen(false)}
                  />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-cozy-text flex items-center gap-2">
                Project Configuration
                <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-cozy-subtle text-cozy-muted border border-cozy-border/70 shadow-soft-sm">
                  {name || project.name}
                </span>
              </h3>
              <p className="text-xs text-cozy-muted font-mono truncate max-w-md sm:max-w-lg mt-0.5" title={project.path}>
                {project.path}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-cozy-muted hover:text-teal-500 hover:bg-cozy-subtle transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center gap-2.5 text-xs text-red-500 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Tab Navigation */}
          <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-cozy-subtle/80 border border-cozy-border/70 shadow-soft-sm">
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'settings'
                  ? 'bg-teal-500 text-white shadow-soft-sm'
                  : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-surface'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Project Settings</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('system_prompt')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'system_prompt'
                  ? 'bg-teal-500 text-white shadow-soft-sm'
                  : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-surface'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>System Prompt</span>
              {systemPrompt.trim() && (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    activeTab === 'system_prompt' ? 'bg-white' : 'bg-teal-500'
                  }`}
                />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('scripts')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'scripts'
                  ? 'bg-teal-500 text-white shadow-soft-sm'
                  : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-surface'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Terminal Scripts</span>
              {customScripts.length > 0 && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold leading-none ${
                    activeTab === 'scripts'
                      ? 'bg-white/20 text-white'
                      : 'bg-cozy-surface text-cozy-muted border border-cozy-border/60'
                  }`}
                >
                  {customScripts.length}
                </span>
              )}
            </button>
          </div>

          {/* TAB 1: PROJECT SETTINGS */}
          {activeTab === 'settings' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* AI Auto-Discovery Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-teal-500/10 via-cyan-500/5 to-transparent border border-teal-400/20 text-xs shadow-soft-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-xl bg-teal-500/15 border border-teal-400/30 flex items-center justify-center shrink-0 text-teal-500">
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
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-teal-500/50 text-white cursor-wait"
                  >
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Scanning...</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={triggerDiscovery}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white transition-all shadow-glow-ocean cursor-pointer"
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

              </div>
            </div>
          )}

          {/* TAB 2: SYSTEM PROMPT */}
          {activeTab === 'system_prompt' && (
            <div className="space-y-3.5 animate-in fade-in duration-150">
              <div className="p-4 rounded-2xl bg-gradient-to-r from-teal-500/10 via-emerald-500/5 to-transparent border border-teal-400/20 text-xs shadow-soft-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start space-x-3">
                    <div className="w-8 h-8 rounded-xl bg-teal-500/15 border border-teal-400/30 flex items-center justify-center shrink-0 text-teal-500 mt-0.5">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-cozy-text text-xs">Project-Level System Prompt</h4>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-teal-500/15 text-teal-600 dark:text-teal-400 border border-teal-500/20">
                          Auto-injected on 1st message
                        </span>
                      </div>
                      <p className="text-[11px] text-cozy-muted mt-1 leading-relaxed">
                        These instructions are automatically prepended as project context on the first turn of each chat session in this project. Use this to establish architecture standards, coding rules, component patterns, or tech stack constraints.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Snippet Helpers */}
              <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-cozy-muted font-medium">Quick snippets:</span>
                  <button
                    type="button"
                    onClick={() => {
                      const snippet = '## Architecture Guidelines\n- Follow modular component structure\n- Keep components focused and single-purpose\n';
                      setSystemPrompt((prev) => (prev ? `${prev.trim()}\n\n${snippet}` : snippet));
                    }}
                    className="px-2.5 py-1 rounded-lg text-[11px] bg-cozy-subtle hover:bg-cozy-surface text-cozy-text border border-cozy-border/70 transition-colors cursor-pointer"
                  >
                    + Architecture
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const snippet = '## TypeScript & Code Quality\n- Strict TypeScript typing (avoid `any`)\n- Verify clean compile with zero linter errors\n';
                      setSystemPrompt((prev) => (prev ? `${prev.trim()}\n\n${snippet}` : snippet));
                    }}
                    className="px-2.5 py-1 rounded-lg text-[11px] bg-cozy-subtle hover:bg-cozy-surface text-cozy-text border border-cozy-border/70 transition-colors cursor-pointer"
                  >
                    + TypeScript
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const snippet = '## Testing\n- Write unit tests for new logic and edge cases\n- Verify tests pass before completing tasks\n';
                      setSystemPrompt((prev) => (prev ? `${prev.trim()}\n\n${snippet}` : snippet));
                    }}
                    className="px-2.5 py-1 rounded-lg text-[11px] bg-cozy-subtle hover:bg-cozy-surface text-cozy-text border border-cozy-border/70 transition-colors cursor-pointer"
                  >
                    + Tests
                  </button>
                </div>

                {systemPrompt && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('Clear the project system prompt?')) {
                        setSystemPrompt('');
                      }
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] text-cozy-muted hover:text-red-500 rounded transition-colors cursor-pointer"
                    title="Clear system prompt"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Clear</span>
                  </button>
                )}
              </div>

              {/* Markdown Syntax-Styled Editor */}
              <div className="relative w-full h-80 rounded-2xl bg-cozy-bg border border-cozy-border focus-within:border-teal-400 transition-colors overflow-hidden group shadow-inner">
                {/* Underlying Syntax-Highlighted Layer */}
                <pre
                  ref={promptHighlightRef}
                  aria-hidden="true"
                  className="absolute inset-0 m-0 w-full h-full p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words overflow-y-auto pointer-events-none select-none z-0 border border-transparent text-cozy-text"
                >
                  {renderMarkdownSyntax(systemPrompt)}
                </pre>

                {/* Editable Transparent Textarea Overlay */}
                <textarea
                  ref={promptTextareaRef}
                  onScroll={handlePromptScroll}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Write project system prompt in Markdown (e.g. ## Conventions, **rules**, `code`, etc.)..."
                  spellCheck={false}
                  className="absolute inset-0 w-full h-full p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words overflow-y-auto bg-transparent text-transparent caret-teal-500 dark:caret-teal-400 focus:outline-none resize-none z-10 selection:bg-teal-500/25 selection:text-transparent border border-transparent placeholder:text-cozy-muted/40"
                />
              </div>

              {/* Editor Metadata Footer */}
              <div className="flex items-center justify-between text-[11px] text-cozy-muted px-1">
                <div className="flex items-center gap-2">
                  <span>{systemPrompt.length} characters</span>
                  <span>•</span>
                  <span>{systemPrompt ? systemPrompt.split('\n').length : 0} lines</span>
                </div>
                <span className="flex items-center gap-1 text-teal-600 dark:text-teal-400">
                  <Sparkles className="w-3 h-3" />
                  <span>Markdown syntax rendered inline</span>
                </span>
              </div>
            </div>
          )}

          {/* TAB 3: TERMINAL SCRIPTS */}
          {activeTab === 'scripts' && (
            <div className="space-y-3.5 animate-in fade-in duration-150">
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
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-sky-500 hover:text-sky-400 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 rounded-xl transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Script</span>
                  </button>
                )}
              </div>

              {/* Editing script form */}
              {editingScriptId && (
                <div className="p-3.5 bg-cozy-subtle/60 border border-sky-500/30 rounded-2xl space-y-2.5 shadow-soft-sm">
                  <div className="text-xs font-semibold text-cozy-text">
                    {editingScriptId === 'new' ? 'New Script' : 'Edit Script'}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-cozy-muted mb-1">Display Name</label>
                      <input
                        type="text"
                        value={scriptNameInput}
                        onChange={(e) => setScriptNameInput(e.target.value)}
                        placeholder="e.g. Run Linter"
                        className="w-full bg-cozy-bg border border-cozy-border focus:border-sky-500 rounded-xl px-3 py-1.5 text-xs text-cozy-text focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-cozy-muted mb-1">Terminal Command</label>
                      <input
                        type="text"
                        value={scriptCmdInput}
                        onChange={(e) => setScriptCmdInput(e.target.value)}
                        placeholder="e.g. npm run lint"
                        className="w-full bg-cozy-bg border border-cozy-border focus:border-sky-500 rounded-xl px-3 py-1.5 text-xs font-mono text-cozy-text focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setEditingScriptId(null)}
                      className="px-3 py-1 text-xs text-cozy-muted hover:text-cozy-text bg-cozy-surface rounded-lg border border-cozy-border cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!scriptNameInput.trim() || !scriptCmdInput.trim()}
                      onClick={() => {
                        if (!scriptNameInput.trim() || !scriptCmdInput.trim()) return;
                        if (editingScriptId === 'new') {
                          const newScript: ProjectCustomScript = {
                            id: `script_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                            name: scriptNameInput.trim(),
                            command: scriptCmdInput.trim(),
                          };
                          setCustomScripts((prev) => [...prev, newScript]);
                        } else {
                          setCustomScripts((prev) =>
                            prev.map((s) =>
                              s.id === editingScriptId
                                ? { ...s, name: scriptNameInput.trim(), command: scriptCmdInput.trim() }
                                : s
                            )
                          );
                        }
                        setEditingScriptId(null);
                        setScriptNameInput('');
                        setScriptCmdInput('');
                      }}
                      className="px-3 py-1 text-xs font-semibold text-white bg-sky-500 hover:bg-sky-600 disabled:opacity-40 rounded-lg cursor-pointer transition-colors"
                    >
                      Save Script
                    </button>
                  </div>
                </div>
              )}

              {/* Script list */}
              {customScripts.length === 0 && !editingScriptId ? (
                <div className="text-center py-8 px-4 rounded-2xl border border-dashed border-cozy-border bg-cozy-subtle/30 text-xs text-cozy-muted">
                  <Terminal className="w-6 h-6 mx-auto mb-2 opacity-40 text-sky-400" />
                  <p className="font-medium text-cozy-text">No custom terminal scripts defined yet</p>
                  <p className="text-[11px] mt-1 text-cozy-muted">
                    Add scripts to quickly run tests, linters, migrations, or builds from your task workspaces.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                  {customScripts.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-cozy-subtle/50 border border-cozy-border text-xs group hover:border-sky-500/30 transition-all"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <Terminal className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span className="font-medium text-cozy-text truncate">{s.name}</span>
                        <span className="text-[11px] font-mono text-cozy-muted truncate max-w-[200px] sm:max-w-xs">
                          {s.command}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingScriptId(s.id);
                            setScriptNameInput(s.name);
                            setScriptCmdInput(s.command);
                          }}
                          className="p-1 text-cozy-muted hover:text-cozy-text rounded hover:bg-cozy-subtle cursor-pointer"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCustomScripts((prev) => prev.filter((item) => item.id !== s.id));
                          }}
                          className="p-1 text-cozy-muted hover:text-red-500 rounded hover:bg-red-500/10 cursor-pointer"
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
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-cozy-border/50 bg-cozy-subtle/40 flex items-center justify-between">
          <div className="text-[11px] text-cozy-muted">
            {saveSuccess ? (
              <span className="text-emerald-400 flex items-center gap-1 font-medium">
                <Check className="w-3.5 h-3.5" /> Settings saved successfully!
              </span>
            ) : isScanning ? (
              <span className="text-teal-600 dark:text-teal-400 flex items-center gap-1.5 font-medium">
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
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white transition-all shadow-glow-ocean cursor-pointer"
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
