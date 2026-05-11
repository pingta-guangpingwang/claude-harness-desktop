// RendererBridge — 动态加载插件渲染层组件到 UI
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { PluginManifest } from './types'

interface RendererSlot {
  slotId: string
  pluginId: string
  componentId: string
  props?: Record<string, unknown>
}

interface RenderedComponent {
  pluginId: string
  slotId: string
  html: string
  css: string
  script: string
}

export class RendererBridge {
  private slots = new Map<string, RendererSlot[]>()

  /** 注册插件渲染组件到指定槽位 */
  registerSlot(pluginId: string, slotId: string, componentId: string, props?: Record<string, unknown>): void {
    const entry: RendererSlot = { slotId, pluginId, componentId, props }
    const existing = this.slots.get(slotId) || []
    existing.push(entry)
    this.slots.set(slotId, existing)
  }

  /** 注销插件的所有渲染槽位 */
  unregisterPlugin(pluginId: string): void {
    for (const [slotId, entries] of this.slots) {
      this.slots.set(slotId, entries.filter(e => e.pluginId !== pluginId))
    }
  }

  /** 获取指定槽位的所有渲染组件 */
  getSlotComponents(slotId: string): RenderedComponent[] {
    const entries = this.slots.get(slotId) || []
    return entries.map(e => this.loadComponent(e.pluginId, e.componentId)).filter(Boolean) as RenderedComponent[]
  }

  /** 获取所有已注册槽位的 ID */
  getSlots(): string[] {
    return Array.from(this.slots.keys())
  }

  /** 加载插件的渲染组件内容 */
  private loadComponent(pluginId: string, componentId: string): RenderedComponent | null {
    const pluginsDir = this.getPluginsDir()
    const base = join(pluginsDir, pluginId, 'renderer', componentId)
    try {
      const htmlPath = `${base}.html`
      const cssPath = `${base}.css`
      const jsPath = `${base}.js`

      return {
        pluginId,
        slotId: '',
        html: existsSync(htmlPath) ? readFileSync(htmlPath, 'utf-8') : '',
        css: existsSync(cssPath) ? readFileSync(cssPath, 'utf-8') : '',
        script: existsSync(jsPath) ? readFileSync(jsPath, 'utf-8') : '',
      }
    } catch {
      return null
    }
  }

  private getPluginsDir(): string {
    try {
      const { app } = require('electron')
      return join(app.getPath('userData'), 'plugins')
    } catch {
      return join(process.cwd(), '.chd', 'plugins')
    }
  }
}
