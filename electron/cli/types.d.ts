/** 命令权限等级 */
export type CommandPermission = 'user' | 'elevated' | 'admin';
/** 命令参数定义 */
export interface CommandParam {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'path' | 'project';
    description: string;
    required?: boolean;
    default?: unknown;
    choices?: string[];
}
/** 命令定义 */
export interface CommandDefinition {
    name: string;
    description: string;
    /** 一行摘要 */
    summary?: string;
    /** 参数列表 */
    params?: CommandParam[];
    /** 权限等级 */
    permission?: CommandPermission;
    /** 分类 */
    category?: 'project' | 'git' | 'ai' | 'system' | 'workflow' | 'custom';
    /** 别名 */
    aliases?: string[];
    /** 执行函数 */
    execute: (args: Record<string, unknown>, ctx: CommandContext) => Promise<CommandResult>;
}
/** 命令执行上下文 */
export interface CommandContext {
    projectPath?: string;
    projectIds: string[];
    projectNames: Map<string, string>;
    apiKey?: string;
    model?: string;
}
/** 命令执行结果 */
export interface CommandResult {
    success: boolean;
    output: string;
    metadata?: Record<string, unknown>;
}
/** 命令收藏 */
export interface CommandBookmark {
    id: string;
    name: string;
    command: string;
    args: Record<string, unknown>;
    projectPath?: string;
    createdAt: string;
    usageCount: number;
}
/** 命令分组 */
export interface CommandGroup {
    id: string;
    name: string;
    bookmarkIds: string[];
    collapsed?: boolean;
}
/** 别名映射 */
export interface AliasEntry {
    alias: string;
    expandsTo: string;
    description?: string;
}
/** 命令历史记录 */
export interface CommandHistoryEntry {
    id: string;
    command: string;
    args: Record<string, unknown>;
    projectPath?: string;
    timestamp: string;
    durationMs: number;
    success: boolean;
}
/** 批量任务定义 */
export interface BatchTask {
    id: string;
    name: string;
    commands: Array<{
        command: string;
        args: Record<string, unknown>;
        projectPath?: string;
    }>;
    mode: 'serial' | 'parallel';
    stopOnError?: boolean;
}
/** 批量执行结果 */
export interface BatchResult {
    taskId: string;
    results: Array<{
        command: string;
        result: CommandResult;
        durationMs: number;
    }>;
    totalDurationMs: number;
    successCount: number;
    failCount: number;
}
