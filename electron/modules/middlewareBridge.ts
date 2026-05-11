import { ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as http from 'http'

// Middleware Box 路径 — CHD 的兄弟目录
const MIDDLEWARE_BOX_PATH = path.resolve(__dirname, '..', '..', '..', 'DeepBlueGodMiddlewareBox')

interface MiddlewareStatus {
  running: boolean
  pid?: number
  startTime?: string
  activeAgents: number
  queuedRequests: number
  circuitBreakers: Record<string, 'closed' | 'open' | 'half-open'>
}

let middlewareProcess: ChildProcess | null = null
let middlewareStatus: MiddlewareStatus = {
  running: false,
  activeAgents: 0,
  queuedRequests: 0,
  circuitBreakers: {},
}

/** 向 MiddlewareBox 的 HTTP 服务器发送 PTY 审计事件 */
export async function forwardPtyEvent(event: {
  type: string
  sessionId: string
  project: string
  agent: string
  timestamp: string
  data: Record<string, any>
}): Promise<void> {
  if (!middlewareStatus.running) {
    console.log('[MWBridge] 中间件未运行，跳过事件:', event.type)
    return
  }
  try {
    const body = JSON.stringify(event)
    await new Promise<void>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: 18900,
        path: '/gateway/pty-event',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        res.resume()
        res.on('end', resolve)
      })
      req.on('error', (err) => {
        console.log('[MWBridge] 转发失败:', event.type, err.message)
        reject(err)
      })
      req.setTimeout(2000, () => { req.destroy(); resolve() })
      req.write(body)
      req.end()
    })
  } catch (err: any) {
    console.log('[MWBridge] 转发异常:', event.type, err.message)
  }
}

export function getMiddlewareStatus(): MiddlewareStatus {
  return middlewareStatus
}

export function setMiddlewareRunning(running: boolean) {
  middlewareStatus.running = running
}

/** 主动探测 MiddlewareBox /health 端点，更新运行状态 */
export async function probeMiddlewareHealth(): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const req = http.get('http://127.0.0.1:18900/health', (res) => {
        res.resume()
        res.on('end', resolve)
      })
      req.on('error', reject)
      req.setTimeout(2000, () => { req.destroy(); reject(new Error('timeout')) })
    })
    middlewareStatus.running = true
    return true
  } catch {
    middlewareStatus.running = false
    return false
  }
}

