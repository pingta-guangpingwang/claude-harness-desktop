// 分面分类体系 — 加载 taxonomy.json 并提供编码/标签双向查询

import * as fs from 'fs'
import * as path from 'path'

export interface FacetValue {
  code: string
  label: string
  parents: string[]
  aliases: string[]
  status?: string
}

export interface FacetDef {
  prefix: string
  label: string
  labelEn: string
  multi: boolean
  description: string
  allowCustom?: boolean
  customFormat?: string
  values: FacetValue[]
}

export interface TaxonomyData {
  version: string
  updated: string
  description: string
  facets: Record<string, FacetDef>
}

export interface ResourceFacets {
  occupation?: string[]
  skill?: string[]
  knowledge?: string[]
  transversal?: string[]
  format?: string
  level?: string
  [key: string]: any
}

const DEFAULT_TAXONOMY: TaxonomyData = {
  version: '0.0.0',
  updated: '',
  description: '',
  facets: {},
}

class TaxonomyStore {
  private data: TaxonomyData = DEFAULT_TAXONOMY
  private codeIndex: Map<string, FacetValue> = new Map()
  private aliasIndex: Map<string, string> = new Map()

  constructor() {
    this.load()
  }

  load(): void {
    try {
      // 优先读项目自带的种子文件
      const seedPath = path.join(__dirname, '..', 'config', 'taxonomy.json')
      // 也检查 APPDATA 是否有更新版本
      const appData = process.env.APPDATA || path.join(process.env.HOME || '.', 'AppData', 'Roaming')
      const userPath = path.join(appData, 'dbghf', 'taxonomy.json')

      let raw: string | null = null
      if (fs.existsSync(userPath)) {
        raw = fs.readFileSync(userPath, 'utf-8')
      } else if (fs.existsSync(seedPath)) {
        raw = fs.readFileSync(seedPath, 'utf-8')
      }

      if (raw) {
        this.data = JSON.parse(raw) as TaxonomyData
        this.buildIndex()
        console.log('[taxonomyStore] load, version:', this.data.version, ', facets:', Object.keys(this.data.facets).length)
      }
    } catch (e) {
      console.error('[taxonomyStore] load failed:', e)
    }
  }

  private buildIndex(): void {
    this.codeIndex.clear()
    this.aliasIndex.clear()
    for (const [, facet] of Object.entries(this.data.facets)) {
      for (const v of facet.values) {
        this.codeIndex.set(v.code, v)
        for (const alias of v.aliases) {
          this.aliasIndex.set(alias.toLowerCase(), v.code)
        }
        this.aliasIndex.set(v.label.toLowerCase(), v.code)
      }
    }
  }

  getVersion(): string { return this.data.version }

  getFacets(): Record<string, FacetDef> { return this.data.facets }

  getFacet(name: string): FacetDef | undefined { return this.data.facets[name] }

  getFacetNames(): string[] { return Object.keys(this.data.facets) }

  /** 编码 → 标签 */
  getLabel(code: string): string {
    return this.codeIndex.get(code)?.label || code
  }

  /** 批量编码 → 标签 */
  getLabels(codes: string[]): string[] {
    return codes.map(c => this.getLabel(c))
  }

  /** 别名 → 编码 */
  resolveAlias(alias: string): string | undefined {
    return this.aliasIndex.get(alias.toLowerCase())
  }

  /** 获取某个维度的所有可选值 */
  getValues(facetName: string): FacetValue[] {
    return this.data.facets[facetName]?.values || []
  }

  /** 将编码展开为可读文本（用于向量搜索/展示） */
  expand(facets: ResourceFacets): string {
    const parts: string[] = []
    for (const [name, codes] of Object.entries(facets)) {
      if (!codes || codes.length === 0) continue
      const facet = this.data.facets[name]
      if (!facet) continue
      const arr = Array.isArray(codes) ? codes : [codes]
      const labels = arr.map(c => this.getLabel(c)).filter(Boolean)
      if (labels.length > 0) {
        parts.push(`${facet.label}:${labels.join(',')}`)
      }
    }
    return parts.join(' ')
  }

  /** 获取某个维度下指定编码的子节点 */
  getChildren(facetName: string, parentCode: string): FacetValue[] {
    const facet = this.data.facets[facetName]
    if (!facet) return []
    return facet.values.filter(v => v.parents.includes(parentCode))
  }

  /** 获取某个维度的根节点（无 parents 或 parents 为空） */
  getRoots(facetName: string): FacetValue[] {
    const facet = this.data.facets[facetName]
    if (!facet) return []
    return facet.values.filter(v => !v.parents || v.parents.length === 0)
  }

  /** 将 facets 编码转换为标签展示结构 */
  resolve(facets: ResourceFacets | null | undefined): Record<string, { label: string; values: Array<{ code: string; label: string }> }> {
    const result: Record<string, { label: string; values: Array<{ code: string; label: string }> }> = {}
    if (!facets) return result
    for (const [name, def] of Object.entries(this.data.facets)) {
      const codes = facets[name]
      if (!codes) continue
      const arr = Array.isArray(codes) ? codes : [codes]
      if (arr.length === 0) continue
      const isGeneric = (c: string) => c === 'S000' || c === 'T000' || c === 'K000' || c === 'O000' || c === 'F000' || c === 'L000'
      if (arr.length === 1 && isGeneric(arr[0])) continue
      const values = arr.filter(c => !c.endsWith('000')).map(c => ({ code: c, label: this.getLabel(c) }))
      if (values.length > 0) {
        result[name] = { label: def.label, values }
      }
    }
    return result
  }
}

export const taxonomyStore = new TaxonomyStore()
