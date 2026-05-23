export interface TokenAllocation {
    systemPromptTokens: number;
    hotTokens: number;
    hotRoundCount: number;
    warmBudget: number;
    coldBudget: number;
    snapshotTokens: number;
    totalUsed: number;
    windowTokens: number;
    utilizationPercent: string;
}
export interface ProviderCapabilities {
    maxContextTokens: number;
    maxOutputTokens: number;
    modelName: string;
}
export declare function getProviderCapabilities(model: string): ProviderCapabilities;
/** 估算文本 token 数 — 双轨策略：英文 ~4 chars/token，中文 ~1.5 chars/token */
export declare function estimateTokens(text: string): number;
/** 估算消息数组的总 token 数 */
export declare function estimateMessagesTokens(messages: Array<{
    role: string;
    content?: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
    reasoning_content?: string;
}>): number;
export declare class TokenBudgeter {
    private provider;
    private lastActualUsage;
    private roundUsages;
    constructor(model: string);
    updateModel(model: string): void;
    /** 记录每轮 API 返回的实际 token 消耗 */
    recordRoundUsage(promptTokens: number, completionTokens: number, roundIndex: number): void;
    /** 获取最近一次 API 调用的实际 token 消耗 */
    getLastUsage(): {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    } | null;
    /**
     * 核心预算计算 — 决定热/温/冷各分配多少 token
     * 返回本轮应该保留多少轮全量热记忆
     */
    computeBudget(systemPromptText: string, snapshotText: string, hotRoundTokenCounts: number[]): TokenAllocation;
    /** 检查是否接近窗口上限（>80%） */
    isApproachingLimit(): boolean;
    /** 获取上下文利用率报告 */
    getUtilizationReport(): string;
    /** 获取累计 token 消耗统计 */
    getCumulativeStats(): {
        totalPrompt: number;
        totalCompletion: number;
        roundCount: number;
    };
    /** 获取当前 provider 能力信息 */
    getProviderCapabilities(model?: string): ProviderCapabilities;
    /** 清空轮次记录（会话重置时） */
    reset(): void;
}
