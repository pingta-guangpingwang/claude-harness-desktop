export interface ScheduledTask {
    id: string;
    name: string;
    prompt: string;
    projectPath?: string;
    intervalMs: number;
    lastRun: number;
    enabled: boolean;
    /** 一次性任务：执行一次后自动删除 */
    once?: boolean;
}
declare class HarnessScheduler {
    private tasks;
    private timers;
    /** 当调度器触发时，回调通知外部可触发自主 Agent */
    private onTrigger;
    /** 注册唤醒回调 — 供 harnessIpc 绑定，调度触发时通知 Agent 循环取队列任务 */
    setOnTrigger(fn: () => void): void;
    /** 添加定时任务 */
    add(name: string, prompt: string, intervalMs: number, projectPath?: string): string;
    /** 添加一次性延时任务 */
    addOnce(name: string, prompt: string, delayMs: number, projectPath?: string): string;
    /** 移除定时任务 */
    remove(id: string): boolean;
    /** 启用/禁用 */
    setEnabled(id: string, enabled: boolean): void;
    /** 列出所有定时任务 */
    list(): ScheduledTask[];
    /** 获取统计 */
    stats(): {
        total: number;
        enabled: number;
        nextRunMs: number | null;
    };
    /** 销毁所有定时器 */
    destroy(): void;
    private scheduleNext;
    private fire;
}
/** 全局单例 */
export declare const harnessScheduler: HarnessScheduler;
export {};
