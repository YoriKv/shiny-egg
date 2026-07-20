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
  buildBonusBackdropM1, diffBonusBackdropM1,
  buildMiniBattleM1, diffMiniBattleM1, miniBattleDistinctScreens,
  buildMiniBattlePlayfieldM1, diffMiniBattlePlayfieldM1,
  buildMiniBattleResultM1, diffMiniBattleResultM1,
  buildStorybookIntroM1, diffStorybookIntroM1
} from './screen-m1te2.ts';
import { buildMiniBattleSceneContext, buildMiniBattleResultContext, miniBattleDistinctPlayfields } from './screen-minibattle.ts';
import { buildStorybookIntroContext } from './screen-storybook-intro.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => { if (!c) { console.error(`  ✗ ${m}`); failures++; } else console.log(`  ✓ ${m}`); };

const { rom, symbols } = loadDevCart();

// ── (1) file set ─────────────────────────────────────────────────────────────
const files = exportScreenM1(rom, symbols);
assert(files.length === 25, `25 screen .M1 files exported — island + storybook scene + storybook intro + 6 bonus games + shared backdrop + 6 mini-battle score screens + 7 playfields + 2 result screens (got ${files.length})`);
assert(files.filter((f) => f.kind === 'storybook-intro').length === 1, 'one storybook-intro .M1');
assert(files.filter((f) => f.kind === 'minibattle').length === 6, 'six mini-battle score .M1 files');
assert(files.filter((f) => f.kind === 'minibattle-playfield').length === 7, 'seven mini-battle playfield .M1 files');
assert(files.filter((f) => f.kind === 'minibattle-result').length === 2, 'two mini-battle result .M1 files');
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

// ── (6) MINI-BATTLE SCORE-SCREEN round-trip (BG3-only .M1, per-file map) ──────
{
  const screens = miniBattleDistinctScreens(rom, symbols);
  assert(screens.length === 6 && screens.map((s) => s.fileId).join(',') === [0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7].join(','),
    `six distinct mini-battle score tilemaps $A2-$A7 (got ${screens.map((s) => s.fileId.toString(16)).join(',')})`);

  const ctx = buildMiniBattleSceneContext(rom, symbols, screens[0]!.subMode);
  assert(ctx.bg3TmFileId === 0xa2, 'sub-mode 0 uses score tilemap $A2');
  assert(ctx.regs.bg3TilemapAddr === 0x6800, 'mini-battle BG3 tilemap at byte $6800 (scene $2A)');
  const m1 = buildMiniBattleM1(ctx);
  assert(m1.length === M1TE2_SIZE, 'mini-battle .M1 is the v2 74000-byte size');
  // 8×8 tiles: CODE_118216 toggles BGMODE bit 6 off scene $2A's 16×16 default
  // when it draws the score screen (16×16 rendered these with doubled letters).
  assert(parseM1te2(m1).tileSize === 8, 'mini-battle score .M1 is 8×8 tile mode');
  const clean = diffMiniBattleM1(ctx, m1);
  assert(clean.chrEdits.length === 0 && clean.wordEdits.length === 0 && clean.paletteEdits.length === 0,
    `unedited mini-battle .M1 → 0 edits (chr ${clean.chrEdits.length}, words ${clean.wordEdits.length}, pal ${clean.paletteEdits.length})`);

  // A BG3 word edit → that screen's OWN tilemap file ($A2).
  const doc = parseM1te2(m1);
  doc.maps[2][5] = doc.maps[2][5]! ^ 0x1;
  const dW = diffMiniBattleM1(ctx, encodeM1te2(doc));
  assert(dW.wordEdits.length === 1 && dW.wordEdits[0]!.fileId === 0xa2 && dW.wordEdits[0]!.fileOffset === 10,
    `mini-battle word edit → the $A2 tilemap file at offset 10 (got ${dW.wordEdits.length}, file 0x${dW.wordEdits[0]?.fileId.toString(16)})`);

  // A 2bpp CHR edit in a scene-file-backed tile → that file.
  const doc2 = parseM1te2(m1);
  let hit = -1;
  for (let t = 0; t < 1024 && hit < 0; t++) {
    const vb = (ctx.regs.bg3CharAddr + t * 16) & 0xffff;
    if (ctx.manifest.some((f) => f.format !== undefined && vb >= f.vramByteOffset && vb + 16 <= f.vramByteOffset + f.sizeBytes && f.vramByteOffset !== 0x6800)) hit = t;
  }
  assert(hit >= 0, 'found a file-backed 2bpp tile in the mini-battle BG3 char window');
  doc2.chr2bpp[hit * 16] = doc2.chr2bpp[hit * 16]! ^ 0xff;
  const dChr = diffMiniBattleM1(ctx, encodeM1te2(doc2));
  assert(dChr.chrEdits.length === 1 && dChr.chrEdits[0]!.bytes.length === 16,
    `a mini-battle CHR edit → exactly one 2bpp file tile (got ${dChr.chrEdits.length})`);

  // A palette edit → exactly one CGRAM color, and it is blob-backed (provenance).
  const doc3 = parseM1te2(m1);
  doc3.palette[2 * 2] = doc3.palette[2 * 2]! ^ 0x10;
  const dPal = diffMiniBattleM1(ctx, encodeM1te2(doc3));
  assert(dPal.paletteEdits.length === 1 && ctx.provenance[dPal.paletteEdits[0]!.cgramIndex]! >= 0,
    `a mini-battle palette edit → one blob-backed CGRAM color (got ${dPal.paletteEdits.length})`);

  // The program-$C2 palette fills the result-screen rows 6/7 (blob-backed).
  assert(ctx.cgram.slice(96 * 2, 128 * 2).some((b) => b !== 0) && ctx.provenance[97]! >= 0,
    'scene palette program $C2 fills rows 6/7 with blob-backed colors');
}

