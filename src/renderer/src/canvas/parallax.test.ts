import { describe, it, expect } from 'vitest'
import {
  parallaxOffsets,
  cameraOrigin,
  applyCameraSnap,
  clampCamera,
  clampPanToCamera,
  CAMERA_W,
  CAMERA_H,
  type ParallaxRates
} from './parallax'

const FLOOR = 1824

describe('parallaxOffsets — horizontal', () => {
  it('rate $0100 (1:1) locks the layer to BG1 — zero X offset', () => {
    const r: ParallaxRates = { bg2X: 0x0100, bg2Y: 0x0100, bg3X: 0x0100, bg3Y: 0x0100 }
    expect(parallaxOffsets(1000, 500, r, FLOOR).bg2.x).toBe(0)
  })
  it('rate $0080 (½) lags by half the camera X', () => {
    const r: ParallaxRates = { bg2X: 0x0080, bg2Y: 0x0040, bg3X: 0x0040, bg3Y: 0x0040 }
    // HOFS = camX/2 → offset = camX - camX/2 = camX/2
    expect(parallaxOffsets(1000, 500, r, FLOOR).bg2.x).toBe(500)
    // bg3 rate $0040 (¼) → HOFS = camX/4 → offset = 3/4 camX
    expect(parallaxOffsets(1000, 500, r, FLOOR).bg3.x).toBe(750)
  })
  it('rate $0000 (static) pins the layer to the screen — full camera X offset', () => {
    const r: ParallaxRates = { bg2X: 0x0000, bg2Y: 0x0000, bg3X: 0x0000, bg3Y: 0x0000 }
    expect(parallaxOffsets(1234, 500, r, FLOOR).bg2.x).toBe(1234)
  })
})

describe('parallaxOffsets — vertical', () => {
  it('rate $FFFF locks Y 1:1 to the camera — zero Y offset', () => {
    const r: ParallaxRates = { bg2X: 0x0080, bg2Y: 0xffff, bg3X: 0x0040, bg3Y: 0xffff }
    const o = parallaxOffsets(1000, 700, r, FLOOR)
    expect(o.bg2.y).toBe(0)
    expect(o.bg3.y).toBe(0)
  })
  it('rate $0000 leaves Y anchored to the screen (VOFS = anchor)', () => {
    const r: ParallaxRates = { bg2X: 0, bg2Y: 0x0000, bg3X: 0, bg3Y: 0x0000 }
    // VOFS = anchorBG2 ($0326) → offset = camY - $0326
    expect(parallaxOffsets(0, 900, r, FLOOR).bg2.y).toBe(900 - 0x0326)
    expect(parallaxOffsets(0, 900, r, FLOOR).bg3.y).toBe(900 - 0x0126)
  })
  it('fractional rate uses the floor-baselined formula', () => {
    const r: ParallaxRates = { bg2X: 0, bg2Y: 0x0040, bg3X: 0, bg3Y: 0x0040 }
    // VOFS = $0326 - ((FLOOR - camY) * $40 >> 8); camY = FLOOR → VOFS = anchor
    expect(parallaxOffsets(0, FLOOR, r, FLOOR).bg2.y).toBe(FLOOR - 0x0326)
  })
})

describe('parallaxOffsets — gradient scroll', () => {
  it('gradient scrolls at 1/8 the camera Y (camY >> 3)', () => {
    const r: ParallaxRates = { bg2X: 0, bg2Y: 0, bg3X: 0, bg3Y: 0 }
    expect(parallaxOffsets(0, 800, r, FLOOR).gradientScroll).toBe(100)
    expect(parallaxOffsets(0, 7, r, FLOOR).gradientScroll).toBe(0)
  })
})

describe('cameraOrigin — centered box', () => {
  it('the box is centred in the viewport; origin inverts the pan', () => {
    const size = { w: 1000, h: 800 }
    // zoom 1, pan 0 → box top-left world = viewport-center - half-box
    const o = cameraOrigin({ panX: 0, panY: 0, zoom: 1 }, size)
    expect(o.x).toBe(size.w / 2 - CAMERA_W / 2)
    expect(o.y).toBe(size.h / 2 - CAMERA_H / 2)
  })
  it('panning moves the camera over the level (pan subtracts)', () => {
    const size = { w: 1000, h: 800 }
    const base = cameraOrigin({ panX: 0, panY: 0, zoom: 1 }, size)
    const panned = cameraOrigin({ panX: -200, panY: -100, zoom: 1 }, size)
    expect(panned.x - base.x).toBe(200)
    expect(panned.y - base.y).toBe(100)
  })
  it('zoom scales the inverse so the box stays the camera size', () => {
    const size = { w: 1024, h: 768 }
    // At zoom 2, the world span across the viewport halves, so the camera origin
    // shifts inward by half the viewport-world delta vs zoom 1.
    const z1 = cameraOrigin({ panX: 0, panY: 0, zoom: 1 }, size)
    const z2 = cameraOrigin({ panX: 0, panY: 0, zoom: 2 }, size)
    expect(z1.x).toBe(1024 / 2 - CAMERA_W / 2)
    expect(z2.x).toBe(1024 / 2 / 2 - CAMERA_W / 2)
  })
})

