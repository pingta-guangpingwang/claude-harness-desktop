# 驾驭智能体技术文档

> DeepBlue God Harness Farm (DBGHF) — AI 驾驭智能体完整技术参考
> 最后更新: 2026-05-23

---

## 1. 概述

驾驭智能体（Harness Agent）是 DBGHF 的核心 AI 引擎，运行在 Electron 主进程。它通过 LLM 驱动的 Agent Loop 自动管理多个 Claude Code 项目终端：唤醒、派活、诊断、修复，全程自主运行无需人工干预。

### 1.1 架构定位

```
用户指令 → HarnessAgentPanel (React)
           → harness:run IPC
           → AgentLoop.run()
           → LLM Stream (DeepSeek V4 / Anthropic Claude)
           → Tool Calls (executeTool)
           → PTY Manager (node-pty ConPTY)
           → Claude Code 项目终端
```

### 1.2 核心能力一览

| 能力 | 状态 | 说明 |
|------|------|------|
| 多项目管理 | ✅ | 同时管理 N 个项目终端，并行任务派发 |
| 自主循环 | ✅ | 心跳守卫机制，任务完成前不停机 |
| 任务队列 | ✅ | 优先级队列，支持自主取件和用户插队 |
| 定时调度 | ✅ | 周期性任务注入，Scheduler 模块 |
| 策略框架 | ✅ | OBSERVE→DIAGNOSE→DECIDE→VERIFY 四步推理 |
| Reflection 循环 | ✅ | 工具执行后结构化反思，动态调整策略 |
| 错误诊断 | ✅ | 分层分诊：配置/权限/网络/项目错误 |
| 知识库 | ✅ | API 配置配方 + 错误模式匹配 + 可搜索 |
| 虚拟滚动 | ✅ | 驾驭聊天窗口只渲染可见区域，上滚动态加载 |
| 中文 .bat 支持 | ✅ | UTF-8 BOM 解决 Windows CMD GBK 乱码 |

---

## 2. Agent Loop 主循环

### 2.1 文件

`electron/harnessAgent/agentLoop.ts` — 核心 ~1100 行

### 2.2 执行流程

```
1. buildSystemPrompt()        → 三层提示词组装
2. user message → messages[]  → 注入用户指令 + 动态上下文
3. callLLMStream()            → SSE 流式调用 DeepSeek/Anthropic
4. parseToolCalls()           → 从响应中提取 tool_use
5. [权限检查]                  → PermissionManager 多层管道
6. executeTool()              → 执行内置工具
7. [Reflection]               → reflector.ts 结构化反思
8. feedToolResults()          → 工具结果注入消息历史
9. compressHistory()          → 超过阈值时智能压缩
10. completionGuard()          → 心跳检查 → 继续或停止
```

### 2.3 完成守卫 (Completion Guard)

三层防早停机制：

- **C0**: 空响应检测 — LLM 返回空内容时注入提示
- **C1**: 紧凑提示检测 — LLM 说"所有任务已完成"时检查 activeProjectTasks
- **C2**: 心跳守卫 — 有活跃项目任务时禁止停止，注入心跳 prompt，重置 maxTurns

心跳自动清理：项目 busy 标记超过 5 分钟自动过期。

### 2.4 系统提示词架构

三层结构：

1. **核心提示词 (~80 行，始终注入)**: 角色定义、策略框架、核心铁律、范围纪律
2. **动态上下文 (每轮按需)**: 项目状态快照、活跃任务摘要、上一轮 Reflection 结论
3. **知识库引用 (工具触发时)**: API 配方、错误诊断树、bat 规范

### 2.5 策略思考框架

