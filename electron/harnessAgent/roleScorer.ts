// 驾驭智能体 — 角色评分引擎
// 记录每个角色的任务执行历史，计算成功率和可靠性评分
// 评分数据持久化到 %APPDATA%/dbghf/role-scores.json

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

// ---- 类型 ----

export interface TaskRecord {
  id: string
  roleId: string
  task: string              // 任务描述摘要
  toolUsed: string          // 使用的工具名
  projectPath?: string
  result: 'success' | 'failure' | 'partial'
  durationMs: number
  errorMessage?: string
  timestamp: string
}

export interface RoleScore {
  roleId: string
  roleName: string
  totalTasks: number
  successfulTasks: number
  failedTasks: number
  partialTasks: number
  /** 成功率 = successful / total (0-1) */
  successRate: number
  /** 可靠性 = (successful + 0.5*partial) / total (0-1) */
  reliability: number
  /** 平均耗时 (ms) */
  avgDurationMs: number
  /** 最近一次使用时间 */
  lastUsedAt: string | null
  /** 综合评分 (0-100) — 加权计算 */
  compositeScore: number
  /** 评分历史 (最近20条) */
  recentRecords: TaskRecord[]
}

// ---- 综合评分权重 ----

const SCORE_WEIGHTS = {
  successRate: 0.40,     // 成功率权重最高
  reliability: 0.25,     // 可靠性（含部分成功）
  consistency: 0.20,     // 一致性（成功率稳定性）
  activityLevel: 0.15,   // 活跃度（最近使用频率）
}

// ---- RoleScorer ----

export class RoleScorer {
  private scores: Map<string, RoleScore> = new Map()
  private allRecords: TaskRecord[] = []
  private savePath: string

  constructor() {
    this.savePath = this.getSavePath()
    this.load()
  }

  /** 记录一次任务执行 */
  recordTask(record: Omit<TaskRecord, 'id' | 'timestamp'>): TaskRecord {
    const full: TaskRecord = {
      ...record,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
    }

    this.allRecords.push(full)
    if (this.allRecords.length > 500) {
      this.allRecords = this.allRecords.slice(-500)
    }

    // 更新角色评分
    this.updateScore(record.roleId, full)

    // 自动保存
    this.save()

    return full
  }

  /** 获取角色评分 */
  getScore(roleId: string): RoleScore | null {
    return this.scores.get(roleId) || null
  }

  /** 获取所有角色评分 */
  getAllScores(): RoleScore[] {
    return [...this.scores.values()]
  }

