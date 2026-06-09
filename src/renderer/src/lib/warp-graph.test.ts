// Tests the shared warp-graph traversal (walkWarpGraph / findWarpChain /
// findOwningTranslevel) that backs sub-room discovery, "Go to room" anchoring,
// and Test Level's sub-room boot. The walker takes an INJECTABLE `loadEdges`,
// so we drive it with synthetic in-memory graphs — no ROM, no IPC.
//
// Run via Vitest (renderer config): `pnpm run test:renderer`.

import { describe, test, expect } from 'vitest'
import { walkWarpGraph, findWarpChain, findOwningTranslevel, type WarpEdge } from './warp-graph'

/**
 * Build an injectable loader from an adjacency map. `adj[id]` is the list of
 * (destination, screenIndex?) hops out of level `id`. An id ABSENT from the map
 * is "unloadable" (empty / special slot) → the loader throws, exercising the
 * walker's skip-on-throw path. An id present with `[]` is a reachable dead-end.
 */
function loaderFrom(
  adj: Record<number, Array<[dest: number, screen?: number]>>
): (id: number) => Promise<WarpEdge[]> {
  return async (id: number) => {
    const hops = adj[id]
    if (hops === undefined) throw new Error(`level ${id} not loadable`)
    return hops.map(([dest, screen = 0]) => ({
      sourceLevelRecordId: id,
      sourceScreenIndex: screen,
      destLevelRecordId: dest,
      destX: 0,
      destY: 0,
      entranceType: 0
    }))
  }
}

async function collect(
  root: number,
  opts: Parameters<typeof walkWarpGraph>[1]
): Promise<Array<{ dest: number; depth: number; expanded: boolean }>> {
  const out: Array<{ dest: number; depth: number; expanded: boolean }> = []
  for await (const v of walkWarpGraph(root, opts)) {
    out.push({ dest: v.edge.destLevelRecordId, depth: v.chain.length, expanded: v.expanded })
  }
  return out
}

describe('findWarpChain', () => {
  test('returns the shortest chain when multiple paths exist', async () => {
    // 0→1→3 (2 hops) AND 0→2→4→3 (3 hops). BFS must return the 2-hop.
    const load = loaderFrom({ 0: [[1], [2]], 1: [[3]], 2: [[4]], 4: [[3]], 3: [] })
    const chain = await findWarpChain(0, 3, { loadEdges: load })
    expect(chain?.length).toBe(2)
    expect(chain?.[0]?.destLevelRecordId).toBe(1)
    expect(chain?.[1]?.destLevelRecordId).toBe(3)
  })

  test('returns null when the target is unreachable', async () => {
    const load = loaderFrom({ 0: [[1]], 1: [], 9: [[0]] })
    expect(await findWarpChain(0, 9, { loadEdges: load })).toBeNull()
  })

  test('respects maxDepth', async () => {
    const load = loaderFrom({ 0: [[1]], 1: [[2]], 2: [[3]], 3: [] }) // 3 is 3 hops away
    expect(await findWarpChain(0, 3, { loadEdges: load, maxDepth: 2 })).toBeNull()
    expect((await findWarpChain(0, 3, { loadEdges: load, maxDepth: 3 }))?.length).toBe(3)
  })
})

describe('walkWarpGraph', () => {
  test('terminates on cycles and expands each destination at most once', async () => {
    const load = loaderFrom({ 0: [[1]], 1: [[2], [0]], 2: [[0]] }) // 0→1→2→0 cycle + 1→0
    const visits = await collect(0, { loadEdges: load })
    expect(visits.length).toBe(4) // 0→1, 1→2, 1→0, 2→0 — and it terminates
    expect(visits.filter((v) => v.expanded).map((v) => v.dest).sort()).toEqual([1, 2])
    expect(visits.filter((v) => v.dest === 0).every((v) => !v.expanded)).toBe(true)
  })

  test('yields edges in BFS (nearest-first) order', async () => {
    const load = loaderFrom({ 0: [[1], [2]], 1: [[3]], 2: [[4]], 3: [], 4: [] })
    expect((await collect(0, { loadEdges: load })).map((v) => v.depth)).toEqual([1, 1, 2, 2])
  })

  test('shouldExpand prunes traversal at a boundary node', async () => {
    // 0→1→2, but 1 is a "catalog" node we don't expand → 2 is never reached.
    const load = loaderFrom({ 0: [[1]], 1: [[2]], 2: [] })
    const visits = await collect(0, { loadEdges: load, shouldExpand: (id) => id !== 1 })
    expect(visits.map((v) => v.dest)).toEqual([1])
    expect(visits[0]?.expanded).toBe(false) // yielded, but not traversed into
  })

  test('skips an unloadable node and continues the walk', async () => {
    // 7 is absent from the map → loader throws; the walk must still reach 2.
    const load = loaderFrom({ 0: [[7], [1]], 1: [[2]], 2: [] })
    expect((await collect(0, { loadEdges: load })).map((v) => v.dest)).toContain(2)
  })
})

describe('findOwningTranslevel', () => {
  test('a root owns itself', async () => {
    const load = loaderFrom({ 10: [], 20: [] })
    expect(await findOwningTranslevel(10, [10, 20], { loadEdges: load })).toBe(10)
  })

  test('attributes the target to the root whose graph reaches it', async () => {
    const load = loaderFrom({ 10: [[11]], 11: [], 20: [[30]], 30: [[99]], 99: [] })
    expect(await findOwningTranslevel(99, [10, 20], { loadEdges: load })).toBe(20)
  })

  test('returns null for a true orphan', async () => {
    const load = loaderFrom({ 10: [[11]], 11: [], 20: [], 99: [] })
    expect(await findOwningTranslevel(99, [10, 20], { loadEdges: load })).toBeNull()
  })

  test('shouldExpand blocks attribution through a pruned intermediate', async () => {
    // 10→50→99 but 50 (a catalog level) is pruned → 99 is not owned by 10.
    const load = loaderFrom({ 10: [[50]], 50: [[99]], 99: [] })
    expect(await findOwningTranslevel(99, [10], { loadEdges: load, shouldExpand: (id) => id !== 50 })).toBeNull()
  })
})
