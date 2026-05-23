import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  /** true = actual LLM response (starting from ●), never auto-collapsed */
  isResponse?: boolean
}

export interface ChatSession {
  sessionId: string
  projectPath: string
  messages: ChatMessage[]
  startedAt: string
  endedAt?: string
  label?: string
}

interface ProjectSessionState {
  messages: ChatMessage[]
  isConnected: boolean
  isConnecting: boolean
  sessionId: string
  sessionRef: ChatSession | null
  rawLogs: string[]
  lastDataAt: number
}

export interface ProjectPtyStatus {
  isConnected: boolean
  isConnecting: boolean
  lastDataAt: number
}

interface ChatContextValue {
  messages: ChatMessage[]
  isConnected: boolean
  isConnecting: boolean
  currentProject: string | null
  currentSessionId: string | null
  rawLogs: string[]
  projectStatuses: Record<string, ProjectPtyStatus>
  launch: (projectPath: string) => Promise<void>
  send: (text: string) => void
  stop: () => void
  clear: () => void
  loadSession: (session: ChatSession) => void
  listSessions: (projectPath: string) => Promise<ChatSession[]>
  deleteSession: (projectPath: string, sessionId: string) => Promise<void>
}

const ChatContext = createContext<ChatContextValue | null>(null)

function createId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function normPath(p: string): string {
  // 统一路径格式：反斜杠、去尾斜杠、去空格、盘符大写
  return p.replace(/\//g, '\\').replace(/\\+$/, '').trim()
    .replace(/^([a-z]):/i, (_, d) => d.toUpperCase() + ':')
}

function emptySession(): ProjectSessionState {
  return {
    messages: [],
    isConnected: false,
    isConnecting: false,
    sessionId: '',
    sessionRef: null,
    rawLogs: [],
    lastDataAt: 0,
  }
}

/** Claude Code 思考阶段关键词 → 对应状态文本 */
const THINKING_PATTERNS: [RegExp, string][] = [
  [/scurry/i, 'Scurrying...'],
  [/simmer/i, 'Simmering...'],
  [/brew/i, 'Brewed...'],
  [/crunch/i, 'Crunched...'],
  [/wibbl/i, 'Wibbling...'],
  [/boogie/i, 'Boogieing...'],
  [/orchestrat/i, 'Orchestrating...'],
  [/almost done/i, 'Almost done...'],
  [/think/i, 'Thinking...'],
  [/load/i, 'Loading...'],
  [/analyz/i, 'Analyzing...'],
  [/process/i, 'Processing...'],
  [/search/i, 'Searching...'],
  [/read/i, 'Reading files...'],
  [/edit/i, 'Editing...'],
  [/execut/i, 'Executing...'],
  [/init/i, 'Initializing...'],
  [/generat/i, 'Generating...'],
  [/compil/i, 'Compiling...'],
  [/check/i, 'Checking...'],
]

/** 从一段文本里提取 Claude Code 思考状态（返回 null 表示不是思考阶段输出） */
function extractThinkingStatus(text: string): string | null {
  // 先全量清洗 ANSI（CSI + OSC），再检测
  const stripped = text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/[\r\n]/g, ' ')
    .replace(/[▐▌▛▜▟▙▘▝▀▄█▊▎▌▏▍▋│├┤┼╺╍┄┅┈┉]/g, '')
    .trim()
  if (!stripped) return null
  // 检测 spinner 字符 + 状态词
  if (/[⏳✻✽✢✶✹✺✼✾·•]/.test(stripped)) {
    for (const [re, label] of THINKING_PATTERNS) {
      if (re.test(stripped)) return label
    }
    return 'Working...'
  }
  // 纯 spinner / 进度条类内容
  if (/^[⏳✻✽✢✶✹✺✼✾·•\s▐▌▛▜▟▙▘▝▀▄█▊▎▌▏▍▋│├┤┼╺╍┄┅┈┉]+$/.test(stripped)) return 'Working...'
  // 检测含 orchestrate/almost done 等非 spinner 状态文本
  for (const [re, label] of THINKING_PATTERNS) {
    if (re.test(stripped)) return label
  }
  return null
}

