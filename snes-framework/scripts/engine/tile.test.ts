// Unit test: tile decoders against hand-crafted bit patterns.
//
// Run: node --experimental-strip-types snes-framework/scripts/engine/tile.test.ts

import { decode2bppTile, decode4bppTile } from './tile.ts';

let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

function eqArr(actual: Uint8Array, expected: number[], label: string): void {
  if (actual.length !== expected.length) {
    assert(false, `${label}: length ${actual.length} != expected ${expected.length}`);
    return;
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      assert(
        false,
        `${label}: at [${i}] got ${actual[i]} expected ${expected[i]} (full: [${Array.from(actual).join(',')}])`
      );
      return;
    }
  }
}

console.log('=== decode4bppTile ===');

// --- Test 1: all bitplanes zero → all pixels 0 -------------------------
{
  const vram = new Uint8Array(32); // all zeros
  const out = new Uint8Array(64);
  decode4bppTile(vram, 0, false, false, out, 0);
  eqArr(out, new Array(64).fill(0), 'all-zero tile → all pixels 0');
}

// --- Test 2: bp0 row 0 = 0xFF (all 8 cols), others 0 → row 0 all pixel 1 -
{
  const vram = new Uint8Array(32);
  vram[0] = 0xff; // bp0 row 0
  const out = new Uint8Array(64);
  decode4bppTile(vram, 0, false, false, out, 0);
  const expected = new Array(64).fill(0);
  for (let c = 0; c < 8; c++) expected[c] = 1;
  eqArr(out, expected, 'bp0 row 0 = 0xFF → row 0 all pixel 1');
}

// --- Test 3: bp1 row 0 = 0xFF → row 0 all pixel 2 ---------------------
{
  const vram = new Uint8Array(32);
  vram[1] = 0xff;
  const out = new Uint8Array(64);
  decode4bppTile(vram, 0, false, false, out, 0);
  const expected = new Array(64).fill(0);
  for (let c = 0; c < 8; c++) expected[c] = 2;
  eqArr(out, expected, 'bp1 row 0 = 0xFF → row 0 all pixel 2');
}

// --- Test 4: bp2 row 0 = 0xFF (at byte 16) → row 0 all pixel 4 -------
{
  const vram = new Uint8Array(32);
  vram[16] = 0xff;
  const out = new Uint8Array(64);
  decode4bppTile(vram, 0, false, false, out, 0);
  const expected = new Array(64).fill(0);
  for (let c = 0; c < 8; c++) expected[c] = 4;
  eqArr(out, expected, 'bp2 row 0 = 0xFF → row 0 all pixel 4');
}

// --- Test 5: bp3 row 0 = 0xFF (at byte 17) → row 0 all pixel 8 -------
{
  const vram = new Uint8Array(32);
  vram[17] = 0xff;
  const out = new Uint8Array(64);
  decode4bppTile(vram, 0, false, false, out, 0);
  const expected = new Array(64).fill(0);
  for (let c = 0; c < 8; c++) expected[c] = 8;
  eqArr(out, expected, 'bp3 row 0 = 0xFF → row 0 all pixel 8');
}

// --- Test 6: All 4 bitplanes set in row 0 → row 0 all pixel 15 -------
{
  const vram = new Uint8Array(32);
  vram[0] = 0xff;
  vram[1] = 0xff;
  vram[16] = 0xff;
  vram[17] = 0xff;
  const out = new Uint8Array(64);
  decode4bppTile(vram, 0, false, false, out, 0);
  const expected = new Array(64).fill(0);
  for (let c = 0; c < 8; c++) expected[c] = 15;
  eqArr(out, expected, 'all bps row 0 = 0xFF → row 0 all pixel 15');
}

// --- Test 7: column-walk pattern. bp0 row 0 = 0b10000001 → cols 0+7 are 1 -
{
  const vram = new Uint8Array(32);
  vram[0] = 0x81; // 0b10000001
  const out = new Uint8Array(64);
  decode4bppTile(vram, 0, false, false, out, 0);
  const expected = new Array(64).fill(0);
  expected[0] = 1; // col 0 (MSB)
  expected[7] = 1; // col 7 (LSB)
  eqArr(out, expected, 'bp0=0x81, no flip → cols 0 and 7 set');
}

