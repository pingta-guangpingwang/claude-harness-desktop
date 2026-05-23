// 驾驭智能体 — 语义记忆模块
// 从 TF-IDF 关键词搜索升级为 Embedding 语义搜索
// 借鉴 Google ADK Memory Service (reactive + proactive recall)
//
// 默认使用 DeepSeek Embedding API (text-embedding-3-small 兼容, 1536维)
// 成本: ~$0.02/1M tokens → 几乎免费
// API 不可用时自动降级为本地 TF-IDF 关键词搜索

import { type ColdMemoryEntry, ColdMemory } from './memoryStore.js'

// ---- Embedding 类型 ----

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>
  usage: { prompt_tokens: number; total_tokens: number }
}

// ---- Cosine 相似度 ----

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// ---- TF-IDF 降级搜索 ----

function tfidfSearch(query: string, entries: ColdMemoryEntry[], topK: number): ColdMemoryEntry[] {
  const q = query.toLowerCase()
  const qWords = q.split(/\s+/).filter(w => w.length > 1)

  const scored = entries.map(entry => {
    let score = 0
    const content = entry.content.toLowerCase()
    const tags = entry.metadata.tags.map(t => t.toLowerCase())

    // 精确匹配
    if (content.includes(q)) score += 10

    // 标签匹配
    for (const tag of tags) {
      if (q.includes(tag)) score += 5
    }

    // 单词级匹配
    for (const word of qWords) {
      if (content.includes(word)) score += 2
      for (const tag of tags) {
        if (tag.includes(word)) score += 3
      }
    }

    // 重要性加权
    score *= (1 + entry.metadata.importance)

    return { entry, score }
  })

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.entry)
}

// ---- SemanticMemory 类 ----

export class SemanticMemory {
  private coldMemory: ColdMemory
  private embeddingCache: Map<string, number[]> = new Map()
  private apiKey: string
  private embeddingEndpoint: string
  private embeddingModel: string
  private enabled: boolean = true
  private lastError: string | null = null

  constructor(coldMemory: ColdMemory, apiKey: string, endpoint?: string) {
    this.coldMemory = coldMemory
    this.apiKey = apiKey
    this.embeddingEndpoint = endpoint || 'https://api.deepseek.com/v1/embeddings'
    this.embeddingModel = 'text-embedding-3-small'
  }

  /** 生成文本的 embedding 向量 */
  async embed(text: string): Promise<number[] | null> {
    if (!this.enabled) return null

    // 检查缓存
    const cacheKey = this.hashText(text)
    const cached = this.embeddingCache.get(cacheKey)
    if (cached) return cached

    try {
      const res = await fetch(this.embeddingEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.embeddingModel,
          input: text,
        }),
        signal: AbortSignal.timeout(5000),
      })

      if (!res.ok) {
        this.lastError = `Embedding API ${res.status}: ${await res.text().catch(() => '')}`
        console.warn('[SemanticMemory] Embedding API 不可用，降级为 TF-IDF:', this.lastError)
        this.enabled = false
        return null
      }

      const data: EmbeddingResponse = await res.json()
      const embedding = data.data?.[0]?.embedding
      if (embedding && embedding.length > 0) {
        this.embeddingCache.set(cacheKey, embedding)
        // 限制缓存大小
        if (this.embeddingCache.size > 1000) {
          const firstKey = this.embeddingCache.keys().next().value
          if (firstKey) this.embeddingCache.delete(firstKey)
        }
        return embedding
      }
      return null
    } catch (err) {
      this.lastError = String(err)
      console.warn('[SemanticMemory] Embedding API 异常，降级为 TF-IDF:', this.lastError)
      this.enabled = false
      return null
    }
  }

  /** 语义搜索 — embedding 优先，TF-IDF 降级 */
  async search(query: string, topK: number = 5): Promise<ColdMemoryEntry[]> {
    if (this.coldMemory.count === 0) return []

    if (!this.enabled) {
      return tfidfSearch(query, this.coldMemory.entries, topK)
    }

    // 尝试 embedding 搜索
    const queryEmbedding = await this.embed(query)
    if (!queryEmbedding) {
      return tfidfSearch(query, this.coldMemory.entries, topK)
    }

    // 异步为所有条目生成 embedding（首次可能需要几秒，后续有缓存）
    const scored: Array<{ entry: ColdMemoryEntry; score: number }> = []
    for (const entry of this.coldMemory.entries) {
      if (entry.embedding && entry.embedding.length > 0) {
        scored.push({ entry, score: cosineSimilarity(queryEmbedding, entry.embedding) })
      } else {
        // 延迟生成 embedding
        const emb = await this.embed(entry.content)
        if (emb) {
          entry.embedding = emb
          scored.push({ entry, score: cosineSimilarity(queryEmbedding, emb) })
        } else {
          // 降级：用 TF-IDF 打底分
          const tfScore = this.tfidfScore(query, entry)
          scored.push({ entry, score: tfScore * 0.5 }) // TF-IDF 分数打五折
        }
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => s.entry)
  }

  /** 记录条目 — 同时生成 embedding（后台异步） */
  async record(entry: Omit<ColdMemoryEntry, 'id' | 'embedding'>): Promise<void> {
    this.coldMemory.add(entry)

    // 后台异步生成 embedding（不阻塞）
    const idx = this.coldMemory.entries.length - 1
    const saved = this.coldMemory.entries[idx]
    if (saved && this.enabled) {
      this.embed(saved.content).then(emb => {
        if (emb) saved.embedding = emb
      }).catch(() => {})
    }
  }

  /** 批量预生成 embedding（后台运行，不阻塞） */
  async preloadEmbeddings(onProgress?: (done: number, total: number) => void): Promise<void> {
    if (!this.enabled) return

    const unembedded = this.coldMemory.entries.filter(e => !e.embedding || e.embedding.length === 0)
    let done = 0
    for (const entry of unembedded) {
      const emb = await this.embed(entry.content)
      if (emb) entry.embedding = emb
      done++
      onProgress?.(done, unembedded.length)
    }
  }

  /** 重新启用 embedding（例如 API 恢复后） */
  reenable(): void {
    this.enabled = true
    this.lastError = null
  }

  /** 获取状态 */
  getStatus(): { enabled: boolean; cacheSize: number; entries: number; embeddedCount: number; lastError: string | null } {
    const embedded = this.coldMemory.entries.filter(e => e.embedding && e.embedding.length > 0).length
    return {
      enabled: this.enabled,
      cacheSize: this.embeddingCache.size,
      entries: this.coldMemory.count,
      embeddedCount: embedded,
      lastError: this.lastError,
    }
  }

  /** 清空缓存（保留条目） */
  clearCache(): void {
    this.embeddingCache.clear()
  }

  // ---- Private ----

  private hashText(text: string): string {
    let hash = 0
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i)
      hash = ((hash << 5) - hash) + ch
      hash |= 0
    }
    return hash.toString(36)
  }

  private tfidfScore(query: string, entry: ColdMemoryEntry): number {
    const q = query.toLowerCase()
    const content = entry.content.toLowerCase()
    let score = 0
    if (content.includes(q)) score += 5
    const qWords = q.split(/\s+/).filter(w => w.length > 1)
    for (const word of qWords) {
      if (content.includes(word)) score += 1
    }
    return score * (1 + entry.metadata.importance)
  }
}
