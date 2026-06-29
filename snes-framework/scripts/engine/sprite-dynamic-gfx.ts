// Dynamic-body sprite gfx — the chunky bank-$54 bitmap source for dynamic-OBJ sprites
// (rigid identity-transform bodies AND rot/scale bodies, whose source is the same static
// bitmap read at identity — see "The two sub-cases" below).
//
// # Background
//
// Most cel-bearing enemies place their tiles from VRAM that `loadLevelGfx`
// already populated (the spriteset / common page — `sprite-cel.ts`). But ~209
// sprites have a *dynamic body*: gfx the GSU streams into the dynamic OBJ region
// (VRAM `$B800-$C000`, OBJ tiles `$1C0-$1FF`) at spawn, which our static VRAM
// never contains. Those bodies are NOT a static tile asset anywhere in ROM —
// the GSU's rotzoom/PLOT rasterizer (`CODE_088295`, Bank08) reads a **chunky
// indexed bitmap** from bank `$54` and plots it into the OBJ framebuffer, which
// NMI then DMAs to VRAM. See research/notes-sprite-render.md.
//
// # The two sub-cases
//
//   - **Rigid** (scale 1.0, no rotation): the rasterizer output is a *verbatim*
//     copy of the source bitmap — so we can read the bitmap from ROM and blit it
//     ourselves, no GSU needed.
//   - **Rot/scale** (Wild Piranha head, …): the body is plotted through a non-identity
//     matrix, BUT the *source* is still a plain static bitmap — read it at identity and
//     apply the `scale` yourself (the rotzoom is a runtime transform, not a storage
//     format). The one difference vs rigid is which nibble holds the index (see below).
//     Genuinely-rotating bodies (true angular spin) stay glyph-tier unless fixed-angle.
//
// # The source format (reverse-engineered offline; see research/notes-sprite-render.md)
//
// Bank `$54+` holds a bitmap *sheet*; each sprite's body is a sub-rectangle.
//   - **Chunky**, 1 byte per pixel; a nibble of each byte is the 4bpp palette index
//     (the palette *row* comes from the sprite OAM attr, like the cel tiles). **Which
//     nibble** is a per-draw control, NOT plotter-determined: both GSU plotters set POR
//     bit 2 ("color high-nibble") from R12 bit 0, so validate it per sprite (`highNibble`
//     flag). Rigid bodies checked so far use the LOW nibble; the rot/scale piranha head
//     the HIGH nibble.
//   - **Row-major**, with a fixed **256-byte row stride** (the sheet is 256px wide).
//   - A per-sprite source pointer (no static table — runtime-computed by the GSU),
//     so each entry's offset was recovered empirically from yi-shiny `sprite-render`
//     VRAM captures (the cracker `tmp/crackbatch.ts`) and **validated** byte-exact
//     against the rasterized output (e.g. Chomp Rock `$9E` = 810/810 px; Balloon
//     Pump `$073` independently lands on `FXDATA_548000+$40`, matching `CODE_028048`).
//
// # Version robustness
//
// Offsets are stored as a **signed delta from the `DATA_gfx_bank54_part2`
// symbol** (bank `$54:8000`; main-side alias `FXDATA_548000`), not a raw V1.0
// literal — `srcPC = symbols.pc('DATA_gfx_bank54_part2') + delta`. The bitmap
// sheet and that symbol sit in the same SuperFX bank region and shift together
// across ROM versions, so the delta is portable (the rest of the engine resolves
// cart addresses the same symbol-anchored way). NB: V1.1 deltas are assumed equal
// pending a V1.1 capture pass — re-verify when V1.1 dynamic-body render is wired.

import type { SymbolMap } from './symbol-map.ts';
import { rotozoomDecode, type RotozoomParams } from './rotozoom.ts';

/** SNES base the per-sprite deltas are measured from (the
 *  `DATA_gfx_bank54_part2` symbol = bank `$54:8000`). */
const ANCHOR_SNES = 0x548000;
/** The symbol the runtime resolves to anchor every delta (drift-proof).
 *  Friendly SuperFX-side label; the main `.sym` aliases the same address as
 *  `FXDATA_548000`, and the merged map resolves both to the same PC. */
export const DYNAMIC_GFX_ANCHOR_SYMBOL = 'DATA_gfx_bank54_part2';
/** Source bitmap row stride (the sheet is 256 px / bytes wide). */
const BITMAP_ROW_STRIDE = 0x100;

// ── Deriving `delta` from an asm draw routine (READ THIS — it caused a real bug) ─────────────
// A sprite's draw loads its source into R12/R13 as `LDA #FXDATA_5X0000(+$OFF) : STA R12`. The
// `FXDATA_5X0000` symbols are ABSOLUTE SNES addresses, NOT bank-relative offsets:
//     FXDATA_540000 = $54:0000   FXDATA_548000 = $54:8000   (verify in build*/ *.sym)
//     FXDATA_550000 = $55:0000   FXDATA_558000 = $55:8000
// So `FXDATA_548000+$00B0` = $54:80B0 (NOT $54:00B0!). Then: delta = absoluteSnes - 0x548000.
//
// THE BUG (2026-06-17): `FXDATA_548000+$00B0`/`+$00C1` were converted with the $8000 dropped →
// $54:00B0 / $54:00C0, which land in the FXDATA_540000 half and rendered a DIFFERENT sprite's
// gfx (the chomp sign $0D8 drew the red switch $09D, whose source really IS FXDATA_540000+$00C1
// = $54:00C0). Two gotchas let it slip through:
//   1. A wrong address still decodes to a plausible NON-EMPTY body (the whole $54-$56 region is
//      graphics), so an opaque-pixel count does NOT validate the source. The .sym address and a
//      visual/byte-vs-captured-VRAM check are the real gates.
//   2. The OAM tile-count OVER-states the body size: the lava bubble draws 4 OBJ tiles (32×32)
//      but the bubble is only the top-left 16×16 — the rest are transparent/neighbour padding.
//      Confirm the real opaque extent, don't assume tile-count × 16.
//
// ── A `--identity` capture can read a NEIGHBOUR sprite's source (READ THIS — also a real bug) ──
// The `--identity` trace finds a source by watching GSU GETGamePakROM reads of $54-$56 while a body
// draws at unit scale (R8=R9=$0100). BUT the watch fires on ANY such read in the scene — including
// a DIFFERENT sprite drawn alongside the target. THE BUG (2026-06-17): the Helicopter morph bubble
// ($0B1) identity-read `$55:40E0`, which is actually **Jean de Fillet's** body ($104) — a neighbour
// in the heli's level. It decoded to a plausible 47%-opaque image (every $54-$56 region is real
// gfx), so it looked fine. The TRUE source was in the sprite's OWN asm draw: a per-vehicle table
// (Bank03:9383, FXCODE_088619) gives heli `$55:7060`; all five morph icons then matched their
// capture VRAM 100% (tmp/morph-validate.ts).
//   RULE: an identity/empirical source is a CANDIDATE, not a fact. Confirm it against (a) the
//   sprite's OWN asm source-load (the `LDA #FXDATA_5X..` / `dw FXDATA_5X..` in its handler or GSU
//   draw — `npm run closure`/`--grep`), and/or (b) a 100% tile-exact match of the decoded source
//   vs the sprite's capture VRAM (decode OBJ tiles at name-base $8000 + tile*32). A non-empty
//   decode or opaque-pixel count is NOT validation.

/** One rigid dynamic-body source: where its chunky bitmap lives, how big it is,
 *  and the OBJ palette row it draws through. */
