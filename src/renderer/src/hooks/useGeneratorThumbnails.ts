import { useEffect, useState } from 'react'
import type { LevelData, RenderImage } from '../../../preload/api'
import { GENERATED_ENEMY_NUMS } from '../data/generator-spawns'

/**
 * Enemy thumbnails for the canvas generator badges (canvas/draw/generator-badges).
 * Requests the FIXED set of generator-spawned enemy sprites (GENERATED_ENEMY_NUMS)
 * through the same render.pickerThumbnails IPC the Place-Sprites panel uses — so
 * the bitmaps are MAIN-SIDE CACHED (the same LRU keyed by gfx-header + request
 * signature; this gets its own entry, since the 13-enemy request set differs from
 * the picker's full sprite list). Because the request set is constant, its cache
 * key depends only on the level header; same trigger as usePickerThumbnails (on
 * level identity / header change only, NOT per edit commit). Returns a num→bitmap
 * map, null until the first batch resolves.
 */
export function useGeneratorThumbnails(level: LevelData | null): Map<number, RenderImage> | null {
  const [thumbs, setThumbs] = useState<Map<number, RenderImage> | null>(null)
  const recordId = level && !level.empty && !level.special ? level.recordId : null
  const headerKey = level ? level.header.join(',') : ''

  useEffect(() => {
    if (recordId === null || !level) {
      setThumbs(null)
      return
    }
    let cancelled = false
    // `level` deliberately not a dep — the bitmaps depend only on the header.
    void window.shinyEgg.render
      .pickerThumbnails({ levelRecordId: recordId, override: level, spriteNums: [...GENERATED_ENEMY_NUMS] })
      .then((data) => {
        if (cancelled) return
        if (!data) {
          setThumbs(null)
          return
        }
        const map = new Map<number, RenderImage>()
        for (const [k, v] of Object.entries(data.sprites)) map.set(parseInt(k, 16), v)
        setThumbs(map)
      })
      .catch(() => {
        if (!cancelled) setThumbs(null)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, headerKey])

  return thumbs
}
