// 驾驭智能体 — 内置工具实现
import type { AgentTool, AgentContext, ToolResult } from './types'
import { registerTool, getAllTools, executeTool } from './toolRegistry'
import { spawnPtySession, killPtySession, getPtyStatus, writeToPty, sendAndCollect } from '../modules/ptyManager.js'
import { taskQueue, type AgentTask } from './taskQueue.js'
import { db } from '../modules/database.js'
import { notifyProjectAdded } from '../modules/projectNotifier.js'
import fs from 'fs'
import path from 'path'


// ============== P0 核心控制工具 ==============

const wakeProjectsTool: AgentTool = {
  name: 'wake_projects',
  description: '启动项目的 Claude Code 终端，已运行则跳过。返回每个项目的启动结果。',
  parameters: {
    type: 'object',
    properties: {
      project_paths: {
        type: 'array',
        items: { type: 'string' },
        description: '要启动的项目路径列表。为空或省略则启动全部项目。',
      },
    },
  },
  group: 'control',
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: false,
  async execute(params, ctx): Promise<ToolResult> {
    const requested = params.project_paths as string[] | undefined
    const paths = (requested && requested.length > 0) ? requested : ctx.projectIds
    const results: string[] = []
    for (const id of paths) {
      if (ctx.aborted) {
        results.push('⏹️ 用户中断')
        break
      }
      const name = ctx.projectNames.get(id) || id.split('\\').pop() || id
      try {
        const status = getPtyStatus(id)
        if (status.connected) {
          results.push(`✅ ${name}: 已在线 (PID ${status.pid})`)
          continue
        }
        const res = await spawnPtySession(id)
        if (res.success) {
          results.push(`✅ ${name}: 启动成功 (PID ${res.pid})`)
          // Claude Code 需要时间初始化（加载上下文/索引文件），等待更久
          await new Promise(r => setTimeout(r, 6000))
        } else {
          results.push(`❌ ${name}: 启动失败 - ${res.message || '未知'}`)
        }
      } catch (err) {
        results.push(`❌ ${name}: ${String(err)}`)
      }
    }
    if (results.length === 0) {
      return { success: false, output: '没有指定任何项目，且项目列表为空' }
    }
    return { success: true, output: results.join('\n') }
  },
}

const stopProjectsTool: AgentTool = {
  name: 'stop_projects',
  description: '停止指定或全部项目的 Claude Code PTY 终端。',
  parameters: {
    type: 'object',
    properties: {
      project_paths: {
        type: 'array',
        items: { type: 'string' },
        description: '要停止的项目路径列表。为空则停止全部。',
      },
    },
  },
  group: 'control',
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: true,
  interruptBehavior: 'cancel',
  checkPermissions(params) {
    if (!params.project_paths || (params.project_paths as string[]).length === 0) {
      return { decision: 'ask', reason: '停止全部终端需确认 — 影响所有活跃项目' }
    }
    return null // 走默认管道
  },
  async execute(params, ctx): Promise<ToolResult> {
    const paths = (params.project_paths as string[]) || null
    if (paths && paths.length > 0) {
      const results: string[] = []
      for (const id of paths) {
        const name = ctx.projectNames.get(id) || id.split('\\').pop() || id
        const res = killPtySession(id)
        results.push(res.success ? `✅ ${name}: 已停止` : `⚠️ ${name}: ${res.message || '无活跃会话'}`)
      }
      return { success: true, output: results.join('\n') }
    }
    const res = killPtySession()
    return { success: true, output: res.success ? '✅ 全部终端已停止' : '⚠️ 停止失败' }
  },
}

const checkStatusTool: AgentTool = {
  name: 'check_status',
  description: '检查全部项目的心跳状态（实时查询 PTY 连接状态+最后活跃时间），用于判断哪些项目正在工作中、哪些空闲、哪些离线。派发任务后用此工具轮询项目状态。',
  parameters: { type: 'object', properties: {} },
  group: 'control',
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(_params, ctx): Promise<ToolResult> {
    const now = Date.now()
    const lines: string[] = []
    let online = 0
    let working = 0
    for (const id of ctx.projectIds) {
      const name = ctx.projectNames.get(id) || id.split('\\').pop() || id
      const ptyStatus = getPtyStatus(id)
      const isOnline = ptyStatus.connected
      if (isOnline) online++
      const secSinceLastData = ptyStatus.lastDataAt > 0 ? Math.floor((now - ptyStatus.lastDataAt) / 1000) : 99999
      const isWorking = isOnline && secSinceLastData < 30
      if (isWorking) working++
      let status: string
      if (!isOnline) {
        status = '🔴 离线'
      } else if (isWorking) {
        status = '🟢 工作中'
      } else if (secSinceLastData < 300) {
        status = `🟡 空闲(${secSinceLastData}s前有活动)`
      } else {
        status = `⚪ 无活动(${Math.floor(secSinceLastData / 60)}min前)`
      }
      const detail = isOnline && ptyStatus.pid ? ` PID:${ptyStatus.pid}` : ''
      lines.push(`${status} — ${name}${detail}`)
    }
    lines.unshift(`总计: ${online}/${ctx.projectIds.length} 在线, ${working} 工作中`)
    return { success: true, output: lines.join('\n') }
  },
}

const broadcastTool: AgentTool = {
  name: 'broadcast',
  description: '向全部在线项目终端发送自然语言任务指令（不是 shell 命令！）。离线项目会自动唤醒后发送。项目内的 Claude Code 会并行处理任务，等待收集所有回复后汇总。',
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: '发送给项目 Claude Code 的自然语言任务描述，例如: "请列出本项目的技术栈" 或 "检查服务器配置并汇报"',
      },
    },
    required: ['task'],
  },
  group: 'control',
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: false,
  async execute(params, ctx): Promise<ToolResult> {
    const task = params.task as string
    const results: string[] = []
    const projectNames: Map<string, string> = new Map()

    // 并行启动所有离线项目 + 发送任务收集回复
    const promises = ctx.projectIds.map(async (id) => {
      const name = ctx.projectNames.get(id) || id.split('\\').pop() || id
      projectNames.set(id, name)

      try {
        // 确保在线
        const status = getPtyStatus(id)
        if (!status.connected) {
          const spawnRes = await spawnPtySession(id)
          if (!spawnRes.success) {
            return { id, name, ok: false, output: `❌ ${name}: 唤醒失败` }
          }
          await new Promise(r => setTimeout(r, 5000))
        }

        // 发送任务并等待回复（最长 90s）
        const result = await sendAndCollect(id, task, 120000)

        if (result.success && result.output) {
          // 推送项目回复到驾驭对话
          ctx.emitEvent?.({
            type: 'project_response',
            projectName: name,
            projectPath: id,
            content: result.output,
            timestamp: new Date().toISOString(),
          })

          const preview = result.output.slice(0, 600)
          const suffix = result.output.length > 600 ? '\n... (已截断)' : ''
          return { id, name, ok: true, output: `✅ ${name}:\n${preview}${suffix}` }
        }
        return { id, name, ok: true, output: `⚠️ ${name}: 已派发但无回复` }
      } catch (err) {
        return { id, name, ok: false, output: `❌ ${name}: ${String(err)}` }
      }
    })

    const allResults = await Promise.all(promises)
    let okCount = 0
    for (const r of allResults) {
      if (r.ok) okCount++
      results.push(r.output)
    }

    // 统计需要继续等待的项目
    const pendingProjects: string[] = []
    for (const r of allResults) {
      if (r.ok && r.output.includes('已派发但无回复')) {
        pendingProjects.push(r.name)
      }
    }
    let pendingNote = ''
    if (pendingProjects.length > 0) {
      pendingNote = `\n\n⏳ ${pendingProjects.length} 个项目可能仍在处理中: ${pendingProjects.join(', ')}\n💡 使用 poll_projects 等待它们完成，或使用 read_project_chat 查看进度。`
    }

    results.unshift(`已向 ${okCount}/${ctx.projectIds.length} 个项目广播任务: "${task.slice(0, 100)}${task.length > 100 ? '...' : ''}"`)
    return { success: true, output: results.join('\n') + pendingNote }
  },
}

