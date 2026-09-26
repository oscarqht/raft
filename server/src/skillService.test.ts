import test from 'node:test';
import assert from 'node:assert';
import { parseSkillMarkdown, getSkillsForCli, resolveSkillPrompt } from './skillService.js';

test('parseSkillMarkdown parses YAML frontmatter correctly', () => {
  const content = `---
name: sample-skill
description: A helpful skill for automated testing.
---

# Sample Skill Content
Instructions go here.
`;
  const result = parseSkillMarkdown(content);
  assert.strictEqual(result.name, 'sample-skill');
  assert.strictEqual(result.description, 'A helpful skill for automated testing.');
  assert.ok(result.body?.includes('Sample Skill Content'));
});

test('parseSkillMarkdown handles multiline folded description', () => {
  const content = `---
name: multi-line
description: >-
  First line of description.
  Second line of description.
---

Skill body.
`;
  const result = parseSkillMarkdown(content);
  assert.strictEqual(result.name, 'multi-line');
  assert.strictEqual(result.description, 'First line of description. Second line of description.');
});

test('getSkillsForCli discovers agy skills with sources and commands matching Antigravity app', () => {
  const skills = getSkillsForCli('agy');
  assert.ok(Array.isArray(skills));
  assert.ok(skills.length > 0);

  // Slash commands must be present at the top
  const slashCommands = ['btw', 'goal', 'schedule', 'browser', 'plan', 'grill-me', 'learn'];
  for (const cmd of slashCommands) {
    assert.ok(skills.some((s) => s.name === cmd), `Expected command ${cmd} to be present`);
  }

  // Antigravity builtin skills
  assert.ok(skills.some((s) => s.name === 'agy-customizations'));

  // Foreign non-antigravity skills must NOT be included
  assert.strictEqual(skills.some((s) => s.name === 'agent-browser'), false);
  assert.strictEqual(skills.some((s) => s.name === 'firecrawl'), false);
});

test('getSkillsForCli returns commands for claude and codex', () => {
  const claudeSkills = getSkillsForCli('claude');
  assert.ok(claudeSkills.some((s) => s.name === 'review'));

  const codexSkills = getSkillsForCli('codex');
  assert.ok(codexSkills.some((s) => s.name === 'review'));
});

test('resolveSkillPrompt keeps agy prompt untouched', () => {
  const prompt = 'Please run /migrate-workflows on this repo';
  const resolved = resolveSkillPrompt('agy', prompt);
  assert.strictEqual(resolved, prompt);
});

test('resolveSkillPrompt augments prompt for claude and codex with skill info', () => {
  const prompt = 'Please do a /review of changes';
  const resolved = resolveSkillPrompt('claude', prompt);
  assert.ok(resolved.includes('/review'));
  assert.ok(resolved.includes('[Skill'));
});
