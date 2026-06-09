// Integration test for the rigid dynamic-body sprite renderer (the chunky
// bank-$54 bitmap path). Decodes from the real V1.0 YI cart via the vendored
// symbol map (no build needed) and pins the validated behaviour:
//   - every DYNAMIC_BODY_SOURCES entry decodes to its declared W×H with content,
//   - Chomp Rock $09E composites to its byte-validated 810 opaque pixels,
//   - the proven-wrong Wild Piranha $066/$054 stay stem-only (no body) — a guard
//     against re-baking the $54:60C0 Yoshi-car offset.
//
// Run: node --experimental-strip-types snes-framework/scripts/engine/sprite-dynamic-gfx.test.ts

import * as fs from 'node:fs';
import { vendoredV10SymbolMap } from './symbol-map.ts';
import { DYNAMIC_BODY_SOURCES, decodeDynamicBody, DYNAMIC_GFX_ANCHOR_SYMBOL } from './sprite-dynamic-gfx.ts';
import { resolveSpriteCel, isFormatAOnlySprite } from './sprite-tile-base.ts';
import { renderSpriteCel } from './sprite-cel.ts';
import { loadLevelGfx } from './load-graphics.ts';

const cartPath = '/mnt/d/Dev/SNES/YI_USA1.sfc'; // V1.0 reference cart
let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

if (!fs.existsSync(cartPath)) {
  console.error(`cart not found at ${cartPath}; skipping integration tests`);
  process.exit(0);
}
const rom = new Uint8Array(fs.readFileSync(cartPath));
const sym = vendoredV10SymbolMap();
const header = { spriteTileset: 0 }; // body gfx is level-independent (reads ROM)

// --- Test 1: anchor symbol resolves -----------------------------------------
assert(sym.tryPc(DYNAMIC_GFX_ANCHOR_SYMBOL) !== undefined, `${DYNAMIC_GFX_ANCHOR_SYMBOL} resolves in vendored map`);

// --- Test 2: every table entry decodes to its declared size, with content ---
let entries = 0;
for (const [k, src] of Object.entries(DYNAMIC_BODY_SOURCES)) {
  const num = Number(k);
  const body = decodeDynamicBody(rom, sym, num);
  entries++;
  assert(body !== null, `0x${num.toString(16)}: decodes`);
  if (!body) continue;
  const sc = src.scale ?? 1;
  const mir = src.mirror ? 2 : 1; // mirror doubles the width
  assert(body.width === src.width * sc * mir && body.height === src.height * sc,
    `0x${num.toString(16)}: dims ${body.width}×${body.height} == ${src.width * sc * mir}×${src.height * sc} (src ${src.width}×${src.height} ×${sc}${src.mirror ? ' mirror' : ''})`);
  const nz = body.indices.reduce((a, b) => a + (b ? 1 : 0), 0);
  assert(nz > 20, `0x${num.toString(16)}: has content (${nz} non-transparent px)`);
  assert(body.indices.every((v) => v <= 0xf), `0x${num.toString(16)}: indices are 4bpp (low nibble)`);
}
console.log(`decoded ${entries} dynamic-body entries`);

// --- Test 3: Chomp Rock $09E composites to its byte-validated 810 opaque px --
{
  const resolved = resolveSpriteCel(rom, sym, header, 0x9e);
  assert(resolved !== null && resolved.dynamicBody !== undefined, '$09E resolves with a dynamic body');
  if (resolved?.dynamicBody) {
    // Body is ROM-sourced; static cel is empty for chomp, so vram is unused and an
    // empty cgram still yields opaque pixels for every non-transparent body index.
    const img = renderSpriteCel(resolved.cel, {
      vram: new Uint8Array(0x10000),
      cgram: new Uint8Array(512),
      tileBaseBytes: resolved.tileBaseBytes,
      dynamicBody: resolved.dynamicBody
    });
    const u32 = new Uint32Array(img.rgba.buffer, img.rgba.byteOffset, img.rgba.length >>> 2);
    let opaque = 0;
    for (const p of u32) if ((p & 0xff000000) !== 0) opaque++;
    assert(opaque === 810, `$09E Chomp Rock = 810 opaque px (got ${opaque})`);
  }
}

