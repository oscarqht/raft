export interface ProjectCustomScript {
  id: string;
  name: string;
  command: string;
}

export type ScriptExecutionStatus = 'running' | 'completed' | 'failed' | 'canceled';

export interface ScriptExecutionItem {
  id: string;
  taskId: string;
  projectId: string;
  scriptName: string;
  command: string;
  worktreePath?: string;
  status: ScriptExecutionStatus;
  output: string;
  exitCode: number | null;
  startedAt: number;
  finishedAt: number | null;
  cancelRequested?: boolean;
  isCanceling?: boolean;
  isModalOpen?: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  dev_cmd: string;
  dev_port: number;
  build_cmd: string;
  test_cmd: string;
  install_cmd?: string;
  branch_convention: string;
  icon?: string;
  default_agent_cli?: string;
  default_model?: string;
  custom_scripts?: ProjectCustomScript[];
  system_prompt?: string;
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
  cli_session_id?: string;
  cli_session_agent?: string;
  created_at: number;
  updated_at: number;
}

export interface FileAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  path: string;
  url: string;
}

export interface AgentStep {
  id: string;
  type: 'tool' | 'thought';
  toolName?: string;
  category: 'command' | 'file_read' | 'file_write' | 'search' | 'browser' | 'other';
  title: string;
  detail?: string;
  status: 'running' | 'completed' | 'failed';
  duration?: number;
  output?: string;
  error?: string;
  thought?: string;
  startTime?: number;
  endTime?: number;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: string | null;
  attachments?: FileAttachment[];
  timestamp: number;
  steps?: AgentStep[];
}

export interface Settings {
  agent_cli: string;
  default_model: string;
  thinking_effort: string;
  theme: 'auto' | 'dark' | 'light';
  tailscale_https_url?: string | null;
  alpha_intelligence_api_url?: string;
  alpha_intelligence_api_key?: string;
  alpha_intelligence_email?: string;
}

export interface AlphaDeviceStatus {
  connected: boolean;
  status: 'disconnected' | 'connecting' | 'pairing' | 'needs_auth' | 'connected' | 'error';
  loginUrl?: string;
  clientId?: string;
  clientName?: string;
  userEmail?: string;
  error?: string;
}

export interface AlphaStatusResponse {
  configured: boolean;
  apiUrl: string;
  device: AlphaDeviceStatus;
}

export interface AlphaHitlPayload {
  state: string;
  callback_url: string;
  timeout?: number;
  expires_at?: number;
  widget?: {
    title?: string;
    description?: string;
    elements?: Array<any>;
  };
  sessionId?: string;
  messageId?: string;
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
  isCloudProvider?: boolean;
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
  proxyPort?: number;
  url?: string;
  proxyUrl?: string;
  logs: string[];
  devCmd: string;
  worktreePath: string;
}

export interface GitCommitItem {
  hash: string;
  message: string;
}

export interface TaskPrInfo {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'merged' | 'closed';
  mergedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface TaskGitStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  hasLocalChanges?: boolean;
  unpushedCount?: number;
  unpushedCommits?: GitCommitItem[];
  behindCount?: number;
  aheadCount?: number;
  isMerged?: boolean;
  pr?: TaskPrInfo | null;
  createPrUrl?: string | null;
  baseBranch?: string;
  branch?: string;
  lifecycleStage?: 'in_progress' | 'pr_open' | 'merged' | 'clean';
  remoteUrl?: string;
  checkedAt?: number;
}

export type GitStatus = TaskGitStatus;

export interface FSItem {
  name: string;
  path: string;
  isRepo: boolean;
}

export interface FSShortcut {
  name: string;
  path: string;
}

export interface FSResponse {
  path: string;
  isRepo: boolean;
  folders: FSItem[];
  parent: string | null;
  drives?: string[];
  shortcuts?: FSShortcut[];
}

export interface SelectionMeta {
  isRepo: boolean;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  created_at?: number;
  updated_at?: number;
  source?: 'workspace' | 'global' | 'built-in' | 'custom';
  cli?: string;
  filePath?: string;
}

export interface SkillInstallSummaryItem {
  id: string;
  name: string;
  description: string;
  overwritten: boolean;
}

export interface GitAccount {
  id: string;
  provider: 'github' | 'gitlab';
  name: string;
  username: string;
  avatar_url?: string | null;
  host: string;
  created_at: number;
}

export interface RemoteRepoItem {
  name: string;
  fullName: string;
  cloneUrl: string;
  sshUrl?: string;
  isPrivate: boolean;
  description?: string;
  updatedAt?: string;
}

export interface VerifyGitAccountResult {
  valid: boolean;
  username: string;
  name: string;
  avatarUrl?: string | null;
  provider: 'github' | 'gitlab';
  host: string;
  error?: string;
}

export interface AgentRateWindow {
  usedPercent: number;
  remainingPercent: number;
  windowMinutes?: number | null;
  resetsAt?: string | null;
  resetDescription?: string | null;
}

export interface AgentQuotaBucket {
  id: string;
  name: string;
  remainingFraction: number;
  usedPercent: number;
  remainingPercent: number;
  resetTime?: string | null;
  resetDescription?: string | null;
  groupName?: string;
}

export interface AgentCostLimit {
  limit?: number | null;
  used?: number | null;
  remaining?: number | null;
  usedPercent?: number | null;
  remainingPercent?: number | null;
  currency?: string | null;
  period?: string | null;
  resetsAt?: string | null;
  resetDescription?: string | null;
}

export interface AgentUsageSnapshot {
  cli: string;
  providerName: string;
  accountEmail?: string | null;
  accountPlan?: string | null;
  organization?: string | null;
  statusMessage?: string | null;
  primaryWindow?: AgentRateWindow | null;
  secondaryWindow?: AgentRateWindow | null;
  buckets?: AgentQuotaBucket[];
  costLimit?: AgentCostLimit | null;
  updatedAt: number;
  isAvailable: boolean;
  error?: string | null;
}

export type UpdateStatus =
  | { status: 'Idle' }
  | { status: 'Checking' }
  | { status: 'UpToDate'; data: { current_version: string } }
  | {
      status: 'Downloading';
      data: {
        version: string;
        current_version: string;
        body?: string | null;
        downloaded: number;
        total?: number | null;
        percent: number;
      };
    }
  | {
      status: 'Downloaded';
      data: {
        version: string;
        current_version: string;
        body?: string | null;
      };
    }
  | { status: 'Error'; data: { message: string } };

export interface UpdaterStatusResponse {
  current_version: string;
  status: UpdateStatus;
}

