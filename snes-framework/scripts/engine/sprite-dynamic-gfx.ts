// Dynamic-body sprite gfx — the chunky bank-$54 bitmap source for the *rigid*
// (identity-transform) dynamic-OBJ sprites.
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
//     ourselves, no GSU needed. This module covers exactly these.
//   - **Stretchy / rotzoom** (Wild Piranha, bosses, …): the body is plotted
//     through a non-identity matrix, so it's not a verbatim copy. Those are out
//     of scope (stem-only / vector-glyph tier) — see the plan's "Scope".
//
// # The source format (reverse-engineered offline; see research/notes-sprite-render.md)
//
// Bank `$54+` holds a bitmap *sheet*; each sprite's body is a sub-rectangle.
//   - **Chunky**, 1 byte per pixel; the **low nibble** is the 4bpp palette index
//     (the palette *row* comes from the sprite OAM attr, like the cel tiles).
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

/** SNES base the per-sprite deltas are measured from (the
 *  `DATA_gfx_bank54_part2` symbol = bank `$54:8000`). */
const ANCHOR_SNES = 0x548000;
/** The symbol the runtime resolves to anchor every delta (drift-proof).
 *  Friendly SuperFX-side label; the main `.sym` aliases the same address as
 *  `FXDATA_548000`, and the merged map resolves both to the same PC. */
export const DYNAMIC_GFX_ANCHOR_SYMBOL = 'DATA_gfx_bank54_part2';
/** Source bitmap row stride (the sheet is 256 px / bytes wide). */
const BITMAP_ROW_STRIDE = 0x100;

/** One rigid dynamic-body source: where its chunky bitmap lives, how big it is,
 *  and the OBJ palette row it draws through. */
export interface DynamicBodySource {
  /** Signed byte delta from `FXDATA_548000` to the bitmap's top-left pixel. */
  delta: number;
  /** Bitmap width in pixels. */
  width: number;
  /** Bitmap height in pixels. */
  height: number;
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
  /** The INVERSE of `bodyOnly`: drop the dynamic-slot placeholder record(s) and render
   *  the cel's STATIC frame, with NO dynamic body. For sprites whose recognisable
   *  default visual is the static `special_chr` cel (a VRAM asset), not the bank-$54
   *  body — e.g. 0x0F8 Blow Hard's deflated puffer (the inflated bank-$54 body is the
   *  interaction state). Kept in this table (rather than dropped) so the
   *  placeholder-suppression decision lives with the other body metadata. */
  staticsOnly?: boolean;
  /** Mirror the source to form a symmetric body: output is `[source | hflip(source)]`,
   *  width doubled. For sprites the GSU draws as two mirrored halves where only the
   *  LEFT half is stored in the sheet — e.g. 0x15F/0x160 spiked platforms (same idea
   *  as the closed door's left+hflip-right cel). `width` is the half-width. */
  mirror?: 'right';
}

/**
 * Rigid dynamic-body sprites → their bank-`$54` chunky bitmap source. Keyed by
 * 9-bit sprite num. Each `delta` is `srcSnes - 0x548000` (see file header).
 *
 * Provenance: recovered offline from yi-shiny `sprite-render` VRAM captures and
 * **validated byte-exact** (all pixels, not just nonzero) against the rasterized
 * output — see `tmp/revalidate.ts`. Sprites whose body is transformed (rotzoom)
 * or whose offline match was only partial were dropped. Several entries share an
 * offset (gfx reuse): the three buckets, the spring-ball family.
 *
 * **Placement caveat.** The body is positioned over the cel's dynamic-region
 * records (`tile === 0` or `tile >= 256`). Entries marked "placement pending"
 * have a *correct bitmap* but their cel places the body via LOW placeholder tiles
 * (`$c0-$d3`) the current `resolveSpriteCel` filter doesn't recognise — so the
 * body decodes but isn't drawn yet (a placement source is the remaining work, see
 * research/plan-editor-remaining.md SP2). They're kept here so the gfx work isn't lost.
 */
