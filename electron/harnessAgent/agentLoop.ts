// 驾驭智能体核心循环 — Claude Code 范式
// User Prompt → Think (LLM stream) → Tool Calls → Execute → Feed Results → Loop → Respond

import type { AgentContext, AgentEvent, ToolCallRequest } from './types'
import { executeTool, getToolDeclarations, getTool, getAllTools } from './toolRegistry'
import { PermissionManager } from './permissionManager'
import { taskQueue } from './taskQueue.js'
import { getTokenStore } from '../modules/tokenStore.js'

// ---- DeepSeek API 调用（主进程版本）----

interface DeepSeekMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  reasoning_content?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

interface DeepSeekStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string
      reasoning_content?: string
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

const OPENAI_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions'
const ANTHROPIC_ENDPOINT = 'https://api.deepseek.com/anthropic/v1/messages'

export class AgentLoop {
  private messages: DeepSeekMessage[] = []
  private ctx: AgentContext
  private permissionManager: PermissionManager
  private abortController: AbortController | null = null
  private pendingPermission: {
    resolve: (decision: 'allow' | 'deny' | 'allow_once') => void
  } | null = null
  private eventCallback: ((event: AgentEvent) => void) | null = null
  readonly conversationId: string

  constructor(ctx: AgentContext, pm: PermissionManager, conversationHistory?: ConversationTurn[]) {
    this.ctx = ctx
    this.permissionManager = pm
    this.conversationId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

    // 注入跨轮次对话历史（保留上下文记忆）
    if (conversationHistory && conversationHistory.length > 0) {
      for (const turn of conversationHistory) {
        this.messages.push({ role: turn.role, content: turn.content })
      }
    }
  }

  abort(): void {
    this.ctx.aborted = true
    this.abortController?.abort()
    this.pendingPermission?.resolve('deny')
    this.pendingPermission = null
  }

  resolvePermission(decision: 'allow' | 'deny' | 'allow_once'): void {
    this.pendingPermission?.resolve(decision)
    this.pendingPermission = null
  }

