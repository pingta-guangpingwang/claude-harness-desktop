// 驾驭智能体 — 角色管理器
// 借鉴 Kimi Agent Swarm 异构角色实例化 + ADK Scoped Handoff
// 角色系统作为可选叠加层，默认 CEO 拥有全部工具

import type { AgentTool, AgentContext } from './types.js'

// ---- 角色定义 ----

export interface RoleConfig {
  id: string
  name: string
  description: string
  /** 角色专属的系统提示词（注入到 IdentityProcessor） */
  systemPrompt: string
  /** 允许使用的工具名称列表（空=全部） */
  allowedTools: string[]
  /** 拒绝使用的工具名称列表 */
  deniedTools: string[]
  /** 角色触发关键词 — 用户消息中包含这些词时自动切换到此角色 */
  triggerKeywords: string[]
  /** 角色可以委派给哪些其他角色 */
  canDelegateTo: string[]
  /** 知识库标签 — 加载时匹配相关知识注入 */
  knowledgeTags: string[]
  /** 是否为默认角色 */
  isDefault: boolean
  /** Agent Card（A2A 兼容） */
  agentCard: {
    capabilities: string[]
    skills: string[]
    maxConcurrentTasks: number
    preferredTools: string[]
  }
}

// ---- 四个内置角色 ----

export const BUILTIN_ROLES: RoleConfig[] = [
  {
    id: 'ceo',
    name: 'CEO 总经理',
    description: '总控角色，负责调度指挥所有项目的 AI 终端，管理全局状态，分解复杂任务',
    systemPrompt: '你是 DeepBlue 驾驭智能体（CEO/总经理角色）。你的职责是调度指挥各项目的 Claude Code 终端（你的"员工"），而不是自己干活。你是管理者，不是项目开发者。你的基础设施工具仅用于安装 CLI 工具、检查环境变量、读写配置文件。项目级操作一律派给项目 AI。',
    allowedTools: [], // 空 = 全部
    deniedTools: [],
    triggerKeywords: ['管理', '调度', '全部', '所有项目', '检查状态', '体检', '报告', '启动'],
    canDelegateTo: ['worker', 'reviewer', 'diagnostician'],
    knowledgeTags: ['management', 'orchestration', 'api-config', 'infrastructure'],
    isDefault: true,
    agentCard: {
      capabilities: ['全局调度', '任务分解', '状态监控', '配置管理', 'API修复'],
      skills: ['项目编排', '错误恢复', '知识搜索', '健康检查'],
      maxConcurrentTasks: 10,
      preferredTools: ['wake_projects', 'broadcast', 'check_status', 'health_report', 'search_knowledge', 'diagnose_project'],
    },
  },
  {
    id: 'worker',
    name: 'Worker 工作智能体',
    description: '执行具体项目任务，深入项目细节，完成 CEO 分派的工作',
    systemPrompt: '你是 DeepBlue 工作智能体（Worker 角色）。你的职责是执行具体的项目任务，深入项目细节，完成 CEO 分派的工作。你专注于单一项目的深度工作，不被全局事务分散注意力。',
    allowedTools: ['task_project', 'read_project_chat', 'read_file', 'write_file', 'shell_exec', 'write_to_pty'],
    deniedTools: ['broadcast', 'wake_projects', 'stop_all', 'health_report'],
    triggerKeywords: ['修', '改', '写', '开发', '编译', '测试', '部署', '构建', '安装', 'npm', 'pip', '代码', '实现'],
    canDelegateTo: ['reviewer'],
    knowledgeTags: ['coding', 'development', 'debugging'],
    isDefault: false,
    agentCard: {
      capabilities: ['代码修改', '任务执行', '文件读写', '命令执行'],
      skills: ['开发', '调试', '构建', '部署'],
      maxConcurrentTasks: 1,
      preferredTools: ['task_project', 'read_project_chat', 'shell_exec', 'read_file'],
    },
  },
  {
    id: 'reviewer',
    name: 'Reviewer 审查智能体',
    description: '检查代码质量、发现潜在问题、确保项目符合规范',
    systemPrompt: '你是 DeepBlue 审查智能体（Reviewer 角色）。你的职责是检查代码质量、发现潜在问题、确保项目符合规范。你不修改代码，只给出审查意见和改进建议。',
    allowedTools: ['verify_project', 'read_project_chat', 'read_file', 'check_status'],
    deniedTools: ['write_file', 'shell_exec', 'task_project', 'broadcast', 'stop_projects'],
    triggerKeywords: ['审查', 'review', '质量', '检查代码', 'lint', '规范', '代码质量', '审计', 'audit'],
    canDelegateTo: ['worker'],
    knowledgeTags: ['code-quality', 'linting', 'best-practices', 'security'],
    isDefault: false,
    agentCard: {
      capabilities: ['代码审查', '质量检查', '规范验证', '安全审计'],
      skills: ['lint', 'typecheck', 'audit', 'code-review'],
      maxConcurrentTasks: 3,
      preferredTools: ['verify_project', 'read_project_chat', 'check_status'],
    },
  },
  {
    id: 'diagnostician',
    name: 'Diagnostician 诊断智能体',
    description: '诊断项目问题、分析错误原因、给出修复方案',
    systemPrompt: '你是 DeepBlue 诊断智能体（Diagnostician 角色）。你的职责是诊断项目问题、分析错误原因、给出修复方案。你不执行修复（交给 Worker），只负责诊断和分析。',
    allowedTools: ['diagnose_project', 'read_project_chat', 'read_file', 'check_status', 'search_knowledge', 'shell_exec'],
    deniedTools: ['write_file', 'task_project', 'broadcast', 'wake_projects'],
    triggerKeywords: ['诊断', '为什么', '报错', '错误', '失败', '坏了', '不行', '问题', '分析', '排查', 'debug'],
    canDelegateTo: ['worker', 'ceo'],
    knowledgeTags: ['diagnostics', 'error-patterns', 'api-config', 'troubleshooting'],
    isDefault: false,
    agentCard: {
      capabilities: ['错误诊断', '根因分析', '配置检查', '网络检测'],
      skills: ['diagnose', 'search-knowledge', 'error-pattern-matching', 'config-audit'],
      maxConcurrentTasks: 5,
      preferredTools: ['diagnose_project', 'search_knowledge', 'read_project_chat', 'shell_exec'],
    },
  },
]

