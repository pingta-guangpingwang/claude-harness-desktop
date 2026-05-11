import type { AgentTool, AgentContext, ToolResult } from './harnessAgent/types';
interface ToolTaskResult {
    id: string;
    name: string;
    success: boolean;
    output: string;
    metadata?: Record<string, unknown>;
}
export type BatchExecutionMode = 'sequential' | 'parallel_readonly' | 'force_sequential';
/**
 * 分析工具列表，将 read-only / concurrency-safe 工具分组并行执行
 *
 * 规则（对标 Claude Code）：
 * 1. isReadOnly=true 或 isConcurrencySafe=true 的工具可以与其他只读工具并行
 * 2. 写操作（isReadOnly=false, isConcurrencySafe=false）必须串行执行
 * 3. 同一批次中任一工具报错 → 取消同批次其余工具（sibling abort）
 */
export declare function partitionForExecution(declarations: Array<{
    name: string;
    params: Record<string, unknown>;
    tools: Map<string, AgentTool>;
}>): Array<Array<{
    name: string;
    params: Record<string, unknown>;
}>>;
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
export declare function executeBatch(calls: Array<{
    name: string;
    params: Record<string, unknown>;
}>, toolMap: Map<string, AgentTool>, ctx: AgentContext, execute: (name: string, params: Record<string, unknown>, ctx: AgentContext) => Promise<ToolResult>, onResult: (result: ToolTaskResult) => void, signal?: AbortSignal): Promise<ToolTaskResult[]>;
export {};
