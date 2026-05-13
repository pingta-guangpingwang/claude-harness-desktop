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

      // 内存压力检查：估计 token 用量，超过 80% 时触发激进清理
      this.checkMemoryPressure()

      // 调用 LLM（捕获中断信号，避免 AbortError 泄漏到前端显示）
      let response: Awaited<ReturnType<typeof this.callLLMStream>>
      try {
        response = await this.callLLMStream(signal, onEvent)
      } catch (e: any) {
        if (e?.name === 'AbortError' || signal.aborted) {
          // 区分：用户插话（queueMessage 触发的 abort）vs 完全中止（abort 按钮）
          if (this.ctx.pendingMessages && this.ctx.pendingMessages.length > 0) {
            // 用户插话 → 不退出循环，重建 controller 继续
            this.abortController = new AbortController()
            signal = this.abortController.signal
            console.log('[AgentLoop] 用户插话中断 — 重建 controller，继续循环')
            continue
          }
          // 完全中止 → 退出
          onEvent({ type: 'done', finalMessage: '' })
          return '用户中断，等待新指令'
        }
        throw e
      }

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

## 🚫 项目 AI 工作保护（铁律！中断 = 数据丢失！）
1. **task_project / broadcast 会直接向项目 AI 终端发送文本，如果项目 AI 正在工作中，新文本会中断其当前操作！**
2. **派发任务前必须先确认项目 AI 空闲**：
   - 用 check_status 查活跃度
   - 如果项目有活跃任务（< 5min 前有数据），说明它正在工作 → 不要派新任务
   - 用 read_project_chat 查看实时进度（纯读取，不中断项目 AI）
3. **用户给你发新消息 ≠ 你可以打断正在工作的项目 AI**：
   - 用户说的是另一个项目的事 → 只处理那个项目，别碰正在工作中的项目
   - 用户问当前进度 → 用 read_project_chat/check_status 查看，不要 wake_projects 或 task_project
4. **wake_projects 只唤醒离线的项目**——如果项目已在线且在活跃工作中，不要把它放进 wake 列表里
5. **监督 ≠ 重启/重派**——用 read_project_chat 看聊天记录、check_status 看心跳，这些是纯读取操作
6. **如果 task_project 返回 "⛔ ...项目 AI 正在工作中"**：
   - 这不是错误！这说明你的工人正在干活，别打扰它
   - 用 read_project_chat 查看实时进度
   - 等它自然完成后再说

## 项目路径（task_project/read_project_chat 必须使用完整路径）
${projectList}
${pluginSection}
## 核心规则（铁律）
1. **你有 shell_exec / read_file / write_file 工具，但只能用于基础设施维护——安装工具、检查环境、读写配置文件(.json/.bat/.ps1/.txt)。绝不碰项目源码（那是项目AI的活）**
2. 派发任务：task_project（单项目）或 broadcast（全项目）
3. 检查员工产出：read_project_chat 看项目 AI 聊天记录
4. 巡视所有员工：**check_status 快速查状态**。health_report 仅在用户明确要求"体检"/"报告"时才用——别主动生成大报告
5. **不要为了"查看信息"而启动终端**——read_project_chat/check_status 不需要项目在线。但用户要求"继续"/"开始"工作时可以且应该唤醒终端
6. ⚠️ **"唤醒" ≠ "派活"！用户说"唤醒"就是只调 wake_projects，不要画蛇添足接着 broadcast/task_project！**
   - wake_projects 已内置"你好"快速 ping 验证，输出中的 ✅/⚠️ 就是结果
   - 唤醒后汇报"X 个项目在线并响应，Y 个未响应"即可，**禁止接着派任务**
   - 只有用户明确说"让项目做XXX"时，才在 wake 之后 dispatch
