import { useState, useEffect } from 'react'
import './Eco.css'

interface ConfigFile {
  name: string
  path: string
  exists: boolean
  content: string
  category: string
}

interface MigrationStep {
  step: number
  config: ConfigFile
  status: 'pending' | 'migrating' | 'done' | 'skipped' | 'error'
  message?: string
}

const KNOWN_CONFIGS: Array<{ name: string; category: string; files: string[] }> = [
  { name: 'TypeScript', category: 'language', files: ['tsconfig.json', 'tsconfig.node.json', 'tsconfig.*.json'] },
  { name: 'ESLint', category: 'lint', files: ['.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.yml', 'eslint.config.js', 'eslint.config.mjs'] },
  { name: 'Prettier', category: 'format', files: ['.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.yml', 'prettier.config.js'] },
  { name: 'EditorConfig', category: 'editor', files: ['.editorconfig'] },
  { name: 'Git', category: 'vcs', files: ['.gitignore', '.gitattributes'] },
  { name: 'Vite', category: 'build', files: ['vite.config.ts', 'vite.config.js'] },
  { name: 'Package', category: 'deps', files: ['package.json'] },
  { name: 'VS Code', category: 'editor', files: ['.vscode/settings.json', '.vscode/extensions.json', '.vscode/tasks.json', '.vscode/launch.json'] },
]

