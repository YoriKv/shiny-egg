// Outgoing screen-exit markers and "someone else lands here" incoming
// markers. YI levels are 256 × 128 cells = 16 × 8 screens (each screen =
// 16 × 16 cells). `screenIndex` is row-major: `index = (row << 4) | col`,
// where col ∈ 0..15 and row ∈ 0..7. The exit data also carries `(x, y)` in
// destination-level cells, which we currently surface only via tooltip
// text — the click action just jumps to the destination level.

import type { ScreenExit } from '../../../../preload/api'
import { getLevel } from '../../data/levels'
import type { IncomingExit, Selection } from '../../types'
import { CELL_PX, EXIT_MARKER_HALF_PX, exitCenterX, exitCenterY } from '../geometry'
import { hex0x } from '../../lib/hex'
import { monoAdvance } from './text'
import { SELECTION_ACCENT, selectionAccent } from './selection'


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
  const half = EXIT_MARKER_HALF_PX
  // Label text style is constant across the pass — set the font + measure one
  // glyph (monospace, see ./text) once here instead of per exit.
  ctx.font = `${10 / zoom}px 'JetBrains Mono', monospace`
  ctx.textBaseline = 'top'
  const adv = monoAdvance(ctx)
  for (const e of exits) {
    const cx = exitCenterX(e.screenIndex)
    const cy = exitCenterY(e.screenIndex)
    const isSelected = e.uid === selectedUid
    const stroke = isSelected ? SELECTION_ACCENT : '#22d3ee'

    // Marker: a door-glyph diamond with an arrow inside, distinctive enough
    // to read at small sizes. Drawn at fixed world-pixel size so it scales
    // with zoom (so high-zoom views show a generous click target).
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
    ctx.strokeStyle = stroke
    ctx.lineWidth = (isSelected ? 2.5 : 1.5) / zoom
    ctx.beginPath()
    ctx.moveTo(cx, cy - half)
    ctx.lineTo(cx + half, cy)
    ctx.lineTo(cx, cy + half)
    ctx.lineTo(cx - half, cy)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    // Arrow glyph inside the diamond (right-pointing — direction-agnostic
    // since exits don't always have an obvious "into here" direction).
    ctx.fillStyle = stroke
    ctx.beginPath()
    ctx.moveTo(cx - half / 3, cy - half / 3)
    ctx.lineTo(cx + half / 3, cy)
    ctx.lineTo(cx - half / 3, cy + half / 3)
    ctx.closePath()
    ctx.fill()

    // Label below the marker. At very low zoom, drop the label so it doesn't
    // smear into adjacent markers — the marker itself is still hit-testable.
    if (zoom >= 0.4) {
      let label: string
      if (e.variant === 'warp') {
        const dest = getLevel(e.destLevelRecordId)
        label = dest ? `${dest.slot} ${dest.name}` : `→ ${hex0x(e.destLevelRecordId)}`
      } else {
        label = `Minibattle ${hex0x(e.minibattleId)}`
      }
      const padX = 4 / zoom
      const padY = 2 / zoom
      const lw = label.length * adv + padX * 2
      const lh = 14 / zoom
      const lx = cx - lw / 2
      const ly = cy + half + 2 / zoom
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
      ctx.fillRect(lx, ly, lw, lh)
      ctx.strokeStyle = isSelected ? selectionAccent(0.6) : 'rgba(34, 211, 238, 0.6)'
      ctx.lineWidth = 1 / zoom
      ctx.strokeRect(lx, ly, lw, lh)
      ctx.fillStyle = stroke
      ctx.fillText(label, lx + padX, ly + padY)
    }
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
  // A bit smaller than outgoing markers so they don't fight for attention.
  const half = EXIT_MARKER_HALF_PX * 0.85
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

    // Hollow dashed diamond.
    ctx.strokeStyle = stroke
    ctx.lineWidth = (isSelected ? 2.25 : 1.5) / zoom
    ctx.setLineDash([4 / zoom, 3 / zoom])
    ctx.beginPath()
    ctx.moveTo(cx, cy - half)
    ctx.lineTo(cx + half, cy)
    ctx.lineTo(cx, cy + half)
    ctx.lineTo(cx - half, cy)
    ctx.closePath()
    ctx.stroke()
    ctx.setLineDash([]) // reset before arrow

    // Inward-pointing arrow (chevron pointing toward center from the left
    // edge — clear visual cue of "stuff enters here").
    ctx.strokeStyle = stroke
    ctx.lineWidth = (isSelected ? 2 : 1.5) / zoom
    ctx.beginPath()
    ctx.moveTo(cx - half + 2 / zoom, cy - half / 2)
    ctx.lineTo(cx - 1 / zoom, cy)
    ctx.lineTo(cx - half + 2 / zoom, cy + half / 2)
    ctx.stroke()

    // Tiny "from <id>" label below the marker — only when zoomed in
    // enough to read. Skipped when zoomed out so a level with many
    // incoming refs stays legible.
    if (zoom >= 1.2) {
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
  }
  ctx.restore()
}