  async run(userMessage: string, onEvent: (event: AgentEvent) => void): Promise<string> {
    this.eventCallback = onEvent
    this.abortController = new AbortController()
    const signal = this.abortController.signal

    // 注入事件回调到上下文，让工具可以将项目 AI 回复推送到驾驭对话
    this.ctx.emitEvent = onEvent

    onEvent({ type: 'thinking_start' })

    // 构建消息：保留历史对话 + 系统提示 + 当前用户消息
    this.messages = [
      ...this.messages,
      { role: 'system', content: this.buildSystemPrompt() },
      { role: 'user', content: userMessage },
    ]

    // 非阻塞预取：后台加载上下文，不阻塞首轮 API 调用
    let pendingPrefetch = this.startContextPrefetch()
    let prefetchConsumed = false

    let maxTurns = 30 // 充足的探活+广播+轮询+验收轮次

    while (maxTurns-- > 0) {
      if (signal.aborted) break

      // 内存压力检查：估计 token 用量，超过 80% 时触发激进清理
      this.checkMemoryPressure()

      // 调用 LLM
      const response = await this.callLLMStream(signal, onEvent)

      // 记录 token 消耗
      if (response.usage) {
        try {
          getTokenStore().record({
            projectPath: 'harness-agent',
            projectName: '驾驭智能体',
            model: this.ctx.model,
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
            conversationId: this.conversationId,
          })
        } catch { /* token 记录失败不阻塞主循环 */ }
      }

      if (signal.aborted) break

      // 收集 tool calls
      const toolCalls = this.extractToolCalls(response)
      if (toolCalls.length === 0) {
        // 没有工具调用 → Agent 本轮完成
        const finalText = response.choices?.[0]?.message?.content || ''

        // 保存本轮 assistant 回复到对话历史
        if (finalText) {
          this.messages.push({ role: 'assistant', content: finalText })
        }

        // C1: 自主循环 — 队列有待办时自动取下一个执行
        // 只注入紧凑的任务摘要到 context，完整结果存档在 taskQueue.result
        if (this.ctx.autonomousMode && !signal.aborted) {
          const next = taskQueue.getNext()
          if (next && (!this.ctx.maxAutonomousTurns || this.ctx.maxAutonomousTurns > 0)) {
            taskQueue.updateStatus(next.id, 'running')
            const compactPrompt = next.projectPath
              ? `[自主任务 #${next.id.slice(-6)}] ${next.projectPath.split('\\').pop()}: ${next.instruction}`
              : `[自主任务 #${next.id.slice(-6)}] 全部项目: ${next.instruction}`
            onEvent({ type: 'text_delta', content: `\n🔄 ${compactPrompt.slice(0, 120)}` })
            this.messages.push({ role: 'user', content: compactPrompt })
            if (this.ctx.maxAutonomousTurns) this.ctx.maxAutonomousTurns--
            continue
          }
          // 队列空 → 退出自主模式
          onEvent({ type: 'text_delta', content: '\n✅ 自主模式: 队列已清空' })
        }

        onEvent({ type: 'done', finalMessage: finalText })
        return finalText
      }

      // 执行工具调用
      const toolResults: Array<{ id: string; name: string; output: string }> = []

      for (const tc of toolCalls) {
        if (signal.aborted) break

        onEvent({ type: 'tool_call', id: tc.id, name: tc.name, params: tc.arguments })

        // 权限检查（多层管道）
        const tool = getTool(tc.name)
        const perm = tool
          ? this.permissionManager.checkTool(tool, tc.arguments)
          : { decision: 'deny' as const, reason: `未知工具: ${tc.name}` }
        if (perm.decision === 'deny') {
          this.permissionManager.recordDenial(tc.name)
          onEvent({ type: 'tool_error', id: tc.id, name: tc.name, error: perm.reason || '操作被拒绝' })
          toolResults.push({ id: tc.id, name: tc.name, output: `操作被拒绝: ${perm.reason}` })
          continue
        }
        if (perm.decision === 'ask') {
          onEvent({ type: 'permission_needed', id: tc.id, name: tc.name, params: tc.arguments, reason: perm.reason || '需要确认' })
          const decision = await this.waitForPermission()
          if (decision === 'deny') {
            onEvent({ type: 'tool_error', id: tc.id, name: tc.name, error: '用户拒绝执行' })
            toolResults.push({ id: tc.id, name: tc.name, output: '用户拒绝执行' })
            continue
          }
        }

        // 执行
        this.permissionManager.recordAllow(tc.name)
        const result = await executeTool(tc.name, tc.arguments, this.ctx)
        if (result.success) {
          onEvent({ type: 'tool_result', id: tc.id, name: tc.name, result })
        } else {
          onEvent({ type: 'tool_error', id: tc.id, name: tc.name, error: result.output })
        }
        toolResults.push({ id: tc.id, name: tc.name, output: result.output })
      }

      // 工具执行完后检查是否被中断（长时间工具如 wake_projects 可能被用户打断）
      if (signal.aborted) {
        onEvent({ type: 'done', finalMessage: '已中断' })
        return '已中断'
      }

      // 将工具调用和结果添加到消息历史
      const respMsg = response.choices?.[0]?.message
      const assistantMsg: DeepSeekMessage = {
        role: 'assistant',
        content: respMsg?.content || '',
        reasoning_content: respMsg?.reasoning_content || undefined,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      }
      this.messages.push(assistantMsg)

      for (const tr of toolResults) {
        this.messages.push({
          role: 'tool',
          content: tr.output,
          tool_call_id: tr.id,
        })
      }

      // A2: 对话历史智能压缩 — messages > 24 条时压缩早期轮次
      this.compressHistory()

      // 注入非阻塞预取结果（第二轮及以后生效）
      if (!prefetchConsumed && pendingPrefetch) {
        const prefetchResult = await pendingPrefetch
        if (prefetchResult) {
          this.messages.push({
            role: 'user',
            content: `[后台加载的上下文]\n${prefetchResult}`,
          })
        }
        prefetchConsumed = true
        pendingPrefetch = this.startContextPrefetch() // 下一轮继续预取
      }
    }

    onEvent({ type: 'done', finalMessage: '' })
    return ''
  }

