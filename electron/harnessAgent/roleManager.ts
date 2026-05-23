// 驾驭智能体 — 角色管理器
// 借鉴 Kimi Agent Swarm 异构角色实例化 + ADK Scoped Handoff
// 角色系统作为可选叠加层，默认 CEO 拥有全部工具

import type { AgentTool, AgentContext } from './types.js'
import { RoleScorer, type RoleScore, type TaskRecord } from './roleScorer.js'
import { roleConfigStore } from './roleConfigStore.js'

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
  private scorer: RoleScorer
  /** 自定义角色集合（和内置角色分开管理，内置角色不可删除） */
  private customRoleIds: Set<string> = new Set()
  /** 已启用的角色 ID 集合（从持久化配置加载） */
  private enabledRoleIds: Set<string>
  /** 角色系统主开关（从持久化配置加载） */
  private roleSystemEnabled: boolean

  constructor(scorer?: RoleScorer) {
    // 注册内置角色
    for (const role of BUILTIN_ROLES) {
      this.roles.set(role.id, role)
    }
    // 从持久化加载自定义角色
    for (const cr of roleConfigStore.customRoles) {
      this.roles.set(cr.id, cr)
      this.customRoleIds.add(cr.id)
    }
    this.currentRoleId = 'ceo'
    this.scorer = scorer || new RoleScorer()
    // 从持久化加载启用状态
    this.enabledRoleIds = new Set(roleConfigStore.enabledRoleIds)
    this.roleSystemEnabled = roleConfigStore.systemEnabled
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

  /** 根据用户消息自动推断最佳角色（含评分加权） */
  inferRole(userMessage: string): { roleId: string; confidence: number; reason: string } {
    const msg = userMessage.toLowerCase()
    let bestRole = 'ceo'
    let bestScore = 0
    let bestMatchLen = 0

    for (const [id, role] of this.roles) {
      if (role.isDefault) continue
      // 跳过未启用的角色
      if (!this.enabledRoleIds.has(id)) continue
      let score = 0
      let matchLen = 0
      for (const keyword of role.triggerKeywords) {
        if (msg.includes(keyword.toLowerCase())) {
          score += 1
          matchLen += keyword.length
        }
      }
      // 评分加权：只有关键词命中时才应用评分加值（无命中不参与竞争）
      const roleScore = this.scorer.getScore(id)
      const scoreBonus = score > 0 && roleScore ? (roleScore.successRate - 0.5) * 0.5 : 0 // ±0.25 浮动
      const adjustedScore = score + scoreBonus

      if (adjustedScore > bestScore || (adjustedScore === bestScore && matchLen > bestMatchLen)) {
        bestScore = adjustedScore
        bestRole = id
        bestMatchLen = matchLen
      }
    }

    const role = this.roles.get(bestRole)!
    const roleScore = this.scorer.getScore(bestRole)
    const scoreInfo = roleScore ? ` (评分: ${roleScore.compositeScore.toFixed(0)}/100, 成功率: ${(roleScore.successRate * 100).toFixed(0)}%)` : ''
    return {
      roleId: bestRole,
      confidence: Math.min(bestScore / 3, 1),
      reason: bestRole === 'ceo' ? `默认角色${scoreInfo}` : `匹配关键词: ${role.triggerKeywords.filter(k => msg.includes(k.toLowerCase())).join(', ')}${scoreInfo}`,
    }
  }

  /** 手动创建自定义角色 */
  createCustomRole(config: {
    id: string
    name: string
    description: string
    systemPrompt: string
    allowedTools?: string[]
    deniedTools?: string[]
    triggerKeywords?: string[]
    canDelegateTo?: string[]
    knowledgeTags?: string[]
    capabilities?: string[]
    skills?: string[]
  }): { success: boolean; message: string; role?: RoleConfig } {
    // 验证 ID
    if (!config.id || !/^[a-z0-9_-]+$/i.test(config.id)) {
      return { success: false, message: '角色 ID 只能包含字母、数字、下划线和连字符' }
    }
    if (this.roles.has(config.id)) {
      return { success: false, message: `角色 ${config.id} 已存在，请用其他 ID` }
    }
    if (!config.name.trim()) {
      return { success: false, message: '角色名称不能为空' }
    }

    const role: RoleConfig = {
      id: config.id,
      name: config.name,
      description: config.description,
      systemPrompt: config.systemPrompt,
      allowedTools: config.allowedTools || [],
      deniedTools: config.deniedTools || [],
      triggerKeywords: config.triggerKeywords || [],
      canDelegateTo: config.canDelegateTo || [],
      knowledgeTags: config.knowledgeTags || [],
      isDefault: false,
      agentCard: {
        capabilities: config.capabilities || [config.description],
        skills: config.skills || [],
        maxConcurrentTasks: 1,
        preferredTools: config.allowedTools || [],
      },
    }

    this.roles.set(config.id, role)
    this.customRoleIds.add(config.id)

    // 持久化到配置存储
    roleConfigStore.addCustomRole(role)

    // 初始化评分
    this.scorer.getScore(config.id) // 确保评分记录存在

    return { success: true, message: `角色 "${config.name}" 创建成功`, role }
  }

  /**
   * AI 建议创建新角色 — 驾驭智能体发现任务模式不匹配现有角色时调用
   * 返回建议的角色配置草稿，用户审核后可调用 createCustomRole 确认创建
   */
  suggestNewRole(observation: {
    taskPattern: string       // 观察到的任务模式描述
    suggestedName: string     // 建议的角色名称
    suggestedId?: string      // 建议的角色 ID（自动生成）
    missingKeywords: string[] // 现有角色未覆盖的关键词
    neededTools: string[]     // 需要的工具列表
    neededSkills: string[]    // 需要的技能描述
  }): { suggestion: Omit<Parameters<RoleManager['createCustomRole']>[0], 'systemPrompt'>; systemPromptTemplate: string } {
    const id = observation.suggestedId || observation.suggestedName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const capabilities = [...observation.neededSkills, observation.taskPattern]
    const knowledgeTags = [...observation.missingKeywords, observation.suggestedName.toLowerCase()]

    return {
      suggestion: {
        id,
        name: observation.suggestedName,
        description: `AI 建议创建的角色 — ${observation.taskPattern}`,
        allowedTools: observation.neededTools,
        deniedTools: [],
        triggerKeywords: observation.missingKeywords,
        canDelegateTo: ['ceo'],
        knowledgeTags,
        capabilities,
        skills: observation.neededSkills,
      },
      systemPromptTemplate: `你是 DeepBlue ${observation.suggestedName}角色。\n你的职责是${observation.taskPattern}。\n\n## 可用工具\n${observation.neededTools.map(t => `- ${t}`).join('\n')}\n\n用中文，简洁有力。`,
    }
  }

  /** 删除自定义角色（内置角色不可删除） */
  deleteRole(roleId: string): { success: boolean; message: string } {
    if (!this.customRoleIds.has(roleId)) {
      return { success: false, message: `角色 ${roleId} 是内置角色，不可删除` }
    }
    if (!this.roles.has(roleId)) {
      return { success: false, message: `角色 ${roleId} 不存在` }
    }

    this.roles.delete(roleId)
    this.customRoleIds.delete(roleId)
    this.scorer.resetScore(roleId)

    // 同步到持久化存储
    roleConfigStore.removeCustomRole(roleId)

    // 如果当前正在使用此角色，切回 CEO
    if (this.currentRoleId === roleId) {
      this.currentRoleId = 'ceo'
    }

    return { success: true, message: `角色 ${roleId} 已删除` }
  }

  /** 获取所有角色及其评分 */
  getRolesWithScores(): Array<{ role: RoleConfig; score: RoleScore | null; isCustom: boolean }> {
    return [...this.roles.values()].map(role => ({
      role,
      score: this.scorer.getScore(role.id),
      isCustom: this.customRoleIds.has(role.id),
    }))
  }

  /** 获取评分器（供 AgentLoop 记录任务） */
  getScorer(): RoleScorer {
    return this.scorer
  }

  /** 获取评分排行榜 */
  getLeaderboard(topK?: number): RoleScore[] {
    return this.scorer.getLeaderboard(topK)
  }

  /** 生成评分报告 */
  generateScoreReport(): string {
    return this.scorer.generateReport()
  }

  /** 是否为自定义角色 */
  isCustomRole(roleId: string): boolean {
    return this.customRoleIds.has(roleId)
  }

  /** 角色系统主开关是否启用 */
  isSystemEnabled(): boolean {
    return this.roleSystemEnabled
  }

  /** 设置角色系统主开关（同步持久化） */
  setSystemEnabled(enabled: boolean): void {
    this.roleSystemEnabled = enabled
    roleConfigStore.setSystemEnabled(enabled)
  }

  /** 指定角色是否启用 */
  isRoleEnabled(roleId: string): boolean {
    return this.enabledRoleIds.has(roleId)
  }

  /** 设置指定角色的启用状态（同步持久化） */
  setRoleEnabled(roleId: string, enabled: boolean): void {
    if (enabled) {
      this.enabledRoleIds.add(roleId)
    } else {
      this.enabledRoleIds.delete(roleId)
    }
    roleConfigStore.setRoleEnabled(roleId, enabled)
  }

  /** 自动切换 — 如果推断置信度足够高则切换 */
  autoSwitch(userMessage: string, minConfidence: number = 0.6): { switched: boolean; roleId: string; reason: string } {
    if (!this.roleSystemEnabled) {
      return { switched: false, roleId: this.currentRoleId, reason: '角色系统未启用' }
    }
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
