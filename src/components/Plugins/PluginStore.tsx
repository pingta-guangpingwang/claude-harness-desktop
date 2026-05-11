import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useI18n } from '../../i18n'

// ── 类型 ──────────────────────────────────────────────────────
type PluginCategory = 'formatter' | 'linter' | 'git' | 'container' | 'api' | 'editor' | 'database' | 'productivity' | 'theme' | 'ai'

type PkgManager = 'npm' | 'pip' | 'pip3' | 'cargo' | 'go' | 'gem' | 'choco' | 'scoop' | 'winget' | 'brew'

interface InstallSpec {
  manager: PkgManager
  package: string
  extraArgs?: string[]
  checkBinary?: string
}

interface PluginProvides {
  type: 'command' | 'ai.tool'
  id: string
  description: string
  commandTemplate?: string
  toolParams?: Record<string, unknown>
}

interface CatalogPlugin {
  id: string
  name: string
  icon: string
  description: string
  descriptionZh: string
  author: string
  version: string
  category: PluginCategory
  rating: number
  downloads: number
  tags: string[]
  install: InstallSpec
  provides: PluginProvides[]
}

// ── 精选插件目录（含真实安装命令） ──────────────────────────
const CATALOG: CatalogPlugin[] = [
  {
    id: 'prettier-plus',
    name: 'Prettier Plus',
    icon: '✨',
    description: 'Opinionated code formatter supporting 50+ languages, configurable with .prettierrc.',
    descriptionZh: '代码格式化工具，支持 50+ 语言，.prettierrc 配置，保存时自动格式化。',
    author: 'Prettier Team',
    version: '3.3.0',
    category: 'formatter',
    rating: 4.9,
    downloads: 38400000,
    tags: ['format', 'prettier', 'style', 'beautify'],
    install: { manager: 'npm', package: 'prettier', extraArgs: [] },
    provides: [
      { type: 'command', id: 'prettier.format', description: '用 Prettier 格式化文件', commandTemplate: 'prettier --write "{file}"' },
      { type: 'command', id: 'prettier.check', description: '检查文件格式', commandTemplate: 'prettier --check "{file}"' },
      { type: 'ai.tool', id: 'format_with_prettier', description: '使用 Prettier 格式化代码文件', commandTemplate: 'prettier --write "{file}"', toolParams: { type: 'object', properties: { file: { type: 'string', description: '要格式化的文件路径' } }, required: ['file'] } },
    ],
  },
  {
    id: 'eslint-ai',
    name: 'ESLint AI',
    icon: '🔍',
    description: 'Pluggable linting utility for JavaScript/TypeScript with auto-fix and custom rules.',
    descriptionZh: 'JS/TS 代码检查工具，自动修复、自定义规则、团队共享配置。',
    author: 'ESLint Community',
    version: '9.8.0',
    category: 'linter',
    rating: 4.8,
    downloads: 29600000,
    tags: ['lint', 'eslint', 'quality', 'fix'],
    install: { manager: 'npm', package: 'eslint', extraArgs: [] },
    provides: [
      { type: 'command', id: 'eslint.lint', description: '运行 ESLint 检查', commandTemplate: 'eslint "{file}"' },
      { type: 'command', id: 'eslint.fix', description: 'ESLint 自动修复', commandTemplate: 'eslint --fix "{file}"' },
      { type: 'ai.tool', id: 'lint_with_eslint', description: '使用 ESLint 检查并修复 JS/TS 代码', commandTemplate: 'eslint --fix "{file}"', toolParams: { type: 'object', properties: { file: { type: 'string', description: '要检查的文件路径' } }, required: ['file'] } },
    ],
  },
  {
    id: 'typescript-official',
    name: 'TypeScript TSC',
    icon: '🔷',
    description: 'TypeScript compiler with type checking, project references, and declaration generation.',
    descriptionZh: 'TypeScript 编译器，类型检查、项目引用、声明文件生成。',
    author: 'Microsoft',
    version: '5.5.0',
    category: 'linter',
    rating: 4.8,
    downloads: 42000000,
    tags: ['typescript', 'tsc', 'typecheck', 'compile'],
    install: { manager: 'npm', package: 'typescript', extraArgs: [] },
    provides: [
      { type: 'command', id: 'tsc.check', description: 'TypeScript 类型检查', commandTemplate: 'tsc --noEmit' },
      { type: 'command', id: 'tsc.build', description: 'TypeScript 编译', commandTemplate: 'tsc' },
      { type: 'ai.tool', id: 'typecheck_tsc', description: '运行 TypeScript 编译器做类型检查', commandTemplate: 'tsc --noEmit', toolParams: { type: 'object', properties: {}, required: [] } },
    ],
  },
  {
    id: 'rimraf-cleaner',
    name: 'RimRaf Cleaner',
    icon: '🧹',
    description: 'Cross-platform rm -rf for cleaning node_modules, dist, .cache directories safely.',
    descriptionZh: '跨平台 rm -rf，安全清理 node_modules、dist、.cache 等目录。',
    author: 'Isaac Z. Schlueter',
    version: '5.0.0',
    category: 'productivity',
    rating: 4.6,
    downloads: 28000000,
    tags: ['clean', 'rm', 'node_modules', 'disk'],
    install: { manager: 'npm', package: 'rimraf', extraArgs: [] },
    provides: [
      { type: 'command', id: 'rimraf.clean', description: '删除文件/目录', commandTemplate: 'rimraf "{path}"' },
      { type: 'ai.tool', id: 'rimraf_clean', description: '删除指定的文件或目录(危险操作)', commandTemplate: 'rimraf "{path}"', toolParams: { type: 'object', properties: { path: { type: 'string', description: '要删除的目录路径' } }, required: ['path'] } },
    ],
  },
  {
    id: 'npm-check-updates',
    name: 'NPM Check Updates',
    icon: '⬆️',
    description: 'Find and upgrade package.json dependencies to the latest versions with one command.',
    descriptionZh: '一键检查并升级 package.json 依赖到最新版本。',
    author: 'Raine Revere',
    version: '17.0.0',
    category: 'productivity',
    rating: 4.7,
    downloads: 12000000,
    tags: ['npm', 'upgrade', 'deps', 'packages'],
    install: { manager: 'npm', package: 'npm-check-updates', extraArgs: [] },
    provides: [
      { type: 'command', id: 'ncu.check', description: '检查过期依赖', commandTemplate: 'ncu' },
      { type: 'command', id: 'ncu.upgrade', description: '升级所有依赖到最新版本', commandTemplate: 'ncu -u' },
      { type: 'ai.tool', id: 'check_outdated_deps', description: '检查项目过期的 npm 依赖', commandTemplate: 'ncu', toolParams: { type: 'object', properties: {}, required: [] } },
    ],
  },
  {
    id: 'markdown-lint',
    name: 'Markdown Lint',
    icon: '📋',
    description: 'Lint Markdown files for style and syntax issues. Enforce consistent documentation formatting.',
    descriptionZh: 'Markdown 风格和语法检查，确保文档格式一致。',
    author: 'David Anson',
    version: '0.39.0',
    category: 'linter',
    rating: 4.4,
    downloads: 6200000,
    tags: ['markdown', 'lint', 'docs', 'quality'],
    install: { manager: 'npm', package: 'markdownlint-cli', extraArgs: [] },
    provides: [
      { type: 'command', id: 'markdownlint.check', description: '检查 Markdown 文件格式', commandTemplate: 'markdownlint "{file}"' },
      { type: 'command', id: 'markdownlint.fix', description: '修复 Markdown 格式问题', commandTemplate: 'markdownlint --fix "{file}"' },
      { type: 'ai.tool', id: 'lint_markdown', description: '检查 Markdown 文档格式', commandTemplate: 'markdownlint "{file}"', toolParams: { type: 'object', properties: { file: { type: 'string', description: 'Markdown 文件路径' } }, required: ['file'] } },
    ],
  },
  {
    id: 'git-cliff',
    name: 'Git Cliff Changelog',
    icon: '📋',
    description: 'Generate beautiful changelogs from git history. Conventional commits → formatted release notes.',
    descriptionZh: '从 git 历史生成漂亮的 CHANGELOG，支持 conventional commits。',
    author: 'Git Cliff',
    version: '2.5.0',
    category: 'git',
    rating: 4.5,
    downloads: 3900000,
    tags: ['git', 'changelog', 'release', 'commits'],
    install: { manager: 'npm', package: 'git-cliff', extraArgs: [] },
    provides: [
      { type: 'command', id: 'git-cliff.generate', description: '生成 CHANGELOG', commandTemplate: 'git-cliff -o CHANGELOG.md' },
      { type: 'ai.tool', id: 'generate_changelog', description: '从 git 历史生成 CHANGELOG.md', commandTemplate: 'git-cliff -o CHANGELOG.md', toolParams: { type: 'object', properties: {}, required: [] } },
    ],
  },
  {
    id: 'http-server',
    name: 'HTTP Server',
    icon: '🌐',
    description: 'Simple zero-config HTTP server for static files. Great for quick previews and local dev.',
    descriptionZh: '零配置静态 HTTP 服务器，快速预览和本地开发。',
    author: 'http-server',
    version: '14.1.0',
    category: 'api',
    rating: 4.5,
    downloads: 18000000,
    tags: ['http', 'server', 'static', 'dev'],
    install: { manager: 'npm', package: 'http-server', extraArgs: [] },
    provides: [
      { type: 'command', id: 'http-server.start', description: '启动静态 HTTP 服务器', commandTemplate: 'http-server -p {port}' },
      { type: 'ai.tool', id: 'start_http_server', description: '启动本地静态文件服务器', commandTemplate: 'http-server -p {port} -o', toolParams: { type: 'object', properties: { port: { type: 'number', description: '端口号', default: 8080 } }, required: [] } },
    ],
  },
  {
    id: 'cspell',
    name: 'Code Spell Checker',
    icon: '📖',
    description: 'Multi-lingual spell checker for code: camelCase/snake_case aware, technical terms dictionary.',
    descriptionZh: '代码拼写检查，识别驼峰/蛇形命名，内置技术术语词典。',
    author: 'Street Side Software',
    version: '8.14.0',
    category: 'linter',
    rating: 4.4,
    downloads: 16500000,
    tags: ['spell', 'check', 'naming', 'i18n'],
    install: { manager: 'npm', package: 'cspell', extraArgs: [] },
    provides: [
      { type: 'command', id: 'cspell.check', description: '拼写检查', commandTemplate: 'cspell "{file}"' },
      { type: 'ai.tool', id: 'spell_check', description: '对文件进行拼写检查', commandTemplate: 'cspell "{file}"', toolParams: { type: 'object', properties: { file: { type: 'string', description: '文件路径' } }, required: ['file'] } },
    ],
  },
  {
    id: 'depcheck',
    name: 'DepCheck',
    icon: '🔬',
    description: 'Find unused and missing dependencies in your project. Clean up package.json with confidence.',
    descriptionZh: '找出未使用和缺失的依赖，放心清理 package.json。',
    author: 'DepCheck Team',
    version: '1.4.0',
    category: 'productivity',
    rating: 4.5,
    downloads: 5400000,
    tags: ['npm', 'deps', 'unused', 'clean'],
    install: { manager: 'npm', package: 'depcheck', extraArgs: [] },
    provides: [
      { type: 'command', id: 'depcheck.analyze', description: '分析未使用和缺失的依赖', commandTemplate: 'depcheck' },
      { type: 'ai.tool', id: 'check_dependencies', description: '分析项目依赖，找出未使用和缺失的包', commandTemplate: 'depcheck', toolParams: { type: 'object', properties: {}, required: [] } },
    ],
  },
  {
    id: 'license-checker',
    name: 'License Checker',
    icon: '⚖️',
    description: 'Audit all dependency licenses in your project. Find GPL, MIT, Apache, and flag incompatible licenses.',
    descriptionZh: '审计项目所有依赖的开源许可证，标记不兼容的许可证。',
    author: 'License Utils',
    version: '4.0.0',
    category: 'productivity',
    rating: 4.3,
    downloads: 3800000,
    tags: ['license', 'audit', 'compliance', 'legal'],
    install: { manager: 'npm', package: 'license-checker', extraArgs: [] },
    provides: [
      { type: 'command', id: 'license.audit', description: '审计依赖许可证', commandTemplate: 'license-checker --summary' },
      { type: 'ai.tool', id: 'audit_licenses', description: '审计项目所有依赖的开源许可证', commandTemplate: 'license-checker --summary', toolParams: { type: 'object', properties: {}, required: [] } },
    ],
  },
  {
    id: 'npm-audit-plus',
    name: 'NPM Audit Plus',
    icon: '🛡️',
    description: 'Security audit for npm dependencies with fix suggestions and vulnerability scoring.',
    descriptionZh: 'npm 依赖安全审计，修复建议、漏洞评分。',
    author: 'NPM Team',
    version: '10.0.0',
    category: 'productivity',
    rating: 4.6,
    downloads: 25000000,
    tags: ['npm', 'audit', 'security', 'vulnerability'],
    install: { manager: 'npm', package: 'npm', extraArgs: [] },
    provides: [
      { type: 'command', id: 'npm.audit', description: '安全审计', commandTemplate: 'npm audit' },
      { type: 'command', id: 'npm.audit.fix', description: '自动修复安全漏洞', commandTemplate: 'npm audit fix' },
      { type: 'ai.tool', id: 'npm_security_audit', description: '运行 npm audit 安全审计', commandTemplate: 'npm audit --json', toolParams: { type: 'object', properties: {}, required: [] } },
    ],
  },
  {
    id: 'concurrently',
    name: 'Concurrently',
    icon: '⚡',
    description: 'Run multiple commands concurrently. Perfect for dev servers, build watchers, and CI pipelines.',
    descriptionZh: '并行运行多个命令，适合 dev server、构建监听、CI 流水线。',
    author: 'Concurrently Team',
    version: '9.0.0',
    category: 'productivity',
    rating: 4.5,
    downloads: 23000000,
    tags: ['concurrent', 'parallel', 'dev', 'cli'],
    install: { manager: 'npm', package: 'concurrently', extraArgs: [] },
    provides: [
      { type: 'command', id: 'concurrently.run', description: '并行运行多个命令', commandTemplate: 'concurrently "{commands}"' },
      { type: 'ai.tool', id: 'run_parallel', description: '并行执行多个 shell 命令', commandTemplate: 'concurrently {commands}', toolParams: { type: 'object', properties: { commands: { type: 'string', description: '用引号包裹的逗号分隔命令列表' } }, required: ['commands'] } },
    ],
  },
  {
    id: 'tsx-runner',
    name: 'TSX Runner',
    icon: '🚀',
    description: 'Run TypeScript files directly without compilation. Faster than ts-node, ESM + CJS support.',
    descriptionZh: '直接运行 TypeScript 文件，无需编译。比 ts-node 更快，支持 ESM + CJS。',
    author: 'TSX Team',
    version: '4.19.0',
    category: 'editor',
    rating: 4.7,
    downloads: 15000000,
    tags: ['typescript', 'runner', 'tsx', 'esm'],
    install: { manager: 'npm', package: 'tsx', extraArgs: [] },
    provides: [
      { type: 'command', id: 'tsx.run', description: '直接运行 TypeScript 文件', commandTemplate: 'tsx "{file}"' },
      { type: 'ai.tool', id: 'run_ts_file', description: '使用 tsx 运行 TypeScript 文件', commandTemplate: 'tsx "{file}"', toolParams: { type: 'object', properties: { file: { type: 'string', description: 'TypeScript 文件路径' } }, required: ['file'] } },
    ],
  },
  {
    id: 'http-server-mock',
    name: 'HTTP Server Mock',
    icon: '🎭',
    description: 'Local mock server with route matching, latency simulation, response templating. Great for frontend dev.',
    descriptionZh: '本地 Mock 服务器，路由匹配、延迟模拟、响应模板。前端开发利器。',
    author: 'json-server',
    version: '1.0.0',
    category: 'api',
    rating: 4.5,
    downloads: 7100000,
    tags: ['mock', 'http', 'test', 'api', 'server'],
    install: { manager: 'npm', package: 'json-server', extraArgs: [] },
    provides: [
      { type: 'command', id: 'mock.start', description: '启动 JSON mock 服务器', commandTemplate: 'json-server --watch {dbFile} --port {port}' },
      { type: 'ai.tool', id: 'start_mock_server', description: '启动本地 JSON mock 服务器', commandTemplate: 'json-server --watch {dbFile} --port {port}', toolParams: { type: 'object', properties: { dbFile: { type: 'string', description: 'JSON 数据库文件路径' }, port: { type: 'number', description: '端口', default: 3000 } }, required: ['dbFile'] } },
    ],
  },
  {
    id: 'pnpm',
    name: 'pnpm',
    icon: '📦',
    description: 'Fast, disk-space-efficient package manager. Up to 2x faster than npm with strict dependency resolution.',
    descriptionZh: '快速、省磁盘的包管理器。比 npm 快 2 倍，严格的依赖解析。',
    author: 'pnpm Team',
    version: '9.0.0',
    category: 'productivity',
    rating: 4.8,
    downloads: 18000000,
    tags: ['pnpm', 'npm', 'fast', 'disk'],
    install: { manager: 'npm', package: 'pnpm', extraArgs: [] },
    provides: [
      { type: 'command', id: 'pnpm.install', description: '使用 pnpm 安装依赖', commandTemplate: 'pnpm install' },
      { type: 'command', id: 'pnpm.add', description: '添加依赖包', commandTemplate: 'pnpm add {pkg}' },
      { type: 'ai.tool', id: 'pnpm_install', description: '使用 pnpm 安装项目依赖', commandTemplate: 'pnpm install', toolParams: { type: 'object', properties: {}, required: [] } },
    ],
  },
  {
    id: 'tree-cli',
    name: 'Tree CLI',
    icon: '🌲',
    description: 'List contents of directories in tree-like format. Visualize project structure instantly.',
    descriptionZh: '树状列出目录结构，快速可视化项目文件组织。',
    author: 'Tree CLI',
    version: '2.1.0',
    category: 'productivity',
    rating: 4.3,
    downloads: 4500000,
    tags: ['tree', 'directory', 'visualize', 'structure'],
    install: { manager: 'npm', package: 'tree-cli', extraArgs: [] },
    provides: [
      { type: 'command', id: 'tree.show', description: '显示目录树', commandTemplate: 'tree --dirs-first -L {depth}' },
      { type: 'ai.tool', id: 'show_tree', description: '树状显示目录结构', commandTemplate: 'tree --dirs-first -L {depth}', toolParams: { type: 'object', properties: { depth: { type: 'number', description: '深度', default: 3 } }, required: [] } },
    ],
  },
  {
    id: 'minify-html',
    name: 'HTML/CSS/JS Minifier',
    icon: '🗜️',
    description: 'Minify HTML, CSS, and JavaScript files. Reduce bundle sizes for production deployments.',
    descriptionZh: '压缩 HTML/CSS/JS 文件，减小生产部署体积。',
    author: 'Minify Team',
    version: '11.0.0',
    category: 'formatter',
    rating: 4.2,
    downloads: 8900000,
    tags: ['minify', 'html', 'css', 'js', 'optimize'],
    install: { manager: 'npm', package: 'minify', extraArgs: [] },
    provides: [
      { type: 'command', id: 'minify.file', description: '压缩文件', commandTemplate: 'minify "{file}" > "{output}"' },
      { type: 'ai.tool', id: 'minify_file', description: '压缩 HTML/CSS/JS 文件', commandTemplate: 'minify "{file}"', toolParams: { type: 'object', properties: { file: { type: 'string', description: '要压缩的文件路径' } }, required: ['file'] } },
    ],
  },
]

