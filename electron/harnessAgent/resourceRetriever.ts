// 资源检索接口 — 供驾驭智能体上下文管线和工具层调用
// 独立模块，非侵入式：有资源则注入参考，无资源则静默跳过

import type { ContextProcessor, ContextView } from './contextPipeline.js'
import type { AgentContext } from './types.js'
import { resourceStore, type ResourceItem, type QueryParams } from '../modules/resourceStore.js'
import { estimateTokens } from './tokenBudget.js'
import { getAllTools } from './toolRegistry.js'
import type { AgentTool, ToolResult } from './types.js'

// ---- 上下文管线 Processor ----

export const ResourceInjectorProcessor: ContextProcessor = (view, ctx) => {
  // 未初始化 → 静默跳过
  if (!resourceStore.isInitialized()) return view

  // 无任务描述 → 跳过
  const task = extractTaskFromContext(ctx)
  if (!task) return view

  try {
    const resources = resourceStore.queryResources({
      query: task,
      maxResults: 5,
      minScore: 3.0,
    })

    if (resources.length === 0) return view

    let ref = '\n## 参考资源仓库匹配结果\n'
    ref += '以下资源与当前开发任务相关，可发送给项目 AI 作为参考：\n\n'
    for (const r of resources) {
      ref += `- **${r.name}** (${r.type === 'prompt' ? '提示词' : r.type === 'template' ? '模板' : r.type === 'case' ? '案例' : '工具'}, ⭐${r.score})\n`
      ref += `  摘要: ${r.summary}\n`
      if (r.source_url) ref += `  地址: ${r.source_url}\n`
    }
    ref += '\n请在开发时参照以上资源的代码规范、设计思路和实现方式。'

    view.systemPromptParts.push(ref)
    view.estimatedTokens += estimateTokens(ref)
  } catch {
    // 任何异常都静默跳过，不影响主流程
  }

  return view
}

/** 从上下文中提取任务描述 */
function extractTaskFromContext(ctx: AgentContext): string | null {
  // 优先使用显式任务描述
  if ((ctx as any).currentTask) return (ctx as any).currentTask
  // 从最近的用户消息中提取
  const messages = (ctx as any).messages
  if (messages && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return messages[i].content.slice(0, 500)
      }
    }
  }
  return null
}

// ---- 可导出的检索函数（供工具层调用） ----

/** 格式化检索结果给 LLM */
export function formatSearchResults(resources: ResourceItem[]): string {
  if (resources.length === 0) return '未找到匹配的资源。'

  const lines: string[] = [`找到 ${resources.length} 个匹配资源：`, '']
  for (const r of resources) {
    lines.push(`### ${r.name}`)
    lines.push(`- 类型: ${r.type} | 分类: ${r.category} | 评分: ⭐${r.score}`)
    lines.push(`- 摘要: ${r.summary}`)
    if (r.source_url) lines.push(`- 地址: ${r.source_url}`)
    if (r.tech_stack?.length) lines.push(`- 技术栈: ${r.tech_stack.join(', ')}`)
    if (r.style_tags?.length) lines.push(`- 风格: ${r.style_tags.join(', ')}`)
    lines.push('')
  }
  return lines.join('\n')
}

/** 列出资源摘要 */
export function formatResourceList(resources: ResourceItem[]): string {
  if (resources.length === 0) return '暂无资源。'

  const lines: string[] = [`共 ${resources.length} 个资源：`, '']
  for (const r of resources) {
    lines.push(`- [${r.type}] **${r.name}** (${r.category}) ⭐${r.score} — ${r.summary.slice(0, 80)}`)
  }
  return lines.join('\n')
}

// ---- Agent 工具定义 ----

/** search_resources 工具 */
export const searchResourcesTool: AgentTool = {
  name: 'search_resources',
  description: '在本地资源仓库（提示词库/模板案例库/组件工具库）中检索与开发需求匹配的参考资源。返回匹配的 GitHub 项目链接、提示词模板、工具推荐等。当用户需要开发新功能但缺乏参考时，优先使用此工具查询。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '检索关键词，如"数据看板 React 图表"或"登录页面设计"' },
      resource_type: { type: 'string', description: '资源类型筛选: all(全部), prompt(提示词), template(模板), case(案例), plugin(插件), tool(工具), skill(技能)' },
      max_results: { type: 'number', description: '最大返回数，默认 5，最大 10' },
    },
  },
  group: 'read',
  isReadOnly: true,
  isConcurrencySafe: true,
  isDestructive: false,
  async execute(params): Promise<ToolResult> {
    const query = (params.query as string) || ''
    const resourceType = (params.resource_type as string) || 'all'
    const maxResults = Math.min(params.max_results as number || 5, 10)

    if (!resourceStore.isInitialized()) {
      return { success: true, output: '资源仓库未初始化。请先在资源市场面板中同步官方仓库。' }
    }

    const resources = resourceStore.queryResources({
      query,
      type: resourceType === 'all' ? undefined : resourceType,
      maxResults,
      minScore: 0,
    })

    return { success: true, output: formatSearchResults(resources) }
  },
}

