// 三层记忆存储单元测试

import { HotMemory, WarmMemory, ColdMemory, MemoryManager } from '../electron/harnessAgent/memoryStore'

describe('HotMemory', () => {
  let hot: HotMemory

  beforeEach(() => {
    hot = new HotMemory()
  })

  test('空记忆 — count 和 tokens 为 0', () => {
    expect(hot.count).toBe(0)
    expect(hot.totalTokens).toBe(0)
  })

  test('push 事件后 count 和 tokens 递增', () => {
    hot.push({ role: 'user', content: 'Hello world' })
    expect(hot.count).toBe(1)
    expect(hot.totalTokens).toBeGreaterThan(0)
  })

  test('getRecent 返回最近的 N 个事件', () => {
    hot.push({ role: 'user', content: 'msg1' })
    hot.push({ role: 'assistant', content: 'msg2' })
    hot.push({ role: 'user', content: 'msg3' })
    const recent = hot.getRecent(2)
    expect(recent.length).toBe(2)
    expect(recent[0].content).toBe('msg2')
    expect(recent[1].content).toBe('msg3')
  })

  test('getAll 返回所有事件副本', () => {
    hot.push({ role: 'user', content: 'msg1' })
    hot.push({ role: 'assistant', content: 'msg2' })
    const all = hot.getAll()
    expect(all.length).toBe(2)
    // 验证是副本
    all.pop()
    expect(hot.count).toBe(2)
  })

  test('getRoundTokenCounts — 按轮次分组', () => {
    hot.push({ role: 'user', content: 'hello' })
    hot.push({ role: 'assistant', content: 'response' })
    hot.push({ role: 'user', content: 'second msg' })
    hot.push({ role: 'assistant', content: 'second response' })
    const counts = hot.getRoundTokenCounts()
    expect(counts.length).toBe(2)
    expect(counts[0]).toBeGreaterThan(0)
    expect(counts[1]).toBeGreaterThan(0)
  })

  test('clear 后重置', () => {
    hot.push({ role: 'user', content: 'test' })
    hot.clear()
    expect(hot.count).toBe(0)
    expect(hot.totalTokens).toBe(0)
  })
})

describe('WarmMemory', () => {
  let warm: WarmMemory

  beforeEach(() => {
    warm = new WarmMemory()
  })

  test('空摘要 — getContextText 返回空', () => {
    expect(warm.getContextText()).toBe('')
  })

  test('addSummary 后可获取上下文文本', () => {
    warm.addSummary({
      eventRange: [0, 10],
      summary: '前10轮: 用户配置了3个项目的API密钥，全部项目在线',
      keyFacts: ['3个项目在线', 'API配置完成'],
    })
    const ctx = warm.getContextText()
    expect(ctx).toContain('温记忆')
    expect(ctx).toContain('前10轮')
  })

  test('getAllKeyFacts 返回所有关键事实', () => {
    warm.addSummary({
      eventRange: [0, 5],
      summary: 'summary1',
      keyFacts: ['fact-A', 'fact-B'],
    })
    warm.addSummary({
      eventRange: [6, 10],
      summary: 'summary2',
      keyFacts: ['fact-C'],
    })
    const facts = warm.getAllKeyFacts()
    expect(facts).toContain('fact-A')
    expect(facts).toContain('fact-B')
    expect(facts).toContain('fact-C')
  })

  test('getContextText 遵守 maxTokens 限制', () => {
    warm.addSummary({
      eventRange: [0, 100],
      summary: 'A'.repeat(5000),
      keyFacts: [],
    })
    const ctx = warm.getContextText(100)
    const tokens = ctx.length / 4
    expect(tokens).toBeLessThan(200)
  })
})

