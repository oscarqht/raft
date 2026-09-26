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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-cozy-surface border border-cozy-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-cozy-border flex items-center justify-between bg-cozy-subtle/40">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-cozy-text">AI Project Auto-Discovery</h3>
              <p className="text-xs text-cozy-muted font-mono truncate max-w-md">
                {projectPath}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Status banner */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-cozy-subtle border border-cozy-border text-xs">
            <div className="flex items-center space-x-2 text-cozy-text">
              {isScanning ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400" />
                  <span>AI Agent is inspecting files and scripts in real time...</span>
                </>
              ) : scanFailed ? (
                <>
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  <span>Discovery encountered an issue. Using fallback settings; you can re-scan or edit below.</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Discovery complete! Review and adjust the settings below.</span>
                </>
              )}
            </div>
            <div className="flex items-center space-x-3">
              {!isScanning && (
                <button
                  type="button"
                  onClick={triggerDiscovery}
                  className="flex items-center space-x-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-cozy-bg hover:bg-cozy-border text-cozy-text border border-cozy-border transition-colors"
                  title="Re-run auto discovery"
                >
                  <RefreshCw className="w-3 h-3 text-sky-400" />
                  <span>Re-scan</span>
                </button>
              )}
              <span className="font-mono text-cozy-muted text-[11px]">
                Engine: <span className="text-sky-400 font-semibold">{settings?.agent_cli}</span>
              </span>
            </div>
          </div>

          {/* Live Agent Terminal Stream */}
          <div className="rounded-xl border border-cozy-border bg-cozy-bg overflow-hidden flex flex-col h-44">
            <div className="px-3 py-1.5 bg-cozy-subtle/60 border-b border-cozy-border flex items-center justify-between font-mono text-[11px] text-cozy-muted">
              <div className="flex items-center space-x-1.5">
                <Terminal className="w-3.5 h-3.5 text-sky-400" />
                <span>Inspection Stream</span>
              </div>
              {isScanning && (
                <span className="flex items-center space-x-1 text-sky-400">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Scanning...</span>
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2.5 font-mono text-xs text-cozy-text leading-relaxed whitespace-pre-wrap select-text">
              {logText ? (
                logText
              ) : (
                <span className="text-cozy-muted">Waiting for agent output...</span>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>

          {/* Configuration Review Form */}
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-cozy-text block mb-1">Project Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-cozy-bg border border-cozy-border rounded-xl px-3 py-2 text-xs text-cozy-text focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-cozy-text block mb-1">Branch Convention</label>
                <input
                  type="text"
                  value={branchConvention}
                  onChange={(e) => setBranchConvention(e.target.value)}
                  className="w-full bg-cozy-bg border border-cozy-border rounded-xl px-3 py-2 text-xs font-mono text-cozy-text focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-cozy-text block mb-1">Dev Server Command</label>
                <input
                  type="text"
                  value={devCmd}
                  onChange={(e) => setDevCmd(e.target.value)}
                  className="w-full bg-cozy-bg border border-cozy-border rounded-xl px-3 py-2 text-xs font-mono text-cozy-text focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-cozy-text block mb-1">Dev Port</label>
                <input
                  type="number"
                  value={devPort}
                  onChange={(e) => setDevPort(parseInt(e.target.value, 10) || 5173)}
                  className="w-full bg-cozy-bg border border-cozy-border rounded-xl px-3 py-2 text-xs font-mono text-cozy-text focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-cozy-text block mb-1">Build Command</label>
                <input
                  type="text"
                  value={buildCmd}
                  onChange={(e) => setBuildCmd(e.target.value)}
                  className="w-full bg-cozy-bg border border-cozy-border rounded-xl px-3 py-2 text-xs font-mono text-cozy-text focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-cozy-text block mb-1">Test Command</label>
                <input
                  type="text"
                  value={testCmd}
                  onChange={(e) => setTestCmd(e.target.value)}
                  className="w-full bg-cozy-bg border border-cozy-border rounded-xl px-3 py-2 text-xs font-mono text-cozy-text focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-cozy-border bg-cozy-subtle/30 flex items-center justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-cozy-subtle hover:bg-cozy-subtle/80 text-cozy-text border border-cozy-border transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white transition-all shadow-sm"
          >
            <FolderGit2 className="w-3.5 h-3.5" />
            <span>Confirm & Add Project</span>
          </button>
        </div>
      </div>
    </div>
  );
};
