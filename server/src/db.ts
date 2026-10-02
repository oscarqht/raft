import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  process.execArgv.includes('--test') ||
  process.argv.some((arg) => arg.includes('test'));

const RAFT_DIR = path.join(os.homedir(), '.raft');
if (!isTestEnv && !fs.existsSync(RAFT_DIR)) {
  fs.mkdirSync(RAFT_DIR, { recursive: true });
}

const DB_PATH = process.env.RAFT_DB_PATH
  ? process.env.RAFT_DB_PATH
  : isTestEnv
  ? ':memory:'
  : path.join(RAFT_DIR, 'raft.db');

// Seamless migration from legacy .termai if applicable
if (!isTestEnv && DB_PATH !== ':memory:') {
  const LEGACY_DIR = path.join(os.homedir(), '.termai');
  const LEGACY_DB = path.join(LEGACY_DIR, 'termai.db');
  if (!fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB)) {
    try {
      fs.copyFileSync(LEGACY_DB, DB_PATH);
    } catch (err) {
      console.error('Failed to migrate legacy termai database:', err);
    }
  }
}

export const db: DatabaseType = new Database(DB_PATH);


// Initialize database schema
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    dev_cmd TEXT,
    dev_port INTEGER,
    build_cmd TEXT,
    test_cmd TEXT,
    install_cmd TEXT,
    branch_convention TEXT,
    icon TEXT,
    default_agent_cli TEXT,
    default_model TEXT,
    custom_scripts TEXT,
    system_prompt TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    branch TEXT NOT NULL,
    base_branch TEXT NOT NULL,
    worktree_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    agent_cli TEXT NOT NULL,
    model TEXT,
    thinking_effort TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    cli_session_id TEXT,
    cli_session_agent TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_chat_sessions_task ON chat_sessions(task_id);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_session_time ON chat_messages(session_id, timestamp ASC);
  CREATE TABLE IF NOT EXISTS git_accounts (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    username TEXT NOT NULL,
    avatar_url TEXT,
    token TEXT NOT NULL,
    host TEXT NOT NULL DEFAULT 'https://github.com',
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);

  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
`);

// Migrations for existing databases
try {
  db.exec('ALTER TABLE projects ADD COLUMN custom_scripts TEXT');
} catch {
  // column already exists
}
try {
  db.exec('ALTER TABLE projects ADD COLUMN install_cmd TEXT');
} catch {
  // column already exists
}
try {
  db.exec('ALTER TABLE projects ADD COLUMN icon TEXT');
} catch {
  // column already exists
}
try {
  db.exec(`
    UPDATE projects
    SET icon = 'purple-triangle'
    WHERE icon IS NULL OR icon = '' OR icon = '📦' OR icon NOT IN (
      'purple-triangle', 'coral-circle-smile', 'blue-square', 'yellow-diamond-wink', 'green-star',
      'orange-hexagon-angry', 'pink-heart', 'teal-triangle-smile', 'purple-flower', 'blue-capsule-sleep',
      'green-square', 'yellow-star-smile', 'coral-triangle-squint', 'orange-circle', 'purple-pentagon',
      'blue-diamond', 'purple-cloud-smile', 'green-heart', 'coral-hexagon-cross', 'yellow-triangle',
      'pink-flower', 'teal-capsule-wink', 'indigo-square-smile', 'green-circle', 'orange-star-angry'
    )
  `);
} catch {
  // ignore
}
try {
  db.exec('ALTER TABLE projects ADD COLUMN system_prompt TEXT');
} catch {
  // column already exists
}
try {
  db.exec('ALTER TABLE chat_sessions ADD COLUMN cli_session_id TEXT');
} catch {
  // column already exists
}
try {
  db.exec('ALTER TABLE chat_sessions ADD COLUMN cli_session_agent TEXT');
} catch {
  // column already exists
}
try {
  db.exec('ALTER TABLE tasks ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already exists
}

// Ensure default settings exist
const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

export function getSetting<T>(key: string, defaultValue: T): T {
  const row = getSettingStmt.get(key) as { value: string } | undefined;
  if (!row) return defaultValue;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return defaultValue;
  }
}

export function setSetting<T>(key: string, value: T): void {
  setSettingStmt.run(key, JSON.stringify(value));
}

// Initial defaults
if (!getSettingStmt.get('agent_cli')) {
  setSetting('agent_cli', 'codex');
}
if (!getSettingStmt.get('thinking_effort')) {
  setSetting('thinking_effort', 'medium');
}
if (!getSettingStmt.get('theme')) {
  setSetting('theme', 'auto');
}

export interface GitAccountRow {
  id: string;
  provider: 'github' | 'gitlab';
  name: string;
  username: string;
  avatar_url: string | null;
  token: string;
  host: string;
  created_at: number;
}

export function getAllGitAccounts(): Omit<GitAccountRow, 'token'>[] {
  const rows = db.prepare('SELECT id, provider, name, username, avatar_url, host, created_at FROM git_accounts ORDER BY created_at ASC').all() as any[];
  return rows;
}

export function getGitAccountById(id: string): GitAccountRow | undefined {
  return db.prepare('SELECT * FROM git_accounts WHERE id = ?').get(id) as GitAccountRow | undefined;
}

export function insertGitAccount(account: GitAccountRow): void {
  db.prepare(`
    INSERT INTO git_accounts (id, provider, name, username, avatar_url, token, host, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    account.id,
    account.provider,
    account.name,
    account.username,
    account.avatar_url || null,
    account.token,
    account.host || (account.provider === 'github' ? 'https://github.com' : 'https://gitlab.com'),
    account.created_at
  );
}

