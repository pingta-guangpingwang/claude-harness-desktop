// AI Service — unified interface for multi-provider AI calls

export interface AIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AICallOptions {
  provider?: string
  model?: string
  temperature?: number
  maxTokens?: number
  system?: string
  apiKey?: string
}

// DeepSeek 支持两种 API 格式：
// - Anthropic 兼容: /anthropic/v1/messages (claude-* 模型)
// - OpenAI 兼容:  /v1/chat/completions  (deepseek-chat, deepseek-reasoner)
const ANTHROPIC_ENDPOINT = 'https://api.deepseek.com/anthropic/v1/messages'
const OPENAI_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions'

function isClaudeModel(model: string): boolean {
  return model.startsWith('claude-')
}

export async function callAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  options?: Partial<AICallOptions>,
): Promise<string> {
  const maxTokens = options?.maxTokens || 4096
  const temperature = options?.temperature

  // 根据模型选择 endpoint 和请求格式
  if (isClaudeModel(model)) {
    // Anthropic 兼容格式
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }
    if (temperature !== undefined) body.temperature = temperature

    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 200)}`)
    }
    const data = await res.json()
    const text = data.content?.[0]?.text
    if (!text) throw new Error(`Empty AI response — raw: ${JSON.stringify(data).slice(0, 300)}`)
    return text
  }

  // OpenAI 兼容格式 (deepseek-chat, deepseek-reasoner 等)
  const messages: Array<{ role: string; content: string }> = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: userMessage })

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages,
  }
  if (temperature !== undefined) body.temperature = temperature

  const res = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`OpenAI API ${res.status}: ${errText.slice(0, 200)}`)
  }
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error(`Empty AI response — raw: ${JSON.stringify(data).slice(0, 300)}`)
  return text
}

export function extractTextFromResponse(data: any): string {
  if (typeof data === 'string') return data
  if (data.content?.[0]?.text) return data.content[0].text
  if (data.choices?.[0]?.message?.content) return data.choices[0].message.content
  if (data.text) return data.text
  return JSON.stringify(data)
}
