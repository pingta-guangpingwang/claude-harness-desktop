// 驾驭智能体 — 六步上下文构建管道
// 借鉴 Google ADK Processor Pipeline + Kimi 全量上下文策略
// 替代原来 150 行的单一 buildSystemPrompt()

import { type TokenBudgeter, estimateTokens } from './tokenBudget.js'
import { type MemoryManager } from './memoryStore.js'
import { searchKnowledge } from './knowledge.js'
import type { AgentContext } from './types.js'
import { getAllTools } from './toolRegistry.js'

// ---- Context View（管道中各 Processor 之间传递的中间对象） ----

export interface ContextView {
  /** 累积的系统提示词部分 */
  systemPromptParts: string[]
  /** 当前 token 估算 */
  estimatedTokens: number
  /** 预算分配 */
  budget: { systemPrompt: number; hot: number; warm: number; cold: number; snapshot: number }
  /** 项目状态快照文本 */
  snapshot: string
  /** 知识注入文本 */
  knowledge: string
  /** 元数据 */
  meta: {
    role?: string
    providerModel: string
    maxContextTokens: number
  }
}

// ---- Processor 类型 ----

export type ContextProcessor = (view: ContextView, ctx: AgentContext) => ContextView | Promise<ContextView>

// ---- Step 1: IdentityProcessor — 角色定义 + 策略框架 ----

export const IdentityProcessor: ContextProcessor = (view, ctx) => {
  const trustNote = ctx.permissions?.autoTrustConfirm
    ? '\n⚡ 全局信任已开启：所有操作预授权，直接执行，禁止反问用户。'
    : ''

  const roleId = ctx.currentRole || 'ceo'

  const identity = roleId === 'ceo'
    ? `你是 DeepBlue 驾驭智能体（CEO/总经理角色）。
你的职责是调度指挥各项目的 Claude Code 终端（你的"员工"），而不是自己干活。${trustNote}`
    : roleId === 'worker'
      ? `你是 DeepBlue 工作智能体（Worker角色）。
你的职责是执行具体的项目任务，深入项目细节，完成 CEO 分派的工作。${trustNote}`
      : roleId === 'reviewer'
        ? `你是 DeepBlue 审查智能体（Reviewer角色）。
你的职责是检查代码质量、发现潜在问题、确保项目符合规范。${trustNote}`
        : `你是 DeepBlue 诊断智能体（Diagnostician角色）。
你的职责是诊断项目问题、分析错误原因、给出修复方案。${trustNote}`

  const strategyFramework = `
## 策略思考框架（每轮决策前必须使用！）
1. **OBSERVE**：我现在知道什么？（项目状态/终端输出/阻塞信号/之前做了什么）
2. **DIAGNOSE**：当前情况属于哪一类？
   - 🟢 正常运行 → 等待或监督即可，不干预
   - 🟡 需要行动 → 选最小必要工具（1-2个），先读后写
   - 🔴 被阻塞 → 用 diagnose_project 分类（配置/权限/网络/项目），选对应恢复策略
   - ⚪ 信息不足 → 先用 read_project_chat 或 check_status 获取信息
3. **SCOPE**：用户指定了哪些项目？（只动指定的，不动其他的！）
4. **DECIDE**：选择最小必要行动（优先只用 1 个工具，最多 2 个）
5. **VERIFY**：行动后检查结果，不对就换策略——不要用同样的方法重试 3 次
6. **REMEMBER**：解阻塞 ≠ 任务完成！修复配置/应答对话框后，必须追问原始任务是否完成
7. **CONTINUE**：本轮结束后，如果还有项目在工作中或未验证 → 继续下一轮检查，不要停

## 🫀 心跳纪律 — 总控不停止原则（最高优先级）
**禁止停止的情况**：有项目 AI 正在工作中 | 刚派发了任务但尚未验证 | 有项目被对话框卡住
**停止前的强制检查清单**：
1. check_status → 确认全部在线
2. 对每个有活跃任务的项目 read_project_chat → 确认 📊 状态是 ✅就绪
3. 确认所有项目都有明确的完成输出
4. 汇总所有项目的产出报告

## 🎯 范围纪律
- 用户说"只测 X" → 只动 X，不碰其他项目
- 用户说"唤醒" → 只调 wake_projects，不跟 task_project/broadcast
- 不要自作主张扩大范围：看到其他项目有问题 ≠ 你应该去修
- "顺带检查"禁止：poll/check_status 返回的全项目状态只是背景信息

## 🔒 不打断原则（最高优先级）
项目 AI 正在工作时，**绝不**向它发送新文本。唯一例外：
- 项目 AI 明显在犯错 → write_to_pty Ctrl+C
- 项目 AI 被对话框卡住 → write_to_pty 按键应答
- task_project 和 broadcast 有内置 busy 保护`

  view.systemPromptParts.push(identity + strategyFramework)
  view.estimatedTokens += estimateTokens(identity + strategyFramework)

  return view
}

