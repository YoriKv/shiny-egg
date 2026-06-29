// Tests for the ROM-import diff helpers added to the gradient / island / logo /
// glyph-line (intro & ending) modules. Two tiers:
//   • Pure (always run): identity (foreign == base ⇒ no edits) + single-edit
//     detection, driven from the base asm text in the repo — no cart needed.
//   • Cart-gated (skips cleanly without the extracted reference cart): the base
//     CART must reproduce the base ASM exactly, so importing the base cart yields
//     ZERO spurious edits — and the glyph-line binary decoder must agree with the
//     asm model for vanilla data (the "clean entry" gate the importer relies on).
// Run: node snes-framework/scripts/rom-import-diff.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  diffForeignGradient,
  gradientLabels,
  gradientOffset,
  readGradientTables
} from './gradient-edit.ts';
import { diffForeignIslandTilemap, readIslandTilemapBytes } from './island-tilemap.ts';
import { diffForeignLogoTilemap, readLogoTilemapWords } from './logo-tilemap.ts';
import {
  ENDING_TEXT_ID,
  INTRO_STORY_ID,
  loadFontTable,
  parseEndingText,
  parseIntroStory,
  readForeignGlyphTable
} from './strings.ts';
import { snesToPC, vendoredV10SymbolMap } from './engine/symbol-map.ts';

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    process.exitCode = 1;
  }
}

const sameLines = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((l, i) => l === b[i]);

const here = path.dirname(fileURLToPath(import.meta.url));
const WORK_ROOT = path.join(here, '..');
const bank57 = fs.readFileSync(path.join(WORK_ROOT, 'yi', 'Banks', 'Bank57.asm'), 'utf8');
const bank01 = fs.readFileSync(path.join(WORK_ROOT, 'yi', 'Banks', 'Bank01.asm'), 'utf8');
const bank0F = fs.readFileSync(path.join(WORK_ROOT, 'yi', 'Banks', 'Bank0F.asm'), 'utf8');
const bank0D = fs.readFileSync(path.join(WORK_ROOT, 'yi', 'Banks', 'Bank0D.asm'), 'utf8');
const ft = loadFontTable(WORK_ROOT);
const labels = gradientLabels(bank01);

console.log('\n=== rom-import diff: pure (no cart) ===');

// ── Gradient ──
{
  const base = readGradientTables(bank57, labels); // number[][] (16 × 24)
  const id = diffForeignGradient(bank57, labels, (g, s) => base[g]![s]!);
  assert(id.length === 0, 'gradient: identity → no edits');
  const one = diffForeignGradient(bank57, labels, (g, s) =>
    g === 2 && s === 7 ? (base[2]![7]! ^ 0x1f) & 0xffff : base[g]![s]!
  );
  assert(
    one.length === 1 && one[0]!.offset === gradientOffset(2, 7),
    'gradient: one changed stop → one edit at the right offset'
  );
  // Tables whose foreign address can't resolve are skipped, not errored.
  const skip = diffForeignGradient(bank57, labels, () => undefined);
  assert(skip.length === 0, 'gradient: unresolvable foreign table → skipped (no edits)');
}

// ── Island tilemap ──
{
  const base = readIslandTilemapBytes(bank57);
  const id = diffForeignIslandTilemap(bank57, (off) => base[off]!);
  assert(id.length === 0, 'island: identity → no edits');
  const one = diffForeignIslandTilemap(bank57, (off) => (off === 5 ? base[5]! ^ 0xff : base[off]!));
  assert(one.length === 1 && one[0]!.offset === 5, 'island: one changed cell → one edit');
}

// ── Logo tilemap ──
{
  const base = readLogoTilemapWords(bank0F);
  const id = diffForeignLogoTilemap(bank0F, (i) => base[i]!);
  assert(id.length === 0, 'logo: identity → no edits');
  const one = diffForeignLogoTilemap(bank0F, (i) => (i === 9 ? base[9]! ^ 0xffff : base[i]!));
  assert(one.length === 1 && one[0]!.offset === 9, 'logo: one changed cell → one edit');
}

// ── Cart-gated: base cart must reproduce the base asm (no spurious import) ──
const BASE = path.join(WORK_ROOT, 'reference', 'reference.sfc');
if (!fs.existsSync(BASE)) {
  console.log(`\nSKIP cart-gated checks: reference cart not found at ${BASE} (run extract first).`);
  process.exit();
}
const cart = fs.readFileSync(BASE);
const sym = vendoredV10SymbolMap();

console.log('\n=== rom-import diff: base cart ≡ base asm (cart-gated) ===');

// Gradient — resolve each table's address by following the cart's own ptr table.
{
  const ptrPc = sym.pc('DATA_bg_gradient_ptrs');
  const edits = diffForeignGradient(bank57, labels, (g, s) => {
    const off = ptrPc + g * 4;
    const tablePc = snesToPC((cart.readUInt16LE(off) << 16) | cart.readUInt16LE(off + 2));
    return cart.readUInt16LE(tablePc + s * 2);
  });
  assert(edits.length === 0, 'gradient: base cart vs base asm → 0 edits');
}

// Island + logo at fixed cart addresses.
{
  const islandPc = sym.pc('DATA_5F9800');
  const edits = diffForeignIslandTilemap(bank57, (off) => cart[islandPc + off]!);
  assert(edits.length === 0, 'island: base cart vs base asm → 0 edits');
}
{
  const logoPc = sym.pc('DATA_title_screen_logo_tilemap');
  const edits = diffForeignLogoTilemap(bank0F, (i) => cart.readUInt16LE(logoPc + i * 2));
  assert(edits.length === 0, 'logo: base cart vs base asm → 0 edits');
}

// Glyph-line decoder agrees with the asm model for vanilla data (the importer's
// "clean entry" gate). Intro: at least some pages decode identically; the first
// page must decode its known opening line. Ending: the single entry matches fully.
console.log('\n=== rom-import diff: glyph-line decode (cart-gated) ===');
{
  const intro = parseIntroStory(bank0F, bank0F, ft);
  const dec = readForeignGlyphTable(cart, bank0F, ft, INTRO_STORY_ID);
  let clean = 0;
  for (const e of intro.entries) {
    const d = dec.get(e.label);
    if (d && d.ok && sameLines(d.lines, e.lines)) clean++;
  }
  assert(clean > 0, `intro: ≥1 page decodes from the cart identically to the asm model (got ${clean})`);
  const first = dec.get(intro.entries[0]!.label);
  assert(
    !!first && first.lines.join(' ').includes('A long, long time ago'),
    'intro: first page decodes its known opening line'
  );
}
{
  const ending = parseEndingText(bank0D, bank0D, ft);
  const dec = readForeignGlyphTable(cart, bank0D, ft, ENDING_TEXT_ID);
  let clean = 0;
  for (const e of ending.entries) {
    const d = dec.get(e.label);
    if (d && d.ok && sameLines(d.lines, e.lines)) clean++;
  }
  assert(
    clean === ending.entries.length,
    `ending: all ${ending.entries.length} entr${ending.entries.length === 1 ? 'y' : 'ies'} decode identically to the asm model`
  );
}
