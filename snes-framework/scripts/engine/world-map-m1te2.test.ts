// M1TE2 ".M1" world-map export/import (world-map-m1te2.ts). Pins:
//   1. exportWorldMapM1 emits 6 overworlds (one per world, the full 64×32 screen) + 1 icons
//      file, each a valid 74000-byte v2 .M1.
//   2. OVERWORLD: an unedited .M1 round-trips to ZERO edits; a 1-tile CHR edit → exactly
//      that map-char file edit; a 1-word edit → exactly that tilemap word; a 1-color edit
//      → exactly that CGRAM color; a color RESET-to-vanilla over a prior override → a revert
//      edit back to base (the diff is relative to the context cgram = base ⊕ existing edits).
//   3. ICONS: an unedited .M1 round-trips to zero edits; a per-level-icon pixel edit routes
//      to a bank-$53 write; a marker/castle pixel edit routes to a $74/$75 char edit; the
//      grid is laid out in level order (6 world-rows + the marker/castle row beneath).
//
// Run: node snes-framework/scripts/engine/world-map-m1te2.test.ts (reference-cart-gated).

import { loadDevCart } from './dev-cart.ts';
import { M1TE2_SIZE, MAP_STRIDE, MAP_WORDS, parseM1te2, encodeM1te2 } from './m1te2.ts';
import { buildWorldMapTerrainContext, terrainLayerFileId } from './world-map-terrain.ts';
import { buildLevelIconContext, renderWorldMapLevelIcon } from './world-map-level-icons.ts';
import {
  buildOverworldM1, diffOverworldM1, buildIconsM1, diffIconsM1, exportWorldMapM1,
  overworldM1Name, ICONS_M1_NAME
} from './world-map-m1te2.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => { if (!c) { console.error(`  ✗ ${m}`); failures++; } else console.log(`  ✓ ${m}`); };

const { rom, symbols } = loadDevCart();

// ── (1) file set ─────────────────────────────────────────────────────────────
const files = exportWorldMapM1(rom, symbols);
const overworlds = files.filter((f) => f.kind === 'overworld');
const iconsFiles = files.filter((f) => f.kind === 'icons');
assert(overworlds.length === 6, `6 overworlds exported, one per world (got ${overworlds.length})`);
assert(iconsFiles.length === 1, `1 icons file exported (got ${iconsFiles.length})`);
assert(files.every((f) => f.bytes.length === M1TE2_SIZE), 'every .M1 is the v2 74000-byte size');
assert(files.some((f) => f.file === `screens/map/${overworldM1Name(0)}`) && files.some((f) => f.file === `screens/map/${overworldM1Name(5)}`),
  'overworld files are named per world (no left/right half)');
assert(iconsFiles[0]!.file === `screens/map/${ICONS_M1_NAME}`, 'icons file is screens/map/icons.M1');

// ── (2) OVERWORLD round-trip (world 0) ───────────────────────────────────────
const c = buildWorldMapTerrainContext(rom, symbols, 0);
const ov = buildOverworldM1(c);
assert(ov.world === 0, 'world 0 → one overworld .M1');
assert(ov.bg1FileId === terrainLayerFileId(c, 0) && ov.bg2FileId === terrainLayerFileId(c, 1) && ov.bg3FileId === 0x7e,
  'overworld wires BG1→$7C-class, BG2→$7D-class, BG3→$7E');

// Unedited → zero edits of any kind. (Also implicitly pins the tileset-1 ✕ skip: the export
// now writes a ✕ marker to char 1-255, yet the diff reports 0 CHR edits.)
{
  const d = diffOverworldM1(c, ov.bytes);
  assert(d.chrEdits.length === 0 && d.wordEdits.length === 0 && d.paletteEdits.length === 0,
    `unedited overworld .M1 → 0 edits (chr ${d.chrEdits.length}, word ${d.wordEdits.length}, pal ${d.paletteEdits.length})`);
  assert(d.tileset1Cells === 0, 'a vanilla overworld references no tileset-1 cells');
}

