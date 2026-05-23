import { ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { db } from './database.js'
import { getTokenStore } from './tokenStore.js'
import { chatMessages } from './sessionManager.js'

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
/** 自动应答去重：记录每个 session 最后一次应答时间，防止跨 data chunk 重复应答 */
const autoReplyTimes = new Map<string, number>()
/** 实时 PTY 输出环形缓冲区：供 read_project_chat 读取当前终端的真实内容 */
const recentOutput = new Map<string, string[]>()
/** 原始 PTY 输出缓冲区：仅 ANSI 清洗 + 按行分割，不做 \\r 智能处理。
 *  供 getRecentPtyOutput 使用，确保对话框/选项等可见文本绝不丢失。 */
const rawRecentOutput = new Map<string, string[]>()
/** 可读缓冲区：仅 ANSI 剥离 + 按 \\n 分段，不进行任何文本过滤。
 *  这是供 Agent 查看的"跟 Chat UI 看到的差不多"的原始输出。
 *  与 cleanPtyChunk 不同：不丢分隔线、不丢 TUI 提示、不丢 spinner 文本。 */
const readableBuffer = new Map<string, string[]>()
const MAX_RECENT_LINES = 2000

/** Claude Code 思考阶段关键词 → 对应状态文本（移植自 ChatContext.tsx） */
const THINKING_PATTERNS: [RegExp, string][] = [
  [/scurry/i, 'Scurrying...'],
  [/simmer/i, 'Simmering...'],
  [/brew/i, 'Brewed...'],
  [/crunch/i, 'Crunched...'],
  [/wibbl/i, 'Wibbling...'],
  [/boogie/i, 'Boogieing...'],
  [/frost/i, 'Frosting...'],
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
  [/julienn/i, 'Julienning...'],
  [/ferment/i, 'Fermenting...'],
  [/bootstrap/i, 'Bootstrapping...'],
  [/warp/i, 'Warping...'],
  [/stir/i, 'Stirring...'],
  [/noodl/i, 'Noodling...'],
  [/mull/i, 'Mulling...'],
  [/ponder/i, 'Pondering...'],
  [/mus/i, 'Musing...'],
  [/dwell/i, 'Dwelling...'],
  [/stew/i, 'Stewing...'],
  [/brood/i, 'Brooding...'],
  [/ruminat/i, 'Ruminating...'],
  [/perk/i, 'Perking...'],
  [/laz/i, 'Lazing...'],
  [/infus/i, 'Infusing...'],
  [/sip/i, 'Sipping...'],
  [/craft/i, 'Crafting...'],
  [/decipher/i, 'Deciphering...'],
  [/spelunk/i, 'Spelunking...'],
  [/architect/i, 'Architecting...'],
  [/actualiz/i, 'Actualizing...'],
  [/dilly-dally/i, 'Dilly-dallying...'],
  [/sauté/i, 'Sautéed...'],
  [/temper/i, 'Tempering...'],
  [/putter/i, 'Puttering...'],
  [/churn/i, 'Churned...'],
]

/** 聚合后的项目消息存储：模拟渲染进程 updateSession 的 ● 聚合逻辑 */
interface ProjectMessages {
  thinkingStatus: string | null
  chatter: string
  responses: string[]
  dialogs: string[]
  lastDataAt: number
}

const messageStores = new Map<string, ProjectMessages>()
const MAX_RESPONSES = 50
const MAX_CHATTER = 2000
const MAX_DIALOGS = 20

function emptyMessages(): ProjectMessages {
  return { thinkingStatus: null, chatter: '', responses: [], dialogs: [], lastDataAt: 0 }
}

/** 从一段文本里提取 Claude Code 思考状态（移植自 ChatContext.tsx）。
 *  关键增强：即使没有 spinner 前缀，也能识别 "almost done" 等状态残片。 */
function extractThinkingStatus(text: string): string | null {
  const stripped = text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/[\r\n]/g, ' ')
    .replace(/[▐▌▛▜▟▙▘▝▀▄█▊▎▌▏▍▋│├┤┼╺╍┄┅┈┉]/g, '')
    .trim()
  if (!stripped) return null
  // 检测 spinner 字符 + 状态词（含 Claude Code v2 新 spinner ● 🧠）
  if (/[⏳✻✽✢✶✹✺✼✾·•●🧠]/.test(stripped)) {
    for (const [re, label] of THINKING_PATTERNS) {
      if (re.test(stripped)) return label
    }
    return 'Working...'
  }
  // 纯 spinner / 进度条类内容
  if (/^[⏳✻✽✢✶✹✺✼✾·•\s▐▌▛▜▟▙▘▝▀▄█▊▎▌▏▍▋│├┤┼╺╍┄┅┈┉]+$/.test(stripped)) return 'Working...'
  // 检测含 orchestrate/almost done 等非 spinner 状态文本（关键：捕获残片）
  for (const [re, label] of THINKING_PATTERNS) {
    if (re.test(stripped)) return label
  }
  return null
}

