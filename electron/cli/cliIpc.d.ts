import { BrowserWindow } from 'electron';
import { CommandRegistry } from './registry';
import { AliasResolver } from './aliasResolver';
export declare function registerCliIpc(window: BrowserWindow): void;
/** 获取 CLI 注册表（供 Agent-CLI 桥接使用） */
export declare function getCliRegistry(): CommandRegistry | null;
/** 获取别名解析器 */
export declare function getAliasResolver(): AliasResolver | null;
