// Builds the per-region BG1 render inputs (one vram + cgram per
// Graphic/Palette-Changer band) for `renderBg1`'s optional `bands` argument.
//
// `computeBg1Bands` (bg1-regions.ts) gives the column ranges + their
// tileset/palette; this loads the actual gfx/palette for each distinct
// tileset/palette (cached) and returns the band array `renderBg1` consumes.
// Returns `undefined` for the common case (no changer actually alters BG1),
// so callers keep their single-tileset fast path.

import type { SymbolMap } from './symbol-map.ts';
import { loadLevelGfx, type GfxHeader } from './load-graphics.ts';
import { loadLevelPalettes, type PaletteHeader } from './load-palettes.ts';
import { loadTileAnimation } from './load-tile-animation.ts';
import {
  computeBg1Bands,
  bandsDifferFromHeader,
  deriveBg1Direction,
  type ChangerSprite,
  type RenderDirection,
} from './bg1-regions.ts';

const VRAM_BYTES = 0x10000;
const CGRAM_BYTES = 0x200;

export interface Bg1RenderBand {
  minCell: number;
  maxCell: number;
  vram: Uint8Array;
  cgram: Uint8Array;
}

/** Result of buildBg1Bands: the render bands plus which axis they index
 *  ('x' columns / 'y' rows). Pass both straight into `renderBg1`. */
export interface Bg1BandResult {
  bands: Bg1RenderBand[];
  bandAxis: 'x' | 'y';
}

export interface Bg1BandBuildOpts {
  rom: Uint8Array;
  symbols: SymbolMap;
  /** Full level sprite list (the changers $1BA-$1C9 are filtered internally). */
  sprites: ReadonlyArray<ChangerSprite>;
  /** Level gfx header (its `bg1Tileset` is the default; overridden per band). */
  gfx: GfxHeader;
  /** Level palette header (its `bg1Palette` is the default; overridden per band). */
  palette: PaletteHeader;
  /** header[10] — animation tileset (BG1-char-region animated tiles depend on it). */
  animationTileset: number;
  /** header[9] — level mode (required by loadTileAnimation; PaletteHeader's is optional). */
  levelMode: number;
  /** Optional override of the band axis. When omitted it is derived from the
   *  changer sprites' own X-vs-Y spread (`deriveBg1Direction`); 'vertical'
   *  bands BG1 by Y-screen (e.g. 0x2B). */
  direction?: RenderDirection;
}

/**
 * Returns `{ bands, bandAxis }` for `renderBg1`, or `undefined` if the level
 * has no Graphic/Palette Changer that alters BG1 (the common case — render
 * with a single tileset as before).
 */
export function buildBg1Bands(opts: Bg1BandBuildOpts): Bg1BandResult | undefined {
  const direction = opts.direction ?? deriveBg1Direction(opts.sprites);
  const header = { bg1Tileset: opts.gfx.bg1Tileset, bg1Palette: opts.palette.bg1Palette };
  const spec = computeBg1Bands(opts.sprites, header, direction);
  if (!bandsDifferFromHeader(spec, header)) return undefined;

  const vramCache = new Map<number, Uint8Array>();
  const cgramCache = new Map<number, Uint8Array>();

  const vramFor = (bg1Tileset: number): Uint8Array => {
    let v = vramCache.get(bg1Tileset);
    if (!v) {
      v = new Uint8Array(VRAM_BYTES);
      loadLevelGfx(opts.rom, opts.symbols, { ...opts.gfx, bg1Tileset }, v, []);
      loadTileAnimation(opts.rom, opts.symbols, {
        animationTileset: opts.animationTileset,
        bg1Tileset,
        levelMode: opts.levelMode,
      }, v);
      vramCache.set(bg1Tileset, v);
    }
    return v;
  };
  const cgramFor = (bg1Palette: number): Uint8Array => {
    let c = cgramCache.get(bg1Palette);
    if (!c) {
      c = new Uint8Array(CGRAM_BYTES);
      loadLevelPalettes(opts.rom, opts.symbols, { ...opts.palette, bg1Palette }, c);
      cgramCache.set(bg1Palette, c);
    }
    return c;
  };

  const bands = spec.map((b) => ({
    minCell: b.minCell,
    maxCell: b.maxCell,
    vram: vramFor(b.bg1Tileset),
    cgram: cgramFor(b.bg1Palette),
  }));
  return { bands, bandAxis: direction === 'vertical' ? 'y' : 'x' };
}
