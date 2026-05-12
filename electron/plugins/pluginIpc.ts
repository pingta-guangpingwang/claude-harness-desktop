// PluginIPC — 插件管理 IPC 桥接
import { join } from 'path'
import { ipcMain, BrowserWindow } from 'electron'
import { PluginManager } from './manager'
import { PluginInstaller } from './installer'
import { VersionManager } from './versionManager'
import { CapabilityRegistry } from './capabilityRegistry'
import { RendererBridge } from './rendererBridge'
import { installPluginFromCatalog, type InstallProgress, type PluginProvides } from './pluginExec'
import { registerBuiltTool } from '../harnessAgent/toolRegistry'
import type { PluginManifest } from './types'
import type { CommandDefinition } from '../cli/types'

let manager: PluginManager | null = null
let installer: PluginInstaller | null = null
let versionMgr: VersionManager | null = null
let capabilityRegistry: CapabilityRegistry | null = null
let rendererBridge: RendererBridge | null = null
let _commandRegistry: { register(cmd: CommandDefinition): void; unregister(name: string): boolean } | null = null

export function getPluginManager(): PluginManager | null { return manager }
export function getCapabilityRegistry(): CapabilityRegistry | null { return capabilityRegistry }
export function getRendererBridge(): RendererBridge | null { return rendererBridge }
export function getVersionManager(): VersionManager | null { return versionMgr }
export function getPluginInstaller(): PluginInstaller | null { return installer }
export function setCommandRegistry(reg: { register(cmd: CommandDefinition): void; unregister(name: string): boolean }): void { _commandRegistry = reg }

function getPluginsDir(): string {
  try {
    const { app } = require('electron')
    return require('path').join(app.getPath('userData'), 'plugins')
  } catch { return require('path').join(process.cwd(), '.chd', 'plugins') }
}

export function registerPluginCapabilities(pluginId: string, provides: PluginProvides[], binaryPath: string): void {
  for (const p of provides) {
    if (p.type === 'command' && p.commandTemplate && _commandRegistry) {
      _commandRegistry.register({
        name: p.id,
        description: p.description,
        category: 'custom',
        execute: async (args: Record<string, unknown>) => {
          const { execSync } = require('child_process')
          let cmd = p.commandTemplate!
          for (const [k, v] of Object.entries(args)) {
            cmd = cmd.replace(`{${k}}`, String(v))
          }
          try {
            const output = execSync(cmd, { encoding: 'utf-8', timeout: 120000, cwd: process.cwd() })
            return { success: true, output }
          } catch (e: any) {
            return { success: false, output: e.stderr || e.message || String(e) }
          }
        },
      })
    }
    if (p.type === 'ai.tool') {
      registerBuiltTool({
        name: p.id,
        description: p.description,
        parameters: (p.toolParams || { type: 'object', properties: {} }) as Record<string, unknown>,
        group: 'execute',
        core: false, // 插件工具按需发现
        isReadOnly: false,
        execute: async (args: Record<string, unknown>) => {
          const { execSync } = require('child_process')
          let cmd = p.commandTemplate || binaryPath
          for (const [k, v] of Object.entries(args)) {
            cmd = cmd.replace(`{${k}}`, String(v))
          }
          try {
            const output = execSync(cmd, { encoding: 'utf-8', timeout: 120000, cwd: process.cwd() })
            return { success: true, output }
          } catch (e: any) {
            return { success: false, output: e.stderr || e.message || String(e) }
          }
        },
      })
    }
  }
}

