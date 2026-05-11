// Hub IPC — 中枢层 IPC 通道（托盘/热键/悬浮窗/自启/调度器）
import { ipcMain } from 'electron'
import { db } from './database'
import { trayManager } from '../tray'
import { windowManager } from '../windowManager'
import { hotkeyManager } from '../hotkeys'
import { autoStartManager } from '../autoStart'
import { resourceScheduler } from '../scheduler'

export function registerHubIpc(): void {

  // ---- 窗口控制 ----
  ipcMain.handle('hub:show-main', async () => {
    windowManager.showMainWindow()
    return { success: true }
  })

  ipcMain.handle('hub:is-main-visible', async () => {
    return { success: true, visible: windowManager.isMainVisible() }
  })

  // ---- 悬浮小窗 ----
  ipcMain.handle('hub:toggle-floating', async () => {
    const open = windowManager.toggleFloatingWindow()
    return { success: true, floatingOpen: open }
  })

  ipcMain.handle('hub:close-floating', async () => {
    windowManager.closeFloatingWindow()
    return { success: true }
  })

  ipcMain.handle('hub:floating-config', async () => {
    return { success: true, config: windowManager.getFloatingConfig() }
  })

  ipcMain.handle('hub:update-floating-config', async (_event, config: any) => {
    windowManager.setFloatingConfig(config)
    return { success: true }
  })

  // ---- 托盘 ----
  ipcMain.handle('hub:tray-update-menu', async () => {
    trayManager.updateMenu()
    return { success: true }
  })

  // ---- 热键 ----
  ipcMain.handle('hub:hotkey-status', async () => {
    return { success: true, registered: true }
  })

  // ---- 开机自启 ----
  ipcMain.handle('hub:auto-start-status', async () => {
    return { success: true, enabled: autoStartManager.isEnabled() }
  })

  ipcMain.handle('hub:auto-start-toggle', async () => {
    const enabled = autoStartManager.toggle()
    // 同步到 hub settings
    const settings = await db.getHubSettings()
    settings.autoStartEnabled = enabled
    await db.setHubSettings(settings)
    return { success: true, enabled }
  })

  ipcMain.handle('hub:auto-start-set', async (_event, enabled: boolean) => {
    autoStartManager.setEnabled(enabled)
    return { success: true }
  })

  // ---- 资源调度器 ----
  ipcMain.handle('hub:scheduler-status', async () => {
    return { success: true, status: resourceScheduler.getStatus() }
  })

  ipcMain.handle('hub:scheduler-set-limit', async (_event, type: string, limit: number) => {
    resourceScheduler.setLimit(type as any, limit)
    return { success: true }
  })

  // ---- Hub Settings（扩展） ----
  ipcMain.handle('hub:update-setting', async (_event, key: string, value: any) => {
    const settings = await db.getHubSettings()
    settings[key] = value
    await db.setHubSettings(settings)

    // 立即应用变更
    if (key === 'minimizeToTray') {
      windowManager.setMinimizeToTray(!!value)
    }
    if (key === 'autoStartEnabled') {
      autoStartManager.setEnabled(!!value)
    }
    if (key === 'summonHotkey') {
      const old = String(settings.summonHotkey || '')
      hotkeyManager.rebindSummon(String(value), old)
    }
    if (key === 'floatingWidgetEnabled') {
      if (!value) windowManager.closeFloatingWindow()
    }

    return { success: true }
  })
}
