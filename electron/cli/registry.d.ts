import type { CommandDefinition, CommandContext, CommandResult } from './types';
import { PermissionGate } from './permissionGate';
import { HistoryStore } from './historyStore';
export declare class CommandRegistry {
    private commands;
    permissionGate: PermissionGate;
    history: HistoryStore;
    register(cmd: CommandDefinition): void;
    unregister(name: string): boolean;
    get(name: string): CommandDefinition | undefined;
    getAll(): CommandDefinition[];
    /** 模糊搜索匹配的命令 */
    search(query: string): CommandDefinition[];
    /** 解析用户输入为命令名 + 参数 */
    parse(input: string): {
        name: string;
        rawArgs: Record<string, string>;
    } | null;
    /** 执行命令（包含权限检查 + 历史记录） */
    execute(name: string, args: Record<string, unknown>, ctx: CommandContext): Promise<CommandResult>;
}
