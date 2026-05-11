// CLI 内置命令 — 项目中注册的核心操作命令
import type { CommandDefinition } from './types'
import { spawnPtySession, killPtySession, getPtyStatus, writeToPty } from '../modules/ptyManager.js'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'

/** 创建内置命令集 */
export function createBuiltinCommands(): CommandDefinition[] {
  return [
    // ==== 项目管理 ====
    {
      name: 'wake',
      description: '启动指定或全部项目的 Claude Code 终端',
      summary: '启动项目 AI 终端',
      params: [
        { name: 'project', type: 'project', description: '项目路径，不指定则启动全部', required: false },
      ],
      aliases: ['start', 'up'],
      category: 'project',
      async execute(args, ctx): Promise<any> {
        const target = args.project as string
        if (target) {
          const status = getPtyStatus(target)
          if (status.connected) return { success: true, output: `项目已在运行 (PID ${status.pid})` }
          const res = await spawnPtySession(target)
          return res.success
            ? { success: true, output: `启动成功 (PID ${res.pid})` }
            : { success: false, output: `启动失败: ${res.message}` }
        }
        // 全部启动
        const results: string[] = []
        for (const id of ctx.projectIds) {
          const name = ctx.projectNames.get(id) || id.split('\\').pop() || id
          const status = getPtyStatus(id)
          if (status.connected) {
            results.push(`✅ ${name}: 已在线`)
            continue
          }
          const res = await spawnPtySession(id)
          results.push(res.success ? `✅ ${name}: 启动成功` : `❌ ${name}: ${res.message}`)
          await new Promise(r => setTimeout(r, 4000))
        }
        return { success: true, output: results.join('\n') }
      },
    },

    {
      name: 'stop',
      description: '停止指定或全部项目的 Claude Code 终端',
      summary: '停止项目 AI 终端',
      params: [
        { name: 'project', type: 'project', description: '项目路径，不指定则停止全部', required: false },
      ],
      aliases: ['down', 'kill'],
      category: 'project',
      permission: 'elevated',
      async execute(args): Promise<any> {
        const target = args.project as string
        if (target) {
          const res = killPtySession(target)
          return res.success ? { success: true, output: `已停止` } : { success: false, output: res.message || '无活跃会话' }
        }
        const res = killPtySession()
        return { success: true, output: '全部终端已停止' }
      },
    },

    {
      name: 'status',
      description: '检查全部项目的终端状态',
      summary: '项目心跳状态',
      aliases: ['st', 'ps'],
      category: 'project',
      async execute(_args, ctx): Promise<any> {
        const lines: string[] = []
        let online = 0
        for (const id of ctx.projectIds) {
          const name = ctx.projectNames.get(id) || id.split('\\').pop() || id
          const s = getPtyStatus(id)
          lines.push(`${s.connected ? '🟢' : '🔴'} ${name} ${s.connected ? `(PID ${s.pid})` : '离线'}`)
          if (s.connected) online++
        }
        lines.unshift(`在线: ${online}/${ctx.projectIds.length}`)
        return { success: true, output: lines.join('\n') }
      },
    },

    // ==== Git 操作 ====
    {
      name: 'git-status',
      description: '检查所有项目的 git 状态',
      summary: 'Git 状态检查',
      aliases: ['gs'],
      category: 'git',
      async execute(_args, ctx): Promise<any> {
        const results: string[] = []
        for (const id of ctx.projectIds) {
          const name = ctx.projectNames.get(id) || id.split('\\').pop() || id
          try {
            const out = execSync('git status --short', { cwd: id, encoding: 'utf-8', timeout: 10000 })
            results.push(`${name}:${out.trim() ? '\n' + out.trim() : ' 干净'}`)
          } catch {
            results.push(`${name}: 非 git 仓库或错误`)
          }
        }
        return { success: true, output: results.join('\n\n') }
      },
    },

    {
      name: 'git-log',
      description: '查看指定项目的 git 提交历史',
      summary: 'Git 提交历史',
      params: [
        { name: 'project', type: 'project', description: '项目路径，不指定则用当前上下文', required: false },
        { name: 'n', type: 'number', description: '显示最近 N 条，默认 5', default: 5 },
      ],
      category: 'git',
      async execute(args, ctx): Promise<any> {
        const cwd = (args.project as string) || ctx.projectPath || ctx.projectIds[0]
        if (!cwd) return { success: false, output: '未指定项目' }
        const n = (args.n as number) || 5
        try {
          const out = execSync(`git log --oneline -${n}`, { cwd, encoding: 'utf-8', timeout: 10000 })
          return { success: true, output: out.trim() }
        } catch (err: any) {
          return { success: false, output: err.stderr || err.message || 'git 错误' }
        }
      },
    },

    // ==== AI / Harness Agent ====
    {
      name: 'ai-chat',
      description: '向驾驭智能体发送对话消息（走 Agent Loop）',
      summary: 'AI 对话',
      params: [
        { name: 'message', type: 'string', description: '消息内容（--message "..." 或 _0 位置参数）', required: true },
      ],
      aliases: ['ai', 'ask'],
      category: 'ai',
      async execute(args): Promise<any> {
        const msg = (args.message as string) || (args._0 as string) || ''
        if (!msg.trim()) return { success: false, output: '请输入消息内容' }
        // AI 对话转发到 harness:send（由 CLI IPC 层桥接）
        return { success: true, output: 'AI_CHAT:' + msg }
      },
    },

    // ==== 系统 ====
    {
      name: 'broadcast',
      description: '向全部在线项目广播命令',
      summary: '广播命令',
      params: [
        { name: 'command', type: 'string', description: '要执行的命令', required: true },
      ],
      aliases: ['bc', 'all'],
      category: 'system',
      permission: 'elevated',
      async execute(args, ctx): Promise<any> {
        const cmd = (args.command as string) || (args._0 as string) || ''
        if (!cmd) return { success: false, output: '请输入要广播的命令' }
        const results: string[] = []
        for (const id of ctx.projectIds) {
          const name = ctx.projectNames.get(id) || id.split('\\').pop() || id
          const s = getPtyStatus(id)
          if (!s.connected) {
            results.push(`⚠️ ${name}: 离线，跳过`)
            continue
          }
          writeToPty(id, cmd + '\r')
          results.push(`✅ ${name}: 已发送`)
        }
        return { success: true, output: results.join('\n') }
      },
    },

    {
      name: 'read',
      description: '读取项目中的文件',
      summary: '读取文件',
      params: [
        { name: 'file', type: 'path', description: '文件绝对路径', required: true },
      ],
      aliases: ['cat'],
      category: 'system',
      async execute(args): Promise<any> {
        const filePath = (args.file as string) || (args._0 as string) || ''
        if (!existsSync(filePath)) return { success: false, output: '文件不存在' }
        try {
          const content = readFileSync(filePath, 'utf-8').split('\n').slice(0, 100).join('\n')
          return { success: true, output: content }
        } catch (err) {
          return { success: false, output: `读取失败: ${String(err)}` }
        }
      },
    },
  ]
}
