import type { ReflectionResult } from './reflector.js';
import type { ToolCallRequest } from './types.js';
export interface HITLDecision {
    pause: boolean;
    reason?: string;
    severity: 'low' | 'medium' | 'high';
}
export type HITLResponse = 'approved' | 'denied' | 'timeout';
export declare class HITLManager {
    private recentFailures;
    private pendingConfirmation;
    private confirmTimeoutMs;
    private enabled;
    constructor(confirmTimeoutMs?: number);
    /**
     * 决定是否需要在工具执行前暂停并请求人类确认
     * 触发条件（任一）：
     * 1. Reflection 输出 confidence = 'low'
     * 2. 工具属于危险操作 (write_file, shell_exec, delete_*, stop_*)
     * 3. 同一工具连续失败 3 次以上
     * 4. Agent 显式请求确认（工具参数含 [CONFIRM_NEEDED]）
     */
    shouldPauseForConfirmation(toolCall: ToolCallRequest, reflection: ReflectionResult | null): HITLDecision;
    /** 记录工具执行结果 */
    recordResult(toolName: string, success: boolean): void;
    /**
     * 暂停 Agent Loop，等待用户确认
     * 返回 'approved' | 'denied' | 'timeout'
     */
    requestConfirmation(toolCall: ToolCallRequest, reason: string): Promise<HITLResponse>;
    /** 用户确认或拒绝 */
    respond(response: HITLResponse): void;
    /** 获取当前待确认状态 */
    getPendingConfirmation(): {
        toolCall: ToolCallRequest;
    } | null;
    /** 获取失败统计 */
    getFailureStats(): Map<string, number>;
    /** 重置失败计数 */
    resetFailures(): void;
    /** 启用/禁用 HITL */
    setEnabled(enabled: boolean): void;
    get isEnabled(): boolean;
    /** 是否有待处理确认 */
    get hasPending(): boolean;
}
