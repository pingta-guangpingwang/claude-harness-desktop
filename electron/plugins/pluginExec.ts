// PluginExec — 真实包安装 + 二进制检测 + manifest 生成 + 命令/AI工具注册
import { execSync, spawn } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { platform } from 'os'

const SHELL = process.env.ComSpec || process.env.SHELL || 'sh'

// ── 安装规格 ──────────────────────────────────────────────────

export type PackageManager = 'npm' | 'pip' | 'pip3' | 'cargo' | 'go' | 'gem' | 'choco' | 'scoop' | 'winget' | 'brew'

export interface InstallSpec {
  manager: PackageManager
  package: string
  /** npm 的 -g、pip 的 --user 等 */
  extraArgs?: string[]
  /** 安装后验证的二进制名，默认等于 package */
  checkBinary?: string
}

export interface PluginProvides {
  type: 'command' | 'ai.tool'
  id: string
  description: string
  /** 命令模板: "prettier --write {file}"；AI 工具描述 */
  commandTemplate?: string
  /** AI 工具的 JSON Schema 参数 */
  toolParams?: Record<string, unknown>
}

// ── 包管理器检测 ──────────────────────────────────────────────

function which(bin: string): string | null {
  try {
    const isWin = platform() === 'win32'
    const result = execSync(
      isWin ? `where ${bin} 2>nul` : `which ${bin} 2>/dev/null`,
      { encoding: 'utf-8', timeout: 5000 }
    )
    const lines = result.trim().split('\n')
    return lines[0]?.trim() || null
  } catch {
    return null
  }
}

function detectAvailableManagers(): Set<PackageManager> {
  const managers: PackageManager[] = ['npm', 'pip', 'pip3', 'cargo', 'go', 'gem', 'choco', 'scoop', 'winget', 'brew']
  const available = new Set<PackageManager>()
  for (const m of managers) {
    if (which(m)) available.add(m)
  }
  return available
}

// ── 安装执行 ──────────────────────────────────────────────────

function buildInstallCmd(spec: InstallSpec): string {
  const { manager, package: pkg, extraArgs } = spec
  const args = (extraArgs || []).join(' ')
  switch (manager) {
    case 'npm':   return `npm install -g ${pkg} ${args}`.trim()
    case 'pip':   return `pip install ${pkg} ${args}`.trim()
    case 'pip3':  return `pip3 install ${pkg} ${args}`.trim()
    case 'cargo': return `cargo install ${pkg} ${args}`.trim()
    case 'go':    return `go install ${pkg} ${args}`.trim()
    case 'gem':   return `gem install ${pkg} ${args}`.trim()
    case 'choco': return `choco install ${pkg} -y ${args}`.trim()
    case 'scoop': return `scoop install ${pkg} ${args}`.trim()
    case 'winget':return `winget install ${pkg} --accept-package-agreements ${args}`.trim()
    case 'brew':  return `brew install ${pkg} ${args}`.trim()
    default:      return `${manager} install ${pkg} ${args}`.trim()
  }
}

export interface InstallProgress {
  phase: 'detecting' | 'installing' | 'verifying' | 'registering' | 'done'
  message: string
  pct: number
}

export interface InstallResult {
  success: boolean
  binaryPath?: string
  version?: string
  error?: string
  manifestPath?: string
}

async function runInstall(
  spec: InstallSpec,
  onProgress: (p: InstallProgress) => void
): Promise<{ success: boolean; error?: string }> {
  const cmd = buildInstallCmd(spec)
  onProgress({ phase: 'installing', message: cmd, pct: 30 })

  return new Promise(resolve => {
    const proc = spawn(cmd, [], {
      shell: SHELL,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('close', code => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: `${stderr || stdout || 'exit ' + code}`.slice(0, 500) })
      }
    })

    proc.on('error', err => {
      resolve({ success: false, error: String(err) })
    })
  })
}

// ── 版本检测 ──────────────────────────────────────────────────

function detectVersion(binary: string): string | null {
  const versionFlags = ['--version', '-V', 'version', '-v']
  for (const flag of versionFlags) {
    try {
      const out = execSync(`"${binary}" ${flag} 2>&1`, {
        encoding: 'utf-8',
        timeout: 10000,
        shell: SHELL,
      }).trim()
      // 提取 semver
      const m = out.match(/(\d+\.\d+\.\d+)/)
      if (m) return m[1]
    } catch { /* try next flag */ }
  }
  return null
}

