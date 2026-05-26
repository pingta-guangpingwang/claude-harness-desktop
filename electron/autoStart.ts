// AutoStartManager — 开机自启管理
import { app } from 'electron'

export class AutoStartManager {
  /** 检查当前是否已启用开机自启 */
  isEnabled(): boolean {
    return app.getLoginItemSettings().openAtLogin
  }

  /** 启用开机自启 */
  enable(): void {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: app.isPackaged ? [] : [app.getAppPath()],
    })
  }

  /** 禁用开机自启 */
  disable(): void {
    app.setLoginItemSettings({
      openAtLogin: false,
    })
  }

  /** 切换 */
  toggle(): boolean {
    const current = this.isEnabled()
    if (current) {
      this.disable()
    } else {
      this.enable()
    }
    return !current
  }

  /** 设置开机自启状态 */
  setEnabled(enabled: boolean): void {
    if (enabled) {
      this.enable()
    } else {
      this.disable()
    }
  }
}

// 单例
export const autoStartManager = new AutoStartManager()
