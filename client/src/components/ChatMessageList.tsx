import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Bot, User, ChevronDown, ChevronRight, Copy, Check, Terminal, Cpu, Sparkles, FileCode, Play } from 'lucide-react';
import { ChatMessage } from '../types';
import { MarkdownView } from './MarkdownView';

interface ChatMessageListProps {
  messages: ChatMessage[];
  liveStreamingChunk?: string;
  isStreaming?: boolean;
}

export const ChatMessageList: React.FC<ChatMessageListProps> = ({
  messages,
  liveStreamingChunk,
  isStreaming,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  const handleCopy = (id: string, text: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const fallbackCopy = (text: string) => {
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
  };

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveStreamingChunk, isStreaming]);

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 md:p-7 space-y-6 min-w-0">
      {messages.length === 0 && !isStreaming && (
        <div className="h-full flex flex-col items-center justify-center text-center p-8 text-cozy-muted">
          <div className="w-14 h-14 rounded-2.5xl bg-gradient-to-tr from-rose-500/15 via-amber-500/10 to-sky-500/15 border border-rose-400/25 flex items-center justify-center mb-3.5 shadow-soft-sm">
            <Sparkles className="w-6 h-6 text-rose-400 fill-rose-400/20" />
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
          copiedId={copiedId}
          onCopy={handleCopy}
        />
      ))}

      {/* Fallback streaming thinking indicator if no assistant message exists yet */}
      {isStreaming && (messages.length === 0 || messages[messages.length - 1].role !== 'assistant') && (
        <div className="flex items-start space-x-3 min-w-0 w-full animate-in fade-in duration-200">
          <div className="w-8 h-8 rounded-full bg-rose-500/10 border border-rose-400/30 flex items-center justify-center shrink-0 mt-0.5 shadow-soft-sm">
            <Bot className="w-4 h-4 text-rose-400 animate-pulse" />
          </div>
          <div className="flex-1 space-y-2 max-w-[90%] min-w-0">
            <div className="glass-card border border-cozy-border/70 rounded-2xl rounded-tl-sm px-6 py-4 text-sm text-cozy-text shadow-soft-sm">
              <span className="flex items-center gap-2 text-rose-400 font-medium text-xs animate-pulse">
                <Sparkles className="w-3.5 h-3.5" />
                Thinking and exploring codebase...
              </span>
            </div>
          </div>
        </div>
      )}

      <div ref={listEndRef} />
    </div>
  );
};

