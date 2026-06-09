// Per-level Map16 usage: which distinct Map16 IDs a decoded level actually
// stamps, how often, and whether each one's graphics are really in VRAM. This
// is the engine core behind the editor's Tiles "Used" view + the `map16-probe`
// dev tool — turning "browse 167 Map16 pages" into "the ~dozens of blocks THIS
// level places, with health."
//
// Coverage classification per 8×8 sub-tile (mirrors map16-probe):
//   - `loaded` — the sub-tile's VRAM range is covered by a loaded gfx chunk.
//   - `anim`   — not covered by a static chunk, but non-zero (filled by the
//                tile-animation pass — e.g. coins / !-switch slots).
//   - `miss`   — nothing loaded there; the block stamps a tile whose graphics
//                aren't in VRAM, so it renders as garbage. A real level bug.
// A block's coverage is the worst of its four sub-tiles.

import type { SymbolMap } from './symbol-map.ts';
import { loadMap16Tables, decodeMap16Alloc } from './map16.ts';
import { loadSceneRegs } from './scene-regs.ts';
import { loadLevelGfx, type GfxFileEntry } from './load-graphics.ts';
import { loadTileAnimation } from './load-tile-animation.ts';
import type {
  TileCoverage,
  Map16SubTileUsage,
  UsedMap16,
  LevelMap16Usage
} from '../types.ts';

// Data shapes live in the shared types module (single source — see types.ts);
// re-exported here so existing engine/probe imports keep resolving.
export type { TileCoverage, Map16SubTileUsage, UsedMap16, LevelMap16Usage };

export interface LevelMap16UsageInput {
  /** Unpacked 15-field level header (objectFile present). */
  header: readonly number[];
  isWorld6: boolean;
  /** Decoded Map16-ID grid (`DecodeState.levelDataBuffer`). */
  levelDataBuffer: Uint8Array;
  /** Screen→LRU-page map (`DecodeState.screenPageMap`); `0x80` = unallocated. */
  screenPageMap: Uint8Array | readonly number[];
}

/**
 * Compute the Map16 usage + coverage for a decoded level. Pure over the cart +
 * the decoded buffer: loads the level's gfx (+ animation) into a scratch VRAM
 * with a manifest, then cross-checks every distinct stamped Map16 ID's sub-tile
 * VRAM ranges against what's actually present.
 */
export function levelMap16Usage(
  rom: Uint8Array,
  symbols: SymbolMap,
  input: LevelMap16UsageInput
): LevelMap16Usage {
  const h = input.header;
  const tables = loadMap16Tables(rom, symbols);
  const regs = loadSceneRegs(rom, symbols, h[9] ?? 0);

  // Load gfx + animation into a scratch VRAM with a manifest, so we can tell
  // which sub-tile VRAM ranges are covered (loaded) vs filled-by-anim vs absent.
  const vram = new Uint8Array(0x10000);
  const gfxManifest: GfxFileEntry[] = [];
  loadLevelGfx(
    rom, symbols,
    { bg1Tileset: h[1] ?? 0, bg2Tileset: h[3] ?? 0, bg3Tileset: h[5] ?? 0, spriteTileset: h[7] ?? 0, isWorld6: input.isWorld6 },
    vram, gfxManifest
  );
  loadTileAnimation(rom, symbols, { animationTileset: h[10] ?? 0, bg1Tileset: h[1] ?? 0, levelMode: h[9] ?? 0 }, vram);

  const gfxRanges: Array<[number, number]> = gfxManifest.map((e) => [e.vramByteOffset, e.vramByteOffset + e.sizeBytes]);
  const coveredGfx = (off: number, len = 32): boolean => gfxRanges.some(([s, e]) => off >= s && off + len <= e);
  const nonZeroVram = (off: number, len = 32): boolean => {
    for (let k = 0; k < len; k++) if (vram[off + k] !== 0) return true;
    return false;
  };
  const classify = (off: number): TileCoverage =>
    coveredGfx(off) ? 'loaded' : nonZeroVram(off) ? 'anim' : 'miss';

  // Distinct Map16 IDs + per-ID stamp counts across allocated screens.
  const counts = new Map<number, number>();
  const buf = input.levelDataBuffer;
  const pageMap = input.screenPageMap;
  let totalCells = 0;
  for (let s = 0; s < pageMap.length; s++) {
    const slot = pageMap[s]!;
    if (slot === 0x80) continue;
    const page = slot & 0x3f;
    if (page === 0) continue;
    const base = page * 512;
    for (let i = 0; i < 512; i += 2) {
      const mid = buf[base + i]! | (buf[base + i + 1]! << 8);
      if (mid === 0) continue;
      totalCells++;
      counts.set(mid, (counts.get(mid) ?? 0) + 1);
    }
  }

  const worst = (cs: TileCoverage[]): TileCoverage =>
    cs.includes('miss') ? 'miss' : cs.includes('anim') ? 'anim' : 'loaded';

  const rowsUsed = new Set<number>();
  const blocks: UsedMap16[] = [];
  for (const [id, count] of counts) {
    const page = (id >>> 8) & 0xff;
    const tile = id & 0xff;
    const pgCells = page < tables.pageCellCounts.length ? tables.pageCellCounts[page]! : 0;
    let subTiles: Map16SubTileUsage[] = [];
    try {
      subTiles = decodeMap16Alloc(tables, id).map((st) => {
        const vramByteOffset = (regs.bg1CharAddr + st.tileIndex * 32) & 0xffff;
        return {
          tileIndex: st.tileIndex,
          paletteRow: st.paletteRow,
          hflip: st.hflip,
          vflip: st.vflip,
          vramByteOffset,
          coverage: classify(vramByteOffset)
        };
      });
    } catch {
      // ID out of range (page/tile past the table) — treat as a miss block with
      // no resolvable sub-tiles. `overflow` already flags the structural cause.
    }
    const paletteRows = [...new Set(subTiles.map((s) => s.paletteRow))].sort((a, b) => a - b);
    paletteRows.forEach((r) => rowsUsed.add(r));
    blocks.push({
      id, page, tile, count,
      overflow: tile >= pgCells,
      subTiles,
      coverage: subTiles.length ? worst(subTiles.map((s) => s.coverage)) : 'miss',
      paletteRows
    });
  }

  blocks.sort((a, b) => b.count - a.count || a.id - b.id);
  return {
    blocks,
    paletteRowsUsed: [...rowsUsed].sort((a, b) => a - b),
    totalCells
  };
}
