import type { AgentContext, AgentEvent } from './types';
import { PermissionManager } from './permissionManager';
export interface ConversationTurn {
    role: 'user' | 'assistant';
    content: string;
}
export declare class AgentLoop {
    private messages;
    private ctx;
    private permissionManager;
    private abortController;
    private pendingPermission;
    private eventCallback;
    readonly conversationId: string;
    constructor(ctx: AgentContext, pm: PermissionManager, conversationHistory?: ConversationTurn[]);
    abort(): void;
    resolvePermission(decision: 'allow' | 'deny' | 'allow_once'): void;
    run(userMessage: string, onEvent: (event: AgentEvent) => void): Promise<string>;
    /** 启动后台上下文预取（非阻塞） */
    private startContextPrefetch;
    /**
     * 调用 DeepSeek API（OpenAI 兼容格式，支持 tool calling）
     */
    private callLLMStream;
    private extractToolCalls;
    private buildSystemPrompt;
    /** 智能压缩：提取早期轮次中的关键信息，保留项目状态和任务结果 */
    private compressHistory;
    /** 内存压力监控 — 估算 token 用量，超过阈值时结构化压缩（复用 compressHistory 的语义提取逻辑） */
    private checkMemoryPressure;
    private waitForPermission;
}
