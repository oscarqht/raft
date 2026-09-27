import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Download,
  Copy,
  Check,
  Eye,
  FileCode,
  FileText,
  FileArchive,
  File,
  ZoomIn,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { FileAttachment } from '../types';
import { getAttachmentContent } from '../api';

export function isImageAttachment(att: FileAttachment): boolean {
  if (att.type && att.type.startsWith('image/')) return true;
  const ext = att.name.split('.').pop()?.toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext || '');
}

export function isCodeOrTextAttachment(att: FileAttachment): boolean {
  if (
    att.type &&
    (att.type.startsWith('text/') ||
      att.type.includes('json') ||
      att.type.includes('xml') ||
      att.type.includes('javascript') ||
      att.type.includes('typescript'))
  ) {
    return true;
  }
  const ext = att.name.split('.').pop()?.toLowerCase();
  const codeExts = [
    'txt', 'md', 'markdown', 'json', 'js', 'jsx', 'ts', 'tsx',
    'html', 'htm', 'css', 'scss', 'sass', 'less', 'xml', 'svg',
    'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
    'cs', 'php', 'sh', 'bash', 'zsh', 'yml', 'yaml', 'toml',
    'ini', 'env', 'sql', 'graphql', 'log', 'diff', 'patch', 'csv',
  ];
  return codeExts.includes(ext || '');
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function getFileIcon(att: FileAttachment, className = 'w-4 h-4') {
  if (isImageAttachment(att)) {
    return <Eye className={className} />;
  }
  if (isCodeOrTextAttachment(att)) {
    return <FileCode className={className} />;
  }
  const ext = att.name.split('.').pop()?.toLowerCase();
  if (['zip', 'tar', 'gz', '7z', 'rar', 'bz2'].includes(ext || '')) {
    return <FileArchive className={className} />;
  }
  if (['pdf', 'doc', 'docx', 'rtf'].includes(ext || '')) {
    return <FileText className={className} />;
  }
  return <File className={className} />;
}

// Lightbox Modal for Full Image Preview
interface ImageLightboxModalProps {
  attachment: FileAttachment | null;
  onClose: () => void;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({ attachment, onClose }) => {
  useEffect(() => {
    if (!attachment) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [attachment, onClose]);

  if (!attachment) return null;

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${attachment.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative max-w-5xl w-full flex flex-col items-center max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="w-full flex items-center justify-between pb-3 px-2 text-white">
          <div className="flex items-center gap-2 min-w-0 pr-4">
            <span className="font-semibold text-sm truncate">{attachment.name}</span>
            <span className="text-xs text-white/60 shrink-0 font-mono">
              ({formatFileSize(attachment.size)})
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={`${attachment.url}?download=1`}
              download={attachment.name}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-medium transition-colors shadow-sm"
              title="Download original file"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Close preview (Esc)"
              aria-label="Close image preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Image Content Container */}
        <div className="relative overflow-hidden rounded-2xl bg-black/40 border border-white/10 shadow-2xl flex items-center justify-center p-1 sm:p-2 max-h-[82vh]">
          <img
            src={attachment.url}
            alt={attachment.name}
            className="max-h-[80vh] max-w-[90vw] object-contain rounded-xl select-none"
          />
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};

// Modal for Text / Code Preview
interface FilePreviewModalProps {
  taskId: string;
  attachment: FileAttachment | null;
  onClose: () => void;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({ taskId, attachment, onClose }) => {
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!attachment) {
      setContent('');
      setError(null);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    getAttachmentContent(taskId, attachment.id)
      .then((data) => {
        if (!isMounted) return;
        setContent(data.content);
        setIsTruncated(data.isTruncated);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message || 'Failed to load file contents');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [taskId, attachment]);

  useEffect(() => {
    if (!attachment) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [attachment, onClose]);

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!attachment) return null;

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Code preview of ${attachment.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/65 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative bg-cozy-surface border border-cozy-border rounded-2.5xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden text-cozy-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-cozy-border bg-cozy-subtle/50">
          <div className="flex items-center gap-2.5 min-w-0 pr-4">
            <div className="p-1.5 rounded-lg bg-cozy-surface border border-cozy-border text-rose-500 shadow-soft-sm shrink-0">
              {getFileIcon(attachment, 'w-4 h-4')}
            </div>
            <div className="min-w-0 flex flex-col">
              <span className="font-semibold text-sm truncate">{attachment.name}</span>
              <span className="text-[11px] text-cozy-muted font-mono">
                {formatFileSize(attachment.size)}
                {isTruncated && ' • (truncated)'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleCopy}
              disabled={isLoading || !content}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cozy-subtle hover:bg-cozy-border/50 text-cozy-text text-xs font-medium border border-cozy-border transition-colors disabled:opacity-50"
              title="Copy entire contents"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <a
              href={`${attachment.url}?download=1`}
              download={attachment.name}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cozy-subtle hover:bg-cozy-border/50 text-cozy-text text-xs font-medium border border-cozy-border transition-colors"
              title="Download file"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </a>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-cozy-border/50 text-cozy-muted hover:text-cozy-text transition-colors"
              title="Close preview (Esc)"
              aria-label="Close file preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Viewer */}
        <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed bg-cozy-bg/80 select-text">
          {isLoading ? (
            <div className="h-64 flex flex-col items-center justify-center gap-3 text-cozy-muted">
              <Loader2 className="w-6 h-6 animate-spin text-rose-400" />
              <span className="text-xs">Loading file preview...</span>
            </div>
          ) : error ? (
            <div className="h-64 flex flex-col items-center justify-center gap-2 text-rose-400 p-4 text-center">
              <AlertCircle className="w-6 h-6" />
              <span className="font-medium text-xs">{error}</span>
            </div>
          ) : (
            <div className="relative">
              {isTruncated && (
                <div className="mb-3 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[11px] font-sans">
                  Note: Large file truncated for preview. Use download to obtain the complete file.
                </div>
              )}
              <pre className="whitespace-pre-wrap break-all text-cozy-text font-mono text-[12px] leading-5">
                {content}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
