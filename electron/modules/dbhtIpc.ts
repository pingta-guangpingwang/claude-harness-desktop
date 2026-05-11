import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import * as path from 'path'
import * as fs from 'fs-extra'
import { db } from './database.js'

export function registerDbhtIpc(mainWindow: BrowserWindow | null) {

  ipcMain.handle('dbghf:get-root-path', async () => {
    try {
      const rootPath = await db.getRootPath()
      return { success: true, rootPath }
    } catch { return { success: true, rootPath: '' } }
  })

  ipcMain.handle('dbghf:set-root-path', async (_, rootPath: string) => {
    try {
      await db.setRootPath(rootPath)
      return { success: true }
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  ipcMain.handle('dbghf:browse-folder', async () => {
    if (!mainWindow) return { success: false }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Root Repository',
    })
    return { success: !result.canceled, path: result.filePaths[0] || '' }
  })

  ipcMain.handle('dbghf:browse-individual-project', async () => {
    if (!mainWindow) return { success: false }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Project Directory',
    })
    if (result.canceled || !result.filePaths[0]) return { success: false, path: '' }
    const projectPath = result.filePaths[0]
    return { success: true, path: projectPath, name: path.basename(projectPath) }
  })

  ipcMain.handle('dbghf:list-projects', async (_, rootPath: string) => {
    try {
      const registryPath = path.join(rootPath, 'config', 'projects.json')
      if (!await fs.pathExists(registryPath)) {
        return { success: true, projects: [] }
      }
      const registry: any[] = await fs.readJson(registryPath)
      return {
        success: true,
        projects: registry.map((entry: any) => {
          const primaryCopy = entry.workingCopies && entry.workingCopies.length > 0
            ? entry.workingCopies[0].path
            : ''
          return {
            path: primaryCopy,
            name: entry.name || '',
            repoPath: entry.repoPath || '',
            status: 'synced',
            source: 'dbht-root' as const,
          }
        }),
      }
    } catch (error) {
      return { success: false, projects: [], message: String(error) }
    }
  })

  ipcMain.handle('dbghf:open-folder', async (_, folderPath: string) => {
    try {
      await shell.openPath(folderPath)
      return { success: true }
    } catch { return { success: false } }
  })
}