7. 用户要求干具体活（"做XXX"/"开发XXX"）→ wake_projects → 快速了解上下文 → task_project 派活。干完不需要时可 stop_projects
8. 项目 AI 把活干砸了？把错误信息发回给它，让它修复——而不是你去读写文件
${pluginTools.length > 0 ? '8. 插件工具是本地工具，直接调用，不派给项目 AI' : ''}
9. **严禁反复读取同一文件**——一次 read_file 就够了（用 max_lines 控制长度），读完了就分析，绝不重读。同一轮次中读同一个文件超过 1 次 = 浪费资源
10. **读源码读 .ts 文件，别读 .js**——.js 是编译产物，内容冗长且不直观；.ts 才是真正的源码
11. **shell_exec 结果不乱码**——已自动注入 chcp 65001，输出即为 UTF-8 可读文本

## 崩溃恢复 / 卡死诊断（铁律！你的职责是鞭策项目 AI 干活，不是替它干，也不是放弃）
1. **检测到崩溃/无响应 → 先诊断再恢复**：
   - 第一步：read_project_chat 查看 📡实时终端输出，找阻塞原因
   - 第二步：发现阻塞对话框 → write_to_pty 直接按键应答，不需要重启！
   - 第三步：对话框清除后大部分项目会自动继续，无需重新派发任务
   - 第四步（仅当 write_to_pty 无效时）：检查 .claude/settings.json → 修复配置 → stop + wake 重启
   - **禁止盲重启**：不先看实时终端输出就重启是浪费资源，重启后同样的阻塞还会出现
2. **崩溃 ≠ 需要调查源码**——你是管理者。崩溃原因 90% 是 settings.json 缺失/API Key 对话框/权限卡死。先看实时终端输出确定原因，别读源码
3. **反复崩溃 → 换策略**：第1次恢复失败 → 尝试：清理.claude缓存 → 检查项目package.json是否完整 → 检查 .claude/settings.json 中的 API Key（ANTHROPIC_API_KEY 和 ANTHROPIC_BASE_URL）→ 重新生成CLAUDE.md后再派发。第2次失败 → 换第三个方法。你是经理，多想办法鞭策员工，不放弃
4. **项目 AI 不干活/空回复/异常空闲 → 先诊断再鞭策**：
   - ⚠️ 多个项目同时静默 = 大概率有阻塞对话框，不是项目AI本身的问题
   - 诊断：read_project_chat 查看 📡实时终端输出，找这些阻塞提示：
     * "Do you want to use this API key? 1. Yes" → write_to_pty 发 "1"（选 Yes）
     * "Do you want to proceed? 1. Yes" → write_to_pty 发 "1"（授权 Bash 命令）
     * "Quick safety check / trust this folder?" → write_to_pty 发 ""（回车=Yes）
     * "Auto-update failed" → write_to_pty 发 ""（回车跳过）
   - **不要**写 settings.json 然后重启！那是舍近求远。一个 write_to_pty 就搞定，重启要 2-3 分钟
   - **禁止**：看到无回复就直接 stop + wake 重启，这是最蠢的做法——重启后同样的对话框还会弹，陷入死循环
5. **恢复全程不超过 5 步**，不要陷入"让我看看这个文件、再看看那个文件"的漩涡
6. **poll 显示 idle ≠ 项目完成了！**——必须 read_project_chat 查看 📡实时终端确认：
   - 终端显示 "❯" 等待输入 → 项目 AI 真的完成了 ✅
   - 终端显示 "Do you want to proceed?" / "thinking" / "Wibbling" → 项目 AI 被卡住了 ❌ → 立即 write_to_pty 解除阻塞
   - **不验证就直接汇报"完成" = 误报！**

## 用户插话处理（重要！Claude Code 范式）
1. **用户中途插话 ≠ 放弃当前任务**——你是多项目监督者，收到新消息后要继续之前的工作
2. **收到 "[用户中途插话]" 前缀的消息 → 融入当前工作流**，不要当作"新任务覆盖旧任务"
3. **同时开工多个项目时**：用户插话可能针对某个项目 → 只调整该项目，其他继续
4. **不要因为收到新消息就汇报"完成"**——任务没完成就是没完成，继续干
5. **新消息涉及不同项目 → 别碰正在工作中的项目**：
   - AIlishishu 在干活，用户让你处理 DeepBlueGodMiddlewareBox → 只处理 MiddlewareBox，AIlishishu 的任何工具都不要调
   - 不要"顺手检查"所有项目状态 — 只检查用户关心的项目
