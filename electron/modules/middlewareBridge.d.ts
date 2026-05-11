interface MiddlewareStatus {
    running: boolean;
    pid?: number;
    startTime?: string;
    activeAgents: number;
    queuedRequests: number;
    circuitBreakers: Record<string, 'closed' | 'open' | 'half-open'>;
}
/** 向 MiddlewareBox 的 HTTP 服务器发送 PTY 审计事件 */
export declare function forwardPtyEvent(event: {
    type: string;
    sessionId: string;
    project: string;
    agent: string;
    timestamp: string;
    data: Record<string, any>;
}): Promise<void>;
export declare function getMiddlewareStatus(): MiddlewareStatus;
export declare function setMiddlewareRunning(running: boolean): void;
/** 主动探测 MiddlewareBox /health 端点，更新运行状态 */
export declare function probeMiddlewareHealth(): Promise<boolean>;
export declare function registerMiddlewareIpc(): void;
export {};
