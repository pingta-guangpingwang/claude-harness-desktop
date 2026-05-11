# 驾驭智能体改造技术方案

## 一、现状分析

### 当前驾驭智能体的局限

| 问题 | 根因 |
|------|------|
| AI 调用返回空响应 | `callAI` 调 DeepSeek Anthropic 兼容端点不稳定 |
| "你好"等简单对话失败 | 意图分类 prompt 要求输出 JSON，简单对话匹配不到意图 |
| wakeAll 失败 | 绕过 ChatContext 直接调 ptySpawn，后续 chat.launch 又重复 spawn |
| 无真正 AI 能力 | 关键词匹配为主，AI 只做意图分类不做推理执行 |
| 依赖外部 Claude Code | 每个项目需独立 PTY spawn Claude Code CLI，资源消耗大 |

### 外部 Claude Code 的架构范式（来自源码泄露分析）

Claude Code 的核心范式（512K 行 TypeScript → OpenHarness 仅 11.7K 行 Python 还原 98% 工具覆盖）：

```
User Input
  │
  ▼
System Prompt (instructions + environment + tools)
  │
  ▼
┌────────────── Agent Loop ──────────────┐
│                                         │
│  LLM Call (stream)                      │
│    │                                    │
│    ├─ Text delta → render to user       │
│    ├─ Tool call → parse & validate      │
│    │    ├─ Permission check             │
│    │    ├─ Execute tool                 │
│    │    └─ Return result to LLM         │
│    └─ Finish → check next speaker       │
│         ├─ tool_calls pending → loop    │
│         └─ no tool_calls → respond      │
└─────────────────────────────────────────┘
```

**核心设计模式**：
1. **工具即函数声明** — 每个能力被定义为 LLM function calling schema
2. **递归思考-执行循环** — LLM 决定何时调用工具、何时结束
3. **权限门控** — 危险操作需用户确认（allow/deny/ask）
4. **流式输出** — 思考过程实时可见
5. **子智能体** — 复杂任务 spawn 专项 agent

## 二、改造目标

将驾驭智能体从"关键词路由器 + 外部 Claude Code PTY"升级为：

**一个完整的内嵌 AI Agent**，使用我们自己的 DeepSeek API，直接操控驾驭工程的全部项目和资源。

```
改造前：
  用户 → 关键词匹配 → 直接调 ptySpawn / ptyWrite
  用户 → AI 意图分类 → JSON action → switch/case 执行

改造后：
  用户 → HarnessAgent (Agent Loop)
           │
           ├─ Think (DeepSeek API streaming)
           ├─ Tool: wake_project / stop_project / broadcast / check_status
           ├─ Tool: read_file / write_file / shell_exec
           ├─ Tool: manage_tasks / query_kb / generate_mindmap
           └─ Respond (自然语言 + 执行结果)
```

## 三、技术架构

### 3.1 整体分层

```
┌──────────────────────────────────────────────────┐
│  Electron Renderer (React)                        │
│  ┌────────────────────────────────────────────┐   │
│  │  HarnessAgentPanel (UI)                     │   │
│  │  ├─ 对话 Tab: 流式消息 + 工具调用可视化     │   │
│  │  ├─ 监控 Tab: 心跳 + 权限 + 快捷操作        │   │
│  │  └─ 权限弹窗: 危险操作确认 (allow/deny)     │   │
│  └────────────────────────────────────────────┘   │
│              ↕ IPC (contextBridge)                 │
├──────────────────────────────────────────────────┤
│  Electron Main Process                            │
│  ┌────────────────────────────────────────────┐   │
│  │  HarnessAgent (核心 Agent 循环)             │   │
│  │                                             │   │
│  │  AgentLoop.run(userMessage)                 │   │
│  │    → buildSystemPrompt(env, tools)          │   │
│  │    → while (notDone) {                      │   │
│  │        response = await callAIStream(...)   │   │
│  │        for event in response:               │   │
│  │          if text → push to renderer         │   │
│  │          if tool_call →                      │   │
│  │            check permission                 │   │
│  │            execute tool                     │   │
│  │            append result to messages        │   │
│  │      }                                       │   │
│  │    → return final response                   │   │
│  │                                             │   │
│  │  ToolRegistry                               │   │
│  │    wakeProjects, stopProjects,              │   │
│  │    broadcast, checkStatus,                  │   │
│  │    readFile, writeFile, shellExec,          │   │
│  │    manageTasks, queryKB, generateMindmap    │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  ┌────────────────────────────────────────────┐   │
│  │  ChatContext / PTY Manager (保留)           │   │
│  │  → 项目级 Claude Code 终端（按需启动）      │   │
│  └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

### 3.2 Agent Loop 详细设计

```typescript
// electron/harnessAgent/agentLoop.ts

