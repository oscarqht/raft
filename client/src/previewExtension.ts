export const PREVIEW_PROTOCOL_VERSION = 1;

export class PreviewExtensionError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export type ExtensionStatus = 'checking' | 'missing' | 'setup' | 'update' | 'reload' | 'ready' | 'unsupported';
export interface ExtensionHello { connected: boolean; permissions: boolean; version: number | string }
export interface PreviewNavigation {
  url: string;
  pathname: string;
  canGoBack: boolean;
  canGoForward: boolean;
}
export interface PreviewCapture { dataUrl: string; width: number; height: number; url: string }

export function extensionRequest<T>(action: string, payload: unknown = {}, timeoutMs = 4000): Promise<T> {
  const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data;
      if (message?.source !== 'alpha-bro-extension' || message.id !== id) return;
      finish();
      if (message.version !== PREVIEW_PROTOCOL_VERSION) {
        reject(new PreviewExtensionError('UPDATE_REQUIRED', 'Update the Alpha Bro extension to continue.'));
      } else if (!message.ok) {
        reject(new PreviewExtensionError(message.error?.code || 'CAPTURE_FAILED', message.error?.message || 'The extension could not complete the request.'));
      } else resolve(message.result);
    };
    const timer = window.setTimeout(() => {
      finish();
      reject(new PreviewExtensionError('UNAVAILABLE', 'The Alpha Bro extension did not respond. Check that it is installed and enabled.'));
    }, timeoutMs);
    window.addEventListener('message', receive);
    window.postMessage({ source: 'alpha-bro-page', version: PREVIEW_PROTOCOL_VERSION, id, action, payload }, window.location.origin);
  });
}

export function subscribePreviewNavigation(sessionId: string, listener: (value: PreviewNavigation) => void): () => void {
  const receive = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (message?.source !== 'alpha-bro-extension' || message.version !== PREVIEW_PROTOCOL_VERSION ||
        message.event !== 'navigation' || message.sessionId !== sessionId) return;
    const value = message.payload;
    if (typeof value?.url !== 'string' || typeof value.pathname !== 'string') return;
    listener(value);
  };
  window.addEventListener('message', receive);
  return () => window.removeEventListener('message', receive);
}

export function statusFromHello(hello: ExtensionHello): ExtensionStatus {
  if (Number(hello.version) !== PREVIEW_PROTOCOL_VERSION) return 'update';
  return hello.connected && hello.permissions ? 'ready' : 'setup';
}

export function statusFromError(error: unknown): ExtensionStatus | null {
  if (!(error instanceof PreviewExtensionError)) return null;
  if (error.code === 'UPDATE_REQUIRED') return 'update';
  if (error.code === 'EXTENSION_UNAVAILABLE') return 'reload';
  if (error.code === 'UNAVAILABLE') return 'missing';
  if (['NOT_CONNECTED', 'PERMISSION_REQUIRED'].includes(error.code)) return 'setup';
  return null;
}
