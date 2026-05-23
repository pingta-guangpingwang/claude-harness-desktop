// RoleManager + DocToSkillLoader 单元测试

import { RoleManager, BUILTIN_ROLES } from '../electron/harnessAgent/roleManager'
import { roleConfigStore } from '../electron/harnessAgent/roleConfigStore'

describe('BUILTIN_ROLES', () => {
  test('有 4 个内置角色', () => {
    expect(BUILTIN_ROLES.length).toBe(4)
  })

  test('CEO 是默认角色', () => {
    const ceo = BUILTIN_ROLES.find(r => r.id === 'ceo')
    expect(ceo).toBeDefined()
    expect(ceo!.isDefault).toBe(true)
  })

  test('每个角色有唯一的 ID', () => {
    const ids = BUILTIN_ROLES.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('Worker 角色的工具受限', () => {
    const worker = BUILTIN_ROLES.find(r => r.id === 'worker')
    expect(worker!.allowedTools.length).toBeGreaterThan(0)
    expect(worker!.deniedTools).toContain('broadcast')
    expect(worker!.deniedTools).toContain('health_report')
  })

  test('Reviewer 不能执行破坏性操作', () => {
    const reviewer = BUILTIN_ROLES.find(r => r.id === 'reviewer')
    expect(reviewer!.deniedTools).toContain('write_file')
    expect(reviewer!.deniedTools).toContain('shell_exec')
    expect(reviewer!.deniedTools).toContain('stop_projects')
  })
})

describe('RoleManager', () => {
  let rm: RoleManager

  beforeEach(() => {
    roleConfigStore.reset()
    rm = new RoleManager()
  })

  test('初始角色是 CEO', () => {
    expect(rm.getCurrentRole().id).toBe('ceo')
  })

  test('getAllRoles 返回所有角色', () => {
    const roles = rm.getAllRoles()
    expect(roles.length).toBe(4)
  })

  test('switchTo 有效角色成功', () => {
    const result = rm.switchTo('worker', 'test')
    expect(result.success).toBe(true)
    expect(rm.getCurrentRole().id).toBe('worker')
  })

  test('switchTo 无效角色失败', () => {
    const result = rm.switchTo('invalid_role', 'test')
    expect(result.success).toBe(false)
    expect(rm.getCurrentRole().id).toBe('ceo')
  })

  test('角色切换历史被记录', () => {
    rm.switchTo('worker', '用户要求开发')
    rm.switchTo('reviewer', '审查代码')
    const history = rm.getRoleHistory()
    expect(history.length).toBe(2)
    expect(history[0].toRole).toBe('worker')
    expect(history[1].toRole).toBe('reviewer')
  })

  test('reset 回到默认角色', () => {
    rm.switchTo('worker', 'test')
    rm.reset()
    expect(rm.getCurrentRole().id).toBe('ceo')
    expect(rm.getRoleHistory().length).toBe(0)
  })

  test('getAgentCard 返回 A2A 兼容的能力清单', () => {
    const card = rm.getAgentCard('worker')
    expect(card).toBeDefined()
    expect(card!.capabilities.length).toBeGreaterThan(0)
    expect(card!.skills.length).toBeGreaterThan(0)
    expect(card!.maxConcurrentTasks).toBeGreaterThan(0)
  })

  test('getToolFilter — CEO 可以使用所有工具', () => {
    const filter = rm.getToolFilter('ceo')
    expect(filter({ name: 'wake_projects' } as any)).toBe(true)
    expect(filter({ name: 'broadcast' } as any)).toBe(true)
    expect(filter({ name: 'shell_exec' } as any)).toBe(true)
  })

  test('getToolFilter — Worker 受限', () => {
    const filter = rm.getToolFilter('worker')
    expect(filter({ name: 'broadcast' } as any)).toBe(false)
    expect(filter({ name: 'health_report' } as any)).toBe(false)
    expect(filter({ name: 'task_project' } as any)).toBe(true)
  })
})

describe('RoleManager.inferRole', () => {
  let rm: RoleManager

  beforeEach(() => {
    roleConfigStore.reset()
    rm = new RoleManager()
  })

  test('包含"开发" → worker', () => {
    const result = rm.inferRole('帮我开发一个新功能')
    expect(result.roleId).toBe('worker')
  })

  test('包含"审查" + "lint" → reviewer', () => {
    const result = rm.inferRole('帮我审查代码质量检查lint')
    expect(result.roleId).toBe('reviewer')
  })

  test('包含"诊断" → diagnostician', () => {
    const result = rm.inferRole('诊断一下为什么项目启动失败')
    expect(result.roleId).toBe('diagnostician')
  })

  test('无关键词 → ceo (默认)', () => {
    const result = rm.inferRole('你好')
    expect(result.roleId).toBe('ceo')
  })

  test('包含"错误" → diagnostician', () => {
    const result = rm.inferRole('这个错误是什么原因')
    expect(result.roleId).toBe('diagnostician')
  })

  test('包含"代码" → worker', () => {
    const result = rm.inferRole('帮我改一下代码')
    expect(result.roleId).toBe('worker')
  })

  test('包含多个角色关键词时选分最高的', () => {
    const result = rm.inferRole('帮我审查并修复这个代码错误')
    // 审查(1) + 修(1) + 错误(1) → 应该是分数最高的
    expect(['reviewer', 'worker', 'diagnostician']).toContain(result.roleId)
  })
})

describe('RoleManager.autoSwitch', () => {
  let rm: RoleManager

  beforeEach(() => {
    roleConfigStore.reset()
    rm = new RoleManager()
  })

  test('系统未启用时 → 不切换', () => {
    const result = rm.autoSwitch('帮我开发一个新功能修复这个代码错误', 0.5)
    expect(result.switched).toBe(false)
    expect(result.reason).toContain('未启用')
  })

  test('系统启用后 → 高置信度自动切换', () => {
    rm.setSystemEnabled(true)
    const result = rm.autoSwitch('帮我开发一个新功能修复这个代码错误', 0.5)
    expect(result.switched).toBe(true)
  })

  test('低置信度 → 不切换', () => {
    rm.setSystemEnabled(true)
    const result = rm.autoSwitch('你好', 0.9)
    expect(result.switched).toBe(false)
    expect(result.roleId).toBe('ceo')
  })

  test('已经是目标角色 → 不切换', () => {
    rm.setSystemEnabled(true)
    rm.switchTo('diagnostician', 'test')
    const result = rm.autoSwitch('诊断这个错误是什么原因', 0.3)
    expect(result.switched).toBe(false)
    expect(result.roleId).toBe('diagnostician')
  })

  test('禁用角色不会被推断和切换', () => {
    rm.setSystemEnabled(true)
    rm.setRoleEnabled('worker', false)
    const result = rm.autoSwitch('帮我开发一个新功能', 0.3)
    expect(result.switched).toBe(false)
    expect(result.roleId).toBe('ceo')
  })
})
