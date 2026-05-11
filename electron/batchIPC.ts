// BatchIPC — 合并细粒度 IPC 调用为批量操作，减少 round-trip
import { ipcMain } from 'electron'

interface BatchedCall {
  channel: string
  args: unknown[]
}

interface BatchResult {
  index: number
  result: unknown
  error?: string
}

export class BatchIPCHandler {
  private handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

  /** 注册可批量的处理器 */
  register(channel: string, handler: (...args: unknown[]) => Promise<unknown>): void {
    this.handlers.set(channel, handler)
  }

  /** 批量执行 */
  async executeBatch(calls: BatchedCall[]): Promise<BatchResult[]> {
    const results: BatchResult[] = []
    // 并行执行所有调用
    const promises = calls.map(async (call, index): Promise<BatchResult> => {
      try {
        const handler = this.handlers.get(call.channel)
        if (!handler) {
          return { index, result: null, error: `未知 channel: ${call.channel}` }
        }
        const result = await handler(...call.args)
        return { index, result }
      } catch (err) {
        return { index, result: null, error: String(err) }
      }
    })
    return Promise.all(promises)
  }
}

export const batchIPC = new BatchIPCHandler()

/** 注册批量 IPC 通道 */
export function registerBatchIPC(): void {
  ipcMain.handle('batch:execute', async (_event, calls: BatchedCall[]) => {
    try {
      const results = await batchIPC.executeBatch(calls)
      return { success: true, results }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('batch:register', async (_event, channel: string) => {
    // 从已有的 ipcMain handlers 中查找并注册
    const existing = (ipcMain as any)._events?.[channel]
    if (existing) {
      batchIPC.register(channel, async (...args: unknown[]) => {
        // 模拟 invoke 调用
        return new Promise((resolve, reject) => {
          try {
            const result = (ipcMain as any).emit?.(channel, { sender: null }, ...args)
            resolve(result)
          } catch (err) {
            reject(err)
          }
        })
      })
      return { success: true }
    }
    return { success: false, error: 'Channel not found' }
  })
}
