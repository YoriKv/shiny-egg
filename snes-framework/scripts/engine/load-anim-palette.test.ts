// Pins the frame-0 animated-palette port (load-anim-palette.ts) against the
// real V1.0 cart: each animation type must overwrite exactly the CGRAM colour
// rows its asm routine targets (`copy_anim_palette_row` dest X), and type 0 must
// be a no-op. Reference-cart-gated — skips cleanly when the build is absent.
//
// Run: node snes-framework/scripts/engine/load-anim-palette.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyAnimatedPalette } from './load-anim-palette.ts';

const BUILD_DIR = path.resolve(import.meta.dirname, '../../build');
const cartPath = path.join(BUILD_DIR, "Super Mario World 2 - Yoshi's Island (USA V1.0).sfc");

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
}

if (!fs.existsSync(cartPath)) {
  console.error(`built ROM not found at ${cartPath} — run a V1.0 build first`);
  process.exit(0);
}
const rom = new Uint8Array(fs.readFileSync(cartPath));

/** Build a 15-field header with a given animation palette + optional tileset/
 *  palette fields (the only header inputs the overlay reads). */
function header(animPal: number, opts: { bg1Tileset?: number; bg2Palette?: number; bg3Palette?: number } = {}): number[] {
  const h = new Array(15).fill(0);
  h[1] = opts.bg1Tileset ?? 0;
  h[4] = opts.bg2Palette ?? 0;
  h[6] = opts.bg3Palette ?? 0;
  h[11] = animPal;
  return h;
}

/** Set of CGRAM COLOUR indices the overlay writes, found via a two-sentinel
 *  probe: a written byte equals the ROM source (which can't be BOTH 0x00 and
 *  0xFF), so "changed from 0x00 OR changed from 0xFF" is the exact write set —
 *  independent of the source values. */
function writtenColors(h: number[]): Set<number> {
  const a = new Uint8Array(512).fill(0x00);
  const b = new Uint8Array(512).fill(0xff);
  applyAnimatedPalette(rom, a, h);
  applyAnimatedPalette(rom, b, h);
  const out = new Set<number>();
  for (let c = 0; c < 256; c++) {
    const i = c * 2;
    if (a[i] !== 0x00 || a[i + 1] !== 0x00 || b[i] !== 0xff || b[i + 1] !== 0xff) out.add(c);
  }
  return out;
}

const range = (lo: number, hi: number): number[] => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
const eqSet = (got: Set<number>, want: number[]): boolean =>
  got.size === want.length && want.every((c) => got.has(c));
const fmt = (s: Set<number>): string => [...s].sort((a, b) => a - b).join(',');

// Type 0 — no animation: pure no-op.
{
  const cg = new Uint8Array(512).fill(0x5a);
  applyAnimatedPalette(rom, cg, header(0x00));
  assert(cg.every((b) => b === 0x5a), 'type 0x00 is a no-op (cgram untouched)');
}

// Single-row types: written colours == the asm target row exactly.
{
  // $01 anim_pal_01 → X=$86 (colour 67), 26 bytes = colours 67..79.
  assert(eqSet(writtenColors(header(0x01)), range(67, 79)), `type 0x01 writes colours 67-79 (got ${fmt(writtenColors(header(0x01)))})`);
  // $02 dir-aware base → X=$0A (colour 5), 6 bytes = colours 5..7.
  assert(eqSet(writtenColors(header(0x02)), range(5, 7)), `type 0x02 writes colours 5-7 (got ${fmt(writtenColors(header(0x02)))})`);
  // $03 → X=$E0 (colour 112), 32 bytes = colours 112..127.
  assert(eqSet(writtenColors(header(0x03)), range(112, 127)), `type 0x03 writes colours 112-127 (got ${fmt(writtenColors(header(0x03)))})`);
  // $09 → CGRAM colours 1 and 9 (one shared word).
  assert(eqSet(writtenColors(header(0x09)), [1, 9]), `type 0x09 writes colours 1,9 (got ${fmt(writtenColors(header(0x09)))})`);
  // $0F → X=$0A (colour 5), 6 bytes = colours 5..7.
  assert(eqSet(writtenColors(header(0x0f)), range(5, 7)), `type 0x0f writes colours 5-7 (got ${fmt(writtenColors(header(0x0f)))})`);
}

// Header-conditional: $0D selects its source by BG3 palette bit 0 but writes the
// SAME row (colours 1..3) either way; $05 c644 prefix only fires for BG1&7==0.
{
  assert(eqSet(writtenColors(header(0x0d, { bg3Palette: 0 })), range(1, 3)), 'type 0x0d (BG3pal even) writes colours 1-3');
  assert(eqSet(writtenColors(header(0x0d, { bg3Palette: 1 })), range(1, 3)), 'type 0x0d (BG3pal odd) writes colours 1-3');
  // $05: BG1&7==0 → c644 adds colours 2-7 + 67-79 on top of c5c1's 113-120.
  const w0 = writtenColors(header(0x05, { bg1Tileset: 0 }));
  const w1 = writtenColors(header(0x05, { bg1Tileset: 1 })); // BG1&7 != 0 → c644 skipped
  assert([2, 3, 67, 113].every((c) => w0.has(c)), 'type 0x05 (BG1&7==0) writes the c644 rows (2-7, 67-79) + c5c1 (113-120)');
  assert(![67].some((c) => w1.has(c)) && w1.has(113), 'type 0x05 (BG1&7!=0) skips c644, writes only c5c1 (113-120)');
}

// Idempotence: applying twice equals once (the overlay is a pure overwrite).
{
  const once = new Uint8Array(512).fill(0x11);
  const twice = new Uint8Array(512).fill(0x11);
  applyAnimatedPalette(rom, once, header(0x0e, { bg1Tileset: 8, bg2Palette: 1 }));
  applyAnimatedPalette(rom, twice, header(0x0e, { bg1Tileset: 8, bg2Palette: 1 }));
  applyAnimatedPalette(rom, twice, header(0x0e, { bg1Tileset: 8, bg2Palette: 1 }));
  assert(once.every((b, i) => b === twice[i]), 'overlay is idempotent (apply twice == once)');
}

if (failures) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ all animated-palette pins pass');
