import { ipcMain } from 'electron'
import * as path from 'path'
import * as fs from 'fs-extra'
import { db } from './database.js'

function normPath(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').trim()
    .replace(/^([a-z]):/i, (_, d) => d.toUpperCase() + ':')
}

const DESIGN_PATTERNS: Record<string, { label: string; type: string; status: string }> = {
  src: { label: '源代码 (src)', type: 'module', status: 'in_progress' },
  public: { label: '静态资源 (public)', type: 'module', status: 'pending' },
  tests: { label: '测试 (tests)', type: 'module', status: 'pending' },
  test: { label: '测试 (test)', type: 'module', status: 'pending' },
  docs: { label: '文档 (docs)', type: 'file', status: 'pending' },
  config: { label: '配置', type: 'file', status: 'pending' },
  scripts: { label: '脚本 (scripts)', type: 'module', status: 'pending' },
  dist: { label: '构建输出 (dist)', type: 'file', status: 'pending' },
  build: { label: '构建配置 (build)', type: 'file', status: 'pending' },
  components: { label: '组件', type: 'module', status: 'in_progress' },
  pages: { label: '页面', type: 'module', status: 'pending' },
  views: { label: '视图', type: 'module', status: 'pending' },
  routes: { label: '路由', type: 'module', status: 'pending' },
  hooks: { label: 'Hooks', type: 'module', status: 'pending' },
  utils: { label: '工具函数', type: 'module', status: 'pending' },
  services: { label: '服务层', type: 'module', status: 'pending' },
  api: { label: 'API 接口', type: 'module', status: 'pending' },
  store: { label: '状态管理', type: 'module', status: 'pending' },
  context: { label: '上下文', type: 'module', status: 'pending' },
  types: { label: '类型定义', type: 'module', status: 'pending' },
  models: { label: '数据模型', type: 'module', status: 'pending' },
  assets: { label: '资源文件', type: 'module', status: 'pending' },
  styles: { label: '样式', type: 'module', status: 'pending' },
  css: { label: '样式表', type: 'file', status: 'pending' },
}

