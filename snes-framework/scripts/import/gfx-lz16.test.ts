// Pins the unsized-lz16 sizing + diff path of the ROM importer (gfx-lz16.ts):
//
//   1. `probeLz16RowCount` over every extracted lz16 blob reproduces the
//      ycompress size table — the 187 row counts FuSoYa's ycompress.exe bakes
//      in (dumped from the exe's .data section and validated byte-exact via the
//      AllGFX.bin rebuild; research/graphics-editing/ycompress-allgfx.md §1/§7).
//      This is where that table lives in-repo: as pinned EXPECTED values, so a
//      future extract-slicing change that breaks probing fails loudly here.
//   2. The four orphaned LZ16-in-LZ2-slot blobs ($2C-$2F, `GFX_589AE6.lz2` …)
//      probe as lz16 rowCount 8 — corroborating their view-only typing.
//   3. `diffUnsizedLz16Gfx` end-to-end on a synthetic foreign cart:
//      unchanged → no findings; a ycompress-style re-encode of UNCHANGED art
//      (the property that makes the diff robust to a ycompress-reinserted
//      cart) → no findings; an edited sheet re-encoded in place → exactly that
//      sheet flagged with the edited tiles; `sizedIds` exclusion respected.
//
// Build-gated: skips cleanly without the built V1.0 ROM or the extract.
// Run: node snes-framework/scripts/import/gfx-lz16.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadDevCart, FRAMEWORK_ROOT, type DevCart } from '../engine/dev-cart.ts';
import { lz16, probeLz16RowCount, encodeLz16 } from '../engine/decompress/index.ts';
import { snesToPC } from '../engine/symbol-map.ts';
import { parseGfxPtrTable, gfxFileForLabel, GFX_ARENA } from '../gfx-reinsert.ts';
import { diffUnsizedLz16Gfx } from './gfx-lz16.ts';

