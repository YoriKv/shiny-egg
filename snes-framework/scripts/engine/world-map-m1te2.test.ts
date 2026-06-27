// M1TE2 ".M1" world-map export/import (world-map-m1te2.ts). Pins:
//   1. exportWorldMapM1 emits 12 overworld halves (6 worlds × left/right) + 1 icons file,
//      each a valid 55568-byte .M1.
//   2. OVERWORLD: an unedited .M1 round-trips to ZERO edits; a 1-tile CHR edit → exactly
//      that map-char file edit; a 1-word edit → exactly that tilemap word; a 1-colour edit
//      → exactly that CGRAM colour.
//   3. ICONS: an unedited .M1 round-trips to zero edits; a per-level-icon pixel edit routes
//      to a bank-$53 write; a marker/castle pixel edit routes to a $74/$75 char edit; the
//      grid is laid out in level order (6 world-rows + the marker/castle row beneath).
//
// Run: node snes-framework/scripts/engine/world-map-m1te2.test.ts (reference-cart-gated).

import { loadDevCart } from './dev-cart.ts';
import { M1TE2_SIZE, parseM1te2, encodeM1te2 } from './m1te2.ts';
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
assert(overworlds.length === 12, `12 overworld halves exported (got ${overworlds.length})`);
assert(iconsFiles.length === 1, `1 icons file exported (got ${iconsFiles.length})`);
assert(files.every((f) => f.bytes.length === M1TE2_SIZE), 'every .M1 is the fixed 55568-byte size');
assert(files.some((f) => f.file === `screens/map/${overworldM1Name(0, 0)}`) && files.some((f) => f.file === `screens/map/${overworldM1Name(5, 1)}`),
  'overworld files are named per world + half (left/right)');
assert(iconsFiles[0]!.file === `screens/map/${ICONS_M1_NAME}`, 'icons file is screens/map/icons.M1');

// ── (2) OVERWORLD round-trip (world 0) ───────────────────────────────────────
const c = buildWorldMapTerrainContext(rom, symbols, 0);
const halves = buildOverworldM1(c);
assert(halves.length === 2, 'world 0 → 2 halves (left/right)');
const left = halves[0]!;
assert(left.bg1FileId === terrainLayerFileId(c, 0) && left.bg2FileId === terrainLayerFileId(c, 1) && left.bg3FileId === 0x7e,
  'overworld half wires BG1→$7C-class, BG2→$7D-class, BG3→$7E');

// Unedited → zero edits of any kind.
{
  const d = diffOverworldM1(c, left.bytes, 0);
  assert(d.chrEdits.length === 0 && d.wordEdits.length === 0 && d.paletteEdits.length === 0,
    `unedited overworld .M1 → 0 edits (chr ${d.chrEdits.length}, word ${d.wordEdits.length}, pal ${d.paletteEdits.length})`);
}

// A 1-tile CHR edit (tile 0x180 = VRAM $7000 = the $74 terrain char) → exactly that file/tile.
{
  const doc = parseM1te2(left.bytes);
  const T = 0x180;
  doc.chr4bpp[T * 32] = doc.chr4bpp[T * 32]! ^ 0xff; // perturb one bitplane row of one tile
  const d = diffOverworldM1(c, encodeM1te2(doc), 0);
  assert(d.chrEdits.length === 1, `a 1-tile overworld CHR edit → exactly one char edit (got ${d.chrEdits.length})`);
  assert(d.chrEdits[0]?.fileTile === 0, `the CHR edit targets tile 0 of the $74 file (vram $7000; got fileTile ${d.chrEdits[0]?.fileTile})`);
  assert(d.wordEdits.length === 0 && d.paletteEdits.length === 0, 'a CHR-only edit reports no word/palette edits');
}

// A 1-word edit (BG1 cell 0) → exactly that tilemap word, on the $7C-class file at offset 0.
{
  const doc = parseM1te2(left.bytes);
  doc.maps[0][0] = (doc.maps[0][0]! ^ 1) & 0xffff; // change the char of BG1 cell (0,0)
  const d = diffOverworldM1(c, encodeM1te2(doc), 0);
  assert(d.wordEdits.length === 1 && d.wordEdits[0]!.fileId === left.bg1FileId && d.wordEdits[0]!.fileOffset === 0,
    `a 1-word BG1 edit → exactly that tilemap word (got ${d.wordEdits.length}, file 0x${d.wordEdits[0]?.fileId.toString(16)}, off ${d.wordEdits[0]?.fileOffset})`);
  assert(d.wordEdits[0]!.word === doc.maps[0][0], 'the word edit carries the verbatim SNES word');
  assert(d.chrEdits.length === 0, 'a word-only edit reports no CHR edits');
}

