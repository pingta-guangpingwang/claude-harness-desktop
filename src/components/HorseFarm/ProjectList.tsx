import { useMemo } from 'react'
import { useI18n } from '../../i18n'
import { useHFContext, type Project } from '../../context/HFContext'
import type { HorseFarmProject, HFTask } from '../../types/horseFarm'
import type { InitProgress } from './HorseFarm'
import type { ProjectPtyStatus } from '../../context/ChatContext'
import ProjectProgressCard from './ProjectProgressCard'
import { VirtualList } from '../Shared/VirtualList'

interface ProjectListProps {
  projectIds: string[]
  hfProjects: Record<string, HorseFarmProject>
  activeProject: string | null
  projects: Project[]
  detailProjectPath: string | null
  detailPanelType: string | null
  initProgress: Record<string, InitProgress>
  projectStatuses: Record<string, ProjectPtyStatus>
  onSelectProject: (path: string) => void
  onRemoveProject: (path: string) => void
  onOpenProject: (path: string) => void
  onOpenHarness: () => void
  onOpenCli: () => void
  onViewMindMap: (path: string) => void
  onViewKB: (path: string) => void
  onViewInitLog: (path: string) => void
  onLaunchChat: (path: string) => void
  onViewAudit: (path: string) => void
  getProgress: (path: string) => number
  updateRequirements: (path: string, requirements: string) => void
  updateSummary: (path: string, summary: string) => void
  setPhase: (path: string, phase: HorseFarmProject['phase']) => void
  setMindmapPath: (path: string, mp: string) => void
  setKnowledgeBasePath: (path: string, kb: string) => void
  addSystemMessage: (path: string | null, content: string, type?: 'chat' | 'command' | 'status' | 'error') => void
  addTask: (path: string, task: HFTask) => void
  updateTask: (path: string, taskId: string, updates: Partial<HFTask>) => void
  removeTask: (path: string, taskId: string) => void
}

export default function ProjectList({
  projectIds, hfProjects, activeProject, projects, detailProjectPath, detailPanelType, initProgress,
  projectStatuses,
  onSelectProject, onRemoveProject, onOpenProject, onOpenHarness, onOpenCli, onViewMindMap, onViewKB, onViewInitLog, onLaunchChat, onViewAudit,
  getProgress, updateRequirements, updateSummary, setPhase,
  setMindmapPath, setKnowledgeBasePath, addSystemMessage,
  addTask, updateTask, removeTask,
}: ProjectListProps) {
  const { t } = useI18n()
  const [, dispatch] = useHFContext()

  const validProjects = useMemo(() =>
    projectIds.map(id => ({ id, hf: hfProjects[id], pj: projects.find(p => p.path === id) }))
      .filter(x => x.hf),
    [projectIds, hfProjects, projects])

  if (projectIds.length === 0) {
    return (
      <div className="hf-empty-state">
        <div style={{ fontSize: '48px', marginBottom: '12px' }}>🐴</div>
        <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#374151' }}>{t.horseFarm.tabLabel}</h3>
        <p style={{ margin: '0 0 8px', color: '#6b7280', fontSize: '13px' }}>{t.horseFarm.noProjects}</p>
        <p style={{ margin: '0 0 20px', color: '#9ca3af', fontSize: '12px' }}>
          {t.horseFarm.selectProjects}
        </p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button
            onClick={() => dispatch({ type: 'SET_CURRENT_VIEW', payload: 'selector' })}
            style={{
              padding: '8px 20px', borderRadius: '8px', border: 'none',
              background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
              color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
            }}
          >
            {t.horseFarm.addFromRepo}
          </button>
          <button
            onClick={() => dispatch({ type: 'SET_HORSE_FARM_SUB_TAB', payload: 'settings' })}
            style={{
              padding: '8px 20px', borderRadius: '8px',
              border: '1px solid #d1d5db', background: '#fff',
              color: '#374151', cursor: 'pointer', fontSize: '13px', fontWeight: 500,
            }}
          >
            {t.horseFarm.subTabSettings}
          </button>
        </div>
      </div>
    )
  }

  const renderCard = ({ id, hf, pj }: typeof validProjects[number]) => (
    <div style={{ paddingBottom: 8 }}>
      <ProjectProgressCard
        hfProject={hf}
        project={pj}
        isActive={activeProject === id}
        progress={getProgress(id)}
        ptyStatus={projectStatuses[id]}
        detailProjectPath={detailProjectPath}
        detailPanelType={detailPanelType}
        initProgress={initProgress[id]}
        onSelect={() => onSelectProject(id)}
        onRemove={() => onRemoveProject(id)}
        onOpen={() => onOpenProject(id)}
        onViewMindMap={() => onViewMindMap(id)}
        onViewKB={() => onViewKB(id)}
        onViewInitLog={() => onViewInitLog(id)}
        onLaunchChat={() => onLaunchChat(id)}
        onViewAudit={() => onViewAudit(id)}
        updateRequirements={(req) => updateRequirements(id, req)}
        updateSummary={(sum) => updateSummary(id, sum)}
        setPhase={(p) => setPhase(id, p)}
        setMindmapPath={(mp) => setMindmapPath(id, mp)}
        setKnowledgeBasePath={(kb) => setKnowledgeBasePath(id, kb)}
        addSystemMessage={(content, type) => addSystemMessage(id, content, type)}
        addTask={(task) => addTask(id, task)}
        updateTask={(taskId, updates) => updateTask(id, taskId, updates)}
        removeTask={(taskId) => removeTask(id, taskId)}
      />
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 驾驭智能体 — 常驻顶部管理卡片 */}
      <div
        onClick={onOpenHarness}
        style={{
          margin: '0 8px 8px', padding: '12px 14px', borderRadius: 10,
          border: detailPanelType === 'harness' ? '2px solid #6366f1' : '1px solid var(--app-border-primary)',
          background: detailPanelType === 'harness'
            ? 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.08))'
            : 'var(--app-bg-secondary)',
          cursor: 'pointer', flexShrink: 0,
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🛡️</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--app-text-primary)' }}>
              {t.harnessAgent.harnessCardTitle}
            </div>
            <div style={{ fontSize: 10, color: 'var(--app-text-secondary)', marginTop: 2 }}>
              {t.harnessAgent.harnessCardDesc}
            </div>
          </div>
          <span style={{
            padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
            background: '#6366f1', color: '#fff',
          }}>
              {t.harnessAgent.harnessCardBadge}
          </span>
        </div>
      </div>

      {/* CLI 命令行 — 常驻卡片 */}
      <div
        onClick={onOpenCli}
        style={{
          margin: '0 8px 8px', padding: '10px 14px', borderRadius: 10,
          border: detailPanelType === 'cli' ? '2px solid #10b981' : '1px solid var(--app-border-primary)',
          background: detailPanelType === 'cli'
            ? 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(5,150,105,0.06))'
            : 'var(--app-bg-secondary)',
          cursor: 'pointer', flexShrink: 0,
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>⚡</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--app-text-primary)' }}>
              {t.cli.title}
            </div>
            <div style={{ fontSize: 10, color: 'var(--app-text-secondary)', marginTop: 2 }}>
              {t.cli.subtitle}
            </div>
          </div>
          <span style={{
            padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
            background: '#10b981', color: '#fff',
          }}>
            v3.1
          </span>
        </div>
      </div>

      <VirtualList
        items={validProjects}
        renderItem={renderCard}
        getItemKey={(x) => x.id}
        estimateHeight={120}
        overscan={3}
        className="hf-project-list"
      />
    </div>
  )
}
