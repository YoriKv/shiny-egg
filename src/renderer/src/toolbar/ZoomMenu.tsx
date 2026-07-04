import type { JSX } from 'react'
import { useDropdown } from '../hooks/useDropdown'
import { useCanvasZoom } from '../canvas/zoom-store'
import { ZOOM_PRESETS } from '../canvas/view'

// The toolbar zoom dropdown: the trigger shows the LIVE canvas zoom (so
// wheel-zooming to 137% reads "137%", overriding whatever preset was last
// picked), and the popover lists the preset stops. Picking one zooms the
// canvas about its viewport centre (App relays it via Canvas's zoomRequest).
// Shift+wheel on the canvas steps through the same presets.

export function ZoomMenu({ onZoomTo }: { onZoomTo: (zoom: number) => void }): JSX.Element {
  const { open, setOpen, containerRef } = useDropdown()
  const pct = Math.round(useCanvasZoom() * 100)

  return (
    <div className="se-zoommenu" ref={containerRef}>
      <span className="se-toolbar__swatch-label">Zoom</span>
      <button
        type="button"
        className={`se-zoommenu__trigger${open ? ' is-open' : ''}`}
        title="Canvas zoom — pick a preset, or Shift+scroll the canvas to step through them"
        onClick={() => setOpen((o) => !o)}
      >
        {pct}%
      </button>
      {open && (
        <div className="se-zoommenu__pop">
          {ZOOM_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`se-zoommenu__row${Math.round(p * 100) === pct ? ' is-active' : ''}`}
              onClick={() => {
                onZoomTo(p)
                setOpen(false)
              }}
            >
              {Math.round(p * 100)}%
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
