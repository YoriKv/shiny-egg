// Per-level backdrop renderer — the vertical color band drawn behind BG3.
//
// Two modes per LevelHeaderBackgroundColor (header[0]):
//
//   < $10 : SOLID — backdrop is CGRAM[0] (a single color), drawn as a flat
//           fill behind every layer. This is the LegacyGoldenEgg-equivalent
//           else branch (which GoldenEgg had wrapped in dead code; we
//           implement it because the cart actually does it).
//
//   >= $10: GRADIENT — 24-stop BGR-15 vertical gradient interpolated
//           across the full level extent (max 2048 px tall).
//
// # Cart-side gradient
//
// The cart's `hdma_and_gradient_init` (`CODE_hdma_and_gradient_init` at
// `yi/Banks/Bank01.asm:10921`) reads `bg_gradient_ptrs` (DATA_bg_gradient_ptrs) —
// 16 entries × 4 bytes each — indexed by `(BackgroundColor - $10)`. Each
// entry packs a 24-bit SNES pointer as `dw bank, dw offset`. The pointed-at
// target is 24 × u16 BGR-15 colors, ordered **bottom-of-level to top**
// (per the Bank57 author comment).
//
// At runtime the cart generates the per-scanline gradient using SuperFX
// FXCODE_0890E7, writing to `$70:5800` and HDMA'ing it into per-row
// COLDATA writes. We replicate that generator's math offline in TS.
//
// # Interpolation shape
//
// The 24 keyframes form 23 adjacent-pair segments; each is subdivided into 16
// sub-steps → 368 ramp entries stretched across the full level extent (no padding):
//   entry[seg*16 + 0]      = color[23 - seg]                (top-to-bottom)
//   entry[seg*16 + 1..15]  = 5-bit-truncated lerp toward color[23 - seg - 1]
// so entry 0 = color[23] at the level top and the last entry ≈ color[0] at the
// bottom. There is deliberately NO top/bottom padding: the cart streams the same
// 24-keyframe ramp edge-to-edge, so the gradient is only flat at the ends where the
// preset's own edge keyframes are flat. (An earlier port baked in ~288 px flat
// top/bottom bands that aren't in the cart data.)
//
// Each sub-step lerps the 5-bit BGR channels with INTEGER TRUNCATION (no rounding,
// no dither): `v_k = base + ((delta * k) >> 4)`, k = 0..15 — exactly what the cart's
// SuperFX generator (FXCODE_0890E7) does, where `>> 4` floors like the GSU's FMULT.
// That 5-bit quantization is the whole point: it is what makes the in-game sky
// visibly BANDED (horizontal stripes), and a smooth 8-bit-rounded ramp (the old
// behaviour) washed the bands out. We then expand each banded 5-bit value to RGB888
// the same way every other editor swatch does, so a band matches a CGRAM swatch of
// the same value.
//
// NOTE: the cart's gradient is screen-fixed (HDMA per-scanline, identical every
// frame regardless of camera). We approximate it as a single world-space ramp across
// the level, so per-screen band thickness is not 1:1 — but the band colors, the
// 5-bit quantization, and the edge behaviour are faithful.
//
// Output is a 1×2048 RGBA bitmap (consumer tiles horizontally).

import type { SymbolMap } from './symbol-map.ts';
import { snesToPC } from './symbol-map.ts';
import { bgr15ToRgb } from './color.ts';
import { u16le } from './rom-read.ts';

export const LEVEL_HEIGHT_PX = 2048;
const GRADIENT_THRESHOLD = 0x10;
/** Colors per gradient table (24 BGR-15 stops, bottom-to-top). */
export const GRADIENT_COLOR_COUNT = 24;
/** Gradient tables in `DATA_bg_gradient_ptrs` — one per BackgroundColor $10..$1F. */
export const GRADIENT_TABLE_COUNT = 16;

