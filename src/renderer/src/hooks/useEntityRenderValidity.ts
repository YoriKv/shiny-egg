import { useEffect, useMemo, useState } from 'react'
import type {
  EntityValidityCandidate,
  LevelData,
  ObjectRenderVerdict,
  EntityRenderValidity
} from '../../../preload/api'
import {
  getObjectInfo,
  getSprite,
  listExtendedObjects,
  listSprites,
  listStandardObjects
} from '../data/obj-metadata'
import {
  resolveSpriteValidity,
  type SpriteValidity
} from '../lib/sprite-render-validity'
import { objectThemeVerdict } from '../lib/theme-validity'
import { objectAnimVerdict } from '../lib/anim-validity'
import { effectiveBg1Tilesets } from 'snes-framework/bg1-regions'

/** Lookup view over one level's render-validity: object verdicts from the
 *  main-side probe, sprite verdicts computed locally (set inclusion over the
 *  level's spriteset files). */
export interface EntityValidityView {
  /** The record id this view's PROBE RESULT is for. During a level switch the
   *  probe (deferred to idle) lags the loaded level, so the view briefly carries
   *  the previous level's verdicts under the new tilesets — a consumer that must
   *  not act on stale verdicts (e.g. the validation panel) checks
   *  `view.levelRecordId === level.recordId` before using it. */
  levelRecordId: number
  /** PPU mode-7 arena (levelMode 0x09) — object verdicts not applicable
   *  (objectVerdict returns null for everything; don't gate). */
  mode7: boolean
  /** Verdict for a std object (`num`) or ext object (`num === 0` + `exnum`).
   *  Null when unprobed (mode-7, or an id outside the catalog). */
  objectVerdict: (num: number, exnum?: number) => ObjectRenderVerdict | null
  spriteValidity: (num: number) => SpriteValidity
}

// The probe candidate list — the whole picker catalog at metadata default
// sizes. Static across levels/sessions; built once.
let candidatesCache: EntityValidityCandidate[] | null = null
function candidates(): EntityValidityCandidate[] {
  candidatesCache ??= [
    ...listStandardObjects().map(({ id, info }) => ({
      kind: 'std' as const, id, w: info.defaultWidth, h: info.defaultHeight
    })),
    ...listExtendedObjects().map(({ id, info }) => ({
      kind: 'ext' as const, id, w: info.defaultWidth, h: info.defaultHeight
    }))
  ]
  return candidatesCache
}

// The full sprite catalog — sent alongside the object candidates so the unified
// catalog pass also warms the picker's sprite-tab thumbnails. Same list/order as
// usePickerThumbnails' sprite request, so they share the thumbnail cache key.
let spriteCatalogCache: number[] | null = null
function spriteCatalog(): number[] {
  spriteCatalogCache ??= listSprites().map(({ id }) => id)
  return spriteCatalogCache
}

/**
 * Fetch the level's render-validity verdicts. Refetches on level identity or
 * HEADER change only — not on every edit commit: the probe decodes each
 * candidate ALONE under the header, so the level's own objects/sprites never
 * affect the result (unlike useNeighborDependencies, which must track every
 * commit). Main caches per gfx-header tuple, so refetches after the first
 * touch per tileset are dictionary lookups.
 *
 * Returns null until the first result resolves (callers show no badges and
 * must not filter), and for empty/special levels.
 */