// ---- RoleManager 类 ----

export class RoleManager {
  private roles: Map<string, RoleConfig> = new Map()
  private currentRoleId: string
  private roleHistory: Array<{ fromRole: string; toRole: string; reason: string; timestamp: string }> = []

  constructor() {
    // 注册内置角色
    for (const role of BUILTIN_ROLES) {
      this.roles.set(role.id, role)
    }
    this.currentRoleId = 'ceo'
  }

  /** 注册自定义角色 */
  registerRole(role: RoleConfig): void {
    this.roles.set(role.id, role)
  }

  /** 获取所有角色 */
  getAllRoles(): RoleConfig[] {
    return [...this.roles.values()]
  }

  /** 获取当前角色 */
  getCurrentRole(): RoleConfig {
    return this.roles.get(this.currentRoleId) || this.roles.get('ceo')!
  }

  /** 切换角色 */
  switchTo(roleId: string, reason: string = 'manual'): { success: boolean; message: string } {
    if (!this.roles.has(roleId)) {
      return { success: false, message: `角色 ${roleId} 不存在` }
    }

    const fromRole = this.currentRoleId
    this.roleHistory.push({
      fromRole,
      toRole: roleId,
      reason,
      timestamp: new Date().toISOString(),
    })

    this.currentRoleId = roleId
    return {
      success: true,
      message: `已从 ${fromRole} 切换到 ${roleId}: ${reason}`,
    }
  }

  /** 根据用户消息自动推断最佳角色 */
  inferRole(userMessage: string): { roleId: string; confidence: number; reason: string } {
    const msg = userMessage.toLowerCase()
    let bestRole = 'ceo'
    let bestScore = 0
    let bestMatchLen = 0 // 平局时用关键词累计长度决胜负

    for (const [id, role] of this.roles) {
      if (role.isDefault) continue
      let score = 0
      let matchLen = 0
      for (const keyword of role.triggerKeywords) {
        if (msg.includes(keyword.toLowerCase())) {
          score += 1
          matchLen += keyword.length
        }
      }
      if (score > bestScore || (score === bestScore && matchLen > bestMatchLen)) {
        bestScore = score
        bestRole = id
        bestMatchLen = matchLen
      }
    }

    const role = this.roles.get(bestRole)!
    return {
      roleId: bestRole,
      confidence: Math.min(bestScore / 3, 1),
      reason: bestRole === 'ceo' ? '默认角色' : `匹配关键词: ${role.triggerKeywords.filter(k => msg.includes(k.toLowerCase())).join(', ')}`,
    }
  }

  /** 自动切换 — 如果推断置信度足够高则切换 */
  autoSwitch(userMessage: string, minConfidence: number = 0.6): { switched: boolean; roleId: string; reason: string } {
    const inference = this.inferRole(userMessage)
    if (inference.confidence >= minConfidence && inference.roleId !== this.currentRoleId) {
      const result = this.switchTo(inference.roleId, inference.reason)
      return { switched: result.success, roleId: inference.roleId, reason: inference.reason }
    }
    return { switched: false, roleId: this.currentRoleId, reason: '置信度不足或无变化' }
  }

  /** 获取角色的工具过滤函数 */
  getToolFilter(roleId?: string): (tool: AgentTool) => boolean {
    const role = this.roles.get(roleId || this.currentRoleId)
    if (!role) return () => true

    return (tool: AgentTool) => {
      if (role.allowedTools.length > 0 && !role.allowedTools.includes(tool.name)) return false
      if (role.deniedTools.includes(tool.name)) return false
      return true
    }
  }

  /** 获取 Agent Card（A2A 兼容） */
  getAgentCard(roleId?: string): RoleConfig['agentCard'] | null {
    const role = this.roles.get(roleId || this.currentRoleId)
    return role?.agentCard || null
  }

  /** 导出角色切换历史 */
  getRoleHistory(): typeof this.roleHistory {
    return [...this.roleHistory]
  }

  /** 重置到默认角色 */
  reset(): void {
    this.currentRoleId = 'ceo'
    this.roleHistory = []
  }
}
