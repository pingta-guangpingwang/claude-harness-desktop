import { BrowserWindow } from 'electron';
export declare class TrayManager {
    private tray;
    private mainWindow;
    private onShow;
    private onQuit;
    init(mainWindow: BrowserWindow): void;
    /** 更新托盘菜单 */
    updateMenu(): void;
    /** 设置回调 */
    setOnShow(cb: () => void): void;
    setOnQuit(cb: () => void): void;
    /** 销毁托盘 */
    destroy(): void;
    /** 创建设备像素级托盘图标 */
    private createTrayIcon;
}
export declare const trayManager: TrayManager;
