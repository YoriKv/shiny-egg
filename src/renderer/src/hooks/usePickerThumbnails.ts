import { useEffect, useMemo, useState } from 'react'
import type {
  EntityValidityCandidate,
  LevelData,
  PickerThumbnails,
  RenderImage
} from '../../../preload/api'
import {
  celRenderableSpriteNums,
  formatARenderableSpriteNums,
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
  celRenderableNums?: number[]
  formatANums?: number[]
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
  return {
    spriteNums,
    celRenderableNums: celRenderableSpriteNums(),
    formatANums: formatARenderableSpriteNums()
  }
}

/**
 * Fetch the active tab's picker thumbnails. Same trigger discipline as
 * useEntityRenderValidity — refetches on level identity / header change only
 * (the bitmaps depend solely on the header; the level's own entities are
 * irrelevant), plus the tab. Main caches per gfx-header tuple, so tab flips
 * and edit commits don't re-render anything.
 */
export function usePickerThumbnails(
  level: LevelData | null,
  tab: 'object' | 'sprite'
): PickerThumbnailLookup | null {
  const [result, setResult] = useState<{ tab: string; data: PickerThumbnails } | null>(null)
  const recordId = level && !level.empty && !level.special ? level.recordId : null
  const headerKey = level ? level.header.join(',') : ''

  useEffect(() => {
    if (recordId === null || !level) {
      setResult(null)
      return
    }
    let cancelled = false
    // `level` deliberately not a dep — see useEntityRenderValidity.
    void window.shinyEgg.render
      .pickerThumbnails({ levelRecordId: recordId, override: level, ...requestFor(tab) })
      .then((data) => {
        if (!cancelled) setResult(data ? { tab, data } : null)
      })
      .catch(() => {
        if (!cancelled) setResult(null)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, headerKey, tab])

  return useMemo(() => {
    if (!result || result.tab !== tab) return null
    const { data } = result
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
  }, [result, tab])
}
