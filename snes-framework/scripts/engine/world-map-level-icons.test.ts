// World-map per-level ICON round-trip pin (world-map-level-icons.ts).
//
//   1. Export yields 60 FAITHFUL icons (worlds 0-5 × slots 0-9 = L1..L8 + EXTRA +
//      BONUS), all 24×24 (the icon picture; the 28-px slot pitch + transparent margin trimmed),
//      pixels decoded from cart bank $53.
//   2. The source offset is CART-derived (levelIconSource == DATA_08DA2E[R3*3]), and
//      the nibble (column A/B) is CART-derived (levelIconHighNibble == DATA_17DBA3
//      plot-X == $15). Two icons pack into one chunky byte (low/high nibble), so
//      worlds 0↔4 / 1↔5 share offsets but read different nibbles.
//   3. Each icon ROUND-TRIPS: slicing the UNEDITED canvas writes nothing.
//   4. A single-pixel edit RMWs ONE row's own nibble — for a LOW-nibble icon the
//      high nibble is preserved, and for a HIGH-nibble icon the low nibble is.
//
// Run: node snes-framework/scripts/engine/world-map-level-icons.test.ts

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { snesToPC } from './symbol-map.ts';
import { decodePng } from './png.ts';
import {
  exportWorldMapLevelIcons, buildLevelIconContext, renderWorldMapLevelIcon,
  levelIconPng, levelIconAseprite, sliceLevelIconWrites, levelIconSource, levelIconHighNibble,
  type LevelIconContext, type LevelIconCanvas
} from './world-map-level-icons.ts';
import { decodeAsepriteImage } from './aseprite.ts';
import { diffAsepritePalette } from './gfx-aseprite.ts';
import { imageDataU32ToBgr15 } from './color.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; }
}

/** Pin a track's palette write-back against the blob words it was sourced from (provenance,
 *  cgram): unedited → 0 edits; flipping the first blob-backed entry → exactly one. */
function assertPaletteRoundTrip(label: string, palette: Uint32Array, offsets: number[], provenance: Int32Array, cgram: Uint8Array): void {
  const blobWords = new Map<number, number>();
  for (let ci = 0; ci < provenance.length; ci++) { const o = provenance[ci]!; if (o >= 0) blobWords.set(o, (cgram[ci * 2]! | (cgram[ci * 2 + 1]! << 8)) & 0x7fff); }
  assert(offsets.length > 0 && offsets.length <= palette.length, `${label}: paletteOffsets covers the meaningful entries (${offsets.length} of ${palette.length})`);
  assert(diffAsepritePalette(palette, offsets, blobWords).length === 0, `${label}: unedited palette → 0 master-blob color edits`);
  const pi = offsets.findIndex((o) => o >= 0);
  assert(pi >= 0, `${label}: palette has a blob-backed color to edit`);
  if (pi >= 0) {
    const ep = palette.slice(); ep[pi] = (ep[pi]! ^ 0x00080808) >>> 0;
    const eds = diffAsepritePalette(ep, offsets, blobWords);
    assert(eds.length === 1 && eds[0]!.offset === offsets[pi] && eds[0]!.value === imageDataU32ToBgr15(ep[pi]!), `${label}: a 1-color edit → exactly one PaletteEdit at the right offset`);
  }
}

let cart;
try { cart = loadDevCart(FRAMEWORK_ROOT); } catch (e) {
  console.error((e as Error).message); process.exit(2);
}
const { rom, symbols } = cart;

const ICON_W = 24, ICON_H = 24;
// The top-left 24×24 RGBA of an icon's exported PNG (the swatch is to its right).
function canvasRegion(png: Uint8Array): Uint8Array {
  const img = decodePng(Buffer.from(png));
  const out = new Uint8Array(ICON_W * ICON_H * 4);
  for (let y = 0; y < ICON_H; y++) for (let x = 0; x < ICON_W; x++) {
    const s = (y * img.width + x) * 4, d = (y * ICON_W + x) * 4;
    out[d] = img.rgba[s]!; out[d + 1] = img.rgba[s + 1]!; out[d + 2] = img.rgba[s + 2]!; out[d + 3] = img.rgba[s + 3]!;
  }
  return out;
}

// 1. Export = 60 faithful 24×24.
const icons = exportWorldMapLevelIcons(rom, symbols);
assert(icons.length === 60, `exports 60 level icons (worlds 0-5 × slots 0-9), got ${icons.length}`);
assert(icons.every((i) => i.faithful), `all faithful (${icons.filter((i) => i.faithful).length}/60)`);
assert(icons.every((i) => i.width === ICON_W && i.height === ICON_H), 'every icon is 24×24 (cropped to the picture)');
assert(icons.filter((i) => i.name === 'EXTRA').length === 6, 'one EXTRA per world (6 total)');
assert(icons.filter((i) => i.name === 'BONUS').length === 6, 'one BONUS per world (6 total)');

