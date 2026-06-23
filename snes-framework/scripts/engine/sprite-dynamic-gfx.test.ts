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
import { CUSTOM_SPRITE_RENDERERS, SpriteCompositor } from './sprite-custom-render.ts';

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
  const mirW = src.mirror === 'right' ? 2 : 1; // 'right' doubles width
  const mirH = src.mirror === 'down' ? 2 : 1;  // 'down' doubles height
  if (src.pieces && src.pieces.length) {
    // Composite bodies size to their pieces' bounds (× mirror), not src.width/height.
    let cw = 0, ch = 0;
    for (const p of src.pieces) { cw = Math.max(cw, p.x + p.width); ch = Math.max(ch, p.y + p.height); }
    assert(body.width === cw * mirW && body.height === ch * mirH,
      `0x${num.toString(16)}: composite dims ${body.width}×${body.height} == ${cw * mirW}×${ch * mirH} (${src.pieces.length} pieces${src.mirror ? ' mirror:' + src.mirror : ''})`);
  } else if (src.rotozoom) {
    // Rotozoom bodies rasterize to a derived square footprint (≈ max(w,h)·scale·1.5), not src×scale.
    const exp = Math.ceil(Math.max(src.width, src.height) * (src.rotozoom.scale / 256) * 1.5) + 2;
    assert(body.width === exp && body.height === exp,
      `0x${num.toString(16)}: rotozoom dims ${body.width}×${body.height} == ${exp}×${exp}`);
  } else {
    assert(body.width === src.width * sc * mirW && body.height === src.height * sc * mirH,
      `0x${num.toString(16)}: dims ${body.width}×${body.height} == ${src.width * sc * mirW}×${src.height * sc * mirH} (src ${src.width}×${src.height} ×${sc}${src.mirror ? ' mirror:' + src.mirror : ''})`);
  }
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

// --- Test 3c: Doors render a mirrored 32×32 body from the 16px left half ------
// Doors store only the LEFT HALF in bank $55 + mirror:'right' (the OAM hflip).
// All 5 standard doors render (the byte-validated $55:6000 door body; $001/$093
// share it — their own centre is composited/contested, no clean static source).
for (const num of [0x001, 0x012, 0x04e, 0x093, 0x131]) {
  const resolved = resolveSpriteCel(rom, sym, header, num);
  assert(resolved !== null && resolved.dynamicBody !== undefined, `$${num.toString(16)} door resolves with a dynamic body`);
  if (resolved?.dynamicBody) {
    const b = resolved.dynamicBody;
    assert(b.width === 32 && b.height === 32, `$${num.toString(16)} door body is 32×32 (got ${b.width}×${b.height})`);
    let symmetric = true;
    for (let y = 0; y < b.height && symmetric; y++)
      for (let x = 0; x < b.width; x++)
        if (b.indices[y * b.width + x] !== b.indices[y * b.width + (b.width - 1 - x)]) { symmetric = false; break; }
    assert(symmetric, `$${num.toString(16)} door body is left↔right mirror-symmetric`);
  }
}
// $012 boss door: palette row 1 (red, natural level — NOT 0/green) + spawns a tile
// above its cell, so its body origin is shifted up (originY -16 → body top dy -16).
{
  const r = resolveSpriteCel(rom, sym, header, 0x12);
  assert(r?.dynamicBody?.paletteRow === 1, `$012 boss door palette row 1 (got ${r?.dynamicBody?.paletteRow})`);
  assert(r?.dynamicBody?.originY === -16, `$012 boss door originY -16 (spawn offset; got ${r?.dynamicBody?.originY})`);
}
// $001 closed door also spawns a tile above its cell (user-confirmed it rendered 1
// tile too low at offset 0) — same originY -16 as $012/$093.
{
  const r = resolveSpriteCel(rom, sym, header, 0x1);
  assert(r?.dynamicBody?.originY === -16, `$001 closed door originY -16 (1-tile-up spawn offset; got ${r?.dynamicBody?.originY})`);
}
{
  const resolved = resolveSpriteCel(rom, sym, header, 0x12);
  if (resolved?.dynamicBody) {
    const img = renderSpriteCel(resolved.cel, {
      vram: new Uint8Array(0x10000), cgram: new Uint8Array(512),
      tileBaseBytes: resolved.tileBaseBytes, dynamicBody: resolved.dynamicBody
    });
    const u32 = new Uint32Array(img.rgba.buffer, img.rgba.byteOffset, img.rgba.length >>> 2);
    let opaque = 0; for (const p of u32) if ((p & 0xff000000) !== 0) opaque++;
    assert(opaque === 938, `$012 Boss Door = 938 opaque px (got ${opaque})`);
  }
}

