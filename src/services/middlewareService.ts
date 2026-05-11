// Middleware Box Service — frontend bridge to the Middleware Box IPC

export interface AgentProfile {
  agentId: string
  totalOperations: number
  capabilities: Array<{
    capability: string
    score: number
    level: 'beginner' | 'intermediate' | 'expert' | 'master'
    successRate: number
  }>
  strategies: Array<{ strategy: string; count: number; lastUsed: string }>
  modelPreferences: Array<{ model: string; count: number }>
  performance: {
    avgDurationMs: number
    totalTokensUsed: number
    activeHours: number
  }
  lastOperationAt: string | null
}

export interface MiddlewareHealth {
  status: 'healthy' | 'degraded' | 'unhealthy'
  uptime: number
  activeAgents: number
  queuedRequests: number
  circuitBreakers: Record<string, 'closed' | 'open' | 'half-open'>
  memory: { heapUsedMB: number; heapTotalMB: number }
  lastCheck: string
}

export const middlewareService = {
  async start() {
    return window.electronAPI.middlewareStart()
  },

  async stop() {
    return window.electronAPI.middlewareStop()
  },

  async getStatus() {
    return window.electronAPI.middlewareGetStatus()
  },

  async registerAgent(context: any) {
    return window.electronAPI.middlewareRegisterAgent(context)
  },

  async unregisterAgent(agentId: string) {
    return window.electronAPI.middlewareUnregisterAgent(agentId)
  },

  async processRequest(request: any) {
    return window.electronAPI.middlewareProcessRequest(request)
  },

  async getAgentProfiles(): Promise<AgentProfile[]> {
    const result = await window.electronAPI.middlewareGetAgentProfiles()
    return result.success ? result.profiles : []
  },

  async getAgentProfile(agentId: string): Promise<AgentProfile | null> {
    const result = await window.electronAPI.middlewareGetAgentProfile(agentId)
    return result.success ? result.profile : null
  },

  async compareAgents(agentIds: string[]) {
    return window.electronAPI.middlewareCompareAgents(agentIds)
  },

  async getHealth(): Promise<MiddlewareHealth | null> {
    const result = await window.electronAPI.middlewareGetHealth()
    return result.success ? result.health : null
  },

  async resetCircuitBreaker(breakerId: string) {
    return window.electronAPI.middlewareResetCircuitBreaker(breakerId)
  },
}
