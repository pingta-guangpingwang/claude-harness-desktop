// 驾驭智能体 — 知识库模块
// 存储 API 配置配方、错误诊断模式、恢复策略映射
// 让 LLM 可以通过 search_knowledge 工具按需查询

export interface ApiRecipe {
  id: string
  name: string
  tags: string[]
  /** 诊断信号 — 终端输出中出现这些关键词表示可能匹配此配方 */
  diagnosticSigns: string[]
  /** 正确的 .claude/settings.json 内容 */
  settingsJson: Record<string, unknown>
  /** 需要的环境变量 */
  envVars?: Record<string, string>
  notes: string
}

export interface ErrorPattern {
  id: string
  category: 'CONFIG' | 'PERMISSION' | 'NETWORK' | 'PROJECT' | 'UNKNOWN'
  /** 终端输出 / settings.json 中匹配此错误的模式 */
  patterns: RegExp[]
  /** 人类可读的诊断说明 */
  diagnosis: string
  /** 建议的恢复步骤（工具名 + 参数提示） */
  recovery: Array<{
    tool: string
    description: string
    params?: Record<string, unknown>
  }>
}

// ====== API 配置配方 ======

const API_RECIPES: ApiRecipe[] = [
  {
    id: 'anthropic-direct',
    name: 'Anthropic Claude API 直连',
    tags: ['anthropic', 'claude', 'direct', 'official'],
    diagnosticSigns: [
      'ANTHROPIC_API_KEY',
      'api.anthropic.com',
      'x-api-key',
      'anthropic-version',
    ],
    settingsJson: {
      hasTrustDialogAccepted: true,
      defaultMode: 'acceptEdits',
      permissions: {
        allow: ['Bash(*)', 'Read(*)', 'Write(*)', 'Edit(*)', 'Glob(*)', 'Grep(*)', 'WebFetch(*)', 'WebSearch(*)'],
        deny: [],
      },
      env: {
        ANTHROPIC_API_KEY: '__YOUR_API_KEY__',
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      },
    },
    envVars: {
      ANTHROPIC_API_KEY: 'sk-ant-... 格式的 Anthropic API Key',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com（可选，默认即此值）',
    },
    notes: '标准 Anthropic Claude API。API Key 以 sk-ant- 开头。Base URL 默认 https://api.anthropic.com，无需额外设置。',
  },
  {
    id: 'deepseek-direct',
    name: 'DeepSeek API 直连（OpenAI 兼容模式）',
    tags: ['deepseek', 'v3', 'v4', 'direct', 'openai-compatible'],
    diagnosticSigns: [
      'deepseek',
      'DEEPSEEK_API_KEY',
      'api.deepseek.com',
      'Bearer',
      'openai',
    ],
    settingsJson: {
      hasTrustDialogAccepted: true,
      defaultMode: 'acceptEdits',
      permissions: {
        allow: ['Bash(*)', 'Read(*)', 'Write(*)', 'Edit(*)', 'Glob(*)', 'Grep(*)', 'WebFetch(*)', 'WebSearch(*)'],
        deny: [],
      },
      env: {
        ANTHROPIC_API_KEY: '__YOUR_DEEPSEEK_KEY__',
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic/v1',
        ANTHROPIC_MODEL: 'deepseek-v4-pro',
      },
    },
    envVars: {
      ANTHROPIC_API_KEY: 'sk-... 格式的 DeepSeek API Key',
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic/v1',
      ANTHROPIC_MODEL: 'deepseek-v4-pro 或 deepseek-chat',
    },
    notes: 'DeepSeek 官方提供 Anthropic 兼容端点。API Key 以 sk- 开头。Base URL 末尾不带 /messages。模型名用 deepseek-v4-pro 或 deepseek-chat。',
  },
  {
    id: 'deepseek-openai',
    name: 'DeepSeek API 直连（OpenAI 兼容端点）',
    tags: ['deepseek', 'v3', 'v4', 'direct', 'openai'],
    diagnosticSigns: [
      'deepseek',
      'DEEPSEEK_API_KEY',
      'api.deepseek.com/v1',
      'OPENAI_API_KEY',
    ],
    settingsJson: {
      hasTrustDialogAccepted: true,
      defaultMode: 'acceptEdits',
      permissions: {
        allow: ['Bash(*)', 'Read(*)', 'Write(*)', 'Edit(*)', 'Glob(*)', 'Grep(*)', 'WebFetch(*)', 'WebSearch(*)'],
        deny: [],
      },
      env: {
        ANTHROPIC_API_KEY: '__YOUR_DEEPSEEK_KEY__',
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic/v1',
        ANTHROPIC_MODEL: 'deepseek-v4-pro',
      },
    },
    envVars: {
      ANTHROPIC_API_KEY: 'sk-... 格式的 DeepSeek API Key',
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic/v1',
    },
    notes: 'DeepSeek 也提供 Anthropic 兼容的 /anthropic/v1 端点，Claude Code 原生支持此格式。',
  },
]

// ====== 错误诊断模式 ======

