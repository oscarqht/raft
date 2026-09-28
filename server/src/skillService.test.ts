import test from 'node:test';
import assert from 'node:assert';
import { parseSkillMarkdown, getAllCustomSkills, resolveSkillPrompt, extractMatchedSkills, parseSkillCommand, installSkillWithNpxProcess } from './skillService.js';
import { insertSkill, deleteSkillById, getSkillByName, updateSkillById } from './db.js';

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

test('user-managed skills CRUD and prompt resolution', () => {
  // 1. Initially clean up any test skill if existed
  const existing = getSkillByName('test-deploy');
  if (existing) {
    deleteSkillById(existing.id);
  }

  // 2. Insert user skill
  const created = insertSkill({
    id: 'skill-test-1',
    name: 'test-deploy',
    description: 'Deploys the application safely',
    content: 'Execute deployment script with checks.',
  });
  assert.strictEqual(created.name, 'test-deploy');

  // 3. Retrieve all custom skills
  const skills = getAllCustomSkills();
  const found = skills.find((s) => s.name === 'test-deploy');
  assert.ok(found);
  assert.strictEqual(found.description, 'Deploys the application safely');

  // 4. Match in prompt
  const matched = extractMatchedSkills('Please run /test-deploy right now');
  assert.strictEqual(matched.length, 1);
  assert.strictEqual(matched[0].name, 'test-deploy');

  // 5. Avoid false positives in URLs
  const urlPrompt = 'Visit https://example.com/test-deploy/page and also run /test-deploy';
  const urlMatched = extractMatchedSkills(urlPrompt);
  assert.strictEqual(urlMatched.length, 1);
  assert.strictEqual(urlMatched[0].name, 'test-deploy');

  // 6. Resolve skill prompt
  const resolved = resolveSkillPrompt('Please run /test-deploy on staging');
  assert.ok(resolved.includes('[Skill Instructions: /test-deploy]'));
  assert.ok(resolved.includes('Execute deployment script with checks.'));

  // 7. Deduplicate multiple invocations
  const dupResolved = resolveSkillPrompt('Please run /test-deploy and /test-deploy');
  const count = (dupResolved.match(/\[Skill Instructions: \/test-deploy\]/g) || []).length;
  assert.strictEqual(count, 1);

  // 8. Update skill
  updateSkillById('skill-test-1', {
    description: 'Updated deploy description',
    content: 'New instructions for deploy.',
  });
  const updatedResolved = resolveSkillPrompt('Please run /test-deploy');
  assert.ok(updatedResolved.includes('New instructions for deploy.'));

  // 9. Delete skill
  deleteSkillById('skill-test-1');
  const afterDelete = getAllCustomSkills().find((s) => s.name === 'test-deploy');
  assert.strictEqual(afterDelete, undefined);
  const promptAfterDelete = resolveSkillPrompt('Please run /test-deploy');
  assert.strictEqual(promptAfterDelete, 'Please run /test-deploy');
});

test('parseSkillCommand parses full npx commands and adds required flags', () => {
  const parsed = parseSkillCommand('npx skills add https://github.com/mattpocock/skills --skill grilling');
  assert.deepStrictEqual(parsed.args, [
    'https://github.com/mattpocock/skills',
    '--skill',
    'grilling',
    '--copy',
    '-y',
  ]);
});

test('parseSkillCommand parses shorthand skills add and repo paths', () => {
  const parsed1 = parseSkillCommand('skills add vercel-labs/agent-skills');
  assert.deepStrictEqual(parsed1.args, ['vercel-labs/agent-skills', '--copy', '-y']);

  const parsed2 = parseSkillCommand('https://github.com/mattpocock/skills --skill "grilling recipe"');
  assert.deepStrictEqual(parsed2.args, [
    'https://github.com/mattpocock/skills',
    '--skill',
    'grilling recipe',
    '--copy',
    '-y',
  ]);

  const parsed3 = parseSkillCommand('npx -y skills add some/repo -y --copy');
  assert.deepStrictEqual(parsed3.args, ['some/repo', '-y', '--copy']);
});

test('parseSkillCommand handles invalid or empty input gracefully', () => {
  const parsedEmpty = parseSkillCommand('');
  assert.ok(parsedEmpty.error);
  assert.strictEqual(parsedEmpty.args.length, 0);

  const parsedOnlyPrefix = parseSkillCommand('npx skills add');
  assert.ok(parsedOnlyPrefix.error);
  assert.strictEqual(parsedOnlyPrefix.args.length, 0);
});

test('installSkillWithNpxProcess installs skill and registers it in DB', async () => {
  // Clean up if already exists
  const existing = getSkillByName('grilling');
  if (existing) {
    deleteSkillById(existing.id);
  }

  const logs: string[] = [];
  const { promise } = installSkillWithNpxProcess(
    'npx skills add https://github.com/mattpocock/skills --skill grilling',
    (chunk) => logs.push(chunk)
  );

  const result = await promise;
  assert.strictEqual(result.success, true);
  assert.ok(result.installedSkills && result.installedSkills.length > 0);
  const grillingSkill = result.installedSkills.find((s) => s.name === 'grilling');
  assert.ok(grillingSkill, 'Expected grilling skill to be in installedSkills');

  // Verify in database
  const fromDb = getSkillByName('grilling');
  assert.ok(fromDb, 'Expected grilling skill to be found in database');
  assert.ok(fromDb.content.length > 0);

  // Verify prompt resolution works with /grilling
  const resolved = resolveSkillPrompt('Please conduct an interview using /grilling');
  assert.ok(resolved.includes('[Skill Instructions: /grilling]'));

  // Clean up
  deleteSkillById(fromDb.id);
});
