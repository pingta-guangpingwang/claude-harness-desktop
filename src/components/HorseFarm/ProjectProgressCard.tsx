import { useState, useEffect, useCallback } from 'react'
import { useI18n } from '../../i18n'
import type { HorseFarmProject, HFTask } from '../../types/horseFarm'
import type { Project } from '../../context/HFContext'
import type { InitProgress } from './HorseFarm'
import { SafeText } from '../Shared/SafeText'
import type { ProjectPtyStatus } from '../../context/ChatContext'
import PreProjectWorkflow from './PreProjectWorkflow'
import TaskTracker from './TaskTracker'

interface ProjectProgressCardProps {
  hfProject: HorseFarmProject
  project: Project | undefined
  isActive: boolean
  progress: number
  ptyStatus?: ProjectPtyStatus
  onSelect: () => void
  onRemove: () => void
  onOpen: () => void
  onViewMindMap: () => void
  onViewKB: () => void
  onViewInitLog: () => void
  onLaunchChat: () => void
  onViewAudit: () => void
  detailProjectPath: string | null
  detailPanelType: string | null
  initProgress?: InitProgress
  updateRequirements: (requirements: string) => void
  updateSummary: (summary: string) => void
  setPhase: (phase: HorseFarmProject['phase']) => void
  setMindmapPath: (path: string) => void
  setKnowledgeBasePath: (path: string) => void
  addSystemMessage: (content: string, type?: 'chat' | 'command' | 'status' | 'error') => void
  addTask: (task: HFTask) => void
  updateTask: (taskId: string, updates: Partial<HFTask>) => void
  removeTask: (taskId: string) => void
}

const phaseLabels: Record<string, string> = {
  idle: 'phaseIdle', requirements: 'phaseRequirements',
  summarizing: 'phaseSummarizing', mindmap: 'phaseMindmap',
  active: 'phaseActive', paused: 'phasePaused',
}

