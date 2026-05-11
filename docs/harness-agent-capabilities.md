# 驾驭智能体能力升级 — 技术方案

## 当前状态

已完成：
- 核心工具系统（wake/stop/status/broadcast/task_project + P1 文件/Shell）
- Agent Loop 循环（LLM stream → tool calls → execute → feed results → loop）
- 权限管道（多层检查 + autoTrustConfirm 预授权）
- 会话记忆（跨轮次 conversationHistory）
- 工具按需发现（core: false 标记，skill_discovery 查询）
- PTY 回复收集（sendAndCollect — 本轮已实现）

## 待解决问题

### 1. 降智（Model Degradation）
**现象**: AI 选择错误的工具、输出偏离指令、问多余问题
**根因**:
- 系统提示词虽然已精简约 300 字符，但 API tool declarations 仍包含 6 个核心工具的参数 schema
- 对话历史累积后 context 膨胀
- 部分工具参数描述不够精确，导致 AI 传错参数

**方案**:
- [ ] 1a. 精简核心工具参数 schema（去除冗余 description，合并相似参数）
- [ ] 1b. 对话历史智能压缩：当 messages 超过 20 条时，将早期工具调用结果压缩为摘要
- [ ] 1c. 工具结果截断：单次 tool_result 超过 2000 字符自动截断（已部分实现 sendAndCollect 3000 字符限制）
- [ ] 1d. 添加工具使用示例到系统提示（few-shot 比规则描述更有效）

### 2. 多任务自主工作流（Autonomous Multi-Step）
**现象**: 驾驭智能体只能单次响应，无法自主规划→执行→检查→修正
**根因**:
- AgentLoop 在收到用户消息后运行，完成后停止
- 没有自主触发机制
- 没有任务队列和状态追踪

**方案**:
- [ ] 2a. 任务队列：AgentTaskQueue 管理待办任务，支持优先级
- [ ] 2b. 自主循环模式：用户说"持续监控"时，Agent 进入 loop 模式（计划→执行→等待结果→检查→汇报→循环）
- [ ] 2c. 项目反馈解析：task_project 已通过 sendAndCollect 收集回复，还需解析回复中的关键信息（成功/失败/需要人工介入）
- [ ] 2d. 工作流模板：预定义常见多步骤流程（项目体检→修复→验证 / 多项目同步→检查→汇总）

### 3. 定时检查 & 后台监控（Scheduled/Periodic）
**现象**: 驾驭智能体不能定时检查项目状态或自动执行周期任务
**根因**:
- 没有调度器触发 Agent Loop
- Agent Loop 是请求-响应模型，不是事件驱动

**方案**:
- [ ] 3a. HarnessScheduler：基于 setInterval 的简易调度器，在主进程运行
- [ ] 3b. 定时触发器：用户可配置"每 N 分钟检查所有项目状态并汇报"
- [ ] 3c. 事件触发器：PTY 异常退出 / 项目产出新文件 / Git 新提交 → 触发 Agent 分析
- [ ] 3d. 后台 Agent 运行：调度触发时 Agent 静默运行（不弹出聊天面板），结果写入通知

### 4. 项目间协调（Cross-Project Orchestration）
**现象**: 多个项目 AI 各自工作，没有汇总和交叉引用
**根因**:
- broadcast 是 fire-and-forget
- 没有汇总机制

**方案**:
- [ ] 4a. gather_results 工具：向所有在线项目发送相同问题，等待全部回复后汇总
- [ ] 4b. 依赖链：项目 A 的产出 → 项目 B 的输入（通过文件路径传递）
- [ ] 4c. 汇总报告：定制的 multi-project 状态报告模板

---

## 实施顺序（按依赖关系）

```
Phase A: 降智加固（1a→1b→1c→1d）
   ↓
Phase B: 任务队列 + 反馈解析（2a→2c）
   ↓
Phase C: 自主循环模式（2b）
   ↓
Phase D: 定时调度（3a→3b→3c→3d）
   ↓
Phase E: 跨项目协调（4a→4b→4c）
```

每个 Phase 独立可测，完成后提交 DBHT 版本。

---

## Phase A: 降智加固 — 详细设计

### A1. 精简核心工具参数 schema
**文件**: `electron/harnessAgent/tools.ts`
**改动**: 每个核心工具（wake_projects, stop_projects, check_status, broadcast, task_project, skill_discovery）的 parameters.description 精简到 1 行。

