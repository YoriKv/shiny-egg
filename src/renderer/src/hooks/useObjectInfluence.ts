import { useEffect, useMemo, useRef, useState } from 'react'
import type { DecodedObjectInfluence, LevelData } from '../../../preload/api'

/** Live drag preview state, mirrored from Canvas. Object move = cell deltas;
 *  object resize = pending signed extents; group move = the multi-selection's
 *  uid sets + a shared cell delta. (Sprite moves are ignored — sprites have no
 *  decode footprint.) */
type MoveOverlay = { kind: 'object' | 'sprite'; uid: number; dx: number; dy: number } | null
type ResizeOverlay = { uid: number; w: number; h: number } | null
type GroupMove = { objUids: Set<number>; sprUids: Set<number>; dx: number; dy: number } | null

/**
 * Object-drag cell-highlight. While an OBJECT move/resize drag — or a
 * multi-select group move — is active, fetch the dragged object(s)' per-cell
 * provenance classification (footprint / neighbour / buried) for the *pending*
 * position and return the latest result for the draw pass. Returns `null` when
 * no object drag is active. (The Place tool's not-yet-placed footprint preview
 * uses a separate decode-once-and-translate path — see usePlacementFootprint.)
 *
 * Performance:
 *  - The fetch re-runs only when the drag's **integer cell** position/extent
 *    changes (a cell-quantized key) — at most ~cells-traversed decodes per drag,
 *    not one per frame. The 60fps outline box stays renderer-local in Canvas, so
 *    the drag never feels laggy even if the tint lags a frame.
 *  - A GROUP drag is ONE decode regardless of how many objects are selected: the
 *    engine records provenance for the whole target set in a single pass (see
 *    `object-decode/state.ts` `provenanceTargets`). So a multi-select drag costs
 *    exactly the same as a single drag.
 *  - The override `LevelData` is cloned inside the effect, so it allocates only
 *    on a real cell change, not every render.
 *  - Cancellable / keep-latest: a superseded response is dropped, so a slow
 *    decode never paints stale cells.
 *
 * Behaviour notes:
 *  - `targetIndices` MUST index the SAME array that gets serialized + decoded
 *    (`override.objects`). The override is a clone of `level.objects` in stream
 *    order, so `findIndex(uid)` is the decode stream index — never pass a uid to
 *    the decoder (it is index-based).
 *  - An empty result is expected, not a bug, when an object's Bank13/ext stamp
 *    handler isn't ported yet (decodes to nothing) or it's a command object (no
 *    tiles). The drag outline box still communicates its bounds.
 *  - The BG1 backing canvas is NOT re-rendered mid-drag (useLevelRenderLayers
 *    re-fetches a layer only on a reducer commit), so the tint sits over the
 *    pre-drag tiles until mouseup — intended: it shows where the object(s) *will*
 *    land. Stream order / resize / negative w/h all stay correct because every
 *    cell change re-decodes the live override.
 */
export function useObjectInfluence(
  level: LevelData | null,
  moveOverlay: MoveOverlay,
  resizeOverlay: ResizeOverlay,
  groupMove: GroupMove
): DecodedObjectInfluence | null {
  const [influence, setInfluence] = useState<DecodedObjectInfluence | null>(null)

  // Active object-drag descriptor + a key that changes only on cell movement.
  // Resize > single move > group move (the first two are mutually exclusive with
  // group in Canvas anyway). A group with no OBJECT members has no footprint.
  const drag = useMemo<{ kind: 'move' | 'resize' | 'group'; key: string } | null>(() => {
    if (!level || level.empty || level.special) return null
    if (resizeOverlay) {
      const { uid, w, h } = resizeOverlay
      return { kind: 'resize', key: `r:${uid}:${w},${h}` }
    }
    if (moveOverlay && moveOverlay.kind === 'object') {
      const { uid, dx, dy } = moveOverlay
      return { kind: 'move', key: `m:${uid}:${dx},${dy}` }
    }
    if (groupMove && groupMove.objUids.size > 0) {
      const ids = [...groupMove.objUids].sort((a, b) => a - b).join(',')
      return { kind: 'group', key: `g:${groupMove.dx},${groupMove.dy}:${ids}` }
    }
    return null
  }, [level, moveOverlay, resizeOverlay, groupMove])

  // Refs so the effect reads the latest inputs without keying on their identity
  // (it keys on `drag.key`, the cell-quantized signal).
  const levelRef = useRef(level)
  levelRef.current = level
  const moveRef = useRef(moveOverlay)
  moveRef.current = moveOverlay
  const resizeRef = useRef(resizeOverlay)
  resizeRef.current = resizeOverlay
  const groupRef = useRef(groupMove)
  groupRef.current = groupMove

  const dragKey = drag?.key ?? null
  const dragKind = drag?.kind ?? null

  useEffect(() => {
    if (dragKey === null || dragKind === null) {
      setInfluence(null)
      return
    }
    const lvl = levelRef.current
    if (!lvl) {
      setInfluence(null)
      return
    }

    // Build the override (target objects at their pending position/extent) + the
    // decode stream indices to record provenance for.
    let override: LevelData
    let targetIndices: number[]

    if (dragKind === 'group') {
      const g = groupRef.current
      if (!g || g.objUids.size === 0) {
        setInfluence(null)
        return
      }
      const objUids = g.objUids
      const objects = lvl.objects.map((o) =>
        o.uid != null && objUids.has(o.uid) ? { ...o, x: o.x + g.dx, y: o.y + g.dy } : o
      )
      targetIndices = []
      for (let i = 0; i < objects.length; i++) {
        const u = objects[i]!.uid
        if (u != null && objUids.has(u)) targetIndices.push(i)
      }
      if (targetIndices.length === 0) {
        setInfluence(null)
        return
      }
      override = { ...lvl, objects }
    } else {
      const uid = dragKind === 'resize' ? resizeRef.current?.uid : moveRef.current?.uid
      const targetIndex = lvl.objects.findIndex((o) => o.uid === uid)
      if (targetIndex < 0) {
        setInfluence(null)
        return
      }
      const base = lvl.objects[targetIndex]!
      const resize = resizeRef.current
      const move = moveRef.current
      const patched =
        dragKind === 'resize' && resize
          ? { ...base, w: resize.w, h: resize.h }
          : move && move.kind === 'object'
            ? { ...base, x: base.x + move.dx, y: base.y + move.dy }
            : base
      override = {
        ...lvl,
        objects: lvl.objects.map((o, i) => (i === targetIndex ? patched : o))
      }
      targetIndices = [targetIndex]
    }

    let cancelled = false
    void window.shinyEgg.render
      .objectInfluence({ levelRecordId: lvl.recordId, override, targetIndices })
      .then((res) => {
        if (!cancelled) setInfluence(res)
      })
      .catch(() => {
        if (!cancelled) setInfluence(null)
      })
    return () => {
      cancelled = true
    }
    // Keyed on the cell-quantized drag signal: refetch per cell, not per frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragKey])

  return influence
}
