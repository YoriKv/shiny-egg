// Screen-relative banded sky gradient for the Camera Preview. Ports the cart's
// 5-bit-truncated keyframe interpolation (snes-framework/scripts/engine/backdrop.ts)
// at ONE entry per scanline, so the camera box can show the full 24-keyframe ramp
// (and scroll it by camY/8) instead of the level-stretched strip used in the normal
// view. Pure.

const SEGMENTS = 23 // 24 keyframes → 23 adjacent-pair segments
const SUBSTEPS = 16 // the cart subdivides each segment into 16 sub-steps
/** Flat block of the TOP keyframe color the cart's gradient generator emits
 *  BEFORE the interpolated ramp — `IWT R12, #$0046` (= 70 entries) at the tail of
 *  CODE_0890E7 (yi/SuperFX/Banks/Bank08.asm), written to the buffer START. The
 *  HDMA streams the buffer top→bottom (one entry per scanline), so these are the
 *  flat sky band ABOVE the gradient — the first thing on screen near the level
 *  ceiling. Empirically confirmed: gradient_wram.bin shows a 70-entry constant run
 *  at offset 0 before the ramp begins (so the full cart buffer is 70 + 368 = 438
 *  entries = its $1B6-byte blue stream). Omitting it shifted the preview sky up by
 *  70 scanlines vs the game. */
const TOP_PAD_ENTRIES = 70
/** Height of the banded ramp, in scanline entries (one per scanline) — the cart's
 *  full per-scanline gradient buffer: 70 flat top entries + 23×16 interpolated. */
export const GRADIENT_RAMP_HEIGHT = TOP_PAD_ENTRIES + SEGMENTS * SUBSTEPS // 438

const expand5 = (v: number): number => ((v << 3) | (v >>> 2)) & 0xff

/**
 * Build a 438-entry RGB ramp (3 bytes/entry) from 24 BGR-15 keyframes (bottom→top),
 * mirroring the cart's per-scanline gradient buffer. Entries 0..69 are a flat block
 * of the top keyframe (the cart's 70-entry top pad — see TOP_PAD_ENTRIES); entries
 * 70..437 are the interpolated ramp (entry 70 ≈ top keyframe, last entry ≈ bottom
 * keyframe). Each sub-step is an integer-truncated 5-bit lerp (`v_k = base +
 * ((delta*k) >> 4)`), matching the cart's SuperFX gradient generator — so the bands
 * line up with the in-game sky.
 */
export function buildBandedGradient(stops: readonly number[]): Uint8Array {
  const out = new Uint8Array(GRADIENT_RAMP_HEIGHT * 3)
  const ch = (c15: number): [number, number, number] => [
    c15 & 0x1f,
    (c15 >>> 5) & 0x1f,
    (c15 >>> 10) & 0x1f
  ]
  // Flat top-color pad (entries 0..TOP_PAD_ENTRIES-1) = the top keyframe (stops[23]),
  // expanded to RGB888 the same way the interpolated entries are.
  const [pr, pg, pb] = ch(stops[23] ?? 0).map(expand5) as [number, number, number]
  for (let e = 0; e < TOP_PAD_ENTRIES; e++) {
    out[e * 3 + 0] = pr
    out[e * 3 + 1] = pg
    out[e * 3 + 2] = pb
  }
  let e = TOP_PAD_ENTRIES
  for (let seg = 0; seg < SEGMENTS; seg++) {
    const [fr, fg, fb] = ch(stops[23 - seg] ?? 0)
    const [tr, tg, tb] = ch(stops[23 - (seg + 1)] ?? 0)
    const dr = tr - fr
    const dg = tg - fg
    const db = tb - fb
    for (let k = 0; k < SUBSTEPS; k++) {
      out[e * 3 + 0] = expand5((fr + ((dr * k) >> 4)) & 0x1f)
      out[e * 3 + 1] = expand5((fg + ((dg * k) >> 4)) & 0x1f)
      out[e * 3 + 2] = expand5((fb + ((db * k) >> 4)) & 0x1f)
      e++
    }
  }
  return out
}
