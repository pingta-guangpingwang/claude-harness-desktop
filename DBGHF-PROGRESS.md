# Claude Harness Desktop — 技术文档

> **最后更新**: 2026-05-12  
> **当前 DBHT 版本**: `20260512T000000000`  
> **项目定位**: AI 驱动的多项目并行开发管理工具（Electron 28 + React 19 + TypeScript + Vite 8）

---

## 1. 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 桌面框架 | Electron | 28 |
| UI 渲染 | React | 19 |
| 语言 | TypeScript | 5.6 |
| 构建 | Vite (rolldown) | 8 |
| 终端 | node-pty | — |
| AI API | DeepSeek (OpenAI 兼容) | — |
| 版本控制 | DBHT CLI (`dbht`) | — |
| i18n | 自建 `useI18n()` hook | — |

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────┐
│  Electron Main Process (56 个 TS 模块)                   │
│                                                         │
│  main.ts                                                 │
│  ├── windowManager.ts      多窗口生命周期                │
│  ├── tray.ts               系统托盘 + 右键菜单            │
│  ├── hotkeys.ts            全局快捷键 (Ctrl+Shift+H)      │
│  ├── autoStart.ts          开机自启管理                   │
│  ├── scheduler.ts          并发资源调度器                 │
│  ├── ruleEngine.ts         条件→动作规则引擎              │
│  ├── auditLogger.ts        结构化审计日志 + 轮转          │
│  ├── performanceMonitor.ts 运行时指标采集                 │
│  ├── batchIPC.ts           IPC 批量优化                  │
│  ├── cloudSync.ts          云同步服务                    │
│  ├── fileWatcher.ts        chokidar 文件监听             │
│  └── parallelExecutor.ts   Promise 并发池                │
│                                                         │
│  electron/modules/          核心业务模块 (≈70 IPC 通道)   │
│  ├── dbhtIpc.ts             DBHT CLI 集成 (6 通道)       │
│  ├── horseFarmIpc.ts        项目农场管理 (14 通道)        │
│  ├── harnessIpc.ts          驾驭智能体 IPC (10 通道)      │
│  ├── hubIpc.ts              中枢设置 IPC (14 通道)        │
│  ├── middlewareBridge.ts    深蓝中间件对接 (15 通道)       │
│  ├── sandboxIpc.ts          版本沙箱 IPC (5 通道)         │
│  ├── systemIpc.ts           规则/审计/性能 IPC (16 通道)  │
│  ├── ptyManager.ts          PTY 终端进程池 (5 通道)       │
│  └── sessionManager.ts      会话管理 (4 通道)             │
│                                                         │
│  electron/cli/              CLI 命令驾驭系统 (20 IPC)     │
│  ├── registry.ts            命令注册表                    │
│  ├── batchRunner.ts         批量执行器 (串行/并行)        │
│  ├── aliasResolver.ts       别名解析                      │
│  ├── permissionGate.ts      三级权限门控                  │
│  ├── historyStore.ts        命令历史持久化                │
│  └── builtinCommands.ts     内置命令定义                  │
│                                                         │
│  electron/plugins/          插件生态系统 (16 IPC)         │
│  ├── pluginExec.ts          npm/pip 安装引擎 ✨新         │
│  ├── manager.ts             插件生命周期 + registerShim   │
│  ├── installer.ts           zip/url 安装 + 进度回调       │
│  ├── sandbox.ts             require 代理 + 沙箱          │
│  ├── capabilityRegistry.ts  能力注册与依赖解析            │
│  └── versionManager.ts      版本追踪与回滚                │
│                                                         │
│  electron/harnessAgent/     驾驭智能体核心                │
│  ├── agentLoop.ts           对话循环 (DeepSeek LLM)       │
│  ├── tools.ts               15 个内置工具                 │
│  ├── toolRegistry.ts        工具注册表 (buildTool 工厂)   │
│  └── permissionManager.ts   运行时权限决策                │
│                                                         │
│  electron/workflow/         工作流引擎 (11 IPC)           │
│  ├── engine.ts              工作流执行引擎                │
│  └── scheduler.ts           定时/触发调度                 │
│                                                         │
│  electron/templates/        模板应用引擎                  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  React UI (64 个 TSX/TS 文件)                            │
│                                                         │
│  src/components/                                         │
│  ├── Setup/                初始化向导                    │
│  ├── HorseFarm/            主驾驶面板 (14 个组件)         │
│  │   ├── HorseFarm.tsx       10 个功能面板               │
│  │   ├── HarnessAgentPanel.tsx  驾驭智能体对话           │
│  │   ├── ProjectList.tsx    项目列表 + CLI 卡片          │
│  │   ├── ProjectProgressCard.tsx  项目进度卡片           │
│  │   ├── CommandCenter.tsx  命令输入中心                 │
│  │   └── ...                                              │
│  ├── CLI/                  命令行界面                    │
│  │   ├── CommandPalette.tsx   增强命令面板                │
│  │   ├── BatchManager.tsx    批量编排 UI                 │
│  │   └── FavoritesPanel.tsx  收藏分组侧栏                │
│  ├── Plugins/              插件商店 ✨重写               │
│  │   └── PluginStore.tsx     20 款精选 + npm 安装         │
│  ├── Workflow/             可视化工作流编辑器            │
│  │   ├── WorkflowEditor.tsx  拖拽节点编辑器              │
│  │   └── WorkflowNodeLibrary.tsx  14 种节点类型          │
│  ├── Eco/                  深蓝生态互联                  │
│  │   ├── ResourceHub.tsx     跨项目资源浏览器            │
│  │   └── ConfigMigrator.tsx  配置迁移向导                │
│  ├── System/               系统管控                      │
│  │   ├── RuleEditor.tsx      规则编辑器                  │
│  │   ├── AuditLogViewer.tsx  审计日志查看                │
│  │   └── PerformanceDashboard.tsx  性能仪表盘            │
│  ├── Identity/             身份档案                      │
│  │   ├── IdentityProfile.tsx  玩家卡片                  │
│  │   └── RoleSwitcher.tsx     角色一键切换               │
│  ├── Productivity/         个人效率                      │
│  │   ├── QuickLauncher.tsx    Spotlight 启动器           │
│  │   ├── TemplateLibrary.tsx  模板管理                   │
│  │   ├── LayoutManager.tsx    窗口布局保存               │
│  │   └── EfficiencyDashboard.tsx  效率可视化             │
│  ├── Hub/                  中枢层                        │
│  │   ├── FloatingWidget.tsx  悬浮快捷入口                │
│  │   └── QuickCommandPalette.tsx  快捷键面板             │
│  ├── Shared/               共享组件                      │
│  │   ├── VirtualList.tsx      虚拟滚动列表               │
│  │   └── AuditPanel.tsx       审计面板                   │
│  └── Layout/               布局组件                      │
│                                                         │
│  src/context/              全局状态 (4 个 Context)       │
│  ├── HFContext.tsx           项目农场状态                │
│  ├── ChatContext.tsx         聊天会话状态                │
│  ├── RoleContext.tsx         角色身份状态                │
│  └── ThemeContext.tsx        主题外观状态                │
│                                                         │
│  src/i18n/locales/          国际化 (~250 翻译键)         │
│  ├── zh.ts                   中文                        │
│  └── en.ts                   英文                        │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 功能模块状态

