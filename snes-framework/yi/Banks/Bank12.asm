;#############################################################################################################
;# Bank12.asm -- bank $12 level-data engine: dispatch tables + Map16 tile walker + per-object init handlers
;#               + per-mini-battle LevelData blobs.
;#
;# This bank (with Bank13) implements the YI "object realiser" -- the routines that consume the
;# per-level object stream (variable-width records in the .bin level files) and stamp Map16 tile
;# indices into the live level-data buffer at !RAM_YI_Level_LevelDataBuffer ($7F:8000, 1 byte per
;# Map16 cell, 512 bytes per screen, 64 screens per level).
;#
;# Caller pipeline (verified by cross-referencing Bank01.asm and Bank10.asm):
;#
;#   Bank01 game-mode 0E handler at $01:B084  reads ROM-side level pointer table:
;#       LDA YI_LevelDataPtrsAndEntranceData_Ptrs,x  ->  !RAM_YI_Level_LevelDataPtr* ($000032-34)
;#   Bank01 then JSL's $00:BA24 / $00:BDA2 / $01:D5B3 / etc. which eventually call
;#       Bank10 CODE_unpack_level_header (UnpackLevelHeader) and CODE_unpack_header_then_load_objects (LoadLevelData).
;#   Bank10 CODE_unpack_header_then_load_objects is the LEVEL-DATA STREAM PARSER -- the ONE place that decides "is this
;#       byte an extended-object marker, a standard object, or the $FF terminator", reads the
;#       per-object width/height parameters, then dispatches into Bank12 via PHA/RTL with
;#       the per-object handler pointer from one of the two tables below. The handler returns
;#       (via implicit RTS at end-of-handler) back into Bank10's main loop CODE_108BAF.
;#       Bank12's walker entry CODE_object_stream_walk is only invoked WITHIN Bank12 (by handlers that
;#       need to recurse over a sub-rectangle of tiles -- e.g. multi-row slope/extension blobs).
;#
;# Contents at a glance:
;#   $12:8000-$12:81FD   DATA_extended_object_init_ptrs -- EXTENDED-object init pointer table.
;#                       Indexed by the EXTENDED-object ID byte (the byte that follows the leading
;#                       $00 marker in a 4-byte extended-object record: $00, XXXXYYYY, xxxxyyyy, ext-ID).
;#                       Entries 0..255 (~190 active, ~50 zero-padded mid-table for unused slots,
;#                       then 4 final entries at $1280F8). Each entry is `dw CODE_xxx-$01` for the
;#                       standard 65816 indirect-RTS dispatch (`RTL` from Bank10 pops PC = pulled
;#                       value + 1).  Verified caller: Bank10 CODE_108C13.
;#   $12:81FE-$12:84EB   DATA_standard_object_init_ptrs -- STANDARD-object init pointer table.
;#                       Indexed by the standard-object ID (the first byte of a non-$00, non-$FF
;#                       object record). 366 entries (= 2 * $00..$5A worth), each `dw CODE_xxx-$01`.
;#                       Verified caller: Bank10 CODE_108C33.
;#   $12:83EC-$12:84EB   UNK_standard_object_padding -- 256 bytes (`db $00.../$FF.../$00...` padding region).
;#                       This sits INSIDE the DATA_standard_object_init_ptrs table footprint -- it's a zero-init
;#                       padding range, not a separate table consumed at runtime.
;#   $12:84EC-$12:85EB   DATA_object_property_table -- STANDARD-object PROPERTY TABLE (256 bytes, 1 byte per
;#                       standard-object ID). Verified caller: Bank10 CODE_108C33 reads the byte
;#                       at offset `id`. Bottom 2 bits select per-object stream-record width:
;#                         %00 -> read 1 extra byte (length) -> $2A, height defaulted (4-byte object)
;#                         %01 -> read 1 extra byte (height) -> $2E, length defaulted (4-byte object)
;#                         %10 -> read 2 extra bytes (length, height) -> $2A, $2E (5-byte object)
;#                         %11 -> sentinel ($FF in slot 0 of table; not reached by valid streams)
;#                       High bits ($40, $80, $C0) are observed in entries like $C2, $C0, $80, $41,
;#                       $42, $82 -- these MAY encode further per-object flags but no Bank10
;#                       consumer reads them; they are likely vestiges of an earlier engine version
;#                       or are read by per-object handlers via $1284EC,x without going through
;#                       Bank10. NOTE: the actual Bank10 code uses AND #$0003 (bottom 2 bits)
;#                       for the width-mode discrimination. The table is verified at cart PC
;#                       $0904EC.
;#   $12:85EC-$12:86C8   CODE_object_stream_walk -- INTRA-OBJECT MAP16 WALKER (CODE_object_stream_walk).
;#                       NOT the master object-stream parser (that lives in Bank10 at $108B5D).
;#                       This walker is invoked BY per-object init handlers (and by other walker
;#                       entrypoints in this bank) when a SINGLE object needs to expand into a
;#                       rectangle of Map16 cells. The walker iterates $19 rows x $2A cols using
;#                       the zero-page contract documented in detail at CODE_object_stream_walk, calling
;#                       CODE_get_current_map16_tile to fetch the current tile then dispatching back to handlers
;#                       at $1F/$22/$25 / $21/$24/$27 (per-row / per-col handler pointers stashed
;#                       in zero-page) to decide each cell's Map16 ID.
;#   $12:86C9-$12:86D4   DATA_walker_cell_byte_delta/CD/D1 -- 3 little 2-entry word tables used by the walker
;#                       for column-step bookkeeping (column-pitch, page-wrap mask, X delta).
;#   $12:86D5-$12:86FC   CODE_walker_rewind_nibble -- "rewind to start of current row" helper used by the
;#                       walker when a multi-row object wraps.
;#   $12:86FD-$12:8826   MAP16 FETCH PRIMITIVES (Raidenthequick-documented):
;#                         CODE_get_current_map16_tile  CODE_get_current_map16_tile    (reads $1B/$1C, JSL-target from
;#                                                                 walker)
;#                         CODE_get_map16_above  CODE_get_map16_above            (reads $0E/$0F + $2C)
;#                         CODE_get_map16_below  CODE_get_map16_below
;#                         CODE_get_map16_left  CODE_get_map16_left
;#                         CODE_get_map16_right  CODE_get_map16_right
;#                       All five share the convention: low byte = nibble-interleaved sub-screen
;#                       coords, high byte = nibble-interleaved screen coords, with the per-row
;#                       pitch read from the table at WRAM $6CA9 (the row-base lookup).
;#                       Output: X = absolute byte index into !RAM_YI_Level_LevelDataBuffer.
;#                       Called extensively from Bank13 handlers (114 JSL.l sites total:
;#                       44 above + 42 below + 15 left + 13 right) and Bank12 (26 sites).
;#   $12:8824-$12:8874   CODE_resolve_screen_page -- "resolve screen-index to LevelDataBuffer offset", and
;#                       CODE_resolve_screen_walk_lru/CODE_resolve_screen_claim -- "allocate a new screen page when an unmapped
;#                       cell is touched" (the `$0D4D`/`$0D4E,y`/`$6CAA,x` page-LRU machinery).
;#                       Called by every get_map16_* primitive.
;#   $12:8875-$12:8886   CODE_prng -- 8-bit pseudo-random number generator (LSR of software
;#                       latch + ADC of H/V counter). Called extensively (~50 JSL sites in
;#                       Bank13 to randomise grass/floor decoration variants; ~12 sites in
;#                       Bank12; plus a couple of Bank01 callers in non-level game logic).
;#   $12:8887-$12:8890   DATA_default_handler_extents -- 10-byte tile-orientation lookup used by CODE_extobj_handler_default_00_09.
;#   $12:8891-$12:C708   PER-OBJECT INIT HANDLERS -- ~200 handler routines, mostly dispatched
;#                       from DATA_extended_object_init_ptrs (extended objects). Common pattern (~70% of handlers):
;#                            REP #$20
;#                            LDA #N      ; STA $2A           (col-extent for walker)
;#                            LDA #M      ; STA $2E           (row-extent for walker)
;#                            LDX.b #(CODE_xxxxxx-$01)>>16    ; bank byte
;#                            LDA.w #CODE_xxxxxx-$01          ; handler ptr-1
;#                            JMP CODE_walker_setup_trampoline                 ; walker setup, calls Bank13 handler
;#                       Other handlers do "single-tile stamp" via JSR CODE_get_current_map16_tile + JSL into a
;#                       Bank12 helper that writes one Map16 cell.
;#   $12:C709-$12:FFB3   PER-MINI-BATTLE / OVERFLOW LEVEL DATA -- a sequence of incbin'd .bin
;#                       blobs for level/sprite data that didn't fit elsewhere (object streams for
;#                       levels $06, $3F, $09, $41, $71, $9C, $BA, $11, $49, ..., $92).  Same
;#                       format as Bank11's tail (header+objects+exits / sprites).
;#   $12:FFB4+           garbage data (V1.1) or free-space pad (V1.0).
;#
;# Zero-page contract (used by walker + every per-object handler):
;#   $00, $02     scratch (temp byte-pair for Map16 math)
;#   $0A          scratch (sign-extend length byte from stream)
;#   $0E, $0F     working Map16 position (yyyyxxxx / YYYYXXXX) -- copied from $1B/$1C
;#                inside handlers before they call CODE_get_map16_above/below/left/right.
;#   $12          current tile's Map16 ID (set by CODE_get_current_map16_tile, read by walker dispatch)
;#   $14          per-row accumulator (slope advance)
;#   $15          object ID (standard) OR extended-object byte (set by Bank10 parser)
;#   $17          per-row pitch (slope step per row)
;#   $19          rows-to-walk count (set by handler via $2E? -- contradicts $2E usage below;
;#                actual relation: $2A = col-extent, $2E = row-extent, $19 = end-of-rows compare).
;#   $1B, $1C     current Map16 cell coords (low = xxxxyyyy nibble-interleaved sub-screen,
;#                high = XXXXYYYY nibble-interleaved screen). Initial values set by Bank10
;#                parser at CODE_108BAF from stream bytes 2 and 1 respectively.
;#   $1D          absolute byte offset into !RAM_YI_Level_LevelDataBuffer (set by CODE_get_current_map16_tile).
;#   $1F/$21      per-col handler pointer for left  / right halves of object (alternating cells)
;#   $22/$24      per-col handler pointer ditto
;#   $25/$27      per-row handler pointer
;#   $28          column counter (inside object)
;#   $2A          column extent (number of cols, signed; negative means object grows to the left)
;#   $2B          screen-page hi-nibble carry for row stepping
;#   $2C          row counter (inside object)
;#   $2E          row extent (signed; negative means object grows upward)
;#   $32-$34      !RAM_YI_Level_LevelDataPtr* -- ROM-side pointer to current level's object blob
;#   $99          byte cursor into level-data stream (advanced by Bank10 on each stream read)
;#   $9B          flag scratch ("non-zero = we hit a screen-wrap and must rewind")
;#   $97          number of screens allocated this level so far (page LRU counter)
;#   $0D4D        last-allocated screen-page index in the LRU
;#   $0D4E,y      LRU chain head pointers
;#   $6CAA,x      per-screen page mapping (X = screen # 0..127)
;#   $6CA9        per-screen LevelDataBuffer offset table (CODE_get_map16_above family reads $6CA9,x)
;#
;# Cross-references:
;#   Raidenthequick bank12.asm        -- documents the 5 Map16 fetch primitives at $1286FD/719/75D/
;#                                       7A1/7E2 + the level object table at $1284EC. Everything
;#                                       else (the dispatch tables, the walker, the per-object
;#                                       handlers) was left anonymous.
;#   Bank10.asm CODE_unpack_header_then_load_objects family    -- the MASTER level-data stream parser; THE caller of the
;#                                       two pointer tables here.
;#   Bank13.asm                       -- continuation of the per-object handler body (300+ more
;#                                       handlers, same conventions).
;#   docs/leveldataengine.md          -- standalone engine reference covering this whole pipeline
;#       (level data format S2, dispatch tables S3.2, object-property table bit layout S3.3,
;#       per-object handler categorisation S4); covers the level/sprite stream format,
;#       MAP16 page+index scheme, and pointer-table semantics.
;#
;# See also (sibling reference files):
;#   ys_bgsc.asm     -- BG-scene root (top-level object-stream entry / object dispatch)
;#   ys_bgsc0.asm    -- BG-scene variant 0 (small init-handler bodies; parallels many
;#                       of the thin CODE_1288xx/1289xx wrappers in this bank)
;#   ys_bgsc1.asm    -- BG-scene variant 1 (the big per-cell stamp routine bodies;
;#                       parallels Bank13's ~600 handlers, NOT this bank)
;#   ys_bgsc2.asm    -- BG-scene variant 2 (cell-fetch helpers; parallels the
;#                       Map16 fetch primitives CODE_get_current_map16_tile/719/75D/7A1/7E2 and
;#                       the page-LRU resolver CODE_resolve_screen_page)
;#############################################################################################################
macro YIBank12Macros(StartBank, EndBank)
%BANK_START(<StartBank>)

;=========================================================================
; DATA_extended_object_init_ptrs -- EXTENDED-OBJECT INIT POINTER TABLE
;
; Indexed by:    the EXTENDED-object byte (the 4th byte of a 4-byte extended-
;                object record: $00, XXXXYYYY, xxxxyyyy, ext-ID).
; Used by:       Bank10 CODE_108C13. After Bank10 reads the leading $00
;                marker + XY position bytes, it reads ext-ID -> $15, then:
;                    LDA $15; AND #$00FF; ASL; TAX
;                    LDA DATA_extended_object_init_ptrs,x       ; pull handler pointer-1
;                    PHA; SEP #$30; RTL      ; RTL pops handler PC
;                The pushed-pointer-minus-one + RTL convention adds 1 back
;                so the handler body starts executing at CODE_xxxxxx.
; Entry format:  2 bytes per entry = `dw CODE_xxxxxx-$01`. 256 entries
;                ($000-$0FF * 2 = 512 bytes total). Many slots share a
;                single handler -- e.g. ext-IDs $00-$09 ALL route to
;                CODE_extobj_handler_default_00_09 (the "common-orientation tile" handler that
;                pulls per-byte orientation from DATA_default_handler_extents). The dense
;                clustering reflects per-shape grouping: whole runs of
;                related shapes share a single dispatch entry.
; Notes:
;   - Entries $C0-$ED ($1280E0-$12813A) are all $0000 -- vestigial /
;     unallocated extended-object slots. (Asar emits them as `dw $0000`
;     below; Bank10 indexes by ID without bounds check, but valid extended
;     streams never reference an unallocated ID.)
;   - Entries $EE-$F1 ($1281DC-$1281E3) house the last 4 active extended-
;     object handlers (CODE_extobj_FB_copy_screen_exit/179/17A/186) before the table ends.
;   - Total table footprint $128000-$1281FD (510 bytes used, $1FE byte
;     boundary to the next table at DATA_standard_object_init_ptrs).
; See also: ys_bgsc0.asm (extended-object dispatch parallel).
;=========================================================================
DATA_128000:
DATA_extended_object_init_ptrs:                                           ; descriptive alias
	dw CODE_extobj_handler_default_00_09-$01
	dw CODE_extobj_handler_default_00_09-$01
	dw CODE_extobj_handler_default_00_09-$01
	dw CODE_extobj_handler_default_00_09-$01
	dw CODE_extobj_handler_default_00_09-$01
	dw CODE_extobj_handler_default_00_09-$01
	dw CODE_extobj_handler_default_00_09-$01
	dw CODE_extobj_handler_default_00_09-$01
	dw CODE_extobj_handler_default_00_09-$01
	dw CODE_extobj_handler_default_00_09-$01
	dw CODE_extobj_handler_single_tile_variant_2-$01
	dw CODE_extobj_handler_single_tile_variant_2-$01
	dw CODE_extobj_handler_single_tile_variant_3-$01
	dw CODE_extobj_handler_8x16_block-$01
	dw CODE_extobj_handler_8x16_block-$01
	dw CODE_extobj_handler_single_cell_dispatch-$01
	dw CODE_extobj_handler_16x32_block-$01
	dw CODE_extobj_handler_1x1_block-$01
	dw CODE_extobj_handler_pair_dispatch-$01
	dw CODE_extobj_handler_pair_dispatch-$01
	dw CODE_extobj_handler_slope_pair-$01
	dw CODE_extobj_handler_slope_pair-$01
	dw CODE_extobj_handler_stake_single-$01
	dw CODE_extobj_handler_special_coin-$01
	dw CODE_extobj_handler_demo_setpiece_16x16-$01
	dw CODE_extobj_handler_finalboss_setpiece_24x3-$01
	dw CODE_extobj_handler_finalboss_setpiece_32x12-$01
	dw CODE_extobj_handler_world6_bone_variant1-$01
	dw CODE_extobj_handler_world6_bone_variant2-$01
	dw CODE_extobj_handler_world6_bone_variant3-$01
	dw CODE_extobj_handler_double_teleport_hole-$01
	dw CODE_extobj_handler_double_teleport_door-$01
	dw CODE_extobj_handler_null-$01
	dw CODE_extobj_handler_null-$01
	dw CODE_extobj_handler_null-$01
	dw CODE_extobj_handler_null-$01
	dw CODE_extobj_handler_null-$01
	dw CODE_extobj_handler_null-$01
	dw CODE_extobj_handler_null-$01
	dw CODE_extobj_handler_null-$01
	dw CODE_extobj_handler_null-$01
	dw CODE_extobj_handler_null-$01
	dw CODE_extobj_handler_null-$01
	dw CODE_extobj_handler_null-$01
	dw CODE_extobj_handler_null-$01
	dw CODE_extobj_handler_null-$01
	dw CODE_extobj_handler_null-$01
	dw CODE_extobj_handler_null-$01
	dw CODE_extobj_handler_castle_wall_hole_2x2-$01
	dw CODE_extobj_handler_moving_wall_6x7-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_wall_decal_family-$01
	dw CODE_extobj_handler_random_question_block-$01
	dw CODE_extobj_handler_bg_home_set-$01
	dw CODE_extobj_handler_goal_pole-$01
	dw CODE_extobj_handler_treetop_grass-$01
	dw CODE_extobj_handler_tree_right_grass-$01
	dw CODE_extobj_handler_tree_left_grass-$01
	dw CODE_extobj_handler_mouse_hole-$01
	dw CODE_extobj_handler_mid_grass_2x2-$01
	dw CODE_extobj_handler_upward_grass_1x2-$01
	dw CODE_extobj_handler_downward_grass_single-$01
	dw CODE_extobj_handler_arrow_sign_2x2_overlay-$01
	dw CODE_extobj_handler_spike_mace_center-$01
	dw CODE_extobj_handler_spike_mace_room-$01
	dw CODE_extobj_handler_spike_ball_room-$01
	dw CODE_extobj_handler_treetop_3x3_pair-$01
	dw CODE_extobj_handler_treetop_3x3_pair-$01
	dw CODE_extobj_handler_treetop_5x3_pair-$01
	dw CODE_extobj_handler_treetop_5x3_pair-$01
	dw CODE_extobj_handler_tree_left_3x2_trio-$01
	dw CODE_extobj_handler_tree_left_3x2_trio-$01
	dw CODE_extobj_handler_tree_left_3x2_trio-$01
	dw CODE_extobj_handler_tree_right_3x2_trio-$01
	dw CODE_extobj_handler_tree_right_3x2_trio-$01
	dw CODE_extobj_handler_tree_right_3x2_trio-$01
	dw CODE_extobj_handler_donut_block_small-$01
	dw CODE_extobj_handler_rock_4x2-$01
	dw CODE_extobj_handler_rock_5x3-$01
	dw CODE_extobj_handler_rock_3x2_a-$01
	dw CODE_extobj_handler_rock_3x2_b-$01
	dw CODE_extobj_handler_rock_5x4_a-$01
	dw CODE_extobj_handler_rock_5x4_b-$01
	dw CODE_extobj_handler_rock_4x3-$01
	dw CODE_extobj_handler_rock_2x2-$01
	dw CODE_extobj_handler_old_branch-$01
	dw CODE_extobj_handler_stalactite_rock_pair-$01
	dw CODE_extobj_handler_stalactite_rock_pair-$01
	dw CODE_extobj_handler_grass_shadow_small-$01
	dw CODE_extobj_handler_grass_shadow_mid-$01
	dw CODE_extobj_handler_grass_shadow_big-$01
	dw CODE_extobj_handler_pipe_entry_4dir-$01
	dw CODE_extobj_handler_pipe_entry_4dir-$01
	dw CODE_extobj_handler_pipe_entry_4dir-$01
	dw CODE_extobj_handler_pipe_entry_4dir-$01
	dw CODE_extobj_handler_pipe_shape_family-$01
	dw CODE_extobj_handler_pipe_shape_family-$01
	dw CODE_extobj_handler_pipe_shape_family-$01
	dw CODE_extobj_handler_pipe_shape_family-$01
	dw CODE_extobj_handler_pipe_shape_family-$01
	dw CODE_extobj_handler_pipe_shape_family-$01
	dw CODE_extobj_handler_pipe_shape_family-$01
	dw CODE_extobj_handler_pipe_shape_family-$01
	dw CODE_extobj_handler_pipe_shape_family-$01
	dw CODE_extobj_handler_pipe_shape_family-$01
	dw CODE_extobj_handler_pipe_shape_family-$01
	dw CODE_extobj_handler_pipe_shape_family-$01
	dw CODE_extobj_handler_pipe_shape_family-$01
	dw CODE_extobj_handler_pipe_lakitu_cave_pair-$01
	dw CODE_extobj_handler_pipe_lakitu_cave_pair-$01
	dw CODE_extobj_handler_lakitu_hole-$01
	dw CODE_extobj_handler_goal_floor_stand-$01
	dw CODE_extobj_handler_goal_roof_8x5-$01
	dw CODE_extobj_handler_sky_cloud_family-$01
	dw CODE_extobj_handler_sky_cloud_family-$01
	dw CODE_extobj_handler_sky_cloud_family-$01
	dw CODE_extobj_handler_sky_cloud_family-$01
	dw CODE_extobj_handler_sky_cloud_family-$01
	dw CODE_extobj_handler_pipe_hole_4x4-$01
	dw CODE_extobj_handler_pipe_arrow_4dir-$01
	dw CODE_extobj_handler_pipe_arrow_4dir-$01
	dw CODE_extobj_handler_pipe_arrow_4dir-$01
	dw CODE_extobj_handler_pipe_arrow_4dir-$01
	dw CODE_extobj_handler_no_egg_grass-$01
	dw CODE_extobj_handler_line_guide_small_corner_family-$01
	dw CODE_extobj_handler_line_guide_small_corner_family-$01
	dw CODE_extobj_handler_line_guide_small_corner_family-$01
	dw CODE_extobj_handler_line_guide_small_corner_family-$01
	dw CODE_extobj_handler_line_guide_mid_corner_family-$01
	dw CODE_extobj_handler_line_guide_mid_corner_family-$01
	dw CODE_extobj_handler_line_guide_mid_corner_family-$01
	dw CODE_extobj_handler_line_guide_mid_corner_family-$01
	dw CODE_extobj_handler_line_guide_large_corner_family-$01
	dw CODE_extobj_handler_line_guide_large_corner_family-$01
	dw CODE_extobj_handler_line_guide_large_corner_family-$01
	dw CODE_extobj_handler_line_guide_large_corner_family-$01
	dw CODE_extobj_handler_line_guide_stopper_family-$01
	dw CODE_extobj_handler_line_guide_stopper_family-$01
	dw CODE_extobj_handler_line_guide_stopper_family-$01
	dw CODE_extobj_handler_line_guide_stopper_family-$01
	dw CODE_extobj_handler_pipe_cap_pair-$01
	dw CODE_extobj_handler_pipe_cap_pair-$01
	dw CODE_extobj_handler_pipe_corner_family-$01
	dw CODE_extobj_handler_pipe_corner_family-$01
	dw CODE_extobj_handler_pipe_corner_family-$01
	dw CODE_extobj_handler_pipe_corner_family-$01
	dw CODE_extobj_handler_flower_burst_2x2-$01
	dw CODE_extobj_handler_xmas_tree_pair-$01
	dw CODE_extobj_handler_xmas_tree_pair-$01
	dw CODE_extobj_handler_ice_ramp-$01
	dw CODE_extobj_handler_arrow_sign_2x2_overlay-$01
	dw CODE_extobj_handler_gravel_family-$01
	dw CODE_extobj_handler_gravel_family-$01
	dw CODE_extobj_handler_gravel_family-$01
	dw CODE_extobj_handler_gravel_family-$01
	dw CODE_extobj_handler_crystal_cluster_family-$01
	dw CODE_extobj_handler_crystal_cluster_family-$01
	dw CODE_extobj_handler_crystal_cluster_family-$01
	dw CODE_extobj_handler_crystal_cluster_family-$01
	dw CODE_extobj_handler_crystal_cluster_family-$01
	dw CODE_extobj_handler_crystal_cluster_family-$01
	dw CODE_extobj_handler_underground_lava_rock-$01
	dw CODE_extobj_handler_mushroom_small_pair-$01
	dw CODE_extobj_handler_mushroom_small_pair-$01
	dw CODE_extobj_handler_mushroom_big_pair-$01
	dw CODE_extobj_handler_mushroom_big_pair-$01
	dw CODE_extobj_handler_mushroom_cluster_pair-$01
	dw CODE_extobj_handler_mushroom_cluster_pair-$01
	dw CODE_extobj_handler_dandelion_family-$01
	dw CODE_extobj_handler_dandelion_family-$01
	dw CODE_extobj_handler_dandelion_family-$01
	dw CODE_extobj_handler_dandelion_family-$01
	dw CODE_extobj_handler_dandelion_family-$01
	dw CODE_extobj_handler_dandelion_family-$01
	dw CODE_extobj_handler_sky_small_girder_stand-$01
	dw CODE_extobj_handler_snowy_platform_tip-$01
	dw CODE_extobj_handler_sky_big_base_pair-$01
	dw CODE_extobj_handler_sky_big_base_pair-$01
	dw CODE_extobj_handler_egg_block-$01
	dw CODE_extobj_handler_flower_pattern_family-$01
	dw CODE_extobj_handler_flower_pattern_family-$01
	dw CODE_extobj_handler_flower_pattern_family-$01
	dw CODE_extobj_handler_flower_pattern_family-$01
	dw CODE_extobj_handler_flower_pattern_family-$01
	dw CODE_extobj_handler_flower_blossom_family-$01
	dw CODE_extobj_handler_flower_blossom_family-$01
	dw CODE_extobj_handler_flower_blossom_family-$01
	dw CODE_extobj_handler_flower_blossom_family-$01
	dw CODE_extobj_handler_flower_blossom_family-$01
	dw CODE_extobj_handler_flower_blossom_family-$01
	dw CODE_extobj_handler_flower_blossom_family-$01
	dw CODE_extobj_handler_flower_blossom_family-$01
	dw CODE_extobj_handler_flower_blossom_family-$01
	dw CODE_extobj_handler_flower_blossom_family-$01
	dw CODE_extobj_handler_flower_rock_art_family-$01
	dw CODE_extobj_handler_flower_rock_art_family-$01
	dw CODE_extobj_handler_flower_rock_art_family-$01
	dw CODE_extobj_handler_flower_rock_art_family-$01
	dw CODE_extobj_handler_flower_rock_art_family-$01
	dw CODE_extobj_handler_flower_rock_art_family-$01
	dw CODE_extobj_handler_flower_rock_art_family-$01
	dw CODE_extobj_handler_flower_rock_art_family-$01
	dw CODE_extobj_handler_flower_rock_art_family-$01
	dw CODE_extobj_handler_flower_rock_art_family-$01
	dw CODE_extobj_handler_flower_rock_art_family-$01
	dw CODE_extobj_handler_flower_rock_art_family-$01
	dw CODE_extobj_handler_pipe_3d_key-$01
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw CODE_extobj_FB_copy_screen_exit-$01
	dw CODE_extobj_FC_vestigial_noop-$01
	dw CODE_extobj_FD_clear_map16_cell-$01
	dw CODE_extobj_FE_set_babymario_float_limit-$01

;=========================================================================
; DATA_standard_object_init_ptrs -- STANDARD-OBJECT INIT POINTER TABLE
; See also: ys_bgsc1.asm (standard-object dispatch parallel).
;
; Indexed by:    the STANDARD-object ID (the first byte of a non-$00 non-$FF
;                object record, range 1..254).
; Used by:       Bank10 CODE_108C33. After Bank10 reads the ID byte, the
;                XY-position bytes, and (per the property table DATA_object_property_table
;                below) 1 or 2 size bytes, it does:
;                    LDA $15; ASL; TAX                 ; id*2
;                    LDA #(CODE_129191-$01)>>16        ; bank byte $12
;                    PHA; PHA; PLB                     ; DB := $12
;                    LDA DATA_standard_object_init_ptrs+$01,x; PHA        ; hi(handler-1)
;                    LDA DATA_standard_object_init_ptrs,x; PHA            ; lo(handler-1)
;                    SEP #$10; RTL                     ; jumps to handler
; Entry format:  2 bytes per entry = `dw CODE_xxxxxx-$01`. 247 actual
;                `dw CODE_xxx-$01` entries are emitted at this address
;                (verified by awk over the source); they cover standard-
;                object IDs $00..$F6. IDs $F7..$FF are unused -- those
;                indices fall inside the UNK_standard_object_padding padding region below,
;                whose bytes are all $FF (so Bank10's id*2 indexing would
;                pull a $FFFF -- effectively "do nothing or crash" if any
;                stream-side reference ever appeared; valid level data
;                never references IDs $F7..$FF).
; Notes:
;   - Slot 0 (the first dw at $1281FE) is CODE_129191 -- the BG_FLOOR0
;     equivalent for the standard-object dispatch. Bank10 writes
;     CODE_129191-1's BANK BYTE into DB before the indirect RTL, so the
;     bank-byte literal at line 1280 in Bank10 (`LDA #(CODE_129191-$01)>>16`)
;     is what selects bank $12 for the dispatch.
;   - Many slots reuse the same handler (e.g. several runs of $129217-$01).
;     This matches the "shape X variant 1..N all route to the same handler
;     with slightly different per-row data tables" pattern.
;=========================================================================
DATA_1281FE:
DATA_standard_object_init_ptrs:                                  ; descriptive alias
	dw CODE_129191-$01
	dw CODE_1291D4-$01
	dw CODE_129217-$01
	dw CODE_129217-$01
	dw CODE_1292BC-$01
	dw CODE_1292BC-$01
	dw CODE_1292DD-$01
	dw CODE_1292DD-$01
	dw CODE_1292DD-$01
	dw CODE_1292DD-$01
	dw CODE_129217-$01
	dw CODE_129217-$01
	dw CODE_129354-$01
	dw CODE_12935E-$01
	dw CODE_129354-$01
	dw CODE_129354-$01
	dw CODE_129368-$01
	dw CODE_12937C-$01
	dw CODE_12937C-$01
	dw CODE_12939E-$01
	dw CODE_1293A8-$01
	dw CODE_1293B2-$01
	dw CODE_1293C1-$01
	dw CODE_1293CB-$01
	dw CODE_1293EE-$01
	dw CODE_1293EE-$01
	dw CODE_129407-$01
	dw CODE_129407-$01
	dw CODE_129420-$01
	dw CODE_12942F-$01
	dw CODE_12942F-$01
	dw CODE_init_lava_or_stone_3d-$01
	dw CODE_init_lava_or_stone_3d-$01
	dw CODE_1294EA-$01
	dw CODE_1294F6-$01
	dw CODE_129502-$01
	dw CODE_12950E-$01
	dw CODE_12951C-$01
	dw CODE_12951C-$01
	dw CODE_129532-$01
	dw CODE_129532-$01
	dw CODE_12954F-$01
	dw CODE_12954F-$01
	dw CODE_129569-$01
	dw CODE_129573-$01
	dw CODE_129583-$01
	dw CODE_129583-$01
	dw CODE_12959C-$01
	dw CODE_1295AA-$01
	dw CODE_1295AA-$01
	dw CODE_1295CF-$01
	dw CODE_1295CF-$01
	dw CODE_1295E0-$01
	dw CODE_1295EE-$01
	dw CODE_1295FA-$01
	dw CODE_129609-$01
	dw CODE_init_stone_large-$01
	dw CODE_init_red_stone-$01
	dw CODE_129640-$01
	dw CODE_12964A-$01
	dw CODE_129667-$01
	dw CODE_12967D-$01
	dw CODE_12968C-$01
	dw CODE_init_spike_pillar-$01
	dw CODE_init_spike_pillar-$01
	dw CODE_1296A0-$01
	dw CODE_1296AE-$01
	dw CODE_1296AE-$01
	dw CODE_1296BF-$01
	dw CODE_1296CB-$01
	dw CODE_1296CB-$01
	dw CODE_init_lava_castle-$01
	dw CODE_129720-$01
	dw CODE_129743-$01
	dw CODE_129743-$01
	dw CODE_129768-$01
	dw CODE_129768-$01
	dw CODE_129768-$01
	dw CODE_12979D-$01
	dw CODE_1297BD-$01
	dw CODE_1297DD-$01
	dw CODE_1297DD-$01
	dw CODE_1297FD-$01
	dw CODE_129820-$01
	dw CODE_12982A-$01
	dw CODE_12982A-$01
	dw CODE_12982A-$01
	dw CODE_12985A-$01
	dw CODE_12987A-$01
	dw CODE_12989C-$01
	dw CODE_12989C-$01
	dw CODE_12989C-$01
	dw CODE_1298F5-$01
	dw CODE_1298F5-$01
	dw CODE_1298F5-$01
	dw CODE_12993E-$01
	dw CODE_12993E-$01
	dw CODE_12998F-$01
	dw CODE_12998F-$01
	dw CODE_129A0D-$01
	dw CODE_129A0D-$01
	dw CODE_129A0D-$01
	dw CODE_129A2D-$01
	dw CODE_129A4D-$01
	dw CODE_init_coin_object-$01
	dw CODE_129A75-$01
	dw CODE_129A99-$01
	dw CODE_129AA3-$01
	dw CODE_129AC6-$01
	dw CODE_init_spiky_stake-$01
	dw CODE_129ADA-$01
	dw CODE_init_twisted_tree_trunk-$01
	dw CODE_init_forest_plants-$01
	dw CODE_init_forest_flower_above-$01
	dw CODE_init_forest_flower_below-$01
	dw CODE_init_twisted_tree_leaves-$01
	dw CODE_init_twisted_tree_leaves_wide-$01
	dw CODE_init_twisted_tree_leaf_left-$01
	dw CODE_init_twisted_tree_leaf_right-$01
	dw CODE_init_twisted_tree_leaf_center-$01
	dw CODE_init_twisted_tree_slanted-$01
	dw CODE_129BAD-$01
	dw CODE_129BD5-$01
	dw CODE_129BDF-$01
	dw CODE_129BEE-$01
	dw CODE_129C02-$01
	dw CODE_12985A-$01
	dw CODE_129C11-$01
	dw CODE_129C33-$01
	dw CODE_129C47-$01
	dw CODE_129C74-$01
	dw CODE_129C74-$01
	dw CODE_129C7E-$01
	dw CODE_129C8D-$01
	dw CODE_129C97-$01
	dw CODE_init_floor_no_deco_top-$01
	dw CODE_init_floor_no_deco_top-$01
	dw CODE_init_falling_rock-$01
	dw CODE_init_coin_object-$01
	dw CODE_129ADA-$01
	dw CODE_init_boo_guy_bomb_room-$01
	dw CODE_129CF1-$01
	dw CODE_init_donut_lift_giant-$01
	dw CODE_129D12-$01
	dw CODE_129D35-$01
	dw CODE_129D5C-$01
	dw CODE_129D5C-$01
	dw CODE_129D85-$01
	dw CODE_init_number_platform-$01
	dw CODE_init_number_platform-$01
	dw CODE_init_number_platform-$01
	dw CODE_init_number_platform-$01
	dw CODE_129DC2-$01
	dw CODE_129DCC-$01
	dw CODE_129DEF-$01
	dw CODE_129E26-$01
	dw CODE_129E26-$01
	dw CODE_init_stationary_rock-$01
	dw CODE_init_donut_lift-$01
	dw CODE_129E5A-$01
	dw CODE_129E71-$01
	dw CODE_129E71-$01
	dw CODE_129E71-$01
	dw CODE_129E8B-$01
	dw CODE_129E8B-$01
	dw CODE_129EB0-$01
	dw CODE_129EB0-$01
	dw CODE_129EDE-$01
	dw CODE_129EDE-$01
	dw CODE_129F13-$01
	dw CODE_129F35-$01
	dw CODE_129F35-$01
	dw CODE_129F4F-$01
	dw CODE_129F4F-$01
	dw CODE_129F71-$01
	dw CODE_129F71-$01
	dw CODE_129F8F-$01
	dw CODE_129F99-$01
	dw CODE_129FA7-$01
	dw CODE_129FA7-$01
	dw CODE_129FC6-$01
	dw CODE_129FC6-$01
	dw CODE_129FE5-$01
	dw CODE_129FE5-$01
	dw CODE_12A004-$01
	dw CODE_12A004-$01
	dw CODE_12A027-$01
	dw CODE_12A027-$01
	dw CODE_12A027-$01
	dw CODE_12A027-$01
	dw CODE_12A03E-$01
	dw CODE_12A03E-$01
	dw CODE_12A057-$01
	dw CODE_12A057-$01
	dw CODE_12A057-$01
	dw CODE_12A057-$01
	dw CODE_init_coin_line-$01
	dw CODE_init_coin_line-$01
	dw CODE_init_coin_line-$01
	dw CODE_init_coin_line-$01
	dw CODE_init_coin_line-$01
	dw CODE_init_coin_line-$01
	dw CODE_12A0BD-$01
	dw CODE_12A0C7-$01
	dw CODE_12A0D7-$01
	dw CODE_12A0D7-$01
	dw CODE_12A0EF-$01
	dw CODE_12A109-$01
	dw CODE_12A123-$01
	dw CODE_12A13D-$01
	dw CODE_12A147-$01
	dw CODE_12A151-$01
	dw CODE_12A163-$01
	dw CODE_12A163-$01
	dw CODE_12A163-$01
	dw CODE_12A163-$01
	dw CODE_12A17A-$01
	dw CODE_12A17A-$01
	dw CODE_init_star_block-$01
	dw CODE_12A19F-$01
	dw CODE_12A1A9-$01
	dw CODE_12A1B3-$01
	dw CODE_12A1C6-$01
	dw CODE_init_lava_cave_pool-$01
	dw CODE_init_lava_flow_down-$01
	dw CODE_init_mushroom_platform-$01
	dw CODE_12A205-$01
	dw CODE_12A214-$01
	dw CODE_12A21E-$01
	dw CODE_12A247-$01
	dw CODE_12A259-$01
	dw CODE_12A26B-$01
	dw CODE_12A293-$01
	dw CODE_12A2A5-$01
	dw CODE_12A2B7-$01
	dw CODE_12A2DF-$01
	dw CODE_12A2DF-$01
	dw CODE_init_stone_3d_wall-$01
	dw CODE_init_stone_3d-$01
	dw CODE_init_stone_3d-$01
	dw CODE_init_moving_stone_3d-$01
	dw CODE_init_moving_stone_3d-$01
	dw CODE_init_moving_stone_3d-$01
	dw CODE_init_moving_stone_3d-$01
	dw CODE_129667-$01
	dw CODE_init_spike-$01
	dw CODE_12A3D1-$01

;=========================================================================
; UNK_standard_object_padding -- 256 bytes of mostly-zero padding inside the DATA_standard_object_init_ptrs
; footprint. The middle 15 bytes are $FF; outer bytes are $00.
; Purpose: NOT directly indexed by either Bank10 dispatcher in any verified
; call site -- looks like a one-time zero-init region the assembler emits
; to pad the standard-object pointer table out to its full $1284EC bound.
; The interspersed $FF stripe (bytes $0E-$1C of this block, offsets $1283FA-
; $128408) is the GIVEAWAY: a flat zero-fill would be `db $00,$00,...` all
; the way through. The non-zero stretch suggests this was once a small
; lookup table whose live entries got zeroed out (likely sentinel "EMPTY"
; markers for an unused standard-object range). Treat as opaque / do-not-
; touch.
;=========================================================================
UNK_1283EC:
UNK_standard_object_padding:                                    ; descriptive alias
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$00,$00,$00,$00

;=========================================================================
; DATA_object_property_table -- STANDARD-OBJECT PROPERTY TABLE
;
; 256 bytes; 1 byte per standard-object ID.
;
; Indexed by:    the standard-object ID byte (same as the index into
;                DATA_standard_object_init_ptrs above).
; Used by:       Bank10 CODE_108C33. Sequence on each standard-object
;                stream record:
;                    LDX $15                  ; X = object ID
;                    LDA DATA_object_property_table,x        ; A = property byte
;                    AND #$0003               ; bottom 2 bits = width-mode
;                    CMP #$0001
;                    BEQ width_mode_1         ; reads only the height byte
;                    TAX                      ; X = 0 or 2 (width-mode = 0 or 2)
;                    INY; LDA [ptr],y         ; read length byte -> $0A
;                    ; ...sign-extend...
;                    STA $2A                  ; STA column extent
;                    TXA; BEQ skip_height     ; if width-mode 0, no height byte
;                    INY; LDA [ptr],y         ; read height byte
;                    ; ...sign-extend...
;                    STA $2E                  ; STA row extent
;                    skip_height:             ; --> dispatch via DATA_standard_object_init_ptrs
;
; Bit layout (low 2 bits are the only ones Bank10 actually reads):
;     bits 0-1  width-mode:
;                 %00  4-byte record: id, XY, XY, length     ($2A := length)
;                 %01  4-byte record: id, XY, XY, height     ($2E := height)
;                 %10  5-byte record: id, XY, XY, length, height ($2A, $2E)
;                 %11  sentinel ($FF in entry 0); not reached for valid IDs
;     bits 2-5  ALWAYS ZERO in this table -- the only observed top-nibble
;               values in the 256 bytes below are $00, $40, $80, $C0.
;     bit 6     observed in $42, $C0, $C2 entries. The Bank10 dispatcher
;               does NOT read this bit. Likely consumed by per-object
;               handlers via LDA $1284EC,x; AND #$40 inside Bank13 code,
;               but no caller is currently mapped. Possible meanings:
;                  - "has extension sub-ID byte" (the wiki claims this)
;                  - "object grows from its anchor in the +XY direction"
;                  - dev-leftover flag from an earlier engine
;     bit 7     observed in $80, $82, $C0, $C2 entries. Same caveat as
;               bit 6 -- no Bank10 consumer reads it. Possibly "object
;               is a slope / multi-tile diagonal".
;
; The full byte distribution across the 256 entries:
;     $FF * 17 (slot 0 + the trailing $FF...$FF pad at slot $F7-$FF)
;     $00 * 64 (no-op / minimum-width slots)
;     $01 * 55 (width-mode 1)
;     $02 * 96 (5-byte WxH objects)
;     $41 *  2 (width-mode 1 + bit 6)
;     $42 *  1
;     $80 * 13
;     $82 *  3
;     $C0 *  4 (width-mode 0 + bits 6+7)
;     $C2 * 13 (width-mode 2 + bits 6+7)
;
; Source-of-truth verification:
;   - Bytes at this offset are emitted byte-for-byte to PC $0904EC in the
;     assembled cart.
;   - The Bank10 code uses `AND #$0003`, so the BOTTOM 2 bits are the
;     width-mode (not the top 2 bits as some external docs suggest).
;
; Raidenthequick verbatim header: "level object table -- each byte
; corresponds to an object ID and contains some information about that
; object". Raidenthequick did not document the bit layout further.
;=========================================================================
DATA_1284EC:
DATA_object_property_table:                                      ; descriptive alias
	db $FF,$02,$01,$01,$02,$02,$02,$02,$02,$02,$01,$01,$01,$00,$01,$01
	db $C2,$C2,$C2,$00,$02,$00,$02,$02,$02,$02,$00,$01,$01,$00,$00,$02
	db $02,$02,$01,$01,$02,$01,$01,$82,$02,$C2,$C2,$01,$01,$01,$01,$01
	db $01,$01,$02,$02,$00,$02,$01,$00,$02,$02,$02,$02,$41,$00,$01,$01
	db $01,$00,$01,$01,$02,$02,$02,$02,$02,$01,$01,$01,$01,$01,$02,$02
	db $01,$00,$C2,$00,$C2,$C2,$C2,$00,$02,$02,$02,$02,$02,$02,$02,$02
	db $02,$02,$02,$00,$00,$00,$02,$02,$02,$02,$00,$02,$02,$01,$02,$01
	db $00,$00,$00,$01,$01,$01,$01,$01,$C2,$C0,$02,$C2,$C0,$00,$00,$02
	db $C0,$C0,$02,$00,$80,$02,$02,$02,$02,$02,$02,$02,$00,$01,$00,$82
	db $82,$01,$01,$01,$02,$02,$02,$02,$02,$01,$01,$01,$01,$02,$00,$00
	db $02,$02,$02,$02,$02,$01,$00,$02,$02,$01,$01,$01,$00,$00,$01,$00
	db $02,$00,$80,$80,$80,$80,$00,$00,$00,$00,$00,$00,$01,$01,$01,$01
	db $00,$00,$80,$80,$00,$01,$80,$00,$01,$80,$02,$02,$C2,$42,$80,$80
	db $80,$01,$00,$02,$01,$01,$00,$00,$00,$00,$02,$02,$02,$02,$01,$00
	db $01,$02,$01,$02,$02,$C2,$C2,$C2,$02,$02,$02,$02,$02,$C2,$02,$02
	db $02,$02,$02,$02,$41,$02,$02,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF

;=========================================================================
; CODE_object_stream_walk -- INTRA-OBJECT MAP16 WALKER (CODE_object_stream_walk)
; See also: ys_bgsc.asm, ys_bgsc2.asm (BG-scene walker parallels).
;
; PURPOSE
;   Iterates a 2D rectangle of Map16 cells inside ONE object and dispatches
;   into the appropriate per-cell handler to write each cell's Map16 ID
;   to !RAM_YI_Level_LevelDataBuffer. This is the per-object "stamp" loop;
;   it is NOT the master object-stream parser (that is Bank10 CODE_unpack_header_then_load_objects,
;   which reads stream bytes one record at a time and dispatches into
;   per-object init handlers; those handlers may in turn JSR/JSL into
;   THIS walker to flood-fill or shape-fill their rectangle).
;
; ZERO-PAGE CONTRACT (on entry, set up by the per-object init handler):
;   $1B          low byte of current Map16 cell coords (xxxxyyyy nibble-
;                interleaved sub-screen X/Y; the cell that gets walked
;                from -- top-left of the object's bounding box).
;   $1C          high byte of current Map16 cell coords (XXXXYYYY screen-
;                page X/Y nibble-interleaved).
;   $19          rows-to-walk count (top-of-loop compare target).
;   $2A          column extent ($28 < $2A terminates the inner col loop;
;                set by Bank10 from the length byte for width-mode-0
;                objects, or by the init handler).
;   $2E          row extent ($2C < $2E terminates the outer row loop;
;                set by Bank10 from the height byte for width-mode-2
;                objects, or by the init handler).
;   $1F, $20     low/high(-1) of per-COLUMN handler for ODD-X cells,
;                set by init handler.
;   $21          bank byte of per-COLUMN handler for ODD-X cells.
;   $22, $23     low/high(-1) of per-COLUMN handler for EVEN-X cells.
;   $24          bank byte of per-COLUMN handler for EVEN-X cells.
;   $25, $26     low/high(-1) of per-ROW handler (used at row boundary).
;   $27          bank byte of per-ROW handler.
;   $17          per-row slope advance (added to $14 on each row step).
;
; ZERO-PAGE STATE (mutated by walker):
;   $00, $02     scratch (16-bit temps for Map16 math)
;   $12          current cell's Map16 ID (latched by CODE_get_current_map16_tile).
;   $14          per-column accumulator (slope advance carry).
;   $1D          current cell's byte index into !RAM_YI_Level_LevelDataBuffer
;                (latched by CODE_get_current_map16_tile; handler reads/writes
;                LevelDataBuffer,X with X=$1D).
;   $28          column counter (0..$2A-1, signed; $2A<0 walks left).
;   $2B          screen-page hi-nibble carry for row stepping.
;   $2C          row counter (0..$2E-1, signed; $2E<0 walks up).
;   $9B          "rewound" flag (non-zero -> the walker has wrapped to a
;                new screen and CODE_walker_rewind_nibble must rewind $1B's nibbles).
;
; OUTPUTS
;   The walker writes Map16 IDs into !RAM_YI_Level_LevelDataBuffer at
;   offsets corresponding to every (row, col) of the object's rectangle.
;   Page-LRU allocation happens lazily inside CODE_resolve_screen_page -- if the cell
;   coordinates hit an unmapped screen, the walker allocates a fresh
;   page and chains it into the $6CAA/$0D4E LRU.
;
; CONTROL FLOW SUMMARY
;   Outer loop  (CODE_walker_per_row_setup):  per-row setup; fetch current tile.
;   Cell visit  (CODE_walker_visit_cell):  test which of 3 handler pointers to call
;                               (per-row at row-end via $27/$25, per-col
;                               EVEN at even $28 via $24/$22, per-col ODD
;                               otherwise via $21/$1F). All 3 dispatch
;                               via the PHK/PEA-PHB-PHA-RTL pattern that
;                               returns to CODE_walker_post_handler.
;   Post-visit  (CODE_walker_post_handler):  advance row counter $2C (with sign-flip
;                               handling for negative-extent objects),
;                               compute next cell's byte index via
;                               DATA_walker_cell_byte_delta/CD/D1 + CODE_resolve_screen_page, write
;                               its Map16 ID to $12, loop.
;   Row end     (CODE_walker_row_wrap):  reset $2C, advance $28, apply slope
;                               advance to $1B's screen byte, optionally
;                               JSR CODE_walker_rewind_nibble to rewind nibble carry,
;                               loop or RTS.
;
; CALLERS
;   ~30 sites inside Bank12 itself (per-object init handlers that need
;   to walk a sub-rectangle). NEVER called from outside Bank12.
;=========================================================================
CODE_1285EC:
CODE_object_stream_walk:                                         ; descriptive alias
	STZ.b $28                                                 ; \ initialise column counter
	STZ.b $2C                                                 ; / and row counter to zero
	STZ.b $9B                                                 ; clear "rewound" flag
CODE_1285F2:
CODE_walker_per_row_setup:                                       ; descriptive alias
	SEP.b #$30
	STZ.b $14                                                 ; reset per-column accumulator
	JSR.w CODE_get_current_map16_tile                                         ; fetch current tile -> X=$1D, $12=mapID
	REP.b #$20
CODE_1285FB:
CODE_walker_visit_cell:                                          ; descriptive alias
	SEP.b #$10                                                ; index registers -> 8-bit
	PHK                                                       ; \ build return = $12:CODE_walker_post_handler
	PEA.w CODE_walker_post_handler-$01                                     ; / via PHK/PEA-RTL pattern
	LDA.b $2C
	CMP.b $19
	BCC.b CODE_walker_dispatch_even_col                                         ; if $2C < $19: not at row-end yet
; --- PER-ROW dispatch: row boundary reached, call per-row handler ($25/$27)
	LDX.b $27                                                 ; bank byte of row handler
	PHX                                                       ; \ PHX/PHX/PLB sets DB to handler bank
	PHX                                                       ; /
	PLB
	LDA.b $25                                                 ; per-row handler ptr-1
	PHA
	SEP.b #$20
	RTL                                                       ; tail-call into per-row handler

CODE_128612:
CODE_walker_dispatch_even_col:                                   ; descriptive alias
	LDA.b $28
	AND.w #$0001
	BNE.b CODE_walker_dispatch_odd_col                                         ; odd $28 -> ODD-column handler
; --- PER-COL EVEN: $28 is even, call $22/$24 handler
	LDX.b $24                                                 ; bank byte of even-col handler
	PHX
	PHX
	PLB
	LDA.b $22                                                 ; even-col handler ptr-1
	PHA
	SEP.b #$20
	RTL

CODE_128624:
CODE_walker_dispatch_odd_col:                                    ; descriptive alias
	LDX.b $21                                                 ; bank byte of odd-col handler
	PHX
	PHX
	PLB
	LDA.b $1F                                                 ; odd-col handler ptr-1
	PHA
	SEP.b #$20
	RTL

CODE_12862F:
CODE_walker_post_handler:                                        ; descriptive alias
	PHK
	PLB                                                       ; restore DB = $12 after handler ran
	REP.b #$30
	LDY.w #$0000                                              ; Y = 0 -> "step right" entry in DATA tables
	LDA.b $2E
	BPL.b CODE_128640                                         ; $2E >= 0: object grows down
	DEC.b $2C                                                 ; $2E < 0: object grows up; $2C--
	INY                                                       ; \ Y = 2 -> "step up" entry in DATA tables
	INY                                                       ; /
	BRA.b CODE_walker_check_row_end

CODE_128640:
	INC.b $2C                                                 ; standard case: step down/right
CODE_128642:
CODE_walker_check_row_end:                                       ; descriptive alias
	LDA.b $2C
	CMP.b $2E
	BEQ.b CODE_walker_row_wrap                                         ; row counter hit extent -> wrap row
	LDA.b $1D                                                 ; \ next cell byte index =
	CLC                                                       ; |   $1D + DATA_walker_cell_byte_delta[Y]
	ADC.w DATA_walker_cell_byte_delta,y                                       ; /   (Y=0: +$20 down; Y=2: -$20 up)
	TAX
	BIT.w #$FE00                                              ; check overflow into new screen page
	BEQ.b CODE_walker_alloc_or_keep_page
	AND.w #$01E0
	CMP.w DATA_walker_page_wrap_mask,y                                       ; compare against page-wrap mask
	BNE.b CODE_walker_latch_next_cell                                         ; no page wrap -- just store, loop
CODE_12865C:
CODE_walker_alloc_or_keep_page:                                  ; descriptive alias
	TXA
	AND.w #$01FF
	STA.b $00                                                 ; partial offset within screen
	SEP.b #$20
	LDA.b $14                                                 ; \ apply slope advance to $1C high-byte
	CLC                                                       ; |   $14 += DATA_walker_slope_advance[Y]
	ADC.w DATA_walker_slope_advance,y                                       ; |
	STA.b $14                                                 ; /
	CLC
	ADC.b $1C                                                 ; X = screen index from $1C + slope advance
	TAX
	SEP.b #$10
	JSR.w CODE_resolve_screen_page                                         ; resolve screen -> LevelDataBuffer offset
CODE_128675:
CODE_walker_latch_next_cell:                                     ; descriptive alias
	STX.b $1D                                                 ; cache cell offset for handler
	LDA.l !RAM_YI_Level_LevelDataBuffer,x                     ; read current Map16 ID
	STA.b $12                                                 ; cache for handler
	JMP.w CODE_walker_visit_cell                                         ; back to dispatch

CODE_128680:
CODE_walker_row_wrap:                                            ; descriptive alias
	LDA.b $1B
	AND.w #$F0F0                                              ; keep just the screen-coord nibbles
	STA.b $00
	STZ.b $2C                                                 ; reset row counter for next column
	LDA.b $2A
	BPL.b CODE_walker_step_right                                         ; $2A >= 0: walk right
	DEC.b $28                                                 ; $2A < 0: walk left; $28--
	LDA.b $1B
	AND.w #$0F0F                                              ; keep just the sub-screen nibbles
	DEC                                                       ; sub-screen-X--
	BRA.b CODE_1286A2

CODE_128697:
CODE_walker_step_right:                                          ; descriptive alias
	INC.b $28                                                 ; $28++ (column advance)
	LDA.b $1B
	AND.w #$0F0F                                              ; isolate sub-screen X
	ORA.w #$00F0                                              ; \ trick to make X-wrap propagate
	INC                                                       ; /   into screen-X nibble on next AND
CODE_1286A2:
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	LDA.b $28
	CMP.b $2A
	BEQ.b CODE_1286C6
	LDA.b $9B
	BEQ.b CODE_1286C3
	JSR.w CODE_walker_rewind_nibble
	LDA.b $9B
	BMI.b CODE_1286C3
	LDA.b $2E
	CLC
	ADC.b $17
	STA.b $2E
	BEQ.b CODE_1286C6
CODE_1286C3:
	JMP.w CODE_walker_per_row_setup

CODE_1286C6:
	SEP.b #$30
	RTS

; --- Walker step-direction tables (indexed by Y = 0 for "step right/down",
;     Y = 2 for "step left/up"). Used by CODE_walker_post_handler at $12862F.
DATA_1286C9:
DATA_walker_cell_byte_delta:                                     ; descriptive alias
	dw $0020,$FFE0                                            ; +32 bytes / -32 bytes (one Map16 row in buffer)

DATA_1286CD:
DATA_walker_page_wrap_mask:                                      ; descriptive alias
	dw $0000,$01E0                                            ; "row at top of new page" / "row at bottom"

DATA_1286D1:
DATA_walker_slope_advance:                                       ; descriptive alias
	dw $0010,$00F0                                            ; +16 / +240 (slope $14 carry per Y direction)

;-------------------------------------------------------------------------
; CODE_walker_rewind_nibble -- "rewind nibble carry" helper used by row-wrap path.
; Called by CODE_walker_step_right when $9B indicates a screen wrap happened.
; Re-normalises $1B's nibble interleaving by subtracting the cumulative
; slope advance ($17) from the screen-X nibble portion.
;
; INPUTS:  $17 (per-row slope), $1B (current Map16 cell coords)
; OUTPUTS: $1B updated; $00/$02 trashed
;-------------------------------------------------------------------------
CODE_1286D5:
CODE_walker_rewind_nibble:                                       ; descriptive alias
	LDA.b $17
	AND.w #$0F00
	STA.b $02
	LDA.b $17
	ASL
	ASL
	ASL
	ASL
	STA.b $00
	LDA.b $1B
	AND.w #$F0F0
	ORA.b $02
	SEC
	SBC.b $00
	AND.w #$F0F0
	STA.b $00
	LDA.b $1B
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	RTS

;=========================================================================
; MAP16 FETCH PRIMITIVES (5 routines: current / above / below / left / right)
; See also: ys_bgsc2.asm (cell-fetch helpers in the parallel BG-scene engine).
;
; These resolve a Map16 grid cell coordinate (nibble-interleaved across two
; bytes: low = xxxxyyyy sub-screen, high = XXXXYYYY screen page) to:
;   - X register: byte offset into !RAM_YI_Level_LevelDataBuffer ($7F8000)
;   - $1D: same byte offset (cached for the walker)
;   - $12: the Map16 ID byte currently stored at that offset
;
; The four directional variants (above/below/left/right) take their input
; from $0E/$0F (NOT $1B/$1C) so a handler can probe neighbouring cells
; without disturbing the walker's current position. They are commonly
; called as: LDA $1B; STA $0E; JSL CODE_get_map16_above  (probe cell directly above).
;
; The 4 directional routines are RTL-callable (used by Bank13 handlers via
; JSL.l). The current-tile routine is RTS-only (called only by the intra-
; object walker via JSR.w).
;
; All 5 routines internally call CODE_resolve_screen_page to resolve the screen-page
; index to a LevelDataBuffer offset, allocating a fresh screen page from
; the $6CAA/$0D4E LRU if the requested screen is unmapped.
;=========================================================================

;-------------------------------------------------------------------------
; CODE_get_current_map16_tile -- Get current tile.
; Fetch the Map16 number at the position in $1B/$1C and possibly reserve
; a screen page if unmapped.
;
; INPUTS:  $1B  low byte  (xxxxyyyy sub-screen coord pair, nibble-
;                          interleaved; current cell's local position)
;          $1C  high byte (XXXXYYYY screen-page coord pair)
;
; OUTPUTS: X    byte index in !RAM_YI_Level_LevelDataBuffer
;          $12  Map16 ID currently stored at that index
;          $1D  same as X (cached)
;
; MODIFIES: $00 (low half of $1B << 1), processor M/X widths returned 8-bit.
; CALLERS:  Bank12 walker (CODE_walker_per_row_setup), and ~25 per-object init handlers
;           in Bank12 (single-tile dispatch wrappers like CODE_extobj_handler_single_cell_dispatch,
;           CODE_extobj_handler_stake_single, CODE_extobj_handler_special_coin, CODE_extobj_handler_wall_decal_family, etc.).
;-------------------------------------------------------------------------
CODE_1286FD:
CODE_get_current_map16_tile:                                     ; descriptive alias
	REP.b #$20
	LDA.b $1B
	AND.w #$00FF
	ASL
	STA.b $00
	SEP.b #$20
	LDX.b $1C
	JSR.w CODE_resolve_screen_page
	STX.b $1D
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	STA.b $12
	SEP.b #$30
	RTS

;-------------------------------------------------------------------------
; CODE_get_map16_above -- Get Map16 above current.
; Step Y up by 1 within the column relative to the position in $0E/$0F.
;
; INPUTS:  $0E  low byte  (xxxxyyyy sub-screen pair; e.g. set via LDA $1B / STA $0E)
;          $0F  high byte (XXXXYYYY screen-page pair; e.g. set via LDA $1C / STA $0F)
;          $2C  Y offset within the column (added to the local Y before stepping up)
;          $2B  high carry (preserves screen-page-X across step)
;
; OUTPUTS: X    byte index in !RAM_YI_Level_LevelDataBuffer for the cell above
;          (caller typically follows with LDA $7F8000,x to read the tile)
;
; MODIFIES: $00 (scratch), processor stays in REP-#$30 mode (16-bit A/X/Y).
; CALLERS:  Bank13 per-object handlers (~30 JSL.l call sites looking up
;           "what's the tile above the cell I'm stamping?", e.g. slope
;           continuation, ledge-top decoration).
; HELPERS:  Reads the per-screen LevelDataBuffer base offset from $6CA9,x
;           (the row-base table; populated by CODE_resolve_screen_page page-LRU).
;-------------------------------------------------------------------------
CODE_128719:
CODE_get_map16_above:                                            ; descriptive alias
	LDA.b $2C
	AND.w #$000F
	ASL
	ASL
	ASL
	ASL
	STA.b $00
	LDA.b $2B
	AND.w #$F000
	TSB.b $00
	LDA.b $0E
	ORA.w #$0F00
	ADC.b $00
	AND.w #$70F0
	SEC
	SBC.w #$0010
	AND.w #$70F0
	STA.b $00
	LDA.b $0E
	AND.w #$0F0F
	ORA.b $00
	TAX
	AND.w #$00FF
	ASL
	STA.b $00
	TXA
	XBA
	AND.w #$00FF
	TAX
	LDA.w $6CA9,x
	AND.w #$3F00
	ASL
	ADC.b $00
	TAX
	RTL

;-------------------------------------------------------------------------
; CODE_get_map16_below -- Get Map16 below current.
; Step Y down by 1 within the column. Same input/output convention as
; CODE_get_map16_above. Implementation differs by one ADC step
; (adds $0010 instead of subtracting it) to step Y forward.
;
; CALLERS: Bank13 per-object handlers (~25 JSL.l sites), typically as part
;          of slope/ledge construction ("stamp tile A here, then check
;          and possibly modify the tile below").
;-------------------------------------------------------------------------
CODE_12875D:
CODE_get_map16_below:                                            ; descriptive alias
	LDA.b $2C
	AND.w #$000F
	ASL
	ASL
	ASL
	ASL
	STA.b $00
	LDA.b $2B
	AND.w #$F000
	TSB.b $00
	LDA.b $0E
	ORA.w #$0F00
	CLC
	ADC.w #$0010
	ORA.w #$0F00
	ADC.b $00
	AND.w #$70F0
	STA.b $00
	LDA.b $0E
	AND.w #$0F0F
	ORA.b $00
	TAX
	AND.w #$00FF
	ASL
	STA.b $00
	TXA
	XBA
	AND.w #$00FF
	TAX
	LDA.w $6CA9,x
	AND.w #$3F00
	ASL
	ADC.b $00
	TAX
	RTL

;-------------------------------------------------------------------------
; CODE_get_map16_left -- Get Map16 to the left of current.
; Step X back by 1 within the row. Same I/O convention as CODE_get_map16_above
; (CODE_get_map16_above). Implementation differs in the low-byte AND/DEC sequence:
; DECs the sub-screen X nibble and lets the AND #$0F0F mask handle the
; underflow into the screen-X nibble.
;
; CALLERS: Bank13 per-object handlers (~25 JSL.l sites). Common pattern:
;          stamp a 1-wide vertical line by walking down then probing
;          left/right to see whether to emit a corner-piece or a straight.
;-------------------------------------------------------------------------
CODE_1287A1:
CODE_get_map16_left:                                             ; descriptive alias
	LDA.b $2C
	AND.w #$000F
	ASL
	ASL
	ASL
	ASL
	STA.b $00
	LDA.b $2B
	AND.w #$F000
	TSB.b $00
	LDA.b $0E
	ORA.w #$0F00
	ADC.b $00
	AND.w #$70F0
	STA.b $00
	LDA.b $0E
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $00
	TAX
	AND.w #$00FF
	ASL
	STA.b $00
	TXA
	XBA
	AND.w #$00FF
	TAX
	LDA.w $6CA9,x
	AND.w #$3F00
	ASL
	ADC.b $00
	TAX
	RTL

;-------------------------------------------------------------------------
; CODE_get_map16_right -- Get Map16 to the right of current.
; Step X forward by 1 within the row. Same I/O convention as
; CODE_get_map16_above. Implementation differs in the low-byte
; ORA/INC sequence: ORAs in $00F0 to force overflow then INCs, which
; carries into the screen-X nibble on natural sub-screen-X wrap.
;
; CALLERS: Bank13 per-object handlers (~30 JSL.l sites).
;-------------------------------------------------------------------------
CODE_1287E2:
CODE_get_map16_right:                                            ; descriptive alias
	LDA.b $2C
	AND.w #$000F
	ASL
	ASL
	ASL
	ASL
	STA.b $00
	LDA.b $2B
	AND.w #$F000
	TSB.b $00
	LDA.b $0E
	ORA.w #$0F00
	CLC
	ADC.b $00
	AND.w #$70F0
	STA.b $00
	LDA.b $0E
	ORA.w #$00F0
	INC
	AND.w #$0F0F
	ORA.b $00
	TAX
	AND.w #$00FF
	ASL
	STA.b $00
	TXA
	XBA
	AND.w #$00FF
	TAX
	LDA.w $6CA9,x
	AND.w #$3F00
	ASL
	ADC.b $00
	TAX
	RTL

;-------------------------------------------------------------------------
; CODE_resolve_screen_page -- Page-LRU screen-page resolver + allocator.
;
; Resolves a screen-page index (X = 0..$7F) to a LevelDataBuffer byte
; offset. If the requested screen is not yet mapped to a page, allocate
; one from the LRU chain at $0D4E and store its mapping in $6CAA,x.
;
; INPUTS:  X    screen index (0..$7F = 8 rows x 16 cols max)
;          $00  partial offset within the screen (already pre-shifted by
;               the calling Map16-fetch routine)
;
; OUTPUTS: X    final byte offset into !RAM_YI_Level_LevelDataBuffer
;
; SIDE EFFECTS:
;   $6CAA,x      written with the LRU page number on first access
;   $0D4D        incremented when a new page is allocated (page LRU counter)
;   $0D4E,y      LRU chain head updated
;   $97          incremented when a new page is allocated (total pages count)
;
; OVERFLOW PATH (CODE_resolve_screen_overflow):
;   If X >= $80 (the screen index is invalid -- past the 128-screen limit
;   of a maximum-size level), the routine bails out by resetting the
;   stack to $01F1 and JMLing back to Bank10's master parser
;   (CODE_unpack_header_then_load_objects = LoadLevelData). This is the engine's "level data
;   walked off the end of the screen grid -- restart from the beginning"
;   safety net. JSL CODE_109A85 first invalidates / re-initialises the
;   level data buffer.
;
; The LRU chain ($0D4D + $0D4E,y) implements a 64-entry round-robin:
; pages are reused if the level needs more than 64 distinct screen
; pages (rare; only multi-room mini-games hit this).
;-------------------------------------------------------------------------
CODE_128824:
CODE_resolve_screen_page:                                        ; descriptive alias
	CPX.b #$80                                                ; \ X >= $80 means invalid screen
	BCS.b CODE_resolve_screen_overflow                                         ; / -> reset + reload level
	LDA.w $6CAA,x                                             ; \ existing page mapping for this screen?
	AND.b #$3F                                                ; / mask to LRU index
	BNE.b CODE_resolve_screen_final_offset                                         ; mapped -> compute final offset
	INC.w $0D4D                                               ; allocate next LRU slot
	LDA.w $0D4D
	AND.b #$3F
	TAY
	BNE.b CODE_resolve_screen_walk_lru                                         ; non-zero -> walk LRU chain
CODE_12883A:
CODE_resolve_screen_overflow:                                    ; descriptive alias
	REP.b #$30                                                ; \ panic path: reset stack and
	JSL.l CODE_109A85                                         ; / re-init LevelDataBuffer
	SEP.b #$10
	LDA.w #$01F1                                              ; \ stack pointer hard-reset
	TCS                                                       ; /
	SEP.b #$20
	LDA.b #CODE_unpack_header_then_load_objects>>16
	PHA
	PLB
	JML.l CODE_unpack_header_then_load_objects                                         ; restart level-data load

CODE_128850:
CODE_resolve_screen_walk_lru:                                    ; descriptive alias
	LDA.w $0D4E,y                                             ; chain head
	BEQ.b CODE_resolve_screen_claim                                         ; free slot -> claim it
	INY                                                       ; \ walk to next LRU slot
	TYA                                                       ; |
	AND.b #$3F                                                ; |
	TAY                                                       ; /
	CMP.w $0D4D
	BEQ.b CODE_128874                                         ; wrapped all the way around -> bail
	BRA.b CODE_resolve_screen_walk_lru

CODE_128861:
CODE_resolve_screen_claim:                                       ; descriptive alias
	TYA
	INC.b $97                                                 ; total-pages-allocated counter
	STA.w $6CAA,x                                             ; remember screen -> page mapping
	STA.w $0D4E,y                                             ; mark LRU slot occupied
CODE_12886A:
CODE_resolve_screen_final_offset:                                ; descriptive alias
	REP.b #$30
	AND.w #$00FF                                              ; A = LRU index (1..$3F)
	XBA                                                       ; \ << 8 (page byte) then << 1
	ASL                                                       ; / (each page = 512 bytes = 1 screen)
	ADC.b $00                                                 ; + intra-screen offset
	TAX                                                       ; X = final LevelDataBuffer index
CODE_128874:
	RTS

;-------------------------------------------------------------------------
; CODE_prng -- 8-bit pseudo-random number generator.
;
; Reads the HV-counter software latch (bumped on every CPU clock), shifts
; it right one bit (discards LSB to add a tiny amount of decorrelation),
; reads the live H-counter and adds the live V-counter. The result in A
; is "random enough" for cosmetic decisions like which grass-stalk variant
; to stamp on top of a floor tile.
;
; INPUTS:  none
; OUTPUTS: A    8-bit pseudo-random value
; MODIFIES: P (saved/restored via PHP/PLP)
; CALLERS:
;   - Bank12.asm itself: 12 JSL.l sites (per-object init handlers that
;     pre-randomise an orientation before walker setup).
;   - Bank13.asm: 50 JSL.l sites in per-cell handlers, mostly for
;     randomising grass/floor decoration variants.
;   - Bank01.asm: a small number of external callers in non-level game
;     logic (e.g. menu/title screen effects).
;-------------------------------------------------------------------------
CODE_128875:
CODE_prng:                                                       ; descriptive alias
	PHP
	SEP.b #$20
	LDA.l !REGISTER_SoftwareLatchForHVCounter
	LSR
	LDA.l !REGISTER_HCounter
	ADC.l !REGISTER_VCounter
	PLP
	RTL

;-------------------------------------------------------------------------
; DATA_default_handler_extents -- 10-byte orientation lookup used by CODE_extobj_handler_default_00_09 (the
; default per-object init handler for extended-IDs $00-$09, which is the
; "common single-tile stamp with per-byte $2A column-extent" wrapper).
; Entries: $02, $02, $02, $02, $01, $01, $01, $01, $03, $02.
;-------------------------------------------------------------------------
DATA_128887:
DATA_default_handler_extents:                                    ; descriptive alias
	db $02,$02,$02,$02,$01,$01,$01,$01,$03,$02

;=========================================================================
; PER-OBJECT INIT HANDLERS (extended-object branch)
;
; The following ~190 routines (CODE_extobj_handler_default_00_09 -- CODE_extobj_FB_copy_screen_exit) are dispatched
; into via DATA_extended_object_init_ptrs (the extended-object init pointer table). Each one
; is named CODE_xxxxxx in the framework. The common shape is:
;       REP #$20
;       LDA.w #cols ; STA $2A             ; column extent for walker
;       LDA.w #rows ; STA $2E             ; row extent for walker
;       LDA #per-orientation-bits          ; STA $15  (optional)
;       LDX.b #(BODY-$01)>>16              ; bank byte of per-cell handler
;       LDA.w #BODY-$01                    ; ptr-1 of per-cell handler
;       JMP CODE_walker_setup_trampoline                    ; <- common walker setup trampoline
; The trampoline at CODE_walker_setup_trampoline writes the per-row/per-col handler
; pointers into $1F/$22/$25 + bank bytes $21/$24/$27 and falls through
; to CODE_object_stream_walk (intra_object_walker).
;
; A second pattern (single-tile stamp):
;       JSR CODE_get_current_map16_tile                    ; fetch cell offset + tile
;       REP #$30
;       JSL.l BODY                          ; per-handler "modify this tile" logic
;       SEP #$30
;       RTL
;
; The first handler (CODE_extobj_handler_default_00_09) is the "default" for extended IDs $00-$09.
;=========================================================================
CODE_128891:
CODE_extobj_handler_default_00_09:                               ; descriptive alias
	REP.b #$20
	LDY.b $15
	LDA.w DATA_default_handler_extents,y
	AND.w #$00FF
	STA.b $2A
	LDA.w #$0003
	STA.b $2E
	TYA
	ASL
	STA.b $15
	LDX.b #(CODE_extobj_default_percell-$01)>>16
	LDA.w #CODE_extobj_default_percell-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1288AE:
CODE_extobj_handler_single_tile_variant_2:           ; ext-obj IDs $0A-$0B: single-tile stamp variant 2 (per-orientation cell)
	REP.b #$20
	INC.b $2A
	INC.b $2E
	LDA.b $15
	AND.w #$0001
	ASL
	STA.b $15
	LDX.b #(CODE_12A4C9-$01)>>16
	LDA.w #CODE_12A4C9-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1288C4:
CODE_extobj_handler_single_tile_variant_3:           ; ext-obj ID $0C: single-tile stamp variant 3 (4-row column)
	REP.b #$20
	INC.b $2A
	LDA.w #$0004
	STA.b $2E
	LDX.b #(CODE_12A4EC-$01)>>16
	LDA.w #CODE_12A4EC-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1288D5:
CODE_extobj_handler_8x16_block:                      ; ext-obj IDs $0D-$0E: 8x16 block (rare large terrain)
	REP.b #$20
	LDA.b $15
	AND.w #$0002
	STA.b $15
	LDA.w #$0008
	STA.b $2A
	LDA.w #$0010
	STA.b $2E
	LDX.b #(CODE_12A60F-$01)>>16
	LDA.w #CODE_12A60F-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1288F0:
CODE_extobj_handler_single_cell_dispatch:            ; ext-obj ID $0F: single-cell stamp (no walker; direct per-cell modify)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12A64B
	SEP.b #$30
	RTL

CODE_1288FC:
CODE_extobj_handler_16x32_block:                     ; ext-obj ID $10: 16x32 block (large terrain piece)
	REP.b #$20
	LDA.w #$0010
	STA.b $2A
	ASL
	STA.b $2E
	LDX.b #(CODE_12A665-$01)>>16
	LDA.w #CODE_12A665-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12890E:
CODE_extobj_handler_1x1_block:                       ; ext-obj ID $11: 1x1 block (minimal stamp)
	REP.b #$20
	LDA.w #$0001
	STA.b $2E
	INC
	STA.b $2A
	LDX.b #(CODE_12A68B-$01)>>16
	LDA.w #CODE_12A68B-$01
	JMP.w CODE_walker_setup_trampoline

DATA_128920:
	dw CODE_12A6A6-$01,CODE_12A6C2-$01

CODE_128924:
CODE_extobj_handler_pair_dispatch:                   ; ext-obj IDs $12-$13: pair-of-tiles dispatch via DATA_128920
	REP.b #$20
	LDA.w #$0001
	STA.b $2E
	LDA.w #$0005
	STA.b $2A
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_128920,y
	LDX.b #(CODE_12A6A6-$01)>>16
	JMP.w CODE_walker_setup_trampoline

DATA_12893F:
	dw CODE_12A6E8-$01,CODE_12A718-$01

DATA_128943:
	dw $0001,$FFFF

CODE_128947:
CODE_extobj_handler_slope_pair:                      ; ext-obj IDs $14-$15: slope dispatch via DATA_12893F + DATA_128943 (sign)
	REP.b #$20
	LDA.w #$0002
	STA.b $2E
	LDA.w #$0005
	STA.b $2A
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_128943,y
	STA.b $17
	LDA.w DATA_12893F,y
	LDX.b #(CODE_12A6E8-$01)>>16
	JMP.w CODE_walker_setup_keep_slope

CODE_128967:
CODE_extobj_handler_stake_single:                    ; ext-obj ID $16: single-cell stake-on-existing-floor (stamper CODE_12A734)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12A734
	SEP.b #$30
	RTL

CODE_128973:
CODE_extobj_handler_special_coin:                    ; ext-obj ID $17: special coin -- single-cell, item-memory gated (stamper CODE_12A749 places tile $A400 only if cell unclaimed)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12A749
	SEP.b #$30
	RTL

CODE_12897F:
CODE_extobj_handler_demo_setpiece_16x16:             ; ext-obj ID $18: stationary 16x16 demo/cutscene set-piece (walker CODE_12A859 reads arrangement table DATA_12A759)
	REP.b #$20
	LDA.w #$0010
	STA.b $2E
	STA.b $2A
	LDX.b #(CODE_12A859-$01)>>16
	LDA.w #CODE_12A859-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128990:
CODE_extobj_handler_finalboss_setpiece_24x3:         ; ext-obj ID $19: final-boss room set-piece variant 1 (24x3 walker via CODE_12AA77, $15=0)
	REP.b #$20
	LDA.w #$0018
	STA.b $2A
	LDA.w #$0003
	STA.b $2E
	STZ.b $15
	BRA.b CODE_1289B1

CODE_1289A0:
CODE_extobj_handler_finalboss_setpiece_32x12:        ; ext-obj ID $1A: final-boss room set-piece variant 2 (32x12 walker via CODE_12AA77, $15=1)
	REP.b #$20
	LDA.w #$0020
	STA.b $2A
	LDA.w #$000C
	STA.b $2E
	LDA.w #$0001
	STA.b $15
CODE_1289B1:
	LDX.b #(CODE_12AA77-$01)>>16
	LDA.w #CODE_12AA77-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1289B9:
CODE_extobj_handler_world6_bone_variant1:            ; ext-obj ID $1B: world-6 bone set-piece variant 1 (2x2 walker via CODE_12AAE5, $15=0)
	REP.b #$20
	LDA.w #$0000
	BRA.b CODE_1289CC

CODE_1289C0:
CODE_extobj_handler_world6_bone_variant2:            ; ext-obj ID $1C: world-6 bone set-piece variant 2 (2x2 walker via CODE_12AAE5, $15=2)
	REP.b #$20
	LDA.w #$0002
	BRA.b CODE_1289CC

CODE_1289C7:
CODE_extobj_handler_world6_bone_variant3:            ; ext-obj ID $1D: world-6 bone set-piece variant 3 (2x2 walker via CODE_12AAE5, $15=4)
	REP.b #$20
	LDA.w #$0004
CODE_1289CC:
	STA.b $15
	LDA.w #$0002
	STA.b $2E
	STA.b $2A
	LDX.b #(CODE_12AAE5-$01)>>16
	LDA.w #CODE_12AAE5-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1289DD:
CODE_extobj_handler_double_teleport_hole:            ; ext-obj ID $1E: double-teleport corridor hole (8x4 walker via CODE_12AB02)
	REP.b #$20
	LDA.w #$0008
	STA.b $2A
	LSR
	STA.b $2E
	LDX.b #(CODE_12AB02-$01)>>16
	LDA.w #CODE_12AB02-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1289EF:
CODE_extobj_handler_double_teleport_door:            ; ext-obj ID $1F: double-teleport corridor door (4x4 walker via CODE_12AB39)
	REP.b #$20
	LDA.w #$0004
	STA.b $2A
	STA.b $2E
	LDX.b #(CODE_12AB39-$01)>>16
	LDA.w #CODE_12AB39-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128A00:
CODE_extobj_handler_null:         ; ext-obj IDs $20-$2F (16 IDs): no-op in V1.0. Reads the current map16 tile + decrements $15, then JSLs CODE_12AB55 -- which is a bare RTL, so it stamps nothing. All 16 IDs share this one handler with no per-ID differentiation (trace stamps 0 cells).
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	LDA.b $15
	SEC
	SBC.w #$0008
	STA.b $15
	JSL.l CODE_12AB55
	SEP.b #$30
	RTL

CODE_128A14:
CODE_extobj_handler_castle_wall_hole_2x2:            ; ext-obj ID $30: 2x2 castle-wall breach (hole). Walker spans 4 cols x 2 rows via CODE_12AB64, but only the inner 2 cols carve the 2x2 hole; the outer 2 cols only blend into an existing wall edge. The $1B X pre-decrement (1 col) centers the hole over the 2-wide placement.
	REP.b #$20
	LDA.b $1B
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	STA.b $00
	LDA.b $1B
	AND.w #$F0F0
	ORA.b $00
	STA.b $1B
	LDA.w #$0004
	STA.b $2A
	LDA.w #$0002
	STA.b $2E
	LDX.b #(CODE_12AB64-$01)>>16
	LDA.w #CODE_12AB64-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128A3C:
CODE_extobj_handler_moving_wall_6x7:                 ; ext-obj ID $31: moving/sliding wall segment (6x7 walker via CODE_12AB9D)
	REP.b #$20
	LDA.w #$0006
	STA.b $2A
	INC
	STA.b $2E
	LDX.b #(CODE_12AB9D-$01)>>16
	LDA.w #CODE_12AB9D-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128A4E:
CODE_extobj_handler_wall_decal_family:         ; ext-obj IDs $32-$45 (20 IDs share one body): single-tile wall-decal family. $15-$32 indexes per-cell stamp CODE_12ABE1; $32-$3A are railroad-track decals, $3B-$45 are graffiti decals. Not a slope.
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	LDA.b $15
	SEC
	SBC.w #$0032
	STA.b $15
	JSL.l CODE_12ABE1
	SEP.b #$30
	RTL

CODE_128A62:
CODE_extobj_handler_random_question_block:                  ; ext-obj ID $46: randomly-tiled "?" block -- single-cell stamp CODE_12ABFF picks 1 of 4 tiles at random (via CODE_prng).
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12ABFF
	SEP.b #$30
	RTL

CODE_128A6E:
CODE_extobj_handler_bg_home_set:                     ; ext-obj ID $47: BG home decorative set (4x4 walker via CODE_12AC17 with $1B Y-decrement $0030)
	REP.b #$20
	LDA.b $1B
	AND.w #$0F0F
	STA.b $00
	LDA.b $1B
	AND.w #$F0F0
	SEC
	SBC.w #$0030
	AND.w #$F0F0
	ORA.b $00
	STA.b $1B
	LDA.w #$0004
	STA.b $2A
	STA.b $2E
	LDX.b #(CODE_12AC17-$01)>>16
	LDA.w #CODE_12AC17-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128A96:
CODE_extobj_handler_goal_pole:                       ; ext-obj ID $48: goal pole / level-end post -- 4x20 walker (CODE_12AC59), anchored via $1B X/Y shift
	REP.b #$20
	LDA.b $1B
	AND.w #$0F0F
	STA.b $00
	LDA.b $1B
	AND.w #$F0F0
	SEC
	SBC.w #$1030
	AND.w #$F0F0
	ORA.b $00
	STA.b $1B
	LDA.w #$0004
	STA.b $2A
	LDA.w #$0014
	STA.b $2E
	LDX.b #(CODE_12AC59-$01)>>16
	LDA.w #CODE_12AC59-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128AC1:
CODE_extobj_handler_treetop_grass:                   ; ext-obj ID $49: tree-top grass tuft (3x1 walker via CODE_12ACBB with $1B X-decrement)
	REP.b #$20
	LDA.b $1B
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	STA.b $00
	LDA.b $1B
	AND.w #$F0F0
	ORA.b $00
	STA.b $1B
	LDA.w #$0003
	STA.b $2A
	LDA.w #$0001
	STA.b $2E
	LDX.b #(CODE_12ACBB-$01)>>16
	LDA.w #CODE_12ACBB-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128AE9:
CODE_extobj_handler_tree_right_grass:                ; ext-obj ID $4A: tree-right grass overhang (single-cell via CODE_12ACD3)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12ACD3
	SEP.b #$30
	RTL

CODE_128AF5:
CODE_extobj_handler_tree_left_grass:                 ; ext-obj ID $4B: tree-left grass overhang (single-cell via CODE_12AD00)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12AD00
	SEP.b #$30
	RTL

CODE_128B01:
CODE_extobj_handler_mouse_hole:                   ; ext-obj ID $4C: Little Mouser entrance/exit hole -- single-cell stamp of the tile held in $1D1A (stamper CODE_12AD2D)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12AD2D
	SEP.b #$30
	RTL

CODE_128B0D:
CODE_extobj_handler_mid_grass_2x2:                   ; ext-obj ID $4D: mid-height grass tuft -- 2x2 walker (CODE_12AD3F, tiles DATA_12AD37)
	REP.b #$20
	LDA.w #$0002
	STA.b $2A
	STA.b $2E
	LDX.b #(CODE_12AD3F-$01)>>16
	LDA.w #CODE_12AD3F-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128B1E:
CODE_extobj_handler_upward_grass_1x2:                ; ext-obj ID $4E: upward-pointing grass tuft -- 1x2 walker (CODE_12AD5D, tiles DATA_12AD59)
	REP.b #$20
	LDA.w #$0001
	STA.b $2A
	LDA.w #$0002
	STA.b $2E
	LDX.b #(CODE_12AD5D-$01)>>16
	LDA.w #CODE_12AD5D-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128B32:
CODE_extobj_handler_downward_grass_single:           ; ext-obj ID $4F: downward-hanging grass tuft -- single-cell tile $014A (stamper CODE_12AD6F)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12AD6F
	SEP.b #$30
	RTL

; Shared by ext-obj IDs $50 (ArrowSignWall) and $A8 (ArrowSignSub) -- the
; only non-adjacent-ID share in the extended-object table
; (docs/leveldataengine.md S4). 2x2 sub-tile overlay walker:
;   - $15 bit 3 selects which table window CODE_12ADA9 reads:
;       bit3=0 (ID $50) -> low half  of DATA_12AD7D (rows 0..3, offsets 0..7)
;       bit3=1 (ID $A8) -> high half of DATA_12AD7D (rows 4..5, offsets 16..23)
;     The `AND #$0008; ASL` preserves only bit 3, shifted into bit 4 so it
;     becomes a +$10 offset that the per-cell stamper ORs into its Y index.
;   - $2A=$2E=$0002 -> 2 wide x 2 tall stamp footprint.
;   - Per-cell body CODE_12ADA9 compares each target cell against the
;     floor-top-row template tiles (!TileTpl_FloorRow0_Left/Right + the
;     trailing $1DB4/$1DB6 family) and either: writes a composite "sign-on-
;     floor-edge" tile pulled from a template slot (CODE_12ADD2 path,
;     DATA_12AD7D + LDA $0000,Y dereference), or falls through to a plain
;     sky/blank tile from DATA_12AD79.
CODE_128B3E:
CODE_extobj_handler_arrow_sign_2x2_overlay:    ; ext-IDs $50 / $A8: 2x2 arrow-sign overlay; $15 bit 3 picks sign variant
	REP.b #$20
	LDA.b $15
	AND.w #$0008
	ASL
	STA.b $15
	LDA.w #$0002
	STA.b $2A
	STA.b $2E
	LDX.b #(CODE_12ADA9-$01)>>16
	LDA.w #CODE_12ADA9-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128B57:
CODE_extobj_handler_spike_mace_center:                 ; ext-obj ID $51: whirling vortex / centre-marker (single-cell via CODE_12AE22)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12AE22
	SEP.b #$30
	RTL

CODE_128B63:
CODE_extobj_handler_spike_mace_room:                   ; ext-obj ID $52: rotating circular base / platform-rotator (5x2 walker via CODE_12AE3C with $1B X-decrement)
	REP.b #$20
	LDA.b $1B
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	STA.b $00
	LDA.b $1B
	AND.w #$F0F0
	ORA.b $00
	STA.b $1B
	LDA.w #$0005
	STA.b $2A
	LDA.w #$0002
	STA.b $2E
	LDX.b #(CODE_12AE3C-$01)>>16
	LDA.w #CODE_12AE3C-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128B8B:
CODE_extobj_handler_spike_ball_room:               ; ext-obj ID $53: chain-link / suspension pillar (5x3 walker via CODE_12AE88 with $1B X-decrement)
	REP.b #$20
	LDA.b $1B
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	STA.b $00
	LDA.b $1B
	AND.w #$F0F0
	ORA.b $00
	STA.b $1B
	LDA.w #$0005
	STA.b $2A
	LDA.w #$0003
	STA.b $2E
	LDX.b #(CODE_12AE88-$01)>>16
	LDA.w #CODE_12AE88-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128BB3:
CODE_extobj_handler_treetop_3x3_pair:            ; ext-obj IDs $54/$55: treetop 3x3 pair ($15 bit 0 selects variant; stamper CODE_12AEF6)
	REP.b #$20
	LDA.b $15
	AND.w #$0001
	ASL
	STA.b $15
	LDA.w #$0003
	STA.b $2A
	STA.b $2E
	LDX.b #(CODE_12AEF6-$01)>>16
	LDA.w #CODE_12AEF6-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128BCC:
CODE_extobj_handler_treetop_5x3_pair:            ; ext-obj IDs $56/$57: treetop 5x3 large pair ($15 bit 0 selects variant; stamper CODE_12AF48)
	REP.b #$20
	LDA.b $15
	AND.w #$0001
	ASL
	STA.b $15
	LDA.w #$0005
	STA.b $2A
	LDA.w #$0003
	STA.b $2E
	LDX.b #(CODE_12AF48-$01)>>16
	LDA.w #CODE_12AF48-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128BE8:
CODE_extobj_handler_tree_left_3x2_trio:            ; ext-obj IDs $58/$59/$5A: tree left-side 3x2 trio ($15 mod 4 selects variant; stamper CODE_12AF84)
	REP.b #$20
	LDA.b $15
	AND.w #$0003
	ASL
	STA.b $15
	LDA.w #$0003
	STA.b $2A
	LDA.w #$0002
	STA.b $2E
	LDX.b #(CODE_12AF84-$01)>>16
	LDA.w #CODE_12AF84-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128C04:
CODE_extobj_handler_tree_right_3x2_trio:              ; ext-obj IDs $5B/$5C/$5D: tree right-side 3x2 trio ($15 mod 4 selects variant; stamper CODE_12AFBF; shares the $3Dxx tree tiles with CODE_extobj_handler_tree_left_3x2_trio)
	REP.b #$20
	LDA.b $15
	INC
	AND.w #$0003
	ASL
	STA.b $15
	LDA.w #$0003
	STA.b $2A
	LDA.w #$0002
	STA.b $2E
	LDX.b #(CODE_12AFBF-$01)>>16
	LDA.w #CODE_12AFBF-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128C21:
CODE_extobj_handler_donut_block_small:           ; ext-obj ID $5E: small donut block (ring-shaped decoration) -- single-cell tile $7502 (stamper CODE_12B001)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12B001
	SEP.b #$30
	RTL

CODE_128C2D:
CODE_extobj_handler_rock_4x2:                 ; ext-obj ID $5F: Rock 1 (4x2 walker via CODE_12B101, $15=0)
	REP.b #$10
	LDA.b #$00
	LDX.w #$0004
	LDY.w #$0002
	BRA.b CODE_extobj_handler_rock_shared_tail

CODE_128C39:
CODE_extobj_handler_rock_5x3:                 ; ext-obj ID $60: Rock 2 (5x3 walker via CODE_12B101, $15=2)
	REP.b #$10
	LDA.b #$02
	LDX.w #$0005
	LDY.w #$0003
	BRA.b CODE_extobj_handler_rock_shared_tail

CODE_128C45:
CODE_extobj_handler_rock_3x2_a:               ; ext-obj ID $61: Rock 3 (3x2 walker via CODE_12B101, $15=4)
	REP.b #$10
	LDA.b #$04
	BRA.b CODE_128C4F

CODE_128C4B:
CODE_extobj_handler_rock_3x2_b:               ; ext-obj ID $62: Rock 4 (3x2 walker via CODE_12B101, $15=6)
	REP.b #$10
	LDA.b #$06
CODE_128C4F:
	LDX.w #$0003
	LDY.w #$0002
	BRA.b CODE_extobj_handler_rock_shared_tail

CODE_128C57:
CODE_extobj_handler_rock_5x4_a:               ; ext-obj ID $63: Rock 5 (5x4 walker via CODE_12B101, $15=8)
	REP.b #$10
	LDA.b #$08
	BRA.b CODE_128C61

CODE_128C5D:
CODE_extobj_handler_rock_5x4_b:               ; ext-obj ID $64: Rock 6 (5x4 walker via CODE_12B101, $15=A)
	REP.b #$10
	LDA.b #$0A
CODE_128C61:
	LDX.w #$0005
	LDY.w #$0004
	BRA.b CODE_extobj_handler_rock_shared_tail

CODE_128C69:
CODE_extobj_handler_rock_4x3:                 ; ext-obj ID $65: Rock 7 -- 4x3 walker via CODE_12B101 ($15=$0C)
	REP.b #$10
	LDA.b #$0C
	LDX.w #$0004
	LDY.w #$0003
	BRA.b CODE_extobj_handler_rock_shared_tail

CODE_128C75:
CODE_extobj_handler_rock_2x2:                  ; ext-obj ID $66: Rock 8, small rock (2x2 walker via CODE_12B101, $15=E)
	REP.b #$10
	LDA.b #$0E
	LDX.w #$0002
	TXY
CODE_128C7D:
CODE_extobj_handler_rock_shared_tail:         ; shared walker setup tail for ext-obj IDs $60-$66 (per-cell stamper CODE_12B101; $15/$2A/$2E preset by per-ID stubs above)
	STA.b $15
	REP.b #$20
	STX.b $2A
	STY.b $2E
	SEP.b #$10
	LDX.b #(CODE_12B101-$01)>>16
	LDA.w #CODE_12B101-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128C8F:
CODE_extobj_handler_old_branch:               ; ext-obj ID $67: old branch stuck in the ground (single-cell via CODE_12B14A)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12B14A
	SEP.b #$30
	RTL

CODE_128C9B:
CODE_extobj_handler_stalactite_rock_pair:            ; ext-obj IDs $68/$69: stalactite/cave-ceiling rock pair (single-cell via CODE_12B179)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12B179
	SEP.b #$30
	RTL

CODE_128CA7:
CODE_extobj_handler_grass_shadow_small:              ; ext-obj ID $6A: small grass-shadow decoration (3x2 walker via CODE_12B194, $15=0)
	REP.b #$10
	STZ.b $15
	LDX.w #$0003
	LDY.w #$0002
	BRA.b CODE_128CCC

CODE_128CB3:
CODE_extobj_handler_grass_shadow_mid:                ; ext-obj ID $6B: mid-size grass-shadow decoration (4x3 walker via CODE_12B194, $15=2)
	REP.b #$10
	LDX.w #$0002
	STX.b $15
	LDX.w #$0004
	BRA.b CODE_128CC9

CODE_128CBF:
CODE_extobj_handler_grass_shadow_big:                ; ext-obj ID $6C: large grass-shadow decoration (5x3 walker via CODE_12B194, $15=4)
	REP.b #$10
	LDX.w #$0004
	STX.b $15
	LDX.w #$0005
CODE_128CC9:
	LDY.w #$0003
CODE_128CCC:
	STX.b $2A
	STY.b $2E
	REP.b #$20
	SEP.b #$10
	LDX.b #(CODE_12B194-$01)>>16
	LDA.w #CODE_12B194-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128CDC:
CODE_extobj_handler_pipe_entry_4dir:                 ; ext-obj IDs $6D-$70: pipe entry-mouth, 4 cardinal directions (2x2 walker via CODE_12B21A, $15 mod 4 with -1 shift)
	REP.b #$20
	LDA.b $15
	DEC
	AND.w #$0003
	ASL
	STA.b $15
	LDA.w #$0002
	STA.b $2A
	STA.b $2E
	LDX.b #(CODE_12B21A-$01)>>16
	LDA.w #CODE_12B21A-$01
	JMP.w CODE_walker_setup_trampoline

DATA_128CF6:
	db $06,$06,$01,$01,$02,$02,$02,$02,$04,$04,$06,$06,$02

DATA_128D03:
	db $01,$01,$06,$06,$04,$04,$06,$06,$02,$02,$02,$02,$01

DATA_128D10:
	dw CODE_12B23C-$01,CODE_12B25A-$01,CODE_12B271-$01,CODE_12B288-$01,CODE_12B2A3-$01,CODE_12B2CB-$01,CODE_12B2F8-$01,CODE_12B326-$01
	dw CODE_12B349-$01,CODE_12B36A-$01,CODE_12B393-$01,CODE_12B3BC-$01,CODE_12B3D1-$01

CODE_128D2A:
CODE_extobj_handler_pipe_shape_family:               ; ext-obj IDs $71-$7D: 13-way pipe-shape family (extents from DATA_128CF6/D03; per-cell stamper from DATA_128D10)
	REP.b #$20
	LDA.b $15
	AND.w #$000F
	TAY
	ASL
	TAX
	LDA.w DATA_128CF6-$01,y
	AND.w #$00FF
	STA.b $2A
	LDA.w DATA_128D03-$01,y
	AND.w #$00FF
	STA.b $2E
	LDA.w DATA_128D10-$02,x
	LDX.b #(CODE_12B23C-$01)>>16
	JMP.w CODE_walker_setup_trampoline

CODE_128D4C:
CODE_extobj_handler_pipe_lakitu_cave_pair:           ; ext-obj IDs $7E/$7F: pipe-mouth Lakitu-cave pair ($15 bit 0 selects variant; stamper CODE_12B3E1)
	REP.b #$20
	LDA.b $15
	AND.w #$0001
	ASL
	STA.b $15
	LDX.b #(CODE_12B3E1-$01)>>16
	LDA.w #CODE_12B3E1-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128D5E:
CODE_extobj_handler_lakitu_hole:                     ; ext-obj ID $80: Lakitu (Jugemu) cloud-hole (single-cell via CODE_12B3F1)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12B3F1
	SEP.b #$30
	RTL

CODE_128D6A:
CODE_extobj_handler_goal_floor_stand:                ; ext-obj ID $81: goal-area floor stand / platform base (4-wide row via CODE_12B3FB)
	REP.b #$20
	LDA.w #$0004
	STA.b $2A
	LDX.b #(CODE_12B3FB-$01)>>16
	LDA.w #CODE_12B3FB-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128D79:
CODE_extobj_handler_goal_roof_8x5:                   ; ext-obj ID $82: goal-area roof piece (8x5 walker via CODE_12B45C with $1B Y-decrement $0040)
	REP.b #$20
	LDA.b $1B
	AND.w #$0F0F
	STA.b $00
	LDA.b $1B
	AND.w #$70F0
	SEC
	SBC.w #$0040
	AND.w #$70F0
	ORA.b $00
	STA.b $1B
	LDA.w #$0008
	STA.b $2A
	LDA.w #$0005
	STA.b $2E
	LDX.b #(CODE_12B45C-$01)>>16
	LDA.w #CODE_12B45C-$01
	JMP.w CODE_walker_setup_trampoline

DATA_128DA4:
	dw $0090,$0050,$0030,$0030,$0030

DATA_128DAE:
	dw $0020,$0013,$000A,$0008,$000D

DATA_128DB8:
	dw $0016,$000B,$0007,$0007,$0008

CODE_128DC2:
CODE_extobj_handler_sky_cloud_family:                ; ext-obj IDs $83-$87: 5-way sky-cloud family (Y-shift from DATA_128DA4, extents from DATA_128DAE/B8; stamper CODE_12B933)
	REP.b #$20
	LDA.b $15
	SEC
	SBC.w #$0083
	ASL
	STA.b $15
	TAX
	LDA.b $1B
	AND.w #$0F0F
	STA.b $00
	LDA.b $1B
	AND.w #$70F0
	SEC
	SBC.w DATA_128DA4,x
	AND.w #$70F0
	ORA.b $00
	STA.b $1B
	LDA.w DATA_128DAE,x
	STA.b $2A
	LDA.w DATA_128DB8,x
	STA.b $2E
	STZ.w $00A1
	LDX.b #(CODE_12B933-$01)>>16
	LDA.w #CODE_12B933-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128DFA:
CODE_extobj_handler_pipe_hole_4x4:                   ; ext-obj ID $88: pipe-hole / open-pipe-mouth (4x4 walker via CODE_12B97B)
	REP.b #$20
	LDA.w #$0004
	STA.b $2A
	STA.b $2E
	LDX.b #(CODE_12B97B-$01)>>16
	LDA.w #CODE_12B97B-$01
	JMP.w CODE_walker_setup_trampoline

DATA_128E0B:
	dw $0002,$0002,$0001,$0001

DATA_128E13:
	dw $0001,$0001,$0002,$0002

DATA_128E1B:
	dw CODE_12BAED-$01,CODE_12BB2A-$01

CODE_128E1F:
CODE_extobj_handler_pipe_arrow_4dir:                 ; ext-obj IDs $89-$8C: pipe-arrow indicator, 4 cardinal directions (extents from DATA_128E0B/E13; stamper from DATA_128E1B picks CODE_12BAED / CODE_12BB2A)
	REP.b #$20
	LDA.b $15
	AND.w #$0007
	ASL
	TAX
	LDA.w DATA_128E0B-$02,x
	STA.b $2A
	LDA.w DATA_128E13-$02,x
	STA.b $2E
	LDA.b $15
	DEC
	AND.w #$0002
	TAY
	LDA.b $15
	DEC
	AND.w #$0001
	ASL
	STA.b $15
	LDX.b #(CODE_12BAED-$01)>>16
	LDA.w DATA_128E1B,y
	JMP.w CODE_walker_setup_trampoline

CODE_128E4A:
CODE_extobj_handler_no_egg_grass:                    ; ext-obj ID $8D: "no-egg" grass marker (single-cell special-collision via CODE_12BB63)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12BB63
	SEP.b #$30
	RTL

CODE_128E56:
CODE_extobj_handler_line_guide_small_corner_family:        ; ext-obj IDs $8E-$91: 4-way small line-guide corner family (single-cell; $15 INC INC AND #$03 selects orientation 0=TL/1=TR/2=BL/3=BR; stamper CODE_12BC01)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	LDA.b $15
	INC
	INC
	AND.w #$0003
	STA.b $15
	JSL.l CODE_12BC01
	SEP.b #$30
	RTL

CODE_128E6B:
CODE_extobj_handler_line_guide_mid_corner_family:          ; ext-obj IDs $92-$95: 4-way mid-size line-guide corner family (2x2 walker; orientation TL/TR/BL/BR; stamper CODE_12BC2A)
	REP.b #$20
	LDA.b $15
	INC
	INC
	AND.w #$0003
	ASL
	STA.b $15
	LDA.w #$0002
	STA.b $2A
	STA.b $2E
	LDX.b #(CODE_12BC2A-$01)>>16
	LDA.w #CODE_12BC2A-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128E86:
CODE_extobj_handler_line_guide_large_corner_family:          ; ext-obj IDs $96-$99: 4-way large line-guide corner family (8x8 walker; orientation TL/TR/BL/BR; stamper CODE_12BD55)
	REP.b #$20
	LDA.b $15
	INC
	INC
	AND.w #$0003
	ASL
	STA.b $15
	LDA.w #$0008
	STA.b $2A
	STA.b $2E
	LDX.b #(CODE_12BD55-$01)>>16
	LDA.w #CODE_12BD55-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128EA1:
CODE_extobj_handler_line_guide_stopper_family:         ; ext-obj IDs $9A-$9D: 4-way line-guide stopper family (2-cell stamp body+cap; end L/R/T/B; stamper CODE_12BD8E)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	LDA.b $15
	DEC
	DEC
	AND.w #$0003
	ASL
	STA.b $15
	JSL.l CODE_12BD8E
	SEP.b #$30
	RTL

CODE_128EB7:
CODE_extobj_handler_pipe_cap_pair:                   ; ext-obj IDs $9E/$9F: pipe end-cap pair, Left/Right ($15 bit 0 selects orientation; stamper CODE_12BDC0)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	LDA.b $15
	AND.w #$0001
	ASL
	STA.b $15
	JSL.l CODE_12BDC0
	SEP.b #$30
	RTL

DATA_128ECB:
	dw $FFFF,$0000,$FFFF,$0000

DATA_128ED3:
	dw $FFF0,$FFF0,$0000,$0000

DATA_128EDB:
	dw CODE_12BDEA-$01,CODE_12BE42-$01,CODE_12BE99-$01,CODE_12BEF1-$01

CODE_128EE3:
CODE_extobj_handler_pipe_corner_family:              ; ext-obj IDs $A0-$A3: 4-way pipe-elbow corner family (X/Y deltas from DATA_128ECB/ED3; per-cell stamper from DATA_128EDB; UL/UR/DL/DR quadrants)
	REP.b #$20
	LDA.b $15
	AND.w #$0003
	ASL
	TAY
	LDA.b $1B
	AND.w #$0F0F
	CLC
	ADC.w DATA_128ECB,y
	AND.w #$0F0F
	STA.b $00
	LDA.b $1B
	AND.w #$F0F0
	CLC
	ADC.w DATA_128ED3,y
	AND.w #$F0F0
	ORA.b $00
	STA.b $1B
	LDA.w #$0002
	STA.b $2A
	STA.b $2E
	LDX.b #(CODE_12BDEA-$01)>>16
	LDA.w DATA_128EDB,y
	JMP.w CODE_walker_setup_trampoline

CODE_128F19:
CODE_extobj_handler_flower_burst_2x2:                ; ext-obj ID $A4: flower-burst starburst (2x2 walker via CODE_12BF4B)
	REP.b #$20
	LDA.w #$0002
	STA.b $2A
	STA.b $2E
	LDX.b #(CODE_12BF4B-$01)>>16
	LDA.w #CODE_12BF4B-$01
	JMP.w CODE_walker_setup_trampoline

DATA_128F2A:
	dw $0001,$0002

DATA_128F2E:
	dw $0040,$0080

DATA_128F32:
	dw $0003,$0005

DATA_128F36:
	dw $0005,$0009

CODE_128F3A:
CODE_extobj_handler_xmas_tree_pair:                  ; ext-obj IDs $A5/$A6: Christmas-tree decoration pair ($15 bit 0 selects size variant; deltas from DATA_128F2A/2E; shape from DATA_128F32/36; stamper CODE_12BFF4)
	REP.b #$20
	LDA.b $15
	AND.w #$0001
	STA.b $15
	ASL
	TAX
	LDA.w $001B
	AND.w #$0F0F
	SEC
	SBC.w DATA_128F2A,x
	AND.w #$0F0F
	STA.b $00
	LDA.w $001B
	AND.w #$F0F0
	SEC
	SBC.w DATA_128F2E,x
	AND.w #$F0F0
	ORA.b $00
	STA.w $001B
	LDA.w DATA_128F32,x
	STA.b $2A
	LDA.w DATA_128F36,x
	STA.b $2E
	LDX.b #(CODE_12BFF4-$01)>>16
	LDA.w #CODE_12BFF4-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128F78:
CODE_extobj_handler_ice_ramp:                        ; ext-obj ID $A7: underground ice ramp / hyo-hyo ice-slip pattern (single-cell via CODE_12C063)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12C063
	SEP.b #$30
	RTL

DATA_128F84:
	dw $0005,$0004,$0003,$0003

CODE_128F8C:
CODE_extobj_handler_gravel_family:                   ; ext-obj IDs $A9-$AC: 4-way underground-gravel family (row extents from DATA_128F84; stamper CODE_12C044)
	REP.b #$20
	LDA.b $15
	AND.w #$0007
	DEC
	ASL
	STA.b $15
	TAY
	LDA.w DATA_128F84,y
	STA.b $2E
	LDX.b #(CODE_12C044-$01)>>16
	LDA.w #CODE_12C044-$01
	JMP.w CODE_walker_setup_trampoline

DATA_128FA5:
	dw $0000,$000E,$001C,$002A

DATA_128FAD:
	dw $0003,$0003,$0002,$0002,$0002,$0002

CODE_128FB9:
CODE_extobj_handler_crystal_cluster_family:          ; ext-obj IDs $AD-$B2: 6-way crystal-cluster family (RNG-driven $A1 from DATA_128FA5; row extents from DATA_128FAD; stamper CODE_12C0B1)
	REP.b #$20
	JSL.l CODE_prng
	AND.w #$0006
	TAY
	LDA.w DATA_128FA5,y
	STA.b $A1
	LDA.w #$0002
	STA.b $2A
	LDA.b $15
	SEC
	SBC.w #$00AD
	ASL
	STA.b $15
	TAY
	LDA.w DATA_128FAD,y
	STA.b $2E
	LDX.b #(CODE_12C0B1-$01)>>16
	LDA.w #CODE_12C0B1-$01
	JMP.w CODE_walker_setup_trampoline

CODE_128FE4:
CODE_extobj_handler_underground_lava_rock:           ; ext-obj ID $B3: underground lava-rock (single-cell via CODE_12C0CF)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12C0CF
	SEP.b #$30
	RTL

CODE_128FF0:
CODE_extobj_handler_mushroom_small_pair:             ; ext-obj IDs $B4/$B5: underground mushroom-small pair (2x2 walker; RNG-driven $A1; $15 bit 0; stamper CODE_12C108)
	REP.b #$20
	LDA.w #$0002
	STA.b $2A
	STA.b $2E
	JSL.l CODE_prng
	AND.w #$0004
	STA.b $A1
	LDA.b $15
	AND.w #$0001
	STA.b $15
	LDX.b #(CODE_12C108-$01)>>16
	LDA.w #CODE_12C108-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129011:
CODE_extobj_handler_mushroom_big_pair:               ; ext-obj IDs $B6/$B7: underground mushroom-big pair (3x3 walker; PRNG bit + $15 bit 0 = 2-bit variant; stamper CODE_12C191)
	REP.b #$20
	LDA.w #$0003
	STA.b $2A
	STA.b $2E
	JSL.l CODE_prng
	AND.w #$0001
	STA.b $00
	LDA.b $15
	AND.w #$0001
	ASL
	ADC.b $00
	ASL
	STA.b $15
	LDX.b #(CODE_12C191-$01)>>16
	LDA.w #CODE_12C191-$01
	JMP.w CODE_walker_setup_trampoline

DATA_129036:
	dw $0004,$0005

DATA_12903A:
	dw $0004,$0006

CODE_12903E:
CODE_extobj_handler_mushroom_cluster_pair:           ; ext-obj IDs $B8/$B9: 3- and 4-mushroom cluster pair ($15 bit 0 selects; extents from DATA_129036/3A; stamper CODE_12C244)
	REP.b #$20
	LDA.b $15
	AND.w #$0001
	ASL
	STA.b $15
	TAY
	LDA.w DATA_129036,y
	STA.b $2A
	LDA.w DATA_12903A,y
	STA.b $2E
	LDX.b #(CODE_12C244-$01)>>16
	LDA.w #CODE_12C244-$01
	JMP.w CODE_walker_setup_trampoline

DATA_12905B:
	dw $0002,$0003,$0004,$0004,$0003,$0002

CODE_129067:
CODE_extobj_handler_dandelion_family:           ; ext-obj IDs $BA-$BF: 6-way slime-mushroom family (row extents from DATA_12905B; RNG-driven $A1; stamper CODE_12C29C)
	REP.b #$20
	LDA.b $15
	SEC
	SBC.w #$00BA
	ASL
	STA.b $15
	TAY
	LDA.w DATA_12905B,y
	STA.b $2E
	JSL.l CODE_prng
	AND.w #$0003
	BEQ.b CODE_129084
	EOR.w #$0003
CODE_129084:
	STA.b $A1
	LDX.b #(CODE_12C29C-$01)>>16
	LDA.w #CODE_12C29C-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12908E:
CODE_extobj_handler_sky_small_girder_stand:          ; ext-obj ID $C0: sky-world small girder-stand decoration (2x2 walker via CODE_12C2CA)
	REP.b #$20
	LDA.w #$0002
	STA.b $2A
	STA.b $2E
	LDX.b #(CODE_12C2CA-$01)>>16
	LDA.w #CODE_12C2CA-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12909F:
CODE_extobj_handler_snowy_platform_tip:               ; ext-obj ID $C1: sky-world pointed-spike decoration (2x1 walker via CODE_12C302)
	REP.b #$20
	LDA.w #$0002
	STA.b $2A
	DEC
	STA.b $2E
	LDX.b #(CODE_12C302-$01)>>16
	LDA.w #CODE_12C302-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1290B1:
CODE_extobj_handler_sky_big_base_pair:               ; ext-obj IDs $C2/$C3: sky-world big-base pair (4x4 walker; $15 bit 0 ASLx4 selects variant; stamper CODE_12C375)
	REP.b #$20
	LDA.w #$0004
	STA.b $2A
	STA.b $2E
	LDA.b $15
	AND.w #$0001
	ASL
	ASL
	ASL
	ASL
	STA.b $15
	LDX.b #(CODE_12C375-$01)>>16
	LDA.w #CODE_12C375-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1290CD:
CODE_extobj_handler_egg_block:                       ; ext-obj ID $C4: egg-block (! switch) ground decoration (single-cell via CODE_12C38E)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_12C38E
	SEP.b #$30
	RTL

DATA_1290D9:
	dw $0002,$0003,$0002,$0002,$0002

DATA_1290E3:
	dw $0002,$0003,$0003,$0002,$0002

CODE_1290ED:
CODE_extobj_handler_flower_pattern_family:           ; ext-obj IDs $C5-$C9: 5-way flower-pattern wall family (extents from DATA_1290D9/E3; stamper CODE_12C3D3)
	REP.b #$20
	LDA.b $15
	SEC
	SBC.w #$00C5
	ASL
	STA.b $15
	TAX
	LDA.w DATA_1290D9,x
	STA.b $2A
	LDA.w DATA_1290E3,x
	STA.b $2E
	LDX.b #(CODE_12C3D3-$01)>>16
	LDA.w #CODE_12C3D3-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12910B:
CODE_extobj_handler_flower_blossom_family:              ; ext-obj IDs $CA-$D3: 10-way flower-decoration family (single-cell; $15-$CA selects variant; stamper CODE_12C3FF)
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	LDA.b $15
	SEC
	SBC.w #$00CA
	STA.b $15
	JSL.l CODE_12C3FF
	SEP.b #$30
	RTL

DATA_12911F:
	db $05,$05,$05,$03,$03,$05,$05,$05,$03,$03,$07,$07

DATA_12912B:
	db $05,$05,$06,$04,$03,$05,$05,$06,$04,$03,$06,$06

CODE_129137:
CODE_extobj_handler_flower_rock_art_family:          ; ext-obj IDs $D4-$DF: 12-way flower-rock wall-art family (extents from DATA_12911F/12B; stamper CODE_12C690)
	REP.b #$20
	LDA.b $15
	SEC
	SBC.w #$00D4
	TAY
	ASL
	STA.b $15
	LDA.w DATA_12911F,y
	AND.w #$00FF
	STA.b $2A
	LDA.w DATA_12912B,y
	AND.w #$000F
	STA.b $2E
	LDX.b #(CODE_12C690-$01)>>16
	LDA.w #CODE_12C690-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12915B:
CODE_extobj_handler_pipe_3d_key:                ; ext-obj ID $E0: lava-locked pipe decoration (2x2 walker via CODE_12C6EA)
	REP.b #$20
	LDA.w #$0002
	STA.b $2A
	STA.b $2E
	LDX.b #(CODE_12C6EA-$01)>>16
	LDA.w #CODE_12C6EA-$01
	JMP.w CODE_walker_setup_trampoline

;-------------------------------------------------------------------------
; Ext-object screen-table action cluster ($FB-$FE).
;
; The last four entries in DATA_128000 (ext-object dispatch) -- rows $FB
; through $FE -- are not tile stampers. They're per-screen METADATA
; commands: each runs in O(1) at level-load time, mutates the screen-exit
; table ($6CAA) or a single Map16 cell, and returns. They bypass the
; standard row x col walker entirely. The level-data stream invokes them
; as ext-object records with no extent bytes.
;
; See also: yi/Constants/ExtendedObjectIDs.asm rows $FB-$FE for the
; per-ID summaries.
;-------------------------------------------------------------------------

; Ext-object $FB: copy a screen-exit entry from one screen-index to another.
; $001C = source screen-index; $001B = destination. Used to duplicate a
; configured screen-exit across two pages without re-encoding it.
CODE_12916C:
CODE_extobj_FB_copy_screen_exit:
	LDX.w $001C
	LDY.w $001B
	LDA.w $6CAA,x
	STA.w $6CAA,y
	RTL

; Ext-object $FC: VESTIGIAL no-op. Single `RTL`. The dispatch slot is wired
; but the handler does nothing. (External-source codename "SPLB2POS-1"
; suggests this was originally intended to write Baby-Mario's spawn
; position for split-screen / multi-player; the implementation was
; stripped before ship.) Treat as "the empty action" -- harmless if a
; level-data stream invokes it, but no level should.
CODE_129179:
CODE_extobj_FC_vestigial_noop:
	RTL

; Ext-object $FD: clear ONE Map16 cell. Reads the current cell via
; CODE_get_current_map16_tile, then JSLs CODE_extobj_stamp_clear_cell to write $0000.
; Used to punch a single-cell hole through pre-stamped terrain.
CODE_12917A:
CODE_extobj_FD_clear_map16_cell:
	JSR.w CODE_get_current_map16_tile
	REP.b #$30
	JSL.l CODE_extobj_stamp_clear_cell
	SEP.b #$30
	RTL

; Ext-object $FE: set bit 7 ($80) on $6CAA,$1C, the per-screen page-cache
; byte. Bit 7 is independent of the page-LRU (which masks it via AND #$3F);
; it flags "treat this screen as not page-allocated" and is read only by the
; Baby Mario float limiter (CODE_06C281) -- which zeroes the lost-Baby
; bubble's speed so it cannot drift into this screen -- and a minor SuperFX
; render gate (CODE_0EFE7F). Scroll and screen-exit code ignore bit 7.
CODE_129186:
CODE_extobj_FE_set_babymario_float_limit:
	LDX.b $1C
	LDA.w $6CAA,x
	ORA.b #$80
	STA.w $6CAA,x
	RTL

CODE_129191:
CODE_init_screen_exit_clear:                                     ; Object $00 init: not a tile-stamp object  clears the 256-entry screen-num-to-exit map ($7E:6CAA), then zeroes a full 512-byte screen-exit destination block at $7F:8000+(screen_id*$200) and decrements live-exit count $0D4D. Special "delete screen exit" command, dispatched by the standard-object table but doesn't drive the walker.
	LDY.b $1C
	LDA.w $6CAA,y
	AND.b #$3F
	BEQ.b CODE_1291D3
	PHA
	TAX
	STZ.w $0D4E,x
	TYX
	LDA.b #$80
	STA.w $6CAA,x
	PLA
	TAX
	LDA.b #$7F8000>>16
	STA.b $22
	STA.b $26
	REP.b #$20
	TXA
	AND.w #$00FF
	XBA
	ASL
	CLC
	ADC.w #$7F8000
	STA.b $20
	CLC
	ADC.w #$0100
	STA.b $24
	LDA.w #$0000
	LDY.b #$00
CODE_1291C6:
	STA.b [$20],y
	STA.b [$24],y
	INY
	INY
	BNE.b CODE_1291C6
	SEP.b #$20
	DEC.w $0D4D
CODE_1291D3:
	RTL

CODE_1291D4:
CODE_init_floor_basic:                                     ; Object $01 init: THE basic ground/ledge (most common ground object), variable width x height from the object's size bytes -- NOT a fixed 3-wide. Wires the column-major walker: even-col handler = CODE_bg_floor_left (left-half surface/dirt tiles), odd-col = CODE_bg_floor_right (right-half), row handler = CODE_bg_floor_random. Sets $19=3, the per-column ROW threshold: rows 0-2 use the deterministic left/right tiles, rows >=3 use random grass fill (so random only fires on floors >=4 tall). Shifts the row origin up one tile (preserving column nibble) and grows the object one taller (INC $2E), then invokes the object-stream walker.
	LDA.b #(CODE_bg_floor_left-$01)>>16
	STA.b $24
	LDA.b #(CODE_bg_floor_right-$01)>>16
	STA.b $21
	LDA.b #(CODE_bg_floor_random-$01)>>16
	STA.b $27
	REP.b #$30
	LDA.b $1B
	PHA
	AND.w #$0F0F
	STA.b $00
	PLA
	AND.w #$F0F0
	SEC
	SBC.w #$0010
	AND.w #$F0F0
	ORA.b $00
	STA.b $1B
	INC.b $2E
	LDA.w #CODE_bg_floor_left-$01
	STA.b $22
	LDA.w #CODE_bg_floor_right-$01
	STA.b $1F
	LDA.w #CODE_bg_floor_random-$01
	STA.b $25
	LDA.w #$0003
	STA.b $19
	STZ.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

;-------------------------------------------------------------------------
; CODE_init_floor_edge_or_wall -- dispatcher for 4 standard-object IDs
; ($02 / $03 floor left / right edge, $0A / $0B vertical wall left / right).
;
; Three parallel 10-entry tables encode per-ID handler state:
;   DATA_129286 -- 10 BANK bytes  (only entries 0,1,8,9 populated)
;   DATA_129290 -- 10 stamp-handler PTR words (parallel to DATA_129286)
;   DATA_1292A4 -- 10 walker $19 "per-col-handler row count" words
;
; Logical index into all three tables is (ID - 2): floor edges land at
; entries 0,1 and walls at entries 8,9 (entries 2..7 are unused holes).
; Physical X-register scaling differs between the byte and word tables:
;
;   `LDX $15 ; LDA DATA_129286-$02,x`
;        X = ID            (byte; -$02 displacement maps ID -> entry 0/1/8/9)
;
;   `LDA $15 ; ASL ; TAX ; LDA DATA_129290-$04,x`
;   `                       LDA DATA_1292A4-$04,x`
;        X = ID*2          (word; -$04 displacement maps ID*2 -> word 0/1/8/9)
;
; The later `CPX #$0006` and `CPX #$0008` compare against this DOUBLED X
; (so #$0008 boundary = ID >= 4, #$0006 boundary = ID >= 3).
;
; Setup paths after the table reads:
;   ID = $02 (X = 4):       full row-up shift + INC $2A/$2E + DEC $02 nibble
;   ID = $03 (X = 6):       full row-up shift + INC $2A/$2E (no $02 dec)
;   ID = $0A/$0B (X >= 8):  skip all setup; jump straight to walker
;
; The `LDA DATA_129286-$02,x` at line 2924 is a vestigial dead read -- its
; result is overwritten by the very next `LDA #...>>16` immediate. All
; handler banks are $13 (both CODE_bg_floor_random_probe_exit and
; CODE_wall_left_right live in bank $13), so the bank byte was hard-coded
; and the table-driven fetch became redundant.
;-------------------------------------------------------------------------
CODE_129217:
CODE_init_floor_edge_or_wall:                                     ; Object $02/$03 (floor left/right edge) and $0A/$0B (vertical wall left/right) init: shared dispatcher routing 4 IDs through 3 parallel tables. See doc-block above for X-register scaling (byte vs word) and the dead bank-table read at $12:9219.
	LDX.b $15
	LDA.w DATA_129286-$02,x
	LDA.b #CODE_bg_floor_random_probe_exit>>16
	STA.b $24
	STA.b $21
	LDA.b #(CODE_floor_edge_random_side-$01)>>16
	STA.b $27
	REP.b #$30
	LDA.b $15
	ASL
	TAX
	LDA.w DATA_129290-$04,x
	STA.b $22
	STA.b $1F
	LDA.w #CODE_floor_edge_random_side-$01
	STA.b $25
	LDA.w DATA_1292A4-$04,x
	STA.b $19
	STZ.b $17
	STZ.b $A1
	CPX.w #$0008
	BCS.b CODE_129280
	LDA.b $1B
	PHA
	AND.w #$F0F0
	SEC
	SBC.w #$0010
	AND.w #$F0F0
	STA.b $00
	PLA
	AND.w #$0F0F
	STA.b $02
	INC.b $2A
	INC.b $2E
	LDA.w #$0002
	STA.b $A1
	CPX.w #$0006
	BCS.b CODE_12927A
	LDA.b $02
	DEC
	AND.w #$0F0F
	STA.b $02
	LDA.b $2E
	STA.b $A1
	LDA.w #$0002
	STA.b $2E
CODE_12927A:
	LDA.b $00
	ORA.b $02
	STA.b $1B
CODE_129280:
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

DATA_129286:
DATA_floor_edge_or_wall_stamp_banks:                                     ; 10-entry BANK-byte table for CODE_init_floor_edge_or_wall. Indexed by X = ID (with -$02 displacement) so entries 0/1 = floor edges, 8/9 = walls, 2-7 = unused holes. Read at $12:9219 but the LDA is dead -- its result is overwritten by the next immediate LDA. All populated entries are $13 (floor and wall handlers both live in bank $13). Vestigial; paired with DATA_129290 (low-word ptr) and DATA_1292A4 ($19 row count).
	db CODE_bg_floor_random_probe_exit>>16,CODE_bg_floor_random_probe_exit>>16,$00,$00,$00,$00,$00,$00
	db (CODE_wall_left_right-$01)>>16,(CODE_wall_left_right-$01)>>16

DATA_129290:
DATA_floor_edge_or_wall_stamp_ptrs:                                     ; 10-entry low-WORD stamp-handler pointer table for CODE_init_floor_edge_or_wall. Indexed by X = ID*2 (with -$04 displacement) so word entries 0/1 = CODE_bg_floor_random_probe_exit-$01 for floor edges, 8/9 = CODE_wall_left_right-$01 for walls, 2-7 unused. Loaded into $22 (even-col) and $1F (odd-col); both odd/even-col bank registers $24/$21 are hard-coded to $13 from the next-line constant.
	dw CODE_bg_floor_random_probe_exit,CODE_bg_floor_random_probe_exit,$0000,$0000,$0000,$0000,$0000,$0000
	dw CODE_wall_left_right-$01,CODE_wall_left_right-$01

DATA_1292A4:
DATA_floor_edge_or_wall_extents:                                     ; 10-entry word table of walker $19 values (per-col-handler row count) for CODE_init_floor_edge_or_wall. Indexed by X = ID*2 (with -$04 displacement) parallel to DATA_129290. Word entries 0/1 = $0003 (floor edges run per-col handler for 3 rows), 8/9 = $0001 (walls run per-col for the top row only, then per-row handler for the rest), 2-7 unused. Stored at $19 which the walker's CMP.b $2C, $19 uses to switch from per-col to per-row dispatch.
	dw $0003,$0003,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0001,$0001

DATA_1292B8:
DATA_slope22_orientation_signs:                                     ; 2-entry orientation-sign table ($FFFF / $0001) for CODE_init_floor_slope_22deg: picks negative-step (left-rising) or positive-step (right-rising) walker direction.
	dw $FFFF,$0001

CODE_1292BC:
CODE_init_floor_slope_22deg:                                     ; Object $04/$05 (22.5-deg up/down slope) init: applies row-up shift (via CODE_floor_row_shift_up), masks orientation $15 bit 0, picks $17 direction from DATA_1292B8, may shift row a second time, then activates the CODE_floor_slope_22deg cell stamper in keep-slope walker mode.
	REP.b #$20
	JSR.w CODE_12933A
	LDA.b $15
	AND.w #$0001
	ASL
	STA.b $15
	TAY
	LDA.w DATA_1292B8,y
	STA.b $17
	TYA
	BEQ.b CODE_1292D5
	JSR.w CODE_12933A
CODE_1292D5:
	LDX.b #(CODE_floor_slope_22deg-$01)>>16
	LDA.w #CODE_floor_slope_22deg-$01
	JMP.w CODE_walker_setup_keep_slope

CODE_1292DD:
CODE_init_floor_slope_45deg:                                     ; Object $06-$09 (45 / 67.5-deg up/down slope) init: applies row-up shift, may apply a second shift for orientations $07/$09, then loads CODE_floor_slope_45deg_up / _down stamp banks plus the random-fill bank, indexes DATA_129322/DATA_12932E to derive width-step/direction pair, and invokes the object-stream walker.
	LDA.b #(CODE_floor_slope_45deg_up-$01)>>16
	STA.b $24
	STA.b $21
	LDA.b #(CODE_bg_floor_random-$01)>>16
	STA.b $27
	REP.b #$30
	JSR.w CODE_12933A
	LDA.b $15
	CMP.w #$0007
	BEQ.b CODE_1292F8
	CMP.w #$0009
	BNE.b CODE_1292FB
CODE_1292F8:
	JSR.w CODE_12933A
CODE_1292FB:
	LDA.w #CODE_floor_slope_45deg_up-$01
	STA.b $22
	LDA.w #CODE_floor_slope_45deg_down-$01
	STA.b $1F
	LDA.w #CODE_bg_floor_random-$01
	STA.b $25
	LDA.b $15
	DEC
	DEC
	DEC
	DEC
	ASL
	TAX
	LDA.w DATA_129322,x
	STA.b $19
	LDA.w DATA_12932E,x
	STA.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

DATA_129322:
DATA_slope45_widths:                                     ; Width-per-orientation table (6 entries) for CODE_init_floor_slope_45deg: paired widths $0003/$0003 (45deg up+down), $0004/$0004, $0005/$0005 (the two steeper 67.5-deg variants).
	dw $0003,$0003,$0004,$0004,$0005,$0005

DATA_12932E:
DATA_slope45_directions:                                     ; Direction-sign table (6 entries) for CODE_init_floor_slope_45deg paired with DATA_129322: 3 pairs of negative/positive step sizes -- $FFFF/$0001 (-1/+1), $FFFF/$0001 (-1/+1), $FFFE/$0002 (-2/+2) -- covering the 6 orientation flags.
	dw $FFFF,$0001,$FFFF,$0001,$FFFE,$0002

CODE_12933A:
CODE_floor_row_shift_up:                                     ; Shared helper used by floor-row family init handlers (CODE_init_floor_slope_22deg and _45deg). Decrements $1B's high-row nibble by $10 (shifts the object's origin up by one tile-row) while preserving the column nibble, then increments extent $2E. Used so floors stamp from "one tile above the placed origin" upward.
	LDA.b $1B
	PHA
	AND.w #$0F0F
	STA.b $00
	PLA
	AND.w #$F0F0
	SEC
	SBC.w #$0010
	AND.w #$F0F0
	ORA.b $00
	STA.b $1B
	INC.b $2E
	RTS

CODE_129354:
CODE_init_post_vertical:                                     ; Objects $0C/$0E/$0F (vertical post / stake): trampoline-walker init pointing at CODE_post_vertical_3section. No state setup beyond the 16-bit accumulator switch  extent comes from the object stream's size bytes.
	REP.b #$20
	LDX.b #(CODE_post_vertical_3section-$01)>>16
	LDA.w #CODE_post_vertical_3section-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12935E:
CODE_init_post_horizontal:                                     ; Object $0D (horizontal bouncing-post / trampoline bar): trampoline-walker init pointing at CODE_post_horizontal_3section.
	REP.b #$20
	LDX.b #(CODE_post_horizontal_3section-$01)>>16
	LDA.w #CODE_post_horizontal_3section-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129368:
CODE_init_lift_track_30deg:                                     ; Object $10 (30-deg moving-platform rail): keep-slope walker init pointing at CODE_lift_track_30deg. Forces 2-tile extent ($2E=2) and negative slope step ($17=$FFFF).
	REP.b #$20
	LDA.w #$0002
	STA.b $2E
	LDA.w #$FFFF
	STA.b $17
	LDX.b #(CODE_lift_track_30deg-$01)>>16
	LDA.w #CODE_lift_track_30deg-$01
	JMP.w CODE_walker_setup_keep_slope

CODE_12937C:
CODE_init_lift_track_45deg:                                     ; Object $11 / $12 diagonal moving-platform rail init (shared routine; despite the "45deg" label it handles TWO different steepnesses, both descending left-to-right). Keep-slope walker init pointing at CODE_lift_track_45deg. $15 (the object ID) bit 1 picks the variant from DATA_129396/DATA_12939A: =0 ($11) -> extent=2 / step=$FFFF = 1:1 slope (45 deg); =1 ($12) -> extent=3 / step=$FFFE = 2:1 slope (~63 deg, NOT 45).
	REP.b #$20
	LDA.b $15
	AND.w #$0002
	TAX
	LDA.w DATA_129396,x
	STA.b $2E
	LDA.w DATA_12939A,x
	STA.b $17
	LDX.b #(CODE_lift_track_45deg-$01)>>16
	LDA.w #CODE_lift_track_45deg-$01
	JMP.w CODE_walker_setup_keep_slope

DATA_129396:
DATA_lift_track_45deg_extents:                                     ; Extent table (2 entries: $0002, $0003) for CODE_init_lift_track_45deg orientation picker.
	dw $0002,$0003

DATA_12939A:
DATA_lift_track_45deg_steps:                                     ; Slope-step table (2 entries: $FFFF, $FFFE) paired with DATA_129396 for CODE_init_lift_track_45deg.
	dw $FFFF,$FFFE

CODE_12939E:
CODE_init_lift_track_static:                                     ; Object $13 (static horizontal lift rail): trampoline-walker init pointing at CODE_lift_track_static.
	REP.b #$20
	LDX.b #(CODE_lift_track_static-$01)>>16
	LDA.w #CODE_lift_track_static-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1293A8:
CODE_init_tunnel:                                     ; Object $14 (tunnel / cave-mouth): trampoline-walker init pointing at CODE_tunnel_dispatch. The stamp side handles all tunnel sub-shape selection by probing neighbours.
	REP.b #$20
	LDX.b #(CODE_tunnel_dispatch-$01)>>16
	LDA.w #CODE_tunnel_dispatch-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1293B2:
CODE_init_cloud_block:                                     ; Object $15 (cloud platform block): trampoline-walker init pointing at CODE_cloud_block_stamp. Forces 2-row extent ($2E=2) for the standard 2-row-tall cloud-block shape.
	REP.b #$20
	LDA.w #$0002
	STA.b $2E
	LDX.b #(CODE_cloud_block_stamp-$01)>>16
	LDA.w #CODE_cloud_block_stamp-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1293C1:
CODE_init_water_open:                                     ; Object $16 (open water): trampoline-walker init pointing at CODE_water_open. Stamper only writes the open-water tile into empty cells, so it doesn't overwrite pre-existing land.
	REP.b #$20
	LDX.b #(CODE_water_open-$01)>>16
	LDA.w #CODE_water_open-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1293CB:
CODE_init_water_meets_ground:                                     ; Object $17 (water meets ground): trampoline-walker init pointing at CODE_water_meets_ground. Bumps the object origin's row up by one tile-row (inline of the CODE_floor_row_shift_up arithmetic) and increments extent so the waterline starts one row above the placed origin.
	REP.b #$20
	LDA.b $1B
	AND.w #$F0F0
	SEC
	SBC.w #$0010
	AND.w #$F0F0
	STA.b $00
	LDA.b $1B
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	INC.b $2E
	LDX.b #(CODE_water_meets_ground-$01)>>16
	LDA.w #CODE_water_meets_ground-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1293EE:
CODE_init_water_meets_land_or_rock:                                     ; Object $18/$19 (water meets land / water on rock): trampoline-walker init. Orientation $15 bit 0 selects between CODE_water_meets_land (object $18) and CODE_water_on_rock (object $19) via DATA_129401/DATA_129403.
	REP.b #$20
	LDA.b $15
	AND.w #$0001
	TAY
	ASL
	TAX
	LDA.w DATA_129403,x
	LDX.w DATA_129401,y
	JMP.w CODE_walker_setup_trampoline

DATA_129401:
DATA_water_land_rock_stamp_banks:                                     ; Bank-byte table (2 entries) for CODE_init_water_meets_land_or_rock: CODE_water_meets_land bank, CODE_water_on_rock bank.
	db (CODE_water_meets_land-$01)>>16,(CODE_water_on_rock-$01)>>16

DATA_129403:
DATA_water_land_rock_stamp_ptrs:                                     ; Low-word table (2 entries) paired with DATA_129401: CODE_water_meets_land, CODE_water_on_rock.
	dw CODE_water_meets_land-$01,CODE_water_on_rock-$01

CODE_129407:
CODE_init_water_bridge:                                     ; Object $1A/$1B (water bridge horizontal / vertical): trampoline-walker init. Orientation $15 bit 0 selects between CODE_water_bridge_horizontal and CODE_water_bridge_vertical via DATA_12941A/DATA_12941C.
	REP.b #$20
	LDA.b $15
	AND.w #$0001
	TAY
	ASL
	TAX
	LDA.w DATA_12941C,x
	LDX.w DATA_12941A,y
	JMP.w CODE_walker_setup_trampoline

DATA_12941A:
DATA_water_bridge_stamp_banks:                                     ; Bank-byte table (2 entries) for CODE_init_water_bridge: horizontal-bridge bank, vertical-bridge bank.
	db (CODE_water_bridge_horizontal-$01)>>16,(CODE_water_bridge_vertical-$01)>>16

DATA_12941C:
DATA_water_bridge_stamp_ptrs:                                     ; Low-word table (2 entries) paired with DATA_12941A: CODE_water_bridge_horizontal, CODE_water_bridge_vertical.
	dw CODE_water_bridge_horizontal-$01,CODE_water_bridge_vertical-$01

CODE_129420:
CODE_init_water_lift:                                     ; Object $1C (under-water moving platform): trampoline-walker init pointing at CODE_water_lift_stamp. Forces 2-tile column extent ($2A=2) for the standard 2-tile-wide bobbing-platform shape.
	REP.b #$20
	LDA.w #$0002
	STA.b $2A
	LDX.b #(CODE_water_lift_stamp-$01)>>16
	LDA.w #CODE_water_lift_stamp-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12942F:
CODE_init_water_decor:                                     ; Object $1D/$1E (underwater mushroom / flower decoration): trampoline-walker init pointing at CODE_water_decor_mushroom_flower. Two identical pointer entries in DATA_129442/DATA_129444  the stamp body itself does the orientation->tile-id pick.
	REP.b #$20
	LDA.b $15
	AND.w #$0001
	TAY
	ASL
	TAX
	LDA.w DATA_129444,x
	LDX.w DATA_129442,y
	JMP.w CODE_walker_setup_trampoline

DATA_129442:
DATA_water_decor_stamp_banks:                                     ; Bank-byte table (2 entries, both pointing at CODE_water_decor_mushroom_flower bank) for CODE_init_water_decor.
	db (CODE_water_decor_mushroom_flower-$01)>>16,(CODE_water_decor_mushroom_flower-$01)>>16

DATA_129444:
DATA_water_decor_stamp_ptrs:                                     ; Low-word table (2 entries, both pointing at CODE_water_decor_mushroom_flower) paired with DATA_129442.
	dw CODE_water_decor_mushroom_flower-$01,CODE_water_decor_mushroom_flower-$01

CODE_129448:
CODE_init_lava_or_stone_3d:                                     ; Combined init for object $1F (Wavy lava -> CODE_lava_stamp) and object $20 (3D stone -> CODE_stone_3d_stamp). Index x = ($15 & $01) = object-id & 1, so $20 (even) selects table entry 0 and $1F (odd) selects entry 1. Builds a parity bit from $1B's two nibbles into $A1, optionally writes a 4-byte effect-block entry into $7F:7472+ (held-effect descriptor for the lava-bubble / stone animation), then dispatches via DATA_lava_or_stone_3d_stamp_banks/DC/DE/E2/E6 to the selected stamp handler with per-variant extent.
	LDA.b $15
	AND.b #$01
	TAX
	LDA.w DATA_lava_or_stone_3d_stamp_banks,x
	STA.b $24
	STA.b $21
	LDA.w DATA_lava_or_stone_3d_subhandler_banks,x
	STA.b $27
	REP.b #$30
	LDA.b $1B
	LSR
	LSR
	LSR
	LSR
	EOR.b $1B
	AND.w #$0001
	STA.b $A1
	LDA.b $15
	AND.w #$0002
	TAX
	BEQ.b CODE_1294BD
	SEP.b #$20
	LDA.b $1B
	PHA
	LSR
	LSR
	LSR
	LSR
	STA.b $02
	PLA
	AND.b #$0F
	STA.b $00
	LDA.b $1C
	PHA
	AND.b #$F0
	ORA.b $02
	STA.b $02
	PLA
	ASL
	ASL
	ASL
	ASL
	ORA.b $00
	STA.b $00
	LDY.w #$0000
CODE_129495:
	LDA.w $7F74,y
	BEQ.b CODE_1294A3
	INY
	INY
	INY
	INY
	CPY.w #$0050
	BCC.b CODE_129495
CODE_1294A3:
	LDA.b $00
	STA.w $7F72,y
	LDA.b $02
	DEC
	DEC
	STA.w $7F73,y
	LDA.b $2A
	DEC
	STA.w $7F74,y
	LDA.b $2E
	DEC
	STA.w $7F75,y
	REP.b #$20
CODE_1294BD:
	STZ.b $15
	LDA.w DATA_lava_or_stone_3d_stamp_ptrs,x
	DEC
	STA.b $22
	STA.b $1F
	LDA.w DATA_lava_or_stone_3d_subhandler_ptrs,x
	DEC
	STA.b $25
	LDA.w DATA_lava_or_stone_3d_extents,x
	STA.b $19
	STZ.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

DATA_1294DA:
DATA_lava_or_stone_3d_stamp_banks:                                     ; Bank-byte pair for CODE_init_lava_or_stone_3d: entry 0 = CODE_stone_3d_stamp bank ($13) for object $20 (even id), entry 1 = CODE_lava_stamp bank for object $1F (odd id).
	db CODE_stone_3d_stamp>>16,CODE_lava_stamp>>16

DATA_1294DC:
DATA_lava_or_stone_3d_subhandler_banks:                                     ; Bank-byte pair for the secondary stamp slot in CODE_init_lava_or_stone_3d: entry 0 = CODE_stone_3d_stamp bank (object $20), entry 1 = CODE_lava_shared_segment bank (lava-mid, object $1F).
	db CODE_stone_3d_stamp>>16,CODE_lava_shared_segment>>16

DATA_1294DE:
DATA_lava_or_stone_3d_stamp_ptrs:                                     ; Low-word pair for CODE_init_lava_or_stone_3d primary stamp: entry 0 = CODE_stone_3d_stamp (object $20), entry 1 = CODE_lava_stamp (object $1F).
	dw CODE_stone_3d_stamp,CODE_lava_stamp

DATA_1294E2:
DATA_lava_or_stone_3d_subhandler_ptrs:                                     ; Low-word pair for CODE_init_lava_or_stone_3d secondary stamp: entry 0 = CODE_stone_3d_stamp (object $20), entry 1 = CODE_lava_shared_segment (object $1F).
	dw CODE_stone_3d_stamp,CODE_lava_shared_segment

DATA_1294E6:
DATA_lava_or_stone_3d_extents:                                     ; Walker extents for CODE_init_lava_or_stone_3d: entry 0 = $0002 (object $20, 3D stone), entry 1 = $0005 (object $1F, lava).
	dw $0002,$0005

CODE_1294EA:
CODE_init_jungle_floor:                                     ; Object $21 (World 1 jungle floor): trampoline-walker init pointing at CODE_jungle_floor. Zeros $A1 (random-seed-byte slot) before dispatch.
	REP.b #$20
	STZ.b $A1
	LDX.b #(CODE_jungle_floor-$01)>>16
	LDA.w #CODE_jungle_floor-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1294F6:
CODE_init_jungle_left_wall:                                     ; Object $22 (World 1 jungle left edge wall): trampoline-walker init pointing at CODE_jungle_left_wall. Increments $2A (column extent) by 1 for the standard 1-extra-column-wide wall shape.
	REP.b #$20
	INC.b $2A
	LDX.b #(CODE_jungle_left_wall-$01)>>16
	LDA.w #CODE_jungle_left_wall-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129502:
CODE_init_jungle_right_wall:                                     ; Init for object $23 (jungle right-edge wall). Bumps $2A to bias walker into vertical-down traversal, then sets up CODE_jungle_right_wall as the stamp.
	REP.b #$20
	INC.b $2A
	LDX.b #(CODE_jungle_right_wall-$01)>>16
	LDA.w #CODE_jungle_right_wall-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12950E:
CODE_init_jungle_mud_floor:                                     ; Init for object $24 (jungle mud floor). Plain walker setup pointing at CODE_jungle_mud_floor; no orientation or random parameter writes.
	REP.b #$20
	LDX.b #(CODE_jungle_mud_floor-$01)>>16
	LDA.w #CODE_jungle_mud_floor-$01
	JMP.w CODE_walker_setup_trampoline

DATA_129518:
	dw CODE_jungle_mud_wall_left_right-$01,CODE_jungle_mud_wall_left_right-$01

CODE_12951C:
CODE_init_jungle_mud_wall_lr:                                     ; Init for objects $25/$26 (jungle mud wall, L/R variants). Masks bit 1 of $15 to select side, stores back, then dispatches to CODE_jungle_mud_wall_left_right via DATA_129518.
	REP.b #$20
	LDA.b $15
	AND.w #$0002
	TAY
	STA.b $15
	LDX.b #(CODE_jungle_mud_wall_left_right-$01)>>16
	LDA.w DATA_129518,y
	JMP.w CODE_walker_setup_trampoline

DATA_12952E:
	dw CODE_jungle_slope_left_down-$01,CODE_jungle_slope_right_down-$01

CODE_129532:
CODE_init_jungle_slope_45deg:                                     ; Init for objects $27/$28 (jungle 45-deg diagonal floor, LDRU vs LURD). Bit 3 of $15 picks direction via DATA_12952E; presets $17=$FFFF; uses CODE_walker_setup_keep_slope.
	REP.b #$20
	LDA.b $15
	AND.w #$0008
	LSR
	LSR
	TAY
	STA.b $15
	LDA.w #$FFFF
	STA.b $17
	LDX.b #(CODE_jungle_slope_left_down-$01)>>16
	LDA.w DATA_12952E,y
	JMP.w CODE_walker_setup_keep_slope

DATA_12954B:
	dw CODE_jungle_treetop_canopy-$01,CODE_jungle_treetop_canopy-$01

CODE_12954F:
CODE_init_jungle_treetop_canopy:                                     ; Init for objects $29/$2A (left/right half of a large jungle treetop canopy -- leafy foliage with hanging vines). Bit 1 of $15 selects the half; origin shifted up, $A1=0, $17=$0002 (canopy built as an ascending tile run, hence the old "steps up" misnomer -- it is not a staircase visual). Dispatches to CODE_jungle_treetop_canopy via DATA_12954B (single handler, half selected via $15).
	REP.b #$20
	LDA.b $15
	AND.w #$0002
	TAY
	ASL
	STA.b $15
	STZ.b $A1
	LDA.w #$0002
	STA.b $17
	LDX.b #(CODE_jungle_treetop_canopy-$01)>>16
	LDA.w DATA_12954B,y
	JMP.w CODE_walker_setup_keep_slope

CODE_129569:
CODE_init_jungle_stake:                                     ; Init for object $2B (jungle vertical stake/post). Plain walker setup pointing at CODE_jungle_stake; the stamp consumes caller-provided tile bases from WRAM $1DCE / $1DD4.
	REP.b #$20
	LDX.b #(CODE_jungle_stake-$01)>>16
	LDA.w #CODE_jungle_stake-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129573:
CODE_init_jungle_stone:                                     ; Init for object $2C (jungle stone block). Bumps $2A (forces vertical-first walker traversal) then sets up CODE_jungle_stone.
	REP.b #$20
	INC.b $2A
	LDX.b #(CODE_jungle_stone-$01)>>16
	LDA.w #CODE_jungle_stone-$01
	JMP.w CODE_walker_setup_trampoline

DATA_12957F:
	dw CODE_jungle_vine_thin-$01,CODE_jungle_vine_thin_plus_extras-$01

CODE_129583:
CODE_init_jungle_vine_thin:                                     ; Init for objects $2D/$2E (thin jungle vine). PRNG bit 1 seeds $A1, bit 1 of $15 picks side, then dispatches to CODE_jungle_vine_thin or CODE_jungle_vine_thin_plus_extras via DATA_12957F.
	REP.b #$20
	JSL.l CODE_prng
	AND.w #$0002
	STA.b $A1
	LDA.b $15
	AND.w #$0002
	TAY
	LDX.b #(CODE_jungle_vine_thin-$01)>>16
	LDA.w DATA_12957F,y
	JMP.w CODE_walker_setup_trampoline

CODE_12959C:
CODE_init_jungle_wood:                                     ; Init for object $2F (jungle wooden-log horizontal beam). Plain walker setup pointing at CODE_jungle_wood; no special orientation or state writes.
	REP.b #$20
	LDX.b #(CODE_jungle_wood-$01)>>16
	LDA.w #CODE_jungle_wood-$01
	JMP.w CODE_walker_setup_trampoline

DATA_1295A6:
	dw CODE_jungle_tree_trunk_with_branches-$01,CODE_jungle_tree_trunk_with_leaves-$01

CODE_1295AA:
CODE_init_jungle_tree_trunk:                                     ; Init for objects $30/$31 (jungle tree trunk, plain vs leaves). PRNG bit 1 seeds $A1 (=$0B for leaf bias); bit 0 of $15 picks branches vs leaves variant via DATA_1295A6.
	REP.b #$20
	STZ.b $A1
	JSL.l CODE_prng
	AND.w #$0002
	BEQ.b CODE_1295BC
	LDA.w #$000B
	STA.b $A1
CODE_1295BC:
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDX.b #(CODE_jungle_tree_trunk_with_branches-$01)>>16
	LDA.w DATA_1295A6,y
	JMP.w CODE_walker_setup_trampoline

DATA_1295CB:
	dw CODE_jungle_block_pattern_a-$01,CODE_jungle_block_pattern_b-$01

CODE_1295CF:
CODE_init_jungle_block_pattern:                                     ; Init for objects $32/$33 (jungle patterned-block, two variants). Bit 0 of $15 picks variant A vs B via DATA_1295CB; no other state writes.
	REP.b #$20
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDX.b #(CODE_jungle_block_pattern_a-$01)>>16
	LDA.w DATA_1295CB,y
	JMP.w CODE_walker_setup_trampoline

CODE_1295E0:
CODE_init_jungle_cattail:                                     ; Init for object $34 (jungle thick decorative vine). Bumps $2E (extent grows), zeroes $A1, then dispatches to CODE_jungle_cattail_random.
	REP.b #$20
	INC.b $2E
	STZ.b $A1
	LDX.b #(CODE_jungle_cattail_random-$01)>>16
	LDA.w #CODE_jungle_cattail_random-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1295EE:
CODE_init_jungle_water:                                     ; Init for object $35 (jungle-tinted water surface). Zeroes $15 (orientation), then dispatches to CODE_jungle_water.
	REP.b #$20
	STZ.b $15
	LDX.b #(CODE_jungle_water-$01)>>16
	LDA.w #CODE_jungle_water-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1295FA:
CODE_init_jungle_tree_leaves_only:                                     ; Init for object $36 (jungle tree variant -- only the leafy crown). Sets $A1=$000B (leaf bias high) then dispatches directly to CODE_jungle_tree_trunk_with_leaves; bypasses trunk-only path.
	REP.b #$20
	LDA.w #$000B
	STA.b $A1
	LDX.b #(CODE_jungle_tree_trunk_with_leaves-$01)>>16
	LDA.w #CODE_jungle_tree_trunk_with_leaves-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129609:
CODE_init_red_platform_tile:                                     ; Init for object $37 (red platform; static tile, red-stairs visual style). Plain walker setup pointing at CODE_stamp_red_platform_tile.
	REP.b #$20
	LDX.b #(CODE_stamp_red_platform_tile-$01)>>16
	LDA.w #CODE_stamp_red_platform_tile-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129613:
CODE_init_stone_large:                                     ; Init for object $38 (large lava rock). Rolls PRNG bit 1 into $15 (picks one of 2 mirror variants), then dispatches to CODE_stamp_stone_large.
	REP.b #$20
	JSL.l CODE_prng
	AND.w #$0002
	STA.b $15
	LDX.b #(CODE_stamp_stone_large-$01)>>16
	LDA.w #CODE_stamp_stone_large-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129626:
CODE_init_red_stone:                                     ; Init for object $39 (small lava rock structure). Rounds $2A and $2E up to even (INC + AND $FFFE -- forces 2x2 footprint), then dispatches to CODE_stamp_red_stone.
	REP.b #$20
	LDA.b $2A
	INC
	AND.w #$FFFE
	STA.b $2A
	LDA.b $2E
	INC
	AND.w #$FFFE
	STA.b $2E
	LDX.b #(CODE_stamp_red_stone-$01)>>16
	LDA.w #CODE_stamp_red_stone-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129640:
CODE_init_grass_slope_up_60deg_hole:                                     ; Init for object $3A (grass-floor 60-deg upward slope with hole). Plain walker setup pointing at CODE_grass_slope_up_60deg_hole; uses CODE_walker_setup_keep_slope.
	REP.b #$20
	LDX.b #(CODE_grass_slope_up_60deg_hole-$01)>>16
	LDA.w #CODE_grass_slope_up_60deg_hole-$01
	JMP.w CODE_walker_setup_keep_slope

CODE_12964A:
CODE_init_grass_slope_down_60deg_hole:                                     ; Init for object $3B. Computes $2E = $2E - 2*$2A (clamped >= 1) to set up downward-stepping geometry; uses CODE_walker_setup_keep_slope.
	REP.b #$20
	LDA.b $2A
	ASL
	STA.b $00
	LDA.b $2E
	SEC
	SBC.b $00
	BEQ.b CODE_12965A
	BPL.b CODE_12965D
CODE_12965A:
	LDA.w #$0001
CODE_12965D:
	STA.b $2E
	LDX.b #(CODE_grass_slope_down_60deg_hole-$01)>>16
	LDA.w #CODE_grass_slope_down_60deg_hole-$01
	JMP.w CODE_walker_setup_keep_slope

CODE_129667:
CODE_init_pipe_vertical:                                     ; Init for objects $3C/$F4 (vertical pipe). Masks $15 to bit 7 (orientation), sets $2A=$0002 (forces 2-column footprint), dispatches to CODE_pipe_vertical_dispatch.
	REP.b #$20
	LDA.b $15
	AND.w #$0080
	STA.b $15
	LDA.w #$0002
	STA.b $2A
	LDX.b #(CODE_pipe_vertical_dispatch-$01)>>16
	LDA.w #CODE_pipe_vertical_dispatch-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12967D:
CODE_init_snow_cloud_block:                                     ; Init for object $3D (snow-cloud platform/block). Sets $2E=$0003 (forces 3-row-tall footprint), then dispatches to CODE_snow_cloud_block.
	REP.b #$20
	LDA.w #$0003
	STA.b $2E
	LDX.b #(CODE_snow_cloud_block-$01)>>16
	LDA.w #CODE_snow_cloud_block-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12968C:
CODE_init_ski_lift_two_pole:                                     ; Object $3E init: trampoline-walker init pointing at CODE_13A0E4. Single-cell stamper that swaps the underlying tile to $00A7/$00B3/$00B4 based on the under-tile and row position.
	REP.b #$20
	LDX.b #(CODE_13A0E4-$01)>>16
	LDA.w #CODE_13A0E4-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129696:
CODE_init_spike_pillar:                                     ; Objects $3F/$40 (lava-spike column) init: trampoline-walker init pointing at CODE_stamp_spike_pillar. Two object IDs let level streams place either single or stacked lava-needle columns.
	REP.b #$20
	LDX.b #(CODE_stamp_spike_pillar-$01)>>16
	LDA.w #CODE_stamp_spike_pillar-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1296A0:
CODE_init_wall_h_block:                                     ; Object $41 (horizontal wall block) init: trampoline-walker init pointing at CODE_wall_h_block. Stamps a horizontal-edge wall block with auto-connecting shadow/edge tiles on adjacent cells.
	REP.b #$20
	LDX.b #(CODE_wall_h_block-$01)>>16
	LDA.w #CODE_wall_h_block-$01
	JMP.w CODE_walker_setup_trampoline

DATA_1296AA:
DATA_castle_pillar_handlers:                                     ; 2-entry stamp-pointer table (CODE_13A372, CODE_13A3AF) used by CODE_init_castle_pillar to pick a diagonal-wall stamp by orientation $15 bit 0.
	dw CODE_13A372-$01,CODE_13A3AF-$01

CODE_1296AE:
CODE_init_castle_pillar:                                     ; Objects $42/$43 (diagonal wall block, 2 orientations) init: indexes DATA_1296AA by orientation bit 0 of $15 to pick CODE_13A372 (up-rise) or CODE_13A3AF (down-fall), then invokes the walker.
	REP.b #$20
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDX.b #(CODE_13A372-$01)>>16
	LDA.w DATA_1296AA,y
	JMP.w CODE_walker_setup_trampoline

CODE_1296BF:
CODE_init_castle_wall:                                     ; Object $44 (wall corner block) init: trampoline-walker init pointing at CODE_13A412, with autotile-state $A1=0. Stamps a corner-piece wall using shape probes of neighbouring cells.
	REP.b #$20
	STZ.b $A1
	LDX.b #(CODE_13A412-$01)>>16
	LDA.w #CODE_13A412-$01
	JMP.w CODE_walker_setup_trampoline

CODE_1296CB:
CODE_init_castle_wall_diag_end:                                     ; Objects $45/$46 (wall pillar with diagonals, 2 mirror variants) init: 2-column walker  primary stamp CODE_13A553, secondary CODE_13A412, width 2, row origin up by 1, +/-1 column step from DATA_129712.
	LDA.b #(CODE_13A553-$01)>>16
	STA.b $24
	STA.b $21
	LDA.b #(CODE_13A412-$01)>>16
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13A553-$01
	STA.b $22
	STA.b $1F
	LDA.w #CODE_13A412-$01
	STA.b $25
	LDA.w #$0002
	STA.b $19
	LDA.b $15
	AND.w #$0002
	TAX
	LDA.w DATA_129712,x
	STA.b $17
	LDA.b $1B
	PHA
	AND.w #$F0F0
	SEC
	SBC.w #$0010
	AND.w #$F0F0
	STA.b $00
	PLA
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	INC.b $2E
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

DATA_129712:
DATA_castle_wall_diag_end_step_signs:                                     ; 2-entry step-sign table ($FFFF / $0001) for CODE_init_castle_wall_diag_end: selects mirror direction (left-leaning vs right-leaning) for the diagonal sides.
	dw $FFFF,$0001

CODE_129716:
CODE_init_lava_castle:                                     ; Object $47 (random-fill wall block) init: trampoline-walker init pointing at CODE_stamp_lava_castle. Stamper picks tiles from an 8-entry PRNG pool when the above-tile isn't a continuation, with neighbour autotile passes.
	REP.b #$20
	LDX.b #(CODE_stamp_lava_castle-$01)>>16
	LDA.w #CODE_stamp_lava_castle-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129720:
CODE_init_brick:                                     ; Object $48 (thick wall block variant A) init: full walker setup with column stamp CODE_13A753 (top-edge handler) and per-row handler CODE_13A811 (body), running until $2C/$2E or $28/$2A bounds out.
	LDA.b #(CODE_13A753-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13A753-$01
	STA.b $22
	LDA.w #CODE_13A811-$01
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	STZ.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_129743:
CODE_init_wall_block_thick_b:                                     ; Objects $49/$4A (thick wall block, two flavours) init: full walker setup with stamp CODE_13A90D and width $2A=2. Two object IDs cover slightly different wall variants sharing the same stamp logic.
	LDA.b #(CODE_13A90D-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13A90D-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	STZ.b $17
	LDA.w #$0002
	STA.b $2A
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_129768:
CODE_init_wall_column_variable:                                     ; Objects $4B/$4C/$4D (3-skin wall column, widths 4/6/8 tiles) init: full walker setup with stamp CODE_13A94B. Reads $15 bits 0-2, decrements 3x to derive index, then DATA_129797 picks column width.
	LDA.b #(CODE_13A94B-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13A94B-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	STZ.b $17
	LDA.b $15
	AND.w #$0007
	DEC
	DEC
	DEC
	ASL
	TAX
	LDA.w DATA_129797,x
	STA.b $2A
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

DATA_129797:
DATA_wall_column_widths:                                     ; 3-entry column-width table for CODE_init_wall_column_variable: $0004 (narrow), $0006 (medium), $0008 (wide). Indexed by orientation $15 bits 0-2 minus 3.
	dw $0004,$0006,$0008

CODE_12979D:
CODE_init_bg_autotile_block:                                     ; Object $4E (BG ground-block, full neighbour-aware autotile) init: full walker setup with stamp CODE_13A9F6. Drives the general-purpose ground/floor structural object used widely across levels.
	LDA.b #(CODE_13A9F6-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13A9F6-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	STZ.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_1297BD:
CODE_init_bg_autotile_decor_lookup:                                     ; Object $4F (decorative tile-pack with 188-entry lookup) init: full walker setup with stamp CODE_13B13F. Drives a 4-direction neighbour probe + self-replacement against the curated decoration LUT.
	LDA.b #(CODE_13B13F-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13B13F-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	STZ.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_1297DD:
CODE_init_graffiti_rail:                                     ; Objects $50/$51 (decorative pillar / banded stripe) init: full walker setup with stamp CODE_13B924. Pillar stamper picks tile out of a 2-entry table with overrides for special-zone tiles.
	LDA.b #(CODE_13B924-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13B924-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	STZ.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_1297FD:
CODE_init_graffiti_rail_diagonal:                                     ; Object $52 (overhang / ledge-meets-cliff decoration) init: full walker setup with stamp CODE_13B95C and $17=$FFFF (left-stepping per-row slope, for the overhang shape).
	LDA.b #(CODE_13B95C-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13B95C-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	LDA.w #$FFFF
	STA.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_129820:
CODE_init_castle_wall_platform:                                     ; Object $53 (arch / structural block with broad neighbour-class lookup) init: trampoline-walker init pointing at CODE_13B98D. Sets up the autotile-arch stamp pattern in a single rectangle.
	REP.b #$20
	LDX.b #(CODE_13B98D-$01)>>16
	LDA.w #CODE_13B98D-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12982A:
CODE_init_castle_wall_platform_slope:                                     ; Objects $54/$55/$56 (3 arch-corner variants) init: full walker setup with stamp CODE_13BA20. Picks per-row slope $17 from DATA_129854 ($FFFF/$FFFF/$FFFE) per orientation $15 bits 0-1.
	LDA.b #(CODE_13BA20-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13BA20-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	LDA.b $15
	AND.w #$0003
	ASL
	TAX
	LDA.w DATA_129854,x
	STA.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

DATA_129854:
DATA_castle_wall_platform_slope_steps:                                     ; 3-entry per-row slope-step table for CODE_init_castle_wall_platform_slope: $FFFF, $FFFF, $FFFE  1 or 2 column-units of leftward step per row.
	dw $FFFF,$FFFF,$FFFE

CODE_12985A:
CODE_init_seven_segment_decor:                                     ; Objects $57/$7E (7-segment decorative band) init: full walker setup with stamp CODE_13BB45. Single config object appearing for two non-adjacent IDs ($57 and $7E both route here via DATA_standard_object_init_ptrs).
	LDA.b #(CODE_13BB45-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13BB45-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	STZ.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_12987A:
CODE_init_thick_post_overlay:                                     ; Object $58 (thick post with overlay-state autotile) init: full walker setup with stamp CODE_13BBA6 and $A1=0 (resets autotile-overlay state at object start).
	LDA.b #(CODE_13BBA6-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13BBA6-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	STZ.b $17
	STZ.b $A1
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_12989C:
CODE_init_tunnel_floor_slope_right:                                     ; Objects $59/$5A/$5B (floor-slope decor, 3 variants) init: full walker setup picking stamp from DATA_1298E9 by $15 bits 0-1 and slope $17 from DATA_1298EF ($FFFF/$FFFF/$FFFE). Shifts row origin up by 1.
	LDA.b #(CODE_13BD80-$00)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.b $15
	AND.w #$0003
	DEC
	ASL
	TAX
	LDA.w DATA_1298E9,x
	DEC
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	LDA.w DATA_1298EF,x
	STA.b $17
	INC.b $2E
	INC.b $2A
	INC.b $2A
	LDA.b $1B
	PHA
	AND.w #$F0F0
	SEC
	SBC.w #$0010
	AND.w #$F0F0
	STA.b $00
	PLA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

DATA_1298E9:						; Note: These ones aren't decremented because the code that reads this table does it automatically.
DATA_tunnel_floor_slope_variant_stamps:                                     ; 3-entry stamp-handler table for CODE_init_tunnel_floor_slope_right: CODE_13BD80, CODE_13BE07, CODE_13BE78. Reused by CODE_init_tunnel_floor_slope_left at $1298F5.
	dw CODE_13BD80-$00,CODE_13BE07-$00,CODE_13BE78-$00

DATA_1298EF:
DATA_tunnel_floor_slope_right_steps:                                     ; 3-entry per-row slope step table for CODE_init_tunnel_floor_slope_right: $FFFF, $FFFF, $FFFE (1 or 2 column-units per row).
	dw $FFFF,$FFFF,$FFFE

CODE_1298F5:
CODE_init_tunnel_floor_slope_left:                                     ; Objects $5C/$5D/$5E (parallel 3-variant slope family) init: full walker setup picking from same DATA_1298E9 stamp pointers but using DATA_129938 ($0001,$0001,$0002) for $17 (positive step).
	LDA.b #(CODE_13BD80-$00)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.b $15
	AND.w #$0003
	ASL
	TAX
	LDA.w DATA_1298E9,x
	DEC
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	LDA.w DATA_129938,x
	STA.b $17
	INC.b $2A
	INC.b $2A
	LDA.b $1B
	PHA
	AND.w #$F0F0
	STA.b $00
	PLA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

DATA_129938:
DATA_tunnel_floor_slope_left_steps:                                     ; 3-entry positive per-row column-step table for CODE_init_tunnel_floor_slope_left: $0001, $0001, $0002  slope rises rather than falls compared to the $59/$5A/$5B variants.
	dw $0001,$0001,$0002

CODE_12993E:
CODE_init_tunnel_ceiling_slope_right:                                     ; Object $5F/$60 (wide-base slope floor) init: full walker setup with stamp CODE_13BEF5. Computes $2E (row count) from $15 bits 0-3 halved if set; clamps against $2E. Increments $2A/$2E by 2; clears $A1.
	LDA.b #(CODE_13BEF5-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13BEF5-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	STZ.b $17
	LDA.b $2A
	STA.b $00
	LDA.b $15
	AND.w #$000F
	BEQ.b CODE_129965
	LSR.b $00
CODE_129965:
	LDA.b $00
	CMP.b $2E
	BMI.b CODE_12996D
	STA.b $2E
CODE_12996D:
	INC.b $2A
	INC.b $2A
	INC.b $2E
	LDA.b $1B
	PHA
	AND.w #$F0F0
	STA.b $00
	PLA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	STZ.b $A1
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_12998F:
CODE_init_tunnel_ceiling_slope_left:                                     ; Object $61/$62 init: large floor-block extender. Locks the per-cell stamp at CODE_tunnel_ceiling_slope_left (CODE_13C03B), picks extents from $15 bit 1 + $2A/$2E, shifts row origin up, invokes the walker.
	LDA.b #(CODE_13C03B-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13C03B-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	STZ.b $17
	LDA.b $15
	AND.w #$0002
	TAX
	BEQ.b CODE_1299C0
	LDA.b $2A
	ORA.b $2E
	CMP.w #$0001
	BNE.b CODE_1299C0
	INC.b $2A
	INC.b $2A
	BRA.b CODE_1299E6

CODE_1299C0:
	INC.b $2A
	INC.b $2A
	LDA.b $2E
	CMP.w #$0002
	BCC.b CODE_1299E6
	INC.b $2E
	INC.b $2E
	LDA.b $2A
	STA.b $00
	TXA
	BNE.b CODE_1299DB
	LDA.b $00
	LSR
	STA.b $00
CODE_1299DB:
	LDA.b $2E
	SEC
	SBC.b $00
	STA.b $2E
	BNE.b CODE_1299E6
	STZ.b $2E
CODE_1299E6:
	LDA.b $1B
	PHA
	AND.w #$F0F0
	STA.b $00
	PLA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	STZ.b $A1
	LDA.b $2E
	BEQ.b CODE_129A02
	BPL.b CODE_129A07
CODE_129A02:
	LDA.w #$0001
	STA.b $2E
CODE_129A07:
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_129A0D:
CODE_init_three_segment_row:                                     ; Object $63-$65 init: 3-segment horizontal row (left/mid/right tile selector). Locks per-cell stamp at CODE_three_segment_row (CODE_13C273), zeros $A1, then invokes the walker with default extents.
	LDA.b #(CODE_13C273-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13C273-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	STZ.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_129A2D:
CODE_init_2x2_repeating_block:                                     ; Object $66 init: 2x2 repeating tile block (parity-checkerboard pattern). Locks the per-cell stamp at CODE_2x2_repeating_block (CODE_13C291). Stamp picks 1 of 4 tiles ($8900-$8903) from low bit of $28 + low bit of $2C.
	LDA.b #(CODE_13C291-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13C291-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	STZ.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_129A4D:
CODE_init_big_floor_or_jungle_canopy:                                     ; Object $67 init: tileset-conditional. If BG1 tileset == $0C (jungle), uses CODE_jungle_canopy_random (CODE_13C6A5). Otherwise uses CODE_big_floor_stamp (CODE_13C2AF)  base + 8 edge fix-ups.
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CMP.b #$0C
	BEQ.b CODE_129A5E
	REP.b #$20
	LDX.b #(CODE_13C2AF-$01)>>16
	LDA.w #CODE_13C2AF-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129A5E:
	REP.b #$20
	LDX.b #(CODE_13C6A5-$01)>>16
	LDA.w #CODE_13C6A5-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129A68:
CODE_init_coin_object:                                     ; Object $68 and $8A init: alternate-state ground. Locks per-cell stamp at CODE_stamp_coin, stores stamp bank in $039E. Stamp picks $6000 vs $7400 from $15 bit 1, gated by a CODE_item_memory_bit_lookup probe.
	REP.b #$20
	LDX.b #(CODE_stamp_coin-$01)>>16
	STX.w $039E
	LDA.w #CODE_stamp_coin-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129A75:
CODE_init_3x3_structural:                                     ; Object $69 init: 3-column structural block (fortress / tower). Locks per-cell stamp at CODE_3x3_structural (CODE_13C6E3), clamps column extent $2A and row extent $2E to a minimum of 4, then invokes the walker.
	REP.b #$20
	LDA.b $2A
	CMP.w #$0004
	BCS.b CODE_129A83
	LDA.w #$0004
	STA.b $2A
CODE_129A83:
	LDA.l $00002E
	CMP.w #$0004
	BCS.b CODE_129A91
	LDA.w #$0004
	STA.b $2E
CODE_129A91:
	LDX.b #(CODE_13C6E3-$01)>>16
	LDA.w #CODE_13C6E3-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129A99:
CODE_init_3wide_platform_bar:                                     ; Object $6A init: 3-wide horizontal platform bar (small lift body). Locks per-cell stamp at CODE_3wide_platform_bar (CODE_13C728)  picks one of $6400/$6401/$6402 by column  then invokes the walker.
	REP.b #$20
	LDX.b #(CODE_13C728-$01)>>16
	LDA.w #CODE_13C728-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129AA3:
CODE_init_goal_platform:                                     ; Object $6B init: wide structure with neighbour-probe edge-snap. Increments $2E, shifts column origin left by $10 (one tile), locks per-cell stamp at CODE_goal_platform (CODE_13C742).
	REP.b #$20
	INC.b $2E
	LDA.b $1B
	AND.w #$F0F0
	SEC
	SBC.w #$0010
	AND.w #$F0F0
	STA.b $00
	LDA.b $1B
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	LDX.b #(CODE_13C742-$01)>>16
	LDA.w #CODE_13C742-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129AC6:
CODE_init_gray_cement_block:                                     ; Object $6C init: single-tile trigger that chains into a follow-up routine. Locks per-cell stamp at CODE_gray_cement_block (CODE_13C7B2)  stamps $0184 then JMPs CODE_13A833  then invokes the walker.
	REP.b #$20
	LDX.b #(CODE_13C7B2-$01)>>16
	LDA.w #CODE_13C7B2-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129AD0:
CODE_init_spiky_stake:                                     ; Object $6D init: 3-section vertical pillar / column. Locks the per-cell stamp at CODE_stamp_spiky_stake  picks one of $1DD6/$1DD0/$1DD2 by row position  then invokes the object-stream walker.
	REP.b #$20
	LDX.b #(CODE_stamp_spiky_stake-$01)>>16
	LDA.w #CODE_stamp_spiky_stake-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129ADA:
CODE_init_random_decoration_8way:                                     ; Object $6E and $8B init: randomised 8-way decoration scatter. Locks per-cell stamp at CODE_random_decoration_8way (CODE_13C7E8). Stamp PRNG-picks 1 of 8 tiles $0199-$01A0, or override $7300 for the $8B variant.
	REP.b #$20
	LDX.b #(CODE_13C7E8-$01)>>16
	LDA.w #CODE_13C7E8-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129AE4:
CODE_init_twisted_tree_trunk:                                     ; Object $6F init: spike-pit hazard with bottom-floor cap. Locks per-cell stamp at CODE_stamp_twisted_tree_trunk. Stamp dispatches via DATA_13C82D to CODE_spike_pit_body or CODE_spike_pit_bottom_cap.
	REP.b #$20
	LDX.b #(CODE_stamp_twisted_tree_trunk-$01)>>16
	LDA.w #CODE_stamp_twisted_tree_trunk-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129AEE:
CODE_init_forest_plants:                                     ; Object $70 init: 2x2 ceiling-spike block (variant A). Force-even-column-anchor ($2A+=1 if odd), force $2E=2, locks per-cell stamp at CODE_stamp_forest_plants  picks from DATA_13C877 by column parity.
	REP.b #$20
	LDA.b $2A
	AND.w #$0001
	BEQ.b CODE_129AF9
	INC.b $2A
CODE_129AF9:
	LDA.w #$0002
	STA.b $2E
	LDX.b #(CODE_stamp_forest_plants-$01)>>16
	LDA.w #CODE_stamp_forest_plants-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129B06:
CODE_init_forest_flower_above:                                     ; Object $71 init: 2x2 structural block ($01xx tile range). Force-even-column-anchor, force $2E=2, locks per-cell stamp at CODE_stamp_forest_flower_above  picks from DATA_13C88C ($0141-$0144) by parity.
	REP.b #$20
	LDA.b $2A
	AND.w #$0001
	BEQ.b CODE_129B11
	INC.b $2A
CODE_129B11:
	LDA.w #$0002
	STA.b $2E
	LDX.b #(CODE_stamp_forest_flower_above-$01)>>16
	LDA.w #CODE_stamp_forest_flower_above-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129B1E:
CODE_init_forest_flower_below:                                     ; Object $72 init: 2x2 spike block (variant B). Force-even-column-anchor, force $2E=2, locks per-cell stamp at CODE_stamp_forest_flower_below  picks from DATA_13C8A1 ($3D39/$3A/$47/$48) by parity.
	REP.b #$20
	LDA.b $2A
	AND.w #$0001
	BEQ.b CODE_129B29
	INC.b $2A
CODE_129B29:
	LDA.w #$0002
	STA.b $2E
	LDX.b #(CODE_stamp_forest_flower_below-$01)>>16
	LDA.w #CODE_stamp_forest_flower_below-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129B36:
CODE_init_twisted_tree_leaves:                                     ; Object $73 init: 3x2 wide spike block. Force $2A=3, force-even-row-anchor ($2E+=1 if odd), locks per-cell stamp at CODE_stamp_twisted_tree_leaves  picks from DATA_13C8E3 by column + row-parity offset.
	REP.b #$20
	LDA.w #$0003
	STA.b $2A
	LDA.b $2E
	AND.w #$0001
	BEQ.b CODE_129B46
	INC.b $2E
CODE_129B46:
	LDX.b #(CODE_stamp_twisted_tree_leaves-$01)>>16
	LDA.w #CODE_stamp_twisted_tree_leaves-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129B4E:
CODE_init_twisted_tree_leaves_wide:                                     ; Object $74 init: 3-wide horizontal spike row. Force column extent $2A=3, locks per-cell stamp at CODE_stamp_twisted_tree_leaves_wide  picks 1 of 3 tiles from DATA_13C901 by column position.
	REP.b #$20
	LDA.w #$0003
	STA.b $2A
	LDX.b #(CODE_stamp_twisted_tree_leaves_wide-$01)>>16
	LDA.w #CODE_stamp_twisted_tree_leaves_wide-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129B5D:
CODE_init_twisted_tree_leaf_left:                                     ; Object $75 init: 2-wide spike pair (left variant). Force column extent $2A=2, locks per-cell stamp at CODE_stamp_twisted_tree_leaf_left  picks $3D53 or $3D57 by column position.
	REP.b #$20
	LDA.w #$0002
	STA.b $2A
	LDX.b #(CODE_stamp_twisted_tree_leaf_left-$01)>>16
	LDA.w #CODE_stamp_twisted_tree_leaf_left-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129B6C:
CODE_init_twisted_tree_leaf_right:                                     ; Object $76 init: 2-wide spike pair (right variant). Force column extent $2A=2, locks per-cell stamp at CODE_stamp_twisted_tree_leaf_right  picks $3D56 or $3D55 by column position.
	REP.b #$20
	LDA.w #$0002
	STA.b $2A
	LDX.b #(CODE_stamp_twisted_tree_leaf_right-$01)>>16
	LDA.w #CODE_stamp_twisted_tree_leaf_right-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129B7B:
CODE_init_twisted_tree_leaf_center:                                     ; Object $77 init: single-tile spike. Locks the per-cell stamp at CODE_stamp_twisted_tree_leaf_center  stamps constant tile $3D58  then invokes the object-stream walker with default extents.
	REP.b #$20
	LDX.b #(CODE_stamp_twisted_tree_leaf_center-$01)>>16
	LDA.w #CODE_stamp_twisted_tree_leaf_center-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129B85:
CODE_init_twisted_tree_slanted:                                     ; Object $78 init: orientation-aware 4-tile spike quad. Locks per-cell stamp at CODE_stamp_twisted_tree_slanted, forces $2E=2, sets $17=$FFFF (negative-step walker flag), then invokes the walker.
	LDA.b #(CODE_stamp_twisted_tree_slanted-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_stamp_twisted_tree_slanted-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$0002
	STA.b $2E
	LDA.w #$7FFF
	STA.b $19
	LDA.w #$FFFF
	STA.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_129BAD:
CODE_init_red_stairs:                                     ; Object $79 (horizontal pipe pair, 2-row tall): full walker setup with single-bank handler CODE_red_stairs_stamp and forced $2E=2 row-extent. Stamps a 2-row pipe-tube run.
	LDA.b #(CODE_13C955-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13C955-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$0002
	STA.b $2E
	LDA.w #$7FFF
	STA.b $19
	LDA.w #$FFFF
	STA.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_129BD5:
CODE_init_smart_floor_junction:                                     ; Object $7A (smart floor/wall/corner auto-pick): trampoline-walker init to CODE_smart_floor_junction_stamp. The stamper inspects neighbours to choose the right Map16 edge/corner template.
	REP.b #$20
	LDX.b #(CODE_13C9AD-$01)>>16
	LDA.w #CODE_13C9AD-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129BDF:
CODE_init_floor_slope_curve:                                     ; Object $7B (curved-floor / rounded-slope segment): keep-slope walker init with $17=$FFFF (descending bias) pointing at CODE_floor_slope_curve_stamp.
	REP.b #$20
	LDA.w #$FFFF
	STA.b $17
	LDX.b #(CODE_13CB49-$01)>>16
	LDA.w #CODE_13CB49-$01
	JMP.w CODE_walker_setup_keep_slope

CODE_129BEE:
CODE_init_slope_decoration_dual:                                     ; Object $7C (paired slope decoration / "drip" overlay): trampoline-walker init that takes absolute value of $2A (so width is always positive) and stores into $2E (height), then dispatches CODE_slope_decoration_dual_stamp.
	REP.b #$20
	LDA.b $2A
	BPL.b CODE_129BF8
	EOR.w #$FFFF
	INC
CODE_129BF8:
	STA.b $2E
	LDX.b #(CODE_13CCBE-$01)>>16
	LDA.w #CODE_13CCBE-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129C02:
CODE_init_overhang_2row:                                     ; Object $7D (overhang/awning, 2 rows tall): trampoline-walker init with forced $2E=2 row-extent pointing at CODE_overhang_2row_stamp.
	REP.b #$20
	LDA.w #$0002
	STA.b $2E
	LDX.b #(CODE_13CD32-$01)>>16
	LDA.w #CODE_13CD32-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129C11:
CODE_init_decoration_min2x2:                                     ; Object $7F (tall multi-tile decoration / "wall-of-tiles" object, min 2x2): trampoline-walker init forcing both $2A and $2E to at least 2, then dispatches CODE_decoration_min2x2_stamp.
	REP.b #$20
	LDA.b $2A
	CMP.w #$0002
	BCS.b CODE_129C1F
	LDA.w #$0002
	STA.b $2A
CODE_129C1F:
	LDA.b $2E
	CMP.w #$0002
	BCS.b CODE_129C2B
	LDA.w #$0002
	STA.b $2E
CODE_129C2B:
	LDX.b #(CODE_13CDD7-$01)>>16
	LDA.w #CODE_13CDD7-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129C33:
CODE_init_slope_fill_signed:                                     ; Object $80 (signed-direction slope fill): trampoline-walker init that takes absolute value of $2A into $2E (so caller can pass signed direction encoded in $2A) and dispatches CODE_slope_fill_signed_stamp.
	REP.b #$20
	LDA.b $2A
	BPL.b CODE_129C3D
	EOR.w #$FFFF
	INC
CODE_129C3D:
	STA.b $2E
	LDX.b #(CODE_13D01A-$01)>>16
	LDA.w #CODE_13D01A-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129C47:
CODE_init_wide_slope_signed:                                     ; Object $81 (wide signed-direction slope, $9B=1 enables slope mode): full walker setup with $9B=1 (keep-slope), $19=$7FFF (max width), $17=$FFFF (descending), abs-$2A into $2E. Dispatches CODE_wide_slope_signed_stamp.
	LDA.b #(CODE_13D098-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13D098-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	LDA.w #$FFFF
	STA.b $17
	LDA.b $2A
	BPL.b CODE_129C6C
	EOR.w #$FFFF
	INC
CODE_129C6C:
	STA.b $2E
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_129C74:
CODE_init_special_coin:                                     ; Object $82/$83 (red-coin collectible; std-object twin of extended-object $17): trampoline-walker init pointing at CODE_special_coin_stamp. Stamper writes $A400 (red-coin tile, item-memory tracked) only into an unclaimed cell.
	REP.b #$20
	LDX.b #(CODE_13D0E6-$01)>>16
	LDA.w #CODE_13D0E6-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129C7E:
CODE_init_special_coin_keepslope:                                     ; Object $84 (red-coin collectible, keep-slope/diagonal variant): keep-slope walker init ($17=$FFFF) pointing at CODE_special_coin_stamp_keepslope.
	REP.b #$20
	LDA.w #$FFFF
	STA.b $17
	LDX.b #(CODE_13D10A-$01)>>16
	LDA.w #CODE_13D10A-$01
	JMP.w CODE_walker_setup_keep_slope

CODE_129C8D:
CODE_init_tunnel_ceiling_slope_right_steep:                                     ; Object $85 (horizontal ceiling row with endcap detection): trampoline-walker init pointing at CODE_tunnel_ceiling_slope_right_steep_stamp. Stamper draws ceiling tiles and probes right-neighbour to merge endcaps.
	REP.b #$20
	LDX.b #(CODE_13D130-$01)>>16
	LDA.w #CODE_13D130-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129C97:
CODE_init_tunnel_ceiling_slope_left_steep:                                     ; Object $86 (vertical wall column with endcap): trampoline-walker init that computes $2E-$2A delta into $2E (so height is reduced by initial column index), then dispatches CODE_tunnel_ceiling_slope_left_steep_stamp.
	REP.b #$20
	LDA.b $2A
	STA.b $00
	LDA.b $2E
	SEC
	SBC.b $00
	BEQ.b CODE_129CA6
	BPL.b CODE_129CA9
CODE_129CA6:
	LDA.w #$0001
CODE_129CA9:
	STA.b $2E
	LDX.b #(CODE_13D1B0-$01)>>16
	LDA.w #CODE_13D1B0-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129CB3:
CODE_init_floor_no_deco_top:                                     ; Object $87/$88 (floor without top decoration, $19=2 width, $17=0): full walker setup with CODE_bg_floor_random as the random-fill bank. Stamper writes the floor row + caps.
	LDA.b #(CODE_stamp_floor_no_deco_top-$01)>>16
	STA.b $24
	STA.b $21
	LDA.b #(CODE_bg_floor_random-$01)>>16
	STA.b $27
	REP.b #$30
	LDA.w #CODE_stamp_floor_no_deco_top-$01
	STA.b $22
	STA.b $1F
	LDA.w #CODE_bg_floor_random-$01
	STA.b $25
	LDA.w #$0002
	STA.b $19
	STZ.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_129CD8:
CODE_init_falling_rock:                                     ; Object $89 (small lift / platform piece): trampoline-walker init pointing at CODE_stamp_falling_rock.
	REP.b #$20
	LDX.b #(CODE_stamp_falling_rock-$01)>>16
	LDA.w #CODE_stamp_falling_rock-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129CE2:
CODE_init_boo_guy_bomb_room:                                     ; Object $8C (contextual spike row, $2E=3 forced): trampoline-walker init pointing at CODE_stamp_boo_guy_bomb_room.
	REP.b #$20
	LDA.w #$0003
	STA.b $2E
	LDX.b #(CODE_stamp_boo_guy_bomb_room-$01)>>16
	LDA.w #CODE_stamp_boo_guy_bomb_room-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129CF1:
CODE_init_tree:                                     ; Object $8D (single-row random pipe decoration): trampoline-walker init pointing at CODE_tree_stamp.
	REP.b #$20
	LDX.b #(CODE_13D3ED-$01)>>16
	LDA.w #CODE_13D3ED-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129CFB:
CODE_init_donut_lift_giant:                                     ; Object $8E (2x2 pipe-cap block): trampoline-walker init forcing $2A to next-even and $2E=2, then dispatches CODE_stamp_donut_lift_giant.
	REP.b #$20
	LDA.b $2A
	INC
	AND.w #$FFFE
	STA.b $2A
	LDA.w #$0002
	STA.b $2E
	LDX.b #(CODE_stamp_donut_lift_giant-$01)>>16
	LDA.w #CODE_stamp_donut_lift_giant-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129D12:
CODE_init_slanted_log_gradual:                                     ; Object $8F (slanted log stuck in ground, gradual; $19=$7FFF $17=$FFFF): full walker setup pointing at CODE_slanted_log_gradual_stamp.
	LDA.b #(CODE_13D473-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13D473-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	LDA.w #$FFFF
	STA.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

CODE_129D35:
CODE_init_slanted_log:                                     ; Object $90 (mirror-direction diagonal chevron, $19=$7FFF $17=$FFFF): full walker setup pointing at CODE_slanted_log_stamp.
	LDA.b #(CODE_13D574-$01)>>16
	STA.b $24
	STA.b $21
	STA.b $27
	REP.b #$30
	LDA.w #CODE_13D574-$01
	STA.b $22
	STA.b $1F
	STA.b $25
	LDA.w #$7FFF
	STA.b $19
	LDA.w #$FFFF
	STA.b $17
	JSR.w CODE_object_stream_walk
	SEP.b #$30
	RTL

DATA_129D58:
DATA_treecap_variant_handlers:                                     ; 2-entry handler-pointer table {CODE_13D61A, CODE_13D675} used by CODE_init_treecap_3wide: $15 bit 1 selects variant A (treecap_stamp_a) vs variant B (treecap_stamp_b).
	dw CODE_13D61A-$01,CODE_13D675-$01

CODE_129D5C:
CODE_init_treecap_3wide:                                     ; Object $91/$92 (3-wide tree-cap/mushroom-cap decoration): trampoline-walker init forcing $2A=3, shifting col origin left by 1, then selects treecap_stamp_a or _b via $15 bit 1 indexed into DATA_treecap_variant_handlers.
	REP.b #$20
	LDA.w #$0003
	STA.b $2A
	LDA.b $1B
	PHA
	AND.w #$F0F0
	STA.b $00
	PLA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	LDA.b $15
	AND.w #$0002
	TAY
	LDX.b #(CODE_13D61A-$01)>>16
	LDA.w DATA_129D58,y
	JMP.w CODE_walker_setup_trampoline

CODE_129D85:
CODE_init_treecap_4wide:                                     ; Object $93 (4-wide tree-cap / mushroom-cap decoration): trampoline-walker init forcing $2A=4 and shifting col origin left by 1, then dispatches CODE_treecap_4wide_stamp.
	REP.b #$20
	LDA.w #$0004
	STA.b $2A
	LDA.b $1B
	PHA
	AND.w #$F0F0
	STA.b $00
	PLA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	LDX.b #(CODE_13D6D2-$01)>>16
	LDA.w #CODE_13D6D2-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129DA8:
CODE_init_number_platform:                                     ; Objects $94-$97 (4-orientation 2x2 grass/cattail decoration): rounds $2A and $2E up to even (default 2x2), then trampoline-walker into CODE_stamp_number_platform ($13D739).
	REP.b #$20
	LDA.b $2A
	INC
	AND.w #$FFFE
	STA.b $2A
	LDA.b $2E
	INC
	AND.w #$FFFE
	STA.b $2E
	LDX.b #(CODE_stamp_number_platform-$01)>>16
	LDA.w #CODE_stamp_number_platform-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129DC2:
CODE_init_column_3segment:                                     ; Object $98 (3-segment vertical structural column): bare trampoline-walker into CODE_stamp_column_3segment ($13D76B). Body sub-dispatches on $2C row-position (top / middle / base) into 3 distinct tile-set pickers.
	REP.b #$20
	LDX.b #(CODE_13D76B-$01)>>16
	LDA.w #CODE_13D76B-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129DCC:
CODE_init_rock_in_waterfall:                                     ; Object $99 (3-wide floor block with random middle): forces $2A=3, shifts row origin left by 1 nibble, then trampoline-walker into CODE_stamp_floor_3wide ($13D7DE). Middle column JSLs CODE_bg_floor_random.
	REP.b #$20
	LDA.w #$0003
	STA.b $2A
	LDA.b $1B
	PHA
	AND.w #$F0F0
	STA.b $00
	PLA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	LDX.b #(CODE_13D7DE-$01)>>16
	LDA.w #CODE_13D7DE-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129DEF:
CODE_init_plant_cave_large:                                     ; Object $9A (4-wide PRNG-decorated floor): forces $2A=4, shifts row origin left by 2 nibbles, CODE_prng sets $15 (variant 0-3) and $A1 (mirror), then trampoline-walker into CODE_stamp_floor_4wide.
	REP.b #$20
	LDA.w #$0004
	STA.b $2A
	LDA.b $1B
	PHA
	AND.w #$F0F0
	STA.b $00
	PLA
	AND.w #$0F0F
	DEC
	DEC
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	JSL.l CODE_prng
	AND.w #$0003
	STA.b $15
	EOR.w #$0003
	ASL
	STA.b $A1
	LDX.b #(CODE_13D855-$01)>>16
	LDA.w #CODE_13D855-$01
	JMP.w CODE_walker_setup_trampoline

DATA_129E22:
DATA_ledge_random_body_ptrs:                                     ; 2-entry ptr table for CODE_init_ledge_random_variant (objects $9B,$9C): CODE_13D945-1 / CODE_13D9C8-1 selected by $15 bit 2.
	dw CODE_13D945-$01,CODE_13D9C8-$01

CODE_129E26:
CODE_init_ledge_random_variant:                                     ; Objects $9B,$9C (2 random-decorated ledge orientations): $15 bit 2 picks between two body variants via DATA_129E22 (CODE_13D945 / CODE_13D9C8). PRNG'd $15 + $A1 set as in $9A. Trampoline-walker.
	REP.b #$20
	LDA.b $15
	AND.w #$0004
	LSR
	TAY
	JSL.l CODE_prng
	AND.w #$0003
	STA.b $15
	EOR.w #$0003
	ASL
	STA.b $A1
	LDX.b #(CODE_13D945-$01)>>16
	LDA.w DATA_129E22,y
	JMP.w CODE_walker_setup_trampoline

CODE_129E46:
CODE_init_stationary_rock:                                     ; Object $9D (corner-aware decoration cluster, $79xx page): bare trampoline-walker into CODE_stamp_stationary_rock ($13DA37). Body has tileset-aware lava-flame variant branch ($1C5C/$1C5E).
	REP.b #$20
	LDX.b #(CODE_stamp_stationary_rock-$01)>>16
	LDA.w #CODE_stamp_stationary_rock-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129E50:
CODE_init_donut_lift:                                     ; Object $9E (single-tile checkpoint/marker $7502 stamp): bare trampoline-walker into CODE_stamp_donut_lift ($13DA8E). Body unconditionally writes $7502, no shape variants.
	REP.b #$20
	LDX.b #(CODE_stamp_donut_lift-$01)>>16
	LDA.w #CODE_stamp_donut_lift-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129E5A:
CODE_init_raven_platform:                                     ; Object $9F (2-row raised-ledge step): forces $2E=2 and rounds $2A up to even, then trampoline-walker into CODE_stamp_raven_platform ($13DAA4). Body reads 4-entry DATA_13DA9C ($3308/$3508/$0004/$0005).
	REP.b #$20
	LDA.w #$0002
	STA.b $2E
	LDA.b $2A
	INC
	AND.w #$FFFE
	STA.b $2A
	LDX.b #(CODE_13DAA4-$01)>>16
	LDA.w #CODE_13DAA4-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129E71:
CODE_init_colored_block:                                     ; Objects $A0-$A2 (3 water/swamp top-edge variants): masks $15 & $000F, ASLs, rounds $2A up to even, trampoline-walker into CODE_stamp_water_top_2tile ($13DACC) which uses $15 as per-variant tile offset.
	REP.b #$20
	LDA.b $15
	AND.w #$000F
	ASL
	STA.b $15
	LDA.b $2A
	INC
	AND.w #$FFFE
	STA.b $2A
	LDX.b #(CODE_13DACC-$01)>>16
	LDA.w #CODE_13DACC-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129E8B:
CODE_init_breakable_rock:                                     ; Objects $A3,$A4 (2x2 wall/swamp block, 2 variants by $15 bit 2): forces $15 = bit 2 only, rounds $2A and $2E up to even, then trampoline-walker into CODE_stamp_breakable_rock_offset ($13DAEC).
	REP.b #$20
	LDA.b $15
	AND.w #$0004
	STA.b $15
	LDA.b $2A
	INC
	AND.w #$FFFE
	STA.b $2A
	LDA.b $2E
	INC
	AND.w #$FFFE
	STA.b $2E
	LDX.b #(CODE_13DAEC-$01)>>16
	LDA.w #CODE_13DAEC-$01
	JMP.w CODE_walker_setup_trampoline

DATA_129EAC:
DATA_pipe_extent_override:                                     ; 2-entry table ($0002/$0004) for CODE_init_pipe: when BG1 tileset == $03 (water tileset), overrides the column or row extent ($2A or $2E) for pipe-shape variation in water levels.
	dw $0002,$0004

CODE_129EB0:
CODE_init_pipe:                                     ; Objects $A5,$A6 (pipe object, 2 orientation pairs): if BG1 tileset == $03, overrides $2A or $2E to $0002 from DATA_129EAC. Trampoline-walker into CODE_pipe_dispatch (shared 4-orientation pipe stamper).
	REP.b #$20
	LDA.b $15
	AND.w #$0002
	STA.b $15
	ASL
	TAX
	LDA.w #$0002
	LDY.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CPY.b #$03
	BNE.b CODE_129ED0
	LDA.b $15
	TAY
	ORA.w #$0004
	STA.b $15
	LDA.w DATA_129EAC,y
CODE_129ED0:
	STA.b $2A,x
	LDX.b #(CODE_pipe_dispatch-$01)>>16
	LDA.w #CODE_pipe_dispatch-$01
	JMP.w CODE_walker_setup_trampoline

DATA_129EDA:
DATA_fence_body_ptrs:                                     ; 2-entry ptr table for CODE_init_fence_2variant (objects $A7,$A8): CODE_stamp_fence_corner-1 / CODE_stamp_fence_probing-1 selected by $15 bit 3.
	dw CODE_13DC91-$01,CODE_13DCF3-$01

CODE_129EDE:
CODE_init_fence_2variant:                                     ; Objects $A7,$A8 (2 fence/wall variants with corner awareness): shifts row origin left $0010, bumps $2A and $2E by 2, then $15 bit 3 picks body via DATA_129EDA (CODE_stamp_fence_corner or CODE_stamp_fence_probing).
	REP.b #$20
	LDA.b $1B
	PHA
	AND.w #$F0F0
	SEC
	SBC.w #$0010
	AND.w #$F0F0
	STA.b $00
	PLA
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	INC.b $2A
	INC.b $2A
	INC.b $2E
	INC.b $2E
	LDA.b $15
	AND.w #$0008
	LSR
	LSR
	TAY
	LDX.b #(CODE_13DC91-$01)>>16
	LDA.w DATA_129EDA,y
	JMP.w CODE_walker_setup_trampoline

CODE_129F13:
CODE_init_chomp_sign_or_pipe:                                     ; Object $A9 (cliff-top edge OR water structural -- branches on BG1 tileset): if tileset $03 forces $2A=2 + trampolines CODE_stamp_water_top_3state ($13DDF0); else trampolines CODE_stamp_cliff_top ($13DDCA).
	REP.b #$20
	LDX.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CPX.b #$03
	BEQ.b CODE_129F24
	LDX.b #(CODE_13DDCA-$01)>>16
	LDA.w #CODE_13DDCA-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129F24:
	LDA.w #$0002
	STA.b $2A
	LDX.b #(CODE_13DDF0-$01)>>16
	LDA.w #CODE_13DDF0-$01
	JMP.w CODE_walker_setup_trampoline

DATA_129F31:
DATA_wall_vertical_body_ptrs:                                     ; 2-entry ptr table for CODE_init_wall_vertical_pair (objects $AA,$AB): CODE_stamp_wall_vleft-1 / CODE_stamp_wall_vright-1 selected by $15 bit 0.
	dw CODE_13DF04-$01,CODE_13DF50-$01

CODE_129F35:
CODE_init_wall_vertical_pair:                                     ; Objects $AA,$AB (vertical wall, 2 mirror orientations): forces $2A=2, picks body via $15 bit 0 from DATA_129F31 (CODE_stamp_wall_vleft / CODE_stamp_wall_vright). Both bodies run template-aware tile remap.
	REP.b #$20
	LDA.w #$0002
	STA.b $2A
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDX.b #(CODE_13DF04-$01)>>16
	LDA.w DATA_129F31,y
	JMP.w CODE_walker_setup_trampoline

DATA_129F4B:
DATA_wall_horizontal_body_ptrs:                                     ; 2-entry ptr table for CODE_init_wall_horizontal_pair (objects $AC,$AD): CODE_stamp_wall_htop-1 / CODE_stamp_wall_hbottom-1 selected by $15 bit 0.
	dw CODE_13DE61-$01,CODE_13DEB8-$01

CODE_129F4F:
CODE_init_wall_horizontal_pair:                                     ; Objects $AC,$AD (horizontal wall/ceiling, 2 mirror orientations): if BG1 tileset == $0B forces $2E=2, then $15 bit 0 picks body via DATA_129F4B (CODE_stamp_wall_htop / CODE_stamp_wall_hbottom).
	REP.b #$20
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CMP.w #$000B
	BNE.b CODE_129F5E
	LDA.w #$0002
	STA.b $2E
CODE_129F5E:
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDX.b #(CODE_13DE61-$01)>>16
	LDA.w DATA_129F4B,y
	JMP.w CODE_walker_setup_trampoline

DATA_129F6D:
DATA_decoration_2tile_body_ptrs:                                     ; 2-entry ptr table for CODE_init_decoration_2tile_pair (objects $AE,$AF): CODE_stamp_dec_2tile_vert-1 / CODE_stamp_dec_2tile_horiz-1 selected by $15 bit 0.
	dw CODE_13E148-$01,CODE_13E170-$01

CODE_129F71:
CODE_init_decoration_2tile_pair:                                     ; Objects $AE,$AF (2-tile decoration, vertical/horizontal): $15 bit 0 selects which of $2A or $2E becomes 2 AND which body via DATA_129F6D (CODE_stamp_dec_2tile_vert / CODE_stamp_dec_2tile_horiz).
	REP.b #$20
	LDA.b $15
	AND.w #$0001
	ASL
	ASL
	TAX
	LDA.w #$0002
	STA.b $2A,x
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDX.b #(CODE_13E148-$01)>>16
	LDA.w DATA_129F6D,y
	JMP.w CODE_walker_setup_trampoline

CODE_129F8F:
CODE_init_decoration_corner_block:                                     ; Object $B0 (corner-aware 4x4 decoration block, $77 page): bare trampoline-walker into CODE_stamp_dec_corner_4x4 ($13E1B0). Body uses 16-entry DATA_13E190 indexed by 5-bucket corner position.
	REP.b #$20
	LDX.b #(CODE_13E1B0-$01)>>16
	LDA.w #CODE_13E1B0-$01
	JMP.w CODE_walker_setup_trampoline

CODE_129F99:
CODE_init_decoration_tile_remap:                                     ; Object $B1 (decoration with current-tile-aware remap): bare trampoline-walker into CODE_stamp_dec_tile_remap ($13E246). Body matches $12 against DATA_13E1FE and writes a tileset-correct replacement.
	REP.b #$20
	LDX.b #(CODE_13E246-$01)>>16
	LDA.w #CODE_13E246-$01
	JMP.w CODE_walker_setup_trampoline

DATA_129FA3:
DATA_diagonal_sewage_pipe_3row_body_ptrs:                                     ; 2-entry ptr table for CODE_init_diagonal_sewage_pipe_3row ($B2,$B3): ceiling CODE_stamp_diagonal_sewage_pipe_ceiling-1 / floor CODE_stamp_diagonal_sewage_pipe_3row_floor-1, selected by $15 bit 0 (0=ceiling, 1=floor).
	dw CODE_13E281-$01,CODE_13E2A2-$01

CODE_129FA7:
CODE_init_diagonal_sewage_pipe_3row:                                     ; Objects $B2,$B3: diagonal sewage pipe, 3-row, orientation A. $2E=3 rows, $17=$FFFF (slope step -1 row/col), KEEP-SLOPE walker. $15 bit 0 picks the ceiling edge ($B2) or floor edge ($B3) via DATA_129FA3. Uninstanced in retail levels.
	REP.b #$20
	LDA.w #$0003
	STA.b $2E
	LDA.w #$FFFF
	STA.b $17
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDX.b #(CODE_13E281-$01)>>16
	LDA.w DATA_129FA3,y
	JMP.w CODE_walker_setup_keep_slope

DATA_129FC2:
DATA_diagonal_sewage_pipe_4row_body_ptrs:                                     ; 2-entry ptr table for CODE_init_diagonal_sewage_pipe_4row ($B4,$B5): ceiling CODE_stamp_diagonal_sewage_pipe_ceiling-1 (shared with $B2) / floor CODE_stamp_diagonal_sewage_pipe_4row_floor-1, selected by $15 bit 0.
	dw CODE_13E281-$01,CODE_13E2C5-$01

CODE_129FC6:
CODE_init_diagonal_sewage_pipe_4row:                                     ; Objects $B4,$B5: diagonal sewage pipe, 4-row ("large"), orientation A. Same as $B2,$B3 but $2E=4. KEEP-SLOPE walker. $15 bit 0 picks ceiling ($B4, shares the ceiling stamp with $B2) or floor ($B5) via DATA_129FC2.
	REP.b #$20
	LDA.w #$0004
	STA.b $2E
	LDA.w #$FFFF
	STA.b $17
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDX.b #(CODE_13E281-$01)>>16
	LDA.w DATA_129FC2,y
	JMP.w CODE_walker_setup_keep_slope

DATA_129FE1:
DATA_diagonal_sewage_pipe_3row_alt_body_ptrs:                                     ; 2-entry ptr table for CODE_init_diagonal_sewage_pipe_3row_alt ($B6,$B7): ceiling CODE_stamp_diagonal_sewage_pipe_alt_ceiling-1 / floor CODE_stamp_diagonal_sewage_pipe_3row_alt_floor-1, selected by $15 bit 0.
	dw CODE_13E2E8-$01,CODE_13E32D-$01

CODE_129FE5:
CODE_init_diagonal_sewage_pipe_3row_alt:                                     ; Objects $B6,$B7: diagonal sewage pipe, 3-row, orientation B. $2E=3, $17=$FFFF, KEEP-SLOPE walker. $15 bit 0 picks ceiling ($B6) or floor ($B7) via DATA_129FE1; both edges probe neighbour map16 for shape continuation (ceiling probes below, floor probes above).
	REP.b #$20
	LDA.w #$0003
	STA.b $2E
	LDA.w #$FFFF
	STA.b $17
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDX.b #(CODE_13E2E8-$01)>>16
	LDA.w DATA_129FE1,y
	JMP.w CODE_walker_setup_keep_slope

DATA_12A000:
DATA_diagonal_sewage_pipe_4row_alt_body_ptrs:                                     ; 2-entry ptr table for CODE_init_diagonal_sewage_pipe_4row_alt ($B8,$B9): ceiling CODE_stamp_diagonal_sewage_pipe_alt_ceiling-1 (shared with $B6) / floor CODE_stamp_diagonal_sewage_pipe_4row_alt_floor-1, selected by $15 bit 0.
	dw CODE_13E2E8-$01,CODE_13E374-$01

CODE_12A004:
CODE_init_diagonal_sewage_pipe_4row_alt:                                     ; Objects $B8,$B9: diagonal sewage pipe, 4-row ("large"), orientation B. The 4-row sibling of $B6,$B7 (exactly as $B4,$B5 is the 4-row sibling of $B2,$B3): $2E=4, $17=$FFFF, KEEP-SLOPE walker. $15 bit 0 picks ceiling ($B8, shares the ceiling stamp with $B6) or floor ($B9) via DATA_12A000. (Formerly mislabeled "pipe_diagonal".)
	REP.b #$20
	LDA.w #$0004
	STA.b $2E
	LDA.w #$FFFF
	STA.b $17
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDX.b #(CODE_13E2E8-$01)>>16
	LDA.w DATA_12A000,y
	JMP.w CODE_walker_setup_keep_slope

DATA_12A01F:
DATA_pipe_entrance_stamps:                                     ; 4-entry word table of Bank13 pipe-entrance stamps ($13E3BA/$13E3E9/$13E447/$13E418) used by CODE_init_pipe_entrance.
	dw CODE_13E3BB-$01,CODE_13E3EA-$01,CODE_13E448-$01,CODE_13E419-$01

CODE_12A027:
CODE_init_pipe_entrance:                                     ; Init for std objects $BA-$BD (diagonal-pipe entrance/terminus, 4 directions); picks one of 4 variants from DATA_12A01F via ($15-2)&3, dispatches via walker_setup_trampoline to one of CODE_stamp_pipe_entrance_*.
	REP.b #$20
	LDA.b $15
	DEC
	DEC
	AND.w #$0003
	ASL
	TAY
	LDX.b #(CODE_13E3BB-$01)>>16
	LDA.w DATA_12A01F,y
	JMP.w CODE_walker_setup_trampoline

DATA_12A03A:
DATA_terrain_2variant_complex_stamps:                                     ; 2-entry word table of Bank13 complex-terrain stamp pointers ($13E582,$13E62C); selected by $15&1 in CODE_init_terrain_2variant_complex.
	dw CODE_13E583-$01,CODE_13E62D-$01

CODE_12A03E:
CODE_init_terrain_2variant_complex:                                     ; Init for std objects $BE-$BF; picks 1 of 2 complex-terrain stamps from DATA_12A03A via $15&1, dispatches via walker_setup_trampoline.
	REP.b #$20
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDX.b #(CODE_13E583-$01)>>16
	LDA.w DATA_12A03A,y
	JMP.w CODE_walker_setup_trampoline

DATA_12A04F:
DATA_terrain_4variant_height2_stamps:                                     ; 4-entry word table ($13E74B/$13E81C/$13E8A5/$13E8D8) of Bank13 height-2 terrain stamps.
	dw CODE_13E74C-$01,CODE_13E81D-$01,CODE_13E8A6-$01,CODE_13E8D9-$01

CODE_12A057:
CODE_init_terrain_4variant_height2:                                     ; Init for std objects $C0-$C3; sets $2E=2 (height=2), picks one of 4 stamps from DATA_12A04F via $15&3; first 2 use walker_setup_trampoline, last 2 use walker_setup_keep_slope.
	REP.b #$20
	LDA.w #$0002
	STA.b $2E
	LDA.w #$FFFF
	STA.b $17
	LDA.b $15
	AND.w #$0003
	ASL
	TAY
	LDX.b #(CODE_13E74C-$01)>>16
	LDA.w DATA_12A04F,y
	CPY.b #$04
	BCC.b CODE_12A076
	JMP.w CODE_walker_setup_keep_slope

CODE_12A076:
	JMP.w CODE_walker_setup_trampoline

DATA_12A079:
DATA_coin_line_stamps:                                     ; 3-entry word table ($13E903,$13E90E,$13E919) of Bank13 grid-aligned pole stamps.
	dw CODE_stamp_coin_col_aligned-$01,CODE_stamp_coin_row_aligned-$01,CODE_stamp_coin_with_single_row-$01

CODE_12A07F:
CODE_init_coin_line:                                     ; Init for std objects $C4-$C9; splits 6-way using $15 (with $00C7 fence-post adjustment); pre-writes width=1 in slot $2A,x then dispatches via walker_setup_trampoline/keep_slope to one of 3 pole stamps in DATA_coin_line_stamps.
	REP.b #$20
	LDA.b $15
	CMP.w #$00C7
	BCC.b CODE_12A089
	INC
CODE_12A089:
	STA.b $00
	PHA
	AND.w #$0001
	EOR.w #$0001
	ASL
	ASL
	TAX
	LDA.w #$0001
	STA.b $2A,x
	LDA.b $00
	LSR
	LSR
	AND.w #$0002
	STA.b $15
	LDA.w #$FFFF
	STA.b $17
	PLA
	AND.w #$0003
	ASL
	TAY
	LDX.b #(CODE_stamp_coin_col_aligned-$01)>>16
	LDA.w DATA_coin_line_stamps,y
	CPY.b #$04
	BCC.b CODE_12A0BA
	JMP.w CODE_walker_setup_keep_slope

CODE_12A0BA:
	JMP.w CODE_walker_setup_trampoline

CODE_12A0BD:
CODE_init_sewer_water_pool:                                     ; Init for std object $CA; minimal setup, dispatches via walker_setup_trampoline to CODE_stamp_sewer_water_pool at $13E9F5.
	REP.b #$20
	LDX.b #(CODE_13E9F6-$01)>>16
	LDA.w #CODE_13E9F6-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A0C7:
CODE_init_slope_3variant_3tile:                                     ; Init for std object $CB; zeros $A1 (handler-state hint) and dispatches via walker_setup_trampoline to CODE_stamp_slope_3tile at $13EBFB.
	REP.b #$20
	STZ.b $A1
	LDX.b #(CODE_13EBFC-$01)>>16
	LDA.w #CODE_13EBFC-$01
	JMP.w CODE_walker_setup_trampoline

DATA_12A0D3:
DATA_castle_wall_diag_stamps:                                     ; 2-entry word table ($13EB63,$13EA59) of Bank13 stamp pointers for the castle-wall-diagonal family ($CC left / $CD right).
	dw CODE_13EB64-$01,CODE_13EA5A-$01

CODE_12A0D7:
CODE_init_castle_wall_diag:                                     ; Init for std objects $CC-$CD; zeros $A1, sets $17=1 (height=1), picks 1 of 2 stamps from DATA_12A0D3 via $15&1, dispatches via walker_setup_keep_slope.
	REP.b #$20
	STZ.b $A1
	LDA.w #$0001
	STA.b $17
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDX.b #(CODE_13EB64-$01)>>16
	LDA.w DATA_12A0D3,y
	JMP.w CODE_walker_setup_keep_slope

CODE_12A0EF:
CODE_init_col_base_8700_off1:                                     ; Init for std object $CE; hardcodes $15=1 ($15=0 if $2A<0 i.e. width<0), $17=$FFFF, dispatches via walker_setup_keep_slope to CODE_stamp_col_base_8700 at $13EC4B.
	REP.b #$20
	LDA.w #$0001
	STA.b $15
	LDA.b $2A
	BPL.b CODE_12A0FC
	STZ.b $15
CODE_12A0FC:
	LDA.w #$FFFF
	STA.b $17
	LDX.b #(CODE_13EC4C-$01)>>16
	LDA.w #CODE_13EC4C-$01
	JMP.w CODE_walker_setup_keep_slope

CODE_12A109:
CODE_init_col_base_8700_off2:                                     ; Init for std object $CF; hardcodes $15=2 (or 0 if $2A<0), $17=$FFFF, dispatches to CODE_stamp_col_pair_8702_8704 at $13EC65 via walker_setup_keep_slope.
	REP.b #$20
	LDA.w #$0002
	STA.b $15
	LDA.b $2A
	BPL.b CODE_12A116
	STZ.b $15
CODE_12A116:
	LDA.w #$FFFF
	STA.b $17
	LDX.b #(CODE_13EC66-$01)>>16
	LDA.w #CODE_13EC66-$01
	JMP.w CODE_walker_setup_keep_slope

CODE_12A123:
CODE_init_col_base_8700_off3:                                     ; Init for std object $D0; hardcodes $15=2 (or 0 if $2A<0), $17=$FFFF, dispatches to CODE_stamp_col_pair_8706_870A at $13EC80 via walker_setup_keep_slope.
	REP.b #$20
	LDA.w #$0002
	STA.b $15
	LDA.b $2A
	BPL.b CODE_12A130
	STZ.b $15
CODE_12A130:
	LDA.w #$FFFF
	STA.b $17
	LDX.b #(CODE_13EC81-$01)>>16
	LDA.w #CODE_13EC81-$01
	JMP.w CODE_walker_setup_keep_slope

CODE_12A13D:
CODE_init_single_tile_870F:                                     ; Init for std object $D1; trivial walker_setup_trampoline to CODE_stamp_single_tile_870F at $13ECA0.
	REP.b #$20
	LDX.b #(CODE_13ECA1-$01)>>16
	LDA.w #CODE_13ECA1-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A147:
CODE_init_single_tile_870E:                                     ; Init for std object $D2; trivial walker_setup_trampoline to CODE_stamp_single_tile_870E at $13ECA7.
	REP.b #$20
	LDX.b #(CODE_13ECA8-$01)>>16
	LDA.w #CODE_13ECA8-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A151:
CODE_init_4tile_cycle_854B:                                     ; Init for std object $D3; trivial walker_setup_trampoline to CODE_stamp_4tile_cycle_854B at $13ECB5.
	REP.b #$20
	LDX.b #(CODE_13ECB6-$01)>>16
	LDA.w #CODE_13ECB6-$01
	JMP.w CODE_walker_setup_trampoline

DATA_12A15B:
DATA_growable_4variant_stamps:                                     ; 4-entry word table ($13ED26,$13EE30,$13EF56,$13F06B) of Bank13 growable-decoration stamps.
	dw CODE_13ED27-$01,CODE_13EE31-$01,CODE_13EF57-$01,CODE_13F06C-$01

CODE_12A163:
CODE_init_growable_4variant:                                     ; Init for std objects $D4-$D7; zeros $A1, picks 1 of 4 growable-decoration stamps from DATA_12A15B via $15&3, dispatches via walker_setup_trampoline.
	REP.b #$20
	STZ.b $A1
	LDA.b $15
	AND.w #$0003
	ASL
	TAY
	LDX.b #(CODE_13ED27-$01)>>16
	LDA.w DATA_12A15B,y
	JMP.w CODE_walker_setup_trampoline

DATA_12A176:
DATA_lift_width_2variant:                                     ; 2-entry word table ($0004,$0003) of width values selected by CODE_init_lift_width_select.
	dw $0004,$0003

CODE_12A17A:
CODE_init_lift_width_select:                                     ; Init for std objects $D8-$D9; picks width=4 or 3 from DATA_12A176 via $15&1 (writes into $2E), preserves orientation in $15, dispatches via walker_setup_trampoline to CODE_stamp_lift_14tile at $13F166.
	REP.b #$20
	LDA.b $15
	AND.w #$0001
	ASL
	TAX
	ASL
	ASL
	ASL
	STA.b $15
	LDA.w DATA_12A176,x
	STA.b $2E
	LDX.b #(CODE_13F167-$01)>>16
	LDA.w #CODE_13F167-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A195:
CODE_init_star_block:                                     ; Init for std object $DA; trivial walker_setup_trampoline to CODE_stamp_star_block at $13F185.
	REP.b #$20
	LDX.b #(CODE_stamp_star_block-$01)>>16
	LDA.w #CODE_stamp_star_block-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A19F:
CODE_init_ice_floor:                                     ; Init for std object $DB; trivial walker_setup_trampoline to CODE_stamp_ice_floor at $13F1A1.
	REP.b #$20
	LDX.b #(CODE_13F1A2-$01)>>16
	LDA.w #CODE_13F1A2-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A1A9:
CODE_init_ice_floor_edge_water:                                     ; Init for std object $DC; trivial walker_setup_trampoline to CODE_stamp_ice_floor_edge_water at $13F205.
	REP.b #$20
	LDX.b #(CODE_13F206-$01)>>16
	LDA.w #CODE_13F206-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A1B3:
CODE_init_random_8phase:                                     ; Init for std object $DD; calls CODE_prng + AND #$0007 to store random phase into $15, dispatches via walker_setup_trampoline to CODE_stamp_random_8phase at $13F2BD.
	REP.b #$20
	JSL.l CODE_prng
	AND.w #$0007
	STA.b $15
	LDX.b #(CODE_13F2BE-$01)>>16
	LDA.w #CODE_13F2BE-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A1C6:
CODE_init_small_inc_width:                                     ; Init for std object $DE; pre-increments $2A (so width grows by 1), dispatches via walker_setup_trampoline to CODE_stamp_small_tile_set at $13F33A.
	REP.b #$20
	INC.b $2A
	LDX.b #(CODE_13F33B-$01)>>16
	LDA.w #CODE_13F33B-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A1D2:
CODE_init_lava_cave_pool:                                     ; Init for object $DF (rocky mountain stone block with horizontal top cap). Bumps $2E by 1 (extra row for the cap), points the walker at CODE_stamp_lava_cave_pool, then dispatches via the trampoline.
	REP.b #$20
	INC.b $2E
	LDX.b #(CODE_stamp_lava_cave_pool-$01)>>16
	LDA.w #CODE_stamp_lava_cave_pool-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A1DE:
CODE_init_lava_flow_down:                                     ; Init for object $E0 (tiny 2-row mountain peak / mini-pillar). Thin init  just loads bank+ptr of CODE_stamp_lava_flow_down and jumps to the walker trampoline; no orientation prep.
	REP.b #$20
	LDX.b #(CODE_stamp_lava_flow_down-$01)>>16
	LDA.w #CODE_stamp_lava_flow_down-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A1E8:
CODE_init_mushroom_platform:                                     ; Init for object $E1 (decorated wall column with shape-flipped face). Zeroes $A1, then PRNG-picks an orientation-mask from {0,3,2,1} into $15 (shifted ASL 3) to drive the stamp's sub-table selection, then activates CODE_stamp_mushroom_platform.
	REP.b #$20
	STZ.b $A1
	JSL.l CODE_prng
	AND.w #$0003
	BEQ.b CODE_12A1F8
	EOR.w #$0003
CODE_12A1F8:
	ASL
	ASL
	ASL
	STA.b $15
	LDX.b #(CODE_stamp_mushroom_platform-$01)>>16
	LDA.w #CODE_stamp_mushroom_platform-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A205:
CODE_init_snowy_platform_support:                                     ; Init for object $E2 (tall multi-row mountain spire). Sets $2A=4 (4-column-wide template), then activates CODE_stamp_snowy_platform_support (CODE_13F4E4)  handler walks 8+ rows of progressively wider stone tiles.
	REP.b #$20
	LDA.w #$0004
	STA.b $2A
	LDX.b #(CODE_13F4E4-$01)>>16
	LDA.w #CODE_13F4E4-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A214:
CODE_init_ice_floor_edge_hole:                                     ; Init for object $E3 (3-segment vertical column / chimney). Plain trampoline activation of CODE_stamp_ice_floor_edge_hole (CODE_13F511); caller pre-sets dimensions.
	REP.b #$20
	LDX.b #(CODE_13F511-$01)>>16
	LDA.w #CODE_13F511-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A21E:
CODE_init_slope_steep_up_left:                                     ; Init for object $E4 (steep upward-left ground slope). Invokes shared helper CODE_slope_shift_origin_left_20 to bias $1B left by $20 (1.25 tiles) and bump $2E by 2 (extra rows for slope shape), then activates CODE_stamp_slope_steep_up_left (CODE_13F5EE) via the keep-slope-zero entry.
	REP.b #$20
	JSR.w CODE_12A22B
	LDX.b #(CODE_13F5EE-$01)>>16
	LDA.w #CODE_13F5EE-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A22B:
CODE_slope_shift_origin_left_20:                                     ; Shared helper for steep upward-left slopes ($E4/$E5/$E6/$E8/$E9): masks $1B to its hi-nibble (column), subtracts $0020 (2 Map16 cells left), recombines with the original lo-nibble (row bits), bumps $2E by 2. Returns with the walker origin shifted up-and-left by the slope's lead.
	LDA.b $1B
	AND.w #$F0F0
	SEC
	SBC.w #$0020
	AND.w #$F0F0
	STA.b $00
	LDA.b $1B
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	INC.b $2E
	INC.b $2E
	RTS

CODE_12A247:
CODE_init_slope_down_left_long:                                     ; Init for object $E5 (long down-left ground slope). Calls CODE_slope_shift_origin_left_20, then sets $17=$FFFF (slope step = -1 row per col) and activates CODE_stamp_slope_down_left_long (CODE_13F6D2) via keep-slope.
	REP.b #$20
	JSR.w CODE_12A22B
	LDA.w #$FFFF
	STA.b $17
	LDX.b #(CODE_13F6D2-$01)>>16
	LDA.w #CODE_13F6D2-$01
	JMP.w CODE_walker_setup_keep_slope

CODE_12A259:
CODE_init_slope_down_left_short:                                     ; Init for object $E6 (short down-left ground slope  4-row variant). Calls CODE_slope_shift_origin_left_20, sets $17=$FFFF (slope step = -1), activates CODE_stamp_slope_down_left_short (CODE_13F777) via keep-slope.
	REP.b #$20
	JSR.w CODE_12A22B
	LDA.w #$FFFF
	STA.b $17
	LDX.b #(CODE_13F777-$01)>>16
	LDA.w #CODE_13F777-$01
	JMP.w CODE_walker_setup_keep_slope

CODE_12A26B:
CODE_init_slope_down_left_half:                                     ; Init for object $E7 (half-height down-left slope  single row of slope tiles). Shifts $1B left by $10 (only half a column), bumps $2E by 1, sets $17=$FFFE (steeper slope step), activates CODE_stamp_slope_down_left_half (CODE_13F7DF) via keep-slope.
	REP.b #$20
	LDA.b $1B
	AND.w #$F0F0
	SEC
	SBC.w #$0010
	AND.w #$F0F0
	STA.b $00
	LDA.b $1B
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	INC.b $2E
	LDA.w #$FFFE
	STA.b $17
	LDX.b #(CODE_13F7DF-$01)>>16
	LDA.w #CODE_13F7DF-$01
	JMP.w CODE_walker_setup_keep_slope

CODE_12A293:
CODE_init_slope_down_right_long:                                     ; Init for object $E8 (long down-right ground slope  mirror of object $E5). Calls CODE_slope_shift_origin_left_20, sets $17=$FFFF, activates CODE_stamp_slope_down_right_long (CODE_13F888) via keep-slope.
	REP.b #$20
	JSR.w CODE_12A22B
	LDA.w #$FFFF
	STA.b $17
	LDX.b #(CODE_13F888-$01)>>16
	LDA.w #CODE_13F888-$01
	JMP.w CODE_walker_setup_keep_slope

CODE_12A2A5:
CODE_init_slope_down_right_short:                                     ; Init for object $E9 (short down-right ground slope  mirror of object $E6). Calls CODE_slope_shift_origin_left_20, sets $17=$FFFF, activates CODE_stamp_slope_down_right_short (CODE_13F94F) via keep-slope.
	REP.b #$20
	JSR.w CODE_12A22B
	LDA.w #$FFFF
	STA.b $17
	LDX.b #(CODE_13F94F-$01)>>16
	LDA.w #CODE_13F94F-$01
	JMP.w CODE_walker_setup_keep_slope

CODE_12A2B7:
CODE_init_slope_down_right_half:                                     ; Init for object $EA (half-height down-right slope  mirror of object $E7). Shifts $1B left by $10, bumps $2E by 1, sets $17=$FFFE, activates CODE_stamp_slope_down_right_half (CODE_13F9B7) via keep-slope.
	REP.b #$20
	LDA.b $1B
	AND.w #$F0F0
	SEC
	SBC.w #$0010
	AND.w #$F0F0
	STA.b $00
	LDA.b $1B
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	INC.b $2E
	LDA.w #$FFFE
	STA.b $17
	LDX.b #(CODE_13F9B7-$01)>>16
	LDA.w #CODE_13F9B7-$01
	JMP.w CODE_walker_setup_keep_slope

CODE_12A2DF:
CODE_init_shoreline_slope_capped:                                     ; Init for objects $EB/$EC (shoreline-slope-with-water-cap, left or right variant). Reads bit $0004 of $15 LSR-1 to derive direction byte (left=0 / right=1 stored back in $15), shifts $1B left by $10, bumps $2E, then activates CODE_stamp_shoreline_slope_capped (CODE_13FA0D).
	REP.b #$20
	LDA.b $15
	AND.w #$0004
	LSR
	STA.b $15
	LDA.b $1B
	AND.w #$F0F0
	SEC
	SBC.w #$0010
	AND.w #$F0F0
	STA.b $00
	LDA.b $1B
	AND.w #$0F0F
	ORA.b $00
	STA.b $1B
	INC.b $2E
	LDX.b #(CODE_13FA0D-$01)>>16
	LDA.w #CODE_13FA0D-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A30A:
CODE_init_stone_3d_wall:                                     ; Init for object $ED (3-cell-tall waterfall / lava-fall column with cap variants). Derives orientation $15 from XOR of $1B bits 0 and 4 (so visual variant depends on map-grid parity), then activates CODE_stamp_stone_3d_wall.
	REP.b #$20
	LDA.b $1B
	AND.w #$0001
	STA.b $00
	LDA.b $1B
	LSR
	LSR
	LSR
	LSR
	AND.w #$0001
	EOR.b $00
	STA.b $15
	LDX.b #(CODE_stamp_stone_3d_wall-$01)>>16
	LDA.w #CODE_stamp_stone_3d_wall-$01
	JMP.w CODE_walker_setup_trampoline

CODE_12A328:
CODE_init_stone_3d:                                    ; Init for objects $EE / $EF (static 3D stone, two parity variants; per GoldenEgg $EE = bottom hollow, $EF = bottom solid). Sets $A1 from XOR of $1B's nibbles (map-grid parity) and toggles $15's low bit ($0001 -> $FFFF if zero), then tail-calls CODE_walker_setup_trampoline with CODE_stone_3d_stamp. Differs from the moving 3D stones $F0-$F3 by skipping the OPTMovingObjectTable ($70:449E) registration block, so $EE/$EF stay static while $F0-$F3 oscillate.
	REP.b #$20
	LDA.b $1B
	LSR
	LSR
	LSR
	LSR
	EOR.b $1B
	AND.w #$0001
	STA.b $A1
	LDA.b $15
	AND.w #$0001
	EOR.w #$0001
	BNE.b CODE_12A342
	DEC
CODE_12A342:
	STA.b $15
	LDX.b #(CODE_stone_3d_stamp-$01)>>16
	LDA.w #CODE_stone_3d_stamp-$01
	JMP.w CODE_walker_setup_trampoline

DATA_12A34C:
DATA_moving_stone_3d_amplitudes:                                     ; 4-entry signed-amplitude table ($20,$40,$E0,$C0) for CODE_init_moving_stone_3d, indexed by $15 lo-nibble (objects $F0-$F3). Sign = oscillation direction, magnitude = speed: $20=+slow ($F0), $40=+quick ($F1), $E0=-slow ($F2 reverse), $C0=-quick ($F3 reverse). Stored as the amplitude byte of the OPTMovingObjectTable entry at $70:449E.
	db $20,$40,$E0,$C0

CODE_12A350:
CODE_init_moving_stone_3d:                                     ; Init for objects $F0-$F3 (Moving 3D stone: slow/quick x normal/reverse). Builds a 6-byte {leftTileX, topTileY, $2A-1 (width-1), $2E-1 (height-1), amplitude} record and registers it in the 3D-object render table OPTMovingObjectTable at $70:449E (6-byte stride; scans for a free slot, caps at the 20th). The amplitude byte is DATA_moving_stone_3d_amplitudes[$15&$0F] (signed; sign = oscillation direction). Sets $15=$8000, derives $A1 parity, then stamps the column via CODE_stone_3d_stamp. The registered entry is animated by the SuperFX 3D renderer CODE_02C1F4 (shared with Nep-Enut, sprite $A5).
	LDA.b $1B
	PHA
	LSR
	LSR
	LSR
	LSR
	STA.b $02
	PLA
	AND.b #$0F
	STA.b $00
	LDA.b $1C
	PHA
	AND.b #$F0
	ORA.b $02
	STA.b $02
	PLA
	ASL
	ASL
	ASL
	ASL
	ORA.b $00
	STA.b $00
	LDX.b #$00
CODE_12A372:
	LDA.l $7044A0,x
	BEQ.b CODE_12A384
	INX
	INX
	INX
	INX
	INX
	INX
	CPX.b #$72
	BCC.b CODE_12A372
	LDX.b #$72
CODE_12A384:
	LDA.b $00
	STA.l $70449E,x
	LDA.b $02
	STA.l $70449F,x
	LDA.b $2A
	DEC
	STA.l $7044A0,x
	LDA.b $2E
	DEC
	STA.l $7044A1,x
	LDA.b $15
	AND.b #$0F
	TAY
	LDA.w DATA_moving_stone_3d_amplitudes,y
	STA.l $7044A2,x
	REP.b #$20
	LDA.b $1B
	LSR
	LSR
	LSR
	LSR
	EOR.b $1B
	AND.w #$0001
	STA.b $A1
	LDA.w #$8000
	STA.w $0015
	LDX.b #(CODE_stone_3d_stamp-$01)>>16
	LDA.w #CODE_stone_3d_stamp-$01
	JMP.w CODE_walker_setup_trampoline

;-------------------------------------------------------------------------
; CODE_init_spike -- thin init handler that hands the walker the Bank13 per-cell
; stamper at CODE_stamp_spike (row-0 vs row-rest two-tile column). Caller
; pre-sets $2A/$2E; this just loads X/A and JMPs the trampoline.
;-------------------------------------------------------------------------
CODE_12A3C7:
CODE_init_spike:                                     ; Init for object $F5 (decorative vertical column with $8413 cap + $2910 body). Thin trampoline-only init pointing at CODE_stamp_spike; caller pre-sets $2A/$2E.
	REP.b #$20
	LDX.b #(CODE_stamp_spike-$01)>>16
	LDA.w #CODE_stamp_spike-$01
	JMP.w CODE_walker_setup_trampoline

;-------------------------------------------------------------------------
; CODE_12A3D1 -- thin init handler that hands the walker the Bank13 per-cell
; stamper at CODE_decoration_overlay ("stamp Map16 $9D8B only if cell is currently
; empty" -- typical for decoration-overlay objects).
;-------------------------------------------------------------------------
CODE_12A3D1:
CODE_init_decoration_overlay:                                     ; Init for object $F6 (decoration-overlay object  paints $9D8B only on empty cells). Thin trampoline-only init pointing at CODE_decoration_overlay; used so the decoration never overwrites existing terrain.
	REP.b #$20
	LDX.b #(CODE_decoration_overlay-$01)>>16
	LDA.w #CODE_decoration_overlay-$01
	JMP.w CODE_walker_setup_trampoline

;-------------------------------------------------------------------------
; CODE_walker_setup_trampoline / CODE_walker_setup_keep_slope -- WALKER SETUP TRAMPOLINE.
;
; This is the JMP target 169 per-object init handlers tail-call to (+26
; more that target CODE_walker_setup_keep_slope to preserve a non-zero slope $17). It
; sets up the walker's per-row + per-col handler pointers (stashing the
; SAME ptr in all 6 slots = the handler will be called for every cell)
; then invokes CODE_object_stream_walk (intra_object_walker) to flood-fill the
; object's rectangle.
;
; INPUTS:  A    16-bit ptr-1 of the per-cell handler (any of the
;               Bank12/13 routines that "decide what Map16 ID to write
;               for one cell"; typically CODE_12A4xx / CODE_12Axxx in
;               this bank or CODE_138xxx / CODE_139xxx in Bank13)
;          X    bank byte of the per-cell handler (high byte of its
;               24-bit address minus one)
;          $2A  column extent (caller pre-set)
;          $2E  row extent (caller pre-set)
;          $1B/$1C  starting Map16 coords (caller pre-set, usually = the
;               object's stream-encoded XY)
;          $15  per-object orientation / variant byte (caller pre-set;
;               handlers like CODE_extobj_default_percell read it to pick which DATA_*
;               sub-table to use)
;
; ENTRY POINTS:
;   CODE_walker_setup_trampoline  -- standard entry, ALSO clears $17 (per-row slope=0)
;   CODE_walker_setup_keep_slope  -- entry for handlers that need a non-zero slope (e.g.
;                   diagonal-slope objects; they STZ $17 themselves to
;                   their slope step before jumping here)
;
; OUTPUTS: After the walker finishes its rectangle traversal it returns
;          here, which RTLs back to Bank10's CODE_108BAF main parser.
;-------------------------------------------------------------------------
CODE_12A3DB:
CODE_walker_setup_trampoline:                                    ; descriptive alias
CODE_walker_setup_with_slope_zero:                               ; descriptive alias
	STZ.b $17                                                 ; default slope = 0
CODE_12A3DD:
CODE_walker_setup_keep_slope:                                    ; descriptive alias
	STX.b $24                                                 ; \ all 3 bank-byte slots same:
	STX.b $21                                                 ; |   $21 (odd-col), $24 (even-col),
	STX.b $27                                                 ; /   $27 (row)
	REP.b #$10
	STA.b $22                                                 ; \ all 3 ptr-1 slots same:
	STA.b $1F                                                 ; |   $1F (odd-col), $22 (even-col),
	STA.b $25                                                 ; /   $25 (row)
	LDA.w #$7FFF                                              ; \ rows-to-walk = "essentially infinite";
	STA.b $19                                                 ; / walker terminates via $2C==$2E
	JSR.w CODE_object_stream_walk                                         ; -> intra-object walker
	SEP.b #$30
	RTL

;=========================================================================
; PER-CELL HANDLER BODIES (CODE_extobj_default_percell onward)
;
; The init handlers above (CODE_extobj_handler_default_00_09 .. CODE_12A3D1) tail-call into the
; walker setup trampoline with a "per-cell" handler pointer. Those per-cell
; handlers live HERE -- each one is called once per Map16 cell while the
; walker is iterating the object's rectangle. Inputs:
;
;   $1D    byte offset into !RAM_YI_Level_LevelDataBuffer (where to stamp)
;   $12    current Map16 ID at that offset (already-stamped tile, for
;          shape-aware handlers that decide based on what's underneath)
;   $15    per-object orientation / variant byte (set by init handler)
;   $28    column position within object (0..$2A-1)
;   $2C    row position within object (0..$2E-1)
;
; Typical action: index into a per-orientation tile table (e.g. DATA_12A45C
; -> DATA_default_handler_tiles_orient0/402/40E/41A/...) using $15, then offset by ($2C * cols +
; $28) to pick the Map16 ID for this cell, and STA into LevelDataBuffer,X
; with X = $1D.
;
; Naming the per-cell handlers individually would be a massive task. For
; now they remain CODE_12Axxx; see Bank13's similar bodies for the same
; pattern repeated ~600 times for floor / wall / slope / tunnel / water /
; vine / lava / decoration / pipe / etc. shapes.
;
; The data tables interleaved into the code (DATA_default_handler_tiles_orient0..DATA_12A476
; below, plus dozens of others further down) are per-orientation tile-ID
; lookup arrays consumed by the next CODE_xxx that follows them.
;=========================================================================

;-------------------------------------------------------------------------
; DATA_default_handler_tiles_orient0 .. DATA_12A476 -- tile-ID lookup tables for CODE_extobj_default_percell.
; Layout: DATA_12A45C is a 10-entry table of pointers to per-orientation
; "row-of-tiles" arrays (DATA_default_handler_tiles_orient0 etc.); DATA_12A476 is a 10-entry
; table of pointers to per-orientation "row-pitch" bytes (DATA_12A470
; etc.). $15 picks which orientation; ($28, $2C) picks which cell within.
;-------------------------------------------------------------------------
DATA_12A3F6:
DATA_default_handler_tiles_orient0:                              ; descriptive alias
	dw $9600,$9601,$9610,$9611,$0000,$920D

DATA_12A402:
	dw $967D,$967E,$967B,$967C,$920C,$0000

DATA_12A40E:
	dw $0000,$0000,$9606,$9607,$9208,$920C

DATA_12A41A:
	dw $0000,$0000,$9604,$9605,$920D,$920E

DATA_12A426:
	dw $0000,$967A,$920D

DATA_12A42C:
	dw $0000,$9618,$920C

DATA_12A432:
	dw $0000,$967F,$920B

DATA_12A438:
	dw $0000,$9612,$920A

DATA_12A43E:
	dw $0000,$9604,$9605,$9613,$9614,$9615,$9208,$9209
	dw $920A

DATA_12A450:
	dw $9606,$9607,$9616,$9617,$920B,$920C

DATA_12A45C:
	dw DATA_default_handler_tiles_orient0,DATA_12A402,DATA_12A40E,DATA_12A41A,DATA_12A426,DATA_12A42C,DATA_12A432,DATA_12A438
	dw DATA_12A43E,DATA_12A450

DATA_12A470:
	db $02,$04

DATA_12A472:
	db $01,$02

DATA_12A474:
	db $03,$06

DATA_12A476:
	dw DATA_12A470-$01,DATA_12A470-$01,DATA_12A470-$01,DATA_12A470-$01,DATA_12A472-$01,DATA_12A472-$01,DATA_12A472-$01,DATA_12A472-$01
	dw DATA_12A474-$01,DATA_12A470-$01

;-------------------------------------------------------------------------
; CODE_extobj_default_percell -- per-cell handler for the "default extended object" family
; (called from CODE_extobj_handler_default_00_09 via the walker setup trampoline). Picks the
; tile based on object orientation ($15), row ($2C), column ($28).
;
; INPUTS:  $15  orientation 0..9 (selects one of 10 per-orient tables)
;          $2C, $28  row/col within object
;          $1D  buffer offset to stamp at
;
; OUTPUTS: !RAM_YI_Level_LevelDataBuffer[$1D] := Map16 ID picked from table
; MODIFIES: $00, $02, A/X/Y returned 8-bit.
;-------------------------------------------------------------------------
CODE_12A48A:
CODE_extobj_default_percell:                                     ; descriptive alias
	REP.b #$30
	LDX.b $15                                                 ; X = orientation (0..9)
	LDA.w DATA_12A45C,x                                       ; \ $00 = per-orient tile-row table ptr
	STA.b $00                                                 ; /
	LDA.w DATA_12A476,x                                       ; \ $02 = per-orient pitch table ptr
	STA.b $02                                                 ; /
	LDY.b $2C
	BEQ.b CODE_12A4A2
	LDA.b ($02),y
	AND.w #$00FF
	TAY
CODE_12A4A2:
	TYA
	CLC
	ADC.b $28
	ASL
	TAY
	LDA.b ($00),y
	BEQ.b CODE_12A4B2
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12A4B2:
	SEP.b #$30
	RTL

DATA_12A4B5:
	dw $9096,$9097,$90A6,$90A7

DATA_12A4BD:
	dw $907C,$9095,$90A4,$90A5

DATA_12A4C5:
	dw DATA_12A4B5,DATA_12A4BD

CODE_12A4C9:
	REP.b #$30
	LDX.b $15
	LDA.w DATA_12A4C5,x
	STA.b $00
	LDA.b $2C
	ASL
	ADC.b $28
	ASL
	TAY
	LDA.b ($00),y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12A4E4:
	dw $920F,$9066,$9076,$9086

CODE_12A4EC:
	REP.b #$30
	LDA.b $2C
	ASL
	TAY
	LDA.w DATA_12A4E4,y
	LDX.b $12
	CPX.w #$9216
	BNE.b CODE_12A4FF
	LDA.w #$9213
CODE_12A4FF:
	CLC
	ADC.b $28
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12A50B:
	dw $5554,$5554,$5554,$5554,$5756,$5756,$5756,$5756
	dw $0100,$0302,$0504,$0706,$0908,$0B0A,$0D0C,$0F0E
	dw $1312,$1514,$1716,$1918,$1D1C,$5B5B,$5B5B,$5B5B
	dw $2322,$5B5B,$5B5B,$5B5B,$2726,$5B5B,$5B5B,$5B5B
	dw $2B2A,$5B5B,$5B5B,$5B5B,$2F2E,$5B5B,$5B5B,$5B5B
	dw $3332,$5B5B,$5B5B,$5B5B,$0100,$5B5B,$5B5B,$5B5B
	dw $4E4D,$464F,$4847,$4C49,$5251,$5053,$4B4A,$5053
	dw $5859,$5859,$5859,$5859,$5A5A,$5A5A,$5A5A,$5A5A

DATA_12A58B:
	dw $5554,$5554,$5554,$5554,$5756,$5756,$5756,$5756
	dw $0100,$211E,$3736,$3938,$1110,$3B3A,$3D3C,$3F3E
	dw $1B1A,$4140,$4342,$4544,$201F,$5B5B,$5B5B,$5B5B
	dw $2524,$5B5B,$5B5B,$5B5B,$2928,$5B5B,$5B5B,$5B5B
	dw $2D2C,$5B5B,$5B5B,$5B5B,$3130,$5B5B,$5B5B,$5B5B
	dw $3534,$5B5B,$5B5B,$5B5B,$0100,$5B5B,$5B5B,$5B5B
	dw $4E4D,$464F,$4847,$4C49,$5251,$5053,$4B4A,$5053
	dw $5859,$5859,$5859,$5859,$5A5A,$5A5A,$5A5A,$5A5A

DATA_12A60B:
	dw DATA_12A50B,DATA_12A58B

CODE_12A60F:
	REP.b #$30
	LDA.b $2C
	ASL
	ASL
	ASL
	ADC.b $28
	TAY
	LDX.b $15
	LDA.w DATA_12A60B,x
	STA.b $00
	LDA.b ($00),y
	AND.w #$00FF
	CMP.w #$005B
	BEQ.b CODE_12A648
	CMP.w #$0046
	BCC.b CODE_12A63A
	CMP.w #$0054
	BCC.b CODE_12A63F
	CLC
	ADC.w #$9D30
	BRA.b CODE_12A642

CODE_12A63A:
	ADC.w #$9684
	BRA.b CODE_12A642

CODE_12A63F:
	ADC.w #$9D46
CODE_12A642:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12A648:
	SEP.b #$30
	RTL

CODE_12A64B:
	LDA.w #$00B6
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTL

DATA_12A655:
	db $00,$01,$00,$01,$02,$03,$02,$03,$01,$00,$01,$00,$03,$02,$03,$02

CODE_12A665:
	REP.b #$30
	LDA.b $2C
	AND.w #$0003
	ASL
	ASL
	STA.b $00
	LDA.b $28
	AND.w #$0003
	ORA.b $00
	TAX
	LDA.w DATA_12A655,x
	AND.w #$00FF
	CLC
	ADC.w #$84C2
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12A68B:
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	CLC
	ADC.w #$7797
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12A69C:
	dw $96D1,$96D1,$96D1,$96D2,$96D2

CODE_12A6A6:
	REP.b #$30
	LDA.b $28
	ASL
	TAY
	LDA.w DATA_12A69C,y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12A6B8:
	dw $96D3,$96D3,$96D1,$96D1,$96D1

CODE_12A6C2:
	REP.b #$30
	LDA.b $28
	ASL
	TAY
	LDA.w DATA_12A6B8,y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12A6D4:
	dw $96D6,$0000,$96D6,$96D7,$0000,$96D7,$0000,$96D4
	dw $0000,$96D4

CODE_12A6E8:
	REP.b #$30
	LDA.w #$FFFF
	STA.b $9B
	LDA.b $28
	ASL
	ORA.b $2C
	ASL
	TAY
	LDA.w DATA_12A6D4,y
	BEQ.b CODE_12A701
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12A701:
	SEP.b #$30
	RTL

DATA_12A704:
	dw $0000,$96D5,$0000,$96D5,$0000,$96D8,$96D9,$96D8
	dw $96D9,$0000

CODE_12A718:
	REP.b #$30
	LDA.w #$FFFF
	STA.b $9B
	LDA.b $28
	ASL
	ORA.b $2C
	ASL
	TAY
	LDA.w DATA_12A704,y
	BEQ.b CODE_12A731
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12A731:
	SEP.b #$30
	RTL

CODE_12A734:
	LDX.b $1D
	JSL.l CODE_item_memory_bit_lookup
	BNE.b CODE_12A748
	LDA.b $12
	AND.w #$00FF
	ORA.w $1DF8
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12A748:
	RTL

CODE_12A749:
	LDX.b $1D
	JSL.l CODE_item_memory_bit_lookup
	BNE.b CODE_12A758
	LDA.w #$A400
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12A758:
	RTL

DATA_12A759:
	db $00,$00,$00,$00,$00,$01,$02,$00,$00,$03,$04,$05,$06,$07,$08,$09
	db $0B,$00,$00,$00,$0C,$07,$08,$0B,$0D,$07,$0E,$0A,$0A,$05,$06,$08
	db $08,$0B,$00,$0D,$03,$04,$06,$0F,$10,$11,$12,$0A,$13,$12,$14,$15
	db $16,$17,$18,$19,$1A,$1B,$13,$1C,$0F,$0B,$07,$0E,$06,$1D,$1E,$16
	db $1F,$06,$08,$20,$1F,$0A,$06,$04,$21,$08,$1F,$0A,$0A,$21,$22,$1F
	db $0A,$0A,$23,$24,$0A,$0A,$0A,$0A,$0A,$05,$0A,$0A,$0A,$0A,$05,$0A
	db $0A,$0A,$0A,$0A,$0A,$0A,$0A,$0A,$0A,$0A,$0A,$25,$0A,$0A,$0A,$0A
	db $0A,$0A,$0A,$0A,$26,$27,$28,$0A,$0A,$29,$2A,$2B,$0A,$2C,$0A,$0A
	db $0A,$26,$27,$28,$2D,$2E,$2F,$0A,$30,$31,$32,$33,$0A,$34,$35,$36
	db $37,$2D,$2E,$2F,$38,$39,$3A,$3B,$3C,$3D,$3E,$3F,$40,$41,$42,$43
	db $44,$38,$39,$3A,$45,$46,$47,$48,$49,$4A,$47,$4B,$4C,$4D,$4E,$4F
	db $50,$51,$52,$53,$54,$55,$56,$57,$53,$54,$55,$56,$57,$58,$53,$59
	db $38,$39,$3A,$3B,$3C,$38,$38,$38,$38,$38,$3D,$3E,$3F,$38,$40,$38
	db $41,$42,$43,$44,$45,$38,$46,$47,$48,$49,$4A,$4B,$4C,$4D,$4E,$38
	db $4F,$50,$51,$52,$53,$54,$55,$45,$56,$57,$58,$59,$5A,$5B,$5C,$5D
	db $5E,$51,$51,$51,$52,$53,$45,$5F,$51,$60,$61,$62,$51,$51,$63,$64

CODE_12A859:
	REP.b #$30
	LDA.b $2C
	TAX
	ASL
	ASL
	ASL
	ASL
	ORA.b $28
	TAY
	LDA.w DATA_12A759,y
	AND.w #$00FF
	CPX.w #$000C
	BCS.b CODE_12A875
	ORA.w #$A500
	BRA.b CODE_12A878

CODE_12A875:
	ORA.w #$9D00
CODE_12A878:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12A881:
	dw $1A46,$1A52,$1A2C,$1A36,$1A04,$1A06,$1A24,$1A26
	dw $19DC,$1A2E,$1A38

DATA_12A897:
	db $00,$06,$01,$07,$0C,$05,$2C,$2D,$06,$08,$2A,$2B,$0B,$00,$06,$08
	db $2A,$2B,$2C,$2D,$01,$07,$0C,$05,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF
	db $09,$0D,$09,$0E,$16,$FF,$17,$04,$09,$0E,$0F,$10,$11,$0D,$09,$0E
	db $0F,$10,$17,$04,$09,$02,$0A,$0D,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF
	db $02,$0A,$02,$12,$13,$03,$18,$19,$02,$12,$13,$03,$14,$15,$02,$12
	db $13,$03,$18,$19,$0D,$09,$02,$0A,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF

DATA_12A8F7:
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$0B,$00,$06,$08,$07,$37
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$0D,$09,$0D,$38
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$02,$0A,$FF
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$36,$09,$0D,$38
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$0D,$09,$FF
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$36,$0A,$0D,$09
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$0D,$09,$0D
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$36,$09,$02,$0A
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF
	db $FF,$2C,$2D,$01,$07,$0C,$05,$0B,$00,$2A,$2B,$2C,$2D,$00,$06,$08
	db $FF,$FF,$FF,$FF,$35,$07,$0C,$37,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$0B
	db $00,$17,$04,$09,$02,$0A,$0D,$09,$0E,$0F,$10,$17,$04,$09,$02,$0A
	db $FF,$FF,$FF,$FF,$FF,$02,$0A,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$11
	db $03,$18,$19,$0D,$09,$02,$0A,$02,$12,$13,$03,$18,$19,$0D,$09,$02
	db $FF,$FF,$FF,$FF,$36,$09,$02,$38,$FF,$FF,$FF,$FF,$FF,$FF,$03,$14
	db $15,$1C,$1D,$1E,$0D,$09,$02,$0A,$0E,$1A,$1B,$1C,$1D,$1E,$0D,$09

CODE_12AA77:
	REP.b #$30
	LDA.b $2C
	ASL
	ASL
	ASL
	ASL
	ASL
	CLC
	ADC.b $28
	TAY
	LDA.b $15
	BNE.b CODE_12AA8D
	LDA.w DATA_12A897,y
	BRA.b CODE_12AA90

CODE_12AA8D:
	LDA.w DATA_12A8F7,y
CODE_12AA90:
	AND.w #$00FF
	CMP.w #$00FF
	BEQ.b CODE_12AAC4
	CMP.w #$002A
	BCS.b CODE_12AAA3
	CLC
	ADC.w #$9D65
	BRA.b CODE_12AABE

CODE_12AAA3:
	CMP.w #$0035
	BCS.b CODE_12AAB6
	SEC
	SBC.w #$002A
	ASL
	TAY
	LDX.w DATA_12A881,y
	LDA.w $0000,x
	BRA.b CODE_12AABE

CODE_12AAB6:
	SEC
	SBC.w #$0035
	CLC
	ADC.w #$A55A
CODE_12AABE:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12AAC4:
	SEP.b #$30
	RTL

DATA_12AAC7:
	dw $0000,$A55E,$A561,$A562

DATA_12AACF:
	dw $0000,$A55F,$A563,$A564

DATA_12AAD7:
	dw $0000,$A560,$A565,$A566

DATA_12AADF:
	dw DATA_12AAC7,DATA_12AACF,DATA_12AAD7

CODE_12AAE5:
	REP.b #$30
	LDX.b $15
	LDA.w DATA_12AADF,x
	STA.b $00
	LDA.b $2C
	ASL
	ORA.b $28
	ASL
	TAY
	LDA.b ($00),y
	BEQ.b CODE_12AAFF
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12AAFF:
	SEP.b #$30
	RTL

CODE_12AB02:
	REP.b #$30
	LDA.b $28
	BEQ.b CODE_12AB17
	INC
	CMP.b $2A
	BEQ.b CODE_12AB12
	LDA.w #$0000
	BRA.b CODE_12AB20

CODE_12AB12:
	LDA.w #$9D9B
	BRA.b CODE_12AB1A

CODE_12AB17:
	LDA.w #$9D9A
CODE_12AB1A:
	CLC
	ADC.b $2C
	CLC
	ADC.b $2C
CODE_12AB20:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12AB29:
	db $CA,$CB,$CF,$D0,$CC,$CD,$CD,$CE,$CD,$CD,$CD,$CD,$CD,$CD,$CD,$CD

CODE_12AB39:
	REP.b #$30
	LDA.b $2C
	ASL
	ASL
	ADC.b $28
	TAY
	LDA.w DATA_12AB29,y
	AND.w #$00FF
	CLC
	ADC.w #$9600
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12AB55:
	RTL

DATA_12AB56:
	dw $015D,$015E,$015F,$0160,$015C

DATA_12AB60:
	dw $015A,$015B

CODE_12AB64:                                 ; Per-cell stamp for the ext-obj $30 castle-wall-hole walker (sole caller: CODE_extobj_handler_castle_wall_hole_2x2): interior cols 1-2 write the 2x2 hole tiles $015D-$0160; edge cols 0/3 overwrite only where the existing tile is the wall-edge tile (DATA_12AB60: $015A left / $015B right), writing $015C, else leave the cell intact.
	REP.b #$30
	LDX.b $1D
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_12AB76
	INC
	CMP.b $2A
	BNE.b CODE_12AB82
	INY
	INY
CODE_12AB76:
	LDA.b $12
	CMP.w DATA_12AB60,y
	BNE.b CODE_12AB96
	LDY.w #$0008
	BRA.b CODE_12AB8F

CODE_12AB82:
	LDA.b $28
	DEC
	ASL
	STA.b $00
	LDA.b $2C
	ASL
	ASL
	ORA.b $00
	TAY
CODE_12AB8F:
	LDA.w DATA_12AB56,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12AB96:
	SEP.b #$30
	RTL

DATA_12AB99:
	dw $00BD,$00BC

CODE_12AB9D:
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	BNE.b CODE_12ABAA
	LDA.w #$00BB
	BRA.b CODE_12ABB2

CODE_12ABAA:
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_12AB99,y
CODE_12ABB2:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12ABB9:
	dw $1C44,$1C4A,$1C4C,$1C4E,$1C50,$1C54,$1C56,$1C58
	dw $1C5A,$1DD8,$1DD8,$1D88,$1D88,$1DDA,$1DDC,$1DDE
	dw $1DE0,$1DE2,$1DE4,$1DE6

CODE_12ABE1:
	REP.b #$30
	LDX.b $1D
	LDA.b $15
	ASL
	TAY
	LDA.w DATA_12ABB9,y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12ABF7:
	dw $5F00,$5F01,$5F03,$5F03

CODE_12ABFF:
	REP.b #$30
	JSL.l CODE_prng
	AND.w #$0003
	ASL
	TAX
	LDA.l DATA_12ABF7,x
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12AC17:
	REP.b #$30
	LDA.b $28
	ASL
	STA.b $00
	LDA.b $2C
	ASL
	ASL
	ASL
	ORA.b $00
	TAY
	BEQ.b CODE_12AC36
	CPY.w #$0006
	BEQ.b CODE_12AC36
	LDX.b $1D
	LDA.w DATA_12AC39,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12AC36:
	SEP.b #$30
	RTL

DATA_12AC39:
	dw $0000,$3D18,$3D19,$0000,$3D1A,$3D1B,$3D1C,$3D1D
	dw $3D1E,$3D26,$3D27,$3D21,$3D22,$6300,$3D28,$3D25

CODE_12AC59:
	REP.b #$30
	LDA.b $28
	ASL
	TAX
	JSR.w (DATA_12AC6B,x)
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12AC6B:
	dw CODE_12AC73
	dw CODE_12AC73
	dw CODE_12AC97
	dw CODE_12AC97

CODE_12AC73:
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_12AC7F
	LDA.w #$00DE
	BRA.b CODE_12AC96

CODE_12AC7F:
	LDA.b $28
	BEQ.b CODE_12AC94
	LDA.b $2C
	CMP.w #$0010
	BCS.b CODE_12AC94
	AND.w #$0001
	BEQ.b CODE_12AC94
	LDA.w #$00E5
	BRA.b CODE_12AC96

CODE_12AC94:
	LDA.b $12
CODE_12AC96:
	RTS

CODE_12AC97:
	LDY.w #$0000
	LDA.b $2C
	BEQ.b CODE_12ACA7
	INY
	INY
	INC
	CMP.b $2E
	BNE.b CODE_12ACA7
	INY
	INY
CODE_12ACA7:
	LDA.b $28
	AND.w #$0001
	STA.b $00
	LDA.w DATA_12ACB5,y
	CLC
	ADC.b $00
	RTS

DATA_12ACB5:
	dw $00DF,$00E1,$00E3

CODE_12ACBB:
	REP.b #$30
	LDA.b $28
	ASL
	TAY
	LDX.b $1D
	LDA.w DATA_12ACCD,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12ACCD:
	dw $3D4D,$3D4E,$3D4F

CODE_12ACD3:
	LDX.b $1D
	LDA.w #$3D4C
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_left
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12ACE8:
	CMP.w #$3D3B
	BEQ.b CODE_12ACF7
	CMP.w #$3D49
	BEQ.b CODE_12ACF7
	CMP.w #$3D4A
	BNE.b CODE_12ACFF
CODE_12ACF7:
	NOP
	LDA.w #$3D3C
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12ACFF:
	RTL

CODE_12AD00:
	LDX.b $1D
	LDA.w #$3D41
CODE_12AD05:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_right
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$3D3B
	BEQ.b CODE_12AD24
	CMP.w #$3D3C
	BEQ.b CODE_12AD24
	CMP.w #$3D49
	BNE.b CODE_12AD2C
CODE_12AD24:
	NOP
	LDA.w #$3D4A
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12AD2C:
	RTL

CODE_12AD2D:
	LDA.w $1D1A
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTL

DATA_12AD37:
	dw $0080,$0081,$014B,$014C

CODE_12AD3F:
	REP.b #$30
	LDA.b $28
	ASL
	STA.b $00
	LDA.b $2C
	ASL
	ASL
	ORA.b $00
	TAY
	LDX.b $1D
	LDA.w DATA_12AD37,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12AD59:
	dw $0082,$014D

CODE_12AD5D:
	REP.b #$30
	LDA.b $2C
	ASL
	TAY
	LDX.b $1D
	LDA.w DATA_12AD59,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12AD6F:
	LDX.b $1D
	LDA.w #$014A
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTL

DATA_12AD79:
	dw $000C,$000D

DATA_12AD7D:
	dw $0013,$0014,$1DC6,$1DC8,$0000,$0000,$000E,$000F
	dw $0011,$0012,$1DCA,$1DCC

DATA_12AD95:
	dw $0025,$0026,$0033,$0034

DATA_12AD9D:
	dw $000C,$000D,$008E,$008F,$0013,$0014

CODE_12ADA9:
	REP.b #$30
	LDY.w #$0000
	LDA.b $28
	ASL
	STA.b $00
	LDA.b $2C
	ASL
	ASL
	ORA.b $00
	ORA.b $15
	TAY
	LDA.b $12
	CMP.w $1C5C
	BEQ.b CODE_12ADD2
	CMP.w $1C5E
	BEQ.b CODE_12ADD2
	CMP.w $1DB4
	BEQ.b CODE_12ADD2
	CMP.w $1DB6
	BNE.b CODE_12ADDB
CODE_12ADD2:
	LDA.w DATA_12AD7D,y
	TAY
	LDA.w $0000,y
	BRA.b CODE_12ADDE

CODE_12ADDB:
	LDA.w DATA_12AD79,y
CODE_12ADDE:
	STA.b $00
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	STA.b $08
endif
	LDY.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CPY.w #$0004
	BNE.b CODE_12ADF7
	LDY.b $2C
	BNE.b CODE_12ADF7
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDY.b $2C
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	TAX
	LDA.b $08
	TXY
	BEQ.b CODE_12ADF7
endif
	SEC
	SBC.w #$000C
	ASL
	TAY
	LDA.w DATA_12AD95,y
	BRA.b CODE_12AE19

CODE_12ADF7:
	CPY.w #$000C
	BNE.b CODE_12AE19
	LDA.b $2C
	ASL
	ORA.b $28
	ASL
	TAY
	CPY.w #$0004
	BCC.b CODE_12AE16
	LDA.b $12
	AND.w #$FF00
	CMP.w #$8500
	BEQ.b CODE_12AE16
	INY
	INY
	INY
	INY
CODE_12AE16:
	LDA.w DATA_12AD9D,y
CODE_12AE19:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12AE22:
	LDX.b $1D
	LDA.w #$0183
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12AE2B:
	RTL

DATA_12AE2C:
	dw $3D63,$3D64,$3D65,$0000,$3D66,$3D67,$3D68,$015C

CODE_12AE3C:
	REP.b #$30
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_12AE4C
	INC
	CMP.b $2A
	BNE.b CODE_12AE58
	INY
	INY
CODE_12AE4C:
	LDA.b $12
	CMP.w DATA_12AB60,y
	BNE.b CODE_12AE6F
	LDY.w #$000E
	BRA.b CODE_12AE66

CODE_12AE58:
	LDA.b $2C
	ASL
	ASL
	ASL
	STA.b $00
	LDA.b $28
	DEC
	ASL
	ORA.b $00
	TAY
CODE_12AE66:
	LDX.b $1D
	LDA.w DATA_12AE2C,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12AE6F:
	SEP.b #$30
	RTL

DATA_12AE72:
	dw $3D63,$3D6C,$3D65,$0000,$3D69,$3D6A,$3D6B,$0000
	dw $8000,$010E,$010F

CODE_12AE88:
	REP.b #$30
	LDY.w #$0000
	LDA.b $28
	BEQ.b CODE_12AE98
	INC
	CMP.b $2A
	BNE.b CODE_12AEA8
	INY
	INY
CODE_12AE98:
	LDA.b $2C
	CMP.w #$0002
	BEQ.b CODE_12AECB
	LDA.b $12
	CMP.w DATA_12AB60,y
	BNE.b CODE_12AECB
	BRA.b CODE_12AEC2

CODE_12AEA8:
	LDA.b $2C
	ASL
	ASL
	ASL
	STA.b $00
	LDA.b $28
	DEC
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_12AE72,y
	BPL.b CODE_12AEC5
	LDA.b $12
	CMP.w #$015A
	BNE.b CODE_12AEC5
CODE_12AEC2:
	LDA.w #$015C
CODE_12AEC5:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12AECB:
	SEP.b #$30
	RTL

DATA_12AECE:
	dw $0000,$0000,$3DA1,$3D79,$3D77,$3DA2,$3D7A,$3DA0
	dw $0000

DATA_12AEE0:
	dw $3DA4,$0000,$0000,$3DA3,$3D78,$3D7C,$0000,$3D9F
	dw $3D7B

DATA_12AEF2:
	dw DATA_12AECE,DATA_12AEE0

CODE_12AEF6:
	REP.b #$30
	LDX.b $15
	LDA.b $2C
	ASL
	ADC.b $2C
	ASL
	ADC.w DATA_12AEF2,x
	STA.b $00
	JMP.w CODE_12AFCE

DATA_12AF08:
	dw $3D8F,$3D90,$3D91,$3D92,$0000,$3D93,$3D94,$3D95
	dw $3D96,$3D7C,$0000,$3D8C,$3D8D,$3D8E,$3D7B

DATA_12AF26:
	dw $0000,$3D81,$3D82,$3D83,$3D84,$3D79,$3D85,$3D86
	dw $3D87,$3D88,$3D7A,$3D89,$3D8A,$3D8B

DATA_12AF42:
	dw $0000

DATA_12AF44:
	dw DATA_12AF08,DATA_12AF26

CODE_12AF48:
	REP.b #$30
	LDX.b $15
	LDA.b $2C
	ASL
	ASL
	ADC.b $2C
	ASL
	ADC.w DATA_12AF44,x
	STA.b $00
	BRA.b CODE_12AFCE

DATA_12AF5A:
	dw $0000,$3D80,$3DA6,$0000,$3D7F,$0000

DATA_12AF66:
	dw $0000,$3D79,$3D73,$0000,$3D7A,$3DA0

DATA_12AF72:
	dw $3D9D,$3D9E,$0000,$3D9B,$3D9C,$3D72

DATA_12AF7E:
	dw DATA_12AF5A,DATA_12AF66,DATA_12AF72

CODE_12AF84:
	REP.b #$30
	LDX.b $15
	LDA.b $2C
	ASL
	ADC.b $2C
	ASL
	ADC.w DATA_12AF7E,x
	STA.b $00
	BRA.b CODE_12AFCE

DATA_12AF95:
	dw $3DA5,$3D7D,$0000,$0000,$3D7E,$0000

DATA_12AFA1:
	dw $3D74,$3D7C,$0000,$3D9F,$3D7B,$0000

DATA_12AFAD:
	dw $0000,$3D97,$3D98,$3D71,$3D99,$3D9A

DATA_12AFB9:
	dw DATA_12AF95,DATA_12AFA1,DATA_12AFAD

CODE_12AFBF:
	REP.b #$30
	LDX.b $15
	LDA.b $2C
	ASL
	ADC.b $2C
	ASL
	ADC.w DATA_12AFB9,X
	STA.b $00
CODE_12AFCE:
	LDA.b $28
	ASL
	TAY
	LDA.b ($00),y
	BEQ.b CODE_12AFFE
	TAY
	CMP.w #$3D9F
	BEQ.b CODE_12AFED
	CMP.w #$3DA0
	BNE.b CODE_12AFF8
	LDA.b $12
	CMP.w #$3D71
	BNE.b CODE_12AFF7
	LDA.w #$3DA8
	BRA.b CODE_12AFF8

CODE_12AFED:
	LDA.b $12
	CMP.w #$3D72
	BNE.b CODE_12AFF7
	LDY.w #$3DA9
CODE_12AFF7:
	TYA
CODE_12AFF8:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12AFFE:
	SEP.b #$30
	RTL

CODE_12B001:
	LDX.b $1D
	LDA.w #$7502
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTL

DATA_12B00B:
	dw $01A7

DATA_12B00D:
	dw $01A8

DATA_12B00F:
	dw $01A9

DATA_12B011:
	dw $01AA

DATA_12B013:
	dw $01AB

DATA_12B015:
	dw $01AC

DATA_12B017:
	dw $01AD

DATA_12B019:
	dw $01AE

DATA_12B01B:
	dw $01AF

DATA_12B01D:
	dw $01B0

DATA_12B01F:
	dw $01B1

DATA_12B021:
	dw $01B2

DATA_12B023:
	dw $01B3

DATA_12B025:
	dw $01B4

DATA_12B027:
	dw $01B5

DATA_12B029:
	dw $01B6

DATA_12B02B:
	dw $19DC
	dw $1A44
	dw $1A52
	dw $0000
	dw $19E6
	dw DATA_12B00D
	dw DATA_12B01D
	dw $1A1A

DATA_12B03B:
	dw $0000
	dw $1A04
	dw $1A44
	dw $1A52
	dw $0000
	dw $19DC
	dw DATA_12B01F
	dw DATA_12B021
	dw DATA_12B023
	dw $19F0
	dw $19E6
	dw DATA_12B025
	dw DATA_12B027
	dw DATA_12B029
	dw $19FA

DATA_12B059:
	dw $19DC
	dw DATA_12B00B
	dw $1A18
	dw $19E6
	dw DATA_12B00D
	dw DATA_12B00F

DATA_12B065:
	dw $19DC
	dw DATA_12B00B
	dw $19F0
	dw $19E6
	dw DATA_12B00D
	dw $19F8

DATA_12B071:
	dw $0000
	dw $19DC
	dw $1A44
	dw $1A52
	dw $0000
	dw $0000
	dw $19E4
	dw DATA_12B011
	dw DATA_12B013
	dw $0000
	dw $19DC
	dw DATA_12B01F
	dw DATA_12B021
	dw DATA_12B015
	dw $19F0
	dw $19E6
	dw DATA_12B025
	dw DATA_12B027
	dw DATA_12B017
	dw $19FA

DATA_12B099:
	dw $0000
	dw $19DC
	dw DATA_12B00B
	dw $1A18
	dw $0000
	dw $0000
	dw $19E4
	dw DATA_12B011
	dw DATA_12B013
	dw $0000
	dw $19DC
	dw DATA_12B01F
	dw DATA_12B021
	dw DATA_12B015
	dw $19F0
	dw $19E6
	dw DATA_12B025
	dw DATA_12B027
	dw DATA_12B017
	dw $19FA

DATA_12B0C1:
	dw $0000
	dw $1A04
	dw $1A18
	dw $0000
	dw $19DC
	dw DATA_12B01F
	dw DATA_12B023
	dw $19F0
	dw $19E6
	dw DATA_12B019
	dw DATA_12B029
	dw $19FA

DATA_12B0D9:
	dw $19DC
	dw $1A18
	dw $19E6
	dw DATA_12B00F

DATA_12B0E1:
	dw DATA_12B02B,DATA_12B03B,DATA_12B059,DATA_12B065,DATA_12B071,DATA_12B099,DATA_12B0C1,DATA_12B0D9

DATA_12B0F1:
	dw $0008,$000A,$0006,$0006,$000A,$000A,$0008,$0004

CODE_12B101:
	REP.b #$30
	LDY.b $2C
	LDX.b $15
	LDA.w DATA_12B0E1,x
CODE_12B10A:
	DEY
	BMI.b CODE_12B113
	CLC
	ADC.w DATA_12B0F1,x
	BRA.b CODE_12B10A

CODE_12B113:
	STA.b $00
	LDA.b $28
	ASL
	TAY
	LDX.b $1D
	LDA.b ($00),y
	BEQ.b CODE_12B127
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12B127:
	SEP.b #$30
	RTL

DATA_12B12A:
	dw $3DBD

DATA_12B12C:
	dw $3DC0

DATA_12B12E:
	dw $1A06,$1A1E,$1A2C,$1A56,DATA_12B12A,DATA_12B12C

DATA_12B13A:
	dw $3DCC

DATA_12B13C:
	dw $3DCD

DATA_12B13E:
	dw $1A08,$1A1C,$1A2E,$1A54,DATA_12B13A,DATA_12B13C

CODE_12B14A:
	REP.b #$30
	LDY.w #$0000
CODE_12B14F:
	LDA.w DATA_12B12E,y
	PHY
	TAY
	LDA.w $0000,y
	PLY
	CMP.b $12
	BEQ.b CODE_12B165
	INY
	INY
	CPY.w #$0010
	BCC.b CODE_12B14F
	BRA.b CODE_12B172

CODE_12B165:
	LDX.b $1D
	LDA.w DATA_12B13E,y
	TAY
	LDA.w $0000,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12B172:
	SEP.b #$30
	RTL

DATA_12B175:
	dw $775E,$775F

CODE_12B179:
	REP.b #$30
	LDX.b $1D
	LDA.b $15
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_12B175,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12B18E:
	dw CODE_12B1BF
	dw CODE_12B1DB
	dw CODE_12B203

CODE_12B194:
	REP.b #$30
	LDA.b $28
	ASL
	STA.b $00
	LDA.b $2C
	ASL
	ASL
	ASL
	ORA.b $00
	TAY
	LDX.b $15
	JSR.w (DATA_12B18E,x)
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12B1B1:
	dw $776A,$776B,$776C,$0000,$01CB,$01D0,$01CF

CODE_12B1BF:
	LDA.w DATA_12B1B1,y
	RTS

DATA_12B1C3:
	dw $7760,$7761,$7763,$7764,$7765,$7766,$7768,$7769
	dw $01CB,$01CC,$01CE,$01CF

CODE_12B1DB:
	LDA.w DATA_12B1C3,y
	RTS

DATA_12B1DF:
	dw $7760,$7761,$7762,$7763,$7764,$7765,$7766,$7767
	dw $7768,$7769,$01CB,$01CC,$01CD,$01CE,$01CF

DATA_12B1FD:
	dw $0000,$000A,$0014

CODE_12B203:
	LDA.b $2C
	ASL
	TAY
	LDA.w DATA_12B1FD,y
	CLC
	ADC.b $00
	TAY
	LDA.w DATA_12B1DF,y
	RTS

DATA_12B212:
	dw $7D14,$7D18,$7D0C,$7D10

CODE_12B21A:
	REP.b #$30
	LDX.b $1D
	LDY.b $15
	LDA.b $2C
	ASL
	ORA.b $28
	CLC
	ADC.w DATA_12B212,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12B230:
	dw $791E,$0A2F,$77BB,$77BA,$082D,$791D

CODE_12B23C:
	REP.b #$30
	LDA.b $28
	ASL
	TAY
	LDA.w DATA_12B230,y
CODE_12B245:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12B24E:
	dw $792E,$5D09,$77B9,$77CC,$5B0D,$792D

CODE_12B25A:
	REP.b #$30
	LDA.b $28
	ASL
	TAY
	LDA.w DATA_12B24E,y
	BRA.b CODE_12B245

DATA_12B265:
	dw $792D,$5B0C,$77C9,$77BA,$082D,$791D

CODE_12B271:
	REP.b #$30
	LDA.b $2C
	ASL
	TAY
	LDA.w DATA_12B265,y
	BRA.b CODE_12B245

DATA_12B27C:
	dw $792E,$5D09,$77B9,$77CA,$0A2E,$791E

CODE_12B288:
	REP.b #$30
	LDA.b $2C
	ASL
	TAY
	LDA.w DATA_12B27C,y
	BRA.b CODE_12B245

DATA_12B293:
	dw $7917,$77B1,$77B4,$7927,$7918,$0000,$0000,$7928

CODE_12B2A3:
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	ASL
	ASL
	ORA.b $2C
	ASL
	TAY
	LDA.w DATA_12B293,y
CODE_12B2B2:
	BEQ.b CODE_12B2B8
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12B2B8:
	SEP.b #$30
	RTL

DATA_12B2BB:
	dw $7919,$0000,$0000,$7929,$791A,$77B5,$77B8,$792A

CODE_12B2CB:
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	ASL
	ASL
	ORA.b $2C
	ASL
	TAY
	LDA.w DATA_12B2BB,y
	BRA.b CODE_12B2B2

DATA_12B2DC:
	dw $7917,$77B1,$77B2,$77B3,$77B4,$7927,$0000,$0000
	dw $7918,$0000,$0000,$0000,$0000,$7928

CODE_12B2F8:
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	ASL
	ASL
	ASL
	ORA.b $2C
	ASL
	TAY
	LDA.w DATA_12B2DC,y
	BRA.b CODE_12B2B2

DATA_12B30A:
	dw $7919,$0000,$0000,$0000,$0000,$7929,$0000,$0000
	dw $791A,$77B5,$77B6,$77B7,$77B8,$792A

CODE_12B326:
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	ASL
	ASL
	ASL
	ORA.b $2C
	ASL
	TAY
	LDA.w DATA_12B30A,y
	JMP.w CODE_12B2B2

DATA_12B339:
	dw $7911,$7921,$77A1,$0000,$77A4,$0000,$7912,$7922

CODE_12B349:
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	ASL
	ORA.b $2C
	ASL
	TAY
	LDA.w DATA_12B339,y
	JMP.w CODE_12B2B2

DATA_12B35A:
	dw $7913,$7923,$0000,$77A5,$0000,$77A8,$7914,$7924

CODE_12B36A:
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	ASL
	ORA.b $2C
	ASL
	TAY
	LDA.w DATA_12B35A,y
	JMP.w CODE_12B2B2

DATA_12B37B:
	dw $7911,$7921,$77A1,$0000,$77A2,$0000,$77A3,$0000
	dw $77A4,$0000,$7912,$7922

CODE_12B393:
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	ASL
	ORA.b $2C
	ASL
	TAY
	LDA.w DATA_12B37B,y
	JMP.w CODE_12B2B2

DATA_12B3A4:
	dw $7913,$7923,$0000,$77A5,$0000,$77A6,$0000,$77A7
	dw $0000,$77A8,$7914,$7924

CODE_12B3BC:
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	ASL
	ORA.b $2C
	ASL
	TAY
	LDA.w DATA_12B3A4,y
	JMP.w CODE_12B2B2

DATA_12B3CD:
	dw $77C6,$77C7

CODE_12B3D1:
	REP.b #$30
	LDA.b $28
	ASL
	TAY
	LDA.w DATA_12B3CD,y
	JMP.w CODE_12B245

DATA_12B3DD:
	dw $77BB,$77CC

CODE_12B3E1:
	REP.b #$30
	LDX.b $1D
	LDY.b $15
	LDA.w DATA_12B3DD,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12B3F1:
	LDX.b $1D
	LDA.w #$0010
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTL

CODE_12B3FB:
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	CLC
	ADC.w #$6F00
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12B40C:
	dw $8400,$8401,$8402,$8403,$8401,$8402,$8404,$8405
	dw $840C,$840D,$840E,$840F,$840E,$840D,$8411,$8412
	dw $8406,$8407,$8406,$8407,$8406,$8407,$8406,$8407
	dw $8408,$8409,$840A,$840B,$8408,$8409,$840A,$840B
	dw $840A,$840B,$840A,$840B,$8408,$8409,$8408,$8409

CODE_12B45C:
	REP.b #$30
	LDX.b $1D
	LDA.b $28
	ASL
	STA.b $00
	LDA.b $2C
	ASL
	ASL
	ASL
	ASL
	ORA.b $00
	TAY
	LDA.w DATA_12B40C,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12B478:
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$02,$03,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$04,$05,$06,$07,$08,$09
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$13,$14,$21,$21,$21,$21,$19
	db $1A,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$20,$14,$21,$21,$21,$21,$21,$21
	db $19,$27,$00,$04,$05,$08,$09,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$13,$01,$1A,$2D,$21,$21,$21,$A6,$A5,$21,$21
	db $21,$32,$13,$14,$21,$21,$19,$27,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$04,$05,$14,$21,$21,$21,$21,$DD,$DF,$DA,$D8,$E1,$E3
	db $21,$19,$14,$21,$21,$21,$21,$32,$04,$05,$01,$08,$09,$00,$00,$00
	db $00,$00,$13,$14,$A4,$21,$21,$21,$21,$D1,$21,$21,$21,$21,$21,$21
	db $D3,$21,$21,$21,$21,$21,$21,$19,$14,$21,$21,$21,$19,$27,$00,$00
	db $00,$20,$DC,$DF,$D8,$E1,$E3,$DD,$DF,$21,$21,$21,$21,$21,$21,$21
	db $21,$E1,$E3,$A6,$A4,$DD,$DF,$E1,$E3,$A6,$A5,$21,$21,$32,$00,$00
	db $00,$D0,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21
	db $21,$21,$21,$DA,$DB,$21,$21,$21,$21,$D8,$DA,$E1,$E3,$19,$1A,$00
	db $38,$39,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21
	db $21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$DA,$D4,$43
	db $48,$49,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21
	db $21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$52,$53
	db $57,$58,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21
	db $21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$61,$62
	db $00,$68,$69,$6A,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21
	db $21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$6F,$70,$71,$00
	db $00,$77,$78,$46,$7A,$7B,$4A,$21,$21,$21,$21,$21,$21,$21,$21,$21
	db $21,$21,$21,$4D,$5F,$21,$21,$21,$21,$21,$6F,$7D,$6C,$8F,$80,$00
	db $00,$00,$95,$96,$78,$76,$3B,$6A,$6F,$7B,$4A,$21,$21,$21,$21,$21
	db $21,$21,$21,$4C,$60,$21,$21,$21,$21,$4E,$26,$6C,$51,$64,$00,$00
	db $00,$00,$00,$00,$63,$88,$79,$25,$26,$81,$60,$21,$21,$21,$21,$21
	db $21,$21,$4E,$36,$5C,$7A,$7B,$7C,$7D,$26,$6C,$51,$8C,$80,$00,$00
	db $00,$00,$00,$00,$77,$17,$6D,$88,$89,$7F,$73,$5E,$21,$21,$21,$21
	db $6F,$7D,$26,$72,$55,$79,$6C,$6C,$6C,$7E,$83,$99,$9A,$00,$00,$00
	db $00,$00,$00,$00,$00,$95,$96,$94,$99,$9A,$68,$76,$7A,$7B,$7C,$7D
	db $26,$6C,$7E,$71,$67,$6D,$88,$89,$8B,$6E,$64,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$77,$78,$79,$5A,$5A,$5A
	db $7E,$3C,$8C,$80,$77,$17,$6B,$6B,$6B,$18,$80,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$86,$87,$88,$89,$8B
	db $6E,$18,$8D,$00,$00,$95,$96,$94,$99,$9A,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$95,$96,$97,$98
	db $99,$9A,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$40,$41
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00

DATA_12B738:
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$02,$03,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$04,$05,$06,$07,$08
	db $09,$00,$00,$00,$00,$00,$00,$00,$00,$00,$02,$03,$00,$20,$14,$21
	db $A6,$A5,$21,$19,$27,$00,$9C,$00,$00,$00,$00,$9C,$13,$06,$07,$1A
	db $2D,$DD,$DF,$DA,$D8,$E1,$E3,$32,$13,$01,$1A,$00,$00,$13,$01,$DC
	db $E3,$DD,$E0,$D9,$21,$21,$21,$21,$21,$21,$D7,$DC,$E3,$52,$53,$48
	db $DE,$DF,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21,$21
	db $D5,$62,$00,$3E,$2C,$21,$21,$21,$21,$21,$21,$21,$21,$21,$4E,$5E
	db $4E,$7A,$7D,$90,$1C,$00,$57,$58,$21,$21,$21,$4B,$70,$69,$7D,$7A
	db $7D,$51,$88,$7F,$82,$8B,$8C,$80,$00,$00,$68,$69,$7D,$7A,$45,$7F
	db $78,$8B,$88,$8B,$8C,$99,$9A,$86,$94,$8D,$00,$00,$00,$77,$78,$89
	db $8B,$8C,$8D,$86,$97,$98,$99,$9A,$00,$00,$00,$9B,$00,$00,$00,$00
	db $00,$95,$96,$99,$9A,$00,$00,$40,$41,$00,$00,$00,$00,$00,$00,$00
	db $00

DATA_12B809:
	db $00,$00,$00,$00,$9C,$9C,$00,$00,$00,$00,$00,$00,$02,$13,$01,$A2
	db $1A,$9C,$00,$00,$00,$13,$06,$DC,$DF,$D8,$D7,$01,$1A,$00,$48,$D2
	db $D8,$21,$21,$21,$21,$E1,$E5,$53,$00,$3E,$74,$21,$21,$4B,$7B,$24
	db $91,$1C,$00,$00,$3E,$74,$7B,$24,$34,$17,$18,$80,$00,$00,$00,$95
	db $93,$99,$9A,$95,$9A,$00

DATA_12B84F:
	db $00,$00,$00,$00,$00,$9C,$00,$00,$00,$00,$02,$03,$13,$01,$1A,$00
	db $00,$13,$06,$A1,$14,$21,$52,$53,$48,$DE,$DF,$D8,$D8,$E1,$E7,$62
	db $00,$3E,$84,$21,$6F,$7D,$90,$1C,$00,$00,$3E,$92,$10,$8B,$8C,$80
	db $00,$00,$00,$95,$96,$99,$9A,$00

DATA_12B887:
	db $00,$00,$00,$00,$00,$9C,$00,$00,$9C,$00,$00,$00,$00,$00,$00,$02
	db $03,$13,$01,$1A,$13,$01,$1A,$00,$00,$00,$00,$13,$06,$07,$DC,$DF
	db $D3,$DC,$E3,$19,$1A,$2A,$1E,$48,$D2,$D8,$DA,$21,$21,$21,$21,$21
	db $D8,$E2,$E6,$2B,$00,$3E,$84,$21,$21,$4E,$7A,$6A,$6F,$7D,$22,$90
	db $D6,$00,$00,$3E,$74,$7D,$45,$7F,$82,$89,$8B,$8C,$17,$56,$00,$00
	db $00,$95,$93,$0B,$9A,$86,$97,$98,$8D,$95,$9A,$00,$00,$00,$00,$00
	db $00,$00,$00,$40,$41,$00,$00,$00

DATA_12B8EF:
	dw DATA_12B478,DATA_12B738,DATA_12B809,DATA_12B84F,DATA_12B887

DATA_12B8F9:
	dw $0020,$0013,$000A,$0008,$000D

DATA_12B903:
	dw $1A02,$1A04,$1A06,$1A16,$1A18,$1A1A,$1A1C,$1A1E
	dw $1C7A,$1C7C,$1C7E,$1C80,$1A2A,$1A2C,$1A2E,$1A34
	dw $1A36,$1A42,$1A44,$1A50,$1A52,$1A54,$1A56,$1A58

CODE_12B933:
	REP.b #$30
	LDY.b $15
	LDA.w DATA_12B8EF,y
	LDX.b $2C
CODE_12B93C:
	DEX
	BMI.b CODE_12B945
	CLC
	ADC.w DATA_12B8F9,y
	BRA.b CODE_12B93C

CODE_12B945:
	CLC
	ADC.b $28
	STA.b $00
	LDA.b ($00)
	AND.w #$00FF
	BEQ.b CODE_12B970
	CMP.w #$00D0
	BCC.b CODE_12B965
	SEC
	SBC.w #$00D0
	ASL
	TAY
	LDA.w DATA_12B903,y
	TAY
	LDA.w $0000,y
	BRA.b CODE_12B96A

CODE_12B965:
	DEC
	CLC
	ADC.w #$8414
CODE_12B96A:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12B970:
	SEP.b #$30
	RTL

DATA_12B973:
	dw CODE_12B9E0
	dw CODE_12BA36
	dw CODE_12BA74
	dw CODE_12BAB2

CODE_12B97B:
	REP.b #$30
	STZ.b $04
	LDA.b $12
	AND.w #$FF00
	CMP.w #$8500
	BNE.b CODE_12B995
	LDA.b $12
	SEC
	SBC.w #$854B
	STA.b $02
	INC.b $04
	BRA.b CODE_12B9A0

CODE_12B995:
	LDA.b $12
	SEC
	SBC.w #$7799
	AND.w #$00FE
	STA.b $02
CODE_12B9A0:
	LDA.b $28
	ASL
	TAY
	LDA.b $2C
	ASL
	TAX
	JSR.w (DATA_12B973,x)
	LDA.b $00
	BEQ.b CODE_12B9B5
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12B9B5:
	SEP.b #$30
	RTL

DATA_12B9B8:
	dw $0000,$8500,$8503,$0000

DATA_12B9C0:
	dw $0000,$857A,$857E,$0000

DATA_12B9C8:
	dw $0002,$0001,$0000,$0002,$0000,$0000,$0000,$0000
	dw $0000,$0001,$0000,$0000

CODE_12B9E0:
	LDA.b $04
	BEQ.b CODE_12B9EE
	LDA.w DATA_12B9C0,y
	BEQ.b CODE_12BA0B
	CLC
	ADC.b $02
	BRA.b CODE_12BA0B

CODE_12B9EE:
	LDA.w DATA_12B9B8,y
	STA.b $00
	BEQ.b CODE_12BA0D
	LDA.b $12
	AND.w #$FF00
	CMP.w #$7900
	BNE.b CODE_12BA03
	STZ.b $00
	BRA.b CODE_12BA0D

CODE_12BA03:
	LDY.b $02
	LDA.b $00
	CLC
	ADC.w DATA_12B9C8,y
CODE_12BA0B:
	STA.b $00
CODE_12BA0D:
	RTS

DATA_12BA0E:
	dw $8506,$77EC,$77ED,$850A

DATA_12BA16:
	dw $8582,$77EC,$77ED,$8586

DATA_12BA1E:
	dw $0002,$0001,$0000,$0002,$0000,$0000,$0000,$0000
	dw $0003,$0001,$0000,$0003

CODE_12BA36:
	LDA.b $04
	BEQ.b CODE_12BA4C
	LDA.w DATA_12BA16,y
	CPY.w #$0002
	BEQ.b CODE_12BA61
	CPY.w #$0004
	BEQ.b CODE_12BA61
	CLC
	ADC.b $02
	BRA.b CODE_12BA61

CODE_12BA4C:
	LDA.w DATA_12BA0E,y
	STA.b $00
	TYA
	BEQ.b CODE_12BA59
	CMP.w #$0006
	BNE.b CODE_12BA63
CODE_12BA59:
	LDY.b $02
	LDA.b $00
	CLC
	ADC.w DATA_12BA1E,y
CODE_12BA61:
	STA.b $00
CODE_12BA63:
	RTS

DATA_12BA64:
	dw $850E,$1800,$77EE,$8512

DATA_12BA6C:
	dw $858A,$1800,$77EE,$858E

CODE_12BA74:
	LDA.b $04
	BEQ.b CODE_12BA8A
	LDA.w DATA_12BA6C,y
	CPY.w #$0002
	BEQ.b CODE_12BA9F
	CPY.w #$0004
	BEQ.b CODE_12BA9F
	CLC
	ADC.b $02
	BRA.b CODE_12BA9F

CODE_12BA8A:
	LDA.w DATA_12BA64,y
	STA.b $00
	TYA
	BEQ.b CODE_12BA97
	CMP.w #$0006
	BNE.b CODE_12BAA1
CODE_12BA97:
	LDY.b $02
	LDA.b $00
	CLC
	ADC.w DATA_12BA1E,y
CODE_12BA9F:
	STA.b $00
CODE_12BAA1:
	RTS

DATA_12BAA2:
	dw $0000,$8516,$8519,$0000

DATA_12BAAA:
	dw $0000,$8592,$8596,$0000

CODE_12BAB2:
	LDA.b $04
	BEQ.b CODE_12BAC0
	LDA.w DATA_12BAAA,y
	BEQ.b CODE_12BAE2
	CLC
	ADC.b $02
	BRA.b CODE_12BAE2

CODE_12BAC0:
	LDA.w DATA_12BAA2,y
	STA.b $00
	BEQ.b CODE_12BAE4
	LDA.b $12
	AND.w #$FF00
	CMP.w #$1500
	BEQ.b CODE_12BAD6
	CMP.w #$7900
	BNE.b CODE_12BADA
CODE_12BAD6:
	STZ.b $00
	BRA.b CODE_12BAE4

CODE_12BADA:
	LDY.b $02
	LDA.b $00
	CLC
	ADC.w DATA_12B9C8,y
CODE_12BAE2:
	STA.b $00
CODE_12BAE4:
	RTS

DATA_12BAE5:
	dw $851B,$8523

DATA_12BAE9:
	dw $8521,$8529

CODE_12BAED:
	REP.b #$30
	LDX.b $1D
	LDY.b $15
	LDA.b $12
	SEC
	SBC.w #$77A9
	AND.w #$000E
	STA.b $00
	CLC
	ADC.w DATA_12BAE5,y
	CLC
	ADC.b $28
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $00
	BNE.b CODE_12BB1F
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.w DATA_12BAE9,y
	CLC
	ADC.b $28
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12BB1F:
	SEP.b #$30
	RTL

DATA_12BB22:
	dw $852B,$8533

DATA_12BB26:
	dw $8531,$8539

CODE_12BB2A:
	REP.b #$30
	LDX.b $1D
	LDY.b $15
	LDA.b $12
	SEC
	SBC.w #$7799
	AND.w #$000E
	STA.b $00
	CLC
	ADC.w DATA_12BB22,y
	CLC
	ADC.b $2C
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $00
	BNE.b CODE_12BB5C
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_right
	LDA.w DATA_12BB26,y
	CLC
	ADC.b $2C
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12BB5C:
	SEP.b #$30
	RTL

DATA_12BB5F:
	dw CODE_12BB82
	dw CODE_12BBC0

CODE_12BB63:
	REP.b #$30
	LDX.b $1D
	LDA.b $12
	SEC
	SBC.w $1CD0
	AND.w #$0001
	TAY
	CLC
	ADC.w $1D0E
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	TYA
	ASL
	TAX
	JSR.w (DATA_12BB5F,x)
	SEP.b #$30
	RTL

CODE_12BB82:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.w $1C66
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_left
	LDA.w #$0000
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	AND.w #$70F0
	STA.b $00
	LDA.b $1B
	AND.w #$0F0F
	DEC
	AND.w #$0F0F
	ORA.b $00
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.w #$0000
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

CODE_12BBC0:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.w $1C60
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_right
	LDA.w #$0000
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	AND.w #$70F0
	STA.b $00
	LDA.b $1B
	AND.w #$0F0F
	ORA.w #$00F0
	INC
	AND.w #$0F0F
	ORA.b $00
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.w #$0000
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTS

CODE_12BC01:
	REP.b #$30
	LDX.b $1D
	LDA.w #$8710
	CLC
	ADC.b $15
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12BC12:
	dw $1514,$0018

DATA_12BC16:
	dw $1716,$1900

DATA_12BC1A:
	dw $001E,$1B1A

DATA_12BC1E:
	dw $1F00,$1D1C

DATA_12BC22:
	dw DATA_12BC12,DATA_12BC16,DATA_12BC1A,DATA_12BC1E

CODE_12BC2A:
	REP.b #$30
	LDY.b $15
	LDA.w DATA_12BC22,y
	STA.b $00
	LDA.b $2C
	ASL
	ADC.b $28
	TAY
	LDA.b ($00),y
	AND.w #$00FF
	BEQ.b CODE_12BC4A
	CLC
	ADC.w #$8700
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12BC4A:
	SEP.b #$30
	RTL

DATA_12BC4D:
	dw $0000,$0000,$2120,$2322,$0000,$2524,$0026,$0000
	dw $2700,$0028,$0000,$0000,$2900,$0000,$0000,$0000
	dw $2B2A,$0000,$0000,$0000,$002C,$0000,$0000,$0000
	dw $002D,$0000,$0000,$0000,$002E,$0000,$0000,$0000

DATA_12BC8D:
	dw $4C4B,$4E4D,$0000,$0000,$0000,$4800,$4A49,$0000
	dw $0000,$0000,$4600,$0047,$0000,$0000,$0000,$0045
	dw $0000,$0000,$0000,$4443,$0000,$0000,$0000,$4200
	dw $0000,$0000,$0000,$4100,$0000,$0000,$0000,$4000

DATA_12BCCD:
	dw $003E,$0000,$0000,$0000,$003D,$0000,$0000,$0000
	dw $003C,$0000,$0000,$0000,$3B3A,$0000,$0000,$0000
	dw $3900,$0000,$0000,$0000,$3700,$0038,$0000,$0000
	dw $0000,$3534,$0036,$0000,$0000,$0000,$3130,$3332

DATA_12BD0D:
	dw $0000,$0000,$0000,$5000,$0000,$0000,$0000,$5100
	dw $0000,$0000,$0000,$5200,$0000,$0000,$0000,$5453
	dw $0000,$0000,$0000,$0055,$0000,$0000,$5600,$0057
	dw $0000,$5800,$5A59,$0000,$5C5B,$5E5D,$0000,$0000

DATA_12BD4D:
	dw DATA_12BC4D,DATA_12BC8D,DATA_12BCCD,DATA_12BD0D

CODE_12BD55:
	REP.b #$30
	LDY.b $15
	LDA.w DATA_12BD4D,y
	STA.b $00
	LDA.b $2C
	ASL
	ASL
	ASL
	ADC.b $28
	TAY
	LDA.b ($00),y
	AND.w #$00FF
	BEQ.b CODE_12BD77
	CLC
	ADC.w #$8700
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12BD77:
	SEP.b #$30
	RTL

DATA_12BD7A:
	dw $872F,$873F,$874F,$875F

DATA_12BD82:
	dw $0006,$0007,$0008,$0009

DATA_12BD8A:
	dw CODE_12BDB2
	dw CODE_12BDB7

CODE_12BD8E:
	REP.b #$30
	LDX.b $1D
	LDY.b $15
	LDA.w DATA_12BD7A,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	TYA
	LSR
	AND.w #$0002
	TAX
	LDA.b $1B
	STA.b $0E
	JSR.w (DATA_12BD8A,x)
	LDA.w DATA_12BD82,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12BDB2:
	JSL.l CODE_get_map16_above
	RTS

CODE_12BDB7:
	JSL.l CODE_get_map16_left
	RTS

DATA_12BDBC:
	dw $8562,$8566

CODE_12BDC0:
	REP.b #$30
	LDX.b $1D
	LDY.b $15
	LDA.b $12
	SEC
	SBC.w #$854B
	CLC
	ADC.w DATA_12BDBC,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.b $15
	LSR
	CLC
	ADC.w #$8104
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12BDEA:
	REP.b #$30
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$7942
	BEQ.b CODE_12BE02
	CMP.w #$7943
	BNE.b CODE_12BE09
CODE_12BE02:
	INC
	INC
	INC
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12BE09:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_left
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$7944
	BEQ.b CODE_12BE29
	CMP.w #$7946
	BEQ.b CODE_12BE2A
	CMP.w #$794D
	BEQ.b CODE_12BE2A
	CMP.w #$794B
	BNE.b CODE_12BE31
CODE_12BE29:
	INC
CODE_12BE2A:
	INC
	INC
	INC
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12BE31:
	LDA.b $2C
	ASL
	ORA.b $28
	ADC.w #$7970
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12BE42:
	REP.b #$30
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$7948
	BEQ.b CODE_12BE5A
	CMP.w #$7949
	BNE.b CODE_12BE61
CODE_12BE5A:
	INC
	INC
	INC
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12BE61:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_right
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$7955
	BEQ.b CODE_12BE81
	CMP.w #$7957
	BEQ.b CODE_12BE82
	CMP.w #$795E
	BEQ.b CODE_12BE82
	CMP.w #$795C
	BNE.b CODE_12BE88
CODE_12BE81:
	INC
CODE_12BE82:
	INC
	INC
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12BE88:
	LDA.b $2C
	ASL
	ORA.b $28
	ADC.w #$7974
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12BE99:
	REP.b #$30
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$793D
	BEQ.b CODE_12BEB1
	CMP.w #$793E
	BNE.b CODE_12BEB8
CODE_12BEB1:
	INC
	INC
	INC
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12BEB8:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_left
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$7962
	BEQ.b CODE_12BED8
	CMP.w #$7964
	BEQ.b CODE_12BED9
	CMP.w #$796B
	BEQ.b CODE_12BED9
	CMP.w #$7969
	BNE.b CODE_12BEE0
CODE_12BED8:
	INC
CODE_12BED9:
	INC
	INC
	INC
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12BEE0:
	LDA.b $2C
	ASL
	ORA.b $28
	ADC.w #$7978
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12BEF1:
	REP.b #$30
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$794F
	BEQ.b CODE_12BF09
	CMP.w #$7950
	BNE.b CODE_12BF0F
CODE_12BF09:
	INC
	INC
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12BF0F:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_right
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$7963
	BEQ.b CODE_12BF2F
	CMP.w #$7965
	BEQ.b CODE_12BF30
	CMP.w #$796C
	BEQ.b CODE_12BF30
	CMP.w #$796A
	BNE.b CODE_12BF36
CODE_12BF2F:
	INC
CODE_12BF30:
	INC
	INC
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12BF36:
	LDA.b $2C
	ASL
	ORA.b $28
	ADC.w #$797C
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12BF47:
	dw $000A,$8800

CODE_12BF4B:
	REP.b #$30
	LDA.b $2C
	ASL
	TAY
	LDA.w DATA_12BF47,y
	CLC
	ADC.b $28
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12BF60:
	dw $0000,$3DDE,$0000,$3DDF,$8B04,$3DE0,$8B0A,$8B0B
	dw $8B0C,$8B12,$8B13,$8B14,$0000,$6A24,$0000

DATA_12BF7E:
	dw $0000,$0000,$3DDE,$0000,$0000,$0000,$3DDF,$8B04
	dw $3DE0,$0000,$0000,$8B0A,$8B01,$8B0C,$0000,$3DE1
	dw $8B07,$8B08,$8B09,$0000,$3DE2,$8B0E,$8B0F,$8B10
	dw $3DE3,$8B02,$8B0B,$8B15,$8B16,$8B0C,$8B12,$8B19
	dw $8B1A,$8B1B,$8B14,$0000,$0000,$3DE4,$0000,$0000
	dw $0000,$0000,$6A25,$0000,$0000

DATA_12BFD8:
	dw $0000,$0006,$000C,$0012,$0018

DATA_12BFE2:
	dw $0000,$000A,$0014,$001E,$0028,$0032,$003C,$0046
	dw $0050

CODE_12BFF4:
	REP.b #$30
	LDA.b $28
	ASL
	STA.b $00
	LDA.b $2C
	ASL
	TAX
	LDA.b $15
	BNE.b CODE_12C011
	LDA.w DATA_12BFD8,x
	CLC
	ADC.b $00
	TAY
	LDA.w DATA_12BF60,y
	BEQ.b CODE_12C023
	BRA.b CODE_12C01D

CODE_12C011:
	LDA.w DATA_12BFE2,x
	CLC
	ADC.b $00
	TAY
	LDA.w DATA_12BF7E,y
	BEQ.b CODE_12C023
CODE_12C01D:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12C023:
	SEP.b #$30
	RTL

DATA_12C026:
	dw $8E00,$8E01,$8E02,$8D95

DATA_12C02E:
	dw $8E01,$8E02,$8D95

DATA_12C034:
	dw $8E02,$8D95

DATA_12C038:
	dw $799E,$8D94

DATA_12C03C:
	dw DATA_12C026-$02,DATA_12C02E-$02,DATA_12C034-$02,DATA_12C038-$02

CODE_12C044:
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_12C04F
	LDA.w #$799D
	BRA.b CODE_12C05A

CODE_12C04F:
	ASL
	TAY
	LDX.b $15
	LDA.w DATA_12C03C,x
	STA.b $00
	LDA.b ($00),y
CODE_12C05A:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12C063:
	LDX.b $1D
	LDA.w #$799C
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTL

DATA_12C06D:
	dw $8D54,$8D55,$8D56,$8D57,$8D58,$8D59

DATA_12C079:
	dw $8D54,$8D55,$8D56,$8D5A,$8D58,$8D5B

DATA_12C085:
	dw $8D5C,$8D5D,$8D5E,$8D5F

DATA_12C08D:
	dw $8D5C,$8D5D,$8D60,$8D5F

DATA_12C095:
	dw $8D5C,$8D5D,$8D5E,$8D61

DATA_12C09D:
	dw $8D5C,$8D5D,$8D60,$8D61

DATA_12C0A5:
	dw DATA_12C06D,DATA_12C079,DATA_12C085,DATA_12C08D,DATA_12C095,DATA_12C09D

CODE_12C0B1:
	REP.b #$30
	LDY.b $15
	LDA.w DATA_12C0A5,y
	STA.b $00
	LDA.b $2C
	ASL
	ADC.b $28
	ASL
	TAY
	LDA.b ($00),y
	CLC
	ADC.b $A1
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12C0CF:
	LDX.b $1D
	LDA.w #$8D8E
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_right
	LDA.w #$8D8F
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTL

DATA_12C0E8:
	dw $1A04,$1A46,$8D00,$8D01,$1A06,$1A4E,$8D06,$8D07

DATA_12C0F8:
	dw $1A36,$1A18,$8D02,$8D03,$1A3C,$1A1A,$8D04,$8D05

CODE_12C108:
	REP.b #$30
	LDA.b $2C
	ASL
	ADC.b $28
	CLC
	ADC.b $A1
	ASL
	TAY
	LDA.b $15
	BNE.b CODE_12C11D
	LDA.w DATA_12C0E8,y
	BRA.b CODE_12C120

CODE_12C11D:
	LDA.w DATA_12C0F8,y
CODE_12C120:
	LDY.b $2C
	BNE.b CODE_12C128
	TAY
	LDA.w $0000,y
CODE_12C128:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12C131:
	dw $19DE,$1A4A,$1A52,$19E8,DATA_12C143,DATA_12C145,$8D0A,$8D0B
	dw $8D0C

DATA_12C143:
	dw $8D08

DATA_12C145:
	dw $8D09

DATA_12C147:
	dw $19E0,$1A4C,$1A56,$19EA,DATA_12C159,DATA_12C15B,$8D14,$8D15
	dw $8D16

DATA_12C159:
	dw $8D12

DATA_12C15B:
	dw $8D13

DATA_12C15D:
	dw $1A2C,$1A3A,$19F2,DATA_12C16F,DATA_12C171,$19FC,$8D0F,$8D10
	dw $8D11

DATA_12C16F:
	dw $8D0D

DATA_12C171:
	dw $8D0E

DATA_12C173:
	dw $1A2E,$1A3E,$19F4,DATA_12C185,DATA_12C187,$19FE,$8D19,$8D1A
	dw $8D1B

DATA_12C185:
	dw $8D17

DATA_12C187:
	dw $8D18

DATA_12C189:
	dw DATA_12C131,DATA_12C147,DATA_12C15D,DATA_12C173

CODE_12C191:					; Note: Cave mushroom level object?
	REP.b #$30
	LDA.b $2C
	ASL
	ADC.b $2C
	CLC
	ADC.b $28
	ASL
	TAY
	LDX.b $15
	LDA.w DATA_12C189,x
	STA.b $00
	LDA.b ($00),y
	LDY.b $2C
	INY
	CPY.b $2E
	BEQ.b CODE_12C1B1
	TAY
	LDA.w $0000,y
CODE_12C1B1:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

DATA_12C1BA:
	dw $0000,$1A2C,$1A3A,$19F2,$0000,DATA_12C16F,DATA_12C171,$19FC
	dw $1A04,$1A48,DATA_12C1DA,DATA_12C1DC

UNK_12C1D2:
	dw $8D00,$8D1E,$8D1F,$8D20

DATA_12C1DA:
	dw $8D1C

DATA_12C1DC:
	dw $8D1D

DATA_12C1DE:
	dw $0000,$0008,$0010,$0018

DATA_12C1E6:
	dw $0000,$19E0,$1A4C,$1A56,$0000,$0000,$19EA,DATA_12C159
	dw DATA_12C15B,$0000,$0000,DATA_12C222,DATA_12C224,$1A38,$1A18,$19DE
	dw $1A4A,$1A54,DATA_12C226,DATA_12C228,$19E8,DATA_12C143,DATA_12C22A,DATA_12C22C
	dw DATA_12C22E

DATA_12C218:
	dw $8D0A,$8D0B,$8D28,$8D1F,$8D20

DATA_12C222:
	dw $8D21

DATA_12C224:
	dw $8D22

DATA_12C226:
	dw $8D23

DATA_12C228:
	dw $8D24

DATA_12C22A:
	dw $8D25

DATA_12C22C:
	dw $8D26

DATA_12C22E:
	dw $8D27

DATA_12C230:
	dw $0000,$000A,$0014,$001E,$0028,$0032

DATA_12C23C:
	dw DATA_12C1BA,DATA_12C1E6

DATA_12C240:
	dw DATA_12C1DE,DATA_12C230

CODE_12C244:
	REP.b #$30
	LDX.b $15
	LDA.w DATA_12C240,x
	STA.b $00
	LDA.w DATA_12C23C,x
	STA.b $02
	LDA.b $2C
	ASL
	TAY
	LDA.b ($00),y
	STA.b $00
	LDA.b $28
	ASL
	ADC.b $00
	TAY
	LDA.b ($02),y
	BEQ.b CODE_12C275
	LDY.b $2C
	INY
	CPY.b $2E
	BEQ.b CODE_12C26F
	TAY
	LDA.w $0000,y
CODE_12C26F:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12C275:
	SEP.b #$30
	RTL

DATA_12C278:
	dw $8D42

DATA_12C27A:
	dw $8D39,$8D3F

DATA_12C27E:
	dw $8D39,$8D3C,$8D3F

DATA_12C284:
	dw $8D48,$8D4B,$8D4E

DATA_12C28A:
	dw $8D48,$8D4E

DATA_12C28E:
	dw $8D51

DATA_12C290:
	dw DATA_12C278-$02
	dw DATA_12C27A-$02
	dw DATA_12C27E-$02
	dw DATA_12C284-$02
	dw DATA_12C28A-$02
	dw DATA_12C28E-$02

CODE_12C29C:
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_12C2B1
	LDA.w #$8D36
	LDY.b $15
	CPY.w #$0006
	BCC.b CODE_12C2BE
	LDA.w #$8D45
	BRA.b CODE_12C2BE

CODE_12C2B1:
	LDY.b $15
	LDA.w DATA_12C290,y
	STA.b $00
	LDA.b $2C
	ASL
	TAY
	LDA.b ($00),y
CODE_12C2BE:
	CLC
	ADC.b $A1
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12C2CA:
	REP.b #$30
	LDA.b $2C
	BNE.b CODE_12C2D8
	LDA.b $28
	CLC
	ADC.w #$8DA7
	BRA.b CODE_12C2F9

CODE_12C2D8:
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$8DA5
	BEQ.b CODE_12C2F3
	CMP.w #$8DA6
	BEQ.b CODE_12C2F3
	LDA.w #$152A
	BRA.b CODE_12C2F6

CODE_12C2F3:
	LDA.w #$8F04
CODE_12C2F6:
	CLC
	ADC.b $28
CODE_12C2F9:
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12C302:
	REP.b #$30
	LDA.w #$8DA5
	CLC
	ADC.b $28
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_above
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$152A
	BEQ.b CODE_12C326
	CMP.w #$152B
	BNE.b CODE_12C332
CODE_12C326:
	SEC
	SBC.w #$152A
	CLC
	ADC.w #$8F04
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12C332:
	SEP.b #$30
	RTL

DATA_12C335:
	dw $8D96,$8D97,$8D98,$8D99,$152C,$152D,$152E,$152F
	dw $8DB4,$8DB5,$8DB6,$8DB7,$0000,$8DC3,$8DC4,$8DC5
	dw $8DD1,$8DD2,$8DD3,$8DD4,$8F00,$8F01,$8F02,$8F03
	dw $8DD5,$8DD6,$8DD7,$8DD8,$0000,$8DD9,$8DDA,$8DDB

CODE_12C375:
	REP.b #$30
	LDA.b $2C
	ASL
	ASL
	ADC.b $28
	CLC
	ADC.b $15
	ASL
	TAY
	LDA.w DATA_12C335,y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12C38E:
	LDX.b $1D
	LDA.w #$5F04
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTL

DATA_12C398:
	db $CD,$CE,$CF,$D0

DATA_12C39C:
	db $00,$D1,$D2,$D0,$D5,$CF,$D0,$D2,$00

DATA_12C3A5:
	db $00,$D2,$CD,$D5,$CF,$00

DATA_12C3AB:
	db $CA,$00,$CB,$CC

DATA_12C3AF:
	db $00,$C5,$C6,$C7

DATA_12C3B3:
	db $00,$02

DATA_12C3B5:
	db $00,$03,$06

DATA_12C3B8:
	db $00,$02,$04

DATA_12C3BB:
	db $00,$02

DATA_12C3BD:
	db $00,$02

DATA_12C3BF:
	dw DATA_12C398,DATA_12C39C,DATA_12C3A5,DATA_12C3AB,DATA_12C3AF
	
DATA_12C3C9:
	dw DATA_12C3B3,DATA_12C3B5,DATA_12C3B8,DATA_12C3BB,DATA_12C3BD

CODE_12C3D3:
	REP.b #$30
	LDY.b $15
	LDA.w DATA_12C3BF,y
	STA.b $00
	LDA.w DATA_12C3C9,y
	STA.b $02
	LDY.b $2C
	LDA.b ($02),y
	AND.w #$00FF
	CLC
	ADC.b $28
	TAY
	LDA.b ($00),y
	AND.w #$00FF
	BEQ.b CODE_12C3FC
	ORA.w #$7900
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12C3FC:
	SEP.b #$30
	RTL

CODE_12C3FF:
	LDA.w #$79BB
	CLC
	ADC.b $15
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTL

DATA_12C40C:
	dw $0000,$0000,$0817,$0A18,$0000,$0000,$0817,$9000
	dw $9001,$0A1A,$79DE,$9002,$9003,$9004,$9005,$79B6
	dw $9006,$9007,$9008,$5D0C,$79AE,$9009,$900A,$5D0C
	dw $0000

DATA_12C43E:
	dw $79DE,$900B,$900C,$0F12,$1010,$79AE,$900D,$900E
	dw $900F,$9010,$79C7,$9002,$9011,$9003,$9012,$0000
	dw $9013,$9014,$9015,$5D0C,$0000,$79BF,$9009,$5D0C
	dw $0000

DATA_12C470:
	dw $0000,$0C0D,$0D0F,$9016,$0A18,$79DE,$9017,$9018
	dw $9019,$901A,$79BD,$901B,$901C,$901D,$901E,$79C6
	dw $901F,$901D,$9015,$5D0C,$79C3,$9020,$9008,$5D0C
	dw $0000,$79AF,$9009,$5D0C,$0000,$0000

DATA_12C4AC:
	dw $0000,$0817,$0A18,$79C6,$9021,$901A,$79AE,$9006
	dw $9022,$79BD,$9009,$9023

DATA_12C4C4:
	dw $79C6,$900B,$0A18,$79BE,$9024,$5D0D,$79DE,$5D0E
	dw $0000

DATA_12C4D6:
	dw $0000,$0817,$0A19,$0000,$0000,$0817,$9000,$9025
	dw $0A19,$0000,$9026,$9027,$9028,$9029,$79DA,$5B10
	dw $902A,$902B,$902C,$79BD,$0000,$5B10,$900A,$902D
	dw $79AE

DATA_12C508:
	dw $0C0D,$0D0F,$0F13,$1011,$0000,$902E,$902F,$9030
	dw $9029,$79DA,$9031,$9032,$9033,$9034,$79B6,$5B10
	dw $9035,$9036,$9037,$0000,$0000,$5B10,$902D,$79AF
	dw $0000

DATA_12C53A:
	dw $0C0D,$0D0F,$0F12,$1010,$0000,$902E,$9038,$9039
	dw $903A,$79DA,$9026,$9027,$903B,$903C,$79AF,$5B10
	dw $902A,$903D,$903E,$79CC,$0000,$5B10,$902A,$903F
	dw $79C3,$0000,$0000,$5B10,$902D,$79AD

DATA_12C576:
	dw $0817,$0A18,$0000,$9040,$9041,$79CC,$9042,$902C
	dw $79BD,$9043,$902D,$79CD

DATA_12C58E:
	dw $0817,$9044,$79CC,$5B11,$904F,$79AE,$0000,$5B12
	dw $79B6

DATA_12C5A0:
	dw $0000,$0000,$0000,$0817,$0A18,$0000,$0000,$0000
	dw $0000,$0817,$9000,$9001,$0F14,$1010,$0000,$0817
	dw $9045,$9038,$9039,$9033,$9010,$0000,$9046,$9047
	dw $9048,$9004,$9049,$9010,$0000,$79DC,$79C1,$79CA
	dw $9009,$902B,$9022,$0000,$79D0,$79CE,$79C0,$79DC
	dw $9009,$9023

DATA_12C5F4:
	dw $0000,$0817,$900C,$0A18,$0000,$0000,$0000,$0817
	dw $9045,$9038,$9001,$0A1A,$0000,$0000,$902E,$9011
	dw $904A,$9039,$904B,$0A1A,$0000,$9026,$9027,$9022
	dw $904C,$901F,$903E,$0000,$904D,$904E,$902D,$79DC
	dw $79B6,$79C5,$0000,$9043,$902D,$79AF,$79D0,$79B3
	dw $79B4,$0000

DATA_12C648:
	db $00,$05,$0A,$0F,$14,$19

DATA_12C64E:
	db $00,$03,$06,$09

DATA_12C652:
	db $00,$07,$0E,$15,$1C,$23

DATA_12C658:
	dw DATA_12C40C,DATA_12C43E,DATA_12C470,DATA_12C4AC,DATA_12C4C4,DATA_12C4D6,DATA_12C508,DATA_12C53A
	dw DATA_12C576,DATA_12C58E,DATA_12C5A0,DATA_12C5F4

DATA_12C670:
	dw DATA_12C648,DATA_12C648,DATA_12C648,DATA_12C64E,DATA_12C64E,DATA_12C648,DATA_12C648,DATA_12C648
	dw DATA_12C64E,DATA_12C64E,DATA_12C652,DATA_12C652

DATA_12C688:
	dw $100F,$0C0B

DATA_12C68C:
	dw $100E,$0C0C

CODE_12C690:
	REP.b #$30
	LDX.b $15
	LDA.w DATA_12C658,x
	STA.b $00
	LDA.w DATA_12C670,x
	STA.b $02
	LDY.b $2C
	LDA.b ($02),y
	AND.w #$00FF
	CLC
	ADC.b $28
	ASL
	TAY
	LDA.b ($00),y
	BEQ.b CODE_12C6DF
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.b $2C
	INC
	CMP.b $2E
	BNE.b CODE_12C6DF
	LDA.b $1B
	STA.b $0E
	JSL.l CODE_get_map16_below
	LDY.w #$0000
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12C6CA:
	CMP.w DATA_12C688,y
	BEQ.b CODE_12C6D8
	INY
	INY
	CPY.w #$0004
	BCC.b CODE_12C6CA
	BRA.b CODE_12C6DF

CODE_12C6D8:
	LDA.w DATA_12C68C,y
	STA.l !RAM_YI_Level_LevelDataBuffer,x
CODE_12C6DF:
	SEP.b #$30
	RTL

DATA_12C6E2:
	dw $7D24,$7D25,$0118,$0119

CODE_12C6EA:
	REP.b #$30
	LDA.b $2C
	ASL
	ORA.b $28
	ASL
	TAY
	LDA.w DATA_12C6E2,y
	LDX.b $1D
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$30
	RTL

CODE_12C6FF:
CODE_extobj_stamp_clear_cell:                        ; per-cell stamper used by ext-obj action $FD (CODE_extobj_FD_clear_map16_cell): writes Map16 ID $0000 to the current cell ($1D index)
	LDX.b $1D
	LDA.w #$0000
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	RTL

;=========================================================================
; Per-level / per-mini-battle LevelData blobs ($12:C709 - $12:FFB3).
; Standard YI level-data format (bit-packed header + object stream +
; screen exits + sprite stream). Referenced by the level-data pointer
; table (DATA_17F7C3 in V1.0 / DATA_0FE822 in V1.1).
;=========================================================================
DATA_level_06_obj:
	incbin "LevelData/DATA_level_06_obj.bin"

DATA_level_3F_obj:
	incbin "LevelData/DATA_level_3F_obj.bin"

DATA_level_06_spr:
	incbin "LevelData/DATA_level_06_spr.bin"

DATA_level_3F_spr:
	incbin "LevelData/DATA_level_3F_spr.bin"

DATA_level_09_obj:
	incbin "LevelData/DATA_level_09_obj.bin"

DATA_level_41_obj:
	incbin "LevelData/DATA_level_41_obj.bin"

DATA_level_71_obj:
	incbin "LevelData/DATA_level_71_obj.bin"

DATA_level_9C_obj:
	incbin "LevelData/DATA_level_9C_obj.bin"

DATA_level_BA_obj:
	incbin "LevelData/DATA_level_BA_obj.bin"

DATA_level_09_spr:
	incbin "LevelData/DATA_level_09_spr.bin"

DATA_level_41_spr:
	incbin "LevelData/DATA_level_41_spr.bin"

DATA_level_71_spr:
	incbin "LevelData/DATA_level_71_spr.bin"

DATA_level_9C_spr:
	incbin "LevelData/DATA_level_9C_spr.bin"

DATA_level_BA_spr:
	incbin "LevelData/DATA_level_BA_spr.bin"

DATA_level_11_obj:
	incbin "LevelData/DATA_level_11_obj.bin"

DATA_level_49_obj:
	incbin "LevelData/DATA_level_49_obj.bin"

DATA_level_11_spr:
	incbin "LevelData/DATA_level_11_spr.bin"

DATA_level_49_spr:
	incbin "LevelData/DATA_level_49_spr.bin"

DATA_level_1E_obj:
	incbin "LevelData/DATA_level_1E_obj.bin"

DATA_level_55_obj:
	incbin "LevelData/DATA_level_55_obj.bin"

DATA_level_82_obj:
	incbin "LevelData/DATA_level_82_obj.bin"

DATA_level_AA_obj:
	incbin "LevelData/DATA_level_AA_obj.bin"

DATA_level_C1_obj:
	incbin "LevelData/DATA_level_C1_obj.bin"

DATA_level_1E_spr:
	incbin "LevelData/DATA_level_1E_spr.bin"

DATA_level_55_spr:
	incbin "LevelData/DATA_level_55_spr.bin"

DATA_level_82_spr:
	incbin "LevelData/DATA_level_82_spr.bin"

DATA_level_AA_spr:
	incbin "LevelData/DATA_level_AA_spr.bin"

DATA_level_C1_spr:
	incbin "LevelData/DATA_level_C1_spr.bin"

DATA_level_29_obj:
	incbin "LevelData/DATA_level_29_obj.bin"

DATA_level_60_obj:
	incbin "LevelData/DATA_level_60_obj.bin"

DATA_level_8C_obj:
	incbin "LevelData/DATA_level_8C_obj.bin"

DATA_level_29_spr:
	incbin "LevelData/DATA_level_29_spr.bin"

DATA_level_60_spr:
	incbin "LevelData/DATA_level_60_spr.bin"

DATA_level_8C_spr:
	incbin "LevelData/DATA_level_8C_spr.bin"

DATA_level_2C_obj:
	incbin "LevelData/DATA_level_2C_obj.bin"

DATA_level_63_obj:
	incbin "LevelData/DATA_level_63_obj.bin"

DATA_level_8F_obj:
	incbin "LevelData/DATA_level_8F_obj.bin"

DATA_level_B4_obj:
	incbin "LevelData/DATA_level_B4_obj.bin"

DATA_level_2C_spr:
	incbin "LevelData/DATA_level_2C_spr.bin"

DATA_level_63_spr:
	incbin "LevelData/DATA_level_63_spr.bin"

DATA_level_8F_spr:
	incbin "LevelData/DATA_level_8F_spr.bin"

DATA_level_B4_spr:
	incbin "LevelData/DATA_level_B4_spr.bin"

DATA_level_2F_obj:
	incbin "LevelData/DATA_level_2F_obj.bin"

DATA_level_66_obj:
	incbin "LevelData/DATA_level_66_obj.bin"

DATA_level_92_obj:
	incbin "LevelData/DATA_level_92_obj.bin"

DATA_level_2F_spr:
	incbin "LevelData/DATA_level_2F_spr.bin"

DATA_level_66_spr:
	incbin "LevelData/DATA_level_66_spr.bin"

DATA_level_92_spr:
	incbin "LevelData/DATA_level_92_spr.bin"

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($12FFB4, incbin, DATA_12FFB4_YI_U2.bin)
else
	%FREE_BYTES($12FF9E, 98, $FF)
endif
%BANK_END(<EndBank>)
endmacro
