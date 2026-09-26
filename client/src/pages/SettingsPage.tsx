import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Check, Cpu, BrainCircuit, Sliders, Palette, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Settings, CliInfo, ModelOption } from '../types';
import { updateSettings, getModels } from '../api';

interface SettingsPageProps {
  settings: Settings;
  onUpdateSettings: (newSettings: Settings) => void;
  clis: CliInfo[];
  onBack: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  onUpdateSettings,
  clis,
  onBack,
}) => {
  const [agentCli, setAgentCli] = useState(settings.agent_cli);
  const [defaultModel, setDefaultModel] = useState(settings.default_model);
  const [thinkingEffort, setThinkingEffort] = useState(settings.thinking_effort);
  const [theme, setTheme] = useState(settings.theme);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    getModels(agentCli).then((data) => {
      setModels(data);
      if (!data.some((m) => m.id === defaultModel) && data.length > 0) {
        setDefaultModel(data[0].id);
      }
    });
  }, [agentCli]);

  const handleSave = async () => {
    const next: Settings = {
      agent_cli: agentCli,
      default_model: defaultModel,
      thinking_effort: thinkingEffort,
      theme,
    };
    await updateSettings(next);
    onUpdateSettings(next);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2500);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8 max-w-3xl mx-auto w-full">
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
            <span>Settings saved</span>
          </div>
        )}
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-cozy-text flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-sky-400" />
          Settings
        </h1>
        <p className="text-sm text-cozy-muted mt-1">
          Configure default AI agent CLIs, models, reasoning efforts, and interface appearance.
        </p>
      </div>

      <div className="space-y-6">
        {/* 1. AI Agent CLI */}
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
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {clis.map((c) => {
              const isSelected = agentCli === c.name;
              return (
                <div
                  key={c.name}
                  onClick={() => setAgentCli(c.name)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-sky-500/10 border-sky-500/40 text-cozy-text shadow-sm'
                      : 'bg-cozy-subtle/50 border-cozy-border text-cozy-muted hover:border-cozy-border/80'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm capitalize">{c.name}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                        c.available
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}
                    >
                      {c.available ? 'Ready' : 'Not Found'}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-cozy-muted/80 truncate" title={c.path}>
                    {c.path}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 2. Default Model Selection */}
        <div className="p-6 rounded-2xl bg-cozy-surface border border-cozy-border space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-cozy-text flex items-center gap-2">
              <BrainCircuit className="w-4 h-4 text-amber-400" />
              Default Model
            </h2>
            <p className="text-xs text-cozy-muted mt-0.5">
              Available models for <span className="font-semibold text-sky-400">{agentCli}</span>.
            </p>
          </div>

          <div className="space-y-2">
            {models.map((m) => {
              const isSelected = defaultModel === m.id;
              return (
                <div
                  key={m.id}
                  onClick={() => setDefaultModel(m.id)}
                  className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
                    isSelected
                      ? 'bg-sky-500/10 border-sky-500/40 text-cozy-text'
                      : 'bg-cozy-subtle/40 border-cozy-border text-cozy-muted hover:border-cozy-border/80'
                  }`}
                >
                  <div>
                    <div className="text-xs font-semibold text-cozy-text">{m.name}</div>
                    {m.description && <div className="text-[11px] text-cozy-muted mt-0.5">{m.description}</div>}
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-sky-400 shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* 3. Thinking Effort */}
        <div className="p-6 rounded-2xl bg-cozy-surface border border-cozy-border space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-cozy-text flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              Reasoning / Thinking Effort
            </h2>
            <p className="text-xs text-cozy-muted mt-0.5">
              Controls how deeply the agent reasons before producing code and tool actions.
            </p>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {(['none', 'low', 'medium', 'high', 'max'] as const).map((effort) => {
              const isSelected = thinkingEffort === effort;
              return (
                <button
                  key={effort}
                  type="button"
                  onClick={() => setThinkingEffort(effort)}
                  className={`py-2 px-3 rounded-xl text-xs font-medium capitalize border transition-all ${
                    isSelected
                      ? 'bg-sky-600 text-white border-sky-500 shadow-sm'
                      : 'bg-cozy-subtle/50 text-cozy-muted border-cozy-border hover:text-cozy-text'
                  }`}
                >
                  {effort}
                </button>
              );
            })}
          </div>
        </div>

        {/* 4. Visual Theme */}
        <div className="p-6 rounded-2xl bg-cozy-surface border border-cozy-border space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-cozy-text flex items-center gap-2">
              <Palette className="w-4 h-4 text-sky-400" />
              Appearance Theme
            </h2>
            <p className="text-xs text-cozy-muted mt-0.5">
              Choose between cozy dark and warm light aesthetics.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div
              onClick={() => setTheme('dark')}
              className={`p-4 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
                theme === 'dark'
                  ? 'bg-sky-500/10 border-sky-500/40 text-cozy-text'
                  : 'bg-cozy-subtle/40 border-cozy-border text-cozy-muted'
              }`}
            >
              <div>
                <div className="text-xs font-semibold text-cozy-text">Cozy Dark</div>
                <div className="text-[11px] text-cozy-muted mt-0.5">Deep slate & muted blue accents</div>
              </div>
              {theme === 'dark' && <Check className="w-4 h-4 text-sky-400" />}
            </div>

            <div
              onClick={() => setTheme('light')}
              className={`p-4 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
                theme === 'light'
                  ? 'bg-sky-500/10 border-sky-500/40 text-cozy-text'
                  : 'bg-cozy-subtle/40 border-cozy-border text-cozy-muted'
              }`}
            >
              <div>
                <div className="text-xs font-semibold text-cozy-text">Cozy Light</div>
                <div className="text-[11px] text-cozy-muted mt-0.5">Warm paper & clean borders</div>
              </div>
              {theme === 'light' && <Check className="w-4 h-4 text-sky-400" />}
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end pt-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white transition-all shadow-sm"
          >
            <Check className="w-4 h-4" />
            <span>Save Preferences</span>
          </button>
        </div>
      </div>
    </div>
  );
};
