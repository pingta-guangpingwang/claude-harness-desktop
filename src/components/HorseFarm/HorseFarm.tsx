import { useEffect, useMemo, useState, useCallback, useSyncExternalStore } from 'react'
import { useHFContext } from '../../context/HFContext'
import { useI18n } from '../../i18n'
import { useHorseFarm } from '../../hooks/useHorseFarm'
import { callAI } from '../../services/aiService'
import type { HFSubTab, HFConfig } from '../../types/horseFarm'
import { DEFAULT_API_CONFIG } from '../../types/horseFarm'
import { CommandPalette } from '../CLI/CommandPalette'
import { BatchManager } from '../CLI/BatchManager'
import { FavoritesPanel } from '../CLI/FavoritesPanel'
import ProjectList from './ProjectList'
import MindMapViewer from './MindMapViewer'
import KnowledgeBaseViewer from './KnowledgeBaseViewer'
import HorseFarmSettings from './HorseFarmSettings'
import { ChatPanel } from '../Chat/ChatPanel'
import { getAgentRunning, subscribeAgentRunning, setAgentRunning } from './harnessChatStore'
import AuditPanel from '../Shared/AuditPanel'
import { HarnessAgentPanel } from './HarnessAgentPanel'
import { PluginStore } from '../Plugins/PluginStore'
import { IdentityProfile } from '../Identity/IdentityProfile'
import { EfficiencyDashboard } from '../Productivity/EfficiencyDashboard'
import { WorkflowEditor } from '../Workflow/WorkflowEditor'
import { WorkflowTemplates } from '../Workflow/WorkflowTemplates'
import { ResourceHub } from '../Eco/ResourceHub'
import { ConfigMigrator } from '../Eco/ConfigMigrator'
import { TokenStatsPanel } from '../System/TokenStatsPanel'
import { RuleEditor } from '../System/RuleEditor'
import { AuditLogViewer } from '../System/AuditLogViewer'
import { PerformanceDashboard } from '../System/PerformanceDashboard'
import { useRoleContext } from '../../context/RoleContext'
import { fragmentCollector } from '../../roles/SkillFragmentCollector'
import { useChat } from '../../context/ChatContext'
import './HorseFarm.css'

export interface InitProgress {
  status: 'queued' | 'running' | 'done' | 'exists' | 'error'
  log: string[]
  kbResult: string
  mindmapResult: string
}

