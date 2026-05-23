// 驾驭智能体 — 决策追踪器
// 借鉴 Google ADK OpenTelemetry trace/span 设计
// 每次 LLM 调用→工具执行→角色切换→Reflection 生成结构化 trace
// 前端可在"决策追溯"面板按时间线查看完整决策链

export interface DecisionSpan {
  spanId: string
  traceId: string
  parentSpanId?: string
  span: 'llm_call' | 'tool_exec' | 'role_switch' | 'reflection' | 'heartbeat' | 'compression'
  timestamp: string
  durationMs: number
  input: Record<string, unknown>
  output: Record<string, unknown>
  error?: string
}

export interface DecisionTrace {
  traceId: string
  conversationId: string
  startedAt: string
  spans: DecisionSpan[]
}

export class DecisionTracer {
  private traces: DecisionTrace[] = []
  private currentTraceId: string
  private conversationId: string
  private spanStack: Array<{ spanId: string; startTime: number }> = []
  private maxTraces = 100

  constructor(conversationId: string) {
    this.conversationId = conversationId
    this.currentTraceId = this.generateId()
    this.traces.push({
      traceId: this.currentTraceId,
      conversationId,
      startedAt: new Date().toISOString(),
      spans: [],
    })
  }

  /** 开始一个新的 span */
  startSpan(span: DecisionSpan['span'], input: Record<string, unknown> = {}, parentSpanId?: string): string {
    const spanId = this.generateId()
    this.spanStack.push({ spanId, startTime: performance.now() })

    const trace = this.getCurrentTrace()
    if (trace) {
      trace.spans.push({
        spanId,
        traceId: this.currentTraceId,
        parentSpanId,
        span,
        timestamp: new Date().toISOString(),
        durationMs: 0,
        input,
        output: {},
      })
    }

    return spanId
  }

  /** 结束一个 span */
  endSpan(spanId: string, output: Record<string, unknown> = {}, error?: string): void {
    const idx = this.spanStack.findIndex(s => s.spanId === spanId)
    if (idx < 0) return

    const { startTime } = this.spanStack.splice(idx, 1)[0]
    const durationMs = Math.round(performance.now() - startTime)

    const trace = this.getCurrentTrace()
    if (trace) {
      const span = trace.spans.find(s => s.spanId === spanId)
      if (span) {
        span.durationMs = durationMs
        span.output = output
        if (error) span.error = error
      }
    }
  }

  /** 便捷方法：包装一个异步操作 */
  async trace<T>(
    span: DecisionSpan['span'],
    input: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<{ result: T; spanId: string }> {
    const spanId = this.startSpan(span, input)
    try {
      const result = await fn()
      this.endSpan(spanId, { result: String(result).slice(0, 200) })
      return { result, spanId }
    } catch (err) {
      this.endSpan(spanId, {}, String(err))
      throw err
    }
  }

  /** 开始新的 trace（角色切换时） */
  newTrace(reason?: string): string {
    this.currentTraceId = this.generateId()
    this.spanStack = []
    this.traces.push({
      traceId: this.currentTraceId,
      conversationId: this.conversationId,
      startedAt: new Date().toISOString(),
      spans: [],
    })

    if (reason) {
      this.startSpan('role_switch', { reason })
      this.endSpan(this.spanStack[this.spanStack.length - 1]?.spanId || '', { newTraceId: this.currentTraceId })
    }

    // 限制 trace 数量
    while (this.traces.length > this.maxTraces) {
      this.traces.shift()
    }

    return this.currentTraceId
  }

  /** 获取当前 trace */
  getCurrentTrace(): DecisionTrace | undefined {
    return this.traces.find(t => t.traceId === this.currentTraceId)
  }

  /** 按 ID 获取 trace */
  getTraceById(traceId: string): DecisionTrace | undefined {
    return this.traces.find(t => t.traceId === traceId)
  }

  /** 获取所有 traces */
  getAllTraces(): DecisionTrace[] {
    return [...this.traces]
  }

  /** 导出最近 N 条 span 为 JSON（用于前端展示） */
  exportRecentSpans(count: number = 50): DecisionSpan[] {
    const allSpans: DecisionSpan[] = []
    for (const trace of this.traces) {
      allSpans.push(...trace.spans)
    }
    return allSpans
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, count)
  }

  /** 获取决策摘要（用于 LLM 上下文注入） */
  getDecisionSummary(): string {
    const recent = this.exportRecentSpans(10)
    if (recent.length === 0) return ''

    const lines: string[] = ['[最近决策链]']
    for (const span of recent) {
      const action = span.span === 'llm_call' ? 'LLM调用'
        : span.span === 'tool_exec' ? `执行工具 ${span.input.toolName || ''}`
        : span.span === 'reflection' ? '反思'
        : span.span === 'role_switch' ? '角色切换'
        : span.span === 'compression' ? '上下文压缩'
        : span.span
      const result = span.error ? `❌ ${span.error}` : '✅'
      lines.push(`  ${span.timestamp.slice(11, 19)} ${action} → ${result} (${span.durationMs}ms)`)
    }
    return lines.join('\n')
  }

  /** 清空所有 traces */
  clear(): void {
    this.traces = []
    this.spanStack = []
    this.currentTraceId = this.generateId()
    this.traces.push({
      traceId: this.currentTraceId,
      conversationId: this.conversationId,
      startedAt: new Date().toISOString(),
      spans: [],
    })
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  }
}
