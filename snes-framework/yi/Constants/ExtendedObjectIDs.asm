;#############################################################################################################
;# ExtendedObjectIDs.asm -- YI extended-object IDs ($00-$FE).
;#
;# Companion to NormalSpriteIDs.asm but for the level-data engine's EXTENDED-object dispatch.
;# When the level-data parser at Bank10 CODE_108BAF reads a leading $00 byte from the object stream,
;# it consumes a 4-byte record:
;#       $00, XXXXYYYY, xxxxyyyy, IIIIIIII
;# and dispatches via the 255-entry table DATA_128000 (in Bank12) using the trailing ext-ID byte.
;# Each table entry is `dw CODE_xxx-$01`, with the standard 65816 PHA/RTL "pulled-pointer + 1"
;# convention. The selected Bank12 init handler sets up walker parameters ($2A column extent,
;# $2E row extent, $15 orientation) and tail-calls CODE_walker_setup_trampoline (or a sibling),
;# which iterates the object's bounding rectangle and invokes a per-cell stamp handler that writes
;# Map16 tile IDs into !RAM_YI_Level_LevelDataBuffer ($7F:8000).
;#
;# Range coverage:
;#   $00-$09   default common-orientation single tile (CODE_extobj_handler_default_00_09; per-extent table DATA_default_handler_extents). Per-ID objects are jungle-course leaves (left/right/small/2-leaf; widths vary per ID).
;#   $0A-$0B   single-tile stamp variant 2 (CODE_extobj_handler_single_tile_variant_2)
;#   $0C       single-tile stamp variant 3 (4-row column; CODE_extobj_handler_single_tile_variant_3)
;#   $0D-$0E   8x16 block (CODE_extobj_handler_8x16_block)
;#   $0F       single-cell direct dispatch (CODE_extobj_handler_single_cell_dispatch)
;#   $10       16x32 block (CODE_extobj_handler_16x32_block)
;#   $11       1x1 block (CODE_extobj_handler_1x1_block)
;#   $12-$13   pair-of-tiles dispatch via DATA_128920 (CODE_extobj_handler_pair_dispatch)
;#   $14-$15   slope-pair dispatch via DATA_12893F + DATA_128943 (CODE_extobj_handler_slope_pair)
;#   $16-$1F   individual stampers (CODE_extobj_handler_stake_single..CODE_extobj_handler_double_teleport_door, 10 unique bodies)
;#   $20-$2F   no-op family (16 IDs share CODE_extobj_handler_null -> $12AB55, a bare RTL). Dispatch slots that stamp nothing in V1.0; no per-ID differentiation.
;#   $30       CODE_extobj_handler_castle_wall_hole_2x2 (2x2 castle-wall breach; 4-col walk = inner 2 carve + outer 2 blend; stamp -> $12AB64)
;#   $31       CODE_extobj_handler_moving_wall_6x7 (6x7 walker -> $12AB9D)
;#   $32-$45   wall-decal family (20 IDs share CODE_extobj_handler_wall_decal_family -> $12ABE1): $32-$3A railroad-track decals, $3B-$45 graffiti decals (single tile each)
;#   $46-$5F   individual stampers (CODE_extobj_handler_random_question_block..CODE_extobj_handler_rock_4x2, with $54/$55 sharing, $56/$57 sharing,
;#             $58/$59/$5A sharing, $5B/$5C/$5D sharing)
;#   $60-$66   individual sub-shapes (CODE_extobj_handler_rock_5x3..CODE_extobj_handler_rock_2x2) via a single shared walker entry CODE_extobj_handler_rock_shared_tail
;#   $67-$70   $67 unique; $68/$69 share CODE_extobj_handler_stalactite_rock_pair; $6A/$6B/$6C unique; $6D-$70 share CODE_extobj_handler_pipe_entry_4dir
;#   $71-$7D   CODE_extobj_handler_pipe_shape_family shared by 13 IDs (variant selected by $15 modulo $0F via DATA_128CF6/DATA_128D03)
;#   $7E-$7F   share CODE_extobj_handler_pipe_lakitu_cave_pair
;#   $80-$82   individual (CODE_extobj_handler_lakitu_hole / CODE_extobj_handler_goal_floor_stand / CODE_extobj_handler_goal_roof_8x5)
;#   $83-$87   CODE_extobj_handler_sky_cloud_family shared by 5 IDs (variant indexed by $15-$83; uses DATA_128DA4/AE/B8 tables)
;#   $88       CODE_extobj_handler_pipe_hole_4x4 unique
;#   $89-$8C   share CODE_extobj_handler_pipe_arrow_4dir (variant by $15&$07; DATA_128E0B/E13/E1B)
;#   $8D       CODE_extobj_handler_no_egg_grass unique
;#   $8E-$91   share CODE_extobj_handler_line_guide_small_corner_family
;#   $92-$95   share CODE_extobj_handler_line_guide_mid_corner_family
;#   $96-$99   share CODE_extobj_handler_line_guide_large_corner_family
;#   $9A-$9D   share CODE_extobj_handler_line_guide_stopper_family
;#   $9E-$9F   share CODE_extobj_handler_pipe_cap_pair
;#   $A0-$A3   share CODE_extobj_handler_pipe_corner_family (variant by $15&$03; DATA_128ECB/ED3/EDB)
;#   $A4       CODE_extobj_handler_flower_burst_2x2 unique
;#   $A5-$A6   share CODE_extobj_handler_xmas_tree_pair
;#   $A7       CODE_extobj_handler_ice_ramp unique
;#   $A8       CODE_extobj_handler_arrow_sign_2x2_overlay (SAME body as $50; differentiated by $15 bit 3)
;#   $A9-$AC   share CODE_extobj_handler_gravel_family (variant by $15&$07)
;#   $AD-$B2   CODE_extobj_handler_crystal_cluster_family shared by 6 IDs (variant by $15-$AD; RNG-driven via CODE_prng + DATA_128FA5/AD)
;#   $B3       CODE_extobj_handler_underground_lava_rock unique
;#   $B4-$B5   share CODE_extobj_handler_mushroom_small_pair
;#   $B6-$B7   share CODE_extobj_handler_mushroom_big_pair (RNG-driven)
;#   $B8-$B9   share CODE_extobj_handler_mushroom_cluster_pair
;#   $BA-$BF   CODE_extobj_handler_dandelion_family shared by 6 IDs (variant by $15-$BA; uses DATA_12905B)
;#   $C0       CODE_extobj_handler_sky_small_girder_stand unique
;#   $C1       CODE_extobj_handler_snowy_platform_tip unique
;#   $C2-$C3   share CODE_extobj_handler_sky_big_base_pair
;#   $C4       CODE_extobj_handler_egg_block unique
;#   $C5-$C9   CODE_extobj_handler_flower_pattern_family shared by 5 IDs (variant by $15-$C5; uses DATA_1290D9/E3)
;#   $CA-$D3   CODE_extobj_handler_flower_blossom_family shared by 10 IDs (variant by $15-$CA)
;#   $D4-$DF   CODE_extobj_handler_flower_rock_art_family shared by 12 IDs (variant by $15-$D4; uses DATA_12911F/12B)
;#   $E0       CODE_extobj_handler_pipe_3d_key unique
;#   $E1-$FA   vestigial / unallocated (dw $0000) -- 26 slots
;#   $FB       CODE_extobj_FB_copy_screen_exit action: copy screen-exit table entry ($6CAA,$1C -> $6CAA,$1B)
;#   $FC       CODE_extobj_FC_vestigial_noop action: pure RTL no-op
;#   $FD       CODE_extobj_FD_clear_map16_cell action: stamp single empty/clear tile ($0000) at object position via CODE_extobj_stamp_clear_cell
;#   $FE       CODE_extobj_FE_set_babymario_float_limit action: set bit 7 on $6CAA,$1C (Baby Mario float-limit flag; stops the lost-Baby bubble drifting into the marked screen)
;#   $FF       UNUSED -- table only has 255 entries (510 bytes, $128000-$1281FD); ID $FF would index out of bounds.
;#             Valid level data never references ID $FF; it doubles as the level-data stream END marker
;#             (after the leading $00 ext-marker is consumed).
;#
;# Per-ID descriptive names below are DERIVED from the handler body's behaviour (extent values,
;# $15 orientation mask, target Bank12/13 stamper, neighbour-probe shape, and -- where unambiguous --
;# the level / tileset where the ID actually appears in shipped level data). The names are not
;# canonical -- they are reverse-engineered semantics. Many slots are minor tileset-specific
;# decorations whose exact in-game appearance is documented only by visual inspection of the level
;# data; the names below reflect that uncertainty (e.g. "TilesetDecorA" where no clearer term fits).
;#
;# Dispatch table: DATA_128000 (= DATA_object_init_ptrs) in yi/Banks/Bank12.asm starting line 193.
;# Consumer:       Bank10 CODE_108C13 (extended-object dispatch path).
;# Engine doc:     docs/leveldataengine.md (especially S3.2, S4, S5).
;#
;# See also (sibling reference files):
;#   ys_bgsc.asm     -- BG-scene root (the engine's top-level object-stream entry)
;#   ys_bgsc0.asm    -- BG-scene variant 0 (the dispatch-table source for both the extended
;#                       and standard object tables; parallels Bank12 thin init wrappers)
;#   ys_bgsc1.asm    -- BG-scene variant 1 (per-cell stamp routine bodies; parallels Bank13)
;#   ys_bgsc2.asm    -- BG-scene variant 2 (cell-fetch helpers; parallels Map16 fetch primitives)
;#############################################################################################################