const taskProjectTool: AgentTool = {
  name: 'task_project',
  description: '向单个指定项目终端发送自然语言任务指令。项目内的 Claude Code 会处理该任务。适用于需要特定项目执行的操作。',
  parameters: {
    type: 'object',
    properties: {
      project_path: {
        type: 'string',
        description: '目标项目的绝对路径',
      },
      task: {
        type: 'string',
        description: '发送给项目 Claude Code 的自然语言任务描述',
      },
    },
    required: ['project_path', 'task'],
  },
  group: 'control',
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: false,
  async execute(params, ctx): Promise<ToolResult> {
    const targetPath = params.project_path as string
    const task = params.task as string

    // 查找匹配的项目：先精确匹配路径，再按名称匹配
    let match = ctx.projectIds.find(id => id === targetPath || id.toLowerCase() === targetPath.toLowerCase())
    if (!match) {
      // 按项目名称搜索（从 projectNames Map 反查）
      for (const [id, name] of ctx.projectNames) {
        if (name === targetPath || name.toLowerCase() === targetPath.toLowerCase() ||
            id.endsWith('\\' + targetPath) || id.endsWith('/' + targetPath) ||
            id.includes(targetPath)) {
          match = id
          break
        }
      }
    }
    if (!match) {
      return { success: false, output: `未找到项目: ${targetPath}\n可用项目:\n${ctx.projectIds.map(id => `  - ${id}`).join('\n')}` }
    }
    const name = ctx.projectNames.get(match) || match.split('\\').pop() || match

    try {
      // 确保 PTY 在线
      const status = getPtyStatus(match)
      if (!status.connected) {
        const spawnRes = await spawnPtySession(match)
        if (!spawnRes.success) {
          return { success: false, output: `❌ ${name}: 唤醒失败 - ${spawnRes.message || '未知'}` }
        }
        // 等待 Claude Code 初始化完成
        await new Promise(r => setTimeout(r, 6000))
      }

      // 发送任务并等待项目 AI 回复（最长 120s）
      const result = await sendAndCollect(match, task, 120000)

      // 空回复检测：PTY 可能已死或卡在安全确认
      if (!result.output || result.output === '(无回复内容)' || result.output === '(超时 — 无回复)' || result.output === '(被新任务中断)') {
        const aliveCheck = getPtyStatus(match)
        if (!aliveCheck.connected) {
          return { success: false, output: `❌ ${name}: 终端已断开 (PID 已退出)。请重新 wake_projects 唤醒后再派发任务。` }
        }
        // PTY 在线但无回复 → 可能卡在安全确认或启动流程
        const idleSec = Math.round((Date.now() - aliveCheck.lastDataAt) / 1000)
        return { success: false, output: `⚠️ ${name}: 终端在线但无回复 (空闲 ${idleSec}s)。可能卡在安全确认或初始化中，请先 read_project_chat 查看终端状态再决定下一步。` }
      }

      if (result.success && result.output) {
        // B3: 反馈解析 — 检测成功/失败/需人工介入
        const lower = result.output.toLowerCase()
        const isError = /error|错误|失败|exception|refused|denied|无法|不能|❌|✗/i.test(result.output)
        const isWarn = /warning|警告|注意|deprecated|建议/i.test(result.output)
        const isSuccess = /success|成功|完成|done|✓|✅|ok|正常/i.test(result.output)

        let statusTag: string
        let autoFollowUp = ''
        if (isError && !isSuccess) {
          statusTag = '❌ 失败'
          // 自动添加跟进任务
          if (result.output.length < 2000) {
            taskQueue.add({
              type: 'follow_up',
              projectPath: match,
              instruction: `上次任务失败: "${task.slice(0, 80)}"，错误: ${result.output.slice(0, 300)}。请检查并尝试修复。`,
              priority: 1,
            })
            autoFollowUp = '\n📋 已自动添加高优先级跟进任务'
          }
        } else if (isWarn) {
          statusTag = '⚠️ 有警告'
        } else if (isSuccess) {
          statusTag = '✅ 成功'
        } else {
          statusTag = '📝 已回复'
        }

        const preview = result.output.slice(0, 3000)
        const suffix = result.output.length > 3000 ? '\n... (已截断)' : ''

        // 🔔 项目 AI 回复主动推送到驾驭对话窗口
        ctx.emitEvent?.({
          type: 'project_response',
          projectName: name,
          projectPath: match,
          content: result.output,
          timestamp: new Date().toISOString(),
        })

        return { success: true, output: `${statusTag} ${name}:\n${preview}${suffix}${autoFollowUp}` }
      }
      return { success: result.success, output: `⚠️ ${name}: 已派发但无回复\n💡 使用 poll_projects 等待项目 AI 回复，或用 read_project_chat 查看实时进度。` }
    } catch (err) {
      return { success: false, output: `❌ ${name}: ${String(err)}` }
    }
  },
}

// ============== P1.5 任务队列工具 ==============

