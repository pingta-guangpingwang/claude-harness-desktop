import { useState, useEffect, useRef } from 'react'
import './System.css'

interface AuditEntry {
  id: string
  timestamp: string
  category: 'agent' | 'cli' | 'plugin' | 'workflow' | 'rule' | 'system' | 'permission'
  action: string
  actor?: string
  target?: string
  result: 'success' | 'failure' | 'denied' | 'pending'
  details?: Record<string, unknown>
  durationMs?: number
  projectPath?: string
}

const CATEGORY_COLORS: Record<string, string> = {
  agent: '#818cf8',
  cli: '#34d399',
  plugin: '#f59e0b',
  workflow: '#8b5cf6',
  rule: '#06b6d4',
  system: '#94a3b8',
  permission: '#ef4444',
}

const RESULT_COLORS: Record<string, string> = {
  success: '#10b981',
  failure: '#ef4444',
  denied: '#f59e0b',
  pending: '#94a3b8',
}

export function AuditLogViewer() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [filter, setFilter] = useState('')
  const [catFilter, setCatFilter] = useState<string>('all')
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null)
  const [stats, setStats] = useState<{ totalEntries: number; byCategory: Record<string, number>; byResult: Record<string, number>; sizeBytes: number } | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const listEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    if (autoRefresh) {
      const timer = setInterval(refresh, 5000)
      return () => clearInterval(timer)
    }
  }, [autoRefresh])

  const refresh = async () => {
    try {
      const [logResult, statsResult] = await Promise.all([
        window.electronAPI.auditLogList(200),
        window.electronAPI.auditLogStats(),
      ])
      if (logResult.success) setEntries(logResult.entries || [])
      if (statsResult.success) setStats(statsResult.stats)
    } catch { /* ignore */ }
  }

  const clearLogs = async () => {
    await window.electronAPI.auditLogClear()
    setEntries([])
    setStats(null)
  }

  const filtered = entries.filter(e => {
    if (catFilter !== 'all' && e.category !== catFilter) return false
    if (filter) {
      const q = filter.toLowerCase()
      return e.action.toLowerCase().includes(q) || (e.target?.toLowerCase().includes(q))
    }
    return true
  })

  const categories = [...new Set(entries.map(e => e.category))]

  return (
    <div className="sys-container">
      <div className="sys-audit-main">
        <div className="sys-audit-header">
          <div className="sys-audit-title-row">
            <h4>Audit Log</h4>
            <div className="sys-audit-actions">
              <label className="sys-check">
                <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} /> Auto-refresh
              </label>
              <button onClick={refresh} className="sys-btn">Refresh</button>
              <button onClick={clearLogs} className="sys-btn sys-btn-del" style={{ background: 'transparent', color: '#ef4444' }}>Clear</button>
            </div>
          </div>
          <div className="sys-audit-filters">
            <input className="sys-input" placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 200 }} />
            <select className="sys-select" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              <option value="all">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {stats && (
              <div className="sys-audit-stats">
                <span>{stats.totalEntries} entries</span>
                <span>{(stats.sizeBytes / 1024).toFixed(1)} KB</span>
              </div>
            )}
          </div>
        </div>

        <div className="sys-audit-list">
          {filtered.map(e => (
            <div
              key={e.id}
              className={`sys-audit-row ${selectedEntry?.id === e.id ? 'selected' : ''}`}
              onClick={() => setSelectedEntry(selectedEntry?.id === e.id ? null : e)}
            >
              <span className="sys-audit-time">{new Date(e.timestamp).toLocaleTimeString()}</span>
              <span className="sys-audit-cat" style={{ color: CATEGORY_COLORS[e.category] }}>{e.category}</span>
              <span className="sys-audit-action">{e.action}</span>
              <span className="sys-audit-target">{e.target || e.actor || '-'}</span>
              <span className="sys-audit-result" style={{ color: RESULT_COLORS[e.result] }}>{e.result}</span>
              {e.durationMs != null && <span className="sys-audit-duration">{e.durationMs}ms</span>}
            </div>
          ))}
          {filtered.length === 0 && <div className="sys-empty">No audit entries</div>}
          <div ref={listEndRef} />
        </div>
      </div>

      {selectedEntry && (
        <div className="sys-audit-detail">
          <h5>Entry Details</h5>
          <div className="sys-detail-row"><label>ID</label><span>{selectedEntry.id}</span></div>
          <div className="sys-detail-row"><label>Timestamp</label><span>{selectedEntry.timestamp}</span></div>
          <div className="sys-detail-row"><label>Category</label><span style={{ color: CATEGORY_COLORS[selectedEntry.category] }}>{selectedEntry.category}</span></div>
          <div className="sys-detail-row"><label>Action</label><span>{selectedEntry.action}</span></div>
          <div className="sys-detail-row"><label>Actor</label><span>{selectedEntry.actor || '-'}</span></div>
          <div className="sys-detail-row"><label>Target</label><span>{selectedEntry.target || '-'}</span></div>
          <div className="sys-detail-row"><label>Result</label><span style={{ color: RESULT_COLORS[selectedEntry.result] }}>{selectedEntry.result}</span></div>
          {selectedEntry.durationMs != null && <div className="sys-detail-row"><label>Duration</label><span>{selectedEntry.durationMs}ms</span></div>}
          {selectedEntry.projectPath && <div className="sys-detail-row"><label>Project</label><span>{selectedEntry.projectPath.split('\\').pop()}</span></div>}
          {selectedEntry.details && (
            <div className="sys-detail-json">
              <label>Details</label>
              <pre>{JSON.stringify(selectedEntry.details, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
