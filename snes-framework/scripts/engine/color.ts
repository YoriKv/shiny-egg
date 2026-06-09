// SNES color conversion. CGRAM holds 256 palette entries × 16-bit each, in
// the SNES "BGR-15" format (bit 15 unused):
//
//   bit  15  14  13  12  11  10   9   8   7   6   5   4   3   2   1   0
//        x   b4  b3  b2  b1  b0   g4  g3  g2  g1  g0  r4  r3  r2  r1  r0
//
// i.e. each channel is 5 bits, blue at the top. The framework stores CGRAM
// as a Uint8Array (raw cart-order bytes, little-endian within each u16).
//
// # Two scaling conventions
//
// To convert a 5-bit channel value (0..31) to 8-bit RGB (0..255):
//
//   A. **Simple-shift:** `out8 = in5 << 3` — maps to 0..248, leaving the low
//      3 bits zero. Maximum white is 0xF8F8F8 rather than pure 0xFFFFFF.
//      This is what GoldenEgg's `SNES.Color.ToRGB` (SNES.cs:17-20) does, and
//      what the legacy `gfx/state.ts:bgr15ToArgb` does.
//
//   B. **Full-range expand:** `out8 = (in5 << 3) | (in5 >> 2)` — maps to
//      0..255, with pure-white SNES (`$7FFF`) → pure-white PC (`#FFFFFF`).
//      This is what Lunar Compress 2.00 introduced as the "newer method"
//      (see lc200/readme.txt §2: "results in slightly brighter colors and
//      pure white on SNES being pure white on PC").
//
// We use **B (full-range expand)** as the default because the editor should
// show true white as true white. A flag is exposed for callers that need
// to match GoldenEgg reference output exactly.

/** 5-bit → 8-bit channel expansion modes. */
export type ChannelScale = 'expand' | 'shift';

const expand5to8 = (v5: number): number => ((v5 << 3) | (v5 >>> 2)) & 0xff;
const shift5to8  = (v5: number): number => (v5 << 3) & 0xff;

/**
 * Convert a single 15-bit SNES BGR color to `{r, g, b}` 8-bit components.
 * The high bit (15) is ignored.
 */
export function bgr15ToRgb(
  c15: number,
  scale: ChannelScale = 'expand'
): { r: number; g: number; b: number } {
  const fn = scale === 'expand' ? expand5to8 : shift5to8;
  return {
    r: fn(c15 & 0x1f),
    g: fn((c15 >>> 5) & 0x1f),
    b: fn((c15 >>> 10) & 0x1f),
  };
}

/**
 * Convert to a 24-bit packed `0xRRGGBB` number — handy for CSS color
 * strings via `'#' + n.toString(16).padStart(6, '0')`.
 */
export function bgr15ToRgb24(c15: number, scale: ChannelScale = 'expand'): number {
  const { r, g, b } = bgr15ToRgb(c15, scale);
  return (r << 16) | (g << 8) | b;
}

/**
 * Convert to a 32-bit value suitable for direct write into a Uint32Array
 * view of an HTML canvas ImageData buffer (which on little-endian hosts —
 * i.e. every browser target — uses byte order R, G, B, A → packed as
 * `0xAABBGGRR` in a u32).
 *
 * `alpha` is the 0..255 alpha byte (default 255 = opaque). Pass 0 to get a
 * fully-transparent pixel (useful for "color index 0 = transparent" sprite
 * conventions).
 */
export function bgr15ToImageDataU32(
  c15: number,
  alpha = 0xff,
  scale: ChannelScale = 'expand'
): number {
  const { r, g, b } = bgr15ToRgb(c15, scale);
  // u32 view on canvas ImageData: byte order R,G,B,A → little-endian packs
  // as alpha-high, blue-mid-high, green-mid-low, red-low. `>>> 0` forces
  // unsigned 32-bit interpretation (JS bitwise ops default to signed int32,
  // so `<<24` of 0xFF would give a negative number without it).
  return (((alpha & 0xff) << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/**
 * Read one 15-bit CGRAM color from a raw byte buffer. `cgram` is little-
 * endian u16 entries (cart-order); `index` selects the palette entry
 * (0..255), not a byte offset.
 *
 * Throws if `index` would read past the buffer.
 */
export function readCgramColor(cgram: Uint8Array, index: number): number {
  const off = index * 2;
  if (off + 2 > cgram.length) {
    throw new RangeError(
      `readCgramColor: index ${index} out of range (cgram is ${cgram.length} bytes)`
    );
  }
  return cgram[off] | (cgram[off + 1] << 8);
}

/**
 * Build a palette row as a `Uint32Array` of ImageData-packable colors.
 *
 * `colorsPerRow` MUST match the bit-depth of the tile data the caller will
 * use this palette with:
 *   - 4bpp (BG1, BG2, sprites in standard modes): 16 colors per row →
 *     CGRAM offset = `paletteRow * 16`.
 *   - 2bpp (BG3 in mode 1, BG4 in mode 0): 4 colors per row → CGRAM offset =
 *     `paletteRow * 4`.
 * Defaults to 16 for backwards compatibility with existing 4bpp callers.
 *
 * **Stride matters: a 2bpp BG3 tile with `palRow > 0` will read the wrong
 * colors if you pass `colorsPerRow = 16`.** The cart packs 2bpp palette
 * rows tightly (row N = CGRAM[N*4..N*4+3]); reading at N*16 lands you in
 * what the cart treats as a different palette row entirely.
 *
 * `transparent0 = true` makes the first entry fully-transparent regardless
 * of its CGRAM color — the SNES convention for sprite and BG2/BG3 layers
 * (BG1 is opaque). The remaining entries are always opaque.
 */
export function buildPaletteRow(
  cgram: Uint8Array,
  paletteRow: number,
  transparent0: boolean,
  scale: ChannelScale = 'expand',
  colorsPerRow: number = 16
): Uint32Array {
  const out = new Uint32Array(colorsPerRow);
  const base = paletteRow * colorsPerRow;
  for (let i = 0; i < colorsPerRow; i++) {
    const c = readCgramColor(cgram, base + i);
    const alpha = i === 0 && transparent0 ? 0 : 0xff;
    out[i] = bgr15ToImageDataU32(c, alpha, scale);
  }
  return out;
}