const pollProjectsTool: AgentTool = {
  name: 'poll_projects',
  description: '低开销轮询指定项目的 PTY 活跃状态，等待指定秒数后返回每个项目的最近活动时间。用于在派发任务后等待项目 AI 回复，不消耗大量 token。每轮等待 20-40 秒，建议最多 6 轮。',
  parameters: {
    type: 'object',
    properties: {
      project_paths: {
        type: 'array',
        items: { type: 'string' },
        description: '要轮询的项目路径列表。为空则轮询全部项目。',
      },
      wait_seconds: {
        type: 'number',
        description: '等待秒数后返回结果，默认 25 秒（范围 10-60）',
      },
    },
  },
  group: 'control',
  isReadOnly: true,
  isConcurrencySafe: false,
  async execute(params, ctx): Promise<ToolResult> {
    const requested = params.project_paths as string[] | undefined
    const paths = (requested && requested.length > 0) ? requested : ctx.projectIds
    const waitSec = Math.max(10, Math.min(60, (params.wait_seconds as number) || 25))

    // 记录等待前的状态
    const before = new Map<string, number>()
    for (const id of paths) {
      const s = getPtyStatus(id)
      before.set(id, s.lastDataAt)
    }

    // 等待
    await new Promise(r => setTimeout(r, waitSec * 1000))

    // 检查等待后的状态
    const now = Date.now()
    const lines: string[] = [`⏱️ 等待 ${waitSec}s 后项目状态:`]
    let activeCount = 0
    let changedCount = 0

    for (const id of paths) {
      const name = ctx.projectNames.get(id) || id.split('\\').pop() || id
      const s = getPtyStatus(id)
      if (!s.connected) {
        lines.push(`  🔴 ${name}: 离线`)
        continue
      }
      const secSinceLastData = s.lastDataAt > 0 ? Math.floor((now - s.lastDataAt) / 1000) : 99999
      const prevLastData = before.get(id) || 0
      const hasNewData = s.lastDataAt > prevLastData

      if (secSinceLastData < 15) {
        lines.push(`  🟢 ${name}: 活跃中 (${secSinceLastData}s前有数据)${hasNewData ? ' ← 本轮有新数据' : ''}`)
        activeCount++
        if (hasNewData) changedCount++
      } else if (secSinceLastData < 60) {
        lines.push(`  🟡 ${name}: 可能已完成 (${secSinceLastData}s前最后活动)${hasNewData ? ' ← 本轮有新数据' : ''}`)
        if (hasNewData) changedCount++
      } else if (secSinceLastData < 300) {
        lines.push(`  ⚪ ${name}: 空闲 ${Math.floor(secSinceLastData / 60)}min`)
      } else {
        lines.push(`  💤 ${name}: 长时间无活动 ${Math.floor(secSinceLastData / 60)}min`)
      }
    }

    lines.unshift(`活跃: ${activeCount}/${paths.length}, 本轮新数据: ${changedCount}`)
    return { success: true, output: lines.join('\n') }
  },
}

const queueStatusTool: AgentTool = {
  name: 'queue_status',
  description: '查看任务队列状态：待办/进行中/已完成/失败数量及详情',
  parameters: {
    type: 'object',
    properties: {
      filter: { type: 'string', description: '过滤状态: pending/running/done/failed，默认全部' },
    },
  },
  group: 'read',
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(params): Promise<ToolResult> {
    const filter = params.filter as string | undefined
    const status = filter as AgentTask['status'] | undefined
    const tasks = taskQueue.list(status)
    const stats = taskQueue.stats()

    if (tasks.length === 0) {
      return { success: true, output: `任务队列为空。统计: ${JSON.stringify(stats)}` }
    }

    const lines = [
      `📋 任务队列: ${stats.pending} 待办 / ${stats.running} 进行中 / ${stats.done} 完成 / ${stats.failed} 失败`,
      '',
    ]
    for (const t of tasks) {
      const icon = t.status === 'running' ? '🔄' : t.status === 'done' ? '✅' : t.status === 'failed' ? '❌' : '⏳'
      lines.push(`${icon} [${t.priority}] ${t.type}: ${t.instruction.slice(0, 120)}`)
      if (t.projectPath) lines.push(`   项目: ${t.projectPath.split('\\').pop()}`)
      if (t.result) lines.push(`   结果: ${t.result.slice(0, 200)}`)
    }
    return { success: true, output: lines.join('\n') }
  },
}

const addFollowUpTool: AgentTool = {
  name: 'add_follow_up',
  description: '向任务队列添加后续任务。当项目 AI 回复需要跟进时使用。',
  parameters: {
    type: 'object',
    properties: {
      project_path: { type: 'string', description: '目标项目路径' },
      instruction: { type: 'string', description: '跟进任务描述' },
      priority: { type: 'number', description: '优先级: 1=高 2=中 3=低，默认 2' },
    },
    required: ['project_path', 'instruction'],
  },
  group: 'write',
  isReadOnly: false,
  isConcurrencySafe: true,
  isDestructive: false,
  async execute(params): Promise<ToolResult> {
    const id = taskQueue.add({
      type: 'follow_up',
      projectPath: params.project_path as string,
      instruction: params.instruction as string,
      priority: (params.priority as number) || 2,
    })
    return { success: true, output: `✅ 已添加后续任务 (${id}): "${(params.instruction as string).slice(0, 100)}"` }
  },
}

// ============== P1 情报收集工具（读取项目 AI 上下文） ==============

const readProjectChatTool: AgentTool = {
  name: 'read_project_chat',
  description: '读取指定项目 Claude Code 最近的聊天记录。用于了解项目 AI 最近做了什么、有什么输出、当前状态如何。不需要向项目发送任何任务，直接读取已有的对话内容。支持指定读取最近 N 条消息或最近 N 小时的记录。',
  parameters: {
    type: 'object',
    properties: {
      project_path: { type: 'string', description: '目标项目绝对路径' },
      limit: { type: 'number', description: '最多读取最近 N 条消息，默认 30' },
      hours: { type: 'number', description: '读取最近 N 小时内的消息，与 limit 同时生效取更严格者' },
    },
    required: ['project_path'],
  },
  group: 'read',
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(params, ctx): Promise<ToolResult> {
    const targetPath = params.project_path as string
    const limit = (params.limit as number) || 30
    const hours = params.hours as number | undefined

    // 项目路径匹配
    let match = ctx.projectIds.find(id => id === targetPath || id.toLowerCase() === targetPath.toLowerCase())
    if (!match) {
      for (const [id, name] of ctx.projectNames) {
        if (name === targetPath || name.toLowerCase() === targetPath.toLowerCase() ||
            id.endsWith('\\' + targetPath) || id.endsWith('/' + targetPath) || id.includes(targetPath)) {
          match = id; break
        }
      }
    }
    if (!match) {
      return { success: false, output: `未找到项目: ${targetPath}` }
    }
    const name = ctx.projectNames.get(match) || match.split('\\').pop() || match

    try {
      const chatDir = path.join(match, '.dbvs', 'chat')
      if (!fs.existsSync(chatDir)) {
        return { success: true, output: `📭 ${name}: 暂无聊天记录（.dbvs/chat 目录不存在）` }
      }
      const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.json'))
      if (files.length === 0) {
        return { success: true, output: `📭 ${name}: 暂无聊天记录` }
      }

      // 按修改时间排序，取最新的 session
      files.sort((a, b) => {
        const statA = fs.statSync(path.join(chatDir, a)).mtimeMs
        const statB = fs.statSync(path.join(chatDir, b)).mtimeMs
        return statB - statA
      })

      const cutoff = hours ? Date.now() - hours * 3600 * 1000 : 0
      const messages: string[] = []
      let totalMsgs = 0

      for (const file of files) {
        if (messages.length >= limit) break
        try {
          const raw = fs.readFileSync(path.join(chatDir, file), 'utf-8')
          const session = JSON.parse(raw)
          const msgs = session.messages || []
          for (const msg of msgs.reverse()) {
            if (messages.length >= limit) break
            const ts = new Date(msg.timestamp).getTime()
            if (cutoff > 0 && ts < cutoff) continue
            const roleTag = msg.role === 'user' ? '👤' : msg.role === 'assistant' ? '🤖' : '📢'
            const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''
            messages.push(`[${time}] ${roleTag} ${msg.content.slice(0, 500)}`)
            totalMsgs++
          }
        } catch { /* skip corrupt */ }
      }

      if (messages.length === 0) {
        return { success: true, output: `📭 ${name}: ${hours ? `最近 ${hours} 小时内` : ''}无聊天记录` }
      }

      const header = `📋 ${name} 最近 ${totalMsgs} 条聊天记录:\n${'─'.repeat(50)}\n`
      return { success: true, output: header + messages.reverse().join('\n') }
    } catch (err) {
      return { success: false, output: `❌ 读取 ${name} 聊天记录失败: ${String(err)}` }
    }
  },
}

