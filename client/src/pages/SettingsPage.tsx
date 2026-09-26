import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Check,
  Cpu,
  BrainCircuit,
  Sliders,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  Terminal,
  Copy,
  ExternalLink,
  ArrowRight,
  Download,
  Square,
  Play,
  X,
} from 'lucide-react';
import { Settings, CliInfo, ModelOption } from '../types';
import { updateSettings, getModels, getClis, installCliStream } from '../api';

// LocalStorage helpers for caching CLI models and reasoning efforts
const getCachedModels = (cli: string): ModelOption[] => {
  try {
    const raw = localStorage.getItem(`termai_models_${(cli || '').toLowerCase()}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return [];
};

const setCachedModels = (cli: string, modelsList: ModelOption[]) => {
  try {
    if (modelsList && modelsList.length > 0) {
      localStorage.setItem(`termai_models_${(cli || '').toLowerCase()}`, JSON.stringify(modelsList));
    }
  } catch {}
};

const getCachedProviderPreference = (cli: string): { model?: string; effort?: string } => {
  try {
    const raw = localStorage.getItem(`termai_pref_${(cli || '').toLowerCase()}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  return {};
};

const setCachedProviderPreference = (cli: string, model: string, effort: string) => {
  try {
    localStorage.setItem(`termai_pref_${(cli || '').toLowerCase()}`, JSON.stringify({ model, effort }));
  } catch {}
};

interface SettingsPageProps {
  settings: Settings;
  onUpdateSettings: (newSettings: Settings) => void;
  clis: CliInfo[];
  onRefreshClis?: () => void;
  onBack: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  onUpdateSettings,
  clis,
  onRefreshClis,
  onBack,
}) => {
  const [localClis, setLocalClis] = useState<CliInfo[]>(clis);
  const [agentCli, setAgentCli] = useState(settings.agent_cli);
  const [defaultModel, setDefaultModel] = useState(settings.default_model);
  const [thinkingEffort, setThinkingEffort] = useState(settings.thinking_effort);
  const [models, setModels] = useState<ModelOption[]>(() => getCachedModels(settings.agent_cli));
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isCheckingCli, setIsCheckingCli] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [copiedOs, setCopiedOs] = useState<'win' | 'mac' | null>(null);
  const [savedToast, setSavedToast] = useState(false);

  // Streaming CLI installer state
  const [isInstallingCli, setIsInstallingCli] = useState(false);
  const [installLogs, setInstallLogs] = useState('');
  const [installSuccess, setInstallSuccess] = useState<boolean | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const terminalEndRef = React.useRef<HTMLDivElement>(null);
  const cancelInstallRef = React.useRef<(() => void) | null>(null);

  // Auto-scroll terminal on new log lines
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [installLogs]);

  // Keep local CLIs in sync with prop
  useEffect(() => {
    if (clis && clis.length > 0) {
      setLocalClis(clis);
    }
  }, [clis]);

  const selectedCliInfo = localClis.find((c) => c.name.toLowerCase() === agentCli.toLowerCase());
  const isCliReady = selectedCliInfo?.available ?? false;

  const autoSaveSettings = async (nextCli: string, nextModel: string, nextEffort: string) => {
    const next: Settings = {
      agent_cli: nextCli,
      default_model: nextModel,
      thinking_effort: nextEffort,
      theme: 'auto',
    };
    try {
      await updateSettings(next);
      onUpdateSettings(next);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2000);
    } catch (err) {
      console.error('Failed to auto-save settings:', err);
    }
  };

  const syncModelAndEffort = (cli: string, modelList: ModelOption[]): { modelId: string; effort: string } => {
    if (modelList.length === 0) return { modelId: defaultModel, effort: thinkingEffort };
    const pref = getCachedProviderPreference(cli);
    const candidateModelId = pref.model || defaultModel;
    const matchedModel = modelList.find((m) => m.id === candidateModelId);
    const active = matchedModel || modelList[0];

    let chosenModelId = defaultModel;
    let chosenEffort = thinkingEffort;

    if (active) {
      chosenModelId = active.id;
      setDefaultModel(active.id);
      const supported = active.reasoningEfforts || ['none', 'low', 'medium', 'high', 'max'];
      const candidateEffort = pref.effort || thinkingEffort;
      const effortLower = candidateEffort.toLowerCase();
      const validEffort =
        supported.find((s) => s.toLowerCase() === effortLower) || active.defaultEffort || supported[0] || 'medium';
      chosenEffort = validEffort;
      setThinkingEffort(validEffort);
      setCachedProviderPreference(cli, active.id, validEffort);
    }

    return { modelId: chosenModelId, effort: chosenEffort };
  };

  const loadModels = async (cli: string, refresh = false) => {
    // 1. Immediately show cached models from localStorage if available
    const cached = getCachedModels(cli);
    if (cached.length > 0 && !refresh) {
      setModels(cached);
      syncModelAndEffort(cli, cached);
    } else if (cached.length === 0) {
      setModels([]);
    }

    setIsDiscovering(true);
    try {
      const data = await getModels(cli, refresh);
      if (data && data.length > 0) {
        setModels(data);
        setCachedModels(cli, data);
        const { modelId, effort } = syncModelAndEffort(cli, data);
        if (cached.length === 0) {
          autoSaveSettings(cli, modelId, effort);
        }
      } else if (cached.length === 0) {
        setModels([]);
      }
    } catch (err) {
      console.error('Failed to discover models for CLI:', err);
      if (cached.length === 0) {
        setModels([]);
      }
    } finally {
      setIsDiscovering(false);
    }
  };

  useEffect(() => {
    loadModels(agentCli);
  }, [agentCli]);

  const handleSelectCli = (cliName: string) => {
    if (cliName.toLowerCase() === agentCli.toLowerCase()) return;
    setAgentCli(cliName);
    // Instantly load cached models for the newly selected CLI if present; otherwise clear list so loading spinner displays
    const cached = getCachedModels(cliName);
    if (cached.length > 0) {
      setModels(cached);
      const { modelId, effort } = syncModelAndEffort(cliName, cached);
      autoSaveSettings(cliName, modelId, effort);
    } else {
      setModels([]);
      autoSaveSettings(cliName, defaultModel, thinkingEffort);
    }
  };

  const handleRefreshCliStatus = async () => {
    setIsCheckingCli(true);
    try {
      const updatedClis = await getClis();
      setLocalClis(updatedClis);
      if (onRefreshClis) onRefreshClis();
      await loadModels(agentCli, true);
    } catch (err) {
      console.error('Failed to re-check CLIs:', err);
    } finally {
      setIsCheckingCli(false);
    }
  };

  const handleCopyCommand = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCommand(true);
      setTimeout(() => setCopiedCommand(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = cmd;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedCommand(true);
      setTimeout(() => setCopiedCommand(false), 2000);
    }
  };

  const handleStartInstall = (cliName: string) => {
    setIsInstallingCli(true);
    setInstallLogs('');
    setInstallSuccess(null);
    setInstallError(null);

    const cancel = installCliStream(
      cliName,
      (chunk) => {
        setInstallLogs((prev) => prev + chunk);
      },
      async (success, updatedClis) => {
        setIsInstallingCli(false);
        if (success) {
          setInstallSuccess(true);
          if (updatedClis) {
            setLocalClis(updatedClis);
          } else {
            const clis = await getClis();
            setLocalClis(clis);
          }
          if (onRefreshClis) onRefreshClis();
          await loadModels(cliName, true);
        } else {
          setInstallSuccess(false);
          setInstallError('Installer exited with an error. Please inspect the log output above.');
        }
      },
      (err) => {
        setIsInstallingCli(false);
        setInstallSuccess(false);
        setInstallError(err?.message || 'Connection lost during installation.');
      }
    );

    cancelInstallRef.current = cancel;
  };

  const handleCancelInstall = () => {
    if (cancelInstallRef.current) {
      cancelInstallRef.current();
      cancelInstallRef.current = null;
    }
    setIsInstallingCli(false);
    setInstallLogs((prev) => prev + '\n[termai] Installation cancelled by user.\n');
  };

  const handleCopyOsCommand = async (cmd: string, osType: 'win' | 'mac') => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedOs(osType);
      setTimeout(() => setCopiedOs(null), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = cmd;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedOs(osType);
      setTimeout(() => setCopiedOs(null), 2000);
    }
  };

  const handleSelectModel = (m: ModelOption) => {
    setDefaultModel(m.id);
    const supported = m.reasoningEfforts || ['none', 'low', 'medium', 'high', 'max'];
    const effortLower = thinkingEffort.toLowerCase();
    const validEffort =
      supported.find((s) => s.toLowerCase() === effortLower) || m.defaultEffort || supported[0] || 'medium';
    setThinkingEffort(validEffort);
    setCachedProviderPreference(agentCli, m.id, validEffort);
    autoSaveSettings(agentCli, m.id, validEffort);
  };

  const handleSelectEffort = (effortId: string) => {
    setThinkingEffort(effortId);
    setCachedProviderPreference(agentCli, defaultModel, effortId);
    autoSaveSettings(agentCli, defaultModel, effortId);
  };

  const currentModel = models.find((m) => m.id === defaultModel);
  const currentEfforts = currentModel?.reasoningEfforts || ['none', 'low', 'medium', 'high', 'max'];
  const currentEffortOptions = currentModel?.reasoningEffortOptions || currentEfforts.map((effort) => ({
    id: effort,
    label: effort.charAt(0).toUpperCase() + effort.slice(1),
    description: effort === 'none' ? 'No reasoning mode' : `${effort.charAt(0).toUpperCase() + effort.slice(1)} reasoning`,
  }));

  // Find another CLI that is ready (e.g. Codex) if current CLI is not installed
  const fallbackReadyCli = localClis.find((c) => c.available && c.name.toLowerCase() !== agentCli.toLowerCase());

  return (
    <div className="flex-1 overflow-y-auto w-full">
      <div className="max-w-3xl mx-auto p-6 md:p-8">
        {/* Top Bar */}
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-cozy-muted hover:text-cozy-text transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          {savedToast && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg animate-in fade-in">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Settings saved automatically</span>
            </div>
          )}
        </div>

      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-cozy-text flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-sky-400" />
          Settings
        </h1>
        <p className="text-sm text-cozy-muted mt-1">
          Configure default AI agent CLIs, models, and reasoning efforts.
        </p>
      </div>

      <div className="space-y-6">
        {/* 1. AI Agent CLI Selection */}
        <div className="p-6 rounded-2xl bg-cozy-surface border border-cozy-border space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-cozy-text flex items-center gap-2">
                <Cpu className="w-4 h-4 text-sky-400" />
                Default AI Agent CLI
              </h2>
              <p className="text-xs text-cozy-muted mt-0.5">
                Choose which CLI agent to use for code exploration, editing, rebasing, and tasks.
              </p>
            </div>

            <button
              type="button"
              onClick={handleRefreshCliStatus}
              disabled={isCheckingCli}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cozy-subtle border border-cozy-border text-cozy-muted hover:text-cozy-text hover:border-sky-500/40 transition-all disabled:opacity-50"
              title="Rescan system PATH to check CLI availability"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isCheckingCli ? 'animate-spin' : ''}`} />
              <span>{isCheckingCli ? 'Checking...' : 'Check PATH'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {localClis.map((c) => {
              const isSelected = agentCli.toLowerCase() === c.name.toLowerCase();
              return (
                <div
                  key={c.name}
                  onClick={() => handleSelectCli(c.name)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-sky-500/10 border-sky-500/40 text-cozy-text shadow-sm ring-1 ring-sky-500/20'
                      : 'bg-cozy-subtle/50 border-cozy-border text-cozy-muted hover:border-cozy-border/80'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm capitalize text-cozy-text">{c.name}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-mono flex items-center gap-1 ${
                        c.available
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${c.available ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                      {c.available ? (c.version ? 'Ready' : 'Ready') : 'Not Installed'}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-cozy-muted/80 truncate" title={c.path}>
                    {c.available ? (c.version ? `${c.version}` : c.path) : 'Not found in system PATH'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 2. Installation Guide (if selected CLI is NOT available) */}
        {!isCliReady ? (
          <div className="p-6 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-5 animate-in fade-in duration-200">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0 mt-0.5">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1 flex-1">
                <h3 className="text-sm font-semibold text-cozy-text flex items-center gap-2">
                  <span>{selectedCliInfo?.installGuide?.title || `${agentCli.toUpperCase()} CLI`} is not installed</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    Required for Agent Tasks
                  </span>
                </h3>
                <p className="text-xs text-cozy-muted">
                  {selectedCliInfo?.installGuide?.description ||
                    `This CLI agent was not found in your system PATH. Install it globally in your terminal to enable autonomous agent execution.`}
                </p>
              </div>
            </div>

            {/* Quick Switch Suggestion if Codex or another CLI is available */}
            {fallbackReadyCli && (
              <div className="p-3.5 rounded-xl bg-cozy-surface border border-cozy-border flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <span className="text-cozy-muted">
                    <strong className="text-cozy-text capitalize">{fallbackReadyCli.name} CLI</strong> is installed and ready to use on your machine.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleSelectCli(fallbackReadyCli.name)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white transition-all shadow-sm shrink-0"
                >
                  <span>Switch to {fallbackReadyCli.name}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Automated 1-Click Terminal Runner */}
            <div className="p-4 rounded-xl bg-cozy-surface border border-cozy-border space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-sky-400" />
                  <span className="text-xs font-semibold text-cozy-text">Automated Installation</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-medium">
                    1-Click
                  </span>
                </div>
                {!isInstallingCli && (
                  <button
                    type="button"
                    onClick={() => handleStartInstall(agentCli)}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white shadow-sm transition-all"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Run Install Script</span>
                  </button>
                )}
                {isInstallingCli && (
                  <button
                    type="button"
                    onClick={handleCancelInstall}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 transition-all"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Cancel Process</span>
                  </button>
                )}
              </div>

              {/* Streaming Terminal Output Console */}
              {(isInstallingCli || installLogs) && (
                <div className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 font-mono text-[11px] shadow-inner">
                  <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-800 text-zinc-400 text-[10px]">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
                      </div>
                      <span className="text-zinc-300 font-semibold ml-1">Terminal — {agentCli.toUpperCase()} Installation</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isInstallingCli && (
                        <span className="flex items-center gap-1 text-sky-400">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          <span>Streaming...</span>
                        </span>
                      )}
                      {installSuccess === true && (
                        <span className="flex items-center gap-1 text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Installed Successfully!</span>
                        </span>
                      )}
                      {installSuccess === false && (
                        <span className="flex items-center gap-1 text-rose-400 font-medium">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Installation Failed</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-3 max-h-56 overflow-y-auto space-y-1 text-zinc-300 select-text leading-relaxed whitespace-pre-wrap">
                    {installLogs || 'Connecting to terminal runner...\n'}
                    <div ref={terminalEndRef} />
                  </div>
                </div>
              )}
            </div>

            {/* Manual Installation Commands (Mac & Windows) */}
            <div className="space-y-3 pt-1">
              <div className="text-xs font-semibold text-cozy-text flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-sky-400" />
                <span>Or install manually in your terminal:</span>
              </div>

              {/* Windows Command */}
              {selectedCliInfo?.installGuide?.commandWin && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-cozy-muted">
                    <span className="font-medium text-cozy-text flex items-center gap-1">
                      <span>Windows (PowerShell)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyOsCommand(selectedCliInfo.installGuide!.commandWin!, 'win')}
                      className="flex items-center gap-1 text-sky-400 hover:text-sky-300 transition-colors"
                    >
                      {copiedOs === 'win' ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="p-2.5 rounded-xl bg-cozy-bg border border-cozy-border font-mono text-[11px] text-sky-400 overflow-x-auto select-all">
                    {selectedCliInfo.installGuide.commandWin}
                  </div>
                </div>
              )}

              {/* macOS / Linux Command */}
              {selectedCliInfo?.installGuide?.commandMac && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-cozy-muted">
                    <span className="font-medium text-cozy-text flex items-center gap-1">
                      <span>macOS / Linux (Bash)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyOsCommand(selectedCliInfo.installGuide!.commandMac!, 'mac')}
                      className="flex items-center gap-1 text-sky-400 hover:text-sky-300 transition-colors"
                    >
                      {copiedOs === 'mac' ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="p-2.5 rounded-xl bg-cozy-bg border border-cozy-border font-mono text-[11px] text-sky-400 overflow-x-auto select-all">
                    {selectedCliInfo.installGuide.commandMac}
                  </div>
                </div>
              )}

              {selectedCliInfo?.installGuide?.authGuide && (
                <div className="pt-2">
                  <div className="text-xs font-semibold text-cozy-text mb-1 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Authentication Guide</span>
                  </div>
                  <p className="text-xs text-cozy-muted bg-cozy-subtle/50 p-3 rounded-xl border border-cozy-border">
                    {selectedCliInfo.installGuide.authGuide}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                {selectedCliInfo?.installGuide?.docsUrl ? (
                  <a
                    href={selectedCliInfo.installGuide.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 hover:underline transition-colors"
                  >
                    <span>View official {selectedCliInfo.name} documentation</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : <span />}

                <button
                  type="button"
                  onClick={handleRefreshCliStatus}
                  disabled={isCheckingCli}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-cozy-surface border border-cozy-border text-cozy-text hover:border-sky-500/40 hover:bg-cozy-subtle transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isCheckingCli ? 'animate-spin' : ''}`} />
                  <span>{isCheckingCli ? 'Scanning...' : 'I have installed it, re-check'}</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* 3. Default Model Selection (Available CLI) */}
            <div className="p-6 rounded-2xl bg-cozy-surface border border-cozy-border space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-cozy-text flex items-center gap-2">
                    <BrainCircuit className="w-4 h-4 text-amber-400" />
                    Default Model
                  </h2>
                  <p className="text-xs text-cozy-muted mt-0.5">
                    Dynamically discovered options for <span className="font-semibold text-sky-400 uppercase">{agentCli}</span> CLI.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => loadModels(agentCli, true)}
                  disabled={isDiscovering}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cozy-subtle border border-cozy-border text-cozy-muted hover:text-cozy-text hover:border-sky-500/40 transition-all disabled:opacity-50"
                  title="Query agent CLI to discover latest available models and reasoning options"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isDiscovering ? 'animate-spin' : ''}`} />
                  <span>{isDiscovering ? 'Discovering...' : 'Discover from CLI'}</span>
                </button>
              </div>

              {models.length === 0 ? (
                isDiscovering ? (
                  <div className="p-8 rounded-xl bg-cozy-subtle/30 border border-cozy-border flex flex-col items-center justify-center gap-3 text-center animate-in fade-in duration-200">
                    <RefreshCw className="w-5 h-5 text-sky-400 animate-spin" />
                    <div className="space-y-0.5">
                      <div className="text-xs font-semibold text-cozy-text">
                        Discovering models for {agentCli.toUpperCase()}...
                      </div>
                      <div className="text-[11px] text-cozy-muted">
                        Querying CLI agent for supported models and reasoning tiers
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-cozy-subtle/30 border border-cozy-border text-xs text-cozy-muted flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span>No models reported by {agentCli} CLI yet. Click "Discover from CLI" to query.</span>
                  </div>
                )
              ) : (
                <div className="space-y-2">
                  {models.map((m) => {
                    const isSelected = defaultModel === m.id;
                    return (
                      <div
                        key={m.id}
                        onClick={() => handleSelectModel(m)}
                        className={`p-3.5 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
                          isSelected
                            ? 'bg-sky-500/10 border-sky-500/40 text-cozy-text shadow-sm ring-1 ring-sky-500/20'
                            : 'bg-cozy-subtle/40 border-cozy-border text-cozy-muted hover:border-cozy-border/80'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-cozy-text">{m.name}</span>
                            {m.discoveredFrom && (
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-cozy-subtle border border-cozy-border text-cozy-muted flex items-center gap-1 font-mono">
                                <Sparkles className="w-2.5 h-2.5 text-amber-400" />
                                <span>{m.discoveredFrom}</span>
                              </span>
                            )}
                          </div>
                          {m.description && <div className="text-[11px] text-cozy-muted">{m.description}</div>}
                          {m.reasoningEfforts && m.reasoningEfforts.length > 0 && (
                            <div className="text-[10px] text-cozy-muted/80 font-mono">
                              Reasoning tiers: {m.reasoningEfforts.join(', ')}
                            </div>
                          )}
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-sky-400 shrink-0 ml-3" />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 4. Thinking Effort */}
            <div className="p-6 rounded-2xl bg-cozy-surface border border-cozy-border space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-cozy-text flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-emerald-400" />
                  Reasoning / Thinking Effort
                </h2>
                <p className="text-xs text-cozy-muted mt-0.5">
                  {currentModel
                    ? `Supported effort tiers for ${currentModel.name}`
                    : 'Controls how deeply the agent reasons before producing code and tool actions.'}
                </p>
              </div>

              {models.length === 0 && isDiscovering ? (
                <div className="p-6 rounded-xl bg-cozy-subtle/30 border border-cozy-border flex items-center justify-center gap-2.5 text-xs text-cozy-muted animate-in fade-in duration-200">
                  <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" />
                  <span>Loading reasoning tiers for {agentCli.toUpperCase()}...</span>
                </div>
              ) : currentEfforts.length === 1 && currentEfforts[0] === 'none' ? (
                <div className="p-4 rounded-xl bg-cozy-subtle/30 border border-cozy-border text-xs text-cozy-muted flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cozy-muted/60" />
                  <span>This model does not require variable reasoning effort (standard generation mode).</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                  {currentEffortOptions.map((effort) => {
                    const isSelected = thinkingEffort.toLowerCase() === effort.id.toLowerCase();
                    return (
                      <button
                        key={effort.id}
                        type="button"
                        onClick={() => handleSelectEffort(effort.id)}
                        className={`py-2 px-3 rounded-xl text-xs font-medium border text-center transition-all flex flex-col items-center justify-center gap-0.5 ${
                          isSelected
                            ? 'bg-sky-600 text-white border-sky-500 shadow-sm'
                            : 'bg-cozy-subtle/50 text-cozy-muted border-cozy-border hover:text-cozy-text hover:border-cozy-border/80'
                        }`}
                        title={effort.description}
                      >
                        <span className="capitalize font-semibold">{effort.label}</span>
                        {effort.description && (
                          <span
                            className={`text-[10px] truncate max-w-full ${
                              isSelected ? 'text-sky-100/80' : 'text-cozy-muted/70'
                            }`}
                          >
                            {effort.description}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

      </div>
    </div>
  </div>
);
};
