import type { WorkflowDefinition, WorkflowRunState, WorkflowEvent } from './types';
interface EngineDeps {
    /** 执行 CLI 命令 */
    executeCli?: (command: string, args: Record<string, unknown>, projectPath?: string) => Promise<{
        success: boolean;
        output: string;
    }>;
    /** 调用 AI */
    callAI?: (prompt: string, model?: string) => Promise<string>;
    /** 日志 */
    log?: (msg: string) => void;
}
export declare class WorkflowEngine {
    private deps;
    private activeRuns;
    private eventCallbacks;
    constructor(deps?: EngineDeps);
    /** 执行工作流 */
    run(workflow: WorkflowDefinition, variables?: Record<string, unknown>): Promise<WorkflowRunState>;
    /** 中止工作流 */
    abort(runId: string): boolean;
    /** 获取运行状态 */
    getRunState(runId: string): WorkflowRunState | undefined;
    /** 获取所有活跃运行 */
    getActiveRuns(): WorkflowRunState[];
    /** 注册事件监听 */
    onRunEvent(runId: string, callback: (event: WorkflowEvent) => void): () => void;
    private emit;
    private executeNode;
    private resolveVariables;
}
export {};
