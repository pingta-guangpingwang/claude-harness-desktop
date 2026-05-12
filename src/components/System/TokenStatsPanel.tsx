// TokenStatsPanel — Token 消耗统计面板
// 顶部统计卡片 + 会话列表（双击展开/收起）+ 单次调用明细
import React, { useEffect, useState, useCallback } from 'react'

interface TokenStats {
  totalTokens: number; totalPromptTokens: number; totalCompletionTokens: number
  totalCost: number; totalCalls: number
  byDay: Record<string, { tokens: number; calls: number; cost: number }>
  byProject: Record<string, { tokens: number; calls: number; cost: number; name: string }>
  byModel: Record<string, { tokens: number; calls: number }>
  conversations: Array<{
    conversationId: string; projectPath: string; projectName: string
    firstCallAt: string; lastCallAt: string
    totalTokens: number; totalCost: number; callCount: number
  }>
}

interface TokenRecord {
  id: string; timestamp: string; projectPath: string; projectName: string
  model: string; promptTokens: number; completionTokens: number; totalTokens: number
  costEstimate: number; conversationId: string
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function formatCost(n: number): string {
  if (n < 0.01) return '$' + n.toFixed(4)
  return '$' + n.toFixed(2)
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return iso }
}

export function TokenStatsPanel() {
  const [stats, setStats] = useState<TokenStats | null>(null)
  const [expandedConvs, setExpandedConvs] = useState<Set<string>>(new Set())
  const [convDetails, setConvDetails] = useState<Map<string, { records: TokenRecord[]; turns: any[] }>>(new Map())
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await window.electronAPI.tokenStats()
      if (res.success && res.stats) setStats(res.stats as TokenStats)
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (!autoRefresh) return
    const iv = setInterval(refresh, 8000)
    return () => clearInterval(iv)
  }, [autoRefresh, refresh])

  const toggleConv = useCallback(async (convId: string) => {
    setExpandedConvs(prev => {
      const next = new Set(prev)
      if (next.has(convId)) { next.delete(convId); return next }
      next.add(convId)
      // 懒加载详情
      if (!convDetails.has(convId)) {
        window.electronAPI.tokenConversation(convId).then(res => {
          if (res.success) {
            setConvDetails(prev2 => {
              const m = new Map(prev2)
              m.set(convId, { records: res.records as TokenRecord[], turns: res.turns as any[] })
              return m
            })
          }
        }).catch(() => {})
      }
      return next
    })
  }, [convDetails])

  const todayStr = new Date().toISOString().slice(0, 10)
  const todayStats = stats?.byDay[todayStr]

  if (loading) return <div style={{ padding: 24, color: '#94a3b8', fontSize: 13 }}>加载中...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a', color: '#e2e8f0' }}>
      {/* 顶部操作栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid #1e293b', flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>📊 Token 消耗统计</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            自动刷新
          </label>
          <button onClick={refresh} style={{
            padding: '4px 10px', borderRadius: 4, border: '1px solid #334155',
            background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 11,
          }}>刷新</button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 8, padding: '10px 12px', flexShrink: 0,
      }}>
        <StatCard label="总消耗" value={formatTokens(stats?.totalTokens || 0)} sub={`${stats?.totalCalls || 0} 次调用`} color="#3b82f6" />
        <StatCard label="今日消耗" value={formatTokens(todayStats?.tokens || 0)} sub={`${todayStats?.calls || 0} 次调用`} color="#10b981" />
        <StatCard label="总费用" value={formatCost(stats?.totalCost || 0)} sub="DeepSeek 定价" color="#f59e0b" />
        <StatCard label="平均/次" value={stats?.totalCalls ? formatTokens(Math.round(stats.totalTokens / stats.totalCalls)) : '-'} sub="Tokens/调用" color="#8b5cf6" />
      </div>

      {/* 会话列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 12px 12px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', padding: '8px 0 4px' }}>
          会话记录 ({stats?.conversations.length || 0}) — 双击展开/收起
        </div>
        {(!stats || stats.conversations.length === 0) && (
          <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
            暂无记录，等待驾驭智能体 API 调用...
          </div>
        )}
        {stats?.conversations.map(conv => {
          const isExpanded = expandedConvs.has(conv.conversationId)
          const detail = convDetails.get(conv.conversationId)
          return (
            <div key={conv.conversationId} style={{ marginBottom: 4 }}>
              {/* 会话摘要行 */}
              <div
                onDoubleClick={() => toggleConv(conv.conversationId)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', borderRadius: 6,
                  background: isExpanded ? '#1e293b' : '#111827',
                  cursor: 'pointer', userSelect: 'none',
                  borderLeft: `3px solid ${isExpanded ? '#3b82f6' : 'transparent'}`,
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isExpanded ? '▼' : '▶'} {conv.projectName}
                    <span style={{ color: '#64748b', fontWeight: 400, marginLeft: 8, fontSize: 11 }}>
                      {fmtTime(conv.firstCallAt)} → {fmtTime(conv.lastCallAt)}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 12, flexShrink: 0 }}>
                  <span style={{ color: '#94a3b8' }}>{conv.callCount} 次</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600, minWidth: 60, textAlign: 'right' }}>
                    {formatTokens(conv.totalTokens)}
                  </span>
                  <span style={{ color: '#f59e0b', minWidth: 56, textAlign: 'right' }}>
                    {formatCost(conv.totalCost)}
                  </span>
                </div>
              </div>

              {/* 展开详情 */}
              {isExpanded && detail && (
                <div style={{
                  marginLeft: 14, padding: '6px 0 10px 14px',
                  borderLeft: '2px solid #1e293b',
                }}>
                  {detail.records.map((rec, i) => (
                    <div key={rec.id || i} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '4px 6px', fontSize: 11, color: '#94a3b8',
                      borderBottom: i < detail.records.length - 1 ? '1px solid #1e293b' : 'none',
                    }}>
                      <span style={{ width: 80, flexShrink: 0, color: '#64748b' }}>{fmtTime(rec.timestamp)}</span>
                      <span style={{ width: 100, flexShrink: 0, color: '#e2e8f0' }}>{rec.model}</span>
                      <span title={`Prompt: ${rec.promptTokens} / Completion: ${rec.completionTokens}`} style={{ display: 'flex', gap: 2, width: 160, flexShrink: 0 }}>
                        <span style={{ color: '#3b82f6' }}>🅿{formatTokens(rec.promptTokens)}</span>
                        <span style={{ color: '#94a3b8' }}>+</span>
                        <span style={{ color: '#10b981' }}>🅲{formatTokens(rec.completionTokens)}</span>
                        <span style={{ color: '#94a3b8' }}>=</span>
                        <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{formatTokens(rec.totalTokens)}</span>
                      </span>
                      <span style={{ color: '#f59e0b', width: 60, textAlign: 'right', flexShrink: 0 }}>
                        {formatCost(rec.costEstimate)}
                      </span>
                    </div>
                  ))}
                  {detail.records.length === 0 && (
                    <div style={{ padding: 12, color: '#64748b', fontSize: 11, textAlign: 'center' }}>
                      无详细记录
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{
      background: '#111827', borderRadius: 8, padding: '10px 14px',
      border: `1px solid ${color}22`,
    }}>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{sub}</div>
    </div>
  )
}
