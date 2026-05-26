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
      // 始终从磁盘重载 manifest 以保证数据最新
      if (resourceStore.isInitialized()) {
        await resourceStore.loadManifests()
      }
      const resources = resourceStore.queryResources(params || {})
      return { success: true, resources }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('resource:list', async (_event, repo?: string) => {
    try {
      const { resourceStore } = await import('../modules/resourceStore.js')
      // 始终从磁盘重载 manifest 以保证数据最新（修复本地文件修改后内存过时问题）
      if (resourceStore.isInitialized()) {
        await resourceStore.loadManifests()
      }
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
      pendingResourceStore.addItem({
        id,
        name: item.name || '',
        resourceType: item.resourceType || 'prompt',
        targetRepo: item.targetRepo || 'DeepBluePrompt',
        category: item.category || 'other',
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

  ipcMain.handle('pending:approve', async (_event, id: string) => {
    try {
      const { pendingResourceStore } = await import('../modules/pendingResourceStore.js')
      const { resourceStore } = await import('../modules/resourceStore.js')
      const item = pendingResourceStore.getItem(id)
      if (!item) return { success: false, error: 'not found' }
      if (item.status === 'pending') {
        return { success: false, error: '请先进行 AI 审核后再批准' }
      }
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
      if (result.success) {
        pendingResourceStore.updateItem(id, { status: 'approved' })
      }
      return result
    } catch (e) { return { success: false, error: String(e) } }
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
    try {
      const { pendingResourceStore } = await import('../modules/pendingResourceStore.js')
      const { resourceStore } = await import('../modules/resourceStore.js')
      const items = pendingResourceStore.getItemsByStatus('pending')
      if (items.length === 0) return { success: true, results: [], message: '没有待审核的资源' }

      const results: Array<{ id: string; name: string; success: boolean; score: number; message: string }> = []

      for (const item of items) {
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

          if (result.success) {
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
            results.push({ id: item.id, name: item.name, success: false, score, message: '写入失败' })
          }
        } catch (e: any) {
          results.push({ id: item.id, name: item.name, success: false, score, message: String(e) })
        }
      }

      const successCount = results.filter(r => r.success).length
      return { success: true, results, message: successCount + '/' + items.length + ' 条资源已入库' }
    } catch (e) { return { success: false, error: String(e) } }
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
      const repos = ['DeepBluePrompt', 'DeepBlueCase', 'DeepBlueKit']
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
      const repos = ['DeepBluePrompt', 'DeepBlueCase', 'DeepBlueKit']
      const results: Array<{ repo: string; success: boolean; message: string; step?: string }> = []

      for (const repo of repos) {
        // Step 1: 检查是否有任何变更
        const changes = await resourceStore.getLocalChanges(repo)
        if (changes.length === 0) {
          results.push({ repo, success: true, message: '无变更，跳过' })
          continue
        }

        // Step 2: 闸门 1 — 范围管控 + YAML 校验
        const scopeCheck = await resourceStore.validateCommitScope(repo)
        if (!scopeCheck.valid) {
          results.push({
            repo,
            success: false,
            message: `提交安全检查未通过:\n${scopeCheck.errors.join('\n')}`,
            step: 'scope-check',
          })
          continue
        }
        if (scopeCheck.newFiles.length === 0) {
          results.push({ repo, success: true, message: '仅有被阻止的文件，已跳过' })
          continue
        }

        // Step 3: 闸门 2 — 强制拉取（失败立即中止）
        let pullResult: { success: boolean; message: string }
        try {
          pullResult = await resourceStore.forcePullOrAbort(repo)
        } catch (e: any) {
          results.push({
            repo,
            success: false,
            message: `拉取异常 (提交已中止): ${e.message || String(e)}。请检查网络连接和仓库状态后重试。`,
            step: 'pull',
          })
          continue
        }
        if (!pullResult.success) {
          results.push({ repo, success: false, message: pullResult.message, step: 'pull' })
          continue
        }

        // Step 4: 精确提交（仅新增文件）
        const newFilePaths = scopeCheck.newFiles.map(f => f.path)
        const commitResult = await resourceStore.commitChanges(repo, message, newFilePaths)
        if (!commitResult.success) {
          results.push({ repo, success: false, message: commitResult.message, step: 'commit' })
          continue
        }

        // Step 5: 闸门 3 — 安全推送（冲突自动重试）
        const status = await resourceStore.getRepoStatus(repo).catch(() => null)
        const branch = status?.branch || 'main'
        const pushResult = await resourceStore.safePushBranch(repo, branch)
        if (pushResult.success) {
          const contribs = userContributionStore.contributions.filter(c => c.repo === repo && !c.committed)
          const ids = contribs.map(c => c.id)
          if (ids.length > 0) {
            userContributionStore.markCommitted(ids)
            userContributionStore.markPushed(ids)
          }
          const retryNote = pushResult.retried ? ' (自动合并远程更新后推送)' : ''
          results.push({ repo, success: true, message: `已提交 ${newFilePaths.length} 个文件并推送${retryNote}` })
        } else {
          const contribs = userContributionStore.contributions.filter(c => c.repo === repo && !c.committed)
          const ids = contribs.map(c => c.id)
          if (ids.length > 0) {
            userContributionStore.markCommitted(ids)
          }
          results.push({ repo, success: false, message: '已提交但推送失败: ' + pushResult.message, step: 'push' })
        }
      }

      return { success: true, results }
    } catch (e) { return { success: false, error: String(e) } }
  })

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