;-----------------------------------------------------------------------------------------------
; $00-$09: Jungle-leaf decoration family (CODE_extobj_handler_default_00_09)
; All 10 IDs share one init body which indexes DATA_default_handler_extents,$15 for column extent
; ($2,$2,$2,$2,$1,$1,$1,$1,$3,$2). Fixed 3-row height. Per-cell stamper CODE_extobj_default_percell
; reads DATA_12A759 (a 256-byte tile-shape table) to write per-cell Map16 IDs. Used for the 10
; bushy / leafy decorations in W1 jungle and other organic tilesets.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj00_JungleLeaf0 = $00	; Init Bank12:1539 (CODE_extobj_handler_default_00_09); per-cell Bank12:5666 (CODE_12A4B2 default_percell) | Jungle-leaf decoration variant 0 (width 2, height 3).
!Define_YI_ExtObj01_JungleLeaf1 = $01	; Init Bank12:1539; per-cell Bank12:5666 | Jungle-leaf decoration variant 1 (width 2, height 3).
!Define_YI_ExtObj02_JungleLeaf2 = $02	; Init Bank12:1539; per-cell Bank12:5666 | Jungle-leaf decoration variant 2 (width 2, height 3).
!Define_YI_ExtObj03_JungleLeaf3 = $03	; Init Bank12:1539; per-cell Bank12:5666 | Jungle-leaf decoration variant 3 (width 2, height 3).
!Define_YI_ExtObj04_JungleLeaf4 = $04	; Init Bank12:1539; per-cell Bank12:5666 | Jungle-leaf decoration variant 4 (width 1, height 3).
!Define_YI_ExtObj05_JungleLeaf5 = $05	; Init Bank12:1539; per-cell Bank12:5666 | Jungle-leaf decoration variant 5 (width 1, height 3).
!Define_YI_ExtObj06_JungleLeaf6 = $06	; Init Bank12:1539; per-cell Bank12:5666 | Jungle-leaf decoration variant 6 (width 1, height 3).
!Define_YI_ExtObj07_JungleLeaf7 = $07	; Init Bank12:1539; per-cell Bank12:5666 | Jungle-leaf decoration variant 7 (width 1, height 3).
!Define_YI_ExtObj08_JungleLeaf8Wide = $08	; Init Bank12:1539; per-cell Bank12:5666 | Jungle-leaf decoration variant 8 (width 3, height 3).
!Define_YI_ExtObj09_JungleLeaf9 = $09	; Init Bank12:1539; per-cell Bank12:5666 | Jungle-leaf decoration variant 9 (width 2, height 3).

;-----------------------------------------------------------------------------------------------
; $0A-$0B: Triple-leaf / jungle bush variant 2 (CODE_extobj_handler_single_tile_variant_2)
; INC $2A / INC $2E (extents += 1), $15 masked to bit 0 then shifted (orientation selects variant).
; Per-cell stamper CODE_12A4C9 indexes a 16-bit pointer table for orientation-specific shapes.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj0A_TripleLeafBushA = $0A	; Init Bank12:1555 (CODE_extobj_handler_single_tile_variant_2); per-cell Bank12:5679 (CODE_12A4C9) | Triple-leaf jungle bush, orientation A.
!Define_YI_ExtObj0B_TripleLeafBushB = $0B	; Init Bank12:1555; per-cell Bank12:5679 | Triple-leaf jungle bush, orientation B.

;-----------------------------------------------------------------------------------------------
; $0C: Vine column (CODE_extobj_handler_single_tile_variant_3)
; 4-row vertical stamp ($2A++, $2E=4). Per-cell CODE_12A4EC picks one of 4 tile-IDs from
; DATA_12A4E4 ($920F,$9066,$9076,$9086) keyed by row position $2C, with a $9216 -> $9213 remap.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj0C_JungleVine = $0C	; Init Bank12:1568 (CODE_extobj_handler_single_tile_variant_3); per-cell Bank12:5698 (CODE_12A4EC) | Hanging jungle vine (4-row column, top/middle/end caps).

;-----------------------------------------------------------------------------------------------
; $0D-$0E: 8x16 large terrain block (CODE_extobj_handler_8x16_block)
; Forces $2A=8, $2E=16 (8 cols x 16 rows). $15 masked to bit 1 (selects one of two variants).
; Per-cell stamper CODE_12A60F indexes DATA_12A60B -> DATA_12A50B or DATA_12A58B (two 8x8-cell
; shape tables), remaps tile values via 3 fall-through ranges, and stamps.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj0D_KamekRoom8x16A = $0D	; Init Bank12:1578 (CODE_extobj_handler_8x16_block); per-cell Bank12:5739 (CODE_12A60F) | Floor and ceiling of Kamek's room (type 1).
!Define_YI_ExtObj0E_KamekRoom8x16B = $0E	; Init Bank12:1578; per-cell Bank12:5739 | Floor and ceiling of Kamek's room (type 2).

;-----------------------------------------------------------------------------------------------
; $0F: Single-cell direct stamp (CODE_extobj_handler_single_cell_dispatch)
; Single get_current_map16_tile + jump to CODE_12A64B which writes a constant $00B6 into the cell.
; No walker setup -- just stamps one specific tile at the placed position.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj0F_FlowerDecoration = $0F	; Init Bank12:1592 (CODE_extobj_handler_single_cell_dispatch); stamps Bank12:5775 (CODE_12A64B; tile $00B6) | Flower decoration (lily of the valley); single Map16 $00B6 tile.

;-----------------------------------------------------------------------------------------------
; $10: 16x32 large block (CODE_extobj_handler_16x32_block)
; Forces $2A=$10, $2E=$20. Per-cell CODE_12A665 reads DATA_12A655 (16-entry remap by ($2C,$28)&3)
; then ADC #$84C2 to derive tile ID. Used for the 16-cell-wide x 32-cell-tall slug/elevator shaft.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj10_PrinceFroggyThroat = $10	; Init Bank12:1600 (CODE_extobj_handler_16x32_block); per-cell Bank12:5784 (CODE_12A665) | Prince Froggy's throat (large 16x32 shaft -- the I-shaped centre passage).

;-----------------------------------------------------------------------------------------------
; $11: 1x1 minimal block (CODE_extobj_handler_1x1_block)
; $2A=2, $2E=1. Per-cell CODE_12A68B writes ($28 + $7797), so the tile-ID column-varies by base $7797.
; Used as the small "guru-guru" / rotating centre marker.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj11_SeesawRotatingCenter = $11	; Init Bank12:1611 (CODE_extobj_handler_1x1_block); per-cell Bank12:5804 (CODE_12A68B) | Seesaw holder / rotating centre; tile = $7797 + column index.

;-----------------------------------------------------------------------------------------------
; $12-$13: Pair-tile suspension/bridge dispatch (CODE_extobj_handler_pair_dispatch)
; $2A=5, $2E=1, $15 bit 0 selects between two cell-stampers via DATA_128920:
;   - $12 -> CODE_12A6A6 (DATA_12A69C: $96D1,$96D1,$96D1,$96D2,$96D2 -- bridge top variant)
;   - $13 -> CODE_12A6C2 (DATA_12A6B8: $96D3,$96D3,$96D1,$96D1,$96D1 -- bridge bottom variant)
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj12_RedPlatformGuideRight = $12	; Init Bank12:1625 (CODE_extobj_handler_pair_dispatch); per-cell Bank12:5817 (CODE_12A6A6) | Red platform guide (right) -- a Winged Cloud lays red platforms toward the right. Uses $96D1/$96D2 tiles.
!Define_YI_ExtObj13_RedPlatformGuideLeft = $13	; Init Bank12:1625; per-cell Bank12:5831 (CODE_12A6C2) | Red platform guide (left) -- a Winged Cloud lays red platforms toward the left. Uses $96D1/$96D3 tiles.

;-----------------------------------------------------------------------------------------------
; $14-$15: Slope-pair dispatch (CODE_extobj_handler_slope_pair)
; $2A=5, $2E=2. $15 bit 0 picks per-cell via DATA_12893F + sign via DATA_128943 ($0001 / $FFFF):
;   - $14 -> CODE_12A6E8 (DATA_12A6D4: sparse 10-entry tile map; ascending slope)
;   - $15 -> CODE_12A718 (DATA_12A704: sparse 10-entry tile map; descending slope)
; Uses CODE_walker_setup_keep_slope so the walker advances diagonally.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj14_RedPlatformGuideUpRight = $14	; Init Bank12:1646 (CODE_extobj_handler_slope_pair); per-cell Bank12:5846 (CODE_12A6E8) | Red stairs guide (up-right) -- a Winged Cloud lays red stairs upward-right (5-wide x 2-row diagonal).
!Define_YI_ExtObj15_RedPlatformGuideUpLeft = $15	; Init Bank12:1646; per-cell Bank12:5867 (CODE_12A718) | Red stairs guide (up-left) -- a Winged Cloud lays red stairs upward-left (5-wide x 2-row diagonal).

;-----------------------------------------------------------------------------------------------
; $16-$1F: Ten individual stampers (CODE_extobj_handler_stake_single .. CODE_extobj_handler_double_teleport_door)
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj16_HiddenRedCoinOnStake = $16	; Init Bank12 CODE_extobj_handler_stake_single; single-cell stamp via CODE_12A734 | Hidden red coin placed on an existing stake (place this after a stake object; affects item memory). Single-cell handler writes the $1DF8 high byte, OR $12 if the cell is empty, per a CODE_01E501 item-memory check.
!Define_YI_ExtObj17_GreenSpecialCoin = $17	; Init Bank12:1670 (CODE_extobj_handler_special_coin); single-cell stamp via Bank12:5895 (CODE_12A749) | Green coin (special coin). NOT recommended for use -- the get-code's bit length is wrong; affects item memory.
!Define_YI_ExtObj18_IntroSceneBackground = $18	; Init Bank12:1677 (CODE_extobj_handler_demo_setpiece_16x16); 16x16 area via Bank12:5922 (CODE_12A859) reading DATA_12A759 (256-byte tile table) | Intro-scene background set-piece (16x16 pre-baked Map16 art block from DATA_12A759).
!Define_YI_ExtObj19_FinalBossSetPiece1 = $19	; Init Bank12:1686 (CODE_extobj_handler_finalboss_setpiece_24x3); 24x3 walker via CODE_12AA77 | Final-boss room set-piece variant 1 (24 cells wide, 3 rows tall).
!Define_YI_ExtObj1A_FinalBossSetPiece2 = $1A	; Init Bank12:1695 (CODE_extobj_handler_finalboss_setpiece_32x12); 32x12 walker via CODE_12AA77 (same stamp body as $19 but $15=1) | Final-boss room set-piece variant 2 (32 cells wide, 12 rows tall).
!Define_YI_ExtObj1B_World6Bone1 = $1B	; Init Bank12:1708 (CODE_extobj_handler_world6_bone_variant1); 2x2 walker via CODE_12AAE5 ($15=0) | World-6 bone set-piece variant 1 (small 2x2 cluster).
!Define_YI_ExtObj1C_World6Bone2 = $1C	; Init Bank12:1713 (CODE_extobj_handler_world6_bone_variant2); 2x2 walker via CODE_12AAE5 ($15=2) | World-6 bone set-piece variant 2.
!Define_YI_ExtObj1D_World6Bone3 = $1D	; Init Bank12:1718 (CODE_extobj_handler_world6_bone_variant3); 2x2 walker via CODE_12AAE5 ($15=4) | World-6 bone set-piece variant 3.
!Define_YI_ExtObj1E_DoubleTeleportHole = $1E	; Init Bank12:1730 (CODE_extobj_handler_double_teleport_hole); 8x4 walker via CODE_12AB02 | Double-teleport corridor hole (8-wide, 4-row vertical tunnel-mouth).
!Define_YI_ExtObj1F_DoubleTeleportDoor = $1F	; Init Bank12:1740 (CODE_extobj_handler_double_teleport_door); 4x4 walker via CODE_12AB39 | Double-teleport corridor door (4x4 doorway).

