// CLI 别名解析器
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { AliasEntry } from './types'

function getDataDir(): string {
  try {
    const { app } = require('electron')
    const p = app.getPath('userData')
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
    return p
  } catch { return '' }
}

const ALIASES_PATH = '' // lazy init in load()

export class AliasResolver {
  private aliases: Map<string, AliasEntry> = new Map()

  constructor() {
    this.load()
  }

  private getPath(): string {
    if (ALIASES_PATH) return ALIASES_PATH
    return join(getDataDir(), 'aliases.json')
  }

  load(): void {
    try {
      const p = this.getPath()
      if (p && existsSync(p)) {
        const data: AliasEntry[] = JSON.parse(readFileSync(p, 'utf-8'))
        this.aliases = new Map(data.map(a => [a.alias, a]))
      }
    } catch { /* 忽略文件损坏 */ }
  }

  save(): void {
    const p = this.getPath()
    if (!p) return
    const list = Array.from(this.aliases.values())
    writeFileSync(p, JSON.stringify(list, null, 2), 'utf-8')
  }

  addAlias(entry: AliasEntry): void {
    this.aliases.set(entry.alias, entry)
    this.save()
  }

  removeAlias(alias: string): boolean {
    const ok = this.aliases.delete(alias)
    if (ok) this.save()
    return ok
  }

  getAll(): AliasEntry[] {
    return Array.from(this.aliases.values())
  }

  /** 解析输入字符串中的别名，返回展开后的字符串 */
  resolve(input: string): string {
    const parts = input.trim().split(/\s+/)
    const first = parts[0].toLowerCase()
    const alias = this.aliases.get(first)
    if (!alias) return input
    const rest = parts.slice(1).join(' ')
    return alias.expandsTo + (rest ? ' ' + rest : '')
  }
}
