// Pins the SP4 runtime-recolour fix: resolveSpriteCel's `settledPaletteRow`
// param FORCES the cel's OBJ palette row, replacing the static $7042 seed for
// sprites that recolour at spawn (the per-sprite rows baked into obj-metadata
// from the sprite-render trace). Reads the real V1.0 cart via the vendored
// symbol map (no build needed).
//
// Run: node snes-framework/scripts/engine/sprite-tile-base.test.ts

import * as fs from 'node:fs';
import { vendoredV10SymbolMap } from './symbol-map.ts';
import { resolveSpriteCel, mintSpriteset, resolveLevelSpriteset, spriteTileRow, spriteRequiredFile, AMBIENT_SPRITE_ID_BASE } from './sprite-tile-base.ts';
import { REST_FRAME } from './sprite-render-facts.ts';

const cartPath = '/mnt/d/Dev/SNES/YI_USA1.sfc';
let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; } else console.log(`  ✓ ${msg}`);
}

if (!fs.existsSync(cartPath)) {
  console.error(`cart not found at ${cartPath}; skipping`);
  process.exit(0);
}
const rom = new Uint8Array(fs.readFileSync(cartPath));
const sym = vendoredV10SymbolMap();
const header = { spriteTileset: 0 };

const palRows = (id: number, settled?: number): number[] | null => {
  const r = resolveSpriteCel(rom, sym, header, id, undefined, false, undefined, undefined, settled);
  return r ? [...new Set(r.cel.map((t) => t.paletteRow))].sort((a, b) => a - b) : null;
};

// $1AF "Coin" (FloatingCoin) — global-resident, so it resolves under any header.
// graphicsassets.md §5.7: it ORs |$000E → OBJ palette 7 for the alt coin. The
// static seed renders it palette 2; settledPaletteRow=7 must force every record
// to row 7. (Captured row 7 — the SP4 bake value for 0x1AF.)
const seed = palRows(0x1af);
assert(seed !== null && seed.length === 1 && seed[0] === 2, `0x1AF seed palette = [2] (got ${JSON.stringify(seed)})`);
const forced = palRows(0x1af, 7);
assert(forced !== null && forced.length === 1 && forced[0] === 7, `0x1AF settledPaletteRow=7 forces [7] (got ${JSON.stringify(forced)})`);

// settledPaletteRow=0 is a valid row (some sprites settle to 0), not "no override".
const forced0 = palRows(0x1af, 0);
assert(forced0 !== null && forced0.length === 1 && forced0[0] === 0, `0x1AF settledPaletteRow=0 forces [0] (got ${JSON.stringify(forced0)})`);

// Non-baked sprite: omitting the arg leaves the seed untouched.
const shy = palRows(0x1e);
assert(shy !== null && shy.length === 1 && shy[0] === 0, `0x1E shyguy unchanged without settled arg (got ${JSON.stringify(shy)})`);

// --- SP3 restFrame: $0B6 winged cloud IDENTITY frame 3 ----------------------
// Frame-0 special_chr cel is the WRONG pose (tiles 384-418, spriteset region — these RESOLVE under
// the corrected 448 gate, but are not the cloud). The cloud's flap cycle is frames 2-5; frame 4
// (tiles 206/222/234) is the asm-rest pose but draws the wings FULLY HORIZONTAL (a flat, stretched
// 46×16 silhouette). We render frame 3 (tiles 199/204/215) as the editor IDENTITY: the same cloud
// with the wings SPREAD (out to the sides, not flat) — a more recognizable winged-cloud silhouette
// (user art direction, the same identity-over-rest override as the goonies $153/$0E8). All variants
// share the cel, so frame 3 is the wings-spread cloud for every one.
const celTiles = (id: number, restFrame?: number): number[] | null => {
  const r = resolveSpriteCel(rom, sym, header, id, undefined, false, undefined, undefined, undefined, restFrame);
  return r ? [...new Set(r.cel.map((t) => t.tile))].sort((a, b) => a - b) : null;
};
const cloudF0 = celTiles(0x0b6);
assert(cloudF0 !== null && cloudF0.join(',') !== '199,204,215',
  `0x0B6 frame-0 resolves but is NOT the identity pose (got ${JSON.stringify(cloudF0)})`);