/** add_resource 工具 — 用户手动添加资源 */
export const addResourceTool: AgentTool = {
  name: 'add_resource',
  description: '将优质提示词、项目地址、工具/Skill 等添加到本地资源仓库。用户输入可以是任意格式的自由文本，系统会自动提取关键信息并标准化。添加后用户可在资源市场面板中查看和提交贡献。',
  parameters: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: '目标仓库: DeepBluePrompt(提示词), DeepBlueCase(模板案例), DeepBlueKit(组件工具)' },
      resource_type: { type: 'string', description: '资源类型: prompt, template, case, plugin, tool, skill' },
      name: { type: 'string', description: '资源名称' },
      content: { type: 'string', description: '资源内容：提示词正文、项目介绍、工具描述等' },
      source_url: { type: 'string', description: '来源地址（GitHub/npm/其他）' },
      category: { type: 'string', description: '分类标签' },
      tech_stack: { type: 'array', items: { type: 'string' }, description: '技术栈列表' },
    },
    required: ['repo', 'resource_type', 'name', 'content'],
  },
  group: 'read',
  isReadOnly: false,
  isConcurrencySafe: true,
  isDestructive: false,
  async execute(params): Promise<ToolResult> {
    const repo = params.repo as string
    const validRepos = ['DeepBluePrompt', 'DeepBlueCase', 'DeepBlueKit']
    if (!validRepos.includes(repo)) {
      return { success: false, output: `无效仓库: ${repo}。可用: ${validRepos.join(', ')}` }
    }

    if (!resourceStore.isInitialized()) {
      return { success: false, output: '资源仓库未初始化。请先在资源市场面板中同步官方仓库。' }
    }

    const id = `${(params.resource_type as string).slice(0, 6)}-user-${Date.now().toString(36)}`
    const result = await resourceStore.addResource({
      id,
      name: params.name as string,
      type: params.resource_type as string,
      category: (params.category as string) || 'other',
      tech_stack: (params.tech_stack as string[]) || [],
      style_tags: [],
      use_cases: [],
      score: 3.0,
      rating_count: 0,
      usage_count: 0,
      source_url: (params.source_url as string) || '',
      summary: (params.content as string).slice(0, 200),
      repo: repo as any,
      content: params.content as string,
    }, repo as any)

    if (result.success) {
      return { success: true, output: `资源已添加到本地仓库: ${result.path}\n\n用户可在资源市场面板中查看和提交贡献。` }
    }
    return { success: false, output: '添加失败，请检查仓库是否已初始化。' }
  },
}

/** list_resources 工具 */
export const listResourcesTool: AgentTool = {
  name: 'list_resources',
  description: '列出本地资源仓库中的全部资源摘要。支持按仓库、类型、分类筛选。',
  parameters: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: '仓库筛选: DeepBluePrompt, DeepBlueCase, DeepBlueKit。不填则列出全部。' },
      resource_type: { type: 'string', description: '类型筛选: prompt, template, case, plugin, tool, skill' },
      category: { type: 'string', description: '分类筛选' },
    },
  },
  group: 'read',
  isReadOnly: true,
  isConcurrencySafe: true,
  isDestructive: false,
  async execute(params): Promise<ToolResult> {
    if (!resourceStore.isInitialized()) {
      return { success: true, output: '资源仓库未初始化。' }
    }

    const resources = resourceStore.filterResources({
      repo: params.repo as any,
      type: params.resource_type as string,
      category: params.category as string,
    })

    return { success: true, output: formatResourceList(resources.slice(0, 30)) }
  },
}

// ---- 待审核资源工具 (P4) ----

/** suggest_resource — AI 将发现的外部资源提交到待审核列表 */
export const suggestResourceTool: AgentTool = {
  name: 'suggest_resource',
  description: '将发现的优质外部资源提交到待审核列表，而非直接写入仓库。用于：1) 本地仓库搜索无匹配后从外部发现的资源；2) 用户对本地参考结果不满意时找到的替代资源；3) 用户主动提供的项目地址。资源会进入审核队列，用户审核通过后才会入库。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '资源名称，简洁明了' },
      resource_type: { type: 'string', description: '资源类型: prompt, template, case, plugin, tool, skill' },
      target_repo: { type: 'string', description: '目标仓库: DeepBluePrompt(提示词), DeepBlueCase(模板案例), DeepBlueKit(组件工具)' },
      category: { type: 'string', description: '分类标签，如 react, database, devops 等' },
      tech_stack: { type: 'array', items: { type: 'string' }, description: '技术栈列表' },
      source_url: { type: 'string', description: '来源 URL（GitHub/npm/官网）' },
      summary: { type: 'string', description: '资源摘要，100-300字，说明用途和亮点' },
      raw_content: { type: 'string', description: '完整资源内容：提示词正文 / 项目介绍 / 工具描述等' },
    },
    required: ['name', 'resource_type', 'target_repo', 'summary'],
  },
  group: 'read',
  isReadOnly: false,
  isConcurrencySafe: true,
  isDestructive: false,
  async execute(params): Promise<ToolResult> {
    const { pendingResourceStore } = await import('../modules/pendingResourceStore.js')
    const id = `pend-${Date.now().toString(36)}`
    pendingResourceStore.addItem({
      id,
      name: params.name as string,
      resourceType: params.resource_type as string,
      targetRepo: params.target_repo as string,
      category: (params.category as string) || 'other',
      techStack: (params.tech_stack as string[]) || [],
      sourceUrl: (params.source_url as string) || '',
      summary: params.summary as string,
      rawContent: (params.raw_content as string) || '',
      status: 'pending',
      auditScore: 0,
      auditNotes: '',
      formattedContent: '',
      auditedAt: '',
      createdAt: new Date().toISOString(),
    })
    return { success: true, output: `资源 "${params.name}" 已添加到待审核列表 (ID: ${id})。用户可在资源市场面板中审核和批准入库。` }
  },
}