// Tileset-1 ✕ marker: the unloaded char-0-255 band is fully painted (ALL of tiles 0..255,
// incl. tile 0 — YI has no empty-tile sentinel), and a cell pointing into it is flagged but
// still round-trips verbatim. char 0 is flagged like any other tileset-1 char.
{
  const doc = parseM1te2(ov.bytes);
  const tileBlank = (t: number): boolean => { for (let i = 0; i < 32; i++) if (doc.chr4bpp[t * 32 + i] !== 0) return false; return true; };
  assert(!tileBlank(0) && !tileBlank(1) && !tileBlank(255), 'tileset-1 tiles 0..255 all carry the ✕ marker (incl. tile 0)');

  const word = (0x64 | (3 << 10)) & 0xffff; // char 100 (tileset 1), some palette row
  const doc2 = parseM1te2(ov.bytes);
  doc2.maps[0][0] = word;
  const d2 = diffOverworldM1(c, encodeM1te2(doc2));
  assert(d2.tileset1Cells === 1, `a tileset-1 BG1 cell is flagged (got ${d2.tileset1Cells})`);
  assert(d2.wordEdits.some((w) => w.word === word), 'the tileset-1 cell still round-trips its verbatim word (still imports)');

  // A char-0 cell (M1TE's "empty"/erase) is flagged too — YI draws char 0 from char base $4000.
  const doc3 = parseM1te2(ov.bytes);
  doc3.maps[0][0] = 0; // char 0 on a BG1 cell that was non-zero in vanilla
  const d3 = diffOverworldM1(c, encodeM1te2(doc3));
  assert(d3.tileset1Cells === 1, `a char-0 BG1 cell is flagged as tileset-1 use (got ${d3.tileset1Cells})`);
}

// A 1-tile CHR edit (tile 0x180 = VRAM $7000 = the $74 terrain char) → exactly that file/tile.
{
  const doc = parseM1te2(ov.bytes);
  const T = 0x180;
  doc.chr4bpp[T * 32] = doc.chr4bpp[T * 32]! ^ 0xff; // perturb one bitplane row of one tile
  const d = diffOverworldM1(c, encodeM1te2(doc));
  assert(d.chrEdits.length === 1, `a 1-tile overworld CHR edit → exactly one char edit (got ${d.chrEdits.length})`);
  assert(d.chrEdits[0]?.fileTile === 0, `the CHR edit targets tile 0 of the $74 file (vram $7000; got fileTile ${d.chrEdits[0]?.fileTile})`);
  assert(d.wordEdits.length === 0 && d.paletteEdits.length === 0, 'a CHR-only edit reports no word/palette edits');
}

// A 1-word edit (BG1 cell 0) → exactly that tilemap word, on the $7C-class file at offset 0.
{
  const doc = parseM1te2(ov.bytes);
  doc.maps[0][0] = (doc.maps[0][0]! ^ 1) & 0xffff; // change the char of BG1 cell (0,0)
  const d = diffOverworldM1(c, encodeM1te2(doc));
  assert(d.wordEdits.length === 1 && d.wordEdits[0]!.fileId === ov.bg1FileId && d.wordEdits[0]!.fileOffset === 0,
    `a 1-word BG1 edit → exactly that tilemap word (got ${d.wordEdits.length}, file 0x${d.wordEdits[0]?.fileId.toString(16)}, off ${d.wordEdits[0]?.fileOffset})`);
  assert(d.wordEdits[0]!.word === doc.maps[0][0], 'the word edit carries the verbatim SNES word');
  assert(d.chrEdits.length === 0, 'a word-only edit reports no CHR edits');
}

// A 1-word edit in the RIGHT half (col 32, row 0) → the BG1 file at the right-screen offset
// ($400 words in). Proves the consolidated 64-wide map reaches both screen-blocks.
{
  const doc = parseM1te2(ov.bytes);
  const idx = 0 * MAP_STRIDE + 32; // (col 32, row 0) in the doc's stride-64 grid
  doc.maps[0][idx] = (doc.maps[0][idx]! ^ 1) & 0xffff;
  const d = diffOverworldM1(c, encodeM1te2(doc));
  assert(d.wordEdits.length === 1 && d.wordEdits[0]!.fileId === ov.bg1FileId && d.wordEdits[0]!.fileOffset === 0x400 * 2,
    `a right-half BG1 edit → the BG1 file at the right-screen offset (got off ${d.wordEdits[0]?.fileOffset}, want ${0x400 * 2})`);
}

