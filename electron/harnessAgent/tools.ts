// 驾驭智能体 — 内置工具实现
import type { AgentTool, AgentContext, ToolResult } from './types'
import { registerTool } from './toolRegistry'
import { spawnPtySession, killPtySession, getPtyStatus, writeToPty, sendAndCollect } from '../modules/ptyManager.js'
import { taskQueue, type AgentTask } from './taskQueue.js'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

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
  description: '检查全部项目的心跳状态（实时查询 PTY 连接状态），包括在线/离线/工作中/空闲。',
  parameters: { type: 'object', properties: {} },
  group: 'control',
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(_params, ctx): Promise<ToolResult> {
    const lines: string[] = []
    let online = 0
    for (const id of ctx.projectIds) {
      const name = ctx.projectNames.get(id) || id.split('\\').pop() || id
      const ptyStatus = getPtyStatus(id)
      const isOnline = ptyStatus.connected
      if (isOnline) online++
      const status = isOnline ? '🟢 在线' : '🔴 离线'
      const detail = isOnline && ptyStatus.pid ? ` (PID ${ptyStatus.pid})` : ''
      lines.push(`${status} — ${name}${detail}`)
    }
    lines.unshift(`总计: ${online}/${ctx.projectIds.length} 在线（实时 PTY 状态）`)
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
        const result = await sendAndCollect(id, task, 90000)

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

    results.unshift(`已向 ${okCount}/${ctx.projectIds.length} 个项目广播任务: "${task.slice(0, 100)}${task.length > 100 ? '...' : ''}"`)
    return { success: true, output: results.join('\n') }
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

      // 发送任务并等待项目 AI 回复（最长 90s）
      const result = await sendAndCollect(match, task, 90000)

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
      return { success: result.success, output: `⚠️ ${name}: 已派发但无回复` }
    } catch (err) {
      return { success: false, output: `❌ ${name}: ${String(err)}` }
    }
  },
}

// ============== P1.5 任务队列工具 ==============

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
  description: '对全部或指定项目进行全面体检：PTY 连接状态 + 最近聊天记录摘要 + 工作状态分析。生成结构化的中文健康报告。直接返回报告内容，无需再向项目 AI 提问。',
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

// ============== P1 文件/Shell 工具 ==============

const readFileTool: AgentTool = {
  name: 'read_file',
  description: '读取项目中的文件内容。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '要读取的文件绝对路径' },
      limit_lines: { type: 'number', description: '最多读取行数，默认 500' },
    },
    required: ['file_path'],
  },
  group: 'read',
  isReadOnly: true,
  isConcurrencySafe: true,
  core: false,
  async execute(params): Promise<ToolResult> {
    const filePath = params.file_path as string
    const limit = (params.limit_lines as number) || 500
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, output: `文件不存在: ${filePath}` }
      }
      const content = fs.readFileSync(filePath, 'utf-8')
      const lines = content.split('\n')
      const truncated = lines.slice(0, limit).join('\n')
      const suffix = lines.length > limit ? `\n... (共 ${lines.length} 行，已截取前 ${limit} 行)` : ''
      return { success: true, output: truncated + suffix }
    } catch (err) {
      return { success: false, output: `读取失败: ${String(err)}` }
    }
  },
}

const writeFileTool: AgentTool = {
  name: 'write_file',
  description: '写入文件内容到项目中。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '要写入的文件绝对路径' },
      content: { type: 'string', description: '要写入的内容' },
    },
    required: ['file_path', 'content'],
  },
  group: 'write',
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: true,
  core: false,
  async execute(params): Promise<ToolResult> {
    const filePath = params.file_path as string
    const content = params.content as string
    try {
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(filePath, content, 'utf-8')
      return { success: true, output: `文件已写入: ${filePath} (${content.length} 字符)` }
    } catch (err) {
      return { success: false, output: `写入失败: ${String(err)}` }
    }
  },
}

const shellExecTool: AgentTool = {
  name: 'shell_exec',
  description: '在指定项目目录中执行 shell 命令。',
  parameters: {
    type: 'object',
    properties: {
      project_path: { type: 'string', description: '项目路径（作为工作目录）' },
      command: { type: 'string', description: '要执行的命令' },
    },
    required: ['command'],
  },
  group: 'execute',
  isReadOnly: false,
  isConcurrencySafe: false,
  core: false,
  isDestructive: (params) => {
    const cmd = (params.command as string || '').toLowerCase()
    return !(cmd.startsWith('echo ') || cmd.startsWith('ls ') || cmd.startsWith('dir ') || cmd.startsWith('cat ') || cmd.startsWith('type '))
  },
  checkPermissions(params) {
    const cmd = (params.command as string || '')
    if (/\brm\s+-rf\b|\brmdir\b|\bdel\s+\/[fs]\b|\bformat\b/i.test(cmd)) {
      return { decision: 'deny', reason: '危险命令已拦截: ' + cmd }
    }
    return null
  },
  async execute(params): Promise<ToolResult> {
    const cmd = params.command as string
    const cwd = (params.project_path as string) || process.cwd()
    try {
      const stdout = execSync(cmd, { cwd, timeout: 30000, encoding: 'utf-8', maxBuffer: 1024 * 1024 })
      return { success: true, output: stdout.slice(0, 5000) }
    } catch (err: any) {
      return { success: false, output: err.stderr || err.message || String(err) }
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
  // P1 — 情报收集
  registerTool(readProjectChatTool)
  registerTool(healthReportTool)
  // P1.5 — 任务队列
  registerTool(queueStatusTool)
  registerTool(addFollowUpTool)
  // P1 — 文件/Shell（仅紧急情况使用，系统提示词禁止日常使用）
  registerTool(readFileTool)
  registerTool(writeFileTool)
  registerTool(shellExecTool)
}
