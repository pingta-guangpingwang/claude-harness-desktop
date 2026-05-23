import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  isResponse?: boolean
}

interface ChatSession {
  sessionId: string
  projectPath: string
  messages: ChatMessage[]
  startedAt: string
  endedAt?: string
  label?: string
}

function sessionDir(projectPath: string): string {
  return path.join(projectPath, '.dbvs', 'chat')
}

function sessionPath(projectPath: string, sessionId: string): string {
  return path.join(sessionDir(projectPath), `${sessionId}.json`)
}

function normPath(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').trim()
    .replace(/^([a-z]):/i, (_, d) => d.toUpperCase() + ':')
}

/** Chat UI 已处理消息缓存（key = 规范化项目路径）。
 *  供 getRecentPtyOutput 直接读取，Agent 看到的内容 = Chat UI 显示的内容。 */
export const chatMessages = new Map<string, ChatMessage[]>()

export function registerSessionIpc() {
  ipcMain.handle('session:save', async (_event, session: ChatSession) => {
    try {
      const dir = sessionDir(session.projectPath)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(sessionPath(session.projectPath, session.sessionId), JSON.stringify(session, null, 2), 'utf-8')

      // 同时更新内存缓存，供 Agent 实时读取
      const key = normPath(session.projectPath)
      const msgs = (session.messages || []).filter(m => {
        // 只保留有用的消息：用户消息 + AI 回复 + 非思考系统消息
        if (m.role === 'user') return true
        if (m.role === 'assistant' && (m as any).isResponse) return true
        if (m.role === 'system' && !m.content.startsWith('🧠')) return true
        return false
      })
      if (msgs.length > 0) chatMessages.set(key, msgs)

      return { success: true }
    } catch (err) {
      return { success: false, message: String(err) }
    }
  })

  ipcMain.handle('session:list', async (_event, projectPath?: string) => {
    try {
      const results: ChatSession[] = []
      const searchDirs = projectPath ? [sessionDir(projectPath)] : []

      for (const dir of searchDirs) {
        if (!fs.existsSync(dir)) continue
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
        for (const file of files) {
          try {
            const raw = fs.readFileSync(path.join(dir, file), 'utf-8')
            results.push(JSON.parse(raw))
          } catch { /* skip corrupt files */ }
        }
      }

      results.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      return { success: true, sessions: results }
    } catch (err) {
      return { success: false, sessions: [], message: String(err) }
    }
  })

  ipcMain.handle('session:get', async (_event, projPath: string, sessionId: string) => {
    try {
      const sp = sessionPath(projPath, sessionId)
      if (!fs.existsSync(sp)) return { success: false, message: 'Session not found' }
      const raw = fs.readFileSync(sp, 'utf-8')
      return { success: true, session: JSON.parse(raw) }
    } catch (err) {
      return { success: false, message: String(err) }
    }
  })

  ipcMain.handle('session:delete', async (_event, projPath: string, sessionId: string) => {
    try {
      const sp = sessionPath(projPath, sessionId)
      if (fs.existsSync(sp)) fs.unlinkSync(sp)
      return { success: true }
    } catch (err) {
      return { success: false, message: String(err) }
    }
  })

  // 实时消息推送：Chat UI 每次更新消息时立即同步到主进程内存
  // 不走磁盘，零延迟，供 getRecentPtyOutput 实时读取
  ipcMain.handle('chat:pushMessages', async (_event, projectPath: string, messages: ChatMessage[]) => {
    try {
      const key = normPath(projectPath)
      const msgs = messages.filter(m => {
        if (m.role === 'user') return true
        if (m.role === 'assistant' && (m as any).isResponse) return true
        if (m.role === 'system' && !m.content.startsWith('🧠')) return true
        return false
      })
      if (msgs.length > 0) chatMessages.set(key, msgs)
      return { success: true }
    } catch (err) {
      return { success: false, message: String(err) }
    }
  })
}