### Phase 1: 核心中枢层 ✅ 完成
| 功能 | 状态 | 实现 |
|------|------|------|
| 系统托盘 | ✅ | `tray.ts` — 图标 + 右键菜单 + 最小化到托盘 |
| 全局快捷键 | ✅ | `hotkeys.ts` — `Ctrl+Shift+H` 唤起主窗口 |
| 开机自启 | ✅ | `autoStart.ts` — Windows 注册表 / Linux .desktop |
| 悬浮小窗 | ✅ | `FloatingWidget.tsx` — 320×480 无边框置顶窗口 |
| 资源调度器 | ✅ | `scheduler.ts` — 并发 AI 请求/文件 IO 管理 |
| 关闭即隐藏 | ✅ | `windowManager.ts` — `window-all-closed` 阻止退出 |

### Phase 2: CLI 命令驾驭系统 ✅ 完成
| 功能 | 状态 | 实现 |
|------|------|------|
| 命令注册表 | ✅ | `registry.ts` — 注册/搜索/解析，20 个 IPC 通道 |
| 别名系统 | ✅ | `aliasResolver.ts` — 别名→展开映射，JSON 持久化 |
| 批量编排 | ✅ | `batchRunner.ts` — 串行/并行，IPC push 实时进度 |
| 权限三级 | ✅ | `permissionGate.ts` — user/elevated/admin |
| 收藏分组 | ✅ | `FavoritesPanel.tsx` — 收藏 + 分组管理 |
| 命令面板 | ✅ | `CommandPalette.tsx` — 模糊搜索 + 分类过滤 |

