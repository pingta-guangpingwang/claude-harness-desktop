import { useState, useEffect } from 'react'
import { useI18n } from '../../i18n'
import './System.css'

interface Rule {
  id: string
  name: string
  description?: string
  enabled: boolean
  priority: number
  when: { event: string; pattern?: string; expression?: string }
  then: { type: string; config: Record<string, unknown> } | Array<{ type: string; config: Record<string, unknown> }>
  cooldownMs?: number
  createdAt: string
  updatedAt: string
}

const EVENT_TYPES = [
  'file_change', 'cli_executed', 'project_status', 'agent_tool',
  'workflow_completed', 'workflow_failed', 'variable_change', '*',
]

const ACTION_TYPES = [
  'cli.command', 'notification', 'workflow.trigger', 'variable.set', 'file.write', 'log',
]

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function RuleEditor() {
  const { t } = useI18n()
  const [rules, setRules] = useState<Rule[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Rule>(emptyRule())
  const [isNew, setIsNew] = useState(true)
  const [statusMsg, setStatusMsg] = useState('')

  useEffect(() => {
    loadRules()
  }, [])

  const loadRules = async () => {
    try {
      const result = await window.electronAPI.ruleList()
      if (result.success) setRules(result.rules || [])
    } catch { /* not yet wired */ }
  }

  const selectRule = (id: string) => {
    const rule = rules.find(r => r.id === id)
    if (rule) {
      setEditing(JSON.parse(JSON.stringify(rule)))
      setSelectedId(id)
      setIsNew(false)
    }
  }

  const createNew = () => {
    setEditing(emptyRule())
    setSelectedId(editing.id)
    setIsNew(true)
  }

  const saveRule = async () => {
    if (!editing.name.trim()) {
      setStatusMsg(t.system.pleaseEnterRuleName)
      return
    }
    try {
      const result = await window.electronAPI.ruleSave(editing)
      if (result.success) {
        setStatusMsg(t.system.ruleSaved)
        setIsNew(false)
        await loadRules()
      } else {
        setStatusMsg(t.system.saveFailed + (result.error || 'unknown'))
      }
    } catch {
      // 本地 fallback
      const idx = rules.findIndex(r => r.id === editing.id)
      if (idx >= 0) {
        const updated = [...rules]
        updated[idx] = { ...editing, updatedAt: new Date().toISOString() }
        setRules(updated)
      } else {
        setRules([...rules, { ...editing, updatedAt: new Date().toISOString() }])
      }
      setStatusMsg(t.system.ruleSavedLocal)
      setIsNew(false)
    }
  }

  const deleteRule = async (id: string) => {
    try {
      await window.electronAPI.ruleDelete(id)
    } catch { /* ignore */ }
    setRules(prev => prev.filter(r => r.id !== id))
    if (selectedId === id) {
      setSelectedId(null)
      setEditing(emptyRule())
      setIsNew(true)
    }
  }

  const toggleEnabled = () => {
    setEditing(prev => ({ ...prev, enabled: !prev.enabled }))
  }

  return (
    <div className="sys-container">
      <div className="sys-sidebar">
        <div className="sys-sidebar-header">
          <h4>{t.system.rules}</h4>
          <button onClick={createNew} className="sys-btn sys-btn-primary">{t.system.newRule}</button>
        </div>
        <div className="sys-list">
          {rules.map(r => (
            <div key={r.id} className={`sys-list-item ${selectedId === r.id ? 'active' : ''}`} onClick={() => selectRule(r.id)}>
              <div className="sys-list-item-name">
                <span className={`sys-rule-dot ${r.enabled ? 'enabled' : ''}`} />
                {r.name}
              </div>
              <div className="sys-list-item-meta">P{r.priority} | {r.when.event}</div>
              <button onClick={(e) => { e.stopPropagation(); deleteRule(r.id) }} className="sys-btn-del">x</button>
            </div>
          ))}
          {rules.length === 0 && <div className="sys-empty">{t.system.noRules}</div>}
        </div>
      </div>

      <div className="sys-main">
        <div className="sys-toolbar">
          <input className="sys-input" value={editing.name} onChange={e => setEditing(prev => ({ ...prev, name: e.target.value }))} placeholder={t.system.ruleName} />
          <input className="sys-input" value={editing.description || ''} onChange={e => setEditing(prev => ({ ...prev, description: e.target.value }))} placeholder={t.system.descriptionOptional} />
          <label className="sys-check">
            <input type="checkbox" checked={editing.enabled} onChange={toggleEnabled} /> {t.system.enabled}
          </label>
          <div className="sys-toolbar-actions">
            {statusMsg && <span className="sys-msg">{statusMsg}</span>}
            <button onClick={saveRule} className="sys-btn sys-btn-primary">{t.system.save}</button>
          </div>
        </div>

        <div className="sys-editor-body">
          {/* WHEN */}
          <div className="sys-section">
            <h5>{t.system.whenCondition}</h5>
            <div className="sys-field-row">
              <div className="sys-field">
                <label>{t.system.event}</label>
                <select value={editing.when.event} onChange={e => setEditing(prev => ({ ...prev, when: { ...prev.when, event: e.target.value } }))}>
                  {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="sys-field">
                <label>{t.system.priority}</label>
                <input type="number" className="sys-input" value={editing.priority} onChange={e => setEditing(prev => ({ ...prev, priority: parseInt(e.target.value) || 0 }))} min={0} max={100} />
              </div>
              <div className="sys-field">
                <label>{t.system.cooldownMs}</label>
                <input type="number" className="sys-input" value={editing.cooldownMs || 0} onChange={e => setEditing(prev => ({ ...prev, cooldownMs: parseInt(e.target.value) || 0 }))} min={0} />
              </div>
            </div>
            <div className="sys-field">
              <label>{t.system.patternWildcard}</label>
              <input className="sys-input" value={editing.when.pattern || ''} onChange={e => setEditing(prev => ({ ...prev, when: { ...prev.when, pattern: e.target.value || undefined } }))} placeholder={t.system.patternPlaceholder} />
            </div>
            <div className="sys-field">
              <label>{t.system.expressionJS}</label>
              <textarea className="sys-textarea" value={editing.when.expression || ''} onChange={e => setEditing(prev => ({ ...prev, when: { ...prev.when, expression: e.target.value || undefined } }))} placeholder={t.system.expressionPlaceholder} rows={2} />
            </div>
          </div>

          {/* THEN */}
          <div className="sys-section">
            <h5>{t.system.thenActions}</h5>
            {(Array.isArray(editing.then) ? editing.then : [editing.then]).map((action, idx) => (
              <div key={idx} className="sys-action-card">
                <div className="sys-field-row">
                  <div className="sys-field">
                    <label>{t.system.actionType}</label>
                    <select value={action.type} onChange={e => {
                      setEditing(prev => {
                        const actions = Array.isArray(prev.then) ? [...prev.then] : [prev.then]
                        actions[idx] = { type: e.target.value, config: {} }
                        return { ...prev, then: actions }
                      })
                    }}>
                      {ACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <button className="sys-btn-del" onClick={() => {
                    setEditing(prev => {
                      const actions = (Array.isArray(prev.then) ? [...prev.then] : [prev.then]).filter((_, i) => i !== idx)
                      return { ...prev, then: actions.length <= 1 ? actions[0] : actions }
                    })
                  }}>{t.system.remove}</button>
                </div>
                <div className="sys-field">
                  <label>{t.system.configJSON}</label>
                  <textarea className="sys-textarea sys-mono" value={JSON.stringify(action.config, null, 2)} onChange={e => {
                    try {
                      const cfg = JSON.parse(e.target.value)
                      setEditing(prev => {
                        const actions = Array.isArray(prev.then) ? [...prev.then] : [prev.then]
                        actions[idx] = { ...actions[idx], config: cfg }
                        return { ...prev, then: actions }
                      })
                    } catch { /* waiting for valid JSON */ }
                  }} rows={4} />
                </div>
              </div>
            ))}
            <button className="sys-btn" onClick={() => {
              setEditing(prev => ({
                ...prev,
                then: [...(Array.isArray(prev.then) ? prev.then : [{ type: 'log', config: { message: '' } }]), { type: 'log', config: { message: '' } }],
              }))
            }}>{t.system.addAction}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function emptyRule(): Rule {
  return {
    id: genId(),
    name: '',
    description: '',
    enabled: true,
    priority: 10,
    when: { event: '*' },
    then: { type: 'log', config: { message: '' } },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}