// A 1-color palette edit (CGRAM index 1, not an auto-blacked slot) → exactly that color.
{
  const doc = parseM1te2(ov.bytes);
  doc.palette[2] = doc.palette[2]! ^ 0x10; // index 1's low byte
  const d = diffOverworldM1(c, encodeM1te2(doc));
  assert(d.paletteEdits.length === 1 && d.paletteEdits[0]!.cgramIndex === 1,
    `a 1-color overworld edit → exactly that CGRAM color (got ${d.paletteEdits.length}, index ${d.paletteEdits[0]?.cgramIndex})`);
}

// RESET-TO-VANILLA over a prior override still round-trips. The diff is relative to the
// CONTEXT's cgram, so the importer diffs against base ⊕ existing palette edits (gfx-png-import.ts
// `foldLivePaletteIntoScene`), NOT the raw base cart. Here a saved override lives in the baseline
// cgram while the .M1 holds that slot's ORIGINAL base color: the diff must emit a REVERT edit back
// to base — otherwise the reset reads as "no change" and the stale override is stranded (the
// diff-vs-base trap this whole path exists to avoid: a non-base color always differs and imports,
// but reverting to base wouldn't). `ov.bytes` is the vanilla world-0 .M1, so its palette IS base.
{
  const cRev = buildWorldMapTerrainContext(rom, symbols, 0);
  const baseColor = (cRev.scene.cgram[2]! | (cRev.scene.cgram[3]! << 8)) & 0x7fff; // index 1
  cRev.scene.cgram[2] = cRev.scene.cgram[2]! ^ 0x10; // a prior saved edit folded into the baseline
  const d = diffOverworldM1(cRev, ov.bytes);
  assert(d.paletteEdits.length === 1 && d.paletteEdits[0]!.cgramIndex === 1 && d.paletteEdits[0]!.bgr15 === baseColor,
    `reset-to-vanilla over a prior override → a revert edit back to base (got ${d.paletteEdits.length}, index ` +
    `${d.paletteEdits[0]?.cgramIndex}, color 0x${d.paletteEdits[0]?.bgr15.toString(16)} want 0x${baseColor.toString(16)})`);
}

// A different world has different content (sanity: not a constant), and round-trips clean.
{
  const c5 = buildWorldMapTerrainContext(rom, symbols, 5);
  const r = buildOverworldM1(c5);
  assert(r.world === 5, 'world 5 is addressable');
  assert(diffOverworldM1(c5, r.bytes).wordEdits.length === 0, 'world 5 round-trips to 0 words too');
}

// ── (3) ICONS round-trip ─────────────────────────────────────────────────────
const icons = buildIconsM1(rom, symbols);
assert(icons.length === M1TE2_SIZE, 'icons .M1 is the v2 size');
{
  const d = diffIconsM1(rom, symbols, icons);
  assert(d.levelWrites.length === 0 && d.markerCastleEdits.length === 0 && d.levelIconsChanged === 0 && d.markerCastleChanged === 0,
    `unedited icons .M1 → 0 edits (level ${d.levelIconsChanged}, marker/castle ${d.markerCastleChanged})`);
}

// Layout: per-world rows fill rows 0-17 (6 worlds × 3 cells) + a marker/castle row at 18.
// The icons fill a 32-wide region of the doc's 64-stride grid.
const idoc = parseM1te2(icons);
const tileAt = (row: number, col: number): number => idoc.maps[0][row * MAP_STRIDE + col]! & 0x3ff;
const rowHasContent = (row: number): boolean => { for (let c0 = 0; c0 < 32; c0++) if (tileAt(row, c0) !== 0) return true; return false; };
assert(rowHasContent(0) && rowHasContent(17), 'icons grid fills the first (world 0) and last (world 5) per-level rows');
assert(rowHasContent(18), 'icons grid has the marker/castle row beneath the worlds (level order)');
assert(!rowHasContent(24), 'icons grid stops after the marker/castle row');

