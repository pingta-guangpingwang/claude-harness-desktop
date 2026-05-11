// WindowManager — 多窗口生命周期管理（主窗口 + 悬浮小窗）
import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

interface FloatingWidgetConfig {
  position: { x: number; y: number }
  size: { width: number; height: number }
}

export class WindowManager {
  private mainWindow: BrowserWindow | null = null
  private floatingWindow: BrowserWindow | null = null
  private preloadPath: string
  private floatingConfig: FloatingWidgetConfig = {
    position: { x: 100, y: 100 },
    size: { width: 320, height: 480 },
  }

  constructor(preloadPath: string) {
    this.preloadPath = preloadPath
  }

  /** 创建主窗口 */
  createMainWindow(): BrowserWindow {
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      title: 'Claude Harness Desktop',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
      show: false,
    })

    if (process.env.NODE_ENV === 'development') {
      const port = process.env.VITE_DEV_PORT || '29347'
      this.mainWindow.loadURL(`http://localhost:${port}`)
    } else {
      this.mainWindow.loadFile(join(__dirname, '../dist/index.html'))
    }

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show()
      if (process.env.NODE_ENV === 'development') {
        this.mainWindow?.webContents.openDevTools({ mode: 'bottom' })
      }
    })

    this.mainWindow.on('close', (e) => {
      // 如果设置了最小化到托盘，则不关闭，只隐藏
      if (this.shouldMinimizeToTray) {
        e.preventDefault()
        this.mainWindow?.hide()
        return
      }
    })

    this.mainWindow.on('closed', () => {
      this.mainWindow = null
    })

    return this.mainWindow
  }

  /** 创建悬浮小窗 */
  createFloatingWindow(config?: FloatingWidgetConfig): BrowserWindow | null {
    if (this.floatingWindow) {
      this.floatingWindow.focus()
      return this.floatingWindow
    }

    if (config) this.floatingConfig = config

    const { position, size } = this.floatingConfig

    this.floatingWindow = new BrowserWindow({
      width: size.width,
      height: size.height,
      x: position.x,
      y: position.y,
      minWidth: 260,
      minHeight: 280,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      hasShadow: true,
      title: 'CHD Quick Access',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    // 加载悬浮小窗的独立页面
    if (process.env.NODE_ENV === 'development') {
      const port = process.env.VITE_DEV_PORT || '29347'
      this.floatingWindow.loadURL(`http://localhost:${port}/#/floating`)
    } else {
      this.floatingWindow.loadFile(join(__dirname, '../dist/index.html'), { hash: '/floating' })
    }

    this.floatingWindow.on('closed', () => {
      this.floatingWindow = null
    })

    // 保存位置变化
    this.floatingWindow.on('move', () => {
      if (this.floatingWindow) {
        const [x, y] = this.floatingWindow.getPosition()
        this.floatingConfig.position = { x, y }
      }
    })

    this.floatingWindow.on('resize', () => {
      if (this.floatingWindow) {
        const [w, h] = this.floatingWindow.getSize()
        this.floatingConfig.size = { width: w, height: h }
      }
    })

    return this.floatingWindow
  }

  /** 关闭悬浮小窗 */
  closeFloatingWindow(): void {
    this.floatingWindow?.close()
    this.floatingWindow = null
  }

  /** 切换悬浮小窗 */
  toggleFloatingWindow(): boolean {
    if (this.floatingWindow) {
      this.closeFloatingWindow()
      return false
    }
    return !!this.createFloatingWindow()
  }

  /** 获取主窗口 */
  getMainWindow(): BrowserWindow | null { return this.mainWindow }

  /** 获取悬浮窗口 */
  getFloatingWindow(): BrowserWindow | null { return this.floatingWindow }

  /** 获取悬浮窗配置 */
  getFloatingConfig(): FloatingWidgetConfig { return { ...this.floatingConfig } }

  /** 更新悬浮窗位置 */
  setFloatingConfig(config: Partial<FloatingWidgetConfig>): void {
    if (config.position) this.floatingConfig.position = config.position
    if (config.size) this.floatingConfig.size = config.size
  }

  /** 显示主窗口 */
  showMainWindow(): void {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore()
      this.mainWindow.show()
      this.mainWindow.focus()
    }
  }

  /** 主窗口是否可见 */
  isMainVisible(): boolean {
    return this.mainWindow?.isVisible() ?? false
  }

  /** 最小化到托盘开关（由 hub settings 控制） */
  private shouldMinimizeToTray = true

  setMinimizeToTray(enabled: boolean): void { this.shouldMinimizeToTray = enabled }
}

// 单例
let _preloadPath = ''
export function setPreloadPath(p: string): void { _preloadPath = p }
export const windowManager = new WindowManager(_preloadPath || join(__dirname, 'preload.js'))
