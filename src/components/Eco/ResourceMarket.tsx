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

const REPO_LABELS: Record<string, string> = {
  DeepBluePrompt: '深蓝提示词库',
  DeepBlueCase: '深蓝案例坊',
  DeepBlueKit: '深蓝工具集',
}

const TYPE_LABELS: Record<string, string> = {
  prompt: '提示词', template: '模板', case: '案例',
  plugin: '插件', tool: '工具', skill: '技能',
  'mcp-server': 'MCP服务', 'agent-framework': 'Agent框架', 'ai-assistant': 'AI助手',
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
}

// 模块级缓存：避免组件卸载/重新挂载（切 Tab）时重复执行 Git 操作
let _autoSyncDone = false
let _repoStatusesCache: Record<string, any> | null = null

export function ResourceMarket() {
  const [initialized, setInitialized] = useState(false)
  const [resources, setResources] = useState<ResourceItem[]>([])
  const [search, setSearch] = useState('')
  const [repoFilter, setRepoFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [selected, setSelected] = useState<ResourceItem | null>(null)
  const [detailBody, setDetailBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [leaderboard, setLeaderboard] = useState<Array<{ id: string; name: string; type: string; score: number }>>([])

  // Git sync state
  const [repoStatuses, setRepoStatuses] = useState<Record<string, { behind: number; ahead: number; branch: string; exists: boolean; isGit: boolean }>>({})
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState('')

  // Contribution flow state
  const [showContribute, setShowContribute] = useState(false)
  const [contributeRepo, setContributeRepo] = useState('')
  const [contributeBranch, setContributeBranch] = useState('')
  const [contributeMsg, setContributeMsg] = useState('')
  const [contributePRTitle, setContributePRTitle] = useState('')
  const [contributePRBody, setContributePRBody] = useState('')
  const [contributeStep, setContributeStep] = useState<'idle' | 'branch' | 'committed' | 'pushed' | 'done'>('idle')
  const [contributeWorking, setContributeWorking] = useState(false)
  const [contributeResult, setContributeResult] = useState('')

  // Pending review state
  const [showPending, setShowPending] = useState(false)
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [auditing, setAuditing] = useState(false)
  const [approving, setApproving] = useState<string | null>(null)
  const [auditPrompt, setAuditPrompt] = useState('')
  const [lang, setLang] = useState<'zh' | 'en' | 'bilingual'>('zh')
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
      if (r.synced.length > 0) {
        loadResources()
        loadLeaderboard()
      }
    } catch { /* ignore */ }
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
    const repos = ['DeepBluePrompt', 'DeepBlueCase', 'DeepBlueKit']
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
    if (!window.confirm('是否一键克隆全部三个深蓝工坊仓库到本地？\n\nClone all 3 DeepBlue Workshop repos?')) return
    const repos = ['DeepBluePrompt', 'DeepBlueCase', 'DeepBlueKit']
    for (const repo of repos) {
      await handleClone(repo, true)
    }
  }

  const handleContributeStart = async () => {
    if (!contributeRepo || !contributeBranch) return
    setContributeWorking(true)
    setContributeResult('')
    try {
      const res = await window.electronAPI.resourceContributeBranch(contributeRepo, contributeBranch)
      if (res.success) {
        setContributeStep('branch')
        setContributeResult(`分支 ${contributeBranch} 已创建，请在对应仓库目录添加资源文件`)
      } else {
        setContributeResult(res.message)
      }
    } catch { /* ignore */ }
    setContributeWorking(false)
  }

  const handleContributeCommit = async () => {
    if (!contributeRepo || !contributeMsg) return
    setContributeWorking(true)
    setContributeResult('')
    try {
      const res = await window.electronAPI.resourceContributeCommit(contributeRepo, contributeMsg)
      if (res.success) {
        setContributeStep('committed')
        setContributeResult('变更已提交')
      } else {
        setContributeResult(res.message)
      }
    } catch { /* ignore */ }
    setContributeWorking(false)
  }

  const handleContributePush = async () => {
    if (!contributeRepo || !contributeBranch) return
    setContributeWorking(true)
    setContributeResult('')
    try {
      const res = await window.electronAPI.resourceContributePush(contributeRepo, contributeBranch)
      if (res.success) {
        setContributeStep('pushed')
        setContributeResult('已推送到 GitHub')
      } else {
        setContributeResult(res.message)
      }
    } catch { /* ignore */ }
    setContributeWorking(false)
  }

  const handleContributePR = async () => {
    if (!contributeRepo || !contributeBranch || !contributePRTitle) return
    setContributeWorking(true)
    setContributeResult('')
    try {
      const res = await window.electronAPI.resourceContributePR(contributeRepo, contributeBranch, contributePRTitle, contributePRBody)
      if (res.success) {
        setContributeStep('done')
        setContributeResult(res.url ? `PR 已创建: ${res.url}` : 'PR 已创建')
      } else {
        setContributeResult(res.message)
      }
    } catch { /* ignore */ }
    setContributeWorking(false)
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

  const handleAuditTrigger = async () => {
    setAuditing(true)
    try {
      const res = await window.electronAPI.pendingAuditTrigger()
      if (res.success && res.prompt) {
        setAuditPrompt(res.prompt)
      }
    } catch { /* ignore */ }
    setAuditing(false)
  }

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
          {['DeepBluePrompt', 'DeepBlueCase', 'DeepBlueKit'].map(repo => (
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
        <select value={repoFilter} onChange={e => setRepoFilter(e.target.value)} style={{
          padding: '6px 8px', fontSize: '11px', background: '#1e293b',
          border: '1px solid #334155', borderRadius: '6px', color: '#e2e8f0',
        }}>
          <option value="all">全部仓库</option>
          <option value="DeepBluePrompt">提示词库</option>
          <option value="DeepBlueCase">案例坊</option>
          <option value="DeepBlueKit">工具集</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{
          padding: '6px 8px', fontSize: '11px', background: '#1e293b',
          border: '1px solid #334155', borderRadius: '6px', color: '#e2e8f0',
        }}>
          <option value="all">全部类型</option>
          <option value="prompt">提示词</option>
          <option value="template">模板</option>
          <option value="case">案例</option>
          <option value="plugin">插件</option>
          <option value="tool">工具</option>
          <option value="skill">技能</option>
          <option value="mcp-server">MCP服务</option>
          <option value="agent-framework">Agent框架</option>
          <option value="ai-assistant">AI助手</option>
        </select>
        <button onClick={handleSearch} style={{
          padding: '6px 14px', fontSize: '12px', background: '#06b6d4', color: '#fff',
          border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600,
        }}>搜索</button>
      </div>

      {/* Sync & Contribute toolbar */}
      <div style={{ display: 'flex', gap: '6px', padding: '6px 0', borderBottom: '1px solid #1e293b', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        {(['DeepBluePrompt', 'DeepBlueCase', 'DeepBlueKit'] as const).map(repo => {
          const st = repoStatuses[repo]
          const missing = st && !st.exists
          const notGit = st && st.exists && !st.isGit
          if (missing || notGit) {
            return (
              <button key={repo} onClick={() => handleClone(repo)}
                disabled={syncing === repo}
                style={{
                  fontSize: '10px', padding: '3px 8px', borderRadius: '4px', fontWeight: 500,
                  border: '1px solid #334155', cursor: syncing === repo ? 'not-allowed' : 'pointer',
                  background: '#d9770622', color: '#f59e0b',
                  opacity: syncing === repo ? 0.5 : 1,
                }}>
                {syncing === repo ? '⟳' : '⬇'} {repo.replace('DeepBlue', '')} {missing ? '(未克隆)' : '(需修复)'}
              </button>
            )
          }
          return (
            <span key={repo} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button onClick={() => handleSync(repo)}
                disabled={syncing === repo}
                title={st ? `${st.branch} | behind:${st.behind} ahead:${st.ahead}` : '加载中...'}
                style={{
                  fontSize: '10px', padding: '3px 8px', borderRadius: '4px', fontWeight: 500,
                  border: '1px solid #334155', cursor: syncing === repo ? 'not-allowed' : 'pointer',
                  background: st?.behind ? '#d9770622' : '#1e293b',
                  color: st?.behind ? '#f59e0b' : '#94a3b8',
                  opacity: syncing === repo ? 0.5 : 1,
                }}>
                {syncing === repo ? '⟳' : '↡'} {repo.replace('DeepBlue', '')}
                {st?.behind ? ` ${st.behind}` : ''}
              </button>
            </span>
          )
        })}
        <span style={{ flex: 1 }} />
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
        <button onClick={() => { setShowContribute(!showContribute); if (!showContribute) { setContributeStep('idle'); setContributeResult(''); setContributeRepo(''); setContributeBranch(''); setContributeMsg(''); setContributePRTitle(''); setContributePRBody('') } }}
          style={{
            fontSize: '10px', padding: '3px 8px', borderRadius: '4px', fontWeight: 500,
            border: '1px solid #334155',
            background: showContribute ? '#06b6d422' : '#1e293b',
            color: showContribute ? '#06b6d4' : '#94a3b8', cursor: 'pointer',
          }}>{showContribute ? '收起' : '✚ 贡献'}</button>
        <button onClick={() => { setShowPending(!showPending); loadPending(); if (showPending) setAuditPrompt('') }}
          style={{
            fontSize: '10px', padding: '3px 8px', borderRadius: '4px', fontWeight: 500,
            border: '1px solid #334155',
            background: showPending ? '#f59e0b22' : '#1e293b',
            color: showPending ? '#f59e0b' : pendingCount > 0 ? '#f59e0b' : '#94a3b8',
            cursor: 'pointer',
          }}>{showPending ? '收起' : `${pendingCount} 待审`}</button>
        {syncMessage && <span style={{ fontSize: '10px', color: '#34d399', marginLeft: '6px' }}>{syncMessage}</span>}
      </div>

      {/* Contribute panel */}
      {showContribute && (
        <div style={{ padding: '10px 12px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: '6px', marginBottom: '4px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0', marginBottom: '8px' }}>贡献资源到深蓝工坊</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {/* Step: select repo & branch name */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select value={contributeRepo} onChange={e => setContributeRepo(e.target.value)}
                style={{ padding: '4px 8px', fontSize: '11px', background: '#1e293b', border: '1px solid #334155', borderRadius: '4px', color: '#e2e8f0', width: '140px' }}>
                <option value="">选择仓库</option>
                <option value="DeepBluePrompt">DeepBluePrompt</option>
                <option value="DeepBlueCase">DeepBlueCase</option>
                <option value="DeepBlueKit">DeepBlueKit</option>
              </select>
              <input placeholder="分支名 (如 add-react-hook-prompt)"
                value={contributeBranch}
                onChange={e => setContributeBranch(e.target.value)}
                style={{ flex: 1, padding: '4px 8px', fontSize: '11px', background: '#1e293b', border: '1px solid #334155', borderRadius: '4px', color: '#e2e8f0', outline: 'none' }} />
              <button onClick={handleContributeStart} disabled={contributeWorking || !contributeRepo || !contributeBranch}
                style={{ padding: '4px 10px', fontSize: '11px', background: contributeStep === 'idle' ? '#06b6d4' : '#334155', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontWeight: 500, opacity: (!contributeRepo || !contributeBranch) ? 0.5 : 1 }}>
                创建分支
              </button>
            </div>
            {/* Step: commit */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input placeholder="提交信息 (如 add: React Hooks 常用提示词)"
                value={contributeMsg}
                onChange={e => setContributeMsg(e.target.value)}
                disabled={contributeStep === 'idle'}
                style={{ flex: 1, padding: '4px 8px', fontSize: '11px', background: '#1e293b', border: '1px solid #334155', borderRadius: '4px', color: '#e2e8f0', outline: 'none', opacity: contributeStep === 'idle' ? 0.4 : 1 }} />
              <button onClick={handleContributeCommit} disabled={contributeWorking || contributeStep === 'idle' || !contributeMsg}
                style={{ padding: '4px 10px', fontSize: '11px', background: contributeStep === 'branch' ? '#06b6d4' : '#334155', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontWeight: 500, opacity: (contributeStep === 'idle' || !contributeMsg) ? 0.5 : 1 }}>
                提交
              </button>
            </div>
            {/* Step: push + PR */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={handleContributePush} disabled={contributeWorking || contributeStep === 'idle' || contributeStep === 'branch'}
                style={{ padding: '4px 10px', fontSize: '11px', background: contributeStep === 'committed' ? '#06b6d4' : '#334155', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontWeight: 500, opacity: (contributeStep === 'idle' || contributeStep === 'branch') ? 0.5 : 1 }}>
                推送
              </button>
              <input placeholder="PR 标题"
                value={contributePRTitle}
                onChange={e => setContributePRTitle(e.target.value)}
                disabled={contributeStep !== 'pushed'}
                style={{ flex: 1, padding: '4px 8px', fontSize: '11px', background: '#1e293b', border: '1px solid #334155', borderRadius: '4px', color: '#e2e8f0', outline: 'none', opacity: contributeStep !== 'pushed' ? 0.4 : 1 }} />
              <input placeholder="PR 描述 (可选)"
                value={contributePRBody}
                onChange={e => setContributePRBody(e.target.value)}
                disabled={contributeStep !== 'pushed'}
                style={{ flex: 2, padding: '4px 8px', fontSize: '11px', background: '#1e293b', border: '1px solid #334155', borderRadius: '4px', color: '#e2e8f0', outline: 'none', opacity: contributeStep !== 'pushed' ? 0.4 : 1 }} />
              <button onClick={handleContributePR} disabled={contributeWorking || contributeStep !== 'pushed' || !contributePRTitle}
                style={{ padding: '4px 10px', fontSize: '11px', background: contributeStep === 'pushed' ? '#06b6d4' : '#334155', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontWeight: 500, opacity: (contributeStep !== 'pushed' || !contributePRTitle) ? 0.5 : 1 }}>
                创建 PR
              </button>
            </div>
            {/* Progress indicator */}
            <div style={{ display: 'flex', gap: '20px', fontSize: '10px', color: '#64748b' }}>
              <span style={{ color: contributeStep === 'idle' ? '#06b6d4' : '#34d399' }}>① 创建分支</span>
              <span style={{ color: contributeStep === 'branch' ? '#06b6d4' : (contributeStep === 'committed' || contributeStep === 'pushed' || contributeStep === 'done') ? '#34d399' : '#475569' }}>② 提交</span>
              <span style={{ color: contributeStep === 'committed' ? '#06b6d4' : (contributeStep === 'pushed' || contributeStep === 'done') ? '#34d399' : '#475569' }}>③ 推送</span>
              <span style={{ color: contributeStep === 'pushed' ? '#06b6d4' : contributeStep === 'done' ? '#34d399' : '#475569' }}>④ 创建 PR</span>
            </div>
            {contributeResult && (
              <div style={{ fontSize: '11px', padding: '6px 8px', borderRadius: '4px',
                background: contributeStep === 'done' ? '#05966922' : '#1e293b',
                color: contributeStep === 'done' ? '#34d399' : '#f59e0b',
                border: '1px solid #334155', wordBreak: 'break-all' }}>
                {contributeResult}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pending review panel */}
      {showPending && (
        <div style={{ padding: '10px 12px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: '6px', marginBottom: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0' }}>
              待审核资源 ({pendingItems.length})
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={handleAuditTrigger}
                disabled={auditing || pendingItems.filter(i => i.status === 'pending').length === 0}
                style={{
                  padding: '4px 10px', fontSize: '11px', background: '#06b6d4', color: '#fff',
                  border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500,
                  opacity: auditing || pendingItems.filter(i => i.status === 'pending').length === 0 ? 0.5 : 1,
                }}>
                {auditing ? '生成中...' : 'AI 审核'}
              </button>
              <button onClick={loadPending}
                style={{
                  padding: '4px 10px', fontSize: '11px', background: '#1e293b', color: '#94a3b8',
                  border: '1px solid #334155', borderRadius: '4px', cursor: 'pointer',
                }}>刷新</button>
            </div>
          </div>
          {auditPrompt && (
            <div style={{ marginBottom: '8px', padding: '8px 10px', background: '#1e293b', borderRadius: '6px', border: '1px solid #334155' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b' }}>审核提示已生成</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button onClick={() => { navigator.clipboard.writeText(auditPrompt) }}
                    style={{ padding: '2px 8px', fontSize: '10px', background: '#06b6d4', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>复制</button>
                  <button onClick={() => setAuditPrompt('')}
                    style={{ padding: '2px 8px', fontSize: '10px', background: 'none', color: '#94a3b8', border: '1px solid #334155', borderRadius: '4px', cursor: 'pointer' }}>关闭</button>
                </div>
              </div>
              <div style={{ fontSize: '10px', color: '#94a3b8', maxHeight: '120px', overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {auditPrompt.slice(0, 800)}
                {auditPrompt.length > 800 && <span style={{ color: '#64748b' }}>...(已截断)</span>}
              </div>
            </div>
          )}
          {pendingItems.length === 0 ? (
            <div style={{ fontSize: '11px', color: '#64748b', padding: '12px 0', textAlign: 'center' }}>
              暂无待审资源。在 Harness Agent 对话中让 AI 搜索并推荐资源。
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflow: 'auto' }}>
              {[...pendingItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(item => (
                <PendingItemCard
                  key={item.id}
                  item={item}
                  onApprove={handleApprove}
                  onRemove={handlePendingRemove}
                  approving={approving}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
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
                  transition: 'all 0.15s', contain: 'content',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                      <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: TYPE_COLORS[item.type]?.bg || '#d9770622', color: TYPE_COLORS[item.type]?.text || '#fbbf24', flexShrink: 0 }}>{TYPE_LABELS[item.type] || item.type}</span>
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
