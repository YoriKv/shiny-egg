// Pins the paste-on-screen geometry — viewportCenterCell (where an off-screen
// paste retargets to) and isCellOnScreen (the off-screen check) — plus the
// zoom-preset stepping (the toolbar dropdown / Shift+wheel stops) and the
// fixed-point rule of zoomTo, and the drag edge auto-scroll step
// (edgeScrollPan) + mid-drag start re-anchoring (reanchorCanvasPoint). Pure functions over the camera transform
// `screen = cell * CELL_PX * zoom + pan`.
//
// Run via Vitest (renderer config): `pnpm run test:renderer`.

import { describe, test, expect } from 'vitest'
import {
  EDGE_SCROLL_ZONE_PX,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_PRESETS,
  edgeScrollPan,
  isCellOnScreen,
  reanchorCanvasPoint,
  stepZoomPreset,
  viewportCenterCell,
  zoomTo,
  type View
} from './view'

const VP = { w: 320, h: 240 }
const view: View = { panX: 16, panY: 16, zoom: 1 } // INITIAL_VIEW

describe('viewportCenterCell', () => {
  test('maps the viewport centre back to a cell', () => {
    // centre px = (160, 120); world = ((160-16)/1, (120-16)/1) = (144, 104);
    // cell = /16 = (9, 6.5).
    expect(viewportCenterCell(view, VP)).toEqual({ x: 9, y: 6.5 })
  })
  test('accounts for zoom', () => {
    const z: View = { panX: 0, panY: 0, zoom: 2 }
    // centre px = (160,120); world = (80,60); cell = /16 = (5, 3.75).
    expect(viewportCenterCell(z, VP)).toEqual({ x: 5, y: 3.75 })
  })
})

describe('isCellOnScreen', () => {
  test('cells whose pixel lands inside the viewport are on-screen', () => {
    expect(isCellOnScreen(view, VP, 0, 0)).toBe(true) // px (16,16)
    expect(isCellOnScreen(view, VP, 9, 6)).toBe(true) // near centre
  })
  test('cells past the right/bottom edge are off-screen', () => {
    expect(isCellOnScreen(view, VP, 100, 0)).toBe(false) // px x = 1616 > 320
    expect(isCellOnScreen(view, VP, 0, 100)).toBe(false) // px y = 1616 > 240
  })
  test('cells before the top-left edge are off-screen', () => {
    expect(isCellOnScreen(view, VP, -2, 0)).toBe(false) // px x = -16 < 0
  })
  test('zoom pushes far cells off-screen sooner', () => {
    // cell 12 at zoom 1 = px 12*16+16 = 208 (on); at zoom 2 = 12*16*2+16 = 400 (off).
    expect(isCellOnScreen({ ...view, zoom: 1 }, VP, 12, 0)).toBe(true)
    expect(isCellOnScreen({ ...view, zoom: 2 }, VP, 12, 0)).toBe(false)
  })
})

describe('stepZoomPreset', () => {
  test('a zoom sitting on a preset steps to its neighbour', () => {
    expect(stepZoomPreset(1, 1)).toBe(2)
    expect(stepZoomPreset(1, -1)).toBe(0.5)
    expect(stepZoomPreset(2, 1)).toBe(3)
  })
  test('a zoom between presets snaps to the nearest one in that direction', () => {
    expect(stepZoomPreset(1.37, 1)).toBe(2)
    expect(stepZoomPreset(1.37, -1)).toBe(1)
    expect(stepZoomPreset(0.3, -1)).toBe(0.25)
  })
  test('past either end the zoom is unchanged', () => {
    // MAX_ZOOM (6) exceeds the largest preset (4): wheel can reach 5, where
    // stepping in has nowhere to go.
    expect(stepZoomPreset(5, 1)).toBe(5)
    expect(stepZoomPreset(ZOOM_PRESETS[0]!, -1)).toBe(ZOOM_PRESETS[0])
    expect(stepZoomPreset(ZOOM_PRESETS[ZOOM_PRESETS.length - 1]!, 1)).toBe(4)
  })
  test('presets stay inside the zoom clamp range', () => {
    for (const p of ZOOM_PRESETS) {
      expect(p).toBeGreaterThanOrEqual(MIN_ZOOM)
      expect(p).toBeLessThanOrEqual(MAX_ZOOM)
    }
  })
})