interface AgentTool {
  name: string
  description: string
  parameters: JSONSchema
  execute(params: any, ctx: AgentContext): Promise<ToolResult>
  requiresConfirmation?: boolean  // 是否需要用户确认
}

class AgentLoop {
  private tools: Map<string, AgentTool>
  private messages: AIMessage[]
  private apiKey: string
  private model: string

  async run(userMessage: string, onEvent: (e: AgentEvent) => void): Promise<void> {
    this.messages.push({ role: 'user', content: userMessage })

    while (true) {
      const response = await this.callAIStream()

      let pendingToolCalls: ToolCall[] = []

      for await (const event of response) {
        if (event.type === 'text') {
          onEvent({ type: 'text', content: event.content })
        }
        if (event.type === 'tool_call') {
          pendingToolCalls.push(event)
        }
      }

      if (pendingToolCalls.length === 0) break  // Agent 完成

      // 执行工具并收集结果
      for (const tc of pendingToolCalls) {
        const tool = this.tools.get(tc.name)
        if (!tool) continue

        if (tool.requiresConfirmation) {
          const decision = await this.askUserPermission(tc)
          if (decision === 'deny') continue
        }

        onEvent({ type: 'tool_start', name: tc.name, params: tc.params })
        const result = await tool.execute(tc.params, this.ctx)
        onEvent({ type: 'tool_result', name: tc.name, result })

        this.messages.push({
          role: 'assistant',
          content: '',
          tool_calls: [tc]
        })
        this.messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          tool_call_id: tc.id
        })
      }
    }
  }
}
```

### 3.3 工具清单

| 工具名 | 描述 | 需确认 | 优先级 |
|--------|------|--------|--------|
| `wake_projects` | 启动指定/全部项目的 PTY 终端 | ❌ | P0 |
| `stop_projects` | 停止指定/全部项目的 PTY 终端 | ✅ | P0 |
| `broadcast` | 向全部在线项目广播 shell 命令 | ✅ | P0 |
| `check_status` | 检查全部项目心跳状态 | ❌ | P0 |
| `read_project_file` | 读取项目文件内容 | ❌ | P1 |
| `write_project_file` | 写入项目文件 | ✅ | P1 |
| `shell_exec` | 在指定项目执行 shell 命令 | ✅ | P1 |
| `manage_tasks` | 创建/更新/删除项目任务 | ❌ | P1 |
| `query_knowledge_base` | 查询项目知识库 | ❌ | P2 |
| `generate_mindmap` | 生成项目思维导图 | ❌ | P2 |
| `git_status` | 检查项目 git/DBHT 状态 | ❌ | P2 |
| `search_codebase` | 跨项目代码搜索 | ❌ | P2 |

### 3.4 权限模型

```
┌─────────────────────────────────────┐
│  PermissionManager                   │
│                                     │
│  check(tool, params) → Decision     │
│    ├─ ALLOW    → 直接执行            │
│    ├─ DENY     → 拒绝 + 告知原因     │
│    └─ ASK_USER → 弹窗确认            │
│                                     │
│  Rules:                              │
│  - autoTrustConfirm: 免除信任提示    │
│  - autoApproveReads: 读取免确认      │
│  - confirmBeforeWrites: 写入需确认   │
│  - blockDestructive: 拦截 rm -rf 等  │
│  - autoWakeDead: 掉线自动重连        │
└─────────────────────────────────────┘
```

### 3.5 与现有 ChatContext 的关系

```
HarnessAgent (内嵌)          ChatContext (现有)
─────────────────────       ─────────────────
控制层 AI                   项目层 AI
管理所有项目                 每个项目独立 Claude Code
DeepSeek API (callAI)       Claude Code CLI (PTY)
轻量 Agent Loop             完整 Claude Code Agent
串行/并行 控制多个项目       单项目深度开发

