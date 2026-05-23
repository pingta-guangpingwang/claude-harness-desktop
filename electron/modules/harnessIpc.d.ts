import { BrowserWindow } from 'electron';
export declare function registerHarnessIpc(window: BrowserWindow): Promise<void>;
/** 桥接 CLI 命令到 Agent 工具池 — 由 main.ts 在两者初始化完毕后调用 */
export declare function bridgeCliToAgent(cliRegistry: {
    getAll: () => Array<{
        name: string;
        description: string;
        category?: string;
        params?: Array<{
            name: string;
            type: string;
            description: string;
            required?: boolean;
        }>;
        permission?: string;
    }>;
    execute: (name: string, args: Record<string, unknown>, ctx: any) => Promise<{
        success: boolean;
        output: string;
    }>;
}): void;
