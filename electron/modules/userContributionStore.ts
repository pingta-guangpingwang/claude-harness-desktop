// 用户贡献追踪存储
// 记录用户通过一键入库添加的资源，追踪 Git 提交状态

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

export interface UserContribution {
  id: string
  name: string
  repo: string
  type: string
  addedAt: string
  committed: boolean
  committedAt?: string
  pushed: boolean
  pushedAt?: string
}

interface StoreData {
  contributions: UserContribution[]
  updatedAt: string
}

class UserContributionStore {
  private data: StoreData
  private savePath: string

  constructor() {
    this.savePath = this.getSavePath()
    this.data = this.load()
  }

  get contributions(): UserContribution[] { return [...this.data.contributions] }

  /** 记录一条新的用户贡献 */
  record(params: { id: string; name: string; repo: string; type: string }): void {
    // 避免重复
    const existing = this.data.contributions.find(c => c.id === params.id)
    if (existing) return
    this.data.contributions.push({
      id: params.id,
      name: params.name,
      repo: params.repo,
      type: params.type,
      addedAt: new Date().toISOString(),
      committed: false,
      pushed: false,
    })
    this.save()
  }

  /** 标记为已提交 */
  markCommitted(ids: string[]): void {
    for (const c of this.data.contributions) {
      if (ids.includes(c.id) && !c.committed) {
        c.committed = true
        c.committedAt = new Date().toISOString()
      }
    }
    this.save()
  }

  /** 标记为已推送 */
  markPushed(ids: string[]): void {
    for (const c of this.data.contributions) {
      if (ids.includes(c.id) && !c.pushed) {
        c.pushed = true
        c.pushedAt = new Date().toISOString()
      }
    }
    this.save()
  }

  /** 获取某资源的贡献状态 */
  getStatus(id: string): UserContribution | undefined {
    return this.data.contributions.find(c => c.id === id)
  }

  /** 获取有未提交变更的贡献 ID 集合 */
  getUncommittedIds(): Set<string> {
    return new Set(this.data.contributions.filter(c => !c.committed).map(c => c.id))
  }

  /** 所有贡献 ID 集合 */
  getAllIds(): Set<string> {
    return new Set(this.data.contributions.map(c => c.id))
  }

  private getSavePath(): string {
    try {
      const userData = app?.getPath?.('userData') || process.env.APPDATA || process.env.HOME || '.'
      const dir = path.join(userData, 'dbghf')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      return path.join(dir, 'user-contributions.json')
    } catch {
      return path.join('.', 'user-contributions.json')
    }
  }

  private load(): StoreData {
    try {
      if (!fs.existsSync(this.savePath)) return { contributions: [], updatedAt: '' }
      const raw = fs.readFileSync(this.savePath, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return { contributions: [], updatedAt: '' }
    }
  }

  private save(): void {
    try {
      this.data.updatedAt = new Date().toISOString()
      const dir = path.dirname(this.savePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const tmp = this.savePath + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
      fs.renameSync(tmp, this.savePath)
    } catch { /* ignore */ }
  }
}

export const userContributionStore = new UserContributionStore()