export function registerMiddlewareIpc() {

  // ---- Middleware 生命周期 ----
  ipcMain.handle('middleware:start', async () => {
    try {
      if (middlewareProcess && middlewareStatus.running) {
        return { success: true, status: middlewareStatus, message: '中间件已在运行中' }
      }

      // 启动 MiddlewareBox Node.js 进程
      const child = spawn('node', ['dist/start.js'], {
        cwd: MIDDLEWARE_BOX_PATH,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' },
      })

      child.stdout?.on('data', (data: Buffer) => {
        console.log('[MiddlewareBox]', data.toString().trim())
      })
      child.stderr?.on('data', (data: Buffer) => {
        console.error('[MiddlewareBox:err]', data.toString().trim())
      })
      child.on('exit', (code) => {
        console.log(`[MiddlewareBox] 进程退出，退出码: ${code}`)
        middlewareStatus.running = false
        middlewareProcess = null
      })
      child.on('error', (err) => {
        console.error('[MiddlewareBox] 启动失败:', err.message)
        middlewareStatus.running = false
        middlewareProcess = null
      })

      middlewareProcess = child
      middlewareStatus.running = true
      middlewareStatus.pid = child.pid
      middlewareStatus.startTime = new Date().toISOString()

      return { success: true, status: middlewareStatus, message: 'MiddlewareBox 已启动' }
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  ipcMain.handle('middleware:stop', async () => {
    try {
      if (middlewareProcess) {
        middlewareProcess.kill()
        middlewareProcess = null
      }
      middlewareStatus.running = false
      return { success: true, message: 'MiddlewareBox 已停止' }
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  ipcMain.handle('middleware:get-status', async () => {
    return { success: true, status: middlewareStatus }
  })

  // ---- Agent 管理 ----
  ipcMain.handle('middleware:register-agent', async (_, agentContext: any) => {
    try {
      middlewareStatus.activeAgents++
      return {
        success: true,
        agentId: agentContext.agentId,
        message: `Agent ${agentContext.agentId} 已通过中间件注册`,
      }
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  ipcMain.handle('middleware:unregister-agent', async (_, agentId: string) => {
    try {
      if (middlewareStatus.activeAgents > 0) middlewareStatus.activeAgents--
      return { success: true, message: `Agent ${agentId} 已注销` }
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  // ---- 请求处理（核心拦截流） ----
  ipcMain.handle('middleware:process-request', async (_, request: any) => {
    try {
      middlewareStatus.queuedRequests++
      const response = {
        requestId: request.id,
        success: true,
        allowed: true,
        durationMs: 0,
        data: { processed: true, via: 'middleware-bridge' },
      }
      middlewareStatus.queuedRequests = Math.max(0, middlewareStatus.queuedRequests - 1)
      return { success: true, response }
    } catch (error) {
      middlewareStatus.queuedRequests = Math.max(0, middlewareStatus.queuedRequests - 1)
      return { success: false, message: String(error) }
    }
  })

  // ---- Agent 画像 & 能力雷达 ----
  ipcMain.handle('middleware:get-agent-profiles', async () => {
    return { success: true, profiles: [] }
  })

  ipcMain.handle('middleware:get-agent-profile', async (_, agentId: string) => {
    return {
      success: true,
      profile: {
        agentId,
        totalOperations: 0,
        capabilities: [],
        strategies: [],
        modelPreferences: [],
        performance: { avgDurationMs: 0, totalTokensUsed: 0, activeHours: 0 },
        lastOperationAt: null,
      },
    }
  })

  ipcMain.handle('middleware:compare-agents', async (_, agentIds: string[]) => {
    return { success: true, comparison: { agentIds, profiles: [] } }
  })

  // ---- MCP Skill 注册 ----
  ipcMain.handle('middleware:register-skill', async (_, skill: any) => {
    return { success: true, message: `Skill ${skill.name} 已注册` }
  })

  ipcMain.handle('middleware:list-skills', async () => {
    return { success: true, skills: [] }
  })

  // ---- 健康 & 熔断 ----
  ipcMain.handle('middleware:get-health', async () => {
    return {
      success: true,
      health: {
        status: middlewareStatus.running ? 'healthy' as const : 'unhealthy' as const,
        uptime: 0,
        activeAgents: middlewareStatus.activeAgents,
        queuedRequests: middlewareStatus.queuedRequests,
        circuitBreakers: middlewareStatus.circuitBreakers,
        memory: { heapUsedMB: 0, heapTotalMB: 0 },
        lastCheck: new Date().toISOString(),
      },
    }
  })

  ipcMain.handle('middleware:reset-circuit-breaker', async (_, breakerId: string) => {
    middlewareStatus.circuitBreakers[breakerId] = 'closed'
    return { success: true, message: `熔断器 ${breakerId} 已重置` }
  })

  // ---- 审计数据 (v3.0) ----
  // 从项目 .dbvs/audit/events.jsonl 读取审计事件
  ipcMain.handle('audit:get-project-events', async (_, projectPath: string) => {
    try {
      const eventsFile = path.join(projectPath, '.dbvs', 'audit', 'events.jsonl')
      if (!fs.existsSync(eventsFile)) {
        return { success: true, events: [] }
      }
      const content = fs.readFileSync(eventsFile, 'utf-8')
      const events = content.trim().split('\n').filter(Boolean).slice(-500).map(l => JSON.parse(l))
      return { success: true, events }
    } catch (err) {
      return { success: false, message: String(err), events: [] }
    }
  })

  // 从 MiddlewareBox HTTP API 获取聚合审计统计
  ipcMain.handle('audit:get-middleware-stats', async () => {
    if (!middlewareStatus.running) {
      return { success: false, message: 'MiddlewareBox 未运行' }
    }
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const req = http.get('http://127.0.0.1:18900/api/audit', (res) => {
          let data = ''
          res.on('data', (chunk: Buffer) => { data += chunk.toString() })
          res.on('end', () => resolve(data))
        })
        req.on('error', reject)
        req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')) })
      })
      return { success: true, stats: JSON.parse(body) }
    } catch {
      return { success: false, message: '无法连接 MiddlewareBox' }
    }
  })
}
