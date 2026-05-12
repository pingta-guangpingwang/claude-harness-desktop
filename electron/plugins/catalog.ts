// 插件目录 — 共享数据，主进程和渲染进程均可引用
// 实际数据源：renderer 从 PluginStore.tsx 导入，main 从 tools 导入

export type PluginCategory = 'formatter' | 'linter' | 'git' | 'container' | 'api' | 'editor' | 'database' | 'productivity' | 'theme' | 'ai'

export type PkgManager = 'npm' | 'pip' | 'pip3' | 'cargo' | 'go' | 'gem' | 'choco' | 'scoop' | 'winget' | 'brew'

export interface CatalogInstallSpec {
  manager: PkgManager
  package: string
  extraArgs?: string[]
  checkBinary?: string
}

export interface CatalogProvides {
  type: 'command' | 'ai.tool'
  id: string
  description: string
  commandTemplate?: string
  toolParams?: Record<string, unknown>
}

export interface CatalogPlugin {
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
  install: CatalogInstallSpec
  provides: CatalogProvides[]
}

export const PLUGIN_CATALOG: CatalogPlugin[] = [
  {
    id: 'prettier-plus',
    name: 'Prettier Plus',
    icon: '✨',
    description: 'Opinionated code formatter supporting 50+ languages.',
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
    description: 'Pluggable linting utility for JavaScript/TypeScript with auto-fix.',
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
    description: 'TypeScript compiler with type checking.',
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
      { type: 'ai.tool', id: 'typecheck_tsc', description: '运行 TypeScript 类型检查', commandTemplate: 'tsc --noEmit', toolParams: { type: 'object', properties: {}, required: [] } },
    ],
  },
  {
    id: 'rimraf-cleaner',
    name: 'RimRaf Cleaner',
    icon: '🧹',
    description: 'Cross-platform rm -rf for cleaning node_modules, dist, .cache.',
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
    description: 'Find and upgrade package.json dependencies to latest versions.',
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
    description: 'Lint Markdown files for style and syntax issues.',
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
    description: 'Generate beautiful changelogs from git history.',
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
    id: 'depcheck',
    name: 'DepCheck',
    icon: '🔬',
    description: 'Find unused and missing dependencies in your project.',
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
    description: 'Audit all dependency licenses in your project.',
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
    id: 'cspell',
    name: 'Code Spell Checker',
    icon: '📖',
    description: 'Multi-lingual spell checker for code.',
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
    id: 'npm-audit-plus',
    name: 'NPM Audit Plus',
    icon: '🛡️',
    description: 'Security audit for npm dependencies with fix suggestions.',
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
    description: 'Run multiple commands concurrently.',
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
    description: 'Run TypeScript files directly without compilation.',
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
]

/** 按名称/ID模糊搜索插件 */
export function searchCatalog(query: string): CatalogPlugin[] {
  const q = query.toLowerCase()
  return PLUGIN_CATALOG.filter(p =>
    p.id.toLowerCase().includes(q) ||
    p.name.toLowerCase().includes(q) ||
    p.description.toLowerCase().includes(q) ||
    p.descriptionZh.toLowerCase().includes(q) ||
    p.tags.some(t => t.includes(q))
  )
}

/** 精确查找插件 */
export function findPlugin(idOrName: string): CatalogPlugin | undefined {
  const q = idOrName.toLowerCase()
  return PLUGIN_CATALOG.find(p =>
    p.id === q || p.id.toLowerCase() === q ||
    p.name.toLowerCase() === q
  )
}