export interface DynamicBodySource {
  /** Signed byte delta from `FXDATA_548000` to the bitmap's top-left pixel. */
  delta: number;
  /** Bitmap width in pixels. */
  width: number;
  /** Bitmap height in pixels. */
  height: number;
  /** Horizontally flip the decoded body. The GSU flips some bodies via its R4 (facing) register,
   *  independent of the OBJ attribute — so the on-screen body is mirrored vs the raw texture even
   *  though `DATA_0A9F1A`'s hflip bit is clear (e.g. $0A0 tulip body = flat $55:0060 read, hflipped,
   *  100% vs capture). Confirmed via the dynbody-transform trace + settled-capture match. */
  flipH?: boolean;
  /** Rotozoom transform (angle/scale) captured by the dynbody-transform trace. When set, the body is
   *  rasterized by `rotozoomDecode` (rotation + fractional scale of the `width×height` source rect)
   *  instead of the flat/mirror/scale path — for bodies the GSU draws transformed (the rigid decoder
   *  can't reproduce those: e.g. $07A's ~1.98× zoom). `width`/`height` are the UN-transformed source
   *  rect; the output size is derived. Mutually exclusive with `mirror`/`scale`/`centerUnder`. */
  rotozoom?: RotozoomParams;
  /** OBJ palette row 0..7 (→ CGRAM row 8..15). Ground-truth from the capture's
   *  OAM attr — more reliable than deriving from the cel record (whose palette is
   *  wrong for some, e.g. `$0b4`). */
  paletteRow: number;
  /** Cel tile values that are body **placeholders** the GSU remaps into the
   *  dynamic OBJ slot (so they must NOT be blitted from VRAM — the body bitmap
   *  draws them). Needed only for sprites whose placeholders use LOW tiles
   *  (`$c0-$d3`) the default `tile === 0 || tile >= 256` rule misses; absent
   *  otherwise. Identified from the capture (cel tiles that don't appear in the
   *  OAM = remapped). */
  placeholderTiles?: readonly number[];
  /** Body top-left relative to the sprite (0,0) anchor, in px. Overrides the
   *  cel-derived origin (the placeholder records' bbox). Needed when the cel
   *  misrepresents the body footprint (e.g. `$06c`'s 8×8 placeholders vs its
   *  32×32 body) or there's no cel. Omit to derive from the cel / centre. */
  originX?: number;
  originY?: number;
  /** Integer upscale factor the GSU applies when plotting (default 1). Some bodies
   *  are stored as a small chunky bitmap the rasterizer draws at 2× — e.g. the
   *  expansion/checkered blocks ($094-$096): a 16×16 source the GSU plots into a
   *  32×32 OBJ footprint. We nearest-neighbour upscale the ROM bytes at decode time
   *  (a render transform on the source data, not a baked pixel asset) so the body
   *  matches its in-game size and fills its cel footprint. */
  scale?: number;
  /** Drop the cel's non-placeholder (static VRAM) records and render the body
   *  alone. For sprites whose `special_chr` cel is a *vestigial wrong frame*
   *  (char-id ≠ sprite-id) that the GSU never actually draws — e.g. a second puffer
   *  frame superimposed on the body. The body's placeholder record(s) still anchor it. */
  bodyOnly?: boolean;
  /** Drop ALL cel records (including placeholders) and render the body STANDALONE — its bounds are
   *  the body bitmap alone, anchored at `originX`/`originY`. For sprites whose `special_chr` cel
   *  OVER-ALLOCATES the OBJ footprint relative to the actual body: e.g. $080 Lava Bubble's cel is a
   *  2×2 (32×32) placeholder grid but the bubble is only one 16×16 tile, so the 4-record footprint
   *  made the selection outline 2× too big and centred. With this, the 16×16 body defines the outline,
   *  top-left-anchored (`originX:0,originY:0`). (Differs from `bodyOnly`, which KEEPS the placeholders
   *  tagged `body` for z-order with static records.) ONLY for over-allocated/transparent-padding cels —
   *  NOT for multi-piece composites where the larger footprint is REAL content (e.g. the morph bubbles
   *  $0AF-$0B4: 4 composited bubble corners + the vehicle icon, whose outline correctly spans the bubble). */
  bodyStandalone?: boolean;
  /** The INVERSE of `bodyOnly`: drop the dynamic-slot placeholder record(s) and render
   *  the cel's STATIC frame, with NO dynamic body. For sprites whose recognisable
   *  default visual is the static `special_chr` cel (a VRAM asset), not the bank-$54
   *  body — e.g. 0x0F8 Blow Hard's deflated puffer (the inflated bank-$54 body is the
   *  interaction state). Kept in this table (rather than dropped) so the
   *  placeholder-suppression decision lives with the other body metadata. */
  staticsOnly?: boolean;
  /** Mirror the source to form a symmetric body. For sprites the GSU draws as two
   *  mirrored copies of one stored bitmap:
   *   - `'right'` → `[source | hflip(source)]`, width doubled (spiked platforms, doors;
   *     also the $13C flipper = a horizontally-mirrored pair).
   *   - `'down'`  → `[source / vflip(source)]`, height doubled (the $144 flipper = a
   *     vertically-mirrored pair). */
  mirror?: 'right' | 'down';
  /** A SECOND source (same width/height/nibble) drawn UNDERNEATH the mirrored body and
   *  horizontally CENTERED — fills the seam a pure `mirror:'right'` leaves down the middle.
   *  Value = the center source's `delta` (`srcSnes − 0x548000`). For 3-part symmetric bodies:
   *  the tulip ($0A0) is outer petals (mirror of $55:0060) + a CENTRAL petal ($55:0030) drawn
   *  behind them (only where the mirror is transparent → the central petal shows in the notch,
   *  the outer petals' separator detail stays on top). 93% vs the v2 capture (residual = an
   *  asymmetric glint + 1px seam). Requires `mirror:'right'`. */
  centerUnder?: number;
  /** Read each pixel index from the source byte's HIGH nibble (`>> 4`) instead of the
   *  low nibble. The GSU rot/scale plotter (`CODE_088205`, `MERGE`-addressed) samples
   *  some textures with the 4bpp index in the high nibble — verified byte-exact for the
   *  Wild Piranha head (0x066) vs its identity-scale rendered VRAM. (Rigid dyntiles
   *  use the low nibble.) See docs/graphicsassets.md §5.8. */
  highNibble?: boolean;
  /** Multi-piece composite: several DISTINCT source rectangles tiled into one body bitmap. For bodies
   *  the GSU draws from more than one texture in one frame — each `CODE_…`/trampoline plot a separate
   *  piece (e.g. the tulip $0A0: `$55:0061` body + `$55:0031` lip, side by side; see CODE_0CCC22). The
   *  pieces' `x`/`y` are their top-left within the composite, in px (transparent index 0 = skip, so
   *  pieces may overlap). When set, this replaces the single `delta` flat read (the top-level
   *  `delta`/`width`/`height` still describe the body's overall bounds for placeholder/origin logic).
   *  This is the static analogue of the dynbody-transform trace's per-plot `placements[]`/`outBbox`
   *  (v3 §10) — hand-authored from the asm until the trace supplies exact landings. */
  pieces?: readonly BodyPiece[];
}

/** One source rectangle within a multi-piece composite body (see `DynamicBodySource.pieces`). */
export interface BodyPiece {
  /** Signed byte delta from `FXDATA_548000` to this piece's top-left pixel. */
  delta: number;
  width: number;
  height: number;
  /** Read the HIGH nibble of each source byte (per-piece; the GSU samples some textures high). */
  highNibble?: boolean;
  /** Top-left placement of this piece within the composite bitmap, in px. */
  x: number;
  y: number;
  /** Horizontally flip this piece (the GSU's R4 facing flip). */
  flipH?: boolean;
  /** Vertically flip this piece (the GSU's V-flip bit). Lets one stored half build a
   *  vertically-symmetric body (e.g. Tap-Tap $03C's spiky shell = a 64×32 source drawn
   *  direct on top + 180°-mirrored — flipH+flipV — on the bottom). */
  flipV?: boolean;
}

/**
 * Rigid dynamic-body sprites → their bank-`$54` chunky bitmap source. Keyed by
 * 9-bit sprite num. Each `delta` is `srcSnes - 0x548000` (see file header).
 *
 * ── ADDING / FIXING AN ENTRY: find the source in the ASM, not from captures ──────────────
 * The source is a STATIC literal in the sprite's draw-setup asm. Brute-forcing a `$54-$56`
 * offset/stride/nibble from a VRAM capture is the #1 recurring mistake here ($0A0, $0F3, $098
 * all started that way) — DON'T. Instead:
 *   1. In yi-shiny, find the sprite's draw/init handler (`npm run xref -- --search NorSprXXX`,
 *      then `npm run closure`). Read its GSU source load: `LDA #FXDATA_5X0000(+$OFF) : STA R12`
 *      (single-frame) or a `dw FXDATA_5X..` frame table (animated). THAT literal is the source.
 *   2. Resolve it per the file header — `FXDATA_548000` is the ABSOLUTE base `$54:8000`, so
 *      `FXDATA_548000+$60C0` = `$54:E0C0`, NOT `$54:60C0` (this exact slip mis-sourced $098).
 *   3. ONLY THEN confirm the decode vs a capture. A non-empty decode / opaque-pixel count /
 *      "best %" brute-force is NOT a source finder — every `$54-$56` address is real gfx, and
 *      captures can be MID-PLOT (the $098 capture had stale all-tile-0 OAM, useless as truth).
 *
 * Provenance: the older entries were recovered offline from yi-shiny `sprite-render` VRAM
 * captures and **validated byte-exact** (all pixels) against the rasterized output (see
 * `tmp/revalidate.ts`) — a CONFIRMATION method, not the way to find a NEW source (use the asm,
 * above). Sprites whose body is transformed (rotzoom) or whose offline match was only partial
 * were dropped. Several entries share an offset (gfx reuse): the three buckets, the spring-balls.
 *
 * **Placement caveat.** The body is positioned over the cel's dynamic-region
 * records (`tile === 0` or `tile >= 256`). Entries marked "placement pending"
 * have a *correct bitmap* but their cel places the body via LOW placeholder tiles
 * (`$c0-$d3`) the current `resolveSpriteCel` filter doesn't recognise — so the
 * body decodes but isn't drawn yet (a placement source is the remaining work, see
 * research/plan-editor-remaining.md SP2). They're kept here so the gfx work isn't lost.
 */
