// 驾驭智能体 — LLM Provider 抽象层
// 解耦硬编码的 endpoint，支持多 Provider 切换

export type ProviderFormat = 'openai' | 'anthropic'

export interface LLMProvider {
  id: string
  name: string
  format: ProviderFormat
  /** OpenAI 兼容的 chat/completions 端点 */
  chatEndpoint: string
  /** Anthropic 兼容的 messages 端点（可选，仅 Anthropic 格式需要） */
  messagesEndpoint?: string
  defaultModel: string
  availableModels: string[]
  maxContextTokens: number
  maxOutputTokens: number
  /** 请求头构建 */
  buildHeaders: (apiKey: string) => Record<string, string>
  /** Anthropic 格式需要额外的请求 body 字段 */
  buildAnthropicBody?: (base: Record<string, unknown>) => Record<string, unknown>
  description: string
}

// ====== 预置 Provider ======

const DEEPSEEK_PROVIDER: LLMProvider = {
  id: 'deepseek',
  name: 'DeepSeek',
  format: 'openai',
  chatEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  messagesEndpoint: 'https://api.deepseek.com/anthropic/v1/messages',
  defaultModel: 'deepseek-v4-pro',
  availableModels: ['deepseek-v4-pro', 'deepseek-chat', 'deepseek-v3', 'deepseek-reasoner'],
  maxContextTokens: 128_000,
  maxOutputTokens: 4096,
  buildHeaders: (apiKey: string) => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  }),
  buildAnthropicBody: (base) => ({
    ...base,
    // DeepSeek Anthropic 兼容端点需要的额外字段
  }),
  description: 'DeepSeek V4/V3 API — OpenAI 兼容格式，也支持 Anthropic 兼容端点',
}

const ANTHROPIC_PROVIDER: LLMProvider = {
  id: 'anthropic',
  name: 'Anthropic Claude',
  format: 'anthropic',
  chatEndpoint: 'https://api.anthropic.com/v1/messages',
  messagesEndpoint: 'https://api.anthropic.com/v1/messages',
  defaultModel: 'claude-sonnet-4-6',
  availableModels: [
    'claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5',
    'claude-3-5-sonnet', 'claude-3-opus', 'claude-3-haiku',
  ],
  maxContextTokens: 200_000,
  maxOutputTokens: 4096,
  buildHeaders: (apiKey: string) => ({
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }),
  description: 'Anthropic Claude API — 原生 Messages API，完整 tool_use 支持',
}

const OPENAI_PROVIDER: LLMProvider = {
  id: 'openai',
  name: 'OpenAI',
  format: 'openai',
  chatEndpoint: 'https://api.openai.com/v1/chat/completions',
  defaultModel: 'gpt-4o',
  availableModels: ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
  maxContextTokens: 128_000,
  maxOutputTokens: 4096,
  buildHeaders: (apiKey: string) => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  }),
  description: 'OpenAI API — 原生 OpenAI 格式',
}

// ====== Provider 注册表 ======

const PROVIDER_REGISTRY: Map<string, LLMProvider> = new Map()
PROVIDER_REGISTRY.set('deepseek', DEEPSEEK_PROVIDER)
PROVIDER_REGISTRY.set('anthropic', ANTHROPIC_PROVIDER)
PROVIDER_REGISTRY.set('openai', OPENAI_PROVIDER)

// ====== API ======

export function registerProvider(provider: LLMProvider): void {
  PROVIDER_REGISTRY.set(provider.id, provider)
}

export function getProvider(id: string): LLMProvider | undefined {
  return PROVIDER_REGISTRY.get(id)
}

export function listProviders(): LLMProvider[] {
  return [...PROVIDER_REGISTRY.values()]
}

/**
 * 根据 model 名称自动检测 provider
 * 优先级：精确 ID 匹配 → model 前缀匹配
 */
export function detectProvider(model: string, explicitProviderId?: string): LLMProvider {
  // 1. 显式指定 → 直接使用
  if (explicitProviderId) {
    const provider = PROVIDER_REGISTRY.get(explicitProviderId)
    if (provider) return provider
  }

  // 2. model 名前缀匹配
  if (model.startsWith('deepseek-')) return DEEPSEEK_PROVIDER
  if (model.startsWith('claude-')) return ANTHROPIC_PROVIDER
  if (model.startsWith('gpt-') || model.startsWith('o1-') || model.startsWith('o3-')) return OPENAI_PROVIDER

  // 3. 默认回退到 DeepSeek（当前主要的后端）
  return DEEPSEEK_PROVIDER
}

/**
 * 构建自定义 provider（用户通过 UI 添加）
 */
export function buildCustomProvider(config: {
  id: string
  name: string
  format: ProviderFormat
  chatEndpoint: string
  defaultModel: string
  apiKey: string
  maxContextTokens?: number
}): LLMProvider {
  const isAnthropic = config.format === 'anthropic'
  return {
    id: config.id,
    name: config.name,
    format: config.format,
    chatEndpoint: config.chatEndpoint,
    messagesEndpoint: isAnthropic ? config.chatEndpoint : undefined,
    defaultModel: config.defaultModel,
    availableModels: [config.defaultModel],
    maxContextTokens: config.maxContextTokens || 128_000,
    maxOutputTokens: 4096,
    buildHeaders: (apiKey: string) => isAnthropic
      ? { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    description: `自定义 Provider: ${config.name}`,
  }
}

/** 获取所有 provider 的 ID 列表（用于前端下拉菜单） */
export function getProviderOptions(): Array<{ id: string; name: string; format: ProviderFormat; defaultModel: string }> {
  return listProviders().map(p => ({
    id: p.id,
    name: p.name,
    format: p.format,
    defaultModel: p.defaultModel,
  }))
}
