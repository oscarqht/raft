import test from 'node:test';
import assert from 'node:assert';
import { parseSkillMarkdown, getAllCustomSkills, resolveSkillPrompt, extractMatchedSkills } from './skillService.js';
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