/** The gradient-table index (0..15) a level's BackgroundColor header byte selects,
 *  or `null` when the level uses a solid backdrop (BackgroundColor < $10). */
export function gradientIdForBgColor(backgroundColor: number): number | null {
  return backgroundColor >= GRADIENT_THRESHOLD ? backgroundColor - GRADIENT_THRESHOLD : null;
}
const GRADIENT_BYTES = GRADIENT_COLOR_COUNT * 2;
// The cart subdivides each adjacent keyframe pair into 16 interpolation sub-steps,
// so 23 segments × 16 = 368 ramp entries cover the whole gradient — no flat padding
// (see renderGradientColumn). The strip is then stretched across LEVEL_HEIGHT_PX.
const ENTRIES_PER_SEGMENT = 16;
const GRADIENT_SEGMENTS = GRADIENT_COLOR_COUNT - 1; // 23
const STRIP_ENTRIES = GRADIENT_SEGMENTS * ENTRIES_PER_SEGMENT; // 368

export type Backdrop =
  | { kind: 'solid'; color15: number }
  | {
      kind: 'gradient';
      rgba: Uint8Array;
      width: number;
      height: number;
      /** The 24 effective BGR-15 keyframes (bottom→top) this gradient was built
       *  from — base ⊕ any live override. Exposed so a screen-relative consumer
       *  (the editor's Camera Preview) can re-band them at a different height. */
      stops: number[];
    };

/**
 * Build the per-level backdrop. CGRAM must already be populated by
 * `loadLevelPalettes` (we read CGRAM[0] for the solid case).
 *
 * `overrideColors` (24 BGR-15 stops) replaces the ROM-read gradient when present —
 * the live-preview seam for the Palette panel's gradient editor (so an unsaved
 * gradient draft previews on the canvas without a rebuild, independent of the
 * built ROM, exactly like `paletteOverride` does for CGRAM colors). Ignored for
 * solid backdrops and when the wrong length.
 */
export function buildBackdrop(
  rom: Uint8Array,
  symbols: SymbolMap,
  cgram: Uint8Array,
  backgroundColor: number,
  overrideColors?: readonly number[]
): Backdrop {
  if (backgroundColor < GRADIENT_THRESHOLD) {
    return {
      kind: 'solid',
      color15: u16le(cgram, 0)
    };
  }

  const colors15 =
    overrideColors && overrideColors.length === GRADIENT_COLOR_COUNT
      ? Uint16Array.from(overrideColors, (c) => c & 0xffff)
      : readGradientColors(rom, symbols, backgroundColor);
  const rgba = renderGradientColumn(colors15);
  return { kind: 'gradient', rgba, width: 1, height: LEVEL_HEIGHT_PX, stops: Array.from(colors15) };
}

function readGradientColors(
  rom: Uint8Array,
  symbols: SymbolMap,
  backgroundColor: number
): Uint16Array {
  const tableBase = symbols.pc('DATA_bg_gradient_ptrs');
  const entryIdx = backgroundColor - GRADIENT_THRESHOLD;
  if (entryIdx < 0 || entryIdx >= 16) {
    throw new RangeError(
      `buildBackdrop: BackgroundColor $${backgroundColor.toString(16)} out of gradient range (need $10..$1F)`
    );
  }
  const entryOff = tableBase + entryIdx * 4;
  // Entry layout: `dw bank, dw offset` (each dw is LE u16)
  //   bytes 0-1 = bank word (high byte 0; low byte is the SNES bank)
  //   bytes 2-3 = offset word LE
  const bank = rom[entryOff];
  const offset = u16le(rom, entryOff + 2);
  // Targets live in SuperFX HiROM bank $5F — snesToPC handles that mapping.
  const srcPC = snesToPC((bank << 16) | offset);
  if (srcPC < 0 || srcPC + GRADIENT_BYTES > rom.length) {
    throw new RangeError(
      `buildBackdrop: gradient src PC $${srcPC.toString(16)} out of ROM`
    );
  }
  const colors = new Uint16Array(GRADIENT_COLOR_COUNT);
  for (let i = 0; i < GRADIENT_COLOR_COUNT; i++) {
    colors[i] = u16le(rom, srcPC + i * 2);
  }
  return colors;
}

