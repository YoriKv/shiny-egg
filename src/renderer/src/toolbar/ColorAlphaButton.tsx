import { useEffect, useRef, useState, type JSX } from 'react'
import { formatRgba, parseRgba, rgbToHex, type Rgba } from '../lib/rgba'
import { LiveColorInput } from '../LiveColorInput'
import { useThrottledCallback } from '../lib/throttle'

// A compact color-picker control with opacity, for the toolbar. The native
// `<input type="color">` can't pick alpha (its `alpha` attribute isn't in
// Electron's Chromium yet), so the swatch opens a small popover holding the
// native RGB picker AND an opacity slider together — one "color picker" that
// includes both RGB and alpha. The preview swatch shows the solid RGB color
// only (no opacity). Value is an `rgba()` string in / out.
//
// Drag contract (the editor-wide live-preview pattern): while the RGB dialog or
// the alpha slider drags, the in-flight color lives in LOCAL `draft` state (so
// the popover stays 60 fps) and reaches the app through a THROTTLED `onPreview`
// only; `onCommit` fires once on release (native `change` / pointer-up) — the
// point where the caller persists. A drag can't spam per-frame App re-renders
// or settings writes.

const PREVIEW_THROTTLE_MS = 150

export function ColorAlphaButton({
  value,
  onPreview,
  onCommit,
  label,
  title
}: {
  /** Committed `rgba()` value. */
  value: string
  /** Live, throttled — show the in-progress color without committing. */
  onPreview: (value: string) => void
  /** Release — commit + persist the final color. */
  onCommit: (value: string) => void
  /** Tiny caption above the swatch (e.g. "Grid"). */
  label: string
  title: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  // In-flight edit (mid-drag), overriding `value` for display; null when idle.
  const [draft, setDraft] = useState<Rgba | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const c = draft ?? parseRgba(value)
  const pct = Math.round(c.a * 100)

  const throttledPreview = useThrottledCallback<string>((v) => onPreview(v), PREVIEW_THROTTLE_MS)

  const commit = (next: Rgba): void => {
    setDraft(null)
    onCommit(formatRgba(next))
  }

  // Close on click-outside / Esc while open.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Closing the popover flushes a lingering draft (e.g. an OS-dialog cancel,
  // which fires no `change`) so preview and committed state can't stay split.
  useEffect(() => {
    if (!open && draft) commit(draft)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- flush only on close

  return (
    <div className="se-colorpick" ref={rootRef}>
      <span className="se-toolbar__swatch-label">{label}</span>
      <button
        type="button"
        className="se-colorpick__swatch"
        title={title}
        style={{ background: rgbToHex(c) }}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="se-colorpick__pop">
          <label className="se-colorpick__row">
            <span className="se-colorpick__row-label">RGB</span>
            <LiveColorInput
              value={rgbToHex(c)}
              onPreview={(hex) => {
                const next = { ...parseRgba(hex), a: c.a }
                setDraft(next)
                onPreview(formatRgba(next)) // already throttled by LiveColorInput
              }}
              onCommit={(hex) => commit({ ...parseRgba(hex), a: c.a })}
            />
          </label>
          <label className="se-colorpick__row">
            <span className="se-colorpick__row-label">Alpha</span>
            <input
              type="range"
              className="se-colorpick__alpha"
              min={0}
              max={100}
              value={pct}
              onChange={(e) => {
                const next = { r: c.r, g: c.g, b: c.b, a: Number(e.target.value) / 100 }
                setDraft(next)
                throttledPreview(formatRgba(next))
              }}
              onPointerUp={(e) =>
                commit({ r: c.r, g: c.g, b: c.b, a: Number(e.currentTarget.value) / 100 })
              }
              onKeyUp={(e) =>
                commit({ r: c.r, g: c.g, b: c.b, a: Number(e.currentTarget.value) / 100 })
              }
            />
            <span className="se-colorpick__pct">{pct}%</span>
          </label>
        </div>
      )}
    </div>
  )
}
