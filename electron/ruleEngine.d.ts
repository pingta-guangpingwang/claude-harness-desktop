export interface RuleCondition {
    /** 触发事件类型: file_change | cli_executed | project_status | agent_tool | timer | variable_change */
    event: string;
    /** 事件过滤器，支持通配符 */
    pattern?: string;
    /** JS 表达式，可用变量: event, projectPath, params, vars */
    expression?: string;
}
export interface RuleAction {
    /** 动作类型 */
    type: 'cli.command' | 'notification' | 'workflow.trigger' | 'variable.set' | 'file.write' | 'log';
    /** 动作参数 */
    config: Record<string, unknown>;
}
export interface Rule {
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
    /** 规则优先级，数字越小越先执行 */
    priority: number;
    when: RuleCondition;
    then: RuleAction | RuleAction[];
    /** 冷却时间（毫秒），防止重复触发 */
    cooldownMs?: number;
    /** 最后触发时间 */
    lastTriggeredAt?: number;
    createdAt: string;
    updatedAt: string;
}
interface RuleEngineState {
    rules: Rule[];
    variables: Record<string, unknown>;
}
export declare class RuleEngine {
    private rules;
    private variables;
    private statePath;
    private onChangeCallback;
    constructor(statePath?: string);
    /** 注册/更新规则 */
    register(rule: Rule): void;
    /** 移除规则 */
    remove(ruleId: string): boolean;
    /** 获取规则 */
    get(ruleId: string): Rule | undefined;
    /** 列出所有规则 */
    list(): Rule[];
    /** 设置变量 */
    setVariable(key: string, value: unknown): void;
    /** 获取变量 */
    getVariable(key: string): unknown;
    /** 评估事件并触发匹配的规则 */
    evaluate(event: string, context?: Record<string, unknown>): Rule[];
    /** 执行规则的 then 动作 */
    executeActions(rule: Rule, context?: Record<string, unknown>): Promise<string[]>;
    /** 监听规则变更 */
    onChange(callback: (rule: Rule) => void): void;
    /** 获取状态快照 */
    getState(): RuleEngineState;
    private saveState;
    private loadState;
}
export {};
