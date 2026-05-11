export interface WatchTarget {
    path: string;
    patterns: string[];
    ignorePatterns: string[];
    onAdd?: (filePath: string) => void;
    onChange?: (filePath: string) => void;
    onDelete?: (filePath: string) => void;
}
export interface WatchEvent {
    type: 'add' | 'change' | 'delete';
    path: string;
    timestamp: string;
}
type EventCallback = (event: WatchEvent) => void;
export declare class FileWatcherService {
    private watchers;
    private eventCallbacks;
    private debounceMs;
    constructor(debounceMs?: number);
    /** 添加监听目标 */
    add(target: WatchTarget): boolean;
    /** 移除监听目标 */
    remove(path: string): boolean;
    /** 列出所有监听目标 */
    list(): string[];
    /** 检查是否在监听 */
    isWatching(path: string): boolean;
    /** 注册事件回调 */
    onEvent(callback: EventCallback): () => void;
    /** 销毁所有监听 */
    destroy(): void;
    private debounceTimers;
    private emit;
}
export declare const fileWatcher: FileWatcherService;
export {};
