import { type ColdMemoryEntry, ColdMemory } from './memoryStore.js';
export declare class SemanticMemory {
    private coldMemory;
    private embeddingCache;
    private apiKey;
    private embeddingEndpoint;
    private embeddingModel;
    private enabled;
    private lastError;
    constructor(coldMemory: ColdMemory, apiKey: string, endpoint?: string);
    /** 生成文本的 embedding 向量 */
    embed(text: string): Promise<number[] | null>;
    /** 语义搜索 — embedding 优先，TF-IDF 降级 */
    search(query: string, topK?: number): Promise<ColdMemoryEntry[]>;
    /** 记录条目 — 同时生成 embedding（后台异步） */
    record(entry: Omit<ColdMemoryEntry, 'id' | 'embedding'>): Promise<void>;
    /** 批量预生成 embedding（后台运行，不阻塞） */
    preloadEmbeddings(onProgress?: (done: number, total: number) => void): Promise<void>;
    /** 重新启用 embedding（例如 API 恢复后） */
    reenable(): void;
    /** 获取状态 */
    getStatus(): {
        enabled: boolean;
        cacheSize: number;
        entries: number;
        embeddedCount: number;
        lastError: string | null;
    };
    /** 清空缓存（保留条目） */
    clearCache(): void;
    private hashText;
    private tfidfScore;
}
