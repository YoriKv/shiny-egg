;#############################################################################################################
;# WRAM_LevelTemplateSlots.asm -- per-tileset Map16-ID template slots used by Bank13 cell-stamp
;#                                handlers for shape detection / fill ($0019DA-$001DFC).
;#
;# Populated at level-load time by init_per_tileset_template_slots (Bank10 CODE_109257),
;# which walks DATA_per_tileset_template_table (Bank4C DATA_4CD61A). For each record:
;#   db count : dw ram_slot_addr : dw anchor[0..F]            (35 bytes total)
;# the loader picks anchor[BG1TYP], then writes ANCHOR, ANCHOR+1, ANCHOR+2, ... into
;# `count` consecutive 16-bit WRAM slots starting at ram_slot_addr. So the slots are
;# grouped into "families" (one record per family); each family has a base anchor
;# slot followed by `count-1` successor slots whose values are the anchor+k.
;#
;# Slot defines below are NAMED FROM ACTUAL USAGE in Bank13 + Bank10. Most names come
;# from the floor-stamp handler chain CODE_bg_floor_left / CODE_bg_floor_right
;# (BG_FLOOR0/1) + CODE_floor_subcheck (FLOR_SUB) + CODE_bg_floor_subbody (BG_FLOORSB)
;# + CODE_bg_floor_random (FLOOR_RND); the rest are family-anchor placeholders.
;#
;# See also: docs/leveldataengine.md (Bank12/13 cell-stamp engine overview),
;#           yi/Banks/Bank13.asm header (PER-TILESET MAP16-ID TEMPLATE SLOTS section),
;#           ys_unit.asm + ys_unit.h + ys_bgsc.asm + ys_bgsc1.asm (cross-reference disassembly).
;#############################################################################################################

;-----------------------------------------------------------------------------
; Small structural families ($0019DA-$001A61). Each family has a base anchor
; the handler compares against for "is current tile in family X?" detection.
; Bank13 only touches the anchors (or near-anchor sub-slots) for these.
;-----------------------------------------------------------------------------

!RAM_YI_Level_TileTpl_Family0200_Anchor = $0019DA		; 4-slot family ($0019DA-$0019E1)
!RAM_YI_Level_TileTpl_Family0800_Anchor = $001A02		; 9-slot family ($001A02-$001A13); Bank13 also touches +$04, +$0A
!RAM_YI_Level_TileTpl_Family0A00_Anchor = $001A16		; 9-slot family ($001A16-$001A27); Bank13 also touches +$02, +$08
!RAM_YI_Level_TileTpl_Family0C00_Anchor = $001A2A		; 5-slot family ($001A2A-$001A33); Bank13 also touches +$02
!RAM_YI_Level_TileTpl_Family1000_Anchor = $001A50		; 6-slot family ($001A50-$001A5B); Bank13 also touches +$06
!RAM_YI_Level_TileTpl_Family1200_Anchor = $001A5E		; 1-slot family

;-----------------------------------------------------------------------------
; Large "structural page" family at $001A62 ($BF = 191 slots, $001A62-$001BDF).
; Used heavily as `dw` pointer entries in Bank13 tile-pointer tables (and via
; CMP.w $1A62 in 4 sites). Specific semantics of sub-slots not yet mapped.
;-----------------------------------------------------------------------------

!RAM_YI_Level_TileTpl_Family1B00_Anchor = $001A62

;-----------------------------------------------------------------------------
; Wide/big-floor template page ($001BE0-$001C43, 50 slots). Used by the
; CODE_wide_floor_*_fix / CODE_big_floor_*_fix sub-routines: when the
; current tile's page byte matches the family anchor, the handler remaps
; via DATA_13C194 / DATA_13C20F / DATA_13C311 / etc.
;-----------------------------------------------------------------------------

!RAM_YI_Level_TileTpl_WideFloorPage_Anchor = $001BE0

;-----------------------------------------------------------------------------
; Floor top-row template family ($001C5C-$001C79, 15 slots = family 2A00).
; The first two slots are the "top row" tile (one row above flat-floor body)
; for the left and right variants of a multi-row floor object.
;-----------------------------------------------------------------------------

!RAM_YI_Level_TileTpl_FloorRow0_LeftLo = $001C5C		; FLOOR0DT[0] = top-row tile, left variant
!RAM_YI_Level_TileTpl_FloorRow0_RightLo = $001C5E		; FLOOR1DT[0] = top-row tile, right variant

;-----------------------------------------------------------------------------
; Horizontal bouncing-post template family ($001C7A-$001C91, 12 slots).
; The anchor is the "this object's own page" check used by
; CODE_post_horizontal_3section (T/YBOUST).
;-----------------------------------------------------------------------------

!RAM_YI_Level_TileTpl_HorizPost_PageAnchor = $001C7A

