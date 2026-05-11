// TemplateEngine — 模板应用引擎
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

interface TemplateDefinition {
  id: string
  name: string
  category: string
  files: Array<{ path: string; content: string }>
  variables?: string[]
}

const BUILTIN_TEMPLATES: Record<string, TemplateDefinition> = {
  'react-vite-ts': {
    id: 'react-vite-ts', name: 'React + Vite + TS', category: 'scaffold',
    files: [
      { path: 'package.json', content: JSON.stringify({ name: '{{projectName}}', private: true, version: '0.0.0', type: 'module', scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' }, dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' }, devDependencies: { '@vitejs/plugin-react': '^4.0.0', typescript: '~5.6.0', vite: '^8.0.0' } }, null, 2) },
      { path: 'tsconfig.json', content: JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler', strict: true, jsx: 'react-jsx' } }, null, 2) },
      { path: 'vite.config.ts', content: "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()],\n})\n" },
      { path: 'src/main.tsx', content: "import React from 'react'\nimport ReactDOM from 'react-dom/client'\nimport App from './App'\n\nReactDOM.createRoot(document.getElementById('root')!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>,\n)\n" },
      { path: 'src/App.tsx', content: "export default function App() {\n  return <h1>{{projectName}}</h1>\n}\n" },
    ],
    variables: ['projectName'],
  },
  'eslint-prettier': {
    id: 'eslint-prettier', name: 'ESLint + Prettier', category: 'config',
    files: [
      { path: '.eslintrc.json', content: JSON.stringify({ extends: ['eslint:recommended'], parserOptions: { ecmaVersion: 'latest', sourceType: 'module' }, env: { node: true, browser: true, es2022: true }, rules: { 'no-unused-vars': 'warn', 'no-console': 'warn' } }, null, 2) },
      { path: '.prettierrc', content: JSON.stringify({ semi: false, singleQuote: true, tabWidth: 2, trailingComma: 'es5', printWidth: 100 }, null, 2) },
    ],
  },
  'tsconfig-strict': {
    id: 'tsconfig-strict', name: 'TSConfig Strict', category: 'config',
    files: [
      { path: 'tsconfig.json', content: JSON.stringify({ compilerOptions: { strict: true, noUncheckedIndexedAccess: true, noImplicitReturns: true, noFallthroughCasesInSwitch: true, forceConsistentCasingInFileNames: true } }, null, 2) },
    ],
  },
  'gitignore-node': {
    id: 'gitignore-node', name: '.gitignore (Node)', category: 'config',
    files: [
      { path: '.gitignore', content: 'node_modules/\ndist/\n.env\n.env.local\n*.log\n.DS_Store\ncoverage/\n' },
    ],
  },
  'ci-check': {
    id: 'ci-check', name: 'CI 检查流程', category: 'workflow',
    files: [
      { path: '.github/workflows/ci.yml', content: 'name: CI\non: [push, pull_request]\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n      - run: npm ci\n      - run: npm run lint\n      - run: npm test\n      - run: npm run build\n' },
    ],
  },
}

export class TemplateEngine {
  /** 获取所有模板摘要（不包含文件内容） */
  getTemplateList(): Array<{ id: string; name: string; category: string; variables?: string[] }> {
    return Object.values(BUILTIN_TEMPLATES).map(t => ({
      id: t.id, name: t.name, category: t.category,
      variables: t.variables,
    }))
  }

  /** 获取模板详情 */
  getTemplate(id: string): TemplateDefinition | null {
    return BUILTIN_TEMPLATES[id] || null
  }

  /** 应用模板到目标目录 */
  applyTemplate(
    templateId: string,
    targetDir: string,
    variables: Record<string, string> = {},
  ): { success: boolean; files: string[]; error?: string } {
    const template = this.getTemplate(templateId)
    if (!template) {
      return { success: false, files: [], error: `模板 ${templateId} 不存在` }
    }

    const created: string[] = []
    try {
      for (const file of template.files) {
        let content = file.content
        // 替换变量
        for (const [key, value] of Object.entries(variables)) {
          content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
        }
        const fullPath = join(targetDir, file.path)
        const dir = fullPath.substring(0, fullPath.lastIndexOf('\\'))
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        writeFileSync(fullPath, content, 'utf-8')
        created.push(file.path)
      }
      return { success: true, files: created }
    } catch (e) {
      return { success: false, files: created, error: String(e) }
    }
  }
}
