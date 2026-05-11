// 角色合成引擎 — 从技能碎片聚类产生角色等级
import type { SkillFragment, SkillCategory } from './fragmentTypes'
import { SKILL_CATEGORY_MAP } from './fragmentTypes'
import {
  ROLE_DEFINITIONS,
  xpToLevel,
  SKILL_XP_MAP,
  type SynthesizedRole,
  type IdentityProfile,
} from './roleDefinitions'

/** 从碎片列表计算总 XP（按类别加权） */
function computeXpByCategory(fragments: SkillFragment[]): Record<SkillCategory, number> {
  const xp: Record<string, number> = {}
  for (const f of fragments) {
    const base = SKILL_XP_MAP[f.skillType] || 5
    // 主要类别加成 1.5x
    const category = SKILL_CATEGORY_MAP[f.skillType]
    xp[category] = (xp[category] || 0) + base
  }
  return xp as Record<SkillCategory, number>
}

/** 为每个角色计算合成结果 */
export function synthesizeRoles(fragments: SkillFragment[]): SynthesizedRole[] {
  const xpByCategory = computeXpByCategory(fragments)

  return ROLE_DEFINITIONS.map(roleDef => {
    // 汇总该角色主要类别的 XP
    let totalXp = 0
    for (const cat of roleDef.primaryCategories) {
      totalXp += xpByCategory[cat as SkillCategory] || 0
    }

    // 如果有通用碎片，给少量加成
    totalXp += Math.floor((xpByCategory['general'] || 0) * 0.3)

    const { level, xp, xpToNext } = xpToLevel(totalXp)
    const primaryCategory = roleDef.primaryCategories[0] || 'general'

    // 根据 XP 解锁专精
    const unlockedSpecs = roleDef.specializations
      .filter((_, i) => level >= (i + 1) * 2) // 每 2 级解锁一个专精
      .map(s => s.id)

    return {
      roleId: roleDef.id,
      level,
      xp,
      xpToNextLevel: xpToNext,
      specializations: unlockedSpecs,
      totalFragments: fragments.length,
      primaryCategory,
    }
  })
}

/** 生成默认身份档案 */
export function createIdentityProfile(
  displayName: string,
  fragments: SkillFragment[],
): IdentityProfile {
  const roles = synthesizeRoles(fragments)
  // 选择等级最高的角色作为主角色
  const sorted = [...roles].sort((a, b) => b.level - a.level || b.xp - a.xp)
  const activeRole = sorted[0] || roles[0]

  // 根据最高角色确定称号
  const title = generateTitle(activeRole)

  return {
    id: 'main',
    displayName,
    title,
    activeRoleId: activeRole.roleId,
    synthesizedRoles: roles,
    totalFragments: fragments.length,
    joinedAt: fragments[0]?.timestamp || new Date().toISOString(),
  }
}

/** 根据角色等级生成称号 */
function generateTitle(role: SynthesizedRole): string {
  const roleDef = ROLE_DEFINITIONS.find(r => r.id === role.roleId)
  const roleName = roleDef?.name || '驾驭者'
  if (role.level >= 10) return `传说级${roleName}`
  if (role.level >= 8) return `资深${roleName}`
  if (role.level >= 6) return `高级${roleName}`
  if (role.level >= 4) return `中级${roleName}`
  if (role.level >= 2) return `初级${roleName}`
  return `见习${roleName}`
}

/** 获取指定角色的主题色 */
export function getRoleColor(roleId: string): string {
  return ROLE_DEFINITIONS.find(r => r.id === roleId)?.color || '#6366f1'
}

/** 根据活跃角色推荐命令 */
export function getRoleRecommendations(roleId: string): { commands: string[]; tips: string[] } {
  switch (roleId) {
    case 'developer':
      return {
        commands: ['status', 'git-log', 'read', 'ai-chat'],
        tips: ['试试 git-log 查看最近提交', '用 ai-chat 获取代码建议'],
      }
    case 'devops':
      return {
        commands: ['wake', 'stop', 'status', 'broadcast'],
        tips: ['批量管理项目用 broadcast', '使用 batch-run 编排部署'],
      }
    case 'architect':
      return {
        commands: ['status', 'ai-chat', 'read'],
        tips: ['检查项目结构用 read', 'AI 对话讨论架构设计'],
      }
    case 'pm':
      return {
        commands: ['status', 'read'],
        tips: ['用 status 掌握项目状态', '初始化新项目获取知识库'],
      }
    case 'dataEngineer':
      return {
        commands: ['status', 'read', 'ai-chat'],
        tips: ['批量读取项目数据文件', 'AI 辅助数据建模'],
      }
    case 'qaEngineer':
      return {
        commands: ['status', 'broadcast', 'shell-exec'],
        tips: ['广播运行测试命令', '检查所有项目 CI 状态'],
      }
    case 'designer':
      return {
        commands: ['status', 'read', 'ai-chat'],
        tips: ['查看项目 UI 组件结构', 'AI 辅助设计系统生成'],
      }
    default:
      return { commands: ['status', 'ai-chat'], tips: ['探索可用命令'] }
  }
}
