import { useState, useCallback, useEffect } from 'react'

interface BatchTaskDef {
  id: string
  name: string
  commands: Array<{ command: string; args: Record<string, unknown>; projectPath?: string }>
  mode: 'serial' | 'parallel'
  stopOnError?: boolean
}

interface BatchManagerProps {
  projectIds: string[]
  projectNames: Record<string, string>
  apiKey?: string
  model?: string
}

export const BatchManager: React.FC<BatchManagerProps> = ({ projectIds, projectNames, apiKey, model }) => {
  const [tasks, setTasks] = useState<BatchTaskDef[]>([])
  const [editingTask, setEditingTask] = useState<BatchTaskDef | null>(null)
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null)
  const [progress, setProgress] = useState<string[]>([])
  const [showEditor, setShowEditor] = useState(false)

  // 监听批量执行进度
  useEffect(() => {
    window.electronAPI.cliBatchOnProgress((event: any) => {
      switch (event.type) {
        case 'batch_start':
          setProgress(p => [...p, `🚀 开始批量执行 (${event.total} 步)`])
          break
        case 'step_start':
          setProgress(p => [...p, `  🔄 ${event.command}...`])
          break
        case 'step_end':
          setProgress(p => [...p, `  ${event.result?.success ? '✅' : '❌'} ${event.command} (${event.durationMs}ms)`])
          break
        case 'batch_end':
          setProgress(p => [...p, `🏁 完成: ${event.successCount} 成功 / ${event.failCount} 失败 (${event.totalDurationMs}ms)`])
          setRunningTaskId(null)
          break
        case 'batch_error':
          setProgress(p => [...p, `⚠️ ${event.message}`])
          break
      }
    })
  }, [])

  const runTask = useCallback(async (task: BatchTaskDef) => {
    setRunningTaskId(task.id)
    setProgress([])
    try {
      await window.electronAPI.cliBatchRun(task, {
        projectIds,
        projectNames,
        apiKey,
        model,
      })
    } catch (err) {
      setProgress(p => [...p, `❌ 执行异常: ${String(err)}`])
      setRunningTaskId(null)
    }
  }, [projectIds, projectNames, apiKey, model])

  const abortTask = useCallback(() => {
    window.electronAPI.cliBatchAbort()
    setRunningTaskId(null)
    setProgress(p => [...p, '⏹️ 已中止'])
  }, [])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', gap: 10,
      padding: '10px 12px', overflow: 'auto',
    }}>
      {/* 快捷模板 */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--app-text-primary)', marginBottom: 8 }}>
          📋 快捷批量
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[
            {
              label: '全部项目 Git 状态',
              commands: projectIds.map(id => ({ command: 'git-status', args: { project: id }, projectPath: id })),
              mode: 'parallel' as const,
            },
            {
              label: '唤醒 → 状态 → Git log',
              commands: [
                { command: 'wake', args: {}, projectPath: undefined },
                { command: 'status', args: {}, projectPath: undefined },
                { command: 'git-log', args: { n: 3 }, projectPath: undefined },
              ],
              mode: 'serial' as const,
              stopOnError: false,
            },
          ].map((tpl, i) => (
            <button key={i} onClick={() => {
              const task: BatchTaskDef = {
                id: Date.now().toString(36),
                name: tpl.label,
                commands: tpl.commands,
                mode: tpl.mode,
                stopOnError: tpl.stopOnError,
              }
              setTasks(prev => [...prev, task])
              runTask(task)
            }}
              disabled={runningTaskId !== null}
              style={{
                padding: '8px 12px', borderRadius: 6, border: '1px solid var(--app-border-primary)',
                background: runningTaskId ? 'var(--app-bg-tertiary)' : 'var(--app-bg-secondary)',
                color: 'var(--app-text-primary)', cursor: runningTaskId ? 'not-allowed' : 'pointer',
                fontSize: 11, textAlign: 'left', opacity: runningTaskId ? 0.5 : 1,
              }}
            >
              <div style={{ fontWeight: 600 }}>{tpl.label}</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                {tpl.mode} · {tpl.commands.length} 步
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 进度日志 */}
      {progress.length > 0 && (
        <div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 6,
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--app-text-primary)' }}>📡 进度</span>
            {runningTaskId && (
              <button onClick={abortTask} style={{
                padding: '4px 10px', borderRadius: 4, border: '1px solid #ef4444',
                background: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 10,
              }}>中止</button>
            )}
          </div>
          <div style={{
            padding: '8px 10px', borderRadius: 6,
            background: 'var(--app-bg-secondary)', border: '1px solid var(--app-border-primary)',
            fontFamily: 'var(--app-font-mono)', fontSize: 10, lineHeight: 1.7,
            maxHeight: 250, overflow: 'auto',
          }}>
            {progress.map((line, i) => (
              <div key={i} style={{ color: 'var(--app-text-secondary)' }}>{line}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
