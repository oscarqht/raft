import { spawn, execSync, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from './db.js';

export interface CliInfo {
  name: string;
  path: string;
  available: boolean;
  version?: string;
}

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
}

// Get cross-platform enriched environment with PATH
export function getCrossPlatformEnv(): NodeJS.ProcessEnv {
  const home = os.homedir();
  const isWin = process.platform === 'win32';
  const delimiter = path.delimiter;

  const additionalDirs = isWin
    ? [
        path.join(home, '.local', 'bin'),
        path.join(process.env.APPDATA || '', 'npm'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs'),
        path.join(process.env.ProgramFiles || '', 'Git', 'cmd'),
      ]
    : [
        path.join(home, '.local', 'bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
      ];

  const currentPath = process.env.PATH || '';
  const newPath = [...additionalDirs, currentPath].filter(Boolean).join(delimiter);

  return {
    ...process.env,
    PATH: newPath,
  };
}

// Find path for CLI binary across platforms
export function resolveCliPath(cliName: string): string {
  const home = os.homedir();
  const isWin = process.platform === 'win32';
  const extensions = isWin ? ['.cmd', '.exe', '.bat', ''] : [''];

  const searchDirs = [
    path.join(home, '.local', 'bin'),
    ...(isWin
      ? [
          path.join(process.env.APPDATA || '', 'npm'),
          path.join(process.env.LOCALAPPDATA || '', 'Programs'),
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

  // Fallback to which / where lookup
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

export function getAvailableClis(): CliInfo[] {
  const clis = ['agy', 'claude', 'codex'];
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
    return { name, path: cliPath, available, version };
  });
}

export function getModelsForCli(cliName: string): ModelOption[] {
  if (cliName === 'agy') {
    const defaultAgyModels = [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Recommended)', description: 'Best for complex coding and reasoning' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast, responsive, lower latency' },
      { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', description: 'Strong reasoning and architectural coding' },
      { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Solid all-around coding performance' },
    ];
    try {
      const cliPath = resolveCliPath('agy');
      const env = getCrossPlatformEnv();
      const isWin = process.platform === 'win32';
      const out = execSync(`"${cliPath}" models`, {
        encoding: 'utf-8',
        env,
        shell: isWin ? (process.env.ComSpec || 'cmd.exe') : '/bin/bash',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const lines = out.split(/\r?\n/).filter(Boolean);
      const parsed: ModelOption[] = [];
      for (const line of lines) {
        const clean = line.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|Fetching available models\.\.\./g, '').trim();
        if (clean && !clean.startsWith('Available') && !clean.startsWith('-')) {
          const parts = clean.split(/\t+|\s{2,}/);
          if (parts[0]) {
            parsed.push({
              id: parts[0].trim(),
              name: parts[1]?.trim() || parts[0].trim(),
              description: parts[2]?.trim() || '',
            });
          }
        }
      }
      if (parsed.length > 0) return parsed;
    } catch {
      // Fallback
    }
    return defaultAgyModels;
  }

  if (cliName === 'claude') {
    return [
      { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet (Recommended)', description: 'Hybrid reasoning and high-speed coding' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Deep coding and analysis' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Lightweight and ultra-fast' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Deep conceptual design' },
    ];
  }

  if (cliName === 'codex') {
    return [
      { id: 'o3', name: 'Codex o3 (Recommended)', description: 'High capability reasoning model' },
      { id: 'o4-mini', name: 'Codex o4-mini', description: 'Fast, low-latency reasoning' },
      { id: 'gpt-4.1', name: 'Codex GPT-4.1', description: 'High context window coding' },
      { id: 'gpt-4o', name: 'Codex GPT-4o', description: 'Balanced multimodal code generation' },
    ];
  }

  return [{ id: 'default', name: 'Default Model' }];
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

  const proc = spawn(cliPath, args, {
    cwd,
    env,
    shell: isWin ? true : false,
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
  }

  return spawnAgentCli(cliName, args, worktreePath, emit);
}
