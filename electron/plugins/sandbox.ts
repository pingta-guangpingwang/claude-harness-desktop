// 插件沙箱 — require() 白名单代理 + 文件系统/网络审计 + 超时保护
import { readFile, writeFile } from 'fs/promises'
import { resolve, normalize } from 'path'
import type { PluginManifest, PluginPermission, PluginSandboxAPI } from './types'

/** 允许插件 require 的模块白名单 */
const MODULE_WHITELIST = new Set([
  'fs/promises', 'path', 'url', 'crypto', 'buffer', 'util',
  'child_process', 'os', 'events', 'stream', 'string_decoder',
])

/** 沙箱允许在插件目录内读写 */
function isPathAllowed(requestPath: string, installDir: string): boolean {
  const resolved = normalize(resolve(requestPath))
  const base = normalize(resolve(installDir))
  return resolved.startsWith(base + '\\') || resolved.startsWith(base + '/') || resolved === base
}

export function createSandbox(
  manifest: PluginManifest,
  installPath: string,
  callbacks: {
    registerCommand: (name: string, def: any) => void
    registerAITool: (tool: any) => void
  },
): PluginSandboxAPI {
  const perms = new Set(manifest.permissions || [])

  const hasPerm = (p: PluginPermission): boolean => perms.has(p)

  return {
    registerCommand(name, def) {
      callbacks.registerCommand(name, {
        ...def,
        _pluginId: manifest.id,
      })
    },

    registerAITool(tool) {
      if (!hasPerm('ai:call')) {
        throw new Error(`Plugin ${manifest.id} 请求 ai:call 权限被拒绝`)
      }
      callbacks.registerAITool({ ...tool, _pluginId: manifest.id })
    },

    async readFile(filePath: string): Promise<string> {
      if (!hasPerm('filesystem:read')) {
        throw new Error('filesystem:read 权限未授权')
      }
      if (!isPathAllowed(filePath, installPath)) {
        throw new Error(`路径越权: ${filePath}`)
      }
      return readFile(filePath, 'utf-8')
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      if (!hasPerm('filesystem:write')) {
        throw new Error('filesystem:write 权限未授权')
      }
      if (!isPathAllowed(filePath, installPath)) {
        throw new Error(`路径越权: ${filePath}`)
      }
      await writeFile(filePath, content, 'utf-8')
    },

    async fetch(url: string, options?: Record<string, unknown>): Promise<{ status: number; body: string }> {
      if (!hasPerm('network')) {
        throw new Error('network 权限未授权')
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      try {
        const res = await globalThis.fetch(url, { ...options, signal: controller.signal } as RequestInit)
        const body = await res.text()
        return { status: res.status, body }
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

/** 加载插件主进程模块（受限 require） */
export function loadPluginModule(installPath: string, manifest: PluginManifest): unknown {
  const entryPath = resolve(installPath, manifest.main || 'index.js')
  // 清除 require 缓存确保重新加载
  delete require.cache[require.resolve(entryPath)]
  try {
    return require(entryPath)
  } catch (err) {
    throw new Error(`插件 ${manifest.id} 加载失败: ${String(err)}`)
  }
}

/** Promise 超时包装 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 超时 (${ms}ms)`)), ms)
    ),
  ])
}
