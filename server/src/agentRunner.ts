import { spawn, execSync, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from './db.js';

export interface CliInstallGuide {
  title: string;
  command: string;
  commandMac?: string;
  commandWin?: string;
  authGuide: string;
  docsUrl: string;
  description: string;
}

export interface CliInfo {
  name: string;
  path: string;
  available: boolean;
  version?: string;
  installGuide?: CliInstallGuide;
}

export interface ReasoningEffortOption {
  id: string;
  label: string;
  description?: string;
}

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
  reasoningEfforts?: string[];
  reasoningEffortOptions?: ReasoningEffortOption[];
  defaultEffort?: string;
  discoveredFrom?: string;
}

export const CLI_INSTALL_COMMANDS: Record<string, { mac: string; windows: string }> = {
  codex: {
    mac: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
    windows: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
  },
  claude: {
    mac: 'curl -fsSL https://claude.ai/install.sh | bash',
    windows: 'powershell -ExecutionPolicy ByPass -c "irm https://claude.ai/install.ps1 | iex"',
  },
  agy: {
    mac: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    windows: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
  },
};

// Get cross-platform enriched environment with PATH
export function getCrossPlatformEnv(): NodeJS.ProcessEnv {
  const home = os.homedir();
  const isWin = process.platform === 'win32';
  const delimiter = path.delimiter;

  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';

  const additionalDirs: string[] = isWin
    ? [
        path.join(localAppData, 'agy', 'bin'),
        path.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin'),
        path.join(home, '.local', 'bin'),
        path.join(home, '.codex', '.sandbox-bin'),
        path.join(home, '.codex', 'plugins', '.plugin-appserver'),
        path.join(appData, 'npm'),
        path.join(localAppData, 'Programs'),
        path.join(home, '.bun', 'bin'),
        path.join(home, '.cargo', 'bin'),
        path.join(programFiles, 'Git', 'cmd'),
        path.join(programFiles, 'Git', 'bin'),
      ]
    : [
        path.join(home, '.local', 'bin'),
        path.join(home, '.codex', 'bin'),
        path.join(home, '.agy', 'bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
      ];

  if (isWin) {
    try {
      // Query HKCU\Environment Path from registry to catch newly installed CLIs immediately
      const regOut = execSync('reg query "HKCU\\Environment" /v Path', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const match = regOut.match(/REG_(?:EXPAND_)?SZ\s+(.*)/i);
      if (match && match[1]) {
        const regDirs = match[1].split(';').map((s) => s.trim()).filter(Boolean);
        additionalDirs.push(...regDirs);
      }
    } catch {}
  }

  const currentPath = process.env.PATH || '';
  const existingParts = currentPath.split(delimiter).map((s) => s.trim()).filter(Boolean);
  const combined = Array.from(new Set([...additionalDirs, ...existingParts]));
  const newPath = combined.join(delimiter);

  return {
    ...process.env,
    PATH: newPath,
  };
}

// Find path for CLI binary across platforms
export function resolveCliPath(cliName: string): string {
  const home = os.homedir();
  const isWin = process.platform === 'win32';
  const extensions = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];

  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

  const searchDirs = [
    path.join(localAppData, 'agy', 'bin'),
    path.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.codex', '.sandbox-bin'),
    path.join(home, '.codex', 'plugins', '.plugin-appserver'),
    ...(isWin
      ? [
          path.join(appData, 'npm'),
          path.join(localAppData, 'Programs'),
        ]
      : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']),
  ];

  for (const dir of searchDirs) {
    if (!dir) continue;
    for (const ext of extensions) {
      const full = path.join(dir, `${cliName}${ext}`);
      if (fs.existsSync(full)) {
        return full;
      }
    }
  }

  // Fallback to which / where lookup using enriched environment
  try {
    const lookupCmd = isWin ? `where.exe ${cliName}` : `which ${cliName}`;
    const found = execSync(lookupCmd, {
      encoding: 'utf-8',
      env: getCrossPlatformEnv(),
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim().split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) {
      return found;
    }
  } catch {
    // continue
  }

  return cliName;
}

const isWinOS = process.platform === 'win32';

const CLI_INSTALL_GUIDES: Record<string, CliInstallGuide> = {
  agy: {
    title: 'Google Antigravity CLI',
    description: 'Autonomous AI coding agent with Gemini models, multi-step subagents, and deep workspace tools.',
    command: isWinOS
      ? CLI_INSTALL_COMMANDS.agy.windows
      : CLI_INSTALL_COMMANDS.agy.mac,
    commandMac: CLI_INSTALL_COMMANDS.agy.mac,
    commandWin: CLI_INSTALL_COMMANDS.agy.windows,
    authGuide: "Run 'agy' in your terminal and follow the browser authentication prompt to sign in with your Google account.",
    docsUrl: 'https://antigravity.google/docs/cli',
  },
  claude: {
    title: 'Anthropic Claude Code CLI',
    description: 'Anthropic agentic CLI for terminal coding, refactoring, and reasoning.',
    command: isWinOS
      ? CLI_INSTALL_COMMANDS.claude.windows
      : CLI_INSTALL_COMMANDS.claude.mac,
    commandMac: CLI_INSTALL_COMMANDS.claude.mac,
    commandWin: CLI_INSTALL_COMMANDS.claude.windows,
    authGuide: "Run 'claude' in your terminal and log in with your Anthropic Console account or set ANTHROPIC_API_KEY.",
    docsUrl: 'https://docs.anthropic.com/en/docs/agents-and-tools/claude-code',
  },
  codex: {
    title: 'OpenAI Codex CLI',
    description: 'OpenAI autonomous agent CLI with reasoning tiers, sandboxing, and multi-step execution.',
    command: isWinOS
      ? CLI_INSTALL_COMMANDS.codex.windows
      : CLI_INSTALL_COMMANDS.codex.mac,
    commandMac: CLI_INSTALL_COMMANDS.codex.mac,
    commandWin: CLI_INSTALL_COMMANDS.codex.windows,
    authGuide: "Run 'codex login' in your terminal to sign in, or set OPENAI_API_KEY.",
    docsUrl: 'https://platform.openai.com/docs/codex',
  },
};

export function getAvailableClis(): CliInfo[] {
  const clis = ['codex', 'agy', 'claude'];
  const isWin = process.platform === 'win32';
  const env = getCrossPlatformEnv();

  return clis.map((name) => {
    const cliPath = resolveCliPath(name);
    let available = false;
    let version = '';
    try {
      if (fs.existsSync(cliPath) || (isWin && resolveCliPath(name) !== name)) {
        available = true;
        const versionCmd = `"${cliPath}" --version`;
        version = execSync(versionCmd, {
          encoding: 'utf-8',
          env,
          shell: isWin ? (process.env.ComSpec || 'cmd.exe') : '/bin/bash',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim().split(/\r?\n/)[0];
      }
    } catch {
      if (fs.existsSync(cliPath)) {
        available = true;
        version = '1.0.0';
      }
    }
    return {
      name,
      path: cliPath,
      available,
      version,
      installGuide: CLI_INSTALL_GUIDES[name],
    };
  });
}

// Stream terminal installer command for CLI
export function installCliProcess(
  cliName: string,
  onData: (chunk: string) => void
): { proc: ChildProcess; promise: Promise<{ code: number | null }> } {
  const isWin = process.platform === 'win32';
  const normalized = (cliName || '').toLowerCase();
  const cmds = CLI_INSTALL_COMMANDS[normalized];
  if (!cmds) {
    throw new Error(`Unsupported CLI for installation: ${cliName}`);
  }

  const rawCmd = isWin ? cmds.windows : cmds.mac;
  onData(`[termai] Starting installation of ${cliName.toUpperCase()} CLI...\r\n`);
  onData(`[termai] Operating System: ${isWin ? 'Windows' : 'macOS / Linux'}\r\n`);
  onData(`[termai] Command: ${rawCmd}\r\n\r\n`);

  let spawnBin: string;
  let spawnArgs: string[];

  if (isWin) {
    if (rawCmd.startsWith('curl')) {
      spawnBin = 'cmd.exe';
      spawnArgs = ['/c', rawCmd];
    } else {
      spawnBin = 'powershell.exe';
      spawnArgs = ['-ExecutionPolicy', 'ByPass', '-Command', rawCmd];
    }
  } else {
    spawnBin = '/bin/bash';
    spawnArgs = ['-c', rawCmd];
  }

  const env = getCrossPlatformEnv();
  const proc = spawn(spawnBin, spawnArgs, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  proc.stdout?.on('data', (d: Buffer) => onData(d.toString('utf-8')));
  proc.stderr?.on('data', (d: Buffer) => onData(d.toString('utf-8')));

  const promise = new Promise<{ code: number | null }>((resolve) => {
    proc.on('close', (code) => {
      onData(`\r\n[termai] Process exited with status code ${code}\r\n`);
      modelsCache.clear();
      resolve({ code });
    });
    proc.on('error', (err) => {
      onData(`\r\n[termai] Execution error: ${err.message}\r\n`);
      resolve({ code: 1 });
    });
  });

  return { proc, promise };
}

const modelsCache = new Map<string, { timestamp: number; models: ModelOption[] }>();
const CACHE_TTL_MS = 30000;

export async function getModelsForCli(cliName: string, forceRefresh = false): Promise<ModelOption[]> {
  const normalizedCli = (cliName || 'codex').toLowerCase();

  const availableClis = getAvailableClis();
  const cliInfo = availableClis.find((c) => c.name.toLowerCase() === normalizedCli);

  // If the CLI is not installed or available, DO NOT return hardcoded outdated models!
  if (!cliInfo || !cliInfo.available) {
    return [];
  }

  if (!forceRefresh) {
    const cached = modelsCache.get(normalizedCli);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.models;
    }
  }

  let result: ModelOption[] = [];

  if (normalizedCli === 'codex') {
    result = await discoverCodexModels();
  } else if (normalizedCli === 'agy') {
    result = await discoverAgyModels();
  } else if (normalizedCli === 'claude') {
    result = await discoverClaudeModels();
  } else {
    result = [];
  }

  modelsCache.set(normalizedCli, { timestamp: Date.now(), models: result });
  return result;
}

// Discover options for Codex CLI
async function discoverCodexModels(): Promise<ModelOption[]> {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const cachePath = path.join(codexHome, 'models_cache.json');

  const effortDescriptions: Record<string, string> = {
    low: 'Fast responses with lighter reasoning',
    medium: 'Balances speed and reasoning depth for everyday tasks',
    high: 'Greater reasoning depth for complex problems',
    xhigh: 'Extra high reasoning depth for complex problems',
    max: 'Maximum reasoning depth for demanding tasks',
    ultra: 'Maximum reasoning with automatic task delegation',
  };

  if (fs.existsSync(cachePath)) {
    try {
      const raw = fs.readFileSync(cachePath, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.models) && data.models.length > 0) {
        // Filter out internal tools like codex-auto-review, keep public models
        const activeModels = data.models.filter(
          (m: any) => m.slug !== 'codex-auto-review' && (m.visibility === 'list' || !m.visibility)
        );

        return activeModels.map((m: any) => {
          const levels: Array<{ effort: string; description?: string }> = Array.isArray(m.supported_reasoning_levels)
            ? m.supported_reasoning_levels
            : [];
          const reasoningEfforts = levels.length > 0 ? levels.map((l) => l.effort) : ['low', 'medium', 'high'];
          const reasoningEffortOptions: ReasoningEffortOption[] = reasoningEfforts.map((effort) => ({
            id: effort,
            label: effort === 'xhigh' ? 'xHigh' : effort.charAt(0).toUpperCase() + effort.slice(1),
            description: levels.find((l) => l.effort === effort)?.description || effortDescriptions[effort] || `${effort} reasoning effort`,
          }));

          const isRecommended = m.slug === 'gpt-6-sol';

          return {
            id: m.slug,
            name: `${m.display_name || m.slug}${isRecommended ? ' (Recommended)' : ''}`,
            description: m.description || '',
            reasoningEfforts,
            reasoningEffortOptions,
            defaultEffort: m.default_reasoning_level || reasoningEfforts[0] || 'medium',
            discoveredFrom: 'Codex CLI Model Cache (~/.codex/models_cache.json)',
          };
        });
      }
    } catch (err) {
      console.error('Failed to read Codex models_cache.json:', err);
    }
  }

  // Fallback defaults for Codex CLI
  return [
    {
      id: 'gpt-6-sol',
      name: 'GPT-6-Sol (Recommended)',
      description: 'Workhorse model for coding and everyday work',
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      reasoningEffortOptions: [
        { id: 'low', label: 'Low', description: 'Fast responses with lighter reasoning' },
        { id: 'medium', label: 'Medium', description: 'Balances speed and reasoning depth' },
        { id: 'high', label: 'High', description: 'Greater reasoning depth for complex problems' },
        { id: 'xhigh', label: 'xHigh', description: 'Extra high reasoning depth' },
        { id: 'max', label: 'Max', description: 'Maximum reasoning depth' },
        { id: 'ultra', label: 'Ultra', description: 'Maximum depth with automatic task delegation' },
      ],
      defaultEffort: 'medium',
      discoveredFrom: 'Codex CLI Configuration',
    },
    {
      id: 'gpt-6-astra',
      name: 'GPT-6-Astra',
      description: 'Frontier intelligence for the most demanding work',
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      reasoningEffortOptions: [
        { id: 'low', label: 'Low', description: 'Fast responses with lighter reasoning' },
        { id: 'medium', label: 'Medium', description: 'Balances speed and reasoning depth' },
        { id: 'high', label: 'High', description: 'Greater reasoning depth for complex problems' },
        { id: 'xhigh', label: 'xHigh', description: 'Extra high reasoning depth' },
        { id: 'max', label: 'Max', description: 'Maximum reasoning depth' },
        { id: 'ultra', label: 'Ultra', description: 'Maximum depth with automatic task delegation' },
      ],
      defaultEffort: 'low',
      discoveredFrom: 'Codex CLI Configuration',
    },
    {
      id: 'gpt-6-luna',
      name: 'GPT-6-Luna',
      description: 'Fast and affordable model for easier tasks',
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultEffort: 'medium',
      discoveredFrom: 'Codex CLI Configuration',
    },
    {
      id: 'gpt-5.6-sol',
      name: 'GPT-5.6-Sol',
      description: 'Older coding model for complex work',
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      defaultEffort: 'medium',
      discoveredFrom: 'Codex CLI Configuration',
    },
    {
      id: 'gpt-5.5',
      name: 'GPT-5.5',
      description: 'Legacy agent coding model',
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'xhigh',
      discoveredFrom: 'Codex CLI Configuration',
    },
  ];
}

// Discover options for Agy CLI
async function discoverAgyModels(): Promise<ModelOption[]> {
  const cliPath = resolveCliPath('agy');
  const env = getCrossPlatformEnv();
  const isWin = process.platform === 'win32';

  const agyEfforts = ['low', 'medium', 'high', 'max'];
  const agyEffortOptions: ReasoningEffortOption[] = [
    { id: 'low', label: 'Low', description: 'Fast responses with light reasoning' },
    { id: 'medium', label: 'Medium', description: 'Balanced speed and reasoning depth' },
    { id: 'high', label: 'High', description: 'Greater reasoning depth for complex problems' },
    { id: 'max', label: 'Max', description: 'Maximum thinking compute for deepest reasoning' },
  ];

  try {
    if (fs.existsSync(cliPath) || (isWin && resolveCliPath('agy') !== 'agy')) {
      const out = execSync(`"${cliPath}" models`, {
        encoding: 'utf-8',
        env,
        shell: isWin ? (process.env.ComSpec || 'cmd.exe') : '/bin/bash',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 10000,
      });

      const lines = out.split(/\r?\n/).filter(Boolean);
      const discoveredIds = new Set<string>();

      for (const line of lines) {
        const clean = line.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|Fetching available models\.\.\./g, '').trim();
        if (clean && !clean.startsWith('Available') && !clean.startsWith('-')) {
          const parts = clean.split(/\t+|\s{2,}/);
          if (parts[0]) {
            discoveredIds.add(parts[0].trim());
          }
        }
      }

      // Group into canonical base models with full reasoning efforts
      const models: ModelOption[] = [];

      // Check for Gemini 3.8 Flash
      if (Array.from(discoveredIds).some((id) => id.includes('gemini-3.8-flash'))) {
        models.push({
          id: 'gemini-3.8-flash',
          name: 'Gemini 3.8 Flash (Recommended)',
          description: 'Frontier Gemini multimodal agent with extended thinking compute',
          reasoningEfforts: agyEfforts,
          reasoningEffortOptions: agyEffortOptions,
          defaultEffort: 'high',
          discoveredFrom: 'Antigravity CLI (agy models)',
        });
      }

      // Check for Gemini 3.7 Flash
      if (Array.from(discoveredIds).some((id) => id.includes('gemini-3.7-flash'))) {
        models.push({
          id: 'gemini-3.7-flash',
          name: 'Gemini 3.7 Flash',
          description: 'Hybrid reasoning and high-speed coding execution',
          reasoningEfforts: agyEfforts,
          reasoningEffortOptions: agyEffortOptions,
          defaultEffort: 'high',
          discoveredFrom: 'Antigravity CLI (agy models)',
        });
      }

      // Check for Gemini 3.6 Flash
      if (Array.from(discoveredIds).some((id) => id.includes('gemini-3.6-flash'))) {
        models.push({
          id: 'gemini-3.6-flash',
          name: 'Gemini 3.6 Flash',
          description: 'High throughput, responsive agent coding',
          reasoningEfforts: ['low', 'medium', 'high'],
          reasoningEffortOptions: agyEffortOptions.filter((e) => e.id !== 'max'),
          defaultEffort: 'medium',
          discoveredFrom: 'Antigravity CLI (agy models)',
        });
      }

      // Check for Gemini 3.1 Pro
      if (Array.from(discoveredIds).some((id) => id.includes('gemini-3.1-pro'))) {
        models.push({
          id: 'gemini-3.1-pro',
          name: 'Gemini 3.1 Pro',
          description: 'Deep multi-step reasoning for difficult problems',
          reasoningEfforts: ['low', 'high'],
          reasoningEffortOptions: agyEffortOptions.filter((e) => e.id === 'low' || e.id === 'high'),
          defaultEffort: 'high',
          discoveredFrom: 'Antigravity CLI (agy models)',
        });
      }

      if (models.length > 0) return models;
    }
  } catch {
    // Fallback if agy models command fails
  }

  // Fallback defaults for Agy CLI
  return [
    {
      id: 'gemini-3.8-flash',
      name: 'Gemini 3.8 Flash (Recommended)',
      description: 'Frontier Gemini multimodal agent with extended thinking compute',
      reasoningEfforts: agyEfforts,
      reasoningEffortOptions: agyEffortOptions,
      defaultEffort: 'high',
      discoveredFrom: 'Antigravity CLI Defaults',
    },
    {
      id: 'gemini-3.7-flash',
      name: 'Gemini 3.7 Flash',
      description: 'Hybrid reasoning and high-speed coding execution',
      reasoningEfforts: agyEfforts,
      reasoningEffortOptions: agyEffortOptions,
      defaultEffort: 'high',
      discoveredFrom: 'Antigravity CLI Defaults',
    },
    {
      id: 'gemini-3.6-flash',
      name: 'Gemini 3.6 Flash',
      description: 'High throughput, responsive agent coding',
      reasoningEfforts: ['low', 'medium', 'high'],
      reasoningEffortOptions: agyEffortOptions.filter((e) => e.id !== 'max'),
      defaultEffort: 'medium',
      discoveredFrom: 'Antigravity CLI Defaults',
    },
    {
      id: 'gemini-3.1-pro',
      name: 'Gemini 3.1 Pro',
      description: 'Deep multi-step reasoning for difficult problems',
      reasoningEfforts: ['low', 'high'],
      reasoningEffortOptions: agyEffortOptions.filter((e) => e.id === 'low' || e.id === 'high'),
      defaultEffort: 'high',
      discoveredFrom: 'Antigravity CLI Defaults',
    },
  ];
}

// Discover options for Claude Code CLI
async function discoverClaudeModels(): Promise<ModelOption[]> {
  const claudeHome = os.homedir();
  const configPath = path.join(claudeHome, '.claude.json');

  const claudeEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];
  const claudeEffortOptions: ReasoningEffortOption[] = [
    { id: 'low', label: 'Low', description: 'Fast responses with light reasoning' },
    { id: 'medium', label: 'Medium', description: 'Balanced speed and reasoning depth' },
    { id: 'high', label: 'High', description: 'Deep reasoning for complex logic' },
    { id: 'xhigh', label: 'xHigh', description: 'Extra high reasoning depth' },
    { id: 'max', label: 'Max', description: 'Maximum thinking compute' },
  ];

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const data = JSON.parse(raw);
      const accessCache: Array<{ apiName: string; entitled: boolean }> = Array.isArray(data.modelAccessCache)
        ? data.modelAccessCache
        : [];
      const entitledSet = new Set(accessCache.filter((m) => m.entitled).map((m) => m.apiName));

      const models: ModelOption[] = [];

      // 1. Claude Sonnet 5 (Recommended / Default)
      if (entitledSet.has('claude-sonnet-5') || data.orgModelDefaultCache?.name === 'claude-sonnet-5') {
        models.push({
          id: 'claude-sonnet-5',
          name: 'Claude Sonnet 5 (Recommended)',
          description: 'Flagship model for high-speed coding, refactoring, and reasoning',
          reasoningEfforts: claudeEfforts,
          reasoningEffortOptions: claudeEffortOptions,
          defaultEffort: 'medium',
          discoveredFrom: 'Claude Code CLI Discovery (~/.claude.json)',
        });
      }

      // 2. Claude Fable 5.1
      if (entitledSet.has('claude-fable-5-1') || entitledSet.has('claude-fable-5')) {
        models.push({
          id: 'claude-fable-5-1',
          name: 'Claude Fable 5.1',
          description: 'Most capable model for hardest and longest-running tasks',
          reasoningEfforts: claudeEfforts,
          reasoningEffortOptions: claudeEffortOptions,
          defaultEffort: 'high',
          discoveredFrom: 'Claude Code CLI Discovery (~/.claude.json)',
        });
      }

      // 3. Claude Opus 5
      if (entitledSet.has('claude-opus-5')) {
        models.push({
          id: 'claude-opus-5',
          name: 'Claude Opus 5',
          description: 'Deep conceptual reasoning, system architecture, and complex refactors',
          reasoningEfforts: claudeEfforts,
          reasoningEffortOptions: claudeEffortOptions,
          defaultEffort: 'high',
          discoveredFrom: 'Claude Code CLI Discovery (~/.claude.json)',
        });
      }

      // 4. Claude Opus 4.8
      if (entitledSet.has('claude-opus-4-8')) {
        models.push({
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          description: 'Advanced reasoning and complex workflows',
          reasoningEfforts: ['low', 'medium', 'high', 'max'],
          reasoningEffortOptions: claudeEffortOptions.filter((e) => e.id !== 'xhigh'),
          defaultEffort: 'medium',
          discoveredFrom: 'Claude Code CLI Discovery (~/.claude.json)',
        });
      }

      // 5. Claude Sonnet 4.6
      if (entitledSet.has('claude-sonnet-4-6')) {
        models.push({
          id: 'claude-sonnet-4-6',
          name: 'Claude Sonnet 4.6',
          description: 'Fast, reliable coding model',
          reasoningEfforts: ['low', 'medium', 'high', 'max'],
          reasoningEffortOptions: claudeEffortOptions.filter((e) => e.id !== 'xhigh'),
          defaultEffort: 'medium',
          discoveredFrom: 'Claude Code CLI Discovery (~/.claude.json)',
        });
      }

      // 6. Claude Haiku 4.5
      if (entitledSet.has('claude-haiku-4-5-20251001')) {
        models.push({
          id: 'claude-haiku-4-5-20251001',
          name: 'Claude Haiku 4.5',
          description: 'Lightweight, ultra-fast generation and exploration',
          reasoningEfforts: ['none'],
          reasoningEffortOptions: [{ id: 'none', label: 'None', description: 'Standard fast output' }],
          defaultEffort: 'none',
          discoveredFrom: 'Claude Code CLI Discovery (~/.claude.json)',
        });
      }

      // 7. Claude 3 Opus
      if (entitledSet.has('claude-3-opus-20240229')) {
        models.push({
          id: 'claude-3-opus-20240229',
          name: 'Claude 3 Opus',
          description: 'Legacy conceptual design model',
          reasoningEfforts: ['none'],
          reasoningEffortOptions: [{ id: 'none', label: 'None', description: 'Standard generation' }],
          defaultEffort: 'none',
          discoveredFrom: 'Claude Code CLI Discovery (~/.claude.json)',
        });
      }

      if (models.length > 0) return models;
    } catch (err) {
      console.error('Failed to read ~/.claude.json:', err);
    }
  }

  // Fallback defaults for Claude Code CLI
  return [
    {
      id: 'claude-sonnet-5',
      name: 'Claude Sonnet 5 (Recommended)',
      description: 'Flagship model for high-speed coding, refactoring, and reasoning',
      reasoningEfforts: claudeEfforts,
      reasoningEffortOptions: claudeEffortOptions,
      defaultEffort: 'medium',
      discoveredFrom: 'Claude Code CLI Discovery',
    },
    {
      id: 'claude-fable-5-1',
      name: 'Claude Fable 5.1',
      description: 'Most capable model for hardest and longest-running tasks',
      reasoningEfforts: claudeEfforts,
      reasoningEffortOptions: claudeEffortOptions,
      defaultEffort: 'high',
      discoveredFrom: 'Claude Code CLI Discovery',
    },
    {
      id: 'claude-opus-5',
      name: 'Claude Opus 5',
      description: 'Deep conceptual reasoning, system architecture, and complex refactors',
      reasoningEfforts: claudeEfforts,
      reasoningEffortOptions: claudeEffortOptions,
      defaultEffort: 'high',
      discoveredFrom: 'Claude Code CLI Discovery',
    },
    {
      id: 'claude-haiku-4-5-20251001',
      name: 'Claude Haiku 4.5',
      description: 'Lightweight, ultra-fast generation and exploration',
      reasoningEfforts: ['none'],
      reasoningEffortOptions: [{ id: 'none', label: 'None', description: 'Standard fast output' }],
      defaultEffort: 'none',
      discoveredFrom: 'Claude Code CLI Discovery',
    },
  ];
}

