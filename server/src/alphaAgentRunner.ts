import type { AgentStep, StreamEvent } from './agentRunner.js';
import { alphaDeviceService } from './alphaDeviceService.js';
import { getSetting } from './db.js';

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
  userEmail?: string;
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

    // Portal or page URL: e.g. /superagents/27785 or /app/superagents/27785 or /chatflows/12345
    const pageMatch = pathname.match(/(?:\/app)?\/(superagents|chatflows)\/(\d+|[a-zA-Z0-9_-]+)$/i);
    if (pageMatch) {
      const [, kind, id] = pageMatch;
      pathname = `/api/${kind.toLowerCase()}/${id}/run`;
    } else if (pathname.match(/(?:\/app)?\/(superagents|chatflows)\/(\d+|[a-zA-Z0-9_-]+)\/run(?:\/.*)?$/i)) {
      // It's already an explicit /run or /run/... endpoint
      if (!pathname.startsWith('/api') && !pathname.startsWith('/webapi')) {
        pathname = `/api${pathname.replace(/^\/app/, '')}`;
      }
    } else if (!pathname.includes('/run')) {
      pathname = `${pathname}/run`;
    }

    url.pathname = pathname;
    url.searchParams.set('stream', 'true');
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

export class AlphaConversationExpiredError extends Error {
  public conversationId?: string;
  public status: number;

  constructor(message: string, conversationId?: string, status: number = 410) {
    super(message);
    this.name = 'AlphaConversationExpiredError';
    this.conversationId = conversationId;
    this.status = status;
  }
}

export function isAlphaConversationExpiredError(error: any): boolean {
  if (!error) return false;
  if (error instanceof AlphaConversationExpiredError) return true;
  const msg = typeof error === 'string' ? error : error.message || '';
  return (
    (/410/i.test(msg) && /CONVERSATION_EXPIRED|conversation is expired/i.test(msg)) ||
    /CONVERSATION_EXPIRED/i.test(msg) ||
    /conversation is expired/i.test(msg)
  );
}

export interface ProjectTaskContext {
  projectName?: string;
  taskName?: string;
  worktreePath?: string;
  branch?: string;
  baseBranch?: string;
  systemPrompt?: string;
  isAlpha?: boolean;
  isSubsequentTurn?: boolean;
  jobRequirementTitle?: string;
  conversationHistory?: string;
  recoveryNotice?: string;
}

/**
 * Injects project & task context into an agent prompt
 * so that the AI agent (especially remote cloud SuperAgent like Alpha Intelligence)
 * knows the exact project, branch, worktree directory, and how to operate the connected local device terminal.
 */
export function buildAlphaPromptWithContext(
  userPrompt: string,
  context: ProjectTaskContext
): string {
  const branch = context.branch || 'main';
  const worktreeDir = context.worktreePath || process.cwd();

  // If subsequent turn in an ongoing chat session, provide a lightweight workspace reminder
  if (context.isSubsequentTurn) {
    const sections: string[] = [];
    const reminderLines = [
      `[Active Workspace Reminder]`,
      `- Working Directory: ${worktreeDir}`,
      `- Git Branch: ${branch}`,
    ];
    if (context.isAlpha !== false) {
      reminderLines.push(`Run terminal commands inside this working directory using run_command.`);
    }
    sections.push(reminderLines.join('\n'));
    sections.push(`[User Request]\n${userPrompt.trim()}`);
    return sections.join('\n\n');
  }

  const sections: string[] = [];
  const projectName = context.projectName || 'Unknown Project';
  const taskName = context.taskName;
  const baseBranch = context.baseBranch || 'main';

  // 1. [Project & Task Context]
  let contextSection = `[Project & Task Context]\n- Project: ${projectName}\n`;
  if (taskName) {
    contextSection += `- Task: ${taskName}\n`;
  }
  contextSection += `- Working Directory: ${worktreeDir}\n`;
  contextSection += `- Git Branch: ${branch} (base: ${baseBranch})`;
  sections.push(contextSection);

  // 2. [Project Instructions] (if configured)
  if (context.systemPrompt && context.systemPrompt.trim().length > 0) {
    sections.push(`[Project Instructions]\n${context.systemPrompt.trim()}`);
  }

  // 3. [Workspace Execution Guidance] (included when agent is Alpha Intelligence or not explicitly false)
  if (context.isAlpha !== false) {
    sections.push(
      `[Workspace Execution Guidance]\n` +
      `You are connected to this local computer via a local device terminal runner.\n` +
      `Always run your terminal commands (using run_command) inside the working directory above (${worktreeDir}) to view, edit, build, or test code for this task.`
    );
  }

  // 4. [Session Recovery Guidance] (if recovered after cloud conversation expiration)
  if (context.recoveryNotice && context.recoveryNotice.trim().length > 0) {
    sections.push(`[Session Recovery]\n${context.recoveryNotice.trim()}`);
  }

  // 5. [Previous Conversation History] (if provided for conversation context restoration)
  if (context.conversationHistory && context.conversationHistory.trim().length > 0) {
    sections.push(`[Previous Conversation History]\n${context.conversationHistory.trim()}`);
  }

  // 6. [Job Requirement / User Request]
  const reqTitle = context.jobRequirementTitle || 'User Request';
  sections.push(`[${reqTitle}]\n${userPrompt.trim()}`);

  return sections.join('\n\n');
}

