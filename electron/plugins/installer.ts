// PluginInstaller — 下载/校验/解压/安装插件
import { mkdirSync, existsSync, createWriteStream, readFileSync } from 'fs'
import { join } from 'path'
import * as crypto from 'crypto'
// @ts-ignore — adm-zip types are bundled
import AdmZip from 'adm-zip'
import type { PluginManifest } from './types'

function getDownloadDir(): string {
  try {
    const { app } = require('electron')
    const p = join(app.getPath('userData'), 'downloads')
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
    return p
  } catch { return join(process.cwd(), '.chd', 'downloads') }
}

function getPluginsDir(): string {
  try {
    const { app } = require('electron')
    const p = join(app.getPath('userData'), 'plugins')
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
    return p
  } catch { return join(process.cwd(), '.chd', 'plugins') }
}

interface InstallResult {
  success: boolean
  installPath?: string
  manifest?: PluginManifest
  error?: string
}

export class PluginInstaller {
  /** 校验插件清单 */
  validateManifest(manifest: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    const m = manifest as any
    if (!m || typeof m !== 'object') { errors.push('manifest 必须是对象'); return { valid: false, errors } }
    if (!m.id || typeof m.id !== 'string') errors.push('缺少 id')
    if (!m.name || typeof m.name !== 'string') errors.push('缺少 name')
    if (!m.version || typeof m.version !== 'string') errors.push('缺少 version')
    if (!Array.isArray(m.provides)) errors.push('provides 必须是数组')
    return { valid: errors.length === 0, errors }
  }

  /** 校验 SHA-256 */
  verifyChecksum(filePath: string, expected: string): boolean {
    const data = readFileSync(filePath)
    const hash = crypto.createHash('sha256').update(data).digest('hex')
    return hash === expected.toLowerCase()
  }

  /** 从本地 zip 文件安装插件 */
  installFromZip(zipPath: string): InstallResult {
    try {
      const zip = new AdmZip(zipPath)
      const entries = zip.getEntries()

      const manifestEntry = entries.find(
        (e: any) => e.entryName === 'manifest.json' || e.entryName.endsWith('/manifest.json')
      )
      if (!manifestEntry) {
        return { success: false, error: '未找到 manifest.json' }
      }

      const manifestJson = JSON.parse(manifestEntry.getData().toString('utf-8'))
      const validation = this.validateManifest(manifestJson)
      if (!validation.valid) {
        return { success: false, error: `manifest 无效: ${validation.errors.join(', ')}` }
      }

      const manifest: PluginManifest = manifestJson
      const installDir = join(getPluginsDir(), manifest.id)
      if (existsSync(installDir)) {
        return { success: false, error: `插件 ${manifest.id} 已存在，如需更新请使用更新接口` }
      }

      mkdirSync(installDir, { recursive: true })
      zip.extractAllTo(installDir, true)

      return { success: true, installPath: installDir, manifest }
    } catch (e) {
      return { success: false, error: `解压失败: ${String(e)}` }
    }
  }

  /** 从 URL 下载并安装插件 */
  async installFromUrl(url: string, expectedChecksum?: string, onProgress?: (pct: number, loaded: number, total: number) => void): Promise<InstallResult> {
    const dlDir = getDownloadDir()
    const fileName = `plugin-${Date.now()}.zip`
    const tmpPath = join(dlDir, fileName)

    try {
      const res = await fetch(url)
      if (!res.ok) {
        return { success: false, error: `下载失败: HTTP ${res.status}` }
      }

      const contentLength = Number(res.headers.get('content-length')) || 0
      const reader = res.body!.getReader()
      const chunks: Uint8Array[] = []
      let loaded = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded += value.length
        if (contentLength > 0 && onProgress) {
          onProgress(Math.round((loaded / contentLength) * 100), loaded, contentLength)
        }
      }

      const writer = createWriteStream(tmpPath)
      for (const chunk of chunks) {
        writer.write(Buffer.from(chunk))
      }
      writer.end()
      await new Promise<void>((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
      })

      if (expectedChecksum && !this.verifyChecksum(tmpPath, expectedChecksum)) {
        return { success: false, error: 'SHA-256 校验失败' }
      }

      return this.installFromZip(tmpPath)
    } catch (e) {
      return { success: false, error: `安装失败: ${String(e)}` }
    }
  }
}
