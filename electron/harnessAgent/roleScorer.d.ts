export interface TaskRecord {
    id: string;
    roleId: string;
    task: string;
    toolUsed: string;
    projectPath?: string;
    result: 'success' | 'failure' | 'partial';
    durationMs: number;
    errorMessage?: string;
    timestamp: string;
}
export interface RoleScore {
    roleId: string;
    roleName: string;
    totalTasks: number;
    successfulTasks: number;
    failedTasks: number;
    partialTasks: number;
    /** 成功率 = successful / total (0-1) */
    successRate: number;
    /** 可靠性 = (successful + 0.5*partial) / total (0-1) */
    reliability: number;
    /** 平均耗时 (ms) */
    avgDurationMs: number;
    /** 最近一次使用时间 */
    lastUsedAt: string | null;
    /** 综合评分 (0-100) — 加权计算 */
    compositeScore: number;
    /** 评分历史 (最近20条) */
    recentRecords: TaskRecord[];
}
export declare class RoleScorer {
    private scores;
    private allRecords;
    private savePath;
    constructor();
    /** 记录一次任务执行 */
    recordTask(record: Omit<TaskRecord, 'id' | 'timestamp'>): TaskRecord;
    /** 获取角色评分 */
    getScore(roleId: string): RoleScore | null;
    /** 获取所有角色评分 */
    getAllScores(): RoleScore[];
    /** 获取排行榜（按综合评分降序） */
    getLeaderboard(topK?: number): RoleScore[];
    /** 获取指定角色的任务历史 */
    getHistory(roleId: string, limit?: number): TaskRecord[];
    /** 获取所有任务记录（按时间倒序） */
    getAllHistory(limit?: number): TaskRecord[];
    /** 生成角色评分报告（Markdown 格式） */
    generateReport(): string;
    /** 重置指定角色的评分 */
    resetScore(roleId: string): void;
    /** 重置全部评分 */
    resetAll(): void;
    /** 手动调整角色综合评分（用于人工修正） */
    adjustScore(roleId: string, adjustment: number, reason: string): void;
    private updateScore;
    private computeComposite;
    private getSavePath;
    private save;
    private load;
}
