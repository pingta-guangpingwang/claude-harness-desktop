import type { AgentTool } from './types';
/** 从 CLI 注册表创建 Agent 工具包装器 */
export declare function createCliToolWrapper(cliRegistry: {
    getAll: () => Array<{
        name: string;
        description: string;
        category?: string;
        params?: Array<{
            name: string;
            type: string;
            description: string;
            required?: boolean;
        }>;
        permission?: string;
    }>;
    execute: (name: string, args: Record<string, unknown>, ctx: {
        projectIds: string[];
        projectNames: Map<string, string>;
        projectPath?: string;
        apiKey?: string;
        model?: string;
    }) => Promise<{
        success: boolean;
        output: string;
    }>;
}): void;
/** 添加技能发现工具（非阻塞预取模式） */
export declare function createSkillDiscoveryTool(): AgentTool;
