import type { BatchTask, BatchResult, CommandContext, CommandResult } from './types';
import { CommandRegistry } from './registry';
export declare class BatchRunner {
    private running;
    private abortController;
    private onProgress;
    abort(): void;
    isRunning(): boolean;
    run(task: BatchTask, registry: CommandRegistry, ctx: CommandContext, onProgress?: (event: BatchProgressEvent) => void): Promise<BatchResult>;
}
export interface BatchProgressEvent {
    type: 'batch_start' | 'step_start' | 'step_end' | 'batch_end' | 'batch_error';
    taskId: string;
    command?: string;
    result?: CommandResult;
    index?: number;
    durationMs?: number;
    total?: number;
    successCount?: number;
    failCount?: number;
    totalDurationMs?: number;
    message?: string;
}
