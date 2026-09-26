# Raft 🦦

> A cozy, distraction-free AI coding workspace for local Git repositories with isolated worktrees, multi-agent tab chatting, and live dev preview.

![Raft Banner](https://img.shields.io/badge/Raft-Cozy%20AI%20Coding-38bdf8?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge)
![Vite](https://img.shields.io/badge/Frontend-Vite%20%2B%20React-646cff?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Backend-Node.js%20%2B%20Express-339933?style=for-the-badge)
![SQLite](https://img.shields.io/badge/Database-SQLite%203-003B57?style=for-the-badge)

---

## ✨ Features

- **🦦 Cozy, Non-Overwhelming UX**: Clean visual aesthetic with soft borders, warm dark & light themes, and smooth draggable split panels.
- **🤖 Multi-Agent CLI Support**: First-class support for **`agy`** (Google Antigravity), **`claude`** (Claude Code), and **`codex`** (OpenAI Codex CLI).
- **🌿 Git Worktree Task Isolation**: Every task gets its own clean branch and isolated git worktree under `<projectRoot>/.worktrees/<task-branch>`. Multiple tasks can run in parallel without file collisions or git checkout conflicts.
- **🔍 AI Project Auto-Discovery**: When you add a local Git repository, an autonomous AI agent inspects your repository in real time to detect dev server commands (`npm run dev`), target ports, build commands, test suites, and branch conventions.
- **💬 Concurrent Multi-Chat Tabs**: Open multiple concurrent chat tabs within the same task worktree. Different AI agents (e.g. Claude for UX, Codex/Agy for backend) can work concurrently on the exact same task branch.
- **🔄 Smart Base Sync & Rebase Agent**: Pull the latest changes from `origin/<base-branch>` and rebase your task branch with an autonomous AI agent that detects and resolves merge conflicts cleanly.
- **⚡ Integrated Dev Server Preview & Console**: Start, stop, or restart your local Vite/Webpack/Next dev server directly from the workspace. Features auto-port detection, embedded iframe preview with address bar, external browser link, and a collapsible real-time console log drawer.
- **🚀 One-Click Changes Submission**: Review git diffs and modified files, generate concise commit messages with AI, and let the agent commit and push directly to remote origin.
- **💾 Full Server-Side Persistence**: All projects, tasks, chat histories, messages, and settings are saved in SQLite (`~/.raft/raft.db`) for instant re-hydration across server restarts or page refreshes.

---

## 🛠️ Architecture

```
raft/
├── client/                     # Vite + React 18 + TailwindCSS Frontend
│   ├── src/
│   │   ├── components/         # Cozy UI components
│   │   │   ├── Header.tsx      # Top bar with breadcrumbs, agent pill, theme toggle
│   │   │   ├── DraggableSplit  # Draggable resize divider
│   │   │   ├── ChatPane.tsx    # Multi-tab concurrent chats & model switcher
│   │   │   ├── ChatMessageList # Thought drawers, tool cards, bubbles
│   │   │   ├── PreviewPane.tsx # Dev server iframe preview & console
│   │   │   ├── RebaseDrawer    # Slide-over rebase & conflict resolution agent
│   │   │   ├── SubmitModal.tsx # Git diff viewer & agent commit/push
│   │   │   └── DiscoveryModal  # Real-time repo scanner & config review
│   │   ├── pages/
│   │   │   ├── HomePage.tsx    # Project management & Add Project dialog
│   │   │   ├── ProjectPage.tsx # Project info, task list, Start Task modal
│   │   │   ├── TaskPage.tsx    # Split chat and preview workspace
│   │   │   └── SettingsPage    # CLI agent, model, thinking effort & theme
│   │   ├── api.ts              # REST client and WebSocket helpers
│   │   └── types.ts            # Type definitions
│   └── vite.config.ts          # Proxies /api and /ws to port 3100
│
├── server/                     # Node.js + Express + WebSocket + SQLite Backend
│   ├── src/
│   │   ├── db.ts               # SQLite database in ~/.raft/raft.db
│   │   ├── gitService.ts       # Git worktree lifecycle & diff analysis
│   │   ├── agentRunner.ts      # Multi-CLI agent executor (agy, claude, codex)
│   │   ├── devServerManager.ts # Background dev server process manager
│   │   └── index.ts            # REST endpoints and WebSocket handler (/ws)
│   └── package.json
│
└── package.json                # Workspaces root with concurrent dev scripts
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: v18 or later (v20+ recommended)
- **Git**: Installed and available in PATH
- **AI Agent CLIs**: Any or all of `agy`, `claude`, or `codex` installed in PATH or `~/.local/bin/`.

### 2. Installation
```bash
# Clone or navigate to raft
cd raft

# Install dependencies for root and all workspaces
npm install
```

### 3. Start Development Server
```bash
npm run dev
```
- **Frontend**: http://localhost:5180
- **Backend API & WebSocket**: http://localhost:3100

### 4. Production Build
```bash
npm run build
npm start
```

---

## 💡 Typical Workflow

1. **Configure Agent Preferences**:
   - Go to Settings to choose your default CLI (`agy`, `claude`, or `codex`), select your default model, and configure reasoning effort.
2. **Add a Project**:
   - Click **Add Project** on the Home page and input your local repo directory.
   - Watch the AI agent auto-discover your dev server command, port, build command, and branch conventions.
3. **Start a Task**:
   - Inside your project, click **Start New Task**, pick a base branch (e.g. `main`), and name your task (e.g. `auth-flow`).
   - Raft creates an isolated git worktree at `.worktrees/auth-flow` and checks out the new branch.
4. **Chat & Code**:
   - Chat with the AI agent to explore files, write code, run commands, and execute tests.
   - Open multiple chat tabs concurrently if you want different agents to work on different components simultaneously.
5. **Preview in Real Time**:
   - Click **Start** in the right preview pane to launch your project's local dev server. Navigate routes using the URL bar or inspect server stdout/stderr in the console drawer.
6. **Rebase or Submit**:
   - Click **Rebase** at any time to pull the latest changes from `origin` and resolve conflicts with the agent.
   - Click **Submit** to review the git diff, generate an AI commit message, and push your branch to remote origin.

---

## 📄 License

MIT
