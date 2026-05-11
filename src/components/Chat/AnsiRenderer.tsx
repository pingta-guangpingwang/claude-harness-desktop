import React from 'react'

interface AnsiSpan {
  text: string
  fg?: string
  bg?: string
  bold?: boolean
}

const SGR_COLORS: Record<number, string> = {
  30: 'var(--ansi-black)', 31: 'var(--ansi-red)', 32: 'var(--ansi-green)', 33: 'var(--ansi-yellow)',
  34: 'var(--ansi-blue)', 35: 'var(--ansi-magenta)', 36: 'var(--ansi-cyan)', 37: 'var(--ansi-white)',
  90: 'var(--ansi-bright-black)', 91: 'var(--ansi-bright-red)', 92: 'var(--ansi-bright-green)', 93: 'var(--ansi-bright-yellow)',
  94: 'var(--ansi-bright-blue)', 95: 'var(--ansi-bright-magenta)', 96: 'var(--ansi-bright-cyan)', 97: 'var(--ansi-bright-white)',
}

function parseAnsiSpans(text: string): AnsiSpan[] {
  const spans: AnsiSpan[] = []
  let current: AnsiSpan = { text: '' }
  let i = 0

  while (i < text.length) {
    if (text[i] === '\x1b' && text[i + 1] === '[') {
      let j = i + 2
      while (j < text.length && !/[A-Za-z]/.test(text[j])) j++
      if (j >= text.length) {
        current.text += text.slice(i)
        break
      }

      const code = text[j]
      const params = text.slice(i + 2, j).split(';').map(Number)

      if (code === 'm') {
        if (current.text) {
          spans.push({ ...current })
          current = { ...current, text: '' }
        }
        for (const p of params) {
          if (p === 0) {
            current = { text: '' }
          } else if (p === 1) {
            current.bold = true
          } else if (p === 22) {
            current.bold = false
          } else if (p >= 30 && p <= 37) {
            current.fg = SGR_COLORS[p]
          } else if (p >= 90 && p <= 97) {
            current.fg = SGR_COLORS[p]
          } else if (p === 39) {
            current.fg = undefined
          } else if (p >= 40 && p <= 47) {
            current.bg = SGR_COLORS[p - 10]
          } else if (p === 49) {
            current.bg = undefined
          }
        }
      }
      // 其他 CSI 码 (光标移动等) 静默跳过
      i = j + 1
    } else if (text[i] === '\r') {
      // \r 后跟 \n → 正常换行
      if (text[i + 1] === '\n') {
        current.text += '\n'
        i += 2
      } else {
        // 单独的 \r = 覆盖当前行（进度条/TUI 重绘），回到行首
        // 移除上一个 \n 之后的所有内容（即当前行的内容）
        const lastNewline = current.text.lastIndexOf('\n')
        if (lastNewline !== -1) {
          current.text = current.text.slice(0, lastNewline + 1)
        } else {
          current.text = ''
        }
        i++
      }
    } else if (text[i] === '\n') {
      current.text += '\n'
      i++
    } else {
      current.text += text[i]
      i++
    }
  }

  if (current.text) spans.push({ ...current })
  // 过滤纯空白 span 避免渲染空行闪烁
  return spans.filter(s => s.text.length > 0)
}

export const AnsiRenderer: React.FC<{ text: string }> = React.memo(({ text }) => {
  const spans = parseAnsiSpans(text)

  if (spans.length === 0) return null

  return (
    <>
      {spans.map((span, i) => {
        const style: React.CSSProperties = {}
        if (span.fg) style.color = span.fg
        if (span.bg) style.backgroundColor = span.bg
        if (span.bold) style.fontWeight = 'bold'
        return (
          <span key={i} style={style}>
            {span.text}
          </span>
        )
      })}
    </>
  )
})

AnsiRenderer.displayName = 'AnsiRenderer'
