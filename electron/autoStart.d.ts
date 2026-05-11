export declare class AutoStartManager {
    /** 检查当前是否已启用开机自启 */
    isEnabled(): boolean;
    /** 启用开机自启 */
    enable(): void;
    /** 禁用开机自启 */
    disable(): void;
    /** 切换 */
    toggle(): boolean;
    /** 设置开机自启状态 */
    setEnabled(enabled: boolean): void;
}
export declare const autoStartManager: AutoStartManager;
