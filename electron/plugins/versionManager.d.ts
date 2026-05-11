import type { PluginManifest } from './types';
interface VersionEntry {
    version: string;
    installedAt: string;
    backupPath: string;
    checksum?: string;
}
export declare class VersionManager {
    private maxVersions;
    private registry;
    constructor(maxVersions?: number);
    private loadRegistry;
    private saveRegistry;
    /** 保存插件当前版本快照 */
    backupVersion(pluginId: string, version: string, installPath: string, checksum?: string): void;
    /** 回滚插件到指定版本 */
    rollback(pluginId: string, targetVersion: string): Promise<{
        success: boolean;
        backupPath?: string;
        manifest?: PluginManifest;
        error?: string;
    }>;
    /** 获取插件的版本历史 */
    getHistory(pluginId: string): VersionEntry[];
    /** 清理插件所有历史版本 */
    clearHistory(pluginId: string): void;
    private copyDir;
}
export {};
