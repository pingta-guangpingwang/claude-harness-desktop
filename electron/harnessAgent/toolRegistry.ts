// 驾驭智能体工具注册表
import type { AgentTool, AgentContext, ToolResult } from './types'

const registry = new Map<string, AgentTool>()

/** 工具定义的部分类型 — 所有字段可选，buildTool 填充安全默认值 */
export type ToolDef = Partial<Omit<AgentTool, 'name' | 'description' | 'parameters' | 'execute'>> & Pick<AgentTool, 'name' | 'description' | 'parameters' | 'execute'>

/** 工具默认值（对标 Claude Code TOOL_DEFAULTS 模式） */
const TOOL_DEFAULTS: Omit<AgentTool, 'name' | 'description' | 'parameters' | 'execute'> = {
  group: 'control',
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: false,
  interruptBehavior: 'block',
  core: true,
}

/**
 * 工具工厂 — 对标 Claude Code buildTool() 模式
 * 填充安全默认值，确保每个工具都有完整字段，避免散落的条件判断
 */
export function buildTool(def: ToolDef): AgentTool {
  return { ...TOOL_DEFAULTS, ...def }
}

export function registerTool(tool: AgentTool): void {
  registry.set(tool.name, tool)
}

/** 注册通过 buildTool 构建的工具 */
export function registerBuiltTool(def: ToolDef): AgentTool {
  const tool = buildTool(def)
  registry.set(tool.name, tool)
  return tool
}

export function unregisterTool(name: string): void {
  registry.delete(name)
}

export function getTool(name: string): AgentTool | undefined {
  return registry.get(name)
}

export function getAllTools(): AgentTool[] {
  return Array.from(registry.values())
}

/** 生成 LLM function calling 用的 tool 声明 — 仅发送核心工具，避免占用过多 context */
export function getToolDeclarations(): Array<{
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}> {
  return getAllTools()
    .filter(t => t.core !== false) // core=false 的工具不自动发送，通过 skill_discovery 按需发现
    .map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
}

/** 执行工具调用 */
export async function executeTool(
  name: string,
  params: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const tool = registry.get(name)
  if (!tool) {
    return { success: false, output: `未知工具: ${name}` }
  }
  try {
    return await tool.execute(params, ctx)
  } catch (err) {
    return { success: false, output: `工具执行异常: ${String(err)}` }
  }
}

/** 清空注册表（用于测试/重置） */
export function clearRegistry(): void {
  registry.clear()
}
