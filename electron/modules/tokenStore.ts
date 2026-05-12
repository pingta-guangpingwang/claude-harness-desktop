// TokenStore — AI Token 消耗记录与统计（主进程持久化服务）
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface TokenRecord {
  id: string
  timestamp: string
  projectPath: string
  projectName: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** 估算成本 (USD)，基于 DeepSeek 官方定价 */
  costEstimate: number
  /** 会话 ID（同一次连续对话内相同） */
  conversationId: string
}

interface TokenStats {
  totalTokens: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalCost: number
  totalCalls: number
  byDay: Record<string, { tokens: number; calls: number; cost: number }>
  byProject: Record<string, { tokens: number; calls: number; cost: number; name: string }>
  byModel: Record<string, { tokens: number; calls: number }>
  conversations: Array<{
    conversationId: string
    projectPath: string
    projectName: string
    firstCallAt: string
    lastCallAt: string
    totalTokens: number
    totalCost: number
    callCount: number
  }>
}

// DeepSeek 定价 (USD per 1M tokens)
const PRICING: Record<string, { prompt: number; completion: number }> = {
  'deepseek-chat': { prompt: 0.27, completion: 1.10 },
  'deepseek-reasoner': { prompt: 0.55, completion: 2.19 },
  default: { prompt: 0.27, completion: 1.10 },
}

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const price = PRICING[model] || PRICING.default
  return (promptTokens / 1_000_000) * price.prompt + (completionTokens / 1_000_000) * price.completion
}

function getStorePath(): string {
  try {
    const { app } = require('electron')
    const dir = join(app.getPath('userData'), 'token-store')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return join(dir, 'usage.jsonl')
  } catch {
    const dir = join(process.cwd(), '.chd', 'token-store')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return join(dir, 'usage.jsonl')
  }
}

class TokenStore {
  private storePath: string

  constructor() {
    this.storePath = getStorePath()
  }

  /** 记录一次 API 调用 */
  record(entry: Omit<TokenRecord, 'id' | 'timestamp' | 'costEstimate'>): TokenRecord {
    const record: TokenRecord = {
      ...entry,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      costEstimate: estimateCost(entry.model, entry.promptTokens, entry.completionTokens),
    }
    writeFileSync(this.storePath, JSON.stringify(record) + '\n', { flag: 'a' })
    return record
  }

  /** 读取全部记录 */
  readAll(): TokenRecord[] {
    if (!existsSync(this.storePath)) return []
    const raw = readFileSync(this.storePath, 'utf-8')
    return raw.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line) as TokenRecord } catch { return null }
    }).filter(Boolean) as TokenRecord[]
  }

  /** 聚合统计 */
  getStats(): TokenStats {
    const records = this.readAll()
    const byDay: Record<string, { tokens: number; calls: number; cost: number }> = {}
    const byProject: Record<string, { tokens: number; calls: number; cost: number; name: string }> = {}
    const byModel: Record<string, { tokens: number; calls: number }> = {}
    const convMap = new Map<string, {
      conversationId: string; projectPath: string; projectName: string
      firstCallAt: string; lastCallAt: string; totalTokens: number; totalCost: number; callCount: number
    }>()

    let totalTokens = 0, totalPrompt = 0, totalCompletion = 0, totalCost = 0

    for (const r of records) {
      totalTokens += r.totalTokens
      totalPrompt += r.promptTokens
      totalCompletion += r.completionTokens
      totalCost += r.costEstimate

      const day = r.timestamp.slice(0, 10)
      if (!byDay[day]) byDay[day] = { tokens: 0, calls: 0, cost: 0 }
      byDay[day].tokens += r.totalTokens
      byDay[day].calls += 1
      byDay[day].cost += r.costEstimate

      if (!byProject[r.projectPath]) byProject[r.projectPath] = { tokens: 0, calls: 0, cost: 0, name: r.projectName }
      byProject[r.projectPath].tokens += r.totalTokens
      byProject[r.projectPath].calls += 1
      byProject[r.projectPath].cost += r.costEstimate

      if (!byModel[r.model]) byModel[r.model] = { tokens: 0, calls: 0 }
      byModel[r.model].tokens += r.totalTokens
      byModel[r.model].calls += 1

      if (!convMap.has(r.conversationId)) {
        convMap.set(r.conversationId, {
          conversationId: r.conversationId,
          projectPath: r.projectPath,
          projectName: r.projectName,
          firstCallAt: r.timestamp,
          lastCallAt: r.timestamp,
          totalTokens: 0,
          totalCost: 0,
          callCount: 0,
        })
      }
      const conv = convMap.get(r.conversationId)!
      if (r.timestamp < conv.firstCallAt) conv.firstCallAt = r.timestamp
      if (r.timestamp > conv.lastCallAt) conv.lastCallAt = r.timestamp
      conv.totalTokens += r.totalTokens
      conv.totalCost += r.costEstimate
      conv.callCount += 1
    }

    return {
      totalTokens, totalPromptTokens: totalPrompt, totalCompletionTokens: totalCompletion,
      totalCost, totalCalls: records.length,
      byDay, byProject, byModel,
      conversations: Array.from(convMap.values()).sort((a, b) => b.lastCallAt.localeCompare(a.lastCallAt)),
    }
  }

  /** 按会话获取详细记录 */
  getConversationRecords(conversationId: string): TokenRecord[] {
    return this.readAll().filter(r => r.conversationId === conversationId)
  }

  /** 获取每个会话的对话摘要（从 audit log 中提取用户提问） */
  getConversationTurns(conversationId: string): Array<{ timestamp: string; role: string; content: string }> {
    // 从审计日志中提取对话记录
    try {
      const { getAuditLogger } = require('../modules/systemIpc')
      const logger = getAuditLogger()
      if (!logger) return []
      const entries = logger.readByCategory?.('agent') || []
      return entries
        .filter((e: any) => e.metadata?.conversationId === conversationId && (e.action === 'user_prompt' || e.action === 'assistant_response'))
        .map((e: any) => ({
          timestamp: e.timestamp,
          role: e.action === 'user_prompt' ? 'user' : 'assistant',
          content: e.metadata?.summary || e.target || '',
        }))
    } catch { return [] }
  }
}

let instance: TokenStore | null = null
export function getTokenStore(): TokenStore {
  if (!instance) instance = new TokenStore()
  return instance
}
