import { useState, useMemo } from 'react'

interface Template {
  id: string
  name: string
  category: string
  description: string
  tags: string[]
}

const BUILTIN_TEMPLATES: Template[] = [
  // 项目脚手架
  { id: 'react-vite-ts', name: 'React + Vite + TS', category: 'scaffold', description: '现代化的 React 项目脚手架，集成 Vite 和 TypeScript', tags: ['react', 'vite', 'typescript'] },
  { id: 'electron-react', name: 'Electron + React', category: 'scaffold', description: 'Electron 桌面应用模板，包含 React 渲染进程', tags: ['electron', 'react', 'desktop'] },
  { id: 'next-app-router', name: 'Next.js App Router', category: 'scaffold', description: 'Next.js 14+ App Router 项目模板', tags: ['nextjs', 'react', 'ssr'] },
  { id: 'express-api', name: 'Express API', category: 'scaffold', description: 'RESTful API 服务模板，包含中间件和错误处理', tags: ['express', 'nodejs', 'api'] },
  { id: 'vue3-vite', name: 'Vue 3 + Vite', category: 'scaffold', description: 'Vue 3 Composition API 项目模板', tags: ['vue', 'vite', 'typescript'] },
  // 工作流
  { id: 'ci-check', name: 'CI 检查流程', category: 'workflow', description: '标准 CI 检查：lint → test → build', tags: ['ci', 'automation'] },
  { id: 'deploy-pipeline', name: '部署流水线', category: 'workflow', description: '生产部署：构建 → 测试 → 部署 → 通知', tags: ['deploy', 'pipeline'] },
  // 配置
  { id: 'eslint-prettier', name: 'ESLint + Prettier', category: 'config', description: '标准的 ESLint 和 Prettier 配置', tags: ['lint', 'format', 'code-quality'] },
  { id: 'tsconfig-strict', name: 'TSConfig Strict', category: 'config', description: '严格模式的 TypeScript 配置', tags: ['typescript', 'strict'] },
  { id: 'gitignore-node', name: '.gitignore (Node)', category: 'config', description: 'Node.js 项目标准 .gitignore', tags: ['git', 'ignore'] },
  // 代码片段
  { id: 'react-hook-form', name: 'React Hook 表单', category: 'snippet', description: '带验证的 useForm hook', tags: ['react', 'hook', 'form'] },
  { id: 'error-boundary', name: '错误边界', category: 'snippet', description: 'React Error Boundary 组件', tags: ['react', 'error-handling'] },
]

const CATEGORY_LABELS: Record<string, string> = {
  scaffold: '项目脚手架',
  workflow: '工作流',
  config: '配置模板',
  snippet: '代码片段',
}

export const TemplateLibrary: React.FC = () => {
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let list = BUILTIN_TEMPLATES
    if (categoryFilter) list = list.filter(t => t.category === categoryFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.includes(q))
      )
    }
    return list
  }, [search, categoryFilter])

  const categories = [...new Set(BUILTIN_TEMPLATES.map(t => t.category))]

  return (
    <div style={{ padding: '16px', height: '100%', overflow: 'auto' }}>
      <h3 style={{ margin: '0 0 12px 0', color: '#e0e0e0' }}>模板库</h3>

      {/* 搜索 + 分类过滤 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索模板..."
          style={{
            flex: 1, background: '#16162a', border: '1px solid #444', borderRadius: '6px',
            color: '#e0e0e0', padding: '6px 10px', fontSize: '13px', outline: 'none',
          }}
        />
        <select
          value={categoryFilter || ''}
          onChange={e => setCategoryFilter(e.target.value || null)}
          style={{
            background: '#16162a', border: '1px solid #444', borderRadius: '6px',
            color: '#e0e0e0', padding: '6px 10px', fontSize: '13px', outline: 'none',
          }}
        >
          <option value="">全部分类</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{CATEGORY_LABELS[cat] || cat}</option>
          ))}
        </select>
      </div>

      {/* 模板网格 */}
      {filtered.length === 0 ? (
        <div style={{ color: '#666', textAlign: 'center', padding: '24px' }}>未找到匹配模板</div>
      ) : (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: '10px',
        }}>
          {filtered.map(tmpl => (
            <div key={tmpl.id} style={{
              background: '#1e1e2e', borderRadius: '8px', padding: '14px',
              border: '1px solid #333', display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ marginBottom: '6px' }}>
                <span style={{
                  padding: '1px 6px', borderRadius: '3px', fontSize: '10px',
                  background: '#2a2a3e', color: '#888', textTransform: 'uppercase',
                }}>
                  {CATEGORY_LABELS[tmpl.category] || tmpl.category}
                </span>
              </div>
              <h4 style={{ margin: '0 0 4px 0', color: '#e0e0e0', fontSize: '14px' }}>{tmpl.name}</h4>
              <p style={{ color: '#888', fontSize: '12px', flex: 1, margin: '0 0 8px 0' }}>{tmpl.description}</p>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '10px' }}>
                {tmpl.tags.map(tag => (
                  <span key={tag} style={{
                    padding: '1px 5px', borderRadius: '3px', fontSize: '10px',
                    background: '#16162a', color: '#666',
                  }}>
                    {tag}
                  </span>
                ))}
              </div>
              <button style={{
                background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '4px',
                padding: '6px 0', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
              }}>
                应用模板
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
