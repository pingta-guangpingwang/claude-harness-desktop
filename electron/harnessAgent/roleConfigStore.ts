// 驾驭智能体 — 角色配置持久化存储
// 模块级单例，跨 AgentLoop 生命周期保留配置

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import type { RoleConfig } from './roleManager.js'
import { RoleScorer, type RoleScore } from './roleScorer.js'
import { BUILTIN_ROLES } from './roleManager.js'

export interface RoleConfigData {
  roleSystemEnabled: boolean
  enabledRoleIds: string[]
  customRoles: RoleConfig[]
  updatedAt: string
}

const DEFAULTS: RoleConfigData = {
  roleSystemEnabled: false,
  enabledRoleIds: ['ceo', 'worker', 'reviewer', 'diagnostician'],
  customRoles: [],
  updatedAt: new Date().toISOString(),
}

class RoleConfigStore {
  private data: RoleConfigData
  private savePath: string

  constructor() {
    this.savePath = this.getSavePath()
    this.data = this.load()
  }

  // ---- Getters ----

  get systemEnabled(): boolean { return this.data.roleSystemEnabled }
  get enabledRoleIds(): string[] { return [...this.data.enabledRoleIds] }
  get customRoles(): RoleConfig[] { return [...this.data.customRoles] }

  isRoleEnabled(roleId: string): boolean {
    return this.data.enabledRoleIds.includes(roleId)
  }

  // ---- Setters (auto-save) ----

  setSystemEnabled(v: boolean): void {
    this.data.roleSystemEnabled = v
    this.save()
  }

  setRoleEnabled(roleId: string, v: boolean): void {
    if (v && !this.data.enabledRoleIds.includes(roleId)) {
      this.data.enabledRoleIds.push(roleId)
    } else if (!v) {
      this.data.enabledRoleIds = this.data.enabledRoleIds.filter(id => id !== roleId)
    }
    this.save()
  }

  addCustomRole(role: RoleConfig): void {
    this.data.customRoles = this.data.customRoles.filter(r => r.id !== role.id)
    this.data.customRoles.push(role)
    // 自动启用新角色
    if (!this.data.enabledRoleIds.includes(role.id)) {
      this.data.enabledRoleIds.push(role.id)
    }
    this.save()
  }

  removeCustomRole(roleId: string): boolean {
    const before = this.data.customRoles.length
    this.data.customRoles = this.data.customRoles.filter(r => r.id !== roleId)
    this.data.enabledRoleIds = this.data.enabledRoleIds.filter(id => id !== roleId)
    if (this.data.customRoles.length !== before) {
      this.save()
      return true
    }
    return false
  }

  // ---- 组合查询 ----

  /** 获取所有角色（内置+自定义）带评分和启用状态 */
  getRolesWithScores(): Array<{ role: RoleConfig; score: RoleScore | null; isCustom: boolean; enabled: boolean }> {
    const scorer = new RoleScorer()
    const allRoles = [...BUILTIN_ROLES, ...this.data.customRoles]

    return allRoles.map(role => ({
      role,
      score: scorer.getScore(role.id),
      isCustom: this.data.customRoles.some(cr => cr.id === role.id),
      enabled: this.data.enabledRoleIds.includes(role.id),
    }))
  }

  /** 获取排行榜 */
  getLeaderboard(topK?: number): RoleScore[] {
    const scorer = new RoleScorer()
    return scorer.getLeaderboard(topK)
  }

  /** 生成评分报告 */
  generateScoreReport(): string {
    const scorer = new RoleScorer()
    return scorer.generateReport()
  }

  // ---- 全量导入/导出 ----

  getConfig(): RoleConfigData {
    return { ...this.data, enabledRoleIds: [...this.data.enabledRoleIds], customRoles: [...this.data.customRoles] }
  }

  // ---- Persistence ----

  private getSavePath(): string {
    try {
      const userData = app?.getPath?.('userData') || process.env.APPDATA || process.env.HOME || '.'
      const dir = path.join(userData, 'dbghf')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      return path.join(dir, 'roles-config.json')
    } catch {
      return path.join('.', 'roles-config.json')
    }
  }

  private load(): RoleConfigData {
    try {
      if (!fs.existsSync(this.savePath)) return { ...DEFAULTS }
      const raw = fs.readFileSync(this.savePath, 'utf-8')
      const parsed = JSON.parse(raw)
      return {
        roleSystemEnabled: parsed.roleSystemEnabled ?? DEFAULTS.roleSystemEnabled,
        enabledRoleIds: parsed.enabledRoleIds ?? DEFAULTS.enabledRoleIds,
        customRoles: parsed.customRoles ?? DEFAULTS.customRoles,
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      }
    } catch {
      return { ...DEFAULTS }
    }
  }

  /** 重置为默认配置（测试用） */
  reset(): void {
    this.data = { ...DEFAULTS, updatedAt: new Date().toISOString() }
    this.save()
  }

  private save(): void {
    try {
      this.data.updatedAt = new Date().toISOString()
      const dir = path.dirname(this.savePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      // Atomic write
      const tmp = this.savePath + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
      fs.renameSync(tmp, this.savePath)
    } catch { /* 保存失败不影响主流程 */ }
  }
}

// 模块级单例
export const roleConfigStore = new RoleConfigStore()