export function deleteGitAccountById(id: string): boolean {
  const info = db.prepare('DELETE FROM git_accounts WHERE id = ?').run(id);
  return info.changes > 0;
}

export function getGitAccountsWithTokens(): GitAccountRow[] {
  return db.prepare('SELECT id, provider, name, username, avatar_url, token, host, created_at FROM git_accounts ORDER BY created_at ASC').all() as GitAccountRow[];
}

export function findGitAccountForRemote(remoteUrl: string, detectedUsername?: string): GitAccountRow | undefined {
  if (!remoteUrl) return undefined;
  const accounts = getGitAccountsWithTokens();
  if (accounts.length === 0) return undefined;

  let remoteHost = '';
  let remoteUserInUrl = '';
  let remoteOwner = '';

  if (remoteUrl.includes('://')) {
    try {
      const parsed = new URL(remoteUrl);
      remoteHost = parsed.hostname.toLowerCase();
      remoteUserInUrl = parsed.username || '';
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        remoteOwner = pathParts[0];
      }
    } catch {}
  } else if (remoteUrl.includes('@') && remoteUrl.includes(':')) {
    const match = remoteUrl.match(/@([^:]+):([^/]+)/);
    if (match) {
      remoteHost = match[1].toLowerCase();
      remoteOwner = match[2];
    }
  }

  const extractHost = (hostOrUrl: string, defaultHost: string): string => {
    if (!hostOrUrl) return defaultHost;
    try {
      const withProto = hostOrUrl.includes('://') ? hostOrUrl : `https://${hostOrUrl}`;
      return new URL(withProto).hostname.toLowerCase();
    } catch {
      return hostOrUrl.toLowerCase().trim();
    }
  };

  let bestMatch: GitAccountRow | undefined;
  let bestScore = -1;

  for (const account of accounts) {
    if (!account.token) continue;
    const defaultHost = account.provider === 'github' ? 'github.com' : 'gitlab.com';
    const accHost = extractHost(account.host, defaultHost);

    let hostMatches = false;
    if (remoteHost && accHost) {
      hostMatches = remoteHost === accHost || remoteHost.endsWith('.' + accHost) || accHost.endsWith('.' + remoteHost);
    } else if (account.provider === 'github' && remoteUrl.toLowerCase().includes('github.com')) {
      hostMatches = true;
    } else if (account.provider === 'gitlab' && remoteUrl.toLowerCase().includes('gitlab.com')) {
      hostMatches = true;
    }

    if (!hostMatches) continue;

    let score = 10;
    const accUser = account.username?.toLowerCase() || '';

    if (detectedUsername && accUser === detectedUsername.toLowerCase()) {
      score += 100;
    }
    if (remoteUserInUrl && accUser === remoteUserInUrl.toLowerCase()) {
      score += 60;
    }
    if (remoteOwner && accUser === remoteOwner.toLowerCase()) {
      score += 40;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = account;
    }
  }

  // Fallback: If only 1 account exists with a token and remote host matches provider
  if (!bestMatch && accounts.length === 1 && accounts[0].token) {
    const single = accounts[0];
    if (single.provider === 'github' && remoteUrl.toLowerCase().includes('github.com')) {
      return single;
    }
    if (single.provider === 'gitlab' && remoteUrl.toLowerCase().includes('gitlab.com')) {
      return single;
    }
  }

  return bestMatch;
}

export interface SkillRow {
  id: string;
  name: string;
  description: string;
  content: string;
  created_at: number;
  updated_at: number;
}

export function getAllSkills(): SkillRow[] {
  return db.prepare('SELECT id, name, description, content, created_at, updated_at FROM skills ORDER BY name ASC').all() as SkillRow[];
}

export function getSkillById(id: string): SkillRow | undefined {
  return db.prepare('SELECT id, name, description, content, created_at, updated_at FROM skills WHERE id = ?').get(id) as SkillRow | undefined;
}

export function getSkillByName(name: string): SkillRow | undefined {
  return db.prepare('SELECT id, name, description, content, created_at, updated_at FROM skills WHERE lower(name) = lower(?)').get(name) as SkillRow | undefined;
}

export function insertSkill(skill: { id: string; name: string; description?: string; content: string }): SkillRow {
  const now = Date.now();
  db.prepare(`
    INSERT INTO skills (id, name, description, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(skill.id, skill.name, skill.description || '', skill.content, now, now);
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description || '',
    content: skill.content,
    created_at: now,
    updated_at: now,
  };
}

export function updateSkillById(id: string, updates: { name?: string; description?: string; content?: string }): SkillRow | undefined {
  const existing = getSkillById(id);
  if (!existing) return undefined;
  const nextName = updates.name !== undefined ? updates.name : existing.name;
  const nextDesc = updates.description !== undefined ? updates.description : existing.description;
  const nextContent = updates.content !== undefined ? updates.content : existing.content;
  const now = Date.now();
  db.prepare(`
    UPDATE skills SET name = ?, description = ?, content = ?, updated_at = ? WHERE id = ?
  `).run(nextName, nextDesc, nextContent, now, id);
  return {
    ...existing,
    name: nextName,
    description: nextDesc,
    content: nextContent,
    updated_at: now,
  };
}

export function deleteSkillById(id: string): boolean {
  const result = db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  return result.changes > 0;
}

