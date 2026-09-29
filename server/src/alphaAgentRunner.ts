import type { AgentStep, StreamEvent } from './agentRunner.js';
import { alphaDeviceService } from './alphaDeviceService.js';

export interface HitlRequiredPayload {
  state: string;
  callback_url: string;
  timeout?: number;
  expires_at?: number;
  widget?: any;
  messageId?: string;
  sessionId?: string;
}

export interface RunAlphaOptions {
  apiUrl: string;
  apiKey: string;
  prompt: string;
  conversationId?: string;
  worktreePath?: string;
  sessionId: string;
  messageId: string;
  signal?: AbortSignal;
  onEvent: (event: StreamEvent) => void;
  onHitlRequired?: (hitl: HitlRequiredPayload) => void;
  onConversationId?: (convId: string) => void;
}

export function isDeviceSelectionInput(event: any): boolean {
  const elements = event?.widget?.elements;
  if (!Array.isArray(elements)) return false;
  return elements.some(
    (element: any) =>
      element?.type === 'button_group' &&
      Array.isArray(element?.button_group) &&
      element.button_group.some((btn: any) => typeof btn?.client_type === 'number')
  );
}

export function normalizeAlphaApiUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.trim());
    let pathname = url.pathname.replace(/\/+$/, '');
    if (!pathname.endsWith('/run')) {
      pathname = `${pathname}/run`;
    }
    url.pathname = pathname;
    url.searchParams.set('stream', 'true');
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

