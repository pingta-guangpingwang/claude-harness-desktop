// System IPC — 规则引擎 / 审计日志 / 性能监控 IPC 桥接
import { ipcMain } from 'electron'
import { RuleEngine } from '../ruleEngine'
import { AuditLogger } from '../auditLogger'
import { PerformanceMonitor } from '../performanceMonitor'
import { getTokenStore, type TokenRecord } from './tokenStore'

let ruleEngine: RuleEngine
let auditLogger: AuditLogger
let perfMonitor: PerformanceMonitor

export function getRuleEngine(): RuleEngine { return ruleEngine }
export function getAuditLogger(): AuditLogger { return auditLogger }
export function getPerfMonitor(): PerformanceMonitor { return perfMonitor }

export function registerSystemIpc(): void {
  ruleEngine = new RuleEngine()
  auditLogger = new AuditLogger()
  perfMonitor = new PerformanceMonitor()

  // 启动性能监控
  perfMonitor.start()

  // ---- Rule Engine IPC ----
  ipcMain.handle('rule:list', async () => {
    return { success: true, rules: ruleEngine.list() }
  })

  ipcMain.handle('rule:get', async (_event, ruleId: string) => {
    const rule = ruleEngine.get(ruleId)
    return { success: true, rule: rule || null }
  })

  ipcMain.handle('rule:save', async (_event, rule: any) => {
    try {
      ruleEngine.register(rule)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('rule:delete', async (_event, ruleId: string) => {
    try {
      const ok = ruleEngine.remove(ruleId)
      return { success: ok }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('rule:evaluate', async (_event, eventType: string, context: any) => {
    try {
      const triggered = ruleEngine.evaluate(eventType, context || {})
      const results: string[][] = []
      for (const rule of triggered) {
        const r = await ruleEngine.executeActions(rule, context || {})
        results.push(r)
      }
      return { success: true, triggered: triggered.map(r => r.id), results }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('rule:get-state', async () => {
    return { success: true, state: ruleEngine.getState() }
  })

  // ---- Audit Logger IPC ----
  ipcMain.handle('audit:log', async (_event, entry: any) => {
    try {
      const id = auditLogger.log(entry)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('audit:list', async (_event, limit?: number, category?: string) => {
    try {
      const entries = auditLogger.readRecent(limit || 100, category)
      return { success: true, entries }
    } catch (err) {
      return { success: false, error: String(err), entries: [] }
    }
  })

  ipcMain.handle('audit:by-project', async (_event, projectPath: string, limit?: number) => {
    try {
      const entries = auditLogger.readByProject(projectPath, limit || 100)
      return { success: true, entries }
    } catch (err) {
      return { success: false, error: String(err), entries: [] }
    }
  })

  ipcMain.handle('audit:stats', async () => {
    try {
      const stats = auditLogger.getStats()
      return { success: true, stats }
    } catch (err) {
      return { success: false, error: String(err), stats: null }
    }
  })

  ipcMain.handle('audit:clear', async () => {
    try {
      auditLogger.clear()
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ---- Performance Monitor IPC ----
  ipcMain.handle('perf:snapshot', async () => {
    try {
      const snapshot = perfMonitor.takeSnapshot()
      return { success: true, snapshot }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('perf:history', async (_event, count?: number) => {
    try {
      const snapshots = perfMonitor.getRecent(count || 30)
      return { success: true, snapshots }
    } catch (err) {
      return { success: false, error: String(err), snapshots: [] }
    }
  })

  ipcMain.handle('perf:summary', async () => {
    try {
      const summary = perfMonitor.getSummary()
      return { success: true, summary }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ---- IPC Latency Tracking ----
  ipcMain.handle('perf:ipc-start', (_event, channel: string) => {
    const id = perfMonitor.trackIPCStart(channel)
    return { success: true, id }
  })

  ipcMain.handle('perf:ipc-end', (_event, id: string) => {
    perfMonitor.trackIPCEnd(id)
    return { success: true }
  })

  // ---- Token 消耗统计 IPC ----
  ipcMain.handle('token:stats', async () => {
    try {
      const stats = getTokenStore().getStats()
      return { success: true, stats }
    } catch (err) {
      return { success: false, error: String(err), stats: null }
    }
  })

  ipcMain.handle('token:history', async (_event, limit?: number) => {
    try {
      const records = getTokenStore().readAll().slice(-(limit || 500))
      return { success: true, records }
    } catch (err) {
      return { success: false, error: String(err), records: [] }
    }
  })

  ipcMain.handle('token:conversation', async (_event, conversationId: string) => {
    try {
      const records = getTokenStore().getConversationRecords(conversationId)
      const turns = getTokenStore().getConversationTurns(conversationId)
      return { success: true, records, turns }
    } catch (err) {
      return { success: false, error: String(err), records: [], turns: [] }
    }
  })
}