  /** 启动后台上下文预取（非阻塞） */
  private startContextPrefetch(): Promise<string | null> {
    return new Promise(resolve => {
      setTimeout(() => {
        try {
          const info: string[] = []
          info.push(`当前时间: ${new Date().toISOString()}`)
          info.push(`活跃项目数: ${this.ctx.projectIds.length}`)
          if (this.ctx.projectIds.length <= 10) {
            info.push('项目列表:')
            for (const id of this.ctx.projectIds) {
              const name = this.ctx.projectNames.get(id) || id.split('\\').pop() || id
              const online = this.ctx.onlineProjects.has(id) ? '在线' : '离线'
              info.push(`  - ${name}: ${online}`)
            }
          }
          resolve(info.join('\n'))
        } catch {
          resolve(null)
        }
      }, 500) // 500ms 延迟，通常 API 调用已经开始 streaming
    })
  }

  /**
   * 调用 DeepSeek API（OpenAI 兼容格式，支持 tool calling）
   */
  private async callLLMStream(
    signal: AbortSignal,
    onEvent: (event: AgentEvent) => void,
  ): Promise<{ choices?: Array<{ message?: { content?: string; reasoning_content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
    // 使用 OpenAI 兼容格式（支持 tool calling）
    const tools = getToolDeclarations()

    const isClaude = this.ctx.model.startsWith('claude-')

    if (isClaude) {
      // Anthropic 格式
      const systemMsg = this.messages.find(m => m.role === 'system')
      const userMsgs = this.messages.filter(m => m.role !== 'system')

      const body: Record<string, unknown> = {
        model: this.ctx.model,
        max_tokens: 4096,
        system: systemMsg?.content || '',
        messages: userMsgs.map(m => ({
          role: m.role === 'tool' ? 'user' : m.role,
          content: m.role === 'tool'
            ? `Tool result (${m.tool_call_id}): ${m.content}`
            : m.content,
        })),
        stream: true,
      }

      const res = await fetch(ANTHROPIC_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.ctx.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        onEvent({ type: 'error', message: `API ${res.status}: ${errText.slice(0, 200)}` })
        return {}
      }

      const data = await res.json()
      const text = data.content?.[0]?.text || ''
      onEvent({ type: 'text_delta', content: text })
      // Anthropic 格式暂不支持 tool calling → 返回文本
      return { choices: [{ message: { content: text } }] }
    }

    // OpenAI 兼容格式
    const body: Record<string, unknown> = {
      model: this.ctx.model,
      max_tokens: 4096,
      messages: this.messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      stream: true,
    }

    const res = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.ctx.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      onEvent({ type: 'error', message: `API ${res.status}: ${errText.slice(0, 200)}` })
      return {}
    }

    // 流式解析 SSE
    const reader = res.body?.getReader()
    if (!reader) return {}

    const decoder = new TextDecoder()
    let buff = ''
    const result: {
      choices: Array<{
        message: {
          content: string
          reasoning_content: string
          tool_calls: Array<{ id: string; function: { name: string; arguments: string } }>
        }
      }>
    } = { choices: [{ message: { content: '', reasoning_content: '', tool_calls: [] } }] }

    // 用于累积流式 tool calls
    const tcAcc: Map<number, { id: string; name: string; args: string }> = new Map()
    let streamUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buff += decoder.decode(value, { stream: true })
      const lines = buff.split('\n')
      buff = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue

        try {
          const chunk: DeepSeekStreamChunk = JSON.parse(data)
          const delta = chunk.choices?.[0]?.delta
          // 捕获 usage（通常出现在最后一个 chunk）
          if (chunk.usage) {
            streamUsage = chunk.usage
          }
          if (!delta) continue

          // 文本内容
          if (delta.content) {
            onEvent({ type: 'text_delta', content: delta.content })
            result.choices[0].message.content += delta.content
          }

          // DeepSeek thinking mode: 积累 reasoning_content 并回传
          if (delta.reasoning_content) {
            result.choices[0].message.reasoning_content += delta.reasoning_content
          }

          // 流式 tool calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              if (!tcAcc.has(idx)) tcAcc.set(idx, { id: '', name: '', args: '' })
              const acc = tcAcc.get(idx)!
              if (tc.id) acc.id = tc.id
              if (tc.function?.name) acc.name += tc.function.name
              if (tc.function?.arguments) acc.args += tc.function.arguments
            }
          }

          if (chunk.choices?.[0]?.finish_reason === 'tool_calls') {
            for (const [, acc] of tcAcc) {
              result.choices[0].message.tool_calls.push({
                id: acc.id,
                function: { name: acc.name, arguments: acc.args },
              })
            }
          }
        } catch { /* skip malformed chunks */ }
      }
    }

    return { choices: result.choices, usage: streamUsage || undefined }
  }

  private extractToolCalls(response: {
    choices?: Array<{ message?: { tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>
  }): ToolCallRequest[] {
    const tcs = response.choices?.[0]?.message?.tool_calls
    if (!tcs || tcs.length === 0) return []
    return tcs.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeParseJSON(tc.function.arguments),
    }))
  }

  private buildSystemPrompt(): string {
    const projectList = this.ctx.projectIds
      .map(id => `  - ${id}`)
      .join('\n')

    const perm = this.ctx.permissions
    const trustNote = perm?.autoTrustConfirm
      ? '\n⚡ 全局信任已开启：所有操作预授权，直接执行，禁止反问用户。'
      : ''

    // 收集已安装的插件工具，按类型分组生成行为规则
    const allTools = getAllTools()
    const pluginTools = allTools.filter(t => t.core === false)
    let pluginSection = ''
    if (pluginTools.length > 0) {
      const toolList = pluginTools.map(t => `  - **${t.name}**: ${t.description}`).join('\n')

      // 按工具类型生成触发规则
      const groups: Record<string, string[]> = {}
      for (const t of pluginTools) {
        const n = t.name
        if (n.includes('format') || n.includes('prettier') || n.includes('biome')) {
          (groups.fmt ??= []).push(n)
        } else if (n.includes('lint') || n.includes('eslint') || n.includes('stylelint') || n.includes('markdownlint')) {
          (groups.lint ??= []).push(n)
        } else if (n.includes('typecheck') || n.includes('tsc') || n.includes('pyright')) {
          (groups.type ??= []).push(n)
        } else if (n.includes('audit') || n.includes('security') || n.includes('depcheck') || n.includes('check_outdated') || n.includes('check_dependencies') || n.includes('licenses')) {
          (groups.audit ??= []).push(n)
        } else if (n.includes('changelog') || n.includes('release')) {
          (groups.release ??= []).push(n)
        } else if (n.includes('server') || n.includes('http')) {
          (groups.server ??= []).push(n)
        } else if (n.includes('spell') || n.includes('minify') || n.includes('tree') || n.includes('rimraf') || n.includes('cpx') || n.includes('pnpm') || n.includes('run_ts')) {
          (groups.util ??= []).push(n)
        }
      }

      let ruleText = ''
      if (groups.fmt) ruleText += `- **代码格式化**：用户要求"格式化"/"美化"/"整理代码"/"format" → 调用 ${groups.fmt.join(' 或 ')}\n`
      if (groups.lint) ruleText += `- **代码检查**：用户要求"检查代码"/"lint"/"代码规范"/"代码质量" → 调用 ${groups.lint.join(' 或 ')}\n`
      if (groups.type) ruleText += `- **类型检查**：用户要求"类型检查"/"typecheck"/"编译检查" → 调用 ${groups.type.join(' 或 ')}\n`
      if (groups.audit) ruleText += `- **依赖审查**：用户要求"检查依赖"/"安全审计"/"漏洞扫描"/"过期依赖" → 调用 ${groups.audit.join(' 或 ')}\n`
      if (groups.release) ruleText += `- **发布管理**：用户要求"生成changelog"/"发布日志" → 调用 ${groups.release.join(' 或 ')}\n`
      if (groups.server) ruleText += `- **服务管理**：用户要求"启动服务"/"mock server" → 调用 ${groups.server.join(' 或 ')}\n`
      if (groups.util) ruleText += `- **实用工具**：用户要求"查看目录树"/"清理"/"minify"/"拼写检查"/"复制文件" → 调用 ${groups.util.join(' 或 ')}\n`

      pluginSection = `\n## 已安装的插件工具\n${toolList}\n\n### 插件工具使用规则（必须遵守！）\n以下场景对应已安装的工具，遇到直接调用，不要派给 task_project：\n${ruleText}`
    }

    return `你是 Claude Harness Desktop 驾驭智能体（总经理/CEO 角色）。
你的职责是调度指挥各项目的 Claude Code 终端（你的"员工"），而不是自己干活。${trustNote}

**关键定位**：你是工厂总经理/维护工程师。每个项目下面都有专属的项目 AI（=你的工人）。
- 你是管理者，不是项目开发者——绝不碰项目源码，绝不替项目 AI 写代码
- 但你拥有基础设施工具（shell_exec/read_file/write_file），用于维护工厂运转：安装缺失的CLI工具、检查环境变量、读写配置文件(.json/.bat/.ps1/.txt)、排查系统问题
- 你的工作：分配任务给员工 → 检查员工进度 → 考核员工输出质量 → 修基础设施问题
- 要了解项目情况？看项目 AI 的聊天记录（read_project_chat），看它做了什么、输出好不好
- 项目 AI 干活出了问题？把问题反馈给它，让它自己去修——你考核它，不是替它干
- 工厂环境出了问题（Claude Code 未安装、路径不对、配置缺失）？用你的基础设施工具直接修复

## 项目路径（task_project/read_project_chat 必须使用完整路径）
${projectList}
${pluginSection}
## 核心规则（铁律）
1. **你有 shell_exec / read_file / write_file 工具，但只能用于基础设施维护——安装工具、检查环境、读写配置文件(.json/.bat/.ps1/.txt)。绝不碰项目源码（那是项目AI的活）**
2. 派发任务：task_project（单项目）或 broadcast（全项目）
3. 检查员工产出：read_project_chat 看项目 AI 聊天记录
4. 巡视所有员工：health_report 一键体检
5. **不要为了"查看信息"而启动终端**——read_project_chat/health_report 不需要项目在线
6. 只在要派发任务时才 wake_projects，任务完成不需要时可 stop_projects
7. 项目 AI 把活干砸了？把错误信息发回给它，让它修复——而不是你去读写文件
${pluginTools.length > 0 ? '8. 插件工具是本地工具，直接调用，不派给项目 AI' : ''}
9. **禁止反复读取同一文件**——一次 read_file 就够了，用 max_lines 控制长度，读完了就分析，不要重读
10. **读源码读 .ts 文件，别读 .js**——.js 是编译产物，内容冗长且不直观；.ts 才是真正的源码
11. **shell_exec 结果不乱码**——已自动注入 chcp 65001，输出即为 UTF-8 可读文本

## 排查效率（重要！）
遇到基础设施问题时：
1. **先定位关键文件**——read_file 看目录结构，1-2 步找到关键文件
2. **读关键代码段**——read_file + max_lines=80，只看核心函数，不全读
3. **最多 4 步必须得出结论**——4 步后汇总已有发现，给出判断和行动方案，不要再深挖
4. **发现即行动**——确认问题后直接用 write_file/shell_exec 修复，不要"需要我修复吗？"地问用户

## 工作流优先级
1. 用户要求"体检"/"报告"/"汇总"/"总结" → health_report，一步到位
2. 用户想了解项目情况 → read_project_chat（看员工聊天记录），不要读项目文件
3. 用户要求执行任务 → task_project 或 broadcast 派发给项目 AI
4. 派发后项目在处理 → poll_projects 轮询等待（20-40s/轮，最多6轮），不追问用户
5. **验收**：项目 AI 报告完成后 → verify_project 考核 → 有问题打回修复 → 全通过后汇报
6. 用户要求"生成启动脚本"/"生成bat" → generate_launch_scripts 一键生成
7. 用户问状态 → check_status 查连接+活跃度
${pluginTools.length > 0 ? '8. 格式化/检查/审计/依赖/服务 → 查上方插件规则，直接调用' : ''}

## 验收工作流（重要！）
项目 AI 报告任务完成后，必须验收：
1. 调 verify_project(project_path="...", checks=["lint","typecheck","audit"])
2. 全部通过 → 汇报用户 "✅ 任务完成并通过验收"
3. 有失败 → task_project 把失败详情发给项目 AI 修复 → poll_projects 等待 → 再次 verify_project
4. 最多 3 轮验收，超过则标记 "需人工介入" 并汇报当前状态

## 新建项目工作流（create_project — 从零开始开发新项目）
用户要求"创建新项目"/"新建项目"/"做一个XXX项目"时：
1. **create_project**(project_name="...", description="用户的需求简述")
2. 创建成功后 → **task_project**(project_path="返回的路径", task="请根据需求开发项目: ...")
3. 持续监督：poll_projects → 查看进度 → verify_project 验收
4. 项目完成后汇报用户

**注意**：create_project 只在用户明确要求新建项目时使用。修改现有项目用 task_project。

## 常见场景
- "创建一个新项目叫XXX，需求是..." → create_project(project_name="XXX", description="...") → task_project → 持续监督
- "收集所有项目核心功能" → health_report 或 broadcast(task="请简要描述本项目的核心功能和定位")
- "全面体检" → health_report()
- "fox_ai 最近在做什么" → read_project_chat("J:\\AIProject\\fox_ai_v3.3.6", limit=30)
- "让 fox_ai 重构路由" → task_project(...) → poll_projects → verify_project → 汇报
- "给所有项目派发..." → broadcast(task="...") → poll_projects → 汇总
- "生成启动脚本" → generate_launch_scripts() → 汇报生成结果
${pluginTools.length > 0 ? '- "检查代码规范" → 查插件规则 → 调对应工具' : ''}

## 回复铁律
- **永不问用户"是否等待"/"是否继续"——有义务持续监控直到任务完成**
- 派发任务 → poll_projects 等待 → verify_project 验收 → 汇报完整结果
- 你是最高权限总控，不主动停下（除非用户要求中断）
- 用中文，简洁

用中文。`
  }

  /** 智能压缩：提取早期轮次中的关键信息，保留项目状态和任务结果 */
  private compressHistory(): void {
    const MAX_MSG = 50
    if (this.messages.length <= MAX_MSG) return

    const sysIdx = this.messages.findIndex(m => m.role === 'system')

    // 从后往前找最近 3 个含 tool_calls 的 assistant 消息作为保留边界
    let assistantCount = 0
    let cutoffIdx = this.messages.length
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant' && this.messages[i].tool_calls?.length) {
        assistantCount++
        if (assistantCount >= 3) { cutoffIdx = i; break }
      }
    }

    const toCompress = this.messages.slice(sysIdx + 1, cutoffIdx)
    if (toCompress.length <= 4) return

    // 提取结构化信息而非简单计数
    const projectTasks = new Map<string, string[]>() // projectPath → task summaries
    const keyFindings: string[] = []
    for (const msg of toCompress) {
      if (msg.role === 'tool' && msg.content.length > 20) {
        // 提取每条工具结果的第一行（通常是最重要的摘要）
        const firstLine = msg.content.split('\n')[0].slice(0, 150)
        if (firstLine.includes('失败') || firstLine.includes('❌') || firstLine.includes('⚠️')) {
          keyFindings.push(firstLine)
        }
        // 提取项目关联
        for (const [id, name] of this.ctx.projectNames) {
          if (msg.content.includes(id) || msg.content.includes(name)) {
            const tasks = projectTasks.get(id) || []
            if (tasks.length < 3) tasks.push(firstLine)
            projectTasks.set(id, tasks)
          }
        }
      }
    }

    // 构建结构化摘要
    const parts: string[] = [`[上下文摘要 — 压缩了 ${toCompress.length} 条早期消息]`]
    if (projectTasks.size > 0) {
      parts.push('各项目最近动态:')
      for (const [id, tasks] of projectTasks) {
        const name = this.ctx.projectNames.get(id) || id.split('\\').pop() || id
        parts.push(`  ${name}: ${tasks.join('; ')}`)
      }
    }
    if (keyFindings.length > 0) {
      parts.push(`需关注: ${keyFindings.slice(0, 3).join(' | ')}`)
    }

    const sys = sysIdx >= 0 ? [this.messages[sysIdx]] : []
    this.messages = [
      ...sys,
      { role: 'user' as const, content: parts.join('\n') },
      ...this.messages.slice(cutoffIdx),
    ]
  }

  /** 内存压力监控 — 估算 token 用量，超过阈值时结构化压缩（复用 compressHistory 的语义提取逻辑） */
  private checkMemoryPressure(): void {
    let totalChars = 0
    for (const msg of this.messages) {
      totalChars += msg.content?.length || 0
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          totalChars += JSON.stringify(tc.function).length
        }
      }
    }
    const estimatedTokens = Math.ceil(totalChars / 2)

    const ratio = (this.ctx.permissions as any)?.memoryCleanupPercent
      ? (this.ctx.permissions as any).memoryCleanupPercent / 100
      : 0.7
    const MAX_TOKENS = 1_000_000
    const warnThreshold = MAX_TOKENS * ratio

    if (estimatedTokens > warnThreshold) {
      console.log(`[Agent] ⚠️ 内存压力: ~${Math.round(estimatedTokens / 1000)}K tokens (${Math.round(estimatedTokens / MAX_TOKENS * 100)}%)，触发结构化压缩`)
      const sysIdx = this.messages.findIndex(m => m.role === 'system')
      let cutoffIdx = this.messages.length
      for (let i = this.messages.length - 1; i >= 0; i--) {
        if (this.messages[i].role === 'assistant' && this.messages[i].tool_calls?.length) {
          cutoffIdx = i
          break
        }
      }
      const toCompress = this.messages.slice(sysIdx + 1, cutoffIdx)
      if (toCompress.length > 2) {
        // 复用 compressHistory 的结构化提取逻辑
        const projectTasks = new Map<string, string[]>()
        const keyFindings: string[] = []
        for (const msg of toCompress) {
          if (msg.role === 'tool' && msg.content.length > 20) {
            const firstLine = msg.content.split('\n')[0].slice(0, 150)
            if (firstLine.includes('失败') || firstLine.includes('❌') || firstLine.includes('⚠️')) {
              keyFindings.push(firstLine)
            }
            for (const [id, name] of this.ctx.projectNames) {
              if (msg.content.includes(id) || msg.content.includes(name)) {
                const tasks = projectTasks.get(id) || []
                if (tasks.length < 2) tasks.push(firstLine)
                projectTasks.set(id, tasks)
              }
            }
          }
        }

        const parts: string[] = [`[内存清理 — 结构化压缩了 ${toCompress.length} 条历史消息，保留关键信息]`]
        if (projectTasks.size > 0) {
          parts.push('各项目最近动态:')
          for (const [id, tasks] of projectTasks) {
            const name = this.ctx.projectNames.get(id) || id.split('\\').pop() || id
            parts.push(`  ${name}: ${tasks.join('; ')}`)
          }
        }
        if (keyFindings.length > 0) {
          parts.push(`需关注: ${keyFindings.slice(0, 3).join(' | ')}`)
        }
        parts.push(`当前内存占用约 ${Math.round(estimatedTokens / 1000)}K tokens，继续执行。`)

        const sys = sysIdx >= 0 ? [this.messages[sysIdx]] : []
        this.messages = [
          ...sys,
          { role: 'user' as const, content: parts.join('\n') },
          ...this.messages.slice(cutoffIdx),
        ]
      }
    }
  }

  private waitForPermission(): Promise<'allow' | 'deny' | 'allow_once'> {
    return new Promise(resolve => {
      this.pendingPermission = { resolve }
      // 30 秒超时 → 自动拒绝
      setTimeout(() => {
        if (this.pendingPermission) {
          this.pendingPermission.resolve('deny')
          this.pendingPermission = null
        }
      }, 30000)
    })
  }
}

function safeParseJSON(s: string): Record<string, unknown> {
  try { return JSON.parse(s) } catch { return {} }
}