;-----------------------------------------------------------------------------------------------
; $20-$2F: No-op family (CODE_extobj_handler_null)
; 16 consecutive IDs all dispatch to the SAME handler CODE_128A00, which does SBC #$0008 from
; $15 then JSL CODE_12AB55 for the per-cell stamp -- but CODE_12AB55 is a bare RTL, so it stamps
; nothing. There is no per-ID differentiation in V1.0: every slot reads identically as a stubbed
; no-op (trace stamps 0 cells). The names are flattened to _Null accordingly -- any color/shape/
; size scheme would be unsupported speculation (no basis in code, GoldenEgg, or community data).
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj20_Null = $20	; Init Bank12:1749 (CODE_extobj_handler_null); per-cell Bank12:CODE_12AB55 (bare RTL) | No-op stub (stamps nothing in V1.0).
!Define_YI_ExtObj21_Null = $21	; Init Bank12:1749; per-cell CODE_12AB55 (bare RTL) | No-op stub (stamps nothing in V1.0).
!Define_YI_ExtObj22_Null = $22	; Init Bank12:1749; per-cell CODE_12AB55 (bare RTL) | No-op stub (stamps nothing in V1.0).
!Define_YI_ExtObj23_Null = $23	; Init Bank12:1749; per-cell CODE_12AB55 (bare RTL) | No-op stub (stamps nothing in V1.0).
!Define_YI_ExtObj24_Null = $24	; Init Bank12:1749; per-cell CODE_12AB55 (bare RTL) | No-op stub (stamps nothing in V1.0).
!Define_YI_ExtObj25_Null = $25	; Init Bank12:1749; per-cell CODE_12AB55 (bare RTL) | No-op stub (stamps nothing in V1.0).
!Define_YI_ExtObj26_Null = $26	; Init Bank12:1749; per-cell CODE_12AB55 (bare RTL) | No-op stub (stamps nothing in V1.0).
!Define_YI_ExtObj27_Null = $27	; Init Bank12:1749; per-cell CODE_12AB55 (bare RTL) | No-op stub (stamps nothing in V1.0).
!Define_YI_ExtObj28_Null = $28	; Init Bank12:1749; per-cell CODE_12AB55 (bare RTL) | No-op stub (stamps nothing in V1.0).
!Define_YI_ExtObj29_Null = $29	; Init Bank12:1749; per-cell CODE_12AB55 (bare RTL) | No-op stub (stamps nothing in V1.0).
!Define_YI_ExtObj2A_Null = $2A	; Init Bank12:1749; per-cell CODE_12AB55 (bare RTL) | No-op stub (stamps nothing in V1.0).
!Define_YI_ExtObj2B_Null = $2B	; Init Bank12:1749; per-cell CODE_12AB55 (bare RTL) | No-op stub (stamps nothing in V1.0).
!Define_YI_ExtObj2C_Null = $2C	; Init Bank12:1749; per-cell CODE_12AB55 (bare RTL) | No-op stub (stamps nothing in V1.0).
!Define_YI_ExtObj2D_Null = $2D	; Init Bank12:1749; per-cell CODE_12AB55 (bare RTL) | No-op stub (stamps nothing in V1.0).
!Define_YI_ExtObj2E_Null = $2E	; Init Bank12:1749; per-cell CODE_12AB55 (bare RTL) | No-op stub (stamps nothing in V1.0).
!Define_YI_ExtObj2F_Null = $2F	; Init Bank12:1749; per-cell CODE_12AB55 (bare RTL) | No-op stub (stamps nothing in V1.0).

;-----------------------------------------------------------------------------------------------
; $30, $31: Two individual stampers (NOT part of the slope family)
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj30_CastleWallHole2x2 = $30	; Init Bank12:1769 (CODE_extobj_handler_castle_wall_hole_2x2); per-cell CODE_12AB64 | Unused 2x2 (32x32px) castle-wall breach. Walker spans 4 cols x 2 rows, but only the inner 2 cols carve the hole ($015D-$0160); the outer 2 cols blend ($015C) only where they meet a wall edge ($015A left / $015B right). A 1-col X pre-decrement centers the hole over the 2-wide placement.
!Define_YI_ExtObj31_MovingWall = $31	; Init Bank12:1780 (CODE_extobj_handler_moving_wall_6x7); 6x7 walker via CODE_12AB9D | Moving / sliding wall segment (6 cells wide, 7 rows tall).

