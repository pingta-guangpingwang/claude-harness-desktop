import type { HarnessPermissions, PermissionRule, AgentTool } from './types';
type Decision = {
    decision: 'allow' | 'deny' | 'ask';
    reason?: string;
};
export declare class PermissionManager {
    private permissions;
    private customRules;
    private denialCounts;
    private maxAutoDenials;
    constructor();
    updatePermissions(p: Partial<HarnessPermissions>): void;
    getPermissions(): HarnessPermissions;
    addRule(rule: PermissionRule): void;
    clearRules(): void;
    /** 多层权限管道入口 */
    checkTool(tool: AgentTool, params: Record<string, unknown>): Decision;
    /** 记录拒绝（用于追踪） */
    recordDenial(toolName: string): void;
    /** 记录允许（重置计数器） */
    recordAllow(toolName: string): void;
    /** 重置拒绝追踪 */
    resetDenialTracking(): void;
    private checkDestructive;
}
export {};