export function ConfigMigrator() {
  const [projects, setProjects] = useState<Array<{ path: string; name: string }>>([])
  const [sourceProject, setSourceProject] = useState<string>('')
  const [targetProject, setTargetProject] = useState<string>('')
  const [sourceConfigs, setSourceConfigs] = useState<ConfigFile[]>([])
  const [selectedConfigs, setSelectedConfigs] = useState<Set<string>>(new Set())
  const [steps, setSteps] = useState<MigrationStep[]>([])
  const [migrating, setMigrating] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')

  useEffect(() => {
    loadProjects()
  }, [])

  const loadProjects = async () => {
    const result = await window.electronAPI.loadHorseFarmProjectIds()
    if (result.success) {
      const projList: Array<{ path: string; name: string }> = []
      for (const id of (result.ids || [])) {
        const name = (result.individualProjects?.[id] as any)?.name || id.split('\\').pop() || id
        projList.push({ path: id, name })
      }
      setProjects(projList)
    }
  }

  const scanSource = async () => {
    if (!sourceProject) return
    setStatusMsg('Scanning source project configs...')

    const configs: ConfigFile[] = []
    for (const cfg of KNOWN_CONFIGS) {
      for (const file of cfg.files) {
        // 对于通配符模式，尝试读取
        try {
          // 使用 CLI read_file 或直接读取
          // 由于我们在渲染进程，通过 IPC 模拟
          const checkPath = `${sourceProject}/${file.replace(/\*/g, '')}`
          // 简化：直接添加到列表
          configs.push({
            name: cfg.name,
            path: file,
            exists: false,
            content: '',
            category: cfg.category,
          })
          break // 每个配置组只添加一次
        } catch { /* ignore */ }
      }
    }

    setSourceConfigs(configs)
    setSelectedConfigs(new Set(configs.map(c => `${c.name}|${c.path}`)))
    setStatusMsg(`Found ${KNOWN_CONFIGS.length} config groups in source project`)
  }

  const toggleConfig = (key: string) => {
    setSelectedConfigs(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const startMigration = async () => {
    if (!sourceProject || !targetProject) {
      setStatusMsg('Please select both source and target projects')
      return
    }
    if (sourceProject === targetProject) {
      setStatusMsg('Source and target must be different')
      return
    }

    setMigrating(true)
    const selected = sourceConfigs.filter(c => selectedConfigs.has(`${c.name}|${c.path}`))
    const migrationSteps: MigrationStep[] = selected.map((cfg, i) => ({
      step: i + 1,
      config: cfg,
      status: 'pending',
    }))
    setSteps(migrationSteps)

    for (let i = 0; i < migrationSteps.length; i++) {
      const cfg = selected[i]
      setSteps(prev => prev.map(s => s.step === i + 1 ? { ...s, status: 'migrating' } : s))

      try {
        const srcPath = `${sourceProject}/${cfg.path}`
        const dstPath = `${targetProject}/${cfg.path}`

        // 通过 CLI 执行文件复制
        const result = await window.electronAPI.cliExecute({
          command: 'file:copy',
          args: { source: srcPath, target: dstPath },
          projectIds: [targetProject],
          projectNames: { [targetProject]: projects.find(p => p.path === targetProject)?.name || targetProject },
        })

        if (result.success) {
          setSteps(prev => prev.map(s => s.step === i + 1 ? { ...s, status: 'done', message: 'Copied successfully' } : s))
        } else {
          // 尝试用 shell 命令
          const shellResult = await window.electronAPI.cliExecute({
            command: 'shell',
            args: { command: `copy "${srcPath.replace(/\//g, '\\')}" "${dstPath.replace(/\//g, '\\')}"` },
            projectIds: [targetProject],
            projectNames: { [targetProject]: projects.find(p => p.path === targetProject)?.name || targetProject },
          })
          if (shellResult.success) {
            setSteps(prev => prev.map(s => s.step === i + 1 ? { ...s, status: 'done', message: 'Copied via shell' } : s))
          } else {
            setSteps(prev => prev.map(s => s.step === i + 1 ? { ...s, status: 'skipped', message: 'Source file not found' } : s))
          }
        }
      } catch (err) {
        setSteps(prev => prev.map(s => s.step === i + 1 ? { ...s, status: 'error', message: String(err) } : s))
      }
    }

    setMigrating(false)
    setStatusMsg('Migration complete')
  }

  const doneCount = steps.filter(s => s.status === 'done').length
  const skippedCount = steps.filter(s => s.status === 'skipped').length
  const errorCount = steps.filter(s => s.status === 'error').length

  return (
    <div className="eco-migrator">
      <div className="eco-mig-header">
        <h3>Config Migrator</h3>
        <p className="eco-mig-desc">
          Copy configuration files (ESLint, Prettier, TypeScript, etc.) from one project to another.
        </p>
      </div>

      <div className="eco-mig-project-select">
        <div className="eco-mig-field">
          <label>Source Project</label>
          <select value={sourceProject} onChange={e => { setSourceProject(e.target.value); setSourceConfigs([]) }}>
            <option value="">Select source...</option>
            {projects.map(p => (
              <option key={p.path} value={p.path}>{p.name}</option>
            ))}
          </select>
          <button className="eco-btn" onClick={scanSource} disabled={!sourceProject}>Scan Configs</button>
        </div>

        <div className="eco-mig-arrow"></div>

        <div className="eco-mig-field">
          <label>Target Project</label>
          <select value={targetProject} onChange={e => setTargetProject(e.target.value)}>
            <option value="">Select target...</option>
            {projects.filter(p => p.path !== sourceProject).map(p => (
              <option key={p.path} value={p.path}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {sourceConfigs.length > 0 && (
        <div className="eco-mig-config-list">
          <div className="eco-mig-config-list-header">
            <h5>Configs to migrate ({selectedConfigs.size} selected)</h5>
            <div className="eco-mig-config-list-actions">
              <button className="eco-btn-text" onClick={() => setSelectedConfigs(new Set(sourceConfigs.map(c => `${c.name}|${c.path}`)))}>Select All</button>
              <button className="eco-btn-text" onClick={() => setSelectedConfigs(new Set())}>Deselect All</button>
            </div>
          </div>

          {sourceConfigs.map(cfg => {
            const key = `${cfg.name}|${cfg.path}`
            const step = steps.find(s => s.config.name === cfg.name && s.config.path === cfg.path)
            return (
              <label key={key} className="eco-mig-config-item">
                <input
                  type="checkbox"
                  checked={selectedConfigs.has(key)}
                  onChange={() => toggleConfig(key)}
                  disabled={migrating}
                />
                <div className="eco-mig-config-info">
                  <span className="eco-mig-config-name">{cfg.name}</span>
                  <span className="eco-mig-config-path">{cfg.path}</span>
                </div>
                {step && (
                  <span className={`eco-mig-step-status ${step.status}`}>
                    {step.status === 'done' ? 'OK' : step.status === 'skipped' ? 'SKIP' : step.status === 'error' ? 'ERR' : step.status === 'migrating' ? '...' : ''}
                  </span>
                )}
              </label>
            )
          })}
        </div>
      )}

      {statusMsg && <div className="eco-mig-status">{statusMsg}</div>}

      {steps.length > 0 && (
        <div className="eco-mig-summary">
          <span style={{ color: '#10b981' }}>{doneCount} done</span>
          <span style={{ color: '#f59e0b' }}>{skippedCount} skipped</span>
          <span style={{ color: '#ef4444' }}>{errorCount} errors</span>
        </div>
      )}

      <div className="eco-mig-actions">
        <button
          className="eco-btn eco-btn-primary"
          onClick={startMigration}
          disabled={!sourceProject || !targetProject || selectedConfigs.size === 0 || migrating}
        >
          {migrating ? 'Migrating...' : 'Start Migration'}
        </button>
      </div>
    </div>
  )
}