// --- Test 3d: Super Star $088 + $059 are TOP-LEFT anchored (not centred) ------
// Cel-less, so origin would default to the centred fallback — but the v2 OAM shows
// dx=dy=0 (top-left at anchor), so both pin origin (0,0). $059 (item that becomes a
// super star) reuses $088's body. ($0B4 morph bubble keeps the centred fallback.)
for (const num of [0x088, 0x059]) {
  const r = resolveSpriteCel(rom, sym, header, num);
  assert(r?.dynamicBody?.originX === 0 && r?.dynamicBody?.originY === 0,
    `$${num.toString(16)} super-star body top-left origin (0,0) (got ${r?.dynamicBody?.originX},${r?.dynamicBody?.originY})`);
}

// --- Test 4: Piranha family ($066/$054/$09F) — stem cel + HIGH-nibble head body
// The head IS recoverable: a rot/scale dyntile read HIGH-nibble from $54:60C0 (32×32,
// byte-exact 688/688 vs the identity-scale rendered VRAM — the earlier "$54:60C0 = Yoshi
// car" was reading the LOW nibble). highNibble must be set so it doesn't decode garbage.
// $09F Ptooie shares the same head source + draw routine (CODE_05A769) as $066.
for (const num of [0x66, 0x54, 0x9f]) {
  assert(num in DYNAMIC_BODY_SOURCES && DYNAMIC_BODY_SOURCES[num]!.highNibble === true,
    `0x${num.toString(16)} head in DYNAMIC_BODY_SOURCES with highNibble`);
  const resolved = resolveSpriteCel(rom, sym, header, num);
  assert(resolved?.dynamicBody?.width === 32 && resolved?.dynamicBody?.height === 32,
    `0x${num.toString(16)} resolves a 32×32 head dynamic body (got ${resolved?.dynamicBody?.width}×${resolved?.dynamicBody?.height})`);
}
// The Ptooie $09F is the GREEN spitter → head palette row 0, vs $066/$054's red row 1.
assert(DYNAMIC_BODY_SOURCES[0x9f]!.paletteRow === 0, '$09F Ptooie head is pal 0 (green)');
assert(DYNAMIC_BODY_SOURCES[0x66]!.paletteRow === 1, '$066 Wild Piranha head is pal 1 (red)');

// --- Tulip $0A0 — 3 overlapping 16w columns, z-ordered (asm CODE_0CCC22 + the cel's 10 BODY records) --
// Side leaves $55:0061 (left x0 + hflipped right x16) BEHIND + centre flower $55:0031 (x8) ON TOP, all
// 16×31 HIGH-nibble, overlapping 8px so the leaves connect to the centre. The centre column is drawn
// last (front) per the cel's OAM order (centre records [0,1] first = highest priority). An earlier 8px
// half+mirror left the outer petals disconnected (the draw-order artifact the user flagged).
{
  const t = DYNAMIC_BODY_SOURCES[0xa0]!;
  assert(t.highNibble === true && !t.mirror && !t.flipH && Array.isArray(t.pieces) && t.pieces!.length === 3, '$0A0 tulip = 3-column composite (no mirror/flipH)');
  const [pL, pR, pC] = t.pieces!;
  assert(pL!.delta === 0x550061 - 0x548000 && pL!.x === 0 && pL!.width === 16 && !pL!.flipH, '$0A0 left leaf = $55:0061 16w @ x0');
  assert(pR!.delta === 0x550061 - 0x548000 && pR!.x === 16 && pR!.width === 16 && pR!.flipH === true, '$0A0 right leaf = $55:0061 16w @ x16, hflip');
  assert(pC!.delta === 0x550031 - 0x548000 && pC!.x === 8 && pC!.width === 16, '$0A0 centre flower = $55:0031 16w @ x8 (drawn last = on top)');
  assert(!!t.placeholderTiles && t.placeholderTiles.includes(0xca) && t.placeholderTiles.includes(0xee), '$0A0 tulip strips its LOW placeholder cel tiles');
  const body = decodeDynamicBody(rom, sym, 0xa0);
  assert(body?.width === 32 && body?.height === 31 && body.indices.some((v) => v !== 0), '$0A0 tulip decodes a non-empty 32×31 flower');
  // Both halves substantial and roughly symmetric (sides mirror, centre ~symmetric).
  let lNZ = 0, rNZ = 0;
  for (let y = 0; y < 31; y++) for (let x = 0; x < 32; x++) { if (body!.indices[y * 32 + x]) { if (x < 16) lNZ++; else rNZ++; } }
  assert(lNZ > 100 && rNZ > 100 && Math.abs(lNZ - rNZ) <= 8, `$0A0 both halves substantial & ~symmetric (L ${lNZ} / R ${rNZ})`);
}

