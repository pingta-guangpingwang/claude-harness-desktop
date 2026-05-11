// WorkflowScheduler — cron + 文件监听触发工作流
import { existsSync, watch, readFileSync, writeFileSync } from 'fs'
import { join, resolve as pathResolve } from 'path'
import type { WorkflowDefinition, WorkflowSchedule, WorkflowTrigger } from './types'
import { WorkflowEngine } from './engine'

interface ScheduledJob {
  id: string
  workflowId: string
  interval?: ReturnType<typeof setInterval>
  timeout?: ReturnType<typeof setTimeout>
  watcher?: ReturnType<typeof watch>
}

function getSchedulesPath(): string {
  try {
    const { app } = require('electron')
    const p = join(app.getPath('userData'), 'schedules.json')
    return p
  } catch { return join(process.cwd(), '.chd', 'schedules.json') }
}

export class WorkflowScheduler {
  private engine: WorkflowEngine
  private jobs = new Map<string, ScheduledJob>()
  private workflowStore = new Map<string, WorkflowDefinition>()
  private variablesStore = new Map<string, Record<string, unknown>>()

  constructor(engine: WorkflowEngine) {
    this.engine = engine
    this.loadScheduleState()
  }

  /** 注册工作流并启动调度 */
  register(workflow: WorkflowDefinition, variables?: Record<string, unknown>): void {
    this.workflowStore.set(workflow.id, workflow)
    if (variables) {
      this.variablesStore.set(workflow.id, variables)
    }

    // 停止旧调度
    this.unregister(workflow.id)

    // 启动新调度
    const triggers = workflow.triggers || []

    if (workflow.schedule?.enabled) {
      if (!triggers.find(t => t.type === 'schedule')) {
        triggers.push({ type: 'schedule' })
      }
    }

    for (const trigger of triggers) {
      this.startTrigger(workflow, trigger)
    }

    this.saveScheduleState()
  }

  /** 注销工作流调度 */
  unregister(workflowId: string): void {
    const job = this.jobs.get(workflowId)
    if (job) {
      if (job.interval) clearInterval(job.interval)
      if (job.timeout) clearTimeout(job.timeout)
      if (job.watcher) job.watcher.close()
      this.jobs.delete(workflowId)
    }
  }

  /** 手动触发工作流 */
  async trigger(workflowId: string): Promise<string> {
    const workflow = this.workflowStore.get(workflowId)
    if (!workflow) throw new Error(`工作流 ${workflowId} 未注册`)
    const state = await this.engine.run(workflow, this.variablesStore.get(workflowId))
    return state.runId
  }

  /** 获取已注册的工作流 */
  getRegistered(): string[] {
    return Array.from(this.workflowStore.keys())
  }

  /** 销毁调度器 */
  destroy(): void {
    for (const [, job] of this.jobs) {
      if (job.interval) clearInterval(job.interval)
      if (job.timeout) clearTimeout(job.timeout)
      if (job.watcher) job.watcher.close()
    }
    this.jobs.clear()
    this.workflowStore.clear()
  }

  private startTrigger(workflow: WorkflowDefinition, trigger: WorkflowTrigger): void {
    switch (trigger.type) {
      case 'schedule': {
        if (!workflow.schedule?.cron) break
        const ms = this.cronToMs(workflow.schedule.cron)
        if (ms > 0) {
          const interval = setInterval(() => {
            this.engine.run(workflow, this.variablesStore.get(workflow.id))
          }, ms)
          this.jobs.set(workflow.id, { id: workflow.id, workflowId: workflow.id, interval })
        }
        break
      }
      case 'file_change': {
        const watchPath = (trigger.config?.path as string) || workflow.projectPath
        if (!watchPath || !existsSync(watchPath)) break
        try {
          const watcher = watch(watchPath, { recursive: false }, () => {
            this.engine.run(workflow, this.variablesStore.get(workflow.id))
          })
          this.jobs.set(`${workflow.id}_file`, {
            id: `${workflow.id}_file`, workflowId: workflow.id, watcher,
          })
        } catch { /* watch failed */ }
        break
      }
      // manual / webhook / project_start 不在调度器中处理
      default:
        break
    }
  }

  /** 简单的 cron 到毫秒转换（仅支持基本格式） */
  private cronToMs(cron: string): number {
    const parts = cron.trim().split(/\s+/)
    if (parts.length !== 5) return 0

    // */N 格式 → 每 N 分钟/小时
    if (parts[0].startsWith('*/')) {
      const mins = parseInt(parts[0].slice(2), 10)
      if (!isNaN(mins)) return mins * 60 * 1000
    }
    if (parts[1].startsWith('*/')) {
      const hours = parseInt(parts[1].slice(2), 10)
      if (!isNaN(hours)) return hours * 3600 * 1000
    }

    // 具体时间 "M H * * *" → 计算到下一个触发点的毫秒数
    const now = new Date()
    const target = new Date(now)
    target.setMinutes(parseInt(parts[0]) || 0, 0, 0)
    if (parts[1] !== '*') target.setHours(parseInt(parts[1]) || 0)
    if (target <= now) target.setDate(target.getDate() + 1)
    return target.getTime() - now.getTime()
  }

  private saveScheduleState(): void {
    try {
      const path = getSchedulesPath()
      const data = Array.from(this.workflowStore.keys())
      writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
    } catch { /* ignore */ }
  }

  private loadScheduleState(): void {
    // 状态恢复在 main.ts 中手动触发，此处在启动时加载工作流定义
  }
}
