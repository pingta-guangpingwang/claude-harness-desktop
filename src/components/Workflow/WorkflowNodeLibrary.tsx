import { useI18n } from '../../i18n'

export interface WorkflowNodeDef {
  type: string
  label: string
  description: string
  icon: string
  category: 'command' | 'ai' | 'file' | 'control' | 'trigger'
  defaultConfig: Record<string, unknown>
  inputs: number
  outputs: number
}

const NODE_DEFS: WorkflowNodeDef[] = [
  { type: 'cli.command', label: 'CLI Command', description: 'Execute a DBHT CLI command', icon: '>_', category: 'command', defaultConfig: { command: '', args: {} }, inputs: 1, outputs: 1 },
  { type: 'ai.call', label: 'AI Call', description: 'Send a prompt to the AI', icon: '◆', category: 'ai', defaultConfig: { prompt: '', model: '', maxTokens: 4096 }, inputs: 1, outputs: 1 },
  { type: 'ai.broadcast', label: 'AI Broadcast', description: 'Broadcast task to all projects', icon: '📡', category: 'ai', defaultConfig: { task: '' }, inputs: 1, outputs: 1 },
  { type: 'file.read', label: 'Read File', description: 'Read file contents', icon: '📄', category: 'file', defaultConfig: { filePath: '', encoding: 'utf-8' }, inputs: 1, outputs: 1 },
  { type: 'file.write', label: 'Write File', description: 'Write content to file', icon: '✎', category: 'file', defaultConfig: { filePath: '', content: '' }, inputs: 1, outputs: 1 },
  { type: 'file.watch', label: 'Watch File', description: 'Wait for file changes', icon: '👁', category: 'file', defaultConfig: { filePath: '', timeoutMs: 30000 }, inputs: 1, outputs: 2 },
  { type: 'control.condition', label: 'Condition', description: 'Branch on condition', icon: '◇', category: 'control', defaultConfig: { expression: '' }, inputs: 1, outputs: 2 },
  { type: 'control.delay', label: 'Delay', description: 'Wait for duration', icon: '⏱', category: 'control', defaultConfig: { durationMs: 1000 }, inputs: 1, outputs: 1 },
  { type: 'control.loop', label: 'Loop', description: 'Repeat N times', icon: '↻', category: 'control', defaultConfig: { count: 3 }, inputs: 1, outputs: 2 },
  { type: 'control.parallel', label: 'Parallel', description: 'Run branches concurrently', icon: '⑂', category: 'control', defaultConfig: { maxConcurrency: 5 }, inputs: 1, outputs: 3 },
  { type: 'trigger.cron', label: 'Cron Trigger', description: 'Schedule with cron expression', icon: '🕐', category: 'trigger', defaultConfig: { cron: '0 * * * *' }, inputs: 0, outputs: 1 },
  { type: 'trigger.fileChange', label: 'File Change', description: 'Trigger on file change', icon: '📁', category: 'trigger', defaultConfig: { watchPath: '', pattern: '*' }, inputs: 0, outputs: 1 },
  { type: 'trigger.webhook', label: 'Webhook', description: 'HTTP webhook trigger', icon: '🌐', category: 'trigger', defaultConfig: { method: 'POST', path: '/webhook' }, inputs: 0, outputs: 1 },
  { type: 'notification', label: 'Notification', description: 'Send desktop notification', icon: '🔔', category: 'control', defaultConfig: { title: '', body: '' }, inputs: 1, outputs: 1 },
  { type: 'project.status', label: 'Project Status', description: 'Check project status', icon: '📊', category: 'command', defaultConfig: { projectPath: '' }, inputs: 1, outputs: 1 },
]

interface Props {
  searchQuery?: string
  onDragStart?: (node: WorkflowNodeDef) => void
  onSelect?: (node: WorkflowNodeDef) => void
}

export function WorkflowNodeLibrary({ searchQuery, onDragStart, onSelect }: Props) {
  const { t } = useI18n()

  const filtered = searchQuery
    ? NODE_DEFS.filter(n =>
        n.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.type.includes(searchQuery.toLowerCase())
      )
    : NODE_DEFS

  const categories = new Map<string, WorkflowNodeDef[]>()
  for (const node of filtered) {
    const list = categories.get(node.category) || []
    list.push(node)
    categories.set(node.category, list)
  }

  const categoryLabels: Record<string, string> = {
    command: t.workflow.nodeTypes.cliCommand,
    ai: t.workflow.nodeTypes.aiCall,
    file: t.workflow.nodeTypes.fileOperation,
    control: t.workflowNode.controlFlow,
    trigger: t.workflowNode.triggers,
  }

  // i18n 节点标签映射
  const nodeLabelMap: Record<string, string> = {
    'cli.command': t.workflowNode.cliCommand,
    'ai.call': t.workflowNode.aiCall,
    'ai.broadcast': t.workflowNode.aiBroadcast,
    'file.read': t.workflowNode.readFile,
    'file.write': t.workflowNode.writeFile,
    'file.watch': t.workflowNode.watchFile,
    'control.condition': t.workflowNode.condition,
    'control.delay': t.workflowNode.delay,
    'control.loop': t.workflowNode.loop,
    'control.parallel': t.workflowNode.parallel,
    'trigger.cron': t.workflowNode.cronTrigger,
    'trigger.fileChange': t.workflowNode.fileChange,
    'trigger.webhook': t.workflowNode.webhook,
    'notification': t.workflowNode.notification,
    'project.status': t.workflowNode.projectStatus,
  }

  return (
    <div style={{ padding: '12px', height: '100%', overflowY: 'auto' }}>
      {Array.from(categories).map(([cat, nodes]) => (
        <div key={cat} style={{ marginBottom: '16px' }}>
          <div style={{
            fontSize: '10px', fontWeight: 700, color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: '0.05em',
            marginBottom: '8px', paddingLeft: '4px',
          }}>
            {categoryLabels[cat] || cat}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {nodes.map(node => (
              <div
                key={node.type}
                draggable
                onDragStart={() => onDragStart?.(node)}
                onClick={() => onSelect?.(node)}
                title={node.description}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 10px', borderRadius: '8px',
                  border: '1px solid #e5e7eb', background: '#fff',
                  cursor: 'grab', fontSize: '12px',
                  transition: 'all 0.15s',
                  userSelect: 'none',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#f0f9ff'
                  e.currentTarget.style.borderColor = '#7dd3fc'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#fff'
                  e.currentTarget.style.borderColor = '#e5e7eb'
                }}
              >
                <span style={{ fontSize: '16px', width: '24px', textAlign: 'center' }}>{node.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: '#1f2937' }}>{nodeLabelMap[node.type] || node.label}</div>
                  <div style={{ fontSize: '10px', color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {node.type}
                  </div>
                </div>
                <div style={{ fontSize: '10px', color: '#d1d5db' }}>
                  {node.inputs}→{node.outputs}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '12px', padding: '20px' }}>
          No nodes match your search
        </div>
      )}
    </div>
  )
}

export { NODE_DEFS }