### A2. 对话历史智能压缩
**文件**: `electron/harnessAgent/agentLoop.ts`
**改动**: 在 run() 方法中，每轮工具调用完成后检查 messages 数量。超过 20 条时：
- 保留 system prompt
- 保留最近 4 轮对话
- 中间的 tool_call + tool_result 压缩为摘要消息：
  `[历史摘要] 已执行 N 次工具调用: wake_projects(成功), task_project x2(成功), check_status(成功)`

### A3. 工具结果截断
**文件**: `electron/harnessAgent/agentLoop.ts`
**改动**: 在 executeTool 调用后，检查 result.output.length > 2000，截断并添加 `...(已截断)`。

### A4. Few-shot 示例
**文件**: `electron/harnessAgent/agentLoop.ts` buildSystemPrompt()
**改动**: 在系统提示末尾追加 2 个精简示例：
```
示例1 — 用户说"检查所有项目状态":
  → 直接调 check_status，汇报结果
示例2 — 用户说"让 fox_ai 检查它的 git 状态":
  → 调 task_project(project_path="J:\gameGitRes\kimiHorse\fox_ai", task="请检查你的 git 状态并汇报")
  → 等待回复，汇报给用户
```

---

## Phase B: 任务队列 + 反馈解析

### B1. AgentTaskQueue
**新文件**: `electron/harnessAgent/taskQueue.ts`
**数据结构**:
```typescript
interface AgentTask {
  id: string
  type: 'user_request' | 'auto_check' | 'follow_up'
  projectPath?: string
  instruction: string
  priority: number  // 1=高 2=中 3=低
  status: 'pending' | 'running' | 'done' | 'failed'
  createdAt: string
  result?: string
}
```
**功能**: 单例队列，支持 add/getNext/updateStatus/clear

### B2. 任务队列工具
**文件**: `electron/harnessAgent/tools.ts`
**新增工具**:
- `queue_status`: 查看当前任务队列
- `add_follow_up`: 向队列添加后续任务

### B3. 反馈解析
**文件**: `electron/harnessAgent/tools.ts`
**改动**: task_project 的 sendAndCollect 回复中检测关键词：
- "成功" / "完成" / "done" / "✓" → 标记成功
- "失败" / "错误" / "error" / "✗" → 标记失败，提取错误信息
- 返回结构化结果: `{ status: 'success'|'failed'|'unclear', summary: string, detail: string }`

---

## Phase C: 自主循环模式

### C1. 自主循环标志
**文件**: `electron/harnessAgent/agentLoop.ts`
**改动**: AgentContext 新增 `autonomousMode: boolean`
**行为**: 当 autonomousMode=true 时，Agent 在完成一轮后：
1. 检查任务队列是否有待办
2. 有 → 取下一个任务，执行
3. 无 → 汇报"全部任务完成"，退出自主模式

### C2. 自主模式触发
**文件**: `electron/modules/harnessIpc.ts`
**改动**: 新增 IPC `harness:start-autonomous`，参数：初始任务 + 检查间隔
**流程**: 
1. 用户输入"持续监控项目状态，每 5 分钟汇报"
2. Agent 解析为 autonomousMode + 定时任务
3. Agent 持续运行直到用户中止

---

## Phase D: 定时调度

### D1. HarnessScheduler
**新文件**: `electron/harnessAgent/scheduler.ts`
**功能**:
- 注册定时任务（cron 或间隔）
- 到时间触发 Agent Loop（带预设 prompt）
- 静默运行（不打开 UI 面板，结果推送到通知）

### D2. 调度 IPC
**文件**: `electron/modules/harnessIpc.ts`, `electron/preload.ts`
**新增 IPC**:
- `harness:schedule-add` — 添加定时任务
- `harness:schedule-remove` — 移除定时任务
- `harness:schedule-list` — 列出所有定时任务

### D3. 事件触发
**文件**: `electron/modules/ptyManager.ts`
**改动**: PTY 异常退出时，除了通知渲染进程，也触发 Agent 事件（Agent 可以自动重启项目）

---

## Phase E: 跨项目协调

### E1. gather_results 工具
**文件**: `electron/harnessAgent/tools.ts`
**新增工具**: `gather_results` — 向所有在线项目发送相同问题，并行等待回复，汇总返回

### E2. 汇总报告模板
**文件**: `electron/harnessAgent/tools.ts`
**新增工具**: `summary_report` — 生成多项目状态报告（使用 check_status + 最近 task_project 结果）

---

## 测试策略

每个 Phase 完成后：
1. TypeScript 编译通过
2. Vite 构建通过
3. 手动测试：启动 DBGHF → 打开驾驭智能体 → 发送测试指令
4. 检查控制台日志确认新功能执行路径正确
5. DBHT 提交
