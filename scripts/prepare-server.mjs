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
// Verify better-sqlite3 native binary compatibility with the Node version we are bundling/staging
try {
  // require() alone does not load the native addon; opening a database does
  execSync(`"${process.execPath}" -e "new (require('better-sqlite3'))(':memory:').close()"`, { cwd: root, stdio: 'pipe' });
  console.log(`✓ better-sqlite3 native addon is compatible with Node.js ${process.version}`);
} catch (err) {
  console.log(`⚠️ better-sqlite3 is incompatible with current Node.js ${process.version}. Rebuilding native addon...`);
  execSync('npm rebuild better-sqlite3', { cwd: root, stdio: 'inherit' });
  console.log(`✓ Successfully rebuilt better-sqlite3 for Node.js ${process.version}`);
}

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

// Determine target prebuild binary for current host/target
const isMusl = process.platform === 'linux' && (!process.report?.getReport || !process.report.getReport().header?.glibcVersionRuntime);
const targetPrebuild = `${isMusl ? 'linuxmusl' : process.platform}-${process.arch}.node`;

const betterSqlitePrebuilds = path.join(destModules, 'better-sqlite3', 'prebuilds');
const betterSqliteBuild = path.join(destModules, 'better-sqlite3', 'build', 'Release');
const betterSqliteBuiltFile = path.join(betterSqliteBuild, 'better_sqlite3.node');

if (fs.existsSync(betterSqliteBuiltFile)) {
  fs.mkdirSync(betterSqlitePrebuilds, { recursive: true });
  fs.copyFileSync(betterSqliteBuiltFile, path.join(betterSqlitePrebuilds, targetPrebuild));
  console.log(`✓ Synchronized rebuilt better_sqlite3.node to prebuilds/${targetPrebuild}`);
}

// Prune all other prebuilds so linuxdeploy won't encounter foreign or musl libc dependencies
if (fs.existsSync(betterSqlitePrebuilds)) {
  const entries = fs.readdirSync(betterSqlitePrebuilds);
  for (const entry of entries) {
    if (entry !== targetPrebuild) {
      fs.unlinkSync(path.join(betterSqlitePrebuilds, entry));
    }
  }
  console.log(`✓ Pruned non-target prebuilds from better-sqlite3 (kept ${targetPrebuild})`);
}

// Prune build/ directory if present to save ~30MB
const betterSqliteBuildDir = path.join(destModules, 'better-sqlite3', 'build');
if (fs.existsSync(betterSqliteBuildDir)) {
  fs.rmSync(betterSqliteBuildDir, { recursive: true, force: true });
  console.log('✓ Pruned better-sqlite3 build/ directory');
}

// Prune unneeded source and doc directories (deps/ contains ~10MB sqlite3 C source code)
for (const dirName of ['deps', 'src', 'docs']) {
  const dirPath = path.join(destModules, 'better-sqlite3', dirName);
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    console.log(`✓ Pruned ${dirName}/ from better-sqlite3`);
  }
}

// Clean stale bundler staging caches in target to ensure fresh packaging
for (const targetSub of ['release', 'debug']) {
  const staleUp = path.join(root, 'src-tauri', 'target', targetSub, '_up_');
  if (fs.existsSync(staleUp)) {
    fs.rmSync(staleUp, { recursive: true, force: true });
  }
}

// Sync to Tauri debug target cache if present so dev builds pick up updated native modules immediately
const debugTargetModules = path.join(root, 'src-tauri', 'target', 'debug', '_up_', 'resources', 'server', 'node_modules');
if (fs.existsSync(path.dirname(debugTargetModules))) {
  fs.cpSync(destModules, debugTargetModules, { recursive: true, force: true });
  console.log('✓ Synced production node_modules to src-tauri debug target cache');
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

let shouldStage = !fs.existsSync(nodeBinaryPath);
if (!shouldStage) {
  try {
    const existingVer = execSync(`"${nodeBinaryPath}" -v`, { encoding: 'utf8' }).trim();
    if (existingVer !== process.version) {
      console.log(`Sidecar Node binary version mismatch: present=${existingVer}, expected=${process.version}. Re-staging...`);
      shouldStage = true;
    }
  } catch {
    shouldStage = true;
  }
}

if (shouldStage) {
  console.log(`Staging local Node.js binary (${process.version}) as sidecar: ${nodeBinaryName}`);
  fs.copyFileSync(process.execPath, nodeBinaryPath);
  if (process.platform !== 'win32') {
    fs.chmodSync(nodeBinaryPath, 0o755);
  }
  console.log(`✓ Staged Node.js binary at ${nodeBinaryPath}`);
} else {
  console.log(`✓ Sidecar Node binary (${process.version}) already present at ${nodeBinaryPath}`);
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
