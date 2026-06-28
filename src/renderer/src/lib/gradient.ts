// Pure colour-math for the backdrop-gradient editor (24 BGR-15 stops). Kept
// separate from the React hook + panel so the "fill gradient" generation is
// unit-testable and side-effect-free.

/** BGR-15 black (a stop the "clear" sets and "fill" treats as an empty slot). */
export const GRADIENT_BLACK = 0x0000

/** Stops per gradient table (mirrors the framework's GRADIENT_STOPS; the renderer
 *  can't import framework value modules, so the constant is duplicated here). */
export const GRADIENT_STOPS = 24
/** Bytes per table in the flat gradient-edit offset space (24 words × 2). */
export const GRADIENT_STRIDE_BYTES = GRADIENT_STOPS * 2

/** Flat gradient-edit byte offset for table `gradientId`, stop `stop`. */
export function gradientOffset(gradientId: number, stop: number): number {
  return gradientId * GRADIENT_STRIDE_BYTES + stop * 2
}

/** Linear-interpolate two BGR-15 colours per 5-bit channel at `t` ∈ [0,1]. */
export function lerpBgr15(a: number, b: number, t: number): number {
  const ar = a & 0x1f
  const ag = (a >>> 5) & 0x1f
  const ab = (a >>> 10) & 0x1f
  const br = b & 0x1f
  const bg = (b >>> 5) & 0x1f
  const bb = (b >>> 10) & 0x1f
  const mix = (x: number, y: number): number => Math.round(x + (y - x) * t) & 0x1f
  return mix(ab, bb) << 10 | mix(ag, bg) << 5 | mix(ar, br)
}

/**
 * "Fill gradient": find sequential pairs of non-black stops and linearly
 * interpolate the (black) stops between each pair. Stops at or outside the first
 * and last non-black anchors are left unchanged. With fewer than two anchors
 * there's nothing to interpolate → the input is returned unchanged.
 *
 * Returns a NEW 24-length array (the input is not mutated).
 */
export function fillGradient(colors: readonly number[]): number[] {
  const out = colors.slice()
  const anchors: number[] = []
  for (let i = 0; i < out.length; i++) if (out[i] !== GRADIENT_BLACK) anchors.push(i)
  for (let k = 0; k + 1 < anchors.length; k++) {
    const a = anchors[k]!
    const b = anchors[k + 1]!
    if (b - a < 2) continue // adjacent anchors — nothing between to fill
    for (let i = a + 1; i < b; i++) {
      out[i] = lerpBgr15(out[a]!, out[b]!, (i - a) / (b - a))
    }
  }
  return out
}
