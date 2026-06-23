import { useEffect, useRef, useState, type JSX } from 'react'
import { formatRgba, parseRgba, rgbToHex } from '../lib/rgba'

// A compact colour-picker control with opacity, for the toolbar. The native
// `<input type="color">` can't pick alpha (its `alpha` attribute isn't in
// Electron's Chromium yet), so the swatch opens a small popover holding the
// native RGB picker AND an opacity slider together — one "colour picker" that
// includes both RGB and alpha. The preview swatch shows the solid RGB colour
// only (no opacity). Value is an `rgba()` string in / out.

export function ColorAlphaButton({
  value,
  onChange,
  label,
  title
}: {
  value: string
  onChange: (value: string) => void
  /** Tiny caption above the swatch (e.g. "Grid"). */
  label: string
  title: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const c = parseRgba(value)
  const pct = Math.round(c.a * 100)

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
            <input
              type="color"
              value={rgbToHex(c)}
              onChange={(e) => onChange(formatRgba({ ...parseRgba(e.target.value), a: c.a }))}
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
              onChange={(e) =>
                onChange(formatRgba({ r: c.r, g: c.g, b: c.b, a: Number(e.target.value) / 100 }))
              }
            />
            <span className="se-colorpick__pct">{pct}%</span>
          </label>
        </div>
      )}
    </div>
  )
}
