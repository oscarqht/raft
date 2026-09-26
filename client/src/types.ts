export interface Project {
  id: string;
  name: string;
  path: string;
  dev_cmd: string;
  dev_port: number;
  build_cmd: string;
  test_cmd: string;
  branch_convention: string;
  default_agent_cli?: string;
  default_model?: string;
  created_at: number;
  updated_at: number;
  task_count?: number;
}

export interface Task {
  id: string;
  project_id: string;
  name: string;
  branch: string;
  base_branch: string;
  worktree_path: string;
  status: 'active' | 'completed' | 'archived';
  created_at: number;
  updated_at: number;
  project?: Project;
}

export interface ChatSession {
  id: string;
  task_id: string;
  title: string;
  agent_cli: string;
  model?: string;
  thinking_effort?: string;
  status: 'idle' | 'running';
  created_at: number;
  updated_at: number;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: string | null;
  timestamp: number;
}

export interface Settings {
  agent_cli: string;
  default_model: string;
  thinking_effort: string;
  theme: 'auto' | 'dark' | 'light';
}

export interface CliInstallGuide {
  title: string;
  command: string;
  commandMac?: string;
  commandWin?: string;
  authGuide: string;
  docsUrl: string;
  description: string;
}

export interface CliInfo {
  name: string;
  path: string;
  available: boolean;
  version?: string;
  installGuide?: CliInstallGuide;
}

export interface ReasoningEffortOption {
  id: string;
  label: string;
  description?: string;
}

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
  reasoningEfforts?: string[];
  reasoningEffortOptions?: ReasoningEffortOption[];
  defaultEffort?: string;
  discoveredFrom?: string;
}

export interface DevServerState {
  taskId: string;
  status: 'stopped' | 'starting' | 'running' | 'error';
  port?: number;
  url?: string;
  logs: string[];
  devCmd: string;
  worktreePath: string;
}

export interface GitStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}