export const DYNAMIC_BODY_SOURCES: Readonly<Record<number, DynamicBodySource>> = {
  // ── Doors. Every door shares one special_chr cel ($9407): four tile-0 placeholder
  //    records, the right pair hflipped — the engine stores only the 16px-wide LEFT
  //    HALF in bank $55 and mirrors it (the OAM hflip), so we store the half +
  //    mirror:'right' (like the spiked platforms). Source = the bank-$55 draw-read
  //    rectangle; the cel placeholder bbox (dx[-8..24] dy[0..32]) auto-derives the
  //    (-8,0) origin = 32×32. The standard doors look the same in game (verified by
  //    user), so they share the byte-validated locked-door body `$55:6000` — which
  //    strict-matches the sprite-render-v2 settled VRAM (99.6%) at $04E/$131's own
  //    allocated tiles. $001/$093's OWN captures are contested (a neighbour overwrites
  //    their shared dynamic slot's CENTRE — best self-match 74.8/89.5% is the frame
  //    only, no clean static source), so they reuse $55:6000 (correct door frame; the
  //    composited centre detail isn't a static bitmap). The Boss door $012 has its own
  //    body `$55:60C0`. (NB: the sprite-slot-dump 1-1 read is UNRELIABLE for doors —
  //    a door in 1-1 has no valid screen-exit and malfunctions, giving $001=$550021
  //    = Spooky the GHOST, $093=$5400F1 = an archway; never use it.)
  //    PALETTE from the NATURAL level (NOT 1-1): $012 = OBJ row 1 (red); the slot-dump
  //    gave row 0 (green). SPAWN OFFSET (also from the natural level, world-vs-cell):
  //    $012 spawns 1 tile ABOVE its cell (−16 → originY −16); $04E/$131 spawn at their
  //    cell (0). $01F Rotating Doors = rotzoom (no static body). See plan SP8.
  0x001: { delta: 0x556000 - ANCHOR_SNES, width: 16, height: 32, paletteRow: 0, mirror: 'right', originX: -8, originY: -16 }, // Closed door (shares the $55:6000 door body; spawns 1 tile ABOVE its cell like $012/$093 — user-confirmed it rendered 1 tile too low at offset 0)
  0x012: { delta: 0x5560c0 - ANCHOR_SNES, width: 16, height: 32, paletteRow: 1, mirror: 'right', originX: -8, originY: -16 }, // Boss Door ($55:60C0, v2 byte-exact; pal 1 = red; spawns 1 tile ABOVE its cell)
  0x04e: { delta: 0x556000 - ANCHOR_SNES, width: 16, height: 32, paletteRow: 0, mirror: 'right' }, // Locked door ($55:6000, v2 byte-exact)
  0x093: { delta: 0x556000 - ANCHOR_SNES, width: 16, height: 32, paletteRow: 0, mirror: 'right', originX: -8, originY: -16 }, // Door (shares $55:6000 body; spawns 1 tile ABOVE its cell — spawnOffset.y -16)
  0x131: { delta: 0x556000 - ANCHOR_SNES, width: 16, height: 32, paletteRow: 0, mirror: 'right' }, // Locked door (shares $04E, v2 byte-exact)
  // Rotating Doors $01F is a CIRCLE of 4 numbered doors → CUSTOM_SPRITE_RENDERERS (sprite-custom-
  // render.ts: renderRotatingDoors01F), not a single dynbody. Each door = the $55:0020 frame + a
  // file-0x31 number tile.
  0x000: { delta: 0x544060 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 4 }, // Lava log
  0x021: { delta: 0x5520c0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 2 }, // Bucket
  0x073: { delta: 0x548040 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1 }, // Balloon pump (= FXDATA_548000+$40)
  // $07B/$07C (fired Bullet Bills) are NOT rendered — spawned-only projectiles with no valid static
  // gfx (only the vestigial shared $1040 cel); suppressed in resolveSpriteCel (RENDER_SUPPRESSED) and
  // marked invalid in metadata. ($07D, the Green Bullet Bill, is a real-cel + file-$31 sprite.)
  0x085: { delta: 0x54e020 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, originX: -8, originY: -8 }, // Harry Hedgehog ($54:E020 = DATA_01AB0F[1], the GSU rolling-build source; main_hedgehog CODE_01AB13). Format-A (celA), but its object_data cel has no static records → without an explicit origin the 32×32 body fell to (0,0) = TL at the cell anchor, throwing the whole fully-filled body down-right. Centre it on the cell: -8,-8 (32×32 body centred on the 16×16 cell, the dominant sibling convention).
  0x097: { delta: 0x54e0a0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1 }, // POW block
  // Expansion/checkered blocks: one shared 16×16 chunky checker at $54:90B0 (the
  // "centermost 4 tiles" of the sheet cell). The **idle state is 16×16 = one map
  // tile**; the GSU only plots it at 2× transiently when Yoshi interacts, so we render
  // the un-scaled 16×16. The special_chr cel's four upper-page records ($1cc/$1ce/$1ec/
  // $1ee) describe the *scaled* 32×32 footprint, so override the origin to (0,0) to pin
  // the idle block to one tile from the anchor. The three differ only by OBJ palette
  // row (blue = 0, red = 4), confirmed from each capture's OAM attr.
  0x094: { delta: 0x5490b0 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 4, originX: 0, originY: 0 }, // Expanding block ($54:90B0, 16×16 idle)
  0x095: { delta: 0x5490b0 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 0, originX: 0, originY: 0 }, // Blue checkered block (shares 0x094, palette row 0)
  0x096: { delta: 0x5490b0 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 4, originX: 0, originY: 0 }, // Red checkered block (shares 0x094, palette row 4)
  0x09e: { delta: 0x556020 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 2 }, // Chomp Rock (validated 810/810 px)
  // Wild Piranha head — a rot/scale dyntile whose source is read HIGH-nibble (byte-exact
  // vs the identity-scale rendered VRAM, 688/688 px). $54:60C0, 32×32, pal 1. The stem is
  // a separate synth cel (sprite-synth-cel.ts); origin places the head above-left of it.
  // $054 (ceiling) reuses the source vflipped via its $7042 seed. See graphicsassets.md §5.8.
  0x066: { delta: 0x5460c0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1, highNibble: true, originX: -18, originY: -17 }, // Wild Piranha head (red, pal 1)
  0x054: { delta: 0x5460c0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1, highNibble: true, originX: -18, originY: -1 }, // Upside-down Wild Piranha head (head below the stem)
  // Wild Ptooie Piranha — same head source + draw routine (CODE_05A769) as $066, so the
  // same high-nibble $54:60C0 32×32 head + the same stem synth cel. It's the GREEN spitter,
  // so paletteRow 0 (the $7042 seed = 0; capture confirms head pal 0, stem pal 1) — not
  // $066's red pal 1. Stem/head geometry reused from $066 (shared routine = identity layout).
  0x09f: { delta: 0x5460c0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, highNibble: true, originX: -18, originY: -17 }, // Wild Ptooie Piranha head (green, pal 0)
  // Tulip $0A0 — 3 overlapping 16×31 HIGH-nibble columns, z-ordered per its cel (CODE_0CCC22 draws
  //   $55:0061 via FXCODE_088205 and $55:0031 via FXCODE_088C15; the OAM packer lays them as a centre
  //   column + mirrored side columns). The cel's 10 BODY placeholder records sit at dx −8 / 0 / +8 (16px
  //   each), the centre column drawn FIRST = in front:
  //   • $55:0061 (a side leaf) → left column (x0) + hflipped right column (x16), drawn BEHIND
  //   • $55:0031 (the centre flower, two symmetric grooves) → centre column (x8), drawn ON TOP
  // The columns OVERLAP by 8px (matching the cel) so the side leaves connect to the centre — an earlier
  // 8px-adjacent half+mirror left the outer petals disconnected (the draw-order artifact). pal row 1.
  // (Single-source models were wrong: $55:0060 mirror ~92%, flat 32×32 = 100% precision / 57% recall.)
  0x0a0: { delta: 0x550031 - ANCHOR_SNES, width: 32, height: 31, paletteRow: 1, highNibble: true, placeholderTiles: [0xca, 0xcc, 0xce, 0xea, 0xec, 0xee], originX: -8, originY: -8, pieces: [
    { delta: 0x550061 - ANCHOR_SNES, width: 16, height: 31, highNibble: true, x: 0, y: 0 },                // left side leaf (behind)
    { delta: 0x550061 - ANCHOR_SNES, width: 16, height: 31, highNibble: true, x: 16, y: 0, flipH: true },  // right side leaf (mirror, behind)
    { delta: 0x550031 - ANCHOR_SNES, width: 16, height: 31, highNibble: true, x: 8, y: 0 },                // centre flower (front, on top)
  ] }, // Tulip — side leaves $55:0061 (behind) + centre flower $55:0031 (front), 3× 16w columns
  // Muddy Buddy $063 — content-located (user-confirmed) at $54:4000: a 16×16 LOW-nibble body
  // (top-left of a 2×2 grid of frames) drawn at 2× → the 32×32 in-game body. pal row 4. The
  // feet are a separate synth cel (sprite-synth-cel.ts). Handler-drawn (no special_chr), so
  // no placeholders — the body draws at origin (0,0); the synth feet sit below it.
  0x063: { delta: 0x544000 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 4, originX: 0, originY: -3 }, // Muddy Buddy body (16×16 @1×, LOW) — code-confirmed CODE_05E63A #FXDATA_540000+$4000. The Init plots at UNIT scale (`LDA #$0100 : STA $7A36` → R6 multiplier = 1.0), so the rest body is 16×16 — NOT 2× (the 32×32 special_chr placeholder slot is the max-size reservation for its scale-up attack states, not the rest footprint). At 1× the body occupies the CENTRE of that 32×32 slot (slot bbox (-8,-17)..(24,15), centre (8,-1)), so an explicit origin seats the 16×16 body over the feet (cel tile $9e at y9): originX 0 centres it on the feet (x[0,16]); originY -3 drops its bottom onto the feet (feet poke out below). (A bbox-min origin would shove the 16×16 body into the slot's top-left, away from the feet.)
  // Chain Chomp $082 — code-confirmed: its draw (CODE_0593E0) reads DATA_chain_chomp_gfx_ptrs
  // = [$549080,$549090,$5490A0,$549090] (the 4 head frames); the neutral/resting frame is
  // $549090, a 16×16 LOW-nibble ball (black head, white eye + teeth — see the sheet decode).
  // SCALE: NONE. init_chain_chomp seeds the head zoom $7A36 = $0100 = 1.0× (Bank05:2591, same
  // unit-scale literal as Muddy Buddy $063), so the GSU plots the ball at NATIVE 16×16 — the
  // cel's 2×2 (32×32) placeholder grid is the max-zoom RESERVE for the lunge frames (where
  // $7A36 grows toward $01FE ≈ 2× — what misled the old `scale: 2` that rendered the REST head
  // 2× too big, user-reported), NOT the rest footprint (over-allocated-placeholder pattern,
  // cf. $080 lava bubble / $0F3 Woozy Guy). pal row 1.
  // bodyStandalone: the special_chr cel's only static records are 4 chain-link tiles ($bd) the
  // runtime paths along the chain ($0DFD,x/$0E05,x) — not a static rest pose — so we drop the
  // whole cel and render the ball ALONE (its chain "reach" is shown as a behavior-overlay radius
  // instead, SPRITE_BEHAVIOR_MARKS[$082]). origin (0,0) seats the 16×16 ball at the placed cell's
  // top-left = centred on the cell centre (8,8), where the cel's placeholder grid was centred.
  0x082: { delta: 0x549090 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 1, bodyStandalone: true, originX: 0, originY: 0 }, // Chain Chomp head (resting frame $549090, LOW, native 16×16 @1×)
  // ── asm-sourced batch (2026-06-17, SP1c) — every source read straight from the sprite's
  //    draw-setup FXDATA literal (tmp/extract-dynbody-sources.ts), byte addr = literal & ~1,
  //    nibble = literal & 1 (odd ⇒ high), palette from the v2 dynamic-record OAM. Dims: all
  //    32×32 except $0F3 (16×16 @2×) — user-confirmed from the source contact sheet. Origin
  //    derives from each sprite's special_chr placeholder bbox. Render-confirmed per sprite.
  0x01c: { delta: 0x542040 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1, highNibble: true }, // Dr. Freezegood
  // $01D = Dr. Freezegood ON the ski lift. The lift renders as $01D's own Format-B cel (tiles 0/2/4 =
  // pole + platform); the RIDER is Dr. Freezegood drawn on top — confirmed in the asm: the $01D draw
  // (shared GSU routine CODE_048EB5, DATA_048EB1[$78]) plots FXDATA_540000+$2040 = $54:2040, the SAME
  // source $01C uses, at R6=$0100 (1x). So the rider sits at $01C's body position (X centred on the
  // anchor); the lift cel sits below it. This dynbody composites at $01D's tile-0 placeholder (the pole
  // top, which the rider covers) while the platform tiles (2) still render below. originY 8 (= $01C's −8
  // dropped 1 tile, 16px) so Dr. Freezegood stands ON the lift platform (user-confirmed 2026-06-18).
  0x01d: { delta: 0x542040 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1, highNibble: true, originX: -8, originY: 8 }, // Dr. Freezegood (rider) on the ski lift ($01D)
  0x052: { delta: 0x550040 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 4, highNibble: true }, // Balloon
  0x06d: { delta: 0x544040 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 2, highNibble: true }, // Hootie the Blue Fish (CW)
  0x06e: { delta: 0x544040 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 2, highNibble: true }, // Hootie the Blue Fish (CCW)
  0x07f: { delta: 0x544060 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 4 }, // Log seesaw
  0x09d: { delta: 0x5400c0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1, highNibble: true }, // !-switch
  // End-Transformation (Yoshi-shaped) block $098: a 2×2 tile-0 placeholder grid (32×32) whose gfx
  // the GSU plots from FXDATA_548000+$60C0 = $54:E0C0 (handler init_yoshi_block: R12/R13 source,
  // R6=$0100 identity, R9=0 no-rotation, FXCODE_088293). LOW nibble (even offset $60C0) decodes a
  // rounded-corner square with Yoshi's face — exactly the in-game block. (NB: FXDATA_548000 is the
  // ABSOLUTE base $54:8000, so +$60C0 = $54:E0C0, NOT $54:60C0; see docs/graphicsassets.md §5.8.)
  // The v2 capture caught a mid-plot transient (OAM still all tile 0), so it can't VRAM-validate;
  // the source is the asm-cited block texture. Rendered half-opacity (only appears when morphed).
  0x098: { delta: 0x54e0c0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 5 }, // End Transformation Block (rounded square + Yoshi face)
  0x0f3: { delta: 0x546020 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 1 }, // Woozy Guy — a single 16×16 dynamic OBJ in the v2 capture (the body sways at runtime so the gfx is approximate, but the footprint is 16×16, NOT 32×32 — a spurious scale:2 rendered it 2× too big, user-reported 2026-06-17)
  // Spiky mace $101 — a ROTATING 3-segment arm (spiky ball $55:00A0 at the far end + 2 chain
  // segments $55:00C0), NOT one ball. The handler GSU-plots the 3 segments along the rotating arm;
  // statically all 12 placeholder records collapse to (0,0) → one ball. Geometry from a live Mesen
  // dynbody-transform OAM capture (record $59), anchor-relative: ball top-left (-29,-84), chain
  // (-22,-57)+(-14,-30) — a ~47×86 arm pointing up-left (the captured rotation snapshot).
  0x101: { delta: 0x5500a0 - ANCHOR_SNES, width: 47, height: 86, paletteRow: 0, originX: -29, originY: -84, pieces: [
    { delta: 0x5500a0 - ANCHOR_SNES, width: 32, height: 32, x: 0, y: 0 },    // spiky ball (far end)
    { delta: 0x5500c0 - ANCHOR_SNES, width: 32, height: 32, x: 7, y: 27 },   // chain segment (mid)
    { delta: 0x5500c0 - ANCHOR_SNES, width: 32, height: 32, x: 15, y: 54 },  // chain segment (near pivot)
  ] }, // Spiky mace
  // Double-ended spiky mace $102 — a spiky ball ($55:00A0) at BOTH ends of a rotating arm, chain
  // segments ($55:00C0) between, pivot in the middle. Live OAM capture (record $08), anchor-relative:
  // up-arm ball(15,-84)/chain(7,-57)/chain(-1,-30), down-arm chain(-15,14)/chain(-23,41)/ball(-31,68)
  // — a ~78×184 S-arm. (Was sharing $101's single-ball source → both ends collapsed to one ball.)
  0x102: { delta: 0x5500a0 - ANCHOR_SNES, width: 78, height: 184, paletteRow: 0, originX: -31, originY: -84, pieces: [
    { delta: 0x5500a0 - ANCHOR_SNES, width: 32, height: 32, x: 46, y: 0 },    // top spiky ball
    { delta: 0x5500c0 - ANCHOR_SNES, width: 32, height: 32, x: 38, y: 27 },
    { delta: 0x5500c0 - ANCHOR_SNES, width: 32, height: 32, x: 30, y: 54 },
    { delta: 0x5500c0 - ANCHOR_SNES, width: 32, height: 32, x: 16, y: 98 },
    { delta: 0x5500c0 - ANCHOR_SNES, width: 32, height: 32, x: 8, y: 125 },
    { delta: 0x5500a0 - ANCHOR_SNES, width: 32, height: 32, x: 0, y: 152 },   // bottom spiky ball
  ] }, // Spiky mace, double-ended
  // Jean de Fillet — the fish-bone enemy is wholly GSU-drawn ($54:40E0); its special_chr cel is a
  // vestigial 32×32 quad of LOW-page tiles (0x40/0x42/0x60/0x62) that aren't caught by the tile-0/
  // ≥448/dynamic-slot placeholder gate, so they blit as garbage (a blue blob + tan shapes) OVER the
  // body. Tag them as the body's placeholder quad so they're suppressed AND set the body origin to
  // their bbox (-8,-8) — the body fills the cel's intended 32×32 footprint, centred on the anchor
  // (user-flagged: "renders correctly but with extra tiles"). highNibble per the source.
  0x104: { delta: 0x5540e0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, highNibble: true, placeholderTiles: [0x40, 0x42, 0x60, 0x62] }, // Jean de Fillet
  0x11e: { delta: 0x542060 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, highNibble: true }, // Brown Arrow Wheel
  0x11f: { delta: 0x542060 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 2, highNibble: true }, // Blue Arrow Wheel (shares $11E)
  0x135: { delta: 0x554080 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 2 }, // Raven (circling, CW)
  0x136: { delta: 0x554080 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 2 }, // Raven (circling, CCW)
  // Flippers — one flipper bitmap at $55:4060, drawn as a MIRRORED PAIR (CODE_0D9A40 plots
  // the source twice, the 2nd copy flipped). $13C is HORIZONTALLY mirrored (left+right),
  // $144 is VERTICALLY mirrored (top+bottom). In-game both are also rotated by the runtime
  // flip angle ($7A38) + a base orientation ($7A36): $13C rests pointing down; $144's base is
  // ±$80 by sprite-X parity (right vs left) — that rotation is a runtime transform (out of the
  // static editor's scope), so we render the un-rotated mirrored pair.
  // Flipper $13C (down) — a horizontal mirror pair: the $55:4060 paddle + its h-flip, ADJACENT
  // (no gap), 64×32. byte-exact rot0 (the v2 body == the un-rotated source, 100%). Origin (-24,-8)
  // from the v2 camRel. $144 (right/left) is NOT here — it needs a per-parity 90° rotation, so it
  // lives in the custom offramp (sprite-custom-render.ts).
  // placeholderTiles strips cel tile $e1 — a near-empty static (only 2 stray index-b/light-blue
  // pixels) drawn 4× in the cel. In-game the paddle is GSU-rotozoom-drawn so those OAM tiles never
  // appear; here they leaked through as 8 light-blue specks. (The dynamic-OBJ placeholders $180/$182/
  // $1a0/$1a2 are auto-stripped via tile>=$100; only this static junk tile needs an explicit entry.)
  0x13c: { delta: 0x554060 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, mirror: 'right', originX: -24, originY: -8, placeholderTiles: [0xe1] }, // Flipper (down) — horizontal mirror pair
  0x155: { delta: 0x542080 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 2, highNibble: true }, // Fat Goonie — shares $158's goonie BODY source ($54:2081 = $54:2080 HIGH; handler CODE_0E9DFF, FXCODE_088295) + special_chr $9f7e + main. Without it the 10 tile-0 placeholders blit static-VRAM tile 0 = junk "feathers" (user-reported 2026-06-17). The flapping WINGS are a SEPARATE scaled GSU plot (CODE_0E9CFB, frames DATA_0E9CD9/E3) not reproduced by the rigid body — so this renders the goonie body like $158.
  0x158: { delta: 0x542080 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 2, highNibble: true }, // Bowling Goonie
  // NB: $00C Raphael the Raven shares the raven source $554080 but is a giant boss (lowest
  // priority, scaled differently) — NOT wired (the 32×32 raven gfx isn't his form; kept gated).
  // Morph-bubble vehicle icons — the per-vehicle source table (Bank03:9383, FXCODE_088619:
  // `dw FXDATA_550000+$6061,$6071,$7061,$7071,$0000,$70F0` indexed by id-$0AF). Each ALL
  // 100% tile-exact vs its v2 capture VRAM (tmp/morph-validate.ts). Car/Mole/Heli/Train use the
  // odd (HIGH-nibble) addresses; the Submarine is the even (LOW-nibble) one. pal 5 (capture OAM).
  0x0af: { delta: 0x556060 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 5, highNibble: true }, // Car morph bubble
  0x0b0: { delta: 0x556070 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 5, highNibble: true }, // Mole-tank morph bubble
  0x0b1: { delta: 0x557060 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 5, highNibble: true }, // Helicopter morph bubble
  0x0b2: { delta: 0x557070 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 5, highNibble: true }, // Train morph bubble
  0x0b4: { delta: 0x5570f0 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 5 }, // Submarine morph bubble ($55:70F0 LOW)
  // 0x0AD Hint Block / MessageBox: a 16×16 chunky body at $55:7010 (the GSU renders
  // it at 2× = the padded 32×32 capture, so it never strict-matched as a rigid 32×32;
  // the un-scaled 16×16 source is exact). special_chr[0x0AD] = a placeholder cel
  // (tiles 0xc0/0xc1/0xd0/0xd1, the X-block from the common page) — suppressed here.
  0x0ad: { delta: 0x557010 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 1, placeholderTiles: [0xc0, 0xc1, 0xd0, 0xd1] }, // Hint Block (16×16, $55:7010)
  0x120: { delta: 0x554000 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 4 }, // Double-sided arrow lift
  0x122: { delta: 0x5520c0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 2 }, // Bucket with Bandit (shares 0x21)
  0x123: { delta: 0x5520c0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 2 }, // Bucket with coins (shares 0x21)
  // ── low-placeholder / cel-less sprites: need explicit placeholder tiles +/- origin ──
  // Spring balls: cel uses 8×8 placeholders ($c2-$d3, 16×16 footprint) but the body
  // is 32×32 — override origin to the standard 32×32 anchor (-8,-8).
  0x0ee: { delta: 0x550060 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, originX: -8, originY: -8 }, // Eggo-Dill (identity-VRAM crack, 100%/100% all-px @ $55:0060; cel placeholders are tile 0x0, 32×16 footprint → 32×32 body anchored -8,-8)
  // ── read-trace-derived (GSU draw-origin readAddr) + name-vs-render gate. The
  //    1-1 source-offset trace independently reproduced 0x119 byte-exact ($550020),
  //    and its render is a ghost (== Spooky). Cel = four tile-0 16×16 corners → 32×32
  //    body, origin auto-derives to (-8,-8).
  0x119: { delta: 0x550020 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0 }, // Spooky (read-trace $55:0020, ghost render; source-offset trace reproduced it byte-exact)
  // ── source-offset trace (Rev-2) — APPROXIMATION TIER, NOT byte-validated. Per-sprite
  //    bank-$54 source = the GSU draw-origin readAddr; source is LEVEL-INDEPENDENT
  //    (sprite-ID-indexed special_chr $4D:048A, verified cross-level). Gate =
  //    gfxLoaded==1 && compact==1 && (srcSnes&0xFFFF)!=0 (drops R8=0 junk-descriptor
  //    non-bodies + bank-base shared corners like 0x18F→$550000), then render eyeballed.
  //    CAVEAT: unlike the 16 rigid controls (whose source strict-matches their captured
  //    body), ALL of these are NON-RIGID (scaled/animated) — their source does NOT
  //    strict-match the capture, so this is an un-scaled stand-in, not a faithful render.
  //    Kept per explicit user decision (coverage over precision); some may be off — e.g.
  //    0x0D8 was removed after rendering the wrong silhouette. To promote/correct, re-run
  //    the trace with the Rev-4 `rigid` gate (source == settled-rest-frame body, strict).
  //    Dims from oamW/oamH (distinctCols overcounts). Deferred (wide/jumble — dims need
  //    refinement): 0x01C/0x01D (Freezegood multi-sprite region), 0x07F (84w straddle),
  //    0x162 (124w), 0x13C; and 0x158 (compact=0, intrinsically scaled).
  0x003: { delta: 0x552080 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 4 }, // Crate, key — source $55:2080 LOW nibble (the asm GET address, DATA_0D9109[0]=FXDATA_550000+$2080, plotted by CODE_0D9111→FXCODE_088295). Was $55:2081 (off by one): reading 1 byte over made column 31 land on byte $20A0 = the NEXT frame's source ($55:20A0), so 3 stray pixels leaked into the right edge.
  0x040: { delta: 0x54a0a0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 6 }, // Baby Luigi
  // Giant Shy Guys ($043 red / $044 green) — their special_chr cel TILES are a vestigial logo (low
  // common tiles), so bodyStandalone. The 32×32 body is a dyntile sourced from FXDATA_0AAB14[$43/$44]=
  // $800c, which the generic dyntile uploader CODE_03B631 (Bank03) unpacks to $54:0060 (bits 0-10 of
  // $800c = $00c → ($c<<3)=$60, bank R13=$54). LOW nibble. Red/green differ only by the $7042 palette
  // row. Origin (-8,-10): bodyStandalone drops the cel so there's no placeholder bbox to derive from —
  // but the vestigial cel's RECORD POSITIONS are still correct (only the tiles are wrong). Its four
  // 16×16 records sit at (-8,-10),(8,-10),(-8,6),(8,6) = a 2×2 grid spanning x[-8..24] y[-10..22], so
  // the body's top-left is anchor-rel (-8,-10). originX/Y IS that top-left dx/dy (the same convention
  // as the bbox fallback `ox = min(dx)` and the Wild Piranha $066 `originX:-18`), NOT its negation.
  0x043: { delta: 0x540060 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1, bodyStandalone: true, originX: -8, originY: -10 }, // Red Giant Shy Guy
  0x044: { delta: 0x540060 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, bodyStandalone: true, originX: -8, originY: -10 }, // Green Giant Shy Guy
  0x08c: { delta: 0x556080 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 5 }, // Yoshi, at the Goal — OBJ pal 5 = the Yoshi-color row (CGRAM 13, yoshi_palette_ptrs) → green Yoshi w/ red boots; pal 7 was the per-level grayscale row (same gray-skin trap as the Koopas)
  0x0ed: { delta: 0x556040 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1 }, // Flamer Guy (walking/running)
  0x0ec: { delta: 0x556040 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1 }, // Flamer Guy (jumping) — SAME handler as $0ED ($05:BE69/$05:BEB2), so the same body source
  0x0f6: { delta: 0x552000 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1 }, // Huffin' Puffins
  // Blow Hard: the deflated static cel is the default look (the inflated bank-$54 body
  // is the interaction state). staticsOnly drops the dynamic-slot placeholder; the cel
  // also carries a stray right-side tile ($2, a different-frame fragment) — listed in
  // placeholderTiles so staticsOnly drops it too, leaving the clean puffer ($4/$6/$16).
  0x0f8: { delta: 0x552040 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, placeholderTiles: [0x2, 0x4, 0x6, 0x16], originX: -8, originY: -8 }, // Blow Hard — render the full $55:2040 body (the recognizable round inflated form), matching $04C (which is the same body V-flipped via $7042). Was `staticsOnly` = a flat deflated static cel that didn't match $04C; this shows the at-rest identity pose. Shares cel $5d11 + placeholders with $04C.
  0x0fa: { delta: 0x544020 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1 }, // Flower
  // 0x110 Flower: DELIBERATE SUBSTITUTE (user request) — borrows 0x0FA's daisy gfx.
  // 0x110 is actually a GSU-animated flower whose real frame-0 is a closed bud (not
  // statically available); this shows 0x0FA's bloomed daisy as a recognisable stand-in,
  // NOT 0x110's true gfx. placeholderTiles suppress its vestigial ball cel
  // (special_chr[0x110] = a ball, tiles 0,1,0x10,0x11); origin matches 0x0FA's (-8,-8).
  0x110: { delta: 0x544020 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1, placeholderTiles: [0x1, 0x10, 0x11], originX: -8, originY: -8 }, // Flower (substitute → 0x0FA gfx)
  // Chained spike ball $10C — the 32×32 spike ball (placeholder quad) from $55:00A0, PLUS the chain
  // it hangs by: the cel stacks 9× chain links (tile $b, indices 6-14) + 2× pulley-mount blocks (tile
  // $c0, indices 0-1) all at one spot, which the runtime Boo-Guy pulley paths into a hanging chain (a
  // live OAM capture shows them parked off-screen until then). We reconstruct that rest layout via
  // SPECIAL_CHR_RECORD_OVERRIDE (sprite-tile-base.ts): the links rise from the ball at the anchor to
  // the mount, an editor aid for the otherwise runtime-only chain. (The chain gfx are real only in
  // $10C's own spriteset — file $3F, its sole placement record $DC.)
  0x10c: { delta: 0x5500a0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0 }, // Chained spike ball
  0x10e: { delta: 0x552080 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 4 }, // Crate, 6 stars (shares 0x003's $55:2080 LOW source + handler — see the $003 note re: the off-by-one stray-pixel fix)
  // Spiked platform: the sheet at $5540c0 stores only the LEFT HALF; the GSU draws it
  // + a horizontal mirror (like the closed door's left+hflip-right cel). The trace's
  // 57px width was reading left-half + the NEXT sheet object (an arrow icon), not the
  // mirror — hence "right half wrong". width:29 is the half (content cols 3-28, spikes
  // at the 8px pitch); mirror:'right' reflects it to the full ~58px symmetric platform.
  0x15f: { delta: 0x5540c0 - ANCHOR_SNES, width: 29, height: 32, paletteRow: 0, mirror: 'right' }, // Green spiked platform
  0x160: { delta: 0x5540c0 - ANCHOR_SNES, width: 29, height: 32, paletteRow: 1, mirror: 'right' }, // Red spiked platform (shares 0x15F)
  0x180: { delta: 0x544060 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0 }, // Spinning Log (shares lava-log 0x000 source)
  0x06c: { delta: 0x5540e0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, placeholderTiles: [0xc2, 0xc3, 0xd2, 0xd3], originX: -8, originY: -8 }, // Large spring ball
  0x148: { delta: 0x5540e0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, placeholderTiles: [0xc2, 0xc3, 0xd2, 0xd3], originX: -8, originY: -8 }, // Fall-through spring ball (shares 0x6c)
  0x177: { delta: 0x5540e0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, placeholderTiles: [0xc0, 0xc2, 0xe0, 0xe2], originX: -8, originY: -8 }, // Zeppelin + large spring ball (shares 0x6c). placeholderTiles = the cel's spring-ball quad RECORD tiles (was [c2,c3,d2,d3] = sub-tiles of one record, leaving c0/e0/e2 to blit static garbage = extra sprites)
  0x17e: { delta: 0x552080 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 4, placeholderTiles: [0xc0, 0xc2, 0xe0, 0xe2] }, // Zeppelin + crate w/ 6 stars (cel origin -8,-8 is correct; keeps the $bc/$a8 balloon+star statics)
  // Super star: cel-less → uses the TOP-LEFT fallback origin (0,0), which the v2 OAM
  // confirms (its dynamic-tile record is at dx=dy=0). No explicit origin needed.
  0x088: { delta: 0x5560f0 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 2 }, // Super star (top-left fallback, v2-verified)
  // $059 stationary super star: an item that BECOMES sprite $088 after a state change,
  // so it renders as $088 — same body/palette (also top-left via the fallback).
  0x059: { delta: 0x5560f0 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 2 }, // → $088 Super star (post-state-change appearance)
  // ── rotzoom-identity sprites (spawn-trace derived). The body offset is the GSU's
  //    identity-frame (R8=R9=$0100, R10=R11=$0000 = draw-start) snapshot readAddr,
  //    cross-checked against chomp $09E whose draw-start readAddr == its byte-validated
  //    top-left. Whole-sprite flip ($7042) applied to the body at runtime.
  //    `$04C` is byte-pinned (its identity read range was exactly the 32×32 grid).
  0x04c: { delta: 0x552040 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, placeholderTiles: [0x2, 0x4, 0x6, 0x16], originX: -8, originY: -8 }, // Upside-down Blow Hard ($55:2040, identity @ spawn f635, V-flip via $7042)
  // ── Rotozoom sprites with a 4-placeholder 32×32 cel (body auto-positions at the (-8,-8)..(8,8)
  //    placeholder bbox, like the spike/spring sprites above; no explicit origin needed). Source =
  //    the R12/R13 literal in each sprite's own draw routine (the shared FXCODE plotter rotozooms
  //    it at runtime — the editor shows the un-rotated frame). Dims/palette from the v2 OAM.
  0x080: { delta: 0x5480b0 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 1, bodyStandalone: true, originX: 0, originY: 0 }, // Straight Lava Bubble (FXDATA_548000+$00B0 = $54:80B0 LOW, FXCODE_0882FA). 16×16 — the bubble is ONE tile; a 32×32 read pulls 3 neighbour quadrants. Its special_chr cel is a 2×2 (32×32) placeholder grid, so the body renders STANDALONE (bodyStandalone) at the cell top-left (originX/Y 0) — else the selection outline was 2× too big and centred.
  0x081: { delta: 0x5480b0 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 1, bodyStandalone: true, originX: 0, originY: 0 }, // Following Lava Bubble (shares $080's main_lava_bubble draw + $54:80B0 body; same 2×2/32×32 placeholder cel → bodyStandalone at the cell top-left, like $080, else the body is 2× too big + centred)
  0x156: { delta: 0x556060 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0 }, // Cactus Jack ($55:6060 LOW)
  0x18f: { delta: 0x550000 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, highNibble: true }, // Spiral Platform ($55:0000 HIGH, source offset $0001)
  // ── SP2 batch (asm-literal source + extended-OAM dims/origin). No placeholder cel → bodyOnly
  //    + explicit origin (the chomp $082 pattern). Rot/scale sprites: render the un-scaled base.
  0x0d8: { delta: 0x5480c0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1, highNibble: true, bodyOnly: true, originX: -8, originY: -9 }, // Chomp warning sign (init_chomp_signboard FXDATA_548000+$00C1 = $54:80C0 HIGH; NOT $54:00C0, which is the $09D red switch via FXDATA_540000+$00C1). OAM 32×32 @ (-8,-9)
  0x0dc: { delta: 0x54e080 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 3, scale: 2, bodyOnly: true, originX: -24, originY: -25 }, // Snowball ($54:E080 LOW, 32×32 source rendered ×2 = the 64×64 rolling size; OAM @ (-24,-25))
  // ── SP2 best-effort batch (asm sources, corrected FXDATA arithmetic). These are rot/scale GSU
  //    sprites with NO byte-exact rigid source — we render the un-scaled main body (the editor's
  //    frame-0/unscaled scope). Origins are best-effort (OAM-derived for the un-spun; centred for
  //    spun/wide); multi-part sprites render their MAIN body (secondary parts/projectiles omitted).
  //    All FXCODE_088205 rotozoom unless noted. Sources verified per the FXDATA_548000=$54:8000 rule.
  0x199: { delta: 0x552040 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1, highNibble: true, bodyOnly: true, originX: -8, originY: -16 }, // Dizzy Dandy (main_dizzy_dandy: DATA_0C88F7[$18,x]; sleep/state-0 = $55:2041 HIGH; FXCODE_088205 spins it — un-spun base). originX −8 (not −16): the 32×32 GSU body's OAM-descriptor centring sits a half-tile right of the cell anchor (no init position snap; user-confirmed)
  0x08b: { delta: 0x54c040 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, highNibble: true, bodyOnly: true, originX: -8, originY: -6 }, // Mock-Up / inflating balloon (CODE_03EC0B: $54:C041 HIGH; FXCODE_088205 opacity-scaled by $701901). Palette by cell-X parity → SPRITE_PARITY_PALETTE[$08B] = [0,1,0,1]
  0x0e7: { delta: 0x5480e0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, highNibble: true, originX: -8, originY: -16 }, // Burt / small Burt (CODE_05B035 draw, Burt-only callers: $54:80E1 HIGH; FXCODE_088295 rotozoom by $7A36 angle — un-spun base). The special_chr cel (6 records) IS Burt's real OAM, NOT vestigial — a live BizHawk OAM+VRAM trace (lvl 0x03) confirmed it byte-for-byte: records 2-5 = the 32×32 GSU body (dynamic tiles $1C8 quad), records 0/1 = the two 8×8 FEET, which are a STATIC spriteset tile 0x9e (a little shoe), NOT a bank-$54 source. So: keep the cel (no bodyStandalone), tag the 4 body placeholders for this body, and pin the 2 feet to tile 0x9e via SPECIAL_CHR_RECORD_OVERRIDE (sprite-tile-base.ts). Body footprint x[-8..24] y[-16..16] → origin (-8,-16) (body-TL rel anchor). $7042 seed pal 0.
  // Monkey Swing — the source $54:C060 (32×32 LOW) is a MONKEY, and the swing is a CHAIN of FOUR of
  // them (CODE_0597A9's OAM loop CODE_05984A runs $0A=4 times, one 32×32 link each). REST POSE (asm-
  // derived): FXCODE_0B950A advances each link's angle by R9 = FMULT($5500, $7A38-$7A36); at rest
  // $7A38==$7A36 ($8000) so R9=0 and all 4 links share ONE angle (θ from $7A37=$80 ⇒ 180°, sin=0 ⇒
  // horizontal) — only the per-link scalar R6 steps $F6,$E2,$CE,$BA (signed −10,−30,−50,−70, step
  // $14). So the rest chain is a STRAIGHT HORIZONTAL line, links 20px ($14) apart (NOT the mid-swing
  // arc). The CODE_059A9F rotozoom plots the monkey at 180° (rest angle $80) ONCE into the dyntile,
  // and CODE_05984A copies that already-rotated tile to every link — so ALL FOUR links are 180°
  // (flipH+flipV), not just one. LOW nibble, pal 0.
  0x08f: { delta: 0x54c060 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, bodyOnly: true, originX: 0, originY: -8, pieces: [
    { delta: 0x54c060 - ANCHOR_SNES, width: 32, height: 32, x: 0,  y: 0, flipH: true, flipV: true }, // link 0
    { delta: 0x54c060 - ANCHOR_SNES, width: 32, height: 32, x: 20, y: 0, flipH: true, flipV: true }, // link 1
    { delta: 0x54c060 - ANCHOR_SNES, width: 32, height: 32, x: 40, y: 0, flipH: true, flipV: true }, // link 2
    { delta: 0x54c060 - ANCHOR_SNES, width: 32, height: 32, x: 60, y: 0, flipH: true, flipV: true }, // link 3
  ] }, // Monkey Swing (4-link straight horizontal rest chain, all 180°; FXCODE_0B950A R9=0)
  // Incoming Chomp $0A6 + Falling variant $0A8 (shared main_incoming_chomp) — a GSU SCALE body, NOT a
  // cel: CODE_0E84BA loads R12 = DATA_0E844E[$77] = FXDATA_548000+$4000 ($54:C000 frame 0; +$20/+$40
  // are the mouth-open anim frames, each a 32-wide frame laid side-by-side in the sheet), R13 bank $54,
  // R6=$7A36 (the fly-in GROW scale). The full chomp head is 32×32 (two eyes + toothy grin); a 16×16
  // read was just its top-left quadrant. We render the un-scaled 32×32 frame 0 (editor identity scope),
  // LOW nibble (R12 even), pal 6. The special_chr cel is a vestigial char-id 8×8 (tile 0x5) → bodyOnly
  // drops it. Plotter FXCODE_088A0F (rotozoom-family scale plotter; same nibble/stride rules).
  0x0a6: { delta: 0x54c000 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 6, bodyOnly: true }, // Incoming Chomp
  0x0a8: { delta: 0x54c000 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 6, bodyOnly: true }, // Falling Incoming Chomp (shares $0A6's main + source)
  // Group of Incoming Chomps $0A7 — a SPAWNER (main_incoming_chomp_flock → CODE_spawn_sprite; it never
  // draws the chomp gfx itself, so the source is its CHILD $0A6's, not loaded by $0A7's own handler →
  // BIND_ALLOWLIST in validate-dynbody-asm). Render the child's body as a representative icon.
  0x0a7: { delta: 0x54c000 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 6, bodyOnly: true }, // Group of Incoming Chomps (representative)
  // Tap-Tap — a static (no rotation/scale; dynbody-transform angle=0 scale=256) 3-source body the
  // single-$55:4081 decode truncated to the face only. The full ~66×74 body, per the trace's rep-frame
  // OAM (chrTiles→dyntile attribution): a 64×32 spiky SHELL ($55:00C1 HIGH) drawn direct on top +
  // 180°-mirrored (flipH+flipV) below; the FACE ($55:4081 HIGH) upper-centre; two identical FEET
  // ($55:60A1 HIGH, 32×32) side by side. (The old comment's "$55:00C1 odd-frame-only" was wrong — it's
  // the shell, drawn every frame by FXCODE_08881C alongside the two FXCODE_088205 rotozoom plots.)
  // MISSING: the RED NOSE. It is NOT a GSU body part — it's $03C's `special_chr` cel rec[0] (dx=dy=0,
  // tile 0x14E, 16×16), a STATIC spriteset tile drawn by the engine's normal OAM path (CODE_03AF23),
  // not the GSU. `bodyOnly` drops it, AND `isPlaceholder` would eat it (tile 334 ≥ 256). Its asm-correct
  // VRAM tile is 0x10E = spriteset slot 0 = file 0x4D (the boss sheet) in SpriteTileset 0x25; the cel's
  // raw 0x14E resolves to slot 2 = file 0x48 = a Boo because DATA_0AA716[$03C]=0 suppresses the
  // level-aware slot-shift (notes-sprite-render.md §5 GOTCHA). Confirmed vs the $03C capture VRAM+OAM.
  0x03c: { delta: 0x554080 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 6, highNibble: true, bodyOnly: true, originX: -33, originY: -37, pieces: [
    { delta: 0x5500c0 - ANCHOR_SNES, width: 64, height: 32, highNibble: true, x: 1, y: 0 },                         // spiky shell (top half)
    { delta: 0x5500c0 - ANCHOR_SNES, width: 64, height: 32, highNibble: true, x: 1, y: 32, flipH: true, flipV: true }, // shell bottom = 180° mirror
    { delta: 0x5560a0 - ANCHOR_SNES, width: 32, height: 32, highNibble: true, x: 0, y: 42 },                        // left foot
    { delta: 0x5560a0 - ANCHOR_SNES, width: 32, height: 32, highNibble: true, x: 34, y: 42 },                       // right foot (identical copy)
    { delta: 0x554080 - ANCHOR_SNES, width: 32, height: 32, highNibble: true, x: 11, y: 8 },                        // face (front, upper-centre)
  ] }, // Tap-Tap (DATA_0FA6D3 idx0 $55:4081 HIGH via CODE_0FA71D + shell $55:00C1 via CODE_0FA75B + feet $55:60A1)
  // Bullet Bill Blasters $078/$079/$07A — ONE draw routine (CODE_05D32B → FXCODE_08D6EB): the 16×16
  // ball source `DATA_05D325[$77]` plotted at ~2× (R6=$7A36 reaches ≈$01FC at draw; the un-zoomed 16×16
  // top-left of each sheet IS the ball — reading 32×32 would pull in adjacent frames). Per-color: $77
  // (source) from init, palette from DATA_05D1D1 ($7042 = $0022/$0024/$0020 → rows 1/2/0):
  //   $078 Red / $07A Green → $77=0 → $54:8010 ; $079 Yellow → $77=4 → $54:B000 (its special init path).
  // 16×16 LOW, drawn at the SPAWN scale (asm init $7A36 = $0100 = 1×). $7A36 ramps to ~2× by the settled
  // capture, but per user the editor shows the 1× spawn pose (flat 16×16, no rotozoom). The ball is the
  // shooter's OWN body — drawn every Main frame by CODE_05D32B (R12=DATA_05D325[$77], $77 set once at init,
  // never animates), gated only by on-screen visibility ($7723); the fired Bullet Bill is a SEPARATE sprite
  // ($07B/$07C/$07D) with a distinct source ($54:8020), not this body. Origin (8,-1) centres the 16×16 ball
  // where the 2× capture's ball sat (the GSU plots around a fixed centre, scale-independent).
  // (No bodyOnly: a SYNTHESIZED_CELS entry supplies the body placeholder + the cannon-muzzle tile $2 at
  //  the TRACE-confirmed offset — the special_chr's own static block is a vestigial char-id=sprite-id frame
  //  that mis-positions the muzzle, so we replace the cel rather than strip-to-body.)
  // Blaster MUZZLE = the dynbody (the static spriteset tile-0 = the cannon BODY, see sprite-synth-cel).
  // All three use $079's $54:B000 muzzle graphic: the asm streams $54:8010 for $078/$07A ($77=0) but
  // $54:B000 ($079's $77=4) is the accurate shared cannon-mouth (user-confirmed 2026-06-18 the red/green
  // muzzle should match yellow's). Origin (0,−9): half a tile up-left of the old (8,−1) (user 2026-06-18).
  0x078: { delta: 0x54b000 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 1, originX: 0, originY: -8 }, // Red Bullet Bill shooter muzzle (pal 1)
  0x07a: { delta: 0x54b000 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 0, originX: 0, originY: -8 }, // Green Bullet Bill shooter muzzle (pal 0)
  0x079: { delta: 0x54b000 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 2, originX: 0, originY: -8 } // Yellow Bullet Bill shooter muzzle ($54:B000 LOW, pal 2; $77=4) — the reference graphic
  // NB: 0x066/0x054 Wild Piranha NOT added. The identity snapshot readAddr $54:60C0 is
  // WRONG — it renders the Yoshi car (confirmed in-level), not the red piranha. Its
  // identity-frame reads span the whole $54 page (can't isolate the 32×32) and the
  // sprite-render capture is too scaled to crack (28%), so the red source isn't
  // pinnable from current data → needs a clean identity-frame VRAM dump (snapshot ON
  // frames 628-640 where R8=R9=$0100). See research/plan-editor-remaining.md SP1.
};