const cloud = celTiles(0x0b6, 3);
assert(cloud !== null && cloud.join(',') === '199,204,215', `0x0B6 restFrame=3 → wings-spread [199,204,215] (got ${JSON.stringify(cloud)})`);
// $0B7 (bubbled 1-up), $0BC (Bandit), $0C4 (watermelon), $0C9 ([CRASH]), $0CB (random item) — a sample
// of the family. All share the cloud Main $03:C2BF + draw routine, so they animate identically → frame
// 3 = the same wings-spread cel. ($0C9's "crash" is its pop/reward path, not its render — normal cloud.)
for (const id of [0x0b7, 0x0bc, 0x0c4, 0x0c9, 0x0cb]) {
  assert(REST_FRAME.get(id) === 3, `0x${id.toString(16).toUpperCase()} winged cloud has restFrame=3`);
  const c = celTiles(id, 3);
  assert(c !== null && c.join(',') === '199,204,215', `0x${id.toString(16).toUpperCase()} restFrame=3 → wings-spread [199,204,215] (got ${JSON.stringify(c)})`);
}

// --- Tile-base gate boundary: 448 (true $B800 dynamic), not 256 ---------------
// A fileInfo==0 (tileRow 0) sprite whose cel references tiles 256..447 draws from
// the LOADED spriteset ($A000-$B7FF) and MUST resolve; only tiles >= 448 are the
// GSU-streamed dynamic region (absent from static VRAM) and stay gated.
//   $133 Lantern Ghost: tiles [158,256,271] — was wrongly null'd by the old 256
//     gate; now resolves (renders from the spriteset).
//   $00C: cel maxTile >= 448 (true dynamic), no backing body — still null (correctly gated).
//   $03C Tap-Tap: now has a DYNAMIC_BODY_SOURCES entry ($55:4080), so it resolves via its
//     dynamic body (the >= 448 placeholder is backed by the bank-$55 bitmap).
const ghost = resolveSpriteCel(rom, sym, header, 0x133);
assert(ghost !== null, '$133 Lantern Ghost resolves (spriteset tiles 256-447, gate=448)');
assert(ghost !== null && ghost.cel.some((t) => t.tile === 271) && ghost.cel.some((t) => t.tile === 256),
  `$133 cel includes spriteset tiles 256 & 271 (got ${ghost ? JSON.stringify([...new Set(ghost.cel.map((t) => t.tile))].sort((a, b) => a - b)) : 'null'})`);
// $133 record 0: the special_chr placeholder is body tile $100 (renders as an "extra head"); the
// SPECIAL_CHR_RECORD_OVERRIDE patches it to the handler-drawn lantern flame $11b at a LOCKED pal1.
const ghostRec0 = ghost!.cel[0]!;
assert(ghostRec0.tile === 0x11b && ghostRec0.lockPalette === true && ghostRec0.paletteRow === 1,
  `$133 record 0 = lantern $11b, locked pal1 (got tile $${ghostRec0.tile.toString(16)} pal${ghostRec0.paletteRow} lock=${ghostRec0.lockPalette})`);
// The body recolours by spawn-cell parity (rows 0/1/2/4) but the locked lantern stays pal1.
const ghostP3 = resolveSpriteCel(rom, sym, header, 0x133, undefined, false, undefined, { x: 1, y: 1 })!; // parity 3 → row 4 (brown)
assert(ghostP3.cel[0]!.tile === 0x11b && ghostP3.cel[0]!.paletteRow === 1, '$133 lantern stays pal1 under the parity-4 body recolour');
assert(ghostP3.cel.slice(1).every((t) => t.paletteRow === 4), `$133 body records take parity row 4 (got ${JSON.stringify(ghostP3.cel.slice(1).map((t) => t.paletteRow))})`);
assert(resolveSpriteCel(rom, sym, header, 0x0c) === null, '$00C still gated null (cel tiles >= 448, true dynamic region, no body)');
const taptap = resolveSpriteCel(rom, sym, header, 0x3c);
assert(taptap?.dynamicBody !== undefined, '$03C Tap-Tap resolves via its dynamic body (DYNAMIC_BODY_SOURCES $55:4080)');

