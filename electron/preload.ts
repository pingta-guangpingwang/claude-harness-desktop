import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {

  // ============ DBHT Root Path ============
  getDBHTRootPath: () => ipcRenderer.invoke('dbghf:get-root-path'),
  setDBHTRootPath: (rootPath: string) => ipcRenderer.invoke('dbghf:set-root-path', rootPath),
  getSetupCompleted: () => ipcRenderer.invoke('dbghf:get-setup-completed'),
  setSetupCompleted: () => ipcRenderer.invoke('dbghf:set-setup-completed'),
  browseFolder: () => ipcRenderer.invoke('dbghf:browse-folder'),
  browseIndividualProject: () => ipcRenderer.invoke('dbghf:browse-individual-project'),
  listDBHTProjects: (rootPath: string) => ipcRenderer.invoke('dbghf:list-projects', rootPath),
  openFolder: (folderPath: string) => ipcRenderer.invoke('dbghf:open-folder', folderPath),

  // ============ Project Metadata (评分/排序/边框色/备注) ============
  getProjectMetadata: () => ipcRenderer.invoke('dbghf:get-project-metadata'),
  setProjectRating: (projectPath: string, rating: number) => ipcRenderer.invoke('dbghf:set-project-rating', projectPath, rating),
  setProjectBorderColor: (projectPath: string, color: string) => ipcRenderer.invoke('dbghf:set-project-border-color', projectPath, color),
  setProjectOrder: (orderedPaths: string[]) => ipcRenderer.invoke('dbghf:set-project-order', orderedPaths),
  saveSelectorProjectNotes: (projectPath: string, notes: string) => ipcRenderer.invoke('dbghf:save-project-notes', projectPath, notes),
  setProjectMetadata: (projectPath: string, updates: Record<string, any>) => ipcRenderer.invoke('dbghf:set-project-metadata', projectPath, updates),

  // ============ Horse Farm Data ============
  saveHorseFarmData: (projectPath: string, data: { requirements?: string; summary?: string }) =>
    ipcRenderer.invoke('horsefarm:save-data', projectPath, data),
  loadHorseFarmData: (projectPath: string) =>
    ipcRenderer.invoke('horsefarm:load-data', projectPath),
  generateProjectSummary: (projectPath: string, requirements: string) =>
    ipcRenderer.invoke('horsefarm:generate-summary', projectPath, requirements),
  generateMindMap: (projectPath: string, summary: string) =>
    ipcRenderer.invoke('horsefarm:generate-mindmap', projectPath, summary),
  generateKnowledgeBase: (projectPath: string, projectName: string, summary: string, requirements: string) =>
    ipcRenderer.invoke('horsefarm:generate-kb', projectPath, projectName, summary, requirements),
  readMindMapFile: (filePath: string) =>
    ipcRenderer.invoke('horsefarm:read-mindmap', filePath),
  readKnowledgeBase: (projectPath: string) =>
    ipcRenderer.invoke('horsefarm:read-kb', projectPath),
  saveHorseFarmConfig: (config: any) =>
    ipcRenderer.invoke('horsefarm:save-config', config),
  loadHorseFarmConfig: () =>
    ipcRenderer.invoke('horsefarm:load-config'),
  saveHorseFarmProjectIds: (ids: string[], individualProjects?: any) =>
    ipcRenderer.invoke('horsefarm:save-project-ids', ids, individualProjects),
  loadHorseFarmProjectIds: () =>
    ipcRenderer.invoke('horsefarm:load-project-ids'),
  onProjectAdded: (handler: (projectPath: string, projectName: string) => void) => {
    const cb = (_event: Electron.IpcRendererEvent, projectPath: string, projectName: string) => handler(projectPath, projectName)
    ipcRenderer.on('horsefarm:project-added', cb)
    return () => { ipcRenderer.removeListener('horsefarm:project-added', cb) }
  },
  initializeAllProjects: (projects: Array<{ path: string; name: string }>) =>
    ipcRenderer.invoke('horsefarm:initialize-all', projects),
  saveProjectNotes: (projectPath: string, notes: string) =>
    ipcRenderer.invoke('horsefarm:save-notes', projectPath, notes),
  loadProjectNotes: (projectPath: string) =>
    ipcRenderer.invoke('horsefarm:load-notes', projectPath),

  // ============ Resource Market（资源仓库） ============
  resourceStatus: () => ipcRenderer.invoke('resource:status'),
  resourceQuery: (params: any) => ipcRenderer.invoke('resource:query', params),
  resourceList: (repo?: string) => ipcRenderer.invoke('resource:list', repo),
  resourceDetail: (id: string) => ipcRenderer.invoke('resource:detail', id),
  resourceAdd: (repo: string, resource: any) => ipcRenderer.invoke('resource:add', repo, resource),
  resourceLeaderboard: (category?: string, limit?: number) => ipcRenderer.invoke('resource:leaderboard', category, limit),
  resourceChanges: (repo: string) => ipcRenderer.invoke('resource:changes', repo),
  resourceRepoStatus: (repo: string) => ipcRenderer.invoke('resource:repo-status', repo),
  resourceCheckUpdates: (repo: string) => ipcRenderer.invoke('resource:check-updates', repo),
  resourceSyncPull: (repo: string) => ipcRenderer.invoke('resource:sync-pull', repo),
  resourceContributeBranch: (repo: string, branchName: string) => ipcRenderer.invoke('resource:contribute-branch', repo, branchName),
  resourceContributeCommit: (repo: string, message: string) => ipcRenderer.invoke('resource:contribute-commit', repo, message),
  resourceContributePush: (repo: string, branchName: string) => ipcRenderer.invoke('resource:contribute-push', repo, branchName),
  resourceContributePR: (repo: string, branchName: string, title: string, body: string) => ipcRenderer.invoke('resource:contribute-pr', repo, branchName, title, body),
  resourceClone: (repo: string, remoteUrl?: string) => ipcRenderer.invoke('resource:clone', repo, remoteUrl),
  resourceAutoSync: () => ipcRenderer.invoke('resource:auto-sync'),

  // ============ Taxonomy（分面分类体系） ============
  taxonomyFacets: () => ipcRenderer.invoke('taxonomy:facets'),
  taxonomyResolve: (facets: any) => ipcRenderer.invoke('taxonomy:resolve', facets),
  taxonomyExpand: (facets: any) => ipcRenderer.invoke('taxonomy:expand', facets),
  taxonomyLabel: (code: string) => ipcRenderer.invoke('taxonomy:label', code),
  taxonomyChildren: (facetName: string, parentCode: string) => ipcRenderer.invoke('taxonomy:children', facetName, parentCode),
  taxonomyRoots: (facetName: string) => ipcRenderer.invoke('taxonomy:roots', facetName),

  // ============ Pending Resource Review ============
  pendingList: () => ipcRenderer.invoke('pending:list'),
  pendingAdd: (item: any) => ipcRenderer.invoke('pending:add', item),
  pendingRemove: (id: string) => ipcRenderer.invoke('pending:remove', id),
  pendingUpdate: (id: string, updates: any) => ipcRenderer.invoke('pending:update', id, updates),
  pendingCount: () => ipcRenderer.invoke('pending:count'),
  pendingCleanup: () => ipcRenderer.invoke('pending:cleanup'),
  pendingApprove: (id: string) => ipcRenderer.invoke('pending:approve', id),
  pendingApproveAll: (repo?: string) => ipcRenderer.invoke('pending:approve-all', repo),
  pendingAuditAll: () => ipcRenderer.invoke('pending:audit-all'),
  contributionList: () => ipcRenderer.invoke('contribution:list'),
  contributionCheckStatus: () => ipcRenderer.invoke('contribution:check-status'),
  contributionCommitAll: (message: string) => ipcRenderer.invoke('contribution:commit-all', message),

  // ============ Sandbox: DBHT Version Control ============
  snapshotBeforeTask: (projectPath: string, taskId: string, desc: string, summary: string) =>
    ipcRenderer.invoke('sandbox:snapshot-before-task', projectPath, taskId, desc, summary),
  commitTaskFinish: (projectPath: string, taskId: string, desc: string) =>
    ipcRenderer.invoke('sandbox:commit-task-finish', projectPath, taskId, desc),
  rollbackTask: (projectPath: string, sessionId: string) =>
    ipcRenderer.invoke('sandbox:rollback-task', projectPath, sessionId),
  getTaskHistory: (projectPath: string, sessionId?: string) =>
    ipcRenderer.invoke('sandbox:get-task-history', projectPath, sessionId),
  getProjectDBHTStatus: (projectPath: string) =>
    ipcRenderer.invoke('sandbox:get-project-status', projectPath),

  // ============ Middleware Box Bridge ============
  middlewareStart: () => ipcRenderer.invoke('middleware:start'),
  middlewareStop: () => ipcRenderer.invoke('middleware:stop'),
  middlewareGetStatus: () => ipcRenderer.invoke('middleware:get-status'),
  middlewareRegisterAgent: (ctx: any) => ipcRenderer.invoke('middleware:register-agent', ctx),
  middlewareUnregisterAgent: (agentId: string) => ipcRenderer.invoke('middleware:unregister-agent', agentId),
  middlewareProcessRequest: (request: any) => ipcRenderer.invoke('middleware:process-request', request),
  middlewareGetAgentProfiles: () => ipcRenderer.invoke('middleware:get-agent-profiles'),
  middlewareGetAgentProfile: (agentId: string) => ipcRenderer.invoke('middleware:get-agent-profile', agentId),
  middlewareCompareAgents: (agentIds: string[]) => ipcRenderer.invoke('middleware:compare-agents', agentIds),
  middlewareRegisterSkill: (skill: any) => ipcRenderer.invoke('middleware:register-skill', skill),
  middlewareListSkills: () => ipcRenderer.invoke('middleware:list-skills'),
  middlewareGetHealth: () => ipcRenderer.invoke('middleware:get-health'),
  middlewareResetCircuitBreaker: (breakerId: string) => ipcRenderer.invoke('middleware:reset-circuit-breaker', breakerId),

  // ============ Hub Settings ============
  getHubSettings: () => ipcRenderer.invoke('hub:get-settings'),
  setHubSettings: (settings: any) => ipcRenderer.invoke('hub:set-settings', settings),
  updateHubSetting: (key: string, value: any) => ipcRenderer.invoke('hub:update-setting', key, value),

  // ============ Hub: Tray / Hotkey / Floating / Scheduler (v3.4) ============
  hubShowMain: () => ipcRenderer.invoke('hub:show-main'),
  hubIsMainVisible: () => ipcRenderer.invoke('hub:is-main-visible'),
  hubToggleFloating: () => ipcRenderer.invoke('hub:toggle-floating'),
  hubCloseFloating: () => ipcRenderer.invoke('hub:close-floating'),
  hubFloatingConfig: () => ipcRenderer.invoke('hub:floating-config'),
  hubUpdateFloatingConfig: (config: any) => ipcRenderer.invoke('hub:update-floating-config', config),
  hubAutoStartStatus: () => ipcRenderer.invoke('hub:auto-start-status'),
  hubAutoStartToggle: () => ipcRenderer.invoke('hub:auto-start-toggle'),
  hubAutoStartSet: (enabled: boolean) => ipcRenderer.invoke('hub:auto-start-set', enabled),
  hubSchedulerStatus: () => ipcRenderer.invoke('hub:scheduler-status'),
  hubSchedulerSetLimit: (type: string, limit: number) => ipcRenderer.invoke('hub:scheduler-set-limit', type, limit),
  hubOnTrayAction: (callback: (action: string) => void) => {
    ipcRenderer.on('tray:action', (_event, action) => callback(action))
  },
  hubOnHotkeySummon: (callback: () => void) => {
    ipcRenderer.on('hotkey:summon', () => callback())
  },

  // ============ Launcher (v3.0) ============
  openInVSCode: (projectPath: string) => ipcRenderer.invoke('launcher:open-vscode', projectPath),

  // ============ Project Launcher (v3.6) — 一键启动 bat ============
  checkLaunchBat: (projectPath: string) => ipcRenderer.invoke('project:check-launch-bat', projectPath),
  generateLaunchBat: (projectPath: string, projectName?: string) => ipcRenderer.invoke('project:generate-launch-bat', projectPath, projectName),
  generateAllLaunchBats: (projects: Array<{ path: string; name: string }>) => ipcRenderer.invoke('project:generate-all-launch-bats', projects),
  launchProject: (projectPath: string) => ipcRenderer.invoke('project:launch', projectPath),

  // ============ PTY Terminal Proxy (v3.0 - 多项目并行) ============
  ptySpawn: (projectPath: string, command?: string, args?: string[]) =>
    ipcRenderer.invoke('pty:spawn', projectPath, command, args),
  ptyWrite: (projectPath: string, data: string) => ipcRenderer.invoke('pty:write', projectPath, data),
  ptyResize: (projectPath: string, cols: number, rows: number) => ipcRenderer.invoke('pty:resize', projectPath, cols, rows),
  ptyKill: (projectPath?: string) => ipcRenderer.invoke('pty:kill', projectPath),
  ptyGetStatus: (projectPath: string) => ipcRenderer.invoke('pty:status', projectPath) as Promise<{ connected: boolean; sessionId: string | null; pid: number | null; lastDataAt: number }>,
  ptyOnData: (callback: (projectPath: string, data: string) => void) => {
    const handler = (_event: any, projectPath: string, data: string) => callback(projectPath, data)
    ipcRenderer.on('pty:data', handler)
    return () => { ipcRenderer.removeListener('pty:data', handler) }
  },
  ptyOnExit: (callback: (projectPath: string, code: number) => void) => {
    const handler = (_event: any, projectPath: string, code: number) => callback(projectPath, code)
    ipcRenderer.on('pty:exit', handler)
    return () => { ipcRenderer.removeListener('pty:exit', handler) }
  },
  ptyOnSpawned: (callback: (projectPath: string, sessionId: string, pid: number) => void) => {
    const handler = (_event: any, projectPath: string, sessionId: string, pid: number) => callback(projectPath, sessionId, pid)
    ipcRenderer.on('pty:spawned', handler)
    return () => { ipcRenderer.removeListener('pty:spawned', handler) }
  },

  harnessRelay: (request: any) => ipcRenderer.invoke('harness:relay', request),

  // ============ Session / Chat History (v3.0) ============
  sessionList: (projectPath?: string) => ipcRenderer.invoke('session:list', projectPath),
  sessionListMulti: (projectPaths: string[]) => ipcRenderer.invoke('session:list-multi', projectPaths),
  sessionGet: (projectPath: string, sessionId: string) => ipcRenderer.invoke('session:get', projectPath, sessionId),
  sessionDelete: (projectPath: string, sessionId: string) => ipcRenderer.invoke('session:delete', projectPath, sessionId),
  sessionSave: (session: any) => ipcRenderer.invoke('session:save', session),
  chatPushMessages: (projectPath: string, messages: any[]) => ipcRenderer.invoke('chat:pushMessages', projectPath, messages),

  // ============ Audit (v3.0) ============
  auditGetProjectEvents: (projectPath: string) => ipcRenderer.invoke('audit:get-project-events', projectPath),
  auditGetMiddlewareStats: () => ipcRenderer.invoke('audit:get-middleware-stats'),

  // ============ Harness Agent (v3.1) ============
  harnessSend: (request: {
    message: string
    projectIds: string[]
    projectNames: Record<string, string>
    onlineProjects: string[]
    apiKey: string
    model: string
    permissions?: Record<string, boolean>
    autonomous?: boolean
  }) => ipcRenderer.invoke('harness:send', request),
  harnessAbort: () => ipcRenderer.invoke('harness:abort'),
  harnessResolvePermission: (decision: 'allow' | 'deny' | 'allow_once') =>
    ipcRenderer.invoke('harness:resolve-permission', decision),
  harnessGetPermissions: () => ipcRenderer.invoke('harness:get-permissions'),
  harnessSetPermissions: (permissions: Record<string, boolean>) =>
    ipcRenderer.invoke('harness:set-permissions', permissions),
  harnessOnEvent: (callback: (event: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('harness:event', handler)
    return () => { ipcRenderer.removeListener('harness:event', handler) }
  },

  // ============ Harness Scheduler (v3.5) ============
  harnessScheduleAdd: (opts: { name: string; prompt: string; intervalMs: number; projectPath?: string }) =>
    ipcRenderer.invoke('harness:schedule-add', opts),
  harnessScheduleAddOnce: (opts: { name: string; prompt: string; delayMs: number; projectPath?: string }) =>
    ipcRenderer.invoke('harness:schedule-add-once', opts),
  harnessScheduleRemove: (id: string) => ipcRenderer.invoke('harness:schedule-remove', id),
  harnessScheduleSetEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('harness:schedule-set-enabled', id, enabled),
  harnessScheduleList: () => ipcRenderer.invoke('harness:schedule-list'),
  harnessSaveLogs: (logs: any[]) => ipcRenderer.invoke('harness:save-logs', logs),
  harnessLoadLogs: () => ipcRenderer.invoke('harness:load-logs'),

  // ============ Harness Role Management (V3.7) ============
  harnessRolesList: () => ipcRenderer.invoke('harness:roles-list'),
  harnessRolesCreate: (params: any) => ipcRenderer.invoke('harness:roles-create', params),
  harnessRolesDelete: (roleId: string) => ipcRenderer.invoke('harness:roles-delete', roleId),
  harnessRolesLeaderboard: (topK?: number) => ipcRenderer.invoke('harness:roles-leaderboard', topK),
  harnessRolesScoreReport: () => ipcRenderer.invoke('harness:roles-score-report'),
  harnessRolesSetRoleEnabled: (roleId: string, enabled: boolean) => ipcRenderer.invoke('harness:roles-set-role-enabled', roleId, enabled),
  harnessRolesSetSystemEnabled: (enabled: boolean) => ipcRenderer.invoke('harness:roles-set-system-enabled', enabled),
  harnessRolesLoadConfig: () => ipcRenderer.invoke('harness:roles-load-config'),

  // ============ CLI Command System (v3.1) ============
  cliSearch: (query: string) => ipcRenderer.invoke('cli:search', query),
  cliList: () => ipcRenderer.invoke('cli:list'),
  cliExecute: (request: {
    command: string
    args: Record<string, unknown>
    projectIds: string[]
    projectNames: Record<string, string>
    projectPath?: string
    apiKey?: string
    model?: string
  }) => ipcRenderer.invoke('cli:execute', request),
  cliBatchRun: (task: any, ctxParams: { projectIds: string[]; projectNames: Record<string, string>; apiKey?: string; model?: string }) =>
    ipcRenderer.invoke('cli:batch-run', task, ctxParams),
  cliBatchAbort: () => ipcRenderer.invoke('cli:batch-abort'),
  cliBatchOnProgress: (callback: (event: any) => void) => {
    ipcRenderer.on('cli:batch-progress', (_event, data) => callback(data))
  },
  cliOnPermissionNeeded: (callback: (event: { command: string; level: string }) => void) => {
    ipcRenderer.on('cli:permission-needed', (_event, data) => callback(data))
  },
  cliPermissionRespond: (decision: boolean) => ipcRenderer.invoke('cli:permission-response', decision),
  cliAliasList: () => ipcRenderer.invoke('cli:alias-list'),
  cliAliasAdd: (alias: string, expandsTo: string, description?: string) =>
    ipcRenderer.invoke('cli:alias-add', alias, expandsTo, description),
  cliAliasRemove: (alias: string) => ipcRenderer.invoke('cli:alias-remove', alias),
  cliHistory: (limit?: number, commandFilter?: string) => ipcRenderer.invoke('cli:history', limit, commandFilter),
  cliHistoryClear: () => ipcRenderer.invoke('cli:history-clear'),
  cliBookmarkList: () => ipcRenderer.invoke('cli:bookmark-list'),
  cliBookmarkAdd: (bookmark: { name: string; command: string; args: Record<string, unknown>; projectPath?: string }) =>
    ipcRenderer.invoke('cli:bookmark-add', bookmark),
  cliBookmarkRemove: (id: string) => ipcRenderer.invoke('cli:bookmark-remove', id),
  cliGroupList: () => ipcRenderer.invoke('cli:group-list'),
  cliGroupCreate: (name: string) => ipcRenderer.invoke('cli:group-create', name),
  cliGroupDelete: (id: string) => ipcRenderer.invoke('cli:group-delete', id),
  cliGroupAddBookmark: (groupId: string, bookmarkId: string) =>
    ipcRenderer.invoke('cli:group-add-bookmark', groupId, bookmarkId),
  cliGroupRemoveBookmark: (groupId: string, bookmarkId: string) =>
    ipcRenderer.invoke('cli:group-remove-bookmark', groupId, bookmarkId),

  // ============ Plugin System (v3.2) ============
  pluginInstallFromZip: (zipPath: string) => ipcRenderer.invoke('plugin:install-from-zip', zipPath),
  pluginInstallFromUrl: (url: string, checksum?: string) => ipcRenderer.invoke('plugin:install-from-url', url, checksum),
  pluginInstallCatalog: (payload: any) => ipcRenderer.invoke('plugin:install-catalog', payload),
  pluginEnable: (pluginId: string) => ipcRenderer.invoke('plugin:enable', pluginId),
  pluginDisable: (pluginId: string) => ipcRenderer.invoke('plugin:disable', pluginId),
  pluginUninstall: (pluginId: string) => ipcRenderer.invoke('plugin:uninstall', pluginId),
  pluginUpdate: (pluginId: string, zipPath: string) => ipcRenderer.invoke('plugin:update', pluginId, zipPath),
  pluginList: () => ipcRenderer.invoke('plugin:list'),
  pluginGet: (pluginId: string) => ipcRenderer.invoke('plugin:get', pluginId),
  pluginVersionHistory: (pluginId: string) => ipcRenderer.invoke('plugin:version-history', pluginId),
  pluginRollback: (pluginId: string, targetVersion: string) => ipcRenderer.invoke('plugin:rollback', pluginId, targetVersion),
  pluginCapabilities: () => ipcRenderer.invoke('plugin:capabilities'),
  pluginCapabilitiesByType: (type: string) => ipcRenderer.invoke('plugin:capabilities-by-type', type),
  pluginRendererSlots: () => ipcRenderer.invoke('plugin:renderer-slots'),
  pluginRendererComponents: (slotId: string) => ipcRenderer.invoke('plugin:renderer-components', slotId),
  pluginValidateManifest: (manifest: unknown) => ipcRenderer.invoke('plugin:validate-manifest', manifest),
  pluginOnStatusChanged: (callback: (event: { pluginId: string; status: string }) => void) => {
    ipcRenderer.on('plugin:status-changed', (_event, data) => callback(data))
  },
  pluginOnCommandRegistered: (callback: (event: { name: string; pluginId: string }) => void) => {
    ipcRenderer.on('plugin:command-registered', (_event, data) => callback(data))
  },
  pluginOnInstallProgress: (callback: (event: { url: string; pct: number; loaded: number; total: number; done?: boolean }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('plugin:install-progress', handler)
    return () => { ipcRenderer.removeListener('plugin:install-progress', handler) }
  },
  pluginOnToolRegistered: (callback: (event: { name: string; pluginId: string }) => void) => {
    ipcRenderer.on('plugin:tool-registered', (_event, data) => callback(data))
  },

  // ============ Workflow System (v3.3) ============
  workflowRegister: (workflow: any) => ipcRenderer.invoke('workflow:register', workflow),
  workflowUnregister: (workflowId: string) => ipcRenderer.invoke('workflow:unregister', workflowId),
  workflowRun: (workflowId: string) => ipcRenderer.invoke('workflow:run', workflowId),
  workflowAbort: (runId: string) => ipcRenderer.invoke('workflow:abort', runId),
  workflowList: () => ipcRenderer.invoke('workflow:list'),
  workflowGetState: (runId: string) => ipcRenderer.invoke('workflow:get-state', runId),
  workflowGetActiveRuns: () => ipcRenderer.invoke('workflow:get-active-runs'),
  workflowSave: (workflow: any) => ipcRenderer.invoke('workflow:save', workflow),
  workflowLoad: () => ipcRenderer.invoke('workflow:load'),
  workflowDelete: (workflowId: string) => ipcRenderer.invoke('workflow:delete', workflowId),
  workflowSubscribe: (runId: string) => ipcRenderer.invoke('workflow:subscribe', runId),
  workflowOnEvent: (callback: (event: any) => void) => {
    ipcRenderer.on('workflow:event', (_event, data) => callback(data))
  },

  // ============ System: Rules / Audit / Performance (v3.3) ============
  ruleList: () => ipcRenderer.invoke('rule:list'),
  ruleGet: (ruleId: string) => ipcRenderer.invoke('rule:get', ruleId),
  ruleSave: (rule: any) => ipcRenderer.invoke('rule:save', rule),
  ruleDelete: (ruleId: string) => ipcRenderer.invoke('rule:delete', ruleId),
  ruleEvaluate: (eventType: string, context: any) => ipcRenderer.invoke('rule:evaluate', eventType, context),
  ruleGetState: () => ipcRenderer.invoke('rule:get-state'),
  auditLog: (entry: any) => ipcRenderer.invoke('audit:log', entry),
  auditLogList: (limit?: number, category?: string) => ipcRenderer.invoke('audit:list', limit, category),
  auditLogByProject: (projectPath: string, limit?: number) => ipcRenderer.invoke('audit:by-project', projectPath, limit),
  auditLogStats: () => ipcRenderer.invoke('audit:stats'),
  auditLogClear: () => ipcRenderer.invoke('audit:clear'),
  tokenStats: () => ipcRenderer.invoke('token:stats'),
  tokenHistory: (limit?: number) => ipcRenderer.invoke('token:history', limit),
  tokenConversation: (conversationId: string) => ipcRenderer.invoke('token:conversation', conversationId),
  perfSnapshot: () => ipcRenderer.invoke('perf:snapshot'),
  perfHistory: (count?: number) => ipcRenderer.invoke('perf:history', count),
  perfSummary: () => ipcRenderer.invoke('perf:summary'),
})

export interface ElectronAPI {
  // DBHT
  getDBHTRootPath: () => Promise<{ success: boolean; rootPath: string }>
  setDBHTRootPath: (rootPath: string) => Promise<{ success: boolean; message?: string }>
  getSetupCompleted: () => Promise<{ success: boolean; completed: boolean }>
  setSetupCompleted: () => Promise<{ success: boolean }>
  browseFolder: () => Promise<{ success: boolean; path: string }>
  browseIndividualProject: () => Promise<{ success: boolean; path: string; name?: string }>
  listDBHTProjects: (rootPath: string) => Promise<{ success: boolean; projects: Array<{ path: string; name: string; repoPath: string; status: string; source: string }>; message?: string }>
  openFolder: (folderPath: string) => Promise<{ success: boolean }>
  // Horse Farm
  saveHorseFarmData: (projectPath: string, data: { requirements?: string; summary?: string }) => Promise<{ success: boolean; message?: string }>
  loadHorseFarmData: (projectPath: string) => Promise<{ success: boolean; exists?: boolean; requirements?: string; summary?: string; mindmapPath?: string; kbPath?: string }>
  generateProjectSummary: (projectPath: string, requirements: string) => Promise<{ success: boolean; summary?: string; message?: string }>
  generateMindMap: (projectPath: string, summary: string) => Promise<{ success: boolean; filePath?: string; data?: any; message?: string }>
  generateKnowledgeBase: (projectPath: string, projectName: string, summary: string, requirements: string) => Promise<{ success: boolean; filePath?: string; message?: string }>
  readMindMapFile: (filePath: string) => Promise<{ success: boolean; data?: any; message?: string }>
  readKnowledgeBase: (projectPath: string) => Promise<{ success: boolean; content?: string; message?: string }>
  saveHorseFarmConfig: (config: any) => Promise<{ success: boolean; message?: string }>
  loadHorseFarmConfig: () => Promise<{ success: boolean; config: any }>
  saveHorseFarmProjectIds: (ids: string[], individualProjects?: any) => Promise<{ success: boolean }>
  loadHorseFarmProjectIds: () => Promise<{ success: boolean; ids: string[]; individualProjects: Record<string, any> }>
  initializeAllProjects: (projects: Array<{ path: string; name: string }>) => Promise<{ success: boolean; results: Array<{ path: string; name: string; kb: string; mindmap: string }> }>
  saveProjectNotes: (projectPath: string, notes: string) => Promise<{ success: boolean; message?: string }>
  loadProjectNotes: (projectPath: string) => Promise<{ success: boolean; notes: string; message?: string }>
  // Sandbox
  snapshotBeforeTask: (projectPath: string, taskId: string, desc: string, summary: string) => Promise<{ success: boolean; message?: string; versionId?: string }>
  commitTaskFinish: (projectPath: string, taskId: string, desc: string) => Promise<{ success: boolean; message?: string; versionId?: string }>
  rollbackTask: (projectPath: string, sessionId: string) => Promise<{ success: boolean; message?: string }>
  getTaskHistory: (projectPath: string, sessionId?: string) => Promise<{ success: boolean; commits?: any[]; message?: string }>
  getProjectDBHTStatus: (projectPath: string) => Promise<{ success: boolean; dbhtAvailable: boolean; dbhtVersion?: string; projectStatus?: any }>
  // Middleware Box
  middlewareStart: () => Promise<{ success: boolean; status?: any; message?: string }>
  middlewareStop: () => Promise<{ success: boolean; message?: string }>
  middlewareGetStatus: () => Promise<{ success: boolean; status: any }>
  middlewareRegisterAgent: (ctx: any) => Promise<{ success: boolean; agentId?: string; message?: string }>
  middlewareUnregisterAgent: (agentId: string) => Promise<{ success: boolean; message?: string }>
  middlewareProcessRequest: (request: any) => Promise<{ success: boolean; response?: any; message?: string }>
  middlewareGetAgentProfiles: () => Promise<{ success: boolean; profiles: any[] }>
  middlewareGetAgentProfile: (agentId: string) => Promise<{ success: boolean; profile: any }>
  middlewareCompareAgents: (agentIds: string[]) => Promise<{ success: boolean; comparison: any }>
  middlewareRegisterSkill: (skill: any) => Promise<{ success: boolean; message?: string }>
  middlewareListSkills: () => Promise<{ success: boolean; skills: any[] }>
  middlewareGetHealth: () => Promise<{ success: boolean; health: any }>
  middlewareResetCircuitBreaker: (breakerId: string) => Promise<{ success: boolean; message?: string }>
  // Hub Settings
  getHubSettings: () => Promise<{ success: boolean; settings: any }>
  setHubSettings: (settings: any) => Promise<{ success: boolean; message?: string }>
  updateHubSetting: (key: string, value: any) => Promise<{ success: boolean }>
  // Hub: Tray / Hotkey / Floating / Scheduler (v3.4)
  hubShowMain: () => Promise<{ success: boolean }>
  hubIsMainVisible: () => Promise<{ success: boolean; visible: boolean }>
  hubToggleFloating: () => Promise<{ success: boolean; floatingOpen: boolean }>
  hubCloseFloating: () => Promise<{ success: boolean }>
  hubFloatingConfig: () => Promise<{ success: boolean; config: any }>
  hubUpdateFloatingConfig: (config: any) => Promise<{ success: boolean }>
  hubAutoStartStatus: () => Promise<{ success: boolean; enabled: boolean }>
  hubAutoStartToggle: () => Promise<{ success: boolean; enabled: boolean }>
  hubAutoStartSet: (enabled: boolean) => Promise<{ success: boolean }>
  hubSchedulerStatus: () => Promise<{ success: boolean; status: any }>
  hubSchedulerSetLimit: (type: string, limit: number) => Promise<{ success: boolean }>
  hubOnTrayAction: (callback: (action: string) => void) => void
  hubOnHotkeySummon: (callback: () => void) => void
  // Launcher (v3.0)
  openInVSCode: (projectPath: string) => Promise<{ success: boolean; message?: string }>
  // Project Launcher (v3.6) — 一键启动 bat
  checkLaunchBat: (projectPath: string) => Promise<{ success: boolean; exists: boolean }>
  generateLaunchBat: (projectPath: string, projectName?: string) => Promise<{ success: boolean; command: string; message?: string }>
  generateAllLaunchBats: (projects: Array<{ path: string; name: string }>) => Promise<{ success: boolean; results: Array<{ path: string; name: string; success: boolean; command: string; message?: string }> }>
  launchProject: (projectPath: string) => Promise<{ success: boolean; message?: string }>
  // PTY Terminal Proxy (v3.0 - 多项目并行)
  ptySpawn: (projectPath: string, command?: string, args?: string[]) => Promise<{ success: boolean; pid?: number; sessionId?: string; message?: string }>
  ptyWrite: (projectPath: string, data: string) => Promise<{ success: boolean }>
  ptyResize: (projectPath: string, cols: number, rows: number) => Promise<{ success: boolean }>
  ptyKill: (projectPath?: string) => Promise<{ success: boolean }>
  ptyGetStatus: (projectPath: string) => Promise<{ connected: boolean; sessionId: string | null; pid: number | null; lastDataAt: number }>
  ptyOnData: (callback: (projectPath: string, data: string) => void) => () => void
  ptyOnExit: (callback: (projectPath: string, code: number) => void) => () => void
  ptyOnSpawned: (callback: (projectPath: string, sessionId: string, pid: number) => void) => () => void
  // Session (v3.0)
  sessionList: (projectPath?: string) => Promise<{ success: boolean; sessions: any[] }>
  sessionGet: (projectPath: string, sessionId: string) => Promise<{ success: boolean; session: any }>
  sessionDelete: (projectPath: string, sessionId: string) => Promise<{ success: boolean }>
  sessionSave: (session: any) => Promise<{ success: boolean }>
  // Audit (v3.0)
  auditGetProjectEvents: (projectPath: string) => Promise<{ success: boolean; events: any[]; message?: string }>
  auditGetMiddlewareStats: () => Promise<{ success: boolean; stats?: any; message?: string }>
  // Harness Agent (v3.1)
  harnessSend: (request: {
    message: string
    projectIds: string[]
    projectNames: Record<string, string>
    onlineProjects: string[]
    apiKey: string
    model: string
    permissions?: Record<string, boolean>
    autonomous?: boolean
  }) => Promise<{ success: boolean; finalMessage?: string; error?: string }>
  harnessAbort: () => Promise<{ success: boolean; error?: string }>
  harnessResolvePermission: (decision: 'allow' | 'deny' | 'allow_once') => Promise<{ success: boolean; error?: string }>
  harnessGetPermissions: () => Promise<{ success: boolean; permissions: Record<string, boolean> }>
  harnessSetPermissions: (permissions: Record<string, boolean>) => Promise<{ success: boolean }>
  harnessOnEvent: (callback: (event: any) => void) => () => void
  // Harness Scheduler (v3.5)
  harnessScheduleAdd: (opts: { name: string; prompt: string; intervalMs: number; projectPath?: string }) => Promise<{ success: boolean; id: string }>
  harnessScheduleAddOnce: (opts: { name: string; prompt: string; delayMs: number; projectPath?: string }) => Promise<{ success: boolean; id: string }>
  harnessScheduleRemove: (id: string) => Promise<{ success: boolean; error?: string }>
  harnessScheduleSetEnabled: (id: string, enabled: boolean) => Promise<{ success: boolean }>
  harnessScheduleList: () => Promise<{ success: boolean; tasks: any[]; stats: any }>
  harnessSaveLogs: (logs: any[]) => Promise<{ success: boolean; error?: string }>
  harnessLoadLogs: () => Promise<{ success: boolean; logs: any[] }>
  // CLI Command System (v3.1)
  cliSearch: (query: string) => Promise<{ success: boolean; commands: any[] }>
  cliList: () => Promise<{ success: boolean; commands: any[] }>
  cliExecute: (request: {
    command: string
    args: Record<string, unknown>
    projectIds: string[]
    projectNames: Record<string, string>
    projectPath?: string
    apiKey?: string
    model?: string
  }) => Promise<{ success: boolean; output: string; metadata?: Record<string, unknown> }>
  cliBatchRun: (task: any, ctxParams: any) => Promise<{
    taskId: string; results: any[]; totalDurationMs: number; successCount: number; failCount: number
  }>
  cliBatchAbort: () => Promise<{ success: boolean }>
  cliBatchOnProgress: (callback: (event: any) => void) => void
  cliOnPermissionNeeded: (callback: (event: { command: string; level: string }) => void) => void
  cliPermissionRespond: (decision: boolean) => Promise<{ success: boolean }>
  cliAliasList: () => Promise<{ success: boolean; aliases: any[] }>
  cliAliasAdd: (alias: string, expandsTo: string, description?: string) => Promise<{ success: boolean }>
  cliAliasRemove: (alias: string) => Promise<{ success: boolean }>
  cliHistory: (limit?: number, commandFilter?: string) => Promise<{ success: boolean; entries: any[] }>
  cliHistoryClear: () => Promise<{ success: boolean }>
  cliBookmarkList: () => Promise<{ success: boolean; bookmarks: any[] }>
  cliBookmarkAdd: (bookmark: { name: string; command: string; args: Record<string, unknown>; projectPath?: string }) => Promise<{ success: boolean; bookmark: any }>
  cliBookmarkRemove: (id: string) => Promise<{ success: boolean }>
  cliGroupList: () => Promise<{ success: boolean; groups: any[] }>
  cliGroupCreate: (name: string) => Promise<{ success: boolean; group: any }>
  cliGroupDelete: (id: string) => Promise<{ success: boolean }>
  cliGroupAddBookmark: (groupId: string, bookmarkId: string) => Promise<{ success: boolean }>
  cliGroupRemoveBookmark: (groupId: string, bookmarkId: string) => Promise<{ success: boolean }>
  // Plugin System (v3.2)
  pluginInstallFromZip: (zipPath: string) => Promise<{ success: boolean; pluginId?: string; error?: string }>
  pluginInstallFromUrl: (url: string, checksum?: string) => Promise<{ success: boolean; pluginId?: string; error?: string }>
  pluginInstallCatalog: (payload: any) => Promise<{ success: boolean; pluginId?: string; binaryPath?: string; version?: string; error?: string }>
  pluginEnable: (pluginId: string) => Promise<{ success: boolean; error?: string }>
  pluginDisable: (pluginId: string) => Promise<{ success: boolean; error?: string }>
  pluginUninstall: (pluginId: string) => Promise<{ success: boolean; error?: string }>
  pluginUpdate: (pluginId: string, zipPath: string) => Promise<{ success: boolean; pluginId?: string; error?: string }>
  pluginList: () => Promise<Array<{ id: string; name: string; version: string; description: string; author: string; status: string; error?: string; installedAt: string; enabledAt?: string }>>
  pluginGet: (pluginId: string) => Promise<{ id: string; name: string; version: string; description: string; author: string; permissions: string[]; provides: any[]; consumes: any[]; status: string; error?: string; installedAt: string; enabledAt?: string } | null>
  pluginVersionHistory: (pluginId: string) => Promise<Array<{ version: string; installedAt: string; backupPath: string; checksum?: string }>>
  pluginRollback: (pluginId: string, targetVersion: string) => Promise<{ success: boolean; error?: string }>
  pluginCapabilities: () => Promise<Array<{ type: string; id: string; description: string; pluginId: string }>>
  pluginCapabilitiesByType: (type: string) => Promise<Array<{ type: string; id: string; description: string; pluginId: string }>>
  pluginRendererSlots: () => Promise<string[]>
  pluginRendererComponents: (slotId: string) => Promise<Array<{ pluginId: string; slotId: string; html: string; css: string; script: string }>>
  pluginValidateManifest: (manifest: unknown) => Promise<{ valid: boolean; errors: string[] }>
  pluginOnStatusChanged: (callback: (event: { pluginId: string; status: string }) => void) => void
  pluginOnCommandRegistered: (callback: (event: { name: string; pluginId: string }) => void) => void
  pluginOnToolRegistered: (callback: (event: { name: string; pluginId: string }) => void) => void
  pluginOnInstallProgress: (callback: (event: { url: string; pct: number; loaded: number; total: number; done?: boolean }) => void) => () => void
  // Workflow System (v3.3)
  workflowRegister: (workflow: any) => Promise<{ success: boolean; error?: string }>
  workflowUnregister: (workflowId: string) => Promise<{ success: boolean; error?: string }>
  workflowRun: (workflowId: string) => Promise<{ success: boolean; runId?: string; error?: string }>
  workflowAbort: (runId: string) => Promise<{ success: boolean; error?: string }>
  workflowList: () => Promise<{ success: boolean; workflows: string[] }>
  workflowGetState: (runId: string) => Promise<{ success: boolean; state: any }>
  workflowGetActiveRuns: () => Promise<{ success: boolean; runs: any[] }>
  workflowSave: (workflow: any) => Promise<{ success: boolean; error?: string }>
  workflowLoad: () => Promise<{ success: boolean; workflows: any[]; error?: string }>
  workflowDelete: (workflowId: string) => Promise<{ success: boolean; error?: string }>
  workflowSubscribe: (runId: string) => Promise<{ success: boolean }>
  workflowOnEvent: (callback: (event: any) => void) => void
  // System: Rules / Audit / Performance (v3.3)
  ruleList: () => Promise<{ success: boolean; rules: any[] }>
  ruleGet: (ruleId: string) => Promise<{ success: boolean; rule: any }>
  ruleSave: (rule: any) => Promise<{ success: boolean; error?: string }>
  ruleDelete: (ruleId: string) => Promise<{ success: boolean; error?: string }>
  ruleEvaluate: (eventType: string, context: any) => Promise<{ success: boolean; triggered: string[]; results: string[][] }>
  ruleGetState: () => Promise<{ success: boolean; state: any }>
  auditLog: (entry: any) => Promise<{ success: boolean; id: string }>
  auditLogList: (limit?: number, category?: string) => Promise<{ success: boolean; entries: any[] }>
  auditLogByProject: (projectPath: string, limit?: number) => Promise<{ success: boolean; entries: any[] }>
  auditLogStats: () => Promise<{ success: boolean; stats: any }>
  auditLogClear: () => Promise<{ success: boolean }>
  tokenStats: () => Promise<{ success: boolean; stats: any; error?: string }>
  tokenHistory: (limit?: number) => Promise<{ success: boolean; records: any[]; error?: string }>
  tokenConversation: (conversationId: string) => Promise<{ success: boolean; records: any[]; turns: any[]; error?: string }>
  perfSnapshot: () => Promise<{ success: boolean; snapshot: any }>
  perfHistory: (count?: number) => Promise<{ success: boolean; snapshots: any[] }>
  perfSummary: () => Promise<{ success: boolean; summary: any }>
}
