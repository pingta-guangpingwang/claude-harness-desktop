import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs-extra'

const DATA_DIR = app.getPath('userData')

function dbPath(name: string): string {
  return path.join(DATA_DIR, `${name}.json`)
}

async function read(name: string, fallback: any = {}): Promise<any> {
  try {
    const p = dbPath(name)
    if (!await fs.pathExists(p)) return fallback
    return await fs.readJson(p)
  } catch { return fallback }
}

async function write(name: string, data: any): Promise<void> {
  await fs.ensureDir(DATA_DIR)
  const tmp = dbPath(name + '.tmp')
  const target = dbPath(name)
  await fs.writeJson(tmp, { ...data, _updatedAt: new Date().toISOString() })
  await fs.move(tmp, target, { overwrite: true })
}

export const db = {
  getConfig: () => read('config', { projectIds: [], apiKeys: [], settings: {} }),
  setConfig: (data: any) => write('config', data),

  getRootPath: async (): Promise<string> => {
    try {
      const p = path.join(DATA_DIR, 'root-path.txt')
      if (!await fs.pathExists(p)) return ''
      return (await fs.readFile(p, 'utf8')).trim()
    } catch { return '' }
  },
  setRootPath: async (rootPath: string): Promise<void> => {
    await fs.ensureDir(DATA_DIR)
    await fs.writeFile(path.join(DATA_DIR, 'root-path.txt'), rootPath, 'utf8')
  },

  getProjectIds: () => read('project-ids', { ids: [], individualProjects: {} }),
  setProjectIds: (data: any) => write('project-ids', data),

  getSetupCompleted: async (): Promise<boolean> => {
    try {
      const p = path.join(DATA_DIR, 'setup-completed.txt')
      if (!await fs.pathExists(p)) return false
      return (await fs.readFile(p, 'utf8')).trim() === '1'
    } catch { return false }
  },
  setSetupCompleted: async (): Promise<void> => {
    await fs.ensureDir(DATA_DIR)
    await fs.writeFile(path.join(DATA_DIR, 'setup-completed.txt'), '1', 'utf8')
  },

  getHubSettings: () => read('hub-settings', {
    minimizeToTray: true,
    autoStartEnabled: false,
    summonHotkey: 'Ctrl+Shift+H',
    floatingWidgetEnabled: true,
    floatingWidgetPosition: { x: 100, y: 100 },
    floatingWidgetSize: { width: 320, height: 480 },
  }),
  setHubSettings: (data: any) => write('hub-settings', data),

  DATA_DIR,
}