export async function runAlphaIntelligenceTurn(options: RunAlphaOptions): Promise<{
  fullContent: string;
  conversationId?: string;
  steps: AgentStep[];
}> {
  const { apiUrl, apiKey, prompt, conversationId, worktreePath, sessionId, messageId, signal, onEvent, onHitlRequired, onConversationId } = options;

  if (worktreePath) {
    alphaDeviceService.setActiveWorktree(worktreePath);
  }

  const runUrl = normalizeAlphaApiUrl(apiUrl);
  console.log(`[AlphaRunner] Starting turn at ${runUrl}, convId=${conversationId}`);

  let currentConvId = conversationId;
  let fullContent = '';
  const steps: AgentStep[] = [];
  const stepMap = new Map<string, AgentStep>();

  const requestBody = {
    query: prompt,
    inputs: {
      query: prompt,
    },
    conversation_id: conversationId || undefined,
  };

  const response = await fetch(runUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Alpha Intelligence API returned HTTP ${response.status}: ${errorText || response.statusText}`);
  }

  if (!response.body) {
    throw new Error('Alpha Intelligence API response has no body stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  let currentEventType = 'message';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
          currentEventType = 'message';
          continue;
        }

        if (line.startsWith('event:')) {
          currentEventType = line.slice(6).trim();
          continue;
        }

        if (line.startsWith('data:')) {
          const rawData = line.slice(5).trim();
          if (!rawData || rawData === '[DONE]') continue;

          try {
            const data = JSON.parse(rawData);
            await handleAlphaSseEvent({
              event: currentEventType,
              data,
              sessionId,
              messageId,
              steps,
              stepMap,
              onEvent: (evt) => {
                if (evt.type === 'chunk' && evt.content) {
                  fullContent += evt.content;
                }
                onEvent(evt);
              },
              onHitlRequired,
              onConversationId: (cid) => {
                currentConvId = cid;
                onConversationId?.(cid);
              },
            });
          } catch (parseErr) {
            console.warn('[AlphaRunner] Failed to parse SSE JSON data:', parseErr, rawData);
          }
        }
      }
    }
  } catch (err: any) {
    if (signal?.aborted) {
      console.log('[AlphaRunner] Request was aborted');
    } else {
      throw err;
    }
  }

  return {
    fullContent,
    conversationId: currentConvId,
    steps,
  };
}

interface SseContext {
  event: string;
  data: any;
  sessionId: string;
  messageId: string;
  steps: AgentStep[];
  stepMap: Map<string, AgentStep>;
  onEvent: (event: StreamEvent) => void;
  onHitlRequired?: (hitl: HitlRequiredPayload) => void;
  onConversationId?: (cid: string) => void;
}

async function handleAlphaSseEvent(ctx: SseContext): Promise<void> {
  const { event, data, sessionId, messageId, steps, stepMap, onEvent, onHitlRequired, onConversationId } = ctx;

  // 1. Invocation events
  if (
    event === 'superagent.invoked' ||
    event === 'chatflow.invoked' ||
    event === 'workflow.invoked'
  ) {
    if (data.conversation_id) {
      onConversationId?.(data.conversation_id);
    }
    return;
  }

  // 2. Stream chunks (text, reasoning, tool_call, sub_agent)
  if (event === 'message') {
    const msgType = data.type;

    if (msgType === 'text' && typeof data.text === 'string') {
      onEvent({ type: 'chunk', content: data.text });
      return;
    }

    if (msgType === 'reasoning' && typeof data.reasoning === 'string') {
      onEvent({ type: 'thought', content: data.reasoning });
      return;
    }

    if (msgType === 'tool_call') {
      const toolCall = data.tool_call || data;
      const stepId = String(toolCall.id || toolCall.name || `tool_${steps.length}`);
      let step = stepMap.get(stepId);

      const isFinished = toolCall.status === 'completed' || toolCall.status === 'failed' || Boolean(toolCall.result);
      const stepStatus: AgentStep['status'] =
        toolCall.status === 'failed' ? 'failed' : isFinished ? 'completed' : 'running';

      if (!step) {
        step = {
          id: stepId,
          type: 'tool',
          category: 'command',
          toolName: toolCall.name || 'Terminal',
          title: `Tool: ${toolCall.name || 'Terminal'}`,
          detail: toolCall.arguments ? (typeof toolCall.arguments === 'string' ? toolCall.arguments : JSON.stringify(toolCall.arguments)) : undefined,
          status: stepStatus,
          startTime: Date.now(),
          output: toolCall.result ? (typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2)) : undefined,
        };
        stepMap.set(stepId, step);
        steps.push(step);
      } else {
        step.status = stepStatus;
        if (toolCall.result) {
          step.output = typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2);
        }
        if (isFinished && step.startTime && !step.duration) {
          step.duration = Math.round(((Date.now() - step.startTime) / 1000) * 10) / 10;
        }
      }

      onEvent({
        type: 'step',
        step,
      });
      return;
    }

    if (msgType === 'sub_agent') {
      const subAgent = data.sub_agent || data;
      const stepId = String(subAgent.id || subAgent.name || `subagent_${steps.length}`);
      let step = stepMap.get(stepId);
      const isFinished = subAgent.status === 'completed' || subAgent.status === 'failed';

      if (!step) {
        step = {
          id: stepId,
          type: 'tool',
          category: 'other',
          toolName: subAgent.name || 'SubAgent',
          title: `Subagent: ${subAgent.name || 'Agent'}`,
          status: isFinished ? (subAgent.status === 'failed' ? 'failed' : 'completed') : 'running',
          startTime: Date.now(),
        };
        stepMap.set(stepId, step);
        steps.push(step);
      } else {
        step.status = isFinished ? (subAgent.status === 'failed' ? 'failed' : 'completed') : 'running';
        if (isFinished && step.startTime && !step.duration) {
          step.duration = Math.round(((Date.now() - step.startTime) / 1000) * 10) / 10;
        }
      }

      onEvent({
        type: 'step',
        step,
      });
      return;
    }
  }

  // 3. Human-in-the-Loop & Device Selection
  if (
    event === 'input.required' ||
    event === 'message.input.required'
  ) {
    console.log('[AlphaRunner] Received input.required event', data);

    // Check if this is a local device selection prompt
    if (isDeviceSelectionInput(data)) {
      const clientId = alphaDeviceService.getClientId();
      console.log(`[AlphaRunner] Device selection prompt detected. Raft connected clientId=${clientId}`);

      if (clientId && data.callback_url) {
        try {
          const submitRes = await fetch(data.callback_url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: clientId,
          });
          console.log(`[AlphaRunner] Auto-submitted client ${clientId} to ${data.callback_url}, status=${submitRes.status}`);

          onEvent({
            type: 'thought',
            content: `\n[Connected to local terminal device: ${clientId}]\n`,
          });
          return;
        } catch (subErr) {
          console.error('[AlphaRunner] Failed to auto-submit device selection:', subErr);
        }
      }
    }

    // Otherwise, broadcast HITL to frontend
    if (onHitlRequired && data.callback_url) {
      onHitlRequired({
        state: data.state,
        callback_url: data.callback_url,
        timeout: data.timeout,
        expires_at: data.expires_at,
        widget: data.widget,
        sessionId,
        messageId,
      });
    }
    return;
  }

  // 4. Completion & Abort events
  if (
    event === 'superagent.completed' ||
    event === 'chatflow.completed' ||
    event === 'workflow.completed'
  ) {
    if (data.conversation_id) {
      onConversationId?.(data.conversation_id);
    }
    onEvent({ type: 'done' });
    return;
  }

  if (
    event === 'superagent.aborted' ||
    event === 'workflow.aborted'
  ) {
    const errorMsg = data?.error?.message || 'Agent workflow aborted';
    onEvent({ type: 'error', content: errorMsg });
    return;
  }
}
