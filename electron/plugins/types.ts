// 插件生态系统 — 核心类型定义

/** 能力类型 */
export type CapabilityType =
  | 'command'       // CLI 命令
  | 'view.panel'    // 右侧面板
  | 'view.tab'      // 顶部标签页
  | 'ai.tool'       // 驾驭智能体工具
  | 'workflow.step' // 工作流节点
  | 'menu.action'   // 菜单项

/** 插件权限 */
export type PluginPermission =
  | 'filesystem:read'
  | 'filesystem:write'
  | 'network'
  | 'dbht:execute'
  | 'ai:call'
  | 'window:overlay'
  | 'clipboard'
  | 'notifications'

/** 插件清单 — manifest.json 结构 */
export interface PluginManifest {
  id: string
  name: string
  version: string           // semver
  description: string
  author: string
  icon?: string             // emoji
  homepage?: string
  repository?: string
  license?: string
  /** 最低 CHD 版本要求 */
  engineVersion?: string
  /** 主进程入口 */
  main?: string              // index.js
  /** 渲染进程入口 */
  renderer?: string          // renderer.js
  /** 提供的能力 */
  provides: Array<{
    type: CapabilityType
    id: string               // 能力唯一 ID
    description: string
  }>
  /** 消费的能力（依赖） */
  consumes?: Array<{
    type: CapabilityType
    id: string
  }>
  /** 请求的权限 */
  permissions?: PluginPermission[]
  /** 配置项 JSON Schema */
  config?: Record<string, unknown>
  /** 是否为系统内置插件（不可卸载） */
  builtin?: boolean
}

/** 插件运行时实例 */
export interface PluginInstance {
  manifest: PluginManifest
  /** 插件安装目录 */
  installPath: string
  /** 当前状态 */
  status: 'installed' | 'enabled' | 'disabled' | 'error'
  /** 主进程模块导出 */
  mainModule?: PluginMainModule
  /** 是否为系统内置 */
  builtin?: boolean
  /** 错误信息 */
  error?: string
  /** 安装时间 */
  installedAt: string
  /** 最后启用时间 */
  enabledAt?: string
}

/** 插件主进程模块接口 */
export interface PluginMainModule {
  onInstall?(ctx: PluginContext): Promise<void>
  onEnable?(ctx: PluginContext): Promise<void>
  onDisable?(ctx: PluginContext): Promise<void>
  onUninstall?(ctx: PluginContext): Promise<void>
  onUpdate?(ctx: PluginContext, previousVersion: string): Promise<void>
  /** 自定义 API 导出（供其他插件消费） */
  exports?: Record<string, unknown>
}

/** 插件上下文 — 传递给插件主进程代码 */
export interface PluginContext {
  manifest: PluginManifest
  installPath: string
  config: Record<string, unknown>
  /** 读写插件专属配置 */
  getConfig: () => Record<string, unknown>
  setConfig: (config: Record<string, unknown>) => void
  /** 日志 */
  log: (message: string) => void
  /** 访问沙箱 API */
  api: PluginSandboxAPI
}

/** 沙箱提供给插件的受限 API */
export interface PluginSandboxAPI {
  /** 注册 CLI 命令 */
  registerCommand: (name: string, def: {
    description: string
    params?: Array<{ name: string; type: string; description: string }>
    handler: (args: Record<string, unknown>) => Promise<{ success: boolean; output: string }>
  }) => void
  /** 注册驾驭智能体工具 */
  registerAITool: (tool: {
    name: string
    description: string
    parameters: Record<string, unknown>
    handler: (params: Record<string, unknown>) => Promise<{ success: boolean; output: string }>
  }) => void
  /** 读文件（仅限沙箱允许的路径） */
  readFile: (path: string) => Promise<string>
  /** 写文件（仅限沙箱允许的路径） */
  writeFile: (path: string, content: string) => Promise<void>
  /** HTTP 请求 */
  fetch: (url: string, options?: Record<string, unknown>) => Promise<{ status: number; body: string }>
}
