import { useState, useMemo, useEffect, useRef } from 'react'
import './Hub.css'

interface QuickItem {
  id: string
  label: string
  description: string
  icon: string
  action: () => void
  category: string
}

export function QuickCommandPalette({ compact }: { compact?: boolean }) {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const [projectIds, setProjectIds] = useState<string[]>([])
  const [projectNames, setProjectNames] = useState<Record<string, string>>({})

  useEffect(() => {
    inputRef.current?.focus()
    loadProjects()
  }, [])

  const loadProjects = async () => {
    const result = await window.electronAPI.loadHorseFarmProjectIds()
    if (result.success) {
      const ids = result.ids || []
      setProjectIds(ids)
      const names: Record<string, string> = {}
      for (const id of ids) {
        names[id] = (result.individualProjects?.[id] as any)?.name || id.split('\\').pop() || id
      }
      setProjectNames(names)
    }
  }

  const items = useMemo<QuickItem[]>(() => {
    const list: QuickItem[] = []

    // 项目操作
    for (const id of projectIds.slice(0, 8)) {
      const name = projectNames[id] || id.split('\\').pop() || id
      list.push({
        id: `project:${id}`,
        label: `Open ${name}`,
        description: id,
        icon: '',
        action: () => window.electronAPI.openFolder(id),
        category: 'Projects',
      })
      list.push({
        id: `terminal:${id}`,
        label: `Terminal → ${name}`,
        description: `Attach PTY to ${name}`,
        icon: '',
        action: () => window.electronAPI.ptySpawn(id),
        category: 'Projects',
      })
    }

    // 快捷命令
    list.push(
      { id: 'check_status', label: 'Check All Status', description: 'Check heartbeat of all projects', icon: '', action: () => runCli('check_status', {}), category: 'Commands' },
      { id: 'wake_projects', label: 'Wake All Projects', description: 'Start terminals for all projects', icon: '', action: () => runCli('wake_projects', {}), category: 'Commands' },
      { id: 'git_status', label: 'Git Status', description: 'Show git status for active project', icon: '', action: () => runCli('git_status', {}), category: 'Commands' },
      { id: 'broadcast', label: 'Broadcast Command', description: 'Send a command to all projects', icon: '', action: () => runCli('broadcast', {}), category: 'Commands' },
      { id: 'read_file', label: 'Read File', description: 'Read a file from a project', icon: '', action: () => runCli('read_file', {}), category: 'Commands' },
      { id: 'write_file', label: 'Write File', description: 'Write content to a project file', icon: '', action: () => runCli('write_file', {}), category: 'Commands' },
    )

    // 导航
    list.push(
      { id: 'nav_settings', label: 'Open Settings', description: 'Configure API keys and preferences', icon: '', action: () => {}, category: 'Navigation' },
      { id: 'nav_plugins', label: 'Plugin Store', description: 'Browse and install plugins', icon: '', action: () => {}, category: 'Navigation' },
      { id: 'nav_workflow', label: 'Workflow Editor', description: 'Create and manage workflows', icon: '', action: () => {}, category: 'Navigation' },
    )

    return list
  }, [projectIds, projectNames])

  const filtered = useMemo(() => {
    if (!query) return items
    const q = query.toLowerCase()
    return items.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    )
  }, [items, query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[selectedIdx]) {
        filtered[selectedIdx].action()
        setQuery('')
      }
    } else if (e.key === 'Escape') {
      setQuery('')
      inputRef.current?.blur()
    }
  }

  const runCli = (command: string, args: Record<string, unknown>) => {
    window.electronAPI.cliExecute({
      command,
      args,
      projectIds,
      projectNames,
    }).catch(() => {})
  }

  const categories = [...new Set(filtered.map(i => i.category))]

  return (
    <div className={`qcp-container ${compact ? 'qcp-compact' : ''}`}>
      <div className="qcp-search-bar">
        <span className="qcp-search-icon"></span>
        <input
          ref={inputRef}
          className="qcp-search-input"
          type="text"
          placeholder={compact ? 'Type a command...' : 'Search commands, projects, settings...'}
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedIdx(0) }}
          onKeyDown={handleKeyDown}
        />
      </div>

      {query && filtered.length === 0 && (
        <div className="qcp-empty">No results for "{query}"</div>
      )}

      <div className="qcp-results">
        {categories.map(cat => {
          const catItems = filtered.filter(i => i.category === cat)
          return (
            <div key={cat} className="qcp-category">
              <div className="qcp-cat-label">{cat}</div>
              {catItems.map((item, i) => {
                const globalIdx = filtered.indexOf(item)
                return (
                  <div
                    key={item.id}
                    className={`qcp-item ${globalIdx === selectedIdx ? 'selected' : ''}`}
                    onClick={() => { item.action(); setQuery('') }}
                    onMouseEnter={() => setSelectedIdx(globalIdx)}
                  >
                    <span className="qcp-item-icon">{item.icon}</span>
                    <div className="qcp-item-info">
                      <div className="qcp-item-label">{item.label}</div>
                      <div className="qcp-item-desc">{item.description}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