LLM 每轮决策前使用的推理框架：
1. **OBSERVE** — 项目状态/终端输出/阻塞信号
2. **DIAGNOSE** — 分类: 🟢正常/🟡需行动/🔴阻塞/⚪信息不足
3. **SCOPE** — 用户指定了哪些项目（不动其他的）
4. **DECIDE** — 最小必要行动（优先 1 个工具，最多 2 个）
5. **VERIFY** — 检查结果，不重复同样的错误
6. **REMEMBER** — 解阻塞 ≠ 任务完成，必须追问原始任务
7. **CONTINUE** — 有项目在工作中 → 继续下一轮

### 2.6 compressHistory

超过阈值时智能压缩对话历史：
- 保留系统提示词
- 保留最近 3 轮完整对话
- 更早轮次提取为结构化摘要（操作了哪些项目、关键发现、进行中的任务）
- 工具结果截断到 150 字符首行

---

## 3. 工具系统

### 3.1 文件

- `electron/harnessAgent/tools.ts` — 工具实现 (~1900 行)
- `electron/harnessAgent/toolRegistry.ts` — 工具注册与发现
- `electron/harnessAgent/types.ts` — 类型定义

### 3.2 P0 核心控制工具

| 工具 | 功能 | 关键特性 |
|------|------|----------|
| `wake_projects` | 启动/唤醒项目终端 | 纯唤醒工具，内置 ping 验证，严禁接 task_project |
| `check_status` | 检查项目心跳状态 | 返回连接/活跃度/语义标签，自动清理过期 busy |
| `stop_projects` | 停止项目终端 | 安全关闭 PTY 会话 |

### 3.3 P1 任务派发工具

| 工具 | 功能 | 关键特性 |
|------|------|----------|
| `task_project` | 向单项目派发任务 | sendAndCollect 收集回复，忙保护，错误自动跟进 |
| `broadcast` | 向全部项目广播 | 并行派发，busy 项目自动跳过，project_response 事件推送 |
| `read_project_chat` | 查看终端输出 | messageStores.responses 零 IPC 延迟直接读取 ● 响应 |
| `poll_projects` | 批量轮询状态 | 20-40s 等待，自动清理过期 busy（>2min 空闲），最多 3 轮 |
| `stop_task` | 终止项目 AI 任务 | Ctrl+C 发送，安全终止 |

### 3.4 P2 诊断与知识库工具

| 工具 | 功能 | 关键特性 |
|------|------|----------|
| `diagnose_project` | 诊断项目问题 | 读取 settings.json + PTY 错误快照，分诊：配置/权限/网络/项目 |
| `search_knowledge` | 搜索知识库 | API 配置配方 + 错误恢复模式匹配 |

### 3.5 P3 基础设施工具

| 工具 | 功能 |
|------|------|
| `write_to_pty` | 直接写入终端（应答对话框/发送按键） |
| `shell_exec` | 执行系统命令（仅用于环境检查/配置读写） |
| `write_file` / `read_file` | 读写配置文件（JSON/bat/ps1/txt） |
| `list_files` | 列出目录文件 |

### 3.6 P4 项目生态工具

| 工具 | 功能 |
|------|------|
| `create_project` | 创建新项目并配置 Claude Code 终端 |
| `generate_launch_bats` | 为项目生成 Windows 启动脚本（UTF-8 BOM） |
| `audit_project` | 审查项目配置和代码质量 |
| `list_available_plugins` | 列出插件商店可用插件 |
| `install_plugin` | 安装插件到指定项目 |

### 3.7 P5 任务队列工具

| 工具 | 功能 |
|------|------|
| `queue_status` | 查看当前任务队列状态 |
| `add_follow_up` | 添加后续任务到队列 |

### 3.8 工具结果摘要

`summarizeToolResult()` 在 agentLoop.ts 中：超过 500 字符的工具结果自动提取关键行（匹配 ✅/❌/⚠️/失败/成功 等模式），避免 LLM 上下文膨胀。

---

## 4. PTY 终端管理

### 4.1 文件

`electron/modules/ptyManager.ts` — ~1050 行

### 4.2 核心功能