describe('applyCameraSnap', () => {
  it("'v' snaps X to the camera-width (256) grid, leaves Y", () => {
    expect(applyCameraSnap({ x: 300, y: 411 }, 'v')).toEqual({ x: 256, y: 411 })
    expect(applyCameraSnap({ x: 400, y: 411 }, 'v')).toEqual({ x: 512, y: 411 })
  })
  it("'h' snaps Y to floor-anchored screen rows (bottom row = $070C), leaves X", () => {
    expect(applyCameraSnap({ x: 300, y: 1804 }, 'h')).toEqual({ x: 300, y: 0x070c }) // floor
    expect(applyCameraSnap({ x: 300, y: 1900 }, 'h')).toEqual({ x: 300, y: 0x070c }) // clamped to floor
    expect(applyCameraSnap({ x: 300, y: 1548 }, 'h')).toEqual({ x: 300, y: 0x070c - 256 }) // one row up
    expect(applyCameraSnap({ x: 300, y: 100 }, 'h')).toEqual({ x: 300, y: 0x070c - 7 * 256 }) // 7 rows up
  })
  it("'none' leaves the camera unchanged", () => {
    expect(applyCameraSnap({ x: 300, y: 411 }, 'none')).toEqual({ x: 300, y: 411 })
  })
})

describe('clampCamera', () => {
  const W = 4096
  const H = 2048 // → camX ∈ [0, 3840], camY ∈ [0, 1824]
  it('clamps the 256×224 camera rect inside the level extent', () => {
    expect(clampCamera({ x: -50, y: 100 }, W, H)).toEqual({ x: 0, y: 100 })
    expect(clampCamera({ x: 5000, y: 100 }, W, H)).toEqual({ x: W - CAMERA_W, y: 100 })
    expect(clampCamera({ x: 100, y: -50 }, W, H)).toEqual({ x: 100, y: 0 })
    expect(clampCamera({ x: 100, y: 3000 }, W, H)).toEqual({ x: 100, y: H - CAMERA_H })
  })
  it('leaves an in-bounds camera unchanged', () => {
    expect(clampCamera({ x: 1000, y: 500 }, W, H)).toEqual({ x: 1000, y: 500 })
  })
})

describe('clampPanToCamera', () => {
  // The pan-lock counterpart to clampCamera: it must hold the pan at the same limit
  // the drawn box respects, so the level can't scroll under a stuck box. The
  // load-bearing property is round-trip exactness — feeding the returned pan back
  // into cameraOrigin reproduces the CLAMPED origin dead-on (cameraOrigin rounds to
  // integer world px, so the camera delta is whole and the pan shift is exact).
  const SIZE = { w: 800, h: 600 }
  it('leaves an in-bounds camera pan untouched', () => {
    // panX=panY=0 → cameraOrigin (72, 38), inside a 4096×2048 level.
    const view = { panX: 0, panY: 0, zoom: 2 }
    expect(clampPanToCamera(view, SIZE, 4096, 2048)).toEqual({ panX: 0, panY: 0 })
  })
  it('pulls the pan back so the camera stops exactly at the left/top edge', () => {
    // panX=panY=344 → cameraOrigin (-100, -172), off the left/top; lock to origin 0.
    const view = { panX: 344, panY: 344, zoom: 2 }
    const locked = clampPanToCamera(view, SIZE, 4096, 2048)
    expect(cameraOrigin({ ...view, ...locked }, SIZE)).toEqual({ x: 0, y: 0 })
  })
  it('pulls the pan back so the camera stops exactly at the right/bottom edge', () => {
    // A 512×352 level → camera max origin (256, 128); panX=panY=-400 overshoots both.
    const view = { panX: -400, panY: -400, zoom: 2 }
    const locked = clampPanToCamera(view, SIZE, 512, 352)
    expect(cameraOrigin({ ...view, ...locked }, SIZE)).toEqual({
      x: 512 - CAMERA_W,
      y: 352 - CAMERA_H
    })
  })
  it('is idempotent — clamping an already-locked pan is a no-op', () => {
    const view = { panX: 344, panY: -400, zoom: 3 }
    const once = clampPanToCamera(view, SIZE, 512, 352)
    const twice = clampPanToCamera({ ...view, ...once }, SIZE, 512, 352)
    expect(twice).toEqual(once)
  })
  it('holds ONE pan while pushing further past the edge (no ±1px jitter)', () => {
    // Every off-bounds drag target must clamp to the SAME held pan. The old
    // rounded-origin correction sawtoothed between two values across these inputs
    // (−7536 / −7535 at zoom 2), jittering the level under the fixed box.
    const held = new Set(
      [-8000, -8001, -8002, -8003, -8100].map(
        (panX) => clampPanToCamera({ panX, panY: 0, zoom: 2 }, SIZE, 4096, 2048).panX
      )
    )
    expect(held.size).toBe(1)
  })
})
