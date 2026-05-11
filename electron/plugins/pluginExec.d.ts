export type PackageManager = 'npm' | 'pip' | 'pip3' | 'cargo' | 'go' | 'gem' | 'choco' | 'scoop' | 'winget' | 'brew';
export interface InstallSpec {
    manager: PackageManager;
    package: string;
    /** npm 的 -g、pip 的 --user 等 */
    extraArgs?: string[];
    /** 安装后验证的二进制名，默认等于 package */
    checkBinary?: string;
}
export interface PluginProvides {
    type: 'command' | 'ai.tool';
    id: string;
    description: string;
    /** 命令模板: "prettier --write {file}"；AI 工具描述 */
    commandTemplate?: string;
    /** AI 工具的 JSON Schema 参数 */
    toolParams?: Record<string, unknown>;
}
export interface InstallProgress {
    phase: 'detecting' | 'installing' | 'verifying' | 'registering' | 'done';
    message: string;
    pct: number;
}
export interface InstallResult {
    success: boolean;
    binaryPath?: string;
    version?: string;
    error?: string;
    manifestPath?: string;
}
interface GeneratedManifest {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    icon: string;
    provides: PluginProvides[];
    install: {
        manager: PackageManager;
        package: string;
        binary: string;
        version: string;
        installedAt: string;
    };
}
export declare function installPluginFromCatalog(pluginId: string, pluginName: string, pluginIcon: string, pluginDesc: string, pluginAuthor: string, installSpec: InstallSpec, provides: PluginProvides[], onProgress: (p: InstallProgress) => void): Promise<InstallResult>;
/** 获取已安装插件的清单 */
export declare function getInstalledPluginManifest(pluginId: string): GeneratedManifest | null;
/** 获取所有已安装插件的清单 */
export declare function getAllInstalledManifests(): GeneratedManifest[];
export {};
