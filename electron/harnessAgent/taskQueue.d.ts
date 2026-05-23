export interface AgentTask {
    id: string;
    type: 'user_request' | 'auto_check' | 'follow_up' | 'scheduled';
    projectPath?: string;
    instruction: string;
    priority: number;
    status: 'pending' | 'running' | 'done' | 'failed';
    createdAt: string;
    updatedAt: string;
    result?: string;
    /** 若是 follow_up，记录来源任务 */
    parentId?: string;
}
declare class AgentTaskQueue {
    private tasks;
    private order;
    /** 添加任务，返回任务 ID */
    add(task: Omit<AgentTask, 'id' | 'status' | 'createdAt' | 'updatedAt'>): string;
    /** 获取下一个待处理任务（优先级最高、最旧） */
    getNext(): AgentTask | null;
    /** 更新任务状态 */
    updateStatus(id: string, status: AgentTask['status'], result?: string): void;
    /** 获取任务 */
    get(id: string): AgentTask | undefined;
    /** 列出所有任务（可按状态过滤） */
    list(status?: AgentTask['status']): AgentTask[];
    /** 列出指定项目的待办 */
    listByProject(projectPath: string): AgentTask[];
    /** 清空已完成/失败的任务 */
    clearCompleted(): number;
    /** 获取统计 */
    stats(): {
        total: number;
        pending: number;
        running: number;
        done: number;
        failed: number;
    };
    /** 获取待办数量 */
    get pendingCount(): number;
    /** 序列化（供 IPC 返回渲染进程） */
    toJSON(): AgentTask[];
}
/** 全局单例 */
export declare const taskQueue: AgentTaskQueue;
export {};
