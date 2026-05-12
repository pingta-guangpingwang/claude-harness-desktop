import { useState, useEffect } from 'react'
import { useI18n } from '../../i18n'
import { useHFContext } from '../../context/HFContext'
import type { HFApiKey, HFConfig } from '../../types/horseFarm'
import { DEEPSEEK_MODELS, DEFAULT_API_CONFIG } from '../../types/horseFarm'

interface HorseFarmSettingsProps {
  config: HFConfig
  onConfigChange: (config: HFConfig) => void
}

const BASE_URL = 'https://api.deepseek.com/anthropic'

function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '****' + key.slice(-4)
}

export default function HorseFarmSettings({ config, onConfigChange }: HorseFarmSettingsProps) {
  const { t } = useI18n()
  const [state, dispatch] = useHFContext()
  const [editingKey, setEditingKey] = useState<HFApiKey | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formKey, setFormKey] = useState('')
  const [formRole, setFormRole] = useState<'manager' | 'worker'>('worker')
  const [formModel, setFormModel] = useState(DEFAULT_API_CONFIG.defaultModel)
  const [formTemp, setFormTemp] = useState(DEFAULT_API_CONFIG.defaultTemperature)
  const [formMaxTokens, setFormMaxTokens] = useState(DEFAULT_API_CONFIG.defaultMaxTokens)
  const [formThinking, setFormThinking] = useState(false)

  // Root repo switching state
  const [showRootConfirm, setShowRootConfirm] = useState(false)
  const [newRootPath, setNewRootPath] = useState('')
  const [rootError, setRootError] = useState('')
  const [rootLoading, setRootLoading] = useState(false)

  useEffect(() => {
    window.electronAPI.saveHorseFarmConfig(config).catch(() => {})
  }, [config])

  // --- Root repo handlers ---

  const handleBrowseNewRoot = async () => {
    const result = await window.electronAPI.browseFolder()
    if (result.success && result.path) {
      setNewRootPath(result.path)
      setRootError('')
    }
  }

  const handleConfirmRootSwitch = async () => {
    if (!newRootPath.trim()) {
      setRootError(t.setup.selectFirst)
      return
    }
    setRootLoading(true)
    setRootError('')
    const result = await window.electronAPI.setDBHTRootPath(newRootPath)
    if (result.success) {
      dispatch({ type: 'SET_ROOT_REPO_PATH', payload: newRootPath })
      // Clear horse farm projects since root changed
      dispatch({ type: 'SET_HORSE_FARM_PROJECT_IDS', payload: [] })
      window.electronAPI.saveHorseFarmProjectIds([]).catch(() => {})
      // Reload projects from new root
      const projResult = await window.electronAPI.listDBHTProjects(newRootPath)
      if (projResult.success && projResult.projects) {
        dispatch({ type: 'SET_PROJECTS', payload: projResult.projects.map(p => ({ ...p, source: (p.source || 'dbht-root') as 'dbht-root' | 'individual' })) })
      }
      dispatch({ type: 'SET_CURRENT_VIEW', payload: 'selector' })
      dispatch({ type: 'SET_MESSAGE', payload: t.settings.rootPathChanged })
    } else {
      setRootError(result.message || t.setup.errorGeneric)
    }
    setRootLoading(false)
    setShowRootConfirm(false)
  }

  const cancelRootSwitch = () => {
    setShowRootConfirm(false)
    setNewRootPath('')
    setRootError('')
  }

  // --- API Key handlers ---

  const handleAdd = () => {
    if (!formName.trim() || !formKey.trim()) return
    const newKey: HFApiKey = {
      id: Date.now().toString(36),
      name: formName.trim(),
      key: formKey.trim(),
      provider: 'deepseek',
      role: formRole,
      model: formModel,
      enabled: true,
      status: 'active',
      config: {
        temperature: formTemp,
        maxTokens: formMaxTokens,
        thinkingEnabled: formThinking,
      },
    }
    onConfigChange({
      ...config,
      apiKeys: [...config.apiKeys, newKey],
    })
    resetForm()
  }

  const handleUpdate = () => {
    if (!editingKey) return
    onConfigChange({
      ...config,
      apiKeys: config.apiKeys.map(k =>
        k.id === editingKey.id
          ? { ...k, name: formName, key: formKey || k.key, role: formRole, model: formModel,
              config: { temperature: formTemp, maxTokens: formMaxTokens, thinkingEnabled: formThinking } }
          : k
      ),
    })
    resetForm()
  }

  const handleDelete = (id: string) => {
    onConfigChange({
      ...config,
      apiKeys: config.apiKeys.filter(k => k.id !== id),
    })
  }

  const handleToggle = (id: string) => {
    onConfigChange({
      ...config,
      apiKeys: config.apiKeys.map(k =>
        k.id === id ? { ...k, enabled: !k.enabled } : k
      ),
    })
  }

  const resetForm = () => {
    setShowAddForm(false)
    setEditingKey(null)
    setFormName('')
    setFormKey('')
    setFormRole('worker')
    setFormModel(DEFAULT_API_CONFIG.defaultModel)
    setFormTemp(DEFAULT_API_CONFIG.defaultTemperature)
    setFormMaxTokens(DEFAULT_API_CONFIG.defaultMaxTokens)
    setFormThinking(false)
  }

  const startEdit = (k: HFApiKey) => {
    setEditingKey(k)
    setShowAddForm(false)
    setFormName(k.name)
    setFormKey('')
    setFormRole(k.role)
    setFormModel(k.model)
    setFormTemp(k.config.temperature)
    setFormMaxTokens(k.config.maxTokens)
    setFormThinking(k.config.thinkingEnabled)
  }

  const statusBadge = (k: HFApiKey) => {
    if (!k.enabled) return { label: 'Disabled', color: '#9ca3af', bg: '#f3f4f6' }
    switch (k.status) {
      case 'rate_limited': return { label: 'Rate Limited', color: '#d97706', bg: '#fef3c7' }
      case 'exhausted': return { label: 'Quota Exhausted', color: '#dc2626', bg: '#fee2e2' }
      case 'error': return { label: 'Error', color: '#dc2626', bg: '#fee2e2' }
      default: return { label: 'Active', color: '#059669', bg: '#d1fae5' }
    }
  }

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div style={{ maxWidth: '700px', margin: '0 auto' }}>
      {/* ================================================================ */}
      {/* Basic Settings — DBHT Root Repository */}
      {/* ================================================================ */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '16px', color: '#1f2937', fontWeight: 600 }}>
          {t.settings.basicSettings}
        </h3>
        <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#6b7280', lineHeight: 1.6 }}>
          {t.settings.dbhtRootDesc}
        </p>

        <div style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: '10px',
          padding: '18px 20px',
        }}>
          {/* Current root path */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{
              fontSize: '11px', fontWeight: 600, color: '#9ca3af',
              textTransform: 'uppercase', letterSpacing: '0.05em',
              display: 'block', marginBottom: '6px',
            }}>
              {t.settings.dbhtRootLabel}
            </label>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb',
              padding: '10px 14px',
            }}>
              <span style={{
                fontSize: '13px', fontFamily: 'Consolas, monospace',
                color: state.isRootConfigured ? '#1f2937' : '#9ca3af',
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {state.isRootConfigured ? state.rootRepoPath : t.settings.noRootConfigured}
              </span>
              {state.isRootConfigured && (
                <button
                  onClick={() => { window.electronAPI.openFolder(state.rootRepoPath).catch(() => {}) }}
                  title="Open in Explorer"
                  style={{
                    padding: '4px 10px', borderRadius: '5px', border: '1px solid #d1d5db',
                    background: '#fff', color: '#6b7280', cursor: 'pointer', fontSize: '11px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Open
                </button>
              )}
            </div>
          </div>

          {/* Change root button / confirmation panel */}
          {!showRootConfirm ? (
            <button
              onClick={() => setShowRootConfirm(true)}
              style={{
                padding: '8px 18px', borderRadius: '7px',
                border: '1px solid #fca5a5', background: '#fff',
                color: '#dc2626', cursor: 'pointer', fontSize: '12px',
                fontWeight: 500, transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}
            >
              {t.settings.changeRoot}
            </button>
          ) : (
            <div style={{
              background: '#fffbeb', borderRadius: '10px', border: '1px solid #fcd34d',
              padding: '16px 18px',
            }}>
              <h4 style={{
                margin: '0 0 6px', fontSize: '14px', color: '#92400e', fontWeight: 600,
              }}>
                {t.settings.changeRootConfirm}
              </h4>
              <p style={{
                margin: '0 0 14px', fontSize: '12px', color: '#a16207', lineHeight: 1.6,
              }}>
                {t.settings.changeRootWarn}
              </p>

              {/* New path picker */}
              <div style={{
                display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px',
              }}>
                <div style={{
                  flex: 1, background: '#fff', borderRadius: '7px', border: '1px solid #d1d5db',
                  padding: '8px 12px', fontSize: '12px', fontFamily: 'Consolas, monospace',
                  color: newRootPath ? '#1f2937' : '#9ca3af',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {newRootPath || t.settings.browseNewRoot}
                </div>
                <button
                  onClick={handleBrowseNewRoot}
                  style={{
                    padding: '8px 16px', borderRadius: '7px', border: '1px solid #d1d5db',
                    background: '#fff', color: '#374151', cursor: 'pointer',
                    fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap',
                  }}
                >
                  {t.common.browse}
                </button>
              </div>

              {rootError && (
                <div style={{ fontSize: '12px', color: '#dc2626', marginBottom: '10px' }}>{rootError}</div>
              )}

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  onClick={cancelRootSwitch}
                  style={{
                    padding: '7px 16px', borderRadius: '7px', border: '1px solid #d1d5db',
                    background: '#fff', color: '#374151', cursor: 'pointer', fontSize: '12px',
                  }}
                >
                  {t.settings.changeRootCancel}
                </button>
                <button
                  onClick={handleConfirmRootSwitch}
                  disabled={rootLoading || !newRootPath}
                  style={{
                    padding: '7px 16px', borderRadius: '7px', border: 'none',
                    background: rootLoading || !newRootPath ? '#fca5a5' : '#dc2626',
                    color: '#fff', cursor: rootLoading || !newRootPath ? 'not-allowed' : 'pointer',
                    fontSize: '12px', fontWeight: 600,
                  }}
                >
                  {rootLoading ? t.common.loading : t.settings.changeRootProceed}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '24px 0' }} />

      {/* ================================================================ */}
      {/* API Provider Info */}
      {/* ================================================================ */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '16px', color: '#1f2937', fontWeight: 600 }}>
          Provider
        </h3>
        <div style={{
          background: '#1e293b', borderRadius: '10px', padding: '16px 20px',
          color: '#e2e8f0',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '14px', color: '#f1f5f9' }}>DeepSeek Anthropic API</h4>
            <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace' }}>DeepSeek</span>
          </div>
          <div style={{
            background: '#0f172a', borderRadius: '6px', padding: '10px 14px',
            fontFamily: 'Consolas, monospace', fontSize: '12px',
          }}>
            <div style={{ color: '#94a3b8' }}>Base URL:</div>
            <div style={{ color: '#67e8f9' }}>{BASE_URL}</div>
            <div style={{ color: '#94a3b8', marginTop: '6px' }}>Auth Header:</div>
            <div style={{ color: '#86efac' }}>x-api-key: {'<your-api-key>'}</div>
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '8px' }}>
            Use Anthropic SDK with DeepSeek models. Set ANTHROPIC_BASE_URL to {BASE_URL}
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* API Keys */}
      {/* ================================================================ */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#1f2937', fontWeight: 600 }}>
            {t.settings.apiKeys} ({config.apiKeys.length})
          </h3>
          {!showAddForm && !editingKey && (
            <button
              onClick={() => setShowAddForm(true)}
              style={{
                padding: '6px 14px', borderRadius: '6px', border: 'none',
                background: '#4f46e5', color: '#fff', cursor: 'pointer', fontSize: '12px',
              }}
            >
              + Add Key
            </button>
          )}
        </div>

        {config.apiKeys.length === 0 && !showAddForm && (
          <div style={{ textAlign: 'center', padding: '24px', color: '#9ca3af', fontSize: '13px' }}>
            No API keys configured. Add one to enable AI-powered features.
          </div>
        )}

        {config.apiKeys.map(k => {
          const sb = statusBadge(k)
          return (
            <div
              key={k.id}
              style={{
                border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 14px',
                marginBottom: '8px', opacity: k.enabled ? 1 : 0.5,
                background: k.enabled ? '#fff' : '#f9fafb',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontWeight: 600, fontSize: '13px' }}>{k.name}</span>
                  <span style={{
                    fontSize: '10px', padding: '2px 8px', borderRadius: '6px',
                    background: sb.bg, color: sb.color, fontWeight: 500,
                  }}>
                    {sb.label}
                  </span>
                  <span style={{
                    fontSize: '10px', padding: '2px 8px', borderRadius: '6px',
                    background: k.role === 'manager' ? '#ede9fe' : '#f0fdf4',
                    color: k.role === 'manager' ? '#7c3aed' : '#059669',
                    fontWeight: 500,
                  }}>
                    {k.role === 'manager' ? 'Manager AI' : 'Worker'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => handleToggle(k.id)}
                    style={{ fontSize: '11px', padding: '3px 8px', border: '1px solid #d1d5db', borderRadius: '4px', background: '#fff', color: '#374151', cursor: 'pointer' }}>
                    {k.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => startEdit(k)}
                    style={{ fontSize: '11px', padding: '3px 8px', border: '1px solid #d1d5db', borderRadius: '4px', background: '#fff', color: '#374151', cursor: 'pointer' }}>
                    Edit
                  </button>
                  <button onClick={() => handleDelete(k.id)}
                    style={{ fontSize: '11px', padding: '3px 8px', border: '1px solid #fecaca', borderRadius: '4px', background: '#fff', color: '#dc2626', cursor: 'pointer' }}>
                    Delete
                  </button>
                </div>
              </div>
              <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px', fontFamily: 'monospace' }}>
                Key: {maskKey(k.key)} · Model: {k.model} · T: {k.config.temperature} · Max Tokens: {k.config.maxTokens} · Thinking: {k.config.thinkingEnabled ? 'On' : 'Off'}
              </div>
              {k.errorMessage && (
                <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '4px' }}>{k.errorMessage}</div>
              )}
            </div>
          )
        })}
      </div>

      {/* ================================================================ */}
      {/* API Key Add/Edit Form */}
      {/* ================================================================ */}
      {(showAddForm || editingKey) && (
        <div style={{
          border: '2px solid #4f46e5', borderRadius: '10px', padding: '16px',
          background: '#fafafe', marginBottom: '20px',
        }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '14px' }}>
            {editingKey ? 'Edit API Key' : 'Add API Key'}
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Key Name</label>
              <input
                type="text" value={formName} onChange={e => setFormName(e.target.value)}
                placeholder="e.g. My DeepSeek Key"
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>API Key</label>
              <input
                type="password" value={formKey} onChange={e => setFormKey(e.target.value)}
                placeholder={editingKey ? 'Leave empty to keep current' : 'sk-...'}
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Role</label>
              <select value={formRole} onChange={e => setFormRole(e.target.value as 'manager' | 'worker')}
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box', background: '#fff' }}
              >
                <option value="manager">Manager AI</option>
                <option value="worker">Worker — Task Polling</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Model</label>
              <select value={formModel} onChange={e => setFormModel(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box', background: '#fff' }}
              >
                {DEEPSEEK_MODELS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Temperature ({formTemp})</label>
              <input
                type="range" min="0" max="2" step="0.1" value={formTemp}
                onChange={e => setFormTemp(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Max Tokens</label>
              <input
                type="number" min="256" max="8192" step="256" value={formMaxTokens}
                onChange={e => setFormMaxTokens(parseInt(e.target.value) || 4096)}
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox" checked={formThinking} onChange={e => setFormThinking(e.target.checked)}
                style={{ width: '16px', height: '16px' }}
              />
              <label style={{ fontSize: '12px', fontWeight: 500 }}>Enable Thinking</label>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px', justifyContent: 'flex-end' }}>
            <button onClick={resetForm}
              style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer', fontSize: '12px' }}>
              Cancel
            </button>
            <button onClick={editingKey ? handleUpdate : handleAdd}
              style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', background: '#4f46e5', color: '#fff', cursor: 'pointer', fontSize: '12px' }}>
              {editingKey ? 'Update' : 'Add Key'}
            </button>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* Global Settings */}
      {/* ================================================================ */}
      <div>
        <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: '#1f2937', fontWeight: 600 }}>
          {t.settings.globalSettings}
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Default Model</label>
            <select
              value={config.settings.defaultModel}
              onChange={e => onConfigChange({ ...config, settings: { ...config.settings, defaultModel: e.target.value } })}
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box', background: '#fff' }}
            >
              {DEEPSEEK_MODELS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Default Temperature</label>
            <input
              type="number" min="0" max="2" step="0.1" value={config.settings.defaultTemperature}
              onChange={e => onConfigChange({ ...config, settings: { ...config.settings, defaultTemperature: parseFloat(e.target.value) || 0.7 } })}
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Default Max Tokens</label>
            <input
              type="number" min="256" max="8192" step="256" value={config.settings.defaultMaxTokens}
              onChange={e => onConfigChange({ ...config, settings: { ...config.settings, defaultMaxTokens: parseInt(e.target.value) || 4096 } })}
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Polling Interval (ms)</label>
            <input
              type="number" min="1000" max="60000" step="1000" value={config.settings.pollingIntervalMs}
              onChange={e => onConfigChange({ ...config, settings: { ...config.settings, pollingIntervalMs: parseInt(e.target.value) || 5000 } })}
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Max Concurrent Tasks</label>
            <input
              type="number" min="1" max="10" value={config.settings.maxConcurrentTasks}
              onChange={e => onConfigChange({ ...config, settings: { ...config.settings, maxConcurrentTasks: parseInt(e.target.value) || 3 } })}
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
            />
          </div>
        </div>

        {/* Default Project Directory — 驾驭智能体创建新项目的默认位置 */}
        <div style={{ marginTop: '18px', paddingTop: '18px', borderTop: '1px solid #e5e7eb' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#1f2937', display: 'block', marginBottom: '6px' }}>
            Default Project Directory
          </label>
          <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#6b7280', lineHeight: 1.5 }}>
            When the Harness Agent creates a new project, it will create a folder here, add it to the farm, and start Claude Code to build the project from scratch.
          </p>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{
              flex: 1, background: '#f9fafb', borderRadius: '7px', border: '1px solid #d1d5db',
              padding: '8px 12px', fontSize: '12px', fontFamily: 'Consolas, monospace',
              color: config.settings.defaultProjectDir ? '#1f2937' : '#9ca3af',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {config.settings.defaultProjectDir || 'Not set — choose a parent directory for new projects'}
            </div>
            <button
              onClick={async () => {
                const result = await window.electronAPI.browseFolder()
                if (result.success && result.path) {
                  onConfigChange({ ...config, settings: { ...config.settings, defaultProjectDir: result.path } })
                }
              }}
              style={{
                padding: '8px 16px', borderRadius: '7px', border: '1px solid #d1d5db',
                background: '#fff', color: '#374151', cursor: 'pointer',
                fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap',
              }}
            >
              Browse...
            </button>
          </div>
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '24px 0' }} />

      {/* ================================================================ */}
      {/* Hub Settings — 中枢层设置 */}
      {/* ================================================================ */}
      <HubSettingsSection />
    </div>
  )
}

/** 中枢层设置：最小化到托盘 / 开机自启 / 热键 / 悬浮窗 */
function HubSettingsSection() {
  const [hubSettings, setHubSettings] = useState<{
    minimizeToTray: boolean
    autoStartEnabled: boolean
    summonHotkey: string
    floatingWidgetEnabled: boolean
  } | null>(null)
  const [statusMsg, setStatusMsg] = useState('')

  useEffect(() => {
    window.electronAPI.getHubSettings().then(r => {
      if (r.success) setHubSettings(r.settings)
    })
  }, [])

  const updateSetting = async (key: string, value: any) => {
    if (!hubSettings) return
    setHubSettings({ ...hubSettings, [key]: value })
    const result = await window.electronAPI.updateHubSetting(key, value)
    if (result.success) {
      setStatusMsg(`Applied: ${key}`)
      setTimeout(() => setStatusMsg(''), 2000)
    }
  }

  if (!hubSettings) return null

  return (
    <div>
      <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: '#1f2937', fontWeight: 600 }}>
        Hub Settings
      </h3>
      <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#6b7280', lineHeight: 1.6 }}>
        System-level behavior: tray, hotkeys, auto-start, and floating widget.
      </p>

      <div style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: '10px',
        padding: '16px 20px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Minimize to tray */}
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1f2937' }}>Minimize to Tray</div>
              <div style={{ fontSize: '11px', color: '#6b7280' }}>Close button hides window to system tray instead of quitting</div>
            </div>
            <input type="checkbox" checked={hubSettings.minimizeToTray}
              onChange={e => updateSetting('minimizeToTray', e.target.checked)}
              style={{ width: '18px', height: '18px' }} />
          </label>

          {/* Auto-start */}
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1f2937' }}>Start on Boot</div>
              <div style={{ fontSize: '11px', color: '#6b7280' }}>Automatically launch Claude Harness Desktop when you log in</div>
            </div>
            <input type="checkbox" checked={hubSettings.autoStartEnabled}
              onChange={e => updateSetting('autoStartEnabled', e.target.checked)}
              style={{ width: '18px', height: '18px' }} />
          </label>

          {/* Summon hotkey */}
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1f2937', marginBottom: '4px' }}>Summon Hotkey</div>
            <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px' }}>Global shortcut to show/hide the main window</div>
            <input
              type="text"
              value={hubSettings.summonHotkey}
              onChange={e => {
                setHubSettings({ ...hubSettings, summonHotkey: e.target.value })
              }}
              onBlur={e => updateSetting('summonHotkey', e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') updateSetting('summonHotkey', hubSettings.summonHotkey)
              }}
              placeholder="Ctrl+Shift+H"
              style={{
                padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px',
                fontSize: '13px', fontFamily: 'monospace', width: '180px',
              }}
            />
          </div>

          {/* Floating widget */}
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1f2937' }}>Floating Widget</div>
              <div style={{ fontSize: '11px', color: '#6b7280' }}>Show a compact always-on-top quick access panel</div>
            </div>
            <input type="checkbox" checked={hubSettings.floatingWidgetEnabled}
              onChange={e => updateSetting('floatingWidgetEnabled', e.target.checked)}
              style={{ width: '18px', height: '18px' }} />
          </label>
        </div>

        {statusMsg && (
          <div style={{ marginTop: '10px', fontSize: '11px', color: '#10b981' }}>{statusMsg}</div>
        )}
      </div>
    </div>
  )
}
