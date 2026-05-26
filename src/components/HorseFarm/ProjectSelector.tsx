import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useI18n } from '../../i18n'
import { useHFContext, type Project, type ProjectMetadata } from '../../context/HFContext'

const RATING_COLORS = ['#22c55e', '#16a34a', '#eab308', '#f59e0b', '#ef4444', '#dc2626']
const BORDER_COLORS = ['#e5e7eb', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']
const DEFAULT_BORDER_COLOR = '#e5e7eb'

type IndividualProjectMap = Record<string, { name: string; path: string; repoPath: string; source: string; status: string }>

function getStarColor(rating: number): string {
  return RATING_COLORS[Math.min(rating, 6) - 1] || RATING_COLORS[1]
}

export default function ProjectSelector() {
  const { t, locale, setLocale } = useI18n()
  const [state, dispatch] = useHFContext()
  const [dbhtProjects, setDbhtProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [metadata, setMetadata] = useState<Record<string, ProjectMetadata>>({})
  const [sortMode, setSortMode] = useState<'manual' | 'rating'>(() => {
    try { return localStorage.getItem('dbghf-selector-sort') as 'manual' | 'rating' || 'manual' }
    catch { return 'manual' }
  })
  const [showNotesModal, setShowNotesModal] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [showRatingPicker, setShowRatingPicker] = useState<string | null>(null)
  const [showBorderPicker, setShowBorderPicker] = useState<string | null>(null)
  const ratingPickerRef = useRef<HTMLDivElement>(null)
  const borderPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      window.electronAPI.listDBHTProjects(state.rootRepoPath),
      window.electronAPI.getProjectMetadata(),
    ]).then(([result, metaResult]) => {
      if (result.success && result.projects) {
        setDbhtProjects(result.projects.map(p => ({ ...p, source: (p.source || 'dbht-root') as 'dbht-root' | 'individual' })))
      }
      if (metaResult.success && metaResult.metadata) {
        setMetadata(metaResult.metadata)
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [state.rootRepoPath])

  // 用元数据丰富项目
  const enrichProject = useCallback((proj: Project): Project => {
    const meta = metadata[proj.path] || {}
    return { ...proj, ...meta }
  }, [metadata])

  const allProjects = useMemo(() => [
    ...dbhtProjects.map(p => enrichProject({ ...p, source: 'dbht-root' as const })),
    ...state.projects.filter(p => p.source === 'individual').map(p => enrichProject({ ...p, source: 'individual' as const })),
  ], [dbhtProjects, state.projects, enrichProject])

  const sortedProjects = useMemo(() => {
    const projects = [...allProjects]
    if (sortMode === 'rating') {
      return projects.sort((a, b) => (b.rating || 2) - (a.rating || 2) || a.name.localeCompare(b.name))
    }
    return projects.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.name.localeCompare(b.name))
  }, [allProjects, sortMode])

  const buildIndividualMap = (): IndividualProjectMap => {
    const map: IndividualProjectMap = {}
    for (const proj of state.projects) {
      if (proj.source === 'individual') {
        map[proj.path] = { name: proj.name, path: proj.path, repoPath: proj.repoPath, source: proj.source, status: proj.status }
      }
    }
    return map
  }

  const toggleSelect = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const addToFarm = () => {
    if (selected.size === 0) return
    const ids = Array.from(selected)
    dispatch({ type: 'ADD_TO_HORSE_FARM', payload: ids })
    const newIds = [...new Set([...state.horseFarmProjectIds, ...ids])]
    window.electronAPI.saveHorseFarmProjectIds(newIds, buildIndividualMap()).catch(() => {})
    setSelected(new Set())
    dispatch({ type: 'SET_MESSAGE', payload: t.horseFarm.addedToFarm.replace('{count}', String(ids.length)) })
  }

  const addIndividualProject = async () => {
    const result = await window.electronAPI.browseIndividualProject()
    if (!result.success || !result.path) return
    const projPath = result.path
    const projName = result.name || projPath.split('\\').pop() || projPath

    const individualMap = buildIndividualMap()

    if (state.projects.find(p => p.path === projPath)) {
      if (!state.horseFarmProjectIds.includes(projPath)) {
        const newIds = [...state.horseFarmProjectIds, projPath]
        dispatch({ type: 'ADD_TO_HORSE_FARM', payload: [projPath] })
        window.electronAPI.saveHorseFarmProjectIds(newIds, individualMap).catch(() => {})
        dispatch({ type: 'SET_MESSAGE', payload: t.horseFarm.addedToFarm.replace('{count}', '1') })
      }
      return
    }

    const newProject: Project = { name: projName, path: projPath, repoPath: '', status: 'synced', source: 'individual' }
    individualMap[projPath] = { name: projName, path: projPath, repoPath: '', source: 'individual', status: 'synced' }

    const updatedProjects = [...state.projects, newProject]
    dispatch({ type: 'SET_PROJECTS', payload: updatedProjects })
    const newIds = [...state.horseFarmProjectIds, projPath]
    dispatch({ type: 'ADD_TO_HORSE_FARM', payload: [projPath] })
    window.electronAPI.saveHorseFarmProjectIds(newIds, individualMap).catch(() => {})
    dispatch({ type: 'SET_MESSAGE', payload: t.horseFarm.addedToFarm.replace('{count}', '1') })
  }

  const enterFarm = () => {
    dispatch({ type: 'SET_CURRENT_VIEW', payload: 'farm' })
  }

  const openSettings = () => {
    dispatch({ type: 'SET_HORSE_FARM_SUB_TAB', payload: 'settings' })
    dispatch({ type: 'SET_CURRENT_VIEW', payload: 'farm' })
  }

  // ---- 评分 ----
  const handleSetRating = async (projPath: string, rating: number) => {
    await window.electronAPI.setProjectRating(projPath, rating)
    setMetadata(prev => ({ ...prev, [projPath]: { ...(prev[projPath] || {}), rating } }))
    setShowRatingPicker(null)
  }

  // ---- 边框颜色 ----
  const handleSetBorderColor = async (projPath: string, color: string) => {
    await window.electronAPI.setProjectBorderColor(projPath, color)
    setMetadata(prev => ({ ...prev, [projPath]: { ...(prev[projPath] || {}), borderColor: color } }))
    setShowBorderPicker(null)
  }

  // ---- 排序 ----
  const handleMoveUp = async (index: number) => {
    if (index <= 0) return
    const newList = [...sortedProjects]
    const temp = newList[index]!
    newList[index] = newList[index - 1]!
    newList[index - 1] = temp
    const orderedPaths = newList.map(p => p.path)
    await window.electronAPI.setProjectOrder(orderedPaths)
    setMetadata(prev => {
      const next = { ...prev }
      orderedPaths.forEach((path, i) => {
        next[path] = { ...(next[path] || {}), order: i }
      })
      return next
    })
  }

  const handleMoveDown = async (index: number) => {
    if (index >= sortedProjects.length - 1) return
    const newList = [...sortedProjects]
    const temp = newList[index]!
    newList[index] = newList[index + 1]!
    newList[index + 1] = temp
    const orderedPaths = newList.map(p => p.path)
    await window.electronAPI.setProjectOrder(orderedPaths)
    setMetadata(prev => {
      const next = { ...prev }
      orderedPaths.forEach((path, i) => {
        next[path] = { ...(next[path] || {}), order: i }
      })
      return next
    })
  }

  // ---- 备注 ----
  const openNotesEditor = (projPath: string, currentNotes: string) => {
    setShowNotesModal(projPath)
    setNotesDraft(currentNotes || '')
  }

  const saveNotes = async () => {
    if (!showNotesModal) return
    await window.electronAPI.saveSelectorProjectNotes(showNotesModal, notesDraft)
    setMetadata(prev => ({ ...prev, [showNotesModal]: { ...(prev[showNotesModal] || {}), notes: notesDraft } }))
    setShowNotesModal(null)
    setNotesDraft('')
  }

  // 关闭弹出层（点击外部）
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ratingPickerRef.current && !ratingPickerRef.current.contains(e.target as Node)) {
        setShowRatingPicker(null)
      }
      if (borderPickerRef.current && !borderPickerRef.current.contains(e.target as Node)) {
        setShowBorderPicker(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const renderProject = (proj: Project, index: number) => {
    const inFarm = state.horseFarmProjectIds.includes(proj.path)
    const isDBHT = proj.source === 'dbht-root'
    const rating = proj.rating || 2
    const borderColor = proj.borderColor || DEFAULT_BORDER_COLOR
    const notes = proj.notes || ''
    const isManualSort = sortMode === 'manual'

    return (
      <div
        className={`selector-project-card ${inFarm ? 'in-farm' : ''}`}
        style={{ borderLeft: `3px solid ${borderColor}` }}
      >
        {/* 排序按钮（手动模式） */}
        {isManualSort && (
          <div className="selector-sort-controls">
            <button
              className="sort-btn"
              disabled={index === 0}
              onClick={() => handleMoveUp(index)}
              title="上移"
            >▲</button>
            <span className="sort-index">{index + 1}</span>
            <button
              className="sort-btn"
              disabled={index >= sortedProjects.length - 1}
              onClick={() => handleMoveDown(index)}
              title="下移"
            >▼</button>
          </div>
        )}

        {/* 评分星星 */}
        <div className="selector-rating" style={{ position: 'relative' }}>
          <button
            className="rating-stars-btn"
            onClick={(e) => {
              e.stopPropagation()
              setShowRatingPicker(showRatingPicker === proj.path ? null : proj.path)
              setShowBorderPicker(null)
            }}
            title="点击设置评分"
          >
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} style={{ color: i < rating ? getStarColor(rating) : '#d1d5db', fontSize: '13px' }}>
                {i < rating ? '★' : '☆'}
              </span>
            ))}
          </button>
          {showRatingPicker === proj.path && (
            <div className="rating-picker-dropdown" ref={ratingPickerRef}>
              {[1, 2, 3, 4, 5, 6].map(lv => (
                <button
                  key={lv}
                  className={`rating-picker-item ${lv === rating ? 'active' : ''}`}
                  style={{ color: getStarColor(lv) }}
                  onClick={(e) => { e.stopPropagation(); handleSetRating(proj.path, lv) }}
                >
                  {'★'.repeat(lv)}{'☆'.repeat(6 - lv)} Lv.{lv}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 项目信息 */}
        <div className="selector-project-main">
          <div className="selector-project-header">
            <h3>{proj.name}</h3>
            <span className={`source-badge ${isDBHT ? 'source-dbht' : 'source-individual'}`}>
              {isDBHT ? t.selector.sourceDBHT : t.selector.sourceIndividual}
            </span>
          </div>
          <span className="selector-project-path">{proj.path}</span>
          <div
            className="selector-project-notes"
            onDoubleClick={(e) => { e.stopPropagation(); openNotesEditor(proj.path, notes) }}
            title={notes || t.selector.notesPlaceholder}
          >
            {notes
              ? notes.replace(/\n/g, ' ').slice(0, 80) + (notes.length > 80 ? '...' : '')
              : <span className="notes-placeholder">{t.selector.notesPlaceholder}</span>
            }
          </div>
        </div>

        {/* 右侧：边框颜色 + 操作 */}
        <div className="selector-project-actions">
          {/* 边框颜色选择器 */}
          <div style={{ position: 'relative' }}>
            <button
              className="border-color-btn"
              style={{ background: borderColor }}
              onClick={(e) => {
                e.stopPropagation()
                setShowBorderPicker(showBorderPicker === proj.path ? null : proj.path)
                setShowRatingPicker(null)
              }}
              title={t.selector.borderColor}
            />
            {showBorderPicker === proj.path && (
              <div className="border-picker-dropdown" ref={borderPickerRef}>
                <button
                  className="border-color-option default"
                  onClick={(e) => { e.stopPropagation(); handleSetBorderColor(proj.path, DEFAULT_BORDER_COLOR) }}
                >
                  <span className="border-swatch" style={{ background: DEFAULT_BORDER_COLOR }} />
                  {t.selector.defaultColor}
                </button>
                {BORDER_COLORS.filter(c => c !== DEFAULT_BORDER_COLOR).map(color => (
                  <button
                    key={color}
                    className={`border-color-option ${borderColor === color ? 'active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); handleSetBorderColor(proj.path, color) }}
                  >
                    <span className="border-swatch" style={{ background: color }} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {inFarm ? (
            <span className="in-farm-badge">
              {t.selector.alreadyInFarm}
            </span>
          ) : (
            <label className="selector-checkbox-label">
              <input
                type="checkbox"
                checked={selected.has(proj.path)}
                onChange={() => toggleSelect(proj.path)}
              />
            </label>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="selector-screen">
      <header className="selector-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1>🐴 {t.selector.title}</h1>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <a
            href="https://www.shenlanai.com"
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="selector-brand-link"
          >
            shenlanai.com
          </a>
          <button
            className="lang-toggle"
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          >
            {locale === 'zh' ? 'EN' : '中文'}
          </button>
        </div>
      </header>

      <div className="selector-content">
        <div className="selector-info">
          <div>
            <span>{t.selector.subtitle}</span>
            <div className="root-path" style={{ marginTop: '4px' }}>{state.rootRepoPath}</div>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: '#6b7280' }}>
              {t.selector.projectCount.replace('{count}', String(state.horseFarmProjectIds.length))}
            </span>
            {state.horseFarmProjectIds.length > 0 && (
              <button
                onClick={enterFarm}
                style={{
                  padding: '8px 20px', borderRadius: '8px', border: 'none',
                  background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                  color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '13px',
                }}
              >
                {t.selector.enterFarm}
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={addIndividualProject}
            style={{
              padding: '8px 18px', borderRadius: '8px', border: '2px dashed #7c3aed',
              background: '#faf5ff', color: '#7c3aed', cursor: 'pointer',
              fontSize: '13px', fontWeight: 600,
            }}
          >
            + {t.selector.addIndividual}
          </button>

          {/* 排序切换 */}
          <div className="sort-toggle-group">
            <button
              className={`sort-toggle-btn ${sortMode === 'manual' ? 'active' : ''}`}
              onClick={() => { setSortMode('manual'); localStorage.setItem('dbghf-selector-sort', 'manual') }}
            >
              {t.selector.sortManual}
            </button>
            <button
              className={`sort-toggle-btn ${sortMode === 'rating' ? 'active' : ''}`}
              onClick={() => { setSortMode('rating'); localStorage.setItem('dbghf-selector-sort', 'rating') }}
            >
              {t.selector.sortRating}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="selector-empty"><p>{t.common.loading}</p></div>
        ) : allProjects.length === 0 ? (
          <div className="selector-empty">
            <h3>{t.selector.availableProjects}</h3>
            <p>{t.selector.noProjects}</p>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: '14px', color: '#374151' }}>
                {t.selector.availableProjects} ({allProjects.length})
              </h3>
              {selected.size > 0 && (
                <button
                  onClick={addToFarm}
                  style={{
                    padding: '8px 18px', borderRadius: '8px', border: 'none',
                    background: '#4f46e5', color: '#fff', cursor: 'pointer',
                    fontSize: '13px', fontWeight: 600,
                  }}
                >
                  {t.selector.addToFarm} ({selected.size})
                </button>
              )}
            </div>

            <div className="selector-grid">
              {sortedProjects.map((proj, index) => (
                <div key={proj.path}>{renderProject(proj, index)}</div>
              ))}
            </div>
          </>
        )}

        {state.message && (
          <div style={{
            padding: '10px 16px', borderRadius: '8px', background: '#d1fae5',
            color: '#065f46', fontSize: '13px', textAlign: 'center',
          }}>
            {state.message}
          </div>
        )}
      </div>

      {/* 设置按钮（固定左下角） */}
      <button
        className="corner-settings-button"
        onClick={openSettings}
        title={t.selector.globalSettings}
      >
        ⚙️
      </button>

      {/* 备注编辑弹窗 */}
      {showNotesModal && (
        <div className="notes-modal-overlay" onClick={() => { setShowNotesModal(null); setNotesDraft('') }}>
          <div className="notes-modal" onClick={e => e.stopPropagation()}>
            <div className="notes-modal-header">
              <h3>{t.selector.notesTitle}</h3>
              <button className="notes-modal-close" onClick={() => { setShowNotesModal(null); setNotesDraft('') }}>✕</button>
            </div>
            <p className="notes-modal-hint">{t.selector.notesHint}</p>
            <textarea
              className="notes-modal-textarea"
              value={notesDraft}
              onChange={e => setNotesDraft(e.target.value)}
              placeholder={t.selector.notesPlaceholder}
              rows={10}
              autoFocus
            />
            <div className="notes-modal-actions">
              <button className="notes-btn-cancel" onClick={() => { setShowNotesModal(null); setNotesDraft('') }}>
                {t.selector.notesCancel}
              </button>
              <button className="notes-btn-save" onClick={saveNotes}>
                {t.selector.notesSave}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
