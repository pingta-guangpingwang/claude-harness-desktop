import type { PluginManifest, PluginInstance } from './types';
import { CapabilityRegistry } from './capabilityRegistry';
export declare class PluginManager {
    private instances;
    private registry;
    private statePath;
    private pluginsDir;
    private callbacks;
    constructor(registry: CapabilityRegistry, callbacks: {
        registerCommand: (name: string, def: any) => void;
        registerAITool: (tool: any) => void;
        onStatusChange: (pluginId: string, status: string) => void;
    });
    initialize(): Promise<void>;
    private loadState;
    private saveState;
    /** 安装插件（installPath 是已解压好的目录） */
    install(installPath: string, manifest: PluginManifest): Promise<void>;
    /** 注册 shim 插件（无需 JS 模块的 npm/pip 等全局安装工具）。如果已有残留则自动清理重装 */
    registerShim(installPath: string, manifest: PluginManifest): PluginInstance;
    /** 启用插件 */
    enable(pluginId: string): Promise<void>;
    private enablePluginInternal;
    /** 禁用插件 */
    disable(pluginId: string): Promise<void>;
    /** 卸载插件（内置插件不可卸载） */
    uninstall(pluginId: string): Promise<void>;
    /** 注册系统内置插件（虚拟，无安装目录） */
    registerBuiltin(manifest: PluginManifest): void;
    /** 更新插件 */
    update(pluginId: string, newManifest: PluginManifest, newPath: string): Promise<void>;
    getInstance(pluginId: string): PluginInstance | undefined;
    getAll(): PluginInstance[];
    private buildContext;
}
