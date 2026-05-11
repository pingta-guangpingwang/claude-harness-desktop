# 深蓝驾驭工程 — 生态平台架构与开发规划 v4.0

---

## 第一部分：深蓝生态设计理念

### 1.1 生态定位

深蓝驾驭工程是**深蓝生态的 AI 开发操作系统平台**。

| 类比 | 深蓝驾驭工程 | 对应物 |
|------|-------------|--------|
| 操作系统 | 管理所有 AI 开发资源的调度中枢 | Windows/macOS |
| 应用商店 | MCP 兼容 Skill 市场 | App Store / VS Code Marketplace |
| 用户账户 | 统一身份 + API Key 聚合 + 充值 | Apple ID |
| 项目管理 | 独立窗口项目，DBHT 版本管理 | VSCode Workspace |
| 智能体管理 | 分配/唤醒/协同/评估智能体 | 进程管理器 |
| 模型路由 | 一键切换市面任意大模型 | API Gateway |
| **中间件盒子** | **所有智能体交互的唯一通道** | **Docker Engine** |

### 1.2 核心设计原则

1. **中间件盒子是唯一通道** — 智能体的知识库读写、操作记录、Skill 调用、API 请求、
   文件访问，全部通过中间件盒子。智能体不直接触碰任何资源。这是实现开发分离的基石。

2. **MCP 原生兼容** — 中间件盒子本质是一个 MCP（Model Context Protocol）代理 + 增强层。
   所有 Skill 兼容 MCP Server 规范，第三方 MCP Server 可直接接入。
   Skill 市场不需要从零冷启动——借力 MCP 生态，深蓝 Skill = MCP Server + 深蓝增强元数据。
   同时兼容 Google A2A（Agent-to-Agent）协议用于多智能体协同。

3. **DBHT 即为版本总线 + 记忆总线** — 模块版本管理，同时也是智能体记忆的持久化层。
   智能体的操作记录、知识积累、策略选择，全部通过 DBHT 版本化存储，不丢失、可回溯。

4. **规则注入代替 VM 沙箱** — 不对智能体做 VM 级隔离。每个智能体初始化时，
   中间件盒子通过 DBHT 拉取版本化规则，注入到智能体上下文中约束行为。

5. **安装区域平台化管理** — 每个智能体有平台分配的独立安装区域（沙盒目录），
   智能体只能在此区域内安装依赖/存储临时文件。不乱装、不重复装、卸载无残留。

6. **模块化到骨子里** — 每个功能模块独立 DBHT 版本追踪，可单独回滚，可并行开发。
   模块间通过明确的 IPC 契约通信，AI 智能体可以同时开发不同模块。

---

## 第二部分：中间件盒子架构（核心）

### 2.1 什么是中间件盒子

中间件盒子是驾驭工程中最核心的架构组件。它是**所有智能体与外部世界交互的唯一代理层**。

```
                        ┌──────────────────────────────────────────────┐
                        │        中间件盒子 (Middleware Box)              │
                        │                                              │
  智能体 A ──────────→  │  ┌────────────────────────────────────────┐  │
  智能体 B ──────────→  │  │  请求拦截器 (Request Interceptor)       │  │
  智能体 C ──────────→  │  │  · 知识库读写 → 代理 → DBHT存储        │  │
                        │  │  · 操作记录   → 代理 → 审计日志        │  │
                        │  │  · Skill调用  → 代理 → MCP路由         │  │
                        │  │  · API请求    → 代理 → 模型网关        │  │
                        │  │  · 文件访问   → 代理 → 安装区域        │  │
                        │  └────────────────────────────────────────┘  │
                        │                                              │
                        │  ┌────────────────────────────────────────┐  │
                        │  │  规则引擎 (Rule Engine)                 │  │
                        │  │  · 注入规则 → 拦截 → 允许/拒绝         │  │
                        │  │  · 规则版本化 (DBHT)                   │  │
                        │  └────────────────────────────────────────┘  │
                        │                                              │
                        │  ┌────────────────────────────────────────┐  │
                        │  │  能力追踪器 (Capability Tracker)        │  │
                        │  │  · 记录使用了哪些能力                   │  │
                        │  │  · 记录采用了哪些策略                   │  │
                        │  │  · 性能/成功率统计                     │  │
                        │  └────────────────────────────────────────┘  │
                        │                                              │
                        │  ┌────────────────────────────────────────┐  │
                        │  │  健康守护 (Health Guardian)             │  │
                        │  │  · 心跳检测 → 优雅降级                 │  │
                        │  │  · 请求队列 → 背压控制                 │  │
                        │  │  · 熔断器   → 故障隔离                 │  │
                        │  └────────────────────────────────────────┘  │
                        └──────────────────────────────────────────────┘
                                          │
        ┌─────────────────────────────────┼─────────────────────────────┐
        │                                 │                             │
 ┌──────┴──────┐  ┌──────────────┐  ┌────┴──────────┐  ┌──────────────┐
 │  DBHT 存储   │  │ MCP Skill 路由│  │  模型网关     │  │ 安装区域管理 │
 │  · 记忆管理  │  │ · MCP Server │  │  · Key 注入   │  │ · Agent 隔离 │
 │  · 知识库    │  │ · Skill 增强  │  │  · Provider   │  │ · 共享检测   │
 │  · 操作记录  │  │ · 能力注册   │  │  · 统一 API   │  │ · 清理回收   │
 └─────────────┘  └──────────────┘  └───────────────┘  └──────────────┘
```

