import { useState } from 'react'
import { useRoleContext, ROLE_DEFINITIONS } from '../../context/RoleContext'
import { useI18n } from '../../i18n'
import type { SynthesizedRole } from '../../roles/roleDefinitions'

export const IdentityProfile: React.FC = () => {
  const [state, dispatch] = useRoleContext()
  const { t } = useI18n()
  const { identity, fragments } = state
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(state.displayName)

  if (!identity) {
    return (
      <div style={{ padding: '16px', color: '#666', textAlign: 'center' }}>
        {t.identity.noProfileHint}
      </div>
    )
  }

  const activeRole = identity.synthesizedRoles.find(r => r.roleId === identity.activeRoleId)
  const roleDef = ROLE_DEFINITIONS.find(r => r.id === identity.activeRoleId)
  const totalXp = identity.synthesizedRoles.reduce((sum, r) => {
    const def = ROLE_DEFINITIONS.find(d => d.id === r.roleId)
    if (!def) return sum
    let xp = 0
    for (const cat of def.primaryCategories) {
      const catFrags = fragments.filter(f => f.category === cat)
      xp += catFrags.length * 10
    }
    return sum + xp
  }, 0)

  const handleSaveName = () => {
    dispatch({ type: 'SET_DISPLAY_NAME', payload: nameInput || t.identity.defaultName })
    setEditingName(false)
  }

  return (
    <div style={{ padding: '16px', height: '100%', overflow: 'auto' }}>
      {/* 玩家卡片 */}
      <div style={{
        background: `linear-gradient(135deg, ${roleDef?.color || '#6366f1'}22, #1e1e2e)`,
        borderRadius: '12px', padding: '20px', marginBottom: '16px',
        border: `1px solid ${roleDef?.color || '#6366f1'}44`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '50%',
            background: roleDef?.color || '#6366f1',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '28px', flexShrink: 0,
          }}>
            {roleDef?.icon || '\u{1F916}'}
          </div>
          <div style={{ flex: 1 }}>
            {editingName ? (
              <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                <input
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                  style={{
                    background: '#16162a', border: '1px solid #444', borderRadius: '4px',
                    color: '#e0e0e0', padding: '4px 8px', fontSize: '16px', width: '140px',
                  }}
                  autoFocus
                />
                <button onClick={handleSaveName} style={{
                  background: '#7c3aed', color: '#fff', border: 'none',
                  borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px',
                }}>{t.identity.save}</button>
              </div>
            ) : (
              <h2
                onClick={() => { setNameInput(state.displayName); setEditingName(true) }}
                style={{ margin: '0 0 4px 0', color: '#e0e0e0', fontSize: '20px', cursor: 'pointer' }}
                title={t.identity.clickEditName}
              >
                {state.displayName}
              </h2>
            )}
            <div style={{ color: roleDef?.color || '#888', fontSize: '14px', fontWeight: 600 }}>
              {identity.title}
            </div>
          </div>
        </div>
        <div style={{ color: '#888', fontSize: '11px' }}>
          {t.identity.joinedAt} {new Date(identity.joinedAt).toLocaleDateString()} · {t.identity.totalOps} {identity.totalFragments}
        </div>
      </div>

      {/* 角色列表 */}
      <h3 style={{ margin: '0 0 10px 0', color: '#ccc', fontSize: '14px' }}>{t.identity.harnessRoles}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {identity.synthesizedRoles.map(role => {
          const def = ROLE_DEFINITIONS.find(d => d.id === role.roleId)
          if (!def) return null
          const isActive = role.roleId === identity.activeRoleId
          const xpPercent = Math.round((role.xp / (role.xpToNextLevel || 1)) * 100)
          return (
            <div
              key={role.roleId}
              onClick={() => dispatch({ type: 'SWITCH_ROLE', payload: role.roleId })}
              style={{
                background: isActive ? `${def.color}18` : '#1e1e2e',
                borderRadius: '8px', padding: '12px', cursor: 'pointer',
                border: isActive ? `1px solid ${def.color}66` : '1px solid #333',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '20px' }}>{def.icon}</span>
                  <div>
                    <div style={{ color: '#e0e0e0', fontSize: '13px', fontWeight: 600 }}>{def.name}</div>
                    <div style={{ color: '#888', fontSize: '11px' }}>Lv.{role.level}</div>
                  </div>
                </div>
                {isActive && (
                  <span style={{
                    padding: '2px 8px', borderRadius: '10px', fontSize: '10px',
                    background: def.color, color: '#fff', fontWeight: 600,
                  }}>{t.identity.current}</span>
                )}
              </div>
              {/* XP 进度条 */}
              <div style={{
                height: '4px', background: '#333', borderRadius: '2px', overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', width: `${xpPercent}%`,
                  background: `linear-gradient(90deg, ${def.color}, ${def.color}aa)`,
                  borderRadius: '2px', transition: 'width 0.5s',
                }} />
              </div>
              <div style={{ color: '#666', fontSize: '10px', marginTop: '4px', textAlign: 'right' }}>
                {role.xp} / {role.xpToNextLevel} XP
              </div>
              {role.specializations.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
                  {role.specializations.map(specId => {
                    const spec = def.specializations.find(s => s.id === specId)
                    return spec ? (
                      <span key={specId} style={{
                        padding: '1px 6px', borderRadius: '3px', fontSize: '10px',
                        background: `${def.color}22`, color: def.color, border: `1px solid ${def.color}44`,
                      }} title={spec.description}>
                        {spec.icon} {spec.name}
                      </span>
                    ) : null
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
