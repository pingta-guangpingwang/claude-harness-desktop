// 角色管理 — 单角色卡片组件
import React from 'react'

interface RoleCardProps {
  role: {
    id: string
    name: string
    description: string
    allowedTools: string[]
    deniedTools: string[]
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
  onToggle: () => void
  onDelete?: () => void
}

const ToolPill: React.FC<{ name: string; type: 'allow' | 'deny' }> = ({ name, type }) => (
  <span style={{
    display: 'inline-block',
    padding: '2px 8px',
    margin: '2px 4px 2px 0',
    borderRadius: '10px',
    fontSize: '11px',
    fontWeight: 500,
    background: type === 'allow' ? '#dcfce7' : '#fee2e2',
    color: type === 'allow' ? '#166534' : '#991b1b',
    border: `1px solid ${type === 'allow' ? '#bbf7d0' : '#fecaca'}`,
  }}>
    {name}
  </span>
)

const RoleCard: React.FC<RoleCardProps> = ({ role, score, isCustom, enabled, onToggle, onDelete }) => {
  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${enabled ? '#e5e7eb' : '#f3f4f6'}`,
      borderRadius: '10px',
      padding: '14px 16px',
      opacity: enabled ? 1 : 0.6,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#1f2937' }}>{role.name}</span>
            <code style={{ fontSize: '11px', color: '#6b7280', background: '#f3f4f6', padding: '1px 6px', borderRadius: '4px' }}>
              {role.id}
            </code>
            {role.isDefault && (
              <span style={{ fontSize: '10px', color: '#2563eb', background: '#dbeafe', padding: '1px 6px', borderRadius: '8px', fontWeight: 600 }}>
                内置
              </span>
            )}
            {isCustom && (
              <span style={{ fontSize: '10px', color: '#7c3aed', background: '#ede9fe', padding: '1px 6px', borderRadius: '8px', fontWeight: 600 }}>
                自定义
              </span>
            )}
          </div>
          <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#6b7280', lineHeight: 1.4 }}>{role.description}</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginLeft: '12px' }}>
          <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '11px', color: '#6b7280' }}>{enabled ? '已启用' : '已禁用'}</span>
            <input type="checkbox" checked={enabled} onChange={onToggle} style={{ width: '16px', height: '16px' }} />
          </label>
          {isCustom && onDelete && (
            <button onClick={onDelete} style={{
              padding: '4px 10px',
              fontSize: '11px',
              background: '#fee2e2',
              color: '#991b1b',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              cursor: 'pointer',
            }}>
              删除
            </button>
          )}
        </div>
      </div>

      {/* Tool restrictions */}
      <div style={{ marginBottom: '8px' }}>
        {role.allowedTools.length > 0 && (
          <div style={{ marginBottom: '4px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#166534', marginRight: '4px' }}>允许:</span>
            {role.allowedTools.map(t => <ToolPill key={t} name={t} type="allow" />)}
          </div>
        )}
        {role.deniedTools.length > 0 && (
          <div>
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#991b1b', marginRight: '4px' }}>禁止:</span>
            {role.deniedTools.map(t => <ToolPill key={t} name={t} type="deny" />)}
          </div>
        )}
        {role.allowedTools.length === 0 && role.deniedTools.length === 0 && (
          <span style={{ fontSize: '11px', color: '#059669' }}>所有工具可用</span>
        )}
      </div>

      {/* Score section */}
      {score && score.totalTasks > 0 ? (
        <div style={{
          display: 'flex', gap: '16px', padding: '8px 12px',
          background: '#f9fafb', borderRadius: '8px', border: '1px solid #f3f4f6',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '18px', fontWeight: 700, color: score.compositeScore >= 60 ? '#059669' : score.compositeScore >= 30 ? '#d97706' : '#dc2626' }}>
              {score.compositeScore.toFixed(0)}
            </div>
            <div style={{ fontSize: '10px', color: '#6b7280' }}>综合分</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#1f2937' }}>{(score.successRate * 100).toFixed(0)}%</div>
            <div style={{ fontSize: '10px', color: '#6b7280' }}>成功率</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#1f2937' }}>{(score.reliability * 100).toFixed(0)}%</div>
            <div style={{ fontSize: '10px', color: '#6b7280' }}>可靠性</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#1f2937' }}>{score.totalTasks}</div>
            <div style={{ fontSize: '10px', color: '#6b7280' }}>任务数</div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: '11px', color: '#9ca3af', padding: '4px 0' }}>暂无评分数据</div>
      )}
    </div>
  )
}

export default RoleCard
