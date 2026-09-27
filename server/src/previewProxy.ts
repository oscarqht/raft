import http from 'node:http';
import net from 'node:net';
import { Request, Response, NextFunction } from 'express';
import { devServerManager } from './devServerManager.js';

export interface PreviewRouteInfo {
  taskId: string;
  targetPath: string;
}

export function extractPreviewInfo(req: http.IncomingMessage): PreviewRouteInfo | null {
  const url = req.url || '';

  // 1. Direct preview endpoint: /api/preview/:taskId/*
  const directMatch = url.match(/^\/api\/preview\/([a-zA-Z0-9_-]+)(\/.*|\?.*)?$/);
  if (directMatch) {
    const taskId = directMatch[1];
    let targetPath = directMatch[2] || '/';
    if (!targetPath.startsWith('/')) {
      targetPath = '/' + targetPath;
    }
    return { taskId, targetPath };
  }

  // Never hijack Termai's own core API or WebSocket endpoints via referer
  if (url.startsWith('/ws')) {
    return null;
  }
  const termaiCoreApis = [
    '/api/projects',
    '/api/tasks',
    '/api/settings',
    '/api/clis',
    '/api/models',
    '/api/git',
    '/api/fs',
    '/api/scripts',
    '/api/skills',
    '/api/host',
    '/api/upload',
  ];
  if (termaiCoreApis.some((prefix) => url.startsWith(prefix))) {
    return null;
  }

  // 2. Referer-based fallback for root-relative subresources (e.g., /@vite/client, /assets/index.js)
  const referer = req.headers['referer'] || req.headers['referrer'];
  if (typeof referer === 'string') {
    const refMatch = referer.match(/\/api\/preview\/([a-zA-Z0-9_-]+)/);
    if (refMatch) {
      const taskId = refMatch[1];
      return { taskId, targetPath: url };
    }
  }

  return null;
}

function getInjectedTrackerScript(taskId: string): string {
  return `<!-- TERMAI_PREVIEW_INJECTION_START -->
<script id="__termai_preview_tracker">
(function() {
  if (window.__termai_tracker_active) return;
  window.__termai_tracker_active = true;

  var currentTaskId = ${JSON.stringify(taskId)};

  function sendUrlUpdate() {
    try {
      var currentPath = window.location.pathname + window.location.search + window.location.hash;
      window.parent.postMessage({
        type: 'TERMAI_PREVIEW_URL_CHANGED',
        taskId: currentTaskId,
        url: window.location.href,
        pathname: currentPath,
        path: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash
      }, '*');
    } catch (e) {}
  }

  // 1. Initial page load
  sendUrlUpdate();

  // Also notify on DOMContentLoaded and load for client hydration/redirects
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', sendUrlUpdate);
  }
  window.addEventListener('load', sendUrlUpdate);

  // 2. Intercept SPA routing (History API)
  try {
    var origPushState = history.pushState;
    history.pushState = function() {
      var ret = origPushState.apply(this, arguments);
      sendUrlUpdate();
      return ret;
    };

    var origReplaceState = history.replaceState;
    history.replaceState = function() {
      var ret = origReplaceState.apply(this, arguments);
      sendUrlUpdate();
      return ret;
    };
  } catch (e) {}

  // 3. Listen to browser history events & hash changes
  window.addEventListener('popstate', sendUrlUpdate);
  window.addEventListener('hashchange', sendUrlUpdate);

  // 4. Handle incoming navigation commands from Termai preview toolbar
  window.addEventListener('message', function(ev) {
    if (!ev.data) return;
    if (ev.data.type === 'TERMAI_PREVIEW_NAVIGATE_BACK') {
      history.back();
    } else if (ev.data.type === 'TERMAI_PREVIEW_NAVIGATE_FORWARD') {
      history.forward();
    } else if (ev.data.type === 'TERMAI_PREVIEW_RELOAD') {
      window.location.reload();
    } else if (ev.data.type === 'TERMAI_PREVIEW_NAVIGATE_TO' && ev.data.url) {
      window.location.href = ev.data.url;
    }
  });
})();
</script>
<!-- TERMAI_PREVIEW_INJECTION_END -->`;
}

/**
 * Express middleware for dev server proxying with in-flight tracker injection.
 */
