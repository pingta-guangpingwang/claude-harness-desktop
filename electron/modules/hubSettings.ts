import { ipcMain } from 'electron'
import { db } from './database.js'

export function registerHubSettingsIpc() {

  ipcMain.handle('hub:get-settings', async () => {
    try {
      const settings = await db.getHubSettings()
      return { success: true, settings }
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  ipcMain.handle('hub:set-settings', async (_, settings: any) => {
    try {
      await db.setHubSettings(settings)
      return { success: true }
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })
}