// ── manifest 生成 ─────────────────────────────────────────────

interface GeneratedManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  icon: string
  provides: PluginProvides[]
  install: {
    manager: PackageManager
    package: string
    binary: string
    version: string
    installedAt: string
  }
}

function getPluginsDir(): string {
  try {
    const { app } = require('electron')
    const p = join(app.getPath('userData'), 'plugins')
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
    return p
  } catch { return join(process.cwd(), '.chd', 'plugins') }
}

// ── 对外主API ─────────────────────────────────────────────────

export async function installPluginFromCatalog(
  pluginId: string,
  pluginName: string,
  pluginIcon: string,
  pluginDesc: string,
  pluginAuthor: string,
  installSpec: InstallSpec,
  provides: PluginProvides[],
  onProgress: (p: InstallProgress) => void,
): Promise<InstallResult> {
  // 1. 检测包管理器
  onProgress({ phase: 'detecting', message: '检测包管理器...', pct: 5 })
  const availableMgrs = detectAvailableManagers()
  if (!availableMgrs.has(installSpec.manager)) {
    // 尝试 npm 作为后备
    if (installSpec.manager !== 'npm' && availableMgrs.has('npm')) {
      onProgress({ phase: 'detecting', message: `${installSpec.manager} 不可用，尝试 npm 替代...`, pct: 10 })
      installSpec = { ...installSpec, manager: 'npm' }
    } else {
      return { success: false, error: `包管理器 ${installSpec.manager} 未安装` }
    }
  }

  // 2. 检查二进制是否已存在
  const bin = installSpec.checkBinary || installSpec.package
  const existing = which(bin)
  if (existing) {
    const ver = detectVersion(existing)
    onProgress({ phase: 'detecting', message: `已检测到 ${bin} (${ver || '未知版本'})，跳过安装`, pct: 50 })
  } else {
    // 3. 执行安装
    const instResult = await runInstall(installSpec, onProgress)
    if (!instResult.success) {
      return { success: false, error: instResult.error || '安装失败' }
    }
  }

  // 4. 验证安装
  onProgress({ phase: 'verifying', message: `验证 ${bin} 安装...`, pct: 80 })
  const binaryPath = which(bin)
  if (!binaryPath) {
    return { success: false, error: `安装后仍找不到 ${bin}，请检查 PATH 环境变量` }
  }
  const version = detectVersion(binaryPath)

  // 5. 生成 manifest
  onProgress({ phase: 'registering', message: '生成 manifest 并注册...', pct: 90 })
  const manifest: GeneratedManifest = {
    id: pluginId,
    name: pluginName,
    version: version || '0.0.0',
    description: pluginDesc,
    author: pluginAuthor,
    icon: pluginIcon,
    provides,
    install: {
      manager: installSpec.manager,
      package: installSpec.package,
      binary: binaryPath,
      version: version || 'unknown',
      installedAt: new Date().toISOString(),
    },
  }

  const pluginsDir = getPluginsDir()
  const pDir = join(pluginsDir, pluginId)
  if (!existsSync(pDir)) mkdirSync(pDir, { recursive: true })
  const manifestPath = join(pDir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')

  onProgress({ phase: 'done', message: '完成', pct: 100 })

  return {
    success: true,
    binaryPath,
    version: version || undefined,
    manifestPath,
  }
}

/** 获取已安装插件的清单 */
export function getInstalledPluginManifest(pluginId: string): GeneratedManifest | null {
  const manifestPath = join(getPluginsDir(), pluginId, 'manifest.json')
  try {
    if (existsSync(manifestPath)) {
      return JSON.parse(readFileSync(manifestPath, 'utf-8'))
    }
  } catch { /* ignore */ }
  return null
}

/** 获取所有已安装插件的清单 */
export function getAllInstalledManifests(): GeneratedManifest[] {
  const dir = getPluginsDir()
  const manifests: GeneratedManifest[] = []
  try {
    const { readdirSync } = require('fs')
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const m = getInstalledPluginManifest(entry.name)
      if (m) manifests.push(m)
    }
  } catch { /* ignore */ }
  return manifests
}
