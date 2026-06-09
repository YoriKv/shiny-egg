;#############################################################################################################
;# Bank13.asm -- bank $13 level-data engine, part 2: per-cell Map16 stamp handlers
;#               + small intra-handler helpers + cinema-yoshi path data tables.
;#
;# Bank $13 is a direct continuation of Bank $12's level-data engine. The whole 64 KB (minus the
;# cinema tables at the tail and the trailing freespace/garbage pad) is ONE giant collection of
;# per-cell "stamp this shape into the Map16 buffer" handlers -- the BODIES that get dispatched
;# into from Bank $12's walker setup trampoline (CODE_walker_setup_trampoline) when an init handler hands off
;# control. Each cell of the object's bounding rectangle calls one of these.
;#
;# First-block routine roles (CODE_bg_floor_left family):
;#       CODE_bg_floor_left = CODE_bg_floor_left      (BG left set -- floor tile, left variant)
;#       CODE_bg_floor_left_alt = CODE_bg_floor_left_alt  (left variant "default" sub-branch)
;#       CODE_bg_floor_right = CODE_bg_floor_right     (BG right set -- floor tile, right variant)
;#       CODE_bg_floor_end = CODE_bg_floor_end       (common epilogue for both variants)
;#       CODE_floor_subcheck = CODE_floor_subcheck     (above-tile shape check helper)
;#       CODE_bg_floor_subbody = CODE_bg_floor_subbody   (shape-aware fallback select)
;#       DATA_floor0_tiles = DATA_floor0_tiles       (left-variant tile-ID array)
;#       DATA_floor1_tiles = DATA_floor1_tiles       (right-variant tile-ID array)
;#
;# The ~600 anonymous CODE_13xxxx handlers between $138000 and ~$13FD00 collectively cover:
;#   FLOOR / WALL / SLOPE / TUNNEL / WATER / LAVA / VINE / PIPE / DECORATION / DOOR / SPIKE /
;#   CLOUD / LIFT / jungle floor / grass / flower / etc.
;#
;# Common handler shapes (recognisable patterns in this bank):
;#
;#   (1) "Variant-by-leftcheck" pattern (CODE_bg_floor_left family):
;#         REP #$30
;#         LDA $2C; ASL; TAY                ; Y = row*2 (index into per-row tile list)
;#         LDA $12; AND #$FF00              ; isolate current tile's page byte
;#         CMP $1C92                        ; matches "template A" reserved page?
;#         BEQ <use_alt_table>              ; yes -> use second tile variant table
;#         JSR <sub_check>                  ; shape-aware sub-check (modifies Y)
;#         LDA <tile_list_a>,y              ; pick tile from variant A
;#         BRA <stamp>
;#       <use_alt>:
;#         JSR <sub_check>                  ; same sub-check (modifies Y differently)
;#         LDA <tile_list_b>,y              ; or use template-aware list B
;#       <stamp>:
;#         TAY; LDA 0,y                     ; deref pointer-to-tile-ID
;#         LDX $1D; STA !LevelDataBuffer,x  ; store Map16 ID
;#         SEP #$30; RTL
;#
;#   (2) "Random-decoration" pattern:
;#         REP #$30
;#         JSL CODE_prng                  ; get random byte
;#         AND #$0007                       ; pick 0..7
;#         ASL; TAY
;#         LDA <random_tile_list>,y
;#         (then stamp like pattern 1)
;#
;#   (3) "Probe neighbour" pattern (slope continuation, pipe orientation):
;#         LDA $1B; STA $0E                 ; copy current pos -> probe pos
;#         JSL CODE_get_map16_left                  ; (or 128719/12875D/1287E2)
;#         LDA !LevelDataBuffer,x           ; what's the neighbour tile?
;#         CMP <reserved_tile_A>            ; matches expected shape?
;#         BEQ ...
;#
;# PER-TILESET MAP16-ID TEMPLATE SLOTS (WRAM): bank-$13 handlers extensively compare $12
;# (current tile) against fixed WRAM addresses $1C92, $1CA0, $1CA2, $1CAC, $1CAE, $1CB6,
;# $1CB8, $1CBA, $1CBC, $1CC2, $1CC4, $1CCA, $1CCC, $1CD4, $1CD6, $1CE4, $1CE8, $1CEA,
;# $1CF4, $1CF6, etc. These are slots in a sparse WRAM template table (~$19DA-$1DFC),
;# populated at level-load time by CODE_init_per_tileset_template_slots (Bank10
;# CODE_init_per_tileset_template_slots), driven by the level header's BG1 tileset byte
;# (!RAM_YI_Level_LevelHeaderBG1TilesetLo).
;#
;# Structure of the source data DATA_per_tileset_template_table (Bank4C
;# DATA_4CD61A): a sequence of records, each `db count : dw ram_slot_addr`
;# followed by 16 16-bit "anchor" Map16 IDs (one per BG1 tileset index 0-F).
;# The loader picks anchor[BG1TYP], then fills `count` consecutive 16-bit WRAM
;# slots starting at ram_slot_addr with ANCHOR, ANCHOR+1, ANCHOR+2, ...
;#
;# So every slot in this region is the (k)th sequential Map16 ID of some
;# "unit family" anchored at the slot's record. The handler-side comparisons
;# decide "is the current tile in family F, sub-variant k?" where the
;# physical Map16 IDs vary per tileset. Examples:
;#   $1C92 -- first slot of the 64-slot "$3900" family (flat-floor centers).
;#            For BG1TYP=$00 the slot holds $3E00; for BG1TYP=$01 it holds
;#            $3900; etc. The name "type 3900" sometimes used in comments
;#            below refers to this family's canonical Map16 page, not to
;#            any value stored at the slot itself.
;#   $1CA0 -- 8th sequential slot of the same "$3900" family (slope variant).
;#   $1C5C/$1C5E -- first two slots of the 15-slot "$2A00" family
;#            (referenced literally as `dw !RAM_YI_Level_TileTpl_FloorRow0_LeftLo, $1C5E` in DATA_floor0_tiles
;#            and DATA_floor1_tiles: handlers DEREFERENCE these slot
;#            addresses to fetch the per-tileset Map16 ID).
;#   $1BE0 -- 50-slot "$1B00" family used as the "this object's own page"
;#            check in big/wide-floor edge handlers.
;#
;# Zero-page contract (same as Bank $12's walker):
;#   $0E/$0F        = scratch Map16 position (handler copies $1B/$1C here before probing)
;#   $1B/$1C        = current Map16 position (set by walker)
;#   $12            = current tile's Map16 number
;#   $1D            = current Map16 index in !RAM_YI_Level_LevelDataBuffer
;#   $2A, $2C/$2E   = column counter / row counter / row-extent
;#   $15            = per-object orientation byte (init handler set it)
;#
;# Helper routines called extensively across this bank (counts are JSL.l
;# sites IN BANK13; the same primitives also have callers inside Bank12):
;#   CODE_get_current_map16_tile  Bank12 CODE_get_current_map16_tile         JSR.w (rare)
;#   CODE_get_map16_above  Bank12 CODE_get_map16_above                JSL.l (44 sites)
;#   CODE_get_map16_below  Bank12 CODE_get_map16_below                JSL.l (42 sites)
;#   CODE_get_map16_left  Bank12 CODE_get_map16_left                 JSL.l (15 sites)
;#   CODE_get_map16_right  Bank12 CODE_get_map16_right                JSL.l (13 sites)
;#   CODE_prng  Bank12 PRNG / get_random_byte         JSL.l (50 sites)
;#   CODE_probe_left_tile  Bank13-local probe-left-and-fetch     JSR.w (sets $0E=$1B,
;#                                                      JSLs CODE_get_map16_left, reads
;#                                                      LevelDataBuffer,x -> A)
;#   CODE_probe_right_tile  Bank13-local probe-right-and-fetch    JSR.w (sets $0E=$1B,
;#                                                      JSLs CODE_get_map16_right, reads
;#                                                      LevelDataBuffer,x -> A)
;#
;# TAIL OF BANK -- the one piece of bank $13 with descriptive name:
;#   $13:FD99-$13:FDA4  DATA_yoshi_cinema_path_ptrs   -- 6 ptrs to per-world cinema paths
;#   $13:FDA5-$13:FE58  DATA_yoshi_cinema_path_data   -- 4-byte records (flags / X / Y / extra)
;#   $13:FE59+          garbage data (V1.1) or free-space pad (V1.0).
;#
;# Cross-references:
;#   docs/leveldataengine.md -- standalone engine reference describing the full pipeline
;#                                    (level pointer table -> Bank10 parser -> Bank12 dispatch
;#                                    -> Bank13 handlers).
;#   Bank12.asm header             -- describes the dispatch tables + walker that drive these
;#                                    handlers, plus the 5 Map16-fetch primitives at $1286FD/719/
;#                                    75D/7A1/7E2.
;#   Raidenthequick bank13.asm     -- ONLY the cinema-yoshi-path tables (at $13FD99/13FDA5) are
;#                                    annotated; everything else is anonymous. Raidenthequick
;#                                    documented this bank LEAST in the entire disassembly.
;#
;# See also (sibling reference files):
;#   ys_bgsc.asm     -- BG-scene root (object-realiser entry, dispatch shape)
;#   ys_bgsc0.asm    -- BG-scene variant 0 (small init-handler bodies)
;#   ys_bgsc1.asm    -- BG-scene variant 1 (the BIG per-cell stamp routines for floors,
;#                       walls, slopes, water, jungle, grass, etc. -- the direct parallels of
;#                       this bank's ~600 CODE_13xxxx handlers)
;#   ys_bgsc2.asm    -- BG-scene variant 2 (cell-fetch + stamp helpers, parallels
;#                       Bank12 Map16-fetch primitives + this bank's CODE_probe_left_tile/61)
;#############################################################################################################
macro YIBank13Macros(StartBank, EndBank)
%BANK_START(<StartBank>)

;=========================================================================
; FIRST PER-CELL HANDLER PAIR: CODE_bg_floor_left / CODE_bg_floor_right
; See also: ys_bgsc1.asm (BG-floor stamp parallels in the reference tree).
;
; Routine roles:
;   CODE_bg_floor_left = CODE_bg_floor_left      ("BG left set"  -- floor tile, left edge)
;   CODE_bg_floor_right = CODE_bg_floor_right     ("BG right set" -- floor tile, right edge)
;   CODE_bg_floor_end = CODE_bg_floor_end       (common epilogue, deref + stamp)
;   CODE_floor_subcheck = CODE_floor_subcheck     ("above tile" shape check helper)
;   CODE_bg_floor_subbody = CODE_bg_floor_subbody   (shape-aware tile select)
;   DATA_floor0_tiles = DATA_floor0_tiles       (left-variant 4-entry tile-ID array)
;   DATA_floor1_tiles = DATA_floor1_tiles       (right-variant 4-entry tile-ID array)
;
; Both handlers select 1 of 4 tile IDs based on the row position within
; the object ($2C) and whether the tile underneath ($12) already matches
; the flat-floor template slot at $1C92 (a level-load-time-computed
; Map16 ID for the current tileset's flat-floor-center family; see the
; "PER-TILESET MAP16-ID TEMPLATE SLOTS" section at the top of this
; file). This is how the engine extends floor objects horizontally
; without producing visible seams between adjacent floor tiles.
;
; INPUTS (standard per-cell handler contract):
;   $1B/$1C  current cell coords (set by walker)
;   $1D      buffer offset to stamp at
;   $12      current Map16 ID at that offset (read by walker via CODE_get_current_map16_tile)
;   $2C      row position within object (0..$2E-1)
;
; OUTPUTS:
;   !RAM_YI_Level_LevelDataBuffer[$1D] := selected Map16 ID
;
; MODIFIES: A/X/Y returned 8-bit.
;=========================================================================
CODE_138000:
CODE_bg_floor_left:                                              ; descriptive alias
	REP.b #$30
	LDA.b $2C
	ASL
	TAY                                                       ; Y = row*2 (offset into 4-entry tile table)
	LDA.b $12
	AND.w #$FF00                                              ; isolate page byte of current tile
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_PageAnchor                                               ; matches flat-floor family?
	BEQ.b CODE_bg_floor_left_alt                                         ; yes -> use shape-aware fallback
	JSR.w CODE_floor_subcheck                                         ; FLOR_SUB: maybe-bump Y by 2
	LDA.w DATA_floor0_tiles,y                                       ; pick left-variant tile pointer
	BRA.b CODE_bg_floor_end

CODE_138018:
CODE_bg_floor_left_alt:                                          ; descriptive alias
	JSR.w CODE_bg_floor_subbody                                         ; BG_FLOORSB shape-aware select
	BRA.b CODE_bg_floor_end

CODE_13801D:
CODE_bg_floor_right:                                             ; descriptive alias
	REP.b #$30
	LDA.b $2C
	ASL
	TAY
	LDA.b $12
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_PageAnchor
	BEQ.b CODE_bg_floor_right_alt
	JSR.w CODE_floor_subcheck
	LDA.w DATA_floor1_tiles,y                                       ; pick right-variant tile pointer
	BRA.b CODE_bg_floor_end

CODE_138035:
CODE_bg_floor_right_alt:                                         ; descriptive alias
	JSR.w CODE_bg_floor_subbody
CODE_138038:
CODE_bg_floor_end:                                               ; descriptive alias
	TAY                                                       ; A from prior step = tile-ptr
	LDA.w $0000,y                                             ; deref -> Map16 ID
	LDX.b $1D                                                 ; X = buffer offset
	STA.l !RAM_YI_Level_LevelDataBuffer,x                     ; stamp
	SEP.b #$30
	RTL

DATA_138045:
DATA_floor0_tiles:                                               ; descriptive alias
	dw !RAM_YI_Level_TileTpl_FloorRow0_LeftLo,!RAM_YI_Level_TileTpl_FlatFloor_Row1LeftLo,!RAM_YI_Level_TileTpl_FlatFloor_Row2LeftLo,!RAM_YI_Level_TileTpl_FlatFloor_Row3LeftLo                                ; row 0..3 tile pointers (left variant)

DATA_13804D:
DATA_floor1_tiles:                                               ; descriptive alias
	dw !RAM_YI_Level_TileTpl_FloorRow0_RightLo,!RAM_YI_Level_TileTpl_FlatFloor_Row1RightLo,!RAM_YI_Level_TileTpl_FlatFloor_Row2RightLo,!RAM_YI_Level_TileTpl_FlatFloor_Row3RightLo                                ; row 0..3 tile pointers (right variant)

;-------------------------------------------------------------------------
; CODE_floor_subcheck -- FLOR_SUB (floor sub-check): if Y == 4 (we're at end of
; tile array) and the tile above matches a slope template, bump Y by 2
; so the caller picks the "slope continuation" tile rather than wrapping.
;
; INPUTS:  Y (row index already shifted), $1B (current pos)
; OUTPUTS: Y possibly bumped by 2
; MODIFIES: $0E, X
;-------------------------------------------------------------------------
CODE_138055:
CODE_floor_subcheck:                                             ; descriptive alias
	CPY.w #$0004
	BNE.b CODE_floor_subcheck_done
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above                                         ; probe tile above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_SlopeCapLeftLo
	BEQ.b CODE_floor_subcheck_bump
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_SlopeCapRightLo
	BNE.b CODE_floor_subcheck_done
CODE_138070:
CODE_floor_subcheck_bump:                                        ; descriptive alias
	INY
	INY
CODE_138072:
CODE_floor_subcheck_done:                                        ; descriptive alias
	RTS

;-------------------------------------------------------------------------
; CODE_bg_floor_subbody -- BG_FLOORSB (floor sub-body): when the current tile
; already matches the flat-floor template slot at $1C92
; (CODE_bg_floor_left_alt / 138035 reached here), pick the appropriate
; tile based on column parity ($28) and whether the cell to the side
; matches further template slots ($1CD4/D6).
; This is the "no visible seam" shape-fix-up logic.
;-------------------------------------------------------------------------
CODE_138073:
CODE_bg_floor_subbody:                                           ; descriptive alias
	SEP.b #$20
	LDA.b $28
	BNE.b CODE_13808F
	REP.b #$20
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_NoSeamCheckB
	BNE.b CODE_138087
	LDA.w #!RAM_YI_Level_TileTpl_FlatFloor_NoSeamAnchorB
	BRA.b CODE_1380A3

CODE_138087:
	JSR.w CODE_floor_subcheck
	LDA.w DATA_1380A4,y
	BRA.b CODE_1380A3

CODE_13808F:
	REP.b #$20
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_NoSeamCheckA
	BNE.b CODE_13809D
	LDA.w #!RAM_YI_Level_TileTpl_FlatFloor_NoSeamAnchorA
	BRA.b CODE_1380A3

CODE_13809D:
	JSR.w CODE_floor_subcheck
	LDA.w DATA_1380AC,y
CODE_1380A3:
	RTS

DATA_1380A4:
	dw $1CE6,!RAM_YI_Level_TileTpl_FlatFloor_SlopeCapLeftLo,!RAM_YI_Level_TileTpl_FlatFloor_Row2LeftLo,!RAM_YI_Level_TileTpl_FlatFloor_Row3LeftLo

DATA_1380AC:
	dw $1CE4,!RAM_YI_Level_TileTpl_FlatFloor_SlopeCapRightLo,!RAM_YI_Level_TileTpl_FlatFloor_Row2RightLo,!RAM_YI_Level_TileTpl_FlatFloor_Row3RightLo

;-------------------------------------------------------------------------
; CODE_bg_floor_random -- CODE_bg_floor_random: random-grass floor variant picker.
; Parallels ys_bgsc1.asm. Probes the current tile against the
; floor-edge templates ($1CF4/$1CF6, $1CD4/$1CE8 bounds); if it's already
; inside a known floor shape, leaves it alone (jumps to RTL). Otherwise
; picks one of 8 random-grass variants from DATA_floor_random_grass_8way_pool weighted by the
; random byte from CODE_prng.
;-------------------------------------------------------------------------
CODE_1380B4:
CODE_bg_floor_random:                                            ; descriptive alias
	REP.b #$30
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndBoundA
	BEQ.b CODE_13811E
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndBoundB
	BEQ.b CODE_13811E
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_NoSeamCheckA
	BCC.b CODE_1380CC
	CMP.w $1CE8
	BCC.b CODE_13811E
CODE_1380CC:
	LDA.b $1B
	STA.b $0E
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_138105
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_Row1LeftLo
	BEQ.b CODE_1380F9
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_Row1RightLo
	BEQ.b CODE_1380F9
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_Row3LeftLo
	BEQ.b CODE_13811E
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_Row3RightLo
	BEQ.b CODE_13811E
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndSelfMarkA
	BEQ.b CODE_13811E
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndSelfMarkB
	BEQ.b CODE_13811E
	BRA.b CODE_138105

CODE_1380F9:
	LDA.w #!RAM_YI_Level_TileTpl_FlatFloor_RndAdjMatch
	STA.b $02
	JSR.w CODE_bg_floor_random_slope_cap
	LDY.b $02
	BRA.b CODE_138115

CODE_138105:
	JSR.w CODE_bg_floor_random_seam_fix
	JSL.l CODE_prng
	AND.w #$0007
	ASL
	TAY
	LDA.w DATA_floor_random_grass_8way_pool,y
	TAY
CODE_138115:
	LDX.b $1D
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13811E:
	SEP.b #$30
	RTL

DATA_138121:
DATA_floor_random_grass_8way_pool:
	dw $1CAE,$1CB0,$1CB2,$1CB4,$1CE8,$1CEA,$1CAE,$1CB0

CODE_138131:
CODE_bg_floor_random_seam_fix:
	JSL.l CODE_get_map16_left
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndAdjMatch
	BNE.b CODE_138154
	LDA.w !RAM_YI_Level_TileTpl_FlatFloor_RndSelfMarkA
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.w $1CC4
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_138154:
	JSR.w CODE_probe_right_tile
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndAdjMatch
	BNE.b CODE_13816E
	LDA.w !RAM_YI_Level_TileTpl_FlatFloor_RndSelfMarkB
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSL.l CODE_get_map16_below
	LDA.w $1CC2
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13816E:
	RTS

CODE_13816F:
CODE_bg_floor_random_slope_cap:
	JSL.l CODE_get_map16_left
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w $1CE8
	BEQ.b CODE_13818B
	CMP.w $1CEA
	BEQ.b CODE_13818B
	CMP.w $1CAE
	BCC.b CODE_13819F
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_Row1LeftLo
	BCS.b CODE_13819F
CODE_13818B:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.w $1CC2
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.w #!RAM_YI_Level_TileTpl_FlatFloor_RndSelfMarkB
	BRA.b CODE_1381C8

CODE_13819F:
	JSR.w CODE_probe_right_tile
	CMP.w $1CE8
	BEQ.b CODE_1381B6
	CMP.w $1CEA
	BEQ.b CODE_1381B6
	CMP.w $1CAE
	BCC.b CODE_bg_floor_random_probe_exit
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_Row1LeftLo
	BCS.b CODE_bg_floor_random_probe_exit
CODE_1381B6:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.w $1CC4
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.w #!RAM_YI_Level_TileTpl_FlatFloor_RndSelfMarkA
CODE_1381C8:
	STA.b $02
CODE_1381CA:
CODE_bg_floor_random_probe_exit:
	RTS

;-------------------------------------------------------------------------
; CODE_floor_edge_left_right -- CODE_floor_edge_left_right: left/right floor edge stamp.
; Parallels ys_bgsc1.asm (the two labels are aliases
; for the same body; orientation byte $15 bit 0 selects left vs right).
; Indexes DATA_floor_edge_lr_tile_lut by a packed key built from
; ($15 bit 0) * 2 + $28 + $2C * 4 to pick the correct edge tile.
;-------------------------------------------------------------------------
CODE_1381CB:
CODE_floor_edge_left_right:                                      ; descriptive alias
	REP.b #$30
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_1381DC
	LDA.b $2C
	BNE.b CODE_1381DC
	LDA.b $A1
	STA.b $2E
CODE_1381DC:
	LDA.b $15
	AND.w #$0001
	ASL
	ORA.b $28
	STA.b $00
	LDA.b $2C
	ASL
	ASL
	ORA.b $00
	ASL
	TAY
	LDX.w DATA_floor_edge_lr_tile_lut,y
	BEQ.b CODE_138214
	CPY.w #$0010
	BCC.b CODE_13820B
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_138204
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BNE.b CODE_138208
CODE_138204:
	INY
	INY
	INY
	INY
CODE_138208:
	LDX.w DATA_floor_edge_lr_tile_lut,y
CODE_13820B:
	LDA.w $0000,x
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_138214:
	SEP.b #$30
	RTL

DATA_138217:
DATA_floor_edge_lr_tile_lut:
	dw $1D12,!RAM_YI_Level_TileTpl_FloorRow0_RightLo,!RAM_YI_Level_TileTpl_FloorRow0_RightLo,$1D14,$1D16,$1CD0,$1CD2,$1D18
	dw $0000,!RAM_YI_Level_TileTpl_FlatFloor_NoSeamCheckA,!RAM_YI_Level_TileTpl_FlatFloor_NoSeamCheckB,!RAM_YI_Level_TileTpl_FlatFloor_NoSeamAnchorA,!RAM_YI_Level_TileTpl_FlatFloor_NoSeamAnchorB

;-------------------------------------------------------------------------
; CODE_floor_edge_random_side -- CODE_floor_edge_random_side: random side-edge variant picker.
; Parallels ys_bgsc1.asm. Uses random byte to choose among
; 4 variants per side; checks neighbour above for slope-tops ($1CE8/EA)
; or grass ($1CAE..$1CB5) and may overwrite the neighbour with the
; appropriate continuation.
;-------------------------------------------------------------------------
CODE_138231:
CODE_floor_edge_random_side:                                     ; descriptive alias
	REP.b #$30
	JSL.l CODE_prng
	AND.w #$0003
	STA.b $00
	LDA.b $15
	AND.w #$0001
	STA.b $0A
	ASL
	ASL
	ORA.b $00
	ASL
	TAY
	LDA.w DATA_floor_edge_random_side_pool,y
	STA.b $00
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_floor_edge_random_side_pick_anchor
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BEQ.b CODE_floor_edge_random_side_pick_anchor
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndAdjMatch
	BEQ.b CODE_138269
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_Row1LeftLo
	BEQ.b CODE_138269
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_Row1RightLo
	BNE.b CODE_floor_edge_random_side_pick_var
CODE_138269:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_NoSeamAnchorA
	BEQ.b CODE_13828C
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_NoSeamAnchorB
	BEQ.b CODE_13828C
	LDA.b $15
	AND.w #$0001
	CLC
	ADC.w $1CE4
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13828C:
	LDA.b $1B
	STA.b $0E
	JSR.w CODE_floor_edge_random_side_seam
	BRA.b CODE_floor_edge_random_side_pick_var

CODE_138295:
CODE_floor_edge_random_side_pick_anchor:
	LDA.w $1CE4
	CLC
	ADC.b $0A
	BRA.b CODE_13829F

CODE_13829D:
CODE_floor_edge_random_side_pick_var:
	LDA.b ($00)
CODE_13829F:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_1382A8:
DATA_floor_edge_random_side_pool:
	dw $1CD8,$1CDC,$1CE0,$1CD8,$1CDA,$1CDE,$1CE2,$1CDA

CODE_1382B8:
CODE_floor_edge_random_side_seam:
	LDA.b $0A
	BNE.b CODE_1382E4
	JSL.l CODE_get_map16_right
	LDA.w #!RAM_YI_Level_TileTpl_FlatFloor_RndProbeAnchorR
	STA.b $00
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndAdjMatch
	BEQ.b CODE_13830A
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.w $1CC4
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.w #!RAM_YI_Level_TileTpl_FlatFloor_SlopeCapRightLo
	STA.b $00
	BRA.b CODE_13830A

CODE_1382E4:
	JSL.l CODE_get_map16_left
	LDA.w #!RAM_YI_Level_TileTpl_FlatFloor_RndProbeAnchorL
	STA.b $00
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndAdjMatch
	BEQ.b CODE_13830A
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.w $1CC2
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.w #!RAM_YI_Level_TileTpl_FlatFloor_SlopeCapLeftLo
	STA.b $00
CODE_13830A:
	RTS

DATA_13830B:
DATA_floor_slope_22deg_pick_dispatch:
	dw CODE_floor_slope_22deg_pick_right
	dw CODE_floor_slope_22deg_pick_left

;-------------------------------------------------------------------------
; CODE_floor_slope_22deg -- CODE_floor_slope_22deg: 22.5-degree floor slope stamp.
; Parallels ys_bgsc1.asm. If row >=4 falls back to the random
; floor stamp (CODE_bg_floor_random); otherwise dispatches via DATA_floor_slope_22deg_pick_dispatch to the
; left-rising (CODE_floor_slope_22deg_pick_left) or right-rising (CODE_floor_slope_22deg_pick_right) variant based
; on column parity, then stamps from the picked 4-word data table.
;-------------------------------------------------------------------------
CODE_13830F:
CODE_floor_slope_22deg:                                          ; descriptive alias
	REP.b #$30
	LDA.b $2C
	ASL
	TAY
	CPY.w #$0008
	BCC.b CODE_floor_slope_22deg_in_bounds
	JSL.l CODE_bg_floor_random
	BRA.b CODE_floor_slope_22deg_exit

CODE_138320:
CODE_floor_slope_22deg_in_bounds:
	STZ.b $9B
	LDA.b $28
	AND.w #$0001
	ASL
	TAX
	JSR.w (DATA_floor_slope_22deg_pick_dispatch,x)
	LDA.w $0000,x
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_138335:
CODE_floor_slope_22deg_exit:
	SEP.b #$30
	RTL

DATA_138338:
DATA_floor_slope_22deg_right_desc_slots:
	dw $1C60,$1A42,$1A60,$1CAE

DATA_138340:
DATA_floor_slope_22deg_right_asc_slots:
	dw $1C64,!RAM_YI_Level_TileTpl_Family0C00_Anchor,$1A40,!RAM_YI_Level_TileTpl_FlatFloor_Row3RightLo

CODE_138348:
CODE_floor_slope_22deg_pick_right:
	LDA.b $15
	BNE.b CODE_138351
	LDX.w DATA_floor_slope_22deg_right_desc_slots,y
	BRA.b CODE_138354

CODE_138351:
	LDX.w DATA_floor_slope_22deg_right_asc_slots,y
CODE_138354:
	RTS

DATA_138355:
DATA_floor_slope_22deg_left_desc_slots:                                    ; flavor: data (followed by dw); CODE_ name is a documentation bug
	dw $1C62,!RAM_YI_Level_TileTpl_Family1000_Anchor,$1A5C,!RAM_YI_Level_TileTpl_FlatFloor_Row3LeftLo

DATA_13835D:
DATA_floor_slope_22deg_left_asc_slots:                                    ; flavor: data (followed by dw); CODE_ name is a documentation bug
	dw $1C66,$1A34,!RAM_YI_Level_TileTpl_Family1200_Anchor,$1CB0

CODE_138365:
CODE_floor_slope_22deg_pick_left:
	INC.b $9B
	LDA.b $15
	BNE.b CODE_138370
	LDX.w DATA_floor_slope_22deg_left_desc_slots,y
	BRA.b CODE_138373

CODE_138370:
	LDX.w DATA_floor_slope_22deg_left_asc_slots,y
CODE_138373:
	RTS

;-------------------------------------------------------------------------
; CODE_floor_slope_45deg_up -- CODE_floor_slope_45deg_up: 45/67.5-degree up-rising floor.
; Parallels ys_bgsc1.asm. Decides "going up vs down" from
; orientation $15: <6 = going up (sets $9B=1), >=6 falls through into
; CODE_floor_slope_45deg_down (going down).
;-------------------------------------------------------------------------
CODE_138374:
CODE_floor_slope_45deg_up:                                       ; descriptive alias
	REP.b #$30
	STZ.b $9B
	LDA.b $15
	CMP.w #$0006
	BCS.b CODE_floor_slope_45deg_down
	INC.b $9B
	AND.w #$0001
	ASL
	ASL
	ORA.b $2C
	ASL
	TAY
	LDX.w DATA_138399,y
	LDA.w $0000,x
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_138399:
	dw $1C60,$1A42,$1A60,$0000,!RAM_YI_Level_TileTpl_Family0C00_Anchor,$1A40,!RAM_YI_Level_TileTpl_FlatFloor_Row3RightLo

;-------------------------------------------------------------------------
; CODE_floor_slope_45deg_down -- CODE_floor_slope_45deg_down: 45/67.5-degree down-going floor.
; Parallels ys_bgsc1.asm. Subtracts 4 from orientation,
; indexes DATA_1383D7 to pick one of 6 sub-tables
; (DATA_1383E3..DATA_138409),
; then stamps from the picked table indexed by row $2C * 2.
;-------------------------------------------------------------------------
CODE_1383A7:
CODE_floor_slope_45deg_down:                                     ; descriptive alias
	REP.b #$30
	STZ.b $9B
	LDA.b $15
	CMP.w #$0004
	BEQ.b CODE_1383B9
	CMP.w #$0005
	BEQ.b CODE_1383B9
	INC.b $9B
CODE_1383B9:
	DEC
	DEC
	DEC
	DEC
	ASL
	TAX
	LDA.w DATA_1383D7,x
	STA.b $00
	LDA.b $2C
	ASL
	TAY
	LDX.b $1D
	LDA.b ($00),y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_1383D7:
	dw DATA_1383E3,DATA_1383FB,DATA_1383E9,DATA_138401,DATA_1383F1,DATA_138409

DATA_1383E3:
	dw !RAM_YI_Level_TileTpl_Family1000_Anchor,$1A5C,!RAM_YI_Level_TileTpl_FlatFloor_Row3LeftLo

DATA_1383E9:
	dw $1C6A,!RAM_YI_Level_TileTpl_Family0A00_Anchor,$1A28,$1CBE

DATA_1383F1:
	dw $1C6C,$19EE,$19F6,$1A00,$1CEC

DATA_1383FB:
	dw $1C66,$1A34,!RAM_YI_Level_TileTpl_Family1200_Anchor

DATA_138401:
	dw $1C68,!RAM_YI_Level_TileTpl_Family0800_Anchor,$1A14,$1CC0

DATA_138409:
	dw $1C6E,!RAM_YI_Level_TileTpl_Family0200_Anchor,$19E2,$19EC,$1CEE

;-------------------------------------------------------------------------
; CODE_wall_left_right -- CODE_wall_left_right: vertical wall left/right edge stamp.
; Parallels ys_bgsc1.asm (left and right wall, one
; shared body; orientation $15 bit 0 picks side). 2-entry data table
; DATA_wall_left_right_tiles at $1CA4/$1CA6.
;-------------------------------------------------------------------------
CODE_138413:
CODE_wall_left_right:                                            ; descriptive alias
	REP.b #$30
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDX.b $1D
	LDA.w DATA_wall_left_right_tiles,y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13842C:
DATA_wall_left_right_tiles:                                      ; descriptive alias
	dw $1CA4,$1CA6

;-------------------------------------------------------------------------
; CODE_post_vertical_3section -- CODE_post_vertical_3section: vertical post / stake stamp.
; Parallels ys_bgsc1.asm (top / center / bottom of a vertical
; bouncing-post element). Selects one of three 4-entry tile tables
; (DATA_138458 / DATA_138460 / DATA_138468) based on whether row $2C is
; top, middle, or bottom of the object's extent $2E.
;-------------------------------------------------------------------------
CODE_138430:
CODE_post_vertical_3section:                                     ; descriptive alias
	REP.b #$30
	LDX.b $1D
	LDA.b $15
	AND.w #$0003
	ASL
	TAY
	LDA.b $2C
	BEQ.b CODE_138449
	INC
	CMP.b $2E
	BEQ.b CODE_13844E
	LDA.w DATA_138458,y
	BRA.b CODE_138451

CODE_138449:
	LDA.w DATA_138460,y
	BRA.b CODE_138451

CODE_13844E:
	LDA.w DATA_138468,y
CODE_138451:
	TAY
	LDA.w $0000,y
	JMP.w CODE_post_horizontal_3section_store

DATA_138458:
	dw $1DD0,$0000,DATA_138476,DATA_138474

DATA_138460:
	dw $1DCE,$0000,DATA_138472,DATA_138470

DATA_138468:
	dw $1DD2,$0000,$1C72,$1C70

DATA_138470:
	dw $0090

DATA_138472:
	dw $0091

DATA_138474:
	dw $0094

DATA_138476:
	dw $0095

;-------------------------------------------------------------------------
; CODE_post_horizontal_3section -- CODE_post_horizontal_3section: horizontal bouncing-post stamp.
; Parallels ys_bgsc1.asm (left / center / right of a horizontal
; trampoline-bar element). Picks tile by checking current page against
; template slots $1C7A ("$3800" family, this object's own anchor)
; and $1C92 ("$3900" family, flat-floor anchor).
;-------------------------------------------------------------------------
CODE_138478:
CODE_post_horizontal_3section:                                   ; descriptive alias
	REP.b #$30
	LDA.b $12
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_HorizPost_PageAnchor
	BEQ.b CODE_13848D
	LDA.b $28
	BEQ.b CODE_138492
	INC
	CMP.b $2A
	BEQ.b CODE_1384A6
CODE_13848D:
	LDA.w $1C7C
	BRA.b CODE_post_horizontal_3section_store

CODE_138492:
	LDA.b $12
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_PageAnchor
	BNE.b CODE_1384A1
	LDA.w $1C9A
	BRA.b CODE_post_horizontal_3section_store

CODE_1384A1:
	LDA.w $1C7A
	BRA.b CODE_post_horizontal_3section_store

CODE_1384A6:
	LDA.b $12
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_PageAnchor
	BNE.b CODE_1384B5
	LDA.w $1C98
	BRA.b CODE_post_horizontal_3section_store

CODE_1384B5:
	LDA.w $1C7E
CODE_1384B8:
CODE_post_horizontal_3section_store:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_1384C1:
	dw $009C,$009B,$009A,$0000

DATA_1384C9:
	dw $0093,$0092

DATA_1384CD:
	dw $009D,$009E,$009F,$0000

DATA_1384D5:
	dw $0092,$0093

DATA_1384D9:
	dw $0001,$FFFF

DATA_1384DD:
	dw $8000,$0000

;-------------------------------------------------------------------------
; CODE_lift_track_30deg -- CODE_lift_track_30deg: 30-degree moving-platform rail stamp.
; Parallels ys_bgsc1.asm (the rail/track tile pattern for 30-deg
; lifts). Builds an index from object orientation ($2A sign flag),
; column parity, position-within-extent (start / middle / end), and
; current cell's row $2C to pick one of 12 tile templates spanning
; DATA_1384C1..DATA_1384D5 (split tables).
; Direction control: DATA_1384D9 = $0001,$FFFF.
; Down flag table: DATA_1384DD = $8000,$0000.
;-------------------------------------------------------------------------
CODE_1384E1:
CODE_lift_track_30deg:                                           ; descriptive alias
	REP.b #$30
	LDY.w #$0000
	LDA.b $2A
	BPL.b CODE_1384EC
	INY
	INY
CODE_1384EC:
	LDA.b $28
	AND.w #$0001
	ASL
	STA.b $00
	TAX
	LDA.b $28
	BEQ.b CODE_138501
	CLC
	ADC.w DATA_1384D9,y
	CMP.b $2A
	BNE.b CODE_138521
CODE_138501:
	LDA.b $2C
	BNE.b CODE_138546
	LDA.b $12
	CMP.w #$00B4
	BEQ.b CODE_138511
	CMP.w #$00A7
	BNE.b CODE_138516
CODE_138511:
	LDA.w #$00A7
	BRA.b CODE_138540

CODE_138516:
	TXA
	ORA.w #$0008
	STA.b $00
	AND.w #$0002
	BEQ.b CODE_138526
CODE_138521:
	LDA.w DATA_1384DD,x
	STA.b $9B
CODE_138526:
	LDA.b $2C
	AND.w #$0001
	ASL
	ASL
	ADC.b $00
	TAY
	LDA.b $2A
	BMI.b CODE_13853B
	LDA.w DATA_1384C1,y
	BEQ.b CODE_138546
	BRA.b CODE_138540

CODE_13853B:
	LDA.w DATA_1384CD,y
	BEQ.b CODE_138546
CODE_138540:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_138546:
	SEP.b #$30
	RTL

DATA_138549:
	dw $009B,$009E

;-------------------------------------------------------------------------
; CODE_lift_track_45deg -- CODE_lift_track_45deg: 45-degree moving-platform rail stamp.
; Parallels ys_bgsc1.asm. Same overall shape as 30-deg variant
; but with extra steepness in the per-row index calc (`$15 AND $0002`
; folded into the table-offset arithmetic). Picks from DATA_1385BF.
;-------------------------------------------------------------------------
CODE_13854D:
CODE_lift_track_45deg:                                           ; descriptive alias
	REP.b #$30
	LDA.w #$8000
	STA.b $9B
	LDY.w #$0000
	LDA.b $2A
	BPL.b CODE_13855D
	INY
	INY
CODE_13855D:
	LDA.b $28
	BEQ.b CODE_138582
	CLC
	ADC.w DATA_1384D9,y
	CMP.b $2A
	BEQ.b CODE_13859E
	LDA.b $2C
	ASL
	STA.b $00
	LDA.b $15
	AND.w #$0002
	ASL
	ADC.b $00
	ASL
	STA.b $00
	TYA
	ORA.b $00
	TAY
	LDA.w DATA_1385BF,y
	BRA.b CODE_1385B6

CODE_138582:
	STZ.b $9B
	LDA.b $2C
	BNE.b CODE_1385BC
	LDA.b $12
	CMP.w #$00B4
	BEQ.b CODE_138594
	CMP.w #$00A7
	BNE.b CODE_138599
CODE_138594:
	LDA.w #$00A7
	BRA.b CODE_1385B6

CODE_138599:
	LDA.w DATA_1384C9,y
	BRA.b CODE_1385B6

CODE_13859E:
	LDA.b $2C
	BNE.b CODE_1385BC
	LDA.b $12
	CMP.w #$00B4
	BEQ.b CODE_1385AE
	CMP.w #$00A7
	BNE.b CODE_1385B3
CODE_1385AE:
	LDA.w #$00A7
	BRA.b CODE_1385B6

CODE_1385B3:
	LDA.w DATA_1384D5,y
CODE_1385B6:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_1385BC:
	SEP.b #$30
	RTL

DATA_1385BF:
	dw $0097,$0098,$0096,$0099,$00A5,$00A0,$00A3,$00A2
	dw $00A4,$00A1

;-------------------------------------------------------------------------
; CODE_lift_track_static -- CODE_lift_track_static: horizontal static-target lift rail.
; Parallels ys_bgsc1.asm. Simple stamper: checks if current tile
; is one of two existing lift-rail tile IDs ($00B4 / $00A7) to leave it
; alone; otherwise picks left-cap ($0093) / right-cap ($0092) / middle
; ($00A6) by column position.
;-------------------------------------------------------------------------
CODE_1385D3:
CODE_lift_track_static:                                          ; descriptive alias
	REP.b #$30
	LDX.b $1D
	LDA.b $12
	CMP.w #$00B4
	BEQ.b CODE_1385E3
	CMP.w #$00A7
	BNE.b CODE_1385E8
CODE_1385E3:
	LDA.w #$00A7
	BRA.b CODE_1385FE

CODE_1385E8:
	LDA.b $28
	BEQ.b CODE_1385F6
	INC
	CMP.b $2A
	BEQ.b CODE_1385FB
	LDA.w #$00A6
	BRA.b CODE_1385FE

CODE_1385F6:
	LDA.w #$0093
	BRA.b CODE_1385FE

CODE_1385FB:
	LDA.w #$0092
CODE_1385FE:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

;-------------------------------------------------------------------------
; CODE_tunnel_dispatch -- CODE_tunnel_dispatch: tunnel / cave-mouth stamp.
; Parallels ys_bgsc1.asm. The largest dispatcher in this region
; of the bank: probes the current cell + neighbours and routes to one of
; several per-shape sub-handlers (CODE_tunnel_box_top_left_stamp family) that pick from
; per-orientation tile tables (DATA_138784..DATA_138C4A). Used for the
; vertical / horizontal / box / pass-through tunnel variants.
;-------------------------------------------------------------------------
CODE_138605:
CODE_tunnel_dispatch:                                            ; descriptive alias
	REP.b #$30
	LDA.b $1B
	STA.b $0E
	LDX.b $1D
	STZ.b $A1
	LDA.b $12
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_WideFloorPage_Anchor
	BNE.b CODE_138622
	LDA.b $12
	AND.w #$00FF
	INC
	ASL
	STA.b $A1
CODE_138622:
	LDA.b $2A
	DEC
	BEQ.b CODE_tunnel_vert_col_branch
	LDA.b $2E
	DEC
	BEQ.b CODE_tunnel_horiz_row_branch
	JSR.w CODE_tunnel_box_sub_dispatch
	BRA.b CODE_tunnel_dispatch_tail

CODE_138631:
CODE_tunnel_vert_col_branch:
	JSR.w CODE_tunnel_vert_sub_dispatch
	BRA.b CODE_tunnel_dispatch_tail

CODE_138636:
CODE_tunnel_horiz_row_branch:
	JSR.w CODE_tunnel_horiz_sub_dispatch
CODE_138639:
CODE_tunnel_dispatch_tail:
	LDX.b $1D
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_138645:
CODE_tunnel_vert_sub_dispatch:
	LDA.b $2C
	BEQ.b CODE_138656
	INC
	CMP.b $2E
	BEQ.b CODE_13865E
	JSR.w CODE_tunnel_input_tile_classifier
	LDA.w DATA_138784,y
	BRA.b CODE_138664

CODE_138656:
	JSR.w CODE_tunnel_input_tile_classifier
	LDA.w DATA_1387E2,y
	BRA.b CODE_138664

CODE_13865E:
	JSR.w CODE_tunnel_input_tile_classifier
	LDA.w DATA_138840,y
CODE_138664:
	TAY
	RTS

CODE_138666:
CODE_tunnel_horiz_sub_dispatch:
	LDA.b $28
	BEQ.b CODE_138676
	INC
	CMP.b $2A
	BEQ.b CODE_13867E
	LDY.b $A1
	LDA.w DATA_13889E,y
	BRA.b CODE_138684

CODE_138676:
	JSR.w CODE_tunnel_input_tile_classifier
	LDA.w DATA_1388FC,y
	BRA.b CODE_138684

CODE_13867E:
	JSR.w CODE_tunnel_input_tile_classifier
	LDA.w DATA_13895A,y
CODE_138684:
	TAY
	RTS

CODE_138686:
CODE_tunnel_box_sub_dispatch:
	LDA.b $28
	BNE.b CODE_138695
	LDA.b $2C
	BEQ.b CODE_tunnel_box_top_left_stamp
	INC
	CMP.b $2E
	BNE.b CODE_tunnel_box_middle_left_stamp
	BRA.b CODE_tunnel_box_bottom_left_stamp

CODE_138695:
	INC
	CMP.b $2A
	BEQ.b CODE_1386A5
	LDA.b $2C
	BEQ.b CODE_tunnel_box_top_middle_stamp
	INC
	CMP.b $2E
	BNE.b CODE_tunnel_box_middle_middle_stamp
	BRA.b CODE_tunnel_box_bottom_middle_stamp

CODE_1386A5:
	LDA.b $2C
	BEQ.b CODE_tunnel_box_top_right_stamp
	INC
	CMP.b $2E
	BNE.b CODE_tunnel_box_middle_right_jmp
	JMP.w CODE_tunnel_box_bottom_right_stamp

CODE_1386B1:
CODE_tunnel_box_middle_right_jmp:
	JMP.w CODE_tunnel_box_middle_right_stamp

CODE_1386B4:
CODE_tunnel_box_top_left_stamp:
	JSR.w CODE_tunnel_input_tile_classifier
	PHY
	LDY.w #$0000
	JSR.w CODE_tunnel_top_cap_above_fixup
	PLY
	LDA.w DATA_1389B8,y
	JMP.w CODE_tunnel_box_dispatch_tail

CODE_1386C5:
CODE_tunnel_box_middle_left_stamp:
	JSR.w CODE_tunnel_input_tile_classifier
	LDA.w DATA_138A16,y
	BRA.b CODE_tunnel_box_dispatch_tail

CODE_1386CD:
CODE_tunnel_box_bottom_left_stamp:
	JSR.w CODE_tunnel_input_tile_classifier
	LDA.w DATA_138A74,y
	BRA.b CODE_tunnel_box_dispatch_tail

CODE_1386D5:
CODE_tunnel_box_top_middle_stamp:
	JSR.w CODE_tunnel_input_tile_classifier
	PHY
	LDY.w #$0002
	JSR.w CODE_tunnel_top_cap_above_fixup
	PLY
	LDA.w DATA_138AD2,y
	BRA.b CODE_tunnel_box_dispatch_tail

CODE_1386E5:
CODE_tunnel_box_middle_middle_stamp:
	LDA.w #$1C04
	BRA.b CODE_tunnel_box_dispatch_tail

CODE_1386EA:
CODE_tunnel_box_bottom_middle_stamp:
	JSR.w CODE_tunnel_input_tile_classifier
	LDA.w DATA_138B30,y
	BRA.b CODE_tunnel_box_dispatch_tail

CODE_1386F2:
CODE_tunnel_box_top_right_stamp:
	JSR.w CODE_tunnel_input_tile_classifier
	PHY
	LDY.w #$0004
	JSR.w CODE_tunnel_top_cap_above_fixup
	PLY
	LDA.w DATA_138B8E,y
	BRA.b CODE_tunnel_box_dispatch_tail

CODE_138702:
CODE_tunnel_box_middle_right_stamp:
	JSR.w CODE_tunnel_input_tile_classifier
	LDA.w DATA_138BEC,y
	BRA.b CODE_tunnel_box_dispatch_tail

CODE_13870A:
CODE_tunnel_box_bottom_right_stamp:
	JSR.w CODE_tunnel_input_tile_classifier
	LDA.w DATA_138C4A,y
CODE_138710:
CODE_tunnel_box_dispatch_tail:
	TAY
	RTS

CODE_138712:
CODE_tunnel_input_tile_classifier:
	LDA.b $12
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_WideFloorPage_Anchor
	BEQ.b CODE_13873B
	LDY.w #$0000
	LDA.b $12
CODE_138721:
	LDX.w DATA_138760,y
	CMP.w $0000,x
	BEQ.b CODE_138734
	INY
	INY
	CPY.w #$0024
	BCC.b CODE_138721
	STZ.b $A1
	BRA.b CODE_13873B

CODE_138734:
	TYA
	CLC
	ADC.w #$0028
	STA.b $A1
CODE_13873B:
	LDY.b $A1
	RTS

CODE_13873E:
CODE_tunnel_top_cap_above_fixup:
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_138750
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BNE.b CODE_138757
CODE_138750:
	LDA.w DATA_138758,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_138757:
	RTS

;-------------------------------------------------------------------------
; TUNNEL / CAVE-MOUTH DISPATCHER TABLES (14 per-cell tables + 3 helper
; tables). The dispatcher is CODE_tunnel_dispatch (CODE_138605), which
; parallels ys_bgsc1.asm. It uses object-relative position
; ($28 = current col, $2A = col-extent, $2C = current row, $2E = row-
; extent) to pick which of the 14 cell tables to look up, then indexes
; into that table by Y -- where Y is derived from $12 (current tile)
; via CODE_tunnel_input_tile_classifier if the cell is in the wide-floor family page, or via
; a lookup through DATA_tunnel_input_tile_classifier otherwise.
;
; The 14 tables form three orientation groups:
;
;   SINGLE-COLUMN (vertical tunnel, $2A == 1):
;     row 0          DATA_tunnel_vcol_top_tiles      (DATA_1387E2)
;     middle rows    DATA_tunnel_vcol_middle_tiles   (DATA_138784)
;     row $2E-1      DATA_tunnel_vcol_bottom_tiles   (DATA_138840)
;
;   SINGLE-ROW (horizontal tunnel, $2E == 1):
;     col 0          DATA_tunnel_hrow_left_tiles     (DATA_1388FC)
;     middle cols    DATA_tunnel_hrow_middle_tiles   (DATA_13889E)
;     col $2A-1      DATA_tunnel_hrow_right_tiles    (DATA_13895A)
;
;   2D BOX (everything else, 3x3 corner/edge/middle dispatch):
;                  col=0                      mid col                  col=$2A-1
;     row=0      DATA_tunnel_box_top_left  DATA_tunnel_box_top_middle  DATA_tunnel_box_top_right
;     mid row    DATA_tunnel_box_middle_left   (no table*)             DATA_tunnel_box_middle_right
;     row=$2E-1  DATA_tunnel_box_bottom_left DATA_tunnel_box_bottom_middle DATA_tunnel_box_bottom_right
;
;     * Box interior (mid col + mid row) stamps slot $1C04 directly --
;       CODE_tunnel_box_middle_middle_stamp does `LDA.w #$1C04` with no per-tile table.
;
; The 3 helper tables (DATA_138758/13875E/138760, named below) handle
; the top-cap above-fix-up and the input-tile classifier.
;
; Each per-cell table entry is a slot ADDRESS -- mostly in the wide-floor
; family ($1BE0+) but with a few reaching into the flat-floor family
; ($1C92+) or the FloorRow0 family ($1C5C+) for tunnel-edge tiles. As
; with the big-floor remap tables above, individual entries are
; positional shape variants and aren't named.
;-------------------------------------------------------------------------

DATA_138758:
DATA_tunnel_top_cap_above_fixup:                                     ; 3-entry replacement table used by CODE_tunnel_top_cap_above_fixup when the cell ABOVE this one is FloorRow0_Left or FloorRow0_Right (i.e. a flat-floor top cap). Indexed by Y={0,2,4} passed in from the top-row dispatcher branches.
	dw $007E,$0000,$007F

DATA_13875E:
DATA_tunnel_extra_singleton_007D:                                     ; 1-word slot containing Map16 ID $007D; used as a pointer-target dw entry inside DATA_tunnel_vert_top_tiles (entries [22] and [23] dereference here).
	dw $007D

DATA_138760:
DATA_tunnel_input_tile_classifier:                                     ; 18-entry list of slot ADDRESSES; CODE_tunnel_input_tile_classifier derefs each and finds which one's stored Map16 ID equals $12 (current tile), so it can set the alt index $A1 used by the box-tunnel sub-dispatch when current cell is OUTSIDE the wide-floor family page.
	dw !RAM_YI_Level_TileTpl_FlatFloor_Row1LeftLo,!RAM_YI_Level_TileTpl_FlatFloor_Row1RightLo,!RAM_YI_Level_TileTpl_FloorRow0_LeftLo,!RAM_YI_Level_TileTpl_FloorRow0_RightLo,$1CF2,$1CF8,$1CD8,$1CDC
	dw $1CE0,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1CDA,$1CDE,$1CE2
	dw $1CE4,$1CE6

DATA_138784:
DATA_tunnel_vcol_middle_tiles:                                     ; Variant table for the middle rows of a single-column (vertical) tunnel: CODE_tunnel_vert_sub_dispatch path when $2A == 1 and $2C is neither 0 nor $2E-1. Y index from CODE_tunnel_input_tile_classifier.
	dw !RAM_YI_Level_TileTpl_WideFloorPage_Anchor,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1C18,$1C18,$1C18,$1BF2,$1BF0,$1BF2
	dw $1BF0,$1BF0,$1BF2,$1C18,$1C04,$1BF8,$1BFA,$1BF8
	dw $1C32,$1BF8,$1BFA,$1C04,$1C06,$1C06,$1C0A,$1C0C
	dw $1C0E,$1C10,$1C12,$1C14,$1C16,$1C18,$1C18,$1C1C
	dw $1C1E,$1C20,$1C22,$1C24,$1C26,$1C28,$1C2A,$1C2C
	dw $1C2E,$1C30,$1C32,$1BF2,$1BF0,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor

DATA_1387E2:
DATA_tunnel_vcol_top_tiles:                                     ; Variant table for the top row of a single-column tunnel: CODE_tunnel_vert_sub_dispatch path when $2A == 1 and $2C == 0.
	dw $1C38,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1C18,$1BE4,$1BE4,$1BF2,$1BEA,$1BEC
	dw $1BF0,$1BEA,$1BEC,$1BF4,$1C04,$1BF8,$1BFA,$1BFC
	dw $1BFE,$1BF8,$1BFA,$1C04,$1C06,$1C06,DATA_13875E,DATA_13875E
	dw $1C0E,$1C10,$1C12,$1C14,$1C16,$1C18,$1C18,$1C1C
	dw $1C1E,$1C20,$1C22,$1C24,$1C26,$1C28,$1C2A,$1C2C
	dw $1C2E,$1C30,$1C32,$1BEC,$1BEA,$1C38,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor

DATA_138840:
DATA_tunnel_vcol_bottom_tiles:                                     ; Variant table for the bottom row of a single-column tunnel: CODE_tunnel_vert_sub_dispatch path when $2A == 1 and $2C+1 == $2E.
	dw $1C3A,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1BE2,$1C18,$1C1A,$1BE8,$1BF0,$1BF2
	dw $1BEE,$1BEE,$1BE8,$1C18,$1BF6,$1BF8,$1BFA,$1BF8
	dw $1C32,$1C02,$1C02,$1C04,$1C06,$1C08,$1C0A,$1C0C
	dw $1C2C,$1C2C,$1C12,$1C14,$1C16,$1C18,$1C1A,$1C1C
	dw $1C1E,$1C20,$1C22,$1C24,$1C26,$1C28,$1C2A,$1C2C
	dw $1C2E,$1C30,$1C32,$1BE8,$1BEE,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1C3A

DATA_13889E:
DATA_tunnel_hrow_middle_tiles:                                     ; Variant table for the middle columns of a single-row (horizontal) tunnel: CODE_tunnel_horiz_sub_dispatch path when $2E == 1 and $28 is neither 0 nor $2A-1. Y index from $A1.
	dw $1BE6,$1C18,$1BE2,$1BE4,$1BE6,$1C1A,$1BE4,$1BE4
	dw $1C1A,$1C18,$1C18,$1BF4,$1BF6,$1C18,$1C04,$1BE4
	dw $1BF4,$1C1A,$1BF6,$1C04,$1C06,$1C08,$1C0A,$1C0C
	dw $1C0E,$1C10,$1C12,$1C14,$1C16,$1C18,$1C1A,$1C1C
	dw $1C1E,$1C20,$1C22,$1C24,$1C26,$1C28,$1C2A,$1C2C
	dw $1C2E,$1C30,$1C32,$1BE6,$1BE6,$1BE4,$1BE2

DATA_1388FC:
DATA_tunnel_hrow_left_tiles:                                     ; Variant table for the leftmost column of a single-row tunnel: CODE_tunnel_horiz_sub_dispatch path when $2E == 1 and $28 == 0.
	dw $1C34,$1BF2,$1BE8,$1BEC,$1BE6,$1BE8,$1BE4,$1BEC
	dw $1C1A,$1C18,$1BF2,$1BF4,$1BF6,$1BF8,$1C04,$1BFC
	dw $1BF4,$1BF6,$1BF6,$1C04,$1C06,$1C08,$1C0A,$1C0C
	dw $1C0E,$1C10,$1C08,$1C08,$1C08,$1C18,$1C1A,$1C1C
	dw $1C1E,$1C20,$1C22,$1C24,$1C3C,$1C28,$1C2A,$1C2C
	dw $1C2E,$1C30,$1C32,$1C34,$1BE6,$1BEC,$1BE8

DATA_13895A:
DATA_tunnel_hrow_right_tiles:                                     ; Variant table for the rightmost column of a single-row tunnel: CODE_tunnel_horiz_sub_dispatch path when $2E == 1 and $28+1 == $2A.
	dw $1C36,$1BF0,$1BEE,$1BEA,$1BE6,$1C1A,$1BEA,$1BE4
	dw $1BEE,$1BF0,$1C18,$1BF4,$1BF6,$1C18,$1BFA,$1BF4
	dw $1BFE,$1C1A,$1C02,$1C04,$1C06,$1C08,$1C0A,$1C0C
	dw $1C0E,$1C10,$1C12,$1C14,$1C16,$1C18,$1C1A,$1C1C
	dw $1C1E,$1C0A,$1C0A,$1C0A,$1C26,$1C3E,$1C2A,$1C2C
	dw $1C2E,$1C30,$1C32,$1BE6,$1C36,$1BEA,$1BEE

DATA_1389B8:
DATA_tunnel_box_top_left_tiles:                                     ; Box-tunnel 3x3 dispatch [col=0, row=0]: CODE_tunnel_box_top_left_stamp. Also runs CODE_tunnel_top_cap_above_fixup's above-cap fix-up (Y=0).
	dw $1BFC,$1BF8,$1C18,$1BF4,$1BE4,$1BF8,$1BF4,$1BFC
	dw $1C18,$1C18,$1BF8,$1BF4,$1C04,$1BF8,$1C04,$1BFC
	dw $1BF4,$1BF8,$1C04,$1C04,$1C20,$1C20,$1C20,$1C20
	dw $1C0E,$1C10,$1C10,$1C10,$1C10,$1C18,$1C18,$1C1C
	dw $1C1E,$1C20,$1C22,$1C24,$1C26,$1C28,$1C2A,$1C2C
	dw $1C2E,$1C30,$1C32,$1BFC,$1BF4,$1BFC,$1BF8

DATA_138A16:
DATA_tunnel_box_middle_left_tiles:                                     ; Box-tunnel 3x3 dispatch [col=0, middle row]: CODE_tunnel_box_middle_left_stamp.
	dw $1BF8,$1BF8,$1BF8,$1C18,$1C18,$1BF8,$1C18,$1BF8
	dw $1C18,$1C18,$1BF8,$1C18,$1C04,$1BF8,$1C04,$1BF8
	dw $1C18,$1BF8,$1C04,$1C04,$1C06,$1C08,$1C0A,$1C0C
	dw $1C0E,$1C10,$1C0C,$1C0C,$1C0C,$1C18,$1C18,$1C1C
	dw $1C1E,$1C20,$1C22,$1C24,$1C26,$1C28,$1C2A,$1C2C
	dw $1C2E,$1C30,$1C32,$1BF8,$1C18,$1BF8,$1BF8

DATA_138A74:
DATA_tunnel_box_bottom_left_tiles:                                     ; Box-tunnel 3x3 dispatch [col=0, row=$2E-1]: CODE_tunnel_box_bottom_left_stamp.
	dw $1C00,$1BF8,$1C1A,$1C18,$1C1A,$1C00,$1C04,$1BF8
	dw $1C1A,$1C18,$1BF8,$1C18,$1BF6,$1BF8,$1C04,$1BF8
	dw $1C18,$1C00,$1BF6,$1C04,$1C06,$1C08,$1C0A,$1C0C
	dw $1C26,$1C10,$1C14,$1C14,$1C14,$1C18,$1C1A,$1C1C
	dw $1C1E,$1C26,$1C26,$1C26,$1C40,$1C28,$1C2A,$1C2C
	dw $1C2E,$1C30,$1C32,$1C00,$1C1A,$1BF8,$1C00

DATA_138AD2:
DATA_tunnel_box_top_middle_tiles:                                     ; Box-tunnel 3x3 dispatch [middle col, row=0]: CODE_tunnel_box_top_middle_stamp. Also runs CODE_tunnel_top_cap_above_fixup's above-cap fix-up (Y=2).
	dw $1BF4,$1C18,$1C18,$1BF4,$1BF4,$1C18,$1BF4,$1BF4
	dw $1C18,$1C18,$1C18,$1BF4,$1C04,$1C18,$1C04,$1BF4
	dw $1BF4,$1C18,$1C04,$1C04,$1C22,$1C22,$1C0A,$1C0C
	dw $1C0E,$1C10,$1C12,$1C14,$1C16,$1C18,$1C18,$1C1C
	dw $1C1E,$1C20,$1C22,$1C24,$1C26,$1C28,$1C2A,$1C2C
	dw $1C2E,$1C30,$1C32,$1BF4,$1BF4,$1BF4,$1C18

DATA_138B30:
DATA_tunnel_box_bottom_middle_tiles:                                     ; Box-tunnel 3x3 dispatch [middle col, row=$2E-1]: CODE_tunnel_box_bottom_middle_stamp.
	dw $1BF6,$1C04,$1BF6,$1C04,$1BF6,$1BF6,$1C04,$1C04
	dw $1BF6,$1C04,$1C04,$1C04,$1BF6,$1C04,$1C04,$1C04
	dw $1C04,$1BF6,$1BF6,$1C04,$1C06,$1C08,$1C0A,$1C0C
	dw $1C28,$1C28,$1C12,$1C14,$1C16,$1C04,$1BF6,$1C1C
	dw $1C1E,$1C20,$1C22,$1C24,$1C26,$1C28,$1C2A,$1C2C
	dw $1C2E,$1C30,$1C32,$1BF6,$1BF6,$1C04,$1BF6

DATA_138B8E:
DATA_tunnel_box_top_right_tiles:                                     ; Box-tunnel 3x3 dispatch [col=$2A-1, row=0]: CODE_tunnel_box_top_right_stamp. Also runs CODE_tunnel_top_cap_above_fixup's above-cap fix-up (Y=4).
	dw $1BFE,$1C32,$1C18,$1C18,$1BF4,$1C18,$1BFE,$1BF4
	dw $1C32,$1C32,$1C18,$1BF4,$1C04,$1C18,$1BFA,$1BF4
	dw $1BF4,$1C18,$1BFA,$1C04,$1C24,$1C24,$1C0A,$1C0C
	dw $1C0E,$1C10,$1C12,$1C14,$1C0E,$1C04,$1C18,$1C1C
	dw $1C1E,$1C12,$1C12,$1C12,$1C26,$1C28,$1C2A,$1C2C
	dw $1C2E,$1C30,$1C32,$1BF4,$1BFE,$1BFE,$1C32

DATA_138BEC:
DATA_tunnel_box_middle_right_tiles:                                     ; Box-tunnel 3x3 dispatch [col=$2A-1, middle row]: CODE_tunnel_box_middle_right_stamp.
	dw $1BFA,$1BFA,$1C04,$1C04,$1C04,$1C04,$1BFA,$1C04
	dw $1BFA,$1BFA,$1C04,$1C04,$1C04,$1C04,$1BFA,$1C04
	dw $1BFA,$1C04,$1BFA,$1C04,$1C06,$1C08,$1C0A,$1C0C
	dw $1C0E,$1C10,$1C12,$1C14,$1C16,$1C04,$1C04,$1C1C
	dw $1C1E,$1C0E,$1C0E,$1C0E,$1C26,$1C16,$1C2A,$1C2C
	dw $1C2E,$1C30,$1C32,$1C04,$1BFA,$1BFA,$1BFA

DATA_138C4A:
DATA_tunnel_box_bottom_right_tiles:                                     ; Box-tunnel 3x3 dispatch [col=$2A-1, row=$2E-1]: CODE_tunnel_box_bottom_right_stamp.
	dw $1C02,$1BFA,$1BF6,$1C04,$1BF6,$1BF6,$1BFA,$1C04
	dw $1C02,$1BFA,$1C04,$1C04,$1BF6,$1C04,$1BFA,$1C04
	dw $1BFA,$1BF6,$1C02,$1C04,$1C06,$1C08,$1C0A,$1C0C
	dw $1C2A,$1C2A,$1C12,$1C14,$1C16,$1C04,$1C1A,$1C1C
	dw $1C1E,$1C16,$1C16,$1C16,$1C26,$1C42,$1C2A,$1C2C
	dw $1C2E,$1C30,$1C32,$1BF6,$1C02,$1BFA,$1C02

DATA_138CA8:
	dw $00DB,$00DD,$00DC,$0000,$150F,$1511,$1510

;-------------------------------------------------------------------------
; CODE_cloud_block_stamp -- CODE_cloud_block_stamp: 7-tile cloud-block stamper.
; Parallels ys_bgsc1.asm (cloud). Builds an index of
; (row * 4 + column-edge-flag) into DATA_138CA8 (7
; 2-byte tile IDs covering the 4 corners + 3 mid tiles of a cloud
; platform).
;-------------------------------------------------------------------------
CODE_138CB6:
CODE_cloud_block_stamp:                                          ; descriptive alias
	REP.b #$30
	LDA.b $2C
	ASL
	ASL
	STA.b $00
	LDA.b $28
	BEQ.b CODE_138CCB
	INC.b $00
	INC
	CMP.b $2A
	BNE.b CODE_138CCB
	INC.b $00
CODE_138CCB:
	LDA.b $00
	ASL
	TAY
	LDA.w DATA_138CA8,y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

;-------------------------------------------------------------------------
; CODE_water_open -- CODE_water_open: open-water stamp.
; Parallels ys_bgsc1.asm (open water, no boundary). Only stamps $1600 (open-water tile) when the
; cell is currently empty, otherwise leaves the existing tile alone
; (lets land / rock / bridge tiles take precedence).
;-------------------------------------------------------------------------
CODE_138CDB:
CODE_water_open:                                                 ; descriptive alias
	REP.b #$30
	LDA.b $12
	BNE.b CODE_138CEA
	LDX.b $1D
	LDA.w #$1600
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_138CEA:
	SEP.b #$30
	RTL

;-------------------------------------------------------------------------
; CODE_water_meets_ground -- CODE_water_meets_ground: water-meets-ground stamp.
; Parallels ys_bgsc1.asm (water + ground). Multi-line water
; surface that picks among waterline, mid-water, and bottom-row tiles
; based on the cell's position in the object's row extent ($2C vs $2E).
; If neighbour above is open water ($1600 page), adds offset $0008 into
; the underwater tile bank (DATA_138D59 / DATA_138D5F / DATA_138D6D).
;-------------------------------------------------------------------------
CODE_138CED:
CODE_water_meets_ground:                                         ; [decorator] descriptive alias
	REP.b #$30
	LDA.b $1B
	STA.b $0E
	STZ.b $0A
	LDX.b $1D
	LDA.b $12
	AND.w #$FF00
	CMP.w #$1600
	BNE.b CODE_138D06
	LDA.w #$0008
	STA.b $0A
CODE_138D06:
	LDA.b $2C
	BNE.b CODE_water_meets_ground_mid_or_bottom
	LDA.b $0A
	BNE.b CODE_138D56
	LDY.w #$0000
	JSR.w CODE_water_meets_ground_waterline_select
	BRA.b CODE_138D56

CODE_138D16:
CODE_water_meets_ground_mid_or_bottom:
	INC
	CMP.b $2E
	BEQ.b CODE_138D48
	CMP.w #$0002
	BNE.b CODE_138D38
	LDA.b $0A
	BNE.b CODE_water_meets_ground_row2_underwater
	LDY.w #$0002
	JSR.w CODE_water_meets_ground_waterline_select
	BRA.b CODE_138D56

CODE_138D2C:
CODE_water_meets_ground_row2_underwater:
	JSR.w CODE_water_meets_ground_col_index
	LDA.w DATA_138D59,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	BRA.b CODE_138D56

CODE_138D38:
	JSR.w CODE_water_meets_ground_col_index
	TYA
	ORA.b $0A
	TAY
	LDA.w DATA_138D5F,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	BRA.b CODE_138D56

CODE_138D48:
	JSR.w CODE_water_meets_ground_col_index
	TYA
	ORA.b $0A
	TAY
	LDA.w DATA_138D6D,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_138D56:
	SEP.b #$30
	RTL

DATA_138D59:
	dw $011F,$0120,$0121

DATA_138D5F:
	dw $011C,$011D,$011E,$0000,$0122,$0123,$0124

DATA_138D6D:
	dw $013A,$013B,$013C,$0000,$0137,$0138,$0139

CODE_138D7B:
CODE_water_meets_ground_col_index:
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_138D8B
	INY
	INY
	INC
	CMP.b $2A
	BNE.b CODE_138D8B
	INY
	INY
CODE_138D8B:
	RTS

CODE_138D8C:
CODE_water_meets_ground_waterline_select:
	LDA.b $28
	AND.w #$0001
	CLC
	ADC.w DATA_138DDF,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $2C
	BNE.b CODE_138DB1
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$1600
	BEQ.b CODE_138DDE
	LDA.b $1B
	STA.b $0E
CODE_138DB1:
	LDA.b $28
	BNE.b CODE_138DC8
	JSL.l CODE_get_map16_left
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	BNE.b CODE_138DDE
	LDA.w DATA_138DE3,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	BRA.b CODE_138DDE

CODE_138DC8:
	INC
	CMP.b $2A
	BNE.b CODE_138DDE
	JSL.l CODE_get_map16_right
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	BNE.b CODE_138DDE
	LDA.w DATA_138DE7,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_138DDE:
	RTS

DATA_138DDF:
	dw $0021,$011A

DATA_138DE3:
	dw $0020,$001F

DATA_138DE7:
	dw $0023,$0024

;-------------------------------------------------------------------------
; CODE_water_meets_land -- CODE_water_meets_land: water-meets-land 18-tile stamp.
; Parallels ys_bgsc1.asm. 3x3 grid of waterline / corner tiles
; (DATA_138E2E, 9 entries) with a second 9-entry variant (when current
; cell already overlaps open water, offset by $0012 = 9 words). Encodes
; horizontal-edge and vertical-edge flags from row/col position.
;-------------------------------------------------------------------------
CODE_138DEB:
CODE_water_meets_land:                                           ; descriptive alias
	REP.b #$30
	STZ.b $0A
	LDA.b $12
	AND.w #$FF00
	CMP.w #$1600
	BNE.b CODE_138DFE
	LDA.w #$0012
	STA.b $0A
CODE_138DFE:
	LDY.w #$0000
	LDA.b $2C
	BEQ.b CODE_138E10
	LDY.w #$0006
	INC
	CMP.b $2E
	BNE.b CODE_138E10
	LDY.w #$000C
CODE_138E10:
	LDA.b $28
	BEQ.b CODE_138E1D
	INY
	INY
	INC
	CMP.b $2A
	BNE.b CODE_138E1D
	INY
	INY
CODE_138E1D:
	TYA
	CLC
	ADC.b $0A
	TAY
	LDX.b $1D
	LDA.w DATA_138E2E,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_138E2E:
	dw $0125,$0126,$0127,$0128,$0129,$012A,$012B,$012C
	dw $012D,$012E,$012F,$0130,$0131,$0132,$0133,$0134
	dw $0135,$0136

;-------------------------------------------------------------------------
; CODE_water_on_rock -- CODE_water_on_rock: water-on-rock 20-tile stamp.
; Parallels ys_bgsc1.asm (rock). Stamps the rock-shore
; pattern: 3 rows of 4-tile patterns from DATA_138E90 (12
; tiles, used for rows 0..2), then alternating-row 8 tiles from
; DATA_138EA8 (used for rows 3+).
;-------------------------------------------------------------------------
CODE_138E52:
CODE_water_on_rock:                                              ; descriptive alias
	REP.b #$30
	LDX.b $1D
	LDA.b $2C
	CMP.w #$0003
	BCS.b CODE_138E70
	ASL
	ASL
	ASL
	STA.b $00
	LDA.b $28
	AND.w #$0003
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_138E90,y
	BRA.b CODE_138E89

CODE_138E70:
	LDA.b $2C
	EOR.w #$0001
	AND.w #$0001
	ASL
	ASL
	ASL
	STA.b $00
	LDA.b $28
	AND.w #$0003
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_138EA8,y
CODE_138E89:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_138E90:
	dw $1601,$1602,$1603,$1604,$1605,$1606,$1607,$1608
	dw $1609,$160A,$160B,$160C

DATA_138EA8:
	dw $160D,$160E,$160F,$1610,$1611,$1612,$1613,$1614

;-------------------------------------------------------------------------
; CODE_water_bridge_horizontal -- CODE_water_bridge_horizontal: horizontal water-bridge stamp.
; Parallels ys_bgsc1.asm. 3 fixed tiles: left-cap ($1505),
; right-cap ($1506), middle alternates ($1501 / $1502 / $1509). Used for
; planks crossing open water.
;-------------------------------------------------------------------------
CODE_138EB8:
CODE_water_bridge_horizontal:                                    ; descriptive alias
	REP.b #$30
	LDA.b $28
	AND.w #$0001
	STA.b $00
	LDA.b $28
	BNE.b CODE_138ECA
	LDA.w #$1505
	BRA.b CODE_138EE6

CODE_138ECA:
	INC
	CMP.b $2A
	BEQ.b CODE_138EE3
	LDA.b $12
	CMP.w #$0019
	BNE.b CODE_138EDB
	LDA.w #$1509
	BRA.b CODE_138EE6

CODE_138EDB:
	LDA.w #$1501
	CLC
	ADC.b $00
	BRA.b CODE_138EE6

CODE_138EE3:
	LDA.w #$1506
CODE_138EE6:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

;-------------------------------------------------------------------------
; CODE_water_bridge_vertical -- CODE_water_bridge_vertical: vertical water-bridge stamp.
; Parallels ys_bgsc1.asm. 9-tile vertical plank pattern from
; DATA_138F34 (8 entries). Top-of-bridge / mid / bottom
; selected by row position; underwater offset +$0006 when overlapping
; open water, +$000C when overlapping horizontal-bridge ($1501/$1502).
;-------------------------------------------------------------------------
CODE_138EEF:
CODE_water_bridge_vertical:                                      ; descriptive alias
	REP.b #$30
	STZ.b $0A
	LDA.b $12
	AND.w #$FF00
	CMP.w #$1600
	BNE.b CODE_138F02
	LDA.w #$0006
	STA.b $0A
CODE_138F02:
	LDA.b $12
	CMP.w #$1501
	BEQ.b CODE_138F0E
	CMP.w #$1502
	BNE.b CODE_138F13
CODE_138F0E:
	LDA.w #$000C
	STA.b $0A
CODE_138F13:
	LDY.w #$0000
	LDA.b $2C
	BEQ.b CODE_138F23
	INY
	INY
	INC
	CMP.b $2E
	BNE.b CODE_138F23
	INY
	INY
CODE_138F23:
	TYA
	CLC
	ADC.b $0A
	TAY
	LDA.w DATA_138F34,y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_138F34:
	dw $1500,$0019,$001A,$1400,$1615,$1616,$0000,$1509

;-------------------------------------------------------------------------
; CODE_water_lift_stamp -- CODE_water_lift_stamp: moving-platform-under-water stamp.
; Parallels ys_bgsc1.asm. 6-entry tile table DATA_138F6B
; 2 top-edge / 2 mid-water-meet / 2 bottom-edge tiles.
; Used for the bob-up-and-down platforms in water levels.
;-------------------------------------------------------------------------
CODE_138F44:
CODE_water_lift_stamp:                                           ; descriptive alias
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	ASL
	TAY
	LDA.b $2C
	BEQ.b CODE_138F61
	INC
	CMP.b $2E
	BEQ.b CODE_138F5C
	TYA
	ORA.w #$0004
	TAY
	BRA.b CODE_138F61

CODE_138F5C:
	TYA
	ORA.w #$0008
	TAY
CODE_138F61:
	LDA.w DATA_138F6B,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_138F6B:
	dw $1507,$1508,$001B,$001C,$1503,$1504

;-------------------------------------------------------------------------
; CODE_water_decor_mushroom_flower -- CODE_water_decor_mushroom_flower: combined underwater
; mushroom / flower decoration stamp.
; Parallels ys_bgsc1.asm.
; Orientation $15 bit 1 picks mushroom ($001D) vs flower ($001E).
;-------------------------------------------------------------------------
CODE_138F77:
CODE_water_decor_mushroom_flower:                                ; descriptive alias
	REP.b #$30
	LDX.b $1D
	LDA.b $15
	AND.w #$0002
	TAY
	LDA.w DATA_water_decor_mushroom_flower_tiles,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_138F8B:
DATA_water_decor_mushroom_flower_tiles:                          ; descriptive alias
	dw $001D,$001E

;-------------------------------------------------------------------------
; CODE_lava_stamp -- CODE_lava_stamp: lava-surface stamp.
; Parallels ys_bgsc1.asm (lava). 5-tile vertical
; pattern: surface bubble / mid / mid / mid / bottom-cap. Two 5-entry
; tile tables (DATA_138FAD / DATA_138FB7) for
; left-edge / right-edge column variants.
;-------------------------------------------------------------------------
CODE_138F8F:
CODE_lava_stamp:                                                 ; descriptive alias
	REP.b #$30
	LDX.b $1D
	LDA.b $2C
	ASL
	TAY
	LDA.b $28
	AND.w #$0001
	BNE.b CODE_138FA3
	LDA.w DATA_138FAD,y
	BRA.b CODE_138FA6

CODE_138FA3:
	LDA.w DATA_138FB7,y
CODE_138FA6:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_138FAD:
	dw $002B,$0027,$9100,$7E02,$7E05

DATA_138FB7:
	dw $002C,$0027,$9101,$7E03,$7E05

;-------------------------------------------------------------------------
; CODE_lava_shared_segment -- CODE_lava_shared_segment: shared lava middle tile.
; Parallels ys_bgsc1.asm (shared / common).
; Single-tile stamper that always writes $7E04 (the universal lava
; mid-bubble). Used by other lava-adjacent objects so they share one
; centre tile rather than duplicating per-orientation tables.
;-------------------------------------------------------------------------
CODE_138FC1:
CODE_lava_shared_segment:                                        ; descriptive alias
	REP.b #$30
	LDX.b $1D
	LDA.w #$7E04
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_138FCF:
	dw $9072,$9073,$907F,$908F,$90A2,$90A3

DATA_138FDB:
	dw $9200,$9080,$9090

DATA_138FE1:
	dw $9068,$9069,$906A,$906D,$906B,$906B,$906C,$906D
	dw $906E,$906F,$9070,$906D,$9071,$906D,$906D,$906D

;-------------------------------------------------------------------------
; CODE_jungle_floor -- CODE_jungle_floor: world 1-1 jungle floor stamp.
; Parallels ys_bgsc1.asm. Multi-row dispatcher for the dense
; foliage-floor pattern of world 1's jungle levels: top row picks among
; 4 random variants via PRNG; mid rows pull from DATA_138FCF / DATA_138FE1
; (6 + 16 tile templates); deeper rows
; do a deterministic non-random check against the column-specific
; template tables.
;-------------------------------------------------------------------------
CODE_139001:
CODE_jungle_floor:                                               ; descriptive alias
	REP.b #$30
	LDA.b $2C
	CMP.w #$0003
	BCS.b CODE_jungle_floor_random_body
	ASL
	TAY
	BNE.b CODE_139017
	JSL.l CODE_prng
	AND.w #$0003
	STA.b $A1
CODE_139017:
	LDA.b $2C
	BNE.b CODE_jungle_floor_row1_dispatch
	JSR.w CODE_jungle_floor_row0_blend
	BRA.b CODE_jungle_floor_template_match

CODE_139020:
CODE_jungle_floor_row1_dispatch:
	LDA.b $2C
	CMP.w #$0001
	BNE.b CODE_139030
	JSR.w CODE_jungle_floor_row1_blend
CODE_13902A:
CODE_jungle_floor_template_match:
	TXA
	CPX.w #$FFFF
	BNE.b CODE_139056
CODE_139030:
	LDX.w #$0000
CODE_139033:
	LDA.b $12
	CMP.w DATA_138FCF,x
	BEQ.b CODE_13905C
	INX
	INX
	CPX.w #$000C
	BCC.b CODE_139033
	LDA.b $A1
	CLC
	ADC.w DATA_138FDB,y
	BRA.b CODE_139056

CODE_139049:
CODE_jungle_floor_random_body:
	JSL.l CODE_prng
	ADC.b $2C
	AND.w #$001E
	TAY
	LDA.w DATA_138FE1,y
CODE_139056:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13905C:
	SEP.b #$30
	RTL

DATA_13905F:
	dw $330D,$3512

DATA_139063:
	dw $9204,$9205

DATA_139067:
	dw $908F,$907F

DATA_13906B:
	dw $964D,$964E

CODE_13906F:
CODE_jungle_floor_row1_blend:
	LDA.b $12
	AND.w #$FF00
	LDX.w #$0000
	CMP.w #$9400
	BEQ.b CODE_139088
	INX
	INX
	CMP.w #$9500
	BEQ.b CODE_139088
	LDX.w #$FFFF
	BRA.b CODE_1390E2

CODE_139088:
	LDA.w DATA_13905F,x
	STA.b $04
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_13909B
CODE_139094:
	INC
	CMP.b $2A
	BNE.b CODE_1390E2
	INX
	INX
CODE_13909B:
	STX.b $0C
	LDA.w DATA_139063,x
	STA.b $06
	LDA.w DATA_139067,x
	STA.b $08
	LDA.w DATA_13906B,x
	STA.b $0A
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.b $06
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.b $08
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	STA.b $0E
	LDX.b $0C
	BNE.b CODE_jungle_floor_row1_blend_right
	JSL.l CODE_get_map16_left
	BRA.b CODE_jungle_floor_row1_blend_finish

CODE_1390D6:
CODE_jungle_floor_row1_blend_right:
	JSL.l CODE_get_map16_right
CODE_1390DA:
CODE_jungle_floor_row1_blend_finish:
	LDA.b $0A
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDX.b $04
CODE_1390E2:
	RTS

DATA_1390E3:
	dw $9500,$9402

DATA_1390E7:
	dw $90A3,$90A2

DATA_1390EB:
	dw $9073,$9072

CODE_1390EF:
CODE_jungle_floor_row0_blend:
	LDA.b $12
	AND.w #$FF00
	LDX.w #$0000
	CMP.w #$9400
	BEQ.b CODE_139105
	INX
	INX
	CMP.w #$9500
	BEQ.b CODE_139105
	BRA.b CODE_139113

CODE_139105:
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_139118
	INX
	INX
	INC
	CMP.b $2A
	BEQ.b CODE_139118
CODE_139113:
	LDX.w #$FFFF
	BRA.b CODE_139158

CODE_139118:
	LDA.w DATA_1390E3,x
	STA.b $04
	LDA.w DATA_1390E7,x
	STA.b $06
	LDA.w DATA_1390EB,x
	STA.b $08
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.b $06
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	AND.w #$F0F0
	CLC
	ADC.w #$0010
	AND.w #$F0F0
	STA.b $00
	LDA.b $1B
	AND.w #$0F0F
	ORA.b $00
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.b $08
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDX.b $04
CODE_139158:
	RTS

DATA_139159:
	dw $9204,$330D,$909C

DATA_13915F:
	dw $90A0,$90A2,$9072

;-------------------------------------------------------------------------
; CODE_jungle_left_wall -- CODE_jungle_left_wall: jungle left-edge wall stamp.
; Parallels ys_bgsc1.asm. Top-only stamps $964D (single-tile
; tip); upper 3 rows pull from DATA_139159 (3 entries);
; deeper rows mix a random base ($909E + 0/1) with DATA_13915F
; (3 entries) based on the neighbour-check helper
; CODE_jungle_wall_neighbour_classify.
;-------------------------------------------------------------------------
CODE_139165:
CODE_jungle_left_wall:                                           ; descriptive alias
	REP.b #$30
CODE_139167:
	LDA.b $28
	BNE.b CODE_139177
	LDA.b $2C
	CMP.w #$0001
	BNE.b CODE_1391A5
	LDA.w #$964D
	BRA.b CODE_13919F

CODE_139177:
	LDA.b $2C
	CMP.w #$0003
	BCS.b CODE_jungle_left_wall_random_body
	ASL
	TAY
	LDA.w DATA_139159,y
	BRA.b CODE_13919F

CODE_139185:
CODE_jungle_left_wall_random_body:
	JSL.l CODE_prng
	AND.w #$0001
	CLC
	ADC.w #$909E
	STA.b $0A
	JSR.w CODE_jungle_wall_neighbour_classify
	TYA
	BMI.b CODE_jungle_left_wall_store
	LDA.w DATA_13915F,y
	STA.b $0A
CODE_13919D:
CODE_jungle_left_wall_store:
	LDA.b $0A
CODE_13919F:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_1391A5:
	SEP.b #$30
	RTL

DATA_1391A8:
	dw $9205,$3512,$909D

DATA_1391AE:
	dw $90A1,$90A3,$9073

;-------------------------------------------------------------------------
; CODE_jungle_right_wall -- CODE_jungle_right_wall: jungle right-edge wall stamp.
; Parallels ys_bgsc1.asm. Mirror of CODE_jungle_left_wall with its
; own tile-table pair (DATA_1391A8 / DATA_1391AE,
; 3 entries each).
;-------------------------------------------------------------------------
CODE_1391B4:
CODE_jungle_right_wall:                                          ; descriptive alias
	REP.b #$30
	LDA.b $28
	BEQ.b CODE_1391C6
	LDA.b $2C
	CMP.w #$0001
	BNE.b CODE_1391F6
	LDA.w #$964E
	BRA.b CODE_1391F0

CODE_1391C6:
	LDA.b $2C
	CMP.w #$0003
	BCS.b CODE_jungle_right_wall_random_body
	ASL
	TAY
	LDA.w DATA_1391A8,y
	STA.b $0A
	BRA.b CODE_1391F0

CODE_1391D6:
CODE_jungle_right_wall_random_body:
	JSL.l CODE_prng
	AND.w #$0001
	CLC
	ADC.w #$9062
	STA.b $0A
	JSR.w CODE_jungle_wall_neighbour_classify
	TYA
	BMI.b CODE_jungle_right_wall_store
	LDA.w DATA_1391AE,y
	STA.b $0A
CODE_1391EE:
CODE_jungle_right_wall_store:
	LDA.b $0A
CODE_1391F0:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_1391F6:
	SEP.b #$30
	RTL

CODE_1391F9:
CODE_jungle_wall_neighbour_classify:
	LDY.w #$0000
	LDA.b $12
	CMP.w #$9200
	BCC.b CODE_139208
	CMP.w #$9204
	BCC.b CODE_139223
CODE_139208:
	INY
	INY
	CMP.w #$9080
	BCC.b CODE_139214
CODE_13920F:
	CMP.w #$9084
	BCC.b CODE_139223
CODE_139214:
	INY
	INY
	CMP.w #$9090
	BCC.b CODE_139220
	CMP.w #$9094
	BCC.b CODE_139223
CODE_139220:
	LDY.w #$FFFF
CODE_139223:
	RTS

DATA_139224:
	dw $9608,$9300

;-------------------------------------------------------------------------
; CODE_jungle_mud_floor -- CODE_jungle_mud_floor: jungle mud-floor stamp.
; Parallels ys_bgsc1.asm (mud). Top 2 rows have
; mud-specific tiles from DATA_139224 ($9608/$9300)
; offset by a random byte; deeper rows fall through to the jungle-floor
; random body (CODE_jungle_floor_random_body).
;-------------------------------------------------------------------------
CODE_139228:
CODE_jungle_mud_floor:                                           ; descriptive alias
	REP.b #$30
	LDA.b $2C
	CMP.w #$0002
	BCC.b CODE_jungle_mud_floor_topbody
	JMP.w CODE_jungle_floor_random_body

CODE_139234:
CODE_jungle_mud_floor_topbody:
	JSL.l CODE_prng
	AND.w #$0003
	STA.b $00
	LDA.b $2C
	ASL
	TAY
	LDA.b $00
	CLC
	ADC.w DATA_139224,y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_139250:
	dw $9400,$9502

DATA_139254:
	dw CODE_jungle_left_wall_random_body
	dw CODE_jungle_right_wall_random_body

DATA_139258:
	dw CODE_jungle_mud_wall_left_body
	dw CODE_jungle_mud_wall_right_body

;-------------------------------------------------------------------------
; CODE_jungle_mud_wall_left_right -- CODE_jungle_mud_wall_left_right: jungle mud-wall edge stamp.
; Parallels ys_bgsc1.asm.
; Orientation $15 picks left vs right. Top row dispatches via
; DATA_139254 (ptrs to CODE_jungle_left_wall_random_body and
; CODE_jungle_right_wall_random_body); other rows go through DATA_139258
; (per-side neighbour-write routines CODE_jungle_mud_wall_left_body /
; CODE_jungle_mud_wall_right_body) then stamps from DATA_139250.
;-------------------------------------------------------------------------
CODE_13925C:
CODE_jungle_mud_wall_left_right:                                 ; descriptive alias
	REP.b #$30
	LDX.b $15
	LDA.b $2C
	BEQ.b CODE_139267
	JMP.w (DATA_139254,x)

CODE_139267:
	JSR.w (DATA_139258,x)
	LDX.b $15
	LDA.w DATA_139250,x
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_139278:
CODE_jungle_mud_wall_left_body:
	JSR.w CODE_probe_right_tile
	CMP.w #$9090
	BCC.b CODE_1392DF
	CMP.w #$9094
	BCS.b CODE_1392DF
	LDA.w #$908F
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.w #$964D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	AND.w #$F0F0
	SEC
	SBC.w #$0010
	AND.w #$F0F0
	STA.b $00
	LDA.b $1B
	AND.w #$0F0F
	ORA.b $00
	STA.b $0E
	JSL.l CODE_get_map16_right
	LDA.w #$330D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	AND.w #$F0F0
	SEC
	SBC.w #$0020
	AND.w #$F0F0
	STA.b $00
	LDA.b $1B
	AND.w #$0F0F
	ORA.b $00
	STA.b $0E
	JSL.l CODE_get_map16_right
	LDA.w #$9204
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_1392DF:
	RTS

CODE_1392E0:
CODE_jungle_mud_wall_right_body:
	JSR.w CODE_probe_left_tile
	CMP.w #$9090
	BCC.b CODE_139347
	CMP.w #$9094
	BCS.b CODE_139347
	LDA.w #$907F
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.w #$964E
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	AND.w #$F0F0
	SEC
	SBC.w #$0010
	AND.w #$F0F0
	STA.b $00
	LDA.b $1B
	AND.w #$0F0F
	ORA.b $00
	STA.b $0E
	JSL.l CODE_get_map16_left
	LDA.w #$3512
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	AND.w #$F0F0
	SEC
	SBC.w #$0020
	AND.w #$F0F0
	STA.b $00
	LDA.b $1B
	AND.w #$0F0F
	ORA.b $00
	STA.b $0E
	JSL.l CODE_get_map16_left
	LDA.w #$9205
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_139347:
	RTS

DATA_139348:
	dw $9400,$905C

DATA_13934C:
	dw $9402,$90A2,$9072

;-------------------------------------------------------------------------
; CODE_jungle_slope_left_down -- CODE_jungle_slope_left_down: jungle left-down-right-up
; diagonal floor (LDRU slope) stamp.
; Parallels ys_bgsc1.asm. Rows 0..2 use the slope-edge data
; tables DATA_139348 / DATA_13934C; row
; 2 with no left neighbour stamps $908F directly; deeper rows fall
; through to the jungle-floor random body (CODE_jungle_floor_random_body).
;-------------------------------------------------------------------------
CODE_139352:
CODE_jungle_slope_left_down:                                     ; descriptive alias
	REP.b #$30
	LDA.w #$0001
	STA.b $9B
	LDA.b $2C
	CMP.w #$0003
	BCC.b CODE_jungle_slope_left_down_body
	JMP.w CODE_jungle_floor_random_body

CODE_139363:
CODE_jungle_slope_left_down_body:
	LDA.b $28
	BNE.b CODE_1393A2
	LDA.b $12
	CMP.w #$9080
	BCC.b CODE_139373
	CMP.w #$9084
	BCC.b CODE_13937F
CODE_139373:
	CMP.w #$9090
	BCC.b CODE_1393A2
	CMP.w #$9094
	BCC.b CODE_13939D
	BRA.b CODE_1393A2

CODE_13937F:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.w #$9204
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_probe_left_tile
	LDA.w #$964D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.w #$330D
	BRA.b CODE_1393D7

CODE_13939D:
	LDA.w #$908F
	BRA.b CODE_1393D7

CODE_1393A2:
	JSL.l CODE_prng
	AND.w #$0001
	STA.b $00
	LDA.b $2C
	ASL
	TAY
	LDA.w DATA_139348,y
	CLC
	ADC.b $00
	STA.b $0A
	LDA.b $28
	DEC
	CMP.b $2A
	BNE.b CODE_jungle_slope_left_down_row2_fallthrough
	JSR.w CODE_jungle_wall_neighbour_classify
	TYA
	BMI.b CODE_jungle_slope_left_down_row2_fallthrough
	LDA.w DATA_13934C,y
	STA.b $0A
	BRA.b CODE_jungle_slope_left_down_store

CODE_1393CB:
CODE_jungle_slope_left_down_row2_fallthrough:
	LDA.b $2C
	CMP.w #$0002
	BNE.b CODE_jungle_slope_left_down_store
	JMP.w CODE_jungle_floor_random_body

CODE_1393D5:
CODE_jungle_slope_left_down_store:
	LDA.b $0A
CODE_1393D7:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_1393E0:
	dw $9501,$905E

DATA_1393E4:
	dw $9500,$90A3,$9073

;-------------------------------------------------------------------------
; CODE_jungle_slope_right_down -- CODE_jungle_slope_right_down: jungle right-down-left-up
; diagonal floor (LURD slope) stamp.
; Parallels ys_bgsc1.asm. Mirror of CODE_jungle_slope_left_down with its own
; data tables (DATA_1393E0 / DATA_1393E4).
;-------------------------------------------------------------------------
CODE_1393EA:
CODE_jungle_slope_right_down:                                    ; descriptive alias
	REP.b #$30
	LDA.w #$0001
	STA.b $9B
	LDA.b $2C
	CMP.w #$0003
	BCC.b CODE_jungle_slope_right_down_body
	JMP.w CODE_jungle_floor_random_body

CODE_1393FB:
CODE_jungle_slope_right_down_body:
	LDA.b $28
	BNE.b CODE_13943A
	LDA.b $12
	CMP.w #$9080
	BCC.b CODE_13940B
	CMP.w #$9084
	BCC.b CODE_139417
CODE_13940B:
	CMP.w #$9090
	BCC.b CODE_13943A
	CMP.w #$9094
	BCC.b CODE_139435
	BRA.b CODE_13943A

CODE_139417:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.w #$9205
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_probe_right_tile
	LDA.w #$964E
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.w #$3512
	BRA.b CODE_13946F

CODE_139435:
	LDA.w #$907F
	BRA.b CODE_13946F

CODE_13943A:
	JSL.l CODE_prng
	AND.w #$0001
	STA.b $00
	LDA.b $2C
	ASL
	TAY
	LDA.w DATA_1393E0,y
	CLC
	ADC.b $00
	STA.b $0A
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_jungle_slope_right_down_row2_fallthrough
	JSR.w CODE_jungle_wall_neighbour_classify
	TYA
	BMI.b CODE_jungle_slope_right_down_row2_fallthrough
	LDA.w DATA_1393E4,y
	STA.b $0A
	BRA.b CODE_jungle_slope_right_down_store

CODE_139463:
CODE_jungle_slope_right_down_row2_fallthrough:
	LDA.b $2C
	CMP.w #$0002
	BNE.b CODE_jungle_slope_right_down_store
	JMP.w CODE_jungle_floor_random_body

CODE_13946D:
CODE_jungle_slope_right_down_store:
	LDA.b $0A
CODE_13946F:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_139478:
	dw $9B01,$9B00,$9639,$9638,$9629,$9628,$9631,$9630
	dw $961B,$9620

DATA_13948C:
	dw $961D,$961C,$963D,$963C,$962D,$962C,$9635,$9634
	dw $961B,$9624

DATA_1394A0:
	dw $960E,$960F,$963A,$963B,$962A,$962B,$9632,$9633
	dw $961B,$9623

DATA_1394B4:
	dw $9B02,$9B03,$963E,$963F,$962E,$962F,$9636,$9637
	dw $961B,$9627

DATA_1394C8:
	dw DATA_139478,DATA_13948C,DATA_1394A0,DATA_1394B4

;-------------------------------------------------------------------------
; CODE_jungle_treetop_canopy: jungle treetop-canopy stamp (left/right half by $15 + column parity).
; Parallels ys_bgsc1.asm.
; Selects from one of 4 tile tables (DATA_139478 / DATA_13948C /
; DATA_1394A0 / DATA_1394B4)
; routed via DATA_1394C8 by orientation + column parity.
;-------------------------------------------------------------------------
CODE_1394D0:
CODE_jungle_treetop_canopy:                                            ; descriptive alias
	REP.b #$30
	LDA.b $28
	AND.w #$0001
	STA.b $00
	BNE.b CODE_1394EC
	STZ.b $9B
	LDA.b $2C
	BNE.b CODE_1394F1
	JSL.l CODE_prng
	AND.w #$0002
	STA.b $A1
	BRA.b CODE_1394F1

CODE_1394EC:
	LDA.w #$0001
	STA.b $9B
CODE_1394F1:
	LDA.b $2C
	EOR.w #$FFFF
	INC
	CMP.w #$0005
	BCS.b CODE_13950F
	ASL
	ADC.b $00
	ASL
	TAY
	LDA.b $A1
	ORA.b $15
	TAX
	LDA.w DATA_1394C8,x
	STA.b $00
	LDA.b ($00),y
	BRA.b CODE_139512

CODE_13950F:
	LDA.w #$961B
CODE_139512:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

;-------------------------------------------------------------------------
; CODE_jungle_stake -- CODE_jungle_stake: jungle vertical stake stamp.
; Parallels ys_bgsc1.asm (stake / post). Picks
; top / middle / bottom of the stake via row position $2C vs $2E, then
; adds base from WRAM $1DCE. Final row also stamps a base-cap from
; $1DD4.
;-------------------------------------------------------------------------
CODE_13951B:
CODE_jungle_stake:                                               ; descriptive alias
	REP.b #$30
	LDY.w #$0000
	LDA.b $2C
	BEQ.b CODE_13952B
	INY
	INC
	CMP.b $2E
	BNE.b CODE_13952B
	INY
CODE_13952B:
	TYA
	CLC
	ADC.w $1DCE
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $2E
	DEC
	BNE.b CODE_139542
	LDA.w $1DD4
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_139542:
	SEP.b #$30
	RTL

DATA_139545:
	dw $330E,$3511

;-------------------------------------------------------------------------
; CODE_jungle_stone -- CODE_jungle_stone: jungle stone-block stamp.
; Parallels ys_bgsc1.asm ("stone"). Top row stamps from
; DATA_139545 (2 entries, $330E/$3511); first column
; uses random base $90DA + 0/2/4/6; deeper non-edge cells reads the
; left-neighbour tile and increments it ("continuation tile").
;-------------------------------------------------------------------------
CODE_139549:
CODE_jungle_stone:                                               ; descriptive alias
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_139558
	LDA.b $28
	ASL
	TAY
	LDA.w DATA_139545,y
	BRA.b CODE_jungle_stone_store

CODE_139558:
	LDA.b $28
	BNE.b CODE_139569
	JSL.l CODE_prng
	AND.w #$0006
	CLC
	ADC.w #$90DA
	BRA.b CODE_jungle_stone_store

CODE_139569:
	JSR.w CODE_probe_left_tile
	INC
CODE_13956D:
CODE_jungle_stone_store:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_139576:
	dw CODE_jungle_vine_thin_left_pick
	dw CODE_jungle_vine_thin_right_pick

DATA_13957A:
	dw $9094,$9084

DATA_13957E:
	dw $908E,$907E

DATA_139582:
	dw DATA_13957A,DATA_13957E

DATA_139586:
	dw $9064,$9074,$9064

;-------------------------------------------------------------------------
; CODE_jungle_vine_thin -- CODE_jungle_vine_thin: jungle thin-vine vertical stamp.
; Parallels ys_bgsc1.asm (vine/tendril).
; Dispatches via DATA_139576 (ptrs to CODE_jungle_vine_thin_left_pick and
; CODE_jungle_vine_thin_right_pick). Tile tables: DATA_13957A /
; DATA_13957E and DATA_139586.
;-------------------------------------------------------------------------
CODE_13958C:
CODE_jungle_vine_thin:                                           ; descriptive alias
	REP.b #$30
	LDX.b $A1
	LDA.b $2E
	CLC
	SBC.b $2C
	CMP.w #$0002
	BCC.b CODE_1395B4
	LDA.b $2C
	CMP.w #$0004
	BCS.b CODE_1395A8
	ASL
	TAY
	JSR.w (DATA_139576,x)
	BRA.b CODE_1395BD

CODE_1395A8:
	AND.w #$0001
	ASL
	ADC.b $A1
	TAY
	LDA.w DATA_139586,y
	BRA.b CODE_1395BD

CODE_1395B4:
	ASL
	TAY
	LDA.w DATA_139582,x
	STA.b $00
	LDA.b ($00),y
CODE_1395BD:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_1395C6:
	dw $9211,$9065,$9075,$9085

CODE_1395CE:
CODE_jungle_vine_thin_left_pick:
	LDA.b $2C
	BNE.b CODE_1395DE
	LDA.b $12
	CMP.w #$9214
	BNE.b CODE_1395DE
	LDA.w #$9213
	BRA.b CODE_1395E1

CODE_1395DE:
	LDA.w DATA_1395C6,y
CODE_1395E1:
	RTS

DATA_1395E2:
	dw $9212,$9078,$9088,$9079

CODE_1395EA:
CODE_jungle_vine_thin_right_pick:
	LDA.b $2C
	BNE.b CODE_1395FA
	LDA.b $12
	CMP.w #$9214
	BNE.b CODE_1395FA
	LDA.w #$9216
	BRA.b CODE_1395FD

CODE_1395FA:
	LDA.w DATA_1395E2,y
CODE_1395FD:
	RTS

;-------------------------------------------------------------------------
; CODE_jungle_vine_thin_plus_extras -- CODE_jungle_vine_thin_plus_extras: jungle thin-vine with
; mid-stretch random decoration variants.
; Parallels ys_bgsc1.asm. First JSLs into CODE_jungle_vine_thin
; for the base vine stamp, then if we are between rows
; 4 and (extent - 2), rolls a 50/50 chance to add a side-decoration
; (probes left/right neighbour to pick a $907A/$907B branch tile or a
; $908A/$9089 leaf tile).
;-------------------------------------------------------------------------
CODE_1395FE:
CODE_jungle_vine_thin_plus_extras:                               ; [decorator] descriptive alias
	JSL.l CODE_jungle_vine_thin
	LDA.b $2C
	CMP.b #$04
	BCC.b CODE_139651
	LDA.b $2E
	CLC
	SBC.b $2C
	CMP.b #$02
	BCC.b CODE_139651
	REP.b #$30
	JSL.l CODE_prng
	AND.w #$0002
	BEQ.b CODE_13964F
	LDA.b $1B
	STA.b $0E
	LDX.b $1D
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$9064
	BNE.b CODE_13963B
	JSL.l CODE_get_map16_left
	LDA.w #$907A
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.w #$907B
	BRA.b CODE_139649

CODE_13963B:
	JSL.l CODE_get_map16_right
	LDA.w #$908A
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.w #$9089
CODE_139649:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13964F:
	SEP.b #$30
CODE_139651:
	RTL

DATA_139652:
	dw $966F,$1530

DATA_139656:
	dw $9670,$9A00

DATA_13965A:
	dw $9671,$1531

;-------------------------------------------------------------------------
; CODE_jungle_wood -- CODE_jungle_wood: jungle wooden-log horizontal stamp.
; Parallels ys_bgsc1.asm. Top 2 rows have specific
; left-cap / right-cap / middle tiles from DATA_139652 / DATA_139656 /
; DATA_13965A (2 entries each); deeper
; rows pick random under-trunk variants.
;-------------------------------------------------------------------------
CODE_13965E:
CODE_jungle_wood:                                                ; descriptive alias
	REP.b #$30
	LDA.b $2C
	CMP.w #$0002
	BCS.b CODE_139682
	ASL
	TAY
	JSR.w CODE_probe_left_tile
	LDA.w DATA_139652,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_probe_right_tile
	LDA.w DATA_13965A,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.w DATA_139656,y
	BRA.b CODE_1396A1

CODE_139682:
	INC
	CMP.b $2E
	BEQ.b CODE_13969E
	CMP.w #$0003
	BNE.b CODE_139691
	LDA.w #$990A
	BRA.b CODE_1396A1

CODE_139691:
	JSL.l CODE_prng
	AND.w #$0002
	LSR
	ADC.w #$990B
	BRA.b CODE_1396A1

CODE_13969E:
	LDA.w #$9206
CODE_1396A1:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_1396AA:
	dw $9213,$9214,$9213,$9216

;-------------------------------------------------------------------------
; CODE_jungle_tree_trunk_with_branches -- CODE_jungle_tree_trunk_with_branches: jungle tree-trunk
; stamp with branch-spawn handling.
; Parallels ys_bgsc1.asm. Row 0 reads the current cell's
; tile-page and the cell above to potentially overwrite the above-cell
; with a "trunk meets branch" continuation; subsequent rows handle
; trunk-mid / branch-junction tiles with neighbour-aware look-ups into
; DATA_1396AA (analogue).
;-------------------------------------------------------------------------
CODE_1396B2:
CODE_jungle_tree_trunk_with_branches:                            ; [decorator] descriptive alias
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_1396F6
	LDA.b $12
	CMP.w #$9B00
	BCC.b CODE_jungle_tree_trunk_above_blend
	CMP.w #$9B04
	BCS.b CODE_jungle_tree_trunk_above_blend
	JMP.w CODE_jungle_tree_trunk_exit

CODE_1396C7:
CODE_jungle_tree_trunk_above_blend:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDY.w #$0000
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$963B
	BEQ.b CODE_1396ED
	INY
	CMP.w #$963C
	BEQ.b CODE_1396ED
	INY
	CMP.w #$960E
	BEQ.b CODE_1396ED
	INY
	CMP.w #$961D
	BNE.b CODE_1396F6
CODE_1396ED:
	TYA
	CLC
	ADC.w #$9B04
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_1396F6:
	LDY.w #$0000
	LDA.b $12
	CMP.w #$960F
	BEQ.b CODE_139706
	INY
	CMP.w #$961C
	BNE.b CODE_13970D
CODE_139706:
	TYA
	CLC
	ADC.w #$9900
	BRA.b CODE_13975A

CODE_13970D:
	JSL.l CODE_prng
	AND.w #$0001
	STA.b $00
	LDA.b $2C
	INC
	CMP.b $2E
	BEQ.b CODE_139725
	LDA.b $00
	CLC
	ADC.w #$9908
	BRA.b CODE_139757

CODE_139725:
	LDA.b $12
	AND.w #$FF00
	CMP.w #$9200
	BNE.b CODE_139745
	LDA.b $12
	CMP.w #$920F
	BCS.b CODE_13973B
	LDA.w #$9215
	BRA.b CODE_13975A

CODE_13973B:
	SBC.w #$920F
	ASL
	TAY
	LDA.w DATA_1396AA,y
	BRA.b CODE_13975A

CODE_139745:
	LDA.b $00
	CLC
	ADC.w #$00AC
	LDX.b $A1
	BEQ.b CODE_13975A
	LDA.b $00
	CLC
	ADC.w #$00AE
	BRA.b CODE_13975A

CODE_139757:
	CLC
	ADC.b $A1
CODE_13975A:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_139760:
CODE_jungle_tree_trunk_exit:
	SEP.b #$30
	RTL

DATA_139763:
	dw CODE_jungle_tree_leaves_both_sides
	dw CODE_jungle_tree_leaves_left
	dw CODE_jungle_tree_leaves_right

;-------------------------------------------------------------------------
; CODE_jungle_tree_trunk_with_leaves -- CODE_jungle_tree_trunk_with_leaves: jungle tree-trunk plus
; random leaf-cluster decoration.
; Parallels ys_bgsc1.asm. First JSLs CODE_jungle_tree_trunk_with_branches
; for the base trunk stamp. On non-edge rows, rolls a
; random byte to decide whether to also stamp a leaf-tile + invoke one
; of CODE_jungle_tree_leaves_both_sides / CODE_jungle_tree_leaves_left / CODE_jungle_tree_leaves_right via DATA_139763
; to write 1-2 neighbouring leaf cells.
;-------------------------------------------------------------------------
CODE_139769:
CODE_jungle_tree_trunk_with_leaves:                              ; descriptive alias
	JSL.l CODE_jungle_tree_trunk_with_branches
	LDA.b $2C
	BEQ.b CODE_1397A1
	CMP.b #$01
	BEQ.b CODE_1397A1
	INC
	CMP.b $2E
	BEQ.b CODE_1397A1
	REP.b #$30
	JSL.l CODE_prng
	AND.w #$0007
	CMP.w #$0006
	BCS.b CODE_13979F
	STA.b $0A
	ADC.w #$9902
	CLC
	ADC.b $A1
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $0A
	AND.w #$000E
	TAX
	JSR.w (DATA_139763,x)
CODE_13979F:
	SEP.b #$30
CODE_1397A1:
	RTL

CODE_1397A2:
CODE_jungle_tree_leaves_both_sides:
	JSR.w CODE_jungle_tree_leaves_left
	JSR.w CODE_jungle_tree_leaves_right
	RTS

DATA_1397A9:
	dw $9672,$9674

CODE_1397AD:
CODE_jungle_tree_leaves_left:
	JSR.w CODE_probe_left_tile
	LDA.b $0A
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_1397A9,y
	LDY.b $A1
	BEQ.b CODE_1397C2
	INC
	INC
	INC
	INC
CODE_1397C2:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

DATA_1397C7:
	dw $9673,$9675

CODE_1397CB:
CODE_jungle_tree_leaves_right:
	JSR.w CODE_probe_right_tile
	LDA.b $0A
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_1397C7,y
	LDY.b $A1
	BEQ.b CODE_1397E0
	INC
	INC
	INC
	INC
CODE_1397E0:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

DATA_1397E5:
	dw CODE_jungle_block_pattern_a_top
	dw CODE_jungle_block_pattern_a_mid
	dw CODE_jungle_block_pattern_a_bot

;-------------------------------------------------------------------------
; CODE_jungle_block_pattern_a -- CODE_jungle_block_pattern_a: jungle patterned-block stamp,
; variant 0.
; Parallels ys_bgsc1.asm. Dispatches to top / middle /
; bottom row handler via DATA_1397E5 (CODE_jungle_block_pattern_a_top,
; CODE_jungle_block_pattern_a_mid, CODE_jungle_block_pattern_a_bot).
; Mid-row body further dispatches per column via
; DATA_139822 (per-column left / mid /
; right handlers).
;-------------------------------------------------------------------------
CODE_1397EB:
CODE_jungle_block_pattern_a:                                     ; [decorator] descriptive alias
	REP.b #$30
	LDX.w #$0000
	LDA.b $2C
	BEQ.b CODE_1397FD
	INX
	INX
	INC
	CMP.b $2E
	BNE.b CODE_1397FD
	INX
	INX
CODE_1397FD:
	JSR.w (DATA_1397E5,x)
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_139809:
CODE_jungle_block_pattern_a_top:
	LDA.w #$90A8
	LDY.b $28
	BEQ.b CODE_139821
	INC
	INY
	CPY.b $2A
	BEQ.b CODE_139821
	JSL.l CODE_prng
	AND.w #$0001
	CLC
	ADC.w #$90BE
CODE_139821:
	RTS

DATA_139822:
	dw CODE_jungle_block_pattern_a_mid_left
	dw CODE_jungle_block_pattern_a_mid_center
	dw CODE_jungle_block_pattern_a_mid_right

CODE_139828:
CODE_jungle_block_pattern_a_mid:
	JSL.l CODE_prng
	AND.w #$0007
	TAY
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_139840
	INX
	INX
	INC
	CMP.b $2A
	BNE.b CODE_139840
	INX
	INX
CODE_139840:
	LDA.b $1B
	STA.b $0E
	JSR.w (DATA_139822,x)
	LDA.b $04
	RTS

CODE_13984A:
CODE_jungle_block_pattern_a_mid_left:
	TYA
	AND.w #$0003
	CLC
	ADC.w #$90B6
	STA.b $04
	JSL.l CODE_get_map16_left
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$90C4
	BEQ.b CODE_139870
	CMP.w #$90C5
	BEQ.b CODE_139870
	CMP.w #$90C6
	BEQ.b CODE_139870
	CMP.w #$90C7
	BNE.b CODE_139878
CODE_139870:
	LDA.b $04
	INC
	INC
	INC
	INC
	STA.b $04
CODE_139878:
	RTS

CODE_139879:
CODE_jungle_block_pattern_a_mid_center:
	TYA
	CLC
	ADC.w #$90D2
	STA.b $04
	RTS

CODE_139881:
CODE_jungle_block_pattern_a_mid_right:
	TYA
	AND.w #$0003
	CLC
	ADC.w #$90C4
	STA.b $04
	JSL.l CODE_get_map16_right
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$90B6
	BEQ.b CODE_1398A7
	CMP.w #$90B7
	BEQ.b CODE_1398A7
	CMP.w #$90B8
	BEQ.b CODE_1398A7
	CMP.w #$90B9
	BNE.b CODE_1398AF
CODE_1398A7:
	LDA.b $04
	INC
	INC
	INC
	INC
	STA.b $04
CODE_1398AF:
	RTS

CODE_1398B0:
CODE_jungle_block_pattern_a_bot:
	LDA.b $12
	AND.w #$FF00
	CMP.w #$9200
	BNE.b CODE_1398D4
	LDA.w #$90CC
	LDX.b $28
	BEQ.b CODE_1398EC
	INC
	INX
	CPX.b $2A
	BEQ.b CODE_1398EC
	JSL.l CODE_prng
	AND.w #$0003
	CLC
	ADC.w #$90CE
	BRA.b CODE_1398EC

CODE_1398D4:
	LDA.w #$90AE
	LDX.b $28
	BEQ.b CODE_1398EC
	INC
	INX
	CPX.b $2A
	BEQ.b CODE_1398EC
	JSL.l CODE_prng
	AND.w #$0003
	CLC
	ADC.w #$90B2
CODE_1398EC:
	RTS

DATA_1398ED:
	dw CODE_jungle_block_pattern_b_top
	dw CODE_jungle_block_pattern_a_mid
	dw CODE_jungle_block_pattern_a_bot

;-------------------------------------------------------------------------
; CODE_jungle_block_pattern_b -- CODE_jungle_block_pattern_b: jungle patterned-block stamp,
; variant 1.
; Parallels ys_bgsc1.asm. Same overall row-dispatch shape
; as CODE_jungle_block_pattern_a, but the top-row handler routes to
; CODE_jungle_block_pattern_b_top (with different tile base $90AA vs
; $90A8). Shares the mid-row / bottom-row bodies with variant a.
;-------------------------------------------------------------------------
CODE_1398F3:
CODE_jungle_block_pattern_b:                                     ; descriptive alias
	REP.b #$30
	LDX.w #$0000
	LDA.b $2C
	BEQ.b CODE_139905
	INX
	INX
	INC
	CMP.b $2E
	BNE.b CODE_139905
	INX
	INX
CODE_139905:
	JSR.w (DATA_1398ED,x)
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_139911:
CODE_jungle_block_pattern_b_top:
	LDA.w #$90AA
	LDX.b $28
	BEQ.b CODE_139929
	INC
	INX
	CPX.b $2A
	BEQ.b CODE_139929
	JSL.l CODE_prng
	AND.w #$0003
	CLC
	ADC.w #$90C0
CODE_139929:
	RTS

DATA_13992A:
	dw $9640,$964F

DATA_13992E:
	dw $9641,$9650

DATA_139932:
	dw $9642,$9651

DATA_139936:
	dw $9643,$9652

DATA_13993A:
	dw $9644,$9653

DATA_13993E:
	dw $9645,$9654

DATA_139942:
	dw $9646,$9655

DATA_139946:
	dw $9647,$9656

DATA_13994A:
	dw $9648,$9657

DATA_13994E:
	dw $9649,$9658

DATA_139952:
	dw $964A,$9659

DATA_139956:
	dw $964B,$965A

DATA_13995A:
	dw $0000,$965B

DATA_13995E:
	dw $0000,$965C

DATA_139962:
	dw $0000,$965D

DATA_139966:
	dw $0000,$965E

DATA_13996A:
	dw DATA_13992A,DATA_13992E,DATA_139932,DATA_139936,DATA_13993A,DATA_13993E,DATA_139942,DATA_139946
	dw DATA_13994A,DATA_13994E,DATA_139952,DATA_139956,DATA_13995A,DATA_13995E,DATA_139962,DATA_139966

;-------------------------------------------------------------------------
; CODE_jungle_cattail_random -- CODE_jungle_cattail_random: jungle thick-vine random
; pattern stamp.
; Parallels ys_bgsc1.asm. Picks 1 of 16 vine-pattern tables
; (DATA_13992A..DATA_139966) via DATA_13996A on the
; first row using a random byte, then walks down the pattern. If the
; existing tile is part of a thorn-cluster ($9608..$960B), shifts the
; output tile by +$0010 to use the thorned variant.
;-------------------------------------------------------------------------
CODE_13998A:
CODE_jungle_cattail_random:                                   ; [decorator] descriptive alias
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_139999
	JSL.l CODE_prng
	AND.w #$001E
	STA.b $A1
CODE_139999:
	LDA.b $2C
	ASL
	TAY
	LDX.b $A1
	LDA.w DATA_13996A,x
	STA.b $00
	LDA.b ($00),y
	BEQ.b CODE_1399D6
	STA.b $00
	LDX.b $1D
	LDY.b $2C
	BEQ.b CODE_1399D0
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$9608
	BEQ.b CODE_1399C8
	CMP.w #$9609
	BEQ.b CODE_1399C8
	CMP.w #$960A
	BEQ.b CODE_1399C8
	CMP.w #$960B
	BNE.b CODE_1399D0
CODE_1399C8:
	LDA.b $00
	CLC
	ADC.w #$0010
	STA.b $00
CODE_1399D0:
	LDA.b $00
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_1399D6:
	SEP.b #$30
	RTL

DATA_1399D9:
	dw $1619,$161A,$1626,$1627

DATA_1399E1:
	dw $161B,$161C,$1628,$1628

DATA_1399E9:
	dw DATA_1399E1,DATA_1399D9,DATA_1399E1,DATA_1399E1

DATA_1399F1:
	dw $9098,$9099,$909A,$9098

;-------------------------------------------------------------------------
; CODE_jungle_water -- CODE_jungle_water: jungle-tinted water surface stamp.
; Parallels ys_bgsc1.asm. Jungle-themed waterline that
; respects underlying tile-page (different overlay tile if previous tile
; was foliage ($9000..$95FF), platform-tip ($6B00), or border ($9300)).
; Picks from per-column 4-entry tables via DATA_1399E9 indexed by $15.
;-------------------------------------------------------------------------
CODE_1399F9:
CODE_jungle_water:                                               ; descriptive alias
	REP.b #$30
	LDA.b $28
	AND.w #$0001
	STA.b $00
	LDA.b $2C
	BEQ.b CODE_139A10
	CMP.w #$0002
	BCC.b CODE_139A1D
	LDA.w #$1628
	BRA.b CODE_139A2D

CODE_139A10:
	LDA.b $00
	BNE.b CODE_139A1D
	JSL.l CODE_prng
	AND.w #$0006
	STA.b $15
CODE_139A1D:
	LDX.b $15
	LDA.w DATA_1399E9,x
	STA.b $02
	LDA.b $2C
	ASL
	ADC.b $00
	ASL
	TAY
	LDA.b ($02),y
CODE_139A2D:
	STA.b $00
	LDA.b $12
	AND.w #$FF00
	CMP.w #$6B00
	BEQ.b CODE_139A43
	CMP.w #$9300
	BEQ.b CODE_139A43
	CMP.w #$9000
	BNE.b CODE_139A65
CODE_139A43:
	STZ.b $15
	LDA.b $2C
	BNE.b CODE_139A4E
	LDA.w #$9061
	BRA.b CODE_139A7C

CODE_139A4E:
	CMP.w #$0002
	BCS.b CODE_139A60
	JSL.l CODE_prng
	AND.w #$0006
	TAY
	LDA.w DATA_1399F1,y
	BRA.b CODE_139A7C

CODE_139A60:
	LDA.w #$909B
	BRA.b CODE_139A7C

CODE_139A65:
	CMP.w #$9400
	BEQ.b CODE_139A74
	CMP.w #$9500
	BNE.b CODE_139A7E
	LDA.w #$9800
	BRA.b CODE_139A77

CODE_139A74:
	LDA.w #$9700
CODE_139A77:
	LDY.b $2C
	BEQ.b CODE_139A7C
	INC
CODE_139A7C:
	STA.b $00
CODE_139A7E:
	LDA.b $00
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

;-------------------------------------------------------------------------
; CODE_stamp_red_platform_tile -- CODE_stamp_red_platform_tile: red platform
; (single-tile, red-stairs visual style).
; Parallels ys_bgsc1.asm. Single-tile stamper: writes $1512
; only if the cell is currently empty (lets foreground tiles take
; precedence), forming a thin one-way platform behind the foreground.
;-------------------------------------------------------------------------
CODE_139A89:
CODE_stamp_red_platform_tile:                                ; descriptive alias
	REP.b #$30
	LDA.b $12
	BNE.b CODE_139A98
	LDA.w #$1512
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_139A98:
	SEP.b #$30
	RTL

DATA_139A9B:
	dw $9D00,$9D01,$9D02,$9D03,$9D0A,$9D0B,$9D0C,$9D0D
	dw $9D12,$9D13,$9D14,$9D15

DATA_139AB3:
	dw $9D1C,$9D1D,$9D1E,$9D1F,$9D24,$9D25,$9D26,$9D27
	dw $9D2A,$9D2B,$9D2C,$9D2D

DATA_139ACB:
	db $04,$05,$06,$07,$04,$05,$06,$07,$08,$09,$0E,$0B,$0C,$0F,$0E,$0F
	db $1A,$1B,$16,$17,$18,$19,$16,$17,$18,$19,$1A,$1B,$20,$21,$22,$23
	db $20,$21,$22,$23,$28,$25,$26,$29,$28,$29,$2E,$2F,$30,$31,$2E,$2F
	db $30,$31

DATA_139AFD:
	dw CODE_lava_rock_large_corner_tl
	dw CODE_lava_rock_large_edge_top
	dw CODE_lava_rock_large_edge_top
	dw CODE_lava_rock_large_corner_tr
	dw CODE_lava_rock_large_edge_left
	dw CODE_lava_rock_large_interior
	dw CODE_lava_rock_large_interior
	dw CODE_lava_rock_large_edge_right
	dw CODE_lava_rock_large_corner_bl
	dw CODE_lava_rock_large_edge_bottom
	dw CODE_lava_rock_large_edge_bottom
	dw CODE_lava_rock_large_corner_br

;-------------------------------------------------------------------------
; CODE_stamp_stone_large -- CODE_stamp_stone_large: large lava-rock structure stamp.
; Parallels ys_bgsc1.asm (rock). 12-tile big-rock
; pattern (3 rows x 4 cols) with mirror variant. Two tile tables
; DATA_139A9B / DATA_139AB3, selected by $15.
; After stamping, dispatches via DATA_139AFD (12 sub-handlers
; CODE_lava_rock_large_corner_tl..CODE_lava_rock_large_corner_br) to fill in adjacency / smoke / drip
; sub-tiles for this cell's position in the big-rock shape.
;-------------------------------------------------------------------------
CODE_139B15:
CODE_stamp_stone_large:                                            ; [decorator] descriptive alias
	REP.b #$30
	LDA.b $2C
	BEQ.b CODE_139B28
	INC
	CMP.b $2E
	BEQ.b CODE_139B25
	LDA.w #$0001
	BRA.b CODE_139B28

CODE_139B25:
	LDA.w #$0002
CODE_139B28:
	ASL
	ASL
	STA.b $00
	LDA.b $28
	BEQ.b CODE_139B3E
	INC
	CMP.b $2A
	BNE.b CODE_139B3A
	LDA.w #$0003
	BRA.b CODE_139B3E

CODE_139B3A:
	AND.w #$0001
	INC
CODE_139B3E:
	ORA.b $00
	ASL
	TAY
	LDA.b $15
	BNE.b CODE_139B4B
	LDA.w DATA_139A9B,y
	BRA.b CODE_139B4E

CODE_139B4B:
	LDA.w DATA_139AB3,y
CODE_139B4E:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	TYX
	JSR.w (DATA_139AFD,x)
	SEP.b #$30
	RTL

CODE_139B5B:
CODE_lava_rock_large_corner_tl:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	STX.b $04
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139BE4
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	STA.b $06
	JSR.w CODE_probe_left_tile
	STX.b $08
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139BE4
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	STA.b $0A
	LDA.b $1B
	TAX
	AND.w #$F0F0
	STA.b $00
	TXA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $00
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139BE4
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	JSR.w CODE_lava_rock_large_stamp_detail
	LDX.b $04
	LDA.b $06
	JSR.w CODE_lava_rock_large_stamp_detail
	LDX.b $08
	LDA.b $0A
	JSR.w CODE_lava_rock_large_stamp_detail
	LDX.b $1D
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139BE4
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	JSR.w CODE_lava_rock_large_stamp_detail
CODE_139BE4:
	RTS

CODE_139BE5:
CODE_lava_rock_large_edge_top:
	LDA.b $1B
	TAX
	AND.w #$F0F0
	STA.b $04
	TXA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $04
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139C5F
	LDA.b $1B
	AND.w #$0F0F
	ORA.w #$00F0
	INC
	AND.w #$0F0F
	ORA.b $04
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139C5F
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139C5F
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	JSR.w CODE_lava_rock_large_stamp_detail
	LDX.b $1D
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139C5F
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	JSR.w CODE_lava_rock_large_stamp_detail
CODE_139C5F:
	RTS

CODE_139C60:
CODE_lava_rock_large_corner_tr:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	STX.b $04
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139CEC
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	STA.b $06
	JSR.w CODE_probe_right_tile
	STX.b $08
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139CEC
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	STA.b $0A
	LDA.b $1B
	TAX
	AND.w #$F0F0
	STA.b $00
	TXA
	AND.w #$0F0F
	ORA.w #$00F0
	INC
	AND.w #$0F0F
	ORA.b $00
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139CEC
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	JSR.w CODE_lava_rock_large_stamp_detail
	LDX.b $04
	LDA.b $06
	JSR.w CODE_lava_rock_large_stamp_detail
	LDX.b $08
	LDA.b $0A
	JSR.w CODE_lava_rock_large_stamp_detail
	LDX.b $1D
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139CEC
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	JSR.w CODE_lava_rock_large_stamp_detail
CODE_139CEC:
	RTS

CODE_139CED:
CODE_lava_rock_large_edge_left:
	LDA.b $1B
	TAX
	AND.w #$F0F0
	STA.b $08
	TXA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $08
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139D5B
	LDA.b $1B
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $08
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139D5B
	JSR.w CODE_probe_left_tile
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139D5B
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	JSR.w CODE_lava_rock_large_stamp_detail
	LDX.b $1D
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139D5B
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	JSR.w CODE_lava_rock_large_stamp_detail
CODE_139D5B:
	RTS

CODE_139D5C:
CODE_lava_rock_large_interior:
	RTS

CODE_139D5D:
CODE_lava_rock_large_edge_right:
	LDA.b $1B
	TAX
	AND.w #$F0F0
	STA.b $08
	TXA
	AND.w #$0F0F
	ORA.w #$00F0
	INC
	AND.w #$0F0F
	ORA.b $08
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139DD1
	LDA.b $1B
	AND.w #$0F0F
	ORA.w #$00F0
	INC
	AND.w #$0F0F
	ORA.b $08
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139DD1
	JSR.w CODE_probe_right_tile
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139DD1
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	JSR.w CODE_lava_rock_large_stamp_detail
	LDX.b $1D
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139DD1
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	JSR.w CODE_lava_rock_large_stamp_detail
CODE_139DD1:
	RTS

CODE_139DD2:
CODE_lava_rock_large_corner_bl:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	STX.b $04
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139E5B
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	STA.b $06
	JSR.w CODE_probe_left_tile
	STX.b $08
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139E5B
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	STA.b $0A
	LDA.b $1B
	TAX
	AND.w #$F0F0
	STA.b $00
	TXA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $00
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139E5B
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	JSR.w CODE_lava_rock_large_stamp_detail
	LDX.b $04
	LDA.b $06
	JSR.w CODE_lava_rock_large_stamp_detail
	LDX.b $08
	LDA.b $0A
	JSR.w CODE_lava_rock_large_stamp_detail
	LDX.b $1D
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139E5B
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	JSR.w CODE_lava_rock_large_stamp_detail
CODE_139E5B:
	RTS

CODE_139E5C:
CODE_lava_rock_large_edge_bottom:
	LDA.b $1B
	TAX
	AND.w #$F0F0
	STA.b $08
	TXA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $08
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139ED6
	LDA.b $1B
	AND.w #$0F0F
	ORA.w #$00F0
	INC
	AND.w #$0F0F
	ORA.b $08
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139ED6
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139ED6
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	JSR.w CODE_lava_rock_large_stamp_detail
	LDX.b $1D
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139ED6
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	JSR.w CODE_lava_rock_large_stamp_detail
CODE_139ED6:
	RTS

CODE_139ED7:
CODE_lava_rock_large_corner_br:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	STX.b $04
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139F63
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	STA.b $06
	JSR.w CODE_probe_right_tile
	STX.b $08
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139F63
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	STA.b $0A
	LDA.b $1B
	TAX
	AND.w #$F0F0
	STA.b $00
	TXA
	AND.w #$0F0F
	ORA.w #$00F0
	INC
	AND.w #$0F0F
	ORA.b $00
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139F63
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	JSR.w CODE_lava_rock_large_stamp_detail
	LDX.b $04
	LDA.b $06
	JSR.w CODE_lava_rock_large_stamp_detail
	LDX.b $08
	LDA.b $0A
	JSR.w CODE_lava_rock_large_stamp_detail
	LDX.b $1D
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$9D00
	BNE.b CODE_139F63
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	JSR.w CODE_lava_rock_large_stamp_detail
CODE_139F63:
	RTS

CODE_139F64:
CODE_lava_rock_large_stamp_detail:
	TAY
	LDA.w DATA_139ACB,y
	AND.w #$00FF
	ORA.w #$9D00
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

DATA_139F73:
	dw $9D08,$9D09,$9D10,$9D11

DATA_139F7B:
	dw CODE_lava_rock_large_corner_tl
	dw CODE_lava_rock_large_corner_tr
	dw CODE_lava_rock_large_corner_bl
	dw CODE_lava_rock_large_corner_br

;-------------------------------------------------------------------------
; CODE_stamp_red_stone -- CODE_stamp_red_stone: small lava-rock structure stamp.
; Parallels ys_bgsc1.asm. 2x2 small-rock pattern from
; DATA_139F73 (4 tiles). Dispatches via DATA_139F7B
; (4 sub-handlers that share CODE_lava_rock_large_corner_tl/C60/DD2/ED7
; with the large lava-rock dispatcher) to write adjacency / drip sub-tiles.
;-------------------------------------------------------------------------
CODE_139F83:
CODE_stamp_red_stone:                                            ; descriptive alias
	REP.b #$30
	LDA.b $2C
	AND.w #$0001
	ASL
	STA.b $00
	LDA.b $28
	AND.w #$0001
	ORA.b $00
	ASL
	TAY
	LDA.w DATA_139F73,y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	TYX
	JSR.w (DATA_139F7B,x)
	SEP.b #$30
	RTL

DATA_139FA6:
	dw $1DF4,$1DF0

;-------------------------------------------------------------------------
; CODE_grass_slope_up_60deg_hole -- CODE_grass_slope_up_60deg_hole: grass-hole on upward-rising
; 60-degree slope stamp.
; Parallels ys_bgsc1.asm (grass-hole, rising 60-degree slope). Adjusts $2E (height) for first
; column / first row, then either stamps a dirt-tile via CODE_13C15F
; or a grass-slope tile via DATA_139FA6.
;-------------------------------------------------------------------------
CODE_139FAA:
CODE_grass_slope_up_60deg_hole:                                  ; descriptive alias
	REP.b #$30
	LDA.b $28
	BEQ.b CODE_139FC1
	LDA.b $2C
	BNE.b CODE_139FC1
	DEC.b $2E
	DEC.b $2E
	BEQ.b CODE_139FBC
	BPL.b CODE_139FC1
CODE_139FBC:
	LDA.w #$0001
	STA.b $2E
CODE_139FC1:
	LDA.b $2E
	CLC
	SBC.b $2C
	BEQ.b CODE_grass_slope_up_60deg_hole_slope_pick
	CMP.w #$0001
	BEQ.b CODE_grass_slope_up_60deg_hole_slope_pick
	JSR.w CODE_13C15F
	BRA.b CODE_grass_slope_up_60deg_hole_exit

CODE_139FD2:
CODE_grass_slope_up_60deg_hole_slope_pick:
	ASL
	TAY
	LDX.w DATA_139FA6,y
	LDA.w $0000,x
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_139FE0:
CODE_grass_slope_up_60deg_hole_exit:
	SEP.b #$30
	RTL

DATA_139FE3:
	dw $1DEC,$1DE8

;-------------------------------------------------------------------------
; CODE_grass_slope_down_60deg_hole -- CODE_grass_slope_down_60deg_hole: grass-hole on
; downward-going 60-degree slope stamp.
; Parallels ys_bgsc1.asm (grass-hole, downward 60-degree slope).
; Mirror of CODE_grass_slope_up_60deg_hole but increments $2E instead of decrementing. Tile
; table DATA_139FE3.
;-------------------------------------------------------------------------
CODE_139FE7:
CODE_grass_slope_down_60deg_hole:                                ; descriptive alias
	REP.b #$30
	LDA.b $28
	BEQ.b CODE_139FF5
	LDA.b $2C
	BNE.b CODE_139FF5
	INC.b $2E
	INC.b $2E
CODE_139FF5:
	LDA.b $2E
	CLC
	SBC.b $2C
	BEQ.b CODE_grass_slope_down_60deg_hole_slope_pick
	CMP.w #$0001
	BEQ.b CODE_grass_slope_down_60deg_hole_slope_pick
	JSR.w CODE_13C15F
	BRA.b CODE_grass_slope_down_60deg_hole_exit

CODE_13A006:
CODE_grass_slope_down_60deg_hole_slope_pick:
	ASL
	TAY
	LDX.w DATA_139FE3,y
	LDA.w $0000,x
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A014:
CODE_grass_slope_down_60deg_hole_exit:
	SEP.b #$30
	RTL

DATA_13A017:
	dw $7D08,$9D32,$9D34

DATA_13A01D:
	dw $79F1,$79F3,$79F5

DATA_13A023:
	dw $7D0A,$9D32,$9D36

DATA_13A029:
	dw $79A8,$79F3,$79A0

DATA_13A02F:
	dw $0001,$FFFF

;-------------------------------------------------------------------------
; CODE_pipe_vertical_dispatch -- CODE_pipe_vertical_dispatch: vertical pipe stamp dispatcher.
; Parallels ys_bgsc1.asm (vertical pipe).
; Selects from 4 tile-tables (DATA_13A017 / DATA_13A01D / DATA_13A023 /
; DATA_13A029) based on direction sign-bit of $2E and orientation
; $15. Adjustment table DATA_13A02F is $0001/$FFFF.
;-------------------------------------------------------------------------
CODE_13A033:
CODE_pipe_vertical_dispatch:                                     ; descriptive alias
	REP.b #$30
	LDX.w #$0000
	LDA.b $2E
	BPL.b CODE_13A03E
	INX
	INX
CODE_13A03E:
	LDY.w #$0000
	LDA.b $2C
	BEQ.b CODE_13A051
	INY
	INY
	CLC
	ADC.w DATA_13A02F,x
	CMP.b $2E
	BNE.b CODE_13A051
	INY
	INY
CODE_13A051:
	TXA
	BNE.b CODE_13A062
	LDA.b $15
	BNE.b CODE_13A05D
	LDA.w DATA_13A017,y
	BRA.b CODE_13A06E

CODE_13A05D:
	LDA.w DATA_13A01D,y
	BRA.b CODE_13A06E

CODE_13A062:
	LDA.b $15
	BNE.b CODE_13A06B
	LDA.w DATA_13A023,y
	BRA.b CODE_13A06E

CODE_13A06B:
	LDA.w DATA_13A029,y
CODE_13A06E:
	CLC
	ADC.b $28
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

;-------------------------------------------------------------------------
; CODE_snow_cloud_block -- CODE_snow_cloud_block: snow-cloud platform stamp.
; Parallels ys_bgsc1.asm (snow cloud). 3x3 cloud
; pattern with left / mid / right column tables (DATA_13A0CC = 1DT,
; DATA_13A0D8 = 2DT center, DATA_13A0DE = 3DT). Special-cases overlap
; with existing left-cap tiles ($00A8 / $00A9) so adjacent cloud blocks
; merge cleanly.
;-------------------------------------------------------------------------
CODE_13A07A:
CODE_snow_cloud_block:                                           ; descriptive alias
	REP.b #$30
	LDY.w #$0000
	LDA.b $2C
	BEQ.b CODE_13A08C
	INY
	INY
	INC
	CMP.b $2E
	BNE.b CODE_13A08C
	INY
	INY
CODE_13A08C:
	LDA.b $28
	BEQ.b CODE_13A097
	INC
	CMP.b $2A
	BNE.b CODE_13A0AE
	BRA.b CODE_13A0C0

CODE_13A097:
	LDA.b $12
	CMP.w #$00A8
	BEQ.b CODE_13A0A3
	CMP.w #$00A9
	BNE.b CODE_13A0A9
CODE_13A0A3:
	INY
	INY
	INY
	INY
	INY
	INY
CODE_13A0A9:
	LDA.w DATA_13A0CC,y
	BRA.b CODE_13A0C3

CODE_13A0AE:
	LDA.b $28
	EOR.w #$0001
	AND.w #$0001
	STA.b $00
	LDA.w DATA_13A0D8,y
	CLC
	ADC.b $00
	BRA.b CODE_13A0C3

CODE_13A0C0:
	LDA.w DATA_13A0DE,y
CODE_13A0C3:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13A0CC:
DATA_ski_lift_two_pole_extras:                                     ; 6-entry candidate table ($00B5,$3C00,$00AB,$00A7,$3C00,$00AB) referenced near CODE_stamp_ski_lift_two_pole; spare morphing variants (not all consumed by the current handler body).
	dw $00B5,$3C00,$00AB,$00A7,$3C00,$00AB

DATA_13A0D8:
DATA_ski_lift_two_pole_left:                                     ; Per-orientation tile triple ($00A8,$3C01,$00B0) used by the alt branch of CODE_stamp_ski_lift_two_pole (left-facing morph case selected by under-tile shape).
	dw $00A8,$3C01,$00B0

DATA_13A0DE:
DATA_ski_lift_two_pole_right:                                     ; Per-orientation tile triple ($00AA,$3C03,$00B2) used by the alt branch of CODE_stamp_ski_lift_two_pole (right-facing morph case selected by under-tile shape).
	dw $00AA,$3C03,$00B2

CODE_13A0E4:
CODE_stamp_ski_lift_two_pole:                                     ; Bank13 per-cell handler for CODE_init_ski_lift_two_pole. Picks one of three Map16 IDs from DATA_13A11C ($00A7/$00B3/$00B4) based on the under-tile's current ID and whether the cell sits on the bottom row ($2C+1==$2E).
	REP.b #$30
	LDX.b $1D
	LDA.b $12
	CMP.w #$0092
	BEQ.b CODE_13A0F9
	CMP.w #$0093
	BEQ.b CODE_13A0F9
	CMP.w #$00A6
	BNE.b CODE_13A0FE
CODE_13A0F9:
	LDA.w #$00A7
	BRA.b CODE_13A115

CODE_13A0FE:
	LDY.w #$0000
	LDA.b $2C
	BEQ.b CODE_13A10E
	INY
	INY
	INC
	CMP.b $2E
	BNE.b CODE_13A10E
	INY
	INY
CODE_13A10E:
	LDA.w DATA_13A11C,y
	TAY
	LDA.w $0000,y
CODE_13A115:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13A11C:
DATA_ski_lift_two_pole_select:                                     ; 3-entry dispatch table (DATA_13A122, DATA_13A124, $1C74) indexed in CODE_stamp_ski_lift_two_pole by row-position state (top, bottom, special) for the final tile select.
	dw DATA_13A122,DATA_13A124,$1C74

DATA_13A122:
DATA_ski_lift_two_pole_top_tile:                                     ; Single-tile sub-entry ($00B3) selected by CODE_stamp_ski_lift_two_pole when the cell sits at top of the object's rectangle ($2C==0).
	dw $00B3

DATA_13A124:
DATA_ski_lift_two_pole_bot_tile:                                     ; Single-tile sub-entry ($00B4) selected by CODE_stamp_ski_lift_two_pole when the cell sits at bottom of the object's rectangle ($2C+1==$2E).
	dw $00B4

;-------------------------------------------------------------------------
; CODE_stamp_spike_pillar -- CODE_stamp_spike_pillar: lava spike-pillar stamp.
; Parallels ys_bgsc1.asm (lava spike).
; Selects from 6-entry table DATA_13A146 ($0114..$2907)
; by combining orientation bit ($15 AND $0006), row $2C, and whether
; the current cell is empty.
;-------------------------------------------------------------------------
CODE_13A126:
CODE_stamp_spike_pillar:                                           ; descriptive alias
	REP.b #$30
	LDA.b $15
	AND.w #$0006
	TAY
	LDA.b $2C
	BEQ.b CODE_13A134
	INY
	INY
CODE_13A134:
	LDA.b $12
	BEQ.b CODE_13A13A
	INY
	INY
CODE_13A13A:
	LDX.b $1D
	LDA.w DATA_13A146,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13A146:
	dw $0114,$2904,$2906,$0115,$2905,$2907

DATA_13A152:
	dw CODE_wall_h_block_below_probe
	dw CODE_wall_h_block_below_probe_wide

;-------------------------------------------------------------------------
; CODE_wall_h_block -- CODE_wall_h_block: horizontal-wall block stamp.
; Parallels ys_bgsc1.asm (horizontal wall block). Stamps a
; horizontal-wall block tile and also writes shadow / connection tiles
; on neighbouring cells via CODE_wall_h_block_below_probe (horizontal-edge
; shadow start), CODE_wall_h_block_right_probe (vertical-edge shadow), and
; CODE_wall_h_block_below_right_probe (shadow termination). Edge tiles from
; DATA_13A146 above.
;-------------------------------------------------------------------------
CODE_13A156:
CODE_wall_h_block:                                               ; descriptive alias
	REP.b #$30
	LDX.b $1D
	LDA.b $2A
	ORA.b $2E
	DEC
	BNE.b CODE_wall_h_block_multi_cell_edge_stamp
	LDA.w #$0156
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_wall_h_block_below_probe
	JSR.w CODE_wall_h_block_right_probe
	JSR.w CODE_wall_h_block_below_right_probe
	BRA.b CODE_wall_h_block_epilogue

CODE_13A173:
CODE_wall_h_block_multi_cell_edge_stamp:
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_13A183
	INY
	INY
	INC
	CMP.b $2A
	BNE.b CODE_13A183
	INY
	INY
CODE_13A183:
	LDA.w DATA_13A1A9,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_13A198
	INX
	INX
	INC
	CMP.b $2A
	BEQ.b CODE_13A19D
CODE_13A198:
	JSR.w (DATA_13A152,x)
	BRA.b CODE_wall_h_block_epilogue

CODE_13A19D:
	JSR.w CODE_wall_h_block_right_probe
	JSR.w CODE_wall_h_block_below_probe_wide
	JSR.w CODE_wall_h_block_below_right_probe
CODE_13A1A6:
CODE_wall_h_block_epilogue:
	SEP.b #$30
	RTL

DATA_13A1A9:
	dw $0153,$0154,$0155

DATA_13A1AF:
	dw $00C2,$00C3,$00C4,$00C5,$00C6,$00C7,$150D,$150E
	dw $00D1

DATA_13A1C1:
	dw $00C3,$00C3,$00D5,$00D5,$00C6,$00C6,$151B,$151B
	dw $00C3

CODE_13A1D3:
CODE_wall_h_block_below_probe:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	LDY.w #$0000
CODE_13A1E2:
	CMP.w DATA_13A1AF,y
	BEQ.b CODE_13A1F0
	INY
	INY
	CPY.w #$0012
	BCC.b CODE_13A1E2
	BRA.b CODE_13A1F7

CODE_13A1F0:
	LDA.w DATA_13A1C1,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A1F7:
	RTS

DATA_13A1F8:
	dw $00C4,$00D5,$00C4,$00C5,$00D5,$00C5,$151B,$151B
	dw $00C4

CODE_13A20A:
CODE_wall_h_block_right_probe:
	JSR.w CODE_probe_right_tile
	LDY.w #$0000
CODE_13A210:
	CMP.w DATA_13A1AF,y
	BEQ.b CODE_13A21E
	INY
	INY
	CPY.w #$0012
	BCC.b CODE_13A210
	BRA.b CODE_13A225

CODE_13A21E:
	LDA.w DATA_13A1F8,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A225:
	RTS

DATA_13A226:
	dw $00BE,$00BF,$00C0,$00C1,$00C2,$00C3,$00C4,$00C5
	dw $00C6,$00C7,$00C9,$00CA,$00CB,$00CC,$00D6,$00D7
	dw $150D,$150E,$00D1

DATA_13A24C:
	dw $77DE,$77DF,$77E0,$77E1,$00C6,$00C6,$00D5,$00D5
	dw $00C6,$00C6,$77DA,$77DB,$77DC,$77DD,$77D8,$77D9
	dw $151A,$151A
	db $C6

DATA_13A271:
	db $00

CODE_13A272:
CODE_wall_h_block_below_probe_wide:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	LDY.w #$0000
CODE_13A281:
	CMP.w DATA_13A226,y
	BEQ.b CODE_13A28F
	INY
	INY
	CPY.w #$0026
	BCC.b CODE_13A281
	BRA.b CODE_13A296

CODE_13A28F:
	LDA.w DATA_13A24C,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A296:
	RTS

DATA_13A297:
	dw $0084,$0085,$0086,$0087,$0088,$0089,$008A,$008B
	dw $008C,$008D

DATA_13A2AB:
	dw $77E7,$77E9,$77E8,$77E6,$00C5,$00D5,$00C5,$00C5
	dw $00D5,$00C6,$77E5,$77E3,$77E2,$77E4,$77D8,$77D9
	dw $151B,$151B,$00C5

CODE_13A2D1:
CODE_wall_h_block_right_probe_random:
	JSR.w CODE_probe_right_tile
	LDY.w #$0000
CODE_13A2D7:
	CMP.w DATA_13A226,y
	BEQ.b CODE_13A319
	INY
	INY
	CPY.w #$0026
	BCC.b CODE_13A2D7
	CMP.w #$002E
	BNE.b CODE_13A2ED
	LDA.w #$002F
	BRA.b CODE_13A31C

CODE_13A2ED:
	CMP.w DATA_13A271,y
	BEQ.b CODE_13A2FB
	INY
	INY
	CPY.w #$003A
	BCC.b CODE_13A2ED
	BRA.b CODE_13A320

CODE_13A2FB:
	CPY.w #$0030
	BCS.b CODE_13A320
	LDA.b $2C
	CMP.w #$0001
	BNE.b CODE_13A314
	JSL.l CODE_prng
	AND.w #$0006
	TAY
	LDA.w DATA_13A297,y
	BRA.b CODE_13A31C

CODE_13A314:
	LDA.w #$0031
	BRA.b CODE_13A31C

CODE_13A319:
	LDA.w DATA_13A2AB,y
CODE_13A31C:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A320:
	RTS

DATA_13A321:
	dw $00C7,$00C6,$00C5,$00C5,$00C6,$00C7,$151B,$151B
	dw $00C7

CODE_13A333:
CODE_wall_h_block_below_right_probe:
	LDA.b $1B
	PHA
	ORA.w #$00F0
	INC
	AND.w #$0F0F
	STA.b $0E
	PLA
	AND.w #$F0F0
	ORA.b $0E
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	LDY.w #$0000
CODE_13A352:
	CMP.w DATA_13A1AF,y
	BEQ.b CODE_13A360
	INY
	INY
	CPY.w #$0012
	BCC.b CODE_13A352
	BRA.b CODE_13A367

CODE_13A360:
	LDA.w DATA_13A321,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A367:
	RTS

DATA_13A368:
DATA_castle_pillar_up_tiles:                                     ; 5-entry tile table for CODE_stamp_castle_pillar_up: $00B6,$00B8,$00BA,$00B9,$00B6. First and last duplicates produce the diagonal-rise repeat pattern at the rectangle's top.
	dw $00B6,$00B8,$00BA,$00B9,$00B6

CODE_13A372:
CODE_stamp_castle_pillar_up:                                     ; Bank13 per-cell handler for the up-rising diagonal-wall variant of CODE_init_castle_pillar. Selects from DATA_13A368 by row-from-bottom and orientation parity, then jumps to shared epilogue CODE_castle_pillar_stamp_and_overlay.
	REP.b #$30
	LDA.b $12
	AND.w #$FF00
	CMP.w #$7E00
	BEQ.b CODE_castle_pillar_up_early_exit
	LDA.b $2E
	SEC
	SBC.b $2C
	CMP.w #$0004
	BCC.b CODE_13A394
	LDA.b $2C
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_13A368,y
	BRA.b CODE_13A399

CODE_13A394:
	ASL
	TAY
	LDA.w DATA_13A368+$02,y
CODE_13A399:
	JMP.w CODE_castle_pillar_stamp_and_overlay

CODE_13A39C:
CODE_castle_pillar_up_early_exit:
	SEP.b #$30
	RTL

DATA_13A39F:
DATA_castle_pillar_down_tiles:                                     ; 3-entry tile table for CODE_stamp_castle_pillar_down: $00B6 (top), $00B7 (middle), $00B8 (bottom). Read sequentially as the walker steps down.
	dw $00B6,$00B7,$00B8

DATA_13A3A5:
DATA_castle_pillar_grass_overlay:                                     ; 5-entry overlay tile table ($7794,$7795,$7796,$7794,$7794) applied by the diag-stamp epilogue when the under-tile is in the $0084-$008E grass range or matches $0032.
	dw $7794,$7795,$7796,$7794,$7794

CODE_13A3AF:
CODE_stamp_castle_pillar_down:                                     ; Bank13 per-cell handler for the down-falling diagonal-wall variant of CODE_init_castle_pillar. Indexes DATA_13A39F by row position, then runs the neighbour-probe epilogue (left/right shadow + top connection).
	REP.b #$30
	LDA.b $12
	AND.w #$FF00
	CMP.w #$7E00
	BEQ.b CODE_castle_pillar_down_epilogue
CODE_13A3BB:
	LDY.w #$0000
	LDA.b $2C
	BEQ.b CODE_13A3CB
	INY
	INY
	INC
	CMP.b $2E
	BNE.b CODE_13A3CB
	INY
	INY
CODE_13A3CB:
	LDA.w DATA_13A39F,y
CODE_13A3CE:
CODE_castle_pillar_stamp_and_overlay:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEC
	SBC.w #$00B6
	ASL
	TAY
	LDA.b $12
	CMP.w #$0032
	BEQ.b CODE_13A3EB
	CMP.w #$0084
	BCC.b CODE_13A3F2
	CMP.w #$008E
	BCS.b CODE_13A3F2
CODE_13A3EB:
	LDA.w DATA_13A3A5,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A3F2:
	LDA.b $2C
	BNE.b CODE_castle_pillar_down_non_top_row
	JSR.w CODE_wall_h_block_right_probe
	BRA.b CODE_castle_pillar_down_epilogue

CODE_13A3FB:
CODE_castle_pillar_down_non_top_row:
	JSR.w CODE_wall_h_block_right_probe_random
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_castle_pillar_down_epilogue
	JSR.w CODE_wall_h_block_below_probe
	JSR.w CODE_wall_h_block_below_right_probe
CODE_13A40B:
CODE_castle_pillar_down_epilogue:
	SEP.b #$30
	RTL

DATA_13A40E:
DATA_castle_wall_corner_side_handlers:                                     ; 2-entry pointer table (CODE_13A443 left-edge probe, CODE_13A45B right-edge probe) used by CODE_stamp_castle_wall_corner to pick the column-edge connection helper.
	dw CODE_13A443
	dw CODE_13A45B

CODE_13A412:
CODE_stamp_castle_wall_corner:                                     ; Bank13 per-cell handler for CODE_init_castle_wall. Stamps base $00C2 then runs left/right edge probe (DATA_13A40E), above probe (CODE_13A47E), and top-row probe (CODE_13A4F8) for corner autotile.
	REP.b #$30
	LDX.b $1D
	LDA.w #$00C2
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_13A42B
	INC
	CMP.b $2A
	BNE.b CODE_castle_wall_corner_top_row
	INX
	INX
CODE_13A42B:
	LDA.b $1B
	STA.b $0E
	JSR.w (DATA_13A40E,x)
	LDA.b $28
	BNE.b CODE_castle_wall_corner_top_row
	JSR.w CODE_13A47E
CODE_13A439:
CODE_castle_wall_corner_top_row:
	LDA.b $2C
	BNE.b CODE_castle_wall_corner_epilogue
	JSR.w CODE_13A4F8
CODE_13A440:
CODE_castle_wall_corner_epilogue:
	SEP.b #$30
	RTL

CODE_13A443:
CODE_castle_wall_corner_left_probe:                                     ; [decorator] Helper for CODE_stamp_castle_wall_corner: reads the tile to the left ($015A pattern), checks shape, and if matched rewrites it to a corner-mate tile ($0151+).
	JSL.l CODE_get_map16_left
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$015A
	BEQ.b CODE_13A468
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_13A477
	LDA.b $1B
	STA.b $0E
CODE_13A45B:
CODE_castle_wall_corner_right_probe:                                     ; [decorator] Helper for CODE_stamp_castle_wall_corner: reads the tile to the right ($015B pattern), checks shape, and if matched rewrites to a corner-mate tile ($0151+).
	JSL.l CODE_get_map16_right
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$015B
	BNE.b CODE_13A477
CODE_13A468:
	SEC
	SBC.w #$015A
	EOR.w #$0001
	CLC
	ADC.w #$0151
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A477:
	RTS

DATA_13A478:
DATA_castle_wall_corner_above_tiles:                                     ; 3-entry tile table for CODE_castle_wall_corner_above_probe: $00C4,$00C5,$00C7. Drives the wall-top-meets-neighbour connector lookup for left-column cells.
	dw $00C4,$00C5,$00C7

CODE_13A47E:
CODE_castle_wall_corner_above_probe:                                     ; [decorator] Helper called by CODE_stamp_castle_wall_corner when the cell sits in the left column of the rectangle: probes above-tile and may stamp a wall-meets-ceiling connector from DATA_13A478 ($00C4,$00C5,$00C7).
	JSR.w CODE_probe_left_tile
	CMP.w #$0151
	BEQ.b CODE_13A4AB
	CMP.w #$0152
	BEQ.b CODE_13A4AB
	CMP.w #$0153
	BCC.b CODE_13A495
	CMP.w #$0161
	BCC.b CODE_13A4AB
CODE_13A495:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$00C5
	BNE.b CODE_13A4EF
	LDY.w #$0004
	BRA.b CODE_13A4E6

CODE_13A4AB:
	LDY.w #$0000
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$0151
	BEQ.b CODE_13A4DF
	CMP.w #$0152
	BEQ.b CODE_13A4DF
	CMP.w #$0153
	BCC.b CODE_13A4CE
	CMP.w #$0161
	BCC.b CODE_13A4DF
CODE_13A4CE:
	CMP.w #$00C2
	BEQ.b CODE_13A4E6
	CMP.w #$77E6
	BEQ.b CODE_13A4E6
	CMP.w #$77E7
	BEQ.b CODE_13A4E6
	BRA.b CODE_13A4E4

CODE_13A4DF:
	LDA.w #$00D5
	BRA.b CODE_13A4E9

CODE_13A4E4:
	INY
	INY
CODE_13A4E6:
	LDA.w DATA_13A478,y
CODE_13A4E9:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A4EF:
	RTS

DATA_13A4F0:
DATA_castle_wall_corner_top_tiles:                                     ; 4-entry tile table for CODE_castle_wall_corner_top_row_probe: $00C3,$00C6,$00C6,$00C7. Top-row connector tiles driven by neighbour shape.
	dw $00C3,$00C6,$00C6,$00C7

CODE_13A4F8:
CODE_castle_wall_corner_top_row_probe:                                     ; [decorator] Helper called by CODE_stamp_castle_wall_corner on the top row: probes above-tile shape, writes connector from DATA_13A4F0 ($00C3,$00C6,$00C6,$00C7), and toggles autotile flag $A1.
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$0151
	BEQ.b CODE_13A521
	CMP.w #$0152
	BEQ.b CODE_13A521
	CMP.w #$0153
	BCC.b CODE_13A518
	CMP.w #$0161
	BCC.b CODE_13A521
CODE_13A518:
	LDA.b $A1
	BEQ.b CODE_13A552
	TAY
	STZ.b $A1
	BRA.b CODE_13A530

CODE_13A521:
	LDY.w #$0002
	LDA.b $A1
	BNE.b CODE_13A530
	LDA.w #$0006
	STA.b $A1
	LDY.w #$0000
CODE_13A530:
	LDX.b $1D
	TYA
	BNE.b CODE_13A549
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$00D5
	BEQ.b CODE_13A552
	JSR.w CODE_probe_left_tile
	CMP.w #$00C6
	BNE.b CODE_13A549
	LDY.w #$0002
CODE_13A549:
	LDX.b $1D
	LDA.w DATA_13A4F0,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A552:
	RTS

CODE_13A553:
CODE_stamp_castle_wall_diag_end_diagonal:                                     ; Bank13 per-cell handler for CODE_init_castle_wall_diag_end. Sets $9B=1, picks from DATA_13A5AE by orientation+row parity, then dispatches CODE_13A5BE (top probe) or CODE_13A612 (mid probe) for autotile.
	REP.b #$30
	LDA.w #$0001
	STA.b $9B
	LDX.b $1D
	LDA.b $15
	AND.w #$0002
	ASL
	STA.b $00
	LDA.b $2C
	AND.w #$0001
	ASL
	ORA.b $00
	TAY
	BNE.b CODE_13A585
	LDA.b $12
	CMP.w #$00D6
	BEQ.b CODE_13A58C
	CMP.w #$00D7
	BEQ.b CODE_13A58C
	CMP.w #$77D8
	BEQ.b CODE_13A58C
	CMP.w #$77D9
	BEQ.b CODE_13A58C
CODE_13A585:
	LDA.w DATA_13A5AE,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A58C:
	LDA.b $2C
	BEQ.b CODE_castle_wall_diag_end_top_row_branch
	DEC
	BNE.b CODE_13A5A6
	JSR.w CODE_13A612
	BRA.b CODE_castle_wall_diag_end_overlay_stamp

CODE_13A598:
CODE_castle_wall_diag_end_top_row_branch:
	JSR.w CODE_13A5BE
CODE_13A59B:
CODE_castle_wall_diag_end_overlay_stamp:
	TAX
	BEQ.b CODE_13A5A6
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	BRA.b CODE_castle_wall_diag_end_epilogue

CODE_13A5A6:
	JSR.w CODE_13A47E
	BRA.b CODE_castle_wall_diag_end_epilogue

CODE_13A5AB:
CODE_castle_wall_diag_end_epilogue:
	SEP.b #$30
	RTL

DATA_13A5AE:
DATA_castle_wall_diag_end_diagonal_tiles:                                     ; 4-entry diagonal-cap tile table for CODE_stamp_castle_wall_diag_end_diagonal: $00C1,$00C0,$00BE,$00BF. Picked by orientation $15 bit 1 plus row-parity $2C bit 0.
	dw $00C1,$00C0,$00BE,$00BF

DATA_13A5B6:
DATA_castle_wall_diag_end_shadow_tiles:                                     ; 4-entry shadow-overlay table for CODE_castle_wall_diag_end_top_probe: $77E1,$77E6,$77DE,$77E7. Orientation bit 1 selects mirror entries via +4 fall-through.
	dw $77E1,$77E6,$77DE,$77E7

CODE_13A5BE:
CODE_castle_wall_diag_end_top_probe:                                     ; [decorator] Helper for CODE_stamp_castle_wall_diag_end_diagonal: probes above-tile and left-tile for wall-edge IDs ($015A/$015B/$0151/$0152), returns a shadow-overlay tile from DATA_13A5B6 if either neighbour matches.
	LDY.w #$0000
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$015A
	BEQ.b CODE_13A5FF
	CMP.w #$015B
	BEQ.b CODE_13A5FF
	CMP.w #$0151
	BEQ.b CODE_13A5FF
	CMP.w #$0152
	BEQ.b CODE_13A5FF
	INY
	INY
	JSR.w CODE_probe_left_tile
	CMP.w #$015A
	BEQ.b CODE_13A5FF
	CMP.w #$015B
	BEQ.b CODE_13A5FF
	CMP.w #$0151
	BEQ.b CODE_13A5FF
CODE_13A5F5:
	CMP.w #$0152
	BEQ.b CODE_13A5FF
	LDA.w #$0000
	BRA.b CODE_13A60D

CODE_13A5FF:
	LDA.b $15
	AND.w #$0002
	BEQ.b CODE_13A60A
	INY
	INY
	INY
	INY
CODE_13A60A:
	LDA.w DATA_13A5B6,y
CODE_13A60D:
	RTS

DATA_13A60E:
DATA_castle_wall_diag_end_mid_shadow_tiles:                                     ; 2-entry mid-row shadow-overlay table for CODE_castle_wall_diag_end_mid_probe: $77E8,$77E9 (the two mid-row shadow tile IDs).
	dw $77E8,$77E9

CODE_13A612:
CODE_castle_wall_diag_end_mid_probe:                                     ; Helper for CODE_stamp_castle_wall_diag_end_diagonal: probes left-tile only, returns shadow-overlay from DATA_13A60E ($77E8/$77E9) if the neighbour is a wall-edge tile; orientation bit selects mirror.
	JSR.w CODE_probe_left_tile
	CMP.w #$015A
	BEQ.b CODE_13A62E
	CMP.w #$015B
	BEQ.b CODE_13A62E
	CMP.w #$0151
	BEQ.b CODE_13A62E
	CMP.w #$0152
	BEQ.b CODE_13A62E
	LDA.w #$0000
	BRA.b CODE_13A637

CODE_13A62E:
	LDA.b $15
	AND.w #$0002
	TAY
	LDA.w DATA_13A60E,y
CODE_13A637:
	RTS

DATA_13A638:
DATA_wall_random_top_tiles:                                     ; 8-entry random-pool tile table for the top row of CODE_stamp_lava_castle: $0084,$0085,$0085,$0086,$0084,$0086,$0087,$0088 (PRNG-weighted distribution).
	dw $0084,$0085,$0085,$0086,$0084,$0086,$0087,$0088

DATA_13A648:
DATA_wall_random_side_handlers:                                     ; 2-entry pointer table for CODE_stamp_lava_castle side dispatch: CODE_13A6DE (left-side probe), CODE_13A701 (right-side probe).
	dw CODE_13A6DE
	dw CODE_13A701

CODE_13A64C:
CODE_stamp_lava_castle:                                     ; [decorator] Bank13 per-cell handler for CODE_init_lava_castle. Top row: continuation tile ($002E+) if above-tile matches $00C2/$00C4/$00C5; else random tile from DATA_13A638 via CODE_prng. Non-top rows stamp $7E00/$7E01.
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_13A69A
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.w #$0005
	STA.b $00
	LDY.w #$0000
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$00C2
	BEQ.b CODE_13A677
	INY
	CMP.w #$00C5
	BEQ.b CODE_13A677
	INY
	CMP.w #$00C4
	BNE.b CODE_13A68A
CODE_13A677:
	TYA
	CLC
	ADC.w #$002E
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	STZ.b $00
	TYA
	BEQ.b CODE_13A68A
	LDA.w #$0031
	BRA.b CODE_13A6A3

CODE_13A68A:
	JSL.l CODE_prng
	AND.w #$000E
	TAY
	LDA.w DATA_13A638,y
	CLC
	ADC.b $00
	BRA.b CODE_13A6A3

CODE_13A69A:
	LDA.b $28
	AND.w #$0001
	CLC
	ADC.w #$7E00
CODE_13A6A3:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_13A6B7
	INX
	INX
	INC
	CMP.b $2A
	BNE.b CODE_13A6C1
CODE_13A6B7:
	LDA.b $1B
	STA.b $0E
	LDY.w #$0000
	JSR.w (DATA_13A648,x)
CODE_13A6C1:
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_wall_block_random_epilogue
	JSR.w CODE_13A724
CODE_13A6CB:
CODE_wall_block_random_epilogue:
	SEP.b #$30
	RTL

DATA_13A6CE:
DATA_wall_random_left_tiles:                                     ; 4-entry left-connection tile table for CODE_wall_random_left_probe: $01A3,$01A1,$01A3,$01A3 (left-edge mate tiles).
	dw $01A3,$01A1,$01A3,$01A3

DATA_13A6D6:
DATA_wall_random_neighbour_match:                                     ; 4-entry wall-edge tile-ID match list shared by all three probe helpers of CODE_stamp_lava_castle: $015A,$015B,$0151,$0152.
	dw $015A,$015B,$0151,$0152

CODE_13A6DE:
CODE_wall_random_left_probe:                                     ; Helper for CODE_stamp_lava_castle on the left edge: probes left-tile against DATA_13A6D6 and if matched rewrites the left neighbour to the connection tile from DATA_13A6CE.
	JSL.l CODE_get_map16_left
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A6E6:
	CMP.w DATA_13A6D6,y
	BEQ.b CODE_13A6F4
	INY
	INY
	CPY.w #$0008
	BCC.b CODE_13A6E6
	BRA.b CODE_13A748

CODE_13A6F4:
	LDA.w DATA_13A6CE,y
	BRA.b CODE_13A744

DATA_13A6F9:
DATA_wall_random_right_tiles:                                     ; 4-entry right-connection tile table for CODE_wall_random_right_probe: $01A2,$01A4,$01A4,$01A4 (right-edge mate tiles).
	dw $01A2,$01A4,$01A4,$01A4

CODE_13A701:
CODE_wall_random_right_probe:                                     ; Helper for CODE_stamp_lava_castle on the right edge: probes right-tile against DATA_13A6D6 and stamps connection tile from DATA_13A6F9.
	JSL.l CODE_get_map16_right
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A709:
	CMP.w DATA_13A6D6,y
	BEQ.b CODE_13A717
	INY
	INY
	CPY.w #$0008
	BCC.b CODE_13A709
	BRA.b CODE_13A748

CODE_13A717:
	LDA.w DATA_13A6F9,y
	BRA.b CODE_13A744

DATA_13A71C:
DATA_wall_random_below_tiles:                                     ; 4-entry below-connection tile table for CODE_wall_random_below_probe: $01A5,$01A6,$01A5,$01A6 (wall-meets-ground tiles).
	dw $01A5,$01A6,$01A5,$01A6

CODE_13A724:
CODE_wall_random_below_probe:                                     ; Helper for CODE_stamp_lava_castle at the bottom row: probes the cell below against DATA_13A6D6 and stamps DATA_13A71C as a wall-meets-ground connection.
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDY.w #$0000
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A733:
	CMP.w DATA_13A6D6,y
	BEQ.b CODE_13A741
	INY
	INY
	CPY.w #$0008
	BCC.b CODE_13A733
	BRA.b CODE_13A748

CODE_13A741:
	LDA.w DATA_13A71C,y
CODE_13A744:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A748:
	RTS

DATA_13A749:
DATA_wall_thick_top_tiles:                                     ; 3-entry top-row tile table for CODE_stamp_wall_thick_top: $015A (left), $015B (right), $0151 (interior). Picked by column-edge position $28 within rectangle.
	dw $015A,$015B,$0151

DATA_13A74F:
DATA_wall_thick_side_handlers:                                     ; 2-entry pointer table for CODE_stamp_wall_thick_top side dispatch: CODE_13A79A (left-side merge), CODE_13A7BC (right-side merge).
	dw CODE_13A79A
	dw CODE_13A7BC

CODE_13A753:
CODE_stamp_wall_thick_top:                                     ; Bank13 top-row stamper for CODE_init_brick. On the top row picks one of DATA_13A749 by column position, calls DATA_13A74F (right/left side probes), then drops into shared epilogue CODE_13A833.
	REP.b #$30
	LDY.w #$0004
	LDA.b $2A
	DEC
	BEQ.b CODE_13A767
	JSR.w CODE_13A887
	LDA.b $1B
	STA.b $0E
	JSR.w (DATA_13A74F,x)
CODE_13A767:
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_13A778
	CPY.w #$0004
	BNE.b CODE_13A778
	LDA.w #$0152
	BRA.b CODE_13A77B

CODE_13A778:
	LDA.w DATA_13A749,y
CODE_13A77B:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $28
	BEQ.b CODE_wall_thick_top_left_edge
	INC
	CMP.b $2A
	BNE.b CODE_wall_thick_top_finalize
	DEY
	DEY
	JSR.w CODE_13A8AB
	BRA.b CODE_wall_thick_top_finalize

CODE_13A791:
CODE_wall_thick_top_left_edge:
	JSR.w CODE_13A7E0
CODE_13A794:
CODE_wall_thick_top_finalize:
	JSR.w CODE_13A8DD
	JMP.w CODE_13A833

CODE_13A79A:
CODE_wall_thick_left_side:                                     ; Helper for CODE_stamp_wall_thick_top: probes right-tile against DATA_13A749 entries to harmonize an interior-to-edge transition on the right side of the rectangle.
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_13A7D9
	JSL.l CODE_get_map16_right
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w DATA_13A749+$02
	BEQ.b CODE_13A7D9
	CMP.w DATA_13A749+$04
	BNE.b CODE_13A7D6
	LDA.w DATA_13A749+$02
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	BRA.b CODE_13A7D9

CODE_13A7BC:
CODE_wall_thick_right_side:                                     ; Helper for CODE_stamp_wall_thick_top: probes left-tile against DATA_13A80F to fold the left edge of the new block into any existing wall on its left.
	LDA.b $28
	BNE.b CODE_13A7D9
	JSL.l CODE_get_map16_left
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w DATA_13A80F
	BNE.b CODE_13A7D6
	LDA.w DATA_13A749
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	BRA.b CODE_13A7D9

CODE_13A7D6:
	LDY.w #$0004
CODE_13A7D9:
	RTS

DATA_13A7DA:
DATA_wall_thick_left_decor_tiles:                                     ; 3-entry grass-overlay tile table for CODE_wall_thick_left_decor_probe: $01A2,$01A4,$01A4 (left-side grass-meets-wall overlay tiles).
	dw $01A2,$01A4,$01A4

CODE_13A7E0:
CODE_wall_thick_left_decor_probe:                                     ; Helper: probes left-tile range $002E-$0033 + $0084-$008E + $7E00/$7E01 (grass/dirt overlays) and if matched stamps grass-meets-wall overlay from DATA_13A7DA.
	JSR.w CODE_probe_left_tile
	CMP.w #$002E
	BCC.b CODE_13A80A
	CMP.w #$0033
	BCC.b CODE_13A801
	CMP.w #$0084
	BCC.b CODE_13A80A
	CMP.w #$008E
	BCC.b CODE_13A801
	CMP.w #$7E00
	BEQ.b CODE_13A801
	CMP.w #$7E01
	BNE.b CODE_13A80A
CODE_13A801:
	LDX.b $1D
	LDA.w DATA_13A7DA,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A80A:
	RTS

DATA_13A80B:
DATA_wall_thick_bottom_tiles:                                     ; 2-entry bottom-row tile table used by CODE_stamp_wall_thick_bot: $015B,$015A. Selected by column-edge position within the object's rectangle.
	dw $015B,$015A

DATA_13A80F:
DATA_wall_thick_left_match:                                     ; 1-entry left-side match constant ($0152) used by CODE_wall_thick_right_side to detect whether the left neighbour is an existing wall to merge into.
	dw $0152

CODE_13A811:
CODE_stamp_wall_thick_bot:                                     ; Bank13 bottom-row stamper for CODE_init_brick. Picks DATA_13A80B by column position, calls DATA_13A8AB (right-side grass overlay), CODE_13A8DD (above-grass overlay), then CODE_13A833.
	REP.b #$30
	LDY.w #$0004
	LDA.b $2A
	DEC
	BEQ.b CODE_wall_thick_bot_main_stamp
	JSR.w CODE_13A887
	TXA
	BEQ.b CODE_wall_thick_bot_main_stamp
	JSR.w CODE_13A866
CODE_13A824:
CODE_wall_thick_bot_main_stamp:
	LDX.b $1D
	LDA.w DATA_13A80B,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_13A8AB
	JSR.w CODE_13A8DD
CODE_13A833:
CODE_wall_thick_neighbour_epilogue:                                     ; Shared neighbour-probe epilogue used by both top and bottom stampers of CODE_init_brick. Probes above/right/below per rectangle edge state, then invokes shadow helpers (CODE_wall_h_block_below_probe/A20A/A272/A2D1/A333).
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_wall_thick_epilogue_right_check
	LDA.b $28
	BNE.b CODE_wall_thick_epilogue_below_wide
	JSR.w CODE_wall_h_block_below_probe
	BRA.b CODE_wall_thick_epilogue_right_check

CODE_13A843:
CODE_wall_thick_epilogue_below_wide:
	JSR.w CODE_wall_h_block_below_probe_wide
CODE_13A846:
CODE_wall_thick_epilogue_right_check:
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_wall_thick_epilogue_exit
	LDA.b $2C
	BNE.b CODE_wall_thick_epilogue_right_random
	JSR.w CODE_wall_h_block_right_probe
	BRA.b CODE_wall_thick_epilogue_bottom_check

CODE_13A856:
CODE_wall_thick_epilogue_right_random:
	JSR.w CODE_wall_h_block_right_probe_random
CODE_13A859:
CODE_wall_thick_epilogue_bottom_check:
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_wall_thick_epilogue_exit
	JSR.w CODE_wall_h_block_below_right_probe
CODE_13A863:
CODE_wall_thick_epilogue_exit:
	SEP.b #$30
	RTL

CODE_13A866:
CODE_wall_thick_corner_probe:                                     ; Helper for CODE_stamp_wall_thick_bot on the right edge of the rectangle: probes right-tile against DATA_13A80B and DATA_13A80F, rewriting to integrate adjacent same-type blocks.
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_wall_thick_corner_probe_exit
	JSR.w CODE_probe_right_tile
	CMP.w DATA_13A80B
	BEQ.b CODE_wall_thick_corner_probe_exit
	CMP.w DATA_13A80F
	BNE.b CODE_wall_thick_corner_probe_reset_y
	LDA.w DATA_13A80B
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	BRA.b CODE_wall_thick_corner_probe_exit

CODE_13A883:
CODE_wall_thick_corner_probe_reset_y:
	LDY.w #$0004
CODE_13A886:
CODE_wall_thick_corner_probe_exit:
	RTS

CODE_13A887:
CODE_wall_thick_index_helper:                                     ; Shared helper combining $1B (cell-coord low byte) with $28 and $2C parities to compute an index for the side-handler tables; output in X/Y for the caller.
	LDA.b $1B
	CLC
	ADC.b $28
	AND.w #$0001
	STA.b $00
	LDA.b $1B
	AND.w #$0010
	LSR
	LSR
	LSR
	LSR
	ADC.b $2C
	AND.w #$0001
	EOR.b $00
	ASL
	TAX
	TXY
	RTS

DATA_13A8A5:
DATA_wall_thick_right_decor_tiles:                                     ; 3-entry grass-overlay tile table for CODE_wall_thick_right_decor_probe: $01A1,$01A3,$01A3 (right-side grass-meets-wall overlay tiles).
	dw $01A1,$01A3,$01A3

CODE_13A8AB:
CODE_wall_thick_right_decor_probe:                                     ; Helper for CODE_stamp_wall_thick_bot: probes right-tile for grass/dirt overlay tiles ($002E-$0033, $0084-$008E, $7E00/$7E01) and stamps DATA_13A8A5 connection tile.
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_13A8DC
	JSR.w CODE_probe_right_tile
	CMP.w #$002E
	BCC.b CODE_13A8DC
	CMP.w #$0033
	BCC.b CODE_13A8D3
	CMP.w #$0084
	BCC.b CODE_13A8DC
	CMP.w #$008E
	BCC.b CODE_13A8D3
	CMP.w #$7E00
	BEQ.b CODE_13A8D3
	CMP.w #$7E01
	BNE.b CODE_13A8DC
CODE_13A8D3:
	LDX.b $1D
	LDA.w DATA_13A8A5,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A8DC:
	RTS

CODE_13A8DD:
CODE_wall_thick_above_grass_probe:                                     ; [decorator] Helper for CODE_stamp_wall_thick_bot: probes the tile above for grass-overlay IDs $7E00/$7E01 and writes cell tile + ($01A5-$015A) offset to fold grass into the bottom-row tile.
	LDA.b $2C
	BNE.b CODE_13A90C
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDY.w #$0000
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$7E00
	BEQ.b CODE_13A8FA
CODE_13A8F5:
	CMP.w #$7E01
	BNE.b CODE_13A90C
CODE_13A8FA:
	LDX.b $1D
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	SEC
	SBC.w #$015A
	CLC
	ADC.w #$01A5
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13A90C:
	RTS

CODE_13A90D:
CODE_stamp_wall_block_thick_b:                                     ; Bank13 per-cell handler for CODE_init_wall_block_thick_b. Combines $2C (row parity), $28<<2 (column), and ($15>>1) (orientation) into 8-entry index into DATA_13A93B  a 2x2 block with orientation flip.
	REP.b #$30
	LDX.b $1D
	LDY.w #$0000
	LDA.b $2C
	BEQ.b CODE_13A91A
	INY
	INY
CODE_13A91A:
	LDA.b $28
	ASL
	ASL
	STA.b $00
	TYA
	ORA.b $00
	TAY
	LDA.b $15
	AND.w #$0002
	ASL
	ASL
	STA.b $00
	TYA
	ORA.b $00
	TAY
	LDA.w DATA_13A93B,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13A93B:
DATA_wall_thick_b_tiles:                                     ; 8-entry 2x2-block tile table for CODE_stamp_wall_block_thick_b: $00C8,$00CE,$00CD,$00CF,$00D3,$00D3,$00D4,$00D4 (4 corners x 2 orientation skins).
	dw $00C8,$00CE,$00CD,$00CF,$00D3,$00D3,$00D4,$00D4

CODE_13A94B:
CODE_stamp_wall_column_variable:                                     ; Bank13 per-cell handler for CODE_init_wall_column_variable. Picks tile from one of three 18-entry tables (top/mid/bot) by $2C row; skin offset from DATA_13A984 by orientation $15.
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	ASL
	STA.b $0E
	LDA.b $15
	AND.w #$0007
	DEC
	DEC
	DEC
	ASL
	TAY
	LDA.b $0E
	CLC
	ADC.w DATA_13A984,y
	TAY
	LDA.b $2C
	BEQ.b CODE_13A970
	INC
	CMP.b $2E
	BNE.b CODE_13A975
	BRA.b CODE_13A97A

CODE_13A970:
	LDA.w DATA_13A98A,y
	BRA.b CODE_13A97D

CODE_13A975:
	LDA.w DATA_13A9AE,y
	BRA.b CODE_13A97D

CODE_13A97A:
	LDA.w DATA_13A9D2,y
CODE_13A97D:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13A984:
DATA_wall_column_skin_offsets:                                     ; 3-entry skin base-offset table for CODE_stamp_wall_column_variable: +$00, +$08, +$14. Selects one of 3 column-appearance skins via orientation $15 bits 0-2.
	dw $0000,$0008,$0014

DATA_13A98A:
DATA_wall_column_top_tiles:                                     ; 18-entry top-row tile table for CODE_stamp_wall_column_variable: $0174-$0178 range covering left edge, body variants, and right edge for the 3 column-skin variants.
	dw $0174,$0175,$0175,$0178,$0174,$0175,$0175,$0175
	dw $0176,$0178,$0174,$0175,$0175,$0175,$0175,$0175
	dw $0177,$0178

DATA_13A9AE:
DATA_wall_column_mid_tiles:                                     ; 18-entry middle-row tile table for CODE_stamp_wall_column_variable: $0179-$017D range covering body variants for the 3 column-skin variants.
	dw $0179,$017A,$017A,$017D,$0179,$017A,$017A,$017A
	dw $017B,$017D,$0179,$017A,$017A,$017A,$017A,$017A
	dw $017C,$017D

DATA_13A9D2:
DATA_wall_column_bot_tiles:                                     ; 18-entry bottom-row tile table for CODE_stamp_wall_column_variable: $017E-$0182 range covering bottom-edge variants for the 3 column-skin variants.
	dw $017E,$017F,$017F,$0182,$017E,$017F,$017F,$017F
	dw $0180,$0182,$017E,$017F,$017F,$017F,$017F,$017F
	dw $0181,$0182

;-------------------------------------------------------------------------
; CODE_stamp_bg_autotile_block dispatch layout.
;
; The walker calls this per-cell with (column index $28, column extent $2A,
; row index $2C, row extent $2E). Dispatch is by rectangle SHAPE first,
; then by cell POSITION within that shape:
;
;   col-extent=1, row-extent=1  -> CODE_bg_autotile_single_cell
;   col-extent=1, row-extent>1  -> CODE_bg_autotile_vertical_strip_dispatch
;                                  (3 row positions: top / mid / bot)
;   col-extent>1, row-extent=1  -> CODE_bg_autotile_horizontal_strip_dispatch
;                                  (3 col positions: left / mid / right)
;   col-extent>1, row-extent>1  -> CODE_bg_autotile_interior_dispatch
;                                  (3x3 grid: LT, LM, LB,
;                                             MT, MM, MB,
;                                             RT, RM, RB
;                                   first letter = column spatial position
;                                     (L=left, M=middle, R=right),
;                                   second letter = row spatial position
;                                     (T=top, M=middle, B=bottom))
;
; Each entry has two paths: a same-class merge path (via class_jump_*
; jump tables) and a default tile lookup (via *_tiles tables).
;-------------------------------------------------------------------------
CODE_13A9F6:
CODE_stamp_bg_autotile_block:                                     ; Bank13 per-cell handler  the largest general-purpose autotiler. Tests $12 vs BG-class base $1A62 plus 31-entry recognition list, dispatches by rectangle shape into single-cell / vertical-strip / horizontal-strip / interior path, then by cell position into one of 16 connectivity LUTs.
	REP.b #$30
	LDY.w #$0000
	LDA.b $12
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_Family1B00_Anchor
	BEQ.b CODE_13AA24
	LDA.b $12
	CMP.w #$0000
	BEQ.b CODE_13AA24
	CMP.w #$00C2
	BEQ.b CODE_13AA24
	INY
	INY
CODE_13AA13:
	LDX.w DATA_13AC3D,y
	CMP.w $0000,x
	BEQ.b CODE_13AA24
	INY
	INY
	CPY.w #$003E
	BCC.b CODE_13AA13
	BRA.b CODE_13AA51

CODE_13AA24:
	LDA.b $2A
	DEC
	BNE.b CODE_13AA30
	LDA.b $2E
	DEC
	BEQ.b CODE_bg_autotile_single_cell
	BRA.b CODE_13AA40

CODE_13AA30:
	LDA.b $2E
	DEC
	BEQ.b CODE_bg_autotile_call_right
	JSR.w CODE_13AAF0
	BRA.b CODE_bg_autotile_store

CODE_13AA3A:
CODE_bg_autotile_single_cell:
	LDA.w DATA_13AC7B,y
	TAY
	BRA.b CODE_bg_autotile_store

CODE_13AA40:
	JSR.w CODE_13AA54
	BRA.b CODE_bg_autotile_store

CODE_13AA45:
CODE_bg_autotile_call_right:
	JSR.w CODE_13AAA2
CODE_13AA48:
CODE_bg_autotile_store:
	LDX.b $1D
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13AA51:
	SEP.b #$30
	RTL

CODE_13AA54:
CODE_bg_autotile_vertical_strip_dispatch:                                     ; Sub-dispatcher of CODE_stamp_bg_autotile_block for the single-column (vertical-strip) case. Branches into top / middle / bottom row variants by comparing $2C with $2E.
	LDA.b $2C
	BEQ.b CODE_13AA74
	INC
	CMP.b $2E
	BEQ.b CODE_13AA8B
	JSR.w CODE_13AC04
	BIT.w #$0001
	BEQ.b CODE_13AA6F
	JSR.w CODE_13AC15
	LDA.b $00
	ASL
	TAX
	JMP.w (DATA_13B06B,x)

CODE_13AA6F:
	LDA.w DATA_13ACF7,y
	BRA.b CODE_13AAA0

CODE_13AA74:
	JSR.w CODE_13AC04
	BIT.w #$0001
	BEQ.b CODE_13AA86
	JSR.w CODE_13AC15
	LDA.b $00
	ASL
	TAX
	JMP.w (DATA_13B05B-$08,x)

CODE_13AA86:
	LDA.w DATA_13ACB9,y
	BRA.b CODE_13AAA0

CODE_13AA8B:
	JSR.w CODE_13AC04
	BIT.w #$0001
	BEQ.b CODE_13AA9D
	JSR.w CODE_13AC15
	LDA.b $00
	ASL
	TAX
	JMP.w (DATA_13B077,x)

CODE_13AA9D:
	LDA.w DATA_13AD35,y
CODE_13AAA0:
	TAY
	RTS

CODE_13AAA2:
CODE_bg_autotile_horizontal_strip_dispatch:                                     ; Sub-dispatcher of CODE_stamp_bg_autotile_block for the single-row (horizontal-strip) case. Branches into left / middle / right column variants by $28 vs $2A.
	LDA.b $28
	BEQ.b CODE_13AAC2
	INC
	CMP.b $2A
	BEQ.b CODE_13AAD9
	JSR.w CODE_13AC04
	BIT.w #$0001
	BEQ.b CODE_13AABD
	JSR.w CODE_13AC15
	LDA.b $00
	ASL
	TAX
	JMP.w (DATA_13B0B3,x)

CODE_13AABD:
	LDA.w DATA_13ADB1,y
	BRA.b CODE_13AAEE

CODE_13AAC2:
	JSR.w CODE_13AC04
	BIT.w #$0001
	BEQ.b CODE_13AAD4
	JSR.w CODE_13AC15
	LDA.b $00
	ASL
	TAX
	JMP.w (DATA_13B095,x)

CODE_13AAD4:
	LDA.w DATA_13AD73,y
	BRA.b CODE_13AAEE

CODE_13AAD9:
	JSR.w CODE_13AC04
	BIT.w #$0001
	BEQ.b CODE_13AAEB
	JSR.w CODE_13AC15
	LDA.b $00
	ASL
	TAX
	JMP.w (DATA_13B0B9,x)

CODE_13AAEB:
	LDA.w DATA_13ADEF,y
CODE_13AAEE:
	TAY
	RTS

CODE_13AAF0:
CODE_bg_autotile_interior_dispatch:                                     ; Sub-dispatcher of CODE_stamp_bg_autotile_block for the 2D-interior case. 9-way grid select by ($28 vs $2A, $2C vs $2E) into LT/LM/LB/MT/MM/MB/RT/RM/RB entries (first letter = column, second = row).
	LDA.b $28
	BNE.b CODE_13AAFF
	LDA.b $2C
	BEQ.b CODE_autotile_interior_LT_entry
	INC
	CMP.b $2E
	BNE.b CODE_autotile_interior_LM_entry
	BRA.b CODE_autotile_interior_LB_entry

CODE_13AAFF:
	LDA.b $28
	INC
	CMP.b $2A
	BEQ.b CODE_autotile_interior_right_col_dispatch
	LDA.b $2C
	BEQ.b CODE_autotile_interior_MT_entry
	INC
	CMP.b $2E
	BNE.b CODE_autotile_interior_MM_anchor_bias
	JMP.w CODE_autotile_interior_MB_entry

CODE_13AB12:
CODE_autotile_interior_right_col_dispatch:
	LDA.b $2C
	BNE.b CODE_autotile_interior_right_col_not_top_row
	JMP.w CODE_autotile_interior_RT_entry

CODE_13AB19:
CODE_autotile_interior_right_col_not_top_row:
	INC
	CMP.b $2E
	BEQ.b CODE_autotile_interior_RB_trampoline
	JMP.w CODE_autotile_interior_RM_entry

CODE_13AB21:
CODE_autotile_interior_RB_trampoline:
	JMP.w CODE_autotile_interior_RB_entry

CODE_13AB24:
CODE_autotile_interior_LT_entry:
	REP.b #$20
	JSR.w CODE_13AC04
	BIT.w #$0001
	BEQ.b CODE_autotile_interior_LT_default
	JSR.w CODE_13AC15
	LDA.b $00
	ASL
	TAX
	JMP.w (DATA_13B0C9,x)

CODE_13AB38:
CODE_autotile_interior_LT_default:
	LDA.w DATA_13AE2D,y
	JMP.w CODE_autotile_dispatch_epilogue

CODE_13AB3E:
CODE_autotile_interior_LM_entry:
	REP.b #$20
	JSR.w CODE_13AC04
	BIT.w #$0001
	BEQ.b CODE_autotile_interior_LM_default
	JSR.w CODE_13AC15
	JMP.w CODE_autotile_interior_shared_default

CODE_13AB4E:
CODE_autotile_interior_LM_default:
	LDA.w DATA_13AE6B,y
	JMP.w CODE_autotile_dispatch_epilogue

CODE_13AB54:
CODE_autotile_interior_LB_entry:
	REP.b #$20
	JSR.w CODE_13AC04
	BIT.w #$0001
	BEQ.b CODE_autotile_interior_LB_default
	JSR.w CODE_13AC15
	LDA.b $00
	ASL
	TAX
	JMP.w (DATA_13B0E7,x)

CODE_13AB68:
CODE_autotile_interior_LB_default:
	LDA.w DATA_13AEA9,y
	JMP.w CODE_autotile_dispatch_epilogue

CODE_13AB6E:
CODE_autotile_interior_MT_entry:
	REP.b #$20
	JSR.w CODE_13AC04
	BIT.w #$0001
	BEQ.b CODE_autotile_interior_MT_default
	JSR.w CODE_13AC15
	JMP.w CODE_autotile_interior_shared_default

CODE_13AB7E:
CODE_autotile_interior_MT_default:
	LDA.w DATA_13AEE7,y
	JMP.w CODE_autotile_dispatch_epilogue

CODE_13AB84:
CODE_autotile_interior_MM_anchor_bias:
	REP.b #$20
	TYA
	BNE.b CODE_autotile_interior_shared_default
	LDA.b $12
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_Family1B00_Anchor
	BNE.b CODE_autotile_interior_shared_default
	LDA.b $12
	AND.w #$00FF
	CMP.w #$0010
	BCC.b CODE_autotile_interior_shared_default
	INY
	INY
CODE_13AB9F:
CODE_autotile_interior_shared_default:
	LDA.w DATA_13AF25,y
	JMP.w CODE_autotile_dispatch_epilogue

CODE_13ABA5:
CODE_autotile_interior_MB_entry:
	REP.b #$20
	JSR.w CODE_13AC04
	BIT.w #$0001
	BEQ.b CODE_autotile_interior_MB_default
	JSR.w CODE_13AC15
	JMP.w CODE_autotile_interior_shared_default

CODE_13ABB5:
CODE_autotile_interior_MB_default:
	LDA.w DATA_13AF63,y
	JMP.w CODE_autotile_dispatch_epilogue

CODE_13ABBB:
CODE_autotile_interior_RT_entry:
	REP.b #$20
	JSR.w CODE_13AC04
	BIT.w #$0001
	BEQ.b CODE_autotile_interior_RT_default
	JSR.w CODE_13AC15
	LDA.b $00
	ASL
	TAX
	JMP.w (DATA_13B101,x)

CODE_13ABCF:
CODE_autotile_interior_RT_default:
	LDA.w DATA_13AFA1,y
	JMP.w CODE_autotile_dispatch_epilogue

CODE_13ABD5:
CODE_autotile_interior_RM_entry:
	REP.b #$20
	JSR.w CODE_13AC04
	BIT.w #$0001
	BEQ.b CODE_autotile_interior_RM_default
	JSR.w CODE_13AC15
	JMP.w CODE_autotile_interior_shared_default

CODE_13ABE5:
CODE_autotile_interior_RM_default:
	LDA.w DATA_13AFDF,y
	JMP.w CODE_autotile_dispatch_epilogue

CODE_13ABEB:
CODE_autotile_interior_RB_entry:
	REP.b #$20
	JSR.w CODE_13AC04
	BIT.w #$0001
	BEQ.b CODE_autotile_interior_RB_default
	JSR.w CODE_13AC15
	LDA.b $00
	ASL
	TAX
	JMP.w (DATA_13B11F,x)

CODE_13ABFF:
CODE_autotile_interior_RB_default:
	LDA.w DATA_13B01D,y
CODE_13AC02:
CODE_autotile_dispatch_epilogue:
	TAY
	RTS

CODE_13AC04:
CODE_bg_autotile_classify_under:                                     ; Helper of CODE_stamp_bg_autotile_block: returns 1 in $00 if the under-tile's high byte equals BG-class base $1A62 (same class) else 0. Selects merge vs default lookup path.
	STZ.b $00
	LDA.b $12
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_Family1B00_Anchor
	BNE.b CODE_13AC12
	INC.b $00
CODE_13AC12:
	LDA.b $00
	RTS

CODE_13AC15:
CODE_bg_autotile_class_subindex:                                     ; Helper of CODE_stamp_bg_autotile_block called when same-class detected: scans DATA_13AC7B for under-tile sub-index, divides by $3E into row/column index pair (Y/$00) for jump tables.
	LDA.b $12
	LDY.w #$0000
CODE_13AC1A:
	LDX.w DATA_13AC7B,y
	CMP.w $0000,x
	BEQ.b CODE_13AC29
	INY
	INY
	CPY.w #$03E0
	BCC.b CODE_13AC1A
CODE_13AC29:
	LDX.b $1D
	STZ.b $00
CODE_13AC2D:
	TYA
	CMP.w #$003E
	BCC.b CODE_13AC3C
	SEC
	SBC.w #$003E
	TAY
	INC.b $00
	BRA.b CODE_13AC2D

CODE_13AC3C:
	RTS

DATA_13AC3D:
DATA_bg_autotile_match_list:                                     ; 31-entry recognition list of accept tiles for CODE_stamp_bg_autotile_block (other-class case). Includes $1C04,$1BF8,$1BF2,$1BFA,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor..$1C3A (decorative + autotile-mate tiles).
	dw $0000,$1C04,$1BF8,$1BF2,$1BFA,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1BF4,$1BE4
	dw $1BF6,$1BE6,$1BFC,$1BEC,$1BFE,$1BEA,$1C00,$1BE8
	dw $1C02,$1C1A,$1BE2,$1C18,$1BF0,$1BEE,!RAM_YI_Level_TileTpl_FloorRow0_LeftLo,!RAM_YI_Level_TileTpl_FloorRow0_RightLo
	dw $1C2E,$1C30,$1C32,$1C34,$1C36,$1C38,$1C3A

DATA_13AC7B:
DATA_bg_autotile_class_list:                                     ; 31-entry same-class sub-tile list ($1A80,$1AA0,...$1BDC) scanned by CODE_bg_autotile_class_subindex to find the under-tile's sub-index for class-aware merging.
	dw $1A80,$1AA0,$1AAC,$1B80,$1AC4,$1AB4,$1AE0,$1B9C
	dw $1AF8,$1AD0,$1B04,$1B8C,$1B0C,$1BA4,$1B14,$1BBC
	dw $1B1C,$1B24,$1BAC,$1B30,$1B58,$1AE8,$1B6C,$1B6C
	dw $1B6A,$1AFC,$1BC8,$1BD0,$1BD4,$1BD8,$1BDC

DATA_13ACB9:
DATA_bg_autotile_vstrip_top_tiles:                                     ; 31-entry tile table for the TOP cell of the single-column (vertical-strip) case of CODE_stamp_bg_autotile_block, default non-same-class branch.
	dw $1A7A,$1A9A,$1AA4,$1B78,$1ABC,$1AB2,$1ADE,$1B9A
	dw $1A7A,$1A7A,$1B00,$1B88,$1B08,$1BA0,$1A7A,$1A7A
	dw $1A7A,$1A7A,$1A7A,$1B3C,$1B50,$1A7A,$1B6E,$1B6E
	dw $1B66,$1AFA,$1BC0,$1BCE,$1BD2,$1BD6,$1BDA

DATA_13ACF7:
DATA_bg_autotile_vstrip_mid_tiles:                                     ; 31-entry tile table for the MIDDLE cells of the single-column (vertical-strip) case of CODE_stamp_bg_autotile_block, default non-same-class branch.
	dw $1A7C,$1A9C,$1AAA,$1B7E,$1AC2,$1AB6,$1A7C,$1A7C
	dw $1A7C,$1A7C,$1A7C,$1A7C,$1A7C,$1A7C,$1A7C,$1A7C
	dw $1A7C,$1A7C,$1A7C,$1BDE,$1B56,$1A7C,$1B6C,$1B6C
	dw $1B66,$1AFA,$1BC6,$1BD0,$1BD4,$1BD6,$1BDA

DATA_13AD35:
DATA_bg_autotile_vstrip_bot_tiles:                                     ; 31-entry tile table for the BOTTOM cell of the single-column (vertical-strip) case of CODE_stamp_bg_autotile_block, default non-same-class branch.
	dw $1A7E,$1A9E,$1AB0,$1B84,$1AC8,$1AB8,$1A7E,$1A7E
	dw $1AF6,$1A7E,$1A7E,$1A7E,$1A7E,$1A7E,$1B10,$1BB8
	dw $1B18,$1B2C,$1BB4,$1B3A,$1B5C,$1AE4,$1B6C,$1B6C
	dw $1B66,$1AFA,$1BD8,$1BCE,$1BD2,$1BD6,$1BDA

DATA_13AD73:
DATA_bg_autotile_hstrip_left_tiles:                                     ; 31-entry tile table for the LEFT cell of the single-row (horizontal-strip) case of CODE_stamp_bg_autotile_block, default non-same-class branch.
	dw $1A74,$1A94,$1AA6,$1B7A,$1A74,$1A74,$1AD8,$1B94
	dw $1AF0,$1ACA,$1B02,$1B8A,$1A74,$1A74,$1B12,$1BBA
	dw $1A74,$1B20,$1BA8,$1A74,$1A74,$1A74,$1B70,$1B70
	dw $1B68,$1AFC,$1BC2,$1BCE,$1BD2,$1BD6,$1BDA

DATA_13ADB1:
DATA_bg_autotile_hstrip_mid_tiles:                                     ; 31-entry tile table for the MIDDLE cells of the single-row (horizontal-strip) case of CODE_stamp_bg_autotile_block, default non-same-class branch.
	dw $1A76,$1A96,$1A76,$1A76,$1A76,$1A76,$1ADA,$1B96
	dw $1AF2,$1ACC,$1A76,$1A76,$1A76,$1A76,$1A76,$1A76
	dw $1A76,$1B2A,$1BB2,$1A76,$1A76,$1A76,$1B72,$1B72
	dw $1B68,$1AFC,$1BC2,$1BCE,$1BD2,$1BD6,$1BDA

DATA_13ADEF:
DATA_bg_autotile_hstrip_right_tiles:                                     ; 31-entry tile table for the RIGHT cell of the single-row (horizontal-strip) case of CODE_stamp_bg_autotile_block, default non-same-class branch.
	dw $1A78,$1A98,$1A78,$1A78,$1ABE,$1A78,$1A78,$1A78
	dw $1A78,$1ACE,$1A78,$1A78,$1B0A,$1BA2,$1A78,$1A78
	dw $1B1A,$1B22,$1BAA,$1A78,$1B52,$1AE6,$1B74,$1B74
	dw $1B68,$1AFC,$1BC2,$1BCE,$1BD2,$1BD6,$1BDA

DATA_13AE2D:
DATA_bg_autotile_int_LT_tiles:                                     ; 31-entry interior tile table for LEFT-column TOP-row cell (LT entry) of CODE_stamp_bg_autotile_block, default non-same-class branch.
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,$1A82,$1AA2,$1B76,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1AD2,$1B8E
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1AFE,$1B86,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B32,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B6C,$1B6C
	dw $1B64,$1AFA,$1BBE,$1BCE,$1BD2,$1BD6,$1BDA

DATA_13AE6B:
DATA_bg_autotile_int_LM_tiles:                                     ; 31-entry interior tile table for LEFT-column MIDDLE-row cell (LM entry) of CODE_stamp_bg_autotile_block, default non-same-class branch.
	dw $1A68,$1A88,$1AA8,$1B7C,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B36,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B6C,$1B6C
	dw $1B64,$1AFA,$1BBE,$1BCE,$1BD2,$1BD6,$1BDA

DATA_13AEA9:
DATA_bg_autotile_int_LB_tiles:                                     ; 31-entry interior tile table for LEFT-column BOTTOM-row cell (LB entry) of CODE_stamp_bg_autotile_block, default non-same-class branch.
	dw $1A6E,$1A8E,$1AAE,$1B84,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor
	dw $1AEA,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B0E,$1BB6
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B26,$1BAE,$1B3E,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B5E,$1B5E
	dw $1B64,$1AFA,$1BBE,$1BCE,$1BD2,$1BD6,$1BDA

DATA_13AEE7:
DATA_bg_autotile_int_MT_tiles:                                     ; 31-entry interior tile table for MIDDLE-column TOP-row cell (MT entry) of CODE_stamp_bg_autotile_block, default non-same-class branch.
	dw $1A64,$1A84,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1AD4,$1B90
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B44,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B6E,$1B6E
	dw $1B64,$1AFA,$1BBE,$1BCE,$1BD2,$1BD6,$1BDA

DATA_13AF25:
DATA_bg_autotile_int_MM_tiles:                                     ; 31-entry interior tile table for MIDDLE-column MIDDLE-row cell (MM entry, also shared default for non-corner interior entries) of CODE_stamp_bg_autotile_block, default non-same-class branch.
	dw $1A6A,$1A8A,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B2E,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B6E,$1B6E
	dw $1B64,$1AFA,$1BBE,$1BCE,$1BD2,$1BD6,$1BDA

DATA_13AF63:
DATA_bg_autotile_int_MB_tiles:                                     ; 31-entry interior tile table for MIDDLE-column BOTTOM-row cell (MB entry) of CODE_stamp_bg_autotile_block, default non-same-class branch.
	dw $1A70,$1A90,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor
	dw $1AEC,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B1E,$1BA6,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B60,$1B60
	dw $1B64,$1AFA,$1BBE,$1BCE,$1BD2,$1BD2,$1BD6

DATA_13AFA1:
DATA_bg_autotile_int_RT_tiles:                                     ; 31-entry interior tile table for RIGHT-column TOP-row cell (RT entry) of CODE_stamp_bg_autotile_block, default non-same-class branch.
	dw $1A66,$1A86,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1ABA,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1AD6,$1B92
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B06,$1B9E,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B34,$1B4E,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B74,$1B74
	dw $1B64,$1AFA,$1BBE,$1BCE,$1BD2,$1BD6,$1BDA

DATA_13AFDF:
DATA_bg_autotile_int_RM_tiles:                                     ; 31-entry interior tile table for RIGHT-column MIDDLE-row cell (RM entry) of CODE_stamp_bg_autotile_block, default non-same-class branch.
	dw $1A6C,$1A8C,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1AC0,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B28,$1BB0,$1B38,$1B54,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1B62,$1B62
	dw $1B64,$1AFA,$1BC4,$1BCE,$1BD2,$1BD6,$1BDA

DATA_13B01D:
DATA_bg_autotile_int_RB_tiles:                                     ; 31-entry interior tile table for RIGHT-column BOTTOM-row cell (RB entry) of CODE_stamp_bg_autotile_block, default non-same-class branch.
	dw $1A72,$1A92,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1AC6,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor
	dw $1AEE,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor
	dw $1B16,$1B28,$1BB0,$1B40,$1B5A,$1AE2,$1B62,$1B62
	dw $1B64,$1AFA,$1BCA,$1BCE,$1BD2,$1BD6,$1BDA

DATA_13B05B:
DATA_bg_autotile_class_jump_vstrip_top:                                     ; 8-entry class-aware jump table for the TOP cell of the single-column (vertical-strip) case of CODE_stamp_bg_autotile_block. Indexed via DATA_..._vstrip_top-$08,x so $00 must be >=4 to land in this table.
	dw CODE_autotile_interior_LT_default
	dw CODE_autotile_interior_MT_default
	dw CODE_autotile_interior_RT_default
	dw CODE_autotile_interior_LT_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_LM_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default

DATA_13B06B:
DATA_bg_autotile_class_jump_vstrip_mid:                                     ; 6-entry class-aware jump table for the MIDDLE cells of the single-column (vertical-strip) case of CODE_stamp_bg_autotile_block.
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_RM_default
	dw CODE_autotile_interior_LM_default
	dw CODE_autotile_interior_shared_default

DATA_13B077:
DATA_bg_autotile_class_jump_vstrip_bot:                                     ; 15-entry class-aware jump table for the BOTTOM cell of the single-column (vertical-strip) case of CODE_stamp_bg_autotile_block.
	dw CODE_autotile_interior_RM_default
	dw CODE_autotile_interior_LM_default
	dw CODE_autotile_interior_LM_default
	dw CODE_autotile_interior_LM_default
	dw CODE_autotile_interior_LB_default
	dw CODE_autotile_interior_MB_default
	dw CODE_autotile_interior_RB_default
	dw CODE_autotile_interior_LM_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_LB_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_MB_default
	dw CODE_autotile_interior_RM_default
	dw CODE_autotile_interior_RM_default

DATA_13B095:
DATA_bg_autotile_class_jump_hstrip_left:                                     ; 15-entry class-aware jump table for the LEFT cell of the single-row (horizontal-strip) case of CODE_stamp_bg_autotile_block.
	dw CODE_autotile_interior_RB_default
	dw CODE_autotile_interior_LT_default
	dw CODE_autotile_interior_LM_default
	dw CODE_autotile_interior_LB_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_MT_default
	dw CODE_autotile_interior_shared_default

DATA_13B0B3:
DATA_bg_autotile_class_jump_hstrip_mid:                                     ; 3-entry class-aware jump table for the MIDDLE cells of the single-row (horizontal-strip) case of CODE_stamp_bg_autotile_block.
	dw CODE_autotile_interior_MB_default
	dw CODE_autotile_interior_MT_default
	dw CODE_autotile_interior_shared_default

DATA_13B0B9:
DATA_bg_autotile_class_jump_hstrip_right:                                     ; 8-entry class-aware jump table for the RIGHT cell of the single-row (horizontal-strip) case of CODE_stamp_bg_autotile_block.
	dw CODE_autotile_interior_MB_default
	dw CODE_autotile_interior_RT_default
	dw CODE_autotile_interior_RM_default
	dw CODE_autotile_interior_RB_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_MT_default

DATA_13B0C9:
DATA_bg_autotile_class_jump_LT:                                     ; 15-entry class-aware jump table for the interior LEFT-column TOP-row cell (LT entry) of CODE_stamp_bg_autotile_block.
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_MB_default
	dw CODE_autotile_interior_LM_default
	dw CODE_autotile_interior_LM_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_MT_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_LM_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_MT_default
	dw CODE_autotile_interior_shared_default

DATA_13B0E7:
DATA_bg_autotile_class_jump_LB:                                     ; 13-entry class-aware jump table for the interior LEFT-column BOTTOM-row cell (LB entry) of CODE_stamp_bg_autotile_block.
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_LM_default
	dw CODE_autotile_interior_LM_default
	dw CODE_autotile_interior_LB_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_MB_default
	dw CODE_autotile_interior_LM_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default

DATA_13B101:
DATA_bg_autotile_class_jump_RT:                                     ; 15-entry class-aware jump table for the interior RIGHT-column TOP-row cell (RT entry) of CODE_stamp_bg_autotile_block.
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_MB_default
	dw CODE_autotile_interior_RM_default
	dw CODE_autotile_interior_MT_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_MT_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default

DATA_13B11F:
DATA_bg_autotile_class_jump_RB:                                     ; 16-entry class-aware jump table for the interior RIGHT-column BOTTOM-row cell (RB entry) of CODE_stamp_bg_autotile_block.
	dw CODE_autotile_interior_RM_default
	dw CODE_autotile_interior_RM_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_MB_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_MB_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_shared_default
	dw CODE_autotile_interior_RM_default
	dw CODE_autotile_interior_RM_default
	dw CODE_autotile_interior_RB_default
	dw CODE_autotile_interior_RB_default

CODE_13B13F:
CODE_stamp_bg_autotile_decor_lookup:                                     ; Bank13 per-cell handler. Probes 4 neighbours, runs each against a 188-entry class-match table (above/below/right/left) via CODE_13B190 to morph neighbours, then looks self up in DATA_13B7A8.
	REP.b #$30
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.w #DATA_13B1B0
	STA.b $0A
	JSR.w CODE_13B190
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.w #DATA_13B32E
	STA.b $0A
	JSR.w CODE_13B190
	JSR.w CODE_probe_right_tile
	LDA.w #DATA_13B4AC
	STA.b $0A
	JSR.w CODE_13B190
	JSR.w CODE_probe_left_tile
	LDA.w #DATA_13B62A
	STA.b $0A
	JSR.w CODE_13B190
	LDA.b $12
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_13B7A8,y
	BEQ.b CODE_13B187
	TAY
	LDA.w $0000,y
CODE_13B187:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_13B190:
CODE_decor_lookup_neighbour_probe:                                     ; Helper used four times by CODE_stamp_bg_autotile_decor_lookup. Reads tile at $1D, masks high byte against $1A62 (same BG class), and if matched indexes the table at $0A by low byte to rewrite neighbour.
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_Family1B00_Anchor
	BNE.b CODE_13B1AF
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	ASL
	TAY
	LDA.b ($0A),y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13B1AF:
	RTS

;-------------------------------------------------------------------------
; DECOR-LOOKUP NEIGHBOUR-CONNECTION TABLES (5 tables below: above/below/
; right/left/self).
;
; CONTRACT: each table is a 148-191 entry array of slot ADDRESSES in the
; large structural family ($1A62+, !RAM_YI_Level_TileTpl_Family1B00_*).
; CODE_decor_lookup_neighbour_probe reads a neighbour tile, checks its
; PAGE byte against Family1B00_Anchor, and -- if matched -- uses the
; neighbour's LOW byte as an index into one of these tables to get a
; replacement slot ADDRESS. The handler dereferences that slot for the
; final Map16 ID. This is an autotile-style "what tile connects this
; neighbour to me" lookup: each direction has its own table, the table
; entries are positional shape variants within the $1A62 family.
; Individual entries are NOT named for the same reason as the big-floor
; tables above -- the table itself encodes the semantic, not each cell.
;-------------------------------------------------------------------------

DATA_13B1B0:
DATA_decor_lookup_above_tiles:                                     ; 188-entry connection tile table for the above-neighbour probe of CODE_stamp_bg_autotile_decor_lookup. Tiles in $1A6E-$1BDE range.
	dw $1A74,$1A76,$1A78,$1A6E,$1A70,$1A72,$1A6E,$1A70
	dw $1A72,$1A74,$1A76,$1A78,$1A80,$1A7E,$1A7E,$1A80
	dw $1A94,$1A96,$1A98,$1A8E,$1A90,$1A92,$1A8E,$1A90
	dw $1A92,$1A94,$1A96,$1A98,$1AA0,$1A9E,$1A9E,$1AA0
	dw $1AA6,$1AAC,$1AA6,$1AAE,$1AB0,$1AAC,$1AAE,$1AB0
	dw $1AB4,$1AB4,$1AB8,$1AB8,$1ABE,$1AC4,$1ABE,$1AC6
	dw $1AC8,$1AC4,$1AC6,$1AC8,$1ACA,$1ACC,$1ACE,$1AD0
	dw $1AD8,$1ADA,$1ADC,$1AD8,$1ADA,$1ADC,$1AE0,$1AE0
	dw $1AE2,$1AE4,$1AE6,$1AE8,$1AEA,$1AEC,$1AEE,$1AF0
	dw $1AF2,$1AF4,$1AF6,$1AF8,$1AFA,$1AFC,$1B02,$1B04
	dw $1B02,$1B04,$1B0A,$1B0C,$1B0A,$1B0C,$1B0E,$1B10
	dw $1B12,$1B14,$1B16,$1B18,$1B1A,$1B1C,$1B1E,$1B20
	dw $1B22,$1B24,$1B26,$1B28,$1B2A,$1B2C,$1B42,$1B30
	dw $1B46,$1B4A,$1B3E,$1B40,$1B3A,$1B30,$1B3E,$1B40
	dw $1B42,$1B48,$1B46,$1B48,$1B4A,$1B3A,$1B52,$1B58
	dw $1B52,$1B5A,$1B5C,$1B58,$1B5A,$1B5C,$1B5E,$1B60
	dw $1B62,$1B68,$1B6A,$1B68,$1B6A,$1B6C,$1B6E,$1B70
	dw $1B72,$1B74,$1B7A,$1B80,$1B7A,$1B82,$1B84,$1B80
	dw $1B82,$1B84,$1B8A,$1B8C,$1B8A,$1B8C,$1B94,$1B96
	dw $1B98,$1B94,$1B96,$1B98,$1B9C,$1B9C,$1BA2,$1BA4
	dw $1BA2,$1BA4,$1BA6,$1BA8,$1BAA,$1BAC,$1BAE,$1BB0
	dw $1BB2,$1BB4,$1BB6,$1BB8,$1BBA,$1BBC,$1BC2,$1BC8
	dw $1BC2,$1BCA,$1BCC,$1BC8,$1BCA,$1BCC,$1BCE,$1BD0
	dw $1BD2,$1BD4,$1BD8,$1BD8,$1BDA,$1BDC,$1BDE

DATA_13B32E:
DATA_decor_lookup_below_tiles:                                     ; 188-entry connection tile table for the below-neighbour probe of CODE_stamp_bg_autotile_decor_lookup. Tiles in $1A62-$1BDE range.
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,$1A64,$1A66,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1A64,$1A66,$1A74,$1A76
	dw $1A78,$1A74,$1A76,$1A78,$1A7A,$1A7A,$1A80,$1A80
	dw $1A82,$1A84,$1A86,$1A82,$1A84,$1A86,$1A94,$1A96
	dw $1A98,$1A94,$1A96,$1A98,$1A9A,$1A9A,$1AA0,$1AA0
	dw $1AA2,$1AA4,$1AA6,$1AA2,$1AA4,$1AAC,$1AA6,$1AAC
	dw $1AB2,$1AB4,$1AB2,$1AB4,$1ABA,$1ABC,$1ABE,$1ABA
	dw $1ABC,$1AC4,$1ABE,$1AC4,$1ACA,$1ACC,$1ACE,$1AD0
	dw $1AD2,$1AD4,$1AD6,$1AD8,$1ADA,$1ADC,$1ADE,$1AE0
	dw $1AE6,$1AE8,$1AE6,$1AE8,$1AF0,$1AF2,$1AF4,$1AF0
	dw $1AF2,$1AF4,$1AF8,$1AF8,$1AFA,$1AFC,$1AFE,$1B00
	dw $1B02,$1B04,$1B06,$1B08,$1B0A,$1B0C,$1B12,$1B14
	dw $1B12,$1B14,$1B1A,$1B1C,$1B1A,$1B1C,$1B2A,$1B20
	dw $1B22,$1B24,$1B20,$1B22,$1B2A,$1B24,$1B44,$1B30
	dw $1B32,$1B34,$1B32,$1B34,$1B30,$1B3C,$1B46,$1B4A
	dw $1B48,$1B44,$1B46,$1B48,$1B4A,$1B3C,$1B4E,$1B50
	dw $1B52,$1B4E,$1B50,$1B58,$1B52,$1B58,$1B70,$1B72
	dw $1B74,$1B64,$1B66,$1B68,$1B6A,$1B6E,$1B6E,$1B70
	dw $1B72,$1B74,$1B76,$1B78,$1B7A,$1B76,$1B78,$1B80
	dw $1B7A,$1B80,$1B86,$1B88,$1B8A,$1B8C,$1B8E,$1B90
	dw $1B92,$1B94,$1B96,$1B98,$1B9A,$1B9C,$1B9E,$1BA0
	dw $1BA2,$1BA4,$1BB2,$1BA8,$1BAA,$1BAC,$1BA8,$1BAA
	dw $1BB2,$1BAC,$1BBA,$1BBC,$1BBA,$1BBC,$1BBE,$1BC0
	dw $1BC2,$1BBE,$1BC0,$1BC8,$1BC2,$1BC8,$1BCE,$1BD0
	dw $1BD2,$1BD4,$1BD6,$1BD8,$1BDC,$1BDC,$1BDE

DATA_13B4AC:
DATA_decor_lookup_right_tiles:                                     ; 188-entry connection tile table for the right-neighbour probe of CODE_stamp_bg_autotile_decor_lookup. Tiles in $1A62-$1BDE range.
	dw !RAM_YI_Level_TileTpl_Family1B00_Anchor,!RAM_YI_Level_TileTpl_Family1B00_Anchor,$1A7A,$1A68,$1A68,$1A7C,$1A6E,$1A6E
	dw $1A7E,$1A74,$1A74,$1A80,$1A7A,$1A7C,$1A7E,$1A80
	dw $1A82,$1A82,$1A9A,$1A88,$1A88,$1A9C,$1A8E,$1A8E
	dw $1A9E,$1A94,$1A94,$1AA0,$1A9A,$1A9C,$1A9E,$1AA0
	dw $1AA2,$1AA4,$1AA6,$1AA8,$1AAA,$1AAC,$1AAE,$1AB0
	dw $1AB2,$1AB4,$1AB6,$1AB8,$1ABC,$1ABC,$1AC4,$1AC2
	dw $1AC2,$1AC4,$1AC8,$1AC8,$1ACA,$1ACA,$1AD0,$1AD0
	dw $1AD2,$1AD2,$1ADE,$1AD8,$1AD8,$1AE0,$1ADE,$1AE0
	dw $1AE4,$1AE4,$1AE8,$1AE8,$1AEA,$1AEA,$1AF6,$1AF0
	dw $1AF0,$1AF8,$1AF6,$1AF8,$1AFC,$1AFC,$1AFE,$1B00
	dw $1B02,$1B04,$1B08,$1B08,$1B0C,$1B0C,$1B0E,$1B10
	dw $1B12,$1B14,$1B18,$1B18,$1B1C,$1B1C,$1B26,$1B20
	dw $1B24,$1B24,$1B26,$1B2C,$1B20,$1B2C,$1B36,$1B30
	dw $1B32,$1B3C,$1B36,$1B4C,$1B3A,$1B3C,$1B3E,$1B3A
	dw $1B3E,$1B32,$1B46,$1B46,$1B30,$1B4C,$1B50,$1B50
	dw $1B58,$1B56,$1B56,$1B58,$1B5C,$1B5C,$1B5E,$1B5E
	dw $1B6C,$1B66,$1B66,$1B6A,$1B6A,$1B6C,$1B6E,$1B70
	dw $1B70,$1B6E,$1B76,$1B78,$1B7A,$1B7C,$1B7E,$1B80
	dw $1B82,$1B84,$1B86,$1B88,$1B8A,$1B8C,$1B8E,$1B8E
	dw $1B9A,$1B94,$1B94,$1B9C,$1B9A,$1B9C,$1BA0,$1BA0
	dw $1BA4,$1BA4,$1BA8,$1BA8,$1BAC,$1BAC,$1BAE,$1BB4
	dw $1BA8,$1BB4,$1BB6,$1BB8,$1BBA,$1BBC,$1BC0,$1BC0
	dw $1BC8,$1BC6,$1BC6,$1BC8,$1BCC,$1BCC,$1BCE,$1BD0
	dw $1BD4,$1BD4,$1BD6,$1BD8,$1BDA,$1BDC,$1BDE

DATA_13B62A:
DATA_decor_lookup_left_tiles:                                     ; 188-entry connection tile table for the left-neighbour probe of CODE_stamp_bg_autotile_decor_lookup. Tiles in $1A66-$1BDE range.
	dw $1A7A,$1A66,$1A66,$1A7C,$1A6C,$1A6C,$1A7E,$1A72
	dw $1A72,$1A80,$1A78,$1A78,$1A7A,$1A7C,$1A7E,$1A80
	dw $1A9A,$1A86,$1A86,$1A9C,$1A8C,$1A8C,$1A9E,$1A92
	dw $1A92,$1AA0,$1A98,$1A98,$1A9A,$1A9C,$1A9E,$1AA0
	dw $1AA4,$1AA4,$1AAC,$1AAA,$1AAA,$1AAC,$1AB0,$1AB0
	dw $1AB2,$1AB4,$1AB6,$1AB8,$1ABA,$1ABC,$1ABE,$1AC0
	dw $1AC2,$1AC4,$1AC6,$1AC8,$1AD0,$1ACE,$1ACE,$1AD0
	dw $1ADE,$1AD6,$1AD6,$1AE0,$1ADC,$1ADC,$1ADE,$1AE0
	dw $1AE2,$1AE4,$1AE6,$1AE8,$1AF6,$1AEE,$1AEE,$1AF8
	dw $1AF4,$1AF4,$1AF6,$1AF8,$1AFA,$1AFC,$1B00,$1B00
	dw $1B04,$1B04,$1B06,$1B08,$1B0A,$1B0C,$1B10,$1B10
	dw $1B14,$1B14,$1B16,$1B18,$1B1A,$1B1C,$1B28,$1B24
	dw $1B22,$1B24,$1B2C,$1B28,$1B22,$1B2C,$1B38,$1B30
	dw $1B3C,$1B34,$1B4C,$1B38,$1B3A,$1B3C,$1B3A,$1B40
	dw $1B40,$1B34,$1B30,$1B4A,$1B4A,$1B4C,$1B4E,$1B50
	dw $1B52,$1B54,$1B56,$1B58,$1B5A,$1B5C,$1B6C,$1B62
	dw $1B6C,$1B64,$1B66,$1B68,$1B6A,$1B6C,$1B6E,$1B6E
	dw $1B74,$1B74,$1B78,$1B78,$1B80,$1B7E,$1B7E,$1B80
	dw $1B84,$1B84,$1B88,$1B88,$1B8C,$1B8C,$1B9A,$1B92
	dw $1B92,$1B9C,$1B98,$1B98,$1B9A,$1B9C,$1B9E,$1BA0
	dw $1BA2,$1BA4,$1BB0,$1BAC,$1BAA,$1BAC,$1BB4,$1BB0
	dw $1BAA,$1BB4,$1BB8,$1BB8,$1BBC,$1BBC,$1BBE,$1BC0
	dw $1BC2,$1BC4,$1BC6,$1BC8,$1BCA,$1BCC,$1BD0,$1BD0
	dw $1BD2,$1BD4,$1BD6,$1BD8,$1BDA,$1BDC,$1BDE

DATA_13B7A8:
DATA_decor_lookup_self_tiles:                                     ; 256-entry self-tile lookup for CODE_stamp_bg_autotile_decor_lookup: indexed by ($12 AND $00FF) to produce the cell's own final tile. A $0000 entry ERASES the cell -- the BEQ at CODE_13B187 falls through to STA with A still $0000 (NOT a "keep original" skip). The low-byte $00-$0F sand tiles all hit the 16 leading zero entries, which is the "sand block remover" effect (std obj $4F). Non-zero entries are template-slot pointers, deref'd via LDA $0000,y.
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $1C04,$1C04,$1C04,$1C04,$1C04,$1C04,$1C04,$1C04
	dw $1C04,$1C04,$1C04,$1C04,$1C04,$1C04,$1C04,$1C04
	dw $1BF8,$1BF8,$1BF8,$1BF8,$1BF8,$1BF8,$1BF8,$1BF8
	dw !RAM_YI_Level_TileTpl_WideFloorPage_Anchor,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1BFA,$1BFA,$1BFA,$1BFA
	dw $1BFA,$1BFA,$1BFA,$1BFA,$1BE6,$1BE6,$1BE6,$1BE6
	dw $1BF4,$1BF4,$1BF4,$1BF4,$1BF4,$1BF4,$1BF4,$1BF4
	dw $1BEE,$1BEE,$1BEE,$1BEE,$1BF6,$1BF6,$1BF6,$1BF6
	dw $1BF6,$1BF6,$1BF6,$1BF6,$1C30,$1C30,$1BFC,$1BFC
	dw $1BFC,$1BFC,$1BFE,$1BFE,$1BFE,$1BFE,$1C00,$1C00
	dw $1C00,$1C00,$1C02,$1C02,$1C02,$1C02,$1C1A,$1C1A
	dw $1C1A,$1C1A,$1C1A,$1C1A,$1C1A,$1C1A,$1C18,$1C18
	dw $1C18,$1C18,$1C18,$1C18,$1C18,$1C18,$1C18,$1C18
	dw $1C18,$1C18,$1C18,$1C18,$1C18,$1C18,$1BF0,$1BF0
	dw $1BF0,$1BF0,$1BF0,$1BF0,$1BF0,$1BF0,!RAM_YI_Level_TileTpl_FloorRow0_LeftLo,!RAM_YI_Level_TileTpl_FloorRow0_RightLo
	dw !RAM_YI_Level_TileTpl_FloorRow0_LeftLo,$1C2E,$1C2E,$1C2E,$1C2E,!RAM_YI_Level_TileTpl_FloorRow0_LeftLo,!RAM_YI_Level_TileTpl_FloorRow0_RightLo,!RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	dw !RAM_YI_Level_TileTpl_FloorRow0_RightLo,!RAM_YI_Level_TileTpl_FloorRow0_LeftLo,$1BF2,$1BF2,$1BF2,$1BF2,$1BF2,$1BF2
	dw $1BF2,$1BF2,$1BEC,$1BEC,$1BEC,$1BEC,$1BE4,$1BE4
	dw $1BE4,$1BE4,$1BE4,$1BE4,$1BE4,$1BE4,$1BEA,$1BEA
	dw $1BEA,$1BEA,$1BE2,$1BE2,$1BE2,$1BE2,$1BE2,$1BE2
	dw $1BE2,$1BE2,$1BE8,$1BE8,$1BE8,$1BE8,$1C32,$1C32
	dw $1C32,$1C32,$1C32,$1C32,$1C32,$1C32,$1C34,$1C34
	dw $1C36,$1C36,$1C38,$1C38,$1C3A,$1C3A

CODE_13B924:
CODE_stamp_graffiti_rail:                                     ; Bank13 per-cell handler for CODE_init_graffiti_rail. Reads $15 bit 0, checks under-tile against $1C5C/$1C5E/$1D94/$1D96  matched: forces Y=$1C48 (special override); else indexes DATA_13B958 for orientation-flipped tile.
	REP.b #$30
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_13B943
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BEQ.b CODE_13B943
	CMP.w $1D94
	BEQ.b CODE_13B943
	CMP.w $1D96
	BNE.b CODE_13B948
CODE_13B943:
	LDY.w #$1C48
	BRA.b CODE_13B94C

CODE_13B948:
	LDA.w DATA_13B958,y
	TAY
CODE_13B94C:
	LDX.b $1D
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13B958:
DATA_graffiti_rail_tiles:                                     ; 2-entry decorative-pillar tile table for CODE_stamp_graffiti_rail: $1C46 (orientation 0), $1C52 (orientation 1)  the two narrow-pillar tile IDs.
	dw $1C46,$1C52

CODE_13B95C:
CODE_stamp_graffiti_rail_diagonal:                                     ; Bank13 per-cell handler for CODE_init_graffiti_rail_diagonal. Sets $9B=1 (next-row autotile flag). On first 2 rows ($2C<2), Y from $2C parity and $2A high-bit picks DATA_13B985 for a 2x2 overhang corner. Higher rows do nothing.
	REP.b #$30
	LDA.w #$0001
	STA.b $9B
	LDA.b $2C
	CMP.w #$0002
	BCS.b CODE_13B982
	ASL
	TAY
	LDA.b $2A
	BPL.b CODE_13B975
	TYA
	ORA.w #$0004
	TAY
CODE_13B975:
	LDX.b $1D
	LDA.w DATA_13B985,y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13B982:
	SEP.b #$30
	RTL

DATA_13B985:
DATA_graffiti_rail_diagonal_tiles:                                     ; 4-entry overhang tile table for CODE_stamp_graffiti_rail_diagonal: $1C50,$1C4E,$1C4A,$1C4C  TL/TR/BL/BR corners of the overhang shape.
	dw $1C50,$1C4E,$1C4A,$1C4C

CODE_13B98D:
CODE_stamp_castle_wall_platform:                                     ; Bank13 per-cell handler for CODE_init_castle_wall_platform. Skips if $12 is in wall range $00C2-$00C7 or $150D/$150E. Computes Y from column-edge state; uses DATA_13BA10; applies grass overlay if $12 in $00C4-$00C8.
	REP.b #$30
	LDA.b $12
	CMP.w #$00C2
	BCC.b CODE_13BA0D
	CMP.w #$00C8
	BCS.b CODE_13BA0D
	CMP.w #$150D
	BEQ.b CODE_13BA0D
	CMP.w #$150E
	BEQ.b CODE_13BA0D
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_13B9BF
	INC
	CMP.b $2A
	BNE.b CODE_13B9B6
	LDY.w #$0006
	BRA.b CODE_13B9BF

CODE_13B9B6:
	INY
	INY
	AND.w #$0001
	BEQ.b CODE_13B9BF
	INY
	INY
CODE_13B9BF:
	LDA.b $28
	BEQ.b CODE_13B9C8
	INC
	CMP.b $2A
	BNE.b CODE_13B9E1
CODE_13B9C8:
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_Family0200_Anchor
	BCC.b CODE_13B9D4
	CMP.w !RAM_YI_Level_TileTpl_Family1200_Anchor
	BCC.b CODE_13BA0D
CODE_13B9D4:
	CMP.w #$00D1
	BEQ.b CODE_13B9DE
	CMP.w #$00D2
	BNE.b CODE_13B9E1
CODE_13B9DE:
	LDY.w #$0002
CODE_13B9E1:
	LDA.w DATA_13BA10,y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $12
	CMP.w #$00C4
	BCC.b CODE_13BA0D
	CMP.w #$00C8
	BCS.b CODE_13BA0D
	LDA.b $28
	BEQ.b CODE_13BA0D
	LDA.b $12
	SEC
	SBC.w #$00C4
	ASL
	TAY
	LDX.b $1D
	LDA.w DATA_13BA18,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	BRA.b CODE_13BA0D

CODE_13BA0D:
	SEP.b #$30
	RTL

DATA_13BA10:
	dw $00D1,$150D,$150E,$00D2

DATA_13BA18:
	dw $151B,$151B,$0000,$151A

CODE_13BA20:
CODE_stamp_castle_wall_platform_slope:                                     ; Bank13 per-cell handler for CODE_init_castle_wall_platform_slope. 3-branch dispatch (DATA_13BA9E): mid / transition / cap, selected by orientation $15 bits 0-1. Each branch stamps from a different tile bank.
	REP.b #$30
	LDY.w #$0000
	LDA.b $2A
	BPL.b CODE_13BA2B
	INC
	INC
CODE_13BA2B:
	STA.b $00
	LDA.b $28
	BEQ.b CODE_13BA44
	INY
	INY
	INC
	CMP.b $00
	BEQ.b CODE_13BA44
	LDA.b $15
	AND.w #$0003
	ASL
	TAX
	JSR.w (DATA_13BA9E,x)
	BRA.b CODE_13BA8F

CODE_13BA44:
	LDA.b $2C
	BNE.b CODE_13BA8F
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_Family0200_Anchor
	BCC.b CODE_13BA54
	CMP.w !RAM_YI_Level_TileTpl_Family1200_Anchor
	BCC.b CODE_13BA8F
CODE_13BA54:
	CMP.w #$150D
	BEQ.b CODE_13BA8F
	CMP.w #$150E
	BEQ.b CODE_13BA8F
	CMP.w #$00D1
	BEQ.b CODE_13BA6A
	CMP.w #$00D2
	BNE.b CODE_13BA6F
	INY
	INY
CODE_13BA6A:
	LDA.w DATA_13BA98,y
	BRA.b CODE_13BA89

CODE_13BA6F:
	LDA.b $2A
	BPL.b CODE_13BA78
	TYA
	EOR.w #$0002
	TAY
CODE_13BA78:
	LDA.b $2C
	BNE.b CODE_13BA8F
	LDA.b $12
	CMP.w #$00C5
	BNE.b CODE_13BA86
	LDY.w #$0004
CODE_13BA86:
	LDA.w DATA_13BA92,y
CODE_13BA89:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13BA8F:
	SEP.b #$30
	RTL

DATA_13BA92:
DATA_castle_wall_platform_slope_default_tiles:                                     ; 3-entry default-stamp tile table for CODE_stamp_castle_wall_platform_slope: $00D1,$00D2,$151B used on non-special under-tile cases.
	dw $00D1,$00D2,$151B

DATA_13BA98:
DATA_castle_wall_platform_slope_zone_tiles:                                     ; 3-entry zone-overlay tile table for CODE_stamp_castle_wall_platform_slope: $150D,$150E,$150D applied when under-tile is in the $19DA..$1A5E zone range.
	dw $150D,$150E,$150D

DATA_13BA9E:
DATA_castle_wall_platform_slope_sub_handlers:                                     ; 3-entry sub-dispatch pointer table for CODE_stamp_castle_wall_platform_slope: CODE_13BAA4 (mid), CODE_13BAE6 (transition), CODE_13BB13 (cap).
	dw CODE_13BAA4
	dw CODE_13BAE6
	dw CODE_13BB13

CODE_13BAA4:
CODE_stamp_castle_wall_platform_slope_mid:                                     ; Mid-rectangle stamper for CODE_stamp_castle_wall_platform_slope. 8-entry DATA_13BAD6 ($1A42-$1A60 etc.) indexed by $2C/$28/orientation; sets $9B from $28 inversion (autotile state).
	LDA.b $2C
	CMP.w #$0002
	BCS.b CODE_13BAD5
	ASL
	STA.b $00
	LDA.b $28
	EOR.w #$0001
	AND.w #$0001
	STA.b $9B
	ASL
	ASL
	TAY
	LDA.b $2A
	BPL.b CODE_13BAC4
	TYA
	ORA.w #$0008
	TAY
CODE_13BAC4:
	TYA
	ORA.b $00
	TAY
	LDX.b $1D
	LDA.w DATA_13BAD6,y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13BAD5:
	RTS

DATA_13BAD6:
DATA_castle_wall_platform_slope_mid_tiles:                                     ; 8-entry mid tile table for CODE_stamp_castle_wall_platform_slope_mid: $1A42,$1A60,!RAM_YI_Level_TileTpl_Family1000_Anchor,$1A5C,$1A34,!RAM_YI_Level_TileTpl_Family1200_Anchor,!RAM_YI_Level_TileTpl_Family0C00_Anchor,$1A40. Indexed by row+column+orientation.
	dw $1A42,$1A60,!RAM_YI_Level_TileTpl_Family1000_Anchor,$1A5C,$1A34,!RAM_YI_Level_TileTpl_Family1200_Anchor,!RAM_YI_Level_TileTpl_Family0C00_Anchor,$1A40

CODE_13BAE6:
CODE_stamp_castle_wall_platform_slope_transition:                                     ; Transition-row stamper for CODE_stamp_castle_wall_platform_slope. 4-entry DATA_13BB0B ($1A16,$1A28,!RAM_YI_Level_TileTpl_Family0800_Anchor,$1A14) indexed by $2C parity and $2A sign for the transition between mid and cap rows.
	LDA.w #$0001
	STA.b $9B
	LDA.b $2C
	CMP.w #$0002
	BCS.b CODE_13BB0A
	ASL
	TAY
	LDA.b $2A
	BPL.b CODE_13BAFD
	TYA
	ORA.w #$0004
	TAY
CODE_13BAFD:
	LDX.b $1D
	LDA.w DATA_13BB0B,y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13BB0A:
	RTS

DATA_13BB0B:
DATA_castle_wall_platform_slope_trans_tiles:                                     ; 4-entry transition tile table for CODE_stamp_castle_wall_platform_slope_transition: $1A16,$1A28,!RAM_YI_Level_TileTpl_Family0800_Anchor,$1A14. Selected by row-parity + column-direction.
	dw !RAM_YI_Level_TileTpl_Family0A00_Anchor,$1A28,!RAM_YI_Level_TileTpl_Family0800_Anchor,$1A14

CODE_13BB13:
CODE_stamp_castle_wall_platform_slope_cap:                                     ; Cap-row stamper for CODE_stamp_castle_wall_platform_slope. 6-entry DATA_13BB39 ($19EE,$19F6,$1A00,!RAM_YI_Level_TileTpl_Family0200_Anchor,$19E2,$19EC) indexed by $2C row and $2A column direction.
	LDA.w #$0001
	STA.b $9B
	LDA.b $2C
	CMP.w #$0003
	BCS.b CODE_13BB38
	ASL
	TAY
	LDA.b $2A
	BPL.b CODE_13BB2B
	TYA
	CLC
	ADC.w #$0006
	TAY
CODE_13BB2B:
	LDX.b $1D
	LDA.w DATA_13BB39,y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13BB38:
	RTS

DATA_13BB39:
DATA_castle_wall_platform_slope_cap_tiles:                                     ; 6-entry cap tile table for CODE_stamp_castle_wall_platform_slope_cap: $19EE,$19F6,$1A00,!RAM_YI_Level_TileTpl_Family0200_Anchor,$19E2,$19EC. Top-cap variant per row+direction.
	dw $19EE,$19F6,$1A00,!RAM_YI_Level_TileTpl_Family0200_Anchor,$19E2,$19EC

CODE_13BB45:
CODE_stamp_seven_segment_decor:                                     ; Bank13 per-cell handler for CODE_init_seven_segment_decor. Picks a 7-entry tile-row index from $28/$2A column-edge state; under-tile $1BF8/$1BFA OR-s bit 3 in. Variant $15==$57 uses DATA_13BB8A; else DATA_13BB98.
	REP.b #$30
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_13BB59
	INY
	INY
	INC
	CMP.b $2A
	BNE.b CODE_13BB6E
	INY
	INY
	BRA.b CODE_13BB62

CODE_13BB59:
	LDA.b $12
	CMP.w $1BF8
	BNE.b CODE_13BB6E
	BRA.b CODE_13BB69

CODE_13BB62:
	LDA.b $12
	CMP.w $1BFA
	BNE.b CODE_13BB6E
CODE_13BB69:
	TYA
	ORA.w #$0008
	TAY
CODE_13BB6E:
	LDA.b $15
	CMP.w #$0057
	BEQ.b CODE_13BB7A
	LDA.w DATA_13BB98,y
	BRA.b CODE_13BB7D

CODE_13BB7A:
	LDA.w DATA_13BB8A,y
CODE_13BB7D:
	TAY
	LDX.b $1D
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13BB8A:
DATA_seven_segment_decor_v57:                                     ; 7-entry tile table for $15==$57 variant of CODE_stamp_seven_segment_decor: $1D30,$1D32,$1D34,$0000,$1D36,$1D32,$1D38.
	dw $1D30,$1D32,$1D34,$0000,$1D36,$1D32,$1D38

DATA_13BB98:
DATA_seven_segment_decor_default:                                     ; 7-entry default tile table for CODE_stamp_seven_segment_decor (used when $15!=$57): $1C8C,$1C8E,$1C90,$0000,$1C8C,$1C8E,$1C90.
	dw $1C8C,$1C8E,$1C90,$0000,$1C8C,$1C8E,$1C90

CODE_13BBA6:
CODE_stamp_thick_post_overlay:                                     ; Bank13 per-cell handler for CODE_init_thick_post_overlay. 3-branch dispatch (DATA_13BBBE): CODE_13BBC4 (left-edge), CODE_13BC73 (interior), CODE_13BCD4 (right-edge). Uses $A1 as previously-overlaid flag.
	REP.b #$30
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_13BBB8
	INX
	INX
	INC
	CMP.b $2A
	BNE.b CODE_13BBB8
	INX
	INX
CODE_13BBB8:
	JSR.w (DATA_13BBBE,x)
	SEP.b #$30
	RTL

DATA_13BBBE:
DATA_thick_post_sub_handlers:                                     ; 3-entry pointer table for CODE_stamp_thick_post_overlay column-edge dispatch: CODE_13BBC4 (left), CODE_13BC73 (interior), CODE_13BCD4 (right).
	dw CODE_13BBC4
	dw CODE_13BC73
	dw CODE_13BCD4

CODE_13BBC4:
CODE_thick_post_left_edge:                                     ; Left-edge stamper for CODE_stamp_thick_post_overlay. Tests below-tile against $1CE8/$1CEA/$1CAE-$1CCA; matched sets $A1=1 + may stamp $1CE6 (top row) or $1CF6 (bottom row) as autotile overlay.
	LDA.b $A1
	BPL.b CODE_thick_post_left_edge_body
	JMP.w CODE_thick_post_left_edge_exit

CODE_13BBCB:
CODE_thick_post_left_edge_body:
	LDA.b $A1
	BNE.b CODE_13BBEF
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w $1CE8
	BEQ.b CODE_13BBEF
	CMP.w $1CEA
	BEQ.b CODE_13BBEF
	CMP.w $1CAE
	BCC.b CODE_13BC2A
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndSelfMarkA
	BCS.b CODE_13BC2A
CODE_13BBEF:
	LDA.w #$0001
	STA.b $A1
	LDA.b $2C
	BEQ.b CODE_13BC25
	LDA.w #$0001
	STA.b $15
	JSL.l CODE_floor_edge_random_side
	REP.b #$30
	JSR.w CODE_probe_right_tile
	CMP.w #$007D
	BEQ.b CODE_13BC1A
	CMP.w #$007E
	BEQ.b CODE_13BC1A
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_13BC1A
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BNE.b CODE_13BC23
CODE_13BC1A:
	LDX.b $1D
	LDA.w $1CE6
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13BC23:
	BRA.b CODE_thick_post_left_edge_exit

CODE_13BC25:
	LDA.w $1CF6
	BRA.b CODE_13BC6C

CODE_13BC2A:
	LDA.b $2C
	BNE.b CODE_thick_post_left_edge_exit
	LDA.b $12
	CMP.w $1CF0
	BEQ.b CODE_13BC4E
	CMP.w $1CF2
	BEQ.b CODE_13BC4E
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndBoundA
	BEQ.b CODE_13BC4E
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndBoundB
	BEQ.b CODE_13BC4E
	CMP.w $1CF8
	BEQ.b CODE_13BC4E
	CMP.w $1CFA
	BNE.b CODE_13BC53
CODE_13BC4E:
	LDA.w $1CF2
	BRA.b CODE_13BC6C

CODE_13BC53:
	LDA.w #$8000
	STA.b $A1
	LDA.b $12
	CMP.w $1C28
	BEQ.b CODE_thick_post_left_edge_exit
	CMP.w $1BF6
	BNE.b CODE_13BC69
	LDA.w $1C28
	BRA.b CODE_13BC6C

CODE_13BC69:
	LDA.w $1CF0
CODE_13BC6C:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13BC72:
CODE_thick_post_left_edge_exit:
	RTS

CODE_13BC73:
CODE_thick_post_interior:                                     ; Interior stamper for CODE_stamp_thick_post_overlay. Clears $A1. On top row scans DATA_13BCA4 (12-entry match list) for $12 and indexes DATA_13BCBC for the replacement tile.
	STZ.b $A1
	LDA.b $2C
	BNE.b CODE_13BCA3
	LDA.b $12
	CMP.w $1C28
	BEQ.b CODE_13BCA3
	LDY.w #$0000
CODE_13BC83:
	LDX.w DATA_13BCA4,y
	CMP.w $0000,x
	BEQ.b CODE_13BC97
	INY
	INY
	CPY.w #$0018
	BCC.b CODE_13BC83
	LDA.w $1CF2
	BRA.b CODE_13BC9D

CODE_13BC97:
	LDX.w DATA_13BCBC,y
	LDA.w $0000,x
CODE_13BC9D:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13BCA3:
	RTS

DATA_13BCA4:
DATA_thick_post_int_match:                                     ; 12-entry tile-ID match list for CODE_thick_post_interior: $1BE2,$1BE6,$1BE8,$1BEE,$1BF6,$1C00,$1C02,$1C1A,$1C30,$1C34,$1C36,$1C3A.
	dw $1BE2,$1BE6,$1BE8,$1BEE,$1BF6,$1C00,$1C02,$1C1A
	dw $1C30,$1C34,$1C36,$1C3A

DATA_13BCBC:
DATA_thick_post_int_replace:                                     ; 12-entry replacement-pointer list paired with DATA_13BCA4: $1C28,$1C28,$1C26,$1C2A,$1C28,$1C26,$1C2A,$1C28,$1C2A,$1C26,$1C2A,$1C2C.
	dw $1C28,$1C28,$1C26,$1C2A,$1C28,$1C26,$1C2A,$1C28
	dw $1C2A,$1C26,$1C2A,$1C2C

CODE_13BCD4:
CODE_thick_post_right_edge:                                     ; Right-edge stamper for CODE_stamp_thick_post_overlay (mirror of left-edge). Tests below-tile against $1CE8/$1CEA/$1CAE-$1CCA; matched sets $A1=1 and may stamp $1CE4 or $1CF4/$1CFA depending on row.
	LDA.b $A1
	BPL.b CODE_thick_post_right_edge_body
	JMP.w CODE_thick_post_right_edge_exit

CODE_13BCDB:
CODE_thick_post_right_edge_body:
	LDA.b $A1
	BNE.b CODE_13BCFF
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w $1CE8
	BEQ.b CODE_13BCFF
	CMP.w $1CEA
	BEQ.b CODE_13BCFF
	CMP.w $1CAE
	BCC.b CODE_13BD37
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndSelfMarkA
	BCS.b CODE_13BD37
CODE_13BCFF:
	LDA.w #$0001
	STA.b $A1
	LDA.b $2C
	BEQ.b CODE_13BD32
	STZ.b $15
	JSL.l CODE_floor_edge_random_side
	REP.b #$30
	JSR.w CODE_probe_left_tile
	CMP.w #$007D
	BEQ.b CODE_13BD27
	CMP.w #$007F
	BEQ.b CODE_13BD27
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_13BD27
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BNE.b CODE_13BD30
CODE_13BD27:
	LDX.b $1D
	LDA.w $1CE4
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13BD30:
	BRA.b CODE_thick_post_right_edge_exit

CODE_13BD32:
	LDA.w $1CF4
	BRA.b CODE_13BD79

CODE_13BD37:
	LDA.b $2C
	BNE.b CODE_thick_post_right_edge_exit
	LDA.b $12
	CMP.w $1CF0
	BEQ.b CODE_13BD5B
	CMP.w $1CF2
	BEQ.b CODE_13BD5B
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndBoundA
	BEQ.b CODE_13BD5B
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndBoundB
	BEQ.b CODE_13BD5B
	CMP.w $1CF8
	BEQ.b CODE_13BD5B
	CMP.w $1CFA
	BNE.b CODE_13BD60
CODE_13BD5B:
	LDA.w $1CF2
	BRA.b CODE_13BD79

CODE_13BD60:
	LDA.w #$8000
	STA.b $A1
	LDA.b $12
	CMP.w $1C28
	BEQ.b CODE_thick_post_right_edge_exit
	CMP.w $1BF6
	BNE.b CODE_13BD76
	LDA.w $1C28
	BRA.b CODE_13BD79

CODE_13BD76:
	LDA.w $1CFA
CODE_13BD79:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13BD7F:
CODE_thick_post_right_edge_exit:
	RTS

CODE_13BD80:
CODE_stamp_tunnel_floor_slope_v0:                                     ; Bank13 per-cell handler for CODE_init_tunnel_floor_slope_right variant 0. Left edge: CODE_13C175 + $9B from $15 bit 2. Right edge: CODE_13C1F0 if not top. Otherwise tests $12 vs $1CF4/$1CF6 and indexes DATA_13BDF7.
	REP.b #$30
	LDA.b $28
	BEQ.b CODE_13BD9B
	INC
	CMP.b $2A
	BNE.b CODE_13BDA7
	LDA.b $15
	AND.w #$0004
	BNE.b CODE_13BD96
	LDA.b $2C
	BEQ.b CODE_tunnel_floor_slope_v0_after_right_neighbour
CODE_13BD96:
	JSR.w CODE_13C1F0
CODE_13BD99:
CODE_tunnel_floor_slope_v0_after_right_neighbour:
	BRA.b CODE_tunnel_floor_slope_v0_exit

CODE_13BD9B:
	JSR.w CODE_13C175
	LDA.b $15
	AND.w #$0004
	STA.b $9B
	BRA.b CODE_tunnel_floor_slope_v0_exit

CODE_13BDA7:
	LDA.b $2C
	CMP.w #$0002
	BCS.b CODE_13BDE7
	ASL
	STA.b $00
	LDA.b $28
	AND.w #$0001
	EOR.w #$0001
	STA.b $9B
	ASL
	ASL
	ORA.b $00
	TAY
	LDA.b $15
	AND.w #$0004
	ASL
	STA.b $00
	TYA
	ORA.b $00
	TAY
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndBoundA
	BEQ.b CODE_tunnel_floor_slope_v0_exit
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndBoundB
	BEQ.b CODE_tunnel_floor_slope_v0_exit
	LDA.w DATA_13BDF7,y
	TAY
	LDX.b $1D
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	BRA.b CODE_tunnel_floor_slope_v0_exit

CODE_13BDE7:
	JSR.w CODE_13C15F
CODE_13BDEA:
CODE_tunnel_floor_slope_v0_exit:
	LDA.b $28
	INC
	INC
	CMP.b $2A
	BNE.b CODE_13BDF4
	STZ.b $9B
CODE_13BDF4:
	SEP.b #$30
	RTL

DATA_13BDF7:
DATA_tunnel_floor_slope_v0_tiles:                                     ; 8-entry tile table for CODE_stamp_tunnel_floor_slope_v0: $1D42,$1CB2,$1D44,$1CB4,$1D3A,$1CB2,$1D3C,$1CB4. Picked by row-parity + orientation.
	dw $1D42,$1CB2,$1D44,$1CB4,$1D3A,$1CB2,$1D3C,$1CB4

CODE_13BE07:
CODE_stamp_tunnel_floor_slope_v1:                                     ; Variant 1 of CODE_init_tunnel_floor_slope_right. Similar to v0 but uses DATA_13BE70 (4-entry) for the body tiles. Width-2 slope-up shape with autotile-glue at the edges.
	REP.b #$30
	LDA.b $28
	BEQ.b CODE_13BE22
	INC
	CMP.b $2A
	BNE.b CODE_13BE2E
	LDA.b $15
	AND.w #$0004
	BNE.b CODE_13BE1D
	LDA.b $2C
	BEQ.b CODE_tunnel_floor_slope_v1_after_right_neighbour
CODE_13BE1D:
	JSR.w CODE_13C1F0
CODE_13BE20:
CODE_tunnel_floor_slope_v1_after_right_neighbour:
	BRA.b CODE_tunnel_floor_slope_v1_exit

CODE_13BE22:
	JSR.w CODE_13C175
	LDA.b $15
	AND.w #$0004
	STA.b $9B
	BRA.b CODE_tunnel_floor_slope_v1_exit

CODE_13BE2E:
	LDA.b $2C
	CMP.w #$0002
	BCS.b CODE_13BE60
	ASL
	STA.b $00
	LDA.b $15
	AND.w #$0004
	ORA.b $00
	TAY
	LDA.w #$0001
	STA.b $9B
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndBoundA
	BEQ.b CODE_tunnel_floor_slope_v1_exit
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndBoundB
	BEQ.b CODE_tunnel_floor_slope_v1_exit
	LDA.w DATA_13BE70,y
	TAY
	LDX.b $1D
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	BRA.b CODE_tunnel_floor_slope_v1_exit

CODE_13BE60:
	JSR.w CODE_13C15F
CODE_13BE63:
CODE_tunnel_floor_slope_v1_exit:
	LDA.b $28
	INC
	INC
	CMP.b $2A
	BNE.b CODE_13BE6D
	STZ.b $9B
CODE_13BE6D:
	SEP.b #$30
	RTL

DATA_13BE70:
DATA_tunnel_floor_slope_v1_tiles:                                     ; 4-entry tile table for CODE_stamp_tunnel_floor_slope_v1: $1D5A,$1CB2,$1D56,$1CB4. Picked by column position within rectangle.
	dw $1D5A,$1CB2,$1D56,$1CB4

CODE_13BE78:
CODE_stamp_tunnel_floor_slope_v2:                                     ; Variant 2 of CODE_init_tunnel_floor_slope_right. Width-3 shape (BCS $0003 vs $0002 in v0/v1). Uses DATA_13BEE7 (7-entry $1D50/$1D52/$1CB2/$0000/$1D4A/$1D4C/$1CB4).
	REP.b #$30
	LDA.b $28
	BEQ.b CODE_13BE98
	INC
	CMP.b $2A
	BNE.b CODE_13BEA4
	LDA.b $15
	AND.w #$0004
	BNE.b CODE_13BE93
	LDA.b $2C
	BEQ.b CODE_tunnel_floor_slope_v2_after_right_neighbour
	CMP.w #$0001
	BEQ.b CODE_tunnel_floor_slope_v2_after_right_neighbour
CODE_13BE93:
	JSR.w CODE_13C1F0
CODE_13BE96:
CODE_tunnel_floor_slope_v2_after_right_neighbour:
	BRA.b CODE_tunnel_floor_slope_v2_exit

CODE_13BE98:
	JSR.w CODE_13C175
	LDA.b $15
	AND.w #$0004
	STA.b $9B
	BRA.b CODE_tunnel_floor_slope_v2_exit

CODE_13BEA4:
	LDA.b $2C
	CMP.w #$0003
	BCS.b CODE_13BED7
	ASL
	STA.b $00
	LDA.b $15
	AND.w #$0004
	ASL
	ORA.b $00
	TAY
	LDA.w #$0001
	STA.b $9B
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndBoundA
	BEQ.b CODE_tunnel_floor_slope_v2_exit
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_RndBoundB
	BEQ.b CODE_tunnel_floor_slope_v2_exit
	LDA.w DATA_13BEE7,y
	TAY
	LDX.b $1D
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	BRA.b CODE_tunnel_floor_slope_v2_exit

CODE_13BED7:
	JSR.w CODE_13C15F
CODE_13BEDA:
CODE_tunnel_floor_slope_v2_exit:
	LDA.b $28
	INC
	INC
	CMP.b $2A
	BNE.b CODE_13BEE4
	STZ.b $9B
CODE_13BEE4:
	SEP.b #$30
	RTL

DATA_13BEE7:
DATA_tunnel_floor_slope_v2_tiles:                                     ; 7-entry tile table for CODE_stamp_tunnel_floor_slope_v2: $1D50,$1D52,$1CB2,$0000,$1D4A,$1D4C,$1CB4. $0000 is a gap for unused index.
	dw $1D50,$1D52,$1CB2,$0000,$1D4A,$1D4C,$1CB4

CODE_13BEF5:
CODE_stamp_tunnel_ceiling_slope_right:                                     ; Bank13 per-cell handler for CODE_init_tunnel_ceiling_slope_right. Reads $15 bit 5 into $02. On right edge of last row pre-decrements $2E; tests $12 vs $1C04 and may rewrite to $1C1E. Calls CODE_13C1F0/CODE_13C175.
	REP.b #$30
	LDX.b $1D
	LDA.b $15
	AND.w #$0020
	LSR
	STA.b $02
	LDA.b $28
	BEQ.b CODE_tunnel_ceiling_slope_right_first_col
	INC
	CMP.b $2A
	BNE.b CODE_tunnel_ceiling_slope_right_interior
	LDA.b $02
	BEQ.b CODE_13BF14
	LDA.b $2C
	BNE.b CODE_13BF14
	DEC.b $2E
CODE_13BF14:
	LDA.b $2C
	INC
	CMP.b $2E
	BEQ.b CODE_tunnel_ceiling_slope_right_seam
	JSR.w CODE_13C1F0
	STZ.b $A1
	JMP.w CODE_tunnel_ceiling_slope_right_exit

CODE_13BF23:
CODE_tunnel_ceiling_slope_right_seam:
	LDA.b $A1
	BNE.b CODE_13BF35
	LDA.b $12
	CMP.w $1C04
	BNE.b CODE_13BF35
	LDA.w $1C1E
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13BF35:
	JMP.w CODE_tunnel_ceiling_slope_right_exit

CODE_13BF38:
CODE_tunnel_ceiling_slope_right_first_col:
	LDA.b $2C
	INC
	CMP.b $2E
	BCS.b CODE_tunnel_ceiling_slope_right_first_col_exit
	JSR.w CODE_13C175
CODE_13BF42:
CODE_tunnel_ceiling_slope_right_first_col_exit:
	JMP.w CODE_tunnel_ceiling_slope_right_exit

CODE_13BF45:
CODE_tunnel_ceiling_slope_right_interior:
	LDA.b $02
	BEQ.b CODE_13BF62
	LDA.b $2C
	BNE.b CODE_13BF62
	LDA.b $28
	CMP.w #$0001
	BEQ.b CODE_13BF62
	DEC.b $2E
	LDA.b $2E
	CMP.w #$0002
	BNE.b CODE_13BF62
	LDA.w #$0002
	BRA.b CODE_13BF8D

CODE_13BF62:
	LDA.b $28
	INC
	INC
	CMP.b $2A
	BNE.b CODE_13BF83
	LDA.b $2C
	BNE.b CODE_13BF83
	LDA.b $2E
	CMP.w #$0003
	BCS.b CODE_13BF83
	DEC.b $2A
	LDA.b $2A
	CMP.w #$0002
	BEQ.b CODE_13BF8D
	LDA.w #$0001
	BRA.b CODE_13BF8D

CODE_13BF83:
	LDA.b $2C
	INC
	INC
	CMP.b $2E
	BCC.b CODE_13BFDE
	LDA.b $2E
CODE_13BF8D:
	CLC
	SBC.b $2C
	BMI.b CODE_tunnel_ceiling_slope_right_exit
	ASL
	STA.b $00
	LDA.b $28
	AND.w #$0001
	EOR.w #$0001
	ASL
	ASL
	ASL
	ORA.b $00
	ORA.b $02
	STA.b $00
	TAY
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CMP.w #$0008
	BNE.b CODE_13BFB6
	LDA.w DATA_13C015,y
	BEQ.b CODE_tunnel_ceiling_slope_right_exit
	BRA.b CODE_13BFB9

CODE_13BFB6:
	LDA.w DATA_tunnel_ceiling_slope_right_default_tiles,y
CODE_13BFB9:
	TAY
	LDA.w $0000,y
	CMP.w $1C1E
	BNE.b CODE_13BFCE
	LDA.b $12
	CMP.w $1C18
	BEQ.b CODE_13BFCE
	CMP.w $1C04
	BNE.b CODE_tunnel_ceiling_slope_right_exit
CODE_13BFCE:
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $00
	AND.w #$0008
	STA.b $A1
	BRA.b CODE_tunnel_ceiling_slope_right_exit

CODE_13BFDE:
	JSR.w CODE_13C15F
	LDA.b $02
	BNE.b CODE_tunnel_ceiling_slope_right_exit
	LDA.b $2C
	BNE.b CODE_tunnel_ceiling_slope_right_exit
	LDA.b $28
	AND.w #$0001
	BNE.b CODE_tunnel_ceiling_slope_right_exit
	DEC.b $2E
CODE_13BFF2:
CODE_tunnel_ceiling_slope_right_exit:
	SEP.b #$30
	RTL

DATA_13BFF5:
DATA_tunnel_ceiling_slope_right_default_tiles:
	dw $1C1E,$1D6C,$1CB2,$0000,$1D72,$1CB4,$0000,$0000
	dw $1C1E,$1D82,$1CB2,$0000,$1C1E,$1D82,$1CB4,$0000

DATA_13C015:
DATA_wide_floor_block_aux_pointers:                                     ; 16-entry mixed table for CODE_tunnel_ceiling_slope_left secondary fix-up: pointer-to-DATA_13C035/_037/_039 tiles, sentinel $1CB2/$1CB4 edges, and zero gaps. Selected via $15 orientation + $2C row mask.
	dw $0000,DATA_13C035,$1CB2,$0000,DATA_13C037,$1CB4,$0000,$0000
	dw $0000,DATA_13C039,$1CB2,$0000,$0000,DATA_13C039,$1CB4,$0000

DATA_13C035:
DATA_wide_floor_tile_a:                                     ; Single-word pointer-tile $5703 used as one branch target by CODE_tunnel_ceiling_slope_left via DATA_13C015.
	dw $5703

DATA_13C037:
DATA_wide_floor_tile_b:                                     ; Single-word pointer-tile $5903 used as one branch target by CODE_tunnel_ceiling_slope_left via DATA_13C015.
	dw $5903

DATA_13C039:
DATA_wide_floor_tile_c:                                     ; Single-word pointer-tile $5D04 used as one branch target by CODE_tunnel_ceiling_slope_left via DATA_13C015.
	dw $5D04

CODE_13C03B:
CODE_tunnel_ceiling_slope_left:                                     ; Object $61/$62 cell stamp: large floor-block body. Branches on $28/$2A/$2C/$2E into 6 cases  edge-replace via DATA_13C119/_139, neighbour-fix via CODE_13C175/_1F0, or PRNG-fill via CODE_floor_random_8way_pick.
	REP.b #$30
	LDA.b $15
	AND.w #$0002
	ASL
	ASL
	ASL
	STA.b $02
	LDA.b $28
	BEQ.b CODE_wide_floor_first_col
	INC
	CMP.b $2A
	BNE.b CODE_wide_floor_interior
	LDA.b $2C
	BNE.b CODE_13C056
	INC.b $2E
CODE_13C056:
	LDA.b $2C
	INC
	CMP.b $2E
	BEQ.b CODE_13C07E
	INC
	CMP.b $2E
	BEQ.b CODE_wide_floor_last_col_seam
	JSR.w CODE_13C1F0
	STZ.b $A1
	JMP.w CODE_wide_floor_exit

CODE_13C06A:
CODE_wide_floor_last_col_seam:
	LDA.b $A1
	BNE.b CODE_13C07E
	LDA.b $12
	CMP.w $1C04
	BNE.b CODE_13C07E
	LDX.b $1D
	LDA.w $1C1E
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13C07E:
	JMP.w CODE_wide_floor_exit

CODE_13C081:
CODE_wide_floor_first_col:
	LDA.b $2E
	CMP.w #$0001
	BEQ.b CODE_wide_floor_first_col_exit
	LDA.b $2C
	INC
	CMP.b $2E
	BEQ.b CODE_wide_floor_first_col_exit
	JSR.w CODE_13C175
CODE_13C092:
CODE_wide_floor_first_col_exit:
	JMP.w CODE_wide_floor_exit

CODE_13C095:
CODE_wide_floor_interior:
	LDA.b $02
	BNE.b CODE_13C0A0
	LDA.b $28
	AND.w #$0001
	BNE.b CODE_13C0A6
CODE_13C0A0:
	LDA.b $2C
	BNE.b CODE_13C0A6
	INC.b $2E
CODE_13C0A6:
	LDA.b $2C
	INC
	INC
	CMP.b $2E
	BCC.b CODE_13C113
	LDA.b $2E
	SEC
	SBC.b $2C
	BMI.b CODE_wide_floor_exit
	ASL
	STA.b $00
	LDA.b $28
	AND.w #$0001
	EOR.w #$0001
	ASL
	ASL
	ASL
	ORA.b $00
	ORA.b $02
	TAY
	LDX.b $1D
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CMP.w #$0008
	BNE.b CODE_13C0D9
	LDA.w DATA_13C139,y
	BEQ.b CODE_wide_floor_exit
	BRA.b CODE_13C0DC

CODE_13C0D9:
	LDA.w DATA_13C119,y
CODE_13C0DC:
	TAY
	LDA.w $0000,y
	CMP.w $1C1C
	BNE.b CODE_13C0F8
	LDA.b $12
	CMP.w $1C04
	BEQ.b CODE_13C0F8
	CMP.w $1BFA
	BEQ.b CODE_13C101
	CMP.w $1C02
	BEQ.b CODE_13C10A
	BRA.b CODE_wide_floor_exit

CODE_13C0F8:
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	BRA.b CODE_wide_floor_exit

CODE_13C101:
	LDA.w $1C2E
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	BRA.b CODE_wide_floor_exit

CODE_13C10A:
	LDA.w $1C30
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	BRA.b CODE_wide_floor_exit

CODE_13C113:
	JSR.w CODE_13C15F
CODE_13C116:
CODE_wide_floor_exit:
	SEP.b #$30
	RTL

DATA_13C119:
DATA_wide_floor_edge_tiles_normal:                                     ; 16-entry tile-pointer table for CODE_tunnel_ceiling_slope_left's non-template (tileset != $0008) path. Mixes sentinel $1C1C (keep current) with edge tiles $1D60/_66/_78 and templated edges $1CB2/$1CB4.
	dw $1C1C,$1D60,$1CB2,$0000,$1C1C,$1C1C,$1D66,$1CB4
	dw $1C1C,$1C1C,$1D78,$1CB2,$1C1C,$1C1C,$1D78,$1CB4

DATA_13C139:
DATA_wide_floor_edge_tiles_tileset8:                                     ; 16-entry tile-pointer table used by CODE_tunnel_ceiling_slope_left when level header BG1 tileset == $0008. Mixes zero gaps, pointer-to-DATA_13C159/_15B/_15D special tiles, and sentinel $1CB2/$1CB4 edges.
	dw $0000,DATA_13C159,$1CB2,$0000,$0000,$0000,DATA_13C15B,$1CB4
	dw $0000,$0000,DATA_13C15D,$1CB2,$0000,$0000,DATA_13C15D,$1CB4

DATA_13C159:
DATA_wide_floor_tile8_a:                                     ; Single-word pointer-tile $5303 referenced by DATA_13C139 for the tileset-$0008 path of CODE_tunnel_ceiling_slope_left.
	dw $5303

DATA_13C15B:
DATA_wide_floor_tile8_b:                                     ; Single-word pointer-tile $5503 referenced by DATA_13C139 for the tileset-$0008 path of CODE_tunnel_ceiling_slope_left.
	dw $5503

DATA_13C15D:
DATA_wide_floor_tile8_c:                                     ; Single-word pointer-tile $5B05 referenced by DATA_13C139 for the tileset-$0008 path of CODE_tunnel_ceiling_slope_left.
	dw $5B05

CODE_13C15F:
CODE_floor_random_8way_pick:                                     ; Shared PRNG-picker helper used by CODE_tunnel_ceiling_slope_left + CODE_big_floor_stamp. Calls CODE_prng, masks low 3 bits, indexes DATA_floor_random_grass_8way_pool (8-entry pointer table), derefs, stamps into !RAM_YI_Level_LevelDataBuffer.
	JSL.l CODE_prng
	AND.w #$0007
	ASL
	TAY
	LDX.w DATA_floor_random_grass_8way_pool,y
	LDA.w $0000,x
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

CODE_13C175:
CODE_wide_floor_left_neighbour_fix:                                     ; Sub-routine for CODE_tunnel_ceiling_slope_left: when current tile $12's page byte matches template $1BE0, indexes DATA_13C194 by $12 low-byte*2, derefs result-of-result, stamps the resolved tile.
	LDA.b $12
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_WideFloorPage_Anchor
	BNE.b CODE_13C193
	LDA.b $12
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_13C194,y
	TAY
	LDX.b $1D
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13C193:
	RTS

DATA_13C194:
DATA_floor_left_neighbour_remap:                                     ; 46-entry remap table: current-tile sub-ID (within $1BE0 template page) -> destination pointer-tile address. Used by CODE_wide_floor_left_neighbour_fix and CODE_big_floor_left_fix (CODE_13C570).
	dw !RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1BEE,$1BEA,$1C36,$1C3A,$1BEA,$1C38,$1BEE
	dw $1BF0,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1BFE,$1C02,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1BFA,$1C38,$1BFE
	dw $1C3A,$1C02,$1BFA,$1C06,$1C08,$1C0A,$1C0C,$1C0E
	dw $1C10,$1C12,$1C14,$1C16,$1C32,$1BEE,$1C2E,$1C1E
	dw $1C20,$1C22,$1C24,$1C26,$1C28,$1C2A,$1C2C,$1C2E
	dw $1C30,$1C32,$1C34,$1C36,$1C38,$1C3A

CODE_13C1F0:
CODE_wide_floor_above_neighbour_fix:                                     ; Sub-routine called from CODE_tunnel_ceiling_slope_left for the "tile-above matches template $1BE0 page" case. Indexes DATA_13C20F by $12 low-byte*2, dereferences result-of-result, stamps the resolved tile.
	LDA.b $12
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_WideFloorPage_Anchor
	BNE.b CODE_13C20E
	LDA.b $12
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_13C20F,y
	TAY
	LDA.w $0000,y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13C20E:
	RTS

DATA_13C20F:
DATA_floor_above_neighbour_remap:                                     ; 46-entry remap table from "current-tile low byte" to destination pointer-tile address. Used by CODE_wide_floor_above_neighbour_fix and CODE_13C64D (CODE_big_floor_stamp's right-edge probe).
	dw !RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1BE8,$1BEC,$1C34,$1BE8,$1C38,$1BEC,$1C3A
	dw !RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1BF2,$1BFC,$1C00,$1BF8,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1BFC,$1C38
	dw $1C00,$1C3A,$1BF8,$1C06,$1C08,$1C0A,$1C0C,$1C0E
	dw $1C10,$1C12,$1C14,$1C16,$1BF8,$1C00,$1C1C,$1C1E
	dw $1C20,$1C22,$1C24,$1C26,$1C28,$1C2A,$1C2C,$1C2E
	dw $1C30,!RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1C34,$1C36,$1C38,$1C3A

DATA_13C26B:
DATA_three_segment_row_tiles:                                     ; 4-entry tile array for CODE_three_segment_row: $151E (leftmost) / $151F (interior) / $1520 (rightmost) / $0000 (sentinel gap).
	dw $151E,$151F,$1520,$0000

CODE_13C273:
CODE_three_segment_row:                                     ; Object $63-$65 cell stamp: 3-segment horizontal row. Picks from DATA_13C26B ($151E left / $151F middle / $1520 right) based on whether $28 is leftmost, interior, or rightmost ($28+1==$2A), then stamps.
	REP.b #$30
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_13C285
	INY
	INY
	INC
	CMP.b $2A
	BNE.b CODE_13C285
	INY
	INY
CODE_13C285:
	LDA.w DATA_13C26B,y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_13C291:
CODE_2x2_repeating_block:                                     ; Object $66 cell stamp: 2x2 checkerboard / repeating tile pattern. Builds offset (col-parity | row-parity<<1), adds $8900 base, stamps directly. Tile range $8900-$8903 covers the 4 phase variants.
	REP.b #$30
	LDA.b $28
	AND.w #$0001
	STA.b $00
	LDA.b $2C
	AND.w #$0001
	ASL
	ADC.b $00
	CLC
	ADC.w #$8900
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_13C2AF:
CODE_big_floor_stamp:                                     ; Object $67 cell stamp (non-jungle path): big floor body  PRNG base via CODE_floor_random_8way_pick, then up to 8 corner/edge fix-up sub-routines run conditionally (CODE_13C539/_570/_58E/_5C5/_5EC/_613/_64D/_66B).
	REP.b #$30
	JSR.w CODE_13C15F
	LDA.b $28
	BNE.b CODE_big_floor_after_topleft_fix
	LDA.b $2C
	BNE.b CODE_big_floor_after_topleft_fix
	JSR.w CODE_13C539
CODE_13C2BF:
CODE_big_floor_after_topleft_fix:
	LDA.b $28
	BNE.b CODE_big_floor_after_leftedge_fix
	JSR.w CODE_13C570
CODE_13C2C6:
CODE_big_floor_after_leftedge_fix:
	LDA.b $28
	BNE.b CODE_big_floor_after_bottomleft_fix
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_big_floor_after_bottomleft_fix
	JSR.w CODE_13C58E
CODE_13C2D4:
CODE_big_floor_after_bottomleft_fix:
	LDA.b $2C
	BNE.b CODE_big_floor_after_topedge_fix
	JSR.w CODE_13C5C5
CODE_13C2DB:
CODE_big_floor_after_topedge_fix:
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_big_floor_after_bottomedge_fix
	JSR.w CODE_13C5EC
CODE_13C2E5:
CODE_big_floor_after_bottomedge_fix:
	LDA.b $2C
	BNE.b CODE_big_floor_after_topright_fix
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_big_floor_after_topright_fix
	JSR.w CODE_13C613
CODE_13C2F3:
CODE_big_floor_after_topright_fix:
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_big_floor_after_rightedge_fix
	JSR.w CODE_13C64D
CODE_13C2FD:
CODE_big_floor_after_rightedge_fix:
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_big_floor_exit
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_big_floor_exit
	JSR.w CODE_13C66B
CODE_13C30E:
CODE_big_floor_exit:
	SEP.b #$30
	RTL

;-------------------------------------------------------------------------
; BIG-FLOOR REMAP TABLES (8 tables below).
;
; CONTRACT: each table is a 46-entry array of slot ADDRESSES in the
; wide-floor template family ($1BE0+, !RAM_YI_Level_TileTpl_WideFloorPage_*).
; The corresponding handler (CODE_big_floor_*_fix) probes a neighbour cell,
; checks whether the neighbour's PAGE byte matches WideFloorPage_Anchor,
; and -- if so -- uses the neighbour's LOW byte as an index into one of
; these tables. The looked-up entry is a slot ADDRESS; the handler then
; dereferences that slot to get the actual Map16 ID to stamp into the
; level-data buffer.
;
; Mostly each entry N maps back to slot N (identity), with deliberate
; remaps at specific sub-IDs where the corner/edge fix-up needs a
; different visual variant to avoid a seam. Per-slot semantics inside
; the family are positional-by-design (slot N is just "the Nth variant
; in this page"), which is why individual slots in these tables aren't
; named -- the readability is in the table NAME, not the entries.
;-------------------------------------------------------------------------

DATA_13C311:
DATA_big_floor_remap_top_left:                                     ; 46-entry remap table for CODE_13C539 (CODE_big_floor_stamp top-left corner fix-up). Each entry is a sentinel pointer-tile from the $1BE0+ template-tile page block.
	dw !RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1BE2,$1BE4,$1BE6,$1BE8,$1BEA,$1BEC,$1BEE
	dw $1BF0,$1BF2,$1BF4,$1BF6,$1BF8,$1BFA,$1BEC,$1BFE
	dw $1C00,$1C02,$1C04,$1C06,$1C08,$1C0A,$1C0C,$1C0E
	dw $1C10,$1C12,$1C14,$1C16,$1C18,$1C1A,$1C1C,$1C1E
	dw $1C20,$1C22,$1C24,$1C26,$1C28,$1C2A,$1C2C,$1C2E
	dw $1C30,$1C32,$1C34,$1C36,$1C38,$1C3A

DATA_13C36D:
DATA_big_floor_remap_bottom_left:                                     ; 46-entry remap table for CODE_13C58E (CODE_big_floor_stamp bottom-left corner fix-up).
	dw !RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1BE2,$1BE4,$1BE6,$1BE8,$1BEA,$1BEC,$1BEE
	dw $1BF0,$1BF2,$1BF4,$1BF6,$1BF8,$1BFA,$1BFC,$1BFE
	dw $1C00,$1C02,$1C04,$1C06,$1C08,$1C0A,$1C0C,$1C0E
	dw $1C10,$1C12,$1C14,$1C16,$1C18,$1BE2,$1C1C,$1C1E
	dw $1C20,$1C22,$1C24,$1C26,$1C28,$1C2A,$1C2C,$1C2E
	dw $1C30,$1C32,$1C34,$1C36,$1C38,$1C3A

DATA_13C3C9:
DATA_big_floor_remap_top_middle:                                     ; 46-entry remap table for CODE_big_floor_top_middle_fix (CODE_13C5C5), CODE_big_floor_stamp's top-middle edge fix-up path.
	dw $1C3A,$1BE2,$1BE6,$1BE6,$1BE8,$1C36,$1C34,$1BEE
	dw $1BEE,$1BE8,$1BE6,$1BF6,$1C00,$1C02,$1C34,$1C36
	dw $1C00,$1C02,$1BF6,$1C06,$1C08,$1C0A,$1C0C,$1C0E
	dw $1C10,$1C12,$1C14,$1C16,$1C1A,$1C1A,$1C1C,$1C1E
	dw $1C20,$1C22,$1C24,$1C26,$1C28,$1C2A,$1C2C,$1C30
	dw $1C30,$1BEE,$1C34,$1C36,$1C38,$1C3A

DATA_13C425:
DATA_big_floor_remap_bottom_middle:                                     ; 46-entry remap table for CODE_13C5EC (CODE_big_floor_stamp bottom-middle fix-up).
	dw $1C38,$1BE6,$1BE4,$1BE6,$1C34,$1BEA,$1BEC,$1C36
	dw $1BEA,$1BEC,$1BF4,$1BE6,$1BFC,$1BFE,$1BFC,$1BFE
	dw $1C34,$1C36,$1BF4,$1C06,$1C08,$1C0A,$1C0C,$1C0E
	dw $1C10,$1C12,$1C14,$1C16,$1BF4,$1BE6,$1BF4,$1BF4
	dw $1C20,$1C22,$1C24,$1C26,$1C28,$1C2A,$1C2C,$1BFE
	dw $1C36,$1BFE,$1C34,$1C36,$1C38,$1C3A

DATA_13C481:
DATA_big_floor_remap_top_right:                                     ; 46-entry remap table for CODE_13C613 (CODE_big_floor_stamp top-right corner fix-up).
	dw !RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1BE2,$1BE4,$1BE6,$1BE8,$1BEA,$1BEC,$1BEE
	dw $1BF0,$1BF2,$1BE4,$1BF6,$1BF8,$1BFA,$1BFC,$1BEA
	dw $1C00,$1C02,$1C04,$1C06,$1C08,$1C0A,$1C0C,$1C0E
	dw $1C10,$1C12,$1C14,$1C16,$1C18,$1C1A,$1C1C,$1C1E
	dw $1C20,$1C22,$1C24,$1C26,$1C28,$1C2A,$1C2C,$1C2E
	dw $1C30,$1C32,$1C34,$1C36,$1C38,$1C3A

DATA_13C4DD:
DATA_big_floor_remap_bottom_right:                                     ; 46-entry remap table for CODE_13C66B (CODE_big_floor_stamp bottom-right corner fix-up).
	dw !RAM_YI_Level_TileTpl_WideFloorPage_Anchor,$1BE2,$1BE4,$1BE6,$1BE8,$1BEA,$1BEC,$1BEE
	dw $1BF0,$1BF2,$1BF4,$1C1A,$1BF8,$1C32,$1BFC,$1BFE
	dw $1C00,$1BEE,$1C18,$1C06,$1C08,$1C0A,$1C0C,$1C0E
	dw $1C10,$1C12,$1C14,$1C16,$1C18,$1C1A,$1C1C,$1C1E
	dw $1C20,$1C22,$1C24,$1C26,$1C28,$1C2A,$1C2C,$1C2E
	dw $1C30,$1C32,$1C34,$1C36,$1C38,$1C3A

CODE_13C539:
CODE_big_floor_top_left_fix:                                     ; CODE_big_floor_stamp sub-routine for the top-left corner. Probes the tile above via CODE_get_map16_above, and if its page byte matches template $1BE0, remaps the sub-ID via DATA_13C311.
	LDA.b $1B
	TAX
	AND.w #$F0F0
	STA.b $00
	TXA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $00
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	TAY
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_WideFloorPage_Anchor
	BNE.b CODE_13C56F
	TYA
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_13C311,y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13C56F:
	RTS

CODE_13C570:
CODE_big_floor_left_fix:                                     ; CODE_big_floor_stamp sub-routine for the left edge. Probes the tile to the left via CODE_probe_left_tile, and if its page byte matches template $1BE0, remaps via DATA_13C194.
	JSR.w CODE_probe_left_tile
	TAY
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_WideFloorPage_Anchor
	BNE.b CODE_13C58D
	TYA
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_13C194,y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13C58D:
	RTS

CODE_13C58E:
CODE_big_floor_bottom_left_fix:                                     ; CODE_big_floor_stamp sub-routine for the bottom-left corner. Probes the tile below via CODE_get_map16_below, and if its page matches template $1BE0, remaps via DATA_13C36D.
	LDA.b $1B
	TAX
	AND.w #$F0F0
	STA.b $00
	TXA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $00
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	TAY
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_WideFloorPage_Anchor
	BNE.b CODE_13C5C4
	TYA
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_13C36D,y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13C5C4:
	RTS

CODE_13C5C5:
CODE_big_floor_top_middle_fix:                                     ; CODE_big_floor_stamp sub-routine for the top edge / non-corner. Probes the tile above with the original position, and if its page matches template $1BE0, remaps via DATA_13C3C9.
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	TAY
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_WideFloorPage_Anchor
	BNE.b CODE_13C5EB
	TYA
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_13C3C9,y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13C5EB:
	RTS

CODE_13C5EC:
CODE_big_floor_bottom_middle_fix:                                     ; CODE_big_floor_stamp sub-routine for the bottom edge / non-corner. Probes the tile below with the original position, and if its page matches template $1BE0, remaps via DATA_13C425.
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	TAY
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_WideFloorPage_Anchor
	BNE.b CODE_13C612
	TYA
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_13C425,y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13C612:
	RTS

CODE_13C613:
CODE_big_floor_top_right_fix:                                     ; CODE_big_floor_stamp sub-routine for the top-right corner. Probes the tile above + 1 column right, and if its page matches template $1BE0, remaps via DATA_13C481.
	LDA.b $1B
	TAX
	AND.w #$F0F0
	STA.b $00
	TXA
	AND.w #$0F0F
	ORA.w #$00F0
	INC
	AND.w #$0F0F
	ORA.b $00
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	TAY
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_WideFloorPage_Anchor
	BNE.b CODE_13C64C
	TYA
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_13C481,y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13C64C:
	RTS

CODE_13C64D:
CODE_big_floor_right_fix:                                     ; CODE_big_floor_stamp sub-routine for the right edge. Probes the tile to the right via CODE_probe_right_tile, and if its page matches template $1BE0, remaps via DATA_13C20F.
	JSR.w CODE_probe_right_tile
	TAY
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_WideFloorPage_Anchor
	BNE.b CODE_13C66A
	TYA
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_13C20F,y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13C66A:
	RTS

CODE_13C66B:
CODE_big_floor_bottom_right_fix:                                     ; CODE_big_floor_stamp sub-routine for the bottom-right corner. Probes the tile below + 1 column right, and if its page matches template $1BE0, remaps via DATA_13C4DD.
	LDA.b $1B
	TAX
	AND.w #$F0F0
	STA.b $00
	TXA
	AND.w #$0F0F
	ORA.w #$00F0
	INC
	AND.w #$0F0F
	ORA.b $00
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	TAY
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_WideFloorPage_Anchor
	BNE.b CODE_13C6A4
	TYA
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_13C4DD,y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13C6A4:
	RTS

CODE_13C6A5:
CODE_jungle_canopy_random:                                     ; Object $67 cell stamp (jungle path, tileset $0C). PRNG-picks foliage tile $79BB-$79E5 (11 entries) when the 6-bit roll < $0B, otherwise stamps fallback $79E0. Used for World-1 jungle canopy fill.
	REP.b #$30
	JSL.l CODE_prng
	AND.w #$003F
	CMP.w #$000B
	BCC.b CODE_13C6B8
	LDA.w #$79E0
	BRA.b CODE_13C6BC

CODE_13C6B8:
	CLC
	ADC.w #$79BB
CODE_13C6BC:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13C6C5:
DATA_alt_state_ground_tiles:                                     ; 2-entry tile-id table for CODE_stamp_coin: $6000 (orientation A) and $7400 (orientation B). Selected by orientation $15 bit 1.
	dw $6000,$7400

CODE_13C6C9:
CODE_stamp_coin:                                     ; Object $68 and $8A cell stamp: alternate-state ground tile. Calls CODE_item_memory_bit_lookup (level-flag probe)  if zero, stamps DATA_13C6C5[$15&2] = $6000 or $7400. Skips stamping if the flag is set.
	REP.b #$30
	LDX.b $1D
	JSL.l CODE_item_memory_bit_lookup
	BNE.b CODE_alt_state_ground_exit
	LDA.b $15
	AND.w #$0002
	TAY
	LDA.w DATA_13C6C5,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13C6E0:
CODE_alt_state_ground_exit:
	SEP.b #$30
	RTL

CODE_13C6E3:
CODE_3x3_structural:                                     ; Object $69 cell stamp: 3-section structural block (tower / castle wall). Picks 1 of 3 tile tables by ROW position (top / middle / bottom), then indexes by COLUMN position (Y=0/2/4 for left/middle/right) inside the chosen table.
	REP.b #$30
	LDX.b $1D
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_13C6F7
	INY
	INY
	INC
	CMP.b $2A
	BNE.b CODE_13C6F7
	INY
	INY
CODE_13C6F7:
	LDA.b $2C
	BEQ.b CODE_13C702
	INC
	CMP.b $2E
	BNE.b CODE_13C707
	BRA.b CODE_13C70C

CODE_13C702:
	LDA.w DATA_13C716,y
	BRA.b CODE_13C70F

CODE_13C707:
	LDA.w DATA_13C71C,y
	BRA.b CODE_13C70F

CODE_13C70C:
	LDA.w DATA_13C722,y
CODE_13C70F:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13C716:
DATA_3x3_top_row_tiles:                                     ; 3-entry tile array for CODE_3x3_structural TOP-row case, indexed by column (Y=0/2/4 -> left / middle / right): $6100 / $6101 / $6102.
	dw $6100,$6101,$6102

DATA_13C71C:
DATA_3x3_middle_row_tiles:                                     ; 3-entry tile-pointer array for CODE_3x3_structural MIDDLE-row case, indexed by column (Y=0/2/4 -> left / middle / right): $0185 / $0186 / $0187.
	dw $0185,$0186,$0187

DATA_13C722:
DATA_3x3_bottom_row_tiles:                                     ; 3-entry tile array for CODE_3x3_structural BOTTOM-row case, indexed by column (Y=0/2/4 -> left / middle / right): $6103 / $6104 / $6105.
	dw $6103,$6104,$6105

CODE_13C728:
CODE_3wide_platform_bar:                                     ; Object $6A cell stamp: 3-wide horizontal platform bar. Stamps $6400 (left), $6401 (middle), or $6402 (right) based on column position $28 vs extent $2A. Used for small lifts / standing platforms.
	REP.b #$30
	LDX.b $1D
	LDY.w #$6400
	LDA.b $28
	BEQ.b CODE_13C73A
	INY
	INC
	CMP.b $2A
	BNE.b CODE_13C73A
	INY
CODE_13C73A:
	TYA
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_13C742:
CODE_goal_platform:                                     ; Object $6B cell stamp: wide structure with edge-snap. Row 0 probes left  $1C5C/$1C5E templates stamp $1D14. Row 1 probes left vs $1CB6/$1CB8/$1CD2/$1CE6, substitutes $1CFC. Else DATA_13C7A6/_7AC.
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_13C75E
	LDA.b $28
	BNE.b CODE_13C7A3
	JSR.w CODE_probe_left_tile
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_13C759
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BNE.b CODE_13C7A3
CODE_13C759:
	LDA.w $1D14
	BRA.b CODE_13C79D

CODE_13C75E:
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_13C76E
	INY
	INY
	INC
	CMP.b $2A
	BNE.b CODE_13C76E
	INY
	INY
CODE_13C76E:
	LDA.b $2C
	CMP.w #$0001
	BNE.b CODE_13C79A
	LDA.b $28
	BNE.b CODE_13C795
	JSR.w CODE_probe_left_tile
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_Row1LeftLo
	BEQ.b CODE_13C790
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_Row1RightLo
	BEQ.b CODE_13C790
	CMP.w $1CD2
	BEQ.b CODE_13C790
	CMP.w $1CE6
	BNE.b CODE_13C795
CODE_13C790:
	LDA.w $1CFC
	BRA.b CODE_13C79D

CODE_13C795:
	LDA.w DATA_13C7A6,y
	BRA.b CODE_13C79D

CODE_13C79A:
	LDA.w DATA_13C7AC,y
CODE_13C79D:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13C7A3:
	SEP.b #$30
	RTL

DATA_13C7A6:
DATA_goal_platform_top_tiles:                                     ; 3-entry tile-id array for CODE_goal_platform top-row default path: $0188 / $0189 / $018A.
	dw $0188,$0189,$018A

DATA_13C7AC:
DATA_goal_platform_bot_tiles:                                     ; 3-entry tile-id array for CODE_goal_platform bottom-row default path: $018B / $018C / $018D.
	dw $018B,$018C,$018D

CODE_13C7B2:
CODE_gray_cement_block:                                     ; Object $6C cell stamp: single-tile trigger. Stamps constant tile $0184 then JMPs CODE_13A833 to attach a secondary effect [exact downstream side-effect TBD  CODE_13A833 lives in the type-3900 template populator region].
	REP.b #$30
	LDX.b $1D
	LDA.w #$0184
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JMP.w CODE_13A833

CODE_13C7C0:
CODE_stamp_spiky_stake:                                     ; Object $6D cell stamp: 3-section vertical column. Picks one of DATA_13C7E2 ($1DD6 top / $1DD0 middle / $1DD2 bottom) by row position $2C vs extent $2E, dereferences as pointer-to-tile-ID, stamps result.
	REP.b #$30
	LDY.w #$0000
	LDA.b $2C
	BEQ.b CODE_13C7D2
	INY
	INY
	INC
	CMP.b $2E
	BNE.b CODE_13C7D2
	INY
	INY
CODE_13C7D2:
	LDX.b $1D
	LDA.w DATA_13C7E2,y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13C7E2:
DATA_3section_vertical_tiles:                                     ; 3-entry tile-pointer array for CODE_stamp_spiky_stake: $1DD6 (top) / $1DD0 (middle) / $1DD2 (bottom).
	dw $1DD6,$1DD0,$1DD2

CODE_13C7E8:
CODE_random_decoration_8way:                                     ; Object $6E and $8B cell stamp: randomised 8-way decoration. PRNG-picks 1 of 8 tiles from DATA_13C80C ($0199-$01A0). If orientation byte $15 low-byte == $8B (the $8B variant), overrides Y to entry 8 ($7300) instead.
	REP.b #$30
	JSL.l CODE_prng
	AND.w #$0007
	ASL
	TAY
	LDA.b $15
	AND.w #$00FF
	CMP.w #$008B
	BNE.b CODE_13C800
	LDY.w #$0010
CODE_13C800:
	LDX.b $1D
	LDA.w DATA_13C80C,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13C80C:
DATA_random_decoration_tiles:                                     ; 9-entry tile array for CODE_random_decoration_8way: $0199-$01A0 PRNG-picked (8 entries) plus $7300 override for the $8B variant at offset 8.
	dw $0199,$019A,$019B,$019C,$019D,$019E,$019F,$01A0
	dw $7300

CODE_13C81E:
CODE_stamp_twisted_tree_trunk:                                     ; Object $6F cell stamp: spike-pit body / bottom-cap selector. Dispatches via DATA_13C82D  bottom row ($2C+1==$2E) routes to CODE_spike_pit_bottom_cap, other rows route to CODE_spike_pit_body (PRNG body tiles).
	LDX.b #$00
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_13C829
	LDX.b #$02
CODE_13C829:
	JSR.w (DATA_13C82D,x)
	RTL

DATA_13C82D:
DATA_spike_pit_dispatch:                                     ; Object $6F sub-handler table (2 entries): CODE_13C831 (body stamp) and CODE_13C850 (bottom-cap stamp). Indexed by row=bottom-most flag in CODE_stamp_twisted_tree_trunk.
	dw CODE_13C831
	dw CODE_13C850

CODE_13C831:
CODE_spike_pit_body:                                     ; Object $6F sub-stamp: spike-pit body. PRNG-picks 1 of 4 tiles from DATA_13C848 ($3D3B/$3D3C/$3D49/$3D4A) and stamps.
	REP.b #$30
	JSL.l CODE_prng
	AND.w #$0003
	ASL
	TAY
	LDX.b $1D
	LDA.w DATA_13C848,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTS

DATA_13C848:
DATA_spike_pit_body_tiles:                                     ; 4-entry PRNG tile array for CODE_spike_pit_body (object $6F body cells): $3D3B / $3D3C / $3D49 / $3D4A.
	dw $3D3B,$3D3C,$3D49,$3D4A

CODE_13C850:
CODE_spike_pit_bottom_cap:                                     ; Object $6F sub-stamp: bottom-row cap tile. If current tile $12 matches edge-template $1C5C/$1C5E, stamps $3D4B; otherwise falls through into CODE_spike_pit_body PRNG path.
	REP.b #$30
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_13C85E
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BNE.b CODE_13C831
CODE_13C85E:
	LDX.b $1D
	LDA.w #$3D4B
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTS

CODE_13C86A:
CODE_stamp_forest_plants:                                     ; Object $70 cell stamp: 2x2 spike block (variant A). Stores DATA_13C877 pointer in $00 then JSRs CODE_13C8A9 (shared 2x2 column-parity picker) which selects tile $3D37/$3D38 (top row) or $3D45/$3D46 (bottom row).
	REP.b #$30
	LDA.w #DATA_13C877
	STA.b $00
	JSR.w CODE_13C8A9
	SEP.b #$30
	RTL

DATA_13C877:
DATA_2x2_spike_A_tiles:                                     ; 4-entry tile array for CODE_stamp_forest_plants: top-row $3D37/$3D38, bottom-row $3D45/$3D46.
	dw $3D37,$3D38,$3D45,$3D46

CODE_13C87F:
CODE_stamp_forest_flower_above:                                     ; Object $71 cell stamp: 2x2 structural block. Stores DATA_13C88C pointer in $00 then JSRs CODE_13C8A9  picks tile $0141/$0142/$0143/$0144 via column+row parity. Tile range $01xx is the structural-block family.
	REP.b #$30
	LDA.w #DATA_13C88C
	STA.b $00
	JSR.w CODE_13C8A9
	SEP.b #$30
	RTL

DATA_13C88C:
DATA_2x2_structural_tiles:                                     ; 4-entry tile array for CODE_stamp_forest_flower_above: $0141 / $0142 / $0143 / $0144 ($01xx structural-block family).
	dw $0141,$0142,$0143,$0144

CODE_13C894:
CODE_stamp_forest_flower_below:                                     ; Object $72 cell stamp: 2x2 spike block (variant B). Stores DATA_13C8A1 pointer in $00 then JSRs CODE_13C8A9  picks tile $3D39/$3D3A (top row) or $3D47/$3D48 (bottom row) via column-parity formula.
	REP.b #$30
	LDA.w #DATA_13C8A1
	STA.b $00
	JSR.w CODE_13C8A9
	SEP.b #$30
	RTL

DATA_13C8A1:
DATA_2x2_spike_B_tiles:                                     ; 4-entry tile array for CODE_stamp_forest_flower_below: top-row $3D39/$3D3A, bottom-row $3D47/$3D48.
	dw $3D39,$3D3A,$3D47,$3D48

CODE_13C8A9:
CODE_2x2_block_picker:                                     ; Shared 2x2 cell-picker helper used by CODE_stamp_forest_plants/B and CODE_stamp_forest_flower_above. Builds index (col-parity | row-parity<<1)<<1, derefs the 4-entry table at ($00) supplied by caller, stamps result.
	SEP.b #$20
	LDA.b $28
	AND.b #$01
	STA.b $02
	LDA.b $2C
	ASL
	ORA.b $02
	ASL
	REP.b #$20
	AND.w #$00FF
	TAY
	LDX.b $1D
	LDA.b ($00),y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

CODE_13C8C6:
CODE_stamp_twisted_tree_leaves:                                     ; Object $73 cell stamp: 3x2 wide spike block. Builds index from column $28 plus (row-parity)*3 from $2C bit 0, doubles for word lookup, picks from DATA_13C8E3 ($3D42/$3D43/$3D44 top row, $3D50/$3D51/$3D52 bottom row).
	REP.b #$30
	LDY.b $28
	LDA.b $2C
	AND.w #$0001
	BEQ.b CODE_13C8D4
	INY
	INY
	INY
CODE_13C8D4:
	TYA
	ASL
	TAY
	LDX.b $1D
	LDA.w DATA_13C8E3,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13C8E3:
DATA_3x2_spike_tiles:                                     ; 6-entry tile array for CODE_stamp_twisted_tree_leaves: top-row $3D42/$3D43/$3D44, bottom-row $3D50/$3D51/$3D52.
	dw $3D42,$3D43,$3D44,$3D50,$3D51,$3D52

CODE_13C8EF:
CODE_stamp_twisted_tree_leaves_wide:                                     ; Object $74 cell stamp: 3-wide horizontal spike row. Indexes DATA_13C901 by column position $28*2: $3D53 (left), $3D54 (middle), $3D55 (right).
	REP.b #$30
	LDA.b $28
	ASL
	TAY
	LDX.b $1D
	LDA.w DATA_13C901,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13C901:
DATA_3wide_spike_row_tiles:                                     ; 3-entry tile array for CODE_stamp_twisted_tree_leaves_wide (object $74): $3D53 (left) / $3D54 (middle) / $3D55 (right).
	dw $3D53,$3D54,$3D55

CODE_13C907:
CODE_stamp_twisted_tree_leaf_left:                                     ; Object $75 cell stamp: 2-wide spike pair (left variant). Indexes DATA_13C919 by column position $28*2: $3D53 (left tile) or $3D57 (right tile).
	REP.b #$30
	LDA.b $28
	ASL
	TAY
	LDX.b $1D
	LDA.w DATA_13C919,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13C919:
DATA_2wide_spike_pair_left_tiles:                                     ; 2-entry tile array for CODE_stamp_twisted_tree_leaf_left: $3D53 (left) / $3D57 (right).
	dw $3D53,$3D57

CODE_13C91D:
CODE_stamp_twisted_tree_leaf_right:                                     ; Object $76 cell stamp: 2-wide spike pair (right variant). Indexes DATA_13C92F by column position $28*2: $3D56 (left tile) or $3D55 (right tile). Mirror-symmetric counterpart to CODE_stamp_twisted_tree_leaf_left.
	REP.b #$30
	LDA.b $28
	ASL
	TAY
	LDX.b $1D
	LDA.w DATA_13C92F,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13C92F:
DATA_2wide_spike_pair_right_tiles:                                     ; 2-entry tile array for CODE_stamp_twisted_tree_leaf_right: $3D56 (left) / $3D55 (right).
	dw $3D56,$3D55

CODE_13C933:
CODE_stamp_twisted_tree_leaf_center:                                     ; Object $77 cell stamp: single spike. Stamps constant tile $3D58 (single-cell spike) into !RAM_YI_Level_LevelDataBuffer[$1D].
	REP.b #$30
	LDX.b $1D
	LDA.w #$3D58
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_13C941:
CODE_stamp_twisted_tree_slanted:                                     ; Object $78 cell stamp: 4-tile spike quad with rotation. Loads DATA_13C94D ($3D3E/$3D/$3F/$40) into $00/$01 then JSRs CODE_oriented_quad_picker  picks by col-parity, row anchor, and direction sign. Skips in some corners.
	LDA.b #DATA_13C94D
	STA.b $00
	LDA.b #DATA_13C94D>>8
	STA.b $01
	JSR.w CODE_13C969
	RTL

DATA_13C94D:
DATA_twisted_tree_slanted_tiles:                                     ; 4-entry tile array for CODE_stamp_twisted_tree_slanted: $3D3E / $3D3D / $3D3F / $3D40 (rotation-aware spike-quad selection).
	dw $3D3E,$3D3D,$3D3F,$3D40

CODE_13C955:
CODE_red_stairs_stamp:                                     ; Per-cell stamp for object $79 pipe pair: loads DATA_13C961 (4-entry tile table) into $00/$01 and tail-calls CODE_red_stairs_select to pick interior vs left-cap by (row,col).
	LDA.b #DATA_13C961
	STA.b $00
	LDA.b #DATA_13C961>>8
	STA.b $01
	JSR.w CODE_13C969
	RTL

DATA_13C961:
DATA_red_stairs_tiles:                                     ; 4-entry Map16-ID table {$3D5A,$6700,$3D59,$6600} used by CODE_red_stairs_stamp: top-edge-left, body-left, top-edge-right, body-right of the horizontal pipe tube.
	dw $3D5A,$6700,$3D59,$6600

CODE_13C969:
CODE_red_stairs_select:                                     ; Helper used by CODE_red_stairs_stamp: stores col-low-bit into $9B, picks tile from ($00),y where y combines col-position with sign($2A) row component. Suppresses non-edge interior cells.
	REP.b #$30
	LDA.b $2C
	CLC
	ROR
	ROR
	STA.b $9B
	LDA.b $28
	BNE.b CODE_13C988
	STZ.b $9B
	LDA.b $2C
	BNE.b CODE_13C9AA
	LDY.w #$0001
	LDA.b $2A
	BPL.b CODE_13C99F
	LDY.w #$0003
	BRA.b CODE_13C99F

CODE_13C988:
	BPL.b CODE_13C98D
	DEC
	BRA.b CODE_13C98E

CODE_13C98D:
	INC
CODE_13C98E:
	CMP.b $2A
	BNE.b CODE_13C996
	LDA.b $2C
	BNE.b CODE_13C9AA
CODE_13C996:
	LDA.b $2C
	TAY
	LDA.b $2A
	BPL.b CODE_13C99F
	INY
	INY
CODE_13C99F:
	TYA
	ASL
	TAY
	LDA.b ($00),y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13C9AA:
	SEP.b #$30
	RTS

CODE_13C9AD:
CODE_smart_floor_junction_stamp:                                     ; Per-cell stamp for object $7A: indexes a 9-handler dispatch (DATA_13C9ED) from row position (col=0, col=mid, col=end-2) x (row=0, row=mid, row=end) to pick the right floor/wall/corner Map16 template by neighbour probing.
	REP.b #$30
	LDA.b $28
	AND.w #$0001
	ASL
	TAY
	LDA.b $12
	STA.b $00
	LDX.w #$0000
	LDA.b $2C
	BEQ.b CODE_13C9CC
	LDX.w #$0006
	INC
	CMP.b $2E
	BNE.b CODE_13C9CC
	LDX.w #$000C
CODE_13C9CC:
	LDA.b $28
	BEQ.b CODE_13C9DB
	INX
	INX
	INC
	CMP.b $2A
	BNE.b CODE_13C9DB
	INX
	INX
	BRA.b CODE_13C9DB

CODE_13C9DB:
	JSR.w (DATA_13C9ED,x)
	TXA
	BMI.b CODE_13C9EA
	LDA.w $0000,x
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13C9EA:
	SEP.b #$30
	RTL

DATA_13C9ED:
DATA_smart_floor_junction_handlers:                                     ; 9-entry sub-handler pointer table for CODE_smart_floor_junction_stamp: top-left, top-mid, top-right, mid-left, mid-mid, mid-right, bot-left, bot-mid, bot-right of the auto-shaped floor region.
	dw CODE_13C9FF
	dw CODE_13CA2A
	dw CODE_13CA2E
	dw CODE_13CA59
	dw CODE_13CA98
	dw CODE_13CAA0
	dw CODE_13CADF
	dw CODE_13CB0B
	dw CODE_13CB1D

CODE_13C9FF:
CODE_smart_floor_junction_topleft:                                     ; Top-left auto-shape sub-handler: checks current cell against $1D90/$1DAC floor markers to pick $1D9E (corner) or $1DAE (interior) or skips on $1D9C (alt-floor neighbour).
	LDA.b $00
	CMP.w $1D90
	BEQ.b CODE_13CA0B
	CMP.w $1DAC
	BNE.b CODE_13CA10
CODE_13CA0B:
	LDX.w #$1D9E
	BRA.b CODE_13CA29

CODE_13CA10:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w $1D9C
	BNE.b CODE_13CA26
	LDX.w #$FFFF
	BRA.b CODE_13CA29

CODE_13CA26:
	LDX.w #$1DAE
CODE_13CA29:
	RTS

CODE_13CA2A:
CODE_smart_floor_junction_topmid:                                     ; Top-mid auto-shape sub-handler: unconditionally writes $1DAE (interior-top tile).
	LDX.w #$1DAE
	RTS

CODE_13CA2E:
CODE_smart_floor_junction_topright:                                     ; Top-right auto-shape sub-handler: mirror of CODE_smart_floor_junction_topleft  checks $1D8A/$1DAA to pick $1D9C (corner) or $1DAE (interior).
	LDA.b $00
	CMP.w !RAM_YI_Level_TileTpl_Family6800_Anchor
	BEQ.b CODE_13CA3A
	CMP.w $1DAA
	BNE.b CODE_13CA3F
CODE_13CA3A:
	LDX.w #$1D9C
	BRA.b CODE_13CA58

CODE_13CA3F:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w $1D9E
	BNE.b CODE_13CA55
	LDX.w #$FFFF
	BRA.b CODE_13CA58

CODE_13CA55:
	LDX.w #$1DAE
CODE_13CA58:
	RTS

CODE_13CA59:
CODE_smart_floor_junction_midleft:                                     ; Mid-left auto-shape sub-handler: picks from DATA_13CA94 ($1D8A/$1DAA), with neighbour probing into $1D8C/$1D8E/$1D90/$1DAC etc., handling diagonal joins.
	LDX.w DATA_13CA94,y
	LDA.b $00
	CMP.w $1D8C
	BEQ.b CODE_13CA98
	CMP.w $1D8E
	BEQ.b CODE_13CA98
	CMP.w $1D90
	BEQ.b CODE_13CA98
	CMP.w $1DAC
	BEQ.b CODE_13CA98
	CMP.w $1D9C
	BEQ.b CODE_13CA90
	CMP.w $1D9E
	BEQ.b CODE_13CA90
	CMP.w $1DA4
	BEQ.b CODE_13CA90
	CMP.w $1DA2
	BEQ.b CODE_13CA93
	CMP.w $1DAE
	BNE.b CODE_13CA93
	LDX.w #$1D9C
	BRA.b CODE_13CA93

CODE_13CA90:
	LDX.w #$FFFF
CODE_13CA93:
	RTS

DATA_13CA94:
DATA_smart_floor_junction_midleft_tiles:                                     ; 2-entry tile table {$1D8A, $1DAA} for CODE_smart_floor_junction_midleft: row-aware left-side variant pick.
	dw !RAM_YI_Level_TileTpl_Family6800_Anchor,$1DAA

CODE_13CA98:
CODE_smart_floor_junction_midmid:                                     ; Mid-mid auto-shape sub-handler: picks {$1D8C, $1D8E} from DATA_13CA9C  interior floor body tile.
	LDX.w DATA_13CA9C,y
	RTS

DATA_13CA9C:
DATA_smart_floor_junction_midmid_tiles:                                     ; 2-entry tile table {$1D8C, $1D8E} for CODE_smart_floor_junction_midmid: alternating floor-body tile pair.
	dw $1D8C,$1D8E

CODE_13CAA0:
CODE_smart_floor_junction_midright:                                     ; Mid-right auto-shape sub-handler: mirror of midleft. Picks from DATA_13CADB ($1D90/$1DAC) with $1D9E/$1DA8 etc. neighbour probing.
	LDX.w DATA_13CADB,y
	LDA.b $00
	CMP.w !RAM_YI_Level_TileTpl_Family6800_Anchor
	BEQ.b CODE_13CA98
	CMP.w $1D8C
	BEQ.b CODE_13CA98
	CMP.w $1D8E
	BEQ.b CODE_13CA98
	CMP.w $1DAA
	BEQ.b CODE_13CA98
	CMP.w $1D9C
	BEQ.b CODE_13CAD7
	CMP.w $1D9E
	BEQ.b CODE_13CAD7
	CMP.w $1DA6
	BEQ.b CODE_13CAD7
	CMP.w $1DA8
	BEQ.b CODE_13CADA
	CMP.w $1DAE
	BNE.b CODE_13CADA
	LDX.w #$1D9E
	BRA.b CODE_13CADA

CODE_13CAD7:
	LDX.w #$FFFF
CODE_13CADA:
	RTS

DATA_13CADB:
DATA_smart_floor_junction_midright_tiles:                                     ; 2-entry tile table {$1D90, $1DAC} for CODE_smart_floor_junction_midright: row-aware right-side variant pick.
	dw $1D90,$1DAC

CODE_13CADF:
CODE_smart_floor_junction_botleft:                                     ; Bot-left auto-shape sub-handler: prefers $1D92 (bottom-left corner), checks for $1D94/$1D96/$1D98 join, $1D90/$1DAC merge into $1DA6, $1DA2 skip.
	LDX.w #$1D92
	LDA.b $00
	CMP.w $1D94
	BEQ.b CODE_13CB0B
	CMP.w $1D96
	BEQ.b CODE_13CB0B
	CMP.w $1D98
	BEQ.b CODE_13CB0B
	CMP.w $1D90
	BEQ.b CODE_13CB07
	CMP.w $1DAC
	BEQ.b CODE_13CB07
	CMP.w $1DA2
	BNE.b CODE_13CB0A
	LDX.w #$FFFF
	BRA.b CODE_13CB0A

CODE_13CB07:
	LDX.w #$1DA6
CODE_13CB0A:
	RTS

CODE_13CB0B:
CODE_smart_floor_junction_botmid:                                     ; Bot-mid auto-shape sub-handler: picks DATA_13CB19 ($1D94/$1D96), or writes $1DB0 when cell is empty (acts as floor-bottom "shadow" tile).
	LDX.w DATA_13CB19,y
	LDA.b $00
	CMP.w #$0000
	BNE.b CODE_13CB18
	LDX.w #$1DB0
CODE_13CB18:
	RTS

DATA_13CB19:
DATA_smart_floor_junction_botmid_tiles:                                     ; 2-entry tile table {$1D94, $1D96} for CODE_smart_floor_junction_botmid: alternating bottom-edge tile pair.
	dw $1D94,$1D96

CODE_13CB1D:
CODE_smart_floor_junction_botright:                                     ; Bot-right auto-shape sub-handler: mirror of botleft. Prefers $1D98 (bottom-right corner) and handles $1D8A/$1DAA wall-meet and $1DA4/$1DA8 merge cases.
	LDX.w #$1D98
	LDA.b $00
	CMP.w $1D92
	BEQ.b CODE_13CB0B
	CMP.w $1D94
	BEQ.b CODE_13CB0B
	CMP.w $1D96
	BEQ.b CODE_13CB0B
	CMP.w !RAM_YI_Level_TileTpl_Family6800_Anchor
	BEQ.b CODE_13CB45
	CMP.w $1DAA
	BEQ.b CODE_13CB45
	CMP.w $1DA8
	BNE.b CODE_13CB48
	LDX.w #$FFFF
	BRA.b CODE_13CB48

CODE_13CB45:
	LDX.w #$1DA4
CODE_13CB48:
	RTS

CODE_13CB49:
CODE_floor_slope_curve_stamp:                                     ; Per-cell stamp for object $7B curved floor: picks from DATA_13CB98 (descending) or DATA_13CBAA (ascending) based on sign of $2A, then dispatches one of 4 column-position sub-handlers (DATA_13CB90).
	LDA.b #$01
	STA.b $9B
	REP.b #$30
	LDY.w #$FFFF
	LDX.w #DATA_13CB98
	LDA.b $2A
	BMI.b CODE_13CB5F
	LDY.w #$0001
	LDX.w #DATA_13CBAA
CODE_13CB5F:
	STX.b $00
	STY.b $02
	LDX.w #$0000
	LDA.b $2C
	BEQ.b CODE_13CB7B
	INX
	INX
	CMP.w #$0001
	BEQ.b CODE_13CB7B
	INX
	INX
	INC
	CMP.w $002E
	BNE.b CODE_13CB7B
	INX
	INX
CODE_13CB7B:
	JSR.w (DATA_13CB90,x)
	TYA
	BMI.b CODE_13CB8D
	LDA.b ($00),y
	TAY
	LDA.w $0000,y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13CB8D:
	SEP.b #$30
	RTL

DATA_13CB90:
DATA_floor_slope_curve_handlers:                                     ; 4-entry sub-handler pointer table for CODE_floor_slope_curve_stamp: leftcap, body, right-of-body, rightcap.
	dw CODE_13CBBC
	dw CODE_13CBD0
	dw CODE_13CC19
	dw CODE_13CC6A

DATA_13CB98:
DATA_floor_slope_curve_tiles_down:                                     ; 9-entry Map16 tile-id table for descending variant of object $7B curved floor: corner/edge/body tiles in row-major order.
	dw $1D9A,$1D9C,!RAM_YI_Level_TileTpl_Family6800_Anchor,$1DAA,$1D8C,$1D8E,$1D94,$1D96
	dw $1D92

DATA_13CBAA:
DATA_floor_slope_curve_tiles_up:                                     ; 9-entry Map16 tile-id table for ascending variant of object $7B curved floor: corner/edge/body tiles in row-major order.
	dw $1DA0,$1D9E,$1D90,$1DAC,$1D8C,$1D8E,$1D94,$1D96
	dw $1D98

CODE_13CBBC:
CODE_floor_slope_curve_leftcap:                                     ; Leftcap sub-handler for object $7B: defaults to entry 0 (slope-cap), but if existing tile is $1DAE-bg or $1D8A* row marker, switches to $FFFF (skip  preserves underlying floor).
	LDY.w #$0000
	LDA.b $12
	CMP.w $1DAE
	BEQ.b CODE_13CBCF
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_Family6800_Anchor
	BNE.b CODE_13CBCF
	DEY
CODE_13CBCF:
	RTS

CODE_13CBD0:
CODE_floor_slope_curve_body:                                     ; Body-column sub-handler for object $7B: defaults to entry 2 (mid-body), checks against $1C5C/$1C5E (alt-floor markers) and $1D92-$1D98 (ceiling markers) to instead pick entry 16 (transition) or skip.
	LDY.w #$0002
	LDA.b $28
	CLC
	ADC.b $02
	CMP.b $2A
	BNE.b CODE_13CBE6
	LDA.b $12
	CMP.w $1DAE
	BEQ.b CODE_13CC18
	LDY.w #$0006
CODE_13CBE6:
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_13CC15
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BEQ.b CODE_13CC15
	CMP.w $1D92
	BEQ.b CODE_13CC15
	CMP.w $1D98
	BEQ.b CODE_13CC15
	CMP.w $1D8C
	BEQ.b CODE_13CC10
	CMP.w $1D8E
	BEQ.b CODE_13CC10
	CMP.w $1D9C
	BEQ.b CODE_13CC10
	CMP.w $1D9E
	BNE.b CODE_13CC18
CODE_13CC10:
	LDY.w #$FFFF
	BRA.b CODE_13CC18

CODE_13CC15:
	LDY.w #$0010
CODE_13CC18:
	RTS

CODE_13CC19:
CODE_floor_slope_curve_rightbody:                                     ; Right-of-body sub-handler for object $7B: handles right-side body-tile pick using $28 col-parity, with bottom-edge $1DAE/$1D8A/$1DAA wall-join logic falling back to entry 2 or skipping.
	LDA.b $28
	AND.w #$0001
	ASL
	ADC.w #$0008
	TAY
	LDA.b $28
	CLC
	ADC.b $02
	CMP.b $2A
	BNE.b CODE_13CC69
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_Family6800_Anchor
	BEQ.b CODE_13CC69
	CMP.w $1DAA
	BEQ.b CODE_13CC69
	CMP.w $1D90
	BEQ.b CODE_13CC69
	CMP.w $1DAC
	BEQ.b CODE_13CC69
	CMP.w $1D8C
	BEQ.b CODE_13CC69
	CMP.w $1D8E
	BEQ.b CODE_13CC69
	CMP.w $1D9C
	BEQ.b CODE_13CC60
	CMP.w $1D9E
	BEQ.b CODE_13CC60
	CMP.w $1DAE
	BNE.b CODE_13CC65
	LDY.w #$0002
	BRA.b CODE_13CC69

CODE_13CC60:
	LDY.w #$FFFF
	BRA.b CODE_13CC69

CODE_13CC65:
	DEY
	DEY
	DEY
	DEY
CODE_13CC69:
	RTS

CODE_13CC6A:
CODE_floor_slope_curve_rightcap:                                     ; Rightcap sub-handler for object $7B: handles right-edge cap tile by col-parity, with ceiling-context ($1C5C/$1C5E/$1D92-$1D98) and floor-context ($1D8A) tweaks.
	LDA.b $28
	AND.w #$0001
	ASL
	ADC.w #$000C
	TAY
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_13CC98
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BEQ.b CODE_13CC98
	CMP.w $1D92
	BEQ.b CODE_13CC98
	CMP.w $1D94
	BEQ.b CODE_13CC98
	CMP.w $1D96
	BEQ.b CODE_13CC98
	CMP.w $1D98
	BEQ.b CODE_13CC98
	DEY
	DEY
	DEY
	DEY
CODE_13CC98:
	LDA.b $28
	CLC
	ADC.b $02
	CMP.b $2A
	BNE.b CODE_13CCBD
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_13CCBA
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BEQ.b CODE_13CCBA
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_Family6800_Anchor
	BEQ.b CODE_13CCBD
	LDY.w #$0006
	BRA.b CODE_13CCBD

CODE_13CCBA:
	LDY.w #$0010
CODE_13CCBD:
	RTS

CODE_13CCBE:
CODE_slope_decoration_dual_stamp:                                     ; Per-cell stamp for object $7C: picks DATA_13CD22 (pos-$2A) or DATA_13CD2A (neg-$2A), indexes by (col,row) with right-edge skip and end-of-row probe of $1D92/$1D98/$1D8A ceiling markers.
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_13CCCA
	LDA.b $28
	BEQ.b CODE_13CCCA
	DEC.b $2E
CODE_13CCCA:
	LDA.w #DATA_13CD22
	LDX.b $2A
	BMI.b CODE_13CCD4
	LDA.w #DATA_13CD2A
CODE_13CCD4:
	STA.b $00
	LDA.b $2C
	INC
	CMP.b $2E
	BEQ.b CODE_13CCE7
	INC
	CMP.b $2E
	BNE.b CODE_13CD00
	LDY.w #$0002
	BRA.b CODE_13CD13

CODE_13CCE7:
	LDA.b $12
	CMP.w $1D92
	BEQ.b CODE_13CCFB
	CMP.w $1D98
	BEQ.b CODE_13CCFB
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_Family6800_Anchor
	BEQ.b CODE_13CD1F
CODE_13CCFB:
	LDY.w #$0000
	BRA.b CODE_13CD13

CODE_13CD00:
	LDA.b $2C
	AND.w #$0001
	INC
	INC
	ASL
	STA.b $02
	LDA.b $28
	AND.w #$0001
	ASL
	EOR.b $02
	TAY
CODE_13CD13:
	LDA.b ($00),y
	TAX
	LDA.w $0000,x
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13CD1F:
	SEP.b #$30
	RTL

DATA_13CD22:
DATA_slope_decoration_dual_tiles_a:                                     ; 4-entry tile-id table {$1DA2,$1DA4,$1D8C,$1D8E} for CODE_slope_decoration_dual_stamp positive variant: slope-end corner pair + interior-body pair.
	dw $1DA2,$1DA4,$1D8C,$1D8E

DATA_13CD2A:
DATA_slope_decoration_dual_tiles_b:                                     ; 4-entry tile-id table {$1DA8,$1DA6,$1D8C,$1D8E} for CODE_slope_decoration_dual_stamp negative variant: mirror of DATA_slope_decoration_dual_tiles_a.
	dw $1DA8,$1DA6,$1D8C,$1D8E

CODE_13CD32:
CODE_overhang_2row_stamp:                                     ; Per-cell stamp for object $7D overhang: loads DATA_13CD97 (standard) or DATA_13CDB7 (floor-context $1D8C/$1D8E variant), then indexes by col-parity x row x neighbour-floor flag into a 24-entry layout.
	REP.b #$30
	LDA.w #DATA_13CD97
	STA.b $00
	LDA.b $12
	CMP.w $1D8C
	BEQ.b CODE_13CD45
	CMP.w $1D8E
	BNE.b CODE_13CD4A
CODE_13CD45:
	LDA.w #DATA_13CDB7
	STA.b $00
CODE_13CD4A:
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_13CD64
	AND.w #$0001
	EOR.w #$0001
	INC
	ASL
	TAY
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_13CD64
	LDY.w #$0006
CODE_13CD64:
	LDA.b $2C
	BEQ.b CODE_13CD6D
	TYA
	ORA.w #$0008
	TAY
CODE_13CD6D:
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_Family6800_Anchor
	BEQ.b CODE_13CD83
	CMP.w $1DAA
	BEQ.b CODE_13CD83
	CMP.w $1D90
	BEQ.b CODE_13CD83
	CMP.w $1DAC
	BNE.b CODE_13CD88
CODE_13CD83:
	TYA
	ORA.w #$0010
	TAY
CODE_13CD88:
	LDA.b ($00),y
	TAY
	LDX.b $1D
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13CD97:
DATA_overhang_2row_tiles_std:                                     ; 16-entry tile-id table for CODE_overhang_2row_stamp standard variant: paired with row + col-parity + bottom-floor-flag indexing covering the 16 sub-cases.
	dw $1DB2,$1DB4,$1DB6,$1DB8,$1C80,$1C84,$1C86,$1C8A
	dw $1DBA,$1DBA,$1DBC,$1DBC,$1C82,$1C84,$1C86,$1C88

DATA_13CDB7:
DATA_overhang_2row_tiles_alt:                                     ; 16-entry tile-id table for CODE_overhang_2row_stamp alt variant (used when neighbour is $1D8C/$1D8E floor-body): same layout as DATA_overhang_2row_tiles_std, different cap tiles.
	dw $1DBE,$1DC0,$1DC2,$1DC4,$1C80,$1C84,$1C86,$1C8A
	dw $1DBA,$1DBA,$1DBC,$1DBC,$1C82,$1C84,$1C86,$1C88

CODE_13CDD7:
CODE_decoration_min2x2_stamp:                                     ; Per-cell stamp for object $7F: short-circuits on cell $12=0; if neighbour is $1BE0 calls CODE_decoration_min2x2_widefloor_helper helper; on $1D8A-row indexes 1 of 9 sub-tables in DATA_13CE34 by (col,row) for context tile.
	REP.b #$30
	LDA.b $12
	CMP.w #$0000
	BEQ.b CODE_decoration_min2x2_exit
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_WideFloorPage_Anchor
	BNE.b CODE_decoration_min2x2_grid_select
	JSR.w CODE_decoration_min2x2_widefloor_helper
	BRA.b CODE_decoration_min2x2_exit

CODE_13CDED:
CODE_decoration_min2x2_grid_select:
	CMP.w !RAM_YI_Level_TileTpl_Family6800_Anchor
	BNE.b CODE_decoration_min2x2_exit
	LDA.b $12
	AND.w #$00FF
	ASL
	TAY
	LDX.w #$0000
	LDA.b $2C
	BEQ.b CODE_13CE09
	INX
	INX
	INC
	CMP.b $2E
	BNE.b CODE_13CE09
	INX
	INX
CODE_13CE09:
	LDA.b $28
	BEQ.b CODE_13CE1E
	INX
	INX
	INX
	INX
	INX
	INX
	INC
	CMP.b $2A
	BNE.b CODE_13CE1E
	INX
	INX
	INX
	INX
	INX
	INX
CODE_13CE1E:
	LDA.w DATA_13CE34,x
	STA.b $00
	LDA.b ($00),y
	TAY
	LDA.w $0000,y
	BMI.b CODE_decoration_min2x2_exit
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13CE31:
CODE_decoration_min2x2_exit:
	SEP.b #$30
	RTL

DATA_13CE34:
DATA_decoration_min2x2_handler_ptrs:                                     ; 9-entry table of pointers to per-row tile-id sub-tables (DATA_13CE46..DATA_13CF86) used by CODE_decoration_min2x2_stamp.
	dw DATA_13CE46,DATA_13CE6E,DATA_13CE96,DATA_13CEBE,DATA_13CEE6,DATA_13CF0E,DATA_13CF36,DATA_13CF5E
	dw DATA_13CF86

DATA_13CE46:
DATA_decoration_min2x2_row0:                                     ; 20-entry tile-id sub-table (top row) for CODE_decoration_min2x2_stamp: mostly $1DA2/$1DA6/$1DAC/$1DB0 floor-edge markers + pointer escapes to DATA_13CFAE alt-tile-table.
	dw $1DA2,$1DA6,$1DA6,$1D90,DATA_13CFAE,DATA_13CFAE,DATA_13CFAE,DATA_13CFAE
	dw DATA_13CFAE,DATA_13CFAE,$1DAC,DATA_13CFAE,DATA_13CFAE,$1DB0,$1DA6,DATA_13CFAE
	dw $1DA2,$1DAC,$1DA0,$1DB0

DATA_13CE6E:
DATA_decoration_min2x2_row1:                                     ; 20-entry tile-id sub-table (second row) for CODE_decoration_min2x2_stamp: includes $1C5C/$1C5E alt-floor markers + ceiling-tile literals.
	dw DATA_13CFB0,$1D90,$1DAC,$1D90,!RAM_YI_Level_TileTpl_FloorRow0_LeftLo,$1D98,$1D98,!RAM_YI_Level_TileTpl_FloorRow0_RightLo
	dw DATA_13CFB0,$1DA0,$1DAC,DATA_13CFB0,DATA_13CFB0,$1DA8,$1D90,DATA_13CFAE
	dw DATA_13CFB0,$1DAC,$1DA0,$1DA8

DATA_13CE96:
DATA_decoration_min2x2_row2:                                     ; 20-entry tile-id sub-table (third row) for CODE_decoration_min2x2_stamp: corner + body tile mix.
	dw $1D9A,$1D9E,$1D9E,$1D90,!RAM_YI_Level_TileTpl_FloorRow0_LeftLo,$1D98,$1D98,!RAM_YI_Level_TileTpl_FloorRow0_RightLo
	dw $1D9E,$1DAE,$1D9E,$1D9E,DATA_13CFB0,DATA_13CFB0,$1DAC,DATA_13CFAE
	dw $1D9A,$1DAC,DATA_13CFAE,$1DA8

DATA_13CEBE:
DATA_decoration_min2x2_row3:                                     ; 20-entry tile-id sub-table (fourth row) for CODE_decoration_min2x2_stamp: corner + body tile mix with $1DA2/$1DB0/$1DA8 edge-marker mix.
	dw $1DA2,$1DB0,$1DB0,$1DA8,DATA_13CFAE,DATA_13CFAE,DATA_13CFAE,DATA_13CFAE
	dw DATA_13CFB0,$1DA2,$1DA8,DATA_13CFB0,DATA_13CFAE,$1DB0,$1DB0,DATA_13CFAE
	dw $1DA2,$1DA8,DATA_13CFB0,$1DB0

DATA_13CEE6:
DATA_decoration_min2x2_row4:                                     ; 20-entry tile-id sub-table (fifth row) for CODE_decoration_min2x2_stamp: heavily uses DATA_13CFB0/DATA_13CFAE alt-tile escapes for middle of decoration.
	dw DATA_13CFB0,DATA_13CFB0,DATA_13CFB0,DATA_13CFB0,!RAM_YI_Level_TileTpl_FloorRow0_LeftLo,!RAM_YI_Level_TileTpl_FloorRow0_RightLo,!RAM_YI_Level_TileTpl_FloorRow0_LeftLo,!RAM_YI_Level_TileTpl_FloorRow0_RightLo
	dw DATA_13CFB0,DATA_13CFB0,DATA_13CFB0,DATA_13CFB0,DATA_13CFB0,DATA_13CFB0,DATA_13CFB0,DATA_13CFB0
	dw DATA_13CFB0,DATA_13CFB0,DATA_13CFB0,DATA_13CFB0

DATA_13CF0E:
	dw $1D9A,$1DAE,$1DAE,$1DA0,!RAM_YI_Level_TileTpl_FloorRow0_LeftLo,!RAM_YI_Level_TileTpl_FloorRow0_RightLo,!RAM_YI_Level_TileTpl_FloorRow0_LeftLo,!RAM_YI_Level_TileTpl_FloorRow0_RightLo
	dw DATA_13CFB0,$1DAE,$1DAE,DATA_13CFB0,DATA_13CFB0,$1D9A,$1DA0,DATA_13CFB0
	dw $1D9A,$1DA0,$1DAE,DATA_13CFB0

DATA_13CF36:
	dw !RAM_YI_Level_TileTpl_Family6800_Anchor,$1DA4,$1DA4,$1DA6,DATA_13CFAE,DATA_13CFAE,DATA_13CFAE,DATA_13CFAE
	dw DATA_13CFAE,!RAM_YI_Level_TileTpl_Family6800_Anchor,DATA_13CFB0,DATA_13CFB0,DATA_13CFAE,$1DA4,$1DB0,DATA_13CFAE
	dw $1DAA,$1DA6,$1D9A,$1DB0

DATA_13CF5E:
	dw !RAM_YI_Level_TileTpl_Family6800_Anchor,!RAM_YI_Level_TileTpl_Family6800_Anchor,$1DAA,DATA_13CFB0,!RAM_YI_Level_TileTpl_FloorRow0_LeftLo,$1D92,$1D92,!RAM_YI_Level_TileTpl_FloorRow0_RightLo
	dw DATA_13CFB0,$1DAA,$1D9A,DATA_13CFB0,DATA_13CFAE,!RAM_YI_Level_TileTpl_Family6800_Anchor,$1DA2,DATA_13CFB0
	dw $1DAA,DATA_13CFB0,$1D9A,$1DA2

DATA_13CF86:
	dw !RAM_YI_Level_TileTpl_Family6800_Anchor,$1D9C,$1D9C,$1DA0,!RAM_YI_Level_TileTpl_FloorRow0_LeftLo,$1D92,$1D92,!RAM_YI_Level_TileTpl_FloorRow0_RightLo
	dw DATA_13CFAE,$1D9C,$1DAE,DATA_13CFAE,$1DA2,$1DAA,DATA_13CFAE,DATA_13CFB0
	dw $1DAA,$1DAC,$1DAE,DATA_13CFAE

DATA_13CFAE:
	dw $FFFF

DATA_13CFB0:
	dw $0000

DATA_13CFB2:
	dw $1DA6,$1DB0,$1DA4,$1DAC,DATA_13CFB0,$1DAA,$1D9E,$1DAE
	dw $1D9C

DATA_13CFC4:
	dw $1DA2,$1DB0,$1DA8,DATA_13CFB0,DATA_13CFB0,DATA_13CFB0,$1D9A,$1DAE
	dw $1DA0

CODE_13CFD6:
CODE_decoration_min2x2_widefloor_helper:
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_13CFE6
	INY
	INY
	INC
	CMP.b $2A
	BNE.b CODE_13CFE6
	INY
	INY
CODE_13CFE6:
	LDX.b $2C
	BEQ.b CODE_13CFFB
	TYA
	CLC
	ADC.w #$0006
	TAY
	INX
	CPX.b $2E
	BNE.b CODE_13CFFB
	TYA
	CLC
	ADC.w #$0006
	TAY
CODE_13CFFB:
	LDA.b $12
	CMP.w $1C0C
	BEQ.b CODE_13D007
	CMP.w $1C0E
	BNE.b CODE_13D00C
CODE_13D007:
	LDA.w DATA_13CFC4,y
	BRA.b CODE_13D00F

CODE_13D00C:
	LDA.w DATA_13CFB2,y
CODE_13D00F:
	TAY
	LDA.w $0000,y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

CODE_13D01A:
CODE_slope_fill_signed_stamp:                                     ; Per-cell stamp for object $80: dispatches to 1 of 3 sub-handlers in DATA_13D048 by column position (col=0, col=mid, col=end). Each picks slope-corner/edge tiles by sign of $2A.
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_13D026
	LDA.b $28
	BEQ.b CODE_13D026
	DEC.b $2E
CODE_13D026:
	LDX.w #$0000
	LDA.b $2C
	INC
	CMP.b $2E
	BEQ.b CODE_13D039
	INX
	INX
	INC
	CMP.b $2E
	BEQ.b CODE_13D039
	INX
	INX
CODE_13D039:
	JSR.w (DATA_13D048,x)
	TYA
	BMI.b CODE_13D045
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13D045:
	SEP.b #$30
	RTL

DATA_13D048:
DATA_slope_fill_signed_handlers:                                     ; 3-entry sub-handler pointer table for CODE_slope_fill_signed_stamp: leftcap, body, rightcap.
	dw CODE_13D04E
	dw CODE_13D066
	dw CODE_13D071

CODE_13D04E:
CODE_slope_fill_signed_leftcap:                                     ; Leftcap sub-handler for object $80: picks $1DA8 (positive-$2A) or $1DA2 (negative-$2A) corner tile, suppresses write when on $1D8A-row context.
	LDY.w $1DA8
	LDA.b $2A
	BPL.b CODE_13D058
	LDY.w $1DA2
CODE_13D058:
	LDA.b $12
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_Family6800_Anchor
	BNE.b CODE_13D065
	LDY.w #$FFFF
CODE_13D065:
	RTS

CODE_13D066:
CODE_slope_fill_signed_body:                                     ; Body sub-handler for object $80: picks $1DA6 (positive slope) or $1DA4 (negative slope) body tile by sign of $2A  unconditional write of slope-interior tile.
	LDY.w $1DA6
	LDA.b $2A
	BPL.b CODE_13D070
	LDY.w $1DA4
CODE_13D070:
	RTS

CODE_13D071:
CODE_slope_fill_alt_rightcap:                                     ; Rightcap sub-handler reused by both object $80 and object $81 stamps: returns col-parity-indexed tile from DATA_13D094 ($1D8C/$1D8E) when not blocked by $1D8A-row context.
	LDA.b $12
	CMP.w #$0000
	BEQ.b CODE_13D085
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_Family6800_Anchor
	BEQ.b CODE_13D085
	LDY.w #$FFFF
	BRA.b CODE_13D093

CODE_13D085:
	LDA.b $28
	AND.w #$0001
	ASL
	TAY
	LDX.w DATA_13D094,y
	LDA.w $0000,x
	TAY
CODE_13D093:
	RTS

DATA_13D094:
DATA_slope_fill_alt_rightcap_tiles:                                     ; 2-entry tile-id table {$1D8C, $1D8E} for CODE_slope_fill_alt_rightcap col-parity pick.
	dw $1D8C,$1D8E

CODE_13D098:
CODE_wide_slope_signed_stamp:                                     ; Per-cell stamp for object $81 wide slope: 3 sub-handlers in DATA_13D0BD by col-position (col=0 / col=1 / col>=2  last reuses CODE_slope_fill_alt_rightcap from object $80).
	LDA.b #$01
	STA.b $9B
	REP.b #$30
	LDX.w #$0000
	LDA.b $2C
	BEQ.b CODE_13D0AE
	INX
	INX
	CMP.w #$0001
	BEQ.b CODE_13D0AE
	INX
	INX
CODE_13D0AE:
	JSR.w (DATA_13D0BD,x)
	TYA
	BMI.b CODE_13D0BA
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13D0BA:
	SEP.b #$30
	RTL

DATA_13D0BD:
DATA_wide_slope_signed_handlers:                                     ; 3-entry sub-handler pointer table for CODE_wide_slope_signed_stamp: leftcap (CODE_wide_slope_signed_leftcap), mid (CODE_wide_slope_signed_mid), rightcap (shared CODE_slope_fill_alt_rightcap).
	dw CODE_13D0C3
	dw CODE_13D0DB
	dw CODE_13D071

CODE_13D0C3:
CODE_wide_slope_signed_leftcap:                                     ; Leftcap sub-handler for object $81: picks $1DA0 (positive-$2A) or $1D9A (negative-$2A) corner tile, suppresses write on $1D8A-row neighbour.
	LDY.w $1DA0
	LDA.b $2A
	BPL.b CODE_13D0CD
	LDY.w $1D9A
CODE_13D0CD:
	LDA.b $12
	AND.w #$FF00
	CMP.w !RAM_YI_Level_TileTpl_Family6800_Anchor
	BNE.b CODE_13D0DA
	LDY.w #$FFFF
CODE_13D0DA:
	RTS

CODE_13D0DB:
CODE_wide_slope_signed_mid:                                     ; Mid sub-handler for object $81: picks $1D9E or $1D9C body tile by sign of $2A (no neighbour suppression).
	LDY.w $1D9E
	LDA.b $2A
	BPL.b CODE_13D0E5
	LDY.w $1D9C
CODE_13D0E5:
	RTS

CODE_13D0E6:
CODE_special_coin_stamp:                                     ; Per-cell stamp for object $82/$83: calls CODE_item_memory_bit_lookup to test cell-empty, on (level-bit-0 set AND col-odd) skips, else writes $A400 red-coin tile only into unclaimed cells. Non-destructive overlay (item-memory tracked).
	REP.b #$30
	LDX.b $1D
	JSL.l CODE_item_memory_bit_lookup
	BNE.b CODE_13D107
	LDA.b $15
	AND.w #$0001
	BEQ.b CODE_13D0FE
	LDA.b $28
	AND.w #$0001
	BNE.b CODE_13D107
CODE_13D0FE:
	LDX.b $1D
	LDA.w #$A400
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13D107:
	SEP.b #$30
	RTL

CODE_13D10A:
CODE_special_coin_stamp_keepslope:                                     ; Per-cell stamp for object $84: like CODE_special_coin_stamp but sets $9B=$FFFF (slope-suppression bypass) and only stamps when col is even, writing $A400 into empty cells.
	REP.b #$30
	LDX.b $1D
	JSL.l CODE_item_memory_bit_lookup
	BNE.b CODE_13D129
	LDA.w #$FFFF
	STA.b $9B
	LDA.b $28
	AND.w #$0001
	BNE.b CODE_13D129
	LDX.b $1D
	LDA.w #$A400
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13D129:
	SEP.b #$30
	RTL

DATA_13D12C:
DATA_tunnel_ceiling_slope_right_steep_tiles:                                     ; 2-entry tile-id table {$1DF6, $1DF2} used by CODE_tunnel_ceiling_slope_right_steep_stamp: pair of ceiling-row tiles selected by length-row arithmetic.
	dw $1DF6,$1DF2

CODE_13D130:
CODE_tunnel_ceiling_slope_right_steep_stamp:                                     ; Per-cell stamp for object $85: clamps $2E size, calls CODE_13C570 (left cap), computes $2E-$2C delta, calls CODE_13C15F (mid) and CODE_13C64D (right cap). Col=0 special-cases via DATA_13D12C and below-probe helpers.
	REP.b #$30
	LDA.b $28
	BEQ.b CODE_13D147
	LDA.b $2C
	BNE.b CODE_13D147
	DEC.b $2E
	DEC.b $2E
	BEQ.b CODE_13D142
	BPL.b CODE_13D147
CODE_13D142:
	LDA.w #$0001
	STA.b $2E
CODE_13D147:
	LDA.b $28
	BNE.b CODE_ceiling_endcap_after_left_cap
	JSR.w CODE_13C570
CODE_13D14E:
CODE_ceiling_endcap_after_left_cap:
	LDA.b $2E
	CLC
	SBC.b $2C
	BEQ.b CODE_ceiling_endcap_short_special
	CMP.w #$0001
	BEQ.b CODE_ceiling_endcap_short_special
	JSR.w CODE_13C15F
	LDA.b $28
	INC
	CMP.l $00002A
	BNE.b CODE_ceiling_endcap_exit
	JSR.w CODE_13C64D
	BRA.b CODE_ceiling_endcap_exit

CODE_13D16B:
CODE_ceiling_endcap_short_special:
	ASL
	TAY
	LDX.w DATA_13D12C,y
	LDA.w $0000,x
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	TYA
	BNE.b CODE_ceiling_endcap_after_short
	LDA.b $1B
	JSR.w CODE_13D22F
	LDA.b $1B
	TAX
	AND.w #$F0F0
	STA.b $0E
	TXA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $0E
	JSR.w CODE_13D218
	BRA.b CODE_ceiling_endcap_exit

CODE_13D198:
CODE_ceiling_endcap_after_short:
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_ceiling_endcap_exit
	JSR.w CODE_probe_right_tile
	LDA.w $1D2E
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13D1A9:
CODE_ceiling_endcap_exit:
	SEP.b #$30
	RTL

DATA_13D1AC:
DATA_tunnel_ceiling_slope_left_steep_tiles:                                     ; 2-entry tile-id table {$1DEE, $1DEA} used by CODE_tunnel_ceiling_slope_left_steep_stamp for column-edge tile pick on the body row of the vertical wall.
	dw $1DEE,$1DEA

CODE_13D1B0:
CODE_tunnel_ceiling_slope_left_steep_stamp:                                     ; Per-cell stamp for object $86 vertical wall: bumps $2E by 2 on (col=0,$28!=0), calls CODE_13C64D right-cap and CODE_13C15F mid helpers, draws DATA_tunnel_ceiling_slope_left_steep_tiles, runs CODE_13D218/22F below-probes.
	REP.b #$30
	LDA.b $28
	BEQ.b CODE_13D1BE
	LDA.b $2C
	BNE.b CODE_13D1BE
	INC.b $2E
	INC.b $2E
CODE_13D1BE:
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_tunnel_ceiling_slope_left_steep_body_row
	JSR.w CODE_13C64D
CODE_13D1C8:
CODE_tunnel_ceiling_slope_left_steep_body_row:
	LDA.b $2E
	CLC
	SBC.b $2C
	BEQ.b CODE_tunnel_ceiling_slope_left_steep_cap_stamp
	CMP.w #$0001
	BEQ.b CODE_tunnel_ceiling_slope_left_steep_cap_stamp
	JSR.w CODE_13C15F
	LDA.b $28
	BNE.b CODE_tunnel_ceiling_slope_left_steep_epilogue
	JSR.w CODE_13C570
	BRA.b CODE_tunnel_ceiling_slope_left_steep_epilogue

CODE_13D1E0:
CODE_tunnel_ceiling_slope_left_steep_cap_stamp:
	ASL
	TAY
	LDX.w DATA_13D1AC,y
	LDA.w $0000,x
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	TYA
	BNE.b CODE_tunnel_ceiling_slope_left_steep_epilogue
	LDA.b $1B
	JSR.w CODE_13D218
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_tunnel_ceiling_slope_left_steep_epilogue
	LDA.b $1B
	TAX
	AND.w #$0F0F
	ORA.w #$00F0
	INC
	AND.w #$0F0F
	STA.b $0E
	TXA
	AND.w #$F0F0
	ORA.b $0E
	JSR.w CODE_13D22F
CODE_13D215:
CODE_tunnel_ceiling_slope_left_steep_epilogue:
	SEP.b #$30
	RTL

CODE_13D218:
CODE_ceiling_endcap_match_below:                                     ; Shared helper: probes Map16 cell below ($1B->JSL get_map16_below), if result matches $1C04 rewrites it as $1D2C (extends ceiling downward by one tile).
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w $1C04
	BNE.b CODE_13D22E
	LDA.w $1D2C
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13D22E:
	RTS

CODE_13D22F:
CODE_ceiling_endcap_match_below_alt:                                     ; Shared helper variant of CODE_ceiling_endcap_match_below: same probe-below pattern, rewrites $1C04 match as $1D2E instead of $1D2C.
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w $1C04
	BNE.b CODE_13D245
	LDA.w $1D2E
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13D245:
	RTS

DATA_13D246:
DATA_floor_no_deco_top_random_tiles:                                     ; 8-entry tile-id table {$0146,$0147,$0148,$0149,$014E,$014F,$014E,$014F} used by CODE_stamp_floor_no_deco_top via prng + level-bit-3 mix: random floor-tile pick.
	dw $0146,$0147,$0148,$0149,$014E,$014F,$014E,$014F

DATA_13D256:
DATA_floor_no_deco_top_cap_tiles:                                     ; 4-entry tile-id table {$1D14, $1D12, $0145, $0150} used by CODE_stamp_floor_no_deco_top: row-context corner/cap tiles for floor-row ends.
	dw $1D14,$1D12,$0145,$0150

CODE_13D25E:
CODE_stamp_floor_no_deco_top:                                     ; Per-cell stamp for object $87/$88: at col=0 or col=end checks $1C5C/$1C5E/$1CB6/$1CB8 context, picks from DATA_floor_no_deco_top_cap_tiles; body cells use prng + level-bit-3 indexed DATA_floor_no_deco_top_random_tiles.
	REP.b #$30
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_13D26E
	INY
	INY
	INC
	CMP.b $2A
	BNE.b CODE_13D29B
CODE_13D26E:
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_13D284
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BEQ.b CODE_13D284
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_Row1LeftLo
	BEQ.b CODE_13D284
	CMP.w !RAM_YI_Level_TileTpl_FlatFloor_Row1RightLo
	BNE.b CODE_13D29B
CODE_13D284:
	LDA.b $2C
	BEQ.b CODE_13D28D
	TYA
	ORA.w #$0004
	TAY
CODE_13D28D:
	LDA.w DATA_13D256,y
	CPY.w #$0004
	BCS.b CODE_13D2C5
	TAY
	LDA.w $0000,y
	BRA.b CODE_13D2C5

CODE_13D29B:
	LDA.b $2C
	BNE.b CODE_13D2B0
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_13D2AB
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BNE.b CODE_13D2CB
CODE_13D2AB:
	LDA.w #$0000
	BRA.b CODE_13D2C5

CODE_13D2B0:
	JSL.l CODE_prng
	AND.w #$0003
	ASL
	STA.b $00
	LDA.b $15
	AND.w #$0008
	ORA.b $00
	TAY
	LDA.w DATA_13D246,y
CODE_13D2C5:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13D2CB:
	SEP.b #$30
	RTL

DATA_13D2CE:
DATA_small_lift_handler_ptrs:                                     ; 4-entry sub-handler pointer table for CODE_stamp_falling_rock: endcap (CODE_small_lift_endcap), body-row (CODE_small_lift_bodyrow), col-strip (CODE_small_lift_colstrip), corner (CODE_small_lift_corner).
	dw CODE_13D301
	dw CODE_13D30B
	dw CODE_13D324
	dw CODE_13D354

CODE_13D2D6:
CODE_stamp_falling_rock:                                     ; Per-cell stamp for object $89: 4 sub-handlers in DATA_small_lift_handler_ptrs indexed by row=end / row<end + col=end / col<end into the 4 quadrants of a small platform.
	REP.b #$30
	LDX.w #$0000
	TXY
	LDA.b $2E
	DEC
	BNE.b CODE_13D2EA
	LDA.b $2A
	DEC
	BEQ.b CODE_13D2F5
	INX
	INX
	BRA.b CODE_13D2F5

CODE_13D2EA:
	INX
	INX
	INX
	INX
	LDA.b $2A
	DEC
	BEQ.b CODE_13D2F5
	INX
	INX
CODE_13D2F5:
	JSR.w (DATA_13D2CE,x)
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_13D301:
CODE_small_lift_endcap:                                     ; Endcap sub-handler for object $89: always returns $720D (lift-corner tile). Used when both row=end and col=end (bottom-right corner of the small platform).
	LDA.w #$720D
	RTS

DATA_13D305:
DATA_small_lift_bodyrow_tiles:                                     ; 3-entry tile-id table {$7209, $720A, $720B} used by CODE_small_lift_bodyrow: leftcap-body, mid-body, rightcap-body of the lift platform top edge.
	dw $7209,$720A,$720B

CODE_13D30B:
CODE_small_lift_bodyrow:                                     ; Body-row sub-handler for object $89: picks 3-tile row {$7209,$720A,$720B} by col-position (col=0 / col=mid / col=end).
	LDA.b $28
	BEQ.b CODE_13D318
	INY
	INY
	INC
	CMP.b $2A
	BNE.b CODE_13D318
	INY
	INY
CODE_13D318:
	LDA.w DATA_13D305,y
	RTS

DATA_13D31C:
DATA_small_lift_colstrip_tiles:                                     ; 4-entry tile-id table {$720C, $720E, $7213, $720F} used by CODE_small_lift_colstrip.
	dw $720C,$720E,$7213,$720F

CODE_13D324:
CODE_small_lift_colstrip:                                     ; Col-strip sub-handler for object $89: picks vertical column tile from DATA_small_lift_colstrip_tiles by row position (row=0 / row=mid-odd / row=mid-even / row=end).
	LDA.b $2C
	BEQ.b CODE_13D337
	LDY.w #$0006
	INC
	CMP.b $2E
	BEQ.b CODE_13D337
	AND.w #$0001
	ASL
	TAY
	INY
	INY
CODE_13D337:
	LDA.w DATA_13D31C,y
	RTS

CODE_13D33B:
	RTS

DATA_13D33C:
DATA_small_lift_corner_tiles:                                     ; 12-entry tile-id table {$7200..$7212} used by CODE_small_lift_corner for full 3-row-by-4-col platform-edge layout.
	dw $7200,$7201,$7202,$7203,$7204,$7205,$7210,$7211
	dw $7212,$7206,$7207,$7208

CODE_13D354:
CODE_small_lift_corner:                                     ; Corner sub-handler for object $89: full 3x4 tile dispatch via DATA_small_lift_corner_tiles by row x col position picking edges and corners of the platform.
	LDA.b $2C
	BEQ.b CODE_13D36B
	LDY.w #$0012
	INC
	CMP.b $2E
	BEQ.b CODE_13D36B
	LDY.w #$0006
	AND.w #$0001
	BEQ.b CODE_13D36B
	LDY.w #$000C
CODE_13D36B:
	LDA.b $28
	BEQ.b CODE_13D378
	INY
	INY
	INC
	CMP.b $2A
	BNE.b CODE_13D378
	INY
	INY
CODE_13D378:
	LDA.w DATA_13D33C,y
	RTS

DATA_13D37C:
DATA_spike_row_tiles:                                     ; 4-entry tile-id table {$016F, $0170, $0171, $0172} used by CODE_stamp_boo_guy_bomb_room for the standard spike-row tile set.
	dw $016F,$0170,$0171,$0172

CODE_13D384:
CODE_stamp_boo_guy_bomb_room:                                     ; Per-cell stamp for object $8C: at $2C>=2 inspects cell-context $12 against literals $00B6-$00BA / $00C2-$00C7, writing $00C6 or $00D5 transition tile if matched; else picks from DATA_spike_row_tiles by col-parity x row.
	REP.b #$30
	LDA.b $2C
	CMP.w #$0002
	BCC.b CODE_13D3B3
	LDA.b $12
	CMP.w #$00C3
	BEQ.b CODE_13D3A5
	CMP.w #$00C7
	BEQ.b CODE_13D3A9
	CMP.w #$00C5
	BEQ.b CODE_13D3AE
	CMP.w #$00C2
	BNE.b CODE_13D3E4
	BRA.b CODE_13D3A9

CODE_13D3A5:
	LDA.b $28
	BEQ.b CODE_13D3E4
CODE_13D3A9:
	LDA.w #$00C6
	BRA.b CODE_13D3DE

CODE_13D3AE:
	LDA.w #$00D5
	BRA.b CODE_13D3DE

CODE_13D3B3:
	ASL
	ASL
	STA.b $00
	LDA.b $28
	AND.w #$0001
	ASL
	ORA.b $00
	TAY
	LDA.b $12
	CMP.w #$00B6
	BEQ.b CODE_13D3E4
	CMP.w #$00B7
	BEQ.b CODE_13D3E4
	CMP.w #$00B8
	BEQ.b CODE_13D3E4
	CMP.w #$00B9
	BEQ.b CODE_13D3E4
	CMP.w #$00BA
	BEQ.b CODE_13D3E4
	LDA.w DATA_13D37C,y
CODE_13D3DE:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13D3E4:
	SEP.b #$30
	RTL

DATA_13D3E7:
DATA_tree_tiles:                                     ; 3-entry tile-id table {$3D70, $3DA7, $3D6F} used by CODE_tree_stamp for random one-of-3 pipe-decoration tile.
	dw $3D70,$3DA7,$3D6F

CODE_13D3ED:
CODE_tree_stamp:                                     ; Per-cell stamp for object $8D: at last column writes entry 2 ($3D6F), else calls CODE_prng and picks entries 0/1 randomly. Single-row decoration sprinkle.
	REP.b #$10
	LDX.b $1D
	LDY.w #$0002
	LDA.b $2C
	INC
	CMP.b $2E
	BEQ.b CODE_13D402
	JSL.l CODE_prng
	AND.b #$01
	TAY
CODE_13D402:
	REP.b #$20
	TYA
	AND.w #$0003
	ASL
	TAY
	LDA.w DATA_13D3E7,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13D414:
DATA_pipe_cap_2x2_tiles:                                     ; 4-entry tile-id table {$7500, $7501, $3DAA, $3DAB} used by CODE_stamp_donut_lift_giant for the 2x2 pipe-cap block layout.
	dw $7500,$7501,$3DAA,$3DAB

CODE_13D41C:
CODE_stamp_donut_lift_giant:                                     ; Per-cell stamp for object $8E: indexes DATA_pipe_cap_2x2_tiles by (row*4) | (col-parity*2) giving the 2x2 tile-block layout.
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	AND.w #$0001
	ASL
	STA.b $00
	LDA.b $2C
	ASL
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_13D414,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13D439:
DATA_slanted_log_gradual_tiles_a:                                     ; 6-entry tile-id table {$1A0E, $1A22, $3DBF, $3DBE, $3DDB, $3DDA} used by CODE_slanted_log_gradual_stamp_a.
	dw $1A0E,$1A22,$3DBF,$3DBE,$3DDB,$3DDA

DATA_13D445:
DATA_slanted_log_gradual_tiles_b:                                     ; 8-entry tile-id table {$1A46, $1A36, $3DC0, $3DBD, $1A48, $1A38, $3DDC, $3DD9} used by CODE_slanted_log_gradual_stamp_b.
	dw $1A46,$1A36,$3DC0,$3DBD,$1A48,$1A38,$3DDC,$3DD9

DATA_13D455:
DATA_slanted_log_gradual_tiles_c:                                     ; 6-entry tile-id table {$1A56, $1A2C, $3DC1, $3DBC, $3DBF, $3DBE} used by CODE_slanted_log_gradual_load_c_tiles.
	dw $1A56,$1A2C,$3DC1,$3DBC,$3DBF,$3DBE

DATA_13D461:
DATA_slanted_log_gradual_tiles_d:                                     ; 6-entry tile-id table {$1A58, $1A32, $3DDD, $3DD8, $3DDB, $3DDA} used by CODE_slanted_log_gradual_load_d_tiles.
	dw $1A58,$1A32,$3DDD,$3DD8,$3DDB,$3DDA

DATA_13D46D:
DATA_slanted_log_gradual_handler_ptrs:                                     ; 3-entry sub-handler pointer table for CODE_slanted_log_gradual_stamp: stamp_a (CODE_slanted_log_gradual_stamp_a), stamp_b (CODE_slanted_log_gradual_stamp_b), stamp_c-or-d trampoline (CODE_slanted_log_gradual_stamp_cd).
	dw CODE_13D4D8
	dw CODE_13D4FD
	dw CODE_13D536

CODE_13D473:
CODE_slanted_log_gradual_stamp:                                     ; Per-cell stamp for object $8F: dispatches via DATA_slanted_log_gradual_handler_ptrs by row-position (row=0 / row=odd / row=even). Inspects cell $12 against $1C5C/$1C5E/$3DB0-$3DBA/$1A0C/$1A18 markers to refine pick.
	REP.b #$30
	LDA.b $2C
	CMP.w #$0003
	BCS.b CODE_13D4D5
	ASL
	ASL
	TAY
	LDA.b $2A
	BPL.b CODE_13D485
	INY
	INY
CODE_13D485:
	STZ.b $00
	LDA.b $12
	BEQ.b CODE_13D4B9
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_13D4B7
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BEQ.b CODE_13D4B7
	CMP.w #$3DB0
	BEQ.b CODE_13D4B5
	CMP.w #$3DB1
	BEQ.b CODE_13D4B5
	CMP.w #$3DB9
	BEQ.b CODE_13D4B5
	CMP.w #$3DBA
	BEQ.b CODE_13D4B5
	CMP.w $1A0C
	BEQ.b CODE_13D4B9
	CMP.w $1A18
	BEQ.b CODE_13D4B9
	INC.b $00
CODE_13D4B5:
	INC.b $00
CODE_13D4B7:
	INC.b $00
CODE_13D4B9:
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_13D4C9
	INX
	INX
	AND.w #$0001
	BNE.b CODE_13D4C9
	INX
	INX
CODE_13D4C9:
	JSR.w (DATA_13D46D,x)
	TYA
	BEQ.b CODE_13D4D5
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13D4D5:
	SEP.b #$30
	RTL

CODE_13D4D8:
CODE_slanted_log_gradual_stamp_a:                                     ; Stamp variant A for object $8F: writes from DATA_slanted_log_gradual_tiles_a with sign($2A) row toggle, suppresses output when $2C>=2 (beyond width-2).
	STZ.b $9B
	LDA.b $2C
	CMP.w #$0002
	BCC.b CODE_13D4E6
	LDA.w #$0000
	BRA.b CODE_13D4FB

CODE_13D4E6:
	LDA.b $00
	BEQ.b CODE_13D4F0
	TYA
	CLC
	ADC.w #$0004
	TAY
CODE_13D4F0:
	LDA.w DATA_13D439,y
	LDX.b $2C
	BNE.b CODE_13D4FB
	TAX
	LDA.w $0000,x
CODE_13D4FB:
	TAY
	RTS

CODE_13D4FD:
CODE_slanted_log_gradual_stamp_b:                                     ; Stamp variant B for object $8F: writes from DATA_slanted_log_gradual_tiles_b with additional level-bit-0 ($000000) context test, suppresses on $2C>=2.
	STZ.b $9B
	LDA.b $2C
	CMP.w #$0002
	BCC.b CODE_13D50B
	LDA.w #$0000
	BRA.b CODE_13D52C

CODE_13D50B:
	LDA.l $000000
	BEQ.b CODE_13D521
	CMP.w #$0002
	BCC.b CODE_13D51B
	LDA.w #$0000
	BRA.b CODE_13D52C

CODE_13D51B:
	TYA
	CLC
	ADC.w #$0008
	TAY
CODE_13D521:
	LDA.w DATA_13D445,y
	LDX.b $2C
	BNE.b CODE_13D52C
	TAX
	LDA.w $0000,x
CODE_13D52C:
	TAY
	RTS

DATA_13D52E:
DATA_slanted_log_gradual_cd_subhandlers:                                     ; 3-entry sub-handler pointer table for CODE_slanted_log_gradual_stamp_cd: stamp_c-tile-load (CODE_13D54D), stamp_d-tile-load (CODE_13D553), zero-stamp (CODE_13D559).
	dw CODE_13D54D
	dw CODE_13D553
	dw CODE_13D559
	dw CODE_13D559

CODE_13D536:
CODE_slanted_log_gradual_stamp_cd:                                     ; Stamp variant C/D dispatcher for object $8F: indexes DATA_13D52E (3 entries: tiles_c, tiles_d, zero) by $00, sets $9B=1 for diagonal-track marker.
	LDA.w #$0001
	STA.b $9B
	LDA.b $00
	ASL
	TAX
	JSR.w (DATA_13D52E,x)
	LDY.b $02
	LDX.b $2C
	BNE.b CODE_13D54C
	LDA.w $0000,y
	TAY
CODE_13D54C:
	RTS

CODE_13D54D:
CODE_slanted_log_gradual_load_c_tiles:                                     ; Helper: loads DATA_slanted_log_gradual_tiles_c value at index y into $02 (used by CODE_slanted_log_gradual_stamp_cd).
	LDA.w DATA_13D455,y
	STA.b $02
	RTS

CODE_13D553:
CODE_slanted_log_gradual_load_d_tiles:                                     ; Helper: loads DATA_slanted_log_gradual_tiles_d value at index y into $02 (used by CODE_slanted_log_gradual_stamp_cd).
	LDA.w DATA_13D461,y
	STA.b $02
	RTS

CODE_13D559:
CODE_slanted_log_gradual_zero_tile:                                     ; Helper: writes $0000 to $02  null-tile entry in the C/D sub-table, used when the chevron context doesn't match any expected tile and the cell should be skipped.
	STZ.b $02
	RTS

DATA_13D55C:
DATA_slanted_log_tiles_a:                                     ; 6-entry tile-id table {$1A0C, $1A18, $3DB1, $3DB0, $3DB6, $3DB5} used by CODE_slanted_log_stamp_a (object $90 mirror of $8F's chevron tiles_a).
	dw $1A0C,$1A18,$3DB1,$3DB0,$3DB6,$3DB5

DATA_13D568:
DATA_slanted_log_tiles_b:                                     ; 6-entry tile-id table {$1A1E, $1A06, $3DBB, $3DB8, $3DBA, $3DB9} used by CODE_slanted_log_stamp_b.
	dw $1A1E,$1A06,$3DBB,$3DB8,$3DBA,$3DB9

CODE_13D574:
CODE_slanted_log_stamp:                                     ; Per-cell stamp for object $90 mirror chevron: $2C<3 sets $9B=1, picks tile by (row*4)|sign($2A); $28!=0 -> stamp_b path, $28=0 with $12=$1C5C/$1C5E adjusts offset+4, otherwise stamp_a path.
	REP.b #$30
	LDA.b $2C
	CMP.w #$0003
	BCS.b CODE_13D5BF
	LDA.w #$0001
	STA.b $9B
	STZ.b $00
	LDA.b $2A
	BPL.b CODE_13D58D
	LDA.w #$0002
	STA.b $00
CODE_13D58D:
	LDA.b $2C
	ASL
	ASL
	ORA.b $00
	TAY
	LDA.b $28
	BNE.b CODE_slanted_log_call_b
	STZ.b $9B
	LDA.b $12
	BEQ.b CODE_13D5AE
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_13D5A8
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BNE.b CODE_13D5BF
CODE_13D5A8:
	TYA
	CLC
	ADC.w #$0004
	TAY
CODE_13D5AE:
	JSR.w CODE_13D5C2
	BRA.b CODE_slanted_log_store

CODE_13D5B3:
CODE_slanted_log_call_b:
	JSR.w CODE_13D5E7
CODE_13D5B6:
CODE_slanted_log_store:
	TYA
	BEQ.b CODE_13D5BF
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13D5BF:
	SEP.b #$30
	RTL

CODE_13D5C2:
CODE_slanted_log_stamp_a:                                     ; Variant A helper for object $90: picks tile from DATA_slanted_log_tiles_a at index y, with $2C=0 col-init dereference.
	LDA.b $2C
	CMP.w #$0002
	BCC.b CODE_13D5CE
	LDA.w #$0000
	BRA.b CODE_13D5D9

CODE_13D5CE:
	LDA.w DATA_13D55C,y
	LDX.b $2C
	BNE.b CODE_13D5D9
	TAX
	LDA.w $0000,x
CODE_13D5D9:
	TAY
	RTS

DATA_13D5DB:
DATA_slanted_log_tiles_c:                                     ; 6-entry tile-id table {$1A20, $1A04, $3DB7, $3DB4, $3DB6, $3DB5} used by CODE_slanted_log_stamp_b alt-floor branch.
	dw $1A20,$1A04,$3DB7,$3DB4,$3DB6,$3DB5

CODE_13D5E7:
CODE_slanted_log_stamp_b:                                     ; Variant B helper for object $90: at level-byte=0 uses DATA_slanted_log_tiles_b, at $1C5C/$1C5E context uses DATA_slanted_log_tiles_c, otherwise writes 0.
	LDA.b $12
	BEQ.b CODE_13D5FF
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_13D5FA
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BEQ.b CODE_13D5FA
	LDA.w #$0000
	BRA.b CODE_13D60A

CODE_13D5FA:
	LDA.w DATA_13D5DB,y
	BRA.b CODE_13D602

CODE_13D5FF:
	LDA.w DATA_13D568,y
CODE_13D602:
	LDX.b $2C
	BNE.b CODE_13D60A
	TAX
	LDA.w $0000,x
CODE_13D60A:
	TAY
	RTS

DATA_13D60C:
DATA_treecap_tiles_a:                                     ; 7-entry tile-id table {$3DC2, $3DC3, $3DC4, $0000, $3DC8, $3DC9, $3DCA} used by CODE_treecap_stamp_a (object $91/$92 variant A).
	dw $3DC2,$3DC3,$3DC4,$0000,$3DC8,$3DC9,$3DCA

CODE_13D61A:
CODE_treecap_stamp_a:                                     ; Per-cell stamp for object $91/$92 variant A: $2C<2 picks from DATA_treecap_tiles_a by (col*8)|(row*2); $2C>=2 writes $3DB2 stem; last-row checks $1A0A/$1A30 against $1A06/$1A2C neighbours, fallback $3DAC.
	REP.b #$30
	LDA.b $2C
CODE_13D61E:
	CMP.w #$0002
	BCS.b CODE_13D635
	LDA.b $28
	ASL
	STA.b $00
	LDA.b $2C
	ASL
	ASL
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_13D60C,y
	BRA.b CODE_13D65E

CODE_13D635:
	LDA.b $28
	BEQ.b CODE_13D664
	INC
	CMP.b $2A
	BEQ.b CODE_13D664
	LDA.w #$3DB2
	LDY.b $2C
	INY
	CPY.b $2E
	BNE.b CODE_13D65E
	LDY.w $1A0A
	LDA.b $12
	CMP.w $1A06
	BEQ.b CODE_13D65D
	LDY.w $1A30
	CMP.w $1A2C
	BEQ.b CODE_13D65D
	LDY.w #$3DAC
CODE_13D65D:
	TYA
CODE_13D65E:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13D664:
	SEP.b #$30
	RTL

DATA_13D667:
DATA_treecap_tiles_b:                                     ; 7-entry tile-id table {$3DC5, $3DC6, $3DC7, $0000, $3DCB, $3DAE, $3DAF} used by CODE_treecap_stamp_b (object $91/$92 variant B).
	dw $3DC5,$3DC6,$3DC7,$0000,$3DCB,$3DAE,$3DAF

CODE_13D675:
CODE_treecap_stamp_b:                                     ; Per-cell stamp for object $91/$92 variant B: mirror of CODE_treecap_stamp_a using DATA_treecap_tiles_b; stem-tile is $3DB3, last-row lookup uses $1A1A/$1A52 against $1A1E/$1A56 neighbours, fallback $3DAD.
	REP.b #$30
	LDA.b $2C
	CMP.w #$0002
	BCS.b CODE_13D690
	LDA.b $28
	ASL
	STA.b $00
	LDA.b $2C
	ASL
	ASL
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_13D667,y
	BRA.b CODE_13D6B9

CODE_13D690:
	LDA.b $28
	BEQ.b CODE_13D6BF
	INC
	CMP.b $2A
	BEQ.b CODE_13D6BF
	LDA.w #$3DB3
	LDY.b $2C
	INY
	CPY.b $2E
	BNE.b CODE_13D6B9
	LDY.w $1A1A
	LDA.b $12
	CMP.w $1A1E
	BEQ.b CODE_13D6B8
	LDY.w $1A52
	CMP.w $1A56
	BEQ.b CODE_13D6B8
	LDY.w #$3DAD
CODE_13D6B8:
	TYA
CODE_13D6B9:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13D6BF:
	SEP.b #$30
	RTL

DATA_13D6C2:
DATA_grass_tuft_corner_tiles:                                     ; 8-entry corner-tile lookup ($3DCE,$3DCF,$3DD0,$0000,$3DD1,$3DD2,$3DD3,$3DD4) for CODE_stamp_grass_tuft_2x2_corner; indexed by ($2C<<3 | $28 bit 0 <<1).
	dw $3DCE,$3DCF,$3DD0,$0000,$3DD1,$3DD2,$3DD3,$3DD4

CODE_13D6D2:
CODE_stamp_grass_tuft_2x2_corner:                                     ; Bank13 cell stamp variant for $94-$97 (2x2 grass tuft / cattail). Uses 8-entry DATA_13D6C2 ($3DCE-$3DD4) for corner picks when $2C<2; falls through to centre/seam logic ($3DD5/$3DD6) for inner cells.
	REP.b #$30
	LDX.b $1D
	LDA.b $2C
	CMP.w #$0002
	BCS.b CODE_13D6F1
	LDA.b $28
	ASL
	STA.b $00
	LDA.b $2C
	ASL
	ASL
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_13D6C2,y
	BEQ.b CODE_13D716
	BRA.b CODE_13D712

CODE_13D6F1:
	LDA.b $28
	BEQ.b CODE_13D716
	INC
	CMP.b $2A
	BEQ.b CODE_13D716
	LDY.b $2C
	INY
	CPY.b $2E
	BEQ.b CODE_13D70B
	CMP.w #$0003
	BCS.b CODE_13D716
	LDA.w #$3DD5
	BRA.b CODE_13D712

CODE_13D70B:
	AND.w #$0001
	CLC
	ADC.w #$3DD6
CODE_13D712:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13D716:
	SEP.b #$30
	RTL

DATA_13D719:
DATA_grass_tuft_2x2_tiles:                                     ; 16-entry tile table for CODE_stamp_number_platform (objects $94-$97). Tiles $7600-$7607 + $7775-$777C arranged as 4 orientations x 4 cells (TL/TR/BL/BR).
	dw $7600,$7601,$7775,$7776,$7602,$7603,$7777,$7778
	dw $7604,$7605,$7779,$777A,$7606,$7607,$777B,$777C

CODE_13D739:
CODE_stamp_number_platform:                                     ; Bank13 cell stamp for objects $94-$97 (2x2 grass/cattail block). Reads 16-entry DATA_13D719 indexed by ($15 & $03 orientation, $28 col-bit, $2C row-bit). Covers $7600-$7607 + $7775-$777C.
	REP.b #$30
	LDA.b $15
	AND.w #$0003
	ASL
	ASL
	ASL
	STA.b $00
	LDA.b $28
	AND.w #$0001
	ASL
	ORA.b $00
	STA.b $00
	LDA.b $2C
	AND.w #$0001
	ASL
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_13D719,y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13D765:
DATA_column_segment_handlers:                                     ; 3-entry ptr table for CODE_stamp_column_3segment dispatch: CODE_column_3segment_top_pick top-cap / CODE_column_3segment_middle_pick middle / CODE_column_3segment_base_pick base, keyed by $2C row-position.
	dw CODE_column_3segment_top_pick
	dw CODE_column_3segment_middle_pick
	dw CODE_column_3segment_base_pick

CODE_13D76B:
CODE_stamp_column_3segment:                                     ; Bank13 cell stamp for object $98 (3-segment vertical column). Sub-dispatches via DATA_13D765 (top-cap / middle / base) by $2C row-position. Each sub-helper picks tile from its own variant table.
	REP.b #$30
	LDX.w #$0000
	LDA.b $28
	AND.w #$0001
	ASL
	TAY
	LDA.b $2C
	BEQ.b CODE_13D784
	INX
	INX
	CMP.w #$0001
	BEQ.b CODE_13D784
	INX
	INX
CODE_13D784:
	JSR.w (DATA_13D765,x)
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13D790:
DATA_column_top_tiles:                                     ; 2-entry top-cap tile table ($7750,$7754) for CODE_stamp_column_3segment top-row handler (CODE_column_3segment_top_pick), indexed by $28 col-bit.
	dw $7750,$7754

CODE_13D794:
CODE_column_3segment_top_pick:
	LDA.w DATA_13D790,y
	RTS

DATA_13D798:
DATA_column_middle_tiles:                                     ; 5-entry middle-segment tile table ($7800-$7804) for CODE_stamp_column_3segment middle handler (CODE_column_3segment_middle_pick), with sides-aware cap variants.
	dw $7800,$7801,$7802,$7803

CODE_13D7A0:
CODE_column_3segment_middle_pick:
	LDA.b $2A
	CMP.w #$0001
	BNE.b CODE_13D7AC
	LDA.w #$7804
	BRA.b CODE_13D7BD

CODE_13D7AC:
	LDA.b $28
	BEQ.b CODE_13D7BA
	INY
	INY
	INC
	CMP.b $2A
	BNE.b CODE_13D7BA
	LDY.w #$0006
CODE_13D7BA:
	LDA.w DATA_13D798,y
CODE_13D7BD:
	RTS

DATA_13D7BE:
DATA_column_base_tiles:                                     ; 2-entry base tile table ($01B7,$01B8) for CODE_stamp_column_3segment bottom handler (CODE_column_3segment_base_pick), keyed by ($2C + $28) & 1.
	dw $01B7,$01B8

CODE_13D7C2:
CODE_column_3segment_base_pick:
	LDA.b $2C
	CLC
	ADC.b $28
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_13D7BE,y
	RTS

DATA_13D7D0:
DATA_floor_3wide_tiles:                                     ; 7-entry tile table ($01B9-$01BE with $0000 hole) for CODE_stamp_floor_3wide (object $99) edge cell selection.
	dw $01B9,$01BA,$01BB,$0000,$01BC,$01BD,$01BE

CODE_13D7DE:
CODE_stamp_floor_3wide:                                     ; Bank13 cell stamp for object $99 (3-wide floor block). Edge cells read DATA_13D7D0 ($01B9-$01BE); middle cell JSLs CODE_bg_floor_random for grass-variant pick. Different lookup for $2C>=2 vs top 2 rows.
	REP.b #$30
	LDA.b $2C
	CMP.w #$0002
	BCC.b CODE_floor_3wide_edge_pick
	LDA.b $28
	BEQ.b CODE_floor_3wide_exit
	INC
	CMP.b $2A
	BEQ.b CODE_floor_3wide_exit
	JSL.l CODE_bg_floor_random
	BRA.b CODE_floor_3wide_exit

CODE_13D7F6:
CODE_floor_3wide_edge_pick:
	ASL
	ASL
	ASL
	STA.b $00
	LDA.b $28
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_13D7D0,y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13D80A:
CODE_floor_3wide_exit:
	SEP.b #$30
	RTL

DATA_13D80D:
	dw $0000,$7701,$7702,$7703,$7710,$7711,$7712,$7713

DATA_13D81D:
	dw $7730,$7731,$7732,$0000,$7740,$7741,$7742,$7743

DATA_13D82D:
	dw $7700,$7704,$7708,$770C

DATA_13D835:
	dw $7733,$7737,$773B,$773F

DATA_13D83D:
	dw $7723,$7727,$772B,$772F

DATA_13D845:
	dw CODE_floor_4wide_even_body_pick
	dw CODE_floor_4wide_even_col2_c
	dw CODE_floor_4wide_even_col2_a
	dw CODE_floor_4wide_even_col2_b

DATA_13D84D:
	dw CODE_floor_4wide_odd_body_pick
	dw CODE_floor_4wide_odd_col1_c
	dw CODE_floor_4wide_odd_col1_b
	dw CODE_floor_4wide_odd_col1_a

CODE_13D855:
CODE_stamp_floor_4wide:                                     ; Bank13 cell stamp for object $9A (4-wide PRNG-decorated floor). $2E parity picks DATA_13D845 (even) or DATA_13D84D (odd) row tables, each with 4 sub-handlers picking from $7700-$7743 tile variants and ADCing $15 x4.
	REP.b #$30
	LDA.b $2C
	AND.w #$0001
	ASL
	ASL
	ASL
	STA.b $00
	LDX.w #$0000
	LDA.b $2C
	CMP.w #$0002
	BCC.b CODE_13D87B
	INX
	INX
	INC
	CMP.b $2E
	BEQ.b CODE_13D87B
	INX
	INX
	AND.w #$0001
	BNE.b CODE_13D87B
	INX
	INX
CODE_13D87B:
	LDA.b $2E
	AND.w #$0001
	BEQ.b CODE_13D887
	JSR.w (DATA_13D845,x)
	BRA.b CODE_floor_4wide_apply_pick

CODE_13D887:
	JSR.w (DATA_13D84D,x)
CODE_13D88A:
CODE_floor_4wide_apply_pick:
	TYA
	BEQ.b CODE_13D893
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13D893:
	SEP.b #$30
	RTL

CODE_13D896:
CODE_floor_4wide_even_body_pick:
	LDA.b $28
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_13D80D,y
	BEQ.b CODE_13D8AA
	CLC
	ADC.b $15
	ADC.b $15
	ADC.b $15
	ADC.b $15
CODE_13D8AA:
	TAY
	RTS

CODE_13D8AC:
CODE_floor_4wide_even_col2_a:
	LDA.b $28
	CMP.w #$0002
	BNE.b CODE_13D8BB
	LDA.b $A1
	TAY
	LDA.w DATA_13D82D,y
	TAY
	RTS

CODE_13D8BB:
	LDY.w #$0000
	RTS

CODE_13D8BF:
CODE_floor_4wide_even_col2_b:
	LDA.b $28
	CMP.w #$0002
	BNE.b CODE_13D8BB
	LDA.b $A1
	TAY
	LDA.w DATA_13D835,y
	TAY
	RTS

CODE_13D8CE:
CODE_floor_4wide_even_col2_c:
	LDA.b $28
	CMP.w #$0002
	BNE.b CODE_13D8BB
	LDA.b $A1
	TAY
	LDA.w DATA_13D83D,y
	TAY
	RTS

CODE_13D8DD:
CODE_floor_4wide_odd_body_pick:
	LDA.b $28
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_13D81D,y
	BEQ.b CODE_13D8F1
	CLC
	ADC.b $15
	ADC.b $15
	ADC.b $15
	ADC.b $15
CODE_13D8F1:
	TAY
	RTS

CODE_13D8F3:
	RTS

CODE_13D8F4:
CODE_floor_4wide_odd_col1_a:
	LDA.b $28
	CMP.w #$0001
	BNE.b CODE_13D903
	LDA.b $A1
	TAY
	LDA.w DATA_13D82D,y
	TAY
	RTS

CODE_13D903:
	LDY.w #$0000
	RTS

CODE_13D907:
CODE_floor_4wide_odd_col1_b:
	LDA.b $28
	CMP.w #$0001
	BNE.b CODE_13D903
	LDA.b $A1
	TAY
	LDA.w DATA_13D835,y
	TAY
	RTS

CODE_13D916:
CODE_floor_4wide_odd_col1_c:
	LDA.b $28
	CMP.w #$0001
	BNE.b CODE_13D903
	LDA.b $A1
	TAY
	LDA.w DATA_13D83D,y
	TAY
	RTS

DATA_13D925:
	dw CODE_ledge_random_v1_load_set_a
	dw CODE_ledge_random_v1_load_random_c
	dw CODE_ledge_random_v1_load_random_a
	dw CODE_ledge_random_v1_load_random_b

DATA_13D92D:
	dw CODE_ledge_random_v1_load_set_b
	dw CODE_ledge_random_v1_load_random_c
	dw CODE_ledge_random_v1_load_random_b
	dw CODE_ledge_random_v1_load_random_a

DATA_13D935:
	dw $7722,$7724,$7728,$772C

DATA_13D93D:
	dw $7751,$7757,$775A,$775D

CODE_13D945:
CODE_stamp_ledge_random_v1:                                     ; Bank13 cell stamp for objects $9B,$9C variant 0 (random-decorated ledge, $7722-$775D tile set). Branches on $2C parity into DATA_13D925 (4 sub-handlers using DATA_13D935 / DATA_13D82D-DATA_13D83D).
	REP.b #$30
	LDA.b $15
	ASL
	TAY
	LDX.w #$0000
	LDA.b $2C
	BEQ.b CODE_13D962
	INX
	INX
	INC
	CMP.b $2E
	BEQ.b CODE_13D962
	INX
	INX
	AND.w #$0001
	BEQ.b CODE_13D962
	INX
	INX
CODE_13D962:
	LDA.b $2E
	AND.w #$0001
	BNE.b CODE_ledge_random_v1_odd_width
	JSR.w (DATA_13D925,x)
	TAY
	JMP.w CODE_floor_4wide_apply_pick

CODE_13D970:
CODE_ledge_random_v1_odd_width:
	JSR.w (DATA_13D92D,x)
	TAY
	JMP.w CODE_floor_4wide_apply_pick

CODE_13D977:
CODE_ledge_random_v1_load_set_a:
	LDA.w DATA_13D935,y
	RTS

CODE_13D97B:
CODE_ledge_random_v1_load_set_b:
	LDA.w DATA_13D93D,y
	RTS

CODE_13D97F:
CODE_ledge_random_v1_load_random_a:
	LDA.b $A1
	TAY
	LDA.w DATA_13D82D,y
	RTS

CODE_13D986:
CODE_ledge_random_v1_load_random_b:
	LDA.b $A1
	TAY
	LDA.w DATA_13D835,y
	RTS

CODE_13D98D:
CODE_ledge_random_v1_load_random_c:
	LDA.b $A1
	TAY
	LDA.w DATA_13D83D,y
	RTS

DATA_13D994:
	dw CODE_ledge_random_v2_load_cap_a
	dw CODE_ledge_random_v2_load_cap_b
	dw CODE_ledge_random_v1_load_random_c
	dw CODE_ledge_random_v1_load_random_a
	dw CODE_ledge_random_v1_load_random_b

DATA_13D99E:
	dw CODE_ledge_random_v2_load_cap_c
	dw CODE_ledge_random_v2_load_cap_d
	dw CODE_ledge_random_v1_load_random_c
	dw CODE_ledge_random_v1_load_random_b
	dw CODE_ledge_random_v1_load_random_a

DATA_13D9A8:
	dw $7753,$7756,$7759,$775C

DATA_13D9B0:
	dw $7752,$7755,$7758,$775B

DATA_13D9B8:
	dw $7720,$7725,$7729,$772D

DATA_13D9C0:
	dw $7721,$7726,$772A,$772E

CODE_13D9C8:
CODE_stamp_ledge_random_v2:                                     ; Bank13 cell stamp for objects $9B,$9C variant 1 (random-decorated ledge, $7720-$775C). Same structure as v1 but via DATA_13D994/13D99E into CODE_ledge_random_v2_load_cap_a-13DA0D picking from DATA_13D9A8-DATA_13D9C0.
	REP.b #$30
	LDA.b $15
	ASL
	TAY
	LDX.w #$0000
	LDA.b $2C
	BEQ.b CODE_13D9EC
	INX
	INX
	CMP.w #$0001
	BEQ.b CODE_13D9EC
	INX
	INX
	INC
	CMP.b $2E
	BEQ.b CODE_13D9EC
	INX
	INX
	AND.w #$0001
	BEQ.b CODE_13D9EC
	INX
	INX
CODE_13D9EC:
	LDA.b $2E
	AND.w #$0001
	BNE.b CODE_ledge_random_v2_odd_width
	JSR.w (DATA_13D994,x)
	TAY
	JMP.w CODE_floor_4wide_apply_pick

CODE_13D9FA:
CODE_ledge_random_v2_odd_width:
	JSR.w (DATA_13D99E,x)
	TAY
	JMP.w CODE_floor_4wide_apply_pick

CODE_13DA01:
CODE_ledge_random_v2_load_cap_a:
	LDA.w DATA_13D9A8,y
	RTS

CODE_13DA05:
CODE_ledge_random_v2_load_cap_b:
	LDA.w DATA_13D9B0,y
	RTS

CODE_13DA09:
CODE_ledge_random_v2_load_cap_c:
	LDA.w DATA_13D9B8,y
	RTS

CODE_13DA0D:
CODE_ledge_random_v2_load_cap_d:
	LDA.w DATA_13D9C0,y
	RTS

DATA_13DA11:
	dw $7900,$7901,$7902

DATA_13DA17:
	dw $7903,$7904,$7905

DATA_13DA1D:
	dw $7906,$7907,$7908

DATA_13DA23:
	dw $7909,$790A,$790B,$790C,$790D,$790E

DATA_13DA2F:
	dw CODE_decoration_4state_load_v0
	dw CODE_decoration_4state_load_v3_floorbiased
	dw CODE_decoration_4state_load_v1
	dw CODE_decoration_4state_load_v2

CODE_13DA37:
CODE_stamp_stationary_rock:                                     ; Bank13 cell stamp for object $9D ($7900-$790E decoration cluster). Corner-bucket from $28/$2C dispatches via DATA_13DA2F into 4 sub-handlers. CODE_decoration_4state_load_v3_floorbiased has tileset branch shifting lookup +6 for lava-flame variants.
	REP.b #$30
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_13DA49
	INY
	INY
	INC
	CMP.b $2A
	BNE.b CODE_13DA49
	INY
	INY
CODE_13DA49:
	LDX.w #$0000
	LDA.b $2C
	BEQ.b CODE_13DA60
	INX
	INX
	INC
	CMP.b $2E
	BEQ.b CODE_13DA60
	INX
	INX
	AND.w #$0001
	BEQ.b CODE_13DA60
	INX
	INX
CODE_13DA60:
	JSR.w (DATA_13DA2F,x)
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_13DA6C:
CODE_decoration_4state_load_v0:
	LDA.w DATA_13DA11,y
	RTS

CODE_13DA70:
CODE_decoration_4state_load_v1:
	LDA.w DATA_13DA17,y
	RTS

CODE_13DA74:
CODE_decoration_4state_load_v2:
	LDA.w DATA_13DA1D,y
	RTS

CODE_13DA78:
CODE_decoration_4state_load_v3_floorbiased:
	LDA.b $12
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_13DA84
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BNE.b CODE_13DA8A
CODE_13DA84:
	TYA
	CLC
	ADC.w #$0006
	TAY
CODE_13DA8A:
	LDA.w DATA_13DA23,y
	RTS

CODE_13DA8E:
CODE_stamp_donut_lift:                                     ; Bank13 cell stamp for object $9E (single-tile checkpoint/marker). Unconditionally stamps $7502 at the current cell -- no shape or variant logic.
	REP.b #$30
	LDX.b $1D
	LDA.w #$7502
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13DA9C:
DATA_raven_platform_tiles:                                     ; 4-entry tile table ($3308/$3508/$0004/$0005) for CODE_stamp_raven_platform (object $9F): top-left / top-right / bottom-left / bottom-right of the raised 2-row step.
	dw $3308,$3508,$0004,$0005

CODE_13DAA4:
CODE_stamp_raven_platform:                                     ; Bank13 cell stamp for object $9F (2-row raised-ledge step). Skips stamp on interior even cells ($28 & $02); else reads DATA_13DA9C ($3308/$3508/$0004/$0005) by ($2C<<2 | $28>>1) for top/bottom row x left/right cap.
	REP.b #$30
	LDA.b $28
	AND.w #$0002
	BNE.b CODE_13DAC5
	LDA.b $28
	AND.w #$0001
	ASL
	STA.b $00
	LDA.b $2C
	ASL
	ASL
	ORA.b $00
	TAY
	LDX.b $1D
	LDA.w DATA_13DA9C,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13DAC5:
	SEP.b #$30
	RTL

DATA_13DAC8:
DATA_colored_block_tiles:                                     ; 2-entry base tile table ($7A00/$7A01) for CODE_stamp_water_top_2tile (objects $A0-$A2); $15 from init handler adds per-variant offset.
	dw $7A00,$7A01

CODE_13DACC:
CODE_stamp_water_top_2tile:                                     ; Bank13 cell stamp for objects $A0-$A2 (water/swamp top-edge, $7A page). Reads DATA_13DAC8 ($7A00/$7A01) by $28 bit 0 then adds $15 as per-variant tile offset from init handler.
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_13DAC8,y
	CLC
	ADC.b $15
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13DAE4:
DATA_breakable_rock_tiles:                                     ; 4-entry corner-block tile table ($7B00-$7B03) for CODE_stamp_breakable_rock_offset (objects $A3,$A4); $15 from init handler adds per-variant offset.
	dw $7B00,$7B01,$7B02,$7B03

CODE_13DAEC:
CODE_stamp_breakable_rock_offset:                                     ; Bank13 cell stamp for objects $A3,$A4 (2x2 wall block, $7B page). Reads DATA_13DAE4 ($7B00-$7B03) by 4-cell corner index, then adds $15 as per-variant tile offset.
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	AND.w #$0001
	ASL
	STA.b $00
	LDA.b $2C
	AND.w #$0001
	ASL
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_13DAE4,y
	CLC
	ADC.b $15
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13DB0F:
	dw CODE_pipe_vert_sub_dispatch
	dw CODE_pipe_horiz_sub_dispatch
	dw CODE_pipe_water_vert_sub_dispatch
	dw CODE_pipe_water_horiz_sub_dispatch

;-------------------------------------------------------------------------
; CODE_pipe_dispatch -- CODE_pipe_dispatch: pipe-stamp orientation dispatcher.
; Parallels ys_bgsc1.asm (pipe). Top-level pipe handler:
; reads orientation $15, dispatches via DATA_13DB0F (4
; entries -> CODE_pipe_vert_sub_dispatch / 9A / CODE_pipe_water_vert_sub_dispatch / CODE_pipe_water_horiz_sub_dispatch) which
; correspond to vertical pipe (TATE), horizontal pipe (YOKO), and the
; two diagonal pipe variants. Each sub-handler returns the tile in Y.
;-------------------------------------------------------------------------
CODE_13DB17:
CODE_pipe_dispatch:                                              ; descriptive alias
	REP.b #$30
	LDX.b $15
	JSR.w (DATA_13DB0F,x)
	TYA
	BEQ.b CODE_13DB27
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13DB27:
	SEP.b #$30
	RTL

DATA_13DB2A:
	dw CODE_pipe_vert_top_cap
	dw CODE_pipe_vert_middle_tile
	dw CODE_pipe_vert_bottom_cap

CODE_13DB30:
CODE_pipe_vert_sub_dispatch:
	LDA.b $28
	AND.w #$0001
	ASL
	STA.b $00
	TAY
	LDX.w #$0000
	LDA.b $2C
	BEQ.b CODE_13DB49
	INX
	INX
	INC
	CMP.b $2E
	BNE.b CODE_13DB49
	INX
	INX
CODE_13DB49:
	JSR.w (DATA_13DB2A,x)
	TAY
	RTS

DATA_13DB4E:
	dw $7D02,$7D03

CODE_13DB52:
CODE_pipe_vert_top_cap:
	LDA.b $12
	BEQ.b CODE_13DB5D
	CMP.w #$1600
	BEQ.b CODE_13DB5D
	BRA.b CODE_13DB62

CODE_13DB5D:
	LDA.w DATA_13DB4E,y
	BRA.b CODE_13DB65

CODE_13DB62:
	LDA.w #$0000
CODE_13DB65:
	RTS

DATA_13DB66:
	dw $01C9,$01CA,$01C7,$01C8

CODE_13DB6E:
CODE_pipe_vert_middle_tile:
	LDA.b $2C
	AND.w #$0001
	ASL
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_13DB66,y
	RTS

DATA_13DB7C:
	dw $7D06,$7D07

CODE_13DB80:
CODE_pipe_vert_bottom_cap:
	LDA.b $12
	BEQ.b CODE_13DB8B
	CMP.w #$1600
	BEQ.b CODE_13DB8B
	BRA.b CODE_13DB90

CODE_13DB8B:
	LDA.w DATA_13DB7C,y
	BRA.b CODE_13DB93

CODE_13DB90:
	LDA.w #$0000
CODE_13DB93:
	RTS

DATA_13DB94:
	dw CODE_pipe_horiz_left_cap
	dw CODE_pipe_horiz_middle_tile
	dw CODE_pipe_horiz_right_cap

CODE_13DB9A:
CODE_pipe_horiz_sub_dispatch:
	LDA.b $2C
	AND.w #$0001
	ASL
	STA.b $00
	TAY
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_13DBB3
	INX
	INX
	INC
	CMP.b $2A
	BNE.b CODE_13DBB3
	INX
	INX
CODE_13DBB3:
	JSR.w (DATA_13DB94,x)
	TAY
	RTS

DATA_13DBB8:
	dw $7D00,$7D01

CODE_13DBBC:
CODE_pipe_horiz_left_cap:
	LDA.b $12
	BEQ.b CODE_13DBC7
	CMP.w #$1600
	BEQ.b CODE_13DBC7
	BRA.b CODE_13DBCC

CODE_13DBC7:
	LDA.w DATA_13DBB8,y
	BRA.b CODE_13DBCF

CODE_13DBCC:
	LDA.w #$0000
CODE_13DBCF:
	RTS

DATA_13DBD0:
	dw $01C4,$01C3,$01C5,$01C6

CODE_13DBD8:
CODE_pipe_horiz_middle_tile:
	ASL.b $00
	LDA.b $28
	AND.w #$0001
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_13DBD0,y
	RTS

DATA_13DBE7:
	dw $7D04,$7D05

CODE_13DBEB:
CODE_pipe_horiz_right_cap:
	LDA.b $12
	BEQ.b CODE_13DBF6
	CMP.w #$1600
	BEQ.b CODE_13DBF6
	BRA.b CODE_13DBFB

CODE_13DBF6:
	LDA.w DATA_13DBE7,y
	BRA.b CODE_13DBFE

CODE_13DBFB:
	LDA.w #$0000
CODE_13DBFE:
	RTS

DATA_13DBFF:
	dw CODE_pipe_water_horiz_left_tile
	dw CODE_pipe_water_horiz_middle_tile
	dw CODE_pipe_water_horiz_right_tile

; NOTE: horiz/vert orientation inferred from tile-table indexing pattern;
;       MAY BE SWAPPED with the _vert_sub_dispatch sibling below. The
;       "_horiz_*" group indexes by $2C (row counter) which is more typical
;       of a vertical structure -- but could be a horizontal cross-section
;       through a 4-tall pipe. Verify via runtime trace before relying on
;       the horiz/vert designation. Affects CODE_pipe_water_horiz_*
;       (sub_dispatch + left/middle/right_tile) and CODE_pipe_water_vert_*.
CODE_13DC05:
CODE_pipe_water_horiz_sub_dispatch:
	LDA.b $2C
	ASL
	TAY
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_13DC19
	INX
	INX
	INC
	CMP.b $2A
	BNE.b CODE_13DC19
	INX
	INX
CODE_13DC19:
	JSR.w (DATA_13DBFF,x)
	TAY
	RTS

DATA_13DC1E:
	dw $3D2B,$7D1E,$7D1F,$9056

; NOTE: horiz/vert orientation may be swapped -- see _sub_dispatch above.
CODE_13DC26:
CODE_pipe_water_horiz_left_tile:
	LDA.w DATA_13DC1E,y
	RTS

DATA_13DC2A:
	dw $3D2C,$3D2D,$9052,$9053,$9054,$9055,$9057,$9058

; NOTE: horiz/vert orientation may be swapped -- see _sub_dispatch above.
CODE_13DC3A:
CODE_pipe_water_horiz_middle_tile:
	LDA.b $28
	AND.w #$0001
	STA.b $00
	LDA.b $2C
	ASL
	ORA.b $00
	ASL
	TAY
	LDA.w DATA_13DC2A,y
	RTS

DATA_13DC4C:
	dw $3D2E,$7D20,$7D21,$9059

; NOTE: horiz/vert orientation may be swapped -- see _sub_dispatch above.
CODE_13DC54:
CODE_pipe_water_horiz_right_tile:
	LDA.w DATA_13DC4C,y
	RTS

DATA_13DC58:
	dw $905A,$3D29,$7D1C,$9050

; NOTE: horiz/vert orientation may be swapped -- see _horiz_sub_dispatch above.
CODE_13DC60:
CODE_pipe_water_vert_sub_dispatch:
	LDY.w #$0000
	LDA.b $2C
	BEQ.b CODE_13DC74
	INY
	INC
	CMP.b $2E
	BEQ.b CODE_13DC74
	INY
	INC
	CMP.b $2E
	BEQ.b CODE_13DC74
	INY
CODE_13DC74:
	TYA
	ASL
	TAY
	LDA.w DATA_13DC58,y
	CLC
	ADC.b $28
	TAY
	RTS

DATA_13DC7F:
DATA_fence_corner_tiles:                                     ; 9-entry corner-tile lookup ($0000/$7780/$0000/$777E/$7C00/$777D/$0000/$7784/$0000) for CODE_stamp_fence_corner and CODE_stamp_fence_probing (objects $A7,$A8).
	dw $0000,$7780,$0000,$777E,$7C00,$777D,$0000,$7784
	dw $0000

CODE_13DC91:
CODE_stamp_fence_corner:                                     ; Bank13 cell stamp for objects $A7,$A8 variant 0 (corner-aware fence, $7780/$777E/$777D/$7784). Picks tile from DATA_13DC7F by 9-cell corner bucket. Post-process ORs $12 page when current cell is already a fence tile.
	REP.b #$30
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_13DCA3
	INX
	INX
	INC
	CMP.b $2A
	BNE.b CODE_13DCA3
	INX
	INX
CODE_13DCA3:
	STX.b $00
	LDX.w #$0000
	LDA.b $2C
	BEQ.b CODE_13DCB7
	LDX.w #$0006
	INC
	CMP.b $2E
	BNE.b CODE_13DCB7
	LDX.w #$000C
CODE_13DCB7:
	TXA
	CLC
	ADC.b $00
	STA.b $00
	TAY
	LDA.w DATA_13DC7F,y
	STA.b $04
	BEQ.b CODE_13DCF0
	CMP.w #$7C00
	BEQ.b CODE_13DCE8
	LDA.b $12
	BEQ.b CODE_13DCE8
	SEC
	SBC.w #$777C
	STA.b $02
	DEC
	CMP.w #$000F
	BCS.b CODE_13DCF0
	LDA.b $04
	SEC
	SBC.w #$777C
	ORA.b $02
	CLC
	ADC.w #$777C
	STA.b $04
CODE_13DCE8:
	LDX.b $1D
	LDA.b $04
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13DCF0:
	SEP.b #$30
	RTL

CODE_13DCF3:
CODE_stamp_fence_probing:                                     ; [decorator] Bank13 cell stamp for objects $A7,$A8 variant 1 (fence with neighbour probing). When $12==$7C00 calls CODE_fence_probing_neighbour_scan to probe 4 neighbours (get_map16_above/below + probe_left/right_tile) and derive connection-aware tile.
	REP.b #$30
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_13DD05
	INX
	INX
	INC
	CMP.b $2A
	BNE.b CODE_13DD05
	INX
	INX
CODE_13DD05:
	STX.b $00
	LDX.w #$0000
	LDA.b $2C
	BEQ.b CODE_13DD19
	LDX.w #$0006
	INC
	CMP.b $2E
	BNE.b CODE_13DD19
	LDX.w #$000C
CODE_13DD19:
	TXA
	CLC
	ADC.b $00
	STA.b $06
	TAY
	LDA.w DATA_13DC7F,y
	STA.b $04
	BEQ.b CODE_13DD64
	CMP.w #$7C00
	BNE.b CODE_fence_probing_connection_mask
	JSR.w CODE_fence_probing_neighbour_scan
	BRA.b CODE_fence_probing_load_result

CODE_13DD31:
CODE_fence_probing_connection_mask:
	LDA.b $12
	CMP.w #$7C00
	BEQ.b CODE_13DD64
	SEC
	SBC.w #$777C
	STA.b $02
	DEC
	CMP.w #$000F
	BCS.b CODE_13DD64
	LDA.b $04
	SEC
	SBC.w #$777C
	STA.b $04
	AND.b $02
	BEQ.b CODE_13DD64
	LDA.b $04
	EOR.b $02
	BEQ.b CODE_13DD5E
	CLC
	ADC.w #$777C
	STA.b $04
CODE_13DD5C:
CODE_fence_probing_load_result:
	LDA.b $04
CODE_13DD5E:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13DD64:
	SEP.b #$30
	RTL

CODE_13DD67:
CODE_fence_probing_neighbour_scan:
	STZ.b $04
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$7C00
	BNE.b CODE_13DD7F
	LDA.w #$0008
	STA.b $04
CODE_13DD7F:
	LDA.b $2C
	INC
	INC
	CMP.b $2E
	BNE.b CODE_13DD9D
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$7C00
	BNE.b CODE_13DD9D
	LDA.w #$0004
	TSB.b $04
CODE_13DD9D:
	JSR.w CODE_probe_left_tile
	CMP.w #$7C00
	BNE.b CODE_13DDAA
	LDA.w #$0001
	TSB.b $04
CODE_13DDAA:
	LDA.b $28
	INC
	INC
	CMP.b $2A
	BNE.b CODE_13DDBF
	JSR.w CODE_probe_right_tile
	CMP.w #$7C00
	BNE.b CODE_13DDBF
	LDA.w #$0002
	TSB.b $04
CODE_13DDBF:
	LDA.b $04
	BEQ.b CODE_13DDC9
	CLC
	ADC.w #$777C
	STA.b $04
CODE_13DDC9:
	RTS

CODE_13DDCA:
CODE_stamp_cliff_top:                                     ; Bank13 cell stamp for object $A9 non-water variant (cliff-top edge). If $12==0 (empty cell) stamps $0083; else checks $12 against $1C5C/$1C5E template sentinels and stamps level-aware $1C78 top-edge; else skips.
	REP.b #$30
	LDY.w #$0083
	LDA.b $12
	BEQ.b CODE_13DDE0
	LDY.w $1C78
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
	BEQ.b CODE_13DDE0
	CMP.w !RAM_YI_Level_TileTpl_FloorRow0_RightLo
	BNE.b CODE_13DDE7
CODE_13DDE0:
	LDX.b $1D
	TYA
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13DDE7:
	SEP.b #$30
	RTL

DATA_13DDEA:
	dw CODE_water_top_3state_top
	dw CODE_water_top_3state_mid
	dw CODE_water_top_3state_bot

CODE_13DDF0:
CODE_stamp_water_top_3state:                                     ; Bank13 cell stamp for object $A9 water-tileset variant (3-state water top). Dispatches via DATA_13DDEA into 3 sub-handlers (top CODE_water_top_3state_top / middle CODE_water_top_3state_mid / bottom CODE_water_top_3state_bot) keyed off $2C<4 / $2E-$2C boundary.
	REP.b #$30
	LDX.w #$0000
	LDA.b $2C
	BNE.b CODE_13DDFB
	STZ.b $A1
CODE_13DDFB:
	CMP.w #$0004
	BCC.b CODE_13DE0E
	INX
	INX
	LDA.b $2E
	CLC
	SBC.b $2C
	CMP.w #$0003
	BCS.b CODE_13DE0E
	INX
	INX
CODE_13DE0E:
	JSR.w (DATA_13DDEA,x)
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13DE1A:
	dw $3D2F,$7D22,$0110,$0112

CODE_13DE22:
CODE_water_top_3state_top:
	LDA.b $2C
	ASL
	TAY
	LDA.w DATA_13DE1A,y
	BRA.b CODE_13DE55

DATA_13DE2B:
	dw $3D31,$3D16,$3D33

CODE_13DE31:
CODE_water_top_3state_mid:
	LDA.b $A1
	INC
	CMP.w #$0003
	BCC.b CODE_13DE3C
	LDA.w #$0000
CODE_13DE3C:
	STA.b $A1
	ASL
	TAY
	LDA.w DATA_13DE2B,y
	BRA.b CODE_13DE55

DATA_13DE45:
	dw $0110,$7D22,$3D35

CODE_13DE4B:
CODE_water_top_3state_bot:
	LDA.b $2E
	CLC
	SBC.b $2C
	ASL
	TAY
	LDA.w DATA_13DE45,y
CODE_13DE55:
	CLC
	ADC.b $28
	RTS

DATA_13DE59:
DATA_wall_htop_tiles:                                     ; 4-entry corner tile table ($7915/$7916/$77A9/$77AA) for CODE_stamp_wall_htop (objects $AC,$AD orientation 0); 2x2 cell-position keyed.
	dw $7915,$7916,$77A9,$77AA

CODE_13DE61:
CODE_stamp_wall_htop:                                     ; Bank13 cell stamp for objects $AC,$AD orientation 0 (horizontal wall, top edge). For non-$0B tilesets escapes to CODE_12ABFF. For $0B reads DATA_13DE59 ($7915/$7916/$77A9/$77AA), through CODE_13E0F4 remap.
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CMP.b #$0B
	BEQ.b CODE_wall_htop_stamp_body
	JML.l CODE_12ABFF

CODE_13DE6C:
CODE_wall_htop_stamp_body:
	REP.b #$30
	LDY.w #$0000
	LDA.b $28
	CMP.w #$0002
	BCC.b CODE_13DE8B
	LDY.w #$0004
	INC
	STA.b $00
	LDA.b $2A
	SEC
	SBC.b $00
	CMP.w #$0002
	BCS.b CODE_13DE8B
	LDY.w #$0002
CODE_13DE8B:
	STY.b $02
	LDA.b $28
	AND.w #$0001
	ASL
	STA.b $00
	LDA.b $2C
	AND.w #$0001
	ASL
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_13DE59,y
	STA.b $00
	JSR.w CODE_13E0F4
	LDA.b $00
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13DEB0:
DATA_wall_hbottom_tiles:                                     ; 4-entry corner tile table ($77AF/$77B0/$7925/$7926) for CODE_stamp_wall_hbottom (objects $AC,$AD orientation 1); 2x2 cell-position keyed.
	dw $77AF,$77B0,$7925,$7926

CODE_13DEB8:
CODE_stamp_wall_hbottom:                                     ; Bank13 cell stamp for objects $AC,$AD orientation 1 (horizontal wall, bottom edge). Reads DATA_13DEB0 ($77AF/$77B0/$7925/$7926) by 2x2 cell position, routes through CODE_13E0F4 tile remap.
	REP.b #$30
	LDY.w #$0000
	LDA.b $28
	CMP.w #$0002
	BCC.b CODE_13DED7
	LDY.w #$0004
	INC
	STA.b $00
	LDA.b $2A
	SEC
	SBC.b $00
	CMP.w #$0002
	BCS.b CODE_13DED7
	LDY.w #$0002
CODE_13DED7:
	STY.b $02
	LDA.b $28
	AND.w #$0001
	ASL
	STA.b $00
	LDA.b $2C
	AND.w #$0001
	ASL
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_13DEB0,y
	STA.b $00
	JSR.w CODE_13E0F4
	LDA.b $00
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13DEFC:
DATA_wall_vleft_tiles:                                     ; 4-entry corner tile table ($790F/$7799/$791F/$779A) for CODE_stamp_wall_vleft (objects $AA,$AB orientation 0); 2x2 cell-position keyed.
	dw $790F,$7799,$791F,$779A

CODE_13DF04:
CODE_stamp_wall_vleft:                                     ; Bank13 cell stamp for objects $AA,$AB orientation 0 (vertical wall, left-facing). Reads DATA_13DEFC ($790F/$7799/$791F/$779A) by 2x2 cell position, routes through CODE_13E0F4 for tileset-aware tile remap.
	REP.b #$30
	LDY.w #$0000
	LDA.b $2C
	CMP.w #$0002
	BCC.b CODE_13DF23
	LDY.w #$0004
	INC
	STA.b $00
	LDA.b $2E
	SEC
	SBC.b $00
	CMP.w #$0002
	BCS.b CODE_13DF23
	LDY.w #$0002
CODE_13DF23:
	STY.b $02
	LDA.b $28
	AND.w #$0001
	ASL
	STA.b $00
	LDA.b $2C
	AND.w #$0001
	ASL
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_13DEFC,y
	STA.b $00
	JSR.w CODE_13E0F4
	LDA.b $00
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13DF48:
DATA_wall_vright_tiles:                                     ; 4-entry corner tile table ($779F/$7910/$77A0/$7920) for CODE_stamp_wall_vright (objects $AA,$AB orientation 1); 2x2 cell-position keyed.
	dw $779F,$7910,$77A0,$7920

CODE_13DF50:
CODE_stamp_wall_vright:                                     ; Bank13 cell stamp for objects $AA,$AB orientation 1 (vertical wall, right-facing). Same structure as vleft but reads DATA_13DF48 ($779F/$7910/$77A0/$7920) and routes through CODE_13E0F4 tile remap.
	REP.b #$30
	LDY.w #$0000
	LDA.b $2C
	CMP.w #$0002
	BCC.b CODE_13DF6F
	LDY.w #$0004
	INC
	STA.b $00
	LDA.b $2E
	SEC
	SBC.b $00
	CMP.w #$0002
	BCS.b CODE_13DF6F
	LDY.w #$0002
CODE_13DF6F:
	STY.b $02
	LDA.b $28
	AND.w #$0001
	ASL
	STA.b $00
	LDA.b $2C
	AND.w #$0001
	ASL
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_13DF48,y
	STA.b $00
	JSR.w CODE_13E0F4
	LDA.b $00
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13DF94:
	dw $7915,$7916,$7925,$7926,$790F,$791F,$7910,$7920
	dw $77A9,$77AA,$77AF,$77B0,$7799,$779A,$779F,$77A0

DATA_13DFB4:
	dw DATA_13DFD4,DATA_13DFD4,DATA_13DFE4,DATA_13DFE4,DATA_13DFD4,DATA_13DFD4,DATA_13DFE4,DATA_13DFE4

DATA_13DFC4:
	dw DATA_13DFF4,DATA_13E014,DATA_13E034,DATA_13E054,DATA_13E074,DATA_13E094,DATA_13E0B4,DATA_13E0D4

DATA_13DFD4:
	dw $790F,$791F,$7910,$7920,$7799,$779A,$779F,$77A0

DATA_13DFE4:
	dw $7915,$7916,$7925,$7926,$77A9,$77AA,$77AF,$77B0

DATA_13DFF4:
	dw $7931,$792C,$792C,$0000,$792B,$7931,$792B,$0000
	dw $792E,$0000,$0000,$0000,$0000,$792D,$0000,$0000

DATA_13E014:
	dw $7931,$791C,$791C,$0000,$791B,$7931,$791B,$0000
	dw $791E,$0000,$0000,$0000,$0000,$791D,$0000,$0000

DATA_13E034:
	dw $7931,$792C,$792C,$0000,$791C,$7931,$791C,$0000
	dw $792E,$0000,$0000,$0000,$0000,$791E,$0000,$0000

DATA_13E054:
	dw $7931,$792B,$792B,$0000,$791B,$7931,$791B,$0000
	dw $792D,$0000,$0000,$0000,$0000,$791D,$0000,$0000

DATA_13E074:
	dw $792E,$FFFF,$FFFF,$FFFF,$FFFF,$792D,$FFFF,$FFFF
	dw $5D09,$77B9,$77B9,$0000,$77CC,$5B0D,$77CC,$0000

DATA_13E094:
	dw $791E,$FFFF,$FFFF,$FFFF,$FFFF,$791D,$FFFF,$FFFF
	dw $0A2F,$77BB,$77BB,$0000,$77BA,$082D,$77BA,$0000

DATA_13E0B4:
	dw $792E,$FFFF,$FFFF,$FFFF,$FFFF,$791E,$FFFF,$FFFF
	dw $5D09,$77B9,$77B9,$0000,$77BB,$0A2F,$77BB,$0000

DATA_13E0D4:
	dw $792D,$FFFF,$FFFF,$FFFF,$FFFF,$791D,$FFFF,$FFFF
	dw $5B0D,$77CC,$77CC,$0000,$77BA,$082D,$77BA,$0000

CODE_13E0F4:
CODE_remap_tile_to_template:                                     ; Shared Bank13 helper for wall-stamp family ($AA-$AD). Matches written tile against DATA_13DF94, indexes DATA_13DFB4/13DFC4 for tileset-correct replacement based on $12 -- prevents wall-vs-terrain seams.
	LDA.b $12
	BEQ.b CODE_13E13D
	LDY.w #$001E
	LDA.b $00
CODE_13E0FD:
	CMP.w DATA_13DF94,y
	BEQ.b CODE_13E106
	DEY
	DEY
	BRA.b CODE_13E0FD

CODE_13E106:
	TYA
	LSR
	AND.w #$000E
	TAY
	LDA.w DATA_13DFB4,y
	STA.b $04
	LDA.w DATA_13DFC4,y
	STA.b $06
	LDY.w #$000E
	LDA.b $12
CODE_13E11B:
	CMP.b ($04),y
	BEQ.b CODE_13E125
	DEY
	DEY
	BPL.b CODE_13E11B
	BRA.b CODE_13E13D

CODE_13E125:
	TYA
	AND.w #$000C
	ASL
	ORA.b $02
	TAY
	LDA.b ($06),y
	CMP.w #$FFFF
	BEQ.b CODE_13E13D
	CMP.w #$0000
	BNE.b CODE_13E13B
	LDA.b $12
CODE_13E13B:
	STA.b $00
CODE_13E13D:
	LDX.b $1D
	RTS

DATA_13E140:
DATA_dec_2tile_vert_tiles:                                     ; 4-entry tile table ($779B/$779D/$779C/$779E) for CODE_stamp_dec_2tile_vert (objects $AE,$AF vertical orientation); 2x2 corner-position keyed.
	dw $779B,$779D,$779C,$779E

CODE_13E148:
CODE_stamp_dec_2tile_vert:                                     ; Bank13 cell stamp for object $AE,$AF vertical orientation (2-tile decoration). Reads DATA_13E140 ($779B/$779D/$779C/$779E) by 2x2 corner-tile pick from $77 grass/decoration set.
	REP.b #$30
	LDA.b $28
	AND.w #$0001
	ASL
	STA.b $00
	LDA.b $2C
	AND.w #$0001
	ASL
	ASL
	ORA.b $00
	TAY
	LDX.b $1D
	LDA.w DATA_13E140,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13E168:
DATA_dec_2tile_horiz_tiles:                                     ; 4-entry tile table ($77AB-$77AE) for CODE_stamp_dec_2tile_horiz (objects $AE,$AF horizontal orientation); 2x2 corner-position keyed.
	dw $77AB,$77AC,$77AD,$77AE

CODE_13E170:
CODE_stamp_dec_2tile_horiz:                                     ; Bank13 cell stamp for object $AE,$AF horizontal orientation (2-tile decoration). Reads DATA_13E168 ($77AB-$77AE) by 2x2 corner-tile pick -- different tile set than vertical sibling.
	REP.b #$30
	LDA.b $28
	AND.w #$0001
	ASL
	STA.b $00
	LDA.b $2C
	AND.w #$0001
	ASL
	ASL
	ORA.b $00
	TAY
	LDX.b $1D
	LDA.w DATA_13E168,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13E190:
DATA_dec_corner_4x4_tiles:                                     ; 16-entry tile table for CODE_stamp_dec_corner_4x4 (object $B0): $77AB/$77AC/$77CE/$779B-$779E corner+edge variants for the 4x4 cell grid.
	dw $77AB,$77AB,$77AC,$77CE,$779B,$779D,$779E,$779D
	dw $779C,$77AD,$77AE,$77AD,$77CE,$779D,$779E,$779D

CODE_13E1B0:
CODE_stamp_dec_corner_4x4:                                     ; Bank13 cell stamp for object $B0 (corner-aware 4x4 decoration). 5-bucket index from $28 (0/2/4/6) + $2C (0/8/16/24), reads 16-entry DATA_13E190. Skips stamp when $12 already non-zero (preserves existing terrain).
	REP.b #$30
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_13E1CC
	LDY.w #$0006
	INC
	CMP.b $2A
	BEQ.b CODE_13E1CC
	LDA.b $28
	AND.w #$0001
	ASL
	CLC
	ADC.w #$0002
	TAY
CODE_13E1CC:
	STY.b $00
	LDY.w #$0000
	LDA.b $2C
	BEQ.b CODE_13E1EA
	LDY.w #$0018
	INC
	CMP.b $2E
	BEQ.b CODE_13E1EA
	LDA.b $2C
	AND.w #$0001
	ASL
	ASL
	ASL
	CLC
	ADC.w #$0008
	TAY
CODE_13E1EA:
	TYA
	ORA.b $00
	TAY
CODE_13E1EE:
	LDA.b $12
	BNE.b CODE_13E1FB
	LDX.b $1D
	LDA.w DATA_13E190,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13E1FB:
	SEP.b #$30
	RTL

DATA_13E1FE:
DATA_dec_remap_source_tiles:                                     ; 12-entry table ($77B9-$854E) of source-tile patterns for CODE_stamp_dec_tile_remap (object $B1) to match $12 against.
	dw $77B9,$77BB,$77C9,$77CC,$8100,$8101,$8102,$8103
	dw $854B,$854C,$854D,$854E

DATA_13E216:
DATA_dec_remap_target_tiles:                                     ; 12-entry table ($1519/$1517/$151C/$151D variants) paired with DATA_13E1FE -- the replacement tiles written when a match is found.
	dw $1519,$1519,$1519,$1519,$1517,$1517,$1517,$1517
	dw $151C,$151D,$151D,$151D

DATA_13E22E:
DATA_dec_remap_default_tiles:                                     ; 12-entry default tile table ($1513-$1518) used by CODE_stamp_dec_tile_remap when $12 is in the lower $7799-$77B8 grass range.
	dw $1513,$1514,$1515,$1516,$0000,$0000,$0000,$0000
	dw $1513,$1514,$1518,$1516

CODE_13E246:
CODE_stamp_dec_tile_remap:                                     ; Bank13 cell stamp for object $B1 (current-tile-aware remap). For $12 >= $77B9 scans DATA_13E1FE for match and stamps DATA_13E216 replacement; else treats $12 as offset into $7799 base and reads DATA_13E22E ($1513-$1518).
	REP.b #$30
	LDA.b $12
CODE_13E24A:
	CMP.w #$77B9
	BCC.b CODE_13E265
	LDY.w #$0000
CODE_13E252:
	CMP.w DATA_13E1FE,y
	BEQ.b CODE_13E260
	INY
	INY
	CPY.w #$0018
	BCC.b CODE_13E252
	BRA.b CODE_13E276

CODE_13E260:
	LDA.w DATA_13E216,y
	BRA.b CODE_13E270

CODE_13E265:
	SEC
	SBC.w #$7799
	AND.w #$000E
	TAY
CODE_13E26D:
	LDA.w DATA_13E22E,y
CODE_13E270:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13E276:
	SEP.b #$30
	RTL

DATA_13E279:
DATA_diagonal_sewage_pipe_ceiling_tiles:                                     ; 4-entry tile table ($792E/$5D09/$77B9/$77AB) for CODE_stamp_diagonal_sewage_pipe_ceiling (ceiling edge of $B2 3-row + $B4 4-row, orientation A); $2C-row keyed.
	dw $792E,$5D09,$77B9,$77AB

CODE_13E281:
CODE_stamp_diagonal_sewage_pipe_ceiling:                                     ; Bank13 cell stamp: diagonal-sewage-pipe ceiling edge, orientation A (shared by $B2 3-row + $B4 4-row; $15 bit 0 = 0). Reads DATA_13E279 ($792E/$5D09/$77B9/$77AB) by $2C row-position when $12==0; always sets $9B=$FFFF slope-continuation sentinel.
	REP.b #$30
	LDA.b $2C
	ASL
	TAY
	LDA.b $12
	BNE.b CODE_13E294
	LDX.b $1D
	LDA.w DATA_13E279,y
CODE_13E290:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13E294:
	LDA.w #$FFFF
	STA.b $9B
	SEP.b #$30
	RTL

DATA_13E29C:
DATA_diagonal_sewage_pipe_3row_floor_tiles:                                     ; 3-entry tile table ($77BA/$082D/$791D) for CODE_stamp_diagonal_sewage_pipe_3row_floor (floor edge of $B3, orientation A, 3-row); $2C-row keyed.
	dw $77BA,$082D,$791D

CODE_13E2A2:
CODE_stamp_diagonal_sewage_pipe_3row_floor:                                     ; Bank13 cell stamp: diagonal-sewage-pipe floor edge, orientation A, 3-row ($B3; $15 bit 0 = 1). Reads DATA_13E29C ($77BA/$082D/$791D) by $2C row-position when $12==0; sets $9B=$FFFF slope continuation sentinel.
	REP.b #$30
	LDA.b $2C
	ASL
	TAY
	LDA.b $12
	BNE.b CODE_13E2B5
	LDX.b $1D
	LDA.w DATA_13E29C,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13E2B5:
	LDA.w #$FFFF
	STA.b $9B
	SEP.b #$30
	RTL

DATA_13E2BD:
DATA_diagonal_sewage_pipe_4row_floor_tiles:                                     ; 4-entry tile table ($77AE/$77BA/$082D/$791D) for CODE_stamp_diagonal_sewage_pipe_4row_floor (floor edge of $B5, orientation A, 4-row = $B3's table + leading $77AE); $2C-row keyed.
	dw $77AE,$77BA,$082D,$791D

CODE_13E2C5:
CODE_stamp_diagonal_sewage_pipe_4row_floor:                                     ; Bank13 cell stamp: diagonal-sewage-pipe floor edge, orientation A, 4-row ($B5; $15 bit 0 = 1). Reads DATA_13E2BD ($77AE/$77BA/$082D/$791D) by $2C when $12==0; sets $9B=$FFFF.
	REP.b #$30
	LDA.b $2C
	ASL
	TAY
	LDA.b $12
	BNE.b CODE_13E2D8
	LDX.b $1D
	LDA.w DATA_13E2BD,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13E2D8:
	LDA.w #$FFFF
	STA.b $9B
	SEP.b #$30
	RTL

DATA_13E2E0:
DATA_diagonal_sewage_pipe_alt_ceiling_tiles:                                     ; 4 tile IDs ($792D,$5B0C,$77C9,$77AC) consumed by CODE_stamp_diagonal_sewage_pipe_alt_ceiling (ceiling edge of $B6 3-row + $B8 4-row, orientation B) by column index $2C.
	dw $792D,$5B0C,$77C9,$77AC

CODE_13E2E8:
CODE_stamp_diagonal_sewage_pipe_alt_ceiling:                                     ; [decorator] Bank13 cell-stamp: diagonal-sewage-pipe ceiling edge, orientation B (shared by $B6 3-row + $B8 4-row; $15 bit 0 = 0). 4-entry DATA_13E2E0 tile lookup keyed by $2C (col), with map16-below probing to swap $5B0C->$5B0D when sitting atop $779F/$77A0 (ceiling blends with terrain below).
	REP.b #$30
	LDA.b $2C
	ASL
	TAY
	LDA.b $12
	BNE.b CODE_13E31F
	LDA.w DATA_13E2E0,y
	STA.b $02
	CMP.w #$5B0C
	BNE.b CODE_13E317
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$779F
	BEQ.b CODE_13E312
	CMP.w #$77A0
	BNE.b CODE_13E317
CODE_13E312:
	LDA.w #$5B0D
	STA.b $02
CODE_13E317:
	LDX.b $1D
	LDA.b $02
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13E31F:
	LDA.w #$FFFF
	STA.b $9B
	SEP.b #$30
	RTL

DATA_13E327:
DATA_diagonal_sewage_pipe_3row_alt_floor_tiles:                                     ; 3-entry tile table ($77CA/$0A2E/$791E) for CODE_stamp_diagonal_sewage_pipe_3row_alt_floor (floor edge of $B7, orientation B, 3-row); $0A2E swaps to $0A2F when above is a $7799/$779A floor.
	dw $77CA,$0A2E,$791E

CODE_13E32D:
CODE_stamp_diagonal_sewage_pipe_3row_alt_floor:                                     ; [decorator] Bank13 cell stamp: diagonal-sewage-pipe floor edge, orientation B, 3-row ($B7; $15 bit 0 = 1). Reads DATA_13E327 ($77CA/$0A2E/$791E) by $2C; when picked tile==$0A2E probes get_map16_above and swaps to $0A2F if neighbour is $7799/$779A (floor blends with terrain above). Sets $9B=$FFFF.
	REP.b #$30
	LDA.b $2C
	ASL
	TAY
	LDA.b $12
	BNE.b CODE_13E364
	LDA.w DATA_13E327,y
	STA.b $02
	CMP.w #$0A2E
	BNE.b CODE_13E35C
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$7799
	BEQ.b CODE_13E357
	CMP.w #$779A
	BNE.b CODE_13E35C
CODE_13E357:
	LDA.w #$0A2F
	STA.b $02
CODE_13E35C:
	LDX.b $1D
	LDA.b $02
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13E364:
	LDA.w #$FFFF
	STA.b $9B
	SEP.b #$30
	RTL

DATA_13E36C:
DATA_diagonal_sewage_pipe_4row_alt_floor_tiles:                                     ; 4-entry tile table ($77AD/$77CA/$0A2E/$791E) for CODE_stamp_diagonal_sewage_pipe_4row_alt_floor (floor edge of $B9, orientation B, 4-row = $B7's table + leading $77AD); same $0A2E -> $0A2F continuation as the 3-row sibling.
	dw $77AD,$77CA,$0A2E,$791E

CODE_13E374:
CODE_stamp_diagonal_sewage_pipe_4row_alt_floor:                                     ; [decorator] Bank13 cell stamp: diagonal-sewage-pipe floor edge, orientation B, 4-row ($B9; $15 bit 0 = 1). Reads DATA_13E36C ($77AD/$77CA/$0A2E/$791E); same $0A2E -> $0A2F continuation probe as the 3-row sibling ($B7). Sets $9B=$FFFF.
	REP.b #$30
	LDA.b $2C
	ASL
	TAY
	LDA.b $12
	BNE.b CODE_13E3AB
	LDA.w DATA_13E36C,y
	STA.b $02
	CMP.w #$0A2E
	BNE.b CODE_13E3A3
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$7799
	BEQ.b CODE_13E39E
	CMP.w #$779A
	BNE.b CODE_13E3A3
CODE_13E39E:
	LDA.w #$0A2F
	STA.b $02
CODE_13E3A3:
	LDX.b $1D
	LDA.b $02
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13E3AB:
	LDA.w #$FFFF
	STA.b $9B
	SEP.b #$30
	RTL

DATA_13E3B3:
DATA_edge_top_4tiles:                                     ; 4 tile IDs ($792F,$7915,$7916,$7930) for CODE_stamp_pipe_entrance_top_left (top-edge row with end-caps).
	dw $792F,$7915,$7916,$7930

CODE_13E3BB:
CODE_stamp_pipe_entrance_top_left:                                     ; Bank13 stamp for pipe-entrance family, horizontal variant 0; uses $28 col-pos to pick from DATA_13E3B3 (4 tiles $792F,$7915,$7916,$7930): leftmost / interior-even / interior-odd / rightmost.
	REP.b #$30
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_13E3D6
	LDY.w #$0006
	INC
	CMP.b $2A
	BEQ.b CODE_13E3D6
	DEC
	AND.w #$0001
	ASL
	CLC
	ADC.w #$0002
	TAY
CODE_13E3D6:
	LDX.b $1D
	LDA.w DATA_13E3B3,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13E3E2:
DATA_edge_top_alt_4tiles:                                     ; 4 tile IDs ($7932,$7925,$7926,$7933) for CODE_stamp_pipe_entrance_top_right; mirrored counterpart to DATA_13E3B3.
	dw $7932,$7925,$7926,$7933

CODE_13E3EA:
CODE_stamp_pipe_entrance_top_right:                                     ; Bank13 stamp for pipe-entrance family, horizontal variant 1; same shape as $13E3BA but uses DATA_13E3E2 ($7932,$7925,$7926,$7933) - mirrored/alternate tile set.
	REP.b #$30
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_13E405
	LDY.w #$0006
	INC
	CMP.b $2A
	BEQ.b CODE_13E405
	DEC
	AND.w #$0001
	ASL
	CLC
	ADC.w #$0002
	TAY
CODE_13E405:
	LDX.b $1D
	LDA.w DATA_13E3E2,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13E411:
DATA_edge_vertical_left_4tiles:                                     ; 4 tile IDs ($792F,$790F,$791F,$7932) for CODE_stamp_pipe_entrance_vertical_left; row-indexed end-cap / interior-A / interior-B / end-cap.
	dw $792F,$790F,$791F,$7932

CODE_13E419:
CODE_stamp_pipe_entrance_vertical_left:                                     ; Bank13 stamp for pipe-entrance family, vertical variant 2; uses $2C row-pos to pick from DATA_13E411 (4 tiles $792F,$790F,$791F,$7932): top-cap / interior-A / interior-B / bottom-cap.
	REP.b #$30
	LDY.w #$0000
	LDA.b $2C
	BEQ.b CODE_13E434
	LDY.w #$0006
	INC
	CMP.b $2E
	BEQ.b CODE_13E434
	DEC
	AND.w #$0001
	ASL
	CLC
	ADC.w #$0002
	TAY
CODE_13E434:
	LDX.b $1D
	LDA.w DATA_13E411,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13E440:
DATA_edge_vertical_right_4tiles:                                     ; 4 tile IDs ($7930,$7910,$7920,$7933) for CODE_stamp_pipe_entrance_vertical_right; mirror of DATA_13E411 (right-side vertical edge).
	dw $7930,$7910,$7920,$7933

CODE_13E448:
CODE_stamp_pipe_entrance_vertical_right:                                     ; Bank13 stamp for pipe-entrance family, vertical variant 3; mirror of CODE_stamp_pipe_entrance_vertical_left using DATA_13E440 ($7930,$7910,$7920,$7933).
	REP.b #$30
	LDY.w #$0000
	LDA.b $2C
	BEQ.b CODE_13E463
	LDY.w #$0006
	INC
	CMP.b $2E
	BEQ.b CODE_13E463
	DEC
	AND.w #$0001
	ASL
	CLC
	ADC.w #$0002
	TAY
CODE_13E463:
	LDX.b $1D
	LDA.w DATA_13E440,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13E46F:
DATA_terrain_anchor_45tiles:                                     ; 45-entry anchor tile table ($7799-$77BE plus $77C9-$77CC plus $854B-$854E) used by terrain stamps as a "is the current tile a known terrain piece" lookup.
	dw $7799,$779A,$779B,$779C,$779D,$779E,$779F,$77A0
	dw $77A1,$77A2,$77A3,$77A4,$77A5,$77A6,$77A7,$77A8
	dw $77A9,$77AA,$77AB,$77AC,$77AD,$77AE,$77AF,$77B0
	dw $77B1,$77B2,$77B3,$77B4,$77B5,$77B6,$77B7,$77B8
	dw $77B9,$77BA,$77BB,$77BE,$77C9,$77CA,$77CC,$77CE
	dw $854B,$854C,$854D,$854E

DATA_13E4C7:
DATA_terrain_replacement_45tiles:                                     ; 45-entry replacement table parallel to DATA_terrain_anchor_45tiles; gives the substituted tile when current tile matches anchor at same index.
	dw $77CF,$77CF,$77CF,$77CF,$77C8,$77C8,$77C8,$77C8
	dw $77CF,$77CF,$77C8,$77C8,$77CF,$77CF,$77C8,$77C8
	dw $77CF,$77CF,$77CF,$77CF,$77C8,$77C8,$77C8,$77C8
	dw $77CF,$77CF,$77C8,$77C8,$77CF,$77CF,$77C8,$77C8
	dw $77CF,$77C8,$77CF,$77CF,$77CF,$77C8,$77CF,$77CF
	dw $854F,$854F,$854F,$854F

DATA_13E51F:
DATA_terrain_secondary_anchor_24tiles:                                     ; 24-entry secondary anchor table ($7925-$792A plus randomized-decor + slope tiles) used by complex-terrain stamps.
	dw $7925,$7926,$7927,$7928,$7929,$792A,$791B,$791C
	dw $7962,$7963,$7966,$7968,$7969,$796A,$796D,$796F
	dw $7978,$7979,$797C,$797D,$7936,$7937,$7939,$793B

DATA_13E54F:
DATA_terrain_secondary_replacement_20tiles:                                     ; 20-entry replacement table aligned with DATA_terrain_secondary_anchor_24tiles ($7805-$7818 series).
	dw $7805,$7806,$7807,$7808,$7809,$780A,$780B,$780C
	dw $780D,$780E,$780F,$7810,$7811,$7812,$7813,$7814
	dw $7815,$7816,$7817,$7818

DATA_13E577:
DATA_terrain_door_anchor_6tiles:                                     ; 6-entry door-template anchor table ($1513-$1519); when current tile matches, stamps door-cap tile $1517.
	dw $1513,$1514,$1515,$1516,$1518,$1519

CODE_13E583:
CODE_stamp_terrain_lookup_left:                                     ; Bank13 stamp variant 0; multi-branch (left-edge / right-edge / interior / single-cell) using DATA_13E46F 45-tile anchor + DATA_13E51F/DATA_13E5F5 satellite tables to remap for cohesive borders.
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_13E59E
	LDY.w #$0056
	LDA.b $12
CODE_13E58E:
	CMP.w DATA_13E46F,y
	BEQ.b CODE_13E599
	DEY
	DEY
	BPL.b CODE_13E58E
	BRA.b CODE_13E5F2

CODE_13E599:
	LDA.w DATA_13E4C7,y
	BRA.b CODE_13E5EC

CODE_13E59E:
	INC
	INC
	CMP.b $2E
	BNE.b CODE_13E5BC
	LDY.w #$001A
	LDA.b $12
CODE_13E5A9:
	CMP.w DATA_13E5F5,y
	BEQ.b CODE_13E5B7
	DEY
	DEY
	BPL.b CODE_13E5A9
	LDA.w #$8103
	BRA.b CODE_13E5EC

CODE_13E5B7:
	LDA.w DATA_13E611,y
	BRA.b CODE_13E5EC

CODE_13E5BC:
	DEC
	CMP.b $2E
	BNE.b CODE_13E5D6
	LDY.w #$002E
	LDA.b $12
CODE_13E5C6:
	CMP.w DATA_13E51F,y
	BEQ.b CODE_13E5D1
	DEY
	DEY
	BPL.b CODE_13E5C6
	BRA.b CODE_13E5F2

CODE_13E5D1:
	LDA.w DATA_13E54F,y
	BRA.b CODE_13E5EC

CODE_13E5D6:
	LDY.w #$000A
	LDA.b $12
CODE_13E5DB:
	CMP.w DATA_13E577,y
	BEQ.b CODE_13E5E9
	DEY
	DEY
	BPL.b CODE_13E5DB
	LDA.w #$8101
	BRA.b CODE_13E5EC

CODE_13E5E9:
	LDA.w #$1517
CODE_13E5EC:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13E5F2:
	SEP.b #$30
	RTL

DATA_13E5F5:
DATA_terrain_extra_anchor:                                     ; 14-entry extra anchor table ($7925-$792A + $082D/$082E + $0A2D-$0A30) for CODE_stamp_terrain_lookup_right right-side variant.
	dw $7925,$7926,$7927,$7928,$7929,$792A,$791B,$791C
	dw $082D,$082E,$0A2D,$0A2E,$0A2F,$0A30

DATA_13E611:
DATA_terrain_extra_replacement:                                     ; 14-entry replacement table ($7805-$780C + $7F01 + $8001) parallel to DATA_13E5F5; provides output tile when anchor matches.
	dw $7805,$7806,$7807,$7808,$7809,$780A,$780B,$780C
	dw $7F01,$7F01,$8001,$8001,$8001,$8001

CODE_13E62D:
CODE_stamp_terrain_lookup_right:                                     ; Bank13 stamp for complex-terrain variant 1; like CODE_stamp_terrain_lookup_left but with right-side orientation and DATA_13E6E8/$13E702 satellite remap tables.
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_terrain_lookup_right_nonleft_dispatch
	LDY.w #$77BF
	LDA.b $12
	CMP.w #$77BA
	BEQ.b CODE_terrain_lookup_right_trampoline
	LDY.w #$77C0
	AND.w #$FF00
	CMP.w #$8500
	BNE.b CODE_terrain_lookup_right_trampoline
	JMP.w CODE_terrain_lookup_right_exit_only

CODE_13E64B:
CODE_terrain_lookup_right_trampoline:
	JMP.w CODE_terrain_lookup_right_store_exit

CODE_13E64E:
CODE_terrain_lookup_right_nonleft_dispatch:
	CMP.w #$0001
	BNE.b CODE_13E674
	LDY.w #$8100
	LDA.b $12
	CMP.w #$779F
	BEQ.b CODE_terrain_lookup_right_trampoline
	CMP.w #$77A0
	BEQ.b CODE_terrain_lookup_right_store_exit
	LDY.w #$1517
	CMP.w #$1513
	BEQ.b CODE_terrain_lookup_right_store_exit
	CMP.w #$1516
	BEQ.b CODE_terrain_lookup_right_store_exit
	LDY.w #$8102
	BRA.b CODE_terrain_lookup_right_store_exit

CODE_13E674:
	INC
	CMP.b $2E
	BNE.b CODE_13E6A1
	LDY.w #$001A
	LDA.b $12
CODE_13E67E:
	CMP.w DATA_13E5F5,y
	BEQ.b CODE_13E69B
	DEY
	DEY
	BPL.b CODE_13E67E
	LDY.w #$002E
CODE_13E68A:
	CMP.w DATA_13E51F,y
	BEQ.b CODE_13E695
	DEY
	DEY
	BPL.b CODE_13E68A
	BRA.b CODE_13E6D6

CODE_13E695:
	LDA.w DATA_13E54F,y
	TAY
	BRA.b CODE_terrain_lookup_right_store_exit

CODE_13E69B:
	LDA.w DATA_13E611,y
	TAY
	BRA.b CODE_terrain_lookup_right_store_exit

CODE_13E6A1:
	INC
	CMP.b $2E
	BNE.b CODE_13E6C8
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDY.w #$002E
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13E6B5:
	CMP.w DATA_13E51F,y
	BEQ.b CODE_13E6C3
	DEY
	DEY
	BPL.b CODE_13E6B5
	LDY.w #$8101
	BRA.b CODE_terrain_lookup_right_store_exit

CODE_13E6C3:
	LDY.w #$8103
	BRA.b CODE_terrain_lookup_right_store_exit

CODE_13E6C8:
	LDY.w #$000A
	LDA.b $12
CODE_13E6CD:
	CMP.w DATA_13E577,y
	BEQ.b CODE_13E6DB
	DEY
	DEY
	BPL.b CODE_13E6CD
CODE_13E6D6:
	LDY.w #$8101
	BRA.b CODE_terrain_lookup_right_store_exit

CODE_13E6DB:
	LDY.w #$1517
CODE_13E6DE:
CODE_terrain_lookup_right_store_exit:
	LDX.b $1D
	TYA
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13E6E5:
CODE_terrain_lookup_right_exit_only:
	SEP.b #$30
	RTL

DATA_13E6E8:
DATA_corner_left_anchor_13tiles:                                     ; 13-entry anchor for corner-left stamp; covers terrain-edge tiles + door tiles + $854x family.
	dw $77AF,$77B0,$77B4,$77B8,$77C6,$77C7,$082D,$0A2E
	dw $0A2F,$854B,$854C,$854D,$854E

DATA_13E702:
DATA_corner_left_replacement_13tiles:                                     ; 13-entry replacement parallel to DATA_corner_left_anchor_13tiles; output tiles ($77C2/$77C3/...).
	dw $77C2,$77C3,$77D2,$77D3,$77D6,$77D7,$082E,$0A2D
	dw $0A30,$855A,$855B,$855C,$855D

DATA_13E71C:
DATA_corner_top_24tiles:                                     ; 24-entry $82xx-family tile table used by CODE_stamp_corner_left_with_probe row-2 path.
	dw $8200,$8201,$8202,$8203,$8204,$8205,$8206,$8207
	dw $8208,$8209,$820A,$820B,$820C,$820D,$820E,$820F
	dw $8210,$8211,$8212,$8213,$8215,$8215,$8214,$8214

CODE_13E74C:
CODE_stamp_corner_left_with_probe:                                     ; Bank13 stamp for height-2 terrain variant 0; uses CODE_probe_left_tile + $854B-base offset to pick left-corner tile from DATA_13E6E8/$13E702 anchor/replacement pair; falls back to $77EB if no match.
	REP.b #$30
	LDX.b $1D
	LDA.b $2C
	BNE.b CODE_13E7B7
	LDA.b $12
	CMP.w #$854A
	BNE.b CODE_13E760
	LDA.w #$8550
	BRA.b CODE_13E7CA

CODE_13E760:
	LDA.b $28
	BNE.b CODE_13E784
	JSR.w CODE_probe_left_tile
	LDX.b $1D
	CMP.w #$8101
	BNE.b CODE_13E7A2
	LDA.b $12
	SEC
	SBC.w #$854B
	CMP.w #$0004
	BCS.b CODE_13E77F
	CLC
	ADC.w #$8556
	BRA.b CODE_13E7CA

CODE_13E77F:
	LDA.w #$77EB
	BRA.b CODE_13E7CA

CODE_13E784:
	JSR.w CODE_probe_right_tile
	CMP.w #$8101
	BNE.b CODE_13E7A2
	LDA.b $12
	SEC
	SBC.w #$854B
	CMP.w #$0004
	BCS.b CODE_13E79D
	CLC
	ADC.w #$856A
	BRA.b CODE_13E7CA

CODE_13E79D:
	LDA.w #$77D0
	BRA.b CODE_13E7CA

CODE_13E7A2:
	LDY.w #$0018
	LDA.b $12
CODE_13E7A7:
	CMP.w DATA_13E6E8,y
	BEQ.b CODE_13E7B2
	DEY
	DEY
	BPL.b CODE_13E7A7
	BRA.b CODE_13E7D0

CODE_13E7B2:
	LDA.w DATA_13E702,y
	BRA.b CODE_13E7CA

CODE_13E7B7:
	LDY.w #$002E
	LDA.b $12
CODE_13E7BC:
	CMP.w DATA_13E51F,y
	BEQ.b CODE_13E7C7
	DEY
	DEY
	BPL.b CODE_13E7BC
	BRA.b CODE_13E7D0

CODE_13E7C7:
	LDA.w DATA_13E71C,y
CODE_13E7CA:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13E7D0:
	SEP.b #$30
	RTL

DATA_13E7D3:
DATA_corner_right_replacement_13tiles:                                     ; 13-entry replacement table ($77C4/$77C5/$77D5/$77D4/$77D6/$77D7/$082E/$0A2D/$0A30/$855E-$8561) parallel to DATA_13E6E8 for CODE_stamp_corner_right_with_probe.
	dw $77C4,$77C5,$77D5,$77D4,$77D6,$77D7,$082E,$0A2D
	dw $0A30,$855E,$855F,$8560,$8561

DATA_13E7ED:
DATA_corner_top_alt_24tiles:                                     ; 24-entry $83xx-family tile table used by CODE_stamp_corner_right_with_probe row-2 path.
	dw $8300,$8301,$8302,$8303,$8304,$8305,$8306,$8307
	dw $8308,$8309,$830A,$830B,$830C,$830D,$830E,$830F
	dw $8310,$8311,$8312,$8313,$8315,$8315,$8314,$8314

CODE_13E81D:
CODE_stamp_corner_right_with_probe:                                     ; Bank13 stamp for height-2 terrain variant 1; mirror of CODE_stamp_corner_left_with_probe using CODE_probe_right_tile and DATA_13E7D3 right-side replacement table; falls back to $77D0 / $77D1.
	REP.b #$30
	LDX.b $1D
	LDA.b $2C
	BNE.b CODE_13E886
	LDA.b $12
	CMP.w #$8546
	BNE.b CODE_13E831
	LDA.w #$8551
	BRA.b CODE_13E899

CODE_13E831:
	LDA.b $28
	BNE.b CODE_13E853
	JSR.w CODE_probe_left_tile
	CMP.w #$8101
	BNE.b CODE_13E871
	LDA.b $12
	SEC
	SBC.w #$854B
	CMP.w #$0004
	BCS.b CODE_13E84E
	CLC
	ADC.w #$856E
	BRA.b CODE_13E899

CODE_13E84E:
	LDA.w #$77D1
	BRA.b CODE_13E899

CODE_13E853:
	JSR.w CODE_probe_right_tile
	CMP.w #$8101
	BNE.b CODE_13E871
	LDA.b $12
	SEC
	SBC.w #$854B
	CMP.w #$0004
	BCS.b CODE_13E86C
	CLC
	ADC.w #$8552
	BRA.b CODE_13E899

CODE_13E86C:
	LDA.w #$77D0
	BRA.b CODE_13E899

CODE_13E871:
	LDY.w #$0018
	LDA.b $12
CODE_13E876:
	CMP.w DATA_13E6E8,y
	BEQ.b CODE_13E881
	DEY
	DEY
	BPL.b CODE_13E876
	BRA.b CODE_13E89F

CODE_13E881:
	LDA.w DATA_13E7D3,y
	BRA.b CODE_13E899

CODE_13E886:
	LDY.w #$002E
	LDA.b $12
CODE_13E88B:
	CMP.w DATA_13E51F,y
	BEQ.b CODE_13E896
	DEY
	DEY
	BPL.b CODE_13E88B
	BRA.b CODE_13E89F

CODE_13E896:
	LDA.w DATA_13E7ED,y
CODE_13E899:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13E89F:
	SEP.b #$30
	RTL

DATA_13E8A2:
DATA_top_cap_2tile_anchor:                                     ; 2-entry door-mat tile anchor ($082D,$082E) used by CODE_stamp_top_cap_2tile to detect existing terrain at the stamp location.
	dw $082D,$082E

CODE_13E8A6:
CODE_stamp_top_cap_2tile:                                     ; Bank13 stamp for height-2 terrain variant 2; height-1 cap using DATA_13E8A2 ($082D,$082E) for top-row, $77BF default otherwise; sets $9B=$FFFF (single-row mode).
	REP.b #$30
	LDY.w #$77BF
	LDA.b $2C
	BEQ.b CODE_13E8C2
	LDY.w #$0002
	LDA.b $12
CODE_13E8B4:
	CMP.w DATA_13E8A2,y
	BEQ.b CODE_13E8BF
	DEY
	DEY
	BPL.b CODE_13E8B4
	BRA.b CODE_13E8C9

CODE_13E8BF:
	LDY.w #$7F00
CODE_13E8C2:
	LDX.b $1D
	TYA
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13E8C9:
	LDA.w #$FFFF
	STA.b $9B
	SEP.b #$30
	RTL

DATA_13E8D1:
DATA_top_cap_4tile_anchor:                                     ; 4-entry door-mat tile anchor ($0A2D,$0A2E,$0A2F,$0A30) used by CODE_stamp_top_cap_4tile to detect existing terrain.
	dw $0A2D,$0A2E,$0A2F,$0A30

CODE_13E8D9:
CODE_stamp_top_cap_4tile:                                     ; Bank13 stamp for height-2 terrain variant 3; like CODE_stamp_top_cap_2tile with wider DATA_13E8D1 4-entry table ($0A2D-$0A30) and $77C0 default.
	REP.b #$30
	LDY.w #$77C0
	LDA.b $2C
	BEQ.b CODE_13E8F5
	LDY.w #$0006
	LDA.b $12
CODE_13E8E7:
	CMP.w DATA_13E8D1,y
	BEQ.b CODE_13E8F2
	DEY
	DEY
	BPL.b CODE_13E8E7
	BRA.b CODE_13E8FC

CODE_13E8F2:
	LDY.w #$8000
CODE_13E8F5:
	LDX.b $1D
	TYA
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13E8FC:
	LDA.w #$FFFF
	STA.b $9B
	SEP.b #$30
	RTL

CODE_13E904:
CODE_stamp_coin_col_aligned:                                     ; Bank13 pole stamp variant 0; gates on $28&1 (column parity), then calls CODE_item_memory_bit_lookup grid-check + DATA_13C6C5 to pick a fence-post tile only on aligned cells.
	REP.b #$30
	LDA.b $28
	AND.w #$0001
	BEQ.b CODE_13E92A
	BRA.b CODE_stamp_pole_skip_exit

CODE_13E90F:
CODE_stamp_coin_row_aligned:                                     ; Bank13 pole stamp variant 1; gates on $2C&1 (row parity), same fence-post grid logic as CODE_stamp_coin_col_aligned.
	REP.b #$30
	LDA.b $2C
	AND.w #$0001
	BEQ.b CODE_13E92A
	BRA.b CODE_stamp_pole_skip_exit

CODE_13E91A:
CODE_stamp_coin_with_single_row:                                     ; Bank13 pole stamp variant 2; sets $9B=$FFFF (single-row mode) then gates on $28&1 + grid check; used for short single-row pole/fence segments.
	REP.b #$30
	LDA.w #$FFFF
	STA.b $9B
	LDA.b $28
	AND.w #$0001
	BEQ.b CODE_13E92A
	BRA.b CODE_stamp_pole_skip_exit

CODE_13E92A:
	LDX.b $1D
	JSL.l CODE_item_memory_bit_lookup
	BNE.b CODE_stamp_pole_skip_exit
	LDA.b $15
	AND.w #$0002
	TAY
	LDA.w DATA_13C6C5,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13E93F:
CODE_stamp_pole_skip_exit:
	SEP.b #$30
	RTL

DATA_13E942:
DATA_sewer_water_pool_grow_left_44tiles:                                     ; 44-entry tile table for left side of CODE_stamp_sewer_water_pool; pads with $0000 for "no stamp" slots.
	dw $0000,$0000,$77BC,$77BC,$77BD,$77BD,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$77BC,$77BC,$77BD,$77BD,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $77BC,$77BD,$77BC,$77BC,$77BC,$77BD,$77BC,$77BC
	dw $8572,$8573,$8574,$8575

DATA_13E99A:
DATA_sewer_water_pool_grow_right_44tiles:                                     ; 44-entry tile table for right side of CODE_stamp_sewer_water_pool; same shape as DATA_13E942 but with $77CB/$77CD/$8576-$8579 alternates.
	dw $0000,$0000,$77CB,$77CB,$77CD,$77CD,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$77CB,$77CB,$77CD,$77CD,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $77CB,$77CD,$77CB,$77CB,$77CB,$77CD,$77CB,$77CB
	dw $8576,$8577,$8578,$8579

DATA_13E9F2:
DATA_sewer_water_pool_grow_pointer_pair:                                     ; 2-entry pointer table indexing DATA_13E942/DATA_13E99A based on left/right probe context.
	dw DATA_13E942,DATA_13E99A

CODE_13E9F6:
CODE_stamp_sewer_water_pool:                                     ; Bank13 stamp; uses CODE_probe_left/right_tile to detect $8103 marker, then indirects via DATA_13E9F2 into DATA_13E942/$13E99A 44-entry tables for grow-into-existing-terrain effect.
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_13EA23
	LDY.w #$8103
	LDA.b $12
	CMP.w #$8101
	BEQ.b CODE_13EA4A
	JSR.w CODE_probe_left_tile
	LDY.w #$0002
	CMP.w #$8103
	BEQ.b CODE_13EA30
	JSR.w CODE_probe_right_tile
	LDY.w #$0000
	CMP.w #$8103
	BEQ.b CODE_13EA30
	CMP.w #$8101
	BEQ.b CODE_13EA30
	BRA.b CODE_13EA51

CODE_13EA23:
	LDY.w #$161F
	CMP.w #$0001
	BEQ.b CODE_13EA4A
	LDY.w #$1620
	BRA.b CODE_13EA4A

CODE_13EA30:
	LDA.w DATA_13E9F2,y
	STA.b $00
	LDY.w #$0056
	LDA.b $12
CODE_13EA3A:
	CMP.w DATA_13E46F,y
	BEQ.b CODE_13EA45
	DEY
	DEY
	BPL.b CODE_13EA3A
	BRA.b CODE_13EA51

CODE_13EA45:
	LDA.b ($00),y
	TAY
	BEQ.b CODE_13EA51
CODE_13EA4A:
	LDX.b $1D
	TYA
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13EA51:
	SEP.b #$30
	RTL

DATA_13EA54:
DATA_castle_wall_diag_right_tiles:                                     ; 3-entry tile table ($00CC,$00CB,$00C2) for CODE_stamp_castle_wall_diag_right (per-column tile select).
	dw $00CC,$00CB,$00C2

CODE_13EA5A:
CODE_stamp_castle_wall_diag_right:                                     ; [decorator] Bank13 stamp for std $CD (right-facing diagonal castle wall, variant 1); column-aware tile selection from DATA_castle_wall_diag_right_tiles ($00CC/$00CB/$00C2), then dispatches to CODE_castle_wall_diag_left_post_process or CODE_castle_wall_diag_right_post_process (seam-fix) based on column.
	REP.b #$30
	LDX.b $1D
	LDY.w #$0000
	LDA.b $2C
	BEQ.b CODE_13EA6E
	INY
	INY
	CMP.w #$FFFF
	BEQ.b CODE_13EA6E
	INY
	INY
CODE_13EA6E:
	LDA.w DATA_13EA54,y
	CPY.w #$0000
	BNE.b CODE_13EA7A
	LDA.b $12
	BNE.b CODE_13EA81
CODE_13EA7A:
	LDA.w DATA_13EA54,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13EA81:
	LDA.w #$0001
	STA.b $9B
	CPY.w #$0004
	BCC.b CODE_castle_wall_diag_right_call_seam
	LDA.b $28
	BNE.b CODE_castle_wall_diag_right_after_seam
	JSR.w CODE_13EADC
	BRA.b CODE_castle_wall_diag_right_after_seam

CODE_13EA94:
CODE_castle_wall_diag_right_call_seam:
	JSR.w CODE_13EB2C
	BRA.b CODE_castle_wall_diag_right_exit

CODE_13EA99:
CODE_castle_wall_diag_right_after_seam:
	LDA.b $2C
	DEC
	CMP.b $2E
	BNE.b CODE_castle_wall_diag_right_exit
	LDA.b $12
	CMP.w #$00D5
	BNE.b CODE_13EAAB
	STZ.b $A1
	BRA.b CODE_13EAD6

CODE_13EAAB:
	LDA.b $1B
	PHA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	STA.b $0E
	PLA
	AND.w #$F0F0
	ORA.b $0E
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$0153
	BCC.b CODE_13EAD6
	CMP.w #$0161
	BCS.b CODE_13EAD6
	LDA.w #$0006
	STA.b $A1
CODE_13EAD6:
	JSR.w CODE_13A4F8
CODE_13EAD9:
CODE_castle_wall_diag_right_exit:
	SEP.b #$30
	RTL

CODE_13EADC:
CODE_castle_wall_diag_left_post_process:                                     ; [decorator] Bank13 seam-fix helper (shared by $CC/$CD stamps); if left-probe or above-tile is part of an in-progress diagonal ($0153-$0160) stamps $00C7 at $1D for seam-fix.
	JSR.w CODE_probe_left_tile
	CMP.w #$0153
	BCC.b CODE_13EAE9
	CMP.w #$0161
	BCC.b CODE_13EB18
CODE_13EAE9:
	LDA.b $1B
	PHA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	STA.b $0E
	PLA
	AND.w #$F0F0
	ORA.b $0E
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$0153
	BCC.b CODE_13EB18
	CMP.w #$0161
CODE_13EB0D:
	BCS.b CODE_13EB18
	LDX.b $1D
	LDA.w #$00C7
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13EB18:
	JSR.w CODE_13A47E
	RTS

DATA_13EB1C:
DATA_castle_wall_diag_seam_above_4tiles:                                     ; 4-tile seam-fix table used by CODE_castle_wall_diag_right_post_process when above-cell is part of an in-progress diagonal.
	dw $77DD,$77DC,$77DA,$77DB

DATA_13EB24:
DATA_castle_wall_diag_seam_left_4tiles:                                     ; 4-tile seam-fix table used by CODE_castle_wall_diag_right_post_process when left-probe is part of an in-progress diagonal.
	dw $77E4,$77E2,$77E5,$77E3

CODE_13EB2C:
CODE_castle_wall_diag_right_post_process:                                     ; [decorator] Bank13 seam-fix helper (shared by $CC/$CD stamps); if above is part of an in-progress diagonal picks from DATA_castle_wall_diag_seam_above_4tiles ($77DD/$77DC/$77DA/$77DB); else if left-probe matches picks from DATA_castle_wall_diag_seam_left_4tiles ($77E4/$77E2/$77E5/$77E3); seam-tile stamper.
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$0153
	BCC.b CODE_13EB47
	CMP.w #$0161
	BCS.b CODE_13EB47
	LDA.w DATA_13EB1C,y
	BRA.b CODE_13EB57

CODE_13EB47:
	JSR.w CODE_probe_left_tile
	CMP.w #$0153
	BCC.b CODE_13EB5D
	CMP.w #$0161
	BCS.b CODE_13EB5D
	LDA.w DATA_13EB24,y
CODE_13EB57:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13EB5D:
	RTS

DATA_13EB5E:
DATA_castle_wall_diag_left_tiles:                                     ; 3-entry tile table ($00C9,$00CA,$00C2) for CODE_stamp_castle_wall_diag_left (per-column tile select).
	dw $00C9,$00CA,$00C2

CODE_13EB64:
CODE_stamp_castle_wall_diag_left:                                     ; [decorator] Bank13 stamp for std $CC (left-facing diagonal castle wall, variant 0); mirror of CODE_stamp_castle_wall_diag_right using DATA_castle_wall_diag_left_tiles ($00C9/$00CA/$00C2) and the same post-process helpers (with $Y|$04 offset).
	REP.b #$30
	LDX.b $1D
	LDY.w #$0000
	LDA.b $2C
	BEQ.b CODE_13EB78
	INY
	INY
	CMP.w #$FFFF
	BEQ.b CODE_13EB78
	INY
	INY
CODE_13EB78:
	LDA.w DATA_13EB5E,y
	CPY.w #$0000
	BNE.b CODE_13EB84
	LDA.b $12
	BNE.b CODE_13EB8B
CODE_13EB84:
	LDA.w DATA_13EB5E,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13EB8B:
	LDA.w #$0001
	STA.b $9B
	CPY.w #$0004
	BCC.b CODE_castle_wall_diag_left_call_seam
	LDA.b $28
	DEC
	CMP.b $2A
	BNE.b CODE_castle_wall_diag_left_after_seam
	JSR.w CODE_13EADC
	BRA.b CODE_castle_wall_diag_left_after_seam

CODE_13EBA1:
CODE_castle_wall_diag_left_call_seam:
	TYA
	ORA.w #$0004
	TAY
	JSR.w CODE_13EB2C
	BRA.b CODE_castle_wall_diag_left_exit

CODE_13EBAB:
CODE_castle_wall_diag_left_after_seam:
	LDA.b $2C
	DEC
	CMP.b $2E
	BNE.b CODE_castle_wall_diag_left_exit
	LDA.b $12
	CMP.w #$00D5
	BNE.b CODE_13EBBB
	BRA.b CODE_13EBE8

CODE_13EBBB:
	LDA.b $1B
	PHA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	STA.b $0E
	PLA
	AND.w #$F0F0
	ORA.b $0E
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$0153
	BCC.b CODE_13EBE8
	CMP.w #$0161
	BCS.b CODE_13EBE8
	LDA.w #$0006
	STA.b $A1
	BRA.b CODE_13EBEA

CODE_13EBE8:
	STZ.b $A1
CODE_13EBEA:
	JSR.w CODE_13A4F8
CODE_13EBED:
CODE_castle_wall_diag_left_exit:
	SEP.b #$30
	RTL

DATA_13EBF0:
DATA_slope_3tile_normal:                                     ; 3-entry tile table ($00D6,$00C2,$00D7) for CODE_stamp_slope_3tile_with_probe default left/mid/right slope stamping.
	dw $00D6,$00C2,$00D7

DATA_13EBF6:
DATA_slope_3tile_when_above_slope:                                     ; 3-entry tile table ($77D8,$0000,$77D9) used when stacked on existing slope geometry.
	dw $77D8,$0000,$77D9

CODE_13EBFC:
CODE_stamp_slope_3tile_with_probe:                                     ; [decorator] Bank13 stamp; picks 1 of 3 tiles from DATA_13EBF0 by ($28==0)/($28+1==$2A)/middle, then overrides with DATA_13EBF6 when above-tile is mid-slope ($0153-$0160) and sets $A1=6 (slope-context marker).
	REP.b #$30
	LDX.b $1D
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_13EC10
	INY
	INY
	INC
	CMP.b $2A
	BNE.b CODE_13EC10
	INY
	INY
CODE_13EC10:
	LDA.w DATA_13EBF0,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $2C
	BNE.b CODE_slope_3tile_exit
	CPY.w #$0002
	BEQ.b CODE_13EC46
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13EC2C:
	CMP.w #$0153
	BCC.b CODE_13EC46
	CMP.w #$0161
	BCS.b CODE_13EC46
	LDX.b $1D
	LDA.w DATA_13EBF6,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.w #$0006
	STA.b $A1
	BRA.b CODE_slope_3tile_exit

CODE_13EC46:
	JSR.w CODE_13A4F8
CODE_13EC49:
CODE_slope_3tile_exit:
	SEP.b #$30
	RTL

CODE_13EC4C:
CODE_stamp_col_base_8700:                                     ; Bank13 stamp; stores $9B=$FFFF (single-row mode), writes $8700+$15 (i.e. one of $8700-$8702) - simple constant-column stamp.
	REP.b #$30
	LDA.w #$FFFF
	STA.b $9B
	LDX.b $1D
	LDA.b $15
	CLC
	ADC.w #$8700
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13EC62:
DATA_col_pair_8702_tiles:                                     ; 2-entry tile table ($8702,$8704) for CODE_stamp_col_pair_8702_8704; indexed by $15 with column-parity offset.
	dw $8702,$8704

CODE_13EC66:
CODE_stamp_col_pair_8702_8704:                                     ; Bank13 stamp; uses $15 to index DATA_13EC62 ($8702,$8704), then offsets by 0 or -1 depending on $28&1 (column parity) - alternating column tiles.
	REP.b #$30
	LDX.b $1D
	LDY.b $15
	STZ.b $9B
	LDA.b $28
	AND.w #$0001
	BEQ.b CODE_13EC77
	DEC.b $9B
CODE_13EC77:
	CLC
	ADC.w DATA_13EC62,y
	BRA.b CODE_13ECAD

DATA_13EC7D:
DATA_col_pair_8706_tiles:                                     ; 2-entry tile table ($8706,$870A) for CODE_stamp_col_pair_8706_870A; indexed by $15 with $28-modular column-phase offset.
	dw $8706,$870A

CODE_13EC81:
CODE_stamp_col_pair_8706_870A:                                     ; Bank13 stamp; like CODE_stamp_col_pair_8702_8704 with DATA_13EC7D ($8706,$870A) and reflected indexing ($28 ABS &3 == 3) - longer-period alternating column.
	REP.b #$30
	LDX.b $1D
	LDY.b $15
	STZ.b $9B
	LDA.b $28
	BPL.b CODE_13EC91
	EOR.w #$FFFF
	INC
CODE_13EC91:
	AND.w #$0003
	CMP.w #$0003
	BNE.b CODE_13EC9B
	DEC.b $9B
CODE_13EC9B:
	CLC
	ADC.w DATA_13EC7D,y
	BRA.b CODE_13ECAD

CODE_13ECA1:
CODE_stamp_single_tile_870F:                                     ; Bank13 stamp; unconditionally writes Map16 tile $870F at the walker cell (single-tile decoration, sibling of CODE_stamp_single_tile_870E).
	REP.b #$30
	LDA.w #$870F
	BRA.b CODE_13ECAD

CODE_13ECA8:
CODE_stamp_single_tile_870E:                                     ; Bank13 stamp; unconditionally writes Map16 tile $870E (single-tile decoration, sibling of $870F).
	REP.b #$30
	LDA.w #$870E
CODE_13ECAD:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_13ECB6:
CODE_stamp_4tile_cycle_854B:                                     ; Bank13 stamp; calls helper CODE_13ECC8 to compute ($1B&3 + ($2C&1)<<1) mod 4, then writes $854B+result - random-looking 4-tile checker pattern.
	REP.b #$30
	JSR.w CODE_13ECC8
	CLC
	ADC.w #$854B
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_13ECC8:
CODE_compute_4tile_cycle_index:                                     ; Bank13 helper; mixes Y-low bits with column parity to produce a 0-3 index for CODE_stamp_4tile_cycle_854B's tile selection.
	LDA.b $1B
	AND.w #$0003
	STA.b $00
	LDA.b $2C
	AND.w #$0001
	ASL
	ADC.b $00
	AND.w #$0003
	RTS

DATA_13ECDB:
DATA_grow_top_left_pointer_pair:                                     ; 2-entry pointer table ($13EDA2,$13EDC1) for CODE_stamp_grow_top_left's column-edge dispatch (first column vs last column build helpers).
	dw CODE_13EDA2
	dw CODE_13EDC1

DATA_13ECDF:
DATA_grow_top_left_random_4tiles:                                     ; 4 random-pick tiles ($7941,$7947,$7941,$7947) for CODE_stamp_grow_top_left interior body; selected by prng output low bits.
	dw $7941,$7947,$7941,$7947

DATA_13ECE7:
DATA_grow_top_left_secondary_8tiles:                                     ; 8 secondary tiles ($7940,$7946,$793C,$7943,$793F,$7945,$7931,$7942) for CODE_stamp_grow_top_left random branch.
	dw $7940,$7946,$793C,$7943,$793F,$7945,$7931,$7942

DATA_13ECF7:
DATA_grow_top_left_anchor_12tiles:                                     ; 12-entry anchor table ($7915,$7916,$77A9-$77B0,$7925,$7926) for CODE_stamp_grow_top_left tile-match path.
	dw $7915,$7916,$77A9,$77AA,$77AB,$77AC,$77AD,$77AE
	dw $77AF,$77B0,$7925,$7926

DATA_13ED0F:
DATA_grow_top_left_replacement_12tiles:                                     ; 12-entry replacement table parallel to DATA_grow_top_left_anchor_12tiles ($7938/$8543-$8546/$7939 family).
	dw $7938,$7938,$8543,$8543,$8544,$8544,$8545,$8545
	dw $8546,$8546,$7939,$7939

CODE_13ED27:
CODE_stamp_grow_top_left:                                     ; Bank13 stamp variant 0; on first/last column dispatches to CODE_13EDA2/$13EDC1 build helpers; else anchor-search DATA_13ECF7/$13ED0F; otherwise prng-randomized $7940/$7946 tile family with CODE_13EDE4 seam helper.
	REP.b #$30
	LDX.w #$0000
	LDA.b $2C
	BEQ.b CODE_13ED37
	INX
	INX
	INC
	CMP.b $2E
	BNE.b CODE_13ED40
CODE_13ED37:
	LDA.b $1B
	STA.b $0E
	JSR.w (DATA_13ECDB,x)
	BRA.b CODE_13ED9F

CODE_13ED40:
	LDX.b $1D
	LDY.w #$0000
	LDA.b $12
CODE_13ED47:
	CMP.w DATA_13ECF7,y
	BEQ.b CODE_13ED55
	INY
	INY
	CPY.w #$0018
	BCC.b CODE_13ED47
	BRA.b CODE_13ED5C

CODE_13ED55:
	STZ.b $A1
	LDA.w DATA_13ED0F,y
	BRA.b CODE_13ED9B

CODE_13ED5C:
	LDY.b $A1
	BEQ.b CODE_13ED67
	JSR.w CODE_13EDE4
	STZ.b $A1
	BRA.b CODE_13ED9F

CODE_13ED67:
	JSL.l CODE_prng
	AND.w #$0007
	ASL
	TAY
	CPY.w #$000C
	BCC.b CODE_13ED82
	LDA.b $2E
	CLC
	SBC.b $2C
	DEC
	BNE.b CODE_13ED82
	TYA
	AND.w #$0007
	TAY
CODE_13ED82:
	LDA.w DATA_13ECDF,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	CPY.w #$0008
	BCC.b CODE_13ED9F
	CPY.w #$000C
	BCC.b CODE_13ED95
	STY.b $A1
CODE_13ED95:
	JSR.w CODE_probe_left_tile
	LDA.w DATA_13ECE7,y
CODE_13ED9B:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13ED9F:
	SEP.b #$30
	RTL

CODE_13EDA2:
CODE_grow_top_left_edge_build:                                     ; Bank13 helper for CODE_stamp_grow_top_left; stamps 3-tile vertical column ($7980 above, $7981 left, $7982 here) when at edge.
	JSL.l CODE_get_map16_above
	LDA.w #$7980
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_probe_left_tile
	LDA.w #$7981
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDX.b $1D
	LDA.w #$7982
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

CODE_13EDC1:
CODE_grow_top_left_corner_build:                                     ; Bank13 helper for CODE_stamp_grow_top_left; stamps 3-tile L-shape ($7988 below, $7986 left, $7987 here) at corner.
	JSL.l CODE_get_map16_below
	LDA.w #$7988
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_probe_left_tile
	LDA.w #$7986
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDX.b $1D
	LDA.w #$7987
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13EDDF:
	RTS

DATA_13EDE0:
	dw $793E,$7944

CODE_13EDE4:
CODE_grow_top_left_seam_helper:                                     ; Bank13 helper; selects from DATA_13EDE0-12 ($793E,$7944) and conditionally writes $793D on left-probe; used by grow_top_left's $A1-state branch.
	LDX.b $1D
	LDA.w DATA_13EDE0-$0C,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	CPY.w #$000E
	BCS.b CODE_13EDFC
	JSR.w CODE_probe_left_tile
	LDA.w #$793D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13EDFC:
	RTS

DATA_13EDFD:
DATA_grow_top_right_pointer_pair:                                     ; 2-entry pointer table ($13EEAC,$13EECB) for CODE_stamp_grow_top_right's column-edge dispatch (first vs last column build helpers).
	dw CODE_13EEAC
	dw CODE_13EECB

DATA_13EE01:
DATA_grow_top_right_random_4tiles:                                     ; 4 random tiles ($794D,$7953,$794D,$7953) for CODE_stamp_grow_top_right interior body; selected by prng output low bits.
	dw $794D,$7953,$794D,$7953

DATA_13EE09:
DATA_grow_top_right_secondary_8tiles:                                     ; 8 secondary tiles ($794B,$7951,$794E,$7948,$794C,$7952,$7931,$7949) for CODE_stamp_grow_top_right random branch.
	dw $794B,$7951,$794E,$7948,$794C,$7952,$7931,$7949

DATA_13EE19:
DATA_grow_top_right_replacement_12tiles:                                     ; 12-entry replacement ($793A/$8547-$854A/$793B) parallel to DATA_grow_top_left_anchor_12tiles for top_right.
	dw $793A,$793A,$8547,$8547,$8548,$8548,$8549,$8549
	dw $854A,$854A,$793B,$793B

CODE_13EE31:
CODE_stamp_grow_top_right:                                     ; Bank13 stamp variant 1; mirror of CODE_stamp_grow_top_left using DATA_13EDFD pointer pair ($13EEAC/$13EECB), DATA_13EE19 replacement, $794B/$7951 random family, CODE_13EEEE helper.
	REP.b #$30
	LDX.w #$0000
	LDA.b $2C
	BEQ.b CODE_13EE41
	INX
	INX
	INC
	CMP.b $2E
	BNE.b CODE_13EE4A
CODE_13EE41:
	LDA.b $1B
	STA.b $0E
	JSR.w (DATA_13EDFD,x)
	BRA.b CODE_13EEA9

CODE_13EE4A:
	LDX.b $1D
	LDY.w #$0000
	LDA.b $12
CODE_13EE51:
	CMP.w DATA_13ECF7,y
	BEQ.b CODE_13EE5F
	INY
	INY
	CPY.w #$0018
	BCC.b CODE_13EE51
	BRA.b CODE_13EE66

CODE_13EE5F:
	STZ.b $A1
	LDA.w DATA_13EE19,y
	BRA.b CODE_13EEA5

CODE_13EE66:
	LDY.b $A1
	BEQ.b CODE_13EE71
	JSR.w CODE_13EEEE
	STZ.b $A1
	BRA.b CODE_13EEA9

CODE_13EE71:
	JSL.l CODE_prng
	AND.w #$0007
	ASL
	TAY
	CPY.w #$000C
	BCC.b CODE_13EE8C
	LDA.b $2E
	CLC
	SBC.b $2C
	DEC
	BNE.b CODE_13EE8C
	TYA
	AND.w #$0007
	TAY
CODE_13EE8C:
	LDA.w DATA_13EE01,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	CPY.w #$0008
	BCC.b CODE_13EEA9
	CPY.w #$000C
	BCC.b CODE_13EE9F
	STY.b $A1
CODE_13EE9F:
	JSR.w CODE_probe_right_tile
	LDA.w DATA_13EE09,y
CODE_13EEA5:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13EEA9:
	SEP.b #$30
	RTL

CODE_13EEAC:
CODE_grow_top_right_edge_build:                                     ; Bank13 helper for CODE_stamp_grow_top_right; stamps 3-tile column ($7983/$7985/$7984).
	JSL.l CODE_get_map16_above
	LDA.w #$7983
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_probe_right_tile
	LDA.w #$7985
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDX.b $1D
	LDA.w #$7984
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

CODE_13EECB:
CODE_grow_top_right_corner_build:                                     ; Bank13 helper for CODE_stamp_grow_top_right; stamps 3-tile L-shape ($798B/$798A/$7989).
	JSL.l CODE_get_map16_below
	LDA.w #$798B
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_probe_right_tile
	LDA.w #$798A
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDX.b $1D
	LDA.w #$7989
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

DATA_13EEEA:
	dw $794F,$794A

CODE_13EEEE:
CODE_grow_top_right_seam_helper:                                     ; Bank13 helper paralleling CODE_grow_top_left_seam_helper for the top_right variant; uses DATA_13EEEA ($794F,$794A) and $7950 seam tile.
	LDX.b $1D
	LDA.w DATA_13EEEA-$0C,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	CPY.w #$000E
	BCS.b CODE_13EF06
	JSR.w CODE_probe_right_tile
	LDA.w #$7950
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13EF06:
	RTS

DATA_13EF07:
DATA_grow_bottom_left_pointer_pair:                                     ; 2-entry pointer table ($13EFD7,$13EFF6) for CODE_stamp_grow_bottom_left's row-edge dispatch (first row vs last row build helpers).
	dw CODE_13EFD7
	dw CODE_13EFF6

DATA_13EF0B:
DATA_grow_bottom_left_random_4tiles:                                     ; 4 random tiles ($795A,$7961,$795A,$7961) for CODE_stamp_grow_bottom_left interior body; selected by prng output low bits.
	dw $795A,$7961,$795A,$7961

DATA_13EF13:
DATA_grow_bottom_left_secondary_8tiles:                                     ; 8 secondary tiles ($7959,$7960,$7956,$795D,$7958,$795F,$7954,$795B) for CODE_stamp_grow_bottom_left when prng index falls in [8,12) range.
	dw $7959,$7960,$7956,$795D,$7958,$795F,$7954,$795B

DATA_13EF23:
DATA_grow_bottom_anchor_13tiles:                                     ; 13-entry anchor table ($790F/$791F + $7799-$77A0 + $7910/$7920/$77CE) for CODE_stamp_grow_bottom_left/right.
	dw $790F,$791F,$7799,$779A,$779B,$779C,$779D,$779E
	dw $779F,$77A0,$7910,$7920,$77CE

DATA_13EF3D:
DATA_grow_bottom_left_replacement_13tiles:                                     ; 13-entry replacement ($7934/$853B-$853E/$7935/$853C) parallel to DATA_grow_bottom_anchor_13tiles for bottom_left variant.
	dw $7934,$7934,$853B,$853B,$853C,$853C,$853D,$853D
	dw $853E,$853E,$7935,$7935,$853C

CODE_13EF57:
CODE_stamp_grow_bottom_left:                                     ; Bank13 stamp variant 2; like grow_top_left but row-axis-driven ($28 instead of $2C), uses DATA_13EF07 pointer pair ($13EFD7/$13EFF6), DATA_13EF3D replacement, $7959/$7960 random family, CODE_13F01D helper.
	REP.b #$30
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_13EF67
	INX
	INX
	INC
	CMP.b $2A
	BNE.b CODE_13EF70
CODE_13EF67:
	LDA.b $1B
	STA.b $0E
	JSR.w (DATA_13EF07,x)
	BRA.b CODE_13EFD4

CODE_13EF70:
	LDX.b $1D
	LDY.w #$0000
	LDA.b $12
CODE_13EF77:
	CMP.w DATA_13EF23,y
	BEQ.b CODE_13EF85
	INY
	INY
	CPY.w #$001A
	BCC.b CODE_13EF77
	BRA.b CODE_13EF8C

CODE_13EF85:
	STZ.b $A1
	LDA.w DATA_13EF3D,y
	BRA.b CODE_13EFD0

CODE_13EF8C:
	LDY.b $A1
	BEQ.b CODE_13EF97
	JSR.w CODE_13F01D
	STZ.b $A1
	BRA.b CODE_13EFD4

CODE_13EF97:
	JSL.l CODE_prng
	AND.w #$0007
	ASL
	TAY
	CPY.w #$000C
	BCC.b CODE_13EFB2
	LDA.b $2A
	CLC
	SBC.b $28
	DEC
	BNE.b CODE_13EFB2
	TYA
	AND.w #$0007
	TAY
CODE_13EFB2:
	LDA.w DATA_13EF0B,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	CPY.w #$0008
	BCC.b CODE_13EFD4
	CPY.w #$000C
	BCC.b CODE_13EFC5
	STY.b $A1
CODE_13EFC5:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.w DATA_13EF13,y
CODE_13EFD0:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13EFD4:
	SEP.b #$30
	RTL

CODE_13EFD7:
CODE_grow_bottom_left_edge_build:                                     ; Bank13 helper for CODE_stamp_grow_bottom_left; stamps 3-tile column ($7980/$7981/$7982) above-probe.
	JSL.l CODE_get_map16_above
	LDA.w #$7980
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_probe_left_tile
	LDA.w #$7981
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDX.b $1D
	LDA.w #$7982
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

CODE_13EFF6:
CODE_grow_bottom_left_corner_build:                                     ; Bank13 helper for CODE_stamp_grow_bottom_left; stamps 3-tile L-shape ($7983/$7985/$7984) right-probe.
	JSL.l CODE_get_map16_above
	LDA.w #$7983
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_probe_right_tile
	LDA.w #$7985
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDX.b $1D
	LDA.w #$7984
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

DATA_13F015:
	dw $7957,$795E

DATA_13F019:
	dw $7955,$795C

CODE_13F01D:
CODE_grow_bottom_left_seam_helper:                                     ; Bank13 helper; selects from DATA_13F015-12 ($7957,$795E) for here-cell and DATA_13F019-12 ($7955,$795C) for above-cell.
	LDX.b $1D
	LDA.w DATA_13F015-$0C,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.w DATA_13F019-$0C,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

DATA_13F036:
DATA_grow_bottom_right_pointer_pair:                                     ; 2-entry pointer table ($13F0EC,$13F10B) for CODE_stamp_grow_bottom_right's row-edge dispatch (first row vs last row build helpers).
	dw CODE_13F0EC
	dw CODE_13F10B

DATA_13F03A:
DATA_grow_bottom_right_random_4tiles:                                     ; 4 random tiles ($7968,$796F,$7968,$796F) for CODE_stamp_grow_bottom_right interior body; selected by prng output low bits.
	dw $7968,$796F,$7968,$796F

DATA_13F042:
DATA_grow_bottom_right_secondary_8tiles:                                     ; 8 secondary tiles ($7966,$796D,$7962,$7969,$7967,$796E,$7964,$796B) for CODE_stamp_grow_bottom_right when prng index falls in [8,12) range.
	dw $7966,$796D,$7962,$7969,$7967,$796E,$7964,$796B

DATA_13F052:
DATA_grow_bottom_right_replacement_13tiles:                                     ; 13-entry replacement ($7936/$853F-$8542/$7937/$8540) parallel to DATA_grow_bottom_anchor_13tiles for bottom_right.
	dw $7936,$7936,$853F,$853F,$8540,$8540,$8541,$8541
	dw $8542,$8542,$7937,$7937,$8540

CODE_13F06C:
CODE_stamp_grow_bottom_right:                                     ; Bank13 stamp variant 3; mirror of CODE_stamp_grow_bottom_left using DATA_13F036 pointer pair ($13F0EC/$13F10B), DATA_13F052 replacement, $7966/$796D random family, CODE_13F132 helper.
	REP.b #$30
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_13F07C
	INX
	INX
	INC
	CMP.b $2A
	BNE.b CODE_13F085
CODE_13F07C:
	LDA.b $1B
	STA.b $0E
	JSR.w (DATA_13F036,x)
	BRA.b CODE_13F0E9

CODE_13F085:
	LDX.b $1D
	LDY.w #$0000
	LDA.b $12
CODE_13F08C:
	CMP.w DATA_13EF23,y
	BEQ.b CODE_13F09A
	INY
	INY
	CPY.w #$001A
	BCC.b CODE_13F08C
	BRA.b CODE_13F0A1

CODE_13F09A:
	STZ.b $A1
	LDA.w DATA_13F052,y
	BRA.b CODE_13F0E5

CODE_13F0A1:
	LDY.b $A1
	BEQ.b CODE_13F0AC
	JSR.w CODE_13F132
	STZ.b $A1
	BRA.b CODE_13F0E9

CODE_13F0AC:
	JSL.l CODE_prng
	AND.w #$0007
	ASL
	TAY
	CPY.w #$000C
	BCC.b CODE_13F0C7
	LDA.b $2A
	CLC
	SBC.b $28
	DEC
	BNE.b CODE_13F0C7
	TYA
	AND.w #$0007
	TAY
CODE_13F0C7:
	LDA.w DATA_13F03A,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	CPY.w #$0008
	BCC.b CODE_13F0E9
	CPY.w #$000C
	BCC.b CODE_13F0DA
	STY.b $A1
CODE_13F0DA:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.w DATA_13F042,y
CODE_13F0E5:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13F0E9:
	SEP.b #$30
	RTL

CODE_13F0EC:
CODE_grow_bottom_right_edge_build:                                     ; Bank13 helper for CODE_stamp_grow_bottom_right; stamps 3-tile column ($7988/$7986/$7987) below-probe.
	JSL.l CODE_get_map16_below
	LDA.w #$7988
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_probe_left_tile
	LDA.w #$7986
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDX.b $1D
	LDA.w #$7987
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

CODE_13F10B:
CODE_grow_bottom_right_corner_build:                                     ; Bank13 helper for CODE_stamp_grow_bottom_right; stamps 3-tile L-shape ($798B/$798A/$7989) right-probe.
	JSL.l CODE_get_map16_below
	LDA.w #$798B
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_probe_right_tile
	LDA.w #$798A
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDX.b $1D
	LDA.w #$7989
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

DATA_13F12A:
	dw $7963,$796A

DATA_13F12E:
	dw $7965,$796C

CODE_13F132:
CODE_grow_bottom_right_seam_helper:                                     ; Bank13 helper paralleling CODE_grow_bottom_left_seam_helper using DATA_13F12A ($7963,$796A) and DATA_13F12E ($7965,$796C).
	LDX.b $1D
	LDA.w DATA_13F12A-$0C,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.w DATA_13F12E-$0C,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

DATA_13F14B:
DATA_lift_14tile_pattern:                                     ; 14-entry tile table ($84BA-$84BF,$330C,$3510,$84BC-$84BF,$84C0,$8600,$84C1) used by CODE_stamp_lift_14tile.
	dw $84BA,$84BB,$330C,$3510,$84BC,$84BD,$84BE,$84BF
	dw $84C0,$84C0,$8600,$8600,$84C1,$84C1

CODE_13F167:
CODE_stamp_lift_14tile:                                     ; Bank13 stamp; indexes into DATA_13F14B (14 tiles: $84BA-$84BF, $330C, $3510, $8600, $84C0, $84C1) using $2C<<2 + ($28&1)<<1 + $15 - a 14-entry lift/platform tile pattern.
	REP.b #$30
	LDX.b $1D
	LDA.b $2C
	ASL
	ASL
	STA.b $00
	LDA.b $28
	AND.w #$0001
	ASL
	ORA.b $15
	ADC.b $00
	TAY
	LDA.w DATA_13F14B,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_13F186:
CODE_stamp_star_block:                                     ; Bank13 stamp; unconditionally writes Map16 tile $8A00 at the walker cell (single-tile decoration object).
	REP.b #$30
	LDA.w #$8A00
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13F194:
DATA_ice_floor_4entries:                                     ; 4-entry sparse-stamp table ($0000,$0017,$0000,$0018) used by CODE_stamp_ice_floor first-row branch.
	dw $0000,$0017,$0000,$0018

DATA_13F19C:
DATA_ice_floor_3stamps:                                     ; 3-entry tile table ($8C01,$8C05,$8C09) for CODE_stamp_ice_floor row-2-plus body stamps.
	dw $8C01,$8C05,$8C09

CODE_13F1A2:
CODE_stamp_ice_floor:                                     ; Bank13 stamp; first-row path uses prng + DATA_13F194 ($0000,$0017,$0000,$0018) for sparse-cloud randomization; other rows index DATA_13F19C ($8C01,$8C05,$8C09) by ($2C-1)*2 with $28&1 phase offset; clamped to $8C0D.
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_13F1BB
	LDA.b $12
	BNE.b CODE_13F1DD
	JSL.l CODE_prng
	AND.w #$0006
	TAY
	LDA.w DATA_13F194,y
	BEQ.b CODE_13F1DD
	BRA.b CODE_13F1D7

CODE_13F1BB:
	LDA.b $28
	AND.w #$0001
	STA.b $00
	LDA.b $2C
	DEC
	ASL
	CMP.w #$0006
	BCC.b CODE_13F1D0
	LDA.w #$8C0D
	BRA.b CODE_13F1D7

CODE_13F1D0:
	TAY
	LDA.w DATA_13F19C,y
	CLC
	ADC.b $00
CODE_13F1D7:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13F1DD:
	SEP.b #$30
	RTL

DATA_13F1E0:
DATA_ice_floor_edge_water_top_9tiles:                                     ; 9-tile table ($8C03,$0000,$8C00,$8C07,$8C04,$8C0B,$8C08,$8C0E,$8C0C) for CODE_stamp_ice_floor_edge_water row-0.
	dw $8C03,$0000,$8C00,$8C07,$8C04,$8C0B,$8C08,$8C0E
	dw $8C0C

DATA_13F1F2:
DATA_ice_floor_edge_water_mid_10tiles:                                     ; 10-tile table ($8C0E,$8C0C,$0015,$0016,$1621-$1625,$1625) for CODE_stamp_ice_floor_edge_water interior rows.
	dw $8C0E,$8C0C,$0015,$0016,$1621,$1622,$1623,$1624
	dw $1625,$1625

CODE_13F206:
CODE_stamp_ice_floor_edge_water:                                     ; Bank13 stamp; row-0 path uses 3-position-row index ($28==0 / mid / $28+1==$2A) into DATA_13F1E0 (9 tiles); row-1+ uses $2C-based selector into DATA_13F1E0+2 / DATA_13F1F2 (10 tiles) with $28-based phase variants.
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_13F235
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_13F21C
	INY
	INY
	INC
	CMP.b $2A
	BNE.b CODE_13F21C
	INY
	INY
CODE_13F21C:
	CPY.w #$0002
	BNE.b CODE_13F230
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.w #$0000
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13F230:
	LDA.w DATA_13F1E0,y
	BRA.b CODE_13F261

CODE_13F235:
	ASL
	ASL
	TAY
	LDA.b $2C
	CMP.w #$0004
	BCC.b CODE_13F242
	LDY.w #$0010
CODE_13F242:
	STY.b $00
	LDA.b $28
	BEQ.b CODE_13F24F
	INC
	CMP.b $2A
	BNE.b CODE_13F254
	INY
	INY
CODE_13F24F:
	LDA.w DATA_13F1E0+$02,y
	BRA.b CODE_13F261

CODE_13F254:
	LDA.b $28
	AND.w #$0001
	ASL
	CLC
	ADC.b $00
	TAY
	LDA.w DATA_13F1F2,y
CODE_13F261:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13F26A:
DATA_random_8phase_edge_pointer_pair:                                     ; 2-entry pointer table ($13F313,$13F31E) for CODE_stamp_random_8phase column-edge helpers.
	dw CODE_13F313
	dw CODE_13F31E

DATA_13F26E:
DATA_random_8phase_40tile_grid:                                     ; 40-entry tile table ($8C0F-$8C12 then $798C-$798F + $7991-$7997 alt rows) used by CODE_stamp_random_8phase interior body.
	dw $8C0F,$8C10,$8C11,$8C10,$8C11,$8C12,$8C0F,$8C10
	dw $798C,$798D,$798E,$798D,$798F,$7990,$798C,$7990
	dw $7991,$7992,$7991,$7993,$7994,$7997,$7997,$7997
	dw $7997,$7997,$7997,$7997,$7997,$7995,$7996,$7994
	dw $7995,$7996,$7997,$7997,$7997,$7997,$7997,$7997

CODE_13F2BE:
CODE_stamp_random_8phase:                                     ; Bank13 stamp; first row uses ($28&1)+$8D8C; non-first rows dispatch helper from DATA_13F26A ($13F313/$13F31E) when at column edge, else index 40-entry DATA_13F26E by ($2C-1)*8 + ($28+$15)&7, clamping rows>=6 to $7997.
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_13F2CF
	LDA.b $28
	AND.w #$0001
	CLC
	ADC.w #$8D8C
	BRA.b CODE_13F30A

CODE_13F2CF:
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_13F2DD
	INX
	INX
	INC
	CMP.b $2A
	BNE.b CODE_13F2E8
CODE_13F2DD:
	LDA.b $1B
	STA.b $0E
	JSR.w (DATA_13F26A,x)
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13F2E8:
	LDA.b $2C
	CMP.w #$0006
	BCS.b CODE_13F307
CODE_13F2EF:
	DEC
	ASL
	ASL
	ASL
	STA.b $00
	LDA.b $28
	CLC
	ADC.b $15
	AND.w #$0007
	CLC
	ADC.b $00
	ASL
	TAY
	LDA.w DATA_13F26E,y
	BRA.b CODE_13F30A

CODE_13F307:
	LDA.w #$7997
CODE_13F30A:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_13F313:
CODE_random_8phase_left_helper:                                     ; Bank13 helper for CODE_stamp_random_8phase column-0 path; reads map16-left, adds $0098+$0085,y for tile offset.
	JSL.l CODE_get_map16_left
	LDA.b #$98
	ADC.w $0085,y
	BRA.b CODE_13F327

CODE_13F31E:
CODE_random_8phase_right_helper:                                     ; Bank13 helper for CODE_stamp_random_8phase column-$2C path; reads map16-right, adds $009A+$0085,y for tile offset.
	JSL.l CODE_get_map16_right
	LDA.b #$9A
	ADC.w $0085,y
CODE_13F327:
	LDA.b $2C
	DEC
	BEQ.b CODE_13F330
	INC.b $00
	BRA.b CODE_13F330

CODE_13F330:
	LDA.b $00
	RTS

DATA_13F333:
DATA_small_tile_set_top_2tiles:                                     ; 2-entry tile table ($79A4,$79A6) for CODE_stamp_small_tile_set first-2-row path.
	dw $79A4,$79A6

DATA_13F337:
DATA_small_tile_set_body_2tiles:                                     ; 2-entry tile table ($799B,$7999) for CODE_stamp_small_tile_set interior-row path.
	dw $799B,$7999

CODE_13F33B:
CODE_stamp_small_tile_set:                                     ; Bank13 stamp; on $2C<2 indexes DATA_13F333 ($79A4,$79A6) by $28<<2 then adds $28 (4-tile family); else indexes DATA_13F337 ($799B,$7999) by $28<<1 (2-tile family).
	REP.b #$30
	LDA.b $28
	ASL
	TAY
	LDA.b $2C
	CMP.w #$0002
	BCS.b CODE_13F352
	ASL
	TAY
	LDA.w DATA_13F333,y
	CLC
	ADC.b $28
	BRA.b CODE_13F355

CODE_13F352:
	LDA.w DATA_13F337,y
CODE_13F355:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13F35E:
DATA_lava_cave_pool_tiles:                                     ; 8-entry Map16 table for CODE_stamp_lava_cave_pool: rows 0-1 ($8D92,$8D90,$8D91,$8D93) plus the cap-row variants ($A602,$A600,$A601,$A603) covering left-edge / middle / right-edge / middle-alt.
	dw $8D92,$8D90,$8D91,$8D93,$A602,$A600,$A601,$A603

CODE_13F36E:
CODE_stamp_lava_cave_pool:                                     ; Bank13 per-cell stamp for object $DF. Picks from DATA_lava_cave_pool_tiles ($8D90-$8D93 body, $A600-$A603 cap row) using ($2C ASL ASL) + leftmost/middle/rightmost column flag, with a CMP $8D2E..$8D32 nudge that adds 4 if the underlying cell already holds a stone-mid tile (shape merge).
	REP.b #$30
	LDA.b $2C
	ASL
	ASL
	STA.b $00
	STZ.b $02
	LDA.b $28
	BEQ.b CODE_13F387
	INC
	CMP.b $2A
	BNE.b CODE_13F38B
	INC.b $02
	INC.b $02
	INC.b $02
CODE_13F387:
	LDA.b $02
	BRA.b CODE_13F392

CODE_13F38B:
	AND.w #$0001
	CLC
	ADC.w #$0001
CODE_13F392:
	CLC
	ADC.b $00
	ASL
	TAY
	LDA.w DATA_lava_cave_pool_tiles,y
	LDY.b $12
	CMP.w #$8D2E
	BCC.b CODE_13F3AB
	CMP.w #$8D32
	BCS.b CODE_13F3AB
	TYA
	CLC
	ADC.w #$0004
CODE_13F3AB:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_13F3B4:
CODE_stamp_lava_flow_down:                                     ; Bank13 per-cell stamp for object $E0. Row 0 stamps $A605, row 1+ stamps $A606. Used for the 2-tall ornamental mountain peak / mini-pillar shape with a built-in cap.
	REP.b #$30
	LDY.w #$A605
	LDA.b $2C
	BEQ.b CODE_13F3BE
	INY
CODE_13F3BE:
	TYA
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13F3C8:
DATA_decorated_wall_top_tiles:                                     ; 11-entry (3 records x 3 + 2 padding) row-0 tile table for CODE_stamp_mushroom_platform: $2C0C/$1527/$2F0B/0000 / $2C0E/$1528/$2F0D/0000 / $2C10/$1529/$2F0F mixing sky-tinted top + stone shoulder + foreground accent per variant.
	dw $2C0C,$1527,$2F0B,$0000,$2C0E,$1528,$2F0D,$0000
	dw $2C10,$1529,$2F0F

DATA_13F3DE:
DATA_lava_cave_pool_alt_tiles:                                     ; 4-entry alternate stone-cap tile table ($8D2A,$8D2B,$8D2C,$8D2D) for CODE_stamp_mushroom_platform row 1+ when $A1 even and not at end-of-column.
	dw $8D2A,$8D2B,$8D2C,$8D2D

CODE_13F3E6:
CODE_stamp_mushroom_platform:                                     ; Bank13 per-cell stamp for object $E1. Row 0 picks from DATA_decorated_wall_top_tiles (indexed by $A1 ASL + $15) with +1 nudge for stone merging. Row 1+ branches on $A1 parity into DATA_lava_cave_pool_alt_tiles or single-tile $8D29 fill, auto-rolls $A1 per column.
	REP.b #$30
	LDA.w $002C
	BNE.b CODE_13F405
	LDA.b $A1
	ASL
	ADC.b $15
	TAY
	LDA.w DATA_13F3C8,y
	LDX.b $12
	CPX.w #$8D2A
	BCC.b CODE_13F447
	CPX.w #$8D2E
	BCS.b CODE_13F447
	INC
	BRA.b CODE_13F447

CODE_13F405:
	LDA.b $A1
	AND.w #$0001
	BEQ.b CODE_13F44D
	LDA.b $2C
	INC
	CMP.b $2E
	BEQ.b CODE_13F42B
	CMP.w #$0002
	BNE.b CODE_13F41D
	LDA.w #$8D29
	BRA.b CODE_13F447

CODE_13F41D:
	LDA.b $2C
	DEC
	DEC
	AND.w #$0003
	ASL
	TAY
	LDA.w DATA_lava_cave_pool_alt_tiles,y
	BRA.b CODE_13F447

CODE_13F42B:
	LDA.b $2C
	AND.w #$0003
	EOR.w #$0002
	CLC
	ADC.w #$8D2E
	LDY.b $12
	CPY.b #$90
	STA.w $0990
	CPY.b #$94
	STA.w $04B0
	CLC
	ADC.w #$0004
CODE_13F447:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13F44D:
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_13F461
	LDA.b $A1
	INC
	CMP.w #$0003
	BCC.b CODE_13F45F
	LDA.w #$0000
CODE_13F45F:
	STA.b $A1
CODE_13F461:
	SEP.b #$30
	RTL

DATA_13F464:
DATA_snowy_platform_support_top_tiles:                                     ; 32-entry Map16 table for CODE_stamp_snowy_platform_support rows 0-7: leading $0000 cells per row make the spire silhouette narrow toward the top; remaining cells use $8D9A-$8DCB stone runs.
	dw $0000,$8D9A,$8D9B,$0000,$0000,$8DA9,$8DAA,$0000
	dw $0000,$8DB8,$8DB9,$0000,$0000,$8DC6,$8DC7,$0000
	dw $8D9C,$8D9D,$8D9E,$8D9F,$8DAB,$8DAC,$8DAD,$8DAE
	dw $8DBA,$8DBB,$8DBC,$8DBD,$8DC8,$8DC9,$8DCA,$8DCB

DATA_13F4A4:
DATA_snowy_platform_support_body_tiles:                                     ; 32-entry Map16 table for CODE_stamp_snowy_platform_support rows 8+: continues the spire with $8D9A-$8DD0 stone runs at full width (no $0000 silhouette cells).
	dw $8D9A,$8DA0,$8DA0,$8D9B,$8DA9,$8DAF,$8DAF,$8DAA
	dw $8DB8,$8DBE,$8DBE,$8DB9,$8DC6,$8DCC,$8DCC,$8DC7
	dw $8DA1,$8DA2,$8DA3,$8DA4,$8DB0,$8DB1,$8DB2,$8DB3
	dw $8DBF,$8DC0,$8DC1,$8DC2,$8DCD,$8DCE,$8DCF,$8DD0

CODE_13F4E4:
CODE_stamp_snowy_platform_support:                                     ; Bank13 per-cell stamp for object $E2. Indexes (($2C AND $0007) ASL ASL + $28) ASL into either DATA_snowy_platform_support_top_tiles (rows 0-7, with the early-row $0000 cells suppressing the stamp) or DATA_snowy_platform_support_body_tiles (row 8+)  produces a tall stone spire whose top rows narrow progressively.
	REP.b #$30
	LDA.b $2C
	AND.w #$0007
	ASL
	ASL
	ADC.b $28
	ASL
	TAY
	LDA.b $2C
	CMP.w #$0008
	BCS.b CODE_13F4FF
	LDA.w DATA_13F464,y
	BEQ.b CODE_13F508
	BRA.b CODE_13F502

CODE_13F4FF:
	LDA.w DATA_13F4A4,y
CODE_13F502:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13F508:
	SEP.b #$30
	RTL

DATA_13F50B:
DATA_ice_floor_edge_hole_tiles:                                     ; 3-entry tile table ($8C00,$8C04,$8C08) for CODE_stamp_ice_floor_edge_hole: row-0 top tiles for left/middle/right column positions; lower rows derive by adding 0/1/2/3 progression to these bases.
	dw $8C00,$8C04,$8C08

CODE_13F511:
CODE_stamp_ice_floor_edge_hole:                                     ; Bank13 per-cell stamp for object $E3. Caps $2C at 2 (so only 3 distinct row groups exist), then picks left/middle/right tile from DATA_ice_floor_edge_hole_tiles based on column position ($28 vs $2A); row 0 also probes the cell above via CODE_get_map16_above and clears it (so the column doesn't punch into ceiling tiles).
	REP.b #$30
	LDA.b $2C
	CMP.w #$0002
	BCC.b CODE_13F51D
	LDA.w #$0002
CODE_13F51D:
	ASL
	TAY
	STZ.b $00
	LDX.w #$0003
	LDA.b $28
	BEQ.b CODE_13F530
	INC
	CMP.b $2A
	BNE.b CODE_13F537
	DEX
	DEX
	DEX
CODE_13F530:
	TXA
	CLC
	ADC.w DATA_13F50B,y
	BRA.b CODE_13F53A

CODE_13F537:
	LDA.w #$0000
CODE_13F53A:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $2C
	BNE.b CODE_13F553
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.w #$0000
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13F553:
	SEP.b #$30
	RTL

DATA_13F556:
	dw $0000,$0000,$859A,$859B,$79DA,$79DB

DATA_13F562:
	dw $0000,$0000,$859F,$85A0,$79DD,$79DE

DATA_13F56E:
	dw $0000,$0000,$859A,$859C,$79DD,$79DE

DATA_13F57A:
	dw $0000,$0000,$859F,$85A1,$79DD,$79DF

DATA_13F586:
	dw $0000,$0000,$859A,$859B,$79DC,$79DB

DATA_13F592:
	dw $0000,$0000,$85A2,$85A0,$79DD,$79DC

DATA_13F59E:
	dw $0000,$85C5,$85A2,$859D,$79DA,$79AC

DATA_13F5AA:
	dw $85C8,$0000,$85A3,$85A4,$79AD,$79AF

DATA_13F5B6:
	dw $85C6,$85C7,$859E,$859D,$79DC,$79DB

DATA_13F5C2:
	dw $85C8,$85C5,$85A3,$85A4,$79DC,$79B6

DATA_13F5CE:
DATA_slope_steep_up_left_ptrs:                                     ; 16-pointer dispatch table for CODE_stamp_slope_steep_up_left selecting one of 10 per-variant 6-tile records (DATA_13F556..DATA_13F5C2). Top 8 entries are "primary" variants; bottom 8 reuse the variants in inverted order.
	dw DATA_13F5C2,DATA_13F5B6,DATA_13F5AA,DATA_13F59E,DATA_13F592,DATA_13F586,DATA_13F57A,DATA_13F56E
	dw DATA_13F562,DATA_13F556,DATA_13F5B6,DATA_13F59E,DATA_13F586,DATA_13F56E,DATA_13F562,DATA_13F556

CODE_13F5EE:
CODE_stamp_slope_steep_up_left:                                     ; Bank13 per-cell stamp for object $E4. Rows 0-2 pick a tile via DATA_slope_steep_up_left_ptrs[$A1] (8-variant) indexed by ($2C ASL + ($28 AND 1)) ASL  produces the diagonal silhouette. Rows 3+ tail-call CODE_jungle_floor_random_fill to fill the slope's inside with random ground tiles.
	REP.b #$30
	LDA.b $2C
	CMP.w #$0003
	BCC.b CODE_slope_steep_up_left_body
	DEC
	DEC
	DEC
	ASL
	STA.b $00
	JSR.w CODE_13F654
	BRA.b CODE_slope_steep_up_left_exit

CODE_13F602:
CODE_slope_steep_up_left_body:
	LDA.b $28
	AND.w #$0001
	STA.b $00
	BNE.b CODE_13F619
	LDA.b $2C
	BNE.b CODE_13F619
	JSL.l CODE_prng
	AND.w #$000F
	ASL
	STA.b $A1
CODE_13F619:
	LDA.b $2C
	ASL
	ADC.b $00
	ASL
	TAY
	LDX.b $A1
	LDA.w DATA_13F5CE,x
	STA.b $00
	LDA.b ($00),y
	BEQ.b CODE_slope_steep_up_left_exit
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13F631:
CODE_slope_steep_up_left_exit:
	SEP.b #$30
	RTL

DATA_13F634:
DATA_jungle_floor_fill_tiles:                                     ; 16-entry random-tile table ($79BB,$79BC,$79BD,$79BE,$79BF,$79C0,$79C1,$79C2,$79C3,$79C4 and 6x $79E0) used by CODE_jungle_floor_random_fill: 10 distinct ground tiles + 6 repeats of $79E0 to weight that variant more heavily.
	dw $79BB,$79BC,$79BD,$79BE,$79BF,$79C0,$79C1,$79C2
	dw $79C3,$79C4,$79E0,$79E0,$79E0,$79E0,$79E0,$79E0

CODE_13F654:
CODE_jungle_floor_random_fill:                                     ; Shared helper used by slope stamps ($E4/$E8) for "fill the inside of the slope shape with random ground". PRNG-selects 0..15 from DATA_jungle_floor_fill_tiles ($79BB-$79E0, clamping at $79E0 for the high-end indices), stamps at $1D.
	JSL.l CODE_prng
	AND.w #$000F
	CLC
	ADC.b $00
	CMP.w #$0010
	BCC.b CODE_13F666
	LDA.w #$000F
CODE_13F666:
	ASL
	TAY
	LDX.b $1D
	LDA.w DATA_13F634,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

DATA_13F672:
	dw $0000,$0000,$85A8,$85A7,$0D0D,$0C0C,$79AD,$79AC

DATA_13F682:
	dw $0000,$0000,$85A8,$85A7,$0D0E,$0C0C,$79B6,$79AE

DATA_13F692:
	dw $0000,$0000,$85A8,$85A6,$0D0E,$0C0B,$79BD,$79AE

DATA_13F6A2:
	dw $85C2,$0000,$85A9,$85A6,$0D0E,$0C0C,$79AD,$79AF

DATA_13F6B2:
	dw $85C3,$85C1,$85AA,$85A5,$0D0E,$0C0C,$79B1,$79B0

DATA_13F6C2:
DATA_slope_down_left_ptrs:                                     ; 8-pointer dispatch table for CODE_stamp_slope_down_left_long selecting one of 5 per-variant 8-cell records (DATA_13F672..DATA_13F6B2). Entries are arranged as 5 distinct variants then 3 mirror reuses for symmetry.
	dw DATA_13F672,DATA_13F682,DATA_13F692,DATA_13F6A2,DATA_13F6B2,DATA_13F6B2,DATA_13F6A2,DATA_13F672

CODE_13F6D2:
CODE_stamp_slope_down_left_long:                                     ; [decorator] Bank13 per-cell stamp for object $E5. Edge-fixes via CODE_slope_fix_left_edge / CODE_slope_fix_right_edge on the last column ($79C8/$79C9 corners). PRNG-picks DATA_slope_down_left_ptrs[$A1] on row 0 (forces $A1=0 if underlying tile is $9000..$904F), then tail-calls CODE_stamp_slope_body_shared.
	REP.b #$30
	STZ.b $9B
	LDA.b $2C
	CMP.w #$0001
	BNE.b CODE_slope_down_left_long_row2_right
	LDA.b $28
	BNE.b CODE_slope_down_left_long_body
	JSR.w CODE_13F813
	BRA.b CODE_slope_down_left_long_body

CODE_13F6E6:
CODE_slope_down_left_long_row2_right:
	CMP.w #$0002
	BNE.b CODE_slope_down_left_long_body
	LDA.b $28
	DEC
	CMP.b $2A
	BNE.b CODE_slope_down_left_long_body
	JSR.w CODE_13F7FE
CODE_13F6F5:
CODE_slope_down_left_long_body:
	LDA.b $28
	AND.w #$0001
	STA.b $00
	BEQ.b CODE_13F707
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_13F707
	INC.b $9B
CODE_13F707:
	LDA.b $00
	BNE.b CODE_13F735
	LDA.b $2C
	BNE.b CODE_13F735
	JSL.l CODE_prng
	AND.w #$0007
	ASL
	STA.b $A1
	CMP.w #$0004
	BEQ.b CODE_13F723
	CMP.w #$0008
	BNE.b CODE_13F735
CODE_13F723:
	LDX.b $1D
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$9000
	BCC.b CODE_13F735
	CMP.w #$9050
	BCS.b CODE_13F735
	STZ.b $A1
CODE_13F735:
	LDX.b $A1
	LDA.w DATA_13F6C2,x
	STA.b $02
	JMP.w CODE_13F8F2

DATA_13F73F:
	dw $0000,$85B9,$0814,$79AA

DATA_13F747:
	dw $0000,$85BA,$0815,$79AA

DATA_13F74F:
	dw $0000,$85B9,$0816,$79AB

DATA_13F757:
	dw $85C1,$85BB,$0816,$79AB

DATA_13F75F:
	dw $85C2,$85BC,$0814,$79B6

DATA_13F767:
DATA_slope_down_left_short_ptrs:                                     ; 8-pointer dispatch table for CODE_stamp_slope_down_left_short selecting one of 5 per-variant 4-cell records (DATA_13F73F..DATA_13F75F). Entries 0-4 are distinct variants; 5-7 reuse earlier variants in mirrored order.
	dw DATA_13F73F,DATA_13F747,DATA_13F74F,DATA_13F757,DATA_13F75F,DATA_13F75F,DATA_13F757,DATA_13F73F

CODE_13F777:
CODE_stamp_slope_down_left_short:                                     ; Bank13 per-cell stamp for object $E6. On row 2 + last column applies the right-edge fix-up (CODE_slope_fix_right_edge), sets $9B=1 (signals "narrow slope" to body helper), PRNG-picks DATA_slope_down_left_short_ptrs[$A1] on row 0, tail-calls CODE_stamp_slope_body_narrow.
	REP.b #$30
	LDA.b $2C
	CMP.w #$0002
	BNE.b CODE_slope_down_left_short_body
	LDA.b $28
	DEC
	CMP.b $2A
	BNE.b CODE_slope_down_left_short_body
	JSR.w CODE_13F7FE
CODE_13F78A:
CODE_slope_down_left_short_body:
	LDA.w #$0001
	STA.b $9B
	LDA.b $2C
	BNE.b CODE_13F79D
	JSL.l CODE_prng
	AND.w #$0007
	ASL
	STA.b $A1
CODE_13F79D:
	LDX.b $A1
	LDA.w DATA_13F767,x
	STA.b $00
	JMP.w CODE_13F9D3

DATA_13F7A7:
	dw $85A7,$020A,$030D,$79B9

DATA_13F7AF:
	dw $85A7,$020A,$030D,$79AC

DATA_13F7B7:
	dw $85A6,$020B,$030D,$79B9

DATA_13F7BF:
	dw $85A7,$020A,$030D,$79B6

DATA_13F7C7:
	dw $85B3,$020A,$030D,$79B9

DATA_13F7CF:
DATA_slope_down_left_half_ptrs:                                     ; 8-pointer dispatch table for CODE_stamp_slope_down_left_half selecting one of 5 per-variant 4-cell records (DATA_13F7A7..DATA_13F7C7). Same 5-distinct + 3-mirror layout as DATA_slope_down_left_short_ptrs.
	dw DATA_13F7C7,DATA_13F7BF,DATA_13F7B7,DATA_13F7AF,DATA_13F7A7,DATA_13F7BF,DATA_13F7AF,DATA_13F7A7

CODE_13F7DF:
CODE_stamp_slope_down_left_half:                                     ; Bank13 per-cell stamp for object $E7. Sets $9B=1 (narrow signal), PRNG-picks DATA_slope_down_left_half_ptrs[$A1] on row 0, tail-calls CODE_stamp_slope_body_narrow. Also reused as a sub-call by the shoreline-slope dispatcher (CODE_13FA1B) for objects $EB/$EC.
	REP.b #$30
	LDA.w #$0001
	STA.b $9B
	LDA.b $2C
	BNE.b CODE_13F7F4
	JSL.l CODE_prng
	AND.w #$0007
	ASL
	STA.b $A1
CODE_13F7F4:
	LDX.b $A1
	LDA.w DATA_13F7CF,x
	STA.b $00
	JMP.w CODE_13F9D3

CODE_13F7FE:
CODE_slope_fix_left_edge:                                     ; Shared edge-fix helper used by slope stamps. Probes left-neighbour tile (via CODE_probe_left_tile), and if it's a regular ground tile ($79D8 or $79D9), overwrites with $79C9 (slope-meets-ground corner tile) for a clean blend.
	JSR.w CODE_probe_left_tile
	CMP.w #$79D8
	BEQ.b CODE_13F80B
	CMP.w #$79D9
	BNE.b CODE_13F812
CODE_13F80B:
	LDA.w #$79C9
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13F812:
	RTS

CODE_13F813:
CODE_slope_fix_right_edge:                                     ; Mirror of CODE_slope_fix_left_edge: probes right-neighbour tile and, if it's $79D6 or $79D7, overwrites with $79C8 (right-side slope-meets-ground corner) for a clean blend.
	JSR.w CODE_probe_right_tile
	CMP.w #$79D6
	BEQ.b CODE_13F820
	CMP.w #$79D7
	BNE.b CODE_13F827
CODE_13F820:
	LDA.w #$79C8
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13F827:
	RTS

DATA_13F828:
	dw $0000,$0000,$85AD,$85B1,$0F11,$100E,$79B2,$79BE

DATA_13F838:
	dw $0000,$0000,$85AD,$85B1,$0F10,$100E,$79AF,$79B7

DATA_13F848:
	dw $0000,$0000,$85AD,$85B2,$0F10,$100F,$79B3,$79B4

DATA_13F858:
	dw $85C3,$0000,$85AE,$85B1,$0F10,$100E,$79C2,$79B6

DATA_13F868:
	dw $85C2,$85C3,$85AF,$85B0,$0F11,$100E,$79B2,$79BE

DATA_13F878:
DATA_slope_down_right_ptrs:                                     ; 8-pointer dispatch table for CODE_stamp_slope_down_right_long selecting one of 5 per-variant 8-cell records (DATA_13F828..DATA_13F868). 5 distinct variants + 3 mirror reuses, matching the sibling down-left table layout.
	dw DATA_13F828,DATA_13F838,DATA_13F848,DATA_13F858,DATA_13F868,DATA_13F868,DATA_13F858,DATA_13F828

CODE_13F888:
CODE_stamp_slope_down_right_long:                                     ; [decorator] Bank13 per-cell stamp for object $E8. Mirror of CODE_stamp_slope_down_left_long: edge-fix probes at the first column instead of the last (with CODE_slope_fix_left_edge on row 1 / right_edge on row 2 last column), PRNG-picks DATA_slope_down_right_ptrs[$A1] on row 0, then tail-calls CODE_stamp_slope_body_shared.
	REP.b #$30
	STZ.b $9B
	LDA.b $2C
	CMP.w #$0001
	BNE.b CODE_slope_down_right_long_row2_first
	LDA.b $28
	BNE.b CODE_slope_down_right_long_body
	JSR.w CODE_13F7FE
	BRA.b CODE_slope_down_right_long_body

CODE_13F89C:
CODE_slope_down_right_long_row2_first:
	CMP.w #$0002
	BNE.b CODE_slope_down_right_long_body
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_slope_down_right_long_body
	JSR.w CODE_13F813
CODE_13F8AB:
CODE_slope_down_right_long_body:
	LDA.b $28
	AND.w #$0001
	STA.b $00
	BEQ.b CODE_13F8BD
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_13F8BD
	INC.b $9B
CODE_13F8BD:
	LDA.b $00
	BNE.b CODE_13F8EB
	LDA.b $2C
	BNE.b CODE_13F8EB
	JSL.l CODE_prng
	AND.w #$0007
	ASL
	STA.b $A1
	CMP.w #$0004
	BEQ.b CODE_13F8D9
	CMP.w #$0008
	BNE.b CODE_13F8EB
CODE_13F8D9:
	LDX.b $1D
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$9000
	BCC.b CODE_13F8EB
	CMP.w #$9050
	BCS.b CODE_13F8EB
	STZ.b $A1
CODE_13F8EB:
	LDX.b $A1
	LDA.w DATA_13F878,x
	STA.b $02
CODE_13F8F2:
CODE_stamp_slope_body_shared:                                     ; Shared 6-cell-tall slope body helper used by CODE_stamp_slope_down_left_long / CODE_stamp_slope_down_right_long. Rows 0-3 indirect-fetch from the per-variant record (8 words/record, indexed by $2C ASL + $00 ASL); rows 4+ tail-call CODE_jungle_floor_random_fill for the slope's filled interior.
	LDA.b $2C
	CMP.w #$0004
	BCS.b CODE_13F90A
	ASL
	ADC.b $00
	ASL
	TAY
	LDA.b ($02),y
	BEQ.b CODE_slope_body_shared_exit
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	BRA.b CODE_slope_body_shared_exit

CODE_13F90A:
	DEC
	DEC
	DEC
	DEC
	ASL
	STA.b $00
	JSR.w CODE_13F654
CODE_13F914:
CODE_slope_body_shared_exit:
	SEP.b #$30
	RTL

DATA_13F917:
	dw $0000,$85BD,$0A15,$79B7

DATA_13F91F:
	dw $0000,$85BF,$0A16,$79B7

DATA_13F927:
	dw $0000,$85BD,$0A17,$79B8

DATA_13F92F:
	dw $85C3,$85BE,$0A17,$79B8

DATA_13F937:
	dw $85C4,$85C0,$0A15,$79AF

DATA_13F93F:
DATA_slope_down_right_short_ptrs:                                     ; 8-pointer dispatch table for CODE_stamp_slope_down_right_short selecting one of 5 per-variant 4-cell records (DATA_13F917..DATA_13F937). 5 distinct + 3 mirror layout.
	dw DATA_13F917,DATA_13F91F,DATA_13F927,DATA_13F92F,DATA_13F937,DATA_13F937,DATA_13F92F,DATA_13F917

CODE_13F94F:
CODE_stamp_slope_down_right_short:                                     ; Bank13 per-cell stamp for object $E9. Mirror of CODE_stamp_slope_down_left_short: on row 2 + first column applies right-edge fix-up, sets $9B=1, PRNG-picks DATA_slope_down_right_short_ptrs[$A1] on row 0, tail-calls CODE_stamp_slope_body_narrow.
	REP.b #$30
	LDA.b $2C
	CMP.w #$0002
	BNE.b CODE_slope_down_right_short_body
	LDA.b $28
	INC
	CMP.b $2A
	BNE.b CODE_slope_down_right_short_body
	JSR.w CODE_13F813
CODE_13F962:
CODE_slope_down_right_short_body:
	LDA.w #$0001
	STA.b $9B
	LDA.b $2C
	BNE.b CODE_13F975
	JSL.l CODE_prng
	AND.w #$0007
	ASL
	STA.b $A1
CODE_13F975:
	LDX.b $A1
	LDA.w DATA_13F93F,x
	STA.b $00
	JMP.w CODE_13F9D3

DATA_13F97F:
	dw $85B8,$050B,$060D,$79BA

DATA_13F987:
	dw $85B8,$050B,$060D,$79AC

DATA_13F98F:
	dw $85B7,$050A,$060D,$79BA

DATA_13F997:
	dw $85B6,$050B,$060D,$79AF

DATA_13F99F:
	dw $85B6,$050B,$060D,$79BA

DATA_13F9A7:
DATA_slope_down_right_half_ptrs:                                     ; 8-pointer dispatch table for CODE_stamp_slope_down_right_half selecting one of 5 per-variant 4-cell records (DATA_13F97F..DATA_13F99F). 5 distinct + 3 mirror.
	dw DATA_13F99F,DATA_13F997,DATA_13F98F,DATA_13F987,DATA_13F97F,DATA_13F997,DATA_13F987,DATA_13F97F

CODE_13F9B7:
CODE_stamp_slope_down_right_half:                                     ; Bank13 per-cell stamp for object $EA. Mirror of CODE_stamp_slope_down_left_half: $9B=1, PRNG-picks DATA_slope_down_right_half_ptrs[$A1] on row 0, tail-calls CODE_stamp_slope_body_narrow. Also reused by CODE_13FA8E (shoreline-slope right-side variant).
	REP.b #$30
	LDA.w #$0001
	STA.b $9B
	LDA.b $2C
	BNE.b CODE_13F9CC
	JSL.l CODE_prng
	AND.w #$0007
	ASL
	STA.b $A1
CODE_13F9CC:
	LDX.b $A1
	LDA.w DATA_13F9A7,x
	STA.b $00
CODE_13F9D3:
CODE_stamp_slope_body_narrow:                                     ; Shared 4-cell-tall slope body helper used by short / half slope stamps. Rows 0-3 indirect-fetch from the per-variant record (4 words/record, indexed by $2C ASL); rows 4+ tail-call CODE_jungle_floor_random_fill.
	LDA.b $2C
	CMP.w #$0004
	BCS.b CODE_13F9E8
	ASL
	TAY
	LDA.b ($00),y
	BEQ.b CODE_slope_body_narrow_exit
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	BRA.b CODE_slope_body_narrow_exit

CODE_13F9E8:
	DEC
	DEC
	DEC
	DEC
	ASL
	STA.b $00
	JSR.w CODE_13F654
CODE_13F9F2:
CODE_slope_body_narrow_exit:
	SEP.b #$30
	RTL

DATA_13F9F5:
DATA_shoreline_slope_subhandlers:                                     ; 2-pointer dispatch table for CODE_stamp_shoreline_slope_capped: index 0 = CODE_stamp_shoreline_slope_left (CODE_13FA1B), index 1 = CODE_stamp_shoreline_slope_right (CODE_13FA8E).
	dw CODE_13FA1B
	dw CODE_13FA8E

DATA_13F9F9:
DATA_shoreline_sandfill_tiles:                                     ; 4-entry sand-fill tile table ($79AD,$79AE,$79B5,$79DD) used by shoreline-slope handlers to PRNG-replace water-adjacent grass tiles when CODE_get_map16_right / _left lands on a $79xx tile.
	dw $79AD,$79AE,$79B5,$79DD

DATA_13FA01:
DATA_shoreline_endcol_match_tiles:                                     ; 6-entry "match these high-byte patterns to extend the slope cap" table ($0300,$0600,$0800,$0A00,$0C00,$1000) probed by CODE_stamp_shoreline_slope_left / _right at the last row to decide whether to stamp the slope-end corner tile $79C8 / $79C9.
	dw $0300,$0600,$0800,$0A00,$0C00,$1000

CODE_13FA0D:
CODE_stamp_shoreline_slope_capped:                                     ; Bank13 per-cell stamp for objects $EB/$EC. Reads $15 as index into DATA_shoreline_slope_subhandlers, then JSRs CODE_stamp_shoreline_slope_left or _right which add water/sand edge-fix tiles ($79D6-$79E7) on top of the half-slope body.
	REP.b #$30
	LDA.b $1B
	STA.b $0E
	LDX.b $15
	JSR.w (DATA_13F9F5,x)
	SEP.b #$30
	RTL

CODE_13FA1B:
CODE_stamp_shoreline_slope_left:                                     ; [decorator] Sub-handler for object $EB (left-leaning shoreline slope). Rows 0-2 JSL CODE_stamp_slope_down_left_half for the body; rows 3+ stamp $79D6 + $2C parity and probe right neighbour for PRNG sand-fill replacement; last row scans DATA_shoreline_endcol_match_tiles for cap-blend.
	LDA.b $2C
	CMP.w #$0003
	BCS.b CODE_shoreline_slope_left_deep
	JSL.l CODE_13F7DF
	BRA.b CODE_shoreline_slope_left_exit

CODE_13FA28:
CODE_shoreline_slope_left_deep:
	LDA.b $2C
	AND.w #$0001
	CLC
	ADC.w #$79D6
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSL.l CODE_get_map16_right
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$7900
	BNE.b CODE_13FA5A
	STX.b $00
	JSL.l CODE_prng
	AND.w #$0006
	TAY
	LDX.b $00
	LDA.w DATA_13F9F9,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13FA5A:
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_shoreline_slope_left_exit
	JSR.w CODE_probe_left_tile
	LDY.w #$0000
	AND.w #$FF00
CODE_13FA6A:
	CMP.w DATA_13FA01,y
	BEQ.b CODE_13FA84
	INY
	INY
	CPY.w #$000C
	BCC.b CODE_13FA6A
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$85A8
	BCC.b CODE_shoreline_slope_left_exit
	CMP.w #$85B0
	BCS.b CODE_shoreline_slope_left_exit
CODE_13FA84:
	LDX.b $1D
	LDA.w #$79C8
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13FA8D:
CODE_shoreline_slope_left_exit:
	RTS

CODE_13FA8E:
CODE_stamp_shoreline_slope_right:                                     ; [decorator] Sub-handler for object $EC (right-leaning shoreline slope). Mirror of CODE_stamp_shoreline_slope_left: rows 0-2 JSL into CODE_stamp_slope_down_right_half, rows 3+ stamp $79D8 + $2C parity then probe the left neighbour for sand-fill substitution, with end-row $79C9 cap blending.
	LDA.b $2C
	CMP.w #$0003
	BCS.b CODE_shoreline_slope_right_deep
	JSL.l CODE_13F9B7
	BRA.b CODE_shoreline_slope_right_exit

CODE_13FA9B:
CODE_shoreline_slope_right_deep:
	LDA.b $2C
	AND.w #$0001
	CLC
	ADC.w #$79D8
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSL.l CODE_get_map16_left
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$7900
	BNE.b CODE_13FACD
	STX.b $00
	JSL.l CODE_prng
	AND.w #$0006
	TAY
	LDX.b $00
	LDA.w DATA_13F9F9,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13FACD:
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_shoreline_slope_right_exit
	JSR.w CODE_probe_right_tile
	LDY.w #$0000
	AND.w #$FF00
CODE_13FADD:
	CMP.w DATA_13FA01,y
	BEQ.b CODE_13FAF7
	INY
	INY
	CPY.w #$000C
	BCC.b CODE_13FADD
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$85A8
	BCC.b CODE_shoreline_slope_right_exit
	CMP.w #$85B0
	BCS.b CODE_shoreline_slope_right_exit
CODE_13FAF7:
	LDX.b $1D
	LDA.w #$79C9
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13FB00:
CODE_shoreline_slope_right_exit:
	RTS

DATA_13FB01:
DATA_waterfall_subhandlers:                                     ; 3-pointer dispatch table for CODE_stamp_stone_3d_wall: CODE_waterfall_left_cap (CODE_13FB7A) / CODE_waterfall_middle_cap (CODE_13FB7F) / CODE_waterfall_right_cap (CODE_13FB84).
	dw CODE_13FB7A
	dw CODE_13FB7F
	dw CODE_13FB84

DATA_13FB07:
DATA_stone_3d_wall_rowgroups:                                     ; 3-entry row-group index table ($0000,$0003,$0006) for CODE_stamp_stone_3d_wall picking which of the 3 waterfall slice-groups the current row belongs to.
	dw $0000,$0003,$0006

CODE_13FB0D:
CODE_stamp_stone_3d_wall:                                     ; Bank13 per-cell stamp for object $ED. Clamps $2C to 4 max (3 row groups via DATA_stone_3d_wall_rowgroups, row-1 PRNG-promoted to group 2), then JSRs one of CODE_waterfall_left/middle/right_cap. Row 0 has special $79E8->$3D09 substitution (spout tile).
	REP.b #$30
	LDA.b $2C
	EOR.w #$FFFF
	INC
	CMP.w #$0005
	BCC.b CODE_13FB1D
	LDA.w #$0004
CODE_13FB1D:
	AND.w #$0006
	TAY
	LDA.w DATA_stone_3d_wall_rowgroups,y
	STA.b $00
	CMP.w #$0006
	BCS.b CODE_13FB41
	LDA.b $2C
	AND.w #$0001
	BEQ.b CODE_13FB41
	JSL.l CODE_prng
	AND.w #$0002
	BEQ.b CODE_13FB41
	INC.b $00
	INC.b $00
	INC.b $00
CODE_13FB41:
	LDA.b $2C
	EOR.b $28
	EOR.b $15
	AND.w #$0001
	ASL
	TAY
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_13FB5C
	INX
	INX
	INC
	CMP.b $2A
	BNE.b CODE_13FB5C
	INX
	INX
CODE_13FB5C:
	JSR.w (DATA_13FB01,x)
	LDY.b $2C
	BNE.b CODE_13FB6D
	LDA.b $02
	SEC
	SBC.w #$79E8
	CLC
	ADC.w #$3D09
CODE_13FB6D:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13FB76:
DATA_waterfall_left_cap_tiles:                                     ; 2-entry tile table ($79E9,$79E8) for CODE_waterfall_left_cap: picks the leftmost waterfall column's top tile by Y index. Falls through into CODE_waterfall_finish_blend for the additive ADC base layering step.
	dw $79E9,$79E8

CODE_13FB7A:
CODE_waterfall_left_cap:                                     ; Waterfall sub-handler for the leftmost column. Picks $79E9 or $79E8 from DATA_waterfall_left_cap_tiles indexed by Y; falls through into CODE_waterfall_finish_blend to layer ADC base $0 onto the cap.
	LDA.w DATA_13FB76,y
	BRA.b CODE_13FB96

CODE_13FB7F:
CODE_waterfall_middle_cap:                                     ; Waterfall sub-handler for middle columns. Loads $79E9 then falls into CODE_waterfall_left_probe; if column-zero, probes the left neighbour for $79E9-adjusted blend.
	LDA.w #$79E9
	BRA.b CODE_13FB87

CODE_13FB84:
CODE_waterfall_right_cap:                                     ; Waterfall sub-handler for the rightmost column. Loads $79E8 then enters the same CODE_waterfall_left_probe path for left-edge blending logic.
	LDA.w #$79E8
CODE_13FB87:
	TYX
	BEQ.b CODE_13FB96
	JSR.w CODE_probe_left_tile
	SEC
	SBC.w #$79E9
	STA.b $00
	LDA.w #$79EA
CODE_13FB96:
	STA.b $02
	CLC
	ADC.b $00
	RTS

DATA_13FB9C:
DATA_stone_3d_body_subhandlers:                                     ; 2-pointer dispatch table for the CODE_stone_3d_stamp body: index 0 = CODE_stone_3d_body_check_left, index 2 = CODE_stone_3d_body_check_right. Selected by column position relative to $28/$2A.
	dw CODE_stone_3d_body_check_left
	dw CODE_stone_3d_body_check_right

CODE_13FBA0:
CODE_stone_3d_stamp:                                    ; Shared 3D-stone per-cell stamp: object $20 (3D Stone), $EE/$EF (static 3D stone) and $F0-$F3 (moving 3D stone) all route here. Upper rows (row<3, the cap) JSR CODE_stone_3d_cap_select to pick from DATA_stone_3d_cap_tiles / _alt / _wall / _wall_alt (3-entry tile sets keyed on edge / neighbour probes); rows 3+ stamp the body ($0108-family, parity in $A1) via the DATA_stone_3d_body_subhandlers handlers + neighbour fixups CODE_stone_3d_body_shape_select / CODE_stone_3d_neighbour_fixup. Auto-toggles $A1 parity at end-of-column. NOT a pipe stamp: the real vertical pipes ($3C/$F4) use CODE_pipe_vertical_dispatch ($13:A033). NOT shore/pool either: object $1F (wavy lava) uses CODE_lava_stamp, not this routine.
	REP.b #$30
	LDA.b $2C
	ASL
	TAY
	CPY.w #$0006
	BCS.b CODE_stone_3d_stamp_body
	JSR.w CODE_stone_3d_cap_select
	BRA.b CODE_stone_3d_stamp_store

CODE_13FBB0:
CODE_stone_3d_stamp_body:
	LDA.b $2C
	EOR.b $A1
	AND.w #$0001
	CLC
	ADC.w #$0108
	STA.b $04
	LDX.w #$0000
	LDA.b $28
	BEQ.b CODE_13FBCB
	INC
	CMP.b $2A
	BNE.b CODE_13FBD0
	INX
	INX
CODE_13FBCB:
	LDA.b $04
	JSR.w (DATA_stone_3d_body_subhandlers,x)
CODE_13FBD0:
	LDA.b $15
	BEQ.b CODE_stone_3d_stamp_store
	JSR.w CODE_stone_3d_body_shape_select
	LDA.b $15
	BMI.b CODE_stone_3d_stamp_store
	JSR.w CODE_stone_3d_neighbour_fixup
CODE_13FBDE:
CODE_stone_3d_stamp_store:
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_13FBEC
	LDA.b $A1
	EOR.w #$0001
	STA.b $A1
CODE_13FBEC:
	LDA.b $04
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_13FBF7:
DATA_stone_3d_cap_tiles:                                     ; 3-entry tile-group ($0028,$0100,$0103) for the pipe cap top row when in plain orientation: left-cap / left-body-link / right-body-link.
	dw $0028,$0100,$0103

DATA_13FBFD:
DATA_stone_3d_cap_tiles_alt:                                     ; 3-entry alternate cap tile-group ($002D,$010A,$0105) for the pipe cap row when neighbour-fix or $15-rotated variant is needed.
	dw $002D,$010A,$0105

DATA_13FC03:
DATA_stone_3d_cap_tiles_wall:                                     ; 3-entry "embedded in left wall" cap tile-group ($0028,$9C00,$0103) selected when $15=$8000 and column is mid-pipe.
	dw $0028,$9C00,$0103

DATA_13FC09:
DATA_stone_3d_cap_tiles_wall_alt:                                     ; 3-entry "embedded in right wall" cap tile-group ($002D,$9C03,$0105)  counterpart of DATA_stone_3d_cap_tiles_wall for the flipped wall orientation.
	dw $002D,$9C03,$0105

CODE_13FC0F:
CODE_stone_3d_cap_select:                                     ; Pipe cap-row sub-handler. Adds $A1 to DATA_stone_3d_cap_tiles[y]; at last column, probes left for pipe-edge tiles ($0029/$002D/$0101/$010A/$0104/$0105) to either continue cap (INC tile) or pick a $15-driven alternate cap group.
	LDA.w DATA_stone_3d_cap_tiles,y
	CLC
	ADC.b $A1
	STA.b $04
	LDA.b $28
	BEQ.b CODE_13FC4D
	INC
	CMP.b $2A
	BNE.b CODE_13FC44
	JSR.w CODE_probe_left_tile
	CMP.w #$0029
	BEQ.b CODE_13FC60
	CMP.w #$002D
	BEQ.b CODE_13FC60
	CMP.w #$0101
	BEQ.b CODE_13FC60
	CMP.w #$010A
	BEQ.b CODE_13FC60
	CMP.w #$0104
	BEQ.b CODE_13FC60
	CMP.w #$0105
	BEQ.b CODE_13FC60
	INC
	BRA.b CODE_13FC6F

CODE_13FC44:
	LDA.b $15
	CMP.w #$8000
	BEQ.b CODE_13FC54
	BRA.b CODE_13FC71

CODE_13FC4D:
	LDA.b $15
	CMP.w #$8000
	BNE.b CODE_13FC5C
CODE_13FC54:
	LDA.w DATA_stone_3d_cap_tiles_wall,y
	CLC
	ADC.b $A1
	BRA.b CODE_13FC6F

CODE_13FC5C:
	LDA.b $A1
	BEQ.b CODE_13FC71
CODE_13FC60:
	LDA.b $15
	CMP.w #$8000
	BNE.b CODE_13FC6C
	LDA.w DATA_stone_3d_cap_tiles_wall_alt,y
	BRA.b CODE_13FC6F

CODE_13FC6C:
	LDA.w DATA_stone_3d_cap_tiles_alt,y
CODE_13FC6F:
	STA.b $04
CODE_13FC71:
	RTS

CODE_13FC72:
CODE_stone_3d_body_check_left:                                     ; Pipe body sub-handler for leftish column. If currently-derived tile is $0109 (right-body) but left neighbour isn't $0108, demote to $0106 (single-stem cap) for clean shape.
	CMP.w #$0109
	BNE.b CODE_13FC93
	JSR.w CODE_probe_left_tile
	CMP.w #$0108
	BEQ.b CODE_13FC93
	BRA.b CODE_13FC8E

CODE_13FC81:
CODE_stone_3d_body_check_right:                                     ; Pipe body sub-handler for rightish column. Mirror of CODE_stone_3d_body_check_left: if currently $0108 but right neighbour isn't $0109, demote to $0106.
	CMP.w #$0108
	BNE.b CODE_13FC93
	JSR.w CODE_probe_right_tile
	CMP.w #$0109
	BEQ.b CODE_13FC93
CODE_13FC8E:
	LDA.w #$0106
	STA.b $04
CODE_13FC93:
	RTS

DATA_13FC94:
DATA_stone_3d_body_main_tiles:                                     ; 8-entry main pipe-body tile table ($0108x3,$79E2x2,$79E5x2,$79E7) used by CODE_stone_3d_body_shape_select for the deep-row body fill.
	dw $0108,$0108,$0108,$79E2,$79E2,$79E5,$79E5,$79E7

DATA_13FCA4:
DATA_stone_3d_body_alt_tiles:                                     ; 4-entry alternate body tile table ($0106,$79E1,$79E4,$79E7) used by CODE_stone_3d_body_shape_select for variant body fill.
	dw $0106,$79E1,$79E4,$79E7

CODE_13FCAC:
CODE_stone_3d_body_shape_select:                                     ; Pipe body shape-pick helper. Branches on the candidate tile in $04: $0106 paths PRNG-pick from DATA_stone_3d_body_alt_tiles; $0109/$79E3/$79E6 paths probe the left neighbour and either keep or INC the tile; otherwise PRNG + $2C-driven dispatch into DATA_stone_3d_body_main_tiles.
	LDA.b $04
	CMP.w #$0106
	BEQ.b CODE_13FCD2
	CMP.w #$0109
	BEQ.b CODE_13FCC2
	CMP.w #$79E3
	BEQ.b CODE_13FCC2
	CMP.w #$79E6
	BNE.b CODE_13FCF0
CODE_13FCC2:
	JSR.w CODE_probe_left_tile
	CMP.w #$0000
	BEQ.b CODE_13FD0F
	CMP.w #$79E7
	BEQ.b CODE_13FD0F
	INC
	BRA.b CODE_13FD0F

CODE_13FCD2:
	LDA.b $2C
	DEC
	DEC
	DEC
	CMP.w #$0006
	BCC.b CODE_13FCE7
	JSL.l CODE_prng
	AND.w #$0002
	CLC
	ADC.w #$0004
CODE_13FCE7:
	AND.w #$0006
	TAY
	LDA.w DATA_stone_3d_body_alt_tiles,y
	BRA.b CODE_13FD0F

CODE_13FCF0:
	JSL.l CODE_prng
	AND.w #$0003
	CLC
	ADC.b $2C
	ASL
	CMP.w #$0016
	BCC.b CODE_13FD0B
	JSL.l CODE_prng
	AND.w #$0002
	CLC
	ADC.w #$0012
CODE_13FD0B:
	TAY
	LDA.w DATA_stone_3d_body_main_tiles-$06,y
CODE_13FD0F:
	STA.b $04
	RTS

DATA_13FD12:
DATA_stone_3d_joint_tiles:                                     ; 3-entry table ($7792,$7793,$0000) for CODE_stone_3d_neighbour_fixup floor-joint tiles.
	dw $7792,$7793,$0000

CODE_13FD18:
CODE_stone_3d_neighbour_fixup:                                     ; Pipe shape post-fixup. If current tile is in $77xx range or specific pipe IDs, swaps in a different "joint" tile from DATA_stone_3d_joint_tiles ($7792/$7793) or computes ($04-$79E1)+$778C  handles where pipes meet floor / ceiling cleanly.
	LDX.w #$0000
	LDA.b $04
	AND.w #$FF00
	CMP.w #$7700
	BEQ.b CODE_13FD53
	LDA.b $04
	CMP.w #$0000
	BEQ.b CODE_13FD53
	CMP.w #$0106
	BEQ.b CODE_13FD53
	CMP.w #$0108
	BEQ.b CODE_13FD44
	INX
	INX
	CMP.w #$0109
	BEQ.b CODE_13FD44
	INX
	INX
	CMP.w #$79E7
	BNE.b CODE_13FD49
CODE_13FD44:
	LDA.w DATA_stone_3d_joint_tiles,x
	BRA.b CODE_13FD51

CODE_13FD49:
	SEC
	SBC.w #$79E1
	CLC
	ADC.w #$778C
CODE_13FD51:
	STA.b $04
CODE_13FD53:
	RTS

;-------------------------------------------------------------------------
; CODE_probe_left_tile -- "probe-left-and-fetch" intra-bank helper. Sets the probe
; position $0E to the walker's current cell $1B, JSLs the Bank12 get-left
; primitive, and returns A = the Map16 ID at the cell to the left. Used by
; bank13 shape-fix handlers (e.g. CODE_stone_3d_body_shape_select, CODE_stone_3d_body_check_left) to check
; "is the tile next to me one I should continue or change?".
;-------------------------------------------------------------------------
CODE_13FD54:
CODE_probe_left_tile:                                            ; descriptive alias
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_left                                         ; CODE_get_map16_left
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

;-------------------------------------------------------------------------
; CODE_probe_right_tile -- "probe-right-and-fetch" intra-bank helper. Same shape as
; CODE_probe_left_tile but for the cell to the RIGHT. Used by the floor-shape-fix
; helpers in CODE_bg_floor_random_seam_fix etc., and by CODE_stone_3d_body_check_right / CODE_stone_3d_body_shape_select.
;-------------------------------------------------------------------------
CODE_13FD61:
CODE_probe_right_tile:                                           ; descriptive alias
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_right                                         ; CODE_get_map16_right
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

;-------------------------------------------------------------------------
; CODE_stamp_spike -- per-cell stamper for the CODE_init_spike init handler family.
; Two-tile column: row 0 stamps Map16 $8413, every other row stamps $2910.
; No shape-awareness, no template checks -- just "top tile or body tile".
;-------------------------------------------------------------------------
CODE_13FD6E:
CODE_stamp_spike:
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_13FD79
	LDA.w #$8413                                              ; top-of-column tile
	BRA.b CODE_13FD7C

CODE_13FD79:
	LDA.w #$2910                                              ; body-of-column tile
CODE_13FD7C:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

;-------------------------------------------------------------------------
; CODE_decoration_overlay -- per-cell stamper for the CODE_12A3D1 init handler.
; "Stamp Map16 $9D8B only if the cell is currently empty (Map16 ID 0)".
; Used by decoration-overlay objects that mustn't paint over already-set
; terrain.
;-------------------------------------------------------------------------
CODE_13FD85:
CODE_decoration_overlay:                                         ; Per-cell stamp for std-object $F6: read the cell from !RAM_YI_Level_LevelDataBuffer; if non-empty, skip (BNE); else write Map16 $9D8B. Read-conditional overlay -- never overwrites existing terrain. Paired with CODE_init_decoration_overlay in Bank12.
	REP.b #$30
	LDX.b $1D
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	BNE.b CODE_13FD96                                         ; cell already has a tile -> skip
	LDA.w #$9D8B                                              ; decoration tile
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_13FD96:
	SEP.b #$30
	RTL

;=========================================================================
; Cinema yoshi-path tables ($13:FD99 - $13:FE58).
; Drives the between-world cinematic where Yoshi flies/runs across the world
; map. Raidenthequick is the source for this annotation -- they identified
; all 6 worlds' path data here.
; See also: ys_mpmv.asm (overworld-map movement / cinema-path data parallels).
;=========================================================================

;-------------------------------------------------------------------------
; Per-world pointer table -- 6 entries, each a 16-bit offset (relative to
; DATA_yoshi_cinema_path_data below) to that world's yoshi-path record list.
;   index 0 (world 1) -> +$0000  (5 records,  $13:FDA5)
;   index 1 (world 2) -> +$0014  (5 records,  $13:FDB9)
;   index 2 (world 3) -> +$0028  (6 records,  $13:FDCD)
;   index 3 (world 4) -> +$0040  (5 records,  $13:FDE5)
;   index 4 (world 5) -> +$0054  (17 records, $13:FDF9 -- the long one)
;   index 5 (world 6) -> +$0098  (7 records,  $13:FE3D)
; Raidenthequick alias: DATA_yoshi_cinema_path_ptrs.
;-------------------------------------------------------------------------
DATA_13FD99:
DATA_yoshi_cinema_path_ptrs:                                     ; descriptive alias
	dw $0000,$0014,$0028,$0040,$0054,$0098

;-------------------------------------------------------------------------
; Yoshi cinema path data -- 4 bytes per waypoint record:
;   byte 0  -- flags (high bit $80 marks the last record in the list)
;   byte 1  -- X coordinate (sub-pixel / map space)
;   byte 2  -- Y coordinate (sub-pixel / map space)
;   byte 3  -- extra (timing / speed / map page; world 5 records use it)
; Records are concatenated; each world's list ends at the record whose
; byte-0 high bit is set.
; Raidenthequick alias: DATA_yoshi_cinema_path_data.
;-------------------------------------------------------------------------
DATA_13FDA5:
DATA_yoshi_cinema_path_data:                                     ; descriptive alias
; World 1 path (5 records, terminator has byte 0 = $80)
	dw $D600,$0060,$BB00,$0054,$A200,$0031,$C100,$0015
	dw $A180,$0021
; World 2 path (5 records)
	dw $9E00,$0021,$A900,$00DF,$BD00,$00AF
	dw $D700,$00CE,$C880,$00BB
; World 3 path (6 records)
	dw $DB00,$00B4,$E900,$00A6
	dw $0F00,$00A4,$2000,$00B9,$1800,$00EF,$2080,$00B9
; World 4 path (5 records)
	dw $6100,$0000,$6100,$001C,$4100,$0038,$2400,$0030
	dw $3480,$0040
; World 5 path (17 records -- by far the longest, traverses the most map pages)
	dw $2100,$0065,$E800,$005B,$E600,$001C
	dw $C900,$1019,$C400,$200A,$D600,$3002,$D700,$3314
	dw $D000,$340C,$D200,$37FF,$D300,$3BF1,$D600,$43E3
	dw $E000,$45E9,$EA00,$4CEF,$F700,$53F5,$F700,$5501
	dw $F800,$5B0F,$FB80,$5C2A
; World 6 path (7 records)
	dw $E000,$00D6,$FA00,$00A7
	dw $2B00,$00C0,$5000,$00F3,$5300,$002C,$2100,$0026
	dw $0480,$0015

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($13FE59, incbin, DATA_13FE59_YI_U2.bin)
else
	%FREE_BYTES($13FE59, 423, $FF)
endif
%BANK_END(<EndBank>)
endmacro
