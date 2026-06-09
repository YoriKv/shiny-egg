// Shared warp-exit graph traversal. YI levels connect via screen-exit "warp"
// records (pipe / door / water), and two editor features walk that graph:
//
//   • Sub-room discovery + incoming markers (hooks/useSubLevelBFS) — every
//     non-catalog level reachable from a translevel root, plus the reverse
//     adjacency ("who warps into here").
//   • Test Level's sub-room boot (App.onTestLevel) — the shortest chain of warp
//     records from the root to a chosen sub-room, replayed by the Lua harness.
//
// Both used to inline their own BFS over `loadResource(...).exits`; they now
// share `walkWarpGraph` below so the edge shape, the de-dup, and the traversal
// order live in one place (and can't drift apart). Each consumer keeps only its
// own concern: discovery prunes at catalog boundaries and records incoming;
// chain-find expands everything and stops at a target.

import type { ScreenExit } from '../../../preload/api'

/** One hop the cart can replay: land in `destLevelRecordId` at (`destX`,`destY`) with
 *  the given entrance/spawn state. The 4 fields the Lua harness needs per warp. */
export interface WarpStep {
  destLevelRecordId: number
  destX: number
  destY: number
  entranceType: number
}

/** A warp edge in the graph: a `WarpStep` plus where it came FROM (the source
 *  level + its screen index), which the incoming-marker reverse map needs. */
export interface WarpEdge extends WarpStep {
  sourceLevelRecordId: number
  sourceScreenIndex: number
}

/** Load one level's warp exits as graph edges (skips minibattle exits). The
 *  default edge source for the walker; injectable so tests / callers can supply
 *  their own loader. */
export async function loadWarpEdges(id: number): Promise<WarpEdge[]> {
  const data = await window.shinyEgg.editor.loadResource({ kind: 'level', recordId: id })
  const edges: WarpEdge[] = []
  for (const ex of data.exits as ScreenExit[]) {
    if (ex.variant !== 'warp') continue
    edges.push({
      sourceLevelRecordId: id,
      sourceScreenIndex: ex.screenIndex,
      destLevelRecordId: ex.destLevelRecordId,
      destX: ex.destX,
      destY: ex.destY,
      entranceType: ex.entranceType
    })
  }
  return edges
}

/** One yielded step of the walk: a warp `edge`, the `chain` of `WarpStep`s from
 *  the root to this edge's destination, and `expanded` — true iff this is the
 *  first time the destination is seen AND the caller's `shouldExpand` allowed
 *  traversing into it (i.e. the destination is a newly-discovered, expandable
 *  node). Edges to already-seen or non-expandable destinations are still
 *  yielded (so incoming markers cover every connection) but with
 *  `expanded === false`. */
export interface WarpVisit {
  edge: WarpEdge
  chain: WarpStep[]
  expanded: boolean
}

export interface WalkWarpOptions {
  /** Whether to traverse INTO a destination once first seen. Discovery prunes
   *  catalog entries (`(id) => !getLevel(id)`); chain-find expands everything
   *  (the default). */
  shouldExpand?: (destLevelRecordId: number) => boolean
  /** Cap the chain length to avoid runaway loops in pathological graphs. */
  maxDepth?: number
  /** Edge source — defaults to `loadWarpEdges`. Injectable for tests. A loader
   *  that throws for an id (empty / special slot) drops that node silently. */
  loadEdges?: (id: number) => Promise<WarpEdge[]>
}

/**
 * Breadth-first walk of the warp graph from `root`. Yields every warp edge in
 * BFS order (nearest-first), each carrying the chain from `root` to its
 * destination. Each destination is loaded/expanded at most once. Because it's
 * an async generator, consumers can stream partial results (discovery updates
 * the UI as it goes), break early (chain-find stops at its target — the first
 * matching yield is the shortest chain), and cancel (break out of `for await`).
 */
