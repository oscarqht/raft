import React, { useState } from 'react';
import { Bot, User, ChevronDown, ChevronRight, Copy, Check, Terminal, Cpu } from 'lucide-react';
import { ChatMessage } from '../types';

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

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
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

      {messages.map((msg) => (
        <MessageItem key={msg.id} msg={msg} copiedId={copiedId} onCopy={handleCopy} />
      ))}

      {/* Live streaming message */}
      {isStreaming && (
        <div className="flex items-start space-x-3">
          <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0 mt-0.5">
            <Bot className="w-4 h-4 text-sky-400 animate-pulse" />
          </div>
          <div className="flex-1 space-y-2 max-w-[90%]">
            <div className="bg-cozy-subtle border border-cozy-border/80 rounded-2xl px-4 py-3 text-sm text-cozy-text shadow-sm">
              <div className="whitespace-pre-wrap font-sans leading-relaxed break-words">
                {liveStreamingChunk || (
                  <span className="flex items-center gap-2 text-cozy-muted text-xs animate-pulse">
                    <Cpu className="w-3.5 h-3.5 text-sky-400" />
                    Thinking and inspecting code...
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MessageItem: React.FC<{
  msg: ChatMessage;
  copiedId: string | null;
  onCopy: (id: string, text: string) => void;
}> = ({ msg, copiedId, onCopy }) => {
  const isUser = msg.role === 'user';
  const [showThoughts, setShowThoughts] = useState(false);

  // Check if content has thought blocks
  const thoughtMatch = msg.content.match(/<thought>([\s\S]*?)<\/thought>/);
  const cleanContent = msg.content.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
  const thoughts = thoughtMatch ? thoughtMatch[1].trim() : null;

  return (
    <div className={`flex items-start space-x-3 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}>
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
      <div className={`space-y-1.5 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Collapsible Thoughts if present */}
        {thoughts && (
          <div className="mb-1">
            <button
              onClick={() => setShowThoughts(!showThoughts)}
              className="flex items-center gap-1.5 text-xs text-amber-400/80 hover:text-amber-300 transition-colors py-0.5 px-2 rounded bg-amber-500/10 border border-amber-500/20"
            >
              {showThoughts ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span>Agent Reasoning</span>
            </button>
            {showThoughts && (
              <div className="mt-1 p-2.5 rounded-lg bg-cozy-bg border border-cozy-border/60 text-xs font-mono text-cozy-muted whitespace-pre-wrap max-h-48 overflow-y-auto">
                {thoughts}
              </div>
            )}
          </div>
        )}

        <div
          className={`group relative rounded-2xl px-4 py-2.5 text-sm shadow-sm transition-all ${
            isUser
              ? 'bg-sky-600 text-white rounded-tr-none'
              : 'bg-cozy-surface border border-cozy-border text-cozy-text rounded-tl-none'
          }`}
        >
          <div className="whitespace-pre-wrap font-sans leading-relaxed break-words">
            {cleanContent || msg.content}
          </div>

          {/* Copy Button */}
          {!isUser && (
            <button
              onClick={() => onCopy(msg.id, cleanContent || msg.content)}
              className="absolute top-2 right-2 p-1 rounded bg-cozy-subtle/80 text-cozy-muted opacity-0 group-hover:opacity-100 transition-opacity hover:text-cozy-text"
              title="Copy response"
            >
              {copiedId === msg.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
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
