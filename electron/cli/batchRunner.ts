// CLI 批量执行器 — 支持串行/并行执行 + IPC 实时进度推送
import type { BatchTask, BatchResult, CommandContext, CommandResult } from './types'
import { CommandRegistry } from './registry'

export class BatchRunner {
  private running = false
  private abortController: AbortController | null = null
  private onProgress: ((event: BatchProgressEvent) => void) | null = null

  abort(): void {
    this.abortController?.abort()
    this.running = false
  }

  isRunning(): boolean {
    return this.running
  }

  async run(
    task: BatchTask,
    registry: CommandRegistry,
    ctx: CommandContext,
    onProgress?: (event: BatchProgressEvent) => void,
  ): Promise<BatchResult> {
    this.running = true
    this.abortController = new AbortController()
    this.onProgress = onProgress || null
    const signal = this.abortController.signal

    const results: Array<{ command: string; result: CommandResult; durationMs: number }> = []
    let successCount = 0
    let failCount = 0
    const startTime = Date.now()

    const emit = (event: BatchProgressEvent) => this.onProgress?.(event)

    emit({ type: 'batch_start', taskId: task.id, total: task.commands.length })

    if (task.mode === 'serial') {
      for (const item of task.commands) {
        if (signal.aborted) break
        emit({ type: 'step_start', taskId: task.id, command: item.command, index: results.length })

        const t0 = Date.now()
        const result = await registry.execute(item.command, item.args, {
          ...ctx,
          projectPath: item.projectPath || ctx.projectPath,
        })
        const durationMs = Date.now() - t0
        results.push({ command: item.command, result, durationMs })

        if (result.success) successCount++
        else failCount++

        emit({ type: 'step_end', taskId: task.id, command: item.command, result, durationMs, index: results.length - 1 })

        if (!result.success && task.stopOnError) {
          emit({ type: 'batch_error', taskId: task.id, message: `因错误停止: ${item.command}` })
          break
        }
      }
    } else {
      // 并行模式
      const promises = task.commands.map(async (item, index) => {
        if (signal.aborted) return null
        emit({ type: 'step_start', taskId: task.id, command: item.command, index })

        const t0 = Date.now()
        const result = await registry.execute(item.command, item.args, {
          ...ctx,
          projectPath: item.projectPath || ctx.projectPath,
        })
        const durationMs = Date.now() - t0

        emit({ type: 'step_end', taskId: task.id, command: item.command, result, durationMs, index })

        return { command: item.command, result, durationMs }
      })

      const settled = await Promise.all(promises)
      for (const r of settled) {
        if (!r) continue
        results.push(r)
        if (r.result.success) successCount++
        else failCount++
      }
    }

    this.running = false
    this.abortController = null

    const totalDurationMs = Date.now() - startTime
    emit({ type: 'batch_end', taskId: task.id, successCount, failCount, totalDurationMs })

    return { taskId: task.id, results, totalDurationMs, successCount, failCount }
  }
}

export interface BatchProgressEvent {
  type: 'batch_start' | 'step_start' | 'step_end' | 'batch_end' | 'batch_error'
  taskId: string
  command?: string
  result?: CommandResult
  index?: number
  durationMs?: number
  total?: number
  successCount?: number
  failCount?: number
  totalDurationMs?: number
  message?: string
}
