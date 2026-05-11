import { useMemo } from 'react'
import { useRoleContext } from '../../context/RoleContext'
import { SKILL_XP_MAP } from '../../roles/roleDefinitions'
import type { SkillFragment } from '../../roles/fragmentTypes'

interface SummaryStat {
  label: string; value: string; sub: string
}

export const EfficiencyDashboard: React.FC = () => {
  const [state] = useRoleContext()
  const { fragments, identity } = state

  const stats = useMemo((): SummaryStat[] => {
    if (fragments.length === 0) return []

    // 按日期分组统计
    const byDate: Record<string, number> = {}
    for (const f of fragments) {
      const day = f.timestamp.slice(0, 10)
      byDate[day] = (byDate[day] || 0) + 1
    }
    const days = Object.keys(byDate).length
    const avgPerDay = days > 0 ? Math.round(fragments.length / days * 10) / 10 : 0

    // 按类型统计
    const byType: Record<string, number> = {}
    for (const f of fragments) {
      byType[f.skillType] = (byType[f.skillType] || 0) + 1
    }
    const topType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0]

    // 计算总 XP
    const totalXp = fragments.reduce((sum, f) => sum + (SKILL_XP_MAP[f.skillType] || 5), 0)

    // AI token 近似（每个 AI 碎片 2000 tokens）
    const aiCalls = fragments.filter(f => f.category === 'ai').length

    return [
      { label: '总操作', value: String(fragments.length), sub: `日均 ${avgPerDay}` },
      { label: '活跃天数', value: String(days), sub: '天' },
      { label: '总 XP', value: String(totalXp), sub: topType ? `最多: ${topType[0]}` : '' },
      { label: 'AI 调用', value: String(aiCalls), sub: `估算 ~${aiCalls * 2}K tokens` },
      { label: 'CLI 命令', value: String(byType['cli.command'] || 0), sub: `批量: ${byType['cli.batch'] || 0}` },
      { label: '版本操作', value: String(fragments.filter(f => f.category === 'vcs').length), sub: '快照/提交/回滚' },
    ]
  }, [fragments])

  // 按类别分布
  const categoryDistribution = useMemo(() => {
    const cats: Record<string, number> = {}
    for (const f of fragments) {
      cats[f.category] = (cats[f.category] || 0) + 1
    }
    const max = Math.max(...Object.values(cats), 1)
    return Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([cat, count]) => ({
      category: cat, count, pct: Math.round(count / max * 100),
    }))
  }, [fragments])

  // 近 7 天趋势
  const recentTrend = useMemo(() => {
    const days: Record<string, number> = {}
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000)
      days[d.toISOString().slice(0, 10)] = 0
    }
    for (const f of fragments) {
      const day = f.timestamp.slice(0, 10)
      if (day in days) days[day]++
    }
    return Object.entries(days)
  }, [fragments])

  if (fragments.length === 0) {
    return (
      <div style={{ padding: '24px', color: '#666', textAlign: 'center' }}>
        <div style={{ fontSize: '40px', marginBottom: '8px' }}>📊</div>
        <div>开始使用驾驭工程来生成效率数据</div>
        <div style={{ fontSize: '12px', marginTop: '4px', color: '#555' }}>
          执行命令、AI 对话、项目管理等操作将自动记录
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '16px', height: '100%', overflow: 'auto' }}>
      <h3 style={{ margin: '0 0 12px 0', color: '#e0e0e0' }}>效率仪表盘</h3>

      {/* 摘要卡片 */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: '8px', marginBottom: '16px',
      }}>
        {stats.map(stat => (
          <div key={stat.label} style={{
            background: '#1e1e2e', borderRadius: '8px', padding: '12px',
            border: '1px solid #333', textAlign: 'center',
          }}>
            <div style={{ color: '#7c3aed', fontSize: '24px', fontWeight: 700 }}>{stat.value}</div>
            <div style={{ color: '#ccc', fontSize: '12px', marginTop: '2px' }}>{stat.label}</div>
            <div style={{ color: '#666', fontSize: '10px', marginTop: '2px' }}>{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* 类别分布 */}
      <div style={{
        background: '#1e1e2e', borderRadius: '8px', padding: '14px', marginBottom: '12px',
        border: '1px solid #333',
      }}>
        <h4 style={{ margin: '0 0 10px 0', color: '#ccc', fontSize: '13px' }}>技能类别分布</h4>
        {categoryDistribution.map(cat => (
          <div key={cat.category} style={{ marginBottom: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
              <span style={{ color: '#aaa', fontSize: '12px' }}>{cat.category}</span>
              <span style={{ color: '#888', fontSize: '11px' }}>{cat.count}</span>
            </div>
            <div style={{ height: '6px', background: '#333', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${cat.pct}%`,
                background: 'linear-gradient(90deg, #7c3aed, #6366f1)',
                borderRadius: '3px', transition: 'width 0.5s',
              }} />
            </div>
          </div>
        ))}
      </div>

      {/* 近 7 天趋势 */}
      <div style={{
        background: '#1e1e2e', borderRadius: '8px', padding: '14px',
        border: '1px solid #333',
      }}>
        <h4 style={{ margin: '0 0 10px 0', color: '#ccc', fontSize: '13px' }}>近 7 天操作趋势</h4>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '100px' }}>
          {recentTrend.map(([day, count]) => {
            const maxVal = Math.max(...recentTrend.map(([, c]) => c), 1)
            const h = Math.max(4, Math.round(count / maxVal * 80))
            const today = new Date().toISOString().slice(0, 10)
            return (
              <div key={day} style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: '4px',
              }}>
                <span style={{ color: '#888', fontSize: '10px' }}>{count}</span>
                <div style={{
                  width: '100%', height: `${h}px`,
                  background: day === today
                    ? 'linear-gradient(180deg, #7c3aed, #6366f1aa)'
                    : 'linear-gradient(180deg, #444, #333)',
                  borderRadius: '3px 3px 0 0', transition: 'height 0.3s',
                }} />
                <span style={{
                  color: day === today ? '#7c3aed' : '#666', fontSize: '9px',
                  fontWeight: day === today ? 600 : 400,
                }}>
                  {day.slice(5)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
