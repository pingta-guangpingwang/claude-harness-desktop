import type { WorkflowDefinition } from './types';
import { WorkflowEngine } from './engine';
export declare class WorkflowScheduler {
    private engine;
    private jobs;
    private workflowStore;
    private variablesStore;
    constructor(engine: WorkflowEngine);
    /** 注册工作流并启动调度 */
    register(workflow: WorkflowDefinition, variables?: Record<string, unknown>): void;
    /** 注销工作流调度 */
    unregister(workflowId: string): void;
    /** 手动触发工作流 */
    trigger(workflowId: string): Promise<string>;
    /** 获取已注册的工作流 */
    getRegistered(): string[];
    /** 销毁调度器 */
    destroy(): void;
    private startTrigger;
    /** 简单的 cron 到毫秒转换（仅支持基本格式） */
    private cronToMs;
    private saveScheduleState;
    private loadScheduleState;
}