export function useEntityRenderValidity(level: LevelData | null): EntityValidityView | null {
  // `forRecordId` pins the result to the level it was probed for, so a consumer
  // can detect when the view still reflects the previous level (mid-switch).
  const [result, setResult] = useState<{ data: EntityRenderValidity; forRecordId: number } | null>(null)
  const recordId = level && !level.empty && !level.special ? level.recordId : null
  const headerKey = level ? level.header.join(',') : ''
  // The level's EFFECTIVE tilesets: header[1] plus every Graphic-Changer
  // band's target ($1BA-$1C9, even column ⇒ tileset swap). Pick-time has no
  // placement position, so theme-allowed under ANY band ⇒ offered (level
  // 0x58's rail corners live in its ts15 band). Tracks sprite edits — adding
  // /removing a changer recomputes without an IPC refetch.
  const effectiveTs = useMemo(
    () =>
      level
        ? [...effectiveBg1Tilesets(level.sprites, {
            bg1Tileset: level.header[1] ?? 0,
            bg1Palette: level.header[2] ?? 0
          })]
        : [],
    [level]
  )
  // The level's animation tileset (header[10]) — gates the header[10]-animated
  // objects whose tiles that animation draws (objectAnimVerdict).
  const animTileset = level?.header[10] ?? 0

  useEffect(() => {
    if (recordId === null || !level) {
      setResult(null)
      return
    }
    let cancelled = false
    // `level` is deliberately NOT a dep: a stale reference with the same
    // (recordId, headerKey) yields identical verdicts — only the header feeds
    // the probe (the override's entities are replaced by the synthetic
    // one-object levels main-side).
    //
    // Deferred to idle: this drives the unified picker-catalog pass main-side
    // (~500 object decodes for the verdicts, then thumbnail warming reusing
    // them), so keeping it off the level-load critical path avoids a load stall
    // — the gfx-missing markers it backs fill in a beat after load. `spriteNums`
    // lets that pass also warm the picker's sprite thumbnails. Cancelled on a
    // level/header change before it fires.
    const handle = window.requestIdleCallback(
      () => {
        void window.shinyEgg.render
          .entityRenderValidity({
            levelRecordId: recordId,
            override: level,
            candidates: candidates(),
            spriteNums: spriteCatalog()
          })
          .then((data) => {
            if (!cancelled) setResult(data ? { data, forRecordId: recordId } : null)
          })
          .catch(() => {
            if (!cancelled) setResult(null)
          })
      },
      { timeout: 2000 }
    )
    return () => {
      cancelled = true
      window.cancelIdleCallback(handle)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, headerKey])

  return useMemo(() => {
    if (!result) return null
    const { data } = result
    const objects = new Map<number, ObjectRenderVerdict>()
    for (const [k, v] of Object.entries(data.objects)) objects.set(parseInt(k, 16), v)
    const extended = new Map<number, ObjectRenderVerdict>()
    for (const [k, v] of Object.entries(data.extended)) extended.set(parseInt(k, 16), v)
    const levelFiles: ReadonlySet<number> = new Set(
      data.spritesetFiles.map((s) => parseInt(s, 16))
    )
    return {
      levelRecordId: result.forRecordId,
      mode7: data.mode7,
      objectVerdict: (num: number, exnum?: number) => {
        if (data.mode7) return null
        const probed =
          (num === 0 && exnum !== undefined ? extended.get(exnum) : objects.get(num)) ?? null
        // Theme gate on top of the probe: visible art that ISN'T this
        // tileset's family (slots holding another family's real art — no X,
        // no coverage miss) still renders garbage. no-visual stays exempt
        // (nothing rendered can't look wrong). Allowed under ANY effective
        // tileset (header + changer bands); theme-UNKNOWN (bg1Tilesets null —
        // never shipped, underivable) surfaces as the amber '?' verdict.
        if (probed === 'ok' || probed === 'degraded') {
          const info = getObjectInfo(num, exnum)
          const tv = objectThemeVerdict(info.bg1Tilesets, effectiveTs)
          if (tv === 'locked') return 'invalid'
          if (tv === 'unknown') return 'unknown'
          // Animation-tileset gate: the header[10]-animated objects ($35/$DC/…)
          // pass coverage under ANY animation but only render right under their
          // own — the coverage probe can't see the mismatch (anim-validity.ts).
          if (objectAnimVerdict(info.animTilesets, animTileset) === 'locked') return 'invalid'
        }
        return probed
      },
      spriteValidity: (num: number) =>
        resolveSpriteValidity(getSprite(num).spritesetFiles, levelFiles)
    }
  }, [result, effectiveTs, animTileset])
}
