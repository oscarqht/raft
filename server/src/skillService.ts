import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, ChildProcess } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import { getAllSkills, getSkillById, getSkillByName, insertSkill, updateSkillById, deleteSkillById, SkillRow } from './db.js';
import { getCrossPlatformEnv } from './agentRunner.js';

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  created_at?: number;
  updated_at?: number;
  source?: 'custom';
  cli?: string;
}

// Simple YAML frontmatter parser for name & description
export function parseSkillMarkdown(fileContent: string): { name?: string; description?: string; body?: string } {
  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    const titleMatch = fileContent.match(/^#\s+(.+)$/m);
    return {
      name: titleMatch ? titleMatch[1].trim() : undefined,
      description: '',
      body: fileContent.trim(),
    };
  }

  const rawFrontmatter = match[1];
  const body = match[2]?.trim() || '';
  let name: string | undefined;
  let description: string | undefined;

  const lines = rawFrontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nameMatch = line.match(/^name:\s*(.+)$/i);
    if (nameMatch) {
      name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }

    const descMatch = line.match(/^description:\s*(.*)$/i);
    if (descMatch) {
      let descVal = descMatch[1].trim();
      if (descVal === '>-' || descVal === '|' || descVal === '>') {
        const descLines: string[] = [];
        i++;
        while (i < lines.length && (lines[i].startsWith('  ') || lines[i].trim() === '')) {
          descLines.push(lines[i].trim());
          i++;
        }
        i--;
        description = descLines.filter(Boolean).join(' ');
      } else {
        description = descVal.replace(/^['"]|['"]$/g, '');
      }
    }
  }

  return { name, description, body };
}

// Returns all user-managed skills
export function getAllCustomSkills(): AgentSkill[] {
  const rows = getAllSkills();
  return rows.map((r) => ({
    ...r,
    source: 'custom',
  }));
}

// Backward-compatible alias for getSkillsForCli
export function getSkillsForCli(_cliName?: string, _worktreePath?: string): AgentSkill[] {
  return getAllCustomSkills();
}

// Extract skills or slash commands referenced anywhere in prompt (e.g. /my-skill, /audit)
export function extractMatchedSkills(cliOrPrompt: string, maybePrompt?: string, _worktreePath?: string): AgentSkill[] {
  const prompt = maybePrompt !== undefined ? maybePrompt : cliOrPrompt;
  if (!prompt || typeof prompt !== 'string') {
    return [];
  }

  const skills = getAllCustomSkills();
  if (!skills || skills.length === 0) {
    return [];
  }

  // Strip URLs so path segments in URLs (e.g. https://github.com/...) don't trigger false matches
  const textWithoutUrls = prompt.replace(/https?:\/\/[^\s]+/g, ' ');
  const regex = /(?:^|\s|\/)\/([a-zA-Z0-9_\-]+)/g;
  const matchedSkills: AgentSkill[] = [];
  let m: RegExpExecArray | null;

  while ((m = regex.exec(textWithoutUrls)) !== null) {
    const nameOnly = m[1].toLowerCase();
    const found = skills.find((s) => s.name.toLowerCase() === nameOnly);
    if (found && !matchedSkills.some((s) => s.name.toLowerCase() === found.name.toLowerCase())) {
      matchedSkills.push(found);
    }
  }

  return matchedSkills;
}

// Resolves and appends skill instructions for user-defined skills
export function resolveSkillPrompt(cliOrPrompt: string, maybePrompt?: string, _worktreePath?: string): string {
  const prompt = maybePrompt !== undefined ? maybePrompt : cliOrPrompt;
  if (!prompt || typeof prompt !== 'string') {
    return prompt || '';
  }

  const matchedSkills = extractMatchedSkills(prompt);
  if (matchedSkills.length === 0) {
    return prompt;
  }

  let augmentedPrompt = prompt;
  for (const skill of matchedSkills) {
    const instructions = skill.content || (skill.description ? `[Skill: /${skill.name} - ${skill.description}]` : '');
    if (instructions) {
      augmentedPrompt += `\n\n[Skill Instructions: /${skill.name}]\n${instructions.trim()}\n[End of Skill Instructions]`;
    }
  }

  return augmentedPrompt;
}

export interface SkillInstallResult {
  id: string;
  name: string;
  description: string;
  overwritten: boolean;
}

// Parses flexible skill command / repo inputs into arguments for npx skills add
export function parseSkillCommand(rawInput: string): { args: string[]; error?: string } {
  if (!rawInput || typeof rawInput !== 'string') {
    return { args: [], error: 'Command string is empty' };
  }

  let cleaned = rawInput.trim();
  // Strip leading npx -y skills add / npx skills add / skills add / npx skills a / skills a
  cleaned = cleaned.replace(/^(?:npx\s+(?:-y\s+)?skills|skills)\s+(?:add|a)(?:\s+|$)/i, '').trim();

  if (!cleaned) {
    return { args: [], error: 'Please provide a skill repository URL or package name' };
  }

  // Parse arguments handling quotes
  const args: string[] = [];
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleaned)) !== null) {
    if (match[1] !== undefined) {
      args.push(match[1]);
    } else if (match[2] !== undefined) {
      args.push(match[2]);
    } else {
      args.push(match[0]);
    }
  }

  if (args.length === 0) {
    return { args: [], error: 'Please provide a skill repository URL or package name' };
  }

  // Ensure copy and non-interactive flags are included
  if (!args.includes('--copy')) {
    args.push('--copy');
  }
  if (!args.includes('-y') && !args.includes('--yes')) {
    args.push('-y');
  }

  return { args };
}