/** 清洗 PTY 数据块：剥离 ANSI + 过滤 TUI 噪声。
 *  移植自 ChatContext.tsx 的 cleanPtyOutput（渲染进程验证过的逻辑）。
 *  返回清洗后的行数组（可能为空）。 */
function cleanPtyChunk(text: string): string[] {
  let out = text
    // OSC 序列
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // 全量 CSI 序列
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b[>=]/g, '')
    // CR 行为
    .replace(/\r\n/g, '\n')
    .replace(/[^\n]*\r(?!\n)/g, '')
    // TUI 框线 → ASCII
    .replace(/[╭╰╮╯]/g, '+')
    .replace(/[─━]/g, '-')
    .replace(/[│┃]/g, '|')
    .replace(/[▐▌▛▜▟▙▘▝▀▄█▊▎▌▏▍▋│├┤┼╺╍┄┅┈┉]/g, '')
    // 残余 OSC
    .replace(/\x1b\][^\x1b]*/g, '')

  // 逐行过滤
  const filtered: string[] = []
  for (const line of out.split('\n')) {
    const t = line.replace(/\x1b\[[0-9;]*m/g, '').trim()
    if (!t) continue
    // spinner + 状态动词（● = Claude Code v2 新 spinner, 🧠 = 思考状态）
    if (/^[⏳✻✽✢✶✹✺✼✾·•*●🧠]\s*(Scurrying|Simmering|Brewed|Crunched|Wibbling|Boogieing|Orchestrat|Dilly-dallying|Sautéed|Tempering|Puttering|Churned|Frosting|thinking|Loading|Working|Doing|Crafting|Deciphering|Spelunking|Architecting|Actualizing|almost done)/i.test(t)) continue
    // 分隔线
    if (/^[-━─=–—]{6,}$/.test(t)) continue
    // 快捷提示/横幅
    if (/^\?\s*for\s*shortcuts/i.test(t)) continue
    if (/^esc\s*to\s*interrupt/i.test(t)) continue
    if (/^\*\s*high\s*·/i.test(t)) continue
    if (/\d+\s*skill\s*descriptions?\s*dropped/i.test(t)) continue
    if (/\/doctor\s*for\s*details/i.test(t)) continue
    if (/^(Welcome back|Tips for getting|Run \/init|What.s new|Internal fixes|API Usage Billing)/i.test(t)) continue
    if (/^\d+\s*tokens?\s*·\s*thinking/i.test(t)) continue
    // TUI footer
    if (/Tab to (amend|complete)/i.test(t)) continue
    if (/ctrl\+[eg] to (explain|edit)/i.test(t)) continue
    if (/shift\+tab to cycle/i.test(t)) continue
    if (/Press up to edit/i.test(t)) continue
    if (/accept\s*edits?\s*(on|off)/i.test(t)) continue
    // Tip / ⎿
    if (/⎿\s*Tip:/i.test(t)) continue
    if (/^\s*⎿/i.test(t)) continue
    // orchestrating 进度
    if (/[✻✽✢✶*]\s*Orchestrat/i.test(t)) continue
    // Searched/Reading 状态
    if (/^(Searched for|Reading)\s*\d/i.test(t)) continue
    // 纯 spinner
    if (/^[⏳✻✽✢✶✹✺✼✾·•*\s]+$/.test(t)) continue
    // 1-2 字符残片
    if (/^[a-zA-Z0-9]{1,2}$/.test(t)) continue
    // Resume / 会话结束
    if (/^Resume this session with:/i.test(t)) continue
    if (/Claude Code 会话已结束/i.test(t)) continue
    // high·/effort
    if (/^●\s*high\s*·\s*\/effort/i.test(t)) continue
    // 纯 TUI 框线
    if (/^[+|\-]{3,}\s*$/i.test(t) && t.length < 60) continue
    // Claude Code v2 状态栏残片
    if (/^(acceptedits|edits)\s*(on|off)/i.test(t)) continue
    if (/esc\s*to\s*interrupt/i.test(t)) continue
    if (/↓\s*to\s*manage/i.test(t)) continue
    if (/Running in the background/i.test(t)) continue
    if (/ctrl\+[obcr]\s*(to|for)/i.test(t)) continue
    // token/时间 状态行
    if (/[↑↓]\s*[\d.]+[km]?\s*tokens?/i.test(t)) continue
    if (/thought\s*for\s*\d+s/i.test(t)) continue
    if (/timeout\s*\d+m?\)/i.test(t)) continue
    // 🧠 状态行（剩余）
    if (/^🧠\s*(Working|Almost done|Done)/i.test(t)) continue
    // ● spinner 独立行
    if (/^●\s*\w+…/i.test(t) && t.length < 40) continue
    filtered.push(line)
  }

  // 去重连续相同行
  const deduped: string[] = []
  for (const line of filtered) {
    if (line !== deduped[deduped.length - 1]) deduped.push(line)
  }
  return deduped
}

