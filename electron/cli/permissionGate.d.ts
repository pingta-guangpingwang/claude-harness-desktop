import type { CommandPermission, CommandDefinition } from './types';
export declare class PermissionGate {
    private adminPassword;
    private pending;
    private onConfirmCallback;
    setAdminPassword(pw: string): void;
    /** 设置外部确认回调（用于 UI 弹窗） */
    onConfirm(cb: (command: string, level: CommandPermission) => Promise<boolean>): void;
    /** 检查命令权限，返回 true 允许，false 拒绝 */
    check(cmd: CommandDefinition, args: Record<string, unknown>): Promise<{
        allowed: boolean;
        reason?: string;
    }>;
    resolve(allowed: boolean): void;
}
