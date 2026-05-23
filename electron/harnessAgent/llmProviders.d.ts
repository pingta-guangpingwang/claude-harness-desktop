export type ProviderFormat = 'openai' | 'anthropic';
export interface LLMProvider {
    id: string;
    name: string;
    format: ProviderFormat;
    /** OpenAI 兼容的 chat/completions 端点 */
    chatEndpoint: string;
    /** Anthropic 兼容的 messages 端点（可选，仅 Anthropic 格式需要） */
    messagesEndpoint?: string;
    defaultModel: string;
    availableModels: string[];
    maxContextTokens: number;
    maxOutputTokens: number;
    /** 请求头构建 */
    buildHeaders: (apiKey: string) => Record<string, string>;
    /** Anthropic 格式需要额外的请求 body 字段 */
    buildAnthropicBody?: (base: Record<string, unknown>) => Record<string, unknown>;
    description: string;
}
export declare function registerProvider(provider: LLMProvider): void;
export declare function getProvider(id: string): LLMProvider | undefined;
export declare function listProviders(): LLMProvider[];
/**
 * 根据 model 名称自动检测 provider
 * 优先级：精确 ID 匹配 → model 前缀匹配
 */
export declare function detectProvider(model: string, explicitProviderId?: string): LLMProvider;
/**
 * 构建自定义 provider（用户通过 UI 添加）
 */
export declare function buildCustomProvider(config: {
    id: string;
    name: string;
    format: ProviderFormat;
    chatEndpoint: string;
    defaultModel: string;
    apiKey: string;
    maxContextTokens?: number;
}): LLMProvider;
/** 获取所有 provider 的 ID 列表（用于前端下拉菜单） */
export declare function getProviderOptions(): Array<{
    id: string;
    name: string;
    format: ProviderFormat;
    defaultModel: string;
}>;