/** Sprite nums whose bank-$54 glyph source is **byte-validated** — its stored
 *  bytes strict-match the GSU's rasterized output, so the glyph is safe to EDIT.
 *  The other DYNAMIC_BODY_SOURCES entries are approximation-tier (un-scaled
 *  stand-ins whose exact source isn't pinned — see the table comments), so the
 *  dynamic-sprite glyph editor (`sprite-glyph.ts`) offers ONLY these. Several
 *  share a source (0x021↔0x122/0x123, 0x094↔0x095/0x096) — edits propagate. */
export const RIGID_GLYPH_SPRITES: readonly number[] = [
  0x000, 0x021, 0x073, 0x085, 0x094, 0x095, 0x096, 0x097,
  0x09e, 0x0ad, 0x0b4, 0x0ee, 0x119, 0x120, 0x122, 0x123
];

/** Decoded chunky body bitmap (one 4bpp index per pixel, row-major). */
export interface DecodedDynamicBody {
  /** `width * height` palette indices (0..15); index 0 = transparent. */
  indices: Uint8Array;
  width: number;
  height: number;
}

/**
 * Read a rigid dynamic-body sprite's chunky bitmap from ROM, or `null` if the
 * sprite has no registered source (→ it renders stem-only). The source is
 * resolved as `pc(FXDATA_548000) + delta` (version-robust); each output index is
 * the source byte's low nibble (or HIGH nibble when `highNibble` is set — the
 * rot/scale plotter's texture format, e.g. the Wild Piranha head). Pure-static: no
 * emulator, no captured pixels.
 */
