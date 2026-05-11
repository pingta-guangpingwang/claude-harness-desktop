// CloudSyncService — 基于 sync-manifest 的双向云同步
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, relative } from 'path'
import { db } from './modules/database.js'

export interface SyncManifest {
  version: number
  lastSyncAt: string
  remoteUrl: string
  entries: SyncEntry[]
}

export interface SyncEntry {
  /** 相对路径（相对于 CHD 数据目录） */
  path: string
  /** 本地最后修改时间 */
  localMtime: string
  /** 远程最后同步时间 */
  remoteMtime: string
  /** 同步状态: synced | local_newer | remote_newer | conflict */
  status: 'synced' | 'local_newer' | 'remote_newer' | 'conflict'
}

export interface SyncStats {
  total: number
  synced: number
  localNewer: number
  remoteNewer: number
  conflicts: number
  lastSyncAt: string | null
}

export class CloudSyncService {
  private manifestPath: string
  private manifest: SyncManifest | null = null

  constructor() {
    this.manifestPath = join(db.DATA_DIR, 'sync-manifest.json')
    this.loadManifest()
  }

  /** 加载同步清单 */
  private loadManifest(): void {
    try {
      if (existsSync(this.manifestPath)) {
        this.manifest = JSON.parse(readFileSync(this.manifestPath, 'utf-8'))
      }
    } catch { /* ignore */ }
    if (!this.manifest) {
      this.manifest = { version: 1, lastSyncAt: '', remoteUrl: '', entries: [] }
    }
  }

  /** 保存同步清单 */
  private saveManifest(): void {
    try {
      if (!existsSync(db.DATA_DIR)) mkdirSync(db.DATA_DIR, { recursive: true })
      writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2), 'utf-8')
    } catch { /* ignore */ }
  }

  /** 扫描本地文件变更 */
  scanLocal(): SyncEntry[] {
    const entries: SyncEntry[] = []
    const scanDir = (dir: string) => {
      try {
        const { readdirSync, statSync } = require('fs') as typeof import('fs')
        for (const name of readdirSync(dir)) {
          const full = join(dir, name)
          if (name.startsWith('.') || name === 'sync-manifest.json') continue
          const stat = statSync(full)
          if (stat.isDirectory()) {
            scanDir(full)
          } else {
            const rel = relative(db.DATA_DIR, full).replace(/\\/g, '/')
            const existing = this.manifest?.entries.find(e => e.path === rel)
            entries.push({
              path: rel,
              localMtime: stat.mtime.toISOString(),
              remoteMtime: existing?.remoteMtime || '',
              status: existing && existing.remoteMtime !== stat.mtime.toISOString() ? 'local_newer' : 'synced',
            })
          }
        }
      } catch { /* ignore */ }
    }
    scanDir(db.DATA_DIR)
    return entries
  }

  /** 标记同步完成 */
  markSynced(paths: string[]): void {
    if (!this.manifest) return
    const now = new Date().toISOString()
    for (const p of paths) {
      const entry = this.manifest.entries.find(e => e.path === p)
      if (entry) {
        entry.remoteMtime = entry.localMtime
        entry.status = 'synced'
      }
    }
    this.manifest.lastSyncAt = now
    this.saveManifest()
  }

  /** 标记冲突 */
  markConflict(path: string): void {
    if (!this.manifest) return
    const entry = this.manifest.entries.find(e => e.path === path)
    if (entry) entry.status = 'conflict'
    this.saveManifest()
  }

  /** 获取同步状态 */
  getStats(): SyncStats {
    const entries = this.scanLocal()
    return {
      total: entries.length,
      synced: entries.filter(e => e.status === 'synced').length,
      localNewer: entries.filter(e => e.status === 'local_newer').length,
      remoteNewer: entries.filter(e => e.status === 'remote_newer').length,
      conflicts: entries.filter(e => e.status === 'conflict').length,
      lastSyncAt: this.manifest?.lastSyncAt || null,
    }
  }

  /** 设置远程 URL */
  setRemoteUrl(url: string): void {
    if (this.manifest) {
      this.manifest.remoteUrl = url
      this.saveManifest()
    }
  }

  /** 获取远程 URL */
  getRemoteUrl(): string {
    return this.manifest?.remoteUrl || ''
  }
}

export const cloudSync = new CloudSyncService()
