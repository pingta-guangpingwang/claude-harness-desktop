// 资源审核 — 待审核列表持久化存储
// 模块级单例，仿 roleConfigStore 的原子写入模式

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

export interface PendingResourceItem {
  id: string
  name: string
  resourceType: string
  targetRepo: string
  category: string
  techStack: string[]
  sourceUrl: string
  summary: string
  rawContent: string
  status: 'pending' | 'audited' | 'approved' | 'rejected'
  auditScore: number
  auditNotes: string
  formattedContent: string
  auditedAt: string
  createdAt: string
}

interface PendingResourcesData {
  items: PendingResourceItem[]
  updatedAt: string
}

const DEFAULTS: PendingResourcesData = {
  items: [],
  updatedAt: new Date().toISOString(),
}

class PendingResourceStore {
  private data: PendingResourcesData
  private savePath: string

  constructor() {
    this.savePath = this.getSavePath()
    this.data = this.load()
  }

  // ---- Getters ----

  get items(): PendingResourceItem[] { return [...this.data.items] }

  getPendingCount(): number {
    return this.data.items.filter(i => i.status === 'pending').length
  }

  getAuditedCount(): number {
    return this.data.items.filter(i => i.status === 'audited').length
  }

  getItem(id: string): PendingResourceItem | undefined {
    return this.data.items.find(i => i.id === id)
  }

  getItemsByStatus(status: string): PendingResourceItem[] {
    return this.data.items.filter(i => i.status === status)
  }

  // ---- Setters (auto-save) ----

  addItem(item: PendingResourceItem): void {
    this.data.items.push(item)
    this.save()
  }

  removeItem(id: string): boolean {
    const before = this.data.items.length
    this.data.items = this.data.items.filter(i => i.id !== id)
    if (this.data.items.length !== before) {
      this.save()
      return true
    }
    return false
  }

  updateItem(id: string, updates: Partial<PendingResourceItem>): boolean {
    const item = this.data.items.find(i => i.id === id)
    if (!item) return false
    Object.assign(item, updates)
    this.save()
    return true
  }

  // ---- 全量 ----

  getConfig(): PendingResourcesData {
    return { items: [...this.data.items], updatedAt: this.data.updatedAt }
  }

  // ---- Persistence ----

  private getSavePath(): string {
    try {
      const userData = app?.getPath?.('userData') || process.env.APPDATA || process.env.HOME || '.'
      const dir = path.join(userData, 'dbghf')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      return path.join(dir, 'pending-resources.json')
    } catch {
      return path.join('.', 'pending-resources.json')
    }
  }

  private load(): PendingResourcesData {
    try {
      if (!fs.existsSync(this.savePath)) return { ...DEFAULTS }
      const raw = fs.readFileSync(this.savePath, 'utf-8')
      const parsed = JSON.parse(raw)
      return {
        items: parsed.items ?? [],
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      }
    } catch {
      return { ...DEFAULTS }
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
    } catch { /* 保存失败不影响主流程 */ }
  }
}

export const pendingResourceStore = new PendingResourceStore()