export function decodeDynamicBody(
  rom: Uint8Array,
  symbols: SymbolMap,
  spriteNum: number
): DecodedDynamicBody | null {
  const src = DYNAMIC_BODY_SOURCES[spriteNum];
  if (!src) return null;
  const anchorPC = symbols.tryPc(DYNAMIC_GFX_ANCHOR_SYMBOL);
  if (anchorPC === undefined) return null;
  const srcPC = anchorPC + src.delta;
  // Optional horizontal flip of the finished body (the GSU's R4 facing flip; see flipH).
  const fin = (indices: Uint8Array, w: number, h: number): DecodedDynamicBody => {
    if (!src.flipH) return { indices, width: w, height: h };
    const f = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = indices[y * w + (w - 1 - x)]!;
    return { indices: f, width: w, height: h };
  };
  // Multi-piece composite: tile each distinct source rect into one bitmap (the tulip $0A0 body+lip,
  // morph-bubble corners, etc). Each piece reads its own nibble and may be flipped; index 0 = skip.
  if (src.pieces && src.pieces.length) {
    let cw = 0, ch = 0;
    for (const p of src.pieces) { cw = Math.max(cw, p.x + p.width); ch = Math.max(ch, p.y + p.height); }
    const out = new Uint8Array(cw * ch);
    for (const p of src.pieces) {
      const pPC = anchorPC + p.delta;
      for (let y = 0; y < p.height; y++) {
        const rowPC = pPC + y * BITMAP_ROW_STRIDE;
        for (let x = 0; x < p.width; x++) {
          const b = rom[rowPC + x]!;
          const v = (p.highNibble ? (b >> 4) : b) & 0x0f;
          if (v === 0) continue;
          const px = p.x + (p.flipH ? (p.width - 1 - x) : x);
          const py = p.y + (p.flipV ? (p.height - 1 - y) : y);
          out[py * cw + px] = v;
        }
      }
    }
    // The composite may be only the LEFT half of a symmetric body the GSU mirrors via an
    // OAM-hflipped copy (the tulip $0A0: 16-wide half → 32-wide flower). mirror:'right' reflects it.
    if (src.mirror === 'right') {
      const fw = cw * 2, m = new Uint8Array(fw * ch);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const v = out[y * cw + x]!; m[y * fw + x] = v; m[y * fw + fw - 1 - x] = v; }
      return fin(m, fw, ch);
    }
    return fin(out, cw, ch);
  }
  // Rotozoom-transformed bodies (rotation / fractional scale): rasterize via the calibrated rotozoom
  // (the rigid flat read below can't reproduce a runtime transform). width/height = source rect.
  if (src.rotozoom) {
    const r = rotozoomDecode(rom, symbols, srcPC, src.width, src.height, src.highNibble ?? false, src.rotozoom);
    return fin(r.indices, r.width, r.height);
  }
  const lastByte = srcPC + (src.height - 1) * BITMAP_ROW_STRIDE + src.width;
  if (srcPC < 0 || lastByte > rom.length) return null;
  const raw = new Uint8Array(src.width * src.height);
  const nib = (b: number): number => (src.highNibble ? (b >> 4) : b) & 0x0f;
  for (let y = 0; y < src.height; y++) {
    const rowPC = srcPC + y * BITMAP_ROW_STRIDE;
    const rowOut = y * src.width;
    for (let x = 0; x < src.width; x++) raw[rowOut + x] = nib(rom[rowPC + x]!);
  }
  // Mirror: append the horizontal flip of the source → a symmetric body whose right
  // half is the mirror of the stored left half (e.g. spiked platforms, like the door).
  let bmp = raw, bw = src.width, bh = src.height;
  if (src.mirror === 'right') {
    const fw = src.width * 2;
    const mirrored = new Uint8Array(fw * src.height);
    for (let y = 0; y < src.height; y++) {
      const row = y * src.width, out = y * fw;
      for (let x = 0; x < src.width; x++) {
        const v = raw[row + x]!;
        mirrored[out + x] = v;
        mirrored[out + fw - 1 - x] = v;
      }
    }
    bmp = mirrored; bw = fw;
  } else if (src.mirror === 'down') {
    const fh = src.height * 2;
    const mirrored = new Uint8Array(src.width * fh);
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const v = raw[y * src.width + x]!;
        mirrored[y * src.width + x] = v;
        mirrored[(fh - 1 - y) * src.width + x] = v;
      }
    }
    bmp = mirrored; bh = fh;
  }
  // Center underlay: a second source drawn behind the (now full-width) body, horizontally
  // centered — only where the body is transparent (the seam/notch a pure mirror leaves).
  if (src.centerUnder !== undefined) {
    const cPC = anchorPC + src.centerUnder;
    const cx0 = ((bw - src.width) / 2) | 0;
    for (let y = 0; y < src.height && y < bh; y++) {
      const rowPC = cPC + y * BITMAP_ROW_STRIDE, rowOut = y * bw;
      for (let x = 0; x < src.width; x++) {
        const dst = rowOut + cx0 + x;
        if (bmp[dst] === 0) { const cv = nib(rom[rowPC + x]!); if (cv !== 0) bmp[dst] = cv; }
      }
    }
  }
  const scale = src.scale ?? 1;
  if (scale <= 1) return fin(bmp, bw, bh);
  // Nearest-neighbour upscale the chunky source by `scale` (the GSU's plot zoom).
  const w = bw * scale, h = bh * scale;
  const indices = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = (y / scale) | 0;
    for (let x = 0; x < w; x++) indices[y * w + x] = bmp[sy * bw + ((x / scale) | 0)]!;
  }
  return fin(indices, w, h);
}
