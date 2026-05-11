// Agent-CLI 桥接 — 将 CLI 命令暴露为 Agent 工具，使模型可直接调用
// 对标 Claude Code 的 Command 统一抽象：slash 命令 / skill / workflow 都是 Command
import type { AgentTool, AgentContext, ToolResult } from './types'
import { registerTool } from './toolRegistry'

/** 从 CLI 注册表创建 Agent 工具包装器 */
export function createCliToolWrapper(cliRegistry: {
  getAll: () => Array<{
    name: string; description: string; category?: string
    params?: Array<{ name: string; type: string; description: string; required?: boolean }>
    permission?: string
  }>
  execute: (name: string, args: Record<string, unknown>, ctx: {
    projectIds: string[]; projectNames: Map<string, string>
    projectPath?: string; apiKey?: string; model?: string
  }) => Promise<{ success: boolean; output: string }>
}): void {
  const cliCommands = cliRegistry.getAll()

  for (const cmd of cliCommands) {
    // 将 CLI 自定义类型映射为合法 JSON Schema 类型
    const validTypes = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']
    function toJsonSchemaType(t: string): string {
      if (validTypes.includes(t)) return t
      // 'project', 'path', 'file', 'command' 等都视为 string
      return 'string'
    }

    const jsonParams: Record<string, unknown> = {
      type: 'object',
      properties: {},
    }
    const required: string[] = []
    if (cmd.params) {
      for (const p of cmd.params) {
        ;(jsonParams.properties as Record<string, unknown>)[p.name] = {
          type: toJsonSchemaType(p.type || 'string'),
          description: p.description,
        }
        if (p.required) required.push(p.name)
      }
    }
    if (required.length > 0) {
      ;(jsonParams as any).required = required
    }

    // 判断命令是否是只读的
    const isReadOnly = cmd.name.includes('status') || cmd.name.includes('read') ||
      cmd.name.includes('list') || cmd.name.includes('search') ||
      cmd.name.includes('check') || cmd.name.includes('log')

    const agentTool: AgentTool = {
      name: `cli_${cmd.name.replace(/-/g, '_')}`,
      description: `[CLI] ${cmd.description}`,
      parameters: jsonParams,
      group: isReadOnly ? 'read' : 'execute',
      isReadOnly,
      isConcurrencySafe: isReadOnly,
      isDestructive: !isReadOnly,
      core: false, // CLI 工具不自动发送，通过 skill_discovery 按需发现
      async execute(params, ctx): Promise<ToolResult> {
        try {
          const result = await cliRegistry.execute(cmd.name, params as Record<string, unknown>, {
            projectIds: ctx.projectIds,
            projectNames: ctx.projectNames,
            apiKey: ctx.apiKey,
            model: ctx.model,
          })

          return {
            success: result.success,
            output: result.output || (result.success ? '命令执行成功' : '命令执行失败'),
          }
        } catch (err) {
          return { success: false, output: `CLI 命令执行异常: ${String(err)}` }
        }
      },
    }

    registerTool(agentTool)
  }
}

/** 添加技能发现工具（非阻塞预取模式） */
export function createSkillDiscoveryTool(): AgentTool {
  return {
    name: 'skill_discovery',
    description: '发现可用的技能、命令和工具。当不确定有哪些可用操作时调用此工具。返回所有已注册的工具和 CLI 命令列表。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词（可选），例如 "git" 或 "deploy"' },
      },
    },
    group: 'read',
    isReadOnly: true,
    isConcurrencySafe: true,
    async execute(params, ctx): Promise<ToolResult> {
      const { getAllTools } = require('./toolRegistry')
      const tools = getAllTools() as AgentTool[]
      const query = (params.query as string || '').toLowerCase()

      const filtered = query
        ? tools.filter(t => t.name.includes(query) || t.description.includes(query))
        : tools

      const lines = ['# 可用工具和命令\n']
      for (const t of filtered) {
        const safety = t.isReadOnly ? '📖' : '✏️'
        lines.push(`- ${safety} **${t.name}**: ${t.description}`)
      }

      return { success: true, output: lines.join('\n') }
    },
  }
}
