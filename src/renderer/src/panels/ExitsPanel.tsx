// The Exits panel (§B2): the warp network as a combined map — one half-size
// 16×8 screen grid PER level in the root's BFS cluster, laid out in BFS-depth
// columns (each grid vertically centred on the exits that feed it), with a
// connection line from every warp exit cell to its landing screen on the
// destination grid.
//
//  • Exit cells: filled (blue = warp, violet = minibattle — minibattles enter a
//    minigame, not a room, so they get no line). Clicking an exit on the LOADED
//    level selects it (Properties); on any other grid it jumps there.
//  • Entrance cells: amber outline on the screen a warp lands in — the same
//    amber as the canvas's incoming-entrance markers.
//  • External destinations (warps that leave the cluster into another catalog
//    level) render as compact label stubs, clickable to navigate.
//
// The LOADED level's outgoing edges come from its live (possibly unsaved)
// `level.exits`, so a just-placed exit shows immediately; every other level's
// edges come from the BFS walk (`useSubLevelBFS.edges`, on-disk state).

import type { JSX } from 'react'
import type { LevelData, ScreenExit } from '../../../preload/api'
import { getLevel } from '../data/levels'
import type { IncomingExit, Selection } from '../types'
import type { WarpEdge } from '../lib/warp-graph'
import { hex0x } from '../lib/hex'

const SCREENS_W = 16
const SCREENS_H = 8
/** Half the old minimap's ~20px cells. */
const CELL = 10
const GRID_W = SCREENS_W * CELL
const GRID_H = SCREENS_H * CELL
const LABEL_H = 14
const NODE_H = LABEL_H + GRID_H
/** Stub node (external catalog destination) box size. */
const STUB_W = 110
const STUB_H = 18
const H_GAP = 60
const V_GAP = 26
const PAD = 8

const WARP_FILL = '#2c63c8'
const WARP_LINE = '#4a82e6'
const MINI_FILL = '#7a3fd1'
/** Entrance amber — matches the canvas incoming-marker color (draw/exits.ts). */
const ENTRANCE = '#fb923c'
const ACCENT = '#d4e157'

/** Friendly label for a record: catalog "slot name", else "Room 0xNN". */
function levelLabel(recordId: number): string {
  const cat = getLevel(recordId)
  return cat ? `${cat.slot} ${cat.name}` : `Room ${hex0x(recordId, 2)}`
}

interface Node {
  id: number
  /** Cluster member with a screen grid, or an external catalog stub. */
  kind: 'grid' | 'stub'
  x: number
  y: number
  h: number
}

/**
 * BFS-layer layout: column = hop depth from the root; within a column each
 * node's y is the average of its incoming exits' y on already-placed grids
 * (then de-overlapped top-down). "Approximately aligned" — exits and their
 * entrances end up roughly opposite each other without a real graph solver.
 */
function layoutNodes(subLevels: number[], edges: WarpEdge[]): Map<number, Node> {
  const inCluster = new Set(subLevels)
  // Hop depth: root 0; first edge that reaches a node sets depth(src)+1.
  const depth = new Map<number, number>()
  if (subLevels.length > 0) depth.set(subLevels[0], 0)
  let changed = true
  while (changed) {
    changed = false
    for (const e of edges) {
      const d = depth.get(e.sourceLevelRecordId)
      if (d === undefined || depth.has(e.destLevelRecordId)) continue
      depth.set(e.destLevelRecordId, d + 1)
      changed = true
    }
  }
  for (const id of subLevels) if (!depth.has(id)) depth.set(id, 0)
  // External stubs share the column after their (shallowest) source.
  const stubIds = [...new Set(edges.map((e) => e.destLevelRecordId))].filter(
    (id) => !inCluster.has(id)
  )

  const byCol = new Map<number, Node[]>()
  const push = (n: Node, col: number): void => {
    const list = byCol.get(col) ?? []
    list.push(n)
    byCol.set(col, list)
  }
  for (const id of subLevels) {
    push({ id, kind: 'grid', x: 0, y: 0, h: NODE_H }, depth.get(id)!)
  }
  for (const id of stubIds) {
    push({ id, kind: 'stub', x: 0, y: 0, h: STUB_H }, (depth.get(id) ?? 0) + 0)
  }

  const placed = new Map<number, Node>()
  for (const col of [...byCol.keys()].sort((a, b) => a - b)) {
    const x = PAD + col * (GRID_W + H_GAP)
    const nodes = byCol.get(col)!
    // Desired y: centre on the average y of incoming exit cells already placed.
    const desired = nodes.map((n) => {
      const ys: number[] = []
      for (const e of edges) {
        if (e.destLevelRecordId !== n.id) continue
        const src = placed.get(e.sourceLevelRecordId)
        if (!src || src.kind !== 'grid') continue
        ys.push(src.y + LABEL_H + ((e.sourceScreenIndex >> 4) + 0.5) * CELL)
      }
      const want = ys.length > 0 ? ys.reduce((a, b) => a + b, 0) / ys.length - n.h / 2 : PAD
      return { n, want }
    })
    desired.sort((a, b) => a.want - b.want)
    let cursor = PAD
    for (const { n, want } of desired) {
      const y = Math.max(want, cursor)
      placed.set(n.id, { ...n, x, y })
      cursor = y + n.h + V_GAP
    }
  }
  return placed
}

