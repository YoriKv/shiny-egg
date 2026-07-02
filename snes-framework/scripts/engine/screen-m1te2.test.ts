// M1TE2 ".M1" system-screen export/import (screen-m1te2.ts). Pins, for each tilemap screen
// (title island, storybook first scene — the logo is excluded; it'd render with the wrong
// palette base in M1TE):
//   1. exportScreenM1 emits the two .M1 files, each a valid 74000-byte v2 session;
//   2. an unedited .M1 round-trips to ZERO edits;
//   3. a 1-tile CHR edit routes to the right char file ($B1 / f27);
//   4. an island word edit → exactly that char (storybook has no placement);
//   5. a 1-color palette edit → exactly that CGRAM color.
//
// Run: node snes-framework/scripts/engine/screen-m1te2.test.ts (reference-cart-gated).

import { loadDevCart } from './dev-cart.ts';
import { M1TE2_SIZE, parseM1te2, encodeM1te2 } from './m1te2.ts';
import { buildStorybookSceneContext } from './screen-scene.ts';
import { buildTitleIslandContext } from './screen-title-island.ts';
import { buildBonusSceneContext } from './screen-bonus.ts';
import {
  exportScreenM1,
  buildTitleIslandM1, diffTitleIslandM1,
  buildStorybookSceneM1, diffStorybookSceneM1,
  buildBonusM1, diffBonusM1,
  buildBonusBackdropM1, diffBonusBackdropM1
} from './screen-m1te2.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => { if (!c) { console.error(`  ✗ ${m}`); failures++; } else console.log(`  ✓ ${m}`); };

const { rom, symbols } = loadDevCart();

// ── (1) file set ─────────────────────────────────────────────────────────────
const files = exportScreenM1(rom, symbols);
assert(files.length === 9, `9 screen .M1 files exported — island + storybook + 6 bonus games + shared backdrop (got ${files.length})`);
assert(files.every((f) => f.bytes.length === M1TE2_SIZE), 'every screen .M1 is the v2 74000-byte size');
assert(files.filter((f) => f.kind === 'bonus-game').length === 6, 'six bonus-game .M1 files');
assert(files.filter((f) => f.kind === 'bonus-backdrop').length === 1, 'one shared bonus-backdrop .M1');
assert(files.some((f) => f.file === 'screens/title/island.M1') && files.some((f) => f.file === 'screens/storybook/scene.M1'),
  'screen .M1 files are named per surface');
assert(!files.some((f) => f.file.includes('logo')), 'the title logo is NOT exported as .M1');

// ── (3) ISLAND round-trip ────────────────────────────────────────────────────
{
  const ctx = buildTitleIslandContext(rom, symbols);
  const m1 = buildTitleIslandM1(ctx);
  const clean = diffTitleIslandM1(ctx, m1);
  assert(clean.charEdits.length === 0 && clean.placement.length === 0 && clean.paletteEdits.length === 0,
    `unedited island .M1 → 0 edits (char ${clean.charEdits.length}, place ${clean.placement.length})`);

  // CHR: edit island char 0's pixels → exactly that $B1 char (CPC re-pack differs).
  const doc = parseM1te2(m1);
  doc.chr4bpp[0] = doc.chr4bpp[0]! ^ 0x0f;
  const dChr = diffTitleIslandM1(ctx, encodeM1te2(doc));
  assert(dChr.charEdits.length === 1 && dChr.charEdits[0]!.char === 0 && dChr.charEdits[0]!.bytes.length === 32,
    `an island CHR edit → exactly one $B1 CPC char (got ${dChr.charEdits.length})`);

  // Placement: change island cell 0's char to another valid char → exactly that byte.
  const doc2 = parseM1te2(m1);
  const newChar = (ctx.tilemap[0]! + 1) % Math.floor(ctx.b1cpc.length / 32);
  doc2.maps[0][0] = newChar;
  const dPlace = diffTitleIslandM1(ctx, encodeM1te2(doc2));
  assert(dPlace.placement.length === 1 && dPlace.placement[0]!.offset === 0 && dPlace.placement[0]!.value === newChar,
    `an island word edit → exactly that char byte (got ${dPlace.placement.length}, value ${dPlace.placement[0]?.value})`);

  const doc3 = parseM1te2(m1);
  doc3.palette[2] = doc3.palette[2]! ^ 0x10;
  assert(diffTitleIslandM1(ctx, encodeM1te2(doc3)).paletteEdits.length === 1, 'an island palette edit → exactly one CGRAM color');
}

// ── (4) STORYBOOK SCENE round-trip (pixels-only) ─────────────────────────────
{
  const ctx = buildStorybookSceneContext(rom, symbols);
  const m1 = buildStorybookSceneM1(ctx);
  const clean = diffStorybookSceneM1(ctx, m1);
  assert(clean.chrEdits.length === 0 && clean.paletteEdits.length === 0,
    `unedited storybook scene .M1 → 0 edits (chr ${clean.chrEdits.length})`);

  // CHR: edit an f27-backed tile in the BG3 char window → exactly that f27 tile.
  const f27 = ctx.f27;
  let f27Tile = -1;
  for (let t = 0; t < 1024; t++) {
    const vb = (ctx.regs.bg3CharAddr + t * 16) & 0xffff;
    if (vb >= f27.vramByteOffset && vb < f27.vramByteOffset + f27.sizeBytes) { f27Tile = t; break; }
  }
  assert(f27Tile >= 0, 'found an f27 tile in the BG3 char window');
  const doc = parseM1te2(m1);
  doc.chr2bpp[f27Tile * 16] = doc.chr2bpp[f27Tile * 16]! ^ 0xff;
  const dChr = diffStorybookSceneM1(ctx, encodeM1te2(doc));
  assert(dChr.chrEdits.length === 1 && dChr.chrEdits[0]!.fileId === f27.fileId,
    `a storybook CHR edit → exactly one f27 tile (got ${dChr.chrEdits.length}, file 0x${dChr.chrEdits[0]?.fileId.toString(16)})`);

  const doc2 = parseM1te2(m1);
  doc2.palette[2] = doc2.palette[2]! ^ 0x10;
  assert(diffStorybookSceneM1(ctx, encodeM1te2(doc2)).paletteEdits.length === 1, 'a storybook palette edit → exactly one CGRAM color');
}