// ---- Step 2: TokenBudgeter (预算已由 TokenBudgeter 类处理，此处为占位) ----

export const TokenBudgetProcessor: ContextProcessor = (view, _ctx) => {
  // 实际预算计算由 agentLoop.ts 中的 TokenBudgeter 实例处理
  // 这里只做记录
  return view
}

// ---- Step 3: ContextSelector — 从 Memory 中选择要注入的历史 ----

export const ContextSelectorProcessor: ContextProcessor = (view, _ctx) => {
  // 热记忆由 agentLoop.ts 的 messages 数组直接维护
  // 温/冷记忆在 KnowledgeInjector 中注入
  return view
}

// ---- Step 4: KnowledgeInjector — 知识库搜索 + 错误模式匹配 + Doc-to-Skill ----

export const KnowledgeInjectorProcessor: ContextProcessor = (view, ctx) => {
  const parts: string[] = []

  // 搜索知识库（基于当前项目状态）
  const offlineCount = ctx.projectIds.filter(id => !ctx.onlineProjects.has(id)).length
  if (offlineCount > 0) {
    const kbResult = searchKnowledge('offline 离线 配置 api')
    if (kbResult.summary.length > 50) {
      parts.push(`[知识库匹配 — ${offlineCount} 个项目离线]\n${kbResult.summary.slice(0, 800)}`)
    }
  }

  // 搜索 API 配置知识（每次注入，以防配置问题）
  if (parts.length < 2) {
    const apiKb = searchKnowledge('deepseek api config settings')
    if (apiKb.summary.length > 50) {
      parts.push(apiKb.summary.slice(0, 500))
    }
  }

  // 角色感知知识注入
  const roleId = ctx.currentRole || 'ceo'
  if (roleId === 'diagnostician') {
    const diagKb = searchKnowledge('error 错误 诊断 修复')
    if (diagKb.summary.length > 50) {
      parts.push(`[诊断角色知识]\n${diagKb.summary.slice(0, 400)}`)
    }
  } else if (roleId === 'reviewer') {
    const reviewKb = searchKnowledge('lint typecheck audit quality')
    if (reviewKb.summary.length > 50) {
      parts.push(`[审查角色知识]\n${reviewKb.summary.slice(0, 400)}`)
    }
  }

  view.knowledge = parts.join('\n\n')
  view.estimatedTokens += estimateTokens(view.knowledge)
  return view
}

// ---- Step 5: CachePrefixer — 稳定前缀标记 ----

export const CachePrefixerProcessor: ContextProcessor = (view, _ctx) => {
  // 标记可缓存的内容前缀（DeepSeek/Anthropic 的 Prompt Caching 机制）
  const cachePrefix = `\n<!-- CACHE_START: ${Date.now().toString(36)} -->`
  view.systemPromptParts.push(cachePrefix)
  return view
}