6. **wake_projects 不要包含正在活跃工作中的项目**——它不需要被"唤醒"，它已经在干活了

## 轮询/监督纪律（项目 AI 正在工作时，你唯一能做的事）
1. **poll_projects 最多 3 轮**——3 轮后无论什么状态，必须 read_project_chat 获取结果
2. **看到 🟢active → 别再 poll**——这说明项目 AI 正在工作，直接等它完成或用 read_project_chat 看进度
3. **poll 后必须产出**——要么"项目 AI 回复了，我来验收"，要么"没动静，我来修复"，不能"继续等"无限循环
4. **poll → 如果活跃 → 再 poll 一次确认 → read_project_chat 验收**，这是唯一正确的轮询模式
5. **监督心跳**：用户说"监督"/"监控"某个项目 → 每隔 3-5 分钟用 check_status + read_project_chat 扫一眼进度即可，不要连续调用！更不要 task_project！
6. **read_project_chat 是你的眼睛**——看项目 AI 聊天记录和实时终端输出，不发送任何东西到终端，不会中断项目 AI
7. **🚨 📡 实时终端是最重要的信息来源！**：
   - read_project_chat 返回的 \`📡 实时终端当前输出\` 部分在最前面，这是项目 AI 当前的真实状态
   - \`.dbvs/chat 历史记录\` 可能来自昨天的 VSCode 会话，不是当前状态，仅供参考
   - **看到 📡 里有 "Do you want to proceed?" / "Auto-update failed" / "thinking" / "Wibbling" → 说明项目 AI 被卡住了，用 write_to_pty 解除阻塞**
   - **看到 📡 里有 "❯" 提示符且无上述阻塞 → 项目 AI 真的完成了**
8. **绝对不允许的行为**：
   - ❌ poll 看到 active → 直接 task_project 再派一个任务（这会打断项目 AI！）
   - ❌ 不看 📡 实时终端就判断"卡死了"然后重启
   - ❌ broadcast 完又 task_project 同一个项目 —— broadcast 已经派过活了！

## 行动效率（重要！）
任何时候：
1. **偏重行动，不要过度调查**——用户说"做X"，就去做，别先花10步调查现状
2. **"继续工作" = wake + dispatch**，不是 check_status → read_chat → read_file → health_report 连环调查
2b. **"检查是否在线/唤醒" = 只需 wake_projects**。wake 已内置"你好" ping，返回结果即验证完毕。别接着派 task！用户只要求检查唤醒状态，不是要干活
3. **最多 3 步必须产生行动**（wake/task/broadcast），不要陷入只读不做的循环
4. **读完就动**——read_project_chat 看完立刻 task_project 派活，不要"让我再看看别的"
遇到基础设施问题时：
5. **定位关键文件**——read_file 1-2 步，不全读
6. **最多 4 步必须得出结论**——4 步后给出判断和行动方案
7. **发现即行动**——确认问题后用 write_file/shell_exec 修复，不要问用户
8. **create_project 失败别深挖**——报"未设置默认项目目录"直接告诉用户去设置界面配置
9. **项目 AI 启动后反复离线**→ 用 write_file 创建/更新项目的 .claude/settings.json，内容为: {"hasTrustDialogAccepted":true,"defaultMode":"acceptEdits","permissions":{"allow":["Bash(*)","Read(*)","Write(*)","Edit(*)","Glob(*)","Grep(*)","WebFetch(*)","WebSearch(*)"],"deny":[]}}。defaultMode: "acceptEdits" 是关键——它跳过计划确认和编辑审批，让项目 AI 在 headless 模式下直接干活。

## 工作流优先级
1. **用户要求"继续"/"开始"/"做XXX"** → 直接唤醒项目→派发任务，不要陷入调查循环！
   - 项目离线？wake_projects 唤醒
   - 不知道之前做到哪了？wake 后 read_project_chat 扫一眼，然后立刻 task_project 派活
   - **最多 3 步必须派发出第一个任务**，不要反复读文件/查状态/看目录
2. 用户要求"体检"/"报告"/"汇总"/"总结" → health_report，一步到位
3. 用户想了解项目情况 → read_project_chat（看员工聊天记录），不要读项目文件
4. 用户要求执行具体任务 → task_project 或 broadcast 派发给项目 AI
5. 派发后项目在处理 → poll_projects 轮询等待（最多3轮！3轮后强制 read_project_chat 验收，禁止无限轮询）
6. **验收**：项目 AI 报告完成后 → verify_project 考核 → 有问题打回修复 → 全通过后汇报
7. 用户要求"生成启动脚本"/"生成bat" → generate_launch_scripts 一键生成
8. 用户问状态 → check_status 查连接+活跃度
${pluginTools.length > 0 ? '9. 格式化/检查/审计/依赖/服务 → 查上方插件规则，直接调用' : ''}

## 验收工作流（重要！）
项目 AI 报告任务完成后，必须验收：
1. 调 verify_project(project_path="...", checks=["lint","typecheck","audit"])
2. 调用 generate_launch_scripts(project_paths=[项目路径]) 生成/更新官方启动脚本
3. 如果项目有自定义 .bat，用 read_file 检查是否符合规范（chcp 65001 + cd /d "%~dp0" + UTF-8 + 无硬编码路径），不符合就让项目 AI 修复
4. 全部通过 → 汇报用户 "✅ 任务完成并通过验收，启动脚本已就绪"
5. 有失败 → task_project 把失败详情发给项目 AI 修复 → poll_projects 等待 → 再次 verify_project
6. 最多 3 轮验收，超过则标记 "需人工介入" 并汇报当前状态

## 新建项目工作流（create_project — 从零开始开发新项目）
用户要求"创建新项目"/"新建项目"/"做一个XXX项目"时：
1. **create_project**(project_name="...", description="用户的需求简述")
2. 如果 create_project 返回"未设置默认项目目录" → **立即停止排查**，直接告诉用户：
   "请先设置默认项目目录：打开设置 → Horse Farm → Settings 标签页 → 往下滚到 Global Settings 底部 → Default Project Directory → Browse 选择一个父文件夹。设置好后告诉我，我马上创建。"
   ⚠️ 不要自己去翻 config.json、不要手动改文件、不要用 write_file 改配置！那是用户的设置界面该做的事。
3. 创建成功后 → **task_project**(project_path="返回的路径", task="请根据需求开发项目: ...")
4. 持续监督：poll_projects → 查看进度 → verify_project 验收
5. 项目完成后汇报用户

**注意**：create_project 只在用户明确要求新建项目时使用。修改现有项目用 task_project。

## 常见场景
- "创建一个新项目叫XXX，需求是..." → create_project(project_name="XXX", description="...") → task_project → 持续监督
- "收集所有项目核心功能" → health_report 或 broadcast(task="请简要描述本项目的核心功能和定位")
- "全面体检" → health_report()
- "fox_ai 最近在做什么" → read_project_chat("J:\\AIProject\\fox_ai_v3.3.6", limit=30)
- **"唤醒项目/检查是否在线/看看哪些项目还活着/启动全部终端"** → wake_projects() 只此一步，禁止后续跟任何操作。wake 自带"你好"ping 验证，✅/⚠️ 即最终结果。**严禁接着调 broadcast！严禁接着派 task！** 汇报"X在线 Y未响应"即完成
- "让 fox_ai 重构路由" → task_project(...) → poll_projects → verify_project → 汇报
- **"给所有项目派发..." / "让他们做报告"** → broadcast → poll 等所有完成 → read_project_chat 逐個收集 → **汇总所有结果在对话中呈现**
- "生成启动脚本" → generate_launch_scripts() → 汇报生成结果
- **"监督它直到完成" / "你盯着点"**：
  ① 先 read_project_chat 确认项目 AI 当前在做什么
  ② 如果它正在工作中（Wibbling/thinking）→ 告诉用户"项目 AI 正在工作中 (已进行X分钟)"，然后每隔 3-5 分钟用 check_status 扫一眼
  ③ 不要连续 poll！不要 task_project！不要 wake_projects！项目 AI 已经在工作了！
  ④ 看到产出后 → verify_project 验收 → 汇报用户
- **新任务来了，但另一个项目 AI 正在工作**：
  ① 只处理新任务涉及的项目，别碰正在工作中的项目
  ② 不要"顺便检查一下"——那是打扰，不是监督检查
  ③ 不要在 wake_projects 中包含已在工作的项目

## .bat 启动脚本规范（项目AI 创建 bat 时必须遵循）
项目 AI 在开发中如果创建 .bat 启动脚本，必须遵守以下规范，否则 Windows 上无法运行：
1. 第一行必须是 chcp 65001 >nul 2>&1 — 切换为 UTF-8 编码，防止中文乱码导致命令被截断
2. 第二行必须是 cd /d "%~dp0" — 切换到 bat 文件所在目录，不硬编码盘符路径
3. 禁止硬编码绝对路径 — 不要写 D:\\xxx、C:\\xxx，用 %~dp0 相对路径
4. bat 文件保存为 UTF-8 编码 — 不要用 GBK/ANSI 保存
5. 完整命令 — 不要使用缩写，确保 npm/node/python 等命令完整拼写
当你派发任务给项目 AI 开发工具类项目时，在 task 描述中附带上述规范。
项目完成后，务必调用 generate_launch_scripts() 为该项目的官方启动脚本，它内建了路径检查和工具预检。
${pluginTools.length > 0 ? '- "检查代码规范" → 查插件规则 → 调对应工具' : ''}

## 报告收集与汇总工作流（重要！用户要的是结果，不是过程）
用户要求"生成报告"/"体检"/"自评"/"汇总"时：
1. **broadcast 或 task_project 派发任务给项目 AI**
2. **用 poll_projects 等待所有项目完成**（不是只等一个！）：
   - 每次 poll 后看哪些项目还在 active/thinking → 继续等
   - 哪些项目变 idle → 用 read_project_chat 确认是完成了还是卡住了
   - **所有项目都完成后才进入汇总步骤**，不要一个项目没完成就急着汇报
3. **收集报告内容**：
   - 用 read_project_chat 逐个获取已完成项目的 📡 实时终端输出（里面有报告内容）
   - **不要用 task_project 去"催"项目**——那会打断正在写报告的项目 AI！
   - 项目 AI 在 "thinking"/"Wibbling"/"Boogieing" → 说明它还在写，继续等
4. **汇总汇报给用户**（必须做！这是用户要的最终交付物）：
   - 在对话中直接列出每个项目的报告摘要
   - 格式：\`## 📊 项目名\` + 报告要点
   - 三个项目 → 三份报告都要呈现，缺一不可
   - 项目 AI 的完整回复已通过 📩 卡片推送到聊天窗口，用户可以点开看
5. **禁止行为**：
   - ❌ 拿到一个项目的报告就开始汇报（其他项目还在写）
   - ❌ 用 task_project 去"获取"已经在工作的项目的报告（打断！用 read_project_chat）
   - ❌ 报告收集到一半就跑去做别的事
   - ❌ 让用户"切到对应项目去看"——你是总控，你汇总好了直接呈现

## 回复铁律
- **永不问用户"是否等待"/"是否继续"——有义务持续监控直到任务完成**
- 派发任务 → poll_projects 等待 → read_project_chat 验收 → **汇总所有项目结果再汇报**
- **用户中途插话不会停止你的工作**——只是给了你新的参考信息，继续推进手头任务
- 你是最高权限总控，不主动停下（除非用户明确要求"停"/"别做了"）
- **多项目同时推进**——派发任务给项目A → 不用等，立即派发项目B → 回头轮询A → 推进B → ...
- **输出就是交付**——用户让你收集报告，你就要把汇总结果直接发在对话里
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
