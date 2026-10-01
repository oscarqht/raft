import React, { useState, useRef, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Bot, User, ChevronDown, ChevronRight, Copy, Check, Terminal, Cpu, Sparkles,
  FileCode, Play, ZoomIn, Download, Eye, AlertTriangle, Coins, Settings as SettingsIcon, Zap,
  CheckCircle2, XCircle, Loader2, Square, Search, Edit3, Globe, Brain, Clock, ChevronUp,
  KeyRound, RotateCcw, Braces, ArrowDown
} from 'lucide-react';
import { ChatMessage, FileAttachment, CliInfo, AgentStep, AlphaHitlPayload, ActivitySummary } from '../types';
import { getMessageActivity } from '../api';
import Ansi from 'ansi-to-react';
import { MarkdownView } from './MarkdownView';
import { HumanInputCard } from './HumanInputCard';
import { ErrorBoundary } from './ErrorBoundary';
import {
  isImageAttachment,
  isCodeOrTextAttachment,
  getFileIcon,
  formatFileSize,
  ImageLightboxModal,
  FilePreviewModal,
} from './AttachmentModals';
import {
  stripAnsi,
  parseLegacyActionLine,
  parseLegacyThoughtToStepsSync as parseLegacyThoughtToSteps,
} from '../utils/parserWorkerClient';

export { stripAnsi, parseLegacyActionLine, parseLegacyThoughtToSteps };

export interface DetectedSkillChip {
  name: string;
  description?: string;
  content?: string;
}

export const KNOWN_SKILL_DETAILS: Record<string, { description?: string; content?: string }> = {
  'grill-me': {
    description: 'Interview me to align on a plan.',
    content: `<GRILL_ME>
The user has requested that you interview them about every aspect of their task until you've reached a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Guidelines:
- Ask the questions one at a time.
- If a question can be answered by exploring the codebase, explore the codebase instead.
- If an ask_question tool is available, use it; otherwise ask directly in your response.
</GRILL_ME>`,
  },
  'plan': {
    description: 'Plan carefully before executing a task.',
    content: `<PLAN>
The user has requested that you create a structured, step-by-step implementation plan before modifying any code.
Inspect the relevant files, identify dependencies, evaluate potential risks, and design the solution. Present the plan clearly with phases and verification steps before proceeding.
</PLAN>`,
  },
  'goal': {
    description: 'Run until the specified goal is completely finished.',
    content: `<GOAL>
The user has marked this task with /goal, indicating that this task is intended to run until the specified goal is completely fulfilled.
Be extra thorough, verify every step, run all relevant tests, and only stop when you are confident the goal has been fully achieved.
</GOAL>`,
  },
  'schedule': {
    description: 'Run an instruction on a recurring schedule or as a one-time timer.',
    content: `<SCHEDULE>
The user has requested that you run an instruction on a recurring schedule or as a one-time timer.
Use available scheduling or timer tools to configure the desired schedule or timer.
</SCHEDULE>`,
  },
  'browser': {
    description: 'Invoke a browser agent for web tasks.',
    content: `<BROWSER>
The user has requested to invoke a browser agent or web automation tools. Use browser navigation tools to inspect pages, extract web content, or test web applications.
</BROWSER>`,
  },
  'learn': {
    description: 'Reflect on recent successes or corrections to capture reusable skills or rules.',
    content: `<LEARN>
Reflect on recent interactions, successes, errors, or corrections in this session to capture reusable skills, conventions, or rules for future tasks.
</LEARN>`,
  },
  'btw': {
    description: 'Ask a quick question without interrupting the main conversation.',
    content: `<BTW>
The user is asking a quick side question without wanting to interrupt or derail the main conversation. Provide a direct, concise answer.
</BTW>`,
  },
  'review': {
    description: 'Review staged or working tree changes with automated feedback.',
  },
  'init': {
    description: 'Initialize configuration and guidelines for this repository.',
  },
  'doctor': {
    description: 'Diagnose installation, configuration, and environment.',
  },
  'commit': {
    description: 'Generate high-quality commit message and commit changes.',
  },
};


