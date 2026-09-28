import { getAllSkills, getSkillById, getSkillByName, insertSkill, updateSkillById, deleteSkillById, SkillRow } from './db.js';

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
