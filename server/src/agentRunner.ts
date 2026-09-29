import { spawn, execSync, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db, findGitAccountForRemote } from './db.js';
import { GitService, sanitizeBranchName } from './gitService.js';

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

// Regex detecting authentication required, OAuth session expiry, and login prompts across CLIs
export const AUTH_REQUIRED_REGEX =
  /oauth session expired|failed to authenticate|sign in again|login required|authentication required|not logged in|please sign in|run `?claude`? to sign in|run `?codex login`?|codex login required|authentication failed|credentials expired|google authentication required/i;

// Regex detecting true spend cap, budget exhaustion, or quota limit errors (avoiding loose false positives on words like 'budget' or 'spend cap' in regular text)
export const SPEND_CAP_REGEX =
  /(?:^|\b)(?:you(?: have|'ve)? hit your spend cap|spend cap set by the owner|exceeded your (?:monthly |current )?budget|insufficient_quota|credit balance is too low|usage cap (?:reached|exceeded)|your quota has been exceeded)(?:\b|$)/i;

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
    PYTHONUNBUFFERED: '1',
    FORCE_COLOR: '0',
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
  onData(`[raft] Starting installation of ${cliName.toUpperCase()} CLI...\r\n`);
  onData(`[raft] Operating System: ${isWin ? 'Windows' : 'macOS / Linux'}\r\n`);
  onData(`[raft] Command: ${rawCmd}\r\n\r\n`);

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
      onData(`\r\n[raft] Process exited with status code ${code}\r\n`);
      modelsCache.clear();
      resolve({ code });
    });
    proc.on('error', (err) => {
      onData(`\r\n[raft] Execution error: ${err.message}\r\n`);
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
  const catalogDir = path.join(claudeHome, '.claude', 'cache', 'model-catalog');
  const configPath = path.join(claudeHome, '.claude.json');

  const claudeEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];
  const claudeEffortOptions: ReasoningEffortOption[] = [
    { id: 'low', label: 'Low', description: 'Fast responses with light reasoning' },
    { id: 'medium', label: 'Medium', description: 'Balanced speed and reasoning depth' },
    { id: 'high', label: 'High', description: 'Deep reasoning for complex logic' },
    { id: 'xhigh', label: 'xHigh', description: 'Extra high reasoning depth' },
    { id: 'max', label: 'Max', description: 'Maximum thinking compute' },
  ];

  const familySlogans: Record<string, string> = {
    opus: 'Best for everyday, complex tasks',
    sonnet: 'Efficient for routine tasks',
    haiku: 'Fastest for quick answers',
    fable: 'Most capable for your hardest and longest-running tasks',
  };

  const getFamilySlogan = (id: string): string => {
    const idLower = id.toLowerCase();
    for (const [k, v] of Object.entries(familySlogans)) {
      if (idLower.includes(k)) return v;
    }
    return 'Advanced AI model';
  };

  // 1. Try reading dynamic served catalog cache from ~/.claude/cache/model-catalog
  if (fs.existsSync(catalogDir)) {
    try {
      const files = fs.readdirSync(catalogDir).filter((f) => f.endsWith('.json'));
      files.sort((a, b) => {
        try {
          return (
            fs.statSync(path.join(catalogDir, b)).mtimeMs -
            fs.statSync(path.join(catalogDir, a)).mtimeMs
          );
        } catch {
          return 0;
        }
      });

      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(catalogDir, file), 'utf-8');
          const data = JSON.parse(raw);
          const catModels: any[] = data.catalog?.config?.models;
          const catState = data.catalog?.state;

          if (Array.isArray(catModels) && catModels.length > 0) {
            const defaultModelId = catState?.model || 'claude-opus-5-5';
            const models: ModelOption[] = [];

            for (const m of catModels) {
              const isRecommended = m.id === defaultModelId;
              const cleanName = m.name?.startsWith('Claude ') ? m.name : `Claude ${m.name || m.id}`;
              const name = isRecommended ? `${cleanName} (Recommended)` : cleanName;
              const description = m.description || getFamilySlogan(m.id);

              let reasoningEfforts = claudeEfforts;
              let reasoningEffortOptions = claudeEffortOptions;
              let defaultEffort = 'medium';

              if (m.thinking?.type === 'none') {
                reasoningEfforts = ['none'];
                reasoningEffortOptions = [{ id: 'none', label: 'None', description: 'Standard fast output' }];
                defaultEffort = 'none';
              } else if (Array.isArray(m.thinking?.effort_options) && m.thinking.effort_options.length > 0) {
                reasoningEfforts = m.thinking.effort_options.map((o: any) => o.id);
                reasoningEffortOptions = m.thinking.effort_options.map((o: any) => ({
                  id: o.id,
                  label: o.name || (o.id === 'xhigh' ? 'xHigh' : o.id.charAt(0).toUpperCase() + o.id.slice(1)),
                  description:
                    claudeEffortOptions.find((eo) => eo.id === o.id)?.description ||
                    `${o.id} reasoning effort`,
                }));
                const defOpt = m.thinking.effort_options.find(
                  (o: any) => o.badge?.message?.toLowerCase() === 'default'
                );
                defaultEffort =
                  (isRecommended && catState?.thinking?.effort) || defOpt?.id || 'medium';
              }

              models.push({
                id: m.id,
                name,
                description,
                reasoningEfforts,
                reasoningEffortOptions,
                defaultEffort,
                discoveredFrom: 'Claude Code CLI Discovery (~/.claude.json)',
              });
            }

            // Also check ~/.claude.json for legacy models like claude-3-opus-20240229 if entitled
            if (fs.existsSync(configPath)) {
              try {
                const confRaw = fs.readFileSync(configPath, 'utf-8');
                const confData = JSON.parse(confRaw);
                const accessCache: Array<{ apiName: string; entitled: boolean }> = Array.isArray(
                  confData.modelAccessCache
                )
                  ? confData.modelAccessCache
                  : [];
                const entitledSet = new Set(
                  accessCache.filter((x) => x.entitled).map((x) => x.apiName)
                );
                if (entitledSet.has('claude-3-opus-20240229') && !models.some((x) => x.id === 'claude-3-opus-20240229')) {
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
              } catch {}
            }

            if (models.length > 0) return models;
          }
        } catch {}
      }
    } catch (err) {
      console.error('Failed to read ~/.claude/cache/model-catalog:', err);
    }
  }

  // 2. Fallback to ~/.claude.json modelAccessCache if catalog cache is unavailable
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const data = JSON.parse(raw);
      const accessCache: Array<{ apiName: string; entitled: boolean }> = Array.isArray(data.modelAccessCache)
        ? data.modelAccessCache
        : [];
      const entitledSet = new Set(accessCache.filter((m) => m.entitled).map((m) => m.apiName));

      const models: ModelOption[] = [];
      const defaultModelId =
        data.orgModelDefaultCache?.override_user_selection && data.orgModelDefaultCache?.name
          ? data.orgModelDefaultCache.name
          : entitledSet.has('claude-opus-5-5')
          ? 'claude-opus-5-5'
          : 'claude-sonnet-5';

      const candidateModels = [
        {
          id: 'claude-opus-5-5',
          name: 'Claude Opus 5.5',
          description: 'Most capable for ambitious work',
          reasoningEfforts: claudeEfforts,
          reasoningEffortOptions: claudeEffortOptions,
          defaultEffort: 'medium',
        },
        {
          id: 'claude-opus-5',
          name: 'Claude Opus 5',
          description: 'For complex tasks',
          reasoningEfforts: claudeEfforts,
          reasoningEffortOptions: claudeEffortOptions,
          defaultEffort: 'high',
        },
        {
          id: 'claude-sonnet-5',
          name: 'Claude Sonnet 5',
          description: 'Most efficient for everyday tasks',
          reasoningEfforts: claudeEfforts,
          reasoningEffortOptions: claudeEffortOptions,
          defaultEffort: 'high',
        },
        {
          id: 'claude-fable-5-1',
          name: 'Claude Fable 5.1',
          description: 'For your toughest challenges',
          reasoningEfforts: claudeEfforts,
          reasoningEffortOptions: claudeEffortOptions,
          defaultEffort: 'high',
        },
        {
          id: 'claude-haiku-4-5-20251001',
          name: 'Claude Haiku 4.5',
          description: 'Fastest for quick answers',
          reasoningEfforts: ['none'],
          reasoningEffortOptions: [{ id: 'none', label: 'None', description: 'Standard fast output' }],
          defaultEffort: 'none',
        },
        {
          id: 'claude-fable-5',
          name: 'Claude Fable 5',
          description: 'Most capable for your hardest and longest-running tasks',
          reasoningEfforts: claudeEfforts,
          reasoningEffortOptions: claudeEffortOptions,
          defaultEffort: 'high',
        },
        {
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          description: 'Best for everyday, complex tasks',
          reasoningEfforts: claudeEfforts,
          reasoningEffortOptions: claudeEffortOptions,
          defaultEffort: 'high',
        },
        {
          id: 'claude-opus-4-7',
          name: 'Claude Opus 4.7',
          description: 'Best for everyday, complex tasks',
          reasoningEfforts: claudeEfforts,
          reasoningEffortOptions: claudeEffortOptions,
          defaultEffort: 'xhigh',
        },
        {
          id: 'claude-opus-4-6',
          name: 'Claude Opus 4.6',
          description: 'Best for everyday, complex tasks',
          reasoningEfforts: ['low', 'medium', 'high', 'max'],
          reasoningEffortOptions: claudeEffortOptions.filter((e) => e.id !== 'xhigh'),
          defaultEffort: 'high',
        },
        {
          id: 'claude-sonnet-4-6',
          name: 'Claude Sonnet 4.6',
          description: 'Efficient for routine tasks',
          reasoningEfforts: ['low', 'medium', 'high', 'max'],
          reasoningEffortOptions: claudeEffortOptions.filter((e) => e.id !== 'xhigh'),
          defaultEffort: 'high',
        },
        {
          id: 'claude-3-opus-20240229',
          name: 'Claude 3 Opus',
          description: 'Legacy conceptual design model',
          reasoningEfforts: ['none'],
          reasoningEffortOptions: [{ id: 'none', label: 'None', description: 'Standard generation' }],
          defaultEffort: 'none',
        },
      ];

      for (const m of candidateModels) {
        if (entitledSet.has(m.id) || m.id === defaultModelId) {
          const isRecommended = m.id === defaultModelId;
          models.push({
            id: m.id,
            name: isRecommended ? `${m.name} (Recommended)` : m.name,
            description: m.description,
            reasoningEfforts: m.reasoningEfforts,
            reasoningEffortOptions: m.reasoningEffortOptions,
            defaultEffort: m.defaultEffort,
            discoveredFrom: 'Claude Code CLI Discovery (~/.claude.json)',
          });
        }
      }

      if (models.length > 0) return models;
    } catch (err) {
      console.error('Failed to read ~/.claude.json:', err);
    }
  }

  // 3. Fallback defaults for Claude Code CLI
  return [
    {
      id: 'claude-opus-5-5',
      name: 'Claude Opus 5.5 (Recommended)',
      description: 'Most capable for ambitious work · Best for everyday, complex tasks',
      reasoningEfforts: claudeEfforts,
      reasoningEffortOptions: claudeEffortOptions,
      defaultEffort: 'medium',
      discoveredFrom: 'Claude Code CLI Discovery',
    },
    {
      id: 'claude-opus-5',
      name: 'Claude Opus 5',
      description: 'For complex tasks',
      reasoningEfforts: claudeEfforts,
      reasoningEffortOptions: claudeEffortOptions,
      defaultEffort: 'high',
      discoveredFrom: 'Claude Code CLI Discovery',
    },
    {
      id: 'claude-sonnet-5',
      name: 'Claude Sonnet 5',
      description: 'Most efficient for everyday tasks',
      reasoningEfforts: claudeEfforts,
      reasoningEffortOptions: claudeEffortOptions,
      defaultEffort: 'high',
      discoveredFrom: 'Claude Code CLI Discovery',
    },
    {
      id: 'claude-fable-5-1',
      name: 'Claude Fable 5.1',
      description: 'For your toughest challenges',
      reasoningEfforts: claudeEfforts,
      reasoningEffortOptions: claudeEffortOptions,
      defaultEffort: 'high',
      discoveredFrom: 'Claude Code CLI Discovery',
    },
    {
      id: 'claude-haiku-4-5-20251001',
      name: 'Claude Haiku 4.5',
      description: 'Fastest for quick answers',
      reasoningEfforts: ['none'],
      reasoningEffortOptions: [{ id: 'none', label: 'None', description: 'Standard fast output' }],
      defaultEffort: 'none',
      discoveredFrom: 'Claude Code CLI Discovery',
    },
    {
      id: 'claude-fable-5',
      name: 'Claude Fable 5',
      description: 'Most capable for your hardest and longest-running tasks',
      reasoningEfforts: claudeEfforts,
      reasoningEffortOptions: claudeEffortOptions,
      defaultEffort: 'high',
      discoveredFrom: 'Claude Code CLI Discovery',
    },
    {
      id: 'claude-opus-4-8',
      name: 'Claude Opus 4.8',
      description: 'Best for everyday, complex tasks',
      reasoningEfforts: claudeEfforts,
      reasoningEffortOptions: claudeEffortOptions,
      defaultEffort: 'high',
      discoveredFrom: 'Claude Code CLI Discovery',
    },
  ];
}

