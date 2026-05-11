// 功能解锁注册表 — 映射 featureId → 解锁条件

export interface UnlockCondition {
  requiredRole?: string        // 需要特定角色（可选）
  minLevel?: number            // 最低等级
  requiredSpecialization?: string // 需要特定专精
  minFragments?: number        // 最低总碎片数
  requiredCategories?: { category: string; minCount: number }[] // 需要特定类别的最低操作次数
}

export interface UnlockEntry {
  featureId: string
  name: string
  description: string
  condition: UnlockCondition
}

const UNLOCK_REGISTRY: UnlockEntry[] = [
  // ---- 基础功能（默认解锁） ----
  { featureId: 'cli.execute', name: '命令执行', description: '执行 CLI 命令', condition: {} },
  { featureId: 'cli.history', name: '命令历史', description: '查看命令历史', condition: {} },
  { featureId: 'project.select', name: '项目选择', description: '选择纳入管理的项目', condition: {} },
  { featureId: 'ai.chat', name: 'AI 对话', description: '与 AI 对话', condition: {} },
  { featureId: 'vcs.snapshot', name: '版本快照', description: '创建版本快照', condition: {} },

  // ---- 进阶功能 ----
  {
    featureId: 'cli.alias',
    name: '命令别名',
    description: '创建命令别名',
    condition: { minFragments: 10 },
  },
  {
    featureId: 'cli.bookmark',
    name: '命令收藏',
    description: '收藏和分组命令',
    condition: { minFragments: 20 },
  },
  {
    featureId: 'cli.batch',
    name: '批量执行',
    description: '批量编排命令',
    condition: { requiredRole: 'devops', minLevel: 2 },
  },
  {
    featureId: 'ai.agent',
    name: '驾驭智能体',
    description: 'AI Agent 自动调用工具',
    condition: { minFragments: 30 },
  },
  {
    featureId: 'ai.workflow',
    name: 'AI 工作流',
    description: '可视化工作流编排',
    condition: { requiredRole: 'architect', minLevel: 2 },
  },

  // ---- 高级功能 ----
  {
    featureId: 'plugin.install',
    name: '插件安装',
    description: '安装第三方插件',
    condition: { requiredRole: 'developer', minLevel: 3 },
  },
  {
    featureId: 'plugin.develop',
    name: '插件开发',
    description: '开发自定义插件',
    condition: { requiredRole: 'developer', minLevel: 5, requiredSpecialization: 'fullstack' },
  },
  {
    featureId: 'template.create',
    name: '模板创建',
    description: '创建可复用项目模板',
    condition: { requiredRole: 'architect', minLevel: 3 },
  },
  {
    featureId: 'layout.advanced',
    name: '高级布局',
    description: '保存多面板工作区布局',
    condition: { minFragments: 50 },
  },

  // ---- 大师级功能 ----
  {
    featureId: 'vcs.rollback',
    name: '版本回滚',
    description: '回滚到历史版本',
    condition: { requiredRole: 'devops', minLevel: 5 },
  },
  {
    featureId: 'role.architect',
    name: '架构师角色',
    description: '解锁架构师身份',
    condition: { minFragments: 200 },
  },
  {
    featureId: 'dashboard.advanced',
    name: '高级仪表盘',
    description: '查看详细效率分析',
    condition: { minFragments: 100 },
  },
]

/** 检查是否满足解锁条件 */
export function checkUnlock(
  featureId: string,
  context: {
    fragments: { skillType: string; category: string }[]
    activeRoleId?: string
    roles: { roleId: string; level: number; specializations: string[] }[]
  },
): { unlocked: boolean; condition: UnlockCondition } {
  const entry = UNLOCK_REGISTRY.find(e => e.featureId === featureId)
  if (!entry) return { unlocked: true, condition: {} }

  const { condition } = entry
  if (Object.keys(condition).length === 0) return { unlocked: true, condition }

  // 检查最低碎片数
  if (condition.minFragments && context.fragments.length < condition.minFragments) {
    return { unlocked: false, condition }
  }

  // 检查特定角色
  if (condition.requiredRole) {
    const role = context.roles.find(r => r.roleId === condition.requiredRole)
    if (!role) return { unlocked: false, condition }
    if (condition.minLevel && role.level < condition.minLevel) {
      return { unlocked: false, condition }
    }
    if (condition.requiredSpecialization && !role.specializations.includes(condition.requiredSpecialization)) {
      return { unlocked: false, condition }
    }
  }

  // 检查类别最低次数
  if (condition.requiredCategories) {
    for (const req of condition.requiredCategories) {
      const count = context.fragments.filter(f => f.category === req.category).length
      if (count < req.minCount) return { unlocked: false, condition }
    }
  }

  return { unlocked: true, condition }
}

/** 获取所有解锁条目 */
export function getAllUnlocks(): UnlockEntry[] {
  return UNLOCK_REGISTRY
}

/** 获取指定角色的解锁条件 */
export function getRoleUnlockCondition(roleId: string): UnlockCondition | null {
  const entry = UNLOCK_REGISTRY.find(e => e.featureId === `role.${roleId}`)
  return entry ? entry.condition : null
}
