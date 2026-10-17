// BG3 tilemap action-byte pins (load-bg-tilemaps.ts).
//
// The loader's step-6 upload is not the last word: the per-tileset action byte
// can rewrite what it just wrote. This pins the two cases that change VRAM:
//
//   1. **$80 `bg3_low_water_adjust`** (water-surface levels, tileset $13) —
//      the handler blanks the whole tilemap and re-drops only the blob's FIRST
//      `$0800 - DATA_bg3_low_water_vram_size` bytes at
//      `DATA_bg3_low_water_vram_ptr`. So the water band sits at the BOTTOM of
//      the 32-row tilemap and every row above the water line is the empty tile.
//      Loading the blob as-is instead gives 32 rows of solid water, all of them
//      priority-1 — an opaque foreground plane over the whole level (it did:
//      records $20/$57/$84/$a7/$ab/$b9 rendered as one blue rectangle).
//      Cross-checked byte-for-byte against a live-cart VRAM dump of record $20
//      (Lake Shore Paradise) when the model was written.
//   2. **$FF / $88-$FE** — the cart clears TM/TS bit 2; we surface that as
//      `bg3Disabled` and the renderer suppresses the layer.
//
// Everything else ($00 plain, $01-$7F stripe table, $81-$87 HDMA) leaves the
// tilemap alone, so the plain upload IS the pin: the region equals the blob.
//
// Run: node snes-framework/scripts/engine/load-bg-tilemaps.test.ts

import { loadDevCart } from './dev-cart.ts';
import { loadBg3Tilemap, resolveBgTilemapSource } from './load-bg-tilemaps.ts';
import { u16le } from './rom-read.ts';

const BG3_TILEMAP_VRAM_ADDR = 0x6800;
const BG3_TILEMAP_VRAM_BYTES = 0x0800;
const BG3_EMPTY_TILE_WORD = 0x01ce;
const LOW_WATER_TILESET = 0x13;

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; }
}

const { rom, symbols } = loadDevCart();
const tableBase = symbols.pc('DATA_bg3_tilemap_table');
const actionFor = (ts: number) => rom[tableBase + (ts - 1) * 3 + 2]!;

// ── 1. action $80 — low-water adjust ─────────────────────────────────────────
assert(actionFor(LOW_WATER_TILESET) === 0x80,
  `BG3 tileset $${LOW_WATER_TILESET.toString(16)} still carries action $80`);

const vram = new Uint8Array(0x10000).fill(0xa5); // poison: any untouched byte shows up
const load = loadBg3Tilemap(rom, symbols, LOW_WATER_TILESET, vram);

// The blob to compare against. `resolveBgTilemapSource` deliberately returns
// null for a low-water tileset (its file no longer maps 1:1 onto the region),
// so read it through tileset $1D — the same LZ2 file $ED under a plain-ish
// action byte, which loads verbatim. If the cart ever stops sharing the file
// the guard below fails loudly rather than pinning the wrong bytes.
const fileOf = (ts: number) => rom[tableBase + (ts - 1) * 3]! | (rom[tableBase + (ts - 1) * 3 + 1]! << 8);
const TWIN_TILESET = 0x1d;
assert(resolveBgTilemapSource(rom, symbols, 3, LOW_WATER_TILESET) === null,
  'low-water tileset reports no directly-editable static tilemap file');
assert(fileOf(TWIN_TILESET) === fileOf(LOW_WATER_TILESET),
  `tileset $${TWIN_TILESET.toString(16)} still shares LZ2 file $${fileOf(LOW_WATER_TILESET).toString(16)} with $${LOW_WATER_TILESET.toString(16)}`);
const blob = resolveBgTilemapSource(rom, symbols, 3, TWIN_TILESET)!.bytes;

const bandBytes = BG3_TILEMAP_VRAM_BYTES - u16le(rom, symbols.pc('DATA_bg3_low_water_vram_size'));
const bandOff = BG3_TILEMAP_VRAM_BYTES - bandBytes;
assert(load.bytesWritten === BG3_TILEMAP_VRAM_BYTES && !load.emptyFilled && !load.bg3Disabled,
  `low-water load reports the full region written (${load.bytesWritten} B, emptyFilled=${load.emptyFilled})`);

