// TokenBudgeter 单元测试
// 测试 Token 估算、预算计算、利用率报告

import { TokenBudgeter, estimateTokens, getProviderCapabilities } from '../electron/harnessAgent/tokenBudget'

describe('estimateTokens', () => {
  test('空字符串返回 0', () => {
    expect(estimateTokens('')).toBe(0)
  })

  test('纯英文文本估算 (~4 chars/token)', () => {
    const text = 'Hello world this is a test message for token estimation'
    const tokens = estimateTokens(text)
    // ~55 chars / 4 = ~14 tokens
    expect(tokens).toBeGreaterThan(5)
    expect(tokens).toBeLessThan(30)
  })

  test('纯中文文本估算 (~1.5 chars/token)', () => {
    const text = '这是一段中文测试文本用于验证token估算功能'
    const tokens = estimateTokens(text)
    // ~21 chars / 1.5 = ~14 tokens
    expect(tokens).toBeGreaterThan(5)
    expect(tokens).toBeLessThan(25)
  })

  test('中英混合文本', () => {
    const text = 'Hello 你好 World 世界'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(20)
  })

  test('长文本', () => {
    const text = 'A'.repeat(4000) // ~1000 tokens
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(900)
    expect(tokens).toBeLessThan(1100)
  })
})

describe('getProviderCapabilities', () => {
  test('DeepSeek V4 Pro → 1M 窗口', () => {
    const caps = getProviderCapabilities('deepseek-v4-pro')
    expect(caps.maxContextTokens).toBe(1_000_000)
  })

  test('Claude Opus 4.7 → 200K 窗口', () => {
    const caps = getProviderCapabilities('claude-opus-4-7')
    expect(caps.maxContextTokens).toBe(200_000)
  })

  test('未知模型 → 默认 128K', () => {
    const caps = getProviderCapabilities('unknown-model')
    expect(caps.maxContextTokens).toBe(128_000)
  })
})

describe('TokenBudgeter', () => {
  let budgeter: TokenBudgeter

  beforeEach(() => {
    budgeter = new TokenBudgeter('deepseek-v4-pro')
  })

  test('初始状态 — 无用量数据', () => {
    const report = budgeter.getUtilizationReport()
    expect(report).toContain('1000K tokens')
    expect(report).toContain('暂无用量数据')
  })

  test('记录一轮使用后可正确汇报', () => {
    budgeter.recordRoundUsage(50_000, 2_000, 0)
    const report = budgeter.getUtilizationReport()
    expect(report).toContain('50K')
    expect(report).toContain('5.0%') // 50K/1000K = 5%
  })

  test('isApproachingLimit — 低于 80% 阈值', () => {
    budgeter.recordRoundUsage(600_000, 2_000, 0) // 60% of 1M
    expect(budgeter.isApproachingLimit()).toBe(false)
  })

  test('isApproachingLimit — 超过 80% 阈值', () => {
    budgeter.recordRoundUsage(850_000, 2_000, 0) // 85% of 1M
    expect(budgeter.isApproachingLimit()).toBe(true)
  })

  test('computeBudget — 正常分配', () => {
    const alloc = budgeter.computeBudget(
      'system prompt text here', // ~4 tokens
      'project snapshot',         // ~2 tokens
      [1000, 2000, 1500, 3000, 800, 500], // round token counts
    )
    expect(alloc.systemPromptTokens).toBeGreaterThan(0)
    expect(alloc.hotTokens).toBeGreaterThan(0)
    expect(alloc.hotRoundCount).toBeGreaterThan(0)
    expect(alloc.totalUsed).toBeGreaterThan(0)
    expect(alloc.windowTokens).toBe(1_000_000)
    expect(parseFloat(alloc.utilizationPercent)).toBeGreaterThan(0)
  })

  test('computeBudget — utilization < 100%', () => {
    const alloc = budgeter.computeBudget('', '', [])
    expect(parseFloat(alloc.utilizationPercent)).toBeLessThan(100)
  })

  test('getCumulativeStats — 累加多轮', () => {
    budgeter.recordRoundUsage(10_000, 1_000, 0)
    budgeter.recordRoundUsage(20_000, 2_000, 1)
    budgeter.recordRoundUsage(30_000, 3_000, 2)
    const stats = budgeter.getCumulativeStats()
    expect(stats.totalPrompt).toBe(60_000)
    expect(stats.totalCompletion).toBe(6_000)
    expect(stats.roundCount).toBe(3)
  })

  test('reset 后清除所有数据', () => {
    budgeter.recordRoundUsage(10_000, 1_000, 0)
    budgeter.reset()
    expect(budgeter.getLastUsage()).toBeNull()
    expect(budgeter.getCumulativeStats().roundCount).toBe(0)
  })

  test('updateModel 切换模型', () => {
    budgeter.updateModel('claude-opus-4-7')
    const caps = budgeter.getProviderCapabilities()
    expect(caps.maxContextTokens).toBe(200_000)
  })
})