  /** 获取排行榜（按综合评分降序） */
  getLeaderboard(topK?: number): RoleScore[] {
    return [...this.scores.values()]
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, topK || this.scores.size)
  }

  /** 获取指定角色的任务历史 */
  getHistory(roleId: string, limit: number = 50): TaskRecord[] {
    return this.allRecords
      .filter(r => r.roleId === roleId)
      .slice(-limit)
      .reverse()
  }

  /** 获取所有任务记录（按时间倒序） */
  getAllHistory(limit: number = 100): TaskRecord[] {
    return [...this.allRecords].reverse().slice(0, limit)
  }

  /** 生成角色评分报告（Markdown 格式） */
  generateReport(): string {
    const lines: string[] = ['# 角色评分报告', '']
    const leaderboard = this.getLeaderboard()

    if (leaderboard.length === 0) {
      lines.push('暂无评分数据。')
      return lines.join('\n')
    }

    lines.push('| 排名 | 角色 | 综合分 | 成功率 | 可靠性 | 总任务 | 最近活跃 |')
    lines.push('|------|------|--------|--------|--------|--------|----------|')

    for (let i = 0; i < leaderboard.length; i++) {
      const s = leaderboard[i]
      const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1)
      const lastUsed = s.lastUsedAt
        ? new Date(s.lastUsedAt).toLocaleDateString()
        : '从未'
      lines.push(`| ${rank} | ${s.roleName} | ${s.compositeScore.toFixed(1)} | ${(s.successRate * 100).toFixed(0)}% | ${(s.reliability * 100).toFixed(0)}% | ${s.totalTasks} | ${lastUsed} |`)
    }

    lines.push('')
    lines.push('## 详情')

    for (const s of leaderboard) {
      lines.push('')
      lines.push(`### ${s.roleName} (\`${s.roleId}\`)`)
      lines.push(`- 综合评分: **${s.compositeScore.toFixed(1)}/100**`)
      lines.push(`- 成功率: ${(s.successRate * 100).toFixed(0)}% (${s.successfulTasks}/${s.totalTasks})`)
      lines.push(`- 可靠性: ${(s.reliability * 100).toFixed(0)}%`)
      lines.push(`- 平均耗时: ${s.avgDurationMs > 60000 ? (s.avgDurationMs / 60000).toFixed(1) + 'min' : (s.avgDurationMs / 1000).toFixed(1) + 's'}`)
      lines.push(`- 最近活跃: ${s.lastUsedAt ? new Date(s.lastUsedAt).toLocaleString() : '从未'}`)

      if (s.recentRecords.length > 0) {
        lines.push('- 最近任务:')
        for (const r of s.recentRecords.slice(-5).reverse()) {
          const emoji = r.result === 'success' ? '✅' : r.result === 'partial' ? '⚠️' : '❌'
          lines.push(`  ${emoji} ${r.task.slice(0, 80)} (${r.toolUsed}, ${(r.durationMs / 1000).toFixed(1)}s)`)
        }
      }
    }

    return lines.join('\n')
  }

  /** 重置指定角色的评分 */
  resetScore(roleId: string): void {
    this.scores.delete(roleId)
    this.allRecords = this.allRecords.filter(r => r.roleId !== roleId)
    this.save()
  }

  /** 重置全部评分 */
  resetAll(): void {
    this.scores.clear()
    this.allRecords = []
    this.save()
  }

  /** 手动调整角色综合评分（用于人工修正） */
  adjustScore(roleId: string, adjustment: number, reason: string): void {
    const score = this.scores.get(roleId)
    if (score) {
      score.compositeScore = Math.max(0, Math.min(100, score.compositeScore + adjustment))
      this.save()
    }
  }

  // ---- private ----

  private updateScore(roleId: string, record: TaskRecord): void {
    let score = this.scores.get(roleId)
    if (!score) {
      score = {
        roleId,
        roleName: roleId, // 将被 RoleManager 覆盖
        totalTasks: 0,
        successfulTasks: 0,
        failedTasks: 0,
        partialTasks: 0,
        successRate: 0,
        reliability: 0,
        avgDurationMs: 0,
        lastUsedAt: null,
        compositeScore: 50, // 初始中性评分
        recentRecords: [],
      }
      this.scores.set(roleId, score)
    }

    score.totalTasks++
    if (record.result === 'success') score.successfulTasks++
    else if (record.result === 'partial') score.partialTasks++
    else score.failedTasks++

    score.successRate = score.totalTasks > 0
      ? score.successfulTasks / score.totalTasks
      : 0

    score.reliability = score.totalTasks > 0
      ? (score.successfulTasks + 0.5 * score.partialTasks) / score.totalTasks
      : 0

    // 移动平均更新耗时
    score.avgDurationMs = score.avgDurationMs > 0
      ? Math.round((score.avgDurationMs * (score.totalTasks - 1) + record.durationMs) / score.totalTasks)
      : record.durationMs

    score.lastUsedAt = record.timestamp

    // 最近记录
    score.recentRecords.push(record)
    if (score.recentRecords.length > 20) {
      score.recentRecords = score.recentRecords.slice(-20)
    }

    // 计算综合评分
    score.compositeScore = this.computeComposite(score)
  }

  private computeComposite(score: RoleScore): number {
    // 成功率稳定性（最近10条 vs 全部）
    let consistency = 0.5
    const recent = score.recentRecords.slice(-10)
    if (recent.length >= 3) {
      const recentSuccess = recent.filter(r => r.result === 'success').length / recent.length
      const delta = Math.abs(recentSuccess - score.successRate)
      consistency = 1 - Math.min(delta * 2, 1) // 近期偏离越大，一致性越低
    }

    // 活跃度（基于最近一次使用时间）
    let activityLevel = 0.3
    if (score.lastUsedAt) {
      const hoursSince = (Date.now() - new Date(score.lastUsedAt).getTime()) / 3600000
      activityLevel = Math.max(0, 1 - hoursSince / 168) // 一周内满分
    }

    // 任务数量因子（太少任务不靠谱）
    const taskFactor = Math.min(score.totalTasks / 10, 1) // 10个任务后满分

    const raw = (
      SCORE_WEIGHTS.successRate * score.successRate * 100 +
      SCORE_WEIGHTS.reliability * score.reliability * 100 +
      SCORE_WEIGHTS.consistency * consistency * 100 +
      SCORE_WEIGHTS.activityLevel * activityLevel * 100
    ) * taskFactor

    return Math.round(raw * 10) / 10
  }

  private getSavePath(): string {
    try {
      const userData = app?.getPath?.('userData') || process.env.APPDATA || process.env.HOME || '.'
      const dir = path.join(userData, 'dbghf')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      return path.join(dir, 'role-scores.json')
    } catch {
      return path.join('.', 'role-scores.json')
    }
  }

  private save(): void {
    try {
      const data = {
        scores: [...this.scores.values()],
        recentRecords: this.allRecords.slice(-100),
        savedAt: new Date().toISOString(),
      }
      fs.writeFileSync(this.savePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch { /* 保存失败不影响主流程 */ }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.savePath)) return
      const raw = fs.readFileSync(this.savePath, 'utf-8')
      const data = JSON.parse(raw)
      if (data.scores && Array.isArray(data.scores)) {
        for (const s of data.scores) {
          this.scores.set(s.roleId, s)
        }
      }
      if (data.recentRecords && Array.isArray(data.recentRecords)) {
        this.allRecords = data.recentRecords
      }
    } catch { /* 加载失败从零开始 */ }
  }
}
