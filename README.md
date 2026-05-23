# Claude Harness Desktop（Claude 群策桌面）

> AI 驾驭智能体驱动的多项目管理驾驶舱。一条指令，同时指挥多个 Claude Code 实例协同作战。

## 核心亮点

- **🤖 AI 驾驭智能体** — 内置 LLM Agent，自动拆解任务、匹配角色、并行分配、监督进度、汇总报告
- **🖥️ 多终端管理** — 基于 node-pty (ConPTY)，多项目终端并行，一键广播指令
- **🎭 角色体系** — CEO/Worker/Reviewer/Diagnostician 四角色，按意图自动切换，独立工具权限 + 评分追踪
- **🧠 Agent 基础设施** — 自建六步上下文管线、三层记忆存储、Token 预算管理、决策追踪、HITL 人机协同
- **🔌 插件生态** — 标准化插件规范，模块化隔离、能力注册、权限管控
- **🎛️ 角色管理面板** — 可视化角色开关、自定义角色创建、评分排行榜、主开关控制

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 28 |
| 前端 | React 19 + TypeScript 5.9 |
| 构建 | Vite 8 |
| 终端 | node-pty (ConPTY) |
| AI 引擎 | Claude Code CLI + DeepSeek API (1M 上下文) |
| 持久化 | JSON 文件存储 (fs-extra) |
| 测试 | Jest + ts-jest (115 个测试) |
| 国际化 | 中/英双语言 |

## 快速开始

```bash
pnpm install
npm run build:electron
npm run dev-electron

# 运行测试
npm test
```

## 项目结构

```
electron/
  harnessAgent/        # AI 驾驭智能体核心
    agentLoop.ts       # Agent 主循环 + 系统提示词
    tools.ts           # 工具层 (task_project, broadcast 等)
    roleManager.ts     # 角色管理与自动切换
    roleScorer.ts      # 角色评分引擎 (成功率/可靠性/综合分)
    roleConfigStore.ts # 角色配置持久化 (主开关 + 逐角色启用 + 自定义)
    contextPipeline.ts # 六步上下文处理管线
    memoryStore.ts     # 冷/热/温三层记忆存储
    tokenBudget.ts     # Token 预算管理
    decisionTracer.ts  # 全链路决策追踪
    hitlManager.ts     # 人机协同确认
    llmProviders.ts    # LLM Provider 抽象层
    docToSkill.ts      # 文档→技能 加载器
    reflector.ts       # 任务反思与经验提取
  modules/
    ptyManager.ts      # PTY 终端池管理 (自动应答、心跳检测)
    harnessIpc.ts      # 驾驭智能体 IPC 通道
    projectManager.ts  # 项目配置管理
  cli/                 # CLI 命令注册与执行
  plugins/             # 插件系统
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
tests/                  # 单元测试 (5 套件, 115 用例)
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
| `health_report` | 生成驾驭智能体健康报告 |

## 架构特点

- **IPC 三层桥接**: `main handler → preload expose → type declaration → component`
- **六步上下文管线**: 清洗 → 意图识别 → 记忆注入 → 文档检索 → 角色提示词 → 输出组装
- **角色系统**: 默认关闭，用户主动开启；主开关 + 逐角色开关，按意图自动匹配，工具权限执行时拦截
- **忙保护 + 不打断**: 项目 AI 执行中自动拒绝新任务，防止上下文污染
- **JSON 文件持久化**: 所有数据存于 `%APPDATA%/dbghf/`
- **自动应答**: 终端对话框自动识别并回复

## License

MIT
