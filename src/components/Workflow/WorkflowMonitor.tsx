import { useState, useEffect, useRef } from 'react'
import type { WorkflowEvent, WorkflowRunState } from '../../types/workflow'
import './Workflow.css'

interface MonitorProps {
  runId: string
  onClose: () => void
}

export function WorkflowMonitor({ runId, onClose }: MonitorProps) {
  const [state, setState] = useState<WorkflowRunState | null>(null)
  const [events, setEvents] = useState<WorkflowEvent[]>([])
  const [pollTimer, setPollTimer] = useState<ReturnType<typeof setInterval> | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 监听推送事件
    const handler = (event: WorkflowEvent & { runId: string }) => {
      if (event.runId === runId) {
        setEvents(prev => [...prev, event])
      }
    }
    const unsubscribe = setupEventListener(handler)

    // 轮询状态
    const timer = setInterval(async () => {
      const result = await window.electronAPI.workflowGetState(runId)
      if (result.success && result.state) {
        setState(result.state)
        if (result.state.status === 'completed' || result.state.status === 'failed' || result.state.status === 'aborted') {
          clearInterval(timer)
        }
      }
    }, 500)
    setPollTimer(timer)

    // 清理
    return () => {
      unsubscribe()
      if (timer) clearInterval(timer)
    }
  }, [runId])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  const statusColor = (status: string) => {
    switch (status) {
      case 'running': return '#6366f1'
      case 'completed': return '#10b981'
      case 'failed': return '#ef4444'
      case 'aborted': return '#f59e0b'
      default: return '#888'
    }
  }

  return (
    <div className="wf-monitor-overlay">
      <div className="wf-monitor-panel">
        <div className="wf-monitor-header">
          <h4>Workflow Monitor</h4>
          <div className="wf-monitor-header-right">
            {state && (
              <span className="wf-monitor-status" style={{ color: statusColor(state.status) }}>
                {state.status.toUpperCase()}
              </span>
            )}
            <button onClick={onClose} className="wf-btn">Close</button>
          </div>
        </div>

        <div className="wf-monitor-body">
          <div className="wf-monitor-meta">
            <span>Run ID: {runId}</span>
            {state && <span>Workflow: {state.workflowId}</span>}
            {state?.completedNodes && <span>Progress: {state.completedNodes.length} nodes done</span>}
          </div>

          {/* 节点进度条 */}
          {state?.nodeResults && Object.keys(state.nodeResults).length > 0 && (
            <div className="wf-monitor-results">
              <h5>Node Results</h5>
              {Object.entries(state.nodeResults).map(([nodeId, result]) => (
                <div key={nodeId} className={`wf-monitor-result ${result.success ? 'success' : 'failed'}`}>
                  <div className="wf-result-header">
                    <span className="wf-result-node-id">{nodeId}</span>
                    <span className="wf-result-status">{result.success ? 'OK' : 'FAIL'}</span>
                    <span className="wf-result-duration">{result.durationMs}ms</span>
                  </div>
                  {result.output && <div className="wf-result-output">{result.output.substring(0, 200)}</div>}
                  {result.error && <div className="wf-result-error">{result.error}</div>}
                </div>
              ))}
            </div>
          )}

          {/* 事件日志 */}
          <div className="wf-monitor-log">
            <h5>Event Log</h5>
            <div className="wf-monitor-log-lines">
              {events.map((e, i) => (
                <div key={i} className={`wf-log-line wf-log-${e.type}`}>
                  <span className="wf-log-time">{new Date().toLocaleTimeString()}</span>
                  <span className="wf-log-type">{e.type}</span>
                  {'nodeId' in e && <span className="wf-log-node">{(e as any).nodeId}</span>}
                  {'error' in e && <span className="wf-log-error">{(e as any).error}</span>}
                  {'success' in e && <span className="wf-log-success">{(e as any).success ? 'OK' : 'FAIL'}</span>}
                </div>
              ))}
              {events.length === 0 && <div className="wf-log-empty">Waiting for events...</div>}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 通过 IPC push 监听事件 */
function setupEventListener(handler: (event: WorkflowEvent & { runId: string }) => void): () => void {
  if (typeof window !== 'undefined' && window.electronAPI?.workflowOnEvent) {
    window.electronAPI.workflowOnEvent(handler)
  }
  return () => {}
}
