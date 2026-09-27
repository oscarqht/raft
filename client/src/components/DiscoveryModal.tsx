import React, { useState, useEffect, useRef } from 'react';
import { X, Sparkles, Terminal, CheckCircle2, RefreshCw, FolderGit2, AlertCircle } from 'lucide-react';
import { Settings, Project } from '../types';
import { createProject } from '../api';

interface DiscoveryModalProps {
  projectPath: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (project: Project) => void;
  settings: Settings | null;
  ws: WebSocket | null;
}

export const DiscoveryModal: React.FC<DiscoveryModalProps> = ({
  projectPath,
  isOpen,
  onClose,
  onSuccess,
  settings,
  ws,
}) => {
  const [logText, setLogText] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanFailed, setScanFailed] = useState(false);
  const [discoveredData, setDiscoveredData] = useState<any>(null);
  const [name, setName] = useState('');
  const [devCmd, setDevCmd] = useState('npm run dev');
  const [devPort, setDevPort] = useState(5173);
  const [buildCmd, setBuildCmd] = useState('npm run build');
  const [testCmd, setTestCmd] = useState('npm test');
  const [branchConvention, setBranchConvention] = useState('main');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Derive initial project name from path
  useEffect(() => {
    if (projectPath) {
      const parts = projectPath.split(/[/\\]/).filter(Boolean);
      setName(parts[parts.length - 1] || 'my-project');
    }
  }, [projectPath]);

  const triggerDiscovery = () => {
    if (!ws || !projectPath) return;

    setIsScanning(true);
    setScanFailed(false);
    setLogText('');
    setDiscoveredData(null);

    const s = settingsRef.current;
    const payload = JSON.stringify({
      type: 'start_discovery',
      projectPath,
      agentCli: s?.agent_cli || 'agy',
      model: s?.default_model,
      thinkingEffort: s?.thinking_effort,
    });

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else {
      ws.addEventListener('open', () => ws.send(payload), { once: true });
    }
  };

  // Start discovery when opened
  useEffect(() => {
    if (!isOpen || !ws || !projectPath) return;

    triggerDiscovery();

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
            if (ev.type === 'error' || (typeof ev.content === 'string' && ev.content.toLowerCase().includes('error:'))) {
              setScanFailed(true);
            }
          }
        } else if (msg.type === 'discovery_done') {
          setIsScanning(false);
          const res = msg.result;
          setDiscoveredData(res);
          if (res.dev_cmd) setDevCmd(res.dev_cmd);
          if (res.dev_port) setDevPort(res.dev_port);
          if (res.build_cmd) setBuildCmd(res.build_cmd);
          if (res.test_cmd) setTestCmd(res.test_cmd);
          if (res.branch_convention) setBranchConvention(res.branch_convention);
        } else if (msg.type === 'error') {
          setIsScanning(false);
          setScanFailed(true);
          setLogText((prev) => `${prev}\nError: ${msg.error || 'Discovery failed'}\n`);
        }
      } catch {}
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [isOpen, ws, projectPath]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logText]);

  const handleSave = async () => {
    try {
      const project = await createProject({
        path: projectPath,
        name: name.trim(),
        dev_cmd: devCmd.trim(),
        dev_port: devPort,
        build_cmd: buildCmd.trim(),
        test_cmd: testCmd.trim(),
        branch_convention: branchConvention.trim(),
      });
      onSuccess(project);
      onClose();
    } catch (err: any) {
      alert(`Error saving project: ${err.message}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-2xl rounded-squircle glass-panel border border-white/80 dark:border-white/10 shadow-soft-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-cozy-border/50 flex items-center justify-between bg-cozy-subtle/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-teal-500/15 via-cyan-500/10 to-sky-500/15 border border-teal-400/25 flex items-center justify-center text-teal-500 shadow-soft-sm shrink-0">
              <Sparkles className="w-5 h-5 text-teal-500" />
            </div>
            <div>
              <h3 className="text-base font-bold text-cozy-text">AI Project Auto-Discovery</h3>
              <p className="text-xs text-cozy-muted font-mono truncate max-w-md sm:max-w-lg">
                {projectPath}
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {/* Status banner */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-cozy-subtle/80 border border-cozy-border/70 text-xs shadow-soft-sm">
            <div className="flex items-center space-x-2 text-cozy-text font-medium">
              {isScanning ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-500" />
                  <span>AI Agent is inspecting files and scripts in real time...</span>
                </>
              ) : scanFailed ? (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                  <span>Discovery encountered an issue. Using fallback settings; you can re-scan or edit below.</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Discovery complete! Review and adjust the settings below.</span>
                </>
              )}
            </div>
            <div className="flex items-center space-x-3">
              {!isScanning && (
                <button
                  type="button"
                  onClick={triggerDiscovery}
                  className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-cozy-surface hover:bg-cozy-subtle text-teal-600 dark:text-teal-400 border border-cozy-border/80 transition-all shadow-soft-sm"
                  title="Re-run auto discovery"
                >
                  <RefreshCw className="w-3 h-3 text-teal-500" />
                  <span>Re-scan</span>
                </button>
              )}
              <span className="font-mono text-cozy-muted text-[11px]">
                Engine: <span className="text-teal-600 dark:text-teal-400 font-semibold uppercase">{settings?.agent_cli}</span>
              </span>
            </div>
          </div>

          {/* Live Agent Terminal Stream */}
          <div className="rounded-2xl border border-cozy-border/70 bg-cozy-surface/90 overflow-hidden flex flex-col h-44 shadow-soft-inner">
            <div className="px-3.5 py-2 bg-cozy-subtle/60 border-b border-cozy-border/50 flex items-center justify-between font-mono text-[11px] text-cozy-muted">
              <div className="flex items-center space-x-2 font-medium">
                <Terminal className="w-3.5 h-3.5 text-teal-500" />
                <span className="text-cozy-text">Inspection Stream</span>
              </div>
              {isScanning && (
                <span className="flex items-center space-x-1.5 text-teal-500 font-medium">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Scanning...</span>
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-cozy-text leading-relaxed whitespace-pre-wrap select-text">
              {logText ? (
                logText
              ) : (
                <span className="text-cozy-muted opacity-70">Waiting for agent output...</span>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>

          {/* Configuration Review Form */}
          <div className="space-y-3.5 pt-2">
            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className="text-xs font-semibold text-cozy-text block mb-1.5">Project Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-cozy-surface/90 border border-cozy-border/80 rounded-2xl px-3.5 py-2.5 text-xs text-cozy-text focus:outline-none focus:border-teal-400 shadow-soft-sm"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-cozy-text block mb-1.5">Branch Convention</label>
                <input
                  type="text"
                  value={branchConvention}
                  onChange={(e) => setBranchConvention(e.target.value)}
                  className="w-full bg-cozy-surface/90 border border-cozy-border/80 rounded-2xl px-3.5 py-2.5 text-xs font-mono text-cozy-text focus:outline-none focus:border-teal-400 shadow-soft-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3.5">
              <div className="col-span-2">
                <label className="text-xs font-semibold text-cozy-text block mb-1.5">Dev Server Command</label>
                <input
                  type="text"
                  value={devCmd}
                  onChange={(e) => setDevCmd(e.target.value)}
                  className="w-full bg-cozy-surface/90 border border-cozy-border/80 rounded-2xl px-3.5 py-2.5 text-xs font-mono text-cozy-text focus:outline-none focus:border-teal-400 shadow-soft-sm"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-cozy-text block mb-1.5">Dev Port</label>
                <input
                  type="number"
                  value={devPort}
                  onChange={(e) => setDevPort(parseInt(e.target.value, 10) || 5173)}
                  className="w-full bg-cozy-surface/90 border border-cozy-border/80 rounded-2xl px-3.5 py-2.5 text-xs font-mono text-cozy-text focus:outline-none focus:border-teal-400 shadow-soft-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className="text-xs font-semibold text-cozy-text block mb-1.5">Build Command</label>
                <input
                  type="text"
                  value={buildCmd}
                  onChange={(e) => setBuildCmd(e.target.value)}
                  className="w-full bg-cozy-surface/90 border border-cozy-border/80 rounded-2xl px-3.5 py-2.5 text-xs font-mono text-cozy-text focus:outline-none focus:border-teal-400 shadow-soft-sm"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-cozy-text block mb-1.5">Test Command</label>
                <input
                  type="text"
                  value={testCmd}
                  onChange={(e) => setTestCmd(e.target.value)}
                  className="w-full bg-cozy-surface/90 border border-cozy-border/80 rounded-2xl px-3.5 py-2.5 text-xs font-mono text-cozy-text focus:outline-none focus:border-teal-400 shadow-soft-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-cozy-border/50 bg-cozy-subtle/40 flex items-center justify-end space-x-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full text-xs font-medium bg-cozy-subtle hover:bg-cozy-surface text-cozy-text border border-cozy-border transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white transition-all shadow-glow-ocean cursor-pointer"
          >
            <FolderGit2 className="w-3.5 h-3.5" />
            <span>Confirm & Add Project</span>
          </button>
        </div>
      </div>
    </div>
  );
};