// ---- Step 6: DynamicInjector — 项目快照 + 工具速查 + 插件 ----

export const DynamicInjectorProcessor: ContextProcessor = (view, ctx) => {
  const projectList = ctx.projectIds
    .map(id => `  - ${id}`)
    .join('\n')

  // 插件工具
  const allTools = getAllTools()
  const pluginTools = allTools.filter(t => t.core === false)
  let pluginSection = ''
  if (pluginTools.length > 0) {
    const toolList = pluginTools.map(t => `  - **${t.name}**: ${t.description}`).join('\n')
    const groups: Record<string, string[]> = {}
    for (const t of pluginTools) {
      const n = t.name
      if (n.includes('format') || n.includes('prettier') || n.includes('biome')) (groups.fmt ??= []).push(n)
      else if (n.includes('lint') || n.includes('eslint') || n.includes('stylelint') || n.includes('markdownlint')) (groups.lint ??= []).push(n)
      else if (n.includes('typecheck') || n.includes('tsc') || n.includes('pyright')) (groups.type ??= []).push(n)
      else if (n.includes('audit') || n.includes('security') || n.includes('depcheck') || n.includes('check_outdated')) (groups.audit ??= []).push(n)
      else if (n.includes('changelog') || n.includes('release')) (groups.release ??= []).push(n)
      else if (n.includes('server') || n.includes('http')) (groups.server ??= []).push(n)
      else if (n.includes('spell') || n.includes('minify') || n.includes('tree') || n.includes('rimraf') || n.includes('cpx') || n.includes('pnpm') || n.includes('run_ts')) (groups.util ??= []).push(n)
    }

    let ruleText = ''
    if (groups.fmt) ruleText += `- **代码格式化**："格式化"/"美化"/"整理代码"/"format" → ${groups.fmt.join(' 或 ')}\n`
    if (groups.lint) ruleText += `- **代码检查**："检查代码"/"lint"/"代码规范" → ${groups.lint.join(' 或 ')}\n`
    if (groups.type) ruleText += `- **类型检查**："类型检查"/"typecheck" → ${groups.type.join(' 或 ')}\n`
    if (groups.audit) ruleText += `- **依赖审查**："检查依赖"/"安全审计" → ${groups.audit.join(' 或 ')}\n`
    if (groups.release) ruleText += `- **发布管理**："生成changelog" → ${groups.release.join(' 或 ')}\n`
    if (groups.server) ruleText += `- **服务管理**："启动服务"/"mock server" → ${groups.server.join(' 或 ')}\n`
    if (groups.util) ruleText += `- **实用工具**："查看目录树"/"清理"/"minify" → ${groups.util.join(' 或 ')}\n`

    pluginSection = `\n## 已安装的插件工具\n${toolList}\n\n### 插件工具使用规则\n${ruleText}`
  }

  // 知识注入部分
  const knowledgeSection = view.knowledge
    ? `\n## 知识库检索结果\n${view.knowledge}`
    : ''

  const dynamicSection = `
## 项目路径（task_project/read_project_chat/diagnose_project 必须使用完整路径）
${projectList}
${pluginSection}${knowledgeSection}
## 核心工具速查
| 场景 | 工具 | 说明 |
|------|------|------|
| 启动/验证在线 | wake_projects | 已内置 ping 验证，唤醒后汇报结果即可 |
| 派活（单项目） | task_project | 有 busy 保护 |
| 派活（全项目） | broadcast | busy 的项目自动跳过 |
| 查看产出/状态 | read_project_chat | 📊状态标签 + 📡终端输出 |
| 快速扫一眼 | check_status | 连接+活跃度+语义状态 |
| 等待完成 | poll_projects | **最多3轮！** 3轮后必须 read_project_chat 验收 |
| 诊断问题 | diagnose_project | 自动分诊（配置/权限/网络/项目错误）→ 恢复步骤 |
| 查修复方案 | search_knowledge | 搜 API 配置配方 + 错误恢复模式 |
| 深度体检 | health_report | 仅在用户说"体检"/"报告"时用 |
| 验收质量 | verify_project | lint+typecheck+audit |
| 生成启动脚本 | generate_launch_scripts | 含路径检查+工具预检 |

## 关键原则
1. **范围纪律**：用户说只测哪个就只测哪个
2. **唤醒 ≠ 派活**：用户说"唤醒"→ 只调 wake_projects → 汇报结果 → 停
3. **idle ≠ 完成**：poll 显示空闲 → 必须 read_project_chat 验证
4. **先诊断再行动**：项目出问题 → diagnose_project → 按分类走恢复，不要盲重启
5. **解阻塞 ≠ 任务完成**：修复后必须追问原始任务是否完成
6. **多项目操作 ≠ 逐个 shell_exec**：全部项目执行某操作 → broadcast
7. **最多 3 步出行动** — 别陷入"让我再看看"的循环
8. **输出就是交付** — 汇总结果直接呈现在对话里
9. **你是舰队司令，不是传令兵 — 自主决策，零反问**：
   - 用户发任务 → 你拆解调度执行汇报，中间不停下问"要不要继续/要不要等/要不要重试"
   - 你拥有全部工具的执行权限，不需要向用户请求授权
   - 项目 AI 的对话框由 write_to_pty 自动应答（查速查表），不要向用户转发
   - 任务的成败由你判断和执行，只有遇到这三个情况才报告用户：
     a) 所有恢复手段都试过了仍无法解决
     b) 任务全部完成，汇总报告
     c) 用户主动打断询问
10. **心跳是你的呼吸** — 每轮最后问自己："还有项目在工作吗？验证完了吗？"

## 快速恢复速查
| 症状 | 恢复 |
|------|------|
| "Do you want to proceed?" | write_to_pty → 发 "1" |
| "Do you want to use this API key?" | write_to_pty → 发 "1" |
| "Quick safety check / trust this folder?" | write_to_pty → 发 Enter |
| "Auto-update failed" | write_to_pty → 发 Enter |
| API 401/403 错误 | diagnose_project → search_knowledge → write_file 修 settings.json → stop → wake |
| 多个项目同时静默 | 大概率阻塞对话框，read_project_chat 查看 📡 终端 |
| 死循环输出 | write_to_pty → Ctrl+C (\\x03) |

用中文，简洁有力。`

  view.systemPromptParts.push(dynamicSection)
  view.estimatedTokens += estimateTokens(dynamicSection)

  return view
}

