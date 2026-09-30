import test from 'node:test';
import assert from 'node:assert/strict';

// Test the core notification logic and content cleaning algorithms

function cleanNotificationContent(raw: string): string {
  if (!raw) return 'Task completed';
  let clean = raw.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
  clean = clean.replace(/```[\s\S]*?```/g, '[Code snippet]').trim();
  clean = clean.replace(/^[#>\-\*\s]+/gm, '').trim();

  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  const firstLine = lines[0] || 'Task completed';
  if (firstLine.length > 120) {
    return firstLine.slice(0, 117) + '...';
  }
  return firstLine;
}

function formatNotificationTitle(projectName?: string, taskName?: string): string {
  const cleanTaskName = (taskName || 'Task').trim();
  return projectName?.trim() ? `[${projectName.trim()}] ${cleanTaskName}` : cleanTaskName;
}

function formatNotificationBody(type: 'done' | 'hitl' | 'error' | 'question', detail?: string): string {
  switch (type) {
    case 'done': {
      const summary = cleanNotificationContent(detail || '');
      return `Agent finished: ${summary}`;
    }
    case 'hitl': {
      return 'Attention needed: Agent requested user confirmation / input';
    }
    case 'error': {
      const snippet = (detail || '').trim();
      return snippet
        ? `Attention needed: Agent encountered an error (${snippet.length > 90 ? snippet.slice(0, 87) + '...' : snippet})`
        : 'Attention needed: Agent encountered an error';
    }
    case 'question': {
      return 'Attention needed: Agent asked a question';
    }
  }
}

function isTaskInBackground(
  taskId: string,
  currentTaskId: string | null,
  documentHidden: boolean,
  documentHasFocus: boolean
): boolean {
  if (!taskId) return false;
  if (currentTaskId !== taskId) return true;
  if (documentHidden) return true;
  if (!documentHasFocus) return true;
  return false;
}

test('cleanNotificationContent strips thought tags, markdown blocks, and truncates long lines', () => {
  const raw = `<thought>
I should analyze the codebase and edit the files.
Everything looks good.
</thought>
# Implemented the background notification feature cleanly.
More lines here...`;

  const cleaned = cleanNotificationContent(raw);
  assert.equal(cleaned, 'Implemented the background notification feature cleanly.');

  // Code snippet stripping
  const rawCode = '```typescript\nconst a = 1;\n```\nDone with refactoring.';
  const cleanedCode = cleanNotificationContent(rawCode);
  assert.equal(cleanedCode, '[Code snippet]');

  // Fallback for empty
  assert.equal(cleanNotificationContent(''), 'Task completed');

  // Long line truncation
  const longText = 'A'.repeat(150);
  const truncated = cleanNotificationContent(longText);
  assert.equal(truncated.length, 120);
  assert.ok(truncated.endsWith('...'));
});

test('formatNotificationTitle formats with and without project name', () => {
  assert.equal(formatNotificationTitle('raft', 'send-notification'), '[raft] send-notification');
  assert.equal(formatNotificationTitle('  my-project  ', 'fix-bug'), '[my-project] fix-bug');
  assert.equal(formatNotificationTitle('', 'fix-bug'), 'fix-bug');
  assert.equal(formatNotificationTitle(undefined, 'fix-bug'), 'fix-bug');
  assert.equal(formatNotificationTitle(undefined, undefined), 'Task');
});

test('formatNotificationBody formats all trigger types properly', () => {
  // Done
  assert.equal(
    formatNotificationBody('done', 'Implemented new feature successfully'),
    'Agent finished: Implemented new feature successfully'
  );

  // HITL
  assert.equal(
    formatNotificationBody('hitl'),
    'Attention needed: Agent requested user confirmation / input'
  );

  // Question
  assert.equal(
    formatNotificationBody('question'),
    'Attention needed: Agent asked a question'
  );

  // Error with snippet
  assert.equal(
    formatNotificationBody('error', 'Authentication failed'),
    'Attention needed: Agent encountered an error (Authentication failed)'
  );

  // Error without snippet
  assert.equal(
    formatNotificationBody('error', ''),
    'Attention needed: Agent encountered an error'
  );
});

test('isTaskInBackground evaluates task, visibility, and focus states', () => {
  const taskId = 'task-123';

  // Different task -> in background
  assert.equal(isTaskInBackground(taskId, 'task-456', false, true), true);

  // Home / Settings (currentTaskId is null) -> in background
  assert.equal(isTaskInBackground(taskId, null, false, true), true);

  // Same task, but document is hidden (minimized / background tab) -> in background
  assert.equal(isTaskInBackground(taskId, taskId, true, true), true);

  // Same task, but document is unfocused (user switched to another app) -> in background
  assert.equal(isTaskInBackground(taskId, taskId, false, false), true);

  // Same task, visible and focused -> NOT in background
  assert.equal(isTaskInBackground(taskId, taskId, false, true), false);
});
