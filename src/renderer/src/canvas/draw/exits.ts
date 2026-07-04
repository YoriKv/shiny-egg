// Outgoing screen-exit markers and "someone else lands here" incoming
// markers. YI levels are 256 × 128 cells = 16 × 8 screens (each screen =
// 16 × 16 cells). `screenIndex` is row-major: `index = (row << 4) | col`,
// where col ∈ 0..15 and row ∈ 0..7. The exit data also carries `(x, y)` in
// destination-level cells, which we currently surface only via tooltip
// text — the click action just jumps to the destination level.

import type { ScreenExit } from '../../../../preload/api'
import { getLevel } from '../../data/levels'
import type { IncomingExit, Selection } from '../../types'
import {
  CELL_PX,
  EXIT_MARKER_HALF_PX,
  SCREEN_PX,
  exitMarkerX,
  exitMarkerY,
  screenCol,
  screenRow
} from '../geometry'
import { hex0x } from '../../lib/hex'
import { monoAdvance } from './text'
import { drawDoorIcon } from './door-icons'
import { SELECTION_ACCENT, selectionAccent } from './selection'


/**
 * Trace a screen's boundary in a marker state color — the outline drawn around
 * each exit's owning screen (matching its corner icon), also reused by scene.ts
 * for the invalid-drop warning so the two rects coincide exactly. Inset by half
 * the line width so the stroke sits fully inside the screen and two adjacent
 * exit screens keep visually distinct outlines. `lineWidthPx` is in screen px
 * (scaled by 1/zoom like every overlay stroke).
 */
export function strokeScreenOutline(
  ctx: CanvasRenderingContext2D,
  screenIndex: number,
  color: string,
  lineWidthPx: number,
  zoom: number
): void {
  const lw = lineWidthPx / zoom
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.strokeRect(
    screenCol(screenIndex) * SCREEN_PX + lw / 2,
    screenRow(screenIndex) * SCREEN_PX + lw / 2,
    SCREEN_PX - lw,
    SCREEN_PX - lw
  )
  ctx.restore()
}


/**
 * Draw a clickable marker at each exit's source screen with an adjacent label
 * showing the destination's friendly slot + name (or hex ID if unknown).
 */
export function drawExits(
  ctx: CanvasRenderingContext2D,
  exits: ScreenExit[],
  selection: Selection | null,
  zoom: number
): void {
  if (exits.length === 0) return
  const selectedUid =
    selection && selection.kind === 'exit' ? selection.uid : -1
  ctx.save()
  // Screen-outline pass first: trace each exit's owning screen in the marker's
  // state color, so which screen the exit belongs to reads at a glance (the
  // corner icon alone doesn't convey the extent). A separate pass so a long
  // label overrunning into the next screen is never crossed by that screen's
  // outline. Widths match the door chip's border (1.5 idle / 2.5 selected).
  for (const e of exits) {
    const isSelected = e.uid === selectedUid
    strokeScreenOutline(
      ctx,
      e.screenIndex,
      isSelected ? selectionAccent(0.9) : 'rgba(34, 211, 238, 0.75)',
      isSelected ? 2.5 : 1.5,
      zoom
    )
  }
  const half = EXIT_MARKER_HALF_PX
  // Label text style is constant across the pass — set the font + measure one
  // glyph (monospace, see ./text) once here instead of per exit.
  ctx.font = `${10 / zoom}px 'JetBrains Mono', monospace`
  ctx.textBaseline = 'top'
  const adv = monoAdvance(ctx)
  for (const e of exits) {
    // Anchored at the TOP-LEFT corner of the exit's screen (see exitMarkerX/Y),
    // so it reads as belonging to that screen square rather than floating at its
    // centre.
    const cx = exitMarkerX(e.screenIndex)
    const cy = exitMarkerY(e.screenIndex)
    const isSelected = e.uid === selectedUid
    const stroke = isSelected ? SELECTION_ACCENT : '#22d3ee'

    // Exit-door glyph (arrow leaving) tinted by state, on a dark chip. Fixed
    // world-pixel size so it scales with zoom (a generous click target when
    // zoomed in).
    drawDoorIcon(ctx, cx, cy, half, 'exit', stroke, zoom, isSelected)

    // Label below the marker, left-aligned to the chip so it stays inside the
    // screen (the marker now hugs the top-left corner). Drawn at every zoom —
    // labels can overlap when far out, but always knowing where an exit leads
    // beats legibility there (the incoming labels match).
    let label: string
    if (e.variant === 'warp') {
      const dest = getLevel(e.destLevelRecordId)
      label = dest ? `to ${dest.slot} ${dest.name}` : `to ${hex0x(e.destLevelRecordId)}`
    } else {
      label = `Minibattle ${hex0x(e.minibattleId)}`
    }
    const padX = 4 / zoom
    const padY = 2 / zoom
    const lw = label.length * adv + padX * 2
    const lh = 14 / zoom
    const lx = cx - half
    const ly = cy + half + 2 / zoom
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
    ctx.fillRect(lx, ly, lw, lh)
    ctx.strokeStyle = isSelected ? selectionAccent(0.6) : 'rgba(34, 211, 238, 0.6)'
    ctx.lineWidth = 1 / zoom
    ctx.strokeRect(lx, ly, lw, lh)
    ctx.fillStyle = stroke
    ctx.fillText(label, lx + padX, ly + padY)
  }
  ctx.restore()
}

