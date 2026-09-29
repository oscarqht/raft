import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  Bot,
  Radio,
  Eye,
  EyeOff,
  Server,
  Laptop,
  Activity,
} from 'lucide-react';
import { Settings, CliInfo, ModelOption, GitAccount, AgentSkill, SkillInstallSummaryItem, AlphaStatusResponse } from '../types';
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
  installSkillStream,
  getAlphaStatus,
  reconnectAlphaDevice,
} from '../api';
import { AgentUsageCard } from '../components/AgentUsageCard';

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
  ws?: WebSocket | null;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\].*?\x07/g, '');
}

const SettingsPageContent: React.FC<SettingsPageProps & { settings: Settings }> = ({
  settings,
  onUpdateSettings,
  clis,
  onRefreshClis,
  ws,
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

  // Tabs state: 'agents' | 'alpha' | 'skills' | 'git'
  type SettingsTab = 'agents' | 'alpha' | 'skills' | 'git';
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialTab: SettingsTab =
    tabParam === 'alpha' ? 'alpha' : tabParam === 'skills' ? 'skills' : tabParam === 'git' ? 'git' : 'agents';
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    if (tabParam === 'alpha' || tabParam === 'skills' || tabParam === 'git' || tabParam === 'agents') {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  };

  // Alpha Intelligence state
  const [alphaApiUrl, setAlphaApiUrl] = useState(settings.alpha_intelligence_api_url || '');
  const [alphaApiKey, setAlphaApiKey] = useState(settings.alpha_intelligence_api_key || '');
  const [showAlphaKey, setShowAlphaKey] = useState(false);
  const [alphaStatus, setAlphaStatus] = useState<AlphaStatusResponse | null>(null);
  const [isLoadingAlphaStatus, setIsLoadingAlphaStatus] = useState(false);
  const [isSavingAlpha, setIsSavingAlpha] = useState(false);
  const [alphaSaveMsg, setAlphaSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isReconnectingDevice, setIsReconnectingDevice] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

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

  // Skill installation via npx command state
  const [isInstallSkillModalOpen, setIsInstallSkillModalOpen] = useState(false);
  const [installSkillCommand, setInstallSkillCommand] = useState('npx skills add https://github.com/mattpocock/skills --skill grilling');
  const [isInstallingSkill, setIsInstallingSkill] = useState(false);
  const [skillInstallLogs, setSkillInstallLogs] = useState('');
  const [skillInstallError, setSkillInstallError] = useState<string | null>(null);
  const [skillInstallSuccess, setSkillInstallSuccess] = useState<boolean | null>(null);
  const [installedSkillsSummary, setInstalledSkillsSummary] = useState<SkillInstallSummaryItem[] | null>(null);
  const cancelSkillInstallRef = React.useRef<(() => void) | null>(null);
  const skillLogsEndRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (skillLogsEndRef.current) {
      skillLogsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [skillInstallLogs]);

  useEffect(() => {
    return () => {
      cancelSkillInstallRef.current?.();
    };
  }, []);

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

  const handleOpenInstallSkillModal = () => {
    setInstallSkillCommand('npx skills add https://github.com/mattpocock/skills --skill grilling');
    setSkillInstallLogs('');
    setSkillInstallError(null);
    setSkillInstallSuccess(null);
    setInstalledSkillsSummary(null);
    setIsInstallSkillModalOpen(true);
  };

  const handleStartSkillInstall = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!installSkillCommand.trim() || isInstallingSkill) return;

    setIsInstallingSkill(true);
    setSkillInstallLogs('');
    setSkillInstallError(null);
    setSkillInstallSuccess(null);
    setInstalledSkillsSummary(null);

    const cancel = installSkillStream(
      installSkillCommand.trim(),
      (chunk) => {
        setSkillInstallLogs((prev) => prev + chunk);
      },
      (result) => {
        setIsInstallingSkill(false);
        if (result.success) {
          setSkillInstallSuccess(true);
          setInstalledSkillsSummary(result.installedSkills || []);
          if (result.allSkills) {
            setSkills(result.allSkills);
          } else {
            loadSkills();
          }
        } else {
          setSkillInstallSuccess(false);
          setSkillInstallError(result.error || 'Failed to install skill');
        }
      },
      (err) => {
        setIsInstallingSkill(false);
        setSkillInstallSuccess(false);
        setSkillInstallError(err?.message || 'Connection lost during installation');
      }
    );

    cancelSkillInstallRef.current = cancel;
  };

  const handleCloseInstallSkillModal = () => {
    if (isInstallingSkill) {
      cancelSkillInstallRef.current?.();
      setIsInstallingSkill(false);
    }
    setIsInstallSkillModalOpen(false);
  };

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
      ...settings,
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

  const loadAlphaStatus = async () => {
    setIsLoadingAlphaStatus(true);
    try {
      const status = await getAlphaStatus();
      setAlphaStatus(status);
    } catch (err) {
      console.warn('Failed to fetch Alpha status:', err);
    } finally {
      setIsLoadingAlphaStatus(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'alpha' || (activeTab === 'agents' && agentCli === 'alpha')) {
      loadAlphaStatus();
    }
  }, [activeTab, agentCli]);

  // Listen to WebSocket for real-time alpha device status updates
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'alpha_device_status' && data.status) {
          setAlphaStatus(data.status);
        }
      } catch {
        // ignore non-json messages
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => {
      ws.removeEventListener('message', handleMessage);
    };
  }, [ws]);

  // Adaptive polling while device status is 'connecting' or reconnecting
  useEffect(() => {
    const isAlphaActive = activeTab === 'alpha' || (activeTab === 'agents' && agentCli === 'alpha');
    if (!isAlphaActive) return;

    const isConnecting = alphaStatus?.device?.status === 'connecting' || isReconnectingDevice;
    if (!isConnecting) return;

    const interval = setInterval(() => {
      getAlphaStatus()
        .then((status) => {
          setAlphaStatus(status);
        })
        .catch(() => {});
    }, 1500);

    return () => clearInterval(interval);
  }, [activeTab, agentCli, alphaStatus?.device?.status, isReconnectingDevice]);

  const handleSaveAlpha = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSavingAlpha(true);
    setAlphaSaveMsg(null);
    try {
      const nextSettings: Settings = {
        ...settings,
        alpha_intelligence_api_url: alphaApiUrl.trim(),
        alpha_intelligence_api_key: alphaApiKey.trim(),
      };
      await updateSettings(nextSettings);
      onUpdateSettings(nextSettings);
      setAlphaSaveMsg({ type: 'success', text: 'Alpha Intelligence settings saved successfully.' });
      await loadAlphaStatus();
      onRefreshClis?.();
    } catch (err: any) {
      setAlphaSaveMsg({ type: 'error', text: err.message || 'Failed to save settings' });
    } finally {
      setIsSavingAlpha(false);
    }
  };

  const handleReconnectDevice = async () => {
    setIsReconnectingDevice(true);
    try {
      const res = await reconnectAlphaDevice();
      if (res?.status) {
        setAlphaStatus((prev) => (prev ? { ...prev, device: res.status } : prev));
      }
      await loadAlphaStatus();
    } catch (err: any) {
      alert(err.message || 'Failed to reconnect device');
    } finally {
      setIsReconnectingDevice(false);
    }
  };

  const CODING_AGENT_SYSTEM_PROMPT = `You are an autonomous expert software engineering agent executing programming tasks in the user's local repository.
You have access to terminal commands via your connected local desktop device.

# WORKFLOW & CORE PRINCIPLES
1. DISCOVER & READ BEFORE MODIFYING
- Never assume project structure or guess library versions. Inspect the repository first.
- Use command tools like 'git status', 'ls -la', 'find', 'grep', or read project configuration files (package.json, pyproject.toml, Cargo.toml, tsconfig.json, etc.).
- Always read existing file implementations and surrounding context before making edits.

2. SURGICAL & MINIMAL CODE CHANGES
- Make concise, targeted changes to achieve the requested outcome.
- Preserve existing code formatting, naming conventions, architectural patterns, comments, and docstrings.
- Avoid unnecessary refactoring or modifying unrelated files.
- Never delete or overwrite Git internals (e.g. .git/ directory).

3. TEST & VERIFY THOROUGHLY
- After applying code changes, execute project tests, linter, and type checker commands (e.g. npm test, npm run build, pytest, cargo test, go test).
- If tests or builds fail, analyze the error output carefully and fix the issue before completing your turn.
- Ensure the codebase builds cleanly without newly introduced warnings or broken dependencies.

4. COMMUNICATE CLEARLY & CONCISELY
- Keep your thoughts focused on diagnosis and plan of action.
- Summarize what changed, why the change was made, and the test results upon completion.`;

  const handleCopySystemPrompt = () => {
    navigator.clipboard.writeText(CODING_AGENT_SYSTEM_PROMPT);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
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
      <div className="max-w-5xl xl:max-w-6xl mx-auto p-6 md:p-8 space-y-6 w-full">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1.5">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-teal-500/20 via-cyan-500/15 to-sky-500/20 border border-teal-400/30 flex items-center justify-center text-teal-600 dark:text-teal-400 shadow-soft-sm shrink-0">
                <SettingsIcon className="w-5 h-5" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-cozy-text">
                Settings
              </h1>
            </div>
            <p className="text-sm text-cozy-muted ml-13">
              Configure default AI agent CLIs, models, skills, and git integrations.
            </p>
          </div>

          {savedToast && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-500 bg-emerald-500/15 border border-emerald-400/30 px-3.5 py-1.5 rounded-full shadow-soft-sm animate-in fade-in shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Settings saved automatically</span>
            </div>
          )}
        </div>

        {/* 4 Navigation Tabs: AI Agents, Alpha Intelligence, Skills, Git Integration */}
        <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-cozy-surface/80 border border-cozy-border/80 shadow-soft-sm w-full max-w-4xl overflow-x-auto">
          <button
            type="button"
            onClick={() => handleTabChange('agents')}
            className={`flex-1 min-w-fit flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              activeTab === 'agents'
                ? 'bg-teal-500 text-white shadow-soft-sm'
                : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle/60'
            }`}
          >
            <Bot className="w-4 h-4 shrink-0" />
            <span className="whitespace-nowrap">AI Agents</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('alpha')}
            className={`flex-1 min-w-fit flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              activeTab === 'alpha'
                ? 'bg-sky-500 text-white shadow-soft-sm'
                : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle/60'
            }`}
          >
            <Radio className="w-4 h-4 shrink-0" />
            <span className="whitespace-nowrap">Alpha Intelligence</span>
            {Boolean(settings.alpha_intelligence_api_url && settings.alpha_intelligence_api_key) && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('skills')}
            className={`flex-1 min-w-fit flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              activeTab === 'skills'
                ? 'bg-teal-500 text-white shadow-soft-sm'
                : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle/60'
            }`}
          >
            <Sparkles className="w-4 h-4 shrink-0" />
            <span className="whitespace-nowrap">Skills</span>
            {skills.length > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold leading-none shrink-0 ${
                  activeTab === 'skills'
                    ? 'bg-white/20 text-white'
                    : 'bg-cozy-subtle text-cozy-muted'
                }`}
              >
                {skills.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('git')}
            className={`flex-1 min-w-fit flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              activeTab === 'git'
                ? 'bg-teal-500 text-white shadow-soft-sm'
                : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle/60'
            }`}
          >
            <GitBranch className="w-4 h-4 shrink-0" />
            <span className="whitespace-nowrap">Git Integration</span>
            {gitAccounts.length > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold leading-none shrink-0 ${
                  activeTab === 'git'
                    ? 'bg-white/20 text-white'
                    : 'bg-cozy-subtle text-cozy-muted'
                }`}
              >
                {gitAccounts.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab 1: AI Agents */}
        {activeTab === 'agents' && (
          <div className="space-y-6 animate-in fade-in duration-150">
            {/* 1. AI Agent CLI Selection */}
            <div className="p-6 sm:p-7 rounded-squircle glass-card border border-white/80 dark:border-white/10 shadow-soft space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-cozy-text flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                    Default AI Agent Provider
                  </h2>
                  <p className="text-xs text-cozy-muted mt-1">
                    Choose which AI agent or cloud provider to use for code exploration, editing, rebasing, and tasks.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleRefreshCliStatus}
                  disabled={isCheckingCli}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-cozy-subtle hover:bg-cozy-surface border border-cozy-border text-cozy-muted hover:text-cozy-text transition-all disabled:opacity-50 shadow-soft-sm cursor-pointer shrink-0 whitespace-nowrap self-start sm:self-auto"
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
                          : c.name === 'alpha' || c.isCloudProvider
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-400/30'
                          : 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-400/30'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          c.available
                            ? 'bg-emerald-500'
                            : c.name === 'alpha' || c.isCloudProvider
                            ? 'bg-amber-500'
                            : 'bg-red-500'
                        }`}
                      />
                      {c.available
                        ? 'Ready'
                        : c.name === 'alpha' || c.isCloudProvider
                        ? 'Setup Needed'
                        : 'Not Installed'}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-cozy-muted truncate" title={c.path}>
                    {c.name === 'alpha' || c.isCloudProvider
                      ? c.available
                        ? 'Cloud SuperAgent · Device Connected'
                        : 'API URL & Key required'
                      : c.available
                      ? (c.version ? `${c.version}` : c.path)
                      : 'Not found in system PATH'}
                  </div>
                </div>
              );
            })}
              </div>

              {/* AI Agent Usage & Remaining Quotas (CodexBar) - Excluded for Alpha */}
              {agentCli.toLowerCase() !== 'alpha' && (
                <div className="pt-2 border-t border-cozy-border/60">
                  <AgentUsageCard
                    activeCli={agentCli}
                    clis={localClis}
                    onSelectCli={handleSelectCli}
                  />
                </div>
              )}
            </div>

        {/* 3. Provider Configuration / Installation */}
        {agentCli === 'alpha' ? (
          <div className="p-6 sm:p-7 rounded-squircle glass-card border border-white/80 dark:border-white/10 shadow-soft space-y-6 animate-in fade-in duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-cozy-text flex items-center gap-2">
                  <Radio className="w-4.5 h-4.5 text-sky-500" />
                  <span>Alpha Intelligence Cloud SuperAgent</span>
                </h2>
                <p className="text-xs text-cozy-muted mt-1">
                  Cloud agent provider with local terminal execution. Raft connects directly to your Chatflow / SuperAgent streaming API and acts as a local WebSocket terminal device.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                    selectedCliInfo?.available
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-400/30'
                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-400/30'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      selectedCliInfo?.available ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                    }`}
                  />
                  {selectedCliInfo?.available ? 'Ready for Tasks' : 'Setup Required'}
                </span>
              </div>
            </div>

            {/* Quick credentials configuration form */}
            <form onSubmit={handleSaveAlpha} className="space-y-4 max-w-3xl">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-cozy-text">
                  Chatflow / SuperAgent API Endpoint URL
                </label>
                <input
                  type="text"
                  value={alphaApiUrl}
                  onChange={(e) => setAlphaApiUrl(e.target.value)}
                  placeholder="https://your-alpha-host.com/api/superagents/<id>/run"
                  className="w-full text-xs bg-cozy-surface/90 border border-cozy-border/80 rounded-xl px-3.5 py-2.5 text-cozy-text font-mono placeholder:text-cozy-muted/50 focus:outline-none focus:border-sky-500 transition-colors shadow-soft-sm"
                />
                <p className="text-[11px] text-cozy-muted">
                  Full API URL to your SuperAgent or Chatflow run endpoint (e.g. from Alpha Intelligence).
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-cozy-text">
                  API Key
                </label>
                <div className="relative">
                  <input
                    type={showAlphaKey ? 'text' : 'password'}
                    value={alphaApiKey}
                    onChange={(e) => setAlphaApiKey(e.target.value)}
                    placeholder="Paste your Alpha Intelligence API key (Bearer token)"
                    className="w-full text-xs bg-cozy-surface/90 border border-cozy-border/80 rounded-xl px-3.5 py-2.5 pr-10 text-cozy-text font-mono placeholder:text-cozy-muted/50 focus:outline-none focus:border-sky-500 transition-colors shadow-soft-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAlphaKey(!showAlphaKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-cozy-muted hover:text-cozy-text transition-colors cursor-pointer"
                    title={showAlphaKey ? 'Hide key' : 'Show key'}
                  >
                    {showAlphaKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {alphaSaveMsg && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                    alphaSaveMsg.type === 'success'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-400/20'
                      : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-400/20'
                  }`}
                >
                  {alphaSaveMsg.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{alphaSaveMsg.text}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isSavingAlpha}
                  className="px-4 py-2 rounded-xl text-xs font-medium bg-sky-500 hover:bg-sky-400 text-white transition-all shadow-soft-sm flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isSavingAlpha ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>Save & Connect Device</span>
                </button>

                <button
                  type="button"
                  onClick={loadAlphaStatus}
                  disabled={isLoadingAlphaStatus}
                  className="px-3.5 py-2 rounded-xl text-xs font-medium bg-cozy-subtle hover:bg-cozy-surface border border-cozy-border text-cozy-muted hover:text-cozy-text transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAlphaStatus ? 'animate-spin' : ''}`} />
                  <span>Refresh Connection</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleTabChange('alpha')}
                  className="text-xs text-sky-500 hover:text-sky-400 hover:underline flex items-center gap-1 ml-auto cursor-pointer"
                >
                  <span>SuperAgent setup prompt & instructions</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>

            {/* Local Device Connection Status */}
            <div className="pt-4 border-t border-cozy-border/60 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Laptop className="w-4 h-4 text-sky-500" />
                  <span className="text-xs font-semibold text-cozy-text">Local Terminal Device Bridge</span>
                </div>
                {alphaStatus?.device && (
                  <span
                    className={`inline-flex items-center gap-1.5 text-[11px] font-mono font-medium px-2.5 py-0.5 rounded-full ${
                      alphaStatus.device.connected
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-400/20'
                        : alphaStatus.device.status === 'pairing' || alphaStatus.device.status === 'needs_auth'
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-400/20'
                        : 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border border-zinc-500/20'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        alphaStatus.device.connected
                          ? 'bg-emerald-500'
                          : alphaStatus.device.status === 'pairing' || alphaStatus.device.status === 'needs_auth'
                          ? 'bg-amber-500 animate-pulse'
                          : 'bg-zinc-400'
                      }`}
                    />
                    {alphaStatus.device.connected
                      ? 'Connected'
                      : alphaStatus.device.status === 'pairing' || alphaStatus.device.status === 'needs_auth'
                      ? 'Pairing Required'
                      : alphaStatus.device.status === 'connecting'
                      ? 'Connecting...'
                      : 'Disconnected'}
                  </span>
                )}
              </div>

              <div className="p-3.5 rounded-xl bg-cozy-surface/60 border border-cozy-border/80 text-xs space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="text-cozy-muted">
                    Device:{' '}
                    <span className="font-mono text-cozy-text font-semibold">
                      {alphaStatus?.device?.clientName ? `${alphaStatus.device.clientName} (${alphaStatus.device.clientId})` : (alphaStatus?.device?.clientId || 'Not registered yet')}
                    </span>
                    {alphaStatus?.device?.userEmail && (
                      <span className="ml-2 text-sky-600 dark:text-sky-400 font-sans font-medium">
                        • {alphaStatus.device.userEmail}
                      </span>
                    )}
                  </span>
                  {!alphaStatus?.device?.connected && (
                    <button
                      type="button"
                      onClick={handleReconnectDevice}
                      disabled={isReconnectingDevice}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-cozy-subtle hover:bg-cozy-surface border border-cozy-border text-cozy-text transition-colors self-start sm:self-auto cursor-pointer"
                    >
                      {isReconnectingDevice ? 'Connecting...' : 'Reconnect Device'}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-cozy-muted leading-relaxed">
                  Raft automatically connects as a local terminal device over WebSocket. All terminal tools (<code className="text-sky-500 font-mono">run_command</code>) called by the cloud SuperAgent will execute securely in your task's active git worktree.
                </p>

                {alphaStatus?.device?.loginUrl && (
                  <div className="pt-2">
                    <a
                      href={alphaStatus.device.loginUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-900 transition-all shadow-sm"
                    >
                      <span>Authorize This Device in Alpha Portal</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : !isCliReady ? (
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
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-cozy-subtle hover:bg-cozy-surface border border-cozy-border text-cozy-muted hover:text-cozy-text transition-all disabled:opacity-50 shadow-soft-sm cursor-pointer shrink-0 whitespace-nowrap self-start sm:self-auto"
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {models.map((m) => {
                    const isSelected = defaultModel === m.id;
                    return (
                      <div
                        key={m.id}
                        onClick={() => handleSelectModel(m)}
                        className={`p-3.5 sm:p-4 rounded-2xl border cursor-pointer flex flex-col justify-between transition-all ${
                          isSelected
                            ? 'bg-teal-500/10 border-teal-400/40 text-cozy-text shadow-glow-ocean/10 ring-1 ring-teal-400/30'
                            : 'bg-cozy-subtle/50 border-cozy-border text-cozy-muted hover:border-teal-400/25 hover:shadow-soft-sm'
                        }`}
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-bold text-cozy-text leading-snug">{m.name}</span>
                            {isSelected && <Check className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />}
                          </div>
                          {m.description && (
                            <div className="text-[11px] text-cozy-muted leading-relaxed">{m.description}</div>
                          )}
                        </div>
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
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {currentEffortOptions.map((effort) => {
                    const isSelected = thinkingEffort.toLowerCase() === effort.id.toLowerCase();
                    return (
                      <button
                        key={effort.id}
                        type="button"
                        onClick={() => handleSelectEffort(effort.id)}
                        className={`py-3 px-3 rounded-2xl text-xs font-semibold border text-center transition-all flex flex-col items-center justify-center gap-1 cursor-pointer min-h-[60px] min-w-0 ${
                          isSelected
                            ? 'bg-teal-500 text-white border-teal-500 shadow-glow-ocean font-bold'
                            : 'bg-cozy-surface text-cozy-muted border-cozy-border/80 hover:text-cozy-text hover:border-teal-400/30 hover:bg-cozy-subtle/60 shadow-soft-sm'
                        }`}
                        title={effort.description}
                      >
                        <span className="capitalize font-bold truncate max-w-full">{effort.label}</span>
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
      </div>
    )}

    {/* Tab 2: Alpha Intelligence */}
    {activeTab === 'alpha' && (
      <div className="space-y-6 animate-in fade-in duration-150">
        {/* API Credentials Configuration */}
        <div className="p-6 sm:p-7 rounded-squircle glass-card border border-white/80 dark:border-white/10 shadow-soft space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-cozy-text flex items-center gap-2">
                <Radio className="w-4.5 h-4.5 text-sky-500" />
                <span>Alpha Intelligence API Configuration</span>
              </h2>
              <p className="text-xs text-cozy-muted mt-1">
                Configure your Alpha Intelligence Chatflow or SuperAgent endpoint to use it as an autonomous AI agent in Raft.
              </p>
            </div>
            {alphaStatus && (
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold self-start sm:self-auto ${
                  alphaStatus.configured
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-400/30'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-400/30'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    alphaStatus.configured ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                  }`}
                />
                {alphaStatus.configured ? 'API Configured' : 'Not Configured'}
              </span>
            )}
          </div>

          <form onSubmit={handleSaveAlpha} className="space-y-4 max-w-3xl">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-cozy-text">
                API Endpoint URL
              </label>
              <input
                type="text"
                value={alphaApiUrl}
                onChange={(e) => setAlphaApiUrl(e.target.value)}
                placeholder="https://your-alpha-host.com/api/superagents/<id>/run"
                className="w-full text-xs bg-cozy-surface/90 border border-cozy-border/80 rounded-xl px-3.5 py-2.5 text-cozy-text font-mono placeholder:text-cozy-muted/50 focus:outline-none focus:border-sky-500 transition-colors shadow-soft-sm"
              />
              <p className="text-[11px] text-cozy-muted">
                Enter your SuperAgent or Chatflow run URL. Streaming mode (<code className="text-sky-500">?stream=true</code>) is automatically appended.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-cozy-text">
                API Key
              </label>
              <div className="relative">
                <input
                  type={showAlphaKey ? 'text' : 'password'}
                  value={alphaApiKey}
                  onChange={(e) => setAlphaApiKey(e.target.value)}
                  placeholder="Paste your Alpha Intelligence API key (Bearer token)"
                  className="w-full text-xs bg-cozy-surface/90 border border-cozy-border/80 rounded-xl px-3.5 py-2.5 pr-10 text-cozy-text font-mono placeholder:text-cozy-muted/50 focus:outline-none focus:border-sky-500 transition-colors shadow-soft-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowAlphaKey(!showAlphaKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-cozy-muted hover:text-cozy-text transition-colors cursor-pointer"
                  title={showAlphaKey ? 'Hide key' : 'Show key'}
                >
                  {showAlphaKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-cozy-muted">
                Bearer token used to authenticate chat runs and tool invocations.
              </p>
            </div>

            {alphaSaveMsg && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                  alphaSaveMsg.type === 'success'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-400/20'
                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-400/20'
                }`}
              >
                {alphaSaveMsg.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                )}
                <span>{alphaSaveMsg.text}</span>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={isSavingAlpha}
                className="px-4 py-2 rounded-xl text-xs font-medium bg-sky-500 hover:bg-sky-400 text-white transition-all shadow-soft-sm flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isSavingAlpha ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>Save & Connect</span>
              </button>
              <button
                type="button"
                onClick={() => loadAlphaStatus()}
                disabled={isLoadingAlphaStatus}
                className="px-3.5 py-2 rounded-xl text-xs font-medium bg-cozy-surface hover:bg-cozy-subtle border border-cozy-border/70 text-cozy-text transition-all shadow-soft-sm flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-cozy-muted ${isLoadingAlphaStatus ? 'animate-spin' : ''}`} />
                <span>Refresh Status</span>
              </button>
            </div>
          </form>
        </div>

        {/* Local Device Execution Status */}
        <div className="p-6 sm:p-7 rounded-squircle glass-card border border-white/80 dark:border-white/10 shadow-soft space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-cozy-text flex items-center gap-2">
                <Laptop className="w-4.5 h-4.5 text-sky-500" />
                <span>Local Terminal Device Connection</span>
              </h2>
              <p className="text-xs text-cozy-muted mt-1">
                AlphaMouse WebSocket connection that enables your Alpha Intelligence SuperAgent to execute commands directly in your active task workspace.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {alphaStatus?.device && (
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                    alphaStatus.device.connected
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-400/30'
                      : alphaStatus.device.status === 'pairing' || alphaStatus.device.status === 'needs_auth'
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-400/30'
                      : 'bg-cozy-subtle text-cozy-muted border border-cozy-border/50'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      alphaStatus.device.connected
                        ? 'bg-emerald-500 animate-pulse'
                        : alphaStatus.device.status === 'pairing' || alphaStatus.device.status === 'needs_auth'
                        ? 'bg-amber-500 animate-bounce'
                        : 'bg-cozy-muted'
                    }`}
                  />
                  <span>
                    {alphaStatus.device.connected
                      ? 'Terminal Device Connected'
                      : alphaStatus.device.status === 'pairing' || alphaStatus.device.status === 'needs_auth'
                      ? 'Pairing Authorization Needed'
                      : alphaStatus.device.status === 'connecting'
                      ? 'Connecting...'
                      : 'Disconnected'}
                  </span>
                </span>
              )}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-cozy-surface/60 border border-cozy-border/60 text-xs text-cozy-text space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <span className="text-cozy-muted block text-[11px] font-medium">Device Client</span>
                <span className="font-mono text-cozy-text text-xs">
                  {alphaStatus?.device?.clientName ? `${alphaStatus.device.clientName} (${alphaStatus.device.clientId})` : (alphaStatus?.device?.clientId || 'Not registered yet')}
                </span>
              </div>
              <div>
                <span className="text-cozy-muted block text-[11px] font-medium">Connected Alpha Account</span>
                <span className="text-cozy-text text-xs font-semibold text-sky-600 dark:text-sky-400">
                  {alphaStatus?.device?.userEmail || 'Auto-detected on connection'}
                </span>
              </div>
              <div>
                <span className="text-cozy-muted block text-[11px] font-medium">Execution Scope</span>
                <span className="text-cozy-text text-xs">
                  Active git worktree directory for each task
                </span>
              </div>
            </div>

            {alphaStatus?.device?.loginUrl && (
              <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-medium">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Device pairing required to authorize terminal access on Alpha Intelligence portal.</span>
                </div>
                <a
                  href={alphaStatus.device.loginUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Authorize in Browser</span>
                </a>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleReconnectDevice}
              disabled={isReconnectingDevice}
              className="px-3.5 py-2 rounded-xl text-xs font-medium bg-cozy-surface hover:bg-cozy-subtle border border-cozy-border/70 text-cozy-text transition-all shadow-soft-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cozy-muted ${isReconnectingDevice ? 'animate-spin' : ''}`} />
              <span>{isReconnectingDevice ? 'Reconnecting...' : 'Reconnect Device'}</span>
            </button>
          </div>
        </div>

        {/* SuperAgent Setup Guide & Best Practice System Prompt */}
        <div className="p-6 sm:p-7 rounded-squircle glass-card border border-white/80 dark:border-white/10 shadow-soft space-y-6">
          <div>
            <h2 className="text-base font-bold text-cozy-text flex items-center gap-2">
              <Sparkles className="w-4.5 h-4.5 text-sky-500" />
              <span>SuperAgent Setup Guide for Coding Agents</span>
            </h2>
            <p className="text-xs text-cozy-muted mt-1">
              Follow these best-practice steps to configure an Alpha Intelligence SuperAgent optimized for coding, testing, and file operations.
            </p>
          </div>

          {/* Steps */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-cozy-surface/60 border border-cozy-border/60 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-sky-500">
                <span className="w-5 h-5 rounded-full bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-[11px]">1</span>
                <span>Create SuperAgent / Chatflow</span>
              </div>
              <p className="text-xs text-cozy-muted leading-relaxed">
                In your Alpha Intelligence dashboard, navigate to <strong>SuperAgents</strong> (or Chatflows) and click <strong>Create New</strong>.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-cozy-surface/60 border border-cozy-border/60 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-sky-500">
                <span className="w-5 h-5 rounded-full bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-[11px]">2</span>
                <span>Enable Desktop Execution</span>
              </div>
              <p className="text-xs text-cozy-muted leading-relaxed">
                Add the <strong>Desktop / Terminal tool</strong> capability to your agent so it can invoke commands through Raft's local AlphaMouse device connection.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-cozy-surface/60 border border-cozy-border/60 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-sky-500">
                <span className="w-5 h-5 rounded-full bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-[11px]">3</span>
                <span>Apply System Prompt</span>
              </div>
              <p className="text-xs text-cozy-muted leading-relaxed">
                Copy the optimized coding agent system prompt below and paste it into the <strong>System Instructions</strong> field of your SuperAgent.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-cozy-surface/60 border border-cozy-border/60 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-sky-500">
                <span className="w-5 h-5 rounded-full bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-[11px]">4</span>
                <span>Publish & Copy API Run URL</span>
              </div>
              <p className="text-xs text-cozy-muted leading-relaxed">
                Click <strong>Publish</strong>, generate an API key under <strong>API Access</strong>, and copy the endpoint URL into the fields above.
              </p>
            </div>
          </div>

          {/* Best Practice System Prompt Box */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-cozy-text flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-sky-500" />
                <span>Best Practice Coding Agent System Prompt</span>
              </label>
              <button
                type="button"
                onClick={handleCopySystemPrompt}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 border border-sky-400/30 text-xs font-medium transition-colors cursor-pointer"
              >
                {copiedPrompt ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedPrompt ? 'Copied to Clipboard!' : 'Copy Prompt'}</span>
              </button>
            </div>
            <div className="relative rounded-xl border border-cozy-border/80 bg-[#0c1322] p-4 text-slate-200 font-mono text-[11px] leading-relaxed max-h-80 overflow-y-auto whitespace-pre-wrap select-all shadow-soft-inner">
              {CODING_AGENT_SYSTEM_PROMPT}
            </div>
            <p className="text-[11px] text-cozy-muted">
              This prompt instructs the LLM to inspect repositories before writing code, adhere to project conventions, make surgical edits, and verify changes with tests.
            </p>
          </div>
        </div>
      </div>
    )}

    {/* Tab 3: Skills */}
    {activeTab === 'skills' && (
      <div className="space-y-6 animate-in fade-in duration-150">
        {/* Custom Skills & Slash Commands */}
        <div className="p-6 sm:p-7 rounded-squircle glass-card border border-white/80 dark:border-white/10 shadow-soft space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-cozy-text flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                Custom Skills &amp; Slash Commands
              </h2>
              <p className="text-xs text-cozy-muted mt-1">
                Create custom skills to inject instructions into your AI agent prompt when typing{' '}
                <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">/skill-name</span> in chat.
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={handleOpenInstallSkillModal}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-cozy-surface hover:bg-cozy-subtle border border-cozy-border text-cozy-text transition-all shadow-soft-sm cursor-pointer shrink-0 whitespace-nowrap"
                title="Install skills from GitHub or npm packages via npx skills add"
              >
                <Terminal className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                <span>Install with npx</span>
              </button>
              <button
                type="button"
                onClick={handleOpenAddSkill}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white transition-all shadow-soft-sm cursor-pointer shrink-0 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Skill</span>
              </button>
            </div>
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
      </div>
    )}

    {/* Tab 3: Git Integration */}
    {activeTab === 'git' && (
      <div className="space-y-6 animate-in fade-in duration-150">
        {/* Linked Git Accounts */}
        <div className="p-6 sm:p-7 rounded-squircle glass-card border border-white/80 dark:border-white/10 shadow-soft space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white transition-all shadow-soft-sm cursor-pointer shrink-0 whitespace-nowrap self-start sm:self-auto"
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
    )}

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

      {/* Skill Install via npx Command Modal */}
      {isInstallSkillModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-xl rounded-squircle glass-panel border border-white/80 dark:border-white/10 shadow-soft-xl flex flex-col overflow-hidden relative">
            <div className="p-4 md:p-5 border-b border-cozy-border/50 bg-cozy-subtle/50 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-teal-500/15 border border-teal-400/30 flex items-center justify-center text-teal-600 dark:text-teal-400">
                  <Terminal className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-cozy-text">
                    Install Skills via Command
                  </h3>
                  <p className="text-xs text-cozy-muted">
                    Install community or repository skills using <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">npx skills add</span>.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCloseInstallSkillModal}
                className="w-8 h-8 rounded-full flex items-center justify-center text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleStartSkillInstall} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-cozy-text mb-1.5">
                  Command or Package URL
                </label>
                <input
                  type="text"
                  value={installSkillCommand}
                  onChange={(e) => setInstallSkillCommand(e.target.value)}
                  placeholder="npx skills add https://github.com/mattpocock/skills --skill grilling"
                  disabled={isInstallingSkill}
                  required
                  className="w-full px-3 py-2 rounded-xl text-xs font-mono bg-cozy-surface border border-cozy-border focus:border-teal-400 focus:outline-none transition-all text-cozy-text placeholder:text-cozy-muted/60 disabled:opacity-60"
                />
                <div className="flex items-center gap-2 mt-2 flex-wrap text-[11px] text-cozy-muted">
                  <span>Quick examples:</span>
                  <button
                    type="button"
                    disabled={isInstallingSkill}
                    onClick={() => setInstallSkillCommand('npx skills add https://github.com/mattpocock/skills --skill grilling')}
                    className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 hover:bg-teal-500/20 transition-all cursor-pointer disabled:opacity-50"
                  >
                    mattpocock/skills --skill grilling
                  </button>
                  <button
                    type="button"
                    disabled={isInstallingSkill}
                    onClick={() => setInstallSkillCommand('npx skills add vercel-labs/agent-skills')}
                    className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 hover:bg-teal-500/20 transition-all cursor-pointer disabled:opacity-50"
                  >
                    vercel-labs/agent-skills
                  </button>
                </div>
              </div>

              {/* Status Alert */}
              {skillInstallSuccess && installedSkillsSummary && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-400/30 text-xs space-y-2">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>
                      Successfully installed {installedSkillsSummary.length} skill{installedSkillsSummary.length === 1 ? '' : 's'}!
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {installedSkillsSummary.map((s) => (
                      <span
                        key={s.id}
                        className="inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-medium"
                      >
                        /{s.name}
                        {s.overwritten && (
                          <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-sans opacity-80">(updated)</span>
                        )}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-cozy-muted pt-1">
                    Skills are ready to be used! Type <span className="font-mono font-semibold text-cozy-text">/{installedSkillsSummary[0]?.name || 'name'}</span> in chat or view them below.
                  </p>
                </div>
              )}

              {skillInstallError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-400/20 text-xs text-red-500">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{skillInstallError}</span>
                </div>
              )}

              {/* Terminal Logs Output */}
              {(isInstallingSkill || skillInstallLogs) && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-cozy-muted">
                    <span className="font-mono">Terminal Output</span>
                    {isInstallingSkill && (
                      <span className="flex items-center gap-1 text-teal-500">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>Cloning &amp; Installing...</span>
                      </span>
                    )}
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950 text-slate-200 font-mono text-[11px] leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap select-text border border-white/10 shadow-inner">
                    {stripAnsi(skillInstallLogs) || 'Initializing installation process...'}
                    <div ref={skillLogsEndRef} />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-cozy-border/50">
                <button
                  type="button"
                  onClick={handleCloseInstallSkillModal}
                  className="px-4 py-2 rounded-full text-xs font-semibold text-cozy-muted hover:text-cozy-text bg-cozy-surface border border-cozy-border transition-all cursor-pointer"
                >
                  {skillInstallSuccess ? 'Close' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isInstallingSkill || !installSkillCommand.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-teal-500 hover:bg-teal-600 text-white transition-all disabled:opacity-50 shadow-soft-sm cursor-pointer"
                >
                  {isInstallingSkill ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Installing...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5" />
                      <span>{skillInstallSuccess ? 'Install Another' : 'Install Skill'}</span>
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

