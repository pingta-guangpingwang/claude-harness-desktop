import type { BrowserWindow } from 'electron';
export declare function setNotifierWindow(win: BrowserWindow | null): void;
/** create_project 等工具调用后，推送新项目到渲染层刷新 UI */
export declare function notifyProjectAdded(projectPath: string, projectName: string): void;
/** 项目从列表中移除时通知渲染层 */
export declare function notifyProjectRemoved(projectPath: string): void;
