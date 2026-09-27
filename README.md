# Raft 🦦

> A cozy, distraction-free AI coding workspace for local Git repositories with isolated worktrees, multi-agent tab chatting, and live dev preview.

<p align="center">
  <img src="./assets/banner.jpg" alt="Raft Poster" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Raft-Cozy%20AI%20Coding-38bdf8?style=for-the-badge" alt="Raft" />
  <img src="https://img.shields.io/badge/Desktop-Tauri%20v2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri" />
  <img src="https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Frontend-Vite%20%2B%20React-646cff?style=for-the-badge" alt="Vite" />
  <img src="https://img.shields.io/badge/Backend-Node.js%20%2B%20Express-339933?style=for-the-badge" alt="Node.js" />
  <img src="https://img.shields.io/badge/Database-SQLite%203-003B57?style=for-the-badge" alt="SQLite" />
  <img src="https://img.shields.io/badge/Network-Tailscale%20Integrated-gray?style=for-the-badge" alt="Tailscale" />
</p>

---

## ✨ Features

- **🦦 Cozy, Non-Overwhelming UX**: Clean visual aesthetic with soft squircles, warm dark & light themes, floating island layout, and smooth draggable split panels.
- **🖥️ Native Desktop & Web App**: Packaged with **Tauri v2** for macOS (Apple Silicon) and Windows x64. Features an embedded Node.js sidecar runtime, parent-process watchdog, system tray menu, and in-app auto-updates.
- **🤖 Multi-Agent CLI Support**: First-class support for **`agy`** (Google Antigravity), **`claude`** (Claude Code), and **`codex`** (OpenAI Codex CLI) with configurable thinking/reasoning effort and in-app CLI installer.
- **🌿 Git Worktree Task Isolation**: Every task gets its own clean branch and isolated git worktree under `<projectRoot>/.worktrees/<task-branch>`. Run multiple tasks concurrently without git checkout clashes or dirty workspace states.
- **📸 Live Dev Preview with Screenshot Annotation**: Embedded responsive iframe preview with auto-retry and connection health monitoring. Capture full preview snapshots, mark them up with arrows, shapes, pen strokes, text boxes, and highlights, and attach them straight into the chat for the agent to inspect visual bugs.
- **📎 Rich Chat Attachments**: Drag and drop or browse files and images to attach them directly into task chat conversations with inline thumbnail cards.
- **📁 Flexible Project Onboarding**:
  - **Open Existing**: Built-in visual filesystem browser to select local repositories.
  - **Clone from Remote**: Authenticate GitHub accounts and clone public or private repositories via HTTPS or SSH.
  - **Create New**: Initialize clean new local repositories from scratch with template files and README.
- **⚡ Project Scripts Dock & Terminal**: Configure project scripts (lints, test suites, builds, database commands) and trigger them on-demand into an integrated streaming terminal drawer.
- **🧠 Custom Skills Auto-Discovery**: Automatically discovers and respects agent skills across workspace folders (`.gemini/skills`, `.claude/skills`, `.codex/skills`, `skills/`) and global directories.
- **🌐 Tailscale Remote Mesh Access**: Auto-detects Tailscale CGNAT IP addresses and network status to facilitate accessing your Raft dev workspace across your private Tailnet.
- **💬 Concurrent Multi-Chat Tabs**: Open multiple concurrent chat tabs within the same task worktree. Different AI agents (e.g. Claude for UX, Codex/Agy for backend) can work concurrently on the exact same task branch.
- **🔄 Smart Base Sync & Rebase Agent**: Pull the latest changes from `origin/<base-branch>` and rebase your task branch with an autonomous AI agent that detects and resolves merge conflicts cleanly.
- **🚀 One-Click Changes Submission**: Review git diffs and modified files, generate concise commit messages with AI, and let the agent commit and push directly to remote origin.
- **💾 Full Server-Side Persistence**: All projects, tasks, chat histories, messages, and settings are saved in SQLite (`~/.raft/raft.db`) for instant re-hydration across server restarts or page refreshes.

