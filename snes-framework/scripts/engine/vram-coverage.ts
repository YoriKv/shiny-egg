// Sub-tile VRAM coverage predicate shared by the Map16 health tools
// (map16-probe.ts, entity-render-validity.ts): given the gfx manifest
// `loadLevelGfx` collected and the (tile-animation-overlaid) VRAM it filled,
// answer whether a VRAM byte range actually holds usable tile pixels.
// `covered` = a loaded gfx chunk fully spans it; `nonZero` = bytes are present
// anyway — the signal that the tile-animation pass filled the range (`~anim`
// in the probe CLI's output). Hoisted out of map16-probe.ts so the validity
// probe classifies with the exact predicate the inspection CLI prints.

import type { GfxFileEntry } from '../types.ts';

/** The cart's X-placeholder tile (4bpp, 32 bytes): planes 0/1 draw an X in a
 *  box, planes 2/3 empty. Nintendo's BG1 sheets fill art-less tile slots with
 *  this glyph, so its presence at a sub-tile's VRAM is the sheet's OWN "no art
 *  here" marker — a slot can be gfx-chunk-covered yet hold this filler
 *  (extracted from the built V1.0 cart, tileset 9 slot $15A; identical bytes
 *  in every sheet that carries it — 113 of the 201 shipped gfx tuples). */
export const X_PLACEHOLDER_TILE = new Uint8Array(
  ('ff00bd42db24e718e718db24bd42ff00' + '00'.repeat(16))
    .match(/../g)!
    .map((b) => parseInt(b, 16))
);

export interface VramCoverage {
  /** A loaded gfx chunk fully covers `[off, off+len)`. */
  covered(off: number, len?: number): boolean;
  /** Any non-zero byte in `[off, off+len)` — the tile-animation fill signal
   *  for ranges no gfx chunk covers. */
  nonZero(off: number, len?: number): boolean;
  /** The 32 bytes at `off` are the X-placeholder filler — covered, but the
   *  sheet says there is no art for this slot. */
  placeholder(off: number): boolean;
}

export function makeVramCoverage(
  manifest: readonly GfxFileEntry[],
  vram: Uint8Array
): VramCoverage {
  const ranges: Array<[number, number]> = manifest.map((e) => [
    e.vramByteOffset,
    e.vramByteOffset + e.sizeBytes
  ]);
  return {
    covered: (off, len = 32) => ranges.some(([s, e]) => off >= s && off + len <= e),
    nonZero: (off, len = 32) => {
      for (let k = 0; k < len; k++) if (vram[off + k] !== 0) return true;
      return false;
    },
    placeholder: (off) => {
      for (let k = 0; k < 32; k++) if (vram[off + k] !== X_PLACEHOLDER_TILE[k]) return false;
      return true;
    }
  };
}
