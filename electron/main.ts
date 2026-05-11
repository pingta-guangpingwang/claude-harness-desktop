// =============================================================================
// Claude Harness Desktop — Electron Main Process
// =============================================================================
// A visual multi-project cockpit for Claude Code
// =============================================================================
// =============================================================================

import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import * as path from 'path'
import { registerDbhtIpc } from './modules/dbhtIpc.js'
import { registerHorseFarmIpc } from './modules/horseFarmIpc.js'
import { registerSandboxIpc } from './modules/sandboxIpc.js'
import { registerMiddlewareIpc, getMiddlewareStatus, probeMiddlewareHealth, setMiddlewareRunning } from './modules/middlewareBridge.js'
import { registerHubSettingsIpc } from './modules/hubSettings.js'
import { registerPtyIpc } from './modules/ptyManager.js'
import { registerSessionIpc } from './modules/sessionManager.js'
import { registerHarnessIpc } from './modules/harnessIpc.js'
import { registerCliIpc, getCliRegistry } from './cli/cliIpc.js'
import { bridgeCliToAgent } from './modules/harnessIpc.js'
import { registerPluginIpc } from './plugins/pluginIpc.js'
import { registerWorkflowIpc } from './workflow/workflowIpc.js'
import { registerSystemIpc, getAuditLogger, getRuleEngine, getPerfMonitor } from './modules/systemIpc.js'
import { registerHubIpc } from './modules/hubIpc.js'

// Phase 1 — 中枢层
import { trayManager } from './tray.js'
import { windowManager, setPreloadPath } from './windowManager.js'
import { hotkeyManager } from './hotkeys.js'
import { autoStartManager } from './autoStart.js'
import { db } from './modules/database.js'

const preloadPath = path.join(__dirname, 'preload.js')
setPreloadPath(preloadPath)

let mainWindow: BrowserWindow | null = null

async function initializeApp() {
  // 1. 创建主窗口
  mainWindow = windowManager.createMainWindow()

  // 2. 注册所有 IPC 处理器
  registerAllHandlers()

  // 3. 加载中枢设置并初始化托盘/热键/自启
  await initHubLayer()

  // 4. 自动启动 MiddlewareBox
  await startMiddlewareBox()
}

function registerAllHandlers() {
  Menu.setApplicationMenu(null)
  registerDbhtIpc(mainWindow)
  registerHorseFarmIpc()
  registerSandboxIpc()
  registerMiddlewareIpc()
  registerHubSettingsIpc()
  registerPtyIpc(mainWindow!)
  registerSessionIpc()
  registerHarnessIpc(mainWindow!)
  registerCliIpc(mainWindow!)
  registerPluginIpc(mainWindow!)
  registerWorkflowIpc(mainWindow!)
  registerSystemIpc()
  registerHubIpc()

  // Agent-CLI 桥接
  const cliRegistry = getCliRegistry()
  if (cliRegistry) {
    bridgeCliToAgent(cliRegistry)
  }

  // VSCode launcher
  ipcMain.handle('launcher:open-vscode', async (_event, projectPath: string) => {
    const { exec } = await import('child_process')
    const fs = await import('fs')
    const path = await import('path')
    const CODE_EXE = 'C:\\Users\\admin\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'

    try {
      const vscodeDir = path.join(projectPath, '.vscode')
      if (!fs.existsSync(vscodeDir)) fs.mkdirSync(vscodeDir, { recursive: true })
      const tasksJsonPath = path.join(vscodeDir, 'tasks.json')
      const claudeTask = {
        label: 'Claude Code Auto Launch',
        type: 'shell',
        command: 'claude',
        problemMatcher: [],
        presentation: { reveal: 'always', panel: 'new' },
        runOptions: { runOn: 'folderOpen' },
      }
      let tasks: any = { version: '2.0.0', tasks: [claudeTask] }
      if (fs.existsSync(tasksJsonPath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(tasksJsonPath, 'utf-8'))
          const existingTasks = existing.tasks || []
          if (!existingTasks.some((t: any) => t.label === claudeTask.label)) {
            tasks = { ...existing, tasks: [...existingTasks, claudeTask] }
          } else {
            tasks = existing
          }
        } catch { /* 解析失败则覆盖 */ }
      }
      fs.writeFileSync(tasksJsonPath, JSON.stringify(tasks, null, 2), 'utf-8')
    } catch (e) {
      console.warn('[Launcher] 写入 .vscode/tasks.json 失败:', e)
    }

    return new Promise((resolve) => {
      exec(`"${CODE_EXE}" "${projectPath}"`, (err) => {
        if (err) resolve({ success: false, message: err.message })
        else resolve({ success: true, tasksGenerated: true })
      })
    })
  })
}

/** 初始化中枢层：托盘、热键、开机自启 */
async function initHubLayer() {
  const settings = await db.getHubSettings()

  // 设置最小化到托盘行为
  windowManager.setMinimizeToTray(!!settings.minimizeToTray)

  // 初始化系统托盘
  trayManager.init(mainWindow!)

  trayManager.setOnShow(() => {
    windowManager.showMainWindow()
  })

  trayManager.setOnQuit(() => {
    app.quit()
  })

  // 初始化全局热键
  hotkeyManager.setMainWindow(mainWindow!)
  hotkeyManager.init(settings.summonHotkey || 'Ctrl+Shift+H')

  // 开机自启
  if (settings.autoStartEnabled) {
    autoStartManager.enable()
  }
}

/** 启动 MiddlewareBox */
async function startMiddlewareBox() {
  const mwAlreadyRunning = await probeMiddlewareHealth()
  if (mwAlreadyRunning) {
    console.log('[CHD] MiddlewareBox 已运行，复用现有实例')
    setMiddlewareRunning(true)
  } else {
    console.log('[CHD] 启动 MiddlewareBox...')
    const { spawn } = await import('child_process')
    const MIDDLEWARE_BOX_PATH = path.resolve(__dirname, '..', '..', '..', 'DeepBlueGodMiddlewareBox')
    const mwProcess = spawn('node', ['dist/start.js'], {
      cwd: MIDDLEWARE_BOX_PATH,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production' },
    })

    mwProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      console.log('[MiddlewareBox]', text)
      if (text.includes('服务已启动') || text.includes('listening')) {
        setMiddlewareRunning(true)
      }
    })
    mwProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text.includes('EADDRINUSE')) {
        console.error('[CHD] MiddlewareBox 端口被占用，尝试复用已有实例')
        probeMiddlewareHealth()
      } else {
        console.error('[MiddlewareBox:err]', text)
      }
    })
    mwProcess.on('exit', (code) => {
      console.log(`[CHD] MiddlewareBox 进程退出，退出码: ${code}`)
      setMiddlewareRunning(false)
    })
    mwProcess.on('error', (err) => {
      console.error('[CHD] MiddlewareBox 启动失败:', err.message)
      setMiddlewareRunning(false)
    })

    setTimeout(async () => {
      const ok = await probeMiddlewareHealth()
      if (ok) setMiddlewareRunning(true)
    }, 3000)
  }
}

// ---- App 生命周期 ----

app.whenReady().then(async () => {
  await initializeApp()
})

// 关闭到托盘而非退出
app.on('window-all-closed', () => {
  // 不退出，由托盘管理
})

app.on('activate', () => {
  // macOS dock 点击 → 显示窗口
  windowManager.showMainWindow()
})

// 真正退出前的清理
app.on('before-quit', () => {
  hotkeyManager.destroy()
  trayManager.destroy()
})

// 防止多个实例
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    windowManager.showMainWindow()
  })
}
