export interface TokenRecord {
    id: string;
    timestamp: string;
    projectPath: string;
    projectName: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** 估算成本 (USD)，基于 DeepSeek 官方定价 */
    costEstimate: number;
    /** 会话 ID（同一次连续对话内相同） */
    conversationId: string;
}
interface TokenStats {
    totalTokens: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCost: number;
    totalCalls: number;
    byDay: Record<string, {
        tokens: number;
        calls: number;
        cost: number;
    }>;
    byProject: Record<string, {
        tokens: number;
        calls: number;
        cost: number;
        name: string;
    }>;
    byModel: Record<string, {
        tokens: number;
        calls: number;
    }>;
    conversations: Array<{
        conversationId: string;
        projectPath: string;
        projectName: string;
        firstCallAt: string;
        lastCallAt: string;
        totalTokens: number;
        totalCost: number;
        callCount: number;
    }>;
}
declare class TokenStore {
    private storePath;
    constructor();
    /** 记录一次 API 调用 */
    record(entry: Omit<TokenRecord, 'id' | 'timestamp' | 'costEstimate'>): TokenRecord;
    /** 读取全部记录 */
    readAll(): TokenRecord[];
    /** 聚合统计 */
    getStats(): TokenStats;
    /** 按会话获取详细记录 */
    getConversationRecords(conversationId: string): TokenRecord[];
    /** 获取每个会话的对话摘要（从 audit log 中提取用户提问） */
    getConversationTurns(conversationId: string): Array<{
        timestamp: string;
        role: string;
        content: string;
    }>;
}
export declare function getTokenStore(): TokenStore;
export {};
