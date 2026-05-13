# 🐎 深蓝驾驭工程 (Claude Harness Desktop)

> 一款多项目管理驾驶舱，通过 **AI 驾驭智能体** 同时指挥多个 Claude Code 实例协同作战。

## 核心亮点

- **🤖 AI 驾驭智能体** — 内置 LLM Agent，自动分配任务、监督进度、收集报告，无需人工切换项目
- **🖥️ 多终端管理** — 基于 ConPTY/node-pty，支持同时运行多个 Claude Code 终端，一键广播指令
- **🧠 思维导图** — 可视化 AI 思考过程中的方案拓扑、任务拆解和依赖关系
- **🔌 插件生态** — 标准化插件规范，模块化隔离、能力注册、权限管控
- **🎭 角色体系** — 技能碎片收集 → 角色合成，解锁专属功能和身份档案
- **⚡ 一键式工作流** — 选择项目，发送任务，AI 自动完成，报告汇总呈现

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 28 |
| 前端 | React 19 + TypeScript 5.9 |
| 构建 | Vite 8 |
| 终端 | node-pty (ConPTY) |
| AI 引擎 | Claude Code CLI + DeepSeek API |
| 持久化 | JSON 文件存储 (fs-extra) |
| 国际化 | 中/英双语言 |

## 快速开始

```bash
pnpm install
npm run build:electron
npm run dev-electron
```

## 项目结构

```
electron/
  harnessAgent/     # AI 驾驭智能体核心
    agentLoop.ts    # Agent 主循环 + 系统提示词
    tools.ts        # 工具层 (task_project, read_project_chat, broadcast 等)
  modules/
    ptyManager.ts   # PTY 终端池管理 (自动应答、心跳检测)
    harnessIpc.ts   # 驾驭智能体 IPC 通道
    projectManager.ts  # 项目配置管理
  cli/              # CLI 命令注册与执行
  plugins/          # 插件系统
  workflow/         # 工作流引擎
src/
  components/
    HorseFarm/      # 主面板 (终端、命令、设置、思维导图)
    Hub/            # 悬浮快捷入口
    CLI/            # 命令面板、批量管理器
    Identity/       # 角色卡片与切换
    Productivity/   # 效率仪表盘、模板库、快速启动器
  context/          # React Context 全局状态
  i18n/             # 中英文翻译
```

## 核心工具清单

| 工具 | 功能 |
|---|---|
| `task_project` | 向指定项目发送任务，⛔ 忙时保护禁止中断 |
| `broadcast` | 向所有在线项目广播指令 |
| `read_project_chat` | 查看项目终端实时输出 + 历史聊天 |
| `check_status` | 检查所有项目在线/离线/忙碌状态 |
| `write_to_pty` | 直接写入终端 (应答对话框、确认操作) |
| `poll_projects` | 批量轮询产出，检测卡死/阻塞 |
| `stop_task` | 安全终止项目 AI 任务 |

## 架构特点

- **IPC 三层桥接**: `main handler → preload expose → type declaration → component`
- **Context + useReducer**: 按领域拆分状态管理
- **JSON 文件持久化**: 所有数据存于 `%APPDATA%/dbghf/`
- **主动任务追踪**: 防止重复分配和意外中断（铁律保护）
- **智能自动应答**: 终端对话框自动识别并回复

## 版本路线

| 版本 | 里程碑 |
|---|---|
| v1.0 | 基础多项目终端 + AI 智能体 |
| v2.0 | 系统托盘、全局热键、悬浮窗口、开机自启 |
| v2.1 | CLI 命令注册表、别名系统、批量编排 |
| v2.2 | 插件商店、能力注册、权限管控 |
| v2.3 | 角色解锁与身份体系、效率仪表盘 |
| v2.4 | 可视化工作流编辑器、跨项目资源管理 |
| v2.5 | 性能优化、规则引擎、审计日志 |

## License

MIT
