interface BatchedCall {
    channel: string;
    args: unknown[];
}
interface BatchResult {
    index: number;
    result: unknown;
    error?: string;
}
export declare class BatchIPCHandler {
    private handlers;
    /** 注册可批量的处理器 */
    register(channel: string, handler: (...args: unknown[]) => Promise<unknown>): void;
    /** 批量执行 */
    executeBatch(calls: BatchedCall[]): Promise<BatchResult[]>;
}
export declare const batchIPC: BatchIPCHandler;
/** 注册批量 IPC 通道 */
export declare function registerBatchIPC(): void;
export {};
