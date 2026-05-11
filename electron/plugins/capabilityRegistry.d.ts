import type { PluginManifest, CapabilityType } from './types';
interface CapabilityEntry {
    type: CapabilityType;
    id: string;
    description: string;
    pluginId: string;
}
export declare class CapabilityRegistry {
    private capabilities;
    private plugins;
    /** 注册插件的提供的的能力 */
    register(manifest: PluginManifest): void;
    /** 注销插件的能力 */
    unregister(pluginId: string): void;
    /** 检查依赖是否满足 */
    checkDependencies(manifest: PluginManifest): {
        ok: boolean;
        missing: string[];
    };
    /** 按类型查找能力 */
    findByType(type: CapabilityType): CapabilityEntry[];
    /** 获取所有已注册的能力 */
    getAll(): CapabilityEntry[];
    /** 获取插件的依赖树 */
    getDependencyTree(pluginId: string, visited?: Set<string>): string[];
    /** 拓扑排序 — 返回正确的加载顺序 */
    resolveLoadOrder(pluginIds: string[]): string[];
}
export {};
