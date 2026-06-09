// Unit test: color conversions.
// Run: node --experimental-strip-types snes-framework/scripts/engine/color.test.ts

import {
  bgr15ToImageDataU32,
  bgr15ToRgb,
  bgr15ToRgb24,
  buildPaletteRow,
  readCgramColor,
} from './color.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}
function eq<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`  ✗ ${msg}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    failures++;
  }
}

console.log('=== bgr15ToRgb (expand) ===');
eq(bgr15ToRgb(0x0000), { r: 0, g: 0, b: 0 }, 'black → (0,0,0)');
eq(bgr15ToRgb(0x7fff), { r: 255, g: 255, b: 255 }, 'pure white → (255,255,255)');
eq(bgr15ToRgb(0x001f), { r: 255, g: 0, b: 0 }, 'red only → (255,0,0)');
eq(bgr15ToRgb(0x03e0), { r: 0, g: 255, b: 0 }, 'green only → (0,255,0)');
eq(bgr15ToRgb(0x7c00), { r: 0, g: 0, b: 255 }, 'blue only → (0,0,255)');
// Mid-range: 16/31 → ~132 (16*8 = 128, plus 16/4 = 4 → 132)
eq(bgr15ToRgb(0x0010).r, 132, '16/31 expands to 132');
// High bit is ignored
eq(bgr15ToRgb(0xffff), { r: 255, g: 255, b: 255 }, 'high bit 15 is ignored');

console.log('\n=== bgr15ToRgb (shift) ===');
eq(bgr15ToRgb(0x7fff, 'shift'), { r: 248, g: 248, b: 248 }, 'pure white shift → (248,248,248)');
eq(bgr15ToRgb(0x001f, 'shift'), { r: 248, g: 0, b: 0 }, 'red shift → (248,0,0)');

console.log('\n=== bgr15ToRgb24 ===');
assert(bgr15ToRgb24(0x7fff) === 0xffffff, 'pure white packs to 0xFFFFFF');
assert(bgr15ToRgb24(0x001f) === 0xff0000, 'pure red packs to 0xFF0000');
assert(bgr15ToRgb24(0x03e0) === 0x00ff00, 'pure green packs to 0x00FF00');
assert(bgr15ToRgb24(0x7c00) === 0x0000ff, 'pure blue packs to 0x0000FF');

console.log('\n=== bgr15ToImageDataU32 ===');
// ImageData u32 (little-endian host) = (A<<24) | (B<<16) | (G<<8) | R
// pure red = (0xFF<<24) | (0<<16) | (0<<8) | 0xFF = 0xFF0000FF
assert(bgr15ToImageDataU32(0x001f) === 0xff0000ff >>> 0, 'red u32 = 0xFF0000FF');
// pure white = 0xFFFFFFFF
assert(bgr15ToImageDataU32(0x7fff) === 0xffffffff >>> 0, 'white u32 = 0xFFFFFFFF');
// alpha 0 = fully transparent regardless of color
assert((bgr15ToImageDataU32(0x7fff, 0) & 0xff000000) === 0, 'alpha=0 → transparent');

console.log('\n=== readCgramColor ===');
{
  // Build a fake CGRAM: 4 entries, LE u16
  const cgram = new Uint8Array([
    0x00, 0x00,           // entry 0 = 0x0000 (black)
    0x1f, 0x00,           // entry 1 = 0x001F (red)
    0xe0, 0x03,           // entry 2 = 0x03E0 (green)
    0x00, 0x7c,           // entry 3 = 0x7C00 (blue)
  ]);
  assert(readCgramColor(cgram, 0) === 0x0000, 'entry 0');
  assert(readCgramColor(cgram, 1) === 0x001f, 'entry 1');
  assert(readCgramColor(cgram, 2) === 0x03e0, 'entry 2');
  assert(readCgramColor(cgram, 3) === 0x7c00, 'entry 3');
  let threw = false;
  try { readCgramColor(cgram, 4); } catch (e) { threw = e instanceof RangeError; }
  assert(threw, 'out-of-range index throws RangeError');
}

console.log('\n=== buildPaletteRow ===');
{
  // 512-byte CGRAM with entry (row*16+i) = ((row+1)*0x100 | i)
  const cgram = new Uint8Array(512);
  for (let i = 0; i < 256; i++) {
    const v = ((Math.floor(i / 16) + 1) << 8) | (i & 0xf);
    cgram[i * 2] = v & 0xff;
    cgram[i * 2 + 1] = (v >> 8) & 0xff;
  }
  const palette3 = buildPaletteRow(cgram, 3, false);
  assert(palette3.length === 16, 'palette has 16 entries');
  // row 3 entry 0 = ((3+1)<<8) | 0 = 0x0400; (full alpha since transparent0=false)
  const expected_p3_0 = bgr15ToImageDataU32(0x0400, 0xff);
  assert(palette3[0] === expected_p3_0, 'row 3 entry 0 matches direct conversion');

  const palette5 = buildPaletteRow(cgram, 5, true); // transparent0
  // alpha=0 for entry 0
  assert((palette5[0] & 0xff000000) === 0, 'transparent0=true → entry 0 alpha is 0');
  // alpha=255 for entry 1
  assert(((palette5[1] & 0xff000000) >>> 0) === 0xff000000 >>> 0, 'transparent0=true → entry 1 alpha is 0xFF');
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