/** 仅剥离 ANSI 转义序列 + OSC，不做任何文本过滤。供 readableBuffer 使用。 */
function stripAnsiOnly(text: string): string[] {
  return text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[>=]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
}

function appendRawOutput(key: string, data: string): void {
  // 1. 保持 rawRecentOutput 缓冲区（供 getPtyErrorSnapshot 原始诊断用）
  let rawLines = rawRecentOutput.get(key)
  if (!rawLines) { rawLines = []; rawRecentOutput.set(key, rawLines) }
  const cleaned = cleanPtyChunk(data)
  for (const l of cleaned) {
    if (rawLines.length >= MAX_RECENT_LINES) rawLines.shift()
    rawLines.push(l)
  }

  // 1b. 保持 readableBuffer（仅 ANSI 剥离，不做文本过滤 — 给 Agent 看的）
  let readable = readableBuffer.get(key)
  if (!readable) { readable = []; readableBuffer.set(key, readable) }
  for (const l of stripAnsiOnly(data)) {
    if (readable.length >= MAX_RECENT_LINES) readable.shift()
    readable.push(l)
  }

  // 2. 聚合消息（模拟渲染进程 updateSession 的 ● 聚合逻辑）
  let msgs = messageStores.get(key)
  if (!msgs) { msgs = emptyMessages(); messageStores.set(key, msgs) }
  msgs.lastDataAt = Date.now()

  for (const line of cleaned) {
    const t = line.replace(/\x1b\[[0-9;]*m/g, '').trim()
    if (!t) continue

    // 2a. 对话框/选项菜单检测（最高优先 — 绝不抑制）
    if (/Do ?you ?want ?to ?proceed/i.test(t) || /Doyouwanttoproceed/i.test(t) ||
        /Use this API/i.test(t) || /Quick safety check/i.test(t) ||
        /trust this folder/i.test(t) || /Auto-update failed/i.test(t) ||
        /This command requires approval/i.test(t) ||
        /A new version.*is available/i.test(t) || /update available/i.test(t)) {
      msgs.dialogs.push(t)
      if (msgs.dialogs.length > MAX_DIALOGS) msgs.dialogs.shift()
      continue
    }
    if (/^❯\s+\d+\./.test(t)) {
      msgs.dialogs.push(t)
      if (msgs.dialogs.length > MAX_DIALOGS) msgs.dialogs.shift()
      continue
    }
    if (/^\s+\d+\.\s/.test(t) && /Yes|No|Proceed|Continue|Trust|Skip|Update|Later/i.test(t)) {
      msgs.dialogs.push(t)
      if (msgs.dialogs.length > MAX_DIALOGS) msgs.dialogs.shift()
      continue
    }

    // 2b. 思考状态检测（提取状态文本 → 更新单条气泡，不累积）
    const thinkStatus = extractThinkingStatus(t)
    if (thinkStatus) {
      msgs.thinkingStatus = thinkStatus
      continue
    }

    // 2c. ● 标记检测 → 真正的 AI 回复
    const markerIdx = t.indexOf('●')
    if (markerIdx !== -1 && t.slice(markerIdx).trim().length > 3) {
      const before = t.slice(0, markerIdx).trim()
      const response = t.slice(markerIdx)
      // ● 之前的过渡内容合并到 chatter
      if (before) {
        msgs.chatter += (msgs.chatter ? '\n' : '') + before
        if (msgs.chatter.length > MAX_CHATTER) msgs.chatter = '…' + msgs.chatter.slice(-1500)
      }
      msgs.responses.push(response)
      if (msgs.responses.length > MAX_RESPONSES) msgs.responses.shift()
      msgs.thinkingStatus = null
      continue
    }

    // 2d. 无特殊标记 → 累积到 chatter（单个桶，持续替换而非堆积）
    msgs.chatter += (msgs.chatter ? '\n' : '') + t
    if (msgs.chatter.length > MAX_CHATTER) msgs.chatter = '…' + msgs.chatter.slice(-1500)
  }
}
function appendRecentOutput(key: string, data: string): void {
  let lines = recentOutput.get(key)
  if (!lines) { lines = []; recentOutput.set(key, lines) }

  // 1. 清洗 ANSI 转义序列
  const clean = data
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")

  // 2. 按 \n 分段，段内用 \r 模拟终端同位置覆盖（TUI 动画帧折叠为最终状态）
  const segments = clean.split("\n")
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    // 段内的 \r 分隔表示"回到行首覆盖"，取最后一次覆盖后的内容
    const parts = segment.split("\r")
    // 从后往前找第一个非空内容（TUI 动画的最后一帧）
    let meaningful = ""
    for (let j = parts.length - 1; j >= 0; j--) {
      if (parts[j].trim()) {
        meaningful = parts[j]
        break
      }
    }
    if (!meaningful.trim()) continue

    // 3. ● 标记检测：遇到新的 AI 回复标记时，清除当前思考动画行
    //    Claude Code 用 ● 开头标记真实 AI 消息（区别于 TUI 状态栏）
    if (/^●\s*[A-Z一-鿿]/.test(meaningful.trim())) {
      // 回溯删除最近的 TUI 动画帧（spinner 行），为 ● 回复腾出空间
      let removed = 0
      while (lines.length > 0 && removed < 20) {
        const last = lines[lines.length - 1]
        if (/^[✻✽✢✶✹✺✼✾·⏳🧠\s]+/.test(last) ||
            /[✻✽✢✶]/.test(last) && last.trim().length < 60 ||
            /almost done thinking/i.test(last) ||
            /thought for \d+s\)/i.test(last) ||
            /·\s*(Thinking|Working|Doing)/i.test(last)) {
          lines.pop()
          removed++
        } else {
          break
        }
      }
    }

    if (lines.length >= MAX_RECENT_LINES) lines.shift()
    lines.push(meaningful)
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

/** PTY spawn 信号量：Windows ConPTY 并发创建控制台会导致 AttachConsole failed。
 *  限制同时最多 2 个 spawn，且每次 spawn 后至少间隔 1.5s 冷却。*/
const MAX_CONCURRENT_SPAWNS = 2
const SPAWN_COOLDOWN_MS = 1500
let activeSpawns = 0
let lastSpawnDoneAt = 0
const spawnWaiters: Array<() => void> = []

function releaseSpawnSlot(): void {
  activeSpawns--
  lastSpawnDoneAt = Date.now()
  // 唤醒等待队列
  if (spawnWaiters.length > 0 && activeSpawns < MAX_CONCURRENT_SPAWNS) {
    const next = spawnWaiters.shift()!
    next()
  }
}

async function acquireSpawnSlot(): Promise<void> {
  // 冷却检查：距离上次 spawn 完成不足 SPAWN_COOLDOWN_MS → 等待
  const cooldownRemain = SPAWN_COOLDOWN_MS - (Date.now() - lastSpawnDoneAt)
  if (cooldownRemain > 0 && lastSpawnDoneAt > 0) {
    await new Promise<void>(r => setTimeout(r, cooldownRemain))
  }
  // 并发检查：已满 → 排队
  if (activeSpawns >= MAX_CONCURRENT_SPAWNS) {
    await new Promise<void>(resolve => { spawnWaiters.push(resolve) })
  }
  activeSpawns++
}

/** 直接 spawn PTY（供 harnessAgent 工具调用，不走 IPC）。
 *  自动注入 --permission-mode acceptEdits，失败时自动重试。 */
export async function spawnPtySession(projectPath: string, command?: string, args?: string[]): Promise<{ success: boolean; pid?: number; sessionId?: string; message?: string }> {
  await acquireSpawnSlot()
  try {
    return await spawnPtySessionImpl(projectPath, command, args)
  } finally {
    releaseSpawnSlot()
  }
}

/** 确保 Claude Code 全局配置文件完整性。
 *  多实例并发写入 C:\Users\admin\.claude.json 可能导致 JSON 截断，
 *  损坏后所有 claude 实例启动时直接 exit code 1。 */
function ensureClaudeConfigIntegrity(): void {
  const homeDir = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\admin'
  const configPath = path.join(homeDir, '.claude.json')
  if (!fs.existsSync(configPath)) return

  try {
    JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    return // 文件完好
  } catch {
    console.warn('[PTY] .claude.json 损坏，尝试从备份恢复...')
  }

  // 从备份目录找最新有效备份
  const backupDir = path.join(homeDir, '.claude', 'backups')
  if (fs.existsSync(backupDir)) {
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('.claude.json.backup.'))
      .map(f => ({ name: f, path: path.join(backupDir, f), mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    for (const bk of backups) {
      try {
        const content = fs.readFileSync(bk.path, 'utf-8')
        const parsed = JSON.parse(content)
        // 有效备份必须包含基本字段
        if (parsed && typeof parsed === 'object') {
          fs.writeFileSync(configPath, content, 'utf-8')
          console.log('[PTY] .claude.json 已从备份恢复:', bk.name)
          return
        }
      } catch { /* 下一个 */ }
    }
  }

  // 无有效备份 → 写入最小合法配置
  const minimal = { migrationVersion: 13, seenNotifications: {} }
  fs.writeFileSync(configPath, JSON.stringify(minimal, null, 2), 'utf-8')
  console.log('[PTY] .claude.json 无有效备份，已重建最小配置')
}

async function spawnPtySessionImpl(projectPath: string, command?: string, args?: string[]): Promise<{ success: boolean; pid?: number; sessionId?: string; message?: string }> {
  const key = normPath(projectPath)

  // 预检：修复可能损坏的全局 claude.json（多实例并发写入常见问题）
  ensureClaudeConfigIntegrity()
  const existing = sessions.get(key)
  if (existing) {
    console.log('[PTY] 关闭已有会话:', existing.sessionId)
    existing.pty.kill()
    sessions.delete(key)
    ptyReady.delete(key)
    recentOutput.delete(key)
    rawRecentOutput.delete(key)
    messageStores.delete(key)
    readableBuffer.delete(key)
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
        // DeepSeek 模型名映射：Claude Code 内部使用 claude-* 模型名，DeepSeek 不认识
        // 必须显式指定，否则 Claude Code 发的 model 字段对不上 → 卡死/乱码
        // 参考: deepclaude 项目的 settings.json 最佳实践
        settings.env.ANTHROPIC_MODEL = 'deepseek-v4-pro'
        settings.env.ANTHROPIC_SMALL_FAST_MODEL = 'deepseek-v4-flash'
        // 新项目默认跳过信任对话框 + 默认接受编辑，避免首次启动时卡住
        if (settings.hasTrustDialogAccepted !== true) settings.hasTrustDialogAccepted = true
        if (!settings.defaultMode) settings.defaultMode = 'acceptEdits'
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
      // 防重复应答：同一对话框可能跨多个 data 块，用最近应答时间去重
      const now2 = Date.now()
      const lastAutoReply = autoReplyTimes.get(key) || 0
      if (now2 - lastAutoReply < 3000) {
        // 3s 内已应答过，跳过（对话框跨多个 data chunk）
        // 继续往下走到 ❯ 检测
      } else {
        // 信任/安全对话框 v2.1: "Quick safety check: Is this a project you created or one you trust?"
        // 选项: "Yes, I trust this folder" / "No, exit"，默认 Yes → 回车即可
        if (/Quick safety check|safety check.*project.*trust/i.test(joined) &&
            /Yes.*trust.*folder/i.test(joined)) {
          console.log('[PTY] ⚡ 自动应答信任对话框(Quick safety check) → Enter —', key.slice(-40))
          autoReplyTimes.set(key, now2)
          newPty.write('\r')
        }
        // 信任对话框 v2.0 旧版: "Do you trust the files in this folder?"
        else if (/Do you (trust|want to load)/i.test(joined) &&
                 /(Yes|Trust|Continue|回车)/i.test(joined)) {
          console.log('[PTY] ⚡ 自动应答信任对话框(Do you trust) → Enter —', key.slice(-40))
          autoReplyTimes.set(key, now2)
          newPty.write('\r')
        }
        // API Key 确认: "Do you want to use this API key? 1. Yes ❯ 2. No"
        else if (/Do you want to use this API key/i.test(joined) && /1\.\s*Yes/i.test(joined)) {
          console.log('[PTY] ⚡ 自动应答 API Key 对话框 → Yes —', key.slice(-40))
          autoReplyTimes.set(key, now2)
          newPty.write('1\r')
        }
        // 更新确认: "A new version .* is available" → ESC 跳过
        else if (/A new version.*is available/i.test(joined) &&
                 /(Update|Skip|Later|以后)/i.test(joined)) {
          console.log('[PTY] ⚡ 自动应答更新提示 → Skip —', key.slice(-40))
          autoReplyTimes.set(key, now2)
          newPty.write('\x1b')
        }
        // Bash 权限对话框: "Do you want to proceed? 1. Yes ❯ 2. No"
        else if (/Do you want to proceed/i.test(joined) && /1\.\s*Yes/i.test(joined)) {
          console.log('[PTY] ⚡ 自动应答 Bash 权限对话框 → Yes —', key.slice(-40))
          autoReplyTimes.set(key, now2)
          newPty.write('1\r')
        }
        // Auto-update 失败: "Auto-update failed" → 回车跳过，继续工作
        else if (/Auto-update failed/i.test(joined)) {
          console.log('[PTY] ⚡ 自动应答 Auto-update failed → Enter —', key.slice(-40))
          autoReplyTimes.set(key, now2)
          newPty.write('\r')
        }
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
      try { appendRawOutput(key, data) } catch (e) { /* 聚合失败不阻塞 PTY 数据流 */ }
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
      rawRecentOutput.delete(key)
      messageStores.delete(key)
    readableBuffer.delete(key)
      autoReplyTimes.delete(key)

      if (!resolved && attempt < 2) {
        // 快速失败 → 重试
        const delay = attempt === 0 ? 2000 : 5000
        console.log(`[PTY] ${delay}ms 后重试 (attempt ${attempt + 1})`)
        resolved = true
        sessions.delete(key)
        rawRecentOutput.delete(key)
        messageStores.delete(key)
    readableBuffer.delete(key)
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
        rawRecentOutput.delete(key)
        messageStores.delete(key)
    readableBuffer.delete(key)
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
    // 思考动画残片：almost done thinking / thought for Xs
    if (/almost done thinking/i.test(plain)) return false
    if (/thought for \d+s\)/i.test(plain)) return false
    if (/^·\s*(Thinking|Working|Doing)…?\s*$/i.test(plain)) return false
    // TUI 页脚/状态栏残片
    if (/⏵⏵.*accept edits/i.test(plain)) return false
    if (/^●\s*high\s*·\s*\/effort/i.test(plain)) return false
    if (/^Resume this session with:/i.test(plain)) return false
    if (/Claude Code 会话已结束/i.test(plain)) return false
    if (/^●\s*(Wait|Propagating)…?/i.test(plain)) return false
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
      rawRecentOutput.delete(key)
      messageStores.delete(key)
    readableBuffer.delete(key)
      return { success: true }
    }
    return { success: false, message: '无活跃的 PTY 会话' }
  }
  for (const [k, s] of sessions) {
    s.pty.kill()
    sessions.delete(k)
    ptyReady.delete(k)
    rawRecentOutput.delete(k)
    messageStores.delete(k)
    readableBuffer.delete(k)
  }
  return { success: true }
}

/** 获取最近 PTY 输出（供 harnessAgent read_project_chat 工具读取实时终端内容）。
 *  主数据源：messageStores.responses（主进程直接捕获，无 IPC 依赖）+ chatMessages（Chat UI 推送）。
 *  辅助数据源：对话框 + 可读终端输出。 */
export function getRecentPtyOutput(projectPath: string, _maxLines: number = 500): string {
  const key = normPath(projectPath)
  const parts: string[] = []

  // 1. 主进程直接捕获的 ● 响应（messageStores.responses — 零 IPC 延迟，永远最新）
  const msgs = messageStores.get(key)
  if (msgs && msgs.responses.length > 0) {
    const recent = msgs.responses.slice(-20)
    parts.push('💬 项目 AI 回复 (实时):')
    parts.push('─'.repeat(40))
    for (const r of recent) {
      // 清洗 TUI 残留：先全量剥离 ANSI，再去除 spinner 标记和尾部时间戳
      const clean = r
        .replace(/\x1b\[[0-9;:?>=<]*[A-Za-z@-~]/g, '')  // 全量 CSI 序列（含光标移动/颜色/擦除）
        .replace(/\x1b\][^\x07]*\x07/g, '')  // OSC 序列
        .replace(/[✻✽✢✶✹✺✼✾·⏳●🧠]\s*(Cooked|Baked|Brewed|Crunched|Churned|Worked|Thundering|Puttering|Tempering|Sautéed|Fermenting|Fiddle-faddling|Frosting|Wibbling|Boogieing|Dilly-dallying|Spelunking|Architecting|Actualizing|Noodling|Mulling|Pondering|Musing|Dwelling|Stewing|Brooding|Ruminating|Perking|Lazing|Infusing|Sipping|Crafting|Deciphering|Orchestrat|Julienning|Bootstrapping|Warping|Stirring|Generat|Compil|Execut|Analyz|Process|Search|Loading|Working|Doing|Thinking|Simmering)\s+for\s+\d+s?/gi, '')
        .replace(/[✻✽✢✶✹✺✼✾·⏳🧠●]/g, '')
        .replace(/\s*\d+s\s*·\s*thinking\s*/gi, '')
        .replace(/❯/g, '')
        .trim()
      if (!clean) continue
      parts.push(`🤖 ${clean.slice(0, 800)}`)
    }
    parts.push('')
  }

  // 2. Chat UI 已处理消息（补充用户消息 + 系统消息）
  const uiMsgs = chatMessages.get(key)
  if (uiMsgs && uiMsgs.length > 0) {
    const userAndSys = uiMsgs.filter(m => m.role === 'user' || m.role === 'system')
    if (userAndSys.length > 0) {
      const recent = userAndSys.slice(-10)
      parts.push('👤 用户/系统消息 (来自 Chat UI):')
      parts.push('─'.repeat(40))
      for (const m of recent) {
        const roleTag = m.role === 'user' ? '👤' : '📢'
        const clean = m.content.replace(/\x1b\[[0-9;]*m/g, '').trim()
        if (!clean) continue
        parts.push(`${roleTag} ${clean.slice(0, 500)}`)
      }
      parts.push('')
    }
  }

  // 3. 对话框/选项
  if (msgs && msgs.dialogs.length > 0) {
    parts.push('⚠️ 对话框/选项:')
    for (const d of msgs.dialogs) parts.push(`  ${d}`)
    parts.push('')
  }

  // 4. 如果以上全空 → 回退到 readableBuffer
  if (parts.length === 0) {
    const readable = readableBuffer.get(key)
    if (readable && readable.length > 0) {
      const recent = readable.slice(-200)
      const unique: string[] = []
      let prev = ''
      for (const line of recent) {
        if (!line || line === prev) continue
        prev = line
        unique.push(line)
      }
      const output = unique.join('\n').trim()
      if (output) {
        parts.push('📡 实时终端输出:')
        parts.push('─'.repeat(40))
        parts.push(output.length > 3000 ? '…' + output.slice(-3000) : output)
      }
    }
  }

  if (parts.length === 0) return ''
  const result = parts.join('\n').trim()
  return result || ''
}

/** 获取最近 PTY 错误快照（供 harnessAgent diagnose_project 工具使用）。
 *  返回清洗过的状态行 + 原始最近输出（保留错误信息用于模式匹配） */
export function getPtyErrorSnapshot(projectPath: string, maxLines: number = 150): string {
  const lines = rawRecentOutput.get(normPath(projectPath))
  if (!lines || lines.length === 0) return ''
  const recent = lines.slice(-maxLines)
  // 不做清洗 — 保留原始输出用于错误模式匹配（含 ANSI 但 diagnoseErrors 用 regex 不care）
  return recent.join('\n').slice(-6000)
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
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    mainWindow.webContents.send(channel, projectPath, ...args)
  } catch {
    // 渲染进程已销毁（白屏/崩溃），静默丢弃
  }
}

export function registerPtyIpc(window: BrowserWindow) {
  mainWindow = window

  // 窗口关闭/崩溃时清理所有 PTY 会话，防止 sendToRenderer 死循环刷屏
  window.on('closed', () => {
    console.log('[PTY] 窗口已关闭，清理全部 PTY 会话')
    for (const session of sessions.values()) {
      try { session.pty.kill() } catch {}
    }
    sessions.clear()
    mainWindow = null
  })

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
