import type { BrowserWindow } from 'electron'

let mainWindow: BrowserWindow | null = null

export function setNotifierWindow(win: BrowserWindow | null) {
  mainWindow = win
}

/** create_project 等工具调用后，推送新项目到渲染层刷新 UI */
export function notifyProjectAdded(projectPath: string, projectName: string) {
  mainWindow?.webContents.send('horsefarm:project-added', projectPath, projectName)
}

/** 项目从列表中移除时通知渲染层 */
export function notifyProjectRemoved(projectPath: string) {
  mainWindow?.webContents.send('horsefarm:project-removed', projectPath)
}
