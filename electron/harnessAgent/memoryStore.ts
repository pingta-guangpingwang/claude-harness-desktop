// 驾驭智能体 — 热/温/冷三层记忆存储
// 借鉴 Google ADK 四层存储 + Kimi 全量上下文策略
// 热记忆 = 全量原文, 温记忆 = LLM 结构化摘要, 冷记忆 = Embedding 语义检索

import { estimateTokens } from './tokenBudget'

// ---- 类型定义 ----

export interface SessionEvent {
  index: number
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolName?: string
  tokenCount: number
  timestamp: string
  metadata?: Record<string, unknown>
}

export interface WarmSummary {
  eventRange: [number, number]
  summary: string
  keyFacts: string[]
  tokenCount: number
  generatedAt: string
}

export interface ColdMemoryEntry {
  id: string
  content: string
  embedding?: number[]
  metadata: {
    type: 'error_fix' | 'user_preference' | 'project_fact' | 'skill_card' | 'decision'
    projectPath?: string
    tags: string[]
    timestamp: string
    importance: number  // 0-1, higher = more likely to be preloaded
  }
}

// ---- 热记忆 ----

export class HotMemory {
  events: SessionEvent[] = []
  private nextIndex = 0
  private _totalTokens = 0

  push(event: Omit<SessionEvent, 'index' | 'timestamp' | 'tokenCount'> & { content: string }): void {
    const tokenCount = estimateTokens(event.content)
    this.events.push({
      ...event,
      index: this.nextIndex++,
      timestamp: new Date().toISOString(),
      tokenCount,
    })
    this._totalTokens += tokenCount
  }

  /** 获取最后 N 个事件 */
  getRecent(count: number): SessionEvent[] {
    return this.events.slice(-count)
  }

  /** 获取完整事件流 */
  getAll(): SessionEvent[] {
    return [...this.events]
  }

  /** 按轮次分组的事件 — 用于 token 预算计算 */
  getRoundTokenCounts(): number[] {
    const rounds: number[] = []
    let currentRoundTokens = 0
    for (const event of this.events) {
      if (event.role === 'user' && currentRoundTokens > 0) {
        rounds.push(currentRoundTokens)
        currentRoundTokens = 0
      }
      currentRoundTokens += event.tokenCount
    }
    if (currentRoundTokens > 0) rounds.push(currentRoundTokens)
    return rounds
  }

  /** 获取总 token 数 */
  get totalTokens(): number {
    return this._totalTokens
  }

  /** 获取事件数量 */
  get count(): number {
    return this.events.length
  }

  /** 将指定范围的事件导出为消息格式（用于 LLM 调用） */
  exportMessages(
    startIndex: number,
    endIndex: number,
  ): Array<{ role: string; content: string }> {
    return this.events
      .slice(startIndex, endIndex)
      .filter(e => e.role !== 'system')
      .map(e => ({ role: e.role, content: e.content }))
  }

  /** 清空热记忆（仅在会话重置时使用） */
  clear(): void {
    this.events = []
    this.nextIndex = 0
    this._totalTokens = 0
  }
}

// ---- 温记忆 ----

export class WarmMemory {
  summaries: WarmSummary[] = []

  /** 添加一个摘要 */
  addSummary(summary: Omit<WarmSummary, 'tokenCount' | 'generatedAt'>): void {
    this.summaries.push({
      ...summary,
      tokenCount: estimateTokens(summary.summary),
      generatedAt: new Date().toISOString(),
    })
  }

  /** 获取所有摘要拼接后的文本（用于注入 LLM 上下文） */
  getContextText(maxTokens?: number): string {
    if (this.summaries.length === 0) return ''

    const sorted = [...this.summaries].sort((a, b) => a.eventRange[0] - b.eventRange[0])
    const parts: string[] = ['[温记忆 — 历史会话摘要]']

    let usedTokens = 0
    for (const s of sorted) {
      const text = `[轮次 ${s.eventRange[0]}-${s.eventRange[1]}]: ${s.summary}`
      const t = estimateTokens(text)
      if (maxTokens && usedTokens + t > maxTokens) break
      parts.push(text)
      usedTokens += t
    }

    return parts.join('\n')
  }

  /** 获取所有关键事实 */
  getAllKeyFacts(): string[] {
    return this.summaries.flatMap(s => s.keyFacts)
  }

  /** 清空 */
  clear(): void {
    this.summaries = []
  }

  get totalTokens(): number {
    return this.summaries.reduce((sum, s) => sum + s.tokenCount, 0)
  }
}

// ---- 冷记忆 ----

export class ColdMemory {
  entries: ColdMemoryEntry[] = []

  /** 添加条目 */
  add(entry: Omit<ColdMemoryEntry, 'id'>): void {
    this.entries.push({
      ...entry,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    })
  }

