import type { AgentContext, AgentEvent } from './types';
import { PermissionManager } from './permissionManager';
import { SemanticMemory } from './semanticMemory.js';
import { DecisionTracer } from './decisionTracer.js';
import { HITLManager } from './hitlManager.js';
import { RoleManager } from './roleManager.js';
import { DocToSkillLoader } from './docToSkill.js';
import { RoleScorer, type TaskRecord } from './roleScorer.js';
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
    private roundIndex;
    private memory;
    private tokenBudgeter;
    private semanticMemory;
    private tracer;
    private hitl;
    private roleManager;
    private docToSkill;
    private roleScorer;
    private toolStartTimes;
    constructor(ctx: AgentContext, pm: PermissionManager, conversationHistory?: ConversationTurn[]);
    abort(): void;
    /** 用户中途插入消息 → 加入队列 + 立即中断当前 API 调用（Claude Code 范式）。
     *  不中断整个 Agent 循环，只中断当前 LLM 请求，让新消息在下一轮立即生效。 */
    queueMessage(msg: string): void;
    /** 检查并取出排队消息（外部调用，Agent 完成后检查是否需要继续处理） */
    popPendingMessage(): string | undefined;
    /** 是否还有排队消息 */
    hasPendingMessages(): boolean;
    resolvePermission(decision: 'allow' | 'deny' | 'allow_once'): void;
    run(userMessage: string, onEvent: (event: AgentEvent) => void): Promise<string>;
    /** 启动后台上下文预取（非阻塞） */
    private startContextPrefetch;
    /**
     * 轻量级 Reflection 调用 — 使用 tool_choice: 'none' 强制纯文本输出
     * 速度极快（~1-2s），token 消耗极低（~200 tokens）
     */
    private runReflection;
    private _lastReflectionAt;
    /**
     * 调用 DeepSeek API（OpenAI 兼容格式，支持 tool calling）
     */
    private callLLMStream;
    private extractToolCalls;
    private buildSystemPrompt;
    /** 智能压缩：提取早期轮次中的关键信息，保留项目状态和任务结果 */
    /** 工具结果智能摘要 — 超过 500 字符的结果提取关键行，避免噪声淹没 LLM */
    private summarizeToolResult;
    /**
     * V3: Token 预算驱动的智能压缩
     * 替代旧的一刀切 3 轮截断 + 1M token 粗暴阈值
     *
     * 核心原则：默认全量保留。只在 TokenBudgeter 检测到接近窗口上限（>80%）时才触发温记忆摘要。
     * 对于典型用户场景（20-30 轮），完全不触发摘要，全程全量记忆。
     */
    private smartCompress;
    /** 获取记忆统计（供测试/调试用） */
    getMemoryStats(): {
        hotEvents: number;
        hotTokens: number;
        warmSummaries: number;
        warmTokens: number;
        coldEntries: number;
    };
    /** 获取 Token 预算利用率报告 */
    getTokenUtilization(): string;
    /** V3: 语义记忆搜索 */
    searchSemanticMemory(query: string, topK?: number): Promise<import("./memoryStore.js").ColdMemoryEntry[]>;
    /** V3: 记录到语义记忆 */
    recordToSemanticMemory(entry: Parameters<SemanticMemory['record']>[0]): Promise<void>;
    /** V3: 获取决策追踪器 */
    getTracer(): DecisionTracer;
    /** V3: 获取 HITL 管理器 */
    getHITL(): HITLManager;
    /** V3: 获取决策摘要（注入到 LLM 上下文） */
    getDecisionSummary(): string;
    /** V3: 获取角色管理器 */
    getRoleManager(): RoleManager;
    /** V3: 获取 Doc-to-Skill 加载器 */
    getDocToSkill(): DocToSkillLoader;
    /** V3: 获取角色评分器 */
    getRoleScorer(): RoleScorer;
    /** V3: 手动记录任务到评分系统（供外部调用） */
    recordTaskResult(record: Omit<TaskRecord, 'id' | 'timestamp'>): TaskRecord;
    /** V3: 生成角色评分报告 */
    getRoleScoreReport(): string;
    private waitForPermission;
}
