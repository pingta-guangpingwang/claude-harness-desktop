// AuditLogger — 追加式结构化审计日志 + 10MB 轮转 + 保留 5 个文件
import { appendFileSync, existsSync, mkdirSync, statSync, renameSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface AuditEntry {
  id: string
  timestamp: string
  category: 'agent' | 'cli' | 'plugin' | 'workflow' | 'rule' | 'system' | 'permission'
  action: string
  actor?: string
  target?: string
  result: 'success' | 'failure' | 'denied' | 'pending'
  details?: Record<string, unknown>
  durationMs?: number
  projectPath?: string
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_BACKUPS = 5

export class AuditLogger {
  private logDir: string
  private currentFile: string
  private buffer: AuditEntry[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private flushIntervalMs: number

  constructor(flushIntervalMs: number = 5000) {
    this.logDir = getAuditDir()
    this.currentFile = join(this.logDir, 'audit.log')
    this.flushIntervalMs = flushIntervalMs
    this.ensureDir()
    this.startFlushTimer()
  }

  /** 记录一条审计日志 */
  log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): string {
    const id = genId()
    const full: AuditEntry = {
      id,
      timestamp: new Date().toISOString(),
      ...entry,
    }
    this.buffer.push(full)
    return id
  }

  /** 立即刷新缓冲到磁盘 */
  flush(): void {
    if (this.buffer.length === 0) return
    const lines = this.buffer.map(e => JSON.stringify(e)).join('\n') + '\n'
    this.buffer = []

    try {
      this.rotateIfNeeded()
      appendFileSync(this.currentFile, lines, 'utf-8')
    } catch { /* ignore — 审计日志不阻塞主流程 */ }
  }

  /** 读取最近的审计日志 */
  readRecent(limit: number = 100, category?: string): AuditEntry[] {
    const entries: AuditEntry[] = []

    // 先读当前文件，再读备份文件
    const files: string[] = []
    if (existsSync(this.currentFile)) files.push(this.currentFile)
    for (let i = 0; i < MAX_BACKUPS; i++) {
      const backupFile = join(this.logDir, `audit.${i + 1}.log`)
      if (existsSync(backupFile)) files.push(backupFile)
    }

    for (const file of files.reverse()) {
      try {
        const raw = readFileSync(file, 'utf-8')
        const lines = raw.trim().split('\n')
        for (const line of lines.reverse()) {
          try {
            const entry: AuditEntry = JSON.parse(line)
            if (category && entry.category !== category) continue
            entries.push(entry)
            if (entries.length >= limit) return entries
          } catch { /* skip corrupt */ }
        }
      } catch { /* skip missing */ }
    }

    return entries
  }

  /** 按类别读取 */
  readByCategory(category: AuditEntry['category'], limit: number = 100): AuditEntry[] {
    return this.readRecent(limit, category)
  }

  /** 按项目过滤 */
  readByProject(projectPath: string, limit: number = 100): AuditEntry[] {
    const all = this.readRecent(limit * 3)
    return all.filter(e => e.projectPath === projectPath).slice(0, limit)
  }

  /** 获取日志统计 */
  getStats(): { totalEntries: number; byCategory: Record<string, number>; byResult: Record<string, number>; sizeBytes: number } {
    const stats: Record<string, number> = {}
    const results: Record<string, number> = {}
    let totalEntries = 0
    let totalSize = 0

    const files: string[] = []
    if (existsSync(this.currentFile)) {
      files.push(this.currentFile)
      totalSize += statSync(this.currentFile).size
    }
    for (let i = 0; i < MAX_BACKUPS; i++) {
      const backupFile = join(this.logDir, `audit.${i + 1}.log`)
      if (existsSync(backupFile)) {
        files.push(backupFile)
        totalSize += statSync(backupFile).size
      }
    }

    for (const file of files) {
      try {
        const raw = readFileSync(file, 'utf-8')
        for (const line of raw.trim().split('\n')) {
          try {
            const entry: AuditEntry = JSON.parse(line)
            totalEntries++
            stats[entry.category] = (stats[entry.category] || 0) + 1
            results[entry.result] = (results[entry.result] || 0) + 1
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    return {
      totalEntries,
      byCategory: stats,
      byResult: results,
      sizeBytes: totalSize,
    }
  }

  /** 清理所有日志 */
  clear(): void {
    this.flush()
    try {
      writeFileSync(this.currentFile, '', 'utf-8')
      for (let i = 0; i < MAX_BACKUPS; i++) {
        const backupFile = join(this.logDir, `audit.${i + 1}.log`)
        if (existsSync(backupFile)) {
          const { unlinkSync } = require('fs')
          unlinkSync(backupFile)
        }
      }
    } catch { /* ignore */ }
  }

  /** 销毁 */
  destroy(): void {
    this.flush()
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (!existsSync(this.currentFile)) return
      const size = statSync(this.currentFile).size
      if (size < MAX_FILE_SIZE) return

      // 滚动轮转
      for (let i = MAX_BACKUPS; i >= 1; i--) {
        const oldFile = join(this.logDir, `audit.${i}.log`)
        const newFile = join(this.logDir, `audit.${i + 1}.log`)
        if (existsSync(oldFile)) {
          if (i === MAX_BACKUPS) {
            const { unlinkSync } = require('fs')
            unlinkSync(oldFile)
          } else {
            renameSync(oldFile, newFile)
          }
        }
      }

      renameSync(this.currentFile, join(this.logDir, 'audit.1.log'))
    } catch { /* ignore */ }
  }

  private ensureDir(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true })
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs)
  }
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function getAuditDir(): string {
  try {
    const { app } = require('electron')
    const p = join(app.getPath('userData'), 'audit')
    return p
  } catch { return join(process.cwd(), '.chd', 'audit') }
}
