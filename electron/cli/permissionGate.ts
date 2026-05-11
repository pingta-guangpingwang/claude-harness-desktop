// CLI 权限门控 — 三级权限: user / elevated / admin
import type { CommandPermission, CommandDefinition } from './types'

interface PendingConfirm {
  command: string
  resolve: (allowed: boolean) => void
}

export class PermissionGate {
  private adminPassword: string | null = null
  private pending: PendingConfirm | null = null
  private onConfirmCallback: ((command: string, level: CommandPermission) => Promise<boolean>) | null = null

  setAdminPassword(pw: string): void {
    this.adminPassword = pw
  }

  /** 设置外部确认回调（用于 UI 弹窗） */
  onConfirm(cb: (command: string, level: CommandPermission) => Promise<boolean>): void {
    this.onConfirmCallback = cb
  }

  /** 检查命令权限，返回 true 允许，false 拒绝 */
  async check(cmd: CommandDefinition, args: Record<string, unknown>): Promise<{ allowed: boolean; reason?: string }> {
    const level = cmd.permission || 'user'

    // user 级：直接执行
    if (level === 'user') return { allowed: true }

    // elevated 级：二次确认
    if (level === 'elevated') {
      if (this.onConfirmCallback) {
        const ok = await this.onConfirmCallback(cmd.name, 'elevated')
        return ok ? { allowed: true } : { allowed: false, reason: '用户取消' }
      }
      return { allowed: true } // 无 UI 时静默允许
    }

    // admin 级：密码验证
    if (level === 'admin') {
      if (this.onConfirmCallback) {
        const ok = await this.onConfirmCallback(cmd.name, 'admin')
        return ok ? { allowed: true } : { allowed: false, reason: '管理员验证失败' }
      }
      return { allowed: false, reason: '需要管理员权限' }
    }

    return { allowed: false, reason: '未知权限级别' }
  }

  resolve(allowed: boolean): void {
    this.pending?.resolve(allowed)
    this.pending = null
  }
}
