import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

console.log('--- 1. Building client (Vite SPA) ---');
execSync('npm run build --workspace=client', { cwd: root, stdio: 'inherit' });

console.log('--- 2. Bundling server with esbuild ---');
const resourcesDir = path.join(root, 'resources');
const serverOutDir = path.join(resourcesDir, 'server');
fs.mkdirSync(serverOutDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'server', 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: path.join(serverOutDir, 'index.mjs'),
  external: ['better-sqlite3'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  sourcemap: false,
  minify: true,
});
console.log('✓ Server code bundled to resources/server/index.mjs');

console.log('--- 3. Preparing production node_modules (better-sqlite3) ---');
const destModules = path.join(serverOutDir, 'node_modules');
fs.mkdirSync(destModules, { recursive: true });

const copyPackages = ['better-sqlite3', 'bindings', 'file-uri-to-path'];
for (const pkg of copyPackages) {
  // Check root node_modules and server node_modules
  const candidates = [
    path.join(root, 'node_modules', pkg),
    path.join(root, 'server', 'node_modules', pkg),
  ];
  const src = candidates.find((p) => fs.existsSync(p));
  if (src) {
    const dest = path.join(destModules, pkg);
    fs.cpSync(src, dest, { recursive: true, force: true });
    console.log(`✓ Copied ${pkg} to resources/server/node_modules/`);
  }
}

// Prune build artifacts (.pdb, .iobj, .ipdb, obj/) from better-sqlite3 to save ~30MB
const betterSqliteBuild = path.join(destModules, 'better-sqlite3', 'build', 'Release');
if (fs.existsSync(betterSqliteBuild)) {
  const entries = fs.readdirSync(betterSqliteBuild, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === 'obj') {
      fs.rmSync(path.join(betterSqliteBuild, entry.name), { recursive: true, force: true });
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.pdb') ||
        entry.name.endsWith('.iobj') ||
        entry.name.endsWith('.ipdb') ||
        entry.name.endsWith('.exp') ||
        entry.name.endsWith('.lib'))
    ) {
      fs.unlinkSync(path.join(betterSqliteBuild, entry.name));
    }
  }
  console.log('✓ Pruned non-runtime build symbols from better-sqlite3');
}

// Write minimal package.json with type: module
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(
  path.join(serverOutDir, 'package.json'),
  JSON.stringify({ name: 'raft', version: rootPkg.version || '0.19.0', type: 'module' }, null, 2) + '\n'
);

console.log('--- 4. Staging client SPA into resources/server/client/dist ---');
const clientDistDest = path.join(serverOutDir, 'client', 'dist');
fs.mkdirSync(clientDistDest, { recursive: true });
fs.cpSync(path.join(root, 'client', 'dist'), clientDistDest, { recursive: true, force: true });
console.log('✓ Client dist copied to resources/server/client/dist');

console.log('--- 5. Preparing standalone Node.js sidecar binary ---');
const binDir = path.join(root, 'src-tauri', 'bin');
fs.mkdirSync(binDir, { recursive: true });

// Determine current target triple
let targetTriple = '';
try {
  const rustcV = execSync('rustc -vV', { encoding: 'utf8' });
  const hostMatch = rustcV.match(/host:\s*([^\r\n]+)/);
  if (hostMatch) {
    targetTriple = hostMatch[1].trim();
  }
} catch {
  targetTriple = process.platform === 'win32' ? 'x86_64-pc-windows-msvc' : 'aarch64-apple-darwin';
}

const nodeBinaryName = process.platform === 'win32' ? `node-${targetTriple}.exe` : `node-${targetTriple}`;
const nodeBinaryPath = path.join(binDir, nodeBinaryName);

if (!fs.existsSync(nodeBinaryPath)) {
  console.log(`Staging local Node.js binary as sidecar: ${nodeBinaryName}`);
  fs.copyFileSync(process.execPath, nodeBinaryPath);
  if (process.platform !== 'win32') {
    fs.chmodSync(nodeBinaryPath, 0o755);
  }
  console.log(`✓ Staged Node.js binary at ${nodeBinaryPath}`);
} else {
  console.log(`✓ Sidecar Node binary already present at ${nodeBinaryPath}`);
}

if (process.platform === 'darwin') {
  const entitlementsPath = path.join(root, 'src-tauri', 'Entitlements.plist');
  if (fs.existsSync(entitlementsPath)) {
    try {
      execSync(`codesign --force --options runtime --entitlements "${entitlementsPath}" --sign - "${nodeBinaryPath}"`, {
        stdio: 'inherit',
      });
      console.log(`✓ Signed sidecar Node binary with entitlements: ${nodeBinaryName}`);
    } catch (err) {
      console.warn(`Warning: Failed to sign sidecar Node binary: ${err.message}`);
    }
  }
}

console.log('✓ Server preparation completed successfully!');
