// 驾驭智能体 — Token 预算管理器
// 借鉴 Google ADK Token Budget 体系 + Kimi 全量上下文策略
// 核心原则：默认全量保留，只在必要时摘要 — 用满 128K 油箱而非每次只加 5 升

export interface TokenAllocation {
  systemPromptTokens: number
  hotTokens: number
  hotRoundCount: number
  warmBudget: number
  coldBudget: number
  snapshotTokens: number
  totalUsed: number
  windowTokens: number
  utilizationPercent: string
}

export interface ProviderCapabilities {
  maxContextTokens: number
  maxOutputTokens: number
  modelName: string
}

// 已知模型的上下文窗口大小（token）
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'deepseek-chat': 128_000,
  'deepseek-v4-pro': 128_000,
  'deepseek-v3': 128_000,
  'deepseek-reasoner': 64_000,
  'claude-sonnet-4-6': 200_000,
  'claude-opus-4-7': 200_000,
  'claude-haiku-4-5': 200_000,
  'claude-3-5-sonnet': 200_000,
  'claude-3-opus': 200_000,
  'claude-3-haiku': 200_000,
}

// 预算分配比例（Google ADK 风格）
const BUDGET_RATIOS = {
  systemPrompt: 0.15,
  hotHistory: 0.50,
  warmSummaries: 0.10,
  knowledge: 0.10,
  snapshot: 0.10,
  headroom: 0.05,
}

export function getProviderCapabilities(model: string): ProviderCapabilities {
  const maxContextTokens = MODEL_CONTEXT_WINDOWS[model] || 128_000
  return {
    maxContextTokens,
    maxOutputTokens: 4096,
    modelName: model,
  }
}

/** 估算文本 token 数 — 双轨策略：英文 ~4 chars/token，中文 ~1.5 chars/token */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjkChars = 0
  let otherChars = 0
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if ((code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x3000 && code <= 0x303F) ||
        (code >= 0xFF00 && code <= 0xFFEF) ||
        (code >= 0xF900 && code <= 0xFAFF)) {
      cjkChars++
    } else {
      otherChars++
    }
  }
  return Math.ceil(cjkChars / 1.5 + otherChars / 4)
}

/** 估算消息数组的总 token 数 */
export function estimateMessagesTokens(
  messages: Array<{ role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string; reasoning_content?: string }>
): number {
  let total = 0
  for (const msg of messages) {
    total += estimateTokens(msg.content || '')
    if (msg.reasoning_content) total += estimateTokens(msg.reasoning_content)
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += estimateTokens(JSON.stringify(tc))
      }
    }
  }
  return total
}

export class TokenBudgeter {
  private provider: ProviderCapabilities
  private lastActualUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null
  private roundUsages: Array<{ roundIndex: number; promptTokens: number; completionTokens: number }> = []

  constructor(model: string) {
    this.provider = getProviderCapabilities(model)
  }

  updateModel(model: string): void {
    this.provider = getProviderCapabilities(model)
  }

  /** 记录每轮 API 返回的实际 token 消耗 */
  recordRoundUsage(promptTokens: number, completionTokens: number, roundIndex: number): void {
    this.lastActualUsage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    }
    this.roundUsages.push({ roundIndex, promptTokens, completionTokens })
  }

  /** 获取最近一次 API 调用的实际 token 消耗 */
  getLastUsage(): { promptTokens: number; completionTokens: number; totalTokens: number } | null {
    return this.lastActualUsage
  }

  /**
   * 核心预算计算 — 决定热/温/冷各分配多少 token
   * 返回本轮应该保留多少轮全量热记忆
   */
  computeBudget(
    systemPromptText: string,
    snapshotText: string,
    hotRoundTokenCounts: number[],
  ): TokenAllocation {
    const windowTokens = this.provider.maxContextTokens
    const safeWindow = Math.floor(windowTokens * 0.85)

    const systemPromptTokens = estimateTokens(systemPromptText)
    const snapshotTokens = estimateTokens(snapshotText)
    const fixedOverhead = systemPromptTokens + snapshotTokens
    const remaining = Math.max(0, safeWindow - fixedOverhead)

    // 热记忆：从最新轮次往前数，尽可能多保留
    let hotTokens = 0
    let hotRoundCount = 0
    const hotBudget = Math.floor(remaining * BUDGET_RATIOS.hotHistory / (BUDGET_RATIOS.hotHistory + BUDGET_RATIOS.warmSummaries + BUDGET_RATIOS.knowledge))

    for (let i = hotRoundTokenCounts.length - 1; i >= 0; i--) {
      const roundTokens = hotRoundTokenCounts[i]
      if (hotTokens + roundTokens > hotBudget) break
      hotTokens += roundTokens
      hotRoundCount++
    }

    const warmBudget = Math.floor(remaining * BUDGET_RATIOS.warmSummaries / (BUDGET_RATIOS.hotHistory + BUDGET_RATIOS.warmSummaries + BUDGET_RATIOS.knowledge))
    const coldBudget = Math.floor(remaining * BUDGET_RATIOS.knowledge / (BUDGET_RATIOS.hotHistory + BUDGET_RATIOS.warmSummaries + BUDGET_RATIOS.knowledge))
    const totalUsed = fixedOverhead + hotTokens + warmBudget + coldBudget

    return {
      systemPromptTokens,
      hotTokens,
      hotRoundCount,
      warmBudget,
      coldBudget,
      snapshotTokens,
      totalUsed,
      windowTokens,
      utilizationPercent: ((totalUsed / windowTokens) * 100).toFixed(1),
    }
  }

  /** 检查是否接近窗口上限（>80%） */
  isApproachingLimit(): boolean {
    if (!this.lastActualUsage) return false
    const ratio = this.lastActualUsage.promptTokens / this.provider.maxContextTokens
    return ratio > 0.8
  }

  /** 获取上下文利用率报告 */
  getUtilizationReport(): string {
    if (!this.lastActualUsage) {
      return `窗口: ${(this.provider.maxContextTokens / 1000).toFixed(0)}K tokens, 暂无用量数据`
    }
    const pct = ((this.lastActualUsage.promptTokens / this.provider.maxContextTokens) * 100).toFixed(1)
    return `当前使用 ${(this.lastActualUsage.promptTokens / 1000).toFixed(0)}K/${(this.provider.maxContextTokens / 1000).toFixed(0)}K tokens (${pct}%)`
  }

  /** 获取累计 token 消耗统计 */
  getCumulativeStats(): { totalPrompt: number; totalCompletion: number; roundCount: number } {
    let totalPrompt = 0
    let totalCompletion = 0
    for (const u of this.roundUsages) {
      totalPrompt += u.promptTokens
      totalCompletion += u.completionTokens
    }
    return { totalPrompt, totalCompletion, roundCount: this.roundUsages.length }
  }

  /** 获取当前 provider 能力信息 */
  getProviderCapabilities(model?: string): ProviderCapabilities {
    if (model) this.provider = getProviderCapabilities(model)
    return this.provider
  }

  /** 清空轮次记录（会话重置时） */
  reset(): void {
    this.roundUsages = []
    this.lastActualUsage = null
  }
}
