export interface DecisionSpan {
    spanId: string;
    traceId: string;
    parentSpanId?: string;
    span: 'llm_call' | 'tool_exec' | 'role_switch' | 'reflection' | 'heartbeat' | 'compression';
    timestamp: string;
    durationMs: number;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    error?: string;
}
export interface DecisionTrace {
    traceId: string;
    conversationId: string;
    startedAt: string;
    spans: DecisionSpan[];
}
export declare class DecisionTracer {
    private traces;
    private currentTraceId;
    private conversationId;
    private spanStack;
    private maxTraces;
    constructor(conversationId: string);
    /** 开始一个新的 span */
    startSpan(span: DecisionSpan['span'], input?: Record<string, unknown>, parentSpanId?: string): string;
    /** 结束一个 span */
    endSpan(spanId: string, output?: Record<string, unknown>, error?: string): void;
    /** 便捷方法：包装一个异步操作 */
    trace<T>(span: DecisionSpan['span'], input: Record<string, unknown>, fn: () => Promise<T>): Promise<{
        result: T;
        spanId: string;
    }>;
    /** 开始新的 trace（角色切换时） */
    newTrace(reason?: string): string;
    /** 获取当前 trace */
    getCurrentTrace(): DecisionTrace | undefined;
    /** 按 ID 获取 trace */
    getTraceById(traceId: string): DecisionTrace | undefined;
    /** 获取所有 traces */
    getAllTraces(): DecisionTrace[];
    /** 导出最近 N 条 span 为 JSON（用于前端展示） */
    exportRecentSpans(count?: number): DecisionSpan[];
    /** 获取决策摘要（用于 LLM 上下文注入） */
    getDecisionSummary(): string;
    /** 清空所有 traces */
    clear(): void;
    private generateId;
}
