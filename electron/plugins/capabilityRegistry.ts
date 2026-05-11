// 能力注册表 — 插件 declares provides / consumes，自动解析依赖
import type { PluginManifest, CapabilityType } from './types'

interface CapabilityEntry {
  type: CapabilityType
  id: string
  description: string
  pluginId: string
}

interface PluginCapabilities {
  pluginId: string
  provides: CapabilityEntry[]
  consumes: Array<{ type: CapabilityType; id: string }>
}

export class CapabilityRegistry {
  private capabilities = new Map<string, CapabilityEntry>()
  private plugins = new Map<string, PluginCapabilities>()

  /** 注册插件的提供的的能力 */
  register(manifest: PluginManifest): void {
    const entries: CapabilityEntry[] = (manifest.provides || []).map(p => ({
      type: p.type,
      id: p.id,
      description: p.description,
      pluginId: manifest.id,
    }))

    this.plugins.set(manifest.id, {
      pluginId: manifest.id,
      provides: entries,
      consumes: manifest.consumes || [],
    })

    for (const entry of entries) {
      const key = `${entry.type}:${entry.id}`
      if (this.capabilities.has(key)) {
        console.warn(`[Capability] ${key} 已被注册，覆盖者: ${manifest.id}`)
      }
      this.capabilities.set(key, entry)
    }
  }

  /** 注销插件的能力 */
  unregister(pluginId: string): void {
    const caps = this.plugins.get(pluginId)
    if (caps) {
      for (const entry of caps.provides) {
        this.capabilities.delete(`${entry.type}:${entry.id}`)
      }
      this.plugins.delete(pluginId)
    }
  }

  /** 检查依赖是否满足 */
  checkDependencies(manifest: PluginManifest): { ok: boolean; missing: string[] } {
    const missing: string[] = []
    for (const dep of manifest.consumes || []) {
      const key = `${dep.type}:${dep.id}`
      if (!this.capabilities.has(key)) {
        missing.push(key)
      }
    }
    return { ok: missing.length === 0, missing }
  }

  /** 按类型查找能力 */
  findByType(type: CapabilityType): CapabilityEntry[] {
    return Array.from(this.capabilities.values()).filter(c => c.type === type)
  }

  /** 获取所有已注册的能力 */
  getAll(): CapabilityEntry[] {
    return Array.from(this.capabilities.values())
  }

  /** 获取插件的依赖树 */
  getDependencyTree(pluginId: string, visited = new Set<string>()): string[] {
    if (visited.has(pluginId)) return []
    visited.add(pluginId)
    const caps = this.plugins.get(pluginId)
    if (!caps) return []
    const deps: string[] = []
    for (const dep of caps.consumes) {
      const key = `${dep.type}:${dep.id}`
      const entry = this.capabilities.get(key)
      if (entry && !visited.has(entry.pluginId)) {
        deps.push(entry.pluginId)
        deps.push(...this.getDependencyTree(entry.pluginId, visited))
      }
    }
    return deps
  }

  /** 拓扑排序 — 返回正确的加载顺序 */
  resolveLoadOrder(pluginIds: string[]): string[] {
    const order: string[] = []
    const visiting = new Set<string>()
    const visited = new Set<string>()

    const visit = (id: string) => {
      if (visited.has(id)) return
      if (visiting.has(id)) {
        console.warn(`[Capability] 循环依赖检测: ${id}`)
        return
      }
      visiting.add(id)
      const caps = this.plugins.get(id)
      if (caps) {
        for (const dep of caps.consumes) {
          const entry = this.capabilities.get(`${dep.type}:${dep.id}`)
          if (entry) visit(entry.pluginId)
        }
      }
      visiting.delete(id)
      visited.add(id)
      order.push(id)
    }

    for (const id of pluginIds) visit(id)
    return order
  }
}
