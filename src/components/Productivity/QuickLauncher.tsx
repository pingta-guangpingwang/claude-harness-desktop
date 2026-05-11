import { useState, useEffect, useCallback, useRef } from 'react'

interface LauncherItem {
  id: string; type: 'command' | 'project' | 'plugin' | 'template' | 'setting'
  label: string; description: string; action: () => void
}

interface QuickLauncherProps {
  projects: Array<{ path: string; name: string }>
  commands: Array<{ name: string; description: string }>
  onClose: () => void
}

export const QuickLauncher: React.FC<QuickLauncherProps> = ({ projects, commands, onClose }) => {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const items: LauncherItem[] = [
    ...projects.map(p => ({
      id: p.path, type: 'project' as const,
      label: p.name, description: p.path,
      action: () => { window.electronAPI.openFolder(p.path); onClose() },
    })),
    ...commands.map(c => ({
      id: c.name, type: 'command' as const,
      label: c.name, description: c.description,
      action: () => {
        window.electronAPI.cliExecute({
          command: c.name, args: {}, projectIds: [],
          projectNames: {},
        })
        onClose()
      },
    })),
    { id: 'plugins', type: 'setting', label: '插件管理', description: '管理已安装的插件', action: onClose },
    { id: 'settings', type: 'setting', label: '设置', description: '应用设置', action: onClose },
    { id: 'identity', type: 'setting', label: '身份档案', description: '查看角色与成就', action: onClose },
  ]

  const filtered = query
    ? items.filter(item =>
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        item.description.toLowerCase().includes(query.toLowerCase())
      )
    : items

  const clamped = Math.min(selectedIdx, Math.max(0, filtered.length - 1))

  const selectItem = useCallback((item: LauncherItem) => {
    item.action()
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx(prev => Math.min(prev + 1, filtered.length - 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx(prev => Math.max(prev - 1, 0))
      }
      if (e.key === 'Enter' && filtered[clamped]) {
        selectItem(filtered[clamped])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, filtered, clamped, selectItem])

  const typeBadge = (type: string) => {
    const colors: Record<string, string> = {
      command: '#6366f1', project: '#10b981', plugin: '#f59e0b',
      template: '#ec4899', setting: '#6b7280',
    }
    return colors[type] || '#6b7280'
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', justifyContent: 'center', paddingTop: '15vh', zIndex: 2000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#1e1e2e', borderRadius: '12px', border: '1px solid #333',
          width: '580px', maxHeight: '480px', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #333' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(0) }}
            placeholder="搜索命令、项目、模板..."
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              color: '#e0e0e0', fontSize: '18px', fontFamily: 'inherit',
            }}
          />
        </div>
        <div style={{ maxHeight: '380px', overflow: 'auto', padding: '6px' }}>
          {filtered.length === 0 ? (
            <div style={{ color: '#666', textAlign: 'center', padding: '24px' }}>无结果</div>
          ) : (
            filtered.map((item, i) => (
              <div
                key={item.id}
                onClick={() => selectItem(item)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '8px 14px', borderRadius: '6px',
                  background: i === clamped ? '#2a2a3e' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <span style={{
                  padding: '2px 6px', borderRadius: '4px', fontSize: '10px',
                  background: typeBadge(item.type) + '22', color: typeBadge(item.type),
                  fontWeight: 600, flexShrink: 0, minWidth: '50px', textAlign: 'center',
                }}>
                  {item.type}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#e0e0e0', fontSize: '14px' }}>{item.label}</div>
                  <div style={{ color: '#888', fontSize: '11px' }}>{item.description}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