---

## 🛠️ Architecture

```
raft/
├── client/                           # Vite + React 18 + TailwindCSS Frontend
│   ├── src/
│   │   ├── components/               # Cozy UI components
│   │   │   ├── Header.tsx            # Navigation, breadcrumbs, Tailscale status, theme
│   │   │   ├── DraggableSplit.tsx    # Smooth draggable split panel divider
│   │   │   ├── ChatPane.tsx          # Multi-tab concurrent chats & model switcher
│   │   │   ├── ChatMessageList.tsx   # Thoughts drawer, tool cards, bubbles, attachments
│   │   │   ├── PreviewPane.tsx       # Dev server iframe preview, health check, screenshot
│   │   │   ├── PreviewAnnotationOverlay.tsx # Screenshot canvas markup (arrows, pen, text)
│   │   │   ├── AttachmentModals.tsx  # Image and file attachment previews
│   │   │   ├── ScriptDock.tsx        # Project scripts launcher dock
│   │   │   ├── ScriptTerminalModal.tsx # Streaming script terminal output
│   │   │   ├── AddProjectModal.tsx   # Open folder, clone remote repo, or create new
│   │   │   ├── FileSystemBrowser.tsx # Visual directory explorer
│   │   │   ├── RebaseDrawer.tsx      # Slide-over rebase & conflict resolution agent
│   │   │   └── SubmitModal.tsx       # Git diff viewer & agent commit/push
│   │   ├── pages/
│   │   │   ├── HomePage.tsx          # Project grid & Add Project launcher
│   │   │   ├── ProjectPage.tsx       # Project detail, task list, Start Task dialog
│   │   │   ├── TaskPage.tsx          # Split chat, preview, script dock workspace
│   │   │   └── SettingsPage.tsx      # CLI agents, Git accounts, models & themes
│   │   ├── api.ts                    # REST client and WebSocket helpers
│   │   └── types.ts                  # Shared TypeScript interfaces
│   └── vite.config.ts                # Proxies /api and /ws to port 3100
│
├── server/                           # Node.js + Express + WebSocket + SQLite Backend
│   ├── src/
│   │   ├── db.ts                     # SQLite database in ~/.raft/raft.db
│   │   ├── gitService.ts             # Worktrees, branch operations & diff analysis
│   │   ├── agentRunner.ts            # Multi-CLI agent executor (agy, claude, codex)
│   │   ├── devServerManager.ts       # Background dev server lifecycle & log streaming
│   │   ├── scriptManager.ts          # Project scripts runner & stream manager
│   │   ├── skillService.ts           # Workspace & global skill discovery
│   │   ├── tailscale.ts              # Tailscale CGNAT detection & status
│   │   └── index.ts                  # REST API & WebSocket handler (/ws)
│   └── package.json
│
├── src-tauri/                        # Tauri v2 Desktop Shell (Rust)
│   ├── src/
│   │   ├── lib.rs                    # Tauri app initialization & plugin configuration
│   │   ├── server.rs                 # Node.js sidecar process launcher & lifecycle
│   │   ├── tray.rs                   # System tray menu and window toggling
│   │   └── updater.rs                # In-app background update checker & downloader
│   ├── tauri.conf.json               # Desktop bundle config & updater endpoint
│   └── Cargo.toml
│
├── scripts/                          # Build & Packaging Utilities
│   ├── prepare-server.mjs            # Packages backend server as a bundled sidecar
│   ├── parent-watchdog.cjs           # Process watchdog ensuring clean teardown
│   ├── generate-updater-json.js      # Creates unified updater release manifest
│   └── bump-version.js               # Semver bumping & changelog generation
│
└── package.json                      # Workspace root with concurrent dev & app scripts
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: v18 or later (v20+ recommended)
- **Git**: Installed and available in PATH
- **AI Agent CLIs**: Any or all of `agy`, `claude`, or `codex` installed in PATH or configured in Settings.

### 2. Installation
```bash
# Clone or navigate to raft
git clone https://github.com/oscarqht/termai.git raft
cd raft