- **会话池管理**: Map<projectPath, PtySession>，支持 spawn/kill/restart
- **自动应答**: 信任对话框/权限确认/更新提示自动识别并回复
- **数据管道**: 原始 PTY 数据 → TUI 清洗 → messageStores 分发
- **sendAndCollect**: 8 秒空闲超时 + 硬超时保护，cleanAgentOutput 去噪

### 4.3 messageStores — 零 IPC 读取

Agent 读取项目 AI 回复的关键路径：

```
pty.onData → appendRawOutput
           → ● 标记检测 (line.indexOf('●'))
           → messageStores.responses.push(cleaned)
           → getRecentPtyOutput() 直接读取（零 IPC 延迟）
```

数据来源优先级：
1. `messageStores.responses` — 主进程直接捕获的 ● 响应（主源）
2. `chatMessages` — 渲染进程 IPC 推送（辅助）
3. `messageStores.dialogs` — 对话框历史
4. `readableBuffer` — 兜底原始数据

### 4.4 cleanAgentOutput

PTY 原始数据清洗管道：
- OSC/CSI/ESC 序列移除
- TUI 动画过滤（✻✽⏳ 状态行）
- 页脚/状态栏残片过滤
- 连续相同行去重
- ● 标记上下文提取（前 500 字符 + 后全部）
- 最终截断 >5000 字符

### 4.5 自动应答

ptyManager 内置智能应答：
- 信任对话框: `/Do you trust|trust this folder/i` → 自动 Enter
- 权限确认: `/Do you want to proceed|proceed/i` → 自动发 "1"
- 更新提示: `/update available|update now/i` → 自动 Esc
- API Key 对话框: `/API Key|Enter your/i` → 上报 Agent 处理

---

## 5. Reflection 循环

### 5.1 文件

`electron/harnessAgent/reflector.ts`

### 5.2 工作原理

在工具执行后、下一轮 LLM 调用前插入轻量级反思：

```
Tool Results → [Reflector.callLLM(tool_choice: 'none')] → Next LLM Call
                                              ↓
                                    结构化 JSON 输出:
                                    { observation, diagnosis, confidence,
                                      next_action, strategy_adjustment }
```

- 使用 `tool_choice: 'none'` 强制文本输出，不调工具
- 速度 ~1-2 秒，输出 ~100 tokens
- 反思结论注入下一轮 LLM 的 `[反思]` 前缀

---

## 6. 知识库与错误诊断

### 6.1 文件

`electron/harnessAgent/knowledge.ts`

### 6.2 API 配置知识库

预置 API 配方：
- 标准 Anthropic Claude API
- DeepSeek 官方 API 直连

对于代理/翻译层（Lobster/LiteLLM），通过错误模式匹配自动推断：
- 检测 PTY 输出中的连接错误（Connection refused / 401 / model not found）
- 读取 `.claude/settings.json` 判断当前配置问题
- 根据错误类型推断正确配置（Base URL 格式、模型名映射）

### 6.3 错误分类诊断树

五层分诊体系：

```
├── CONFIG    — API Key / Base URL / 模型名 → search_knowledge 查配方修复
├── PERMISSION — 对话框阻塞 → write_to_pty 自动应答
├── NETWORK   — 连接超时/DNS 失败 → shell_exec ping/nslookup 诊断
├── PROJECT   — package.json 损坏/node_modules 缺失 → task_project 让 AI 自修
└── UNKNOWN   — read_project_chat → 人工判断
```

### 6.4 diagnose_project 工具

自动诊断流程：
1. 读取 `.claude/settings.json`
2. 检查 PTY 终端最近错误输出（getPtyErrorSnapshot）
3. 匹配已知错误模式
4. 返回诊断结果 + 建议恢复步骤

---

## 7. 任务队列与调度

### 7.1 文件

- `electron/harnessAgent/taskQueue.ts` — 优先级队列
- `electron/harnessAgent/scheduler.ts` — 定时调度器

### 7.2 任务队列