### 2.2 中间件盒子解决的问题

| 问题 | 没有中间件盒子 | 有了中间件盒子 |
|------|---------------|---------------|
| **乱装** | 智能体随意装依赖，污染系统 | 智能体只能在自己的安装区域操作，平台统一管理 |
| **重复装** | 两个智能体各自装同一依赖 | 中间件检测已有 → 共享或拒绝重复安装 |
| **记录丢失** | 智能体换了/重启了，历史没了 | 所有操作通过 DBHT 持久化，记忆不丢失 |
| **不可评估** | 不知道哪个智能体干了什么 | 能力追踪器记录所有策略和能力使用 |
| **选择困难** | 不知道选哪个智能体做任务 | 可视化面板展示每个智能体的能力图和历史表现 |
| **安全失控** | 智能体可能访问任意文件/网络 | 规则引擎拦截每个请求，越权即拒绝 |
| **单点崩溃** | 无防护 | 健康守护：心跳检测 + 优雅降级 + 熔断隔离 |

### 2.3 MCP 兼容设计（v4.0 新增）

深蓝 Skill = **MCP Server + 深蓝增强元数据**。中间件盒子是一个 MCP 代理：

```
第三方 MCP Server ──→ 中间件盒子 MCP 路由 ──→ 智能体
                            │
                    深蓝增强元数据：
                    · 能力标签 (codeGeneration, debugging...)
                    · 策略偏好 (incremental, full-rewrite...)
                    · 权限声明 (filesystem:read, network...)
                    · 版本信息 (DBHT versioned)
                    · 用户评价/使用统计
```

**这意味着**：
- 任何 MCP Server 可以直接接入深蓝平台，零适配成本
- 深蓝 Skill 市场 = 精选 MCP Server 目录 + 深蓝增强层
- 冷启动问题大幅缓解——市面上已有大量 MCP Server 可用
- 深蓝的差异化在"增强层"：能力追踪、策略画像、版本管理、权限管控

### 2.4 智能体安装区域

平台为每个智能体分配独立的安装区域：

```
%APPDATA%/dbghf/agents/
├── agent-registry.json
├── installed/
│   ├── <agent-id>/
│   │   ├── agent.json           # 智能体元数据
│   │   ├── rules.json           # 当前注入的规则（DBHT 版本化）
│   │   ├── workspace/           # 智能体专属工作区
│   │   ├── memory/              # DBHT 记忆文件
│   │   └── logs/                # 运行日志
│   └── ...
└── shared/                      # 共享资源（模型缓存等）
```

### 2.5 DBHT 记忆管理

智能体的"记忆"不是存在智能体内部，而是由中间件盒子代理存储到 DBHT：

```
智能体想"记住"一件事 →
  中间件盒子拦截 →
    写入 <agent-id>/memory/memory.jsonl（追加式 JSON Lines）
    DBHT 自动版本化 →
    智能体下次启动时，中间件盒子拉取最新记忆注入

记忆结构（JSONL，每行一条记录）:
{"t":"2026-05-08T10:30:00Z","type":"knowledge","key":"project-structure","value":{...},"hash":"abc123"}
{"t":"2026-05-08T10:31:00Z","type":"decision","context":"chose React over Vue","reason":"team familiarity","result":"success"}
{"t":"2026-05-08T10:32:00Z","type":"skill-use","skillId":"vscode-claude","durationMs":45000,"outcome":"completed"}
```

