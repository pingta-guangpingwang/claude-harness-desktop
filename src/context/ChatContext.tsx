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

/** 清理 PTY 输出：保留颜色 CSI，去除 TUI 控制码和装饰字符 */
function cleanPtyOutput(text: string): string {
  let out = text
    // 去除 OSC (title/notification)，保留 CSI
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // 去除光标移动/擦除 CSI (不改变颜色的)，保留 SGR (m 结尾)
    .replace(/\x1b\[[0-9;]*[ABCDEFGHJKSTfnsu]/g, '')
    // 去除模式设置
    .replace(/\x1b\[\?[0-9;]*[hl]/g, '')
    .replace(/\x1b[>=]/g, '')
    // CR 行为：\r\n → \n，单独的 \r 后无 \n 表示覆盖当前行，丢弃\r前当前行内容
    .replace(/\r\n/g, '\n')
    .replace(/[^\n]*\r(?!\n)/g, '')
    // 替换 TUI 框线字符为纯文本
    .replace(/[╭╰╮╯]/g, '+')
    .replace(/[─━]/g, '-')
    .replace(/[│┃]/g, '|')
    .replace(/[▐▌▛▜▟▙▘▝▀▄█]/g, '')
    .replace(/[●◉◎○◯◌◍◐◑◒◓]/g, '*')

  // 逐行过滤 Claude Code TUI 噪音
  const lines = out.split('\n')
  const filtered = lines.filter(line => {
    const trimmed = line.replace(/\x1b\[[0-9;]*m/g, '').trim()
    if (!trimmed) return false  // 空行丢弃（后面统一加回）
    // Claude Code 状态行
    if (/^[·•✻✽✢✶⏳]\s*(Scurrying|Simmering|Brewed|Crunched|thinking|Loading)/i.test(trimmed)) return false
    // 纯装饰分隔线
    if (/^[-━─=–—]{8,}$/.test(trimmed)) return false
    // 快捷提示行
    if (/^\?\s*for\s*shortcuts/i.test(trimmed)) return false
    if (/^esc\s*to\s*interrupt/i.test(trimmed)) return false
    if (/^\*\s*high\s*·/i.test(trimmed)) return false
    if (/\d+\s*skill\s*descriptions?\s*dropped/i.test(trimmed)) return false
    if (/\/doctor\s*for\s*details/i.test(trimmed)) return false
    // Claude Code 启动横幅行（Welcome back, Tips, What's new 等）
    if (/^(Welcome back|Tips for getting|Run \/init|What.s new|Internal fixes|API Usage Billing)/i.test(trimmed)) return false
    // 快捷键提示
    if (/^\d+\s*tokens?\s*·\s*thinking/i.test(trimmed)) return false
    // 纯 spinner 字符残留
    if (/^[✻✽✢✶\s]+$/.test(trimmed)) return false
    return true
  })

  // 重建输出：去重连续相同行（TUI 重绘常见现象）
  const deduped: string[] = []
  for (const line of filtered) {
    if (line !== deduped[deduped.length - 1]) {
      deduped.push(line)
    }
  }

  return deduped.join('\n').replace(/\n{4,}/g, '\n\n').trim()
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

  // 自动保存当前项目会话
  useEffect(() => {
    const key = currentProject
    if (!key) return
    const session = getSession(key).sessionRef
    if (!session) return
    session.messages = getSession(key).messages
    window.electronAPI.sessionSave({ ...session, messages: session.messages }).catch(() => {})
  }, [version, currentProject])

  // 监听 PTY 数据（全局监听，按 projectPath 分发）
  // 不过滤内容 — 全部进入聊天区，长消息由 ChatBubble 折叠
  useEffect(() => {
    console.log('[Chat] ptyOnData listener registered (multi-project)')
    const unsubData = window.electronAPI.ptyOnData((projectPath: string, data: string) => {
      const key = normPath(projectPath)
      const clean = cleanPtyOutput(data)
      console.log('[Chat] PTY rx:', data.length, 'bytes, proj:', key.slice(-30), '→', clean.slice(0, 60))

      updateSession(key, prev => {
        const logEntry = `[${new Date().toLocaleTimeString('zh-CN')}] raw:${data.length}B → ${clean.slice(0, 400)}`
        const newLogs = [...prev.rawLogs.slice(-99), logEntry]

        // 数据在流动 → 项目 PTY 已连接（修正可能 out-of-sync 的状态）
        const wasDisconnected = !prev.isConnected && !prev.isConnecting

        if (!clean.trim()) {
          return { ...prev, rawLogs: newLogs, lastDataAt: Date.now(), isConnected: prev.isConnected || wasDisconnected, isConnecting: false }
        }

        // 检测 ● (U+25CF) — Claude Code 实际回复的起始标记
        // 排除 spinner 动画的孤立 ●（后跟内容不足 4 字符的视为 TUI 噪音）
        const markerIdx = clean.indexOf('●')
        const isRealResponse = markerIdx !== -1 && clean.slice(markerIdx).trim().length > 3

        if (isRealResponse) {
          // 分割：● 之前是 TUI 过程噪音，● 之后是实际回复
          const before = clean.slice(0, markerIdx)
          const response = clean.slice(markerIdx)

          let msgs = [...prev.messages]
          const last = msgs[msgs.length - 1]

          if (before.trim()) {
            if (last && last.role === 'assistant' && !last.isResponse) {
              msgs = [...msgs.slice(0, -1), { ...last, content: last.content + before }]
            } else {
              msgs = [...msgs, {
                id: createId(), role: 'assistant' as const, content: before,
                timestamp: new Date().toISOString(),
              }]
            }
          }

          msgs = [...msgs, {
            id: createId(), role: 'assistant' as const, content: response,
            timestamp: new Date().toISOString(), isResponse: true,
          }]

          return { ...prev, rawLogs: newLogs, messages: msgs, lastDataAt: Date.now(), isConnected: true, isConnecting: false }
        }

        // 没有 marker — 追加到最后一个 assistant bubble
        const last = prev.messages[prev.messages.length - 1]
        if (last && last.role === 'assistant') {
          return {
            ...prev,
            rawLogs: newLogs,
            lastDataAt: Date.now(),
            isConnected: true, isConnecting: false,
            messages: [...prev.messages.slice(0, -1), { ...last, content: last.content + clean }],
          }
        }
        return {
          ...prev,
          rawLogs: newLogs,
          lastDataAt: Date.now(),
          isConnected: true, isConnecting: false,
          messages: [...prev.messages, {
            id: createId(),
            role: 'assistant' as const,
            content: clean,
            timestamp: new Date().toISOString(),
          }],
        }
      })
    })

    const unsubSpawned = window.electronAPI.ptyOnSpawned((projectPath: string, sessionId: string, pid: number) => {
      const key = normPath(projectPath)
      console.log('[Chat] PTY spawned (external), proj:', key.slice(-30), 'pid:', pid)
      // 如果 ChatContext 还没有该项目的会话，自动创建
      updateSession(key, prev => {
        if (prev.isConnected || prev.isConnecting) return prev // 已有会话，不覆盖
        const initialMsg = {
          id: createId(),
          role: 'system' as const,
          content: `Claude Code 终端已启动 (PID ${pid})`,
          timestamp: new Date().toISOString(),
        }
        return {
          ...prev,
          messages: [initialMsg],
          isConnected: false,
          isConnecting: true,
          lastDataAt: Date.now(),
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
          prev.sessionRef.messages = [...prev.messages]
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
