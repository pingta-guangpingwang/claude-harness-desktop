// Workflow IPC — 工作流管理 IPC 桥接
import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { WorkflowDefinition } from './types'
import { DEFAULT_RETRY_POLICY } from './types'
import { WorkflowEngine } from './engine'
import { WorkflowScheduler } from './scheduler'

let engine: WorkflowEngine
let scheduler: WorkflowScheduler

function getWorkflowsDir(): string {
  try {
    const { app } = require('electron')
    const p = join(app.getPath('userData'), 'workflows')
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
    return p
  } catch {
    const p = join(process.cwd(), '.chd', 'workflows')
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
    return p
  }
}

function saveWorkflowDef(workflow: WorkflowDefinition): void {
  const dir = getWorkflowsDir()
  writeFileSync(join(dir, `${workflow.id}.json`), JSON.stringify(workflow, null, 2), 'utf-8')
}

function loadWorkflowDefs(): WorkflowDefinition[] {
  const dir = getWorkflowsDir()
  if (!existsSync(dir)) return []
  const { readdirSync } = require('fs')
  const files = readdirSync(dir).filter((f: string) => f.endsWith('.json'))
  const defs: WorkflowDefinition[] = []
  for (const f of files) {
    try {
      const raw = readFileSync(join(dir, f), 'utf-8')
      defs.push(JSON.parse(raw))
    } catch { /* skip corrupt */ }
  }
  return defs
}

function deleteWorkflowDef(id: string): void {
  const dir = getWorkflowsDir()
  const filePath = join(dir, `${id}.json`)
  if (existsSync(filePath)) {
    const { unlinkSync } = require('fs')
    unlinkSync(filePath)
  }
}

/**
 * 注册工作流 IPC 通道：
 *   workflow:register  — 注册/更新工作流定义并启动调度
 *   workflow:unregister — 移除工作流
 *   workflow:run       — 手动触发执行
 *   workflow:abort     — 中止运行
 *   workflow:list      — 列出所有已注册工作流
 *   workflow:get-state — 获取运行状态
 *   workflow:save      — 持久化工作流定义
 *   workflow:load      — 加载所有持久化定义
 *   workflow:delete    — 删除工作流定义
 */
export function registerWorkflowIpc(mainWindow: BrowserWindow): void {
  engine = new WorkflowEngine({
    log: (msg) => {
      mainWindow.webContents.send('workflow:event', { type: 'log', message: msg })
    },
    executeCli: async (command, args, projectPath) => {
      const { execSync } = await import('child_process')
      try {
        const cwd = projectPath || process.cwd()
        const argStr = Object.entries(args || {}).map(([k, v]) => `--${k} ${v}`).join(' ')
        const cmd = `${command} ${argStr}`.trim()
        const output = execSync(cmd, { cwd, timeout: 60000, encoding: 'utf-8', maxBuffer: 1024 * 1024 })
        return { success: true, output }
      } catch (err: any) {
        return { success: false, output: err.stderr || err.message || String(err) }
      }
    },
    callAI: async (prompt, model) => {
      try {
        const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY
        if (!apiKey) return '[AI call: no API key configured]'
        const res = await (globalThis as any).fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: model || 'deepseek-chat', messages: [{ role: 'user', content: prompt }], max_tokens: 4000 }),
        })
        const json = await res.json()
        return json?.choices?.[0]?.message?.content || JSON.stringify(json)
      } catch (err) {
        return `[AI call failed: ${String(err)}]`
      }
    },
  })

  scheduler = new WorkflowScheduler(engine)

  // 启动时加载已持久化的工作流
  const savedDefs = loadWorkflowDefs()
  for (const def of savedDefs) {
    scheduler.register(def)
  }

  // ---- IPC Handlers ----

  ipcMain.handle('workflow:register', async (_event, workflow: WorkflowDefinition) => {
    try {
      // 确保有 retryPolicy
      if (!workflow.retryPolicy) {
        workflow.retryPolicy = { ...DEFAULT_RETRY_POLICY }
      }
      workflow.updatedAt = new Date().toISOString()
      scheduler.register(workflow)
      saveWorkflowDef(workflow)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('workflow:unregister', async (_event, workflowId: string) => {
    try {
      scheduler.unregister(workflowId)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('workflow:run', async (_event, workflowId: string) => {
    try {
      const runId = await scheduler.trigger(workflowId)
      return { success: true, runId }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('workflow:abort', async (_event, runId: string) => {
    try {
      const ok = engine.abort(runId)
      return { success: ok, error: ok ? undefined : '未找到运行实例' }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('workflow:list', async () => {
    const ids = scheduler.getRegistered()
    return { success: true, workflows: ids }
  })

  ipcMain.handle('workflow:get-state', async (_event, runId: string) => {
    const state = engine.getRunState(runId)
    return { success: true, state: state || null }
  })

  ipcMain.handle('workflow:get-active-runs', async () => {
    const runs = engine.getActiveRuns()
    return { success: true, runs }
  })

  ipcMain.handle('workflow:save', async (_event, workflow: WorkflowDefinition) => {
    try {
      if (!workflow.retryPolicy) {
        workflow.retryPolicy = { ...DEFAULT_RETRY_POLICY }
      }
      workflow.updatedAt = new Date().toISOString()
      saveWorkflowDef(workflow)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('workflow:load', async () => {
    try {
      const defs = loadWorkflowDefs()
      return { success: true, workflows: defs }
    } catch (err) {
      return { success: false, error: String(err), workflows: [] }
    }
  })

  ipcMain.handle('workflow:delete', async (_event, workflowId: string) => {
    try {
      scheduler.unregister(workflowId)
      deleteWorkflowDef(workflowId)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // 推送工作流事件到渲染进程
  ipcMain.handle('workflow:subscribe', (_event, runId: string) => {
    engine.onRunEvent(runId, (wfEvent) => {
      mainWindow.webContents.send('workflow:event', { runId, ...wfEvent })
    })
    return { success: true }
  })
}

export function getWorkflowEngine(): WorkflowEngine {
  return engine
}

export function getWorkflowScheduler(): WorkflowScheduler {
  return scheduler
}
