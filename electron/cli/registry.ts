// CLI 命令注册表 — 统一管理所有可用命令
import type { CommandDefinition, CommandContext, CommandResult } from './types'
import { PermissionGate } from './permissionGate'
import { HistoryStore } from './historyStore'

export class CommandRegistry {
  private commands = new Map<string, CommandDefinition>()
  public permissionGate = new PermissionGate()
  public history = new HistoryStore()

  register(cmd: CommandDefinition): void {
    this.commands.set(cmd.name, cmd)
    // 同时注册别名
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        this.commands.set(alias, cmd)
      }
    }
  }

  unregister(name: string): boolean {
    return this.commands.delete(name)
  }

  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name)
  }

  getAll(): CommandDefinition[] {
    // 去重（别名指回同一个对象）
    return Array.from(new Set(this.commands.values()))
  }

  /** 模糊搜索匹配的命令 */
  search(query: string): CommandDefinition[] {
    const q = query.toLowerCase()
    return this.getAll().filter(cmd =>
      cmd.name.toLowerCase().includes(q) ||
      cmd.summary?.toLowerCase().includes(q) ||
      cmd.aliases?.some(a => a.toLowerCase().includes(q))
    )
  }

  /** 解析用户输入为命令名 + 参数 */
  parse(input: string): { name: string; rawArgs: Record<string, string> } | null {
    const parts = input.trim().split(/\s+/)
    if (parts.length === 0) return null
    const name = parts[0].toLowerCase()
    const argsParts = parts.slice(1)

    // 尝试匹配注册的命令
    const cmd = this.commands.get(name)
    if (!cmd) {
      // 模糊匹配
      const matches = this.search(name)
      if (matches.length === 1) {
        const found = matches[0]
        return { name: found.name, rawArgs: parseArgs(argsParts) }
      }
      return null
    }

    return { name: cmd.name, rawArgs: parseArgs(argsParts) }
  }

  /** 执行命令（包含权限检查 + 历史记录） */
  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: CommandContext,
  ): Promise<CommandResult> {
    const cmd = this.commands.get(name)
    if (!cmd) {
      return { success: false, output: `未知命令: ${name}` }
    }

    // 权限门控
    const perm = await this.permissionGate.check(cmd, args)
    if (!perm.allowed) {
      return { success: false, output: perm.reason || '权限不足' }
    }

    const startTime = Date.now()
    try {
      const result = await cmd.execute(args, ctx)
      this.history.addHistory({
        command: cmd.name,
        args,
        projectPath: ctx.projectPath,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        success: result.success,
      })
      return result
    } catch (err) {
      const duration = Date.now() - startTime
      this.history.addHistory({
        command: cmd.name,
        args,
        projectPath: ctx.projectPath,
        timestamp: new Date().toISOString(),
        durationMs: duration,
        success: false,
      })
      return { success: false, output: `命令执行异常: ${String(err)}` }
    }
  }
}

/** 简易参数解析: --key value 或 -k value 或 key=value */
function parseArgs(parts: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  let i = 0
  while (i < parts.length) {
    const p = parts[i]
    if (p.startsWith('--')) {
      const key = p.slice(2)
      const val = parts[i + 1] && !parts[i + 1].startsWith('-') ? parts[++i] : 'true'
      args[key] = val
    } else if (p.startsWith('-')) {
      const key = p.slice(1)
      const val = parts[i + 1] && !parts[i + 1].startsWith('-') ? parts[++i] : 'true'
      args[key] = val
    } else if (p.includes('=')) {
      const [k, v] = p.split('=', 2)
      args[k] = v
    } else {
      // 位置参数
      const idx = Object.keys(args).filter(k => k.startsWith('_')).length
      args[`_${idx}`] = p
    }
    i++
  }
  return args
}
