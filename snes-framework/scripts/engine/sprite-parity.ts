// Shared placement-parity render facts — the SINGLE SOURCE for the cart's
// "where you place a sprite (cell X/Y parity) → how it looks" mapping. The parity INPUT is
// editable level data (the sprite's cell), but the MAPPING is asm-fixed, so it lives engine-side
// and is imported by BOTH the engine (cel resolution + cel generation) and the renderer (the
// parity-variant labels in sprite-parity-variants.ts, the orbit overlay in sprite-behavior-
// extents.ts). Browser-safe (pure constants/helpers, no node APIs) — re-exported via the
// `snes-framework/sprite-parity` package entry.

/** The 4-way placement-parity index used everywhere: `2·(yCell&1) + (xCell&1)` → 0..3. */
export const parityIndex = (xCell: number, yCell: number): number => 2 * (yCell & 1) + (xCell & 1);

/** Four-rotating-platform pinwheels ($055/$056/$064/$15E): a hub with 4 platforms orbiting
 *  90° apart (Bank04 main_four_rotating_platforms → FXCODE_0B85D0 sin/cos). Geometry recovered
 *  from the v2 OAM, rendered at the 4 canonical diagonals. Radii are DATA_04C42F ($28/$18). */
export const PINWHEEL = {
  /** Orbit centre relative to the placed cell (sprite pos +8, +7 tile offset). */
  hubX: 8,
  hubY: 7,
  /** Wide orbit radius, px (DATA_04C42F[0] = $28). */
  radiusWide: 40,
  /** Tight orbit radius, px (DATA_04C42F[1] = $18). */
  radiusTight: 24
} as const;
// $064 alone picks its radius from Y-cell parity (`$7182 & $0010`): cellY EVEN → wide, cellY ODD
// → tight. That rule is encoded once on each side — engine: SYNTHESIZED_CELS = wide (even default)
// vs SYNTHESIZED_CEL_PARITY_Y = tight (odd); renderer: orbitWideIndex 0 in sprite-parity-variants.

/** Sprites that pick their OBJ **palette row** from spawn-cell parity (the Init reads pixel
 *  bit 4 = the 16px cell's LSB and selects/ORs a palette). Value = the resolved palette row
 *  0..7, indexed by `parityIndex(x,y)` (`[xe·ye, xo·ye, xe·yo, xo·yo]`). asm-derived from each
 *  handler's `$7042` write and CAPTURE-VALIDATED against the v2 OAM (7/8 exact; the 8th is a
 *  multi-instance capture artefact — `$133`, sharing `$01E`'s exact init code, matches). X-only
 *  sprites repeat their two rows across Y. With no placement (picker/gallery) the renderer
 *  defaults to index 0. The shy-guy family rows 0/1/2/4 = green/red/yellow/pink (Bank04
 *  DATA_shy_guy_palette_indices). See sprite-parity-variants.ts for the panel labels. */
export const SPRITE_PARITY_PALETTE: Readonly<Record<number, readonly [number, number, number, number]>> = {
  0x08b: [0, 1, 0, 1], // Mock-Up / inflating balloon (X; Bank03 DATA_03E8CC OR $0000/$0002)
  0x01e: [0, 1, 2, 4], // Shy Guy (X+Y; Bank04 DATA_shy_guy_palette_indices — green/red/yellow/pink)
  0x133: [0, 1, 2, 4], // Lantern Ghost (shares $01E init CODE_048A18)
  0x124: [0, 1, 2, 4], // Stretch (shares CODE_048A18)
  0x192: [0, 1, 2, 4], // Petal Guy / Mufti Guy (shares CODE_048A18)
  0x0f2: [0, 1, 2, 4], // Stilt Guy (X+Y; Bank07 DATA_078538 OR $0000/$0002/$0004/$0008)
  0x0f3: [0, 1, 2, 4], // Woozy Guy (X+Y; Bank0C DATA_0CFB87 OR $0000/$0002/$0004/$0008 — dynamic body)
  0x12b: [1, 0, 1, 0], // Fat Guy (X; Bank07 DATA_07ADD3 OR $0002/$0000)
  0x0df: [7, 6, 7, 6]  // Piscatory Pete (X; Bank0C DATA_0CCE45 OR $000E/$000C)
};

/** Hidden-until-interaction sprites that render NOTHING of their own (no special_chr /
 *  object_data cel) until an interaction reveals them — at which point the asm spawns a
 *  concrete "revealed" sprite, chosen by spawn-cell parity. Value = the revealed sprite
 *  num per `parityIndex(x,y)`. The editor draws that revealed sprite's cel at 50% opacity
 *  so the placement isn't invisible. asm-derived from each handler's reveal table.
 *  $0B5 Hidden Winged Cloud → Bank03 DATA_03C084 = winged-cloud-with-prize $0BE/$0C1/$0CC. */
export const HIDDEN_REVEAL: Readonly<Record<number, readonly [number, number, number, number]>> = {
  0x0b5: [0x0be, 0x0c1, 0x0cc, 0x0c1], // 1-UP / 5-stars / red-switch / 5-stars cloud (Bank03 DATA_03C084)
  0x067: [0x0c1, 0x0c8, 0x0b8, 0x0be], //  rock-revealed winged clouds (Bank0F DATA_0F8EA6 = $0c1/$0c8/$0b8/$0b7). The asm's 4th value $0b7 ("WingedCloudWithBubbled1up") renders as the bare bubbled-1up ITEM (a 32×32 frame), NOT the 46×16 winged-cloud graphic the other 3 share — so for visual parity we DISPLAY the winged-cloud-with-1up $0be (identical cloud cel; the 1up is still conveyed by the SPRITE_PRIZES badge). All four parities now show the same faded cloud, like the other winged clouds.
  0x161: [0x115, 0x027, 0x0fa, 0x093] // Defeat-all room reward — reveals one of 4 ITEMS by cell parity: Coin/Key/Flower/Door. asm-derived (Bank0F init_bonus_sprite: position bit4 → index, main spawns DATA_0F92D9 = NorSpr115_Coin / 027_Key / 0FA_Flower / 093_Door; the index == parityIndex). All four are renderable (Coin/Key Format-A, Flower/Door dynbody) from global gfx; shown at 50% like the other hidden-reveal sprites, with the SPRITE_PRIZES badge still conveying the item on select.
  // $0D1 (Hidden pipe entrance, ! switch) used to borrow the $14D "Arrow cloud, down" cel at 50%
  // opacity here as a stand-in; it now renders a clean drawn down-arrow glyph alongside the other
  // entrance sprites instead (renderer: canvas/draw/entrance-glyphs.ts), so it's no longer listed.
};
