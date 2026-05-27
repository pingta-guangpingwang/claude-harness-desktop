import { useState, useEffect, useCallback } from 'react'
import { useI18n } from '../../i18n'
import type { AuditEvent } from '../../types/audit'
import { SafeText } from './SafeText'

interface AuditPanelProps {
  projectPath: string
  embedded?: boolean
}

const outcomeColors: Record<string, { bg: string; text: string }> = {
  success: { bg: '#d1fae5', text: '#065f46' },
  failure: { bg: '#fee2e2', text: '#991b1b' },
  blocked: { bg: '#fef3c7', text: '#92400e' },
  unknown: { bg: '#f3f4f6', text: '#6b7280' },
}

const actionIcons: Record<string, string> = {
  'file.read': '📖',
  'file.write': '✏️',
  'command.executed': '⚡',
  'agent.registered': '🔗',
  'request.intercepted': '🛡️',
}

export default function AuditPanel({ projectPath }: AuditPanelProps) {
  const { t } = useI18n()
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'success' | 'failure'>('all')
  const [autoRefresh, setAutoRefresh] = useState(true)

  const projectName = projectPath.split('\\').pop() || projectPath.split('/').pop() || projectPath

  const fetchEvents = useCallback(async () => {
    try {
      const result = await window.electronAPI.auditGetProjectEvents(projectPath)
      if (result.success) {
        setEvents(result.events || [])
        setError('')
      } else {
        setError(result.message || '读取审计数据失败')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    setLoading(true)
    fetchEvents()
  }, [fetchEvents])

  // 自动刷新 (每10秒)
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(fetchEvents, 10000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchEvents])

  const filtered = filter === 'all'
    ? events
    : events.filter(e => e.outcome === filter)

  const stats = {
    total: events.length,
    success: events.filter(e => e.outcome === 'success').length,
    failure: events.filter(e => e.outcome === 'failure').length,
  }

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch { return ts }
  }

  const formatDate = (ts: string) => {
    try {
      return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    } catch { return '' }
  }

  const toolLabel = (e: AuditEvent) => e.metadata?.tool || e.action

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', gap: 8 }}>
        <span>⏳</span> {t.system.loadingAudit}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 头部统计 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '0 0 12px',
        borderBottom: '1px solid #e5e7eb', flexShrink: 0,
      }}>
        <h4 style={{ margin: 0, fontSize: 14, color: '#1f2937', flex: 1 }}>
          {t.system.auditRecords} — {projectName}
        </h4>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'success', 'failure'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                fontSize: 11, padding: '2px 10px', borderRadius: 10, border: '1px solid #d1d5db',
                background: filter === f ? '#4f46e5' : '#fff',
                color: filter === f ? '#fff' : '#6b7280',
                cursor: 'pointer', fontWeight: filter === f ? 600 : 400,
              }}
            >
              {f === 'all' ? `${t.system.all}(${stats.total})` : f === 'success' ? `✅ ${stats.success}` : `❌ ${stats.failure}`}
            </button>
          ))}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              fontSize: 11, padding: '2px 10px', borderRadius: 10, border: '1px solid #d1d5db',
              background: autoRefresh ? '#d1fae5' : '#fee2e2',
              color: autoRefresh ? '#065f46' : '#991b1b',
              cursor: 'pointer', fontWeight: 500,
            }}
            title={autoRefresh ? t.system.live : t.system.paused}
          >
            {autoRefresh ? `🔄 ${t.system.live}` : `⏸ ${t.system.paused}`}
          </button>
          <button
            onClick={fetchEvents}
            style={{
              fontSize: 11, padding: '2px 10px', borderRadius: 10, border: '1px solid #d1d5db',
              background: '#fff', color: '#6b7280', cursor: 'pointer',
            }}
          >
            🔃 {t.system.refresh}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 12, marginTop: 8, flexShrink: 0 }}>
          {error}
        </div>
      )}

      {/* 事件列表 */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingTop: 8 }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af', fontSize: 13 }}>
            {events.length === 0 ? (
              <>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                <p>{t.system.noAuditRecords}</p>
                <p style={{ fontSize: 11, color: '#c4c4c4' }}>
                  {t.system.startChatHint}
                </p>
              </>
            ) : (
              <p>{t.system.noMatchingRecords}</p>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filtered.map((e, i) => {
              const colors = outcomeColors[e.outcome] || outcomeColors.unknown
              const icon = actionIcons[e.action] || '📌'
              return (
                <div
                  key={e.id || i}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px',
                    background: i % 2 === 0 ? '#fafafa' : '#fff',
                    borderRadius: 6, border: '1px solid #f3f4f6',
                    fontSize: 12, lineHeight: 1.5,
                  }}
                >
                  <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, color: '#1f2937', fontSize: 12 }}>
                        {toolLabel(e)}
                      </span>
                      <span style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 8,
                        background: colors.bg, color: colors.text, fontWeight: 500,
                      }}>
                        {e.outcome === 'success' ? t.system.outcomeSuccess : e.outcome === 'failure' ? t.system.outcomeFailure : e.outcome}
                      </span>
                    </div>
                    {e.metadata?.summary && (
                      <SafeText text={String(e.metadata.summary)} collapsibleAt={200}
                        style={{ color: '#6b7280', fontSize: 11 }} />
                    )}
                    {e.target && e.target !== projectPath && (
                      <div style={{ color: '#9ca3af', fontSize: 10 }}>{t.system.target}: {e.target}</div>
                    )}
                  </div>
                  <div style={{ flexShrink: 0, textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: '#9ca3af' }}>{formatDate(e.timestamp)}</div>
                    <div style={{ fontSize: 10, color: '#9ca3af' }}>{formatTime(e.timestamp)}</div>
                    {e.durationMs > 0 && (
                      <div style={{ fontSize: 10, color: '#c4c4c4' }}>{e.durationMs}ms</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
