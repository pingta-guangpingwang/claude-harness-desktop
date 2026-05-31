import React, { useEffect, useState } from 'react'
import { useChat, type ChatSession } from '../../context/ChatContext'

interface SessionListProps {
  projectPath: string
  allProjectPaths?: string[]
  onLoad: (session: ChatSession) => void
  onClose: () => void
}

export const SessionList: React.FC<SessionListProps> = ({ projectPath, allProjectPaths, onLoad, onClose }) => {
  const { listSessions, listAllProjectSessions, deleteSession } = useChat()
  const [sessions, setSessions] = useState<Array<ChatSession & { projectName?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [viewAll, setViewAll] = useState(false)

  useEffect(() => {
    setLoading(true)
    if (viewAll && allProjectPaths && allProjectPaths.length > 0) {
      listAllProjectSessions(allProjectPaths).then(s => {
        setSessions(s)
        setLoading(false)
      })
    } else {
      listSessions(projectPath).then(s => {
        setSessions(s)
        setLoading(false)
      })
    }
  }, [projectPath, viewAll, allProjectPaths, listSessions, listAllProjectSessions])

  const handleDelete = async (projPath: string, sessionId: string) => {
    await deleteSession(projPath, sessionId)
    setSessions(prev => prev.filter(s => s.sessionId !== sessionId))
  }

  const formatDate = (iso: string) => {
    if (!iso) return '-'
    const d = new Date(iso)
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
      + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  const messageCount = (s: ChatSession) => s.messages.filter(m => m.role !== 'system').length

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.3)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--app-bg-secondary)', borderRadius: 12, padding: 20,
        width: 520, maxWidth: '94vw', maxHeight: '75vh',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
        border: '1px solid var(--app-border-primary)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h4 style={{ margin: 0, fontSize: 15, color: 'var(--app-text-primary)', fontWeight: 600 }}>
            Chat History
          </h4>
          <button onClick={onClose} style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: 18, color: 'var(--app-text-secondary)', padding: '0 4px',
          }}>x</button>
        </div>

        {/* 视图切换 */}
        {allProjectPaths && allProjectPaths.length > 1 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button onClick={() => setViewAll(false)} style={{
              padding: '4px 12px', borderRadius: 6, border: '1px solid var(--app-border-primary)',
              background: !viewAll ? 'var(--app-accent)' : 'transparent',
              color: !viewAll ? '#fff' : 'var(--app-text-secondary)',
              cursor: 'pointer', fontSize: 12, fontWeight: !viewAll ? 600 : 400,
            }}>
              当前项目
            </button>
            <button onClick={() => setViewAll(true)} style={{
              padding: '4px 12px', borderRadius: 6, border: '1px solid var(--app-border-primary)',
              background: viewAll ? 'var(--app-accent)' : 'transparent',
              color: viewAll ? '#fff' : 'var(--app-text-secondary)',
              cursor: 'pointer', fontSize: 12, fontWeight: viewAll ? 600 : 400,
            }}>
              全部项目 ({allProjectPaths.length})
            </button>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--app-text-secondary)', fontSize: 13 }}>
            Loading...
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--app-text-secondary)', fontSize: 13 }}>
            {viewAll ? '所有项目暂无保存的会话' : 'No saved sessions for this project.'}
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'auto' }}>
            {sessions.map(s => (
              <div
                key={s.sessionId}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 8,
                  border: '1px solid var(--app-border-primary)', marginBottom: 8,
                  cursor: 'pointer', background: 'var(--app-bg-tertiary)',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--app-bg-input)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--app-bg-tertiary)')}
                onClick={() => { onLoad(s as ChatSession); onClose() }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {viewAll && (s as any).projectName && (
                      <span style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 3,
                        background: '#7c3aed18', color: '#a78bfa',
                        fontWeight: 500, flexShrink: 0,
                      }}>
                        {(s as any).projectName}
                      </span>
                    )}
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--app-text-primary)' }}>
                      {s.label || formatDate(s.startedAt)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--app-text-secondary)', marginTop: 2 }}>
                    {formatDate(s.startedAt)} — {messageCount(s)} messages
                    {s.endedAt ? ' (ended)' : ''}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(s.projectPath, s.sessionId) }}
                  style={{
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    color: 'var(--app-text-secondary)', fontSize: 14, padding: '4px 8px', borderRadius: 4,
                  }}
                  title="Delete session"
                >
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