// --- Test 8: H-flip swaps col 0 with col 7. bp0 row 0 = 0x01 (only col 7) → -
//             after H-flip, col 0 set.
{
  const vram = new Uint8Array(32);
  vram[0] = 0x01;
  const out = new Uint8Array(64);
  decode4bppTile(vram, 0, true, false, out, 0);
  const expected = new Array(64).fill(0);
  expected[0] = 1;
  eqArr(out, expected, 'bp0=0x01 (col 7), H-flip → col 0 set');
}

// --- Test 9: V-flip swaps row 0 with row 7. bp0 row 0 = 0xFF → after V-flip, -
//             row 7 has 1s.
{
  const vram = new Uint8Array(32);
  vram[0] = 0xff;
  const out = new Uint8Array(64);
  decode4bppTile(vram, 0, false, true, out, 0);
  const expected = new Array(64).fill(0);
  for (let c = 0; c < 8; c++) expected[7 * 8 + c] = 1;
  eqArr(out, expected, 'bp0 row 0 = 0xFF, V-flip → row 7 all set');
}

// --- Test 10: H-flip + V-flip swap col 0 row 0 with col 7 row 7 ---------
{
  const vram = new Uint8Array(32);
  vram[0] = 0x80; // col 0, row 0 only
  vram[1] = 0xff; // also bp1 row 0 entire row
  const out = new Uint8Array(64);
  decode4bppTile(vram, 0, true, true, out, 0);
  // After H+V flip, the original (0,0) pixel (idx=3 from bp0+bp1) lands at (7,7).
  // The original cols 1..7 of row 0 (idx=2 from bp1) land at row 7, cols 6..0.
  const expected = new Array(64).fill(0);
  expected[7 * 8 + 7] = 3; // original (0,0) → flipped (7,7)
  for (let c = 0; c < 7; c++) expected[7 * 8 + c] = 2; // bp1-only cols
  eqArr(out, expected, 'H+V flip composite pattern');
}

// --- Test 11: bp0 col-walk with varying rows (canonical "ramp" tile) -----
{
  const vram = new Uint8Array(32);
  // row r: bp0 = 1 << r → only col (7-r) is set
  for (let r = 0; r < 8; r++) vram[r * 2] = 1 << r;
  const out = new Uint8Array(64);
  decode4bppTile(vram, 0, false, false, out, 0);
  const expected = new Array(64).fill(0);
  for (let r = 0; r < 8; r++) expected[r * 8 + (7 - r)] = 1;
  eqArr(out, expected, 'diagonal ramp tile');
}

console.log('\n=== decode2bppTile ===');

// --- Test 12: 2bpp basics ----------------------------------------------
{
  const vram = new Uint8Array(16);
  vram[0] = 0xff; // bp0 row 0
  vram[1] = 0x0f; // bp1 row 0: cols 4..7 set
  const out = new Uint8Array(64);
  decode2bppTile(vram, 0, false, false, out, 0);
  const expected = new Array(64).fill(0);
  for (let c = 0; c < 4; c++) expected[c] = 1; // bp0 only
  for (let c = 4; c < 8; c++) expected[c] = 3; // bp0+bp1
  eqArr(out, expected, '2bpp row 0: bp0=0xFF, bp1=0x0F');
}

// --- Test 13: 2bpp max index is 3 (only 2 bitplanes) -------------------
{
  const vram = new Uint8Array(16);
  vram[0] = 0xff;
  vram[1] = 0xff;
  const out = new Uint8Array(64);
  decode2bppTile(vram, 0, false, false, out, 0);
  for (let c = 0; c < 8; c++) {
    assert(out[c] === 3, `2bpp all-set should be 3, got ${out[c]} at col ${c}`);
  }
}

console.log('\n=== bounds checks ===');

// --- Test 14: out-of-range vram → throws -------------------------------
{
  let threw = false;
  try {
    decode4bppTile(new Uint8Array(16), 0, false, false, new Uint8Array(64), 0);
  } catch (e) {
    threw = e instanceof RangeError;
  }
  assert(threw, 'decode4bppTile throws RangeError on short vram');
}

// --- Test 15: out-of-range out → throws --------------------------------
{
  let threw = false;
  try {
    decode4bppTile(new Uint8Array(32), 0, false, false, new Uint8Array(32), 0);
  } catch (e) {
    threw = e instanceof RangeError;
  }
  assert(threw, 'decode4bppTile throws RangeError on short out');
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
