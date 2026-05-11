import { useState, useEffect, useCallback } from 'react'

interface Bookmark {
  id: string
  name: string
  command: string
  args: Record<string, unknown>
  projectPath?: string
  createdAt: string
  usageCount: number
}

interface CommandGroup {
  id: string
  name: string
  bookmarkIds: string[]
  collapsed?: boolean
}

interface FavoritesPanelProps {
  onExecute: (command: string, args: Record<string, unknown>) => void
}

export const FavoritesPanel: React.FC<FavoritesPanelProps> = ({ onExecute }) => {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [groups, setGroups] = useState<CommandGroup[]>([])
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const load = useCallback(() => {
    window.electronAPI.cliBookmarkList().then(r => {
      if (r.success) setBookmarks(r.bookmarks)
    }).catch(() => {})
    window.electronAPI.cliGroupList().then(r => {
      if (r.success) setGroups(r.groups)
    }).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  // 执行收藏的命令
  const handleExecute = (bm: Bookmark) => {
    window.electronAPI.cliBookmarkAdd(bm) // 更新使用计数
    onExecute(bm.command, bm.args)
    load()
  }

  // 删除收藏
  const handleRemove = async (id: string) => {
    await window.electronAPI.cliBookmarkRemove(id)
    load()
  }

  // 创建分组
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return
    await window.electronAPI.cliGroupCreate(newGroupName.trim())
    setNewGroupName('')
    setShowNewGroup(false)
    load()
  }

  // 删除分组
  const handleDeleteGroup = async (id: string) => {
    await window.electronAPI.cliGroupDelete(id)
    load()
  }

  const toggleCollapse = (id: string) => {
    setCollapsed(c => ({ ...c, [id]: !c[id] }))
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      padding: '10px 12px', gap: 10, overflow: 'auto',
    }}>
      {/* 收藏列表 */}
      <div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 8,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--app-text-primary)' }}>⭐ 收藏</span>
        </div>
        {bookmarks.length === 0 ? (
          <div style={{ fontSize: 11, color: '#64748b', padding: 8 }}>
            暂无收藏 — 在命令面板中点击收藏按钮
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {bookmarks.slice(0, 20).map(bm => (
              <div key={bm.id} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
                background: 'var(--app-bg-secondary)', fontSize: 11,
                border: '1px solid var(--app-border-primary)',
              }}
                onClick={() => handleExecute(bm)}
                title={`${bm.command} — 使用 ${bm.usageCount} 次`}
              >
                <span style={{ color: '#f59e0b' }}>⭐</span>
                <span style={{ color: 'var(--app-text-primary)', fontWeight: 500 }}>{bm.name}</span>
                <span style={{ color: '#6366f1', fontSize: 10 }}>{bm.command}</span>
                <span style={{ flex: 1 }} />
                <span style={{ color: '#64748b', fontSize: 9 }}>{bm.usageCount}x</span>
                <button onClick={e => { e.stopPropagation(); handleRemove(bm.id) }} style={{
                  padding: '1px 6px', border: 'none', background: 'transparent',
                  color: '#ef4444', cursor: 'pointer', fontSize: 12,
                }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 分组 */}
      <div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 8,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--app-text-primary)' }}>📁 分组</span>
          <button onClick={() => setShowNewGroup(!showNewGroup)} style={{
            padding: '2px 8px', borderRadius: 4, border: '1px solid var(--app-border-primary)',
            background: 'transparent', color: 'var(--app-text-secondary)',
            cursor: 'pointer', fontSize: 11,
          }}>+</button>
        </div>

        {showNewGroup && (
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            <input
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateGroup()}
              placeholder="分组名称"
              style={{
                flex: 1, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--app-border-input)',
                background: 'var(--app-bg-input)', color: 'var(--app-text-primary)', fontSize: 11,
              }}
            />
            <button onClick={handleCreateGroup} style={{
              padding: '4px 8px', borderRadius: 4, border: 'none',
              background: '#10b981', color: '#fff', cursor: 'pointer', fontSize: 11,
            }}>创建</button>
          </div>
        )}

        {groups.map(g => {
          const groupBookmarks = bookmarks.filter(b => g.bookmarkIds.includes(b.id))
          const isCollapsed = collapsed[g.id]
          return (
            <div key={g.id} style={{ marginBottom: 4 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
                fontSize: 11,
              }} onClick={() => toggleCollapse(g.id)}>
                <span>{isCollapsed ? '▶' : '▼'}</span>
                <span style={{ color: 'var(--app-text-primary)', fontWeight: 500 }}>{g.name}</span>
                <span style={{ color: '#64748b', fontSize: 10 }}>({groupBookmarks.length})</span>
                <span style={{ flex: 1 }} />
                <button onClick={e => { e.stopPropagation(); handleDeleteGroup(g.id) }} style={{
                  padding: '1px 6px', border: 'none', background: 'transparent',
                  color: '#ef4444', cursor: 'pointer', fontSize: 12,
                }}>×</button>
              </div>
              {!isCollapsed && groupBookmarks.map(bm => (
                <div key={bm.id} onClick={() => handleExecute(bm)} style={{
                  padding: '3px 8px 3px 24px', cursor: 'pointer', fontSize: 10,
                  color: 'var(--app-text-secondary)',
                }}>⭐ {bm.name} — {bm.command}</div>
              ))}
            </div>
          )
        })}
      </div>

      {/* 历史 */}
      <HistorySection />
    </div>
  )
}

const HistorySection: React.FC = () => {
  const [entries, setEntries] = useState<Array<{ id: string; command: string; timestamp: string; success: boolean; durationMs: number }>>([])

  useEffect(() => {
    window.electronAPI.cliHistory(20).then(r => {
      if (r.success) setEntries(r.entries)
    }).catch(() => {})
  }, [])

  if (entries.length === 0) return null

  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 8,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--app-text-primary)' }}>🕐 历史</span>
        <button onClick={() => {
          window.electronAPI.cliHistoryClear()
          setEntries([])
        }} style={{
          padding: '2px 8px', borderRadius: 4, border: '1px solid var(--app-border-primary)',
          background: 'transparent', color: 'var(--app-text-secondary)',
          cursor: 'pointer', fontSize: 10,
        }}>清空</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {entries.map(e => (
          <div key={e.id} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '2px 6px', fontSize: 10,
            color: e.success ? 'var(--app-text-secondary)' : '#ef4444',
          }}>
            <span>{e.success ? '✅' : '❌'}</span>
            <span style={{ color: '#6366f1' }}>{e.command}</span>
            <span style={{ flex: 1 }} />
            <span style={{ color: '#64748b', fontSize: 9 }}>
              {new Date(e.timestamp).toLocaleTimeString('zh-CN')} · {e.durationMs}ms
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
