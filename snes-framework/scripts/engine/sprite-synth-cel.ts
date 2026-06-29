// Synthesized cels for HANDLER-DRAWN sprites — those with NO `special_chr` cel
// AND no `object_data` pointer, whose on-screen OAM is generated procedurally by
// the sprite's own handler. The static cel table has nothing to decode, so
// `resolveSpriteCel` would null them (glyph tier). We supply a hand-authored cel
// here, recovered from the sprite's v2 OAM capture (the `sprite-render-v2`
// ground-truth trace) and validated against it.
//
// IMPORTANT — these are still BUILD-DERIVED renders: a cel record carries only a
// LAYOUT (dx/dy/flip), a tileRow-RELATIVE tile number, and a palette ROW. The
// PIXELS come from the level's loaded VRAM at render time (the gfx the cart
// loads), exactly like a real `special_chr` cel — only the layout (which the
// runtime handler computes, and no static table holds) is recovered here.
//
// Portability: tiles are tileRow-RELATIVE to the sprite's OWN spriteset slot, which
// `spriteTileRow` recomputes per level — so they're portable whether they live in the
// ALWAYS-LOADED common page (tile < 256, file $72), spriteset slot 0 (the falling stones),
// or another slot ($017/$0D9/$1AA/$143 use slots 5/4/2/1). The palette ROW is BAKED from
// the capture (these handlers set per-record palettes the `$7042` seed doesn't describe),
// so `resolveSpriteCel` uses the synth cel VERBATIM — no seed-OR, no whole-sprite flip.
//
// ## ANCHOR (trace-derived — do NOT bbox-guess)
//
// dx/dy are relative to the sprite's TRUE anchor: its CAMERA-RELATIVE position
// `!EXRAM_YI_Level_NorSpr_XRelativeCamLo/YRelativeCamLo` ($70:1680/$1682 + slot*4),
// which the engine adds to each cel record to emit OAM. So the exact offset is
//     dx = OAM.x - xRelCam ,  dy = OAM.y - yRelCam
// (the `sprite-render-v2` slots.txt now dumps xRelCam/yRelCam per slot; recover
// with `tmp/synth-anchor.ts`). The OAM bounding-box top-left is NOT the anchor —
// using it left the stones mis-placed (the 6-wide $13A landed a tile-and-a-half
// too far right). These entries are re-derived from the re-trace.

import type { SpriteCel, SpriteCelTile } from './sprite-cel.ts';
import { PINWHEEL } from './sprite-parity.ts';

const t = (dx: number, dy: number, tile: number, paletteRow: number, size: 8 | 16 = 8, hflip = false, vflip = false): SpriteCelTile =>
  ({ dx, dy, tile, paletteRow, priority: 0, hflip, vflip, size });

/**
 * Four-rotating-platform pinwheel ($055/$056/$064/$15E) — generated from the shared geometry
 * (PINWHEEL: hub + radius) so the radius is the SINGLE SOURCE (also read by the renderer's orbit
 * overlay). 4 platforms (32×16 = $28+$2a) at the canonical diagonals around the hub, $bd spokes
 * at 0.4R/0.72R along each arm + a hub dot. Record order (hub, then per-arm) is the v2-validated
 * draw order — do not reshuffle.
 *
 * `shyGuy` ($15E only) adds a world-up shy-guy ($88 + 2× $9e) riding each platform. These are NOT
 * in $15E's own OAM — they're SPAWNED $01E child sprites (init `LDA #$01E : JSL
 * CODE_spawn_sprite_active`), so its v2 capture is pinwheel-only. We draw them deliberately as an
 * editor aid: they represent the passengers the pinwheel spawns on init (the "with Shy Guys"
 * variant), which the editor wouldn't otherwise show (spawned children aren't placed entities).
 */
