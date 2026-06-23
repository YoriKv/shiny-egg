// BG region export/import round-trip pin (bg-region.ts) — the in-situ "edit what
// you see" surface (research/graphics-editing/bg-region-edit.md).
//
//   1. BG1 region FAITHFUL round-trip: slicing the unedited region reproduces the
//      base BG1 tiles (diff → 0 edits); a 1-px edit produces a non-empty edit.
//   2. BG2/BG3 region FAITHFUL round-trip: unedited slice → 0 edits; a 1-px edit
//      on an editable sub-cell isolates to one CHR tile with the right byte width
//      (BG2 = 32 B / 4bpp, BG3 = 16 B / 2bpp).
//   3. Gating: non-editable sub-cells (wraparound / not in this layer's gfx) are
//      rendered but never written.
//   4. The 8×8 PIXEL `.aseprite` export (all layers — `bg1RegionAseprite` /
//      `bgRegionAseprite`) flattens BYTE-EXACT to the region RGBA → 0-edit round-trip.
//   5. The 16×16 LAYOUT (placement) `.aseprite` export (BG2/BG3 — `bgRegionPlacementAseprite`
//      / `diffBgRegionPlacement`): unedited → 0 word edits; a cell move → exactly that word;
//      available tiles cover every scene row; the tilemap-source write byte matches.
//
// Run: node snes-framework/scripts/engine/bg-region.test.ts

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel, isWorld6Record, loadLevelMapPublic } from '../level.ts';
import { decodeLevelById } from './object-decode/index.ts';
import { buildMetatileContext, type MetatileHeader } from './object-metatile.ts';
import { buildPaletteRow } from './color.ts';
import { SCREEN_PAGE_UNALLOCATED, LRU_PAGE_MASK } from './cell-grid.ts';
import {
  renderBg1Region, diffBg1Region, buildBgRegionContext, renderBgRegion, diffBgRegionTiles,
  bg1RegionAseprite, bgRegionAseprite, bgRegionPlacementAseprite, diffBgRegionPlacement
} from './bg-region.ts';
import { decodeAsepriteRegion, decodeAsepriteStructural } from './aseprite.ts';
import { resolveBgTilemapSource } from './load-bg-tilemaps.ts';

/** flatten(.aseprite) must equal the region RGBA byte-for-byte (the round-trip
 *  invariant the slicers rely on). */
function rgbaEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; }
}

let cart;
try { cart = loadDevCart(FRAMEWORK_ROOT); } catch (e) {
  console.error((e as Error).message); process.exit(2);
}
const { rom, symbols } = cart;
const levelMap = loadLevelMapPublic(FRAMEWORK_ROOT);

function headerFromLevel(h: readonly number[], rec: number): MetatileHeader {
  return {
    bg1Tileset: h[1] ?? 0, bg2Tileset: h[3] ?? 0, bg3Tileset: h[5] ?? 0, spriteTileset: h[7] ?? 0,
    bgColor: h[0] ?? 0, bg1Palette: h[2] ?? 0, bg2Palette: h[4] ?? 0, bg3Palette: h[6] ?? 0,
    spritePalette: h[8] ?? 0, yoshiColor: 0, isWorld6: isWorld6Record(levelMap, rec), levelMode: h[9] ?? 0
  };
}

/** First allocated screen (screenX, screenY) in the level, or null. */
function firstAllocatedScreen(screenPageMap: Uint8Array): { sx: number; sy: number } | null {
  for (let sy = 0; sy < 8; sy++) {
    for (let sx = 0; sx < 16; sx++) {
      const slot = screenPageMap[(sy << 4) | sx]!;
      if (slot === SCREEN_PAGE_UNALLOCATED) continue;
      if ((slot & LRU_PAGE_MASK) === 0) continue;
      return { sx, sy };
    }
  }
  return null;
}

/** Set one pixel to a palette colour of `row` that differs from its current value
 *  (so the slice registers a change). Returns true if a pixel was changed. */
function pokePixel(
  rgba: Uint8Array, width: number, pxX: number, pxY: number,
  cgram: Uint8Array, row: number, transparentZero: boolean, colorsPerRow: number
): boolean {
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >>> 2);
  const palette = buildPaletteRow(cgram, row, transparentZero, 'expand', colorsPerRow);
  const cur = u32[pxY * width + pxX]!;
  for (let i = 1; i < colorsPerRow; i++) {
    if (palette[i] !== cur) { u32[pxY * width + pxX] = palette[i]!; return true; }
  }
  return false;
}

const LEVELS = [0x00, 0x27, 0x31];
let bg1Tested = 0, bg2Tested = 0, bg3Tested = 0, gatedSeen = 0, placementTested = 0;

