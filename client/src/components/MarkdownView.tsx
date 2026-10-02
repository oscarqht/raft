import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import {
  Copy,
  Check,
  Terminal,
  ExternalLink,
  Workflow,
  Code2,
  Maximize2,
  X,
  Loader2,
  AlertCircle,
  Eye,
} from 'lucide-react';

interface MarkdownViewProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

// Shared singleton hook to track whether dark mode is currently active
let isDarkShared = typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false;
const darkListeners = new Set<() => void>();

if (typeof document !== 'undefined') {
  const observer = new MutationObserver(() => {
    const next = document.documentElement.classList.contains('dark');
    if (next !== isDarkShared) {
      isDarkShared = next;
      darkListeners.forEach((l) => l());
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

function useIsDarkMode() {
  const [isDark, setIsDark] = useState(isDarkShared);

  useEffect(() => {
    const listener = () => setIsDark(isDarkShared);
    darkListeners.add(listener);
    return () => {
      darkListeners.delete(listener);
    };
  }, []);

  return isDark;
}

// Global SVG cache for rendered Mermaid diagrams: avoids re-parsing/re-rendering on remount
const mermaidSvgCache = new Map<string, string>();
let lastInitializedTheme: 'dark' | 'light' | null = null;
let mermaidModuleInstance: any = null;
let mermaidModulePromise: Promise<any> | null = null;

async function getMermaidInstance() {
  if (mermaidModuleInstance) return mermaidModuleInstance;
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then((m) => {
      mermaidModuleInstance = m.default || m;
      return mermaidModuleInstance;
    });
  }
  return mermaidModulePromise;
}

async function ensureMermaidInitialized(isDark: boolean) {
  const m = await getMermaidInstance();
  const currentTheme = isDark ? 'dark' : 'light';
  if (lastInitializedTheme === currentTheme) return m;
  lastInitializedTheme = currentTheme;

  m.initialize({
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    securityLevel: 'loose',
    fontFamily: 'Outfit, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
    themeVariables: isDark
      ? {
          darkMode: true,
          background: 'transparent',
          primaryColor: '#0d9488',
          primaryTextColor: '#f1f5f9',
          primaryBorderColor: '#14b8a6',
          lineColor: '#5eead4',
          secondaryColor: '#1e293b',
          tertiaryColor: '#0f172a',
        }
      : {
          darkMode: false,
          background: 'transparent',
          primaryColor: '#ccfbf1',
          primaryTextColor: '#0f172a',
          primaryBorderColor: '#0d9488',
          lineColor: '#0d9488',
          secondaryColor: '#f1f5f9',
          tertiaryColor: '#ffffff',
        },
  });
  return m;
}

/**
 * Offscreen DOM sandbox for Mermaid rendering.
 * Passing this container element to mermaid.render prevents Mermaid from appending
 * unstyled SVG elements directly into document.body, eliminating full-page reflows and flickering.
 */
function getMermaidSandbox(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  let sandbox = document.getElementById('mermaid-render-sandbox');
  if (!sandbox) {
    sandbox = document.createElement('div');
    sandbox.id = 'mermaid-render-sandbox';
    sandbox.style.position = 'fixed';
    sandbox.style.top = '-9999px';
    sandbox.style.left = '-9999px';
    sandbox.style.width = '1200px';
    sandbox.style.height = '800px';
    sandbox.style.opacity = '0';
    sandbox.style.pointerEvents = 'none';
    sandbox.style.zIndex = '-9999';
    sandbox.style.overflow = 'hidden';
    document.body.appendChild(sandbox);
  }
  return sandbox;
}

export const CodeBlockItem: React.FC<{
  language: string;
  code: string;
  isStreaming?: boolean;
}> = React.memo(({ language, code, isStreaming }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    try {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="my-2.5 rounded-2xl border border-cozy-border/80 bg-cozy-bg/95 overflow-hidden shadow-soft-sm font-mono text-xs max-w-full cv-auto-code">
      <div className="flex items-center justify-between px-3.5 py-2 bg-cozy-subtle/70 border-b border-cozy-border/60 text-[11px] text-cozy-muted">
        <span className="flex items-center gap-1.5 font-medium">
          <Terminal className="w-3.5 h-3.5 text-teal-500" />
          {language || 'code'}
          {isStreaming && <span className="text-[10px] text-teal-500 animate-pulse">●</span>}
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
      <div className="p-3 overflow-x-auto text-cozy-text leading-relaxed whitespace-pre font-mono select-text text-xs">
        {code}
      </div>
    </div>
  );
});

export const MermaidBlock: React.FC<{
  code: string;
  isStreaming?: boolean;
}> = React.memo(({ code, isStreaming = false }) => {
  const isDark = useIsDarkMode();
  const cleanCode = code.trim();
  const cacheKey = `${isDark ? 'dark' : 'light'}::${cleanCode}`;
  const initialSvg = cleanCode ? mermaidSvgCache.get(cacheKey) || '' : '';

  const [svg, setSvg] = useState<string>(initialSvg);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'diagram' | 'code'>('diagram');
  const [copied, setCopied] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [isRendering, setIsRendering] = useState<boolean>(!initialSvg && Boolean(cleanCode));

  const renderSeqRef = useRef(0);

  const handleCopy = () => {
    try {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  useEffect(() => {
    if (!showModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  useEffect(() => {
    const clean = code.trim();
    if (!clean) {
      setSvg('');
      setError(null);
      setIsRendering(false);
      return;
    }

    const currentKey = `${isDark ? 'dark' : 'light'}::${clean}`;
    if (mermaidSvgCache.has(currentKey)) {
      setSvg(mermaidSvgCache.get(currentKey)!);
      setError(null);
      setIsRendering(false);
      return;
    }

    // Debounce rendering while streaming tokens to prevent thrashing and layout bouncing
    const debounceMs = isStreaming ? 350 : 0;
    const currentSeq = ++renderSeqRef.current;

    const timer = setTimeout(async () => {
      const renderId = `mermaid-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`;
      const sandbox = getMermaidSandbox();

      try {
        setIsRendering(true);
        const m = await ensureMermaidInitialized(isDark);
        const { svg: renderedSvg } = await m.render(renderId, clean, sandbox || undefined);
        if (renderSeqRef.current === currentSeq) {
          mermaidSvgCache.set(currentKey, renderedSvg);
          setSvg(renderedSvg);
          setError(null);
          setIsRendering(false);
        }
      } catch (err: any) {
        const stray = document.getElementById(renderId) || document.getElementById(`d${renderId}`);
        if (stray) stray.remove();

        if (renderSeqRef.current === currentSeq) {
          // While streaming, syntax is naturally incomplete; do not flash error alerts
          if (!isStreaming) {
            setError(err?.message || 'Invalid diagram syntax');
          }
          setIsRendering(false);
        }
      }
    }, debounceMs);

    return () => {
      clearTimeout(timer);
    };
  }, [code, isDark, isStreaming]);

  return (
    <>
      <div className="my-3 rounded-2xl border border-cozy-border/80 bg-cozy-bg/95 overflow-hidden shadow-soft-sm max-w-full">
        {/* Mermaid Toolbar */}
        <div className="flex items-center justify-between px-3.5 py-2 bg-cozy-subtle/70 border-b border-cozy-border/60 text-[11px] text-cozy-muted">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 font-medium text-cozy-text">
              <Workflow className="w-3.5 h-3.5 text-teal-500" />
              Mermaid Diagram
            </span>
            {isStreaming && (
              <span className="flex items-center gap-1 text-[10px] text-teal-600 dark:text-teal-400 font-medium animate-pulse">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                Live
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* View Mode Toggle */}
            <div className="flex items-center rounded-lg bg-cozy-surface/80 p-0.5 border border-cozy-border/60 mr-1.5">
              <button
                type="button"
                onClick={() => setMode('diagram')}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                  mode === 'diagram'
                    ? 'bg-teal-500/15 text-teal-600 dark:text-teal-400 shadow-soft-sm'
                    : 'text-cozy-muted hover:text-cozy-text'
                }`}
                title="View rendered diagram"
              >
                <Eye className="w-3 h-3" />
                <span>Diagram</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('code')}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                  mode === 'code'
                    ? 'bg-teal-500/15 text-teal-600 dark:text-teal-400 shadow-soft-sm'
                    : 'text-cozy-muted hover:text-cozy-text'
                }`}
                title="View Mermaid DSL source code"
              >
                <Code2 className="w-3 h-3" />
                <span>Code</span>
              </button>
            </div>

            {/* Expand / Lightbox Button */}
            {mode === 'diagram' && svg && !error && (
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="p-1 hover:text-cozy-text text-cozy-muted rounded transition-colors"
                title="Expand diagram"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Copy Button */}
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 hover:text-cozy-text px-1.5 py-0.5 rounded transition-colors"
              title="Copy Mermaid code"
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
        </div>

        {/* Content Area */}
        {mode === 'diagram' ? (
          <div>
            {error && !isStreaming ? (
              <div className="p-3 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-600 dark:text-amber-400 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Could not render diagram (syntax incomplete or unsupported)
                </span>
                <button
                  type="button"
                  onClick={() => setMode('code')}
                  className="text-[11px] underline font-medium hover:text-amber-700 dark:hover:text-amber-300"
                >
                  View Code
                </button>
              </div>
            ) : null}

            {svg ? (
              <div
                className="p-4 overflow-x-auto flex items-center justify-center min-h-[120px] bg-cozy-surface/60 [&>svg]:max-w-full [&>svg]:h-auto transition-opacity duration-150"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ) : error && !isStreaming ? (
              <div className="p-3 overflow-x-auto text-cozy-text leading-relaxed whitespace-pre font-mono text-xs">
                {code}
              </div>
            ) : (
              <div className="p-6 flex flex-col items-center justify-center gap-2 text-xs text-teal-600 dark:text-teal-400 bg-cozy-subtle/30 min-h-[120px]">
                <div className="flex items-center gap-2 animate-pulse">
                  <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
                  <span>{isStreaming ? 'Streaming diagram...' : 'Rendering diagram...'}</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-3 overflow-x-auto text-cozy-text leading-relaxed whitespace-pre font-mono text-xs">
            {code}
          </div>
        )}
      </div>

      {/* Lightbox / Expanded Diagram Modal */}
      {showModal && svg && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Mermaid Diagram Preview"
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-6 animate-in fade-in duration-150"
              onClick={() => setShowModal(false)}
            >
              <div
                className="relative w-full max-w-5xl max-h-[88vh] bg-cozy-surface border border-cozy-border rounded-squircle shadow-soft-xl flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-cozy-border/70 bg-cozy-subtle/80">
                  <div className="flex items-center gap-2">
                    <Workflow className="w-4 h-4 text-teal-500" />
                    <span className="text-sm font-semibold text-cozy-text">Mermaid Diagram Preview</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-cozy-border/70 bg-cozy-surface hover:bg-cozy-subtle text-cozy-muted hover:text-cozy-text transition-colors"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copied' : 'Copy DSL'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowModal(false)}
                      className="p-1 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors"
                      title="Close preview (Esc)"
                      aria-label="Close diagram preview"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                <div
                  className="p-6 overflow-auto flex-1 flex [&>svg]:m-auto [&>svg]:max-w-none [&>svg]:w-auto [&>svg]:h-auto"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
});

// Static markdown elements kept outside MarkdownView to preserve component references
const STATIC_MARKDOWN_COMPONENTS: Partial<Components> = {
  // Inline Code
  code: ({ children }) => {
    return (
      <code className="px-1.5 py-0.5 rounded bg-cozy-subtle/80 text-teal-600 dark:text-teal-300 border border-teal-500/20 font-mono text-[13px] break-words [overflow-wrap:anywhere] mx-0.5">
        {children}
      </code>
    );
  },

  // Links
  a: ({ href, children, ...props }) => {
    const isExternal = href?.startsWith('http://') || href?.startsWith('https://');
    return (
      <a
        href={href}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        className="inline-flex items-center gap-0.5 text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 underline underline-offset-2 font-medium transition-colors break-words [overflow-wrap:anywhere] mx-0.5"
        {...props}
      >
        <span>{children}</span>
        {isExternal && <ExternalLink className="w-3 h-3 inline-block shrink-0 opacity-70" />}
      </a>
    );
  },

  // Paragraphs
  p: ({ children, ...props }) => (
    <p className="my-1.5 text-sm leading-relaxed break-words [overflow-wrap:anywhere]" {...props}>
      {children}
    </p>
  ),

  // Headings
  h1: ({ children, ...props }) => (
    <h1 className="font-bold text-lg sm:text-xl text-cozy-text mt-4 mb-2 pb-1.5 border-b border-cozy-border/60 break-words [overflow-wrap:anywhere]" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="font-bold text-base sm:text-lg text-cozy-text mt-3.5 mb-2 pb-1 border-b border-cozy-border/40 break-words [overflow-wrap:anywhere]" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="font-semibold text-sm sm:text-base text-cozy-text mt-3 mb-1.5 break-words [overflow-wrap:anywhere]" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 className="font-semibold text-xs sm:text-sm text-cozy-text mt-2.5 mb-1 break-words [overflow-wrap:anywhere]" {...props}>
      {children}
    </h4>
  ),
  h5: ({ children, ...props }) => (
    <h5 className="font-semibold text-xs text-cozy-muted uppercase tracking-wider mt-2 mb-1 break-words [overflow-wrap:anywhere]" {...props}>
      {children}
    </h5>
  ),
  h6: ({ children, ...props }) => (
    <h6 className="font-semibold text-xs text-cozy-muted uppercase tracking-wider mt-2 mb-1 break-words [overflow-wrap:anywhere]" {...props}>
      {children}
    </h6>
  ),

  // Lists
  ul: ({ children, ...props }) => (
    <ul className="my-2 ml-4 list-disc space-y-1 text-sm marker:text-teal-500 break-words [overflow-wrap:anywhere]" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="my-2 ml-4 list-decimal space-y-1 text-sm marker:text-teal-500 font-medium break-words [overflow-wrap:anywhere]" {...props}>
      {children}
    </ol>
  ),
  li: ({ className = '', children, ...props }) => {
    const isTask = className.includes('task-list-item');
    return (
      <li
        className={`${isTask ? 'list-none -ml-4 flex items-start gap-2' : ''} break-words [overflow-wrap:anywhere] leading-relaxed text-sm`}
        {...props}
      >
        {children}
      </li>
    );
  },
  input: ({ type, checked, ...props }) => {
    if (type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={checked}
          readOnly
          className="mt-1 h-3.5 w-3.5 rounded border-cozy-border/80 text-teal-500 focus:ring-0 focus:ring-offset-0 cursor-default shrink-0"
        />
      );
    }
    return <input type={type} {...props} />;
  },

  // Tables
  table: ({ children, ...props }) => (
    <div className="my-3 overflow-x-auto rounded-xl border border-cozy-border/80 bg-cozy-surface/50 shadow-soft-sm max-w-full">
      <table className="min-w-full divide-y divide-cozy-border/60 text-xs text-left" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="bg-cozy-subtle/80 text-cozy-text font-semibold uppercase tracking-wider text-[11px]" {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }) => (
    <tbody className="divide-y divide-cozy-border/40 text-cozy-text" {...props}>
      {children}
    </tbody>
  ),
  tr: ({ children, ...props }) => (
    <tr className="hover:bg-cozy-subtle/50 transition-colors" {...props}>
      {children}
    </tr>
  ),
  th: ({ children, style, ...props }) => (
    <th
      style={style}
      className="px-3.5 py-2.5 font-semibold text-cozy-text border-b border-cozy-border/60 whitespace-nowrap"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, style, ...props }) => (
    <td
      style={style}
      className="px-3.5 py-2 text-cozy-text border-t border-cozy-border/20 whitespace-normal break-words"
      {...props}
    >
      {children}
    </td>
  ),

  // Blockquote
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="my-2.5 border-l-4 border-teal-500/60 pl-3.5 py-1 text-cozy-muted bg-teal-500/5 rounded-r-xl italic break-words [overflow-wrap:anywhere]"
      {...props}
    >
      {children}
    </blockquote>
  ),

  // Horizontal rule
  hr: () => <hr className="my-3.5 border-cozy-border/60" />,

  // Strikethrough & styling
  del: ({ children, ...props }) => (
    <del className="line-through text-cozy-muted opacity-80" {...props}>
      {children}
    </del>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-cozy-text break-words [overflow-wrap:anywhere]" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic break-words [overflow-wrap:anywhere]" {...props}>
      {children}
    </em>
  ),
};

export const MarkdownView: React.FC<MarkdownViewProps> = React.memo(({
  content,
  isStreaming = false,
  className = '',
}) => {
  const components = useMemo<Components>(() => ({
    ...STATIC_MARKDOWN_COMPONENTS,
    pre: ({ children }: any) => {
      const codeChild = React.isValidElement(children) ? children : null;
      const childProps = (codeChild?.props as any) || {};
      const childClass = childProps.className || '';
      const rawCode = String(childProps.children || '').replace(/\n$/, '');
      const match = /language-(\w+)/.exec(childClass);
      const language = match ? match[1].toLowerCase() : '';

      if (language === 'mermaid') {
        return <MermaidBlock code={rawCode} isStreaming={isStreaming} />;
      }

      return (
        <CodeBlockItem
          language={language}
          code={rawCode}
          isStreaming={isStreaming}
        />
      );
    },
  }), [isStreaming]);

  if (!content) return null;

  return (
    <div className={`space-y-2.5 leading-relaxed break-words [overflow-wrap:anywhere] min-w-0 select-text ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