/** 清理 PTY 输出：保留颜色 CSI，去除 TUI 控制码和装饰字符。
 *  返回 { clean, status } — 如果有意义的内容返回 clean，否则返回 thinking status。 */
function cleanPtyOutput(text: string): { clean: string; status: string | null } {
  let out = text
    // 去除 OSC (title/notification)
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // 全量去除 CSI 序列（包含光标移动/擦除/颜色SGR/模式设置）
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b[>=]/g, '')
    // CR 行为：\r\n → \n，单独的 \r 覆盖当前行
    .replace(/\r\n/g, '\n')
    .replace(/[^\n]*\r(?!\n)/g, '')
    // 替换 TUI 框线字符
    .replace(/[╭╰╮╯]/g, '+')
    .replace(/[─━]/g, '-')
    .replace(/[│┃]/g, '|')
    .replace(/[▐▌▛▜▟▙▘▝▀▄█▊▎▌▏▍▋│├┤┼╺╍┄┅┈┉]/g, '')
    // 丢弃 OSC 设置终端标题等
    .replace(/\x1b\][^\x1b]*/g, '')

  // 逐行过滤噪音
  const lines = out.split('\n')
  const filtered: string[] = []
  for (const line of lines) {
    const trimmed = line.replace(/\x1b\[[0-9;]*m/g, '').trim()
    if (!trimmed) continue
    // Claude Code spinner 状态行 + orchestrating 状态（v2 新增 ● 🧠 Frosting）
    if (/^[⏳✻✽✢✶✹✺✼✾·•●🧠]\s*(Scurrying|Simmering|Brewed|Crunched|Wibbling|Boogieing|Frosting|Orchestrat|thinking|Loading|Working|almost done)/i.test(trimmed)) continue
    // 纯装饰分隔线
    if (/^[-━─=–—]{6,}$/.test(trimmed)) continue
    // 快捷提示/横幅行
    if (/^\?\s*for\s*shortcuts/i.test(trimmed)) continue
    if (/^esc\s*to\s*interrupt/i.test(trimmed)) continue
    if (/^\*\s*high\s*·/i.test(trimmed)) continue
    if (/\d+\s*skill\s*descriptions?\s*dropped/i.test(trimmed)) continue
    if (/\/doctor\s*for\s*details/i.test(trimmed)) continue
    if (/^(Welcome back|Tips for getting|Run \/init|What.s new|Internal fixes|API Usage Billing)/i.test(trimmed)) continue
    if (/^\d+\s*tokens?\s*·\s*thinking/i.test(trimmed)) continue
    // TUI footer 行（快捷键提示、接受编辑、向上编辑队列）
    if (/Tab to (amend|complete)/i.test(trimmed)) continue
    if (/ctrl\+e to explain/i.test(trimmed)) continue
    if (/shift\+tab to cycle/i.test(trimmed)) continue
    if (/Press up to edit/i.test(trimmed)) continue
    if (/accept edits on/i.test(trimmed)) continue
    // Tip / ⎿ 提示行
    if (/⎿\s*Tip:/i.test(trimmed)) continue
    if (/^\s*⎿/i.test(trimmed)) continue
    // orchestrating 进度行（含 tokens / thought for 等统计）
    if (/[✻✽✢✶]\s*Orchestrat/i.test(trimmed)) continue
    // Searched for / Reading file 状态行
    if (/^(Searched for|Reading)\s*\d/i.test(trimmed)) continue
    // 纯 spinner 字符残留
    if (/^[⏳✻✽✢✶✹✺✼✾·•●🧠\s]+$/.test(trimmed)) continue
    // 单字符/短数字残留（ANSI 碎片）
    if (/^[a-zA-Z0-9]{1,2}$/.test(trimmed)) continue
    // Claude Code v2 状态栏残片 / token 行
    if (/^(?:acceptedits|edits)\s*(on|off)/i.test(trimmed)) continue
    if (/↓\s*to\s*manage/i.test(trimmed)) continue
    if (/Running in the background/i.test(trimmed)) continue
    if (/[↑↓]\s*[\d.]+[km]?\s*tokens?/i.test(trimmed)) continue
    if (/thought\s+for\s+\d+s/i.test(trimmed)) continue
    if (/^🧠\s*(Working|Almost done|Done)/i.test(trimmed)) continue
    if (/^●\s*\w+…/i.test(trimmed) && trimmed.length < 40) continue
    filtered.push(line)
  }

  // 去重连续相同行
  const deduped: string[] = []
  for (const line of filtered) {
    if (line !== deduped[deduped.length - 1]) deduped.push(line)
  }

  const clean = deduped.join('\n').replace(/\n{4,}/g, '\n\n').trim()

  // 如果 clean 为空或是纯思考阶段输出，提取状态
  if (!clean) {
    const status = extractThinkingStatus(text)
    return { clean: '', status }
  }

  return { clean, status: null }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const sessionsRef = useRef<Map<string, ProjectSessionState>>(new Map())
  const [currentProject, setCurrentProject] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  /** 读取指定项目会话状态（不存在返回空） */
  function getSession(key: string): ProjectSessionState {
    return sessionsRef.current.get(key) || emptySession()
  }

  /** 更新指定项目会话状态并触发渲染 */
  function updateSession(key: string, updater: (prev: ProjectSessionState) => ProjectSessionState) {
    const prev = getSession(key)
    sessionsRef.current.set(key, updater(prev))
    setVersion(v => v + 1)
  }

  // 当前项目的派生状态
  const active = currentProject ? getSession(currentProject) : emptySession()
  const messages = active.messages
  const isConnected = active.isConnected
  const isConnecting = active.isConnecting
  const rawLogs = active.rawLogs
  const currentSessionId = active.sessionId || null

  // 所有项目的 PTY 状态快照（每次 session 变更时重新派生）
  const projectStatuses: Record<string, ProjectPtyStatus> = {}
  sessionsRef.current.forEach((s, key) => {
    projectStatuses[key] = {
      isConnected: s.isConnected,
      isConnecting: s.isConnecting,
      lastDataAt: s.lastDataAt,
    }
  })

  // 实时推送所有项目消息到主进程内存（仅 in-memory Map，不写磁盘，零延迟）。
  // 供 getRecentPtyOutput 实时读取，确保 Agent 看到的与 Chat UI 完全一致。
  useEffect(() => {
    sessionsRef.current.forEach((s, key) => {
      if (s.messages.length === 0) return
      window.electronAPI.chatPushMessages(key, s.messages).catch(() => {})
    })
  }, [version])

  // 自动保存所有项目会话到磁盘（仅问答内容，过滤思考状态气泡）。
  // debounce 2s 避免高频 PTY 数据写入风暴。
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      sessionsRef.current.forEach((s, key) => {
        if (!s.sessionRef) return
        s.sessionRef.messages = s.messages.filter(m => {
          if (m.role === 'user') return true
          if (m.role === 'assistant' && m.isResponse) return true
          if (m.role === 'system' && !m.content.startsWith('🧠')) return true
          return false
        })
        window.electronAPI.sessionSave({ ...s.sessionRef, messages: s.sessionRef.messages }).catch(() => {})
      })
    }, 2000)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [version])

  // 监听 PTY 数据（全局监听，按 projectPath 分发）
  // 思考阶段 → 只更新单条状态气泡；● 回复 → 追加实际回复消息
  useEffect(() => {
    console.log('[Chat] ptyOnData listener registered (multi-project)')
    const unsubData = window.electronAPI.ptyOnData((projectPath: string, data: string) => {
      const key = normPath(projectPath)
      const { clean, status } = cleanPtyOutput(data)
      console.log('[Chat] PTY rx:', data.length, 'bytes, proj:', key.slice(-30),
        status ? `→ [${status}]` : `→ ${clean.slice(0, 60)}`)

      updateSession(key, prev => {
        const logEntry = `[${new Date().toLocaleTimeString('zh-CN')}] raw:${data.length}B → ${status ? `[${status}]` : clean.slice(0, 400)}`
        const newLogs = [...prev.rawLogs.slice(-99), logEntry]

        const wasDisconnected = !prev.isConnected && !prev.isConnecting

        // 思考阶段：只更新最后一条 thinking 状态气泡（不累积 TUI 噪音）
        if (status) {
          const msgs = [...prev.messages]
          const last = msgs[msgs.length - 1]
          if (last && last.role === 'system' && last.content.startsWith('🧠')) {
            // 更新已有的 thinking 状态
            msgs[msgs.length - 1] = { ...last, content: `🧠 ${status}`, timestamp: new Date().toISOString() }
          } else {
            msgs.push({ id: createId(), role: 'system', content: `🧠 ${status}`, timestamp: new Date().toISOString() })
          }
          return { ...prev, rawLogs: newLogs, messages: msgs, lastDataAt: Date.now(), isConnected: prev.isConnected || wasDisconnected, isConnecting: false }
        }

        if (!clean) {
          return { ...prev, rawLogs: newLogs, lastDataAt: Date.now(), isConnected: prev.isConnected || wasDisconnected, isConnecting: false }
        }

        // 检测 ● — Claude Code 实际回复起始标记
        const markerIdx = clean.indexOf('●')
        const isRealResponse = markerIdx !== -1 && clean.slice(markerIdx).trim().length > 3

        if (isRealResponse) {
          const before = clean.slice(0, markerIdx).trim()
          const response = clean.slice(markerIdx)

          let msgs = [...prev.messages]
          // 移除 thinking 状态气泡（已被实际内容取代）
          const lastMsg = msgs[msgs.length - 1]
          if (lastMsg && lastMsg.role === 'system' && lastMsg.content.startsWith('🧠')) {
            msgs.pop()
          }

          // ● 之前的过渡内容追加到上一个非响应气泡
          if (before) {
            const last = msgs[msgs.length - 1]
            if (last && last.role === 'assistant' && !last.isResponse) {
              msgs = [...msgs.slice(0, -1), { ...last, content: last.content + before }]
            }
          }

          // 实际回复
          msgs.push({ id: createId(), role: 'assistant' as const, content: response, timestamp: new Date().toISOString(), isResponse: true })
          return { ...prev, rawLogs: newLogs, messages: msgs, lastDataAt: Date.now(), isConnected: true, isConnecting: false }
        }

        // 无 marker — 判断是否为有效内容（非纯噪音碎片）
        // 太短的片段（< 15 chars 且无 CJK）视为 ANSI 残留，忽略
        const hasCJK = /[\u4e00-\u9fff]/.test(clean)
        if (!hasCJK && clean.length < 15) {
          return { ...prev, rawLogs: newLogs, lastDataAt: Date.now(), isConnected: true, isConnecting: false }
        }
        // 追加到最后一条 assistant 气泡（非响应内容），但限制最大长度
        const last = prev.messages[prev.messages.length - 1]
        if (last && last.role === 'assistant' && !last.isResponse) {
          const merged = last.content + clean
          // 非响应气泡超过 2000 字符就截断（保留尾部，丢弃头部噪音）
          const capped = merged.length > 2000 ? '…' + merged.slice(-1500) : merged
          return { ...prev, rawLogs: newLogs, lastDataAt: Date.now(), isConnected: true, isConnecting: false,
            messages: [...prev.messages.slice(0, -1), { ...last, content: capped }] }
        }
        return { ...prev, rawLogs: newLogs, lastDataAt: Date.now(), isConnected: true, isConnecting: false,
          messages: [...prev.messages, { id: createId(), role: 'assistant' as const, content: clean, timestamp: new Date().toISOString() }] }
      })
    })

    const unsubSpawned = window.electronAPI.ptyOnSpawned((projectPath: string, sessionId: string, pid: number) => {
      const key = normPath(projectPath)
      console.log('[Chat] PTY spawned (external), proj:', key.slice(-30), 'pid:', pid)
      // 如果 ChatContext 还没有该项目的会话，自动创建（含 sessionRef，确保后续保存能工作）
      updateSession(key, prev => {
        if (prev.isConnected || prev.isConnecting) return prev // 已有会话，不覆盖
        const initialMsg = {
          id: createId(),
          role: 'system' as const,
          content: `Claude Code 终端已启动 (PID ${pid})`,
          timestamp: new Date().toISOString(),
        }
        const newSessionRef = {
          sessionId: sessionId || createId(),
          projectPath: key,
          messages: [initialMsg],
          startedAt: new Date().toISOString(),
        }
        return {
          ...prev,
          messages: [initialMsg],
          isConnected: false,
          isConnecting: true,
          lastDataAt: Date.now(),
          sessionId: newSessionRef.sessionId,
          sessionRef: newSessionRef,
        }
      })
      // 延迟设为已连接（给 Claude Code 启动时间）
      setTimeout(() => {
        updateSession(key, prev => {
          if (!prev.isConnected && prev.isConnecting) {
            return { ...prev, isConnected: true, isConnecting: false }
          }
          return prev
        })
      }, 4000)
    })

    const unsubExit = window.electronAPI.ptyOnExit((projectPath: string, _code: number) => {
      const key = normPath(projectPath)
      console.log('[Chat] PTY exit, proj:', key.slice(-30))
      updateSession(key, prev => {
        if (prev.sessionRef) {
          prev.sessionRef.endedAt = new Date().toISOString()
          // 退出时也只保留问答内容，过滤思考气泡
          prev.sessionRef.messages = prev.messages.filter(m => {
            if (m.role === 'user') return true
            if (m.role === 'assistant' && m.isResponse) return true
            if (m.role === 'system' && !m.content.startsWith('🧠')) return true
            return false
          })
          window.electronAPI.sessionSave({ ...prev.sessionRef }).catch(() => {})
        }
        // isConnecting=true 说明是新 spawn 杀掉了旧会话，不追加结束提示
        const wasKilledForRelaunch = prev.isConnecting
        return {
          ...prev,
          isConnected: false,
          isConnecting: false,
          messages: wasKilledForRelaunch
            ? prev.messages
            : [...prev.messages, {
                id: createId(),
                role: 'system' as const,
                content: `Claude Code 会话已结束 (退出码: ${_code})`,
                timestamp: new Date().toISOString(),
              }],
        }
      })
    })

    return () => {
      unsubData()
      unsubExit()
      unsubSpawned()
    }
  }, [])

  // ref-based pattern — 始终读取最新 getSession/updateSession，解决三击切换问题
  const launchRef = useRef<(projectPath: string) => Promise<void>>(undefined)
  launchRef.current = async (projectPath: string) => {
    const key = normPath(projectPath)

    // 先切换到该项目
    setCurrentProject(key)

    const existing = getSession(key)

    // 已连接 → 直接复用，不重新启动
    if (existing.isConnected) {
      console.log('[Chat] 项目已连接，复用现有会话:', key.slice(-30))
      return
    }

    // 查询主进程实际 PTY 状态（防止 ChatContext 状态滞后于 Harness Agent 启动的会话）
    try {
      const realStatus = await window.electronAPI.ptyGetStatus(key)
      if (realStatus.connected) {
        console.log('[Chat] PTY 实际已运行 (由驾驭智能体启动)，同步状态:', key.slice(-30), 'pid:', realStatus.pid)
        updateSession(key, prev => ({
          ...prev,
          isConnected: true,
          isConnecting: false,
          lastDataAt: realStatus.lastDataAt,
        }))
        return
      }
    } catch { /* ptyGetStatus 不可用时走正常启动流程 */ }

    // 正在连接中 → 等待
    if (existing.isConnecting) {
      console.log('[Chat] 项目正在连接中:', key.slice(-30))
      return
    }

    // 标记连接中
    updateSession(key, prev => ({ ...prev, isConnecting: true }))

    const res = await window.electronAPI.ptySpawn(key)

    if (res.success) {
      const sid = createId()
      const initialMsg: ChatMessage = {
        id: createId(),
        role: 'system',
        content: `Claude Code 正在初始化...`,
        timestamp: new Date().toISOString(),
      }
      // 先标记 isConnecting，等待 Claude Code 完成启动（信任确认 + 欢迎页）
      updateSession(key, _prev => ({
        messages: [initialMsg],
        isConnected: false,
        isConnecting: true,
        lastDataAt: Date.now(),
        sessionId: sid,
        sessionRef: {
          sessionId: sid,
          projectPath: key,
          messages: [initialMsg],
          startedAt: new Date().toISOString(),
        },
        rawLogs: [`[${new Date().toLocaleTimeString('zh-CN')}] PTY: ${key}`],
      }))

      // 4s 后标记为已连接（给 Claude Code 足够时间完成安全确认和欢迎屏）
      setTimeout(() => {
        updateSession(key, prev => {
          if (!prev.isConnected && prev.isConnecting) {
            return {
              ...prev,
              isConnected: true,
              isConnecting: false,
              messages: [...prev.messages, {
                id: createId(),
                role: 'system' as const,
                content: `Claude Code 已就绪 — ${key.split('\\').pop() || key}`,
                timestamp: new Date().toISOString(),
              }],
            }
          }
          return prev
        })
      }, 4000)
    } else {
      updateSession(key, prev => ({
        ...prev,
        isConnecting: false,
        messages: [...prev.messages, {
          id: createId(),
          role: 'system' as const,
          content: `启动 Claude Code 失败: ${res.message}`,
          timestamp: new Date().toISOString(),
        }],
      }))
    }
  }

  const launch = useCallback((projectPath: string) => launchRef.current!(projectPath), [])

  const send = useCallback((text: string) => {
    const key = currentProject
    if (!key) return
    updateSession(key, prev => ({
      ...prev,
      messages: [...prev.messages, {
        id: createId(),
        role: 'user' as const,
        content: text,
        timestamp: new Date().toISOString(),
      }],
    }))
    window.electronAPI.ptyWrite(key, text + '\r')
  }, [currentProject])

  const stop = useCallback(() => {
    const key = currentProject
    if (!key) return
    window.electronAPI.ptyKill(key)
    updateSession(key, prev => ({
      ...prev,
      isConnected: false,
      isConnecting: false,
    }))
  }, [currentProject])

  const clear = useCallback(() => {
    const key = currentProject
    if (!key) return
    updateSession(key, () => ({
      messages: [],
      isConnected: false,
      isConnecting: false,
      lastDataAt: 0,
      sessionId: '',
      sessionRef: null,
      rawLogs: [],
    }))
  }, [currentProject])

  const loadSession = useCallback((session: ChatSession) => {
    const key = normPath(session.projectPath)
    setCurrentProject(key)
    updateSession(key, prev => ({
      ...prev,
      isConnected: false,
      messages: session.messages,
      sessionId: session.sessionId,
      sessionRef: { ...session },
    }))
  }, [])

  const listSessions = useCallback(async (projectPath: string): Promise<ChatSession[]> => {
    const result = await window.electronAPI.sessionList(projectPath)
    if (result.success) return result.sessions
    return []
  }, [])

  const deleteSession = useCallback(async (projectPath: string, sessionId: string) => {
    await window.electronAPI.sessionDelete(projectPath, sessionId)
  }, [])

  return (
    <ChatContext.Provider value={{
      messages, isConnected, isConnecting, currentProject, currentSessionId, rawLogs, projectStatuses,
      launch, send, stop, clear, loadSession, listSessions, deleteSession,
    }}>
      {children}
    </ChatContext.Provider>
  )
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within ChatProvider')
  return ctx
}
