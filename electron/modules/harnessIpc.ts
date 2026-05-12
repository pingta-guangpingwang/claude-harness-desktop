// 驾驭智能体 IPC 桥接
// 渲染进程 → 主进程: harness:send, harness:abort, harness:resolve-permission
// 主进程 → 渲染进程: harness:event (streaming agent events)

import { ipcMain, BrowserWindow, app } from 'electron'
import { AgentLoop, PermissionManager, registerAllTools } from '../harnessAgent/index.js'
import type { ConversationTurn } from '../harnessAgent/agentLoop.js'
import { createCliToolWrapper, createSkillDiscoveryTool } from '../harnessAgent/cliBridge.js'
import { registerTool } from '../harnessAgent/toolRegistry.js'
import type { AgentContext, AgentEvent } from '../harnessAgent/types.js'
import { harnessScheduler } from '../harnessAgent/scheduler.js'
import { setNotifierWindow } from './projectNotifier.js'
import * as fs from 'fs'
import * as path from 'path'


let mainWindow: BrowserWindow | null = null
let agentLoop: AgentLoop | null = null
let permissionManager: PermissionManager
let toolsRegistered = false

// 跨轮次对话记忆（持久化到本地，保留上下文）
const MEMORY_FILE = path.join(app.getPath('userData'), 'conversation-memory.json')
const conversationMemory: ConversationTurn[] = loadConversationMemory()
const MAX_MEMORY_TURNS = 30

function loadConversationMemory(): ConversationTurn[] {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = fs.readFileSync(MEMORY_FILE, 'utf-8')
      const data = JSON.parse(raw)
      if (Array.isArray(data)) {
        console.log('[HarnessIPC] 加载对话记忆:', data.length, '条')
        return data.slice(-MAX_MEMORY_TURNS)
      }
    }
  } catch (e) {
    console.error('[HarnessIPC] 加载对话记忆失败:', e)
  }
  return []
}

function saveConversationMemory(): void {
  try {
    const dir = path.dirname(MEMORY_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(conversationMemory, null, 2), 'utf-8')
  } catch (e) {
    console.error('[HarnessIPC] 保存对话记忆失败:', e)
  }
}

