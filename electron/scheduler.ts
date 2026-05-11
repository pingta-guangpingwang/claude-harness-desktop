// ResourceScheduler — 并发资源调度器（AI 请求 / 文件 IO / CLI 调用）
type ResourceType = 'ai-call' | 'file-io' | 'cli-exec' | 'network'

interface QueueItem<T> {
  id: string
  type: ResourceType
  priority: number      // 数字越小越优先
  task: () => Promise<T>
  resolve: (value: T) => void
  reject: (err: Error) => void
  createdAt: number
}

export class ResourceScheduler {
  private queues = new Map<ResourceType, QueueItem<unknown>[]>()
  private activeCounts = new Map<ResourceType, number>()
  private limits = new Map<ResourceType, number>()
  private processing = false
  private onQueueChange: (() => void) | null = null

  constructor() {
    // 默认并发限制
    this.limits.set('ai-call', 3)      // 最多 3 个并发 AI 请求
    this.limits.set('file-io', 10)     // 文件 IO 几乎无限制
    this.limits.set('cli-exec', 5)     // CLI 可以适度并发
    this.limits.set('network', 5)

    for (const type of ['ai-call', 'file-io', 'cli-exec', 'network'] as ResourceType[]) {
      this.queues.set(type, [])
      this.activeCounts.set(type, 0)
    }
  }

  /** 设置某类型并发上限 */
  setLimit(type: ResourceType, limit: number): void {
    this.limits.set(type, Math.max(1, limit))
    this.processQueue(type)
  }

  /** 入队任务，返回 Promise */
  enqueue<T>(type: ResourceType, task: () => Promise<T>, priority: number = 10): Promise<T> {
    return new Promise((resolve, reject) => {
      const item: QueueItem<T> = {
        id: genId(),
        type,
        priority,
        task,
        resolve,
        reject,
        createdAt: Date.now(),
      }

      const queue = this.queues.get(type) || []
      queue.push(item as QueueItem<unknown>)
      // 按优先级排序
      queue.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)
      this.queues.set(type, queue)

      this.processQueue(type)
      this.onQueueChange?.()
    })
  }

  /** 获取队列状态 */
  getStatus(): Record<string, { queued: number; active: number; limit: number }> {
    const status: Record<string, { queued: number; active: number; limit: number }> = {}
    for (const type of ['ai-call', 'file-io', 'cli-exec', 'network'] as ResourceType[]) {
      status[type] = {
        queued: (this.queues.get(type) || []).length,
        active: this.activeCounts.get(type) || 0,
        limit: this.limits.get(type) || 5,
      }
    }
    return status
  }

  /** 队列变更回调 */
  onChange(cb: () => void): void { this.onQueueChange = cb }

  private async processQueue(type: ResourceType): Promise<void> {
    if (this.processing) return
    this.processing = true

    try {
      const queue = this.queues.get(type) || []
      const limit = this.limits.get(type) || 5

      while (queue.length > 0 && (this.activeCounts.get(type) || 0) < limit) {
        const item = queue.shift()
        if (!item) break

        this.activeCounts.set(type, (this.activeCounts.get(type) || 0) + 1)

        // 不 await，并行执行
        item.task()
          .then(result => { item.resolve(result) })
          .catch(err => { item.reject(err) })
          .finally(() => {
            this.activeCounts.set(type, (this.activeCounts.get(type) || 1) - 1)
            this.processQueue(type)
            this.onQueueChange?.()
          })
      }
    } finally {
      this.processing = false
      // 检查是否还有其他待处理
      for (const t of ['ai-call', 'file-io', 'cli-exec', 'network'] as ResourceType[]) {
        const q = this.queues.get(t) || []
        const limit = this.limits.get(t) || 5
        const active = this.activeCounts.get(t) || 0
        if (q.length > 0 && active < limit) {
          this.processQueue(t)
        }
      }
    }
  }
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// 单例
export const resourceScheduler = new ResourceScheduler()
