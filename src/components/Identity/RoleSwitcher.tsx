import { useRoleContext, ROLE_DEFINITIONS } from '../../context/RoleContext'
import { useI18n } from '../../i18n'

export const RoleSwitcher: React.FC = () => {
  const [state, dispatch] = useRoleContext()
  const { t } = useI18n()
  const { identity } = state

  if (!identity || identity.synthesizedRoles.length <= 1) {
    return (
      <div style={{ padding: '24px', color: '#666', textAlign: 'center', fontSize: '13px' }}>
        {t.identity.noRolesUnlocked}
      </div>
    )
  }

  const handleSwitch = (roleId: string) => {
    dispatch({ type: 'SWITCH_ROLE', payload: roleId })
  }

  return (
    <div style={{ padding: '16px' }}>
      <h3 style={{ margin: '0 0 12px 0', color: '#ccc', fontSize: '14px' }}>{t.identity.switchRole}</h3>
      <p style={{ color: '#888', fontSize: '12px', margin: '0 0 12px 0' }}>
        {t.identity.switchRoleDesc}
      </p>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: '10px',
      }}>
        {identity.synthesizedRoles.map(role => {
          const def = ROLE_DEFINITIONS.find(d => d.id === role.roleId)
          if (!def) return null
          const isActive = role.roleId === identity.activeRoleId
          return (
            <button
              key={role.roleId}
              onClick={() => handleSwitch(role.roleId)}
              style={{
                background: isActive ? `${def.color}22` : '#1e1e2e',
                border: isActive ? `2px solid ${def.color}` : '1px solid #333',
                borderRadius: '10px', padding: '14px', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: '8px', transition: 'all 0.15s',
                color: '#e0e0e0',
              }}
            >
              <span style={{ fontSize: '32px' }}>{def.icon}</span>
              <div style={{ fontWeight: 600, fontSize: '13px' }}>{def.name}</div>
              <div style={{
                padding: '2px 10px', borderRadius: '10px', fontSize: '10px',
                background: def.color, color: '#fff',
              }}>
                Lv.{role.level}
              </div>
              {isActive && (
                <div style={{ color: def.color, fontSize: '10px', fontWeight: 600 }}>{t.identity.currentRole}</div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
