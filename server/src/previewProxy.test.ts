import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { startDevServerProxy, getInjectedTrackerScript } from './previewProxy.js';

test('getInjectedTrackerScript contains taskId and navigation listeners', () => {
  const script = getInjectedTrackerScript('task-1234');
  assert.ok(script.includes('<script'), 'Should wrap code in script tags');
  assert.ok(script.includes('task-1234'), 'Should embed target taskId');
  assert.ok(script.includes('RAFT_PREVIEW_URL_CHANGED'), 'Should include postMessage event type');
  assert.ok(script.includes('RAFT_PREVIEW_NAVIGATE_TO'), 'Should include navigate-to listener');
  assert.ok(script.includes('RAFT_PREVIEW_NAVIGATE_BACK'), 'Should include navigate-back listener');
  assert.ok(script.includes('RAFT_PREVIEW_NAVIGATE_FORWARD'), 'Should include navigate-forward listener');
  assert.ok(script.includes('window.__raft_tracker_active'), 'Should check idempotent flag');
});

test('startDevServerProxy forwards requests, injects script in HTML, and strips frame headers', async () => {
  // 1. Create a dummy target dev server
  const dummyTargetServer = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'x-frame-options': 'DENY',
        'content-security-policy': "frame-ancestors 'none'",
      });
      res.end('<!DOCTYPE html><html><head><title>App</title></head><body><h1>Hello World</h1></body></html>');
    } else if (req.url === '/main.js') {
      res.writeHead(200, {
        'content-type': 'application/javascript',
      });
      res.end('console.log("hello app");');
    } else if (req.url === '/redirect') {
      res.writeHead(302, {
        location: 'http://localhost:' + (dummyTargetServer.address() as any).port + '/destination',
      });
      res.end();
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise<void>((resolve) => dummyTargetServer.listen(0, '127.0.0.1', () => resolve()));
  const targetPort = (dummyTargetServer.address() as any).port;

  // 2. Start the proxy
  const proxy = await startDevServerProxy('task-test-preview', targetPort);
  assert.ok(proxy.port > 0, 'Proxy should bind to a valid dynamic port');
  assert.notStrictEqual(proxy.port, targetPort, 'Proxy port should differ from target dev port');

  try {
    // 3. Test HTML request
    const htmlResponse = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${proxy.port}/`, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, headers: res.headers, body });
        });
      });
      req.on('error', reject);
    });

    assert.strictEqual(htmlResponse.status, 200);
    assert.strictEqual(htmlResponse.headers['x-frame-options'], undefined, 'x-frame-options should be stripped');
    assert.strictEqual(htmlResponse.headers['content-security-policy'], undefined, 'content-security-policy should be stripped');
    assert.ok(htmlResponse.body.includes('task-test-preview'), 'Injected tracker script should be present in HTML body');
    assert.ok(htmlResponse.body.includes('<h1>Hello World</h1>'), 'Original HTML content should be preserved');

    // 4. Test non-HTML asset request (JS)
    const jsResponse = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${proxy.port}/main.js`, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, headers: res.headers, body });
        });
      });
      req.on('error', reject);
    });

    assert.strictEqual(jsResponse.status, 200);
    assert.strictEqual(jsResponse.body, 'console.log("hello app");', 'Non-HTML asset should not be modified');

    // 5. Test redirect rewrite
    const redirectResponse = await new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${proxy.port}/redirect`, (res) => {
        res.resume();
        resolve({ status: res.statusCode || 0, headers: res.headers });
      });
      req.on('error', reject);
    });

    assert.strictEqual(redirectResponse.status, 302);
    assert.ok(
      redirectResponse.headers.location?.includes(`:${proxy.port}/destination`),
      `Redirect Location should rewrite targetPort to proxyPort. Got: ${redirectResponse.headers.location}`
    );
  } finally {
    proxy.close();
    await new Promise<void>((resolve) => dummyTargetServer.close(() => resolve()));
  }
});

test('startDevServerProxy seamlessly connects to IPv6 ::1 upstream dev servers (like Vite on macOS)', async () => {
  // 1. Create a dummy target dev server bound exclusively to IPv6 ::1
  const ipv6Server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!DOCTYPE html><html><head></head><body>IPv6 Vite App</body></html>');
  });

  await new Promise<void>((resolve, reject) => {
    ipv6Server.listen(0, '::1', () => resolve());
    ipv6Server.on('error', reject);
  });
  const targetPort = (ipv6Server.address() as any).port;

  // 2. Start proxy bound to 127.0.0.1
  const proxy = await startDevServerProxy('task-ipv6-preview', targetPort, '127.0.0.1');

  try {
    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${proxy.port}/`, (r) => {
        let body = '';
        r.on('data', (c) => { body += c; });
        r.on('end', () => resolve({ status: r.statusCode || 0, body }));
      });
      req.on('error', reject);
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('IPv6 Vite App'), 'Should successfully proxy from IPv6 ::1 target');
    assert.ok(res.body.includes('task-ipv6-preview'), 'Should inject tracker script into IPv6 target response');
  } finally {
    proxy.close();
    await new Promise<void>((resolve) => ipv6Server.close(() => resolve()));
  }
});