// 2. Source = cart descriptor DATA_08DA2E + R3*3; nibble = cart DATA_17DBA3 plot-X.
{
  const descPc = symbols.pc('DATA_08DA2E');
  const r3 = 1 * 12 + 5; // world 1, slot 5
  const o = descPc + r3 * 3;
  const expect = rom[o]! | (rom[o + 1]! << 8) | (rom[o + 2]! << 16);
  assert(levelIconSource(rom, symbols, 1, 5) === expect, 'levelIconSource reads the cart DATA_08DA2E descriptor');
  // Worlds 0-3 slots 0-8 are column A (low nibble); worlds 4-5 + every BONUS are column B (high).
  assert(!levelIconHighNibble(rom, symbols, 0, 0), 'world 0 slot 0 is column A (low nibble)');
  assert(levelIconHighNibble(rom, symbols, 4, 0), 'world 4 slot 0 is column B (high nibble)');
  assert(levelIconHighNibble(rom, symbols, 0, 9), 'world 0 BONUS (slot 9) is column B (high nibble)');
  // The packing claim: world 0 slot 0 and world 4 slot 0 share the offset, differ by nibble.
  assert(levelIconSource(rom, symbols, 0, 0) === levelIconSource(rom, symbols, 4, 0),
    'worlds 0↔4 slot 0 share the chunky offset (two icons per byte)');
}

// 3. + 4. round-trip + 1-px RMW, per world × slot.
let rtFail = 0;
for (let world = 0; world < 6; world++) {
  const ctx: LevelIconContext = buildLevelIconContext(rom, symbols, world);
  for (let slot = 0; slot < 10; slot++) {
    const c = renderWorldMapLevelIcon(ctx, slot)!;
    const region = canvasRegion(levelIconPng(ctx, c));
    const r = sliceLevelIconWrites(ctx, c, region)!;
    if (r.changed) rtFail++;
  }
}
assert(rtFail === 0, `unedited round-trip → 0 writes across all 60 icons (${rtFail} failed)`);

// 1-px edit RMW — exercise BOTH a low-nibble (column A) and a high-nibble (column B) icon.
for (const { world, slot, label, high } of [
  { world: 0, slot: 0, label: 'low-nibble (world 0 slot 0)', high: false },
  { world: 4, slot: 0, label: 'high-nibble (world 4 slot 0)', high: true }
]) {
  const ctx = buildLevelIconContext(rom, symbols, world);
  const c: LevelIconCanvas = renderWorldMapLevelIcon(ctx, slot)!;
  assert(c.highNibble === high, `${label}: column derived from cart (highNibble=${high})`);
  const region = canvasRegion(levelIconPng(ctx, c));
  const u = new Uint32Array(region.buffer);
  u[10 * ICON_W + 10] = u[10 * ICON_W + 10]! ^ 0x00ffffff; // perturb one pixel in row 10
  const r = sliceLevelIconWrites(ctx, c, region)!;
  assert(r.changed, `${label}: 1-px edit registers as changed`);
  assert(r.writes.every((w) => w.bytes.length === ICON_W), `${label}: each row write is ${ICON_W} bytes (no neighbour bleed)`);
  const pc = snesToPC(c.srcSnes);
  const otherMask = high ? 0x0f : 0xf0; // the nibble belonging to the OTHER column (must survive)
  let otherChangedRows = 0, otherPreserved = true;
  for (let y = 0; y < ICON_H; y++) {
    const w = r.writes[y]!;
    for (let x = 0; x < ICON_W; x++) {
      const base = rom[pc + y * 0x100 + x]!;
      if (w.bytes[x]! !== base && y !== 10) otherChangedRows++;
      if ((w.bytes[x]! & otherMask) !== (base & otherMask)) otherPreserved = false;
    }
  }
  assert(otherChangedRows === 0, `${label}: 1-px edit changes ONLY row 10 (no spill to other rows)`);
  assert(otherPreserved, `${label}: write-back preserves the OTHER column's nibble (RMW)`);
  assert(r.writes.every((w) => /DATA_53(0000|8000)\.bin$/.test(w.binFile)), `${label}: writes target the bank-$53 .bins`);
}

// 5. Single-image `.aseprite` round-trip (no tilemap): the indexed image (chunky nibble
//    indices) + the OBJ palette row flattens back to the canvas → slicer writes nothing.
{
  const ctx = buildLevelIconContext(rom, symbols, 0);
  const c = renderWorldMapLevelIcon(ctx, 0)!;
  const liconFull = levelIconAseprite(ctx, c);
  const dec = decodeAsepriteImage(liconFull.bytes);
  assert(dec.width === ICON_W && dec.height === ICON_H, `level-icon .aseprite is 24×24 (got ${dec.width}×${dec.height})`);
  const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
  assert(eq(dec.rgba, canvasRegion(levelIconPng(ctx, c))), 'level-icon .aseprite flatten == the PNG canvas region');
  assert(!sliceLevelIconWrites(ctx, c, dec.rgba)!.changed, 'level-icon .aseprite round-trips to 0 writes');
  // Palette write-back: the icon's single OBJ row (8+slot), 16-color, index 0 transparent.
  assertPaletteRoundTrip('level icon', dec.palette, liconFull.paletteOffsets, ctx.provenance, ctx.cgram);
}

console.log(failures === 0 ? '\nAll world-map level-icon pins passed.' : `\n${failures} check(s) failed.`);
process.exit(failures ? 1 : 0);