共存模式：
- 驾驭智能体 → 宏观管理（启动/停止/广播/状态）
- 项目 Chat → 微观开发（写代码/debug/重构）
- 驾驭智能体可以在没有 API Key 时降级为关键词模式
```

## 四、实施计划

### Phase 1: 修复 + 基础 AI 通信 (立即)

**目标**: 让驾驭智能体对话先跑通

1. 修复 `callAI` 空响应问题
   - 检查 API endpoint / model name 是否正确
   - 增加更详细的错误日志
   - 支持多 provider 回退（DeepSeek → OpenAI compatible）

2. 改进 System Prompt
   - 对话意图不走 JSON action 流程
   - 直接返回自然语言回复
   - 仅在需要执行操作时才返回 JSON

### Phase 2: Agent Loop 核心 (1-2天)

**目标**: 实现 Claude Code 范式的 Agent 循环

1. 在 `electron/harnessAgent/` 创建 Agent Loop
   - `agentLoop.ts` — 核心循环
   - `toolRegistry.ts` — 工具注册表
   - `permissionManager.ts` — 权限管理
   - `types.ts` — 类型定义

2. 实现首批工具 (P0)
   - wake_projects / stop_projects / broadcast / check_status

3. IPC 桥接
   - 新增 `harness:send` / `harness:stream` / `harness:permission` 通道
   - preload.ts 暴露 API

### Phase 3: UI 升级 (1天)

**目标**: 驾驭智能体面板支持 Agent 范式

1. 流式消息渲染（Agent 思考过程可见）
2. 工具调用可视化（展示 Agent 正在执行什么操作）
3. 权限确认弹窗（allow / deny 交互）
4. 历史消息持久化

### Phase 4: 扩展工具 + 降级 (1-2天)

**目标**: 丰富工具集 + 离线可用

1. P1 工具：read/write/shell/manage_tasks
2. 离线关键词降级模式（无 API Key 时）
3. 多项目并行工具调用
4. 操作审计日志

## 五、关键技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| AI 后端 | DeepSeek API (现有 callAI) | 已集成，用户持有 key |
| Agent 框架 | 自研轻量 Agent Loop | 避免引入 Effect-TS 等重依赖，适配 Electron |
| 流式协议 | SSE / 分块 JSON | 兼容 DeepSeek Anthropic 端点 |
| 工具定义 | JSON Schema (OpenAI function calling 格式) | LLM 通用标准 |
| 消息持久化 | JSON 文件 (现有模式) | 轻量，无需 SQLite |
| 权限存储 | Memory + JSON 持久化 | 与现有 HarnessPermissions 一致 |

## 六、与开源项目的对比借鉴

| 项目 | 借鉴点 | 不采用原因 |
|------|--------|-----------|
| **Claude Code (泄露源码)** | Agent Loop 范式、工具系统设计、Prompt 工程 | 专有代码，法律风险 |
| **Gemini CLI (Google)** | monorepo 结构、core/cli/sdk 分离、SDK 嵌入 API | 绑定 Gemini，需改造 provider |
| **OpenCode** | Effect-TS 架构、plugin 系统、SQLite 持久化 | Effect-TS 学习曲线陡，太重 |
| **OpenHarness (港大)** | MIT 许可、1.1万行精简、98%工具覆盖 | Python，与 TypeScript 技术栈不匹配 |

**核心思路**：自研轻量 Agent Loop，借鉴 Claude Code 的工具-思考-执行循环范式，使用我们已有的 DeepSeek API 和 Electron IPC 基础设施。
