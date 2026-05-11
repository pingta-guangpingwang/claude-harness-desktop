// 驾驭智能体权限管理器 — 对标 Claude Code 多层管道
import type { HarnessPermissions, PermissionRule, AgentTool } from './types'
import { DEFAULT_PERMISSIONS } from './types'

type Decision = { decision: 'allow' | 'deny' | 'ask'; reason?: string }

export class PermissionManager {
  private permissions: HarnessPermissions
  private customRules: PermissionRule[] = []
  private denialCounts = new Map<string, number>()
  private maxAutoDenials = 3

  constructor() {
    this.permissions = { ...DEFAULT_PERMISSIONS }
  }

  updatePermissions(p: Partial<HarnessPermissions>): void {
    Object.assign(this.permissions, p)
  }

  getPermissions(): HarnessPermissions {
    return { ...this.permissions }
  }

  addRule(rule: PermissionRule): void {
    this.customRules.push(rule)
  }

  clearRules(): void {
    this.customRules = []
  }

  /** 多层权限管道入口 */
  checkTool(tool: AgentTool, params: Record<string, unknown>): Decision {
    // ---- Step 0: 全局信任模式 — 开启后全部自动批准 ----
    if (this.permissions.autoTrustConfirm) {
      return { decision: 'allow', reason: '全局信任模式已开启' }
    }

    // ---- Step 1: 工具专属权限检查 ----
    if (tool.checkPermissions) {
      const toolDecision = tool.checkPermissions(params, {} as any)
      if (toolDecision && toolDecision.decision !== 'ask') {
        return toolDecision // 工具明确允许或拒绝
      }
      if (toolDecision) {
        return toolDecision // 工具要求询问
      }
    }

    // ---- Step 2: 危险操作拦截 ----
    if (this.permissions.blockDestructive) {
      const destructiveCheck = this.checkDestructive(tool, params)
      if (destructiveCheck) return destructiveCheck
    }

    // ---- Step 3: 自定义规则匹配 ----
    for (const rule of this.customRules) {
      if (matchPattern(tool.name, rule.toolPattern)) {
        if (rule.decision === 'deny') {
          return { decision: 'deny', reason: `工具 ${tool.name} 被规则拦截` }
        }
        if (rule.decision === 'allow' || rule.decision === 'allow_once') {
          return { decision: 'allow', reason: '规则允许' }
        }
        return { decision: 'ask', reason: '规则要求确认' }
      }
    }

    // ---- Step 4: 读写分组默认策略 ----
    const isReadOnly = typeof tool.isReadOnly === 'function'
      ? tool.isReadOnly(params)
      : (tool.isReadOnly ?? false)

    if (isReadOnly) {
      return { decision: this.permissions.autoApproveReads ? 'allow' : 'ask' }
    }

    const isDestructive = typeof tool.isDestructive === 'function'
      ? tool.isDestructive(params)
      : (tool.isDestructive ?? false)

    if (isDestructive) {
      return {
        decision: this.permissions.confirmBeforeWrites ? 'ask' : 'allow',
        reason: this.permissions.confirmBeforeWrites ? '破坏性操作需要确认' : undefined,
      }
    }

    // ---- Step 5: 拒绝追踪 (防无限 ask 循环) ----
    const denials = this.denialCounts.get(tool.name) || 0
    if (denials >= this.maxAutoDenials) {
      return { decision: 'deny', reason: `工具 ${tool.name} 连续被拒绝 ${denials} 次，已自动拒绝` }
    }

    // 默认：需要确认
    return { decision: 'ask', reason: `执行 "${tool.name}" 需要确认` }
  }

  /** 记录拒绝（用于追踪） */
  recordDenial(toolName: string): void {
    this.denialCounts.set(toolName, (this.denialCounts.get(toolName) || 0) + 1)
  }

  /** 记录允许（重置计数器） */
  recordAllow(toolName: string): void {
    this.denialCounts.delete(toolName)
  }

  /** 重置拒绝追踪 */
  resetDenialTracking(): void {
    this.denialCounts.clear()
  }

  private checkDestructive(tool: AgentTool, params: Record<string, unknown>): Decision | null {
    if (params.command && typeof params.command === 'string') {
      const dangerous = /\brm\s+-rf\b|\brmdir\b|\bdel\s+\/[fs]\b|\bformat\b|\b:\(\)\s*\{/i
      if (dangerous.test(params.command)) {
        return { decision: 'deny', reason: '危险操作已拦截: ' + params.command }
      }
    }
    return null
  }
}

function matchPattern(name: string, pattern: string): boolean {
  if (pattern === '*') return true
  if (pattern.endsWith('*')) return name.startsWith(pattern.slice(0, -1))
  if (pattern.startsWith('*')) return name.endsWith(pattern.slice(1))
  return name === pattern
}
