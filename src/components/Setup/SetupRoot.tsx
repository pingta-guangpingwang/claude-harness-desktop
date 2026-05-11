import { useState } from 'react'
import { useI18n } from '../../i18n'
import { useHFContext } from '../../context/HFContext'

export default function SetupRoot() {
  const { t, locale, setLocale } = useI18n()
  const [, dispatch] = useHFContext()
  const [selectedPath, setSelectedPath] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleBrowse = async () => {
    const result = await window.electronAPI.browseFolder()
    if (result.success && result.path) {
      setSelectedPath(result.path)
      setError('')
    }
  }

  const handleConfirm = async () => {
    if (!selectedPath.trim()) {
      setError(t.setup.selectFirst)
      return
    }
    setLoading(true)
    setError('')
    const result = await window.electronAPI.setDBHTRootPath(selectedPath)
    if (result.success) {
      dispatch({ type: 'SET_ROOT_REPO_PATH', payload: selectedPath })
      dispatch({ type: 'SET_IS_ROOT_CONFIGURED', payload: true })
      dispatch({ type: 'SET_CURRENT_VIEW', payload: 'selector' })
    } else {
      setError(result.message || t.setup.errorGeneric)
    }
    setLoading(false)
  }

  return (
    <div className="setup-screen">
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '20px', gap: '12px' }}>
        <button
          className="lang-toggle"
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.2)',
            color: 'white',
            borderRadius: '6px',
            padding: '6px 12px',
            cursor: 'pointer',
          }}
          onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
        >
          {locale === 'zh' ? 'EN' : '中文'}
        </button>
      </div>
      <div className="setup-content">
        <div className="setup-logo">
          <h1>Claude Harness Desktop</h1>
          <p>A visual multi-project cockpit for Claude Code</p>
        </div>
        <p className="setup-subtitle">Manage multiple Claude Code projects from a desktop GUI</p>

        <div className="setup-card">
          <h2>{t.setup.title}</h2>
          <p>{t.setup.subtitle}</p>

          <div className="path-display">
            <strong>{t.setup.selectFolder}</strong>
            {selectedPath ? (
              <span>{selectedPath}</span>
            ) : (
              <span style={{ color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>
                {t.common.browse}
              </span>
            )}
            <button
              onClick={handleBrowse}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.3)',
                background: 'rgba(255,255,255,0.15)',
                color: 'white',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {t.common.browse}
            </button>
          </div>

          {error && (
            <div style={{ color: '#fca5a5', fontSize: '13px', marginTop: '12px' }}>{error}</div>
          )}

          <div style={{ marginTop: '20px', textAlign: 'center' }}>
            <button
              className="primary-button"
              onClick={handleConfirm}
              disabled={loading || !selectedPath}
            >
              {loading ? t.common.loading : t.setup.confirm}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