export function registerHorseFarmIpc() {

  ipcMain.handle('horsefarm:save-data', async (_, projectPath: string, data: { requirements?: string; summary?: string }) => {
    try {
      const hfPath = path.join(projectPath, '.dbvs-horsefarm.json')
      let existing: any = {}
      if (await fs.pathExists(hfPath)) {
        try { existing = await fs.readJson(hfPath) } catch { /* ignore */ }
      }
      if (data.requirements !== undefined) existing.requirements = data.requirements
      if (data.summary !== undefined) existing.summary = data.summary
      existing.updatedAt = new Date().toISOString()
      await fs.writeJson(hfPath, existing, { spaces: 2 })
      return { success: true }
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  ipcMain.handle('horsefarm:load-data', async (_, projectPath: string) => {
    try {
      const hfPath = path.join(projectPath, '.dbvs-horsefarm.json')
      if (!await fs.pathExists(hfPath)) return { success: true, exists: false }
      const data = await fs.readJson(hfPath)
      return { success: true, exists: true, requirements: data.requirements || '', summary: data.summary || '', mindmapPath: data.mindmapPath || '', kbPath: data.kbPath || '' }
    } catch { return { success: true, exists: false } }
  })

  ipcMain.handle('horsefarm:save-notes', async (_, projectPath: string, notes: string) => {
    try {
      const notesPath = path.join(projectPath, '.dbvs-horsefarm-notes.md')
      await fs.writeFile(notesPath, notes, 'utf8')
      return { success: true }
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  ipcMain.handle('horsefarm:load-notes', async (_, projectPath: string) => {
    try {
      const notesPath = path.join(projectPath, '.dbvs-horsefarm-notes.md')
      if (!await fs.pathExists(notesPath)) return { success: true, notes: '' }
      return { success: true, notes: await fs.readFile(notesPath, 'utf8') }
    } catch (error) {
      return { success: false, notes: '', message: String(error) }
    }
  })

  ipcMain.handle('horsefarm:generate-summary', async (_, projectPath: string, requirements: string) => {
    try {
      const files = await fs.readdir(projectPath)
      const visibleFiles = files.filter(f => !f.startsWith('.') && f !== 'node_modules').join(', ')
      const summary = `Project at "${path.basename(projectPath)}" contains: ${visibleFiles || '(empty directory)'}. Requirements: ${requirements.substring(0, 200)}${requirements.length > 200 ? '...' : ''}. This project is ready for development with the Horse Farm system.`
      return { success: true, summary }
    } catch (error) {
      return { success: false, summary: `Project summary generated.`, message: String(error) }
    }
  })

  ipcMain.handle('horsefarm:generate-mindmap', async (_, projectPath: string, summary: string) => {
    try {
      const files = await fs.readdir(projectPath)
      const visibleFiles = files.filter(f => !f.startsWith('.') && f !== 'node_modules' && f !== '__pycache__')
      let counter = 1
      const nextId = () => `mm-${counter++}`

      const buildNode = async (dirPath: string, dirName: string, depth: number): Promise<any> => {
        const pattern = DESIGN_PATTERNS[dirName]
        const nodeType = pattern?.type || (depth === 0 ? 'root' : depth <= 1 ? 'module' : depth <= 2 ? 'task' : 'file')
        const nodeStatus = pattern?.status || 'pending'
        const nodeLabel = pattern?.label || dirName

        const children: any[] = []
        if (depth < 3) {
          try {
            const entries = await fs.readdir(dirPath)
            const dirs: string[] = []
            const importantFiles: string[] = []
            for (const entry of entries.filter(e => !e.startsWith('.') && e !== 'node_modules' && e !== '__pycache__')) {
              const fullPath = path.join(dirPath, entry)
              try {
                const stat = await fs.stat(fullPath)
                if (stat.isDirectory()) dirs.push(entry)
                else if (depth < 2 && ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.vue', '.svelte'].some(ext => entry.endsWith(ext))) importantFiles.push(entry)
              } catch { /* skip */ }
            }
            const sortedDirs = dirs.sort((a, b) => {
              const aKnown = DESIGN_PATTERNS[a] ? 0 : 1
              const bKnown = DESIGN_PATTERNS[b] ? 0 : 1
              if (aKnown !== bKnown) return aKnown - bKnown
              return a.localeCompare(b)
            })
            for (const dir of sortedDirs.slice(0, 12)) {
              children.push(await buildNode(path.join(dirPath, dir), dir, depth + 1))
            }
            for (const file of importantFiles.slice(0, 8)) {
              children.push({ id: nextId(), label: file, type: 'file' as const, status: 'pending' as const, progress: 0, children: [], metadata: { description: `Key file: ${file}` } })
            }
          } catch { /* skip */ }
        }

        return { id: nextId(), label: nodeLabel, type: nodeType, status: nodeStatus, progress: 0, children, metadata: depth === 0 ? { description: summary || 'Project root' } : depth === 1 ? { description: `Module: ${nodeLabel}` } : undefined }
      }

      const projectTypes: string[] = []
      for (const f of visibleFiles) {
        if (f === 'package.json') {
          try {
            const pkg = await fs.readJson(path.join(projectPath, f))
            if (pkg.dependencies?.react) projectTypes.push('React')
            if (pkg.dependencies?.vue) projectTypes.push('Vue')
            if (pkg.dependencies?.next) projectTypes.push('Next.js')
            if (pkg.dependencies?.electron) projectTypes.push('Electron')
            if (pkg.devDependencies?.typescript) projectTypes.push('TypeScript')
            if (pkg.devDependencies?.vite) projectTypes.push('Vite')
          } catch { /* ignore */ }
        }
        if (f === 'tsconfig.json') projectTypes.push('TypeScript')
        if (f.endsWith('.py')) projectTypes.push('Python')
        if (f === 'Cargo.toml') projectTypes.push('Rust')
        if (f === 'go.mod') projectTypes.push('Go')
      }
      const techStack = [...new Set(projectTypes)].join(' + ') || 'Unknown'

      const rootChildren: any[] = []
      if (projectTypes.length > 0) {
        rootChildren.push({
          id: nextId(), label: '技术栈', type: 'module' as const, status: 'completed' as const, progress: 100,
          children: [...new Set(projectTypes)].map(t => ({ id: nextId(), label: t, type: 'concept' as const, status: 'completed' as const, progress: 100, children: [], metadata: { description: `Technology: ${t}` } })),
          metadata: { description: `Detected: ${techStack}` },
        })
      }

      const hasSrc = visibleFiles.includes('src')
      if (hasSrc) {
        const srcNode = await buildNode(path.join(projectPath, 'src'), 'src', 1)
        srcNode.label = '源代码架构 (src)'
        srcNode.type = 'module'
        srcNode.status = 'in_progress'
        rootChildren.push(srcNode)
      }

      for (const f of visibleFiles) {
        const fullPath = path.join(projectPath, f)
        try {
          const stat = await fs.stat(fullPath)
          if (stat.isDirectory() && f !== 'src' && f !== 'node_modules') {
            const node = await buildNode(fullPath, f, 1)
            if (DESIGN_PATTERNS[f]) { node.label = DESIGN_PATTERNS[f].label; node.type = DESIGN_PATTERNS[f].type }
            rootChildren.push(node)
          }
        } catch { /* ignore */ }
      }

      const configFiles = ['package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js', 'webpack.config.js', '.eslintrc.js', 'tailwind.config.js', 'Dockerfile', 'docker-compose.yml', 'Makefile', 'README.md', 'CHANGELOG.md']
      const foundConfigs = visibleFiles.filter(f => configFiles.includes(f))
      if (foundConfigs.length > 0) {
        rootChildren.push({
          id: nextId(), label: '配置文件', type: 'module' as const, status: 'pending' as const, progress: 100,
          children: foundConfigs.map(f => ({ id: nextId(), label: f, type: 'file' as const, status: 'completed' as const, progress: 100, children: [], metadata: { description: `Config: ${f}` } })),
          metadata: { description: 'Key configuration files' },
        })
      }

      if (summary && summary.length > 10) {
        rootChildren.push({
          id: nextId(), label: '开发阶段', type: 'module' as const, status: 'in_progress' as const, progress: 25,
          children: [
            { id: nextId(), label: '环境搭建与配置', type: 'task' as const, status: 'completed' as const, progress: 100, children: [] },
            { id: nextId(), label: '核心模块开发', type: 'task' as const, status: 'in_progress' as const, progress: 30, children: [] },
            { id: nextId(), label: '测试与质量保障', type: 'task' as const, status: 'pending' as const, progress: 0, children: [] },
            { id: nextId(), label: '文档与部署', type: 'task' as const, status: 'pending' as const, progress: 0, children: [] },
          ],
        })
      }

      const mindMapData = {
        schema: 1 as const, projectName: path.basename(projectPath), generatedAt: new Date().toISOString(),
        rootNode: { id: 'root', label: path.basename(projectPath), type: 'root' as const, status: 'in_progress' as const, progress: 0, children: rootChildren },
      }

      const mindmapPath = path.join(projectPath, '.dbvs-mindmap.json')
      await fs.writeJson(mindmapPath, mindMapData, { spaces: 2 })

      const hfPath = path.join(projectPath, '.dbvs-horsefarm.json')
      let hfData: any = {}
      if (await fs.pathExists(hfPath)) { try { hfData = await fs.readJson(hfPath) } catch { /* ignore */ } }
      hfData.mindmapPath = mindmapPath; hfData.updatedAt = new Date().toISOString()
      await fs.writeJson(hfPath, hfData, { spaces: 2 })

      return { success: true, filePath: mindmapPath, data: mindMapData }
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  ipcMain.handle('horsefarm:generate-kb', async (_, projectPath: string, projectName: string, summary: string, requirements: string) => {
    try {
      let fileTree = ''
      try {
        const files = await fs.readdir(projectPath)
        fileTree = files.filter(f => !f.startsWith('.') && f !== 'node_modules').map(f => `- ${f}`).join('\n')
      } catch { fileTree = '(unable to scan)' }

      const kbContent = `# ${projectName} — Knowledge Base\n\n## Project Overview\n${summary}\n\n## Requirements\n${requirements || '*(No requirements specified yet)*'}\n\n## Project Structure\n${fileTree || '*(Empty project)*'}\n\n## Development Timeline\n- **${new Date().toISOString().split('T')[0]}**: Project added to Horse Farm\n\n## Design Decisions\n*(To be populated during development)*\n\n## Notes\nThis knowledge base is auto-generated by Claude Harness Desktop.\nUpdate it as the project evolves.\n`
      const kbPath = path.join(projectPath, 'DBHT-KNOWLEDGEBASE.md')
      await fs.writeFile(kbPath, kbContent, 'utf8')

      const hfPath = path.join(projectPath, '.dbvs-horsefarm.json')
      let hfData: any = {}
      if (await fs.pathExists(hfPath)) { try { hfData = await fs.readJson(hfPath) } catch { /* ignore */ } }
      hfData.kbPath = kbPath; hfData.updatedAt = new Date().toISOString()
      await fs.writeJson(hfPath, hfData, { spaces: 2 })

      return { success: true, filePath: kbPath }
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  ipcMain.handle('horsefarm:read-mindmap', async (_, filePath: string) => {
    try {
      if (!await fs.pathExists(filePath)) return { success: false, message: 'Mind map file not found' }
      return { success: true, data: await fs.readJson(filePath) }
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  ipcMain.handle('horsefarm:read-kb', async (_, projectPath: string) => {
    try {
      const kbPath = path.join(projectPath, 'DBHT-KNOWLEDGEBASE.md')
      if (!await fs.pathExists(kbPath)) return { success: false, message: 'Knowledge base not found' }
      return { success: true, content: await fs.readFile(kbPath, 'utf8') }
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  ipcMain.handle('horsefarm:initialize-all', async (_, projects: Array<{ path: string; name: string }>) => {
    const results: Array<{ path: string; name: string; kb: string; mindmap: string }> = []
    for (const proj of projects) {
      const result: any = { path: proj.path, name: proj.name, kb: 'skipped', mindmap: 'skipped' }
      try {
        const kbPath = path.join(proj.path, 'DBHT-KNOWLEDGEBASE.md')
        const mindmapPath = path.join(proj.path, '.dbvs-mindmap.json')
        const hfPath = path.join(proj.path, '.dbvs-horsefarm.json')
        let hfData: any = {}
        if (await fs.pathExists(hfPath)) { try { hfData = await fs.readJson(hfPath) } catch { /* ignore */ } }

        if (await fs.pathExists(kbPath)) {
          result.kb = 'exists'
        } else {
          try {
            const files = await fs.readdir(proj.path)
            const fileTree = files.filter(f => !f.startsWith('.') && f !== 'node_modules').map(f => `- ${f}`).join('\n')
            const kbContent = `# ${proj.name} — Knowledge Base\n\n## Project Overview\nAuto-generated knowledge base for ${proj.name}.\n\n## Project Structure\n${fileTree || '*(Empty project)*'}\n\n## Notes\nThis knowledge base is auto-generated by Claude Harness Desktop.\n`
            await fs.writeFile(kbPath, kbContent, 'utf8')
            result.kb = 'generated'
            hfData.kbPath = kbPath; hfData.updatedAt = new Date().toISOString()
            await fs.writeJson(hfPath, hfData, { spaces: 2 })
          } catch (err) { result.kb = 'failed: ' + String(err) }
        }

        if (await fs.pathExists(mindmapPath)) {
          result.mindmap = 'exists'
        } else {
          try {
            const files = await fs.readdir(proj.path)
            const visible = files.filter(f => !f.startsWith('.') && f !== 'node_modules')
            const moduleNodes: any[] = []
            for (const f of visible) {
              const fullPath = path.join(proj.path, f)
              try {
                const stat = await fs.stat(fullPath)
                moduleNodes.push({ id: `mm-${f}`, label: f, type: stat.isDirectory() ? 'module' : 'file', status: 'pending', progress: 0, children: [] })
              } catch { /* skip */ }
            }
            const mindMapData = { schema: 1 as const, projectName: proj.name, generatedAt: new Date().toISOString(), rootNode: { id: 'root', label: proj.name, type: 'root' as const, status: 'in_progress' as const, progress: 0, children: moduleNodes } }
            await fs.writeJson(mindmapPath, mindMapData, { spaces: 2 })
            result.mindmap = 'generated'
            hfData.mindmapPath = mindmapPath; hfData.updatedAt = new Date().toISOString()
            await fs.writeJson(hfPath, hfData, { spaces: 2 })
          } catch (err) { result.mindmap = 'failed: ' + String(err) }
        }
      } catch { result.kb = 'error'; result.mindmap = 'error' }
      results.push(result)
    }
    return { success: true, results }
  })

  ipcMain.handle('horsefarm:save-config', async (_, config: any) => {
    try {
      await db.setConfig(config)
      return { success: true }
    } catch (error) { return { success: false, message: String(error) } }
  })

  ipcMain.handle('horsefarm:load-config', async () => {
    try {
      const config = await db.getConfig()
      if (!config.settings) {
        config.settings = { defaultModel: 'deepseek-v4-pro', defaultTemperature: 0.7, defaultMaxTokens: 4096, pollingIntervalMs: 5000, maxConcurrentTasks: 3 }
      }
      return { success: true, config }
    } catch {
      return { success: true, config: { projectIds: [], apiKeys: [], settings: { defaultModel: 'deepseek-v4-pro', defaultTemperature: 0.7, defaultMaxTokens: 4096, pollingIntervalMs: 5000, maxConcurrentTasks: 3 } } }
    }
  })

  ipcMain.handle('horsefarm:save-project-ids', async (_, ids: string[], individualProjects?: Record<string, any>) => {
    try {
      // 归一化路径再存储，确保与 PTY 会话 key 一致
      const normalizedIds = ids.map(id => normPath(id))
      await db.setProjectIds({ ids: normalizedIds, individualProjects: individualProjects || {} })
      return { success: true }
    } catch { return { success: false } }
  })

  ipcMain.handle('horsefarm:load-project-ids', async () => {
    try {
      const data = await db.getProjectIds()
      const rawIds = Array.isArray(data.ids) ? data.ids : []
      // 归一化已存储的路径（兼容旧数据中未归一化的路径）
      const normalizedIds = rawIds.map(id => normPath(id))
      return { success: true, ids: normalizedIds, individualProjects: data.individualProjects || {} }
    } catch { return { success: true, ids: [], individualProjects: {} } }
  })
}
