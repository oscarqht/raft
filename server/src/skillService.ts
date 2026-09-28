import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AgentSkill {
  name: string;
  description: string;
  source: 'workspace' | 'global' | 'built-in';
  cli: string;
  filePath?: string;
  content?: string;
}

// Simple YAML frontmatter parser for name & description
export function parseSkillMarkdown(fileContent: string): { name?: string; description?: string; body?: string } {
  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    // Check if there's a title header # Skill Name
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
        // Multi-line block
        const descLines: string[] = [];
        i++;
        while (i < lines.length && (lines[i].startsWith('  ') || lines[i].trim() === '')) {
          descLines.push(lines[i].trim());
          i++;
        }
        i--; // Step back one line since loop will increment
        description = descLines.filter(Boolean).join(' ');
      } else {
        description = descVal.replace(/^['"]|['"]$/g, '');
      }
    }
  }

  return { name, description, body };
}

// Built-in slash commands for Antigravity (matching Antigravity app)
export const AGY_SLASH_COMMANDS: AgentSkill[] = [
  {
    name: 'grill-me',
    description: 'Interview me to align on a plan.',
    source: 'built-in',
    cli: 'agy',
    content: `<GRILL_ME>
The user has requested that you interview them about every aspect of their task until you've reached a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Guidelines:
- Ask the questions one at a time.
- If a question can be answered by exploring the codebase, explore the codebase instead.
- If an ask_question tool is available, use it; otherwise ask directly in your response.
</GRILL_ME>`,
  },
  {
    name: 'plan',
    description: 'Plan carefully before executing a task.',
    source: 'built-in',
    cli: 'agy',
    content: `<PLAN>
The user has requested that you create a structured, step-by-step implementation plan before modifying any code.
Inspect the relevant files, identify dependencies, evaluate potential risks, and design the solution. Present the plan clearly with phases and verification steps before proceeding.
</PLAN>`,
  },
  {
    name: 'goal',
    description: 'Run until the specified goal is completely finished.',
    source: 'built-in',
    cli: 'agy',
    content: `<GOAL>
The user has marked this task with /goal, indicating that this task is intended to run until the specified goal is completely fulfilled.
Be extra thorough, verify every step, run all relevant tests, and only stop when you are confident the goal has been fully achieved.
</GOAL>`,
  },
  {
    name: 'schedule',
    description: 'Run an instruction on a recurring schedule or as a one-time timer.',
    source: 'built-in',
    cli: 'agy',
    content: `<SCHEDULE>
The user has requested to run an instruction on a recurring schedule or as a one-time timer.
Use available scheduling or timer tools to configure the desired schedule or timer.
</SCHEDULE>`,
  },
  {
    name: 'browser',
    description: 'Invoke a browser agent for web tasks.',
    source: 'built-in',
    cli: 'agy',
    content: `<BROWSER>
The user has requested to invoke a browser agent or web automation tools. Use browser navigation tools to inspect pages, extract web content, or test web applications.
</BROWSER>`,
  },
  {
    name: 'learn',
    description: 'Reflect on recent successes or corrections to capture reusable skills or rules.',
    source: 'built-in',
    cli: 'agy',
    content: `<LEARN>
Reflect on recent interactions, successes, errors, or corrections in this session to capture reusable skills, conventions, or rules for future tasks.
</LEARN>`,
  },
  {
    name: 'btw',
    description: 'Ask a quick question without interrupting the main conversation.',
    source: 'built-in',
    cli: 'agy',
    content: `<BTW>
The user is asking a quick side question without wanting to interrupt or derail the main conversation. Provide a direct, concise answer.
</BTW>`,
  },
];

