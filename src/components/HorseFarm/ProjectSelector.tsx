import { useEffect, useState, useMemo } from 'react'
import { useI18n } from '../../i18n'
import { useHFContext, type Project } from '../../context/HFContext'
import { VirtualList } from '../Shared/VirtualList'

type IndividualProjectMap = Record<string, { name: string; path: string; repoPath: string; source: string; status: string }>

type SelectableProject = Project & { source: 'dbht-root' | 'individual' }

export default function ProjectSelector() {
  const { t, locale, setLocale } = useI18n()
  const [state, dispatch] = useHFContext()
  const [dbhtProjects, setDbhtProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    window.electronAPI.listDBHTProjects(state.rootRepoPath).then(result => {
      if (result.success && result.projects) {
        setDbhtProjects(result.projects.map(p => ({ ...p, source: (p.source || 'dbht-root') as 'dbht-root' | 'individual' })))
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [state.rootRepoPath])

  const allProjects = useMemo((): SelectableProject[] => [
    ...dbhtProjects.map(p => ({ ...p, source: 'dbht-root' as const })),
    ...state.projects.filter(p => p.source === 'individual').map(p => ({ ...p, source: 'individual' as const })),
  ], [dbhtProjects, state.projects])

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

  const renderProject = (proj: SelectableProject) => {
    const inFarm = state.horseFarmProjectIds.includes(proj.path)
    const isDBHT = proj.source === 'dbht-root'
    return (
      <div className={`selector-project-card ${inFarm ? 'in-farm' : ''}`}>
        <div className="selector-project-info">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3>{proj.name}</h3>
            <span style={{
              fontSize: '10px', padding: '2px 8px', borderRadius: '10px',
              background: isDBHT ? '#dbeafe' : '#fef3c7',
              color: isDBHT ? '#2563eb' : '#92400e', fontWeight: 500,
            }}>
              {isDBHT ? t.selector.sourceDBHT : t.selector.sourceIndividual}
            </span>
          </div>
          <span>{proj.path}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {inFarm ? (
            <span style={{
              fontSize: '11px', padding: '4px 10px', borderRadius: '10px',
              background: '#ede9fe', color: '#7c3aed', fontWeight: 500,
            }}>
              {t.selector.alreadyInFarm}
            </span>
          ) : (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', margin: 0 }}>
              <input
                type="checkbox"
                checked={selected.has(proj.path)}
                onChange={() => toggleSelect(proj.path)}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
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
            style={{
              fontSize: '11px', color: '#9ca3af', textDecoration: 'none',
              flexShrink: 0, fontFamily: 'Consolas, monospace',
              padding: '2px 8px', borderRadius: '3px',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#4f46e5'; e.currentTarget.style.background = '#f5f3ff' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.background = 'transparent' }}
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

        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
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
        </div>

        {loading ? (
          <div className="selector-empty">
            <p>{t.common.loading}</p>
          </div>
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

            <VirtualList
              items={allProjects}
              renderItem={renderProject}
              getItemKey={(p) => p.path}
              estimateHeight={60}
              overscan={10}
              style={{ height: 'calc(100vh - 340px)' }}
            />
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
    </div>
  )
}