export const DYNAMIC_BODY_SOURCES: Readonly<Record<number, DynamicBodySource>> = {
  0x000: { delta: 0x544060 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 4 }, // Lava log
  0x021: { delta: 0x5520c0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 2 }, // Bucket
  0x073: { delta: 0x548040 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1 }, // Balloon pump (= FXDATA_548000+$40)
  0x085: { delta: 0x54e020 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0 }, // Harry Hedgehog
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
  0x0b4: { delta: 0x5570f0 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 5 }, // Submarine morph bubble
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
  0x003: { delta: 0x552081 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 4 }, // Crate, key
  0x040: { delta: 0x54a0a0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 6 }, // Baby Luigi
  0x08c: { delta: 0x556080 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 7 }, // Yoshi, at the Goal
  0x0ed: { delta: 0x556040 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1 }, // Flamer Guy
  0x0f6: { delta: 0x552000 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1 }, // Huffin' Puffins
  // Blow Hard: the deflated static cel is the default look (the inflated bank-$54 body
  // is the interaction state). staticsOnly drops the dynamic-slot placeholder; the cel
  // also carries a stray right-side tile ($2, a different-frame fragment) — listed in
  // placeholderTiles so staticsOnly drops it too, leaving the clean puffer ($4/$6/$16).
  0x0f8: { delta: 0x552040 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, staticsOnly: true, placeholderTiles: [0x2] }, // Blow Hard (deflated static frame)
  0x0fa: { delta: 0x544020 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1 }, // Flower
  // 0x110 Flower: DELIBERATE SUBSTITUTE (user request) — borrows 0x0FA's daisy gfx.
  // 0x110 is actually a GSU-animated flower whose real frame-0 is a closed bud (not
  // statically available); this shows 0x0FA's bloomed daisy as a recognisable stand-in,
  // NOT 0x110's true gfx. placeholderTiles suppress its vestigial ball cel
  // (special_chr[0x110] = a ball, tiles 0,1,0x10,0x11); origin matches 0x0FA's (-8,-8).
  0x110: { delta: 0x544020 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 1, placeholderTiles: [0x1, 0x10, 0x11], originX: -8, originY: -8 }, // Flower (substitute → 0x0FA gfx)
  0x10c: { delta: 0x5500a0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0 }, // Chained spike ball
  0x10e: { delta: 0x552081 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 4 }, // Crate, 6 stars (shares 0x003)
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
  0x177: { delta: 0x5540e0 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, placeholderTiles: [0xc2, 0xc3, 0xd2, 0xd3], originX: -8, originY: -8 }, // Zeppelin + large spring ball (shares 0x6c)
  0x17e: { delta: 0x552080 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 4, placeholderTiles: [0xc0, 0xc2, 0xe0, 0xe2] }, // Zeppelin + crate w/ 6 stars (cel origin -8,-8 is correct; keeps the $bc/$a8 balloon+star statics)
  0x088: { delta: 0x5560f0 - ANCHOR_SNES, width: 16, height: 16, paletteRow: 2 }, // Super star (cel-less → centred fallback origin)
  // ── rotzoom-identity sprites (spawn-trace derived). The body offset is the GSU's
  //    identity-frame (R8=R9=$0100, R10=R11=$0000 = draw-start) snapshot readAddr,
  //    cross-checked against chomp $09E whose draw-start readAddr == its byte-validated
  //    top-left. Whole-sprite flip ($7042) applied to the body at runtime.
  //    `$04C` is byte-pinned (its identity read range was exactly the 32×32 grid).
  0x04c: { delta: 0x552040 - ANCHOR_SNES, width: 32, height: 32, paletteRow: 0, placeholderTiles: [0x2, 0x4, 0x6, 0x16], originX: -8, originY: -8 } // Upside-down Blow Hard ($55:2040, identity @ spawn f635, V-flip via $7042)
  // NB: 0x066/0x054 Wild Piranha NOT added. The identity snapshot readAddr $54:60C0 is
  // WRONG — it renders the Yoshi car (confirmed in-level), not the red piranha. Its
  // identity-frame reads span the whole $54 page (can't isolate the 32×32) and the
  // sprite-render capture is too scaled to crack (28%), so the red source isn't
  // pinnable from current data → needs a clean identity-frame VRAM dump (snapshot ON
  // frames 628-640 where R8=R9=$0100). See research/plan-editor-remaining.md SP1.
};

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
 * the source byte's low nibble. Pure-static: no emulator, no captured pixels.
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
  const lastByte = srcPC + (src.height - 1) * BITMAP_ROW_STRIDE + src.width;
  if (srcPC < 0 || lastByte > rom.length) return null;
  const raw = new Uint8Array(src.width * src.height);
  for (let y = 0; y < src.height; y++) {
    const rowPC = srcPC + y * BITMAP_ROW_STRIDE;
    const rowOut = y * src.width;
    for (let x = 0; x < src.width; x++) raw[rowOut + x] = rom[rowPC + x]! & 0x0f;
  }
  // Mirror: append the horizontal flip of the source → a symmetric body whose right
  // half is the mirror of the stored left half (e.g. spiked platforms, like the door).
  let bmp = raw, bw = src.width;
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
  }
  const scale = src.scale ?? 1;
  if (scale <= 1) return { indices: bmp, width: bw, height: src.height };
  // Nearest-neighbour upscale the chunky source by `scale` (the GSU's plot zoom).
  const w = bw * scale, h = src.height * scale;
  const indices = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = (y / scale) | 0;
    for (let x = 0; x < w; x++) indices[y * w + x] = bmp[sy * bw + ((x / scale) | 0)]!;
  }
  return { indices, width: w, height: h };
}
