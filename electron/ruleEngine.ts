// RuleEngine — { when: condition, then: action } 规则引擎，无需完整工作流
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface RuleCondition {
  /** 触发事件类型: file_change | cli_executed | project_status | agent_tool | timer | variable_change */
  event: string
  /** 事件过滤器，支持通配符 */
  pattern?: string
  /** JS 表达式，可用变量: event, projectPath, params, vars */
  expression?: string
}

export interface RuleAction {
  /** 动作类型 */
  type: 'cli.command' | 'notification' | 'workflow.trigger' | 'variable.set' | 'file.write' | 'log'
  /** 动作参数 */
  config: Record<string, unknown>
}

export interface Rule {
  id: string
  name: string
  description?: string
  enabled: boolean
  /** 规则优先级，数字越小越先执行 */
  priority: number
  when: RuleCondition
  then: RuleAction | RuleAction[]
  /** 冷却时间（毫秒），防止重复触发 */
  cooldownMs?: number
  /** 最后触发时间 */
  lastTriggeredAt?: number
  createdAt: string
  updatedAt: string
}

interface RuleEngineState {
  rules: Rule[]
  variables: Record<string, unknown>
}

export class RuleEngine {
  private rules: Map<string, Rule> = new Map()
  private variables: Map<string, unknown> = new Map()
  private statePath: string
  private onChangeCallback: ((rule: Rule) => void) | null = null

  constructor(statePath?: string) {
    this.statePath = statePath || getDefaultRulesPath()
    this.loadState()
  }

  /** 注册/更新规则 */
  register(rule: Rule): void {
    rule.updatedAt = new Date().toISOString()
    if (!rule.createdAt) rule.createdAt = rule.updatedAt
    this.rules.set(rule.id, rule)
    this.saveState()
    this.onChangeCallback?.(rule)
  }

  /** 移除规则 */
  remove(ruleId: string): boolean {
    const ok = this.rules.delete(ruleId)
    if (ok) this.saveState()
    return ok
  }

  /** 获取规则 */
  get(ruleId: string): Rule | undefined {
    return this.rules.get(ruleId)
  }

  /** 列出所有规则 */
  list(): Rule[] {
    return Array.from(this.rules.values()).sort((a, b) => a.priority - b.priority)
  }

  /** 设置变量 */
  setVariable(key: string, value: unknown): void {
    this.variables.set(key, value)
  }

  /** 获取变量 */
  getVariable(key: string): unknown {
    return this.variables.get(key)
  }

  /** 评估事件并触发匹配的规则 */
  evaluate(event: string, context: Record<string, unknown> = {}): Rule[] {
    const triggered: Rule[] = []
    const now = Date.now()

    for (const rule of this.list()) {
      if (!rule.enabled) continue

      // 冷却检查
      if (rule.cooldownMs && rule.lastTriggeredAt) {
        if (now - rule.lastTriggeredAt < rule.cooldownMs) continue
      }

      // 事件匹配
      if (rule.when.event !== event && rule.when.event !== '*') continue

      // pattern 匹配
      if (rule.when.pattern) {
        const target = String(context['target'] || context['projectPath'] || '')
        if (!matchWildcard(rule.when.pattern, target)) continue
      }

      // expression 匹配
      if (rule.when.expression) {
        try {
          const vars = { ...Object.fromEntries(this.variables), ...context, event }
          const pass = new Function('vars', `with(vars) { return !!(${rule.when.expression}) }`)(vars)
          if (!pass) continue
        } catch { continue }
      }

      // 触发
      rule.lastTriggeredAt = now
      triggered.push(rule)
    }

    return triggered
  }

  /** 执行规则的 then 动作 */
  async executeActions(rule: Rule, context: Record<string, unknown> = {}): Promise<string[]> {
    const actions = Array.isArray(rule.then) ? rule.then : [rule.then]
    const results: string[] = []

    for (const action of actions) {
      try {
        switch (action.type) {
          case 'variable.set': {
            const key = action.config.key as string
            const value = action.config.value
            if (key) {
              this.variables.set(key, value)
              results.push(`变量设置: ${key} = ${JSON.stringify(value)}`)
            }
            break
          }
          case 'log': {
            const msg = resolveTemplate(String(action.config.message || ''), { ...context, ...Object.fromEntries(this.variables) })
            results.push(`日志: ${msg}`)
            break
          }
          case 'notification': {
            const msg = resolveTemplate(String(action.config.message || ''), { ...context, ...Object.fromEntries(this.variables) })
            results.push(`通知: ${msg}`)
            break
          }
          case 'cli.command': {
            const cmd = String(action.config.command || '')
            results.push(`CLI: ${cmd}`)
            break
          }
          case 'workflow.trigger': {
            const wfId = String(action.config.workflowId || '')
            results.push(`工作流触发: ${wfId}`)
            break
          }
          case 'file.write': {
            const path = resolveTemplate(String(action.config.path || ''), { ...context, ...Object.fromEntries(this.variables) })
            const content = resolveTemplate(String(action.config.content || ''), { ...context, ...Object.fromEntries(this.variables) })
            results.push(`文件写入: ${path}`)
            break
          }
          default:
            results.push(`未知动作: ${action.type}`)
        }
      } catch (err) {
        results.push(`动作执行失败: ${String(err)}`)
      }
    }

    return results
  }

  /** 监听规则变更 */
  onChange(callback: (rule: Rule) => void): void {
    this.onChangeCallback = callback
  }

  /** 获取状态快照 */
  getState(): RuleEngineState {
    return {
      rules: this.list(),
      variables: Object.fromEntries(this.variables),
    }
  }

  private saveState(): void {
    try {
      const state: RuleEngineState = {
        rules: this.list(),
        variables: Object.fromEntries(this.variables),
      }
      writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf-8')
    } catch { /* ignore */ }
  }

  private loadState(): void {
    try {
      if (existsSync(this.statePath)) {
        const raw = readFileSync(this.statePath, 'utf-8')
        const state: RuleEngineState = JSON.parse(raw)
        for (const rule of (state.rules || [])) {
          this.rules.set(rule.id, rule)
        }
        for (const [k, v] of Object.entries(state.variables || {})) {
          this.variables.set(k, v)
        }
      }
    } catch { /* ignore */ }
  }
}

function matchWildcard(pattern: string, target: string): boolean {
  const regex = new RegExp('^' + pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.') + '$')
  return regex.test(target)
}

function resolveTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ''))
}

function getDefaultRulesPath(): string {
  try {
    const { app } = require('electron')
    const p = join(app.getPath('userData'), 'rules.json')
    return p
  } catch { return join(process.cwd(), '.chd', 'rules.json') }
}
