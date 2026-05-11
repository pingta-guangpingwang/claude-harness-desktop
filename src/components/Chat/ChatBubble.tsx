import React, { useState } from 'react'
import { AnsiRenderer } from './AnsiRenderer'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  isResponse?: boolean
}

const COLLAPSE_LINES = 8

function lineCount(text: string): number {
  return (text.match(/\n/g) || []).length + 1
}

/** 取最后 n 行 — 回复内容通常在末尾 */
function lastLines(text: string, n: number): string {
  const lines = text.split('\n')
  if (lines.length <= n) return text
  return '...\n' + lines.slice(-n).join('\n')
}

export const ChatBubble: React.FC<{ message: ChatMessage; embedded?: boolean }> = React.memo(({ message, embedded }) => {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const compact = embedded
  const [expanded, setExpanded] = useState(false)

  const totalLines = lineCount(message.content)
  const collapsible = !isUser && !message.isResponse && totalLines > COLLAPSE_LINES
  const displayContent = collapsible && !expanded
    ? lastLines(message.content, COLLAPSE_LINES)
    : message.content

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        marginBottom: compact ? 8 : 12,
      }}
    >
      <div
        onDoubleClick={collapsible ? () => setExpanded(!expanded) : undefined}
        style={{
          maxWidth: '85%',
          padding: compact ? '6px 10px' : '10px 14px',
          borderRadius: compact ? 8 : 12,
          background: isUser ? 'var(--app-bg-user)' : isSystem ? 'var(--app-bg-system)' : 'var(--app-bg-assistant)',
          color: isUser ? 'var(--app-text-user)' : isSystem ? 'var(--app-text-system)' : 'var(--app-text-assistant)',
          fontSize: compact ? 'var(--app-font-size-sm)' : 'var(--app-font-size)',
          lineHeight: compact ? 1.5 : 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: isUser ? 'var(--app-font-sans)' : 'var(--app-font-mono)',
          borderBottomRightRadius: isUser ? 4 : compact ? 8 : 12,
          borderBottomLeftRadius: isUser ? compact ? 8 : 12 : 4,
          cursor: collapsible ? 'pointer' : 'default',
          maxHeight: collapsible && !expanded ? `${COLLAPSE_LINES * 1.6 * 13}px` : undefined,
          overflow: 'hidden',
          position: 'relative' as const,
        }}
      >
        {isUser ? (
          displayContent
        ) : (
          <AnsiRenderer text={displayContent} />
        )}

        {/* 折叠提示 */}
        {collapsible && !expanded && (
          <div style={{
            fontSize: 10,
            color: 'var(--app-text-secondary)',
            textAlign: 'center',
            marginTop: 4,
            fontStyle: 'italic',
            userSelect: 'none',
          }}>
            ... 双击展开 ({totalLines - COLLAPSE_LINES} 行更多) ...
          </div>
        )}
        {collapsible && expanded && (
          <div style={{
            fontSize: 10,
            color: 'var(--app-text-secondary)',
            textAlign: 'center',
            marginTop: 4,
            fontStyle: 'italic',
            userSelect: 'none',
          }}>
            ... 双击收起 ...
          </div>
        )}
      </div>
      <span
        style={{
          fontSize: compact ? 9 : 10,
          color: 'var(--app-text-secondary)',
          marginTop: 2,
          padding: '0 4px',
        }}
      >
        {new Date(message.timestamp).toLocaleTimeString()}
      </span>
    </div>
  )
})

ChatBubble.displayName = 'ChatBubble'
