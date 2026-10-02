/**
 * Real PreviewPane browser fixture, with fake task APIs and three local preview apps.
 * Run after `npm run build --workspace=client`: node scripts/preview-extension-fixture.mjs
 * No project database, user task, or dev-server process is touched.
 */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { createServer as createViteServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Vite resolves imports to real paths; its root must match on macOS (/var -> /private/var).
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alpha-bro-preview-fixture-')));
const servers = [];
const attachments = new Map();
const statuses = new Map();
const assetsPath = path.join(root, 'client/dist/assets');
let shuttingDown = false;
let vite;
let hmrRevision = 0;
const hmrRoot = path.join(temp, 'hmr-app');
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await vite?.close();
  await Promise.all(servers.map(server => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  })));
  await fs.rm(temp, { recursive: true, force: true });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void shutdown().then(() => process.exit(0)));

const entry = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewPane } from './src/components/PreviewPane';
window.fixtureAttachments = [];
function App() {
  const [taskId, setTaskId] = useState('task-a');
  const [unrestricted, setUnrestricted] = useState(false);
  const [hmr, setHmr] = useState(false);
  const [hmrStatus, setHmrStatus] = useState('');
  const [attachmentStatus, setAttachmentStatus] = useState('No screenshot attached');
  const [wideChat, setWideChat] = useState(false);
  const id = taskId + (hmr ? '-hmr' : unrestricted ? '-unrestricted' : '');
  const task = { id, project_id: 'fixture-project', name: taskId, branch: taskId, base_branch: 'main',
    worktree_path: '/fixture/' + id, status: 'active', created_at: 0, updated_at: 0 };
  return <div style={{height:'100vh', display:'flex', flexDirection:'column'}}>
    <header style={{padding:'10px 14px', display:'flex', flexWrap:'wrap', gap:12, alignItems:'center', borderBottom:'1px solid #cbd5e1', background:'#f8fafc'}}>
      <strong>Alpha Bro Preview Fixture</strong>
      <button data-testid="switch-task" onClick={() => setTaskId(taskId === 'task-a' ? 'task-b' : 'task-a')}>Switch task</button>
      <button data-testid="toggle-framing" onClick={() => { setHmr(false); setUnrestricted(!unrestricted); }}>{unrestricted ? 'Use restricted app' : 'Use unrestricted app'}</button>
      <button data-testid="toggle-hmr" onClick={() => { setHmr(!hmr); setUnrestricted(false); }}>{hmr ? 'Use restricted app' : 'Use HMR app'}</button>
      <button data-testid="trigger-hmr" disabled={!hmr} onClick={async () => {
        try {
          const response = await fetch('/fixture/hmr', { method:'POST' });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          setHmrStatus('Requested HMR revision ' + result.revision);
        } catch (error) { setHmrStatus(String(error)); }
      }}>Trigger HMR</button>
      <span role="status" data-testid="hmr-status">{hmrStatus}</span>
      <button data-testid="resize-panel" onClick={() => setWideChat(!wideChat)}>Resize chat</button>
      <span data-testid="current-task">{id} · {hmr ? 'Vite HMR :4413' : unrestricted ? 'unrestricted :4412' : 'XFO + CSP :4411'}</span>
    </header>
    <div style={{display:'flex', minHeight:0, flex:1}}>
      <aside style={{width:wideChat ? 430 : 270, flexShrink:0, padding:20, background:'#eff6ff', borderRight:'1px solid #cbd5e1'}}>
        <h2 style={{fontWeight:700}}>Chat stays beside preview</h2>
        <p style={{marginTop:12}}>This panel mounts the actual PreviewPane and screenshot annotation editor.</p>
        <textarea aria-label="Fixture chat draft" defaultValue="Chat draft stays here while capturing." style={{width:'100%',marginTop:20,padding:8,minHeight:100}} />
        <p role="status" data-testid="attachment-status" style={{marginTop:20,overflowWrap:'anywhere'}}>{attachmentStatus}</p>
      </aside>
      <PreviewPane task={task} ws={null} onAttachToChat={(files,url) => {
        window.fixtureAttachments.push({ taskId:id, files, url });
        setAttachmentStatus('Attached ' + files.length + ' screenshot(s) for ' + id + ' at ' + url);
      }} />
    </div>
  </div>;
}
createRoot(document.getElementById('root')).render(<App />);
`;

function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.zip': 'application/zip', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' };
async function serveFile(res, base, requested) {
  const file = path.resolve(base, requested);
  if (!file.startsWith(path.resolve(base) + path.sep)) return json(res, { error: 'Invalid file path' }, 400);
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { json(res, { error: 'File not found' }, 404); }
}
function state(taskId) {
  const port = taskId.endsWith('-hmr') ? 4413 : taskId.endsWith('-unrestricted') ? 4412 : 4411;
  return { taskId, status: statuses.get(taskId) || 'running', port, url: 'http://localhost:' + port,
    logs: ['Fixture dev server ready at http://localhost:' + port + '\n'], devCmd: 'fixture', worktreePath: '/fixture/' + taskId };
}

const previewPage = `<!doctype html><html><head><meta charset="utf-8"><title>Companion preview fixture</title>
<style>*{box-sizing:border-box}body{margin:0;font:16px system-ui;background:#f1f5f9;color:#0f172a}header{padding:28px;background:#0f766e;color:white}main{padding:28px;max-width:1000px;margin:auto}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0}.card{min-height:120px;padding:20px;border-radius:16px;background:white;box-shadow:0 2px 8px #0f172a12}button,a{display:inline-block;margin:5px 8px 5px 0;padding:10px 14px;background:#fff;color:#115e59;border:1px solid #94a3b8;border-radius:8px;cursor:pointer}input{padding:12px;border:1px solid #94a3b8;border-radius:8px;width:100%;max-width:430px}dialog{border:0;border-radius:18px;padding:28px;box-shadow:0 20px 90px #0006}dialog::backdrop{background:#0f172a66}#route{font:14px monospace;background:#ccfbf1;padding:12px;border-radius:8px}.bottom{margin-top:400px;border-top:4px solid #ea580c;padding:24px}h1{margin:0 0 8px}</style></head>
<body><header><h1>Local preview, live state</h1><span id="framing-label"></span></header><main>
<p id="route"></p><label>Unsaved input <input id="draft" aria-label="Unsaved preview input" placeholder="Type something to prove current state is captured"></label>
<div class="cards"><div class="card" style="border-top:5px solid #14b8a6">Teal card<br><strong>128 active</strong></div><div class="card" style="border-top:5px solid #6366f1">Indigo card<br><strong>42 changes</strong></div><div class="card" style="border-top:5px solid #f97316">Orange card<br><strong>7 reviews</strong></div></div>
<button id="open-modal">Open modal</button><a href="/second">Full navigation /second</a><a href="/redirect">Redirect /second</a>
<button id="push">SPA push /spa</button><button id="replace">Replace /replaced</button><button id="hash">Set hash</button><button id="back">Page back</button><button id="forward">Page forward</button>
<dialog id="modal"><h2>Current preview modal</h2><p>This modal and your unsaved input must appear in the screenshot.</p><button id="close-modal">Close modal</button></dialog>
<div class="bottom">Scrollable footer: screenshot should capture the visible viewport.</div></main>
<script>
const route = document.getElementById('route');
const update = () => { route.textContent = location.pathname + location.search + location.hash; };
document.getElementById('framing-label').textContent = location.port === '4411' ? 'Restricted app: X-Frame-Options DENY + CSP frame-ancestors none' : 'Unrestricted baseline app';
document.getElementById('open-modal').onclick = () => document.getElementById('modal').showModal();
document.getElementById('close-modal').onclick = () => document.getElementById('modal').close();
document.getElementById('push').onclick = () => { history.pushState({}, '', '/spa'); update(); };
document.getElementById('replace').onclick = () => { history.replaceState({}, '', '/replaced'); update(); };
document.getElementById('hash').onclick = () => { location.hash = 'details'; update(); };
document.getElementById('back').onclick = () => history.back();
document.getElementById('forward').onclick = () => history.forward();
addEventListener('popstate',update);addEventListener('hashchange',update);update();
</script></body></html>`;

const hmrHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Direct Vite HMR fixture</title>
<style>body{font:18px system-ui;background:#eff6ff;color:#0f172a;margin:0;padding:40px}main{max-width:720px;padding:32px;background:white;border-radius:20px;border-top:8px solid #0f766e}#hmr-marker{font-size:28px;color:#0f766e;font-weight:700}input{display:block;width:90%;margin-top:18px;padding:12px;border:1px solid #94a3b8;border-radius:8px}</style></head><body><main>
<h1>Direct Vite WebSocket HMR</h1><p id="hmr-marker">Waiting for module</p><p id="boot-count"></p><p id="document-id"></p>
<label>Preserved input<input aria-label="HMR preserved input" placeholder="Type before triggering HMR"></label>
<p>This app is served directly by Vite on port 4413 with XFO DENY and CSP frame-ancestors none.</p></main>
<script>
window.hmrBootCount = Number(sessionStorage.getItem('fixture-hmr-boots') || 0) + 1;
sessionStorage.setItem('fixture-hmr-boots', String(window.hmrBootCount));
window.hmrDocumentId = crypto.randomUUID();
window.hmrUpdateCount = 0;
document.getElementById('boot-count').textContent = 'Document boot count: ' + window.hmrBootCount;
document.getElementById('document-id').textContent = 'Document ID: ' + window.hmrDocumentId;
</script><script type="module" src="/main.js"></script></body></html>`;
function hmrModule(revision) {
  return `export const revision = ${revision};
export function render() {
  document.getElementById('hmr-marker').textContent = 'HMR revision ' + revision;
  window.hmrRevision = revision;
}
render();
if (import.meta.hot) import.meta.hot.accept(next => {
  window.hmrUpdateCount += 1;
  next?.render();
});
`;
}

async function listen(port, handler) {
  const server = http.createServer((req, res) => void Promise.resolve(handler(req, res)).catch(error => {
    console.error(error);
    if (!res.headersSent) json(res, { error: error.message }, 500);
    else res.destroy(error);
  }));
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

try {
  const css = (await fs.readdir(assetsPath)).filter(name => /^index.*\.css$/.test(name));
  if (!css.length) throw new Error('Build the client first: npm run build --workspace=client');
  await build({ stdin: { contents: entry, resolveDir: path.join(root, 'client'), sourcefile: 'fixture.tsx', loader: 'tsx' },
    bundle: true, format: 'esm', splitting: true, outdir: temp, entryNames: 'fixture', jsx: 'automatic',
    define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' },
    loader: { '.svg': 'file', '.png': 'file', '.woff': 'file', '.woff2': 'file', '.ttf': 'file' }, logLevel: 'warning' });
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Alpha Bro Preview Fixture</title>' +
    css.map(name => '<link rel="stylesheet" href="/assets/' + name + '">').join('') +
    '<link rel="stylesheet" href="/bundle/fixture.css"><style>body{margin:0}header button{border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;background:white}</style></head><body><div id="root"></div><script type="module" src="/bundle/fixture.js"></script></body></html>';
  await fs.mkdir(hmrRoot);
  await fs.writeFile(path.join(hmrRoot, 'index.html'), hmrHtml);
  await fs.writeFile(path.join(hmrRoot, 'main.js'), hmrModule(hmrRevision));
  vite = await createViteServer({ root: hmrRoot, configFile: false, logLevel: 'warn',
    server: { host: '127.0.0.1', port: 4413, strictPort: true,
      headers: { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" } } });
  await vite.listen();
  await listen(4410, async (req, res) => {
    const url = new URL(req.url, 'http://localhost:4410');
    if (url.pathname === '/unregistered') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      return res.end('<!doctype html><html><head><title>Unregistered preview tab</title></head><body><h1>Unregistered tab: this iframe must remain blocked</h1><p>No Alpha Bro preview session is registered in this tab.</p><iframe title="Unregistered restricted preview" src="http://localhost:4411" style="width:90vw;height:75vh"></iframe></body></html>');
    }
    if (url.pathname === '/fixture/hmr' && req.method === 'POST') {
      hmrRevision += 1;
      await fs.writeFile(path.join(hmrRoot, 'main.js'), hmrModule(hmrRevision));
      return json(res, { revision: hmrRevision });
    }
    const match = url.pathname.match(/^\/api\/tasks\/([^/]+)\/dev-server(?:\/(ping|start|stop|restart))?$/);
    if (match) {
      const [, taskId, action] = match;
      if (action === 'stop') { const wasRunning = state(taskId).status === 'running'; statuses.set(taskId, 'stopped'); return json(res, { success: true, wasRunning }); }
      if (action === 'start' || action === 'restart') statuses.set(taskId, 'running');
      const current = state(taskId);
      return json(res, action === 'ping' ? { ready: current.status === 'running', port: current.port, url: current.url } : current);
    }
    if (/^\/api\/tasks\/[^/]+\/attachments$/.test(url.pathname) && req.method === 'POST') {
      const request = new Request(url, { method: 'POST', headers: req.headers, body: req, duplex: 'half' });
      const form = await request.formData();
      const files = [];
      for (const file of form.getAll('files')) {
        if (typeof file === 'string') continue;
        const id = randomUUID();
        attachments.set(id, { type: file.type, data: Buffer.from(await file.arrayBuffer()) });
        files.push({ id, name: file.name, size: file.size, type: file.type, path: '/fixture-attachments/' + id, url: '/fixture-attachments/' + id });
      }
      return json(res, files);
    }
    if (url.pathname.startsWith('/fixture-attachments/')) {
      const file = attachments.get(url.pathname.split('/').at(-1));
      if (!file) return json(res, { error: 'Missing attachment' }, 404);
      res.writeHead(200, { 'Content-Type': file.type }); return res.end(file.data);
    }
    if (url.pathname.startsWith('/bundle/')) return serveFile(res, temp, url.pathname.slice(8));
    if (url.pathname.startsWith('/assets/')) return serveFile(res, assetsPath, url.pathname.slice(8));
    if (url.pathname.startsWith('/extension/')) return serveFile(res, path.join(root, 'client/public/extension'), url.pathname.slice(11));
    if (url.pathname.startsWith('/api/')) return json(res, { error: 'Unknown fixture endpoint' }, 404);
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(html);
  });
  for (const port of [4411, 4412]) await listen(port, (req, res) => {
    const url = new URL(req.url, 'http://localhost:' + port);
    if (url.pathname === '/redirect') { res.writeHead(302, { Location: '/second' }); return res.end(); }
    const headers = { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' };
    if (port === 4411 && url.pathname !== '/unrestricted') {
      headers['X-Frame-Options'] = 'DENY';
      headers['Content-Security-Policy'] = "frame-ancestors 'none'";
    }
    res.writeHead(200, headers); res.end(previewPage);
  });
  console.log('Preview fixture ready: http://localhost:4410');
  console.log('Restricted dev app: http://localhost:4411 | Unrestricted dev app: http://localhost:4412 | Vite HMR: http://localhost:4413');
  console.log('Unregistered isolation check: http://localhost:4410/unregistered');
  console.log('Use the top controls to switch tasks, framing mode, or panel width. Ctrl+C cleans temporary bundles.');
} catch (error) {
  await shutdown();
  console.error(error);
  process.exitCode = 1;
}
