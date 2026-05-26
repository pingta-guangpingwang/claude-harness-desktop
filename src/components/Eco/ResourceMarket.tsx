import { useEffect, useState, useMemo, useRef, useCallback } from 'react'

interface ResourceItem {
  id: string
  name: string
  type: string
  category: string
  tech_stack?: string[]
  style_tags?: string[]
  score: number
  source_url?: string
  summary: string
  summary_en?: string
  file?: string
  repo: string
  body?: string
}

interface PendingItem {
  id: string; name: string; resourceType: string; targetRepo: string
  category: string; techStack: string[]; sourceUrl: string; summary: string
  rawContent: string; status: string; auditScore: number; auditNotes: string
  formattedContent: string; auditedAt: string; createdAt: string
}

interface UserContribution {
  id: string; name: string; repo: string; type: string
  addedAt: string; committed: boolean; committedAt?: string
  pushed: boolean; pushedAt?: string
}

const REPO_LABELS: Record<string, string> = {
  DeepBluePrompt: '深蓝提示词库',
  DeepBlueCase: '深蓝案例坊',
  DeepBlueKit: '深蓝工具集',
  DeepBlueIdentity: '深蓝身份库',
}

const TYPE_LABELS: Record<string, string> = {
  prompt: '提示词', template: '模板', case: '案例',
  plugin: '插件', tool: '工具', skill: '技能',
  'mcp-server': 'MCP服务', 'agent-framework': 'Agent框架', 'ai-assistant': 'AI助手',
  identity: '角色身份',
}

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  prompt:           { bg: '#7c3aed22', text: '#a78bfa' },
  template:         { bg: '#2563eb22', text: '#60a5fa' },
  case:             { bg: '#05966922', text: '#34d399' },
  plugin:           { bg: '#d9770622', text: '#fbbf24' },
  tool:             { bg: '#0891b222', text: '#22d3ee' },
  skill:            { bg: '#db277722', text: '#f472b6' },
  'mcp-server':     { bg: '#ea580c22', text: '#fb923c' },
  'agent-framework':{ bg: '#7c3aed22', text: '#c084fc' },
  'ai-assistant':   { bg: '#05966922', text: '#6ee7b7' },
  identity:         { bg: '#dc262622', text: '#f87171' },
}

// 模块级缓存：避免组件卸载/重新挂载（切 Tab）时重复执行 Git 操作 + 状态丢失
let _autoSyncDone = false
let _autoSyncMsg = ''
let _repoStatusesCache: Record<string, any> | null = null
let _resourcesCache: ResourceItem[] | null = null
let _leaderboardCache: Array<{ id: string; name: string; type: string; score: number }> | null = null
let _repoFilter: string = 'all'
let _typeFilter: string = 'all'
let _lang: 'zh' | 'en' | 'bilingual' = 'zh'
let _initialized = false

