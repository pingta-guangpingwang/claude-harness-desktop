# Claude Harness Desktop

<p align="center">
  <strong>A Visual Multi-Project Cockpit for Claude Code</strong><br>
  <em>Manage multiple Claude Code projects from a desktop GUI — finally, a dashboard for your AI development fleet.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-Compatible-purple" alt="Claude Code">
  <img src="https://img.shields.io/badge/Electron-28-blue" alt="Electron 28">
  <img src="https://img.shields.io/badge/React-19-61dafb" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178c6" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
</p>

> **Why CLI-only?** Every Claude Code tool today runs in a terminal. Claude Harness Desktop gives you a **visual cockpit**: manage 10+ projects, watch AI agents work in real-time, and orchestrate them all from one GUI.

---

## What It Does

- **Multi-Project Farm** — Run and monitor multiple Claude Code sessions across different projects simultaneously
- **Visual Dashboard** — See all your AI agents' status, progress, and output in one place
- **PTY Terminal Pool** — Built-in terminal management for each project
- **Plugin Store** — One-click install real npm/pip tools (Prettier, ESLint, tsc, etc.) — auto-registered as AI-callable tools
- **Visual Workflow Editor** — Drag-and-drop canvas to build automation pipelines (14 node types: CLI, AI call, file ops, conditions, loops...)
- **Harness Agent** — An AI project manager that delegates tasks to individual project AIs (13 built-in tools + dynamic plugin tools)
- **Role & Identity System** — XP-based skill progression, role synthesis, one-click role switching
- **System Tray** — Runs in background, summon with global hotkey (`Ctrl+Shift+H`)
- **i18n** — English and Chinese

## Quick Start

```bash
# Clone
git clone https://github.com/<your-username>/claude-harness-desktop.git
cd claude-harness-desktop

# Install & run
npm install
npm run dev-electron
```

**Requirements:** Node.js 22+, npm

## Features In Detail

### Harness Agent (AI Project Manager)

A meta-AI that manages your project AIs. It delegates tasks, monitors progress, and orchestrates multi-project workflows — so you don't have to switch between terminals.

**13 built-in tools:** `wake_projects`, `stop_projects`, `check_status`, `broadcast`, `task_project`, `read_project_chat`, `health_report`, `queue_status`, `add_follow_up`, `read_file`, `write_file`, `shell_exec`

**Plugin tools auto-register** on install — the Agent discovers and uses them automatically.

### Plugin Store

20+ curated plugins with **real npm/pip installation**:

| Category | Plugins |
|----------|---------|
| Formatters | Prettier, Biome |
| Linters | ESLint, Stylelint, Markdownlint |
| Type Checkers | TypeScript, Pyright |
| Package Managers | pnpm, yarn |
| Git | commitlint, commitizen, git-split |
| Containers | Docker CLI, Docker Compose |
| API | HTTP Server, Mock Server |
| Database | Prisma, SQLFluff |
| Productivity | tree, rimraf, cpx, http-server |
| AI Tools | changelog generation, dependency audit, license check |

### Visual Workflow Editor

Build automation pipelines by dragging nodes on a canvas:

```
[File Watch] → [CLI Command] → [AI Call] → [Condition] → [Notify]
```

14 node types: CLI, AI, File Read/Write, Condition, Loop, Parallel, Cron Trigger, Webhook, and more.

### Role System

Your actions earn XP, XP unlocks roles and specializations. Switch roles to get tailored command recommendations, themes, and layouts.

## Architecture

```
Electron 28 Main Process (56 modules)
├── Window Manager        Multi-window lifecycle
├── System Tray           Background resident
├── Global Hotkeys        Ctrl+Shift+H summon
├── Harness Agent          AI project manager (DeepSeek LLM)
├── Plugin Manager        npm/pip install + shim registration
├── CLI Command System    Registry, aliases, batch runner, permissions
├── Workflow Engine       Drag-drop canvas execution
├── Rule Engine            Condition → Action rules
├── Audit Logger           Structured logging + rotation
├── Performance Monitor    Memory/CPU/IPC metrics
└── Cloud Sync             Manifest-based bidirectional sync

React 19 UI (64 components)
├── HorseFarm             Main cockpit (10 panels)
├── HarnessAgentPanel     AI chat interface
├── PluginStore            Plugin marketplace
├── WorkflowEditor         Visual drag-drop builder
├── CommandPalette         Spotlight-style launcher
├── ResourceHub            Cross-project search
├── AuditLogViewer         Audit log browser
└── PerformanceDashboard   Runtime metrics charts
```

## Tech Stack

| Layer | Tech | Version |
|-------|------|---------|
| Desktop | Electron | 28 |
| UI | React | 19 |
| Language | TypeScript | 5.6 |
| Build | Vite (rolldown) | 8 |
| Terminal | node-pty | — |
| AI API | DeepSeek (OpenAI-compatible) | — |

## Created By

Built by the DeepBlue Team.  

---

*Claude Harness Desktop is not affiliated with Anthropic. Claude Code is a trademark of Anthropic PBC.*
