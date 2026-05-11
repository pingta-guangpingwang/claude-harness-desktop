// 技能碎片收集器 — 记录每次操作用于角色合成
import type { SkillFragment, SkillType } from './fragmentTypes'
import { SKILL_CATEGORY_MAP } from './fragmentTypes'

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export class SkillFragmentCollector {
  private fragments: SkillFragment[] = []
  private maxInMemory = 1000
  private listeners: Array<(fragment: SkillFragment) => void> = []

  /** 收集一个技能碎片 */
  collect(
    skillType: SkillType,
    action: string,
    metadata: Record<string, unknown> = {},
    projectPath?: string,
    durationMs?: number,
  ): SkillFragment {
    const fragment: SkillFragment = {
      id: genId(),
      timestamp: new Date().toISOString(),
      skillType,
      category: SKILL_CATEGORY_MAP[skillType],
      action,
      metadata,
      projectPath,
      durationMs,
    }
    this.fragments.push(fragment)
    if (this.fragments.length > this.maxInMemory) {
      this.fragments = this.fragments.slice(-this.maxInMemory)
    }
    // 通知监听器
    for (const listener of this.listeners) {
      try { listener(fragment) } catch { /* ignore */ }
    }
    // 异步持久化
    this.persist(fragment)
    return fragment
  }

  /** 获取所有碎片 */
  getFragments(): SkillFragment[] {
    return this.fragments
  }

  /** 按类别统计 */
  getCategoryCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const f of this.fragments) {
      counts[f.category] = (counts[f.category] || 0) + 1
    }
    return counts
  }

  /** 按技能类型统计 */
  getSkillTypeCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const f of this.fragments) {
      counts[f.skillType] = (counts[f.skillType] || 0) + 1
    }
    return counts
  }

  /** 获取近 N 天的碎片 */
  getRecentFragments(days: number): SkillFragment[] {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    return this.fragments.filter(f => new Date(f.timestamp).getTime() > cutoff)
  }

  /** 注册碎片监听器 */
  onFragment(listener: (fragment: SkillFragment) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  /** 加载持久化碎片 */
  async load(): Promise<void> {
    try {
      const result = await (window as any).electronAPI?.roleLoadFragments?.()
      if (result && Array.isArray(result)) {
        this.fragments = result
      }
    } catch { /* IPC 不可用时跳过 */ }
  }

  /** 持久化单个碎片 */
  private async persist(fragment: SkillFragment): Promise<void> {
    try {
      await (window as any).electronAPI?.roleSaveFragment?.(fragment)
    } catch { /* IPC 不可用时静默 */ }
  }
}

/** 全局单例 */
export const fragmentCollector = new SkillFragmentCollector()