---

## 第三部分：智能体能力评估与可视化

### 3.1 能力追踪模型

```typescript
interface AgentCapabilityProfile {
  agentId: string
  agentName: string
  installedAt: string
  totalSessions: number
  totalOperations: number

  // 能力雷达图数据
  capabilities: {
    codeGeneration:  CapabilityScore
    codeReview:      CapabilityScore
    debugging:       CapabilityScore
    fileOperations:  CapabilityScore
    knowledgeQuery:  CapabilityScore
    workflowExec:    CapabilityScore
    skillUsage:      CapabilityScore
  }

  // 策略偏好
  strategies: StrategyUsage[]

  // 模型偏好
  modelPreferences: { modelId: string; usageCount: number; avgTokens: number }[]

  // 表现指标
  performance: {
    avgResponseTimeMs: number
    successRate: number
    taskCompletionRate: number
    avgTokensPerOperation: number
    costEfficiency: number        // 性价比评分
  }

  // 最近活动
  recentActivity: ActivityEntry[]
}

interface CapabilityScore {
  count: number
  successRate: number
  avgQuality: number   // 1-10
  level: 'beginner' | 'intermediate' | 'expert' | 'master'
}

interface StrategyUsage {
  strategy: string     // 'incremental', 'full-rewrite', 'ask-first'
  count: number
  successRate: number
}
```

### 3.2 智能体管理面板可视化

```
┌─────────────────────────────────────────────────────────────┐
│  智能体管理平台                                              │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Agent A     │  │ Agent B     │  │ Agent C     │         │
│  │ 🤖 Claude   │  │ 🤖 DeepSeek │  │ 🤖 自定义   │         │
│  │ ⭐ 4.7/5    │  │ ⭐ 4.2/5    │  │ ⭐ 3.8/5    │         │
│  │ ┌─────────┐ │  │ ┌─────────┐ │  │ ┌─────────┐ │         │
│  │ │能力雷达 │ │  │ │能力雷达 │ │  │ │能力雷达 │ │         │
│  │ │  ⬡ 代码 │ │  │ │  ⬢ 调试 │ │  │ │  ⬡ 审查 │ │         │
│  │ │  ⬡ 文件 │ │  │ │  ⬡ 知识 │ │  │ │  ⬡ 工作 │ │         │
│  │ └─────────┘ │  │ └─────────┘ │  │ └─────────┘ │         │
│  │ 成功率: 94% │  │ 成功率: 88% │  │ 成功率: 76% │         │
│  │ 策略: 增量  │  │ 策略: 全量  │  │ 策略: 询问  │         │
│  │ [选择] [卸载]│  │ [选择] [卸载]│  │ [选择] [卸载]│         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  安装新智能体  │  MCP 市场安装  │  AI 生成智能体     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 用户选择智能体的决策依据

1. **能力匹配度** — 该智能体的能力雷达图与项目需求的匹配程度
2. **历史表现** — 在类似项目/类似任务上的成功率
3. **策略风格** — 增量式修改 vs 全量重写 vs 先问再做
4. **成本预估** — 根据历史 Token 消耗预估本次任务成本
5. **模型选择** — 该智能体使用的底层模型及其当前可用状态

---

## 第四部分：生态全景图

```
                        ┌──────────────────────────────────┐
                        │       深蓝聚合平台 (云端)          │
                        │  ┌────────┐  ┌────────────────┐  │
                        │  │ 用户账户 │  │ API Key 聚合    │  │
                        │  │ 注册登录 │  │ 模型订阅/充值   │  │
                        │  └────────┘  └────────────────┘  │
                        │  ┌────────┐  ┌────────────────┐  │
                        │  │MCP市场 │  │ 工作流市场      │  │
                        │  └────────┘  └────────────────┘  │
                        └──────────────┬───────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                    深蓝驾驭工程 (本地平台)                    │
        │                                                              │
        │  ┌─────────────────────────────────────────────────────┐    │
        │  │              驾驭工程管理智能体 (内置)                │    │
        │  └─────────────────────────────────────────────────────┘    │
        │                                                              │
        │  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
        │  │ 项目窗口A │  │ 项目窗口B │  │ 项目窗口C │  ...           │
        │  │ Agent1,2 │  │ Agent3,4 │  │ Agent5   │                 │
        │  └────┬─────┘  └────┬─────┘  └────┬─────┘                 │
        │       │              │              │                       │
        │       └──────────────┼──────────────┘                       │
        │                      │                                      │
        │         ┌────────────┴────────────┐                        │
        │         │    中间件盒子 (唯一通道)  │  ← 所有智能体交互      │
        │         │   ┌──────────────────┐  │     必经此处            │
        │         │   │ 请求拦截 + 规则    │  │                        │
        │         │   │ 能力追踪 + 记忆    │  │                        │
        │         │   │ MCP路由 + Key注入  │  │                        │
        │         │   │ 健康守护 + 熔断    │  │                        │
        │         │   └──────────────────┘  │                        │
        │         └────────────┬────────────┘                        │
        │                      │                                      │
        │  ┌───────────────────┼───────────────────┐                 │
        │  │                   │                   │                 │
        │  │  ┌────────┐  ┌────┴────┐  ┌──────────┴──┐             │
        │  │  │  DBHT  │  │MCP Skill│  │  模型网关   │             │
        │  │  │ 记忆   │  │  路由   │  │  多Provider │             │
        │  │  │ 版本   │  │  市场   │  │  Key注入    │             │
        │  │  └────────┘  └─────────┘  └─────────────┘             │
        │  └───────────────────────────────────────────────────┘    │
        │                                                              │
        │  ┌─────────────────────────────────────────────────────┐    │
        │  │              智能体安装区域                          │    │
        │  │  agents/installed/<agent-id>/                       │    │
        │  │  ├── workspace/   ├── memory/   ├── logs/          │    │
        │  │  每个智能体独立隔离，平台统一管理                     │    │
        │  └─────────────────────────────────────────────────────┘    │
        └──────────────────────────────────────────────────────────────┘
