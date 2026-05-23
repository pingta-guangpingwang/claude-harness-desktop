import { type TokenBudgeter } from './tokenBudget.js';
import type { AgentContext } from './types.js';
export interface ContextView {
    /** 累积的系统提示词部分 */
    systemPromptParts: string[];
    /** 当前 token 估算 */
    estimatedTokens: number;
    /** 预算分配 */
    budget: {
        systemPrompt: number;
        hot: number;
        warm: number;
        cold: number;
        snapshot: number;
    };
    /** 项目状态快照文本 */
    snapshot: string;
    /** 知识注入文本 */
    knowledge: string;
    /** 元数据 */
    meta: {
        role?: string;
        providerModel: string;
        maxContextTokens: number;
    };
}
export type ContextProcessor = (view: ContextView, ctx: AgentContext) => ContextView | Promise<ContextView>;
export declare const IdentityProcessor: ContextProcessor;
export declare const TokenBudgetProcessor: ContextProcessor;
export declare const ContextSelectorProcessor: ContextProcessor;
export declare const KnowledgeInjectorProcessor: ContextProcessor;
export declare const CachePrefixerProcessor: ContextProcessor;
export declare const DynamicInjectorProcessor: ContextProcessor;
export declare const DEFAULT_PIPELINE: ContextProcessor[];
export declare function runPipeline(pipeline: ContextProcessor[], ctx: AgentContext, budget: TokenBudgeter): Promise<string>;
/** 便捷函数 — 一键运行默认 Pipeline 获取系统提示词 */
export declare function buildContext(ctx: AgentContext, tokenBudgeter: TokenBudgeter): Promise<string>;