export function registerPluginIpc(mainWindow: BrowserWindow): void {
  capabilityRegistry = new CapabilityRegistry()
  installer = new PluginInstaller()
  versionMgr = new VersionManager(3)
  rendererBridge = new RendererBridge()

  manager = new PluginManager(capabilityRegistry, {
    registerCommand: (name, def) => {
      // 插件注册的命令通过 cli registry 注册 — 此处推送到渲染进程通知
      mainWindow.webContents.send('plugin:command-registered', { name, pluginId: def._pluginId })
    },
    registerAITool: (tool) => {
      mainWindow.webContents.send('plugin:tool-registered', { name: tool.name, pluginId: tool._pluginId })
    },
    onStatusChange: (pluginId, status) => {
      mainWindow.webContents.send('plugin:status-changed', { pluginId, status })
    },
  })

  // ---- 插件管理 ----
  ipcMain.handle('plugin:install-from-zip', async (_e, zipPath: string) => {
    if (!installer) return { success: false, error: 'Installer not initialized' }
    const result = installer.installFromZip(zipPath)
    if (result.success && result.manifest && result.installPath) {
      try {
        await manager!.install(result.installPath, result.manifest)
        versionMgr!.backupVersion(result.manifest.id, result.manifest.version, result.installPath)
        return { success: true, pluginId: result.manifest.id }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }
    return result
  })

  ipcMain.handle('plugin:install-from-url', async (_e, url: string, checksum?: string) => {
    if (!installer) return { success: false, error: 'Installer not initialized' }
    const result = await installer.installFromUrl(url, checksum, (pct, loaded, total) => {
      mainWindow.webContents.send('plugin:install-progress', { url, pct, loaded, total })
    })
    if (result.success && result.manifest && result.installPath) {
      try {
        await manager!.install(result.installPath, result.manifest)
        versionMgr!.backupVersion(result.manifest.id, result.manifest.version, result.installPath)
        mainWindow.webContents.send('plugin:install-progress', { url, pct: 100, loaded: 0, total: 0, done: true })
        return { success: true, pluginId: result.manifest.id }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }
    return result
  })

  // ── 从目录安装（npm/pip 等真实包安装）──
  ipcMain.handle('plugin:install-catalog', async (_e, payload: {
    pluginId: string; pluginName: string; pluginIcon: string
    pluginDesc: string; pluginAuthor: string
    installSpec: import('./pluginExec').InstallSpec
    provides: import('./pluginExec').PluginProvides[]
  }) => {
    const { pluginId, pluginName, pluginIcon, pluginDesc, pluginAuthor, installSpec, provides } = payload
    const result = await installPluginFromCatalog(
      pluginId, pluginName, pluginIcon, pluginDesc, pluginAuthor,
      installSpec, provides,
      (progress: InstallProgress) => {
        mainWindow.webContents.send('plugin:install-progress', {
          pluginId, pct: progress.pct, phase: progress.phase, message: progress.message,
        })
      }
    )
    if (result.success) {
      try {
        // 生成标准 manifest 并用 shim 模式注册（不需要 index.js）
        const manifest: PluginManifest = {
          id: pluginId,
          name: pluginName,
          version: result.version || '0.0.0',
          description: pluginDesc,
          author: pluginAuthor,
          icon: pluginIcon,
          provides: provides.map(p => ({
            type: p.type === 'command' ? 'command' : 'ai.tool',
            id: p.id,
            description: p.description,
          })),
        }
        manager!.registerShim(join(getPluginsDir(), pluginId), manifest)
        // 注册 CLI 命令 + AI 工具
        registerPluginCapabilities(pluginId, provides, result.binaryPath || '')
        mainWindow.webContents.send('plugin:install-progress', { pluginId, pct: 100, phase: 'done', done: true })
        return { success: true, pluginId, binaryPath: result.binaryPath, version: result.version }
      } catch (e) {
        return { success: false, error: `注册失败: ${String(e)}` }
      }
    }
    return result
  })

  ipcMain.handle('plugin:enable', async (_e, pluginId: string) => {
    try {
      await manager!.enable(pluginId)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('plugin:disable', async (_e, pluginId: string) => {
    try {
      await manager!.disable(pluginId)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('plugin:uninstall', async (_e, pluginId: string) => {
    try {
      await manager!.uninstall(pluginId)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('plugin:update', async (_e, pluginId: string, zipPath: string) => {
    if (!installer) return { success: false, error: 'Installer not initialized' }
    const result = installer.installFromZip(zipPath)
    if (result.success && result.manifest && result.installPath) {
      try {
        versionMgr!.backupVersion(pluginId, manager!.getInstance(pluginId)!.manifest.version, manager!.getInstance(pluginId)!.installPath)
        await manager!.update(pluginId, result.manifest, result.installPath)
        return { success: true, pluginId }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }
    return result
  })

  ipcMain.handle('plugin:list', () => {
    return manager?.getAll().map(i => ({
      id: i.manifest.id,
      name: i.manifest.name,
      version: i.manifest.version,
      description: i.manifest.description,
      author: i.manifest.author,
      icon: i.manifest.icon,
      status: i.status,
      builtin: i.builtin || i.manifest.builtin || false,
      provides: i.manifest.provides || [],
      error: i.error,
      installedAt: i.installedAt,
      enabledAt: i.enabledAt,
    })) || []
  })

  ipcMain.handle('plugin:get', (_e, pluginId: string) => {
    const inst = manager?.getInstance(pluginId)
    if (!inst) return null
    return {
      id: inst.manifest.id,
      name: inst.manifest.name,
      version: inst.manifest.version,
      description: inst.manifest.description,
      author: inst.manifest.author,
      permissions: inst.manifest.permissions || [],
      provides: inst.manifest.provides || [],
      consumes: inst.manifest.consumes || [],
      status: inst.status,
      builtin: inst.builtin || inst.manifest.builtin || false,
      error: inst.error,
      installedAt: inst.installedAt,
      enabledAt: inst.enabledAt,
    }
  })

  // ---- 版本管理 ----
  ipcMain.handle('plugin:version-history', (_e, pluginId: string) => {
    return versionMgr?.getHistory(pluginId) || []
  })

  ipcMain.handle('plugin:rollback', async (_e, pluginId: string, targetVersion: string) => {
    const result = await versionMgr!.rollback(pluginId, targetVersion)
    if (result.success && result.manifest && result.backupPath) {
      await manager!.update(pluginId, result.manifest, result.backupPath)
      return { success: true }
    }
    return result
  })

  // ---- 能力注册表 ----
  ipcMain.handle('plugin:capabilities', () => {
    return capabilityRegistry?.getAll().map(c => ({
      type: c.type,
      id: c.id,
      description: c.description,
      pluginId: c.pluginId,
    })) || []
  })

  ipcMain.handle('plugin:capabilities-by-type', (_e, type: string) => {
    return capabilityRegistry?.findByType(type as any).map(c => ({
      type: c.type,
      id: c.id,
      description: c.description,
      pluginId: c.pluginId,
    })) || []
  })

  // ---- 渲染桥接 ----
  ipcMain.handle('plugin:renderer-slots', () => {
    return rendererBridge?.getSlots() || []
  })

  ipcMain.handle('plugin:renderer-components', (_e, slotId: string) => {
    return rendererBridge?.getSlotComponents(slotId) || []
  })

  // ---- 清单校验 ----
  ipcMain.handle('plugin:validate-manifest', (_e, manifest: unknown) => {
    return installer?.validateManifest(manifest) || { valid: false, errors: ['Installer not initialized'] }
  })

  // 初始化已安装插件
  manager!.initialize().then(() => {
    console.log('[PluginIPC] 插件初始化完成')
    registerBuiltinPlugins()
  }).catch(e => {
    console.error('[PluginIPC] 插件初始化失败:', e)
  })

  /** 注册系统内置插件 — 不可卸载，始终启用 */
  function registerBuiltinPlugins(): void {
    const builtins: PluginManifest[] = [
      {
        id: 'system-harness-agent',
        name: '驾驭智能体核心',
        version: '3.6.0',
        description: 'CEO 总控智能体：任务派发、项目监控、验收审查、启动脚本生成',
        author: 'CHD System',
        icon: '🛡️',
        builtin: true,
        provides: [
          { type: 'ai.tool', id: 'wake_projects', description: '启动项目 Claude Code 终端' },
          { type: 'ai.tool', id: 'stop_projects', description: '停止项目终端' },
          { type: 'ai.tool', id: 'check_status', description: '检查全部项目状态' },
          { type: 'ai.tool', id: 'broadcast', description: '向全部在线项目广播消息' },
          { type: 'ai.tool', id: 'task_project', description: '向指定项目 AI 派发任务' },
          { type: 'ai.tool', id: 'poll_projects', description: '低开销轮询全部项目进展' },
          { type: 'ai.tool', id: 'verify_project', description: '验收项目工作成果(lint/typecheck/audit/test)' },
          { type: 'ai.tool', id: 'generate_launch_scripts', description: '生成一键启动 .bat 脚本' },
          { type: 'ai.tool', id: 'health_report', description: '生成项目体检报告' },
          { type: 'ai.tool', id: 'install_plugin', description: '从插件商店安装插件' },
          { type: 'ai.tool', id: 'list_available_plugins', description: '浏览插件商店' },
        ],
      },
      {
        id: 'system-project-launcher',
        name: '项目一键启动',
        version: '3.6.0',
        description: '自动检测项目类型，生成 .dbvs-launch.bat 一键启动脚本',
        author: 'CHD System',
        icon: '🚀',
        builtin: true,
        provides: [
          { type: 'ai.tool', id: 'generate_launch_scripts', description: '生成一键启动脚本' },
          { type: 'command', id: 'project:check-launch-bat', description: '检查启动脚本是否存在' },
          { type: 'command', id: 'project:generate-launch-bat', description: '生成单项目启动脚本' },
          { type: 'command', id: 'project:launch', description: '执行启动脚本' },
        ],
      },
      {
        id: 'system-pty-manager',
        name: '终端管理器',
        version: '3.6.0',
        description: '多项目 PTY 终端管理：启动/停止/读写/心跳监控',
        author: 'CHD System',
        icon: '💻',
        builtin: true,
        provides: [
          { type: 'command', id: 'pty:spawn', description: '启动项目终端' },
          { type: 'command', id: 'pty:write', description: '向终端写入命令' },
          { type: 'command', id: 'pty:kill', description: '终止终端进程' },
          { type: 'command', id: 'pty:status', description: '查询终端状态' },
        ],
      },
      {
        id: 'system-sandbox',
        name: '版本沙箱',
        version: '3.6.0',
        description: '任务快照/提交/回滚，保护项目代码安全',
        author: 'CHD System',
        icon: '📦',
        builtin: true,
        provides: [
          { type: 'command', id: 'sandbox:snapshot', description: '任务前创建快照' },
          { type: 'command', id: 'sandbox:commit', description: '任务完成提交' },
          { type: 'command', id: 'sandbox:rollback', description: '回滚到快照' },
          { type: 'command', id: 'sandbox:history', description: '查看快照历史' },
        ],
      },
      {
        id: 'system-middleware-bridge',
        name: '中间件桥接',
        version: '3.6.0',
        description: 'AI 中间件通信：Agent 注册/技能调度/熔断器',
        author: 'CHD System',
        icon: '🌉',
        builtin: true,
        provides: [
          { type: 'command', id: 'middleware:start', description: '启动中间件' },
          { type: 'command', id: 'middleware:stop', description: '停止中间件' },
          { type: 'command', id: 'middleware:health', description: '中间件健康检查' },
          { type: 'ai.tool', id: 'middleware_register_skill', description: '注册 AI 技能到中间件' },
        ],
      },
      {
        id: 'system-cli-hub',
        name: 'CLI 命令中枢',
        version: '3.6.0',
        description: '自定义命令注册/别名/批量编排/权限分级/收藏分组',
        author: 'CHD System',
        icon: '⚡',
        builtin: true,
        provides: [
          { type: 'command', id: 'cli:execute', description: '执行 CLI 命令' },
          { type: 'command', id: 'cli:list', description: '列出所有命令' },
          { type: 'command', id: 'cli:batch', description: '批量执行命令' },
          { type: 'command', id: 'cli:alias', description: '别名管理' },
        ],
      },
    ]

    for (const b of builtins) {
      try {
        // 检查是否已存在则不重复注册
        if (manager!.getInstance(b.id)) continue
        manager!.registerBuiltin(b)
      } catch (e) {
        console.error(`[PluginIPC] 注册内置插件 ${b.id} 失败:`, e)
      }
    }
    console.log(`[PluginIPC] 已注册 ${builtins.length} 个系统内置插件`)
  }
}