for (const rec of LEVELS) {
  const base = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: rec });
  if (base.empty || base.special || base.header.length < 15) { console.log(`\n0x${rec.toString(16)}: skipped`); continue; }
  const header = headerFromLevel(base.header, rec);
  console.log(`\n0x${rec.toString(16).padStart(2, '0')}`);

  // ── BG1 region ────────────────────────────────────────────────────────────
  const decoded = decodeLevelById({ rom, symbols, workRoot: FRAMEWORK_ROOT, levelRecordId: rec });
  if (decoded && !decoded.stats.aborted) {
    const { levelDataBuffer, screenPageMap } = decoded.state;
    const scr = firstAllocatedScreen(screenPageMap);
    if (scr) {
      const ctx = buildMetatileContext(rom, symbols, header);
      const rect = { col0: scr.sx * 16, row0: scr.sy * 16, cols: 16, rows: 16 };
      const region = renderBg1Region(ctx, levelDataBuffer, screenPageMap, rect);
      const faithful = region.cells.filter((c) => c.faithful).length;
      // 1. Unedited slice → 0 edits.
      const clean = diffBg1Region(ctx, region, region.rgba);
      assert(clean.edits.length === 0, `BG1 faithful round-trips (${faithful} faithful / ${region.cells.length} cells)`);
      // 2. A 1-px edit on a faithful cell → non-empty edit.
      const cell = region.cells.find((c) => c.faithful);
      if (cell && faithful > 0) {
        const edited = region.rgba.slice();
        const poked = pokePixel(edited, region.width, cell.c * 16, cell.r * 16, ctx.cgram, 4, false, 16);
        if (poked) {
          const d = diffBg1Region(ctx, region, edited);
          assert(d.edits.length >= 1, `BG1 1-px edit isolates → ${d.edits.length} tile(s)`);
        }
        // An off-palette colour (R=1 isn't a 5-bit SNES channel) → reported mismatch.
        const off = region.rgba.slice();
        new Uint32Array(off.buffer, off.byteOffset, off.length >>> 2)[(cell.r * 16) * region.width + cell.c * 16] = 0xff030201 >>> 0;
        assert(diffBg1Region(ctx, region, off).mismatches >= 1, `BG1 off-palette pixel flagged as mismatch`);
      }

      // 3. Aseprite PIXEL export (tiles = 8×8 CHR, honest sharing) flattens BYTE-EXACT to
      //    the region RGBA, so the existing slicer sees no change (the round-trip invariant).
      const flat = decodeAsepriteRegion(bg1RegionAseprite(ctx, region));
      assert(flat.width === region.width && flat.height === region.height && rgbaEqual(flat.rgba, region.rgba),
        `BG1 aseprite flattens byte-exact to the region RGBA`);
      assert(diffBg1Region(ctx, region, flat.rgba).edits.length === 0,
        `BG1 aseprite round-trips through the slicer (0 edits)`);

      bg1Tested++;
    }
  }

  // ── BG2 / BG3 region ──────────────────────────────────────────────────────
  const bgCtx = buildBgRegionContext(rom, symbols, header);
  for (const layer of [2, 3] as const) {
    const visible = layer === 2 ? bgCtx.bg2Visible : bgCtx.bg3Visible;
    if (!visible) continue;
    const region = renderBgRegion(bgCtx, layer);
    if (region.width === 0 || region.subCells.length === 0) continue;
    const tileBytes = region.bpp === 4 ? 32 : 16;
    const editable = region.subCells.filter((s) => s.gfx).length;
    const gated = region.subCells.length - editable;
    if (gated > 0) gatedSeen += gated;

    // 1. Unedited slice → 0 edits (the faithful round-trip).
    const clean = diffBgRegionTiles(bgCtx, region, region.rgba);
    assert(clean.edits.length === 0,
      `BG${layer} faithful round-trips (${editable} editable / ${region.subCells.length} cells, ${region.bpp}bpp)`);

    // 2. A 1-px edit on an editable sub-cell → an edit of the right byte width.
    const sc = region.subCells.find((s) => s.gfx);
    if (sc) {
      const edited = region.rgba.slice();
      const poked = pokePixel(edited, region.width, sc.pxX, sc.pxY, bgCtx.cgram, sc.paletteRow, true, region.bpp === 4 ? 16 : 4);
      if (poked) {
        const d = diffBgRegionTiles(bgCtx, region, edited);
        assert(d.edits.length >= 1 && d.edits.every((e) => e.bytes.length === tileBytes),
          `BG${layer} 1-px edit → ${d.edits.length} tile(s) of ${tileBytes} B`);
      }
      const off = region.rgba.slice();
      new Uint32Array(off.buffer, off.byteOffset, off.length >>> 2)[sc.pxY * region.width + sc.pxX] = 0xff030201 >>> 0;
      assert(diffBgRegionTiles(bgCtx, region, off).mismatches >= 1, `BG${layer} off-palette pixel flagged as mismatch`);
    }

    // 3. Aseprite tilemap export (tiles = CHR tiles, un-flipped + per-cell flip)
    //    flattens BYTE-EXACT to the region RGBA → the slicer sees no change.
    const flat = decodeAsepriteRegion(bgRegionAseprite(bgCtx, region));
    assert(flat.width === region.width && flat.height === region.height && rgbaEqual(flat.rgba, region.rgba),
      `BG${layer} aseprite flattens byte-exact (${region.bpp}bpp, flips)`);
    assert(diffBgRegionTiles(bgCtx, region, flat.rgba).edits.length === 0,
      `BG${layer} aseprite round-trips through the slicer (0 edits)`);
    // The aseprite palette must match the PNG swatch — each row's colour 0 is
    // transparent on these layers (NOT an opaque colour the artist could mis-use).
    let palMatch = true;
    const cprPal = region.bpp === 4 ? 16 : 4;
    region.paletteRowsUsed.forEach((row, k) => {
      const swatch = buildPaletteRow(bgCtx.cgram, row, true, 'expand', cprPal);
      for (let i = 0; i < cprPal; i++) if ((flat.palette[k * cprPal + i] ?? 0) !== swatch[i]) palMatch = false;
    });
    assert(palMatch, `BG${layer} aseprite palette matches the PNG swatch (per-row colour 0 transparent)`);

    // 4. PLACEMENT round-trip on REAL data, at the BG's NATIVE tile size (16×16 for
    //    YI BG2/BG3 — one Aseprite tile = one tilemap word). Unedited → 0 word edits;
    //    moving one tile into another cell → exactly that one word changes (rebuilt from
    //    the moved tile's baseTile/palette + flips, the dest cell's priority preserved).
    const struct = decodeAsepriteStructural(bgRegionPlacementAseprite(bgCtx, region));
    const tmAddr = layer === 2 ? bgCtx.regs.bg2TilemapAddr : bgCtx.regs.bg3TilemapAddr;
    assert(diffBgRegionPlacement(bgCtx, region, struct, tmAddr).edits.length === 0,
      `BG${layer} placement round-trips (unedited → 0 word edits, ${region.tileSize}px tiles)`);
    const ts = region.tileSize, nAcross = region.width / ts;
    const topLeft = new Map<number, typeof region.subCells[number]>();
    for (const sc of region.subCells) if (sc.pxX % ts === 0 && sc.pxY % ts === 0) topLeft.set((sc.pxY / ts) * nAcross + sc.pxX / ts, sc);
    let ci = -1, cj = -1;
    for (const [idx, sc] of topLeft) if (sc.gfx) { ci = idx; break; }
    if (ci >= 0) for (const [idx, sc] of topLeft) if (sc.gfx && idx !== ci && struct.cells[idx]!.tile !== struct.cells[ci]!.tile) { cj = idx; break; }
    if (ci >= 0 && cj >= 0) {
      const sci = topLeft.get(ci)!, scj = topLeft.get(cj)!;
      const cells = struct.cells.slice(); cells[ci] = struct.cells[cj]!; // move cell j's tile into cell i
      const d = diffBgRegionPlacement(bgCtx, region, { ...struct, cells }, tmAddr);
      const expWord = (scj.entry & 0x3ff) | (((scj.entry >> 10) & 7) << 10) | (sci.entry & 0x2000) |
        (scj.hflip ? 0x4000 : 0) | (scj.vflip ? 0x8000 : 0);
      assert(d.edits.length === 1 && d.edits[0]!.fileOffset === sci.memoryEntryOff - tmAddr && d.edits[0]!.word === expWord,
        `BG${layer} ${ts}px cell move → exactly that word (got ${d.edits.length}, word 0x${d.edits[0]?.word.toString(16)} vs 0x${expWord.toString(16)})`);
      placementTested++;
    }
    // AVAILABLE tiles: the export includes the layer's accessible CHR offered at EVERY
    // scene palette row (single-row limitation lifted), NOT on the canvas. Place all of
    // them into editable cells (one diff) → each yields exactly its word, all at scene
    // rows, and the rows COVER every scene palette row (so any row is placeable).
    const usedTiles = new Set(struct.cells.map((c) => c.tile));
    const editableCells = [...topLeft.entries()].filter(([, sc]) => sc.gfx).map(([idx]) => idx);
    const availIdxs: number[] = [];
    for (let t = 1; t < struct.numTiles; t++) if (!usedTiles.has(t)) availIdxs.push(t);
    assert(availIdxs.length > 0, `BG${layer} export includes available (accessible) tiles (${availIdxs.length} of ${struct.numTiles})`);
    const k = Math.min(editableCells.length, availIdxs.length);
    if (k > 0) {
      const cells = struct.cells.slice();
      for (let i = 0; i < k; i++) cells[editableCells[i]!] = { tile: availIdxs[i]!, hflip: false, vflip: false };
      const d2 = diffBgRegionPlacement(bgCtx, region, { ...struct, cells }, tmAddr);
      const rows = new Set(d2.edits.map((e) => (e.word >> 10) & 7));
      assert(d2.edits.length === k && [...rows].every((r) => region.paletteRowsUsed.includes(r)),
        `BG${layer} placing ${k} available tiles → ${k} words at scene rows (got ${d2.edits.length} edits)`);
      assert(region.paletteRowsUsed.every((r) => rows.has(r)),
        `BG${layer} available tiles cover every scene palette row [${region.paletteRowsUsed.join(',')}] (got [${[...rows].sort((a, b) => a - b).join(',')}])`);
    }
    // Write-path: the resolved tilemap source's decompressed bytes at
    // (memoryEntryOff − vramBase) MUST equal the cell's word — proving the placement
    // splice (bg-region-io) writes the correct file byte for the correct cell.
    const tileset = layer === 2 ? header.bg2Tileset : header.bg3Tileset;
    const src = resolveBgTilemapSource(rom, symbols, layer, tileset);
    if (src && tmAddr === src.vramBase) {
      let okSrc = true, checked = 0;
      for (const sc of region.subCells) {
        if (sc.pxX % ts !== 0 || sc.pxY % ts !== 0) continue;
        const off = sc.memoryEntryOff - src.vramBase;
        if (off < 0 || off + 1 >= src.bytes.length) continue;
        if ((src.bytes[off]! | (src.bytes[off + 1]! << 8)) !== sc.entry) { okSrc = false; break; }
        checked++;
      }
      assert(okSrc && checked > 0, `BG${layer} tilemap source bytes match cell words (${checked} cells) — placement splice targets the right file offset`);
    }

    if (layer === 2) bg2Tested++; else bg3Tested++;
  }
}

