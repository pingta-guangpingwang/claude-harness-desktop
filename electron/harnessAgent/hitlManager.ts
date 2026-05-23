// 驾驭智能体 — 动态确认管理器 (Human-in-the-Loop)
// 借鉴 Google ADK 的 RequireConfirmation 模式
// 但更智能：不是静态标记工具，而是 Agent 根据置信度动态决定
// 当 Reflection 输出 confidence='low' 或连续失败时，暂停等用户确认

import type { ReflectionResult } from './reflector.js'
import type { ToolCallRequest } from './types.js'

export interface HITLDecision {
  pause: boolean
  reason?: string
  severity: 'low' | 'medium' | 'high'
}

export type HITLResponse = 'approved' | 'denied' | 'timeout'

export class HITLManager {
  private recentFailures: Map<string, number> = new Map()  // toolName → 连续失败次数
  private pendingConfirmation: {
    resolve: (response: HITLResponse) => void
    toolCall: ToolCallRequest
    timeout: ReturnType<typeof setTimeout>
  } | null = null
  private confirmTimeoutMs: number
  private enabled: boolean = false

  constructor(confirmTimeoutMs: number = 120_000) {
    this.confirmTimeoutMs = confirmTimeoutMs
  }

  /**
   * 决定是否需要在工具执行前暂停并请求人类确认
   * 触发条件（任一）：
   * 1. Reflection 输出 confidence = 'low'
   * 2. 工具属于危险操作 (write_file, shell_exec, delete_*, stop_*)
   * 3. 同一工具连续失败 3 次以上
   * 4. Agent 显式请求确认（工具参数含 [CONFIRM_NEEDED]）
   */
  shouldPauseForConfirmation(
    toolCall: ToolCallRequest,
    reflection: ReflectionResult | null,
  ): HITLDecision {
    if (!this.enabled) return { pause: false, severity: 'low' }

    // 条件 1: 低置信度
    if (reflection?.confidence === 'low') {
      return {
        pause: true,
        reason: `Agent 对当前决策置信度低: ${reflection.observation}`,
        severity: 'high',
      }
    }

    // 条件 2: 危险操作
    const DANGEROUS_TOOLS = ['write_file', 'shell_exec', 'delete_file', 'delete_directory', 'stop_projects', 'stop_all']
    if (DANGEROUS_TOOLS.includes(toolCall.name)) {
      return {
        pause: true,
        reason: `危险操作: ${toolCall.name} — 需要确认执行`,
        severity: 'medium',
      }
    }

    // 条件 3: 连续失败
    const failCount = this.recentFailures.get(toolCall.name) || 0
    if (failCount >= 3) {
      return {
        pause: true,
        reason: `工具 ${toolCall.name} 已连续失败 ${failCount} 次，需要人工决策`,
        severity: 'high',
      }
    }

    // 条件 4: 显式确认标记
    const argsStr = JSON.stringify(toolCall.arguments)
    if (argsStr.includes('[CONFIRM_NEEDED]')) {
      return {
        pause: true,
        reason: 'Agent 显式请求确认',
        severity: 'medium',
      }
    }

    return { pause: false, severity: 'low' }
  }

  /** 记录工具执行结果 */
  recordResult(toolName: string, success: boolean): void {
    if (success) {
      this.recentFailures.delete(toolName)
    } else {
      this.recentFailures.set(toolName, (this.recentFailures.get(toolName) || 0) + 1)
    }
  }

  /**
   * 暂停 Agent Loop，等待用户确认
   * 返回 'approved' | 'denied' | 'timeout'
   */
  async requestConfirmation(
    toolCall: ToolCallRequest,
    reason: string,
  ): Promise<HITLResponse> {
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        if (this.pendingConfirmation) {
          this.pendingConfirmation.resolve('timeout')
          this.pendingConfirmation = null
        }
      }, this.confirmTimeoutMs)

      this.pendingConfirmation = {
        resolve,
        toolCall,
        timeout,
      }
    })
  }

  /** 用户确认或拒绝 */
  respond(response: HITLResponse): void {
    if (this.pendingConfirmation) {
      clearTimeout(this.pendingConfirmation.timeout)
      this.pendingConfirmation.resolve(response)
      this.pendingConfirmation = null
    }
  }

  /** 获取当前待确认状态 */
  getPendingConfirmation(): { toolCall: ToolCallRequest } | null {
    if (!this.pendingConfirmation) return null
    return { toolCall: this.pendingConfirmation.toolCall }
  }

  /** 获取失败统计 */
  getFailureStats(): Map<string, number> {
    return new Map(this.recentFailures)
  }

  /** 重置失败计数 */
  resetFailures(): void {
    this.recentFailures.clear()
  }

  /** 启用/禁用 HITL */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /** 是否有待处理确认 */
  get hasPending(): boolean {
    return this.pendingConfirmation !== null
  }
}