# Install dependencies for root and all workspaces
npm install
```

### 3. Running Raft

#### Option A: Web Browser Mode
```bash
npm run dev
```
- **Frontend Web UI**: http://localhost:5180
- **Backend API & WebSocket**: http://localhost:3100

#### Option B: Native Desktop Mode (Tauri)
```bash
# Launches native desktop app with embedded sidecar server
npm run app:dev
```

---

## 💡 Typical Workflow

1. **Configure Agent Preferences & Git Accounts**:
   - Go to **Settings** to choose your default CLI (`agy`, `claude`, or `codex`), reasoning effort, and connect GitHub accounts.
2. **Add a Project**:
   - Click **Add Project** to open a local folder, clone a remote GitHub/GitLab repo, or create a new repo.
   - Raft's discovery agent auto-detects dev server commands, ports, build commands, and branch conventions.
3. **Start an Isolated Task**:
   - Click **Start New Task**, select a base branch (e.g. `main`), and name your task (e.g. `feature-auth`).
   - Raft creates an isolated git worktree at `.worktrees/feature-auth` and checks out the new branch.
4. **Chat, Attach & Code**:
   - Chat with the AI agent to explore files, write code, run commands, and execute tests.
   - Drag and drop mockups, screenshots, or logs into chat as attachments.
   - Open multiple concurrent chat tabs for multi-agent workflows.
5. **Live Preview & Visual Annotations**:
   - Launch your project's dev server directly in the preview pane.
   - Click the camera icon to take a snapshot, draw annotations (arrows, boxes, text notes) over UI bugs, and attach them straight into the chat prompt.
6. **Execute Project Scripts**:
   - Use the **Script Dock** to run builds, test suites, or lints with real-time log output in the terminal drawer.
7. **Rebase or Submit**:
   - Click **Rebase** at any time to pull the latest changes from `origin` and resolve conflicts with the AI agent.
   - Click **Submit** to review the git diff, generate an AI commit message, and push your branch to remote origin.

---

## 🖥️ Desktop Application & Release Setup

### Local Desktop Development
```bash
# Run desktop app in development mode (with server sidecar)
npm run app:dev

# Build desktop release packages locally
npm run app:build
```

### GitHub Actions Release & Signing Keys

The release workflow (`.github/workflows/release.yml`) builds cross-platform packages (macOS & Windows) and signs update artifacts using Tauri's updater.

#### Generating a New Signing Key Pair

If you need to configure or rotate `TAURI_SIGNING_PRIVATE_KEY`:

1. Run the Tauri signer CLI without a password:
   ```bash
   npm run tauri signer generate -- -p ""
   ```
   > Passing `-p ""` creates an unencrypted private key, removing the need to supply an extra `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret.

2. **Update Public Key**:
   Copy the generated public key into `src-tauri/tauri.conf.json`:
   ```json
   "plugins": {
     "updater": {
       "endpoints": [
         "https://github.com/oscarqht/termai/releases/latest/download/latest.json"
       ],
       "pubkey": "<YOUR_NEW_PUBLIC_KEY>"
     }
   }
   ```
   Commit and push `src-tauri/tauri.conf.json`.

3. **Configure GitHub Repository Secrets**:
   Go to your GitHub repository:
   **Settings** > **Secrets and variables** > **Actions** > **New repository secret**
   - **`TAURI_SIGNING_PRIVATE_KEY`**: Paste the full private key output.
   - **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`**: (Optional) The password if your private key was created with one. If you passed `-p ""` when generating, leave unset.
   - **`GH_TOKEN`** (Optional): A Personal Access Token with `repo` scope if default `GITHUB_TOKEN` permissions are restricted.

---

## 📄 License

MIT
