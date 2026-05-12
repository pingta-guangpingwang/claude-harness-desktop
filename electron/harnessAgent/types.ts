// 驾驭智能体核心类型定义

/** Agent 可以调用的工具定义 — 对标 Claude Code function calling + Tool interface */
export interface AgentTool {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema
  execute: (params: Record<string, unknown>, ctx: AgentContext) => Promise<ToolResult>
  /** 是否只读（可并行执行） */
  isReadOnly?: boolean | ((params: Record<string, unknown>) => boolean)
  /** 是否并发安全（同批次可与其他工具并行） */
  isConcurrencySafe?: boolean
  /** 是否为破坏性操作 */
  isDestructive?: boolean | ((params: Record<string, unknown>) => boolean)
  /** 工具专属权限检查 — 返回 null 则走默认管道 */
  checkPermissions?: (params: Record<string, unknown>, ctx: AgentContext) => { decision: 'allow' | 'deny' | 'ask'; reason?: string } | null
  /** 中断行为: cancel=取消当前工具, block=等待完成 */
  interruptBehavior?: 'cancel' | 'block'
  /** 工具分组 */
  group?: 'control' | 'read' | 'write' | 'execute' | 'infra'
  /** 是否为核心工具（默认 true）。非核心工具不自动发送到 API，通过 skill_discovery 按需发现 */
  core?: boolean
}

export interface ToolResult {
  success: boolean
  output: string
  metadata?: Record<string, unknown>
}

export interface AgentContext {
  projectIds: string[]
  /** 项目名称映射 path → name */
  projectNames: Map<string, string>
  /** 在线状态快照 */
  onlineProjects: Set<string>
  /** 当前活跃的 API key */
  apiKey: string
  model: string
  /** 权限设置（影响系统提示词行为） */
  permissions?: {
    autoTrustConfirm?: boolean
    autoApproveReads?: boolean
    confirmBeforeWrites?: boolean
    blockDestructive?: boolean
  }
  /** 中断标志 — 长时间运行的工具应定期检查此标志 */
  aborted?: boolean
  /** 自主循环模式 — Agent 自动从队列取任务执行，直到队列空或用户中止 */
  autonomousMode?: boolean
  /** 自主循环最大轮次限制 */
  maxAutonomousTurns?: number
  /** 事件回调 — 工具可通过此回调推送事件到驾驭聊天（用于 project_response / report_card） */
  emitEvent?: (event: AgentEvent) => void
  /** 用户中途插入的消息队列 — Agent 每轮开始前检查并合并到对话中 */
  pendingMessages?: string[]
}

export interface ToolCallRequest {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/** Agent 流式事件 — 通过 IPC 推送到渲染进程 */
export type AgentEvent =
  | { type: 'thinking_start' }
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call'; id: string; name: string; params: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; result: ToolResult }
  | { type: 'tool_error'; id: string; name: string; error: string }
  | { type: 'permission_needed'; id: string; name: string; params: Record<string, unknown>; reason: string }
  | { type: 'thinking_end' }
  | { type: 'done'; finalMessage: string }
  | { type: 'error'; message: string }
  /** 项目 AI 主动推送回复到驾驭对话 */
  | { type: 'project_response'; projectName: string; projectPath: string; content: string; timestamp: string }
  /** 可点击的体检报告卡片 */
  | { type: 'report_card'; title: string; summary: string; fullReport: string; projectCount: number; onlineCount: number }
  /** 用户中途插入的消息已被合并 */
  | { type: 'user_queued'; text: string }

/** 权限决策 */
export type PermissionDecision = 'allow' | 'deny' | 'allow_once'

/** 权限规则 */
export interface PermissionRule {
  toolPattern: string   // 工具名通配符
  decision: PermissionDecision
}

export interface HarnessPermissions {
  autoTrustConfirm: boolean
  autoApproveReads: boolean
  confirmBeforeWrites: boolean
  blockDestructive: boolean
  autoWakeDead: boolean
}

export const DEFAULT_PERMISSIONS: HarnessPermissions = {
  autoTrustConfirm: true,
  autoApproveReads: true,
  confirmBeforeWrites: true,
  blockDestructive: true,
  autoWakeDead: false,
}
