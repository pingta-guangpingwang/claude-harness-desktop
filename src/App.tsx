import { useEffect, useState, lazy, Suspense } from 'react'
import { useHFContext, type Project } from './context/HFContext'
import { useI18n } from './i18n'
import SetupRoot from './components/Setup/SetupRoot'
import ProjectSelector from './components/HorseFarm/ProjectSelector'
import { FloatingWidget } from './components/Hub/FloatingWidget'
const HorseFarm = lazy(() => import('./components/HorseFarm/HorseFarm'))

function App() {
  const [state, dispatch] = useHFContext()

  // 全局监听驾驭智能事件（确保任何面板都能收到）
  useEffect(() => {
    const unsub = window.electronAPI.harnessOnEvent((event: any) => {
      console.log('[HarnessEvent]', event.type, event.data?.slice?.(0, 100) || '')
    })
    return unsub
  }, [])
  const { t, locale, setLocale } = useI18n()
  const [isFloating, setIsFloating] = useState(() => window.location.hash === '#/floating')

  useEffect(() => {
    const onHashChange = () => setIsFloating(window.location.hash === '#/floating')
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    const init = async () => {
      // Check if DBHT root path is configured
      const rootResult = await window.electronAPI.getDBHTRootPath()
      if (rootResult.success && rootResult.rootPath) {
        dispatch({ type: 'SET_ROOT_REPO_PATH', payload: rootResult.rootPath })
        dispatch({ type: 'SET_IS_ROOT_CONFIGURED', payload: true })

        // Load projects from DBHT
        const projResult = await window.electronAPI.listDBHTProjects(rootResult.rootPath)
        const dbhtProjects: Project[] = (projResult.success && projResult.projects)
          ? projResult.projects.map(p => ({ ...p, source: (p.source || 'dbht-root') as 'dbht-root' | 'individual' }))
          : []

        // Load saved Horse Farm project IDs + individual project metadata
        const idsResult = await window.electronAPI.loadHorseFarmProjectIds()
        const savedIds: string[] = (idsResult.success && idsResult.ids) ? idsResult.ids : []
        const individualProjects = (idsResult.success && idsResult.individualProjects) ? idsResult.individualProjects : {}

        // Merge individual projects into the project list
        const mergedProjects: Project[] = [...dbhtProjects]
        for (const [projPath, projMeta] of Object.entries(individualProjects)) {
          if (!mergedProjects.find(p => p.path === projPath)) {
            const meta = projMeta as { name: string; path: string; repoPath: string; status: string; source: string }
            mergedProjects.push({ ...meta, source: (meta.source || 'individual') as 'dbht-root' | 'individual' })
          }
        }
        dispatch({ type: 'SET_PROJECTS', payload: mergedProjects })
        dispatch({ type: 'SET_HORSE_FARM_PROJECT_IDS', payload: savedIds })

        // If there are projects in farm, go to farm view, otherwise selector
        if (savedIds.length > 0) {
          dispatch({ type: 'SET_CURRENT_VIEW', payload: 'farm' })
        } else {
          dispatch({ type: 'SET_CURRENT_VIEW', payload: 'selector' })
        }
      } else {
        // 检查是否已跳过设置
        const setupResult = await window.electronAPI.getSetupCompleted()
        if (setupResult.success && setupResult.completed) {
          dispatch({ type: 'SET_CURRENT_VIEW', payload: 'selector' })
        } else {
          dispatch({ type: 'SET_CURRENT_VIEW', payload: 'setup' })
        }
      }
    }
    init()
  }, [dispatch])

  // 监听 create_project 推送的新项目事件 → 即时刷新项目列表和农场
  useEffect(() => {
    const unsub = window.electronAPI.onProjectAdded((projectPath: string, projectName: string) => {
      console.log('[App] 收到新项目通知:', projectName, projectPath)
      // 1. 添加到项目列表
      const newProject: Project = {
        name: projectName,
        path: projectPath,
        repoPath: '',
        source: 'individual',
        status: 'synced',
      }
      dispatch({ type: 'ADD_PROJECT', payload: newProject })
      // 2. 添加到 Harness Farm
      dispatch({ type: 'ADD_TO_HORSE_FARM', payload: [projectPath] })
    })
    return unsub
  }, [dispatch])

  if (isFloating) {
    return <FloatingWidget />
  }

  if (state.currentView === 'setup') {
    return <SetupRoot />
  }

  if (state.currentView === 'selector') {
    return <ProjectSelector />
  }

  // Horse Farm view
  return (
    <div className="horsefarm-page">
      <header className="hf-header">
        <div className="hf-header-left">
          <button
            onClick={() => dispatch({ type: 'SET_CURRENT_VIEW', payload: 'selector' })}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: '1px solid #d1d5db',
              background: '#f3f4f6', color: '#374151', cursor: 'pointer', fontSize: '13px',
            }}
          >
            ← {t.selector.title}
          </button>
          <h1>🐴 {t.horseFarm.tabLabel}</h1>
        </div>
        <div className="hf-header-right">
          <a
            href="https://www.shenlanai.com"
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{
              fontSize: '11px', color: '#9ca3af', textDecoration: 'none',
              marginRight: '8px', flexShrink: 0,
              fontFamily: 'Consolas, monospace',
              padding: '2px 8px', borderRadius: '3px',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#4f46e5'; e.currentTarget.style.background = '#f5f3ff' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.background = 'transparent' }}
          >
            shenlanai.com
          </a>
          <button
            onClick={() => dispatch({ type: 'SET_HORSE_FARM_SUB_TAB', payload: 'settings' })}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: '1px solid #d1d5db',
              background: '#fff', color: '#374151', cursor: 'pointer', fontSize: '13px',
            }}
          >
            {t.settings.title}
          </button>
          <button
            className="lang-toggle"
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          >
            {locale === 'zh' ? 'EN' : '中文'}
          </button>
        </div>
      </header>
      <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8' }}>Loading...</div>}>
        <HorseFarm />
      </Suspense>
    </div>
  )
}

export default App
