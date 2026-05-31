// 驾驭智能体 IPC 桥接
// 渲染进程 → 主进程: harness:send, harness:abort, harness:resolve-permission
// 主进程 → 渲染进程: harness:event (streaming agent events)

import { ipcMain, BrowserWindow, app } from 'electron'
import { AgentLoop, PermissionManager, registerAllTools } from '../harnessAgent/index.js'
import type { ConversationTurn } from '../harnessAgent/agentLoop.js'
import { createCliToolWrapper, createSkillDiscoveryTool } from '../harnessAgent/cliBridge.js'
import { registerTool } from '../harnessAgent/toolRegistry.js'
import type { AgentContext, AgentEvent } from '../harnessAgent/types.js'
import { onHarnessMention } from './ptyManager.js'
import { harnessScheduler } from '../harnessAgent/scheduler.js'
import { setNotifierWindow } from './projectNotifier.js'
import * as fs from 'fs'
import * as path from 'path'
import { taxonomyStore } from '../config/taxonomyStore.js'


let mainWindow: BrowserWindow | null = null
let agentLoop: AgentLoop | null = null
let permissionManager: PermissionManager
let toolsRegistered = false
let lastApiKey = '' // 缓存 API Key 供 @HARNESS 自动启动

// 跨轮次对话记忆（持久化到本地，保留上下文）
const MAX_MEMORY_TURNS = 30
const MEMORY_FILE = path.join(app.getPath('userData'), 'conversation-memory.json')
const conversationMemory: ConversationTurn[] = loadConversationMemory()

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

