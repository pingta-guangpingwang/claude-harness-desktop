# Claude Harness Desktop (CHD) — 深蓝驾驭工程

**Your visual multi-project cockpit for Claude Code. Manage, monitor, and orchestrate AI development across projects — from a desktop GUI.**

**深蓝驾驭工程 — Claude Code 的桌面可视化多项目驾驶舱。从桌面 GUI 管理、监控并编排多项目 AI 开发。**

<p align="center">
  <img src="https://img.shields.io/badge/Electron-28-blue" alt="Electron 28">
  <img src="https://img.shields.io/badge/React-19-61dafb" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178c6" alt="TypeScript 5.6">
  <img src="https://img.shields.io/badge/Vite-8-646cff" alt="Vite 8">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
</p>

> **为什么需要桌面化？** 当今所有 Claude Code 工具都运行在终端中。CHD 给你一个**可视化驾驶舱**：同时管理 10+ 项目，实时观察 AI 智能体工作，一站式编排。

---

## 作者

**王广平 (Wang Guangping)**

- 微信：1084703441
- 邮箱：18351267631@163.com
- 个人网站：[www.shenlanai.com](https://www.shenlanai.com)

> 我将努力开发与世界连接，这是我发向全世界发送的一根信息触手，欢迎交流。
> I strive to build connections with the world. This is my information tentacle reaching out globally — let's connect.

---

## 快速开始 · Quick Start

### 开发环境 · Development

双击 `start.bat` 一键启动。首次运行自动安装依赖。
Double-click `start.bat` to launch. Dependencies are automatically installed on first run.

### 生产构建 · Production

```bash
npm run build && npm run start
```

### 克隆运行 · Clone & Run

```bash
git clone https://github.com/pingta-guangpingwang/claude-harness-desktop.git
cd claude-harness-desktop
npm install
npm run dev-electron
```

**环境要求：** Node.js 22+

---

## 功能概览 · Features

### 🎛️ 驾驭智能体 · Harness Agent
一个管理你所有项目 AI 的元 AI。它委派任务、监控进度、编排多项目工作流 — 你不再需要在终端间切换。

**14 个内置工具：** `create_project`, `wake_projects`, `stop_projects`, `check_status`, `broadcast`, `task_project`, `read_project_chat`, `health_report`, `queue_status`, `add_follow_up`, `read_file`, `write_file`, `shell_exec`

插件工具在安装时自动注册 — 智能体会自动发现并使用它们。

### 🧩 插件商店 · Plugin Store
20+ 精选插件，**真实 npm/pip 安装**：

| 类别 | 插件 |
|------|------|
| 格式化 | Prettier, Biome |
| 代码检查 | ESLint, Stylelint, Markdownlint |
| 类型检查 | TypeScript, Pyright |
| 包管理 | pnpm, yarn |
| Git | commitlint, commitizen, git-split |
| 容器 | Docker CLI, Docker Compose |
| API | HTTP Server, Mock Server |
| 数据库 | Prisma, SQLFluff |
| 效率工具 | tree, rimraf, cpx, http-server |
| AI 工具 | changelog 生成, 依赖审计, 许可证检查 |

### 🔄 可视化工作流编辑器 · Visual Workflow Editor
在画布上拖拽节点构建自动化流水线：

```
[文件监听] → [CLI 命令] → [AI 调用] → [条件分支] → [通知]
```

14 种节点类型：CLI、AI 调用、文件读写、条件、循环、并行、Cron 触发、Webhook 等。

### 🎭 角色系统 · Role & Identity
你的操作积累经验值，经验值解锁角色和专精。一键切换角色获得定制化的命令推荐、主题和布局。

7 大角色：Developer、Designer、DevOps、Architect、DataEngineer、QAEngineer、PM

### 🖥️ 系统中枢 · System Hub
- **系统托盘常驻** — 关闭窗口即隐藏到托盘，后台持续运行
- **全局快捷键** — `Ctrl+Shift+H` 一键唤起
- **悬浮小窗** — 320x480 置顶快捷入口，随时调用
- **开机自启** — 支持 Windows 注册表自启
- **资源调度器** — 并发 AI 请求、文件 IO 智能排队

### 📊 全维度监控 · Monitoring
- **Token 消耗统计** — 按项目/模型/对话维度实时统计，成本估算
- **审计日志** — 结构化操作日志，10MB 轮转，完整追溯
- **性能仪表盘** — 内存/CPU/IPC 延迟实时监控
- **PTY 终端池** — 每个项目独立终端会话，支持多项目并行

### 🏗️ 版本沙箱 · Version Sandbox
- 任务开始前自动快照，任务完成自动提交
- AI 会话回滚 — 按会话批量撤销 AI 生成的代码
- 通过 DBHT CLI (`dbgvs`) 驱动，零代码耦合

---

## 推荐搭档：DBHT 版本控制 · Recommended Companion

CHD 可以单独使用 Git，也可以搭配 **DeepBlueHarnessTrace (DBHT)** CLI 获得更强大的 AI 版本管理能力：

> **DBHT** — 你的代码本地金库。无需云端，告别复杂。
> 给 AI 套上缰绳，让每一次代码生成都有迹可循。

```bash
git clone https://github.com/pingta-guangpingwang/DeepBlueHarnessTrace.git
```

DBHT 提供：本地集中式版本仓库、AI 会话标记与回滚、架构知识图谱、向量语义搜索、多语言 AST 解析等。

---

## 技术栈 · Tech Stack

| 层级 | 技术 | 版本 |
|------|------|------|
| 桌面框架 | Electron | 28 |
| UI 框架 | React | 19 |
| 语言 | TypeScript | 5.6 |
| 构建工具 | Vite (rolldown) | 8 |
| 终端 | node-pty | — |
| AI API | DeepSeek (OpenAI 兼容) | — |
| 版本管理 | DBHT CLI (可选) | — |

## 架构 · Architecture

```
Electron 28 主进程 (56 modules)
├── Window Manager        多窗口生命周期
├── System Tray           后台常驻托盘
├── Global Hotkeys        Ctrl+Shift+H 全局唤起
├── Harness Agent         AI 项目管理智能体 (DeepSeek LLM)
├── Plugin Manager        npm/pip 安装 + shim 注册
├── CLI Command System    命令注册表、别名、批量执行、权限
├── Workflow Engine       拖拽画布可视化工作流
├── Rule Engine           条件 → 动作规则引擎
├── Audit Logger          结构化日志 + 轮转
├── Performance Monitor   内存/CPU/IPC 指标
└── Cloud Sync            基于 manifest 的双向同步

React 19 渲染进程 (64 components)
├── HorseFarm             主驾驶舱 (10 个面板)
├── HarnessAgentPanel     AI 对话界面
├── PluginStore            插件市场
├── WorkflowEditor         可视化拖拽编辑器
├── CommandPalette         Spotlight 式启动器
├── ResourceHub            跨项目资源搜索
├── AuditLogViewer         审计日志查看
├── TokenStatsPanel        Token 消耗统计
└── PerformanceDashboard   运行时指标图表
```

---

## 项目结构 · Project Structure

```
claude-harness-desktop/
├── electron/                    # Electron 主进程
│   ├── main.ts                 # 入口：窗口、托盘、热键、调度器
│   ├── preload.ts              # IPC 桥接层
│   ├── modules/                # 56 个功能模块
│   │   ├── ptyManager.ts       # PTY 终端管理
│   │   ├── tokenStore.ts       # Token 消耗追踪
│   │   ├── dbhtIpc.ts          # DBHT 集成 IPC
│   │   └── ...
│   ├── harnessAgent/           # 驾驭智能体
│   │   └── agentLoop.ts        # AI 对话循环 (SSE)
│   ├── cli/                    # CLI 命令系统
│   ├── plugins/                # 插件管理器
│   └── workflow/               # 工作流引擎
├── src/                        # React 渲染进程
│   ├── App.tsx                 # 根组件 + 视图路由
│   ├── components/
│   │   ├── Setup/              # 初始化设置
│   │   ├── HorseFarm/          # 主驾驶舱
│   │   ├── Hub/                # 系统中枢 (托盘/悬浮/调度)
│   │   ├── CLI/                # 命令面板
│   │   ├── Plugins/            # 插件商店
│   │   ├── Identity/           # 角色身份系统
│   │   ├── Workflow/           # 工作流编辑器
│   │   ├── Eco/                # 生态互联
│   │   └── System/             # 审计/规则/性能
│   ├── context/                # React Context + Reducer
│   └── i18n/                   # 中英双语
├── public/                     # 静态资源
├── start.bat                   # Windows 一键启动
└── package.json
```

---

## 开发命令 · Scripts

| 命令 | 说明 |
|------|------|
| `npm run dev-electron` | 开发模式（Vite + Electron 并行） |
| `npm run build` | 生产构建 |
| `npm run start` | 构建并启动 |
| `npm run lint` | ESLint 检查 |
| `npm run format` | Prettier 格式化 |

---

## 最近更新 · Recent Updates (2026年4-5月)

### 🎛️ 驾驭智能体 · Harness Agent
- **`create_project` 新项目工具** — 一句话创建新项目：建目录→注册→唤醒 Claude Code→派发开发任务，全自动
- **基础设施工具** — `shell_exec` / `read_file` / `write_file` 专用于系统维护（安装工具、检查环境、读写配置），绝不碰项目源码
- **非阻塞对话** — AI 运行期间用户可随时发送消息，中断当前思考并插入新指令
- **智能容错** — 空项目预初始化跳过安全确认，死终端自动检测避免反复派发
- CEO 架构重构 — 14 内置工具 + 动态插件工具发现

### 📊 Token 消耗追踪
- JSONL 持久化记录每次 API 调用的 token 消耗
- 按天/项目/模型/对话维度聚合统计
- 基于 DeepSeek 定价的实时成本估算
- 对话记录折叠查看 — 双击展开具体调用详情

### 🔧 PTY 终端增强
- 始终通过 cmd.exe /c 路由，解决 VSCode 占用冲突
- `--fork-session` 独立会话 ID，避免互斥
- 智能重试机制 — 2.5s 快速失败检测 + 2 次重试

### 🖥️ 中枢层
- 系统托盘常驻 + 右键菜单
- 全局快捷键 Ctrl+Shift+H 唤起
- 悬浮快捷入口小窗
- 开机自启管理

### 🏗️ 版本沙箱
- 任务快照 → 提交 → 回滚完整流程
- AI 会话级回滚能力
- DBHT CLI (`dbgvs`) 驱动

### 🧩 插件生态
- npm/pip 真实安装 + shim 注册
- 插件安装权限确认弹窗
- 版本管理与回滚
- 20+ 精选插件

---

## 联系与支持 · Contact & Support

CHD 是一款完全免费的开源软件。如果你觉得它对你有帮助，欢迎打赏支持，你的鼓励是我持续更新的动力。

CHD is free and open-source software. If you find it helpful, your support is greatly appreciated!

<table>
  <tr>
    <td align="center">
      <img src="public/f9e661730d92fb35985a8d0dffcfb624.jpg" width="180" /><br/>
      <b>微信支付<br/>WeChat Pay</b>
    </td>
    <td align="center">
      <img src="public/cd5741cc158ccc6be0b524f0444cc22c.jpg" width="180" /><br/>
      <b>支付宝<br/>Alipay</b>
    </td>
    <td align="center">
      <img src="public/94407fbdd42a797af5a902bc107d72e8.jpg" width="180" /><br/>
      <b>微信交流群<br/>WeChat Group</b>
    </td>
  </tr>
</table>

---

## 许可 · License

MIT

---

*Claude Harness Desktop is not affiliated with Anthropic. Claude Code is a trademark of Anthropic PBC.*