/** Centre of a screen cell inside a grid node. */
function cellCenter(node: Node, screenIndex: number): { x: number; y: number } {
  return {
    x: node.x + ((screenIndex & 0xf) + 0.5) * CELL,
    y: node.y + LABEL_H + ((screenIndex >> 4) + 0.5) * CELL
  }
}

export function ExitsBody({
  level,
  selection,
  subLevels,
  edges,
  loading,
  onSelectExit,
  onSelectIncoming,
  onJump
}: {
  level: LevelData | null
  selection: Selection[]
  /** The root cluster in BFS order (root first). */
  subLevels: number[]
  /** Every warp edge of the cluster (BFS order, on-disk state). */
  edges: WarpEdge[]
  loading: boolean
  onSelectExit: (uid: number) => void
  /** Select an incoming-entrance marker of the LOADED level (Properties opens). */
  onSelectIncoming: (inc: IncomingExit) => void
  /** Jump to a level at a cell (the canvas dbl-click / finder navigation). */
  onJump: (recordId: number, x: number, y: number) => void
}): JSX.Element {
  if (!level || level.empty || level.special) {
    return <p className="se-pop__empty">No level loaded.</p>
  }
  const selectedUid = selection.find((s) => s.kind === 'exit')?.uid ?? -1
  const selectedIncoming = selection.find((s) => s.kind === 'incoming')?.incoming ?? null

  /** Map a click on a grid rect to the centre cell of the clicked SCREEN, then
   *  scroll there (camera-only on the loaded level; full jump elsewhere). */
  const jumpToClickedScreen = (recordId: number, ev: React.MouseEvent<SVGElement>): void => {
    const r = (ev.currentTarget as SVGGraphicsElement).getBoundingClientRect()
    const col = Math.max(0, Math.min(SCREENS_W - 1, Math.floor(((ev.clientX - r.left) / r.width) * SCREENS_W)))
    const row = Math.max(0, Math.min(SCREENS_H - 1, Math.floor(((ev.clientY - r.top) / r.height) * SCREENS_H)))
    onJump(recordId, (col << 4) + 8, (row << 4) + 8)
  }

  // The loaded level's edges from its LIVE exits (unsaved placements show);
  // everything else from the BFS walk.
  const liveEdges: WarpEdge[] = level.exits
    .filter((e): e is Extract<ScreenExit, { variant: 'warp' }> => e.variant === 'warp')
    .map((e) => ({
      sourceLevelRecordId: level.recordId,
      sourceScreenIndex: e.screenIndex,
      destLevelRecordId: e.destLevelRecordId,
      destX: e.destX,
      destY: e.destY,
      entranceType: e.entranceType
    }))
  const allEdges = [
    ...edges.filter((e) => e.sourceLevelRecordId !== level.recordId),
    ...liveEdges
  ]

  const nodes = layoutNodes(subLevels, allEdges)
  const width = Math.max(...[...nodes.values()].map((n) => n.x + GRID_W), 0) + PAD
  const height = Math.max(...[...nodes.values()].map((n) => n.y + n.h), 0) + PAD

  // Per grid: its exit cells (the loaded level from live exits — with uid +
  // variant; others from edges, warp-only) and its entrance screens.
  const exitCells = new Map<number, { screen: number; variant: string; uid?: number; tip: string }[]>()
  for (const id of subLevels) exitCells.set(id, [])
  for (const e of allEdges) {
    if (e.sourceLevelRecordId === level.recordId) continue // handled below (live)
    exitCells.get(e.sourceLevelRecordId)?.push({
      screen: e.sourceScreenIndex,
      variant: 'warp',
      tip: `Screen ${hex0x(e.sourceScreenIndex, 2)} → ${levelLabel(e.destLevelRecordId)} at (${e.destX}, ${e.destY})`
    })
  }
  exitCells.set(
    level.recordId,
    level.exits.map((e) => ({
      screen: e.screenIndex,
      variant: e.variant,
      uid: e.uid,
      tip:
        e.variant === 'warp'
          ? `Screen ${hex0x(e.screenIndex, 2)} → ${levelLabel(e.destLevelRecordId)} at (${e.destX}, ${e.destY})`
          : `Screen ${hex0x(e.screenIndex, 2)} → Minibattle ${hex0x(e.minibattleId, 2)} (returns to ${levelLabel(e.returnLevelRecordId)})`
    }))
  )
  // Per level: landing SCREEN → the warp edges that land there (an entrance
  // screen can aggregate several warps; clicking selects the first marker).
  const entranceScreens = new Map<number, Map<number, WarpEdge[]>>()
  for (const e of allEdges) {
    const byScreen = entranceScreens.get(e.destLevelRecordId) ?? new Map<number, WarpEdge[]>()
    const screen = ((e.destY >> 4) << 4) | (e.destX >> 4)
    const list = byScreen.get(screen) ?? []
    list.push(e)
    byScreen.set(screen, list)
    entranceScreens.set(e.destLevelRecordId, byScreen)
  }

  // Selected exit → highlight its edge.
  const selectedExit = level.exits.find((e) => e.uid === selectedUid)

  const edgePaths = allEdges.map((e, i) => {
    const src = nodes.get(e.sourceLevelRecordId)
    const dst = nodes.get(e.destLevelRecordId)
    if (!src || !dst) return null
    const a = src.kind === 'grid' ? cellCenter(src, e.sourceScreenIndex) : { x: src.x + STUB_W, y: src.y + STUB_H / 2 }
    const b =
      dst.kind === 'grid'
        ? cellCenter(dst, ((e.destY >> 4) << 4) | (e.destX >> 4))
        : { x: dst.x, y: dst.y + STUB_H / 2 }
    const isSelected =
      (selectedExit?.variant === 'warp' &&
        e.sourceLevelRecordId === level.recordId &&
        e.sourceScreenIndex === selectedExit.screenIndex) ||
      (selectedIncoming !== null &&
        e.sourceLevelRecordId === selectedIncoming.sourceLevelRecordId &&
        e.sourceScreenIndex === selectedIncoming.sourceScreenIndex)
    // Horizontal-biased cubic; self/same-column links bow outward.
    const dx = Math.max(24, Math.abs(b.x - a.x) / 2)
    const d = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
    return (
      <path
        key={i}
        d={d}
        fill="none"
        stroke={isSelected ? ACCENT : WARP_LINE}
        strokeWidth={isSelected ? 2 : 1.2}
        opacity={isSelected ? 1 : 0.55}
      />
    )
  })

  return (
    <div className="se-exits">
      <p className="se-exits__heading">
        Network — {subLevels.length} room{subLevels.length === 1 ? '' : 's'}
        {loading ? ' (scanning…)' : ''}
      </p>
      <div className="se-exits__map">
        <svg width={width} height={height}>
          {/* edges under the grids' cells but over their backgrounds — draw
              grids first (bg), then edges, then markers, so lines never hide
              the small cells. */}
          {[...nodes.values()].map((n) =>
            n.kind === 'grid' ? (
              <g key={n.id}>
                <text
                  x={n.x}
                  y={n.y + LABEL_H - 4}
                  className={`se-exits__svglabel${n.id === level.recordId ? ' is-current' : ''}`}
                  onClick={() => onJump(n.id, 128, 64)}
                >
                  {levelLabel(n.id)}
                </text>
                <rect
                  x={n.x}
                  y={n.y + LABEL_H}
                  width={GRID_W}
                  height={GRID_H}
                  className={`se-exits__svggrid${n.id === level.recordId ? ' is-current' : ''}`}
                  onClick={(ev) => jumpToClickedScreen(n.id, ev)}
                >
                  <title>{levelLabel(n.id)}</title>
                </rect>
                {/* faint screen gridlines */}
                <path
                  className="se-exits__svglines"
                  d={
                    Array.from({ length: SCREENS_W - 1 }, (_, i) => `M ${n.x + (i + 1) * CELL} ${n.y + LABEL_H} v ${GRID_H}`).join(' ') +
                    ' ' +
                    Array.from({ length: SCREENS_H - 1 }, (_, i) => `M ${n.x} ${n.y + LABEL_H + (i + 1) * CELL} h ${GRID_W}`).join(' ')
                  }
                />
              </g>
            ) : (
              <g key={n.id} onClick={() => onJump(n.id, 128, 64)} className="se-exits__stub">
                <rect x={n.x} y={n.y} width={STUB_W} height={STUB_H} rx={3} />
                <text x={n.x + 6} y={n.y + STUB_H - 5}>{levelLabel(n.id)}</text>
                <title>{levelLabel(n.id)} — outside this cluster; click to open</title>
              </g>
            )
          )}
          {edgePaths}
          {[...nodes.values()].map((n) => {
            if (n.kind !== 'grid') return null
            const exits = exitCells.get(n.id) ?? []
            const entrances = entranceScreens.get(n.id) ?? new Map<number, WarpEdge[]>()
            return (
              <g key={`m${n.id}`}>
                {[...entrances.entries()].map(([screen, landers]) => {
                  // Highlight the landing cell when the selected exit feeds it,
                  // or when the selected incoming marker IS it.
                  const fromExit =
                    selectedExit?.variant === 'warp' &&
                    selectedExit.destLevelRecordId === n.id &&
                    (((selectedExit.destY >> 4) << 4) | (selectedExit.destX >> 4)) === screen
                  const fromIncoming =
                    selectedIncoming !== null &&
                    n.id === level.recordId &&
                    (((selectedIncoming.destY >> 4) << 4) | (selectedIncoming.destX >> 4)) === screen
                  const first = landers[0]
                  return (
                    <rect
                      key={`in${screen}`}
                      x={n.x + (screen & 0xf) * CELL + 1}
                      y={n.y + LABEL_H + (screen >> 4) * CELL + 1}
                      width={CELL - 2}
                      height={CELL - 2}
                      fill="none"
                      stroke={fromExit || fromIncoming ? ACCENT : ENTRANCE}
                      strokeWidth={1.5}
                      pointerEvents="all"
                      className="se-exits__svgexit"
                      onClick={() => {
                        // Loaded level: select the entrance's incoming marker
                        // (first lander) + scroll to its exact landing cell.
                        // Other levels: jump to the clicked screen.
                        if (n.id === level.recordId) {
                          onSelectIncoming({
                            sourceLevelRecordId: first.sourceLevelRecordId,
                            sourceScreenIndex: first.sourceScreenIndex,
                            destX: first.destX,
                            destY: first.destY,
                            entranceType: first.entranceType
                          })
                          onJump(n.id, first.destX, first.destY)
                        } else {
                          onJump(n.id, ((screen & 0xf) << 4) + 8, ((screen >> 4) << 4) + 8)
                        }
                      }}
                    >
                      <title>
                        {`Screen ${hex0x(screen, 2)} — ${landers.length === 1 ? 'a warp lands' : `${landers.length} warps land`} here: ${landers
                          .map((l) => `${levelLabel(l.sourceLevelRecordId)} screen ${hex0x(l.sourceScreenIndex, 2)}`)
                          .join(', ')}`}
                      </title>
                    </rect>
                  )
                })}
                {exits.map((e, i) => (
                  <rect
                    key={`ex${i}`}
                    x={n.x + (e.screen & 0xf) * CELL + 1.5}
                    y={n.y + LABEL_H + (e.screen >> 4) * CELL + 1.5}
                    width={CELL - 3}
                    height={CELL - 3}
                    fill={e.variant === 'warp' ? WARP_FILL : MINI_FILL}
                    stroke={e.uid !== undefined && e.uid === selectedUid ? ACCENT : 'none'}
                    strokeWidth={1.5}
                    className="se-exits__svgexit"
                    onClick={() => {
                      if (n.id === level.recordId && e.uid !== undefined) onSelectExit(e.uid)
                      onJump(n.id, ((e.screen & 0xf) << 4) + 8, ((e.screen >> 4) << 4) + 8)
                    }}
                  >
                    <title>{e.tip}</title>
                  </rect>
                ))}
              </g>
            )
          })}
        </svg>
      </div>
      <p className="se-exits__legend">
        <span className="se-exits__swatch" style={{ background: WARP_FILL }} /> warp exit
        <span className="se-exits__swatch" style={{ background: MINI_FILL }} /> minibattle
        <span className="se-exits__swatch se-exits__swatch--ring" style={{ borderColor: ENTRANCE }} /> entrance
      </p>
    </div>
  )
}
