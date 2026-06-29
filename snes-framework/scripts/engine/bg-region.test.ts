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
  bg1RegionAseprite, bgRegionAseprite, bgRegionPlacementAseprite, diffBgRegionPlacement, diffBgRegionCombined,
  bgRegionM1te2, diffBgRegionM1te2, bg1RegionM1te2, diffBg1RegionM1te2
} from './bg-region.ts';
import { decodeAsepriteRegion, decodeAsepriteStructural } from './aseprite.ts';
import { resolveBgTilemapSource } from './load-bg-tilemaps.ts';
import { OFF_PALETTE, OFF_MAPS, OFF_CHR4, OFF_CHR2, MAP_STRIDE, MAP_WORDS } from './m1te2.ts';

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

/** Set one pixel to a palette color of `row` that differs from its current value
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
let bg1Tested = 0, bg2Tested = 0, bg3Tested = 0, gatedSeen = 0, placementTested = 0, combinedTested = 0, m1te2Tested = 0;

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
        // An off-palette color (R=1 isn't a 5-bit SNES channel) → reported mismatch.
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

      // 4. BG1 M1TE ".M1" round-trip (pixel + palette; no placement). The Map16 region →
      //    one .M1 (v2 holds up to 64×64 8×8 cells). Unedited → 0 edits; flipping the .M1 CHR
      //    yields edits only for writable (faithful) tiles, all 32 B, 0 word edits; a palette
      //    edit isolates to its CGRAM index.
      {
        const m1 = bg1RegionM1te2(ctx, region);
        assert(m1.cols <= MAP_STRIDE && m1.rows <= MAP_STRIDE, `BG1 M1TE → one .M1 (${m1.cols}×${m1.rows} cells, ≤64)`);
        // A larger-than-32×32-Map16 area is CROPPED to the top-left block — still ONE .M1, ≤64×64.
        const bigRect = { col0: scr.sx * 16, row0: scr.sy * 16, cols: 40, rows: 36 };
        const big = bg1RegionM1te2(ctx, renderBg1Region(ctx, levelDataBuffer, screenPageMap, bigRect));
        assert(big.cols <= MAP_STRIDE && big.rows <= MAP_STRIDE,
          `BG1 M1TE crops a >32×32-cell area to the top-left block (got ${big.cols}×${big.rows} cells)`);
        const clean = diffBg1RegionM1te2(ctx, region, m1.bytes);
        assert(clean.tileEdits.length === 0 && clean.wordEdits.length === 0 && clean.paletteEdits.length === 0,
          `BG1 M1TE unedited round-trips (0 tile / 0 word / 0 palette)`);
        if (faithful > 0) {
          // Flip a byte in every CHR tile → writable tiles produce 32 B edits, others skip;
          // BG1 never writes a tilemap word.
          const edited = m1.bytes.slice()
          for (let t = 1; t < 1024; t++) edited[OFF_CHR4 + t * 32]! ^= 0xff
          const d = diffBg1RegionM1te2(ctx, region, edited)
          assert(d.tileEdits.length >= 1 && d.wordEdits.length === 0 && d.tileEdits.every((e) => e.bytes.length === 32),
            `BG1 M1TE CHR edit → ${d.tileEdits.length} writable tile(s) of 32 B, 0 words`)
        }
        // Palette edit: recolor a used row's color 1 (never a blacked transparent slot).
        if (region.paletteRowsUsed.length > 0) {
          const pi = region.paletteRowsUsed[0]! * 16 + 1
          const pe = m1.bytes.slice()
          const orig = pe[OFF_PALETTE + pi * 2]! | (pe[OFF_PALETTE + pi * 2 + 1]! << 8)
          const nc = (orig ^ 0x001f) & 0x7fff
          pe[OFF_PALETTE + pi * 2] = nc & 0xff; pe[OFF_PALETTE + pi * 2 + 1] = (nc >> 8) & 0xff
          const dp = diffBg1RegionM1te2(ctx, region, pe)
          assert(dp.paletteEdits.length === 1 && dp.paletteEdits[0]!.cgramIndex === pi && dp.paletteEdits[0]!.bgr15 === nc,
            `BG1 M1TE 1-color palette edit → exactly that CGRAM index`)
        }
        m1te2Tested++;
      }

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
    // The aseprite palette must match the PNG swatch — each row's color 0 is
    // transparent on these layers (NOT an opaque color the artist could mis-use).
    let palMatch = true;
    const cprPal = region.bpp === 4 ? 16 : 4;
    region.paletteRowsUsed.forEach((row, k) => {
      const swatch = buildPaletteRow(bgCtx.cgram, row, true, 'expand', cprPal);
      for (let i = 0; i < cprPal; i++) if ((flat.palette[k * cprPal + i] ?? 0) !== swatch[i]) palMatch = false;
    });
    assert(palMatch, `BG${layer} aseprite palette matches the PNG swatch (per-row color 0 transparent)`);

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

    // 5. COMBINED import — the 8×8 PIXEL `.aseprite` as a single authoritative source of
    //    truth (diffBgRegionCombined): pixels written by tile INDEX + every 16×16 word
    //    rewritten from its 2×2 group. Unedited → 0 tile + 0 word edits; an index pixel
    //    edit on one editable tileset tile → exactly that CHR tile (0 words); a 16×16
    //    block move → exactly that one word (0 tile edits, dest priority preserved).
    const cstruct = decodeAsepriteStructural(bgRegionAseprite(bgCtx, region));
    const c0 = diffBgRegionCombined(bgCtx, region, cstruct, tmAddr);
    assert(c0.tileEdits.length === 0 && c0.wordEdits.length === 0,
      `BG${layer} combined round-trips (0 tile + 0 word edits, ${cstruct.numTiles} tiles)`);
    combinedTested++;

    // Pixel edit: blank one opaque pixel of a tileset tile referenced by an editable cell.
    const w8 = region.width / 8;
    let editTile = -1;
    for (const subc of region.subCells) {
      if (!subc.gfx) continue;
      const cell = cstruct.cells[(subc.pxY / 8) * w8 + subc.pxX / 8];
      if (cell && cell.tile > 0) { editTile = cell.tile; break; }
    }
    if (editTile >= 0) {
      const tp = cstruct.tilePixels.slice();
      const tbase = editTile * 64;
      let px = -1;
      for (let i = 0; i < 64; i++) { const a = tp[tbase + i]!; if (a !== 0 && a !== cstruct.transparentIndex) { px = i; break; } }
      if (px >= 0) {
        tp[tbase + px] = 0; // blank an opaque pixel → a real, in-row CHR change
        const cd = diffBgRegionCombined(bgCtx, region, { ...cstruct, tilePixels: tp }, tmAddr);
        assert(cd.tileEdits.length === 1 && cd.wordEdits.length === 0 && cd.tileEdits[0]!.bytes.length === tileBytes,
          `BG${layer} combined pixel edit → exactly 1 CHR tile (${tileBytes} B), 0 words`);
      }
    }

    // Block move: copy native cell cj's whole 2×2 group into ci (reuse the placement
    // section's ci/cj). The reconstructed word = cj's char/palette/flip + ci's priority.
    if (ci >= 0 && cj >= 0) {
      const sps = region.tileSize / 8;
      const sci2 = topLeft.get(ci)!, scj2 = topLeft.get(cj)!;
      const gxi = ci % nAcross, gyi = Math.floor(ci / nAcross);
      const gxj = cj % nAcross, gyj = Math.floor(cj / nAcross);
      const ccells = cstruct.cells.slice();
      for (let sy = 0; sy < sps; sy++) for (let sx = 0; sx < sps; sx++) {
        ccells[(gyi * sps + sy) * w8 + (gxi * sps + sx)] = cstruct.cells[(gyj * sps + sy) * w8 + (gxj * sps + sx)]!;
      }
      const cd = diffBgRegionCombined(bgCtx, region, { ...cstruct, cells: ccells }, tmAddr);
      const expWord = (scj2.entry & 0xdfff) | (sci2.entry & 0x2000); // cj word, ci priority
      assert(cd.wordEdits.length === 1 && cd.tileEdits.length === 0 &&
        cd.wordEdits[0]!.fileOffset === sci2.memoryEntryOff - tmAddr && cd.wordEdits[0]!.word === expWord,
        `BG${layer} combined block move → exactly that word (got ${cd.wordEdits.length} words / ${cd.tileEdits.length} tiles, word 0x${cd.wordEdits[0]?.word.toString(16)} vs 0x${expWord.toString(16)})`);
    }

    // 6. SHARED-CHR idempotency (regression): a CHR used under ≥2 palette rows is exported as
    //    multiple Aseprite tiles that all write back to one fileTile. Editing it under ONE
    //    row, then re-importing the SAME file, must NOT flip-flop (the user-reported bug).
    //    Simulate the saveGfxEdit→live feedback: apply the edit to a cloned base, re-diff with
    //    the stable VANILLA baseVram → 0 edits. (Without the fix, the unedited sibling view
    //    reverts the edit, so the re-import re-reports it forever / alternates.)
    {
      const charRows = new Map<number, Set<number>>();
      for (const s of region.subCells) { if (!s.gfx) continue; const set = charRows.get(s.charTile) ?? new Set(); set.add(s.paletteRow); charRows.set(s.charTile, set); }
      let sharedChar = -1; for (const [c, rows] of charRows) if (rows.size >= 2) { sharedChar = c; break; }
      if (sharedChar >= 0) {
        const sc = region.subCells.find((s) => s.charTile === sharedChar && s.gfx)!;
        const editTile = cstruct.cells[(sc.pxY / 8) * (region.width / 8) + sc.pxX / 8]!.tile;
        const tp = cstruct.tilePixels.slice(), tb = editTile * 64;
        const vals = new Set<number>(); for (let i = 0; i < 64; i++) { const a = tp[tb + i]!; if (a) vals.add(a); }
        const dv = [...vals];
        if (editTile > 0 && dv.length >= 2) {
          for (let i = 0; i < 64; i++) if (tp[tb + i] === dv[0]) { tp[tb + i] = dv[1]!; break; } // in-row recolor
          const editedStruct = { ...cstruct, tilePixels: tp };
          const vanilla = bgCtx.vram.slice();
          const d1 = diffBgRegionCombined(bgCtx, region, editedStruct, tmAddr, { baseVram: vanilla });
          assert(d1.tileEdits.length === 1, `BG${layer} shared-CHR edit → exactly 1 CHR write (got ${d1.tileEdits.length})`);
          // Apply the edit to a cloned base (the live-cache feedback) and re-import.
          const charAddr = layer === 2 ? bgCtx.regs.bg2CharAddr : bgCtx.regs.bg3CharAddr;
          const vram2 = bgCtx.vram.slice(); vram2.set(d1.tileEdits[0]!.bytes, (charAddr + sharedChar * tileBytes) & 0xffff);
          const d2 = diffBgRegionCombined({ ...bgCtx, vram: vram2 }, region, editedStruct, tmAddr, { baseVram: vanilla });
          assert(d2.tileEdits.length === 0, `BG${layer} shared-CHR re-import is idempotent (got ${d2.tileEdits.length}; the flip-flop bug if > 0)`);
          combinedTested++;
        }
      }
    }

    // 7. Placement into a NON-EDITABLE (transparent "sky" / wraparound) cell must still
    //    write a word — placement isn't gated on the cell's pixel-editability (the
    //    "blank-area placement ignored" bug). Copy a coherent editable block into a gated
    //    cell and assert it produces a word edit at that cell. AND an all-empty (Aseprite-
    //    trimmed) group is kept as-is (no word edit, not counted incoherent).
    {
      const sps2 = region.tileSize / 8;
      let gated = -1, src = -1;
      for (const [idx, s] of topLeft) {
        if (!s.gfx && s.memoryEntryOff >= 0 && gated < 0) gated = idx;
        if (s.gfx && src < 0) src = idx;
      }
      if (gated >= 0 && src >= 0) {
        const gx = gated % nAcross, gy = Math.floor(gated / nAcross);
        const sx0 = src % nAcross, sy0 = Math.floor(src / nAcross);
        const cells = cstruct.cells.slice();
        for (let sy = 0; sy < sps2; sy++) for (let sx = 0; sx < sps2; sx++)
          cells[(gy * sps2 + sy) * w8 + (gx * sps2 + sx)] = cstruct.cells[(sy0 * sps2 + sy) * w8 + (sx0 * sps2 + sx)]!;
        const cd = diffBgRegionCombined(bgCtx, region, { ...cstruct, cells }, tmAddr);
        const want = topLeft.get(gated)!.memoryEntryOff - tmAddr;
        assert(cd.wordEdits.some((e) => e.fileOffset === want),
          `BG${layer} placement into a non-editable (sky) cell writes a word (not skipped)`);
      }
      // EXPLICIT CLEAR: emptying a cell that's INSIDE the cel writes a char-0 word (keeping
      // palette row + priority); emptying one OUTSIDE the cel (an Aseprite-trimmed cell that
      // re-expanded to tile 0) is kept as the cart's original word, not cleared.
      if (src >= 0) {
        const gx = src % nAcross, gy = Math.floor(src / nAcross);
        const sc0 = topLeft.get(src)!;
        const cells = cstruct.cells.slice();
        for (let sy = 0; sy < sps2; sy++) for (let sx = 0; sx < sps2; sx++)
          cells[(gy * sps2 + sy) * w8 + (gx * sps2 + sx)] = { tile: 0 };
        const want = sc0.memoryEntryOff - tmAddr;
        // in-cel (full export ⇒ celBounds covers everything) → cleared to char 0.
        const din = diffBgRegionCombined(bgCtx, region, { ...cstruct, cells }, tmAddr);
        const ein = din.wordEdits.find((e) => e.fileOffset === want);
        assert(!!ein && ein.word === (sc0.entry & 0x3c00),
          `BG${layer} clearing an in-cel cell → char-0 word (kept palRow/priority; got 0x${ein?.word.toString(16)})`);
        // out-of-cel (celBounds excludes this column) → kept, not cleared.
        const celBounds = { col: gx * sps2 + sps2, row: 0, cols: w8, rows: cstruct.hTiles };
        const dout = diffBgRegionCombined(bgCtx, region, { ...cstruct, cells, celBounds }, tmAddr);
        assert(!dout.wordEdits.some((e) => e.fileOffset === want),
          `BG${layer} an off-cel (trimmed) empty cell is kept, not cleared`);
      }
    }

    // 8. M1TE2 ".M1" session round-trip: export the WHOLE layer as one .M1 (v2 holds up to
    //    64×64), re-diff unedited → 0 edits; then a 1-tile CHR edit, a 1-word tilemap edit,
    //    and a 1-color palette edit each isolate to exactly one change.
    {
      const m1 = bgRegionM1te2(bgCtx, region);
      const ts2 = region.tileSize;
      const cols2 = region.width / ts2, rows2 = region.height / ts2;
      assert(m1.cols === cols2 && m1.rows === rows2,
        `BG${layer} M1TE2 → one .M1 covering ${cols2}×${rows2} cells (got ${m1.cols}×${m1.rows})`);
      const clean = diffBgRegionM1te2(bgCtx, region, m1.bytes, tmAddr);
      assert(clean.tileEdits.length === 0 && clean.wordEdits.length === 0 && clean.paletteEdits.length === 0,
        `BG${layer} M1TE2 unedited round-trips (0 tile / 0 word / 0 palette)`);

      const chrBase = region.bpp === 4 ? OFF_CHR4 : OFF_CHR2;
      // CHR edit: flip a byte of an editable tile's CHR → exactly that one CHR tile.
      const ec = region.subCells.find((s) => s.gfx);
      if (ec) {
        const b = m1.bytes.slice();
        b[chrBase + ec.charTile * tileBytes]! ^= 0xff;
        const d = diffBgRegionM1te2(bgCtx, region, b, tmAddr);
        assert(d.tileEdits.length === 1 && d.tileEdits[0]!.fileId === ec.gfx!.fileId &&
          d.tileEdits[0]!.fileTile === ec.gfx!.fileTile && d.tileEdits[0]!.bytes.length === tileBytes,
          `BG${layer} M1TE2 1-tile CHR edit → exactly that CHR tile (${tileBytes} B)`);
      }
      // Word edit: change one editable cell's tilemap word (at the doc's 64-stride) → exactly that word.
      const wcell = region.subCells.find((s) => s.gfx && s.pxX % ts2 === 0 && s.pxY % ts2 === 0 &&
        s.pxX / ts2 < MAP_STRIDE && s.pxY / ts2 < MAP_STRIDE);
      if (wcell) {
        const wo = OFF_MAPS + (layer - 1) * MAP_WORDS * 2 + ((wcell.pxY / ts2) * MAP_STRIDE + wcell.pxX / ts2) * 2;
        const b = m1.bytes.slice();
        const nw = (wcell.entry ^ 0x0001) & 0xffff;
        b[wo] = nw & 0xff; b[wo + 1] = (nw >> 8) & 0xff;
        const d = diffBgRegionM1te2(bgCtx, region, b, tmAddr);
        assert(d.wordEdits.length === 1 && d.wordEdits[0]!.fileOffset === wcell.memoryEntryOff - tmAddr &&
          d.wordEdits[0]!.word === nw,
          `BG${layer} M1TE2 1-word edit → exactly that tilemap word`);
      }
      // Palette edit: recolor a used, non-blacked CGRAM index (col 1 ≠ any blacked slot).
      const cpr2 = region.bpp === 4 ? 16 : 4;
      const pi = region.paletteRowsUsed[0]! * cpr2 + 1;
      {
        const b = m1.bytes.slice();
        const orig = b[OFF_PALETTE + pi * 2]! | (b[OFF_PALETTE + pi * 2 + 1]! << 8);
        const nc = (orig ^ 0x001f) & 0x7fff;
        b[OFF_PALETTE + pi * 2] = nc & 0xff; b[OFF_PALETTE + pi * 2 + 1] = (nc >> 8) & 0xff;
        const d = diffBgRegionM1te2(bgCtx, region, b, tmAddr);
        assert(d.paletteEdits.length === 1 && d.paletteEdits[0]!.cgramIndex === pi && d.paletteEdits[0]!.bgr15 === nc,
          `BG${layer} M1TE2 1-color palette edit → exactly that CGRAM index`);
      }
      m1te2Tested++;
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
assert(combinedTested > 0, `combined (authoritative 8×8) import exercised (${combinedTested})`);
assert(m1te2Tested > 0, `M1TE2 .M1 session round-trip exercised (${m1te2Tested})`);
console.log(`\n  [gated (non-editable) BG2/BG3 sub-cells seen across levels: ${gatedSeen}]`);

console.log(`\n${failures === 0 ? '✓ all bg-region pins pass' : `✗ ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
