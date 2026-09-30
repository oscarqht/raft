import { AgentStep } from '../types';

export function stripAnsi(text: string): string {
  if (!text) return '';
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

export function parseLegacyActionLine(line: string, index = 0): AgentStep | null {
  if (!line || typeof line !== 'string') return null;
  const clean = stripAnsi(line).trim();
  if (!clean) return null;
  const isArrow = clean.startsWith('→') || clean.startsWith('->');
  const text = clean.replace(/^(?:→|->)\s*/, '').trim();
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
      title: `View: ${file.split('/').pop() || file}`,
      detail: file,
      status: 'completed',
    };
  }
  if (
    text.toLowerCase().startsWith('edit file:') ||
    text.toLowerCase().startsWith('edit:') ||
    text.toLowerCase().startsWith('replace file:')
  ) {
    const file = text.split(':')[1]?.trim() || '';
    return {
      id: `legacy-${index}`,
      type: 'tool',
      toolName: 'replace_file_content',
      category: 'file_write',
      title: `Edit: ${file.split('/').pop() || file}`,
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
      title: `Search: ${q}`,
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
  if (!thoughtText || typeof thoughtText !== 'string') return [];
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

// Web Worker message dispatcher
self.onmessage = (
  e: MessageEvent<{ id: string; type: 'parseThought' | 'stripAnsi'; payload: string }>
) => {
  const { id, type, payload } = e.data;
  try {
    if (type === 'parseThought') {
      const result = parseLegacyThoughtToSteps(payload);
      self.postMessage({ id, result, error: null });
    } else if (type === 'stripAnsi') {
      const result = stripAnsi(payload);
      self.postMessage({ id, result, error: null });
    }
  } catch (err: any) {
    self.postMessage({ id, result: null, error: err?.message || String(err) });
  }
};
