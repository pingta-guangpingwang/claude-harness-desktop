import { ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { db } from './database.js'
import { getTokenStore } from './tokenStore.js'

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
  lastDataAt: number
  isClaude: boolean  // 区分 Claude Code vs 普通 shell，决定是否等待 ❯ 就绪
}

/** 多项目并行 PTY 会话表：key = 规范化后的项目路径 */
const sessions: Map<string, PtySession> = new Map()
/** 持久化就绪状态：一旦检测到 ❯ 就设为 true，避免 waitForReady 错过已经出现过的提示符 */
const ptyReady = new Map<string, boolean>()
/** 实时 PTY 输出环形缓冲区：供 read_project_chat 读取当前终端的真实内容 */
const recentOutput = new Map<string, string[]>()
const MAX_RECENT_LINES = 200
function appendRecentOutput(key: string, data: string): void {
  let lines = recentOutput.get(key)
  if (!lines) { lines = []; recentOutput.set(key, lines) }
  // 去除 ANSI 后追加
  const clean = data.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '')
  const newLines = clean.split('\n')
  for (const l of newLines) {
    if (lines.length >= MAX_RECENT_LINES) lines.shift()
    lines.push(l)
  }
}
let mainWindow: BrowserWindow | null = null

// ---- 项目 AI Token 消耗追踪 ----

interface ProjectTokenAccumulator {
  peakTokens: number           // 此会话中见过的最大 token 数（Claude Code 按会话累计显示）
  lastRecorded: number         // 上次记录到 TokenStore 时的值
  sessionId: string
  projectName: string
}

const projectTokenAcc = new Map<string, ProjectTokenAccumulator>()

// ---- PTY 就绪检测：Claude Code 启动后需要等 ❯ 提示符出现才能安全写入 ----
// 未就绪时写入是大块文本（不像人工逐字输入），ConPTY 缓冲区溢出 → 0xC0000142 崩溃

interface ReadySignal {
  resolver: () => void
  timer: ReturnType<typeof setTimeout>
}

const readySignals = new Map<string, ReadySignal>()

function signalReady(key: string): void {
  const rs = readySignals.get(key)
  if (rs) {
    clearTimeout(rs.timer)
    rs.resolver()
    readySignals.delete(key)
  }
}

function waitForReady(key: string, timeoutMs: number = 15000): Promise<boolean> {
  if (ptyReady.has(key)) return Promise.resolve(true)
  const existing = readySignals.get(key)
  if (existing) {
    return new Promise<boolean>(resolve => {
      const orig = existing.resolver
      existing.resolver = () => { orig(); resolve(true) }
    })
  }
  return new Promise<boolean>(resolve => {
    const startedAt = Date.now()
    const session = sessions.get(key)
    const MAX_TOTAL_WAIT = 120000 // 最长等 2 分钟（API Key 对话框应答后 Claude Code 可能慢初始化）
    let dataArrived = false

    const tryResolve = (ready: boolean) => {
      const rs = readySignals.get(key)
      if (!rs) return // 已经 resolved
      if (ready) {
        clearTimeout(rs.timer)
        rs.resolver()
        readySignals.delete(key)
        return
      }
      // 未就绪：如果数据一直在流（Claude Code 初始化中），延长等待
      const elapsed = Date.now() - startedAt
      if (elapsed >= MAX_TOTAL_WAIT) {
        clearTimeout(rs.timer)
        readySignals.delete(key)
        console.log('[PTY] ⚠️ 等待就绪超时（已达最大 120s），放弃写入 —', key.slice(-40))
        resolve(false)
        return
      }
      // 最近 10s 内有数据 → 再等 15s
      const lastData = session?.lastDataAt || 0
      if (Date.now() - lastData < 10000) {
        console.log('[PTY] ⏳ Claude Code 仍在初始化，延长等待 —', key.slice(-40), `(${Math.round(elapsed/1000)}s/${MAX_TOTAL_WAIT/1000}s)`)
        dataArrived = true
        rs.timer = setTimeout(() => tryResolve(false), 15000)
        return
      }
      // 没数据到达过 → 进程可能死了，不等
      if (!dataArrived) {
        readySignals.delete(key)
        console.log('[PTY] ⚠️ 无数据到达，PTY 可能已死，放弃写入 —', key.slice(-40))
        resolve(false)
        return
      }
      // 数据停止流动超过 10s → 可能初始化完了但没检测到 ❯，最多再等 15s
      rs.timer = setTimeout(() => tryResolve(false), 15000)
    }

    const timer = setTimeout(() => tryResolve(false), timeoutMs)
    readySignals.set(key, { resolver: () => { clearTimeout(timer); resolve(true) }, timer })
  })
}

