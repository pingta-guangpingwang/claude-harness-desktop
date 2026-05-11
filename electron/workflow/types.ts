// 工作流引擎 — 核心类型定义

export type WorkflowNodeType =
  | 'cli.command'     // 执行 CLI 命令
  | 'ai.call'         // 调用 AI
  | 'file.read'       // 读取文件
  | 'file.write'      // 写入文件
  | 'condition'       // 条件分支 (if/else)
  | 'loop'            // 循环
  | 'delay'           // 延时等待
  | 'n8n.webhook'     // 触发 n8n webhook
  | 'plugin.call'     // 调用插件能力
  | 'control.start'   // 开始节点
  | 'control.end'     // 结束节点
  | 'notification'    // 发送通知

export interface WorkflowNodeConfig {
  command?: string          // CLI 命令
  args?: Record<string, unknown> // CLI 参数
  projectPath?: string      // 目标项目
  aiPrompt?: string         // AI 提示词
  aiModel?: string          // AI 模型
  filePath?: string         // 文件路径
  fileContent?: string      // 文件内容
  condition?: string        // 条件表达式 (JavaScript eval)
  loopCount?: number        // 循环次数
  loopCondition?: string    // 循环条件
  delayMs?: number          // 延时毫秒
  webhookUrl?: string       // n8n webhook URL
  pluginId?: string         // 插件 ID
  capabilityId?: string     // 能力 ID
  notificationMessage?: string // 通知消息
}

export interface WorkflowNode {
  id: string
  type: WorkflowNodeType
  label: string
  config: WorkflowNodeConfig
}

export interface WorkflowEdge {
  id: string
  source: string     // 源节点 ID
  target: string     // 目标节点 ID
  /** 条件表达式（用于分支节点），为空则始终通过 */
  condition?: string
}

export interface WorkflowSchedule {
  enabled: boolean
  cron: string        // 标准 5 字段 cron
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
  /** 创建工作流的项目路径 */
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

/** 默认重试策略 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
}
