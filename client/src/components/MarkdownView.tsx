import React, { useState } from 'react';
import { Copy, Check, Terminal } from 'lucide-react';

interface MarkdownViewProps {
  content: string;
  className?: string;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({ content, className = '' }) => {
  if (!content) return null;

  // Split into code blocks and normal text blocks
  const parts: React.ReactNode[] = [];
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)(?:```|$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Text before code block
    if (match.index > lastIndex) {
      const textChunk = content.substring(lastIndex, match.index);
      parts.push(
        <TextSection key={`text-${lastIndex}`} text={textChunk} />
      );
    }

    const language = match[1] || 'text';
    const code = match[2];
    const isUnclosed = !match[0].endsWith('```') && match.index + match[0].length === content.length;

    parts.push(
      <CodeBlockItem
        key={`code-${match.index}`}
        language={language}
        code={code}
        isStreaming={isUnclosed}
      />
    );

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last code block
  if (lastIndex < content.length) {
    const textChunk = content.substring(lastIndex);
    parts.push(
      <TextSection key={`text-${lastIndex}`} text={textChunk} />
    );
  }

  return <div className={`space-y-3 leading-relaxed break-words [overflow-wrap:anywhere] min-w-0 ${className}`}>{parts}</div>;
};

const TextSection: React.FC<{ text: string }> = ({ text }) => {
  const paragraphs = text.split(/\n\n+/);

  return (
    <>
      {paragraphs.map((p, idx) => {
        const trimmed = p.trim();
        if (!trimmed) return null;

        // Header check
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={idx} className="font-semibold text-sm text-cozy-text mt-3 mb-1 break-words [overflow-wrap:anywhere]">
              {renderInlineMarkdown(trimmed.slice(4))}
            </h4>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={idx} className="font-bold text-base text-cozy-text mt-4 mb-1.5 border-b border-cozy-border/40 pb-1 break-words [overflow-wrap:anywhere]">
              {renderInlineMarkdown(trimmed.slice(3))}
            </h3>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h2 key={idx} className="font-bold text-lg text-cozy-text mt-4 mb-2 border-b border-cozy-border/50 pb-1 break-words [overflow-wrap:anywhere]">
              {renderInlineMarkdown(trimmed.slice(2))}
            </h2>
          );
        }

        // List item check
        const lines = p.split('\n');
        const isList = lines.every((line) => {
          const l = line.trim();
          return !l || l.startsWith('- ') || l.startsWith('* ') || /^\d+\.\s/.test(l);
        });

        if (isList && lines.length > 0) {
          return (
            <ul key={idx} className="space-y-1.5 my-2 pl-4 list-disc text-sm marker:text-sky-400/80 break-words [overflow-wrap:anywhere]">
              {lines.map((line, lIdx) => {
                const l = line.trim();
                if (!l) return null;
                const cleanItem = l.replace(/^[-*]\s+|\d+\.\s+/, '');
                return (
                  <li key={lIdx} className="break-words [overflow-wrap:anywhere]">
                    {renderInlineMarkdown(cleanItem)}
                  </li>
                );
              })}
            </ul>
          );
        }

        return (
          <p key={idx} className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {renderInlineMarkdown(p)}
          </p>
        );
      })}
    </>
  );
};

const CodeBlockItem: React.FC<{
  language: string;
  code: string;
  isStreaming?: boolean;
}> = ({ language, code, isStreaming }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    try {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="my-2 rounded-xl border border-cozy-border/80 bg-cozy-bg/95 overflow-hidden shadow-sm font-mono text-xs max-w-full">
      <div className="flex items-center justify-between px-3 py-1.5 bg-cozy-subtle/70 border-b border-cozy-border/60 text-[11px] text-cozy-muted">
        <span className="flex items-center gap-1.5 font-medium">
          <Terminal className="w-3.5 h-3.5 text-sky-400" />
          {language || 'code'}
          {isStreaming && <span className="text-[10px] text-sky-400 animate-pulse">●</span>}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-cozy-text px-1.5 py-0.5 rounded transition-colors"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="p-3 overflow-x-auto text-cozy-text leading-relaxed whitespace-pre font-mono">
        {code}
      </div>
    </div>
  );
};

// Render inline elements: `inline code`, **bold**, *italic*, [links](url)
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Tokenize regex for links, inline code, bold, italic.
  // Note: match links first so that [`code`](url) or [text](url) are parsed correctly as links.
  const inlineRegex = /(\[[^\]]+\]\([^)]+\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.substring(lastIdx, match.index));
    }

    const token = match[0];
    if (token.startsWith('[') && token.includes('](')) {
      // Link
      const linkMatch = token.match(/^\[([\s\S]+?)\]\(([\s\S]+?)\)$/);
      if (linkMatch) {
        const linkLabel = linkMatch[1];
        const isCodeLabel = linkLabel.startsWith('`') && linkLabel.endsWith('`');
        const displayLabel = isCodeLabel ? linkLabel.slice(1, -1) : linkLabel;

        parts.push(
          <a
            key={`link-${match.index}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 hover:text-sky-300 underline underline-offset-2 mx-0.5 transition-colors break-words [overflow-wrap:anywhere]"
          >
            {isCodeLabel ? (
              <code className="px-1.5 py-0.5 rounded bg-cozy-subtle/80 text-sky-300 border border-sky-500/20 font-mono text-[12px] break-words [overflow-wrap:anywhere]">
                {displayLabel}
              </code>
            ) : (
              displayLabel
            )}
          </a>
        );
      } else {
        parts.push(token);
      }
    } else if (token.startsWith('`') && token.endsWith('`')) {
      // Inline code
      parts.push(
        <code
          key={`code-${match.index}`}
          className="px-1.5 py-0.5 rounded bg-cozy-subtle/80 text-sky-300 border border-sky-500/20 font-mono text-[12px] mx-0.5 break-words [overflow-wrap:anywhere]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      // Bold
      parts.push(
        <strong key={`bold-${match.index}`} className="font-semibold text-cozy-text break-words [overflow-wrap:anywhere]">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      // Italic
      parts.push(
        <em key={`italic-${match.index}`} className="italic break-words [overflow-wrap:anywhere]">
          {token.slice(1, -1)}
        </em>
      );
    } else {
      parts.push(token);
    }

    lastIdx = match.index + token.length;
  }

  if (lastIdx < text.length) {
    parts.push(text.substring(lastIdx));
  }

  return parts;
}