// ── 组件 ──────────────────────────────────────────────────────

interface PluginSummary {
  id: string
  name: string
  version: string
  description: string
  author: string
  status: string
  error?: string
  installedAt: string
  enabledAt?: string
}

interface InstallProgress {
  pluginId: string
  pct: number
  phase: string
  message: string
  done?: boolean
}

type TabKey = 'available' | 'installed'

export const PluginStore: React.FC = () => {
  const { t, locale } = useI18n()
  const [tab, setTab] = useState<TabKey>('available')
  const [installed, setInstalled] = useState<PluginSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<PluginCategory | 'all'>('all')
  const [installMsg, setInstallMsg] = useState<string | null>(null)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [progress, setProgress] = useState<Record<string, InstallProgress>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const loadInstalled = useCallback(async () => {
    try {
      setLoading(true)
      const list = await window.electronAPI.pluginList()
      setInstalled(list)
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadInstalled()
    cleanupRef.current = window.electronAPI.pluginOnInstallProgress((event: any) => {
      if (event.done) {
        setProgress(prev => ({ ...prev, [event.pluginId]: { pluginId: event.pluginId, pct: 100, phase: 'done', message: '完成', done: true } }))
        setTimeout(() => setInstallingId(null), 500)
        loadInstalled()
        return
      }
      setProgress(prev => ({ ...prev, [event.pluginId]: event }))
    })
    return () => { cleanupRef.current?.() }
  }, [loadInstalled])

  const installedIds = useMemo(() => new Set(installed.map(p => p.id)), [installed])

  const filteredCatalog = useMemo(() => {
    let list = CATALOG
    if (categoryFilter !== 'all') list = list.filter(p => p.category === categoryFilter)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(p =>
        p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) || p.descriptionZh.toLowerCase().includes(q) ||
        p.author.toLowerCase().includes(q) || p.tags.some(t => t.includes(q))
      )
    }
    return list
  }, [categoryFilter, searchQuery])

  const filteredInstalled = useMemo(() => {
    if (!searchQuery.trim()) return installed
    const q = searchQuery.toLowerCase()
    return installed.filter(p =>
      p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) || p.author.toLowerCase().includes(q)
    )
  }, [installed, searchQuery])

  const handleInstall = async (plugin: CatalogPlugin) => {
    if (installingId) return
    setInstallingId(plugin.id)
    setInstallMsg(null)
    try {
      const result = await window.electronAPI.pluginInstallCatalog({
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginIcon: plugin.icon,
        pluginDesc: locale === 'zh' ? plugin.descriptionZh : plugin.description,
        pluginAuthor: plugin.author,
        installSpec: plugin.install,
        provides: plugin.provides,
      })
      if (result.success) {
        setInstallMsg(t.plugins.installSuccess.replace('{name}', plugin.name))
        await loadInstalled()
      } else {
        setInstallMsg(t.plugins.installFailed.replace('{error}', result.error || 'Unknown'))
      }
    } catch (e) {
      setInstallMsg(t.plugins.installFailed.replace('{error}', String(e)))
    } finally {
      setTimeout(() => setInstallingId(null), 800)
    }
  }

  const handleUninstall = async (pluginId: string) => {
    const p = installed.find(x => x.id === pluginId)
    if (!p) return
    if (!confirm(t.plugins.uninstallConfirm.replace('{name}', p.name))) return
    try {
      const result = await window.electronAPI.pluginUninstall(pluginId)
      if (result.success) { await loadInstalled() } else { alert(result.error) }
    } catch (e) { alert(String(e)) }
  }

  const handleEnable = async (pluginId: string) => {
    try {
      const result = await window.electronAPI.pluginEnable(pluginId)
      if (result.success) await loadInstalled()
      else alert(result.error)
    } catch (e) { alert(String(e)) }
  }

  const handleDisable = async (pluginId: string) => {
    try {
      const result = await window.electronAPI.pluginDisable(pluginId)
      if (result.success) await loadInstalled()
      else alert(result.error)
    } catch (e) { alert(String(e)) }
  }

  const handleRunCommand = async (pluginId: string, cmdId: string, template: string) => {
    const file = prompt(`输入参数 (${template}):`)
    if (file === null) return
    const cmd = template.replace(/\{[^}]+\}/g, file || '')
    try {
      // @ts-ignore
      const result = await window.electronAPI?.cliExecute?.({ command: cmd, args: {}, projectIds: [], projectNames: {}, apiKey: '', model: '' })
      if (result) alert(`输出:\n${result.output || result}`)
    } catch (e) {
      alert(`运行失败: ${e}`)
    }
  }

  const statusColor = (status: string): string => {
    switch (status) {
      case 'enabled': return '#10b981'
      case 'disabled': return '#9ca3af'
      case 'error': return '#ef4444'
      default: return '#f59e0b'
    }
  }

  const renderStars = (rating: number) => {
    const stars = []
    for (let i = 0; i < 5; i++)
      stars.push(<span key={i} style={{ color: i < Math.floor(rating) ? '#f59e0b' : '#374151', fontSize: 12 }}>★</span>)
    return stars
  }

  const categoryLabel = (cat: PluginCategory | 'all'): string =>
    cat === 'all' ? t.plugins.allCategories : (t.plugins.categories as Record<string, string>)[cat] || cat

  const desc = (p: CatalogPlugin) => locale === 'zh' ? p.descriptionZh : p.description

  const formatDownloads = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
    return String(n)
  }

  const CATEGORY_KEYS: (PluginCategory | 'all')[] = ['all', 'formatter', 'linter', 'git', 'api', 'editor', 'productivity', 'theme', 'ai']

  const renderProgress = (pid: string) => {
    const p = progress[pid]
    if (!p) return null
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ color: '#a78bfa', fontSize: 11, marginBottom: 2 }}>
          {p.phase === 'detecting' && '🔍 '}
          {p.phase === 'installing' && '⬇️ '}
          {p.phase === 'verifying' && '✅ '}
          {p.phase === 'registering' && '📋 '}
          {p.phase === 'done' && '🎉 '}
          {p.message}
        </div>
        <div style={{ height: 3, background: '#1e1e3a', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: 'linear-gradient(90deg, #7c3aed, #a78bfa)', borderRadius: 2, transition: 'width 0.3s', width: `${p.pct}%` }} />
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 0, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 页签 */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid var(--app-border-primary)', padding: '10px 14px 0' }}>
        <div style={{ display: 'flex', gap: 0, marginBottom: 0 }}>
          <button onClick={() => setTab('available')} style={{
            padding: '7px 18px', border: 'none', background: 'transparent',
            color: tab === 'available' ? '#7c3aed' : 'var(--app-text-secondary)',
            borderBottom: tab === 'available' ? '2px solid #7c3aed' : '2px solid transparent',
            cursor: 'pointer', fontSize: 12, fontWeight: tab === 'available' ? 600 : 400,
          }}>
            📡 {t.plugins.available} ({CATALOG.length})
          </button>
          <button onClick={() => setTab('installed')} style={{
            padding: '7px 18px', border: 'none', background: 'transparent',
            color: tab === 'installed' ? '#7c3aed' : 'var(--app-text-secondary)',
            borderBottom: tab === 'installed' ? '2px solid #7c3aed' : '2px solid transparent',
            cursor: 'pointer', fontSize: 12, fontWeight: tab === 'installed' ? 600 : 400,
          }}>
            📦 {t.plugins.installed} ({installed.length})
          </button>
        </div>
      </div>

      {/* 搜索 */}
      <div style={{ flexShrink: 0, padding: '10px 14px' }}>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t.plugins.searchPlaceholder}
          style={{ width: '100%', boxSizing: 'border-box', background: '#16162a', border: '1px solid #333', borderRadius: '6px', color: '#e0e0e0', padding: '7px 12px', fontSize: 12, outline: 'none' }}
        />
      </div>

      {/* 分类筛选 */}
      {tab === 'available' && (
        <div style={{ flexShrink: 0, padding: '0 14px 10px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {CATEGORY_KEYS.map(cat => (
            <button key={cat} onClick={() => setCategoryFilter(cat)} style={{
              padding: '3px 10px', borderRadius: '12px', border: categoryFilter === cat ? '1px solid #7c3aed' : '1px solid #333',
              background: categoryFilter === cat ? 'rgba(124,58,237,0.15)' : 'transparent',
              color: categoryFilter === cat ? '#a78bfa' : '#888',
              cursor: 'pointer', fontSize: 11, fontWeight: categoryFilter === cat ? 600 : 400, whiteSpace: 'nowrap',
            }}>{categoryLabel(cat)}</button>
          ))}
        </div>
      )}

      {/* 消息 */}
      {installMsg && (
        <div style={{ flexShrink: 0, margin: '0 14px 8px', padding: '6px 12px', borderRadius: '6px', fontSize: 12,
          background: installMsg.includes('成功') || installMsg.includes('success') ? '#064e3b' : '#450a0a',
          color: installMsg.includes('成功') || installMsg.includes('success') ? '#34d399' : '#fca5a5',
        }}>{installMsg}</div>
      )}

      {/* 内容区 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 14px 14px' }}>
        {/* ── 可用插件 ── */}
        {tab === 'available' && (
          <>
            {filteredCatalog.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#666', padding: '32px 0' }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🔍</div>
                <div style={{ fontSize: 12 }}>{t.plugins.noAvailable}</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filteredCatalog.map(plugin => {
                  const isInstalled = installedIds.has(plugin.id)
                  const isInstalling = installingId === plugin.id

                  return (
                    <div key={plugin.id} style={{
                      background: '#16162a', borderRadius: '10px', padding: '14px',
                      border: isInstalled ? '1px solid #065f46' : '1px solid #1e1e3a',
                      opacity: isInstalled ? 0.75 : 1,
                    }}>
                      <div style={{ display: 'flex', gap: 12 }}>
                        <span style={{ fontSize: 28, flexShrink: 0 }}>{plugin.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                            <span style={{ fontWeight: 700, color: '#e0e0e0', fontSize: 14 }}>{plugin.name}</span>
                            <span style={{ color: '#6b7280', fontSize: 11 }}>v{plugin.version}</span>
                            <span style={{ color: '#6b7280', fontSize: 10 }}>{t.plugins.author}: {plugin.author}</span>
                          </div>
                          <div style={{ color: '#9ca3af', fontSize: 12, lineHeight: 1.5, marginBottom: 4 }}>
                            {desc(plugin)}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 3 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                              {renderStars(plugin.rating)}
                              <span style={{ color: '#6b7280', fontSize: 10 }}>{plugin.rating}</span>
                            </span>
                            <span style={{ color: '#4b5563', fontSize: 10 }}>{formatDownloads(plugin.downloads)} {t.plugins.downloads}</span>
                            <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, background: '#1e1e3a', color: '#7c3aed' }}>{categoryLabel(plugin.category)}</span>
                            <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, background: '#1e1e3a', color: '#888' }}>
                              {plugin.install.manager} install {plugin.install.package}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {plugin.tags.map(tag => <span key={tag} style={{ color: '#4b5563', fontSize: 10 }}>#{tag}</span>)}
                          </div>
                          {/* 提供的命令/工具预览 */}
                          <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {plugin.provides.map(p => (
                              <span key={p.id} style={{
                                padding: '1px 6px', borderRadius: 3, fontSize: 9,
                                background: p.type === 'command' ? '#0c4a6e' : '#064e3b',
                                color: p.type === 'command' ? '#7dd3fc' : '#34d399',
                              }}>{p.type === 'command' ? '⌨' : '🤖'} {p.id}</span>
                            ))}
                          </div>
                          {renderProgress(plugin.id)}
                        </div>
                        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                          {isInstalled ? (
                            <span style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: '#064e3b', color: '#34d399', border: '1px solid #065f46' }}>
                              ✓ {t.plugins.installed}
                            </span>
                          ) : isInstalling ? (
                            <div style={{ minWidth: 90, textAlign: 'center' }}>
                              <div style={{ padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: '#1e1e3a', color: '#a78bfa', border: '1px solid #5b21b6' }}>
                                {t.plugins.installing}
                              </div>
                            </div>
                          ) : (
                            <button onClick={() => handleInstall(plugin)} style={{
                              padding: '6px 16px', borderRadius: 6, border: 'none', background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
                              color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                            }}>⬇ {t.plugins.install}</button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ── 已安装 ── */}
        {tab === 'installed' && (
          <>
            {loading ? (
              <div style={{ color: '#888', textAlign: 'center', padding: 32 }}>{t.common.loading}</div>
            ) : error ? (
              <div style={{ color: '#f44336', textAlign: 'center', padding: 32 }}>{error}</div>
            ) : filteredInstalled.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#666', padding: '32px 0' }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📦</div>
                <div style={{ fontSize: 12 }}>{t.plugins.noPlugins}</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filteredInstalled.map(plugin => {
                  const catPlugin = CATALOG.find(c => c.id === plugin.id)
                  const isExpanded = expandedId === plugin.id
                  return (
                    <div key={plugin.id} style={{
                      background: '#16162a', borderRadius: '10px', padding: '14px',
                      border: plugin.status === 'enabled' ? '1px solid #065f46' : '1px solid #1e1e3a',
                    }}>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 26, flexShrink: 0, cursor: 'pointer' }} onClick={() => setExpandedId(isExpanded ? null : plugin.id)}>
                          {catPlugin?.icon || '📦'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                            <span style={{ fontWeight: 700, color: '#e0e0e0', fontSize: 14, cursor: 'pointer' }} onClick={() => setExpandedId(isExpanded ? null : plugin.id)}>
                              {plugin.name}
                            </span>
                            <span style={{ color: '#6b7280', fontSize: 11 }}>v{plugin.version}</span>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(plugin.status), display: 'inline-block' }} />
                            <span style={{ color: statusColor(plugin.status), fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>{plugin.status}</span>
                          </div>
                          <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 4 }}>
                            {catPlugin ? desc(catPlugin) : plugin.description}
                          </div>
                          {plugin.error && <div style={{ color: '#ef4444', fontSize: 11, marginTop: 4 }}>{plugin.error}</div>}

                          {/* 展开详情：命令列表 + 工具列表 */}
                          {isExpanded && catPlugin && (
                            <div style={{ marginTop: 8, padding: 10, background: '#0f0f23', borderRadius: 8, border: '1px solid #1e1e3a' }}>
                              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8, fontWeight: 600 }}>
                                {t.harnessAgent.quickCommandsHint || '已注册的能力:'}
                              </div>
                              {catPlugin.provides.map(p => (
                                <div key={p.id} style={{
                                  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
                                  borderBottom: '1px solid #1a1a2e', fontSize: 11,
                                }}>
                                  <span style={{
                                    padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                                    background: p.type === 'command' ? '#0c4a6e' : '#064e3b',
                                    color: p.type === 'command' ? '#7dd3fc' : '#34d399',
                                    flexShrink: 0,
                                  }}>
                                    {p.type === 'command' ? '⌨ CLI' : '🤖 AI'}
                                  </span>
                                  <span style={{ color: '#e0e0e0', flex: 1 }}>{p.id}</span>
                                  <span style={{ color: '#6b7280', flex: 2, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {p.description}
                                  </span>
                                  {p.commandTemplate && (
                                    <code style={{
                                      padding: '1px 6px', borderRadius: 3, fontSize: 10,
                                      background: '#1e1e3a', color: '#a78bfa', flexShrink: 0,
                                      maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                      {p.commandTemplate}
                                    </code>
                                  )}
                                </div>
                              ))}
                              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {catPlugin.provides.filter(p => p.type === 'command').slice(0, 3).map(p => (
                                  <button key={p.id}
                                    onClick={() => handleRunCommand(plugin.id, p.id, p.commandTemplate || '')}
                                    style={{
                                      padding: '3px 10px', borderRadius: 4, border: '1px solid #333', background: '#16162a',
                                      color: '#7dd3fc', cursor: 'pointer', fontSize: 10,
                                    }}>
                                    ▶ {p.id}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexDirection: 'column' }}>
                          <button onClick={() => setExpandedId(isExpanded ? null : plugin.id)} style={{
                            background: 'transparent', color: '#6b7280', border: 'none', cursor: 'pointer', fontSize: 16, padding: 0,
                          }}>{isExpanded ? '▲' : '▼'}</button>
                          {plugin.status === 'enabled' ? (
                            <button onClick={() => handleDisable(plugin.id)} style={{ background: '#1f2937', color: '#d1d5db', border: '1px solid #374151', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>
                              {t.plugins.disable}
                            </button>
                          ) : (
                            <button onClick={() => handleEnable(plugin.id)} style={{ background: '#064e3b', color: '#34d399', border: '1px solid #065f46', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>
                              {t.plugins.enable}
                            </button>
                          )}
                          <button onClick={() => handleUninstall(plugin.id)} style={{ background: '#450a0a', color: '#fca5a5', border: '1px solid #7f1d1d', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>
                            {t.plugins.uninstall}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export { CATALOG }