function fourRotatingPlatforms(radius: number, platPal: number, spokePal: number, shyGuy: boolean): SpriteCel {
  const { hubX: ox, hubY: oy } = PINWHEEL, R2 = Math.SQRT1_2, r = (n: number): number => Math.round(n);
  const cel: SpriteCel = [t(r(ox) - 4, r(oy) - 4, 0xbd, spokePal, 8)]; // hub dot
  const dirs = [[R2, R2], [-R2, R2], [-R2, -R2], [R2, -R2]] as const; // SE, SW, NW, NE
  for (const [dx, dy] of dirs) {
    const cx = ox + radius * dx, cy = oy + radius * dy; // platform centre
    cel.push(t(r(cx) - 16, r(cy) - 8, 0x28, platPal, 16), t(r(cx), r(cy) - 8, 0x2a, platPal, 16));
    for (const f of [0.4, 0.72]) cel.push(t(r(ox + radius * f * dx) - 4, r(oy + radius * f * dy) - 4, 0xbd, spokePal, 8));
    if (shyGuy) cel.push(t(r(cx) - 8, r(cy) - 28, 0x88, 0, 16), t(r(cx) - 8, r(cy) - 14, 0x9e, 0, 8), t(r(cx) - 1, r(cy) - 14, 0x9e, 0, 8));
  }
  return cel;
}

/**
 * Falling-stone grid (sprites $137/$138/$139/$13A). The handler tiles a
 * `cols × rows` block of 16×16 records; the per-cell tile is picked by edge role,
 * with the vertical middle band alternating V-flip. The tile numbers + alternation
 * reproduce all four stones grid-tile-exact vs the v2 captures.
 *
 *   top row:    L=0   mid=2   R=4
 *   middle row: L=12  mid=14  R=32   (V-flip on odd middle-row index)
 *   bottom row: L=6   mid=8   R=10
 *
 * Anchor: these stones SPAWN OFFSET from their authored cell (they fall in), so
 * the cel must include that spawn offset on top of the cel shape (which is relative
 * to the sprite's own NorSpr camera-relative position). Recovered from the
 * UNPINNED spawn-frame trace (`--no-pin --settle 0`, tmp/synth-anchor.ts):
 *   - cel shape (OAM - camRel): leftmost `-8*(cols-1)`, top `-(8*rows-7)`.
 *   - spawnOffset (spawnWorld - cell): `(cols even ? +8 : 0, -8*(rows-1))` — the
 *     stone spawns 8·(rows-1) px ABOVE the cell (taller ⇒ higher) and even-width
 *     stones 8 px right. (Verified: $138 (0,-16), $13A (+8,-16); $137 -40 = the
 *     user's "2.5 tiles higher"; $13A +8 = "0.5 tile right".)
 * Combined: `dx = c*16 - 8*(cols-1) + (cols even ? 8 : 0)`,
 *           `dy = r*16 - (16*rows - 15)`  (the block's bottom edge lands ~at the
 * cell's bottom, extending UP). Tiles relative to spriteset slot 0 (tileRow 256);
 * palette row 6 = the $7042 seed.
 */
function fallingStone(cols: number, rows: number): SpriteCel {
  const cel: SpriteCel = [];
  const offX = 8 * (cols - 1) - (cols % 2 === 0 ? 8 : 0), offY = 16 * rows - 15;
  for (let r = 0; r < rows; r++) {
    const rowKind = r === 0 ? 'top' : r === rows - 1 ? 'bot' : 'mid';
    const midIdx = r - 1;
    for (let c = 0; c < cols; c++) {
      const colKind = c === 0 ? 'L' : c === cols - 1 ? 'R' : 'M';
      let tile: number;
      let vflip = false;
      if (rowKind === 'top') tile = colKind === 'L' ? 0 : colKind === 'R' ? 4 : 2;
      else if (rowKind === 'bot') tile = colKind === 'L' ? 6 : colKind === 'R' ? 10 : 8;
      else { tile = colKind === 'L' ? 12 : colKind === 'R' ? 32 : 14; vflip = (midIdx & 1) === 1; }
      cel.push(t(c * 16 - offX, r * 16 - offY, tile, 6, 16, false, vflip));
    }
  }
  return cel;
}

/**
 * Handler-drawn sprite → its synthesized cel (relative tiles, baked palette/flip,
 * dx/dy relative to the trace-derived NorSpr camera-relative anchor). Consulted by
 * `resolveSpriteCel` only when the sprite has NO `special_chr` / `object_data` and
 * no dynamic body, and by the layer/picker gates to mark the sprite renderable.
 * Verbatim entries transcribed from the re-trace (`tmp/synth-anchor.ts`).
 */