// ── (6b) MINI-BATTLE RESULT round-trip ($9D/$9E — BG2 curtain at byte $7800) ─
for (const result of [0, 1]) {
  const ctx = buildMiniBattleResultContext(rom, symbols, result);
  const wantFile = result === 0 ? 0x9d : 0x9e;
  assert(ctx.resultTmFileId === wantFile, `result ${result} uses tilemap $${wantFile.toString(16).toUpperCase()}`);
  const m1 = buildMiniBattleResultM1(ctx);
  assert(m1.length === M1TE2_SIZE && parseM1te2(m1).tileSize === 8,
    `result ${result} .M1 is the v2 size in 8×8 tile mode`);
  const clean = diffMiniBattleResultM1(ctx, m1);
  assert(clean.chrEdits.length === 0 && clean.wordEdits.length === 0 && clean.paletteEdits.length === 0,
    `unedited result ${result} .M1 → 0 edits (chr ${clean.chrEdits.length}, words ${clean.wordEdits.length}, pal ${clean.paletteEdits.length})`);

  // A BG2 word edit → that result's OWN tilemap file.
  const doc = parseM1te2(m1);
  doc.maps[1][3] = doc.maps[1][3]! ^ 0x1;
  const dW = diffMiniBattleResultM1(ctx, encodeM1te2(doc));
  assert(dW.wordEdits.length === 1 && dW.wordEdits[0]!.fileId === wantFile && dW.wordEdits[0]!.fileOffset === 6,
    `result ${result} word edit → the $${wantFile.toString(16).toUpperCase()} file at offset 6 (got ${dW.wordEdits.length}, file 0x${dW.wordEdits[0]?.fileId.toString(16)})`);

  // A CHR edit on a curtain motif char (wraps past $FFFF into the $25/$26
  // files) → exactly one 4bpp file tile.
  const usedChar = doc.maps[1][0]! & 0x3ff;
  const doc2 = parseM1te2(m1);
  doc2.chr4bpp[usedChar * 32] = doc2.chr4bpp[usedChar * 32]! ^ 0xff;
  const dChr = diffMiniBattleResultM1(ctx, encodeM1te2(doc2));
  assert(dChr.chrEdits.length === 1 && dChr.chrEdits[0]!.bytes.length === 32,
    `result ${result} CHR edit on the wrapped motif char → exactly one 4bpp file tile (got ${dChr.chrEdits.length})`);
}

