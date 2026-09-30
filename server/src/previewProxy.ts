import http from 'node:http';
import net from 'node:net';

export function getInjectedTrackerScript(taskId: string): string {
  return `<!-- RAFT_PREVIEW_TRACKER_START -->
<script id="__raft_preview_tracker">
(function() {
  if (window.__raft_tracker_active) return;
  window.__raft_tracker_active = true;

  var currentTaskId = ${JSON.stringify(taskId)};
  var historyIndex = 0;
  var maxHistoryLength = 1;

  function sendUrlUpdate() {
    try {
      var currentPath = window.location.pathname + window.location.search + window.location.hash;
      window.parent.postMessage({
        type: 'RAFT_PREVIEW_URL_CHANGED',
        taskId: currentTaskId,
        url: window.location.href,
        pathname: currentPath,
        path: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
        canGoBack: historyIndex > 0,
        canGoForward: historyIndex < maxHistoryLength - 1
      }, '*');
    } catch (e) {}
  }

  // 1. Initial page load & lifecycle events
  sendUrlUpdate();

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', sendUrlUpdate);
  }
  window.addEventListener('load', sendUrlUpdate);

  // 2. Intercept History API (SPAs like React Router, Next.js, Vue Router)
  try {
    var origPushState = history.pushState;
    history.pushState = function() {
      var ret = origPushState.apply(this, arguments);
      historyIndex++;
      maxHistoryLength = historyIndex + 1;
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

  // 3. Browser navigation events
  window.addEventListener('popstate', function(ev) {
    if (ev.state && typeof ev.state.__raft_idx === 'number') {
      historyIndex = ev.state.__raft_idx;
    } else if (historyIndex > 0) {
      historyIndex--;
    }
    sendUrlUpdate();
  });

  window.addEventListener('hashchange', function() {
    sendUrlUpdate();
  });

  // 4. Intercept internal link clicks
  document.addEventListener('click', function(ev) {
    var target = ev.target;
    while (target && target.tagName !== 'A') {
      target = target.parentElement;
    }
    if (target && target.tagName === 'A' && target.href) {
      try {
        var linkUrl = new URL(target.href, window.location.href);
        if (linkUrl.origin === window.location.origin) {
          setTimeout(sendUrlUpdate, 50);
        }
      } catch (err) {}
    }
  }, true);

  // 5. Listen for commands from parent preview pane toolbar
  window.addEventListener('message', function(ev) {
    if (!ev.data) return;
    if (ev.data.type === 'RAFT_PREVIEW_NAVIGATE_TO' && ev.data.path) {
      var currentFullPath = window.location.pathname + window.location.search + window.location.hash;
      if (currentFullPath !== ev.data.path) {
        window.location.href = ev.data.path;
      } else {
        window.location.reload();
      }
    } else if (ev.data.type === 'RAFT_PREVIEW_NAVIGATE_BACK') {
      window.history.back();
    } else if (ev.data.type === 'RAFT_PREVIEW_NAVIGATE_FORWARD') {
      window.history.forward();
    } else if (ev.data.type === 'RAFT_PREVIEW_RELOAD') {
      window.location.reload();
    }
  });
})();
</script>
<!-- RAFT_PREVIEW_TRACKER_END -->`;
}

export interface DevServerProxyInstance {
  server: http.Server;
  port: number;
  setTargetHost: (host: '127.0.0.1' | '::1') => void;
  close: () => void;
}

export function probeTargetHost(targetPort: number, preferredHost?: string | null): Promise<'127.0.0.1' | '::1'> {
  const tryConnect = (h: '127.0.0.1' | '::1'): Promise<boolean> => {
    return new Promise((res) => {
      const s = net.connect({ port: targetPort, host: h }, () => {
        s.destroy();
        res(true);
      });
      s.on('error', () => {
        res(false);
      });
    });
  };

  return new Promise(async (resolve) => {
    if (preferredHost === '127.0.0.1' || preferredHost === '::1') {
      if (await tryConnect(preferredHost)) {
        return resolve(preferredHost);
      }
    }

    // Probe ::1 (common default for Vite/Node on macOS) and 127.0.0.1
    if (await tryConnect('::1')) {
      return resolve('::1');
    }
    if (await tryConnect('127.0.0.1')) {
      return resolve('127.0.0.1');
    }

    // Default to 127.0.0.1 if server is still starting
    resolve('127.0.0.1');
  });
}

