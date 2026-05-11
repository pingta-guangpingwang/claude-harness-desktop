// 技能碎片 — 每次操作产生的经验单元

export type SkillType =
  // CLI 类
  | 'cli.command'        // 执行 CLI 命令
  | 'cli.batch'          // 批量执行
  | 'cli.alias'          // 创建别名
  | 'cli.bookmark'       // 收藏命令
  // AI 类
  | 'ai.generate'        // AI 生成内容（知识库/思维导图）
  | 'ai.chat'            // 与 AI 对话
  | 'ai.tool'            // Agent 调用工具
  | 'ai.workflow'        // AI 工作流
  // 项目类
  | 'project.create'     // 创建项目
  | 'project.manage'     // 管理项目（配置/初始化）
  | 'project.import'     // 导入项目
  // 版本控制类
  | 'vcs.snapshot'       // DBHT 快照
  | 'vcs.commit'         // DBHT 提交
  | 'vcs.rollback'       // DBHT 回滚
  // 插件类
  | 'plugin.install'     // 安装插件
  | 'plugin.develop'     // 开发插件
  // 效率类
  | 'productivity.template'  // 使用模板
  | 'productivity.layout'    // 保存布局
  | 'productivity.quicklaunch' // 快速启动
  // 调试类
  | 'debug.terminal'     // PTY 终端操作
  | 'debug.monitor'      // 监控面板
  // 通用
  | 'general.explore'    // 浏览/探索
  | 'general.configure'  // 配置设置

export type SkillCategory =
  | 'cli' | 'ai' | 'project' | 'vcs' | 'plugin' | 'productivity' | 'debug' | 'general'

export interface SkillFragment {
  id: string
  timestamp: string // ISO
  skillType: SkillType
  category: SkillCategory
  action: string
  metadata: Record<string, unknown>
  projectPath?: string
  durationMs?: number
}

export const SKILL_CATEGORY_MAP: Record<SkillType, SkillCategory> = {
  'cli.command': 'cli', 'cli.batch': 'cli', 'cli.alias': 'cli', 'cli.bookmark': 'cli',
  'ai.generate': 'ai', 'ai.chat': 'ai', 'ai.tool': 'ai', 'ai.workflow': 'ai',
  'project.create': 'project', 'project.manage': 'project', 'project.import': 'project',
  'vcs.snapshot': 'vcs', 'vcs.commit': 'vcs', 'vcs.rollback': 'vcs',
  'plugin.install': 'plugin', 'plugin.develop': 'plugin',
  'productivity.template': 'productivity', 'productivity.layout': 'productivity', 'productivity.quicklaunch': 'productivity',
  'debug.terminal': 'debug', 'debug.monitor': 'debug',
  'general.explore': 'general', 'general.configure': 'general',
}