// ── (6c) MINI-BATTLE PLAYFIELD round-trip (BG1 $D000 + BG2 upper $7000) ──────
{
  const pfs = miniBattleDistinctPlayfields(rom, symbols);
  assert(pfs.length === 7, `seven distinct playfield scenes (got ${pfs.length})`);
  // BG1 $96 serves TWO scenes (different char sets + BG2) — the file-pair
  // naming exists because of this.
  assert(pfs.filter((p) => p.bg1TmFileId === 0x96).length === 2 &&
    files.some((f) => f.file === 'screens/minibattle/playfield-96-9c.M1') &&
    files.some((f) => f.file === 'screens/minibattle/playfield-96-9f.M1'),
    'bg1 $96 serves two scenes → playfield-96-9c + playfield-96-9f');

  const ctx = buildMiniBattleSceneContext(rom, symbols, pfs[0]!.subMode);
  assert(ctx.bg1TmFileId === 0x96 && ctx.bg2TmFileId === 0x9c, 'sub-mode 0 playfield is $96 (BG1) + $9C (BG2)');
  assert(ctx.regs.bg1TilemapAddr === 0xd000 && ctx.regs.bg2TilemapAddr === 0x7000,
    'scene $2A puts BG1 at byte $D000 and BG2 at byte $7000');
  const m1 = buildMiniBattlePlayfieldM1(ctx);
  assert(m1.length === M1TE2_SIZE && parseM1te2(m1).tileSize === 8 && parseM1te2(m1).mapHeight === 32,
    'playfield .M1 is the v2 size, 8×8 tiles, 32 rows');
  const clean = diffMiniBattlePlayfieldM1(ctx, m1);
  assert(clean.chrEdits.length === 0 && clean.wordEdits.length === 0 && clean.paletteEdits.length === 0,
    `unedited playfield .M1 → 0 edits (chr ${clean.chrEdits.length}, words ${clean.wordEdits.length}, pal ${clean.paletteEdits.length})`);

  // BG1 + BG2 word edits → each layer's own file at the right offset.
  const doc = parseM1te2(m1);
  doc.maps[0][5] = doc.maps[0][5]! ^ 0x1;
  doc.maps[1][7] = doc.maps[1][7]! ^ 0x1;
  const dW = diffMiniBattlePlayfieldM1(ctx, encodeM1te2(doc));
  const got = dW.wordEdits.map((w) => `$${w.fileId.toString(16)}@${w.fileOffset}`).join(',');
  assert(dW.wordEdits.length === 2 && got === '$96@10,$9c@14',
    `playfield BG1/BG2 word edits route to $96 offset 10 + $9C offset 14 (got ${got})`);

  // A CHR edit on a used BG1 char → exactly one 4bpp file tile.
  const usedChar = doc.maps[0].find((w) => w !== 0)! & 0x3ff;
  const doc2 = parseM1te2(m1);
  doc2.chr4bpp[usedChar * 32] = doc2.chr4bpp[usedChar * 32]! ^ 0xff;
  const dChr = diffMiniBattlePlayfieldM1(ctx, encodeM1te2(doc2));
  assert(dChr.chrEdits.length === 1 && dChr.chrEdits[0]!.bytes.length === 32,
    `a playfield CHR edit → exactly one 4bpp file tile (got ${dChr.chrEdits.length})`);

  // Every playfield round-trips clean.
  for (const p of pfs.slice(1)) {
    const c = buildMiniBattleSceneContext(rom, symbols, p.subMode);
    const d = diffMiniBattlePlayfieldM1(c, buildMiniBattlePlayfieldM1(c));
    assert(d.chrEdits.length === 0 && d.wordEdits.length === 0 && d.paletteEdits.length === 0,
      `playfield $${p.bg1TmFileId.toString(16)}-$${p.bg2TmFileId.toString(16)} (sub ${p.subMode}): unedited .M1 → 0 edits`);
  }
}