// ── (5) BONUS-GAME round-trips (all six) ─────────────────────────────────────
for (let g = 0; g < 6; g++) {
  const ctx = buildBonusSceneContext(rom, symbols, g);
  const m1 = buildBonusM1(ctx);
  const clean = diffBonusM1(ctx, m1);
  assert(clean.chrEdits.length === 0 && clean.wordEdits.length === 0 && clean.paletteEdits.length === 0,
    `bonus ${g}: unedited .M1 → 0 edits (chr ${clean.chrEdits.length}, words ${clean.wordEdits.length}, pal ${clean.paletteEdits.length})`);

  if (g === 0) {
    // CHR: flip a byte in a scene-file-backed 4bpp tile → exactly one file tile.
    const f = ctx.manifest.find((e) => e.vramByteOffset === 0xe000)!; // the $21 BG char literal
    const t = ((f.vramByteOffset - ctx.regs.bg1CharAddr) & 0xffff) / 32;
    const doc = parseM1te2(m1);
    doc.chr4bpp[t * 32] = doc.chr4bpp[t * 32]! ^ 0xff;
    const dChr = diffBonusM1(ctx, encodeM1te2(doc));
    assert(dChr.chrEdits.length === 1 && dChr.chrEdits[0]!.fileId === f.fileId && dChr.chrEdits[0]!.fileTile === 0,
      `bonus CHR edit → exactly one tile of the owning char file (got ${dChr.chrEdits.length}, file 0x${dChr.chrEdits[0]?.fileId.toString(16)})`);

    // Placement: change a BG1 word → the per-game BG1 tilemap file. (BG3 lives in
    // the shared backdrop .M1 — below.)
    const doc2 = parseM1te2(m1);
    doc2.maps[0][5] = doc2.maps[0][5]! ^ 0x1;
    const dW = diffBonusM1(ctx, encodeM1te2(doc2));
    assert(dW.wordEdits.length === 1 && dW.wordEdits[0]!.fileId === ctx.bg1TmFileId && dW.wordEdits[0]!.fileOffset === 10,
      `BG1 word edit → the per-game BG1 tilemap file at the right offset (got ${dW.wordEdits.length})`);
    assert(parseM1te2(m1).tileSize === 8, 'per-game .M1 is 8×8 tile mode');

    const doc3 = parseM1te2(m1);
    doc3.palette[2] = doc3.palette[2]! ^ 0x10;
    assert(diffBonusM1(ctx, encodeM1te2(doc3)).paletteEdits.length === 1, 'a bonus palette edit → exactly one CGRAM color');
  }
}

// ── (6) BONUS BACKDROP (shared BG3 $95, 16×16 tile mode) ─────────────────────
{
  const ctx = buildBonusSceneContext(rom, symbols, 0);
  const m1 = buildBonusBackdropM1(ctx);
  assert(parseM1te2(m1).tileSize === 16, 'backdrop .M1 is 16×16 tile mode (matches the BG3 BGMODE bit)');
  const clean = diffBonusBackdropM1(ctx, m1);
  assert(clean.chrEdits.length === 0 && clean.wordEdits.length === 0 && clean.paletteEdits.length === 0,
    `unedited backdrop .M1 → 0 edits (chr ${clean.chrEdits.length}, words ${clean.wordEdits.length})`);

  // A BG3 word edit → the SHARED $95 tilemap file.
  const doc = parseM1te2(m1);
  doc.maps[2][7] = doc.maps[2][7]! ^ 0x1;
  const dW = diffBonusBackdropM1(ctx, encodeM1te2(doc));
  assert(dW.wordEdits.length === 1 && dW.wordEdits[0]!.fileId === ctx.bg3TmFileId && dW.wordEdits[0]!.fileOffset === 14,
    `backdrop word edit → the shared BG3 tilemap file (got ${dW.wordEdits.length})`);
  assert(ctx.bg3TmFileId === 0x95, 'the shared BG3 tilemap is $95');

  // A 2bpp CHR edit in a scene-file-backed tile → that file.
  const doc2 = parseM1te2(m1);
  let hit = -1;
  for (let t = 0; t < 1024 && hit < 0; t++) {
    const vb = (ctx.regs.bg3CharAddr + t * 16) & 0xffff;
    if (ctx.manifest.some((f) => vb >= f.vramByteOffset && vb + 16 <= f.vramByteOffset + f.sizeBytes)) hit = t;
  }
  assert(hit >= 0, 'found a file-backed 2bpp tile in the BG3 char window');
  doc2.chr2bpp[hit * 16] = doc2.chr2bpp[hit * 16]! ^ 0xff;
  const dChr = diffBonusBackdropM1(ctx, encodeM1te2(doc2));
  assert(dChr.chrEdits.length === 1 && dChr.chrEdits[0]!.bytes.length === 16,
    `a backdrop CHR edit → exactly one 2bpp file tile (got ${dChr.chrEdits.length})`);
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
