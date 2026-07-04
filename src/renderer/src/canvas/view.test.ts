// Pins the paste-on-screen geometry — viewportCenterCell (where an off-screen
// paste retargets to) and isCellOnScreen (the off-screen check) — plus the
// zoom-preset stepping (the toolbar dropdown / Shift+wheel stops) and the
// fixed-point rule of zoomTo. Pure functions over the camera transform
// `screen = cell * CELL_PX * zoom + pan`.
//
// Run via Vitest (renderer config): `pnpm run test:renderer`.

import { describe, test, expect } from 'vitest'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_PRESETS,
  isCellOnScreen,
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
