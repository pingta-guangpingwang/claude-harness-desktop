# DBGHF 测试报告

**日期**: 2026-05-10 | **版本**: v3.2 | **模型**: deepseek-v4-pro

## Phase 1 — Harness Agent Loop ✅

| # | 指令 | 预期 | 实际 | 耗时 | 工具 |
|---|------|------|------|------|------|
| 1 | 你好，介绍一下自己 | 自然语言回复，不调用工具 | ✅ 正确介绍能力 | 12.4s | 0 |
| 2 | 检查所有项目状态 | 调用 check_status → 格式化输出 | ✅ 表格展示在线/离线 | 9.0s | 1 |
| 3 | 读取 package.json 前20行 | 调用 read_file → 解析展示 | ✅ 表格展示关键字段 | 12.9s | 1 |

## Phase 2 — CLI Command System ✅

| # | 测试项 | 结果 |
|---|--------|------|
| 1 | 命令注册（8 个内置命令） | ✅ |
| 2 | 模糊搜索（cli:search） | ✅ |
| 3 | 参数解析（--flags, =values） | ✅ |
| 4 | 别名展开（aliases.json） | ✅ |
| 5 | 命令执行 + 历史记录 | ✅ |
| 6 | 批量执行器（串行/并行） | ✅ |
| 7 | 收藏 + 分组 | ✅ |
| 8 | 权限门控（user/elevated/admin） | ✅ |

## Phase 3 — Skill Plugin Ecosystem ✅

### 新建文件

| 文件 | 说明 | 状态 |
|------|------|------|
| `electron/plugins/types.ts` | PluginManifest, PluginInstance, PluginSandboxAPI 等 | ✅ |
| `electron/plugins/sandbox.ts` | require 白名单 + 路径隔离 + 超时包装 | ✅ |
| `electron/plugins/capabilityRegistry.ts` | provides/consumes 依赖解析 + 拓扑排序 | ✅ |
| `electron/plugins/manager.ts` | 插件生命周期（install/enable/disable/uninstall/update） | ✅ |
| `electron/plugins/installer.ts` | ZIP 下载/校验/解压/安装 | ✅ |
| `electron/plugins/versionManager.ts` | 版本快照 + 回滚（保留最近 3 个版本） | ✅ |
| `electron/plugins/rendererBridge.ts` | 动态加载插件渲染组件到槽位 | ✅ |
| `electron/plugins/pluginIpc.ts` | 17 个 IPC 通道（安装/启用/禁用/卸载/更新/列表/版本/能力/渲染） | ✅ |
| `src/components/Plugins/PluginStore.tsx` | 插件商店 UI（URL/ZIP 安装 + 已安装列表管理） | ✅ |
| `src/components/Plugins/PluginSettings.tsx` | 插件详情（权限/能力/版本历史/回滚） | ✅ |
| `src/components/Plugins/PluginPermissionPrompt.tsx` | 安装权限确认弹窗 | ✅ |

### 编译状态

- `tsconfig.node.json` (main process): ✅ 零错误
- `tsconfig.json` (renderer): ✅ 零错误

### 插件 IPC 通道清单

`plugin:install-from-zip`, `plugin:install-from-url`, `plugin:enable`, `plugin:disable`,
`plugin:uninstall`, `plugin:update`, `plugin:list`, `plugin:get`, `plugin:version-history`,
`plugin:rollback`, `plugin:capabilities`, `plugin:capabilities-by-type`, `plugin:renderer-slots`,
`plugin:renderer-components`, `plugin:validate-manifest`,
`plugin:status-changed` (push), `plugin:command-registered` (push), `plugin:tool-registered` (push)

### 如何测试 Phase 3

1. 启动应用后，在 HorseFarm 视图打开 CLI 面板 → 点击 **Plugins** 标签
2. 查看空状态（"暂无插件"）
3. 准备一个测试插件 zip（包含 `manifest.json` + `index.js`），通过本地 ZIP 路径安装
4. 观察安装成功 → 插件出现在列表中 → 可启用/禁用/卸载
5. 点击插件卡片可跳转到 PluginSettings 查看权限、能力、版本历史

### 待测 Phase 3

| # | 测试项 | 预期 | 状态 |
|---|--------|------|------|
| 1 | 安装有效插件 ZIP | 解析 manifest → 安装 → 显示在列表 | ⬜ |
| 2 | 安装无效 ZIP（无 manifest） | 返回错误 "未找到 manifest.json" | ⬜ |
| 3 | 启用/禁用插件 | 状态切换 + onEnable/onDisable 回调 | ⬜ |
| 4 | 卸载插件 | 删除目录 + 注销能力 | ⬜ |
| 5 | 版本回滚 | 恢复到历史版本 | ⬜ |
| 6 | 依赖检查 | 安装前报告缺失依赖 | ⬜ |
| 7 | 沙箱路径隔离 | 插件无法访问插件目录外的文件 | ⬜ |

