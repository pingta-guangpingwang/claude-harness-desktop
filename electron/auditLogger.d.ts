export interface AuditEntry {
    id: string;
    timestamp: string;
    category: 'agent' | 'cli' | 'plugin' | 'workflow' | 'rule' | 'system' | 'permission';
    action: string;
    actor?: string;
    target?: string;
    result: 'success' | 'failure' | 'denied' | 'pending';
    details?: Record<string, unknown>;
    durationMs?: number;
    projectPath?: string;
}
export declare class AuditLogger {
    private logDir;
    private currentFile;
    private buffer;
    private flushTimer;
    private flushIntervalMs;
    constructor(flushIntervalMs?: number);
    /** 记录一条审计日志 */
    log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): string;
    /** 立即刷新缓冲到磁盘 */
    flush(): void;
    /** 读取最近的审计日志 */
    readRecent(limit?: number, category?: string): AuditEntry[];
    /** 按类别读取 */
    readByCategory(category: AuditEntry['category'], limit?: number): AuditEntry[];
    /** 按项目过滤 */
    readByProject(projectPath: string, limit?: number): AuditEntry[];
    /** 获取日志统计 */
    getStats(): {
        totalEntries: number;
        byCategory: Record<string, number>;
        byResult: Record<string, number>;
        sizeBytes: number;
    };
    /** 清理所有日志 */
    clear(): void;
    /** 销毁 */
    destroy(): void;
    private rotateIfNeeded;
    private ensureDir;
    private startFlushTimer;
}
