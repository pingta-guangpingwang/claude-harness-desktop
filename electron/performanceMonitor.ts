// PerformanceMonitor — 内存/CPU/IPC 延迟/文件 IO 指标采集
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface PerformanceSnapshot {
  timestamp: string
  memory: {
    rss: number       // Resident Set Size (bytes)
    heapTotal: number
    heapUsed: number
    external: number
  }
  cpu: {
    user: number      // 微秒
    system: number
    idle: number
  } | null
  ipcLatency: {
    avgMs: number
    maxMs: number
    minMs: number
    sampleCount: number
    recentCalls: Array<{ channel: string; durationMs: number }>
  }
  fileIO: {
    reads: number
    writes: number
    totalReadBytes: number
    totalWriteBytes: number
  }
  activePTYCount: number
  uptimeSeconds: number
}

export interface IPCLatencyRecord {
  channel: string
  startTime: number
}

export class PerformanceMonitor {
  private startTime: number
  private snapshots: PerformanceSnapshot[] = []
  private historyDir: string
  private maxSnapshots: number
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private pollIntervalMs: number

  // IPC 延迟追踪
  private pendingIPC = new Map<string, IPCLatencyRecord>()
  private ipcLatencySamples: Array<{ channel: string; durationMs: number }> = []
  private maxIPCSamples = 100

  // 文件 IO 计数
  private ioCounts = { reads: 0, writes: 0, totalReadBytes: 0, totalWriteBytes: 0 }

  /** 最后一次 CPU 快照 */
  private lastCPUSnapshot: { user: number; system: number; idle: number } | null = null

  constructor(pollIntervalMs: number = 30000, maxSnapshots: number = 720) {
    this.startTime = Date.now()
    this.pollIntervalMs = pollIntervalMs
    this.maxSnapshots = maxSnapshots
    this.historyDir = getMonitorDir()
    this.ensureDir()
  }

  /** 开始定期采集 */
  start(): void {
    if (this.pollTimer) return
    this.takeSnapshot() // 立即采一次
    this.pollTimer = setInterval(() => this.takeSnapshot(), this.pollIntervalMs)
  }

  /** 停止采集 */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  /** 记录 IPC 调用开始 */
  trackIPCStart(channel: string): string {
    const id = `${channel}_${Date.now()}_${Math.random().toString(36).slice(2)}`
    this.pendingIPC.set(id, { channel, startTime: performance.now() })
    return id
  }

  /** 记录 IPC 调用结束 */
  trackIPCEnd(id: string): void {
    const record = this.pendingIPC.get(id)
    if (!record) return
    this.pendingIPC.delete(id)
    const durationMs = performance.now() - record.startTime
    this.ipcLatencySamples.push({ channel: record.channel, durationMs })
    if (this.ipcLatencySamples.length > this.maxIPCSamples) {
      this.ipcLatencySamples.shift()
    }
  }

  /** 记录文件读取 */
  trackFileRead(bytes: number): void {
    this.ioCounts.reads++
    this.ioCounts.totalReadBytes += bytes
  }

  /** 记录文件写入 */
  trackFileWrite(bytes: number): void {
    this.ioCounts.writes++
    this.ioCounts.totalWriteBytes += bytes
  }

  /** 采集当前快照 */
  takeSnapshot(): PerformanceSnapshot {
    const mem = process.memoryUsage()

    // CPU 使用率（差异计算）
    let cpuInfo: PerformanceSnapshot['cpu'] = null
    try {
      const os = require('os')
      const cpus = os.cpus()
      let user = 0, system = 0, idle = 0
      for (const cpu of cpus) {
        user += cpu.times.user
        system += cpu.times.sys
        idle += cpu.times.idle
      }
      cpuInfo = { user, system, idle }
    } catch { /* not available */ }

    const samples = this.ipcLatencySamples
    const latencies = samples.map(s => s.durationMs)
    const ipcLatency = {
      avgMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      maxMs: latencies.length > 0 ? Math.max(...latencies) : 0,
      minMs: latencies.length > 0 ? Math.min(...latencies) : 0,
      sampleCount: samples.length,
      recentCalls: samples.slice(-10),
    }

    const snapshot: PerformanceSnapshot = {
      timestamp: new Date().toISOString(),
      memory: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external,
      },
      cpu: cpuInfo,
      ipcLatency,
      fileIO: { ...this.ioCounts },
      activePTYCount: 0, // 由外部注入
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    }

    this.snapshots.push(snapshot)
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift()
    }

    return snapshot
  }

  /** 获取最新快照 */
  getLatest(): PerformanceSnapshot | null {
    return this.snapshots[this.snapshots.length - 1] || null
  }

  /** 获取所有快照 */
  getAll(): PerformanceSnapshot[] {
    return [...this.snapshots]
  }

  /** 获取最近 N 个快照 */
  getRecent(count: number): PerformanceSnapshot[] {
    return this.snapshots.slice(-count)
  }

  /** 获取摘要 */
  getSummary(): {
    uptimeSeconds: number
    memoryMB: { rss: number; heapUsed: number }
    ipcAvgMs: number
    ioOps: { reads: number; writes: number }
    snapshotCount: number
  } {
    const latest = this.getLatest()
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      memoryMB: latest ? {
        rss: Math.round(latest.memory.rss / 1024 / 1024 * 100) / 100,
        heapUsed: Math.round(latest.memory.heapUsed / 1024 / 1024 * 100) / 100,
      } : { rss: 0, heapUsed: 0 },
      ipcAvgMs: latest ? Math.round(latest.ipcLatency.avgMs * 100) / 100 : 0,
      ioOps: { ...this.ioCounts },
      snapshotCount: this.snapshots.length,
    }
  }

  private ensureDir(): void {
    if (!existsSync(this.historyDir)) mkdirSync(this.historyDir, { recursive: true })
  }
}

function getMonitorDir(): string {
  try {
    const { app } = require('electron')
    const p = join(app.getPath('userData'), 'metrics')
    return p
  } catch { return join(process.cwd(), '.chd', 'metrics') }
}
