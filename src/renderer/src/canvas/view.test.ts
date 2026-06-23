// Pins the paste-on-screen geometry: viewportCenterCell (where an off-screen
// paste retargets to) and isCellOnScreen (the off-screen check). Pure functions
// over the camera transform `screen = cell * CELL_PX * zoom + pan`.
//
// Run via Vitest (renderer config): `pnpm run test:renderer`.

import { describe, test, expect } from 'vitest'
import { isCellOnScreen, viewportCenterCell, type View } from './view'

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