```

---

## 第五部分：分阶段实施计划（3 个月 / 12 周）

### 总体策略：AI 并行模块化开发

每个模块有独立的 DBHT 版本追踪、独立的 `module.json`、明确定义的 IPC 契约接口。
多个 AI 智能体可以同时开发不同模块，通过接口契约保证模块间兼容。

```
          Week 1-2          Week 3-4          Week 5-6          Week 7-8          Week 9-12
          ─────────         ─────────         ─────────         ─────────         ──────────
Module A  ██████████████████ (底座+中间件核心)
Module B                    ██████████████████ (模型网关)
Module C                    ██████████████████ (智能体管理面板)
Module D  ██████████████████ (DBHT 集成)
Module E                                      ██████████████████ (MCP Skill 系统)
Module F                                      ██████████████████ (多窗口项目系统)
Module G                                                        ██████████████████ (多Agent协同)
Module H                                                        ██████████████████ (工作流引擎)
Module I                                                                              ██████████████████ (角色+效率)
Module J                                                                              ██████████████████ (加固+测试)
```

### 里程碑 1：Demo 可用（第 1-4 周）

**目标**：中间件盒子框架跑通，2-3 个智能体可管理，模型可切换，能力雷达图可见。

**交付物**：
- 中间件盒子核心：请求拦截器 + 规则引擎 + 能力追踪器 + 健康守护
- 模型网关：DeepSeek + Claude 两个 Provider 可切换
- 智能体管理面板：已安装列表 + 能力雷达图（静态数据可展示）
- DBHT 集成：模块版本追踪 + 记忆持久化
- 智能体安装区域管理
- 多窗口基础架构

**每个模块的具体工作**：

#### Module A: 平台底座 + 中间件盒子核心（2 周）
| 任务 | 产出 | 优先级 |
|------|------|--------|
| 代码模块化重构 | 每个模块独立目录 + `module.json` | P0 |
| IPC 协议标准化 | `domain:action` 命名 + 推送事件总线 | P0 |
| SQLite 数据层 | 高频数据（命令历史、技能碎片） | P1 |
| 请求拦截器 | 所有智能体请求的入口/出口代理 | P0 |
| 规则引擎 | 加载规则 → 评估 → 允许/拒绝 | P0 |
| 能力追踪器 | 记录操作 → 聚合统计 → 能力画像 | P0 |
| 健康守护 | 心跳检测 + 优雅降级 + 熔断器 | P1 |
| 密钥加密存储 | API Key 本地加密 | P1 |

#### Module B: 模型网关（第 3-4 周）
| 任务 | 产出 | 优先级 |
|------|------|--------|
| Provider 适配器接口 | `ModelProvider` 抽象类 | P0 |
| DeepSeek 适配器 | Anthropic Messages 格式 | P0 |
| Claude 适配器 | 直连 Anthropic API | P0 |
| OpenAI 适配器 | Chat Completions 格式 | P1 |
| 统一 API 格式 | 内部统一为 Anthropic Messages | P0 |
| Key 注入机制 | 请求时自动注入对应 Provider Key | P0 |
| 模型切换 UI | 下拉选择模型/Provider | P1 |
| 用量统计 | 按项目/Agent/模型统计 Token | P1 |

#### Module C: 智能体管理面板（第 3-4 周）
| 任务 | 产出 | 优先级 |
|------|------|--------|
| 已安装智能体列表 | 卡片视图 | P0 |
| 能力雷达图组件 | SVG/Canvas 雷达图 | P0 |
| 安装新智能体 | 从 MCP 市场 / 手动配置 | P1 |
| 卸载智能体 | 清理安装区域 + 保留记忆 | P0 |
| Agent 启动/唤醒流程 | 规则注入 + 记忆加载 + Key 注入 | P0 |
| 策略标签展示 | 增量式/全量重写/先问再做 | P1 |

#### Module D: DBHT 集成（第 1-2 周）
| 任务 | 产出 | 优先级 |
|------|------|--------|
| 模块版本追踪 | `module.json` + DBHT commit 关联 | P0 |
| 记忆 JSONL 读写 | 追加式写入 + 分段加载 | P0 |
| 规则文件版本化 | DBHT 仓库存储规则文件 | P0 |
| 回滚接口 | 模块/规则/记忆独立回滚 | P1 |

---

### 里程碑 2：生态可用（第 5-8 周）

**目标**：MCP Skill 系统上线，多窗口项目可用，多 Agent 可协同工作。

**交付物**：
- MCP Skill 路由：兼容 MCP Server，精选 5+ 官方 Skill
- 多窗口项目系统：独立窗口 + Agent 分配
- 多 Agent 协同总线：Agent 间信息通过中间件盒子中转
- 工作流引擎基础：节点定义 + 串行/并行执行

#### Module E: MCP Skill 系统（第 5-6 周）
| 任务 | 产出 | 优先级 |
|------|------|--------|
| MCP 协议适配层 | MCP Server → 中间件盒子 → 智能体 | P0 |
| Skill 注册表 | 已安装 Skill 索引 + 能力声明 | P0 |
| Skill 安装/卸载 | 生命周期管理 | P0 |
| 权限声明与管控 | 安装时展示权限，运行时管控 | P0 |
| 5 个官方 Skill | VSCode、Terminal、Git、FileSystem、WebSearch | P0 |
| AI 生成 Skill | 输入 MCP Server URL → 分析 → 打包 | P1 |
| Skill 商店 UI | 浏览/搜索/安装/评价 | P1 |

#### Module F: 多窗口项目系统（第 6-7 周）
| 任务 | 产出 | 优先级 |
|------|------|--------|
| WindowManager | 多窗口生命周期管理 | P0 |
| 独立项目窗口 | 每个项目独立 BrowserWindow | P0 |
| 项目-Agent 分配 | 手动分配 + AI 推荐 | P0 |
| TrayManager | 系统托盘 + 右键菜单 | P1 |
| 全局热键 | 一键唤起 | P1 |

#### Module G: 多 Agent 协同总线（第 7-8 周）
| 任务 | 产出 | 优先级 |
|------|------|--------|
| Agent 间消息路由 | A 产出 → 中间件 → B 可查询 | P0 |
| 协同进度可视 | 项目窗口实时展示各 Agent 状态 | P1 |
| 资源调度队列 | 并发请求排队 + 优先级 | P1 |
| A2A 协议兼容 | Google Agent-to-Agent 协议 | P2 |

#### Module H: 工作流引擎（第 7-8 周）
| 任务 | 产出 | 优先级 |
|------|------|--------|
| 工作流节点类型 | CLI/AI/文件/条件/循环/等待 | P0 |
| 串行/并行执行 | DAG 拓扑排序执行 | P0 |
| 断点续跑 | 失败节点重试 + 跳过 | P1 |
| 定时触发器 | Cron 表达式调度 | P2 |

---

### 里程碑 3：完整产品（第 9-12 周）

**目标**：角色系统、效率工具、加固优化、文档完善。

#### Module I: 角色系统 + 效率工具（第 9-10 周）
- 技能碎片收集 → 角色合成 → 一键切换
- 模板库、快速启动器、效率仪表盘

#### Module J: 加固优化（第 10-12 周）
- 性能优化：React.memo、代码分割、IPC 批量
- 审计日志：追加式 + 轮转
- CSS 规范化
- 全平台测试
- 文档完善

---

## 第六部分：模块接口契约

每个模块对外暴露的接口必须在开发前确定，AI 并行开发时严格遵循。

### Module A: 中间件盒子核心

```typescript
// 对外接口
interface MiddlewareBox {
  // 请求拦截
  intercept(request: AgentRequest): Promise<AgentResponse>
  
