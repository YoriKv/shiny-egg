// Minimap draw — render the full-extent BG1 level layer scaled into a small
// box, then outline the slice of the level currently visible in the main
// editor viewport. Pure: the caller owns the target canvas, its logical size,
// and any device-pixel-ratio transform on the context. See ../../Minimap.tsx
// for the React widget that drives this.

import type { View } from '../view'
import { clientToWorld } from '../view'

export interface MinimapDrawArgs {
  /** Full-extent BG1 backing canvas. It's drawn at world origin in the main
   *  scene (see draw/decoded-bg1.ts), so its pixel dimensions ARE the level's
   *  world-pixel extent — the basis for the world↔minimap scale. */
  bg1Canvas: HTMLCanvasElement
  /** Current main-canvas camera. */
  view: View
  /** Main-canvas viewport size in canvas pixels (drives the visible-region box). */
  viewportSize: { w: number; h: number }
  /** Minimap box size in logical (CSS) pixels. */
  width: number
  height: number
  /** Opacity of the level render — the "half-transparent" look. */
  alpha: number
}

export function drawMinimap(ctx: CanvasRenderingContext2D, args: MinimapDrawArgs): void {
  const { bg1Canvas, view, viewportSize, width, height, alpha } = args
  ctx.clearRect(0, 0, width, height)
  const levelW = bg1Canvas.width
  const levelH = bg1Canvas.height
  if (levelW === 0 || levelH === 0) return

  // world px → minimap px
  const sx = width / levelW
  const sy = height / levelH

  ctx.imageSmoothingEnabled = true
  ctx.globalAlpha = alpha
  ctx.drawImage(bg1Canvas, 0, 0, levelW, levelH, 0, 0, width, height)
  ctx.globalAlpha = 1

  // Visible-region rectangle: invert the camera transform at the viewport's
  // corners to get the world span on screen, then map it into minimap px.
  if (viewportSize.w > 0 && viewportSize.h > 0) {
    const tl = clientToWorld(view, 0, 0)
    const br = clientToWorld(view, viewportSize.w, viewportSize.h)
    const rx = tl.x * sx
    const ry = tl.y * sy
    const rw = (br.x - tl.x) * sx
    const rh = (br.y - tl.y) * sy
    ctx.lineWidth = 0.5
    ctx.strokeStyle = 'rgba(210, 210, 210, 0.85)'
    ctx.strokeRect(rx + 0.5, ry + 0.5, Math.max(1, rw), Math.max(1, rh))
  }
}
