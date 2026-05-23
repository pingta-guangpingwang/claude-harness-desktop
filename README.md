# Claude Harness Desktop（Claude 群策桌面）

<p align="center">
  <strong>AI 驾驭智能体驱动的多项目管理驾驶舱</strong><br>
  <em>一条指令，同时指挥多个 Claude Code 实例协同作战。</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-Compatible-purple" alt="Claude Code">
  <img src="https://img.shields.io/badge/Electron-28-blue" alt="Electron 28">
  <img src="https://img.shields.io/badge/React-19-61dafb" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178c6" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/Tests-115%20passed-brightgreen" alt="Tests">
</p>

## 核心亮点

- **🤖 AI 驾驭智能体** — 内置 LLM Agent，自动拆解任务、匹配角色、并行分配、监督进度、汇总报告。你只管下指令，它替你指挥舰队
- **🖥️ 多终端管理** — 基于 node-pty，多项目终端并行，一键广播指令，支持 ConPTY/WinPTY
- **🎭 角色体系** — CEO/Worker/Reviewer/Diagnostician 四角色，按意图自动切换，独立工具权限 + 评分追踪 + 自定义角色
- **🧠 Agent 基础设施** — 自建六步上下文管线、三层记忆存储、Token 预算管理(1M 上下文)、语义记忆搜索、决策追踪、HITL 人机协同
- **🔌 插件生态** — 标准化插件规范，20+ 精选插件(Prettier/ESLint/TypeScript/pnpm/Docker 等)，模块化隔离、能力注册、权限管控
- **🎛️ 角色管理面板** — 可视化角色开关、自定义角色创建、评分排行榜、主开关控制
- **⚡ 工作流引擎** — 14 种节点类型的可视化工作流编辑器，拖拽搭建自动化管线

## 快速开始

```bash
git clone https://github.com/pingta-guangpingwang/claude-harness-desktop.git
cd claude-harness-desktop

pnpm install
npm run build:electron
npm run dev-electron

# 运行测试
npm test
```

**要求:** Windows 10/11 + Node.js 22+ + Claude Code CLI

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 28 |
| 前端 | React 19 + TypeScript 5.9 |
| 构建 | Vite 8 (rolldown) |
| 终端 | node-pty (ConPTY) |
| AI 引擎 | Claude Code CLI + DeepSeek API (1M 上下文) |
| 持久化 | JSON 文件存储 (fs-extra) |
| 测试 | Jest + ts-jest (115 个测试, 5 套件) |
| 国际化 | 中/英双语言 |

## 项目结构

```
electron/
  harnessAgent/        # AI 驾驭智能体核心
    agentLoop.ts       # Agent 主循环 + 工具执行 + HITL
    tools.ts           # 工具层 (task_project, broadcast 等 15+ 工具)
    roleManager.ts     # 角色管理与自动切换
    roleScorer.ts      # 角色评分引擎 (成功率/可靠性/综合分)
    roleConfigStore.ts # 角色配置持久化
    contextPipeline.ts # 六步上下文处理管线
    memoryStore.ts     # 冷/热/温三层记忆存储
    tokenBudget.ts     # Token 预算管理
    decisionTracer.ts  # 全链路决策追踪
    hitlManager.ts     # 人机协同确认
    llmProviders.ts    # LLM Provider 抽象层
    docToSkill.ts      # 文档 → 技能 加载器
    reflector.ts       # 任务反思与经验提取
  modules/
    ptyManager.ts      # PTY 终端池管理 (自动应答、心跳检测、噪声过滤)
    harnessIpc.ts      # 驾驭智能体 IPC 通道
    sessionManager.ts  # 会话持久化
    projectManager.ts  # 项目配置管理
    projectLauncher.ts # 一键启动脚本
  cli/                 # CLI 命令注册与执行
  plugins/             # 插件系统 (20+ 插件)
  workflow/            # 工作流引擎
src/
  components/
    HorseFarm/         # 主面板 (终端、命令、设置、角色管理、思维导图)
    Hub/               # 悬浮快捷入口
    CLI/               # 命令面板、批量管理器
    Identity/          # 角色卡片与切换
    Productivity/      # 效率仪表盘、模板库、快速启动器
  context/             # React Context 全局状态
  i18n/                # 中英文翻译
public/                 # 静态资源 (赞助码 / 交流群)
tests/                  # 单元测试 (5 套件, 115 用例)
```

## 核心工具清单

| 工具 | 功能 |
|---|---|
| `task_project` | 向指定项目发送任务，⛔ 忙时保护禁止中断 |
| `broadcast` | 向所有在线项目广播指令（需用户确认） |
| `read_project_chat` | 查看项目终端实时输出 + 历史聊天 |
| `check_status` | 检查所有项目在线/离线/忙碌状态 |
| `write_to_pty` | 直接写入终端 (应答对话框、确认操作) |
| `poll_projects` | 批量轮询产出，检测卡死/阻塞 |
| `stop_task` / `stop_all` | 安全终止项目 AI 任务（stop_all 需确认） |
| `health_report` | 生成驾驭智能体健康报告 |
| `wake_projects` | 快速唤醒所有在线项目 |
| `diagnose_project` | 诊断项目异常并分类恢复 |

## 架构特点

- **IPC 三层桥接**: `main handler → preload expose → type declaration → component`
- **六步上下文管线**: 清洗 → 意图识别 → 记忆注入 → 文档检索 → 角色提示词 → 输出组装
- **角色系统**: 默认关闭，用户主动开启；主开关 + 逐角色开关，按意图自动匹配，工具权限执行时拦截
- **忙保护 + 不打断**: 项目 AI 执行中自动拒绝新任务，防止上下文污染
- **智能自动应答**: 终端对话框自动识别并回复
- **JSON 文件持久化**: 所有数据存于 `%APPDATA%/dbghf/`

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
| v3.0 | 驾驭智能体 Agent 基础设施 (六步管线/记忆/预算/追踪/HITL) |
| v3.5 | 角色评分引擎 + 角色管理面板 + 自定义角色 |
| v3.7 | 角色启用/禁用控制 + 持久化 + 忙保护 + 自主决策 |

## 插件商店

20+ 精选插件，一键安装真实 npm/pip 包：

| 分类 | 插件 |
|------|------|
| 格式化 | Prettier, Biome |
| Lint | ESLint, Stylelint, Markdownlint |
| 类型 | TypeScript, Pyright |
| 包管理 | pnpm, yarn |
| Git | commitlint, commitizen |
| 容器 | Docker CLI, Docker Compose |
| API | HTTP Server, Mock Server |
| 数据库 | Prisma, SQLFluff |
| 工具 | tree, rimraf, cpx, http-server |

## Created By

Built by **Pingtao Guangping Wang** — [shenlanai.com](https://shenlanai.com)

*Claude Harness Desktop is not affiliated with Anthropic. Claude Code is a trademark of Anthropic PBC.*

## 联系与支持

CHD 是一款完全免费的开源软件。如果你觉得它对你有帮助，欢迎打赏支持，你的鼓励是我持续更新的动力。

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

## License

MIT