export const SYNTHESIZED_CELS: Readonly<Record<number, SpriteCel>> = {
  // $091 "4 Toadies": its own special_chr cel ($2E36) renders a broken group (wrong top half, no feet).
  // It should look like its siblings $058 Green / $05C Pink Toady — which share cel $2DD2 (the single
  // Toady: a 16×16 body $0e + two feet $2f + two head tiles, common-page, recolored by $7042) — just a
  // different color. Synth = $2DD2 FRAME 2 (the resting pose $058 uses via restFrame 2) baked at $091's
  // own palette row 1. (spritesetFiles set to [] in obj-metadata to match the siblings — all common-page.)
  0x091: [t(0, 0, 0x0e, 1, 16), t(1, 14, 0x2f, 1, 8, true), t(6, 14, 0x2f, 1, 8, true), t(8, -6, 0x3c, 1, 8, true), t(0, -6, 0x3c, 1, 8)],
  // Bullet Bill Blasters $078/$079/$07A: the body is the 16×16 ball (a DYNAMIC_BODY_SOURCES entry) drawn
  // at the IDLE scale 1× (asm init $7A36=$0100; ramps to ~2× only during the fire/cooldown zoom). This
  // synth cel = the body PLACEHOLDER (tile 0 → the dynbody composites there, behind) at origin (8,−1) +
  // the cannon-MUZZLE IN FRONT. The muzzle is the blaster's SPRITESET TILE 0 (= the loaded gfx file $31's
  // first tile = the tileRow/slot base): capture green $140 = slot-2 base, yellow $180 = slot-4 base, both
  // cel-value 0. Since cel tile 0 is the dynbody placeholder sentinel, the muzzle record sets `static:true`
  // so it renders as a real VRAM tile (the slot base) instead. It only resolves when file $31 is loaded —
  // a spriteset-dependent tile, like other spriteset sprites. Each piece uses the sprite's color row
  // (red 1 / yellow 2 / green 0) — body and muzzle share it (capture-confirmed).
  // Z-ORDER: renderSpriteCel composites back-to-front (reverse array order), so the FIRST record is
  // frontmost. The static cannon-BODY (spriteset tile 0) must be in front of the dynbody MUZZLE, so the
  // static record comes first (all three; user-confirmed 2026-06-18). Positions: the static body sits at
  // (0,0), the dynbody-muzzle placeholder at (0,−8) — half a tile up-left of the old (8,7)/(8,−1) then +1px
  // down, with the pieces' relative offset (0,+8) preserved. The muzzle origin matches in DYNAMIC_BODY_SOURCES.
  0x078: [{ ...t(0, 0, 0x0, 1, 16), static: true }, t(0, -8, 0x0, 1, 16)],
  0x079: [{ ...t(0, 0, 0x0, 2, 16), static: true }, t(0, -8, 0x0, 2, 16)],
  0x07a: [{ ...t(0, 0, 0x0, 0, 16), static: true }, t(0, -8, 0x0, 0, 16)],

  // Falling stones (spriteset slot 0, tileRow 256), centred on the spawn cell.
  0x137: fallingStone(3, 6),
  0x138: fallingStone(3, 3),
  0x139: fallingStone(3, 9),
  0x13a: fallingStone(6, 3),

  // Middle ring (checkpoint) — 14 8×8 common-page tiles ($44/$45/$54/$55) tracing
  // the ring, palette row 3. Anchor = NorSpr cam-rel (the ring's left-centre).
  0x04f: [
    t(-4, -15, 0x44, 3), t(2, -23, 0x54, 3), t(9, -24, 0x45, 3), t(16, -20, 0x55, 3),
    t(21, -10, 0x45, 3), t(23, 4, 0x54, 3), t(23, 18, 0x44, 3), t(19, 30, 0x54, 3),
    t(13, 38, 0x45, 3), t(6, 39, 0x55, 3), t(-1, 35, 0x45, 3), t(-6, 25, 0x54, 3),
    t(-8, 11, 0x44, 3), t(-8, -2, 0x54, 3)
  ],

  // Fly Guy carrying an item ($08D) — common-page body (16×16 tile $88) + wings/
  // face/feet (8×8), pal 1; carried item = 16×16 tile $E3, pal 3.
  0x08d: [
    t(0, 0, 0x88, 1, 16), t(1, 14, 0x2f, 1, 8, true), t(6, 14, 0x2f, 1, 8, true),
    t(8, -6, 0x2d, 1, 8, true), t(0, -6, 0x2d, 1), t(-2, 22, 0x49, 1), t(8, 22, 0x6f, 1),
    t(0, 22, 0x6e, 1), t(0, 17, 0xe3, 3, 16)
  ],

  // Whirly / Fly Guy carrying a red coin ($12C) — common-page body + wings, pal 1;
  // carried 16×16 tile $A0.
  0x12c: [
    t(0, 0, 0x88, 1, 16), t(8, -6, 0x3d, 1, 8, true), t(0, -6, 0x3d, 1),
    t(1, 14, 0x2f, 1, 8, true), t(6, 14, 0x2f, 1, 8, true), t(0, 16, 0xa0, 1, 16)
  ],

  // Boo Guys carrying a bomb ($105 toward-left / $106 toward-right). Handler-drawn:
  // a chain of boo-guy ghosts patrols a marker-tile path carrying a bomb, so the live
  // OAM is a wide, level-length-dependent formation (its special_chr cel is a 1-record
  // stub that only draws the bomb). We render the canonical UNIT — two boo guys carrying
  // the bomb between them — but ANCHORED to the asm draw, not the v2 capture: the draw
  // routine `CODE_0D85B8` ($0D:84AB main) plots the FIRST boo guy at the sprite anchor
  // ($00/$02 = $70E2/$7182 top-left, dy 0), then steps each further boo by DATA_0D833D =
  // ±32 px in the carry direction ($105 left $FFE0, $106 right $0020). So the PLACED CELL
  // sits on a boo guy (filling it, dx=dy=0), and the bomb + second boo trail in the carry
  // direction — NOT the bomb pinned to the anchor (the capture-derived layout put the
  // marker between the left boo and the bomb, half-a-unit off; user-flagged). Boo spacing
  // 32 px (bomb 16 px between). The bomb tile $ec is common-page (portable); the ghost
  // tiles $160/$162 live in spriteset file $3D (the boo guy's required file) at slot 3 →
  // they render wherever $3D loads at that slot (its natural levels), garbage elsewhere —
  // the standard non-portable-spriteset caveat for a handler-drawn enemy. $106 mirrors $105.
  // dx/dy carry a -8,-8 CENTERING bias: these parts are GSU-rasterised ($6000 plot buffer), whose
  // coordinate is the sprite CENTER (mchip.md §3 "R5 = center X"), not the top-left a hardware-OAM
  // cel uses. So the anchor boo's CENTRE sits at the placed cell — half a tile up + left of where a
  // top-left blit would land (user-flagged "should be at least a half tile up"). The other parts
  // keep the same 16/32-px spacing, shifted by the same bias.
  0x105: [t(-8, -8, 0x162, 0, 16), t(-24, -8, 0xec, 4, 16), t(-40, -8, 0x160, 0, 16, true)],     // anchor boo (right) → bomb → boo, trailing LEFT
  0x106: [t(-8, -8, 0x162, 0, 16, true), t(8, -8, 0xec, 4, 16, true), t(24, -8, 0x160, 0, 16)],  // anchor boo (left) → bomb → boo, trailing RIGHT

  // Handler-drawn enemies (no special_chr / object_data cel) — layout recovered from the
  // re-traced v2 captures (extended slots: dx = OAM.x − xRelCam + spawnOffset). Tiles are
  // tileRow-RELATIVE to each sprite's own spriteset slot (portable wherever its GFX loads).
  // $017 Frog Pirate — full figure (10 records, pal 1; spriteset, tileRow 416 at capture). The REST/
  // IDLE pose (state $76=0): re-captured at spawn (--settle 0), confirmed stable through settle 8 (the
  // frog sits idle several frames before its first jump). Body = 0x0/0x1 (16×16, same as the old jump
  // frame); idle limbs 0xb/0x6/0x18/0x8 (8×8) replace the jump limbs 0xc/0x9/0x19. Captured OAM order
  // kept = z-order (limbs in front of the body). (Was a mid-jump frame; user asked for the idle pose.)
  0x017: [
    t(-1, -4, 0xb, 1, 8, true), t(6, -4, 0xb, 1, 8), t(-4, 10, 0x6, 1, 8), t(5, 10, 0x6, 1, 8),
    t(14, 10, 0x18, 1, 8), t(14, 2, 0x8, 1, 8), t(2, 1, 0x1, 1, 16), t(-6, 1, 0x0, 1, 16),
    t(-2, 10, 0x18, 1, 8, true), t(-2, 2, 0x8, 1, 8, true)
  ],
  // $0D9 Fishin' Lakitu — lakitu + cloud + line (7 records; pals 0/1/2).
  0x0d9: [
    t(-4, -5, 0x4, 1, 16), t(2, -12, 0xd, 1, 8), t(-11, -4, 0x24, 1, 16), t(-18, 12, 0x26, 1, 16),
    t(-5, 5, 0x8, 2, 16), t(3, 5, 0x8, 2, 16, true), t(8, -2, 0x1d, 0, 8)
  ],
  // $1AA Hot Lips — the mouth body only (4 records, pal 1). The wide off-anchor records in the
  // capture are the transient fire spray it spits, not the resting figure, so they're dropped.
  0x1aa: [t(-8, -1, 0x0, 1, 16), t(8, -1, 0x6, 1, 16), t(1, -5, 0xd, 1, 8), t(8, -5, 0xd, 1, 8)],
  // $143 Spray Fish — the fish body only (3 records, pal 2). The water spray (common-page
  // particle tiles, far off-anchor in the capture) is the transient attack, dropped.
  0x143: [t(-8, 0, 0x0, 2, 16), t(8, 0, 0x2, 2, 16), t(-8, 0, 0x0, 2, 8)],

  // Piranha family — MIXED sprites (graphicsassets.md §5.8): a static STEM (spriteset
  // GFX file $29) drawn as THREE 8×8 records (tileRow-relative tiles 10, 26, 26-hflip),
  // PLUS the head supplied separately as a dynamic body (DYNAMIC_BODY_SOURCES, high-nibble
  // $54:60C0). dx/dy here are relative to the figure centre (the head body's origin places
  // it above-left). The stem records are 8×8 — a 16×16 record would expand to the quad
  // t,t+1,t+$10,t+$11 and pull adjacent sheet tiles (tile 11 = a neighbouring sprite),
  // which was the spurious right-8px artifact. Stem pal 1 (the $7042 seed for $066/$054).
  // All three handlers ($066/$054/$09F) share the head+stem draw routine CODE_05A769, so
  // the IDENTITY-scale stem↔head geometry is the same — $09F reuses $066's layout. ($09F's
  // own v2 capture shows the stem a few px lower, but that capture is at a non-identity
  // rot/scale frame, so its head-relative stem position is scaled — $066's identity layout
  // is the correct one to render.) $054 (ceiling plant) is the whole-sprite V-flip of $066: the
  // head body is V-flipped (its DYNAMIC_BODY_SOURCES origin drops to −1 vs $066's −17) about the
  // axis y=7, so the stem must V-flip its POSITIONS about that SAME axis (dy' = 6−dy), not just its
  // tile content — otherwise the stem stays at $066's y[2,18], lands fully inside the dropped head's
  // y-range, and (the cel-less head draws in front) is hidden behind it, leaving only a right-edge
  // sliver (the "cut-off stem" bug). $09F is the green Ptooie (head pal 0, not red).
  0x066: [t(6, 2, 10, 1, 8), t(2, 10, 26, 1, 8), t(10, 10, 26, 1, 8, true)],
  0x054: [t(6, 4, 10, 1, 8, false, true), t(2, -4, 26, 1, 8, false, true), t(10, -4, 26, 1, 8, true, true)],
  0x09f: [t(6, 2, 10, 1, 8), t(2, 10, 26, 1, 8), t(10, 10, 26, 1, 8, true)],

  // Very Goonie $155 — MIXED like the piranhas: a fat BODY supplied as a dynamic body
  // (DYNAMIC_BODY_SOURCES $54:2080, 32×32) PLUS goonie WINGS drawn statically here. $155's own
  // special_chr cel is body-only (10 tile-0 placeholders); its flapping wings are a separate GSU
  // affine plot (CODE_0E9CFB → FXCODE_0B8751, vertex tables DATA_0E9B91 — scaled per frame, not
  // reproducible offline), so without this it rendered wingless. As an editor aid we composite the
  // SAME wing gfx $153/$0E8 use (their cels' tiles $28/$2d), which live in GFX file $2B — and $155's
  // tileBase IS file $2B's base (file $2B is in $155's spritesets [$2A,$2B], always loaded), so the
  // wing is tileRow-relative tile $08 (16×16) and the tip $0d (8×8), robust across levels. Layout =
  // $153's frame-1 wings-up flap (the "less wide" identity; both bodies centre at (8,8) so the wing
  // dx/dy carry over). LAYERING mirrors $153's OAM record order: the RIGHT (near) wing is in FRONT
  // of the body, the LEFT (far) wing is BEHIND it — so record order front→back is R-wing, body,
  // L-wing, tips (the body's single tile-0 placeholder draws the dynamic body at its z). Palette
  // row 2 (matches the dynamic body + $153's wings). $153 duplicates the wing-tip 8×8 record; one
  // per side suffices here.
  0x155: [
    t(12, -10, 0x08, 2, 16),         // right (near) wing — IN FRONT of the body (file $2B tile $08)
    t(-8, -8, 0x0, 2, 16),           // fat body — dynamic-body placeholder
    t(-6, -10, 0x08, 2, 16, true),   // left (far) wing — BEHIND the body
    t(-3, -15, 0x0d, 2, 8, true),    // left wing tip (behind)
    t(17, -15, 0x0d, 2, 8)           // right wing tip
  ],

  // Four rotating platforms ($055/$056/$064/$15E) — generated from the shared PINWHEEL geometry
  // (sprite-parity.ts) so the radius is the single source (the renderer's orbit overlay reads the
  // same constant). $055/$15E = wide (R40), $056 = tight (R24). $064 picks its radius from cellY
  // parity: this is the cellY-EVEN (wide) cel, the ODD (tight) cel is SYNTHESIZED_CEL_PARITY_Y.
  // $055 platforms pal 0, the rest pal 4; $15E adds a world-up shy-guy rider per platform. Tiles
  // are spriteset-specific (correct in the sprites' own levels). ($051 Large Wheel is NOT here:
  // it renders via a GSU buffer DMA with no OAM tiles — not reproducible offline.)
  0x055: fourRotatingPlatforms(PINWHEEL.radiusWide, 0, 0, false),
  0x056: fourRotatingPlatforms(PINWHEEL.radiusTight, 4, 0, false),
  0x064: fourRotatingPlatforms(PINWHEEL.radiusWide, 4, 4, false),
  0x15e: fourRotatingPlatforms(PINWHEEL.radiusWide, 4, 4, true),

  // Boo Guys' spinning spiky mace $103 — the PLACED entity is the two Boo Guys (a white-sheet ghost
  // + a masked one); the spiky mace they spin is a separate AMBIENT child the handler spawns
  // (FXCODE_088205-plotted, id ≥ $1BA — not part of $103's own OAM, so not statically reproducible).
  // $103's special_chr frame-0 stacks 2 tiles at (0,0) (one blob). A live OAM capture (Mesen
  // dynbody-transform, record $46) shows the 2 Boo Guys at tileRow-relative $A (dx-10) + $2 (dx+7),
  // both h-flipped, pal 0 — a ~33px pair (one spin snapshot). Hand-place from the capture; the mace
  // itself (the ambient child) is not drawn.
  0x103: [t(-10, 0, 0xa, 0, 16, true), t(7, 0, 0x2, 0, 16, true)],

  // Chained green flatbed ferry $09A (SwingingGreenPlatform, `main_flatbed_ferry_green`
  // $0E:81D1). HANDLER-DRAWN: the special_chr frame-0 cel just stacks all 6 tiles at (0,0)
  // (so the bare render is a single green blob); the Main repositions them every frame —
  // a loop ($0C=3) plots the 3 chain-link dots (tile $bd, 8×8) up the swing vector, then
  // the post-loop plots the 2 deck tiles ($28/$2a = a 32px flatbed, same tiles as the
  // PINWHEEL platforms) + the $c0 mount block. The runtime SWINGS (GSU trig; $701902 inits
  // to $C000, a mid-swing phase — not a usable static rest), so we draw the canonical
  // straight-hang: deck at the placed cell, chain rising to the ceiling mount. Tiles + the
  // 3-link/deck/mount structure are from the asm draw; palette 0 (the frame-0 cel's row =
  // common green, idx3-5). Spacing 16px per the loop's swing-step.
  0x09a: [
    t(-16, 0, 0x28, 0, 16), t(0, 0, 0x2a, 0, 16),       // 32px flatbed deck at the anchor
    t(-4, -16, 0xbd, 0, 8), t(-4, -32, 0xbd, 0, 8), t(-4, -48, 0xbd, 0, 8), // 3 chain links up
    t(-8, -64, 0xc0, 0, 16)                              // ceiling mount block
  ],

  // Firebars ($1A0 double / $1A1 single) — a chain of fireballs (16×16, the firebar's OWN tile-0,
  // pal 1; the spriteset fireball, statically loaded, NOT GSU-dynamic) that FXCODE_0896DF places
  // at runtime-rotated positions along a bar (Bank0C main_firebar, layout DATA_0CA003, rotation
  // accumulator in WRAM $1976+). The editor draws one frame: fireballs ~19px apart along the bar
  // at the captured angle. $1A1 = 4 from the hub outward; $1A0 = 7 (hub + 3 each way).
  //   - tile is $0: the firebar's tileBaseBytes ($AC00) IS the fireball (OAM tile $160 absolute =
  //     $0 relative to its own tile-base). The synth-cel tile is per-sprite RELATIVE, not the OAM
  //     absolute (the boo-guys' $160 is the ghost in their different base).
  //   - dx carries a −8 X shift: init_firebar (Bank0C) does `$70E2 += $FFF8` (X−8), so the game
  //     pivots the bar at cell−8 while the editor anchors at the cell — the −8 here re-aligns it
  //     (the editor doesn't run the init). [v2 OAM positions, off = OAM−camRel, then X−8.]
  0x1a1: [
    t(-8, -1, 0x00, 1, 16, true), t(-26, 7, 0x00, 1, 16, true),
    t(-43, 15, 0x00, 1, 16, true), t(-60, 23, 0x00, 1, 16, true)
  ],
  0x1a0: [
    t(-60, -26, 0x00, 1, 16, true), t(-43, -18, 0x00, 1, 16, true), t(-26, -10, 0x00, 1, 16, true),
    t(-8, -1, 0x00, 1, 16, true), t(9, 7, 0x00, 1, 16, true), t(26, 15, 0x00, 1, 16, true), t(43, 23, 0x00, 1, 16, true)
  ]
  // NB: Muddy Buddy $063 renders body-ONLY (DYNAMIC_BODY_SOURCES $544000). Its draw routine
  // CODE_05E63A emits a single body plot — the common-page $2e/$2f "feet" from the v2 OAM were
  // a wrong guess (those tiles aren't the feet), so no synth cel here.
};

/** Y-parity radius variants for handler-drawn pinwheels whose orbit radius is chosen from the
 *  sprite's Y position (`$7182 & $0010`). `SYNTHESIZED_CELS` holds the cellY-EVEN cel; this holds
 *  the cellY-ODD one. Currently only $064: even → R40 (wide), odd → R24 (tight) — the effective
 *  editor mapping (verified visually), inverse of the spawn-frame trace because the bobbing hub's
 *  radius tracks its live Y. See DATA_04C42F (radii $28/$18) + main_four_rotating_platforms. */
export const SYNTHESIZED_CEL_PARITY_Y: Readonly<Record<number, SpriteCel>> = {
  0x064: fourRotatingPlatforms(PINWHEEL.radiusTight, 4, 4, false)
};
