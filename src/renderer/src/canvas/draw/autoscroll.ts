// Autoscroll path overlay: for each shown track, a polyline through the screen
// centers of its checkpoints (segment color + label = the speed used to travel
// TO that checkpoint), numbered nodes you can drag, a dashed camera box (256×224)
// for the active / dragged checkpoint and the final one (with its end command),
// and a faint connector from each placed autoscroll sprite to its first node.
// World-space drawing (the scene's transform is already applied); pure, no React.

import type { AutoscrollModel } from '../../../../preload/api'
import { AUTOSCROLL_HORIZONTAL_ONLY } from 'snes-framework/autoscroll-model'
import {
  AUTOSCROLL_SCREEN_H,
  AUTOSCROLL_SCREEN_W,
  checkpointCamera,
  checkpointCenter,
  speedPxPerFrame,
  trackCheckpoints,
  trackSpriteId,
  type CheckpointRef
} from '../../lib/autoscroll-edit'
import { CELL_PX } from '../geometry'

export interface AutoscrollOverlay {
  model: AutoscrollModel
  /** Track indices to draw (0-11). */
  tracks: number[]
  /** Highlighted checkpoint (camera box drawn). */
  active: CheckpointRef | null
  /** Live drag preview: the dragged checkpoint's pending cell. */
  drag: { ref: CheckpointRef; x: number; y: number } | null
  /** Placed autoscroll sprites in the level (cells) — start connectors. */
  sprites: Array<{ track: number; x: number; y: number }>
}

/** Node hit radius in screen px. */
const NODE_R_PX = 11
const NODE_HIT_PX = 13
const NODE_LABEL_PX = 10
const LABEL_PX = 11

const same = (a: CheckpointRef | null | undefined, b: CheckpointRef): boolean =>
  !!a && a.sequence === b.sequence && a.checkpoint === b.checkpoint

/** Slow (≤ 0.25 px/f) cyan → fast (≥ 2 px/f) red. */
export function speedColor(speed: number, alpha = 0.95): string {
  const v = Math.abs(speedPxPerFrame(speed))
  const t = Math.max(0, Math.min(1, (v - 0.25) / 1.75))
  const hue = 190 - 190 * t
  return `hsla(${hue}, 85%, 58%, ${alpha})`
}

function nodePos(ov: AutoscrollOverlay, ref: CheckpointRef): { x: number; y: number } | null {
  const c = ov.drag && same(ov.drag.ref, ref) ? ov.drag : ov.model.sequences[ref.sequence]?.checkpoints[ref.checkpoint]
  return c ? checkpointCenter(c) : null
}

function cameraBox(
  ctx: CanvasRenderingContext2D,
  c: { x: number; y: number },
  color: string,
  zoom: number,
  label: string | null
): void {
  const cam = checkpointCamera(c)
  ctx.save()
  ctx.lineWidth = 1.5 / zoom
  ctx.setLineDash([6 / zoom, 4 / zoom])
  ctx.strokeStyle = color
  ctx.strokeRect(cam.x, cam.y, AUTOSCROLL_SCREEN_W, AUTOSCROLL_SCREEN_H)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'
  ctx.fillRect(cam.x, cam.y, AUTOSCROLL_SCREEN_W, AUTOSCROLL_SCREEN_H)
  if (label) {
    ctx.setLineDash([])
    ctx.font = `${LABEL_PX / zoom}px 'JetBrains Mono', monospace`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const w = ctx.measureText(label).width + 6 / zoom
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
    ctx.fillRect(cam.x, cam.y, w, 16 / zoom)
    ctx.fillStyle = color
    ctx.fillText(label, cam.x + 3 / zoom, cam.y + 1.5 / zoom)
  }
  ctx.restore()
}

