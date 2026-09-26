import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const RAFT_DIR = path.join(os.homedir(), '.raft');
if (!fs.existsSync(RAFT_DIR)) {
  fs.mkdirSync(RAFT_DIR, { recursive: true });
}

const DB_PATH = path.join(RAFT_DIR, 'raft.db');

// Seamless migration from legacy .termai if applicable
const LEGACY_DIR = path.join(os.homedir(), '.termai');
const LEGACY_DB = path.join(LEGACY_DIR, 'termai.db');
if (!fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB)) {
  try {
    fs.copyFileSync(LEGACY_DB, DB_PATH);
  } catch (err) {
    console.error('Failed to migrate legacy termai database:', err);
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
    branch_convention TEXT,
    default_agent_cli TEXT,
    default_model TEXT,
    custom_scripts TEXT,
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

  CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_chat_sessions_task ON chat_sessions(task_id);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
`);

// Migrations for existing databases
try {
  db.exec('ALTER TABLE projects ADD COLUMN custom_scripts TEXT');
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

