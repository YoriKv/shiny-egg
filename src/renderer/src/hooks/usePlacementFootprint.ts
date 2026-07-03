import { useEffect, useMemo, useRef, useState } from 'react'
import type { DecodedObjectInfluence, LevelData, LevelObject } from '../../../preload/api'
import { LEVEL_CELLS_H, LEVEL_CELLS_W } from '../canvas/geometry'

/** The armed object's identity + size — POSITION-INDEPENDENT, so it keys the
 *  decode without re-firing as the cursor moves. Ext objects are num=0 + exnum. */
type PlaceItem = { num: number; exnum?: number; w: number; h: number } | null

// Reference anchor for the one-shot decode. Offset a little into the level so an
// object that bleeds a cell up/left of its anchor isn't clipped at the grid edge,
// while still leaving ample room right/down for normal object sizes.
const REF_X = 16
const REF_Y = 16

/**
 * Decode-once-and-translate footprint for the Place tool's green-tile preview.
 *
 * The dragged-object tint (useObjectInfluence) re-decodes the WHOLE level per
 * cursor cell — fine for a bounded drag, too heavy for free placement hovering
 * (the main-side handler runs a full-level object decode every call). An object's
 * footprint — the cells it stamps RELATIVE to its anchor — is translation-
 * invariant for virtually every YI object, so we decode it ONCE per (level, item,
 * size): the object ALONE under this level's header at a fixed reference anchor.
 * We cache the anchor-relative cells and TRANSLATE them to the cursor cell
 * LOCALLY (zero IPC on move), dropping any that fall outside the level.
 *
 * Decoding the object alone (empty object list) rather than appended to the live
 * level is deliberate: a not-yet-placed object has nothing above it (so no
 * `buried` misclassification) and no cross-object context that would translate
 * stale, so the cached footprint stays valid at every cursor position. Approximate
 * only for the rare object whose stamp genuinely depends on surrounding tiles /
 * position — and the real drop clamps at the level edge regardless.
 *
 * Returns the translated `DecodedObjectInfluence` for the draw pass (drawn by the
 * same `drawObjectInfluence` path as the drag tint), or null when not placing an
 * object / the cursor is off-grid / the decode hasn't resolved yet.
 */
export function usePlacementFootprint(
  level: LevelData | null,
  item: PlaceItem,
  cell: { x: number; y: number } | null
): DecodedObjectInfluence | null {
  // Cached anchor-relative footprint, tagged with the `key` it was decoded for so
  // a stale (wrong item/size) result is never translated. Null until it resolves.
  const [footprint, setFootprint] = useState<{ key: string; cells: DecodedObjectInfluence['cells'] } | null>(
    null
  )

  // Position-independent decode key: refetch only on level / item / size change.
  const key = useMemo(() => {
    if (!level || level.empty || level.special || !item) return null
    return `${level.recordId}:${item.num}:${item.exnum ?? ''}:${item.w},${item.h}`
  }, [level, item])

  // Latest inputs read through refs so the effect keys purely on `key`.
  const levelRef = useRef(level)
  levelRef.current = level
  const itemRef = useRef(item)
  itemRef.current = item

  useEffect(() => {
    if (key === null) {
      setFootprint(null)
      return
    }
    const lvl = levelRef.current
    const it = itemRef.current
    if (!lvl || !it) {
      setFootprint(null)
      return
    }
    // The object ALONE under this level's header at the reference anchor. Its
    // returned absolute cells minus the anchor are the translation offsets.
    const synthetic: LevelObject = {
      uid: -1,
      index: 0,
      num: it.num,
      x: REF_X,
      y: REF_Y,
      w: it.w,
      h: it.h,
      raw: []
    }
    if (it.exnum !== undefined) synthetic.exnum = it.exnum
    if (synthetic.num === 0 && synthetic.exnum === undefined) synthetic.exnum = 0
    const override: LevelData = { ...lvl, objects: [synthetic] }
    let cancelled = false
    void window.shinyEgg.render
      .objectInfluence({ levelRecordId: lvl.recordId, override, targetIndices: [0] })
      .then((res) => {
        if (cancelled) return
        const cells = (res?.cells ?? []).map((c) => ({ ...c, x: c.x - REF_X, y: c.y - REF_Y }))
        setFootprint({ key, cells })
      })
      .catch(() => {
        if (!cancelled) setFootprint(null)
      })
    return () => {
      cancelled = true
    }
  }, [key])

  // Translate the cached offsets to the cursor cell — the per-move hot path, pure
  // renderer-local arithmetic (no IPC). Drops cells that fall off the level.
  return useMemo(() => {
    if (!item || !cell || !footprint || footprint.key !== key) return null
    const cells: DecodedObjectInfluence['cells'] = []
    for (const c of footprint.cells) {
      const x = c.x + cell.x
      const y = c.y + cell.y
      if (x >= 0 && x < LEVEL_CELLS_W && y >= 0 && y < LEVEL_CELLS_H) {
        cells.push({ ...c, x, y })
      }
    }
    return { cells }
  }, [footprint, cell, key, item])
}