const healthReportTool: AgentTool = {
  name: 'health_report',
  description: '【仅在用户明确要求"体检"/"报告"/"健康检查"时使用】对全部或指定项目进行全面体检：PTY 连接状态 + 最近聊天记录摘要 + 工作状态分析。生成结构化的中文健康报告。日常检查状态请用 check_status。',
  parameters: {
    type: 'object',
    properties: {
      project_paths: {
        type: 'array',
        items: { type: 'string' },
        description: '要体检的项目路径列表。为空则体检全部项目。',
      },
      detail_level: {
        type: 'string',
        description: '报告详细程度: brief(简要)/normal(标准)/full(完整含聊天记录)，默认 normal',
      },
    },
  },
  group: 'read',
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(params, ctx): Promise<ToolResult> {
    const requested = params.project_paths as string[] | undefined
    const paths = (requested && requested.length > 0) ? requested : ctx.projectIds
    const detail = (params.detail_level as string) || 'normal'

    const sections: string[] = []
    let totalOnline = 0
    let totalWorking = 0
    let totalIssues = 0

    const now = new Date()
    const timestamp = now.toLocaleString('zh-CN')

    sections.push(`# 🏥 驾驭工程全面体检报告`)
    sections.push(`**生成时间**: ${timestamp}`)
    sections.push(`**体检项目数**: ${paths.length}`)
    sections.push('')

    for (const id of paths) {
      if (ctx.aborted) {
        sections.push('⏹️ **用户中断**')
        break
      }

      const name = ctx.projectNames.get(id) || id.split('\\').pop() || id
      const ptyStatus = getPtyStatus(id)
      const isOnline = ptyStatus.connected
      if (isOnline) totalOnline++

      sections.push(`## ${isOnline ? '🟢' : '🔴'} ${name}`)
      sections.push('')

      // PTY 状态
      if (isOnline) {
        sections.push(`- **PTY 状态**: 在线 (PID: ${ptyStatus.pid}, Session: ${ptyStatus.sessionId || 'N/A'})`)
      } else {
        sections.push(`- **PTY 状态**: 离线`)
        sections.push('')
        continue
      }

      // 读取聊天记录
      try {
        const chatDir = path.join(id, '.dbvs', 'chat')
        if (fs.existsSync(chatDir)) {
          const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.json'))
          if (files.length > 0) {
            files.sort((a, b) => {
              try {
                return fs.statSync(path.join(chatDir, b)).mtimeMs - fs.statSync(path.join(chatDir, a)).mtimeMs
              } catch { return 0 }
            })

            const latestFile = files[0]
            const raw = fs.readFileSync(path.join(chatDir, latestFile), 'utf-8')
            const session = JSON.parse(raw)
            const msgs = session.messages || []
            const lastMsg = msgs[msgs.length - 1]
            const lastTime = lastMsg?.timestamp ? new Date(lastMsg.timestamp) : null
            const minutesAgo = lastTime ? Math.floor((now.getTime() - lastTime.getTime()) / 60000) : null

            // 分析工作状态
            const recentMsgs = msgs.slice(-20)
            const lastAssistantMsgs = recentMsgs.filter((m: any) => m.role === 'assistant').slice(-5)
            const lastUserMsgs = recentMsgs.filter((m: any) => m.role === 'user').slice(-3)

            // 检查是否有错误
            const hasError = recentMsgs.some((m: any) =>
              /error|错误|失败|exception|refused|denied/i.test(m.content || '')
            )
            const hasWarning = recentMsgs.some((m: any) =>
              /warning|警告|注意/i.test(m.content || '')
            )

            sections.push(`- **聊天记录**: ${msgs.length} 条消息，共 ${files.length} 个会话`)
            sections.push(`- **最后活动**: ${minutesAgo !== null ? `${minutesAgo} 分钟前` : '未知'} (${lastMsg?.role === 'assistant' ? 'AI 回复' : lastMsg?.role === 'user' ? '用户输入' : '系统消息'})`)

            if (lastMsg?.content) {
              const preview = lastMsg.content.slice(0, 200).replace(/\n/g, ' ')
              sections.push(`- **最后消息**: ${preview}${lastMsg.content.length > 200 ? '...' : ''}`)
            }

            if (hasError) {
              sections.push(`- ⚠️ **状态**: 发现错误或异常`)
              totalIssues++
            } else if (hasWarning) {
              sections.push(`- ⚡ **状态**: 有警告信息`)
              totalIssues++
            } else if (lastMsg?.role === 'assistant' && minutesAgo !== null && minutesAgo < 10) {
              sections.push(`- ✅ **状态**: 近期活跃，工作正常`)
              totalWorking++
            } else if (minutesAgo !== null && minutesAgo > 60) {
              sections.push(`- 💤 **状态**: 超过 1 小时未活动`)
            } else {
              sections.push(`- ✅ **状态**: 正常`)
              totalWorking++
            }

            // full 模式显示最近聊天摘要
            if (detail === 'full' && lastAssistantMsgs.length > 0) {
              sections.push('')
              sections.push('<details>')
              sections.push('<summary>📝 最近 AI 回复摘要</summary>')
              sections.push('')
              for (const msg of lastAssistantMsgs) {
                const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''
                const summary = (msg.content || '').slice(0, 300).replace(/\n/g, ' ')
                sections.push(`- [${time}] ${summary}`)
              }
              sections.push('')
              sections.push('</details>')
            }
          } else {
            sections.push(`- **聊天记录**: 无`)
            sections.push(`- **状态**: 在线但无对话历史`)
          }
        } else {
          sections.push(`- **聊天记录**: 无 (.dbvs/chat 目录不存在)`)
          sections.push(`- **状态**: 在线但无对话历史`)
        }
      } catch (err) {
        sections.push(`- **聊天分析**: 读取失败 (${String(err).slice(0, 100)})`)
      }
      sections.push('')
    }

    // 汇总
    sections.push('---')
    sections.push('')
    sections.push('## 📊 汇总')
    sections.push(`- 总项目数: **${paths.length}**`)
    sections.push(`- 在线: **${totalOnline}** / 离线: **${paths.length - totalOnline}**`)
    sections.push(`- 正常工作: **${totalWorking}**`)
    sections.push(`- 需关注: **${totalIssues}**`)
    sections.push('')
    sections.push('> 💡 使用 `read_project_chat` 可查看项目完整聊天记录。')
    sections.push('> 💡 使用 `task_project` 可向特定项目派发新任务。')

    const report = sections.join('\n')

    // 🔔 推送可点击的报告卡片到驾驭对话
    ctx.emitEvent?.({
      type: 'report_card',
      title: `驾驭工程体检报告 (${now.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })})`,
      summary: `总项目: ${paths.length} | 在线: ${totalOnline} | 正常: ${totalWorking} | 需关注: ${totalIssues}`,
      fullReport: report,
      projectCount: paths.length,
      onlineCount: totalOnline,
    })

    return { success: true, output: report }
  },
}

