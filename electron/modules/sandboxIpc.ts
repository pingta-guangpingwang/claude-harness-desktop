import { ipcMain } from 'electron'
import { exec } from 'child_process'

function execDBHT(args: string): Promise<{ success: boolean; data?: any; message?: string; [key: string]: any }> {
  return new Promise((resolve) => {
    exec(`dbgvs ${args}`, { maxBuffer: 10 * 1024 * 1024, timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        if (stdout) {
          try { resolve(JSON.parse(stdout)); return } catch { /* fall through */ }
        }
        const msg = stderr || error.message
        if (msg.includes('not found') || msg.includes('not recognized') || error.code === 127) {
          resolve({ success: false, message: 'dbgvs CLI not found. Install DBHT: cd H:\\SourceTree && npm link' })
        } else {
          resolve({ success: false, message: msg })
        }
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch {
        resolve({ success: false, message: `CLI parse error: ${stdout.substring(0, 300)}` })
      }
    })
  })
}

function quoteArg(s: string): string {
  if (!s.includes(' ') && !s.includes('"')) return s
  return `"${s.replace(/"/g, '\\"')}"`
}

export function registerSandboxIpc() {

  ipcMain.handle('sandbox:snapshot-before-task', async (_, projectPath: string, taskId: string, desc: string, summary: string) => {
    try {
      return await execDBHT(
        `commit ${quoteArg(projectPath)} -m ${quoteArg(`[HF] Task Start: ${desc}`)} --ai harness-farm --session ${quoteArg(taskId)} --summary ${quoteArg(summary || desc)} --format json`
      )
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  ipcMain.handle('sandbox:commit-task-finish', async (_, projectPath: string, taskId: string, desc: string) => {
    try {
      return await execDBHT(
        `commit ${quoteArg(projectPath)} -m ${quoteArg(`[HF] Task Done: ${desc}`)} --ai harness-farm --session ${quoteArg(taskId)} --format json`
      )
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  ipcMain.handle('sandbox:rollback-task', async (_, projectPath: string, sessionId: string) => {
    try {
      return await execDBHT(
        `rollback-ai ${quoteArg(projectPath)} -s ${quoteArg(sessionId)} --format json`
      )
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  ipcMain.handle('sandbox:get-task-history', async (_, projectPath: string, sessionId?: string) => {
    try {
      const result = await execDBHT(`history ${quoteArg(projectPath)} --format json`)
      if (result.success && result.commits && sessionId) {
        result.commits = result.commits.filter((c: any) => c.sessionId === sessionId)
      }
      return result
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  // DBHT 项目版本状态 (v3.0)
  ipcMain.handle('sandbox:get-project-status', async (_, projectPath: string) => {
    try {
      // 用简单命令检测 dbgvs 是否可用（避免 --version 非 JSON 输出导致解析失败）
      const dbhtAvailable = await new Promise<boolean>((resolve) => {
        exec('dbgvs --version', { timeout: 5000 }, (error, stdout) => {
          if (error) { resolve(false); return }
          resolve(stdout.trim().length > 0)
        })
      })
      if (!dbhtAvailable) {
        return { success: true, dbhtAvailable: false, dbhtVersion: null, projectStatus: null }
      }
      // 获取版本号
      const version = await new Promise<string>((resolve) => {
        exec('dbgvs --version', { timeout: 5000 }, (_error, stdout) => {
          resolve(stdout.trim() || 'unknown')
        })
      })
      // 获取项目状态
      const projectStatus = await new Promise<any>((resolve) => {
        exec(`dbgvs status "${projectPath}" --format json`, { timeout: 10000 }, (_error, stdout) => {
          try { resolve(JSON.parse(stdout)) } catch { resolve(null) }
        })
      })
      return {
        success: true,
        dbhtAvailable: true,
        dbhtVersion: version,
        projectStatus,
      }
    } catch {
      return { success: true, dbhtAvailable: false, dbhtVersion: null, projectStatus: null }
    }
  })
}
