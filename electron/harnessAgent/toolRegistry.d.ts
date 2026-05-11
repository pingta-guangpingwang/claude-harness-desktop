import type { AgentTool, AgentContext, ToolResult } from './types';
/** 工具定义的部分类型 — 所有字段可选，buildTool 填充安全默认值 */
export type ToolDef = Partial<Omit<AgentTool, 'name' | 'description' | 'parameters' | 'execute'>> & Pick<AgentTool, 'name' | 'description' | 'parameters' | 'execute'>;
/**
 * 工具工厂 — 对标 Claude Code buildTool() 模式
 * 填充安全默认值，确保每个工具都有完整字段，避免散落的条件判断
 */
export declare function buildTool(def: ToolDef): AgentTool;
export declare function registerTool(tool: AgentTool): void;
/** 注册通过 buildTool 构建的工具 */
export declare function registerBuiltTool(def: ToolDef): AgentTool;
export declare function unregisterTool(name: string): void;
export declare function getTool(name: string): AgentTool | undefined;
export declare function getAllTools(): AgentTool[];
/** 生成 LLM function calling 用的 tool 声明 — 仅发送核心工具，避免占用过多 context */
export declare function getToolDeclarations(): Array<{
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}>;
/** 执行工具调用 */
export declare function executeTool(name: string, params: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult>;
/** 清空注册表（用于测试/重置） */
export declare function clearRegistry(): void;
