// RoleScorer 角色评分引擎单元测试

import { RoleScorer } from '../electron/harnessAgent/roleScorer'

describe('RoleScorer', () => {
  let scorer: RoleScorer

  beforeEach(() => {
    scorer = new RoleScorer()
    scorer.resetAll() // 清除跨测试持久化泄漏
  })

  // ---- 基础功能 ----

  test('初始化时无评分', () => {
    expect(scorer.getAllScores().length).toBe(0)
    expect(scorer.getLeaderboard().length).toBe(0)
  })

  test('getScore 对未知角色返回 null', () => {
    expect(scorer.getScore('nonexistent')).toBeNull()
  })

  test('recordTask 记录成功任务并创建评分', () => {
    scorer.recordTask({
      roleId: 'ceo',
      task: '检查所有项目状态',
      toolUsed: 'check_status',
      result: 'success',
      durationMs: 5000,
    })

    const score = scorer.getScore('ceo')
    expect(score).not.toBeNull()
    expect(score!.totalTasks).toBe(1)
    expect(score!.successfulTasks).toBe(1)
    expect(score!.failedTasks).toBe(0)
    expect(score!.partialTasks).toBe(0)
    expect(score!.successRate).toBe(1)
  })

  test('recordTask 记录失败任务', () => {
    scorer.recordTask({
      roleId: 'worker',
      task: '修复编译错误',
      toolUsed: 'shell_exec',
      result: 'failure',
      durationMs: 3000,
      errorMessage: 'Connection refused',
    })

    const score = scorer.getScore('worker')
    expect(score!.totalTasks).toBe(1)
    expect(score!.successfulTasks).toBe(0)
    expect(score!.failedTasks).toBe(1)
    expect(score!.successRate).toBe(0)
  })

  test('recordTask 记录部分成功任务', () => {
    scorer.recordTask({
      roleId: 'diagnostician',
      task: '诊断网络问题',
      toolUsed: 'diagnose_project',
      result: 'partial',
      durationMs: 8000,
    })

    const score = scorer.getScore('diagnostician')
    expect(score!.totalTasks).toBe(1)
    expect(score!.partialTasks).toBe(1)
    expect(score!.reliability).toBe(0.5) // 0.5 * 1 partial / 1 total
  })

  test('recordTask 返回完整记录（含 id 和 timestamp）', () => {
    const record = scorer.recordTask({
      roleId: 'ceo',
      task: 'wake 项目',
      toolUsed: 'wake_projects',
      result: 'success',
      durationMs: 2000,
    })

    expect(record.id).toBeTruthy()
    expect(record.timestamp).toBeTruthy()
    expect(record.roleId).toBe('ceo')
    expect(record.task).toBe('wake 项目')
  })

  // ---- 评分计算 ----

  test('多次记录后成功率正确', () => {
    const roleId = 'ceo'
    for (let i = 0; i < 7; i++) {
      scorer.recordTask({ roleId, task: `task ${i}`, toolUsed: 'test', result: 'success', durationMs: 1000 })
    }
    for (let i = 0; i < 3; i++) {
      scorer.recordTask({ roleId, task: `fail ${i}`, toolUsed: 'test', result: 'failure', durationMs: 1000 })
    }

    const score = scorer.getScore(roleId)!
    expect(score.totalTasks).toBe(10)
    expect(score.successfulTasks).toBe(7)
    expect(score.failedTasks).toBe(3)
    expect(score.successRate).toBe(0.7)
    expect(score.reliability).toBe(0.7) // (7 + 0) / 10
  })

  test('含部分成功时可靠性 > 成功率', () => {
    const roleId = 'worker'
    scorer.recordTask({ roleId, task: 'ok', toolUsed: 't', result: 'success', durationMs: 500 })
    scorer.recordTask({ roleId, task: 'half', toolUsed: 't', result: 'partial', durationMs: 500 })
    scorer.recordTask({ roleId, task: 'fail', toolUsed: 't', result: 'failure', durationMs: 500 })

    const score = scorer.getScore(roleId)!
    expect(score.successRate).toBeCloseTo(1 / 3)
    expect(score.reliability).toBeCloseTo((1 + 0.5) / 3) // (1 + 0.5*1) / 3 = 0.5
  })

  test('综合评分在 0-100 范围', () => {
    scorer.recordTask({ roleId: 'ceo', task: 't', toolUsed: 'x', result: 'success', durationMs: 100 })
    const score = scorer.getScore('ceo')!
    expect(score.compositeScore).toBeGreaterThanOrEqual(0)
    expect(score.compositeScore).toBeLessThanOrEqual(100)
  })

  test('任务数少于 10 时 taskFactor 降低综合评分', () => {
    // 记录 2 个成功任务 → taskFactor = 2/10 = 0.2
    scorer.recordTask({ roleId: 'ceo', task: 't1', toolUsed: 'a', result: 'success', durationMs: 100 })
    scorer.recordTask({ roleId: 'ceo', task: 't2', toolUsed: 'b', result: 'success', durationMs: 100 })

    const lowTasksScore = scorer.getScore('ceo')!.compositeScore

    // 再记录 8 个 → taskFactor = 1.0
    for (let i = 0; i < 8; i++) {
      scorer.recordTask({ roleId: 'ceo', task: `t${i}`, toolUsed: 'c', result: 'success', durationMs: 100 })
    }

    const fullTasksScore = scorer.getScore('ceo')!.compositeScore
    expect(fullTasksScore).toBeGreaterThan(lowTasksScore)
  })

  test('近期失败会降低一致性，拉低综合评分', () => {
    const roleId = 'diagnostician'
    // 先 10 次成功 → 高分
    for (let i = 0; i < 10; i++) {
      scorer.recordTask({ roleId, task: `ok ${i}`, toolUsed: 't', result: 'success', durationMs: 100 })
    }
    const highScore = scorer.getScore(roleId)!.compositeScore

    // 再连续 10 次失败 → 一致性崩塌
    for (let i = 0; i < 10; i++) {
      scorer.recordTask({ roleId, task: `fail ${i}`, toolUsed: 't', result: 'failure', durationMs: 100 })
    }
    const lowScore = scorer.getScore(roleId)!.compositeScore

    expect(lowScore).toBeLessThan(highScore)
  })

  test('平均耗时使用移动平均', () => {
    scorer.recordTask({ roleId: 'ceo', task: 't1', toolUsed: 'a', result: 'success', durationMs: 1000 })
    scorer.recordTask({ roleId: 'ceo', task: 't2', toolUsed: 'a', result: 'success', durationMs: 3000 })

    const score = scorer.getScore('ceo')!
    expect(score.avgDurationMs).toBe(2000) // (1000 + 3000) / 2
  })

  // ---- 排行榜 ----

  test('getLeaderboard 按综合评分降序', () => {
    // ceo: 全部成功
    for (let i = 0; i < 10; i++) {
      scorer.recordTask({ roleId: 'ceo', task: 'ok', toolUsed: 't', result: 'success', durationMs: 100 })
    }
    // worker: 一半失败
    for (let i = 0; i < 10; i++) {
      scorer.recordTask({ roleId: 'worker', task: 't', toolUsed: 't', result: i < 5 ? 'success' : 'failure', durationMs: 100 })
    }

    const board = scorer.getLeaderboard()
    expect(board.length).toBe(2)
    expect(board[0].roleId).toBe('ceo')
    expect(board[1].roleId).toBe('worker')
    expect(board[0].compositeScore).toBeGreaterThan(board[1].compositeScore)
  })

  test('getLeaderboard(topK) 截断', () => {
    for (let i = 0; i < 10; i++) {
      scorer.recordTask({ roleId: `role_${i}`, task: 't', toolUsed: 'x', result: 'success', durationMs: 100 })
    }
    expect(scorer.getLeaderboard(3).length).toBe(3)
  })

  // ---- 历史查询 ----

  test('getHistory 只返回指定角色的记录', () => {
    scorer.recordTask({ roleId: 'ceo', task: 'ceo task', toolUsed: 'a', result: 'success', durationMs: 100 })
    scorer.recordTask({ roleId: 'worker', task: 'worker task', toolUsed: 'b', result: 'success', durationMs: 100 })

    const ceoHistory = scorer.getHistory('ceo')
    expect(ceoHistory.length).toBe(1)
    expect(ceoHistory[0].task).toBe('ceo task')
  })

  test('getHistory 按时间倒序', () => {
    scorer.recordTask({ roleId: 'ceo', task: 'first', toolUsed: 'a', result: 'success', durationMs: 100 })
    scorer.recordTask({ roleId: 'ceo', task: 'second', toolUsed: 'b', result: 'success', durationMs: 100 })

    const history = scorer.getHistory('ceo')
    expect(history[0].task).toBe('second')
    expect(history[1].task).toBe('first')
  })

  test('getHistory 支持 limit 参数', () => {
    for (let i = 0; i < 30; i++) {
      scorer.recordTask({ roleId: 'ceo', task: `task ${i}`, toolUsed: 't', result: 'success', durationMs: 100 })
    }
    const history = scorer.getHistory('ceo', 10)
    expect(history.length).toBe(10)
  })

  test('getAllHistory 返回所有角色记录', () => {
    scorer.recordTask({ roleId: 'ceo', task: 'a', toolUsed: 'x', result: 'success', durationMs: 100 })
    scorer.recordTask({ roleId: 'worker', task: 'b', toolUsed: 'y', result: 'success', durationMs: 100 })
    expect(scorer.getAllHistory().length).toBe(2)
  })

  // ---- 报告 ----

  test('generateReport 空数据时返回占位提示', () => {
    const report = scorer.generateReport()
    expect(report).toContain('暂无评分数据')
  })

  test('generateReport 含数据时生成 Markdown 表格', () => {
    scorer.recordTask({ roleId: 'ceo', task: 'check status', toolUsed: 'check_status', result: 'success', durationMs: 1500 })
    const report = scorer.generateReport()
    expect(report).toContain('角色评分报告')
    expect(report).toContain('| 排名 |')
    expect(report).toContain('ceo') // scorer 使用 roleId 作为名称
  })

  // ---- 重置 ----

  test('resetScore 删除指定角色评分和历史', () => {
    scorer.recordTask({ roleId: 'ceo', task: 't', toolUsed: 'a', result: 'success', durationMs: 100 })
    scorer.recordTask({ roleId: 'worker', task: 't', toolUsed: 'b', result: 'success', durationMs: 100 })

    scorer.resetScore('ceo')
    expect(scorer.getScore('ceo')).toBeNull()
    expect(scorer.getScore('worker')).not.toBeNull()
    expect(scorer.getHistory('ceo').length).toBe(0)
  })

  test('resetAll 清空所有', () => {
    scorer.recordTask({ roleId: 'ceo', task: 't', toolUsed: 'a', result: 'success', durationMs: 100 })
    scorer.recordTask({ roleId: 'worker', task: 't', toolUsed: 'b', result: 'success', durationMs: 100 })

    scorer.resetAll()
    expect(scorer.getAllScores().length).toBe(0)
    expect(scorer.getAllHistory().length).toBe(0)
  })

  // ---- 手动调整 ----

  test('adjustScore 手动调整综合评分', () => {
    // 需要足够任务让 taskFactor=1，综合评分才有意义
    for (let i = 0; i < 10; i++) {
      scorer.recordTask({ roleId: 'ceo', task: `t${i}`, toolUsed: 'a', result: 'success', durationMs: 100 })
    }
    const before = scorer.getScore('ceo')!.compositeScore
    expect(before).toBeGreaterThan(50) // 全部成功应 > 50

    scorer.adjustScore('ceo', -10, '人工降级')
    const after = scorer.getScore('ceo')!.compositeScore
    expect(after).toBeCloseTo(before - 10, 0)
  })

  test('adjustScore 不会超出 0-100 范围', () => {
    for (let i = 0; i < 10; i++) {
      scorer.recordTask({ roleId: 'ceo', task: `t${i}`, toolUsed: 'a', result: 'success', durationMs: 100 })
    }

    scorer.adjustScore('ceo', 999, 'overshoot')
    expect(scorer.getScore('ceo')!.compositeScore).toBeLessThanOrEqual(100)

    scorer.adjustScore('ceo', -999, 'undershoot')
    expect(scorer.getScore('ceo')!.compositeScore).toBeGreaterThanOrEqual(0)
  })

  // ---- 记录限制 ----

  test('allRecords 超过 500 条时截断', () => {
    for (let i = 0; i < 600; i++) {
      scorer.recordTask({ roleId: 'ceo', task: `t${i}`, toolUsed: 'x', result: 'success', durationMs: 10 })
    }
    // 应该只保留最近 500 条
    const allHistory = scorer.getAllHistory(0) // 0 = unlimited
    expect(allHistory.length).toBeLessThanOrEqual(500)
  })

  test('recentRecords 只保留最近 20 条', () => {
    for (let i = 0; i < 30; i++) {
      scorer.recordTask({ roleId: 'ceo', task: `t${i}`, toolUsed: 'x', result: 'success', durationMs: 10 })
    }
    const score = scorer.getScore('ceo')!
    expect(score.recentRecords.length).toBeLessThanOrEqual(20)
    // 最近的是 t29
    expect(score.recentRecords[score.recentRecords.length - 1].task).toBe('t29')
  })

  // ---- lastUsedAt ----

  test('lastUsedAt 记录最近使用时间', () => {
    const before = new Date().toISOString()
    scorer.recordTask({ roleId: 'ceo', task: 't', toolUsed: 'a', result: 'success', durationMs: 100 })
    const score = scorer.getScore('ceo')!
    expect(score.lastUsedAt).toBeTruthy()
    expect(new Date(score.lastUsedAt!).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime())
  })

  // ---- projectPath ----

  test('recordTask 支持 projectPath', () => {
    scorer.recordTask({
      roleId: 'worker',
      task: 'fix bug',
      toolUsed: 'shell_exec',
      projectPath: '/path/to/project',
      result: 'success',
      durationMs: 2000,
    })
    const history = scorer.getHistory('worker')
    expect(history[0].projectPath).toBe('/path/to/project')
  })
})