// The destination the asm names must be the tail of the tilemap — if a patch
// moved it elsewhere the "band at the bottom" reading below stops holding.
const dstWord = u16le(rom, symbols.pc('DATA_bg3_low_water_vram_ptr'));
assert(dstWord === (BG3_TILEMAP_VRAM_ADDR >>> 1) + (bandOff >>> 1),
  `low-water dest $${dstWord.toString(16)} is the band's start inside the BG3 tilemap`);

let blankOk = true;
for (let i = 0; i < bandOff; i += 2) {
  const w = vram[BG3_TILEMAP_VRAM_ADDR + i]! | (vram[BG3_TILEMAP_VRAM_ADDR + i + 1]! << 8);
  if (w !== BG3_EMPTY_TILE_WORD) { blankOk = false; break; }
}
assert(blankOk, `rows above the water line are the empty tile $${BG3_EMPTY_TILE_WORD.toString(16)} (${bandOff / 64} rows)`);

let bandOk = true;
for (let i = 0; i < bandBytes; i++) {
  if (vram[BG3_TILEMAP_VRAM_ADDR + bandOff + i] !== blob[i]) { bandOk = false; break; }
}
assert(bandOk, `the band is the blob's first ${bandBytes} bytes (${bandBytes / 64} rows at the tilemap bottom)`);

// The band is what the priority split hands to the foreground plane; the whole
// blob being priority-1 is exactly why loading all 32 rows was catastrophic.
let bandPri1 = 0, aboveNonBlank = 0;
for (let i = 0; i < BG3_TILEMAP_VRAM_BYTES; i += 2) {
  const w = vram[BG3_TILEMAP_VRAM_ADDR + i]! | (vram[BG3_TILEMAP_VRAM_ADDR + i + 1]! << 8);
  if (i >= bandOff) { if (w & 0x2000) bandPri1++; } else if (w !== BG3_EMPTY_TILE_WORD) aboveNonBlank++;
}
assert(aboveNonBlank === 0 && bandPri1 > 0,
  `only the band carries priority-1 tiles (${bandPri1} of ${bandBytes / 2} words), nothing above it`);

// ── 2. the hide range ────────────────────────────────────────────────────────
const hideTs: number[] = [];
for (let ts = 1; ts <= 0x30; ts++) { const a = actionFor(ts); if (a === 0xff || (a >= 0x88 && a <= 0xfe)) hideTs.push(ts); }
assert(hideTs.length > 0, `cart still has BG3-hide tilesets (${hideTs.map((t) => '$' + t.toString(16)).join(' ')})`);
assert(hideTs.every((ts) => loadBg3Tilemap(rom, symbols, ts, new Uint8Array(0x10000)).bg3Disabled),
  'every hide-action tileset reports bg3Disabled');

// ── 3. plain actions leave the plain upload alone ────────────────────────────
let plainTested = 0, plainOk = true;
for (let ts = 1; ts <= 0x30; ts++) {
  const a = actionFor(ts);
  if (a === 0x80 || a === 0xff || (a >= 0x88 && a <= 0xfe)) continue;
  const src = resolveBgTilemapSource(rom, symbols, 3, ts);
  if (!src) continue;
  const v = new Uint8Array(0x10000);
  loadBg3Tilemap(rom, symbols, ts, v);
  const n = Math.min(src.bytes.length, BG3_TILEMAP_VRAM_BYTES);
  for (let i = 0; i < n; i++) if (v[BG3_TILEMAP_VRAM_ADDR + i] !== src.bytes[i]) { plainOk = false; break; }
  plainTested++;
}
assert(plainTested > 0 && plainOk, `non-rewriting actions load the blob verbatim (${plainTested} tilesets)`);

console.log(`\n${failures === 0 ? '✓ all load-bg-tilemaps pins pass' : `✗ ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
