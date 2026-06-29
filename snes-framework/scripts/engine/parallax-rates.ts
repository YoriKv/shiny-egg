// Per-level BG2/BG3 parallax rates — read from the cart's 8.8-fixed rate tables
// (`DATA_04FB6E`/`FBAE`/`FBEE`/`FC2E`, Bank04), indexed by the level header's
// BGScrollSetting field (header[12]). These feed the editor's Camera Preview
// parallax (see src/renderer/src/canvas/parallax.ts). Algorithm: yi BG2/BG3
// rendering guide §5.1 (`CODE_04FE43` loads these into GSU R8–R11).

import type { SymbolMap } from './symbol-map.ts';
import { u16le } from './rom-read.ts';

export interface ParallaxRates {
  /** BG2 X scroll rate (8.8). */
  bg2X: number;
  /** BG2 Y scroll rate (8.8). */
  bg2Y: number;
  /** BG3 X scroll rate (8.8). */
  bg3X: number;
  /** BG3 Y scroll rate (8.8). */
  bg3Y: number;
}

/** Read the four BG2/BG3 parallax rates for a level's BGScrollSetting (header[12]).
 *  Each table is a flat array of u16 words; the rate for setting `s` is at `s*2`. */
export function readParallaxRates(
  rom: Uint8Array,
  symbols: SymbolMap,
  bgScrollSetting: number
): ParallaxRates {
  const idx = (bgScrollSetting & 0x1f) * 2;
  const at = (label: string): number => u16le(rom, symbols.pc(label) + idx);
  return {
    bg2X: at('DATA_04FB6E'),
    bg2Y: at('DATA_04FBAE'),
    bg3X: at('DATA_04FBEE'),
    bg3Y: at('DATA_04FC2E')
  };
}
