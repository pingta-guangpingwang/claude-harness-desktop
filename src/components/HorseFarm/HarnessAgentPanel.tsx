import { useState, useEffect, useLayoutEffect, useCallback, useRef, useSyncExternalStore } from 'react'
import { useChat } from '../../context/ChatContext'
import { useI18n } from '../../i18n'
import type { HorseFarmProject, HFConfig } from '../../types/horseFarm'
import { getLogs, addLog as addStoreLog, appendLastAiText, clearLogs, loadLogs, subscribe, getAgentRunning, subscribeAgentRunning, setAgentRunning, type LogEntry } from './harnessChatStore'

interface HarnessAgentPanelProps {
  projectIds: string[]
  hfProjects: Record<string, HorseFarmProject>
  hfConfig: HFConfig
  embedded?: boolean
}

interface ProjectHeartbeat {
  path: string
  name: string
  isConnected: boolean
  isConnecting: boolean
  isProcessing: boolean
  lastDataSec: number
}

interface HarnessPermissions {
  autoTrustConfirm: boolean
  autoApproveReads: boolean
  confirmBeforeWrites: boolean
  blockDestructive: boolean
  autoWakeDead: boolean
  memoryCleanupPercent: number  // 内存清理阈值百分比 (30-90)
}

const DEFAULT_PERMISSIONS: HarnessPermissions = {
  autoTrustConfirm: true,
  autoApproveReads: true,
  confirmBeforeWrites: true,
  blockDestructive: true,
  autoWakeDead: false,
  memoryCleanupPercent: 70,
}

type AgentTab = 'chat' | 'monitor'

// Agent event from main process
interface AgentEvent {
  type: 'thinking_start' | 'text_delta' | 'tool_call' | 'tool_result' | 'tool_error' | 'permission_needed' | 'thinking_end' | 'done' | 'error' | 'project_response' | 'report_card' | 'user_queued'
  content?: string
  id?: string
  name?: string
  params?: Record<string, unknown>
  result?: { success: boolean; output: string }
  error?: string
  reason?: string
  finalMessage?: string
  message?: string
  text?: string
  // project_response
  projectName?: string
  projectPath?: string
  timestamp?: string
  // report_card
  title?: string
  summary?: string
  fullReport?: string
  projectCount?: number
  onlineCount?: number
}