export function drawAutoscrollOverlay(ctx: CanvasRenderingContext2D, ov: AutoscrollOverlay, zoom: number): void {
  ctx.save()
  ctx.font = `${LABEL_PX / zoom}px 'JetBrains Mono', monospace`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  for (const track of ov.tracks) {
    const refs = trackCheckpoints(ov.model, track)
    const pts = refs.map((r) => nodePos(ov, r)!)
    if (pts.length === 0) continue
    const num = trackSpriteId(track)

    // Start connectors: placed sprite → first node.
    for (const s of ov.sprites.filter((s) => s.track === track)) {
      ctx.save()
      ctx.setLineDash([3 / zoom, 3 / zoom])
      ctx.lineWidth = 1 / zoom
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
      ctx.beginPath()
      ctx.moveTo((s.x + 0.5) * CELL_PX, (s.y + 0.5) * CELL_PX)
      ctx.lineTo(pts[0]!.x, pts[0]!.y)
      ctx.stroke()
      ctx.restore()
    }

    // Segments, colored by the destination checkpoint's speed.
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!
      const c = ov.model.sequences[refs[i]!.sequence]!.checkpoints[refs[i]!.checkpoint]!
      ctx.lineWidth = 3 / zoom
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      ctx.lineWidth = 1.75 / zoom
      ctx.strokeStyle = speedColor(c.speed)
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      // Direction chevron + speed label at the midpoint.
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len * zoom > 42) {
        const h = 5 / zoom
        ctx.fillStyle = speedColor(c.speed)
        ctx.beginPath()
        ctx.moveTo(mx + Math.cos(ang) * h, my + Math.sin(ang) * h)
        ctx.lineTo(mx + Math.cos(ang + 2.5) * h, my + Math.sin(ang + 2.5) * h)
        ctx.lineTo(mx + Math.cos(ang - 2.5) * h, my + Math.sin(ang - 2.5) * h)
        ctx.closePath(); ctx.fill()
        const label = c.speed.toString(16).toUpperCase().padStart(2, '0')
        const lx = mx + Math.cos(ang + Math.PI / 2) * 12 / zoom
        const ly = my + Math.sin(ang + Math.PI / 2) * 12 / zoom
        const w = ctx.measureText(label).width + 4 / zoom
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
        ctx.fillRect(lx - w / 2, ly - 8 / zoom, w, 16 / zoom)
        ctx.fillStyle = speedColor(c.speed)
        ctx.fillText(label, lx, ly)
      }
    }

    // Camera boxes: last checkpoint (end command) + the active / dragged one.
    const lastRef = refs[refs.length - 1]!
    const seq = ov.model.sequences[lastRef.sequence]!
    const lastC = ov.drag && same(ov.drag.ref, lastRef) ? ov.drag : seq.checkpoints[lastRef.checkpoint]!
    cameraBox(ctx, lastC, 'rgba(255, 255, 255, 0.5)', zoom,
      `$${num.toString(16).toUpperCase()} end · ${seq.end === 0xff ? '$FF lock' : '$FE free scroll'}`)
    const boxRef = ov.drag?.ref ?? ov.active
    if (boxRef && refs.some((r) => same(boxRef, r)) && !same(boxRef, lastRef)) {
      const c = ov.drag && same(ov.drag.ref, boxRef) ? ov.drag : ov.model.sequences[boxRef.sequence]!.checkpoints[boxRef.checkpoint]!
      cameraBox(ctx, c, 'rgba(212, 225, 87, 0.95)', zoom,
        `#${boxRef.checkpoint} · X ${c.x.toString(16).toUpperCase()} Y ${c.y.toString(16).toUpperCase()}`)
    }

    // Nodes.
    ctx.font = `${NODE_LABEL_PX / zoom}px 'JetBrains Mono', monospace`
    pts.forEach((p, i) => {
      const ref = refs[i]!
      const c = ov.model.sequences[ref.sequence]!.checkpoints[ref.checkpoint]!
      const hot = same(ov.active, ref) || (ov.drag !== null && same(ov.drag.ref, ref))
      const r = (hot ? NODE_R_PX + 1.5 : NODE_R_PX) / zoom
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fillStyle = hot ? 'rgba(212, 225, 87, 0.95)' : 'rgba(15, 17, 20, 0.85)'
      ctx.fill()
      ctx.lineWidth = 1.5 / zoom
      ctx.strokeStyle = i === 0 ? '#ffffff' : speedColor(c.speed)
      ctx.stroke()
      ctx.fillStyle = hot ? '#0d0e10' : '#f0f2f6'
      ctx.fillText(String(ref.checkpoint), p.x, p.y + 0.5 / zoom)
    })
    // Track tag at the first node.
    const first = pts[0]!
    const tag = `$${num.toString(16).toUpperCase()}${AUTOSCROLL_HORIZONTAL_ONLY.has(num) ? ' · Y free' : ''}`
    ctx.font = `${LABEL_PX / zoom}px 'JetBrains Mono', monospace`
    ctx.textAlign = 'left'
    const w = ctx.measureText(tag).width + 6 / zoom
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
    ctx.fillRect(first.x + 13 / zoom, first.y - 22 / zoom, w, 16 / zoom)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(tag, first.x + 16 / zoom, first.y - 14 / zoom)
    ctx.textAlign = 'center'
  }
  ctx.restore()
}

/** Nearest checkpoint within the hit radius. The topmost node wins ties. */
export function hitTestCheckpoint(
  ov: AutoscrollOverlay,
  wx: number,
  wy: number,
  zoom: number
): (CheckpointRef & { track: number }) | null {
  const r = NODE_HIT_PX / zoom
  let best: (CheckpointRef & { track: number }) | null = null
  let nearest = Infinity
  for (const track of [...ov.tracks].reverse()) {
    const refs = trackCheckpoints(ov.model, track)
    for (let i = refs.length - 1; i >= 0; i--) {
      const p = nodePos(ov, refs[i]!)
      if (!p) continue
      const distance = Math.hypot(wx - p.x, wy - p.y)
      if (distance <= r && distance < nearest) {
        nearest = distance
        best = { ...refs[i]!, track }
      }
    }
  }
  return best
}