// --- Synthesized cels: handler-drawn falling stones ($137-$13A) ---------------
// No special_chr / object_data; the layout is hand-recovered (sprite-synth-cel.ts),
// validated grid-tile-exact vs the v2 capture (tmp/render-rocks.ts). The cel tiles
// are tileRow-relative; gfx comes from the loaded spriteset at render.
const stone = resolveSpriteCel(rom, sym, header, 0x138);
assert(stone !== null && stone.cel.length === 9, `$138 3×3 falling stone resolves (9 records, got ${stone?.cel.length})`);
if (stone) {
  // 3×3 footprint = 48×48 span. Anchor = cel shape + SPAWN OFFSET (the stone spawns
  // 8*(rows-1)=16px above its cell): dx ∈ {-16,0,16}, dy ∈ {-33,-17,-1}.
  const minY = Math.min(...stone.cel.map((t) => t.dy)), maxY = Math.max(...stone.cel.map((t) => t.dy + 16));
  const minX = Math.min(...stone.cel.map((t) => t.dx)), maxX = Math.max(...stone.cel.map((t) => t.dx + 16));
  assert(maxX - minX === 48 && maxY - minY === 48, `$138 footprint span 48×48 (got ${maxX - minX}×${maxY - minY})`);
  assert(minX === -16 && minY === -33, `$138 spawn-offset anchor: minX -16, minY -33 (got ${minX}, ${minY})`);
  // Bottom-left corner tile (leftmost col, bottom row dy -1) = relative tile 6, pal 6.
  const bl = stone.cel.find((t) => t.dx === -16 && t.dy === -1);
  assert(bl?.tile === 6 && bl?.paletteRow === 6, `$138 bottom-left corner = rel tile 6, pal 6 (got tile ${bl?.tile} pal ${bl?.paletteRow})`);
}
const stone96 = resolveSpriteCel(rom, sym, header, 0x13a);
assert(stone96 !== null && stone96.cel.length === 18, `$13A 6×3 falling stone resolves (18 records, got ${stone96?.cel.length})`);
// $13A 6-wide: leftmost dx -32 (8px right of the pure-centre -40 — its +8 spawn
// offset, = the user's "0.5 tile right"). Top dy -33 (spawns a tile higher).
if (stone96) {
  const minX = Math.min(...stone96.cel.map((t) => t.dx)), minY = Math.min(...stone96.cel.map((t) => t.dy));
  assert(minX === -32 && minY === -33, `$13A spawn-offset anchor: minX -32, minY -33 (got ${minX}, ${minY})`);
}

// Verbatim synth cels (common-page, baked palette): Middle ring + Fly Guys.
const ring = resolveSpriteCel(rom, sym, header, 0x4f);
assert(ring !== null && ring.cel.length === 14 && ring.cel.every((c) => c.paletteRow === 3),
  `$04F Middle ring resolves (14 8×8 records, pal 3; got ${ring?.cel.length})`);
const fly = resolveSpriteCel(rom, sym, header, 0x8d);
assert(fly !== null && fly.cel.length === 9 && fly.cel.some((c) => c.paletteRow === 3),
  `$08D Fly Guy resolves (9 records, item pal 3 baked; got ${fly?.cel.length})`);

// --- Format-A tile override (in-play frame, not object_data frame 0) ----------
// $022 egg → relative tile 128 (object_data frame 0 is 130); $183 butterfly → 19.
// The Coins ($065/$1AF, shared object_data) are NOT overridden — frame 0 = tile 160 IS the full
// FRONT-view coin (the spin frames are 160=front / 92=edge / 96 / 92-flip; the edge frame 92 looked
// "partially rotated" and was user-rejected 2026-06-17, reverting the WRONG-CEL 160→92 override).
const faTile = (id: number): number | null => {
  const r = resolveSpriteCel(rom, sym, header, id);
  return r && r.cel.length === 1 ? r.cel[0]!.tile : null;
};
assert(faTile(0x022) === 128, `$022 egg Format-A override → tile 128 (got ${faTile(0x022)})`);
assert(faTile(0x183) === 19, `$183 butterfly Format-A override → tile 19 (got ${faTile(0x183)})`);
assert(faTile(0x065) === 160, `$065 red coin → object_data frame 0 = front-view tile 160 (got ${faTile(0x065)})`);
assert(faTile(0x1af) === 160, `$1AF coin → front-view tile 160 (got ${faTile(0x1af)})`);