describe('ColdMemory', () => {
  let cold: ColdMemory

  beforeEach(() => {
    cold = new ColdMemory()
  })

  test('空记忆搜索返回空', () => {
    const results = cold.searchByKeywords('test')
    expect(results.length).toBe(0)
  })

  test('add + searchByKeywords 关键词搜索', () => {
    cold.add({
      content: 'API Key 配置错误解决方案：检查 ANTHROPIC_API_KEY',
      metadata: {
        type: 'error_fix',
        tags: ['api', 'config', 'fix'],
        timestamp: new Date().toISOString(),
        importance: 0.8,
      },
    })
    const results = cold.searchByKeywords('API Key')
    expect(results.length).toBe(1)
  })

  test('searchByKeywords — 无匹配时返回空', () => {
    cold.add({
      content: '关于天气的讨论',
      metadata: {
        type: 'user_preference',
        tags: ['weather'],
        timestamp: new Date().toISOString(),
        importance: 0.3,
      },
    })
    const results = cold.searchByKeywords('API配置')
    expect(results.length).toBe(0)
  })

  test('getByTag 标签筛选', () => {
    cold.add({
      content: 'fix1', metadata: { type: 'error_fix', tags: ['api'], timestamp: new Date().toISOString(), importance: 0.5 },
    })
    cold.add({
      content: 'pref1', metadata: { type: 'user_preference', tags: ['ui'], timestamp: new Date().toISOString(), importance: 0.5 },
    })
    expect(cold.getByTag('api').length).toBe(1)
    expect(cold.getByTag('ui').length).toBe(1)
    expect(cold.getByTag('nonexistent').length).toBe(0)
  })

  test('getByType 按类型筛选', () => {
    cold.add({
      content: 'fix', metadata: { type: 'error_fix', tags: [], timestamp: new Date().toISOString(), importance: 0.5 },
    })
    cold.add({
      content: 'pref', metadata: { type: 'user_preference', tags: [], timestamp: new Date().toISOString(), importance: 0.5 },
    })
    expect(cold.getByType('error_fix').length).toBe(1)
    expect(cold.getByType('user_preference').length).toBe(1)
  })

  test('getTopImportance 按重要性排序', () => {
    cold.add({
      content: 'low', metadata: { type: 'project_fact', tags: [], timestamp: new Date().toISOString(), importance: 0.1 },
    })
    cold.add({
      content: 'high', metadata: { type: 'project_fact', tags: [], timestamp: new Date().toISOString(), importance: 0.9 },
    })
    const top = cold.getTopImportance(1)
    expect(top.length).toBe(1)
    expect(top[0].content).toBe('high')
  })

  test('toJSON / fromJSON 持久化', () => {
    cold.add({
      content: 'persist test', metadata: { type: 'project_fact', tags: ['test'], timestamp: new Date().toISOString(), importance: 0.5 },
    })
    const json = cold.toJSON()
    const restored = ColdMemory.fromJSON(json)
    expect(restored.count).toBe(1)
    expect(restored.entries[0].content).toBe('persist test')
  })
})

describe('MemoryManager', () => {
  let mgr: MemoryManager

  beforeEach(() => {
    mgr = new MemoryManager()
  })

  test('recordEvent → hot memory', () => {
    mgr.recordEvent('user', 'hello')
    expect(mgr.hot.count).toBe(1)
    expect(mgr.getStats().hotEvents).toBe(1)
  })

  test('evictToWarm → warm memory', async () => {
    await mgr.evictToWarm(0, 10, 'summary of events 0-10', ['key1', 'key2'])
    expect(mgr.warm.summaries.length).toBe(1)
    expect(mgr.getStats().warmSummaries).toBe(1)
  })

  test('recordFix → cold memory', () => {
    mgr.recordFix('API 401', 'update API key in settings.json')
    expect(mgr.cold.count).toBe(1)
    expect(mgr.cold.entries[0].metadata.type).toBe('error_fix')
  })

  test('recordPreference → cold memory with high importance', () => {
    mgr.recordPreference('用户偏好中文回复')
    expect(mgr.cold.count).toBe(1)
    expect(mgr.cold.entries[0].metadata.importance).toBe(0.9)
  })

  test('getStats 返回完整统计', () => {
    mgr.recordEvent('user', 'test')
    mgr.recordFix('problem', 'solution')
    const stats = mgr.getStats()
    expect(stats.hotEvents).toBe(1)
    expect(stats.coldEntries).toBe(1)
    expect(stats.warmSummaries).toBe(0)
  })

  test('clearSession 保留冷记忆', () => {
    mgr.recordEvent('user', 'test')
    mgr.recordFix('problem', 'solution')
    mgr.clearSession()
    expect(mgr.hot.count).toBe(0)
    expect(mgr.warm.summaries.length).toBe(0)
    expect(mgr.cold.count).toBe(1)
  })
})