// --- Test 3b: Eggo-Dill $0EE composites a full 32×32 body (608 opaque px) -----
// Identity-VRAM crack: source $55:0060 matched 608/608 px all-pixel-exact. Its cel
// placeholders are tile 0x0 (the default sentinel), so the body stands in for them
// and the static cel reduces to empty — the whole sprite is the bitmap.
{
  const resolved = resolveSpriteCel(rom, sym, header, 0xee);
  assert(resolved !== null && resolved.dynamicBody !== undefined, '$0EE resolves with a dynamic body');
  if (resolved?.dynamicBody) {
    assert(resolved.dynamicBody.width === 32 && resolved.dynamicBody.height === 32,
      `$0EE body is 32×32 (got ${resolved.dynamicBody.width}×${resolved.dynamicBody.height})`);
    const img = renderSpriteCel(resolved.cel, {
      vram: new Uint8Array(0x10000),
      cgram: new Uint8Array(512),
      tileBaseBytes: resolved.tileBaseBytes,
      dynamicBody: resolved.dynamicBody
    });
    const u32 = new Uint32Array(img.rgba.buffer, img.rgba.byteOffset, img.rgba.length >>> 2);
    let opaque = 0;
    for (const p of u32) if ((p & 0xff000000) !== 0) opaque++;
    assert(opaque === 608, `$0EE Eggo-Dill = 608 opaque px (got ${opaque})`);
  }
}

// --- Test 4: $066 / $054 Wild Piranha stay stem-only (no dynamic body) -------
// Guards against re-baking the wrong $54:60C0 offset (renders the Yoshi car).
for (const num of [0x66, 0x54]) {
  assert(!(num in DYNAMIC_BODY_SOURCES), `0x${num.toString(16)} not in DYNAMIC_BODY_SOURCES (offset unconfirmed)`);
  const resolved = resolveSpriteCel(rom, sym, header, num);
  assert(resolved === null || resolved.dynamicBody === undefined,
    `0x${num.toString(16)} resolves without a dynamic body (stem-only)`);
}

// --- Test 5: Format-A items render a single 16×16 OBJ tile -------------------
// Red coin $065 (item, no Format-B cel) → object_data[0] tile, 16×16, common page.
assert(isFormatAOnlySprite(rom, sym, 0x65), '$065 red coin is Format-A-only');
assert(!isFormatAOnlySprite(rom, sym, 0x66), '$066 piranha is NOT Format-A-only (has Format-B)');
assert(!isFormatAOnlySprite(rom, sym, 0x9e), '$09E chomp is NOT Format-A-only (has Format-B)');
{
  const r = resolveSpriteCel(rom, sym, header, 0x65);
  assert(r !== null && r.cel.length === 1 && r.cel[0]!.size === 16, '$065 → one 16×16 record');
  // Top-left-anchored: the Format-A tile's top-left coincides with the sprite
  // anchor (matches engine CODE_098B0B, which writes OAM X/Y from the slot's
  // $1640/$1642 with no centering). A regression to a centred (-8) record would
  // shift 1×1 items up-left by half a tile.
  assert(r !== null && r.cel[0]!.dx === 0 && r.cel[0]!.dy === 0, '$065 record is top-left-anchored (dx=dy=0)');
  // Runtime recolour: the Red Coin's Init recomputes its palette from DATA_0CE9FE
  // (normal play, sprite-pal != 2 → palette 2, the gold coin row 10), NOT the
  // static $7042 seed (palette 0, green row 8). Without the override the editor
  // renders a green coin.
  assert(r !== null && r.cel[0]!.paletteRow === 2, '$065 coin uses runtime palette 2 (gold), not static seed 0 (green)');
  // Sprite-palette-2 levels take the other table entry (palette 7).
  {
    const r2 = resolveSpriteCel(rom, sym, header, 0x65, undefined, false, 2);
    assert(r2 !== null && r2.cel[0]!.paletteRow === 7, '$065 in a sprite-palette-2 level uses palette 7');
  }
  if (r) {
    // The item tile is common-page gfx, so it needs real VRAM (unlike the
    // ROM-sourced dynamic bodies). loadLevelGfx always loads the common page.
    const vram = new Uint8Array(0x10000);
    loadLevelGfx(rom, sym, { bg1Tileset: 0, bg2Tileset: 0, bg3Tileset: 0, spriteTileset: 0, isWorld6: false }, vram);
    const img = renderSpriteCel(r.cel, { vram, cgram: new Uint8Array(512), tileBaseBytes: r.tileBaseBytes });
    assert(img.width === 16 && img.height === 16, `$065 renders 16×16 (got ${img.width}×${img.height})`);
    const u32 = new Uint32Array(img.rgba.buffer, img.rgba.byteOffset, img.rgba.length >>> 2);
    let opaque = 0; for (const p of u32) if ((p & 0xff000000) !== 0) opaque++;
    assert(opaque > 20, `$065 has content (${opaque} opaque px)`);
  }
}

if (failures === 0) console.log('✓ all sprite-dynamic-gfx tests passed');
else { console.error(`${failures} failure(s)`); process.exit(1); }
