import { BrowserWindow } from 'electron';
interface FloatingWidgetConfig {
    position: {
        x: number;
        y: number;
    };
    size: {
        width: number;
        height: number;
    };
}
export declare class WindowManager {
    private mainWindow;
    private floatingWindow;
    private preloadPath;
    private floatingConfig;
    constructor(preloadPath: string);
    /** 创建主窗口 */
    createMainWindow(): BrowserWindow;
    /** 创建悬浮小窗 */
    createFloatingWindow(config?: FloatingWidgetConfig): BrowserWindow | null;
    /** 关闭悬浮小窗 */
    closeFloatingWindow(): void;
    /** 切换悬浮小窗 */
    toggleFloatingWindow(): boolean;
    /** 获取主窗口 */
    getMainWindow(): BrowserWindow | null;
    /** 获取悬浮窗口 */
    getFloatingWindow(): BrowserWindow | null;
    /** 获取悬浮窗配置 */
    getFloatingConfig(): FloatingWidgetConfig;
    /** 更新悬浮窗位置 */
    setFloatingConfig(config: Partial<FloatingWidgetConfig>): void;
    /** 显示主窗口 */
    showMainWindow(): void;
    /** 主窗口是否可见 */
    isMainVisible(): boolean;
    /** 最小化到托盘开关（由 hub settings 控制） */
    private shouldMinimizeToTray;
    setMinimizeToTray(enabled: boolean): void;
}
export declare function setPreloadPath(p: string): void;
export declare const windowManager: WindowManager;
export {};