### Phase 3: 插件生态系统 ✅ 完成 (v2 重构)
| 功能 | 状态 | 实现 |
|------|------|------|
| 精选插件目录 | ✅ | `PluginStore.tsx` — 20 款开源工具 (Prettier/ESLint/tsc/pnpm...) |
| 真实安装 | ✅ | `pluginExec.ts` — npm/pip/cargo 等 9 种包管理器 |
| 下载进度 | ✅ | IPC `plugin:install-progress` 实时推送百分比 |
| 能力注册 | ✅ | 安装后自动注册 CLI 命令 + AI 工具 |
| Shim 模式 | ✅ | `manager.registerShim()` — 无 JS 模块注册 |
| AI 感知 | ✅ | `agentLoop.ts` system prompt 动态注入插件工具列表 |
| 安装后交互 | ✅ | 展开查看命令/工具 + 一键运行 |
| ZIP/URL 安装 | ✅ | `installer.ts` — 传统 zip 安装兼容 |
| 共享插件目录 | ✅ | `catalog.ts` — 13 款精选插件 + searchCatalog/findPlugin |
| AI 自主安装 | ✅ | `install_plugin` 工具 — 驾驭智能体可搜索安装插件 |
| 安装后审查 | ✅ | smoke test — 自动验证 binary + 功能自检 |
| 系统内置插件 | ✅ | `registerBuiltin()` — 6 个系统插件（不可卸载/始终启用） |
| 内置保护 | ✅ | 内置插件 uninstall 拦截 + UI 隐藏卸载按钮 |

### Phase 4: 角色 & 效率 ✅ 完成
| 功能 | 状态 | 实现 |
|------|------|------|
| 身份档案 | ✅ | `IdentityProfile.tsx` — 玩家卡片 + 技能碎片 |
| 角色合成 | ✅ | `RoleSynthesisEngine.ts` — 操作→XP→等级 |
| 一键切换 | ✅ | `RoleSwitcher.tsx` — 角色切换 + 主题/布局联动 |
| 快速启动器 | ✅ | `QuickLauncher.tsx` — Alt+Space Spotlight 式搜索 |
| 模板库 | ✅ | `TemplateLibrary.tsx` — 项目脚手架/工作流/代码片段 |
| 效率仪表盘 | ✅ | `EfficiencyDashboard.tsx` — 每日统计可视化 |

### Phase 5: 生态 & 工作流 ✅ 完成
| 功能 | 状态 | 实现 |
|------|------|------|
| 资源中心 | ✅ | `ResourceHub.tsx` — 跨项目文件/配置聚合搜索 |
| 配置迁移 | ✅ | `ConfigMigrator.tsx` — 向导式 ESLint/tsconfig 迁移 |
| 工作流编辑器 | ✅ | `WorkflowEditor.tsx` — Canvas 拖拽节点编辑器 |
| 节点类型 | ✅ | 14 种: CLI 命令/AI 调用/文件读写/条件/循环/并行/触发器 |
| 工作流引擎 | ✅ | `engine.ts` — 断点续跑/失败重试/实时进度 |
| 定时调度 | ✅ | `scheduler.ts` — cron + 文件监听触发 |
| 行业模板 | ✅ | `WorkflowTemplates.tsx` — 游戏/Web/移动端模板 |

### Phase 6: 本地管控 ✅ 完成
| 功能 | 状态 | 实现 |
|------|------|------|
| 规则引擎 | ✅ | `ruleEngine.ts` — `when { condition } → then { action }` |
| 审计日志 | ✅ | `auditLogger.ts` — 追加式结构化日志，10MB 轮转 |
| 性能监控 | ✅ | `performanceMonitor.ts` — 内存/CPU/IPC 指标 |
| 代码分割 | ✅ | Vite `manualChunks` — views-setup/farm/eco/workflow 独立 bundle |
| 虚拟滚动 | ✅ | `VirtualList.tsx` — 项目列表动态对象池 |

