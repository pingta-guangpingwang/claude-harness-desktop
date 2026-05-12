// PluginManager — 插件生命周期管理（load/enable/disable/uninstall/update）
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join, resolve as pathResolve } from 'path'
import type { PluginManifest, PluginInstance, PluginContext } from './types'
import { CapabilityRegistry } from './capabilityRegistry'
import { createSandbox, loadPluginModule, withTimeout } from './sandbox'

function getPluginsDir(): string {
  try {
    const { app } = require('electron')
    const p = join(app.getPath('userData'), 'plugins')
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
    return p
  } catch { return join(process.cwd(), '.chd', 'plugins') }
}

function getPluginsStatePath(): string {
  return join(getPluginsDir(), '_state.json')
}

interface PluginState {
  plugins: Record<string, { status: string; installedAt: string; enabledAt?: string; version: string }>
}

export class PluginManager {
  private instances = new Map<string, PluginInstance>()
  private registry: CapabilityRegistry
  private statePath: string
  private pluginsDir: string
  private callbacks: {
    registerCommand: (name: string, def: any) => void
    registerAITool: (tool: any) => void
    onStatusChange: (pluginId: string, status: string) => void
  }

  constructor(registry: CapabilityRegistry, callbacks: {
    registerCommand: (name: string, def: any) => void
    registerAITool: (tool: any) => void
    onStatusChange: (pluginId: string, status: string) => void
  }) {
    this.registry = registry
    this.callbacks = callbacks
    this.pluginsDir = getPluginsDir()
    this.statePath = getPluginsStatePath()
  }

  async initialize(): Promise<void> {
    const state = this.loadState()
    const dirs = existsSync(this.pluginsDir)
      ? require('fs').readdirSync(this.pluginsDir, { withFileTypes: true })
          .filter((d: any) => d.isDirectory())
          .map((d: any) => d.name)
      : []

    for (const dir of dirs) {
      const manifestPath = join(this.pluginsDir, dir, 'manifest.json')
      if (!existsSync(manifestPath)) continue
      try {
        const manifest: PluginManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
        const saved = state.plugins[manifest.id]
        this.registry.register(manifest)
        this.instances.set(manifest.id, {
          manifest,
          installPath: join(this.pluginsDir, dir),
          status: (saved?.status as PluginInstance['status']) || 'installed',
          installedAt: saved?.installedAt || new Date().toISOString(),
          enabledAt: saved?.enabledAt,
        })
        if (saved?.status === 'enabled') {
          await this.enablePluginInternal(manifest.id).catch(e =>
            console.error(`[Plugin] 启用 ${manifest.id} 失败:`, e)
          )
        }
      } catch (e) {
        console.error(`[Plugin] 加载 ${dir} 失败:`, e)
      }
    }
  }

  private loadState(): PluginState {
    try {
      if (existsSync(this.statePath)) {
        return JSON.parse(readFileSync(this.statePath, 'utf-8'))
      }
    } catch { /* ignore */ }
    return { plugins: {} }
  }

  private saveState(): void {
    const state: PluginState = { plugins: {} }
    for (const [id, inst] of this.instances) {
      state.plugins[id] = {
        status: inst.status,
        installedAt: inst.installedAt,
        enabledAt: inst.enabledAt,
        version: inst.manifest.version,
      }
    }
    writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf-8')
  }

