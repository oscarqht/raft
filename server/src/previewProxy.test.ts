import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { extractPreviewInfo, createPreviewProxyMiddleware } from './previewProxy.js';
import { devServerManager } from './devServerManager.js';

describe('previewProxy', () => {
  it('extractPreviewInfo extracts taskId and path from direct /api/preview routes', () => {
    const req1 = { url: '/api/preview/task-abc/' } as any;
    const info1 = extractPreviewInfo(req1);
    assert.deepEqual(info1, { taskId: 'task-abc', targetPath: '/' });

    const req2 = { url: '/api/preview/task-xyz/dashboard/overview?period=7d#chart' } as any;
    const info2 = extractPreviewInfo(req2);
    assert.deepEqual(info2, { taskId: 'task-xyz', targetPath: '/dashboard/overview?period=7d#chart' });
  });

  it('extractPreviewInfo extracts taskId and target path from Referer header for subresources', () => {
    const req = {
      url: '/@vite/client',
      headers: {
        referer: 'http://localhost:5180/api/preview/task-123/subpage',
      },
    } as any;
    const info = extractPreviewInfo(req);
    assert.deepEqual(info, { taskId: 'task-123', targetPath: '/@vite/client' });
  });

  it('extractPreviewInfo never intercepts Termai core APIs or WebSocket endpoints', () => {
    const reqWs = {
      url: '/ws',
      headers: { referer: 'http://localhost:5180/api/preview/task-123/' },
    } as any;
    assert.equal(extractPreviewInfo(reqWs), null);

    const reqCoreApi = {
      url: '/api/projects',
      headers: { referer: 'http://localhost:5180/api/preview/task-123/' },
    } as any;
    assert.equal(extractPreviewInfo(reqCoreApi), null);
  });

  describe('end-to-end HTML injection & header stripping', () => {
    let mockDevServer: http.Server;
    let proxyAppServer: http.Server;
    let mockDevPort: number;
    let proxyPort: number;
    const testTaskId = 'test-task-proxy';

    before(async () => {
      // 1. Create a mock upstream dev server
      mockDevServer = http.createServer((req, res) => {
        if (req.url?.includes('page.html') || req.url === '/') {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "frame-ancestors 'none'",
          });
          res.end('<!DOCTYPE html><html><head><title>App</title></head><body><h1>Dev App</h1></body></html>');
          return;
        }

        if (req.url === '/style.css') {
          res.writeHead(200, { 'Content-Type': 'text/css' });
          res.end('body { background: red; }');
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });

      await new Promise<void>((resolve) => mockDevServer.listen(0, '127.0.0.1', () => resolve()));
      const devAddr = mockDevServer.address() as any;
      mockDevPort = devAddr.port;

      // Register mock server in devServerManager
      (devServerManager as any).servers.set(testTaskId, {
        proc: null,
        state: {
          taskId: testTaskId,
          status: 'running',
          port: mockDevPort,
          url: `http://localhost:${mockDevPort}`,
          logs: [],
          devCmd: '',
          worktreePath: '',
        },
      });

      // 2. Create Express app with preview proxy middleware
      const app = express();
      app.use(createPreviewProxyMiddleware());
      proxyAppServer = http.createServer(app);
      await new Promise<void>((resolve) => proxyAppServer.listen(0, '127.0.0.1', () => resolve()));
      const proxyAddr = proxyAppServer.address() as any;
      proxyPort = proxyAddr.port;
    });

    after(async () => {
      (devServerManager as any).servers.delete(testTaskId);
      await new Promise((resolve) => mockDevServer.close(resolve));
      await new Promise((resolve) => proxyAppServer.close(resolve));
    });

    it('injects tracker script and strips X-Frame-Options/CSP for HTML responses', async () => {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/api/preview/${testTaskId}/page.html`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-frame-options'), null);
      assert.equal(res.headers.get('content-security-policy'), null);

      const html = await res.text();
      assert.ok(html.includes('__termai_preview_tracker'));
      assert.ok(html.includes('TERMAI_PREVIEW_URL_CHANGED'));
      assert.ok(html.includes('history.pushState'));
      assert.ok(html.includes('Dev App'));
    });

    it('passes non-HTML assets cleanly through proxy without modifying content', async () => {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/api/preview/${testTaskId}/style.css`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'text/css');
      const css = await res.text();
      assert.equal(css, 'body { background: red; }');
    });
  });
});