// --- Test 4b: $03C Tap-Tap = a static 5-piece composite -------------------------
// The single-$55:4081 decode showed only the face. The full body (dynbody-transform OAM
// attribution, angle=0 scale=256 = no transform) is a 64×32 spiky SHELL ($55:00C1 HIGH)
// drawn top + 180°-mirrored (flipH+flipV) below, the FACE ($55:4081 HIGH) upper-centre,
// and two identical FEET ($55:60A1 HIGH). Guards the layout + the flipV piece flag.
{
  const t = DYNAMIC_BODY_SOURCES[0x3c]!;
  assert(Array.isArray(t.pieces) && t.pieces!.length === 5, '$03C Tap-Tap = 5-piece composite');
  const shellBottom = t.pieces!.find((p) => p.flipV);
  assert(!!shellBottom && shellBottom.flipH === true && shellBottom.delta === 0x5500c0 - 0x548000,
    '$03C shell-bottom = $55:00C0 HIGH, flipH+flipV (180° mirror)');
  assert(t.pieces!.some((p) => p.delta === 0x554080 - 0x548000) && t.pieces!.filter((p) => p.delta === 0x5560a0 - 0x548000).length === 2,
    '$03C has the face ($55:4080) + two feet ($55:60A0)');
  const body = decodeDynamicBody(rom, sym, 0x3c)!;
  assert(body.width === 66 && body.height === 74, `$03C decodes 66×74 (got ${body.width}×${body.height})`);
  const nz = (x0: number, y0: number, x1: number, y1: number) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (body.indices[y * 66 + x]) n++; return n; };
  assert(nz(1, 0, 65, 32) > 200 && nz(1, 32, 65, 64) > 200, '$03C shell populated top + bottom');
  assert(nz(11, 8, 43, 40) > 200, '$03C face region populated');
  assert(nz(0, 42, 32, 74) > 100 && nz(34, 42, 66, 74) > 100, '$03C both feet populated');
}

// --- Test 5: Format-A items render a single OBJ tile -------------------
// Red coin $065 (item, no Format-B cel) → object_data frame 0 = the full FRONT-view coin face
// (tile 160, 16×16, common page). NOT overridden — the spin frames are 160=front / 92=edge / 96 /
// 92-flip, and the edge frame 92 ("partially rotated") was user-rejected 2026-06-17.
assert(isFormatAOnlySprite(rom, sym, 0x65), '$065 red coin is Format-A-only');
assert(!isFormatAOnlySprite(rom, sym, 0x66), '$066 piranha is NOT Format-A-only (has Format-B)');
assert(!isFormatAOnlySprite(rom, sym, 0x9e), '$09E chomp is NOT Format-A-only (has Format-B)');
{
  const r = resolveSpriteCel(rom, sym, header, 0x65);
  assert(r !== null && r.cel.length === 1 && r.cel[0]!.size === 16, '$065 → one 16×16 record (coin face)');
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
    assert(img.width === 16 && img.height === 16, `$065 renders 16×16 coin face (got ${img.width}×${img.height})`);
    const u32 = new Uint32Array(img.rgba.buffer, img.rgba.byteOffset, img.rgba.length >>> 2);
    let opaque = 0; for (const p of u32) if ((p & 0xff000000) !== 0) opaque++;
    assert(opaque > 20, `$065 has content (${opaque} opaque px)`);
  }
}

// --- Custom-render origin convention (regression) -----------------------------------
// SpriteCompositor.finish() MUST return origin = the anchor's position WITHIN the image
// (positive when art extends left/above the anchor), matching renderSpriteCel's `-minX`, so
// the layer places custom + cel sprites identically via `cell*16 - origin`. A sign flip here
// put the $144 flipper ~3 tiles too low (the offset was applied inverted AND doubled).
{
  const c = new SpriteCompositor(new Uint8Array(512));
  const block = new Uint8Array(4 * 4).fill(1); // 4×4 opaque (index 1)
  c.blit(block, 4, 4, -10, -12); // top-left 10 px left, 12 px above the anchor
  const r = c.finish();
  assert(!!r && r.originX === 10 && r.originY === 12, 'finish() origin = anchor-within-image (+10,+12) for art up-left of the anchor');
  // Placement check: layer does baseX = cell*16 - origin → anchor-rel top-left = -origin.
  assert(!!r && -r.originX === -10 && -r.originY === -12, 'placement (cell*16 - origin) lands the block top-left at (-10,-12)');
}
// $144 flipper: trace-exact placement from the spr-144 OAM capture (anchor-rel y[-25..39]),
// both parities. (Indices, hence the crop bbox, are cgram-independent — blit keys on index!=0.)
{
  const dummyCg = new Uint8Array(512), noVram = new Uint8Array(0x10000);
  for (const parity of [0, 1]) {
    const rs = CUSTOM_SPRITE_RENDERERS[0x144]!({ rom, symbols: sym, vram: noVram, cgram: dummyCg, cellX: parity, cellY: 0, header: { spriteTileset: 0 } });
    assert(!!rs && rs.originY > 0, `$144 (parity ${parity}) origin is anchor-within-image (positive)`);
    assert(!!rs && -rs.originY === -25 && -rs.originY + rs.height === 39, `$144 (parity ${parity}) body places at anchor-rel y[-25..39] (spr-144 OAM)`);
  }
}

if (failures === 0) console.log('✓ all sprite-dynamic-gfx tests passed');
else { console.error(`${failures} failure(s)`); process.exit(1); }
