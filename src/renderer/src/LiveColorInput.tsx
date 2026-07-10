// Uncontrolled <input type="color"> with the editor's live-preview drag
// contract: while the OS color dialog drags, React's onChange (the per-frame
// `input` events) feeds a THROTTLED `onPreview`; the native `change` event
// (dialog close / release) fires `onCommit` once with the final value. This is
// the pattern the Palette panel's pickers use (see LevelPaletteView) — an
// input this component extracts for the simpler color swatches (canvas BG,
// grid color) so a picker drag can't spam per-frame App re-renders or
// settings-persist IPC.
//
// Uncontrolled on purpose: a controlled value round-trips through the throttled
// state and React would keep resetting the input mid-drag, disturbing the open
// OS dialog. `value` is instead synced imperatively when NOT mid-drag (external
// changes: settings load, a reset).

import { useCallback, useEffect, useRef, type JSX } from 'react'
import { useThrottledCallback } from './lib/throttle'

const DEFAULT_THROTTLE_MS = 150

export function LiveColorInput({
  value,
  onPreview,
  onCommit,
  throttleMs = DEFAULT_THROTTLE_MS,
  className,
  title
}: {
  /** Committed #rrggbb value (synced into the input when not mid-drag). */
  value: string
  /** Live, throttled — show the in-progress color without committing. */
  onPreview: (hex: string) => void
  /** Release (native `change`) — commit + persist the final color. */
  onCommit: (hex: string) => void
  throttleMs?: number
  className?: string
  title?: string
}): JSX.Element {
  const elRef = useRef<HTMLInputElement | null>(null)
  const draggingRef = useRef(false)

  const previewRef = useRef(onPreview)
  previewRef.current = onPreview
  const throttledPreview = useThrottledCallback<string>((hex) => previewRef.current(hex), throttleMs)

  // Native 'change' = release. Kept in refs so the listener attached once (via
  // the callback ref) always reaches the latest onCommit.
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit
  const changeListenerRef = useRef(() => {
    draggingRef.current = false
    const el = elRef.current
    if (el) commitRef.current(el.value)
  })
  const attach = useCallback((el: HTMLInputElement | null) => {
    if (elRef.current) elRef.current.removeEventListener('change', changeListenerRef.current)
    elRef.current = el
    if (el) el.addEventListener('change', changeListenerRef.current)
  }, [])

  // Sync external value changes into the (uncontrolled) input — skipped
  // mid-drag so it doesn't disturb the open OS color dialog.
  useEffect(() => {
    const el = elRef.current
    if (el && !draggingRef.current) el.value = value
  }, [value])

  return (
    <input
      ref={attach}
      type="color"
      className={className}
      title={title}
      defaultValue={value}
      onChange={(e) => {
        draggingRef.current = true
        throttledPreview(e.currentTarget.value)
      }}
    />
  )
}