/**
 * Interpolate 24 BGR-15 endpoint colors into a 512-entry RGBA strip
 * (one entry per 4 vertical pixels), then expand to a 1×2048 RGBA bitmap.
 *
 * `colors15[0]` = bottom-of-level color; `colors15[23]` = top.
 */
function renderGradientColumn(colors15: Uint16Array): Uint8Array {
  // Step 1: build the 368-entry RGB888 ramp strip indexed TOP-TO-BOTTOM
  // (entry 0 = colors15[23] at the level top; last entry ≈ colors15[0] at the
  // bottom). No padding — the ramp is the whole strip.
  const strip = new Uint8Array(STRIP_ENTRIES * 3);

  // Write a BGR-15 color into strip entry `e`, expanded to RGB888 the same way
  // every other editor swatch is (bgr15ToRgb 'expand') — so a gradient band of a
  // given 5-bit value matches a CGRAM swatch of that value.
  const writeEntry = (e: number, c15: number): void => {
    const { r, g, b } = bgr15ToRgb(c15);
    strip[e * 3 + 0] = r;
    strip[e * 3 + 1] = g;
    strip[e * 3 + 2] = b;
  };

  // Endpoint colors as 5-bit BGR channels — the interpolation runs in 5-bit space.
  const ep = Array.from(colors15, (c15) => ({
    r: c15 & 0x1f,
    g: (c15 >>> 5) & 0x1f,
    b: (c15 >>> 10) & 0x1f
  }));

  // 23 sub-segments × 16 entries, walking colors15[23] → colors15[0] top-to-bottom.
  // Each sub-step is an INTEGER-TRUNCATED 5-bit lerp — `v_k = base + ((delta*k) >> 4)`,
  // k = 0..15, masked to 5 bits — matching the cart's SuperFX generator FXCODE_0890E7.
  // The truncation (NOT rounding) is what bands the sky into horizontal stripes; see
  // the file header. (`>> 4` floors for a decreasing channel like the GSU's FMULT.)
  for (let seg = 0; seg < GRADIENT_SEGMENTS; seg++) {
    const from = ep[GRADIENT_COLOR_COUNT - 1 - seg];
    const to = ep[GRADIENT_COLOR_COUNT - 1 - (seg + 1)];
    const dr = to.r - from.r;
    const dg = to.g - from.g;
    const db = to.b - from.b;
    for (let k = 0; k < ENTRIES_PER_SEGMENT; k++) {
      const r = (from.r + ((dr * k) >> 4)) & 0x1f;
      const g = (from.g + ((dg * k) >> 4)) & 0x1f;
      const b = (from.b + ((db * k) >> 4)) & 0x1f;
      writeEntry(seg * ENTRIES_PER_SEGMENT + k, r | (g << 5) | (b << 10));
    }
  }

  // Step 2: expand to 1×LEVEL_HEIGHT_PX RGBA — the 368-entry ramp stretched across
  // the full level extent (no padding); entry pitch is fractional (~5.57 px).
  const rgba = new Uint8Array(LEVEL_HEIGHT_PX * 4);
  for (let y = 0; y < LEVEL_HEIGHT_PX; y++) {
    let e = ((y * STRIP_ENTRIES) / LEVEL_HEIGHT_PX) | 0;
    if (e >= STRIP_ENTRIES) e = STRIP_ENTRIES - 1;
    rgba[y * 4 + 0] = strip[e * 3 + 0];
    rgba[y * 4 + 1] = strip[e * 3 + 1];
    rgba[y * 4 + 2] = strip[e * 3 + 2];
    rgba[y * 4 + 3] = 0xff;
  }
  return rgba;
}