// ============== P2 验收 & 交付工具 ==============

const verifyProjectTool: AgentTool = {
  name: 'verify_project',
  description: '验收指定项目的工作成果：运行 lint/typecheck/audit/test 等插件检查，返回 pass/fail 报告。用于项目 AI 报告任务完成后，CEO 考核其输出质量。有失败项时自动建议打回修复。',
  parameters: {
    type: 'object',
    properties: {
      project_path: {
        type: 'string',
        description: '要验收的项目绝对路径',
      },
      checks: {
        type: 'array',
        items: { type: 'string' },
        description: '要运行的检查类型: lint, typecheck, audit, test, format。默认全部。',
      },
    },
    required: ['project_path'],
  },
  group: 'control',
  isReadOnly: true,
  isConcurrencySafe: false,
  async execute(params, ctx): Promise<ToolResult> {
    const targetPath = params.project_path as string
    const checks = (params.checks as string[]) || ['lint', 'typecheck', 'audit', 'test', 'format']

    // 匹配项目路径
    let match = ctx.projectIds.find(id => id === targetPath || id.toLowerCase() === targetPath.toLowerCase())
    if (!match) {
      for (const [id, name] of ctx.projectNames) {
        if (name === targetPath || id.includes(targetPath)) { match = id; break }
      }
    }
    if (!match) {
      return { success: false, output: `未找到项目: ${targetPath}` }
    }
    const name = ctx.projectNames.get(match) || match.split('\\').pop() || match

    // 从注册表查找可用的验证插件工具 (core: false = 插件工具)
    const allTools = getAllTools()
    const verifyTools = allTools.filter(t => t.core === false)

    // 按检查类型匹配工具
    const checkMap: Record<string, string[]> = {
      lint: [],
      typecheck: [],
      audit: [],
      test: [],
      format: [],
    }

    for (const t of verifyTools) {
      const n = t.name.toLowerCase()
      if (n.includes('lint') || n.includes('eslint') || n.includes('stylelint')) checkMap.lint.push(t.name)
      if (n.includes('typecheck') || n.includes('tsc') || n.includes('pyright') || n.includes('mypy')) checkMap.typecheck.push(t.name)
      if (n.includes('audit') || n.includes('depcheck') || n.includes('security') || n.includes('outdated')) checkMap.audit.push(t.name)
      if (n.includes('test') || n.includes('vitest') || n.includes('jest') || n.includes('pytest')) checkMap.test.push(t.name)
      if (n.includes('format') || n.includes('prettier') || n.includes('biome') || n.includes('check_format')) checkMap.format.push(t.name)
    }

    const results: string[] = []
    let passCount = 0
    let failCount = 0
    const failures: string[] = []

    for (const checkType of checks) {
      const toolNames = checkMap[checkType]
      if (!toolNames || toolNames.length === 0) {
        results.push(`⚪ ${checkType}: 未安装对应插件，跳过`)
        continue
      }

      for (const toolName of toolNames) {
        try {
          const result = await executeTool(toolName, { project_path: match }, ctx)
          const passed = result.success && !/error|错误|失败|✗|❌|vulnerability|漏洞/i.test(result.output)
          if (passed) {
            results.push(`✅ ${checkType} (${toolName}): 通过`)
            passCount++
          } else {
            const preview = result.output.slice(0, 300)
            results.push(`❌ ${checkType} (${toolName}): 未通过`)
            results.push(`   ${preview}`)
            failCount++
            failures.push(`${checkType}: ${preview.slice(0, 150)}`)
          }
        } catch (err) {
          results.push(`⚠️ ${checkType} (${toolName}): 执行异常 - ${String(err).slice(0, 100)}`)
          failCount++
        }
      }
    }

    const total = passCount + failCount
    const header = `📋 验收报告 — ${name}\n${'─'.repeat(40)}`
    const summary = `\n总计: ${total} 项检查 | ✅ ${passCount} 通过 | ❌ ${failCount} 失败`

    let action = ''
    if (failCount > 0) {
      action = `\n\n⚠️ 有 ${failCount} 项未通过！建议打回项目 AI 修复：\ntask_project(project_path="${match}", task="请修复以下验收问题: ${failures.join('; ')}")`
    } else if (total > 0) {
      action = '\n\n🎉 全部验收通过！可以汇报用户。'
    }

    return { success: true, output: [header, ...results, summary, action].join('\n') }
  },
}