// --- Morph bubbles: restFrame=6 = bubble cel + per-vehicle dynamic icon -----------
// All 5 share special_chr $4d58; frame 6 = 4 common-page bubble corners ($7e/$9c,
// < 256) + 1 dynamic-slot vehicle-icon placeholder ($1dd, >= 448). Each of the 5 has
// its OWN static icon source in DYNAMIC_BODY_SOURCES (the per-vehicle table Bank03:9383,
// FXCODE_088619 — car $0AF/mole $0B0/heli $0B1/train $0B2/submarine $0B4, 100% tile-exact
// vs their v2 capture VRAM), so each keeps the placeholder as a `body` record and resolves
// a 16×16 dynamicBody (the user-reported "icon inside the bubble wasn't visible" fix —
// previously only the submarine had a source; the other 4 dropped their icon).
for (const [id, name] of [[0x0b4, 'submarine'], [0x0af, 'car'], [0x0b0, 'mole'], [0x0b1, 'heli'], [0x0b2, 'train']] as [number, string][]) {
  const m = resolveSpriteCel(rom, sym, header, id, undefined, false, undefined, undefined, undefined, 6);
  assert(m !== null && m.cel.length === 5, `$${id.toString(16).toUpperCase()} ${name} restFrame=6 → 5 records (4 corners + icon; got ${m?.cel.length})`);
  assert(m?.dynamicBody?.width === 16 && m?.dynamicBody?.height === 16, `$${id.toString(16).toUpperCase()} ${name} resolves a 16×16 vehicle-icon dynamicBody (got ${m?.dynamicBody?.width}×${m?.dynamicBody?.height})`);
  assert(m !== null && m.cel.filter((t) => !(t as { body?: boolean }).body).length === 4 && m.cel.filter((t) => (t as { body?: boolean }).body).length === 1,
    `$${id.toString(16).toUpperCase()} ${name} = 4 static bubble corners + 1 body record`);
}

// --- Boo Guys $105/$106: synth cel = boo + bomb + boo --------------------------
// $105/$106 are handler-drawn dynamic formations (a ghost chain carrying a bomb).
// Their special_chr cel is a 1-record stub that draws only the bomb ($ec); a
// SYNTHESIZED_CELS entry OVERRIDES it with the canonical unit — boo ($160/$162) +
// bomb ($ec) + boo, recovered from the v2 capture. Bomb $ec is common-page; the
// ghost tiles $160/$162 are spriteset file $3D (render in-context). The synth must
// win over the stub (3 records, bomb kept) — pins the override path too.
for (const id of [0x105, 0x106]) {
  const boo = resolveSpriteCel(rom, sym, header, id);
  assert(boo !== null && boo.cel.length === 3, `$${id.toString(16).toUpperCase()} synth overrides stub → 3 records (got ${boo?.cel.length})`);
  assert(boo !== null && boo.cel.some((t) => t.tile === 0xec) && boo.cel.some((t) => t.tile >= 0x160),
    `$${id.toString(16).toUpperCase()} keeps the bomb ($ec) + adds the ghost ($160/$162)`);
}