export function ResourceMarket() {
  const [initialized, setInitialized] = useState(_initialized)
  const [resources, setResources] = useState<ResourceItem[]>(_resourcesCache || [])
  const [search, setSearch] = useState('')
  const [repoFilter, setRepoFilter] = useState(_repoFilter)
  const [typeFilter, setTypeFilter] = useState(_typeFilter)
  const [selected, setSelected] = useState<ResourceItem | null>(null)
  const [detailBody, setDetailBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [leaderboard, setLeaderboard] = useState<Array<{ id: string; name: string; type: string; score: number }>>(_leaderboardCache || [])

  // Git sync state
  const [repoStatuses, setRepoStatuses] = useState<Record<string, { behind: number; ahead: number; branch: string; exists: boolean; isGit: boolean }>>({})
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState('')

  // Pending review state
  const [showPending, setShowPending] = useState(false)
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [auditing, setAuditing] = useState(false)
  const [approving, setApproving] = useState<string | null>(null)
  const [auditResults, setAuditResults] = useState<Array<{ id: string; name: string; success: boolean; score: number; message: string }>>([])
  // 用户贡献追踪
  const [contributions, setContributions] = useState<UserContribution[]>([])
  const [showCommit, setShowCommit] = useState(false)
  const [commitCheck, setCommitCheck] = useState<Record<string, { hasRemote: boolean; behind: number; localChanges: Array<{ path: string; status: string }>; uncommittedIds: string[] }> | null>(null)
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState<Array<{ repo: string; success: boolean; message: string; step?: string }> | null>(null)
  const [showAddTip, setShowAddTip] = useState(false)
  const [autoSyncMsg, setAutoSyncMsg] = useState(_autoSyncMsg)
  const [lang, setLang] = useState<'zh' | 'en' | 'bilingual'>(_lang)
  const nextLang = (l: 'zh' | 'en' | 'bilingual') => l === 'zh' ? 'en' : l === 'en' ? 'bilingual' : 'zh'
  const langLabel = (l: 'zh' | 'en' | 'bilingual') => l === 'zh' ? '中' : l === 'en' ? 'EN' : '中+EN'
  const fmtSummary = (zh: string, en?: string, max = 120) => {
    if (lang === 'en' && en) return en.slice(0, max)
    if (lang === 'bilingual' && en) return zh.slice(0, max / 2) + '\n' + en.slice(0, max / 2)
    return zh.slice(0, max)
  }

  useEffect(() => {
    loadStatus()
  }, [])

  // 同步状态到模块级变量 —— 切 Tab 组件重建时恢复
  useEffect(() => { _resourcesCache = resources }, [resources])
  useEffect(() => { _leaderboardCache = leaderboard }, [leaderboard])
  useEffect(() => { _repoFilter = repoFilter }, [repoFilter])
  useEffect(() => { _typeFilter = typeFilter }, [typeFilter])
  useEffect(() => { _lang = lang }, [lang])
  useEffect(() => { _initialized = initialized }, [initialized])
  useEffect(() => { _repoStatusesCache = repoStatuses }, [repoStatuses])
  useEffect(() => { _autoSyncMsg = autoSyncMsg }, [autoSyncMsg])

  useEffect(() => {
    if (initialized) loadRepoStatuses()
  }, [initialized])

  // 切换仓库筛选时，若仓库未克隆则弹窗提示
  const checkedMissing = useRef<Set<string>>(new Set())
  // 切换仓库筛选时，若仓库未克隆则弹窗提示
  useEffect(() => {
    if (repoFilter === 'all' || checkedMissing.current.has(repoFilter)) return
    const st = repoStatuses[repoFilter]
    if (!st) return // 状态还没加载
    if (!st.exists) {
      checkedMissing.current.add(repoFilter) // 防重复弹窗
      if (window.confirm(`仓库 ${repoFilter} 尚未克隆到本地，是否立即克隆？\n\n${repoFilter} has not been cloned. Clone now?`)) {
        handleClone(repoFilter)
      } else {
        setRepoFilter('all')
      }
    }
  }, [repoFilter, repoStatuses])

  const loadStatus = async () => {
    try {
      const res = await window.electronAPI.resourceStatus()
      if (res.success) {
        setInitialized(res.initialized)
        if (res.initialized) {
          loadLeaderboard()
          // 首次打开时后台静默同步，后续切 Tab 不再重复拉取
          if (!_autoSyncDone) autoSync()
        }
      }
    } catch { /* ignore */ }
  }

  const autoSync = async () => {
    _autoSyncDone = true
    try {
      const r = await window.electronAPI.resourceAutoSync()
      setAutoSyncMsg(r.message)
      if (r.synced.length > 0) {
        loadResources()
        loadLeaderboard()
      }
    } catch {
      setAutoSyncMsg('自动同步失败，请检查网络后手动同步')
    }
  }

  const syncAll = async () => {
    setSyncing('__all__')
    setSyncMessage('')
    try {
      const r = await window.electronAPI.resourceAutoSync()
      setSyncMessage(r.message)
      setAutoSyncMsg(r.message)
      if (r.synced.length > 0) {
        loadResources()
        loadLeaderboard()
      }
      await loadRepoStatuses(true)
    } catch {
      setSyncMessage('同步失败，请检查网络连接')
    }
    setSyncing(null)
  }

  const loadResources = async () => {
    setLoading(true)
    try {
      const res = await window.electronAPI.resourceList()
      if (res.success) {
        setResources(res.resources || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }

  // 首次初始化时加载全部资源，后续由 client-side filtered useMemo 处理筛选
  useEffect(() => {
    if (initialized) loadResources()
  }, [initialized])

  const loadLeaderboard = async () => {
    try {
      const res = await window.electronAPI.resourceLeaderboard(undefined, 10)
      if (res.success) {
        setLeaderboard(res.leaderboard || [])
      }
    } catch { /* ignore */ }
  }

  const handleSearch = async () => {
    if (!search.trim()) {
      loadResources()
      return
    }
    setLoading(true)
    try {
      const res = await window.electronAPI.resourceQuery({
        query: search,
        repo: repoFilter === 'all' ? undefined : repoFilter,
        type: typeFilter === 'all' ? undefined : typeFilter,
        maxResults: 20,
      })
      if (res.success) {
        setResources(res.resources || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }

  const handleViewDetail = useCallback(async (item: ResourceItem) => {
    if (selected?.id === item.id) {
      setSelected(null)
      setDetailBody('')
      return
    }
    setSelected(item)
    setDetailBody('')
    try {
      const res = await window.electronAPI.resourceDetail(item.id)
      if (res.success && res.resource?.body) {
        setDetailBody(res.resource.body)
      }
    } catch { /* ignore */ }
  }, [selected?.id])

  const loadRepoStatuses = async (force = false) => {
    // 已缓存且非强制刷新 → 直接用缓存，避免每次切 Tab 都 git fetch
    if (!force && _repoStatusesCache) {
      setRepoStatuses(_repoStatusesCache)
      return
    }
    const repos = ['DeepBluePrompt', 'DeepBlueCase', 'DeepBlueKit', 'DeepBlueIdentity']
    const statuses: Record<string, any> = {}
    for (const repo of repos) {
      try {
        const res = await window.electronAPI.resourceRepoStatus(repo)
        if (res.success) {
          statuses[repo] = { behind: res.behind, ahead: res.ahead, branch: res.branch, exists: res.exists, isGit: res.isGit }
        }
      } catch { /* ignore */ }
    }
    _repoStatusesCache = statuses
    setRepoStatuses(statuses)
  }

  const handleSync = async (repo: string) => {
    setSyncing(repo)
    setSyncMessage('')
    try {
      const res = await window.electronAPI.resourceSyncPull(repo)
      setSyncMessage(res.message)
      if (res.pulled) loadResources()
      await loadRepoStatuses(true)
    } catch { /* ignore */ }
    setSyncing(null)
  }

  const handleClone = async (repo: string, skipConfirm = false) => {
    if (!skipConfirm && !window.confirm(`是否克隆 ${repo} 仓库到本地？\n\nClone ${repo} repository to local?\n\n将从 GitHub 下载约数百 KB 数据。`)) return
    setSyncing(repo)
    setSyncMessage('')
    try {
      const res = await window.electronAPI.resourceClone(repo)
      setSyncMessage(res.message)
      if (res.success) {
        await loadStatus()
        await loadRepoStatuses(true)
        loadResources()
      }
    } catch { /* ignore */ }
    setSyncing(null)
  }

  const handleCloneAll = async () => {
    if (!window.confirm('是否一键克隆全部四个深蓝工坊仓库到本地？\n\nClone all 4 DeepBlue Workshop repos?')) return
    const repos = ['DeepBluePrompt', 'DeepBlueCase', 'DeepBlueKit', 'DeepBlueIdentity']
    for (const repo of repos) {
      await handleClone(repo, true)
    }
  }

  const loadPending = async () => {
    try {
      const res = await window.electronAPI.pendingList()
      if (res.success) setPendingItems(res.items || [])
    } catch { /* ignore */ }
    try {
      const res = await window.electronAPI.pendingCount()
      if (res.success) setPendingCount(res.count)
    } catch { /* ignore */ }
  }

  const handlePendingRemove = async (id: string) => {
    await window.electronAPI.pendingRemove(id)
    loadPending()
  }

  const handleApprove = async (id: string) => {
    setApproving(id)
    try {
      const res = await window.electronAPI.pendingApprove(id)
      if (res.success) {
        loadPending()
        loadResources()
      }
    } catch { /* ignore */ }
    setApproving(null)
  }

  const handleAuditAll = async () => {
    if (!window.confirm('确认一键审核并入库全部待审资源？\\n\\n系统将自动审核内容并写入仓库。')) return
    setAuditing(true)
    setAuditResults([])
    try {
      const res = await window.electronAPI.pendingAuditAll()
      if (res.success && res.results) {
        setAuditResults(res.results)
        loadPending()
        loadResources()
        loadContributions()
      }
    } catch { /* ignore */ }
    setAuditing(false)
  }

  // 加载用户贡献列表
  const loadContributions = async () => {
    try {
      const res = await window.electronAPI.contributionList()
      if (res.success) setContributions(res.contributions || [])
    } catch { /* ignore */ }
  }

  // 检测待提交内容
  const handleCheckCommit = async () => {
    try {
      const res = await window.electronAPI.contributionCheckStatus()
      if (res.success && res.repoStatuses) {
        setCommitCheck(res.repoStatuses)
        setCommitResult(null)
      }
    } catch { /* ignore */ }
  }

  // 一键提交所有仓库
  const handleCommitAll = async () => {
    setCommitting(true)
    setCommitResult(null)
    try {
      const res = await window.electronAPI.contributionCommitAll('user: 提交用户贡献资源')
      if (res.success) {
        setCommitResult(res.results || [])
        loadContributions()
        loadResources()
      }
    } catch { /* ignore */ }
    setCommitting(false)
  }

  // contribution ID → status 快速查询
  const contribMap = useMemo(() => {
    const m = new Map<string, UserContribution>()
    for (const c of contributions) m.set(c.id, c)
    return m
  }, [contributions])

  // 初始化时加载贡献
  useEffect(() => {
    if (initialized) { loadContributions(); loadPending() }
  }, [initialized])

  const filtered = useMemo(() => {
    let r = resources
    if (repoFilter !== 'all') r = r.filter(item => item.repo === repoFilter)
    if (typeFilter !== 'all') r = r.filter(item => item.type === typeFilter)
    return r
  }, [resources, repoFilter, typeFilter])

  const scoreColor = (s: number) => {
    if (s >= 8) return '#059669'
    if (s >= 5) return '#d97706'
    return '#6b7280'
  }

  if (!initialized) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', padding: '40px' }}>
        <div style={{ fontSize: '48px' }}>📦</div>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>深蓝工坊资源仓库未初始化</div>
        <div style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center', maxWidth: '400px', lineHeight: 1.6 }}>
          点击下方按钮一键 Clone 官方仓库到本地
        </div>
        {syncing && <div style={{ fontSize: '11px', color: '#f59e0b' }}>正在克隆 {syncing}...</div>}
        {syncMessage && <div style={{ fontSize: '11px', color: '#34d399' }}>{syncMessage}</div>}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {['DeepBluePrompt', 'DeepBlueCase', 'DeepBlueKit', 'DeepBlueIdentity'].map(repo => (
            <button key={repo} onClick={() => handleClone(repo)}
              disabled={syncing !== null}
              style={{
                padding: '8px 16px', borderRadius: '6px', border: '1px solid #334155',
                background: syncing === repo ? '#334155' : '#06b6d4',
                color: '#fff', cursor: syncing !== null ? 'not-allowed' : 'pointer',
                fontSize: '12px', fontWeight: 600, opacity: syncing !== null ? 0.6 : 1,
              }}>
              {syncing === repo ? '克隆中...' : `Clone ${repo}`}
            </button>
          ))}
        </div>
        <button onClick={handleCloneAll}
          disabled={syncing !== null}
          style={{
            padding: '8px 20px', borderRadius: '6px', border: '1px solid #334155',
            background: syncing !== null ? '#334155' : '#f59e0b',
            color: '#fff', cursor: syncing !== null ? 'not-allowed' : 'pointer',
            fontSize: '13px', fontWeight: 700, opacity: syncing !== null ? 0.6 : 1,
          }}>一键克隆全部</button>
        <button onClick={loadStatus} style={{
          padding: '6px 14px', borderRadius: '6px', border: '1px solid #334155',
          background: '#1e293b', color: '#e2e8f0', cursor: 'pointer', fontSize: '11px',
        }}>重新检测</button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>
      {/* Search bar */}
      <div style={{ display: 'flex', gap: '8px', padding: '10px 0', flexShrink: 0 }}>
        <input
          style={{
            flex: 1, padding: '6px 12px', fontSize: '12px',
            background: '#1e293b', border: '1px solid #334155', borderRadius: '6px',
            color: '#e2e8f0', outline: 'none',
          }}
          placeholder="搜索提示词、模板、案例、工具..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
        />
        <button onClick={handleSearch} style={{
          padding: '6px 14px', fontSize: '12px', background: '#06b6d4', color: '#fff',
          border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600,
        }}>搜索</button>
      </div>

      {/* Repo filter tabs */}
      <div style={{ display: 'flex', gap: '4px', padding: '0 0 8px 0', flexShrink: 0 }}>
        {(['all', 'DeepBluePrompt', 'DeepBlueCase', 'DeepBlueKit', 'DeepBlueIdentity'] as const).map(repo => {
          const active = repoFilter === repo
          const label = repo === 'all' ? '全部' : repo === 'DeepBluePrompt' ? '提示词库' : repo === 'DeepBlueCase' ? '案例坊' : repo === 'DeepBlueKit' ? '工具集' : '身份库'
          return (
            <button key={repo} onClick={() => setRepoFilter(repo)} style={{
              padding: '5px 14px', fontSize: '12px', fontWeight: active ? 700 : 500,
              borderRadius: '6px', border: 'none', cursor: 'pointer',
              background: active ? '#2563eb' : '#1e293b',
              color: active ? '#fff' : '#94a3b8',
              transition: 'all 0.1s',
            }}>{label}</button>
          )
        })}
      </div>

      {/* Type filter tabs */}
      <div style={{ display: 'flex', gap: '3px', padding: '0 0 6px 0', flexShrink: 0, flexWrap: 'wrap' }}>
        {(['all', 'prompt', 'template', 'case', 'plugin', 'tool', 'skill', 'mcp-server', 'agent-framework', 'ai-assistant', 'identity'] as const).map(t => {
          const active = typeFilter === t
          const label = t === 'all' ? '全部类型' : (TYPE_LABELS[t] || t)
          return (
            <button key={t} onClick={() => setTypeFilter(t)} style={{
              padding: '3px 10px', fontSize: '11px', fontWeight: active ? 600 : 400,
              borderRadius: '4px', border: 'none', cursor: 'pointer',
              background: active ? '#0ea5e9' : '#0f172a',
              color: active ? '#fff' : '#64748b',
              transition: 'all 0.1s',
            }}>{label}</button>
          )
        })}
      </div>

      {/* Sync toolbar — 同步操作区，非筛选 */}
      <div style={{ display: 'flex', gap: '6px', padding: '4px 0', borderTop: '1px solid #1e293b', borderBottom: '1px solid #1e293b', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        <span style={{ fontSize: '9px', color: '#475569', marginRight: '2px' }}>同步:</span>
        {(['DeepBluePrompt', 'DeepBlueCase', 'DeepBlueKit', 'DeepBlueIdentity'] as const).map(repo => {
          const st = repoStatuses[repo]
          const missing = st && !st.exists
          const notGit = st && st.exists && !st.isGit
          if (missing || notGit) {
            return (
              <button key={repo} onClick={() => handleClone(repo)}
                disabled={syncing !== null}
                style={{
                  fontSize: '10px', padding: '3px 8px', borderRadius: '4px', fontWeight: 500,
                  border: '1px solid #334155', cursor: syncing !== null ? 'not-allowed' : 'pointer',
                  background: '#d9770622', color: '#f59e0b',
                  opacity: syncing !== null ? 0.5 : 1,
                }}>
                {syncing === repo ? '⟳' : '⬇'} {repo.replace('DeepBlue', '')} {missing ? '(未克隆)' : '(需修复)'}
              </button>
            )
          }
          return (
            <span key={repo} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button onClick={() => handleSync(repo)}
                disabled={syncing !== null}
                title={st ? `${st.branch} | behind:${st.behind} ahead:${st.ahead}` : '加载中...'}
                style={{
                  fontSize: '10px', padding: '3px 8px', borderRadius: '4px', fontWeight: 500,
                  border: '1px solid #334155', cursor: syncing !== null ? 'not-allowed' : 'pointer',
                  background: st?.behind ? '#d9770622' : '#1e293b',
                  color: st?.behind ? '#f59e0b' : '#94a3b8',
                  opacity: syncing !== null ? 0.5 : 1,
                }}>
                {syncing === repo ? '⟳' : '↡'} {repo.replace('DeepBlue', '')}
                {st?.behind ? ` ${st.behind}` : ''}
              </button>
            </span>
          )
        })}
        <span style={{ flex: 1 }} />
        {autoSyncMsg && <span style={{ fontSize: '10px', color: autoSyncMsg.includes('失败') ? '#ef4444' : '#34d399', marginRight: '4px' }}>{autoSyncMsg}</span>}
        <button onClick={syncAll}
          disabled={syncing === '__all__'}
          title="从 GitHub 拉取所有仓库最新数据"
          style={{
            fontSize: '10px', padding: '3px 10px', borderRadius: '4px', fontWeight: 600,
            border: '1px solid #334155',
            background: syncing === '__all__' ? '#334155' : '#059669',
            color: '#fff', cursor: syncing === '__all__' ? 'not-allowed' : 'pointer',
            opacity: syncing === '__all__' ? 0.6 : 1,
          }}>{syncing === '__all__' ? '⟳ 同步中...' : '⬇ 一键同步'}</button>
        <button onClick={() => setLang(nextLang)}
          title="中/EN/双语 / Chinese/English/Bilingual"
          style={{
            fontSize: '10px', padding: '3px 8px', borderRadius: '4px', fontWeight: 500,
            border: '1px solid #334155',
            background: lang !== 'zh' ? '#2563eb22' : '#1e293b',
            color: lang !== 'zh' ? '#60a5fa' : '#94a3b8', cursor: 'pointer',
            fontFamily: 'monospace',
          }}>{langLabel(lang)}</button>
        <button onClick={async () => { await loadRepoStatuses(true); loadResources() }}
          title="刷新仓库状态"
          style={{
            fontSize: '10px', padding: '3px 8px', borderRadius: '4px',
            border: '1px solid #334155', background: '#1e293b', color: '#94a3b8', cursor: 'pointer',
          }}>↻ 刷新</button>
        <button onClick={() => {
            if (showAddTip) { setShowAddTip(false); return }
            setShowAddTip(true); setShowPending(false); setShowCommit(false); setAuditResults([])
          }}
          title="如何添加资源"
          style={{
            fontSize: '10px', padding: '3px 8px', borderRadius: '4px', fontWeight: 500,
            border: '1px solid #334155',
            background: showAddTip ? '#06b6d4' : '#1e293b',
            color: showAddTip ? '#fff' : '#94a3b8', cursor: 'pointer',
          }}>入库指南</button>
        <button onClick={() => {
            if (showPending) { setShowPending(false); setAuditResults([]); return }
            setShowPending(true); setShowAddTip(false); setShowCommit(false); loadPending()
          }}
          style={{
            fontSize: '10px', padding: '3px 8px', borderRadius: '4px', fontWeight: 500,
            border: '1px solid #334155',
            background: showPending ? '#f59e0b' : '#1e293b',
            color: showPending ? '#fff' : pendingCount > 0 ? '#f59e0b' : '#94a3b8',
            cursor: 'pointer',
          }}>{showPending ? '收起' : `${pendingCount} 待审`}</button>
        <button onClick={async () => {
            if (showCommit) { setShowCommit(false); setCommitCheck(null); setCommitResult(null); return }
            setShowCommit(true); setShowAddTip(false); setShowPending(false); setAuditResults([])
            await handleCheckCommit()
          }}
          disabled={contributions.filter(c => !c.committed).length === 0}
          title="检测并提交用户贡献到 GitHub"
          style={{
            fontSize: '10px', padding: '3px 8px', borderRadius: '4px', fontWeight: 600,
            border: '1px solid #334155',
            background: contributions.filter(c => !c.committed).length > 0 ? '#d9770622' : '#1e293b',
            color: contributions.filter(c => !c.committed).length > 0 ? '#f59e0b' : '#475569',
            cursor: contributions.filter(c => !c.committed).length > 0 ? 'pointer' : 'default',
          }}>↑ 提交{contributions.filter(c => !c.committed).length > 0 ? ` (${contributions.filter(c => !c.committed).length})` : ''}</button>
        {syncMessage && <span style={{ fontSize: '10px', color: '#34d399', marginLeft: '6px' }}>{syncMessage}</span>}
      </div>

      {/* Main content area — panels replace the resource list as "切页" */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {showAddTip ? (
          <AddTipPanel />
        ) : showPending ? (
          <PendingPanel
            pendingItems={pendingItems} auditing={auditing} auditResults={auditResults}
            approving={approving}
            onAuditAll={handleAuditAll}
            onRefresh={loadPending}
            onClearResults={() => setAuditResults([])}
            onApprove={handleApprove}
            onRemove={handlePendingRemove}
          />
        ) : showCommit && commitCheck ? (
          <CommitPanel
            commitCheck={commitCheck} commitResult={commitResult} committing={committing}
            onClose={() => { setShowCommit(false); setCommitCheck(null); setCommitResult(null) }}
            onCommitAll={handleCommitAll}
          />
        ) : (
          <>
            {/* Resource list */}
            <div style={{ flex: selected ? '1 1 50%' : '1 1 100%', overflow: 'auto', paddingRight: selected ? '8px' : '0' }}>
              {loading && (
                <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '12px' }}>加载中...</div>
              )}
              {!loading && filtered.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8', fontSize: '13px' }}>
                  暂无匹配资源，试试其他关键词或筛选条件
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {filtered.map(item => {
                  const isSel = selected?.id === item.id
                  const sc = scoreColor(item.score)
                  return (
                    <div key={item.id} onClick={() => handleViewDetail(item)} style={{
                      background: isSel ? '#1e3a5f' : '#0f172a',
                      border: `1px solid ${isSel ? '#2563eb' : '#1e293b'}`,
                      borderRadius: '8px', padding: '10px 12px', cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                          <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: TYPE_COLORS[item.type]?.bg || '#d9770622', color: TYPE_COLORS[item.type]?.text || '#fbbf24', flexShrink: 0 }}>{TYPE_LABELS[item.type] || item.type}</span>
                          {contribMap.get(item.id) && (
                            <span style={{
                              fontSize: '10px', padding: '1px 5px', borderRadius: '4px', flexShrink: 0,
                              background: contribMap.get(item.id)!.committed ? '#05966922' : '#f59e0b22',
                              color: contribMap.get(item.id)!.committed ? '#34d399' : '#fbbf24',
                            }}>
                              {contribMap.get(item.id)!.committed ? '已提交' : '新增'}
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: sc, flexShrink: 0, marginLeft: '8px' }}>★ {item.score}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#cbd5e1', lineHeight: 1.4, marginBottom: '6px', whiteSpace: 'pre-line' }}>
                        {fmtSummary(item.summary, item.summary_en)}
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', color: '#64748b' }}>{REPO_LABELS[item.repo] || item.repo}</span>
                        <span style={{ fontSize: '10px', color: '#475569' }}>·</span>
                        <span style={{ fontSize: '10px', color: '#64748b' }}>{item.category}</span>
                        {item.tech_stack?.slice(0, 3).map(t => (
                          <span key={t} style={{ fontSize: '10px', color: '#475569', background: '#1e293b', padding: '0 4px', borderRadius: '3px' }}>{t}</span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Detail panel */}
            {selected && (
              <div style={{
                flex: '0 0 45%', overflow: 'auto', background: '#0f172a',
                border: '1px solid #1e293b', borderRadius: '8px', padding: '14px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', color: '#e2e8f0' }}>{selected.name}</h4>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <button onClick={() => setLang(nextLang)} style={{
                      background: lang !== 'zh' ? '#2563eb' : '#1e293b',
                      border: '1px solid #334155', borderRadius: '4px',
                      color: lang !== 'zh' ? '#fff' : '#94a3b8',
                      cursor: 'pointer', fontSize: '11px', padding: '2px 8px',
                      fontFamily: 'inherit',
                    }}>{langLabel(lang)}</button>
                    <button onClick={() => { setSelected(null); setDetailBody('') }} style={{
                      background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '16px',
                    }}>✕</button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <Badge label={TYPE_LABELS[selected.type] || selected.type} color="#6366f1" />
                  <Badge label={selected.category} color="#06b6d4" />
                  <Badge label={REPO_LABELS[selected.repo] || selected.repo} color="#f59e0b" />
                  <Badge label={`★ ${selected.score}`} color={scoreColor(selected.score)} />
                </div>
                {selected.source_url && (
                  <div style={{ marginBottom: '8px', fontSize: '11px' }}>
                    <a href={selected.source_url} target="_blank" rel="noreferrer"
                      style={{ color: '#60a5fa', textDecoration: 'none' }}>
                      {selected.source_url}
                    </a>
                  </div>
                )}
                <div style={{ fontSize: '12px', color: '#e2e8f0', lineHeight: 1.6, marginBottom: '8px', whiteSpace: 'pre-line' }}>
                  {fmtSummary(selected.summary, selected.summary_en, 500)}
                </div>
                {detailBody ? (
                  <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.7, whiteSpace: 'pre-wrap',
                    background: '#1e293b', padding: '12px', borderRadius: '8px', border: '1px solid #334155',
                  }}>
                    {detailBody.slice(0, 3000)}
                    {detailBody.length > 3000 && <span style={{ color: '#64748b' }}>...(内容截断)</span>}
                  </div>
                ) : (
                  <div style={{ fontSize: '11px', color: '#64748b', padding: '20px', textAlign: 'center' }}>加载详情中...</div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Leaderboard footer */}
      {leaderboard.length > 0 && (
        <div style={{
          borderTop: '1px solid #1e293b', paddingTop: '10px', marginTop: '4px',
        }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>评分排行</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {leaderboard.slice(0, 6).map((entry, i) => (
              <div key={entry.id} style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '11px', color: '#cbd5e1',
              }}>
                <span style={{ color: i === 0 ? '#f59e0b' : '#64748b', fontWeight: 600 }}>#{i + 1}</span>
                <span>{entry.name}</span>
                <span style={{ color: scoreColor(entry.score) }}>★{entry.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AddTipPanel() {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px', background: '#0f172a' }}>
      <div style={{ fontSize: '14px', fontWeight: 600, color: '#67e8f9', marginBottom: '12px' }}>如何添加资源到深蓝工坊？</div>
      <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.8 }}>
        在<strong style={{ color: '#a78bfa' }}>驾驭智能体</strong>对话中直接告诉 AI：
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
        {[
          { icon: '💬', title: '描述你的资源', text: '我有一个好用的提示词 / 模板 / 工具，帮我入库', sub: 'AI 自动提取关键信息、分类、评分，写入待审核列表' },
          { icon: '🔗', title: '分享链接', text: '发现了一个不错的 GitHub 项目 / npm 包 / Skill', sub: 'AI 检索确认无重复后，自动整理并提交到对应仓库' },
          { icon: '✅', title: '审核入库', text: '在待审核面板点击「一键入库」审核通过', sub: '自动写入本地仓库，再点「↑ 提交」推送到 GitHub' },
        ].map((tip, i) => (
          <div key={i} style={{ background: '#1e293b', borderRadius: '8px', padding: '12px 14px', border: '1px solid #334155' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <span style={{ flexShrink: 0, fontSize: '20px' }}>{tip.icon}</span>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0', marginBottom: '4px' }}>{tip.title}</div>
                <div style={{ fontSize: '11px', color: '#cbd5e1', lineHeight: 1.6 }}>{tip.text}</div>
                <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>{tip.sub}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PendingPanel({ pendingItems, auditing, auditResults, approving, onAuditAll, onRefresh, onClearResults, onApprove, onRemove }: {
  pendingItems: PendingItem[]
  auditing: boolean
  auditResults: Array<{ id: string; name: string; success: boolean; score: number; message: string }>
  approving: string | null
  onAuditAll: () => void
  onRefresh: () => void
  onClearResults: () => void
  onApprove: (id: string) => void
  onRemove: (id: string) => void
}) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '10px 12px', background: '#0f172a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
          待审核资源 ({pendingItems.length})
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={onAuditAll}
            disabled={auditing || pendingItems.filter(i => i.status === 'pending').length === 0}
            style={{
              padding: '4px 10px', fontSize: '11px', background: '#059669', color: '#fff',
              border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600,
              opacity: auditing || pendingItems.filter(i => i.status === 'pending').length === 0 ? 0.5 : 1,
            }}>
            {auditing ? '处理中...' : '一键入库'}
          </button>
          <button onClick={onRefresh}
            style={{
              padding: '4px 10px', fontSize: '11px', background: '#1e293b', color: '#94a3b8',
              border: '1px solid #334155', borderRadius: '4px', cursor: 'pointer',
            }}>刷新</button>
        </div>
      </div>
      {auditResults.length > 0 && (
        <div style={{ marginBottom: '8px', padding: '8px 10px', background: '#05966911', borderRadius: '6px', border: '1px solid #05966933' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#34d399' }}>
              入库完成 ({auditResults.filter(r => r.success).length}/{auditResults.length})
            </span>
            <button onClick={onClearResults}
              style={{ padding: '2px 8px', fontSize: '10px', background: 'none', color: '#94a3b8', border: '1px solid #334155', borderRadius: '4px', cursor: 'pointer' }}>关闭</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '150px', overflow: 'auto' }}>
            {auditResults.map(r => (
              <div key={r.id} style={{ fontSize: '10px', color: r.success ? '#34d399' : '#ef4444', display: 'flex', gap: '6px' }}>
                <span>{r.success ? '✓' : '✕'}</span>
                <span style={{ color: '#cbd5e1' }}>{r.name}</span>
                <span style={{ color: '#64748b' }}>评分 {r.score}</span>
                <span>{r.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {pendingItems.length === 0 ? (
        <div style={{ fontSize: '11px', color: '#64748b', padding: '20px 0', textAlign: 'center' }}>
          暂无待审资源。在驾驭智能体对话中让 AI 搜索并推荐资源。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[...pendingItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(item => (
            <PendingItemCard
              key={item.id}
              item={item}
              onApprove={onApprove}
              onRemove={onRemove}
              approving={approving}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CommitPanel({ commitCheck, commitResult, committing, onClose, onCommitAll }: {
  commitCheck: Record<string, { hasRemote: boolean; behind: number; localChanges: Array<{ path: string; status: string }>; uncommittedIds: string[] }>
  commitResult: Array<{ repo: string; success: boolean; message: string; step?: string }> | null
  committing: boolean
  onClose: () => void
  onCommitAll: () => void
}) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '10px 12px', background: '#0f172a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>提交用户贡献到 GitHub</div>
        <button onClick={onClose}
          style={{ fontSize: '10px', padding: '2px 8px', background: 'none', color: '#94a3b8', border: '1px solid #334155', borderRadius: '4px', cursor: 'pointer' }}>← 返回列表</button>
      </div>
      {(['DeepBluePrompt', 'DeepBlueCase', 'DeepBlueKit', 'DeepBlueIdentity'] as const).map(repo => {
        const st = commitCheck[repo]
        if (!st) return null
        const hasChanges = st.localChanges.length > 0
        const hasBlocked = st.localChanges.some(f => f.status !== '??' && f.status !== 'A' && f.status !== 'AM')
        return (
          <div key={repo} style={{ marginBottom: '8px', padding: '8px 10px', background: '#1e293b', borderRadius: '6px', fontSize: '11px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: hasChanges ? '6px' : 0 }}>
              <span style={{ fontWeight: 600, color: hasChanges ? '#f59e0b' : '#64748b', fontSize: '12px' }}>{repo.replace('DeepBlue', '')}</span>
              {st.hasRemote && <span style={{ color: '#f59e0b', fontSize: '10px' }}>远程有更新 (↓{st.behind})</span>}
              {hasChanges ? (
                <span style={{ color: '#f59e0b', fontSize: '10px' }}>{st.localChanges.length} 个待提交文件</span>
              ) : (
                <span style={{ color: '#34d399', fontSize: '10px' }}>✓ 无变更</span>
              )}
            </div>
            {hasChanges && (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {st.localChanges.slice(0, 15).map(f => (
                    <span key={f.path} style={{ fontSize: '9px', color: '#94a3b8', background: '#0f172a', padding: '2px 6px', borderRadius: '3px', fontFamily: 'monospace' }}>
                      [{f.status}] {f.path.slice(0, 60)}
                    </span>
                  ))}
                  {st.localChanges.length > 15 && <span style={{ fontSize: '9px', color: '#64748b' }}>+{st.localChanges.length - 15} 更多</span>}
                </div>
                {hasBlocked && (
                  <div style={{ fontSize: '9px', color: '#f59e0b', marginTop: '6px', padding: '4px 8px', background: '#f59e0b11', borderRadius: '3px' }}>
                    ⚠ 检测到修改/删除文件（状态码非 ??/A/AM），仅新增文件会被提交
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
      {commitResult && (
        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {commitResult.map(r => {
            const stepLabel = r.step === 'scope-check' ? '安全检查' :
              r.step === 'pull' ? '拉取' : r.step === 'commit' ? '提交' :
              r.step === 'push' ? '推送' : ''
            return (
              <div key={r.repo} style={{
                fontSize: '11px',
                color: r.success ? '#34d399' : '#ef4444',
                background: r.success ? '#05966911' : '#ef444411',
                padding: '6px 8px',
                borderRadius: '4px',
                border: `1px solid ${r.success ? '#05966933' : '#ef444433'}`,
                whiteSpace: 'pre-wrap',
                lineHeight: 1.5,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                  <span style={{ flexShrink: 0 }}>{r.success ? '✓' : '✕'}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600 }}>
                      {r.repo.replace('DeepBlue', '')}
                      {r.step ? ` [${stepLabel}]` : ''}:
                    </span>
                    <span> {r.message}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <button onClick={onCommitAll}
        disabled={committing || !Object.values(commitCheck).some(s => s.localChanges.length > 0)}
        style={{
          marginTop: '10px', padding: '8px 20px', fontSize: '12px', fontWeight: 600,
          background: committing ? '#334155' : '#059669', color: '#fff',
          border: 'none', borderRadius: '6px', cursor: committing ? 'default' : 'pointer',
          opacity: committing || !Object.values(commitCheck).some(s => s.localChanges.length > 0) ? 0.5 : 1,
        }}>
        {committing ? '提交中...' : '确认提交并推送到 GitHub'}
      </button>
    </div>
  )
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: '10px', padding: '2px 8px', borderRadius: '10px',
      background: `${color}22`, color, border: `1px solid ${color}44`,
      fontWeight: 500,
    }}>
      {label}
    </span>
  )
}

function PendingItemCard({ item, onApprove, onRemove, approving }: {
  item: PendingItem; onApprove: (id: string) => void; onRemove: (id: string) => void; approving: string | null
}) {
  const scoreColor = (s: number) => {
    if (s >= 7) return '#34d399'
    if (s >= 4) return '#f59e0b'
    return '#ef4444'
  }
  return (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '6px', padding: '8px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0' }}>{item.name}</span>
          <span style={{ fontSize: '10px', color: '#64748b', marginLeft: '8px' }}>
            {REPO_LABELS[item.targetRepo] || item.targetRepo} / {TYPE_LABELS[item.resourceType] || item.resourceType}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0, marginLeft: '8px' }}>
          {item.status === 'audited' && (
            <span style={{ fontSize: '11px', fontWeight: 600, color: scoreColor(item.auditScore) }}>
              {item.auditScore}/10
            </span>
          )}
          {item.status === 'approved' && <span style={{ fontSize: '10px', color: '#34d399' }}>已批准</span>}
          {item.status === 'pending' && <span style={{ fontSize: '10px', color: '#f59e0b' }}>待审核</span>}
          {(item.status === 'audited') && item.auditScore >= 4 && (
            <button onClick={() => onApprove(item.id)}
              disabled={approving === item.id}
              style={{
                padding: '2px 8px', fontSize: '10px', background: '#059669',
                color: '#fff', border: 'none', borderRadius: '4px', cursor: approving === item.id ? 'default' : 'pointer',
                opacity: approving === item.id ? 0.5 : 1,
              }}>
              {approving === item.id ? '...' : '批准'}
            </button>
          )}
          <button onClick={() => onRemove(item.id)}
            style={{
              padding: '2px 6px', fontSize: '10px', background: 'none', color: '#ef4444',
              border: '1px solid #ef444444', borderRadius: '4px', cursor: 'pointer',
            }}>删除</button>
        </div>
      </div>
      <div style={{ fontSize: '10px', color: '#94a3b8', lineHeight: 1.4, marginBottom: '4px' }}>
        {item.summary.slice(0, 150)}
      </div>
      {item.sourceUrl && (
        <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '4px' }}>
          来源: <a href={item.sourceUrl} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', textDecoration: 'none' }}>{item.sourceUrl.slice(0, 60)}</a>
        </div>
      )}
      {item.status === 'audited' && item.auditNotes && (
        <div style={{ fontSize: '10px', color: '#94a3b8', background: '#1e293b', padding: '4px 8px', borderRadius: '4px', lineHeight: 1.5, maxHeight: '60px', overflow: 'auto' }}>
          {item.auditNotes.slice(0, 300)}
        </div>
      )}
    </div>
  )
}
