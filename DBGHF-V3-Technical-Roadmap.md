# DBGHF V3.0 技术升级路线图

> **DeepBlue God Harness Farm — 取长补短：借鉴 Google ADK + Kimi Agent Swarm**
> 最后更新: 2026-05-23
> 修订: 第四轮审查 — 补全长文本记忆等8项遗漏

---

## 目录

1. [现状诊断](#1-现状诊断)
2. [借鉴方案分析](#2-借鉴方案分析)
3. [第一轮评审：架构师视角](#3-第一轮评审架构师视角)
4. [第二轮评审：工程实现视角](#4-第二轮评审工程实现视角)
5. [第三轮评审：产品与用户视角](#5-第三轮评审产品与用户视角)
6. [第四轮审查：逐项审计遗漏](#6-第四轮审查逐项审计遗漏)
7. [最终技术方案（八大模块）](#7-最终技术方案)
8. [分阶段实施路线图](#8-分阶段实施路线图)
9. [验收标准](#9-验收标准)

---

## 1. 现状诊断

### 1.1 代码审计结论

| 维度 | 当前状态 | 评分 |
|------|---------|------|
| 核心逻辑量 | agentLoop 1109行 + tools 1917行 + ptyManager 1271行 ≈ 5000行 | B+ |
| 工具数量 | 21个注册工具，P0-P4优先级分层 | B+ |
| 知识库 | 3个API配方 + 9个错误模式（骨架级） | D |
| Reflection | 106行，JSON反思，30秒冷却 | C |
| **上下文管理** | **compressHistory 150字符截断 + 保留最近3轮** | **C-** |
| **上下文利用率** | **API已返回token usage但从未使用，128K窗口用了不到10%** | **F** |
| LLM后端 | DeepSeek + Anthropic双格式，但endpoint硬编码 | C+ |
| 多智能体 | 无。单Agent Loop控制所有项目 | F |
| **可观测性** | **零trace、零结构化日志、零决策审计** | **F** |
| 测试覆盖 | 零单元/集成测试 | F |

### 1.2 上下文利用率的量化证据

当前 `agentLoop.ts` 的 API 调用已经捕获了 `prompt_tokens`、`completion_tokens`、`total_tokens`（见 `streamUsage`），但这些数据**从未被用于上下文管理**。按实际估算：

```
典型一轮Agent Loop的消息量:
  系统提示词:       ~2,000 tokens
  项目状态快照:     ~500 tokens × 3个项目 = 1,500 tokens
  最近3轮对话:      ~1,000 tokens × 3轮 = 3,000 tokens
  工具结果摘要:     150字符 × 5次调用 ≈ 500 tokens
  用户消息:          ~100 tokens
  ─────────────────────────────────────
  合计:             ~7,100 tokens

DeepSeek V4 上下文窗口: 128,000 tokens
实际利用率:           ~5.5%
Claude Opus 上下文窗口: 200,000 tokens
实际利用率:           ~3.5%
```

**结论：我们有一台128K的油箱，但每次只加5升油就跑。** Google ADK 的四层存储和 Kimi 的256K全量上下文都在用满窗口，而我们根本没开始用。这不是缺技术，是缺意识。

### 1.3 八个必须补齐的短板

1. **长文本全量记忆** — 应保持完整对话直到接近窗口上限，而非一刀切截断到3轮
2. **上下文Token预算管理** — 应有显式的token分配策略，API返回的usage数据应被利用
3. **语义记忆检索** — TF-IDF关键词搜索应升级为embedding语义搜索
4. **Document-to-Skill** — 项目.md知识库应自动转化为角色可注入的技能提示词
5. **多智能体协作** — 单一Agent Loop无法做异构任务分解
6. **可观测性/决策追踪** — 零trace，无法回答"Agent为什么做了这个决定"
7. **测试体系** — 5000行零测试的核心逻辑
8. **LLM后端耦合** — endpoint硬编码

---

## 2. 借鉴方案分析

### 2.1 从 Google ADK 借鉴什么

| ADK模式 | DBGHF对应改造 |
|---------|-------------|
| **四层存储** (Working Context / Session / Memory / Artifacts) | 热/温/冷三层记忆：全量近期→结构化中期→向量检索远期 |
| **Token预算管理** (每层有显式的token配额) | 新增TokenBudget：系统提示词+历史+知识+快照=各设上限 |
| **Processor Pipeline** (有序编译流水线) | 将 buildSystemPrompt 重构为 processor 链 |
| **Context Compaction** (异步滑动窗口摘要) | 懒摘要+预摘要双轨制，但仅在接近窗口上限时触发 |
| **Scoped Handoff + Conversation Translation** | 多角色切换时的上下文转译 |
| **Human-in-the-Loop** (`RequireConfirmation` 标记) | 动态确认：Agent不确定时主动暂停等用户输入 |
| **OpenTelemetry集成** | 决策追踪：每次LLM调用+工具执行+角色切换生成trace |
| **output_schema_processor** | 工具输出JSON Schema校验 |

### 2.2 从 Kimi Agent Swarm 借鉴什么

| Kimi模式 | DBGHF对应改造 |
|----------|-------------|
| **全量上下文利用** (256K原生窗口) | **核心补课：不再无脑截断，按token预算动态决定保留多少轮** |
| **异构任务分解** (Heterogeneous Decomposition) | `decompose_task` 工具：复杂任务→子任务列表 |
| **按技能画像分派** (Skill-Profile Routing) | 角色绑定工具集+系统提示词+知识库子集 |
| **Document-to-Skill** | 项目知识库(.md/JSON)→角色技能提示词，角色加载时注入 |
| **Agent Swarm共享状态协调器** | 角色间通过结构化状态对象通信 |
| **持久化Agent记忆** | 每个角色有独立的跨会话记忆空间 |

### 2.3 从 A2A 协议借鉴什么

| A2A模式 | DBGHF对应改造 |
|---------|-------------|
| **Agent Card** | 每个角色导出JSON能力清单 |
| **Task 生命周期** | submitted→assigned→working→completed/failed/reassigned |
| **SSE 流式推送** | 角色执行进度通过 AgentEvent 推送到前端 |

### 2.4 借鉴总结

| 技术 | 能借 | 不能直接借 | 原因 |
|------|------|-----------|------|
| Google ADK 四层存储 | ✅ 架构思想+Token预算 | ❌ Python SDK | TypeScript Electron |
| Google ADK OpenTelemetry | ✅ trace/span设计模式 | ❌ Python SDK | 我们用简单的结构化日志即可 |
| Kimi Agent Swarm | ✅ 全量上下文+异构分解+技能路由+Doc2Skill | ❌ 模型级编排 | 我们是API调用 |
| A2A 协议 | ✅ Agent Card + Task状态机 | ❌ JSON-RPC传输层 | 角色都在同一进程内 |

---

## 3. 第一轮评审：架构师视角

> 评审重点：模块耦合度、扩展性、对现有架构的破坏程度

### 评审意见

**问题1：上下文分层是否会过度工程化？**

当前 `messageStores` 的零IPC读取是实战验证的最优解。四层全做会引入过多中间对象。

**纠正**：改为**热/温/冷三层记忆**，贴合Electron单进程特点：
- **热记忆**（全量保留）：最近N轮对话原文不动，N由token预算自动决定
- **温记忆**（结构摘要）：超出热记忆阈值的历史轮次，异步LLM摘要
- **冷记忆**（语义检索）：跨会话知识，embedding向量搜索，按需注入

**问题2：Processor Pipeline的边界在哪？**

**纠正**：精简为**6个核心Processor**：
1. **IdentityProcessor** — 注入当前角色系统提示词
2. **TokenBudgeter** — 计算剩余token空间，决定热/温/冷各配多少
3. **ContextSelector** — 按预算从Session中选取完整轮次+摘要
4. **KnowledgeInjector** — 语义搜索知识库+Document-to-Skill注入
5. **CachePrefixer** — 构建可缓存的稳定前缀
6. **DynamicInjector** — 注入项目状态快照+活跃任务

**问题3：角色系统和现有工具的兼容性？**

**纠正**：角色系统作为可选叠加层。默认CEO角色拥有全部工具。`toolRegistry` 新增 `roleFilter(roleId)` 方法。

### 修正后的架构

```
┌──────────────────────────────────────────────────────┐
│                HarnessAgentPanel (React)              │
│        角色选择器 + 聊天窗口 + 监控面板 + 决策追溯      │
└────────────────────────┬─────────────────────────────┘
                         │ harness:run IPC
┌────────────────────────▼─────────────────────────────┐
│                AgentLoop (重构后)                      │
│                                                       │
│  buildContext() ← 6-Step Processor Pipeline           │
│  1.Identity → 2.TokenBudget → 3.Selector →            │
│  4.Knowledge → 5.Cache → 6.Dynamic                    │
│                                                       │
│  热/温/冷三层记忆 + Token预算管理                       │
│  ┌──────────┬──────────────┬──────────────┐          │
│  │ 热记忆    │ 温记忆        │ 冷记忆        │          │
│  │ 全量原文  │ LLM结构化摘要  │ Embedding检索 │          │
│  │ 最近N轮   │ 中间历史       │ 跨会话知识    │          │
│  │ N=预算决定│ 接近窗口上限触发│ 按需注入      │          │
│  └──────────┴──────────────┴──────────────┘          │
│                                                       │
│  角色系统: RoleManager (可选叠加层)                     │
│  可观测性: DecisionTracer (每次决策生成trace)           │
│  动态确认: HITLManager (Agent不确定时暂停)              │
└───────────────────────────────────────────────────────┘
```

---

## 4. 第二轮评审：工程实现视角

> 评审重点：代码可行性、性能影响、内存管理、现有bug风险

### 评审意见

**问题1：全量保留热记忆会不会OOM？**

128K tokens ≈ 500KB文本（英文）或 300KB（中文）。即使保留完整的30轮对话（每轮平均2000 tokens），也就60K tokens ≈ 250KB。Electron主进程的V8堆有4GB，这完全不是问题。

**纠正**：不需要做懒加载或分页。热记忆直接在内存中全量维护。温记忆的摘要LLM调用才需要异步处理。

**问题2：Token计数如何实现？**

DeepSeek/Anthropic API返回的 `usage.prompt_tokens` 是精确计数，但我们需要**预估**（在发送前决定保留几轮）。tiktoken（OpenAI开源的tokenizer）可以精确预估，但需要额外的wasm包。

**纠正**：采用**双轨估算**：
- **精确计数**：信任API返回的 `usage.prompt_tokens`，每轮后记录实际消耗
- **预估计数**：使用简单的字符/4近似（英文）或字符/1.5（中文），误差在15%以内足够做预算决策
- **不需要引入tiktoken**，避免增加安装包体积

**问题3：embedding搜索会增加依赖吗？**

DeepSeek API 已经支持 embeddings（`text-embedding-3-small` 兼容）。不需要本地embedding模型，直接调API即可。

**纠正**：`sessionMemory.ts` 的语义搜索通过 DeepSeek Embedding API 获取向量，本地只存储和计算cosine相似度。每条记忆的embedding向量（1536维 × 4字节 = 6KB），1000条记忆 ≈ 6MB，零外部依赖。

**问题4：文档到技能(Document-to-Skill)的实现细节？**

项目知识库文件（`.dbvs-horsefarm-notes.md` 等）已经存在于项目目录中。需要的是读取→摘要→注入的管道。

**纠正**：在 `KnowledgeInjector` Processor 中新增 `DocToSkillLoader`：
1. 检测项目目录下的 `.md` 知识库文件
2. 用低成本LLM提取为结构化的"技能卡片"（200 tokens以内）
3. 缓存到 `%APPDATA%/dbghf/skill-cards.json`
4. 角色加载时按 `knowledgeTags` 匹配注入

---

## 5. 第三轮评审：产品与用户视角

> 评审重点：用户感知价值、学习成本、向后兼容

（第三轮结论保留：渐进式暴露、快速路径、硬边界原则，不再赘述）

---

## 6. 第四轮审查：逐项审计遗漏

> 审查方法：逐项对比 Kimi K2.6 和 Google ADK 的能力清单，检查方案是否覆盖

### 审计清单

| # | Kimi/Google能力 | 第三轮方案 | 判定 | 补全措施 |
|---|---------------|-----------|------|---------|
| 1 | Kimi 256K全量上下文 | ❌ 只做了摘要截断 | 🔴遗漏 | **新增模块F: 长文本记忆与Token预算** |
| 2 | ADK Token预算管理 | ❌ 未提及 | 🔴遗漏 | **TokenBudgeter Processor，API usage回用** |
| 3 | ADK Memory语义搜索 | ❌ 只写了TF-IDF | 🟡遗漏 | **升级为embedding-based语义搜索** |
| 4 | Kimi Document-to-Skill | ❌ 一句话带过 | 🟡遗漏 | **详细设计DocToSkillLoader管道** |
| 5 | ADK OpenTelemetry | ❌ 完全未提 | 🟡遗漏 | **新增模块H: DecisionTracer决策追踪** |
| 6 | ADK Human-in-the-Loop | ❌ 权限系统是静态规则 | 🟡遗漏 | **新增模块I: HITL动态确认** |
| 7 | ADK output_schema_processor | ❌ Reflector不校验schema | 🟢可选 | 增强reflector JSON Schema校验 |
| 8 | ADK proactive memory preload | ❌ 只有被动检索 | 🟢可选 | KnowledgeInjector新增主动预加载 |

### 审查结论

第三轮方案遗漏了**6个关键能力**，其中2个是严重遗漏（长文本记忆、Token预算），4个是中等遗漏。全部补入最终方案。

---

## 7. 最终技术方案

> 经过四轮评审修正，八大模块，完整可执行

### 7.1 总览

```
DBGHF V3.0 — 八大模块
├── 模块A: 上下文工程升级（借鉴Google ADK）
├── 模块B: 角色扮演多智能体 + Document-to-Skill（借鉴Kimi + ADK）
├── 模块C: 自进化知识库（独创+ADK Memory）
├── 模块D: 测试基础设施（从零搭建）
├── 模块E: LLM后端解耦（多Provider架构）
├── 模块F: 长文本记忆与Token预算管理 ★新增★
├── 模块G: 语义记忆与智能检索 ★新增★
└── 模块H: 可观测性与决策追踪 + HITL ★新增★
```

### 7.2 模块A：上下文工程升级

**借鉴来源**：Google ADK 分层存储 + Processor Pipeline + Context Compaction

**目标**：从"150字符截断+3轮保留"升级为"Token预算驱动的自适应上下文"

#### A.1 热/温/冷三层记忆

```typescript
// electron/harnessAgent/memoryStore.ts (新增文件, ~300行)

interface HotMemory {
  // 全量保留，不做任何压缩
  events: SessionEvent[]        // 完整对话事件流
  tokenCount: number            // 实际token消耗（从API usage累加）
  maxTokens: number             // 预算上限（模型context窗口 × 0.8）
}

interface WarmMemory {
  // 超出热记忆阈值的部分，LLM结构化摘要
  summaries: Array<{
    eventRange: [number, number]  // 覆盖的Event序号范围
    summary: string               // LLM生成的摘要 (~200 tokens)
    keyFacts: string[]            // 提取的关键事实
    tokenCount: number
  }>
}

interface ColdMemory {
  // 跨会话知识，embedding向量搜索
  entries: MemoryEntry[]         // 持久化到 cold-memory.json
  // 按需通过语义搜索检索，注入到KnowledgeInjector
}

// 预算分配策略
const TOKEN_BUDGET: Record<string, number> = {
  systemPrompt:    0.15,    // 系统提示词: 15%
  hotHistory:      0.50,    // 热记忆全量: 50%
  warmSummaries:   0.10,    // 温记忆摘要: 10%
  knowledge:       0.10,    // 知识注入:   10%
  snapshot:        0.10,    // 项目快照:   10%
  headroom:        0.05,    // 安全余量:    5%
}
```

#### A.2 六步Processor Pipeline

```typescript
// electron/harnessAgent/contextPipeline.ts (新增文件, ~250行)

const pipeline: ContextProcessor[] = [
  IdentityProcessor,      // 1. 注入角色系统提示词
  TokenBudgeter,           // 2. ★NEW: 计算剩余token空间，决定热/温/冷配额
  ContextSelector,         // 3. 按预算选取完整轮次(热) + 摘要(温)
  KnowledgeInjector,       // 4. 语义搜索冷记忆 + Doc2Skill注入
  CachePrefixer,           // 5. 稳定前缀标记（用于Prompt Caching）
  DynamicInjector,         // 6. 项目状态快照 + 活跃任务
]
```

#### A.3 TokenBudgeter 核心逻辑

```typescript
// TokenBudgeter Processor 的核心决策逻辑 (~80行)

async function computeBudget(
  provider: LLMProvider,
  hotMemory: HotMemory,
  warmMemory: WarmMemory,
): Promise<TokenAllocation> {
  const windowTokens = provider.capabilities.maxContextTokens  // e.g. 128000
  const safeWindow = Math.floor(windowTokens * 0.85)           // 留15%安全余量

  // 固定开销
  const systemPromptTokens = estimateTokens(currentSystemPrompt)  // ~2000
  const snapshotTokens = estimateTokens(projectSnapshot)           // ~1500

  // 动态分配：剩余的都给热记忆
  const remaining = safeWindow - systemPromptTokens - snapshotTokens

  // 热记忆尽可能多保留完整轮次
  let hotTokens = 0
  let hotRoundCount = 0
  for (let i = hotMemory.events.length - 1; i >= 0; i--) {
    const roundTokens = hotMemory.events[i].tokenCount
    if (hotTokens + roundTokens > remaining * 0.75) break  // 热记忆占75%剩余空间
    hotTokens += roundTokens
    hotRoundCount++
  }

  // 温记忆摘要占15%剩余空间
  const warmBudget = Math.floor(remaining * 0.15)

  // 冷记忆/知识注入占10%剩余空间
  const coldBudget = Math.floor(remaining * 0.10)

  return {
    hotTokens, hotRoundCount, warmBudget, coldBudget,
    totalUsed: systemPromptTokens + snapshotTokens + hotTokens + warmBudget + coldBudget,
    windowTokens,
    utilizationPercent: ((totalUsed / windowTokens) * 100).toFixed(1),
  }
}
```

#### A.4 与现有代码的集成

**关键原则：** 现有 `wake_projects` / `read_project_chat` / `task_project` 等工具实现一行不改。

改动集中在 `agentLoop.ts` 的两处：
1. `buildSystemPrompt()` → `buildContext()`（约20行改动）
2. `compressHistory()` → 改为 `TokenBudgeter` 驱动的自适应选择（约30行改动）

```typescript
// agentLoop.ts 改造伪代码

class AgentLoop {
  private hotMemory: HotMemory
  private warmMemory: WarmMemory

  async run(userMessage: string): Promise<void> {
    // ... 现有逻辑 ...

    // 每轮结束后：记录实际token消耗（API已返回，直接用）
    // agentLoop.ts 已有 streamUsage.prompt_tokens 接收！
    const actualTokens = lastAPIResponse.usage?.prompt_tokens || estimateTokens(messages)
    this.hotMemory.tokenCount += actualTokens

    // 仅在热记忆超过预算时触发摘要
    if (this.hotMemory.tokenCount > this.hotMemory.maxTokens * 0.8) {
      await this.evictToWarmMemory()
    }

    // 继续现有循环...
  }
}
```

---

### 7.3 模块B：角色扮演多智能体 + Document-to-Skill

（保留第三轮的B.1-B.4角色定义/管理器/集成/任务分解器，新增B.5）

#### B.5 Document-to-Skill 管道（借鉴 Kimi K2.6）

```typescript
// electron/harnessAgent/docToSkill.ts (新增文件, ~200行)

interface SkillCard {
  id: string
  sourceFile: string           // 来源文件路径
  projectPath: string
  title: string                // 技能名称
  category: string             // 'coding' | 'devops' | 'review' | 'domain'
  summary: string              // 一句话描述 (50 tokens)
  knowledgeSnippet: string     // 详细知识片段 (200 tokens)
  applicableRoles: string[]    // 适用的角色 ['worker', 'reviewer', ...]
  tags: string[]
  lastUpdated: string
}

class DocToSkillLoader {
  /**
   * 扫描项目目录下的知识库文件:
   * - .dbvs-horsefarm-notes.md  (项目备注)
   * - .dbvs-knowledge.md        (项目知识库)
   * - docs/*.md                 (项目文档)
   * - README.md                 (项目说明)
   *
   * 每个文件 → 低成本LLM提取 → SkillCard → 缓存
   */
  async scanProject(projectPath: string): Promise<SkillCard[]>

  /**
   * 按角色标签匹配技能卡片
   * 在 KnowledgeInjector Processor 中调用
   */
  getSkillsForRole(roleId: string, projectPath?: string): SkillCard[]

  /**
   * 缓存管理
   * 文件修改时间变化时自动重新生成SkillCard
   */
  private cache: Map<string, { mtime: number; cards: SkillCard[] }>
}
```

**集成点**：在 `KnowledgeInjector` Processor 中，除了搜索错误模式知识库外，同时调用 `DocToSkillLoader.getSkillsForRole()` 注入当前角色的领域知识。

---

### 7.4 模块C：自进化知识库

（保留第三轮的C.1错误模式收集器、C.2知识库扩展，C.3跨会话记忆移到模块G）

---

### 7.5 模块D：测试基础设施

（保留第三轮完整内容，不变）

---

### 7.6 模块E：LLM后端解耦

（保留第三轮完整内容，不变）

---

### 7.7 模块F：长文本记忆与Token预算管理 ★新增★

**借鉴来源**：Kimi 256K全量上下文 + Google ADK Token预算体系

**目标**：从"5%窗口利用率"提升到"70-85%窗口利用率"，长会话不再遗忘

#### F.1 核心原理

**现有问题**：`compressHistory` 一刀切保留3轮，无论窗口有多大。这等于买了128K的油箱但每5公里就停车加油。

**解决方案**：不做无脑截断。保持完整对话原文，直到TokenBudgeter检测到接近窗口上限时才触发温记忆摘要。对于大多数用户会话（20-30轮），根本不会触发摘要，全程全量保留。

#### F.2 Token追踪闭环

```typescript
// 利用已有的 API usage 数据做闭环追踪
// agentLoop.ts 的 callLLMStream 已经返回 streamUsage!

interface TokenTracker {
  // 每轮结束后记录
  recordRoundUsage(promptTokens: number, completionTokens: number): void

  // 预估（发送前）
  estimateCurrentContext(messages: ChatMessage[]): number

  // 预算检查
  isApproachingLimit(): boolean     // >80% 窗口 → 触发摘要
  getRemainingBudget(): number
  getUtilizationReport(): string    // "当前使用 85,000/128,000 tokens (66%)"
}
```

**实现**：~120行，直接嵌入 `agentLoop.ts`，不需要新文件。因为没有引入tiktoken，使用简单的字符估算（英文 ~4 chars/token, 中文 ~1.5 chars/token）。

#### F.3 实际效果预估

| 场景 | V2.6当前 | V3.0改造后 |
|------|---------|-----------|
| 短对话(5轮) | 全量保留 ✅ | 全量保留 ✅ |
| 中对话(20轮) | ❌ 只保留3轮，丢失17轮上下文 | ✅ 全量保留（~40K tokens, 31%窗口） |
| 长对话(50轮) | ❌ 只保留3轮+150字符摘要 | ✅ 热记忆~30轮全量 + 温记忆~20轮摘要 |
| 超长对话(100轮) | ❌ 严重遗忘 | ✅ 热记忆~20轮 + 温记忆~80轮结构化摘要 |

#### F.4 实现影响

- **改动范围**：`agentLoop.ts` 约50行改动（利用已有 `streamUsage`，新增TokenBudgeter调用）
- **新增文件**：无（TokenBudgeter逻辑在 `contextPipeline.ts` 中）
- **性能影响**：零额外开销（token计算用API已有数据，字符串长度估算O(n)且n<100K字符）
- **向后兼容**：完全兼容，只是保留了更多历史消息

---

### 7.8 模块G：语义记忆与智能检索 ★新增★

**借鉴来源**：Google ADK Memory Service（reactive + proactive recall）

**目标**：从TF-IDF关键词搜索升级为embedding语义搜索

#### G.1 为什么TF-IDF不够

TF-IDF只能匹配**相同的关键词**。如果用户说"项目启动不了"，知识库里有"Claude Code terminal failed to spawn"的修复方案，TF-IDF匹配不到。Embedding可以。

#### G.2 实现方案

```typescript
// electron/harnessAgent/semanticMemory.ts (新增文件, ~200行)

interface SemanticMemoryEntry {
  id: string
  content: string
  embedding: number[]           // 1536维向量 (text-embedding-3-small)
  metadata: {
    type: 'error_fix' | 'user_preference' | 'project_fact' | 'skill_card'
    projectPath?: string
    tags: string[]
    timestamp: string
  }
}

class SemanticMemory {
  private entries: SemanticMemoryEntry[]
  private embeddingCache: Map<string, number[]>  // 内容hash → embedding

  /**
   * 使用 DeepSeek Embedding API 生成向量
   * API: POST https://api.deepseek.com/v1/embeddings
   * 模型: text-embedding-3-small (DeepSeek兼容)
   * 成本: ~$0.02/1M tokens → 几乎免费
   */
  private async embed(text: string): Promise<number[]>

  /**
   * 语义搜索: cosine相似度
   */
  async search(query: string, topK: number): Promise<SemanticMemoryEntry[]>

  /**
   * 自动记录: diagnose_project成功后写入
   */
  async record(entry: Omit<SemanticMemoryEntry, 'id' | 'embedding'>): Promise<void>

  /**
   * 持久化: %APPDATA%/dbghf/semantic-memory.json
   * 1000条 ≈ 6MB (含向量)
   */
  async save(): Promise<void>
}
```

#### G.3 集成到KnowledgeInjector

```typescript
// KnowledgeInjector Processor 中
async function injectKnowledge(ctx: ContextView, role: RoleConfig): Promise<ContextView> {
  // 1. 语义搜索冷记忆（当前用户消息+项目状态作为查询）
  const relevantMemories = await semanticMemory.search(
    ctx.lastUserMessage + ' ' + ctx.projectSnapshot,
    5  // top 5
  )

  // 2. 关键词匹配错误模式（保留原有knowledge.ts逻辑）
  const errorPatterns = searchKnowledge(ctx.lastUserMessage)

  // 3. Document-to-Skill（模块B.5）
  const skillCards = docToSkillLoader.getSkillsForRole(role.id)

  // 4. 拼接注入
  ctx.knowledgeContext = [
    ...relevantMemories.map(m => `[记忆] ${m.content}`),
    ...errorPatterns.map(p => `[错误模式] ${p.diagnosis}: ${p.repairSteps.join(' → ')}`),
    ...skillCards.map(s => `[项目技能] ${s.title}: ${s.summary}`),
  ].join('\n')

  return ctx
}
```

#### G.4 降级策略

- Embedding API 不可用时 → 自动降级为TF-IDF关键词搜索
- 本地缓存的embedding向量仍然可用 → 即使API挂了，历史记忆依然可搜索
- 首次启动时无embedding → 关键词匹配冷启动，后台异步生成embedding

---

### 7.9 模块H：可观测性与决策追踪 + HITL ★新增★

**借鉴来源**：Google ADK OpenTelemetry + Human-in-the-Loop

**目标**：每次Agent决策可追溯、不确定时主动暂停请求人类确认

#### H.1 决策追踪 (DecisionTracer)

```typescript
// electron/harnessAgent/decisionTracer.ts (新增文件, ~150行)

interface DecisionTrace {
  traceId: string              // UUID，贯穿整个Agent Loop
  timestamp: string
  span: string                 // 'llm_call' | 'tool_exec' | 'role_switch' | 'reflection' | 'heartbeat'
  input: {
    role: string               // 当前角色
    tokenUsage: number         // 此span消耗的token
    toolName?: string
    userMessage?: string
  }
  output: {
    decision: string           // LLM决策摘要 或 工具执行结果
    toolCalls?: string[]
    reflectionConclusion?: string
  }
  durationMs: number
  error?: string
}

class DecisionTracer {
  private traces: DecisionTrace[] = []
  private currentTraceId: string

  startSpan(span: string, input: Record<string, unknown>): void
  endSpan(output: Record<string, unknown>, error?: string): void

  // 导出最近100条trace到harness-logs.json
  flush(): void

  // 前端可按traceId查看完整决策链
  getTraceById(traceId: string): DecisionTrace[]
}
```

**前端展示**：在HarnessAgentPanel的监控面板新增"决策追溯"子Tab，按时间线展示每次LLM调用→工具执行→角色切换的因果关系链。用户点击任意一条可展开查看详情。

#### H.2 动态确认 (HITLManager)

```typescript
// electron/harnessAgent/hitlManager.ts (新增文件, ~100行)

/**
 * 借鉴 Google ADK 的 RequireConfirmation 模式
 * 但更智能：不是静态标记工具，而是Agent根据置信度动态决定
 */
class HITLManager {
  /**
   * 在工具执行前，检查是否需要人类确认
   * 触发条件（任一）：
   * 1. Reflection输出 confidence = 'low'
   * 2. 工具是 write_file / shell_exec（危险操作）
   * 3. 连续3次同一工具失败
   * 4. Agent显式请求确认（输出中包含 [CONFIRM_NEEDED]）
   */
  shouldPauseForConfirmation(
    toolCall: ToolCallRequest,
    reflection: ReflectionResult,
    recentFailures: number
  ): { pause: boolean; reason?: string }

  /**
   * 暂停Agent Loop，发送 permission_needed 事件到前端
   * 用户确认/拒绝后恢复执行
   * 超时(120s)自动拒绝
   */
  async requestConfirmation(
    toolCall: ToolCallRequest,
    reason: string
  ): Promise<'approved' | 'denied' | 'timeout'>
}
```

---

### 7.10 前端改造清单（更新）

| 改造项 | 文件 | 工作量 |
|--------|------|--------|
| 角色切换选择器 | `HarnessAgentPanel.tsx` | 小 |
| 角色推荐提示 | 聊天窗口中的提示气泡 | 小 |
| Agent Card展示 | 监控面板新增角色状态卡片 | 中 |
| Provider选择器 | `HorseFarmSettings.tsx` API Keys区域扩展 | 小 |
| 任务分解可视化 | 聊天窗口中子任务进度条 | 中 |
| **Token利用率仪表盘** ★ | 监控面板新增上下文窗口利用率进度条 | 小 |
| **决策追溯面板** ★ | 监控面板新增DecisionTrace时间线 | 中 |
| **动态确认对话框** ★ | 聊天窗口新增"Agent请求确认"交互卡片 | 小 |

---

## 8. 分阶段实施路线图

### Phase 1: 基础补强 + 长文本记忆（2周）

**目标**：补齐最痛的短板——上下文利用率从5%提升到70%+

```
Week 1:
  [Day 1-2] 模块E: LLM后端解耦
    - 新增 llmProviders.ts
    - 重构 agentLoop.ts 构造函数（endpoint变Provider变量）
    - Provider选择器前端UI
    - 保持向后兼容：默认仍为DeepSeek

  [Day 3-4] 模块F: 长文本记忆与Token预算 ★核心★
    - TokenBudgeter Processor 实现（contextPipeline.ts）
    - 利用 agentLoop.ts 已有的 streamUsage 做闭环追踪
    - 热/温/冷三层记忆实现（memoryStore.ts）
    - 替换 compressHistory 的无脑截断为自适应Token预算
    - ★关键验证：50轮长对话测试，确认不再遗忘早期上下文

  [Day 5] 模块D: 测试基础设施 + JS产物同步
    - 安装Jest + ts-jest
    - 编写 TokenBudgeter 测试（P0优先级）
    - 编写 ContextSelector 新旧行为对比测试
    - CI脚本: check-js-sync.js
    - npx tsc --noEmit 零错误

Week 2:
  [Day 1-2] 模块A: 完整上下文工程升级
    - 新增 contextStore.ts (Session/View 两层存储)
    - 完成六步Processor Pipeline
    - 新增 summarizer.ts (懒摘要+预摘要双轨制，仅在Token预算紧张时触发)
    - agentLoop.ts buildSystemPrompt → buildContext 替换

  [Day 3-4] 模块G: 语义记忆 ★新增★
    - 新增 semanticMemory.ts
    - DeepSeek Embedding API 集成
    - TF-IDF降级路径
    - 集成到 KnowledgeInjector Processor

  [Day 5] 测试 + 验证
    - 编写summarizer降级路径测试
    - 编写semanticMemory搜索准确率测试
    - 手动长会话测试 (50轮+)
    - 性能基准: V2.6 vs V3.0 各场景延迟对比
```

### Phase 2: 角色系统 + Document-to-Skill（2周）

```
Week 3:
  [Day 1-2] 角色基础设施
    - 新增 roles/types.ts + definitions.ts (4个内置角色)
    - 新增 roles/RoleManager.ts
    - Agent Card导出
    - 角色配置持久化到 roles.json

  [Day 3-4] 角色集成 + Doc2Skill
    - agentLoop.ts 集成角色检查+自动切换+工具白名单
    - 上下文转译(handoff)实现
    - 新增 docToSkill.ts (Document-to-Skill管道)
    - 集成到 KnowledgeInjector Processor

  [Day 5] 前端角色UI
    - 角色切换选择器 + 角色推荐提示
    - Agent Card展示

Week 4:
  [Day 1-2] 任务分解器
    - 新增 taskDecomposer.ts
    - 集成到 agentLoop.ts

  [Day 3-4] 模块H: 可观测性 + HITL ★新增★
    - 新增 decisionTracer.ts
    - 新增 hitlManager.ts
    - 前端决策追溯面板 + 动态确认对话框

  [Day 5] 测试 + 验证
    - multiRole.test.ts 完整协作流程
    - 手动复合任务测试
```

### Phase 3: 知识库进化（1周）

```
Week 5:
  [Day 1-3] 错误模式自动收集器
    - 新增 ErrorPatternCollector.ts
    - 集成到 diagnose_project 成功路径
    - 模式聚类 + 导出审查

  [Day 4-5] 跨会话记忆增强
    - semanticMemory 的 proactive preload（主动预加载）
    - 自动记录成功修复到冷记忆
    - 定期清理过期条目
```

### Phase 4: 打磨发布（1周）

```
Week 6:
  [Day 1-2] 文档更新
    - 更新 docs/harness-agent-capabilities.md
    - 新增 docs/role-system.md
    - 新增 docs/llm-providers.md
    - 新增 docs/long-context-memory.md

  [Day 3-4] 全量回归 + 性能基准
    - 测试覆盖率 >80% 核心模块
    - 延迟基准验证
    - 50轮+长会话稳定性测试

  [Day 5] 发布 V3.0-alpha
```

---

## 9. 验收标准

### 9.1 核心指标（新增）

| 验收项 | 标准 | 测量方式 |
|--------|------|---------|
| **上下文窗口利用率** | 中长会话(20轮+)达到50-85%利用率，不再一刀切截断 | TokenBudgeter日志 |
| **长会话记忆保持** | 50轮对话后能准确回忆第5轮的关键决策 | 手动测试 |
| **语义搜索准确率** | 用自然语言查询能匹配到相关知识条目(Top-5命中率>80%) | 10个测试查询 |
| **决策可追溯** | 任意一次Agent行为可追溯到完整的LLM调用→工具执行链 | DecisionTrace面板 |

### 9.2 功能验收（保留）

| 验收项 | 标准 |
|--------|------|
| LLM Provider切换 | 设置中选择不同Provider后Agent正常调用 |
| 角色自动切换 | "检查所有项目代码质量"时自动切到Reviewer |
| 工具白名单 | Worker角色调用wake_projects被拦截并委托CEO |
| 任务分解 | 复合任务被分解为有序子任务执行 |
| Document-to-Skill | 项目.md知识库自动转为角色技能注入 |

### 9.3 性能验收（更新）

| 验收项 | 标准 |
|--------|------|
| 简单查询延迟 | 不高于V2.6基准（快速路径不走新Pipeline） |
| 复杂任务延迟 | 不高于V2.6基准的115%（Token预算计算<10ms） |
| 40轮会话内存 | 热记忆全量保留，内存增长<100MB |
| Embedding API延迟 | <200ms，失败时自动降级TF-IDF（零延迟） |

### 9.4 向后兼容验收

| 验收项 | 标准 |
|--------|------|
| harness:run IPC | 接口签名不变 |
| 默认行为 | 不开角色系统时与V2.6完全一致 |
| 现有工具 | 21个工具实现代码零改动 |
| 编译产物 | electron/**/*.js 与 .ts 100%同步 |

---

## 附录：技术决策记录（新增）

### E. 为什么不引入tiktoken做精确token计数？

tiktoken是Python库，Node.js移植版(tiktoken-js)需要下载40MB的wasm文件。我们的场景用字符估算（英文/4, 中文/1.5）误差在15%以内。TokenBudgeter预留了15%安全余量专门吸收这个误差，不需要精确到个位数。

### F. 为什么用DeepSeek Embedding API而不是本地embedding模型？

本地模型(如all-MiniLM-L6-v2 via transformers.js)需要下载80MB模型文件，且推理需要额外CPU/GPU。DeepSeek Embedding API延迟<200ms，成本几乎为零($0.02/1M tokens)，且对1000条记忆只需要调用~100次/年。

### G. 为什么HITL不做成规则引擎？

Google ADK的HITL是工具级别的静态标记（`RequireConfirmation: true`）。我们的HITL更进一步：Agent根据Reflection的confidence动态决定是否需要确认。当confidence='low'时自动暂停，当confidence='high'时自动放行。这比静态规则更灵活。

### H. 长文本记忆 vs 摘要：最终策略

**核心原则：默认全量保留，只在必要时摘要。** 这跟Kimi的设计哲学一致（256K窗口足够装下绝大多数对话）。TokenBudgeter的80%阈值确保摘要只在实际必要时触发。对于典型用户场景（20-30轮），完全不会触发摘要，全程全量记忆。

---

> **文档结束**
> 本方案经过四轮评审（架构→工程→产品→逐项审计），8项遗漏全部补全。
> 核心变化：新增模块F(长文本记忆)、模块G(语义搜索)、模块H(可观测性+HITL)。
> 总工作量估算：6周，1人全职。
> **关键原则：默认全量记忆，只在必要时摘要——用满128K油箱而非每次只加5升。**