  // 规则管理
  loadRules(agentId: string): Promise<RuleSet>
  injectRules(agentId: string, rules: RuleSet): Promise<void>
  
  // 能力追踪
  trackOperation(agentId: string, op: OperationRecord): Promise<void>
  getProfile(agentId: string): Promise<AgentCapabilityProfile>
  
  // 健康检查
  healthCheck(): HealthStatus
}
```

### Module B: 模型网关

```typescript
interface ModelGateway {
  listProviders(): Provider[]
  chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse>
  embed(request: EmbedRequest): Promise<EmbedResponse>
  getUsage(agentId: string): UsageStats
}

// 统一请求格式 (Anthropic Messages 兼容)
interface UnifiedChatRequest {
  model: string
  system: string
  messages: Message[]
  max_tokens: number
  temperature: number
  provider?: string  // 不指定则自动路由
}
```

### Module E: MCP Skill 路由

```typescript
interface MCPSkillRouter {
  registerSkill(manifest: SkillManifest): void
  listSkills(): SkillManifest[]
  callSkill(skillId: string, params: any, agentId: string): Promise<any>
  installFromMCP(mcpServerUrl: string): Promise<SkillManifest>
}
```

---

## 第七部分：时间线总览

| 里程碑 | 周次 | 核心交付 | 状态 |
|--------|------|---------|------|
| **M1: Demo** | 1-4 | 中间件盒子 + 模型网关 + 智能体面板 + DBHT | 🎯 可演示 |
| **M2: 生态** | 5-8 | MCP Skill + 多窗口 + 多Agent协同 + 工作流 | 🚀 可试用 |
| **M3: 完整** | 9-12 | 角色系统 + 效率工具 + 加固 + 文档 | ✅ 可发布 |

| Phase | 内容 | 时间 | 累计 |
|-------|------|------|------|
| Phase 0 | 平台底座 + 中间件盒子核心 + DBHT 集成 | 2 周 | 0.5 个月 |
| Phase 1 | 模型网关 + 智能体管理面板 | 2 周 | 1 个月 |
| Phase 2 | MCP Skill 系统 + 多窗口项目 | 2 周 | 1.5 个月 |
| Phase 3 | 多 Agent 协同 + 工作流引擎 | 2 周 | 2 个月 |
| Phase 4 | 角色系统 + 效率工具 | 2 周 | 2.5 个月 |
| Phase 5 | 加固优化 + 测试 + 文档 | 2 周 | **3 个月** |

---

## 第八部分：设计决策记录

### 决策 1: 中间件盒子是唯一通道

**约束**: 智能体不能直接访问文件系统、网络、Skill、知识库。所有操作必须通过中间件盒子。

**原因**:
- 开发分离：智能体之间不会互相污染
- 不乱装：智能体只能在分配的安装区域操作
- 不重复装：中间件检测重复安装并阻止
- 记录不丢失：所有操作记录由中间件盒子写入 DBHT
- 可评估：所有能力使用和策略选择被中间件盒子追踪

### 决策 2: MCP 原生兼容（v4.0 新增）

深蓝 Skill = MCP Server + 深蓝增强元数据。不另起炉灶定义私有 Skill 协议，
而是兼容 MCP 标准协议。差异化在"增强层"：能力追踪、策略画像、版本管理、权限管控。

**原因**:
- 降低 Skill 开发者接入成本（已有大量 MCP Server）
- 解决 Skill 市场冷启动问题
- 深蓝的价值在管理/评估层，不在协议层
- MCP 正在成为 AI 工具交互的事实标准

### 决策 3: DBHT 同时是版本总线和记忆总线

DBHT 存储两类数据：
- **版本数据**：模块代码、规则文件、配置文件 — 用于回滚
- **记忆数据**：智能体操作记录、知识积累、策略选择 — 用于持久化和评估

### 决策 4: 规则注入代替 VM 沙箱

```diff
- VM 沙箱：限制文件/网络/进程访问 → 安全但严重限制 AI 开发能力
+ 规则注入：通过 DBHT 版本化规则文件约束行为 → 灵活且可追溯回滚
```

### 决策 5: 模块接口契约先行

每个模块在开发前必须定义对外接口（TypeScript interface）。
模块间只通过接口通信，不直接依赖实现。
这使多个 AI 智能体可以并行开发不同模块，互不阻塞。

---

## 第九部分：风险矩阵

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 中间件盒子成为性能瓶颈 | 中 | 高 | 异步队列处理；关键路径零拷贝；健康守护熔断 |
| MCP 协议演进不兼容 | 低 | 中 | 适配层隔离 MCP 版本差异；关注 MCP spec 更新 |
| DBHT 记忆文件过大影响启动 | 中 | 中 | 记忆分段加载；定期归档压缩 |
| 多 Agent 协同竞争资源 | 高 | 中 | 中间件盒子调度队列；优先级机制 |
| 规则文件过于宽松/严格 | 中 | 中 | 平台内置推荐规则模板；AI 辅助调整 |
| Skill 生态冷启动 | 中 | 中 | **MCP 兼容降风险**；内置 5 个官方 Skill；AI 可从 MCP Server 生成 |
| 并行开发模块集成冲突 | 高 | 中 | 接口契约先行；每个模块独立 DBHT 版本；集成测试自动化 |
| 3 个月时间不够 | 中 | 高 | 优先保证 M1 Demo 和 M2 核心生态；Phase 4-5 可后延 |

---

## 第十部分：商业模式简述

| 收入来源 | 说明 | 阶段 |
|----------|------|------|
| API Key 聚合充值 | 平台统一充值，赚取批量折扣差价 | M1+ |
| 深蓝聚合平台会员 | 高级功能：无限 Agent、高级规则模板、云同步 | M2+ |
| Skill 市场分成 | 付费 Skill 平台抽成 15-30% | M3+ |
| 企业版 | 私有部署、SSO、审计合规 | M3+ |

---

## 附录 A：与竞品的差异化定位

```
               单智能体 ←──────────────────→ 多智能体协同
                  │                                │
    深度集成      │  Cursor          深蓝驾驭工程   │  平台化管理
    工具层        │  Copilot         (你的位置)     │  中间件盒子
                  │  Claude Code                    │  MCP 路由
                  │                                │
    轻量级        │  ChatGPT         CrewAI        │  编排层
    单次交互      │  DeepSeek Chat   AutoGen       │  工作流引擎
                  │                                │
```

深蓝驾驭工程是**唯一一个同时覆盖多智能体协同、平台化管理和 MCP 生态兼容的桌面产品**。

---

## 附录 B：模块并行开发接口清单

| 接口名 | 提供方 | 消费方 | 关键方法 |
|--------|--------|--------|---------|
| `IMiddlewareBox` | Module A | B, C, E, G | intercept, trackOp, healthCheck |
| `IModelGateway` | Module B | A, G, H | chat, listProviders, getUsage |
| `IDBHTStore` | Module D | A, E, G | readMemory, writeMemory, commit, rollback |
| `IMCPSkillRouter` | Module E | A, C, G | registerSkill, callSkill, installFromMCP |
| `IWindowManager` | Module F | C, H | createProjectWindow, focusWindow |
| `IAgentBus` | Module G | A, C, H | routeMessage, getAgentStatus |
| `IWorkflowEngine` | Module H | G, I | execute, pause, resume, cancel |
| `IRoleEngine` | Module I | C | synthesizeRoles, getUnlocks |