export function stripAnsi(text: string): string {
  if (!text) return '';
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

export interface AgentStep {
  id: string;
  type: 'tool' | 'thought';
  toolName?: string;
  category: 'command' | 'file_read' | 'file_write' | 'search' | 'browser' | 'other';
  title: string;
  detail?: string;
  status: 'running' | 'completed' | 'failed';
  duration?: number;
  output?: string;
  error?: string;
  thought?: string;
  startTime?: number;
  endTime?: number;
}

export function truncateOutput(output: any, maxBytes = 100 * 1024): string {
  if (!output) return '';
  let str = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  str = stripAnsi(str);
  if (str.length > maxBytes) {
    str = str.slice(0, maxBytes) + `\n... [Output truncated (exceeded ${Math.round(maxBytes / 1024)}KB)]`;
  }
  return str;
}

export function parseLegacyActionLine(line: string, index = 0): AgentStep | null {
  const clean = stripAnsi(line).trim();
  if (!clean) return null;
  const isArrow = clean.startsWith('→');
  const text = clean.replace(/^[→\s]+/, '').trim();
  if (!text) return null;

  if (text.startsWith('Run:')) {
    const cmd = text.slice(4).trim();
    return {
      id: `legacy-${index}`,
      type: 'tool',
      toolName: 'run_command',
      category: 'command',
      title: `Run: ${cmd}`,
      detail: cmd,
      status: 'completed',
    };
  }
  if (text.toLowerCase().startsWith('view file:') || text.toLowerCase().startsWith('view:')) {
    const file = text.split(':')[1]?.trim() || '';
    return {
      id: `legacy-${index}`,
      type: 'tool',
      toolName: 'view_file',
      category: 'file_read',
      title: `View: ${path.basename(file) || file}`,
      detail: file,
      status: 'completed',
    };
  }
  if (text.toLowerCase().startsWith('edit file:') || text.toLowerCase().startsWith('edit:') || text.toLowerCase().startsWith('replace file:')) {
    const file = text.split(':')[1]?.trim() || '';
    return {
      id: `legacy-${index}`,
      type: 'tool',
      toolName: 'replace_file_content',
      category: 'file_write',
      title: `Edit: ${path.basename(file) || file}`,
      detail: file,
      status: 'completed',
    };
  }
  if (text.startsWith('Search:')) {
    const q = text.slice(7).trim().replace(/^["']|["']$/g, '');
    return {
      id: `legacy-${index}`,
      type: 'tool',
      toolName: 'search',
      category: 'search',
      title: `Search: "${q}"`,
      detail: q,
      status: 'completed',
    };
  }
  if (isArrow) {
    const category = /grep|find|search/i.test(text)
      ? 'search'
      : /git|npm|cargo|bun|pnpm|python|yarn|docker|sh|bash/i.test(text)
      ? 'command'
      : /file|types\.|service\./i.test(text)
      ? 'file_read'
      : 'other';
    return {
      id: `legacy-${index}`,
      type: 'tool',
      toolName: text.split(' ')[0] || 'action',
      category,
      title: text,
      detail: text,
      status: 'completed',
    };
  }
  return null;
}

export function parseLegacyThoughtToSteps(thoughtText: string): AgentStep[] {
  if (!thoughtText) return [];
  const lines = thoughtText.split('\n');
  const steps: AgentStep[] = [];
  let currentThought = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parsedStep = parseLegacyActionLine(line, i);
    if (parsedStep) {
      if (currentThought.trim()) {
        steps.push({
          id: `thought-${steps.length}`,
          type: 'thought',
          category: 'other',
          title: 'Reasoning',
          status: 'completed',
          thought: currentThought.trim(),
        });
        currentThought = '';
      }
      steps.push(parsedStep);
    } else if (line.trim()) {
      currentThought += (currentThought ? '\n' : '') + line;
    }
  }

  if (currentThought.trim()) {
    steps.push({
      id: `thought-${steps.length}`,
      type: 'thought',
      category: 'other',
      title: 'Reasoning',
      status: 'completed',
      thought: currentThought.trim(),
    });
  }

  return steps;
}

export interface StreamEvent {
  type: 'chunk' | 'thought' | 'tool' | 'status' | 'error' | 'done' | 'step';
  content?: string;
  metadata?: any;
  conversationId?: string;
  step?: AgentStep;
}

// Builds a clean previous conversation context block when no native CLI session can be resumed
export function buildConversationContextFallback(
  messages: Array<{ role: string; content: string }>,
  currentPrompt: string,
  maxTurns: number = 8
): string {
  if (!messages || messages.length === 0) {
    return currentPrompt;
  }

  // Filter out any empty messages
  const relevant = messages.filter((m) => m.content && m.content.trim().length > 0);
  if (relevant.length === 0) {
    return currentPrompt;
  }

  // Take the last N messages
  const recent = relevant.slice(-maxTurns);

  // Strip large <thought> blocks from previous turns to keep prompt clean
  const formattedTurns = recent
    .map((m) => {
      let text = m.content;
      text = text.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
      const speaker = m.role === 'user' ? 'User' : 'Assistant';
      return `${speaker}: ${text}`;
    })
    .filter((line) => line.length > 0)
    .join('\n\n');

  if (!formattedTurns.trim()) {
    return currentPrompt;
  }

  return `[Previous Conversation History]\n${formattedTurns}\n\n[Current User Message]\n${currentPrompt}`;
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

  if (!cwd || !fs.existsSync(cwd)) {
    const errorMsg = `Cannot start ${cliName}: working directory "${cwd}" does not exist on disk.`;
    const dummyProc = new EventEmitter() as ChildProcess;
    (dummyProc as any).stdin = { end: () => {} };
    (dummyProc as any).stdout = new EventEmitter();
    (dummyProc as any).stderr = new EventEmitter();
    (dummyProc as any).kill = () => false;

    setImmediate(() => {
      onEvent({ type: 'error', content: errorMsg });
      onEvent({ type: 'done', content: `\nProcess aborted: ${errorMsg}\n`, metadata: { code: 1 } });
      dummyProc.emit('error', new Error(errorMsg));
      dummyProc.emit('close', 1);
    });

    return dummyProc;
  }

  const proc = spawn(cliPath, args, {
    cwd,
    env,
    shell: isWin ? isScript : false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Close stdin immediately so non-interactive tools (like codex exec) don't hang waiting for stdin
  proc.stdin?.end();

  let lineBuffer = '';
  let hasStreamedDeltas = false;
  let lastReportedConversationId: string | null = null;

  proc.stdout?.on('data', (data: Buffer) => {
    lineBuffer += data.toString('utf-8');
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let handled = false;
      try {
        const parsed = JSON.parse(trimmed);
        if (
          parsed.event ||
          parsed.type ||
          parsed.role ||
          parsed.conversation_id ||
          parsed.thread_id ||
          parsed.session_id
        ) {
          handled = true;

          // Extract conversation/thread ID across CLIs (agy: conversation_id, codex: thread_id, claude: session_id)
          const detectedConversationId =
            parsed.conversation_id ||
            parsed.thread_id ||
            parsed.session_id ||
            parsed.step_update?.conversation_id ||
            parsed.result?.conversation_id ||
            parsed.result?.session_id;

          if (detectedConversationId && detectedConversationId !== lastReportedConversationId) {
            lastReportedConversationId = detectedConversationId;
            onEvent({
              type: 'status',
              content: '',
              metadata: { conversationId: detectedConversationId, ...parsed },
              conversationId: detectedConversationId,
            });
          }

          // Check for error events in JSON stream (Codex / Claude / etc.)
          if (parsed.type === 'error' || parsed.type === 'turn.failed') {
            const errorMsg = parsed.message || parsed.error?.message || 'Agent execution failed';
            const cleanMsg = stripAnsi(errorMsg).trim();
            const isSpendCap = SPEND_CAP_REGEX.test(cleanMsg);
            const isAuthRequired = AUTH_REQUIRED_REGEX.test(cleanMsg);
            onEvent({
              type: 'error',
              content: cleanMsg,
              metadata: {
                ...parsed,
                isSpendCap,
                isAuthRequired,
                errorType: isSpendCap ? 'spend_cap' : (isAuthRequired ? 'auth_required' : 'agent_error'),
              },
              conversationId: detectedConversationId,
            });
            continue;
          }

          // In Codex CLI, configuration warnings are emitted as item.completed with item.type === "error" or "warning"
          if (
            parsed.type === 'item.completed' &&
            parsed.item &&
            (parsed.item.type === 'error' || parsed.item.type === 'warning')
          ) {
            const warningMsg = parsed.item.message || '';
            if (
              warningMsg.includes('unrecognized configuration setting') ||
              warningMsg.includes('windows_wsl_setup_acknowledged') ||
              warningMsg.includes('deprecated')
            ) {
              continue;
            }
          }

          // Handle agy stream-json format
          if (parsed.event === 'init') {
            // Handled conversationId above
          } else if (parsed.event === 'step_update') {
            const step = parsed.step_update;
            if (step) {
              const stepId = step.step_index !== undefined ? `agy-step-${step.step_index}` : `agy-step-${Date.now()}`;
              if (step.step_type === 'tool') {
                const toolName = step.tool_name || step.tool_info?.name || 'tool';
                const params = step.tool_info?.parameters || {};
                let desc = '';
                let category: AgentStep['category'] = 'other';
                let detail = '';

                if (params.CommandLine) {
                  category = 'command';
                  detail = params.CommandLine;
                  desc = `Run: ${params.CommandLine}`;
                } else if (params.AbsolutePath || params.TargetFile) {
                  const target = params.AbsolutePath || params.TargetFile;
                  const basename = path.basename(target) || target;
                  detail = target;
                  if (toolName.includes('write') || toolName.includes('replace') || toolName.includes('edit') || toolName.includes('sed')) {
                    category = 'file_write';
                    desc = `Edit: ${basename}`;
                  } else {
                    category = 'file_read';
                    desc = `${toolName.replace(/_/g, ' ')}: ${basename}`;
                  }
                } else if (params.query) {
                  category = 'search';
                  detail = params.query;
                  desc = `Search: "${params.query}"`;
                } else if (params.Url) {
                  category = toolName.startsWith('browser') ? 'browser' : 'file_read';
                  detail = params.Url;
                  desc = `Fetch: ${params.Url}`;
                } else if (toolName.startsWith('browser')) {
                  category = 'browser';
                  detail = JSON.stringify(params);
                  desc = `Browser: ${toolName.replace(/^browser_/, '').replace(/_/g, ' ')}`;
                } else {
                  category = 'other';
                  detail = JSON.stringify(params);
                  desc = toolName.replace(/_/g, ' ');
                }

                if (step.state === 'ACTIVE') {
                  const agentStep: AgentStep = {
                    id: stepId,
                    type: 'tool',
                    toolName,
                    category,
                    title: desc,
                    detail,
                    status: 'running',
                    startTime: Date.now(),
                  };

                  onEvent({
                    type: 'step',
                    step: agentStep,
                    metadata: parsed,
                    conversationId: detectedConversationId,
                  });

                  onEvent({
                    type: 'thought',
                    content: `→ ${desc}\n`,
                    metadata: parsed,
                    conversationId: detectedConversationId,
                  });
                } else if (step.state === 'DONE' || step.state === 'ERROR') {
                  const rawOutput = step.tool_info?.output || '';
                  const cleanOut = truncateOutput(rawOutput);
                  const isErr = step.state === 'ERROR' || Boolean(step.tool_info?.error) || /command failed|exit code [1-9]|error:/i.test(cleanOut);

                  const agentStep: AgentStep = {
                    id: stepId,
                    type: 'tool',
                    toolName,
                    category,
                    title: desc,
                    detail,
                    status: isErr ? 'failed' : 'completed',
                    duration: typeof step.duration_seconds === 'number' ? Math.round(step.duration_seconds * 10) / 10 : undefined,
                    output: cleanOut,
                    error: step.tool_info?.error,
                    endTime: Date.now(),
                  };

                  onEvent({
                    type: 'step',
                    step: agentStep,
                    metadata: parsed,
                    conversationId: detectedConversationId,
                  });
                }
              } else if (step.step_type === 'thought' || step.thought || step.reasoning) {
                const thoughtText = step.thought || step.reasoning || step.text || '';
                if (thoughtText) {
                  const agentStep: AgentStep = {
                    id: `agy-thought-${step.step_index ?? Date.now()}`,
                    type: 'thought',
                    category: 'other',
                    title: 'Reasoning',
                    thought: thoughtText,
                    status: step.state === 'DONE' ? 'completed' : 'running',
                    startTime: Date.now(),
                  };
                  onEvent({
                    type: 'step',
                    step: agentStep,
                    metadata: parsed,
                    conversationId: detectedConversationId,
                  });
                }
              } else if (step.step_type === 'agent_response' && step.text_delta) {
                hasStreamedDeltas = true;
                onEvent({
                  type: 'chunk',
                  content: step.text_delta,
                  metadata: parsed,
                  conversationId: detectedConversationId,
                });
              }
            }
          } else if (parsed.event === 'result') {
            const finalResponse = parsed.result?.response;
            if (finalResponse) {
              onEvent({
                type: 'chunk',
                content: finalResponse,
                metadata: { ...parsed, isFinalResult: true },
                conversationId: detectedConversationId,
              });
            }
          } else if (parsed.type || parsed.role) {
            // General JSON event (Claude, Codex, etc.)
            if (parsed.type === 'item.started' && parsed.item) {
              const item = parsed.item;
              if (item.type === 'command_execution') {
                const cmd = item.command || '';
                const agentStep: AgentStep = {
                  id: item.id || `codex-cmd-${Date.now()}`,
                  type: 'tool',
                  toolName: 'command_execution',
                  category: 'command',
                  title: `Run: ${cmd}`,
                  detail: cmd,
                  status: 'running',
                  startTime: Date.now(),
                };
                onEvent({ type: 'step', step: agentStep, metadata: parsed, conversationId: detectedConversationId });
                onEvent({ type: 'thought', content: `→ Run: ${cmd}\n`, metadata: parsed, conversationId: detectedConversationId });
              } else if (item.type === 'reasoning') {
                const agentStep: AgentStep = {
                  id: item.id || `codex-reason-${Date.now()}`,
                  type: 'thought',
                  category: 'other',
                  title: 'Reasoning',
                  status: 'running',
                  startTime: Date.now(),
                };
                onEvent({ type: 'step', step: agentStep, metadata: parsed, conversationId: detectedConversationId });
              }
            } else if (parsed.type === 'item.completed' && parsed.item) {
              const item = parsed.item;
              if (item.type === 'command_execution') {
                const cmd = item.command || '';
                const isErr = item.exit_code !== undefined && item.exit_code !== 0;
                const agentStep: AgentStep = {
                  id: item.id || `codex-cmd-${Date.now()}`,
                  type: 'tool',
                  toolName: 'command_execution',
                  category: 'command',
                  title: `Run: ${cmd}`,
                  detail: cmd,
                  status: isErr ? 'failed' : 'completed',
                  duration: item.duration_ms ? Math.round((item.duration_ms / 1000) * 10) / 10 : undefined,
                  output: truncateOutput(item.output || ''),
                  endTime: Date.now(),
                };
                onEvent({ type: 'step', step: agentStep, metadata: parsed, conversationId: detectedConversationId });
              } else if (item.type === 'file_change') {
                const filePath = item.path || 'file';
                const basename = path.basename(filePath);
                const agentStep: AgentStep = {
                  id: item.id || `codex-file-${Date.now()}`,
                  type: 'tool',
                  toolName: 'file_change',
                  category: 'file_write',
                  title: `Edit: ${basename}`,
                  detail: filePath,
                  status: 'completed',
                  output: truncateOutput(item.diff || ''),
                  endTime: Date.now(),
                };
                onEvent({ type: 'step', step: agentStep, metadata: parsed, conversationId: detectedConversationId });
                onEvent({ type: 'thought', content: `→ edit file: ${basename}\n`, metadata: parsed, conversationId: detectedConversationId });
              } else if (item.type === 'reasoning') {
                const agentStep: AgentStep = {
                  id: item.id || `codex-reason-${Date.now()}`,
                  type: 'thought',
                  category: 'other',
                  title: 'Reasoning',
                  thought: item.text || '',
                  status: 'completed',
                  endTime: Date.now(),
                };
                onEvent({ type: 'step', step: agentStep, metadata: parsed, conversationId: detectedConversationId });
              } else if (item.type === 'message' && item.text) {
                onEvent({
                  type: 'chunk',
                  content: item.text,
                  metadata: parsed,
                  conversationId: detectedConversationId,
                });
              }
            } else if (parsed.type === 'item.delta' && parsed.delta) {
              const text = parsed.delta.text;
              if (text) {
                onEvent({
                  type: 'chunk',
                  content: text,
                  metadata: parsed,
                  conversationId: detectedConversationId,
                });
              }
            } else if (parsed.type === 'tool_use') {
              const toolName = parsed.name || 'tool';
              const params = parsed.input || {};
              const title = params.CommandLine ? `Run: ${params.CommandLine}` : params.path || params.file ? `File: ${path.basename(params.path || params.file)}` : toolName;
              const agentStep: AgentStep = {
                id: parsed.id || `claude-tool-${Date.now()}`,
                type: 'tool',
                toolName,
                category: params.CommandLine ? 'command' : 'other',
                title,
                detail: params.CommandLine || JSON.stringify(params),
                status: 'running',
                startTime: Date.now(),
              };
              onEvent({ type: 'step', step: agentStep, metadata: parsed, conversationId: detectedConversationId });
              onEvent({ type: 'thought', content: `→ ${title}\n`, metadata: parsed, conversationId: detectedConversationId });
            } else if (parsed.type === 'tool_result') {
              const agentStep: AgentStep = {
                id: parsed.tool_use_id || parsed.id || `claude-tool-${Date.now()}`,
                type: 'tool',
                category: 'other',
                title: 'Tool execution',
                status: parsed.is_error ? 'failed' : 'completed',
                output: truncateOutput(parsed.content || parsed.output || ''),
                endTime: Date.now(),
              };
              onEvent({ type: 'step', step: agentStep, metadata: parsed, conversationId: detectedConversationId });
            } else {
              const content =
                parsed.content ||
                parsed.text ||
                parsed.delta?.text ||
                parsed.item?.text ||
                (parsed.item?.message ? parsed.item.message : undefined);
              if (content) {
                onEvent({
                  type: parsed.type === 'thought' ? 'thought' : 'chunk',
                  content: typeof content === 'string' ? content : JSON.stringify(content),
                  metadata: parsed,
                  conversationId: detectedConversationId,
                });
              }
            }
          }
        }
      } catch {
        // Not a JSON line
      }

      if (!handled) {
        const cleanLine = stripAnsi(line).trim();
        if (!cleanLine) continue;

        // Check if line is an action/step line (e.g. `→ Run: ...`)
        const parsedLegacy = parseLegacyActionLine(cleanLine);
        if (parsedLegacy) {
          onEvent({
            type: 'step',
            step: parsedLegacy,
            metadata: { legacy: true },
            conversationId: lastReportedConversationId || undefined,
          });
          onEvent({
            type: 'thought',
            content: cleanLine + '\n',
            metadata: { legacy: true },
            conversationId: lastReportedConversationId || undefined,
          });
          continue;
        }

        // Filter out CLI startup banners and headers (e.g. Codex / Claude terminal headers)
        if (
          cleanLine.startsWith('Reading additional input from stdin') ||
          cleanLine.startsWith('OpenAI Codex v') ||
          cleanLine === '--------' ||
          cleanLine.startsWith('workdir:') ||
          cleanLine.startsWith('model:') ||
          cleanLine.startsWith('provider:') ||
          cleanLine.startsWith('approval:') ||
          cleanLine.startsWith('sandbox:') ||
          cleanLine.startsWith('reasoning effort:') ||
          cleanLine.startsWith('reasoning summaries:') ||
          cleanLine.startsWith('session id:') ||
          cleanLine === 'user' ||
          cleanLine.startsWith('user (') ||
          cleanLine.includes('windows_wsl_setup_acknowledged is ignored')
        ) {
          continue;
        }

        // Check for spend cap or fatal error in plain text output
        if (SPEND_CAP_REGEX.test(cleanLine)) {
          const match = cleanLine.match(/(?:ERROR:\s*)?(You hit your spend cap[^.\n]*\.[^\n]*|.*budget[^.\n]*\.[^\n]*)/i);
          const msg = match ? match[1].trim() : cleanLine;
          onEvent({
            type: 'error',
            content: msg,
            metadata: { isSpendCap: true, errorType: 'spend_cap' },
          });
          continue;
        }

        // Check for authentication / login required error in plain text output
        if (AUTH_REQUIRED_REGEX.test(cleanLine)) {
          onEvent({
            type: 'error',
            content: cleanLine,
            metadata: { isAuthRequired: true, errorType: 'auth_required' },
          });
          continue;
        }

        onEvent({ type: 'chunk', content: cleanLine + '\n' });
      }
    }
  });

  proc.stdout?.on('end', () => {
    if (lineBuffer.trim()) {
      try {
        const parsed = JSON.parse(lineBuffer.trim());
        if (parsed.event === 'result' && !hasStreamedDeltas && parsed.result?.response) {
          onEvent({ type: 'chunk', content: parsed.result.response, metadata: parsed });
        } else if (parsed.event !== 'step_update') {
          onEvent({ type: 'chunk', content: lineBuffer });
        }
      } catch {
        const clean = stripAnsi(lineBuffer).trim();
        if (clean && !clean.startsWith('Reading additional input')) {
          if (AUTH_REQUIRED_REGEX.test(clean)) {
            onEvent({
              type: 'error',
              content: clean,
              metadata: { isAuthRequired: true, errorType: 'auth_required' },
            });
          } else if (SPEND_CAP_REGEX.test(clean)) {
            onEvent({
              type: 'error',
              content: clean,
              metadata: { isSpendCap: true, errorType: 'spend_cap' },
            });
          } else {
            onEvent({ type: 'chunk', content: clean });
          }
        }
      }
    }
  });

  proc.stderr?.on('data', (data: Buffer) => {
    const raw = data.toString('utf-8');
    const clean = stripAnsi(raw).trim();
    if (!clean) return;

    // Filter out internal transport and config noise
    if (
      clean.includes('windows_wsl_setup_acknowledged') ||
      clean.includes('rmcp::transport::worker') ||
      clean.includes('Transport channel closed') ||
      clean.includes('No Authorization: Bearer') ||
      clean.includes('deprecated settings')
    ) {
      return;
    }

    // Check if stderr contains a spend cap or budget limit error
    if (SPEND_CAP_REGEX.test(clean)) {
      const match = clean.match(/(?:ERROR:\s*)?(You hit your spend cap[^.\n]*\.[^\n]*|.*budget[^.\n]*\.[^\n]*)/i);
      const msg = match ? match[1].trim() : clean;
      onEvent({
        type: 'error',
        content: msg,
        metadata: { isSpendCap: true, errorType: 'spend_cap' },
      });
      return;
    }

    // Check if stderr contains auth required or login required error
    if (AUTH_REQUIRED_REGEX.test(clean)) {
      onEvent({
        type: 'error',
        content: clean,
        metadata: { isAuthRequired: true, errorType: 'auth_required' },
      });
      return;
    }

    // Non-fatal stderr diagnostic goes into thought stream so it doesn't pollute assistant content
    onEvent({ type: 'thought', content: clean + '\n' });
  });

  proc.on('close', (code) => {
    onEvent({ type: 'done', content: `\nProcess completed (exit code ${code ?? 0})\n`, metadata: { code } });
  });

  proc.on('error', (err) => {
    let msg = err.message;
    if ((err as any).code === 'ENOENT' || msg.includes('ENOENT')) {
      if (!fs.existsSync(cwd)) {
        msg = `Working directory "${cwd}" does not exist on disk.`;
      } else if (!fs.existsSync(cliPath)) {
        msg = `Agent CLI "${cliName}" binary not found at "${cliPath}".`;
      }
    }
    onEvent({ type: 'error', content: msg });
  });

  return proc;
}

export function detectInstallCommand(projectPath: string): string {
  try {
    if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) {
      return 'pnpm install';
    }
    if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) {
      return 'yarn install';
    }
    if (fs.existsSync(path.join(projectPath, 'bun.lockb')) || fs.existsSync(path.join(projectPath, 'bun.lock'))) {
      return 'bun install';
    }
    if (fs.existsSync(path.join(projectPath, 'package-lock.json')) || fs.existsSync(path.join(projectPath, 'package.json'))) {
      return 'npm install';
    }
    if (fs.existsSync(path.join(projectPath, 'requirements.txt'))) {
      return 'pip install -r requirements.txt';
    }
    if (fs.existsSync(path.join(projectPath, 'Pipfile'))) {
      return 'pipenv install';
    }
    if (fs.existsSync(path.join(projectPath, 'pyproject.toml'))) {
      if (fs.existsSync(path.join(projectPath, 'poetry.lock'))) {
        return 'poetry install';
      }
      return 'pip install -e .';
    }
    if (fs.existsSync(path.join(projectPath, 'Cargo.toml'))) {
      return 'cargo build';
    }
    if (fs.existsSync(path.join(projectPath, 'go.mod'))) {
      return 'go mod download';
    }
  } catch {}
  return 'npm install';
}

// Discovery Agent: analyzes a project to auto-detect dev, build, test, and conventions
export async function runDiscoveryAgent(
  projectPath: string,
  cliName: string,
  model?: string,
  thinkingEffortOrOnEvent?: string | ((event: StreamEvent) => void),
  onEvent?: (event: StreamEvent) => void
): Promise<{
  dev_cmd: string;
  dev_port: number;
  build_cmd: string;
  test_cmd: string;
  install_cmd: string;
  branch_convention: string;
  summary: string;
}> {
  let thinkingEffort: string | undefined;
  let emit: (event: StreamEvent) => void;
  if (typeof thinkingEffortOrOnEvent === 'function') {
    emit = thinkingEffortOrOnEvent;
    thinkingEffort = undefined;
  } else {
    thinkingEffort = thinkingEffortOrOnEvent;
    emit = onEvent || (() => {});
  }

  emit({ type: 'status', content: `Starting discovery with ${cliName}...\n` });

  const discoveryPrompt = `Quickly inspect the top-level repository configuration files (such as package.json, Makefile, Cargo.toml, README.md, etc.) to determine:
1. The command to run the local development server (e.g., "npm run dev", "npm start", "cargo run", etc.)
2. The default localhost port the dev server runs on (e.g., 5173, 3000, 8080)
3. The build command (e.g., "npm run build", "cargo build")
4. The test command (e.g., "npm test", "npm run test", or "npm test" as default)
5. The dependency installation command (e.g., "npm install", "pnpm install", "yarn install", etc.)
6. The git branch convention (e.g., "main" or "master")

Important instructions:
- Keep your analysis quick and concise. Read the root config files first.
- If a command is not explicitly found, use the standard convention (e.g. "npm test") rather than searching git history.
- Provide your final answer as a JSON block at the end in this format:
\`\`\`json
{
  "dev_cmd": "npm run dev",
  "dev_port": 5173,
  "build_cmd": "npm run build",
  "test_cmd": "npm test",
  "install_cmd": "npm install",
  "branch_convention": "main",
  "summary": "Brief 1-line description of project"
}
\`\`\``;

  let collectedOutput = '';

  const args: string[] = [];
  if (cliName === 'agy') {
    args.push('-p', discoveryPrompt);
    if (model) args.push('--model', model);
    const effort = (thinkingEffort && thinkingEffort !== 'none') ? thinkingEffort : 'medium';
    args.push('--effort', effort);
    args.push('--output-format', 'stream-json');
    args.push('--dangerously-skip-permissions');
  } else if (cliName === 'claude') {
    args.push('-p', discoveryPrompt);
    if (model) args.push('--model', model);
    if (thinkingEffort && thinkingEffort !== 'none') args.push('--effort', thinkingEffort);
    args.push('--dangerously-skip-permissions');
  } else {
    // codex
    args.push('exec', discoveryPrompt);
    if (model) args.push('--model', model);
    if (thinkingEffort && thinkingEffort !== 'none') {
      args.push('-c', `model_reasoning_effort="${thinkingEffort}"`);
    }
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

    // Timeout protection after 120 seconds
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
      resolve();
    }, 120000);

    proc.on('close', () => {
      clearTimeout(timer);
    });
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
        install_cmd: parsed.install_cmd || detectInstallCommand(projectPath),
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
  let install_cmd = detectInstallCommand(projectPath);
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
    install_cmd,
    branch_convention,
    summary: 'Discovered via repository configuration files',
  };
}

