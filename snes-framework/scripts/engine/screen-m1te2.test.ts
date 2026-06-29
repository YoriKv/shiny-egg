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
import {
  exportScreenM1,
  buildTitleIslandM1, diffTitleIslandM1,
  buildStorybookSceneM1, diffStorybookSceneM1
} from './screen-m1te2.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => { if (!c) { console.error(`  ✗ ${m}`); failures++; } else console.log(`  ✓ ${m}`); };

const { rom, symbols } = loadDevCart();

// ── (1) file set ─────────────────────────────────────────────────────────────
const files = exportScreenM1(rom, symbols);
assert(files.length === 2, `2 screen .M1 files exported (got ${files.length})`);
assert(files.every((f) => f.bytes.length === M1TE2_SIZE), 'every screen .M1 is the v2 74000-byte size');
assert(files.map((f) => f.kind).sort().join(',') === 'island,storybook-scene', 'kinds are island + storybook-scene (no logo)');
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

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
