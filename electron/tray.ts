// TrayManager — 系统托盘 + 右键菜单
import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron'
import { join } from 'path'

export class TrayManager {
  private tray: Tray | null = null
  private mainWindow: BrowserWindow | null = null
  private onShow: (() => void) | null = null
  private onQuit: (() => void) | null = null

  init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow

    // 创建托盘图标（16x16 的简单图标）
    const icon = this.createTrayIcon()
    this.tray = new Tray(icon)
    this.tray.setToolTip('DeepBlue God Harness Farm')

    this.updateMenu()

    // 双击托盘图标 → 显示主窗口
    this.tray.on('double-click', () => {
      this.onShow?.()
    })
  }

  /** 更新托盘菜单 */
  updateMenu(): void {
    if (!this.tray) return

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => this.onShow?.(),
      },
      { type: 'separator' },
      {
        label: '快速启动终端',
        click: () => {
          this.mainWindow?.webContents.send('tray:action', 'quick-terminal')
        },
      },
      {
        label: '广播状态检查',
        click: () => {
          this.mainWindow?.webContents.send('tray:action', 'broadcast-status')
        },
      },
      { type: 'separator' },
      {
        label: '开机自启',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (menuItem) => {
          app.setLoginItemSettings({ openAtLogin: menuItem.checked })
        },
      },
      { type: 'separator' },
      {
        label: '退出 CHD',
        click: () => this.onQuit?.(),
      },
    ])

    this.tray.setContextMenu(contextMenu)
  }

  /** 设置回调 */
  setOnShow(cb: () => void): void { this.onShow = cb }
  setOnQuit(cb: () => void): void { this.onQuit = cb }

  /** 销毁托盘 */
  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  /** 创建设备像素级托盘图标 */
  private createTrayIcon(): Electron.NativeImage {
    // 使用 16x16 PNG buffer（蓝色方块 + 白色 D）
    // 如果项目有 tray-icon.png 则使用它
    try {
      const iconPath = join(__dirname, '..', 'assets', 'tray-icon.png')
      if (require('fs').existsSync(iconPath)) {
        return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
      }
    } catch { /* fallback */ }

    // 编程生成 16x16 图标
    const size = 16
    const canvas = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4
        // 蓝色圆角方块
        const inner = x >= 2 && x <= 13 && y >= 2 && y <= 13
        const border = x >= 1 && x <= 14 && y >= 1 && y <= 14 && !inner
        if (inner && (Math.abs(x - 7) + Math.abs(y - 7) < 10)) {
          canvas[i] = 99; canvas[i + 1] = 102; canvas[i + 2] = 241; canvas[i + 3] = 255 // #6366f1
        } else if (border) {
          canvas[i] = 79; canvas[i + 1] = 70; canvas[i + 2] = 229; canvas[i + 3] = 255
        } else {
          canvas[i] = 0; canvas[i + 1] = 0; canvas[i + 2] = 0; canvas[i + 3] = 0
        }
      }
    }

    return nativeImage.createFromBuffer(canvas, { width: size, height: size, scaleFactor: 1 })
  }
}

// 单例
export const trayManager = new TrayManager()