const generateLaunchScriptsTool: AgentTool = {
  name: 'generate_launch_scripts',
  description: '为全部或指定项目生成一键启动 .bat 脚本。自动检测项目类型（npm/maven/python/docker等）确定启动命令。生成后用户可在项目卡片上点击启动按钮。',
  parameters: {
    type: 'object',
    properties: {
      project_paths: {
        type: 'array',
        items: { type: 'string' },
        description: '要生成启动脚本的项目路径列表。为空则处理全部项目。',
      },
    },
  },
  group: 'control',
  isReadOnly: false,
  isConcurrencySafe: true,
  isDestructive: false,
  async execute(params, ctx): Promise<ToolResult> {
    const requested = params.project_paths as string[] | undefined
    const paths = (requested && requested.length > 0) ? requested : ctx.projectIds
    const results: string[] = []

    for (const id of paths) {
      const name = ctx.projectNames.get(id) || id.split('\\').pop() || id
      try {
        // 检测项目类型并生成 bat
        const pkgJsonPath = path.join(id, 'package.json')
        const cmakePath = path.join(id, 'CMakeLists.txt')
        const goModPath = path.join(id, 'go.mod')
        const cargoPath = path.join(id, 'Cargo.toml')
        const reqPath = path.join(id, 'requirements.txt')
        const dockerPath = path.join(id, 'docker-compose.yml')
        const makefilePath = path.join(id, 'Makefile')
        const pomPath = path.join(id, 'pom.xml')
        const gradlePath = path.join(id, 'build.gradle')

        let launchCmd = ''
        if (fs.existsSync(pkgJsonPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
            const scripts = pkg.scripts || {}
            if (scripts.dev) launchCmd = 'npm run dev'
            else if (scripts.start) launchCmd = 'npm start'
            else if (scripts.serve) launchCmd = 'npm run serve'
            else if (scripts.build) launchCmd = 'npm run build'
            else launchCmd = 'npm run dev'
          } catch { launchCmd = 'npm run dev' }
        } else if (fs.existsSync(pomPath)) {
          launchCmd = 'mvn spring-boot:run'
        } else if (fs.existsSync(gradlePath)) {
          launchCmd = 'gradle bootRun'
        } else if (fs.existsSync(goModPath)) {
          launchCmd = 'go run .'
        } else if (fs.existsSync(cargoPath)) {
          launchCmd = 'cargo run'
        } else if (fs.existsSync(reqPath)) {
          launchCmd = 'python -m uvicorn main:app --reload'
        } else if (fs.existsSync(dockerPath)) {
          launchCmd = 'docker-compose up'
        } else if (fs.existsSync(makefilePath)) {
          launchCmd = 'make run'
        } else if (fs.existsSync(cmakePath)) {
          launchCmd = 'cmake --build build && build\\Debug\\' + name + '.exe'
        } else {
          launchCmd = 'echo 未检测到已知项目类型，请手动编辑此文件'
        }

        // 构建工具预检行
        const toolChecks: string[] = []
        if (launchCmd.includes('npm') || launchCmd.includes('node ')) {
          toolChecks.push('where node >nul 2>&1 || (echo [X] Node.js not found - install from https://nodejs.org && pause && exit /b 1)')
        }
        if (launchCmd.includes('mvn')) {
          toolChecks.push('where mvn >nul 2>&1 || (echo [X] Maven not found && pause && exit /b 1)')
        }
        if (launchCmd.includes('python') || launchCmd.includes('uvicorn')) {
          toolChecks.push('where python >nul 2>&1 || (echo [X] Python not found && pause && exit /b 1)')
        }
        if (launchCmd.includes('go ')) {
          toolChecks.push('where go >nul 2>&1 || (echo [X] Go not found && pause && exit /b 1)')
        }
        if (launchCmd.includes('docker')) {
          toolChecks.push('where docker >nul 2>&1 || (echo [X] Docker not found && pause && exit /b 1)')
        }
        const toolCheckBlock = toolChecks.length > 0
          ? '\n' + toolChecks.join('\n') + '\n'
          : ''

        const batContent = `@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"${toolCheckBlock}
echo ========================================
echo   ${name}
echo   ${launchCmd}
echo ========================================
echo.
${launchCmd}
if %ERRORLEVEL% neq 0 (
    echo.
    echo [X] Exit code: %ERRORLEVEL%
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo ========================================
echo   Done
echo ========================================
pause
`
        const batPath = path.join(id, '.dbvs-launch.bat')
        fs.writeFileSync(batPath, batContent, 'utf-8')
        results.push(`✅ ${name}: 启动脚本已生成 → ${launchCmd}`)
      } catch (err) {
        results.push(`❌ ${name}: ${String(err)}`)
      }
    }

    results.unshift(`已为 ${results.filter(r => r.startsWith('✅')).length}/${paths.length} 个项目生成启动脚本`)
    return { success: true, output: results.join('\n') }
  },
}

// ============== P3 插件生态工具 ==============

const listAvailablePluginsTool: AgentTool = {
  name: 'list_available_plugins',
  description: '列出插件商店中的可用插件。可按分类(category)或关键词(query)筛选。返回插件名/ID/描述/安装命令。',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: '筛选分类: formatter, linter, git, api, productivity, editor, database, ai。不填则返回全部。',
      },
      query: {
        type: 'string',
        description: '模糊搜索关键词，匹配插件名/描述/标签。',
      },
    },
  },
  group: 'control',
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(params): Promise<ToolResult> {
    const { PLUGIN_CATALOG } = require('../plugins/catalog.js') as typeof import('../plugins/catalog.js')
    let list = PLUGIN_CATALOG
    const category = params.category as string | undefined
    const query = params.query as string | undefined

    if (category) {
      list = list.filter(p => p.category === category)
    }
    if (query) {
      const q = query.toLowerCase()
      list = list.filter(p =>
        p.id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.descriptionZh.toLowerCase().includes(q) ||
        p.tags.some(t => t.includes(q))
      )
    }

    if (list.length === 0) {
      return { success: true, output: '未找到匹配的插件。可用分类: formatter, linter, git, api, productivity, editor, database, ai' }
    }

    const lines = list.map(p => {
      const tags = p.tags.slice(0, 5).join(', ')
      const providesStr = p.provides.map(pr => `${pr.type === 'command' ? '⌨' : '🤖'}${pr.id}`).join(' ')
      return `- **${p.name}** (${p.id}) ${p.icon} v${p.version}
  分类: ${p.category} | 评分: ${'★'.repeat(Math.floor(p.rating))} | ${p.install.manager} install ${p.install.package}
  ${p.descriptionZh || p.description}
  提供: ${providesStr}
  标签: ${tags}`
    })

    const cats = [...new Set(list.map(p => p.category))]
    return { success: true, output: `📡 插件商店 (匹配 ${list.length} 个, 分类: ${cats.join(', ')})\n\n${lines.join('\n\n')}` }
  },
}