;-----------------------------------------------------------------------------
; Flat-floor template family ($001C92-$001D11, 64 slots = family 3900).
; The anchor + slope-cap markers + per-row body tiles + "no-seam" check tiles
; collectively drive floor-shape detection and fill for the most common
; floor objects in YI. Slots referenced by Bank13 floor handlers:
;
;   Anchor ($1C92, slot $00)
;       Page-level check: "is current tile in the flat-floor family?"
;       Used by CODE_bg_floor_left / CODE_bg_floor_right (BG_FLOOR0/1).
;   Slope-cap markers ($1CA0/$1CA2, slots $07/$08)
;       Tile-above check: CODE_floor_subcheck (FLOR_SUB) bumps Y if the tile
;       above the cursor matches one of these "slope coming down onto floor"
;       cap tiles -- so the floor row 3 pattern continues without wrapping.
;       Also reused as the row-1 fill in CODE_bg_floor_subbody (FLORSB) when
;       the current cell is already in the flat-floor family.
;   Body row tiles ($1CB6/B8/BA/BC/C2/C4, slots $12/$13/$14/$15/$18/$19)
;       Row-1/2/3 left/right fill tiles (FLOOR0DT[1..3] / FLOOR1DT[1..3]
;       and FLORSB0DT[2..3] / FLORSB1DT[2..3]).
;   "No-seam" fix-up ($1CD4/D6 + $1CFE/D00, slots $21/$22 + $36/$37)
;       CODE_bg_floor_subbody picks an alternate anchor based on the
;       column-parity byte $28 and a tile-self check, so adjacent floor
;       cells visually align without producing a seam at the boundary.
;   Random-variant bounds ($1CF4/F6, slots $31/$32)
;       CODE_bg_floor_random short-circuits if the current tile is already
;       in the random-variant range; otherwise picks one of 8 grass tiles.
;-----------------------------------------------------------------------------

!RAM_YI_Level_TileTpl_FlatFloor_PageAnchor = $001C92		; family page anchor (slot $00)
!RAM_YI_Level_TileTpl_FlatFloor_SlopeCapLeftLo = $001CA0	; slot $07; FLOR_SUB cap-detect L + FLORSB row-1 L
!RAM_YI_Level_TileTpl_FlatFloor_SlopeCapRightLo = $001CA2	; slot $08; FLOR_SUB cap-detect R + FLORSB row-1 R
!RAM_YI_Level_TileTpl_FlatFloor_Row1LeftLo = $001CB6		; slot $12; FLOOR0DT[1] body row 1 L
!RAM_YI_Level_TileTpl_FlatFloor_Row1RightLo = $001CB8		; slot $13; FLOOR1DT[1] body row 1 R
!RAM_YI_Level_TileTpl_FlatFloor_Row2LeftLo = $001CBA		; slot $14; FLOOR0DT[2] body row 2 L
!RAM_YI_Level_TileTpl_FlatFloor_Row2RightLo = $001CBC		; slot $15; FLOOR1DT[2] body row 2 R
!RAM_YI_Level_TileTpl_FlatFloor_Row3LeftLo = $001CC2		; slot $18; FLOOR0DT[3] body row 3 L
!RAM_YI_Level_TileTpl_FlatFloor_Row3RightLo = $001CC4		; slot $19; FLOOR1DT[3] body row 3 R
!RAM_YI_Level_TileTpl_FlatFloor_NoSeamCheckA = $001CD4		; slot $21; CODE_bg_floor_subbody $28!=0 path tile-self check
!RAM_YI_Level_TileTpl_FlatFloor_NoSeamCheckB = $001CD6		; slot $22; CODE_bg_floor_subbody $28=0  path tile-self check
!RAM_YI_Level_TileTpl_FlatFloor_RndBoundA = $001CF4		; slot $31; CODE_bg_floor_random lower bound
!RAM_YI_Level_TileTpl_FlatFloor_RndBoundB = $001CF6		; slot $32; CODE_bg_floor_random upper bound
!RAM_YI_Level_TileTpl_FlatFloor_NoSeamAnchorA = $001CFE		; slot $36; CODE_bg_floor_subbody alt anchor for NoSeamCheckA match
!RAM_YI_Level_TileTpl_FlatFloor_NoSeamAnchorB = $001D00		; slot $37; CODE_bg_floor_subbody alt anchor for NoSeamCheckB match

; Floor-random adjacency-fix slots (CODE_bg_floor_random + CODE_138131 subset).
; The random-grass picker re-probes neighbours and, if it finds an already-
; stamped random tile, replaces it with a "joined" variant. These slots
; participate in that fix-up:
;   *RndProbeAnchorR/L:  result-slot loaded as a pointer when the right- or
;                        left-neighbour probe matches RndAdjMatch.
;   *RndAdjMatch:        the canonical "random-grass center" tile that gets
;                        compared against to detect the neighbour kind.
;   *RndSelfMarkA/B:     "I am already a random tile" self-check slots; if
;                        the current cell is already one of these, the
;                        random picker leaves it alone.
!RAM_YI_Level_TileTpl_FlatFloor_RndProbeAnchorR = $001CA8	; slot $0B
!RAM_YI_Level_TileTpl_FlatFloor_RndProbeAnchorL = $001CAA	; slot $0C
!RAM_YI_Level_TileTpl_FlatFloor_RndAdjMatch = $001CAC		; slot $0D
!RAM_YI_Level_TileTpl_FlatFloor_RndSelfMarkA = $001CCA		; slot $1C
!RAM_YI_Level_TileTpl_FlatFloor_RndSelfMarkB = $001CCC		; slot $1D

;-----------------------------------------------------------------------------
; Trailing template families ($001D12-$001DFC). Heavy use of family $6800
; at $001D8A (20-slot family); other families are smaller. Specific
; sub-slot semantics not yet mapped.
;-----------------------------------------------------------------------------

!RAM_YI_Level_TileTpl_Family6800_Anchor = $001D8A		; 20-slot family ($001D8A-$001DB1); Bank13 also touches slots 1..18
