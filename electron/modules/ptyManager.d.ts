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
    isClaude: boolean;
}
type HarnessMentionCallback = (projectPath: string, projectName: string, message: string, recentContext: string) => void;
export declare function onHarnessMention(cb: HarnessMentionCallback): void;
/** 获取会话表（供 harnessAgent 工具直接调用） */
export declare function getSessions(): Map<string, PtySession>;
/** 直接 spawn PTY（供 harnessAgent 工具调用，不走 IPC）。
 *  自动注入 --permission-mode acceptEdits，失败时自动重试。 */
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
export declare function sendAndCollect(projectPath: string, task: string, timeoutMs?: number, projectName?: string): Promise<{
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
/** 获取最近 PTY 输出（供 harnessAgent read_project_chat 工具读取实时终端内容）。
 *  主数据源：messageStores.responses（主进程直接捕获，无 IPC 依赖）+ chatMessages（Chat UI 推送）。
 *  辅助数据源：对话框 + 可读终端输出。 */
export declare function getRecentPtyOutput(projectPath: string, _maxLines?: number): string;
/** 获取最近 PTY 错误快照（供 harnessAgent diagnose_project 工具使用）。
 *  返回清洗过的状态行 + 原始最近输出（保留错误信息用于模式匹配） */
export declare function getPtyErrorSnapshot(projectPath: string, maxLines?: number): string;
/** 直接查询 PTY 状态（供 harnessAgent 工具调用，不走 IPC） */
export declare function getPtyStatus(projectPath: string): {
    connected: boolean;
    sessionId: string | null;
    pid: number | null;
    lastDataAt: number;
};
export declare function registerPtyIpc(window: BrowserWindow): void;
export {};