export default function HorseFarm() {
  const [state, dispatch] = useHFContext()
  const { t } = useI18n()
  const chat = useChat()
  const [, roleDispatch] = useRoleContext()
  const hf = useHorseFarm(state.projects, state.horseFarmProjectIds)
  const [hfConfig, setHfConfig] = useState<HFConfig>({
    projectIds: [],
    apiKeys: [],
    settings: { ...DEFAULT_API_CONFIG },
  })
  const [detailPanel, setDetailPanel] = useState<{
    type: 'mindmap' | 'kb' | 'initLog' | 'chat' | 'audit' | 'harness' | 'cli' | 'plugins' | 'identity' | 'efficiency' | 'workflow' | 'eco' | 'system' | 'token' | null
    projectPath: string | null
    ecoSubTab?: 'resources' | 'migrator'
    systemSubTab?: 'rules' | 'audit' | 'perf'
    workflowSubTab?: 'editor' | 'templates'
  }>({ type: null, projectPath: null })
  const [initializing, setInitializing] = useState(false)
  const [initProgress, setInitProgress] = useState<Record<string, InitProgress>>({})
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const agentRunning = useSyncExternalStore(subscribeAgentRunning, getAgentRunning)

  const handleAbortAgent = useCallback(() => {
    window.electronAPI.harnessAbort()
    setAgentRunning(false)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette(prev => !prev)
      }
      if (e.key === 'Escape' && showCommandPalette) {
        setShowCommandPalette(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showCommandPalette])

  useEffect(() => {
    window.electronAPI.loadHorseFarmConfig().then(result => {
      if (result.success && result.config) {
        setHfConfig(result.config)
      }
    }).catch(() => {})
  }, [])

  const allCommands = useMemo(() => {
    const msgs = [...hf.globalCommands]
    for (const id of state.horseFarmProjectIds) {
      const proj = hf.hfProjects[id]
      if (proj) {
        for (const cmd of proj.commands) msgs.push(cmd)
      }
    }
    msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    return msgs
  }, [hf.globalCommands, hf.hfProjects, state.horseFarmProjectIds])

  const handleLaunchChat = async (projectPath: string) => {
    // 如果已在当前项目 Chat，切换关闭
    if (detailPanel.type === 'chat' && detailPanel.projectPath === projectPath) {
      setDetailPanel({ type: null, projectPath: null })
      return
    }
    await chat.launch(projectPath)
    setDetailPanel({ type: 'chat', projectPath })
  }

  const handleViewAudit = (projectPath: string) => {
    setDetailPanel(prev => prev.type === 'audit' && prev.projectPath === projectPath
      ? { type: null, projectPath: null }
      : { type: 'audit', projectPath })
  }

  const subTabs: Array<{ key: HFSubTab; label: string }> = [
    { key: 'list', label: t.horseFarm.subTabList },
    { key: 'settings', label: t.horseFarm.subTabSettings },
  ]

  const addLog = (path: string, msg: string) => {
    setInitProgress(prev => ({
      ...prev,
      [path]: {
        ...prev[path],
        log: [...(prev[path]?.log || []), new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + msg],
      },
    }))
  }

  const getActiveApiKey = () => {
    return hfConfig.apiKeys.find(k => k.enabled && k.status === 'active')
  }

  const handleInitializeAll = async () => {
    if (state.horseFarmProjectIds.length === 0) return
    setInitializing(true)

    const apiKey = getActiveApiKey()
    const model = apiKey?.model || hfConfig.settings.defaultModel

    const initial: Record<string, InitProgress> = {}
    for (const id of state.horseFarmProjectIds) {
      const proj = hf.hfProjects[id]
      const name = proj?.projectName || id.split('\\').pop() || id
      initial[id] = { status: 'queued', log: [name + ': queued'], kbResult: '', mindmapResult: '' }
    }
    setInitProgress(initial)

    for (const id of state.horseFarmProjectIds) {
      const proj = hf.hfProjects[id]
      const name = proj?.projectName || id.split('\\').pop() || id

      setInitProgress(prev => ({ ...prev, [id]: { ...prev[id], status: 'running' } }))

      // ---- Knowledge Base ----
      addLog(id, 'Checking knowledge base...')
      try {
        const kbResult = await window.electronAPI.readKnowledgeBase(id)
        if (kbResult.success) {
          addLog(id, 'Knowledge base already exists')
          setInitProgress(prev => ({ ...prev, [id]: { ...prev[id], kbResult: 'exists' } }))
        } else if (apiKey) {
          addLog(id, t.horseFarm.initAIGenerating)
          try {
            const aiKb = await callAI(apiKey.key, model,
              'You are a technical documentation expert. Generate a comprehensive knowledge base in markdown for a software project. Include sections: Project Overview, Architecture, Key Modules, Technology Stack, Development Guidelines. Output ONLY valid markdown.',
              `Project name: ${name}\nProject path: ${id}\nGenerate a comprehensive KNOWLEDGEBASE.md for this project.`
            )
            await window.electronAPI.saveHorseFarmData(id, { summary: aiKb.substring(0, 300) })
            const genKb = await window.electronAPI.generateKnowledgeBase(id, name, aiKb.substring(0, 500), proj?.requirements || '')
            if (genKb.success && genKb.filePath) {
              hf.setKnowledgeBasePath(id, genKb.filePath)
              addLog(id, 'AI KB generated: ' + genKb.filePath)
              setInitProgress(prev => ({ ...prev, [id]: { ...prev[id], kbResult: 'generated' } }))
            } else {
              throw new Error(genKb.message || 'KB write failed')
            }
          } catch (aiErr) {
            addLog(id, 'AI KB failed: ' + String(aiErr) + ', using local fallback')
            const genKb = await window.electronAPI.generateKnowledgeBase(id, name, '', '')
            if (genKb.success && genKb.filePath) {
              hf.setKnowledgeBasePath(id, genKb.filePath)
              setInitProgress(prev => ({ ...prev, [id]: { ...prev[id], kbResult: 'generated' } }))
            } else {
              setInitProgress(prev => ({ ...prev, [id]: { ...prev[id], kbResult: 'failed' } }))
            }
          }
        } else {
          addLog(id, t.horseFarm.initAIFallback)
          const genKb = await window.electronAPI.generateKnowledgeBase(id, name, '', '')
          if (genKb.success && genKb.filePath) {
            hf.setKnowledgeBasePath(id, genKb.filePath)
            addLog(id, 'KB generated: ' + genKb.filePath)
            setInitProgress(prev => ({ ...prev, [id]: { ...prev[id], kbResult: 'generated' } }))
          } else {
            addLog(id, 'KB failed: ' + (genKb.message || 'unknown'))
            setInitProgress(prev => ({ ...prev, [id]: { ...prev[id], kbResult: 'failed' } }))
          }
        }
      } catch (err) {
        addLog(id, 'KB error: ' + String(err))
        setInitProgress(prev => ({ ...prev, [id]: { ...prev[id], kbResult: 'error' } }))
      }

      // ---- Mind Map ----
      addLog(id, 'Checking mind map...')
      try {
        const mindmapPath = id + '/.dbvs-mindmap.json'
        const mmResult = await window.electronAPI.readMindMapFile(mindmapPath)
        if (mmResult.success) {
          addLog(id, 'Mind map already exists')
          setInitProgress(prev => ({ ...prev, [id]: { ...prev[id], mindmapResult: 'exists' } }))
        } else if (apiKey) {
          addLog(id, t.horseFarm.initAIGenerating)
          try {
            const aiMindmap = await callAI(apiKey.key, model,
              'You are a software architect. Analyze a project and output a JSON mindmap with this structure: {"rootNode":{"id":"root","label":"<name>","type":"root","status":"in_progress","children":[{"id":"...","label":"...","type":"module|task|file","status":"pending|in_progress|completed","children":[]}]}}. Identify key modules, tasks, and architecture. Output ONLY valid JSON, no markdown.',
              `Project name: ${name}\nProject path: ${id}\nGenerate a structured mindmap JSON for this project.`
            )
            const genMm = await window.electronAPI.generateMindMap(id, aiMindmap.substring(0, 500))
            if (genMm.success && genMm.filePath) {
              hf.setMindmapPath(id, genMm.filePath)
              addLog(id, 'AI mind map generated: ' + genMm.filePath)
              setInitProgress(prev => ({ ...prev, [id]: { ...prev[id], mindmapResult: 'generated' } }))
            } else {
              throw new Error(genMm.message || 'Mindmap write failed')
            }
          } catch (aiErr) {
            addLog(id, 'AI mindmap failed: ' + String(aiErr) + ', using local fallback')
            const genMm = await window.electronAPI.generateMindMap(id, '')
            if (genMm.success && genMm.filePath) {
              hf.setMindmapPath(id, genMm.filePath)
              setInitProgress(prev => ({ ...prev, [id]: { ...prev[id], mindmapResult: 'generated' } }))
            } else {
              setInitProgress(prev => ({ ...prev, [id]: { ...prev[id], mindmapResult: 'failed' } }))
            }
          }
        } else {
          addLog(id, t.horseFarm.initAIFallback)
          const genMm = await window.electronAPI.generateMindMap(id, '')
          if (genMm.success && genMm.filePath) {
            hf.setMindmapPath(id, genMm.filePath)
            addLog(id, 'Mind map generated: ' + genMm.filePath)
            setInitProgress(prev => ({ ...prev, [id]: { ...prev[id], mindmapResult: 'generated' } }))
          } else {
            addLog(id, 'Mind map failed: ' + (genMm.message || 'unknown'))
            setInitProgress(prev => ({ ...prev, [id]: { ...prev[id], mindmapResult: 'failed' } }))
          }
        }
      } catch (err) {
        addLog(id, 'Mind map error: ' + String(err))
        setInitProgress(prev => ({ ...prev, [id]: { ...prev[id], mindmapResult: 'error' } }))
      }

      addLog(id, 'Done.')
      setInitProgress(prev => ({ ...prev, [id]: { ...prev[id], status: 'done' } }))
    }

    setInitializing(false)
    dispatch({ type: 'SET_MESSAGE', payload: t.horseFarm.initDone })
  }

  const initDone = Object.values(initProgress).filter(p => p.status === 'done').length
  const initTotal = Object.keys(initProgress).length

  return (
    <div className="hf-container">
      <div className="hf-sub-tabs">
        <div style={{ display: 'flex', gap: 0 }}>
          {subTabs.map(tab => (
            <button
              key={tab.key}
              className={`hf-sub-tab ${state.horseFarmActiveSubTab === tab.key ? 'active' : ''}`}
              onClick={() => { dispatch({ type: 'SET_HORSE_FARM_SUB_TAB', payload: tab.key }); setDetailPanel({ type: null, projectPath: null }) }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '16px' }}>
          {agentRunning ? (
            <button
              onClick={handleAbortAgent}
              title="中断 Agent 执行"
              style={{
                padding: '4px 12px', borderRadius: '6px', border: '1px solid #ef4444',
                background: '#ef44441a',
                color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                animation: 'hf-pulse 1.2s ease-in-out infinite',
              }}
            >⏹ 工作中...点击中断</button>
          ) : (
            <button
              onClick={() => setShowCommandPalette(true)}
              title="Quick Command (Ctrl+K)"
              style={{
                padding: '4px 12px', borderRadius: '6px', border: '1px solid #6366f1',
                background: showCommandPalette ? '#6366f122' : 'transparent',
                color: '#6366f1', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
              }}
            >⚡ {t.horseFarm.headerQuickCommand}</button>
          )}
          <button onClick={() => setDetailPanel(prev => prev.type === 'identity' ? { type: null, projectPath: null } : { type: 'identity', projectPath: null })}
            style={{
              padding: '4px 10px', borderRadius: '6px', border: '1px solid #444',
              background: detailPanel.type === 'identity' ? '#6366f122' : 'transparent',
              color: detailPanel.type === 'identity' ? '#6366f1' : '#888',
              cursor: 'pointer', fontSize: '12px',
            }}>{t.horseFarm.headerIdentity}</button>
          <button onClick={() => setDetailPanel(prev => prev.type === 'efficiency' ? { type: null, projectPath: null } : { type: 'efficiency', projectPath: null })}
            style={{
              padding: '4px 10px', borderRadius: '6px', border: '1px solid #444',
              background: detailPanel.type === 'efficiency' ? '#10b98122' : 'transparent',
              color: detailPanel.type === 'efficiency' ? '#10b981' : '#888',
              cursor: 'pointer', fontSize: '12px',
            }}>{t.horseFarm.headerEfficiency}</button>
          <button onClick={() => setDetailPanel(prev => prev.type === 'workflow' ? { type: null, projectPath: null } : { type: 'workflow', projectPath: null })}
            style={{
              padding: '4px 10px', borderRadius: '6px', border: '1px solid #444',
              background: detailPanel.type === 'workflow' ? '#8b5cf622' : 'transparent',
              color: detailPanel.type === 'workflow' ? '#8b5cf6' : '#888',
              cursor: 'pointer', fontSize: '12px',
            }}>{t.horseFarm.headerWorkflow}</button>
          <button onClick={() => setDetailPanel(prev => prev.type === 'plugins' ? { type: null, projectPath: null } : { type: 'plugins', projectPath: null })}
            style={{
              padding: '4px 10px', borderRadius: '6px', border: '1px solid #444',
              background: detailPanel.type === 'plugins' ? '#f59e0b22' : 'transparent',
              color: detailPanel.type === 'plugins' ? '#f59e0b' : '#888',
              cursor: 'pointer', fontSize: '12px',
            }}>{t.horseFarm.headerPlugins}</button>
          <button onClick={() => setDetailPanel(prev => prev.type === 'eco' ? { type: null, projectPath: null } : { type: 'eco', projectPath: null, ecoSubTab: 'resources' })}
            style={{
              padding: '4px 10px', borderRadius: '6px', border: '1px solid #444',
              background: detailPanel.type === 'eco' ? '#06b6d422' : 'transparent',
              color: detailPanel.type === 'eco' ? '#06b6d4' : '#888',
              cursor: 'pointer', fontSize: '12px',
            }}>{t.horseFarm.headerEco}</button>
          <button onClick={() => setDetailPanel(prev => prev.type === 'token' ? { type: null, projectPath: null } : { type: 'token', projectPath: null })}
            style={{
              padding: '4px 10px', borderRadius: '6px', border: '1px solid #444',
              background: detailPanel.type === 'token' ? '#f59e0b22' : 'transparent',
              color: detailPanel.type === 'token' ? '#f59e0b' : '#888',
              cursor: 'pointer', fontSize: '12px',
            }}>{t.horseFarm.headerTokens}</button>
          <button onClick={() => setDetailPanel(prev => prev.type === 'system' ? { type: null, projectPath: null } : { type: 'system', projectPath: null, systemSubTab: 'rules' })}
            style={{
              padding: '4px 10px', borderRadius: '6px', border: '1px solid #444',
              background: detailPanel.type === 'system' ? '#ef444422' : 'transparent',
              color: detailPanel.type === 'system' ? '#ef4444' : '#888',
              cursor: 'pointer', fontSize: '12px',
            }}>{t.horseFarm.headerSystem}</button>
          {initializing && (
            <span style={{ fontSize: '12px', color: '#7c3aed', fontWeight: 500 }}>
              {initDone}/{initTotal}
            </span>
          )}
          <button
            onClick={handleInitializeAll}
            disabled={initializing || state.horseFarmProjectIds.length === 0}
            className="hf-init-all-btn"
          >
            {initializing ? '⏳ ' + t.horseFarm.initializing : '🚀 ' + t.horseFarm.initializeAll}
          </button>
        </div>
      </div>

      {state.horseFarmActiveSubTab === 'settings' ? (
        <div className="hf-sub-content">
          <HorseFarmSettings config={hfConfig} onConfigChange={setHfConfig} />
        </div>
      ) : (
        <div className="hf-main-layout">
          <div className="hf-left-panel">
            <ProjectList
              projectIds={state.horseFarmProjectIds}
              hfProjects={hf.hfProjects}
              activeProject={state.horseFarmActiveProject}
              projects={state.projects}
              detailProjectPath={detailPanel.projectPath}
              detailPanelType={detailPanel.type}
              initProgress={initProgress}
              projectStatuses={chat.projectStatuses}
              onOpenHarness={() => setDetailPanel(
                prev => prev.type === 'harness' ? { type: null, projectPath: null } : { type: 'harness', projectPath: null }
              )}
              onOpenCli={() => setDetailPanel(
                prev => prev.type === 'cli' ? { type: null, projectPath: null } : { type: 'cli', projectPath: null }
              )}
              onViewMindMap={(path) => setDetailPanel({ type: 'mindmap', projectPath: path })}
              onViewKB={(path) => setDetailPanel({ type: 'kb', projectPath: path })}
              onViewInitLog={(path) => setDetailPanel({ type: 'initLog', projectPath: path })}
              onLaunchChat={(path) => handleLaunchChat(path)}
              onViewAudit={(path) => handleViewAudit(path)}
              onSelectProject={(path) => dispatch({ type: 'SET_HORSE_FARM_ACTIVE_PROJECT', payload: path })}
              onRemoveProject={(path) => {
                dispatch({ type: 'REMOVE_FROM_HORSE_FARM', payload: path })
                const newIds = state.horseFarmProjectIds.filter(id => id !== path)
                const individualMap: Record<string, { name: string; path: string; repoPath: string; source: string; status: string }> = {}
                for (const proj of state.projects) {
                  if (proj.source === 'individual' && newIds.includes(proj.path)) {
                    individualMap[proj.path] = { name: proj.name, path: proj.path, repoPath: proj.repoPath, source: proj.source, status: proj.status }
                  }
                }
                window.electronAPI.saveHorseFarmProjectIds(newIds, individualMap).catch(() => {})
              }}
              onOpenProject={(path) => { window.electronAPI.openFolder(path).catch(() => {}) }}
              getProgress={hf.getProjectProgress}
              updateRequirements={hf.updateRequirements}
              updateSummary={hf.updateSummary}
              setPhase={hf.setPhase}
              setMindmapPath={hf.setMindmapPath}
              setKnowledgeBasePath={hf.setKnowledgeBasePath}
              addSystemMessage={hf.addSystemMessage}
              addTask={hf.addTask}
              updateTask={hf.updateTask}
              removeTask={hf.removeTask}
            />
          </div>

          <div className="hf-right-panel">
            {detailPanel.type === 'mindmap' && detailPanel.projectPath && (
              <MindMapViewer
                activeProject={detailPanel.projectPath}
                hfProjects={hf.hfProjects}
              />
            )}
            {detailPanel.type === 'kb' && detailPanel.projectPath && (
              <KnowledgeBaseViewer
                activeProject={detailPanel.projectPath}
                hfProjects={hf.hfProjects}
              />
            )}
            {detailPanel.type === 'chat' && detailPanel.projectPath && (
              <ChatPanel projectPath={detailPanel.projectPath} embedded />
            )}
            {detailPanel.type === 'harness' && (
              <HarnessAgentPanel
                projectIds={state.horseFarmProjectIds}
                hfProjects={hf.hfProjects}
                hfConfig={hfConfig}
                embedded
              />
            )}
            {detailPanel.type === 'audit' && detailPanel.projectPath && (
              <AuditPanel projectPath={detailPanel.projectPath} embedded />
            )}
            {detailPanel.type === 'cli' && (
              <CliToolsPanel
                projectIds={state.horseFarmProjectIds}
                hfProjects={hf.hfProjects}
                apiKey={hfConfig.apiKeys.find(k => k.enabled && k.status === 'active')?.key}
                model={hfConfig.settings.defaultModel}
              />
            )}
            {detailPanel.type === 'plugins' && (
              <PluginStore />
            )}
            {detailPanel.type === 'identity' && (
              <IdentityProfile />
            )}
            {detailPanel.type === 'efficiency' && (
              <EfficiencyDashboard />
            )}
            {detailPanel.type === 'workflow' && (
              <WorkflowPanel subTab={detailPanel.workflowSubTab || 'editor'} onTabChange={tab => setDetailPanel(prev => ({ ...prev, workflowSubTab: tab }))} />
            )}
            {detailPanel.type === 'eco' && (
              <EcoPanel subTab={detailPanel.ecoSubTab || 'resources'} onTabChange={tab => setDetailPanel(prev => ({ ...prev, ecoSubTab: tab }))} />
            )}
            {detailPanel.type === 'system' && (
              <SystemPanel subTab={detailPanel.systemSubTab || 'rules'} onTabChange={tab => setDetailPanel(prev => ({ ...prev, systemSubTab: tab }))} />
            )}
            {detailPanel.type === 'token' && <TokenStatsPanel />}
            {detailPanel.type === 'initLog' && detailPanel.projectPath && initProgress[detailPanel.projectPath] && (
              <div className="hf-init-log-viewer">
                <h4 style={{ margin: '0 0 12px', fontSize: '14px', color: '#1f2937' }}>
                  Init Log — {hf.hfProjects[detailPanel.projectPath]?.projectName || detailPanel.projectPath.split('\\').pop()}
                </h4>
                <div className="hf-init-log-lines">
                  {initProgress[detailPanel.projectPath].log.map((line, i) => (
                    <div key={i} className="hf-init-log-line">{line}</div>
                  ))}
                </div>
              </div>
            )}
            {!detailPanel.type && (
              <HarnessAgentPanel
                projectIds={state.horseFarmProjectIds}
                hfProjects={hf.hfProjects}
                hfConfig={hfConfig}
                embedded
              />
            )}
          </div>
        </div>
      )}

      {/* Quick Command Palette Modal (Ctrl+K) */}
      {showCommandPalette && (
        <div
          className="hf-workflow-overlay"
          onClick={() => setShowCommandPalette(false)}
          style={{ zIndex: 1000 }}
        >
          <div
            style={{
              background: 'var(--app-bg-primary)',
              borderRadius: 12,
              width: 680,
              maxWidth: '90vw',
              maxHeight: '70vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              overflow: 'hidden',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 14px', borderBottom: '1px solid var(--app-border-primary)',
              background: 'var(--app-bg-header)',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--app-text-primary)' }}>
                ⚡ Quick Command
              </span>
              <span style={{ fontSize: 10, color: 'var(--app-text-secondary)' }}>Ctrl+K</span>
            </div>
            <div style={{ flex: 1, overflow: 'auto', maxHeight: '60vh' }}>
              <CommandPalette
                projectIds={state.horseFarmProjectIds}
                hfProjects={hf.hfProjects}
                apiKey={hfConfig.apiKeys.find(k => k.enabled && k.status === 'active')?.key}
                model={hfConfig.settings.defaultModel}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CliToolsPanel({ projectIds, hfProjects, apiKey, model }: {
  projectIds: string[]
  hfProjects: Record<string, any>
  apiKey?: string
  model?: string
}) {
  const [tab, setTab] = useState<'batch' | 'favorites' | 'plugins'>('favorites')
  const { t } = useI18n()
  const projectNames: Record<string, string> = {}
  for (const id of projectIds) {
	    projectNames[id] = hfProjects[id]?.projectName || id.split("\\").pop() || id
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', gap: 0, borderBottom: '1px solid var(--app-border-primary)',
        padding: '0 12px',
      }}>
        <button onClick={() => setTab('favorites')} style={{
          padding: '6px 14px', border: 'none', background: 'transparent',
          color: tab === 'favorites' ? '#6366f1' : 'var(--app-text-secondary)',
          borderBottom: tab === 'favorites' ? '2px solid #6366f1' : '2px solid transparent',
          cursor: 'pointer', fontSize: 11, fontWeight: tab === 'favorites' ? 600 : 400,
        }}>{t.cli.favorites}</button>
        <button onClick={() => setTab('batch')} style={{
          padding: '6px 14px', border: 'none', background: 'transparent',
          color: tab === 'batch' ? '#6366f1' : 'var(--app-text-secondary)',
          borderBottom: tab === 'batch' ? '2px solid #6366f1' : '2px solid transparent',
          cursor: 'pointer', fontSize: 11, fontWeight: tab === 'batch' ? 600 : 400,
        }}>{t.cli.batch}</button>
        <button onClick={() => setTab('plugins')} style={{
          padding: '6px 14px', border: 'none', background: 'transparent',
          color: tab === 'plugins' ? '#6366f1' : 'var(--app-text-secondary)',
          borderBottom: tab === 'plugins' ? '2px solid #6366f1' : '2px solid transparent',
          cursor: 'pointer', fontSize: 11, fontWeight: tab === 'plugins' ? 600 : 400,
        }}>{t.cli.plugins}</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'favorites' && (
          <FavoritesPanel onExecute={(cmd, args) => {
            fragmentCollector.collect('cli.command', cmd, { args }, projectIds[0])
            window.electronAPI.cliExecute({
              command: cmd, args, projectIds, projectNames, apiKey, model,
            })
          }} />
        )}
        {tab === 'batch' && (
          <BatchManager projectIds={projectIds} projectNames={projectNames} apiKey={apiKey} model={model} />
        )}
        {tab === 'plugins' && (
          <PluginStore />
        )}
      </div>
    </div>
  )
}

function EcoPanel({ subTab, onTabChange }: { subTab: 'resources' | 'migrator'; onTabChange: (tab: 'resources' | 'migrator') => void }) {
  const { t } = useI18n()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', gap: 0, borderBottom: '1px solid #1e293b',
        padding: '0 12px',
      }}>
        <button onClick={() => onTabChange('resources')} style={{
          padding: '6px 14px', border: 'none', background: 'transparent',
          color: subTab === 'resources' ? '#06b6d4' : '#94a3b8',
          borderBottom: subTab === 'resources' ? '2px solid #06b6d4' : '2px solid transparent',
          cursor: 'pointer', fontSize: 11, fontWeight: subTab === 'resources' ? 600 : 400,
        }}>{t.eco.resourceHub}</button>
        <button onClick={() => onTabChange('migrator')} style={{
          padding: '6px 14px', border: 'none', background: 'transparent',
          color: subTab === 'migrator' ? '#06b6d4' : '#94a3b8',
          borderBottom: subTab === 'migrator' ? '2px solid #06b6d4' : '2px solid transparent',
          cursor: 'pointer', fontSize: 11, fontWeight: subTab === 'migrator' ? 600 : 400,
        }}>{t.eco.configMigrator}</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '14px' }}>
        {subTab === 'resources' ? <ResourceHub /> : <ConfigMigrator />}
      </div>
    </div>
  )
}