/** read_pending_resources — AI 读取待审核列表 */
export const readPendingResourcesTool: AgentTool = {
  name: 'read_pending_resources',
  description: '读取待审核资源列表，返回所有状态为 pending 的条目及其完整信息。用于用户要求审核资源时，AI 需要先获取列表再进行逐条评估。',
  parameters: {
    type: 'object',
    properties: {},
  },
  group: 'read',
  isReadOnly: true,
  isConcurrencySafe: true,
  isDestructive: false,
  async execute(): Promise<ToolResult> {
    const { pendingResourceStore } = await import('../modules/pendingResourceStore.js')
    const items = pendingResourceStore.getItemsByStatus('pending')
    if (items.length === 0) {
      return { success: true, output: '当前没有待审核的资源。' }
    }
    const lines = items.map((item, i) =>
      `### ${i + 1}. ${item.name} (ID: ${item.id})
- 类型: ${item.resourceType} | 目标仓库: ${item.targetRepo} | 分类: ${item.category}
- 技术栈: ${item.techStack.join(', ') || '无'}
- 来源: ${item.sourceUrl || '无'}
- 摘要: ${item.summary}
- 原始内容:
\`\`\`
${item.rawContent.slice(0, 3000)}
\`\`\`
`
    )
    return { success: true, output: `共 ${items.length} 条待审核资源：\n\n${lines.join('\n')}\n请逐条评估后调用 update_pending_item 写入审核结果。` }
  },
}

/** update_pending_item — AI 写入单条审核结果 */
export const updatePendingItemTool: AgentTool = {
  name: 'update_pending_item',
  description: '对单条待审资源写入审核结果。包括质量评分(0-10)、审核评语、以及标准化的资源文件内容（YAML frontmatter + 正文）。调用 read_pending_resources 获取列表后，对每条资源依次调用本工具。评分 >=7 为推荐批准，4-6 为可批准但需改进，<4 为建议拒绝。',
  parameters: {
    type: 'object',
    properties: {
      item_id: { type: 'string', description: '待审资源的 ID' },
      audit_score: { type: 'number', description: '质量评分 0-10' },
      audit_notes: { type: 'string', description: '审核评语：质量评估、分类确认、格式检查、改进建议' },
      formatted_content: { type: 'string', description: '标准化的完整资源文件内容。必须包含 YAML frontmatter (以 --- 分隔) + Markdown 正文。frontmatter 必含字段: name, id, type, category, score, summary, source_url, tech_stack' },
      corrected_name: { type: 'string', description: '修正后的名称（若原名称不当）' },
      corrected_category: { type: 'string', description: '修正后的分类（若原分类不当）' },
    },
    required: ['item_id', 'audit_score', 'audit_notes', 'formatted_content'],
  },
  group: 'read',
  isReadOnly: false,
  isConcurrencySafe: true,
  isDestructive: false,
  async execute(params): Promise<ToolResult> {
    const { pendingResourceStore } = await import('../modules/pendingResourceStore.js')
    const itemId = params.item_id as string
    const item = pendingResourceStore.getItem(itemId)
    if (!item) return { success: false, output: `未找到待审资源: ${itemId}` }

    const updates: Record<string, any> = {
      status: 'audited',
      auditScore: (params.audit_score as number) || 5.0,
      auditNotes: (params.audit_notes as string) || '',
      formattedContent: (params.formatted_content as string) || '',
      auditedAt: new Date().toISOString(),
    }
    if (params.corrected_name) updates.name = params.corrected_name as string
    if (params.corrected_category) updates.category = params.corrected_category as string

    pendingResourceStore.updateItem(itemId, updates)
    const score = updates.auditScore
    const verdict = score >= 7 ? '推荐批准' : score >= 4 ? '可批准（需改进）' : '建议拒绝'
    return { success: true, output: `已审核: ${item.name} | 评分: ${score}/10 | 评定: ${verdict}` }
  },
}
