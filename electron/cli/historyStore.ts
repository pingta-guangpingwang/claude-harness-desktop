// CLI 命令历史持久化
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { CommandHistoryEntry, CommandBookmark, CommandGroup } from './types'

function getDataDir(): string {
  try {
    const { app } = require('electron')
    const p = app.getPath('userData')
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
    return p
  } catch { return '' }
}

const HISTORY_PATH = ''
const BOOKMARKS_PATH = ''
const GROUPS_PATH = ''

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export class HistoryStore {
  private history: CommandHistoryEntry[] = []
  private bookmarks: CommandBookmark[] = []
  private groups: CommandGroup[] = []
  private maxHistory = 500

  constructor() {
    this.load()
  }

  private getPaths() {
    const dir = getDataDir()
    return {
      history: dir ? join(dir, 'command-history.json') : '',
      bookmarks: dir ? join(dir, 'command-bookmarks.json') : '',
      groups: dir ? join(dir, 'command-groups.json') : '',
    }
  }

  private load(): void {
    try {
      const paths = this.getPaths()
      if (paths.history && existsSync(paths.history)) {
        this.history = JSON.parse(readFileSync(paths.history, 'utf-8'))
      }
      if (paths.bookmarks && existsSync(paths.bookmarks)) {
        this.bookmarks = JSON.parse(readFileSync(paths.bookmarks, 'utf-8'))
      }
      if (paths.groups && existsSync(paths.groups)) {
        this.groups = JSON.parse(readFileSync(paths.groups, 'utf-8'))
      }
    } catch { /* ignore */ }
  }

  private saveHistory(): void {
    const p = this.getPaths().history
    if (p) writeFileSync(p, JSON.stringify(this.history, null, 2), 'utf-8')
  }
  private saveBookmarks(): void {
    const p = this.getPaths().bookmarks
    if (p) writeFileSync(p, JSON.stringify(this.bookmarks, null, 2), 'utf-8')
  }
  private saveGroups(): void {
    const p = this.getPaths().groups
    if (p) writeFileSync(p, JSON.stringify(this.groups, null, 2), 'utf-8')
  }

  // ---- 历史 ----

  addHistory(entry: Omit<CommandHistoryEntry, 'id'>): void {
    this.history.unshift({ ...entry, id: genId() })
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(0, this.maxHistory)
    }
    this.saveHistory()
  }

  getHistory(limit = 50, commandFilter?: string): CommandHistoryEntry[] {
    let list = this.history
    if (commandFilter) {
      list = list.filter(e => e.command.includes(commandFilter))
    }
    return list.slice(0, limit)
  }

  clearHistory(): void {
    this.history = []
    this.saveHistory()
  }

  // ---- 收藏 ----

  addBookmark(bm: Omit<CommandBookmark, 'id' | 'createdAt' | 'usageCount'>): CommandBookmark {
    const entry: CommandBookmark = { ...bm, id: genId(), createdAt: new Date().toISOString(), usageCount: 0 }
    this.bookmarks.push(entry)
    this.saveBookmarks()
    return entry
  }

  useBookmark(id: string): CommandBookmark | undefined {
    const bm = this.bookmarks.find(b => b.id === id)
    if (bm) {
      bm.usageCount++
      this.saveBookmarks()
    }
    return bm
  }

  removeBookmark(id: string): boolean {
    const idx = this.bookmarks.findIndex(b => b.id === id)
    if (idx === -1) return false
    this.bookmarks.splice(idx, 1)
    this.saveBookmarks()
    return true
  }

  getBookmarks(): CommandBookmark[] {
    return [...this.bookmarks].sort((a, b) => b.usageCount - a.usageCount)
  }

  // ---- 分组 ----

  addGroup(name: string): CommandGroup {
    const g: CommandGroup = { id: genId(), name, bookmarkIds: [] }
    this.groups.push(g)
    this.saveGroups()
    return g
  }

  addToGroup(groupId: string, bookmarkId: string): void {
    const g = this.groups.find(g => g.id === groupId)
    if (g && !g.bookmarkIds.includes(bookmarkId)) {
      g.bookmarkIds.push(bookmarkId)
      this.saveGroups()
    }
  }

  removeFromGroup(groupId: string, bookmarkId: string): void {
    const g = this.groups.find(g => g.id === groupId)
    if (g) {
      g.bookmarkIds = g.bookmarkIds.filter(id => id !== bookmarkId)
      this.saveGroups()
    }
  }

  deleteGroup(groupId: string): boolean {
    const idx = this.groups.findIndex(g => g.id === groupId)
    if (idx === -1) return false
    this.groups.splice(idx, 1)
    this.saveGroups()
    return true
  }

  getGroups(): CommandGroup[] {
    return this.groups
  }
}
