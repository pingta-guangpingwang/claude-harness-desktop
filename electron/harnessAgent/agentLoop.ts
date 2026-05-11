// 驾驭智能体核心循环 — Claude Code 范式
// User Prompt → Think (LLM stream) → Tool Calls → Execute → Feed Results → Loop → Respond

import type { AgentContext, AgentEvent, ToolCallRequest } from './types'
import { executeTool, getToolDeclarations, getTool, getAllTools } from './toolRegistry'
import { PermissionManager } from './permissionManager'
import { taskQueue } from './taskQueue.js'

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

  constructor(ctx: AgentContext, pm: PermissionManager, conversationHistory?: ConversationTurn[]) {
    this.ctx = ctx
    this.permissionManager = pm

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

    let maxTurns = 15 // 防止无限循环

    while (maxTurns-- > 0) {
      if (signal.aborted) break

      // 内存压力检查：估计 token 用量，超过 80% 时触发激进清理
      this.checkMemoryPressure()

      // 调用 LLM
      const response = await this.callLLMStream(signal, onEvent)

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
  ): Promise<{ choices?: Array<{ message?: { content?: string; reasoning_content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> }> {
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

    return result
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

    // 收集已安装的插件工具
    const allTools = getAllTools()
    const pluginTools = allTools.filter(t => !t.core)
    let pluginSection = ''
    if (pluginTools.length > 0) {
      const toolList = pluginTools.map(t => `  - **${t.name}**: ${t.description}`).join('\n')
      pluginSection = `\n## 已安装的插件工具（你可以直接调用）\n${toolList}\n使用这些工具来处理格式化、代码检查、测试等任务。`
    }

    return `你是 Claude Harness Desktop 驾驭智能体，一个 AI 项目经理。
你的职责是调度指挥各项目的 Claude Code 终端，而不是自己写代码。${trustNote}

## 项目路径（task_project/read_project_chat 必须使用完整路径）
${projectList}
${pluginSection}
## 核心规则
1. 绝不自己读文件/写文件/执行 shell — 这是项目 AI 的活
2. 用 task_project（单项目）或 broadcast（全项目）派发自然语言任务
3. 用 read_project_chat 读取项目 AI 最近的聊天记录，了解项目当前状态
4. 用 health_report 做全面体检 — 它自动读取所有项目聊天记录生成报告
5. task_project 的 project_path 参数必须填写上方列表中的完整路径
6. wake_projects 启动终端，stop_projects 停止，check_status 查 PTY 状态
${pluginTools.length > 0 ? '7. 已安装的插件工具可直接调用，用于格式化、lint、测试等辅助任务' : ''}

## 工作流优先级
1. 用户要求"体检"/"报告"/"汇总"/"总结" → 直接调 health_report(detail_level="normal")，一次搞定
2. 用户想了解某个项目近况 → 先调 read_project_chat，根据聊天内容回答
3. 用户要求执行新任务 → 调 task_project 派发，项目 AI 的回复会自动推送到对话窗口
4. 用户问状态 → 调 check_status 查 PTY 连接，再调 read_project_chat 查最近活动
${pluginTools.length > 0 ? '5. 用户要求格式化/检查代码 → 直接调用安装的插件工具（format_*, lint_*等）' : ''}

## 示例
- 用户说"全面体检" → 调 health_report() → 报告直接呈现给用户
- 用户说"fox_ai 最近在做什么" → 调 read_project_chat(project_path="完整路径", limit=30) → 根据聊天内容回答
- 用户说"让 fox_ai 重构路由" → 调 task_project(project_path="完整路径", task="重构路由逻辑...") → 等待回复后汇报
- 用户说"检查状态" → 调 check_status → 汇报在线情况
${pluginTools.length > 0 ? '- 用户说"格式化代码" → 调已经安装的 format 工具（插件工具在可用工具列表中）' : ''}

## 回复铁律
- 优先用 health_report 做体检，不要手动逐个 task_project
- 先读聊天记录再回答关于项目状态的问题
- 汇报结果即结束，不追问
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