// Rebase Agent: pulls base branch from remote, syncs local base branch, and rebases current branch cleanly
export function runRebaseAgent(
  worktreePath: string,
  baseBranch: string,
  cliName: string,
  model?: string,
  thinkingEffortOrOnEvent?: string | ((event: StreamEvent) => void),
  onEvent?: (event: StreamEvent) => void,
  repoRoot?: string,
  branchName?: string
): { kill: (signal?: any) => void } {
  let thinkingEffort: string | undefined;
  let emit: (event: StreamEvent) => void;
  if (typeof thinkingEffortOrOnEvent === 'function') {
    emit = thinkingEffortOrOnEvent;
    thinkingEffort = undefined;
  } else {
    thinkingEffort = thinkingEffortOrOnEvent;
    emit = onEvent || (() => {});
  }

  let activeChild: any = null;
  let isCancelled = false;

  const kill = (sig: any = 'SIGINT') => {
    isCancelled = true;
    if (activeChild) {
      try {
        activeChild.kill(sig);
      } catch {}
    }
    try {
      execSync('git rebase --abort', { cwd: worktreePath, stdio: 'ignore' });
    } catch {}
  };

  // Run rebase asynchronously so callers can attach listeners / cancel immediately
  (async () => {
    try {
      emit({ type: 'status', content: `Syncing ${baseBranch} and rebasing...` });

      // 1. Resolve current branch
      let currentBranch = branchName || '';
      if (!currentBranch) {
        try {
          currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: worktreePath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }).trim();
        } catch {
          currentBranch = 'HEAD';
        }
      }

      // 2. Resolve main repo root
      let mainRepo = repoRoot;
      if (!mainRepo || !fs.existsSync(mainRepo)) {
        try {
          const commonDir = execSync('git rev-parse --git-common-dir', {
            cwd: worktreePath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }).trim();
          const resolvedCommon = path.isAbsolute(commonDir) ? commonDir : path.resolve(worktreePath, commonDir);
          mainRepo = path.dirname(resolvedCommon);
        } catch {
          mainRepo = worktreePath;
        }
      }

      if (isCancelled) return;

      // 3. Check for remote
      const targetRemote = GitService.getRemoteForBranch(worktreePath, baseBranch);
      let hasRemote = false;
      try {
        const remotes = execSync('git remote', {
          cwd: worktreePath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim().split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
        hasRemote = remotes.includes(targetRemote);
      } catch {}

      // 4. Fetch remote and update local base branch
      if (hasRemote) {
        emit({ type: 'status', content: `Fetching ${targetRemote}/${baseBranch}...` });
        emit({ type: 'chunk', content: `→ git fetch ${targetRemote} ${baseBranch}` });

        try {
          execSync(`git fetch ${targetRemote} ${baseBranch}`, {
            cwd: worktreePath,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          emit({ type: 'chunk', content: `✓ Fetched latest ${targetRemote}/${baseBranch}` });
        } catch (fetchErr: any) {
          emit({ type: 'chunk', content: `→ Notice: Could not fetch ${targetRemote}/${baseBranch}: ${fetchErr.message?.split('\n')[0]}` });
        }

        if (isCancelled) return;

        // Try fast-forwarding the local baseBranch
        let rootCurrentBranch = '';
        try {
          rootCurrentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: mainRepo,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }).trim();
        } catch {}

        if (rootCurrentBranch === baseBranch) {
          try {
            const ffOut = execSync(`git merge --ff-only ${targetRemote}/${baseBranch}`, {
              cwd: mainRepo,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
            }).trim();
            if (ffOut && !ffOut.includes('Already up to date')) {
              emit({ type: 'chunk', content: `✓ Fast-forwarded local base branch "${baseBranch}" in primary repository (${ffOut})` });
            } else {
              emit({ type: 'chunk', content: `✓ Local base branch "${baseBranch}" is up to date with ${targetRemote}` });
            }
          } catch {
            emit({ type: 'chunk', content: `→ Local base branch "${baseBranch}" has unpushed commits or working changes; rebasing will cleanly incorporate local "${baseBranch}"` });
          }
        } else {
          try {
            execSync(`git fetch ${targetRemote} ${baseBranch}:${baseBranch}`, {
              cwd: worktreePath,
              stdio: ['pipe', 'pipe', 'pipe'],
            });
            emit({ type: 'chunk', content: `✓ Updated local ref "${baseBranch}" to ${targetRemote}/${baseBranch}` });
          } catch {
            // Local base branch may have diverged or be ahead
          }
        }
      }

      if (isCancelled) return;

      // 5. Ensure local base branch exists
      try {
        execSync(`git rev-parse --verify ${baseBranch}`, {
          cwd: worktreePath,
          stdio: ['pipe', 'pipe', 'ignore'],
        });
      } catch {
        if (hasRemote) {
          try {
            execSync(`git branch --track ${baseBranch} ${targetRemote}/${baseBranch}`, {
              cwd: worktreePath,
              stdio: ['pipe', 'pipe', 'pipe'],
            });
            emit({ type: 'chunk', content: `✓ Created local branch "${baseBranch}" tracking "${targetRemote}/${baseBranch}"` });
          } catch {
            emit({ type: 'error', content: `Base branch "${baseBranch}" could not be found locally or on ${targetRemote}.` });
            return;
          }
        } else {
          emit({ type: 'error', content: `Base branch "${baseBranch}" does not exist.` });
          return;
        }
      }

      // 6. Check if current branch is already up to date with base branch
      let isAlreadyUpToDate = false;
      try {
        execSync(`git merge-base --is-ancestor ${baseBranch} HEAD`, {
          cwd: worktreePath,
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        isAlreadyUpToDate = true;
      } catch {
        isAlreadyUpToDate = false;
      }

      if (isAlreadyUpToDate) {
        emit({ type: 'chunk', content: `✓ Branch "${currentBranch}" is already up to date with base branch "${baseBranch}".` });
        emit({ type: 'status', content: `Already up to date with ${baseBranch}.` });
        emit({ type: 'done', content: `Rebase complete: "${currentBranch}" is already up to date with "${baseBranch}".` });
        return;
      }

      if (isCancelled) return;

      // 7. Deterministic rebase onto local baseBranch (incorporating local commits like ea6caf1)
      emit({ type: 'status', content: `Rebasing ${currentBranch} onto ${baseBranch}...` });
      emit({ type: 'chunk', content: `→ git rebase --autostash ${baseBranch}` });

      let rebaseSuccess = false;
      let rebaseOutput = '';

      try {
        const out = execSync(`git rebase --autostash ${baseBranch}`, {
          cwd: worktreePath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        rebaseSuccess = true;
        rebaseOutput = out;
      } catch (err: any) {
        rebaseSuccess = false;
        rebaseOutput = (err.stdout?.toString() || '') + '\n' + (err.stderr?.toString() || '');
      }

      if (isCancelled) return;

      if (rebaseSuccess) {
        if (rebaseOutput.trim()) {
          emit({ type: 'chunk', content: rebaseOutput.trim() });
        }
        emit({ type: 'chunk', content: `✓ Successfully rebased "${currentBranch}" onto "${baseBranch}" with zero conflicts!` });
        emit({ type: 'status', content: `Rebase complete!` });
        emit({ type: 'done', content: `Rebase complete: "${currentBranch}" was cleanly rebased onto "${baseBranch}".` });
        return;
      }

      // 8. Rebase failed - check if it stopped due to merge conflicts
      let hasConflicts = false;
      try {
        const status = execSync('git status', {
          cwd: worktreePath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        hasConflicts =
          status.includes('rebase in progress') ||
          status.includes('You are currently rebasing') ||
          status.includes('both modified:');
      } catch {}

      if (!hasConflicts) {
        emit({ type: 'error', content: `Git rebase failed:\n${rebaseOutput.trim() || 'Unknown git error'}` });
        return;
      }

      // 9. Merge conflicts detected! Launch AI Agent with focused prompt
      emit({ type: 'status', content: `Merge conflicts detected. Launching AI agent to resolve conflicts...` });
      emit({ type: 'chunk', content: `⚠️ Merge conflicts encountered during rebase of "${currentBranch}" onto "${baseBranch}". Launching AI agent to resolve conflicts...` });

      const conflictPrompt = `The git rebase of branch "${currentBranch}" onto "${baseBranch}" encountered merge conflicts and is currently in progress.
Resolve all merge conflicts cleanly:
1. Run "git status" to list unmerged / conflicted files.
2. For each conflicted file, inspect the conflict markers (<<<<<<<, =======, >>>>>>>) and diffs, and edit the file to cleanly resolve the conflicts preserving intended functionality from both branches.
3. Stage each resolved file using "git add <file>".
4. Continue the rebase with "git -c core.editor=true rebase --continue" or "git rebase --continue --no-edit".
5. If subsequent commits also have conflicts, repeat steps 1-4 until the rebase completes successfully.
6. If an autostash causes conflicts upon popping, resolve those conflicts and unstage/clean up as needed.
Do NOT run git checkout, git pull, git fetch, git fsck, test suites, or reflog. Focus strictly on resolving the merge conflicts and running git rebase --continue.
Output a clear summary of which conflicts were resolved and confirm the rebase is cleanly completed.`;

      const args: string[] = [];
      if (cliName === 'agy') {
        args.push('-p', conflictPrompt);
        if (model) args.push('--model', model);
        const effort = (thinkingEffort && thinkingEffort !== 'none') ? thinkingEffort : 'medium';
        args.push('--effort', effort);
        args.push('--output-format', 'stream-json');
        args.push('--dangerously-skip-permissions');
      } else if (cliName === 'claude') {
        args.push('-p', conflictPrompt);
        if (model) args.push('--model', model);
        if (thinkingEffort && thinkingEffort !== 'none') args.push('--effort', thinkingEffort);
        args.push('--dangerously-skip-permissions');
      } else {
        args.push('exec', conflictPrompt);
        if (model) args.push('--model', model);
        if (thinkingEffort && thinkingEffort !== 'none') {
          args.push('-c', `model_reasoning_effort="${thinkingEffort}"`);
        }
        args.push('-c', 'service_tier="fast"');
      }

      activeChild = spawnAgentCli(cliName, args, worktreePath, emit);
    } catch (topErr: any) {
      emit({ type: 'error', content: `Unexpected error during rebase: ${topErr.message}` });
    }
  })();

  return { kill };
}

// Submit Changes Agent: commits and pushes branch
// Helper to detect Github username from remote URL or git config
export function detectGitUsername(worktreePath: string): string | undefined {
  try {
    const remoteUrl = execSync('git config --get remote.origin.url', {
      cwd: worktreePath,
      encoding: 'utf-8',
    }).trim();
    const match = remoteUrl.match(/github\.com[/:]([^/]+)\//i);
    if (match && match[1]) {
      return match[1];
    }
  } catch {}
  try {
    const user = execSync('git config --get user.name', {
      cwd: worktreePath,
      encoding: 'utf-8',
    }).trim();
    if (user) return user;
  } catch {}
  return undefined;
}

// Submit Changes: stages changes, creates commit, and pushes branch to origin
export function runSubmitAgent(
  worktreePath: string,
  branchName: string,
  commitMessage: string,
  _cliName?: string,
  _model?: string,
  thinkingEffortOrOnEvent?: string | ((event: StreamEvent) => void),
  onEventOrBaseBranch?: ((event: StreamEvent) => void) | string,
  baseBranch?: string
): { kill: (signal?: any) => void } {
  let emit: (event: StreamEvent) => void;
  let resolvedBaseBranch = baseBranch;
  if (typeof thinkingEffortOrOnEvent === 'function') {
    emit = thinkingEffortOrOnEvent;
    if (typeof onEventOrBaseBranch === 'string') {
      resolvedBaseBranch = onEventOrBaseBranch;
    }
  } else if (typeof onEventOrBaseBranch === 'function') {
    emit = onEventOrBaseBranch;
  } else {
    emit = () => {};
  }
  emit({ type: 'status', content: `Submitting changes...` });

  let currentChild: ChildProcess | null = null;
  let isKilled = false;

  const kill = () => {
    isKilled = true;
    if (currentChild) {
      try {
        currentChild.kill();
      } catch {}
    }
  };

  (async () => {
    try {
      // 1. Stage changes: git add -A
      emit({ type: 'thought', content: `→ Run: git add -A\n` });
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('git', ['add', '-A'], {
          cwd: worktreePath,
          env: getCrossPlatformEnv(),
          shell: false,
        });
        currentChild = proc;
        proc.stdout?.on('data', (d) => emit({ type: 'chunk', content: d.toString('utf-8') }));
        proc.stderr?.on('data', (d) => emit({ type: 'chunk', content: d.toString('utf-8') }));
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`git add failed with exit code ${code}`));
        });
        proc.on('error', reject);
      });

      if (isKilled) return;

      // 2. Commit changes (if there are staged changes)
      const status = GitService.getGitStatus(worktreePath);
      if (status.staged.length > 0) {
        emit({ type: 'thought', content: `→ Run: git commit\n` });
        const tempMsgPath = path.join(os.tmpdir(), `raft-commit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.txt`);
        fs.writeFileSync(tempMsgPath, commitMessage, 'utf-8');

        try {
          await new Promise<void>((resolve, reject) => {
            const proc = spawn('git', ['commit', '-F', tempMsgPath], {
              cwd: worktreePath,
              env: getCrossPlatformEnv(),
              shell: false,
            });
            currentChild = proc;
            proc.stdout?.on('data', (d) => emit({ type: 'chunk', content: d.toString('utf-8') }));
            proc.stderr?.on('data', (d) => emit({ type: 'chunk', content: d.toString('utf-8') }));
            proc.on('close', (code) => {
              if (code === 0) resolve();
              else reject(new Error(`git commit failed with exit code ${code}`));
            });
            proc.on('error', reject);
          });
        } finally {
          try {
            fs.unlinkSync(tempMsgPath);
          } catch {}
        }
      } else {
        emit({ type: 'chunk', content: `Working tree clean or changes already committed. Proceeding to push...\n` });
      }

      if (isKilled) return;

      // 3. Push branch to remote
      const targetRemote = GitService.getRemoteForBranch(worktreePath, resolvedBaseBranch || branchName);
      let remotes: string[] = [];
      try {
        remotes = execSync('git remote', {
          cwd: worktreePath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim().split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
      } catch {}

      if (remotes.length === 0) {
        throw new Error('No git remotes configured for this repository. Please configure a remote repository (e.g. git remote add origin <url>) before pushing.');
      }

      const remoteToUse = remotes.includes(targetRemote) ? targetRemote : (remotes.includes('origin') ? 'origin' : remotes[0]);
      const remoteUrl = GitService.getRemoteUrl(worktreePath, remoteToUse);

      const detectedUser = detectGitUsername(worktreePath);
      let gitAccount: any;
      try {
        gitAccount = findGitAccountForRemote(remoteUrl, detectedUser);
      } catch {}

      const pushArgs = ['push'];
      let tokenToMask = '';

      if (gitAccount && gitAccount.token) {
        tokenToMask = gitAccount.token;
        const userToAuth = gitAccount.username || detectedUser || 'git';
        const authBasic = Buffer.from(`${userToAuth}:${gitAccount.token}`).toString('base64');
        pushArgs.unshift('-c', `http.extraheader=AUTHORIZATION: basic ${authBasic}`);
        if (userToAuth) {
          pushArgs.unshift('-c', `credential.username=${userToAuth}`);
        }
        if (remoteUrl) {
          GitService.configureRepoCredentials(worktreePath, remoteUrl, gitAccount.token, userToAuth);
        }
      } else if (detectedUser) {
        pushArgs.unshift('-c', `credential.username=${detectedUser}`);
      }

      pushArgs.push('-u', remoteToUse, branchName);

      // Safe display command omitting authorization headers
      const displayArgs = pushArgs.filter((arg, idx, arr) => {
        if (arg.startsWith('http.extraheader=')) return false;
        if (idx > 0 && arr[idx - 1] === '-c' && arg.startsWith('http.extraheader=')) return false;
        if (arg === '-c' && idx + 1 < arr.length && arr[idx + 1].startsWith('http.extraheader=')) return false;
        return true;
      });

      emit({ type: 'thought', content: `→ Run: git ${displayArgs.join(' ')}\n` });

      const sanitize = (text: string) => {
        if (!tokenToMask) return text;
        return text.replaceAll(tokenToMask, '***');
      };

      await new Promise<void>((resolve, reject) => {
        const proc = spawn('git', pushArgs, {
          cwd: worktreePath,
          env: {
            ...getCrossPlatformEnv(),
            GIT_TERMINAL_PROMPT: '0',
          },
          shell: false,
        });
        currentChild = proc;
        proc.stdout?.on('data', (d) => emit({ type: 'chunk', content: sanitize(d.toString('utf-8')) }));
        proc.stderr?.on('data', (d) => emit({ type: 'chunk', content: sanitize(d.toString('utf-8')) }));
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`git push failed with exit code ${code}`));
        });
        proc.on('error', reject);
      });

      if (isKilled) return;

      emit({ type: 'status', content: `\n✓ Successfully pushed branch "${branchName}" to ${remoteToUse}!\n` });
      emit({ type: 'done', content: `\nSubmission completed successfully.\n` });
    } catch (err: any) {
      let errorMsg = err?.message || String(err);
      if (
        errorMsg.includes('Authentication failed') ||
        errorMsg.includes('could not read') ||
        errorMsg.includes('Password') ||
        errorMsg.includes('terminal prompts disabled') ||
        errorMsg.includes('Device not configured') ||
        errorMsg.includes('does not appear to be a git repository') ||
        errorMsg.includes('Could not read from remote repository')
      ) {
        errorMsg += '\nTip: Please verify that a valid Personal Access Token (PAT) with repo/write permissions is configured in Settings > Linked Git Accounts, and that the remote repository URL is reachable.';
      }
      emit({ type: 'error', content: `\n${errorMsg}\n` });
    }
  })();

  return { kill };
}