let cart: DevCart;
try {
  cart = loadDevCart();
} catch (e) {
  console.log(`SKIP: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
  process.exit(0);
}
const { rom, symbols } = cart;

const gfxDir = path.join(FRAMEWORK_ROOT, 'assets', 'yi', 'Graphics');
if (!fs.existsSync(gfxDir)) {
  console.log('SKIP: no extract (assets/yi/Graphics missing)');
  process.exit(0);
}

let failures = 0;
const assert = (c: boolean, m: string): void => {
  if (c) console.log(`  ✓ ${m}`);
  else {
    console.error(`  ✗ ${m}`);
    failures++;
  }
};

// The ycompress expected-size table's lz16 segment (structure ids 0x11E-0x1D8),
// as row counts (size/512), indexed by lz16 file ID. Source: ycompress.exe 1.10
// x64 .data VA 0x140023790 (ycompress-allgfx.md §1/§7).
// prettier-ignore
const YCOMPRESS_LZ16_ROW_COUNTS = [
  8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 2, 8, 8, 8, 8, 8,
  8, 8, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 16, 4, 4, 4, 3, 8,
  8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 16, 16, 16, 16, 16, 8, 8, 8, 8,
  8, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 8, 8, 8, 8, 8, 8, 8,
  8, 2, 2, 2, 2, 2, 2, 2, 2, 8, 8, 8, 8, 4, 4, 4, 4, 8, 8
];

const bank06 = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'yi', GFX_ARENA.ptrBankFile), 'utf8');
const lz16Labels = parseGfxPtrTable(bank06, 'lz16');
const lz2Labels = parseGfxPtrTable(bank06, 'lz2');

// ── 1. probe(extracted blob) === ycompress row count, all 187 files ──
console.log('\n=== probe vs the ycompress size table ===');
assert(lz16Labels.length === 187, `lz16 pointer table has 187 entries (got ${lz16Labels.length})`);
assert(YCOMPRESS_LZ16_ROW_COUNTS.length === 187, 'baked table has 187 entries');
{
  const bad: string[] = [];
  for (let id = 0; id < lz16Labels.length; id++) {
    const p = path.join(gfxDir, gfxFileForLabel(lz16Labels[id]!, 'lz16'));
    if (!fs.existsSync(p)) {
      bad.push(`0x${id.toString(16)}: blob missing`);
      continue;
    }
    const rows = probeLz16RowCount(new Uint8Array(fs.readFileSync(p)));
    if (rows !== YCOMPRESS_LZ16_ROW_COUNTS[id]) {
      bad.push(`0x${id.toString(16)}: probed ${rows} expected ${YCOMPRESS_LZ16_ROW_COUNTS[id]}`);
    }
  }
  assert(bad.length === 0, `all 187 blobs probe to the ycompress row count${bad.length ? ` — ${bad.join('; ')}` : ''}`);
}

// ── 2. the orphaned LZ16-in-LZ2-slot blobs probe as lz16 rowCount 8 ──
console.log('\n=== orphan slots $2C-$2F ===');
for (const id of [0x2c, 0x2d, 0x2e, 0x2f]) {
  const p = path.join(gfxDir, gfxFileForLabel(lz2Labels[id]!, 'lz2'));
  const rows = fs.existsSync(p) ? probeLz16RowCount(new Uint8Array(fs.readFileSync(p))) : null;
  assert(rows === 8, `lz2-slot 0x${id.toString(16)} blob probes as lz16 rowCount 8 (got ${rows})`);
}

// ── 3. diffUnsizedLz16Gfx end-to-end on synthetic foreign carts ──
console.log('\n=== foreign diff ===');
const NONE = new Set<number>();
{
  const clean = diffUnsizedLz16Gfx(rom, rom, symbols, FRAMEWORK_ROOT, NONE);
  assert(clean.changed.length === 0 && clean.skipped === 0,
    `identical carts → 0 changed, 0 skipped (got ${clean.changed.length}/${clean.skipped})`);
}

// Blob slot length = distance from a blob's start to the next-higher blob start
// (both tables) or the arena boundary — the in-place re-encode fit check.
const tablePC16 = symbols.pc('DATA_lz16_compressed_gfx_ptrs');
const tablePC2 = symbols.pc('DATA_lz2_compressed_gfx_ptrs');
const starts: number[] = [];
for (let i = 0; i < lz2Labels.length; i++) {
  const p = tablePC2 + i * 3;
  starts.push(snesToPC(rom[p]! | (rom[p + 1]! << 8) | (rom[p + 2]! << 16)));
}
for (let i = 0; i < lz16Labels.length; i++) {
  const p = tablePC16 + i * 3;
  starts.push(snesToPC(rom[p]! | (rom[p + 1]! << 8) | (rom[p + 2]! << 16)));
}
starts.push(snesToPC(GFX_ARENA.boundary));
const sorted = [...new Set(starts)].sort((a, b) => a - b);
const slotLen = (start: number): number => {
  for (const s of sorted) if (s > start) return s - start;
  return 0;
};
const blobStart = (id: number): number => {
  const p = tablePC16 + id * 3;
  return snesToPC(rom[p]! | (rom[p + 1]! << 8) | (rom[p + 2]! << 16));
};

// Find a sheet whose re-encode (unchanged AND edited) fits its own slot in
// place — and whose unchanged re-encode DIFFERS from the cart's original stream
// bytes, so the "different bytes, same art" ycompress scenario is really
// exercised (our encoder reproduces Nintendo's stream byte-identically on some
// files, e.g. 0x1).
let picked = -1;
let baseTiles: Uint8Array = new Uint8Array(0);
let editedTiles: Uint8Array = new Uint8Array(0);
let reencUnchanged: Uint8Array = new Uint8Array(0);
let reencEdited: Uint8Array = new Uint8Array(0);
for (let id = 0; id < lz16Labels.length && picked < 0; id++) {
  const rows = YCOMPRESS_LZ16_ROW_COUNTS[id]!;
  const start = blobStart(id);
  const out = new Uint8Array(rows * 512);
  try {
    lz16(rom, start, out, 0, rows);
  } catch {
    continue;
  }
  const edited = out.slice();
  edited[0] ^= 0xff;
  const encU = encodeLz16(out, rows);
  const encE = encodeLz16(edited, rows);
  const streamDiffers = !bytesEq(rom.subarray(start, start + encU.length), encU);
  if (streamDiffers && encU.length <= slotLen(start) && encE.length <= slotLen(start)) {
    picked = id;
    baseTiles = out;
    editedTiles = edited;
    reencUnchanged = encU;
    reencEdited = encE;
  }
}
assert(picked >= 0, `found an in-place-fitting test sheet (picked 0x${picked.toString(16)})`);

if (picked >= 0) {
  const start = blobStart(picked);

  // ycompress-style: UNCHANGED art re-encoded with a different encoder → the
  // stream bytes differ but the decode doesn't → must NOT be flagged.
  const reenc = rom.slice();
  reenc.set(reencUnchanged, start);
  assert(!bytesEq(rom.subarray(start, start + reencUnchanged.length), reencUnchanged),
    'sanity: our re-encoding of unchanged art produces different stream bytes (the ycompress scenario)');
  const r1 = diffUnsizedLz16Gfx(reenc, rom, symbols, FRAMEWORK_ROOT, NONE);
  assert(r1.changed.length === 0 && r1.skipped === 0,
    `re-encoded UNCHANGED art → not flagged (got ${r1.changed.length} changed, ${r1.skipped} skipped)`);

  // Edited art → exactly that sheet flagged, with the edited tiles + row count.
  const hacked = rom.slice();
  hacked.set(reencEdited, start);
  const r2 = diffUnsizedLz16Gfx(hacked, rom, symbols, FRAMEWORK_ROOT, NONE);
  assert(r2.changed.length === 1 && r2.changed[0]!.fileId === picked,
    `edited sheet → exactly file 0x${picked.toString(16)} flagged (got ${r2.changed.map((c) => '0x' + c.fileId.toString(16)).join(',') || 'none'})`);
  assert(r2.changed.length === 1 && bytesEq(r2.changed[0]!.tiles, editedTiles),
    'flagged tiles === the edited tiles');
  assert(r2.changed.length === 1 && r2.changed[0]!.rowCount === YCOMPRESS_LZ16_ROW_COUNTS[picked],
    'flagged rowCount matches the ycompress table');

  // sizedIds exclusion: the caller's registry-covered ids are not re-diffed here.
  const r3 = diffUnsizedLz16Gfx(hacked, rom, symbols, FRAMEWORK_ROOT, new Set([picked]));
  assert(r3.changed.length === 0, 'sizedIds exclusion respected');
}

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall gfx-lz16 pins hold');