;-----------------------------------------------------------------------------------------------
; $32-$45: Rail-graffiti family (CODE_extobj_handler_wall_decal_family)
; 20 IDs all share CODE_128A4E (SBC #$0032 from $15 to get index, then JSL CODE_12ABE1).
; First 9 are rail / track variants ($32-$3A); next 11 are graffiti / wall-art variants ($3B-$45).
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj32_Rail0 = $32	; Init Bank12:1790 (CODE_extobj_handler_wall_decal_family); per-cell CODE_12ABE1 | Rail / track decoration variant 0.
!Define_YI_ExtObj33_Rail1 = $33	; Init Bank12:1790; per-cell CODE_12ABE1 | Rail / track decoration variant 1.
!Define_YI_ExtObj34_Rail2 = $34	; Init Bank12:1790; per-cell CODE_12ABE1 | Rail / track decoration variant 2.
!Define_YI_ExtObj35_Rail3 = $35	; Init Bank12:1790; per-cell CODE_12ABE1 | Rail / track decoration variant 3.
!Define_YI_ExtObj36_Rail4 = $36	; Init Bank12:1790; per-cell CODE_12ABE1 | Rail / track decoration variant 4.
!Define_YI_ExtObj37_Rail5 = $37	; Init Bank12:1790; per-cell CODE_12ABE1 | Rail / track decoration variant 5.
!Define_YI_ExtObj38_Rail6 = $38	; Init Bank12:1790; per-cell CODE_12ABE1 | Rail / track decoration variant 6.
!Define_YI_ExtObj39_Rail7 = $39	; Init Bank12:1790; per-cell CODE_12ABE1 | Rail / track decoration variant 7.
!Define_YI_ExtObj3A_Rail8 = $3A	; Init Bank12:1790; per-cell CODE_12ABE1 | Rail / track decoration variant 8.
!Define_YI_ExtObj3B_Graffiti0 = $3B	; Init Bank12:1790; per-cell CODE_12ABE1 | Wall-graffiti decoration variant 0.
!Define_YI_ExtObj3C_Graffiti1 = $3C	; Init Bank12:1790; per-cell CODE_12ABE1 | Wall-graffiti decoration variant 1.
!Define_YI_ExtObj3D_Graffiti2 = $3D	; Init Bank12:1790; per-cell CODE_12ABE1 | Wall-graffiti decoration variant 2.
!Define_YI_ExtObj3E_Graffiti3 = $3E	; Init Bank12:1790; per-cell CODE_12ABE1 | Wall-graffiti decoration variant 3.
!Define_YI_ExtObj3F_Graffiti4 = $3F	; Init Bank12:1790; per-cell CODE_12ABE1 | Wall-graffiti decoration variant 4.
!Define_YI_ExtObj40_Graffiti5 = $40	; Init Bank12:1790; per-cell CODE_12ABE1 | Wall-graffiti decoration variant 5.
!Define_YI_ExtObj41_Graffiti6 = $41	; Init Bank12:1790; per-cell CODE_12ABE1 | Wall-graffiti decoration variant 6.
!Define_YI_ExtObj42_Graffiti7 = $42	; Init Bank12:1790; per-cell CODE_12ABE1 | Wall-graffiti decoration variant 7.
!Define_YI_ExtObj43_Graffiti8 = $43	; Init Bank12:1790; per-cell CODE_12ABE1 | Wall-graffiti decoration variant 8.
!Define_YI_ExtObj44_Graffiti9 = $44	; Init Bank12:1790; per-cell CODE_12ABE1 | Wall-graffiti decoration variant 9.
!Define_YI_ExtObj45_Graffiti10 = $45	; Init Bank12:1790; per-cell CODE_12ABE1 | Wall-graffiti decoration variant 10.

;-----------------------------------------------------------------------------------------------
; $46-$5F: Individual / small-group stampers
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj46_RandomQuestionBlock = $46	; Init Bank12:1802 (CODE_extobj_handler_random_question_block); single-cell via CODE_12ABFF | Randomly-tiled "?" block (PRNG picks 1 of 4 tiles).
!Define_YI_ExtObj47_BGHomeSet = $47	; Init Bank12:1809 (CODE_extobj_handler_bg_home_set); 4x4 walker via CODE_12AC17 with $1B Y-decrement of $0030 | BG "home" decorative set (e.g. house front, set-dressing).
!Define_YI_ExtObj48_GoalPole = $48	; Init Bank12:1828 (CODE_extobj_handler_goal_pole); 4x20 walker via CODE_12AC59 with $1B X/Y-shifts | Goal pole / level-end flagpost decoration (4 cells wide, 20 rows tall).
!Define_YI_ExtObj49_TreetopGrass = $49	; Init Bank12:1848 (CODE_extobj_handler_treetop_grass); 3x1 walker via CODE_12ACBB with $1B X-decrement | Tree-top grass tuft (3 cells wide).
!Define_YI_ExtObj4A_TreeRightGrass = $4A	; Init Bank12:1867 (CODE_extobj_handler_tree_right_grass); single-cell via CODE_12ACD3 | Tree-right grass overhang.
!Define_YI_ExtObj4B_TreeLeftGrass = $4B	; Init Bank12:1874 (CODE_extobj_handler_tree_left_grass); single-cell via CODE_12AD00 | Tree-left grass overhang.
!Define_YI_ExtObj4C_MouseHole = $4C	; Init Bank12:1881 (CODE_extobj_handler_mouse_hole); single-cell via CODE_12AD2D | Little Mouser entrance/exit hole.
!Define_YI_ExtObj4D_MidGrass = $4D	; Init Bank12:1888 (CODE_extobj_handler_mid_grass_2x2); 2x2 walker via CODE_12AD3F | Middle-height grass tuft (2x2).
!Define_YI_ExtObj4E_UpwardGrass = $4E	; Init Bank12:1897 (CODE_extobj_handler_upward_grass_1x2); 1x2 walker via CODE_12AD5D | Upward-pointing grass tuft (1 wide, 2 tall).
!Define_YI_ExtObj4F_DownwardGrass = $4F	; Init Bank12:1907 (CODE_extobj_handler_downward_grass_single); single-cell via CODE_12AD6F | Downward-hanging grass tuft.
!Define_YI_ExtObj50_ArrowSignWall = $50	; Init Bank12:1914 (CODE_extobj_handler_arrow_sign_2x2_overlay); 2x2 walker via CODE_12ADA9 ($15 bit 3 selects variant) | Arrow-sign / direction indicator (wall-mounted). SHARED body with $A8 (differentiated by $15 bit 3).
!Define_YI_ExtObj51_SpikeMaceCenter = $51	; Init Bank12 CODE_extobj_handler_spike_mace_center; single-cell via CODE_12AE22 | Center/hub of a spike mace.
!Define_YI_ExtObj52_SpikeMaceRoom = $52	; Init Bank12 CODE_extobj_handler_spike_mace_room; 5x2 walker via CODE_12AE3C ($1B X-decrement) | Boo Guys' spike-mace room (room where Boo Guys handle a spike mace).
!Define_YI_ExtObj53_SpikeBallRoom = $53	; Init Bank12 CODE_extobj_handler_spike_ball_room; 5x3 walker via CODE_12AE88 ($1B X-decrement) | Boo Guy's spike-ball room (controls a spike ball).
!Define_YI_ExtObj54_Treetop1 = $54	; Init Bank12:1972 (CODE_extobj_handler_treetop_3x3_pair); 3x3 walker via CODE_12AEF6 ($15 bit 0) | Treetop canopy, variant 1 (3x3 cluster).
!Define_YI_ExtObj55_Treetop2 = $55	; Init Bank12:1972 (CODE_extobj_handler_treetop_3x3_pair); 3x3 walker via CODE_12AEF6 ($15 bit 0) | Treetop canopy, variant 2 (3x3 cluster).
!Define_YI_ExtObj56_Treetop3 = $56	; Init Bank12:1985 (CODE_extobj_handler_treetop_5x3_pair); 5x3 walker via CODE_12AF48 ($15 bit 0) | Treetop canopy, large variant 3 (5x3).
!Define_YI_ExtObj57_Treetop4 = $57	; Init Bank12:1985 (CODE_extobj_handler_treetop_5x3_pair); 5x3 walker via CODE_12AF48 ($15 bit 0) | Treetop canopy, large variant 4 (5x3).
!Define_YI_ExtObj58_TreeLeavesLeftA = $58	; Init Bank12:1999 (CODE_extobj_handler_tree_left_3x2_trio); 3x2 walker via CODE_12AF84 ($15 mod 4) | Tree foliage, left-side leaves A (3x2).
!Define_YI_ExtObj59_TreeLeavesLeftB = $59	; Init Bank12:1999 (CODE_extobj_handler_tree_left_3x2_trio); 3x2 walker via CODE_12AF84 ($15 mod 4) | Tree foliage, left-side leaves B (3x2).
!Define_YI_ExtObj5A_TreeBranchLeft = $5A	; Init Bank12:1999 (CODE_extobj_handler_tree_left_3x2_trio); 3x2 walker via CODE_12AF84 ($15 mod 4) | Tree branch, left side (3x2).
!Define_YI_ExtObj5B_TreeLeavesRightA = $5B	; Init Bank12:2057 (CODE_extobj_handler_tree_right_3x2_trio); 3x2 walker via CODE_12AFBF ($15 mod 4) | Tree foliage, right-side leaves A (3x2; shares the $3Dxx tree tiles with $58-$5A).
!Define_YI_ExtObj5C_TreeLeavesRightB = $5C	; Init Bank12:2057 (CODE_extobj_handler_tree_right_3x2_trio); 3x2 walker via CODE_12AFBF ($15 mod 4) | Tree foliage, right-side leaves B (3x2).
!Define_YI_ExtObj5D_TreeBranchRight = $5D	; Init Bank12:2057 (CODE_extobj_handler_tree_right_3x2_trio); 3x2 walker via CODE_12AFBF ($15 mod 4) | Tree branch, right side (3x2).
!Define_YI_ExtObj5E_DonutBlockSmall = $5E	; Init Bank12:2073 (CODE_extobj_handler_donut_block_small); single-cell via CODE_12B001 | Small donut block (ring-shaped decoration); single-cell tile $7502. Distinct from the $5F-$65 flower-rock family.
!Define_YI_ExtObj5F_Rock1 = $5F	; Init Bank12:2035 (CODE_extobj_handler_rock_4x2); 4x2 walker via CODE_12B101 ($15=$00) | Rock 1 (middle-sized rock); 4x2.

;-----------------------------------------------------------------------------------------------
; $60-$66: Flower-rock variant family (share CODE_12B101 walker via shared tail CODE_extobj_handler_rock_shared_tail)
; Each ID writes a unique $15 value (0/2/4/6/8/A/C/E) and dimensions before falling into the
; shared walker setup at CODE_extobj_handler_rock_shared_tail ($12B101 is the per-cell stamper).
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj60_Rock2 = $60	; Init Bank12:2042 (CODE_extobj_handler_rock_5x3); 5x3 walker via CODE_12B101 ($15=$02) | Rock 2 (large rock); 5x3.
!Define_YI_ExtObj61_Rock3 = $61	; Init Bank12:2049 (CODE_extobj_handler_rock_3x2_a); 3x2 walker via CODE_12B101 ($15=$04) | Rock 3 (small rock); 3x2.
!Define_YI_ExtObj62_Rock4 = $62	; Init Bank12:2054 (CODE_extobj_handler_rock_3x2_b); 3x2 walker via CODE_12B101 ($15=$06) | Rock 4 (small rock); 3x2.
!Define_YI_ExtObj63_Rock5 = $63	; Init Bank12:2062 (CODE_extobj_handler_rock_5x4_a); 5x4 walker via CODE_12B101 ($15=$08) | Rock 5 (large rock); 5x4.
!Define_YI_ExtObj64_Rock6 = $64	; Init Bank12:2067 (CODE_extobj_handler_rock_5x4_b); 5x4 walker via CODE_12B101 ($15=$0A) | Rock 6 (large rock); 5x4.
!Define_YI_ExtObj65_Rock7 = $65	; Init Bank12:2075 (CODE_extobj_handler_rock_4x3); 4x3 walker via CODE_12B101 ($15=$0C) | Rock 7 (middle-sized rock); 4x3.
!Define_YI_ExtObj66_Rock8 = $66	; Init Bank12:2082 (CODE_extobj_handler_rock_2x2); 2x2 walker via CODE_12B101 ($15=$0E) | Rock 8 (small rock); 2x2.

;-----------------------------------------------------------------------------------------------
; $67-$70: Single-cell + group stampers
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj67_OldBranch = $67	; Init Bank12:2097 (CODE_extobj_handler_old_branch); single-cell via CODE_12B14A | Branch of a tree stuck in the ground; single-cell.
!Define_YI_ExtObj68_StonesWaterfall = $68	; Init Bank12:2104 (CODE_extobj_handler_stalactite_rock_pair); single-cell via CODE_12B179 | Stones on a waterfall (caves); single-cell.
!Define_YI_ExtObj69_StoneWaterfall = $69	; Init Bank12:2104 (CODE_extobj_handler_stalactite_rock_pair); single-cell via CODE_12B179 | Stone on a waterfall (caves); shares body with $68.
!Define_YI_ExtObj6A_GrassShadowSmall = $6A	; Init Bank12:2111 (CODE_extobj_handler_grass_shadow_small); 3x2 walker via CODE_12B194 ($15=$00) | Small grass-shadow decoration (3x2).
!Define_YI_ExtObj6B_GrassShadowMid = $6B	; Init Bank12:2118 (CODE_extobj_handler_grass_shadow_mid); 4x3 walker via CODE_12B194 ($15=$02) | Mid-size grass-shadow decoration (4x3).
!Define_YI_ExtObj6C_GrassShadowBig = $6C	; Init Bank12:2125 (CODE_extobj_handler_grass_shadow_big); 5x3 walker via CODE_12B194 ($15=$04) | Large grass-shadow decoration (5x3).
!Define_YI_ExtObj6D_PipeEntryUp = $6D	; Init Bank12:2141 (CODE_extobj_handler_pipe_entry_4dir); 2x2 walker via CODE_12B21A ($15 mod 4, -1 shift) | Vertical pipe / entry-mouth pointing up.
!Define_YI_ExtObj6E_PipeEntryDown = $6E	; Init Bank12:2141 (CODE_extobj_handler_pipe_entry_4dir); 2x2 walker via CODE_12B21A | Vertical pipe / entry-mouth pointing down.
!Define_YI_ExtObj6F_PipeEntryLeft = $6F	; Init Bank12:2141 (CODE_extobj_handler_pipe_entry_4dir); 2x2 walker via CODE_12B21A | Horizontal pipe / entry-mouth pointing left.
!Define_YI_ExtObj70_PipeEntryRight = $70	; Init Bank12:2141 (CODE_extobj_handler_pipe_entry_4dir); 2x2 walker via CODE_12B21A | Horizontal pipe / entry-mouth pointing right.

;-----------------------------------------------------------------------------------------------
; $71-$7D: Pipe-shape family (CODE_extobj_handler_pipe_shape_family shared by 13 IDs)
; $2A and $2E come from DATA_128CF6 / DATA_128D03 indexed by $15 (13 entries each).
; Per-cell stamper read from 13-entry DATA_128D10 -> CODE_12B23C / 25A / 271 / 288 / 2A3 / 2CB /
; 2F8 / 326 / 349 / 36A / 393 / 3BC / 3D1.
; The 13 IDs cover the 13 pipe variants: 2 X-size, 2 Y-size, 4 X-taper, 4 Y-taper, and
; 1 water-outlet (see also ys_bgsc1.asm).
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj71_PipeXSizeNarrow = $71	; Init Bank12:2165 (CODE_extobj_handler_pipe_shape_family); per-cell CODE_12B23C ($15&$0F = 0) | Horizontal pipe section, narrow width.
!Define_YI_ExtObj72_PipeXSizeWide = $72	; Init Bank12:2165 (CODE_extobj_handler_pipe_shape_family); per-cell CODE_12B25A ($15&$0F = 1) | Horizontal pipe section, wide width.
!Define_YI_ExtObj73_PipeYSizeNarrow = $73	; Init Bank12:2165 (CODE_extobj_handler_pipe_shape_family); per-cell CODE_12B271 ($15&$0F = 2) | Vertical pipe section, narrow width.
!Define_YI_ExtObj74_PipeYSizeWide = $74	; Init Bank12:2165 (CODE_extobj_handler_pipe_shape_family); per-cell CODE_12B288 ($15&$0F = 3) | Vertical pipe section, wide width.
!Define_YI_ExtObj75_PipeXTunnel0 = $75	; Init Bank12:2165 (CODE_extobj_handler_pipe_shape_family); per-cell CODE_12B2A3 ($15&$0F = 4) | Horizontal pipe tunnel-segment variant 0.
!Define_YI_ExtObj76_PipeXTunnel1 = $76	; Init Bank12:2165 (CODE_extobj_handler_pipe_shape_family); per-cell CODE_12B2CB ($15&$0F = 5) | Horizontal pipe tunnel-segment variant 1.
!Define_YI_ExtObj77_PipeXTunnel2 = $77	; Init Bank12:2165 (CODE_extobj_handler_pipe_shape_family); per-cell CODE_12B2F8 ($15&$0F = 6) | Horizontal pipe tunnel-segment variant 2.
!Define_YI_ExtObj78_PipeXTunnel3 = $78	; Init Bank12:2165 (CODE_extobj_handler_pipe_shape_family); per-cell CODE_12B326 ($15&$0F = 7) | Horizontal pipe tunnel-segment variant 3.
!Define_YI_ExtObj79_PipeYTunnel0 = $79	; Init Bank12:2165 (CODE_extobj_handler_pipe_shape_family); per-cell CODE_12B349 ($15&$0F = 8) | Vertical pipe tunnel-segment variant 0.
!Define_YI_ExtObj7A_PipeYTunnel1 = $7A	; Init Bank12:2165 (CODE_extobj_handler_pipe_shape_family); per-cell CODE_12B36A ($15&$0F = 9) | Vertical pipe tunnel-segment variant 1.
!Define_YI_ExtObj7B_PipeYTunnel2 = $7B	; Init Bank12:2165 (CODE_extobj_handler_pipe_shape_family); per-cell CODE_12B393 ($15&$0F = A) | Vertical pipe tunnel-segment variant 2.
!Define_YI_ExtObj7C_PipeYTunnel3 = $7C	; Init Bank12:2165 (CODE_extobj_handler_pipe_shape_family); per-cell CODE_12B3BC ($15&$0F = B) | Vertical pipe tunnel-segment variant 3.
!Define_YI_ExtObj7D_PipeWaterOut = $7D	; Init Bank12:2165 (CODE_extobj_handler_pipe_shape_family); per-cell CODE_12B3D1 ($15&$0F = C) | Pipe water-outlet (spits water; pipe-mouth into water).

;-----------------------------------------------------------------------------------------------
; $7E-$7F: Pipe-mouth-with-Lakitu pair (CODE_extobj_handler_pipe_lakitu_cave_pair)
; $15 bit 0 selects variant via shifted index.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj7E_PipeNKage0 = $7E	; Init Bank12:2182 (CODE_extobj_handler_pipe_lakitu_cave_pair); per-cell CODE_12B3E1 ($15 bit 0 = 0) | Pipe-mouth Lakitu-cave variant 0.
!Define_YI_ExtObj7F_PipeNKage1 = $7F	; Init Bank12:2182 (CODE_extobj_handler_pipe_lakitu_cave_pair); per-cell CODE_12B3E1 ($15 bit 0 = 1) | Pipe-mouth Lakitu-cave variant 1.

;-----------------------------------------------------------------------------------------------
; $80-$82: Lakitu-hole / goal-set decorations
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj80_LakituHole = $80	; Init Bank12:2192 (CODE_extobj_handler_lakitu_hole); single-cell via CODE_12B3F1 | Lakitu (Jugemu) cloud-hole (single-cell decoration).
!Define_YI_ExtObj81_YoshiHouseChimneys = $81	; Init Bank12:2199 (CODE_extobj_handler_goal_floor_stand); 4-wide row via CODE_12B3FB | Chimneys of Yoshi's house (4 cells wide).
!Define_YI_ExtObj82_YoshiHouse = $82	; Init Bank12:2207 (CODE_extobj_handler_goal_roof_8x5); 8x5 walker via CODE_12B45C with $1B Y-decrement $0040 | Yoshi's house (8 cells wide x 5 tall).

;-----------------------------------------------------------------------------------------------
; $83-$87: Sky-cloud family (CODE_extobj_handler_sky_cloud_family shared by 5 IDs)
; Variant indexed by $15 - $83 (so values 0..4). Tables DATA_128DA4 / AE / B8 give per-variant
; Y-decrement / column-extent / row-extent. Per-cell stamper CODE_12B933.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj83_SkyCloud0 = $83	; Init Bank12:2236 (CODE_extobj_handler_sky_cloud_family); per-cell CODE_12B933 (variant 0; $2A=$20, $2E=$16) | Sky cloud, large platform variant 0.
!Define_YI_ExtObj84_SkyCloud1 = $84	; Init Bank12:2236 (CODE_extobj_handler_sky_cloud_family); per-cell CODE_12B933 (variant 1; $2A=$13, $2E=$0B) | Sky cloud, medium-large variant 1.
!Define_YI_ExtObj85_SkyCloud2 = $85	; Init Bank12:2236 (CODE_extobj_handler_sky_cloud_family); per-cell CODE_12B933 (variant 2; $2A=$0A, $2E=$07) | Sky cloud, medium variant 2.
!Define_YI_ExtObj86_SkyCloud3 = $86	; Init Bank12:2236 (CODE_extobj_handler_sky_cloud_family); per-cell CODE_12B933 (variant 3; $2A=$08, $2E=$07) | Sky cloud, small variant 3.
!Define_YI_ExtObj87_SkyCloud4 = $87	; Init Bank12:2236 (CODE_extobj_handler_sky_cloud_family); per-cell CODE_12B933 (variant 4; $2A=$0D, $2E=$08) | Sky cloud, tall variant 4.

;-----------------------------------------------------------------------------------------------
; $88: Pipe-hole single
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj88_PipeHole = $88	; Init Bank12:2263 (CODE_extobj_handler_pipe_hole_4x4); 4x4 walker via CODE_12B97B | Pipe-hole / open-pipe-mouth (4x4 cluster).

;-----------------------------------------------------------------------------------------------
; $89-$8C: Pipe-arrow family (CODE_extobj_handler_pipe_arrow_4dir shared by 4 IDs)
; $15 & $07 selects column/row extent via DATA_128E0B / E13 (4 entries). $15-1 & $02 selects
; per-cell stamper between DATA_128E1B's CODE_12BAED and CODE_12BB2A. 4 cardinal directions.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj89_PipeArrowLeft = $89	; Init Bank12:2281 (CODE_extobj_handler_pipe_arrow_4dir); per-cell CODE_12BAED / CODE_12BB2A | Pipe-arrow indicator pointing left.
!Define_YI_ExtObj8A_PipeArrowRight = $8A	; Init Bank12:2281 (CODE_extobj_handler_pipe_arrow_4dir); per-cell CODE_12BAED / CODE_12BB2A | Pipe-arrow indicator pointing right.
!Define_YI_ExtObj8B_PipeArrowUp = $8B	; Init Bank12:2281 (CODE_extobj_handler_pipe_arrow_4dir); per-cell CODE_12BAED / CODE_12BB2A | Pipe-arrow indicator pointing up.
!Define_YI_ExtObj8C_PipeArrowDown = $8C	; Init Bank12:2281 (CODE_extobj_handler_pipe_arrow_4dir); per-cell CODE_12BAED / CODE_12BB2A | Pipe-arrow indicator pointing down.

;-----------------------------------------------------------------------------------------------
; $8D: Egg-spawning grass
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj8D_LedgeTopCornerModifier = $8D	; Init Bank12:2304 (CODE_extobj_handler_no_egg_grass); single-cell via CODE_12BB63 | Ledge top-corner modifier -- planes a ground/ledge edge (single-cell special-collision).

;-----------------------------------------------------------------------------------------------
; $8E-$91: Line-guide small-corner family (CODE_extobj_handler_line_guide_small_corner_family shared by 4 IDs)
; $15 INC INC AND #$03 selects 1 of 4 corner orientations (0=TL, 1=TR, 2=BL, 3=BR). Per-cell stamper CODE_12BC01.
; Corner pieces for a line-guide track (the dotted rail a platform rides; the tracks are std $CE-$D2). Small = single $87xx cell.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj8E_LineGuideSmallCornerTL = $8E	; Init Bank12:2311 (CODE_extobj_handler_line_guide_small_corner_family); per-cell CODE_12BC01 (variant 0 = TL) | Small line-guide corner, top-left. Single-cell stamp of Map16 $8710.
!Define_YI_ExtObj8F_LineGuideSmallCornerTR = $8F	; Init Bank12:2311 (CODE_extobj_handler_line_guide_small_corner_family); per-cell CODE_12BC01 (variant 1 = TR) | Small line-guide corner, top-right. Single-cell stamp of Map16 $8711.
!Define_YI_ExtObj90_LineGuideSmallCornerBL = $90	; Init Bank12:2311 (CODE_extobj_handler_line_guide_small_corner_family); per-cell CODE_12BC01 (variant 2 = BL) | Small line-guide corner, bottom-left. Single-cell stamp of Map16 $8712.
!Define_YI_ExtObj91_LineGuideSmallCornerBR = $91	; Init Bank12:2311 (CODE_extobj_handler_line_guide_small_corner_family); per-cell CODE_12BC01 (variant 3 = BR) | Small line-guide corner, bottom-right. Single-cell stamp of Map16 $8713.

;-----------------------------------------------------------------------------------------------
; $92-$95: Line-guide mid-corner family (CODE_extobj_handler_line_guide_mid_corner_family shared by 4 IDs)
; 2x2 walker. $15 INC INC AND #$03 selects corner orientation (0=TL, 1=TR, 2=BL, 3=BR). Per-cell stamper CODE_12BC2A.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj92_LineGuideCornerTL = $92	; Init Bank12:2323 (CODE_extobj_handler_line_guide_mid_corner_family); per-cell CODE_12BC2A (variant 0 = TL; 2x2) | Mid-size line-guide corner, top-left.
!Define_YI_ExtObj93_LineGuideCornerTR = $93	; Init Bank12:2323 (CODE_extobj_handler_line_guide_mid_corner_family); per-cell CODE_12BC2A (variant 1 = TR; 2x2) | Mid-size line-guide corner, top-right.
!Define_YI_ExtObj94_LineGuideCornerBL = $94	; Init Bank12:2323 (CODE_extobj_handler_line_guide_mid_corner_family); per-cell CODE_12BC2A (variant 2 = BL; 2x2) | Mid-size line-guide corner, bottom-left.
!Define_YI_ExtObj95_LineGuideCornerBR = $95	; Init Bank12:2323 (CODE_extobj_handler_line_guide_mid_corner_family); per-cell CODE_12BC2A (variant 3 = BR; 2x2) | Mid-size line-guide corner, bottom-right.

;-----------------------------------------------------------------------------------------------
; $96-$99: Line-guide large-corner family (CODE_extobj_handler_line_guide_large_corner_family shared by 4 IDs)
; 8x8 walker. $15 INC INC AND #$03 selects corner orientation (0=TL, 1=TR, 2=BL, 3=BR). Per-cell stamper CODE_12BD55.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj96_LineGuideLargeCornerTL = $96	; Init Bank12:2338 (CODE_extobj_handler_line_guide_large_corner_family); per-cell CODE_12BD55 (variant 0 = TL; 8x8) | Large line-guide corner, top-left.
!Define_YI_ExtObj97_LineGuideLargeCornerTR = $97	; Init Bank12:2338 (CODE_extobj_handler_line_guide_large_corner_family); per-cell CODE_12BD55 (variant 1 = TR; 8x8) | Large line-guide corner, top-right.
!Define_YI_ExtObj98_LineGuideLargeCornerBL = $98	; Init Bank12:2338 (CODE_extobj_handler_line_guide_large_corner_family); per-cell CODE_12BD55 (variant 2 = BL; 8x8) | Large line-guide corner, bottom-left.
!Define_YI_ExtObj99_LineGuideLargeCornerBR = $99	; Init Bank12:2338 (CODE_extobj_handler_line_guide_large_corner_family); per-cell CODE_12BD55 (variant 3 = BR; 8x8) | Large line-guide corner, bottom-right.

;-----------------------------------------------------------------------------------------------
; $9A-$9D: Line-guide stopper family (CODE_extobj_handler_line_guide_stopper_family shared by 4 IDs)
; 2-cell stamp (body + cap). $15 DEC DEC AND #$03 ASL selects the end (0=left, 1=right, 2=top, 3=bottom). Per-cell stamper CODE_12BD8E.
; Caps the end of a line-guide track (std $CE-$D2): body tile at the anchor cell + a cap tile in the neighbour cell.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj9A_LineGuideStopLeft = $9A	; Init Bank12:2353 (CODE_extobj_handler_line_guide_stopper_family); 2-cell via CODE_12BD8E (variant 0 = left) | Line-guide stopper, left end.
!Define_YI_ExtObj9B_LineGuideStopRight = $9B	; Init Bank12:2353 (CODE_extobj_handler_line_guide_stopper_family); 2-cell via CODE_12BD8E (variant 1 = right) | Line-guide stopper, right end.
!Define_YI_ExtObj9C_LineGuideStopTop = $9C	; Init Bank12:2353 (CODE_extobj_handler_line_guide_stopper_family); 2-cell via CODE_12BD8E (variant 2 = top) | Line-guide stopper, top end.
!Define_YI_ExtObj9D_LineGuideStopBottom = $9D	; Init Bank12:2353 (CODE_extobj_handler_line_guide_stopper_family); 2-cell via CODE_12BD8E (variant 3 = bottom) | Line-guide stopper, bottom end.

;-----------------------------------------------------------------------------------------------
; $9E-$9F: Pipe-cap pair (CODE_extobj_handler_pipe_cap_pair)
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObj9E_PipeCapLeft = $9E	; Init Bank12:2366 (CODE_extobj_handler_pipe_cap_pair); single-cell via CODE_12BDC0 ($15 bit 0 = 0) | Pipe end-cap, left orientation.
!Define_YI_ExtObj9F_PipeCapRight = $9F	; Init Bank12:2366 (CODE_extobj_handler_pipe_cap_pair); single-cell via CODE_12BDC0 ($15 bit 0 = 1) | Pipe end-cap, right orientation.

;-----------------------------------------------------------------------------------------------
; $A0-$A3: Pipe-corner family (CODE_extobj_handler_pipe_corner_family shared by 4 IDs)
; $15 & $03 selects 1 of 4 quadrant variants. $1B X/Y deltas from DATA_128ECB / ED3 (4-entry word
; tables). Per-cell stamper picked from DATA_128EDB -> CODE_12BDEA / 12BE42 / 12BE99 / 12BEF1.
; 4 elbow-corner pipe pieces (UL/UR/DL/DR).
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjA0_PipeCornerUL = $A0	; Init Bank12:2386 (CODE_extobj_handler_pipe_corner_family); per-cell CODE_12BDEA (variant 0) | Pipe-elbow corner, upper-left orientation.
!Define_YI_ExtObjA1_PipeCornerUR = $A1	; Init Bank12:2386 (CODE_extobj_handler_pipe_corner_family); per-cell CODE_12BE42 (variant 1) | Pipe-elbow corner, upper-right orientation.
!Define_YI_ExtObjA2_PipeCornerDL = $A2	; Init Bank12:2386 (CODE_extobj_handler_pipe_corner_family); per-cell CODE_12BE99 (variant 2) | Pipe-elbow corner, lower-left orientation.
!Define_YI_ExtObjA3_PipeCornerDR = $A3	; Init Bank12:2386 (CODE_extobj_handler_pipe_corner_family); per-cell CODE_12BEF1 (variant 3) | Pipe-elbow corner, lower-right orientation.

;-----------------------------------------------------------------------------------------------
; $A4: Flower-burst
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjA4_FlowerBurst = $A4	; Init Bank12:2412 (CODE_extobj_handler_flower_burst_2x2); 2x2 walker via CODE_12BF4B | Flower-burst decoration (2x2 starburst).

;-----------------------------------------------------------------------------------------------
; $A5-$A6: Xmas-tree pair (CODE_extobj_handler_xmas_tree_pair)
; $15 bit 0 selects between size variants. $1B X/Y decrements per variant from DATA_128F2A/2E/32/36.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjA5_XmasTreeBig = $A5	; Init Bank12:2433 (CODE_extobj_handler_xmas_tree_pair); per-cell CODE_12BFF4 (variant 0; 3x5) | Large Christmas-tree decoration (sky world).
!Define_YI_ExtObjA6_XmasTreeSmall = $A6	; Init Bank12:2433 (CODE_extobj_handler_xmas_tree_pair); per-cell CODE_12BFF4 (variant 1; 5x9) | Smaller Christmas-tree decoration (despite "Small" label this variant is actually wider per DATA_128F32/F36).

;-----------------------------------------------------------------------------------------------
; $A7: Underground ice ramp
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjA7_IceRampHyho = $A7	; Init Bank12:2461 (CODE_extobj_handler_ice_ramp); single-cell via CODE_12C063 | Underground ice ramp / "hyo-hyo" ice slip pattern.

;-----------------------------------------------------------------------------------------------
; $A8: Arrow-sign sub-variant (SHARES CODE_extobj_handler_arrow_sign_2x2_overlay with $50)
; SAME init body as ext-obj $50 (init handler at Bank12:1914). The two are differentiated only by
; the placement context / $15 bit 3 (handler does AND #$0008 ASL).
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjA8_ArrowSignSub = $A8	; Init Bank12:1914 (CODE_extobj_handler_arrow_sign_2x2_overlay); 2x2 walker via CODE_12ADA9 | Arrow-sign sub-variant (shares body with $50; $15 bit 3 picks orientation).

;-----------------------------------------------------------------------------------------------
; $A9-$AC: Underground gravel family (CODE_extobj_handler_gravel_family shared by 4 IDs)
; $15 & $07 DEC ASL selects variant. $2E from DATA_128F84 (5,4,3,3) per-variant. Per-cell stamper
; CODE_12C044.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjA9_IcicleTall = $A9	; Init Bank12:2471 (CODE_extobj_handler_gravel_family); per-cell CODE_12C044 (variant 0; row=5) | Tall icicle (variant 0; row=5).
!Define_YI_ExtObjAA_Icicle = $AA	; Init Bank12:2471 (CODE_extobj_handler_gravel_family); per-cell CODE_12C044 (variant 1; row=4) | Icicle (variant 1; row=4).
!Define_YI_ExtObjAB_IcicleShort = $AB	; Init Bank12:2471 (CODE_extobj_handler_gravel_family); per-cell CODE_12C044 (variant 2; row=3) | Short icicle (variant 2; row=3).
!Define_YI_ExtObjAC_IcicleBroken = $AC	; Init Bank12:2471 (CODE_extobj_handler_gravel_family); per-cell CODE_12C044 (variant 3; row=3) | Broken icicle (variant 3; row=3).

;-----------------------------------------------------------------------------------------------
; $AD-$B2: Crystal-cluster family (CODE_extobj_handler_crystal_cluster_family shared by 6 IDs)
; CODE_prng called first; result AND #$0006 -> $A1 from DATA_128FA5. $15 - $AD then ASL selects
; per-variant $2E from DATA_128FAD. 2-wide, variable height. Per-cell stamper CODE_12C0B1.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjAD_Crystal0 = $AD	; Init Bank12:2491 (CODE_extobj_handler_crystal_cluster_family); per-cell CODE_12C0B1 (variant 0; 2x3, RNG-driven) | Underground crystal cluster variant 0.
!Define_YI_ExtObjAE_Crystal1 = $AE	; Init Bank12:2491 (CODE_extobj_handler_crystal_cluster_family); per-cell CODE_12C0B1 (variant 1; 2x3) | Underground crystal cluster variant 1.
!Define_YI_ExtObjAF_Crystal2 = $AF	; Init Bank12:2491 (CODE_extobj_handler_crystal_cluster_family); per-cell CODE_12C0B1 (variant 2; 2x2) | Underground crystal cluster variant 2.
!Define_YI_ExtObjB0_Crystal3 = $B0	; Init Bank12:2491 (CODE_extobj_handler_crystal_cluster_family); per-cell CODE_12C0B1 (variant 3; 2x2) | Underground crystal cluster variant 3.
!Define_YI_ExtObjB1_Crystal4 = $B1	; Init Bank12:2491 (CODE_extobj_handler_crystal_cluster_family); per-cell CODE_12C0B1 (variant 4; 2x2) | Underground crystal cluster variant 4.
!Define_YI_ExtObjB2_Crystal5 = $B2	; Init Bank12:2491 (CODE_extobj_handler_crystal_cluster_family); per-cell CODE_12C0B1 (variant 5; 2x2) | Underground crystal cluster variant 5.

;-----------------------------------------------------------------------------------------------
; $B3: Underground lava-rock single
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjB3_UndergroundLavaRock = $B3	; Init Bank12:2512 (CODE_extobj_handler_underground_lava_rock); single-cell via CODE_12C0CF | Underground lava-rock single-cell decoration.

;-----------------------------------------------------------------------------------------------
; $B4-$B5: Mushroom-small pair (CODE_extobj_handler_mushroom_small_pair shared by 2 IDs)
; 2x2 walker. RNG-driven $A1. $15 & $01. Per-cell stamper CODE_12C108.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjB4_MushroomSmall0 = $B4	; Init Bank12:2519 (CODE_extobj_handler_mushroom_small_pair); per-cell CODE_12C108 (variant 0; 2x2 RNG) | Underground mushroom-small variant 0.
!Define_YI_ExtObjB5_MushroomSmall1 = $B5	; Init Bank12:2519 (CODE_extobj_handler_mushroom_small_pair); per-cell CODE_12C108 (variant 1; 2x2 RNG) | Underground mushroom-small variant 1.

;-----------------------------------------------------------------------------------------------
; $B6-$B7: Mushroom-big pair (CODE_extobj_handler_mushroom_big_pair shared by 2 IDs)
; 3x3 walker. RNG-driven (PRNG AND #$0001 contributes 1 bit to a 2-bit variant index from $15).
; Per-cell stamper CODE_12C191.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjB6_MushroomBig0 = $B6	; Init Bank12:2534 (CODE_extobj_handler_mushroom_big_pair); per-cell CODE_12C191 (variant 0; 3x3 RNG) | Underground mushroom-big variant 0.
!Define_YI_ExtObjB7_MushroomBig1 = $B7	; Init Bank12:2534 (CODE_extobj_handler_mushroom_big_pair); per-cell CODE_12C191 (variant 1; 3x3 RNG) | Underground mushroom-big variant 1.

;-----------------------------------------------------------------------------------------------
; $B8-$B9: Three/four-mushroom-cluster pair (CODE_extobj_handler_mushroom_cluster_pair shared by 2 IDs)
; $15 bit 0 selects variant. $2A from DATA_129036 (4,5), $2E from DATA_12903A (4,6). Per-cell
; stamper CODE_12C244.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjB8_MushroomCluster3 = $B8	; Init Bank12:2558 (CODE_extobj_handler_mushroom_cluster_pair); per-cell CODE_12C244 (variant 0; 4x4) | 3-mushroom cluster underground decoration.
!Define_YI_ExtObjB9_MushroomCluster4 = $B9	; Init Bank12:2558 (CODE_extobj_handler_mushroom_cluster_pair); per-cell CODE_12C244 (variant 1; 5x6) | 4-mushroom cluster underground decoration.

;-----------------------------------------------------------------------------------------------
; $BA-$BF: Slime-mushroom family (CODE_extobj_handler_dandelion_family shared by 6 IDs)
; $15 - $BA ASL selects 1 of 6 variants. $2E from DATA_12905B (2,3,4,4,3,2). RNG-driven $A1.
; Per-cell stamper CODE_12C29C.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjBA_DandelionShortLeft = $BA	; Init Bank12 CODE_extobj_handler_dandelion_family | Short fluffed dandelion, facing left.
!Define_YI_ExtObjBB_DandelionMidLeft = $BB	; Init Bank12 CODE_extobj_handler_dandelion_family | Middle fluffed dandelion, facing left.
!Define_YI_ExtObjBC_DandelionTallLeft = $BC	; Init Bank12 CODE_extobj_handler_dandelion_family | Tall fluffed dandelion, facing left.
!Define_YI_ExtObjBD_DandelionShortRight = $BD	; Init Bank12 CODE_extobj_handler_dandelion_family | Short fluffed dandelion, facing right.
!Define_YI_ExtObjBE_DandelionMidRight = $BE	; Init Bank12 CODE_extobj_handler_dandelion_family | Middle fluffed dandelion, facing right.
!Define_YI_ExtObjBF_DandelionTallRight = $BF	; Init Bank12 CODE_extobj_handler_dandelion_family | Tall fluffed dandelion, facing right.

;-----------------------------------------------------------------------------------------------
; $C0: Sky small-girder-stand
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjC0_SnowyPlatformSmall = $C0	; Init Bank12:2596 (CODE_extobj_handler_sky_small_girder_stand); 2x2 walker via CODE_12C2CA | Small snowy platform (2x2).

;-----------------------------------------------------------------------------------------------
; $C1: Sky pointed-spike
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjC1_SnowyPlatformSupportTip = $C1	; Init Bank12 CODE_extobj_handler_snowy_platform_tip; 2x1 walker via CODE_12C302 | Tip of a snowy-platform support (2x1).

;-----------------------------------------------------------------------------------------------
; $C2-$C3: Sky big-base pair (CODE_extobj_handler_sky_big_base_pair)
; 4x4 walker. $15 bit 0 selects variant by shifting bits up (ASL ASL ASL ASL).
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjC2_SnowyPlatform = $C2	; Init Bank12:2615 (CODE_extobj_handler_sky_big_base_pair); per-cell CODE_12C375 (variant 0; 4x4) | Snowy platform (variant A; 4x4).
!Define_YI_ExtObjC3_SnowyPlatformFalling = $C3	; Init Bank12:2615 (CODE_extobj_handler_sky_big_base_pair); per-cell CODE_12C375 (variant 1; 4x4) | Unbalanced snowy platform -- falls when stepped on (variant B; 4x4).

;-----------------------------------------------------------------------------------------------
; $C4: Egg-block
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjC4_EggBlock = $C4	; Init Bank12:2631 (CODE_extobj_handler_egg_block); single-cell via CODE_12C38E | Egg-block (! switch) ground decoration.

;-----------------------------------------------------------------------------------------------
; $C5-$C9: Flower-pattern family (CODE_extobj_handler_flower_pattern_family shared by 5 IDs)
; $15 - $C5 ASL selects variant. $2A from DATA_1290D9 (5 entries), $2E from DATA_1290E3 (5 entries).
; Per-cell stamper CODE_12C3D3.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjC5_FlowerPattern0 = $C5	; Init Bank12:2644 (CODE_extobj_handler_flower_pattern_family); per-cell CODE_12C3D3 (variant 0; 2x2) | Flower-pattern wall variant 0.
!Define_YI_ExtObjC6_FlowerPattern1 = $C6	; Init Bank12:2644 (CODE_extobj_handler_flower_pattern_family); per-cell CODE_12C3D3 (variant 1; 3x3) | Flower-pattern wall variant 1.
!Define_YI_ExtObjC7_FlowerPattern2 = $C7	; Init Bank12:2644 (CODE_extobj_handler_flower_pattern_family); per-cell CODE_12C3D3 (variant 2; 2x3) | Flower-pattern wall variant 2.
!Define_YI_ExtObjC8_FlowerPattern3 = $C8	; Init Bank12:2644 (CODE_extobj_handler_flower_pattern_family); per-cell CODE_12C3D3 (variant 3; 2x2) | Flower-pattern wall variant 3.
!Define_YI_ExtObjC9_FlowerPattern4 = $C9	; Init Bank12:2644 (CODE_extobj_handler_flower_pattern_family); per-cell CODE_12C3D3 (variant 4; 2x2) | Flower-pattern wall variant 4.

;-----------------------------------------------------------------------------------------------
; $CA-$D3: Flower-decoration family (CODE_extobj_handler_flower_blossom_family shared by 10 IDs)
; Single-cell stamps. $15 - $CA gives variant index 0..9. Per-cell stamper CODE_12C3FF.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjCA_FlowerBlossom0 = $CA	; Init Bank12:2660 (CODE_extobj_handler_flower_blossom_family); single-cell CODE_12C3FF (variant 0) | Flower decoration variant 0.
!Define_YI_ExtObjCB_FlowerBlossom1 = $CB	; Init Bank12:2660 (CODE_extobj_handler_flower_blossom_family); single-cell CODE_12C3FF (variant 1) | Flower decoration variant 1.
!Define_YI_ExtObjCC_FlowerBlossom2 = $CC	; Init Bank12:2660 (CODE_extobj_handler_flower_blossom_family); single-cell CODE_12C3FF (variant 2) | Flower decoration variant 2.
!Define_YI_ExtObjCD_FlowerBlossom3 = $CD	; Init Bank12:2660 (CODE_extobj_handler_flower_blossom_family); single-cell CODE_12C3FF (variant 3) | Flower decoration variant 3.
!Define_YI_ExtObjCE_FlowerBlossom4 = $CE	; Init Bank12:2660 (CODE_extobj_handler_flower_blossom_family); single-cell CODE_12C3FF (variant 4) | Flower decoration variant 4.
!Define_YI_ExtObjCF_FlowerBlossom5 = $CF	; Init Bank12:2660 (CODE_extobj_handler_flower_blossom_family); single-cell CODE_12C3FF (variant 5) | Flower decoration variant 5.
!Define_YI_ExtObjD0_FlowerBlossom6 = $D0	; Init Bank12:2660 (CODE_extobj_handler_flower_blossom_family); single-cell CODE_12C3FF (variant 6) | Flower decoration variant 6.
!Define_YI_ExtObjD1_FlowerBlossom7 = $D1	; Init Bank12:2660 (CODE_extobj_handler_flower_blossom_family); single-cell CODE_12C3FF (variant 7) | Flower decoration variant 7.
!Define_YI_ExtObjD2_FlowerBlossom8 = $D2	; Init Bank12:2660 (CODE_extobj_handler_flower_blossom_family); single-cell CODE_12C3FF (variant 8) | Flower decoration variant 8.
!Define_YI_ExtObjD3_FlowerBlossom9 = $D3	; Init Bank12:2660 (CODE_extobj_handler_flower_blossom_family); single-cell CODE_12C3FF (variant 9) | Flower decoration variant 9.

;-----------------------------------------------------------------------------------------------
; $D4-$DF: Flower-rock-art family (CODE_extobj_handler_flower_rock_art_family shared by 12 IDs)
; $15 - $D4 selects variant. $2A from DATA_12911F (12 entries: 5,5,5,3,3,5,5,5,3,3,7,7) and
; $2E from DATA_12912B (12 entries: 5,5,6,4,3,5,5,6,4,3,6,6). Per-cell stamper CODE_12C690.
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjD4_FlowerRockArt0 = $D4	; Init Bank12:2677 (CODE_extobj_handler_flower_rock_art_family); per-cell CODE_12C690 (variant 0; 5x5) | Flower-rock wall-art variant 0.
!Define_YI_ExtObjD5_FlowerRockArt1 = $D5	; Init Bank12:2677 (CODE_extobj_handler_flower_rock_art_family); per-cell CODE_12C690 (variant 1; 5x5) | Flower-rock wall-art variant 1.
!Define_YI_ExtObjD6_FlowerRockArt2 = $D6	; Init Bank12:2677 (CODE_extobj_handler_flower_rock_art_family); per-cell CODE_12C690 (variant 2; 5x6) | Flower-rock wall-art variant 2.
!Define_YI_ExtObjD7_FlowerRockArt3 = $D7	; Init Bank12:2677 (CODE_extobj_handler_flower_rock_art_family); per-cell CODE_12C690 (variant 3; 3x4) | Flower-rock wall-art variant 3.
!Define_YI_ExtObjD8_FlowerRockArt4 = $D8	; Init Bank12:2677 (CODE_extobj_handler_flower_rock_art_family); per-cell CODE_12C690 (variant 4; 3x3) | Flower-rock wall-art variant 4.
!Define_YI_ExtObjD9_FlowerRockArt5 = $D9	; Init Bank12:2677 (CODE_extobj_handler_flower_rock_art_family); per-cell CODE_12C690 (variant 5; 5x5) | Flower-rock wall-art variant 5.
!Define_YI_ExtObjDA_FlowerRockArt6 = $DA	; Init Bank12:2677 (CODE_extobj_handler_flower_rock_art_family); per-cell CODE_12C690 (variant 6; 5x5) | Flower-rock wall-art variant 6.
!Define_YI_ExtObjDB_FlowerRockArt7 = $DB	; Init Bank12:2677 (CODE_extobj_handler_flower_rock_art_family); per-cell CODE_12C690 (variant 7; 5x6) | Flower-rock wall-art variant 7.
!Define_YI_ExtObjDC_FlowerRockArt8 = $DC	; Init Bank12:2677 (CODE_extobj_handler_flower_rock_art_family); per-cell CODE_12C690 (variant 8; 3x4) | Flower-rock wall-art variant 8.
!Define_YI_ExtObjDD_FlowerRockArt9 = $DD	; Init Bank12:2677 (CODE_extobj_handler_flower_rock_art_family); per-cell CODE_12C690 (variant 9; 3x3) | Flower-rock wall-art variant 9.
!Define_YI_ExtObjDE_FlowerRockArt10 = $DE	; Init Bank12:2677 (CODE_extobj_handler_flower_rock_art_family); per-cell CODE_12C690 (variant A; 7x6) | Flower-rock wall-art variant 10.
!Define_YI_ExtObjDF_FlowerRockArt11 = $DF	; Init Bank12:2677 (CODE_extobj_handler_flower_rock_art_family); per-cell CODE_12C690 (variant B; 7x6) | Flower-rock wall-art variant 11.

;-----------------------------------------------------------------------------------------------
; $E0: Lava-locked pipe
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjE0_Pipe3DKeyPaint = $E0	; Init Bank12 CODE_extobj_handler_pipe_3d_key | 3D pipe entrance with a key painted on it.

;-----------------------------------------------------------------------------------------------
; $E1-$FA: Vestigial / unused slots (dw $0000) -- 26 entries, no handler
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjE1_Unused = $E1	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjE2_Unused = $E2	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjE3_Unused = $E3	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjE4_Unused = $E4	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjE5_Unused = $E5	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjE6_Unused = $E6	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjE7_Unused = $E7	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjE8_Unused = $E8	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjE9_Unused = $E9	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjEA_Unused = $EA	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjEB_Unused = $EB	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjEC_Unused = $EC	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjED_Unused = $ED	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjEE_Unused = $EE	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjEF_Unused = $EF	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjF0_Unused = $F0	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjF1_Unused = $F1	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjF2_Unused = $F2	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjF3_Unused = $F3	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjF4_Unused = $F4	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjF5_Unused = $F5	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjF6_Unused = $F6	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjF7_Unused = $F7	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjF8_Unused = $F8	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjF9_Unused = $F9	; Unused dispatch slot (dw $0000) -- no handler.
!Define_YI_ExtObjFA_Unused = $FA	; Unused dispatch slot (dw $0000) -- no handler.

;-----------------------------------------------------------------------------------------------
; $FB-$FE: Action handlers (not tile stamps)
; These 4 IDs are dispatched through the same table but perform side-effect actions on the
; screen-exit / screen-page tables instead of stamping Map16 tiles. Common pattern: each handler
; just RTLs after touching $6CAA,x (the per-screen page map).
;-----------------------------------------------------------------------------------------------
!Define_YI_ExtObjFB_ScreenExitCopyAction = $FB	; Init Bank12:2704 (CODE_extobj_FB_copy_screen_exit) | ACTION: copy $6CAA,$1C -> $6CAA,$1B (duplicate screen-exit entry between two pages).
!Define_YI_ExtObjFC_NoOpAction = $FC	; Init Bank12:2711 (CODE_extobj_FC_vestigial_noop) | ACTION: pure RTL no-op (placeholder / vestigial action slot).
!Define_YI_ExtObjFD_ClearTileAction = $FD	; Init Bank12:2714 (CODE_extobj_FD_clear_map16_cell); single-cell via Bank12:CODE_extobj_stamp_clear_cell | ACTION: stamp tile $0000 (clear / empty tile) at the placed cell.
!Define_YI_ExtObjFE_BabyMarioFloatLimitAction = $FE	; Init Bank12:2721 (CODE_extobj_FE_set_babymario_float_limit) | ACTION: set bit 7 ($80) on $6CAA,$1C, the per-screen page-cache byte. Bit 7 is independent of the page-LRU (which masks it via AND #$3F) and flags "treat this screen as not-loaded". Read ONLY by the Baby Mario float limiter (CODE_06C281, main_baby_mario) -- which zeroes the lost-Baby bubble's speed there to cap its float -- plus a minor SuperFX render gate (CODE_0EFE7F). Scroll / item-memory / screen-exit all ignore bit 7.

; Note: ID $FF would index out of the 255-entry table; valid level streams never reference it.
; $FF is also the level-data stream END terminator after the leading $00 ext-marker is consumed.