/**
 * Draw "someone else lands here" markers — entry points where a sibling
 * room's outgoing exit deposits the player in THIS level. Drawn distinctly
 * from `drawExits` so the one-way nature reads at a glance: dashed amber
 * outline, hollow (no fill), arrow points INWARD toward the diamond center.
 *
 * Marker sits at the precise destX/destY of the source's exit record, NOT
 * at a screen-center, since that's exactly where the player materializes.
 */
export function drawIncomingExits(
  ctx: CanvasRenderingContext2D,
  incoming: IncomingExit[],
  selection: Selection | null,
  zoom: number
): void {
  if (incoming.length === 0) return
  const selKey =
    selection && selection.kind === 'incoming'
      ? `${selection.incoming.sourceLevelRecordId}:${selection.incoming.sourceScreenIndex}`
      : null
  ctx.save()
  // Normalized to the same size as the outgoing exit door (one tile).
  const half = EXIT_MARKER_HALF_PX
  const amber = '#fb923c'
  const lime = SELECTION_ACCENT
  // Label style is constant for the pass; measure one glyph (monospace) once.
  ctx.font = `${9 / zoom}px 'JetBrains Mono', monospace`
  ctx.textBaseline = 'top'
  const adv = monoAdvance(ctx)
  for (const e of incoming) {
    const cx = (e.destX + 0.5) * CELL_PX
    const cy = (e.destY + 0.5) * CELL_PX
    const isSelected = selKey === `${e.sourceLevelRecordId}:${e.sourceScreenIndex}`
    const stroke = isSelected ? lime : amber

    // Entry-door glyph (arrow entering) at the exact landing cell — amber to keep
    // the incoming markers a distinct family from the cyan outgoing exits.
    drawDoorIcon(ctx, cx, cy, half, 'entry', stroke, zoom, isSelected)

    // Tiny "from <id>" label below the marker — drawn at every zoom, matching
    // the outgoing "to …" labels.
    const label = `from ${hex0x(e.sourceLevelRecordId)}`
    const padX = 3 / zoom
    const padY = 1.5 / zoom
    const lw = label.length * adv + padX * 2
    const lh = 12 / zoom
    const lx = cx - lw / 2
    const ly = cy + half + 2 / zoom
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
    ctx.fillRect(lx, ly, lw, lh)
    ctx.fillStyle = stroke
    ctx.fillText(label, lx + padX, ly + padY)
  }
  ctx.restore()
}
