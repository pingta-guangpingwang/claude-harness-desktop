import { BrowserWindow } from 'electron';
import { PluginManager } from './manager';
import { PluginInstaller } from './installer';
import { VersionManager } from './versionManager';
import { CapabilityRegistry } from './capabilityRegistry';
import { RendererBridge } from './rendererBridge';
import { type PluginProvides } from './pluginExec';
import type { CommandDefinition } from '../cli/types';
export declare function getPluginManager(): PluginManager | null;
export declare function getCapabilityRegistry(): CapabilityRegistry | null;
export declare function getRendererBridge(): RendererBridge | null;
export declare function getVersionManager(): VersionManager | null;
export declare function getPluginInstaller(): PluginInstaller | null;
export declare function setCommandRegistry(reg: {
    register(cmd: CommandDefinition): void;
    unregister(name: string): boolean;
}): void;
export declare function registerPluginCapabilities(pluginId: string, provides: PluginProvides[], binaryPath: string): void;
export declare function registerPluginIpc(mainWindow: BrowserWindow): void;
