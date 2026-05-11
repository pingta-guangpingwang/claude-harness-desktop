// 驾驭智能体 — 任务队列
// 支持：优先级排序、状态追踪、跨轮次持久化、自主循环取料

export interface AgentTask {
  id: string
  type: 'user_request' | 'auto_check' | 'follow_up' | 'scheduled'
  projectPath?: string
  instruction: string
  priority: number  // 1=高 2=中 3=低
  status: 'pending' | 'running' | 'done' | 'failed'
  createdAt: string
  updatedAt: string
  result?: string
  /** 若是 follow_up，记录来源任务 */
  parentId?: string
}

function createId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

class AgentTaskQueue {
  private tasks = new Map<string, AgentTask>()
  private order: string[] = [] // 保持插入顺序

  /** 添加任务，返回任务 ID */
  add(task: Omit<AgentTask, 'id' | 'status' | 'createdAt' | 'updatedAt'>): string {
    const id = createId()
    const now = new Date().toISOString()
    this.tasks.set(id, {
      ...task,
      id,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    })
    this.order.push(id)
    // 按优先级排序
    this.order.sort((a, b) => {
      const pa = this.tasks.get(a)?.priority ?? 2
      const pb = this.tasks.get(b)?.priority ?? 2
      return pa - pb
    })
    console.log('[TaskQueue] 添加任务:', id, task.type, task.instruction.slice(0, 60))
    return id
  }

  /** 获取下一个待处理任务（优先级最高、最旧） */
  getNext(): AgentTask | null {
    for (const id of this.order) {
      const t = this.tasks.get(id)
      if (t?.status === 'pending') return t
    }
    return null
  }

  /** 更新任务状态 */
  updateStatus(id: string, status: AgentTask['status'], result?: string): void {
    const t = this.tasks.get(id)
    if (!t) return
    t.status = status
    t.updatedAt = new Date().toISOString()
    if (result) t.result = result
  }

  /** 获取任务 */
  get(id: string): AgentTask | undefined {
    return this.tasks.get(id)
  }

  /** 列出所有任务（可按状态过滤） */
  list(status?: AgentTask['status']): AgentTask[] {
    const all = this.order.map(id => this.tasks.get(id)!).filter(Boolean)
    return status ? all.filter(t => t.status === status) : all
  }

  /** 列出指定项目的待办 */
  listByProject(projectPath: string): AgentTask[] {
    return this.list().filter(t => t.projectPath === projectPath)
  }

  /** 清空已完成/失败的任务 */
  clearCompleted(): number {
    let count = 0
    for (const [id, t] of this.tasks) {
      if (t.status === 'done' || t.status === 'failed') {
        this.tasks.delete(id)
        count++
      }
    }
    this.order = this.order.filter(id => this.tasks.has(id))
    return count
  }

  /** 获取统计 */
  stats(): { total: number; pending: number; running: number; done: number; failed: number } {
    let pending = 0; let running = 0; let done = 0; let failed = 0
    for (const t of this.tasks.values()) {
      switch (t.status) {
        case 'pending': pending++; break
        case 'running': running++; break
        case 'done': done++; break
        case 'failed': failed++; break
      }
    }
    return { total: this.tasks.size, pending, running, done, failed }
  }

  /** 获取待办数量 */
  get pendingCount(): number {
    let n = 0
    for (const t of this.tasks.values()) { if (t.status === 'pending') n++ }
    return n
  }

  /** 序列化（供 IPC 返回渲染进程） */
  toJSON(): AgentTask[] {
    return this.order.map(id => this.tasks.get(id)!).filter(Boolean)
  }
}

/** 全局单例 */
export const taskQueue = new AgentTaskQueue()
