export interface AuditEvent {
  id: string
  source: string
  actor: string
  action: string
  target: string
  outcome: 'success' | 'failure' | 'blocked' | 'unknown'
  timestamp: string
  durationMs: number
  sessionId: string
  projectPath: string
  metadata?: {
    tool?: string
    summary?: string
    eventType?: string
    [key: string]: any
  }
}
