// 角色管理面板 — 设置页内嵌组件
import React, { useEffect, useState } from 'react'
import RoleCard from './RoleCard'
import CreateRoleForm from './CreateRoleForm'

interface RoleEntry {
  role: {
    id: string
    name: string
    description: string
    systemPrompt: string
    allowedTools: string[]
    deniedTools: string[]
    triggerKeywords: string[]
    isDefault: boolean
  }
  score: {
    compositeScore: number
    successRate: number
    reliability: number
    totalTasks: number
  } | null
  isCustom: boolean
  enabled: boolean
}

interface LeaderboardEntry {
  roleId: string
  roleName: string
  compositeScore: number
  successRate: number
  totalTasks: number
}

const RoleManagement: React.FC = () => {
  const [systemEnabled, setSystemEnabled] = useState(false)
  const [roles, setRoles] = useState<RoleEntry[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    try {
      const [listRes, boardRes] = await Promise.all([
        window.electronAPI.harnessRolesList(),
        window.electronAPI.harnessRolesLeaderboard(4),
      ])
      if (listRes.success) {
        setRoles(listRes.roles)
        // 从启用状态推断主开关（所有启用 = 开）
        const anyEnabled = listRes.roles.some((r: RoleEntry) => r.enabled && !r.role.isDefault)
        // 读取配置中的主开关
        const configRes = await window.electronAPI.harnessRolesLoadConfig()
        setSystemEnabled(configRes.success ? configRes.config.roleSystemEnabled : anyEnabled)
      }
      if (boardRes.success) setLeaderboard(boardRes.leaderboard)
    } catch (e) {
      console.error('加载角色数据失败:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const handleSystemToggle = async (enabled: boolean) => {
    setSystemEnabled(enabled)
    await window.electronAPI.harnessRolesSetSystemEnabled(enabled)
  }

  const handleRoleToggle = async (roleId: string, enabled: boolean) => {
    // Optimistic update
    setRoles(prev => prev.map(r => r.role.id === roleId ? { ...r, enabled } : r))
    await window.electronAPI.harnessRolesSetRoleEnabled(roleId, enabled)
  }

  const handleDelete = async (roleId: string) => {
    if (!confirm(`确认删除角色 "${roleId}"？此操作不可撤销。`)) return
    const result = await window.electronAPI.harnessRolesDelete(roleId)
    if (result.success) {
      setRoles(prev => prev.filter(r => r.role.id !== roleId))
    } else {
      alert(result.message)
    }
  }

  const handleCreated = () => {
    setShowCreateForm(false)
    loadData()
  }

  if (loading) {
    return (
      <div style={{ padding: '16px 0', textAlign: 'center', color: '#6b7280', fontSize: '13px' }}>
        加载角色配置中...
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div>
          <h3 style={{ margin: '0', fontSize: '16px', color: '#1f2937', fontWeight: 600 }}>
            驾驭角色管理
          </h3>
          <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#6b7280' }}>
            {systemEnabled ? '角色系统已启用，将根据用户消息自动切换角色' : '角色系统已关闭，始终使用 CEO 角色'}
          </p>
        </div>
        <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: systemEnabled ? '#059669' : '#6b7280' }}>
            {systemEnabled ? '✓ 已启用' : '○ 已关闭'}
          </span>
          <input type="checkbox" checked={systemEnabled}
            onChange={e => handleSystemToggle(e.target.checked)}
            style={{ width: '18px', height: '18px' }} />
        </label>
      </div>

      {/* Leaderboard (only when system enabled and has data) */}
      {systemEnabled && leaderboard.length > 0 && (
        <div style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: '10px',
          padding: '12px 16px',
          marginBottom: '12px',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>评分排行榜</div>
          <div style={{ display: 'flex', gap: '12px' }}>
            {leaderboard.slice(0, 4).map((entry, i) => (
              <div key={entry.roleId} style={{
                flex: 1, textAlign: 'center',
                padding: '8px', background: '#f9fafb', borderRadius: '8px',
              }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#1f2937' }}>{entry.roleName}</div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: i === 0 ? '#059669' : '#6b7280' }}>
                  {entry.compositeScore.toFixed(0)}
                </div>
                <div style={{ fontSize: '10px', color: '#9ca3af' }}>
                  {(entry.successRate * 100).toFixed(0)}% / {entry.totalTasks}任务
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Role list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {roles.map(entry => (
          <div key={entry.role.id} style={systemEnabled ? {} : { opacity: 0.5, pointerEvents: 'none' }}>
            <RoleCard
              role={entry.role}
              score={entry.score}
              isCustom={entry.isCustom}
              enabled={systemEnabled ? entry.enabled : false}
              onToggle={() => handleRoleToggle(entry.role.id, !entry.enabled)}
              onDelete={entry.isCustom ? () => handleDelete(entry.role.id) : undefined}
            />
          </div>
        ))}
      </div>

      {/* Create custom role */}
      {systemEnabled && (
        <div style={{ marginTop: '12px' }}>
          {!showCreateForm ? (
            <button onClick={() => setShowCreateForm(true)} style={{
              padding: '8px 16px',
              fontSize: '12px',
              background: '#fff',
              color: '#2563eb',
              border: '1px dashed #93c5fd',
              borderRadius: '8px',
              cursor: 'pointer',
              width: '100%',
            }}>
              + 创建自定义角色
            </button>
          ) : (
            <CreateRoleForm
              onCreated={handleCreated}
              onCancel={() => setShowCreateForm(false)}
            />
          )}
        </div>
      )}
    </div>
  )
}

export default RoleManagement
