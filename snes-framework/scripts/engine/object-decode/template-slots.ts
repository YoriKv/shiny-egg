// Named WRAM template-slot addresses for Bank13 handler ports.
//
// Mirrors the `!RAM_YI_Level_TileTpl_*` defines in
// `yi/Memory/WRAM_LevelTemplateSlots.asm`. These are 16-bit WRAM addresses
// (`$00:19DA..$00:1DFC`) that the cart's `init_per_tileset_template_slots`
// populates at level load with per-tileset Map16-ID anchors. Bank13
// cell-stamp handlers compare against these for shape detection.
//
// Use with `state.templateAt(TT.FlatFloor_PageAnchor)` in handler ports —
// the constants below are exactly what `CMP.w $1C92` etc. reads in the
// asm, just spelled out for readability.
//
// See `WRAM_LevelTemplateSlots.asm` for per-slot semantics + the floor-
// handler chain that drives most of the naming.

export const TT = {
  // Small structural families ($0019DA-$001A61)
  Family0200_Anchor:                 0x0019DA, // 4-slot family
  Family0800_Anchor:                 0x001A02, // 9-slot family; also touches +$04, +$0A
  Family0A00_Anchor:                 0x001A16, // 9-slot family; also touches +$02, +$08
  Family0C00_Anchor:                 0x001A2A, // 5-slot family; also touches +$02
  Family1000_Anchor:                 0x001A50, // 6-slot family; also touches +$06
  Family1200_Anchor:                 0x001A5E, // 1-slot family

  // Large structural-page family ($001A62-$001BDF)
  Family1B00_Anchor:                 0x001A62, // 191-slot family

  // Wide/big-floor template page ($001BE0-$001C43)
  WideFloorPage_Anchor:              0x001BE0,

  // Floor top-row template family ($001C5C-$001C79, family $2A00)
  FloorRow0_LeftLo:                  0x001C5C, // FLOOR0DT[0] = top row, left variant
  FloorRow0_RightLo:                 0x001C5E, // FLOOR1DT[0] = top row, right variant

  // Horizontal-post family ($001C7A-$001C91)
  HorizPost_PageAnchor:              0x001C7A,

  // Flat-floor template family ($001C92-$001D11, family $3900, 64 slots)
  // The most heavily-referenced family — drives most BG_FLOOR* shape detection.
  FlatFloor_PageAnchor:              0x001C92, // slot $00; page-level family check
  FlatFloor_SlopeCapLeftLo:          0x001CA0, // slot $07; FLOR_SUB cap-detect L + FLORSB row-1 L
  FlatFloor_SlopeCapRightLo:         0x001CA2, // slot $08; FLOR_SUB cap-detect R + FLORSB row-1 R
  FlatFloor_Row1LeftLo:              0x001CB6, // slot $12; FLOOR0DT[1] body row 1 L
  FlatFloor_Row1RightLo:             0x001CB8, // slot $13; FLOOR1DT[1] body row 1 R
  FlatFloor_Row2LeftLo:              0x001CBA, // slot $14; FLOOR0DT[2] body row 2 L
  FlatFloor_Row2RightLo:             0x001CBC, // slot $15; FLOOR1DT[2] body row 2 R
  FlatFloor_Row3LeftLo:              0x001CC2, // slot $18; FLOOR0DT[3] body row 3 L
  FlatFloor_Row3RightLo:             0x001CC4, // slot $19; FLOOR1DT[3] body row 3 R
  FlatFloor_NoSeamCheckA:            0x001CD4, // slot $21; FLORSB $28!=0 path self-check
  FlatFloor_NoSeamCheckB:            0x001CD6, // slot $22; FLORSB $28=0  path self-check
  FlatFloor_RndBoundA:               0x001CF4, // slot $31; FLOOR_RND lower bound
  FlatFloor_RndBoundB:               0x001CF6, // slot $32; FLOOR_RND upper bound
  FlatFloor_NoSeamAnchorA:           0x001CFE, // slot $36; FLORSB alt anchor for NoSeamCheckA match
  FlatFloor_NoSeamAnchorB:           0x001D00, // slot $37; FLORSB alt anchor for NoSeamCheckB match

  // FLOOR_RND adjacency-fix slots (CODE_bg_floor_random + CODE_bg_floor_random_seam_fix subset).
  // See WRAM_LevelTemplateSlots.asm for full provenance.
  FlatFloor_RndProbeAnchorR:         0x001CA8, // slot $0B; result when right-neighbour probe matches RndAdjMatch
  FlatFloor_RndProbeAnchorL:         0x001CAA, // slot $0C; result when left-neighbour probe matches RndAdjMatch
  FlatFloor_RndAdjMatch:             0x001CAC, // slot $0D; canonical "random-grass center" tile compared against
  FlatFloor_RndSelfMarkA:            0x001CCA, // slot $1C; "I am already a random tile" self-check A
  FlatFloor_RndSelfMarkB:            0x001CCC, // slot $1D; "I am already a random tile" self-check B

  // Trailing template families ($001D12-$001DFC)
  Family6800_Anchor:                 0x001D8A, // 20-slot family; also touches slots 1..18
} as const;

export type TemplateSlot = keyof typeof TT;
