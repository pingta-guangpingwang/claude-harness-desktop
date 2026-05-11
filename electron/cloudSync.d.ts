export interface SyncManifest {
    version: number;
    lastSyncAt: string;
    remoteUrl: string;
    entries: SyncEntry[];
}
export interface SyncEntry {
    /** 相对路径（相对于 CHD 数据目录） */
    path: string;
    /** 本地最后修改时间 */
    localMtime: string;
    /** 远程最后同步时间 */
    remoteMtime: string;
    /** 同步状态: synced | local_newer | remote_newer | conflict */
    status: 'synced' | 'local_newer' | 'remote_newer' | 'conflict';
}
export interface SyncStats {
    total: number;
    synced: number;
    localNewer: number;
    remoteNewer: number;
    conflicts: number;
    lastSyncAt: string | null;
}
export declare class CloudSyncService {
    private manifestPath;
    private manifest;
    constructor();
    /** 加载同步清单 */
    private loadManifest;
    /** 保存同步清单 */
    private saveManifest;
    /** 扫描本地文件变更 */
    scanLocal(): SyncEntry[];
    /** 标记同步完成 */
    markSynced(paths: string[]): void;
    /** 标记冲突 */
    markConflict(path: string): void;
    /** 获取同步状态 */
    getStats(): SyncStats;
    /** 设置远程 URL */
    setRemoteUrl(url: string): void;
    /** 获取远程 URL */
    getRemoteUrl(): string;
}
export declare const cloudSync: CloudSyncService;
