import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Bot, User, ChevronDown, ChevronRight, Copy, Check, Terminal, Cpu, Sparkles,
  FileCode, Play, ZoomIn, Download, Eye, AlertTriangle, Coins, Settings as SettingsIcon, Zap
} from 'lucide-react';
import { ChatMessage, FileAttachment, CliInfo } from '../types';
import { MarkdownView } from './MarkdownView';
import {
  isImageAttachment,
  isCodeOrTextAttachment,
  getFileIcon,
  formatFileSize,
  ImageLightboxModal,
  FilePreviewModal,
} from './AttachmentModals';

export function stripAnsi(text: string): string {
  if (!text) return '';
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

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

  if (msg.metadata) {
    try {
      const parsed = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata;
      if (parsed.cli) cliName = parsed.cli;
      if (parsed.model) modelName = parsed.model;
      if (parsed.errorType === 'spend_cap' || parsed.isSpendCap) {
        isSpendCap = true;
        if (parsed.errorMessage) customErrorMsg = parsed.errorMessage;
      }
    } catch {}
  }

  const rawClean = stripAnsi(msg.content || '');
  if (!isSpendCap) {
    if (
      /hit your spend cap|spend cap set by the owner|budget exceeded|exceeded your budget|out of credits|insufficient_quota|credit balance is too low|usage cap/i.test(
        rawClean
      )
    ) {
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

interface ChatMessageListProps {
  messages: ChatMessage[];
  liveStreamingChunk?: string;
  isStreaming?: boolean;
  taskId?: string;
  clis?: CliInfo[];
  currentCli?: string;
  onSwitchCliAndRetry?: (targetCli: string, userPrompt: string, failedMsgId: string) => void;
  onOpenSettings?: () => void;
}

export const ChatMessageList: React.FC<ChatMessageListProps> = React.memo(({
  messages,
  liveStreamingChunk,
  isStreaming,
  taskId,
  clis,
  currentCli,
  onSwitchCliAndRetry,
  onOpenSettings,
}) => {
  const [previewImage, setPreviewImage] = useState<FileAttachment | null>(null);
  const [previewFile, setPreviewFile] = useState<FileAttachment | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

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
  const isAutoScrollEnabled = useRef(true);
  const scrollRafRef = useRef<number | null>(null);

  const handleScroll = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollContainerRef.current;
      if (!el) return;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      isAutoScrollEnabled.current = isNearBottom;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    isFirstRender.current = true;
  }, [taskId]);

  useEffect(() => {
    if (!isAutoScrollEnabled.current && isStreaming) return;

    if (isStreaming) {
      const raf = requestAnimationFrame(() => {
        if (listEndRef.current) {
          listEndRef.current.scrollIntoView({ behavior: 'auto' });
        }
      });
      return () => cancelAnimationFrame(raf);
    } else {
      const behavior = isFirstRender.current ? 'auto' : 'smooth';
      isFirstRender.current = false;
      listEndRef.current?.scrollIntoView({ behavior });
    }
  }, [messages, liveStreamingChunk, isStreaming]);

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 md:p-7 space-y-6 min-w-0 overscroll-y-contain [transform:translateZ(0)]"
    >
      {messages.length === 0 && !isStreaming && (
        <div className="h-full flex flex-col items-center justify-center text-center p-8 text-cozy-muted">
          <div className="w-14 h-14 rounded-2.5xl bg-gradient-to-tr from-teal-500/15 via-cyan-500/10 to-sky-500/15 border border-teal-400/25 flex items-center justify-center mb-3.5 shadow-soft-sm">
            <Sparkles className="w-6 h-6 text-teal-500 fill-teal-400/20" />
          </div>
          <h3 className="text-base font-semibold text-cozy-text mb-1.5">Ready to collaborate</h3>
          <p className="text-xs max-w-sm text-cozy-muted leading-relaxed">
            Ask the AI agent to explore your files, build new features, run tests, or refine designs in this cozy workspace.
          </p>
        </div>
      )}

      {messages.map((msg, index) => (
        <MessageItem
          key={msg.id}
          msg={msg}
          isStreaming={Boolean(isStreaming && index === messages.length - 1 && msg.role === 'assistant')}
          onCopy={handleCopy}
          onPreviewImage={handlePreviewImage}
          onPreviewFile={handlePreviewFile}
          clis={clis}
          currentCli={currentCli}
          previousUserPrompt={index > 0 && messages[index - 1].role === 'user' ? messages[index - 1].content : ''}
          onSwitchCliAndRetry={onSwitchCliAndRetry}
          onOpenSettings={onOpenSettings}
        />
      ))}

      {/* Fallback streaming thinking indicator if no assistant message exists yet */}
      {isStreaming && (messages.length === 0 || messages[messages.length - 1].role !== 'assistant') && (
        <div className="flex items-start justify-end min-[920px]:justify-start min-[920px]:space-x-3 min-w-0 w-full animate-in fade-in duration-200">
          <div className="hidden min-[920px]:flex w-8 h-8 rounded-full bg-teal-500/10 border border-teal-400/30 items-center justify-center shrink-0 mt-0.5 shadow-soft-sm">
            <Bot className="w-4 h-4 text-teal-500 animate-pulse" />
          </div>
          <div className="w-full max-w-full min-[920px]:max-w-[92%] min-[920px]:flex-1 space-y-2 min-w-0 flex flex-col items-end min-[920px]:items-start">
            <div className="bg-cozy-surface/90 dark:bg-slate-900/90 border border-cozy-border/70 rounded-2xl rounded-tl-sm px-6 py-4 text-sm text-cozy-text shadow-soft-sm w-full">
              <span className="flex items-center gap-2 text-teal-600 dark:text-teal-400 font-medium text-xs animate-pulse">
                <Sparkles className="w-3.5 h-3.5" />
                Thinking and exploring codebase...
              </span>
            </div>
          </div>
        </div>
      )}

      <div ref={listEndRef} />

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
  );
});