export function registerHarnessIpc(window: BrowserWindow) {
  mainWindow = window
  setNotifierWindow(window)

  // 确保工具只注册一次
  if (!toolsRegistered) {
    registerAllTools()
    toolsRegistered = true
  }
  permissionManager = new PermissionManager()

  // 启动 Agent 循环
  ipcMain.handle('harness:send', async (_event, request: {
    message: string
    projectIds: string[]
    projectNames: Record<string, string>
    onlineProjects: string[]
    apiKey: string
    model: string
    permissions?: Record<string, boolean>
    autonomous?: boolean
  }) => {
    if (!request.apiKey || !request.message) {
      return { success: false, error: '缺少 apiKey 或消息内容' }
    }

    // 更新权限
    if (request.permissions) {
      permissionManager.updatePermissions(request.permissions as any)
    }

    // 构建 Agent 上下文
    const ctx: AgentContext = {
      projectIds: request.projectIds,
      projectNames: new Map(Object.entries(request.projectNames)),
      onlineProjects: new Set(request.onlineProjects),
      apiKey: request.apiKey,
      model: request.model || 'deepseek-chat',
      permissions: request.permissions,
      autonomousMode: request.autonomous ?? false,
      maxAutonomousTurns: request.autonomous ? 10 : undefined,
    }

    // 如果 Agent 正在运行，将消息加入队列（不中断）
    if (agentLoop) {
      agentLoop.queueMessage(request.message)
      conversationMemory.push({ role: 'user', content: request.message })
      while (conversationMemory.length > MAX_MEMORY_TURNS) {
        conversationMemory.shift()
      }
      saveConversationMemory()
      return { success: true, queued: true }
    }

    agentLoop = new AgentLoop(ctx, permissionManager, conversationMemory)

    try {
      const finalMessage = await agentLoop.run(request.message, (event: AgentEvent) => {
        sendToRenderer('harness:event', event)
      })

      // 保存本轮对话到记忆
      conversationMemory.push({ role: 'user', content: request.message })
      if (finalMessage) {
        conversationMemory.push({ role: 'assistant', content: finalMessage })
      }
      // 限制记忆长度（保留最近 MAX_MEMORY_TURNS 条）
      while (conversationMemory.length > MAX_MEMORY_TURNS) {
        conversationMemory.shift()
      }
      saveConversationMemory()

      return { success: true, finalMessage }
    } catch (err: any) {
      // AbortError 是用户正常中断，不是错误
      if (err?.name === 'AbortError') {
        return { success: true, finalMessage: '' }
      }
      return { success: false, error: String(err) }
    } finally {
      if (agentLoop) {
        agentLoop = null
      }
    }
  })

  // 中止 Agent 循环
  ipcMain.handle('harness:abort', async () => {
    if (agentLoop) {
      agentLoop.abort()
      agentLoop = null
      return { success: true }
    }
    return { success: false, error: '没有正在运行的 Agent 循环' }
  })

  // 解析权限请求
  ipcMain.handle('harness:resolve-permission', async (_event, decision: 'allow' | 'deny' | 'allow_once') => {
    if (agentLoop) {
      agentLoop.resolvePermission(decision)
      return { success: true }
    }
    return { success: false, error: '没有待处理的权限请求' }
  })

  // 获取权限设置
  ipcMain.handle('harness:get-permissions', async () => {
    return { success: true, permissions: permissionManager.getPermissions() }
  })

  // 更新权限设置
  ipcMain.handle('harness:set-permissions', async (_event, permissions: Record<string, boolean>) => {
    permissionManager.updatePermissions(permissions as any)
    return { success: true }
  })

  // ====== 定时调度 ======

  ipcMain.handle('harness:schedule-add', async (_event, opts: {
    name: string; prompt: string; intervalMs: number; projectPath?: string
  }) => {
    const id = harnessScheduler.add(opts.name, opts.prompt, opts.intervalMs, opts.projectPath)
    return { success: true, id }
  })

  ipcMain.handle('harness:schedule-add-once', async (_event, opts: {
    name: string; prompt: string; delayMs: number; projectPath?: string
  }) => {
    const id = harnessScheduler.addOnce(opts.name, opts.prompt, opts.delayMs, opts.projectPath)
    return { success: true, id }
  })

  ipcMain.handle('harness:schedule-remove', async (_event, id: string) => {
    const ok = harnessScheduler.remove(id)
    return { success: ok, error: ok ? undefined : '未找到任务' }
  })

  ipcMain.handle('harness:schedule-set-enabled', async (_event, id: string, enabled: boolean) => {
    harnessScheduler.setEnabled(id, enabled)
    return { success: true }
  })

  ipcMain.handle('harness:schedule-list', async () => {
    return { success: true, tasks: harnessScheduler.list(), stats: harnessScheduler.stats() }
  })

  // 调度触发时 → 若 Agent 未在运行，启动自主 Agent 取任务
  harnessScheduler.setOnTrigger(() => {
    if (agentLoop) return // Agent 已在运行，任务已入队列等它取
    // Agent 不在运行 → 这里不做静默启动，等用户下次交互时自主模式取队列
    console.log('[Scheduler] 任务已入队列，等待 Agent 取用')
  })
}

function sendToRenderer(channel: string, ...args: unknown[]) {
  mainWindow?.webContents.send(channel, ...args)
}

/** 注册技能发现工具（Agent 启动时自动可见） */
function registerSkillDiscovery(): void {
  const tool = createSkillDiscoveryTool()
  registerTool(tool)
}

let cliBridgeDone = false

/** 桥接 CLI 命令到 Agent 工具池 — 由 main.ts 在两者初始化完毕后调用 */
export function bridgeCliToAgent(cliRegistry: {
  getAll: () => Array<{
    name: string; description: string; category?: string
    params?: Array<{ name: string; type: string; description: string; required?: boolean }>
    permission?: string
  }>
  execute: (name: string, args: Record<string, unknown>, ctx: any) => Promise<{ success: boolean; output: string }>
}): void {
  if (cliBridgeDone) return
  createCliToolWrapper(cliRegistry)
  registerSkillDiscovery()
  cliBridgeDone = true
}
