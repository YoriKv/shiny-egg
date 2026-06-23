import { useEffect, useLayoutEffect, useRef, useState, type RefObject, type UIEvent } from 'react'

export interface WindowedSlice<T> {
  item: T
  /** The item's index in the FULL `items` array (not the mounted slice). */
  index: number
  /** Absolute `top` (px) of the row within the full-height sizer. */
  top: number
}

export interface WindowedList<T> {
  /** Attach to the scrollable list container (its `clientHeight` is the viewport). */
  listRef: RefObject<HTMLDivElement | null>
  /** Wire to the container's `onScroll`. */
  onScroll: (e: UIEvent<HTMLElement>) => void
  /** Full scroll height of the inner sizer (`items.length * rowPitch`). Set it as
   *  the sizer's `height` so the scrollbar matches the un-windowed list. */
  sizerHeight: number
  /** The mounted slice (visible window + overscan), each with its absolute `top`. */
  slice: WindowedSlice<T>[]
}

/**
 * Fixed-height windowed (virtualized) list. Only the visible slice (+overscan) of
 * `items` is mounted; rows are absolutely positioned (`top` per slice entry)
 * inside a full-height sizer (`sizerHeight`), so a long list never materializes
 * thousands of off-screen DOM nodes.
 *
 * Lifted out of the Picker panel (the original home of this pattern — see its
 * PICKER_ROW_* note) so the Strings panel's pointer-table can share it. Rows MUST
 * be a fixed pitch: pass the CSS row height + inter-row gap as `rowPitch`.
 *
 * `resetKey` scrolls the list back to the top whenever it changes — pass a value
 * that captures the active result set (search/filter/tab) so a new query shows
 * the top hits instead of a stale scroll offset.
 */
export function useWindowedList<T>(
  items: readonly T[],
  rowPitch: number,
  opts: { overscan?: number; resetKey?: unknown } = {}
): WindowedList<T> {
  const { overscan = 6, resetKey } = opts
  const listRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)

  // Measure the viewport before paint (so the first render windows to the real
  // height, not 0), then track it across drag/resize via a ResizeObserver.
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const measure = (): void => setViewportH(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Reset to the top when the result set changes (new search / filter / tab).
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
    setScrollTop(0)
  }, [resetKey])

  const total = items.length
  const maxScroll = Math.max(0, total * rowPitch - viewportH)
  const clampedTop = Math.min(scrollTop, maxScroll) // survives a list shrink
  const start = Math.max(0, Math.floor(clampedTop / rowPitch) - overscan)
  const end = Math.min(total, Math.ceil((clampedTop + viewportH) / rowPitch) + overscan)

  const slice: WindowedSlice<T>[] = []
  for (let i = start; i < end; i++) slice.push({ item: items[i], index: i, top: i * rowPitch })

  return {
    listRef,
    onScroll: (e) => setScrollTop(e.currentTarget.scrollTop),
    sizerHeight: total * rowPitch,
    slice
  }
}