const installPluginTool: AgentTool = {
  name: 'install_plugin',
  description: '从插件商店安装指定插件。安装后自动运行审查验证(smoke test)确认插件可用。用户要求缺少某功能(如lint/format/test/audit)时主动调用此工具安装对应插件。',
  parameters: {
    type: 'object',
    properties: {
      plugin_id: {
        type: 'string',
        description: '要安装的插件 ID 或名称，如 prettier-plus, eslint-ai, typescript-official',
      },
    },
    required: ['plugin_id'],
  },
  group: 'control',
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: false,
  async execute(params): Promise<ToolResult> {
    const pluginId = params.plugin_id as string
    const { PLUGIN_CATALOG, findPlugin } = require('../plugins/catalog.js') as typeof import('../plugins/catalog.js')

    const plugin = findPlugin(pluginId)
    if (!plugin) {
      const suggestions = PLUGIN_CATALOG
        .filter(p => p.category === 'linter' || p.category === 'formatter')
        .map(p => `  - ${p.name} (${p.id}): ${p.descriptionZh.slice(0, 60)}`)
        .join('\n')
      return {
        success: false,
        output: `未找到插件 "${pluginId}"。\n\n可用插件:\n${suggestions}\n\n用 list_available_plugins 查看完整目录。`,
      }
    }

    // 检查是否已安装
    try {
      const { getInstalledPluginManifest } = require('../plugins/pluginExec.js') as typeof import('../plugins/pluginExec.js')
      const existing = getInstalledPluginManifest(plugin.id)
      if (existing) {
        return { success: true, output: `✅ 插件 ${plugin.name} (v${existing.version}) 已安装，无需重复安装。` }
      }
    } catch { /* 继续安装 */ }

    // 调用安装
    try {
      const { installPluginFromCatalog } = require('../plugins/pluginExec.js') as typeof import('../plugins/pluginExec.js')
      const result = await installPluginFromCatalog(
        plugin.id,
        plugin.name,
        plugin.icon,
        plugin.descriptionZh || plugin.description,
        plugin.author,
        plugin.install,
        plugin.provides,
        (progress) => {
          // 静默安装，进度通过最终输出反馈
        },
      )

      if (!result.success) {
        return { success: false, output: `❌ 安装 ${plugin.name} 失败: ${result.error || '未知错误'}` }
      }

      // 注册到 PluginManager
      try {
        const { getPluginManager } = require('../plugins/pluginIpc.js')
        const mgr = getPluginManager()
        if (mgr) {
          const manifest = {
            id: plugin.id,
            name: plugin.name,
            version: result.version || '0.0.0',
            description: plugin.descriptionZh || plugin.description,
            author: plugin.author,
            icon: plugin.icon,
            provides: plugin.provides.map(p => ({
              type: p.type === 'command' ? 'command' as const : 'ai.tool' as const,
              id: p.id,
              description: p.description,
            })),
          }
          mgr.registerShim(
            require('path').join(require('electron').app.getPath('userData'), 'plugins', plugin.id),
            manifest,
          )
          // 注册命令 + AI 工具
          const { registerPluginCapabilities } = require('../plugins/pluginIpc.js')
          // capabilities 通过 pluginExec 已生成 manifest, 这里补注册 tool
        }
      } catch (e) {
        // 注册失败不阻塞
      }

      // 审查验证
      let auditResult = ''
      try {
        const { execSync } = require('child_process')
        const checkBin = plugin.install.checkBinary || plugin.install.package
        const versionOut = execSync(`"${checkBin}" --version 2>&1 || "${checkBin}" -V 2>&1 || "${checkBin}" version 2>&1`, {
          encoding: 'utf-8', timeout: 15000, shell: process.env.ComSpec || 'sh',
        }).trim().slice(0, 200)
        auditResult = `\n🔍 审查验证: ${checkBin} → ${versionOut}`

        // Smoke test: 对 linter/formatter 类插件跑一次检查
        if (plugin.category === 'linter' || plugin.category === 'formatter') {
          try {
            // 在临时目录跑检测确认命令可执行
            const tmpDir = require('os').tmpdir()
            const testFile = plugin.tags.includes('typescript') || plugin.tags.includes('tsx')
              ? require('path').join(tmpDir, '_chd_smoke_test.ts')
              : require('path').join(tmpDir, '_chd_smoke_test.js')
            require('fs').writeFileSync(testFile, 'const x = 1;', 'utf-8')
            const smokeOut = execSync(`"${checkBin}" --check "${testFile}" 2>&1 || "${checkBin}" "${testFile}" 2>&1`, {
              encoding: 'utf-8', timeout: 30000, shell: process.env.ComSpec || 'sh',
            }).trim().slice(0, 300)
            auditResult += `\n✅ 冒烟测试通过: ${smokeOut || '(无输出=正常运行)'}`
          } catch (smokeErr: any) {
            // smoke test 失败可能是正常的（代码有lint问题），只要不是 "command not found"
            const errMsg = smokeErr.stderr || smokeErr.message || String(smokeErr)
            if (errMsg.includes('not found') || errMsg.includes('not recognized')) {
              auditResult += `\n⚠️ 冒烟测试异常: ${errMsg.slice(0, 150)}`
            } else {
              auditResult += `\n✅ 冒烟测试: 命令可执行 (exit code非零属于正常检测结果)`
            }
          }
        }
      } catch (auditErr: any) {
        auditResult += `\n⚠️ 审查验证未通过: ${(auditErr.stderr || auditErr.message || String(auditErr)).slice(0, 200)}`
      }

      return {
        success: true,
        output: `✅ 插件 **${plugin.name}** (v${result.version || '?'}) 安装成功！
📦 包: ${plugin.install.manager} ${plugin.install.package}
🛠 二进制: ${result.binaryPath || '已安装'}
🏷 提供能力: ${plugin.provides.map(p => p.id).join(', ')}${auditResult}

💡 插件已可用。用户可在"已安装"面板查看和管理。`,
      }
    } catch (err: any) {
      return { success: false, output: `安装异常: ${String(err).slice(0, 300)}` }
    }
  },
}

// ============== P-INFRA CEO基础设施工具 — 修环境、查文件、写配置 ==============

const shellExecTool: AgentTool = {
  name: 'shell_exec',
  description: 'CEO基础设施命令。用于安装CLI工具、设置环境变量、检查系统状态。禁止用于项目开发（那是项目AI的活）。返回stdout/stderr。',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的shell命令。仅限：npm install -g、setx、dir、where、type、echo、node -v、npm -v' },
      cwd: { type: 'string', description: '工作目录（可选）' },
    },
    required: ['command'],
  },
  group: 'infra',
  isReadOnly: false,
  isConcurrencySafe: true,
  isDestructive: false,
  async execute(params: Record<string, unknown>, _ctx: AgentContext): Promise<ToolResult> {
    const command = params.command as string
    const cwd = (params.cwd as string) || process.cwd()
    try {
      const { execSync } = await import('child_process')
      // chcp 65001 强制 UTF-8 编码，避免中文 Windows GBK 乱码
      const output = execSync(`chcp 65001 >nul && ${command}`, { cwd, timeout: 60000, encoding: 'utf-8', windowsHide: true })
      return { success: true, output: output.trim() || '(执行成功，无输出)' }
    } catch (e: any) {
      const stderr = e.stderr || ''
      const stdout = e.stdout || ''
      return { success: false, output: `执行失败 (退出码: ${e.status || '?'})\n${stdout}\n${stderr}`.trim() }
    }
  },
}

const readFileTool: AgentTool = {
  name: 'read_file',
  description: 'CEO只读文件检查。用于验证项目路径是否存在、读取配置文件、查看错误日志。禁止用于阅读项目源码（那是项目AI的活）。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '要读取的文件完整路径' },
      max_lines: { type: 'number', description: '最大读取行数，默认50' },
    },
    required: ['file_path'],
  },
  group: 'infra',
  isReadOnly: true,
  isConcurrencySafe: true,
  isDestructive: false,
  async execute(params: Record<string, unknown>, _ctx: AgentContext): Promise<ToolResult> {
    const filePath = params.file_path as string
    const maxLines = (params.max_lines as number) || 50
    try {
      if (!fs.existsSync(filePath)) {
        // 检测是否为目录
        try {
          const entries = fs.readdirSync(filePath)
          return { success: true, output: `[目录] ${filePath}\n${entries.slice(0, maxLines).join('\n')}${entries.length > maxLines ? `\n... 还有 ${entries.length - maxLines} 项` : ''}` }
        } catch {}
        return { success: false, output: `路径不存在: ${filePath}` }
      }
      const stat = fs.statSync(filePath)
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(filePath)
        return { success: true, output: `[目录] ${filePath}\n${entries.slice(0, maxLines).join('\n')}${entries.length > maxLines ? `\n... 还有 ${entries.length - maxLines} 项` : ''}` }
      }
      const content = fs.readFileSync(filePath, 'utf-8')
      const lines = content.split('\n')
      const truncated = lines.slice(0, maxLines).join('\n')
      return { success: true, output: truncated + (lines.length > maxLines ? `\n... (共 ${lines.length} 行，仅显示前 ${maxLines})` : '') }
    } catch (e: any) {
      return { success: false, output: `读取失败: ${e.message}` }
    }
  },
}