// Palette FAITHFULNESS: each icon is colored in its REAL palette, deduped into ≤8 M1TE2 rows
// (not the old "every world → OBJ row 8" scheme that miscolored the row-9 icons). World 0's
// slot 0 (OBJ row 8) and slot 1 (OBJ row 9) must land in DIFFERENT palette rows, each holding
// that icon's actual OBJ colors.
{
  const lctx = buildLevelIconContext(rom, symbols, 0);
  const s0 = renderWorldMapLevelIcon(lctx, 0)!; // paletteRow 0 → OBJ row 8
  const s1 = renderWorldMapLevelIcon(lctx, 1)!; // paletteRow 1 → OBJ row 9
  assert(s0.paletteRow !== s1.paletteRow, 'precondition: world-0 slots 0 and 1 use different OBJ rows');
  const palRowOf = (row: number, col: number): number => (idoc.maps[0][row * MAP_STRIDE + col]! >> 10) & 7; // top-left cell of each icon
  const r0 = palRowOf(0, 0); // slot 0 top-left = grid (row 0, col 0)
  const r1 = palRowOf(0, 3); // slot 1 top-left = grid (row 0, col 3) — each icon is 3 cells wide
  assert(r0 !== r1, 'the row-8 and row-9 icons land in DIFFERENT .M1 palette rows (faithful, not collapsed)');
  // Palette buffer stride is 16 colors × 2 bytes = 32 (NOT the map stride).
  const color = (buf: Uint8Array, row: number, i: number): number => (buf[row * 32 + i * 2]! | (buf[row * 32 + i * 2 + 1]! << 8)) & 0x7fff;
  const blockMatches = (m1Row: number, cgRow: number): boolean => { for (let i = 0; i < 16; i++) if (color(idoc.palette, m1Row, i) !== color(lctx.cgram, cgRow, i)) return false; return true; };
  assert(blockMatches(r0, 8 + s0.paletteRow) && blockMatches(r1, 8 + s1.paletteRow), 'each icon\'s .M1 palette row holds its real OBJ colors');
  // Distinct non-empty palette rows used ≤ 8 (fits) — and > 1 (proves the row split).
  const usedRows = new Set<number>();
  for (let c0 = 0; c0 < MAP_WORDS; c0++) { const w = idoc.maps[0][c0]!; if ((w & 0x3ff) !== 0 || ((w >> 10) & 7) !== 0) usedRows.add((w >> 10) & 7); }
  assert(usedRows.size > 1 && usedRows.size <= 8, `icons use a faithful set of palette rows (got ${usedRows.size}, expect 2..8)`);
}

// A per-level-icon pixel edit → a bank-$53 write (find a non-blank tile in the level region).
{
  const findTile = (rowLo: number, rowHi: number): number => {
    for (let r = rowLo; r <= rowHi; r++) for (let cc = 0; cc < 32; cc++) { const t = tileAt(r, cc); if (t !== 0) return t; }
    return 0;
  };
  const levelTile = findTile(0, 17);
  assert(levelTile !== 0, 'found a non-blank per-level-icon tile to edit');
  const doc = parseM1te2(icons);
  doc.chr4bpp[levelTile * 32] = doc.chr4bpp[levelTile * 32]! ^ 0x0f; // flip low nibble of a row
  const d = diffIconsM1(rom, symbols, encodeM1te2(doc));
  assert(d.levelWrites.length > 0 && d.levelIconsChanged >= 1,
    `a per-level-icon pixel edit → bank-$53 writes (got ${d.levelWrites.length} writes, ${d.levelIconsChanged} icons)`);

  const mcTile = findTile(18, 20);
  assert(mcTile !== 0, 'found a non-blank marker/castle tile to edit');
  const doc2 = parseM1te2(icons);
  doc2.chr4bpp[mcTile * 32] = doc2.chr4bpp[mcTile * 32]! ^ 0x0f;
  const d2 = diffIconsM1(rom, symbols, encodeM1te2(doc2));
  assert(d2.markerCastleEdits.length > 0 && d2.markerCastleChanged >= 1,
    `a marker/castle pixel edit → $74/$75 char edits (got ${d2.markerCastleEdits.length} edits)`);
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