export interface StreamEvent {
  type: 'chunk' | 'thought' | 'tool' | 'status' | 'error' | 'done';
  content?: string;
  metadata?: any;
}

// Spawns an agent CLI process with streaming output
export function spawnAgentCli(
  cliName: string,
  args: string[],
  cwd: string,
  onEvent: (event: StreamEvent) => void
): ChildProcess {
  const cliPath = resolveCliPath(cliName);
  const env = getCrossPlatformEnv();
  const isWin = process.platform === 'win32';
  const isScript = cliPath.endsWith('.cmd') || cliPath.endsWith('.bat');

  const proc = spawn(cliPath, args, {
    cwd,
    env,
    shell: isWin ? isScript : false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  proc.stdout?.on('data', (data: Buffer) => {
    const raw = data.toString('utf-8');
    // Check if JSON stream lines
    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type || parsed.event || parsed.role) {
          onEvent({
            type: parsed.type === 'thought' ? 'thought' : 'chunk',
            content: parsed.content || parsed.text || JSON.stringify(parsed),
            metadata: parsed,
          });
          continue;
        }
      } catch {
        // Not a single JSON line, stream as text chunk
      }
    }
    onEvent({ type: 'chunk', content: raw });
  });

  proc.stderr?.on('data', (data: Buffer) => {
    const text = data.toString('utf-8');
    onEvent({ type: 'chunk', content: text });
  });

  proc.on('close', (code) => {
    onEvent({ type: 'done', content: `Process exited with code ${code}`, metadata: { code } });
  });

  proc.on('error', (err) => {
    onEvent({ type: 'error', content: err.message });
  });

  return proc;
}

