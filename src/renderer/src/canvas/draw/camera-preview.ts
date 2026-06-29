// Camera Preview overlay — the virtual-camera box, the optional black mask outside
// it, and the screen-relative sky gradient. The box represents the camera's world
// rect (256×224 SNES px at the selected 1×–4× zoom, possibly screen-snapped); the
// gradient + mask + outline are drawn in CSS-px SCREEN space, so each entry point
// resets the canvas transform to `dpr` and restores after.

import { CAMERA_W, CAMERA_H, CAMERA_BAR_PX, type CameraSnap } from '../parallax'
import type { View } from '../view'
import { GRADIENT_RAMP_HEIGHT } from '../../lib/gradient-banded'

/** Camera Preview settings (the checkbox is on/off; these are the popup options). */
export interface CameraPreview {
  /** Black-mask everything outside the camera box. */
  mask: boolean
  /** Display zoom: 1–4 (the editor view zoom is pinned to this while on). */
  zoom: number
  /** Snap the camera to the screen grid on one axis (or not). */
  snap: CameraSnap
}

export interface BoxRect {
  x: number
  y: number
  w: number
  h: number
}

/** The camera box's rect in CSS px, from its world origin + the view transform
 *  (`screen = pan + world*zoom`). */
export function cameraBoxScreenRect(cam: { x: number; y: number }, view: View): BoxRect {
  return {
    x: cam.x * view.zoom + view.panX,
    y: cam.y * view.zoom + view.panY,
    w: CAMERA_W * view.zoom,
    h: CAMERA_H * view.zoom
  }
}

/**
 * Fill the viewport with the screen-relative sky gradient (behind the layers). Each
 * banded-ramp entry occupies `zoom` CSS rows; the box's top row shows entry `scroll`
 * (the camY/8 window) and rows above/below extend (clamped) for context. Runs are
 * batched into one fillRect per band so a pan stays cheap.
 */
export function drawCameraGradient(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  size: { w: number; h: number },
  box: BoxRect,
  ramp: Uint8Array,
  scroll: number,
  zoom: number
): void {
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const H = Math.ceil(size.h)
  const entryAt = (sy: number): number => {
    const e = scroll + Math.floor((sy - box.y) / zoom)
    return e < 0 ? 0 : e >= GRADIENT_RAMP_HEIGHT ? GRADIENT_RAMP_HEIGHT - 1 : e
  }
  const fill = (y0: number, y1: number, e: number): void => {
    ctx.fillStyle = `rgb(${ramp[e * 3]}, ${ramp[e * 3 + 1]}, ${ramp[e * 3 + 2]})`
    ctx.fillRect(0, y0, size.w, y1 - y0)
  }
  let runStart = 0
  let runEntry = -1
  for (let sy = 0; sy < H; sy++) {
    const e = entryAt(sy)
    if (e !== runEntry) {
      if (runEntry >= 0) fill(runStart, sy, runEntry)
      runStart = sy
      runEntry = e
    }
  }
  if (runEntry >= 0) fill(runStart, H, runEntry)
  ctx.restore()
}

/** Draw the camera box outline, plus (when `mask`) a black fill over everything
 *  outside it. Both in CSS-px screen space, clamped to the viewport. */
export function drawCameraOverlay(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  size: { w: number; h: number },
  box: BoxRect,
  mask: boolean
): void {
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (mask) {
    // The box may be partly off-screen (snap / zoom) — clamp the hole to the viewport.
    const x0 = Math.max(0, box.x)
    const y0 = Math.max(0, box.y)
    const x1 = Math.min(size.w, box.x + box.w)
    const y1 = Math.min(size.h, box.y + box.h)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size.w, y0) // above
    ctx.fillRect(0, y1, size.w, size.h - y1) // below
    ctx.fillRect(0, y0, x0, y1 - y0) // left
    ctx.fillRect(x1, y0, size.w - x1, y1 - y0) // right
  }
  // Force-blank black bars at the top + bottom of the camera (8 SNES px each, scaled
  // with zoom) — the game blanks those scanlines, leaving a 208px play area.
  const bar = (box.h / CAMERA_H) * CAMERA_BAR_PX
  ctx.fillStyle = '#000'
  ctx.fillRect(box.x, box.y, box.w, bar)
  ctx.fillRect(box.x, box.y + box.h - bar, box.w, bar)
  ctx.strokeStyle = 'rgba(255, 210, 64, 0.95)'
  ctx.lineWidth = 2
  ctx.strokeRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2)
  ctx.restore()
}
