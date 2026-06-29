// Dynamic-sprite glyph round-trip pin (sprite-glyph.ts).
//   1. The unedited glyph PNG slices back to the ORIGINAL bank-$54 bytes byte-for-
//      byte — including the preserved HIGH nibble (read-modify-write).
//   2. A single-pixel edit changes exactly that byte's low nibble, high nibble +
//      every other byte untouched.
//   3. Shared sources collapse (0x021 ↔ 0x122/0x123, 0x094 ↔ 0x095/0x096).
//
// Run: node snes-framework/scripts/engine/sprite-glyph.test.ts

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel, isWorld6Record, loadLevelMapPublic } from '../level.ts';
import { decodePng, type ImageData } from './png.ts';
import { type PaletteHeader } from './load-palettes.ts';
import { glyphSources, exportSpriteGlyphs, glyphWritesForSprite } from './sprite-glyph.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; }
}

let cart;
try { cart = loadDevCart(FRAMEWORK_ROOT); } catch (e) { console.error((e as Error).message); process.exit(2); }
const { rom, symbols } = cart;
const levelMap = loadLevelMapPublic(FRAMEWORK_ROOT);
const rec = 0x27;
const base = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: rec });
const h = base.header;
const header: PaletteHeader = {
  bgColor: h[0] ?? 0, bg1Palette: h[2] ?? 0, bg2Palette: h[4] ?? 0, bg3Palette: h[6] ?? 0,
  spritePalette: h[8] ?? 0, yoshiColor: 0, isWorld6: isWorld6Record(levelMap, rec), levelMode: h[9] ?? 0
};

const sources = glyphSources(rom, symbols);
assert(sources.length > 5, `enumerated byte-validated glyph sources (${sources.length})`);
const s21 = sources.find((s) => s.spriteNum === 0x021);
const s94 = sources.find((s) => s.spriteNum === 0x094);
assert(!!s21 && s21.sharedWith.includes(0x122) && s21.sharedWith.includes(0x123), `0x021 source shared by 0x122/0x123`);
assert(!!s94 && s94.sharedWith.includes(0x095) && s94.sharedWith.includes(0x096), `0x094 source shared by 0x095/0x096`);

function region(img: ImageData, w: number, ht: number): Uint8Array {
  const out = new Uint8Array(w * ht * 4);
  for (let y = 0; y < ht; y++) for (let x = 0; x < w; x++) {
    const sOff = (y * img.width + x) * 4, d = (y * w + x) * 4;
    out[d] = img.rgba[sOff]!; out[d + 1] = img.rgba[sOff + 1]!; out[d + 2] = img.rgba[sOff + 2]!; out[d + 3] = img.rgba[sOff + 3]!;
  }
  return out;
}

const entries = exportSpriteGlyphs(rom, symbols, header);
const byNum = new Map(sources.map((s) => [s.spriteNum, s]));
const ROW_STRIDE = 0x100;

// 1. Unedited slice == original bytes (high nibble preserved).
let rtOk = true, rowsChecked = 0;
for (const e of entries) {
  const g = byNum.get(e.spriteNum)!;
  const reg = region(decodePng(Buffer.from(e.png)), e.width, e.height);
  const res = glyphWritesForSprite(rom, symbols, header, e.spriteNum, reg);
  if (!res) { rtOk = false; console.error(`    0x${e.spriteNum.toString(16)}: no writes`); continue; }
  res.writes.forEach((w, y) => {
    for (let x = 0; x < e.width; x++) {
      if (w.bytes[x] !== rom[g.srcPC + y * ROW_STRIDE + x]!) { rtOk = false; }
      rowsChecked++;
    }
  });
}
assert(rtOk, `every glyph round-trips to original bytes (${rowsChecked} bytes, high nibble preserved)`);

// 2. 1-pixel edit isolates to one byte's low nibble.
let editTested = false;
for (const e of entries) {
  const g = byNum.get(e.spriteNum)!;
  const img = decodePng(Buffer.from(e.png));
  const reg = region(img, e.width, e.height);
  const u32 = new Uint32Array(reg.buffer, reg.byteOffset, e.width * e.height);
  // find an opaque pixel + a different palette color from the swatch (col e.width).
  const sw = new Uint32Array(img.rgba.buffer, img.rgba.byteOffset, img.width * img.height);
  let p = -1;
  for (let i = 0; i < u32.length; i++) if ((u32[i]! >>> 24) !== 0) { p = i; break; }
  if (p < 0) continue;
  let newColor = u32[p]!;
  for (let i = 1; i < 16; i++) { const c = sw[(i * 8) * img.width + e.width]!; if (c !== 0 && c !== u32[p]!) { newColor = c; break; } }
  if (newColor === u32[p]!) continue;
  u32[p] = newColor;
  const res = glyphWritesForSprite(rom, symbols, header, e.spriteNum, reg)!;
  const py = (p / e.width) | 0, px = p % e.width;
  let changed = 0, highBroken = 0, otherChanged = 0;
  res.writes.forEach((w, y) => {
    for (let x = 0; x < e.width; x++) {
      const orig = rom[g.srcPC + y * ROW_STRIDE + x]!;
      if (w.bytes[x] !== orig) {
        changed++;
        if ((w.bytes[x]! & 0xf0) !== (orig & 0xf0)) highBroken++;
        if (!(y === py && x === px)) otherChanged++;
      }
    }
  });
  assert(changed === 1 && otherChanged === 0 && highBroken === 0,
    `0x${e.spriteNum.toString(16)}: 1-px edit → 1 byte changed, high nibble intact, no others`);
  editTested = true;
  break;
}
assert(editTested, `edit-isolation exercised`);

console.log(`\n${failures === 0 ? '✓ all sprite-glyph pins pass' : `✗ ${failures} failure(s)`}  [${sources.length} glyphs]`);
process.exit(failures === 0 ? 0 : 1);