export function startDevServerProxy(
  taskId: string,
  targetPort: number,
  host: string = '127.0.0.1'
): Promise<DevServerProxyInstance> {
  return new Promise((resolve, reject) => {
    let targetHost: '127.0.0.1' | '::1' | null = null;

    const getOrDetectTargetHost = async (): Promise<'127.0.0.1' | '::1'> => {
      if (targetHost) return targetHost;
      targetHost = await probeTargetHost(targetPort, targetHost);
      return targetHost;
    };

    const proxyServer = http.createServer(async (req, res) => {
      const activeHost = await getOrDetectTargetHost();

      // Upstream request headers
      const proxyHeaders: http.OutgoingHttpHeaders = { ...req.headers };
      proxyHeaders.host = `localhost:${targetPort}`;
      // Force uncompressed responses from dev server so HTML script injection works smoothly
      proxyHeaders['accept-encoding'] = 'identity';
      delete proxyHeaders['connection'];

      const forwardRequest = (currentHost: '127.0.0.1' | '::1', isRetry: boolean = false) => {
        const proxyReq = http.request(
          {
            hostname: currentHost,
            port: targetPort,
            path: req.url,
            method: req.method,
            headers: proxyHeaders,
          },
          (upstreamRes) => {
            targetHost = currentHost; // Confirmed working host
            const statusCode = upstreamRes.statusCode || 200;
            const headers = { ...upstreamRes.headers };

            // Strip restrictive framing headers so iframe can embed cleanly
            delete headers['x-frame-options'];
            delete headers['content-security-policy'];
            delete headers['content-security-policy-report-only'];
            headers['access-control-allow-origin'] = '*';

            const proxyAddress = proxyServer.address() as net.AddressInfo | null;
            const assignedPort = proxyAddress ? proxyAddress.port : 0;

            // Rewrite redirect location header if redirected to targetPort
            if (headers['location'] && assignedPort) {
              headers['location'] = headers['location'].replace(
                new RegExp(`(:|//)(?:localhost|127\\.0\\.0\\.1|\\[::1\\]):${targetPort}`, 'g'),
                `$1localhost:${assignedPort}`
              );
            }

            const contentType = (upstreamRes.headers['content-type'] || '').toLowerCase();
            const isHtml = contentType.includes('text/html');

            if (!isHtml) {
              res.writeHead(statusCode, headers);
              upstreamRes.pipe(res);
              return;
            }

            // Buffer HTML to inject tracker script
            const chunks: Buffer[] = [];
            upstreamRes.on('data', (chunk) => {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });

            upstreamRes.on('end', () => {
              let html = Buffer.concat(chunks).toString('utf-8');
              const trackerScript = getInjectedTrackerScript(taskId);

              if (html.includes('</head>')) {
                html = html.replace('</head>', `${trackerScript}\n</head>`);
              } else if (html.includes('</body>')) {
                html = html.replace('</body>', `${trackerScript}\n</body>`);
              } else {
                html = `${html}\n${trackerScript}`;
              }

              delete headers['transfer-encoding'];
              delete headers['content-length'];

              const bodyBuf = Buffer.from(html, 'utf-8');
              headers['content-length'] = bodyBuf.length.toString();
              res.writeHead(statusCode, headers);
              res.end(bodyBuf);
            });
          }
        );

        proxyReq.on('error', (err: any) => {
          if (!isRetry && err?.code === 'ECONNREFUSED') {
            const altHost: '127.0.0.1' | '::1' = currentHost === '127.0.0.1' ? '::1' : '127.0.0.1';
            if (req.method === 'GET' || req.method === 'HEAD') {
              forwardRequest(altHost, true);
              return;
            }
          }

          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<html><body><h3>Dev Server Connection Pending</h3><p>${err.message}</p></body></html>`);
          }
        });

        req.pipe(proxyReq);
      };

      forwardRequest(activeHost);
    });

    // Handle WebSocket upgrade (essential for Vite/Webpack HMR)
    proxyServer.on('upgrade', async (req, clientSocket, head) => {
      const activeHost = await getOrDetectTargetHost();

      const connectUpgrade = (currentHost: '127.0.0.1' | '::1', isRetry: boolean = false) => {
        const upstreamSocket = net.connect(
          { port: targetPort, host: currentHost },
          () => {
            targetHost = currentHost;
            const headers = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
            for (let i = 0; i < req.rawHeaders.length; i += 2) {
              const key = req.rawHeaders[i];
              const val = req.rawHeaders[i + 1];
              if (key.toLowerCase() === 'host') {
                headers.push(`Host: localhost:${targetPort}`);
              } else {
                headers.push(`${key}: ${val}`);
              }
            }
            upstreamSocket.write(headers.join('\r\n') + '\r\n\r\n');
            if (head && head.length > 0) {
              upstreamSocket.write(head);
            }
            upstreamSocket.pipe(clientSocket);
            clientSocket.pipe(upstreamSocket);
          }
        );

        upstreamSocket.on('error', (err: any) => {
          if (!isRetry && err?.code === 'ECONNREFUSED') {
            const altHost: '127.0.0.1' | '::1' = currentHost === '127.0.0.1' ? '::1' : '127.0.0.1';
            connectUpgrade(altHost, true);
            return;
          }
          clientSocket.destroy();
        });

        clientSocket.on('error', () => {
          upstreamSocket.destroy();
        });
      };

      connectUpgrade(activeHost);
    });

    proxyServer.listen(0, host, () => {
      const addr = proxyServer.address() as net.AddressInfo;
      const instance: DevServerProxyInstance = {
        server: proxyServer,
        port: addr.port,
        setTargetHost: (h: '127.0.0.1' | '::1') => {
          targetHost = h;
        },
        close: () => {
          try {
            proxyServer.close();
          } catch {}
        },
      };
      resolve(instance);
    });

    proxyServer.on('error', (err) => {
      reject(err);
    });
  });
}