describe('zoomTo', () => {
  test('assigns the target zoom exactly and keeps the anchor point fixed', () => {
    // World point under canvas (160, 120) at the old view must land there still.
    const v: View = { panX: 16, panY: 16, zoom: 1.37 }
    const next = zoomTo(v, 160, 120, 2)
    expect(next.zoom).toBe(2)
    const worldX = (160 - v.panX) / v.zoom
    const worldY = (120 - v.panY) / v.zoom
    expect(worldX * next.zoom + next.panX).toBeCloseTo(160, 9)
    expect(worldY * next.zoom + next.panY).toBeCloseTo(120, 9)
  })
  test('clamps to the zoom range', () => {
    expect(zoomTo(view, 0, 0, 100).zoom).toBe(MAX_ZOOM)
    expect(zoomTo(view, 0, 0, 0.01).zoom).toBe(MIN_ZOOM)
  })
})

describe('edgeScrollPan', () => {
  // Viewport 320x240, level 4096x2048 px at zoom 1. Pan (-1000, -500) leaves
  // plenty of level on every side.
  const mid: View = { panX: -1000, panY: -500, zoom: 1 }
  test('interior cursor leaves the pan alone', () => {
    expect(edgeScrollPan(mid, VP, 160, 120, 16)).toEqual({ panX: -1000, panY: -500 })
  })
  test('near the right/bottom edge the world scrolls in (pan decreases)', () => {
    const p = edgeScrollPan(mid, VP, VP.w - 1, VP.h - 1, 16)
    expect(p.panX).toBeLessThan(-1000)
    expect(p.panY).toBeLessThan(-500)
  })
  test('near the left/top edge the pan increases', () => {
    const p = edgeScrollPan(mid, VP, 1, 1, 16)
    expect(p.panX).toBeGreaterThan(-1000)
    expect(p.panY).toBeGreaterThan(-500)
  })
  test('speed ramps with depth and saturates past the canvas edge', () => {
    const shallow = -1000 - edgeScrollPan(mid, VP, VP.w - EDGE_SCROLL_ZONE_PX / 4, 120, 16).panX
    const deep = -1000 - edgeScrollPan(mid, VP, VP.w - 1, 120, 16).panX
    const past = -1000 - edgeScrollPan(mid, VP, VP.w + 500, 120, 16).panX
    const farPast = -1000 - edgeScrollPan(mid, VP, VP.w + 5000, 120, 16).panX
    expect(shallow).toBeGreaterThan(0)
    expect(deep).toBeGreaterThan(shallow)
    expect(past).toBe(farPast)
  })
  test('stops with the level edge one zone inside the viewport', () => {
    // Left edge: pan just under the limit clamps exactly to it.
    const nearLeft: View = { panX: EDGE_SCROLL_ZONE_PX - 1, panY: -500, zoom: 1 }
    expect(edgeScrollPan(nearLeft, VP, 0, 120, 50).panX).toBe(EDGE_SCROLL_ZONE_PX)
    // Right edge: level right side lands at VP.w - zone.
    const limit = VP.w - EDGE_SCROLL_ZONE_PX - 4096 * 2
    const nearRight: View = { panX: limit + 1, panY: -500, zoom: 2 }
    expect(edgeScrollPan(nearRight, VP, VP.w, 120, 50).panX).toBe(limit)
  })
  test('a view already panned past the limit does not snap back', () => {
    const past: View = { panX: 300, panY: -500, zoom: 1 }
    expect(edgeScrollPan(past, VP, 0, 120, 16).panX).toBe(300)
  })
})

describe('reanchorCanvasPoint', () => {
  test('maps a point to where its world point lands under the new view', () => {
    const from: View = { panX: 16, panY: 16, zoom: 1 }
    const to = zoomTo(from, 100, 80, 2)
    // (50, 40) is world (34, 24); under zoom 2 about (100, 80) it lands at
    // 34*2 + to.panX, 24*2 + to.panY.
    const p = reanchorCanvasPoint(from, to, 50, 40)
    expect(p).toEqual({ x: 34 * 2 + to.panX, y: 24 * 2 + to.panY })
  })
  test('a drag delta keeps its world meaning across a cursor-centred zoom', () => {
    // Drag from (50, 40) to the cursor at (100, 80); zoom about the cursor.
    const from: View = { panX: 16, panY: 16, zoom: 1 }
    const to = zoomTo(from, 100, 80, 3)
    const start = reanchorCanvasPoint(from, to, 50, 40)
    const worldDx = (100 - start.x) / to.zoom
    const worldDy = (80 - start.y) / to.zoom
    expect(worldDx).toBeCloseTo((100 - 50) / from.zoom)
    expect(worldDy).toBeCloseTo((80 - 40) / from.zoom)
  })
  test('pan-only change shifts the point by the pan delta', () => {
    const from: View = { panX: 0, panY: 0, zoom: 2 }
    const to: View = { panX: -30, panY: 12, zoom: 2 }
    expect(reanchorCanvasPoint(from, to, 10, 10)).toEqual({ x: -20, y: 22 })
  })
})