/** 从 PTY 数据流提取 token 用量。
 *  Claude Code 在思考/生成过程中会显示 "1.2K tokens · thinking" 等行。
 *  这些是累计会话用量，我们跟踪峰值（因并发任务可能让数字抖动）。 */
function extractTokenCount(data: string): number {
  let max = 0
  // 匹配: 可选前缀(✻ ✦ 等) + 数字[.数字][单位] + 空格 + token(s) + 可选后缀
  const re = /(?:^|\n)\s*(?:[✻✽✢✶✦⏳●]\s*)?([\d,]+(?:\.\d+)?)\s*(K|M|B)?\s*tokens?\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(data)) !== null) {
    let val = parseFloat(m[1].replace(/,/g, ''))
    const unit = (m[2] || '').toUpperCase()
    if (unit === 'K') val *= 1000
    else if (unit === 'M') val *= 1_000_000
    else if (unit === 'B') val *= 1_000_000_000
    if (val > max) max = val
  }
  return Math.round(max)
}

/** 将项目 AI 的增量 token 消耗写入 TokenStore */
function flushProjectTokens(key: string): void {
  const acc = projectTokenAcc.get(key)
  if (!acc) return
  const increment = acc.peakTokens - acc.lastRecorded
  if (increment > 0) {
    try {
      getTokenStore().record({
        projectPath: key,
        projectName: acc.projectName,
        model: 'claude-code (project AI)',
        promptTokens: Math.round(increment * 0.4),
        completionTokens: Math.round(increment * 0.6),
        totalTokens: increment,
        conversationId: acc.sessionId,
      })
      acc.lastRecorded = acc.peakTokens
    } catch { /* token 记录失败不阻塞 PTY */ }
  }
}

/** 处理 PTY 数据流中的 token 信息，更新累计器 */
function feedTokenTracker(projectPath: string, data: string, projectName?: string): void {
  const key = normPath(projectPath)
  const count = extractTokenCount(data)
  if (count === 0) return
  let acc = projectTokenAcc.get(key)
  if (!acc) {
    const session = sessions.get(key)
    acc = {
      peakTokens: 0,
      lastRecorded: 0,
      sessionId: session?.sessionId || 'unknown',
      projectName: projectName || key.split('\\').pop() || key,
    }
    projectTokenAcc.set(key, acc)
  }
  if (count > acc.peakTokens) {
    acc.peakTokens = count
  }
}

/** 获取会话表（供 harnessAgent 工具直接调用） */
export function getSessions(): Map<string, PtySession> {
  return sessions
}

/** 直接 spawn PTY（供 harnessAgent 工具调用，不走 IPC）。
 *  自动注入 --permission-mode acceptEdits，失败时自动重试。 */
export async function spawnPtySession(projectPath: string, command?: string, args?: string[]): Promise<{ success: boolean; pid?: number; sessionId?: string; message?: string }> {
  const key = normPath(projectPath)
  const existing = sessions.get(key)
  if (existing) {
    console.log('[PTY] 关闭已有会话:', existing.sessionId)
    existing.pty.kill()
    sessions.delete(key)
    ptyReady.delete(key)
    recentOutput.delete(key)
  }
  const rawCmd = command || resolveClaudePath()
  const rawArgs = args || []
  // 自动注入 --permission-mode acceptEdits：headless PTY 中自动接受编辑，避免弹计划确认框
  const isClaude = rawCmd.toLowerCase().includes('claude')
  const finalRawArgs = isClaude
    ? (() => {
        const a = [...rawArgs]
        if (!a.includes('--permission-mode') && !a.some(x => x.startsWith('--permission-mode='))) {
          a.push('--permission-mode', 'acceptEdits')
        }
        return a
      })()
    : rawArgs
  const { file, args: finalArgs } = wrapCommand(rawCmd, finalRawArgs)
  console.log('[PTY] 启动命令:', file, '参数:', finalArgs, '工作目录:', key)

  // 预检：快速验证二进制可运行（仅对 claude 路径）
  if (isClaude && !fs.existsSync(rawCmd) && !rawCmd.endsWith('.cmd') && !rawCmd.endsWith('.bat')) {
    console.error('[PTY] 二进制不存在:', rawCmd)
    return { success: false, message: `Claude Code 未找到: ${rawCmd}` }
  }

  return await spawnWithRetry(file, finalArgs, key, isClaude, 0)
}

