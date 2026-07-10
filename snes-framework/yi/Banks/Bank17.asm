;#############################################################################################################
;# Bank17.asm -- LoROM bank $17. Heterogeneous "front-end" bank: title screen, file-select,
;#               world-map (overworld), cutscene tile-init queues, level-pointer table.
;#               Mixes 65816 game-mode code, OAM tables, HDMA scripts, world-map dispatch,
;#               and (at end of bank, V1.0 only) the per-level data pointer table.
;#
;# This is the last LoROM-rule bank ($00-$17 use the standard LoROM 32 KB-per-bank scheme;
;# from $40 ($4C) onward the HiROM/SuperFX 64 KB mirror takes over). Heavy traffic from
;# bottom-of-bank dispatch routines into game-mode handlers all live here.
;#
;# Contents at a glance (function -> address):
;#   $178000  DATA_178000  -- "island graphic" tilemap init queue (3 dw + $FFFF terminator)
;#   $178008  DATA_178008  -- "island cutscene" tilemap init queue (5 dw + $FFFF)
;#   $178016+ DATA_178016..DATA_17807A -- HDMA scripts (mode-7 matrix, scroll, window, mainscreen)
;#   $1780A3  DATA_title_screen_tilemap_ptr_table  -- save-data file table (3-byte ptrs to per-file slots)
;#   $1780C1+ save-data pointer subtables: last-level-beaten / score by file
;#   $1780D6  CODE_gm_load_title_screen  -- CODE_gm_load_title_screen   (title-screen game-mode initializer)
;#   $1787D5  CODE_gm_fade_to_title_screen  -- CODE_gm_fade_to_title_screen (fade transition out of title)
;#   $17A58E  CODE_gm20_prepare_overworld  -- CODE_gm20_prepare_overworld (game-mode $20 setup, OAM/BG3 init)
;#   $17A932  CODE_gm28_world_score_flip_cutscene  -- CODE_gm28_world_score_flip_cutscene (game-mode $28)
;#   $17AA1A  CODE_gm26_level_score_update  -- CODE_gm26_level_score_update (game-mode $26 OAM update)
;#   $17B363  CODE_gm24_overworld_level_progression  -- CODE_gm24_overworld_level_progression (game-mode $24)
;#   $17B3CD  CODE_gm22_overworld  -- CODE_gm22_overworld (game-mode $22: the main overworld loop)
;#   $17B4BD  DATA_17B4BD  -- map_bonus_icons (per-world bonus tile IDs)
;#   $17C6D8  DATA_map_active_yoshi_color_ptr  -- DATA_map_active_yoshi_color_ptr (per-color overworld Yoshi palette)
;#   $17E03E  CODE_level_select  -- CODE_level_select (debug level-select menu logic)
;#   $17F3C9  DATA_bonus_game_id_lut  -- tile-overlay LUT for level-progression (`db $00,$04,$0C,...`)
;#   $17F3D0  CODE_arm_bonus_game_loader  -- setup for game-mode 2D ("entering level"), seeds $03A7/!CurrentGameMode
;#   $17F3E7  DATA_level_entrance_indexes  -- DATA_level_entrance_indexes -- 138-byte word index, world-tile -> entrance
;#                            (NOTE: emitted by %DATATABLE_YI_LevelDataPtrsAndEntranceData in V1.0)
;#   $17F471  DATA_map_level_entrances  -- 4-byte records: +0 level-data ID (x6 -> Ptrs:), +1 X, +2 Y,
;#                            +3 progression target (next tile-slot; see DATATABLE header for the full layout)
;#   $17F551  DATA_level_midway_entrance_indexes  -- DATA_level_midway_entrance_indexes (138-byte word index)
;#   $17F5DB  DATA_map_level_midway_entrances  -- DATA_map_level_midway_entrances (4-byte records, midway warp data)
;#   $17F7C3  Ptrs:        -- level_object_pointers / level_sprite_pointers (222 entries x 6B)
;#                            ONLY present in V1.0 (else V1.1 hoists it to $0F:E822, garbage
;#                            data is emitted here instead -- see version gate at end-of-bank).
;#
;# Cross-references:
;#   docs/levelloader.md S3                                       -- level-pointer table semantics + V1.0/V1.1 version gate.
;#   yoshisisland-disassembly/disassembly/bank17.asm              -- primary source for named labels
;#       (CODE_gm_load_title_screen, level_object_pointers, etc.).
;#   yi/Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm   -- the macro that emits DATA_level_entrance_indexes..Ptrs:.
;#   yi/Constants/MiscDefines_YI.asm                              -- !Define_YI_GameMode2D etc.
;#
;# See also (sibling reference files):
;#   ys_main.asm              -- top-level frame loop, gamemode-dispatch entrypoints (GMIN/GMFD/GMPL,
;#                               HMPIN/HMPPL, MPIN, etc.); mirrors gm$09 title load / gm$22 overworld wiring.
;#   ys_init.asm              -- one-shot init shape used by CODE_gm_load_title_screen and CODE_gm20_prepare_overworld.
;#   ys_title.asm             -- title-screen state machine (`TLINIT` / `TLPLAY` / KEYINCHK fanfare).
;#   ys_map.asm               -- main overworld renderer + state dispatcher (parallels gm22 + DATA_world_map_state_ptr).
;#   ys_mapdt.asm             -- map data tables (parallels DATA_level_entrance_indexes..DATA_map_level_midway_entrances entrance tables).
;#   ys_hmap.asm              -- "hidden map" / extra-stages overworld variant (HMAPINIT/HMAPPLAY).
;#   ys_mpobj.asm, ys_mpmv.asm-- map-object + map-movement subsystems referenced by the renderer above.
;#   ys_game.asm              -- in-level gamemode-dispatch reference shared with $0C/$0D/$0E/$0F transitions.
;#
;# Descriptive label aliases below (same-address `name:` rows) come from Raidenthequick's
;# V1.0 disassembly. asar permits multiple labels at the same physical address; both names
;# resolve to identical bytes, so existing tooling that greps CODE_/DATA_ keeps working
;# unchanged.
;#
;# Level-loading pipeline -- this bank is the UPSTREAM side. See docs/levelloader.md for the
;# full end-to-end flow:
;#   CODE_gm22_overworld polls input, dispatches world-map state machine via
;#     DATA_world_map_state_ptr, and on level-tile click writes the picked level
;#     ID to !RAM_YI_Level_CurrentLevelFromMapLo and advances gamemode to $1E (level fade).
;#   The downstream level-loader handlers live in Bank01 (gm0C/0D/0E/0F) -- see
;#     docs/leveldataengine.md for the object-decode side of the same pipeline.
;#############################################################################################################
macro YIBank17Macros(StartBank, EndBank)
%BANK_START(<StartBank>)

;---- Tilemap init queues (consumed by the tilemap-init dispatcher; $FFFF terminates). ----
DATA_178000:							; "island graphic" tilemap init queue
	dw $3000,$47FF,$01BF
	dw $FFFF

DATA_178008:							; "island cutscene" tilemap init queue
	dw $3800,$47FF,$0000
	dw $7E82,$4277,$05FF
	dw $FFFF

;---- HDMA scripts ($178016-$1780A2). Each is a CHDMA channel descriptor: header byte + ----
;---- register + 24-bit src; then a body of "$NN-line count, src-bytes" ($00 terminates).  ----
DATA_178016:							; HDMA: Mode-7 matrix param A from $7E5B18
	db $43,!REGISTER_Mode7MatrixParameterA : dl $7E5B18

DATA_17801B:
	db $F0 : dw $7E5040
	db $F0 : dw $7E5040
	db $00

DATA_178022:							; HDMA: Mode-7 matrix param C from $7E5B98
	db $43,!REGISTER_Mode7MatrixParameterC : dl  $7E5B98

DATA_178027:
	db $F0 : dw $7E5200
	db $F0 : dw $7E5200
	db $00

DATA_17802E:							; HDMA: CGRAM address from $7E5C18 (palette window)
	db $43,!REGISTER_CGRAMAddress : dl  $7E5C18

DATA_178033:
	db $20,$22,$5C,$B0,$C0,$53,$01,$22,$5C,$00

UNK_17803D:
	db $26,$26,$FF,$7F

DATA_178041:							; HDMA: BG1 H-scroll from $7E5C18 (wavy text effect)
	db $43,!REGISTER_BG1HorizScrollOffset : dl $7E5C18

DATA_178046:
	db $76,$45,$00,$01,$39,$00,$00

DATA_17804D:							; HDMA: BG2 H-scroll from $7E5C98
	db $43,!REGISTER_BG2HorizScrollOffset : dl $7E5C98

DATA_178052:
	db $20,$C0,$55,$B0,$C4,$55,$01,$C0,$55,$00

DATA_17805C:							; HDMA: Window-1 left position from $7E5C98
	db $41,!REGISTER_Window1LeftPositionDesignation : dl $7E5C98

DATA_178061:
	db $0F,$C0,$55,$E4,$C2,$55,$81,$A0,$56,$00

DATA_17806B:							; HDMA: BG mode/tile-size from $7E5A18 (mode switch per-scanline)
	db $00,!REGISTER_BGModeAndTileSizeSetting : dl $7E5A18

DATA_178070:
	db $76,$10,$6A,$07,$00

DATA_178075:							; HDMA: main-screen layer enable from $7E5A98
	db $00,!REGISTER_MainScreenLayers : dl $7E5A98

DATA_17807A:
	db $70,$13,$70,$11,$00

DATA_17807F:
	db $43,!REGISTER_BG1HorizScrollOffset : dl $7E5D18

DATA_178084:
	db $5F,$41,$00,$01,$A1,$09,$01,$A5,$09,$01,$A9,$09,$02,$AD,$09,$03
	db $B1,$09,$04,$B5,$09,$05,$B9,$09,$06,$BD,$09,$01,$39,$00,$00

;---- Title-screen / file-select save-data dispatcher tables (Raiden bank17 lines 60-66). ----
DATA_1780A3:
DATA_title_screen_tilemap_ptr_table:				; Raiden style: ptrs to title-screen + file-select tilemap blobs
	dl DATA_0FF800
	dl DATA_5F9380

DATA_1780A9:
	db $DA,$58,$A1,$21,$C8,$BB,$20,$B9,$34,$40,$B9,$D4

DATA_1780B5:
	dw $0070,$004D,$001C,$00EF,$009C,$002A

DATA_1780C1:
DATA_save_data_last_lvl_ptr:					; Raiden: DATA_save_data_last_lvl_ptr
	dl $707C02
	dl $707C6A
	dl $707CD2

DATA_1780CA:
DATA_save_data_6_E_ptr:					; Raiden: DATA_save_data_6_E_ptr (per-file world-6 ext data ptrs)
	dw $707C47,$707CAF,$707D17

DATA_1780D0:
DATA_save_data_6_8_ptr:					; Raiden: DATA_save_data_6_8_ptr (per-file world-6 boss-flag ptrs)
	dw $707C46,$707CAE,$707D16

;-------------------------------------------------------------------------
; CODE_gm_load_title_screen -- CODE_gm_load_title_screen (game-mode $09 init / $18 reload).
; Raidenthequick: `CODE_gm_load_title_screen` at $17:80D6.
; See also: ys_init.asm (title-screen prep paths).
;
; INPUTS:
;   M=8 X=8 on entry (caller is the gamemode dispatcher in Bank00).
;   $7E:011A = high-score-display request flag (0 = normal title, !=0 = post-cart-reset).
;   $70:7E7C = save-file slot the cursor was last on (used to seed last-level-beaten icon).
; OUTPUTS:
;   $7E:0118 (!RAM_YI_Global_CurrentGameMode) auto-advances (handled by upstream wrapper).
;   $7E:0218 (!RAM_YI_Level_CurrentWorldLo) = derived world ID for save slot.
;   $7E:020E/0210 = OAM Y-shift bias for title-screen sprites.
;   HDMA channels $01..$07 armed via DMA-init pass through CODE_17815E.
;   VRAM 0x3800..0x3FFF, 0x3C00 tilemap regions seeded.
; MODIFIES: A, X, Y, DBR (PHB/PLB inside); DP locations $00..$22 used as scratch.
; CALLERS:
;   yi/Banks/Bank00.asm `DATA_game_mode_pointers[$09]` = $1780D6 - 1 (PHA/RTL trick).
;   Also invoked indirectly via gamemode $18 (reload title after game-over).
;-------------------------------------------------------------------------
CODE_1780D6:
CODE_gm_load_title_screen:					; Raiden alias
	LDA.b #$12
	JSL.l CODE_008279
	JSL.l CODE_clear_basic_states
	JSL.l CODE_copy_division_lookup_to_sram
	REP.b #$20
	LDA.w #$0080
	STA.w $020E
	LDA.w #$0100
	STA.w $0210
	STZ.b !RAM_YI_Global_Layer1XPosLo
	LDA.w #$0060
	STA.b !RAM_YI_Global_Layer1YPosLo
	STZ.b !RAM_YI_Global_Layer2XPosLo
	LDA.w #$008F
	STA.b !RAM_YI_Global_Layer2YPosLo
	STZ.b !RAM_YI_Global_Layer3XPosLo
	STZ.b !RAM_YI_Global_Layer3YPosLo
	STZ.w $09A3
	STZ.w $09A7
	STZ.w $09AB
	STZ.w $09AF
	STZ.w $09B3
	STZ.w $09B7
	STZ.w $09BB
	STZ.w $09BF
	STZ.w $0214
	SEP.b #$20
	LDA.w $011A
	BNE.b CODE_17815C
	LDA.l $707E7C
	ASL
	ADC.l $707E7C
	TAX
	REP.b #$20
	LDA.w DATA_save_data_last_lvl_ptr,x
	STA.b $00
	LDA.w DATA_save_data_last_lvl_ptr+$01,x
	STA.b $01
	STZ.w !RAM_YI_Level_FinalWorldUnlockedFlagLo
	SEP.b #$20
	LDX.b #$00
	LDA.b [$00]
	AND.b #$7F
	BEQ.b CODE_178157
CODE_178149:
	INX
	SEC
	SBC.b #!Define_YI_Map_LevelsPerWorld
	BPL.b CODE_178149
	DEX
	CPX.b #$05
	BNE.b CODE_178157
	INC.w !RAM_YI_Level_FinalWorldUnlockedFlagLo
CODE_178157:
	TXA
	ASL
	STA.w !RAM_YI_Level_CurrentWorldLo
CODE_17815C:
	LDX.b #$04
CODE_17815E:
	LDA.w DATA_178016,x
	STA.w HDMA[$07].Parameters,x
	LDA.w DATA_178022,x
	STA.w HDMA[$06].Parameters,x
	LDA.w DATA_17802E,x
	STA.w HDMA[$05].Parameters,x
	LDA.w DATA_17804D,x
	STA.w HDMA[$04].Parameters,x
	LDA.w DATA_17806B,x
	STA.w HDMA[$03].Parameters,x
	LDA.w DATA_178075,x
	STA.w HDMA[$02].Parameters,x
	LDA.w DATA_17807F,x
	STA.w HDMA[$01].Parameters,x
	DEX
	BPL.b CODE_17815E
	LDA.b #$7E
	STA.w HDMA[$07].IndirectSourceBank
	STA.w HDMA[$06].IndirectSourceBank
	STA.w HDMA[$05].IndirectSourceBank
	STA.w HDMA[$04].IndirectSourceBank
	STA.w HDMA[$03].IndirectSourceBank
	STA.w HDMA[$02].IndirectSourceBank
	STZ.w HDMA[$01].IndirectSourceBank
	LDX.b #$1E
CODE_1781A4:
	LDA.w DATA_17801B,x
	STA.l $7E5B18,x
	LDA.w DATA_178027,x
	STA.l $7E5B98,x
	LDA.w DATA_178033,x
	STA.l $7E5C18,x
	LDA.w DATA_178052,x
	STA.l $7E5C98,x
	LDA.w DATA_178070,x
	STA.l $7E5A18,x
	LDA.w DATA_17807A,x
	STA.l $7E5A98,x
	LDA.w DATA_178084,x
	STA.l $7E5D18,x
	DEX
	BPL.b CODE_1781A4
	LDA.b #!REGISTER_BG1HorizScrollOffset
	STA.w $09A0
	JSL.l CODE_load_overworld_gfx
	LDX.b #$00
	JSL.l CODE_init_scene_regs
	LDA.b #$3C
	STA.w !REGISTER_BG4AddressAndSize
	STZ.w !REGISTER_Mode7TilemapSettings
	REP.b #$20
	LDY.b #$00
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #$3800
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_ReadFromVRAMPortLo&$0000FF)<<8)+$80
	STA.w DMA[$00].Parameters
	LDA.w #$7E7BBE
	STA.w DMA[$00].SourceLo
	LDY.b #$7E7BBE>>16
	STY.w DMA[$00].SourceBank
	LDA.w #$0800
	STA.w DMA[$00].SizeLo
	LDY.w !REGISTER_ReadFromVRAMPortLo
	LDX.b #$01
	STX.w !REGISTER_DMAEnable
	LDY.b #$80
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #$3800
	STA.w !REGISTER_VRAMAddressLo
	LDY.b #!REGISTER_ReadFromVRAMPortHi
	STY.w DMA[$00].Destination
	LDA.w #$0800
	STA.w DMA[$00].SizeLo
	LDY.w !REGISTER_ReadFromVRAMPortHi
	STX.w !REGISTER_DMAEnable
	LDY.b #$7F
	STY.b $00
	STZ.w !REGISTER_VRAMAddressIncrementValue
	STZ.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$08
	STA.w DMA[$00].Parameters
	LDA.w #$0000
	STA.w DMA[$00].SourceLo
	STZ.w DMA[$00].SourceBank
	LDA.w #$2000
	STA.w DMA[$00].SizeLo
	LDX.b #$01
	STX.w !REGISTER_DMAEnable
	LDY.b #$80
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDY.b #$03
	LDA.w $011A
	AND.w #$00FF
	CMP.w #$0080
	BEQ.b CODE_178275
	LDA.w !RAM_YI_Level_FinalWorldUnlockedFlagLo
	BNE.b CODE_178275
	DEY
	DEY
	DEY
CODE_178275:
	LDA.w #$3C00
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w DATA_title_screen_tilemap_ptr_table+$01,y
	STA.w DMA[$00].SourceHi
	LDA.w DATA_title_screen_tilemap_ptr_table,y
	STA.w DMA[$00].SourceLo
	LDA.w #$0480
	STA.w DMA[$00].SizeLo
	STX.w !REGISTER_DMAEnable
	LDA.w #$3E40
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #DATA_title_screen_logo_tilemap
	STA.w DMA[$00].SourceLo
	LDY.b #DATA_title_screen_logo_tilemap>>16
	STY.w DMA[$00].SourceBank
	LDA.w #$0380
	STA.w DMA[$00].SizeLo
	STX.w !REGISTER_DMAEnable
	LDX.b #$707C47>>16
	STX.b $02
	LDA.l $707E7C
	ASL
	TAX
	LDA.w DATA_1780CA,x
	STA.b $00
	LDY.b #$05
	LDA.w #$3E9A
	STA.b $0A
	LDA.w #$3EBA
	STA.b $0C
CODE_1782CB:
	LDA.w #$2B22
	STA.b $10
	STA.b $12
	STA.b $20
	STA.b $22
	LDA.b [$00]
	AND.w #$007F
	CMP.w #$0064
	BCC.b CODE_1782F0
	LDA.w #$2F0B
	STA.b $10
	INC
	STA.b $12
	LDA.w #$2F1B
	STA.b $20
	INC
	STA.b $22
CODE_1782F0:
	LDA.b $0A
	STA.w !REGISTER_VRAMAddressLo
	LDA.b $10
	STA.w !REGISTER_WriteToVRAMPortLo
	LDA.b $12
	STA.w !REGISTER_WriteToVRAMPortLo
	LDA.b $0C
	STA.w !REGISTER_VRAMAddressLo
	LDA.b $20
	STA.w !REGISTER_WriteToVRAMPortLo
	LDA.b $22
	STA.w !REGISTER_WriteToVRAMPortLo
	LDA.b $00
	SEC
	SBC.w #$000C
	STA.b $00
	DEC.b $0A
	DEC.b $0A
	DEC.b $0C
	DEC.b $0C
	DEY
	BPL.b CODE_1782CB
	LDY.w $011A
	BNE.b CODE_17838C
	LDA.w #$0400
	STA.w $1405
	LDA.w #$DA00
	STA.w $6CA4
	LDA.w #$5800
	STA.w $6CA6
	LDA.w #$0000
	STA.w $6CA8
	LDA.w #$0070
	STA.w $6CA0
	PHB
	LDX.b #$7E53C0>>16
	PHX
	PLB
	REP.b #$10
	LDY.w #$01FC
CODE_17834E:
	LDA.w #$2626
	STA.w $7E53C0,y
	DEY
	DEY
	DEY
	DEY
	BPL.b CODE_17834E
	LDX.w #$007E
	LDY.w #$00FC
CODE_178360:
	LDA.l DATA_5FCC2E,x
	STA.w $7E53C2,y
	STA.w $7E54C2,y
	DEY
	DEY
	DEY
	DEY
	DEX
	DEX
	BPL.b CODE_178360
	LDX.w #$00E0
CODE_178375:
	LDA.b !RAM_YI_Global_Layer2XPosLo
	STA.w $7E55C0,x
	LDA.b !RAM_YI_Global_Layer2YPosLo
	STA.w $7E55C2,x
	DEX
	DEX
	DEX
	DEX
	BPL.b CODE_178375
	SEP.b #$30
	PLB
	LDA.b #$FE
	BRA.b CODE_1783BD

CODE_17838C:
	LDY.b #$00
	LDA.w #$7E7BBE
	STA.b $20
	LDX.b #$7E7BBE>>16
	STX.b $22
	LDA.w #$0400
	JSL.l CODE_dma_init_gen_purpose
	LDA.w #$7E83BE
	STA.b $20
	LDA.w #$0400
	JSL.l CODE_dma_init_gen_purpose
	LDA.w #$0011
	STA.w !RAM_YI_Global_MainScreenLayers
	SEP.b #$20
	LDA.b #$06
	STA.w $0127
	JSL.l CODE_prepare_tilemap_dma_queue_l
	LDA.b #$CE
CODE_1783BD:
	STA.w !RAM_YI_Global_HDMAEnable
	REP.b #$10
	LDX.w #$0044
CODE_1783C5:
	STZ.w $09C1,x
	DEX
	BPL.b CODE_1783C5
	LDX.w #$05DD
CODE_1783CE:
	STZ.w $702A,x
	DEX
	BPL.b CODE_1783CE
	SEP.b #$10
	LDX.b #$02
	LDA.w $011A
	CMP.b #$80
	BEQ.b CODE_1783E6
	LDA.w !RAM_YI_Level_FinalWorldUnlockedFlagLo
	BNE.b CODE_1783E6
	DEX
	DEX
CODE_1783E6:
	JSL.l CODE_00BAEA
	PHB
	LDA.b #$7E4800>>16
	PHA
	PLB
	REP.b #$30
	LDA.w #DATA_5F9C00-DATA_5F9800
	STA.b $04
	LDA.w $011A
	AND.w #$00FF
	CMP.w #$0080
	BEQ.b CODE_178408
	LDA.w !RAM_YI_Level_FinalWorldUnlockedFlagLo
	BNE.b CODE_178408
	STZ.b $04
CODE_178408:
	LDY.w $7E4800
	LDA.b $04
	CLC
	ADC.w #DATA_5F9800
	STA.b $04
	LDA.w #$0020
	STA.b $02
	LDA.w #$0800
CODE_17841B:
	STA.b $00
	STA.w $0000,y
	LDA.w #$0000
	STA.w $0002,y
	LDA.w #$1800
	STA.w $0003,y
	LDA.b $04
	STA.w $0005,y
	CLC
	ADC.w #$0020
	STA.b $04
	LDA.w #DATA_5F9800>>16
	STA.w $0007,y
	LDA.w #$0020
	STA.w $0008,y
	TYA
	CLC
	ADC.w #$000C
	STA.w $000A,y
	TAY
	LDA.b $00
	CLC
	ADC.w #$0080
	DEC.b $02
	BNE.b CODE_17841B
	STY.w $7E4800
	PLB
	LDX.w #$0002
	LDA.w $011A
	AND.w #$00FF
	CMP.w #$0080
	BEQ.b CODE_17846F
	LDA.w !RAM_YI_Level_FinalWorldUnlockedFlagLo
	BNE.b CODE_17846F
	DEX
	DEX
CODE_17846F:
	LDA.l DATA_10EE9A,x
	STA.b $00
	LDA.l DATA_10EE9E,x
	STA.b $02
	SEP.b #$20
	PHB
	LDA.b #DATA_10EEA2>>16
	PHA
	PLB
	LDY.w #$0000
CODE_178485:
	LDA.b ($00),y
	CMP.b #$FF
	BEQ.b CODE_17849C
	INC.w $702A
	LDX.w #$0004
CODE_178491:
	LDA.b ($00),y
	STA.w $702C,y
	INY
	DEX
	BNE.b CODE_178491
	BRA.b CODE_178485

CODE_17849C:
	PLB
	LDA.w $6CA5
	STA.w $702D
	LDA.w $6CA7
	STA.w $702E
	LDA.w $6CA9
	STA.w $702F
	LDA.b #$C0
	SEC
	SBC.w $6CA0
	STA.w $021E
	REP.b #$30
	LDX.w #$0254
	LDA.w #$0100
CODE_1784C0:
	STA.w $7286,x
	DEX
	DEX
	DEX
	DEX
	BPL.b CODE_1784C0
	SEP.b #$30
	PHB
	LDA.b #DATA_10EEA2>>16
	PHA
	PLB
	LDY.b #$00
CODE_1784D2:
	LDA.b ($02),y
	BMI.b CODE_1784E3
	LDX.b #$04
CODE_1784D8:
	LDA.b ($02),y
	STA.w $09C1,y
	INY
	DEX
	BNE.b CODE_1784D8
	BRA.b CODE_1784D2

CODE_1784E3:
	PLB
	JSR.w CODE_178661
	LDX.w !RAM_YI_Level_CurrentWorldLo
	BNE.b CODE_1784EF				; Note: !Define_YI_WorldID_World1
	JMP.w CODE_1785A1

CODE_1784EF:
	LDA.w $011A
	AND.b #$7F
	BNE.b CODE_1784F8
	INX
	INX
CODE_1784F8:
	LDA.w DATA_1780A9-$02,x
	STA.w $6CA5
	STA.w $702D
	LDA.w DATA_1780A9-$01,x
	STA.w $6CA7
	STA.w $702E
	LDA.w DATA_1780B5-$02,x
	STA.w $6CA0
	LDA.b #$C0
	SEC
	SBC.w $6CA0
	STA.w $021E
	LDA.w $011A
	AND.b #$7F
	BNE.b CODE_178568
	LDA.w !RAM_YI_Level_CurrentWorldLo
	CMP.b #!Define_YI_WorldID_World6
	BNE.b CODE_178568
	LDA.l $707E7C
	ASL
	TAY
	LDA.b #$707C46>>16
	STA.b $02
	REP.b #$20
	LDA.w DATA_save_data_6_8_ptr,y
	STA.b $00
	SEP.b #$20
	LDA.b [$00]
	AND.b #$80
	BEQ.b CODE_178566
	REP.b #$20
	LDA.l DATA_yoshi_cinema_path_ptrs-$02,x
	STA.w $021C
	LDA.l DATA_10F0E0-$02,x
	STA.w $096D
	REP.b #$10
	TAY
	LDA.w #$0000
	STA.w $702C,y
	SEP.b #$10
	TXA
	ASL
	TAY
	LDA.w #$000A
	STA.w $09C1,y
	SEP.b #$20
CODE_178566:
	BRA.b CODE_1785A1

CODE_178568:
	REP.b #$20
	LDA.l DATA_yoshi_cinema_path_ptrs-$02,x
	STA.w $021C
	LDA.l DATA_10F0E0-$02,x
	STA.w $096D
	SEP.b #$20
	CPX.b #$0C
	BCS.b CODE_1785A1
	TXA
	ASL
	TAY
CODE_178581:
	DEY
	DEY
	DEY
	DEY
	BEQ.b CODE_1785A1
	LDA.b #$0A
	STA.w $09C1,y
	TYA
	LSR
	TAX
	REP.b #$20
	LDA.l DATA_10F0E0-$02,x
	REP.b #$10
	TAX
	SEP.b #$20
	STZ.w $702C,x
	SEP.b #$10
	BRA.b CODE_178581

CODE_1785A1:
	LDA.w $011A
	BEQ.b CODE_1785B8
	LDA.w $011A
	BEQ.b CODE_1785B8
	CMP.b #$80
	BNE.b CODE_1785B3
	LDA.b #$1C
	BRA.b CODE_1785B5

CODE_1785B3:
	LDA.b #$02
CODE_1785B5:
	STA.w $6CA2
CODE_1785B8:
	LDA.w $011A
	BMI.b CODE_1785F3
	LDA.l $707E7C
	STA.w $111D
	JSR.w CODE_1790E0
	REP.b #$30
	LDX.w #$000A06
	LDA.w #$0000
	STA.b $01
	LDY.w #$3020
	LDA.w #$0300
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDX.w #$702800
	LDA.w #$702800>>16
	STA.b $01
	LDY.w #$2000
	LDA.w #$1000
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	JSL.l CODE_process_vram_dma_queue_l
CODE_1785F3:
	LDA.w $011A
	BPL.b CODE_1785FC
	LDA.b #$F0
	BRA.b CODE_17860D

CODE_1785FC:
	LDA.w $012B
	BPL.b CODE_17860F
	LDA.b #$01
	STA.w $012B
	LDX.w !RAM_YI_Level_FinalWorldUnlockedFlagLo
	BEQ.b CODE_17860D
	INC
	INC
CODE_17860D:
	STA.b !RAM_YI_Global_PlayMusicLo
CODE_17860F:
	LDA.w $098E
	BNE.b CODE_17861F
	LDA.b #$1F
	STA.w $0990
	STA.w $0992
	STA.w $0994
CODE_17861F:
	STZ.w $098E
	JSL.l CODE_enable_nmi
	JSL.l CODE_gm_fade_to_title_screen_jsl_entry
	LDA.w $0982
	STA.w $0980
CODE_178630:
	LDA.w $0980
	BNE.b CODE_178630
	LDA.w $0984
	EOR.b #$01
	STA.w $0984
	LDA.b #$0F
	STA.w $0200
	JSR.w CODE_178649
	JML.l CODE_increment_gamemode

;---------------------------------------------------------------------------

CODE_178649:
	LDA.w $0201
	ASL
	ASL
	TAX
	LDY.b #$04
CODE_178651:
	LDA.l DATA_00C214,x
	STA.w $0996,y
	INX
	DEY
	DEY
	BPL.b CODE_178651
	INC.w $098E
	RTS

;---------------------------------------------------------------------------

CODE_178661:
	STZ.w $6CA2
	LDA.w $011A
	BEQ.b CODE_178673
CODE_178669:
	LDA.b #$03
	STA.w $0988
	LDA.b #$06
	STA.w $098A
CODE_178673:
	RTS

;---------------------------------------------------------------------------

DATA_178674:					; Note: Title screen OAM data
	db $50,$28,$00,$2E
	db $70,$28,$04,$2E
	db $90,$28,$08,$2E
	db $30,$48,$40,$2E
	db $50,$48,$44,$2E
	db $70,$48,$48,$2E
	db $90,$48,$4C,$2E
	db $B0,$48,$0C,$2E
	db $20,$68,$80,$2E
	db $40,$68,$84,$2E
	db $60,$68,$88,$2E
	db $80,$68,$8C,$2E
	db $A0,$68,$40,$2F
	db $C0,$68,$44,$2F
	db $20,$88,$C0,$2E
	db $40,$88,$C4,$2E
	db $60,$88,$C8,$2E
	db $80,$88,$CC,$2E
	db $20,$A8,$00,$2F
	db $40,$A8,$04,$2F
	db $60,$A8,$08,$2F
	db $80,$A8,$0C,$2F
	db $A0,$98,$48,$2F
	db $C0,$98,$4C,$2F
	db $A0,$88,$80,$2F
	db $B0,$88,$82,$2F
	db $C0,$88,$84,$2F
	db $D0,$88,$86,$2F
	db $A0,$B8,$88,$2F
	db $B0,$B8,$8A,$2F
	db $C0,$B8,$8C,$2F
	db $D0,$B8,$8E,$2F
	db $10,$78,$A0,$2F
	db $10,$88,$A2,$2F
	db $10,$98,$A4,$2F
	db $10,$A8,$A6,$2F
	db $E0,$78,$A8,$2F
	db $E0,$88,$AA,$2F
	db $E0,$98,$AC,$2F
	db $E0,$A8,$AE,$2F

DATA_178714:
	dw $AAAA,$AAAA,$AAAA,$0000,$0000

DATA_17871E:
	dw DATA_17872E,DATA_178750,DATA_178766,DATA_17877F

DATA_178726:
	dw $7F56DE,$7F64DE,$7F72DE,$7F80DE

DATA_17872E:
	db $00,$3C,$0C,$80,$5A,$04,$20,$3C,$0C,$A0,$5A,$04,$40,$3C,$0C,$C0
	db $5A,$04,$60,$3C,$0C,$E0,$5A,$04,$80,$32,$10,$A0,$32,$10,$C0,$32
	db $10,$FF

DATA_178750:
	db $E0,$32,$10,$00,$2E,$10,$20,$2E,$10,$40,$2E,$10,$60,$2E,$10,$80
	db $2E,$10,$A0,$2E,$10,$FF

DATA_178766:
	db $C0,$2E,$10,$E0,$2E,$10,$00,$2F,$10,$20,$2F,$10,$40,$2F,$10,$60
	db $2F,$10,$00,$56,$08,$C0,$56,$08,$FF

DATA_17877F:
	db $20,$56,$08,$E0,$56,$08,$40,$56,$08,$00,$57,$08,$60,$56,$08,$20
	db $57,$08,$80,$56,$08,$40,$57,$08,$A0,$56,$08,$60,$57,$08,$40,$29
	db $02,$80,$29,$02,$C0,$29,$02,$00,$2A,$02,$40,$6A,$02,$80,$6A,$02
	db $C0,$6A,$02,$00,$6B,$02,$60,$29,$02,$A0,$29,$02,$E0,$29,$02,$20
	db $2A,$02,$60,$6A,$02,$A0,$6A,$02,$E0,$6A,$02,$20,$6B,$02,$FF

DATA_1787CE:
	dw $0000,$7FFF

;-------------------------------------------------------------------------
; CODE_gm_fade_to_title_screen_jsl_entry / CODE_gm_fade_to_title_screen -- CODE_gm_fade_to_title_screen (game-mode $0A entry).
; Raidenthequick: `CODE_gm_fade_to_title_screen` at $17:87D5 (entry $1787D2 is the
; PHB/PHK/PLB prologue used when entered via JSL from outside this bank).
;
; INPUTS:
;   M=8 X=8 from gamemode dispatcher.
;   $7E:011A = high-score-display request flag (post-cart-reset path skips fade).
;   $70:7E7C = current cursor save-slot (used to derive icons).
; OUTPUTS:
;   OAM regions $7E:6A80/$7E:6C08 refilled from DATA_178674 / DATA_178714.
;   $7E:0118 advances to mode $0B/$0C (post-fade) on completion.
;   Title-screen sprite buffer animations tick (`$093D` controller mirror used).
; MODIFIES: A, X, Y, DBR (PHB/PLB pair), DP $00..$0F.
; CALLERS:
;   Bank00 `DATA_game_mode_pointers[$0A]` -- per-frame tick.
;   Bank00 `DATA_game_mode_pointers[$19]` -- post-Bowser cutscene re-entry.
;-------------------------------------------------------------------------
CODE_1787D2:
CODE_gm_fade_to_title_screen_jsl_entry:			; entry used by external JSL callers
	PHB
	PHK
	PLB
CODE_1787D5:
CODE_gm_fade_to_title_screen:				; Raiden alias
	JSL.l CODE_init_oam
	REP.b #$30
	LDX.w #$009E
CODE_1787DE:
	LDA.w DATA_178674,x
	STA.l $006A80,x
	DEX
	DEX
	BPL.b CODE_1787DE
	LDX.w #$0008
CODE_1787EC:
	LDA.w DATA_178714,x
	STA.l $006C08,x
	DEX
	DEX
	BPL.b CODE_1787EC
	SEP.b #$30
	LDA.w $011A
	BMI.b CODE_178809
	LDA.w $0214
	BEQ.b CODE_178809
	JSR.w CODE_1794E1
	JMP.w CODE_1788BE

CODE_178809:
	REP.b #$20
	LDX.b #FXCODE_08C745>>16
	LDA.w #FXCODE_08C745
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	JSR.w CODE_178919
	LDA.b $30
	AND.b #$07
	ASL
	TAX
	REP.b #$20
	LDA.l DATA_5FC77E,x
	STA.l YI_Global_PaletteMirror[$F7].LowByte
	LDX.b #FXCODE_08C701>>16
	LDA.w #FXCODE_08C701
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b #FXCODE_08C7CA>>16
	LDA.w #FXCODE_08C7CA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
CODE_17883D:
	LDA.w $0980
	BNE.b CODE_17883D
CODE_178842:
	LDA.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BPL.b CODE_178842
CODE_178847:
	LDA.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BMI.b CODE_178847
	REP.b #$20
	LDA.w $0A04
	CLC
	ADC.w #$0020
	AND.w #$07FE
	STA.w $0A04
	STA.b $04
	STZ.b $06
	LDA.w #$706E00
	STA.b $23
	LDA.w #$706E00>>16
	STA.b $25
	LDX.b #$06
CODE_17886B:
	STX.b $00
	LDA.l DATA_17871E,x
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_17872E>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_08C712>>16
	LDA.w #FXCODE_08C712
	JSL.l !RAM_YI_Global_RT_00E152
	LDX.b $00
	LDA.w #$7F56DE>>8
	STA.b $21
	LDA.w DATA_178726,x
	STA.b $20
	SEP.b #$20
CODE_178891:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVC.b CODE_178891
CODE_178896:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVS.b CODE_178896
	LDY.b #$04
CODE_17889D:
	DEY
	BNE.b CODE_17889D
	REP.b #$20
	LDA.w #$0E00
	JSL.l CODE_dma_wram_gen_purpose
	DEX
	DEX
	BPL.b CODE_17886B
	LDA.w $0984
	EOR.w #$0001
	STA.w $0984
	LDA.w #$0003
	STA.w $0982
	SEP.b #$20
CODE_1788BE:
	LDA.w $098E
	BNE.b CODE_1788CD
	LDA.w $0988
	BEQ.b CODE_178909
	JSR.w CODE_178FB6
	BRA.b CODE_178909

CODE_1788CD:
	LDA.w $0201
	ASL
	TAX
	REP.b #$20
	LDA.w $0994
	ASL
	ASL
	ASL
	ASL
	ASL
	ORA.w $0992
	ASL
	ASL
	ASL
	ASL
	ASL
	ORA.w $0990
	CMP.w DATA_1787CE,x
	SEP.b #$20
	BNE.b CODE_178909
	STZ.w $098E
	LDA.w $0201
	TAX
	LDA.w DATA_17890B,x
	STA.w $0200
	TXA
	EOR.b #$01
	STA.w $0201
	BNE.b CODE_178909
	LDA.w $099C
	STA.w !RAM_YI_Global_CurrentGameMode
CODE_178909:
	PLB
	RTL

DATA_17890B:
	db $0F,$00

;---------------------------------------------------------------------------

DATA_17890D:
	dw CODE_178933
	dw CODE_17896A
	dw CODE_1789A8
	dw CODE_178A9E
	dw CODE_178FA3
	dw CODE_178D93

CODE_178919:
	LDY.b #$3C
CODE_17891B:
	LDX.w $09C1,y
	BEQ.b CODE_17892C
	LDA.w $09C4,y
	BEQ.b CODE_178929
	DEC
	STA.w $09C4,y
CODE_178929:
	JSR.w (DATA_17890D-$02,x)
CODE_17892C:
	DEY
	DEY
	DEY
	DEY
	BPL.b CODE_17891B
	RTS

CODE_178933:
	STZ.b $00
	STZ.b $01
	LDA.w $09C2,y
	INC
	STA.w $09C2,y
	LDX.b #$40
	JMP.w CODE_1789D2

DATA_178943:
	db $00,$00,$00,$FF,$00,$01,$01,$00,$FF,$FF,$00,$01,$00

DATA_178950:
	db $00,$00,$00,$FF,$00,$01,$01,$00,$FF,$FF,$00,$01,$00

DATA_17895D:
	db $1C,$1D,$1E,$1E,$1E,$1E,$1E,$1E,$1E,$1F,$20,$21,$22

CODE_17896A:
	LDA.w $702F,y
	INC
	INC
	STA.w $702F,y
	LDX.w $09C2,y
	INX
	CPX.b #$0D
	BCC.b CODE_178981
	LDX.b #$00
	LDA.b #$1A
	STA.w $702F,y
CODE_178981:
	TXA
	STA.w $09C2,y
	LDA.w $702D,y
	CLC
	ADC.w DATA_178943,x
	STA.w $702D,y
	LDA.w $702E,y
	CLC
	ADC.w DATA_178950,x
	STA.w $702E,y
	LDA.w DATA_17895D,x
	STA.w $702C,y
	RTS

DATA_1789A0:
	db $23,$24,$25,$26,$27,$28,$29,$2A

CODE_1789A8:
	LDX.w $09C3,y
	INX
	CPX.b #$08
	BCC.b CODE_1789B2
	LDX.b #$00
CODE_1789B2:
	TXA
	STA.w $09C3,y
	LDA.w DATA_1789A0,x
	STA.w $702C,y
	LDA.b #$B6
	STA.b $00
	LDA.b #$F0
	STA.b $01
	LDA.w $09C2,y
	CLC
	ADC.b #$04
	STA.w $09C2,y
	LDX.b #$10
	JMP.w CODE_1789D2

CODE_1789D2:
	STX.b $02
	REP.b #$30
	AND.w #$00FF
	ASL
	TAX
	LDA.l DATA_cosine_lut_8bit_radians,x
	STA.b $03
	BPL.b CODE_1789E7
	EOR.w #$FFFF
	INC
CODE_1789E7:
	CMP.w #$0100
	SEP.b #$20
	BCS.b CODE_178A05
	STA.w !REGISTER_Multiplicand
	LDA.b $02
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderLo
	ASL
	LDA.w !REGISTER_ProductOrRemainderHi
	ADC.b #$00
	BRA.b CODE_178A07

CODE_178A05:
	LDA.b $02
CODE_178A07:
	BIT.b $04
	BPL.b CODE_178A0E
	EOR.b #$FF
	INC
CODE_178A0E:
	CLC
	ADC.b $00
	STA.w $702D,y
	REP.b #$20
	LDA.l DATA_sine_lut_8bit_radians,x
	STA.b $03
	BPL.b CODE_178A22
	EOR.w #$FFFF
	INC
CODE_178A22:
	CMP.w #$0100
	SEP.b #$20
	BCS.b CODE_178A40
	STA.w !REGISTER_Multiplicand
	LDA.b $02
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderLo
	ASL
	LDA.w !REGISTER_ProductOrRemainderHi
	ADC.b #$00
	BRA.b CODE_178A42

CODE_178A40:
	LDA.b $02
CODE_178A42:
	BIT.b $04
	BPL.b CODE_178A49
	EOR.b #$FF
	INC
CODE_178A49:
	CLC
	ADC.b $01
	STA.w $702E,y
	SEP.b #$10
	RTS

DATA_178A52:
	dw $01FF,$04FC

DATA_178A56:
	dw $302B,$3A35,$443F,$4E49,$312C,$3B36,$4540,$4F4A
	dw $322D,$3C37,$4641,$504B,$332E,$3D38,$4742,$514C
	dw $342F,$3E39,$4843,$524D,$312C,$3B53,$4540,$4F57
	dw $322D,$3C54,$4641,$5058,$332E,$3D55,$4742,$5159
	dw $342F,$3E56,$4843,$525A

CODE_178A9E:
	REP.b #$20
	STZ.w $099E
	SEP.b #$20
	LDX.w $6CA2
	JSR.w (DATA_178B45,x)
	LDA.w $6CA5
	STA.w $702D,y
	LDA.w $6CA7
	STA.w $702E,y
	LDA.w $6CA9
	STA.w $702F,y
	PHY
	LDA.w $702D,y
	STA.b $00
	LDA.w $702E,y
	STA.b $01
	JSR.w CODE_178F32
	LDA.b #$C0
	SEC
	SBC.b $02
	LDX.w $011A
	BNE.b CODE_178AF5
	LDX.w $0988
	BEQ.b CODE_178AFF
	LDX.b #$03
	SEC
	SBC.w $6CA0
CODE_178AE0:
	BNE.b CODE_178AE7
	INC.w $011A
	BRA.b CODE_178B1C

CODE_178AE7:
	BPL.b CODE_178AEA
	DEX
CODE_178AEA:
	PHA
	CLC
	ADC.b #$04
	CMP.b #$09
	PLA
	BCC.b CODE_178B02
	BRA.b CODE_178AFF

CODE_178AF5:
	LDX.b #$01
	CMP.w $6CA0
	BEQ.b CODE_178B1C
	BPL.b CODE_178AFF
	DEX
CODE_178AFF:
	LDA.w DATA_178A52,x
CODE_178B02:
	PHA
	CLC
	ADC.w $6CA0
	STA.w $6CA0
	PLA
	XBA
	REP.b #$20
	AND.w #$FF00
	BPL.b CODE_178B16
	ORA.w #$00FF
CODE_178B16:
	XBA
	STA.w $099E
	SEP.b #$20
CODE_178B1C:
	PLY
	LDA.w $6CA2
	CMP.b #$18
	BCS.b CODE_178B44
	LDA.w $021F
	ASL
	ASL
	ASL
	STA.b $00
	LDA.w $021E
	CLC
	ADC.w $6CA0
	CLC
	ADC.b #$10
	LSR
	LSR
	LSR
	LSR
	LSR
	ORA.b $00
	TAX
	LDA.w DATA_178A56,x
	STA.w $702C,y
CODE_178B44:
	RTS

DATA_178B45:
	dw CODE_178B7E
	dw CODE_178B67
	dw CODE_178DFE
	dw CODE_178BB4
	dw CODE_178BBF
	dw CODE_178B6E
	dw CODE_178BF0
	dw CODE_178BFB
	dw CODE_178B6E
	dw CODE_178C3E
	dw CODE_178C49
	dw CODE_178C71
	dw CODE_178CCD
	dw CODE_178CE8
	dw CODE_178D26
	dw CODE_178D5B
	dw CODE_178D6A

CODE_178B67:
	INC.w $6CA2
	INC.w $6CA2
	RTS

CODE_178B6E:
	REP.b #$20
	DEC.w $0977
	BNE.b CODE_178B7B
	INC.w $6CA2
	INC.w $6CA2
CODE_178B7B:
	SEP.b #$20
	RTS

CODE_178B7E:
	STZ.w $021F
	LDA.w $098E
	ORA.w $0988
	BNE.b CODE_178BB3
	LDA.w $011A
	BNE.b CODE_178BB3
	REP.b #$20
	DEC.w $1405
	SEP.b #$20
	LDA.w $1405
	ORA.w $1406
	BNE.b CODE_178BA6
	LDA.b #$04
	STA.w $099C
	INC.w $098E
	RTS

CODE_178BA6:
	LDA.b $35
	AND.b #$C0
	ORA.b $36
	AND.b #$D0
	BEQ.b CODE_178BB3
	INC.w $0988
CODE_178BB3:
	RTS

CODE_178BB4:
	LDA.b #!Define_YI_SoundID87_CastleAboutToExplode
	JSR.w CODE_178F9C
	INC.w $6CA2
	INC.w $6CA2
CODE_178BBF:
	REP.b #$30
	LDX.w $096D
	LDA.w $7286,x
	CLC
	ADC.w #$0010
	STA.w $7286,x
	CMP.w #$01F0
	BCC.b CODE_178BED
	INC.w $6CA2
	INC.w $6CA2
	STZ.w $0970
	LDA.w #$0010
	STA.w $0977
	CPX.w #$0168
	BNE.b CODE_178BED
	LDA.w #$008A
	STA.w $7044
CODE_178BED:
	SEP.b #$30
	RTS

CODE_178BF0:
	LDA.b #!Define_YI_SoundID99_BigExplosion
	JSR.w CODE_178F9C
	INC.w $6CA2
	INC.w $6CA2
CODE_178BFB:
	LDA.b $30
	AND.b #$01
	BNE.b CODE_178C3D
	REP.b #$10
	LDX.w $096D
	LDA.w $0970
	PHA
	CLC
	ADC.b #$74
	STA.w $702C,x
	PLA
	LSR
	CLC
	ADC.w $702F,x
	STA.w $702F,x
	LDA.b #$00
	STA.w $7286,x
	INC.w $0970
	LDA.w $0970
	CMP.b #$0B
	BCC.b CODE_178C3B
	LDA.b #$00
	STA.w $702C,x
	LDA.b #$10
	STA.w $0977
	INC.w $6CA2
	INC.w $6CA2
	STZ.w $0970
CODE_178C3B:
	SEP.b #$10
CODE_178C3D:
	RTS

CODE_178C3E:
	LDA.b #!Define_YI_SoundID97_WorldClear
	JSR.w CODE_178F9C
	INC.w $6CA2
	INC.w $6CA2
CODE_178C49:
	REP.b #$30
	LDA.w !RAM_YI_Level_CurrentWorldLo
	ASL
	TAX
	SEP.b #$20
	LDA.w $0970
	CLC
	ADC.b #$7E
	STA.w $702C,x
	SEP.b #$10
	INC.w $0970
	LDA.w $0970
	CMP.b #$0A
	BCC.b CODE_178C70
	INC.w $6CA2
	INC.w $6CA2
	STZ.w $0970
CODE_178C70:
	RTS

CODE_178C71:
	REP.b #$30
	LDA.w !RAM_YI_Level_CurrentWorldLo
	ASL
	TAX
	SEP.b #$20
	LDA.w $0970
	AND.b #$03
	CLC
	ADC.b #$86
	STA.w $702C,x
	SEP.b #$10
	INC.w $0970
	LDA.w $0970
	CMP.b #$30
	BCC.b CODE_178CCC
	STZ.w $0970
	CPX.b #$14
	BNE.b CODE_178CAE
	INC.w $6CA2
	INC.w $6CA2
	LDA.b #$8B
	STA.w $702C
	LDA.w $6CA9
	SEC
	SBC.b #$0C
	STA.w $6CA9
	BRA.b CODE_178CCC

CODE_178CAE:
	LDA.b #$0A
	STA.w $09C1,x
	STZ.w $6CA2
	CPX.b #$18
	BCC.b CODE_178CC4
	LDA.b #$0C
	STA.w $09FD
	STZ.w $09C1
	BRA.b CODE_178CCC

CODE_178CC4:
	LDA.b #$20
	STA.w $099C
	INC.w $098E
CODE_178CCC:
	RTS

CODE_178CCD:
	REP.b #$20
	LDA.w $6CA8
	CLC
	ADC.w #$0080
	STA.w $6CA8
	SEP.b #$20
	LDA.w $0970
	CMP.b #$20
	BCC.b CODE_178CE8
	INC.w $6CA2
	INC.w $6CA2
CODE_178CE8:
	LDA.w $0970
	AND.b #$03
	CLC
	ADC.b #$8C
	STA.w $702C
	INC.w $0970
	LDA.w $0970
	CMP.b #$40
	BCC.b CODE_178D0A
	LDA.b #$80
	STA.w $011A
	LDA.b #$09
	STA.w $099C
	INC.w $098E
CODE_178D0A:
	REP.b #$30
	LDA.w !RAM_YI_Level_CurrentWorldLo
	ASL
	TAX
	SEP.b #$20
	LDA.w $0970
	AND.b #$03
	CLC
	ADC.b #$86
	STA.w $702C,x
	SEP.b #$10
	LDA.b #$C0
	STA.w $1139
	RTS

CODE_178D26:
	LDA.b #$C0
	STA.w $1139
	LDA.w $0970
	AND.b #$03
	CLC
	ADC.b #$8C
	STA.w $702C
	INC.w $0970
	REP.b #$20
	LDA.w $6CA8
	SEC
	SBC.w #$0100
	STA.w $6CA8
	XBA
	SEP.b #$20
	CMP.b #$10
	BCS.b CODE_178D5A
	STZ.w $1139
	INC.w $6CA2
	INC.w $6CA2
	LDA.b #$8B
	STA.w $702C
CODE_178D5A:
	RTS

CODE_178D5B:
	LDA.w $6CA9
	CLC
	ADC.b #$0C
	STA.w $6CA9
	INC.w $6CA2
	INC.w $6CA2
CODE_178D6A:
	LDA.b #$3F
	STA.w $702C
	REP.b #$20
	LDA.w $6CA8
	SEC
	SBC.w #$0080
	STA.w $6CA8
	BPL.b CODE_178D8C
	STZ.w $6CA8
	STZ.w $6CA2
	LDA.w #$001F
	STA.w $099C
	INC.w $098E
CODE_178D8C:
	SEP.b #$20
	RTS

DATA_178D8F:
	dw CODE_178DCA
	dw CODE_178DE5

CODE_178D93:
	LDX.w $6CA2
	JSR.w (DATA_178D8F,x)
	LDX.w $09C2,y
	INX
	CPX.b #$08
	BCC.b CODE_178DA3
	LDX.b #$00
CODE_178DA3:
	TXA
	STA.w $09C2,y
	BNE.b CODE_178DAE
	LDA.b #!Define_YI_SoundID9F_StorkFlappingWings
	JSR.w CODE_178F9C
CODE_178DAE:
	LDA.w DATA_1789A0,x
	STA.w $702C,y
	LDA.b #$09
	STA.b $00
	LDA.b #$16
	STA.b $01
	LDA.w $09C3,y
	CLC
	ADC.b #$04
	STA.w $09C3,y
	LDX.b $10
	JMP.w CODE_1789D2

CODE_178DCA:
	LDA.w $702F,y
	INC
	STA.w $702F,y
	CMP.b #$40
	BCC.b CODE_178DDB
	INC.w $6CA2
	INC.w $6CA2
CODE_178DDB:
	LSR
	CMP.b #$10
	BCC.b CODE_178DE2
	LDA.b #$10
CODE_178DE2:
	STA.b $10
	RTS

CODE_178DE5:
	LDA.b #$10
	STA.b $10
	INC.w $0970
	LDA.w $0970
	CMP.b #$30
	BCC.b CODE_178DFD
	LDA.w !RAM_YI_Global_CurrentGameMode
	INC
	STA.w $099C
	INC.w $098E
CODE_178DFD:
	RTS

CODE_178DFE:
	LDA.w $098E
	BNE.b CODE_178E41
	LDA.w $09C2,y
	BNE.b CODE_178E27
	REP.b #$10
	LDX.w $021C
	LDA.l DATA_yoshi_cinema_path_data+$01,x
	STA.w $0972
	LDA.l DATA_yoshi_cinema_path_data+$02,x
	STA.w $0973
	LDA.l DATA_yoshi_cinema_path_data+$03,x
	STA.w $0974
	SEP.b #$10
	JSR.w CODE_178E42
CODE_178E27:
	JSR.w CODE_178EE0
	LDA.w $021F
	INC
	PHA
	AND.b #$03
	BNE.b CODE_178E37
	LDA.b #!Define_YI_SoundID9B_YoshiHeadStuck
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
CODE_178E37:
	PLA
	CMP.b #$09
	BCC.b CODE_178E3E
	LDA.b #$01
CODE_178E3E:
	STA.w $021F
CODE_178E41:
	RTS

CODE_178E42:
	PHY
	LDA.w $0972
	SEC
	SBC.w $702D,y
	STA.b $03
	BPL.b CODE_178E51
	EOR.b #$FF
	INC
CODE_178E51:
	STA.b $04
	LDA.w $0973
	SEC
	SBC.w $702E,y
	STA.b $05
	BPL.b CODE_178E61
	EOR.b #$FF
	INC
CODE_178E61:
	STA.b $06
	LDA.w $0974
	SEC
	SBC.w $702F,y
	STA.b $07
	BPL.b CODE_178E71
	EOR.b #$FF
	INC
CODE_178E71:
	STA.b $08
	LDY.b #$04
	CMP.b $06
	BCS.b CODE_178E7D
	LDY.b #$02
	LDA.b $06
CODE_178E7D:
	CMP.b $04
	BCS.b CODE_178E85
	LDY.b #$00
	LDA.b $04
CODE_178E85:
	STA.w $0976
	STY.b $09
	LDX.b #$04
CODE_178E8C:
	CPX.b $09
	BNE.b CODE_178E97
	REP.b #$20
	LDA.w #$0200
	BRA.b CODE_178EB2

CODE_178E97:
	STZ.w !REGISTER_DividendLo
	LDA.b $04,x
	STA.w !REGISTER_DividendHi
	LDA.w $0004,y
	STA.w !REGISTER_Divisor
	NOP #7
	REP.b #$20
	LDA.w !REGISTER_QuotientLo
	ASL
CODE_178EB2:
	BIT.b $02,x
	BPL.b CODE_178EBA
	EOR.w #$FFFF
	INC
CODE_178EBA:
	STA.w $097A,x
	SEP.b #$20
	DEX
	DEX
	BPL.b CODE_178E8C
	STZ.w $6CA4
	STZ.w $6CA6
	STZ.w $6CA8
	LDA.b $03
	STA.b $00
	LDA.b $05
	STA.b $01
	JSR.w CODE_178F32
	PLY
	STA.w $021E
	TYX
	INC.w $09C2,x
	RTS

CODE_178EE0:
	REP.b #$20
	LDX.b #$04
CODE_178EE4:
	LDA.w $6CA4,x
	CLC
	ADC.w $097A,x
	STA.w $6CA4,x
	DEX
	DEX
	BPL.b CODE_178EE4
	SEP.b #$20
	DEC.w $0976
	DEC.w $0976
	BMI.b CODE_178EFE
	BNE.b CODE_178F31
CODE_178EFE:
	REP.b #$10
	LDX.w $021C
	LDA.l DATA_yoshi_cinema_path_data,x
	BPL.b CODE_178F12
	INC.w $6CA2
	INC.w $6CA2
	JSR.w CODE_178669
CODE_178F12:
	INX
	INX
	INX
	INX
	STX.w $021C
	SEP.b #$10
	TYX
	STZ.w $09C2,x
	LDA.w $0972
	STA.w $6CA5
	LDA.w $0973
	STA.w $6CA7
	LDA.w $0974
	STA.w $6CA9
CODE_178F31:
	RTS

CODE_178F32:
	LDX.b #$00
	LDA.b $00
	BPL.b CODE_178F3D
	LDX.b #$04
	EOR.b #$FF
	INC
CODE_178F3D:
	STA.b $02
	LDA.b $01
	BPL.b CODE_178F48
	INX
	INX
	EOR.b #$FF
	INC
CODE_178F48:
	LDY.b $02
	CMP.b $02
	BEQ.b CODE_178F54
	BCC.b CODE_178F54
	INX
	TAY
	LDA.b $02
CODE_178F54:
	STZ.w !REGISTER_DividendLo
	STA.w !REGISTER_DividendHi
	STY.w !REGISTER_Divisor
	STY.b $02
	STZ.b $03
	TXA
	ASL
	TAX
	NOP #4
	REP.b #$30
	LDA.w !REGISTER_ProductOrRemainderLo
	ASL
	SEC
	SBC.b $02
	LDA.w !REGISTER_QuotientLo
	ADC.w #$0000
	ASL
	TAY
	CPY.w #$0202
	BCC.b CODE_178F81
	LDY.w #$0200
CODE_178F81:
	LDA.l DATA_048153,x
	ASL
	STA.b $02
	TYX
	LDA.l FXDATA_0BB810,x
	BCC.b CODE_178F93
	EOR.w #$FFFF
	INC
CODE_178F93:
	CLC
	ADC.b $02
	LSR
	SEP.b #$30
	STA.b $02
CODE_178F9B:
	RTS

CODE_178F9C:
	PHY
	JSL.l CODE_push_sound_queue
	PLY
	RTS

CODE_178FA3:
	LDA.w $09C2,y
	CLC
	ADC.b #$86
	STA.w $702C,y
	LDA.w $09C2,y
	INC
	AND.b #$03
	STA.w $09C2,y
	RTS

;---------------------------------------------------------------------------

CODE_178FB6:
	ASL
	TAX
	JMP.w (DATA_178FBB-$02,x)

DATA_178FBB:
	dw CODE_178FD3
	dw CODE_178FDB
	dw CODE_178FDB
	dw CODE_17906D

DATA_178FC3:
	dw $7E7BBE,$7E83BE,$7E7BBF,$7E83BF,$7E7BBE,$7E83BE,$7E7BBF,$7E83BF

CODE_178FD3:
	LDA.b #$0E
	STA.w $098A
	INC.w $0988
CODE_178FDB:
	PHB
	LDY.w $098A
	REP.b #$10
	LDX.w DATA_178FC3,y
	STX.b $00
	LDA.b #$7E7BBE>>16
	PHA
	PLB
	CPY.w #$0008
	LDY.w #$0200
	BCC.b CODE_178FFC
CODE_178FF2:
	STZ.w $0000,x
	INX
	INX
	DEY
	BNE.b CODE_178FF2
	BRA.b CODE_179007

CODE_178FFC:
	LDA.w $0400,x
	STA.w $0000,x
	INX
	INX
	DEY
	BNE.b CODE_178FFC
CODE_179007:
	LDA.b #$7E4800>>16
	PHA
	PLB
	REP.b #$20
	LDX.w $7E4800
	LDA.w #$3800
	STA.w $0000,x
	LDA.b $00
	STA.w $0005,x
	LSR
	BCC.b CODE_179021
	INC.w $0000,x
CODE_179021:
	LDY.w #$1800
	AND.w #$0400
	BNE.b CODE_17902F
	LDA.w #$0080
	LDY.w #$1900
CODE_17902F:
	STA.w $0002,x
	TYA
	STA.w $0003,x
	LDA.w #$007E
	STA.w $0007,x
	LDA.w #$03FF
	STA.w $0008,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,x
	STA.w $7E4800
	SEP.b #$30
	PLB
	DEC.w $098A
	DEC.w $098A
	BMI.b CODE_179069
	LDA.w $098A
	CMP.b #$06
	BNE.b CODE_17906C
	LDA.b #$CE
	STA.w !RAM_YI_Global_HDMAEnable
	LDA.b #$11
	STA.w !RAM_YI_Global_MainScreenLayers
CODE_179069:
	INC.w $0988
CODE_17906C:
	RTS

CODE_17906D:
	LDA.w $011A
	BEQ.b CODE_1790DF
	BMI.b CODE_1790DF
	LDA.w $0984
	EOR.b #$01
	BNE.b CODE_1790DF
	STA.w $0984
	STZ.w $0982
	STZ.w $099E
	STZ.w $099F
	LDX.b #$04
CODE_179089:
	LDA.w DATA_178041,x
	STA.w HDMA[$05].Parameters,x
	LDA.w DATA_17805C,x
	STA.w HDMA[$04].Parameters,x
	DEX
	BPL.b CODE_179089
	LDX.b #$1E
CODE_17909A:
	LDA.w DATA_178046,x
	STA.l $7E5C18,x
	LDA.w DATA_178061,x
	STA.l $7E5C98,x
	DEX
	BPL.b CODE_17909A
	JSR.w CODE_179466
	INC.w $0214
	LDA.b #$41
	STA.w !RAM_YI_Global_BGModeAndTileSizeSetting
	LDA.b #$17
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.b #$30
	STA.w !RAM_YI_Global_BG1AddressAndSize
	STA.w !RAM_YI_Global_BG2AddressAndSize
	LDA.b #!REGISTER_BG3HorizScrollOffset
	STA.w $09A0
	REP.b #$20
	STZ.b !RAM_YI_Global_Layer4XPosLo
	STZ.b !RAM_YI_Global_Layer4YPosLo
	STZ.b !RAM_YI_Global_Layer2XPosLo
	LDA.w #$0080
	STA.b !RAM_YI_Global_Layer2YPosLo
	SEP.b #$20
	LDA.b #$FE
	STA.w !RAM_YI_Global_HDMAEnable
	STZ.w $0988
CODE_1790DF:
	RTS

;---------------------------------------------------------------------------

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
DATA_179123:
	db $15,$15,$15,$15,$15,$15,$15,$15,$15,$15,$15,$15,$11,$11,$11,$11
	db $11,$11,$11,$11,$11,$11,$11,$11,$E0,$90,$EC,$90,$E0,$90
endif

CODE_1790E0:
	JSR.w CODE_17942D
	JSR.w CODE_17912F
	LDA.l $707E7C
	TAX
	LDA.w DATA_1796BE,x
	STA.w $1109
	LDA.b #$3A
	STA.w $110A
	REP.b #$20
	LDA.w #$000E
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #DATA_179123>>16
	STA.w $6000
	LDA.w #DATA_179123
	STA.w $6002
	LDX.b #FXCODE_08D995>>16
	LDA.w #FXCODE_08D995
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	LDA.b #$01
	STA.w $1117
	LDA.b #$06
	STA.w $1113
	STZ.w $1114
	RTS

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
else
DATA_179123:
	db $15,$15,$15,$15,$15,$15,$15,$15,$15,$15,$15,$15
endif

;---------------------------------------------------------------------------

CODE_17912F:
	REP.b #$30
	LDX.w #$0000
	LDA.w $1106
	AND.w #$0001
	BEQ.b CODE_17913F
	LDX.w #$0380
CODE_17913F:
	STX.b $10
	LDA.w $1129
	ASL
	TAX
	LDA.w DATA_1793C3,x
	STA.b $12
	LDX.b $10
	LDY.w #$007F
	LDA.w #$21BF
CODE_179153:
	STA.w $0A06,x
	STA.w $0B06,x
	STA.w $0C06,x
	INX
	INX
	DEY
	BPL.b CODE_179153
	LDX.b $10
	LDY.w #$0000
CODE_179166:
	LDA.w DATA_1792C7,y
	ORA.b $12
	STA.w $0A0E,x
	LDA.w DATA_1792F7,y
	ORA.b $12
	STA.w $0A4E,x
	LDA.w DATA_179327,y
	ORA.b $12
	STA.w $0A8E,x
	STA.w $0ACE,x
	STA.w $0B0E,x
	STA.w $0B4E,x
	STA.w $0B8E,x
	STA.w $0BCE,x
	STA.w $0C0E,x
	STA.w $0C4E,x
	STA.w $0C8E,x
	LDA.w DATA_179357,y
	ORA.b $12
	STA.w $0CCE,x
	INX
	INX
	INY
	INY
	CPY.w #$0030
	BCC.b CODE_179166
	LDX.b $10
	LDY.w #$0000
CODE_1791AC:
	LDA.w DATA_179387,y
	STA.w $0AB2,x
	LDA.w DATA_179391,y
	STA.w $0AF2,x
	STA.w $0B32,x
	STA.w $0B72,x
	STA.w $0BB2,x
	STA.w $0BF2,x
	STA.w $0C32,x
	STA.w $0C72,x
	LDA.w DATA_17939B,y
	STA.w $0CB2,x
	INX
	INX
	INY
	INY
	CPY.w #$000A
	BCC.b CODE_1791AC
	LDX.b $10
	LDY.w #$0000
CODE_1791DE:
	LDA.w DATA_1793A5,y
	ORA.b $12
	STA.w $0BD2,x
	LDA.w DATA_1793AF,y
	ORA.b $12
	STA.w $0BDC,x
	LDA.w DATA_1793B9,y
	ORA.b $12
	STA.w $0BE6,x
	INX
	INX
	INY
	INY
	CPY.w #$000A
	BCC.b CODE_1791DE
	LDA.w $1106
	AND.w #$0001
	XBA
	LSR
	STA.b $02
	LDX.b $10
	LDY.w #$000D
	LDA.w #$2200
	ORA.b $02
	ORA.b $12
	STA.b $00
CODE_179217:
	LDA.b $00
	STA.w $0A54,x
	ORA.w #$0010
	STA.w $0A94,x
	INC.b $00
	INX
	INX
	DEY
	BNE.b CODE_179217
	LDX.b $10
	LDY.w #$0010
	LDA.w #$2220
	ORA.b $02
	ORA.b $12
	STA.b $00
CODE_179237:
	LDA.b $00
	STA.w $0C50,x
	ORA.w #$0010
	STA.w $0C90,x
	INC.b $00
	INX
	INX
	DEY
	BNE.b CODE_179237
	LDA.b $00
	CLC
	ADC.w #$0010
	STA.w $0C50,x
	ORA.w #$0010
	STA.w $0C90,x
	SEP.b #$10
	LDX.b #$00
CODE_17925C:
	LDA.w $1123,x
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_1793E1,y
	ORA.w DATA_1793F9,y
	STA.b $00
	LDA.w DATA_1793CB,x
	CLC
	ADC.b $10
	STA.b $0A
	CLC
	ADC.w #$0040
	STA.b $0C
	CLC
	ADC.w #$0040
	STA.b $0E
	JSR.w CODE_179407
	INX
	INX
	CPX.b #$06
	BCC.b CODE_17925C
	LDA.w $1129
	ASL
	ASL
	TAX
CODE_17928F:
	LDA.w DATA_1793D1,x
	STA.b $00
	TXA
	AND.w #$0002
	TAY
	LDA.w DATA_1793DD,y
	CLC
	ADC.b $10
	STA.b $0A
	CLC
	ADC.w #$0040
	STA.b $0C
	CLC
	ADC.w #$0040
	STA.b $0E
	JSR.w CODE_179407
	INX
	INX
	TXA
	AND.w #$0002
	BNE.b CODE_17928F
	LDA.w $1106
	EOR.w #$0001
	AND.w #$0001
	STA.w $1106
	SEP.b #$30
	RTS

DATA_1792C7:
	dw $21BF,$21BF,$2186,$218F,$218F,$218F,$218F,$218F
	dw $218F,$218F,$218F,$218F,$218F,$218F,$218F,$218F
	dw $6186,$21BF,$21BF,$21BF,$21BF,$21BF,$21BF,$21BF

DATA_1792F7:
	dw $A199,$218F,$218E,$218E,$218E,$218E,$218E,$218E
	dw $218E,$218E,$218E,$218E,$218E,$218E,$218E,$218E
	dw $218E,$218F,$218F,$218F,$218F,$218F,$218F,$E199

DATA_179327:
	dw $2198,$218E,$218E,$218E,$218E,$218E,$218E,$218E
	dw $218E,$218E,$218E,$218E,$218E,$218E,$218E,$218E
	dw $218E,$218E,$218E,$218E,$218E,$218E,$218E,$6198

DATA_179357:
	dw $21A1,$21AF,$21AF,$21AF,$21AF,$21AF,$21AF,$21AF
	dw $21AF,$21AF,$21AF,$21AF,$21AF,$21AF,$21AF,$21AF
	dw $21AF,$21AF,$21AF,$21AF,$21AF,$21AF,$21AF,$61A1

DATA_179387:
	dw $399F,$398F,$398F,$398F,$799F

DATA_179391:
	dw $3998,$398E,$398E,$398E,$7998

DATA_17939B:
	dw $B99F,$B98F,$B98F,$B98F,$F99F

DATA_1793A5:
	dw $219A,$219B,$219C,$219D,$219E

DATA_1793AF:
	dw $219A,$219B,$219C,$21BB,$21BC

DATA_1793B9:
	dw $219A,$219B,$219C,$21BD,$21BE

DATA_1793C3:
	dw $0C00,$1000,$1400,$1800

DATA_1793CB:
	dw $0B14,$0B1E,$0B28

DATA_1793D1:
	dw $2C51,$385A,$2C48,$385A,$2C48,$2C51

DATA_1793DD:
	dw $0AF4,$0BF4

DATA_1793E1:
	dw $2000,$2009,$2012,$201B,$2024,$202D,$2036,$283F
	dw $2C48,$3451,$385A,$3863

DATA_1793F9:
	dw $1800,$1800,$1800,$1800,$1800,$1800,$1800

;---------------------------------------------------------------------------

CODE_179407:
	LDY.b #$00
CODE_179409:
	TYA
	LSR
	CLC
	ADC.b $00
	STA.b ($0A),y
	INC
	INC
	INC
	STA.b ($0C),y
	INC
	INC
	INC
	STA.b ($0E),y
	INY
	INY
	CPY.b #$06
	BCC.b CODE_179409
	RTS

;---------------------------------------------------------------------------

DATA_179421:
	dw $707C02,$707C6A,$707CD2

DATA_179427:
	dw $001123,$001125,$001127

CODE_17942D:
	REP.b #$20
	LDA.w #$001123>>16
	STA.b $10
	PHB
	LDX.b #$707C02>>16
	PHX
	PLB
	LDX.b #$00
CODE_17943B:
	LDA.l DATA_179427,x
	STA.b $0E
	LDA.l DATA_179421,x
	STA.b $04
	SEP.b #$20
	STZ.b $00
	LDA.b ($04)
	BMI.b CODE_179456
CODE_17944F:
	INC.b $00
	SEC
	SBC.b #$0C
	BPL.b CODE_17944F
CODE_179456:
	LDA.b $00
	STA.b [$0E]
	REP.b #$20
	INX
	INX
	CPX.b #$06
	BCC.b CODE_17943B
	PLB
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	LDX.b #$00
-:
	LDA.w $1123,x
	BNE.b +
	STA $707E70,x
	STA $707E76,x
+:
	INX
	INX
	CPX.b #$06
	BCC.b -
	SEP.b #$20
	JSL.l CODE_verify_save_checksums
endif
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

CODE_179466:
	LDA.b #DATA_1794BE>>16
	STA.w $6022
	REP.b #$20
	LDA.w #DATA_1794BE
	STA.w $6020
	LDA.w #$000C
	STA.w $6024
	LDA.w #$0008
	STA.w $6026
	LDA.w #$0008
	STA.w $6028
	LDA.w #$0007
	STA.w $602A
	LDA.w #$0009
	STA.w $602C
	LDX.b #FXCODE_09EB9E>>16
	LDA.w #FXCODE_09EB9E
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDA.w $1106
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_1794BA,y
	TAY
	LDX.w #$702800
	LDA.w #$702800>>16
	STA.b $01
	LDA.w #$0C00
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	RTS

DATA_1794BA:
	dw $4800,$4000

DATA_1794BE:
	db $FF,$13,$04,$AF,$B2,$B5,$AE,$D0,$B6,$AE,$B7,$BE,$FF,$80,$FF,$0D
	db $12,$B9,$B5,$AA,$C2,$D0,$C0,$B1,$B2,$AC,$B1,$D0,$AF,$B2,$B5,$AE
	db $C6,$FF,$FF

;---------------------------------------------------------------------------

CODE_1794E1:
	STZ.w $6C00
	STZ.w $6C01
	STZ.w $112C
	STZ.w $112D
	LDA.b #$B5
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.w $1117
	BEQ.b CODE_1794FE
	ASL
	TAX
	JSR.w (DATA_179565-$02,x)
	BRA.b CODE_179561

CODE_1794FE:
	LDA.w $112E
	BEQ.b CODE_17950D
	ASL
	TAX
	JSR.w (DATA_179569,x)
	JSR.w CODE_17A390
	BRA.b CODE_179561

CODE_17950D:
	LDA.w $1119
	BEQ.b CODE_17952E
	ASL
	TAX
	JSR.w (DATA_179573,x)
	LDA.w $1119
	CMP.b #$05
	BCC.b CODE_179525
	CMP.b #$17
	BCS.b CODE_179525
	JSR.w CODE_17A3E2
CODE_179525:
	LDA.w $1119
	CMP.b #$10
	BCC.b CODE_179561
	BRA.b CODE_179564

CODE_17952E:
	LDA.w $111B
	BEQ.b CODE_17954F
	ASL
	TAX
	JSR.w (DATA_1795AB,x)
	LDA.w $111B
	CMP.b #$05
	BCC.b CODE_179546
	CMP.b #$16
	BCS.b CODE_179546
	JSR.w CODE_17A3E2
CODE_179546:
	LDA.w $111B
	CMP.b #$06
	BCC.b CODE_179561
	BRA.b CODE_179564

CODE_17954F:
	LDA.w $1130
	BEQ.b CODE_179561
	ASL
	TAX
	JSR.w (DATA_1795E3,x)
	LDA.w $1130
	BEQ.b CODE_179561
	JSR.w CODE_17A390
CODE_179561:
	JSR.w CODE_17A356
CODE_179564:
	RTS

DATA_179565:
	dw CODE_1795F5
	dw CODE_1796C3

DATA_179569:
	dw CODE_1796F8
	dw CODE_1797B3
	dw CODE_1797E5
	dw CODE_17980C
	dw CODE_179839

DATA_179573:
	dw CODE_179845
	dw CODE_17963E
	dw CODE_1796C3
	dw CODE_1796F8
	dw CODE_179D45
	dw CODE_179D57
	dw CODE_179DE0
	dw CODE_179E2B
	dw CODE_179E63
	dw CODE_179EBE
	dw CODE_1796C3
	dw CODE_179F22
	dw CODE_179DE0
	dw CODE_179F3B
	dw CODE_179E63
	dw CODE_179F53
	dw CODE_179DE0
	dw CODE_179F5E
	dw CODE_179F7E
	dw CODE_179FA8
	dw CODE_179FBF
	dw CODE_179FE7
	dw CODE_17A03A
	dw CODE_179E63
	dw CODE_17A069
	dw CODE_179DE0
	dw CODE_17A08B
	dw CODE_179E63

DATA_1795AB:
	dw CODE_17A09C
	dw CODE_17963E
	dw CODE_1796C3
	dw CODE_1796F8
	dw CODE_179D45
	dw CODE_179D57
	dw CODE_179DE0
	dw CODE_179E2B
	dw CODE_179E63
	dw CODE_17A0A7
	dw CODE_17A105
	dw CODE_179F22
	dw CODE_179DE0
	dw CODE_179F3B
	dw CODE_179E63
	dw CODE_179F53
	dw CODE_179DE0
	dw CODE_17A14F
	dw CODE_17A15E
	dw CODE_17A1B0
	dw CODE_17A25C
	dw CODE_17A03A
	dw CODE_17A313
	dw CODE_179E63
	dw CODE_17A069
	dw CODE_179DE0
	dw CODE_17A345
	dw CODE_179E63

DATA_1795E3:
	dw CODE_17A09C
	dw CODE_179A0A
	dw CODE_179A50
	dw CODE_179A6F
	dw CODE_179A92
	dw CODE_179B67
	dw CODE_179CB7
	dw CODE_179CDE

DATA_1795F3:
	db $01,$FF

CODE_1795F5:
	LDA.b $38
	AND.b #$03
	BEQ.b CODE_179626
	TAY
	LDA.w $111D
	CLC
	ADC.w DATA_1795F3-$01,y
	BMI.b CODE_179613
	LDX.b #!Define_YI_SoundID57_LoseStarsTimerAbove10
	STX.b !RAM_YI_Global_PlaySoundHighPriorityLo
	CMP.b #$03
	BCS.b CODE_179615
	STA.w $111D
	INC.w $1117
CODE_179613:
	BRA.b CODE_17963D

CODE_179615:
	LDA.b #$C4
	STA.w $1109
	LDA.b #$32
	STA.w $110A
	LDA.b #$03
	STA.w $1117
	BRA.b CODE_17963D

CODE_179626:
	LDA.b $35
	AND.b #$C0
	ORA.b $36
	AND.b #$D0
	BEQ.b CODE_17963D
	INC.w $112C
	STZ.w $1117
	INC.w $112E
	LDA.b #!Define_YI_SoundID09_Coin
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
CODE_17963D:
	RTS

CODE_17963E:
	LDA.b $38
	AND.b #$03
	BEQ.b CODE_17969C
	TAY
	LDA.w $111D
	STA.b $00
	CLC
	ADC.w DATA_1795F3-$01,y
	BMI.b CODE_179677
	CMP.b #$03
	BCS.b CODE_179682
	STA.w $111D
	LDA.w $1129
	ASL
	TAX
	JSR.w (DATA_1796ED,x)
	TXA
	BNE.b CODE_179677
	LDA.w $111D
	CMP.b #$03
	BCS.b CODE_179682
	LDA.b #!Define_YI_SoundID57_LoseStarsTimerAbove10
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	LDA.w $1129
	ASL
	TAX
	INC.w $1117,x
	BRA.b CODE_1796BD

CODE_179677:
	LDA.b $00
	STA.w $111D
	LDA.b #!Define_YI_SoundID57_LoseStarsTimerAbove10
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	BRA.b CODE_1796BD

CODE_179682:
	LDA.b #$C4
	STA.w $1109
	LDA.b #$32
	STA.w $110A
	LDA.w $1129
	ASL
	TAX
	LDA.b #$03
	STA.w $1117,x
	LDA.b #!Define_YI_SoundID57_LoseStarsTimerAbove10
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	BRA.b CODE_1796BD

CODE_17969C:
	LDA.b $36
	ORA.b $35
	AND.b #$D0
	BEQ.b CODE_1796BD
	LDA.w $111D
	STA.w $1134
	INC.w $112C
	LDA.w $1129
	ASL
	TAX
	LDA.b #$04
	STA.w $1117,x
	LDA.b #!Define_YI_SoundID09_Coin
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	BRA.b CODE_1796BD

CODE_1796BD:
	RTS

DATA_1796BE:
	db $44,$6C,$94

DATA_1796C1:
	db $04,$FC

CODE_1796C3:
	LDX.w $111D
	LDA.w $1109
	CMP.w DATA_1796BE,x
	BEQ.b CODE_1796DE
	ROL
	AND.b #$01
	TAX
	LDA.w $1109
	CLC
	ADC.w DATA_1796C1,x
	STA.w $1109
	BRA.b CODE_1796E6

CODE_1796DE:
	LDA.w $1129
	ASL
	TAX
	DEC.w $1117,x
CODE_1796E6:
	RTS

DATA_1796E7:
	db $01,$02,$00,$02,$00,$01

DATA_1796ED:
	dw CODE_179774
	dw CODE_179777
	dw CODE_179791

DATA_1796F3:
	db $01,$01,$01

DATA_1796F6:
	db $32,$52

CODE_1796F8:
	LDA.b #$02
	STA.w $111D
	LDA.b $38
	AND.b #$0C
	BEQ.b CODE_179716
	LDA.w $112B
	EOR.b #$01
	AND.b #$01
	STA.w $112B
	TAX
	LDA.w DATA_1796F6,x
	STA.w $110A
	BRA.b CODE_17976F

CODE_179716:
	LDA.b $36
	ORA.b $35
	AND.b #$D0
	BEQ.b CODE_17973C
	STZ.w $1117
	STZ.w $1119
	STZ.w $111B
	LDA.w $1129
	ASL
	ADC.w $112B
	TAX
	LDA.w DATA_1796E7,x
	STA.w $1129
	INC.w $1130
	LDA.b #!Define_YI_SoundID09_Coin
	BRA.b CODE_179771

CODE_17973C:
	LDA.b $38
	AND.b #$03
	BEQ.b CODE_179773
	TAY
	AND.b #$01
	BNE.b CODE_179773
	LDA.w $1129
	ASL
	TAX
	JSR.w (DATA_1796ED,x)
	TXA
	BNE.b CODE_179773
	LDX.w $111D
	LDA.w DATA_1796BE,x
	STA.w $1109
	LDA.b #$3A
	STA.w $110A
	LDA.w $1129
	TAX
	ASL
	TAY
	LDA.w DATA_1796F3,x
	STA.w $1117,y
	STZ.w $112B
CODE_17976F:
	LDA.b #!Define_YI_SoundID57_LoseStarsTimerAbove10
CODE_179771:
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
CODE_179773:
	RTS

CODE_179774:
	LDX.b #$00
	RTS

CODE_179777:
	LDA.w $111D
	ASL
	TAX
CODE_17977C:
	LDA.w $1123,x
	BEQ.b CODE_179791
	TXA
	CLC
	ADC.w DATA_1795F3-$01,y
	CLC
	ADC.w DATA_1795F3-$01,y
	TAX
	BMI.b CODE_179791
	CMP.b #$06
	BCC.b CODE_17977C
CODE_179791:
	LDA.w $111D
	ASL
	TAX
CODE_179796:
	LDA.w $1123,x
	BNE.b CODE_1797AB
	TXA
	CLC
	ADC.w DATA_1795F3-$01,y
	CLC
	ADC.w DATA_1795F3-$01,y
	TAX
	BMI.b CODE_1797B2
	CMP.b #$06
	BCC.b CODE_179796
CODE_1797AB:
	TXA
	LSR
	STA.w $111D
	LDX.b #$00
CODE_1797B2:
	RTS

CODE_1797B3:
	INC.w $112C
	REP.b #$20
	LDA.w #$0100
	STA.w $1110
	LDA.w $1129
	ASL
	TAX
	LDA.w $111D
	AND.w #$0007
	ASL
	TAY
	LDA.w DATA_1793CB,y
	JSR.w CODE_179960
	SEP.b #$20
	LDA.w $111D
	ASL
	TAX
	LDA.w $1123,x
	CLC
	ADC.b #$54
	JSR.w CODE_1799AB
	INC.w $112E
	RTS

CODE_1797E5:
	INC.w $112C
	REP.b #$20
	LDA.w $1110
	SEC
	SBC.w #$0008
	STA.w $1110
	SEP.b #$20
	CMP.b #$C0
	BCS.b CODE_1797FD
	INC.w $112E
CODE_1797FD:
	LDA.w $111D
	ASL
	TAX
	LDA.w $1123,x
	CLC
	ADC.b #$54
	JSR.w CODE_1799AB
	RTS

CODE_17980C:
	INC.w $112C
	REP.b #$20
	LDA.w $1110
	CLC
	ADC.w #$0008
	STA.w $1110
	SEP.b #$20
	LDA.w $111D
	ASL
	TAX
	LDA.w $1123,x
	CLC
	ADC.b #$54
	JSR.w CODE_1799AB
	LDA.w $1111
	BEQ.b CODE_179838
	LDA.b #$20
	STA.w $1110
	INC.w $112E
CODE_179838:
	RTS

CODE_179839:
	INC.w $112C
	DEC.w $1110
	BNE.b CODE_179844
	INC.w $112E
CODE_179844:
	RTS

CODE_179845:
	LDA.w $111D
	STA.l $707E7C
	ASL
	STA.w !RAM_YI_Global_CurrentSaveFile
	REP.b #$20
	LDX.b #$0A
	LDA.w #$0000
CODE_179857:
	STA.w $030F,x
	STA.w $031B,x
	STA.w $0327,x
	STA.w $0333,x
	STA.w $033F,x
	STA.w $034B,x
	DEX
	DEX
	BPL.b CODE_179857
	LDA.w #$F0F0
	STA.w $0317
	STA.w $0323
	STA.w $032F
	STA.w $033B
	STA.w $0347
	STA.w $0353
	SEP.b #$20
	JSL.l CODE_load_save_file
	STZ.w !RAM_YI_Level_FinalWorldUnlockedFlagLo
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	BMI.b CODE_179897
	CMP.b #!Define_YI_LevelID_ScareySkeletonGoonies
	BCC.b CODE_179897
	INC.w !RAM_YI_Level_FinalWorldUnlockedFlagLo
CODE_179897:
if !Define_YI_Global_EnableDebugFeatures == !TRUE
	NOP #3
else
	JMP.w CODE_179932
endif

ADDR_17989A:
	LDA.w $111D
	CMP.b #$02
	BEQ.b ADDR_1798A4
	JMP.w CODE_179932

ADDR_1798A4:
	LDA.b #$63
	STA.w !RAM_YI_Level_CurrentCoinCountLo
	LDA.b $35
	AND.b #$30
	BEQ.b ADDR_1798B4
	LDA.b #$63
	STA.w !RAM_YI_Level_CurrentLifeCountLo
ADDR_1798B4:
	LDX.b #$00
	TXA
	INC
ADDR_1798B8:
	STA.w !RAM_YI_Level_PauseMenuItemInventory,x
	INC
	CMP.b #$0A
	BCC.b ADDR_1798C2
	LDA.b #$01
ADDR_1798C2:
	INX
	CPX.b #$1B
	BCC.b ADDR_1798B8
	LDA.b #$00
	TAX
	TXY
	INC
ADDR_1798CC:
	STA.w !RAM_YI_Map_LevelClearFlags,y
	INY
	CPY.b #$48
	BCC.b ADDR_1798CC
	LDA.b #$00
	TAX
ADDR_1798D7:
	INC
	PHA
	REP.b #$20
	LDA.l DATA_world_unlock_ptr_world1,x
	STA.b $00
	LDA.l DATA_world_unlock_ptr_world2,x
	STA.b $02
	LDA.l DATA_world_unlock_ptr_world3,x
	STA.b $04
	LDA.l DATA_world_unlock_ptr_world4,x
	STA.b $06
	LDA.l DATA_world_unlock_ptr_world5,x
	STA.b $08
	LDA.l DATA_world_unlock_ptr_world6,x
	STA.b $0A
	SEP.b #$20
	PLA
	STA.b ($00)
	STA.b ($02)
	STA.b ($04)
	STA.b ($06)
	STA.b ($08)
	STA.b ($0A)
	INX
	INX
	CPX.b #$18
	BCC.b ADDR_1798D7
	REP.b #$20
	LDA.w #$0A09
	STA.w $0317
	STA.w $0323
	STA.w $032F
	STA.w $033B
	STA.w $0347
	STA.w $0353
	SEP.b #$20
	LDA.b #$01
	STA.w $1127
CODE_179932:
	LDA.b #$03
	STA.w !RAM_YI_Level_CurrentLifeCountLo
	LDA.b #!Define_YI_GameMode1F
	STA.w !RAM_YI_Global_CurrentGameMode
	LDA.b #!Define_YI_MusicID_FadeMusicCommand
	STA.b !RAM_YI_Global_PlayMusicLo
	LDA.b #$01
	STA.w $0201
	STZ.w $1115
	STZ.w $1116
	LDX.w !RAM_YI_Global_CurrentSaveFile
	LDA.w $1123,x
	BNE.b CODE_17995B
	LDA.b #!Define_YI_GameMode37
	STA.w !RAM_YI_Global_CurrentGameMode
	STZ.w !RAM_YI_Level_CurrentYoshiColorLo
CODE_17995B:
	RTS

DATA_17995C:
	dw $0D86,$0A06

CODE_179960:
	LDY.w $1106
	BNE.b CODE_179969
	CLC
	ADC.w #$0380
CODE_179969:
	STA.b $00
	CLC
	ADC.w #$0040
	STA.b $02
	CLC
	ADC.w #$0040
	STA.b $04
	LDY.b #$00
	LDA.w #$218E
	ORA.w DATA_1793C3,x
CODE_17997F:
	STA.b ($00),y
	STA.b ($02),y
	STA.b ($04),y
	INY
	INY
	CPY.b #$06
	BCC.b CODE_17997F
CODE_17998B:
	REP.b #$10
	LDA.w $1106
	AND.w #$0001
	ASL
	TAY
	LDA.w #$0000
	STA.b $01
	LDA.w DATA_17995C,y
	TAX
	LDY.w #$3020
	LDA.w #$0300
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$10
	RTS

CODE_1799AB:
	REP.b #$20
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0015
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $1110
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_08DBDE>>16
	LDA.w #FXCODE_08DBDE
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDY.w #$7C80
	LDA.w #$702800>>16
	STA.b $01
	LDX.w #$702800
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7D80
	LDX.w #$702A00
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7E80
	LDX.w #$702C00
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7F80
	LDX.w #$702E00
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	RTS

DATA_179A06:
	dw $0AF4,$0BF4

CODE_179A0A:
	INC.w $112C
	REP.b #$20
	LDA.w #$0100
	STA.w $1110
	LDA.w $112B
	ASL
	TAY
	LDA.w DATA_179A06,y
	LDX.b #$06
	JSR.w CODE_179960
	SEP.b #$20
	STZ.w $112B
	JSR.w CODE_179A88
	JSR.w CODE_17912F
	REP.b #$30
	LDA.w $1106
	AND.w #$0001
	ASL
	TAY
	LDA.w #$0000
	STA.b $01
	LDA.w DATA_17995C,y
	TAX
	LDY.w #$3220
	LDA.w #$0300
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	INC.w $1130
	RTS

CODE_179A50:
	INC.w $112C
	REP.b #$20
	LDA.w $1110
	SEC
	SBC.w #$0008
	STA.w $1110
	SEP.b #$20
	CMP.b #$C0
	BCS.b CODE_179A68
	INC.w $1130
CODE_179A68:
	JSR.w CODE_179A88
	RTS

DATA_179A6C:
	db $5C,$5D,$5E

CODE_179A6F:
	INC.w $112C
	REP.b #$20
	LDA.w $1110
	CLC
	ADC.w #$0008
	STA.w $1110
	SEP.b #$20
	LDA.w $1111
	BEQ.b CODE_179A88
	INC.w $1130
CODE_179A88:
	LDX.w $1129
	LDA.w DATA_179A6C,x
	JSR.w CODE_1799AB
	RTS

CODE_179A92:
	LDA.b #DATA_179AF6>>16
	STA.w $6022
	REP.b #$20
	LDA.w $1129
	ASL
	TAX
	LDA.w DATA_179AF0,x
	STA.w $6020
	LDA.w #$0008
	STA.w $6028
	LDA.w #$0007
	STA.w $602A
	LDA.w #$0009
	STA.w $602C
	LDX.b #FXCODE_09EB9E>>16
	LDA.w #FXCODE_09EB9E
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDA.w $1106
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_1794BA,y
	TAY
	LDX.w #$702800
	LDA.w #$702800>>16
	STA.b $01
	LDA.w #$0400
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDA.w $1129
	ASL
	TAX
	JSR.w (DATA_179AEA,x)
	SEP.b #$30
	INC.w $1130
	RTS

DATA_179AEA:
	dw CODE_179B21
	dw CODE_179B30
	dw CODE_179B4F

DATA_179AF0:
	dw DATA_179AF6,DATA_179B04,DATA_179B12

DATA_179AF6:
	db $FF,$13,$04,$AF,$B2,$B5,$AE,$D0,$B6,$AE,$B7,$BE,$FF,$FF

DATA_179B04:
	db $FF,$13,$04,$AC,$B8,$B9,$C2,$D0,$B6,$AE,$B7,$BE,$FF,$FF

DATA_179B12:
	db $FF,$10,$04,$AE,$BB,$AA,$BC,$AE,$D0,$B6,$AE,$B7,$BE,$FF,$FF

CODE_179B21:
	LDA.w #$0000
	STA.w $1132
	RTS

DATA_179B28:
	db $04,$00,$02,$00,$02,$00,$0A,$00

CODE_179B30:
	LDX.w #$0000
	LDA.w $1123
	BEQ.b CODE_179B3A
	INX
	INX
CODE_179B3A:
	LDA.w $1125
	BEQ.b CODE_179B41
	INX
	INX
CODE_179B41:
	LDA.w $1127
	BEQ.b CODE_179B48
	INX
	INX
CODE_179B48:
	LDA.w DATA_179B28,x
	STA.w $1132
	RTS

CODE_179B4F:
	LDA.w #$000C
	STA.w $1132
	LDA.w $1123
	ORA.w $1125
	ORA.w $1127
	BNE.b CODE_179B66
	INC.w $1132
	INC.w $1132
CODE_179B66:
	RTS

CODE_179B67:
	JSR.w CODE_179B6E
	INC.w $1130
	RTS

CODE_179B6E:
	LDA.b #DATA_179BCF>>16
	STA.w $6022
	REP.b #$20
	LDX.w $1132
	LDA.w DATA_179BB7,x
	STA.w $6020
	LDA.w #$000C
	STA.w $6024
	LDA.w #$0008
	STA.w $6026
	LDX.b #FXCODE_09EC41>>16
	LDA.w #FXCODE_09EC41
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDA.w $1106
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_1794BA,y
	CLC
	ADC.w #$0200
	TAY
	LDX.w #$702C00
	LDA.w #$702C00>>16
	STA.b $01
	LDA.w #$0800
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	RTS

DATA_179BB7:
	dw DATA_179BCF,DATA_179BE4,DATA_179BF9,DATA_179C0B,DATA_179C21,DATA_179C37,DATA_179C4A,DATA_179BF9
	dw DATA_179C60,DATA_179C75,DATA_179C8B,DATA_179CA1

DATA_179BCF:
	db $FF,$0D,$12,$B9,$B5,$AA,$C2,$D0,$C0,$B1,$B2,$AC,$B1,$D0,$AF,$B2
	db $B5,$AE,$C6,$FF,$FF

DATA_179BE4:
	db $FF,$0D,$12,$AC,$B8,$B9,$C2,$D0,$C0,$B1,$B2,$AC,$B1,$D0,$AF,$B2
	db $B5,$AE,$C6,$FF,$FF

DATA_179BF9:
	db $FF,$18,$12,$B7,$B8,$D0,$BC,$AA,$BF,$AE,$AD,$D0,$AF,$B2,$B5,$AE
	db $FF,$FF

DATA_179C0B:
	db $FF,$02,$12,$AC,$B8,$B9,$C2,$B2,$B7,$B0,$D0,$AC,$B8,$B6,$B9,$B5
	db $AE,$BD,$AE,$AD,$FF,$FF

DATA_179C21:
	db $FF,$09,$12,$AC,$B8,$B9,$C2,$D0,$B2,$BD,$D0,$BD,$B8,$D0,$C0,$B1
	db $AE,$BB,$AE,$C6,$FF,$FF

DATA_179C37:
	db $FF,$0A,$12,$B7,$B8,$D0,$AE,$B6,$B9,$BD,$C2,$D0,$AF,$B2,$B5,$AE
	db $C6,$FF,$FF

DATA_179C4A:
	db $FF,$0A,$12,$AE,$BB,$AA,$BC,$AE,$D0,$C0,$B1,$B2,$AC,$B1,$D0,$AF
	db $B2,$B5,$AE,$C6,$FF,$FF

DATA_179C60:
	db $FF,$0C,$12,$BC,$BE,$BB,$AE,$C6,$D0,$D0,$D0,$C2,$AE,$BC,$D0,$D0
	db $D0,$B7,$B8,$FF,$FF

DATA_179C75:
	db $FF,$09,$12,$AF,$B2,$B5,$AE,$D0,$A1,$D0,$C0,$AA,$BC,$D0,$AE,$BB
	db $AA,$BC,$AE,$AD,$FF,$FF

DATA_179C8B:
	db $FF,$09,$12,$AF,$B2,$B5,$AE,$D0,$A2,$D0,$C0,$AA,$BC,$D0,$AE,$BB
	db $AA,$BC,$AE,$AD,$FF,$FF

DATA_179CA1:
	db $FF,$09,$12,$AF,$B2,$B5,$AE,$D0,$A3,$D0,$C0,$AA,$BC,$D0,$AE,$BB
	db $AA,$BC,$AE,$AD,$FF,$FF

CODE_179CB7:
	REP.b #$20
	PHB
	LDX.b #$7E55C0>>16
	PHX
	PLB
	LDX.b #$00
	LDA.w #$00FF
CODE_179CC3:
	STA.w $7E55C0,x
	DEX
	DEX
	BNE.b CODE_179CC3
	PLB
	SEP.b #$20
	LDA.b #$13
	STA.w !RAM_YI_Global_MainScreenWindowMask
	LDA.b #$02
	STA.w !RAM_YI_Global_ObjectAndColorWindowSettings
	STZ.w $1107
	INC.w $1130
	RTS

CODE_179CDE:
	REP.b #$20
	LDA.w $1107
	AND.w #$00FF
	ASL
	ASL
	ASL
	TAX
	LDA.w #$FF00
	STA.l $7E55C0,x
	STA.l $7E55C2,x
	STA.l $7E55C4,x
	STA.l $7E55C6,x
	SEP.b #$20
	INC.w $1107
	LDA.w $1107
	CMP.b #$15
	BCC.b CODE_179D44
	REP.b #$30
	LDA.w $1106
	AND.w #$0001
	ASL
	TAY
	LDA.w #$0000
	STA.b $01
	LDA.w DATA_17995C,y
	TAX
	LDY.w #$3020
	LDA.w #$0300
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	STZ.w !RAM_YI_Global_MainScreenWindowMask
	STZ.w !RAM_YI_Global_ObjectAndColorWindowSettings
	STZ.w $1130
	STZ.w $112B
	LDA.w DATA_1796F6
	STA.w $110A
	LDA.w $1129
	ASL
	TAX
	LDA.b #$03
	STA.w $1117,x
CODE_179D44:
	RTS

CODE_179D45:
	LDA.w $1129
	ASL
	TAX
	INC.w $1117,x
	REP.b #$20
	LDA.w #$0100
	STA.w $1110
	SEP.b #$20
CODE_179D57:
	INC.w $112C
	REP.b #$20
	LDA.w $1110
	CLC
	ADC.w #$0004
	STA.w $1110
	SEP.b #$20
	LDA.w $1110
	CMP.b #$50
	BCC.b CODE_179D7A
	LDA.w $1129
	ASL
	TAX
	INC.w $1117,x
	STZ.w $1122
CODE_179D7A:
	LDA.w $111D
	ASL
	TAX
	LDA.w $1123,x
	CLC
	ADC.b #$54
	REP.b #$20
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0015
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $1110
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_08DBDE>>16
	LDA.w #FXCODE_08DBDE
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_179DA2:
	REP.b #$10
	LDY.w #$7CC0
	LDA.w #$702800>>16
	STA.b $01
	LDX.w #$702800
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7DC0
	LDX.w #$702A00
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7EC0
	LDX.w #$702C00
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7FC0
	LDX.w #$702E00
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	RTS

CODE_179DE0:
	REP.b #$20
	LDA.w #$0C50
	LDY.w $1106
	BNE.b CODE_179DEE
	CLC
	ADC.w #$0380
CODE_179DEE:
	STA.b $00
	CLC
	ADC.w #$0040
	STA.b $02
	REP.b #$10
	LDA.w $1129
	ASL
	TAX
	LDA.w $1122
	AND.w #$00FF
	ASL
	TAY
	LDA.w #$218E
	ORA.w DATA_1793C3,x
	STA.b ($00),y
	STA.b ($02),y
	JSR.w CODE_17998B
	SEP.b #$30
	INC.w $1122
	LDA.w $1122
	CMP.b #$11
	BCC.b CODE_179E26
	LDA.w $1129
	ASL
	TAX
	INC.w $1117,x
CODE_179E26:
	RTS

DATA_179E27:
	dw CODE_179E42
	dw CODE_179E5D

CODE_179E2B:
	LDA.w $1129
	ASL
	TAX
	JSR.w (DATA_179E27-$02,x)
	JSR.w CODE_179B6E
	LDA.w $1129
	ASL
	TAX
	INC.w $1117,x
	STZ.w $1122
	RTS

CODE_179E42:
	LDA.b #$08
	STA.w $1132
	LDA.w $1123
	BEQ.b CODE_179E5C
	LDA.w $1125
	BEQ.b CODE_179E5C
	LDA.w $1127
	BEQ.b CODE_179E5C
	INC.w $1132
	INC.w $1132
CODE_179E5C:
	RTS

CODE_179E5D:
	LDA.b #$10
	STA.w $1132
	RTS

CODE_179E63:
	REP.b #$20
	LDA.w #$0C50
	LDY.w $1106
	BNE.b CODE_179E71
	CLC
	ADC.w #$0380
CODE_179E71:
	STA.b $00
	CLC
	ADC.w #$0040
	STA.b $02
	LDA.w $1106
	EOR.w #$0001
	AND.w #$0001
	XBA
	LSR
	STA.b $0E
	LDA.w $1129
	ASL
	TAX
	LDA.w $1122
	AND.w #$00FF
	PHA
	ASL
	TAY
	PLA
	ADC.w #$2220
	ORA.w DATA_1793C3,x
	ORA.b $0E
	STA.b ($00),y
	ORA.w #$0010
	STA.b ($02),y
	REP.b #$10
	JSR.w CODE_17998B
	SEP.b #$30
	INC.w $1122
	LDA.w $1122
	CMP.b #$10
	BCC.b CODE_179EBD
	LDA.w $1129
	ASL
	TAX
	INC.w $1117,x
CODE_179EBD:
	RTS

CODE_179EBE:
	LDA.b $38
	AND.b #$03
	BEQ.b CODE_179F02
	TAY
	LDA.w $111D
	CLC
	ADC.w DATA_1795F3-$01,y
	BMI.b CODE_179F00
	CMP.b #$03
	BCS.b CODE_179F00
	ASL
	TAX
CODE_179ED4:
	LDA.w $1123,x
	BEQ.b CODE_179EF2
	TXA
	LSR
	CMP.w $1134
	BEQ.b CODE_179EF2
	TXA
	CLC
	ADC.w DATA_1795F3-$01,y
	CLC
	ADC.w DATA_1795F3-$01,y
	TAX
	BMI.b CODE_179F00
	CMP.b #$06
	BCS.b CODE_179F00
	BRA.b CODE_179ED4

CODE_179EF2:
	TXA
	LSR
	STA.w $111D
	LDA.b #!Define_YI_SoundID57_LoseStarsTimerAbove10
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	INC.w $1119
	BRA.b CODE_179F21

CODE_179F00:
	BRA.b CODE_179F21

CODE_179F02:
	LDA.b $36
	ORA.b $35
	AND.b #$D0
	BEQ.b CODE_179F21
	STZ.w $1122
	LDA.w $111D
	CMP.w $1134
	BEQ.b CODE_179F1C
	LDA.b #$10
	STA.w $1119
	BRA.b CODE_179F21

CODE_179F1C:
	LDA.b #$0B
	STA.w $1119
CODE_179F21:
	RTS

CODE_179F22:
	LDA.w $1110
	SEC
	SBC.b #$04
	STA.w $1110
	BNE.b CODE_179F35
	LDA.w $1129
	ASL
	TAX
	INC.w $1117,x
CODE_179F35:
	JSR.w CODE_179D7A
	RTS

DATA_179F39:
	db $02,$0C

CODE_179F3B:
	LDX.w $1129
	LDA.w DATA_179F39-$01,x
	STA.w $1132
	JSR.w CODE_179B6E
	LDA.w $1129
	ASL
	TAX
	INC.w $1117,x
	STZ.w $1122
	RTS

CODE_179F53:
	LDA.w $1129
	ASL
	TAX
	LDA.b #$01
	STA.w $1117,x
	RTS

CODE_179F5E:
	REP.b #$20
	LDA.w $1129
	ASL
	TAX
	LDA.w $111D
	AND.w #$0007
	ASL
	TAY
	LDA.w DATA_1793CB,y
	JSR.w CODE_179960
	LDA.w #$0100
	STA.w $1110
	SEP.b #$20
	INC.w $1119
CODE_179F7E:
	LDA.w $111D
	ASL
	TAX
	LDA.w $1123,x
	CLC
	ADC.b #$54
	JSR.w CODE_1799AB
	REP.b #$20
	LDA.w $1110
	SEC
	SBC.w #$0008
	STA.w $1110
	SEP.b #$20
	LDA.w $1110
	CMP.b #$20
	BCS.b CODE_179FA4
	INC.w $1119
CODE_179FA4:
	JSR.w CODE_17A390
	RTS

CODE_179FA8:
	JSL.l CODE_10832C
	LDA.w $1134
	ASL
	TAX
	LDA.w $111D
	ASL
	TAY
	LDA.w $1123,x
	STA.w $1123,y
	INC.w $1119
CODE_179FBF:
	LDA.w $111D
	ASL
	TAX
	LDA.w $1123,x
	CLC
	ADC.b #$54
	JSR.w CODE_1799AB
	REP.b #$20
	LDA.w $1110
	CLC
	ADC.w #$0008
	STA.w $1110
	SEP.b #$20
	LDA.w $1111
	BEQ.b CODE_179FE3
	INC.w $1119
CODE_179FE3:
	JSR.w CODE_17A390
	RTS

CODE_179FE7:
	JSR.w CODE_17A003
	JSR.w CODE_17A390
	REP.b #$20
	LDA.w #$0150
	STA.w $1110
	SEP.b #$20
	LDA.b #$06
	STA.w $1132
	JSR.w CODE_179B6E
	INC.w $1119
	RTS

CODE_17A003:
	LDA.w $111D
	ASL
	TAX
	LDA.w $1123,x
	ASL
	TAY
	REP.b #$20
	LDA.w DATA_1793E1,y
	ORA.w DATA_1793F9,y
	STA.b $00
	LDA.w DATA_1793CB,x
	LDY.w $1106
	BNE.b CODE_17A023
	CLC
	ADC.w #$0380
CODE_17A023:
	STA.b $0A
	CLC
	ADC.w #$0040
	STA.b $0C
	CLC
	ADC.w #$0040
	STA.b $0E
	JSR.w CODE_179407
	JSR.w CODE_17998B
	SEP.b #$20
	RTS

CODE_17A03A:
	JSR.w CODE_179D7A
	REP.b #$20
	LDA.w $1110
	SEC
	SBC.w #$0004
	STA.w $1110
	SEP.b #$20
	LDA.w $1110
	BNE.b CODE_17A066
	LDA.w $1129
	ASL
	TAX
	INC.w $1117,x
	CPX.b #$02
	BNE.b CODE_17A060
	LDA.b #!Define_YI_SoundID32_HitMessageBox
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
CODE_17A060:
	STZ.w $1122
	STZ.w $1110
CODE_17A066:
	RTS

DATA_17A067:
	db $20,$40

CODE_17A069:
	INC.w $1110
	LDA.w $1129
	TAY
	ASL
	TAX
	LDA.w $1110
	CMP.w DATA_17A067-$01,y
	BCC.b CODE_17A08A
	INC.w $1117,x
	STZ.w $1122
	REP.b #$20
	LDA.w #$32C4
	STA.w $1109
	SEP.b #$20
CODE_17A08A:
	RTS

CODE_17A08B:
	REP.b #$30
	JSR.w CODE_179B30
	SEP.b #$30
	JSR.w CODE_179B6E
	STZ.w $1122
	INC.w $1119
	RTS

CODE_17A09C:
	LDA.w $1129
	ASL
	TAX
	LDA.b #$03
	STA.w $1117,x
	RTS

CODE_17A0A7:
	LDA.b #DATA_17A0F6>>16
	STA.w $6022
	REP.b #$20
	LDA.w #DATA_17A0F6
	STA.w $6020
	LDA.w #$000C
	STA.w $6024
	LDA.w #$0008
	STA.w $6026
	LDX.b #FXCODE_09EC41>>16
	LDA.w #FXCODE_09EC41
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDY.w #$7E00
	LDA.w #$0070
	STA.b $01
	LDX.w #$702C00
	LDA.w #$0100
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7F00
	LDX.w #$702E00
	LDA.w #$0100
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	STZ.w $1136
	JSR.w CODE_17A378
	INC.w $111B
	RTS

DATA_17A0F6:
	db $FF,$00,$12,$28,$01,$FF,$20,$12,$01,$01,$03,$FF,$FF

DATA_17A103:
	db $0B,$10

CODE_17A105:
	LDA.b $38
	AND.b #$03
	BEQ.b CODE_17A124
	EOR.b #$03
	TAY
	LDA.w $1136
	CLC
	ADC.w DATA_1795F3-$01,y
	BMI.b CODE_17A14B
	CMP.b #$02
	BCS.b CODE_17A14B
	STA.w $1136
	LDA.b #!Define_YI_SoundID57_LoseStarsTimerAbove10
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	BRA.b CODE_17A14B

CODE_17A124:
	LDA.b $36
	ORA.b $35
	AND.b #$D0
	BEQ.b CODE_17A14B
	LDX.w $1136
	LDA.w DATA_17A103,x
	STA.w $111B
	REP.b #$20
	LDA.w #$0150
	STA.w $1110
	SEP.b #$20
	STZ.w $1122
	TXA
	BEQ.b CODE_17A14B
	LDA.b #!Define_YI_SoundID09_Coin
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	BRA.b CODE_17A14B

CODE_17A14B:
	JSR.w CODE_17A378
	RTS

CODE_17A14F:
	STZ.w $1137
	STZ.w $1138
	LDA.b #$54
	JSR.w CODE_1799AB
	INC.w $111B
	RTS

CODE_17A15E:
	LDA.w $111D
	ASL
	TAX
	LDA.w $1123,x
	CLC
	ADC.b #$54
	REP.b #$20
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0015
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $1110
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_08DBDE>>16
	LDA.w #FXCODE_08DBDE
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	LDA.w $111D
	ASL
	TAX
	LDA.w $1123,x
	PHA
	PHX
	LDA.b #$00
	STA.w $1123,x
	JSR.w CODE_17A003
	PLX
	PLA
	STA.w $1123,x
	STZ.w $1122
	STZ.w $1137
	STZ.w $1138
	INC.w $111B
	RTS

DATA_17A1AC:
	db $FF,$01

DATA_17A1AE:
	db $01,$FF

CODE_17A1B0:
	JSR.w CODE_17A1FE
	JSR.w CODE_17A1FE
	REP.b #$20
	JSR.w CODE_179DA2
	SEP.b #$20
	LDA.w $1122
	CMP.b #$0B
	BCC.b CODE_17A1D6
	INC.w $111B
	STZ.w $1122
	REP.b #$20
	LDA.w #$1F1F
	STA.w $1137
	SEP.b #$20
	BRA.b CODE_17A1DA

CODE_17A1D6:
	LDA.b #!Define_YI_SoundID5A_PulleySqueak
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
CODE_17A1DA:
	REP.b #$20
	LDA.w $111D
	AND.w #$00FF
	ASL
	TAX
	LDA.w DATA_17A3DC,x
	AND.w #$FFF8
	CLC
	ADC.w #$0100
	CLC
	ADC.w $1137
	STA.w $1109
	SEP.b #$20
	JSR.w CODE_17A356
	JSR.w CODE_17A409
	RTS

CODE_17A1FE:
	REP.b #$20
	LDA.w #$0015
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $1137
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $1138
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_08E0C1>>16
	LDA.w #FXCODE_08E0C1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	LDA.w $1122
	AND.b #$01
	TAX
	LDA.w $1137
	CLC
	ADC.w DATA_17A1AC,x
	BPL.b CODE_17A23F
	SEC
	SBC.w DATA_17A1AC,x
	INC.w $1138
	INC.w $1138
	INC.w $1122
CODE_17A23F:
	STA.w $1137
	LDA.w $1138
	CLC
	ADC.w DATA_17A1AE,x
	BPL.b CODE_17A258
	SEC
	SBC.w DATA_17A1AE,x
	INC.w $1137
	INC.w $1137
	INC.w $1122
CODE_17A258:
	STA.w $1138
	RTS

CODE_17A25C:
	JSR.w CODE_17A2B1
	JSR.w CODE_17A2B1
	REP.b #$20
	JSR.w CODE_179DA2
	SEP.b #$20
	LDA.w $1122
	CMP.b #$0B
	BCC.b CODE_17A289
	INC.w $111B
	REP.b #$20
	LDA.w #$0150
	STA.w $1110
	SEP.b #$20
	LDA.w $111D
	ASL
	TAX
	LDA.b #$00
	STA.w $1123,x
	BRA.b CODE_17A28D

CODE_17A289:
	LDA.b #!Define_YI_SoundID5A_PulleySqueak
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
CODE_17A28D:
	REP.b #$20
	LDA.w $111D
	AND.w #$00FF
	ASL
	TAX
	LDA.w DATA_17A3DC,x
	AND.w #$FFF8
	CLC
	ADC.w #$0100
	CLC
	ADC.w $1137
	STA.w $1109
	SEP.b #$20
	JSR.w CODE_17A356
	JSR.w CODE_17A409
	RTS

CODE_17A2B1:
	REP.b #$20
	LDA.w #$0015
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $1137
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $1138
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_08E0C1>>16
	LDA.w #FXCODE_08E0C1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	LDA.w $1122
	AND.b #$01
	TAX
	LDA.w $1137
	CLC
	ADC.w DATA_17A1AE,x
	CMP.b #$20
	BCC.b CODE_17A2F4
	SEC
	SBC.w DATA_17A1AE,x
	DEC.w $1138
	DEC.w $1138
	INC.w $1122
CODE_17A2F4:
	STA.w $1137
	LDA.w $1138
	CLC
	ADC.w DATA_17A1AC,x
	CMP.b #$20
	BCC.b CODE_17A30F
	SEC
	SBC.w DATA_17A1AC,x
	DEC.w $1137
	DEC.w $1137
	INC.w $1122
CODE_17A30F:
	STA.w $1138
	RTS

CODE_17A313:
	LDA.w $111D
	ASL
	CLC
	ADC.b #$12
	STA.w $1132
	JSR.w CODE_179B6E
	STZ.w $1122
	STZ.w $1110
	REP.b #$20
	LDA.w $111D
	AND.w #$000F
	ASL
	TAX
	LDA.w #$0000
	STA.l $707E70,x
	STA.l $707E76,x
	SEP.b #$20
	JSL.l CODE_verify_save_checksums
	INC.w $111B
	RTS

CODE_17A345:
	REP.b #$30
	JSR.w CODE_179B4F
	SEP.b #$30
	JSR.w CODE_179B6E
	STZ.w $1122
	INC.w $111B
	RTS

CODE_17A356:
	REP.b #$20
	LDA.w $1109
	STA.w $6A00
CODE_17A35E:
	LDA.w #$39C0
	STA.w $6A02
	LDA.w $112C
	BEQ.b CODE_17A371
	LDA.w $6A02
	INC
	INC
	STA.w $6A02
CODE_17A371:
	SEP.b #$20
	RTS

DATA_17A374:
	dw $5C8E,$5C6D

CODE_17A378:
	REP.b #$20
	LDA.w $1136
	AND.w #$0001
	ASL
	TAX
	LDA.w DATA_17A374,x
	STA.w $6A00
	BRA.b CODE_17A35E

DATA_17A38A:
	dw $37C8,$37C8,$3DC8

CODE_17A390:
	LDA.w $1109
	SEC
	SBC.b #$10
	STA.w $6A08
	LDA.w $110A
	SEC
	SBC.b #$17
	STA.w $6A09
	REP.b #$20
	LDA.w $111D
	AND.w #$00FF
	ASL
	TAX
	LDA.w $1123,x
	ASL
	TAX
	LDA.w DATA_1793F9,x
	LSR
	ORA.w #$31C8
	STA.w $6A0A
	LDA.w $1130
	AND.w #$00FF
	BEQ.b CODE_17A3D1
	LDA.w $1129
	AND.w #$0003
	ASL
	TAX
	LDA.w DATA_17A38A,x
	STA.w $6A0A
CODE_17A3D1:
	SEP.b #$20
	LDA.w $6C00
	ORA.b #$20
	STA.w $6C00
	RTS

DATA_17A3DC:
	dw $2334,$235C,$2384

CODE_17A3E2:
	REP.b #$20
	LDA.w $1134
	ASL
	TAX
	LDA.w DATA_17A3DC,x
	STA.w $6A04
	LDA.w $1123,x
	ASL
	TAX
	LDA.w DATA_1793F9,x
	LSR
	ORA.w #$31CC
	STA.w $6A06
	SEP.b #$20
	LDA.w $6C00
	ORA.b #$08
	STA.w $6C00
	RTS

CODE_17A409:
	REP.b #$20
	LDA.w $111D
	AND.w #$00FF
	ASL
	TAX
	LDA.w DATA_17A3DC,x
	STA.w $6A08
	LDA.w DATA_1793F9
	LSR
	ORA.w #$31C8
	STA.w $6A0A
	SEP.b #$20
	LDA.w $6C00
	ORA.b #$20
	STA.w $6C00
	RTS

;---------------------------------------------------------------------------

DATA_17A42E:
	db $09,!REGISTER_BG1AddressAndSize : dl $7E5B18

DATA_17A433:
	db $6C,$1C,$1C,$74,$01,$09,$00

DATA_17A43A:
	db $03,!REGISTER_BG1HorizScrollOffset : dl $7E5B58

DATA_17A43F:
	db $6C,$00,$00,$00,$00,$74,$00,$00,$00,$00,$00

DATA_17A44A:
	db $03,!REGISTER_BG2HorizScrollOffset : dl $7E5B98

DATA_17A44F:
	db $6C,$00,$00,$00,$00,$74,$00,$00,$00,$00,$00

DATA_17A45A:
	db $08,!REGISTER_BG1And2WindowMaskSettings : dl $7E5BD8

DATA_17A45F:
	db $6A,$32,$76,$33,$00

DATA_17A464:
	db $09,!REGISTER_BG3And4WindowMaskSettings : dl $7E5C18

DATA_17A469:
	db $30,$00,$00,$3A,$03,$02,$76,$03,$03,$00

DATA_17A473:
	db $44,!REGISTER_Window1LeftPositionDesignation : dl $7E5C58

DATA_17A478:
	db $18,$C0,$55,$D2,$C4,$55,$76,$40,$57,$00

DATA_17A482:
	db $08,!REGISTER_ColorMathSelectAndEnable : dl $7E5C98

DATA_17A487:
	db $6A,$A6,$76,$B7,$00

DATA_17A48C:
	db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF
	db $FE,$FE,$FE,$FE,$FE,$FE,$FE,$FE,$FE,$FE,$FE,$FE,$FD,$FD,$FD,$FD
	db $FD,$FD,$FD,$FD,$FC,$FC,$FC,$FC,$FC,$FC,$FC,$FB,$FB,$FB,$FB,$FB
	db $FA,$FA,$FA,$FA,$FA,$F9,$F9,$F9,$F9,$F9,$F8,$F8,$F8,$F8,$F7,$F7
	db $F7,$F7,$F6,$F6,$F6,$F5,$F5,$F5,$F5,$F4,$F4,$F4,$F3,$F3,$F3,$F2
	db $F2,$F2,$F1,$F1,$F1,$F0,$F0,$F0,$EF,$EF,$EF,$EE,$EE,$ED,$ED,$ED
	db $EC,$EC,$EB,$EB,$EB,$EA,$EA,$E9,$E9,$E8,$E8,$E7,$E7,$E7,$E6,$E6
	db $E5,$E5,$E4,$E4,$E3,$E3,$E2,$E2,$E1,$E0,$E0,$DF,$DF,$DE,$DE,$DD
	db $DD,$DC,$DB,$DB,$DA,$DA,$D9,$D8,$D8,$D7,$D6,$D6,$D5,$D4,$D4,$D3
	db $D2,$D2,$D1,$D0,$D0,$CF,$CE,$CD,$CD,$CC,$CB,$CA,$CA,$C9,$C8,$C7
	db $C7,$C6,$C5,$C4,$C3,$C2,$C2,$C1,$C0,$BF,$BE,$BD,$BC,$BB,$BA,$B9
	db $B9,$B8,$B7,$B6,$B5,$B4,$B3,$B2,$B1,$AF,$AE,$AD,$AC,$AB,$AA,$A9
	db $A8,$A7,$A5,$A4,$A3,$A2,$A1,$9F,$9E,$9D,$9C,$9A,$99,$98,$96,$95
	db $94,$92,$91,$8F,$8E,$8C,$8B,$89,$88,$86,$84,$83,$81,$7F,$7D,$7C
	db $7A,$78,$76,$74,$72,$70,$6E,$6C,$6A,$68,$65,$63,$61,$5E,$5C,$59
	db $56,$53,$50,$4D,$4A,$47,$43,$3F,$3B,$37,$32,$2D,$27,$20,$17,$00

DATA_17A58C:
	db $BF

DATA_17A58D:
	db $01

;-------------------------------------------------------------------------
; CODE_gm20_prepare_overworld -- CODE_gm20_prepare_overworld (game-mode $20 init).
; Raidenthequick: `CODE_gm20_prepare_overworld` at $17:A58E.
; See also: ys_mapdt.asm / ys_map.asm (map-prep family).
;
; INPUTS:
;   M=8 X=8 from gamemode dispatcher.
;   $7E:0218 = !RAM_YI_Level_CurrentWorldLo (the world index just entered or returned to).
;   $7E:020F = current save file slot. $7E:011A = post-level-clear flag.
;   $70:7E7C = current file (for per-save-slot overworld customization).
; OUTPUTS:
;   $7E:0118 advances out of $20 (caller). The full overworld DMA/HDMA/VRAM
;     setup is done here -- 1C00-page tilemap, BG3, OBSEL, scene-reg slot $28,
;     palette via CODE_load_world_map_palettes, plus 7 HDMA channel parameter sets seeded from
;     DATA_17A42E..A487 (mode-7 matrix, scroll, window, mainscreen overlays).
;   World-folding state machine seeded at $7E:1108..$7E:1122 (`DATA_world_map_state_ptr`
;     via DATA_world_map_state_ptr dispatches next frame onward).
; MODIFIES: A, X, Y, DBR, DP $00..$0F. HDMA channels $01..$07 reconfigured.
; CALLERS:
;   Bank00 `DATA_game_mode_pointers[$20]` -- one-shot init; dispatcher advances to
;     mode $21 (fade-in) which then arrives at $22 (CODE_gm22_overworld).
;-------------------------------------------------------------------------
CODE_17A58E:
CODE_gm20_prepare_overworld:					; Raiden alias
	JSL.l CODE_init_oam_and_bg3_tilemap
	JSL.l CODE_clear_basic_states
	LDA.b #$15
	JSL.l CODE_008279
	JSL.l CODE_copy_division_lookup_to_sram
	JSL.l CODE_clear_all_sprites
	JSL.l CODE_init_oam_buffer
	LDX.b #$28
	JSL.l CODE_init_scene_regs
	LDA.b #$03
	STA.w !RAM_YI_Global_OAMSizeAndDataAreaDesignation
	STA.w !REGISTER_OAMSizeAndDataAreaDesignation
	STZ.w $0201
	REP.b #$20
	LDX.b #$00
	STX.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #$1C00
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$09
	STA.w DMA[$00].Parameters
	LDA.w #DATA_17A58C
	STA.w DMA[$00].SourceLo
	LDX.b #DATA_17A58C>>16
	STX.w DMA[$00].SourceBank
	LDA.w #$0800
	STA.w DMA[$00].SizeLo
	LDY.b #$01
	STY.w !REGISTER_DMAEnable
	LDX.b #$80
	STX.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #$1C00
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortHi&$0000FF)<<8)+$09
	STA.w DMA[$00].Parameters
	LDA.w #DATA_17A58D
	STA.w DMA[$00].SourceLo
	LDA.w #$0800
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	SEP.b #$20
	JSL.l CODE_load_world_map_gfx
	REP.b #$30
	STZ.w !RAM_YI_Level_CurrentYoshiColorLo
	JSL.l CODE_load_world_map_palettes
	REP.b #$20
	JSL.l CODE_17CD0B
	SEP.b #$20
	LDX.b #$04
CODE_17A61B:
	LDA.w DATA_17A42E,x
	STA.w HDMA[$07].Parameters,x
	LDA.w DATA_17A43A,x
	STA.w HDMA[$06].Parameters,x
	LDA.w DATA_17A44A,x
	STA.w HDMA[$05].Parameters,x
	LDA.w DATA_17A45A,x
	STA.w HDMA[$04].Parameters,x
	LDA.w DATA_17A464,x
	STA.w HDMA[$03].Parameters,x
	LDA.w DATA_17A473,x
	STA.w HDMA[$02].Parameters,x
	LDA.w DATA_17A482,x
	STA.w HDMA[$01].Parameters,x
	DEX
	BPL.b CODE_17A61B
	LDA.b #$7E
	STA.w HDMA[$02].IndirectSourceBank
	LDX.b #$09
CODE_17A64F:
	LDA.w DATA_17A433,x
	STA.l $7E5B18,x
	LDA.w DATA_17A43F,x
	STA.l $7E5B58,x
	LDA.w DATA_17A44F,x
	STA.l $7E5B98,x
	LDA.w DATA_17A45F,x
	STA.l $7E5BD8,x
	LDA.w DATA_17A469,x
	STA.l $7E5C18,x
	LDA.w DATA_17A478,x
	STA.l $7E5C58,x
	LDA.w DATA_17A487,x
	STA.l $7E5C98,x
	DEX
	BPL.b CODE_17A64F
	LDA.b #$00
	STA.w $1144
	DEC
	STA.w $1145
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	PHA
	SEC
	SBC.l DATA_map_world_tile_base_w,x
	CMP.b #!Define_YI_Map_ExtraLevels
	BCC.b CODE_17A6A6
	LDA.l DATA_map_world_tile_base_w,x
	STA.w !RAM_YI_Level_CurrentLevelFromMapLo
	LDA.w $0000					; Glitch: This should be LDA.b #$00!
CODE_17A6A6:
	STA.w !RAM_YI_Map_RunningYoshiIndex
	JSL.l CODE_17C74B
	PLA
	STA.w !RAM_YI_Level_CurrentLevelFromMapLo
	JSR.w CODE_17A871
	LDA.b #DATA_world_unlock_ptr_world1>>16
	STA.b $02
	REP.b #$20
	LDA.w #$0C0B
	STA.w $0319
	STA.w $0325
	STA.w $0331
	STA.w $033D
	STA.w $0349
	STA.w $0355
	LDX.w $1123
	CPX.b #$09
	BCC.b CODE_17A6F6
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.l DATA_world_unlock_ptr_table,x
	STA.b $00
	LDX.b #$00
CODE_17A6E1:
	LDA.b [$00]
	STA.b $04
	LDA.b ($04)
	AND.w #$000F
	BEQ.b CODE_17A6F5
	INC.b $00
	INC.b $00
	INX
	CPX.b #$09
	BCC.b CODE_17A6E1
CODE_17A6F5:
	DEX
CODE_17A6F6:
	TXA
	AND.w #$00FF
	STA.w $1123
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	STA.w $112B
	LDX.w !RAM_YI_Level_CurrentWorldLo
	STZ.w $1148
	LDA.l DATA_map_world_tile_base_w,x
	TAX
	LDA.w $0317,x
	CMP.w #$0A09
	BEQ.b CODE_17A739
	LDA.w #$F0F0
	STA.w $0317,x
	LDY.b #$08
	STZ.b $00
CODE_17A720:
	LDA.w !RAM_YI_Map_LevelHighScores,x
	AND.w #$00FF
	CLC
	ADC.b $00
	STA.b $00
	INX
	DEY
	BNE.b CODE_17A720
	LDA.b $00
	CMP.w #$0320
	BCC.b CODE_17A739
	INC.w $1148
CODE_17A739:
	SEP.b #$20
	JSL.l CODE_17C5FE
	REP.b #$20
	LDA.w !RAM_YI_Level_CurrentWorldLo
	STA.w $1125
	REP.b #$10
	LDA.w #$0009
	STA.b $7D
	STZ.b !RAM_YI_Global_Layer1XPosLo
	STZ.b !RAM_YI_Global_Layer1YPosLo
	STZ.b !RAM_YI_Global_Layer2XPosLo
	LDA.w #$0080
	STA.b !RAM_YI_Global_Layer2YPosLo
	STZ.b !RAM_YI_Global_Layer3YPosLo
	LDA.w #$02D0
	STA.b $69
	LDA.w #$0000
	STA.b $6B
	STZ.b $6F
	LDA.w $1125
	ASL
	ASL
	ORA.w $1123
	ASL
	ASL
	ASL
	STA.b $91
	LDX.w #$0001
	LDA.w !RAM_YI_Global_CurrentGameMode
	CMP.w #!Define_YI_GameMode23
	BEQ.b CODE_17A780
	DEX
CODE_17A780:
	STX.b $97
	LDA.w $1123
	STA.b $B1
	LDA.w $1125
	ASL
	ASL
	ORA.w $1123
	INC
	ASL
	TAY
	LDA.w DATA_worldmap_yoshi_ycoords_by_world,y
	SEC
	SBC.w #$0004
	STA.b $AD
	LDA.w DATA_worldmap_yoshi_xcoords_by_world,y
	SEC
	SBC.w #$0008
	STA.b $AF
	JSR.w CODE_17A825
	REP.b #$20
	LDX.b #$80
	STX.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #$1C20
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #$000A06
	STA.w DMA[$00].SourceLo
	LDX.b #$000A06>>16
	STX.w DMA[$00].SourceBank
	LDA.w #$0380
	STA.w DMA[$00].SizeLo
	LDY.b #$01
	STY.w !REGISTER_DMAEnable
	LDA.w #$2000
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$705800
	STA.w DMA[$00].SourceLo
	LDX.b #$705800>>16
	STX.w DMA[$00].SourceBank
	LDA.w #$1000
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	SEP.b #$30
	JSL.l CODE_process_vram_dma_queue_l
	LDX.b #$12
	JSL.l CODE_set_level_music
	LDA.w $0205
	BNE.b CODE_17A810
	LDA.b #!Define_YI_MusicID08_CutsceneAndBossTheme
	CLC
	ADC.w $1146
	STA.b !RAM_YI_Global_PlayMusicLo
	CMP.b #$09
	BEQ.b CODE_17A819
	LDA.w $0265
	AND.b #$7F
	BEQ.b CODE_17A810
	INC.b !RAM_YI_Global_PlayMusicLo
CODE_17A810:
	LDA.w !RAM_YI_Global_CurrentGameMode
	CMP.b #!Define_YI_GameMode27
	BCC.b CODE_17A819
	DEC.b !RAM_YI_Global_PlayMusicLo
CODE_17A819:
	JSL.l CODE_enable_nmi
	LDA.b #$FE
	STA.w !RAM_YI_Global_HDMAEnable
	JMP.w CODE_17B38A

CODE_17A825:
	LDX.w #$0000
	LDA.w $1125
	ASL
	ASL
	ORA.w $1123
	ASL
	STA.b $89
	TAY
	LDA.w DATA_17BE6E,y
	STA.b $83
	LDA.w DATA_worldmap_yoshi_ycoords_by_world,y
	SEC
	SBC.w #$0004
	STA.b $72
	STA.b $8D
	LDA.w DATA_worldmap_yoshi_xcoords_by_world,y
	SEC
	SBC.w #$0008
	STA.b $76
	STA.b $8F
	SEC
	SBC.w #$0074
	BMI.b CODE_17A85E
	TAX
	CMP.w #$0100
	BCC.b CODE_17A85E
	LDX.w #$0100
CODE_17A85E:
	TXA
	STA.b $69
	STA.w $6094
	STA.b $6D
	STA.b $79
	STA.b !RAM_YI_Global_Layer3XPosLo
	JMP.w CODE_17BF7C

CODE_17A86D:
	JSR.w CODE_17A825
	RTL

CODE_17A871:
	STZ.w $1115
	STZ.w $1135
	LDA.b #!Define_YI_GameMode21
	STA.w !RAM_YI_Global_CurrentGameMode
	STZ.w $1127
	JSR.w CODE_17A908
	LDA.w $0220
	BEQ.b CODE_17A8EF
	LDX.w !RAM_YI_Level_CurrentLevelFromMapLo
	LDA.b #$01
	STA.w !RAM_YI_Map_LevelClearFlags,x
	INC.w $1127
	REP.b #$30
	TXA
	AND.w #$00FF
	ASL
	TAX
	LDA.l YI_LevelDataPtrsAndEntranceData_DATA_17F3E7,x	; just-cleared tile-slot -> record offset
	TAX
	LDA.l YI_LevelDataPtrsAndEntranceData_DATA_17F471+$03,x	; record byte +3 = progression target (next tile-slot)
	SEP.b #$30
	TAY
	LDA.w !RAM_YI_Map_LevelClearFlags,y			; already cleared? then don't advance
	BNE.b CODE_17A8F1
	STY.w !RAM_YI_Level_CurrentLevelFromMapLo		; advance the token to the next tile-slot
	LDX.b #$FF
	TYA
CODE_17A8B1:
	INX
	SEC
	SBC.b #!Define_YI_Map_LevelsPerWorld
	BPL.b CODE_17A8B1
	REP.b #$30
	TXA
	AND.w #$00FF
	ASL
	STA.w !RAM_YI_Level_CurrentWorldLo
	SEP.b #$30
	JSL.l CODE_save_game
	LDA.b #!Define_YI_GameMode23
	STA.w !RAM_YI_Global_CurrentGameMode
	LDA.w !RAM_YI_Level_CurrentWorldLo
	LSR
	TAX
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	CMP.w DATA_map_world_tile_base_b,x
	BNE.b CODE_17A8F1
	STX.w $1115
	DEC.w !RAM_YI_Level_CurrentWorldLo
	DEC.w !RAM_YI_Level_CurrentWorldLo
	JSR.w CODE_17A908
	LDA.b #!Define_YI_GameMode27
	STA.w !RAM_YI_Global_CurrentGameMode
	LDA.b #$07
	STA.w !RAM_YI_Map_RunningYoshiIndex
CODE_17A8EF:
	BRA.b CODE_17A904

CODE_17A8F1:
	LDA.w $0220
	BPL.b CODE_17A904
	AND.b #$7F
	STA.w $1135
	JSL.l CODE_save_game
	LDA.b #!Define_YI_GameMode25
	STA.w !RAM_YI_Global_CurrentGameMode
CODE_17A904:
	STZ.w $0220
	RTS

CODE_17A908:
	REP.b #$20
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	SEC
	SBC.w DATA_map_world_tile_base_w,x
	STA.w $1123
	SEP.b #$20
	RTS

DATA_17A91A:
	dw CODE_17AA7A
	dw CODE_17A948
	dw CODE_17A94C
	dw CODE_17A950
	dw CODE_17A954
	dw CODE_17AB69
	dw CODE_17A995
	dw CODE_17A99C
	dw CODE_17A9A0
	dw CODE_17A9AF
	dw CODE_17AA7A
	dw CODE_17A9DE

;-------------------------------------------------------------------------
; CODE_gm28_world_score_flip_cutscene -- CODE_gm28_world_score_flip_cutscene (game-mode $28).
; Raidenthequick: `CODE_gm28_world_score_flip_cutscene` at $17:A932.
; Runs when the player just unlocked the next world; the "score flip" reveals
; the freshly-set per-level total scores as the cutscene plays out.
;
; INPUTS:
;   M=8 X=8 from gamemode dispatcher.
;   $7E:1127 = sub-state byte (0 = setup, >0 = state index into DATA_17A91A
;     dispatch table whose entries are CODE_17A9AF / CODE_17AA7A / CODE_17A9DE).
;   $7E:1118 = world-map state secondary (used by score-display sub-states).
; OUTPUTS:
;   On sub-state completion: clears $7E:1118 and advances $7E:0118 (gamemode)
;     to $29 (fade to bonus-game / $2A) or $22 (return to overworld).
;   Updates score OAM at $7E:6A80+ via per-state handlers.
; MODIFIES: A, X, Y, DP $00..$10.
; CALLERS:
;   Bank00 `DATA_game_mode_pointers[$28]` -- per-frame tick.
;-------------------------------------------------------------------------
CODE_17A932:
CODE_gm28_world_score_flip_cutscene:				; Raiden alias
	JSL.l CODE_init_oam_buffer
	LDA.w $1127
	BEQ.b CODE_17A943
	ASL
	TAX
	JSR.w (DATA_17A91A-$02,x)
	STZ.w $1118
CODE_17A943:
	REP.b #$30
	JMP.w CODE_17B387

CODE_17A948:
	LDX.b #$00
	BRA.b CODE_17A9A2

CODE_17A94C:
	LDX.b #$02
	BRA.b CODE_17A9A2

CODE_17A950:
	LDX.b #$04
	BRA.b CODE_17A9A2

CODE_17A954:
	LDX.b #$06
	JSL.l CODE_17D87D
	LDA.w $1118
	BEQ.b CODE_17A994
	LDA.b #$03
	STA.w $1127
	STZ.w $1120
	STZ.w $1121
	INC.w $111F
	LDA.w $111F
	CMP.b #$08
	BCC.b CODE_17A994
	LDA.b #$06
	STA.w $1127
	STZ.w $111F
	LDA.w $1148
	BEQ.b CODE_17A98B
	LDA.b #$06
	STA.w $1148
	LDA.b #$14
	STA.w $1133
CODE_17A98B:
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_map_world_tile_base_w,x
	TAX
	LDY.b #$08
CODE_17A994:
	RTS

CODE_17A995:
	LDX.b #$08
	STX.w $1121
	BRA.b CODE_17A9A2

CODE_17A99C:
	LDX.b #$0A
	BRA.b CODE_17A9A2

CODE_17A9A0:
	LDX.b #$0C
CODE_17A9A2:
	JSL.l CODE_17D87D
	LDA.w $1118
	BEQ.b CODE_17A9AE
	INC.w $1127
CODE_17A9AE:
	RTS

CODE_17A9AF:
	LDX.b #$0E
	JSL.l CODE_17D87D
	LDA.w $1118
	BEQ.b CODE_17A9DD
	LDA.b #$04
	STA.b !RAM_YI_Global_Layer2XPosLo
	LDA.b #$84
	STA.b !RAM_YI_Global_Layer2YPosLo
	LDA.b #$07
	STA.w $1127
	INC.w $1121
	JSL.l CODE_17D3AC
	INC.w $111F
	LDA.w $111F
	CMP.b #$08
	BCC.b CODE_17A9DD
	LDA.b #$0B
	STA.w $1127
CODE_17A9DD:
	RTS

CODE_17A9DE:
	INC.w !RAM_YI_Level_CurrentWorldLo
	INC.w !RAM_YI_Level_CurrentWorldLo
	LDA.w !RAM_YI_Level_CurrentWorldLo
	LSR
	TAY
	LDX.w DATA_map_world_tile_base_b,y
	LDA.b #$80
	STA.w !RAM_YI_Map_LevelClearFlags,x
	LDA.b #$FF
	STA.w $011A
	LDA.b #!Define_YI_GameMode08
	STA.w !RAM_YI_Global_CurrentGameMode
	STZ.w !RAM_YI_Level_FinalWorldUnlockedFlagLo
	STZ.w $0217
	RTS

DATA_17AA02:
	dw CODE_17AA4B
	dw CODE_17B519
	dw CODE_17B519
	dw CODE_17B519
	dw CODE_17AA8B
	dw CODE_17AA9C
	dw CODE_17AAB1
	dw CODE_17AAE0
	dw CODE_17AB03
	dw CODE_17AB1C
	dw CODE_17AB69
	dw CODE_17AB24

;-------------------------------------------------------------------------
; CODE_gm26_level_score_update -- CODE_gm26_level_score_update (game-mode $26).
; Raidenthequick: `CODE_gm26_level_score_update` at $17:AA1A.
; Animates the per-level-tile score panel after the player clears a level
; with a perfect (100%) run. Runs after the gm $25 fade.
;
; INPUTS:
;   M=8 X=8 from gamemode dispatcher.
;   $7E:1127 = sub-state index (0 = setup, 1..6 = DATA_17AA02 dispatch slots).
;   $7E:0218 / $7E:021A = world / level (the score being updated).
;   $70:7C02-area save-file data for last score values.
; OUTPUTS:
;   Score OAM at $7E:6A80+ updated each frame.
;   On sub-state == $07: advances !RAM_YI_Global_CurrentGameMode -> $27/$22.
;   On completion: per-tile high-score in $7E:02B8 region rewritten.
; MODIFIES: A, X, Y, DP $00..$0F.
; CALLERS:
;   Bank00 `DATA_game_mode_pointers[$26]` -- per-frame tick.
;-------------------------------------------------------------------------
CODE_17AA1A:
CODE_gm26_level_score_update:				; Raiden alias
	JSL.l CODE_init_oam_buffer
	LDA.w $1127
	BEQ.b CODE_17AA3E
	ASL
	TAX
	JSR.w (DATA_17AA02-$02,x)
	LDA.w $1127
	CMP.b #$07
	BCC.b CODE_17AA39
	CMP.b #$0B
	BCS.b CODE_17AA39
	STA.w $1121
	JSR.w CODE_17B687
CODE_17AA39:
	STZ.w $1118
	BRA.b CODE_17AA46

CODE_17AA3E:
	LDA.w $1131
	BEQ.b CODE_17AA46
	JSR.w CODE_17B753
CODE_17AA46:
	REP.b #$30
	JMP.w CODE_17B387

CODE_17AA4B:
	JSR.w CODE_17AA7A
	LDA.w $1133
	BNE.b CODE_17AA79
	LDY.w !RAM_YI_Level_CurrentLevelFromMapLo
	LDA.w !RAM_YI_Map_LevelHighScores,y
	PHA
	LDA.w $1135
	STA.w !RAM_YI_Map_LevelHighScores,y
	PLA
	STA.w $1135
	LDA.w !RAM_YI_Level_CurrentWorldLo
	LSR
	TAY
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	SEC
	SBC.w DATA_map_world_tile_base_b,y
	STA.w $111F
	JSR.w CODE_17B509
	DEC.w $1127
CODE_17AA79:
	RTS

CODE_17AA7A:
	INC.w $1133
	LDA.w $1133
	CMP.b #$14
	BCC.b CODE_17AA8A
	INC.w $1127
	STZ.w $1133
CODE_17AA8A:
	RTS

CODE_17AA8B:
	INC.w $1133
	LDA.w $1133
	CMP.b #$50
	BCC.b CODE_17AA9B
	INC.w $1127
	STZ.w $1133
CODE_17AA9B:
	RTS

CODE_17AA9C:
	JSL.l CODE_17D2B3
	REP.b #$20
	LDA.w #$0100
	STA.w $1110
	SEP.b #$20
	LDA.b #!Define_YI_SoundID15_Growth
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	INC.w $1127
CODE_17AAB1:
	REP.b #$20
	LDA.w $1110
	SEC
	SBC.w #$0008
	STA.w $1110
	SEP.b #$20
	CMP.b #$20
	BCS.b CODE_17AAD6
	INC.w $1127
	LDX.w !RAM_YI_Level_CurrentLevelFromMapLo
	LDA.w $1135
	STA.w !RAM_YI_Map_LevelHighScores,x
	STZ.w $1135
	LDA.b #!Define_YI_SoundID05_Powerup
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
CODE_17AAD6:
	REP.b #$20
	LDX.b #$0B
	JSR.w CODE_17B623
	SEP.b #$20
CODE_17AADF:
	RTS

CODE_17AAE0:
	REP.b #$20
	LDA.w $1110
	CLC
	ADC.w #$0008
	STA.w $1110
	SEP.b #$20
	LDA.w $1111
	BEQ.b CODE_17AAF9
	STZ.w $1110
	INC.w $1127
CODE_17AAF9:
	REP.b #$20
	LDX.b #$0B
	JSR.w CODE_17B623
	SEP.b #$20
	RTS

CODE_17AB03:
	LDX.b #$00
	JSL.l CODE_17D87D
	LDA.w !RAM_YI_Level_CurrentWorldLo
	LSR
	TAX
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	SEC
	SBC.w DATA_map_world_tile_base_b,x
	STA.w $111F
	INC.w $1127
	RTS

CODE_17AB1C:
	JSL.l CODE_17D523
	INC.w $1127
	RTS

CODE_17AB24:
	STZ.w $1127
	INC.w $1131
CODE_17AB2A:
	RTS

DATA_17AB2B:
	dw CODE_17AB9C
	dw CODE_17ABE6
	dw CODE_17ABF6
	dw CODE_17AC0A
	dw CODE_17AC19
	dw CODE_17AC44
	dw CODE_17AD09
	dw CODE_17B16B
	dw CODE_17B013
	dw CODE_17B03E
	dw CODE_17B060
	dw CODE_17B03E
	dw CODE_17B060
	dw CODE_17B03E
	dw CODE_17B097
	dw CODE_17B16B
	dw CODE_17B0BC
	dw CODE_17B03E
	dw CODE_17B060
	dw CODE_17B03E
	dw CODE_17B060
	dw CODE_17B03E
	dw CODE_17B0E7
	dw CODE_17B16B
	dw CODE_17B10C
	dw CODE_17B120
	dw CODE_17B12C
	dw CODE_17B138
	dw CODE_17B176
	dw CODE_17B194
	dw CODE_17B326

CODE_17AB69:
	STZ.w $1118
	LDA.w $1148
	BEQ.b CODE_17AB86
	ASL
	TAX
	JSR.w (DATA_17AB2B-$02,x)
	LDA.w $1148
	CMP.b #$07
	BCC.b CODE_17AB89
	CMP.b #$19
	BCS.b CODE_17AB89
	JSR.w CODE_17AB8E
	BRA.b CODE_17AB89

CODE_17AB86:
	JSR.w CODE_17AA8B
CODE_17AB89:
	RTS

DATA_17AB8A:
	db $81,$22,$5D,$09

CODE_17AB8E:
	LDA.b $30
	AND.b #$04
	LSR
	TAX
CODE_17AB94:
	LDA.w DATA_17AB8A,x
	STA.l YI_Global_PaletteMirror[$34].LowByte
	RTS

CODE_17AB9C:
	LDA.w $111F
	STA.w $114A
	LDA.b #$3C
	STA.w $1133
	LDX.b #$00
	JSR.w CODE_17AC0C
	REP.b #$20
	LDA.w $114A
	ASL
	TAX
	LDA.w DATA_17DCEF,x
	LDX.w $1106
	BEQ.b CODE_17ABBF
	CLC
	ADC.w #$0380
CODE_17ABBF:
	CLC
	ADC.w #$0042
	STA.b $0A
	CLC
	ADC.w #$0040
	STA.b $0C
	LDY.b #$00
	LDA.w #$2DA9
	STA.b ($0A),y
	LDA.w #$2DB9
	STA.b ($0C),y
	INY
	INY
	LDA.w #$2DAA
	STA.b ($0A),y
	LDA.w #$2DBA
	STA.b ($0C),y
	SEP.b #$20
	RTS

CODE_17ABE6:
	REP.b #$20
	DEC.w $1133
	LDA.w $1133
	BNE.b CODE_17ABF3
	INC.w $1148
CODE_17ABF3:
	SEP.b #$20
	RTS

CODE_17ABF6:
	LDA.w $111F
	CMP.w $114A
	BNE.b CODE_17AC06
	INC
	CMP.b #$08
	BCS.b CODE_17AC24
	STA.w $111F
CODE_17AC06:
	LDX.b #$02
	BRA.b CODE_17AC0C

CODE_17AC0A:
	LDX.b #$04
CODE_17AC0C:
	JSL.l CODE_17D87D
	LDA.w $1118
	BEQ.b CODE_17AC18
	INC.w $1148
CODE_17AC18:
	RTS

CODE_17AC19:
	LDX.b #$06
	JSL.l CODE_17D87D
	LDA.w $1118
	BEQ.b CODE_17AC43
CODE_17AC24:
	STZ.w $1120
	STZ.w $1121
	LDX.b #$03
	INC.w $111F
	LDA.w $111F
	CMP.b #$08
	BCC.b CODE_17AC40
	LDA.b #$14
	STA.w $1133
	STZ.w $111F
	LDX.b #$06
CODE_17AC40:
	STX.w $1148
CODE_17AC43:
	RTS

CODE_17AC44:
	LDA.b #!Define_YI_SoundID97_WorldClear
	JSL.l CODE_push_sound_queue
	REP.b #$20
	JSR.w CODE_17AC94
	REP.b #$10
	LDA.w #$705800>>16
	STA.b $01
	LDY.w #$6800
	LDX.w #$705800
	LDA.w #$1000
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$10
	LDX.b #$0C
	STZ.b $00
	LDA.w #$0040
	STA.b $02
CODE_17AC6E:
	STZ.w $1160,x
	LDA.b $00
	STA.w $1152,x
	CLC
	ADC.w #$000A
	STA.b $00
	LDA.b $02
	STA.w $117C,x
	CLC
	ADC.w #$0018
	STA.b $02
	DEX
	DEX
	BPL.b CODE_17AC6E
	INC.w $115E
	SEP.b #$30
	INC.w $1148
	RTS

CODE_17AC94:
	LDA.w #$5800
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0002
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STZ.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0800
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08AA8B>>16
	LDA.w #FXCODE_08AA8B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	RTS

DATA_17ACB3:
	dw $0001,$0001,$0001,$0001,$0002,$0002,$0002,$0002
	dw $0002,$0003,$0003,$0003,$0003,$0003,$0002,$0002
	dw $0001

DATA_17ACD5:
	dw $0030,$0030,$0030,$0030,$0030,$FFD0,$FFD0,$FFD0
	dw $FFD0,$0000,$0030,$0030

DATA_17ACED:
	dw $0030,$0003,$0003,$0002,$0002,$0002,$0002,$0002
	dw $0002,$0001,$0001,$0001,$0001,$0001

CODE_17AD09:
	REP.b #$20
	LDY.b #$0C
CODE_17AD0D:
	LDA.w $1152,y
	DEC
	STA.w $1152,y
	BNE.b CODE_17AD45
	LDX.w $116E,y
	LDA.w DATA_17ACB3,x
	STA.w $1152,y
	LDA.w $1160,y
	CLC
	ADC.w DATA_17ACD5,x
	STA.w $1160,y
	INX
	INX
	CPX.b #$1A
	BCS.b CODE_17AD3F
	TXA
	STA.w $116E,y
	LDA.w $117C,y
	SEC
	SBC.w DATA_17ACED,x
	STA.w $117C,y
	BRA.b CODE_17AD45

CODE_17AD3F:
	LDA.w #$0100
	STA.w $1160,y
CODE_17AD45:
	DEY
	DEY
	BPL.b CODE_17AD0D
	LDX.b #$0C
	LDA.w #$0000
CODE_17AD4E:
	CLC
	ADC.w $1160,x
	DEX
	DEX
	BPL.b CODE_17AD4E
	CMP.w #$0700
	BNE.b CODE_17AD64
	INC.w $1148
	LDA.w #$0070
	STA.w $1133
CODE_17AD64:
	JSR.w CODE_17AD93
	JSR.w CODE_17AE1B
	JSR.w CODE_17AF33
	SEP.b #$20
	RTS

DATA_17AD70:
	dw FXDATA_558000+$6081,FXDATA_558000+$60A1,FXDATA_558000+$60C1,FXDATA_558000+$60E1,FXDATA_558000+$60A1,FXDATA_558000+$4081,FXDATA_548000+$20C0

DATA_17AD7E:
	db (FXDATA_558000+$6081)>>16,(FXDATA_558000+$60A1)>>16,(FXDATA_558000+$60C1)>>16,(FXDATA_558000+$60E1)>>16,(FXDATA_558000+$60A1)>>16,(FXDATA_558000+$4081)>>16,(FXDATA_548000+$20C0)>>16

DATA_17AD85:
	db $00,$20,$40,$60,$00,$20,$40

DATA_17AD8C:
	db $00,$00,$00,$00,$20,$20,$20

CODE_17AD93:
	JSR.w CODE_17AC94
	REP.b #$10
	LDX.w #$000C
	STX.b $00
	STZ.b $02
CODE_17AD9F:
	LDX.b $00
	LDY.b $02
	LDA.w $1160,x
	BEQ.b CODE_17ADEE
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w $1160,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w DATA_17AD70,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	TYA
	LSR
	TAY
	LDA.w DATA_17AD8C,y
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w DATA_17AD85,y
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w DATA_17AD7E,y
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	SEP.b #$10
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
CODE_17ADEE:
	INC.b $02
	INC.b $02
	DEC.b $00
	DEC.b $00
	BPL.b CODE_17AD9F
	LDA.w #$705800>>16
	STA.b $01
	LDY.w #$6800
	LDX.w #$705800
	LDA.w #$1000
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$10
	RTS

DATA_17AE0D:
	dw $3EC8,$3EC4,$3EC0,$3E8C,$3E88,$3E84,$3E80

CODE_17AE1B:
	REP.b #$10
	LDX.w #$000C
	LDY.w $6092
CODE_17AE23:
	LDA.w $1160,x
	BNE.b CODE_17AE2B
	JMP.w CODE_17AEEB

CODE_17AE2B:
	LDA.w $117C,x
	STA.w $6000,y
	STA.w $6008,y
	CLC
	ADC.w #$0010
	STA.w $6010,y
	STA.w $6018,y
	STA.w $6020,y
	STA.w $6028,y
	LDA.w #$8000
	STA.b $00
	LDA.w $116E,x
	CMP.w #$0012
	BCC.b CODE_17AE7C
	STZ.b $00
	LDA.w #$0028
	STA.w $6002,y
	PHA
	CLC
	ADC.w #$0010
	STA.w $600A,y
	PLA
	STA.w $6012,y
	CLC
	ADC.w #$0008
	STA.w $601A,y
	CLC
	ADC.w #$0008
	STA.w $6022,y
	CLC
	ADC.w #$0008
	STA.w $602A,y
	BRA.b CODE_17AEA3

CODE_17AE7C:
	LDA.w #$0028
	STA.w $600A,y
	PHA
	CLC
	ADC.w #$0010
	STA.w $6002,y
	PLA
	STA.w $602A,y
	CLC
	ADC.w #$0008
	STA.w $6022,y
	CLC
	ADC.w #$0008
	STA.w $601A,y
	CLC
	ADC.w #$0008
	STA.w $6012,y
CODE_17AEA3:
	LDA.w DATA_17AE0D,x
	ORA.b $00
	STA.w $6004,y
	PHA
	ORA.w #$0020
	STA.w $600C,y
	PLA
	INC
	INC
	STA.w $6014,y
	CLC
	ADC.w #$0010
	STA.w $601C,y
	CLC
	ADC.w #$0010
	STA.w $6024,y
	CLC
	ADC.w #$0010
	STA.w $602C,y
	LDA.w #$0002
	STA.w $6006,y
	STA.w $600E,y
	LDA.w #$0000
	STA.w $6016,y
	STA.w $601E,y
	STA.w $6026,y
	STA.w $602E,y
	TYA
	CLC
	ADC.w #$0030
	TAY
CODE_17AEEB:
	DEX
	DEX
	BMI.b CODE_17AEF2
	JMP.w CODE_17AE23

CODE_17AEF2:
	STY.w $6092
	JSR.w CODE_17AFCC
	SEP.b #$10
	RTS

DATA_17AEFB:
	db $11,$12,$13,$14,$15,$80,$0F,$10,$11,$12,$13,$80,$80,$80

DATA_17AF09:
	db $80,$80,$80,$80,$11,$12,$13,$14,$80,$80,$80,$80,$80,$80

DATA_17AF17:
	dw $3FCB,$3FDB,$3FCB,$3FDA,$3FCA,$3FCB,$3FCB,$3FDB
	dw $3FCB,$3FDA,$3FCA,$3FCB,$3FCB,$3FCB

CODE_17AF33:
	REP.b #$10
	LDX.w #$000C
	LDA.w $6092
	STA.b $00
CODE_17AF3D:
	LDA.w $116E,x
	BEQ.b CODE_17AF7F
	TAY
	PHA
	LDA.w DATA_17AF17,y
	STA.b $04
	PLA
	LSR
	TAY
	LDA.w DATA_17AEFB,y
	AND.w #$00FF
	CMP.w #$0080
	BCS.b CODE_17AF5F
	LDY.w #$0028
	STY.b $02
	JSR.w CODE_17AF8B
CODE_17AF5F:
	LDA.w $116E,x
	TAY
	PHA
	LDA.w DATA_17AF17,y
	STA.b $04
	PLA
	LSR
	TAY
	LDA.w DATA_17AF09,y
	AND.w #$00FF
	CMP.w #$0080
	BCS.b CODE_17AF7F
	LDY.w #$0038
	STY.b $02
	JSR.w CODE_17AF8B
CODE_17AF7F:
	DEX
	DEX
	BPL.b CODE_17AF3D
	LDA.b $00
	STA.w $6092
	SEP.b #$10
	RTS

CODE_17AF8B:
	LDY.b $00
	ADC.w $117C,x
	STA.w $6000,y
	LDA.b $02
	STA.w $6002,y
	LDA.b $04
	STA.w $6004,y
	LDA.w #$4000
	STA.w $6006,y
	LDA.b $00
	CLC
	ADC.w #$0008
	STA.b $00
	RTS

DATA_17AFAC:
	dw DATA_5FDFC4,DATA_5FDFCA,DATA_5FDFD0,DATA_5FDFD6,DATA_5FDFDC,DATA_5FDFE2,DATA_5FDFE8,DATA_5FDFEE

DATA_17AFBC:
	dw $0010,$0006,$0006,$0006,$0006,$0006,$0006,$0006

CODE_17AFCC:
	LDA.w $1148
	CMP.w #$0008
	BCC.b CODE_17B012
	CMP.w #$001D
	BCS.b CODE_17B012
	INC.w $118A
	LDX.w $118C
	LDA.w $118A
	CMP.w DATA_17AFBC,x
	BCC.b CODE_17AFF7
	STZ.w $118A
	INX
	INX
	CPX.w #$0010
	BCC.b CODE_17AFF4
	LDX.w #$0000
CODE_17AFF4:
	STX.w $118C
CODE_17AFF7:
	LDA.w DATA_17AFAC,x
	STA.b $00
	LDA.w #DATA_5FDFC4>>16
	STA.b $02
	LDY.w #$0000
CODE_17B004:
	TYX
	LDA.b [$00],y
	STA.l YI_Global_PaletteMirror[$FD].LowByte,x
	INY
	INY
	CPY.w #$0006
	BCC.b CODE_17B004
CODE_17B012:
	RTS

CODE_17B013:
	INC.w $1148
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.l DATA_map_world_tile_base_w,x
	CLC
	ADC.b #$08
	STA.w $114C
	TAX
	LDA.b #$01
	STA.w !RAM_YI_Map_LevelClearFlags,x
	REP.b #$20
	JSR.w CODE_17AE1B
	LDA.w #$0010
	STA.w $1110
	JSR.w CODE_17B623
	SEP.b #$20
	LDA.b #!Define_YI_SoundID05_Powerup
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	RTS

CODE_17B03E:
	REP.b #$20
	JSR.w CODE_17AE1B
	LDX.w $1130
	LDA.w $1110
	CLC
	ADC.w DATA_17B557,x
	CMP.w DATA_17B561,x
	BCC.b CODE_17B05E
	INC.w $1148
	INC.w $1130
	INC.w $1130
	LDA.w DATA_17B561,x
CODE_17B05E:
	BRA.b CODE_17B07D

CODE_17B060:
	REP.b #$20
	JSR.w CODE_17AE1B
	LDX.w $1130
	LDA.w $1110
	SEC
	SBC.w DATA_17B557,x
	CMP.w DATA_17B561,x
	BCS.b CODE_17B07D
	INC.w $1148
	INC.w $1130
	INC.w $1130
CODE_17B07D:
	STA.w $1110
	LDX.w $114C
	JSR.w CODE_17B623
	SEP.b #$20
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w $114C
	SEC
	SBC.l DATA_map_world_tile_base_w,x
	JSR.w CODE_17B693
	RTS

CODE_17B097:
	REP.b #$20
	JSR.w CODE_17AE1B
	LDA.w #$001E
	STA.w $1133
	INC.w $1148
	LDY.b #$10
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w $114C
	ASL
	TAX
	LDA.l DATA_17DC37
	ORA.l DATA_17DC4F,x
	STA.b $00
	JMP.w CODE_17B662

CODE_17B0BC:
	REP.b #$20
	JSR.w CODE_17AE1B
	SEP.b #$20
	INC.w $1148
	INC.w $114C
	LDA.w $114C
	TAX
	LDA.b #$01
	STA.w !RAM_YI_Map_LevelClearFlags,x
	REP.b #$20
	STZ.w $1130
	LDA.w #$0010
	STA.w $1110
	JSR.w CODE_17B623
	SEP.b #$20
	LDA.b #!Define_YI_SoundID05_Powerup
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	RTS

CODE_17B0E7:
	REP.b #$20
	JSR.w CODE_17AE1B
	LDA.w #$001E
	STA.w $1133
	INC.w $1148
	LDY.b #$12
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w $114C
	ASL
	TAX
	LDA.l DATA_17DC39
	ORA.l DATA_17DC4F,x
	STA.b $00
	JMP.w CODE_17B662

CODE_17B10C:
	LDX.b #$00
	JSR.w CODE_17AB94
	REP.b #$20
	JSR.w CODE_17AE1B
	SEP.b #$20
	LDX.b #$08
	STX.w $1121
	JMP.w CODE_17AC0C

CODE_17B120:
	REP.b #$20
	JSR.w CODE_17AE1B
	SEP.b #$20
	LDX.b #$0A
	JMP.w CODE_17AC0C

CODE_17B12C:
	REP.b #$20
	JSR.w CODE_17AE1B
	SEP.b #$20
	LDX.b #$0C
	JMP.w CODE_17AC0C

CODE_17B138:
	REP.b #$20
	JSR.w CODE_17AE1B
	SEP.b #$20
	LDX.b #$0E
	JSL.l CODE_17D87D
	LDA.w $1118
	BEQ.b CODE_17B16A
	LDA.b #$04
	STA.b !RAM_YI_Global_Layer2XPosLo
	LDA.b #$84
	STA.b !RAM_YI_Global_Layer2YPosLo
	INC.w $1121
	JSL.l CODE_17D3AC
	LDX.b #$19
	INC.w $111F
	LDA.w $111F
	CMP.b #$08
	BCC.b CODE_17B167
	LDX.b #$1D
CODE_17B167:
	STX.w $1148
CODE_17B16A:
	RTS

CODE_17B16B:
	JSR.w CODE_17ABE6
	REP.b #$20
	JSR.w CODE_17AE1B
	SEP.b #$20
	RTS

CODE_17B176:
	REP.b #$20
	JSR.w CODE_17AE1B
	INC.w $1148
	LDX.b #$0C
	LDA.w #$0000
CODE_17B183:
	STA.w $1152,x
	CLC
	ADC.w #$000A
	DEX
	DEX
	BPL.b CODE_17B183
	INC.w $115E
	SEP.b #$20
	RTS

CODE_17B194:
	REP.b #$30
	LDY.w #$000C
CODE_17B199:
	LDA.w $1160,y
	BEQ.b CODE_17B1D3
	LDA.w $1152,y
	DEC
	STA.w $1152,y
	BNE.b CODE_17B1D3
	LDX.w $116E,y
	LDA.w DATA_17ACB3,x
	STA.w $1152,y
	LDA.w $1160,y
	SEC
	SBC.w #$0030
	STA.w $1160,y
	INX
	INX
	CPX.w #$0022
	BCC.b CODE_17B1CF
	LDA.w #$0000
	STA.w $1160,y
	STA.w $1152,y
	STA.w $116E,y
	BRA.b CODE_17B1D3

CODE_17B1CF:
	TXA
	STA.w $116E,y
CODE_17B1D3:
	DEY
	DEY
	BPL.b CODE_17B199
	LDA.w $1160
	BNE.b CODE_17B1EB
	LDA.w $116E
	CMP.w #$000C
	BCC.b CODE_17B1EB
	INC.w $1148
	SEP.b #$30
	BRA.b CODE_17B20F

CODE_17B1EB:
	JSR.w CODE_17B24C
	SEP.b #$10
	JSR.w CODE_17AD93
	JSR.w CODE_17AE1B
	SEP.b #$20
	LDX.b #$0C
CODE_17B1FA:
	LDA.w $116E,x
	BNE.b CODE_17B20B
	LDA.w $1152,x
	DEC
	BNE.b CODE_17B20B
	LDA.b #!Define_YI_SoundID36_CollectFlower
	JSL.l CODE_push_sound_queue
CODE_17B20B:
	DEX
	DEX
	BPL.b CODE_17B1FA
CODE_17B20F:
	RTS
	
DATA_17B210:
	dw $0004,$0004,$0004,$0004,$0004,$0004

DATA_17B21C:
	db $04,$08,$10,$14,$14,$14

DATA_17B222:
	db $04,$01,$00,$FC,$FC,$FC

DATA_17B228:
	db $0C,$0D,$10,$14,$14,$14

DATA_17B22E:
	db $14,$18,$20,$24,$24,$24

DATA_17B234:
	db $02,$04,$06,$0A,$0A,$0A

DATA_17B23A:
	db $02,$04,$06,$0A,$0A,$0A

DATA_17B240:
	dw $3FCB,$3FDB,$3FCB,$3FDA,$3FCA,$3FCA

CODE_17B24C:
	LDX.w #$000C
	LDY.w $6092
	STY.b $00
CODE_17B254:
	LDA.w $1160,x
	BEQ.b CODE_17B25C
	JMP.w CODE_17B319

CODE_17B25C:
	INC.w $1152,x
	LDA.w $116E,x
	TAY
	CPY.w #$000C
	BCC.b CODE_17B26B
	JMP.w CODE_17B319

CODE_17B26B:
	LDA.w $1152,x
	CMP.w DATA_17B210,y
	BCC.b CODE_17B27F
	INC.w $116E,x
	INC.w $116E,x
	LDA.w #$0000
	STA.w $1152,x
CODE_17B27F:
	TYA
	LSR
	TAY
	LDA.w DATA_17B21C,y
	AND.w #$00FF
	STA.b $10
	LDA.w DATA_17B222,y
	AND.w #$00FF
	STA.b $12
	LDA.w DATA_17B228,y
	AND.w #$00FF
	STA.b $14
	LDA.w DATA_17B22E,y
	AND.w #$00FF
	STA.b $16
	LDA.w DATA_17B234,y
	AND.w #$00FF
	STA.b $18
	LDA.w DATA_17B23A,y
	AND.w #$00FF
	STA.b $1A
	TYA
	ASL
	TAY
	LDA.w DATA_17B240,y
	STA.b $0E
	LDY.b $00
	LDA.w $117C,x
	PHA
	SEC
	SBC.b $10
	STA.w $6000,y
	PLA
	PHA
	CLC
	ADC.b $12
	STA.w $6008,y
	PLA
	PHA
	CLC
	ADC.b $14
	STA.w $6010,y
	PLA
	CLC
	ADC.b $16
	STA.w $6018,y
	LDA.w #$0028
	STA.w $600A,y
	STA.w $6012,y
	CLC
	ADC.b $18
	STA.w $6002,y
	LDA.w #$0028
	CLC
	ADC.b $1A
	STA.w $601A,y
	LDA.b $0E
	STA.w $6004,y
	STA.w $600C,y
	STA.w $6014,y
	STA.w $601C,y
	LDA.w #$4000
	STA.w $6006,y
	STA.w $600E,y
	STA.w $6016,y
	STA.w $601E,y
	TYA
	CLC
	ADC.w #$0020
	STA.b $00
CODE_17B319:
	DEX
	DEX
	BMI.b CODE_17B320
	JMP.w CODE_17B254

CODE_17B320:
	LDA.b $00
	STA.w $6092
	RTS

CODE_17B326:
	LDA.b #$08
	STA.w $1112
	ASL
	TAX
	REP.b #$20
	LDA.w DATA_17E257,x
	STA.w $1109
	STZ.b !RAM_YI_Global_Layer2XPosLo
	LDA.w #$0080
	STA.b !RAM_YI_Global_Layer2YPosLo
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.l DATA_map_world_tile_base_w,x
	TAY
	LDA.w #$0A09
	STA.w $0317,y
	SEP.b #$20
	JSL.l CODE_save_game
	LDX.b #!Define_YI_GameMode22
	LDA.w !RAM_YI_Global_CurrentGameMode
	CMP.b #!Define_YI_GameMode28
	BCC.b CODE_17B35F
	TAX
	LDA.b #$0B
	STA.w $1127
CODE_17B35F:
	STX.w !RAM_YI_Global_CurrentGameMode
	RTS

;-------------------------------------------------------------------------
; CODE_gm24_overworld_level_progression -- CODE_gm24_overworld_level_progression (game-mode $24).
; Raidenthequick: `CODE_gm24_overworld_level_progression` at $17:B363.
; Per-frame tick during the "Yoshi walks to the next world-map tile" sequence
; that runs immediately after a level is cleared (in-between the gm $25
; fade and the gm $26 score-update).
;
; INPUTS:
;   M=8 X=8 from gamemode dispatcher.
;   $7E:1131 = primary sub-state byte (0 = fresh entry, !=0 = mid-walk).
;   $7E:1127 = secondary state (1 = walking, 0 = wait).
;   $7E:1132/$7E:1141/$7E:1145 used as per-step counters.
;   Save state at $70:7C02+ for tile-availability sentinels.
; OUTPUTS:
;   Updates Yoshi-sprite OAM (head + 4 body frames) each frame via CODE_17BF7C.
;   On walk-complete: hands off to gamemode $26 (score-update) or $22 (idle map).
;   Sets $7E:114E / $7E:1150 = next-level-tile pointer for downstream gm $2D.
; MODIFIES: A, X, Y, DBR (PHK/PLB inside subs), DP $00..$10.
; CALLERS:
;   Bank00 `DATA_game_mode_pointers[$24]` -- per-frame tick.
;-------------------------------------------------------------------------
CODE_17B363:
CODE_gm24_overworld_level_progression:			; Raiden alias
	JSL.l CODE_init_oam_buffer
	LDA.w $1131
	BNE.b CODE_17B373
	REP.b #$30
	JSR.w CODE_17BC01
	BRA.b CODE_17B385

CODE_17B373:
	LDA.w $1127
	BEQ.b CODE_17B37D
	JSR.w CODE_17B4E6
	BRA.b CODE_17B385

CODE_17B37D:
	LDA.w $1131
	BEQ.b CODE_17B385
	JSR.w CODE_17B753
CODE_17B385:
	REP.b #$30
CODE_17B387:
	JSR.w CODE_17BF7C
CODE_17B38A:				; Note: Related to updating map screen sprites.
	REP.b #$20
	LDA.b $6D
	STA.w $6094
	LDX.b #FXCODE_08B1EF>>16
	LDA.w #FXCODE_08B1EF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	PLB
	RTL

CODE_17B39E:
	PHP
	SEP.b #$30
	PHB
	LDA.b #$70219A>>16
	PHA
	PLB
	REP.b #$20
	LDX.b #$00
CODE_17B3AA:
	LDA.w $70219A,x
	STA.b $00
	LDA.w $7021BA,x
	STA.w $70219A,x
	LDA.b $00
	STA.w $7021BA,x
	INX
	INX
	CPX.b #$06
	BCC.b CODE_17B3AA
	SEP.b #$20
	PLB
	PLP
	RTS

DATA_17B3C5:
	dw CODE_17BF63
	dw CODE_17BF22
	dw CODE_17C562
	dw CODE_17C5C5

;-------------------------------------------------------------------------
; CODE_gm22_overworld -- CODE_gm22_overworld (game-mode $22).
; Raidenthequick: `CODE_gm22_overworld` at $17:B3CD.
; THE main world-map loop. Runs every frame while the player has overworld
; control: polls controller input, ticks the world-map dispatch state machine
; via `DATA_world_map_state_ptr` (DATA_world_map_state_ptr), animates Yoshi+sparkle on the map,
; and on level-tile select transitions to gamemode $1F (level fade-out) then
; $0B/$0C (level loader). This is the upstream of the level-loading pipeline.
;
; INPUTS:
;   M=8 X=8 from gamemode dispatcher.
;   $7E:0218 = current world; $7E:021A = current level / tile.
;   $7E:1108..$7E:1122 = world-map state block (level-cursor X/Y, target Y,
;     animation counters, transition state index `$7E:1118`).
;   Save data at $70:7C02+ (per-tile availability bits).
; OUTPUTS:
;   Per-frame: tilemap update queue + sprite OAM updated. State machine at
;     `$7E:1118` dispatched via `JSR (DATA_world_map_state_ptr-2,x)` -- transitions include
;     world-fold-down/up, score panels, score-button growth.
;   On level select (CODE_level_select): writes !RAM_YI_Level_CurrentLevelFromMapLo
;     (`$7E:021A`) and advances !RAM_YI_Global_CurrentGameMode (`$7E:0118`)
;     to $1E (start+select fade) or $1F (fade out to level).
;   With !Define_YI_Global_EnableDebugFeatures==TRUE: the level-select-bypass
;     `NOP #3` path is taken instead, jumping straight to CODE_level_select.
; MODIFIES: A, X, Y, DBR, DP $00..$10.
; CALLERS:
;   Bank00 `DATA_game_mode_pointers[$22]` -- per-frame tick (every overworld frame).
;-------------------------------------------------------------------------
CODE_17B3CD:
CODE_gm22_overworld:						; Raiden alias
	JSL.l CODE_init_oam_buffer
	JSL.l CODE_gm22_inner_dispatcher
if !Define_YI_Global_EnableDebugFeatures == !TRUE
	NOP #3
else
	JMP.w CODE_17B430
endif

ADDR_17B3D8:
	LDA.w !RAM_YI_Global_CurrentSaveFile
	CMP.b #$04
	BNE.b ADDR_17B424
	LDA.w $0943
	AND.b #$20
	BEQ.b ADDR_17B3F8
	LDA.b #$FF
	STA.w $011A
	INC.w !RAM_YI_Level_CurrentWorldLo
	INC.w !RAM_YI_Level_CurrentWorldLo
	LDA.b #!Define_YI_GameMode08
	STA.w !RAM_YI_Global_CurrentGameMode
	BRA.b CODE_17B430

ADDR_17B3F8:
	LDA.w $0942
	CMP.b #$80
	BNE.b ADDR_17B424
	LDA.b #!Define_YI_GameMode1F
	STA.w !RAM_YI_Global_CurrentGameMode
	LDA.b #$E4
	STA.w $0220
	REP.b #$20
	LDA.w #$6464
	STA.w !RAM_YI_Map_LevelHighScores
	STA.w $02BA
	STA.w $02BC
	STA.w $02BE
	LDA.w #$F0F0
	STA.w $0317
	SEP.b #$20
	BRA.b CODE_17B430

ADDR_17B424:
	LDA.w $0942
	AND.b #$30
	BEQ.b CODE_17B430
	LDA.b #!Define_YI_GameMode16
	STA.w !RAM_YI_Global_CurrentGameMode
CODE_17B430:
	LDX.b #$00
	LDA.w $1118
	BNE.b CODE_17B44F
	LDA.b $38
	ORA.b $36
	AND.b #$0F
	BEQ.b CODE_17B44F
	LDA.w $1112
	CMP.b #$08
	BCS.b CODE_17B44F
	STA.w !RAM_YI_Map_RunningYoshiIndex
	JSL.l CODE_17C72B
	INX
	INX
CODE_17B44F:
	LDA.b $35
	AND.b #$30
	BEQ.b CODE_17B459
	LDX.b #$04
	BRA.b CODE_17B45F

CODE_17B459:
	LDA.b $93
	BEQ.b CODE_17B45F
	LDX.b #$06
CODE_17B45F:
	JSR.w (DATA_17B3C5,x)
	LDA.w $098E
	BEQ.b CODE_17B4BA
	DEC.w $0200
	BNE.b CODE_17B4BA
	LDA.w $0201
	EOR.b #$01
	STA.w $0201
	STZ.w $0200
	STZ.w !RAM_YI_Global_ColorMathInitialSettings
	LDA.b #$58
	STA.w $0392
	STZ.w !RAM_YI_Level_FlowersCollectedLo
	STZ.w $03B9
	REP.b #$20
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	CMP.w $112B
	BEQ.b CODE_17B495
	STZ.w !RAM_YI_Level_DeathsInCurrentLevelLo
	STZ.w !RAM_YI_Level_1upsCollectedInCurrentLevelLo
CODE_17B495:
	SEP.b #$20
	TAY
	LDA.w !RAM_YI_Map_LevelHighScores,y
	STA.w $0381
	LDY.b #!Define_YI_GameMode0C
	STY.w !RAM_YI_Global_CurrentGameMode
	LDA.w !RAM_YI_Level_CurrentWorldLo
	LSR
	TAX
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	CMP.w DATA_17B4BD,x
	BNE.b CODE_17B4BA
	LDA.b #!Define_YI_GameMode2A
	STA.w !RAM_YI_Global_CurrentGameMode
	TXA
	ASL
	STA.w !RAM_YI_Level_CurrentBonusGame
CODE_17B4BA:
	JMP.w CODE_17B38A

DATA_17B4BD:
	db !Define_YI_LevelID_FlipCards
	db !Define_YI_LevelID_ScratchAndMatch
	db !Define_YI_LevelID_DrawingLots
	db !Define_YI_LevelID_MatchCards
	db !Define_YI_LevelID_Roulette
	db !Define_YI_LevelID_SlotMachine
	db $51
	db $5D
	db $69

DATA_17B4C6:
	dw CODE_17B509
	dw CODE_17B519
	dw CODE_17B519
	dw CODE_17B519
	dw CODE_17B538
	dw CODE_17B54C
	dw CODE_17B56B
	dw CODE_17B594
	dw CODE_17B54C
	dw CODE_17B56B
	dw CODE_17B594
	dw CODE_17B56B
	dw CODE_17B5B9
	dw CODE_17B5FC
	dw CODE_17B616
	dw CODE_17B528

CODE_17B4E6:
	LDA.w $1127
	BEQ.b CODE_17B505
	ASL
	TAX
	JSR.w (DATA_17B4C6-$02,x)
	LDA.w $1127
	CMP.b #$06
	BCC.b CODE_17B505
	LDA.w $1121
	PHA
	STZ.w $1121
	JSR.w CODE_17B687
	PLA
	STA.w $1121
CODE_17B505:
	STZ.w $1118
	RTS

CODE_17B509:
	DEX
	DEX
	JSL.l CODE_17D87D
	LDA.w $1123
	STA.w $111F
	INC.w $1127
	RTS

CODE_17B519:
	DEX
	DEX
	JSL.l CODE_17D87D
	LDA.w $1118
	BEQ.b CODE_17B527
	INC.w $1127
CODE_17B527:
	RTS

CODE_17B528:
	LDA.b #$80
	STA.b !RAM_YI_Global_Layer2YPosLo
	STZ.b !RAM_YI_Global_Layer2XPosLo
	LDA.b #$32
	STA.l $7E5C19
	INC.w $1127
	RTS

CODE_17B538:
	INC.w $1127
	REP.b #$20
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	LDA.w #$0020
else
	LDA.w #$0010
endif
	STA.w $1110
	JSR.w CODE_17B620
	SEP.b #$20
	STZ.w $1130
	RTS

CODE_17B54C:
	LDA.b #!Define_YI_SoundID15_Growth
	JSL.l CODE_push_sound_queue
	INC.w $1127
	BRA.b CODE_17B56B

DATA_17B557:
	dw $0008,$0006,$0006,$0004,$0004

DATA_17B561:
	dw $00F0,$00C0,$0150,$00F0,$0100

CODE_17B56B:
	LDX.w $1130
	REP.b #$20
	LDA.w $1110
	CLC
	ADC.w DATA_17B557,x
	STA.w $1110
	CMP.w DATA_17B561,x
	BCC.b CODE_17B58E
	LDA.w DATA_17B561,x
	STA.w $1110
	INC.w $1127
	INC.w $1130
	INC.w $1130
CODE_17B58E:
	JSR.w CODE_17B620
	SEP.b #$20
	RTS

CODE_17B594:
	LDX.w $1130
	REP.b #$20
	LDA.w $1110
	SEC
	SBC.w DATA_17B557,x
	STA.w $1110
	CMP.w DATA_17B561,x
	BCS.b CODE_17B5B3
	INC.w $1127
	INC.w $1130
	INC.w $1130
	BRA.b CODE_17B5B6

CODE_17B5B3:
	JSR.w CODE_17B620
CODE_17B5B6:
	SEP.b #$20
	RTS

CODE_17B5B9:
	REP.b #$20
	LDA.w #$0100
	STA.w $1110
	JSR.w CODE_17B620
	SEP.b #$20
	JSR.w CODE_17B645
	LDA.w !RAM_YI_Level_CurrentWorldLo
	LSR
	TAX
	LDY.w !RAM_YI_Level_CurrentLevelFromMapLo
	LDA.b #$80
	STA.w !RAM_YI_Map_LevelClearFlags,y
	PHY
	TYA
	INC
	SEC
	SBC.w DATA_map_world_tile_base_b,x
	STA.w $030F,y
	PLA
	SEC
	SBC.w DATA_map_world_tile_base_b,x
	STA.w $1112
	ASL
	TAX
	LSR
	STA.w $1123
	REP.b #$20
	LDA.w DATA_17E257,x
	STA.w $1109
	SEP.b #$20
	INC.w $1127
	RTS

CODE_17B5FC:
	INC.w $1127
	STZ.w $1128
	STZ.w $1128
	STZ.w $1127
	REP.b #$20
	STZ.w $0990
	STZ.w $0992
	STZ.w $0994
	SEP.b #$20
	RTS

CODE_17B616:
	STZ.w $1110
	STZ.w $1111
	STZ.w $1127
	RTS

CODE_17B620:
	LDX.w !RAM_YI_Level_CurrentLevelFromMapLo
CODE_17B623:
	LDA.l DATA_17DBAF,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	TXA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $1110
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_08DBDE>>16
	LDA.w #FXCODE_08DBDE
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_17D0C9
	RTS

CODE_17B645:
	REP.b #$20
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	ASL
	TAX
	LDY.w !RAM_YI_Level_CurrentWorldLo
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	SEC
	SBC.w DATA_map_world_tile_base_w,y
	STA.b $10
	ASL
	TAY
	LDA.w #$1400
	ORA.w DATA_17DC27,y
	STA.b $00
CODE_17B662:
	LDA.w DATA_17DCEF,y
	LDY.w $1106
	BNE.b CODE_17B66E
	CLC
	ADC.w #$0380
CODE_17B66E:
	STA.b $0A
	CLC
	ADC.w #$0040
	STA.b $0C
	CLC
	ADC.w #$0040
	STA.b $0E
	JSL.l CODE_17DC23
	JSL.l CODE_17E642
	SEP.b #$20
	RTS

CODE_17B687:
	LDA.w !RAM_YI_Level_CurrentWorldLo
	LSR
	TAY
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	SEC
	SBC.w DATA_map_world_tile_base_b,y
CODE_17B693:
	ASL
	TAX
	LDA.w DATA_17E257,x
	STA.b $00
	STZ.b $01
	LDA.w DATA_17E257+$01,x
	STA.b $02
	STZ.b $03
	REP.b #$30
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.l DATA_map_world_tile_base_w,x
	CLC
	ADC.w #$0008
	STA.b $10
	LDX.w $6092
	LDA.b $00
	SEC
	SBC.w #$0010
	STA.w $6000,x
	STA.w $6010,x
	CLC
	ADC.w #$0010
	STA.w $6008,x
	STA.w $6018,x
	LDA.b $02
	SEC
	SBC.w #$0016
	STA.w $6002,x
	STA.w $600A,x
	CLC
	ADC.w #$0010
	STA.w $6012,x
	STA.w $601A,x
	LDA.w $1121
	BEQ.b CODE_17B706
	STZ.b $00
	LDY.w !RAM_YI_Level_CurrentLevelFromMapLo
	LDA.w !RAM_YI_Map_LevelHighScores,y
	AND.w #$00FF
	CMP.w #$001E
	BCS.b CODE_17B702
	CPY.b $10
	BNE.b CODE_17B6FD
	TAY
	BEQ.b CODE_17B702
CODE_17B6FD:
	LDA.w #$0200
	STA.b $00
CODE_17B702:
	LDA.b $00
	BRA.b CODE_17B720

CODE_17B706:
	LDA.w $1148
	BEQ.b CODE_17B71D
	LDY.w !RAM_YI_Level_CurrentWorldLo
	LDA.w $114C
	ASL
	TAY
	LDA.w DATA_17DC4F,y
	LSR
	SEC
	SBC.w #$0600
	BRA.b CODE_17B720

CODE_17B71D:
	LDA.w #$0400
CODE_17B720:
	ORA.w #$31CC
	PHA
	STA.w $6004,x
	INC
	INC
	STA.w $600C,x
	PLA
	CLC
	ADC.w #$0020
	STA.w $6014,x
	INC
	INC
	STA.w $601C,x
	LDA.w #$4002
	STA.w $6006,x
	STA.w $600E,x
	STA.w $6016,x
	STA.w $601E,x
	TXA
	CLC
	ADC.w #$0020
	STA.w $6092
	SEP.b #$30
	RTS

CODE_17B753:
	LDA.w $1131
	BEQ.b CODE_17B76F
	ASL
	CLC
	ADC.b #$06
	TAX
	CMP.b #$10
	BCS.b CODE_17B76F
	JSL.l CODE_17D87D
	LDA.w $1118
	BEQ.b CODE_17B77D
	INC.w $1131
	BRA.b CODE_17B77D

CODE_17B76F:
	LDA.b #!Define_YI_GameMode22
	STA.w !RAM_YI_Global_CurrentGameMode
	STZ.w $1131
	LDA.b #$32
	STA.l $7E5C19
CODE_17B77D:
	STZ.w $1118
	RTS

;@editable:world-map-yoshi-walk-paths begin
; DATA_worldmap_yoshi_walk_xcoords -- SMWC: World-map Yoshi-walk path checkpoint X-coords
; (4 words per level, 48 levels indexed world*8+level; $0000 = stop). Yoshi
; walks to each in order after completing a level.
DATA_17B781:
DATA_worldmap_yoshi_walk_xcoords:
	dw $0038,$0000,$0000,$0000,$0070,$0076,$0000,$0000
	dw $00A6,$0000,$0000,$0000,$00E0,$00EE,$0000,$0000
	dw $0100,$0106,$0000,$0000,$0146,$0000,$0000,$0000
	dw $0180,$0190,$0198,$0000,$0000,$0000,$0000,$0000
	dw $003C,$0000,$0000,$0000,$0076,$0000,$0000,$0000
	dw $00A8,$00AE,$0000,$0000,$00E0,$00EE,$0000,$0000
	dw $012E,$0000,$0000,$0000,$0166,$0000,$0000,$0000
	dw $019E,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0038,$004E,$0000,$0000,$0078,$007E,$0000,$0000
	dw $00A4,$00A6,$0000,$0000,$00E8,$00F6,$0000,$0000
	dw $0128,$0136,$0000,$0000,$0176,$0000,$0000,$0000
	dw $01A8,$01AE,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0050,$0000,$0000,$0000,$007E,$0000,$0000,$0000
	dw $00A6,$0000,$0000,$0000,$00F6,$0000,$0000,$0000
	dw $0130,$0136,$0000,$0000,$0170,$0000,$0000,$0000
	dw $01A8,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $003E,$0000,$0000,$0000,$0070,$007E,$0000,$0000
	dw $00AE,$0000,$0000,$0000,$00F6,$0000,$0000,$0000
	dw $0128,$0136,$0000,$0000,$016E,$0000,$0000,$0000
	dw $01A6,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0040,$0046,$0000,$0000,$0076,$0000,$0000,$0000
	dw $00A6,$0000,$0000,$0000,$00F6,$0000,$0000,$0000
	dw $0128,$012E,$0000,$0000,$015E,$0000,$0000,$0000
	dw $0196,$0196,$0000,$0000,$0000,$0000,$0000,$0000

; DATA_worldmap_yoshi_walk_ycoords -- SMWC: World-map Yoshi-walk path checkpoint Y-coords
; (4 words per level, 48 levels). Pairs with DATA_worldmap_yoshi_walk_xcoords
; at DATA_worldmap_yoshi_walk_xcoords.
DATA_17B901:
DATA_worldmap_yoshi_walk_ycoords:
	dw $0078,$0000,$0000,$0000,$00A0,$00A0,$0000,$0000
	dw $00A4,$0000,$0000,$0000,$00A4,$0090,$0000,$0000
	dw $0084,$0070,$0000,$0000,$0088,$0000,$0000,$0000
	dw $0088,$0088,$008C,$0000,$0000,$0000,$0000,$0000
	dw $0090,$0000,$0000,$0000,$0098,$0000,$0000,$0000
	dw $009C,$008C,$0000,$0000,$008C,$0098,$0000,$0000
	dw $0098,$0000,$0000,$0000,$0088,$0000,$0000,$0000
	dw $0084,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $00A0,$0090,$0000,$0000,$0094,$0080,$0000,$0000
	dw $0098,$00A0,$0000,$0000,$00AE,$00A0,$0000,$0000
	dw $0098,$0080,$0000,$0000,$00A4,$0000,$0000,$0000
	dw $00A0,$008E,$0000,$0000,$0000,$0000,$0000,$0000
	dw $00A0,$0000,$0000,$0000,$0088,$0000,$0000,$0000
	dw $00AE,$0000,$0000,$0000,$00A0,$0000,$0000,$0000
	dw $009E,$00A2,$0000,$0000,$0098,$0000,$0000,$0000
	dw $008A,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0078,$0000,$0000,$0000,$0090,$0088,$0000,$0000
	dw $007C,$0000,$0000,$0000,$0070,$0000,$0000,$0000
	dw $0088,$0088,$0000,$0000,$0080,$0000,$0000,$0000
	dw $0078,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $00A4,$00A0,$0000,$0000,$0090,$0000,$0000,$0000
	dw $0090,$0000,$0000,$0000,$0098,$0000,$0000,$0000
	dw $0094,$0098,$0000,$0000,$0088,$0000,$0000,$0000
	dw $009C,$00A4,$0000,$0000,$0000,$0000,$0000,$0000
;@editable:world-map-yoshi-walk-paths end

DATA_17BA81:
	dw $0080,$0080,$0080,$0000,$0080,$0080,$0080,$0080
	dw $0080,$0080,$0080,$0000,$0080,$0080,$0000,$0000
	dw $0080,$0080,$0080,$0000,$0080,$8080,$0080,$0080
	dw $8080,$0080,$0080,$0080,$0000,$0000,$0000,$0000
	dw $0080,$0080,$0080,$0000,$0080,$0080,$0080,$0080
	dw $0080,$0080,$0080,$0000,$0080,$0080,$0000,$0000
	dw $0080,$0080,$0080,$0000,$0080,$8080,$0080,$0080
	dw $8080,$0080,$0080,$0080,$0000,$0000,$0000,$0000
	dw $0080,$0080,$0080,$0000,$0080,$0080,$0080,$0080
	dw $0080,$0080,$0080,$0000,$0080,$0080,$0000,$0000
	dw $0080,$0080,$0080,$0000,$0080,$8080,$0080,$0080
	dw $8080,$0080,$0080,$0080,$0000,$0000,$0000,$0000
	dw $0080,$0080,$0080,$0000,$0080,$0080,$0080,$0080
	dw $0080,$0080,$0080,$0000,$0080,$0080,$0000,$0000
	dw $0080,$0080,$0080,$0000,$0080,$8080,$0080,$0080
	dw $8080,$0080,$0080,$0080,$0000,$0000,$0000,$0000
	dw $0080,$0080,$0080,$0000,$0080,$0080,$0080,$0080
	dw $0080,$0080,$0080,$0000,$0080,$0080,$0000,$0000
	dw $0080,$0080,$0080,$0000,$0080,$8080,$0080,$0080
	dw $8080,$0080,$0080,$0080,$0000,$0000,$0000,$0000
	dw $0080,$0080,$0080,$0000,$0080,$0080,$0080,$0080
	dw $0080,$0080,$0080,$0000,$0080,$0080,$0000,$0000
	dw $0080,$0080,$0080,$0000,$0080,$8080,$0080,$0080
	dw $8080,$0080,$0080,$0080,$0000,$0000,$0000,$0000

CODE_17BC01:
	LDA.b $95
	ASL
	TAX
	JMP.w (DATA_17BC10,x)

CODE_17BC08:
	INC.w $1131
	INC.b $89
	INC.b $89
	RTS

DATA_17BC10:
	dw CODE_17BC18
	dw CODE_17BD13
	dw CODE_17BD42
	dw CODE_17BD9A

CODE_17BC18:
	LDY.b $91
	LDA.w DATA_worldmap_yoshi_walk_xcoords,y
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w DATA_worldmap_yoshi_walk_ycoords,y
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $76
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.b $72
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w DATA_17BA81,y
	AND.w #$7FFF
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	PHY
	SEP.b #$10
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	PLY
	LDX.w #$0000
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BPL.b CODE_17BC51
	DEX
CODE_17BC51:
	CLC
	ADC.w $0075
	STA.b $00
	TXA
	ADC.w $0077
	STA.b $02
	LDX.w #$0000
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	BPL.b CODE_17BC66
	DEX
CODE_17BC66:
	CLC
	ADC.w $0071
	STA.b $04
	TXA
	ADC.w $0073
	STA.b $06
	LDX.w #$0000
	LDA.b $01
	SEC
	SBC.w DATA_worldmap_yoshi_walk_xcoords,y
	BCC.b CODE_17BC95
	EOR.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_17BC95
	LDA.w DATA_worldmap_yoshi_walk_xcoords,y
	XBA
	STA.b $08
	AND.w #$FF00
	STA.b $00
	LDA.b $08
	AND.w #$00FF
	STA.b $02
	INX
CODE_17BC95:
	LDA.b $00
	STA.w $0075
	LDA.b $02
	STA.w $0077
	LDA.b $05
	SEC
	SBC.w DATA_worldmap_yoshi_walk_ycoords,y
	BCC.b CODE_17BCBF
	EOR.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	BMI.b CODE_17BCBF
	LDA.w DATA_worldmap_yoshi_walk_ycoords,y
	XBA
	STA.b $08
	AND.w #$FF00
	STA.b $04
	LDA.b $08
	AND.w #$00FF
	STA.b $06
	INX
CODE_17BCBF:
	LDA.b $04
	STA.w $0071
	LDA.b $06
	STA.w $0073
	CPX.w #$0002
	BNE.b CODE_17BCEF
	INY
	INY
	STY.b $91
	TYA
	AND.w #$0007
	BEQ.b CODE_17BCE0
	LDA.w DATA_worldmap_yoshi_walk_xcoords,y
	ORA.w DATA_worldmap_yoshi_walk_ycoords,y
	BNE.b CODE_17BCEF
CODE_17BCE0:
	LDA.w #$0001
	STA.b $95
	LDA.w #$0002
	STA.b $97
	LDA.w #$0008
	STA.b $99
CODE_17BCEF:
	LDA.b $76
CODE_17BCF1:
	LDX.w #$0000
	SEC
	SBC.w #$0074
	BMI.b CODE_17BD03
	TAX
	CMP.w #$0100
	BCC.b CODE_17BD03
	LDX.w #$0100
CODE_17BD03:
	TXA
	STA.b $69
	STA.b $6D
	STA.b $79
	STA.b !RAM_YI_Global_Layer3XPosLo
	RTS

DATA_17BD0D:
	dw $0008,$0008,$0000

CODE_17BD13:
	DEC.b $99
	BNE.b CODE_17BD41
	INC.b $9B
	LDA.b $9B
	ASL
	TAY
	LDA.w DATA_17BD0D,y
	STA.b $99
	BNE.b CODE_17BD41
	LDA.b $72
	STA.b $A3
	LDA.b $76
	STA.b $AB
	STZ.b $9D
	LDA.w #$FFFC
	STA.b $9F
	LDA.w #$E000
	STA.b $A5
	STZ.b $A7
	INC.b $95
	LDA.w #$0003
	STA.b $97
CODE_17BD41:
	RTS

CODE_17BD42:
	LDA.b $A5
	CLC
	ADC.b $A9
	STA.b $A9
	LDA.b $AB
	ADC.b $A7
	STA.b $AB
	LDA.b $9D
	CLC
	ADC.w #$4000
	STA.b $9D
	LDA.b $9F
	ADC.w #$0000
	STA.b $9F
	LDA.b $9D
	CLC
	ADC.b $A1
	STA.b $A1
	LDA.b $A3
	ADC.b $9F
	STA.b $A3
	LDA.b $A3
	CMP.b $AD
	BCC.b CODE_17BD95
	LDY.b $72
	LDX.b $76
	LDA.b $AD
	STA.b $72
	LDA.b $AF
	STA.b $76
	STY.b $AD
	STX.b $AF
	LDA.w #$0004
	STA.b $97
	STZ.b $9B
	LDA.w #$0010
	STA.b $99
	INC.b $95
	JSR.w CODE_17B39E
	JMP.w CODE_17BCEF

CODE_17BD95:
	LDA.b $AB
	JMP.w CODE_17BCF1

CODE_17BD9A:
	DEC.b $99
	BNE.b CODE_17BDAD
	STZ.b $9B
	LDA.w #$0005
	STA.b $97
	LDA.w #$0008
	STA.b $99
	JMP.w CODE_17BC08

CODE_17BDAD:
	RTS

;@editable:world-map-yoshi-dots begin
; DATA_worldmap_yoshi_xcoords_by_world -- SMWC: World-map per-Yoshi X-coords, 6 worlds * 8 Yoshis
; per world (16 bytes per world, so SMWC splits as $17BDAE/BDBE/BDCE/
; BDDE/BDEE/BDFE for worlds 1..6).
DATA_17BDAE:
DATA_worldmap_yoshi_xcoords_by_world:
	dw $0030,$0058,$0098,$00C8,$0110,$0128,$0168,$01B8
	dw $0030,$0060,$0098,$00D0,$0110,$0150,$0188,$01C0
	dw $0030,$0070,$00A0,$00C8,$0118,$0158,$0198,$01D0
	dw $0030,$0070,$00A0,$00C8,$0118,$0158,$0190,$01C8
	dw $0030,$0060,$00A0,$00D0,$0118,$0158,$0190,$01C8
	dw $0030,$0068,$0098,$00C8,$0118,$0150,$0180,$01B8

; DATA_worldmap_yoshi_ycoords_by_world -- SMWC: World-map per-Yoshi Y-coords (companion to
; DATA_worldmap_yoshi_xcoords_by_world). 6 worlds * 8 Yoshis.
DATA_17BE0E:
DATA_worldmap_yoshi_ycoords_by_world:
	dw $009C,$007C,$00A4,$00A8,$0094,$0074,$008C,$0090
	dw $00A4,$0094,$009C,$0090,$009C,$009C,$008C,$008C
	dw $00AC,$0094,$0084,$00A4,$00A4,$0084,$00AC,$0090
	dw $009C,$00A4,$008C,$00B0,$00A4,$00A4,$009C,$008C
	dw $00AC,$007C,$008C,$0080,$0074,$008C,$0084,$007C
	dw $00AC,$00A4,$0094,$0094,$009C,$009C,$008C,$00A8
;@editable:world-map-yoshi-dots end

DATA_17BE6E:
	dw $0001,$0001,$0001,$0001,$0001,$0001,$0000,$0001
	dw $0001,$0001,$0001,$0001,$0001,$0001,$0000,$0001
	dw $0001,$0001,$0001,$0001,$0001,$0001,$0000,$0001
	dw $0001,$0001,$0001,$0001,$0001,$0001,$0000,$0001
	dw $0001,$0001,$0001,$0001,$0001,$0001,$0000,$0001
	dw $0001,$0001,$0001,$0001,$0001,$0001,$0000,$0001

DATA_17BECE:
	dw $0002,$FFFE

DATA_17BED2:
	dw $3D60,$3F66,$3960,$3F60,$3966,$3D66,$3B66,$3B60

DATA_17BEE2:
	dw $3D60,$3F66,$3960,$3F60,$3966,$3D66,$3B66,$3D60

DATA_17BEF2:
	dw $0000,$0004,$0002,$0004

DATA_17BEFA:
	dw $390F,$391F,$392F,$393F,$393B,$393C,$393D,$393E

DATA_17BF0A:
	dw $0000,$0001,$0002,$0001

DATA_17BF12:
	dw $2900,$2903,$2906,$2903

DATA_17BF1A:
	dw $2D4A,$2D4C,$2D4A,$2D4C

CODE_17BF22:
	REP.b #$30
	LDA.w $1125
	ASL
	ASL
	ORA.w $112E
	ASL
	STA.b $89
	TAY
	LDX.w #$0000
	LDA.w DATA_worldmap_yoshi_ycoords_by_world,y
	SEC
	SBC.w #$0004
	STA.b $72
	LDA.w DATA_worldmap_yoshi_xcoords_by_world,y
	SEC
	SBC.w #$0008
	STA.b $76
	SEC
	SBC.w #$0074
	BMI.b CODE_17BF54
	TAX
	CMP.w #$0100
	BCC.b CODE_17BF54
	LDX.w #$0100
CODE_17BF54:
	STX.b $79
	LDA.w #$0000
	CPX.b $6D
	BCS.b CODE_17BF5F
	INC
	INC
CODE_17BF5F:
	STA.b $7B
	STZ.b $97
CODE_17BF63:
	REP.b #$30
	LDA.b $6D
	CMP.b $79
	BEQ.b CODE_17BF7C
	LDX.b $7B
	LDA.b $6D
	CLC
	ADC.w DATA_17BECE,x
	AND.w #$FFFE
	STA.b $69
	STA.b $6D
	STA.b !RAM_YI_Global_Layer3XPosLo
CODE_17BF7C:
	JSL.l CODE_17E309
	LDA.b $97
	ASL
	TAX
	JMP.w (DATA_17BF87,x)

DATA_17BF87:
	dw CODE_17BF93
	dw CODE_17C0E7
	dw CODE_17C27C
	dw CODE_17C339
	dw CODE_17C3EB
	dw CODE_17C475

CODE_17BF93:
	DEC.b $7D
	BNE.b CODE_17BFA4
	LDA.w #$0009
	STA.b $7D
	LDA.b $81
	INC
	AND.w #$0003
	STA.b $81
CODE_17BFA4:
	LDX.w $6092
	LDA.b $76
	SEC
	SBC.b $6D
	STA.w $6000,x
	STA.w $6010,x
	CLC
	ADC.w #$0008
	STA.w $6008,x
	CLC
	ADC.w #$0008
	STA.w $6020,x
	CLC
	ADC.w #$0004
	STA.w $6018,x
	LDA.b $72
	SEC
	SBC.b $6F
	STA.w $600A,x
	CLC
	ADC.w #$0001
	STA.w $6002,x
	CLC
	ADC.w #$0003
	CLC
	ADC.w #$0002
	STA.w $6022,x
	CLC
	ADC.w #$0002
	STA.w $6012,x
	CLC
	ADC.w #$0001
	STA.w $601A,x
	LDA.b $81
	ASL
	TAY
	LDA.w DATA_17BF12,y
	STA.b $02
	INC
	STA.w $600C,x
	LDA.b $02
	ORA.w #$0010
	STA.w $6014,x
	LDA.w DATA_17BF1A,y
	STA.w $6004,x
	LDA.w !RAM_YI_Map_RunningYoshiIndex
	ASL
	TAY
	LDA.w DATA_17BEFA,y
	STA.w $601C,x
	LDA.w #$3D6E
	STA.w $6024,x
	LDA.w #$0400
	STA.w $601E,x
	INC
	INC
	STA.w $6006,x
	STA.w $600E,x
	STA.w $6016,x
	STA.w $6026,x
	LDA.b $30
	AND.w #$0018
	LSR
	LSR
	TAY
	LDA.w DATA_17BEF2,y
	STA.b $04
	LDA.w DATA_17BF0A,y
	STA.b $06
	TXA
	CLC
	ADC.w #$0028
	TAX
	LDA.w $1125
	ASL
	ASL
	ASL
	TAY
	STA.b $0E
	STZ.b $02
CODE_17C052:
	LDA.b $02
	CMP.w !RAM_YI_Map_RunningYoshiIndex
	BNE.b CODE_17C05C
	JMP.w CODE_17C0CF

CODE_17C05C:
	LDA.w DATA_worldmap_yoshi_xcoords_by_world,y
	SEC
	SBC.b $6D
	SEC
	SBC.w #$0008
	STA.w $6000,x
	CLC
	ADC.w #$0005
	STA.w $6010,x
	CLC
	ADC.w #$0004
	STA.w $6008,x
	LDA.w DATA_worldmap_yoshi_ycoords_by_world,y
	SEC
	SBC.b $6F
	CLC
	ADC.w #$0004
	STA.w $6002,x
	SEC
	SBC.b $06
	SEC
	SBC.w #$000D
	STA.w $6012,x
	CLC
	ADC.w #$0003
	STA.w $600A,x
	LDA.b $02
	ASL
	TAY
	LDA.w DATA_17BEFA,y
	STA.w $600C,x
	LDA.w #$3B6E
	STA.w $6014,x
	LDA.w !RAM_YI_Level_CurrentWorldLo
	CMP.w #!Define_YI_WorldID_World6
	BNE.b CODE_17C0B2
	LDA.w DATA_17BEE2,y
	BRA.b CODE_17C0B5

CODE_17C0B2:
	LDA.w DATA_17BED2,y
CODE_17C0B5:
	CLC
	ADC.b $04
	STA.w $6004,x
	LDA.w #$0000
	STA.w $600E,x
	INC
	INC
	STA.w $6006,x
	STA.w $6016,x
	TXA
	CLC
	ADC.w #$0018
	TAX
CODE_17C0CF:
	LDY.b $0E
	INY
	INY
	STY.b $0E
	INC.b $02
	LDA.b $02
	CMP.w #$0008
	BEQ.b CODE_17C0E1
	JMP.w CODE_17C052

CODE_17C0E1:
	STX.w $6092
	SEP.b #$30
	RTS

CODE_17C0E7:
	DEC.b $7D
	BNE.b CODE_17C0F8
	LDA.w #$0009
	STA.b $7D
	LDA.b $81
	INC
	AND.w #$0003
	STA.b $81
CODE_17C0F8:
	LDX.w $6092
	LDA.b $76
	SEC
	SBC.b $6D
	STA.w $6000,x
	STA.w $6010,x
	CLC
	ADC.w #$0008
	STA.w $6008,x
	LDA.b $72
	SEC
	SBC.b $6F
	STA.w $600A,x
	CLC
	ADC.w #$0001
	STA.w $6002,x
	CLC
	ADC.w #$0007
	STA.w $6012,x
	LDA.b $81
	ASL
	TAY
	LDA.w DATA_17BF12,y
	STA.b $02
	INC
	STA.w $600C,x
	LDA.b $02
	ORA.w #$0010
	STA.w $6014,x
	LDA.w DATA_17BF1A,y
	STA.w $6004,x
	LDA.w #$0402
	STA.w $6006,x
	STA.w $600E,x
	STA.w $6016,x
	LDA.b $AF
	SEC
	SBC.b $6D
	STA.w $6018,x
	CLC
	ADC.w #$0008
	STA.w $6020,x
	LDA.b $AD
	SEC
	SBC.b $6F
	STA.w $601A,x
	CLC
	ADC.w #$0008
	STA.w $6022,x
	LDA.w #$6B01
	STA.w $601C,x
	LDA.w #$6B10
	STA.w $6024,x
	LDA.w #$0402
	STA.w $601E,x
	STA.w $6026,x
	TXA
	CLC
	ADC.w #$0028
	TAX
CODE_17C183:
	LDA.b $30
	AND.w #$0018
	LSR
	LSR
	TAY
	LDA.w DATA_17BEF2,y
	STA.b $04
	LDA.w DATA_17BF0A,y
	STA.b $06
	LDA.w $1125
	ASL
	ASL
	ASL
	TAY
	STY.b $0E
	STZ.b $02
CODE_17C1A0:
	LDA.w DATA_worldmap_yoshi_xcoords_by_world,y
	SEC
	SBC.b $6D
	STA.b $08
	LDA.w DATA_worldmap_yoshi_ycoords_by_world,y
	SEC
	SBC.b $6F
	STA.b $0A
	LDA.b $B1
	CMP.b $02
	BEQ.b CODE_17C1BB
	INC
	CMP.b $02
	BNE.b CODE_17C1FD
CODE_17C1BB:
	ASL
	TAY
	LDA.w DATA_17BEFA,y
	STA.w $6004,x
	LDA.w #$3B6E
	STA.w $600C,x
	LDA.b $08
	CLC
	ADC.w #$0008
	STA.w $6008,x
	CLC
	ADC.w #$0004
	STA.w $6000,x
	LDA.b $0A
	CLC
	ADC.w #$0002
	STA.w $600A,x
	CLC
	ADC.w #$0003
	STA.w $6002,x
	LDA.w #$0000
	STA.w $6006,x
	INC
	INC
	STA.w $600E,x
	TXA
	CLC
	ADC.w #$0010
	TAX
	JMP.w CODE_17C25B

CODE_17C1FD:
	LDA.b $08
	SEC
	SBC.w #$0008
	STA.w $6000,x
	CLC
	ADC.w #$0005
	STA.w $6010,x
	CLC
	ADC.w #$0004
	STA.w $6008,x
	LDA.b $0A
	CLC
	ADC.w #$0004
	STA.w $6002,x
	SEC
	SBC.b $06
	SEC
	SBC.w #$000E
	STA.w $6012,x
	CLC
	ADC.w #$0003
	STA.w $600A,x
	LDA.b $02
	ASL
	TAY
	LDA.w DATA_17BEFA,y
	STA.w $600C,x
	LDA.w #$3B6E
	STA.w $6014,x
	LDA.w DATA_17BED2,y
	CLC
	ADC.b $04
	STA.w $6004,x
	LDA.w #$0000
	STA.w $600E,x
	INC
	INC
	STA.w $6006,x
	STA.w $6016,x
	TXA
	CLC
	ADC.w #$0018
	TAX
CODE_17C25B:
	LDY.b $0E
	INY
	INY
	STY.b $0E
	INC.b $02
	LDA.b $02
	CMP.w #$0008
	BEQ.b CODE_17C26D
	JMP.w CODE_17C1A0

CODE_17C26D:
	JMP.w CODE_17C0E1

DATA_17C270:
	dw $2930,$2930

DATA_17C274:
	dw $2D4A,$2D4C

DATA_17C278:
	dw $0004,$0008

CODE_17C27C:
	LDX.w $6092
	LDA.b $9B
	ASL
	TAY
	LDA.b $76
	SEC
	SBC.b $6D
	STA.w $6008,x
	STA.w $6018,x
	CLC
	ADC.w #$0002
	STA.w $6000,x
	CLC
	ADC.w #$0006
	STA.w $6010,x
	STA.w $6020,x
	LDA.b $72
	SEC
	SBC.b $6F
	STA.b $00
	STA.w $600A,x
	STA.w $6012,x
	CLC
	ADC.w #$0008
	STA.w $601A,x
	STA.w $6022,x
	LDA.b $00
	CLC
	ADC.w DATA_17C278,y
	STA.w $6002,x
	LDA.w DATA_17C274,y
	STA.w $6004,x
	LDA.w DATA_17C270,y
	STA.b $00
	STA.w $600C,x
	INC
	STA.w $6014,x
	LDA.b $00
	CLC
	ADC.w #$0010
	STA.w $601C,x
	INC
	STA.w $6024,x
	LDA.b $AF
	SEC
	SBC.b $6D
	STA.w $6028,x
	CLC
	ADC.w #$0008
	STA.w $6030,x
	LDA.b $AD
	SEC
	SBC.b $6F
	STA.w $602A,x
	CLC
	ADC.w #$0008
	STA.w $6032,x
	LDA.w #$6B01
	STA.w $602C,x
	LDA.w #$6B10
	STA.w $6034,x
	LDA.w #$0402
	STA.w $6006,x
	STA.w $600E,x
	STA.w $6016,x
	STA.w $601E,x
	STA.w $6026,x
	STA.w $602E,x
	STA.w $6036,x
	TXA
	CLC
	ADC.w #$0038
	TAX
	JMP.w CODE_17C183

DATA_17C329:
	dw $2903,$2933

DATA_17C32D:
	dw $2B36,$6B04

DATA_17C331:
	dw $2B46,$6B13

DATA_17C335:
	dw $0000,$0008

CODE_17C339:
	LDX.w $6092
	LDA.b $AB
	SEC
	SBC.b $6D
	STA.w $6000,x
	LDA.b $A3
	SEC
	SBC.b $6F
	STA.w $6002,x
	LDA.w #$2D4A
	STA.w $6004,x
	LDY.w #$0000
	LDA.b $9F
	BPL.b CODE_17C35B
	INY
	INY
CODE_17C35B:
	LDA.b $76
	SEC
	SBC.b $6D
	STA.w $6008,x
	STA.w $6018,x
	CLC
	ADC.w #$0008
	STA.w $6010,x
	STA.w $6020,x
	LDA.b $72
	SEC
	SBC.b $6F
	STA.b $00
	STA.w $600A,x
	STA.w $6012,x
	CLC
	ADC.w #$0008
	STA.w $601A,x
	STA.w $6022,x
	LDA.w DATA_17C329,y
	STA.b $00
	STA.w $600C,x
	INC
	STA.w $6014,x
	LDA.b $00
	CLC
	ADC.w #$0010
	STA.w $601C,x
	INC
	STA.w $6024,x
	LDA.b $AF
	SEC
	SBC.b $6D
	STA.w $6028,x
	CLC
	ADC.w DATA_17C335,y
	STA.w $6030,x
	LDA.b $AD
	SEC
	SBC.b $6F
	STA.w $602A,x
	CLC
	ADC.w #$0008
	STA.w $6032,x
	LDA.w DATA_17C32D,y
	STA.w $602C,x
	LDA.w DATA_17C331,y
	STA.w $6034,x
	LDA.w #$0402
	STA.w $6006,x
	STA.w $600E,x
	STA.w $6016,x
	STA.w $601E,x
	STA.w $6026,x
	STA.w $602E,x
	STA.w $6036,x
	TXA
	CLC
	ADC.w #$0038
	TAX
	JMP.w CODE_17C183

CODE_17C3EB:
	LDX.w $6092
	LDA.b $76
	SEC
	SBC.b $6D
	STA.w $6010,x
	CLC
	ADC.w #$0004
	STA.w $6000,x
	CLC
	ADC.w #$0004
	STA.w $6008,x
	LDA.b $72
	SEC
	SBC.b $6F
	STA.w $6002,x
	STA.w $600A,x
	CLC
	ADC.w #$0008
	STA.w $6012,x
	LDA.w #$2904
	STA.w $600C,x
	LDA.w #$2913
	STA.w $6014,x
	LDA.w #$2D4C
	STA.w $6004,x
	LDA.b $AF
	SEC
	SBC.b $6D
	STA.w $6020,x
	CLC
	ADC.w #$0008
	STA.w $6018,x
	LDA.b $AD
	SEC
	SBC.b $6F
	STA.w $601A,x
	CLC
	ADC.w #$0008
	STA.w $6022,x
	LDA.w #$2B04
	STA.w $601C,x
	LDA.w #$2B13
	STA.w $6024,x
	LDA.w #$0402
	STA.w $6006,x
	STA.w $600E,x
	STA.w $6016,x
	STA.w $601E,x
	STA.w $6026,x
	TXA
	CLC
	ADC.w #$0028
	TAX
	JMP.w CODE_17C183

DATA_17C46D:
	dw $0007,$0009

DATA_17C471:
	dw $2B38,$2B39

CODE_17C475:
	DEC.b $7D
	BNE.b CODE_17C486
	LDA.w #$0009
	STA.b $7D
	LDA.b $81
	INC
	AND.w #$0003
	STA.b $81
CODE_17C486:
	LDX.w $6092
	LDA.b $76
	SEC
	SBC.b $6D
	STA.w $6000,x
	STA.w $6010,x
	CLC
	ADC.w #$0008
	STA.w $6008,x
	LDA.b $72
	SEC
	SBC.b $6F
	STA.w $600A,x
	CLC
	ADC.w #$0001
	STA.w $6002,x
	CLC
	ADC.w #$0007
	STA.w $6012,x
	LDA.b $81
	ASL
	TAY
	LDA.w DATA_17BF12,y
	STA.b $02
	INC
	STA.w $600C,x
	LDA.b $02
	ORA.w #$0010
	STA.w $6014,x
	LDA.w DATA_17BF1A,y
	STA.w $6004,x
	DEC.b $99
	BNE.b CODE_17C4DC
	LDA.b $9B
	EOR.w #$0002
	STA.b $9B
	LDA.w #$0008
	STA.b $99
CODE_17C4DC:
	LDY.b $9B
	LDA.b $AF
	SEC
	SBC.b $6D
	STA.w $6018,x
	STA.w $6028,x
	SEC
	SBC.w #$0005
	STA.w $6030,x
	CLC
	ADC.w #$000D
	STA.w $6020,x
	LDA.b $AD
	SEC
	SBC.b $6F
	STA.b $00
	INC
	STA.w $601A,x
	STA.w $6022,x
	CLC
	ADC.w #$0007
	STA.w $602A,x
	LDA.b $00
	CLC
	ADC.w DATA_17C46D,y
	STA.w $6032,x
	LDA.w #$6B36
	STA.w $6024,x
	INC
	STA.w $601C,x
	LDA.w #$6B48
	STA.w $602C,x
	LDA.w DATA_17C471,y
	STA.w $6034,x
	LDA.w #$0400
	STA.w $601E,x
	STA.w $6026,x
	STA.w $6036,x
	INC
	INC
	STA.w $6006,x
	STA.w $600E,x
	STA.w $6016,x
	STA.w $602E,x
	TXA
	CLC
	ADC.w #$0038
	TAX
	JMP.w CODE_17C183

DATA_17C54E:
	dw $FFFE,$0002,$0004,$FFFC

DATA_17C556:
	dw $0000,$0100,$0100,$0000

DATA_17C55E:
	dw $796C,$396C

CODE_17C562:
	REP.b #$30
	LDA.w #$0004
	STA.b $93
	LDA.b $35
	AND.w #$0010
	LSR
	LSR
	LSR
	TAY
	LDA.b $6D
	CMP.w DATA_17C556,y
	BEQ.b CODE_17C597
	CLC
	ADC.w DATA_17C54E,y
	STA.b $00
	SEC
	SBC.w DATA_17C556,y
	BEQ.b CODE_17C58A
	EOR.w DATA_17C54E,y
	BMI.b CODE_17C58F
CODE_17C58A:
	LDA.w DATA_17C556,y
	STA.b $00
CODE_17C58F:
	LDA.b $00
	STA.b $69
	STA.b $6D
	STA.b !RAM_YI_Global_Layer3XPosLo
CODE_17C597:
	LDX.w $6092
	LDA.w #$00E8
	CPY.w #$0002
	BEQ.b CODE_17C5A5
	LDA.w #$0008
CODE_17C5A5:
	STA.w $6000,x
	LDA.w #$00A8
	STA.w $6002,x
	LDA.w DATA_17C55E,y
	STA.w $6004,x
	LDA.w #$0102
	STA.w $6006,x
	TXA
	CLC
	ADC.w #$0008
	STA.w $6092
	JMP.w CODE_17BF7C

CODE_17C5C5:
	REP.b #$30
	LDA.w #$0000
	LDX.b $6D
	CPX.b $79
	BCC.b CODE_17C5D2
	INC
	INC
CODE_17C5D2:
	ORA.b $93
	TAY
	LDA.b $6D
	CMP.b $79
	BNE.b CODE_17C5DF
	STZ.b $93
	BRA.b CODE_17C5FB

CODE_17C5DF:
	CLC
	ADC.w DATA_17C54E,y
	STA.b $00
	SEC
	SBC.b $79
	BEQ.b CODE_17C5EF
	EOR.w DATA_17C54E,y
	BMI.b CODE_17C5F3
CODE_17C5EF:
	LDA.b $79
	STA.b $00
CODE_17C5F3:
	LDA.b $00
	STA.b $6D
	STA.b $69
	STA.b !RAM_YI_Global_Layer3XPosLo
CODE_17C5FB:
	JMP.w CODE_17BF7C

CODE_17C5FE:
	REP.b #$20
	JSR.w CODE_17C672
	STZ.w $110C
	SEP.b #$20
	JSR.w CODE_17C8B3
	LDA.w !RAM_YI_Level_CurrentWorldLo
	LSR
	TAX
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	SEC
	SBC.w DATA_map_world_tile_base_b,x
	INC
	REP.b #$20
	AND.w #$00FF
	STA.b $00
	JSR.w CODE_17E7FB
	TYA
	AND.w #$000F
	ASL
	TAX
	LDA.w $1115
	AND.w #$00FF
	BEQ.b CODE_17C637
	ASL
	TAX
	LDA.w DATA_17E26F,x
	BRA.b CODE_17C63A

CODE_17C637:
	LDA.w DATA_17E257,x
CODE_17C63A:
	STA.w $1109
	SEP.b #$20
	STY.w $1112
	STZ.w $1117
	STZ.w $1118
	STZ.w $1108
	STZ.w $111A
	STZ.w $111B
	STZ.w $111C
	STZ.w $1128
	STZ.w $1129
	STZ.w $112A
	LDA.b #$01
	STA.w $1106
	INC.w $1118
	STZ.w $1106
	STZ.w $1118
	JSR.w CODE_17D885
	STZ.w $1115
	RTL

CODE_17C672:
	LDX.b #$00
	LDA.w #$19BF
CODE_17C677:
	STA.w $0A06,x
	STA.w $0D86,x
	STA.w $0B06,x
	STA.w $0E86,x
	STA.w $0C06,x
	STA.w $0F86,x
	STA.w $0C86,x
	STA.w $1006,x
	DEX
	DEX
	BNE.b CODE_17C677
	RTS

DATA_17C694:
	db $02,$05,$00,$04,$01,$03,$06,$07,$00,$00,$00,$00,$02,$05,$00,$04
	db $01,$03,$06,$07,$00,$00,$00,$00,$02,$05,$00,$04,$01,$03,$06,$07
	db $00,$00,$00,$00,$02,$05,$00,$04,$01,$03,$06,$07,$00,$00,$00,$00
	db $02,$05,$00,$04,$01,$03,$06,$07,$00,$00,$00,$00,$02,$05,$00,$04
	db $01,$03,$06,$02

; Per-Yoshi-color overworld palette pointers (10 entries -- one per Yoshi color slot).
; Raidenthequick: `DATA_map_active_yoshi_color_ptr` at $17:C6D8.
DATA_17C6D8:
DATA_map_active_yoshi_color_ptr:				; Raiden alias
	dw DATA_5FDF88,DATA_5FDF8E,DATA_5FDF94,DATA_5FDF9A,DATA_5FDFA0,DATA_5FDFA6,DATA_5FDFAC,DATA_5FDFB2
	dw DATA_5FDFB8,DATA_5FDFBE

CODE_17C6EC:
	LDA.b #DATA_5FDF88>>16
	STA.b $02
	STA.b $05
	REP.b #$30
	LDX.w !RAM_YI_Level_CurrentLevelFromMapLo
CODE_17C6F7:
	LDA.w DATA_17C694,x
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_map_active_yoshi_color_ptr,y
	STA.b $00
	LDA.w DATA_17C694+$01,x
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_map_active_yoshi_color_ptr,y
	STA.b $03
	LDX.w #$0000
CODE_17C714:
	TXY
	LDA.b [$00],y
	STA.l YI_Global_PaletteMirror[$CD].LowByte,x
	LDA.b [$03],y
	STA.l YI_Global_PaletteMirror[$DD].LowByte,x
	INX
	INX
	CPX.w #$0006
	BCC.b CODE_17C714
	SEP.b #$30
	RTS

CODE_17C72B:
	LDA.b #DATA_5FDF88>>16
	STA.b $02
	STA.b $05
	PHX
	REP.b #$30
	LDA.w $112E
	AND.w #$00FF
	STA.b $00
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_map_world_tile_base_w,x
	CLC
	ADC.b $00
	TAX
	JSR.w CODE_17C6F7
	PLX
	RTL

CODE_17C74B:
	PHP
	PHB
	PHK
	PLB
	SEP.b #$30
	JSR.w CODE_17C6EC
	PLB
	PLP
	RTL

;-------------------------------------------------------------------------
; CODE_gm22_inner_dispatcher -- gm22 inner dispatcher (per-frame overworld state router).
; Called as `JSL CODE_gm22_inner_dispatcher` from `CODE_gm22_overworld` (CODE_gm22_overworld).
;
; Selects one of four routing paths each frame depending on which sub-state
; flag is set; all paths eventually fall through to the cursor + scoring
; tail at CODE_17E200 / CODE_17E27B.
;
;   1. $7E:114E != 0 -> extended-scene table (DATA_17C88D), then tail.
;   2. $7E:1118 >= $28 -> high-numbered states routed via DATA_world_map_state_ptr
;      (DATA_world_map_state_ptr - $02) -- bonus/cutscene/file-select states.
;   3. $7E:1118 in $01..$27 -> normal states routed via CODE_gm22_dispatch_idle_tick (which
;      itself uses DATA_world_map_state_ptr with the same $-$02 base).
;   4. $7E:1118 == 0 -> idle path (CODE_17C7D1 etc.): runs cursor poll
;      (CODE_world_map_cursor_dpad_move / CODE_gm22_input_gate_level_select = CODE_level_select), score-button checks
;      (CODE_17E6C5 / CODE_17E1DF), and animation idle (CODE_17E200).
;
; INPUTS:
;   M=8 X=8 from caller (gm22).
;   $7E:1118 = world-map state byte. $7E:114E = extended-state arm.
;   $7E:1117 = score-button activity; $7E:111B = controller-config flag.
;   $7E:110C/110D = pending state-transition flag.
; OUTPUTS:
;   $7E:1122 cleared; $7E:1B set by score-color seed ($B7 -> color-math reg).
;   One sub-state handler runs (advances $1118 internally), then CODE_17E200
;   (animation tick) and CODE_17E27B (HUD/score render finalize) are called.
; MODIFIES: A, X, Y, DP $00..$10.
; CALLERS:
;   CODE_gm22_overworld -- once per overworld frame.
;-------------------------------------------------------------------------
CODE_17C757:
CODE_gm22_inner_dispatcher:                          ; per-frame overworld dispatcher; routes via DATA_world_map_state_ptr
	STZ.w $1122
	LDA.b #$B7
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.w $114E
	BEQ.b CODE_gm22_dispatch_high_states
	ASL
	TAX
	JSR.w (DATA_17C88D-$02,x)
	JMP.w CODE_17C80C

CODE_17C76C:
CODE_gm22_dispatch_high_states:                      ; $1118 >= $28 -> high-numbered DATA_world_map_state_ptr fast path
	LDA.w $1118
	CMP.b #$28
	BCC.b CODE_17C77E
	ASL
	TAX
	STA.w $1122
	JSR.w (DATA_world_map_state_ptr-$02,x)
	JMP.w CODE_17C80F

CODE_17C77E:
	LDA.w $0979
	BNE.b CODE_17C795
	LDA.w $111C
	AND.b #$F0
	BNE.b CODE_gm22_dispatch_idle_tick
	LDA.b $36
	AND.b #$0F
	BNE.b CODE_gm22_dispatch_idle_tick
	STZ.w $111C
	BRA.b CODE_gm22_dispatch_idle_tick

CODE_17C795:
	LDA.w $111D
	ASL
	TAX
	JSR.w (DATA_17C887,x)
	LDA.w $1110
	CMP.b #$20
	BCS.b CODE_17C7B8
	LDA.w $1114
	CMP.b #$0C
	BCS.b CODE_17C7B0
	JSR.w CODE_17C9F6
	BRA.b CODE_17C7B8

CODE_17C7B0:
	LDA.b #$80
	STA.w $0986
	INC.w $098E
CODE_17C7B8:
	LDA.w $1110
	ORA.w $1111
	BEQ.b CODE_17C80F
	JSR.w CODE_17E533
	BRA.b CODE_17C80F

CODE_17C7C5:
CODE_gm22_dispatch_idle_tick:                        ; $1118 in $01..$27 -> mid-range DATA_world_map_state_ptr via cursor-poll
	LDA.w $1118
	BEQ.b CODE_17C7D1
	ASL
	TAX
	JSR.w (DATA_world_map_state_ptr-$02,x)
	BRA.b CODE_17C80F

CODE_17C7D1:
	LDA.w $1117
	BEQ.b CODE_17C7E3
	LDA.w $110C
	ORA.w $110D
	BNE.b CODE_17C7F9
	JSR.w CODE_world_map_cursor_dpad_move
	BRA.b CODE_17C7F6

CODE_17C7E3:
	LDA.w $111B
	BEQ.b CODE_17C7EB
	JSR.w CODE_17E6C5
CODE_17C7EB:
	LDA.w $110C
	ORA.w $110D
	BNE.b CODE_17C7F9
	JSR.w CODE_gm22_input_gate_level_select
CODE_17C7F6:
	JSR.w CODE_17E1DF
CODE_17C7F9:
	LDA.w $110C
	CMP.b #$2C
	BEQ.b CODE_17C804
	CMP.b #$CC
	BNE.b CODE_17C80C
CODE_17C804:
	LDA.w $111C
	AND.b #$0F
	STA.w $111C
CODE_17C80C:
	JSR.w CODE_17E200
CODE_17C80F:
	JSR.w CODE_17E27B
	RTL

;-------------------------------------------------------------------------
; DATA_world_map_state_ptr -- `DATA_world_map_state_ptr`: per-frame overworld dispatch table.
; Raidenthequick: `DATA_world_map_state_ptr` at $17:C813.
;
; 58 word entries (states $01..$3A; $17 is a $0000 gap). Indexed by
; `($7E:1118 - 2) << 1` from CODE_gm22_inner_dispatcher's three dispatch paths
; (CODE_gm22_dispatch_high_states for $1118 >= $28, CODE_gm22_dispatch_idle_tick for $1118 in $01..$27 via
; CODE_gm22_input_gate_level_select gating). The state byte $7E:1118 selects which sub-state
; runs this frame; many states advance $1118 themselves.
;
; Grouped by phase:
;   World-change cinematic (when player clicks a "go to other world" tile):
;     $01 clicked other world                  $02 world-change post-click pause
;     $03 world-change post-pause              $04 new stages wiping down (CODE_world_map_state_04_new_stages_wiping_down)
;     $05 new stages settling                  $06 prev world folding away (CODE_world_map_state_06_prev_world_folding_away)
;     $07 prev world folded -- swap world ID   $08-$09 cursor lock during fold
;   Score-button cinematic (when player presses the per-level score button):
;     $0A score-button bounce A                $0B-$0C cursor lock during score-button
;     $0D-$11 score-button animation frames    $12-$15 score-button settle
;     $16 new world folding in (CODE_world_map_state_16_new_world_folding_in)   $17 (gap, dw $0000)
;     $18 score button pressed (show scores)   $19 score button shrinking
;     $1A score button growing                 $1B score button prepare to show scores
;     $1C score button set next level tile     $1D score button flipping (level icon)
;     $1E score button flipping (score icon)   $1F score button waiting for 2nd press
;     $20 score button pressed (hide scores)   $21 score button shrinking
;     $22 score button growing                 $23 score button prepare-to-hide
;   Controller-config (debug/option transitions):
;     $24-$27 controller-config sub-states
;   Extended scenes ($28-$3A): bonus-game intros, world-cleared cinematics,
;     save-file / file-select transitions. Routed only via CODE_gm22_dispatch_high_states
;     (the $1118 >= $28 fast-path that skips the cursor-poll idle tick).
;-------------------------------------------------------------------------
DATA_17C813:
DATA_world_map_state_ptr:					; Raiden alias
	dw CODE_world_map_state_01_world_change_click						; $01 clicked other world
	dw CODE_world_map_state_02_world_change_postclick_pause						; $02
	dw CODE_world_map_state_03_world_change_post_pause						; $03
	dw CODE_world_map_state_04_new_stages_wiping_down						; $04 new stages wiping down
	dw CODE_world_map_state_05_new_stages_settling						; $05
	dw CODE_world_map_state_06_prev_world_folding_away						; $06 prev world folding away
	dw CODE_world_map_state_07_swap_world_id						; $07 swap world ID after fold
	dw CODE_world_map_state_08_09_cursor_lock_fold						; $08
	dw CODE_world_map_state_08_09_cursor_lock_fold						; $09
	dw CODE_world_map_state_0a_0c_score_bounce_a						; $0A score-bounce A
	dw CODE_world_map_state_0b_cursor_lock_score_btn						; $0B
	dw CODE_world_map_state_0a_0c_score_bounce_a						; $0C
	dw CODE_world_map_state_0d_score_btn_anim_frame						; $0D
	dw CODE_17CE51						; $0E
	dw CODE_17CE5B						; $0F
	dw CODE_17CE65						; $10
	dw CODE_17CE6F						; $11
	dw CODE_17CE79						; $12
	dw CODE_17CE83						; $13
	dw CODE_17CE8D						; $14
	dw CODE_17CE97						; $15
	dw CODE_world_map_state_16_new_world_folding_in						; $16 new world folding in
	dw $0000						; $17 (gap)
	dw CODE_world_map_state_18_20_score_btn_pressed						; $18 score button pressed (show scores)
	dw CODE_world_map_state_19_21_score_btn_shrinking						; $19 score button shrinking
	dw CODE_world_map_state_1a_22_score_btn_growing						; $1A score button growing
	dw CODE_world_map_state_1b_prepare_show_scores						; $1B prepare to show scores
	dw CODE_world_map_state_1c_set_next_level_tile						; $1C set next level tile
	dw CODE_world_map_state_1d_flip_level_icon						; $1D flipping (level icon)
	dw CODE_world_map_state_1e_flip_score_icon						; $1E flipping (score icon)
	dw CODE_world_map_state_1f_wait_second_press						; $1F waiting for 2nd press
	dw CODE_world_map_state_18_20_score_btn_pressed						; $20 score button pressed (hide scores)
	dw CODE_world_map_state_19_21_score_btn_shrinking						; $21 score button shrinking
	dw CODE_world_map_state_1a_22_score_btn_growing						; $22 score button growing
	dw CODE_world_map_state_23_score_btn_prepare_hide						; $23 prepare-to-hide
	dw CODE_world_map_state_24_controller_cfg_a						; $24 controller-config A
	dw CODE_world_map_state_25_controller_cfg_b						; $25
	dw CODE_world_map_state_26_controller_cfg_c						; $26
	dw CODE_world_map_state_27_controller_cfg_d						; $27
	dw CODE_world_map_state_28_bonus_scene_init						; $28+ extended scenes (bonus, file-select, cutscenes)
	dw CODE_world_map_state_29_bonus_scene_hit_box						; $29
	dw CODE_17EBA9						; $2A
	dw CODE_17EBB8						; $2B
	dw CODE_17EBCB						; $2C
	dw CODE_17EBEC						; $2D
	dw CODE_17EC26						; $2E
	dw CODE_17ECA1						; $2F
	dw CODE_17ECC2						; $30
	dw CODE_17ED02						; $31
	dw CODE_17ED37						; $32
	dw CODE_17ED3D						; $33
	dw CODE_17ED52						; $34
	dw CODE_17ED5F						; $35
	dw CODE_17ED81						; $36
	dw CODE_17ED94						; $37
	dw CODE_17EDA3						; $38
	dw CODE_world_map_state_39_world_clear_celebration						; $39
	dw CODE_world_map_state_3a_world_clear_finalize						; $3A

DATA_17C887:
	dw CODE_17E729
	dw CODE_17E744
	dw CODE_17E7BF

DATA_17C88D:
	dw CODE_17EF54
	dw CODE_17F0CC
	dw CODE_17F0D1
	dw CODE_17F0E1
	dw CODE_17F118
	dw CODE_17F142
	dw CODE_17F1C5
	dw CODE_17F1DF
	dw CODE_17F226
	dw CODE_17F23F
	dw CODE_17F259
	dw CODE_17F0CC
	dw CODE_17F0D1
	dw CODE_17F0E1
	dw CODE_17F266
	dw CODE_17F28A
	dw CODE_17F2DF
	dw CODE_17F3BB
	dw CODE_arm_bonus_game_loader

CODE_17C8B3:
	REP.b #$20
	STZ.b $04
	STZ.b $06
	SEP.b #$20
	LDA.b #DATA_world_unlock_ptr_world1>>16
	STA.b $12
	LDA.b #$00
	STA.b $0F
CODE_17C8C3:
	REP.b #$20
	LDA.b $04
	ASL
	TAX
	LDA.l DATA_world_unlock_ptr_table,x
	STA.b $10
	LDA.w #$0001
	STA.b $02
	SEP.b #$20
CODE_17C8D6:
	LDY.b $06
	LDA.w !RAM_YI_Map_LevelClearFlags,y
	BEQ.b CODE_17C91F
	AND.b #$80
	ORA.b $02
	STA.b $00
	LDY.b #$00
CODE_17C8E5:
	REP.b #$20
	LDA.b [$10],y
	STA.b $0D
	SEP.b #$20
	LDA.b [$0D]
	AND.b #$7F
	CMP.b $02
	BEQ.b CODE_17C915
	INY
	INY
	CPY.b #$10
	BCC.b CODE_17C8E5
	LDY.b #$00
CODE_17C8FD:
	REP.b #$20
	LDA.b [$10],y
	STA.b $0D
	SEP.b #$20
	LDA.b [$0D]
	BEQ.b CODE_17C91B
	CMP.b #$FF
	BEQ.b CODE_17C91F
	INY
	INY
	CPY.b #$10
	BCC.b CODE_17C8FD
	BRA.b CODE_17C91F

CODE_17C915:
	LDA.b [$0D]
	AND.b #$80
	BEQ.b CODE_17C91F
CODE_17C91B:
	LDA.b $00
	STA.b [$0D]
CODE_17C91F:
	INC.b $06
	INC.b $02
	LDA.b $02
	CMP.b #$09
	BCC.b CODE_17C8D6
	INC.b $06
	INC.b $06
	INC.b $06
	INC.b $06
	INC.b $04
	LDA.b $04
	CMP.b #$06
	BCC.b CODE_17C8C3
	RTS

DATA_17C93A:
	dw $030F,$031B,$0327,$0333,$033F,$034B

CODE_17C946:
	REP.b #$30
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_17C9EA,x
	STA.b $0E
	STZ.b $08
	LDX.w #$0000
	LDA.w $1106
	AND.w #$00FF
	BEQ.b CODE_17C962
	LDA.w #$0380
	STA.b $08
CODE_17C962:
	LDA.w #DATA_17C9C6
	STA.b $00
	LDA.w #DATA_17C9CC
	STA.b $02
	LDA.w #DATA_17C9D2
	STA.b $04
	LDA.w DATA_17DCEF,x
	CLC
	ADC.b $08
	STA.b $10
	CLC
	ADC.w #$0040
	STA.b $12
	CLC
	ADC.w #$0040
	STA.b $14
	INX
	INX
	CPX.w #$0012
	BCS.b CODE_17C9C3
	CPX.w #$0008
	BEQ.b CODE_17C996
	CPX.w #$0010
	BNE.b CODE_17C9A5
CODE_17C996:
	LDA.w #DATA_17C9D8
	STA.b $00
	LDA.w #DATA_17C9DE
	STA.b $02
	LDA.w #DATA_17C9E4
	STA.b $04
CODE_17C9A5:
	LDY.w #$0000
CODE_17C9A8:
	LDA.b ($00),y
	ORA.b $0E
	STA.b ($10),y
	LDA.b ($02),y
	ORA.b $0E
	STA.b ($12),y
	LDA.b ($04),y
	ORA.b $0E
	STA.b ($14),y
	INY
	INY
	CPY.w #$0006
	BCC.b CODE_17C9A8
	BRA.b CODE_17C962

CODE_17C9C3:
	SEP.b #$30
	RTS

DATA_17C9C6:
	dw $2187,$218F,$6187

DATA_17C9CC:
	dw $2198,$218E,$6198

DATA_17C9D2:
	dw $A187,$A18F,$E187

DATA_17C9D8:
	dw $21F5,$21F5,$21F5

DATA_17C9DE:
	dw $21F7,$21F7,$21F7

DATA_17C9E4:
	dw $21F7,$21F6,$21F7

DATA_17C9EA:
	dw $0C00,$1000,$1400,$0000,$0400,$0800

CODE_17C9F6:
	DEC.w $1113
	BNE.b CODE_17CA07
	LDX.w $1114
	LDA.w DATA_17CAF6,x
	STA.w $1113
	INC.w $1114
CODE_17CA07:
	LDA.w $1114
	CMP.b #$0C
	BCC.b CODE_17CA11
CODE_17CA0E:
	JMP.w CODE_17CAF5

CODE_17CA11:
	CMP.b #$08
	BEQ.b CODE_17CA0E
	ASL
	REP.b #$30
	AND.w #$00FF
	TAX
	LDA.w DATA_17CB01,x
	STA.b $00
	LDY.w $6092
	LDA.w $1109
	AND.w #$00FF
	STA.b $02
	CLC
	ADC.b ($00)
	STA.w $6000,y
	INC.b $00
	INC.b $00
	LDA.b $02
	CLC
	ADC.b ($00)
	STA.w $6008,y
	INC.b $00
	INC.b $00
	LDA.b $02
	CLC
	ADC.b ($00)
	STA.w $6010,y
	INC.b $00
	INC.b $00
	LDA.b $02
	CLC
	ADC.b ($00)
	STA.w $6018,y
	INC.b $00
	INC.b $00
	LDA.b $02
	CLC
	ADC.b ($00)
	STA.w $6020,y
	INC.b $00
	INC.b $00
	LDA.b $02
	CLC
	ADC.b ($00)
	STA.w $6028,y
	LDA.w DATA_17CB19,x
	STA.b $00
	LDA.w $110A
	AND.w #$00FF
	SEC
	SBC.w #$0005
	STA.b $02
	CLC
	ADC.b ($00)
	STA.w $6002,y
	INC.b $00
	INC.b $00
	LDA.b $02
	CLC
	ADC.b ($00)
	STA.w $600A,y
	INC.b $00
	INC.b $00
	LDA.b $02
	CLC
	ADC.b ($00)
	STA.w $6012,y
	INC.b $00
	INC.b $00
	LDA.b $02
	CLC
	ADC.b ($00)
	STA.w $601A,y
	INC.b $00
	INC.b $00
	LDA.b $02
	CLC
	ADC.b ($00)
	STA.w $6022,y
	INC.b $00
	INC.b $00
	LDA.b $02
	CLC
	ADC.b ($00)
	STA.w $602A,y
	LDA.w DATA_17CB31,x
	STA.w $6004,y
	STA.w $600C,y
	STA.w $6014,y
	STA.w $601C,y
	STA.w $6024,y
	STA.w $602C,y
	LDA.w DATA_17CB49,x
	STA.w $6006,y
	STA.w $600E,y
	STA.w $6016,y
	STA.w $601E,y
	STA.w $6026,y
	STA.w $602E,y
	TYA
	CLC
	ADC.w #$0030
	STA.w $6092
	SEP.b #$30
CODE_17CAF5:
	RTS

DATA_17CAF6:
	db $01,$02,$02,$03,$02,$03,$04,$08,$04,$04,$04

DATA_17CB01:
	dw DATA_17CB61,DATA_17CB6D,DATA_17CB79,DATA_17CB85,DATA_17CB91,DATA_17CB9D,DATA_17CBA9,DATA_17CBB5
	dw $0000,DATA_17CBC1,DATA_17CBCD,DATA_17CBD9

DATA_17CB19:
	dw DATA_17CBE5,DATA_17CBF1,DATA_17CBFD,DATA_17CC09,DATA_17CC15,DATA_17CC21,DATA_17CC2D,DATA_17CC39
	dw $0000,DATA_17CC45,DATA_17CC51,DATA_17CC5D

DATA_17CB31:
	dw $37C4,$31C5,$35C6,$33C8,$33C8,$35C6,$31C5,$37C4
	dw $0000,$31D4,$31D5,$71D4

DATA_17CB49:
	dw $0000,$0000,$0002,$0002,$0002,$0002,$0000,$0000
	dw $0000,$0000,$0000,$0000

DATA_17CB61:
	dw $0000,$0000,$FFFC,$FFF8,$FFF8,$FFFC

DATA_17CB6D:
	dw $0004,$0004,$FFFC,$FFF4,$FFF4,$FFFC

DATA_17CB79:
	dw $FFF8,$FFF8,$FFED,$FFED,$0003,$0003

DATA_17CB85:
	dw $FFF8,$FFF8,$0006,$0006,$FFEA,$FFEA

DATA_17CB91:
	dw $FFE3,$FFE3,$000D,$000D,$FFF8,$FFF8

DATA_17CB9D:
	dw $FFF8,$FFF8,$000D,$000D,$FFE3,$FFE3

DATA_17CBA9:
	dw $FFE7,$FFFC,$0011,$0011,$FFFC,$FFE7

DATA_17CBB5:
	dw $FFFC,$0011,$0011,$FFFC,$FFE7,$FFE7

DATA_17CBC1:
	dw $FFFC,$0011,$FFE7,$FFE7,$0011,$FFFC

DATA_17CBCD:
	dw $FFE7,$FFE7,$FFFC,$0011,$0011,$FFFC

DATA_17CBD9:
	dw $FFFC,$0011,$FFE7,$FFE7,$0011,$FFFC

DATA_17CBE5:
	dw $FFFA,$FFFE,$0000,$FFFE,$FFFA,$FFF8

DATA_17CBF1:
	dw $FFF8,$0000,$0004,$0000,$FFF8,$FFF4

DATA_17CBFD:
	dw $0003,$FFED,$FFFE,$FFF2,$FFFE,$FFF2

DATA_17CC09:
	dw $FFE7,$0009,$0001,$FFEF,$FFEF,$0001

DATA_17CC15:
	dw $0005,$FFEB,$FFEB,$0005,$0010,$FFE0

DATA_17CC21:
	dw $0010,$FFE0,$FFEB,$0005,$0005,$FFEB

DATA_17CC2D:
	dw $0009,$0014,$0009,$FFEF,$FFE4,$FFEF

DATA_17CC39:
	dw $FFE4,$FFEF,$0009,$0014,$0009,$FFEF

DATA_17CC45:
	dw $0014,$0009,$0009,$FFEF,$FFEF,$FFE4

DATA_17CC51:
	dw $FFEF,$0009,$0014,$0009,$FFEF,$FFE4

DATA_17CC5D:
	dw $0014,$0009,$0009,$FFEF,$FFEF,$FFE4

CODE_17CC69:
CODE_world_map_state_01_world_change_click:          ; DATA_world_map_state_ptr[$01] -- player clicked a "go to other world" tile
	JSR.w CODE_17D885
	INC.w $1118
CODE_17CC6F:
	REP.b #$30
	LDA.w $1106
	AND.w #$0001
	ASL
	TAY
	LDA.w #$0000
	STA.b $01
	LDA.w DATA_17CC8F,y
	TAX
	LDY.w #$1E20
	LDA.w #$0380
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	RTS

DATA_17CC8F:
	dw $0D86,$0A06

CODE_17CC93:
CODE_world_map_state_02_world_change_postclick_pause: ; DATA_world_map_state_ptr[$02] -- post-click pause before fold
	REP.b #$30
	LDA.w $1106
	AND.w #$0001
	ASL
	TAY
	LDX.w #$705800
	LDA.w #$705800>>16
	STA.b $01
	LDA.w DATA_17CCB6,y
	TAY
	LDA.w #$0800
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	INC.w $1118
	RTS

DATA_17CCB6:
	dw $2800,$2000

CODE_17CCBA:
CODE_world_map_state_03_world_change_post_pause:     ; DATA_world_map_state_ptr[$03] -- proceed after the post-click pause
	REP.b #$30
	LDA.w $1106
	AND.w #$0001
	ASL
	TAY
	LDX.w #$706000
	LDA.w #$706000>>16
	STA.b $01
	LDA.w DATA_17CCF1,y
	TAY
	LDA.w #$0800
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$10
	LDA.w #$FF00
	STA.l $7E55C0
	STA.w $1144
	STZ.w $1107
	SEP.b #$20
	LDA.b #$01
	STA.w !RAM_YI_Global_MainScreenWindowMask
	INC.w $1118
	RTS

DATA_17CCF1:
	dw $2C00,$2400

CODE_17CCF5:
	PHB
	LDY.b #$7E55C0>>16
	PHY
	PLB
	LDY.b #$00
	LDA.w #$00FF
CODE_17CCFF:
	STA.w $7E55C0,y
	STA.w $7E5620,y
	DEY
	DEY
	BNE.b CODE_17CCFF
	PLB
	RTS

CODE_17CD0B:
	JSR.w CODE_17CCF5
	RTL

CODE_17CD0F:
CODE_world_map_state_04_new_stages_wiping_down:      ; DATA_world_map_state_ptr[$04] -- new world's stages wiping down
	JSR.w CODE_17E7BF
CODE_17CD12:
	REP.b #$30
	LDA.w $1107
	AND.w #$00FF
	ASL
	ASL
	TAX
	LDA.w #$EF10
	LDY.w #$0000
CODE_17CD23:
	STA.l $7E55C4,x
	INX
	INX
	INX
	INX
	INY
	CPY.w #$0004
	BCC.b CODE_17CD23
	SEP.b #$30
	LDA.w $1107
	CLC
	ADC.b #$04
	STA.w $1107
	CMP.b #$54
	BCC.b CODE_17CD62
	REP.b #$30
	LDA.w $1106
	AND.w #$0001
	ASL
	TAY
	LDA.w #$0000
	STA.b $01
	LDA.w DATA_17CC8F,y
	TAX
	LDY.w #$1C20
	LDA.w #$0380
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	INC.w $1118
CODE_17CD62:
	RTS

CODE_17CD63:
CODE_world_map_state_05_new_stages_settling:         ; DATA_world_map_state_ptr[$05] -- new stages settling into place
	REP.b #$20
	JSR.w CODE_17CCF5
	SEP.b #$20
	LDA.b #$17
	STA.w !RAM_YI_Global_MainScreenWindowMask
	STZ.w !RAM_YI_Global_ColorMathInitialSettings
	INC.w $1118
	RTS

CODE_17CD76:
CODE_world_map_state_06_prev_world_folding_away:     ; DATA_world_map_state_ptr[$06] -- previous world folding away
	INC.w $1142
	INC.w $0990
	INC.w $0992
	INC.w $0994
	LDA.w $0994
	CMP.b #$1F
	BCC.b CODE_17CD96
	INC.w $1118
	REP.b #$20
	LDA.w !RAM_YI_Level_CurrentWorldLo
	STA.w $1125
	SEP.b #$20
CODE_17CD96:
	RTS

CODE_17CD97:
CODE_world_map_state_07_swap_world_id:               ; DATA_world_map_state_ptr[$07] -- swap world ID after fold finishes
	JSL.l CODE_clear_all_sprites
	JSL.l CODE_init_oam_buffer
	REP.b #$30
	STZ.w !RAM_YI_Map_RunningYoshiIndex
	JSL.l CODE_17A86D
	REP.b #$30
	JSL.l CODE_load_world_map_palettes
	SEP.b #$30
	JSR.w CODE_17C6EC
	INC.w $1118
	RTS

CODE_17CDB7:
CODE_world_map_state_08_09_cursor_lock_fold:         ; DATA_world_map_state_ptr[$08]/[$09] -- cursor locked during fold
	REP.b #$30
	LDA.w #$0000
	LDX.w #$0000
	BRA.b CODE_17CDCF

CODE_17CDC1:
CODE_world_map_state_0b_cursor_lock_score_btn:       ; DATA_world_map_state_ptr[$0B] -- cursor lock during score-button
	REP.b #$30
	LDA.w #$0800
	LDX.w #$0001
	BRA.b CODE_17CDCF

CODE_17CDCB:
CODE_world_map_state_0d_score_btn_anim_frame:        ; DATA_world_map_state_ptr[$0D] -- score-button animation frame tick
	INC.w $1118
	RTS

CODE_17CDCF:
	STA.b $0E
	STX.b $00
	LDA.w !RAM_YI_Level_CurrentWorldLo
	CLC
	ADC.b $00
	TAX
	LDA.l DATA_00B3F4,x
	AND.w #$00FF
	STA.b $0C
	ASL
	ADC.b $0C
	TAX
	LDA.l DATA_06F95E,x
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.l DATA_06F95E+$02,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$5800
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	SEP.b #$10
	LDX.b #FXCODE_08A980>>16
	LDA.w #FXCODE_08A980
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	JSR.w CODE_17CE11
	SEP.b #$30
	RTS

CODE_17CE11:
	LDX.w #$705800
	LDA.w #$705800>>16
	STA.b $01
	LDY.b $0E
	LDA.w #$0800
	JSL.l CODE_vram_dma_queue_add_180_2118
	INC.w $1118
	RTS

DATA_17CE26:
	dw $0400,$0C00,$1800

CODE_17CE2C:
CODE_world_map_state_0a_0c_score_bounce_a:           ; DATA_world_map_state_ptr[$0A]/[$0C] -- score-button bounce-A animation
	LDA.w $1118
	SEC
	SBC.b #$09
	REP.b #$30
	AND.w #$00FF
	TAY
	LDX.w #$706000
	LDA.w #$706000>>16
	STA.b $01
	LDA.w DATA_17CE26-$01,y
	TAY
	LDA.w #$0800
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	INC.w $1118
	RTS

CODE_17CE51:
	REP.b #$30
	LDX.w #$4000
	LDY.w #$0000
	BRA.b CODE_17CE9F

CODE_17CE5B:
	REP.b #$30
	LDX.w #$4400
	LDY.w #$0001
	BRA.b CODE_17CE9F

CODE_17CE65:
	REP.b #$30
	LDX.w #$4800
	LDY.w #$0002
	BRA.b CODE_17CE9F

CODE_17CE6F:
	REP.b #$30
	LDX.w #$4C00
	LDY.w #$0003
	BRA.b CODE_17CE9F

CODE_17CE79:
	REP.b #$30
	LDX.w #$5000
	LDY.w #$0004
	BRA.b CODE_17CE9F

CODE_17CE83:
	REP.b #$30
	LDX.w #$5400
	LDY.w #$0005
	BRA.b CODE_17CE9F

CODE_17CE8D:
	REP.b #$30
	LDX.w #$5800
	LDY.w #$0006
	BRA.b CODE_17CE9F

CODE_17CE97:
	REP.b #$30
	LDX.w #$5C00
	LDY.w #$0007
CODE_17CE9F:
	STX.b $0E
	STY.b $00
	LDA.w !RAM_YI_Level_CurrentWorldLo
	ASL
	ASL
	ADC.b $00
	TAX
	LDA.l DATA_00B409,x
	AND.w #$00FF
	STA.b $0C
	ASL
	ADC.b $0C
	TAX
	LDA.w #$0020
	JSR.w CODE_17CEC1
	SEP.b #$30
	RTS

CODE_17CEC1:
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_06FC79,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.l DATA_06FC79+$02,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEP.b #$10
	LDX.b #FXCODE_0A8000>>16
	LDA.w #FXCODE_0A8000
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	JSR.w CODE_17CE11
	RTS

CODE_17CEE6:
	LDX.w #$706000
	LDA.w #$706000>>16
	STA.b $01
	LDA.w #$0800
	JSL.l CODE_vram_dma_queue_add_180_2118
	INC.w $1118
	SEP.b #$30
	RTS

CODE_17CEFB:
CODE_world_map_state_16_new_world_folding_in:        ; DATA_world_map_state_ptr[$16] -- new world folding in
	DEC.w $1142
	DEC.w $0990
	DEC.w $0992
	DEC.w $0994
	BNE.b CODE_17CF17
	STZ.w $1142
	STZ.w $1118
	LDA.b #$10
	STA.w !RAM_YI_Global_ColorMathInitialSettings
	STZ.w !RAM_YI_Global_MainScreenWindowMask
CODE_17CF17:
	RTS

CODE_17CF18:
CODE_world_map_state_18_20_score_btn_pressed:        ; DATA_world_map_state_ptr[$18]/[$20] -- score-button pressed (show/hide)
	LDX.b #$14
	JSR.w CODE_17CFA2
	LDA.b #!Define_YI_SoundID36_CollectFlower
	JSL.l CODE_push_sound_queue
	STZ.w $1107
	LDA.b #$0A
	JSR.w CODE_17CFDA
	INC.w $1118
	RTS

CODE_17CF2F:
CODE_world_map_state_19_21_score_btn_shrinking:      ; DATA_world_map_state_ptr[$19]/[$21] -- score-button shrinking
	LDA.b #$0A
	JSR.w CODE_17CFDA
	LDA.w $1107
	CLC
	ADC.b #$08
	STA.w $1107
	CMP.b #$40
	BCC.b CODE_17CF44
	INC.w $1118
CODE_17CF44:
	RTS

CODE_17CF45:
CODE_world_map_state_1a_22_score_btn_growing:        ; DATA_world_map_state_ptr[$1A]/[$22] -- score-button growing
	LDA.w $1107
	SEC
	SBC.b #$08
	STA.w $1107
	BPL.b CODE_17CF56
	STZ.w $1107
	INC.w $1118
CODE_17CF56:
	LDA.b #$0A
	JSR.w CODE_17CFDA
	RTS

CODE_17CF5C:
CODE_world_map_state_23_score_btn_prepare_hide:      ; DATA_world_map_state_ptr[$23] -- prepare-to-hide scores
	JSR.w CODE_17D005
	REP.b #$20
	LDA.w DATA_17DC3B
	ORA.w #$1800
	STA.b $00
	LDX.b #$14
	LDA.w DATA_17DCEF,x
	LDY.w $1106
	BNE.b CODE_17CF80
	PHA
	LDA.b $00
	ORA.w #$0080
	STA.b $00
	PLA
	CLC
	ADC.w #$0380
CODE_17CF80:
	STA.b $0A
	CLC
	ADC.w #$0040
	STA.b $0C
	CLC
	ADC.w #$0040
	STA.b $0E
	JSR.w CODE_17DC09
	LDA.w #$1C20
	STA.b $04
	JSR.w CODE_17D52B
	SEP.b #$20
	STZ.w $1107
	INC.w $1118
	RTS

CODE_17CFA2:
	REP.b #$20
	LDA.w DATA_17DCEF,x
	LDY.w $1106
	BNE.b CODE_17CFB0
	CLC
	ADC.w #$0380
CODE_17CFB0:
	STA.b $00
	CLC
	ADC.w #$0040
	STA.b $02
	CLC
	ADC.w #$0040
	STA.b $04
	LDY.b #$00
	LDA.w #$398E
CODE_17CFC3:
	STA.b ($00),y
	STA.b ($02),y
	STA.b ($04),y
	INY
	INY
	CPY.b #$06
	BCC.b CODE_17CFC3
	LDA.w #$1C20
	STA.b $04
	JSR.w CODE_17D52B
	SEP.b #$20
	RTS

CODE_17CFDA:
	REP.b #$20
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0015
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $1107
	AND.w #$00FF
	STA.b $00
	LDA.w #$0100
	SEC
	SBC.b $00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_08DBDE>>16
	LDA.w #FXCODE_08DBDE
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSR.w CODE_17D08B
CODE_17D005:
	REP.b #$30
	LDY.w $6092
	LDA.w $1109
	AND.w #$00FF
	SEC
	SBC.w #$0010
	STA.w $6000,y
	STA.w $6010,y
	CLC
	ADC.w #$0010
	STA.w $6008,y
	STA.w $6018,y
	LDA.w $110A
	AND.w #$00FF
	SEC
	SBC.w #$0016
	STA.w $6002,y
	STA.w $600A,y
	CLC
	ADC.w #$0010
	STA.w $6012,y
	STA.w $601A,y
	STZ.b $00
	LDA.w $114E
	BNE.b CODE_17D052
	LDA.w $1118
	CMP.w #$0031
	BCS.b CODE_17D052
	LDA.w #$0600
	STA.b $00
CODE_17D052:
	LDA.w #$31CC
	ORA.b $00
	STA.w $6004,y
	INC
	INC
	STA.w $600C,y
	LDA.w #$31EC
	ORA.b $00
	STA.w $6014,y
	INC
	INC
	STA.w $601C,y
	LDA.w #$4002
	STA.w $6006,y
	STA.w $600E,y
	STA.w $6016,y
	STA.w $601E,y
	TYA
	CLC
	ADC.w #$0020
	STA.w $6092
	SEP.b #$30
	LDA.b #$20
	STA.w $1122
	RTS

CODE_17D08B:
	REP.b #$30
	LDA.w #$705800>>16
	STA.b $01
	LDY.w #$7CC0
	LDX.w #$705800
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7DC0
	LDX.w #$705A00
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7EC0
	LDX.w #$705C00
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7FC0
	LDX.w #$705E00
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	RTS

CODE_17D0C9:
	JSR.w CODE_17D08B
	RTL

DATA_17D0CD:
	dw $21AB,$21AC,$21AC,$61AB

DATA_17D0D5:
	dw $21AD,$21AE,$21AE,$61AD

DATA_17D0DD:
	dw $21AD,$218A,$218B,$61AD

DATA_17D0E5:
	dw $A1AB,$A1AC,$A1AC,$E1AB

DATA_17D0ED:
	dw $0ACE,$0AD6,$0ADE,$0AE6,$0AEE,$0AF6,$0C0E,$0C16
	dw $0C1E

DATA_17D0FF:
	dw $0B0E,$0B16,$0B1E,$0B26,$0B2E,$0B36,$0C4E,$0C56
	dw $0C5E

DATA_17D111:
	dw $0B4E,$0B56,$0B5E,$0B66,$0B6E,$0B76,$0C8E,$0C96
	dw $0C9E

DATA_17D123:
	dw $0B8E,$0B96,$0B9E,$0BA6,$0BAE,$0BB6,$0CCE,$0CD6
	dw $0CDE

CODE_17D135:
CODE_world_map_state_1b_prepare_show_scores:         ; DATA_world_map_state_ptr[$1B] -- prepare to show scores
	JSR.w CODE_17D005
CODE_17D138:
	REP.b #$30
	LDY.w #$0000
	LDA.w $1106
	AND.w #$00FF
	TAX
	BEQ.b CODE_17D149
	LDX.w #$0380
CODE_17D149:
	STX.b $0A
	LDA.w #$19BF
CODE_17D14E:
	STA.w $0A06,x
	STA.w $0B06,x
	STA.w $0C06,x
	STA.w $0C86,x
	INX
	INX
	INY
	CPY.w #$0080
	BCC.b CODE_17D14E
	STZ.b $0E
CODE_17D164:
	LDY.b $0E
	LDA.w DATA_17D0ED,y
	STA.b $00
	LDA.w DATA_17D0FF,y
	STA.b $02
	LDA.w DATA_17D111,y
	STA.b $04
	LDA.w DATA_17D123,y
	STA.b $06
	LDA.w #$0C00
	STA.b $0C
	LDX.w !RAM_YI_Level_CurrentWorldLo
	TYA
	LSR
	CLC
	ADC.w DATA_map_world_tile_base_w,x
	TAY
	LDA.w !RAM_YI_Map_LevelHighScores,y
	AND.w #$00FF
	CMP.w #$001E
	BCS.b CODE_17D1B0
	LDA.b $0E
	CMP.w #$0010
	BNE.b CODE_17D1A3
	LDA.w !RAM_YI_Map_LevelHighScores,y
	AND.w #$00FF
	BEQ.b CODE_17D1B0
CODE_17D1A3:
	LDA.w !RAM_YI_Map_LevelClearFlags,y
	AND.w #$007F
	BEQ.b CODE_17D1B0
	LDA.w #$1000
	STA.b $0C
CODE_17D1B0:
	LDX.w #$0000
	LDY.b $0A
CODE_17D1B5:
	LDA.w DATA_17D0CD,x
	ORA.b $0C
	STA.b ($00),y
	LDA.w DATA_17D0D5,x
	ORA.b $0C
	STA.b ($02),y
	LDA.w DATA_17D0DD,x
	ORA.b $0C
	STA.b ($04),y
	LDA.w DATA_17D0E5,x
	ORA.b $0C
	STA.b ($06),y
	INY
	INY
	INX
	INX
	CPX.w #$0008
	BCC.b CODE_17D1B5
	INC.b $0E
	INC.b $0E
	LDA.b $0E
	CMP.w #$0012
	BCS.b CODE_17D1E8
	JMP.w CODE_17D164

CODE_17D1E8:
	SEP.b #$10
	LDA.w #$1E20
	STA.b $04
	LDA.w $1106
	EOR.w #$0001
	STA.w $1106
	JSR.w CODE_17D52B
	LDA.w $1106
	EOR.w #$0001
	STA.w $1106
	SEP.b #$20
	LDA.b #$04
	STA.b !RAM_YI_Global_Layer2XPosLo
	LDA.b #$84
	STA.b !RAM_YI_Global_Layer2YPosLo
	STZ.w $111F
	STZ.w $1120
	STZ.w $1121
	LDA.b #$00
	STA.l $7E5C19
	INC.w $1118
	RTS

CODE_17D221:
CODE_world_map_state_1c_set_next_level_tile:         ; DATA_world_map_state_ptr[$1C] -- set next level tile
	JSR.w CODE_17D005
CODE_17D224:
	JSR.w CODE_17D233
	LDA.b #!Define_YI_SoundID36_CollectFlower
	JSL.l CODE_push_sound_queue
	INC.w $1118
	JMP.w CODE_17D2BE

CODE_17D233:
	LDA.w $111F
	ASL
	TAX
	REP.b #$20
	LDA.w DATA_17DCEF,x
	LDY.w $1106
	BNE.b CODE_17D246
	CLC
	ADC.w #$0380
CODE_17D246:
	STA.b $00
	CLC
	ADC.w #$0040
	STA.b $02
	CLC
	ADC.w #$0040
	STA.b $04
	LDY.b #$00
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_17C9EA,x
	STA.b $06
CODE_17D25E:
	LDA.w $111F
	AND.w #$00FF
	CMP.w #$0003
	BEQ.b CODE_17D273
	CMP.w #$0007
	BEQ.b CODE_17D273
	JSR.w CODE_17D287
	BRA.b CODE_17D276

CODE_17D273:
	JSR.w CODE_17D29D
CODE_17D276:
	INY
	INY
	CPY.b #$06
	BCC.b CODE_17D25E
	LDA.w #$1C20
	STA.b $04
	JSR.w CODE_17D52B
	SEP.b #$20
	RTS

CODE_17D287:
	LDA.w DATA_17C9C6,y
	ORA.b $06
	STA.b ($00),y
	LDA.w DATA_17C9CC,y
	ORA.b $06
	STA.b ($02),y
	LDA.w DATA_17C9D2,y
	ORA.b $06
	STA.b ($04),y
	RTS

CODE_17D29D:
	LDA.w DATA_17C9D8,y
	ORA.b $06
	STA.b ($00),y
	LDA.w DATA_17C9DE,y
	ORA.b $06
	STA.b ($02),y
	LDA.w DATA_17C9E4,y
	ORA.b $06
	STA.b ($04),y
	RTS

CODE_17D2B3:
	PHB
	PHK
	PLB
	JSR.w CODE_17D233
	PLB
	RTL

CODE_17D2BB:
CODE_world_map_state_1d_flip_level_icon:             ; DATA_world_map_state_ptr[$1D] -- flipping level icon side
	JSR.w CODE_17D005
CODE_17D2BE:
	JSR.w CODE_17D340
	LDA.w $1120
	CLC
	ADC.b #$10
	STA.w $1120
	JSR.w CODE_17D780
	LDA.w $1120
	BPL.b CODE_17D2D8
	INC.w $1121
	INC.w $1118
CODE_17D2D8:
	RTS

CODE_17D2D9:
CODE_world_map_state_1e_flip_score_icon:             ; DATA_world_map_state_ptr[$1E] -- flipping score icon side
	JSR.w CODE_17D005
	LDA.w $1120
	SEC
	SBC.b #$10
	STA.w $1120
	BMI.b CODE_17D2EC
	JSR.w CODE_17D340
	BRA.b CODE_17D322

CODE_17D2EC:
	JSR.w CODE_17D3E4
	STZ.w $1120
	LDA.w !RAM_YI_Level_CurrentWorldLo
	LSR
	TAX
CODE_17D2F7:
	INC.w $111F
	LDA.w $111F
	CMP.b #$09
	BCS.b CODE_17D31A
	CLC
	ADC.w DATA_map_world_tile_base_b,x
	TAY
	LDA.w $030F,y
	BEQ.b CODE_17D2F7
	CMP.b #$F0
	BEQ.b CODE_17D31A
	STZ.w $1121
	DEC.w $1118
	DEC.w $1118
	BRA.b CODE_17D325

CODE_17D31A:
	DEC.w $111F
	INC.w $1118
	BRA.b CODE_17D325

CODE_17D322:
	JSR.w CODE_17D780
CODE_17D325:
	RTS

CODE_17D326:
	LDA.w $1120
	SEC
	SBC.b #$10
	STA.w $1120
	BMI.b CODE_17D336
	JSR.w CODE_17D340
	BRA.b CODE_17D33C

CODE_17D336:
	JSR.w CODE_17D3E4
	INC.w $1118
CODE_17D33C:
	JSR.w CODE_17D780
	RTS

CODE_17D340:
	REP.b #$20
	LDY.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_17DBA3,y
	STA.b $00
	LDA.w !RAM_YI_Level_CurrentWorldLo
	LSR
	TAY
	PHY
	LDA.w DATA_map_world_tile_base_b,y
	CLC
	ADC.w $111F
	AND.w #$00FF
	TAX
	LDA.w $030F,x
	DEC
	AND.w #$007F
	TAY
	LDA.b ($00),y
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $1121
	AND.w #$00FF
	BEQ.b CODE_17D37C
	LDA.w #$0015
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$6490
CODE_17D37C:
	STA.w $6000
	LDA.w $1120
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	PLY
	LDA.w $030F,x
	CLC
	ADC.w DATA_map_world_tile_base_b,y
	DEC
	AND.w #$007F
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDX.b #FXCODE_08DE98>>16
	LDA.w #FXCODE_08DE98
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSR.w CODE_17E683
	SEP.b #$20
	RTS

CODE_17D3AC:
	PHB
	PHK
	PLB
	JSR.w CODE_17D340
	PLB
	RTL

DATA_17D3B4:
	dw $21A8,$21A0,$21A2,$21A2,$21A3,$21A4,$21A5,$21A6
	dw $21A7,$E1B5,$21A9,$21AA

DATA_17D3CC:
	dw $21B8,$21B0,$21B1,$21B2,$21B3,$21B4,$21B5,$21B6
	dw $21B7,$E1A5,$21B9,$21BA

CODE_17D3E4:
	LDY.w $111F
	REP.b #$20
	LDX.w !RAM_YI_Level_CurrentWorldLo
	TYA
	CLC
	ADC.w DATA_map_world_tile_base_w,x
	AND.w #$00FF
	STA.b $10
	TAY
	LDA.w #$000A
	STA.b $00
	INC
	STA.b $02
	LDA.w !RAM_YI_Map_LevelHighScores,y
	AND.w #$00FF
	CMP.w #$0064
	BCS.b CODE_17D41A
	STZ.b $00
CODE_17D40C:
	CMP.w #$000A
	BCC.b CODE_17D418
	SBC.w #$000A
	INC.b $00
	BRA.b CODE_17D40C

CODE_17D418:
	STA.b $02
CODE_17D41A:
	LDA.w $111F
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_17DCEF,y
	PHA
	LDX.w $1106
	BEQ.b CODE_17D42F
	CLC
	ADC.w #$0380
CODE_17D42F:
	CLC
	ADC.w #$0042
	STA.b $0A
	CLC
	ADC.w #$0040
	STA.b $0C
	LDA.w #$0C00
	STA.b $04
	LDY.b $10
	LDA.w !RAM_YI_Map_LevelHighScores,y
	AND.w #$00FF
	CMP.w #$001E
	BCS.b CODE_17D452
	LDA.w #$1000
	STA.b $04
CODE_17D452:
	ASL.b $00
	ASL.b $02
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_map_world_tile_base_w,x
	STA.b $08
	LDY.b #$00
	LDA.b $00
	BNE.b CODE_17D49C
	LDA.w $111F
	AND.w #$00FF
	CLC
	ADC.b $08
	TAX
	LDA.w $111F
	AND.w #$00FF
	CMP.w #$0008
	BNE.b CODE_17D481
	LDA.w !RAM_YI_Map_LevelHighScores,x
	AND.w #$00FF
	BEQ.b CODE_17D492
CODE_17D481:
	LDA.w !RAM_YI_Map_LevelClearFlags,x
	AND.w #$007F
	BEQ.b CODE_17D492
	LDA.w #$21AE
	ORA.b $04
	STA.b ($0A)
	STA.b ($0C)
CODE_17D492:
	INC.b $0A
	INC.b $0A
	INC.b $0C
	INC.b $0C
	INY
	INY
CODE_17D49C:
	LDA.w $111F
	AND.w #$00FF
	CLC
	ADC.b $08
	TAX
	LDA.w $111F
	AND.w #$00FF
	CMP.w #$0008
	BNE.b CODE_17D4B9
	LDA.w !RAM_YI_Map_LevelHighScores,x
	AND.w #$00FF
	BEQ.b CODE_17D4D1
CODE_17D4B9:
	LDA.w !RAM_YI_Map_LevelClearFlags,x
	AND.w #$007F
	BEQ.b CODE_17D4D1
	LDX.b $00,y
	LDA.w DATA_17D3B4,x
	ORA.b $04
	STA.b ($0A)
	LDA.w DATA_17D3CC,x
	ORA.b $04
	STA.b ($0C)
CODE_17D4D1:
	CPY.b #$02
	BCC.b CODE_17D492
	LDA.w #$1E20
	STA.b $04
	LDA.w $1106
	EOR.w #$0001
	STA.w $1106
	JSR.w CODE_17D52B
	LDA.w $1106
	EOR.w #$0001
	STA.w $1106
	PLA
	LDX.w $1106
	BNE.b CODE_17D4F9
	CLC
	ADC.w #$0380
CODE_17D4F9:
	STA.b $00
	CLC
	ADC.w #$0040
	STA.b $02
	CLC
	ADC.w #$0040
	STA.b $04
	LDY.b #$00
	LDA.w #$21BF
CODE_17D50C:
	STA.b ($00),y
	STA.b ($02),y
	STA.b ($04),y
	INY
	INY
	CPY.b #$06
	BCC.b CODE_17D50C
	LDA.w #$1C20
	STA.b $04
	JSR.w CODE_17D52B
	SEP.b #$20
	RTS

CODE_17D523:
	PHB
	PHK
	PLB
	JSR.w CODE_17D3E4
	PLB
	RTL

CODE_17D52B:
	REP.b #$10
	LDA.w #$0000
	STA.b $01
	LDA.w $1106
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_17CC8F,y
	TAX
	LDY.b $04
	LDA.w #$0380
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$10
	RTS

DATA_17D54A:
	dw $0C00,$1000

CODE_17D54E:
	LDA.b $30
	AND.b #$04
	LSR
	TAX
CODE_17D554:
	REP.b #$20
	STZ.b $0E
	LDA.w $1106
	EOR.w #$0001
	STA.w $1106
	BNE.b CODE_17D568
	LDA.w #$0380
	STA.b $0E
CODE_17D568:
	LDA.w DATA_17D54A,x
	STA.b $10
	LDY.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_map_world_tile_base_w,y
	TAY
	LDX.b #$00
CODE_17D576:
	LDA.w !RAM_YI_Map_LevelHighScores,y
	AND.w #$00FF
	CMP.w #$0064
	BNE.b CODE_17D584
	JSR.w CODE_17D59E
CODE_17D584:
	INY
	INX
	INX
	CPX.b #$12
	BNE.b CODE_17D576
	LDA.w #$1E20
	STA.b $04
	JSR.w CODE_17D52B
	SEP.b #$20
	LDA.w $1106
	EOR.b #$01
	STA.w $1106
	RTS

CODE_17D59E:
	PHY
	LDA.w DATA_17DCEF,x
	CLC
	ADC.b $0E
	STA.b $00
	CLC
	ADC.w #$0040
	STA.b $02
	CLC
	ADC.w #$0040
	STA.b $04
	CLC
	ADC.w #$0040
	STA.b $06
	LDY.b #$00
CODE_17D5BB:
	LDA.b ($00),y
	AND.w #$E3FF
	ORA.b $10
	STA.b ($00),y
	LDA.b ($02),y
	AND.w #$E3FF
	ORA.b $10
	STA.b ($02),y
	LDA.b ($04),y
	AND.w #$E3FF
	ORA.b $10
	STA.b ($04),y
	LDA.b ($06),y
	AND.w #$E3FF
	ORA.b $10
	STA.b ($06),y
	INY
	INY
	CPY.b #$08
	BCC.b CODE_17D5BB
	PLY
	RTS

CODE_17D5E7:
CODE_world_map_state_1f_wait_second_press:           ; DATA_world_map_state_ptr[$1F] -- waiting for second score-button press
	JSR.w CODE_17D005
	JSR.w CODE_17D54E
	LDA.b $37
	AND.w #$05C0
	SEC
	AND.w #$F0D0
	PHP
	INC.w $1118
	LDX.b #$00
	JSR.w CODE_17D554
	RTS

CODE_17D600:
CODE_world_map_state_24_controller_cfg_a:            ; DATA_world_map_state_ptr[$24] -- controller-config substate A
	JSR.w CODE_17D005
	STZ.w $111F
CODE_17D606:
	INC.w $1118
	STZ.w $1120
	JSR.w CODE_17D729
	JSR.w CODE_17D780
	RTS

CODE_17D613:
CODE_world_map_state_25_controller_cfg_b:            ; DATA_world_map_state_ptr[$25] -- controller-config substate B
	JSR.w CODE_17D005
CODE_17D616:
	JSR.w CODE_17D340
	JSR.w CODE_17D780
	LDA.w $1120
	CLC
	ADC.b #$10
	STA.w $1120
	BPL.b CODE_17D62D
	STZ.w $1121
	INC.w $1118
CODE_17D62D:
	RTS

CODE_17D62E:
CODE_world_map_state_26_controller_cfg_c:            ; DATA_world_map_state_ptr[$26] -- controller-config substate C
	JSR.w CODE_17D005
CODE_17D631:
	JSR.w CODE_17D780
	LDA.w $1120
	SEC
	SBC.b #$10
	STA.w $1120
	BPL.b CODE_17D644
	INC.w $1118
	BRA.b CODE_17D647

CODE_17D644:
	JSR.w CODE_17D340
CODE_17D647:
	RTS

CODE_17D648:
CODE_world_map_state_27_controller_cfg_d:            ; DATA_world_map_state_ptr[$27] -- controller-config substate D
	JSR.w CODE_17D005
	JSR.w CODE_17D6C4
	STZ.w $1120
	LDA.w !RAM_YI_Level_CurrentWorldLo
	LSR
	TAX
CODE_17D656:
	INC.w $111F
	LDA.w $111F
	CMP.b #$09
	BCS.b CODE_17D682
	CLC
	ADC.w DATA_map_world_tile_base_b,x
	TAY
	LDA.w $030F,y
	BEQ.b CODE_17D656
	CMP.b #$F0
	BEQ.b CODE_17D682
	INC.w $1121
	DEC.w $1118
	DEC.w $1118
	JSR.w CODE_17D340
	JSR.w CODE_17D729
	JSR.w CODE_17D780
	BRA.b CODE_17D691

CODE_17D682:
	LDA.b #$80
	STA.b !RAM_YI_Global_Layer2YPosLo
	STZ.b !RAM_YI_Global_Layer2XPosLo
	STZ.w $1118
	LDA.b #$32
	STA.l $7E5C19
CODE_17D691:
	RTS

CODE_17D692:
	JSR.w CODE_17D6C4
	STZ.w $1120
	LDA.b #$80
	STA.b !RAM_YI_Global_Layer2YPosLo
	STZ.b !RAM_YI_Global_Layer2XPosLo
	INC.w $1118
	RTS

CODE_17D6A2:
	PHP
	REP.b #$30
	PHX
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_map_world_tile_base_w,x
	CLC
	ADC.b $10
	TAX
	LDA.w !RAM_YI_Map_LevelClearFlags,x
	AND.w #$0080
	BEQ.b CODE_17D6BB
	LDA.w #$1400
CODE_17D6BB:
	STA.b $10
	PLX
	PLP
	RTS

CODE_17D6C0:
	JSR.w CODE_17D6A2
	RTL

CODE_17D6C4:
	REP.b #$20
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_17DC43,x
	STA.b $02
	LDA.w $111F
	AND.w #$00FF
	CLC
	ADC.w DATA_map_world_tile_base_w,x
	TAY
	LDA.w $111F
	ASL
	TAX
	PHX
	LDA.w $030F,y
	DEC
	AND.w #$007F
	STA.b $10
	ASL
	TAY
	JSR.w CODE_17D6A2
	LDA.b $10
	BNE.b CODE_17D6F3
	LDA.b ($02),y
CODE_17D6F3:
	ORA.w DATA_17DC27,y
	LDX.w $1106
	BNE.b CODE_17D6FE
	ORA.w #$0080
CODE_17D6FE:
	STA.b $00
	PLX
	LDA.w DATA_17DCEF,x
	LDX.w $1106
	BNE.b CODE_17D70D
	CLC
	ADC.w #$0380
CODE_17D70D:
	STA.b $0A
	CLC
	ADC.w #$0040
	STA.b $0C
	CLC
	ADC.w #$0040
	STA.b $0E
	JSR.w CODE_17DC09
	LDA.w #$1C20
	STA.b $04
	JSR.w CODE_17D52B
	SEP.b #$20
	RTS

CODE_17D729:
	REP.b #$20
	LDA.w $111F
	ASL
	TAY
	LDA.w DATA_17DCEF,y
	LDX.w $1106
	BNE.b CODE_17D73C
	CLC
	ADC.w #$0380
CODE_17D73C:
	STA.b $00
	CLC
	ADC.w #$0040
	STA.b $02
	CLC
	ADC.w #$0040
	STA.b $04
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_17C9EA,x
	STA.b $06
	LDY.b #$00
CODE_17D754:
	LDA.w $111F
	CMP.w #$0003
	BEQ.b CODE_17D766
	CMP.w #$0007
	BEQ.b CODE_17D766
	JSR.w CODE_17D287
	BRA.b CODE_17D769

CODE_17D766:
	JSR.w CODE_17D29D
CODE_17D769:
	INY
	INY
	CPY.b #$06
	BCC.b CODE_17D754
	LDA.w #$1C20
	STA.b $04
	JSR.w CODE_17D52B
	SEP.b #$20
	LDA.b #!Define_YI_SoundID36_CollectFlower
	JSL.l CODE_push_sound_queue
	RTS

CODE_17D780:
	REP.b #$30
	LDX.w $6092
	LDA.w $111F
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_17E257,y
	AND.w #$00FF
	SEC
	SBC.w #$0010
	STA.w $6000,x
	STA.w $6010,x
	CLC
	ADC.w #$0010
	STA.w $6008,x
	STA.w $6018,x
	LDA.w DATA_17E257+$01,y
	AND.w #$00FF
	SEC
	SBC.w #$0016
	STA.w $6002,x
	STA.w $600A,x
	CLC
	ADC.w #$0010
	STA.w $6012,x
	STA.w $601A,x
	STZ.b $02
	LDY.w !RAM_YI_Level_CurrentWorldLo
	PHY
	LDA.w $111F
	AND.w #$00FF
	CLC
	ADC.w DATA_map_world_tile_base_w,y
	TAY
	LDA.w !RAM_YI_Map_LevelHighScores,y
	AND.w #$00FF
	CMP.w #$001E
	BCS.b CODE_17D7FA
	LDA.w $111F
	AND.w #$00FF
	CMP.w #$0008
	BNE.b CODE_17D7F0
	LDA.w !RAM_YI_Map_LevelHighScores,y
	AND.w #$00FF
	BEQ.b CODE_17D7FA
CODE_17D7F0:
	LDA.w !RAM_YI_Map_LevelClearFlags,y
	AND.w #$007F
	BEQ.b CODE_17D7FA
	INC.b $02
CODE_17D7FA:
	PLY
	LDA.w DATA_17DC43,y
	STA.b $00
	LDY.w !RAM_YI_Level_CurrentWorldLo
	LDA.w $111F
	AND.w #$00FF
	CLC
	ADC.w DATA_map_world_tile_base_w,y
	TAY
	LDA.w $030F,y
	DEC
	AND.w #$007F
	STA.b $10
	ASL
	TAY
	LDA.w $1121
	AND.w #$00FF
	BEQ.b CODE_17D830
	PHX
	LDX.w #$31E0
	LDA.b $02
	BEQ.b CODE_17D82C
	LDX.w #$33E0
CODE_17D82C:
	TXA
	PLX
	BRA.b CODE_17D841

CODE_17D830:
	JSR.w CODE_17D6A2
	LDA.b $10
	BNE.b CODE_17D839
	LDA.b ($00),y
CODE_17D839:
	LSR
	SEC
	SBC.w #$0600
	ORA.w #$31E0
CODE_17D841:
	STA.w $6004,x
	INC
	INC
	STA.w $600C,x
	INC
	INC
	STA.w $6014,x
	INC
	INC
	STA.w $601C,x
	LDA.w #$4002
	STA.w $6006,x
	STA.w $600E,x
	STA.w $6016,x
	STA.w $601E,x
	TXA
	CLC
	ADC.w #$0020
	STA.w $6092
	SEP.b #$30
	RTS

DATA_17D86D:
	dw CODE_17D138
	dw CODE_17D224
	dw CODE_17D2BE
	dw CODE_17D326
	dw CODE_17D606
	dw CODE_17D616
	dw CODE_17D631
	dw CODE_17D692

CODE_17D87D:
	PHB
	PHK
	PLB
	JSR.w (DATA_17D86D,x)
	PLB
	RTL

CODE_17D885:
	LDX.b #$00
	TXY
CODE_17D888:
	REP.b #$20
	LDA.w !RAM_YI_Map_LevelClearFlags,y
	ORA.w $0224,y
	ORA.w $0226,y
	ORA.w $0228,y
	STA.b $00
	SEP.b #$20
	LDA.b $00
	ORA.b $01
	STA.w $0010,x
	TYA
	CLC
	ADC.b #$0C
	TAY
	INX
	CPX.b #$07
	BCC.b CODE_17D888
	LDX.w $1115
	INC.w $0010,x
	REP.b #$30
	LDX.w #$0000
	LDA.w #$19BF
CODE_17D8B9:
	STA.w $0A46,x
	STA.w $0DC6,x
	INX
	INX
	CPX.w #$0040
	BCC.b CODE_17D8B9
	STZ.w $1146
	LDX.w #$0000
	TXY
CODE_17D8CD:
	LDA.w $0010,y
	AND.w #$00FF
	BEQ.b CODE_17D8FC
	INC.w $1146
	LDA.w DATA_17DD33,x
	STA.w $0A4E,x
	STA.w $0DCE,x
	LDA.w DATA_17DD33+$02,x
	STA.w $0A50,x
	STA.w $0DD0,x
	LDA.w DATA_17DD33+$04,x
	STA.w $0A52,x
	STA.w $0DD2,x
	LDA.w DATA_17DD33+$06,x
	STA.w $0A54,x
	STA.w $0DD4,x
CODE_17D8FC:
	INY
	TXA
	CLC
	ADC.w #$0008
	TAX
	CPX.w #$0030
	BNE.b CODE_17D8CD
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_17DD27,x
	STA.b $00
	LDA.w DATA_17C9EA,x
	STA.b $02
	LDX.w #$0000
	TXY
	LDA.w $1106
	AND.w #$0001
	BEQ.b CODE_17D924
	LDX.w #$0380
CODE_17D924:
	STX.b $10
CODE_17D926:
	LDA.b ($00),y
	STA.w $0A86,x
	LDA.w DATA_17DDE3,y
	ORA.b $02
	STA.w $0D06,x
	INX
	INX
	INY
	INY
	CPY.w #$0040
	BCC.b CODE_17D926
	LDA.w #$0009
	STA.b $0E
CODE_17D941:
	LDY.w #$0000
CODE_17D944:
	LDA.w DATA_17DDA3,y
	ORA.b $02
	STA.w $0A86,x
	INX
	INX
	INY
	INY
	CPY.w #$0040
	BCC.b CODE_17D944
	DEC.b $0E
	BNE.b CODE_17D941
	LDX.b $10
	LDY.w #$0000
CODE_17D95E:
	LDA.w DATA_17DF63,y
	STA.w $0BEE,x
	LDA.w DATA_17DF75,y
	STA.w $0C2E,x
	STA.w $0C6E,x
	STA.w $0CAE,x
	LDA.w DATA_17DF87,y
	STA.w $0CEE,x
	INX
	INX
	INY
	INY
	CPY.w #$0012
	BCC.b CODE_17D95E
	LDA.w #$21F9
	ORA.b $02
	STA.w $0B14
	STA.w $0E94
	STA.w $0B1C
	STA.w $0E9C
	STA.w $0B34
	STA.w $0EB4
	STA.w $0B3C
	STA.w $0EBC
	STA.w $0C4C
	STA.w $0FCC
	LDX.w #$0000
	LDY.w #DATA_17DD07
	LDA.w $1106
	AND.w #$0001
	BEQ.b CODE_17D9B3
	LDY.w #DATA_17DD17
CODE_17D9B3:
	STY.b $00
	LDY.w !RAM_YI_Level_CurrentWorldLo
CODE_17D9B8:
	LDA.b ($00)
	STA.b $04
	INC
	INC
	STA.b $06
	INC
	INC
	STA.b $08
	LDA.w DATA_17DCDF,y
	ORA.b $02
	STA.b ($04)
	LDA.w #$218D
	ORA.b $02
	STA.b ($06)
	LDA.w DATA_17DCDF,x
	ORA.b $02
	STA.b ($08)
	INC.b $00
	INC.b $00
	INX
	INX
	CPX.w #$0010
	BCC.b CODE_17D9B8
	LDX.b $10
	LDY.w #$0000
CODE_17D9E9:
	LDA.w !RAM_YI_Level_CurrentWorldLo
	CMP.w #!Define_YI_WorldID_World3
	BEQ.b CODE_17D9FB
	CMP.w #!Define_YI_WorldID_World4
	BEQ.b CODE_17DA00
	LDA.w DATA_17DFAB,y
	BRA.b CODE_17DA03

CODE_17D9FB:
	LDA.w DATA_17DFBF,y
	BRA.b CODE_17DA03

CODE_17DA00:
	LDA.w DATA_17DFC9,y
CODE_17DA03:
	ORA.b $02
	STA.w $0AA4,x
	LDA.w DATA_17DFB5,y
	ORA.b $02
	STA.w $0BD4,x
	LDA.w DATA_17DFD3,y
	ORA.b $02
	STA.w $0AE4,x
	STA.w $0C14,x
	LDA.w DATA_17DFDD,y
	ORA.b $02
	STA.w $0B24,x
	LDA.w DATA_17DFE7,y
	ORA.b $02
	STA.w $0C54,x
	LDA.w DATA_17DFF1,y
	ORA.b $02
	STA.w $0B64,x
	STA.w $0C94,x
	LDA.w DATA_17DFFB,y
	ORA.b $02
	STA.w $0BA4,x
	LDA.w DATA_17E005,y
	ORA.b $02
	STA.w $0CD4,x
	INX
	INX
	INY
	INY
	CPY.w #$000A
	BCC.b CODE_17D9E9
	LDX.b $10
	LDA.w !RAM_YI_Level_CurrentWorldLo
	LSR
	ORA.w #$21E0
	ORA.b $02
	STA.w $0BA6,x
	STA.w $0CD6,x
	LDX.b $10
	LDY.w #$0000
CODE_17DA65:
	LDA.w DATA_17DF99,y
	ORA.b $02
	STA.w $0C1E,x
	STA.w $0C26,x
	LDA.w DATA_17DF9F,y
	ORA.b $02
	STA.w $0C5E,x
	STA.w $0C66,x
	LDA.w DATA_17DFA5,y
	ORA.b $02
	STA.w $0C9E,x
	STA.w $0CA6,x
	INX
	INX
	INY
	INY
	CPY.w #$0006
	BCC.b CODE_17DA65
	LDA.w !RAM_YI_Global_CurrentGameMode
	CMP.w #!Define_YI_GameMode23
	BCS.b CODE_17DAD2
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.l DATA_map_world_tile_base_w,x
	TAX
	STA.b $02
	LDA.w $0317,x
	CMP.w #$0A09
	BEQ.b CODE_17DAD2
	LDY.w #$0008
	STZ.b $00
CODE_17DAAE:
	LDA.w !RAM_YI_Map_LevelHighScores,x
	AND.w #$00FF
	CLC
	ADC.b $00
	STA.b $00
	INX
	DEY
	BNE.b CODE_17DAAE
	LDA.b $00
	CMP.w #$0320
	BCC.b CODE_17DAD2
	LDX.b $02
	LDA.w #$0A09
	STA.w $0317,x
	LDA.w #$0101
	STA.w $022A,x
CODE_17DAD2:
	SEP.b #$10
	LDA.w !RAM_YI_Level_CurrentWorldLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	TAX
	LDA.w #DATA_17DBAF>>16
	STA.w $6000
	LDA.w DATA_17DBA3,x
	STA.w $6002
	LDX.b #FXCODE_08D995>>16
	LDA.w #FXCODE_08D995
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$0015
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.w !EXRAM_YI_Global_EggThrowSetting|!EXRAMBankMirror
	LDA.w DATA_17DC03,x
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_08E0FA>>16
	LDA.w #FXCODE_08E0FA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	JSR.w CODE_17C946
	LDA.w !RAM_YI_Level_CurrentWorldLo
	LSR
	TAX
	LDA.w DATA_map_world_tile_base_b,x
	TAY
	REP.b #$20
	LDA.w $0317,y
	CMP.w #$0A09
	BEQ.b CODE_17DB26
	LDA.w #$F0F0
	STA.w $0317,y
CODE_17DB26:
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_17DC43,x
	STA.b $04
	LDA.w #$000C
	STA.b $08
	STZ.b $06
CODE_17DB35:
	LDA.w $030F,y
	AND.w #$00FF
	CMP.w #$00F0
	BEQ.b CODE_17DB8D
	AND.w #$007F
	BEQ.b CODE_17DB8D
	DEC
	STA.b $10
	ASL
	TAX
	PHY
	LDA.w DATA_17DC27,x
	LDY.w $1106
	BEQ.b CODE_17DB56
	ORA.w #$0080
CODE_17DB56:
	STA.b $00
	LDA.b $10
	CMP.w #$0008
	BCS.b CODE_17DB66
	JSR.w CODE_17D6A2
	LDA.b $10
	BNE.b CODE_17DB69
CODE_17DB66:
	TXY
	LDA.b ($04),y
CODE_17DB69:
	ORA.b $00
	STA.b $00
	LDX.b $06
	LDA.w DATA_17DCEF,x
	LDY.w $1106
	BEQ.b CODE_17DB7B
	CLC
	ADC.w #$0380
CODE_17DB7B:
	STA.b $0A
	CLC
	ADC.w #$0040
	STA.b $0C
	CLC
	ADC.w #$0040
	STA.b $0E
	JSR.w CODE_17DC09
	PLY
CODE_17DB8D:
	INC.b $06
	INC.b $06
	INY
	DEC.b $08
	BNE.b CODE_17DB35
	SEP.b #$20
	LDA.w $1106
	EOR.b #$01
	AND.b #$01
	STA.w $1106
	RTS

DATA_17DBA3:
	dw DATA_17DBAF,DATA_17DBBB,DATA_17DBC7,DATA_17DBD3,DATA_17DBDF,DATA_17DBEB

DATA_17DBAF:
	db $11,$11,$11,$11,$11,$11,$11,$11,$11,$15,$15,$15

DATA_17DBBB:
	db $11,$11,$11,$11,$11,$11,$11,$11,$11,$15,$15,$15

DATA_17DBC7:
	db $11,$11,$11,$11,$11,$11,$11,$11,$11,$15,$15,$15

DATA_17DBD3:
	db $11,$11,$11,$11,$11,$11,$11,$11,$11,$15,$15,$15

DATA_17DBDF:
	db $15,$15,$15,$15,$15,$15,$15,$15,$15,$15,$15,$15

DATA_17DBEB:
	db $15,$15,$15,$15,$15,$15,$15,$15,$15,$15,$15,$15

DATA_17DBF7:
	db $11,$11,$11,$11,$11,$11,$11,$11,$11,$11,$11,$15

DATA_17DC03:
	dw FXDATA_530000+$643C,FXDATA_530000+$6458,FXDATA_530000+$6474

CODE_17DC09:
	LDY.b #$00
CODE_17DC0B:
	TYA
	LSR
	CLC
	ADC.b $00
	STA.b ($0A),y
	INC
	INC
	INC
	STA.b ($0C),y
	INC
	INC
	INC
	STA.b ($0E),y
	INY
	INY
	CPY.b #$06
	BCC.b CODE_17DC0B
	RTS

CODE_17DC23:
	JSR.w CODE_17DC09
	RTL

DATA_17DC27:
	dw $2000,$2009,$2012,$201B,$2024,$202D,$2036,$203F

DATA_17DC37:
	dw $2048

DATA_17DC39:
	dw $2051

DATA_17DC3B:
	dw $205A,$2070,$206C,$2075

DATA_17DC43:
	dw DATA_17DC4F,DATA_17DC67,DATA_17DC7F,DATA_17DC97,DATA_17DCAF,DATA_17DCC7

DATA_17DC4F:
	dw $0C00,$1000,$1000,$0C00,$0C00,$0C00,$1000,$1000
	dw $0C00,$0C00,$1800,$1800

DATA_17DC67:
	dw $0C00,$1000,$1000,$1000,$0C00,$1000,$0C00,$0C00
	dw $0C00,$0C00,$1800,$1800

DATA_17DC7F:
	dw $1000,$0C00,$0C00,$0C00,$0C00,$0C00,$1000,$1000
	dw $0C00,$0C00,$1800,$1800

DATA_17DC97:
	dw $0C00,$1000,$0C00,$0C00,$1000,$0C00,$0C00,$0C00
	dw $0C00,$0C00,$1800,$1800

DATA_17DCAF:
	dw $0C00,$1000,$0C00,$1000,$0C00,$0C00,$1000,$0C00
	dw $0C00,$0C00,$1800,$1800

DATA_17DCC7:
	dw $0C00,$0C00,$1000,$1000,$0C00,$0C00,$1000,$0C00
	dw $0C00,$0C00,$1800,$1800

DATA_17DCDF:
	dw $2190,$2191,$2192,$2193,$2194,$2195,$2196,$2197

DATA_17DCEF:
	dw $0ACE,$0AD6,$0ADE,$0AE6,$0AEE,$0AF6,$0C0E,$0C16
	dw $0C1E,$0C26,$0C30,$0C38

DATA_17DD07:
	dw $0B8E,$0B96,$0B9E,$0BA6,$0BAE,$0BB6,$0CCE,$0CD6

DATA_17DD17:
	dw $0F0E,$0F16,$0F1E,$0F26,$0F2E,$0F36,$104E,$1056

DATA_17DD27:
	dw DATA_17DD63,DATA_17DE23,DATA_17DE63,DATA_17DEA3,DATA_17DEE3,DATA_17DF23

DATA_17DD33:
	dw $2D86,$2D8F,$2D80,$6D86,$3186,$318F,$3181,$7186
	dw $3586,$358F,$3582,$7586,$2186,$218F,$2183,$6186
	dw $2586,$258F,$2584,$6586,$2986,$298F,$2985,$6986

DATA_17DD63:
	dw $39BF,$39BF,$AD99,$2D8F,$2D8E,$2D8E,$2D8E,$2D8E
	dw $2D8F,$2D8F,$2D8F,$2D8F,$2D8F,$2D8F,$2D8F,$2DE2
	dw $2DE3,$2DE3,$2DE3,$6DE2,$2D8F,$2D8F,$2D8F,$2D8F
	dw $2D8F,$2D8F,$2D8F,$2D8F,$2D8F,$ED99,$39BF,$39BF

DATA_17DDA3:
	dw $39BF,$39BF,$2198,$218E,$218E,$218E,$218E,$218E
	dw $218E,$218E,$218E,$218E,$218E,$218E,$218E,$218E
	dw $218E,$218E,$218E,$218E,$218E,$218E,$218E,$218E
	dw $218E,$218E,$218E,$218E,$218E,$6198,$39BF,$39BF

DATA_17DDE3:
	dw $39BF,$39BF,$21A1,$21AF,$21AF,$21AF,$21AF,$21AF
	dw $21AF,$21AF,$21AF,$21AF,$21AF,$21AF,$21AF,$21AF
	dw $21AF,$21AF,$21AF,$21AF,$21AF,$21AF,$21AF,$21AF
	dw $21AF,$21AF,$21AF,$21AF,$21AF,$61A1,$39BF,$39BF

DATA_17DE23:
	dw $39BF,$39BF,$B199,$318F,$318F,$318F,$318F,$318F
	dw $318E,$318E,$318E,$318E,$318F,$318F,$318F,$31E2
	dw $31E3,$31E3,$31E3,$71E2,$318F,$318F,$318F,$318F
	dw $318F,$318F,$318F,$318F,$318F,$F199,$39BF,$39BF

DATA_17DE63:
	dw $39BF,$39BF,$B599,$358F,$358F,$358F,$358F,$358F
	dw $358F,$358F,$358F,$358F,$358E,$358E,$358E,$35E4
	dw $35E3,$35E3,$35E3,$75E2,$358F,$358F,$358F,$358F
	dw $358F,$358F,$358F,$358F,$358F,$F599,$39BF,$39BF

DATA_17DEA3:
	dw $39BF,$39BF,$A199,$218F,$218F,$218F,$218F,$218F
	dw $218F,$218F,$218F,$218F,$218F,$218F,$218F,$21E2
	dw $21E5,$21E5,$21E5,$61E4,$218F,$218F,$218F,$218F
	dw $218F,$218F,$218F,$218F,$218F,$E199,$39BF,$39BF

DATA_17DEE3:
	dw $39BF,$39BF,$A599,$258F,$258F,$258F,$258F,$258F
	dw $258F,$258F,$258F,$258F,$258F,$258F,$258F,$25E2
	dw $25E3,$25E3,$25E3,$65E2,$258E,$258E,$258E,$258E
	dw $258F,$258F,$258F,$258F,$258F,$E599,$39BF,$39BF

DATA_17DF23:
	dw $39BF,$39BF,$A999,$298F,$298F,$298F,$298F,$298F
	dw $298F,$298F,$298F,$298F,$298F,$298F,$298F,$29E2
	dw $29E3,$29E3,$29E3,$69E2,$298F,$298F,$298F,$298F
	dw $298E,$298E,$298E,$298E,$298F,$E999,$39BF,$39BF

DATA_17DF63:
	dw $399F,$398F,$398F,$398F,$398F,$398F,$398F,$398F
	dw $799F

DATA_17DF75:
	dw $3998,$398E,$398E,$398E,$398E,$398E,$398E,$398E
	dw $7998

DATA_17DF87:
	dw $B99F,$B98F,$B98F,$B98F,$B98F,$B98F,$B98F,$B98F
	dw $F99F

DATA_17DF99:
	dw $2187,$21F0,$6187

DATA_17DF9F:
	dw $21F1,$21F2,$21F3

DATA_17DFA5:
	dw $A187,$21F4,$E187

DATA_17DFAB:
	dw $21E8,$21E9,$21EA,$61E9,$61E8

DATA_17DFB5:
	dw $21EB,$21EC,$21ED,$61EC,$61EB

DATA_17DFBF:
	dw $21EB,$21E9,$21EA,$61E9,$61E8

DATA_17DFC9:
	dw $21E8,$21FA,$21FB,$61FA,$61EB

DATA_17DFD3:
	dw $21EF,$21F5,$21F5,$21F5,$61EF

DATA_17DFDD:
	dw $61F8,$21F7,$21F7,$21F7,$21F8

DATA_17DFE7:
	dw $61F8,$21F7,$21F7,$21F7,$61EF

DATA_17DFF1:
	dw $21EF,$21F7,$21F6,$21F7,$61EF

DATA_17DFFB:
	dw $21EE,$21E0,$21E6,$21E3,$61EE

DATA_17E005:
	dw $21EE,$21E0,$21E6,$21E7,$61EE

;-------------------------------------------------------------------------
; CODE_gm22_input_gate_level_select -- overworld input gate / CODE_level_select trampoline.
; Called from CODE_gm22_inner_dispatcher's idle path (state $1118 == 0).
;
; Two early-exits before falling into CODE_level_select:
;   - If $093D & $20 set (cursor freeze flag): jump to CODE_gm22_no_press_idle_tick
;     (animation idle without input poll).
;   - If A/B held over special "score button" tiles ($1112 == $0A or $0B):
;     load $1118 with the corresponding extended-state ($18 for tile $0A
;     -> show-scores cinematic, $28 for tile $0B -> extended-scene start)
;     then JMP CODE_17E17F (transition entry).
; Otherwise: fall through to CODE_level_select.
;-------------------------------------------------------------------------
CODE_17E00F:
CODE_gm22_input_gate_level_select:                   ; overworld input gate; two early-exits before falling into CODE_level_select
	LDA.w $093D
	AND.b #$20
	BEQ.b CODE_17E019
	JMP.w CODE_gm22_no_press_idle_tick

CODE_17E019:
	LDA.b $37
	AND.b #$C0
	ORA.b $38
	AND.b #$D0
	BEQ.b CODE_level_select
	LDA.w $1112
	CMP.b #$0A
	BNE.b CODE_17E032
	LDA.b #$18
	STA.w $1118
	JMP.w CODE_17E17F

CODE_17E032:
	CMP.b #$0B
	BNE.b CODE_level_select
	LDA.b #$28
	STA.w $1118
	JMP.w CODE_17E17F

;-------------------------------------------------------------------------
; CODE_level_select -- level-select / cursor-tick handler for gm22 overworld.
; Raidenthequick: `CODE_level_select` at $17:E03E.
;
; Decides what to do when the player presses a button while the overworld
; cursor is on a tile:
;   - A/B press over a tile that has a non-zero, non-$FF level ID in $030F,y:
;     write the level ID to !RAM_YI_Level_CurrentLevelFromMapLo ($7E:021A),
;     play SoundID5D (SelectLevel), set $1113=2 (level-load arming), and fall
;     through to CODE_level_select_arm_load which advances gamemode to $1E (start+select fade)
;     -- this is the entry into the level-loading pipeline.
;   - No button: tick the cursor-movement state at $111C (acceleration timer)
;     and update cursor x/y via DATA_17E183/DATA_map_world_tile_base_b deltas.
;   - Start: bypass to debug level-select pathway (gated by build config).
;
; INPUTS:
;   M=8 X=8 (caller is gm22 dispatcher).
;   $7E:0037/0038 = controller press / hold mirrors.
;   $7E:0218 = current world; $7E:1112 = current tile cursor index.
;   $7E:030F+(world*12+cursor) = tile-availability byte (0=blocked, FF=unused, $80|N=level slot N+1).
; OUTPUTS:
;   On select: !RAM_YI_Level_CurrentLevelFromMapLo := tile's level ID,
;     $1113 := 2 (level-load arming flag), gamemode advances to $1E.
;   On movement: $1112 := next cursor tile, scroll OAM updated.
; MODIFIES: A, X, Y, DP $00..$0F.
; CALLERS:
;   Reached only from CODE_gm22_input_gate_level_select (the gm22 inner state-machine), itself
;   called from CODE_gm22_dispatch_idle_tick (gm22 idle-tick path).
;-------------------------------------------------------------------------
CODE_17E03E:
CODE_level_select:						; Raiden alias
	LDA.b $37
	AND.b #$C0
	ORA.b $38
	AND.b #$D0
	BEQ.b CODE_level_select_no_press
	STA.w $0979
	LDA.w !RAM_YI_Level_CurrentWorldLo
	LSR
	TAX
	LDA.w DATA_map_world_tile_base_b,x
	CLC
	ADC.w $1112
	TAY
	LDA.w $030F,y
	BEQ.b CODE_level_select_no_press
	CMP.b #$FF
	BEQ.b CODE_level_select_no_press
	AND.b #$7F
	DEC
	CLC
	ADC.w DATA_map_world_tile_base_b,x
	STA.w !RAM_YI_Level_CurrentLevelFromMapLo
	LDA.b #$02
	STA.w $1113
	STZ.w $1114
	LDA.b #!Define_YI_SoundID5D_SelectLevel
	JSL.l CODE_push_sound_queue
	BRA.b CODE_level_select_arm_load

CODE_17E07B:
CODE_level_select_no_press:                          ; CODE_level_select branch: no A/B press; clear $0979 and check start/select
	STZ.w $0979
	LDA.b $93
	BNE.b CODE_17E088
	LDA.b $37
	AND.b #$30
	BEQ.b CODE_17E08B
CODE_17E088:
	JMP.w CODE_gm22_no_press_idle_tick

CODE_17E08B:
	LDA.w $111C
	BEQ.b CODE_17E09D
	INC
	CMP.b #$10
	BCC.b CODE_17E09D
	LDA.b $36
	AND.b #$03
	BEQ.b CODE_17E0E6
	BRA.b CODE_17E0A9

CODE_17E09D:
	STA.w $111C
	LDA.b $38
	AND.b #$03
	BEQ.b CODE_17E0E6
	INC.w $111C
CODE_17E0A9:
	TAX
	LDA.b #!Define_YI_SoundID5C_ScrollTextbox
	JSL.l CODE_push_sound_queue
	LDA.w $1112
	STA.b $00
	CLC
	ADC.w DATA_17E183-$01,x
	BPL.b CODE_17E0BD
	LDA.b #$0B
CODE_17E0BD:
	CMP.b #$0C
	BCC.b CODE_17E0C3
	LDA.b #$00
CODE_17E0C3:
	TAX
	CLC
	ADC.b $00
	CMP.b #$0B
	BEQ.b CODE_17E0D1
	JSR.w CODE_17E1A6
	JMP.w CODE_17E17F

CODE_17E0D1:
	LDA.w $111C
	INC
	AND.b #$1F
	BEQ.b CODE_level_select_arm_load
	LDA.b $36
	AND.b #$03
	STA.w $111B
	STA.w $111C
CODE_17E0E3:
CODE_level_select_arm_load:                          ; level-load arming: jumps to CODE_17E17F which sets gamemode to $1E
	JMP.w CODE_17E17F

CODE_17E0E6:
	LDA.b $38
	AND.b #$0C
	BEQ.b CODE_gm22_no_press_idle_tick
	LSR
	LSR
	TAX
	LDA.b #!Define_YI_SoundID5C_ScrollTextbox
	JSL.l CODE_push_sound_queue
	LDA.w $1112
	CLC
	ADC.w DATA_17E185-$01,x
	BMI.b CODE_17E108
	CMP.b #$00
	BCC.b CODE_17E108
	CMP.b #$0C
	BCC.b CODE_17E123
	BRA.b CODE_17E13B

CODE_17E108:
	LDA.w !RAM_YI_Level_CurrentWorldLo
	ASL
	ASL
	ORA.w $1112
	TAX
	LDA.w DATA_17E4FB,x
	EOR.b #$03
	STA.w $111A
	LDA.w !RAM_YI_Level_CurrentWorldLo
	INC
	INC
	STA.w $1117
	BRA.b CODE_17E17F

CODE_17E123:
	TAY
	LDX.w !RAM_YI_Level_CurrentWorldLo
	REP.b #$20
	LDA.w DATA_17C93A,x
	STA.b $10
	SEP.b #$20
	LDA.b ($10),y
	AND.b #$0F
	BEQ.b CODE_17E13B
	STY.w $1112
	BRA.b CODE_17E17F

CODE_17E13B:
	LDA.b $38
	AND.b #$0C
	STA.w $111B
	LDA.b #!Define_YI_SoundID42_DeniedAction
	JSL.l CODE_push_sound_queue
	BRA.b CODE_17E17F

CODE_17E14A:
CODE_gm22_no_press_idle_tick:                        ; CODE_level_select fall-through: no button pressed; tick cursor animation
	LDA.w $093D
	AND.b #$20
	BEQ.b CODE_17E17F
	LDX.w $118E
	REP.b #$20
	LDA.b $37
	AND.w #$C0C0
	BEQ.b CODE_17E182
	CMP.w DATA_mini_battle_unlock_sequence,x
	BNE.b CODE_17E179
	SEP.b #$20
	LDA.w $118E
	INC
	INC
	STA.w $118E
	CMP.b #$0A
	BCC.b CODE_17E182
	INC.w $114E
	LDA.b #!Define_YI_SoundID95_BonusChallenge
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	BRA.b CODE_17E182

CODE_17E179:
	SEP.b #$20
	LDA.b #!Define_YI_SoundID90_Incorrect
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
CODE_17E17F:
	STZ.w $118E
CODE_17E182:
	RTS

; Cursor-step deltas for sideways (next/prev) tile traversal: +1, -1.
DATA_17E183:
	db $01,$FF

; Cursor-step deltas for diagonal/vertical (next-row/prev-row) traversal: +6, -6.
DATA_17E185:
	db $06,$FA

; Per-world starting tile-index = world * !Define_YI_Map_LevelsPerWorld (12).
; Indexed by `current_world >> 1` (world IDs are stored as 0,2,4,...).
; Used by CODE_level_select to translate world-relative tile -> global level ID.
DATA_17E187:
DATA_map_world_tile_base_b:					; cosmetic alias (byte-form base table)
	db !Define_YI_Map_LevelsPerWorld*$00
	db !Define_YI_Map_LevelsPerWorld*$01
	db !Define_YI_Map_LevelsPerWorld*$02
	db !Define_YI_Map_LevelsPerWorld*$03
	db !Define_YI_Map_LevelsPerWorld*$04
	db !Define_YI_Map_LevelsPerWorld*$05
	db !Define_YI_Map_LevelsPerWorld*$06

; SMWC: 5-button sequence (X, X, Y, B, A) that unlocks the Mini-Battle menu.
; Each entry is a u16 joypad-bitmask match. Bit layout:
;   hi: B=$80 Y=$40 Sel=$20 Start=$10 U/D/L/R=$08/$04/$02/$01
;   lo: A=$80 X=$40 L=$20 R=$10
; Sequence $0040,$0040,$4000,$8000,$0080 = X, X, Y, B, A.
; See CODE_17E126-area state $118E (sequence-position counter) for use site.
DATA_17E18E:
DATA_mini_battle_unlock_sequence:
	dw $0040,$0040,$4000,$8000,$0080

; Same as DATA_map_world_tile_base_b (per-world starting tile index) but word-form. Used
; by code paths that need word-wide addition (gm26 high-score, gm28 cursor).
DATA_17E198:
DATA_map_world_tile_base_w:					; cosmetic alias (word-form base table)
	dw !Define_YI_Map_LevelsPerWorld*$00
	dw !Define_YI_Map_LevelsPerWorld*$01
	dw !Define_YI_Map_LevelsPerWorld*$02
	dw !Define_YI_Map_LevelsPerWorld*$03
	dw !Define_YI_Map_LevelsPerWorld*$04
	dw !Define_YI_Map_LevelsPerWorld*$05
	dw !Define_YI_Map_LevelsPerWorld*$06

CODE_17E1A6:
	STX.w $1112
	LDY.w !RAM_YI_Level_CurrentWorldLo
	REP.b #$20
	LDA.w DATA_17C93A,y
	STA.b $10
	SEP.b #$20
	TXY
	LDA.b $36
	AND.b #$03
	TAX
CODE_17E1BB:
	LDA.b ($10),y
	AND.b #$0F
	BNE.b CODE_17E1C9
	TYA
	CLC
	ADC.w DATA_17E183-$01,x
	TAY
	BRA.b CODE_17E1BB

CODE_17E1C9:
	CPY.w $1112
	BEQ.b CODE_17E1DE
	STY.w $1112
	TYA
	ASL
	TAY
	REP.b #$20
	LDA.w DATA_17E257,y
	STA.w $1109
	SEP.b #$20
CODE_17E1DE:
	RTS

CODE_17E1DF:
	LDA.w $1112
	ASL
	TAY
	REP.b #$20
	LDA.w $1117
	AND.w #$00FF
	BEQ.b CODE_17E1F7
	TAY
	LDA.w DATA_17E26D,y
	STA.w $1109
	BRA.b CODE_17E1FA

CODE_17E1F7:
	LDA.w DATA_17E257,y
CODE_17E1FA:
	STA.w $110C
	SEP.b #$20
	RTS

CODE_17E200:
	LDY.b #$00
	LDA.w $110C
	BEQ.b CODE_17E235
	CMP.w $1109
	BEQ.b CODE_17E22F
	BPL.b CODE_17E20F
	INY
CODE_17E20F:
	LDA.w $111A
	BEQ.b CODE_17E223
	REP.b #$20
	LDA.w $110C
	STA.w $1109
	STZ.w $110C
	SEP.b #$20
	BRA.b CODE_17E253

CODE_17E223:
	LDA.w $1109
	CLC
	ADC.w DATA_17E254,y
	STA.w $1109
	BRA.b CODE_17E235

CODE_17E22F:
	STZ.w $110C
	STZ.w $111A
CODE_17E235:
	LDY.b #$00
	LDA.w $110D
	BEQ.b CODE_17E253
	CMP.w $110A
	BEQ.b CODE_17E250
	BPL.b CODE_17E244
	INY
CODE_17E244:
	LDA.w $110A
	CLC
	ADC.w DATA_17E254,y
	STA.w $110A
	BRA.b CODE_17E253

CODE_17E250:
	STZ.w $110D
CODE_17E253:
	RTS

DATA_17E254:
	db $04,$FC,$04

DATA_17E257:
	dw $322C,$324C,$326C,$328C,$32AC,$32CC,$5A2C,$5A4C
	dw $5A6C,$5A8C,$5AB4

DATA_17E26D:
	dw $5AD4

DATA_17E26F:
	dw $1634,$1654,$1674,$1694,$16B4,$16D4

CODE_17E27B:
	REP.b #$30
	LDX.w $6092
	LDA.w $1109
	AND.w #$00FF
	STA.w $6000,x
	LDA.w $110A
	AND.w #$00FF
	STA.w $6002,x
	LDY.w #$33C0
	LDA.w $1118
	AND.w #$00FF
	BNE.b CODE_17E2AD
	LDA.w $1108
	AND.w #$000F
	BNE.b CODE_17E2AD
	LDA.w $0979
	AND.w #$00FF
	BEQ.b CODE_17E2C4
CODE_17E2AD:
	LDA.w $1122
	AND.w #$00FF
	BEQ.b CODE_17E2C2
	AND.w #$0080
	BNE.b CODE_17E2C4
	LDA.w $1107
	AND.w #$00FF
	BEQ.b CODE_17E2C4
CODE_17E2C2:
	INY
	INY
CODE_17E2C4:
	TYA
	STA.w $6004,x
	LDA.w #$0002
	STA.w $6006,x
	TXA
	CLC
	ADC.w #$0008
	STA.w $6092
	SEP.b #$30
	RTS

DATA_17E2D9:
	dw $0C00,$0C20,$0C40,$0C60,$2C24,$2C24,$2C44,$AC60
	dw $AC40,$AC20,$2C04

DATA_17E2EF:
	dw $0C08,$0C28,$0C48,$0C68,$AC44,$AC44,$AC24,$AC68
	dw $AC48,$AC28,$2C64

DATA_17E305:
	dw DATA_17E2D9,DATA_17E2EF

CODE_17E309:
	LDA.w $1142
	CMP.w #$0018
	BCC.b CODE_17E314
	AND.w #$0018
CODE_17E314:
	PHA
	ASL
	ASL
	STA.b $00
	SEP.b #$20
	LDA.b #$00
	CLC
	ADC.b $00
	STA.w $1144
	LDA.b #$FF
	SEC
	SBC.b $00
	STA.w $1145
	REP.b #$20
	LDX.w $6092
	LDA.w #$0000
	CLC
	ADC.b $00
	JSR.w CODE_17E3FF
	LDA.w #$0010
	CLC
	ADC.b $00
	JSR.w CODE_17E3FF
	LDA.w #$00E0
	SEC
	SBC.b $00
	JSR.w CODE_17E3FF
	LDA.w #$00F0
	SEC
	SBC.b $00
	JSR.w CODE_17E3FF
	LDX.w $6092
	LDA.w #$0030
	JSR.w CODE_17E427
	LDA.w #$0040
	JSR.w CODE_17E427
	LDA.w #$0050
	JSR.w CODE_17E427
	LDA.w #$0060
	JSR.w CODE_17E427
	LDA.w #$0070
	JSR.w CODE_17E427
	LDA.w #$0080
	JSR.w CODE_17E427
	LDA.w #$0090
	JSR.w CODE_17E427
	LDA.w #$00A0
	JSR.w CODE_17E427
	LDA.w #$00B0
	JSR.w CODE_17E427
	LDA.w #$00C0
	JSR.w CODE_17E427
	LDA.w #$00D0
	JSR.w CODE_17E427
	PLA
	BEQ.b CODE_17E3A1
	AND.w #$0004
	BRA.b CODE_17E3A7

CODE_17E3A1:
	LDA.b !RAM_YI_Global_Layer3XPosLo
	AND.w #$0008
	LSR
CODE_17E3A7:
	LSR
	TAX
	LDA.w DATA_17E305,x
	STA.b $00
	STZ.b $08
	LDX.w $6092
	LDY.w #$0000
	JSR.w CODE_17E43A
	INC.b $08
	INC.b $08
	LDY.w #$0000
	JSR.w CODE_17E43A
	LDA.w #$4002
	STA.b $08
	LDY.w #$0000
	JSR.w CODE_17E43A
	DEC.b $08
	DEC.b $08
	LDY.w #$0000
	JSR.w CODE_17E43A
	LDX.w $6092
	INX
	INX
	INX
	INX
	INX
	INX
	LDA.w #$0002
	TAY
	JSR.w CODE_17E3FF
	TYA
	JSR.w CODE_17E3FF
	TYA
	JSR.w CODE_17E3FF
	TYA
	JSR.w CODE_17E3FF
	LDA.w $6092
	CLC
	ADC.w #$0160
	STA.w $6092
	RTL

CODE_17E3FF:
	STA.w $6000,x
	STA.w $6008,x
	STA.w $6010,x
	STA.w $6018,x
	STA.w $6020,x
	STA.w $6028,x
	STA.w $6030,x
	STA.w $6038,x
	STA.w $6040,x
	STA.w $6048,x
	STA.w $6050,x
	TXA
	CLC
	ADC.w #$0058
	TAX
	RTS

CODE_17E427:
	STA.w $6002,x
	STA.w $605A,x
	STA.w $60B2,x
	STA.w $610A,x
	TXA
	CLC
	ADC.w #$0008
	TAX
	RTS

CODE_17E43A:
	STX.b $02
CODE_17E43C:
	LDA.b ($00),y
	ORA.b $08
	STA.w $6004,x
	TXA
	CLC
	ADC.w #$0008
	TAX
	INY
	INY
	CPY.w #$0016
	BCC.b CODE_17E43C
	LDA.b $02
	CLC
	ADC.w #$0058
	TAX
	RTS

CODE_17E458:
CODE_world_map_cursor_dpad_move:                     ; D-pad cursor movement; reads $38 (D-pad edge mirror) and steps cursor tile
	LDA.b $38
	AND.b #$03
	BEQ.b CODE_17E4A6
	TAX
	LDA.w $1117
CODE_17E462:
	CLC
	ADC.w DATA_17E183-$01,x
	CLC
	ADC.w DATA_17E183-$01,x
	TAY
	BEQ.b CODE_17E49E
	CMP.b #$10
	BCS.b CODE_17E49E
	STA.b $00
	LSR
	TAY
	LDA.w DATA_map_world_tile_base_b-$01,y
	TAY
	REP.b #$20
	LDA.w !RAM_YI_Map_LevelClearFlags,y
	ORA.w $0224,y
	ORA.w $0226,y
	ORA.w $0228,y
	STA.b $02
	SEP.b #$20
	LDA.b $02
	ORA.b $03
	BNE.b CODE_17E495
	LDA.b $00
	BRA.b CODE_17E462

CODE_17E495:
	LDA.b $00
	STA.w $1117
	LDA.b #!Define_YI_SoundID5C_ScrollTextbox
	BRA.b CODE_17E4A0

CODE_17E49E:
	LDA.b #!Define_YI_SoundID42_DeniedAction
CODE_17E4A0:
	JSL.l CODE_push_sound_queue
	BRA.b CODE_17E4FA

CODE_17E4A6:
	LDA.b $38
	AND.b #$04
	BEQ.b CODE_17E4CB
	LDA.w $1117
	DEC
	DEC
	ASL
	ASL
	ORA.w $1112
	TAX
	LDA.w DATA_17E4FB,x
	STA.w $111A
	STZ.w $1117
	STZ.w $1118
	LDA.b #!Define_YI_SoundID5C_ScrollTextbox
	JSL.l CODE_push_sound_queue
	BRA.b CODE_17E4FA

CODE_17E4CB:
	LDA.b $37
	ORA.b $38
	AND.b #$C0
	BEQ.b CODE_17E4FA
	LDA.w $1117
	DEC
	DEC
	CMP.w !RAM_YI_Level_CurrentWorldLo
	BEQ.b CODE_17E4FA
	STA.w !RAM_YI_Level_CurrentWorldLo
	LSR
	TAX
	LDA.w DATA_map_world_tile_base_b,x
	STA.w !RAM_YI_Level_CurrentLevelFromMapLo
	STZ.w $1112
	STZ.w $110B
	STZ.w $1123
	INC.w $1118
	LDA.b #!Define_YI_SoundID19_SelectWorld
	JSL.l CODE_push_sound_queue
CODE_17E4FA:
	RTS

DATA_17E4FB:
	dw $0202,$0202,$0202,$0000,$0201,$0202,$0202,$0000
	dw $0101,$0202,$0202,$0000,$0101,$0201,$0202,$0000
	dw $0101,$0201,$0202,$0000,$0101,$0101,$0202,$0000
	dw $0101,$0101,$0201,$0000

CODE_17E533:
	REP.b #$30
	LDX.w $6092
	LDA.w $1109
	AND.w #$00FF
	SEC
	SBC.w #$0010
	STA.w $6000,x
	STA.w $6010,x
	CLC
	ADC.w #$0010
	STA.w $6008,x
	STA.w $6018,x
	LDA.w $110A
	AND.w #$00FF
	SEC
	SBC.w #$0016
	STA.w $6002,x
	STA.w $600A,x
	CLC
	ADC.w #$0010
	STA.w $6012,x
	STA.w $601A,x
	LDY.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_17DC43,y
	STA.b $04
	LDA.w $1119
	AND.w #$00FF
	BNE.b CODE_17E58D
	LDA.w DATA_map_world_tile_base_w,y
	CLC
	ADC.w $1112
	AND.w #$00FF
	TAY
	LDA.w $030F,y
	AND.w #$007F
CODE_17E58D:
	DEC
	STA.b $10
	AND.w #$000F
	ASL
	TAY
	JSR.w CODE_17D6A2
	LDA.b $10
	BNE.b CODE_17E59E
	LDA.b ($04),y
CODE_17E59E:
	LSR
	SEC
	SBC.w #$0600
	ORA.w #$31E0
	STA.w $6004,x
	INC
	INC
	STA.w $600C,x
	INC
	INC
	STA.w $6014,x
	INC
	INC
	STA.w $601C,x
	LDA.w #$4002
	STA.w $6006,x
	STA.w $600E,x
	STA.w $6016,x
	STA.w $601E,x
	TXA
	CLC
	ADC.w #$0020
	STA.w $6092
	SEP.b #$30
	RTS

CODE_17E5D2:
	LDA.w $1112
	STA.w $110B
	ASL
	TAX
	REP.b #$20
	LDA.w DATA_17DCEF,x
	LDY.w $1106
	BNE.b CODE_17E5E8
	CLC
	ADC.w #$0380
CODE_17E5E8:
	STA.b $00
	CLC
	ADC.w #$0040
	STA.b $02
	CLC
	ADC.w #$0040
	STA.b $04
	LDY.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_17C9EA,y
	STA.b $06
	LDY.b #$00
CODE_17E600:
	LDA.w $1112
	AND.w #$00FF
	CMP.w #$0003
	BEQ.b CODE_17E615
	CMP.w #$0007
	BEQ.b CODE_17E615
	JSR.w CODE_17D287
	BRA.b CODE_17E618

CODE_17E615:
	JSR.w CODE_17D29D
CODE_17E618:
	INY
	INY
	CPY.b #$06
	BCC.b CODE_17E600
CODE_17E61E:
	REP.b #$30
	LDA.w $1106
	AND.w #$0001
	ASL
	TAY
	LDA.w #$0000
	STA.b $01
	LDA.w DATA_17CC8F,y
	CLC
	ADC.w #$00C0
	TAX
	LDY.w #$1C80
	LDA.w #$0200
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	RTS

CODE_17E642:
	JSR.w CODE_17E61E
	RTL

CODE_17E646:
	REP.b #$20
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_17DBA3,x
	STA.b $00
	LDA.w $1112
	AND.w #$00FF
	TAY
	LDA.b ($00),y
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $1119
	AND.w #$007F
	DEC
	CLC
	ADC.w DATA_map_world_tile_base_w,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $1107
	AND.w #$00FF
	CLC
	ADC.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_08DBDE>>16
	LDA.w #FXCODE_08DBDE
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_17E683:
	REP.b #$10
	LDA.w #$705800>>16
	STA.b $01
	LDY.w #$7E00
	LDX.w #$705800
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7F00
	LDX.w #$705A00
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7E40
	LDX.w #$705C00
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7F40
	LDX.w #$705E00
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	RTS

DATA_17E6C1:
	dw CODE_17E6DE
	dw CODE_17E71E

CODE_17E6C5:
	LDX.b #$00
	LDA.w $111B
	AND.b #$0F
	BEQ.b CODE_17E6DA
	AND.b #$0C
	BEQ.b CODE_17E6D7
	LSR
	LSR
	TAY
	INX
	INX
CODE_17E6D7:
	JSR.w (DATA_17E6C1,x)
CODE_17E6DA:
	STZ.w $111B
	RTS

CODE_17E6DE:
	LDA.b #$0B
	LDY.w $1108
	BNE.b CODE_17E708
	SEC
	SBC.w $1112
	STA.w $1112
	TAY
	LDX.w !RAM_YI_Level_CurrentWorldLo
	REP.b #$20
	LDA.w DATA_17C93A,x
	STA.b $00
	SEP.b #$20
CODE_17E6F9:
	LDA.b ($00),y
	AND.b #$0F
	BNE.b CODE_17E702
	INY
	BRA.b CODE_17E6F9

CODE_17E702:
	TYA
	STA.w $1112
	BRA.b CODE_17E70F

CODE_17E708:
	SEC
	SBC.w $110B
	STA.w $110B
CODE_17E70F:
	ASL
	TAY
	REP.b #$20
	LDA.w DATA_17E257,y
	STA.w $1109
	SEP.b #$20
	RTS

DATA_17E71C:
	db $08,$F8

CODE_17E71E:
	LDA.w $110A
	CLC
	ADC.w DATA_17E71C-$01,y
	STA.w $110D
	RTS

CODE_17E729:
	LDX.w !RAM_YI_Level_CurrentLevelFromMapLo
	LDA.l DATA_yoshi_level_colors,x
	STA.w !RAM_YI_Level_CurrentYoshiColorLo
	JSR.w CODE_17E5D2
	INC.w $111D
	REP.b #$20
	STZ.w $110E
	LDA.w #$0100
	STA.w $1110
CODE_17E744:
	LDX.w !RAM_YI_Level_CurrentWorldLo
	REP.b #$20
	LDA.w DATA_17DBA3,x
	STA.b $00
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_map_world_tile_base_w,x
	CLC
	ADC.w $1112
	AND.w #$00FF
	TAY
	LDA.w $030F,y
	AND.w #$007F
	DEC
	TAY
	CLC
	ADC.w DATA_map_world_tile_base_w,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.b ($00),y
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $110E
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $1110
	BEQ.b CODE_17E7BC
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_08DC05>>16
	LDA.w #FXCODE_08DC05
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSR.w CODE_17E683
	REP.b #$20
	LDA.w $110E
	CLC
	ADC.w #$0008
	STA.w $110E
	LDA.w $1110
	SEC
	SBC.w #$0002
	CMP.w #$0014
	BCS.b CODE_17E7B9
	SEP.b #$20
	LDA.b #!Define_YI_MusicID_FadeMusicCommand
	STA.b !RAM_YI_Global_PlayMusicLo
	LDA.b #!Define_YI_SoundID43_MountYoshi
	JSL.l CODE_push_sound_queue
	REP.b #$20
	LDA.w #$0000
CODE_17E7B9:
	STA.w $1110
CODE_17E7BC:
	SEP.b #$20
	RTS

CODE_17E7BF:
	LDA.w $1128
	BEQ.b CODE_17E7FA
	LDA.w $0990
	DEC
	BPL.b CODE_17E7CC
	LDA.b #$00
CODE_17E7CC:
	STA.w $0990
	LDA.w $0992
	DEC
	BPL.b CODE_17E7D7
	LDA.b #$00
CODE_17E7D7:
	STA.w $0992
	LDA.w $0994
	DEC
	DEC
	BPL.b CODE_17E7E3
	LDA.b #$00
CODE_17E7E3:
	STA.w $0994
	LDA.w $0990
	ORA.w $0992
	ORA.w $0994
	BNE.b CODE_17E7FA
	STZ.w $1128
	STZ.w $1110
	STZ.w $1111
CODE_17E7FA:
	RTS

CODE_17E7FB:
	LDY.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_17C93A,y
	STA.b $0A
	LDY.b #$00
	SEP.b #$20
CODE_17E807:
	LDA.b ($0A),y
	AND.b #$0F
	CMP.b $00
	BEQ.b CODE_17E816
	INY
	CPY.b #$0C
	BCC.b CODE_17E807
	LDY.b #$00
CODE_17E816:
	REP.b #$20
	RTS

DATA_17E819:
	dw $2D86,$2D65,$2D66,$2D67,$2D68,$2D75,$2D76,$2D77
	dw $6D86

DATA_17E82B:
	dw $3186,$3165,$317F,$3158,$3178,$3125,$3126,$3127
	dw $7186

DATA_17E83D:
	dw $0C00,$1000

DATA_17E841:
	dw $0008,$001A

DATA_17E845:
	dw $3920,$3921,$3922,$3923,$3924

DATA_17E84F:
	dw $3905,$3906,$3907,$3908,$3928

DATA_17E859:
	dw DATA_17E845,DATA_17E84F

CODE_17E85D:
	REP.b #$30
	LDX.w #$00FE
	LDA.w #$21BF
CODE_17E865:
	STA.w $0A06,x
	STA.w $0D86,x
	STA.w $0B06,x
	STA.w $0E86,x
	STA.w $0C06,x
	STA.w $0F86,x
	STA.w $0C86,x
	STA.w $1006,x
	DEX
	DEX
	BPL.b CODE_17E865
	LDA.w $112D
	AND.w #$0001
	ASL
	TAX
	LDA.w DATA_17E83D,x
	STA.b $00
	LDX.w #$0000
	TXY
	LDA.w $1106
	AND.w #$0001
	BEQ.b CODE_17E89D
	LDX.w #$0380
CODE_17E89D:
	STX.b $0E
CODE_17E89F:
	LDA.w DATA_17E819,y
	STA.w $0A4E,x
	LDA.w DATA_17E82B,y
	STA.w $0A60,x
	INX
	INX
	INY
	INY
	CPY.w #$0012
	BCC.b CODE_17E89F
	LDY.w #$0000
	LDX.b $0E
CODE_17E8B9:
	LDA.w DATA_17DDA3,y
	ORA.b $00
	STA.w $0AC6,x
	STA.w $0B06,x
	STA.w $0B46,x
	STA.w $0B86,x
	STA.w $0BC6,x
	STA.w $0C06,x
	STA.w $0C46,x
	STA.w $0C86,x
	STA.w $0CC6,x
	STA.w $0D06,x
	LDA.w DATA_17DDE3,y
	ORA.b $00
	STA.w $0D06,x
	INX
	INX
	INY
	INY
	CPY.w #$0040
	BCC.b CODE_17E8B9
	LDX.b $0E
	LDY.w #$0000
	LDA.w #$A199
	ORA.b $00
	STA.w $0A8A,x
	ORA.w #$4000
	STA.w $0AC0,x
	LDA.w #$218F
	ORA.b $00
CODE_17E905:
	STA.w $0A8C,x
	INX
	INX
	INY
	CPY.w #$001A
	BCC.b CODE_17E905
	LDA.w $112D
	AND.w #$000F
	ASL
	TAY
	LDA.w DATA_17E841,y
	CLC
	ADC.b $0E
	TAX
	LDY.w #$0009
	LDA.w #$218E
	ORA.b $00
CODE_17E927:
	STA.w $0A86,x
	INX
	INX
	DEY
	BNE.b CODE_17E927
	LDY.w #$0000
	LDX.b $0E
	LDA.w #$3909
CODE_17E937:
	PHA
	STA.w $0ADA,x
	CLC
	ADC.w #$0010
	STA.w $0B1A,x
	CLC
	ADC.w #$0010
	STA.w $0B5A,x
	CLC
	ADC.w #$0010
	STA.w $0B9A,x
	CLC
	ADC.w #$0010
	STA.w $0BDA,x
	CLC
	ADC.w #$0010
	STA.w $0C1A,x
	CLC
	ADC.w #$0010
	STA.w $0C5A,x
	CLC
	ADC.w #$0010
	STA.w $0C9A,x
	PLA
	INC
	INX
	INX
	INY
	CPY.w #$0007
	BCC.b CODE_17E937
	LDA.w #$B90F
	STA.w $0C98,x
	LDX.b $0E
	LDY.w #$0000
CODE_17E981:
	LDA.w #$2135
	ORA.b $00
	STA.w $0ACE,x
	STA.w $0BCE,x
	STA.w $0BEA,x
	ORA.w #$8000
	STA.w $0B8E,x
	STA.w $0C8E,x
	STA.w $0CAA,x
	LDA.w #$2145
	ORA.b $00
	STA.w $0AEA,x
	LDA.w #$2155
	ORA.b $00
	STA.w $0BAA,x
	INX
	INX
	INY
	CPY.w #$0005
	BCC.b CODE_17E981
	LDA.w #$2148
	ORA.b $00
	STA.w $0AEA,x
	LDA.w #$2156
	ORA.b $00
	STA.w $0BAA,x
	LDX.b $0E
	LDA.w #$2137
	ORA.b $00
	STA.w $0B0C,x
	STA.w $0B4C,x
	STA.w $0C0C,x
	STA.w $0C4C,x
	STA.w $0C28,x
	ORA.w #$4000
	STA.w $0B58,x
	STA.w $0C58,x
	STA.w $0C34,x
	STA.w $0C74,x
	LDA.w #$6136
	ORA.b $00
	STA.w $0B18,x
	STA.w $0C18,x
	EOR.w #$C000
	STA.w $0C68,x
	LDA.w #$2146
	ORA.b $00
	STA.w $0B28,x
	LDA.w #$A147
	ORA.b $00
	STA.w $0B68,x
	LDA.w #$2157
	ORA.b $00
	STA.w $0B34,x
	STA.w $0B74,x
	LDA.w #$2148
	ORA.b $00
	STA.w $0AF4,x
	ORA.w #$4000
	STA.w $0AE8,x
	ORA.w #$8000
	STA.w $0BA8,x
	LDA.w #$3960
	STA.b $10
	LDA.w #$3140
	STA.b $12
	LDA.w #$2D00
	STA.b $14
	LDX.b $0E
	LDY.w #$0005
CODE_17EA3C:
	LDA.b $10
	STA.w $0B0E,x
	ORA.w #$0010
	STA.w $0B4E,x
	LDA.b $12
	STA.w $0C2A,x
	ORA.w #$0010
	STA.w $0C6A,x
	LDA.b $14
	STA.w $0C0E,x
	ORA.w #$0010
	STA.w $0C4E,x
	INC.b $10
	INC.b $12
	INC.b $14
	INX
	INX
	DEY
	BNE.b CODE_17EA3C
	LDX.b $0E
	LDA.w #$399F
	STA.w $0B76,x
	PHA
	ORA.w #$8000
	STA.w $0C76,x
	PLA
	ORA.w #$4000
	STA.w $0B7E,x
	ORA.w #$8000
	STA.w $0C7E,x
	LDA.w #$398F
	STA.w $0B78,x
	STA.w $0B7A,x
	STA.w $0B7C,x
	ORA.w #$8000
	STA.w $0C78,x
	STA.w $0C7A,x
	STA.w $0C7C,x
	LDA.w #$3998
	STA.w $0BB6,x
	STA.w $0BF6,x
	STA.w $0C36,x
	ORA.w #$4000
	STA.w $0BBE,x
	STA.w $0BFE,x
	STA.w $0C3E,x
	LDA.w $1106
	AND.w #$0001
	XBA
	LSR
	STA.b $1E
	LDA.w #$2C63
	ORA.b $1E
	STA.b $10
	LDA.w #$2C66
	ORA.b $1E
	STA.b $12
	LDA.w #$2C69
	ORA.b $1E
	STA.b $14
	LDX.b $0E
	LDY.w #$0003
CODE_17EAD8:
	LDA.b $10
	STA.w $0BB8,x
	LDA.b $12
	STA.w $0BF8,x
	LDA.b $14
	STA.w $0C38,x
	INC.b $10
	INC.b $12
	INC.b $14
	INX
	INX
	DEY
	BNE.b CODE_17EAD8
	LDX.b $0E
	LDA.w $112D
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_17E859,y
	STA.b $00
	LDY.w #$0000
CODE_17EB04:
	LDA.b ($00),y
	STA.w $0B2A,x
	ORA.w #$0010
	STA.w $0B6A,x
	INX
	INX
	INY
	INY
	CPY.w #$000A
	BCC.b CODE_17EB04
	SEP.b #$30
	RTS

DATA_17EB1B:
	dw $0A06,$0D86

CODE_17EB1F:
	REP.b #$30
	LDA.w $1106
	AND.w #$0001
	ASL
	TAY
	LDA.w #$0000
	STA.b $01
	LDA.w DATA_17EB1B,y
	TAX
	LDY.w #$1E20
	LDA.w #$0380
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	RTS

CODE_17EB3F:
CODE_world_map_state_28_bonus_scene_init:            ; DATA_world_map_state_ptr[$28] -- bonus-game / extended-scene init
	STZ.w $1122
CODE_17EB42:
	REP.b #$20
	LDA.w #$000E
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #DATA_17DBF7>>16
	STA.w $6000
	LDA.w #DATA_17DBF7
	STA.w $6002
	LDX.b #FXCODE_08D995>>16
	LDA.w #FXCODE_08D995
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_17EB5F:
	REP.b #$10
	LDA.w $1106
	AND.w #$0001
	EOR.w #$0001
	ASL
	TAY
	LDX.w #$706000
	LDA.w #$706000>>16
	STA.b $01
	LDA.w DATA_17CCF1,y
	TAY
	LDA.w #$0800
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	INC.w $1118
	RTS

DATA_17EB85:
	dw $0048,$0049,$004A

CODE_17EB8B:
CODE_world_map_state_29_bonus_scene_hit_box:         ; DATA_world_map_state_ptr[$29] -- bonus-game hit-the-box transition
	LDX.b #$16
	JSR.w CODE_17CFA2
	LDA.b #!Define_YI_SoundID32_HitMessageBox
	JSL.l CODE_push_sound_queue
	STZ.w $1107
	LDX.w !EXRAM_YI_Global_EggThrowSetting|!EXRAMBankMirror
	LDA.w DATA_17EB85,x
	JSR.w CODE_17CFDA
	STZ.w $1122
	INC.w $1118
	RTS

CODE_17EBA9:
	JSR.w CODE_17ECA1
	STZ.w $6083
	LDA.w !EXRAM_YI_Global_EggThrowSetting|!EXRAMBankMirror
	LSR
	STA.w $112D
	BRA.b CODE_17EBCB

CODE_17EBB8:
	JSR.w CODE_17E85D
	INC.w $1118
	JSR.w CODE_17EB1F
	LDA.w $1106
	EOR.b #$01
	AND.b #$01
	STA.w $1106
CODE_17EBCB:
	LDX.w !EXRAM_YI_Global_EggThrowSetting|!EXRAMBankMirror
	LDA.w DATA_17EB85,x
	TAX
CODE_17EBD2:
	REP.b #$20
	LDA.w $1107
	CLC
	ADC.w #$0008
	STA.w $1107
	SEP.b #$20
	CMP.b #$40
	BCC.b CODE_17EBE7
	INC.w $1118
CODE_17EBE7:
	TXA
	JSR.w CODE_17CFDA
	RTS

CODE_17EBEC:
	LDX.w !EXRAM_YI_Global_EggThrowSetting|!EXRAMBankMirror
	LDA.w DATA_17EB85,x
	TAX
CODE_17EBF3:
	REP.b #$20
	LDA.w $1107
	SEC
	SBC.w #$0008
	STA.w $1107
	SEP.b #$20
	LDA.w $1107
	BPL.b CODE_17EC21
	INC.w $1118
	LDA.b #$13
	STA.w !RAM_YI_Global_MainScreenWindowMask
	LDA.b #$82
	STA.w !RAM_YI_Global_ObjectAndColorWindowSettings
	STZ.w $1107
	REP.b #$20
	LDA.w #$FF00
	STA.l $7E55C0
	SEP.b #$20
CODE_17EC21:
	TXA
	JSR.w CODE_17CFDA
	RTS

CODE_17EC26:
	REP.b #$30
	LDA.w $1107
	AND.w #$00FF
	ASL
	ASL
	TAX
	LDA.w #$EF11
	STA.l $7E55C4,x
	STA.l $7E55C8,x
	STA.l $7E55CC,x
	STA.l $7E55D0,x
	SEP.b #$30
	LDA.w $1107
	CLC
	ADC.b #$04
	STA.w $1107
	CMP.b #$50
	BCC.b CODE_17EC91
	INC.w $1118
	STZ.w $1107
	LDA.b #$00
	STA.w !RAM_YI_Global_MainScreenWindowMask
	LDA.b #$80
	STA.w !RAM_YI_Global_ObjectAndColorWindowSettings
	REP.b #$20
	LDA.w #$4AD4
	STA.w $1109
	SEP.b #$20
CODE_17EC6D:
	REP.b #$30
	LDA.w $1106
	EOR.w #$0001
	AND.w #$0001
	ASL
	TAY
	LDA.w #$0000
	STA.b $01
	LDA.w DATA_17EB1B,y
	TAX
	LDY.w #$1C20
	LDA.w #$0380
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	BRA.b CODE_17ECA0

CODE_17EC91:
	LDA.w $1118
	CMP.b #$38
	BCS.b CODE_17ECA0
	JSR.w CODE_17D005
	LDA.b #$80
	STA.w $1122
CODE_17ECA0:
	RTS

CODE_17ECA1:
	PHB
	LDA.b #$7E55C0>>16
	PHA
	PLB
	LDY.b #$00
	REP.b #$20
	LDA.w #$00FF
CODE_17ECAD:
	STA.w $7E55C0,y
	STA.w $7E5640,y
	DEY
	DEY
	BNE.b CODE_17ECAD
	SEP.b #$20
	PLB
	INC.w $1118
	RTS

DATA_17ECBE:
	dw $175B,$17A3

CODE_17ECC2:
	LDA.b $37
	AND.b #$80
	ORA.b $38
	AND.b #$90
	BEQ.b CODE_17ECDE
	LDA.b #!Define_YI_SoundID08_1up
	JSL.l CODE_push_sound_queue
	LDA.b #$5F
	JSR.w CODE_17CFDA
	LDA.b #$31
	STA.w $1118
	BRA.b CODE_17ED01

CODE_17ECDE:
	LDA.b $38
	AND.b #$08
	BEQ.b CODE_17ED01
	LDA.w !EXRAM_YI_Global_EggThrowSetting|!EXRAMBankMirror
	TAX
	LSR
	STA.w $112D
	REP.b #$20
	LDA.w DATA_17ECBE,x
	STA.w $1109
	SEP.b #$20
	LDA.b #$38
	STA.w $1118
	LDA.b #!Define_YI_SoundID5C_ScrollTextbox
	JSL.l CODE_push_sound_queue
CODE_17ED01:
	RTS

CODE_17ED02:
	REP.b #$30
	LDX.w #$0000
	LDA.w $1106
	AND.w #$0001
	BNE.b CODE_17ED12
	LDX.w #$0380
CODE_17ED12:
	LDA.w #$398E
	LDY.w #$0000
CODE_17ED18:
	STA.w $0BB8,x
	STA.w $0BF8,x
	STA.w $0C38,x
	INX
	INX
	INY
	CPY.w #$0003
	BCC.b CODE_17ED18
	LDA.w #$0100
	STA.w $1107
	JSR.w CODE_17EC6D
	SEP.b #$30
	INC.w $1118
CODE_17ED37:
	LDX.b #$5F
	JSR.w CODE_17EBD2
	RTS

CODE_17ED3D:
	LDX.b #$5F
	JSR.w CODE_17EBF3
	LDA.w $1107
	BPL.b CODE_17ED51
	REP.b #$20
	LDA.w #$4AD4
	STA.w $1109
	SEP.b #$20
CODE_17ED51:
	RTS

CODE_17ED52:
	JSR.w CODE_world_map_state_01_world_change_click
	JSR.w CODE_world_map_state_02_world_change_postclick_pause
	DEC.w $1118
	JSR.w CODE_17D005
	RTS

CODE_17ED5F:
	LDA.w $1106
	AND.b #$01
	EOR.b #$01
	STA.w $1106
	REP.b #$20
	JSR.w CODE_17EB5F
	LDA.w $1106
	AND.b #$01
	EOR.b #$01
	STA.w $1106
	JSR.w CODE_17D005
	LDA.b #$13
	STA.w !RAM_YI_Global_MainScreenWindowMask
	RTS

CODE_17ED81:
	JSR.w CODE_17EC26
	LDA.w $1107
	BNE.b CODE_17ED93
	REP.b #$20
	LDA.w DATA_17E26D
	STA.w $1109
	SEP.b #$20
CODE_17ED93:
	RTS

CODE_17ED94:
	JSR.w CODE_17ECA1
	LDA.b #$00
	STA.w !RAM_YI_Global_MainScreenWindowMask
	STZ.w $1118
	STZ.w $112D
	RTS

CODE_17EDA3:
	LDA.b $38
	AND.b #$04
	BEQ.b CODE_17EDBA
	LDA.b #$30
	STA.w $1118
	REP.b #$20
	LDA.w #$4AD4
	STA.w $1109
	SEP.b #$20
	BRA.b CODE_17EE21

CODE_17EDBA:
	LDA.b $38
	AND.b #$03
	BEQ.b CODE_17EDDF
	TAX
	LDA.w $112D
	CLC
	ADC.w DATA_17E183-$01,x
	BMI.b CODE_17EDDF
	CMP.b #$02
	BCS.b CODE_17EDDF
	STA.w $112D
	ASL
	TAX
	REP.b #$20
	LDA.w DATA_17ECBE,x
	STA.w $1109
	SEP.b #$20
	BRA.b CODE_17EE21

CODE_17EDDF:
	LDA.b $37
	ORA.b $38
	AND.b #$C0
	BEQ.b CODE_17EE27
	LDA.w $112D
	ASL
	CMP.w !EXRAM_YI_Global_EggThrowSetting|!EXRAMBankMirror
	BEQ.b CODE_17EE27
	STA.w !EXRAM_YI_Global_EggThrowSetting|!EXRAMBankMirror
	JSR.w CODE_17E85D
	JSR.w CODE_17EB1F
	JSR.w CODE_17EB42
	LDA.w $1106
	EOR.b #$01
	AND.b #$01
	STA.w $1106
	STZ.w $1107
	LDA.b #!Define_YI_SoundID04_SpitOut
	JSL.l CODE_push_sound_queue
	REP.b #$20
	LDA.w #$FF00
	STA.l $7E55C0
	SEP.b #$20
	LDA.b #$01
	STA.w !RAM_YI_Global_MainScreenWindowMask
	BRA.b CODE_17EE27

CODE_17EE21:
	LDA.b #!Define_YI_SoundID5C_ScrollTextbox
	JSL.l CODE_push_sound_queue
CODE_17EE27:
	RTS

CODE_17EE28:
CODE_world_map_state_39_world_clear_celebration:     ; DATA_world_map_state_ptr[$39] -- world-clear cinematic transition
	JSR.w CODE_17EC26
	LDA.w $1107
	BNE.b CODE_17EE41
	LDA.w $112D
	ASL
	TAX
	REP.b #$20
	LDA.w DATA_17ECBE,x
	STA.w $1109
	SEP.b #$20
	BRA.b CODE_17EE46

CODE_17EE41:
	LDA.b #$20
	STA.w $1122
CODE_17EE46:
	RTS

CODE_17EE47:
CODE_world_map_state_3a_world_clear_finalize:        ; DATA_world_map_state_ptr[$3A] -- finalize world-clear; jump back to state $38
	JSR.w CODE_17ECA1
	LDA.b #$38
	STA.w $1118
	RTS

DATA_17EE50:
	dw $2D86,$2D8F,$2DDB,$2DDC,$2DDD,$2DDE,$2DCB,$2DCC
	dw $2DCA,$2D8F,$6D86

DATA_17EE66:
	dw $2DBF,$2DBF,$AD99,$2D8F,$2D8E,$2D8E,$2D8E,$2D8E
	dw $2D8E,$2D8E,$2D8E,$2D8E,$2D8E,$2D8E,$2D8E,$2D8F
	dw $2D8F,$2D8F,$2D8F,$2D8F,$2D8F,$2D8F,$2D8F,$2D8F
	dw $0D8F,$2D8F,$2D8F,$2D8F,$2D8F,$ED99,$2DBF,$2DBF

DATA_17EEA6:
	dw $2DC0,$2DC1,$2DC2,$2DC3,$2DC4

DATA_17EEB0:
	dw $2DC0,$2DC1,$2DC2,$2DC8,$2DC9

DATA_17EEBA:
	dw $2DC5,$2DC6,$2DC7,$2DD5,$2D8C

DATA_17EEC4:
	dw $2DD0,$2DD1,$2DD2,$2DD3,$2DD4

DATA_17EECE:
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	dw $2DFF,$2DD6,$2DD7,$2DD8,$2DD9
else
	dw $2D8E,$2DD6,$2DD7,$2DD8,$2DD9
endif

DATA_17EED8:
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	dw $2DC0,$2DC1,$2DC2,$2DC3,$2D89
else
	dw $2DC0,$2DC1,$2DC2,$2DC3,$2DC4
endif

DATA_17EEE2:
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	dw $2DD0,$2DD1,$2DD2,$2DD3,$2D88
else
	dw $2DD0,$2DD1,$2DD2,$2DD3,$2DD4
endif

DATA_17EEEC:
	dw $2DFC,$2DFD,$2DFD,$2DFD,$2DFD,$2DDF,$2DCD,$2DCE
	dw $2DCF,$6DDF,$2DFD,$2DFD,$2DFD,$2DFD,$6DFC

DATA_17EF0A:
	dw $399F,$398F,$398F,$398F,$799F

DATA_17EF14:
	dw $3998,$398E,$398E,$398E,$7998

DATA_17EF1E:
	dw $B99F,$B98F,$B98F,$B98F,$F99F

DATA_17EF28:
	dw $0AD0,$0ADC,$0AE8,$0AF4,$0C10,$0C1C,$0C28,$0C36

DATA_17EF38:
	dw $0C00,$0C00,$0C00,$0C00,$1000,$0C00,$0C00,$0C00

DATA_17EF48:
	db $15,$15,$15,$15,$15,$15,$15,$15,$15,$15,$15,$15

CODE_17EF54:
	REP.b #$30
	STZ.w $118E
	LDX.w #$0000
	LDA.w $1106
	AND.w #$0001
	BEQ.b CODE_17EF67
	LDX.w #$0380
CODE_17EF67:
	STX.b $20
	LDY.w #$0020
	LDA.w #$01BF
CODE_17EF6F:
	STA.w $0A46,x
	INX
	INX
	DEY
	BNE.b CODE_17EF6F
	LDX.b $20
	LDY.w #$0000
CODE_17EF7C:
	LDA.w DATA_17EE50,y
	STA.w $0A4E,x
	INX
	INX
	INY
	INY
	CPY.w #$0016
	BCC.b CODE_17EF7C
	LDY.w #$0000
	LDX.b $20
CODE_17EF90:
	LDA.w DATA_17EE66,y
	STA.w $0A86,x
	LDA.w DATA_17DDA3,y
	ORA.w #$0C00
	STA.w $0AC6,x
	STA.w $0B06,x
	STA.w $0B46,x
	STA.w $0B86,x
	STA.w $0BC6,x
	STA.w $0C06,x
	STA.w $0C46,x
	STA.w $0C86,x
	STA.w $0CC6,x
	LDA.w DATA_17DDE3,y
	ORA.w #$0C00
	STA.w $0D06,x
	INX
	INX
	INY
	INY
	CPY.w #$0040
	BCC.b CODE_17EF90
	LDY.w #$0000
	LDX.b $20
CODE_17EFCE:
	LDA.w DATA_17EEA6,y
	STA.w $0B8E,x
	LDA.w DATA_17EEB0,y
	STA.w $0B9A,x
	LDA.w DATA_17EEBA,y
	STA.w $0BA6,x
	LDA.w DATA_17EEC4,y
	STA.w $0BB2,x
	LDA.w DATA_17EECE,y
	STA.w $0CCE,x
	LDA.w DATA_17EED8,y
	STA.w $0CDA,x
	LDA.w DATA_17EEE2,y
	STA.w $0CE6,x
	INX
	INX
	INY
	INY
	CPY.w #$000A
	BCC.b CODE_17EFCE
	LDY.w #$0000
	LDX.b $20
CODE_17F006:
	LDA.w DATA_17EEEC,y
	STA.w $0BD6,x
	INX
	INX
	INY
	INY
	CPY.w #$001E
	BCC.b CODE_17F006
	LDX.b $20
	LDA.w #$2DFE
	STA.w $0C16,x
	STA.w $0C56,x
	STA.w $0C96,x
	ORA.w #$4000
	STA.w $0C32,x
	STA.w $0C72,x
	STA.w $0CB2,x
	LDA.w #$2DDA
	STA.w $0CD8,x
	ORA.w #$4000
	STA.w $0CF0,x
	LDA.w #$EDFC
	STA.w $0CF2,x
	LDY.w #$0000
	LDX.b $20
CODE_17F046:
	LDA.w DATA_17EF0A,y
	STA.w $0BF4,x
	LDA.w DATA_17EF14,y
	STA.w $0C34,x
	STA.w $0C74,x
	STA.w $0CB4,x
	LDA.w DATA_17EF1E,y
	STA.w !RAM_YI_Level_PauseScreenCursorLoc1,x
	INX
	INX
	INY
	INY
	CPY.w #$000A
	BCC.b CODE_17F046
	SEP.b #$10
	STZ.b $10
	LDX.w $1106
	BEQ.b CODE_17F075
	LDA.w #$0080
	STA.b $10
CODE_17F075:
	LDX.b #$00
CODE_17F077:
	LDA.w DATA_17DC27,x
	ORA.b $10
	ORA.w DATA_17EF38,x
	STA.b $00
	LDA.w DATA_17EF28,x
	CLC
	ADC.b $20
	STA.b $0A
	CLC
	ADC.w #$0040
	STA.b $0C
	CLC
	ADC.w #$0040
	STA.b $0E
	JSR.w CODE_17DC09
	INX
	INX
	CPX.b #$10
	BCC.b CODE_17F077
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #DATA_17EF48>>16
	STA.w $6000
	LDA.w #DATA_17EF48
	STA.w $6002
	LDX.b #FXCODE_08D995>>16
	LDA.w #FXCODE_08D995
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	LDA.w $1106
	EOR.b #$01
	AND.b #$01
	STA.w $1106
	JSR.w CODE_17CC6F
	INC.w $114E
	RTS

CODE_17F0CC:
	JSR.w CODE_world_map_state_02_world_change_postclick_pause
	BRA.b CODE_17F0D9

CODE_17F0D1:
	JSR.w CODE_world_map_state_03_world_change_post_pause
	LDA.b #$11
	STA.w !RAM_YI_Global_MainScreenWindowMask
CODE_17F0D9:
	STZ.w $1118
	INC.w $114E
	BRA.b CODE_17F10D

CODE_17F0E1:
	JSR.w CODE_17CD12
	LDA.w $1118
	BEQ.b CODE_17F10D
	INC.w $114E
	REP.b #$20
	LDA.w $114E
	CMP.w #$000B
	BCC.b CODE_17F100
	LDA.w $1112
	ASL
	TAX
	LDA.w DATA_17E257,x
	BRA.b CODE_17F106

CODE_17F100:
	LDA.w #$5ACC
	STA.w $110C
CODE_17F106:
	STA.w $1109
	SEP.b #$20
	BRA.b CODE_17F117

CODE_17F10D:
	LDA.w $114E
	CMP.b #$0B
	BCC.b CODE_17F117
	JSR.w CODE_17D005
CODE_17F117:
	RTS

CODE_17F118:
	JSR.w CODE_world_map_state_05_new_stages_settling
	STZ.w $1118
	INC.w $114E
	REP.b #$20
	LDA.w #$0007
	STA.w $1150
	SEP.b #$20
	RTS

DATA_17F12C:
	db $34,$32,$64,$32,$94,$32,$C4,$32,$34,$5A,$64,$5A,$94,$5A,$CC

DATA_17F13B:
	db $5A,$08

DATA_17F13D:
	db $0E,$00

DATA_17F13F:
	db $06,$04,$FC

CODE_17F142:
	LDA.w $110C
	ORA.w $110D
	BNE.b CODE_17F1C4
	LDA.b $38
	AND.b #$03
	BEQ.b CODE_17F188
	TAX
	LDA.w $1150
	CLC
	ADC.w DATA_17E183-$01,x
	BPL.b CODE_17F15C
	LDA.b #$07
CODE_17F15C:
	CMP.b #$08
	BCC.b CODE_17F162
	LDA.b #$00
CODE_17F162:
	STA.w $1150
	ASL
	TAY
	REP.b #$20
	LDA.w DATA_17F12C,y
	STA.w $110C
	SEP.b #$20
	TYA
	CMP.w DATA_17F13B,x
	BEQ.b CODE_17F17C
	CMP.w DATA_17F13D,x
	BNE.b CODE_17F186
CODE_17F17C:
	REP.b #$20
	LDA.w $110C
	STA.w $1109
	SEP.b #$20
CODE_17F186:
	BRA.b CODE_17F1AD

CODE_17F188:
	LDA.b $38
	AND.b #$0C
	BEQ.b CODE_17F1B5
	LSR
	LSR
	TAX
	LDA.w $1150
	CLC
	ADC.w DATA_17F13F,x
	BMI.b CODE_17F1B5
	CMP.b #$08
	BCS.b CODE_17F1B5
	STA.w $1150
	ASL
	TAX
	REP.b #$20
	LDA.w DATA_17F12C,x
	STA.w $110C
	SEP.b #$20
CODE_17F1AD:
	LDA.b #!Define_YI_SoundID5C_ScrollTextbox
	JSL.l CODE_push_sound_queue
	BRA.b CODE_17F1C4

CODE_17F1B5:
	LDA.b $37
	AND.b #$C0
	ORA.b $38
	AND.b #$D0
	BEQ.b CODE_17F1C4
	INC.w $114E
	BRA.b CODE_17F1C4

CODE_17F1C4:
	RTS

CODE_17F1C5:
	LDA.w $1150
	CMP.b #$07
	BNE.b CODE_17F1D3
	INC.w $114E
	LDA.b #!Define_YI_SoundID08_1up
	BRA.b CODE_17F1DA

CODE_17F1D3:
	LDA.b #$10
	STA.w $114E
	LDA.b #!Define_YI_SoundID5D_SelectLevel
CODE_17F1DA:
	JSL.l CODE_push_sound_queue
	RTS

CODE_17F1DF:
	REP.b #$20
	LDA.w #$0C36
	LDX.w $1106
	BNE.b CODE_17F1ED
	CLC
	ADC.w #$0380
CODE_17F1ED:
	STA.b $00
	CLC
	ADC.w #$0040
	STA.b $02
	CLC
	ADC.w #$0040
	STA.b $04
	LDY.b #$00
	LDA.w #$398E
CODE_17F200:
	STA.b ($00),y
	STA.b ($02),y
	STA.b ($04),y
	INY
	INY
	CPY.b #$06
	BCC.b CODE_17F200
	LDA.w #$1C20
	STA.b $04
	JSR.w CODE_17D52B
	STZ.w $1107
	LDA.w #$0067
	JSR.w CODE_17CFDA
	INC.w $114E
	SEP.b #$20
	JSR.w CODE_17D005
	RTS

CODE_17F226:
	LDA.b #$67
	JSR.w CODE_17CFDA
	LDA.w $1107
	CLC
	ADC.b #$08
	STA.w $1107
	CMP.b #$40
	BCC.b CODE_17F23B
	INC.w $114E
CODE_17F23B:
	JSR.w CODE_17D005
	RTS

CODE_17F23F:
	LDA.w $1107
	SEC
	SBC.b #$08
	STA.w $1107
	BPL.b CODE_17F250
	STZ.w $1107
	INC.w $114E
CODE_17F250:
	LDA.b #$67
	JSR.w CODE_17CFDA
	JSR.w CODE_17D005
	RTS

CODE_17F259:
	JSR.w CODE_world_map_state_01_world_change_click
	STZ.w $1118
	INC.w $114E
	JSR.w CODE_17D005
	RTS

CODE_17F266:
	JSR.w CODE_world_map_state_05_new_stages_settling
	STZ.w $1118
	STZ.w $114E
	LDA.b #$10
	STA.w !RAM_YI_Global_ColorMathInitialSettings
	STZ.w !RAM_YI_Global_MainScreenWindowMask
	REP.b #$20
	STZ.w $110C
	LDA.w $1112
	ASL
	TAX
	LDA.w DATA_17E257,x
	STA.w $1109
	SEP.b #$20
	RTS

CODE_17F28A:
	INC.w $114E
	LDA.w $1150
	ASL
	TAX
	REP.b #$20
	LDA.w DATA_17EF28,x
	LDX.w $1106
	BNE.b CODE_17F2A0
	CLC
	ADC.w #$0380
CODE_17F2A0:
	STA.b $00
	CLC
	ADC.w #$0040
	STA.b $02
	CLC
	ADC.w #$0040
	STA.b $04
	LDY.b #$00
CODE_17F2B0:
	LDA.w DATA_17C9C6,y
	ORA.w #$0C00
	STA.b ($00),y
	LDA.w DATA_17C9CC,y
	ORA.w #$0C00
	STA.b ($02),y
	LDA.w DATA_17C9D2,y
	ORA.w #$0C00
	STA.b ($04),y
	INY
	INY
	CPY.b #$06
	BCC.b CODE_17F2B0
	LDA.w #$1C20
	STA.b $04
	JSR.w CODE_17D52B
	STZ.w $110E
	LDA.w #$0100
	STA.w $1110
CODE_17F2DF:
	REP.b #$20
	LDX.w $1150
	LDA.w DATA_17EF48,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	TXA
	AND.w #$00FF
	CLC
	ADC.w #$0060
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $110E
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $1110
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_08DC05>>16
	LDA.w #FXCODE_08DC05
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSR.w CODE_17E683
	REP.b #$20
	LDA.w $110E
	CLC
	ADC.w #$0008
	STA.w $110E
	LDA.w $1110
	DEC
	DEC
	STA.w $1110
	CMP.w #$0014
	BCS.b CODE_17F346
	SEP.b #$20
	LDA.b #!Define_YI_MusicID_FadeMusicCommand
	STA.b !RAM_YI_Global_PlayMusicLo
	LDA.b #!Define_YI_SoundID43_MountYoshi
	JSL.l CODE_push_sound_queue
	REP.b #$20
	STZ.w $1110
	INC.w $114E
	LDA.w #$0002
	STA.w $1113
CODE_17F346:
	REP.b #$10
	LDX.w $6092
	LDA.w $1109
	AND.w #$00FF
	SEC
	SBC.w #$0010
	STA.w $6000,x
	STA.w $6010,x
	CLC
	ADC.w #$0010
	STA.w $6008,x
	STA.w $6018,x
	LDA.w $110A
	AND.w #$00FF
	SEC
	SBC.w #$0016
	STA.w $6002,x
	STA.w $600A,x
	CLC
	ADC.w #$0010
	STA.w $6012,x
	STA.w $601A,x
	LDA.w $1150
	ASL
	TAY
	LDA.w DATA_17EF38,y
	LSR
	SEC
	SBC.w #$0600
	ORA.w #$31E0
	STA.w $6004,x
	INC
	INC
	STA.w $600C,x
	INC
	INC
	STA.w $6014,x
	INC
	INC
	STA.w $601C,x
	LDA.w #$4002
	STA.w $6006,x
	STA.w $600E,x
	STA.w $6016,x
	STA.w $601E,x
	TXA
	CLC
	ADC.w #$0020
	STA.w $6092
	SEP.b #$30
	RTS

CODE_17F3BB:
	JSR.w CODE_17C9F6
	LDA.w $1114
	CMP.b #$0B
	BCC.b CODE_17F3C8
	INC.w $114E
CODE_17F3C8:
	RTS

; LUT for CODE_arm_bonus_game_loader (bonus-game index -> $03A7 minigame ID byte).
; Indexed by $1150 (the picked bonus-game class). Values are bonus-challenge IDs:
;   $00 Coin Roundup    $04 Slot Machine      $0C Match Cards
;   $12 Roulette        $08 Drawing Lots      $16 Slot Reels    $14 Flip Cards
DATA_17F3C9:
DATA_bonus_game_id_lut:					; cosmetic alias for bonus-game-id LUT
	db $00,$04,$0C,$12,$08,$16,$14

;-------------------------------------------------------------------------
; CODE_arm_bonus_game_loader -- gm2D entry trampoline: arms the level loader for a
; bonus-game pipe / pull-into-bonus transition.
; Sets game-mode to $2D (== !Define_YI_GameMode2D) and stages the chosen
; bonus-game ID in $03A7. Then returns; the gamemode dispatcher in Bank00
; runs gm$2D next frame, which itself queues a level reload at the bonus
; room ID (typically $DA/$DB seed-contest, or $DE-$E9 bandit minigames).
;
; INPUTS:
;   M=8 X=8. $7E:1150 = bonus-game index (0..6, from the score-flip cutscene).
; OUTPUTS:
;   $7E:114E := 0 (clear secondary tick).
;   $7E:03A7 := bonus-game ID (from DATA_bonus_game_id_lut LUT).
;   $7E:0118 (!RAM_YI_Global_CurrentGameMode) := $2D.
;   $7E:0374 := $FF (no return level set yet -- gm2D will fill).
; MODIFIES: A, X.
; CALLERS:
;   CODE_gm28_world_score_flip_cutscene tail (after the score-button cinematic
;     decides the player gets to play a bonus game).
;-------------------------------------------------------------------------
CODE_17F3D0:
CODE_arm_bonus_game_loader:					; descriptive alias
	STZ.w $114E
	LDX.w $1150
	LDA.w DATA_bonus_game_id_lut,x
	STA.w $03A7
	LDA.b #!Define_YI_GameMode2D
	STA.w !RAM_YI_Global_CurrentGameMode
	LDA.b #$FF
	STA.w $0374
	RTS

; ============================================================================
; V1.0 / V1.1 split: the level-data pointer table lives in different banks.
;
; In V1.0 (`!ROM_YI_U2 == 0` branch below), this bank is where the
; %DATATABLE_YI_LevelDataPtrsAndEntranceData macro emits the 5-block
; level-pointer / entrance-data table starting at $17:F3E7. The 222-entry
; `Ptrs:` table itself starts at $17:F7C3 inside that emission. See
; docs/levelloader.md S3 for the table semantics.
;
; In V1.1 (this `if` branch is taken when !ROM_YI_U2 is set), the table is
; relocated to bank $0F (emitted at $0F:E446) and this byte range is filled
; with the original padding bytes recovered from the cart dump (`FF FE FE ...`)
; via the InsertGarbageData macro. The 95 vestigial empty .bin pointer slots
; do NOT include any of these bytes; the move is a pure bank reshuffle.
;
; Macro source: yi/Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm
;   (per-entry comments + cross-references at that file).
; ============================================================================
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($17F414, incbin, DATA_17F414_YI_U2.bin)
else
	%DATATABLE_YI_LevelDataPtrsAndEntranceData($17F3E7)
	%FREE_BYTES($17FCF7, 777, $FF)
endif
%BANK_END(<EndBank>)
endmacro
