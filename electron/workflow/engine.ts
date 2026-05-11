// WorkflowEngine — 执行 WorkflowDefinition，推流事件到渲染进程
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import type {
  WorkflowDefinition, WorkflowNode, WorkflowEdge,
  WorkflowNodeResult, WorkflowRunState, WorkflowEvent,
} from './types'

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

interface EngineDeps {
  /** 执行 CLI 命令 */
  executeCli?: (command: string, args: Record<string, unknown>, projectPath?: string) => Promise<{ success: boolean; output: string }>
  /** 调用 AI */
  callAI?: (prompt: string, model?: string) => Promise<string>
  /** 日志 */
  log?: (msg: string) => void
}

export class WorkflowEngine {
  private deps: EngineDeps
  private activeRuns = new Map<string, { state: WorkflowRunState; abortController: AbortController }>()
  private eventCallbacks = new Map<string, Array<(event: WorkflowEvent) => void>>()

  constructor(deps: EngineDeps = {}) {
    this.deps = deps
  }

  /** 执行工作流 */
  async run(workflow: WorkflowDefinition, variables?: Record<string, unknown>): Promise<WorkflowRunState> {
    const runId = genId()
    const abortController = new AbortController()

    const state: WorkflowRunState = {
      runId, workflowId: workflow.id,
      status: 'running', currentNodeId: null,
      completedNodes: [], nodeResults: {},
      variables: { ...(workflow.variables || {}), ...(variables || {}) },
      startedAt: new Date().toISOString(),
      retryCount: 0,
    }

    this.activeRuns.set(runId, { state, abortController })
    this.emit(runId, { type: 'run_started', runId })

    try {
      // 找到开始节点
      const startNode = workflow.nodes.find(n => n.type === 'control.start')
      if (!startNode) {
        throw new Error('工作流缺少开始节点 (control.start)')
      }

      let currentNode: WorkflowNode | undefined = startNode

      while (currentNode && !abortController.signal.aborted) {
        state.currentNodeId = currentNode.id
        this.emit(runId, { type: 'node_started', runId, nodeId: currentNode.id })

        const startTime = Date.now()
        let result: WorkflowNodeResult

        try {
          result = await this.executeNode(currentNode, state)
        } catch (err) {
          result = {
            nodeId: currentNode.id,
            success: false,
            output: '',
            durationMs: Date.now() - startTime,
            error: String(err),
          }
        }

        state.nodeResults[currentNode.id] = result
        state.completedNodes.push(currentNode.id)

        if (result.success) {
          this.emit(runId, { type: 'node_completed', runId, nodeId: currentNode.id, result })
        } else {
          // 重试逻辑
          const retryPolicy = workflow.retryPolicy
          let retryOk = false
          for (let i = 0; i < retryPolicy.maxRetries && !abortController.signal.aborted; i++) {
            state.retryCount++
            this.emit(runId, { type: 'retrying', runId, nodeId: currentNode.id, attempt: i + 1 })
            const delay = retryPolicy.delayMs * Math.pow(retryPolicy.backoffMultiplier || 2, i)
            await new Promise(r => setTimeout(r, delay))

            try {
              result = await this.executeNode(currentNode, state)
              if (result.success) {
                state.nodeResults[currentNode.id] = result
                retryOk = true
                break
              }
            } catch { /* continue retry */ }
          }

          if (!retryOk) {
            this.emit(runId, { type: 'node_failed', runId, nodeId: currentNode.id, error: result.error || '节点执行失败' })
            state.status = 'failed'
            break
          }
        }

        // 查找下一个节点
        const nextEdge = workflow.edges.find(e => e.source === currentNode!.id)
        if (!nextEdge) break

        currentNode = workflow.nodes.find(n => n.id === nextEdge.target)
        // 处理条件分支
        if (nextEdge.condition && currentNode) {
          try {
            const cond = this.resolveVariables(nextEdge.condition, state.variables)
            const pass = new Function('vars', `with(vars) { return !!(${cond}) }`)(state.variables)
            if (!pass) {
              // 找另一条边
              const altEdge = workflow.edges.find(e => e.source === state.currentNodeId && e.id !== nextEdge.id)
              currentNode = altEdge ? workflow.nodes.find(n => n.id === altEdge.target) : undefined
            }
          } catch {
            // 条件执行出错=走默认
          }
        }
      }

      if (state.status !== 'failed') {
        state.status = abortController.signal.aborted ? 'aborted' : 'completed'
      }
      state.completedAt = new Date().toISOString()
    } catch (err) {
      state.status = 'failed'
      state.completedAt = new Date().toISOString()
    }

    this.emit(runId, {
      type: state.status === 'completed' ? 'run_completed' : state.status === 'aborted' ? 'run_aborted' : 'run_completed',
      runId,
      success: state.status === 'completed',
    })

    this.activeRuns.delete(runId)
    return state
  }