const MessageItem: React.FC<{
  msg: ChatMessage;
  isStreaming?: boolean;
  copiedId: string | null;
  onCopy: (id: string, text: string) => void;
}> = ({ msg, isStreaming, copiedId, onCopy }) => {
  const isUser = msg.role === 'user';
  const [showThoughts, setShowThoughts] = useState(false);

  // Extract thoughts/actions vs clean response content
  let thoughts: string | null = null;
  let cleanContent = '';

  const thoughtMatch = msg.content.match(/<thought>([\s\S]*?)<\/thought>/);
  if (thoughtMatch) {
    thoughts = thoughtMatch[1].trim();
    cleanContent = msg.content.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
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
      thoughts = thoughtLines.join('\n').trim();
      cleanContent = contentLines.join('\n').trim();
    } else {
      cleanContent = msg.content.trim();
    }
  } else {
    cleanContent = msg.content.trim();
  }

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
        icon: <Sparkles className="w-3.5 h-3.5 text-rose-400" />,
      };
    }
    if (filesCount > 0) {
      return {
        label: `Checked ${filesCount} ${filesCount === 1 ? 'file' : 'files'}`,
        count: actionCount,
        icon: <FileCode className="w-3.5 h-3.5 text-sky-400" />,
      };
    }
    if (cmdCount > 0) {
      return {
        label: `Executed ${cmdCount} terminal ${cmdCount === 1 ? 'command' : 'commands'}`,
        count: actionCount,
        icon: <Play className="w-3.5 h-3.5 text-amber-400" />,
      };
    }
    return {
      label: `Explored ${actionCount} ${actionCount === 1 ? 'action' : 'actions'}`,
      count: actionCount,
      icon: <Sparkles className="w-3.5 h-3.5 text-rose-400" />,
    };
  }, [thoughts]);

  // Text that should be copied when clicking copy
  const textToCopy = cleanContent || (thoughts ? thoughts : msg.content);
  const isCopied = copiedId === msg.id;

  // Fallback friendly message if assistant completed actions with no explicit closing text
  const displayContent =
    cleanContent ||
    (!isStreaming && !isUser && thoughts
      ? `Completed workspace steps and prepared updates.`
      : '');

  return (
    <div className={`flex items-start space-x-3 min-w-0 w-full ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 border shadow-soft-sm ${
          isUser
            ? 'bg-gradient-to-tr from-rose-500 to-amber-500 border-rose-400/30 text-white shadow-glow-peach'
            : 'bg-cozy-surface border-rose-400/20 text-rose-400'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Bubble Content */}
      <div className={`space-y-1.5 ${isUser ? 'max-w-[85%] sm:max-w-[78%] items-end' : 'w-full max-w-[96%] sm:max-w-[92%] items-start'} min-w-0 flex flex-col`}>
        {/* Friendly Natural Summary Pill for Thoughts & Actions */}
        {thoughts && summaryBadge && (
          <div className="mb-1 w-full min-w-0">
            <button
              onClick={() => setShowThoughts(!showThoughts)}
              className="flex items-center gap-2 text-xs font-medium text-cozy-muted hover:text-cozy-text transition-all py-1 px-3 rounded-full bg-cozy-subtle/80 border border-cozy-border/70 hover:border-rose-400/40 shadow-soft-sm cursor-pointer max-w-full"
            >
              {summaryBadge.icon}
              <span className="text-cozy-text truncate">{summaryBadge.label}</span>
              <span className="px-2 py-0.2 rounded-full bg-rose-500/10 text-rose-500 text-[10px] font-semibold shrink-0">
                {summaryBadge.count} {summaryBadge.count === 1 ? 'step' : 'steps'}
              </span>
              {showThoughts ? (
                <ChevronDown className="w-3.5 h-3.5 ml-auto text-cozy-muted shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 ml-auto text-cozy-muted shrink-0" />
              )}
            </button>
            {showThoughts && (
              <div className="group/thought relative mt-2 p-4 sm:p-5 rounded-2xl bg-cozy-surface/90 border border-cozy-border/70 text-xs font-mono text-cozy-muted whitespace-pre-wrap max-h-60 overflow-y-auto pr-10 shadow-soft-inner leading-relaxed break-words [overflow-wrap:anywhere] min-w-0 animate-in fade-in duration-150">
                {thoughts}
                <button
                  onClick={() => onCopy(`${msg.id}-thought`, thoughts!)}
                  className="absolute top-2.5 right-2.5 p-1 rounded-lg bg-cozy-subtle/90 hover:bg-cozy-surface text-cozy-muted opacity-0 group-hover/thought:opacity-100 transition-opacity hover:text-rose-400 shadow-soft-sm"
                  title={copiedId === `${msg.id}-thought` ? 'Copied!' : 'Copy actions log'}
                >
                  {copiedId === `${msg.id}-thought` ? (
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
          className={`group relative rounded-2xl text-sm shadow-soft-sm transition-all min-w-0 ${
            isUser
              ? 'bg-rose-500 text-white rounded-tr-sm shadow-glow-peach px-6 sm:px-7 py-3 sm:py-3.5 pr-11 sm:pr-12 break-words [overflow-wrap:anywhere] font-medium'
              : 'glass-card border border-cozy-border/70 text-cozy-text rounded-tl-sm w-full px-6 sm:px-8 md:px-9 py-5 sm:py-6 pr-12 sm:pr-14 break-words [overflow-wrap:anywhere]'
          }`}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap font-sans leading-relaxed break-words [overflow-wrap:anywhere] min-w-0">{displayContent}</div>
          ) : displayContent ? (
            <MarkdownView content={displayContent} className="text-cozy-text font-sans min-w-0" />
          ) : isStreaming ? (
            <div className="flex items-center gap-2 text-xs text-rose-400 font-medium py-1 animate-pulse">
              <Cpu className="w-4 h-4 text-rose-400 shrink-0" />
              <span>
                {summaryBadge
                  ? `Executing actions... (${summaryBadge.count} completed)`
                  : 'Inspecting repository and planning actions...'}
              </span>
            </div>
          ) : null}

          {/* Running status indicator inside the active bubble */}
          {isStreaming && displayContent && (
            <div className="flex items-center gap-2 mt-3 pt-2 border-t border-cozy-border/30 text-xs text-rose-400/90 font-medium animate-pulse">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Generating response...</span>
            </div>
          )}

          {/* Copy Button (Both User & Assistant) */}
          {textToCopy && (
            <button
              onClick={() => onCopy(msg.id, textToCopy)}
              className={`absolute top-3.5 right-3.5 p-1.5 rounded-xl transition-all opacity-0 group-hover:opacity-100 ${
                isUser
                  ? 'bg-rose-600/80 hover:bg-rose-700 text-rose-100 hover:text-white'
                  : 'bg-cozy-subtle/80 hover:bg-cozy-surface text-cozy-muted hover:text-rose-400 shadow-soft-sm'
              }`}
              title={isCopied ? 'Copied!' : isUser ? 'Copy message' : 'Copy response'}
            >
              {isCopied ? (
                <Check className={`w-3.5 h-3.5 ${isUser ? 'text-emerald-300' : 'text-emerald-400'}`} />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>

        <div className={`text-[10px] text-cozy-muted/60 px-1 font-medium ${isUser ? 'text-right' : 'text-left'}`}>
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
};
