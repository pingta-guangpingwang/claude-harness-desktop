// 驾驭智能体 — Document-to-Skill 管道
// 借鉴 Kimi K2.6 Document-to-Skill 模式
// 扫描项目目录下的知识库文件(.md) → 提取为结构化的"技能卡片" → 角色加载时按需注入

import * as fs from 'fs'
import * as path from 'path'
import { estimateTokens } from './tokenBudget.js'

// ---- 类型定义 ----

export interface SkillCard {
  id: string
  sourceFile: string
  projectPath: string
  title: string
  category: 'coding' | 'devops' | 'review' | 'domain' | 'docs'
  summary: string           // 一句话描述 (~50 tokens)
  knowledgeSnippet: string  // 详细知识片段 (~200 tokens)
  applicableRoles: string[]    // ['worker', 'reviewer', ...]
  tags: string[]
  lastUpdated: string
}

// ---- 知识库文件匹配模式 ----

const KNOWLEDGE_FILE_PATTERNS = [
  '.dbvs-horsefarm-notes.md',
  '.dbvs-knowledge.md',
  '.dbvs-project-config.json',
  '.claude/settings.json',
  'README.md',
  'docs/*.md',
  '*.code-workspace',
]

// ---- DocToSkillLoader ----

export class DocToSkillLoader {
  private cache: Map<string, { mtime: number; cards: SkillCard[] }> = new Map()

  /**
   * 扫描项目目录下的知识库文件
   * 每个匹配文件 → 低成本提取 → SkillCard → 缓存
   */
  async scanProject(projectPath: string): Promise<SkillCard[]> {
    // 先检查缓存
    const cached = this.cache.get(projectPath)
    if (cached) {
      // 快速检查是否有文件修改
      const stillFresh = this.checkFreshness(projectPath, cached.mtime)
      if (stillFresh) return cached.cards
    }

    const cards: SkillCard[] = []

    try {
      for (const pattern of KNOWLEDGE_FILE_PATTERNS) {
        if (pattern.includes('*')) {
          // Glob 匹配
          const dir = path.join(projectPath, path.dirname(pattern))
          const glob = path.basename(pattern)
          try {
            const files = fs.readdirSync(dir)
            for (const file of files) {
              if (this.matchGlob(file, glob)) {
                const card = await this.extractFromFile(path.join(dir, file), projectPath)
                if (card) cards.push(card)
              }
            }
          } catch { /* dir not found */ }
        } else {
          // 精确匹配
          const filePath = path.join(projectPath, pattern)
          const card = await this.extractFromFile(filePath, projectPath)
          if (card) cards.push(card)
        }
      }
    } catch { /* scan errors are non-fatal */ }

    // 缓存
    this.cache.set(projectPath, {
      mtime: Date.now(),
      cards,
    })

    return cards
  }

  /** 按角色标签匹配技能卡片 */
  getSkillsForRole(roleId: string, projectPath?: string): SkillCard[] {
    const allCards: SkillCard[] = []

    if (projectPath) {
      const cached = this.cache.get(projectPath)
      if (cached) allCards.push(...cached.cards)
    } else {
      for (const [, cached] of this.cache) {
        allCards.push(...cached.cards)
      }
    }

    return allCards.filter(card =>
      card.applicableRoles.includes(roleId) || card.applicableRoles.length === 0
    )
  }

  /** 获取所有技能卡片 */
  getAllCards(): SkillCard[] {
    const all: SkillCard[] = []
    for (const [, cached] of this.cache) {
      all.push(...cached.cards)
    }
    return all
  }

  /** 格式化技能卡片为 LLM 可注入的文本 */
  formatCardsForInjection(cards: SkillCard[], maxTokens: number = 500): string {
    if (cards.length === 0) return ''

    const parts: string[] = ['[项目技能知识]']
    let usedTokens = 0

    for (const card of cards) {
      const text = `- **${card.title}** [${card.category}]: ${card.summary}`
      const t = estimateTokens(text)
      if (usedTokens + t > maxTokens) break
      parts.push(text)
      usedTokens += t
    }

    return parts.join('\n')
  }

  /** 清除缓存 */
  clearCache(): void {
    this.cache.clear()
  }

  // ---- Private ----

  private async extractFromFile(filePath: string, projectPath: string): Promise<SkillCard | null> {
    try {
      if (!fs.existsSync(filePath)) return null

      const stat = fs.statSync(filePath)
      const content = fs.readFileSync(filePath, 'utf-8')

      // 提取标题（第一个 # heading 或文件名）
      const titleMatch = content.match(/^#\s+(.+)$/m)
      const title = titleMatch ? titleMatch[1].trim() : path.basename(filePath, path.extname(filePath))

      // 提取摘要（第一个段落或前 200 字符）
      const textContent = content.replace(/^#.*$/gm, '').replace(/```[\s\S]*?```/g, '').trim()
      const summary = textContent.split('\n\n')[0]?.slice(0, 200) || textContent.slice(0, 200)

      // 推断类别
      const category = this.inferCategory(filePath, content)

      // 推断适用角色
      const applicableRoles = this.inferRoles(filePath, content)

      // 提取标签
      const tags = this.extractTags(filePath, content, title)

      return {
        id: this.hashPath(filePath),
        sourceFile: filePath,
        projectPath,
        title,
        category,
        summary: summary.slice(0, 200),
        knowledgeSnippet: textContent.slice(0, 500),
        applicableRoles,
        tags,
        lastUpdated: stat.mtime.toISOString(),
      }
    } catch {
      return null
    }
  }

  private inferCategory(filePath: string, _content: string): SkillCard['category'] {
    const base = path.basename(filePath).toLowerCase()
    if (base.includes('readme')) return 'docs'
    if (base.includes('note') || base.includes('knowledge')) return 'domain'
    if (base.includes('settings') || base.includes('config')) return 'devops'
    if (base.includes('workspace') || base.includes('project')) return 'coding'
    return 'domain'
  }

  private inferRoles(filePath: string, _content: string): string[] {
    const base = path.basename(filePath).toLowerCase()
    if (base.includes('note') || base.includes('readme')) return ['ceo', 'worker', 'diagnostician']
    if (base.includes('settings') || base.includes('config')) return ['ceo', 'diagnostician']
    if (base.includes('knowledge')) return ['ceo', 'worker', 'reviewer', 'diagnostician']
    return []
  }

  private extractTags(filePath: string, _content: string, title: string): string[] {
    const tags: string[] = []
    const base = path.basename(filePath).toLowerCase()
    if (base.includes('note')) tags.push('notes', 'project-notes')
    if (base.includes('knowledge')) tags.push('knowledge-base', 'domain')
    if (base.includes('settings')) tags.push('configuration', 'api')
    if (base.includes('readme')) tags.push('documentation', 'readme')
    tags.push(path.basename(path.dirname(filePath)))
    tags.push(title.toLowerCase().split(/\s+/)[0])
    return [...new Set(tags)]
  }

  private checkFreshness(projectPath: string, cachedMtime: number): boolean {
    // 如果在 10 秒内，认为仍然新鲜
    return (Date.now() - cachedMtime) < 10_000
  }

  private matchGlob(filename: string, glob: string): boolean {
    if (glob === '*.md') return filename.endsWith('.md')
    if (glob === '*.json') return filename.endsWith('.json')
    return filename === glob
  }

  private hashPath(filePath: string): string {
    let hash = 0
    for (let i = 0; i < filePath.length; i++) {
      hash = ((hash << 5) - hash) + filePath.charCodeAt(i)
      hash |= 0
    }
    return hash.toString(36)
  }
}