// A 1-colour palette edit (CGRAM index 1, not an auto-blacked slot) → exactly that colour.
{
  const doc = parseM1te2(left.bytes);
  doc.palette[2] = doc.palette[2]! ^ 0x10; // index 1's low byte
  const d = diffOverworldM1(c, encodeM1te2(doc), 0);
  assert(d.paletteEdits.length === 1 && d.paletteEdits[0]!.cgramIndex === 1,
    `a 1-colour overworld edit → exactly that CGRAM colour (got ${d.paletteEdits.length}, index ${d.paletteEdits[0]?.cgramIndex})`);
}

// A different world / half has different content (sanity: not a constant).
{
  const c5 = buildWorldMapTerrainContext(rom, symbols, 5);
  const r = buildOverworldM1(c5)[1]!;
  assert(r.world === 5 && r.half === 1, 'world 5 right half is addressable');
  assert(diffOverworldM1(c5, r.bytes, 1).wordEdits.length === 0, 'world 5 right half round-trips to 0 words too');
}

// ── (3) ICONS round-trip ─────────────────────────────────────────────────────
const icons = buildIconsM1(rom, symbols);
assert(icons.length === M1TE2_SIZE, 'icons .M1 is the fixed size');
{
  const d = diffIconsM1(rom, symbols, icons);
  assert(d.levelWrites.length === 0 && d.markerCastleEdits.length === 0 && d.levelIconsChanged === 0 && d.markerCastleChanged === 0,
    `unedited icons .M1 → 0 edits (level ${d.levelIconsChanged}, marker/castle ${d.markerCastleChanged})`);
}

// Layout: per-world rows fill rows 0-17 (6 worlds × 3 cells) + a marker/castle row at 18.
const idoc = parseM1te2(icons);
const tileAt = (row: number, col: number): number => idoc.maps[0][row * 32 + col]! & 0x3ff;
const rowHasContent = (row: number): boolean => { for (let c0 = 0; c0 < 32; c0++) if (tileAt(row, c0) !== 0) return true; return false; };
assert(rowHasContent(0) && rowHasContent(17), 'icons grid fills the first (world 0) and last (world 5) per-level rows');
assert(rowHasContent(18), 'icons grid has the marker/castle row beneath the worlds (level order)');
assert(!rowHasContent(24), 'icons grid stops after the marker/castle row');

// Palette FAITHFULNESS: each icon is coloured in its REAL palette, deduped into ≤8 M1TE2 rows
// (not the old "every world → OBJ row 8" scheme that miscoloured the row-9 icons). World 0's
// slot 0 (OBJ row 8) and slot 1 (OBJ row 9) must land in DIFFERENT palette rows, each holding
// that icon's actual OBJ colours.
{
  const lctx = buildLevelIconContext(rom, symbols, 0);
  const s0 = renderWorldMapLevelIcon(lctx, 0)!; // paletteRow 0 → OBJ row 8
  const s1 = renderWorldMapLevelIcon(lctx, 1)!; // paletteRow 1 → OBJ row 9
  assert(s0.paletteRow !== s1.paletteRow, 'precondition: world-0 slots 0 and 1 use different OBJ rows');
  const palRowOf = (cell: number): number => (idoc.maps[0][cell]! >> 10) & 7; // top-left cell of each icon
  const r0 = palRowOf(0); // slot 0 top-left = grid (row 0, col 0)
  const r1 = palRowOf(3); // slot 1 top-left = grid (row 0, col 3) — each icon is 3 cells wide
  assert(r0 !== r1, 'the row-8 and row-9 icons land in DIFFERENT .M1 palette rows (faithful, not collapsed)');
  const colour = (buf: Uint8Array, row: number, i: number): number => (buf[row * 32 + i * 2]! | (buf[row * 32 + i * 2 + 1]! << 8)) & 0x7fff;
  const blockMatches = (m1Row: number, cgRow: number): boolean => { for (let i = 0; i < 16; i++) if (colour(idoc.palette, m1Row, i) !== colour(lctx.cgram, cgRow, i)) return false; return true; };
  assert(blockMatches(r0, 8 + s0.paletteRow) && blockMatches(r1, 8 + s1.paletteRow), 'each icon\'s .M1 palette row holds its real OBJ colours');
  // Distinct non-empty palette rows used ≤ 8 (fits) — and > 1 (proves the row split).
  const usedRows = new Set<number>();
  for (let c = 0; c < 1024; c++) { const w = idoc.maps[0][c]!; if ((w & 0x3ff) !== 0 || ((w >> 10) & 7) !== 0) usedRows.add((w >> 10) & 7); }
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
