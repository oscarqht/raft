import React, { useState, useRef, useEffect } from 'react';
import { Bot, User, ChevronDown, ChevronRight, Copy, Check, Terminal, Cpu } from 'lucide-react';
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
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4 min-w-0">
      {messages.length === 0 && !isStreaming && (
        <div className="h-full flex flex-col items-center justify-center text-center p-6 text-cozy-muted">
          <div className="w-12 h-12 rounded-2xl bg-cozy-subtle border border-cozy-border flex items-center justify-center mb-3">
            <Bot className="w-6 h-6 text-sky-400" />
          </div>
          <h3 className="text-sm font-medium text-cozy-text mb-1">Ready to code</h3>
          <p className="text-xs max-w-sm">
            Ask the AI agent to inspect files, implement features, run tests, or refactor code in this isolated worktree.
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
        <div className="flex items-start space-x-3 min-w-0 w-full">
          <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0 mt-0.5">
            <Bot className="w-4 h-4 text-sky-400 animate-pulse" />
          </div>
          <div className="flex-1 space-y-2 max-w-[90%] min-w-0">
            <div className="bg-cozy-subtle border border-cozy-border/80 rounded-2xl px-4 py-3 text-sm text-cozy-text shadow-sm break-words [overflow-wrap:anywhere]">
              <span className="flex items-center gap-2 text-cozy-muted text-xs animate-pulse">
                <Cpu className="w-3.5 h-3.5 text-sky-400" />
                Thinking and inspecting code...
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
    // Check for raw lines starting with '→' or '[run_command]' / '[view_file]'
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

  const actionsCount = thoughts
    ? (thoughts.match(/→/g) || []).length || thoughts.split('\n').filter(Boolean).length
    : 0;

  // Text that should be copied when clicking copy
  const textToCopy = cleanContent || (thoughts ? thoughts : msg.content);
  const isCopied = copiedId === msg.id;

  // Fallback friendly message if assistant completed actions with no explicit closing text
  const displayContent =
    cleanContent ||
    (!isStreaming && !isUser && thoughts
      ? `Completed ${actionsCount > 0 ? `${actionsCount} ` : ''}workspace actions and finished tasks.`
      : '');

  return (
    <div className={`flex items-start space-x-3 min-w-0 w-full ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border ${
          isUser
            ? 'bg-sky-600/20 border-sky-500/30 text-sky-300'
            : 'bg-cozy-subtle border-cozy-border text-cozy-muted'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-sky-400" />}
      </div>

      {/* Bubble Content */}
      <div className={`space-y-1.5 max-w-[92%] sm:max-w-[85%] min-w-0 flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Collapsible Actions & Reasoning if present */}
        {thoughts && (
          <div className="mb-1 w-full min-w-0">
            <button
              onClick={() => setShowThoughts(!showThoughts)}
              className="flex items-center gap-2 text-xs text-cozy-muted hover:text-cozy-text transition-colors py-1 px-2.5 rounded-lg bg-cozy-subtle/80 border border-cozy-border/70 hover:border-cozy-border cursor-pointer max-w-full"
            >
              <Terminal className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="font-medium text-cozy-text truncate">Agent Actions & Reasoning</span>
              {actionsCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-sky-500/10 text-sky-400 text-[10px] font-mono border border-sky-500/20 shrink-0">
                  {actionsCount} {actionsCount === 1 ? 'step' : 'steps'}
                </span>
              )}
              {showThoughts ? (
                <ChevronDown className="w-3.5 h-3.5 ml-auto text-cozy-muted shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 ml-auto text-cozy-muted shrink-0" />
              )}
            </button>
            {showThoughts && (
              <div className="group/thought relative mt-1.5 p-3 rounded-xl bg-cozy-bg/95 border border-cozy-border/70 text-xs font-mono text-cozy-muted whitespace-pre-wrap max-h-56 overflow-y-auto pr-9 shadow-inner leading-relaxed break-words [overflow-wrap:anywhere] min-w-0">
                {thoughts}
                <button
                  onClick={() => onCopy(`${msg.id}-thought`, thoughts)}
                  className="absolute top-2 right-2 p-1 rounded bg-cozy-subtle/90 hover:bg-cozy-border text-cozy-muted opacity-0 group-hover/thought:opacity-100 transition-opacity hover:text-cozy-text"
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
          className={`group relative rounded-2xl px-4 py-3 text-sm shadow-sm transition-all pr-9 min-w-0 ${
            isUser
              ? 'bg-sky-600 text-white rounded-tr-none break-words [overflow-wrap:anywhere]'
              : 'bg-cozy-surface border border-cozy-border text-cozy-text rounded-tl-none w-full break-words [overflow-wrap:anywhere]'
          }`}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap font-sans leading-relaxed break-words [overflow-wrap:anywhere] min-w-0">{displayContent}</div>
          ) : displayContent ? (
            <MarkdownView content={displayContent} className="text-cozy-text font-sans min-w-0" />
          ) : isStreaming ? (
            <div className="flex items-center gap-2 text-xs text-sky-400 font-mono py-1 animate-pulse">
              <Cpu className="w-4 h-4 text-sky-400 shrink-0" />
              <span>
                {actionsCount > 0
                  ? `Executing actions... (${actionsCount} completed)`
                  : 'Inspecting repository and planning actions...'}
              </span>
            </div>
          ) : null}

          {/* Running status indicator inside the active bubble */}
          {isStreaming && displayContent && (
            <div className="flex items-center gap-2 mt-3 pt-2 border-t border-cozy-border/30 text-xs text-sky-400/90 font-mono animate-pulse">
              <Cpu className="w-3.5 h-3.5" />
              <span>Running...</span>
            </div>
          )}

          {/* Copy Button (Both User & Assistant) */}
          {textToCopy && (
            <button
              onClick={() => onCopy(msg.id, textToCopy)}
              className={`absolute top-2 right-2 p-1 rounded transition-all opacity-0 group-hover:opacity-100 ${
                isUser
                  ? 'bg-sky-700/80 hover:bg-sky-800 text-sky-100 hover:text-white'
                  : 'bg-cozy-subtle/80 hover:bg-cozy-border text-cozy-muted hover:text-cozy-text'
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

        <div className={`text-[10px] text-cozy-muted/60 px-1 ${isUser ? 'text-right' : 'text-left'}`}>
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
};
