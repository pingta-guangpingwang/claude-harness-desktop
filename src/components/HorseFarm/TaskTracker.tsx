import { useState, useCallback } from 'react'
import { useI18n } from '../../i18n'
import type { HFTask } from '../../types/horseFarm'

interface TaskTrackerProps {
  tasks: HFTask[]
  projectPath: string
  onAddTask: (task: HFTask) => void
  onUpdateTask: (taskId: string, updates: Partial<HFTask>) => void
  onRemoveTask: (taskId: string) => void
}

interface SandboxLogEntry {
  time: string
  type: 'snapshot' | 'commit' | 'rollback' | 'history' | 'error'
  message: string
}

export default function TaskTracker({ tasks, projectPath, onAddTask, onUpdateTask, onRemoveTask }: TaskTrackerProps) {
  const { t } = useI18n()
  const [newTaskDesc, setNewTaskDesc] = useState('')
  const [sandboxLog, setSandboxLog] = useState<SandboxLogEntry[]>([])
  const [sandboxRunning, setSandboxRunning] = useState(false)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [historyCommits, setHistoryCommits] = useState<Array<{ id: string; message: string; timestamp: string }>>([])

  const addLog = useCallback((type: SandboxLogEntry['type'], message: string) => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setSandboxLog(prev => [...prev.slice(-49), { time, type, message }])
  }, [])

  const handleAdd = () => {
    const desc = newTaskDesc.trim()
    if (!desc) return
    const task: HFTask = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      description: desc,
      status: 'pending',
      priority: 'medium',
      progress: 0,
      createdAt: new Date().toISOString(),
      dependsOn: [],
    }
    onAddTask(task)
    setNewTaskDesc('')
  }

  const cycleStatus = (task: HFTask) => {
    const next: Record<string, HFTask['status']> = {
      pending: 'in_progress',
      in_progress: 'completed',
      completed: 'pending',
    }
    const newStatus = next[task.status] || 'pending'
    const newProgress = newStatus === 'completed' ? 100 : newStatus === 'in_progress' ? 50 : 0
    onUpdateTask(task.id, { status: newStatus, progress: newProgress, completedAt: newStatus === 'completed' ? new Date().toISOString() : undefined })
  }

  // ---- Sandbox Operations ----

  const handleSnapshot = async (taskId: string, desc: string) => {
    setSandboxRunning(true)
    addLog('snapshot', `Creating snapshot for task: ${desc}`)
    const result = await window.electronAPI.snapshotBeforeTask(projectPath, taskId, desc, '')
    if (result.success) {
      setActiveSessionId(taskId)
      addLog('snapshot', `Snapshot OK — session: ${taskId}`)
    } else {
      addLog('error', `Snapshot FAILED: ${result.message || 'unknown'}`)
    }
    setSandboxRunning(false)
  }

  const handleCommit = async (taskId: string, desc: string) => {
    setSandboxRunning(true)
    addLog('commit', `Committing: ${desc}`)
    const result = await window.electronAPI.commitTaskFinish(projectPath, taskId, desc)
    if (result.success) {
      addLog('commit', `Commit OK — ${result.versionId || result.message || 'done'}`)
    } else {
      addLog('error', `Commit FAILED: ${result.message || 'unknown'}`)
    }
    setSandboxRunning(false)
  }

  const handleRollback = async (taskId: string) => {
    if (!window.confirm(t.sandbox.rollbackConfirm)) return
    setSandboxRunning(true)
    addLog('rollback', `Rolling back session: ${taskId}`)
    const result = await window.electronAPI.rollbackTask(projectPath, taskId)
    if (result.success) {
      addLog('rollback', `Rollback OK — ${result.message || 'done'}`)
      setActiveSessionId(null)
    } else {
      addLog('error', `Rollback FAILED: ${result.message || 'unknown'}`)
    }
    setSandboxRunning(false)
  }

  const handleShowHistory = async (taskId?: string) => {
    setSandboxRunning(true)
    const result = await window.electronAPI.getTaskHistory(projectPath, taskId)
    if (result.success && result.commits) {
      setHistoryCommits(result.commits)
      setShowHistory(true)
    } else {
      addLog('error', `History FAILED: ${result.message || 'unknown'}`)
    }
    setSandboxRunning(false)
  }

  const statusLabel: Record<string, string> = {
    pending: t.horseFarm.taskPending,
    in_progress: t.horseFarm.taskInProgress,
    completed: t.horseFarm.taskCompleted,
    blocked: t.horseFarm.taskBlocked,
  }

  const completed = tasks.filter(t => t.status === 'completed').length

  return (
    <div style={{ marginTop: '8px' }}>
      {/* ---- Sandbox Bar ---- */}
      <div style={{
        border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 10px',
        marginBottom: '10px', background: '#fafafa',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>🔒 {t.sandbox.title}</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => handleShowHistory(activeSessionId || undefined)}
              disabled={sandboxRunning}
              title={t.sandbox.history}
              style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', color: '#6b7280' }}
            >📜</button>
          </div>
        </div>
        {activeSessionId && (
          <div style={{ fontSize: '10px', color: '#7c3aed', marginBottom: '6px', fontFamily: 'monospace' }}>
            Session: {activeSessionId}
          </div>
        )}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {tasks.filter(t => t.status !== 'completed').slice(0, 3).map(task => (
            <div key={task.id} style={{ display: 'flex', gap: '3px' }}>
              {task.status === 'in_progress' && (
                <>
                  <button
                    onClick={() => handleSnapshot(task.id, task.description)}
                    disabled={sandboxRunning}
                    title={t.sandbox.snapshotBefore}
                    style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #f59e0b', background: '#fffbeb', color: '#92400e', cursor: 'pointer' }}
                  >📸 {t.sandbox.snapshotBtn}</button>
                  <button
                    onClick={() => handleCommit(task.id, task.description)}
                    disabled={sandboxRunning}
                    title={t.sandbox.commitFinish}
                    style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #059669', background: '#ecfdf5', color: '#065f46', cursor: 'pointer' }}
                  >✅ {t.sandbox.commitBtn}</button>
                  <button
                    onClick={() => handleRollback(task.id)}
                    disabled={sandboxRunning}
                    title={t.sandbox.rollback}
                    style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #dc2626', background: '#fef2f2', color: '#991b1b', cursor: 'pointer' }}
                  >↩ {t.sandbox.rollbackBtn}</button>
                </>
              )}
            </div>
          ))}
          {tasks.filter(t => t.status === 'in_progress').length === 0 && (
            <span style={{ fontSize: '10px', color: '#9ca3af' }}>{t.sandbox.switchToInProgress}</span>
          )}
        </div>
        {sandboxLog.length > 0 && (
          <div style={{ marginTop: '6px', maxHeight: '80px', overflowY: 'auto', fontSize: '10px', color: '#6b7280', borderTop: '1px solid #e5e7eb', paddingTop: '4px' }}>
            {sandboxLog.map((entry, i) => (
              <div key={i} style={{ fontFamily: 'monospace' }}>
                <span style={{ color: entry.type === 'error' ? '#dc2626' : entry.type === 'snapshot' ? '#d97706' : entry.type === 'commit' ? '#059669' : '#6b7280' }}>
                  [{entry.time}] {entry.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- Task Input ---- */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
        <input
          type="text"
          value={newTaskDesc}
          onChange={e => setNewTaskDesc(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
          placeholder={t.horseFarm.taskPlaceholder}
          style={{
            flex: 1, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px',
            fontSize: '12px', outline: 'none',
          }}
        />
        <button
          onClick={handleAdd}
          style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '6px', border: '1px solid #4f46e5', background: '#4f46e5', color: '#fff', cursor: 'pointer' }}
        >
          {t.horseFarm.addTask}
        </button>
      </div>
      {tasks.length === 0 ? (
        <div style={{ fontSize: '12px', color: '#9ca3af', padding: '8px 0' }}>
          {t.horseFarm.tasksCompleted.replace('{done}', '0').replace('{total}', '0')}
        </div>
      ) : (
        <div>
          <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px' }}>
            {t.horseFarm.tasksCompleted.replace('{done}', String(completed)).replace('{total}', String(tasks.length))}
          </div>
          {tasks.map(task => (
            <div key={task.id} className="hf-task-card">
              <span className={`task-status ${task.status}`} onClick={() => cycleStatus(task)} style={{ cursor: 'pointer' }}>
                {statusLabel[task.status]}
              </span>
              <span className="task-desc">{task.description}</span>
              <button
                onClick={() => onRemoveTask(task.id)}
                style={{ fontSize: '11px', padding: '2px 6px', border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer' }}
                title="Remove"
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {/* ---- History Modal ---- */}
      {showHistory && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowHistory(false)}>
          <div style={{
            background: '#fff', borderRadius: '12px', padding: '20px', maxWidth: '500px', width: '90%', maxHeight: '400px', overflow: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h4 style={{ margin: 0, fontSize: '14px' }}>{t.sandbox.history}</h4>
              <button onClick={() => setShowHistory(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '16px' }}>✕</button>
            </div>
            {historyCommits.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#9ca3af' }}>{t.sandbox.historyEmpty}</div>
            ) : (
              historyCommits.map(c => (
                <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: '12px' }}>
                  <div style={{ fontWeight: 500, color: '#1f2937' }}>{c.message}</div>
                  <div style={{ display: 'flex', gap: '12px', color: '#9ca3af', fontSize: '11px', marginTop: '2px' }}>
                    <span>{c.id}</span>
                    <span>{new Date(c.timestamp).toLocaleString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
