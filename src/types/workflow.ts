// Workflow types for renderer (mirrors electron/workflow/types.ts)

export type WorkflowNodeType =
  | 'cli.command'
  | 'ai.call'
  | 'file.read'
  | 'file.write'
  | 'condition'
  | 'loop'
  | 'delay'
  | 'n8n.webhook'
  | 'plugin.call'
  | 'control.start'
  | 'control.end'
  | 'notification'

export interface WorkflowNodeConfig {
  command?: string
  args?: Record<string, unknown>
  projectPath?: string
  aiPrompt?: string
  aiModel?: string
  filePath?: string
  fileContent?: string
  condition?: string
  loopCount?: number
  loopCondition?: string
  delayMs?: number
  webhookUrl?: string
  pluginId?: string
  capabilityId?: string
  notificationMessage?: string
}

export interface WorkflowNode {
  id: string
  type: WorkflowNodeType
  label: string
  config: WorkflowNodeConfig
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  condition?: string
}

export interface WorkflowSchedule {
  enabled: boolean
  cron: string
  timezone?: string
}

export type WorkflowTriggerType = 'manual' | 'schedule' | 'file_change' | 'webhook' | 'project_start'

export interface WorkflowTrigger {
  type: WorkflowTriggerType
  config?: Record<string, unknown>
}

export interface RetryPolicy {
  maxRetries: number
  delayMs: number
  backoffMultiplier?: number
}

export interface WorkflowDefinition {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  variables?: Record<string, unknown>
  schedule?: WorkflowSchedule
  triggers?: WorkflowTrigger[]
  retryPolicy: RetryPolicy
  projectPath?: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowNodeResult {
  nodeId: string
  success: boolean
  output: string
  durationMs: number
  error?: string
}

export interface WorkflowRunState {
  runId: string
  workflowId: string
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted'
  currentNodeId: string | null
  completedNodes: string[]
  nodeResults: Record<string, WorkflowNodeResult>
  variables: Record<string, unknown>
  startedAt: string
  completedAt?: string
  retryCount: number
}

export type WorkflowEvent =
  | { type: 'run_started'; runId: string }
  | { type: 'node_started'; runId: string; nodeId: string }
  | { type: 'node_completed'; runId: string; nodeId: string; result: WorkflowNodeResult }
  | { type: 'node_failed'; runId: string; nodeId: string; error: string }
  | { type: 'run_completed'; runId: string; success: boolean }
  | { type: 'run_aborted'; runId: string }
  | { type: 'retrying'; runId: string; nodeId: string; attempt: number }

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
}