  /** 关键词搜索（TF-IDF 简化版 — embedding 不可用时的降级方案） */
  searchByKeywords(query: string, topK: number = 5): ColdMemoryEntry[] {
    const q = query.toLowerCase()
    const scored = this.entries.map(entry => {
      let score = 0
      const content = entry.content.toLowerCase()
      // 精确匹配加分
      if (content.includes(q)) score += 10
      // 标签匹配
      for (const tag of entry.metadata.tags) {
        if (q.includes(tag.toLowerCase())) score += 5
      }
      // 单词级匹配
      const qWords = q.split(/\s+/)
      for (const word of qWords) {
        if (word.length > 1 && content.includes(word)) score += 2
      }
      return { entry, score }
    })

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => s.entry)
  }

  /** 按标签筛选 */
  getByTag(tag: string): ColdMemoryEntry[] {
    return this.entries.filter(e => e.metadata.tags.includes(tag))
  }

  /** 按类型筛选 */
  getByType(type: ColdMemoryEntry['metadata']['type']): ColdMemoryEntry[] {
    return this.entries.filter(e => e.metadata.type === type)
  }

  /** 获取最重要的条目（用于主动预加载） */
  getTopImportance(topK: number = 10): ColdMemoryEntry[] {
    return [...this.entries]
      .sort((a, b) => b.metadata.importance - a.metadata.importance)
      .slice(0, topK)
  }

  /** 移除过期条目（超过 N 天且 importance < 阈值） */
  pruneOldEntries(maxAgeDays: number = 30, importanceThreshold: number = 0.3): number {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - maxAgeDays)
    const cutoffStr = cutoff.toISOString()

    const before = this.entries.length
    this.entries = this.entries.filter(e =>
      e.metadata.timestamp > cutoffStr || e.metadata.importance >= importanceThreshold
    )
    return before - this.entries.length
  }

  /** 导出为可持久化的 JSON */
  toJSON(): string {
    return JSON.stringify(this.entries, null, 2)
  }

  /** 从 JSON 恢复 */
  static fromJSON(json: string): ColdMemory {
    const memory = new ColdMemory()
    try {
      const entries = JSON.parse(json)
      if (Array.isArray(entries)) {
        memory.entries = entries
      }
    } catch { /* 忽略解析错误 */ }
    return memory
  }

  get count(): number {
    return this.entries.length
  }
}

// ---- 三层记忆统一管理器 ----

export class MemoryManager {
  hot: HotMemory
  warm: WarmMemory
  cold: ColdMemory

  constructor() {
    this.hot = new HotMemory()
    this.warm = new WarmMemory()
    this.cold = new ColdMemory()
  }

  /** 记录一个对话事件到热记忆 */
  recordEvent(role: SessionEvent['role'], content: string, toolName?: string): void {
    this.hot.push({ role, content, toolName })
  }

  /** 将热记忆中指定范围的事件压缩到温记忆 */
  async evictToWarm(
    startEventIndex: number,
    endEventIndex: number,
    summaryText: string,
    keyFacts: string[],
  ): Promise<void> {
    this.warm.addSummary({
      eventRange: [startEventIndex, endEventIndex],
      summary: summaryText,
      keyFacts,
    })
    // 注意：不删除热记忆中的事件，只是标记它们已被摘要
    // 实际的 removal 由调用者决定（在 context 构建时按预算选择）
  }

  /** 记录成功修复到冷记忆 */
  recordFix(problem: string, solution: string, projectPath?: string): void {
    this.cold.add({
      content: `问题: ${problem}\n解决方案: ${solution}`,
      metadata: {
        type: 'error_fix',
        projectPath,
        tags: ['fix', ...problem.toLowerCase().split(/\s+/)],
        timestamp: new Date().toISOString(),
        importance: 0.7,
      },
    })
  }

  /** 记录用户偏好到冷记忆 */
  recordPreference(content: string): void {
    this.cold.add({
      content,
      metadata: {
        type: 'user_preference',
        tags: ['preference'],
        timestamp: new Date().toISOString(),
        importance: 0.9,
      },
    })
  }

  /** 获取所有记忆的统计信息 */
  getStats(): {
    hotEvents: number
    hotTokens: number
    warmSummaries: number
    warmTokens: number
    coldEntries: number
  } {
    return {
      hotEvents: this.hot.count,
      hotTokens: this.hot.totalTokens,
      warmSummaries: this.warm.summaries.length,
      warmTokens: this.warm.totalTokens,
      coldEntries: this.cold.count,
    }
  }

  /** 清空当前会话记忆（热+温），保留冷记忆 */
  clearSession(): void {
    this.hot.clear()
    this.warm.clear()
  }

  /** 完全清空 */
  clearAll(): void {
    this.hot.clear()
    this.warm.clear()
    this.cold = new ColdMemory()
  }
}