```typescript
interface AgentTask {
  id: string
  type: 'user_request' | 'auto_check' | 'follow_up' | 'autonomous'
  projectPath?: string
  instruction: string
  priority: 1 | 2 | 3  // 1=高 2=中 3=低
  status: 'pending' | 'running' | 'done' | 'failed'
  createdAt: string
  result?: string
}
```

特性：
- 优先级排序，高优先级任务自动出队
- 自主模式自动取件 (autoPickup)
- 用户中断消息自动入队 (harness:interrupt → addToQueue)
- 复杂任务自动分割为多个子任务

### 7.3 调度器

HarnessScheduler 定期向任务队列注入检查任务，支持：
- 周期性项目状态检查
- 自定义 crontab 表达式
- 静默模式（结果写入通知，不弹出面板）

---

## 8. 前端渲染优化

### 8.1 虚拟滚动

`HarnessAgentPanel.tsx` 聊天日志窗口：

- **滑动窗口渲染**: 最多渲染 200 条，初始 ~80 条
- **上滚动态加载**: IntersectionObserver 监控顶哨兵，触发展开 50 条
- **滚动位置保持**: useLayoutEffect + prevScrollBottom 记录
- **智能自动滚底**: 仅当用户在底部 (<80px) 时自动滚到底
- **Tab 切回滚底**: 从其他 Tab 切回时自动定位到最新内容

### 8.2 工具结果显示

- 内联预览: 2000 字符（tool_result / project_response）
- 点击展开: 任何超过 2000 字符的输出可点击查看完整内容
- 模态弹窗: 支持复制全文到剪贴板

---

## 9. 项目启动脚本

### 9.1 文件

- `electron/modules/projectLauncher.ts`
- `electron/harnessAgent/tools.ts` (generate_launch_bats)

### 9.2 .bat 生成

生成的 `.dbvs-launch.bat` 文件：
- **UTF-8 BOM**: 防止 Windows CMD 用 GBK 误读中文导致乱码
- **chcp 65001**: 控制台输出使用 UTF-8
- **工具预检**: Node.js / Maven / Python / Go / Docker 存在性检查
- **错误处理**: 非零退出码自动暂停并显示错误

### 9.3 启动命令检测

自动检测项目类型的优先级：
1. `package.json` → npm scripts (dev > start > serve > build)
2. `pom.xml` → `mvn spring-boot:run`
3. `build.gradle` → `gradle bootRun`
4. `go.mod` → `go run .`
5. `Cargo.toml` → `cargo run`
6. `requirements.txt` → `python -m uvicorn`
7. `docker-compose.yml` → `docker-compose up`
8. `Makefile` → `make run`
9. `CMakeLists.txt` → `cmake --build build`
10. `index.html` → `start index.html`

---

## 10. IPC 通信架构

### 10.1 通道清单

| IPC Channel | 方向 | 用途 |
|---|---|---|
| `harness:run` | Renderer→Main | 发送用户指令，启动 Agent Loop |
| `harness:onEvent` | Main→Renderer | Agent 事件流 (thinking/text/tool/result) |
| `harness:abort` | Renderer→Main | 中止 Agent 执行 |
| `harness:interrupt` | Renderer→Main | 用户插话，注入新消息到队列 |
| `harness:permission` | Renderer→Main | 权限确认 (allow/deny/allow_once) |
| `harness:saveLogs` | Renderer→Main | 持久化聊天日志 |
| `harness:loadLogs` | Renderer→Main | 恢复聊天日志 |
| `chat:pushMessages` | Renderer→Main | 实时推送 Chat UI 消息到主进程 |
| `project:generate-launch-bat` | Renderer→Main | 生成启动脚本 |
| `project:launch` | Renderer→Main | 执行启动脚本 |

### 10.2 AgentEvent 类型

