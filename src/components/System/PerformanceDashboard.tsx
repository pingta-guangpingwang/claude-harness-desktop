import { useState, useEffect } from 'react'
import './System.css'

interface PerfSnapshot {
  timestamp: string
  memory: { rss: number; heapTotal: number; heapUsed: number; external: number }
  cpu: { user: number; system: number; idle: number } | null
  ipcLatency: {
    avgMs: number; maxMs: number; minMs: number; sampleCount: number
    recentCalls: Array<{ channel: string; durationMs: number }>
  }
  fileIO: { reads: number; writes: number; totalReadBytes: number; totalWriteBytes: number }
  activePTYCount: number
  uptimeSeconds: number
}

export function PerformanceDashboard() {
  const [latest, setLatest] = useState<PerfSnapshot | null>(null)
  const [history, setHistory] = useState<PerfSnapshot[]>([])
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [viewMode, setViewMode] = useState<'overview' | 'memory' | 'ipc' | 'io'>('overview')

  useEffect(() => {
    refresh()
    const timer = setInterval(() => {
      if (autoRefresh) refresh()
    }, 3000)
    return () => clearInterval(timer)
  }, [autoRefresh])

  const refresh = async () => {
    try {
      const [snapResult, histResult] = await Promise.all([
        window.electronAPI.perfSnapshot(),
        window.electronAPI.perfHistory(60),
      ])
      if (snapResult.success) setLatest(snapResult.snapshot)
      if (histResult.success) setHistory(histResult.snapshots || [])
    } catch { /* ignore */ }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
    if (bytes > 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return bytes + ' B'
  }

  const formatUptime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  const maxMemRSS = Math.max(1, ...history.map(s => s.memory.rss))
  const maxIPC = Math.max(1, ...history.map(s => s.ipcLatency.avgMs))

  return (
    <div className="sys-container sys-perf-container">
      <div className="sys-perf-header">
        <h4>Performance Monitor</h4>
        <div className="sys-perf-actions">
          <label className="sys-check">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} /> Auto-refresh
          </label>
          <button onClick={refresh} className="sys-btn">Refresh</button>
        </div>
      </div>

      {/* 摘要卡片 */}
      {latest && (
        <div className="sys-perf-cards">
          <div className="sys-perf-card">
            <div className="sys-perf-card-label">Uptime</div>
            <div className="sys-perf-card-value">{formatUptime(latest.uptimeSeconds)}</div>
          </div>
          <div className="sys-perf-card">
            <div className="sys-perf-card-label">Memory RSS</div>
            <div className="sys-perf-card-value">{formatBytes(latest.memory.rss)}</div>
          </div>
          <div className="sys-perf-card">
            <div className="sys-perf-card-label">Heap Used</div>
            <div className="sys-perf-card-value">{formatBytes(latest.memory.heapUsed)}</div>
          </div>
          <div className="sys-perf-card">
            <div className="sys-perf-card-label">IPC Avg</div>
            <div className="sys-perf-card-value">{latest.ipcLatency.avgMs.toFixed(1)}ms</div>
          </div>
          <div className="sys-perf-card">
            <div className="sys-perf-card-label">File IO</div>
            <div className="sys-perf-card-value">{latest.fileIO.reads + latest.fileIO.writes} ops</div>
          </div>
          <div className="sys-perf-card">
            <div className="sys-perf-card-label">Samples</div>
            <div className="sys-perf-card-value">{history.length}</div>
          </div>
        </div>
      )}

      {/* 视图切换 */}
      <div className="sys-perf-tabs">
        {(['overview', 'memory', 'ipc', 'io'] as const).map(tab => (
          <button key={tab} className={`sys-perf-tab ${viewMode === tab ? 'active' : ''}`} onClick={() => setViewMode(tab)}>
            {tab === 'overview' ? 'Overview' : tab === 'memory' ? 'Memory' : tab === 'ipc' ? 'IPC Latency' : 'File IO'}
          </button>
        ))}
      </div>

      <div className="sys-perf-charts">
        {/* Memory Chart */}
        {(viewMode === 'overview' || viewMode === 'memory') && (
          <div className="sys-perf-chart">
            <h5>Memory Usage</h5>
            <div className="sys-perf-bars">
              {history.slice(-30).map((s, i) => (
                <div key={i} className="sys-perf-bar-group" title={s.timestamp}>
                  <div className="sys-perf-bar" style={{ height: `${(s.memory.rss / maxMemRSS) * 100}%`, background: '#6366f1' }} />
                  <div className="sys-perf-bar" style={{ height: `${(s.memory.heapUsed / maxMemRSS) * 100}%`, background: '#10b981' }} />
                </div>
              ))}
            </div>
            <div className="sys-perf-legend">
              <span><span className="sys-perf-dot" style={{ background: '#6366f1' }} /> RSS</span>
              <span><span className="sys-perf-dot" style={{ background: '#10b981' }} /> Heap</span>
              <span>Max: {formatBytes(maxMemRSS)}</span>
            </div>
          </div>
        )}

        {/* IPC Latency Chart */}
        {(viewMode === 'overview' || viewMode === 'ipc') && (
          <div className="sys-perf-chart">
            <h5>IPC Latency</h5>
            <div className="sys-perf-bars">
              {history.slice(-30).map((s, i) => (
                <div key={i} className="sys-perf-bar-group" title={s.timestamp}>
                  <div className="sys-perf-bar" style={{ height: `${(s.ipcLatency.avgMs / maxIPC) * 100}%`, background: '#f59e0b' }} />
                </div>
              ))}
            </div>
            <div className="sys-perf-legend">
              <span>Avg: {latest?.ipcLatency.avgMs.toFixed(1) || 0}ms</span>
              <span>Max: {latest?.ipcLatency.maxMs.toFixed(1) || 0}ms</span>
              <span>Samples: {latest?.ipcLatency.sampleCount || 0}</span>
            </div>
          </div>
        )}

        {/* File IO */}
        {(viewMode === 'overview' || viewMode === 'io') && (
          <div className="sys-perf-chart">
            <h5>File I/O</h5>
            <div className="sys-perf-stats-table">
              <div className="sys-perf-stat-row">
                <span>Total Reads</span><span>{latest?.fileIO.reads || 0}</span>
              </div>
              <div className="sys-perf-stat-row">
                <span>Total Writes</span><span>{latest?.fileIO.writes || 0}</span>
              </div>
              <div className="sys-perf-stat-row">
                <span>Read Volume</span><span>{formatBytes(latest?.fileIO.totalReadBytes || 0)}</span>
              </div>
              <div className="sys-perf-stat-row">
                <span>Write Volume</span><span>{formatBytes(latest?.fileIO.totalWriteBytes || 0)}</span>
              </div>
              <div className="sys-perf-stat-row">
                <span>Active PTYs</span><span>{latest?.activePTYCount || 0}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Recent IPC calls */}
      {latest && latest.ipcLatency.recentCalls.length > 0 && (viewMode === 'overview' || viewMode === 'ipc') && (
        <div className="sys-perf-ipc-table">
          <h5>Recent IPC Calls</h5>
          <div className="sys-perf-ipc-rows">
            {latest.ipcLatency.recentCalls.slice(-10).map((call, i) => (
              <div key={i} className="sys-perf-ipc-row">
                <span className="sys-perf-ipc-channel">{call.channel}</span>
                <span className="sys-perf-ipc-duration" style={{ color: call.durationMs > 100 ? '#ef4444' : call.durationMs > 50 ? '#f59e0b' : '#10b981' }}>
                  {call.durationMs.toFixed(1)}ms
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
