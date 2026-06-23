// Static rotozoom rasterizer — reproduces a GSU rotozoom-plotted dynamic body offline, so the editor
// can render bodies the rigid flat decoder can't (rotation and/or fractional scale). It decodes the
// un-transformed chunky texture FROM THE CART (never baked pixels), then applies the same rotation +
// scale the GSU applies, using transform params (angle/scale) captured by the yi-shiny
// `dynbody-transform` trace (see research/dynbody-transform-trace-spec.md).
//
// Convention CALIBRATED against captures (tmp/rotozoom-calib.ts → moved here): identity ($09E) = 100%,
// pure-scale ($07A scale≈1.98×) = 97%. The GSU's rotation handedness is rotSign −1.
//
// Angle units: 256 per full turn (a quarter-turn = 64). Scale is 8.8 fixed ($0100 = 1.0). cos/sin come
// from the cart quarter-turn 16-bit cosine LUT `DATA_08AB98` (DATA_cos_table), reflected per quadrant.

import type { SymbolMap } from './symbol-map.ts';

const SHEET_STRIDE = 0x100; // the chunky sheet is 256 bytes/row (same as BITMAP_ROW_STRIDE)

/** The cart's quarter-turn cosine LUT (`DATA_08AB98` / `DATA_cos_table`): 65 entries 0..64 = 0..90°,
 *  8.8 fixed ($0100=1.0 → 0). Embedded (not read from the cart) because the texture source IS read
 *  from the cart but this is a version-stable MATH table, and the editor's vendored V1.0 symbol map
 *  has no SuperFX-side labels to resolve it. `rotozoom.test.ts` asserts it byte-matches the cart. */
export const COS_LUT_SYMBOL = 'DATA_08AB98';
export const QUARTER_COS: readonly number[] = [
  256, 256, 256, 255, 255, 254, 253, 252, 251, 250, 248, 247, 245, 243, 241, 239,
  237, 234, 231, 229, 226, 223, 220, 216, 213, 209, 206, 202, 198, 194, 190, 185,
  181, 177, 172, 167, 162, 157, 152, 147, 142, 137, 132, 126, 121, 115, 109, 104,
  98, 92, 86, 80, 74, 68, 62, 56, 50, 44, 38, 31, 25, 19, 13, 6, 0
];
/** cos(angle), angle 0..255 (256/turn), 8.8 fixed (−256..256), via quarter-turn quadrant reflection. */
function cosF(a: number): number {
  a = ((a % 256) + 256) % 256;
  const quad = a >> 6, i = a & 63;
  switch (quad) { case 0: return QUARTER_COS[i]!; case 1: return -QUARTER_COS[64 - i]!; case 2: return -QUARTER_COS[i]!; default: return QUARTER_COS[64 - i]!; }
}
const sinF = (a: number): number => cosF((a + 192) & 255); // sin(a) = cos(a − 90deg)

export interface RotozoomParams {
  /** Rotation, 0..255 (256 = full turn). 0 = none. */
  angle: number;
  /** Scale, 8.8 fixed: $0100 (256) = 1.0; larger = body drawn bigger. */
  scale: number;
  /** GSU rotation handedness; default −1 (calibrated). */
  rotSign?: number;
}

export interface RotozoomResult { indices: Uint8Array; width: number; height: number; }

/**
 * Rasterize the `srcW×srcH` chunky body at `srcPC` (a 256-stride sheet) under the rotozoom transform.
 * Each output pixel inverse-maps into the source rect [0,srcW)×[0,srcH) (clamped — sampling outside =
 * transparent, so adjacent sheet data never bleeds in), sampled nearest-neighbour. Returns the
 * transformed body; the caller places it like any decoded body (the layer slides it into position).
 */
export function rotozoomDecode(
  rom: Uint8Array, _symbols: SymbolMap, srcPC: number,
  srcW: number, srcH: number, high: boolean, p: RotozoomParams
): RotozoomResult {
  const c = cosF(p.angle) / 256;
  const s = (sinF(p.angle) / 256) * (p.rotSign ?? -1);
  const inv = 256 / p.scale;                       // source-units per output pixel
  const W = Math.ceil(Math.max(srcW, srcH) * (p.scale / 256) * 1.5) + 2, H = W;
  const u0 = srcW / 2, v0 = srcH / 2;
  const out = new Uint8Array(W * H);
  for (let oy = 0; oy < H; oy++) for (let ox = 0; ox < W; ox++) {
    const dx = ox - W / 2, dy = oy - H / 2;
    const u = Math.round((dx * c + dy * s) * inv + u0);
    const v = Math.round((-dx * s + dy * c) * inv + v0);
    if (u < 0 || u >= srcW || v < 0 || v >= srcH) continue;
    const b = rom[srcPC + v * SHEET_STRIDE + u] ?? 0;
    out[oy * W + ox] = (high ? (b >> 4) : b) & 0x0f;
  }
  return { indices: out, width: W, height: H };
}
