import { useState, useEffect } from 'react'
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '../../types/workflow'
import { DEFAULT_RETRY_POLICY } from '../../types/workflow'
import { WorkflowMonitor } from './WorkflowMonitor'
import { useI18n } from '../../i18n'
import './Workflow.css'

const NODE_TYPES: { type: string; label: string; category: string }[] = [
  { type: 'control.start', label: 'Start', category: 'Control' },
  { type: 'control.end', label: 'End', category: 'Control' },
  { type: 'cli.command', label: 'CLI Command', category: 'Action' },
  { type: 'ai.call', label: 'AI Call', category: 'Action' },
  { type: 'file.read', label: 'Read File', category: 'Action' },
  { type: 'file.write', label: 'Write File', category: 'Action' },
  { type: 'condition', label: 'Condition', category: 'Control' },
  { type: 'loop', label: 'Loop', category: 'Control' },
  { type: 'delay', label: 'Delay', category: 'Action' },
  { type: 'notification', label: 'Notification', category: 'Action' },
  { type: 'n8n.webhook', label: 'n8n Webhook', category: 'Integration' },
  { type: 'plugin.call', label: 'Plugin Call', category: 'Integration' },
]

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

const EMPTY_WORKFLOW: WorkflowDefinition = {
  id: '',
  name: '',
  description: '',
  nodes: [
    { id: 'start', type: 'control.start', label: 'Start', config: {} },
    { id: 'end', type: 'control.end', label: 'End', config: {} },
  ],
  edges: [{ id: 'edge_1', source: 'start', target: 'end' }],
  variables: {},
  retryPolicy: { ...DEFAULT_RETRY_POLICY },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

export function WorkflowEditor() {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<WorkflowDefinition>({ ...EMPTY_WORKFLOW })
  const [isNew, setIsNew] = useState(true)
  const [showMonitor, setShowMonitor] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState('')
  const { t } = useI18n()

  useEffect(() => {
    loadWorkflows()
  }, [])

  const loadWorkflows = async () => {
    const result = await window.electronAPI.workflowLoad()
    if (result.success) {
      setWorkflows(result.workflows)
    }
  }

  const selectWorkflow = (id: string) => {
    const wf = workflows.find(w => w.id === id)
    if (wf) {
      setEditing(JSON.parse(JSON.stringify(wf)))
      setSelectedId(id)
      setIsNew(false)
      setShowMonitor(false)
      setRunId(null)
    }
  }

  const createNew = () => {
    const newWf: WorkflowDefinition = {
      ...EMPTY_WORKFLOW,
      id: genId(),
      name: 'New Workflow',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setEditing(newWf)
    setSelectedId(newWf.id)
    setIsNew(true)
    setShowMonitor(false)
    setRunId(null)
  }

  const addNode = (type: string) => {
    const nodeType = NODE_TYPES.find(n => n.type === type)
    const newNode: WorkflowNode = {
      id: genId(),
      type: type as WorkflowNode['type'],
      label: nodeType?.label || type,
      config: {},
    }
    setEditing(prev => {
      const nodes = [...prev.nodes]
      // 插入到 end 节点之前
      const endIdx = nodes.findIndex(n => n.type === 'control.end')
      if (endIdx >= 0) {
        nodes.splice(endIdx, 0, newNode)
      } else {
        nodes.push(newNode)
      }
      // 更新边
      const edges = [...prev.edges]
      // 找到指向 end 的边
      const toEndIdx = edges.findIndex(e => e.target === 'end')
      if (toEndIdx >= 0 && endIdx >= 0) {
        const oldSource = edges[toEndIdx].source
        edges[toEndIdx] = { id: genId(), source: newNode.id, target: 'end' }
        edges.push({ id: genId(), source: oldSource, target: newNode.id })
      }
      return { ...prev, nodes, edges, updatedAt: new Date().toISOString() }
    })
  }

  const removeNode = (nodeId: string) => {
    if (nodeId === 'start' || nodeId === 'end') return
    setEditing(prev => {
      const nodes = prev.nodes.filter(n => n.id !== nodeId)
      const edges = prev.edges.filter(e => e.source !== nodeId && e.target !== nodeId)
      return { ...prev, nodes, edges, updatedAt: new Date().toISOString() }
    })
  }

  const updateNodeConfig = (nodeId: string, key: string, value: string | number) => {
    setEditing(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, config: { ...n.config, [key]: value } } : n),
      updatedAt: new Date().toISOString(),
    }))
  }

  const updateNodeLabel = (nodeId: string, label: string) => {
    setEditing(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, label } : n),
      updatedAt: new Date().toISOString(),
    }))
  }

  const saveWorkflow = async () => {
    if (!editing.name.trim()) {
      setStatusMsg(t.workflow.enterName)
      return
    }
    editing.updatedAt = new Date().toISOString()
    const result = await window.electronAPI.workflowRegister(editing)
    if (result.success) {
      setStatusMsg(t.workflow.saved)
      setIsNew(false)
      await loadWorkflows()
    } else {
      setStatusMsg(t.workflow.saveFailed + ': ' + (result.error || 'unknown'))
    }
  }

  const runWorkflow = async () => {
    if (!selectedId) return
    const result = await window.electronAPI.workflowRun(selectedId)
    if (result.success && result.runId) {
      setRunId(result.runId)
      setShowMonitor(true)
      setStatusMsg('Workflow started: ' + result.runId)
      // 订阅事件
      window.electronAPI.workflowSubscribe(result.runId)
    } else {
      setStatusMsg('Start failed: ' + (result.error || 'unknown'))
    }
  }

  const deleteWorkflow = async (id: string) => {
    await window.electronAPI.workflowDelete(id)
    if (selectedId === id) {
      setSelectedId(null)
      setEditing({ ...EMPTY_WORKFLOW })
      setIsNew(true)
    }
    await loadWorkflows()
  }

  const renderConfigFields = (node: WorkflowNode) => {
    switch (node.type) {
      case 'cli.command':
        return (
          <>
            <ConfigField label="Command" value={node.config.command || ''} onChange={v => updateNodeConfig(node.id, 'command', v)} />
            <ConfigField label="Args (JSON)" value={node.config.args ? JSON.stringify(node.config.args) : ''} onChange={v => { try { updateNodeConfig(node.id, 'args', JSON.parse(v)) } catch { /* ignore */ } }} />
            <ConfigField label="Project Path" value={(node.config.projectPath as string) || ''} onChange={v => updateNodeConfig(node.id, 'projectPath', v)} />
          </>
        )
      case 'ai.call':
        return (
          <>
            <ConfigField label="AI Prompt" value={(node.config.aiPrompt as string) || ''} onChange={v => updateNodeConfig(node.id, 'aiPrompt', v)} textarea />
            <ConfigField label="Model" value={(node.config.aiModel as string) || ''} onChange={v => updateNodeConfig(node.id, 'aiModel', v)} />
          </>
        )
      case 'file.read':
        return <ConfigField label="File Path" value={(node.config.filePath as string) || ''} onChange={v => updateNodeConfig(node.id, 'filePath', v)} />
      case 'file.write':
        return (
          <>
            <ConfigField label="File Path" value={(node.config.filePath as string) || ''} onChange={v => updateNodeConfig(node.id, 'filePath', v)} />
            <ConfigField label="Content" value={(node.config.fileContent as string) || ''} onChange={v => updateNodeConfig(node.id, 'fileContent', v)} textarea />
          </>
        )
      case 'delay':
        return <ConfigField label="Delay (ms)" value={String(node.config.delayMs || 1000)} onChange={v => updateNodeConfig(node.id, 'delayMs', parseInt(v) || 1000)} />
      case 'notification':
        return <ConfigField label="Message" value={(node.config.notificationMessage as string) || ''} onChange={v => updateNodeConfig(node.id, 'notificationMessage', v)} textarea />
      case 'n8n.webhook':
        return <ConfigField label="Webhook URL" value={(node.config.webhookUrl as string) || ''} onChange={v => updateNodeConfig(node.id, 'webhookUrl', v)} />
      case 'condition':
        return <ConfigField label="Condition (JS expr)" value={(node.config.condition as string) || ''} onChange={v => updateNodeConfig(node.id, 'condition', v)} />
      case 'loop':
        return <ConfigField label="Loop Count" value={String(node.config.loopCount || 1)} onChange={v => updateNodeConfig(node.id, 'loopCount', parseInt(v) || 1)} />
      default:
        return <div className="wf-config-hint">No configuration needed</div>
    }
  }

  return (
    <div className="wf-editor-container">
      <div className="wf-sidebar">
        <div className="wf-sidebar-header">
          <h4>Workflows</h4>
          <button onClick={createNew} className="wf-btn wf-btn-primary">+ New</button>
        </div>
        <div className="wf-list">
          {workflows.map(w => (
            <div key={w.id} className={`wf-list-item ${selectedId === w.id ? 'active' : ''}`} onClick={() => selectWorkflow(w.id)}>
              <div className="wf-list-item-name">{w.name}</div>
              <div className="wf-list-item-desc">{w.description || w.id}</div>
              <button onClick={(e) => { e.stopPropagation(); deleteWorkflow(w.id) }} className="wf-btn-del" title="Delete">x</button>
            </div>
          ))}
          {workflows.length === 0 && <div className="wf-empty">No workflows yet</div>}
        </div>
      </div>

      <div className="wf-main">
        {selectedId ? (
          <>
            <div className="wf-toolbar">
              <input
                className="wf-name-input"
                value={editing.name}
                onChange={e => setEditing(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Workflow name"
              />
              <input
                className="wf-desc-input"
                value={editing.description}
                onChange={e => setEditing(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Description (optional)"
              />
              <div className="wf-toolbar-actions">
                {statusMsg && <span className="wf-status-msg">{statusMsg}</span>}
                <button onClick={saveWorkflow} className="wf-btn wf-btn-primary">Save</button>
                <button onClick={runWorkflow} className="wf-btn wf-btn-run">Run</button>
              </div>
            </div>

            <div className="wf-editor-body">
              <div className="wf-node-palette">
                <h5>Add Node</h5>
                {(['Control', 'Action', 'Integration'] as const).map(cat => (
                  <div key={cat} className="wf-node-category">
                    <div className="wf-cat-label">{cat}</div>
                    {NODE_TYPES.filter(n => n.category === cat).map(n => (
                      <button key={n.type} onClick={() => addNode(n.type)} className="wf-node-type-btn">
                        {n.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>

              <div className="wf-nodes-list">
                <h5>Nodes ({editing.nodes.length})</h5>
                {editing.nodes.map((node, idx) => (
                  <div key={node.id} className={`wf-node-card ${node.type === 'control.start' || node.type === 'control.end' ? 'wf-node-control' : ''}`}>
                    <div className="wf-node-header">
                      <span className="wf-node-type-badge">{node.type}</span>
                      <input
                        className="wf-node-label-input"
                        value={node.label}
                        onChange={e => updateNodeLabel(node.id, e.target.value)}
                      />
                      <span className="wf-node-id">{node.id}</span>
                      {node.type !== 'control.start' && node.type !== 'control.end' && (
                        <button onClick={() => removeNode(node.id)} className="wf-btn-del" title="Remove">x</button>
                      )}
                    </div>
                    <div className="wf-node-config">
                      {renderConfigFields(node)}
                    </div>
                    {/* 连接指示 */}
                    <div className="wf-node-connection">
                      {editing.edges.find(e => e.source === node.id) && <span className="wf-conn-out">out</span>}
                      {editing.edges.find(e => e.target === node.id) && <span className="wf-conn-in">in</span>}
                    </div>
                  </div>
                ))}
              </div>

              <div className="wf-settings">
                <h5>Settings</h5>
                <div className="wf-settings-group">
                  <label className="wf-settings-label">
                    <input type="checkbox" checked={editing.schedule?.enabled || false}
                      onChange={e => setEditing(prev => ({ ...prev, schedule: { ...prev.schedule, enabled: e.target.checked, cron: prev.schedule?.cron || '*/30 * * * *' } }))}
                    /> Enable Schedule
                  </label>
                  {editing.schedule?.enabled && (
                    <ConfigField label="Cron" value={editing.schedule.cron} onChange={v => setEditing(prev => ({ ...prev, schedule: { ...prev.schedule!, cron: v } }))} />
                  )}
                </div>
                <div className="wf-settings-group">
                  <ConfigField label="Max Retries" value={String(editing.retryPolicy.maxRetries)} onChange={v => setEditing(prev => ({ ...prev, retryPolicy: { ...prev.retryPolicy, maxRetries: parseInt(v) || 3 } }))} />
                  <ConfigField label="Delay (ms)" value={String(editing.retryPolicy.delayMs)} onChange={v => setEditing(prev => ({ ...prev, retryPolicy: { ...prev.retryPolicy, delayMs: parseInt(v) || 1000 } }))} />
                  <ConfigField label="Backoff Multiplier" value={String(editing.retryPolicy.backoffMultiplier || 2)} onChange={v => setEditing(prev => ({ ...prev, retryPolicy: { ...prev.retryPolicy, backoffMultiplier: parseFloat(v) || 2 } }))} />
                </div>
                <div className="wf-settings-group">
                  <label className="wf-settings-label">Variables (JSON)</label>
                  <textarea
                    className="wf-config-textarea"
                    value={JSON.stringify(editing.variables || {}, null, 2)}
                    onChange={e => { try { setEditing(prev => ({ ...prev, variables: JSON.parse(e.target.value) })) } catch { /* ignore */ } }}
                    rows={4}
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="wf-empty-state">
            <div>Select a workflow or create a new one</div>
          </div>
        )}
      </div>

      {showMonitor && runId && (
        <WorkflowMonitor runId={runId} onClose={() => { setShowMonitor(false); setRunId(null) }} />
      )}
    </div>
  )
}

function ConfigField({ label, value, onChange, textarea }: { label: string; value: string; onChange: (v: string) => void; textarea?: boolean }) {
  return (
    <div className="wf-config-field">
      <label className="wf-config-label">{label}</label>
      {textarea ? (
        <textarea className="wf-config-textarea" value={value} onChange={e => onChange(e.target.value)} rows={2} />
      ) : (
        <input className="wf-config-input" value={value} onChange={e => onChange(e.target.value)} />
      )}
    </div>
  )
}
