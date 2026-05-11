// CLI 命令系统 IPC 桥接
import { ipcMain, BrowserWindow } from 'electron'
import { CommandRegistry } from './registry'
import { BatchRunner } from './batchRunner'
import { AliasResolver } from './aliasResolver'
import { createBuiltinCommands } from './builtinCommands'
import { setCommandRegistry } from '../plugins/pluginIpc'
import type { CommandContext, BatchTask } from './types'

let mainWindow: BrowserWindow | null = null
let registry: CommandRegistry
let batchRunner: BatchRunner
let aliasResolver: AliasResolver

export function registerCliIpc(window: BrowserWindow) {
  mainWindow = window

  registry = new CommandRegistry()
  setCommandRegistry(registry)  // 允许插件系统注册命令
  batchRunner = new BatchRunner()
  aliasResolver = new AliasResolver()

  // 注册内置命令
  for (const cmd of createBuiltinCommands()) {
    registry.register(cmd)
  }

  // 权限确认回调：UI 弹窗
  registry.permissionGate.onConfirm(async (command, level) => {
    if (!mainWindow) return false
    return new Promise(resolve => {
      const handler = (_event: any, decision: boolean) => {
        ipcMain.removeListener('cli:permission-response', handler)
        resolve(decision)
      }
      ipcMain.once('cli:permission-response', handler)
      mainWindow!.webContents.send('cli:permission-needed', { command, level })
      // 30s 超时自动拒绝
      setTimeout(() => {
        ipcMain.removeListener('cli:permission-response', handler)
        resolve(false)
      }, 30000)
    })
  })

  // 搜索命令
  ipcMain.handle('cli:search', async (_event, query: string) => {
    const cmds = registry.search(query)
    return {
      success: true,
      commands: cmds.map(c => ({
        name: c.name,
        description: c.description,
        summary: c.summary,
        category: c.category,
        aliases: c.aliases,
        params: c.params,
        permission: c.permission || 'user',
      })),
    }
  })

  // 列出所有命令
  ipcMain.handle('cli:list', async () => {
    const cmds = registry.getAll()
    return {
      success: true,
      commands: cmds.map(c => ({
        name: c.name,
        description: c.description,
        summary: c.summary,
        category: c.category,
        aliases: c.aliases,
        params: c.params,
        permission: c.permission || 'user',
      })),
    }
  })

  // 执行命令
  ipcMain.handle('cli:execute', async (_event, request: {
    command: string
    args: Record<string, unknown>
    projectIds: string[]
    projectNames: Record<string, string>
    projectPath?: string
    apiKey?: string
    model?: string
  }) => {
    // 别名解析
    const resolved = aliasResolver.resolve(request.command)
    const parsed = registry.parse(request.command)
    const cmdName = parsed ? parsed.name : request.command

    const ctx: CommandContext = {
      projectPath: request.projectPath,
      projectIds: request.projectIds,
      projectNames: new Map(Object.entries(request.projectNames)),
      apiKey: request.apiKey,
      model: request.model,
    }

    // 合并解析的 args 和显式传入的 args
    const args = { ...parsed?.rawArgs, ...request.args }

    const result = await registry.execute(cmdName, args, ctx)
    return result
  })

  // 批量执行
  ipcMain.handle('cli:batch-run', async (_event, task: BatchTask, ctxParams: {
    projectIds: string[]
    projectNames: Record<string, string>
    apiKey?: string
    model?: string
  }) => {
    const ctx: CommandContext = {
      projectIds: ctxParams.projectIds,
      projectNames: new Map(Object.entries(ctxParams.projectNames)),
      apiKey: ctxParams.apiKey,
      model: ctxParams.model,
    }

    const result = await batchRunner.run(task, registry, ctx, (event) => {
      mainWindow?.webContents.send('cli:batch-progress', event)
    })

    return result
  })

  // 中止批量执行
  ipcMain.handle('cli:batch-abort', async () => {
    batchRunner.abort()
    return { success: true }
  })

  // 权限响应
  ipcMain.handle('cli:permission-response', async (_event, decision: boolean) => {
    mainWindow?.webContents.send('cli:permission-response', decision)
    return { success: true }
  })

  // 别名管理
  ipcMain.handle('cli:alias-list', async () => {
    return { success: true, aliases: aliasResolver.getAll() }
  })

  ipcMain.handle('cli:alias-add', async (_event, alias: string, expandsTo: string, description?: string) => {
    aliasResolver.addAlias({ alias, expandsTo, description })
    return { success: true }
  })

  ipcMain.handle('cli:alias-remove', async (_event, alias: string) => {
    return { success: aliasResolver.removeAlias(alias) }
  })

  // 历史记录
  ipcMain.handle('cli:history', async (_event, limit?: number, commandFilter?: string) => {
    return { success: true, entries: registry.history.getHistory(limit, commandFilter) }
  })

  ipcMain.handle('cli:history-clear', async () => {
    registry.history.clearHistory()
    return { success: true }
  })

  // 收藏
  ipcMain.handle('cli:bookmark-list', async () => {
    return { success: true, bookmarks: registry.history.getBookmarks() }
  })

  ipcMain.handle('cli:bookmark-add', async (_event, bookmark: { name: string; command: string; args: Record<string, unknown>; projectPath?: string }) => {
    const bm = registry.history.addBookmark(bookmark)
    return { success: true, bookmark: bm }
  })

  ipcMain.handle('cli:bookmark-remove', async (_event, id: string) => {
    return { success: registry.history.removeBookmark(id) }
  })

  // 分组
  ipcMain.handle('cli:group-list', async () => {
    return { success: true, groups: registry.history.getGroups() }
  })

  ipcMain.handle('cli:group-create', async (_event, name: string) => {
    const g = registry.history.addGroup(name)
    return { success: true, group: g }
  })

  ipcMain.handle('cli:group-delete', async (_event, id: string) => {
    return { success: registry.history.deleteGroup(id) }
  })

  ipcMain.handle('cli:group-add-bookmark', async (_event, groupId: string, bookmarkId: string) => {
    registry.history.addToGroup(groupId, bookmarkId)
    return { success: true }
  })

  ipcMain.handle('cli:group-remove-bookmark', async (_event, groupId: string, bookmarkId: string) => {
    registry.history.removeFromGroup(groupId, bookmarkId)
    return { success: true }
  })
}

/** 获取 CLI 注册表（供 Agent-CLI 桥接使用） */
export function getCliRegistry(): CommandRegistry | null {
  return registry!
}

/** 获取别名解析器 */
export function getAliasResolver(): AliasResolver | null {
  return aliasResolver!
}
