import { useCallback, useEffect, useRef, useState } from 'react';
import { extensionRequest, ExtensionHello, ExtensionStatus, PreviewCapture, PreviewExtensionError, PreviewNavigation, statusFromError, statusFromHello, subscribePreviewNavigation } from './previewExtension';

export function usePreviewExtension(taskId: string, origin: string, enabled: boolean, onNavigation: (value: PreviewNavigation) => void) {
  const [status, setStatus] = useState<ExtensionStatus>('checking');
  const [registeredKey, setRegisteredKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([taskId, origin, revision]);
  const registered = enabled && status === 'ready' && registeredKey === key;
  const error = failure?.key === key ? failure.message : null;
  const preparing = enabled && (status === 'checking' || (status === 'ready' && !registered && !error));
  const session = useRef<string | null>(null);
  const navigation = useRef(onNavigation);
  navigation.current = onNavigation;
  const mounted = useRef(true);
  const checking = useRef<Promise<ExtensionStatus> | null>(null);

  const check = useCallback((): Promise<ExtensionStatus> => {
    if (checking.current) return checking.current;
    checking.current = (async () => {
      let next: ExtensionStatus;
      if (!/(Chrome|Chromium|Edg)\//.test(navigator.userAgent)) next = 'unsupported';
      else {
        try { next = statusFromHello(await extensionRequest<ExtensionHello>('hello', {}, 1200)); }
        catch (error) { next = statusFromError(error) || 'missing'; }
      }
      if (mounted.current) setStatus(next);
      return next;
    })().finally(() => { checking.current = null; });
    return checking.current;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void check();
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void check(); }, 60000);
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [check]);

  useEffect(() => {
    let cancelled = false;
    setRegisteredKey(null);
    setFailure(null);
    if (!enabled || status !== 'ready') {
      return;
    }
    const sessionId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    session.current = sessionId;
    const unsubscribe = subscribePreviewNavigation(sessionId, (value) => navigation.current(value));
    void extensionRequest('registerPreview', { sessionId, taskId, url: origin }).then(() => {
      if (!cancelled) setRegisteredKey(key);
      else void extensionRequest('unregisterPreview', { sessionId }).catch(() => {});
    }).catch((error) => {
      if (!cancelled) {
        setFailure({ key, message: error.message });
        const next = statusFromError(error);
        if (next) setStatus(next);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
      if (session.current === sessionId) session.current = null;
      void extensionRequest('unregisterPreview', { sessionId }).catch(() => {});
    };
  }, [taskId, origin, enabled, status, key]);

  const request = useCallback(async <T,>(action: string, payload: object): Promise<T> => {
    const sessionId = session.current;
    if (!registered || !sessionId) throw new PreviewExtensionError('PREVIEW_NOT_READY', 'The preview extension is not connected. Enable enhanced preview and try again.');
    try {
      const result = await extensionRequest<T>(action, { ...payload, sessionId }, action === 'capture' ? 15000 : 4000);
      if (session.current !== sessionId) throw new PreviewExtensionError('STALE_SESSION', 'The preview changed. Please try again.');
      return result;
    } catch (error) {
      const next = statusFromError(error);
      if (next) setStatus(next);
      throw error;
    }
  }, [registered]);

  return {
    status, registered, preparing, error, check, sessionId: session.current,
    retry: async () => { const next = await check(); if (mounted.current && next === 'ready' && !registered) setRevision((value) => value + 1); return next; },
    navigate: (command: 'back' | 'forward' | 'reload' | 'to', path?: string) => request('navigate', { command, path }),
    capture: (rect: DOMRect, url: string) => request<PreviewCapture>('capture', {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight }, url,
    }),
  };
}