  /** 中止工作流 */
  abort(runId: string): boolean {
    const entry = this.activeRuns.get(runId)
    if (entry) {
      entry.abortController.abort()
      return true
    }
    return false
  }

  /** 获取运行状态 */
  getRunState(runId: string): WorkflowRunState | undefined {
    return this.activeRuns.get(runId)?.state
  }

  /** 获取所有活跃运行 */
  getActiveRuns(): WorkflowRunState[] {
    return Array.from(this.activeRuns.values()).map(e => e.state)
  }

  /** 注册事件监听 */
  onRunEvent(runId: string, callback: (event: WorkflowEvent) => void): () => void {
    const listeners = this.eventCallbacks.get(runId) || []
    listeners.push(callback)
    this.eventCallbacks.set(runId, listeners)
    return () => {
      const arr = this.eventCallbacks.get(runId)
      if (arr) {
        const idx = arr.indexOf(callback)
        if (idx >= 0) arr.splice(idx, 1)
      }
    }
  }

  private emit(runId: string, event: WorkflowEvent): void {
    const listeners = this.eventCallbacks.get(runId) || []
    for (const cb of listeners) {
      try { cb(event) } catch { /* ignore */ }
    }
  }

  private async executeNode(node: WorkflowNode, state: WorkflowRunState): Promise<WorkflowNodeResult> {
    const start = Date.now()
    let output = ''
    const cfg = node.config

    switch (node.type) {
      case 'control.start':
      case 'control.end':
        output = 'OK'
        break

      case 'cli.command': {
        if (!cfg.command) throw new Error('缺少 command 配置')
        if (this.deps.executeCli) {
          const res = await this.deps.executeCli(cfg.command, cfg.args || {}, cfg.projectPath || state.variables['projectPath'] as string)
          if (!res.success) throw new Error(res.output)
          output = res.output
        } else {
          const cwd = (cfg.projectPath || state.variables['projectPath'] as string) || process.cwd()
          output = execSync(cfg.command, { cwd, timeout: 60000, encoding: 'utf-8', maxBuffer: 1024 * 1024 })
        }
        break
      }

      case 'ai.call': {
        if (!cfg.aiPrompt) throw new Error('缺少 aiPrompt 配置')
        if (this.deps.callAI) {
          output = await this.deps.callAI(
            this.resolveVariables(cfg.aiPrompt, state.variables),
            cfg.aiModel,
          )
        } else {
          output = '[AI call not available — no engine deps]'
        }
        break
      }

      case 'file.read': {
        const filePath = this.resolveVariables(cfg.filePath || '', state.variables)
        if (!existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`)
        output = readFileSync(filePath, 'utf-8')
        break
      }

      case 'file.write': {
        const filePath = this.resolveVariables(cfg.filePath || '', state.variables)
        const content = this.resolveVariables(cfg.fileContent || '', state.variables)
        const dir = filePath.replace(/[/\\][^/\\]+$/, '')
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        writeFileSync(filePath, content, 'utf-8')
        output = `写入完成: ${filePath} (${content.length} 字符)`
        break
      }

      case 'delay': {
        const ms = cfg.delayMs || 1000
        await new Promise(r => setTimeout(r, ms))
        output = `等待 ${ms}ms 完成`
        break
      }

      case 'notification': {
        output = cfg.notificationMessage || '通知'
        this.deps.log?.(`[Workflow Notification] ${output}`)
        break
      }

      case 'condition':
      case 'loop':
        // 条件/循环节点由引擎自身处理，此处为桩
        output = 'OK'
        break

      case 'n8n.webhook': {
        if (!cfg.webhookUrl) throw new Error('缺少 webhookUrl')
        try {
          const res = await (globalThis as any).fetch(cfg.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ variables: state.variables }),
          })
          output = `Webhook 响应: ${res.status}`
        } catch (err) {
          throw new Error(`Webhook 失败: ${String(err)}`)
        }
        break
      }

      case 'plugin.call': {
        output = '[Plugin call — not yet implemented]'
        break
      }

      default:
        throw new Error(`未知节点类型: ${node.type}`)
    }

    return { nodeId: node.id, success: true, output, durationMs: Date.now() - start }
  }

  private resolveVariables(template: string, vars: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ''))
  }
}
