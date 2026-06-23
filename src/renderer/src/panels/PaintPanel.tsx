// The Paint floating window. Painting itself happens on the canvas while the
// Paint tool is active (drag = set cell-corner heights, Shift-drag = erase); this
// panel owns the fit parameters: which tileset's object palette the surface
// fitter uses, how deep the fill goes under the painted surface, and a Clear
// for the current curve. The fit re-runs on every paint gesture (App.onPaintStroke).

import { useEffect, useState, type JSX } from 'react'
import type { FitTileset } from '../../../preload/api'

export function PaintBody({
  tileset,
  onTileset,
  fillDepth,
  onFillDepth,
  pointCount,
  onClear,
  levelTileset
}: {
  /** Selected paint tileset (the fitter's object palette). Null until resolved. */
  tileset: number | null
  onTileset: (t: number) => void
  /** Rows of solid the fitted objects fill below the painted surface. */
  fillDepth: number
  onFillDepth: (n: number) => void
  /** How many cell-corner heights are currently painted. */
  pointCount: number
  onClear: () => void
  /** The loaded level's own BG1 tileset — shown so the user can keep paint in theme. */
  levelTileset: number | null
}): JSX.Element {
  const [tilesets, setTilesets] = useState<FitTileset[]>([])
  useEffect(() => {
    let live = true
    void window.shinyEgg.render
      .fitTilesets()
      .then((t) => { if (live) setTilesets(t) })
      .catch(() => { if (live) setTilesets([]) })
    return () => { live = false }
  }, [])

  const matchesLevel = tileset != null && tileset === levelTileset
  return (
    <div className="se-paint">
      <p className="se-paint__hint">
        Drag on the canvas to paint surface heights at cell corners. Shift-drag to
        erase. The curve is fitted to standard objects on each release.
      </p>

      <label className="se-paint__row">
        <span>Tileset</span>
        <select
          className="se-input se-props__select"
          value={tileset ?? ''}
          onChange={(e) => onTileset(parseInt(e.target.value, 10))}
        >
          {tileset != null && !tilesets.some((t) => t.tileset === tileset) && (
            <option value={tileset}>{`ts${tileset} (raw)`}</option>
          )}
          {tilesets.map((t) => (
            <option key={t.tileset} value={t.tileset}>
              {`ts${t.tileset} · ${t.name}`}
            </option>
          ))}
        </select>
      </label>
      {!matchesLevel && levelTileset != null && (
        <p className="se-paint__warn">
          Level tileset is ts{levelTileset} — painted objects render best when the
          paint tileset matches it.
        </p>
      )}

      <label className="se-paint__row">
        <span>Fill depth</span>
        <input
          className="se-input se-props__num"
          type="number"
          min={1}
          max={64}
          value={fillDepth}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10)
            if (!Number.isNaN(v)) onFillDepth(Math.max(1, Math.min(64, v)))
          }}
        />
      </label>

      <div className="se-paint__foot">
        <span className="se-paint__count">{pointCount} point{pointCount === 1 ? '' : 's'}</span>
        <button className="se-btn" disabled={pointCount === 0} onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  )
}
