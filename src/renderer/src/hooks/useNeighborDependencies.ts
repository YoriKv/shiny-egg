import { useEffect, useState } from 'react'
import type { LevelData } from '../../../preload/api'
import { getCollisionTable } from '../data/collision-info'
import { getSpriteNeighborDeps } from '../data/obj-metadata'
import {
  resolveDep,
  type DepResult,
  type NeighborContext,
  type PlacedSprite
} from '../lib/sprite-neighbor-deps'

/** Per-sprite dependency results, keyed by the sprite's editor uid. Only sprites
 *  that actually have neighbour-dependencies appear. */
export type NeighborStatusMap = Map<number, DepResult[]>

// Class-F (pipe-spawner) deps match a cell's page collision secondary-tag, so
// the resolver needs page→tag; all other classes resolve without it. Derived
// from the shared cached table fetch (data/collision-info.ts).
function getCollisionTagOfPage(): Promise<(page: number) => number | undefined> {
  return getCollisionTable().then((table) => (page: number) => table[page]?.tag)
}

// Sprite nums placed anywhere in the warp-reachable level group: forward BFS
// over screen-exit warps from the current record (live `level` for the edited
// record; saved data for connected rooms via loadResource). Feeds the
// `carried` deps' fallback — a locked door's Key usually lives in a connected
// sub-room. Depth-capped like the sub-level discovery BFS.
async function carriedGroupNums(level: LevelData, maxDepth = 8): Promise<Set<number>> {
  const nums = new Set<number>(level.sprites.map((s) => s.num))
  const visited = new Set<number>([level.recordId])
  let frontier = level.exits
    .filter((e) => e.variant === 'warp')
    .map((e) => (e as { destLevelRecordId: number }).destLevelRecordId)
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: number[] = []
    for (const id of frontier) {
      if (visited.has(id)) continue
      visited.add(id)
      try {
        const data = await window.shinyEgg.editor.loadResource({ kind: 'level', recordId: id })
        for (const s of data.sprites) nums.add(s.num)
        for (const e of data.exits) {
          if (e.variant === 'warp') next.push(e.destLevelRecordId)
        }
      } catch {
        // unloadable slot (empty / special) — skip
      }
    }
    frontier = next
  }
  return nums
}

// Map16 cell reader over a decoded layout. The indexing mirrors
// snes-framework/scripts/engine/cell-grid.ts `resolveCellGrid` — the exact
// resolution the validation harness checks — so the editor flags cell-for-cell
// what `validate-neighbor-deps` pins. Unallocated / page-0 cells read as 0
// ("renders nothing"); out-of-range reads as undefined.
function makeMap16At(buf: Uint8Array, pageMap: Uint8Array): (cx: number, cy: number) => number | undefined {
  return (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= 256 || cy >= 128) return undefined
    const slot = pageMap[((cy >> 4) << 4) | (cx >> 4)]
    if (slot === undefined || slot === 0x80) return 0
    const page = slot & 0x3f
    if (page === 0) return 0
    const off = page * 512 + ((cy & 0x0f) << 5) + (cx & 0x0f) * 2
    return buf[off]! | (buf[off + 1]! << 8)
  }
}

/**
 * Resolve every placed sprite's neighbour-dependencies against the live level.
 * Refetches the decoded Map16 layout per level AND per edit-commit (the `level`
 * reference changes on each reducer commit, and `override: level` makes the
 * decode reflect unsaved edits), so tile-based deps (rail / slime) track edits
 * while sprite/exit deps read the live `level`. Shares the resolver with the
 * validation harness, so the editor flags exactly what the harness pins.
 *
 * `enabled` gates the IPC (the visuals ride the Sprite-Editing layer, so there's
 * nothing to compute when it's off). Returns null until the first layout
 * resolves; an empty map when no placed sprite has a dependency.
 */
export function useNeighborDependencies(
  level: LevelData | null,
  enabled: boolean
): NeighborStatusMap | null {
  const [status, setStatus] = useState<NeighborStatusMap | null>(null)
  useEffect(() => {
    if (!enabled || !level || level.empty || level.special) {
      setStatus(null)
      return
    }
    const relevant = level.sprites.filter(
      (s) => s.uid !== undefined && getSpriteNeighborDeps(s.num).length > 0
    )
    if (relevant.length === 0) {
      setStatus(new Map())
      return
    }
    let cancelled = false
    const needsGroup = relevant.some((s) =>
      getSpriteNeighborDeps(s.num).some((d) => d.spatial === 'carried')
    )
    void Promise.all([
      window.shinyEgg.render.decodeLevelLayout({ levelRecordId: level.recordId, override: level }),
      getCollisionTagOfPage(),
      needsGroup ? carriedGroupNums(level) : Promise.resolve(undefined)
    ])
      .then(([layout, collisionTagOfPage, groupNums]) => {
        if (cancelled) return
        if (!layout) {
          setStatus(new Map())
          return
        }
        const exitScreens = new Set(level.exits.map((e) => e.screenIndex))
        const ctx: NeighborContext = {
          sprites: level.sprites.map((s) => ({ num: s.num, x: s.x, y: s.y })),
          map16At: makeMap16At(layout.levelDataBuffer, layout.screenPageMap),
          hasExitForScreen: (sc) => exitScreens.has(sc),
          collisionTagOfPage,
          carriedGroupNums: groupNums
        }
        const map: NeighborStatusMap = new Map()
        for (const s of relevant) {
          const sprite: PlacedSprite = { num: s.num, x: s.x, y: s.y }
          map.set(
            s.uid!,
            getSpriteNeighborDeps(s.num).map((dep) => resolveDep(sprite, dep, ctx))
          )
        }
        setStatus(map)
      })
      .catch(() => {
        if (!cancelled) setStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [level, enabled])
  return status
}
