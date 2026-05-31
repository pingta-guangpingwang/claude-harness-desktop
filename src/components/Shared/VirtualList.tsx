import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"

// =============================================================================
// VirtualList — dynamic object pool windowed list
// =============================================================================
// Only renders items visible in the viewport + overscan buffer.
// Recycles DOM nodes via absolute positioning within a spacer div.
//
// Props:
//   items            - full data array
//   renderItem       - (item, index) => ReactNode
//   estimateHeight   - estimated item height in px (used before measurement)
//   overscan         - extra rows above/below viewport (default 5)
//   scrollContainer  - optional wrapper class
// =============================================================================

export interface VirtualListProps<T> {
  items: T[]
  renderItem: (item: T, index: number) => React.ReactNode
  estimateHeight?: number
  overscan?: number
  className?: string
  style?: React.CSSProperties
  getItemKey?: (item: T, index: number) => string | number
  /** 是否自动跟随底部（新消息到达时滚动到底部） */
  followBottom?: boolean
}

interface MeasuredItem {
  index: number
  top: number
  height: number
}

export function VirtualList<T>({
  items,
  renderItem,
  estimateHeight = 48,
  overscan = 5,
  className,
  style,
  getItemKey,
  followBottom = false,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measurementsRef = useRef<Map<number, number>>(new Map())
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const [measureTick, setMeasureTick] = useState(0)
  const prevLengthRef = useRef(items.length)
  const userScrolledRef = useRef(false)

  // followBottom: 新消息到达时 / followBottom 变为 true 时自动滚到底部
  const wasFollowingRef = useRef(followBottom)
  useEffect(() => {
    const justStartedFollowing = followBottom && !wasFollowingRef.current
    if (justStartedFollowing) {
      userScrolledRef.current = false // 重置翻阅状态
    }
    const newItems = items.length > prevLengthRef.current
    if (followBottom && (newItems || justStartedFollowing) && !userScrolledRef.current) {
      // 多次尝试滚动，确保布局计算完成
      const scroll = () => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight
        }
      }
      requestAnimationFrame(() => { scroll(); setTimeout(scroll, 100) })
    }
    prevLengthRef.current = items.length
    wasFollowingRef.current = followBottom
  }, [items.length, followBottom])

  // 检测用户手动滚动（离开底部 = 用户主动翻阅历史）
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setScrollTop(el.scrollTop)
    // 用户离开底部超过 60px 视为主动翻阅
    userScrolledRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 60
  }, [])

  // Called when the container resizes or we mount
  const updateContainerHeight = useCallback(() => {
    if (containerRef.current) {
      setContainerHeight(containerRef.current.clientHeight)
    }
  }, [])

  useEffect(() => {
    updateContainerHeight()
    const ro = new ResizeObserver(updateContainerHeight)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [updateContainerHeight])

  // Compute measured item positions (depends on measureTick to re-layout after measurements)
  const layout = useMemo(() => {
    const rows: MeasuredItem[] = []
    let top = 0
    for (let i = 0; i < items.length; i++) {
      const h = measurementsRef.current.get(i) ?? estimateHeight
      rows.push({ index: i, top, height: h })
      top += h
    }
    return { rows, totalHeight: top }
  }, [items, estimateHeight, measureTick])

  // Binary search for the first visible row
  const findStartIndex = useCallback(
    (scrollTop: number) => {
      const { rows } = layout
      let lo = 0
      let hi = rows.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1
        if (rows[mid].top < scrollTop) lo = mid + 1
        else hi = mid - 1
      }
      return Math.max(0, hi)
    },
    [layout],
  )

  // Visible range
  const visibleRange = useMemo(() => {
    if (containerHeight === 0 || items.length === 0) return { start: 0, end: 0, visibleItems: [] as MeasuredItem[] }
    const start = findStartIndex(scrollTop)
    const end = findStartIndex(scrollTop + containerHeight) + 1
    const osStart = Math.max(0, start - overscan)
    const osEnd = Math.min(layout.rows.length, end + overscan)
    const visibleItems: MeasuredItem[] = []
    for (let i = osStart; i < osEnd; i++) {
      visibleItems.push(layout.rows[i])
    }
    return { start: osStart, end: osEnd, visibleItems }
  }, [scrollTop, containerHeight, items.length, layout, overscan, findStartIndex])

  // Measure callback — triggers re-layout when actual height differs from estimate
  const measureRef = useCallback(
    (el: HTMLDivElement | null, index: number) => {
      if (!el) return
      const actualHeight = el.getBoundingClientRect().height
      const prev = measurementsRef.current.get(index)
      if (actualHeight > 0 && actualHeight !== prev) {
        measurementsRef.current.set(index, actualHeight)
        setMeasureTick(t => t + 1)
      }
    },
    [],
  )

  if (items.length === 0) {
    return <div className={className} style={style} />
  }

  return (
    <div
      ref={containerRef}
      className={className}
      data-chat-scroll=""
      style={{
        overflow: "auto",
        position: "relative",
        ...style,
      }}
      onScroll={handleScroll}
    >
      {/* Spacer to make scrollbar correct */}
      <div style={{ height: layout.totalHeight, position: "relative" }}>
        {visibleRange.visibleItems.map((row) => (
          <div
            key={getItemKey ? getItemKey(items[row.index], row.index) : row.index}
            ref={(el) => measureRef(el, row.index)}
            style={{
              position: "absolute",
              top: row.top,
              left: 0,
              right: 0,
            }}
          >
            {renderItem(items[row.index], row.index)}
          </div>
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// useVirtualList — hook variant for more control over rendering
// =============================================================================

export function useVirtualList<T>(items: T[], estimateHeight = 48, overscan = 5) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measurementsRef = useRef<Map<number, number>>(new Map())
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const [measureTick, setMeasureTick] = useState(0)

  useEffect(() => {
    if (containerRef.current) {
      setContainerHeight(containerRef.current.clientHeight)
      const ro = new ResizeObserver(() => {
        if (containerRef.current) setContainerHeight(containerRef.current.clientHeight)
      })
      ro.observe(containerRef.current)
      return () => ro.disconnect()
    }
  }, [])

  const layout = useMemo(() => {
    const rows: MeasuredItem[] = []
    let top = 0
    for (let i = 0; i < items.length; i++) {
      const h = measurementsRef.current.get(i) ?? estimateHeight
      rows.push({ index: i, top, height: h })
      top += h
    }
    return { rows, totalHeight: top }
  }, [items, estimateHeight, measureTick])

  const findStartIndex = useCallback(
    (st: number) => {
      let lo = 0
      let hi = layout.rows.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1
        if (layout.rows[mid].top < st) lo = mid + 1
        else hi = mid - 1
      }
      return Math.max(0, hi)
    },
    [layout],
  )

  const visibleItems = useMemo(() => {
    if (containerHeight === 0 || items.length === 0) return []
    const start = findStartIndex(scrollTop)
    const end = findStartIndex(scrollTop + containerHeight) + 1
    const osStart = Math.max(0, start - overscan)
    const osEnd = Math.min(layout.rows.length, end + overscan)
    const result: (MeasuredItem & { item: T })[] = []
    for (let i = osStart; i < osEnd; i++) {
      result.push({ ...layout.rows[i], item: items[i] })
    }
    return result
  }, [scrollTop, containerHeight, items, layout, overscan, findStartIndex])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const measureRef = useCallback((el: HTMLElement | null, index: number) => {
    if (!el) return
    const h = el.getBoundingClientRect().height
    if (h > 0 && h !== measurementsRef.current.get(index)) {
      measurementsRef.current.set(index, h)
      setMeasureTick(t => t + 1)
    }
  }, [])

  return {
    containerRef,
    visibleItems,
    totalHeight: layout.totalHeight,
    handleScroll,
    measureRef,
  }
}