// Synthetic per-WORD placement reconstruction pin — the engine logic, independent of a
// real 8×8 BG level (YI BG2/BG3 are all 16×16). Two distinct 8×8 cells; moving cell 0
// to reference cell 1's tile rebuilds exactly that one tilemap word (char/palette/flip
// of the moved tile + the destination cell's original priority bit).
{
  const TM = 0x1000;
  const vram = new Uint8Array(0x10000);
  const cgram = new Uint8Array(512); for (let i = 0; i < 512; i++) cgram[i] = i & 0xff;
  const ctx = { vram, cgram, regs: { bg2CharAddr: 0, bg2TilemapAddr: TM } } as any;
  const sub = (pxX: number, charTile: number, palRow: number, entry: number, off: number): any =>
    ({ pxX, pxY: 0, charTile, paletteRow: palRow, hflip: false, vflip: false, memoryEntryOff: off, entry, whole: true, gfx: { fileId: 0x80, format: 'lz2', fileTile: 0 } });
  const region = { layer: 2, bpp: 4, width: 16, height: 8, tileSize: 8, paletteRowsUsed: [0, 1],
    subCells: [sub(0, 1, 0, 0x0001, TM), sub(8, 2, 1, 0x0402, TM + 2)] } as any;
  const struct = decodeAsepriteStructural(bgRegionPlacementAseprite(ctx, region));
  assert(diffBgRegionPlacement(ctx, region, struct, TM).edits.length === 0, 'synthetic placement unedited → 0 word edits');
  const cells = struct.cells.slice(); cells[0] = struct.cells[1]!; // move cell 1's tile into cell 0
  const d = diffBgRegionPlacement(ctx, region, { ...struct, cells }, TM);
  const expWord = 2 | (1 << 10); // char 2, palRow 1, cell-0 priority 0, no flip
  assert(d.edits.length === 1 && d.edits[0]!.fileOffset === 0 && d.edits[0]!.word === expWord,
    `synthetic 1-cell move → one word (got ${d.edits.length} edits, off ${d.edits[0]?.fileOffset}, word 0x${d.edits[0]?.word.toString(16)})`);
  placementTested++;
}

assert(bg1Tested > 0, `BG1 regions exercised (${bg1Tested})`);
assert(bg2Tested > 0, `BG2 regions exercised (${bg2Tested})`);
assert(bg3Tested > 0, `BG3 regions exercised (${bg3Tested})`);
assert(placementTested > 0, `placement word-reconstruction exercised (${placementTested})`);
console.log(`\n  [gated (non-editable) BG2/BG3 sub-cells seen across levels: ${gatedSeen}]`);

console.log(`\n${failures === 0 ? '✓ all bg-region pins pass' : `✗ ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