const ERROR_PATTERNS: ErrorPattern[] = [
  // -- 配置错误 --
  {
    id: 'config-invalid-api-key',
    category: 'CONFIG',
    patterns: [
      /invalid.*api.?key/i,
      /unauthorized.*api/i,
      /401.*unauthorized/i,
      /authentication.*failed/i,
      /api.?key.*invalid/i,
      /Incorrect API key/i,
    ],
    diagnosis: 'API Key 无效或格式错误',
    recovery: [
      {
        tool: 'read_file',
        description: '读取项目的 .claude/settings.json 确认当前配置',
        params: { file_path: '{project}/.claude/settings.json', max_lines: 50 },
      },
      {
        tool: 'write_file',
        description: '用正确的 API Key 重写 settings.json（参考 search_knowledge 获取对应 API 的配置格式）',
        params: { file_path: '{project}/.claude/settings.json' },
      },
      {
        tool: 'stop_projects',
        description: '停掉项目终端',
        params: { project_paths: ['{project}'] },
      },
      {
        tool: 'wake_projects',
        description: '重新唤醒项目终端（新配置生效）',
        params: { project_paths: ['{project}'] },
      },
    ],
  },
  {
    id: 'config-bad-base-url',
    category: 'CONFIG',
    patterns: [
      /Could not resolve host/i,
      /ENOTFOUND/i,
      /getaddrinfo/i,
      /name resolution/i,
      /DNS/,
      /connect ECONNREFUSED/i,
      /Connection refused/i,
    ],
    diagnosis: 'Base URL 不可达（DNS 解析失败或连接被拒）',
    recovery: [
      {
        tool: 'shell_exec',
        description: '验证网络连通性',
        params: { command: 'ping -n 1 {hostname}' },
      },
      {
        tool: 'read_file',
        description: '检查 .claude/settings.json 中的 ANTHROPIC_BASE_URL',
        params: { file_path: '{project}/.claude/settings.json', max_lines: 50 },
      },
      {
        tool: 'write_file',
        description: '修正 Base URL（参考 search_knowledge 获取正确的 endpoint 地址）',
      },
    ],
  },
  {
    id: 'config-model-not-found',
    category: 'CONFIG',
    patterns: [
      /model.*not.*found/i,
      /model.*does.*not.*exist/i,
      /invalid.*model/i,
      /unknown.*model/i,
      /404.*model/i,
    ],
    diagnosis: '模型名不存在或拼写错误',
    recovery: [
      {
        tool: 'read_file',
        description: '检查 .claude/settings.json 中的 ANTHROPIC_MODEL',
        params: { file_path: '{project}/.claude/settings.json', max_lines: 50 },
      },
      {
        tool: 'search_knowledge',
        description: '搜索 API 配方获取正确的模型名',
        params: { query: '模型名' },
      },
      {
        tool: 'write_file',
        description: '写入正确的模型名',
      },
    ],
  },

  // -- 权限阻塞 --
  {
    id: 'perm-proceed-dialog',
    category: 'PERMISSION',
    patterns: [
      /Do you want to proceed/i,
      /Proceed\?/i,
      /Continue\?/i,
    ],
    diagnosis: 'Bash 命令执行权限确认对话框',
    recovery: [
      {
        tool: 'write_to_pty',
        description: '发送 "1" 选择 Yes，放行命令',
        params: { project_path: '{project}', data: '1' },
      },
    ],
  },
  {
    id: 'perm-api-key-dialog',
    category: 'PERMISSION',
    patterns: [
      /Do you want to use this API key/i,
      /API key.*\?/i,
      /Use this API/i,
    ],
    diagnosis: 'API Key 使用确认对话框',
    recovery: [
      {
        tool: 'write_to_pty',
        description: '发送 "1" 选择 Yes，确认使用',
        params: { project_path: '{project}', data: '1' },
      },
    ],
  },
  {
    id: 'perm-trust-dialog',
    category: 'PERMISSION',
    patterns: [
      /trust this folder/i,
      /Quick safety check/i,
      /safety check/i,
    ],
    diagnosis: '文件夹信任确认对话框',
    recovery: [
      {
        tool: 'write_to_pty',
        description: '发送 Enter 确认信任',
        params: { project_path: '{project}', data: '' },
      },
      {
        tool: 'write_file',
        description: '可选：写入 hasTrustDialogAccepted: true 跳过未来确认',
        params: { file_path: '{project}/.claude/settings.json' },
      },
    ],
  },
  {
    id: 'perm-auto-update-dialog',
    category: 'PERMISSION',
    patterns: [
      /Auto-update failed/i,
      /auto.?update/i,
      /update.*failed/i,
    ],
    diagnosis: '自动更新失败提示（阻塞启动）',
    recovery: [
      {
        tool: 'write_to_pty',
        description: '发送 Enter 跳过更新',
        params: { project_path: '{project}', data: '' },
      },
    ],
  },

  // -- 网络错误 --
  {
    id: 'network-timeout',
    category: 'NETWORK',
    patterns: [
      /timeout/i,
      /timed.?out/i,
      /ETIMEDOUT/i,
      /connect ETIMEDOUT/i,
    ],
    diagnosis: '网络连接超时',
    recovery: [
      {
        tool: 'shell_exec',
        description: '测试网络连通性',
        params: { command: 'ping -n 2 {hostname}' },
      },
      {
        tool: 'shell_exec',
        description: '检查代理设置',
        params: { command: 'set | findstr /i proxy' },
      },
    ],
  },

  // -- 项目错误 --
  {
    id: 'project-package-json-broken',
    category: 'PROJECT',
    patterns: [
      /package\.json.*error/i,
      /Cannot find module/i,
      /MODULE_NOT_FOUND/i,
      /npm.*ERR/i,
    ],
    diagnosis: '项目依赖或 package.json 问题',
    recovery: [
      {
        tool: 'task_project',
        description: '让项目 AI 修复自己的依赖问题',
        params: { project_path: '{project}', task: '请检查 package.json 和 node_modules，修复依赖问题。先运行 npm install，如有错误请修复。' },
      },
    ],
  },
  {
    id: 'project-dead-loop',
    category: 'PROJECT',
    patterns: [
      /(.)\1{100,}/,  // 连续重复字符 100+ → 死循环
    ],
    diagnosis: '检测到死循环输出（终端连续重复字符）',
    recovery: [
      {
        tool: 'write_to_pty',
        description: '发送 Ctrl+C 中断项目 AI',
        params: { project_path: '{project}', data: '\\x03' },
      },
      {
        tool: 'task_project',
        description: '重新派发任务（用更明确的指令）',
        params: { project_path: '{project}', task: '之前的操作陷入了循环。请用不同的方式重新完成：{task}' },
      },
    ],
  },
]