---

## 4. 驾驭智能体 (Harness Agent)

### 内置工具 (15 个)
| 工具 | 用途 |
|------|------|
| `wake_projects` | 启动项目 PTY 终端 |
| `stop_projects` | 停止项目终端 |
| `check_status` | 查询 PTY 连接和 AI 状态 |
| `broadcast` | 并行广播任务到所有项目 |
| `task_project` | 向单个项目派发任务 |
| `read_project_chat` | 读取项目最近的聊天记录 |
| `health_report` | 全面体检报告 |
| `queue_status` | 任务队列状态 |
| `add_follow_up` | 追加后续任务 |
| `read_file` | 读取文件内容 |
| `write_file` | 写入文件 |
| `shell_exec` | 执行 shell 命令 |
| `generate_launch_scripts` | 为所有项目生成一键启动脚本 |
| `list_available_plugins` | 浏览插件商店目录 |
| `install_plugin` | 从插件商店自主安装插件 |

### 插件工具（动态，安装后自动注册）
- `format_with_prettier` / `lint_with_eslint` / `typecheck_tsc` / `check_outdated_deps`
- `generate_changelog` / `check_dependencies` / `audit_licenses` / `npm_security_audit`
- `start_http_server` / `start_mock_server` / `spell_check` / `minify_file`
- `pnpm_install` / `run_ts_file` / `show_tree` / `rimraf_clean`

---

## 5. 技术指标

| 指标 | 值 |
|------|-----|
| TypeScript 源文件 | 120 (56 Electron + 64 React) |
| IPC 通道 | ≈123 |
| Preload API 方法 | 103 |
| Context 状态域 | 4 (HF/Chat/Role/Theme) |
| i18n 翻译键 | ≈250 (中/英) |
| React 组件目录 | 13 (40+ 组件) |
| 代码分割 chunk | 5 (vendor-react/views-setup/views-farm/views-eco) |
| Vite 构建产物 | views-farm 266KB (gzip 70KB)，总计 ~500KB |

---

## 6. 数据持久化

所有数据存储在 `%APPDATA%/claude-harness-desktop/`:

| 文件/目录 | 用途 |
|-----------|------|
| `config.json` | 根仓库路径 + 全局设置 |
| `hf-projects.json` | 驾驭工程项目列表 |
| `hub-settings.json` | 中枢设置 (托盘/快捷键/悬浮窗) |
| `aliases.json` | CLI 别名映射 |
| `bookmarks.json` | 命令收藏 + 分组 |
| `audit.log` | 审计日志 (轮转) |
| `plugins/` | 已安装插件 manifest |
| `downloads/` | 插件下载缓存 |
| `templates/` | 自定义模板 |

---

## 7. 开发命令

```bash
npm run dev-electron     # 开发模式 (Vite + Electron)
npm run build            # 生产构建
npm start                # 构建 + 启动
dbht commit . --ai claude-code  # DBHT 提交
```

---

## 8. 更新日志

| 日期 | 内容 |
|------|------|
| 2026-05-12 | **插件生态完善**: 共享目录 catalog.ts + AI 自主安装 + smoke test 审查 + 6 个系统内置插件 + 一键启动脚本 + 居中提示弹窗模式 |
| 2026-05-11 | **插件商店 v2**: 真实 npm/pip 安装 + 下载进度 + registerShim + AI 工具注册 + agentLoop 系统提示注入 |
| 2026-05-11 | 修复端口漂移白屏: `VITE_DEV_PORT` 环境变量统一 + `strictPort: true` |
| 2026-05-10 | 驾驭智能体 4 个 bug 修复: broadcast 并行化 + memoryPressure 结构化压缩 + idle timer 排序 |
| 2026-05-10 | 全模块 i18n 双语覆盖: workflow/CLI/system/eco/identity/productivity/sandbox 全部翻译 |
| 2026-05-09 | 快捷命令面板: 模糊匹配 + 动态列表 + 滚轮/键盘导航 |
| 2026-05-09 | Claude Code `buildTool()` 工厂模式适配到 toolRegistry |
| 2026-05-01 | 6 个 Phase 全功能开发完成 |
