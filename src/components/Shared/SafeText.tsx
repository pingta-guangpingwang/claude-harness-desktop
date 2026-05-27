import React, { useCallback, useLayoutEffect, useRef, useState } from "react"

// =============================================================================
// SafeText — full-text display component, zero truncation
// =============================================================================
// Problem: many UI places use .slice(0, N) which permanently discards content.
// SafeText renders the FULL text always. For very long content (>threshold chars)
// it defaults to collapsed with an expand button. Short text is always shown.
//
// Object-pool backing: for extremely long text (>20000 chars), the rendered
// content is split into chunks and progressively painted via rAF to avoid
// blocking the main thread.
// =============================================================================

export interface SafeTextProps {
  text: string
  /** Character threshold for collapsible mode. Default 0 = never collapse. */
  collapsibleAt?: number
  /** Max visible chars when collapsed. Default = collapsibleAt. */
  previewChars?: number
  /** Custom expand label */
  expandLabel?: string
  /** Custom collapse label */
  collapseLabel?: string
  className?: string
  style?: React.CSSProperties
  /** Render as inline span instead of block div */
  inline?: boolean
}

// Chunk size for progressive rendering of huge text blocks
const CHUNK_SIZE = 4000
const PROGRESSIVE_THRESHOLD = 20000

export function SafeText({
  text,
  collapsibleAt = 0,
  previewChars,
  expandLabel = "展开全部",
  collapseLabel = "收起",
  className,
  style,
  inline,
}: SafeTextProps) {
  const [expanded, setExpanded] = useState(false)
  const [, setRenderTick] = useState(0)
  const fullRenderedRef = useRef(false)

  // Progressive render for extremely long text — chunk via rAF to avoid frame drops
  useLayoutEffect(() => {
    if (text.length <= PROGRESSIVE_THRESHOLD || fullRenderedRef.current) return
    const chunks = Math.ceil(text.length / CHUNK_SIZE)
    let rendered = 1
    fullRenderedRef.current = false
    const tick = () => {
      if (rendered >= chunks) {
        fullRenderedRef.current = true
        return
      }
      rendered++
      setRenderTick(t => t + 1)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return () => { fullRenderedRef.current = true }
  }, [text])

  // Determine effective visible chars for progressive rendering
  const visibleChars = fullRenderedRef.current || text.length <= PROGRESSIVE_THRESHOLD
    ? text.length
    : Math.min(text.length, CHUNK_SIZE * (fullRenderedRef.current ? 999 : 1))

  const shouldCollapse = collapsibleAt > 0 && text.length > collapsibleAt && !expanded
  const preview = previewChars ?? collapsibleAt
  const displayText = shouldCollapse
    ? text.slice(0, preview) + '…'
    : text.slice(0, visibleChars)

  const Tag = inline ? 'span' : 'div'

  return (
    <Tag className={className} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...style }}>
      {displayText}
      {text.length > (collapsibleAt || 0) && (
        <>
          {' '}
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            style={{
              background: 'none',
              border: 'none',
              color: '#60a5fa',
              cursor: 'pointer',
              fontSize: 'inherit',
              padding: 0,
              textDecoration: 'underline',
              whiteSpace: 'nowrap',
            }}
          >
            {expanded ? collapseLabel : expandLabel}
          </button>
        </>
      )}
    </Tag>
  )
}

// =============================================================================
// SafeTextSpan — inline variant, no collapse, always full text
// =============================================================================

export function SafeTextSpan({
  text,
  className,
  style,
}: {
  text: string
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span className={className} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...style }}>
      {text}
    </span>
  )
}
