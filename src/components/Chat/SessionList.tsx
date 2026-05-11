import React, { useEffect, useState } from 'react'
import { useChat, type ChatSession } from '../../context/ChatContext'

interface SessionListProps {
  projectPath: string
  onLoad: (session: ChatSession) => void
  onClose: () => void
}

export const SessionList: React.FC<SessionListProps> = ({ projectPath, onLoad, onClose }) => {
  const { listSessions, deleteSession } = useChat()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listSessions(projectPath).then(s => {
      setSessions(s)
      setLoading(false)
    })
  }, [projectPath, listSessions])

  const handleDelete = async (sessionId: string) => {
    await deleteSession(projectPath, sessionId)
    setSessions(prev => prev.filter(s => s.sessionId !== sessionId))
  }

  const formatDate = (iso: string) => {
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
        width: 480, maxWidth: '94vw', maxHeight: '70vh',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
        border: '1px solid var(--app-border-primary)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h4 style={{ margin: 0, fontSize: 15, color: 'var(--app-text-primary)', fontWeight: 600 }}>
            Chat History
          </h4>
          <button onClick={onClose} style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: 18, color: 'var(--app-text-secondary)', padding: '0 4px',
          }}>✕</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--app-text-secondary)', fontSize: 13 }}>
            Loading...
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--app-text-secondary)', fontSize: 13 }}>
            No saved sessions for this project.
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
                onClick={() => { onLoad(s); onClose() }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--app-text-primary)' }}>
                    {s.label || formatDate(s.startedAt)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--app-text-secondary)', marginTop: 2 }}>
                    {formatDate(s.startedAt)} — {messageCount(s)} messages
                    {s.endedAt ? ' (ended)' : ''}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(s.sessionId) }}
                  style={{
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    color: 'var(--app-text-secondary)', fontSize: 14, padding: '4px 8px', borderRadius: 4,
                  }}
                  title="Delete session"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
