import { ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

// node-pty v1.1 无 TypeScript 类型声明
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require('node-pty') as {
  spawn(file: string, args: string[], options: PtyOptions): PtyProcess
}

interface PtyOptions {
  cwd?: string
  env?: Record<string, string>
  cols?: number
  rows?: number
  name?: string
}

interface PtyProcess {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void
}

interface PtySession {
  pty: PtyProcess
  sessionId: string
  projectPath: string
}

/** 多项目并行 PTY 会话表：key = 规范化后的项目路径 */
const sessions: Map<string, PtySession> = new Map()
let mainWindow: BrowserWindow | null = null

/** 获取会话表（供 harnessAgent 工具直接调用） */
export function getSessions(): Map<string, PtySession> {
  return sessions
}

/** 直接 spawn PTY（供 harnessAgent 工具调用，不走 IPC） */
export async function spawnPtySession(projectPath: string, command?: string, args?: string[]): Promise<{ success: boolean; pid?: number; sessionId?: string; message?: string }> {
  const key = normPath(projectPath)
  const existing = sessions.get(key)
  if (existing) {
    console.log('[PTY] 关闭已有会话:', existing.sessionId)
    existing.pty.kill()
    sessions.delete(key)
  }
  const rawCmd = command || resolveClaudePath()
  const rawArgs = args || []
  const { file, args: finalArgs } = wrapCommand(rawCmd, rawArgs)
  console.log('[PTY] 启动命令:', file, '参数:', finalArgs, '工作目录:', key)
  try {
    const newPty = pty.spawn(file, finalArgs, {
      cwd: key,
      env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1', COLORTERM: 'truecolor' },
      cols: 120, rows: 40,
    })
    const sessionId = createSessionId()
    const session: PtySession = { pty: newPty, sessionId, projectPath: key }
    sessions.set(key, session)
    console.log('[PTY] PID:', newPty.pid, '会话:', sessionId, '项目:', key)
    newPty.onData((data: string) => {
      sendToRenderer('pty:data', key, data)
      feedCollector(key, data)
    })
    newPty.onExit(({ exitCode }: { exitCode: number }) => {
      console.log('[PTY] 进程退出, 退出码:', exitCode, 'proj:', key.slice(-30))
      sendToRenderer('pty:exit', key, exitCode)
      sessions.delete(key)
    })
    // 通知渲染进程：PTY 已启动（供 ChatContext 自动创建会话状态）
    sendToRenderer('pty:spawned', key, sessionId, newPty.pid)
    // 自动应答 Claude Code 信任确认 (y=Yes)
    setTimeout(() => {
      if (sessions.get(key)) {
        newPty.write('y\r')
        console.log('[PTY] 自动发送信任确认: y\\r →', key.slice(-30))
      }
    }, 3000)
    return { success: true, pid: newPty.pid, sessionId }
  } catch (err) {
    console.error('[PTY] 启动失败:', err)
    return { success: false, message: String(err) }
  }
}

/** 直接 write 到 PTY（供 harnessAgent 工具调用，不走 IPC） */
export function writeToPty(projectPath: string, data: string): { success: boolean; message?: string } {
  const session = sessions.get(normPath(projectPath))
  if (session) {
    session.pty.write(data)
    return { success: true }
  }
  return { success: false, message: '无活跃的 PTY 会话' }
}

// ---- 回复收集器：支持 task_project 等待项目 AI 响应 ----

interface PtyCollector {
  buffer: string
  idleTimer: NodeJS.Timeout | null
  hardTimer: NodeJS.Timeout | null
  resolve: (result: { success: boolean; output: string }) => void
}

const activeCollectors = new Map<string, PtyCollector>()

/** 向 PTY 发送命令并收集响应（供 harnessAgent 工具使用）。
 *  等待项目 AI 空闲 8s 后返回，最长等待 timeoutMs。 */
export function sendAndCollect(
  projectPath: string,
  task: string,
  timeoutMs: number = 90000,
): Promise<{ success: boolean; output: string }> {
  const key = normPath(projectPath)
  const session = sessions.get(key)
  if (!session) {
    return Promise.resolve({ success: false, output: '无活跃的 PTY 会话' })
  }

  // 如果已有收集器在等待（上个任务未完成），先 resolve 它
  const existing = activeCollectors.get(key)
  if (existing) {
    if (existing.idleTimer) clearTimeout(existing.idleTimer)
    if (existing.hardTimer) clearTimeout(existing.hardTimer)
    existing.resolve({ success: true, output: cleanAgentOutput(existing.buffer) || '(被新任务中断)' })
    activeCollectors.delete(key)
  }

  const IDLE_MS = 8000 // 8 秒无新数据 = 项目 AI 回复完毕

  return new Promise(resolve => {
    const collector: PtyCollector = {
      buffer: '',
      idleTimer: null,
      hardTimer: null,
      resolve,
    }

    const finish = () => {
      if (collector.idleTimer) clearTimeout(collector.idleTimer)
      if (collector.hardTimer) clearTimeout(collector.hardTimer)
      activeCollectors.delete(key)
    }

    // 空闲定时器：8s 无数据 → 完成
    const resetIdle = () => {
      if (collector.idleTimer) clearTimeout(collector.idleTimer)
      collector.idleTimer = setTimeout(() => {
        finish()
        resolve({ success: true, output: cleanAgentOutput(collector.buffer) || '(无回复内容)' })
      }, IDLE_MS)
    }

    // 硬超时
    collector.hardTimer = setTimeout(() => {
      finish()
      resolve({ success: true, output: cleanAgentOutput(collector.buffer) || '(超时 — 无回复)' })
    }, timeoutMs)

    activeCollectors.set(key, collector)

    // 发送任务
    session.pty.write(task + '\r')

    // 启动空闲计时（在任务写入后启动）
    resetIdle()
    console.log('[PTY] sendAndCollect →', key.slice(-40), 'task:', task.slice(0, 80))
  })
}

/** 供 pty.onData 调用的收集器钩子 */
export function feedCollector(projectPath: string, data: string): void {
  const collector = activeCollectors.get(normPath(projectPath))
  if (!collector) return
  collector.buffer += data
  // 重置空闲计时
  if (collector.idleTimer) clearTimeout(collector.idleTimer)
  collector.idleTimer = setTimeout(() => {
    if (collector.hardTimer) clearTimeout(collector.hardTimer)
    activeCollectors.delete(normPath(projectPath))
    collector.resolve({ success: true, output: cleanAgentOutput(collector.buffer) || '(无回复内容)' })
  }, 8000)
}

/** 清理 PTY 输出供驾驭智能体阅读：去除 ANSI/TUI 噪音，提取有意义内容 */
function cleanAgentOutput(raw: string): string {
  let out = raw
    // 去除 OSC 序列
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // 去除光标移动/擦除 CSI
    .replace(/\x1b\[[0-9;]*[ABCDEFGHJKSTfnsu]/g, '')
    .replace(/\x1b\[\?[0-9;]*[hl]/g, '')
    .replace(/\x1b[>=]/g, '')
    // 保留 SGR (颜色)，但去除多余的复位
    .replace(/\x1b\[0?m/g, '')
    // CR/LF 处理
    .replace(/\r\n/g, '\n')
    .replace(/[^\n]*\r(?!\n)/g, '')

  // 逐行过滤 TUI 噪音，但保留 ● 响应内容
  const lines = out.split('\n')
  const filtered = lines.filter(line => {
    const plain = line.replace(/\x1b\[[0-9;]*m/g, '').trim()
    if (!plain) return false
    if (/^[·•✻✽✢✶⏳]\s*(Scurrying|Simmering|Brewed|Crunched|thinking|Loading)/i.test(plain)) return false
    if (/^[-━─=–—]{8,}$/.test(plain)) return false
    if (/^\?\s*for\s*shortcuts/i.test(plain)) return false
    if (/^esc\s*to\s*interrupt/i.test(plain)) return false
    if (/^\*\s*high\s*·/i.test(plain)) return false
    if (/\d+\s*skill\s*descriptions?\s*dropped/i.test(plain)) return false
    if (/\/doctor\s*for\s*details/i.test(plain)) return false
    if (/^(Welcome back|Tips for getting|Run \/init|What.s new|Internal fixes|API Usage Billing)/i.test(plain)) return false
    if (/^\d+\s*tokens?\s*·\s*thinking/i.test(plain)) return false
    if (/^[✻✽✢✶\s]+$/.test(plain)) return false
    return true
  })

  // 去重连续相同行
  const deduped: string[] = []
  for (const line of filtered) {
    if (line !== deduped[deduped.length - 1]) deduped.push(line)
  }

  let result = deduped.join('\n').replace(/\n{4,}/g, '\n\n').trim()

  // 提取 ● 标记后的核心回复（如果存在）
  const markerIdx = result.indexOf('●')
  if (markerIdx !== -1) {
    // 保留 ● 之前的内容作为上下文（最多 500 字符），主要返回 ● 之后的
    const before = result.slice(Math.max(0, markerIdx - 500), markerIdx)
    const after = result.slice(markerIdx)
    if (before.trim()) {
      result = `[上下文]\n${before.trim()}\n\n[回复]\n${after.trim()}`
    } else {
      result = after.trim()
    }
  }

  // 限制长度，避免塞爆 harness agent context
  if (result.length > 5000) {
    result = result.slice(0, 5000) + '\n\n... (内容过长，已截断)'
  }

  return result
}

/** 直接 kill PTY（供 harnessAgent 工具调用，不走 IPC） */
export function killPtySession(projectPath?: string): { success: boolean; message?: string } {
  if (projectPath) {
    const key = normPath(projectPath)
    const session = sessions.get(key)
    if (session) {
      session.pty.kill()
      sessions.delete(key)
      return { success: true }
    }
    return { success: false, message: '无活跃的 PTY 会话' }
  }
  for (const [k, s] of sessions) {
    s.pty.kill()
    sessions.delete(k)
  }
  return { success: true }
}

/** 直接查询 PTY 状态（供 harnessAgent 工具调用，不走 IPC） */
export function getPtyStatus(projectPath: string): { connected: boolean; sessionId: string | null; pid: number | null } {
  const session = sessions.get(normPath(projectPath))
  return {
    connected: !!session,
    sessionId: session?.sessionId ?? null,
    pid: session?.pty.pid ?? null,
  }
}

/** 路径规范化 — 两端必须一致：反斜杠、去尾斜杠、盘符大写 */
function normPath(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').trim()
    .replace(/^([a-z]):/i, (_, d) => d.toUpperCase() + ':')
}

function createSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** 查找 claude 命令的完整路径（优先找 .exe，node-pty 不能直接运行 .cmd 批处理） */
function resolveClaudePath(): string {
  const npmPrefix = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'npm')
    : path.join(process.env.HOME || 'C:\\Users\\admin', 'AppData', 'Roaming', 'npm')

  // 优先: claude.exe 本体 (node-pty 可直接运行)
  const claudeExe = path.join(npmPrefix, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  if (fs.existsSync(claudeExe)) return claudeExe

  // 回退: claude.cmd 批处理包装器 (需通过 cmd.exe /c 运行)
  const claudeCmd = path.join(npmPrefix, 'claude.cmd')
  if (fs.existsSync(claudeCmd)) return claudeCmd

  const claudeJs = path.join(npmPrefix, 'claude')
  if (fs.existsSync(claudeJs)) return claudeJs

  return 'claude'
}

/** 如果命令是 .cmd 批处理，用 cmd.exe /c 包装 */
function wrapCommand(cmd: string, args: string[]): { file: string; args: string[] } {
  if (cmd.endsWith('.cmd') || cmd.endsWith('.bat')) {
    return { file: 'cmd.exe', args: ['/c', cmd, ...args] }
  }
  return { file: cmd, args }
}

function sendToRenderer(channel: string, projectPath: string, ...args: unknown[]) {
  console.log(`[PTY] ${channel} → renderer, proj:`, projectPath, 'wc ok:', !!mainWindow?.webContents)
  mainWindow?.webContents.send(channel, projectPath, ...args)
}

export function registerPtyIpc(window: BrowserWindow) {
  mainWindow = window

  ipcMain.handle('pty:spawn', async (_event, projectPath: string, command?: string, args?: string[]) => {
    return spawnPtySession(projectPath, command, args)
  })

  ipcMain.handle('pty:write', async (_event, projectPath: string, data: string) => {
    return writeToPty(projectPath, data)
  })

  ipcMain.handle('pty:resize', async (_event, projectPath: string, cols: number, rows: number) => {
    const session = sessions.get(normPath(projectPath))
    if (session) {
      session.pty.resize(cols, rows)
      return { success: true }
    }
    return { success: false, message: '无活跃的 PTY 会话' }
  })

  ipcMain.handle('pty:kill', async (_event, projectPath?: string) => {
    return killPtySession(projectPath)
  })

  ipcMain.handle('pty:status', async (_event, projectPath: string) => {
    return getPtyStatus(projectPath)
  })
}
