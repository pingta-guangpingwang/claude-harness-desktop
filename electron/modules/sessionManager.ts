import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
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

export function registerSessionIpc() {
  ipcMain.handle('session:save', async (_event, session: ChatSession) => {
    try {
      const dir = sessionDir(session.projectPath)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(sessionPath(session.projectPath, session.sessionId), JSON.stringify(session, null, 2), 'utf-8')
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
}