export interface CommitMessageResult {
  title: string;
  details?: string;
  isLargeChange: boolean;
  fullMessage: string;
}

// Commit Message Agent: analyzes diff and workspace changes to generate a conventional commit message & optional details
export async function runCommitMessageAgent(
  worktreePath: string,
  taskName: string,
  branchName: string,
  cliName: string,
  model?: string,
  thinkingEffortOrOnEvent?: string | ((event: StreamEvent) => void),
  onEvent?: (event: StreamEvent) => void
): Promise<CommitMessageResult> {
  let thinkingEffort: string | undefined;
  let emit: (event: StreamEvent) => void;
  if (typeof thinkingEffortOrOnEvent === 'function') {
    emit = thinkingEffortOrOnEvent;
    thinkingEffort = undefined;
  } else {
    thinkingEffort = thinkingEffortOrOnEvent;
    emit = onEvent || (() => {});
  }

  emit({ type: 'status', content: `Analyzing changes with ${cliName} to generate commit message...\n` });

  const status = GitService.getGitStatus(worktreePath);
  const allFiles = [...status.staged, ...status.unstaged, ...status.untracked];
  const totalChanges = allFiles.length;

  if (totalChanges === 0) {
    const defaultMsg = `chore(${sanitizeBranchName(taskName) || 'task'}): update task files`;
    return {
      title: defaultMsg,
      details: '',
      isLargeChange: false,
      fullMessage: defaultMsg,
    };
  }

  let diffText = GitService.getGitDiff(worktreePath);
  const maxDiffLength = 10000;
  const truncatedDiff = diffText.length > maxDiffLength
    ? diffText.slice(0, maxDiffLength) + '\n... (diff truncated for brevity)'
    : diffText;

  const fileSummary = allFiles.slice(0, 30).map((f) => `- ${f}`).join('\n') +
    (allFiles.length > 30 ? `\n- ... and ${allFiles.length - 30} more files` : '');

  const commitPrompt = `You are an expert Git commit assistant.
Inspect the pending git changes in this repository and generate a clean, accurate Git commit message.

Task Name: "${taskName}"
Branch Name: "${branchName}"

Pending Changed Files (${totalChanges}):
${fileSummary}

Git Diff Sample:
\`\`\`
${truncatedDiff}
\`\`\`

Strict Requirements:
1. "title": A concise conventional commit subject in the format: <type>(<scope>): <short imperative subject>
   - Allowed types: feat, fix, refactor, perf, test, chore, docs, style, build, ci
   - Scope should be concise and relevant to the modified code (e.g., workspace, auth, ui, api, tabs)
   - Imperative mood, lowercase, no trailing period, maximum 72 characters.
   - Example: "feat(workspace): support drag-and-drop temporary tabs to favorites"
   - Do NOT use generic placeholder text like "implement updates and automated changes" or "implement task features". Be specific to the code changes!
2. "isLargeChange": boolean. Set to true if the change touches 3 or more files, modifies multiple modules, or contains substantial new logic. Otherwise false.
3. "details": string.
   - If "isLargeChange" is true: Provide 2-5 concise bullet points explaining the key modifications, architectural additions, or test coverage.
   - If "isLargeChange" is false: Leave as an empty string "".

Output ONLY a JSON block enclosed in \`\`\`json ... \`\`\` matching this schema:
\`\`\`json
{
  "title": "<type>(<scope>): <short imperative subject>",
  "isLargeChange": true,
  "details": "- First key change\\n- Second key change"
}
\`\`\``;

  let collectedOutput = '';

  const args: string[] = [];
  if (cliName === 'agy') {
    args.push('-p', commitPrompt);
    if (model) args.push('--model', model);
    const effort = (thinkingEffort && thinkingEffort !== 'none') ? thinkingEffort : 'medium';
    args.push('--effort', effort);
    args.push('--output-format', 'stream-json');
    args.push('--dangerously-skip-permissions');
  } else if (cliName === 'claude') {
    args.push('-p', commitPrompt);
    if (model) args.push('--model', model);
    if (thinkingEffort && thinkingEffort !== 'none') args.push('--effort', thinkingEffort);
    args.push('--dangerously-skip-permissions');
  } else {
    // codex
    args.push('exec', commitPrompt);
    if (model) args.push('--model', model);
    if (thinkingEffort && thinkingEffort !== 'none') {
      args.push('-c', `model_reasoning_effort="${thinkingEffort}"`);
    }
    args.push('-c', 'service_tier="fast"');
  }

  await new Promise<void>((resolve) => {
    const proc = spawnAgentCli(cliName, args, worktreePath, (ev) => {
      emit(ev);
      if (ev.content) collectedOutput += ev.content;
      if (ev.type === 'done' || ev.type === 'error') {
        resolve();
      }
    });

    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
      resolve();
    }, 60000);

    proc.on('close', () => {
      clearTimeout(timer);
    });
  });

  // Extract JSON from output
  const jsonMatch = collectedOutput.match(/```json\s*([\s\S]*?)\s*```/) || collectedOutput.match(/(\{[\s\S]*"title"[\s\S]*\})/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const title = (parsed.title || '').trim().replace(/^["']|["']$/g, '');
      const details = (parsed.details || '').trim();
      const isLarge = Boolean(parsed.isLargeChange || (details && details.length > 0) || totalChanges >= 4);

      if (title) {
        const fullMessage = details ? `${title}\n\n${details}` : title;
        return {
          title,
          details,
          isLargeChange: isLarge,
          fullMessage,
        };
      }
    } catch {
      // Fallback below
    }
  }

  // Fallback heuristic if agent output wasn't strict JSON
  const ccMatch = collectedOutput.match(/(feat|fix|refactor|perf|test|chore|docs|style|build|ci)(\([^)]+\))?:\s*([^\n\r]+)/i);
  let fallbackTitle = '';
  if (ccMatch) {
    fallbackTitle = ccMatch[0].trim();
  } else {
    const scope = allFiles[0] ? path.basename(path.dirname(allFiles[0])) : sanitizeBranchName(taskName);
    fallbackTitle = `feat(${scope || 'core'}): ${taskName.replace(/^feat:?\s*/i, '')}`;
  }

  const isLarge = totalChanges >= 3;
  let fallbackDetails = '';
  if (isLarge) {
    fallbackDetails = allFiles.slice(0, 5).map((f) => `- Update ${f}`).join('\n');
  }
  const fullMessage = fallbackDetails ? `${fallbackTitle}\n\n${fallbackDetails}` : fallbackTitle;

  return {
    title: fallbackTitle,
    details: fallbackDetails,
    isLargeChange: isLarge,
    fullMessage,
  };
}

