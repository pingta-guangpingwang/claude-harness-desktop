import React, { useRef, useCallback, type KeyboardEvent } from 'react'

interface ChatInputProps {
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
  compact?: boolean
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, disabled, placeholder, compact }) => {
  const ref = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    const text = ref.current?.value.trim()
    if (text && !disabled) {
      onSend(text)
      if (ref.current) {
        ref.current.value = ''
        ref.current.style.height = 'auto'
      }
    }
  }, [onSend, disabled])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const handleInput = useCallback(() => {
    const el = ref.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, compact ? 80 : 120) + 'px'
    }
  }, [compact])

  return (
    <div
      style={{
        display: 'flex',
        gap: compact ? 6 : 8,
        padding: compact ? '6px 10px' : '10px 14px',
        borderTop: '1px solid var(--app-border-primary)',
        background: 'var(--app-bg-secondary)',
        alignItems: 'flex-end',
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        disabled={disabled}
        placeholder={placeholder || '输入消息... (Enter 发送, Shift+Enter 换行)'}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        style={{
          flex: 1,
          resize: 'none',
          padding: compact ? '6px 10px' : '8px 12px',
          borderRadius: compact ? 6 : 8,
          border: '1px solid var(--app-border-input)',
          fontSize: compact ? 'var(--app-font-size-sm)' : 'var(--app-font-size)',
          lineHeight: 1.5,
          outline: 'none',
          fontFamily: 'var(--app-font-sans)',
          maxHeight: compact ? 80 : 120,
          background: 'var(--app-bg-input)',
          color: 'var(--app-text-primary)',
        }}
      />
      <button
        onClick={handleSend}
        disabled={disabled}
        style={{
          padding: compact ? '6px 12px' : '8px 18px',
          borderRadius: compact ? 6 : 8,
          border: 'none',
          background: disabled ? 'var(--app-text-placeholder)' : 'var(--app-accent)',
          color: 'var(--app-text-user)',
          fontSize: compact ? 'var(--app-font-size-sm)' : 'var(--app-font-size)',
          fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        发送
      </button>
    </div>
  )
}
