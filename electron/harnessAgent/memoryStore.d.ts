export interface SessionEvent {
    index: number;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    toolName?: string;
    tokenCount: number;
    timestamp: string;
    metadata?: Record<string, unknown>;
}
export interface WarmSummary {
    eventRange: [number, number];
    summary: string;
    keyFacts: string[];
    tokenCount: number;
    generatedAt: string;
}
export interface ColdMemoryEntry {
    id: string;
    content: string;
    embedding?: number[];
    metadata: {
        type: 'error_fix' | 'user_preference' | 'project_fact' | 'skill_card' | 'decision';
        projectPath?: string;
        tags: string[];
        timestamp: string;
        importance: number;
    };
}
export declare class HotMemory {
    events: SessionEvent[];
    private nextIndex;
    private _totalTokens;
    push(event: Omit<SessionEvent, 'index' | 'timestamp' | 'tokenCount'> & {
        content: string;
    }): void;
    /** 获取最后 N 个事件 */
    getRecent(count: number): SessionEvent[];
    /** 获取完整事件流 */
    getAll(): SessionEvent[];
    /** 按轮次分组的事件 — 用于 token 预算计算 */
    getRoundTokenCounts(): number[];
    /** 获取总 token 数 */
    get totalTokens(): number;
    /** 获取事件数量 */
    get count(): number;
    /** 将指定范围的事件导出为消息格式（用于 LLM 调用） */
    exportMessages(startIndex: number, endIndex: number): Array<{
        role: string;
        content: string;
    }>;
    /** 清空热记忆（仅在会话重置时使用） */
    clear(): void;
}
export declare class WarmMemory {
    summaries: WarmSummary[];
    /** 添加一个摘要 */
    addSummary(summary: Omit<WarmSummary, 'tokenCount' | 'generatedAt'>): void;
    /** 获取所有摘要拼接后的文本（用于注入 LLM 上下文） */
    getContextText(maxTokens?: number): string;
    /** 获取所有关键事实 */
    getAllKeyFacts(): string[];
    /** 清空 */
    clear(): void;
    get totalTokens(): number;
}
export declare class ColdMemory {
    entries: ColdMemoryEntry[];
    /** 添加条目 */
    add(entry: Omit<ColdMemoryEntry, 'id'>): void;
    /** 关键词搜索（TF-IDF 简化版 — embedding 不可用时的降级方案） */
    searchByKeywords(query: string, topK?: number): ColdMemoryEntry[];
    /** 按标签筛选 */
    getByTag(tag: string): ColdMemoryEntry[];
    /** 按类型筛选 */
    getByType(type: ColdMemoryEntry['metadata']['type']): ColdMemoryEntry[];
    /** 获取最重要的条目（用于主动预加载） */
    getTopImportance(topK?: number): ColdMemoryEntry[];
    /** 移除过期条目（超过 N 天且 importance < 阈值） */
    pruneOldEntries(maxAgeDays?: number, importanceThreshold?: number): number;
    /** 导出为可持久化的 JSON */
    toJSON(): string;
    /** 从 JSON 恢复 */
    static fromJSON(json: string): ColdMemory;
    get count(): number;
}
export declare class MemoryManager {
    hot: HotMemory;
    warm: WarmMemory;
    cold: ColdMemory;
    constructor();
    /** 记录一个对话事件到热记忆 */
    recordEvent(role: SessionEvent['role'], content: string, toolName?: string): void;
    /** 将热记忆中指定范围的事件压缩到温记忆 */
    evictToWarm(startEventIndex: number, endEventIndex: number, summaryText: string, keyFacts: string[]): Promise<void>;
    /** 记录成功修复到冷记忆 */
    recordFix(problem: string, solution: string, projectPath?: string): void;
    /** 记录用户偏好到冷记忆 */
    recordPreference(content: string): void;
    /** 获取所有记忆的统计信息 */
    getStats(): {
        hotEvents: number;
        hotTokens: number;
        warmSummaries: number;
        warmTokens: number;
        coldEntries: number;
    };
    /** 清空当前会话记忆（热+温），保留冷记忆 */
    clearSession(): void;
    /** 完全清空 */
    clearAll(): void;
}
