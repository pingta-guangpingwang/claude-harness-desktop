// 驾驭智能体 — 定时调度器
// 支持周期任务注入到 taskQueue，配合自主循环实现后台监控

import { taskQueue, type AgentTask } from './taskQueue.js'

export interface ScheduledTask {
  id: string
  name: string
  prompt: string           // 触发时注入给 Agent 的提示
  projectPath?: string     // 可选：仅针对特定项目
  intervalMs: number       // 间隔毫秒
  lastRun: number          // 上次触发时间戳
  enabled: boolean
  /** 一次性任务：执行一次后自动删除 */
  once?: boolean
}

function createId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

class HarnessScheduler {
  private tasks = new Map<string, ScheduledTask>()
  private timers = new Map<string, NodeJS.Timeout>()
  /** 当调度器触发时，回调通知外部可触发自主 Agent */
  private onTrigger: (() => void) | null = null

  /** 注册唤醒回调 — 供 harnessIpc 绑定，调度触发时通知 Agent 循环取队列任务 */
  setOnTrigger(fn: () => void): void {
    this.onTrigger = fn
  }

  /** 添加定时任务 */
  add(name: string, prompt: string, intervalMs: number, projectPath?: string): string {
    const id = createId()
    const task: ScheduledTask = {
      id, name, prompt, projectPath, intervalMs, lastRun: 0, enabled: true,
    }
    this.tasks.set(id, task)
    this.scheduleNext(id)
    console.log('[Scheduler] 添加定时任务:', name, '间隔:', Math.round(intervalMs / 1000), 's')
    return id
  }

  /** 添加一次性延时任务 */
  addOnce(name: string, prompt: string, delayMs: number, projectPath?: string): string {
    const id = createId()
    const task: ScheduledTask = {
      id, name, prompt, projectPath, intervalMs: delayMs, lastRun: 0, enabled: true, once: true,
    }
    this.tasks.set(id, task)
    this.scheduleNext(id)
    return id
  }

  /** 移除定时任务 */
  remove(id: string): boolean {
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)
    return this.tasks.delete(id)
  }

  /** 启用/禁用 */
  setEnabled(id: string, enabled: boolean): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.enabled = enabled
    if (enabled) {
      this.scheduleNext(id)
    } else {
      const timer = this.timers.get(id)
      if (timer) clearTimeout(timer)
      this.timers.delete(id)
    }
  }

  /** 列出所有定时任务 */
  list(): ScheduledTask[] {
    return Array.from(this.tasks.values())
  }

  /** 获取统计 */
  stats(): { total: number; enabled: number; nextRunMs: number | null } {
    const all = Array.from(this.tasks.values())
    const enabled = all.filter(t => t.enabled)
    let nextRunMs: number | null = null
    for (const t of enabled) {
      const next = (t.lastRun + t.intervalMs) - Date.now()
      if (next > 0 && (nextRunMs === null || next < nextRunMs)) nextRunMs = next
    }
    return { total: all.length, enabled: enabled.length, nextRunMs }
  }

  /** 销毁所有定时器 */
  destroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.tasks.clear()
  }

  private scheduleNext(id: string): void {
    const task = this.tasks.get(id)
    if (!task || !task.enabled) return

    // 清除旧定时器
    const old = this.timers.get(id)
    if (old) clearTimeout(old)

    const delay = task.intervalMs
    const timer = setTimeout(() => {
      this.fire(id)
    }, delay)
    this.timers.set(id, timer)
  }

  private fire(id: string): void {
    const task = this.tasks.get(id)
    if (!task || !task.enabled) return

    task.lastRun = Date.now()
    console.log('[Scheduler] 触发:', task.name)

    // 注入任务到队列
    taskQueue.add({
      type: 'scheduled',
      projectPath: task.projectPath,
      instruction: task.prompt,
      priority: 2,
    })

    // 一次性任务：执行后自动删除
    if (task.once) {
      this.tasks.delete(id)
      this.timers.delete(id)
    } else {
      // 重新调度下一次
      this.scheduleNext(id)
    }

    // 通知外部（触发 Agent 自主循环取队列任务）
    this.onTrigger?.()
  }
}

/** 全局单例 */
export const harnessScheduler = new HarnessScheduler()