// Discover skills for agy CLI
export function discoverAgySkills(worktreePath?: string): AgentSkill[] {
  const home = os.homedir();
  const skillsMap = new Map<string, AgentSkill>();

  // 1. Antigravity Built-in Slash Commands (first in list)
  for (const cmd of AGY_SLASH_COMMANDS) {
    skillsMap.set(cmd.name, { ...cmd });
  }

  // 2. Built-in Antigravity skills (~/.gemini/antigravity/builtin/skills)
  const primaryBuiltin = path.join(home, '.gemini', 'antigravity', 'builtin', 'skills');
  const builtinDirs = fs.existsSync(primaryBuiltin)
    ? [primaryBuiltin]
    : [
        path.join(home, '.gemini', 'antigravity-cli', 'builtin', 'skills'),
        path.join(home, '.gemini', 'antigravity-ide', 'builtin', 'skills'),
      ];

  for (const bDir of builtinDirs) {
    if (fs.existsSync(bDir)) {
      try {
        const entries = fs.readdirSync(bDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillFilePath = path.join(bDir, entry.name, 'SKILL.md');
            if (fs.existsSync(skillFilePath)) {
              try {
                const text = fs.readFileSync(skillFilePath, 'utf-8');
                const parsed = parseSkillMarkdown(text);
                const skillName = parsed.name || entry.name;
                if (!skillsMap.has(skillName)) {
                  skillsMap.set(skillName, {
                    name: skillName,
                    description: parsed.description || 'Built-in Antigravity skill',
                    source: 'built-in',
                    cli: 'agy',
                    filePath: skillFilePath,
                    content: text,
                  });
                }
              } catch {}
            }
          }
        }
      } catch {}
    }
  }

  // 3. User Global Antigravity skills (~/.gemini/config/skills, ~/.gemini/antigravity/skills)
  // Note: ~/.agents/skills is intentionally excluded as it belongs to other tools
  const globalDirs = [
    path.join(home, '.gemini', 'config', 'skills'),
    path.join(home, '.gemini', 'antigravity', 'skills'),
  ];

  for (const gDir of globalDirs) {
    if (fs.existsSync(gDir)) {
      try {
        const entries = fs.readdirSync(gDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillFilePath = path.join(gDir, entry.name, 'SKILL.md');
            if (fs.existsSync(skillFilePath)) {
              try {
                const text = fs.readFileSync(skillFilePath, 'utf-8');
                const parsed = parseSkillMarkdown(text);
                const skillName = parsed.name || entry.name;
                skillsMap.set(skillName, {
                  name: skillName,
                  description: parsed.description || 'User global skill',
                  source: 'global',
                  cli: 'agy',
                  filePath: skillFilePath,
                  content: text,
                });
              } catch {}
            }
          }
        }
      } catch {}
    }
  }

  // 4. Project Workspace skills (.agents/skills, .agent/skills)
  if (worktreePath && fs.existsSync(worktreePath)) {
    const wsDirs = [
      path.join(worktreePath, '.agents', 'skills'),
      path.join(worktreePath, '.agent', 'skills'),
      path.join(worktreePath, '_agents', 'skills'),
      path.join(worktreePath, '_agent', 'skills'),
    ];

    for (const wsDir of wsDirs) {
      if (fs.existsSync(wsDir)) {
        try {
          const entries = fs.readdirSync(wsDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const skillFilePath = path.join(wsDir, entry.name, 'SKILL.md');
              if (fs.existsSync(skillFilePath)) {
                try {
                  const text = fs.readFileSync(skillFilePath, 'utf-8');
                  const parsed = parseSkillMarkdown(text);
                  const skillName = parsed.name || entry.name;
                  skillsMap.set(skillName, {
                    name: skillName,
                    description: parsed.description || 'Project workspace skill',
                    source: 'workspace',
                    cli: 'agy',
                    filePath: skillFilePath,
                    content: text,
                  });
                } catch {}
              }
            }
          }
        } catch {}
      }
    }
  }

  // 5. Antigravity Plugin skills (~/.gemini/config/plugins)
  const pluginsDir = path.join(home, '.gemini', 'config', 'plugins');
  if (fs.existsSync(pluginsDir)) {
    try {
      const pluginFolders = fs.readdirSync(pluginsDir, { withFileTypes: true });
      for (const pFolder of pluginFolders) {
        if (!pFolder.isDirectory()) continue;
        const pluginPath = path.join(pluginsDir, pFolder.name);

        // Check if plugin directly has SKILL.md
        const directSkillPath = path.join(pluginPath, 'SKILL.md');
        if (fs.existsSync(directSkillPath)) {
          try {
            const text = fs.readFileSync(directSkillPath, 'utf-8');
            const parsed = parseSkillMarkdown(text);
            const skillName = parsed.name || pFolder.name;
            if (!skillsMap.has(skillName)) {
              skillsMap.set(skillName, {
                name: skillName,
                description: parsed.description || 'Plugin skill',
                source: 'global',
                cli: 'agy',
                filePath: directSkillPath,
                content: text,
              });
            }
          } catch {}
        }

        // Check plugin/skills subfolder
        const subSkillsDir = path.join(pluginPath, 'skills');
        if (fs.existsSync(subSkillsDir)) {
          try {
            const skillEntries = fs.readdirSync(subSkillsDir, { withFileTypes: true });
            for (const sEntry of skillEntries) {
              if (!sEntry.isDirectory()) continue;
              const skillFilePath = path.join(subSkillsDir, sEntry.name, 'SKILL.md');
              if (fs.existsSync(skillFilePath)) {
                try {
                  const text = fs.readFileSync(skillFilePath, 'utf-8');
                  const parsed = parseSkillMarkdown(text);
                  const skillName = parsed.name || sEntry.name;
                  if (!skillsMap.has(skillName)) {
                    skillsMap.set(skillName, {
                      name: skillName,
                      description: parsed.description || 'Plugin skill',
                      source: 'global',
                      cli: 'agy',
                      filePath: skillFilePath,
                      content: text,
                    });
                  }
                } catch {}
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  return Array.from(skillsMap.values());
}

// Discover skills/commands for Claude CLI
export function discoverClaudeSkills(worktreePath?: string): AgentSkill[] {
  const home = os.homedir();
  const skillsMap = new Map<string, AgentSkill>();

  // Include universal slash commands (grill-me, plan, goal, etc.)
  for (const cmd of AGY_SLASH_COMMANDS) {
    if (!skillsMap.has(cmd.name)) {
      skillsMap.set(cmd.name, { ...cmd, cli: 'claude' });
    }
  }

  // 1. Built-in common Claude Code commands
  const defaultClaudeCommands: AgentSkill[] = [
    {
      name: 'review',
      description: 'Run code review on working directory changes or specific commits',
      source: 'built-in',
      cli: 'claude',
    },
    {
      name: 'init',
      description: 'Initialize CLAUDE.md configuration and guidelines for this repository',
      source: 'built-in',
      cli: 'claude',
    },
    {
      name: 'doctor',
      description: 'Check health and diagnose Claude Code installation, auth, and environment',
      source: 'built-in',
      cli: 'claude',
    },
    {
      name: 'compact',
      description: 'Summarize and compact conversation history to free context window space',
      source: 'built-in',
      cli: 'claude',
    },
    {
      name: 'cost',
      description: 'Display token usage and estimated cost for the current session',
      source: 'built-in',
      cli: 'claude',
    },
    {
      name: 'clear',
      description: 'Clear conversation history',
      source: 'built-in',
      cli: 'claude',
    },
    {
      name: 'config',
      description: 'Open interactive configuration',
      source: 'built-in',
      cli: 'claude',
    },
    {
      name: 'help',
      description: 'Display help for commands and options',
      source: 'built-in',
      cli: 'claude',
    },
    {
      name: 'pr_comments',
      description: 'Review pull request comments',
      source: 'built-in',
      cli: 'claude',
    },
    {
      name: 'terminal-setup',
      description: 'Install shift-enter key binding for newlines',
      source: 'built-in',
      cli: 'claude',
    },
    {
      name: 'bug',
      description: 'Report an issue or bug regarding Claude Code directly to Anthropic',
      source: 'built-in',
      cli: 'claude',
    },
  ];

  for (const cmd of defaultClaudeCommands) {
    skillsMap.set(cmd.name, cmd);
  }

  // 2. Global custom commands (~/.claude/commands/*.md)
  const globalCmdDir = path.join(home, '.claude', 'commands');
  if (fs.existsSync(globalCmdDir)) {
    try {
      const files = fs.readdirSync(globalCmdDir);
      for (const f of files) {
        if (f.endsWith('.md')) {
          const cmdName = path.basename(f, '.md');
          const fullPath = path.join(globalCmdDir, f);
          try {
            const text = fs.readFileSync(fullPath, 'utf-8');
            const parsed = parseSkillMarkdown(text);
            skillsMap.set(cmdName, {
              name: parsed.name || cmdName,
              description: parsed.description || 'Claude global custom command',
              source: 'global',
              cli: 'claude',
              filePath: fullPath,
              content: text,
            });
          } catch {}
        }
      }
    } catch {}
  }

  // 3. Workspace custom commands (.claude/commands/*.md) & skills (.claude/skills/*/SKILL.md)
  if (worktreePath && fs.existsSync(worktreePath)) {
    const wsCmdDir = path.join(worktreePath, '.claude', 'commands');
    if (fs.existsSync(wsCmdDir)) {
      try {
        const files = fs.readdirSync(wsCmdDir);
        for (const f of files) {
          if (f.endsWith('.md')) {
            const cmdName = path.basename(f, '.md');
            const fullPath = path.join(wsCmdDir, f);
            try {
              const text = fs.readFileSync(fullPath, 'utf-8');
              const parsed = parseSkillMarkdown(text);
              skillsMap.set(cmdName, {
                name: parsed.name || cmdName,
                description: parsed.description || 'Claude workspace custom command',
                source: 'workspace',
                cli: 'claude',
                filePath: fullPath,
                content: text,
              });
            } catch {}
          }
        }
      } catch {}
    }

    const wsSkillDir = path.join(worktreePath, '.claude', 'skills');
    if (fs.existsSync(wsSkillDir)) {
      try {
        const entries = fs.readdirSync(wsSkillDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillFilePath = path.join(wsSkillDir, entry.name, 'SKILL.md');
            if (fs.existsSync(skillFilePath)) {
              try {
                const text = fs.readFileSync(skillFilePath, 'utf-8');
                const parsed = parseSkillMarkdown(text);
                const skillName = parsed.name || entry.name;
                skillsMap.set(skillName, {
                  name: skillName,
                  description: parsed.description || 'Claude workspace skill',
                  source: 'workspace',
                  cli: 'claude',
                  filePath: skillFilePath,
                  content: text,
                });
              } catch {}
            }
          }
        }
      } catch {}
    }
  }

  return Array.from(skillsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// Discover skills/prompts for Codex CLI
export function discoverCodexSkills(worktreePath?: string): AgentSkill[] {
  const home = os.homedir();
  const skillsMap = new Map<string, AgentSkill>();

  // Include universal slash commands (grill-me, plan, goal, etc.)
  for (const cmd of AGY_SLASH_COMMANDS) {
    if (!skillsMap.has(cmd.name)) {
      skillsMap.set(cmd.name, { ...cmd, cli: 'codex' });
    }
  }

  // 1. Built-in common Codex commands
  const defaultCodexCommands: AgentSkill[] = [
    {
      name: 'review',
      description: 'Review staged or working tree changes with automated feedback',
      source: 'built-in',
      cli: 'codex',
    },
    {
      name: 'commit',
      description: 'Generate high-quality commit message and commit changes',
      source: 'built-in',
      cli: 'codex',
    },
    {
      name: 'doctor',
      description: 'Diagnose local Codex installation, configuration, and environment',
      source: 'built-in',
      cli: 'codex',
    },
    {
      name: 'help',
      description: 'Display help and available Codex commands',
      source: 'built-in',
      cli: 'codex',
    },
    {
      name: 'status',
      description: 'Show status of working directory, active branch, and repository',
      source: 'built-in',
      cli: 'codex',
    },
  ];

  for (const cmd of defaultCodexCommands) {
    skillsMap.set(cmd.name, cmd);
  }

  // 2. Global custom prompts (~/.codex/prompts/*.md)
  const globalPromptDir = path.join(home, '.codex', 'prompts');
  if (fs.existsSync(globalPromptDir)) {
    try {
      const files = fs.readdirSync(globalPromptDir);
      for (const f of files) {
        if (f.endsWith('.md')) {
          const promptName = path.basename(f, '.md');
          const fullPath = path.join(globalPromptDir, f);
          try {
            const text = fs.readFileSync(fullPath, 'utf-8');
            const parsed = parseSkillMarkdown(text);
            skillsMap.set(promptName, {
              name: parsed.name || promptName,
              description: parsed.description || 'Codex global custom prompt',
              source: 'global',
              cli: 'codex',
              filePath: fullPath,
              content: text,
            });
          } catch {}
        }
      }
    } catch {}
  }

  // 3. Workspace custom prompts (.codex/prompts/*.md) & skills (.codex/skills/*/SKILL.md)
  if (worktreePath && fs.existsSync(worktreePath)) {
    const wsPromptDir = path.join(worktreePath, '.codex', 'prompts');
    if (fs.existsSync(wsPromptDir)) {
      try {
        const files = fs.readdirSync(wsPromptDir);
        for (const f of files) {
          if (f.endsWith('.md')) {
            const promptName = path.basename(f, '.md');
            const fullPath = path.join(wsPromptDir, f);
            try {
              const text = fs.readFileSync(fullPath, 'utf-8');
              const parsed = parseSkillMarkdown(text);
              skillsMap.set(promptName, {
                name: parsed.name || promptName,
                description: parsed.description || 'Codex workspace prompt',
                source: 'workspace',
                cli: 'codex',
                filePath: fullPath,
                content: text,
              });
            } catch {}
          }
        }
      } catch {}
    }

    const wsSkillDir = path.join(worktreePath, '.codex', 'skills');
    if (fs.existsSync(wsSkillDir)) {
      try {
        const entries = fs.readdirSync(wsSkillDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillFilePath = path.join(wsSkillDir, entry.name, 'SKILL.md');
            if (fs.existsSync(skillFilePath)) {
              try {
                const text = fs.readFileSync(skillFilePath, 'utf-8');
                const parsed = parseSkillMarkdown(text);
                const skillName = parsed.name || entry.name;
                skillsMap.set(skillName, {
                  name: skillName,
                  description: parsed.description || 'Codex workspace skill',
                  source: 'workspace',
                  cli: 'codex',
                  filePath: skillFilePath,
                  content: text,
                });
              } catch {}
            }
          }
        }
      } catch {}
    }
  }

  return Array.from(skillsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// Unified skills discovery
export function getSkillsForCli(cliName: string, worktreePath?: string): AgentSkill[] {
  const norm = (cliName || '').toLowerCase().trim();
  if (norm === 'agy') {
    return discoverAgySkills(worktreePath);
  } else if (norm === 'claude') {
    return discoverClaudeSkills(worktreePath);
  } else if (norm === 'codex') {
    return discoverCodexSkills(worktreePath);
  }
  return [];
}

// Extract skills or slash commands referenced anywhere in prompt (e.g. /grill-me, /plan, /a11y-debugging)
export function extractMatchedSkills(cliName: string, prompt: string, worktreePath?: string): AgentSkill[] {
  if (!prompt || typeof prompt !== 'string') {
    return [];
  }
  const norm = (cliName || '').toLowerCase().trim();
  const skills = getSkillsForCli(norm, worktreePath);
  if (!skills || skills.length === 0) {
    return [];
  }

  // Strip URLs so path segments in URLs (e.g. https://github.com/...) don't trigger false matches
  const textWithoutUrls = prompt.replace(/https?:\/\/[^\s]+/g, ' ');
  const regex = /\/([a-zA-Z0-9_\-]+)/g;
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

// Resolves and appends skill instructions for all CLIs (agy, claude, codex)
export function resolveSkillPrompt(cliName: string, prompt: string, worktreePath?: string): string {
  const matchedSkills = extractMatchedSkills(cliName, prompt, worktreePath);
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