  /** 安装插件（installPath 是已解压好的目录） */
  async install(installPath: string, manifest: PluginManifest): Promise<void> {
    if (this.instances.has(manifest.id)) {
      throw new Error(`插件 ${manifest.id} 已安装`)
    }

    const { ok, missing } = this.registry.checkDependencies(manifest)
    if (!ok) {
      console.warn(`[Plugin] ${manifest.id} 缺少依赖: ${missing.join(', ')}`)
    }

    const targetDir = join(this.pluginsDir, manifest.id)
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true })
    }

    this.registry.register(manifest)
    const instance: PluginInstance = {
      manifest,
      installPath: targetDir,
      status: 'installed',
      installedAt: new Date().toISOString(),
    }
    this.instances.set(manifest.id, instance)
    this.saveState()

    try {
      const ctx = this.buildContext(instance)
      const mod = loadPluginModule(targetDir, manifest) as any
      instance.mainModule = mod
      if (mod?.onInstall) {
        await withTimeout(mod.onInstall(ctx), 30000, `onInstall ${manifest.id}`)
      }
    } catch (e) {
      instance.status = 'error'
      instance.error = String(e)
      this.saveState()
      throw e
    }
  }

  /** 注册 shim 插件（无需 JS 模块的 npm/pip 等全局安装工具）。如果已有残留则自动清理重装 */
  registerShim(installPath: string, manifest: PluginManifest): PluginInstance {
    // 已存在实例则先清理旧的
    const old = this.instances.get(manifest.id)
    if (old) {
      this.registry.unregister(manifest.id)
      this.instances.delete(manifest.id)
      try { rmSync(old.installPath, { recursive: true, force: true }) } catch { /* 清理失败不阻塞 */ }
    }

    const targetDir = join(this.pluginsDir, manifest.id)
    // 目录存在但实例不存在（上次安装残留）→ 清掉
    if (existsSync(targetDir)) {
      try { rmSync(targetDir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
    mkdirSync(targetDir, { recursive: true })

    this.registry.register(manifest)
    const instance: PluginInstance = {
      manifest,
      installPath: targetDir,
      status: 'enabled',
      installedAt: new Date().toISOString(),
      enabledAt: new Date().toISOString(),
    }
    this.instances.set(manifest.id, instance)
    this.saveState()
    this.callbacks.onStatusChange(manifest.id, 'enabled')
    return instance
  }

  /** 启用插件 */
  async enable(pluginId: string): Promise<void> {
    const inst = this.instances.get(pluginId)
    if (!inst) throw new Error(`插件 ${pluginId} 未安装`)
    if (inst.status === 'enabled') return
    await this.enablePluginInternal(pluginId)
  }

  private async enablePluginInternal(pluginId: string): Promise<void> {
    const inst = this.instances.get(pluginId)
    if (!inst) return

    const { ok, missing } = this.registry.checkDependencies(inst.manifest)
    if (!ok) {
      inst.status = 'error'
      inst.error = `缺少依赖: ${missing.join(', ')}`
      this.saveState()
      return
    }

    try {
      if (!inst.mainModule) {
        inst.mainModule = loadPluginModule(inst.installPath, inst.manifest) as any
      }
      const ctx = this.buildContext(inst)
      if (inst.mainModule?.onEnable) {
        await withTimeout(inst.mainModule.onEnable(ctx), 30000, `onEnable ${pluginId}`)
      }
      inst.status = 'enabled'
      inst.enabledAt = new Date().toISOString()
      inst.error = undefined
      this.saveState()
      this.callbacks.onStatusChange(pluginId, 'enabled')
    } catch (e) {
      inst.status = 'error'
      inst.error = String(e)
      this.saveState()
      throw e
    }
  }

  /** 禁用插件 */
  async disable(pluginId: string): Promise<void> {
    const inst = this.instances.get(pluginId)
    if (!inst) throw new Error(`插件 ${pluginId} 未安装`)

    try {
      if (inst.mainModule?.onDisable) {
        const ctx = this.buildContext(inst)
        await withTimeout(inst.mainModule.onDisable(ctx), 10000, `onDisable ${pluginId}`)
      }
    } catch (e) {
      console.error(`[Plugin] 禁用 ${pluginId} 失败:`, e)
    }

    inst.status = 'disabled'
    this.saveState()
    this.callbacks.onStatusChange(pluginId, 'disabled')
  }

  /** 卸载插件（内置插件不可卸载） */
  async uninstall(pluginId: string): Promise<void> {
    const inst = this.instances.get(pluginId)
    if (!inst) throw new Error(`插件 ${pluginId} 未安装`)
    if (inst.builtin || inst.manifest.builtin) {
      throw new Error(`系统内置插件 ${pluginId} 不可卸载`)
    }

    try {
      if (inst.mainModule?.onUninstall) {
        const ctx = this.buildContext(inst)
        await withTimeout(inst.mainModule.onUninstall(ctx), 10000, `onUninstall ${pluginId}`)
      }
    } catch (e) {
      console.error(`[Plugin] 卸载 ${pluginId} 失败:`, e)
    }

    this.registry.unregister(pluginId)
    this.instances.delete(pluginId)
    this.saveState()

    try {
      rmSync(inst.installPath, { recursive: true, force: true })
    } catch { /* 清理文件失败不阻塞 */ }
  }

  /** 注册系统内置插件（虚拟，无安装目录） */
  registerBuiltin(manifest: PluginManifest): void {
    manifest.builtin = true
    this.registry.register(manifest)
    this.instances.set(manifest.id, {
      manifest,
      installPath: '',
      status: 'enabled',
      builtin: true,
      installedAt: new Date().toISOString(),
      enabledAt: new Date().toISOString(),
    })
  }

  /** 更新插件 */
  async update(pluginId: string, newManifest: PluginManifest, newPath: string): Promise<void> {
    const prev = this.instances.get(pluginId)
    if (!prev) throw new Error(`插件 ${pluginId} 未安装`)

    const prevVersion = prev.manifest.version
    const prevPath = prev.installPath
    await this.disable(pluginId)

    this.registry.unregister(pluginId)
    this.registry.register(newManifest)

    prev.manifest = newManifest
    prev.installPath = newPath
    prev.mainModule = undefined

    try {
      prev.mainModule = loadPluginModule(newPath, newManifest) as any
      if (prev.mainModule?.onUpdate) {
        const ctx = this.buildContext(prev)
        await withTimeout(prev.mainModule.onUpdate(ctx, prevVersion), 30000, `onUpdate ${pluginId}`)
      }
    } catch (e) {
      prev.status = 'error'
      prev.error = String(e)
      this.saveState()
      throw e
    }

    await this.enablePluginInternal(pluginId)
    this.saveState()
  }

  getInstance(pluginId: string): PluginInstance | undefined {
    return this.instances.get(pluginId)
  }

  getAll(): PluginInstance[] {
    return Array.from(this.instances.values())
  }

  private buildContext(inst: PluginInstance): PluginContext {
    const cfg: Record<string, unknown> = {}
    const configPath = join(inst.installPath, 'config.json')
    if (existsSync(configPath)) {
      try { Object.assign(cfg, JSON.parse(readFileSync(configPath, 'utf-8'))) } catch { /* ignore */ }
    }

    return {
      manifest: inst.manifest,
      installPath: inst.installPath,
      config: cfg,
      getConfig: () => {
        try {
          if (existsSync(configPath)) return JSON.parse(readFileSync(configPath, 'utf-8'))
        } catch { /* ignore */ }
        return {}
      },
      setConfig: (c: Record<string, unknown>) => {
        writeFileSync(configPath, JSON.stringify(c, null, 2), 'utf-8')
      },
      log: (msg: string) => console.log(`[Plugin:${inst.manifest.id}] ${msg}`),
      api: createSandbox(inst.manifest, inst.installPath, this.callbacks),
    }
  }
}