// --- Big Boo $071: 4-way PARITY VARIANT via hand-authored per-parity cels --------
// init_big_boo picks a different-SIZED figure by cell parity. PARITY_CEL_VARIANTS[$071]
// .cels (idx=2*(y&1)+(x&1)): x-even (0,2) = Big Boo w/ 3 Boos (4 body + 3 companion =
// 7 recs); x-odd y-even (1) = Big Boo (4 recs); x-odd y-odd (3) = lone Boo (1 rec). The
// companions are hand-placed in a row at the Big Boo's Y (the cel spawns them offset);
// the lone Boo is the boo tile (rel 46), re-centred — not the big-boo corner the raw
// cel slice gave. A parity sprite with NO placement defaults to variant 0.
{
  const exp = [7, 4, 7, 1]; // idx 0..3 record counts
  for (let idx = 0; idx < 4; idx++) {
    const placement = { x: idx & 1, y: (idx >> 1) & 1 };
    const r = resolveSpriteCel(rom, sym, header, 0x71, undefined, false, undefined, placement);
    assert(r !== null && r.cel.length === exp[idx], `$071 parity idx${idx} (x${placement.x}/y${placement.y}) → ${exp[idx]} records (got ${r?.cel.length})`);
  }
  // lone Boo (idx3) = the boo tile rel 46 (NOT a big-boo body corner like rel 4).
  const boo = resolveSpriteCel(rom, sym, header, 0x71, undefined, false, undefined, { x: 1, y: 1 });
  assert(boo !== null && boo.cel.length === 1 && boo.cel[0]!.tile === 46, `$071 lone Boo = one rel-46 boo tile (got tile ${boo?.cel[0]?.tile})`);
  // no placement → variant 0 (Big Boo w/ 3 Boos, 7 recs).
  const noPlace = resolveSpriteCel(rom, sym, header, 0x71);
  assert(noPlace !== null && noPlace.cel.length === 7, `$071 no-placement defaults to variant 0 (7 recs; got ${noPlace?.cel.length})`);
}

// --- Piranha family $066/$054/$09F: synth STEM (3× 8×8) + high-nibble dynamic HEAD -
// Mixed sprite: a static stem (spriteset file $29, THREE 8×8 records — tiles 10, 26,
// 26-hflip; NOT a 16×16 record, which would pull the adjacent quad tile 11 = a different
// sprite) + the head as a rot/scale dyntile decoded HIGH-nibble from $54:60C0 (32×32,
// byte-exact 688/688 vs the identity-scale VRAM). $054 is the vflipped ceiling variant;
// $09F is the green Ptooie spitter (same head+stem draw routine CODE_05A769 as $066).
for (const id of [0x066, 0x054, 0x09f]) {
  const p = resolveSpriteCel(rom, sym, header, id);
  assert(p !== null && p.cel.length === 3 && p.cel.every((t) => t.size === 8),
    `$${id.toString(16).toUpperCase()} stem = three 8×8 records (got ${p?.cel.length}, sizes ${p?.cel.map((t) => t.size)})`);
  assert(p?.dynamicBody?.width === 32 && p?.dynamicBody?.height === 32,
    `$${id.toString(16).toUpperCase()} head dynamic body is 32×32 (got ${p?.dynamicBody?.width}×${p?.dynamicBody?.height})`);
}
assert(resolveSpriteCel(rom, sym, header, 0x054)?.cel[0]?.vflip === true, '$054 upside-down piranha stem is vflipped');

// --- Spriteset override + mintSpriteset: provide a valid spriteset for a level ---
// A sprite renders from the spriteset slot holding its required gfx file
// (DATA_sprite_gfx_file_table). When the header's stock spriteset lacks that file,
// spriteTileRow falls back to row 0 (common-page garbage). An explicit
// `spritesetOverride` (a minted set) is honoured by spriteTileRow exactly as
// loadLevelGfx honours it for the VRAM load — so the slot a sprite reads matches the
// file loaded there. Cart facts (frittpa's sprites): Egg-Plant $0F4 needs file $1F,
// Rotating Doors $01F needs $31, Spiked log $126 needs $4E; Flipper $144 is common-page.
assert(spriteRequiredFile(rom, sym, 0xf4) === 0x1f, `$0F4 requires gfx file $1F (got ${spriteRequiredFile(rom, sym, 0xf4)})`);
assert(spriteRequiredFile(rom, sym, 0x01f) === 0x31, `$01F requires gfx file $31 (got ${spriteRequiredFile(rom, sym, 0x01f)})`);
assert(spriteRequiredFile(rom, sym, 0x144) === null, '$144 Flipper is common-page (no required file → null)');
assert(spriteRequiredFile(rom, sym, AMBIENT_SPRITE_ID_BASE) === null, `ambient id ≥ $${AMBIENT_SPRITE_ID_BASE.toString(16)} is not spriteset-gated (→ null)`);

