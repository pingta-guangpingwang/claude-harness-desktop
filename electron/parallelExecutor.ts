// ParallelToolExecutor — 并行工具执行 + Sibling abort（基于 Claude Code StreamingToolExecutor 设计）
import type { AgentTool, AgentContext, ToolResult } from './harnessAgent/types'

interface ToolTask {
  tool: AgentTool
  params: Record<string, unknown>
  ctx: AgentContext
  id: string
}

interface ToolTaskResult {
  id: string
  name: string
  success: boolean
  output: string
  metadata?: Record<string, unknown>
}

export type BatchExecutionMode = 'sequential' | 'parallel_readonly' | 'force_sequential'

/**
 * 分析工具列表，将 read-only / concurrency-safe 工具分组并行执行
 *
 * 规则（对标 Claude Code）：
 * 1. isReadOnly=true 或 isConcurrencySafe=true 的工具可以与其他只读工具并行
 * 2. 写操作（isReadOnly=false, isConcurrencySafe=false）必须串行执行
 * 3. 同一批次中任一工具报错 → 取消同批次其余工具（sibling abort）
 */
export function partitionForExecution(declarations: Array<{
  name: string
  params: Record<string, unknown>
  tools: Map<string, AgentTool>
}>): Array<Array<{ name: string; params: Record<string, unknown> }>> {
  const batches: Array<Array<{ name: string; params: Record<string, unknown> }>> = []
  let currentBatch: Array<{ name: string; params: Record<string, unknown> }> = []

  for (const decl of declarations) {
    const tool = decl.tools.get(decl.name)
    const isRead = evaluateFlag(tool?.isReadOnly, decl.params) || tool?.isConcurrencySafe

    if (isRead) {
      // 可并行 → 加入当前批次
      currentBatch.push({ name: decl.name, params: decl.params })
    } else {
      // 不可并行 → 先提交当前批次，再单独成批
      if (currentBatch.length > 0) {
        batches.push(currentBatch)
        currentBatch = []
      }
      batches.push([{ name: decl.name, params: decl.params }])
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return batches
}

/**
 * 执行一批工具调用（可能并行，也可能逐批串行）
 *
 * @param calls - 按声明顺序的工具调用
 * @param toolMap - 工具名 → AgentTool 映射
 * @param ctx - AgentContext
 * @param execute - 单个工具执行函数
 * @param onResult - 每个工具完成时的回调（用于事件推送）
 * @param signal - AbortController signal
 */
export async function executeBatch(
  calls: Array<{ name: string; params: Record<string, unknown> }>,
  toolMap: Map<string, AgentTool>,
  ctx: AgentContext,
  execute: (name: string, params: Record<string, unknown>, ctx: AgentContext) => Promise<ToolResult>,
  onResult: (result: ToolTaskResult) => void,
  signal?: AbortSignal,
): Promise<ToolTaskResult[]> {
  const results: ToolTaskResult[] = []

  // 将调用与工具对象关联
  const declarations = calls.map(c => ({
    name: c.name,
    params: c.params,
    tools: toolMap,
  }))

  const batches = partitionForExecution(declarations)

  for (const batch of batches) {
    if (signal?.aborted) break

    if (batch.length === 1) {
      // 单一工具 → 直接执行
      const { name, params } = batch[0]
      try {
        const result = await execute(name, params, ctx)
        const taskResult: ToolTaskResult = {
          id: `${name}_${Date.now().toString(36)}`,
          name,
          success: result.success,
          output: result.output,
          metadata: result.metadata,
        }
        results.push(taskResult)
        onResult(taskResult)
      } catch (err) {
        const taskResult: ToolTaskResult = {
          id: `${name}_${Date.now().toString(36)}`,
          name,
          success: false,
          output: String(err),
        }
        results.push(taskResult)
        onResult(taskResult)
      }
    } else {
      // 并行批次
      const batchSignal = new AbortController()
      let siblingFailed = false

      // 如果外部 signal abort → 取消批次
      const onExternalAbort = () => batchSignal.abort()
      signal?.addEventListener('abort', onExternalAbort, { once: true })

      const promises = batch.map(async ({ name, params }) => {
        if (batchSignal.signal.aborted) return null

        try {
          const result = await execute(name, params, ctx)
          const taskResult: ToolTaskResult = {
            id: `${name}_${Date.now().toString(36)}`,
            name,
            success: result.success,
            output: result.output,
            metadata: result.metadata,
          }

          if (!result.success) {
            siblingFailed = true
            batchSignal.abort() // sibling abort
          }

          return taskResult
        } catch (err) {
          siblingFailed = true
          batchSignal.abort()
          return {
            id: `${name}_${Date.now().toString(36)}`,
            name,
            success: false,
            output: String(err),
          } as ToolTaskResult
        }
      })

      const batchResults = await Promise.all(promises)
      signal?.removeEventListener('abort', onExternalAbort)

      for (const r of batchResults) {
        if (r) {
          results.push(r)
          onResult(r)
        }
      }
    }
  }

  return results
}

/** 检查 flag 值（支持 boolean | function） */
function evaluateFlag(
  flag: boolean | ((params: Record<string, unknown>) => boolean) | undefined,
  params: Record<string, unknown>,
): boolean {
  if (typeof flag === 'function') return flag(params)
  return flag ?? false
}
