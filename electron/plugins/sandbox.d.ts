import type { PluginManifest, PluginSandboxAPI } from './types';
export declare function createSandbox(manifest: PluginManifest, installPath: string, callbacks: {
    registerCommand: (name: string, def: any) => void;
    registerAITool: (tool: any) => void;
}): PluginSandboxAPI;
/** 加载插件主进程模块（受限 require） */
export declare function loadPluginModule(installPath: string, manifest: PluginManifest): unknown;
/** Promise 超时包装 */
export declare function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T>;
