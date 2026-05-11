import { BrowserWindow } from 'electron';
export declare class HotkeyManager {
    private registered;
    private mainWindow;
    setMainWindow(win: BrowserWindow): void;
    /** 注册全局热键 */
    register(accelerator: string, action: () => void): boolean;
    /** 注销热键 */
    unregister(accelerator: string): void;
    /** 初始化默认热键 */
    init(summonHotkey: string): void;
    /** 重新绑定唤起热键（hotkey 变更时） */
    rebindSummon(newHotkey: string, oldHotkey: string): void;
    /** 注销所有热键 */
    destroy(): void;
}
export declare const hotkeyManager: HotkeyManager;
