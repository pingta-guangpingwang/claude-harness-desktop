// 驾驭智能体核心循环 — Claude Code 范式
// User Prompt → Think (LLM stream) → Tool Calls → Execute → Feed Results → Loop → Respond

import type { AgentContext, AgentEvent, ToolCallRequest } from './types'
import { executeTool, getToolDeclarations, getTool, getAllTools } from './toolRegistry'
import { PermissionManager } from './permissionManager'
import { taskQueue } from './taskQueue.js'
import { getTokenStore } from '../modules/tokenStore.js'
import { buildReflectionPrompt, parseReflectionOutput, formatReflectionForLLM, type ReflectionResult } from './reflector.js'
import { getActiveProjectTasks } from './tools.js'
import { MemoryManager } from './memoryStore.js'
import { TokenBudgeter, estimateTokens, estimateMessagesTokens } from './tokenBudget.js'
import { detectProvider, type LLMProvider } from './llmProviders.js'
import { buildContext } from './contextPipeline.js'
import { SemanticMemory } from './semanticMemory.js'

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

// V3: Provider 抽象 — 不再硬编码 endpoint
function getProvider(model: string, explicitProviderId?: string): LLMProvider {
  return detectProvider(model, explicitProviderId)
}

/** fetch 带超时的包装器 — 超时抛 AbortError，不残留定时器 */
async function fetchWithTimeout(
  url: string, init: RequestInit, timeoutMs: number,
): Promise<Response | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  // 若父 signal 先触发，也中止
  if (init.signal) {
    init.signal.addEventListener('abort', () => ac.abort(), { once: true })
  }
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

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
  private roundIndex = 0

  // V3: 记忆存储 + Token 预算
  private memory: MemoryManager = new MemoryManager()
  private tokenBudgeter: TokenBudgeter
  private semanticMemory: SemanticMemory

  constructor(ctx: AgentContext, pm: PermissionManager, conversationHistory?: ConversationTurn[]) {
    this.ctx = ctx
    this.permissionManager = pm
    this.conversationId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    this.tokenBudgeter = new TokenBudgeter(ctx.model)
    this.semanticMemory = new SemanticMemory(this.memory.cold, ctx.apiKey)

    // 注入跨轮次对话历史（保留上下文记忆）
    if (conversationHistory && conversationHistory.length > 0) {
      for (const turn of conversationHistory) {
        this.messages.push({ role: turn.role, content: turn.content })
        this.memory.recordEvent(turn.role, turn.content)
      }
    }
  }

  abort(): void {
    this.ctx.aborted = true
    this.abortController?.abort()
    this.pendingPermission?.resolve('deny')
    this.pendingPermission = null
  }

  /** 用户中途插入消息 → 加入队列 + 立即中断当前 API 调用（Claude Code 范式）。
   *  不中断整个 Agent 循环，只中断当前 LLM 请求，让新消息在下一轮立即生效。 */
  queueMessage(msg: string): void {
    if (!this.ctx.pendingMessages) {
      this.ctx.pendingMessages = []
    }
    this.ctx.pendingMessages.push(msg)
    // Claude Code 范式：用户中途插话 → 立即中断当前 API 调用
    // 不 destroy agent，只 signal abort 让当前 callLLMStream 快速返回
    this.abortController?.abort('user_interject')
  }

  resolvePermission(decision: 'allow' | 'deny' | 'allow_once'): void {
    this.pendingPermission?.resolve(decision)
    this.pendingPermission = null
  }

  async run(userMessage: string, onEvent: (event: AgentEvent) => void): Promise<string> {
    this.eventCallback = onEvent
    this.abortController = new AbortController()
    let signal = this.abortController.signal

    // 注入事件回调到上下文，让工具可以将项目 AI 回复推送到驾驭对话
    this.ctx.emitEvent = onEvent

    onEvent({ type: 'thinking_start' })

    // V3: 记录用户消息到热记忆
    this.memory.recordEvent('user', userMessage)

    // V3: 通过六步 Processor Pipeline 构建系统提示词
    const systemPrompt = await buildContext(this.ctx, this.tokenBudgeter)

    // 构建消息：保留历史对话 + 系统提示 + 当前用户消息
    this.messages = [
      ...this.messages,
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]

    // 非阻塞预取：后台加载上下文，不阻塞首轮 API 调用
    let pendingPrefetch = this.startContextPrefetch()
    let prefetchConsumed = false

    let maxTurns = 30 // 充足的探活+广播+轮询+验收轮次

    while (maxTurns-- > 0) {
      // 检查用户中途插入的消息队列 → 优先处理（Claude Code 范式）
      const pending = this.ctx.pendingMessages
      if (pending && pending.length > 0) {
        const merged = pending.splice(0, pending.length)
        for (const msg of merged) {
          // 注入上下文：告诉 Agent 用户中途插话，要继续之前的工作
          this.messages.push({ role: 'user', content: `[用户中途插话] ${msg}\n\n继续你之前的工作，不要因为新消息而放弃正在进行的任务。将用户的新要求融入当前工作流。` })
          onEvent({ type: 'user_queued', text: msg })
        }
        // 重置轮次计数，给新消息足够的处理空间
        maxTurns = Math.max(maxTurns, 10)
        console.log('[AgentLoop] 合并用户中途消息:', merged.length, '条')
      }

      // 仅在无待处理消息时检查中止信号（有消息 = 用户插话，不是完全中止）
      if (!pending || pending.length === 0) {
        if (signal.aborted) break
      }

      // 调用 LLM（捕获中断信号 + 网络瞬断重试，避免 AbortError/TypeError 泄漏到前端显示）
      let response: Awaited<ReturnType<typeof this.callLLMStream>>
      let lastError: any = null
      let llmSuccess = false
      for (let attempt = 0; attempt < 3 && !llmSuccess; attempt++) {
        try {
          response = await this.callLLMStream(signal, onEvent)
          llmSuccess = true
        } catch (e: any) {
          lastError = e
          if (e?.name === 'AbortError' || signal.aborted) {
            // 区分：用户插话（queueMessage 触发的 abort）vs 完全中止（abort 按钮）
            if (this.ctx.pendingMessages && this.ctx.pendingMessages.length > 0) {
              this.abortController = new AbortController()
              signal = this.abortController.signal
              console.log('[AgentLoop] 用户插话中断 — 重建 controller，继续循环')
              continue
            }
            onEvent({ type: 'done', finalMessage: '' })
            return '用户中断，等待新指令'
          }
          // 网络错误 → 重试（最多 2 次）
          if ((e instanceof TypeError || e?.name === 'TypeError' || String(e).includes('fetch failed')) && attempt < 2) {
            const delay = (attempt + 1) * 3000
            onEvent({ type: 'text_delta', content: `\n⚠️ API 网络异常，${delay / 1000}s 后重试 (${attempt + 1}/2)...` })
            console.warn(`[AgentLoop] fetch failed, retry ${attempt + 1}/2 after ${delay}ms`)
            await new Promise(r => setTimeout(r, delay))
            if (signal.aborted) break
            continue
          }
          // 非网络错误或重试耗尽 → 抛出
          llmSuccess = false
        }
      }
      if (!llmSuccess) throw lastError

      // 记录 token 消耗
      if (response.usage) {
        // V3: 喂给 TokenBudgeter 做闭环追踪
        this.tokenBudgeter.recordRoundUsage(
          response.usage.prompt_tokens,
          response.usage.completion_tokens,
          this.roundIndex,
        )
        this.roundIndex++

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

        // V3: 每 5 轮汇报一次 token 利用率
        if (this.roundIndex % 5 === 0) {
          const report = this.tokenBudgeter.getUtilizationReport()
          onEvent({ type: 'text_delta', content: `\n📊 ${report}` })
        }
      }

      if (signal.aborted) break

      // 收集 tool calls
      const toolCalls = this.extractToolCalls(response)
      if (toolCalls.length === 0) {
        // 没有工具调用 → Agent 本轮"想说点什么"
        const finalText = response.choices?.[0]?.message?.content || ''

        // 保存本轮 assistant 回复到对话历史
        if (finalText) {
          this.messages.push({ role: 'assistant', content: finalText })
        }

        // C1: 自主循环 — 队列有待办时自动取下一个执行
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
        }

        // C2: 心跳守卫 — 有活跃项目任务时，禁止停止！注入心跳检查，让 Agent 继续轮询
        const activeTasks = getActiveProjectTasks()
        // 先过滤掉过期标记：超过 5 分钟且 PTY 空闲的 → 自动视为完成，不触发心跳
        let staleCount = 0
        const trulyActive: Array<[string, { task: string; startedAt: number; lastCheckAt: number }]> = []
        for (const [p, t] of activeTasks) {
          const elapsed = Date.now() - t.startedAt
          if (elapsed > 300000) {
            staleCount++
            continue // 超过 5 分钟视为过期，不阻塞停止
          }
          trulyActive.push([p, t])
        }
        if (staleCount > 0) {
          onEvent({ type: 'text_delta', content: `\n🧹 心跳守卫: ${staleCount} 个项目 busy 标记已过期(>5min)，自动忽略` })
        }

        if (trulyActive.length > 0 && !signal.aborted) {
          const projectNames: string[] = []
          for (const [p, t] of trulyActive) {
            const name = this.ctx.projectNames.get(p) || p.split('\\').pop() || p
            projectNames.push(`${name}(${Math.round((Date.now() - t.startedAt) / 1000)}s前: ${t.task.slice(0, 40)})`)
          }
          const heartbeatPrompt = `[心跳守卫] 以下 ${trulyActive.length} 个项目仍有活跃任务，**你不能停止**！请立即检查进度：
${projectNames.map(n => `  - ${n}`).join('\n')}

执行步骤：
1. poll_projects 检查活跃状态（会自动清理过期 busy 标记）
2. 对空闲的项目 read_project_chat 确认是完成了还是被卡住
3. 已完成的项目用 verify_project 验收
4. 被卡住的项目用 diagnose_project 诊断 → 按恢复策略解除阻塞 → 重新派发任务
5. 仍在工作中的项目继续等待

**完成验收后 poll_projects 会自动清除 busy 标记，下次心跳就不会再触发。**`

          onEvent({ type: 'text_delta', content: `\n💓 心跳守卫: ${trulyActive.length} 个项目仍在工作中，继续监控...` })
          this.messages.push({ role: 'user', content: heartbeatPrompt })
          // 重置轮次计数，给心跳检查充足的轮次
          maxTurns = Math.max(maxTurns, 15)
          continue
        }

        // 所有 busy 都已过期 → 清理掉，允许停止
        if (staleCount > 0 && trulyActive.length === 0) {
          onEvent({ type: 'text_delta', content: '\n✅ 所有项目 busy 标记已过期或已清理，任务完成。' })
        }

        // C3: 队列空 + 无活跃项目任务 → 真正完成
        if (this.ctx.autonomousMode) {
          onEvent({ type: 'text_delta', content: '\n✅ 所有任务已完成，队列已清空' })
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
        const summarized = this.summarizeToolResult(tr.name, tr.output)
        this.messages.push({
          role: 'tool',
          content: summarized,
          tool_call_id: tr.id,
        })
        // V3: 记录工具结果到热记忆
        this.memory.recordEvent('tool', summarized, tr.name)
      }

      // V3: Token 预算驱动的智能压缩（替代旧的无脑截断）
      this.smartCompress()

      // A3: Reflection 反思步骤 — 工具执行后、下一轮决策前，轻量级结构化反思
      if (toolCalls.length > 0 && toolResults.length > 0 && !signal.aborted) {
        try {
          const reflection = await this.runReflection(toolResults, signal)
          if (reflection) {
            this.messages.push({
              role: 'user',
              content: formatReflectionForLLM(reflection),
            })
          }
        } catch {
          // Reflection 失败不阻塞主循环
        }
      }

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
   * 轻量级 Reflection 调用 — 使用 tool_choice: 'none' 强制纯文本输出
   * 速度极快（~1-2s），token 消耗极低（~200 tokens）
   */
  private async runReflection(
    toolResults: Array<{ name: string; output: string }>,
    signal: AbortSignal,
  ): Promise<ReflectionResult | null> {
    // 跳过连续调用：距上次 Reflection 不到 30s 则跳过
    const now = Date.now()
    if (this._lastReflectionAt && now - this._lastReflectionAt < 30000) return null
    this._lastReflectionAt = now

    const reflectionPrompt = buildReflectionPrompt(toolResults, this.ctx)
    const reflectionMessages = [
      { role: 'user' as const, content: reflectionPrompt },
    ]

    try {
      const provider = getProvider(this.ctx.model)
      const isAnthropic = provider.format === 'anthropic'

      const body = isAnthropic
        ? {
            model: this.ctx.model,
            max_tokens: 300,
            system: '',
            messages: reflectionMessages,
            stream: false,
          }
        : {
            model: this.ctx.model,
            max_tokens: 300,
            messages: reflectionMessages,
            tool_choice: 'none' as const,
            stream: false,
          }

      const endpoint = isAnthropic ? (provider.messagesEndpoint || provider.chatEndpoint) : provider.chatEndpoint
      const headers = provider.buildHeaders(this.ctx.apiKey)

      // 8 秒超时：Reflection 快了有用、慢了拖后腿，超时直接放弃
      const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      }, 8000)

      if (!res || !res.ok) return null
      const data = await res.json() as any
      const raw = isAnthropic ? (data.content?.[0]?.text || '') : (data.choices?.[0]?.message?.content || '')
      return parseReflectionOutput(raw)
    } catch {
      return null
    }
  }
  private _lastReflectionAt: number = 0

  /**
   * 调用 DeepSeek API（OpenAI 兼容格式，支持 tool calling）
   */
  private async callLLMStream(
    signal: AbortSignal,
    onEvent: (event: AgentEvent) => void,
  ): Promise<{ choices?: Array<{ message?: { content?: string; reasoning_content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
    // 使用 OpenAI 兼容格式（支持 tool calling）
    const tools = getToolDeclarations()

    const provider = getProvider(this.ctx.model)
    const isAnthropic = provider.format === 'anthropic'

    if (isAnthropic) {
      // Anthropic Messages API — 完整支持 streaming tool_use
      const systemMsg = this.messages.find(m => m.role === 'system')
      const nonSystemMsgs = this.messages.filter(m => m.role !== 'system')

      // 转换工具声明: OpenAI format → Anthropic format
      const anthropicTools = tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }))

      // 转换消息: 内部 DeepSeekMessage → Anthropic content blocks 格式
      const anthropicMessages = nonSystemMsgs.map(m => {
        if (m.role === 'assistant' && m.tool_calls?.length) {
          const content: Array<Record<string, unknown>> = []
          if (m.content) content.push({ type: 'text', text: m.content })
          for (const tc of m.tool_calls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: (() => { try { return JSON.parse(tc.function.arguments || '{}') } catch { return {} } })(),
            })
          }
          return { role: 'assistant', content }
        }
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: m.tool_call_id || '',
              content: m.content,
            }],
          }
        }
        return { role: m.role, content: m.content }
      })

      const body: Record<string, unknown> = {
        model: this.ctx.model,
        max_tokens: 4096,
        system: systemMsg?.content || '',
        messages: anthropicMessages,
        stream: true,
      }
      if (anthropicTools.length > 0) body.tools = anthropicTools

      const endpoint = provider.messagesEndpoint || provider.chatEndpoint
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: provider.buildHeaders(this.ctx.apiKey),
        body: JSON.stringify(body),
        signal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        onEvent({ type: 'error', message: 'API ' + res.status + ': ' + errText.slice(0, 200) })
        return {}
      }

      // 流式解析 Anthropic SSE (event: + data: 行格式)
      const reader = res.body?.getReader()
      if (!reader) return {}

      const decoder = new TextDecoder()
      let buff = ''
      let fullText = ''
      const tuAcc: Map<number, { id: string; name: string; input: string }> = new Map()
      const result = {
        choices: [{
          message: {
            content: '',
            reasoning_content: '',
            tool_calls: [],
          },
        }],
      }
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
          if (!data) continue

          try {
            const event = JSON.parse(data)

            if (event.type === 'content_block_delta') {
              const delta = event.delta
              if (delta?.type === 'text_delta' && delta.text) {
                onEvent({ type: 'text_delta', content: delta.text })
                fullText += delta.text
              }
              if (delta?.type === 'input_json_delta' && delta.partial_json) {
                const idx = event.index ?? 0
                if (!tuAcc.has(idx)) tuAcc.set(idx, { id: '', name: '', input: '' })
                tuAcc.get(idx).input += delta.partial_json
              }
            }

            if (event.type === 'content_block_start') {
              const cb = event.content_block
              if (cb?.type === 'tool_use') {
                const idx = event.index ?? 0
                tuAcc.set(idx, { id: cb.id || '', name: cb.name || '', input: '' })
              }
            }

            if (event.type === 'message_delta') {
              if (event.usage) {
                streamUsage = {
                  prompt_tokens: event.usage.input_tokens || 0,
                  completion_tokens: event.usage.output_tokens || 0,
                  total_tokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
                }
              }
            }
          } catch { /* skip malformed events */ }
        }
      }

      result.choices[0].message.content = fullText
      // 转换 tool_use blocks → OpenAI 兼容 tool_calls 格式
      for (const [, acc] of tuAcc) {
        if (acc.name) {
          result.choices[0].message.tool_calls.push({
            id: acc.id,
            function: { name: acc.name, arguments: acc.input },
          })
        }
      }

      return { choices: result.choices, usage: streamUsage || undefined }
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

    const res = await fetch(provider.chatEndpoint, {
      method: 'POST',
      headers: provider.buildHeaders(this.ctx.apiKey),
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

    return `你是 DeepBlue 驾驭智能体（CEO/总经理角色）。
你的职责是调度指挥各项目的 Claude Code 终端（你的"员工"），而不是自己干活。${trustNote}

## 🫀 心跳纪律 — 总控不停止原则（最高优先级，违反即失职）
你是**总控制器**，不是一次性工人。你的任务不是"回复一句就停"，而是**持续监控直到全部任务确认完成**。

**禁止停止的情况**（遇到以下任一情况，必须继续工作）：
1. 有项目 AI 正在工作中（🟢 工作中 / ⚡有任务进行中）
2. 刚派发了任务但尚未验证完成
3. 有项目被对话框卡住需要应答

**只有以下情况才能停止**：
- ✅ 所有项目任务已确认完成（read_project_chat 验证了每个项目的产出）
- ⛔ 用户明确要求中止
- 🔁 同一操作连续失败 3 次且切换策略后依然失败 → 汇报死结，请求用户决策

**停止前的强制检查清单**：
1. check_status → 确认全部在线
2. 对每个有活跃任务的项目 read_project_chat → 确认 📊 状态是 ✅就绪
3. 确认所有项目都有明确的完成输出（●回复中包含结果，不只是问候语）
4. 汇总所有项目的产出报告

**系统心跳守护**：如果你连续 2 轮没调工具，系统会自动注入心跳检查。这是你的最后安全网——但你应该在心跳触发之前就主动检查。不要依赖系统推你。

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
6. **REMEMBER**：解阻塞 ≠ 任务完成！修复配置/应答对话框后，必须追问原始任务是否完成，没完成就重新派发
7. **CONTINUE**：本轮结束后，如果还有项目在工作中或未验证 → 继续下一轮检查，不要停

## 🎯 范围纪律（最高优先级 — 违反此条等于失职）
- 用户说"只测 sub2api" → **只动 sub2api**，不碰其他项目
- 用户说"检查所有项目" → 才可以管所有项目
- 用户说"唤醒" → 只调 wake_projects，不跟 task_project/broadcast
- **不要自作主张扩大范围**：看到其他项目有问题 ≠ 你应该去修。除非用户明确授权，否则只处理用户点名的那几个项目
- **不要"顺带检查"**：poll_projects/check_status 会返回全部项目状态，但这只是背景信息，不是让你去修其他项目

## 核心定位
- 你是管理者，不是项目开发者——**绝不碰项目源码**，只维护基础设施
- 你的基础设施工具（shell_exec/read_file/write_file）**仅用于**：安装CLI工具、检查环境变量、读写配置文件(.json/.bat/.ps1/.txt)
- **项目级操作一律派给项目 AI**：npm install / pip install / 编译 / 测试 / 创建文件 / 改代码 → task_project 或 broadcast。不要自己用 shell_exec 跑！
- 了解项目情况 → read_project_chat（看聊天记录）或 check_status（看心跳状态）
- 项目 AI 出了问题 → 用 diagnose_project 分诊 → 把错误反馈给项目 AI 让它自己修
- 工厂环境出问题（Claude Code配置/API Key/网络） → 用 search_knowledge 查修复方案 → 用基础设施工具修

## 🔒 不打断原则（最高优先级）
项目 AI 正在工作时，**绝不**向它发送新文本。唯一例外：
- 项目 AI 明显在犯错（死循环、改错文件） → write_to_pty Ctrl+C
- 项目 AI 被对话框卡住（权限/信任/更新） → write_to_pty 按键应答
- task_project 和 broadcast 有内置 busy 保护 — 忙碌项目自动跳过或阻断

## 项目路径（task_project/read_project_chat/diagnose_project 必须使用完整路径）
${projectList}
${pluginSection}
## 核心工具速查
| 场景 | 工具 | 说明 |
|------|------|------|
| 启动/验证在线 | wake_projects | 已内置 ping 验证，唤醒后汇报结果即可，禁止接着派任务 |
| 派活（单项目） | task_project | 有 busy 保护 |
| 派活（全项目） | broadcast | busy 的项目自动跳过 |
| 查看产出/状态 | read_project_chat | 📊状态标签（✅就绪/⚠️阻塞/⏳思考/✻工作）+ 📡终端输出 |
| 快速扫一眼 | check_status | 连接+活跃度+语义状态标签 |
| 等待完成 | poll_projects | **最多3轮！** 3轮后必须 read_project_chat 验收 |
| 诊断问题 | diagnose_project | 自动分诊（配置/权限/网络/项目错误）→ 给恢复步骤 |
| 查修复方案 | search_knowledge | 搜 API 配置配方 + 错误恢复模式 |
| 深度体检 | health_report | 仅在用户说"体检"/"报告"时用 |
| 验收质量 | verify_project | lint+typecheck+audit |
| 生成启动脚本 | generate_launch_scripts | 含路径检查+工具预检 |

## 关键原则
1. **范围纪律**：用户说只测哪个项目就只测哪个，**严禁**把其他项目也拉进来一起测。poll_projects 返回的全项目状态只是背景信息，不是让你去修所有项目。
2. **唤醒 ≠ 派活**：用户说"唤醒"→ 只调 wake_projects → 汇报结果 → 停。不跟 broadcast/task_project
3. **idle ≠ 完成**：poll 显示空闲 → 必须 read_project_chat 验证 📊 状态是 ✅就绪（不是 ⚠️阻塞）
4. **先诊断再行动**：项目出问题 → diagnose_project 分诊 → 按分类走恢复策略。**不要盲重启！**
5. **解阻塞 ≠ 任务完成**：修复配置/应答对话框后，项目 AI 只是恢复了工作能力，**不等于完成了原始任务**。必须：
   - check_status 确认在线 → read_project_chat 查看进度 → 如未完成则重新 task_project/broadcast
6. **看对话框再应答**：read_project_chat 输出中带 [对话框] 和 [选项] 的行就是当前卡住的内容，**看清楚具体选项再选**（"1. Yes" 就发 "1"，不是发 "y" 或回车）
7. **多项目操作 ≠ 逐个 shell_exec**：用户要在全部项目执行某操作（npm install、编译、测试等） → 用 broadcast（一次调用，项目 AI 自己执行）。**不允许**用 shell_exec 逐个跑——壳层项目没有 Node 环境、子包不在根目录等，项目 AI 比你清楚！
8. **不要反复读同一文件** — 一次 read_file 就够了
9. **读 .ts 别读 .js** — .js 是编译产物
10. **最多 3 步出行动** — 别陷入"让我再看看"的循环
11. **多项目并行** — 派给A → 派给B → 回头轮询A → 推进B
12. **输出就是交付** — 汇总结果直接呈现在对话里，不要让用户去别处看
13. **项目 AI 反复离线** → write_file 写入 settings.json 含 hasTrustDialogAccepted:true + defaultMode:"acceptEdits"
14. **永不问用户"是否等待/是否继续"** — 你作为总控有义务持续监控直到所有任务完成
15. **心跳是你的呼吸** — 每轮决策最后问自己："还有项目在工作吗？验证完了吗？"如果没验证完，下一轮继续

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
  }

  /** 智能压缩：提取早期轮次中的关键信息，保留项目状态和任务结果 */
  /** 工具结果智能摘要 — 超过 500 字符的结果提取关键行，避免噪声淹没 LLM */
  private summarizeToolResult(toolName: string, output: string): string {
    if (output.length <= 500) return output

    const lines = output.split('\n')
    const keyLines = lines.filter(l =>
      /✅|❌|⚠️|失败|成功|错误|在线|离线|阻塞|完成|📊|🟢|🔴|🟡|⚪|⏳|✻|✽|🧠|诊断|恢复|建议/.test(l)
    )
    if (keyLines.length === 0) return output.slice(0, 500) + `\n（原始输出 ${output.length} 字符，已截断）`

    const summary = keyLines.slice(0, 10).join('\n')
    return `${summary}\n（原始输出 ${output.length} 字符，已提取 ${keyLines.length} 条关键行）`
  }

  /**
   * V3: Token 预算驱动的智能压缩
   * 替代旧的一刀切 3 轮截断 + 1M token 粗暴阈值
   *
   * 核心原则：默认全量保留。只在 TokenBudgeter 检测到接近窗口上限（>80%）时才触发温记忆摘要。
   * 对于典型用户场景（20-30 轮），完全不触发摘要，全程全量记忆。
   */
  private smartCompress(): void {
    const totalTokens = estimateMessagesTokens(this.messages)
    const maxTokens = this.tokenBudgeter.getProviderCapabilities(this.ctx.model).maxContextTokens
    const safeThreshold = Math.floor(maxTokens * 0.8)

    if (totalTokens <= safeThreshold) return // 远未到阈值，全量保留

    console.log(`[Agent] ⚠️ Token 预算触发: ${(totalTokens / 1000).toFixed(0)}K/${(maxTokens / 1000).toFixed(0)}K (${((totalTokens / maxTokens) * 100).toFixed(1)}%)，执行智能压缩`)

    // 找到 system 消息和最近 4 个完整轮次
    const sysIdx = this.messages.findIndex(m => m.role === 'system')
    let assistantCount = 0
    let cutoffIdx = this.messages.length
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant' && this.messages[i].tool_calls?.length) {
        assistantCount++
        if (assistantCount >= 4) { cutoffIdx = i; break }
      }
    }

    const toCompress = this.messages.slice(sysIdx + 1, cutoffIdx)
    if (toCompress.length <= 4) return

    // 结构化提取：操作的项目 + 关键发现 + 活跃工具
    const projectActions = new Map<string, string[]>()
    const keyFindings: string[] = []
    const activeToolNames = new Set<string>()

    for (const msg of toCompress) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          activeToolNames.add(tc.function.name)
        }
      }
      if (msg.role === 'tool' && msg.content.length > 20) {
        const keyLines = msg.content.split('\n').filter(l =>
          /✅|❌|⚠️|失败|成功|错误|在线|离线|阻塞|完成|📊|🟢|🔴|🟡|⏳|✻|🧠/.test(l)
        )
        const extracted = keyLines.length > 0
          ? keyLines.slice(0, 3).map(l => l.trim().slice(0, 120)).join(' | ')
          : msg.content.split('\n')[0].slice(0, 120)

        if (/失败|❌|⚠️|错误|阻塞/.test(extracted)) {
          keyFindings.push(extracted)
        }

        for (const [id, name] of this.ctx.projectNames) {
          if (msg.content.includes(id) || msg.content.includes(name)) {
            const actions = projectActions.get(id) || []
            if (actions.length < 3) actions.push(extracted)
            projectActions.set(id, actions)
          }
        }
      }
    }

    const parts: string[] = [`[Token预算压缩 — 压缩了 ${toCompress.length} 条早期消息，保留最近 4 轮完整对话。当前上下文利用率: ${((totalTokens / maxTokens) * 100).toFixed(0)}%]`]
    if (activeToolNames.size > 0) {
      parts.push(`已调用工具: ${[...activeToolNames].join(', ')}`)
    }
    if (projectActions.size > 0) {
      parts.push('各项目动态:')
      for (const [id, actions] of projectActions) {
        const name = this.ctx.projectNames.get(id) || id.split('\\').pop() || id
        parts.push(`  ${name}: ${actions.join('; ')}`)
      }
    }
    if (keyFindings.length > 0) {
      parts.push(`需关注: ${keyFindings.slice(0, 5).join(' | ')}`)
    }

    const sys = sysIdx >= 0 ? [this.messages[sysIdx]] : []
    this.messages = [
      ...sys,
      { role: 'user' as const, content: parts.join('\n') },
      ...this.messages.slice(cutoffIdx),
    ]

    // V3: 将被压缩的事件范围记录到温记忆（异步 LLM 摘要稍后由 Summarizer 完成）
    this.memory.warm.addSummary({
      eventRange: [0, cutoffIdx],
      summary: parts.join('\n'),
      keyFacts: keyFindings.slice(0, 5),
    })

    console.log(`[Agent] ✅ 压缩完成: ${this.messages.length} 条消息, ~${(estimateMessagesTokens(this.messages) / 1000).toFixed(0)}K tokens`)
  }

  /** 获取记忆统计（供测试/调试用） */
  getMemoryStats() {
    return this.memory.getStats()
  }

  /** 获取 Token 预算利用率报告 */
  getTokenUtilization(): string {
    return this.tokenBudgeter.getUtilizationReport()
  }

  /** V3: 语义记忆搜索 */
  async searchSemanticMemory(query: string, topK?: number) {
    return this.semanticMemory.search(query, topK)
  }

  /** V3: 记录到语义记忆 */
  async recordToSemanticMemory(entry: Parameters<SemanticMemory['record']>[0]) {
    return this.semanticMemory.record(entry)
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