function WorkflowPanel({ subTab, onTabChange }: { subTab: 'editor' | 'templates'; onTabChange: (tab: 'editor' | 'templates') => void }) {
  const { t } = useI18n()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', gap: 0, borderBottom: '1px solid #1e293b',
        padding: '0 12px',
      }}>
        <button onClick={() => onTabChange('editor')} style={{
          padding: '6px 14px', border: 'none', background: 'transparent',
          color: subTab === 'editor' ? '#8b5cf6' : '#94a3b8',
          borderBottom: subTab === 'editor' ? '2px solid #8b5cf6' : '2px solid transparent',
          cursor: 'pointer', fontSize: 11, fontWeight: subTab === 'editor' ? 600 : 400,
        }}>{t.workflow.editor}</button>
        <button onClick={() => onTabChange('templates')} style={{
          padding: '6px 14px', border: 'none', background: 'transparent',
          color: subTab === 'templates' ? '#8b5cf6' : '#94a3b8',
          borderBottom: subTab === 'templates' ? '2px solid #8b5cf6' : '2px solid transparent',
          cursor: 'pointer', fontSize: 11, fontWeight: subTab === 'templates' ? 600 : 400,
        }}>{t.workflow.templates}</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {subTab === 'editor' ? <WorkflowEditor /> : <WorkflowTemplates onApply={() => {}} />}
      </div>
    </div>
  )
}

