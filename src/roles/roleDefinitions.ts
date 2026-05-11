// 角色定义 — 7 种驾驭角色 + 专精树

export interface Specialization {
  id: string
  name: string
  description: string
  icon: string
}

export interface RoleDefinition {
  id: string
  name: string
  description: string
  icon: string
  color: string           // 主题色
  primaryCategories: string[] // 主要技能类别 → 高 XP 权重
  specializations: Specialization[]
  unlockedAtLevel: number // 第几级解锁
}

export interface SynthesizedRole {
  roleId: string
  level: number           // 1-10
  xp: number
  xpToNextLevel: number
  specializations: string[]
  totalFragments: number
  primaryCategory: string
}

export interface IdentityProfile {
  id: string
  displayName: string
  title: string
  activeRoleId: string
  synthesizedRoles: SynthesizedRole[]
  totalFragments: number
  joinedAt: string
}

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    id: 'developer',
    name: '开发者',
    description: '专注于代码编写、调试、重构的全栈驾驭者',
    icon: '\u{1F4BB}',
    color: '#3b82f6',
    primaryCategories: ['cli', 'debug', 'ai', 'vcs'],
    unlockedAtLevel: 1,
    specializations: [
      { id: 'frontend', name: '前端专精', description: 'React/Vue/UI 组件开发', icon: '\u{1F3A8}' },
      { id: 'backend', name: '后端专精', description: 'API/数据库/服务架构', icon: '\u{1F5C4}' },
      { id: 'fullstack', name: '全栈专精', description: '端到端开发能力', icon: '\u{1F310}' },
    ],
  },
  {
    id: 'designer',
    name: '设计师',
    description: '驾驭 UI/UX 设计系统与交互体验',
    icon: '\u{1F3A8}',
    color: '#ec4899',
    primaryCategories: ['productivity', 'general'],
    unlockedAtLevel: 1,
    specializations: [
      { id: 'ui', name: 'UI 设计', description: '组件库与视觉系统', icon: '\u{1F4D0}' },
      { id: 'ux', name: 'UX 设计', description: '用户研究交互设计', icon: '\u{1F9E9}' },
    ],
  },
  {
    id: 'devops',
    name: '运维工程师',
    description: 'CI/CD、容器化、基础设施即代码',
    icon: '\u{2699}\u{FE0F}',
    color: '#f59e0b',
    primaryCategories: ['cli', 'vcs', 'debug', 'ai'],
    unlockedAtLevel: 1,
    specializations: [
      { id: 'ci-cd', name: 'CI/CD', description: '流水线与自动化部署', icon: '\u{1F504}' },
      { id: 'infra', name: '基础设施', description: 'Docker/K8s/云架构', icon: '\u{2601}\u{FE0F}' },
    ],
  },
  {
    id: 'architect',
    name: '架构师',
    description: '系统设计、技术选型、架构治理',
    icon: '\u{1F3DB}\u{FE0F}',
    color: '#8b5cf6',
    primaryCategories: ['project', 'ai', 'vcs', 'general'],
    unlockedAtLevel: 3,
    specializations: [
      { id: 'system', name: '系统架构', description: '分布式系统与微服务', icon: '\u{1F4E6}' },
      { id: 'data', name: '数据架构', description: '数据管线与存储策略', icon: '\u{1F4CA}' },
    ],
  },
  {
    id: 'dataEngineer',
    name: '数据工程师',
    description: '数据管线、ETL、分析与可视化',
    icon: '\u{1F4CA}',
    color: '#10b981',
    primaryCategories: ['cli', 'ai', 'project'],
    unlockedAtLevel: 2,
    specializations: [
      { id: 'etl', name: 'ETL', description: '提取/转换/加载管线', icon: '\u{1F4E5}' },
      { id: 'analytics', name: '分析', description: '统计建模与可视化', icon: '\u{1F4C8}' },
    ],
  },
  {
    id: 'qaEngineer',
    name: '测试工程师',
    description: '自动化测试、质量保障、性能基准',
    icon: '\u{1F9EA}',
    color: '#ef4444',
    primaryCategories: ['debug', 'cli', 'vcs'],
    unlockedAtLevel: 2,
    specializations: [
      { id: 'automation', name: '自动化测试', description: '单元/集成/E2E', icon: '\u{1F916}' },
      { id: 'perf', name: '性能测试', description: '压力测试与基准', icon: '\u{26A1}' },
    ],
  },
  {
    id: 'pm',
    name: '项目经理',
    description: '需求管理、任务编排、团队协调',
    icon: '\u{1F4CB}',
    color: '#06b6d4',
    primaryCategories: ['project', 'productivity', 'general'],
    unlockedAtLevel: 1,
    specializations: [
      { id: 'agile', name: '敏捷管理', description: 'Scrum/Kanban 实践', icon: '\u{1F3C3}' },
      { id: 'planning', name: '战略规划', description: '路线图与里程碑', icon: '\u{1F5FA}\u{FE0F}' },
    ],
  },
]

/** XP 计算: 每级需要 level * 100 XP */
export function xpForLevel(level: number): number {
  return level * 100
}

/** 总 XP 到等级 (1-10) */
export function xpToLevel(totalXp: number): { level: number; xp: number; xpToNext: number } {
  let level = 1
  let acc = 0
  for (let l = 1; l <= 10; l++) {
    const needed = xpForLevel(l)
    if (acc + needed > totalXp) {
      return { level: l, xp: totalXp - acc, xpToNext: needed }
    }
    acc += needed
    level = l
  }
  return { level: 10, xp: totalXp - acc, xpToNext: 0 }
}

/** 技能类型 → XP 值 */
export const SKILL_XP_MAP: Record<string, number> = {
  'cli.command': 10, 'cli.batch': 25, 'cli.alias': 5, 'cli.bookmark': 5,
  'ai.generate': 30, 'ai.chat': 10, 'ai.tool': 20, 'ai.workflow': 40,
  'project.create': 50, 'project.manage': 20, 'project.import': 30,
  'vcs.snapshot': 15, 'vcs.commit': 20, 'vcs.rollback': 25,
  'plugin.install': 15, 'plugin.develop': 50,
  'productivity.template': 10, 'productivity.layout': 5, 'productivity.quicklaunch': 3,
  'debug.terminal': 5, 'debug.monitor': 10,
  'general.explore': 3, 'general.configure': 5,
}