// Discovery Agent: analyzes a project to auto-detect dev, build, test, and conventions
export async function runDiscoveryAgent(
  projectPath: string,
  cliName: string,
  model?: string,
  onEvent?: (event: StreamEvent) => void
): Promise<{
  dev_cmd: string;
  dev_port: number;
  build_cmd: string;
  test_cmd: string;
  branch_convention: string;
  summary: string;
}> {
  const emit = onEvent || (() => {});
  emit({ type: 'status', content: `Starting discovery with ${cliName}...` });

  const discoveryPrompt = `Analyze this repository to determine:
1. The command to run the local development server (e.g., "npm run dev", "npm start", "cargo run", etc.)
2. The default localhost port the dev server runs on (e.g., 5173, 3000, 8080)
3. The build command (e.g., "npm run build", "cargo build")
4. The test command (e.g., "npm test")
5. The git branch convention (main branch name, e.g., "main" or "master")

Inspect package.json, Makefile, Cargo.toml, or whatever config files are present.
Output your final answer ONLY as a JSON object at the very end in the exact format:
\`\`\`json
{
  "dev_cmd": "npm run dev",
  "dev_port": 5173,
  "build_cmd": "npm run build",
  "test_cmd": "npm test",
  "branch_convention": "main",
  "summary": "Vite + React project running on port 5173"
}
\`\`\``;

  let collectedOutput = '';

  const args: string[] = [];
  if (cliName === 'agy') {
    args.push('-p', discoveryPrompt);
    if (model) args.push('--model', model);
    args.push('--dangerously-skip-permissions');
  } else if (cliName === 'claude') {
    args.push('-p', discoveryPrompt);
    if (model) args.push('--model', model);
    args.push('--dangerously-skip-permissions');
  } else {
    // codex
    args.push('exec', discoveryPrompt);
    if (model) args.push('--model', model);
    args.push('-c', 'service_tier="fast"');
  }

  await new Promise<void>((resolve) => {
    const proc = spawnAgentCli(cliName, args, projectPath, (ev) => {
      emit(ev);
      if (ev.content) collectedOutput += ev.content;
      if (ev.type === 'done' || ev.type === 'error') {
        resolve();
      }
    });

    // Timeout protection after 45 seconds
    setTimeout(() => {
      try {
        proc.kill();
      } catch {}
      resolve();
    }, 45000);
  });

  // Parse JSON from output
  const jsonMatch = collectedOutput.match(/```json\s*([\s\S]*?)\s*```/) || collectedOutput.match(/(\{[\s\S]*"dev_cmd"[\s\S]*\})/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      return {
        dev_cmd: parsed.dev_cmd || 'npm run dev',
        dev_port: Number(parsed.dev_port) || 5173,
        build_cmd: parsed.build_cmd || 'npm run build',
        test_cmd: parsed.test_cmd || 'npm test',
        branch_convention: parsed.branch_convention || 'main',
        summary: parsed.summary || 'Auto-discovered project configuration',
      };
    } catch {
      // Fallback
    }
  }

  // Fallback heuristic if agent didn't provide strict JSON
  let dev_cmd = 'npm run dev';
  let dev_port = 5173;
  let build_cmd = 'npm run build';
  let test_cmd = 'npm test';
  let branch_convention = 'main';

  const pkgJsonPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      if (pkg.scripts) {
        if (pkg.scripts.dev) dev_cmd = 'npm run dev';
        else if (pkg.scripts.start) dev_cmd = 'npm start';
        if (pkg.scripts.build) build_cmd = 'npm run build';
        if (pkg.scripts.test) test_cmd = 'npm test';
      }
    } catch {}
  }

  return {
    dev_cmd,
    dev_port,
    build_cmd,
    test_cmd,
    branch_convention,
    summary: 'Discovered via repository configuration files',
  };
}