export async function* walkWarpGraph(
  root: number,
  opts: WalkWarpOptions = {}
): AsyncGenerator<WarpVisit> {
  const shouldExpand = opts.shouldExpand ?? (() => true)
  const maxDepth = opts.maxDepth ?? Infinity
  const loadEdges = opts.loadEdges ?? loadWarpEdges
  const visited = new Set<number>([root])
  const queue: { id: number; chain: WarpStep[] }[] = [{ id: root, chain: [] }]
  while (queue.length > 0) {
    const { id, chain } = queue.shift()!
    if (chain.length >= maxDepth) continue
    let edges: WarpEdge[]
    try {
      edges = await loadEdges(id)
    } catch {
      // Unloadable id (empty slot / special-cased level) — skip; the walk
      // continues with whatever else is queued.
      continue
    }
    for (const edge of edges) {
      const next: WarpStep[] = [
        ...chain,
        {
          destLevelRecordId: edge.destLevelRecordId,
          destX: edge.destX,
          destY: edge.destY,
          entranceType: edge.entranceType
        }
      ]
      const firstSeen = !visited.has(edge.destLevelRecordId)
      const expanded = firstSeen && shouldExpand(edge.destLevelRecordId)
      yield { edge, chain: next, expanded }
      if (firstSeen) {
        visited.add(edge.destLevelRecordId)
        if (expanded) queue.push({ id: edge.destLevelRecordId, chain: next })
      }
    }
  }
}

/**
 * Shortest chain of warp steps from `root` to `target`, or `null` if `target`
 * isn't reachable within `maxDepth` hops. BFS order means the first edge that
 * lands on `target` is the shortest path. Used by Test Level to boot the parent
 * then replay each hop into a sub-room.
 */
export async function findWarpChain(
  root: number,
  target: number,
  opts: { maxDepth?: number; loadEdges?: (id: number) => Promise<WarpEdge[]> } = {}
): Promise<WarpStep[] | null> {
  for await (const { edge, chain } of walkWarpGraph(root, {
    maxDepth: opts.maxDepth ?? 16,
    loadEdges: opts.loadEdges
  })) {
    if (edge.destLevelRecordId === target) return chain
  }
  return null
}

/**
 * Reverse parent lookup: of the catalog translevel `roots`, return the first
 * whose forward warp graph reaches `target` under the same catalog-pruning
 * `shouldExpand` as sub-room discovery — i.e. the translevel whose SubLevelMenu
 * lists `target`. Returns null if none own it (a true orphan), and `target`
 * itself if it's one of the roots.
 *
 * Multi-source BFS: all roots are seeded into one queue sharing a `visited` set,
 * so each record is loaded at most once and attributed to the shallowest root
 * that reaches it — the cost is one walk of the union sub-room graph, not one
 * walk per root. Used to re-anchor when the user opens a sub-room directly (the
 * room itself is a degenerate discovery anchor; its owning translevel is the
 * useful "level to look at").
 */
export async function findOwningTranslevel(
  target: number,
  roots: number[],
  opts: WalkWarpOptions = {}
): Promise<number | null> {
  if (roots.includes(target)) return target
  const shouldExpand = opts.shouldExpand ?? (() => true)
  const maxDepth = opts.maxDepth ?? Infinity
  const loadEdges = opts.loadEdges ?? loadWarpEdges
  const visited = new Set<number>(roots)
  const queue: { id: number; source: number; depth: number }[] = roots.map((r) => ({
    id: r,
    source: r,
    depth: 0
  }))
  while (queue.length > 0) {
    const { id, source, depth } = queue.shift()!
    if (depth >= maxDepth) continue
    let edges: WarpEdge[]
    try {
      edges = await loadEdges(id)
    } catch {
      continue
    }
    for (const edge of edges) {
      const dst = edge.destLevelRecordId
      if (dst === target) return source
      if (!visited.has(dst)) {
        visited.add(dst)
        if (shouldExpand(dst)) queue.push({ id: dst, source, depth: depth + 1 })
      }
    }
  }
  return null
}