```typescript
type AgentEvent =
  | { type: 'thinking_start' }
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call'; id: string; name: string; params: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; result: ToolResult }
  | { type: 'tool_error'; id: string; name: string; error: string }
  | { type: 'permission_needed'; id: string; name: string; params: Record<string, unknown>; reason: string }
  | { type: 'project_response'; projectName: string; projectPath: string; content: string; timestamp: string }
  | { type: 'report_card'; title: string; summary: string; fullReport: string; ... }
  | { type: 'user_queued'; text: string }
  | { type: 'thinking_end' }
  | { type: 'done'; finalMessage: string }
  | { type: 'error'; message: string }
```

---

## 11. 权限系统

### 11.1 文件

`electron/harnessAgent/permissionManager.ts`

### 11.2 多层管道

```
工具调用 → pattern 匹配(deny/allow/ask)
         → 决策: deny → 拒绝 + 记录
                 ask  → 用户确认
                 allow → 预授权名单检查
         → 记录(allow/deny 计数)
         → 自动信任模式(autoTrustConfirm)
```

### 11.3 权限配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| autoTrustConfirm | true | 自动应答终端对话框 |
| autoApproveReads | true | 自动批准只读操作 |
| confirmBeforeWrites | true | 写操作前确认 |
| blockDestructive | true | 拦截危险操作 |
| autoWakeDead | false | 自动唤醒断线项目 |
| memoryCleanupPercent | 70% | 内存清理阈值 |

---

## 12. 持久化

### 12.1 存储路径

`%APPDATA%/dbghf/`

### 12.2 存储内容

| 数据 | 文件 |
|------|------|
| 项目配置 | projects.json |
| 插件配置 | plugins.json |
| 聊天日志 | harness-logs.json |
| 权限设置 | harness-permissions.json |
| 会话数据 | sessions/ (按项目) |
| 角色数据 | identities.json |

### 12.3 聊天日志持久化

- 自动保存: 每次 addLog 后 2 秒防抖写入
- 最大保存: 500 条
- 跨重启恢复: harnessLoadLogs → loadLogs
- 跨视图切换保持: useSyncExternalStore + 独立 store

---

## 13. LLM 适配层

### 13.1 支持的 API

| API | 格式 | Tool Calling | Streaming |
|-----|------|-------------|-----------|
| DeepSeek V4 | OpenAI-compatible | ✅ | ✅ SSE |
| Anthropic Claude | Anthropic Messages | ✅ | ✅ SSE (event: data:) |

### 13.2 DeepSeek 调用

- `callLLMStream()` → OpenAI `/chat/completions` 格式
- SSE 解析: `data:` 行前缀
- `reasoning_content` 嵌入 `[思考]` 前缀
- Tool calling: OpenAI `tools` + `tool_choice: 'auto'`

### 13.3 Anthropic 调用

- `callLLMStream()` → Anthropic `/messages` 格式
- SSE 解析: `event:` + `data:` 双行前缀
- Tool 声明从 OpenAI 格式转为 Anthropic 格式
- Tool use: `content_block_start/delta/stop` + `input_json_delta`
- Tool result: `tool_result` content block 回传

---

## 14. 编译与构建

```bash
# 安装依赖
pnpm install

# 编译 Electron 主进程 (TS → JS)
tsc --project tsconfig.node.json

# 构建前端 (Vite)
vite build

# 完整构建
npm run build

# 开发模式
npm run dev-electron
```

TypeScript 编译目标: ES2020
前端构建: Vite 8 + React 19

---

## 15. 版本历史

| 版本 | 里程碑 |
|------|--------|
| v1.0 | 基础多项目终端 + AI 智能体 |
| v2.0 | 系统托盘、全局热键、悬浮窗口 |
| v2.1 | CLI 命令注册表、别名系统 |
| v2.2 | 插件商店、权限管控 |
| v2.3 | 角色解锁与身份体系 |
| v2.4 | 可视化工作流编辑器 |
| v2.5 | 性能优化、规则引擎、审计日志 |
| **v2.6** | **驾驭智能体核心重构: 策略框架+Reflection+知识库+诊断树+心跳守卫+虚拟滚动** |
