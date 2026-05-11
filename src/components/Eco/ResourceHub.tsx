import { useState, useEffect, useMemo } from 'react'
import './Eco.css'

interface ResourceItem {
  id: string
  name: string
  type: 'file' | 'template' | 'config' | 'ai-output'
  projectPath: string
  projectName: string
  relativePath: string
  size?: number
  updatedAt?: string
  tags?: string[]
}

export function ResourceHub() {
  const [resources, setResources] = useState<ResourceItem[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [selected, setSelected] = useState<ResourceItem | null>(null)
  const [loading, setLoading] = useState(false)

  // 扫描项目资源
  useEffect(() => {
    scanResources()
  }, [])

  const scanResources = async () => {
    setLoading(true)
    try {
      // 从 HorseFarm 获取项目列表
      const idsResult = await window.electronAPI.loadHorseFarmProjectIds()
      if (!idsResult.success) { setLoading(false); return }

      const items: ResourceItem[] = []
      const projectIds: string[] = idsResult.ids || []
      const individualProjects = idsResult.individualProjects || {}

      for (const projectPath of projectIds) {
        const projName = individualProjects[projectPath]?.name || projectPath.split('\\').pop() || projectPath

        // 扫描关键资源
        const patterns = [
          { glob: '.dbvs-*', type: 'ai-output' as const },
          { glob: 'KNOWLEDGEBASE.md', type: 'ai-output' as const },
          { glob: '*.md', type: 'file' as const },
          { glob: '.vscode/*.json', type: 'config' as const },
          { glob: '.eslintrc*', type: 'config' as const },
          { glob: 'tsconfig*.json', type: 'config' as const },
        ]

        for (const { glob, type } of patterns) {
          // 尝试读取已知路径
          if (glob === '.dbvs-*') {
            const mmPath = `${projectPath}/.dbvs-mindmap.json`
            const kbPath = `${projectPath}/.dbvs-knowledgebase.md`
            items.push({ id: `${projectPath}_mindmap`, name: 'Mind Map', type: 'ai-output', projectPath, projectName: projName, relativePath: '.dbvs-mindmap.json' })
            items.push({ id: `${projectPath}_kb`, name: 'Knowledge Base', type: 'ai-output', projectPath, projectName: projName, relativePath: '.dbvs-knowledgebase.md' })
          }
          if (glob === 'KNOWLEDGEBASE.md') {
            items.push({ id: `${projectPath}_kb2`, name: 'KNOWLEDGEBASE.md', type: 'ai-output', projectPath, projectName: projName, relativePath: 'KNOWLEDGEBASE.md' })
          }
        }
      }
      setResources(items)
    } catch { /* ignore */ }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    let r = resources
    if (typeFilter !== 'all') r = r.filter(item => item.type === typeFilter)
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(item => item.name.toLowerCase().includes(q) || item.projectName.toLowerCase().includes(q) || item.relativePath.toLowerCase().includes(q))
    }
    return r
  }, [resources, typeFilter, search])

  const handleCopy = async (item: ResourceItem) => {
    try {
      const fullPath = `${item.projectPath}/${item.relativePath}`
      const result = await window.electronAPI.workflowLoad() // reuse IPC to read
      // 使用 cli 读取
      // @ts-ignore
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(fullPath)
        setSelected({ ...item })
      }
    } catch { /* ignore */ }
  }

  const typeLabel = (t: string) => {
    switch (t) {
      case 'file': return 'File'
      case 'template': return 'Template'
      case 'config': return 'Config'
      case 'ai-output': return 'AI Output'
      default: return t
    }
  }

  const typeColor = (t: string) => {
    switch (t) {
      case 'file': return '#94a3b8'
      case 'template': return '#6366f1'
      case 'config': return '#f59e0b'
      case 'ai-output': return '#10b981'
      default: return '#94a3b8'
    }
  }

  return (
    <div className="eco-resource-hub">
      <div className="eco-rh-header">
        <h3>Resource Hub</h3>
        <div className="eco-rh-actions">
          <input
            className="eco-rh-search"
            placeholder="Search resources..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="eco-rh-filter" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="all">All Types</option>
            <option value="file">Files</option>
            <option value="template">Templates</option>
            <option value="config">Configs</option>
            <option value="ai-output">AI Outputs</option>
          </select>
          <button className="eco-btn" onClick={scanResources} disabled={loading}>
            {loading ? 'Scanning...' : 'Rescan'}
          </button>
        </div>
      </div>

      <div className="eco-rh-body">
        <div className="eco-rh-grid">
          {filtered.map(item => (
            <div
              key={item.id}
              className={`eco-rh-card ${selected?.id === item.id ? 'selected' : ''}`}
              onClick={() => handleCopy(item)}
            >
              <div className="eco-rh-card-icon">{typeIcons[item.type] || ''}</div>
              <div className="eco-rh-card-info">
                <div className="eco-rh-card-name">{item.name}</div>
                <div className="eco-rh-card-project">{item.projectName}</div>
                <div className="eco-rh-card-path">{item.relativePath}</div>
              </div>
              <span className="eco-rh-card-type" style={{ color: typeColor(item.type) }}>
                {typeLabel(item.type)}
              </span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="eco-empty">
              {resources.length === 0 ? 'No resources found. Click Rescan to scan projects.' : 'No resources match your filter.'}
            </div>
          )}
        </div>

        {selected && (
          <div className="eco-rh-detail">
            <h5>{selected.name}</h5>
            <div className="eco-rh-detail-row"><label>Project</label><span>{selected.projectName}</span></div>
            <div className="eco-rh-detail-row"><label>Path</label><span>{selected.projectPath}/{selected.relativePath}</span></div>
            <div className="eco-rh-detail-row"><label>Type</label><span style={{ color: typeColor(selected.type) }}>{typeLabel(selected.type)}</span></div>
            <div className="eco-rh-detail-actions">
              <button className="eco-btn" onClick={() => window.electronAPI.openFolder(selected.projectPath)}>Open Project</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const typeIcons: Record<string, string> = {
  'file': '',
  'template': '',
  'config': '',
  'ai-output': '',
}
