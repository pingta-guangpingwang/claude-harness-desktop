import { useState, useEffect } from 'react'
import { useI18n } from '../../i18n'

interface SavedLayout {
  id: string
  name: string
  createdAt: string
  panels: string[]
}

const STORAGE_KEY = 'dbghf-workspace-layouts'

function loadLayouts(): SavedLayout[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch { return [] }
}

function saveLayouts(layouts: SavedLayout[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts))
}

export const LayoutManager: React.FC = () => {
  const { t } = useI18n()
  const [layouts, setLayouts] = useState<SavedLayout[]>([])
  const [nameInput, setNameInput] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setLayouts(loadLayouts())
  }, [])

  const handleSave = () => {
    const name = nameInput.trim()
    if (!name) { setMessage(t.productivity.enterLayoutName); return }
    if (layouts.find(l => l.name === name)) { setMessage(t.productivity.layoutNameExists); return }

    const layout: SavedLayout = {
      id: Date.now().toString(36),
      name,
      createdAt: new Date().toISOString(),
      panels: ['project-list', 'command-palette'],
    }
    const updated = [...layouts, layout]
    setLayouts(updated)
    saveLayouts(updated)
    setNameInput('')
    setMessage(t.productivity.layoutSaved.replace('{name}', name))
  }

  const handleDelete = (id: string) => {
    const updated = layouts.filter(l => l.id !== id)
    setLayouts(updated)
    saveLayouts(updated)
  }

  const handleApply = (layout: SavedLayout) => {
    setMessage(t.productivity.layoutApplied.replace('{name}', layout.name))
  }

  return (
    <div style={{ padding: '16px', height: '100%', overflow: 'auto' }}>
      <h3 style={{ margin: '0 0 12px 0', color: '#e0e0e0' }}>{t.productivity.layoutManager}</h3>

      {/* 保存新布局 */}
      <div style={{
        background: '#1e1e2e', borderRadius: '8px', padding: '12px', marginBottom: '14px',
        border: '1px solid #333',
      }}>
        <label style={{ color: '#aaa', fontSize: '12px', display: 'block', marginBottom: '6px' }}>
          {t.productivity.saveCurrentLayout}
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder={t.productivity.layoutNamePlaceholder}
            style={{
              flex: 1, background: '#16162a', border: '1px solid #444', borderRadius: '4px',
              color: '#e0e0e0', padding: '6px 10px', fontSize: '13px', outline: 'none',
            }}
          />
          <button onClick={handleSave} style={{
            background: '#7c3aed', color: '#fff', border: 'none',
            borderRadius: '4px', padding: '6px 14px', cursor: 'pointer', fontSize: '12px',
            fontWeight: 600,
          }}>{t.productivity.saveLayout}</button>
        </div>
        {message && (
          <div style={{
            marginTop: '8px', padding: '6px 10px', borderRadius: '4px', fontSize: '12px',
            background: '#1e3a1e', color: '#4caf50',
          }}>
            {message}
          </div>
        )}
      </div>

      {/* 已保存布局 */}
      {layouts.length === 0 ? (
        <div style={{ color: '#666', textAlign: 'center', padding: '24px' }}>
          {t.productivity.noLayoutsSaved}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {layouts.map(layout => (
            <div key={layout.id} style={{
              background: '#1e1e2e', borderRadius: '8px', padding: '12px',
              border: '1px solid #333', display: 'flex', justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>
                <div style={{ color: '#e0e0e0', fontSize: '13px', fontWeight: 600 }}>{layout.name}</div>
                <div style={{ color: '#666', fontSize: '11px' }}>
                  {new Date(layout.createdAt).toLocaleString()} · {layout.panels.length} {t.productivity.panels}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => handleApply(layout)} style={{
                  background: '#1a3a1a', color: '#4caf50', border: '1px solid #2e5a2e',
                  borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontSize: '11px',
                }}>应用</button>
                <button onClick={() => handleDelete(layout.id)} style={{
                  background: '#3a1a1a', color: '#f44336', border: '1px solid #5a2e2e',
                  borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontSize: '11px',
                }}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
