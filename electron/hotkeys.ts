// HotkeyManager — 全局快捷键注册/注销
import { globalShortcut, app, BrowserWindow } from 'electron'

export class HotkeyManager {
  private registered: Map<string, () => void> = new Map()
  private mainWindow: BrowserWindow | null = null

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  /** 注册全局热键 */
  register(accelerator: string, action: () => void): boolean {
    if (!app.isReady()) return false
    if (this.registered.has(accelerator)) {
      this.unregister(accelerator)
    }

    try {
      const ok = globalShortcut.register(accelerator, action)
      if (ok) {
        this.registered.set(accelerator, action)
        console.log(`[Hotkeys] 注册热键: ${accelerator}`)
      }
      return ok
    } catch (err) {
      console.warn(`[Hotkeys] 注册失败: ${accelerator} — ${err}`)
      return false
    }
  }

  /** 注销热键 */
  unregister(accelerator: string): void {
    if (!app.isReady()) return
    globalShortcut.unregister(accelerator)
    this.registered.delete(accelerator)
  }

  /** 初始化默认热键 */
  init(summonHotkey: string): void {
    this.register(summonHotkey, () => {
      const win = this.mainWindow
      if (win) {
        if (win.isMinimized()) win.restore()
        if (!win.isVisible()) win.show()
        win.focus()
        win.webContents.send('hotkey:summon')
      }
    })

    this.register('Alt+Space', () => {
      if (this.mainWindow) {
        this.mainWindow.webContents.send('hotkey:quick-search')
      }
    })
  }

  /** 重新绑定唤起热键（hotkey 变更时） */
  rebindSummon(newHotkey: string, oldHotkey: string): void {
    if (oldHotkey && this.registered.has(oldHotkey)) {
      this.unregister(oldHotkey)
    }
    this.register(newHotkey, () => {
      const win = this.mainWindow
      if (win) {
        if (win.isMinimized()) win.restore()
        if (!win.isVisible()) win.show()
        win.focus()
        win.webContents.send('hotkey:summon')
      }
    })
  }

  /** 注销所有热键 */
  destroy(): void {
    if (app.isReady()) {
      globalShortcut.unregisterAll()
    }
    this.registered.clear()
  }
}

// 单例
export const hotkeyManager = new HotkeyManager()