export default function ProjectProgressCard({
  hfProject, project, isActive, progress, ptyStatus,
  onSelect, onRemove, onOpen, onViewMindMap, onViewKB, onViewInitLog, onLaunchChat, onViewAudit, detailProjectPath, detailPanelType, initProgress,
  updateRequirements, updateSummary, setPhase, setMindmapPath, setKnowledgeBasePath,
  addSystemMessage, addTask, updateTask, removeTask,
}: ProjectProgressCardProps) {
  const { t } = useI18n()
  const [showWorkflow, setShowWorkflow] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  // 追踪 AI 是否正在工作中（2秒内有 PTY 数据 = 工作中）
  useEffect(() => {
    if (ptyStatus?.isConnected && ptyStatus.lastDataAt > 0) {
      const age = Date.now() - ptyStatus.lastDataAt
      if (age < 2000) {
        setIsProcessing(true)
        const timer = setTimeout(() => setIsProcessing(false), 2000 - age)
        return () => clearTimeout(timer)
      }
    }
    setIsProcessing(false)
  }, [ptyStatus?.lastDataAt, ptyStatus?.isConnected])
  const isComplete = progress >= 100

  // Notes
  const [hasLaunchBat, setHasLaunchBat] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [tipModal, setTipModal] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [showNotesEditor, setShowNotesEditor] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')

  useEffect(() => {
    window.electronAPI.loadProjectNotes(hfProject.projectPath).then(r => {
      if (r.success) setNotes(r.notes || '')
    }).catch(() => {})
  }, [hfProject.projectPath])

  // 检查启动脚本 + 监听生成事件（驾驭智能体 generateLaunchScriptsTool 写完后刷新）
  const checkBat = useCallback(() => {
    window.electronAPI.checkLaunchBat(hfProject.projectPath).then(r => {
      setHasLaunchBat(r.success && r.exists)
    }).catch(() => setHasLaunchBat(false))
  }, [hfProject.projectPath])

  useEffect(() => {
    checkBat()
    // 每隔 3 秒轮询一次（驾驭智能体生成 bat 后按钮自动变亮）
    const interval = setInterval(checkBat, 3000)
    return () => clearInterval(interval)
  }, [checkBat])

  const openNotesEditor = useCallback(() => {
    setNotesDraft(notes)
    setShowNotesEditor(true)
  }, [notes])

  const saveNotes = useCallback(async () => {
    const result = await window.electronAPI.saveProjectNotes(hfProject.projectPath, notesDraft)
    if (result.success) {
      setNotes(notesDraft)
      setShowNotesEditor(false)
    }
  }, [hfProject.projectPath, notesDraft])

  return (
    <>
      <div
        className="hf-project-card"
        style={{ borderColor: isActive ? '#4f46e5' : undefined }}
        onClick={onSelect}
      >
        <div className="hf-project-card-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* PTY 状态指示灯: 灰=未启动 黄闪=连接中 绿闪=工作中 绿=就绪 红=断开 */}
              {(() => {
                let color = '#9ca3af', label = t.horseFarm.statusIndicatorIdle, glow: string | undefined, pulse: string | undefined
                if (ptyStatus) {
                  if (ptyStatus.isConnecting) {
                    color = '#f59e0b'; label = t.horseFarm.statusIndicatorConnecting; glow = '0 0 6px #f59e0b'; pulse = 'hf-pulse 1s ease-in-out infinite'
                  } else if (ptyStatus.isConnected && isProcessing) {
                    color = '#10b981'; label = t.horseFarm.statusIndicatorWorking; glow = '0 0 8px #10b981'; pulse = 'hf-pulse 0.6s ease-in-out infinite'
                  } else if (ptyStatus.isConnected) {
                    color = '#10b981'; label = t.horseFarm.statusIndicatorReady; glow = '0 0 4px #10b981'
                  } else {
                    color = '#ef4444'; label = t.horseFarm.statusIndicatorDisconnected
                  }
                }
                return (
                  <span title={label} style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    background: color, boxShadow: glow, animation: pulse,
                  }} />
                )
              })()}
              <h4 className="hf-project-name">{hfProject.projectName}</h4>
              {project && (
                <span style={{
                  fontSize: '10px', padding: '2px 8px', borderRadius: '10px',
                  background: project.source === 'individual' ? '#fef3c7' : '#dbeafe',
                  color: project.source === 'individual' ? '#92400e' : '#2563eb',
                  fontWeight: 500,
                }}>
                  {project.source === 'individual' ? t.selector.sourceIndividual : t.selector.sourceDBHT}
                </span>
              )}
            </div>
            <div className="hf-project-path">{hfProject.projectPath}</div>
            {/* Notes display — max 2 lines, double-click to edit */}
            <div
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => { e.stopPropagation(); openNotesEditor(); }}
              title={t.horseFarm.notesPlaceholder}
              style={{
                fontSize: '11px', color: notes ? '#374151' : '#9ca3af', marginTop: '4px',
                lineHeight: '1.5', cursor: 'pointer',
                overflow: 'hidden', maxHeight: notes ? '2.8em' : '1.5em',
                wordBreak: 'break-word', minHeight: '20px',
                padding: '3px 6px', borderRadius: '4px',
                border: notes ? '1px solid #e5e7eb' : '1px dashed #d1d5db',
                background: notes ? '#f9fafb' : '#fafafa',
                userSelect: 'none',
              }}
            >
              {notes ? <SafeText text={notes} collapsibleAt={120} /> : '💬 ' + t.horseFarm.notesPlaceholder}
            </div>
            {notes && notes.length > 120 && (
              <button
                onClick={(e) => { e.stopPropagation(); openNotesEditor(); }}
                style={{
                  fontSize: '10px', padding: '0 4px', border: 'none', background: 'transparent',
                  color: '#6366f1', cursor: 'pointer', textDecoration: 'underline',
                  alignSelf: 'flex-start',
                }}
              >
                {t.horseFarm.notesViewAll}
              </button>
            )}
          </div>
          <span className={`hf-phase-badge ${hfProject.phase}`}>
            {t.horseFarm[phaseLabels[hfProject.phase] as keyof typeof t.horseFarm] || hfProject.phase}
          </span>
        </div>

        <div className="hf-progress-bar">
          <div
            className={`hf-progress-fill ${isComplete ? 'complete' : ''}`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>

        {initProgress && (initProgress.status === 'running' || initProgress.status === 'queued') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' }}>
            <span style={{ fontSize: '11px', color: '#7c3aed', fontWeight: 500 }}>
              {initProgress.status === 'queued' ? '⏳' : '🔄'} {t.horseFarm[initProgress.status === 'queued' ? 'initQueued' : 'initRunning' as keyof typeof t.horseFarm]}
            </span>
            <div className="hf-progress-bar" style={{ flex: 1 }}>
              <div
                className="hf-progress-fill"
                style={{
                  width: initProgress.kbResult ? '70%' : '30%',
                  animation: initProgress.status === 'running' ? 'hf-pulse 1.5s ease-in-out infinite' : undefined,
                }}
              />
            </div>
          </div>
        )}
        {initProgress && initProgress.status === 'done' && (
          <div style={{ fontSize: '11px', color: '#059669', fontWeight: 500 }}>✅ {t.horseFarm.initDoneLabel}</div>
        )}
        {initProgress && initProgress.status === 'error' && (
          <div style={{ fontSize: '11px', color: '#dc2626', fontWeight: 500 }}>❌ {t.horseFarm.initFailedLabel}</div>
        )}
        {!initProgress && (
          <div className="hf-task-summary">
            {t.horseFarm.tasksCompleted
              .replace('{done}', String(hfProject.tasks.filter(t => t.status === 'completed').length))
              .replace('{total}', String(hfProject.tasks.length))}
          </div>
        )}

        <div className="hf-card-actions">
          <button
            title={`打开项目文件夹\n${hfProject.projectPath}`}
            className="hf-open-folder-btn"
            onClick={async (e) => {
              e.stopPropagation()
              console.log('[OpenFolder] 点击打开按钮, path:', hfProject.projectPath)
              const btn = e.currentTarget as HTMLButtonElement
              btn.classList.add('hf-clicked')
              setTimeout(() => btn.classList.remove('hf-clicked'), 200)
              try {
                const result = await window.electronAPI.openFolder(hfProject.projectPath)
                console.log('[OpenFolder] 结果:', JSON.stringify(result))
                if (!result.success) {
                  addSystemMessage(`打开文件夹失败: ${(result as any).message || '未知错误'}`, 'error')
                }
              } catch (err) {
                console.error('[OpenFolder] 异常:', err)
                addSystemMessage(`打开文件夹异常: ${String(err)}`, 'error')
              }
            }}>{t.horseFarm.openProject}</button>
          <button
            className="primary"
            onClick={(e) => { e.stopPropagation(); onLaunchChat() }}
            style={{ background: '#10b981', borderColor: '#10b981' }}
          >
            Chat
          </button>
          {/* 一键启动按钮 */}
          <button
              onClick={async (e) => {
                e.stopPropagation()
                if (launching) return
                if (!hasLaunchBat) {
                  setTipModal('launchBatGenerate')
                  return
                }
                setLaunching(true)
                try {
                  const res = await window.electronAPI.launchProject(hfProject.projectPath)
                  if (!res.success) {
                    addSystemMessage(`启动失败: ${res.message || '未知错误'}`, 'error')
                  }
                } catch (err) {
                  addSystemMessage(`启动异常: ${String(err)}`, 'error')
                } finally {
                  setLaunching(false)
                }
              }}
              title={launching ? '启动中...' : hasLaunchBat ? t.horseFarm.launchBatGenerated : t.horseFarm.launchBatNoScript}
              style={{
                padding: '4px 8px', borderRadius: '4px', border: hasLaunchBat ? '1px solid #f59e0b' : '1px solid #d1d5db',
                background: hasLaunchBat ? '#fef3c7' : '#e5e7eb',
                cursor: 'pointer', fontSize: '20px',
                transition: 'all 0.2s', lineHeight: 1,
                filter: hasLaunchBat ? 'none' : 'grayscale(100%)',
                opacity: launching ? 0.5 : (hasLaunchBat ? 1 : 0.25),
              }}
            >{launching ? '⏳' : '🚀'}</button>
          {hfProject.phase === 'idle' || hfProject.phase === 'requirements' ? (
            <button className="primary" onClick={(e) => { e.stopPropagation(); setShowWorkflow(true) }}>
              {t.horseFarm.workflowTitle}
            </button>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}>
              {expanded ? t.horseFarm.collapseTasks : t.horseFarm.expandTasks}
            </button>
          )}
          {initProgress && (
            <button onClick={(e) => { e.stopPropagation(); onViewInitLog() }}
              style={{ color: detailPanelType === 'initLog' && detailProjectPath === hfProject.projectPath ? '#7c3aed' : '#6b7280', fontWeight: detailPanelType === 'initLog' && detailProjectPath === hfProject.projectPath ? 600 : 400 }}
            >📋</button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onViewMindMap() }}
            style={{ color: detailPanelType === 'mindmap' && detailProjectPath === hfProject.projectPath ? '#7c3aed' : '#6b7280', fontWeight: detailPanelType === 'mindmap' && detailProjectPath === hfProject.projectPath ? 600 : 400 }}
          >🧠</button>
          <button onClick={(e) => { e.stopPropagation(); onViewKB() }}
            style={{ color: detailPanelType === 'kb' && detailProjectPath === hfProject.projectPath ? '#059669' : '#6b7280', fontWeight: detailPanelType === 'kb' && detailProjectPath === hfProject.projectPath ? 600 : 400 }}
          >📄</button>
          <button onClick={(e) => { e.stopPropagation(); onViewAudit() }}
            style={{ color: detailPanelType === 'audit' && detailProjectPath === hfProject.projectPath ? '#7c3aed' : '#6b7280', fontWeight: detailPanelType === 'audit' && detailProjectPath === hfProject.projectPath ? 600 : 400 }}
            title="审计"
          >📊</button>
          <div style={{ position: 'relative' }}>
            {confirmRemove ? (
              <div style={{
                position: 'absolute', bottom: '100%', right: 0, marginBottom: 4,
                display: 'flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap',
                padding: '6px 10px', borderRadius: 8,
                background: '#fef2f2', border: '1px solid #fecaca',
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                zIndex: 100,
              }} onClick={e => e.stopPropagation()}>
                <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: 500, whiteSpace: 'nowrap' }}>{t.horseFarm.removeConfirm}</span>
                <button
                  onClick={() => { onRemove(); setConfirmRemove(false) }}
                  style={{ padding: '2px 8px', borderRadius: 4, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontSize: 10, whiteSpace: 'nowrap' }}
                >
                  {t.horseFarm.removeConfirmProceed}
                </button>
                <button
                  onClick={() => setConfirmRemove(false)}
                  style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer', fontSize: 10, whiteSpace: 'nowrap' }}
                >
                  ✕
                </button>
              </div>
            ) : null}
            <button onClick={(e) => { e.stopPropagation(); setConfirmRemove(true) }} style={{ color: '#9ca3af' }}>
              {t.horseFarm.removeFromFarm}
            </button>
          </div>
        </div>

        {expanded && (
          <TaskTracker
            tasks={hfProject.tasks}
            projectPath={hfProject.projectPath}
            onAddTask={addTask}
            onUpdateTask={updateTask}
            onRemoveTask={removeTask}
          />
        )}
      </div>

      {showWorkflow && (
        <PreProjectWorkflow
          hfProject={hfProject}
          project={project}
          onClose={() => setShowWorkflow(false)}
          updateRequirements={updateRequirements}
          updateSummary={updateSummary}
          setPhase={setPhase}
          setMindmapPath={setMindmapPath}
          setKnowledgeBasePath={setKnowledgeBasePath}
          addSystemMessage={addSystemMessage}
        />
      )}

      {/* Notes Editor Popup */}
      {showNotesEditor && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1001,
          background: 'rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowNotesEditor(false)}>
          <div style={{
            background: '#fff', borderRadius: '12px', padding: '20px',
            width: '520px', maxWidth: '94vw', maxHeight: '80vh',
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            display: 'flex', flexDirection: 'column',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h4 style={{ margin: 0, fontSize: '14px', color: '#1f2937' }}>
                {t.horseFarm.notesEditorTitle} — {hfProject.projectName}
              </h4>
              <button onClick={() => setShowNotesEditor(false)} style={{
                border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '18px', color: '#9ca3af',
              }}>✕</button>
            </div>
            <p style={{ fontSize: '11px', color: '#9ca3af', margin: '0 0 10px' }}>
              {t.horseFarm.notesHint}
            </p>
            <textarea
              value={notesDraft}
              onChange={e => setNotesDraft(e.target.value)}
              placeholder={t.horseFarm.notesPlaceholder}
              autoFocus
              style={{
                flex: 1, minHeight: '180px', padding: '12px',
                border: '1px solid #d1d5db', borderRadius: '8px',
                fontSize: '13px', lineHeight: 1.6, resize: 'vertical',
                outline: 'none', fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
              <button
                onClick={() => setShowNotesEditor(false)}
                style={{
                  padding: '8px 16px', borderRadius: '6px', border: '1px solid #d1d5db',
                  background: '#fff', color: '#374151', cursor: 'pointer', fontSize: '12px',
                }}
              >
                {t.horseFarm.notesCancel}
              </button>
              <button
                onClick={saveNotes}
                style={{
                  padding: '8px 16px', borderRadius: '6px', border: 'none',
                  background: '#4f46e5', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 500,
                }}
              >
                {t.horseFarm.notesSave}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 通用提示弹窗 — 居中大弹窗，手动关闭；launchBatGenerate 类型含操作按钮 */}
      {tipModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'hf-fadeIn 0.2s ease',
        }} onClick={() => setTipModal(null)}>
          <div style={{
            background: '#fff', borderRadius: '16px', padding: '32px 36px',
            maxWidth: '520px', width: '90%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            textAlign: 'center',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>{tipModal === 'launchBatGenerate' ? '🚀' : '💡'}</div>
            <p style={{
              margin: '0 0 24px', fontSize: '16px', lineHeight: 1.8, color: '#374151',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {tipModal === 'launchBatGenerate'
                ? '该项目尚未配置一键启动脚本。\n\n是否立即生成 .dbvs-launch.bat？\n生成后点击 🚀 即可一键启动项目。'
                : tipModal}
            </p>
            {tipModal === 'launchBatGenerate' ? (
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                <button onClick={async () => {
                  setTipModal(null)
                  setLaunching(true)
                  try {
                    const res = await window.electronAPI.generateLaunchBat(hfProject.projectPath, hfProject.projectName)
                    if (res.success) {
                      addSystemMessage('✅ 启动脚本已生成，点击 🚀 启动项目', 'status')
                      checkBat()
                    } else {
                      addSystemMessage(`生成失败: ${(res as any).message || '未知错误'}`, 'error')
                    }
                  } catch (err) {
                    addSystemMessage(`生成异常: ${String(err)}`, 'error')
                  } finally {
                    setLaunching(false)
                  }
                }} style={{
                  padding: '10px 28px', borderRadius: '8px', border: 'none',
                  background: '#f59e0b', color: '#fff',
                  cursor: 'pointer', fontSize: '14px', fontWeight: 600,
                }}>
                  生成启动脚本
                </button>
                <button onClick={() => setTipModal(null)} style={{
                  padding: '10px 28px', borderRadius: '8px', border: '1px solid #d1d5db',
                  background: '#fff', color: '#374151',
                  cursor: 'pointer', fontSize: '14px',
                }}>
                  取消
                </button>
              </div>
            ) : (
              <button onClick={() => setTipModal(null)} style={{
                padding: '10px 32px', borderRadius: '8px', border: 'none',
                background: '#4f46e5', color: '#fff',
                cursor: 'pointer', fontSize: '14px', fontWeight: 600,
              }}>
                我知道了
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