export const SPEND_CAP_REGEX =
  /(?:^|\b)(?:you(?: have|'ve)? hit your spend cap|spend cap set by the owner|exceeded your (?:monthly |current )?budget|insufficient_quota|credit balance is too low|usage cap (?:reached|exceeded)|your quota has been exceeded)(?:\b|$)/i;

export const AUTH_REQUIRED_REGEX =
  /oauth session expired|failed to authenticate|sign in again|login required|authentication required|not logged in|please sign in|run `?claude`? to sign in|run `?codex login`?|codex login required|authentication failed|credentials expired|google authentication required/i;

export interface SpendCapInfo {
  isSpendCap: boolean;
  title: string;
  message: string;
  cliName?: string;
  modelName?: string;
}

export function detectSpendCapInfo(msg: ChatMessage, fallbackCli?: string): SpendCapInfo {
  let cliName = fallbackCli || '';
  let modelName = '';
  let isSpendCap = false;
  let customErrorMsg = '';

  let hasMetadata = false;
  let isErrorInMetadata = false;

  if (msg.metadata) {
    try {
      const parsed = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata;
      hasMetadata = true;
      if (parsed.cli) cliName = parsed.cli;
      if (parsed.model) modelName = parsed.model;
      if (parsed.errorType === 'spend_cap' || parsed.isSpendCap) {
        isSpendCap = true;
        if (parsed.errorMessage) customErrorMsg = parsed.errorMessage;
      }
      if (parsed.error) {
        isErrorInMetadata = true;
      }
    } catch {}
  }

  const rawClean = stripAnsi(msg.content || '').trim();
  if (!isSpendCap) {
    // Only fallback to regex if metadata is absent or message was flagged as error,
    // and content is short (< 350 chars), preventing lengthy normal markdown responses from false-positive matching
    const isEligible = !hasMetadata || isErrorInMetadata;
    if (isEligible && rawClean.length < 350 && SPEND_CAP_REGEX.test(rawClean)) {
      isSpendCap = true;
    }
  }

  if (isSpendCap) {
    let cleanMessage = customErrorMsg;
    if (!cleanMessage) {
      const match = rawClean.match(
        /(?:ERROR:\s*)?(You hit your spend cap[^.\n]*\.[^\n]*|.*budget[^.\n]*\.[^\n]*|.*quota exceeded[^.\n]*|.*out of credits[^.\n]*)/i
      );
      cleanMessage = match
        ? match[1].replace(/^ERROR:\s*/i, '').trim()
        : 'You hit your spend cap set by the owner of your workspace. Ask an owner to increase your spend cap to continue.';
    }

    if (!modelName) {
      const modelMatch = rawClean.match(/model:\s*([a-zA-Z0-9._-]+)/i);
      if (modelMatch) modelName = modelMatch[1];
    }
    if (!cliName) {
      if (/codex/i.test(rawClean)) cliName = 'codex';
      else if (/claude/i.test(rawClean)) cliName = 'claude';
      else if (/agy|antigravity/i.test(rawClean)) cliName = 'agy';
    }

    return {
      isSpendCap: true,
      title: 'Spend Cap Reached',
      message: cleanMessage,
      cliName,
      modelName,
    };
  }

  return { isSpendCap: false, title: '', message: '' };
}

export interface AuthRequiredInfo {
  isAuthRequired: boolean;
  title: string;
  badge: string;
  message: string;
  cliName: string;
  modelName?: string;
  loginCommand: string;
  loginGuideText: string;
}

export function detectAuthRequiredInfo(msg: ChatMessage, fallbackCli?: string): AuthRequiredInfo {
  let cliName = fallbackCli || '';
  let modelName = '';
  let isAuthRequired = false;
  let customErrorMsg = '';

  let hasMetadata = false;
  let isErrorInMetadata = false;

  if (msg.metadata) {
    try {
      const parsed = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata;
      hasMetadata = true;
      if (parsed.cli) cliName = parsed.cli;
      if (parsed.model) modelName = parsed.model;
      if (parsed.errorType === 'auth_required' || parsed.isAuthRequired) {
        isAuthRequired = true;
        if (parsed.errorMessage) customErrorMsg = parsed.errorMessage;
      }
      if (parsed.error) {
        isErrorInMetadata = true;
      }
    } catch {}
  }

  const rawClean = stripAnsi(msg.content || '').trim();
  if (!isAuthRequired) {
    // Only fallback to regex if metadata is absent or message was flagged as error,
    // and content is short (< 350 chars)
    const isEligible = !hasMetadata || isErrorInMetadata;
    if (isEligible && rawClean.length < 350 && AUTH_REQUIRED_REGEX.test(rawClean)) {
      isAuthRequired = true;
    }
  }

  if (isAuthRequired) {
    if (!cliName) {
      if (/claude/i.test(rawClean)) cliName = 'claude';
      else if (/codex/i.test(rawClean)) cliName = 'codex';
      else if (/agy|antigravity|google/i.test(rawClean)) cliName = 'agy';
    }

    const normCli = (cliName || 'claude').toLowerCase();
    const isOAuthExpired = /oauth session expired|session expired|sign in again/i.test(rawClean || customErrorMsg);

    let title = 'Authentication Required';
    let badge = 'Sign In Required';
    let loginCommand = 'claude';
    let loginGuideText = 'Run in your terminal to sign in, or sign in via the Claude app, then click Retry.';
    let defaultMsg = 'The AI agent requires authentication before it can execute commands.';

    if (normCli === 'claude') {
      loginCommand = 'claude';
      if (isOAuthExpired) {
        title = 'OAuth Session Expired';
        badge = 'Session Expired';
        defaultMsg = 'Your Claude Code OAuth session has expired and could not be refreshed. For your security, sign in again to keep using Claude.';
      } else {
        title = 'Claude Code Authentication Required';
        badge = 'Login Required';
        defaultMsg = 'Claude Code requires authentication. Sign in with your Anthropic Console account or set ANTHROPIC_API_KEY.';
      }
      loginGuideText = 'Run in your terminal or sign in via the Claude app, then click Retry with Claude.';
    } else if (normCli === 'codex') {
      loginCommand = 'codex login';
      title = 'OpenAI Codex Login Required';
      badge = 'Login Required';
      defaultMsg = 'OpenAI Codex authentication is missing or expired. Sign in via your terminal or configure OPENAI_API_KEY.';
      loginGuideText = 'Run in your terminal to sign in, then click Retry with Codex.';
    } else if (normCli === 'agy') {
      loginCommand = 'agy';
      title = 'Google Antigravity Authentication Required';
      badge = 'Sign In Required';
      defaultMsg = 'Google Antigravity credentials have expired. Follow the browser authentication prompt in your terminal.';
      loginGuideText = 'Run in your terminal to authenticate with Google, then click Retry with Antigravity.';
    }

    let cleanMessage = customErrorMsg || defaultMsg;
    if (cleanMessage.startsWith('Failed to authenticate:')) {
      cleanMessage = cleanMessage.replace(/^Failed to authenticate:\s*/i, '').trim();
      cleanMessage = cleanMessage.charAt(0).toUpperCase() + cleanMessage.slice(1);
    }

    if (!modelName) {
      const modelMatch = rawClean.match(/model:\s*([a-zA-Z0-9._-]+)/i);
      if (modelMatch) modelName = modelMatch[1];
    }

    return {
      isAuthRequired: true,
      title,
      badge,
      message: cleanMessage,
      cliName: normCli,
      modelName,
      loginCommand,
      loginGuideText,
    };
  }

  return {
    isAuthRequired: false,
    title: '',
    badge: '',
    message: '',
    cliName: '',
    loginCommand: '',
    loginGuideText: '',
  };
}

const LiveElapsedTimer: React.FC<{ startTime?: number }> = ({ startTime }) => {
  const [elapsed, setElapsed] = useState(() => (startTime ? Math.max(0, (Date.now() - startTime) / 1000) : 0));
  useEffect(() => {
    if (!startTime) return;
    const interval = setInterval(() => {
      setElapsed(Math.max(0, (Date.now() - startTime) / 1000));
    }, 100);
    return () => clearInterval(interval);
  }, [startTime]);
  return <span>{elapsed.toFixed(1)}s</span>;
};

export function normalizeStepOutput(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'boolean') return '';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object') {
    if ('message' in (val as any) && typeof (val as any).message === 'string') {
      return (val as any).message;
    }
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

const StepOutputDrawer: React.FC<{
  output?: unknown;
  error?: unknown;
  status: 'running' | 'completed' | 'failed';
}> = ({ output, error, status }) => {
  const [copied, setCopied] = useState(false);
  const [expandedFull, setExpandedFull] = useState(false);

  const text = useMemo(() => {
    const errText = normalizeStepOutput(error);
    const outText = normalizeStepOutput(output);

    if (errText && outText && errText !== outText) {
      return `${errText}\n\n${outText}`;
    }
    const combined = errText || outText;
    if (combined) return combined;

    if (status === 'failed' || error === true) {
      return 'Operation failed without additional output details.';
    }
    return '';
  }, [error, output, status]);

  const lines = useMemo(() => (text ? text.split('\n') : []), [text]);
  const isTruncated = lines.length > 25;
  const displayLines = expandedFull || !isTruncated ? lines : lines.slice(0, 20);
  const displayText = displayLines.join('\n');

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(stripAnsi(text));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!text) {
    return (
      <div className="mt-1.5 px-3 py-2 rounded-lg bg-black/10 dark:bg-black/30 text-[11px] text-cozy-muted font-mono italic">
        (No output recorded)
      </div>
    );
  }

  const isFailed = status === 'failed';

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`mt-2 rounded-xl overflow-hidden border text-left shadow-soft-inner transition-all ${
        isFailed
          ? 'border-rose-500/40 bg-[#140b0e] dark:bg-[#11070a]'
          : 'border-cozy-border/60 bg-[#090d16] dark:bg-[#070b12]'
      }`}
    >
      <div
        className={`flex items-center justify-between px-3 py-1.5 border-b text-[10px] select-none ${
          isFailed
            ? 'bg-rose-950/40 border-rose-500/20 text-rose-300'
            : 'bg-black/40 border-white/5 text-cozy-muted'
        }`}
      >
        <span className="font-mono">
          {lines.length} {lines.length === 1 ? 'line' : 'lines'} • {Math.round((text.length / 1024) * 10) / 10} KB
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-white/10 text-slate-300 hover:text-white transition-all cursor-pointer"
          title="Copy output"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <div
        className={`p-3 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-60 overflow-y-auto select-text ${
          isFailed
            ? 'text-rose-100 selection:bg-rose-500/40'
            : 'text-slate-300 selection:bg-teal-500/30'
        }`}
      >
        <pre className="whitespace-pre-wrap break-all font-mono">
          <Ansi>{displayText}</Ansi>
        </pre>
        {isTruncated && !expandedFull && (
          <div
            className={`mt-2 pt-2 border-t flex justify-center ${
              isFailed ? 'border-rose-500/20' : 'border-white/10'
            }`}
          >
            <button
              type="button"
              onClick={() => setExpandedFull(true)}
              className={`text-[10px] font-sans font-medium px-2 py-0.5 rounded transition-colors cursor-pointer ${
                isFailed
                  ? 'text-rose-300 hover:text-rose-200 hover:bg-rose-500/20'
                  : 'text-teal-400 hover:text-teal-300 hover:bg-teal-500/10'
              }`}
            >
              Show all {lines.length} lines ({lines.length - 20} more)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const StepCard: React.FC<{
  step: AgentStep;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onAbort?: () => void;
}> = ({ step, isExpanded, onToggleExpand, onAbort }) => {
  const isRunning = step.status === 'running';
  const isFailed = step.status === 'failed';
  const hasDetails = Boolean(step.output || step.error || isFailed);

  const getCategoryIcon = () => {
    switch (step.category) {
      case 'command':
        return <Terminal className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
      case 'file_read':
        return <FileCode className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
      case 'file_write':
        return <Edit3 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case 'search':
        return <Search className="w-3.5 h-3.5 text-teal-400 shrink-0" />;
      case 'browser':
        return <Globe className="w-3.5 h-3.5 text-indigo-400 shrink-0" />;
      default:
        return <Cpu className="w-3.5 h-3.5 text-violet-400 shrink-0" />;
    }
  };

  if (step.type === 'thought') {
    return (
      <div className="p-2.5 rounded-xl bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/20 text-xs text-cozy-text leading-relaxed font-sans">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-500 dark:text-indigo-400 mb-1 select-none">
          <Brain className="w-3 h-3" />
          <span>Reasoning</span>
        </div>
        <div className="italic text-cozy-muted text-xs whitespace-pre-wrap select-text">
          {typeof step.thought === 'string' ? step.thought : (typeof step.title === 'string' ? step.title : JSON.stringify(step.thought || step.title || ''))}
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => hasDetails && onToggleExpand()}
      className={`group rounded-xl border p-2.5 transition-all text-xs cv-auto-card ${
        isRunning
          ? 'border-teal-500/40 bg-teal-500/5 dark:bg-teal-950/20 shadow-glow-sm ring-1 ring-teal-500/30'
          : isFailed
          ? 'border-rose-500/30 bg-rose-500/5 hover:border-rose-500/50 cursor-pointer'
          : hasDetails
          ? 'border-cozy-border/70 bg-cozy-surface/60 hover:bg-cozy-surface hover:border-teal-400/30 cursor-pointer'
          : 'border-cozy-border/50 bg-cozy-surface/40'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="p-1 rounded-md bg-black/5 dark:bg-white/5 shrink-0">
          {getCategoryIcon()}
        </div>

        <span className="font-mono text-xs text-cozy-text truncate select-text flex-1">
          {typeof step.title === 'string' ? step.title : String(step.title || '')}
        </span>

        {/* Live Elapsed / Duration */}
        {isRunning ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="flex items-center gap-1 text-[11px] font-mono text-teal-500 font-semibold">
              <Loader2 className="w-3 h-3 animate-spin" />
              <LiveElapsedTimer startTime={step.startTime} />
            </span>
            {onAbort && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAbort();
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-rose-500 hover:text-white hover:bg-rose-500/80 border border-rose-500/30 transition-all cursor-pointer"
                title="Stop current execution"
              >
                <Square className="w-2.5 h-2.5 fill-current" />
                Stop
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 shrink-0">
            {step.duration !== undefined && (
              <span className="text-[10px] text-cozy-muted font-mono px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5">
                {step.duration}s
              </span>
            )}
            {isFailed ? (
              <span title="Step failed" className="flex items-center">
                <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              </span>
            ) : (
              <span title="Step completed" className="flex items-center">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              </span>
            )}
            {hasDetails && (
              <span className="text-cozy-muted group-hover:text-cozy-text ml-0.5">
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Output preview drawer */}
      {isExpanded && hasDetails && (
        <ErrorBoundary
          fallback={
            <div className="mt-2 p-3 rounded-xl border border-rose-500/30 bg-rose-500/5 text-rose-300 text-xs font-mono">
              Unable to render output preview.
            </div>
          }
        >
          <StepOutputDrawer output={step.output} error={step.error} status={step.status} />
        </ErrorBoundary>
      )}
    </div>
  );
};

const AgentActivityView: React.FC<{
  messageId?: string;
  steps: AgentStep[];
  activitySummary?: ActivitySummary;
  isStreaming?: boolean;
  onAbort?: () => void;
  onCopyAll: (text: string) => void;
  onStepsLoaded?: (steps: AgentStep[]) => void;
}> = ({ messageId, steps: propSteps, activitySummary, isStreaming, onAbort, onCopyAll, onStepsLoaded }) => {
  const [isManuallyToggled, setIsManuallyToggled] = useState<boolean | null>(null);
  const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(new Set());
  const [copiedAll, setCopiedAll] = useState(false);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [loadedSteps, setLoadedSteps] = useState<AgentStep[] | null>(null);
  const [isLoadingSteps, setIsLoadingSteps] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const steps = propSteps && propSteps.length > 0 ? propSteps : (loadedSteps || []);

  // Default open while streaming; auto-collapse when completed
  const isExpanded = isManuallyToggled !== null ? isManuallyToggled : Boolean(isStreaming);

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isAutoScrollEnabled = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  const isSmoothScrollingRef = useRef(false);

  const handleScroll = useCallback(() => {
    if (isSmoothScrollingRef.current) return;
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = containerRef.current;
      if (!el) return;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 40;
      const hasOverflow = el.scrollHeight > el.clientHeight;
      isAutoScrollEnabled.current = isNearBottom;
      setShowScrollBottomBtn(!isNearBottom && hasOverflow);
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    isSmoothScrollingRef.current = true;
    isAutoScrollEnabled.current = true;
    setShowScrollBottomBtn(false);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setTimeout(() => {
      isSmoothScrollingRef.current = false;
      if (containerRef.current) {
        const isNearBottom =
          containerRef.current.scrollHeight -
            containerRef.current.scrollTop -
            containerRef.current.clientHeight <=
          40;
        isAutoScrollEnabled.current = isNearBottom;
        const hasOverflow = containerRef.current.scrollHeight > containerRef.current.clientHeight;
        setShowScrollBottomBtn(!isNearBottom && hasOverflow);
      }
    }, 400);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  // When expanding or when streaming status changes, if streaming, initialize auto-scroll
  useEffect(() => {
    if (isStreaming && isExpanded) {
      isAutoScrollEnabled.current = true;
      setShowScrollBottomBtn(false);
    }
  }, [isStreaming, isExpanded]);

  // Auto-scroll to bottom as new content streams in
  useEffect(() => {
    if (!isExpanded || !isStreaming || !isAutoScrollEnabled.current) return;

    const raf = requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [steps, isStreaming, isExpanded]);

  // Observe content size changes to auto-scroll during streaming and sync scroll button state
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isExpanded) return;

    const observer = new ResizeObserver(() => {
      if (isStreaming && isAutoScrollEnabled.current) {
        el.scrollTop = el.scrollHeight;
      }
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 40;
      const hasOverflow = el.scrollHeight > el.clientHeight;
      setShowScrollBottomBtn(!isNearBottom && hasOverflow);
    });

    observer.observe(el);
    if (contentRef.current) {
      observer.observe(contentRef.current);
    }

    return () => observer.disconnect();
  }, [isExpanded, isStreaming]);

  const toggleStepExpand = useCallback((id: string) => {
    setExpandedStepIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const totalDuration = useMemo(() => {
    if (steps.length > 0) {
      return steps.reduce((sum, s) => sum + (s.duration || 0), 0);
    }
    return activitySummary?.totalDuration || 0;
  }, [steps, activitySummary]);

  const summary = useMemo(() => {
    const files =
      steps.length > 0
        ? steps.filter((s) => s.category === 'file_read' || s.category === 'file_write').length
        : activitySummary?.files || 0;
    const commands =
      steps.length > 0
        ? steps.filter((s) => s.category === 'command').length
        : activitySummary?.commands || 0;
    const count =
      steps.length > 0 ? steps.length : activitySummary?.totalSteps || 0;

    let label = '';
    let icon = <Sparkles className="w-3.5 h-3.5 text-teal-500 shrink-0" />;

    if (files > 0 && commands > 0) {
      label = `Inspected ${files} ${files === 1 ? 'file' : 'files'} & executed ${commands} ${commands === 1 ? 'command' : 'commands'}`;
    } else if (commands > 0) {
      label = `Executed ${commands} terminal ${commands === 1 ? 'command' : 'commands'}`;
      icon = <Terminal className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
    } else if (files > 0) {
      label = `Checked ${files} ${files === 1 ? 'file' : 'files'}`;
      icon = <FileCode className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
    } else {
      label = `Explored ${count} ${count === 1 ? 'action' : 'actions'}`;
    }

    return { label, count, icon };
  }, [steps, activitySummary]);

  const handleCopyActions = (e: React.MouseEvent) => {
    e.stopPropagation();
    const formatted = steps
      .map((s) => {
        let line = `[${s.status.toUpperCase()}] ${s.title}`;
        if (s.duration) line += ` (${s.duration}s)`;
        const outStr = normalizeStepOutput(s.output);
        const errStr = normalizeStepOutput(s.error);
        if (outStr) line += `\nOutput:\n${outStr}\n`;
        if (errStr && errStr !== outStr) line += `\nError:\n${errStr}\n`;
        return line;
      })
      .join('\n---\n');
    onCopyAll(formatted);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleToggleExpand = () => {
    const nextState = !isExpanded;
    setIsManuallyToggled(nextState);

    // If expanding, steps are not loaded yet, and we have a messageId:
    if (nextState && steps.length === 0 && messageId && !isLoadingSteps) {
      setIsLoadingSteps(true);
      setLoadError(null);
      getMessageActivity(messageId)
        .then((res) => {
          if (res && Array.isArray(res.steps)) {
            setLoadedSteps(res.steps);
            onStepsLoaded?.(res.steps);
          }
        })
        .catch((err) => {
          setLoadError(err.message || 'Failed to load command activity');
        })
        .finally(() => {
          setIsLoadingSteps(false);
        });
    }
  };

  const activeStep = useMemo(() => {
    return steps.find((s) => s.status === 'running');
  }, [steps]);

  return (
    <div className="mb-2 w-full min-w-0 flex flex-col items-start animate-in fade-in duration-150">
      {/* Summary Pill Button */}
      <button
        type="button"
        onClick={handleToggleExpand}
        className="inline-flex items-center gap-2 text-xs font-medium text-cozy-muted hover:text-cozy-text transition-colors py-1 px-2.5 rounded-lg bg-cozy-subtle hover:bg-cozy-subtle/80 border border-cozy-border cursor-pointer max-w-full shrink-0 select-none whitespace-nowrap"
      >
        {isStreaming && activeStep ? (
          <Loader2 className="w-3.5 h-3.5 text-teal-500 animate-spin shrink-0" />
        ) : (
          summary.icon
        )}
        <span className="text-cozy-text truncate">{summary.label}</span>
        {totalDuration > 0 && (
          <span className="text-cozy-muted font-mono text-[10px]">
            • {totalDuration.toFixed(1)}s
          </span>
        )}
        <span className="px-1.5 py-0.2 rounded-md bg-cozy-surface text-cozy-muted border border-cozy-border text-[10px] font-medium shrink-0">
          {summary.count} {summary.count === 1 ? 'step' : 'steps'}
        </span>
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 ml-auto text-cozy-muted shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 ml-auto text-cozy-muted shrink-0" />
        )}
      </button>

      {/* Expanded Interactive Activity Container */}
      {isExpanded && (
        <div className="relative mt-2 w-full">
          {isLoadingSteps ? (
            <div className="w-full p-3.5 rounded-xl bg-cozy-subtle/40 dark:bg-[#1f1f1f] border border-cozy-border flex flex-col gap-2.5 animate-pulse">
              <div className="flex items-center justify-between pb-2 border-b border-cozy-border/40 select-none">
                <div className="h-3 w-40 bg-cozy-muted/20 rounded" />
                <div className="h-3 w-16 bg-cozy-muted/20 rounded" />
              </div>
              <div className="space-y-2 py-1">
                <div className="h-8 bg-cozy-subtle rounded-lg w-full" />
                <div className="h-8 bg-cozy-subtle rounded-lg w-full" />
                <div className="h-8 bg-cozy-subtle rounded-lg w-full" />
              </div>
            </div>
          ) : loadError ? (
            <div className="w-full p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center justify-between">
              <span>{loadError}</span>
              <button
                type="button"
                onClick={handleToggleExpand}
                className="underline hover:text-rose-300 ml-2 cursor-pointer font-medium"
              >
                Retry
              </button>
            </div>
          ) : (
            <div
              ref={containerRef}
              onScroll={handleScroll}
              className="w-full p-3 rounded-xl bg-cozy-subtle/40 dark:bg-[#1f1f1f] border border-cozy-border flex flex-col gap-2 max-h-96 overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-2 border-b border-cozy-border/40 select-none">
                <span className="text-[11px] font-semibold text-cozy-muted uppercase tracking-wider">
                  Agent Activity Timeline ({summary.count} {summary.count === 1 ? 'step' : 'steps'})
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyActions}
                    className="flex items-center gap-1 text-[11px] text-cozy-muted hover:text-teal-500 transition-colors px-1.5 py-0.5 rounded cursor-pointer"
                    title="Copy all actions and outputs"
                  >
                    {copiedAll ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedAll ? 'Copied' : 'Copy log'}</span>
                  </button>
                </div>
              </div>

              <div ref={contentRef} className="flex flex-col gap-1.5">
                {steps.map((step) => (
                  <StepCard
                    key={step.id}
                    step={step}
                    isExpanded={expandedStepIds.has(step.id)}
                    onToggleExpand={() => toggleStepExpand(step.id)}
                    onAbort={onAbort}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Floating Scroll to Bottom Button */}
          {showScrollBottomBtn && !isLoadingSteps && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-3 right-4 p-1.5 rounded-full bg-cozy-surface/90 hover:bg-cozy-surface border border-cozy-border/80 shadow-soft-md hover:shadow-soft-lg text-cozy-muted hover:text-teal-500 backdrop-blur-sm transition-all duration-150 animate-in fade-in zoom-in-95 cursor-pointer z-10"
              title="Scroll to bottom"
              aria-label="Scroll to bottom"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export interface ChatMessageListHandle {
  scrollToBottom: () => void;
}

export interface ChatMessageListProps {
  messages: ChatMessage[];
  liveStreamingChunk?: string;
  isStreaming?: boolean;
  /** Show a spinner at the bottom while the latest messages are being fetched */
  isSyncing?: boolean;
  taskId?: string;
  sessionId?: string;
  clis?: CliInfo[];
  currentCli?: string;
  onRetryPrompt?: (userPrompt: string, failedMsgId: string) => void;
  onSwitchCliAndRetry?: (targetCli: string, userPrompt: string, failedMsgId: string) => void;
  onOpenSettings?: () => void;
  onAbort?: () => void;
  activeHitl?: AlphaHitlPayload | null;
  onHitlSubmitted?: () => void;
}

export const ChatMessageList = React.memo(
  forwardRef<ChatMessageListHandle, ChatMessageListProps>(({
    messages,
    liveStreamingChunk,
    isStreaming,
    isSyncing,
    taskId,
    sessionId,
    clis,
    currentCli,
    onRetryPrompt,
    onSwitchCliAndRetry,
    onOpenSettings,
    onAbort,
    activeHitl,
    onHitlSubmitted,
  }, ref) => {
    const [previewImage, setPreviewImage] = useState<FileAttachment | null>(null);
    const [previewFile, setPreviewFile] = useState<FileAttachment | null>(null);
    const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
    const listEndRef = useRef<HTMLDivElement>(null);
    const isFirstRender = useRef(true);
    const shouldScrollToBottomOnLoadRef = useRef(true);
    const prevTaskIdRef = useRef<string | undefined>(taskId);
    const prevSessionIdRef = useRef<string | undefined>(sessionId);

    const fallbackCopy = useCallback((text: string) => {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch {}
    }, []);

    const handleCopy = useCallback((text: string) => {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).catch(() => {
          fallbackCopy(text);
        });
      } else {
        fallbackCopy(text);
      }
    }, [fallbackCopy]);

    const handlePreviewImage = useCallback((att: FileAttachment) => {
      setPreviewImage(att);
    }, []);

    const handlePreviewFile = useCallback((att: FileAttachment) => {
      setPreviewFile(att);
    }, []);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const isAutoScrollEnabled = useRef(true);
    const scrollRafRef = useRef<number | null>(null);
    const scrollTimersRef = useRef<{ raf: number | null; t1: NodeJS.Timeout | null; t2: NodeJS.Timeout | null }>({
      raf: null,
      t1: null,
      t2: null,
    });

    const clearScrollTimers = useCallback(() => {
      if (scrollTimersRef.current.raf != null) {
        cancelAnimationFrame(scrollTimersRef.current.raf);
        scrollTimersRef.current.raf = null;
      }
      if (scrollTimersRef.current.t1 != null) {
        clearTimeout(scrollTimersRef.current.t1);
        scrollTimersRef.current.t1 = null;
      }
      if (scrollTimersRef.current.t2 != null) {
        clearTimeout(scrollTimersRef.current.t2);
        scrollTimersRef.current.t2 = null;
      }
    }, []);

    const updateScrollState = useCallback(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const hasOverflow = el.scrollHeight > el.clientHeight + 10;
      const isNearBottom = distanceFromBottom <= 60;
      isAutoScrollEnabled.current = isNearBottom;
      setShowScrollBottomBtn(!isNearBottom && hasOverflow);
    }, []);

    const handleScroll = useCallback(() => {
      if (scrollRafRef.current != null) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        updateScrollState();
      });
    }, [updateScrollState]);

    useEffect(() => {
      return () => {
        clearScrollTimers();
        if (scrollRafRef.current != null) {
          cancelAnimationFrame(scrollRafRef.current);
        }
      };
    }, [clearScrollTimers]);

    // O(N) pre-pass to map each message to its preceding user prompt
    const previousUserPrompts = useMemo(() => {
      let lastPrompt = '';
      return messages.map((m) => {
        const current = lastPrompt;
        if (m.role === 'user') {
          lastPrompt = typeof m.content === 'string' ? m.content : '';
        }
        return current;
      });
    }, [messages]);

    const rowVirtualizer = useVirtualizer({
      count: messages.length,
      getScrollElement: () => scrollContainerRef.current,
      estimateSize: () => 140,
      overscan: 5,
    });

    const scrollToBottomInstant = useCallback(() => {
      isAutoScrollEnabled.current = true;
      setShowScrollBottomBtn(false);

      const performScroll = () => {
        if (messages.length > 0) {
          rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior: 'auto' });
        }
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
      };

      clearScrollTimers();
      performScroll();

      scrollTimersRef.current.raf = requestAnimationFrame(() => {
        performScroll();
        scrollTimersRef.current.raf = null;
      });

      scrollTimersRef.current.t1 = setTimeout(() => {
        performScroll();
        scrollTimersRef.current.t1 = null;
      }, 50);

      scrollTimersRef.current.t2 = setTimeout(() => {
        performScroll();
        scrollTimersRef.current.t2 = null;
      }, 150);
    }, [clearScrollTimers, messages.length, rowVirtualizer]);

    useImperativeHandle(ref, () => ({
      scrollToBottom: scrollToBottomInstant,
    }), [scrollToBottomInstant]);

    // Observe content size changes to auto-scroll during streaming and sync scroll button state
    useEffect(() => {
      const el = scrollContainerRef.current;
      if (!el) return;

      const observer = new ResizeObserver(() => {
        if (isStreaming && isAutoScrollEnabled.current) {
          el.scrollTop = el.scrollHeight;
        }
        updateScrollState();
      });

      observer.observe(el);
      if (contentRef.current) {
        observer.observe(contentRef.current);
      }

      return () => observer.disconnect();
    }, [isStreaming, updateScrollState]);

    // Track last user message ID to trigger scroll when user sends a message
    const latestUserMessageId = useMemo(() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') return messages[i].id;
      }
      return null;
    }, [messages]);

    const prevLastUserMsgIdRef = useRef<string | null>(latestUserMessageId);

    // When switching tasks or sessions, arm the instant scroll to bottom on load
    useEffect(() => {
      if (taskId !== prevTaskIdRef.current || sessionId !== prevSessionIdRef.current) {
        prevTaskIdRef.current = taskId;
        prevSessionIdRef.current = sessionId;
        prevLastUserMsgIdRef.current = latestUserMessageId;
        shouldScrollToBottomOnLoadRef.current = true;
        isAutoScrollEnabled.current = true;
        setShowScrollBottomBtn(false);
        return;
      }

      // Scroll to bottom when user sends a new message
      if (latestUserMessageId && latestUserMessageId !== prevLastUserMsgIdRef.current) {
        prevLastUserMsgIdRef.current = latestUserMessageId;
        scrollToBottomInstant();
      }
    }, [latestUserMessageId, taskId, sessionId, scrollToBottomInstant]);

    useEffect(() => {
      if (messages.length === 0) return;

      if (shouldScrollToBottomOnLoadRef.current || isFirstRender.current) {
        shouldScrollToBottomOnLoadRef.current = false;
        isFirstRender.current = false;
        scrollToBottomInstant();
        return;
      }

      if (!isAutoScrollEnabled.current) return;

      if (isStreaming) {
        const raf = requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
          }
        });
        return () => cancelAnimationFrame(raf);
      } else {
        // Instant scroll to bottom when new messages arrive or turn finishes
        scrollToBottomInstant();
      }
    }, [messages, liveStreamingChunk, isStreaming, scrollToBottomInstant]);

    return (
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 overscroll-y-contain [transform:translateZ(0)]"
        >
          <div ref={contentRef} className="max-w-3xl lg:max-w-4xl mx-auto w-full px-4 sm:px-6 py-6">
            {messages.length === 0 && !isStreaming && (
              <div className="min-h-[45vh] flex flex-col items-center justify-center text-center p-8 text-cozy-muted">
                <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center mb-3">
                  <Sparkles className="w-5 h-5 text-teal-500" />
                </div>
                <h3 className="text-base font-semibold text-cozy-text mb-1">How can I help you today?</h3>
                <p className="text-xs max-w-sm text-cozy-muted leading-relaxed">
                  Ask the AI agent to explore your files, build new features, test code, or preview your application.
                </p>
              </div>
            )}

            {messages.length > 0 && (
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const index = virtualRow.index;
                  const msg = messages[index];
                  if (!msg) return null;
                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className="pb-6"
                    >
                      <MessageItem
                        msg={msg}
                        isStreaming={Boolean(isStreaming && index === messages.length - 1 && msg.role === 'assistant')}
                        onCopy={handleCopy}
                        onPreviewImage={handlePreviewImage}
                        onPreviewFile={handlePreviewFile}
                        clis={clis}
                        currentCli={currentCli}
                        previousUserPrompt={previousUserPrompts[index] || ''}
                        onRetryPrompt={onRetryPrompt}
                        onSwitchCliAndRetry={onSwitchCliAndRetry}
                        onOpenSettings={onOpenSettings}
                        onAbort={onAbort}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Human-in-the-loop input card */}
            {activeHitl && (
              <div className="flex items-start justify-start min-w-0 w-full animate-in fade-in duration-200 mt-4">
                <div className="w-full space-y-2 min-w-0 flex flex-col items-start">
                  <HumanInputCard hitl={activeHitl} onSubmitted={onHitlSubmitted} />
                </div>
              </div>
            )}

            {/* Fallback streaming thinking indicator if no assistant message exists yet */}
            {isStreaming && (messages.length === 0 || messages[messages.length - 1].role !== 'assistant') && (
              <div className="flex items-start justify-start min-w-0 w-full animate-in fade-in duration-200 mt-4">
                <div className="w-full py-2 text-sm text-cozy-text">
                  <span className="flex items-center gap-2 text-teal-600 dark:text-teal-400 font-medium text-xs animate-pulse">
                    <Sparkles className="w-3.5 h-3.5" />
                    Thinking and exploring codebase...
                  </span>
                </div>
              </div>
            )}

            {isSyncing && !isStreaming && (
              <div className="flex items-center justify-center py-2 text-cozy-muted" role="status" aria-label="Loading latest messages">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            )}

            <div ref={listEndRef} />
          </div>

          {/* Attachment Preview Modals */}
          <ImageLightboxModal
            attachment={previewImage}
            onClose={() => setPreviewImage(null)}
          />

          <FilePreviewModal
            taskId={taskId || ''}
            attachment={previewFile}
            onClose={() => setPreviewFile(null)}
          />
        </div>

        {/* Floating Scroll to Bottom Button */}
        {showScrollBottomBtn && (
          <button
            type="button"
            onClick={scrollToBottomInstant}
            className="absolute bottom-4 right-4 sm:right-6 w-9 h-9 rounded-full bg-cozy-surface/95 hover:bg-cozy-surface border border-cozy-border shadow-soft-lg hover:shadow-soft-xl text-cozy-muted hover:text-teal-600 dark:hover:text-teal-400 hover:border-teal-500/40 backdrop-blur-sm transition-all duration-150 animate-in fade-in zoom-in-95 cursor-pointer z-20 flex items-center justify-center group"
            title="Scroll to bottom"
            aria-label="Scroll to bottom"
          >
            <ArrowDown className="w-4 h-4 transition-transform group-hover:translate-y-0.5" />
          </button>
        )}
      </div>
    );
  })
);

ChatMessageList.displayName = 'ChatMessageList';

const MessageItem: React.FC<{
  msg: ChatMessage;
  isStreaming?: boolean;
  onCopy: (text: string) => void;
  onPreviewImage: (att: FileAttachment) => void;
  onPreviewFile: (att: FileAttachment) => void;
  clis?: CliInfo[];
  currentCli?: string;
  previousUserPrompt?: string;
  onRetryPrompt?: (userPrompt: string, failedMsgId: string) => void;
  onSwitchCliAndRetry?: (targetCli: string, userPrompt: string, failedMsgId: string) => void;
  onOpenSettings?: () => void;
  onAbort?: () => void;
}> = React.memo(({
  msg,
  isStreaming,
  onCopy,
  onPreviewImage,
  onPreviewFile,
  clis,
  currentCli,
  previousUserPrompt = '',
  onRetryPrompt,
  onSwitchCliAndRetry,
  onOpenSettings,
  onAbort,
}) => {
  const isUser = msg.role === 'user';
  const [showThoughts, setShowThoughts] = useState(false);
  const [expandedSkillName, setExpandedSkillName] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<'msg' | 'thought' | 'json' | 'export' | null>(null);

  const handleCopyText = useCallback((target: 'msg' | 'thought' | 'json' | 'export', text: string) => {
    onCopy(text);
    setCopiedTarget(target);
    setTimeout(() => {
      setCopiedTarget((prev) => (prev === target ? null : prev));
    }, 2000);
  }, [onCopy]);

  const spendCapInfo = useMemo(() => detectSpendCapInfo(msg, currentCli), [msg, currentCli]);
  const authInfo = useMemo(() => detectAuthRequiredInfo(msg, currentCli), [msg, currentCli]);

  const alternativeClis = useMemo(() => {
    const currentName = (authInfo.cliName || spendCapInfo.cliName || currentCli || '').toLowerCase();
    return (clis || []).filter((c) => c.available && c.name.toLowerCase() !== currentName);
  }, [clis, authInfo.cliName, spendCapInfo.cliName, currentCli]);

  // Parse attachments from msg.attachments or metadata
  const attachments: FileAttachment[] = useMemo(() => {
    if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
      return msg.attachments;
    }
    if (msg.metadata) {
      try {
        const parsed = JSON.parse(msg.metadata);
        if (parsed && Array.isArray(parsed.attachments)) {
          return parsed.attachments;
        }
      } catch {}
    }
    return [];
  }, [msg.attachments, msg.metadata]);

  const imageAttachments = useMemo(() => attachments.filter(isImageAttachment), [attachments]);
  const otherAttachments = useMemo(() => attachments.filter((att) => !isImageAttachment(att)), [attachments]);

  // Extract thoughts/actions vs clean response content and skills
  const { thoughts, cleanContent, detectedSkills } = useMemo(() => {
    let t: string | null = null;
    let c = '';
    const rawContent = typeof msg.content === 'string' ? msg.content : (msg.content ? String(msg.content) : '');

    const thoughtMatch = rawContent.match(/<thought>([\s\S]*?)<\/thought>/);
    if (thoughtMatch) {
      t = thoughtMatch[1].trim();
      c = rawContent.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
    } else if (!isUser) {
      const lines = rawContent.split('\n');
      const thoughtLines: string[] = [];
      const contentLines: string[] = [];
      let inThoughts = true;

      for (const line of lines) {
        const trimmed = line.trim();
        if (
          inThoughts &&
          (trimmed.startsWith('→') ||
            trimmed.startsWith('[') ||
            trimmed.startsWith('Run:') ||
            trimmed.startsWith('Search:'))
        ) {
          thoughtLines.push(line);
        } else {
          inThoughts = false;
          contentLines.push(line);
        }
      }

      if (thoughtLines.length > 0) {
        t = thoughtLines.join('\n').trim();
        c = contentLines.join('\n').trim();
      } else {
        c = msg.content.trim();
      }
    } else {
      c = msg.content.trim();
    }

    c = stripAnsi(c);
    if (t) t = stripAnsi(t);

    const skillsList: DetectedSkillChip[] = [];
    const seen = new Set<string>();

    const addSkill = (name: string, desc?: string, cont?: string) => {
      const lower = name.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        const fallback = KNOWN_SKILL_DETAILS[lower];
        skillsList.push({
          name,
          description: desc || fallback?.description,
          content: cont || fallback?.content,
        });
      }
    };

    // 1. From metadata if available
    if (msg.metadata) {
      try {
        const parsed = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata;
        if (parsed && Array.isArray(parsed.skills)) {
          for (const s of parsed.skills) {
            if (s && s.name) {
              addSkill(s.name, s.description, s.content);
            }
          }
        }
      } catch {}
    }

    // 2. From [Skill Instructions: /<name>]... blocks in c
    const blockRegex = /\[Skill Instructions:\s*\/([a-zA-Z0-9_\-]+)\]([\s\S]*?)\[End of Skill Instructions\]/g;
    let bm: RegExpExecArray | null;
    while ((bm = blockRegex.exec(c)) !== null) {
      addSkill(bm[1], undefined, bm[2].trim());
    }

    // 3. From [Skill: /<name> - <desc>] in c
    const shortRegex = /\[Skill:\s*\/([a-zA-Z0-9_\-]+)(?:\s*-\s*([^\]]+))?\]/g;
    let sm: RegExpExecArray | null;
    while ((sm = shortRegex.exec(c)) !== null) {
      addSkill(sm[1], sm[2]?.trim());
    }

    // Strip out expanded skill instruction blocks from displayed text content
    c = c.replace(/\[Skill Instructions:\s*\/[a-zA-Z0-9_\-]+\][\s\S]*?\[End of Skill Instructions\]/g, '').trim();
    c = c.replace(/\[Skill:\s*\/[a-zA-Z0-9_\-]+(?:\s*-[^\]]*)?\]/g, '').trim();

    // 4. If no skills found yet from metadata or instruction blocks, check for slash commands in content (e.g. /grill-me)
    if (skillsList.length === 0) {
      const textWithoutUrls = c.replace(/https?:\/\/[^\s]+/g, ' ');
      const slashRegex = /\/([a-zA-Z0-9_\-]+)/g;
      let m: RegExpExecArray | null;
      while ((m = slashRegex.exec(textWithoutUrls)) !== null) {
        const name = m[1].toLowerCase();
        if (KNOWN_SKILL_DETAILS[name]) {
          addSkill(name, KNOWN_SKILL_DETAILS[name].description, KNOWN_SKILL_DETAILS[name].content);
        }
      }
    }

    return { thoughts: t, cleanContent: c, detectedSkills: skillsList };
  }, [msg.content, msg.metadata, isUser]);

  // Derive structured steps: from msg.steps, metadata, or legacy thoughts
  const steps: AgentStep[] = useMemo(() => {
    if (msg.steps && msg.steps.length > 0) {
      return msg.steps;
    }
    if (msg.metadata) {
      try {
        const parsed = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata;
        if (parsed && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
          return parsed.steps;
        }
      } catch {}
    }
    if (thoughts) {
      return parseLegacyThoughtToSteps(thoughts);
    }
    return [];
  }, [msg.steps, msg.metadata, thoughts]);

  const activeStep = useMemo(() => {
    return steps.find((s) => s.status === 'running') || null;
  }, [steps]);

  // Fallback friendly message if assistant completed actions with no explicit closing text
  const displayContent =
    cleanContent ||
    (!isStreaming && !isUser && (steps.length > 0 || thoughts || msg.has_activity || msg.activity_summary)
      ? `Completed ${(msg.activity_summary?.totalSteps || steps.length) > 0 ? `${msg.activity_summary?.totalSteps || steps.length} ` : ''}workspace actions and finished tasks.`
      : '');

  // Text that should be copied when clicking copy
  const textToCopy = authInfo.isAuthRequired
    ? authInfo.message
    : spendCapInfo.isSpendCap
    ? spendCapInfo.message
    : displayContent || cleanContent || (thoughts ? thoughts : msg.content);

  // Generate structured JSON payload for entire assistant reply including thinking, tool calls, and message content
  const getReplyJsonObject = useCallback(() => {
    const thoughtSteps = steps.filter((s) => s.type === 'thought' || Boolean(s.thought));
    const thinkingText =
      thoughts ||
      (thoughtSteps.length > 0
        ? thoughtSteps.map((s) => s.thought || s.detail || s.title).filter(Boolean).join('\n\n')
        : null);

    const toolSteps = steps.filter((s) => s.type === 'tool');
    const toolCalls = toolSteps.map((s) => ({
      id: s.id,
      tool: s.toolName || 'tool',
      title: s.title,
      category: s.category,
      detail: s.detail || undefined,
      status: s.status,
      duration: s.duration,
      startTime: s.startTime,
      endTime: s.endTime,
      output: s.output ? normalizeStepOutput(s.output) : undefined,
      error: s.error ? normalizeStepOutput(s.error) : undefined,
    }));

    const messageText =
      displayContent ||
      cleanContent ||
      (typeof msg.content === 'string' ? msg.content : (msg.content ? String(msg.content) : ''));

    let parsedMetadata: any = null;
    if (msg.metadata) {
      try {
        parsedMetadata = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata;
      } catch {}
    }

    return {
      id: msg.id,
      session_id: msg.session_id,
      role: msg.role,
      timestamp: msg.timestamp,
      message: messageText,
      content: messageText,
      thinking: thinkingText,
      tool_calls: toolCalls,
      steps: steps.map((s) => ({
        id: s.id,
        type: s.type,
        toolName: s.toolName,
        category: s.category,
        title: s.title,
        detail: s.detail,
        status: s.status,
        duration: s.duration,
        startTime: s.startTime,
        endTime: s.endTime,
        thought: s.thought,
        output: s.output ? normalizeStepOutput(s.output) : undefined,
        error: s.error ? normalizeStepOutput(s.error) : undefined,
      })),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(detectedSkills.length > 0 ? { skills: detectedSkills } : {}),
      ...(parsedMetadata ? { metadata: parsedMetadata } : {}),
    };
  }, [msg, displayContent, cleanContent, thoughts, steps, attachments, detectedSkills]);

  const handleCopyJson = useCallback(() => {
    try {
      const data = getReplyJsonObject();
      const jsonStr = JSON.stringify(data, null, 2);
      onCopy(jsonStr);
      setCopiedTarget('json');
      setTimeout(() => {
        setCopiedTarget((prev) => (prev === 'json' ? null : prev));
      }, 2000);
    } catch (err) {
      console.error('Failed to copy JSON:', err);
    }
  }, [getReplyJsonObject, onCopy]);

  const handleExportJson = useCallback(() => {
    try {
      const data = getReplyJsonObject();
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date(msg.timestamp).toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.download = `agent-reply-${msg.id ? msg.id.slice(0, 8) : dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setCopiedTarget('export');
      setTimeout(() => {
        setCopiedTarget((prev) => (prev === 'export' ? null : prev));
      }, 2000);
    } catch (err) {
      console.error('Failed to export JSON:', err);
    }
  }, [getReplyJsonObject, msg.id, msg.timestamp]);

  return (
    <div
      className={`flex items-start min-w-0 w-full ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
    >
      {/* Bubble Content */}
      <div
        className={`space-y-1.5 min-w-0 flex flex-col ${
          isUser
            ? 'items-end max-w-[85%] sm:max-w-[75%]'
            : 'items-start w-full'
        }`}
      >
        {/* Agent Activity Timeline & Steps (Both streaming & completed) */}
        {!isUser && (steps.length > 0 || msg.has_activity || msg.activity_summary) && !spendCapInfo.isSpendCap && !authInfo.isAuthRequired && (
          <AgentActivityView
            messageId={msg.id}
            steps={steps}
            activitySummary={msg.activity_summary}
            isStreaming={isStreaming}
            onAbort={onAbort}
            onCopyAll={(text) => handleCopyText('thought', text)}
            onStepsLoaded={(loaded) => {
              msg.steps = loaded;
            }}
          />
        )}

        <div
          className={`group relative text-sm transition-colors duration-150 min-w-0 max-w-full select-text ${
            isUser
              ? 'bg-[#f4f4f4] dark:bg-[#2f2f2f] text-cozy-text rounded-3xl px-4 py-2.5 break-words [overflow-wrap:anywhere] font-normal'
              : authInfo.isAuthRequired || spendCapInfo.isSpendCap
              ? 'rounded-xl w-full border border-amber-500/35 bg-gradient-to-br from-amber-500/10 via-rose-500/5 to-amber-500/5 p-4 sm:p-5 text-cozy-text break-words [overflow-wrap:anywhere]'
              : 'w-full bg-transparent border-0 text-cozy-text px-0 py-1 break-words [overflow-wrap:anywhere]'
          }`}
        >
          {/* Active Skills Chips */}
          {detectedSkills.length > 0 && (
            <div className="mb-2 w-full">
              <div className="flex flex-wrap items-center gap-1.5">
                {detectedSkills.map((skill) => {
                  const isExpanded = expandedSkillName === skill.name;
                  const hasDetails = Boolean(skill.content || skill.description);
                  return (
                    <button
                      key={skill.name}
                      type="button"
                      onClick={() => {
                        if (hasDetails) {
                          setExpandedSkillName(isExpanded ? null : skill.name);
                        }
                      }}
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium transition-all shadow-soft-sm select-none ${
                        isExpanded
                          ? 'bg-teal-500/10 dark:bg-teal-500/20 text-teal-700 dark:text-teal-300 border border-teal-600/40 dark:border-teal-400/50'
                          : 'bg-cozy-surface hover:bg-cozy-subtle text-cozy-text border border-cozy-border hover:border-teal-600/40 dark:hover:border-teal-400/40'
                      } ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
                      title={hasDetails ? `Click to ${isExpanded ? 'collapse' : 'inspect'} /${skill.name} instructions` : `/${skill.name}`}
                    >
                      <Zap className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>/{skill.name}</span>
                      {hasDetails && (
                        isExpanded ? (
                          <ChevronDown className="w-3 h-3 ml-0.5 opacity-80 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3 h-3 ml-0.5 opacity-80 shrink-0" />
                        )
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Collapsible Expanded Skill Instructions Panel */}
              {expandedSkillName && (() => {
                const activeSkill = detectedSkills.find((s) => s.name === expandedSkillName);
                if (!activeSkill) return null;
                const instructionText = activeSkill.content || activeSkill.description || '';
                return (
                  <div
                    className={`mt-2 rounded-xl p-3 text-xs border shadow-soft-sm leading-relaxed animate-in fade-in duration-150 ${
                      isUser
                        ? 'bg-teal-900/80 border-white/20 text-teal-50 shadow-inner'
                        : 'bg-cozy-subtle/95 border-cozy-border/70 text-cozy-text'
                    }`}
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-current/15 mb-2">
                      <div className="flex items-center gap-1.5 font-semibold min-w-0">
                        <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="shrink-0">/{activeSkill.name}</span>
                        {activeSkill.description && (
                          <span className="font-normal opacity-80 text-[11px] truncate">
                            • {activeSkill.description}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <button
                          type="button"
                          onClick={() => handleCopyText('thought', instructionText)}
                          className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 opacity-80 hover:opacity-100 transition-opacity cursor-pointer"
                          title={copiedTarget === 'thought' ? 'Copied!' : 'Copy instructions'}
                        >
                          {copiedTarget === 'thought' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpandedSkillName(null)}
                          className="text-[11px] underline opacity-70 hover:opacity-100 cursor-pointer ml-1"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                    <div className="max-h-56 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed break-words [overflow-wrap:anywhere] pr-2">
                      {instructionText}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {isUser ? (
            <div className="whitespace-pre-wrap font-sans leading-relaxed break-words [overflow-wrap:anywhere] min-w-0 select-text">{displayContent}</div>
          ) : authInfo.isAuthRequired ? (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between gap-3 border-b border-amber-500/15 pb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center shrink-0 text-amber-500 shadow-soft-sm">
                    <KeyRound className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-cozy-text">{authInfo.title}</h4>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-400/25">
                        {authInfo.badge}
                      </span>
                    </div>
                    {(authInfo.cliName || authInfo.modelName) && (
                      <p className="text-[11px] text-cozy-muted font-mono mt-0.5 truncate">
                        {authInfo.cliName === 'agy' ? 'GOOGLE ANTIGRAVITY' : authInfo.cliName === 'claude' ? 'CLAUDE CODE' : authInfo.cliName === 'codex' ? 'OPENAI CODEX' : authInfo.cliName.toUpperCase()} {authInfo.modelName ? `• ${authInfo.modelName}` : ''}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Message Explanation */}
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-cozy-text leading-relaxed">
                  {authInfo.message}
                </p>
              </div>

              {/* Interactive Terminal Command Box */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#0b101b] border border-amber-500/20 shadow-soft-inner">
                  <div className="flex items-center gap-2 min-w-0 font-mono text-xs text-amber-300 overflow-x-auto select-all">
                    <Terminal className="w-3.5 h-3.5 text-amber-400 shrink-0 select-none" />
                    <span>{authInfo.loginCommand}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyText('msg', authInfo.loginCommand)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-cozy-muted hover:text-white transition-all text-xs font-medium cursor-pointer shrink-0"
                    title="Copy command"
                  >
                    {copiedTarget === 'msg' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400 text-[11px]">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span className="text-[11px]">Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-cozy-muted leading-relaxed">
                  {authInfo.loginGuideText}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="pt-1 flex flex-wrap items-center gap-2.5">
                {onRetryPrompt && (
                  <button
                    onClick={() => onRetryPrompt(previousUserPrompt, msg.id)}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-medium text-xs shadow-soft-sm transition-all hover:scale-[1.02] cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-amber-100 shrink-0" />
                    <span>Retry with {authInfo.cliName === 'claude' ? 'Claude' : authInfo.cliName === 'codex' ? 'Codex' : authInfo.cliName === 'agy' ? 'Antigravity' : authInfo.cliName}</span>
                  </button>
                )}

                {alternativeClis.map((alt) => {
                  const cliLabel = alt.name === 'agy' ? 'Google Antigravity' : alt.name === 'claude' ? 'Claude Code' : alt.name === 'codex' ? 'OpenAI Codex' : alt.name;
                  return (
                    <button
                      key={alt.name}
                      onClick={() => onSwitchCliAndRetry?.(alt.name, previousUserPrompt, msg.id)}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white font-medium text-xs shadow-soft-sm transition-all hover:scale-[1.02] cursor-pointer"
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                      <span>Switch to {cliLabel} & Continue</span>
                    </button>
                  );
                })}

                {onOpenSettings && (
                  <button
                    onClick={onOpenSettings}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cozy-surface/90 hover:bg-cozy-subtle border border-cozy-border/80 text-cozy-text text-xs font-medium transition-all shadow-soft-sm hover:border-amber-400/40 cursor-pointer"
                  >
                    <SettingsIcon className="w-3.5 h-3.5 text-cozy-muted shrink-0" />
                    <span>Configure CLIs in Settings</span>
                  </button>
                )}
              </div>
            </div>
          ) : spendCapInfo.isSpendCap ? (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between gap-3 border-b border-amber-500/15 pb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center shrink-0 text-amber-500 shadow-soft-sm">
                    <Coins className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-cozy-text">{spendCapInfo.title}</h4>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-400/25">
                        Spend Limit
                      </span>
                    </div>
                    {(spendCapInfo.cliName || spendCapInfo.modelName) && (
                      <p className="text-[11px] text-cozy-muted font-mono mt-0.5 truncate">
                        {spendCapInfo.cliName?.toUpperCase() || 'AGENT'} {spendCapInfo.modelName ? `• ${spendCapInfo.modelName}` : ''}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Message Explanation */}
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-cozy-text leading-relaxed">
                  {spendCapInfo.message}
                </p>
                <p className="text-[11px] text-cozy-muted leading-relaxed">
                  To continue working immediately without waiting for a workspace cap increase, switch to another ready CLI agent below:
                </p>
              </div>

              {/* Action Buttons */}
              <div className="pt-1 flex flex-wrap items-center gap-2.5">
                {alternativeClis.map((alt) => {
                  const cliLabel = alt.name === 'agy' ? 'Google Antigravity' : alt.name === 'claude' ? 'Claude Code' : alt.name === 'codex' ? 'OpenAI Codex' : alt.name;
                  return (
                    <button
                      key={alt.name}
                      onClick={() => onSwitchCliAndRetry?.(alt.name, previousUserPrompt, msg.id)}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white font-medium text-xs shadow-soft-sm transition-all hover:scale-[1.02] cursor-pointer"
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                      <span>Switch to {cliLabel} & Continue</span>
                    </button>
                  );
                })}

                {onOpenSettings && (
                  <button
                    onClick={onOpenSettings}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cozy-surface/90 hover:bg-cozy-subtle border border-cozy-border/80 text-cozy-text text-xs font-medium transition-all shadow-soft-sm hover:border-teal-400/40 cursor-pointer"
                  >
                    <SettingsIcon className="w-3.5 h-3.5 text-cozy-muted shrink-0" />
                    <span>Configure CLIs in Settings</span>
                  </button>
                )}
              </div>
            </div>
          ) : displayContent ? (
            <MarkdownView content={displayContent} isStreaming={isStreaming} className="text-cozy-text font-sans min-w-0 select-text" />
          ) : isStreaming ? (
            <div className="flex items-center justify-between gap-2 text-xs text-teal-600 dark:text-teal-400 font-medium py-1">
              <div className="flex items-center gap-2 min-w-0 animate-pulse">
                <Loader2 className="w-4 h-4 text-teal-500 animate-spin shrink-0" />
                <span className="truncate">
                  {activeStep
                    ? `Running: ${activeStep.title}`
                    : steps.length > 0
                    ? `Completed ${steps.length} actions, finalizing response...`
                    : 'Inspecting workspace and planning actions...'}
                </span>
              </div>
              {activeStep?.startTime && (
                <span className="font-mono text-[11px] text-teal-500/80 shrink-0">
                  <LiveElapsedTimer startTime={activeStep.startTime} />
                </span>
              )}
            </div>
          ) : null}

          {/* Running status indicator inside the active bubble */}
          {isStreaming && displayContent && (
            <div className="flex items-center gap-2 mt-3 pt-2 border-t border-cozy-border/30 text-xs text-teal-600/90 dark:text-teal-400/90 font-medium animate-pulse">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Generating response...</span>
            </div>
          )}

          {/* File & Image Attachments Preview */}
          {attachments.length > 0 && (
            <div className={`space-y-2.5 ${displayContent ? 'mt-3 pt-3 border-t ' + (isUser ? 'border-black/10 dark:border-white/15' : 'border-cozy-border/60') : ''}`}>
              {/* Image Previews */}
              {imageAttachments.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {imageAttachments.map((att) => (
                    <div
                      key={att.id || att.path}
                      onClick={() => onPreviewImage(att)}
                      className={`group/img relative overflow-hidden rounded-xl border cursor-pointer transition-all hover:scale-[1.02] shadow-soft-sm max-h-48 flex flex-col ${
                        isUser
                          ? 'border-black/10 dark:border-white/20 bg-white/60 dark:bg-black/25 hover:border-teal-400/60'
                          : 'border-cozy-border bg-cozy-subtle/70 hover:border-teal-400/50'
                      }`}
                      title={`Click to preview ${att.name}`}
                    >
                      <div className="w-full h-32 overflow-hidden bg-black/10 flex items-center justify-center">
                        <img
                          src={att.url}
                          alt={att.name}
                          className="w-full h-full object-cover transition-transform duration-200 group-hover/img:scale-105"
                          loading="lazy"
                        />
                      </div>
                      <div
                        className={`px-2.5 py-1.5 text-[11px] truncate flex items-center justify-between gap-1.5 ${
                          isUser ? 'bg-white/70 dark:bg-black/30 text-cozy-text' : 'bg-cozy-subtle/90 text-cozy-text'
                        }`}
                      >
                        <span className="truncate font-medium">{att.name}</span>
                        <span className="opacity-70 text-[10px] shrink-0 font-mono">
                          {formatFileSize(att.size)}
                        </span>
                      </div>
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="p-2 rounded-full bg-black/60 text-white shadow-md">
                          <ZoomIn className="w-4 h-4" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Code & Document File Cards */}
              {otherAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {otherAttachments.map((att) => {
                    const isCodeOrText = isCodeOrTextAttachment(att);
                    return (
                      <div
                        key={att.id || att.path}
                        onClick={() => {
                          if (isCodeOrText) {
                            onPreviewFile(att);
                          }
                        }}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all text-xs select-none ${
                          isCodeOrText ? 'cursor-pointer' : ''
                        } ${
                          isUser
                            ? 'bg-white hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15 border-black/10 dark:border-white/15 text-cozy-text shadow-soft-sm'
                            : 'bg-cozy-subtle/90 hover:bg-cozy-surface border-cozy-border/80 text-cozy-text shadow-soft-sm'
                        }`}
                        title={isCodeOrText ? `Preview ${att.name}` : att.name}
                      >
                        <div
                          className={`p-1.5 rounded-lg shrink-0 ${
                            isUser ? 'bg-black/5 dark:bg-white/10 text-teal-600 dark:text-teal-400' : 'bg-cozy-surface border border-cozy-border text-teal-500 shadow-soft-sm'
                          }`}
                        >
                          {getFileIcon(att, 'w-4 h-4')}
                        </div>
                        <div className="flex flex-col min-w-0 pr-1 text-left">
                          <span className="font-semibold truncate max-w-[140px] sm:max-w-[200px] leading-tight">
                            {att.name}
                          </span>
                          <span className={`text-[10px] font-mono leading-tight ${'text-cozy-muted'}`}>
                            {formatFileSize(att.size)}
                          </span>
                        </div>

                        <div className="ml-auto flex items-center gap-1 shrink-0">
                          {isCodeOrText ? (
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${
                                isUser
                                  ? 'bg-teal-500/10 text-teal-700 dark:text-teal-300 hover:bg-teal-500/20'
                                  : 'bg-teal-500/10 text-teal-600 dark:text-teal-400 hover:bg-teal-500/20'
                              }`}
                            >
                              <Eye className="w-3 h-3" />
                              Preview
                            </span>
                          ) : (
                            <a
                              href={`${att.url}?download=1`}
                              download={att.name}
                              onClick={(e) => e.stopPropagation()}
                              className={`p-1 rounded-lg transition-colors ${
                                'hover:bg-cozy-border/60 text-cozy-muted hover:text-cozy-text'
                              }`}
                              title="Download file"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Action Row for Assistant Message */}
          {!isUser && !isStreaming && (
            <div className="flex items-center gap-1.5 mt-2 text-cozy-muted opacity-80 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              {/* Copy message text button */}
              {textToCopy && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopyText('msg', textToCopy);
                  }}
                  className="p-1 rounded-md hover:bg-cozy-subtle hover:text-cozy-text transition-colors cursor-pointer"
                  title={copiedTarget === 'msg' ? 'Copied text!' : 'Copy message content'}
                >
                  {copiedTarget === 'msg' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              )}

              {/* Copy entire reply as JSON */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyJson();
                }}
                className="p-1 rounded-md hover:bg-cozy-subtle hover:text-cozy-text transition-colors cursor-pointer"
                title={copiedTarget === 'json' ? 'Copied JSON!' : 'Copy entire reply as JSON (with thinking & tool calls)'}
              >
                {copiedTarget === 'json' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Braces className="w-3.5 h-3.5" />
                )}
              </button>

              {/* Export entire reply as JSON file */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleExportJson();
                }}
                className="p-1 rounded-md hover:bg-cozy-subtle hover:text-cozy-text transition-colors cursor-pointer"
                title={copiedTarget === 'export' ? 'Exported JSON file!' : 'Export entire reply as JSON'}
              >
                {copiedTarget === 'export' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          )}

          {/* Copy Button (User Message) */}
          {isUser && textToCopy && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCopyText('msg', textToCopy);
              }}
              className="absolute top-2 right-2 p-1 rounded-md text-cozy-muted hover:text-cozy-text opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              title={copiedTarget === 'msg' ? 'Copied!' : 'Copy message'}
            >
              {copiedTarget === 'msg' ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>

        <div className="text-[10px] text-cozy-muted/50 px-1 font-medium">
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
});
