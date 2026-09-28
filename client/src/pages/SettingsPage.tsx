import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Check,
  Cpu,
  BrainCircuit,
  Sliders,
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
  Github,
  GitBranch,
  Key,
  Trash2,
  Plus,
  Globe,
  ShieldCheck,
  Pencil,
} from 'lucide-react';
import { Settings, CliInfo, ModelOption, GitAccount, AgentSkill } from '../types';
import {
  updateSettings,
  getModels,
  getClis,
  installCliStream,
  getGitAccounts,
  verifyGitAccount,
  addGitAccount,
  deleteGitAccount,
  getSkills,
  createSkill,
  updateSkill,
  deleteSkill,
} from '../api';

import {
  getCachedModels,
  setCachedModels,
  getCachedProviderPreference,
  setCachedProviderPreference,
  resolveModelAndEffort,
} from '../cache';

interface SettingsPageProps {
  settings: Settings | null;
  onUpdateSettings: (newSettings: Settings) => void;
  clis: CliInfo[];
  onRefreshClis?: () => void;
}

const SettingsPageContent: React.FC<SettingsPageProps & { settings: Settings }> = ({
  settings,
  onUpdateSettings,
  clis,
  onRefreshClis,
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

  // Git Accounts state
  const [gitAccounts, setGitAccounts] = useState<GitAccount[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [accountProvider, setAccountProvider] = useState<'github' | 'gitlab'>('github');
  const [accountHost, setAccountHost] = useState('');
  const [accountToken, setAccountToken] = useState('');
  const [isVerifyingAccount, setIsVerifyingAccount] = useState(false);
  const [accountVerifyError, setAccountVerifyError] = useState<string | null>(null);
  const [accountSuccessMsg, setAccountSuccessMsg] = useState<string | null>(null);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);

  const loadGitAccounts = async () => {
    try {
      setIsLoadingAccounts(true);
      const accounts = await getGitAccounts();
      setGitAccounts(accounts);
    } catch (err) {
      console.error('Failed to load git accounts:', err);
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  useEffect(() => {
    loadGitAccounts();
  }, []);

  const handleVerifyAndLinkAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountToken.trim()) return;

    try {
      setIsVerifyingAccount(true);
      setAccountVerifyError(null);
      const verified = await verifyGitAccount({
        provider: accountProvider,
        token: accountToken.trim(),
        host: accountHost.trim() || undefined,
      });

      const providerLabel = verified.provider === 'github' ? 'GitHub' : 'GitLab';
      await addGitAccount({
        provider: verified.provider,
        name: `${providerLabel} (${verified.username})`,
        username: verified.username,
        avatar_url: verified.avatarUrl,
        token: accountToken.trim(),
        host: verified.host,
      });

      setAccountSuccessMsg(`Connected as @${verified.username}`);
      setAccountToken('');
      setAccountHost('');
      await loadGitAccounts();
      setTimeout(() => {
        setIsAddAccountOpen(false);
        setAccountSuccessMsg(null);
      }, 1200);
    } catch (err: any) {
      setAccountVerifyError(err.message || 'Verification failed. Please check your token and host.');
    } finally {
      setIsVerifyingAccount(false);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    try {
      setDeletingAccountId(id);
      await deleteGitAccount(id);
      setGitAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error('Failed to delete git account:', err);
    } finally {
      setDeletingAccountId(null);
    }
  };

  // Skills state
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(true);
  const [isSkillModalOpen, setIsSkillModalOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<AgentSkill | null>(null);
  const [skillName, setSkillName] = useState('');
  const [skillDescription, setSkillDescription] = useState('');
  const [skillContent, setSkillContent] = useState('');
  const [skillError, setSkillError] = useState<string | null>(null);
  const [isSavingSkill, setIsSavingSkill] = useState(false);
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null);

  const loadSkills = async () => {
    try {
      setIsLoadingSkills(true);
      const data = await getSkills();
      setSkills(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load skills:', err);
    } finally {
      setIsLoadingSkills(false);
    }
  };

  useEffect(() => {
    loadSkills();
  }, []);

  const handleOpenAddSkill = () => {
    setEditingSkill(null);
    setSkillName('');
    setSkillDescription('');
    setSkillContent('');
    setSkillError(null);
    setIsSkillModalOpen(true);
  };

  const handleOpenEditSkill = (skill: AgentSkill) => {
    setEditingSkill(skill);
    setSkillName(skill.name);
    setSkillDescription(skill.description || '');
    setSkillContent(skill.content || '');
    setSkillError(null);
    setIsSkillModalOpen(true);
  };

  const handleSaveSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = skillName.trim().toLowerCase().replace(/^\/+/, '');
    if (!cleanName) {
      setSkillError('Skill name is required');
      return;
    }
    if (!/^[a-z0-9_\-]+$/i.test(cleanName)) {
      setSkillError('Skill name can only contain letters, numbers, hyphens, and underscores');
      return;
    }
    if (!skillContent.trim()) {
      setSkillError('Skill prompt instructions are required');
      return;
    }

    try {
      setIsSavingSkill(true);
      setSkillError(null);
      if (editingSkill) {
        await updateSkill(editingSkill.id, {
          name: cleanName,
          description: skillDescription.trim(),
          content: skillContent.trim(),
        });
      } else {
        await createSkill({
          name: cleanName,
          description: skillDescription.trim(),
          content: skillContent.trim(),
        });
      }
      setIsSkillModalOpen(false);
      await loadSkills();
    } catch (err: any) {
      setSkillError(err.message || 'Failed to save skill');
    } finally {
      setIsSavingSkill(false);
    }
  };

  const handleDeleteSkill = async (id: string) => {
    try {
      setDeletingSkillId(id);
      await deleteSkill(id);
      setSkills((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error('Failed to delete skill:', err);
    } finally {
      setDeletingSkillId(null);
    }
  };

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
    const { modelId, effort } = resolveModelAndEffort(cli, modelList, defaultModel, thinkingEffort);
    setDefaultModel(modelId);
    setThinkingEffort(effort);
    setCachedProviderPreference(cli, modelId, effort);
    return { modelId, effort };
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
    setInstallLogs((prev) => prev + '\n[raft] Installation cancelled by user.\n');
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
      <div className="max-w-3xl mx-auto p-6 md:p-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-teal-500/20 via-cyan-500/15 to-sky-500/20 border border-teal-400/30 flex items-center justify-center text-teal-600 dark:text-teal-400 shadow-soft-sm shrink-0">
                <SettingsIcon className="w-5 h-5" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-cozy-text">
                Settings
              </h1>
            </div>
            <p className="text-sm text-cozy-muted ml-13">
              Configure default AI agent CLIs, models, and reasoning efforts.
            </p>
          </div>

          {savedToast && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-500 bg-emerald-500/15 border border-emerald-400/30 px-3.5 py-1.5 rounded-full shadow-soft-sm animate-in fade-in shrink-0 mt-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Settings saved automatically</span>
            </div>
          )}
        </div>

      <div className="space-y-6">
        {/* 1. AI Agent CLI Selection */}
        <div className="p-6 sm:p-7 rounded-squircle glass-card border border-white/80 dark:border-white/10 shadow-soft space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold text-cozy-text flex items-center gap-2">
                <Cpu className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                Default AI Agent CLI
              </h2>
              <p className="text-xs text-cozy-muted mt-1">
                Choose which CLI agent to use for code exploration, editing, rebasing, and tasks.
              </p>
            </div>

            <button
              type="button"
              onClick={handleRefreshCliStatus}
              disabled={isCheckingCli}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-cozy-subtle hover:bg-cozy-surface border border-cozy-border text-cozy-muted hover:text-cozy-text transition-all disabled:opacity-50 shadow-soft-sm cursor-pointer"
              title="Rescan system PATH to check CLI availability"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${isCheckingCli ? 'animate-spin' : ''}`} />
              <span>{isCheckingCli ? 'Checking...' : 'Check PATH'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {localClis.map((c) => {
              const isSelected = agentCli.toLowerCase() === c.name.toLowerCase();
              return (
                <div
                  key={c.name}
                  onClick={() => handleSelectCli(c.name)}
                  className={`p-4 sm:p-5 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between min-h-[84px] ${
                    isSelected
                      ? 'bg-teal-500/10 border-teal-400 text-cozy-text shadow-glow-ocean/15'
                      : 'bg-cozy-surface border-cozy-border/80 text-cozy-muted hover:border-teal-400/30 hover:bg-cozy-subtle/60 shadow-soft-sm'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-bold text-sm capitalize text-cozy-text truncate">{c.name}</span>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                      )}
                    </div>
                    <span
                      className={`text-[11px] px-2.5 py-0.5 rounded-full font-mono flex items-center gap-1.5 font-semibold shrink-0 ${
                        c.available
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-400/30'
                          : 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-400/30'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${c.available ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      {c.available ? (c.version ? 'Ready' : 'Ready') : 'Not Installed'}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-cozy-muted truncate" title={c.path}>
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
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
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
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white transition-all shadow-sm shrink-0"
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
                  <Terminal className="w-4 h-4 text-teal-500" />
                  <span className="text-xs font-semibold text-cozy-text">Automated Installation</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 font-medium">
                    1-Click
                  </span>
                </div>
                {!isInstallingCli && (
                  <button
                    type="button"
                    onClick={() => handleStartInstall(agentCli)}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white shadow-sm transition-all"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Run Install Script</span>
                  </button>
                )}
                {isInstallingCli && (
                  <button
                    type="button"
                    onClick={handleCancelInstall}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-all"
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
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500/80 inline-block" />
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
                      </div>
                      <span className="text-zinc-300 font-semibold ml-1">Terminal — {agentCli.toUpperCase()} Installation</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isInstallingCli && (
                        <span className="flex items-center gap-1 text-teal-400">
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
                        <span className="flex items-center gap-1 text-red-400 font-medium">
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
            <div className="p-6 sm:p-7 rounded-squircle glass-card border border-white/80 dark:border-white/10 shadow-soft space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-cozy-text flex items-center gap-2">
                    <BrainCircuit className="w-4 h-4 text-amber-500" />
                    Default Model
                  </h2>
                  <p className="text-xs text-cozy-muted mt-1">
                    Dynamically discovered options for <span className="font-semibold text-teal-600 dark:text-teal-400 uppercase">{agentCli}</span> CLI.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => loadModels(agentCli, true)}
                  disabled={isDiscovering}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-cozy-subtle hover:bg-cozy-surface border border-cozy-border text-cozy-muted hover:text-cozy-text transition-all disabled:opacity-50 shadow-soft-sm cursor-pointer"
                  title="Query agent CLI to discover latest available models and reasoning options"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${isDiscovering ? 'animate-spin' : ''}`} />
                  <span>{isDiscovering ? 'Discovering...' : 'Discover from CLI'}</span>
                </button>
              </div>

              {models.length === 0 ? (
                isDiscovering ? (
                  <div className="p-8 rounded-2xl bg-cozy-subtle/30 border border-cozy-border/70 flex flex-col items-center justify-center gap-3 text-center animate-in fade-in duration-200">
                    <RefreshCw className="w-5 h-5 text-teal-500 animate-spin" />
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-cozy-text">
                        Discovering models for {agentCli.toUpperCase()}...
                      </div>
                      <div className="text-[11px] text-cozy-muted">
                        Querying CLI agent for supported models and reasoning tiers
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-2xl bg-cozy-subtle/30 border border-cozy-border/70 text-xs text-cozy-muted flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span>No models reported by {agentCli} CLI yet. Click "Discover from CLI" to query.</span>
                  </div>
                )
              ) : (
                <div className="space-y-2.5">
                  {models.map((m) => {
                    const isSelected = defaultModel === m.id;
                    return (
                      <div
                        key={m.id}
                        onClick={() => handleSelectModel(m)}
                        className={`p-4 rounded-2xl border cursor-pointer flex items-center justify-between transition-all ${
                          isSelected
                            ? 'bg-teal-500/10 border-teal-400/40 text-cozy-text shadow-glow-ocean/10 ring-1 ring-teal-400/30'
                            : 'bg-cozy-subtle/50 border-cozy-border text-cozy-muted hover:border-teal-400/25 hover:shadow-soft-sm'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-cozy-text">{m.name}</span>
                            {m.discoveredFrom && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cozy-subtle border border-cozy-border text-cozy-muted flex items-center gap-1 font-mono">
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
                        {isSelected && <Check className="w-4 h-4 text-teal-500 shrink-0 ml-3" />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 4. Thinking Effort */}
            <div className="p-6 sm:p-7 rounded-squircle glass-card border border-white/80 dark:border-white/10 shadow-soft space-y-5">
              <div>
                <h2 className="text-base font-bold text-cozy-text flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-emerald-500" />
                  Reasoning / Thinking Effort
                </h2>
                <p className="text-xs text-cozy-muted mt-1">
                  {currentModel
                    ? `Supported effort tiers for ${currentModel.name}`
                    : 'Controls how deeply the agent reasons before producing code and tool actions.'}
                </p>
              </div>

              {models.length === 0 && isDiscovering ? (
                <div className="p-6 rounded-2xl bg-cozy-subtle/30 border border-cozy-border flex items-center justify-center gap-2.5 text-xs text-cozy-muted animate-in fade-in duration-200">
                  <RefreshCw className="w-4 h-4 text-emerald-500 animate-spin" />
                  <span>Loading reasoning tiers for {agentCli.toUpperCase()}...</span>
                </div>
              ) : currentEfforts.length === 1 && currentEfforts[0] === 'none' ? (
                <div className="p-4 rounded-2xl bg-cozy-subtle/30 border border-cozy-border text-xs text-cozy-muted flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cozy-muted/60" />
                  <span>This model does not require variable reasoning effort (standard generation mode).</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                  {currentEffortOptions.map((effort) => {
                    const isSelected = thinkingEffort.toLowerCase() === effort.id.toLowerCase();
                    return (
                      <button
                        key={effort.id}
                        type="button"
                        onClick={() => handleSelectEffort(effort.id)}
                        className={`py-3 px-3.5 rounded-2xl text-xs font-semibold border text-center transition-all flex flex-col items-center justify-center gap-1 cursor-pointer min-h-[60px] ${
                          isSelected
                            ? 'bg-teal-500 text-white border-teal-500 shadow-glow-ocean font-bold'
                            : 'bg-cozy-surface text-cozy-muted border-cozy-border/80 hover:text-cozy-text hover:border-teal-400/30 hover:bg-cozy-subtle/60 shadow-soft-sm'
                        }`}
                        title={effort.description}
                      >
                        <span className="capitalize font-bold">{effort.label}</span>
                        {effort.description && (
                          <span
                            className={`text-[10px] truncate max-w-full font-normal ${
                              isSelected ? 'text-teal-100' : 'text-cozy-muted'
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

        {/* 4. Custom Skills & Slash Commands */}
        <div className="p-6 sm:p-7 rounded-squircle glass-card border border-white/80 dark:border-white/10 shadow-soft space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-cozy-text flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                Custom Skills & Slash Commands
              </h2>
              <p className="text-xs text-cozy-muted mt-1">
                Create custom skills to inject instructions into your AI agent prompt when typing <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">/skill-name</span> in chat.
              </p>
            </div>

            <button
              type="button"
              onClick={handleOpenAddSkill}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white transition-all shadow-soft-sm cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Skill</span>
            </button>
          </div>

          {/* List of Skills */}
          {isLoadingSkills ? (
            <div className="p-6 rounded-2xl bg-cozy-subtle/30 border border-cozy-border flex items-center justify-center gap-2 text-xs text-cozy-muted">
              <RefreshCw className="w-4 h-4 animate-spin text-teal-500" />
              <span>Loading custom skills...</span>
            </div>
          ) : skills.length === 0 ? (
            <div className="p-6 rounded-2xl bg-cozy-subtle/20 border border-dashed border-cozy-border text-center space-y-2">
              <div className="w-9 h-9 mx-auto rounded-full bg-cozy-subtle flex items-center justify-center text-cozy-muted">
                <Sparkles className="w-4 h-4" />
              </div>
              <p className="text-xs text-cozy-muted">
                No custom skills added yet. Click &quot;Add Skill&quot; to define instructions accessible via slash commands in chat.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {skills.map((skill) => (
                <div
                  key={skill.id}
                  className="p-4 rounded-2xl bg-cozy-surface border border-cozy-border flex items-start justify-between gap-3 shadow-soft-sm hover:border-teal-400/30 transition-all"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-xs text-teal-600 dark:text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded-md">
                        /{skill.name}
                      </span>
                      {skill.description && (
                        <span className="text-xs text-cozy-text font-medium">{skill.description}</span>
                      )}
                    </div>
                    {skill.content && (
                      <p className="text-xs text-cozy-muted line-clamp-2 font-mono bg-cozy-subtle/50 p-2 rounded-lg whitespace-pre-wrap">
                        {skill.content}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button
                      type="button"
                      onClick={() => handleOpenEditSkill(skill)}
                      className="p-2 rounded-xl text-cozy-muted hover:text-teal-600 dark:hover:text-teal-400 hover:bg-teal-500/10 border border-transparent hover:border-teal-400/20 transition-all cursor-pointer"
                      title="Edit skill"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSkill(skill.id)}
                      disabled={deletingSkillId === skill.id}
                      className="p-2 rounded-xl text-cozy-muted hover:text-red-500 hover:bg-red-500/10 border border-transparent hover:border-red-400/20 transition-all cursor-pointer disabled:opacity-50"
                      title="Delete skill"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 5. Linked Git Accounts */}
        <div className="p-6 sm:p-7 rounded-squircle glass-card border border-white/80 dark:border-white/10 shadow-soft space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-cozy-text flex items-center gap-2">
                <Github className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                Linked Git Accounts
              </h2>
              <p className="text-xs text-cozy-muted mt-1">
                Connect your GitHub or GitLab accounts via Personal Access Token (PAT) to clone remote repositories and push commits seamlessly.
              </p>
            </div>

            {!isAddAccountOpen && (
              <button
                type="button"
                onClick={() => {
                  setIsAddAccountOpen(true);
                  setAccountVerifyError(null);
                  setAccountSuccessMsg(null);
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white transition-all shadow-soft-sm cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Link Account</span>
              </button>
            )}
          </div>

          {/* List of Connected Accounts */}
          {isLoadingAccounts ? (
            <div className="p-6 rounded-2xl bg-cozy-subtle/30 border border-cozy-border flex items-center justify-center gap-2 text-xs text-cozy-muted">
              <RefreshCw className="w-4 h-4 animate-spin text-teal-500" />
              <span>Loading linked accounts...</span>
            </div>
          ) : gitAccounts.length === 0 && !isAddAccountOpen ? (
            <div className="p-6 rounded-2xl bg-cozy-subtle/20 border border-dashed border-cozy-border text-center space-y-2">
              <div className="w-9 h-9 mx-auto rounded-full bg-cozy-subtle flex items-center justify-center text-cozy-muted">
                <GitBranch className="w-4 h-4" />
              </div>
              <p className="text-xs text-cozy-muted">
                No Git accounts linked yet. Link a GitHub or GitLab account to easily clone your repositories.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {gitAccounts.map((account) => (
                <div
                  key={account.id}
                  className="p-4 rounded-2xl bg-cozy-surface border border-cozy-border flex items-center justify-between gap-3 shadow-soft-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {account.avatar_url ? (
                      <img
                        src={account.avatar_url}
                        alt={account.username}
                        className="w-9 h-9 rounded-full object-cover border border-cozy-border shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-teal-500/10 border border-teal-400/20 flex items-center justify-center text-teal-600 dark:text-teal-400 font-bold shrink-0">
                        {account.provider === 'github' ? <Github className="w-4 h-4" /> : <GitBranch className="w-4 h-4" />}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-cozy-text truncate">{account.name || account.username}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase bg-cozy-subtle text-cozy-muted border border-cozy-border shrink-0">
                          {account.provider}
                        </span>
                      </div>
                      <p className="text-xs text-cozy-muted truncate">
                        @{account.username} • {account.host.replace(/^https?:\/\//, '')}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteAccount(account.id)}
                    disabled={deletingAccountId === account.id}
                    className="p-2 rounded-xl text-cozy-muted hover:text-red-500 hover:bg-red-500/10 border border-transparent hover:border-red-400/20 transition-all cursor-pointer shrink-0 disabled:opacity-50"
                    title="Disconnect account"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add Account Form */}
          {isAddAccountOpen && (
            <form onSubmit={handleVerifyAndLinkAccount} className="p-5 rounded-2xl bg-cozy-subtle/40 border border-cozy-border space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cozy-text uppercase tracking-wider flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-teal-500" />
                  Connect Personal Access Token
                </span>
                <button
                  type="button"
                  onClick={() => setIsAddAccountOpen(false)}
                  className="p-1 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-surface transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Provider Selection */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setAccountProvider('github');
                    setAccountHost('');
                  }}
                  className={`p-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-bold transition-all cursor-pointer ${
                    accountProvider === 'github'
                      ? 'bg-teal-500/15 border-teal-400 text-teal-600 dark:text-teal-300 shadow-soft-sm'
                      : 'bg-cozy-surface border-cozy-border text-cozy-muted hover:text-cozy-text'
                  }`}
                >
                  <Github className="w-4 h-4" />
                  <span>GitHub</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAccountProvider('gitlab');
                    setAccountHost('');
                  }}
                  className={`p-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-bold transition-all cursor-pointer ${
                    accountProvider === 'gitlab'
                      ? 'bg-teal-500/15 border-teal-400 text-teal-600 dark:text-teal-300 shadow-soft-sm'
                      : 'bg-cozy-surface border-cozy-border text-cozy-muted hover:text-cozy-text'
                  }`}
                >
                  <GitBranch className="w-4 h-4" />
                  <span>GitLab</span>
                </button>
              </div>

              {/* Host URL (optional for self-hosted) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-cozy-muted">
                  <span className="font-medium">Host URL (Optional for Self-Hosted)</span>
                  <span className="text-[10px] text-cozy-muted/80">Default: {accountProvider === 'github' ? 'https://github.com' : 'https://gitlab.com'}</span>
                </div>
                <div className="relative">
                  <Globe className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-cozy-muted" />
                  <input
                    type="url"
                    value={accountHost}
                    onChange={(e) => setAccountHost(e.target.value)}
                    placeholder={accountProvider === 'github' ? 'https://github.com' : 'https://gitlab.com'}
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-cozy-surface border border-cozy-border focus:outline-none focus:border-teal-400 text-cozy-text"
                  />
                </div>
              </div>

              {/* Personal Access Token Input */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-cozy-muted">
                    Personal Access Token (PAT)
                  </label>
                  <a
                    href={
                      accountProvider === 'github'
                        ? 'https://github.com/settings/tokens/new?scopes=repo,read:user'
                        : 'https://gitlab.com/-/user_settings/personal_access_tokens'
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1"
                  >
                    <span>Generate token</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="relative">
                  <Key className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-cozy-muted" />
                  <input
                    type="password"
                    value={accountToken}
                    onChange={(e) => setAccountToken(e.target.value)}
                    placeholder={accountProvider === 'github' ? 'ghp_... or github_pat_...' : 'glpat-...'}
                    required
                    className="w-full pl-9 pr-3 py-2 text-xs font-mono rounded-xl bg-cozy-surface border border-cozy-border focus:outline-none focus:border-teal-400 text-cozy-text"
                  />
                </div>
                <p className="text-[11px] text-cozy-muted">
                  {accountProvider === 'github'
                    ? 'Requires "repo" (to access private repositories) and "read:user" scopes.'
                    : 'Requires "read_api" or "api" scope.'}
                </p>
              </div>

              {/* Error and Success states */}
              {accountVerifyError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-400/30 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span className="truncate">{accountVerifyError}</span>
                </div>
              )}

              {accountSuccessMsg && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-400/30 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{accountSuccessMsg}</span>
                </div>
              )}

              {/* Buttons */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsAddAccountOpen(false)}
                  className="px-3.5 py-1.5 rounded-full text-xs font-semibold text-cozy-muted hover:text-cozy-text bg-cozy-surface border border-cozy-border transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isVerifyingAccount || !accountToken.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white transition-all disabled:opacity-50 shadow-soft-sm cursor-pointer"
                >
                  {isVerifyingAccount ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Verify & Link</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

      </div>

      {/* Skill Add/Edit Modal */}
      {isSkillModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-squircle glass-panel border border-white/80 dark:border-white/10 shadow-soft-xl flex flex-col overflow-hidden relative">
            <div className="p-4 md:p-5 border-b border-cozy-border/50 bg-cozy-subtle/50 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-teal-500/15 border border-teal-400/30 flex items-center justify-center text-teal-600 dark:text-teal-400">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-cozy-text">
                    {editingSkill ? 'Edit Custom Skill' : 'Add Custom Skill'}
                  </h3>
                  <p className="text-xs text-cozy-muted">
                    Define skill trigger name, summary, and instructions.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsSkillModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSkill} className="p-5 space-y-4">
              {skillError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-400/20 text-xs text-red-500">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{skillError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-cozy-text mb-1">
                  Trigger Command Name <span className="text-red-500">*</span>
                </label>
                <div className="relative flex items-center">
                  <span className="absolute left-3 text-xs font-mono font-bold text-cozy-muted select-none">/</span>
                  <input
                    type="text"
                    value={skillName}
                    onChange={(e) => setSkillName(e.target.value.toLowerCase().replace(/^\/+/, ''))}
                    placeholder="my-custom-skill"
                    required
                    className="w-full pl-7 pr-3 py-2 rounded-xl text-xs font-mono bg-cozy-surface border border-cozy-border focus:border-teal-400 focus:outline-none transition-all text-cozy-text placeholder:text-cozy-muted/60"
                  />
                </div>
                <p className="text-[11px] text-cozy-muted mt-1">
                  Letters, numbers, hyphens, and underscores. Invoked in chat via /{skillName || 'name'}.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-cozy-text mb-1">
                  Description <span className="text-cozy-muted font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={skillDescription}
                  onChange={(e) => setSkillDescription(e.target.value)}
                  placeholder="e.g. Audit code changes for accessibility and compliance"
                  className="w-full px-3 py-2 rounded-xl text-xs bg-cozy-surface border border-cozy-border focus:border-teal-400 focus:outline-none transition-all text-cozy-text placeholder:text-cozy-muted/60"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-cozy-text mb-1">
                  Instructions / Prompt Content <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={skillContent}
                  onChange={(e) => setSkillContent(e.target.value)}
                  placeholder="Write instructions or context injected into prompt when this skill is invoked..."
                  rows={6}
                  required
                  className="w-full px-3 py-2 rounded-xl text-xs font-mono bg-cozy-surface border border-cozy-border focus:border-teal-400 focus:outline-none transition-all text-cozy-text placeholder:text-cozy-muted/60 resize-y"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-cozy-border/50">
                <button
                  type="button"
                  onClick={() => setIsSkillModalOpen(false)}
                  className="px-4 py-2 rounded-full text-xs font-semibold text-cozy-muted hover:text-cozy-text bg-cozy-surface border border-cozy-border transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingSkill || !skillName.trim() || !skillContent.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white transition-all disabled:opacity-50 shadow-soft-sm cursor-pointer"
                >
                  {isSavingSkill ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>{editingSkill ? 'Save Changes' : 'Create Skill'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  </div>
);
};

export const SettingsPage: React.FC<SettingsPageProps> = (props) => {
  if (!props.settings) {
    return (
      <div className="flex-1 flex items-center justify-center text-cozy-muted text-sm">
        Loading settings...
      </div>
    );
  }

  return (
    <SettingsPageContent
      {...props}
      settings={props.settings}
    />
  );
};