## Phase 1 Agent 待测

| # | 指令 | 预期 | 状态 |
|---|------|------|------|
| 4 | 启动全部终端 | 调用 wake_projects，串行唤醒 | ⬜ |
| 5 | 停止全部终端 | 弹出确认 → stop_projects | ⬜ |
| 6 | 广播 git status | 弹出确认 → broadcast | ⬜ |
| 7 | 写入文件 | 弹出确认 → write_file | ⬜ |
| 8 | shell_exec | 弹出确认 → 执行 | ⬜ |
| 9 | 拒绝权限 | 弹窗拒绝 → 工具不执行 | ⬜ |
| 10 | 中止 Agent | 执行中中止 | ⬜ |
| 11 | 无 API Key 降级 | 关键词匹配兜底 | ⬜ |
| 12 | 危险命令拦截 | rm -rf / format 等被 deny | ⬜ |

## Phase 4 — 角色解锁 & 身份体系 ✅

| 文件 | 状态 |
|------|------|
| `src/roles/fragmentTypes.ts` — 22 种技能类型 | ✅ |
| `src/roles/roleDefinitions.ts` — 7 角色 + XP/等级算法 | ✅ |
| `src/roles/SkillFragmentCollector.ts` — 全局操作收集器 | ✅ |
| `src/roles/RoleSynthesisEngine.ts` — 角色合成引擎 | ✅ |
| `src/roles/UnlockRegistry.ts` — 20+ 功能解锁条件 | ✅ |
| `src/context/RoleContext.tsx` — useReducer + Provider | ✅ |
| `src/components/Identity/IdentityProfile.tsx` — 玩家卡片 | ✅ |
| `src/components/Identity/RoleSwitcher.tsx` — 角色切换 | ✅ |
| `src/components/Productivity/QuickLauncher.tsx` — Spotlight 启动器 | ✅ |
| `src/components/Productivity/TemplateLibrary.tsx` — 12 模板 | ✅ |
| `src/components/Productivity/LayoutManager.tsx` — 布局管理 | ✅ |
| `src/components/Productivity/EfficiencyDashboard.tsx` — 效率仪表盘 | ✅ |
| `electron/templates/engine.ts` — 模板应用引擎 | ✅ |

## 优化任务 — Claude Code 源码学习 ✅

| # | 改进项 | 来源 | 状态 |
|---|--------|------|------|
| 1 | 增强 Tool 接口 — isReadOnly/isConcurrencySafe/isDestructive/checkPermissions | Tool.ts `buildTool()` | ✅ |
| 2 | 多层权限管道 — 工具专属→规则→分组→拒绝追踪 | `hasPermissionsToUseToolInner` | ✅ |
| 3 | Agent-CLI 互通 — CLI 命令暴露为 Agent 工具 + skill_discovery | `Command` 统一抽象 | ✅ |
| 4 | 非阻塞预取 — 上下文预取不阻塞首轮 API 调用 | `startRelevantMemoryPrefetch` | ✅ |

### 修改文件

| 文件 | 变更 |
|------|------|
| `electron/harnessAgent/types.ts` | AgentTool: +5 字段 (isReadOnly, isConcurrencySafe, isDestructive, checkPermissions, interruptBehavior) |
| `electron/harnessAgent/tools.ts` | 7 个工具全部添加安全元数据 + 工具专属权限检查 |
| `electron/harnessAgent/permissionManager.ts` | 重写为 5 步管道 (工具专属→危险拦截→规则匹配→分组默认→拒绝追踪) |
| `electron/harnessAgent/agentLoop.ts` | checkTool 传递 tool 对象 + recordAllow/recordDenial + 非阻塞预取 |
| `electron/harnessAgent/cliBridge.ts` | [NEW] CLI→Agent 工具包装器 + skill_discovery 工具 |
| `electron/harnessAgent/index.ts` | 导出 cliBridge |
| `electron/modules/harnessIpc.ts` | bridgeCliToAgent() + registerSkillDiscovery() |
| `electron/cli/cliIpc.ts` | 导出 getCliRegistry(), getAliasResolver() |
| `electron/main.ts` | 桥接注册: registerHarnessIpc → registerCliIpc → bridgeCliToAgent |

### Phase 6 新增建议

基于 Claude Code 的 `StreamingToolExecutor` 并发设计，Phase 6 应加入：
- **并行工具执行**: read-only 工具 (isReadOnly=true) 在同批次中并发执行
- **Sibling abort**: 并行工具中任一报错则取消其余
- 当前工具元数据已就绪 (isReadOnly/isConcurrencySafe)，只需在 agentLoop 中实现批量分区逻辑

## 已知问题

- 无

## 已修复

- `deepseek-v4-pro` reasoning_content 回传导致 API 400 → 已修复
- 工具重复注册 console.warn 噪音 → 已静默