/** 带重试的 spawn：首次失败等 2s 重试，第二次失败等 5s 最后尝试 */
async function spawnWithRetry(file: string, args: string[], key: string, isClaude: boolean, attempt: number): Promise<{ success: boolean; pid?: number; sessionId?: string; message?: string }> {
  try {
    // 读取 CHD 中配置的 API Key
    const apiEnv: Record<string, string> = {}
    let activeKeyInfo: any = null
    try {
      const config = await db.getConfig()
      const apiKeys = (config && config.apiKeys) ? config.apiKeys : []
      activeKeyInfo = apiKeys.find((k: any) => k.enabled && k.status !== 'exhausted' && k.status !== 'error')
      if (activeKeyInfo && activeKeyInfo.key) {
        apiEnv['ANTHROPIC_API_KEY'] = activeKeyInfo.key
        apiEnv['ANTHROPIC_BASE_URL'] = 'https://api.deepseek.com/anthropic'
        console.log('[PTY] 已注入 API Key:', activeKeyInfo.name || '(unnamed)')
      }
    } catch (e) { /* config read failed, proceed without key */ }

    // 🔑 将 API Key 写入项目 .claude/settings.json，避免 Claude Code 弹出确认对话框
    // 环境变量 ANTHROPIC_API_KEY 在新版本 Claude Code 中会触发 "Do you want to use this API key?" 交互式确认
    if (isClaude && activeKeyInfo?.key) {
      try {
        const claudeDir = path.join(key, '.claude')
        if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true })
        const settingsPath = path.join(claudeDir, 'settings.json')
        let settings: Record<string, any> = {}
        if (fs.existsSync(settingsPath)) {
          try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) } catch {}
        }
        // 写入 env 段，Claude Code 会从 settings.json 读取而不弹确认框
        if (!settings.env) settings.env = {}
        settings.env.ANTHROPIC_API_KEY = activeKeyInfo.key
        settings.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic'
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
        console.log('[PTY] 已写入 .claude/settings.json —', key.slice(-40))
      } catch (e) { /* settings write failed, still have env var + auto-answer as fallback */ }
    }

    const newPty = pty.spawn(file, args, {
      cwd: key,
      env: {
        ...process.env,
        ...apiEnv,
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
        COLORTERM: 'truecolor',
        // 减少 ConPTY 崩溃 + 减少交互式提示
        NODE_NO_WARNINGS: '1',
        NO_UPDATE_NOTIFIER: '1',
        CLAUDE_CODE_SIMPLE: '1', // 跳过 hooks、LSP、自动更新等交互
      },
      cols: 100, rows: 30,
    })
    const sessionId = createSessionId()
    const session: PtySession = { pty: newPty, sessionId, projectPath: key, lastDataAt: Date.now(), isClaude }
    sessions.set(key, session)
    console.log('[PTY] PID:', newPty.pid, '会话:', sessionId, '项目:', key, attempt > 0 ? `(重试#${attempt})` : '')

    // 快速失败检测：进程在 2.5s 内退出 → 重试
    let resolved = false
    let exitTimer: ReturnType<typeof setTimeout> | null = null

    newPty.onData((data: string) => {
      session.lastDataAt = Date.now()
      const stripped = data.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '')
      const joined = stripped.replace(/\n/g, ' ')

      // 🔑 自动应答 Claude Code 交互式对话框（headless PTY 无人操作）
      // API Key 确认: "Do you want to use this API key? 1. Yes ❯ 2. No"
      if (/Do you want to use this API key/i.test(joined) && /1\.\s*Yes/i.test(joined)) {
        console.log('[PTY] ⚡ 自动应答 API Key 对话框 → Yes —', key.slice(-40))
        newPty.write('1\r')
      }
      // 信任对话框: "Do you trust the files in this folder?"
      if (/Do you (trust|want to load)/i.test(joined) && /(Yes|Trust|Continue|回车)/i.test(joined)) {
        console.log('[PTY] ⚡ 自动应答信任对话框 → Yes —', key.slice(-40))
        newPty.write('\r')
      }
      // 更新确认: "A new version .* is available" → 跳过
      if (/A new version.*is available/i.test(joined) && /(Update|Skip|Later|以后)/i.test(joined)) {
        console.log('[PTY] ⚡ 自动应答更新提示 → Skip —', key.slice(-40))
        newPty.write('\x1b') // ESC 关闭
      }

      // 扫描 ❯ 就绪信号 — 排除菜单里的 ❯（如 "❯ 2. No (recommended)"）
      if (!ptyReady.has(key)) {
        const lines = stripped.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          // ❯ 单独一行 = 就绪；❯ 后跟非数字非点字符 = 正在输入中（也算就绪）
          // 排除: ❯ 后跟数字+点（菜单选项）
          if (trimmed === '❯' || /^❯\s*$/.test(trimmed)) {
            console.log('[PTY] Claude Code 就绪 —', key.slice(-40))
            ptyReady.set(key, true)
            signalReady(key)
            break
          }
          if (/^❯\s+[^0-9]/.test(trimmed) && !/^❯\s+\d+\./.test(trimmed)) {
            console.log('[PTY] Claude Code 就绪（输入中）—', key.slice(-40))
            ptyReady.set(key, true)
            signalReady(key)
            break
          }
        }
      }
      if (readySignals.has(key) && ptyReady.has(key)) {
        signalReady(key)
      }
      feedTokenTracker(key, data)
      appendRecentOutput(key, data)
      sendToRenderer('pty:data', key, data)
      feedCollector(key, data)
    })

    newPty.onExit(({ exitCode }: { exitCode: number }) => {
      const exitInfo = exitCode === 0 ? '正常退出' : exitCode === null ? '被信号杀死' : `退出码 ${exitCode}`
      console.log(`[PTY] 进程退出 — ${exitInfo} — 项目:`, key.slice(-40))
      if (exitTimer) clearTimeout(exitTimer)
      flushProjectTokens(key)
      projectTokenAcc.delete(key)
      ptyReady.delete(key)
      recentOutput.delete(key)

      if (!resolved && attempt < 2) {
        // 快速失败 → 重试
        const delay = attempt === 0 ? 2000 : 5000
        console.log(`[PTY] ${delay}ms 后重试 (attempt ${attempt + 1})`)
        resolved = true
        sessions.delete(key)
        setTimeout(async () => {
          const result = await spawnWithRetry(file, args, key, isClaude, attempt + 1)
          if (result.success) {
            sendToRenderer('pty:spawned', key, result.sessionId!, result.pid!)
          } else {
            sendToRenderer('pty:exit', key, exitCode)
          }
        }, delay)
      } else {
        resolved = true
        sessions.delete(key)
        sendToRenderer('pty:exit', key, exitCode)
      }
    })

    // 3s 后未退出 → 启动成功
    exitTimer = setTimeout(() => {
      exitTimer = null
      if (!resolved) {
        resolved = true
        sendToRenderer('pty:spawned', key, sessionId, newPty.pid)
      }
    }, 2500)

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
  projectName?: string,
): Promise<{ success: boolean; output: string }> {
  const key = normPath(projectPath)
  const session = sessions.get(key)
  if (!session) {
    return Promise.resolve({ success: false, output: '无活跃的 PTY 会话' })
  }

  // 更新 token 追踪器中的项目名
  if (projectName) {
    const acc = projectTokenAcc.get(key)
    if (acc) acc.projectName = projectName
  }

  // 如果已有收集器在等待（上个任务未完成），先 resolve 它
  const existing = activeCollectors.get(key)
  if (existing) {
    if (existing.idleTimer) clearTimeout(existing.idleTimer)
    if (existing.hardTimer) clearTimeout(existing.hardTimer)
    flushProjectTokens(key)
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
        flushProjectTokens(key)
        finish()
        resolve({ success: true, output: cleanAgentOutput(collector.buffer) || '(无回复内容)' })
      }, IDLE_MS)
    }

    // 硬超时
    collector.hardTimer = setTimeout(() => {
      flushProjectTokens(key)
      finish()
      resolve({ success: true, output: cleanAgentOutput(collector.buffer) || '(超时 — 无回复)' })
    }, timeoutMs)

    activeCollectors.set(key, collector)
    const doSend = async () => {
      // Claude Code 需要等待 ❯ 就绪，避免在初始化期间写入大块文本导致 ConPTY 崩溃
      if (session.isClaude) {
        const ready = await waitForReady(key)
        if (!ready) {
          finish()
          resolve({ success: false, output: 'Claude Code 未能在 15s 内就绪，PTY 可能未完全初始化。请检查项目路径和 Claude Code 安装。' })
          return
        }
      }
      // 分两次写入：先写任务文本，再单独发 Enter。
      // Claude Code TUI 在 raw 模式下，\r 和文本一起 blast 会当作普通字符而非提交键
      session.pty.write(task)
      await new Promise(r => setTimeout(r, 150))
      session.pty.write('\r')
      // 写入后才启动空闲计时
      resetIdle()
      console.log('[PTY] sendAndCollect →', key.slice(-40), 'task:', task.slice(0, 80))
    }
    doSend()
  })
}

