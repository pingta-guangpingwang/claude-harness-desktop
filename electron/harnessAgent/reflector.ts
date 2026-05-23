// 驾驭智能体 — Reflection 循环模块
// 在工具执行后、下一轮 LLM 决策前，插入轻量级结构化反思
// 参考 AutoGen/LangGraph 的 Plan-Execute-Reflect 模式

import type { AgentContext } from './types'

export interface ReflectionResult {
  /** 观察到的关键事实 */
  observation: string
  /** 诊断分类 */
  diagnosis: string
  /** 诊断置信度 */
  confidence: 'high' | 'medium' | 'low'
  /** 建议的下一步行动 */
  next_action: string
  /** 策略是否需要调整 */
  strategy_adjustment: string | null
}

/** 构建 Reflection 用的轻量级提示词（~200 tokens） */
export function buildReflectionPrompt(
  toolResults: Array<{ name: string; output: string }>,
  ctx: AgentContext,
): string {
  const resultSummary = toolResults.map(tr => {
    const preview = tr.output.length > 300 ? tr.output.slice(0, 300) + '...' : tr.output
    return `[${tr.name}] ${preview}`
  }).join('\n\n')

  const projectSummary = ctx.projectIds.slice(0, 5).map(id => {
    const name = ctx.projectNames.get(id) || id.split('\\').pop() || id
    const online = ctx.onlineProjects.has(id) ? '在线' : '离线'
    return `  ${name}: ${online}`
  }).join('\n')

  return `你是驾驭智能体的内部反思模块。分析上一步工具调用的结果，输出结构化反思。

## 工具结果
${resultSummary}

## 项目状态
${projectSummary}

请用以下 JSON 格式输出反思（不要调用工具，只输出 JSON）：
{
  "observation": "简要描述观察到什么关键信息（1句话）",
  "diagnosis": "当前情况的诊断标签，从以下选一项: 🟢正常运行 | 🟡需要行动 | 🔴被阻塞 | ⚪信息不足",
  "confidence": "high/medium/low",
  "next_action": "建议下一步做什么（1句话，不超过30字）",
  "strategy_adjustment": "是否需要调整策略（不需要时填null，需要时1句话说明）"
}

只输出 JSON，不要其他文字。`
}

/** 解析 Reflection 输出的 JSON */
export function parseReflectionOutput(raw: string): ReflectionResult | null {
  try {
    // 尝试直接解析
    const trimmed = raw.trim()
    if (trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed)
      return {
        observation: parsed.observation || '',
        diagnosis: parsed.diagnosis || '⚪信息不足',
        confidence: parsed.confidence || 'medium',
        next_action: parsed.next_action || '',
        strategy_adjustment: parsed.strategy_adjustment || null,
      }
    }
    // 尝试从 markdown 代码块中提取
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1].trim())
      return {
        observation: parsed.observation || '',
        diagnosis: parsed.diagnosis || '⚪信息不足',
        confidence: parsed.confidence || 'medium',
        next_action: parsed.next_action || '',
        strategy_adjustment: parsed.strategy_adjustment || null,
      }
    }
    return null
  } catch {
    // 如果 JSON 解析失败，用文本做 fallback
    return {
      observation: raw.slice(0, 200),
      diagnosis: '⚪信息不足',
      confidence: 'low',
      next_action: '继续执行',
      strategy_adjustment: null,
    }
  }
}

/** 将 Reflection 结果格式化为注入 LLM 的消息前缀 */
export function formatReflectionForLLM(r: ReflectionResult): string {
  const parts = [`[反思] 上一步观察: ${r.observation}`]
  parts.push(`诊断: ${r.diagnosis} (置信度: ${r.confidence})`)
  parts.push(`建议: ${r.next_action}`)
  if (r.strategy_adjustment) {
    parts.push(`⚠️ 策略调整: ${r.strategy_adjustment}`)
  }
  return parts.join('\n')
}
