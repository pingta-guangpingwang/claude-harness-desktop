// HarnessAgent 聊天记录持久化 — 跨视图切换不丢失，跨重启持久化

export interface LogEntry {
  time: string
  type: 'user' | 'ai-text' | 'ai-tool' | 'ai-result' | 'ai-error' | 'ai-permission' | 'system'
  text: string
  toolName?: string
  fullContent?: string
}

let store: LogEntry[] = []
const listeners = new Set<() => void>()

export function getLogs(): LogEntry[] {
  return store
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null

function persistLogs() {
  if (_saveTimer) clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => {
    try {
      window.electronAPI?.harnessSaveLogs(store)
    } catch {}
  }, 2000)
}

export function addLog(entry: Omit<LogEntry, 'time'>): void {
  const line: LogEntry = { ...entry, time: new Date().toLocaleTimeString('zh-CN') }
  store = [...store.slice(-499), line]
  listeners.forEach(fn => fn())
  persistLogs()
}

/** 追加到最近一条 ai-text 日志（流式增量），没有则创建新条目 */
export function appendLastAiText(text: string): void {
  const last = store[store.length - 1]
  if (last?.type === 'ai-text') {
    store = [...store.slice(0, -1), { ...last, text: last.text + text }]
  } else {
    store = [...store, { time: new Date().toLocaleTimeString('zh-CN'), type: 'ai-text' as const, text }]
  }
  listeners.forEach(fn => fn())
  persistLogs()
}

export function clearLogs(): void {
  store = []
  listeners.forEach(fn => fn())
  persistLogs()
}

/** 从文件恢复日志（启动时调用） */
export function loadLogs(logs: LogEntry[]): void {
  store = logs.slice(-500)
  listeners.forEach(fn => fn())
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// ---- Agent 运行状态（供给 HorseFarm header 按钮使用）----

let agentRunning = false
const arListeners = new Set<() => void>()

export function getAgentRunning(): boolean {
  return agentRunning
}

export function setAgentRunning(v: boolean): void {
  agentRunning = v
  arListeners.forEach(fn => fn())
}

export function subscribeAgentRunning(fn: () => void): () => void {
  arListeners.add(fn)
  return () => { arListeners.delete(fn) }
}
