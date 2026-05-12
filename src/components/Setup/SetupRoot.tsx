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

  const [showSkipInfo, setShowSkipInfo] = useState(false)

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

  const handleSkip = async () => {
    if (!showSkipInfo) {
      setShowSkipInfo(true)
      return
    }
    await window.electronAPI.setSetupCompleted()
    dispatch({ type: 'SET_CURRENT_VIEW', payload: 'selector' })
  }

  const DBHT_REPO_URL = 'https://github.com/pingta-guangpingwang/DeepBlueHarnessTrace.git'

  return (
    <div className="setup-screen">
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '20px', gap: '12px' }}>
        <a
          href="https://www.shenlanai.com"
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{
            fontSize: '11px', color: 'rgba(255,255,255,0.5)', textDecoration: 'none',
            flexShrink: 0, fontFamily: 'Consolas, monospace',
            padding: '2px 8px', borderRadius: '3px',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#818cf8'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.background = 'transparent' }}
        >
          shenlanai.com
        </a>
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

          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <button
              onClick={handleSkip}
              style={{
                padding: '8px 16px', borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'transparent', color: 'rgba(255,255,255,0.6)',
                cursor: 'pointer', fontSize: '13px',
              }}
            >
              {showSkipInfo ? '确认跳过' : '跳过设置 →'}
            </button>
          </div>

          {showSkipInfo && (
            <div style={{
              marginTop: '16px', padding: '14px 16px',
              background: 'rgba(251,191,36,0.1)', borderRadius: '8px',
              border: '1px solid rgba(251,191,36,0.25)',
              fontSize: '12px', lineHeight: 1.7, color: 'rgba(255,255,255,0.8)',
            }}>
              <p style={{ margin: '0 0 8px', fontWeight: 600 }}>💡 建议搭配 DBHT 版本管理</p>
              <p style={{ margin: '0 0 8px' }}>
                CHD 可以单独添加项目直接开发，也支持 Git。如果你希望让 AI 自动做版本管理（快照/回滚），
                可以搭配 <strong>DeepBlueHarnessTrace (DBHT)</strong> CLI 使用：
              </p>
              <code style={{
                display: 'block', padding: '6px 10px', margin: '6px 0', background: 'rgba(0,0,0,0.3)',
                borderRadius: '4px', fontSize: '11px', wordBreak: 'break-all', color: '#fbbf24',
              }}>
                git clone {DBHT_REPO_URL}
              </code>
              <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.5)', fontSize: '11px' }}>
                之后可在设置中随时配置 DBHT 根仓库路径
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
