// VersionManager — 插件版本追踪与回滚
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync, copyFileSync } from 'fs'
import { join } from 'path'
import type { PluginManifest } from './types'

interface VersionEntry {
  version: string
  installedAt: string
  backupPath: string
  checksum?: string
}

interface VersionRegistry {
  [pluginId: string]: VersionEntry[]
}

function getHistoryDir(): string {
  try {
    const { app } = require('electron')
    const p = join(app.getPath('userData'), 'versions')
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
    return p
  } catch { return join(process.cwd(), '.chd', 'versions') }
}

function getRegistryPath(): string {
  return join(getHistoryDir(), '_registry.json')
}

export class VersionManager {
  private maxVersions: number
  private registry: VersionRegistry = {}

  constructor(maxVersions = 3) {
    this.maxVersions = maxVersions
    this.loadRegistry()
  }

  private loadRegistry(): void {
    const p = getRegistryPath()
    try {
      if (existsSync(p)) {
        this.registry = JSON.parse(readFileSync(p, 'utf-8'))
      }
    } catch { /* ignore */ }
  }

  private saveRegistry(): void {
    writeFileSync(getRegistryPath(), JSON.stringify(this.registry, null, 2), 'utf-8')
  }

  /** 保存插件当前版本快照 */
  backupVersion(pluginId: string, version: string, installPath: string, checksum?: string): void {
    const versions = this.registry[pluginId] || []
    const backupDir = getHistoryDir()
    const backupPath = join(backupDir, `${pluginId}_${version}_${Date.now()}`)

    // 复制当前文件到备份目录
    if (existsSync(installPath)) {
      mkdirSync(backupPath, { recursive: true })
      this.copyDir(installPath, backupPath)
    }

    versions.push({
      version,
      installedAt: new Date().toISOString(),
      backupPath,
      checksum,
    })

    // 保留最近 N 个版本
    if (versions.length > this.maxVersions) {
      const removed = versions.splice(0, versions.length - this.maxVersions)
      for (const r of removed) {
        try { rmSync(r.backupPath, { recursive: true, force: true }) } catch { /* ignore */ }
      }
    }

    this.registry[pluginId] = versions
    this.saveRegistry()
  }

  /** 回滚插件到指定版本 */
  async rollback(pluginId: string, targetVersion: string): Promise<{
    success: boolean
    backupPath?: string
    manifest?: PluginManifest
    error?: string
  }> {
    const versions = this.registry[pluginId]
    if (!versions || versions.length === 0) {
      return { success: false, error: `插件 ${pluginId} 无历史版本` }
    }

    const entry = versions.find(v => v.version === targetVersion)
    if (!entry) {
      return { success: false, error: `版本 ${targetVersion} 不存在` }
    }

    if (!existsSync(entry.backupPath)) {
      return { success: false, error: `备份文件丢失: ${entry.backupPath}` }
    }

    const manifestPath = join(entry.backupPath, 'manifest.json')
    if (!existsSync(manifestPath)) {
      return { success: false, error: '备份中无 manifest.json' }
    }

    let manifest: PluginManifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch {
      return { success: false, error: 'manifest.json 解析失败' }
    }

    return { success: true, backupPath: entry.backupPath, manifest }
  }

  /** 获取插件的版本历史 */
  getHistory(pluginId: string): VersionEntry[] {
    return this.registry[pluginId] || []
  }

  /** 清理插件所有历史版本 */
  clearHistory(pluginId: string): void {
    const versions = this.registry[pluginId]
    if (versions) {
      for (const v of versions) {
        try { rmSync(v.backupPath, { recursive: true, force: true }) } catch { /* ignore */ }
      }
      delete this.registry[pluginId]
      this.saveRegistry()
    }
  }

  private copyDir(src: string, dest: string): void {
    mkdirSync(dest, { recursive: true })
    const entries = require('fs').readdirSync(src, { withFileTypes: true })
    for (const entry of entries) {
      const srcPath = join(src, entry.name)
      const destPath = join(dest, entry.name)
      if (entry.isDirectory()) {
        this.copyDir(srcPath, destPath)
      } else {
        copyFileSync(srcPath, destPath)
      }
    }
  }
}
