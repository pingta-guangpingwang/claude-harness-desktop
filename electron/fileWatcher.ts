// FileWatcherService — chokidar 文件监听，支持变动触发规则/工作流
import { FSWatcher, watch } from 'fs'
import { join } from 'path'

export interface WatchTarget {
  path: string
  patterns: string[]
  ignorePatterns: string[]
  onAdd?: (filePath: string) => void
  onChange?: (filePath: string) => void
  onDelete?: (filePath: string) => void
}

export interface WatchEvent {
  type: 'add' | 'change' | 'delete'
  path: string
  timestamp: string
}

type EventCallback = (event: WatchEvent) => void

export class FileWatcherService {
  private watchers = new Map<string, { watcher: FSWatcher; target: WatchTarget }>()
  private eventCallbacks: EventCallback[] = []
  private debounceMs: number

  constructor(debounceMs: number = 300) {
    this.debounceMs = debounceMs
  }

  /** 添加监听目标 */
  add(target: WatchTarget): boolean {
    const key = target.path
    if (this.watchers.has(key)) return false

    try {
      const watcher = watch(target.path, {
        persistent: true,
        recursive: true,
      })

      watcher.on('change', (filePath: string) => {
        this.emit('change', filePath)
        target.onChange?.(filePath)
      })

      watcher.on('add', (filePath: string) => {
        this.emit('add', filePath)
        target.onAdd?.(filePath)
      })

      watcher.on('unlink', (filePath: string) => {
        this.emit('delete', filePath)
        target.onDelete?.(filePath)
      })

      watcher.on('error', (err: Error) => {
        console.warn(`[FileWatcher] ${target.path}: ${err.message}`)
      })

      this.watchers.set(key, { watcher, target })
      return true
    } catch (err) {
      console.warn(`[FileWatcher] 无法监听 ${target.path}: ${err}`)
      return false
    }
  }

  /** 移除监听目标 */
  remove(path: string): boolean {
    const entry = this.watchers.get(path)
    if (!entry) return false
    entry.watcher.close()
    this.watchers.delete(path)
    return true
  }

  /** 列出所有监听目标 */
  list(): string[] {
    return Array.from(this.watchers.keys())
  }

  /** 检查是否在监听 */
  isWatching(path: string): boolean {
    return this.watchers.has(path)
  }

  /** 注册事件回调 */
  onEvent(callback: EventCallback): () => void {
    this.eventCallbacks.push(callback)
    return () => {
      this.eventCallbacks = this.eventCallbacks.filter(c => c !== callback)
    }
  }

  /** 销毁所有监听 */
  destroy(): void {
    for (const [, entry] of this.watchers) {
      entry.watcher.close()
    }
    this.watchers.clear()
    this.eventCallbacks = []
  }

  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  private emit(type: WatchEvent['type'], filePath: string): void {
    // 去抖动
    const key = `${type}:${filePath}`
    const existing = this.debounceTimers.get(key)
    if (existing) clearTimeout(existing)

    this.debounceTimers.set(key, setTimeout(() => {
      this.debounceTimers.delete(key)
      const event: WatchEvent = {
        type,
        path: filePath,
        timestamp: new Date().toISOString(),
      }
      for (const cb of this.eventCallbacks) {
        try { cb(event) } catch { /* ignore */ }
      }
    }, this.debounceMs))
  }
}

export const fileWatcher = new FileWatcherService()