// spriteTileRow honours the override: slot index = (row-256)/32, lowest matching slot
// wins (so padding repeats are harmless). Without the file in the set → row 0 (broken).
const ovr = [0x1f, 0x31, 0x4e, 0x1f, 0x1f, 0x1f];
assert(spriteTileRow(rom, sym, { spriteTileset: 0, spritesetOverride: ovr }, 0xf4) === 256, '$0F4 → slot 0 (row 256) under override holding $1F');
assert(spriteTileRow(rom, sym, { spriteTileset: 0, spritesetOverride: ovr }, 0x01f) === 288, '$01F → slot 1 (row 288, file $31)');
assert(spriteTileRow(rom, sym, { spriteTileset: 0, spritesetOverride: ovr }, 0x126) === 320, '$126 → slot 2 (row 320, file $4E)');
assert(spriteTileRow(rom, sym, { spriteTileset: 0, spritesetOverride: [0x31, 0x4e, 0, 0, 0, 0] }, 0xf4) === 0, '$0F4 → row 0 (broken fallback) when $1F absent from the override');

// mintSpriteset derives the distinct required set (sorted), pads to 6 slots, and only
// overflows past 6 distinct files (the hardware ceiling). frittpa: 3 files, no overflow.
const fp = mintSpriteset(rom, sym, [{ num: 0xf4 }, { num: 0x01f }, { num: 0x126 }, { num: 0x144 }]);
assert(fp.required.join(',') === [0x1f, 0x31, 0x4e].join(','), `mint required = [$1F,$31,$4E] (got [${fp.required.map((n) => n.toString(16))}])`);
assert(fp.files.length === 6 && fp.overflow.length === 0, `mint pads to 6, no overflow (got files=${fp.files.length} overflow=${fp.overflow.length})`);
assert(fp.files.slice(0, 3).join(',') === [0x1f, 0x31, 0x4e].join(','), 'mint files lead with the required set');
// 8 sprites with 8 distinct files → 2 overflow the 6-slot ceiling (ids chosen for distinct files).
const eight = [0x2, 0xa, 0x10, 0x16, 0x17, 0x1a, 0x1b, 0x1f].map((num) => ({ num }));
const ov = mintSpriteset(rom, sym, eight);
assert(ov.required.length === 8 && ov.files.length === 6, `mint of 8-distinct-file sprites: 8 required, 6 files (got ${ov.required.length}/${ov.files.length})`);
assert(ov.overflow.join(',') === [0x61, 0x68].join(','), `mint overflow = the 2 files past slot 6 [$61,$68] (got [${ov.overflow.map((n) => n.toString(16))}])`);

// resolveLevelSpriteset preserves the authored slot a gfx-file-table=0 sprite's cel reads.
// Boo Guys $105/$106 read slot 3 (synth tiles 352/354), which monky10's authored spriteset
// 0x29 fills with file 0x3D. A naive mint (gfx-file-table only) is blind to them and would
// evict 0x3D → garbage; the resolver keeps it. It also swaps a MISSING required file
// (Egg-Plant $0F4 needs 0x1F, absent from 0x29) into a free slot WITHOUT touching slot 3.
const booSet = resolveLevelSpriteset(rom, sym, { spriteTileset: 0x29 }, [{ num: 0x105 }]);
assert(booSet.files[3] === 0x3d && !booSet.minted, `boo-guy slot 3 keeps authored 0x3D, not minted (got 0x${booSet.files[3]?.toString(16)} minted=${booSet.minted})`);
const mixSet = resolveLevelSpriteset(rom, sym, { spriteTileset: 0x29 }, [{ num: 0x105 }, { num: 0xf4 }]);
assert(mixSet.files[3] === 0x3d && mixSet.files.includes(0x1f) && mixSet.minted, `swap missing 0x1F into a free slot, keep boo slot 3 (got [${mixSet.files.map((f) => f.toString(16))}] minted=${mixSet.minted})`);

if (failures) { console.error(`\n✗ ${failures} sprite-tile-base assertion(s) failed`); process.exit(1); }
console.log('\n✓ all sprite-tile-base SP4+SP3 pins pass');
