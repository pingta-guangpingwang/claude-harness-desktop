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
  // Project Metadata (评分/排序/边框色/备注)
  getProjectMetadata: () => Promise<{ success: boolean; metadata: Record<string, { rating?: number; order?: number; borderColor?: string; notes?: string }> }>
  setProjectRating: (projectPath: string, rating: number) => Promise<{ success: boolean }>
  setProjectBorderColor: (projectPath: string, color: string) => Promise<{ success: boolean }>
  setProjectOrder: (orderedPaths: string[]) => Promise<{ success: boolean }>
  saveSelectorProjectNotes: (projectPath: string, notes: string) => Promise<{ success: boolean }>
  setProjectMetadata: (projectPath: string, updates: Record<string, any>) => Promise<{ success: boolean }>
  // Resource Market（资源仓库）
  resourceStatus: () => Promise<{ success: boolean; initialized: boolean }>
  resourceQuery: (params: { query: string; repo?: string; type?: string; category?: string; maxResults?: number; minScore?: number }) => Promise<{ success: boolean; resources: Array<{ id: string; name: string; type: string; category: string; tech_stack: string[]; style_tags: string[]; score: number; source_url: string; summary: string; summary_en?: string; file: string; repo: string }> }>
  resourceList: (repo?: string) => Promise<{ success: boolean; resources: Array<{ id: string; name: string; type: string; category: string; tech_stack: string[]; style_tags: string[]; score: number; source_url: string; summary: string; summary_en?: string; file: string; repo: string }> }>
  resourceDetail: (id: string) => Promise<{ success: boolean; resource: any }>
  resourceAdd: (repo: string, resource: any) => Promise<{ success: boolean; path?: string }>
  resourceLeaderboard: (category?: string, limit?: number) => Promise<{ success: boolean; leaderboard: Array<{ id: string; name: string; type: string; score: number }> }>
  resourceChanges: (repo: string) => Promise<{ success: boolean; changes: Array<{ path: string; status: string }> }>
  resourceRepoStatus: (repo: string) => Promise<{ success: boolean; exists: boolean; isGit: boolean; branch: string; remote: string; behind: number; ahead: number; changes: Array<{ path: string; status: string }>; lastCommit: { hash: string; message: string; date: string } | null }>
  resourceCheckUpdates: (repo: string) => Promise<{ success: boolean; hasUpdates: boolean; behind: number; message: string }>
  resourceSyncPull: (repo: string) => Promise<{ success: boolean; message: string; pulled: number }>
  resourceContributeBranch: (repo: string, branchName: string) => Promise<{ success: boolean; message: string }>
  resourceContributeCommit: (repo: string, message: string) => Promise<{ success: boolean; message: string }>
  resourceContributePush: (repo: string, branchName: string) => Promise<{ success: boolean; message: string }>
  resourceContributePR: (repo: string, branchName: string, title: string, body: string) => Promise<{ success: boolean; message: string; url?: string }>
  resourceClone: (repo: string, remoteUrl?: string) => Promise<{ success: boolean; message: string }>
  resourceAutoSync: () => Promise<{ synced: string[]; message: string }>
  // Pending Resource Review
  pendingList: () => Promise<{ success: boolean; items: Array<{
    id: string; name: string; resourceType: string; targetRepo: string
    category: string; techStack: string[]; sourceUrl: string; summary: string
    rawContent: string; status: string; auditScore: number; auditNotes: string
    formattedContent: string; auditedAt: string; createdAt: string
  }>; error?: string }>
  pendingAdd: (item: any) => Promise<{ success: boolean; id?: string; error?: string }>
  pendingRemove: (id: string) => Promise<{ success: boolean; error?: string }>
  pendingUpdate: (id: string, updates: any) => Promise<{ success: boolean; error?: string }>
  pendingCount: () => Promise<{ success: boolean; count: number; error?: string }>
  pendingApprove: (id: string) => Promise<{ success: boolean; path?: string; error?: string }>
  pendingApproveAll: (repo?: string) => Promise<{ success: boolean; results: Array<{ id: string; name: string; success: boolean; message: string }>; error?: string }>
  pendingAuditAll: () => Promise<{ success: boolean; results?: Array<{ id: string; name: string; success: boolean; score: number; message: string }>; message?: string; error?: string }>
  // User Contributions
  contributionList: () => Promise<{ success: boolean; contributions: Array<{ id: string; name: string; repo: string; type: string; addedAt: string; committed: boolean; committedAt?: string; pushed: boolean; pushedAt?: string }>; error?: string }>
  contributionCheckStatus: () => Promise<{ success: boolean; repoStatuses: Record<string, { hasRemote: boolean; behind: number; localChanges: Array<{ path: string; status: string }>; uncommittedIds: string[] }>; error?: string }>
  contributionCommitAll: (message: string) => Promise<{ success: boolean; results: Array<{ repo: string; success: boolean; message: string }>; error?: string }>
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
  onProjectAdded: (handler: (projectPath: string, projectName: string) => void) => () => void
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
  chatPushMessages: (projectPath: string, messages: any[]) => Promise<{ success: boolean }>
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
  // Harness Role Management (V3.7)
  harnessRolesList: () => Promise<{ success: boolean; roles: Array<{ role: any; score: any; isCustom: boolean; enabled: boolean }>; error?: string }>
  harnessRolesCreate: (params: any) => Promise<{ success: boolean; message: string; role?: any }>
  harnessRolesDelete: (roleId: string) => Promise<{ success: boolean; message: string }>
  harnessRolesLeaderboard: (topK?: number) => Promise<{ success: boolean; leaderboard: any[] }>
  harnessRolesScoreReport: () => Promise<{ success: boolean; report: string }>
  harnessRolesSetRoleEnabled: (roleId: string, enabled: boolean) => Promise<{ success: boolean }>
  harnessRolesSetSystemEnabled: (enabled: boolean) => Promise<{ success: boolean }>
  harnessRolesLoadConfig: () => Promise<{ success: boolean; config: { roleSystemEnabled: boolean; enabledRoleIds: string[]; customRoles: any[] } }>
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
  cliBatchRun: (task: any, ctxParams: { projectIds: string[]; projectNames: Record<string, string>; apiKey?: string; model?: string }) => Promise<{
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
  pluginInstallCatalog: (payload: { pluginId: string; pluginName: string; pluginIcon: string; pluginDesc: string; pluginAuthor: string; installSpec: { manager: string; package: string; extraArgs?: string[]; checkBinary?: string }; provides: Array<{ type: string; id: string; description: string; commandTemplate?: string; toolParams?: Record<string, unknown> }> }) => Promise<{ success: boolean; pluginId?: string; binaryPath?: string; version?: string; error?: string }>
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

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
