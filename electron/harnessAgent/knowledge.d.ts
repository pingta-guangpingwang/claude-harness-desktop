export interface ApiRecipe {
    id: string;
    name: string;
    tags: string[];
    /** 诊断信号 — 终端输出中出现这些关键词表示可能匹配此配方 */
    diagnosticSigns: string[];
    /** 正确的 .claude/settings.json 内容 */
    settingsJson: Record<string, unknown>;
    /** 需要的环境变量 */
    envVars?: Record<string, string>;
    notes: string;
}
export interface ErrorPattern {
    id: string;
    category: 'CONFIG' | 'PERMISSION' | 'NETWORK' | 'PROJECT' | 'UNKNOWN';
    /** 终端输出 / settings.json 中匹配此错误的模式 */
    patterns: RegExp[];
    /** 人类可读的诊断说明 */
    diagnosis: string;
    /** 建议的恢复步骤（工具名 + 参数提示） */
    recovery: Array<{
        tool: string;
        description: string;
        params?: Record<string, unknown>;
    }>;
}
export declare function searchKnowledge(query: string): {
    recipes: ApiRecipe[];
    errors: ErrorPattern[];
    summary: string;
};
/** 根据终端输出文本匹配错误模式，返回诊断列表 */
export declare function diagnoseErrors(terminalOutput: string): Array<{
    pattern: ErrorPattern;
    match: string;
}>;
/** 列出所有可用的 API 配方（不搜索，全量） */
export declare function listAllRecipes(): ApiRecipe[];
/** 列出所有错误模式 */
export declare function listAllErrorPatterns(): ErrorPattern[];
