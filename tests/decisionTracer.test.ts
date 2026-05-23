// DecisionTracer + HITLManager 单元测试

import { DecisionTracer } from '../electron/harnessAgent/decisionTracer'
import { HITLManager } from '../electron/harnessAgent/hitlManager'

describe('DecisionTracer', () => {
  let tracer: DecisionTracer

  beforeEach(() => {
    tracer = new DecisionTracer('test-conversation')
  })

  test('初始化创建第一个 trace', () => {
    const trace = tracer.getCurrentTrace()
    expect(trace).toBeDefined()
    expect(trace!.conversationId).toBe('test-conversation')
    expect(trace!.spans.length).toBe(0)
  })

  test('startSpan + endSpan 创建完整 span', () => {
    const spanId = tracer.startSpan('llm_call', { model: 'deepseek-v4-pro' })
    expect(spanId).toBeTruthy()

    tracer.endSpan(spanId, { toolCalls: ['check_status'], tokens: 5000 })
    const trace = tracer.getCurrentTrace()
    expect(trace!.spans.length).toBe(1)
    expect(trace!.spans[0].span).toBe('llm_call')
    expect(trace!.spans[0].durationMs).toBeGreaterThanOrEqual(0)
  })

  test('trace() 包装异步操作', async () => {
    const { result, spanId } = await tracer.trace('tool_exec', { toolName: 'test' }, async () => {
      return 'success result'
    })
    expect(result).toBe('success result')
    expect(spanId).toBeTruthy()

    const trace = tracer.getCurrentTrace()
    expect(trace!.spans.length).toBe(1)
    expect(trace!.spans[0].span).toBe('tool_exec')
  })

  test('trace() 捕获异常仍 throw', async () => {
    await expect(
      tracer.trace('tool_exec', { toolName: 'bad_tool' }, async () => {
        throw new Error('test error')
      })
    ).rejects.toThrow('test error')

    const trace = tracer.getCurrentTrace()
    expect(trace!.spans[0].error).toBe('Error: test error')
  })

  test('newTrace 创建新 trace', () => {
    tracer.startSpan('llm_call', {})
    const newId = tracer.newTrace('角色切换到 reviewer')
    const trace = tracer.getCurrentTrace()
    expect(trace!.traceId).toBe(newId)
  })

  test('exportRecentSpans 按时间倒序', () => {
    tracer.startSpan('tool_exec', { toolName: 'A' })
    tracer.endSpan(tracer.getCurrentTrace()!.spans[0].spanId, {})
    tracer.startSpan('tool_exec', { toolName: 'B' })
    tracer.endSpan(tracer.getCurrentTrace()!.spans[1].spanId, {})

    const exported = tracer.exportRecentSpans(5)
    expect(exported.length).toBe(2)
  })

  test('getDecisionSummary 返回可读摘要', () => {
    const spanId = tracer.startSpan('llm_call', {})
    tracer.endSpan(spanId, { toolCalls: ['check_status'] })
    const summary = tracer.getDecisionSummary()
    expect(summary).toContain('LLM调用')
  })

  test('getTraceById 查找 trace', () => {
    const trace = tracer.getCurrentTrace()
    const found = tracer.getTraceById(trace!.traceId)
    expect(found).toBeDefined()
    expect(found!.traceId).toBe(trace!.traceId)
  })

  test('maxTraces 限制数量', () => {
    for (let i = 0; i < 110; i++) {
      tracer.newTrace(`reason ${i}`)
    }
    expect(tracer.getAllTraces().length).toBeLessThanOrEqual(100)
  })
})

describe('HITLManager', () => {
  let hitl: HITLManager

  beforeEach(() => {
    hitl = new HITLManager(5000) // 短超时方便测试
  })

  test('默认启用', () => {
    expect(hitl.isEnabled).toBe(true)
  })

  test('低置信度 → 暂停', () => {
    const decision = hitl.shouldPauseForConfirmation(
      { id: '1', name: 'read_project_chat', arguments: {} },
      { observation: '不确定', diagnosis: 'unknown', confidence: 'low', next_action: '?', strategy_adjustment: null },
    )
    expect(decision.pause).toBe(true)
    expect(decision.severity).toBe('high')
  })

  test('危险工具 → 暂停', () => {
    const decision = hitl.shouldPauseForConfirmation(
      { id: '2', name: 'shell_exec', arguments: { command: 'rm -rf /' } },
      null,
    )
    expect(decision.pause).toBe(true)
    expect(decision.severity).toBe('medium')
  })

  test('普通读取工具无低置信度 → 不暂停', () => {
    const decision = hitl.shouldPauseForConfirmation(
      { id: '3', name: 'read_project_chat', arguments: {} },
      { observation: 'all good', diagnosis: 'normal', confidence: 'high', next_action: 'continue', strategy_adjustment: null },
    )
    expect(decision.pause).toBe(false)
  })

  test('连续失败 3 次 → 暂停', () => {
    hitl.recordResult('wake_projects', false)
    hitl.recordResult('wake_projects', false)
    hitl.recordResult('wake_projects', false)

    const decision = hitl.shouldPauseForConfirmation(
      { id: '4', name: 'wake_projects', arguments: {} },
      null,
    )
    expect(decision.pause).toBe(true)
    expect(decision.reason).toContain('3')
  })

  test('成功后重置失败计数', () => {
    hitl.recordResult('wake_projects', false)
    hitl.recordResult('wake_projects', false)
    hitl.recordResult('wake_projects', true)

    const decision = hitl.shouldPauseForConfirmation(
      { id: '5', name: 'wake_projects', arguments: {} },
      null,
    )
    expect(decision.pause).toBe(false)
  })

  test('显式确认标记 → 暂停', () => {
    const decision = hitl.shouldPauseForConfirmation(
      { id: '6', name: 'task_project', arguments: { task: '[CONFIRM_NEEDED] delete all files' } },
      null,
    )
    expect(decision.pause).toBe(true)
  })

  test('setEnabled(false) 后不暂停', () => {
    hitl.setEnabled(false)
    const decision = hitl.shouldPauseForConfirmation(
      { id: '7', name: 'shell_exec', arguments: {} },
      { observation: 'unsure', diagnosis: 'unknown', confidence: 'low', next_action: '?', strategy_adjustment: null },
    )
    expect(decision.pause).toBe(false)
  })

  test('getFailureStats 返回当前统计', () => {
    hitl.recordResult('tool_a', false)
    hitl.recordResult('tool_a', false)
    hitl.recordResult('tool_b', false)
    const stats = hitl.getFailureStats()
    expect(stats.get('tool_a')).toBe(2)
    expect(stats.get('tool_b')).toBe(1)
  })

  test('resetFailures 清空', () => {
    hitl.recordResult('tool_a', false)
    hitl.resetFailures()
    const stats = hitl.getFailureStats()
    expect(stats.size).toBe(0)
  })

  test('requestConfirmation 超时返回 timeout', async () => {
    const fastHitl = new HITLManager(1000) // 1 秒超时
    const result = await fastHitl.requestConfirmation(
      { id: '8', name: 'test', arguments: {} },
      'test reason',
    )
    expect(result).toBe('timeout')
  }, 10000) // 测试超时 10 秒

  test('respond 可响应确认', async () => {
    const promise = hitl.requestConfirmation(
      { id: '9', name: 'test', arguments: {} },
      'test reason',
    )
    hitl.respond('approved')
    const result = await promise
    expect(result).toBe('approved')
  })
})
