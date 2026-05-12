import { BrowserWindow } from 'electron';
interface PtyProcess {
    pid: number;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): void;
    onData(cb: (data: string) => void): void;
    onExit(cb: (e: {
        exitCode: number;
        signal?: number;
    }) => void): void;
}
interface PtySession {
    pty: PtyProcess;
    sessionId: string;
    projectPath: string;
    lastDataAt: number;
}
/** 获取会话表（供 harnessAgent 工具直接调用） */
export declare function getSessions(): Map<string, PtySession>;
/** 直接 spawn PTY（供 harnessAgent 工具调用，不走 IPC）。
 *  始终走 cmd.exe /c，追加 --fork-session 避免与 VSCode 冲突，失败时自动重试。 */
export declare function spawnPtySession(projectPath: string, command?: string, args?: string[]): Promise<{
    success: boolean;
    pid?: number;
    sessionId?: string;
    message?: string;
}>;
/** 直接 write 到 PTY（供 harnessAgent 工具调用，不走 IPC） */
export declare function writeToPty(projectPath: string, data: string): {
    success: boolean;
    message?: string;
};
/** 向 PTY 发送命令并收集响应（供 harnessAgent 工具使用）。
 *  等待项目 AI 空闲 8s 后返回，最长等待 timeoutMs。 */
export declare function sendAndCollect(projectPath: string, task: string, timeoutMs?: number): Promise<{
    success: boolean;
    output: string;
}>;
/** 供 pty.onData 调用的收集器钩子 */
export declare function feedCollector(projectPath: string, data: string): void;
/** 直接 kill PTY（供 harnessAgent 工具调用，不走 IPC） */
export declare function killPtySession(projectPath?: string): {
    success: boolean;
    message?: string;
};
/** 直接查询 PTY 状态（供 harnessAgent 工具调用，不走 IPC） */
export declare function getPtyStatus(projectPath: string): {
    connected: boolean;
    sessionId: string | null;
    pid: number | null;
    lastDataAt: number;
};
export declare function registerPtyIpc(window: BrowserWindow): void;
export {};