export async function registerHarnessIpc(window: BrowserWindow) {
  mainWindow = window
  setNotifierWindow(window)

  // 确保工具只注册一次
  if (!toolsRegistered) {
    registerAllTools()
    toolsRegistered = true
  }
  permissionManager = new PermissionManager()

  // @harness 触发器：项目 AI 在终端中 @harness 时自动通知驾驭智能
  // 积压的 @harness 请求（等 Agent 启动后处理）
  const pendingHarnessMentions: Array<{ prompt: string; projectName: string }> = []

  // 前端直接转发的 @harness 请求（用户在项目 Chat 中输入 @harness xxx）
  ipcMain.handle('harness:relay', async (_event, request: { projectPath: string; projectName: string; message: string }) => {
    const msg = request.message.replace(/^@harness\s*/i, '').trim()
    const projName = request.projectName || request.projectPath.split('\\').pop() || request.projectPath
    const prompt = `[来自项目 「${projName}」的跨项目请求]
${msg}

请使用你的工具（list_farm_projects / read_project_chat / notify_project 等）来处理这个请求。完成后用 notify_project 通知发起方项目结果。`

    console.log('[HarnessIPC] harness:relay 收到:', projName, '-', msg.slice(0, 80))

    if (agentLoop) {
      if (pendingHarnessMentions.length > 0) {
        const mentions = pendingHarnessMentions.splice(0)
        for (const m of mentions) agentLoop.queueMessage(m.prompt)
      }
      agentLoop.queueMessage(prompt)
      return { success: true, message: '已转发给驾驭智能' }
    } else {
      pendingHarnessMentions.push({ prompt, projectName: projName })
      // 尝试自动启动 Agent（多个来源获取 API Key）
      if (!lastApiKey) {
        try {
          const fs = require('fs'); const path = require('path')
          const configPath = path.join(require('electron').app.getPath('userData'), 'horsefarm-config.json')
          if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
            const activeKey = (config.apiKeys || []).find((k: any) => k.enabled && k.status !== 'exhausted' && k.status !== 'error')
            if (activeKey?.key) lastApiKey = activeKey.key
          }
        } catch {}
      }
      if (lastApiKey) {
        console.log('[HarnessIPC] harness:relay 自动启动 Agent')
        try {
          const ctx2: AgentContext = {
            projectIds: [request.projectPath],
            projectNames: new Map([[request.projectPath, projName]]),
            onlineProjects: new Set([request.projectPath]),
            apiKey: lastApiKey,
            model: 'claude-sonnet-4-6',
            autonomousMode: true,
            maxAutonomousTurns: 5,
          }
          agentLoop = new AgentLoop(ctx2, permissionManager!, conversationMemory)
          const mentions = pendingHarnessMentions.splice(0)
          for (const m of mentions) agentLoop!.queueMessage(m.prompt)
          console.log('[HarnessIPC] Agent 自动启动，处理', mentions.length, '个请求')
          agentLoop.run('处理 @harness 协作请求', (event: AgentEvent) => {
            sendToRenderer('harness:event', event)
          }).catch(e => console.error('[HarnessIPC] Agent error:', e?.message)).finally(() => { agentLoop = null })
          return { success: true, message: '驾驭智能已启动，正在处理请求' }
        } catch (e: any) {
          console.error('[HarnessIPC] Agent 自动启动失败:', e?.message)
        }
      }
      return { success: true, message: '请先在驾驭智能 Chat 中配置 API Key，然后重新发送 @harness' }
    }
  })

  onHarnessMention((projectPath, projectName, message, recentContext) => {
    const prompt = `[来自项目 「${projectName}」的呼叫]
项目 AI 说: ${message}

该项目最近终端输出:
${recentContext.slice(-1000)}

请根据项目 AI 的请求，使用你的工具（list_farm_projects / read_project_chat / notify_project 等）来协助它。如果不需要行动，回复"收到"即可。`
    console.log('[HarnessIPC] @harness 触发:', projectName, '-', message.slice(0, 80))

    if (agentLoop) {
      // 同时清空积压队列
      if (pendingHarnessMentions.length > 0) {
        const mentions = pendingHarnessMentions.splice(0)
        for (const m of mentions) agentLoop.queueMessage(m.prompt)
      }
      agentLoop.queueMessage(prompt)
    } else {
      // Agent 还没启动 → 自动启动
      pendingHarnessMentions.push({ prompt, projectName })
      console.log('[HarnessIPC] Agent 未启动，尝试自动启动 (积压:', pendingHarnessMentions.length, ')')
      try {
        // 多来源获取 API Key：缓存 > harness:send > 配置文件
        let apiKey = lastApiKey
        if (!apiKey) {
          try {
            const fs = require('fs')
            const path = require('path')
            const configPath = path.join(require('electron').app.getPath('userData'), 'horsefarm-config.json')
            if (fs.existsSync(configPath)) {
              const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
              const activeKey = (config.apiKeys || []).find((k: any) => k.enabled && k.status !== 'exhausted' && k.status !== 'error')
              if (activeKey?.key) { apiKey = activeKey.key; lastApiKey = apiKey }
            }
          } catch { /* fall through */ }
        }
        if (!apiKey) { console.log('[HarnessIPC] 无可用 API Key，请在设置中配置 API Key'); return }
        const ctx2: AgentContext = {
          projectIds: [projectPath],
          projectNames: new Map([[projectPath, projectName]]),
          onlineProjects: new Set([projectPath]),
          apiKey,
          model: 'claude-sonnet-4-6',
          autonomousMode: true,
          maxAutonomousTurns: 5,
        }
        agentLoop = new AgentLoop(ctx2, permissionManager!, conversationMemory)
        const mentions = pendingHarnessMentions.splice(0)
        for (const m of mentions) agentLoop!.queueMessage(m.prompt)
        console.log('[HarnessIPC] Agent 自动启动，处理', mentions.length, '个积压请求')
        const originProject = projectPath
        agentLoop.run('处理 @HARNESS 协作请求', (event: AgentEvent) => {
          sendToRenderer('harness:event', event)
        }).then(finalMsg => {
          if (finalMsg) {
            conversationMemory.push({ role: 'user', content: '@HARNESS 协作请求' })
            conversationMemory.push({ role: 'assistant', content: finalMsg })
            while (conversationMemory.length > MAX_MEMORY_TURNS) conversationMemory.shift()
            saveConversationMemory()
          }
          // 通知发起项目：驾驭智能已完成处理
          try {
            const { writeToPty } = require('./ptyManager.js')
            const summary = finalMsg ? finalMsg.slice(0, 500) : '处理完成'
            writeToPty(originProject, `\n📬 驾驭智能已完成你的 @HARNESS 请求：\n${summary}\n`)
          } catch {}
        }).catch(e => console.error('[HarnessIPC] Agent auto-run error:', e?.message)).finally(() => { agentLoop = null })
      } catch (e: any) {
        console.error('[HarnessIPC] Agent 自动启动失败:', e?.message)
      }
    }
  })

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
    // 缓存 API Key 供 @HARNESS 自动启动使用
    if (request.apiKey) lastApiKey = request.apiKey

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

    // 处理积压的 @harness 请求
    if (pendingHarnessMentions.length > 0) {
      const mentions = pendingHarnessMentions.splice(0)
      console.log('[HarnessIPC] 处理积压 @harness 请求:', mentions.length)
      for (const m of mentions) {
        agentLoop.queueMessage(m.prompt)
      }
    }

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

      // 检查是否有排队消息（用户中途插话），继续处理
      if (agentLoop.hasPendingMessages()) {
        const nextMsg = agentLoop.popPendingMessage()!
        console.log('[HarnessIPC] 处理排队消息:', nextMsg.slice(0, 60))
        try {
          const nextFinal = await agentLoop.run(nextMsg, (event: AgentEvent) => {
            sendToRenderer('harness:event', event)
          })
          if (nextFinal) {
            conversationMemory.push({ role: 'user', content: nextMsg })
            conversationMemory.push({ role: 'assistant', content: nextFinal })
            while (conversationMemory.length > MAX_MEMORY_TURNS) conversationMemory.shift()
            saveConversationMemory()
          }
        } catch { /* 排队消息处理失败不影响主流程 */ }
      }

      return { success: true, finalMessage }
    } catch (err: any) {
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

  // ====== 操作日志持久化 ======
  const OP_LOG_FILE = path.join(app.getPath('userData'), 'operation-log.json')

  ipcMain.handle('harness:save-logs', async (_event, logs: Array<{
    time: string; type: string; text: string; toolName?: string; fullContent?: string
  }>) => {
    try {
      const dir = path.dirname(OP_LOG_FILE)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const trimmed = logs.slice(-500)
      fs.writeFileSync(OP_LOG_FILE, JSON.stringify(trimmed, null, 2), 'utf-8')
      return { success: true }
    } catch (e) {
      console.error('[HarnessIPC] 保存操作日志失败:', e)
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('harness:load-logs', async () => {
    try {
      if (fs.existsSync(OP_LOG_FILE)) {
        const raw = fs.readFileSync(OP_LOG_FILE, 'utf-8')
        const data = JSON.parse(raw)
        if (Array.isArray(data)) {
          console.log('[HarnessIPC] 加载操作日志:', data.length, '条')
          return { success: true, logs: data.slice(-500) }
        }
      }
    } catch (e) {
      console.error('[HarnessIPC] 加载操作日志失败:', e)
    }
    return { success: true, logs: [] }
  })

  // ====== 角色管理 (V3.7) ======
  const { roleConfigStore } = await import('../harnessAgent/roleConfigStore.js')
  const { RoleManager } = await import('../harnessAgent/roleManager.js')

  ipcMain.handle('harness:roles-list', async () => {
    try {
      const roles = roleConfigStore.getRolesWithScores()
      return { success: true, roles }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('harness:roles-create', async (_event, params: any) => {
    try {
      const rm = new RoleManager()
      const result = rm.createCustomRole(params)
      return result
    } catch (e) { return { success: false, message: String(e) } }
  })

  ipcMain.handle('harness:roles-delete', async (_event, roleId: string) => {
    try {
      const rm = new RoleManager()
      const result = rm.deleteRole(roleId)
      return result
    } catch (e) { return { success: false, message: String(e) } }
  })

  ipcMain.handle('harness:roles-leaderboard', async (_event, topK?: number) => {
    try {
      const leaderboard = roleConfigStore.getLeaderboard(topK)
      return { success: true, leaderboard }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('harness:roles-score-report', async () => {
    try {
      const report = roleConfigStore.generateScoreReport()
      return { success: true, report }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('harness:roles-set-role-enabled', async (_event, roleId: string, enabled: boolean) => {
    try {
      roleConfigStore.setRoleEnabled(roleId, enabled)
      return { success: true }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('harness:roles-set-system-enabled', async (_event, enabled: boolean) => {
    try {
      roleConfigStore.setSystemEnabled(enabled)
      return { success: true }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('harness:roles-load-config', async () => {
    try {
      const config = roleConfigStore.getConfig()
      return { success: true, config }
    } catch (e) { return { success: false, error: String(e) } }
  })

  // ---- 资源仓库管理 ----
  ipcMain.handle('resource:status', async () => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      const initialized = resourceStore.isInitialized()
      return { success: true, initialized }
    } catch (e) { return { success: false, initialized: false } }
  })

  ipcMain.handle('resource:query', async (_event, params: any) => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      await resourceStore.ensureManifestsLoaded()
      const resources = resourceStore.queryResources(params || {})
      return { success: true, resources }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('resource:list', async (_event, repo?: string) => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      await resourceStore.ensureManifestsLoaded()
      const resources = resourceStore.getAllResources(repo as any)
      return { success: true, resources }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('resource:detail', async (_event, id: string) => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      if (!resourceStore.isInitialized()) {
        await resourceStore.loadManifests()
      }
      await resourceStore.ensureManifestsLoaded()
      const resource = await resourceStore.getResourceDetail(id)
      return { success: true, resource }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('resource:add', async (_event, repo: string, resource: any) => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      const result = await resourceStore.addResource(resource, repo as any)
      return result
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('resource:leaderboard', async (_event, category?: string, limit?: number) => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      if (!resourceStore.isInitialized()) {
        await resourceStore.loadManifests()
      }
      const leaderboard = resourceStore.getLeaderboard(category, limit)
      return { success: true, leaderboard }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('resource:changes', async (_event, repo: string) => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      const changes = await resourceStore.getLocalChanges(repo as any)
      return { success: true, changes }
    } catch (e) { return { success: false, error: String(e) } }
  })

  // ---- 资源仓库 Git 同步与贡献 ----
  ipcMain.handle('resource:repo-status', async (_event, repo: string) => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      const status = await resourceStore.getRepoStatus(repo as any)
      return { success: true, ...status }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('resource:check-updates', async (_event, repo: string) => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      const result = await resourceStore.checkForUpdates(repo as any)
      return result
    } catch (e) { return { success: false, hasUpdates: false, behind: 0, message: String(e) } }
  })

  ipcMain.handle('resource:sync-pull', async (_event, repo: string) => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      const result = await resourceStore.syncRepo(repo as any)
      return result
    } catch (e) { return { success: false, message: String(e), pulled: 0 } }
  })

  ipcMain.handle('resource:contribute-branch', async (_event, repo: string, branchName: string) => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      const result = await resourceStore.createContributionBranch(repo as any, branchName)
      return result
    } catch (e) { return { success: false, message: String(e) } }
  })

  ipcMain.handle('resource:contribute-commit', async (_event, repo: string, message: string) => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      const result = await resourceStore.commitChanges(repo as any, message)
      return result
    } catch (e) { return { success: false, message: String(e) } }
  })

  ipcMain.handle('resource:contribute-push', async (_event, repo: string, branchName: string) => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      const result = await resourceStore.pushBranch(repo as any, branchName)
      return result
    } catch (e) { return { success: false, message: String(e) } }
  })

  ipcMain.handle('resource:contribute-pr', async (_event, repo: string, branchName: string, title: string, body: string) => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      const result = await resourceStore.createPullRequest(repo as any, branchName, title, body)
      return result
    } catch (e) { return { success: false, message: String(e) } }
  })

  ipcMain.handle('resource:clone', async (_event, repo: string, remoteUrl?: string) => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      const result = await resourceStore.cloneRepo(repo as any, remoteUrl)
      return result
    } catch (e) { return { success: false, message: String(e) } }
  })

  ipcMain.handle('resource:auto-sync', async () => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      return await resourceStore.autoSyncAll()
    } catch (e) { return { synced: [], message: String(e) } }
  })

  // ---- 分面分类体系 ----
  ipcMain.handle('taxonomy:facets', async () => {
    return taxonomyStore.getFacets()
  })

  ipcMain.handle('taxonomy:resolve', async (_event, facets: any) => {
    return taxonomyStore.resolve(facets)
  })

  ipcMain.handle('taxonomy:expand', async (_event, facets: any) => {
    return taxonomyStore.expand(facets)
  })

  ipcMain.handle('taxonomy:label', async (_event, code: string) => {
    return taxonomyStore.getLabel(code)
  })

  ipcMain.handle('taxonomy:children', async (_event, facetName: string, parentCode: string) => {
    return taxonomyStore.getChildren(facetName, parentCode)
  })

  ipcMain.handle('taxonomy:roots', async (_event, facetName: string) => {
    return taxonomyStore.getRoots(facetName)
  })

  // ---- 待审核资源管理 ----
  ipcMain.handle('pending:list', async () => {
    try {
      const { pendingResourceStore } = await import('../modules/pendingResourceStore.js')
      return { success: true, items: pendingResourceStore.items }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('pending:add', async (_event, item: any) => {
    try {
      const { pendingResourceStore } = await import('../modules/pendingResourceStore.js')
      const id = `pend-${Date.now().toString(36)}`
      const rawCat = (item.category as string) || 'other'
      const cleanCat = rawCat.split(/[,，、]/)[0].trim().slice(0, 30) || 'other'
      pendingResourceStore.addItem({
        id,
        name: item.name || '',
        resourceType: item.resourceType || 'prompt',
        targetRepo: item.targetRepo || 'DeepBluePrompt',
        category: cleanCat,
        techStack: item.techStack || [],
        sourceUrl: item.sourceUrl || '',
        summary: item.summary || '',
        rawContent: item.rawContent || '',
        status: 'pending',
        auditScore: 0,
        auditNotes: '',
        formattedContent: '',
        auditedAt: '',
        createdAt: new Date().toISOString(),
      })
      return { success: true, id }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('pending:remove', async (_event, id: string) => {
    try {
      const { pendingResourceStore } = await import('../modules/pendingResourceStore.js')
      const ok = pendingResourceStore.removeItem(id)
      return { success: ok }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('pending:update', async (_event, id: string, updates: any) => {
    try {
      const { pendingResourceStore } = await import('../modules/pendingResourceStore.js')
      const ok = pendingResourceStore.updateItem(id, updates)
      return { success: ok }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('pending:count', async () => {
    try {
      const { pendingResourceStore } = await import('../modules/pendingResourceStore.js')
      return { success: true, count: pendingResourceStore.getPendingCount() }
    } catch (e) { return { success: false, error: String(e) } }
  })

  // 清理已入库的旧记录 — 工坊初始化时调用
  ipcMain.handle('pending:cleanup', async () => {
    try {
      const { pendingResourceStore } = await import('../modules/pendingResourceStore.js')
      const { resourceStore } = await import('../modules/resourceStore.js')
      const approved = pendingResourceStore.getItemsByStatus('approved')
      const cleaned: string[] = []

      for (const item of approved) {
        try {
          // 检查对应仓库的 git 状态：若文件已提交推送则无本地变更
          const changes = await resourceStore.getLocalChanges(item.targetRepo as any)
          const pathInRepo = `${resourceStore.getTypeDir(item.targetRepo as any, item.resourceType)}/${item.category}/${item.id}.md`
          const stillPending = changes.some(c => c.path.includes(item.id))
          if (!stillPending) {
            pendingResourceStore.removeItem(item.id)
            cleaned.push(item.id)
          }
        } catch { /* 单条失败不影响其他 */ }
      }

      console.log('[pending:cleanup] 清理了', cleaned.length, '条已入库记录:', cleaned)
      return { success: true, cleaned }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('pending:approve', async (_event, id: string) => {
    try {
      const { pendingResourceStore } = await import('../modules/pendingResourceStore.js')
      const { resourceStore } = await import('../modules/resourceStore.js')
      const item = pendingResourceStore.getItem(id)
      if (!item) return { success: false, error: 'not found' }
      if (item.status === 'pending') {
        console.log('[approve] 项目未审核:', id)
        return { success: false, error: '请先进行 AI 审核后再批准' }
      }
      console.log('[approve] 批准:', item.name, '→', item.targetRepo)
      const result = await resourceStore.addResource({
        id: item.id,
        name: item.name,
        type: item.resourceType,
        category: item.category,
        tech_stack: item.techStack,
        style_tags: [],
        use_cases: [],
        score: item.auditScore || 5.0,
        rating_count: 0,
        usage_count: 0,
        source_url: item.sourceUrl,
        summary: item.summary,
        repo: item.targetRepo as any,
        content: item.formattedContent || item.rawContent,
      }, item.targetRepo as any)
      if (result.success && result.path) {
        console.log('[approve] 已落盘:', result.path)
        pendingResourceStore.updateItem(id, { status: 'approved' })
        const { userContributionStore } = await import('../modules/userContributionStore.js')
        userContributionStore.record({ id: item.id, name: item.name, repo: item.targetRepo, type: item.resourceType })
      } else {
        console.log('[approve] 写入失败:', item.targetRepo)
      }
      return result
    } catch (e) { console.log('[approve] 异常:', e); return { success: false, error: String(e) } }
  })

  ipcMain.handle('pending:approve-all', async (_event, repo?: string) => {
    try {
      const { pendingResourceStore } = await import('../modules/pendingResourceStore.js')
      const { resourceStore } = await import('../modules/resourceStore.js')
      const audited = pendingResourceStore.getItemsByStatus('audited')
      const toApprove = repo ? audited.filter(i => i.targetRepo === repo) : audited
      const results: Array<{ id: string; name: string; success: boolean; message: string }> = []
      for (const item of toApprove) {
        if (item.auditScore < 4) {
          results.push({ id: item.id, name: item.name, success: false, message: '评分过低，跳过' })
          continue
        }
        try {
          const r = await resourceStore.addResource({
            id: item.id,
            name: item.name,
            type: item.resourceType,
            category: item.category,
            tech_stack: item.techStack,
            style_tags: [],
            use_cases: [],
            score: item.auditScore || 5.0,
            rating_count: 0,
            usage_count: 0,
            source_url: item.sourceUrl,
            summary: item.summary,
            repo: item.targetRepo as any,
            content: item.formattedContent || item.rawContent,
          }, item.targetRepo as any)
          if (r.success) {
            pendingResourceStore.updateItem(item.id, { status: 'approved' })
            const { userContributionStore } = await import('../modules/userContributionStore.js')
            userContributionStore.record({ id: item.id, name: item.name, repo: item.targetRepo, type: item.resourceType })
            results.push({ id: item.id, name: item.name, success: true, message: '已入库' })
          } else {
            results.push({ id: item.id, name: item.name, success: false, message: '写入失败' })
          }
        } catch (e: any) {
          results.push({ id: item.id, name: item.name, success: false, message: String(e) })
        }
      }
      return { success: true, results }
    } catch (e) { return { success: false, error: String(e) } }
  })

    // 一键审核入库 — 自动审核所有待审资源并直接入库
  ipcMain.handle('pending:audit-all', async () => {
    const LOG_A = '[audit-all]'
    try {
      const { pendingResourceStore } = await import('../modules/pendingResourceStore.js')
      const { resourceStore } = await import('../modules/resourceStore.js')
      const items = pendingResourceStore.getItemsByStatus('pending')
      if (items.length === 0) return { success: true, results: [], message: '没有待审核的资源' }
      const VALID_REPOS = ['DeepBluePrompt', 'DeepBlueCase', 'DeepBlueKit', 'DeepBlueIdentity']

      const results: Array<{ id: string; name: string; success: boolean; score: number; message: string }> = []

      for (const item of items) {
        console.log(`${LOG_A} 处理: ${item.name} → ${item.targetRepo}`)
        if (!VALID_REPOS.includes(item.targetRepo)) {
          console.log(`${LOG_A} → 无效仓库: ${item.targetRepo}`)
          results.push({ id: item.id, name: item.name, success: false, score: 0, message: `无效仓库: ${item.targetRepo}` })
          continue
        }
        // 根据数据完整度自动评分
        let score = 5 // 基础分
        if (item.sourceUrl) score += 1
        if (item.techStack.length > 0) score += 1
        if (item.category && item.category !== 'other') score += 1
        if (item.summary.length > 30) score += 1
        if (item.rawContent.length > 100) score += 1
        score = Math.min(score, 10)

        // 生成标准化的 YAML frontmatter + 正文
        const yamlBlock = [
          '---',
          'id: ' + item.id,
          'name: ' + item.name,
          'type: ' + item.resourceType,
          'category: ' + item.category,
          item.techStack.length ? 'tech_stack:' + item.techStack.map(t => '\n  - ' + t).join('') : 'tech_stack: []',
          'score: ' + score.toFixed(1),
          'source_url: ' + (item.sourceUrl || ''),
          'summary: ' + item.summary.replace(/\n/g, ' '),
          '---',
          '',
          item.rawContent || item.summary,
        ].join('\n')

        try {
          const result = await resourceStore.addResource({
            id: item.id,
            name: item.name,
            type: item.resourceType,
            category: item.category,
            tech_stack: item.techStack,
            style_tags: [],
            use_cases: [],
            score: score,
            rating_count: 1,
            usage_count: 0,
            source_url: item.sourceUrl,
            summary: item.summary,
            repo: item.targetRepo as any,
            content: yamlBlock,
          }, item.targetRepo as any)

          if (result.success && result.path) {
            // 二次验证文件已落盘
            const fs = await import('fs')
            if (!fs.existsSync(result.path)) {
              console.log(`${LOG_A} → 文件不存在: ${result.path}`)
              results.push({ id: item.id, name: item.name, success: false, score, message: '文件写入后未找到' })
              continue
            }
            console.log(`${LOG_A} → 已落盘: ${result.path}`)
            pendingResourceStore.updateItem(item.id, {
              status: 'approved',
              auditScore: score,
              auditNotes: '一键自动审核入库',
              formattedContent: yamlBlock,
              auditedAt: new Date().toISOString(),
            })
            // 记录用户贡献
            const { userContributionStore } = await import('../modules/userContributionStore.js')
            userContributionStore.record({ id: item.id, name: item.name, repo: item.targetRepo, type: item.resourceType })
            results.push({ id: item.id, name: item.name, success: true, score, message: '已入库' })
          } else {
            console.log(`${LOG_A} → addResource 返回失败, repo=${item.targetRepo}`)
            results.push({ id: item.id, name: item.name, success: false, score, message: '写入失败（仓库可能未克隆）' })
          }
        } catch (e: any) {
          console.log(`${LOG_A} → 异常:`, e.message || e)
          results.push({ id: item.id, name: item.name, success: false, score, message: String(e) })
        }
      }

      const successCount = results.filter(r => r.success).length
      console.log(`${LOG_A} 完成: ${successCount}/${items.length}`)
      return { success: true, results, message: successCount + '/' + items.length + ' 条资源已入库' }
    } catch (e) { console.log('[audit-all] 致命:', e); return { success: false, error: String(e) } }
  })

  // ---- 用户贡献管理 ----

  ipcMain.handle('contribution:list', async () => {
    try {
      const { userContributionStore } = await import('../modules/userContributionStore.js')
      return { success: true, contributions: userContributionStore.contributions }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('contribution:check-status', async () => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      const { userContributionStore } = await import('../modules/userContributionStore.js')
      const repos = ['DeepBluePrompt', 'DeepBlueCase', 'DeepBlueKit', 'DeepBlueIdentity'] as const
      const repoStatuses = {}

      for (const repo of repos) {
        let hasRemote = false
        let behind = 0
        try {
          const check = await resourceStore.checkForUpdates(repo)
          hasRemote = check.hasUpdates
          behind = check.behind
        } catch (_) { /* ignore */ }

        const localChanges = await resourceStore.getLocalChanges(repo)

        const contributions = userContributionStore.contributions
        const uncommittedIds = contributions
          .filter(c => c.repo === repo && !c.committed)
          .map(c => c.id)

        repoStatuses[repo] = { hasRemote, behind, localChanges, uncommittedIds }
      }

      return { success: true, repoStatuses }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('contribution:commit-all', async (_event, message) => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      const { userContributionStore } = await import('../modules/userContributionStore.js')
      const repos = ['DeepBluePrompt', 'DeepBlueCase', 'DeepBlueKit', 'DeepBlueIdentity'] as const
      const results: Array<{ repo: string; success: boolean; message: string; step?: string }> = []

      for (const repo of repos) {
        // Step 1: 检查是否有任何变更
        const changes = await resourceStore.getLocalChanges(repo)
        if (changes.length === 0) {
          results.push({ repo, success: true, message: '无变更，跳过' })
          continue
        }

        // Step 2: YAML 格式校验（仅必需字段，不限制范围）
        const yamlCheck = await resourceStore.validateCommitYaml(repo)
        if (!yamlCheck.valid) {
          results.push({
            repo,
            success: false,
            message: `YAML 格式校验未通过:\n${yamlCheck.errors.join('\n')}`,
            step: 'scope-check',
          })
          continue
        }

        // Step 3: 全部提交
        const commitResult = await resourceStore.commitAll(repo, message)
        if (!commitResult.success) {
          results.push({ repo, success: false, message: commitResult.message, step: 'commit' })
          continue
        }

        // Step 4: 推送
        const status = await resourceStore.getRepoStatus(repo).catch(() => null)
        const branch = status?.branch || 'main'
        const pushResult = await resourceStore.pushBranch(repo, branch)
        if (pushResult.success) {
          const contribs = userContributionStore.contributions.filter(c => c.repo === repo && !c.committed)
          const ids = contribs.map(c => c.id)
          if (ids.length > 0) {
            userContributionStore.markCommitted(ids)
            userContributionStore.markPushed(ids)
          }
          try {
            const { pendingResourceStore: prs } = await import('../modules/pendingResourceStore.js')
            for (const cid of ids) {
              const pitem = prs.getItem(cid)
              if (pitem && pitem.status === 'approved') {
                prs.removeItem(cid)
              }
            }
          } catch { /* 清理失败不影响主流程 */ }
          results.push({ repo, success: true, message: commitResult.message + ' 并已推送' })
        } else {
          const contribs = userContributionStore.contributions.filter(c => c.repo === repo && !c.committed)
          const ids = contribs.map(c => c.id)
          if (ids.length > 0) userContributionStore.markCommitted(ids)
          results.push({ repo, success: false, message: '已提交但推送失败: ' + pushResult.message, step: 'push' })
        }
      }

      return { success: true, results }
    } catch (e) { return { success: false, error: String(e) } }
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