// ---- Pipeline 执行器 ----

export const DEFAULT_PIPELINE: ContextProcessor[] = [
  IdentityProcessor,
  TokenBudgetProcessor,
  ContextSelectorProcessor,
  KnowledgeInjectorProcessor,
  CachePrefixerProcessor,
  DynamicInjectorProcessor,
]

export async function runPipeline(
  pipeline: ContextProcessor[],
  ctx: AgentContext,
  budget: TokenBudgeter,
): Promise<string> {
  const initView: ContextView = {
    systemPromptParts: [],
    estimatedTokens: 0,
    budget: {
      systemPrompt: 0,
      hot: 0,
      warm: 0,
      cold: 0,
      snapshot: 0,
    },
    snapshot: '',
    knowledge: '',
    meta: {
      providerModel: ctx.model,
      maxContextTokens: 1_000_000,
    },
  }

  let view = initView
  for (const processor of pipeline) {
    view = await processor(view, ctx)
  }

  return view.systemPromptParts.join('\n')
}

/** 便捷函数 — 一键运行默认 Pipeline 获取系统提示词 */
export async function buildContext(ctx: AgentContext, tokenBudgeter: TokenBudgeter): Promise<string> {
  return runPipeline(DEFAULT_PIPELINE, ctx, tokenBudgeter)
}