export const HarnessAgentPanel: React.FC<HarnessAgentPanelProps> = ({ projectIds, hfProjects, hfConfig, embedded }) => {
  const { t } = useI18n()
  const chat = useChat()
  const [heartbeats, setHeartbeats] = useState<ProjectHeartbeat[]>([])
  const [permissions, setPermissions] = useState<HarnessPermissions>(DEFAULT_PERMISSIONS)
  const actionLog = useSyncExternalStore(subscribe, getLogs)
  const [wakingAll, setWakingAll] = useState(false)
  const [agentInput, setAgentInput] = useState('')
  const [activeTab, setActiveTab] = useState<AgentTab>('chat')
  const [aiThinking, setAiThinking] = useState(false)
  const agentRunning = useSyncExternalStore(subscribeAgentRunning, getAgentRunning)
  const pendingPermissionRef = useRef<{ id: string; name: string; params: Record<string, unknown>; reason: string } | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // 虚拟滚动：只渲染最近 N 条，往上滚动态加载更早记录
  const RENDER_WINDOW = 200
  const LOAD_MORE = 50
  const [renderStart, setRenderStart] = useState(() => Math.max(0, getLogs().length - RENDER_WINDOW))
  const userScrolledUp = useRef(false)
  const prevLogLen = useRef(actionLog.length)
  const prevScrollBottom = useRef(0) // 加载更多时保持滚动位置

  // 初始化 renderStart
  useEffect(() => {
    if (renderStart === 0 && actionLog.length > RENDER_WINDOW) {
      setRenderStart(Math.max(0, actionLog.length - RENDER_WINDOW))
    }
  }, [])

  // 报告弹窗状态
  const [reportModal, setReportModal] = useState<{ title: string; content: string; visible: boolean }>({ title: '', content: '', visible: false })
  const [projectReports, setProjectReports] = useState<Array<{ projectName: string; projectPath: string; content: string; timestamp: string }>>([])
  const [projectDetailModal, setProjectDetailModal] = useState<{ projectName: string; content: string; visible: boolean }>({ projectName: '', content: '', visible: false })

  // ====== / 快捷命令系统 ======

  interface QuickCommand {
    label: string   // 显示名，如 "唤醒全部"
    text: string    // 填入输入框的完整文本
  }

  const BUILTIN_COMMANDS: QuickCommand[] = [
    { label: '唤醒全部项目', text: '唤醒全部项目终端' },
    { label: '停止全部项目', text: '停止全部项目终端' },
    { label: '检查全部状态', text: '检查所有项目状态' },
    { label: 'npm install 全部', text: '请在所有项目中执行 npm install 并汇报结果' },
    { label: 'git status 全部', text: '请检查所有项目的 git status 并汇报' },
    { label: '项目体检 全部', text: '对所有项目进行全面体检，生成中文健康报告' },
    { label: '拉取最新代码 全部', text: '请在所有项目中执行 git pull 并汇报结果' },
    { label: '广播消息', text: '/broadcast ' },
    { label: '生成全部启动脚本', text: '/generate_launch_scripts 为所有项目生成一键启动脚本' },
  ]

  const [customCommands, setCustomCommands] = useState<QuickCommand[]>(() => {
    try {
      const saved = localStorage.getItem('harness_quick_commands')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })

  // 聊天字体缩放
  const [chatFontScale, setChatFontScale] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('harness_chat_font_scale')
      return saved ? parseFloat(saved) : 1.0
    } catch { return 1.0 }
  })
  const setFontScale = (v: number) => {
    const clamped = Math.max(0.8, Math.min(1.8, v))
    setChatFontScale(clamped)
    localStorage.setItem('harness_chat_font_scale', String(clamped))
  }

  const allCommands = [...BUILTIN_COMMANDS, ...customCommands]

  const [showQuickPalette, setShowQuickPalette] = useState(false)
  const [selectedCmdIndex, setSelectedCmdIndex] = useState(0)
  const [filteredCommands, setFilteredCommands] = useState<QuickCommand[]>([])
  const paletteItemRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // 键盘导航时自动滚动到选中项
  useEffect(() => {
    const el = paletteItemRefs.current.get(selectedCmdIndex)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedCmdIndex])

  // ref 版本 — 供 keydown handler 零延迟读取，避免 useCallback 闭包过期
  const paletteRef = useRef({ visible: false, commands: [] as QuickCommand[], index: 0 })
  useEffect(() => {
    paletteRef.current = { visible: showQuickPalette, commands: filteredCommands, index: selectedCmdIndex }
  }, [showQuickPalette, filteredCommands, selectedCmdIndex])

  // 持久化自定义命令
  useEffect(() => {
    localStorage.setItem('harness_quick_commands', JSON.stringify(customCommands))
  }, [customCommands])

  const ha = t.harnessAgent


  // 自动滚动到底部
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [actionLog])

  // 心跳检查
  useEffect(() => {
    const tick = () => {
      const hb: ProjectHeartbeat[] = projectIds.map(id => {
        const ps = chat.projectStatuses[id]
        const hf = hfProjects[id]
        return {
          path: id,
          name: hf?.projectName || id.split('\\').pop() || id,
          isConnected: ps?.isConnected ?? false,
          isConnecting: ps?.isConnecting ?? false,
          isProcessing: ps ? (Date.now() - ps.lastDataAt < 5000) : false,
          lastDataSec: ps?.lastDataAt ? Math.round((Date.now() - ps.lastDataAt) / 1000) : -1,
        }
      })
      setHeartbeats(hb)
    }
    tick()
    const interval = setInterval(tick, 3000)
    return () => clearInterval(interval)
  }, [projectIds, hfProjects, chat.projectStatuses])

  // 恢复持久化的操作日志
  useEffect(() => {
    window.electronAPI.harnessLoadLogs().then(res => {
      if (res.success && res.logs?.length) {
        loadLogs(res.logs as LogEntry[])
      }
    }).catch(() => {})
  }, [])

  // 加载权限设置
  useEffect(() => {
    window.electronAPI.harnessGetPermissions().then(res => {
      if (res.success) {
        setPermissions(prev => ({ ...prev, ...res.permissions }))
      }
    }).catch(() => {})
  }, [])

  // 权限变更时同步到主进程
  useEffect(() => {
    window.electronAPI.harnessSetPermissions(permissions as any).catch(() => {})
  }, [permissions])

  // ====== 虚拟滚动：加载更多后恢复滚动位置 ======
  useLayoutEffect(() => {
    if (prevScrollBottom.current > 0 && scrollContainerRef.current) {
      const el = scrollContainerRef.current
      el.scrollTop = el.scrollHeight - prevScrollBottom.current
      prevScrollBottom.current = 0
    }
  })

  // ====== 切回对话 Tab → 滚到底 ======
  useEffect(() => {
    if (activeTab !== 'chat') return
    userScrolledUp.current = false
    const el = scrollContainerRef.current
    if (!el) return
    // 延迟一帧等 DOM 渲染完
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [activeTab])

  // ====== 新日志 → 自动滚到底（仅当用户未上滚时）======
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    if (actionLog.length > prevLogLen.current && !userScrolledUp.current) {
      // 有新日志，自动滚底
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
      })
    }
    prevLogLen.current = actionLog.length
  }, [actionLog.length])

  // ====== IntersectionObserver：顶哨兵可见 → 加载更早记录 ======
  useEffect(() => {
    const sentinel = sentinelRef.current
    const container = scrollContainerRef.current
    if (!sentinel || !container) return
    const io = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && renderStart > 0) {
        prevScrollBottom.current = container.scrollHeight - container.scrollTop
        setRenderStart(prev => Math.max(0, prev - LOAD_MORE))
      }
    }, { root: container, threshold: 0.1 })
    io.observe(sentinel)
    return () => io.disconnect()
  }, [renderStart])

  // ====== 用户手动上滚检测 ======
  const handleChatScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    userScrolledUp.current = distFromBottom > 80
  }, [])

  // 监听 Agent 事件流（返回 cleanup 防止重复注册）
  useEffect(() => {
    const unsubscribe = window.electronAPI.harnessOnEvent((event: AgentEvent) => {
      switch (event.type) {
        case 'thinking_start':
          setAiThinking(true)
          addStoreLog({ type: 'system', text: '🧠 AI 思考中...' })
          break
        case 'text_delta':
          appendLastAiText(event.content || '')
          break
        case 'tool_call':
          addStoreLog({ type: 'ai-tool', text: `🔧 调用工具: ${event.name}`, toolName: event.name })
          break
        case 'tool_result': {
          const fullOutput = event.result?.output || ''
          const preview = fullOutput.slice(0, 2000)
          const truncated = fullOutput.length > 2000
          addStoreLog({
            type: 'ai-result',
            text: `✅ ${event.name}: ${preview}${truncated ? '\n... (点击查看完整内容)' : ''}`,
            toolName: event.name,
            fullContent: truncated ? fullOutput : undefined,
          })
          break
        }
        case 'tool_error':
          addStoreLog({ type: 'ai-error', text: `❌ ${event.name}: ${event.error || '执行失败'}`, toolName: event.name })
          break
        case 'permission_needed':
          pendingPermissionRef.current = {
            id: event.id || '',
            name: event.name || '',
            params: event.params || {},
            reason: event.reason || '需要确认',
          }
          addStoreLog({ type: 'ai-permission', text: `🔐 需要确认: ${event.name} — ${event.reason || '需要确认'}` })
          break
        case 'done':
          setAiThinking(false)
          setAgentRunning(false)
          break
        case 'error':
          setAiThinking(false)
          setAgentRunning(false)
          addStoreLog({ type: 'ai-error', text: `⚠️ ${event.message || '未知错误'}` })
          break
        case 'project_response': {
          const prName = event.projectName || 'Unknown'
          const prContent = event.content || ''
          setProjectReports(prev => [...prev, {
            projectName: prName,
            projectPath: event.projectPath || '',
            content: prContent,
            timestamp: event.timestamp || new Date().toISOString(),
          }])
          const prPreview = prContent.slice(0, 2000)
          const prTruncated = prContent.length > 2000
          addStoreLog({ type: 'ai-result', text: `📩 ${prName} 回复:\n${prPreview}${prTruncated ? '\n... (点击查看完整内容)' : ''}`, toolName: `project:${prName}`, fullContent: prTruncated ? prContent : undefined })
          break
        }
        case 'report_card': {
          // 可点击的体检报告卡片
          const reportTitle = event.title || '体检报告'
          const reportSummary = event.summary || ''
          const fullReport = event.fullReport || ''
          addStoreLog({ type: 'ai-result', text: `📊 ${reportTitle}\n${reportSummary}`, toolName: 'health_report' })
          setReportModal({ title: reportTitle, content: fullReport, visible: true })
          break
        }
        case 'user_queued':
          // 用户中途插入的消息已被 Agent 合并，无需额外日志（用户消息已在发送时显示）
          break
      }
    })
    return unsubscribe
  }, [])

  // ==== 直接 PTY 操作（监控页快捷按钮）====

  const wakeAllTerminals = useCallback(async () => {
    setWakingAll(true)
    addStoreLog({ type: 'system', text: '🚀 开始唤醒全部项目终端（串行）...' })
    for (const id of projectIds) {
      const name = hfProjects[id]?.projectName || id.split('\\').pop() || id
      const status = await window.electronAPI.ptyGetStatus(id)
      if (status.connected) {
        addStoreLog({ type: 'system', text: `  ✅ ${name} — 已在线，跳过` })
        continue
      }
      addStoreLog({ type: 'system', text: `  🔄 ${name} — 正在拉起...` })
      try {
        await chat.launch(id)
        await new Promise(r => setTimeout(r, 2000))
        const finalStatus = await window.electronAPI.ptyGetStatus(id)
        if (finalStatus.connected) {
          addStoreLog({ type: 'system', text: `  ✅ ${name} — 启动成功` })
        } else {
          addStoreLog({ type: 'system', text: `  ⚠️ ${name} — 主进程会话未就绪` })
        }
        await new Promise(r => setTimeout(r, 4000))
      } catch (err) {
        addStoreLog({ type: 'system', text: `  ❌ ${name} — 异常: ${String(err)}` })
      }
    }
    addStoreLog({ type: 'system', text: '🏁 全部唤醒完成' })
    setWakingAll(false)
  }, [projectIds, hfProjects, chat])

  const stopAllTerminals = useCallback(() => {
    addStoreLog({ type: 'system', text: '🛑 停止全部项目终端...' })
    window.electronAPI.ptyKill(undefined as any).then(() => {
      addStoreLog({ type: 'system', text: '  ✅ 全部终端已停止' })
    }).catch(() => addStoreLog({ type: 'system', text: '  ❌ 停止失败' }))
  }, [])

  const broadcastToAll = useCallback(async (text: string) => {
    let count = 0
    for (const id of projectIds) {
      const ps = chat.projectStatuses[id]
      if (ps?.isConnected) {
        window.electronAPI.ptyWrite(id, text + '\r').catch(() => {})
        count++
        continue
      }
      const name = hfProjects[id]?.projectName || id.split('\\').pop() || id
      addStoreLog({ type: 'system', text: `  🔄 ${name} 离线，先唤醒...` })
      try {
        await chat.launch(id)
        await new Promise(r => setTimeout(r, 3000))
        const status = await window.electronAPI.ptyGetStatus(id)
        if (status.connected) {
          window.electronAPI.ptyWrite(id, text + '\r').catch(() => {})
          count++
          addStoreLog({ type: 'system', text: `  ✅ ${name} 已唤醒并收到广播` })
          await new Promise(r => setTimeout(r, 3000))
        } else {
          addStoreLog({ type: 'system', text: `  ❌ ${name} 唤醒失败，跳过` })
        }
      } catch {
        addStoreLog({ type: 'system', text: `  ❌ ${name} 唤醒异常，跳过` })
      }
    }
    addStoreLog({ type: 'system', text: `📢 已广播到 ${count}/${projectIds.length} 个项目: ${text}` })
  }, [projectIds, hfProjects, chat])

  const checkStatus = useCallback(() => {
    const online = heartbeats.filter(h => h.isConnected).length
    const working = heartbeats.filter(h => h.isProcessing).length
    const offline = heartbeats.filter(h => !h.isConnected && !h.isConnecting).length
    addStoreLog({ type: 'system', text: `🤖 状态报告: 在线 ${online} · 工作中 ${working} · 离线 ${offline}` })
    for (const hb of heartbeats) {
      addStoreLog({ type: 'system', text: `  ${hb.isConnected ? '🟢' : hb.isConnecting ? '🟡' : '🔴'} ${hb.name} — ${hb.isConnecting ? ha.statusConnecting : hb.isConnected ? (hb.isProcessing ? ha.statusWorking : `${ha.statusIdle} ${hb.lastDataSec}s`) : ha.statusOffline}` })
    }
  }, [heartbeats, ha])

  // 生成全部项目启动脚本（直接调用，不经过 AI）
  const generateLaunchBatsAll = useCallback(async () => {
    addStoreLog({ type: 'system', text: '🚀 ' + (ha as any).generatingLaunchBats || '正在生成启动脚本...' })
    try {
      const projects = projectIds.map(id => ({
        path: id,
        name: hfProjects[id]?.projectName || id.split('\\').pop() || id,
      }))
      const res = await window.electronAPI.generateAllLaunchBats(projects)
      if (res.success) {
        const successCount = res.results.filter(r => r.success).length
        addStoreLog({ type: 'system', text: '✅ ' + ((ha as any).launchBatsGenerated || `生成完成`)
          .replace('{count}', String(successCount)).replace('{total}', String(res.results.length)) })
        for (const r of res.results) {
          addStoreLog({ type: 'system', text: `  ${r.success ? '✅' : '❌'} ${r.name}${r.success ? ' → ' + r.command : ' — ' + (r.message || '失败')}` })
        }
      } else {
        addStoreLog({ type: 'system', text: '❌ ' + ((ha as any).launchBatsFailed || '生成启动脚本失败') })
      }
    } catch (err) {
      addStoreLog({ type: 'system', text: '❌ ' + ((ha as any).launchBatsFailed || '生成失败') + ': ' + String(err) })
    }
  }, [projectIds, hfProjects, ha])

  // ==== 驾驭智能体：使用 IPC Agent Loop ====

  const handleAgentCommand = useCallback(async () => {
    const cmd = agentInput.trim()
    if (!cmd) return
    setAgentInput('')
    addStoreLog({ type: 'user', text: cmd })

    const apiKey = hfConfig.apiKeys.find(k => k.enabled && k.status === 'active')
    const model = apiKey?.model || hfConfig.settings.defaultModel || 'deepseek-chat'

    if (!apiKey?.key) {
      addStoreLog({ type: 'system', text: '⚠️ 未配置 API 密钥，使用关键词匹配降级模式。请在设置中配置密钥以获得 AI 智能解析。' })
      // 关键词降级
      const lower = cmd.toLowerCase()
      if (lower.includes('唤醒') || lower.includes('启动全部') || lower.includes('启动所有')) {
        addStoreLog({ type: 'system', text: '🔤 关键词匹配: 唤醒全部终端' })
        wakeAllTerminals()
      } else if (lower.includes('停止全部') || lower.includes('关闭全部')) {
        addStoreLog({ type: 'system', text: '🔤 关键词匹配: 停止全部终端' })
        stopAllTerminals()
      } else if (lower.includes('状态') || lower.includes('心跳') || lower.includes('检查')) {
        addStoreLog({ type: 'system', text: '🔤 关键词匹配: 检查状态' })
        checkStatus()
      } else if (lower.includes('启动脚本') || lower.includes('生成bat') || lower.includes('launch')) {
        addStoreLog({ type: 'system', text: '🔤 关键词匹配: 生成全部启动脚本' })
        generateLaunchBatsAll()
      } else {
        addStoreLog({ type: 'system', text: '🤖 无法识别意图。你可以尝试：唤醒全部终端 / 停止全部终端 / 检查状态 / 广播 shell 命令。' })
      }
      return
    }

    // 构建在线项目集合
    const onlineSet = heartbeats.filter(h => h.isConnected).map(h => h.path)
    const projectNamesMap: Record<string, string> = {}
    for (const id of projectIds) {
      projectNamesMap[id] = hfProjects[id]?.projectName || id.split('\\').pop() || id
    }

    const wasRunning = agentRunning
    if (!wasRunning) {
      setAgentRunning(true)
      setAiThinking(true)
    }

    try {
      const res = await window.electronAPI.harnessSend({
        message: cmd,
        projectIds,
        projectNames: projectNamesMap,
        onlineProjects: onlineSet,
        apiKey: apiKey.key,
        model,
        permissions: permissions as any,
      })
      if (!res.success) {
        addStoreLog({ type: 'ai-error', text: `Agent 错误: ${res.error || '未知'}` })
        if (!wasRunning) {
          setAiThinking(false)
          setAgentRunning(false)
        }
      } else if ((res as any).queued) {
        // 消息已加入队列，Agent 处理完后会通过事件推送
        addStoreLog({ type: 'system', text: '📥 消息已加入队列，待 AI 处理...' })
      }
      // res.success 非 queued 时 finalMessage 已通过 'done' 事件处理
    } catch (err) {
      addStoreLog({ type: 'ai-error', text: `Agent 调用失败: ${String(err).slice(0, 120)}` })
      if (!wasRunning) {
        setAiThinking(false)
        setAgentRunning(false)
      }
    }
  }, [agentInput, hfConfig, projectIds, hfProjects, heartbeats, permissions, wakeAllTerminals, stopAllTerminals, checkStatus, generateLaunchBatsAll])

  // 权限确认
  const handlePermission = useCallback((decision: 'allow' | 'deny' | 'allow_once') => {
    if (pendingPermissionRef.current) {
      addStoreLog({ type: 'system', text: `🔐 ${decision === 'allow' ? '已允许' : decision === 'deny' ? '已拒绝' : '允许本次'}: ${pendingPermissionRef.current.name}` })
      window.electronAPI.harnessResolvePermission(decision)
      pendingPermissionRef.current = null
    }
  }, [])

  // 中止 Agent
  const abortAgent = useCallback(() => {
    window.electronAPI.harnessAbort()
    setAgentRunning(false)
    setAiThinking(false)
    addStoreLog({ type: 'system', text: '⏹️ 已中止 Agent 执行' })
  }, [])

  // ====== / 快捷命令: 输入处理 ======

  const handleAgentInputChange = useCallback((value: string) => {
    setAgentInput(value)

    // 检测 / 开头：显示快捷列表
    if (value.startsWith('/')) {
      const query = value.slice(1).toLowerCase().trim()

      // 模糊匹配：query 的每个字符按顺序出现在目标中（子序列匹配）
      const fuzzyMatch = (target: string, q: string): boolean => {
        let ti = 0
        for (let qi = 0; qi < q.length; qi++) {
          ti = target.indexOf(q[qi], ti)
          if (ti === -1) return false
          ti++
        }
        return true
      }

      const matches = allCommands.filter(cmd => {
        if (!query) return true
        const label = cmd.label.toLowerCase()
        const text = cmd.text.toLowerCase()
        return fuzzyMatch(label, query) || fuzzyMatch(text, query)
          || label.includes(query) || text.includes(query)
      })

      // 自定义命令优先显示，避免被内置命令挤出列表
      const customMatches = matches.filter(c => customCommands.some(cc => cc.label === c.label))
      const builtinMatches = matches.filter(c => !customCommands.some(cc => cc.label === c.label))
      const sorted = [...customMatches, ...builtinMatches]

      const sliced = sorted.slice(0, 12)
      setFilteredCommands(sliced)
      setSelectedCmdIndex(0)
      setShowQuickPalette(true)
      paletteRef.current = { visible: true, commands: sliced, index: 0 }
    } else {
      setShowQuickPalette(false)
      paletteRef.current = { visible: false, commands: [], index: 0 }
    }
  }, [allCommands, customCommands])

  const handleAgentKeyDown = useCallback((e: React.KeyboardEvent) => {
    const p = paletteRef.current

    if (p.visible && p.commands.length > 0) {
      // 快捷面板打开时的键盘导航
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedCmdIndex(i => {
          const next = Math.min(i + 1, p.commands.length - 1)
          paletteRef.current = { ...paletteRef.current, index: next }
          return next
        })
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedCmdIndex(i => {
          const next = Math.max(i - 1, 0)
          paletteRef.current = { ...paletteRef.current, index: next }
          return next
        })
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowQuickPalette(false)
        setAgentInput('')
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const selected = p.commands[p.index]
        if (selected) {
          setAgentInput(selected.text)
          setShowQuickPalette(false)
        }
        return
      }
      // 其他键在面板打开时不处理
      return
    }

    // 正常模式: Enter 发送
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAgentCommand()
    }
  }, [handleAgentCommand])

  const connectedCount = heartbeats.filter(h => h.isConnected).length
  const processingCount = heartbeats.filter(h => h.isProcessing).length

  // 虚拟滚动：仅渲染可见窗口
  const visibleEntries = actionLog.slice(renderStart)
  const hiddenAbove = renderStart

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--app-bg-primary)',
      borderRadius: embedded ? 8 : 0,
      border: embedded ? '1px solid var(--app-border-primary)' : 'none',
      overflow: 'hidden',
    }}>
      {/* 头部 + 快捷操作 + Tab 切换 */}
      <div style={{
        borderBottom: '1px solid var(--app-border-primary)',
        background: 'var(--app-bg-header)', flexShrink: 0,
      }}>
        {/* 标题行 + 快捷操作按钮（始终可见） */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6,
          padding: embedded ? '6px 12px' : '8px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>🛡️</span>
            <div>
              <div style={{ fontSize: embedded ? 12 : 13, fontWeight: 600, color: 'var(--app-text-primary)' }}>
                {ha.title}
              </div>
              <div style={{ fontSize: 10, color: 'var(--app-text-secondary)' }}>
                {ha.subtitle.replace('{n}', String(projectIds.length)).replace('{online}', String(connectedCount)).replace('{working}', String(processingCount))}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={wakeAllTerminals}
              disabled={wakingAll}
              style={{
                padding: '5px 10px', borderRadius: 6, border: 'none',
                background: wakingAll ? 'var(--app-bg-tertiary)' : '#10b981',
                color: wakingAll ? 'var(--app-text-secondary)' : '#fff',
                cursor: wakingAll ? 'not-allowed' : 'pointer',
                fontSize: 11, fontWeight: 600, opacity: wakingAll ? 0.6 : 1,
              }}
            >
              {wakingAll ? '⏳' : '🚀'} {ha.wakeAll}
            </button>
            <button
              onClick={stopAllTerminals}
              style={{
                padding: '5px 10px', borderRadius: 6, border: '1px solid var(--app-border-primary)',
                background: 'var(--app-bg-tertiary)', color: 'var(--app-danger)',
                cursor: 'pointer', fontSize: 11, fontWeight: 500,
              }}
            >
              🛑 {ha.stopAll}
            </button>
            <button
              onClick={() => broadcastToAll('git status')}
              style={{
                padding: '5px 10px', borderRadius: 6, border: '1px solid var(--app-border-primary)',
                background: 'var(--app-bg-tertiary)', color: 'var(--app-text-primary)',
                cursor: 'pointer', fontSize: 11,
              }}
            >
              📊 {ha.quickCheck}
            </button>
            <button
              onClick={generateLaunchBatsAll}
              style={{
                padding: '5px 10px', borderRadius: 6, border: '1px solid var(--app-border-primary)',
                background: 'var(--app-bg-tertiary)', color: 'var(--app-text-primary)',
                cursor: 'pointer', fontSize: 11,
              }}
            >
              🚀 {(ha as any).generateLaunchBats || '生成全部启动脚本'}
            </button>
            {agentRunning && (
              <button onClick={abortAgent} style={{
                padding: '5px 10px', borderRadius: 6, border: '1px solid #ef4444',
                background: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 11,
              }}>
                ⏹️ {ha.abort}
              </button>
            )}
            <span style={{ color: 'var(--app-border-primary)', margin: '0 2px' }}>|</span>
            <button onClick={() => setFontScale(chatFontScale - 0.1)}
              title="缩小字体"
              style={{
                padding: '3px 7px', borderRadius: 4, border: '1px solid var(--app-border-primary)',
                background: 'var(--app-bg-tertiary)', color: 'var(--app-text-primary)',
                cursor: 'pointer', fontSize: 12, fontWeight: 700, lineHeight: 1,
              }}>A⁻</button>
            <span style={{ fontSize: 10, color: 'var(--app-text-secondary)', minWidth: 28, textAlign: 'center' }}>
              {Math.round(chatFontScale * 100)}%
            </span>
            <button onClick={() => setFontScale(chatFontScale + 0.1)}
              title="放大字体"
              style={{
                padding: '3px 7px', borderRadius: 4, border: '1px solid var(--app-border-primary)',
                background: 'var(--app-bg-tertiary)', color: 'var(--app-text-primary)',
                cursor: 'pointer', fontSize: 14, fontWeight: 700, lineHeight: 1,
              }}>A⁺</button>
          </div>
        </div>
        {/* Tab 切换 */}
        <div style={{ display: 'flex', gap: 0, padding: '0 12px 0', marginTop: 2 }}>
          <button
            onClick={() => setActiveTab('chat')}
            style={{
              padding: '6px 18px', borderRadius: '8px 8px 0 0', border: 'none',
              background: activeTab === 'chat' ? 'var(--app-bg-primary)' : 'transparent',
              color: activeTab === 'chat' ? '#6366f1' : 'var(--app-text-secondary)',
              cursor: 'pointer', fontSize: 12, fontWeight: activeTab === 'chat' ? 600 : 400,
              borderBottom: activeTab === 'chat' ? '2px solid #6366f1' : '2px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            💬 {ha.tabChat}
          </button>
          <button
            onClick={() => setActiveTab('monitor')}
            style={{
              padding: '6px 18px', borderRadius: '8px 8px 0 0', border: 'none',
              background: activeTab === 'monitor' ? 'var(--app-bg-primary)' : 'transparent',
              color: activeTab === 'monitor' ? '#6366f1' : 'var(--app-text-secondary)',
              cursor: 'pointer', fontSize: 12, fontWeight: activeTab === 'monitor' ? 600 : 400,
              borderBottom: activeTab === 'monitor' ? '2px solid #6366f1' : '2px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            📊 {ha.tabMonitor}
          </button>
        </div>
      </div>

      {/* ====== Tab: 对话 ====== */}
      {activeTab === 'chat' && (
        <>
          <div
            ref={scrollContainerRef}
            onScroll={handleChatScroll}
            style={{ flex: 1, overflow: 'auto', padding: embedded ? '8px 10px' : '12px 14px' }}
          >
            {/* 操作日志 */}
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: 'var(--app-bg-secondary)', border: '1px solid var(--app-border-primary)',
              minHeight: '100%',
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--app-text-primary)', marginBottom: 8 }}>
                📋 {ha.operationLog}{hiddenAbove > 0 ? ` (已隐藏 ${hiddenAbove} 条，上滚加载)` : ''}
              </div>
              <div style={{
                fontFamily: 'var(--app-font-mono)',
                fontSize: 10 * chatFontScale, lineHeight: 1.7, color: 'var(--app-text-secondary)',
              }}>
                {actionLog.length === 0 && (
                  <div style={{ fontSize: 11 }}>{ha.noLogsYet}</div>
                )}
                {actionLog.length > 0 && (
                  <>
                    {/* 顶哨兵 — 可见时触发加载更早记录 */}
                    <div ref={sentinelRef} style={{ height: 1, marginBottom: 0 }} />
                    {hiddenAbove > 0 && (
                      <div style={{ textAlign: 'center', padding: '4px 0', color: 'var(--app-text-tertiary)', fontSize: 10 }}>
                        ▲ 上滚加载更多 (剩余 {hiddenAbove} 条)
                      </div>
                    )}
                    {visibleEntries.map((entry, i) => {
                      const realIdx = renderStart + i
                      const isClickable = !!entry.fullContent
                      const entryLabel = entry.toolName?.startsWith('project:')
                        ? entry.toolName.replace('project:', '')
                        : (entry.toolName || '工具')
                      const isProject = !!entry.toolName?.startsWith('project:')
                      return (
                      <div key={realIdx} style={{
                        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        padding: '2px 4px', borderRadius: 4,
                        background: entry.type === 'user' ? 'rgba(99,102,241,0.08)'
                          : entry.type === 'ai-error' ? 'rgba(239,68,68,0.08)'
                          : entry.type === 'ai-permission' ? 'rgba(245,158,11,0.08)'
                          : entry.type === 'ai-tool' ? 'rgba(16,185,129,0.06)'
                          : 'transparent',
                        borderLeft: entry.type === 'user' ? '2px solid #6366f1'
                          : entry.type === 'ai-error' ? '2px solid #ef4444'
                          : entry.type === 'ai-permission' ? '2px solid #f59e0b'
                          : entry.type === 'ai-tool' ? '2px solid #10b981'
                          : '2px solid transparent',
                        marginBottom: 2,
                        cursor: isClickable ? 'pointer' : 'default',
                      }}
                        onClick={() => {
                          if (isClickable) {
                            setProjectDetailModal({ projectName: isProject ? entryLabel : `工具: ${entryLabel}`, content: entry.fullContent!, visible: true })
                          }
                        }}
                        title={isClickable ? '点击查看完整内容' : undefined}
                      >
                        <span style={{ color: 'var(--app-text-tertiary)', marginRight: 6 }}>{entry.time}</span>
                        <span style={{
                          color: entry.type === 'user' ? '#6366f1'
                            : entry.type === 'ai-error' ? '#ef4444'
                            : entry.type === 'ai-permission' ? '#f59e0b'
                            : entry.type === 'ai-tool' ? '#10b981'
                            : 'var(--app-text-primary)',
                          fontWeight: entry.type === 'user' || entry.type === 'ai-tool' ? 600 : 400,
                          textDecoration: isClickable ? 'underline' : 'none',
                          textUnderlineOffset: 2,
                        }}>
                          {entry.type === 'user' ? '💬 ' : ''}{entry.text}
                        </span>
                      </div>
                    )})}
                  </>
                )}
                <div ref={logEndRef} />
              </div>
            </div>

            {/* 权限确认栏 */}
            {pendingPermissionRef.current && (
              <div style={{
                marginTop: 8, padding: '10px 12px', borderRadius: 8,
                background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 14 }}>🔐</span>
                <div style={{ flex: 1, fontSize: 11, color: 'var(--app-text-primary)' }}>
                  <strong>{pendingPermissionRef.current.name}</strong>
                  <span style={{ color: 'var(--app-text-secondary)' }}> — {pendingPermissionRef.current.reason}</span>
                </div>
                <button onClick={() => handlePermission('deny')} style={{
                  padding: '4px 12px', borderRadius: 6, border: '1px solid #ef4444',
                  background: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 11,
                }}>{ha.deny}</button>
                <button onClick={() => handlePermission('allow_once')} style={{
                  padding: '4px 12px', borderRadius: 6, border: '1px solid #6366f1',
                  background: 'transparent', color: '#6366f1', cursor: 'pointer', fontSize: 11,
                }}>{ha.allowOnce}</button>
                <button onClick={() => handlePermission('allow')} style={{
                  padding: '4px 12px', borderRadius: 6, border: 'none',
                  background: '#10b981', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                }}>{ha.allowAlways}</button>
              </div>
            )}
          </div>

          {/* 对话输入栏 */}
          <div style={{
            position: 'relative',
            display: 'flex', gap: 8, padding: embedded ? '6px 10px' : '8px 14px',
            borderTop: '1px solid var(--app-border-primary)',
            background: 'var(--app-bg-header)', flexShrink: 0,
          }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                ref={inputRef}
                type="text"
                value={agentInput}
                onChange={e => handleAgentInputChange(e.target.value)}
                onKeyDown={handleAgentKeyDown}
                placeholder={aiThinking ? ha.aiThinking : ha.inputSlashHint}
                style={{
                  width: '100%', padding: '7px 12px', borderRadius: 8,
                  border: '1px solid var(--app-border-input)',
                  background: 'var(--app-bg-input)', color: 'var(--app-text-primary)',
                  fontSize: (embedded ? 11 : 12) * chatFontScale, outline: 'none',
                  opacity: 1,
                  boxSizing: 'border-box',
                }}
              />
              {/* / 快捷命令下拉面板 */}
              {showQuickPalette && filteredCommands.length > 0 && (
                <div style={{
                  position: 'absolute', left: 0, right: 0, bottom: '100%',
                  marginBottom: 4, maxHeight: 260, overflow: 'auto',
                  background: 'var(--app-bg-primary)',
                  border: '1px solid var(--app-border-primary)',
                  borderRadius: 8, boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
                  zIndex: 100,
                }}>
                  {filteredCommands.map((cmd, i) => (
                    <div
                      key={i}
                      ref={el => { if (el) paletteItemRefs.current.set(i, el); else paletteItemRefs.current.delete(i) }}
                      onMouseEnter={() => {
                        setSelectedCmdIndex(i)
                        paletteRef.current = { ...paletteRef.current, index: i }
                      }}
                      onClick={() => {
                        setAgentInput(cmd.text)
                        setShowQuickPalette(false)
                        paletteRef.current = { visible: false, commands: [], index: 0 }
                      }}
                      style={{
                        padding: '7px 12px', cursor: 'pointer',
                        fontSize: 11, lineHeight: 1.4,
                        background: i === selectedCmdIndex ? 'rgba(99,102,241,0.12)' : 'transparent',
                        borderLeft: i === selectedCmdIndex ? '3px solid #6366f1' : '3px solid transparent',
                        color: 'var(--app-text-primary)',
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>/{cmd.label}</span>
                      <span style={{ color: 'var(--app-text-tertiary)', marginLeft: 8, fontSize: 10 }}>
                        {cmd.text.slice(0, 60)}{cmd.text.length > 60 ? '…' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={handleAgentCommand}
              disabled={!agentInput.trim()}
              style={{
                padding: '7px 16px', borderRadius: 8, border: 'none',
                background: agentInput.trim()
                  ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                  : 'var(--app-bg-tertiary)',
                color: agentInput.trim() ? '#fff' : 'var(--app-text-secondary)',
                cursor: agentInput.trim() ? 'pointer' : 'not-allowed',
                fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                opacity: agentInput.trim() ? 1 : 0.5,
                transition: 'all 0.2s',
              }}
            >
              {aiThinking ? '⏳' : '🛡️'} {aiThinking ? ha.aiThinking : ha.submit}
            </button>
          </div>
        </>
      )}

      {/* ====== Tab: 状态监控 ====== */}
      {activeTab === 'monitor' && (
        <div style={{ flex: 1, overflow: 'auto', padding: embedded ? '8px 10px' : '12px 14px' }}>
          {/* 权限设置 */}
          <div style={{
            marginBottom: 12, padding: '10px 12px', borderRadius: 8,
            background: 'var(--app-bg-secondary)', border: '1px solid var(--app-border-primary)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--app-text-primary)', marginBottom: 8 }}>
              🔐 {ha.permissions}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
              {[
                { key: 'autoTrustConfirm' as const, label: ha.autoTrustConfirm, desc: ha.autoTrustConfirmDesc },
                { key: 'autoApproveReads' as const, label: ha.autoApproveReads, desc: ha.autoApproveReadsDesc },
                { key: 'confirmBeforeWrites' as const, label: ha.confirmBeforeWrites, desc: ha.confirmBeforeWritesDesc },
                { key: 'blockDestructive' as const, label: ha.blockDestructive, desc: ha.blockDestructiveDesc },
                { key: 'autoWakeDead' as const, label: ha.autoWakeDead, desc: ha.autoWakeDeadDesc },
              ].map(({ key, label, desc }) => (
                <label key={key} style={{
                  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                  fontSize: 11, color: 'var(--app-text-primary)',
                }} title={desc}>
                  <input
                    type="checkbox"
                    checked={permissions[key] as any}
                    onChange={e => setPermissions(p => ({ ...p, [key]: e.target.checked }))}
                    style={{ accentColor: '#6366f1' }}
                  />
                  {label}
                </label>
              ))}
              {/* 内存清理阈值 */}
              <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
                <div style={{ fontSize: 11, color: 'var(--app-text-secondary)', marginBottom: 4 }}>
                  🧹 {ha.memoryCleanupThreshold}: {permissions.memoryCleanupPercent}%
                </div>
                <input
                  type="range"
                  min={30}
                  max={90}
                  step={5}
                  value={permissions.memoryCleanupPercent}
                  onChange={e => setPermissions(p => ({ ...p, memoryCleanupPercent: Number(e.target.value) }))}
                  style={{ width: '100%', accentColor: '#6366f1' }}
                />
              </div>
            </div>
          </div>

          {/* / 快捷命令管理 */}
          <div style={{
            marginBottom: 12, padding: '10px 12px', borderRadius: 8,
            background: 'var(--app-bg-secondary)', border: '1px solid var(--app-border-primary)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--app-text-primary)', marginBottom: 8 }}>
              ⚡ {ha.quickCommands}
            </div>
            <div style={{ fontSize: 10, color: 'var(--app-text-secondary)', marginBottom: 8 }}>
              {ha.quickCommandsHint}
            </div>
            {/* 内置命令（只读参考） */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--app-text-tertiary)', marginBottom: 4 }}>
                {ha.builtinCommands}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {BUILTIN_COMMANDS.map((cmd, i) => (
                  <span key={i} style={{
                    padding: '2px 8px', borderRadius: 10, fontSize: 10,
                    background: 'var(--app-bg-tertiary)', color: 'var(--app-text-secondary)',
                  }}>
                    /{cmd.label}
                  </span>
                ))}
              </div>
            </div>
            {/* 自定义命令 */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--app-text-tertiary)', marginBottom: 4 }}>
                {ha.customCommands}
              </div>
              {customCommands.length === 0 ? (
                <div style={{ fontSize: 10, color: 'var(--app-text-tertiary)', marginBottom: 4 }}>
                  {ha.noCustomCommands}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                  {customCommands.map((cmd, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 10, padding: '3px 6px', borderRadius: 4,
                      background: 'rgba(99,102,241,0.06)',
                    }}>
                      <span style={{ fontWeight: 600, color: '#6366f1' }}>/{cmd.label}</span>
                      <span style={{ flex: 1, color: 'var(--app-text-secondary)' }}>
                        → {cmd.text.slice(0, 50)}{cmd.text.length > 50 ? '…' : ''}
                      </span>
                      <button
                        onClick={() => setCustomCommands(prev => prev.filter((_, j) => j !== i))}
                        style={{
                          padding: '1px 6px', borderRadius: 4, border: 'none',
                          background: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 10,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* 添加表单 */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                placeholder={ha.cmdLabelPlaceholder}
                id="qcmd-label"
                style={{
                  width: 80, padding: '4px 8px', borderRadius: 6, fontSize: 10,
                  border: '1px solid var(--app-border-input)',
                  background: 'var(--app-bg-input)', color: 'var(--app-text-primary)',
                  outline: 'none',
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const labelInput = document.getElementById('qcmd-label') as HTMLInputElement
                    const textInput = document.getElementById('qcmd-text') as HTMLInputElement
                    const label = labelInput?.value.trim()
                    const text = textInput?.value.trim()
                    if (label && text) {
                      setCustomCommands(prev => [...prev, { label, text }])
                      labelInput.value = ''
                      textInput.value = ''
                    }
                  }
                }}
              />
              <input
                type="text"
                placeholder={ha.cmdTextPlaceholder}
                id="qcmd-text"
                style={{
                  flex: 1, padding: '4px 8px', borderRadius: 6, fontSize: 10,
                  border: '1px solid var(--app-border-input)',
                  background: 'var(--app-bg-input)', color: 'var(--app-text-primary)',
                  outline: 'none',
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const labelInput = document.getElementById('qcmd-label') as HTMLInputElement
                    const textInput = document.getElementById('qcmd-text') as HTMLInputElement
                    const label = labelInput?.value.trim()
                    const text = textInput?.value.trim()
                    if (label && text) {
                      setCustomCommands(prev => [...prev, { label, text }])
                      labelInput.value = ''
                      textInput.value = ''
                    }
                  }
                }}
              />
              <button
                onClick={() => {
                  const labelInput = document.getElementById('qcmd-label') as HTMLInputElement
                  const textInput = document.getElementById('qcmd-text') as HTMLInputElement
                  const label = labelInput?.value.trim()
                  const text = textInput?.value.trim()
                  if (label && text) {
                    setCustomCommands(prev => [...prev, { label, text }])
                    labelInput.value = ''
                    textInput.value = ''
                  }
                }}
                style={{
                  padding: '4px 10px', borderRadius: 6, border: 'none',
                  background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 10, fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {ha.addCommandBtn}
              </button>
            </div>
          </div>

          {/* 项目心跳状态 */}
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: 'var(--app-bg-secondary)', border: '1px solid var(--app-border-primary)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--app-text-primary)', marginBottom: 8 }}>
              💓 {ha.heartbeatTitle}
            </div>
            {heartbeats.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--app-text-secondary)', padding: 8 }}>
                {ha.noProjectsYet}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {heartbeats.map(hb => (
                  <div key={hb.path} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
                    borderRadius: 6, fontSize: 11,
                    background: hb.isProcessing ? 'rgba(16,185,129,0.08)' : 'transparent',
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: hb.isConnecting ? '#f59e0b'
                        : hb.isConnected ? '#10b981' : '#ef4444',
                      boxShadow: hb.isConnecting || hb.isProcessing
                        ? `0 0 6px ${hb.isConnecting ? '#f59e0b' : '#10b981'}`
                        : hb.isConnected ? '0 0 4px #10b981' : undefined,
                      animation: (hb.isConnecting || hb.isProcessing)
                        ? `hf-pulse ${hb.isProcessing ? 0.6 : 1}s ease-in-out infinite`
                        : undefined,
                      opacity: hb.isConnected && !hb.isProcessing ? 0.7 : 1,
                    }} />
                    <span style={{ flex: 1, color: 'var(--app-text-primary)' }}>{hb.name}</span>
                    <span style={{ color: 'var(--app-text-secondary)', fontSize: 10 }}>
                      {hb.isConnecting ? ha.statusConnecting
                        : hb.isConnected ? (hb.isProcessing ? ha.statusWorking : `${ha.statusIdle} ${hb.lastDataSec}s`)
                        : ha.statusOffline}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====== 报告弹窗 ====== */}
      {reportModal.visible && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setReportModal({ title: '', content: '', visible: false })}>
          <div style={{
            background: '#fff', borderRadius: 12, maxWidth: 720, width: '90%', maxHeight: '80vh',
            display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '16px 20px', borderBottom: '1px solid #e5e7eb',
            }}>
              <h3 style={{ margin: 0, fontSize: 16, color: '#1f2937' }}>📊 {reportModal.title}</h3>
              <button onClick={() => setReportModal({ title: '', content: '', visible: false })} style={{
                padding: '4px 10px', borderRadius: 6, border: '1px solid #d1d5db',
                background: '#fff', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: '#6b7280',
              }}>✕</button>
            </div>
            <div style={{
              flex: 1, overflow: 'auto', padding: '20px',
              fontFamily: 'system-ui, sans-serif', fontSize: 13 * chatFontScale,
              lineHeight: 1.7, color: '#374151', whiteSpace: 'pre-wrap',
            }}>
              {reportModal.content}
            </div>
            <div style={{
              padding: '12px 20px', borderTop: '1px solid #e5e7eb',
              display: 'flex', gap: 8, justifyContent: 'flex-end',
            }}>
              <button onClick={() => {
                navigator.clipboard.writeText(reportModal.content)
              }} style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid #d1d5db',
                background: '#fff', cursor: 'pointer', fontSize: 12 * chatFontScale, color: '#374151',
              }}>📋 {ha.reportCopy}</button>
              <button onClick={() => setReportModal({ title: '', content: '', visible: false })} style={{
                padding: '6px 14px', borderRadius: 6, border: 'none',
                background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 12 * chatFontScale,
              }}>{ha.reportClose}</button>
            </div>
          </div>
        </div>
      )}

      {/* ====== 项目回复详情弹窗 ====== */}
      {projectDetailModal.visible && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setProjectDetailModal({ projectName: '', content: '', visible: false })}>
          <div style={{
            background: '#fff', borderRadius: 12, maxWidth: 720, width: '90%', maxHeight: '80vh',
            display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '16px 20px', borderBottom: '1px solid #e5e7eb',
            }}>
              <h3 style={{ margin: 0, fontSize: 16, color: '#1f2937' }}>📋 {projectDetailModal.projectName} 完整内容</h3>
              <button onClick={() => setProjectDetailModal({ projectName: '', content: '', visible: false })} style={{
                padding: '4px 10px', borderRadius: 6, border: '1px solid #d1d5db',
                background: '#fff', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: '#6b7280',
              }}>✕</button>
            </div>
            <div style={{
              flex: 1, overflow: 'auto', padding: '20px',
              fontFamily: 'system-ui, sans-serif', fontSize: 13 * chatFontScale,
              lineHeight: 1.7, color: '#374151', whiteSpace: 'pre-wrap',
            }}>
              {projectDetailModal.content}
            </div>
            <div style={{
              padding: '12px 20px', borderTop: '1px solid #e5e7eb',
              display: 'flex', gap: 8, justifyContent: 'flex-end',
            }}>
              <button onClick={() => {
                navigator.clipboard.writeText(projectDetailModal.content)
              }} style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid #d1d5db',
                background: '#fff', cursor: 'pointer', fontSize: 12 * chatFontScale, color: '#374151',
              }}>📋 {ha.reportCopy}</button>
              <button onClick={() => setProjectDetailModal({ projectName: '', content: '', visible: false })} style={{
                padding: '6px 14px', borderRadius: 6, border: 'none',
                background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 12 * chatFontScale,
              }}>{ha.reportClose}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
