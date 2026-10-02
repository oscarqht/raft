import type { AgentStep } from './types';

export function applyStreamSteps(current: AgentStep[] | undefined, update: {
  steps?: AgentStep[];
  stepsPatch?: AgentStep[];
  stepOrder?: string[];
}): AgentStep[] | undefined {
  if (update.steps) return update.steps;
  if (!update.stepsPatch) return current;
  const byId = new Map((current || []).map((step) => [step.id, step]));
  for (const step of update.stepsPatch) byId.set(step.id, step);
  return update.stepOrder
    ? update.stepOrder.map((id) => byId.get(id)).filter((step): step is AgentStep => Boolean(step))
    : [...byId.values()];
}

export function applyStreamContent(current: string, patch: { prefixLength: number; text: string }): string {
  return current.slice(0, patch.prefixLength) + patch.text;
}