export const buildPromptWithContext = buildAlphaPromptWithContext;

export interface AlphaAuxiliaryJobOptions {
  prompt: string;
  worktreePath: string;
  onEvent?: (event: StreamEvent) => void;
  signal?: AbortSignal;
}

/**
 * Runs a single-turn auxiliary job (discovery, commit message, conflict resolution)
 * using Alpha Intelligence in an isolated, ephemeral session.
 * Reconnects device bridge if needed, and fails with descriptive error if unconfigured/offline.
 */
export async function executeAlphaAuxiliaryJob(
  options: AlphaAuxiliaryJobOptions
): Promise<{ fullContent: string; steps: AgentStep[] }> {
  const { prompt, worktreePath, onEvent, signal } = options;

  const apiUrl = getSetting<string>('alpha_intelligence_api_url', '');
  const apiKey = getSetting<string>('alpha_intelligence_api_key', '');

  if (!apiUrl || !apiKey) {
    throw new Error('Alpha Intelligence is not configured. Please set API URL and API Key in Settings > Alpha Intelligence.');
  }

  if (worktreePath) {
    alphaDeviceService.setActiveWorktree(worktreePath);
  }

  // Quick reconnect attempt if disconnected
  if (!alphaDeviceService.getStatus().connected) {
    onEvent?.({ type: 'status', content: 'Connecting to Alpha Intelligence device bridge...\n' });
    await alphaDeviceService.ensureConnected(5000).catch(() => {});
    if (!alphaDeviceService.getStatus().connected) {
      throw new Error('Alpha Intelligence device bridge is not connected. Please pair and connect your device in Settings > Alpha Intelligence.');
    }
  }

  const ephemeralSessionId = `aux-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ephemeralMsgId = `aux-msg-${Date.now()}`;

  const result = await runAlphaIntelligenceTurn({
    apiUrl,
    apiKey,
    userEmail: getSetting<string>('alpha_intelligence_email', '') || undefined,
    prompt,
    worktreePath,
    sessionId: ephemeralSessionId,
    messageId: ephemeralMsgId,
    signal,
    onEvent: onEvent || (() => {}),
  });

  return {
    fullContent: result.fullContent,
    steps: result.steps,
  };
}

export async function runAlphaIntelligenceTurn(options: RunAlphaOptions): Promise<{
  fullContent: string;
  conversationId?: string;
  steps: AgentStep[];
}> {
  const { apiUrl, apiKey, userEmail, prompt, conversationId, worktreePath, sessionId, messageId, signal, onEvent, onHitlRequired, onConversationId } = options;

  if (worktreePath) {
    alphaDeviceService.setActiveWorktree(worktreePath);
  }

  // Ensure local terminal device bridge is connected before executing turn
  if (!alphaDeviceService.getStatus().connected) {
    console.log('[AlphaRunner] Local device not connected, attempting to connect before starting turn...');
    await alphaDeviceService.ensureConnected(5000).catch((err) => {
      console.warn('[AlphaRunner] Pre-turn device connect check failed:', err);
    });
  }

  const runUrl = normalizeAlphaApiUrl(apiUrl);
  console.log(`[AlphaRunner] Starting turn at ${runUrl}, convId=${conversationId}`);

  let currentConvId = conversationId;
  let fullContent = '';
  const steps: AgentStep[] = [];
  const stepMap = new Map<string, AgentStep>();
  let doneEmitted = false;

  const emitEvent = (evt: StreamEvent) => {
    if (evt.type === 'done') {
      if (doneEmitted) return;
      doneEmitted = true;
    }
    if (evt.type === 'chunk' && evt.content) {
      fullContent += evt.content;
    }
    onEvent(evt);
  };

  const resolvedEmail = userEmail?.trim() || (await alphaDeviceService.getUserEmail());

  const requestBody: Record<string, any> = {
    query: prompt,
    inputs: {
      query: prompt,
    },
    conversation_id: conversationId || undefined,
  };

  if (resolvedEmail) {
    requestBody.metadata = {
      employee_email: resolvedEmail,
    };
  }

  const response = await fetch(runUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
      Accept: 'text/event-stream',
      'X-Agent-Mode': 'advanced',
    },
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    if (
      response.status === 410 ||
      /CONVERSATION_EXPIRED|conversation is expired/i.test(errorText)
    ) {
      throw new AlphaConversationExpiredError(
        `Alpha Intelligence API returned HTTP ${response.status}: ${errorText || response.statusText}`,
        conversationId,
        response.status
      );
    }
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
              onEvent: emitEvent,
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

    if (!doneEmitted) {
      emitEvent({ type: 'done' });
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

function parseToolOutput(rawResult: any): string | undefined {
  if (rawResult === undefined || rawResult === null) return undefined;
  let str = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
  try {
    const parsed = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
    if (parsed && typeof parsed.text === 'string') {
      try {
        const inner = JSON.parse(parsed.text);
        if (inner && (typeof inner.stdout === 'string' || typeof inner.stderr === 'string')) {
          const parts: string[] = [];
          if (inner.stdout) parts.push(inner.stdout);
          if (inner.stderr) parts.push(`[stderr]\n${inner.stderr}`);
          return parts.join('\n') || `(Exit code: ${inner.exitCode ?? 0})`;
        }
      } catch {
        return parsed.text;
      }
    }
  } catch {
    // keep str
  }
  return str;
}

async function handleAlphaSseEvent(ctx: SseContext): Promise<void> {
  const { event, data, sessionId, messageId, steps, stepMap, onEvent, onHitlRequired, onConversationId } = ctx;

  // 1. Invocation and start events
  if (
    event === 'message.start' ||
    event === 'superagent.invoked' ||
    event === 'chatflow.invoked' ||
    event === 'workflow.invoked'
  ) {
    const convId = data?.conversation_id || data?.conversationId;
    if (convId) {
      onConversationId?.(convId);
    }
    return;
  }

  // 2. Stream message chunks (text, reasoning, tool_call, sub_agent, action_summary)
  if (event === 'message') {
    const apiMessage = data?.message || {};
    const msgType = apiMessage.type || data?.type || (data?.text ? 'text' : undefined);
    const textContent = typeof apiMessage.text === 'string' ? apiMessage.text : typeof data?.text === 'string' ? data.text : '';
    const reasoningContent = typeof apiMessage.reasoning === 'string' ? apiMessage.reasoning : typeof data?.reasoning === 'string' ? data.reasoning : '';
    const convId = data?.conversation_id || data?.conversationId || apiMessage.conversation_id;
    if (convId) {
      onConversationId?.(convId);
    }

    // Skip metadata / frame headers
    if (msgType === 'meta' || msgType === 'final_result') {
      return;
    }

    if (msgType === 'text' || (!msgType && textContent)) {
      if (textContent) {
        onEvent({ type: 'chunk', content: textContent });
      }
      return;
    }

    if (msgType === 'reasoning' || msgType === 'thought' || msgType?.startsWith?.('react.')) {
      const thought = reasoningContent || textContent;
      if (thought) {
        onEvent({ type: 'thought', content: thought });
      }
      return;
    }

    if (msgType === 'action_summary') {
      const summary = textContent || reasoningContent;
      if (summary) {
        onEvent({ type: 'thought', content: `\n[${summary}]\n` });
      }
      return;
    }

    if (msgType === 'tool_call') {
      const toolCall = apiMessage.tool || data?.tool_call || data?.tool || data;
      const stepId = String(toolCall.id || toolCall.name || `tool_${steps.length}`);
      let step = stepMap.get(stepId);

      const isFinished = toolCall.status === 'completed' || toolCall.status === 'failed' || toolCall.result !== undefined;
      const stepStatus: AgentStep['status'] =
        toolCall.status === 'failed' ? 'failed' : isFinished ? 'completed' : 'running';

      const rawToolName = toolCall.name || toolCall.client?.tool_name || 'Terminal';
      const isRunCommand = rawToolName.endsWith('run_command') || toolCall.client?.tool_name === 'run_command' || rawToolName === 'run_command';

      let parsedCmd: string | undefined;
      let rawArgs = toolCall.arguments || toolCall.argument_delta || toolCall.input;
      if (toolCall.arguments) {
        try {
          const parsed = typeof toolCall.arguments === 'string' ? JSON.parse(toolCall.arguments) : toolCall.arguments;
          if (parsed && typeof parsed.command === 'string') {
            const extra = Array.isArray(parsed.args) ? parsed.args.join(' ') : '';
            parsedCmd = `${parsed.command} ${extra}`.trim();
          }
        } catch {}
      }

      const formattedArgs = parsedCmd || (rawArgs ? (typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs)) : undefined);
      const toolOutput = parseToolOutput(toolCall.result);

      const title = isRunCommand
        ? parsedCmd
          ? `Run: ${parsedCmd}`
          : 'Run terminal command'
        : `Tool: ${rawToolName}`;

      if (!step) {
        step = {
          id: stepId,
          type: 'tool',
          category: isRunCommand ? 'command' : 'other',
          toolName: isRunCommand ? 'Terminal' : rawToolName,
          title,
          detail: formattedArgs,
          status: stepStatus,
          startTime: Date.now(),
          output: toolOutput,
        };
        stepMap.set(stepId, step);
        steps.push(step);
      } else {
        step.status = stepStatus;
        if (title && step.title !== title && (parsedCmd || !step.title.startsWith('Run: '))) {
          step.title = title;
        }
        if (formattedArgs) {
          step.detail = formattedArgs;
        }
        if (toolOutput !== undefined) {
          step.output = toolOutput;
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
      const subAgent = apiMessage.sub_agent || data?.sub_agent || data;
      const stepId = String(subAgent.id || subAgent.name || `subagent_${steps.length}`);
      let step = stepMap.get(stepId);
      const isFinished = subAgent.status === 'completed' || subAgent.status === 'failed' || subAgent.output !== undefined;

      if (!step) {
        step = {
          id: stepId,
          type: 'tool',
          category: 'other',
          toolName: subAgent.name || 'SubAgent',
          title: `Subagent: ${subAgent.name || 'Agent'}`,
          status: isFinished ? (subAgent.status === 'failed' ? 'failed' : 'completed') : 'running',
          startTime: Date.now(),
          output: subAgent.output ? (typeof subAgent.output === 'string' ? subAgent.output : JSON.stringify(subAgent.output, null, 2)) : undefined,
        };
        stepMap.set(stepId, step);
        steps.push(step);
      } else {
        step.status = isFinished ? (subAgent.status === 'failed' ? 'failed' : 'completed') : 'running';
        if (subAgent.output !== undefined) {
          step.output = typeof subAgent.output === 'string' ? subAgent.output : JSON.stringify(subAgent.output, null, 2);
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

    if (msgType === 'error' || msgType === 'warning') {
      const errText = textContent || data?.error?.message || (typeof data?.error === 'string' ? data.error : 'Agent error');
      onEvent({ type: 'error', content: errText });
      return;
    }
  }

  // 3. Human-in-the-Loop & Device Selection
  if (event === 'input.completed') {
    if (data?.client) {
      const clientName = data.client.name || data.client.clientId;
      onEvent({
        type: 'thought',
        content: `\n[Using local device: ${clientName}]\n`,
      });
    }
    return;
  }

  if (
    event === 'input.required' ||
    event === 'message.input.required'
  ) {
    console.log('[AlphaRunner] Received input.required event', data);

    // Check if this is a local device selection prompt
    if (isDeviceSelectionInput(data)) {
      let clientId = alphaDeviceService.getClientId();
      if (!clientId) {
        const elements = data?.widget?.elements;
        if (Array.isArray(elements)) {
          for (const el of elements) {
            if (el?.type === 'button_group' && Array.isArray(el?.button_group)) {
              const raftBtn = el.button_group.find((btn: any) =>
                btn?.text?.toLowerCase()?.includes('raft') || btn?.title?.toLowerCase()?.includes('raft')
              ) || el.button_group[0];
              if (raftBtn?.value) {
                clientId = raftBtn.value;
                break;
              }
            }
          }
        }
      }
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
    event === 'message.end' ||
    event === 'superagent.completed' ||
    event === 'chatflow.completed' ||
    event === 'workflow.completed'
  ) {
    const convId = data?.conversation_id || data?.conversationId;
    if (convId) {
      onConversationId?.(convId);
    }
    if (data?.error) {
      const errorMsg = data.error.message || (typeof data.error === 'string' ? data.error : 'Execution failed');
      onEvent({ type: 'error', content: errorMsg });
      return;
    }
    onEvent({ type: 'done' });
    return;
  }

  if (
    event === 'superagent.aborted' ||
    event === 'chatflow.aborted' ||
    event === 'workflow.aborted'
  ) {
    const errorMsg = data?.error?.message || (typeof data?.error === 'string' ? data.error : 'Agent workflow aborted');
    onEvent({ type: 'error', content: errorMsg });
    return;
  }
}