const writeFileTool: AgentTool = {
  name: 'write_file',
  description: 'CEO写配置文件。仅限写入.json/.txt/.bat/.ps1等配置或脚本文件。严禁写项目源码！用于修复Claude Code配置、环境变量脚本等。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '要写入的文件完整路径' },
      content: { type: 'string', description: '要写入的内容' },
    },
    required: ['file_path', 'content'],
  },
  group: 'infra',
  isReadOnly: false,
  isConcurrencySafe: true,
  isDestructive: true,
  async execute(params: Record<string, unknown>, _ctx: AgentContext): Promise<ToolResult> {
    const filePath = params.file_path as string
    const content = params.content as string
    try {
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(filePath, content, 'utf-8')
      return { success: true, output: `已写入: ${filePath} (${content.length} 字符)` }
    } catch (e: any) {
      return { success: false, output: `写入失败: ${e.message}` }
    }
  },
}

// ============== P-INFRA CEO项目管理工具 ==============

const createProjectTool: AgentTool = {
  name: 'create_project',
  description: 'CEO新建项目。在默认项目目录下创建空文件夹，加入驾驭工程，唤醒Claude Code终端，然后由项目AI从头开发。仅限CEO用于新项目。',
  parameters: {
    type: 'object',
    properties: {
      project_name: { type: 'string', description: '项目名称（将用作文件夹名）' },
      description: { type: 'string', description: '项目简述（可选，会传给项目AI）' },
    },
    required: ['project_name'],
  },
  group: 'infra',
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: false,
  async execute(params: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
    const projectName = params.project_name as string
    const description = (params.description as string) || ''
    try {
      // 1. 读取默认项目目录
      const config = await db.getConfig()
      const settings = (config && config.settings) || {}
      const defaultDir = settings.defaultProjectDir || ''
      if (!defaultDir) {
        return { success: false, output: '未设置默认项目目录。\n\n请用户操作：设置 → Horse Farm → Settings 标签页 → 往下滚 → Default Project Directory → Browse 选择父文件夹。\n\n不要自己去翻 config 文件！告诉用户即可。' }
      }
      if (!fs.existsSync(defaultDir)) {
        return { success: false, output: `默认项目目录不存在: ${defaultDir}。请在设置中重新配置。` }
      }

      // 2. 创建项目文件夹
      const projectPath = path.join(defaultDir, projectName)
      if (fs.existsSync(projectPath)) {
        return { success: false, output: `项目路径已存在: ${projectPath}。请换一个项目名称。` }
      }
      fs.mkdirSync(projectPath, { recursive: true })
      console.log('[CEO] 创建新项目目录:', projectPath)

      // 2.5 预初始化 Claude Code 项目标记，跳过"是否信任此目录"的安全确认
      const claudeDir = path.join(projectPath, '.claude')
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir)
      }
      const claudeMdPath = path.join(projectPath, 'CLAUDE.md')
      if (!fs.existsSync(claudeMdPath)) {
        fs.writeFileSync(claudeMdPath, `# ${projectName}\n\n> Created by Harness Farm\n`, 'utf-8')
      }
      console.log('[CEO] 已预初始化 Claude Code 项目标记:', projectPath)

      // 3. 注册到项目列表
      const projectIds = await db.getProjectIds()
      const ids: string[] = projectIds.ids || []
      const individualProjects: Record<string, any> = projectIds.individualProjects || {}
      if (!ids.includes(projectPath)) {
        ids.push(projectPath)
      }
      individualProjects[projectPath] = {
        name: projectName,
        path: projectPath,
        repoPath: '',
        source: 'individual',
        status: 'synced',
      }
      await db.setProjectIds({ ids, individualProjects })
      console.log('[CEO] 项目已注册到驾驭工程:', projectPath)

      // 3.5 实时更新 AgentContext，让后续 task_project/broadcast 能立即找到新项目
      if (!ctx.projectIds.includes(projectPath)) {
        ctx.projectIds.push(projectPath)
      }
      ctx.projectNames.set(projectPath, projectName)
      console.log('[CEO] AgentContext 已同步新项目:', projectPath)

      // 3.6 推送通知到渲染层 → 项目列表即时刷新
      notifyProjectAdded(projectPath, projectName)

      // 4. 唤醒 Claude Code 终端
      const spawnResult = await spawnPtySession(projectPath)
      if (!spawnResult.success) {
        return { success: false, output: `项目目录已创建并注册，但 Claude Code 启动失败: ${spawnResult.message}` }
      }

      const descLine = description ? `\n📝 需求: ${description}` : ''
      return {
        success: true,
        output: `✅ 新项目创建完成！

📁 路径: ${projectPath}
🆔 名称: ${projectName}
🔌 Claude Code: 已启动 (PID ${spawnResult.pid})${descLine}

下一步：使用 task_project(project_path="${projectPath}", task="请根据需求开发项目...") 派发开发任务给项目 AI。`,
      }
    } catch (e: any) {
      return { success: false, output: `创建项目失败: ${e.message}` }
    }
  },
}

// ============== 注册全部工具 ==============

export function registerAllTools(): void {
  // P0 — 管理控制
  registerTool(wakeProjectsTool)
  registerTool(stopProjectsTool)
  registerTool(checkStatusTool)
  registerTool(broadcastTool)
  registerTool(taskProjectTool)
  // P1 — 情报收集（只读项目 AI 聊天记录，绝不直接读项目文件）
  registerTool(readProjectChatTool)
  registerTool(healthReportTool)
  // P1.5 — 任务队列
  registerTool(pollProjectsTool)
  registerTool(queueStatusTool)
  registerTool(addFollowUpTool)
  // P2 — 验收 & 交付
  registerTool(verifyProjectTool)
  registerTool(generateLaunchScriptsTool)
  // P3 — 插件生态
  registerTool(listAvailablePluginsTool)
  registerTool(installPluginTool)
  // P-INFRA — CEO基础设施工具（修环境、查配置、写脚本）
  // CEO 是工厂维护者，不是项目开发者——用这些工具修基础设施，不碰项目源码
  registerTool(shellExecTool)
  registerTool(readFileTool)
  registerTool(writeFileTool)
  // P-INFRA — CEO项目管理
  registerTool(createProjectTool)
}