/** 供 pty.onData 调用的收集器钩子 */
export function feedCollector(projectPath: string, data: string): void {
  feedTokenTracker(projectPath, data)
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
    // 去除 OSC 序列 (ESC ] ... BEL/ST)
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // 去除所有 CSI 序列 (ESC [ ... final-byte)
    // 包括: 光标移动(CUU/CUD/CUF/CUB/...), 擦除(ED/EL), DEC 私有模式(?h/?l), XTerm 扩展(>m/<u), SGR(m)
    .replace(/\x1b\[[ -/]*[@-~]/g, '')
    // 去除 ESC 前缀的简单序列 (ESC >, ESC =, ESC c, etc)
    .replace(/\x1b[#-Z\\\]^_`a-z~|]/g, '')
    .replace(/\x1b[>=]/g, '')
    // 去除残留的独立 ESC 字符
    .replace(/\x1b/g, '')
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
      ptyReady.delete(key)
      return { success: true }
    }
    return { success: false, message: '无活跃的 PTY 会话' }
  }
  for (const [k, s] of sessions) {
    s.pty.kill()
    sessions.delete(k)
    ptyReady.delete(k)
  }
  return { success: true }
}

/** 获取最近 PTY 输出（供 harnessAgent read_project_chat 工具读取实时终端内容） */
export function getRecentPtyOutput(projectPath: string, maxLines: number = 100): string {
  const lines = recentOutput.get(normPath(projectPath))
  if (!lines || lines.length === 0) return ''
  return lines.slice(-maxLines).join('\n')
}

/** 直接查询 PTY 状态（供 harnessAgent 工具调用，不走 IPC） */
export function getPtyStatus(projectPath: string): { connected: boolean; sessionId: string | null; pid: number | null; lastDataAt: number } {
  const session = sessions.get(normPath(projectPath))
  return {
    connected: !!session,
    sessionId: session?.sessionId ?? null,
    pid: session?.pty.pid ?? null,
    lastDataAt: session?.lastDataAt ?? 0,
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

/** 查找 claude 命令的完整路径。统一通过 cmd.exe /c 启动，避免 node-pty ConPTY 直接 spawn .exe 时的路径解析问题（尤其在 VSCode 占用项目时） */
function resolveClaudePath(): string {
  // 1. 项目自带 nodejs 目录 (bootstrap 安装的)
  const bundledNodeDir = path.join(__dirname, '..', '..', 'nodejs')
  const bundledExe = path.join(bundledNodeDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  if (fs.existsSync(bundledExe)) return bundledExe
  const bundledCmd = path.join(bundledNodeDir, 'claude.cmd')
  if (fs.existsSync(bundledCmd)) return bundledCmd

  // 2. 全局 npm 目录
  const npmPrefix = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'npm')
    : path.join(process.env.HOME || 'C:\\Users\\admin', 'AppData', 'Roaming', 'npm')

  const claudeExe = path.join(npmPrefix, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  if (fs.existsSync(claudeExe)) return claudeExe

  const claudeCmd = path.join(npmPrefix, 'claude.cmd')
  if (fs.existsSync(claudeCmd)) return claudeCmd

  const claudeJs = path.join(npmPrefix, 'claude')
  if (fs.existsSync(claudeJs)) return claudeJs

  // 3. 最后尝试 PATH 里的 claude
  return 'claude'
}

/** 构建 spawn 命令。.exe 直接 spawn（避免 cmd.exe 双进程导致 ConPTY 崩溃），.cmd/.bat/纯名 走 cmd.exe /c */
function wrapCommand(cmd: string, args: string[]): { file: string; args: string[] } {
  // .exe 且路径存在 → 直接 spawn，避免 ConPTY 双进程（cmd.exe 退出时 ConPTY 可能丢失进程树）
  if (cmd.toLowerCase().endsWith('.exe') && fs.existsSync(cmd)) {
    return { file: cmd, args }
  }
  // .cmd / .bat / 纯名（如 'claude'）→ 走 cmd.exe /c
  return { file: 'cmd.exe', args: ['/c', cmd, ...args] }
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