function SystemPanel({ subTab, onTabChange }: { subTab: 'rules' | 'audit' | 'perf'; onTabChange: (tab: 'rules' | 'audit' | 'perf') => void }) {
  const { t } = useI18n()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', gap: 0, borderBottom: '1px solid #1e293b',
        padding: '0 12px',
      }}>
        <button onClick={() => onTabChange('rules')} style={{
          padding: '6px 14px', border: 'none', background: 'transparent',
          color: subTab === 'rules' ? '#ef4444' : '#94a3b8',
          borderBottom: subTab === 'rules' ? '2px solid #ef4444' : '2px solid transparent',
          cursor: 'pointer', fontSize: 11, fontWeight: subTab === 'rules' ? 600 : 400,
        }}>{t.system.ruleEngine}</button>
        <button onClick={() => onTabChange('audit')} style={{
          padding: '6px 14px', border: 'none', background: 'transparent',
          color: subTab === 'audit' ? '#ef4444' : '#94a3b8',
          borderBottom: subTab === 'audit' ? '2px solid #ef4444' : '2px solid transparent',
          cursor: 'pointer', fontSize: 11, fontWeight: subTab === 'audit' ? 600 : 400,
        }}>{t.system.auditLog}</button>
        <button onClick={() => onTabChange('perf')} style={{
          padding: '6px 14px', border: 'none', background: 'transparent',
          color: subTab === 'perf' ? '#ef4444' : '#94a3b8',
          borderBottom: subTab === 'perf' ? '2px solid #ef4444' : '2px solid transparent',
          cursor: 'pointer', fontSize: 11, fontWeight: subTab === 'perf' ? 600 : 400,
        }}>{t.system.performance}</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ display: subTab === 'rules' ? undefined : 'none' }}><RuleEditor /></div>
        <div style={{ display: subTab === 'audit' ? undefined : 'none' }}><AuditLogViewer /></div>
        <div style={{ display: subTab === 'perf' ? undefined : 'none' }}><PerformanceDashboard /></div>
      </div>
    </div>
  )
}
