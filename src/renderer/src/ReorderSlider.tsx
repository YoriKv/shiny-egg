import { useEffect, useRef, useState, type JSX } from 'react'
import { useThrottledCallback } from './lib/throttle'

/** How long a window suppresses preview re-renders while sliding. A continuous
 *  drag re-decodes the draw order at most once per this window — see
 *  useThrottledCallback. The commit (undo step) is separate: once per drag. */
const REORDER_THROTTLE_MS = 120

/**
 * Stream-index slider popover (right-click → "Change paint order…"). Reorders an
 * object/sprite in paint/overlap order. Higher index = stamped/drawn later = on
 * top ("front"); 0 = "back".
 *
 * The draw order updates LIVE while dragging via a throttled `onPreview` (Canvas
 * feeds the reordered level to the render layers WITHOUT committing) — so a
 * continuous slide re-decodes at most once per window, not per tick. The undo
 * step lands once per drag: `onCommit` fires on release (pointer/key up), and a
 * final safety commit fires on unmount (idempotent — a no-op if already there).
 */
export function ReorderSlider({
  x,
  y,
  kind,
  uid,
  index,
  max,
  onPreview,
  onCommit,
  onClose
}: {
  x: number
  y: number
  kind: 'object' | 'sprite'
  uid: number
  /** Initial committed stream position (seed). */
  index: number
  /** Highest valid position (`list.length - 1`). */
  max: number
  /** Live, throttled — show the pending order without committing. */
  onPreview: (kind: 'object' | 'sprite', uid: number, index: number) => void
  /** End of drag — commit one undo step. */
  onCommit: (kind: 'object' | 'sprite', uid: number, index: number) => void
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState(index)
  const throttledPreview = useThrottledCallback<number>(
    (v) => onPreview(kind, uid, v),
    REORDER_THROTTLE_MS
  )

  // Refs so the unmount cleanup commits the latest value with the latest handler.
  const valueRef = useRef(value)
  valueRef.current = value
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit

  // Close on outside mousedown / Escape (mirrors ContextMenu). The actual commit
  // happens in the unmount cleanup below, so closing always persists the order.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Safety commit on unmount (covers a close that didn't go through pointer/key
  // up — e.g. Escape mid-drag). Idempotent, so a normal release isn't doubled.
  useEffect(
    () => () => {
      commitRef.current(kind, uid, valueRef.current)
    },
    [kind, uid]
  )

  const slide = (v: number): void => {
    setValue(v)
    throttledPreview(v) // live, throttled preview (no commit)
  }
  const setAndCommit = (v: number): void => {
    setValue(v)
    onCommit(kind, uid, v)
  }

  return (
    <div
      ref={ref}
      className="se-reorder"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="se-reorder__title">
        Index
        <span className="se-reorder__value">
          {value} / {max}
        </span>
      </div>
      <div className="se-reorder__row">
        <button
          type="button"
          className="se-reorder__end"
          title="Send to back"
          onClick={() => setAndCommit(0)}
        >
          back
        </button>
        <input
          type="range"
          className="se-reorder__slider"
          min={0}
          max={max}
          step={1}
          value={value}
          autoFocus
          onChange={(e) => slide(Number(e.currentTarget.value))}
          onPointerUp={(e) => onCommit(kind, uid, Number(e.currentTarget.value))}
          onKeyUp={(e) => onCommit(kind, uid, Number(e.currentTarget.value))}
        />
        <button
          type="button"
          className="se-reorder__end"
          title="Bring to front"
          onClick={() => setAndCommit(max)}
        >
          front
        </button>
      </div>
    </div>
  )
}
