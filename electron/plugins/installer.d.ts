import type { PluginManifest } from './types';
interface InstallResult {
    success: boolean;
    installPath?: string;
    manifest?: PluginManifest;
    error?: string;
}
export declare class PluginInstaller {
    /** 校验插件清单 */
    validateManifest(manifest: unknown): {
        valid: boolean;
        errors: string[];
    };
    /** 校验 SHA-256 */
    verifyChecksum(filePath: string, expected: string): boolean;
    /** 从本地 zip 文件安装插件 */
    installFromZip(zipPath: string): InstallResult;
    /** 从 URL 下载并安装插件 */
    installFromUrl(url: string, expectedChecksum?: string, onProgress?: (pct: number, loaded: number, total: number) => void): Promise<InstallResult>;
}
export {};