// ── (7) STORYBOOK INTRO round-trip (gm$38 — BG2 $A8 + BG3 $A9 in one .M1) ────
{
  const ctx = buildStorybookIntroContext(rom, symbols);
  assert(ctx.bg2TmFileId === 0xa8 && ctx.bg3TmFileId === 0xa9, 'storybook-intro tilemaps are $A8 (BG2) + $A9 (BG3)');
  assert(ctx.regs.bg2TilemapAddr === 0x7000 && ctx.regs.bg3TilemapAddr === 0x6800,
    'scene $04 puts BG2 at byte $7000 and BG3 at byte $6800');
  assert(ctx.regs.bg2TileSize === 16 && ctx.regs.bg3TileSize === 16, 'BG2+BG3 are 16×16 tile mode (BGMODE $69)');
  const a8 = ctx.manifest.find((f) => f.format === 'lz2' && f.fileId === 0xa8);
  assert(a8?.sizeBytes === 0x1000, `$A8 decompresses to exactly $1000 bytes = the full 32×64 BG2 map (got $${a8?.sizeBytes.toString(16)})`);
  const m1 = buildStorybookIntroM1(ctx);
  assert(m1.length === M1TE2_SIZE, 'storybook-intro .M1 is the v2 74000-byte size');
  assert(parseM1te2(m1).mapHeight === 64, 'storybook-intro .M1 spans the full 64-row BG2 map');
  const clean = diffStorybookIntroM1(ctx, m1);
  assert(clean.chrEdits.length === 0 && clean.wordEdits.length === 0 && clean.paletteEdits.length === 0,
    `unedited storybook-intro .M1 → 0 edits (chr ${clean.chrEdits.length}, words ${clean.wordEdits.length}, pal ${clean.paletteEdits.length})`);

  // A BG2 word edit (slot 1) → $A8; a BG3 word edit (slot 2) → $A9.
  const doc = parseM1te2(m1);
  doc.maps[1][5] = doc.maps[1][5]! ^ 0x1;
  doc.maps[2][7] = doc.maps[2][7]! ^ 0x1;
  const dW = diffStorybookIntroM1(ctx, encodeM1te2(doc));
  assert(dW.wordEdits.length === 2
      && dW.wordEdits.some((w) => w.fileId === 0xa8 && w.fileOffset === 10)
      && dW.wordEdits.some((w) => w.fileId === 0xa9 && w.fileOffset === 14),
    `BG2/BG3 word edits route to $A8 offset 10 + $A9 offset 14 (got ${dW.wordEdits.map((w) => `$${w.fileId.toString(16)}@${w.fileOffset}`).join(',')})`);

  // A 4bpp CHR edit in the BG2 char window → the owning scene file.
  const doc2 = parseM1te2(m1);
  let hit4 = -1;
  for (let t = 0; t < 1024 && hit4 < 0; t++) {
    const vb = (ctx.regs.bg2CharAddr + t * 32) & 0xffff;
    if (ctx.manifest.some((f) => vb >= f.vramByteOffset && vb + 32 <= f.vramByteOffset + f.sizeBytes)) hit4 = t;
  }
  assert(hit4 >= 0, 'found a file-backed 4bpp tile in the BG2 char window');
  doc2.chr4bpp[hit4 * 32] = doc2.chr4bpp[hit4 * 32]! ^ 0xff;
  const dChr4 = diffStorybookIntroM1(ctx, encodeM1te2(doc2));
  assert(dChr4.chrEdits.length === 1 && dChr4.chrEdits[0]!.bytes.length === 32,
    `a storybook-intro 4bpp CHR edit → exactly one file tile (got ${dChr4.chrEdits.length})`);

  // A palette edit → one blob-backed CGRAM color (the SETTLED fade-target
  // palette DATA_5FEC4A, not the white load-time fill).
  const doc3 = parseM1te2(m1);
  doc3.palette[3 * 2] = doc3.palette[3 * 2]! ^ 0x10;
  const dPal = diffStorybookIntroM1(ctx, encodeM1te2(doc3));
  assert(dPal.paletteEdits.length === 1 && ctx.provenance[dPal.paletteEdits[0]!.cgramIndex]! >= 0,
    `a storybook-intro palette edit → one blob-backed CGRAM color (got ${dPal.paletteEdits.length})`);
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