// Rebase Agent: pulls base branch from remote and rebases current branch
export function runRebaseAgent(
  worktreePath: string,
  baseBranch: string,
  cliName: string,
  model?: string,
  onEvent?: (event: StreamEvent) => void
): ChildProcess {
  const emit = onEvent || (() => {});
  emit({ type: 'status', content: `Pulling ${baseBranch} and rebasing...` });

  const rebasePrompt = `Pull the base branch "${baseBranch}" from remote origin and rebase the current branch onto origin/${baseBranch}. If any conflicts arise, inspect the conflicting files and resolve the merge conflicts so that git rebase --continue finishes successfully and the repository is left in a clean rebased state. Output a clear summary of what was done.`;

  const args: string[] = [];
  if (cliName === 'agy') {
    args.push('-p', rebasePrompt);
    if (model) args.push('--model', model);
    args.push('--dangerously-skip-permissions');
  } else if (cliName === 'claude') {
    args.push('-p', rebasePrompt);
    if (model) args.push('--model', model);
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('exec', rebasePrompt);
    if (model) args.push('--model', model);
    args.push('-c', 'service_tier="fast"');
  }

  return spawnAgentCli(cliName, args, worktreePath, emit);
}

// Submit Changes Agent: commits and pushes branch
export function runSubmitAgent(
  worktreePath: string,
  branchName: string,
  commitMessage: string,
  cliName: string,
  model?: string,
  onEvent?: (event: StreamEvent) => void
): ChildProcess {
  const emit = onEvent || (() => {});
  emit({ type: 'status', content: `Submitting changes...` });

  const submitPrompt = `Stage all changes, create a git commit with the message "${commitMessage.replace(/"/g, '\\"')}", and push the branch "${branchName}" to origin. If remote branch does not exist yet, push with -u origin ${branchName}. Output a confirmation when complete.`;

  const args: string[] = [];
  if (cliName === 'agy') {
    args.push('-p', submitPrompt);
    if (model) args.push('--model', model);
    args.push('--dangerously-skip-permissions');
  } else if (cliName === 'claude') {
    args.push('-p', submitPrompt);
    if (model) args.push('--model', model);
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('exec', submitPrompt);
    if (model) args.push('--model', model);
    args.push('-c', 'service_tier="fast"');
  }

  return spawnAgentCli(cliName, args, worktreePath, emit);
}