// ====== 查询接口 ======

export function searchKnowledge(query: string): {
  recipes: ApiRecipe[]
  errors: ErrorPattern[]
  summary: string
} {
  const q = query.toLowerCase()
  const matchedRecipes = API_RECIPES.filter(r =>
    r.tags.some(t => q.includes(t.toLowerCase())) ||
    r.name.toLowerCase().includes(q) ||
    r.diagnosticSigns.some(s => s.toLowerCase().includes(q))
  )
  const matchedErrors = ERROR_PATTERNS.filter(e =>
    e.category.toLowerCase().includes(q) ||
    e.diagnosis.toLowerCase().includes(q) ||
    e.id.toLowerCase().includes(q) ||
    e.patterns.some(p => q.toLowerCase().includes(p.source.toLowerCase()))
  )

  const parts: string[] = []
  if (matchedRecipes.length > 0) {
    parts.push(`## API 配置配方 (${matchedRecipes.length} 条)`)
    for (const r of matchedRecipes) {
      parts.push(`### ${r.name}`)
      parts.push(`标签: ${r.tags.join(', ')}`)
      parts.push(`症状: ${r.diagnosticSigns.join('; ')}`)
      parts.push('settings.json:')
      parts.push('```json')
      parts.push(JSON.stringify(r.settingsJson, null, 2))
      parts.push('```')
      if (r.envVars) {
        parts.push('环境变量:')
        for (const [k, v] of Object.entries(r.envVars)) {
          parts.push(`  ${k}=${v}`)
        }
      }
      parts.push(`备注: ${r.notes}`)
      parts.push('')
    }
  }
  if (matchedErrors.length > 0) {
    parts.push(`## 错误诊断模式 (${matchedErrors.length} 条)`)
    for (const e of matchedErrors) {
      parts.push(`### [${e.category}] ${e.diagnosis}`)
      parts.push(`匹配模式: ${e.patterns.map(p => p.source).join(' | ')}`)
      parts.push('恢复步骤:')
      for (const step of e.recovery) {
        parts.push(`  1. ${step.tool} — ${step.description}`)
      }
      parts.push('')
    }
  }
  if (parts.length === 0) {
    parts.push('未找到匹配的知识条目。尝试用更通用的关键词搜索（如 "deepseek", "api", "配置", "阻塞", "网络", "权限"）。')
  }

  return {
    recipes: matchedRecipes,
    errors: matchedErrors,
    summary: parts.join('\n'),
  }
}

/** 根据终端输出文本匹配错误模式，返回诊断列表 */
export function diagnoseErrors(terminalOutput: string): Array<{ pattern: ErrorPattern; match: string }> {
  const results: Array<{ pattern: ErrorPattern; match: string }> = []
  for (const ep of ERROR_PATTERNS) {
    for (const regex of ep.patterns) {
      const m = terminalOutput.match(regex)
      if (m) {
        results.push({ pattern: ep, match: m[0] })
        break // 只记录第一个匹配
      }
    }
  }
  return results
}

/** 列出所有可用的 API 配方（不搜索，全量） */
export function listAllRecipes(): ApiRecipe[] {
  return [...API_RECIPES]
}

/** 列出所有错误模式 */
export function listAllErrorPatterns(): ErrorPattern[] {
  return [...ERROR_PATTERNS]
}
