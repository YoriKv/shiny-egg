// Per-region BG1 tileset/palette computation for "Graphic / Palette Changer"
// special sprites (ids $1BA-$1C9, handler CODE_init_palette_spr @ Bank03.asm:11283).
//
// These sprites swap the live BG1 char tileset and/or BG1 palette at runtime
// as the player crosses them, producing a per-region BG1 gfx change *within a
// single level* that a static header-driven gfx load misses. The classic case
// is 4-4 (level 0x1E): a changer at cell x=130 swaps BG1 to tileset 6 (the
// fort's brown brick) while the header tileset (1, gray) holds for the
// approach — so the fort's std-48 walls render with the wrong tileset unless
// we model the swap.
//
// Cart mechanics (verified byte-exact against a live VRAM dump):
//   - changer value = `num - $1BA`.
//   - action select is a parity branch on `$7960` (the sprite's direct-page
//     slot $00): the cart does `LDA $7960 : LSR : BCS` in
//     `CODE_init_palette_spr` (Bank03.asm:11284). We use the changer's CELL-X
//     parity as the static editor-side equivalent (matches empirically):
//       even → BG1 *tileset* swap (writes LevelHeaderBG1TilesetLo $0136, then
//              sets the sprite dyntile in-use bitfield `$7ECC=$FFFF`, which
//              forces the BG1-char dyntiles to re-upload),
//       odd  → BG1 *palette* swap (writes LevelHeaderBG1PaletteLo $0138).
//   - the swap takes effect from the changer's column rightward; sweeping
//     left-to-right, the last change before a column wins. Default (left of
//     any changer) is the level header's tileset/palette.

/** Id range of the Graphic/Palette Changer special sprites. */
import type { RenderDirection } from '../types.ts';
export type { RenderDirection };

export const BG1_CHANGER_LO = 0x1ba;
export const BG1_CHANGER_HI = 0x1c9;

/** A contiguous run of cells [minCell, maxCell) along the level's render axis
 *  (columns for horizontal, rows for vertical) sharing one BG1 tileset +
 *  palette. `maxCell` is exclusive. */
export interface Bg1Band {
  minCell: number;
  maxCell: number;
  bg1Tileset: number;
  bg1Palette: number;
}

export interface Bg1RegionHeader {
  bg1Tileset: number;
  bg1Palette: number;
}

/** Minimal sprite shape: changer id + cell-X (tileset/palette parity) +
 *  cell-Y (band axis for vertical levels). */
export interface ChangerSprite {
  num: number;
  x: number;
  y: number;
}

/**
 * Derive the band axis from the changer sprites' OWN geometry — no per-level
 * table needed. A changer pair that swaps both tileset+palette sits at adjacent
 * X (same Y), so a horizontal level's changers spread along X while a
 * vertical-climb level's spread along Y (its changers are X-parked, Y-spaced).
 * Rule: greater Y-spread than X-spread ⇒ vertical, else horizontal. Levels with
 * 0/1 changer positions default to horizontal (axis is moot — they yield ≤1
 * band). Verified to classify all six changer-bearing levels correctly: only
 * 0x2B (yspread 20 vs xspread 1) is vertical; 0x15/0x1E/0x33/0x58/0x89 spread
 * along X. This is live-correct under sprite edits, unlike a baked catalog flag.
 */
export function deriveBg1Direction(sprites: ReadonlyArray<ChangerSprite>): RenderDirection {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let n = 0;
  for (const s of sprites) {
    if (s.num < BG1_CHANGER_LO || s.num > BG1_CHANGER_HI) continue;
    n++;
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }
  if (n === 0) return 'horizontal';
  return maxY - minY > maxX - minX ? 'vertical' : 'horizontal';
}

/**
 * Compute the per-region BG1 tileset/palette bands for a level from its
 * sprite list. Returns a list of disjoint bands (ascending cell) covering
 * `[0, totalCells)`. A level with no changer sprites yields a single band at
 * the header tileset/palette. `direction` defaults to `deriveBg1Direction`.
 */
/** All BG1 tilesets a level can show: the header tileset plus every
 *  gfx-changer band's target. The render-validity theme gate's effective set —
 *  pick-time has no placement position, so an entry valid under ANY band is
 *  offered (level 0x58's large line-guide corners are valid only inside its
 *  ts15 changer band). */
export function effectiveBg1Tilesets(
  sprites: ReadonlyArray<ChangerSprite>,
  header: Bg1RegionHeader
): Set<number> {
  const set = new Set<number>([header.bg1Tileset & 0x0f]);
  for (const band of computeBg1Bands(sprites, header)) set.add(band.bg1Tileset & 0x0f);
  return set;
}

