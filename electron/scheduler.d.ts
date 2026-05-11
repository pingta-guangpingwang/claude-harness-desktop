type ResourceType = 'ai-call' | 'file-io' | 'cli-exec' | 'network';
export declare class ResourceScheduler {
    private queues;
    private activeCounts;
    private limits;
    private processing;
    private onQueueChange;
    constructor();
    /** 设置某类型并发上限 */
    setLimit(type: ResourceType, limit: number): void;
    /** 入队任务，返回 Promise */
    enqueue<T>(type: ResourceType, task: () => Promise<T>, priority?: number): Promise<T>;
    /** 获取队列状态 */
    getStatus(): Record<string, {
        queued: number;
        active: number;
        limit: number;
    }>;
    /** 队列变更回调 */
    onChange(cb: () => void): void;
    private processQueue;
}
export declare const resourceScheduler: ResourceScheduler;
export {};
