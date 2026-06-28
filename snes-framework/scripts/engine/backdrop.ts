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
// COLDATA writes. We replace that with offline linear interpolation in TS.
//
// # Interpolation shape
//
// Matching GoldenEgg's port (which produces visually correct gradients
// when compared against BizHawk screenshots):
//
//   - 384 interpolated entries cover the middle 1536 px (4 px per entry)
//   - Top 72 entries (288 px) padded with the topmost color (= color[23])
//   - Bottom 56 entries (224 px) padded with the bottommost color (= color[0])
//   - Total 512 entries × 4 px/entry = 2048 px = max level height
//
// The 384 entries break down as 24 sub-segments × 16 entries each:
//   entry[seg*16 + 0]      = color[23 - seg]                (top-to-bottom)
//   entry[seg*16 + 1..15]  = linear lerp toward color[23 - seg - 1]
//
// Output is a 1×2048 RGBA bitmap (consumer tiles horizontally).

import type { SymbolMap } from './symbol-map.ts';
import { snesToPC } from './symbol-map.ts';
import { bgr15ToRgb } from './color.ts';
import { u16le } from './rom-read.ts';

export const LEVEL_HEIGHT_PX = 2048;
const GRADIENT_THRESHOLD = 0x10;
/** Colours per gradient table (24 BGR-15 stops, bottom-to-top). */
export const GRADIENT_COLOR_COUNT = 24;
/** Gradient tables in `DATA_bg_gradient_ptrs` — one per BackgroundColor $10..$1F. */
export const GRADIENT_TABLE_COUNT = 16;

/** The gradient-table index (0..15) a level's BackgroundColor header byte selects,
 *  or `null` when the level uses a solid backdrop (BackgroundColor < $10). */
export function gradientIdForBgColor(backgroundColor: number): number | null {
  return backgroundColor >= GRADIENT_THRESHOLD ? backgroundColor - GRADIENT_THRESHOLD : null;
}
const GRADIENT_BYTES = GRADIENT_COLOR_COUNT * 2;
const ENTRIES_PER_COLOR = 16;
const PAD_TOP_ENTRIES = 72;
const PAD_BOTTOM_ENTRIES = 56;
const INTERP_ENTRIES = GRADIENT_COLOR_COUNT * ENTRIES_PER_COLOR; // 384
const TOTAL_ENTRIES = PAD_TOP_ENTRIES + INTERP_ENTRIES + PAD_BOTTOM_ENTRIES; // 512
const PIXELS_PER_ENTRY = LEVEL_HEIGHT_PX / TOTAL_ENTRIES; // 4

if (TOTAL_ENTRIES * PIXELS_PER_ENTRY !== LEVEL_HEIGHT_PX) {
  throw new Error('backdrop.ts: gradient layout constants do not add up to LEVEL_HEIGHT_PX');
}

export type Backdrop =
  | { kind: 'solid'; color15: number }
  | { kind: 'gradient'; rgba: Uint8Array; width: number; height: number };

/**
 * Build the per-level backdrop. CGRAM must already be populated by
 * `loadLevelPalettes` (we read CGRAM[0] for the solid case).
 *
 * `overrideColors` (24 BGR-15 stops) replaces the ROM-read gradient when present —
 * the live-preview seam for the Palette panel's gradient editor (so an unsaved
 * gradient draft previews on the canvas without a rebuild, independent of the
 * built ROM, exactly like `paletteOverride` does for CGRAM colours). Ignored for
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
  return { kind: 'gradient', rgba, width: 1, height: LEVEL_HEIGHT_PX };
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
  // Step 1: build the 512-entry RGB888 strip indexed TOP-TO-BOTTOM
  // (entry 0 = top of level, entry 511 = bottom).
  const strip = new Uint8Array(TOTAL_ENTRIES * 3);

  // Decode endpoint colors once.
  const ep = new Array<{ r: number; g: number; b: number }>(GRADIENT_COLOR_COUNT);
  for (let i = 0; i < GRADIENT_COLOR_COUNT; i++) {
    ep[i] = bgr15ToRgb(colors15[i]);
  }

  // Top pad (72 entries) = topmost color (= colors15[23])
  const top = ep[GRADIENT_COLOR_COUNT - 1];
  for (let i = 0; i < PAD_TOP_ENTRIES; i++) {
    strip[i * 3 + 0] = top.r;
    strip[i * 3 + 1] = top.g;
    strip[i * 3 + 2] = top.b;
  }

  // Middle 384 entries: 24 sub-segments × 16 entries each, walking
  // colors15[23] → colors15[0] from top to bottom.
  for (let seg = 0; seg < GRADIENT_COLOR_COUNT; seg++) {
    const from = ep[GRADIENT_COLOR_COUNT - 1 - seg];
    const to = seg + 1 < GRADIENT_COLOR_COUNT
      ? ep[GRADIENT_COLOR_COUNT - 1 - (seg + 1)]
      : from; // last segment holds its color (no further to lerp toward)
    for (let k = 0; k < ENTRIES_PER_COLOR; k++) {
      const t = k / ENTRIES_PER_COLOR;
      const r = Math.round(from.r + (to.r - from.r) * t);
      const g = Math.round(from.g + (to.g - from.g) * t);
      const b = Math.round(from.b + (to.b - from.b) * t);
      const entryIdx = PAD_TOP_ENTRIES + seg * ENTRIES_PER_COLOR + k;
      strip[entryIdx * 3 + 0] = r;
      strip[entryIdx * 3 + 1] = g;
      strip[entryIdx * 3 + 2] = b;
    }
  }

  // Bottom pad (56 entries) = bottommost color (= colors15[0])
  const bot = ep[0];
  for (let i = 0; i < PAD_BOTTOM_ENTRIES; i++) {
    const entryIdx = PAD_TOP_ENTRIES + INTERP_ENTRIES + i;
    strip[entryIdx * 3 + 0] = bot.r;
    strip[entryIdx * 3 + 1] = bot.g;
    strip[entryIdx * 3 + 2] = bot.b;
  }

  // Step 2: expand to 1×LEVEL_HEIGHT_PX RGBA (4 px per entry).
  const rgba = new Uint8Array(LEVEL_HEIGHT_PX * 4);
  for (let y = 0; y < LEVEL_HEIGHT_PX; y++) {
    const entry = (y / PIXELS_PER_ENTRY) | 0;
    rgba[y * 4 + 0] = strip[entry * 3 + 0];
    rgba[y * 4 + 1] = strip[entry * 3 + 1];
    rgba[y * 4 + 2] = strip[entry * 3 + 2];
    rgba[y * 4 + 3] = 0xff;
  }
  return rgba;
}