/** The BG1 tileset in effect at a cell position (band-resolved along the
 *  level's render axis). The render-validity EVIDENCE resolver: a shipped
 *  placement proves its art under the band's tileset, not the header's. */
export function effectiveBg1TilesetAt(
  sprites: ReadonlyArray<ChangerSprite>,
  header: Bg1RegionHeader,
  x: number,
  y: number
): number {
  const direction = deriveBg1Direction(sprites);
  const bands = computeBg1Bands(sprites, header, direction);
  const axisCell = direction === 'vertical' ? y : x;
  const band = bands.find((b) => axisCell >= b.minCell && axisCell <= b.maxCell);
  return (band?.bg1Tileset ?? header.bg1Tileset) & 0x0f;
}

export function computeBg1Bands(
  sprites: ReadonlyArray<ChangerSprite>,
  header: Bg1RegionHeader,
  direction: RenderDirection = deriveBg1Direction(sprites),
  totalCells = direction === 'vertical' ? 128 : 256
): Bg1Band[] {
  // Tileset vs palette is selected by the changer's X-cell parity (always —
  // even X → tileset, odd X → palette). The band BOUNDARY is the changer's
  // position along the RENDER AXIS: its X for horizontal levels, its Y for
  // vertical ones (0x2B is a vertical-climb level — changers co-located at
  // one X but spread across Y).
  //
  // SWEEP DIRECTION mirrors the player's travel, because a changer fires when
  // the camera reaches it and the new tileset/palette persists for everything
  // seen AFTERWARD:
  //   - horizontal: player travels +X (left→right), so a changer at X applies
  //     to cells with cell ≥ X.
  //   - vertical:   player CLIMBS, travelling −Y (bottom→top, high Y → low Y),
  //     so a changer at Y applies to cells with cell ≤ Y. (Verified on 0x2B:
  //     its only visible swap is tileset/palette 6, and the cells that tileset
  //     actually differs on are the TOP rows — reachable only by the climb-up
  //     sweep; the forward sweep parks the swap in an invisible mid-level
  //     dead-zone and renders identically to the header.)
  const pos = (s: ChangerSprite) => (direction === 'vertical' ? s.y : s.x);
  const reverse = direction === 'vertical';
  const tsChanges: Array<{ at: number; val: number }> = [];
  const palChanges: Array<{ at: number; val: number }> = [];
  for (const s of sprites) {
    if (s.num < BG1_CHANGER_LO || s.num > BG1_CHANGER_HI) continue;
    const val = s.num - BG1_CHANGER_LO;
    if ((s.x & 1) === 0) tsChanges.push({ at: pos(s), val });
    else palChanges.push({ at: pos(s), val });
  }

  // Resolve the active tileset/palette for every cell, sweeping in travel
  // order. Forward (horizontal): ascending cell, change wins at `at ≤ c`.
  // Reverse (vertical climb): descending cell, change wins at `at ≥ c`.
  const resolvePerCell = (changes: Array<{ at: number; val: number }>, base: number): number[] => {
    const out = new Array<number>(totalCells);
    if (!reverse) {
      changes.sort((a, b) => a.at - b.at);
      let i = 0;
      let cur = base;
      for (let c = 0; c < totalCells; c++) {
        while (i < changes.length && changes[i]!.at <= c) cur = changes[i++]!.val;
        out[c] = cur;
      }
    } else {
      changes.sort((a, b) => b.at - a.at);
      let i = 0;
      let cur = base;
      for (let c = totalCells - 1; c >= 0; c--) {
        while (i < changes.length && changes[i]!.at >= c) cur = changes[i++]!.val;
        out[c] = cur;
      }
    }
    return out;
  };
  const tsAt = resolvePerCell(tsChanges, header.bg1Tileset);
  const palAt = resolvePerCell(palChanges, header.bg1Palette);

  // Coalesce consecutive same-(tileset,palette) cells into bands (ascending).
  const bands: Bg1Band[] = [];
  for (let c = 0; c < totalCells; c++) {
    const curTs = tsAt[c]!;
    const curPal = palAt[c]!;
    const last = bands[bands.length - 1];
    if (last && last.bg1Tileset === curTs && last.bg1Palette === curPal && last.maxCell === c) {
      last.maxCell = c + 1;
    } else {
      bands.push({ minCell: c, maxCell: c + 1, bg1Tileset: curTs, bg1Palette: curPal });
    }
  }
  return bands;
}

/** True if any band differs from the level header (i.e. a changer is present
 *  and actually changes something). Lets callers skip the per-band gfx loads
 *  for the common single-tileset case. */
export function bandsDifferFromHeader(bands: ReadonlyArray<Bg1Band>, header: Bg1RegionHeader): boolean {
  return bands.some((b) => b.bg1Tileset !== header.bg1Tileset || b.bg1Palette !== header.bg1Palette);
}
