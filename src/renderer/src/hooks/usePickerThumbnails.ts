import { useEffect, useMemo, useState } from 'react'
import type {
  EntityValidityCandidate,
  LevelData,
  PickerThumbnails,
  PickerThumbnailsRequest,
  RenderImage
} from '../../../preload/api'
import {
  listExtendedObjects,
  listSprites,
  listStandardObjects
} from '../data/obj-metadata'

/** Numeric-keyed lookup over one tab's thumbnails. Null until the first batch
 *  for the current (level, header, tab) resolves — rows render text-only. */
export interface PickerThumbnailLookup {
  /** Object rows: std num, or ext id with `ext: true`. Sprite rows: num. */
  objectThumb: (num: number, exnum?: number) => RenderImage | undefined
  spriteThumb: (num: number) => RenderImage | undefined
}

// Static request inputs, built once (the same catalog the validity hook sends).
let objectCandidates: EntityValidityCandidate[] | null = null
let spriteNums: number[] | null = null
function requestFor(tab: 'object' | 'sprite'): {
  candidates?: EntityValidityCandidate[]
  spriteNums?: number[]
} {
  if (tab === 'object') {
    objectCandidates ??= [
      ...listStandardObjects().map(({ id, info }) => ({
        kind: 'std' as const, id, w: info.defaultWidth, h: info.defaultHeight
      })),
      ...listExtendedObjects().map(({ id, info }) => ({
        kind: 'ext' as const, id, w: info.defaultWidth, h: info.defaultHeight
      }))
    ]
    return { candidates: objectCandidates }
  }
  spriteNums ??= listSprites().map(({ id }) => id)
  return { spriteNums }
}

/** The `render:pickerThumbnails` request for a (level, tab). Its candidate/
 *  sprite sets must match those the unified catalog warm sends (render-core's
 *  getEntityCatalog, fed by useEntityRenderValidity's candidates()/spriteCatalog())
 *  so this hook's fetch hits the cache that warm populated — both build the same
 *  obj-metadata catalog in the same order. Null for a level with no thumbnails
 *  (none loaded / empty / special). */
export function pickerThumbnailRequest(
  level: LevelData | null,
  tab: 'object' | 'sprite'
): PickerThumbnailsRequest | null {
  if (!level || level.empty || level.special) return null
  return { levelRecordId: level.recordId, override: level, ...requestFor(tab) }
}

// Renderer-side cache of resolved thumbnail batches that survives PickerBody
// unmount — the Place panel is DESTROYED on close (App renders only open
// windows), so without this every reopen re-fetched (multi-MB IPC payload) and
// re-blitted every canvas, even though the main-side cache still held the
// bitmaps. Keyed by level + header + tab + render epoch: bitmaps are rendered
// from the BASE ROM, so only a rebuild / gfx edit (which bump `renderRefresh`)
// or a header change alters them — a plain close/reopen on the same level is a
// hit and shows instantly. Small LRU (bitmaps are MBs).
const RENDERER_THUMB_CACHE_MAX = 6
const rendererThumbCache = new Map<string, PickerThumbnails>()
function rememberThumbs(key: string, data: PickerThumbnails): void {
  rendererThumbCache.delete(key)
  rendererThumbCache.set(key, data)
  while (rendererThumbCache.size > RENDERER_THUMB_CACHE_MAX) {
    const oldest = rendererThumbCache.keys().next().value
    if (oldest === undefined) break
    rendererThumbCache.delete(oldest)
  }
}

/**
 * Fetch the active tab's picker thumbnails. Same trigger discipline as
 * useEntityRenderValidity — refetches on level identity / header change only
 * (the bitmaps depend solely on the header; the level's own entities are
 * irrelevant), plus the tab and the render epoch (`renderRefresh`). Both the
 * main-side LRU and the renderer cache above mean tab flips, edit commits, and
 * panel reopens don't re-render or re-fetch anything.
 */
export function usePickerThumbnails(
  level: LevelData | null,
  tab: 'object' | 'sprite',
  renderRefresh: number
): PickerThumbnailLookup | null {
  const recordId = level && !level.empty && !level.special ? level.recordId : null
  const headerKey = level ? level.header.join(',') : ''
  const keyFor = (t: 'object' | 'sprite'): string | null =>
    recordId !== null ? `${recordId}:${headerKey}:${t}:${renderRefresh}` : null
  const cacheKey = keyFor(tab)
  // A bump counter that forces a re-read of the module cache once an async fetch
  // lands — the displayed data itself is read SYNCHRONOUSLY from the cache in the
  // memo below, so a switch to an already-cached tab shows in the same render
  // (no text-only flash), unlike routing it through a setState the effect runs
  // post-paint.
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (recordId === null || !level) return
    let cancelled = false
    // Fetch a tab's batch into the renderer cache if absent. The active tab is
    // ensured first; the OTHER tab is prefetched so the first switch is also a
    // synchronous hit (its bitmaps are already main-side warm from the catalog
    // pass, so this is a cheap payload transfer). The cache key pins everything
    // the bitmaps depend on (level/header/render epoch), so a present entry is
    // reused without an IPC round-trip.
    const ensure = (t: 'object' | 'sprite'): void => {
      const k = keyFor(t)
      if (k === null || rendererThumbCache.has(k)) return
      const req = pickerThumbnailRequest(level, t)
      if (!req) return
      void window.shinyEgg.render
        .pickerThumbnails(req)
        .then((data) => {
          if (cancelled || !data) return
          rememberThumbs(k, data)
          setVersion((v) => v + 1)
        })
        .catch(() => {})
    }
    ensure(tab)
    ensure(tab === 'object' ? 'sprite' : 'object')
    return () => {
      cancelled = true
    }
    // `level` deliberately not a dep — see useEntityRenderValidity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, headerKey, tab, renderRefresh])

  return useMemo(() => {
    const data = cacheKey !== null ? rendererThumbCache.get(cacheKey) : undefined
    if (!data) return null
    const objects = new Map<number, RenderImage>()
    for (const [k, v] of Object.entries(data.objects)) objects.set(parseInt(k, 16), v)
    const extended = new Map<number, RenderImage>()
    for (const [k, v] of Object.entries(data.extended)) extended.set(parseInt(k, 16), v)
    const sprites = new Map<number, RenderImage>()
    for (const [k, v] of Object.entries(data.sprites)) sprites.set(parseInt(k, 16), v)
    return {
      objectThumb: (num: number, exnum?: number) =>
        num === 0 && exnum !== undefined ? extended.get(exnum) : objects.get(num),
      spriteThumb: (num: number) => sprites.get(num)
    }
    // `version` re-reads the cache after an async fetch lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, version])
}
