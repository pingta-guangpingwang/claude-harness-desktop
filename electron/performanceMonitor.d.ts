export interface PerformanceSnapshot {
    timestamp: string;
    memory: {
        rss: number;
        heapTotal: number;
        heapUsed: number;
        external: number;
    };
    cpu: {
        user: number;
        system: number;
        idle: number;
    } | null;
    ipcLatency: {
        avgMs: number;
        maxMs: number;
        minMs: number;
        sampleCount: number;
        recentCalls: Array<{
            channel: string;
            durationMs: number;
        }>;
    };
    fileIO: {
        reads: number;
        writes: number;
        totalReadBytes: number;
        totalWriteBytes: number;
    };
    activePTYCount: number;
    uptimeSeconds: number;
}
export interface IPCLatencyRecord {
    channel: string;
    startTime: number;
}
export declare class PerformanceMonitor {
    private startTime;
    private snapshots;
    private historyDir;
    private maxSnapshots;
    private pollTimer;
    private pollIntervalMs;
    private pendingIPC;
    private ipcLatencySamples;
    private maxIPCSamples;
    private ioCounts;
    /** 最后一次 CPU 快照 */
    private lastCPUSnapshot;
    constructor(pollIntervalMs?: number, maxSnapshots?: number);
    /** 开始定期采集 */
    start(): void;
    /** 停止采集 */
    stop(): void;
    /** 记录 IPC 调用开始 */
    trackIPCStart(channel: string): string;
    /** 记录 IPC 调用结束 */
    trackIPCEnd(id: string): void;
    /** 记录文件读取 */
    trackFileRead(bytes: number): void;
    /** 记录文件写入 */
    trackFileWrite(bytes: number): void;
    /** 采集当前快照 */
    takeSnapshot(): PerformanceSnapshot;
    /** 获取最新快照 */
    getLatest(): PerformanceSnapshot | null;
    /** 获取所有快照 */
    getAll(): PerformanceSnapshot[];
    /** 获取最近 N 个快照 */
    getRecent(count: number): PerformanceSnapshot[];
    /** 获取摘要 */
    getSummary(): {
        uptimeSeconds: number;
        memoryMB: {
            rss: number;
            heapUsed: number;
        };
        ipcAvgMs: number;
        ioOps: {
            reads: number;
            writes: number;
        };
        snapshotCount: number;
    };
    private ensureDir;
}