const MessageItem: React.FC<{
  msg: ChatMessage;
  isStreaming?: boolean;
  onCopy: (text: string) => void;
  onPreviewImage: (att: FileAttachment) => void;
  onPreviewFile: (att: FileAttachment) => void;
  clis?: CliInfo[];
  currentCli?: string;
  previousUserPrompt?: string;
  onSwitchCliAndRetry?: (targetCli: string, userPrompt: string, failedMsgId: string) => void;
  onOpenSettings?: () => void;
}> = React.memo(({
  msg,
  isStreaming,
  onCopy,
  onPreviewImage,
  onPreviewFile,
  clis,
  currentCli,
  previousUserPrompt = '',
  onSwitchCliAndRetry,
  onOpenSettings,
}) => {
  const isUser = msg.role === 'user';
  const [showThoughts, setShowThoughts] = useState(false);
  const [expandedSkillName, setExpandedSkillName] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<'msg' | 'thought' | null>(null);

  const handleCopyText = useCallback((target: 'msg' | 'thought', text: string) => {
    onCopy(text);
    setCopiedTarget(target);
    setTimeout(() => {
      setCopiedTarget((prev) => (prev === target ? null : prev));
    }, 2000);
  }, [onCopy]);

  const spendCapInfo = useMemo(() => detectSpendCapInfo(msg, currentCli), [msg, currentCli]);

  const alternativeClis = useMemo(() => {
    const currentName = (spendCapInfo.cliName || currentCli || '').toLowerCase();
    return (clis || []).filter((c) => c.available && c.name.toLowerCase() !== currentName);
  }, [clis, spendCapInfo.cliName, currentCli]);

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

    const thoughtMatch = msg.content.match(/<thought>([\s\S]*?)<\/thought>/);
    if (thoughtMatch) {
      t = thoughtMatch[1].trim();
      c = msg.content.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
    } else if (!isUser) {
      const lines = msg.content.split('\n');
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

  // Friendly summary derivation
  const summaryBadge = useMemo(() => {
    if (!thoughts) return null;
    const filesCount = (thoughts.match(/view_file|edit_file|write_to_file|replace_file/gi) || []).length;
    const cmdCount = (thoughts.match(/run_command|exec/gi) || []).length;
    const actionCount = (thoughts.match(/→/g) || []).length || thoughts.split('\n').filter(Boolean).length;

    if (filesCount > 0 && cmdCount > 0) {
      return {
        label: `Inspected ${filesCount} ${filesCount === 1 ? 'file' : 'files'} & executed ${cmdCount} ${cmdCount === 1 ? 'command' : 'commands'}`,
        count: actionCount,
        icon: <Sparkles className="w-3.5 h-3.5 text-teal-500 shrink-0" />,
      };
    }
    if (filesCount > 0) {
      return {
        label: `Checked ${filesCount} ${filesCount === 1 ? 'file' : 'files'}`,
        count: actionCount,
        icon: <FileCode className="w-3.5 h-3.5 text-sky-400 shrink-0" />,
      };
    }
    if (cmdCount > 0) {
      return {
        label: `Executed ${cmdCount} terminal ${cmdCount === 1 ? 'command' : 'commands'}`,
        count: actionCount,
        icon: <Play className="w-3.5 h-3.5 text-amber-400 shrink-0" />,
      };
    }
    return {
      label: `Explored ${actionCount} ${actionCount === 1 ? 'action' : 'actions'}`,
      count: actionCount,
      icon: <Sparkles className="w-3.5 h-3.5 text-teal-500 shrink-0" />,
    };
  }, [thoughts]);

  // Text that should be copied when clicking copy
  const textToCopy = spendCapInfo.isSpendCap ? spendCapInfo.message : cleanContent || (thoughts ? thoughts : msg.content);

  // Fallback friendly message if assistant completed actions with no explicit closing text
  const displayContent =
    cleanContent ||
    (!isStreaming && !isUser && thoughts
      ? `Completed workspace steps and prepared updates.`
      : '');

  return (
    <div
      style={isStreaming ? undefined : { contentVisibility: 'auto', containIntrinsicSize: 'auto 120px' }}
      className={`flex items-start justify-end min-[920px]:justify-start min-w-0 w-full min-[920px]:space-x-3 ${
        isUser ? 'min-[920px]:flex-row-reverse min-[920px]:space-x-reverse' : ''
      }`}
    >
      {/* Avatar */}
      <div
        className={`hidden min-[920px]:flex w-8 h-8 rounded-full items-center justify-center shrink-0 mt-0.5 border shadow-soft-sm ${
          isUser
            ? 'bg-gradient-to-tr from-teal-500 to-cyan-600 border-teal-400/30 text-white shadow-glow-ocean'
            : spendCapInfo.isSpendCap
            ? 'bg-amber-500/10 border-amber-400/30 text-amber-500'
            : 'bg-cozy-surface border-teal-400/20 text-teal-500'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : spendCapInfo.isSpendCap ? <AlertTriangle className="w-4 h-4 text-amber-500" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Bubble Content */}
      <div
        className={`space-y-1.5 min-w-0 flex flex-col items-end max-w-full ${
          isUser
            ? 'min-[920px]:max-w-[78%] min-[920px]:items-end'
            : 'w-full min-[920px]:max-w-[92%] min-[920px]:items-start'
        }`}
      >
        {/* Friendly Natural Summary Pill for Thoughts & Actions */}
        {thoughts && summaryBadge && !spendCapInfo.isSpendCap && (
          <div className="mb-1 w-full min-w-0 flex flex-col items-end min-[920px]:items-start">
            <button
              type="button"
              onClick={() => setShowThoughts(!showThoughts)}
              className="inline-flex items-center gap-2 text-xs font-medium text-cozy-muted hover:text-cozy-text transition-all py-1 px-3 rounded-full bg-cozy-subtle/80 border border-cozy-border/70 hover:border-teal-400/40 shadow-soft-sm cursor-pointer max-w-full shrink-0 select-none whitespace-nowrap"
            >
              {summaryBadge.icon}
              <span className="text-cozy-text truncate">{summaryBadge.label}</span>
              <span className="px-2 py-0.2 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 text-[10px] font-semibold shrink-0">
                {summaryBadge.count} {summaryBadge.count === 1 ? 'step' : 'steps'}
              </span>
              {showThoughts ? (
                <ChevronDown className="w-3.5 h-3.5 ml-auto text-cozy-muted shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 ml-auto text-cozy-muted shrink-0" />
              )}
            </button>
            {showThoughts && (
              <div className="group/thought relative mt-2 w-full p-4 sm:p-5 rounded-2xl bg-cozy-surface/90 border border-cozy-border/70 text-xs font-mono text-cozy-muted whitespace-pre-wrap max-h-60 overflow-y-auto pr-10 shadow-soft-inner leading-relaxed break-words [overflow-wrap:anywhere] min-w-0 animate-in fade-in duration-150">
                {thoughts}
                <button
                  type="button"
                  onClick={() => handleCopyText('thought', thoughts!)}
                  className="absolute top-2.5 right-2.5 p-1 rounded-lg bg-cozy-subtle/90 hover:bg-cozy-surface text-cozy-muted opacity-0 group-hover/thought:opacity-100 transition-opacity hover:text-teal-500 shadow-soft-sm cursor-pointer"
                  title={copiedTarget === 'thought' ? 'Copied!' : 'Copy actions log'}
                >
                  {copiedTarget === 'thought' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        <div
          className={`group relative rounded-2xl text-sm shadow-soft-sm transition-colors duration-150 min-w-0 max-w-full ${
            isUser
              ? 'bg-teal-500 text-white rounded-tr-sm shadow-glow-ocean px-6 sm:px-7 py-3 sm:py-3.5 pr-11 sm:pr-12 break-words [overflow-wrap:anywhere] font-medium'
              : spendCapInfo.isSpendCap
              ? 'rounded-tl-sm w-full border border-amber-500/35 bg-gradient-to-br from-amber-500/10 via-rose-500/5 to-amber-500/5 p-5 sm:p-6 text-cozy-text shadow-soft-sm break-words [overflow-wrap:anywhere]'
              : 'bg-cozy-surface/95 dark:bg-[#111b2e]/95 border border-cozy-border/70 text-cozy-text rounded-tl-sm w-full px-6 sm:px-8 md:px-9 py-5 sm:py-6 pr-12 sm:pr-14 break-words [overflow-wrap:anywhere]'
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
                        isUser
                          ? isExpanded
                            ? 'bg-white/30 text-white border border-white/40 ring-1 ring-white/30'
                            : 'bg-white/15 hover:bg-white/25 text-white border border-white/25'
                          : isExpanded
                          ? 'bg-teal-500/20 text-teal-600 dark:text-teal-300 border border-teal-400/50'
                          : 'bg-cozy-subtle hover:bg-cozy-subtle/80 text-cozy-text border border-cozy-border/70 hover:border-teal-400/40'
                      } ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
                      title={hasDetails ? `Click to ${isExpanded ? 'collapse' : 'inspect'} /${skill.name} instructions` : `/${skill.name}`}
                    >
                      <Zap className={`w-3 h-3 ${isUser ? 'text-amber-300' : 'text-amber-500'} shrink-0`} />
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
            <div className="whitespace-pre-wrap font-sans leading-relaxed break-words [overflow-wrap:anywhere] min-w-0">{displayContent}</div>
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
            <MarkdownView content={displayContent} isStreaming={isStreaming} className="text-cozy-text font-sans min-w-0" />
          ) : isStreaming ? (
            <div className="flex items-center gap-2 text-xs text-teal-600 dark:text-teal-400 font-medium py-1 animate-pulse">
              <Cpu className="w-4 h-4 text-teal-500 shrink-0" />
              <span>
                {summaryBadge
                  ? `Executing actions... (${summaryBadge.count} completed)`
                  : 'Inspecting repository and planning actions...'}
              </span>
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
            <div className={`space-y-2.5 ${displayContent ? 'mt-3 pt-3 border-t ' + (isUser ? 'border-white/20' : 'border-cozy-border/60') : ''}`}>
              {/* Image Previews */}
              {imageAttachments.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {imageAttachments.map((att) => (
                    <div
                      key={att.id || att.path}
                      onClick={() => onPreviewImage(att)}
                      className={`group/img relative overflow-hidden rounded-xl border cursor-pointer transition-all hover:scale-[1.02] shadow-soft-sm max-h-48 flex flex-col ${
                        isUser
                          ? 'border-white/30 bg-black/25 hover:border-white/60'
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
                          isUser ? 'bg-black/30 text-white/95' : 'bg-cozy-subtle/90 text-cozy-text'
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
                            ? 'bg-white/15 hover:bg-white/25 border-white/25 text-white shadow-soft-sm'
                            : 'bg-cozy-subtle/90 hover:bg-cozy-surface border-cozy-border/80 text-cozy-text shadow-soft-sm'
                        }`}
                        title={isCodeOrText ? `Preview ${att.name}` : att.name}
                      >
                        <div
                          className={`p-1.5 rounded-lg shrink-0 ${
                            isUser ? 'bg-white/20 text-white' : 'bg-cozy-surface border border-cozy-border text-teal-500 shadow-soft-sm'
                          }`}
                        >
                          {getFileIcon(att, 'w-4 h-4')}
                        </div>
                        <div className="flex flex-col min-w-0 pr-1 text-left">
                          <span className="font-semibold truncate max-w-[140px] sm:max-w-[200px] leading-tight">
                            {att.name}
                          </span>
                          <span className={`text-[10px] font-mono leading-tight ${isUser ? 'text-white/75' : 'text-cozy-muted'}`}>
                            {formatFileSize(att.size)}
                          </span>
                        </div>

                        <div className="ml-auto flex items-center gap-1 shrink-0">
                          {isCodeOrText ? (
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${
                                isUser
                                  ? 'bg-white/20 text-white hover:bg-white/30'
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
                                isUser ? 'hover:bg-white/20 text-white' : 'hover:bg-cozy-border/60 text-cozy-muted hover:text-cozy-text'
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

          {/* Copy Button (Both User & Assistant) */}
          {textToCopy && (
            <button
              onClick={() => handleCopyText('msg', textToCopy)}
              className={`absolute top-3.5 right-3.5 p-1.5 rounded-xl transition-all opacity-0 group-hover:opacity-100 ${
                isUser
                  ? 'bg-teal-600/80 hover:bg-teal-700 text-teal-100 hover:text-white'
                  : 'bg-cozy-subtle/80 hover:bg-cozy-surface text-cozy-muted hover:text-teal-500 shadow-soft-sm'
              }`}
              title={copiedTarget === 'msg' ? 'Copied!' : isUser ? 'Copy message' : 'Copy response'}
            >
              {copiedTarget === 'msg' ? (
                <Check className={`w-3.5 h-3.5 ${isUser ? 'text-emerald-300' : 'text-emerald-400'}`} />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>

        <div
          className={`text-[10px] text-cozy-muted/60 px-1 font-medium text-right min-[920px]:${
            isUser ? 'text-right' : 'text-left'
          }`}
        >
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
});