// Helper to recursively locate SKILL.md files in a directory
export function findSkillFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findSkillFiles(fullPath));
      } else if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
        results.push(fullPath);
      }
    }
  } catch {}
  return results;
}

// Spawns npx skills add in an isolated temporary directory and imports the resulting skills into SQLite DB
export function installSkillWithNpxProcess(
  rawCommand: string,
  onData: (chunk: string) => void
): {
  proc?: ChildProcess;
  promise: Promise<{
    success: boolean;
    error?: string;
    installedSkills?: SkillInstallResult[];
  }>;
} {
  const { args, error: parseError } = parseSkillCommand(rawCommand);
  if (parseError || !args || args.length === 0) {
    return {
      promise: Promise.resolve({
        success: false,
        error: parseError || 'Invalid command',
      }),
    };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raft-skill-install-'));
  const isWin = process.platform === 'win32';
  const spawnBin = isWin ? 'cmd.exe' : 'npx';
  const spawnArgs = isWin
    ? ['/c', 'npx', '-y', 'skills', 'add', ...args]
    : ['-y', 'skills', 'add', ...args];

  onData(`[raft] Running skill installation: npx -y skills add ${args.join(' ')}\r\n`);
  onData(`[raft] Temporary workspace: ${tempDir}\r\n\r\n`);

  const env = {
    ...getCrossPlatformEnv(),
    FORCE_COLOR: '0',
    CI: '1',
  };

  const proc = spawn(spawnBin, spawnArgs, {
    cwd: tempDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  proc.stdout?.on('data', (d: Buffer) => onData(d.toString('utf-8')));
  proc.stderr?.on('data', (d: Buffer) => onData(d.toString('utf-8')));

  const promise = new Promise<{
    success: boolean;
    error?: string;
    installedSkills?: SkillInstallResult[];
  }>((resolve) => {
    const cleanupTempDir = () => {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch {}
    };

    proc.on('error', (err) => {
      cleanupTempDir();
      resolve({
        success: false,
        error: `Failed to execute npx: ${err.message}`,
      });
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        cleanupTempDir();
        resolve({
          success: false,
          error: `npx skills add exited with code ${code}`,
        });
        return;
      }

      try {
        const skillFiles = findSkillFiles(tempDir);
        if (skillFiles.length === 0) {
          cleanupTempDir();
          resolve({
            success: false,
            error: 'No skills found in the specified repository or package.',
          });
          return;
        }

        const installedSkills: SkillInstallResult[] = [];
        for (const skillFile of skillFiles) {
          const raw = fs.readFileSync(skillFile, 'utf-8');
          const parsed = parseSkillMarkdown(raw);
          const dirName = path.basename(path.dirname(skillFile));
          const baseName = parsed.name || (dirName !== 'skills' && dirName !== '.agents' ? dirName : 'skill');
          const cleanName = baseName.toLowerCase().replace(/[^a-z0-9_\-]/g, '-').replace(/^-+|-+$/g, '');
          if (!cleanName) continue;

          const desc = (parsed.description || '').trim();
          const content = (parsed.body || raw).trim();

          const existing = getSkillByName(cleanName);
          let skillId: string;
          if (existing) {
            skillId = existing.id;
            updateSkillById(existing.id, {
              name: cleanName,
              description: desc || existing.description,
              content: content || existing.content,
            });
            installedSkills.push({
              id: skillId,
              name: cleanName,
              description: desc || existing.description,
              overwritten: true,
            });
          } else {
            skillId = uuidv4();
            insertSkill({
              id: skillId,
              name: cleanName,
              description: desc,
              content: content,
            });
            installedSkills.push({
              id: skillId,
              name: cleanName,
              description: desc,
              overwritten: false,
            });
          }
        }

        cleanupTempDir();
        resolve({
          success: true,
          installedSkills,
        });
      } catch (err: any) {
        cleanupTempDir();
        resolve({
          success: false,
          error: `Failed to import skills: ${err?.message || String(err)}`,
        });
      }
    });
  });

  return { proc, promise };
}