export function createPreviewProxyMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Only intercept if matching preview route or referer
    const info = extractPreviewInfo(req);
    if (!info) {
      return next();
    }

    const state = devServerManager.getServerState(info.taskId);
    if (!state || !state.port || state.status !== 'running') {
      const acceptsHtml = (req.headers.accept || '').includes('text/html');
      if (acceptsHtml) {
        res.status(503).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8" />
              <title>Dev Server Not Ready</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #94a3b8; }
                .card { text-align: center; max-width: 420px; padding: 2rem; background: #1e293b; border-radius: 1rem; border: 1px solid #334155; }
                h2 { color: #f8fafc; font-size: 1.25rem; margin-top: 0; }
                p { font-size: 0.875rem; line-height: 1.5; }
              </style>
            </head>
            <body>
              <div class="card">
                <h2>Dev Server Not Running</h2>
                <p>The dev server for task <code>${info.taskId}</code> is currently ${state?.status || 'stopped'}.</p>
                <p>Please click Start in the preview toolbar.</p>
              </div>
            </body>
          </html>
        `);
        return;
      }
      res.status(503).json({ error: 'Dev server not running for task', taskId: info.taskId, status: state?.status || 'stopped' });
      return;
    }

    const targetPort = state.port;
    const targetPath = info.targetPath;

    // Prepare proxy request headers
    const proxyHeaders: http.OutgoingHttpHeaders = { ...req.headers };
    proxyHeaders.host = `127.0.0.1:${targetPort}`;
    // Force uncompressed responses from dev server so we can inject scripts into HTML safely
    proxyHeaders['accept-encoding'] = 'identity';
    delete proxyHeaders['connection'];

    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: targetPort,
        path: targetPath,
        method: req.method,
        headers: proxyHeaders,
      },
      (upstreamRes) => {
        const contentType = upstreamRes.headers['content-type'] || '';
        const isHtml = typeof contentType === 'string' && contentType.toLowerCase().includes('text/html');

        if (!isHtml) {
          // Pass non-HTML assets (JS, CSS, images, JSON) straight through
          const headers = { ...upstreamRes.headers };
          delete headers['x-frame-options'];
          delete headers['content-security-policy'];
          delete headers['content-security-policy-report-only'];
          headers['access-control-allow-origin'] = '*';

          res.writeHead(upstreamRes.statusCode || 200, headers);
          upstreamRes.pipe(res);
          return;
        }

        // Buffer HTML to inject URL tracking script & strip iframe security headers
        const chunks: Buffer[] = [];
        upstreamRes.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        upstreamRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf-8');
          const script = getInjectedTrackerScript(info.taskId);

          if (html.includes('</head>')) {
            html = html.replace('</head>', `${script}\n</head>`);
          } else if (html.includes('</body>')) {
            html = html.replace('</body>', `${script}\n</body>`);
          } else {
            html += `\n${script}`;
          }

          const responseHeaders = { ...upstreamRes.headers };
          delete responseHeaders['x-frame-options'];
          delete responseHeaders['content-security-policy'];
          delete responseHeaders['content-security-policy-report-only'];
          delete responseHeaders['transfer-encoding'];
          responseHeaders['access-control-allow-origin'] = '*';
          responseHeaders['content-length'] = Buffer.byteLength(html, 'utf-8').toString();

          res.writeHead(upstreamRes.statusCode || 200, responseHeaders);
          res.end(html);
        });
      }
    );

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).json({ error: `Preview Proxy Error: ${err.message}` });
      }
    });

    // Pipe incoming request body to upstream dev server
    req.pipe(proxyReq);
  };
}

/**
 * Handles raw TCP / WebSocket upgrade forwarding for HMR (Vite / Next.js) and socket connections.
 */
export function handlePreviewUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer): boolean {
  const info = extractPreviewInfo(req);
  if (!info) {
    return false;
  }

  const state = devServerManager.getServerState(info.taskId);
  if (!state || !state.port || state.status !== 'running') {
    socket.destroy();
    return true;
  }

  const targetPort = state.port;
  const targetPath = info.targetPath;

  const targetSocket = net.connect(targetPort, '127.0.0.1', () => {
    const reqLines = [`${req.method || 'GET'} ${targetPath} HTTP/${req.httpVersion}`];
    if (req.rawHeaders) {
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const key = req.rawHeaders[i];
        const val = req.rawHeaders[i + 1];
        if (key.toLowerCase() === 'host') {
          reqLines.push(`Host: 127.0.0.1:${targetPort}`);
        } else {
          reqLines.push(`${key}: ${val}`);
        }
      }
    }
    targetSocket.write(reqLines.join('\r\n') + '\r\n\r\n');
    if (head && head.length > 0) {
      targetSocket.write(head);
    }
    socket.pipe(targetSocket);
    targetSocket.pipe(socket);
  });

  targetSocket.on('error', () => {
    try { socket.destroy(); } catch {}
  });
  socket.on('error', () => {
    try { targetSocket.destroy(); } catch {}
  });

  return true;
}
