import type { AgentContext } from './types';
export interface ReflectionResult {
    /** 观察到的关键事实 */
    observation: string;
    /** 诊断分类 */
    diagnosis: string;
    /** 诊断置信度 */
    confidence: 'high' | 'medium' | 'low';
    /** 建议的下一步行动 */
    next_action: string;
    /** 策略是否需要调整 */
    strategy_adjustment: string | null;
}
/** 构建 Reflection 用的轻量级提示词（~200 tokens） */
export declare function buildReflectionPrompt(toolResults: Array<{
    name: string;
    output: string;
}>, ctx: AgentContext): string;
/** 解析 Reflection 输出的 JSON */
export declare function parseReflectionOutput(raw: string): ReflectionResult | null;
/** 将 Reflection 结果格式化为注入 LLM 的消息前缀 */
export declare function formatReflectionForLLM(r: ReflectionResult): string;
