(() => {
  const topPage = window === window.top;
  if (!['http:', 'https:'].includes(location.protocol)) return;
  const reply = (message) => window.postMessage({ source: 'alpha-bro-extension', version: 1, ...message }, location.origin);
  if (topPage) {
    window.addEventListener('message', async (event) => {
      const data = event.data;
      if (data?.source === 'alpha-bro-frame-identity' && typeof data.token === 'string' && typeof data.sessionId === 'string') {
        const preview = [...document.querySelectorAll('iframe[data-alpha-bro-preview]')].find(frame => frame.dataset.alphaBroPreview === data.sessionId);
        if (preview && event.source === preview.contentWindow) chrome.runtime.sendMessage({ type: 'identified', token: data.token, sessionId: data.sessionId }).catch(() => {});
        return;
      }
      if (event.source !== window || event.origin !== location.origin || data?.source !== 'alpha-bro-page' || data.version !== 1 || typeof data.id !== 'string' || typeof data.action !== 'string') return;
      try {
        const result = await chrome.runtime.sendMessage({ type: 'page', action: data.action, payload: data.payload, viewport: { width: innerWidth, height: innerHeight } });
        reply({ id: data.id, ...result });
      } catch {
        reply({ id: data.id, ok: false, error: { code: 'EXTENSION_UNAVAILABLE', message: 'The extension was updated or disabled. Reload Alpha Bro to reconnect.' } });
      }
    });
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'identify' && !topPage) {
      window.parent.postMessage({ source: 'alpha-bro-frame-identity', token: message.token, sessionId: message.sessionId }, '*');
      respond({ ok: true });
      return;
    }
    if (message.type === 'event' && topPage) { reply(message.message); return; }
    if (message.type === 'measure' && topPage) {
      const preview = [...document.querySelectorAll('iframe[data-alpha-bro-preview]')].find(frame => frame.dataset.alphaBroPreview === message.sessionId);
      const bounds = preview?.getBoundingClientRect();
      respond({ width: innerWidth, height: innerHeight, rect: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null });
      return;
    }
    if (message.type === 'navigationState' && !topPage) {
      respond({ url: location.href, pathname: location.pathname + location.search + location.hash, navigationAvailable: Boolean(window.navigation?.currentEntry), canGoBack: window.navigation?.canGoBack ?? false, canGoForward: window.navigation?.canGoForward ?? false });
      return;
    }
    if (message.type !== 'navigate' || topPage) return;
    if (message.command === 'back') history.back();
    else if (message.command === 'forward') history.forward();
    else if (message.command === 'reload') location.reload();
    else if (message.command === 'to') location.assign(message.url);
    respond({ ok: true });
  });
  if (!topPage) {
    chrome.runtime.sendMessage({ type: 'frameReady' }).catch(() => {});
    window.navigation?.addEventListener('currententrychange', () => chrome.runtime.sendMessage({ type: 'frameReady' }).catch(() => {}));
    window.addEventListener('popstate', () => chrome.runtime.sendMessage({ type: 'frameReady' }).catch(() => {}));
  }
})();
