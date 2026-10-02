import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ExternalLink, Loader2, Puzzle, X } from 'lucide-react';
import { ExtensionStatus } from '../previewExtension';

interface Props {
  status: ExtensionStatus;
  onClose: () => void;
  onCheck: () => Promise<ExtensionStatus>;
}

export function PreviewExtensionDialog({ status, onClose, onCheck }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const env = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;
  const configuredUrl = env.VITE_PREVIEW_EXTENSION_STORE_URL;
  const installUrl = configuredUrl && /^https:\/\/(chromewebstore\.google\.com|microsoftedge\.microsoft\.com)\//.test(configuredUrl)
    ? configuredUrl : '/extension/install.html';
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key !== 'Tab') return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') || [])];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);

  const check = async () => {
    setBusy(true); setMessage('');
    try {
      const next = await onCheck();
      setMessage(next === 'ready' ? 'Connected. Close this dialog and capture your preview.' : next === 'setup'
        ? 'Extension found. Use an Alpha Bro address on port 3300 and allow the extension access to all sites in browser extension settings.' : next === 'missing'
          ? 'No response from the extension in this tab. If you already installed it, reload Alpha Bro once. Check again cannot load the extension into an already-open tab.'
          : 'The extension is not ready yet. Check that it is enabled, then try again.');
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="preview-extension-title" tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-cozy-border bg-cozy-surface p-6 shadow-xl text-cozy-text outline-none">
        <div className="flex items-start justify-between gap-4">
          <Puzzle className="h-7 w-7 text-teal-500" />
          <button onClick={onClose} aria-label="Close extension dialog" className="p-1 rounded hover:bg-cozy-subtle"><X className="h-5 w-5" /></button>
        </div>
        <h2 id="preview-extension-title" className="mt-4 text-lg font-semibold">Enhance your preview with Alpha Bro Companion</h2>
        <p className="mt-2 text-sm text-cozy-muted">Capture the preview exactly as you see it, without a screen-sharing dialog. Keep using the same crop and annotation tools.</p>
        <p className="mt-2 text-sm text-cozy-muted">The extension also helps local dev apps load inside the preview and connects its navigation controls.</p>
        <p className="mt-3 text-xs text-cozy-muted">Alpha Bro addresses on port 3300 connect automatically. Screenshots stay in your browser until you attach them to chat.</p>
        {status === 'unsupported' && <p className="mt-3 text-sm">Alpha Bro Companion currently supports desktop Chrome and Edge. Open Alpha Bro in either browser to use these features.</p>}
        {status === 'missing' && <p className="mt-3 text-sm">After installing, reload Alpha Bro once. Open Alpha Bro on port 3300 to connect automatically.</p>}
        {status === 'setup' && <p className="mt-3 text-sm">The extension is installed. Open Alpha Bro on port 3300 and allow the companion access to all sites in browser extension settings.</p>}
        {status === 'reload' && <p className="mt-3 text-sm">The extension was updated or disabled. Enable it if needed, then reload Alpha Bro to reconnect.</p>}
        {status === 'update' && <p className="mt-3 text-sm">Update the extension to a compatible version, then check again.</p>}
        {(message || status === 'ready') && <p role="status" className="mt-3 text-sm text-teal-600">{message || 'Extension connected. Your enhanced preview is ready.'}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          {status === 'reload' ? <button className="rounded-lg bg-teal-600 px-3 py-2 text-sm text-white" onClick={() => window.location.reload()}>Reload Alpha Bro</button> : (status === 'missing' || status === 'update') && (
            <a href={installUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm text-white">
              {status === 'update' ? 'Update extension' : 'Install extension'}<ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {status === 'missing' && <button className="rounded-lg border border-cozy-border px-3 py-2 text-sm" onClick={() => window.location.reload()}>Already installed? Reload Alpha Bro</button>}
          {status !== 'unsupported' && <button disabled={busy} onClick={check} className="inline-flex items-center gap-2 rounded-lg border border-cozy-border px-3 py-2 text-sm disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}Check again
          </button>}
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-cozy-muted hover:bg-cozy-subtle">{status === 'ready' ? 'Done' : 'Not now'}</button>
        </div>
      </div>
    </div>, document.body,
  );
}
