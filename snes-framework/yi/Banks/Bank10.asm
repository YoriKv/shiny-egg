;#############################################################################################################
;# Bank10.asm -- bank $10 (LoROM PC $080000-$087FFF). Save-file IO, top-level game-mode handlers,
;#               level-header unpack, tile-streaming column/row loaders, MAP16 rewrite hook,
;#               bonus-game + intro + game-over + credits sequences.
;#
;# Contents at a glance (SNES addresses):
;#   $108000-$108109   Save-file checksum verification (SuperFX-assisted GenerateChecksum routine)
;#   $10810A-$1081DC   LoadSaveFile  -- pulls SRAM into !RAM mirror; reads lives, world, scores, items
;#   $108279-$108381   SaveGame      -- writes lives, world, scores, items + tutorial flags back to SRAM
;#   $10838B-$1083E6   Game mode $00/$01/$03 -- "Nintendo presents" splash prep/load/show
;#   $1083E7-$10888F   GSU 'Nintendo Presents' text tables + helper routines
;#   $1088FB-$108A99   Game mode $44 unknown; $01 ninpresents load helpers
;#   $108A9A-$108B02   Game mode $42 -- controller-error screen ("PLEASE TURN OFF THE POWER")
;#   $108B05-$108B14   HeaderBitLengthTable -- 15 field-width bytes + $00 terminator for level header unpack
;#   $108B15-$108D4B   UnpackLevelHeader + CheckCrossSectionSpawn
;#   $108D4C-$108E85   Game mode $0E -- in-level fade-in to player control
;#   $108E86-$109294   Game mode $11 -- in-level death sequence + new-row/new-column tile streamers
;#                       (CheckNewRowColumn, NewColumnDelta, InitNewColumn, LoadPartialColumn,
;#                        NewRowDelta, InitNewRow, LoadPartialRow)
;#   $109295-$10989F   ChangeMap16 -- writes a Map16 tile into !RAM tile grid + invalidates collision cache
;#   $109AE8-$10A13A   Game mode $2A -- "Load Bonus Game" preparation
;#   $10A13B-$10B77F   Game mode $2C -- Bonus-Game (Flip Cards / Match Cards / Slot Machine) main loop
;#   $10B780-$10CDC0   RandomListGenerator + bonus-game item lots / shuffle tables
;#   $10D74E-...       Helper routines used by bonus games + intro sequence
;#   $10DA33-$10DCAC   Game mode $38 -- "Load Intro Cutscene"
;#   $10DCAD-$10DE3E   Game mode $39 -- Intro cutscene main
;#   $10DE3F-$10DF52   Game mode $3F -- "Load Game Over"
;#   $10DF53-$10E1C0   Game mode $40 -- Game-Over main loop (GAME OVER letter animation)
;#   $10E1C1-$10E1D9   Game mode $17 -- final cinema sequence
;#   $10E1DA-$10E356   Game mode $1B -- "Load Credits"
;#   $10E357-$10E3CA   Game mode $1C -- credits begin
;#   $10E3CB-...       Game mode $1D -- credits main + scrolling text
;#   $10F000-$10FFA2   Tail-end: per-level data BLOBs (DATA_10F4xx..DATA_10FF8F incbin LevelData/*.bin)
;#
;# Cross-references:
;#   Raidenthequick: yoshisisland-disassembly/disassembly/bank10.asm  (best descriptive labels)
;#     -- DATA_save_file_ptr, CODE_save_game, gm00..gm1d, DATA_header_bit_length, CODE_unpack_level_header,
;#        check_cross_section_spawn, CODE_change_map16, CODE_random_list_generator
;#   docs/levelloader.md S3 -- level-pointer table semantics (V1.0 $17:F7C3 vs V1.1 $0F:E822).
;#   docs/leveldataengine.md S2 -- level header bit layout (HeaderBitLengthTable consumer);
;#       and S3 for the master object-stream parser.
;#   see also: ys_save.asm (save-file IO + checksum), ys_main.asm (top-level game-mode loop),
;#             ys_bonus.asm (post-level bonus games), ys_ending.asm (credits / final cinema),
;#             ys_chip*.asm (SuperFX checksum routines invoked by CODE_verify_save_checksums).
;#
;# Notes:
;# - SuperFX calls in $108000-$108100 use FXCODE_08DE83/8DE59/8DE73 to compute/verify
;#   the save-file checksum. The same SRAM block is checksummed twice (primary + copy at $707E70/$707E76).
;# - Game-mode dispatch table lives in bank $00; this file holds the per-mode handler bodies for
;#   $00,$01,$03,$0E,$11,$17,$1B,$1C,$1D,$2A,$2C,$38,$39,$3F,$40,$42,$44.
;#############################################################################################################

macro YIBank10Macros(StartBank, EndBank)
%BANK_START(<StartBank>)

;-------------------------------------------------------------------------
; CODE_verify_save_checksums -- VerifyAllSaveFileChecksums.
; Entry: long-call (RTL). Loops X=4,2,0 (three save slots) calling CODE_checksum_one_slot.
; Each iteration checksums one save-file block via SuperFX and repairs/regenerates
; if the stored checksum at $70:7E70+slot disagrees.
;-------------------------------------------------------------------------
CODE_verify_save_checksums:
CODE_108000:
	PHB
	PHK
	PLB
	REP.b #$20
	LDX.b #$04
CODE_108007:
	JSR.w CODE_checksum_one_slot
	DEX
	DEX
	BPL.b CODE_108007
	SEP.b #$20
	PLB
	RTL

;-------------------------------------------------------------------------
; DATA_save_file_ptr -- per-save-slot pointer table. Three words, one per save slot.
; Each slot is a 104-byte block at $70:7Cxx in SRAM (raid: DATA_save_file_ptr).
;-------------------------------------------------------------------------
DATA_save_file_ptr:
DATA_108012:
	dw !EXRAM_YI_Global_SaveFile1,$707C68,$707CD0

;-------------------------------------------------------------------------
; CODE_checksum_one_slot -- ChecksumOneSlot.
; In:  X = slot offset (0/2/4)
; Out: returns when checksum matches; otherwise calls regen path and loops.
; Side: $7E:000E = saved slot offset; SuperFX r0 holds latest checksum.
;-------------------------------------------------------------------------
CODE_checksum_one_slot:
CODE_108018:
	STX.b $0E
	LDA.w DATA_save_file_ptr,x
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_08DE83>>16
	LDA.w #FXCODE_08DE83
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $0E
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CMP.l $707E70,x
	BEQ.b CODE_108039
	JSR.w CODE_1080A8
	BRA.b CODE_checksum_one_slot

CODE_108039:
	RTS

DATA_10803A:
	dw $7D38,$7DA0,$7E08

DATA_108040:
	dw $0003,$0080,$0000,$0000,$0000,$0000,$8000,$0080
	dw $0000,$0000,$0000,$0000,$8000,$0080,$0000,$0000
	dw $0000,$0000,$8000,$0080,$0000,$0000,$0000,$0000
	dw $8000,$0080,$0000,$0000,$0000,$0000,$8000,$0080
	dw $0000,$0000,$0000,$0000,$8000,$0080,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000

CODE_1080A8:
	LDA.w DATA_10803A,x
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_08DE83>>16
	LDA.w #FXCODE_08DE83
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $0E
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CMP.l $707E76,x
	BEQ.b CODE_1080EB
	LDA.w #DATA_108040
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #DATA_108040>>16
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w DATA_10803A,x
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_08DE59>>16
	LDA.w #FXCODE_08DE59
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $0E
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.l $707E76,x
	BRA.b CODE_1080A8

CODE_1080EB:
	LDA.w DATA_10803A,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w DATA_save_file_ptr,x
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_08DE73>>16
	LDA.w #FXCODE_08DE73
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $0E
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.l $707E70,x
	RTS

;-------------------------------------------------------------------------
; CODE_load_save_file -- LoadSaveFile.
; Reads the currently-selected save slot's SRAM block into the running
; RAM mirror: lives, current world, per-stage scores+unlocked flags,
; pause-menu item inventory, control scheme, tutorial-message flags.
; Calls VerifyAllSaveFileChecksums (via CODE_checksum_one_slot) first to guard against
; SRAM bitrot.
;-------------------------------------------------------------------------
CODE_load_save_file:
CODE_10810A:
	PHB
	PHK
	PLB
	LDA.b #!EXRAM_YI_Global_SaveFile1>>16
	STA.b $02
	STA.b $05
	LDX.w !RAM_YI_Global_CurrentSaveFile
	REP.b #$20
	PHX
	JSR.w CODE_checksum_one_slot
	PLX
	LDA.w DATA_save_file_ptr,x
	STA.b $00
	SEP.b #$20
	LDA.b [$00]
	STA.w !RAM_YI_Level_CurrentLifeCountLo
	REP.b #$20
	INC.b $00
	INC.b $00
	SEP.b #$20
	LDY.b #$00
	LDA.b [$00]
	STA.w !RAM_YI_Level_CurrentLevelFromMapLo
	AND.b #$7F
CODE_10813A:
	CMP.b #!Define_YI_Map_LevelsPerWorld
	BCC.b CODE_108144
	SBC.b #!Define_YI_Map_LevelsPerWorld
	INY
	INY
	BRA.b CODE_10813A

CODE_108144:
	STA.w $1112
	STY.w !RAM_YI_Level_CurrentWorldLo
	REP.b #$20
	INC.b $00
	SEP.b #$20
	LDY.b #$00
CODE_108152:
	LDA.b [$00]
	PHA
	AND.b #$7F
	STA.w !RAM_YI_Map_LevelHighScores,y
	LDA.b #$00
	STA.w !RAM_YI_Map_LevelClearFlags,y
	PLA
	AND.b #$80
	BEQ.b CODE_108169
	LDA.b #$01
	STA.w !RAM_YI_Map_LevelClearFlags,y
CODE_108169:
	REP.b #$20
	INC.b $00
	SEP.b #$20
	INY
	CPY.b #$48
	BCC.b CODE_108152
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	AND.b #$7F
	TAY
	CPY.b #$35
	BCC.b CODE_108183
	LDA.w !RAM_YI_Map_LevelHighScores,y
	BNE.b CODE_108188
CODE_108183:
	LDA.b #$80
	STA.w !RAM_YI_Map_LevelClearFlags,y
CODE_108188:
	LDY.b #$00
	STZ.b $04
	INC.b $04
CODE_10818E:
	LDA.w !RAM_YI_Map_LevelClearFlags,y
	BEQ.b CODE_1081A3
	TYA
	ASL
	TAX
	REP.b #$20
	LDA.w DATA_world_unlock_ptr_world1,x
	STA.b $10
	SEP.b #$20
	LDA.b $04
	STA.b ($10)
CODE_1081A3:
	LDA.b $04
	INC
	CMP.b #$0D
	BCC.b CODE_1081AC
	LDA.b #$01
CODE_1081AC:
	STA.b $04
	INY
	CPY.b #$48
	BCC.b CODE_10818E
	LDY.b #$00
CODE_1081B5:
	LDA.b [$00]
	STA.w !RAM_YI_Level_PauseMenuItemInventory,y
	REP.b #$20
	INC.b $00
	SEP.b #$20
	INY
	CPY.b #$1B
	BCC.b CODE_1081B5
	REP.b #$20
	LDA.b [$00]
	AND.w #$00FF
	STA.w !EXRAM_YI_Global_EggThrowSetting|!EXRAMBankMirror
	INC.b $00
	LDA.b [$00]
	AND.w #$00FF
	STA.w !RAM_YI_Level_TutorialMessageFlagsLo
	SEP.b #$20
	PLB
	RTL

;-------------------------------------------------------------------------
; DATA_world_unlock_ptr_table -- per-world tile-table pointer table.
; 6 entries: world1..world6 unlocked-map-tile-ID list pointer.
;-------------------------------------------------------------------------
DATA_world_unlock_ptr_table:
DATA_1081DD:
	dw DATA_world_unlock_ptr_world1,DATA_world_unlock_ptr_world2,DATA_world_unlock_ptr_world3,DATA_world_unlock_ptr_world4,DATA_world_unlock_ptr_world5,DATA_world_unlock_ptr_world6

;-------------------------------------------------------------------------
; DATA_world_unlock_ptr_world1..DATA_world_unlock_ptr_world6 -- 6 x 12-tile-ID world unlock tables.
; Each world is 12 stages; these are the !RAM_YI_Map_LevelClearFlags indices
; in completion order. See raid bank10.asm $1081E9.
;-------------------------------------------------------------------------
DATA_world_unlock_ptr_world1:
DATA_1081E9:
	dw $030F,$0310,$0311,$0312,$0313,$0314,$0315,$0316
	dw $0317,$0318,$0319,$031A

DATA_world_unlock_ptr_world2:
DATA_108201:
	dw $031B,$031C,$031D,$031E,$031F,$0320,$0321,$0322
	dw $0323,$0324,$0325,$0326

DATA_world_unlock_ptr_world3:
DATA_108219:
	dw $0327,$0328,$0329,$032A,$032B,$032C,$032D,$032E
	dw $032F,$0330,$0331,$0332

DATA_world_unlock_ptr_world4:
DATA_108231:
	dw $0333,$0334,$0335,$0336,$0337,$0338,$0339,$033A
	dw $033B,$033C,$033D,$033E

DATA_world_unlock_ptr_world5:
DATA_108249:
	dw $033F,$0340,$0341,$0342,$0343,$0344,$0345,$0346
	dw $0347,$0348,$0349,$034A

DATA_world_unlock_ptr_world6:
DATA_108261:
	dw $034B,$034C,$034D,$034E,$034F,$0350,$0351,$0352
	dw $0353,$0354,$0355,$0356

;-------------------------------------------------------------------------
; CODE_save_game -- SaveGame.
; Writes the running RAM mirror back to the active save-slot's SRAM block:
; lives, current level (if not yet beaten), per-stage high scores
; (with bit-7 = clear-flag), per-world unlock-map updates, pause-menu
; item inventory, egg-throw control scheme, tutorial-message flags.
; Then regenerates+stores both checksums via SuperFX.
;-------------------------------------------------------------------------
CODE_save_game:
CODE_108279:
	PHB
	PHK
	PLB
	LDA.b #!EXRAM_YI_Global_SaveFile1>>16
	STA.b $02
	REP.b #$20
	LDA.w !RAM_YI_Global_CurrentSaveFile
	AND.w #$00FF
	TAX
	LDA.w DATA_save_file_ptr,x
	STA.b $00
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
	STA.b [$00]
	INC.w $0000
	INC.w $0000
	LDA.w $1135
	AND.w #$007F
	BNE.b CODE_1082AF
	LDY.w !RAM_YI_Level_CurrentLevelFromMapLo
	LDA.w !RAM_YI_Map_LevelClearFlags,y
	AND.w #$000F
	BNE.b CODE_1082AF
	TYA
	STA.b [$00]
CODE_1082AF:
	INC.b $00
	SEP.b #$20
	LDY.b #$00
CODE_1082B5:
	LDA.w !RAM_YI_Map_LevelClearFlags,y
	AND.b #$01
	BEQ.b CODE_1082C3
	LDA.w !RAM_YI_Map_LevelHighScores,y
	ORA.b #$80
	STA.b [$00]
CODE_1082C3:
	REP.b #$20
	INC.b $00
	SEP.b #$20
	INY
	CPY.b #$48
	BCC.b CODE_1082B5
	LDY.b #$00
CODE_1082D0:
	LDA.w !RAM_YI_Level_PauseMenuItemInventory,y
	STA.b [$00]
	REP.b #$20
	INC.b $00
	SEP.b #$20
	INY
	CPY.b #$1B
	BCC.b CODE_1082D0
	REP.b #$20
	LDA.w !EXRAM_YI_Global_EggThrowSetting|!EXRAMBankMirror
	STA.b [$00]
	INC.b $00
	LDA.w !RAM_YI_Level_TutorialMessageFlagsLo
	STA.b [$00]
	SEP.b #$20
	REP.b #$20
	PHX
	PHX
	LDA.w DATA_save_file_ptr,x
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_08DE83>>16
	LDA.w #FXCODE_08DE83
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.l $707E70,x
	LDA.w DATA_save_file_ptr,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w DATA_10803A,x
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_08DE73>>16
	LDA.w #FXCODE_08DE73
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.l $707E76,x
	SEP.b #$20
	PLB
	RTL

CODE_10832C:
	PHB
	PHK
	PLB
	REP.b #$20
	LDA.w $111D
	ASL
	TAX
	LDA.w $1134
	ASL
	TAY
	PHX
	PHX
	LDA.w DATA_save_file_ptr,y
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w DATA_10803A,x
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_08DE73>>16
	LDA.w #FXCODE_08DE73
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.l $707E76,x
	LDA.w DATA_10803A,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w DATA_save_file_ptr,x
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_08DE73>>16
	LDA.w #FXCODE_08DE73
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.l $707E70,x
	SEP.b #$20
	PLB
	RTL

;-------------------------------------------------------------------------
; DATA_ninpresents_gsu_table -- "Nintendo Presents" GSU plot table (4 quads of vram-dest + tile).
;-------------------------------------------------------------------------
DATA_ninpresents_gsu_table:
DATA_10837B:
	dw $6060,$0000,$6070,$0002,$6080,$0004,$6090,$0006

;-------------------------------------------------------------------------
; CODE_gm00_ninpresents_prep -- Game mode $00: NintendoPresents_Prep.
; First-frame setup for the "(c) 1995 Nintendo presents" splash.
; Resets PPU, initializes OAM, clears CGRAM, kicks off save-file checksum
; verification via CODE_verify_save_checksums, then sets a 128-frame display timer ($011A=$80).
;-------------------------------------------------------------------------
CODE_gm00_ninpresents_prep:
CODE_10838B:
	JSL.l CODE_0082D0
	JSL.l CODE_init_oam_and_bg3_tilemap
	LDX.b #$02
	JSL.l CODE_init_scene_regs
	LDA.b #$10
	STA.w !REGISTER_MainScreenLayers
	LDA.w !REGISTER_PPUStatusFlag2
	AND.b #$10
	BEQ.b CODE_1083AB
	JSR.w CODE_1086EC
	JMP.w CODE_1083E5

CODE_1083AB:
	REP.b #$10
	LDY.w #$0068
	JSL.l CODE_load_compressed_gfx_files_l
	REP.b #$30
	LDX.w #$0040
	JSL.l CODE_00BB05
	JSR.w CODE_108A6D
	LDX.b #$0F
CODE_1083C2:
	LDA.w DATA_ninpresents_gsu_table,x
	STA.l $006A00,x
	DEX
	BPL.b CODE_1083C2
	LDA.b #$AA
	STA.l $006C00
	JSL.l CODE_verify_save_checksums
	STZ.w $0202
	LDA.b #$80
	STA.w $011A
CODE_enable_nmi_and_advance:
CODE_1083DE:
	JSL.l CODE_enable_nmi
;-------------------------------------------------------------------------
; CODE_increment_gamemode -- IncrementGameMode (raid: CODE_increment_gamemode).
; The standard "end this game-mode frame, advance to next mode" stub.
; Used as a JML target from many other gamemode handlers.
;-------------------------------------------------------------------------
CODE_increment_gamemode:
CODE_1083E2:
	INC.w !RAM_YI_Global_CurrentGameMode
CODE_1083E5:
	PLB
	RTL

;-------------------------------------------------------------------------
; CODE_gm03_ninpresents_show -- Game mode $03: NintendoPresents_Show.
; Per-frame: decrement timer at $011A. When it hits 0, advance to gamemode $04.
;-------------------------------------------------------------------------
CODE_gm03_ninpresents_show:
CODE_1083E7:
	DEC.w $011A
	BNE.b CODE_1083E5
	JML.l CODE_increment_gamemode

;-------------------------------------------------------------------------
; DATA_ninpresents_text_stream..DATA_1086EB -- GSU plot-stream tables for the "Nintendo
; presents" and "(c) 1995 designed for you by..." text. Format is variable-
; length records of (xpos, ypos, attr, tile_id...) ending in $FFFF terminators.
; The GSU draws each character row to BG1 via FXCODE plot routines.
;-------------------------------------------------------------------------
DATA_ninpresents_text_stream:
DATA_1083F0:
	dw $00FE,$00FD,$30FC,$B1BD,$BCB2,$B0D0,$B6AA,$D0AE
	dw $AAB9,$D0B4,$BCB2,$B7D0,$BDB8,$01FE,$08FD,$28FC
	dw $AEAD,$B2BC,$B7B0,$ADAE,$AFD0,$BBB8,$C2D0,$BEB8
	dw $FEBB,$FD02,$FC10,$BC4C,$B9BE,$BBAE,$AFD0,$B6AA
	dw $ACB2,$B6B8,$03FE,$18FD,$74FC,$BBB8,$FEFF,$FD00
	dw $FC00,$BC14,$B9BE,$BBAE,$B7D0,$BCAE,$FEF3,$FD01
	dw $FC08,$B710,$B7B2,$AEBD,$ADB7,$D0B8,$B8AC,$FCF3
	dw $CF64,$FCD0,$B574,$ADBD,$FFF3

DATA_10846A:
	dw $004F,$0000,$0001,$0002,$0003,$0004,$0005,$0006
	dw $0007,$0008,$0009,$000A,$000B,$000C,$000D,$000E
	dw $000F,$0040,$0041,$0042,$0043,$0044,$0045,$0046
	dw $0047,$0048,$0049,$004A,$004B,$004C,$004D

DATA_1084A8:
	dw $0400,$0401,$0402,$0403,$0404,$0405,$0406,$0407
	dw $0408,$0409,$040A,$040B,$040C,$040D,$040E,$040F
	dw $0440,$0441,$0442,$0443,$0444,$0445,$0446,$0447
	dw $0448,$0449,$044A,$044B,$044C,$044D

DATA_1084E4:
	dw $0010,$0011,$0012,$0013,$0014,$0015,$0016,$0017
	dw $0018,$0019,$001A,$001B,$001C,$001D,$001E,$001F
	dw $0050,$0051,$0052,$0053,$0054,$0055,$0056,$0057
	dw $0058,$0059,$005A

DATA_10851A:
	dw $0410,$0411,$0412,$0413,$0414,$0415,$0416,$0417
	dw $0418,$0419,$041A,$041B,$041C,$041D,$041E,$041F
	dw $0450,$0451,$0452,$0453,$0454,$0455,$0456,$0457
	dw $0458,$0459,$045A

DATA_108550:
	dw $0020,$0021,$0022,$0023,$0024,$0025,$0026,$0027
	dw $0028,$0029,$002A,$002B,$002C,$002D,$002E,$002F
	dw $0060,$0061,$0062,$0063,$0064,$0065,$0066,$0067
	dw $0068,$0069,$006A,$006B,$006C,$006D

DATA_10858C:
	dw $0420,$0421,$0422,$0423,$0424,$0425,$0426,$0427
	dw $0428,$0429,$042A,$042B,$042C,$042D,$042E,$042F
	dw $0460,$0461,$0462,$0463,$0464,$0465,$0466,$0467
	dw $0468,$0469,$046A,$046B,$046C,$046D

DATA_1085C8:
	dw $0030,$0031,$0032,$0033,$0034,$0035,$0036,$0037
	dw $0038,$0039,$003A,$003B,$003C,$003D,$003E,$003F
	dw $0070,$0071,$0072,$0073,$0074,$0075,$0076,$0077
	dw $0078,$0079,$007A,$007B,$007C,$007D,$007E

DATA_108606:
	dw $0430,$0431,$0432,$0433,$0434,$0435,$0436,$0437
	dw $0438,$0439,$043A,$043B,$043C,$043D,$043E,$043F
	dw $0470,$0471,$0472,$0473,$0474,$0475,$0476,$0477
	dw $0478,$0479,$047A,$047B,$047C,$047D,$047E

DATA_108644:
	dw $0080,$0081,$0082,$0083,$0084,$0085,$0086,$0087
	dw $0088,$0089,$008A,$008B,$008C,$008D,$008E,$008F
	dw $00C0,$00C1

DATA_108668:
	dw $0480,$0481,$0482,$0483,$0484,$0485,$0486,$0487
	dw $0488,$0489,$048A,$048B,$048C,$048D,$048E,$048F
	dw $04C0,$04C1

DATA_10868C:
	dw $0090,$0091,$0092,$0093,$0094,$0095,$0096,$0097
	dw $0098,$0099,$009A,$009B,$009C,$009D,$009E,$009F
	dw $00D0,$00D1,$00D2,$00D3,$00D4,$00D5,$00D6,$00D7

DATA_1086BC:
	dw $0490,$0491,$0492,$0493,$0494,$0495,$0496,$0497
	dw $0498,$0499,$049A,$049B,$049C,$049D,$049E,$049F
	dw $04D0,$04D1,$04D2,$04D3,$04D4,$04D5,$04D6,$04D7

CODE_1086EC:
	LDA.b #$04
	STA.w !REGISTER_MainScreenLayers
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.w $012E
	AND.b #(!SuperFX_ScreenMode_ColorMode_16Colors^$FF)+$01
	STA.w $012E
	LDA.b #$13
	STA.w $012D
	LDA.b #DATA_ninpresents_text_stream>>16
	STA.w $60AA
	REP.b #$20
	LDA.w #DATA_ninpresents_text_stream
	STA.w $60A8
	LDX.b #FXCODE_09E9AF>>16
	LDA.w #FXCODE_09E9AF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	JSR.w CODE_1087C4
	LDA.b #$10
	STA.w $60AA
	REP.b #$20
	LDA.w #$843D
	STA.w $60A8
	LDX.b #FXCODE_09E9AF>>16
	LDA.w #FXCODE_09E9AF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b #$80
	STX.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #$6400
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #$704C00
	STA.w DMA[$00].SourceLo
	LDX.b #$704C00>>16
	STX.w DMA[$00].SourceBank
	LDA.w #$0800
	STA.w DMA[$00].SizeLo
	LDY.b #$01
	STY.w !REGISTER_DMAEnable
	LDA.w #$7A29
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #DATA_108644
	STA.w DMA[$00].SourceLo
	LDX.b #DATA_108644>>16
	STX.w DMA[$00].SourceBank
	LDA.w #$0024
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	LDA.w #$7A49
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #DATA_108668
	STA.w DMA[$00].SourceLo
	LDA.w #$0024
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	LDA.w #$7AC5
else
	LDA.w #$7AC6
endif
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #DATA_10868C
	STA.w DMA[$00].SourceLo
	LDA.w #$0030
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	LDA.w #$7AE5
else
	LDA.w #$7AE6
endif
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #DATA_1086BC
	STA.w DMA[$00].SourceLo
	LDA.w #$0030
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	SEP.b #$20
	LDA.b #!Define_YI_GameMode43
	STA.w !RAM_YI_Global_CurrentGameMode
	JSL.l CODE_enable_nmi
	RTS

CODE_1087C4:
	REP.b #$20
	LDX.b #$80
	STX.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #$6000
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #$704C00
	STA.w DMA[$00].SourceLo
	LDX.b #$704C00>>16
	STX.w DMA[$00].SourceBank
	LDA.w #$0800
	STA.w DMA[$00].SizeLo
	LDY.b #$01
	STY.w !REGISTER_DMAEnable
	LDX.b #$00
	STX.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #$7800
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$09
	STA.w DMA[$00].Parameters
	LDA.w #DATA_10846A
	STA.w DMA[$00].SourceLo
	LDX.b #DATA_10846A>>16
	STX.w DMA[$00].SourceBank
	LDA.w #$0800
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	LDX.b #$80
	STX.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #$7800
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortHi&$0000FF)<<8)+$09
	STA.w DMA[$00].Parameters
	LDA.w #DATA_10846A+$01
	STA.w DMA[$00].SourceLo
	LDA.w #$0800
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	LDA.w #$78A1
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #DATA_10846A+$02
	STA.w DMA[$00].SourceLo
	LDX.b #(DATA_10846A+$02)>>16
	STX.w DMA[$00].SourceBank
	LDA.w #$003C
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	LDA.w #$78C1
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #DATA_1084A8
	STA.w DMA[$00].SourceLo
	LDA.w #$003C
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	LDA.w #$7903
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #DATA_1084E4
	STA.w DMA[$00].SourceLo
	LDA.w #$0036
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	LDA.w #$7923
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #DATA_10851A
	STA.w DMA[$00].SourceLo
	LDA.w #$0036
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	LDA.w #$7960
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #DATA_108550
	STA.w DMA[$00].SourceLo
	LDA.w #$003C
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	LDA.w #$7980
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #DATA_10858C
	STA.w DMA[$00].SourceLo
	LDA.w #$003C
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	LDA.w #$79C0
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #DATA_1085C8
	STA.w DMA[$00].SourceLo
	LDA.w #$003E
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	LDA.w #$79E0
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #DATA_108606
	STA.w DMA[$00].SourceLo
	LDA.w #$003E
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	LDA.w #$7FFF
	STA.l YI_Global_PaletteMirror[$01].LowByte
	STA.l YI_Global_PaletteMirror[$03].LowByte
	STA.l YI_Global_PaletteMirror[$06].LowByte
	STA.l YI_Global_PaletteMirror[$07].LowByte
	SEP.b #$20
	RTS

;-------------------------------------------------------------------------
; CODE_gm44_unknown -- Game mode $44: unknown (raid: CODE_gm44_unknown).
; Lightweight palette-fade variant similar to gm42; nudges the live palette
; mirror toward $8000 (white) then advances to next gamemode.
;-------------------------------------------------------------------------
CODE_gm44_unknown:
CODE_1088FB:
	REP.b #$20
	LDA.l YI_Global_PaletteMirror[$01].LowByte
	INC
	CMP.w #$8000
	BCC.b CODE_10890A
	LDA.w #$0000
CODE_10890A:
	STA.l YI_Global_PaletteMirror[$01].LowByte
	STA.l YI_Global_PaletteMirror[$03].LowByte
	STA.l YI_Global_PaletteMirror[$06].LowByte
	STA.l YI_Global_PaletteMirror[$07].LowByte
	SEP.b #$20
	PLB
	RTL

;-------------------------------------------------------------------------
; CODE_gm01_ninpresents_load -- Game mode $01: NintendoPresents_Load.
; Pulls the next character record from the text stream and triggers the
; SuperFX plot for that character. Advances gamemode when stream-end byte
; ($FF) is hit.
;-------------------------------------------------------------------------
CODE_gm01_ninpresents_load:
CODE_10891E:
	JSR.w CODE_108987
	LDA.b $00
	CMP.b #$FF
	BNE.b CODE_10892D
	LDA.b $01
	CMP.b #$FF
	BNE.b CODE_108953
CODE_10892D:
	LDA.b $02
	CMP.b #$FF
	BNE.b CODE_108939
	LDA.b $03
	CMP.b #$FF
	BNE.b CODE_108953
CODE_108939:
	LDA.w !REGISTER_Joypad1Lo
	AND.b #$0F
	CMP.b #$01
	BEQ.b CODE_108953
	CMP.b #$0F
	BEQ.b CODE_108953
	LDA.w !REGISTER_Joypad2Lo
	AND.b #$0F
	CMP.b #$01
	BEQ.b CODE_108953
	CMP.b #$0F
	BNE.b CODE_10897E
CODE_108953:
	JSL.l CODE_clear_all_sprites
	JSL.l CODE_init_oam_buffer
	REP.b #$20
	PHB
	LDX.b #$702000>>16
	PHX
	PLB
	LDX.b #$7E
CODE_108964:
	STZ.w $702000,x
	STZ.w $702080,x
	STZ.w $702100,x
	STZ.w $702180,x
	DEX
	DEX
	BPL.b CODE_108964
	PLB
	SEP.b #$20
	LDA.b #!Define_YI_GameMode41
	STA.w !RAM_YI_Global_CurrentGameMode
	BRA.b CODE_108985

CODE_10897E:
	LDA.b #!Define_YI_SoundID09_Coin
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	INC.w !RAM_YI_Global_CurrentGameMode
CODE_108985:
	PLB
	RTL

CODE_108987:
	LDA.w !REGISTER_JoypadSerialPort1
	ORA.b #$01
	STA.w !REGISTER_JoypadSerialPort1
	STZ.b $00
	STZ.b $02
	LDX.b #$07
CODE_108995:
	ASL.b $00
	LDA.w !REGISTER_JoypadSerialPort1
	AND.b #$02
	LSR
	ORA.b $00
	STA.b $00
	ASL.b $02
	LDA.w !REGISTER_JoypadSerialPort2
	AND.b #$02
	LSR
	ORA.b $02
	STA.b $02
	DEX
	BPL.b CODE_108995
	LDA.w !REGISTER_JoypadSerialPort1
	AND.b #$FE
	STA.w !REGISTER_JoypadSerialPort1
	STZ.b $01
	STZ.b $03
	STZ.b $03
	LDX.b #$07
CODE_1089C0:
	ASL.b $01
	LDA.w !REGISTER_JoypadSerialPort1
	AND.b #$02
	LSR
	ORA.b $01
	STA.b $01
	ASL.b $03
	LDA.w !REGISTER_JoypadSerialPort2
	AND.b #$02
	LSR
	ORA.b $03
	STA.b $03
	DEX
	BPL.b CODE_1089C0
	RTS

DATA_1089DC:
	db $FE,$00,$FD,$00,$FC,$00,$BD,$B1,$B2,$BC,$D0,$B0,$AA,$B6,$AE,$D0
	db $B2,$BC,$D0,$AD,$AE,$BC,$B2,$B0,$B7,$AE,$AD,$D0,$B8,$B7,$B5,$C2
	db $D0,$BD,$B8,$D0,$B9,$B5,$AA,$C2,$D0,$FE,$01,$FD,$08,$FC,$06,$C0
	db $B2,$BD,$B1,$D0,$AA,$D0,$B7,$B8,$BB,$B6,$AA,$B5,$D0,$AC,$B8,$B7
	db $BD,$BB,$B8,$B5,$B5,$AE,$BB,$F3,$FE,$02,$FD,$10,$FC,$20,$B9,$B5
	db $AE,$AA,$BC,$AE,$D0,$AD,$B2,$BC,$AC,$B8,$B7,$B7,$AE,$AC,$BD,$D0
	db $B6,$B8,$BE,$BC,$AE,$CF,$D0,$FE,$03,$FD,$18,$FC,$00,$BC,$BE,$B9
	db $AE,$BB,$D0,$BC,$AC,$B8,$B9,$AE,$CF,$D0,$AE,$BD,$AC,$F3,$D0,$BD
	db $B8,$D0,$BC,$BD,$AA,$BB,$BD,$D0,$B9,$B5,$AA,$C2,$B2,$B7,$B0,$F3
	db $FF

CODE_108A6D:
	STZ.b !RAM_YI_Global_Layer3XPosLo
	STZ.b !RAM_YI_Global_Layer3XPosHi
	LDA.w $012E
	AND.b #(!SuperFX_ScreenMode_ColorMode_16Colors^$FF)+$01
	STA.w $012E
	LDA.b #$13
	STA.w $012D
	LDA.b #DATA_1089DC>>16
	STA.w $60AA
	REP.b #$20
	LDA.w #DATA_1089DC
	STA.w $60A8
	LDX.b #FXCODE_09E9AF>>16
	LDA.w #FXCODE_09E9AF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	JSR.w CODE_1087C4
	RTS

;-------------------------------------------------------------------------
; CODE_gm42_controller_error -- Game mode $42: ControllerErrorScreen.
; "PLEASE TURN OFF THE POWER" red-text screen shown when the controller
; checksum/handshake fails. Fades palette to white then halts (gamemode
; never advances; only a hard reset escapes).
;-------------------------------------------------------------------------
CODE_gm42_controller_error:
CODE_108A9A:
	REP.b #$20
	LDA.l YI_Global_PaletteMirror[$01].LowByte
	INC
	CMP.w #$8000
	BCC.b CODE_108AA9
	LDA.w #$0000
CODE_108AA9:
	STA.l YI_Global_PaletteMirror[$01].LowByte
	STA.l YI_Global_PaletteMirror[$03].LowByte
	STA.l YI_Global_PaletteMirror[$06].LowByte
	STA.l YI_Global_PaletteMirror[$07].LowByte
	SEP.b #$20
	JSR.w CODE_108987
	LDA.b $00
	CMP.b #$FF
	BNE.b CODE_108ACA
	LDA.b $01
	CMP.b #$FF
	BNE.b CODE_108AFB
CODE_108ACA:
	LDA.b $02
	CMP.b #$FF
	BNE.b CODE_108AD6
	LDA.b $03
	CMP.b #$FF
	BNE.b CODE_108AFB
CODE_108AD6:
	LDA.w !REGISTER_Joypad1Lo
	AND.b #$0F
	CMP.b #$01
	BEQ.b CODE_108AFB
	CMP.b #$0F
	BEQ.b CODE_108AFB
	LDA.w !REGISTER_Joypad2Lo
	AND.b #$0F
	CMP.b #$01
	BEQ.b CODE_108AFB
	CMP.b #$0F
	BEQ.b CODE_108AFB
	STZ.w $0201
	STZ.w $0200
	STZ.w !RAM_YI_Global_CurrentGameMode
	BRA.b CODE_108B03

CODE_108AFB:
	LDA.b #$04
	STA.w !REGISTER_MainScreenLayers
	STA.w !RAM_YI_Global_MainScreenLayers
CODE_108B03:
	PLB
	RTL

;-------------------------------------------------------------------------
; DATA_header_bit_length -- HeaderBitLengthTable (raid: DATA_header_bit_length).
; The 15 bit-widths used by UnpackLevelHeader to decode the packed 75-bit
; level header into 15 word slots at $7E:0134+. Final $00 is a sentinel that
; terminates the unpack loop. Each entry is one header field width (bits):
;   0:5  BG color           1:4  BG1 tileset        2:5  BG1 palette
;   3:5  BG2 tileset        4:6  BG2 palette        5:6  BG3 tileset
;   6:6  BG3 palette        7:7  sprite tileset     8:4  sprite palette
;   9:5  level mode        10:6  animation tileset 11:5  animation palette
;  12:5  BG scroll rate    13:4  music             14:2  item memory
;  15:0  (terminator)
; Total bits = 75; on-disk header rounds to 10 bytes (5 unused pad bits at end).
; See docs/leveldataengine.md S2 for the on-disk layout and runtime WRAM mirrors.
; Field-name disagreement: the brunovalads wiki and Raidenthequick's header_info.txt
; agree on fields 1-9 (BG color, BG1/2/3 tileset/palette, sprite tileset/palette)
; and field 14 (music), but disagree on fields 10-15:
;   field 10: "Level mode" (wiki) vs "Layer/Ordering Property" (Raidenthequick)
;   field 11: "Animation tileset" vs "Unknown (always 0)"
;   field 12: "Animation palette" vs "Layer 3 Tileset"
;   field 13: "BG scroll rate" vs "Special Effects"
;   field 15: "Item memory" (2 bits) vs "Initial layer 2 position"
; Both are observation-based guesses. Working rule: trust the WRAM destination
; address ($7E:0134..0152) and the SuperFX consumer code over either label set.
; Our RAM_Map_YI.asm names follow the brunovalads wiki convention.
;-------------------------------------------------------------------------
DATA_header_bit_length:
DATA_108B05:
	db $05,$04,$05,$05,$06,$06,$06,$07,$04,$05,$06,$05,$05,$04,$02,$00

;-------------------------------------------------------------------------
; CODE_unpack_level_header -- UnpackLevelHeader.
; Variable-bit-width unpacker: walks DATA_header_bit_length, peels off N bits at a
; time from the source stream, stores each field as a u16 starting at
; $7E:0134 (RAM_YI_Level_LevelHeader). See docs/leveldataengine.md S2 for the
; on-disk header layout consumed here.
;-------------------------------------------------------------------------
CODE_unpack_level_header:
CODE_108B15:
	PHB
	PHK
	PLB
	REP.b #$10
	LDY.w #$0000
	LDX.w #$0000
	STX.b $99
	STZ.b $02
	LDA.w DATA_header_bit_length,x
CODE_108B27:
	STA.b $04
	LDA.b #$00
CODE_108B2B:
	DEC.b $02
	BPL.b CODE_108B40
	PHA
	LDA.b #$07
	STA.b $02
	PHY
	LDY.b $99
	LDA.b [!RAM_YI_Level_LevelDataPtrLo],y
	STA.b $06
	INY
	STY.b $99
	PLY
	PLA
CODE_108B40:
	ASL.b $06
	ROL
	DEC.w $0004
	BNE.b CODE_108B2B
	STA.w !RAM_YI_Level_LevelHeaderBackgroundColorLo,y
	INY
	INY
	INX
	LDA.w DATA_header_bit_length,x
	BNE.b CODE_108B27
	LDA.w !RAM_YI_Level_LevelHeaderItemMemorySettingLo
	STA.w !RAM_YI_Level_CheckpointReentryPageLo	; copy header item-memory setting into the checkpoint re-entry page selector
	SEP.b #$10
	PLB
	RTL

;-------------------------------------------------------------------------
; CODE_unpack_header_then_load_objects -- UnpackHeaderThenLoadObjects.
; Convenience wrapper: unpack the level header (CODE_unpack_level_header) then fall
; through into the object-stream loader (CODE_load_level_object_stream). Entry point for
; "full level load from scratch".
;-------------------------------------------------------------------------
CODE_unpack_header_then_load_objects:
CODE_108B5D:
	JSL.l CODE_unpack_level_header
;-------------------------------------------------------------------------
; CODE_load_level_object_stream -- LoadLevelObjectStream.
; Walks the object stream pointed to by !RAM_YI_Level_LevelDataPtr,
; dispatching each object (Map16 paint, screen-exit, sprite spawn,
; cross-section trigger) into the level-data buffer at $7F:8000+. Sets
; up the per-screen Map16-cache invalidation tables along the way.
;-------------------------------------------------------------------------
CODE_load_level_object_stream:
CODE_108B61:
	PHB
	PHK
	PLB
	JSL.l CODE_init_per_tileset_template_slots
	REP.b #$20
	PHB
	LDX.b #$70449E>>16
	PHX
	PLB
	LDX.b #$00
CODE_108B71:
	STZ.w $70449E,x
	INX
	INX
	CPX.b #$78
	BCC.b CODE_108B71
	LDX.b #$7F7DFE>>16
	PHX
	PLB
	REP.b #$10
	LDX.w #$8200
CODE_108B83:
	STZ.w $7F7DFE,x
	DEX
	DEX
	BNE.b CODE_108B83
	PLB
	LDX.w #$000E
CODE_108B8E:
	STZ.w $0D4E,x
	STZ.w $0D5E,x
	STZ.w $0D6E,x
	STZ.w $0D7E,x
	DEX
	DEX
	BPL.b CODE_108B8E
	SEP.b #$30
	STZ.w $0D4D
	LDA.b #$80
	LDX.b #$7F
CODE_108BA7:
	STA.w $6CAA,x
	DEX
	BPL.b CODE_108BA7
	STZ.b $97
CODE_108BAF:
	REP.b #$30
	LDA.w #$0001
	STA.b $2A
	STA.b $2E
	STZ.b $15
	SEP.b #$20
	LDY.b $99
	LDA.b [!RAM_YI_Level_LevelDataPtrLo],y
	STA.b $15
	INY
	LDA.b [!RAM_YI_Level_LevelDataPtrLo],y
	STA.b $1C
	INY
	LDA.b [!RAM_YI_Level_LevelDataPtrLo],y
	STA.b $1B
	LDA.b $15
	BEQ.b CODE_108C13
	CMP.b #$FF
	BNE.b CODE_108C33
	LDA.b $1C
	BMI.b CODE_108C04
	REP.b #$20
CODE_108BDA:
	AND.w #$007F
	ASL
	ASL
	TAX
	LDA.b [!RAM_YI_Level_LevelDataPtrLo],y
	STA.l $7F7E00,x
	INY
	LDA.b [!RAM_YI_Level_LevelDataPtrLo],y
	STA.l $7F7E01,x
	INY
	LDA.b [!RAM_YI_Level_LevelDataPtrLo],y
	STA.l $7F7E02,x
	INY
	LDA.b [!RAM_YI_Level_LevelDataPtrLo],y
	INY
	INY
	XBA
	AND.w #$00FF
	CMP.w #$00FF
	BNE.b CODE_108BDA
	SEP.b #$20
CODE_108C04:
	SEP.b #$10
	LDX.b #$7F
CODE_108C08:
	LDA.w $6CAA,x
	STA.w $6D6A,x
	DEX
	BPL.b CODE_108C08
	PLB
	RTL

CODE_108C13:
	PHK
	PEA.w CODE_108BAF-$01
	LDA.b #(CODE_extobj_handler_default_00_09-$01)>>16
	PHA
	PHA
	PLB
	INY
	LDA.b [!RAM_YI_Level_LevelDataPtrLo],y
	STA.b $15
	INY
	STY.b $99
	REP.b #$20
	AND.w #$00FF
	ASL
	TAX
	LDA.l DATA_extended_object_init_ptrs,x
	PHA
	SEP.b #$30
	RTL

CODE_108C33:
	PHK
	PEA.w CODE_108BAF-$01
	REP.b #$20
	LDX.b $15
	LDA.l DATA_object_property_table,x
	AND.w #$0003
	CMP.w #$0001
	BEQ.b CODE_108C6D
	TAX
	INY
	LDA.b [!RAM_YI_Level_LevelDataPtrLo],y
	STA.b $0A
	BIT.w #$0080
	BEQ.b CODE_108C62
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CMP.w #$0002
	BEQ.b CODE_108C62
	LDA.b $0A
	ORA.w #$FF00
	DEC
	BRA.b CODE_108C68

CODE_108C62:
	LDA.b $0A
	AND.w #$00FF
	INC
CODE_108C68:
	STA.b $2A
	TXA
	BEQ.b CODE_108C81
CODE_108C6D:
	INY
	LDA.b [!RAM_YI_Level_LevelDataPtrLo],y
	BIT.w #$0080
	BEQ.b CODE_108C7B
	ORA.w #$FF00
	DEC
	BRA.b CODE_108C7F

CODE_108C7B:
	AND.w #$00FF
	INC
CODE_108C7F:
	STA.b $2E
CODE_108C81:
	INY
	STY.b $99
	LDA.b $15
	ASL
	TAX
	SEP.b #$20
	LDA.b #(CODE_129191-$01)>>16
	PHA
	PHA
	PLB
	LDA.w DATA_standard_object_init_ptrs+$01,x
	PHA
	LDA.w DATA_standard_object_init_ptrs,x
	PHA
	SEP.b #$10
	RTL

CODE_108C9A:
	LDA.w !RAM_YI_Level_LevelHeaderBG3TilesetLo
	CMP.b #$0A
	BEQ.b CODE_108CA2
CODE_108CA1:
	RTL

CODE_108CA2:
	LDA.b $77
	ORA.b $79
	BEQ.b CODE_108CA1
	PHB
	PHK
	PLB
	REP.b #$20
	LDA.w #$C07F
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$2100
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.b $7D
	BIT.w #$0400
	BEQ.b CODE_108CC3
	ORA.w #$0020
CODE_108CC3:
	AND.w #$003E
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_08BC36>>16
	LDA.w #FXCODE_08BC36
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b #$7E4800>>16
	PHX
	PLB
	REP.b #$10
	LDX.w $7E4800
	LDA.b $77
	BEQ.b CODE_108D14
	LDA.b $7B
	AND.w #$07FF
	BIT.w #$0400
	BEQ.b CODE_108CEC
	EOR.w #$0420
CODE_108CEC:
	LSR
	ORA.w #$3400
	STA.w $0000,x
	LDA.w #$0181
	STA.w $0002,x
	LDA.w #$0418
	STA.w $0004,x
	LDA.w #$7026
	STA.w $0006,x
	LDA.w #$0040
	STA.w $0008,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,x
	TAX
CODE_108D14:
	LDA.b $79
	BEQ.b CODE_108D45
	LDA.b $8B
	AND.w #$01F0
	ASL
	ORA.w #$3400
	STA.w $0000,x
	LDA.w #$0180
	STA.w $0002,x
	LDA.w #$4418
	STA.w $0004,x
	LDA.w #$7026
	STA.w $0006,x
	LDA.w #$0040
	STA.w $0008,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,x
	TAX
CODE_108D45:
	STX.w $7E4800
	SEP.b #$30
	PLB
	RTL

;-------------------------------------------------------------------------
; CODE_gm0e_level_fadein_to_control -- Game mode $0E: LevelFadeInToControl.
; Per-frame handler that drives the level fade-in and hands control to
; the player when complete. Runs scrolling-camera updates and the
; cross-section spawn check while the fade is still in progress.
;-------------------------------------------------------------------------
CODE_gm0e_level_fadein_to_control:
CODE_108D4C:
	LDA.b $8D
	BEQ.b CODE_108D75
	REP.b #$30
	JSR.w CODE_108F88
	SEP.b #$30
	JSL.l CODE_00C71E
	DEC.b $8D
	BNE.b CODE_108D73
	JSL.l CODE_check_newspr_screen
	LDX.b #$5C
CODE_108D65:
	LDA.w $74A2,x
	ORA.b #$80
	STA.w $74A2,x
	DEX
	DEX
	DEX
	DEX
	BNE.b CODE_108D65
CODE_108D73:
	PLB
	RTL

CODE_108D75:
	LDA.w $0B4C
	BEQ.b CODE_108D8A
	REP.b #$20
	LDY.w $0B54
	INY
	BEQ.b CODE_108DBB
	SEP.b #$20
	JSL.l CODE_108E00
	BRA.b CODE_108DE8

CODE_108D8A:
	SEP.b #$20
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	CMP.b #!Define_YI_LevelID_HopHopDonutLifts
	BEQ.b CODE_108D9B
	CMP.b #!Define_YI_LevelID_LakitusWall
	BEQ.b CODE_108D9B
	CMP.b #!Define_YI_LevelID_ShiftingPlatformsAhead
	BNE.b CODE_108DA0
CODE_108D9B:
	LDX.b #$02
	STX.w $60C4
CODE_108DA0:
	CMP.b #!Define_YI_LevelID_WelcomeToYoshisIsland
	BNE.b CODE_108DB5
	LDA.b $35
	AND.b #$F0
	ORA.b $36
	BEQ.b CODE_108DE8
	INC.w !RAM_YI_Level_MessageBoxState 
	LDA.b #$25
	STA.l $704070
CODE_108DB5:
	INC.w !RAM_YI_Global_CurrentGameMode
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
CODE_108DBB:
	STZ.w $0B4C
	SEP.b #$20
	STZ.w !RAM_YI_Global_MainScreenWindowMask
	STZ.w !RAM_YI_Global_SubScreenWindowMask
	STZ.w !RAM_YI_Global_BG1And2WindowMaskSettings
	STZ.w !RAM_YI_Global_BG3And4WindowMaskSettings
	STZ.w !RAM_YI_Global_ObjectAndColorWindowSettings
	LDA.b #$20
	TRB.w !RAM_YI_Global_HDMAEnable
	LDX.b #$5C
CODE_108DD6:
	LDA.w $74A2,x
	CMP.b #$FF
	BEQ.b CODE_108DE2
	AND.b #$7F
	STA.w $74A2,x
CODE_108DE2:
	DEX
	DEX
	DEX
	DEX
	BNE.b CODE_108DD6
CODE_108DE8:
	SEP.b #$20
	JSL.l CODE_gm0f_core_init
	PLB
	RTL

DATA_108DF0:
	db $33,$23,$17,$15,$00

DATA_108DF5:
	db $0C,$04,$02,$02,$01

DATA_108DFA:
	db $20,$10,$00

DATA_108DFD:
	db $20,$10,$08

CODE_108E00:
	PHB
	PHK
	PLB
	LDX.w $0B54
	BEQ.b CODE_108E1D
	CPX.b #$FF
	BEQ.b CODE_108E80
	LDA.b #$00
	STA.w $0B54
	LDA.b #$FF
	STA.w $0B50
	LDA.b #$FF
	STA.w $0B51
	BRA.b CODE_108E67

CODE_108E1D:
	LDA.w $0B50
	BEQ.b CODE_108E3E
	LDX.w $0B52
	LDA.w $0B50
	CMP.w DATA_108DF0,x
	BCS.b CODE_108E2E
	INX
CODE_108E2E:
	LDA.w $0B50
	SEC
	SBC.w DATA_108DF5,x
	BCS.b CODE_108E39
	LDA.b #$00
CODE_108E39:
	STA.w $0B50
	BRA.b CODE_108E67

CODE_108E3E:
	LDX.w $0B52
	LDA.w $0B51
	BEQ.b CODE_108E55
	CMP.w DATA_108DFA,x
	BCS.b CODE_108E4C
	INX
CODE_108E4C:
	LDA.w $0B51
	SEC
	SBC.w DATA_108DFD,x
	BCS.b CODE_108E64
CODE_108E55:
	LDX.b #$FF
	STX.w $0B54
	STX.w $0B50
	LDX.b #$00
	STX.w $0B51
	BRA.b CODE_108E67

CODE_108E64:
	STA.w $0B51
CODE_108E67:
	REP.b #$20
	LDY.w $0B50
	TYA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDY.w $0B51
	TYA
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08967D>>16
	LDA.w #FXCODE_08967D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_108E80:
	REP.b #$20
	JML.l CODE_108F5D

;-------------------------------------------------------------------------
; CODE_gm11_level_death -- Game mode $11: LevelDeath.
; Per-frame handler driving Yoshi's death animation, baby-Mario rescue
; cinematic, and the transition back to map mode or retry. Also contains
; the camera/row/column tile streamers (CheckNewRowColumn, InitNewRow/
; InitNewColumn, LoadPartialRow/LoadPartialColumn) used during scroll.
;-------------------------------------------------------------------------
CODE_gm11_level_death:
CODE_108E86:
	REP.b #$20
	LDA.w $0B4C
	BNE.b CODE_108EDE
	LDX.b #$5C
CODE_108E8F:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	BEQ.b CODE_108EC3
	LDA.w $6FA0,x
	AND.w #$0100
	BEQ.b CODE_108EC3
	STZ.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$00FF
	STA.w $74A2,x
	LDY.w !RAM_YI_Level_LevelHeaderBG2TilesetLo
	CPY.b #$16
	BNE.b CODE_108EB2
	LDA.w #$0202
	TRB.w !RAM_YI_Global_MainScreenLayers
CODE_108EB2:
	LDY.w !RAM_YI_Level_LevelHeaderBG3TilesetLo
	CPY.b #$02
	BEQ.b CODE_108EBD
	CPY.b #$16
	BNE.b CODE_108EC3
CODE_108EBD:
	LDA.w #$0404
	TRB.w !RAM_YI_Global_MainScreenLayers
CODE_108EC3:
	DEX
	DEX
	DEX
	DEX
	BPL.b CODE_108E8F
	LDA.l YI_Global_PaletteMirror[$00].LowByte
	BEQ.b CODE_108EDE
	STA.w $0948
	LDA.w #$0000
	STA.l YI_Global_PaletteMirror[$00].LowByte
	LDX.b #$20
	STX.w !RAM_YI_Global_ColorMathSelectAndEnable
CODE_108EDE:
	SEP.b #$20
	JSL.l CODE_gm0f_core_init
	JSL.l CODE_108F49
	LDA.b #$1F
	STA.w !RAM_YI_Global_MainScreenWindowMask
	STA.w !RAM_YI_Global_SubScreenWindowMask
	REP.b #$30
	LDA.w $0B4C
	CLC
	ADC.w #$0006
	STA.w $0B4C
	CMP.w #$0400
	BCC.b CODE_108F45
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
	BNE.b CODE_108F0B
	LDY.w #!Define_YI_GameMode3F
	BRA.b CODE_108F16

CODE_108F0B:
	LDY.w #!Define_YI_GameMode3A
	LDA.w !RAM_YI_Level_MiddleRingsTouchedLo
	BEQ.b CODE_108F16
	LDY.w #!Define_YI_GameMode32
CODE_108F16:
	STY.w !RAM_YI_Global_CurrentGameMode
	STZ.w $0B4C
	PHB
	PEA.w $705800>>8
	PLB
	PLB
	LDX.w #$00FE
CODE_108F25:
	STZ.w $705800,x
	STZ.w $705900,x
	STZ.w $705A00,x
	STZ.w $705B00,x
	STZ.w $705C00,x
	STZ.w $705D00,x
	STZ.w $705E00,x
	STZ.w $705F00,x
	DEX
	DEX
	BNE.b CODE_108F25
	PLB
	INC.w $0CF9
CODE_108F45:
	SEP.b #$30
	PLB
	RTL

CODE_108F49:
	PHB
	PHK
	PLB
	REP.b #$20
	LDA.w $0B4C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_088EF3>>16
	LDA.w #FXCODE_088EF3
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_108F5D:
	JSL.l CODE_queue_dma_4args	: dl $7E56D0,$703A02 : dw $0348
	STZ.w !RAM_YI_Global_BGWindowLogicSettings
	SEP.b #$20
	LDA.b #$0F
	STA.w !RAM_YI_Global_MainScreenWindowMask
	STA.w !RAM_YI_Global_SubScreenWindowMask
	LDA.b #$22
	STA.w !RAM_YI_Global_BG1And2WindowMaskSettings
	STA.w !RAM_YI_Global_BG3And4WindowMaskSettings
	STA.w !RAM_YI_Global_ObjectAndColorWindowSettings
	LDA.b #$20
	TSB.w !RAM_YI_Global_HDMAEnable
	PLB
	RTL

CODE_108F88:
	LDA.w $60A4
	JSR.w CODE_init_new_column
	LDA.w $60A4
	CLC
	ADC.w #$0010
	STA.w $60A4
	SEP.b #$30
	JSL.l CODE_108C9A
	REP.b #$30
	RTS

CODE_108FA1:
	PHB
	PHK
	PLB
	STZ.b $77
	STZ.b $79
	STZ.b $73
	REP.b #$30
	LDA.w #$0011
	STA.b $8D
	LDA.b !RAM_YI_Global_Layer1YPosLo
	STA.w $60A6
	LDA.b !RAM_YI_Global_Layer1XPosLo
	SEC
	SBC.w #$0100
	STA.w $60A4
CODE_108FBF:
	JSR.w CODE_108F88
	SEP.b #$30
	JSL.l CODE_process_vram_dma_queue_l
	JSL.l CODE_bg3_tilemap_stitch_l
	REP.b #$30
	DEC.b $8D
	BNE.b CODE_108FBF
	SEP.b #$30
	PLB
	RTL

CODE_108FD6:
	PHB
	PHK
	PLB
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.b #$09
	BNE.b CODE_108FE3
	JMP.w CODE_109056

CODE_108FE3:
	STZ.b $77
	STZ.b $79
	STZ.b $73
	REP.b #$30
	LDA.w #$0011
	STA.b $8D
	LDA.w $038C
	BEQ.b CODE_109016
	LDA.b !RAM_YI_Global_Layer1YPosLo
	STA.w $60A6
	LDA.b !RAM_YI_Global_Layer1XPosLo
	SEC
	SBC.w #$0100
	STA.w $60A4
CODE_109003:
	JSR.w CODE_108F88
	SEP.b #$30
	JSL.l CODE_process_vram_dma_queue_l
	JSL.l CODE_bg3_tilemap_stitch_l
	REP.b #$30
	DEC.b $8D
	BNE.b CODE_109003
CODE_109016:
	LDA.w !RAM_YI_Level_LevelHeaderBG3TilesetLo
	CMP.w #$000A
	BNE.b CODE_109054
	PHB
	PEA.w $7E4000>>8
	PLB
	PLB
	LDY.w $7E4000
	LDA.w #$2800
	STA.w $7E4002,y
	LDA.w #$27FF
	STA.w $7E4004,y
	LDA.w #$5DA6
	STA.w $7E4006,y
	LDA.w #$007E
	STA.w $7E4008,y
	LDA.w #$FFFF
	STA.w $7E4009,y
	TYA
	CLC
	ADC.w #$0007
	STA.w $7E4000
	PLB
	SEP.b #$30
	JSL.l CODE_prepare_tilemap_dma_queue_l
CODE_109054:
	SEP.b #$30
CODE_109056:
	PLB
	RTL

;-------------------------------------------------------------------------
; CODE_check_new_row_column -- CheckNewRowColumn (raid: CODE_check_new_row_column).
; Called every frame while scrolling. Compares the camera position to the
; tracked "leftmost-tile-x" and "uppermost-tile-y" anchors and, when the
; camera has crossed a 16-pixel tile boundary, triggers InitNewColumn /
; InitNewRow to stream the new edge into the tile-grid buffer.
; Suppressed for level mode $09 (Raphael boss room) which doesn't scroll.
;-------------------------------------------------------------------------
CODE_check_new_row_column:
CODE_109058:
	PHB
	PHK
	PLB
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.b #$09
	BNE.b CODE_109065
	JMP.w CODE_109083

CODE_109065:
	REP.b #$30
	LDA.b !RAM_YI_Global_Layer1XPosLo
	AND.w #$FFF0
	CMP.w $60A4
	BEQ.b CODE_109074
	JSR.w CODE_init_new_column
CODE_109074:
	LDA.b !RAM_YI_Global_Layer1YPosLo
	AND.w #$FFF0
	CMP.w $60A6
	BEQ.b CODE_109081
	JSR.w CODE_init_new_row
CODE_109081:
	SEP.b #$30
CODE_109083:
	PLB
	RTL

;-------------------------------------------------------------------------
; DATA_new_column_delta -- DATA_new_column_delta: +$100 for left scroll, $000 for right.
;-------------------------------------------------------------------------
DATA_new_column_delta:
DATA_109085:
	dw $0100,$0000

;-------------------------------------------------------------------------
; CODE_init_new_column -- InitNewColumn (raid: CODE_init_new_column).
; Computes destination VRAM column address in the two-screen-relative
; tile buffer, then invokes LoadPartialColumn twice (upper half, then
; lower half) to copy 16 vertical Map16 indices from level data.
;-------------------------------------------------------------------------
CODE_init_new_column:
CODE_109089:
	INC.b $77
	STA.w $60A4
	LDY.b $73
	CLC
	ADC.w DATA_new_column_delta,y
	TAY
	AND.w #$01F0
	TAX
	LSR
	LSR
	LSR
	STA.b $0A
	TXA
	BIT.w #$0100
	BEQ.b CODE_1090A7
	EOR.w #$2100
CODE_1090A7:
	LSR
	LSR
	LSR
	TAX
	ADC.w #$6800
	STA.b $7B
	INC
	STA.b $7F
	TYA
	AND.w #$0F00
	XBA
	STA.b $00
	TXA
	AND.w #$001E
	STA.b $02
	LDA.b !RAM_YI_Global_Layer1YPosLo
	AND.w #$00F0
	TAY
	ASL
	ASL
	TSB.b $0A
	TYA
	LSR
	LSR
	LSR
	LSR
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	EOR.w #$000F
	INC
	STA.b $06
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	TYA
	ASL
	STA.b $0E
	LDA.b !RAM_YI_Global_Layer1YPosLo
	LSR
	LSR
	TAY
	LSR
	LSR
	AND.w #$0070
	ORA.b $00
	STA.b $04
	TAX
	LDA.w $6CA9,x
	AND.w #$3F00
	ASL
	ORA.b $0E
	ORA.b $02
	TAX
	TYA
	AND.w #$003C
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDY.b $0A
	STY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	PHB
	PEA.w $70409E>>8
	PLB
	PLB
	JSR.w CODE_load_partial_column
	LDA.l !REGISTER_SuperFX_R3_GeneralPurposeLo
	BEQ.b CODE_109138
	STA.b $06
	TYA
	AND.w #$03FF
	TAY
	STA.l !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $04
	CLC
	ADC.w #$0010
	AND.w #$007F
	TAX
	LDA.l $006CA9,x
	AND.w #$3F00
	ASL
	ORA.b $02
	TAX
	JSR.w CODE_load_partial_column
CODE_109138:
	PLB
	SEP.b #$10
	LDX.b #FXCODE_09F9E8>>16
	LDA.w #FXCODE_09F9E8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	RTS

;-------------------------------------------------------------------------
; CODE_load_partial_column -- LoadPartialColumn (raid: CODE_load_partial_column).
; Streams one half-column (8 vertical tiles) of Map16 indices from the
; uncompressed level-data buffer at $7F:8000+ into the "current screens"
; tile cache at $70:409E+. Counter at $7E:0006 controls remaining tiles.
;-------------------------------------------------------------------------
CODE_load_partial_column:
CODE_109147:
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	STA.w $70409E,y
	TYA
	CLC
	ADC.w #$0040
	TAY
	TXA
	CLC
	ADC.w #$0020
	TAX
	DEC.b $06
	BNE.b CODE_load_partial_column
	RTS

;-------------------------------------------------------------------------
; DATA_new_row_delta -- DATA_new_row_delta: vertical row delta selector (mirror of
; DATA_new_column_delta for columns). Picks +$0E0 vs $0 depending on scroll direction.
;-------------------------------------------------------------------------
DATA_new_row_delta:
DATA_10915F:
	dw $00E0,$0000

;-------------------------------------------------------------------------
; CODE_init_new_row -- InitNewRow (raid: CODE_init_new_row). Mirror of InitNewColumn.
; Computes destination VRAM row address in the two-screen tile buffer,
; then invokes LoadPartialRow twice (left half, then right half) to copy
; 16 horizontal Map16 indices from level data when the camera crosses a
; 16-pixel row boundary.
;-------------------------------------------------------------------------
CODE_init_new_row:
CODE_109163:
	INC.b $79
	STA.w $60A6
	LDY.b $75
	CLC
	ADC.w DATA_new_row_delta,y
	STA.b $8B
	TAY
	ASL
	AND.w #$01E0
	STA.b $02
	ASL
	STA.b $0A
	STA.b $00
	TYA
	LSR
	LSR
	LSR
	LSR
	AND.w #$0070
	STA.b $04
	LDA.b !RAM_YI_Global_Layer1XPosLo
	LSR
	LSR
	TAX
	AND.w #$003C
	TAY
	LSR
	LSR
	STA.b $08
	EOR.w #$000F
	INC
	STA.b $06
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	TYA
	CLC
	ADC.w #$0004
	STA.b $87
	TYA
	LSR
	STA.b $0E
	TXA
	LSR
	AND.w #$003E
	TAY
	TSB.b $0A
	TYA
	BIT.w #$0020
	BEQ.b CODE_1091B8
	EOR.w #$0420
CODE_1091B8:
	ORA.b $00
	TAX
	CLC
	ADC.w #$6800
	STA.b $7D
	CLC
	ADC.w #$0020
	STA.b $85
	TXA
	EOR.w #$0400
	AND.w #$FFE0
	CLC
	ADC.w #$6800
	STA.b $81
	CLC
	ADC.w #$0020
	STA.b $89
	LDA.w #$0044
	SEC
	SBC.b $87
	STA.b $83
	LDY.b #$2A
	ROR.w $3AA5
	AND.w #$000F
	STA.b $0C
	ORA.b $04
	TAX
	LDA.w $6CA9,x
	AND.w #$3F00
	ASL
	ORA.b $0E
	ORA.b $02
	TAX
	LDY.b $0A
	STY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	PHB
	PEA.w $70409E>>8
	PLB
	PLB
	JSR.w CODE_load_partial_row
	LDA.b $08
	INC
	STA.b $06
	STA.l !REGISTER_SuperFX_R3_GeneralPurposeLo
	TYA
	BIT.w #$003E
	BNE.b CODE_10921D
	SEC
	SBC.w #$0040
	TAY
CODE_10921D:
	STA.l !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $0C
	INC
	AND.w #$000F
	ORA.b $04
	TAX
	LDA.l $006CA9,x
	AND.w #$3F00
	ASL
	ORA.b $02
	TAX
	JSR.w CODE_load_partial_row
	PLB
	SEP.b #$10
	LDX.b #FXCODE_09FA68>>16
	LDA.w #FXCODE_09FA68
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	RTS

;-------------------------------------------------------------------------
; CODE_load_partial_row -- LoadPartialRow (raid: CODE_load_partial_row).
; Same as LoadPartialColumn but walks horizontally: streams up to 16
; Map16 indices along a row, advancing source X by 2 each step and
; destination Y by 2 each step.
;-------------------------------------------------------------------------
CODE_load_partial_row:
CODE_109247:
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	STA.w $70409E,y
	INY
	INY
	INX
	INX
	DEC.b $06
	BNE.b CODE_load_partial_row
	RTS

;-------------------------------------------------------------------------
; CODE_init_per_tileset_template_slots -- populate the sparse WRAM region
; $00:19DA-$00:1DFC with per-tileset Map16-ID anchors used by Bank13
; cell-stamp handlers for shape detection (flat-floor centers, slope
; segments, pipe tops, etc.). Driven by DATA_per_tileset_template_table
; (Bank4C DATA_4CD61A): walks 74 records, looks up each family's anchor
; Map16 ID by the level's BG1 tileset byte
; (!RAM_YI_Level_LevelHeaderBG1TilesetLo), and stores ANCHOR, ANCHOR+1,
; ANCHOR+2, ... `count` times into adjacent 16-bit WRAM slots. JSLed
; once from CODE_load_level_object_stream during level load. See the
; Bank13 file header ("PER-TILESET MAP16-ID TEMPLATE SLOTS") for what
; the slots are used for at runtime.
;-------------------------------------------------------------------------
CODE_109257:
CODE_init_per_tileset_template_slots:                                       ; descriptive alias
	LDA.b #$0019DA>>16
	STA.b $02
	REP.b #$30
	LDX.w #$0000
CODE_109260:
	STX.b $03
	LDA.l DATA_4CD61A,x                                       ; count byte (low) — $00 = end of table
	AND.w #$00FF
	BEQ.b CODE_109292
	TAY                                                       ; Y = count of slots to fill for this family
	LDA.l DATA_4CD61A+$01,x                                   ; ram_slot_addr (16-bit) of family's first slot
	STA.b $00                                                 ; $00/$02 = long pointer (bank already in $02)
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo               ; BG1TYP -> per-tileset index 0..F
	ASL                                                       ; ×2 (16-bit anchor entries)
	ADC.b $03                                                 ; + record start offset
	TAX
	LDA.l DATA_4CD61A+$03,x                                   ; A = anchor Map16 ID for current tileset
	TYX                                                       ; X = slot count
	LDY.w #$0000
CODE_109281:
	STA.b [$00],y                                             ; store ANCHOR (then ANCHOR+1, ANCHOR+2, ...)
	INC
	INY
	INY
	DEX
	BNE.b CODE_109281
	LDA.b $03                                                 ; advance to next record
	CLC
	ADC.w #$0023                                              ; record stride = 1+2+(2*16) = 35 bytes
	TAX
	BRA.b CODE_109260

CODE_109292:
	SEP.b #$30
	RTL

;-------------------------------------------------------------------------
; CODE_change_map16 -- ChangeMap16 (raid: CODE_change_map16).
; Writes a Map16 tile ID into the !RAM tile grid at a computed location
; and invalidates the collision cache. Inputs (zp): $91/$93 collision
; XY-pos, $8F collision type, $7E:008D tile ID source. Used heavily by
; hitting blocks, breaking bricks, sprites that modify the level (e.g.
; growing vines, melting ice). One of the most-called helpers in the game.
;-------------------------------------------------------------------------
CODE_change_map16:
CODE_109295:
	PHP
	PHB
	PHK
	PLB
	PHD
	LDA.w #$0000
	TCD
	REP.b #$30
	LDA.b $91
	AND.w #$FFF0
	SEC
	SBC.w $60A4
	CLC
	ADC.w #$0010
	STA.b $12
	LDA.b $93
	AND.w #$FFF0
	SEC
	SBC.w $60A6
	CLC
	ADC.w #$0010
	STA.b $14
	LDA.b $93
	TAY
	AND.w #$0700
	LSR
	LSR
	LSR
	LSR
	STA.b $00
	TYA
	AND.w #$00F0
	ASL
	STA.b $02
	ASL
	STA.b $07
	LDA.b $91
	TAY
	AND.w #$00F0
	LSR
	LSR
	LSR
	TSB.b $02
	TYA
	AND.w #$01F0
	LSR
	LSR
	LSR
	BIT.w #$0020
	BEQ.b CODE_1092EE
	EOR.w #$0420
CODE_1092EE:
	TSB.b $07
	TYA
	AND.w #$0F00
	XBA
	ORA.b $00
	STA.b $10
	TAX
	LDA.w $6CA9,x
	AND.w #$3F00
	ASL
	TSB.b $02
	LDA.b $8F
	ASL
	TAX
	JSR.w (DATA_10930E,x)
	PLD
	PLB
	PLP
	RTL

DATA_10930E:
	dw CODE_10931E
	dw CODE_1098D0
	dw CODE_10955B
	dw CODE_10962C
	dw CODE_1096DF
	dw CODE_1098E9
	dw CODE_10990B
	dw CODE_1098CD

CODE_10931E:
	LDA.b $07
	STA.b $04
	LDA.b $12
	STA.b $16
	LDA.b $14
	STA.b $18
	LDX.b $02
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	TAY
	AND.w #$FF00
	XBA
	SEC
	SBC.w #$001A
	CMP.w #$0003
	BCC.b CODE_10933F
	RTS

CODE_10933F:
	PHB
	SEP.b #$20
	LDA.b #DATA_13B7A8>>16
	PHA
	PLB
	REP.b #$20
	TYA
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_13B7A8,y
	BEQ.b CODE_109357
	TAY
	LDA.w $0000,y
CODE_109357:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_109A2A
	JSR.w CODE_109438
	LDA.b $00
	BNE.b CODE_109391
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	TAY
	AND.w #$FF00
	XBA
	SEC
	SBC.w #$001A
	CMP.w #$0003
	BCS.b CODE_109391
	TYA
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_13B1B0,y
	TAY
	LDA.w $0000,y
	CMP.l !RAM_YI_Level_LevelDataBuffer,x
	BEQ.b CODE_109391
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_109A2A
CODE_109391:
	JSR.w CODE_109481
	LDA.b $00
	BNE.b CODE_1093C4
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	TAY
	AND.w #$FF00
	XBA
	SEC
	SBC.w #$001A
	CMP.w #$0003
	BCS.b CODE_1093C4
	TYA
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_13B62A,y
	TAY
	LDA.w $0000,y
	CMP.l !RAM_YI_Level_LevelDataBuffer,x
	BEQ.b CODE_1093C4
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_109A2A
CODE_1093C4:
	JSR.w CODE_1094CC
	LDA.b $00
	BNE.b CODE_1093F7
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	TAY
	AND.w #$FF00
	XBA
	SEC
	SBC.w #$001A
	CMP.w #$0003
	BCS.b CODE_1093F7
	TYA
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_13B4AC,y
	TAY
	LDA.w $0000,y
	CMP.l !RAM_YI_Level_LevelDataBuffer,x
	BEQ.b CODE_1093F7
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_109A2A
CODE_1093F7:
	JSR.w CODE_109512
	LDA.b $00
	BNE.b CODE_10942A
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	TAY
	AND.w #$FF00
	XBA
	SEC
	SBC.w #$001A
	CMP.w #$0003
	BCS.b CODE_10942A
	TYA
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_13B32E,y
	TAY
	LDA.w $0000,y
	CMP.l !RAM_YI_Level_LevelDataBuffer,x
	BEQ.b CODE_10942A
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_109A2A
CODE_10942A:
	LDA.l $0009ED
	TAX
	LDA.w #$FFFF
	STA.l $0009EF,x
	PLB
	RTS

CODE_109438:
	LDA.b $18
	SEC
	SBC.w #$0010
	STA.b $14
	STZ.b $00
	LDA.b $04
	SEC
	SBC.w #$0040
	STA.b $07
	LDA.b $02
	SEC
	SBC.w #$0020
	TAX
	AND.w #$01E0
	CMP.w #$01E0
	BNE.b CODE_109480
	LDA.b $10
	SEC
	SBC.w #$0010
	BPL.b CODE_109463
	INC.b $00
CODE_109463:
	TXY
	TAX
	LDA.b $07
	CLC
	ADC.w #$0400
	AND.w #$07FF
	STA.b $07
	LDA.w $6CA9,x
	AND.w #$3F00
	ASL
	STA.b $09
	TYA
	AND.w #$01FF
	ORA.b $09
	TAX
CODE_109480:
	RTS

CODE_109481:
	LDA.b $16
	SEC
	SBC.w #$0010
	STA.b $12
	STZ.b $00
	LDA.b $04
	DEC
	DEC
	STA.b $07
	LDA.b $02
	DEC
	DEC
	TAX
	AND.w #$001E
	CMP.w #$001E
	BNE.b CODE_1094CB
	LDA.b $10
	BIT.w #$000F
	BNE.b CODE_1094A7
	INC.b $00
CODE_1094A7:
	LDA.b $10
	DEC
	TXY
	TAX
	LDA.b $07
	CLC
	ADC.w #$0420
	AND.w #$07FF
	STA.b $07
	LDA.w $6CA9,x
	AND.w #$3F00
	ASL
	STA.b $09
	TYA
	CLC
	ADC.w #$0020
	AND.w #$01FF
	ORA.b $09
	TAX
CODE_1094CB:
	RTS

CODE_1094CC:
	LDA.b $16
	CLC
	ADC.w #$0010
	STA.b $12
	STZ.b $00
	LDA.b $04
	INC
	INC
	STA.b $07
	LDA.b $02
	INC
	INC
	TAX
	AND.w #$001E
	BNE.b CODE_109511
	LDA.b $10
	INC
	BIT.w #$000F
	BNE.b CODE_1094F0
	INC.b $00
CODE_1094F0:
	TXY
	TAX
	LDA.b $07
	SEC
	SBC.w #$0420
	AND.w #$07FF
	STA.b $07
	LDA.w $6CA9,x
	AND.w #$3F00
	ASL
	STA.b $09
	TYA
	SEC
	SBC.w #$0020
	AND.w #$01FF
	ORA.b $09
	TAX
CODE_109511:
	RTS

CODE_109512:
	LDA.b $18
	CLC
	ADC.w #$0010
	STA.b $14
	STZ.b $00
	LDA.b $04
	CLC
	ADC.w #$0040
	STA.b $07
	LDA.b $02
	CLC
	ADC.w #$0020
	TAX
	AND.w #$01E0
	BNE.b CODE_10955A
	LDA.b $10
	CLC
	ADC.w #$0010
	BIT.w #$0070
	BNE.b CODE_10953D
	INC.b $00
CODE_10953D:
	TXY
	TAX
	LDA.b $07
	SEC
	SBC.w #$0400
	AND.w #$07FF
	STA.b $07
	LDA.w $6CA9,x
	AND.w #$3F00
	ASL
	STA.b $09
	TYA
	AND.w #$01FF
	ORA.b $09
	TAX
CODE_10955A:
	RTS

CODE_10955B:
	LDY.w #$0000
CODE_10955E:
	LDX.b $02
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	STA.w $0020,y
	AND.w #$FF00
	CMP.w #$6100
	BEQ.b CODE_10957C
	CMP.w #$6200
	BEQ.b CODE_10957C
	LDA.w #$6106
	STA.w $0020,y
	BRA.b CODE_109588

CODE_10957C:
	LDA.w $0095
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	PHY
	JSR.w CODE_109A2A
	PLY
CODE_109588:
	INC.w $0095
	LDA.b $12
	CLC
	ADC.w #$0010
	STA.b $12
	LDA.b $07
	INC
	INC
	STA.b $07
	LDA.b $02
	INC
	INC
	STA.b $02
	BIT.w #$001E
	BNE.b CODE_1095C4
	SEC
	SBC.w #$0020
	AND.w #$01FF
	STA.b $02
	LDA.b $07
	SEC
	SBC.w #$0420
	AND.w #$07FF
	STA.b $07
	LDX.b $10
	INX
	LDA.w $6CA9,x
	AND.w #$3F00
	ASL
	TSB.b $02
CODE_1095C4:
	INY
	INY
	CPY.w #$0006
	BCC.b CODE_10955E
	LDA.l $0009ED
	TAX
	LDA.w #$FFFF
	STA.l $0009EF,x
	RTS

DATA_1095D8:
	dw $0000,$A55C,$0000,$0000,$0000,$A55D,$0000,$A55C
	dw $0000,$A55D,$A55B,$0000,$A55A,$A55C,$A55B,$0000
	dw $0000,$0000,$A55A,$0000,$0000,$0000,$A55B,$0000
	dw $A55A,$0000,$0000,$0000,$A55B,$0000,$0000,$A55C
	dw $0000,$0000,$A55B,$A55D,$0000,$A55C,$0000,$0000
	dw $0000,$A55D

CODE_10962C:
	LDY.w $0095
CODE_10962F:
	PHY
	LDX.b $02
	TYA
	BEQ.b CODE_10963D
	CPY.w $0095
	BNE.b CODE_10966C
	LDA.w #$0002
CODE_10963D:
	STA.b $00
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	BEQ.b CODE_109676
	PHX
	SEP.b #$10
	JSL.l CODE_0DA485
	REP.b #$10
	PLX
	LDA.b $93
	SEC
	SBC.w #$07C0
	AND.w #$FFF0
	LSR
	LSR
	TSB.b $00
	LDA.w $1070
	ASL
	ADC.w $1070
	ASL
	ADC.b $00
	TAY
	LDA.w DATA_1095D8-$0C,y
	BRA.b CODE_10966F

CODE_10966C:
	LDA.w #$0000
CODE_10966F:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_109A2A
CODE_109676:
	LDA.b $12
	CLC
	ADC.w #$0010
	STA.b $12
	LDA.b $91
	CLC
	ADC.w #$0010
	STA.b $91
	LDA.b $07
	INC
	INC
	STA.b $07
	LDA.b $02
	INC
	INC
	STA.b $02
	BIT.w #$001E
	BNE.b CODE_1096B7
	SEC
	SBC.w #$0020
	AND.w #$01FF
	STA.b $02
	LDA.b $07
	SEC
	SBC.w #$0420
	AND.w #$07FF
	STA.b $07
	LDX.b $10
	INX
	LDA.w $6CA9,x
	AND.w #$3F00
	ASL
	TSB.b $02
CODE_1096B7:
	PLY
	DEY
	BMI.b CODE_1096BE
	JMP.w CODE_10962F

CODE_1096BE:
	LDA.l $0009ED
	TAX
	LDA.w #$FFFF
	STA.l $0009EF,x
	RTS

DATA_1096CB:
	db $00,$00,$03,$03,$04,$04,$07,$07,$08,$08,$0B,$0B,$0C,$0C,$0F,$0F
	db $10,$10,$13,$13

CODE_1096DF:
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.w #$0009
	BNE.b CODE_1096EA
	JMP.w CODE_1097D9

CODE_1096EA:
	LDX.b $02
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$A300
	BNE.b CODE_109711
	LDA.b $00
	PHA
	LDA.b $02
	PHA
	LDA.b $07
	PHA
	JSR.w CODE_1098A2
	JSL.l CODE_00E013
	PLA
	STA.b $07
	PLA
	STA.b $02
	PLA
	STA.b $00
CODE_109711:
	LDX.b $02
	LDA.b $95
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_109A2A
	LDA.b $07
	STA.b $04
	LDA.b $14
	STA.b $18
	JSR.w CODE_109512
	LDA.b $00
	BNE.b CODE_10975C
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$00FF
	TAY
	LDA.w DATA_1096CB,y
	AND.w #$00FF
	TAY
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	CMP.w #$6B00
	BEQ.b CODE_109751
	CMP.w #$A300
	BNE.b CODE_10975C
	TYA
	ORA.w #$A300
	BRA.b CODE_109755

CODE_109751:
	TYA
	ORA.w #$6B00
CODE_109755:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_109A2A
CODE_10975C:
	LDA.l $0009ED
	TAX
	LDA.w #$FFFF
	STA.l $0009EF,x
	RTS

DATA_109769:
	dw $05C8,$05DC,$05D2,$07C6

DATA_109771:
	db $86,$86,$B0

DATA_109774:
	db $86,$86,$B1

DATA_109777:
	db $B6,$C6,$C6

DATA_10977A:
	db $B7,$C6,$C6

DATA_10977D:
	db $C2,$8A,$8A

DATA_109780:
	db $C3,$8B,$8B

DATA_109783:
	db $8A,$8A,$BC

DATA_109786:
	db $8B,$8B,$BD

DATA_109789:
	db $AC,$AE,$03

DATA_10978C:
	db $AD,$AF,$04

DATA_10978F:
	db $43,$B2,$B4

DATA_109792:
	db $44,$B3,$B5

DATA_109795:
	db $23,$BE,$BF

DATA_109798:
	db $2C,$C0,$C1

DATA_10979B:
	db $B8,$B9,$1F

DATA_10979E:
	db $BA,$BB,$24

DATA_1097A1:
	dw $0B9F,$121F,$0F25,$0F18

DATA_1097A9:
	dw $0BA0,$1220,$0FA5,$0F98

DATA_1097B1:
	dw $0003,$0003,$0000,$0000

DATA_1097B9:
	dw DATA_109771,DATA_109777,DATA_10977D,DATA_109783

DATA_1097C1:
	dw DATA_109774,DATA_10977A,DATA_109780,DATA_109786

DATA_1097C9:
	dw DATA_109789,DATA_10978F,DATA_109795,DATA_10979B

DATA_1097D1:
	dw DATA_10978C,DATA_109792,DATA_109798,DATA_10979E

CODE_1097D9:
	LDX.b $02
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	BNE.b CODE_1097E4
	JMP.w CODE_10986A

CODE_1097E4:
	STA.b $00
	LDA.w #$0000
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDA.w #$0002
	STA.w $0D07
	TXA
	LDX.w #$0000
CODE_1097F7:
	CMP.w DATA_109769,x
	BEQ.b CODE_109803
	INX
	INX
	CPX.w #$FFF8
	BCC.b CODE_1097F7
CODE_109803:
	STX.b $08
	TXA
	EOR.w #$0002
	TAX
	LDA.w DATA_109769,x
	TAX
	LDA.b $00
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	LDY.b $08
	LDA.w DATA_1097A1,y
	STA.b $00
	LDA.w DATA_1097B1,y
	STA.b $02
	LDA.w DATA_1097B9,y
	STA.b $04
	JSR.w CODE_10986B
	LDY.b $08
	LDA.w DATA_1097A9,y
	STA.b $00
	LDA.w DATA_1097B1,y
	STA.b $02
	LDA.w DATA_1097C1,y
	STA.b $04
	JSR.w CODE_10986B
	LDA.b $08
	EOR.w #$0002
	TAY
	STA.b $08
	LDA.w DATA_1097A1,y
	STA.b $00
	LDA.w DATA_1097B1,y
	STA.b $02
	LDA.w DATA_1097C9,y
	STA.b $04
	JSR.w CODE_10986B
	LDY.b $08
	LDA.w DATA_1097A9,y
	STA.b $00
	LDA.w DATA_1097B1,y
	STA.b $02
	LDA.w DATA_1097D1,y
	STA.b $04
	JSR.w CODE_10986B
CODE_10986A:
	RTS

CODE_10986B:
	PHB
	PEA.w $7E4800>>8
	PLB
	PLB
	LDX.w $7E4800
	LDA.b $00
	STA.w $0000,x
	LDA.b $02
	STA.w $0002,x
	LDA.w #$0018
	STA.w $0004,x
	LDA.w #DATA_109789>>16
	STA.w $0007,x
	LDA.w #$0003
	STA.w $0008,x
	LDA.b $04
	STA.w $0005,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,x
	STA.w $7E4800
	PLB
	RTS

CODE_1098A2:
	LDA.w !RAM_YI_Level_LevelHeaderItemMemorySettingLo
	ASL
	TAX
	LDA.l DATA_01E4D9,x
	STA.b $00
	LDX.b $10
	LDA.w $6CAA,x
	AND.w #$003F
	ASL
	ADC.b $00
	STA.b $00
	LDA.b $02
	AND.w #$001E
	TAX
	LDA.l DATA_01E4E1,x
	STA.b $04
	LDA.b ($00)
	ORA.b $04
	STA.b ($00)
	RTS

CODE_1098CD:
	JSR.w CODE_1098A2
CODE_1098D0:
	LDX.b $02
	LDA.w $0095
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_109A2A
	LDA.l $0009ED
	TAX
	LDA.w #$FFFF
	STA.l $0009EF,x
	RTS

CODE_1098E9:
	LDX.b $02
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$0000
	BNE.b CODE_10990A
	LDA.w $0095
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_109A2A
	LDA.l $0009ED
	TAX
	LDA.w #$FFFF
	STA.l $0009EF,x
CODE_10990A:
	RTS

CODE_10990B:
	LDX.b $02
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	CMP.w #$7C00
	BEQ.b CODE_109919
	JMP.w CODE_109A1D

CODE_109919:
	STZ.b $0E
	LDA.b $07
	STA.b $04
	LDA.b $12
	STA.b $16
	LDA.b $14
	STA.b $18
	JSR.w CODE_109438
	LDA.b $00
	BNE.b CODE_10995F
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	TAY
	CMP.w #$7C00
	BNE.b CODE_109942
	LDA.w #$0008
	STA.b $0E
	BRA.b CODE_10995F

CODE_109942:
	TYA
	CMP.w #$7700
	BNE.b CODE_10995F
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	DEC
	DEC
	DEC
	DEC
	CMP.w #$777D
	BCS.b CODE_109958
	LDA.w #$0000
CODE_109958:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_109A2A
CODE_10995F:
	JSR.w CODE_109481
	LDA.b $00
	BNE.b CODE_109997
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	TAY
	CMP.w #$7C00
	BNE.b CODE_10997C
	LDA.b $0E
	ORA.w #$0001
	STA.b $0E
	BRA.b CODE_109997

CODE_10997C:
	TYA
	CMP.w #$7700
	BNE.b CODE_109997
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	DEC
	DEC
	CMP.w #$777D
	BCS.b CODE_109990
	LDA.w #$0000
CODE_109990:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_109A2A
CODE_109997:
	JSR.w CODE_1094CC
	LDA.b $00
	BNE.b CODE_1099CE
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	TAY
	CMP.w #$7C00
	BNE.b CODE_1099B4
	LDA.b $0E
	ORA.w #$0002
	STA.b $0E
	BRA.b CODE_1099CE

CODE_1099B4:
	TYA
	CMP.w #$7700
	BNE.b CODE_1099CE
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	DEC
	CMP.w #$777D
	BCS.b CODE_1099C7
	LDA.w #$0000
CODE_1099C7:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_109A2A
CODE_1099CE:
	JSR.w CODE_109512
	LDA.b $00
	BNE.b CODE_109A08
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	AND.w #$FF00
	TAY
	CMP.w #$7C00
	BNE.b CODE_1099EB
	LDA.b $0E
	ORA.w #$0004
	STA.b $0E
	BRA.b CODE_109A08

CODE_1099EB:
	TYA
	CMP.w #$7700
	BNE.b CODE_109A08
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	SEC
	SBC.w #$0008
	CMP.w #$777D
	BCS.b CODE_109A01
	LDA.w #$0000
CODE_109A01:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_109A2A
CODE_109A08:
	LDX.b $02
	LDA.b $04
	STA.b $07
	LDA.b $0E
	BEQ.b CODE_109A16
	CLC
	ADC.w #$777C
CODE_109A16:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	JSR.w CODE_109A2A
CODE_109A1D:
	LDA.l $0009ED
	TAX
	LDA.w #$FFFF
	STA.l $0009EF,x
	RTS

CODE_109A2A:
	TAY
	LDA.b $12
	CMP.w #$0130
	BCS.b CODE_109A84
	LDA.b $14
	CMP.w #$0100
	BCS.b CODE_109A84
	PHB
	PEA.w $0009
	PLB
	PLB
	LDA.b $07
	BIT.w #$0400
	BEQ.b CODE_109A49
	EOR.w #$0420
CODE_109A49:
	TAX
	TYA
	STA.l $70409E,x
	TYA
	AND.w #$FF00
	XBA
	ASL
	TAX
	LDA.l FXDATA_4C32A4,x
	STA.b $00
	TYA
	AND.w #$00FF
	ASL
	ASL
	ASL
	ADC.b $00
	CLC
	ADC.w #FXDATA_4C33F2
	STA.b $00
	LDY.w $09ED
	LDA.b $07
	ORA.w #$6800
	STA.w $09EF,y
	LDA.b $00
	STA.w $09F1,y
	TYA
	CLC
	ADC.w #$0004
	STA.w $09ED
	PLB
CODE_109A84:
	RTS

CODE_109A85:						;\ Note: Infinite loop?
	BRA CODE_109A85					;/

CODE_109A87:
	RTL

DATA_109A88:
	dw $401C,$410C,$41FC,$4274,$4184,$4094

DATA_109A94:
	dw $4076,$4166,$4256,$42CE,$41DE,$40EE

DATA_109AA0:
	dw $2860,$2860,$2860,$2860,$2860,$2860

DATA_109AAC:
	dw $2860,$2860,$2860,$2860,$2860,$2860

DATA_109AB8:
	dw $0089,$008D,$0091,$0093,$008F,$008B

DATA_109AC4:
	dw $008A,$008E,$0092,$0094,$0090,$008C

DATA_109AD0:
	dw $0095,$0095,$0095,$0095,$0095,$0095

DATA_109ADC:
	db $44,!REGISTER_Window1LeftPositionDesignation : dl $7E5B18

DATA_109AE1:
	db $E9 : dw $7E56D0
	db $E9 : dw $7E5874
	db $00

;-------------------------------------------------------------------------
; CODE_gm2a_load_bonus_game -- Game mode $2A: LoadBonusGame (raid: CODE_gm2a_load_bonus_game).
; One-shot setup for the post-level "bonus game" select screen. Initializes
; OAM/BG3, clears sprites, primes DMA queue, and decompresses bonus-game
; graphics + palette before advancing to gamemode $2B (transition fade).
;-------------------------------------------------------------------------
CODE_gm2a_load_bonus_game:
CODE_109AE8:
	JSL.l CODE_init_oam_and_bg3_tilemap
	JSL.l CODE_clear_basic_states
	JSL.l CODE_clear_all_sprites
	JSL.l CODE_init_oam_buffer
	JSL.l CODE_copy_division_lookup_to_sram
	REP.b #$10
	LDY.w !RAM_YI_Level_CurrentBonusGame
	LDX.w DATA_109AB8,y
	STX.b $10
	LDX.w DATA_109AC4,y
	STX.b $12
	LDX.w DATA_109AD0,y
	STX.b $14
	LDY.w #$00F3
	JSL.l CODE_load_compressed_gfx_files_l
	REP.b #$30
	LDX.w !RAM_YI_Level_CurrentBonusGame
	LDA.w DATA_109A88,x
	STA.b $10
	LDA.w DATA_109A94,x
	STA.b $12
	LDA.w DATA_109AA0,x
	STA.b $14
	LDA.w DATA_109AAC,x
	STA.b $16
	LDA.w !RAM_YI_Level_CurrentYoshiColorLo
	ASL
	TAX
	LDA.l DATA_yoshi_palette_ptrs,x
	STA.b $18
	LDX.w #$0094
	JSL.l CODE_00BB05
	LDX.b #$2A
	JSL.l CODE_init_scene_regs
	LDX.b #$04
CODE_109B4A:
	LDA.w DATA_109ADC,x
	STA.w HDMA[$05].Parameters,x
	DEX
	BPL.b CODE_109B4A
	LDA.b #$7E56D0>>16
	STA.w HDMA[$07].IndirectSourceBank
	LDX.b #$06
CODE_109B5A:
	LDA.w DATA_109AE1,x
	STA.l $7E5B18,x
	DEX
	BPL.b CODE_109B5A
	LDA.b #$20
	STA.w !RAM_YI_Global_HDMAEnable
	REP.b #$30
	LDA.w #$0028
	STA.b $8F
	LDA.w #$00B4
	STA.b $8D
	STZ.b $85
	LDA.w #$0002
	STA.b $83
	LDA.w #$0018
	STA.w $10E0
	LDA.w #$7FFF
	STA.w $0948
	STZ.b !RAM_YI_Global_Layer1XPosLo
	STZ.b !RAM_YI_Global_Layer2XPosLo
	STZ.b !RAM_YI_Global_Layer3XPosLo
	LDA.w #$0100
	STA.b !RAM_YI_Global_Layer1YPosLo
	STA.b !RAM_YI_Global_Layer2YPosLo
	STZ.b !RAM_YI_Global_Layer3YPosLo
	STZ.w $10DE
	LDY.w #$0000
	STY.w $60F8
	LDA.w DATA_10A29D,y
	STA.w $60BE
	LDA.w DATA_10A2F5,y
	STA.w $61D2
	LDA.w #$00D0
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w #$00A8
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$0002
	STA.w $60C4
	SEP.b #$10
	LDY.b #$04
	LDA.w #$FFFF
CODE_109BC5:
	STA.w $6EB6,y
	DEY
	DEY
	BPL.b CODE_109BC5
	LDA.w #!Define_YI_NorSpr061_BabyMario
	LDY.b #$00
	JSL.l CODE_03A366
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror
	LDA.w #$2000
	STA.w $61B2
	LDA.w #$0000
	STA.w $7402
	LDA.w #$0020
	STA.w $70E2
	LDA.w #$00B8
	STA.w $7182
	LDA.w #$0002
	STA.w $7400
	LDA.w #$003A
	STA.w $7042
	SEP.b #$20
	LDA.w DATA_10A772
	STA.w $10F6
	LDA.w DATA_10A775
	STA.w $10F7
	STZ.w $10F8
	STZ.w $10F9
	STZ.w $10FA
	STZ.w $10FB
	STZ.w $10FC
	STZ.w $10FD
	STZ.w $10FE
	STZ.w $10FF
	REP.b #$20
	STZ.w $6094
	STZ.w $609C
	LDX.b #FXCODE_08B3D9>>16
	LDA.w #FXCODE_08B3D9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	JSR.w CODE_109CB2
	JSR.w CODE_109D74
	SEP.b #$30
	JSL.l CODE_process_vram_dma_queue_l
	REP.b #$30
	LDX.w !RAM_YI_Level_CurrentBonusGame
	JSR.w (DATA_109C74,x)
	SEP.b #$30
	LDX.b #$06
	JSL.l CODE_set_level_music
	LDA.b #$01
	STA.b !RAM_YI_Global_PlayMusicLo
	STZ.w $0121
	LDA.b #$02
	STA.w $0125
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$D8
	STA.w !REGISTER_VCountTimerLo
	LDA.b #$B1
	STA.w !REGISTER_IRQNMIAndJoypadEnableFlags
	INC.w !RAM_YI_Global_CurrentGameMode
	PLB
	RTL

DATA_109C74:
	dw CODE_109E78
	dw CODE_109EF6
	dw CODE_10A000
	dw CODE_10A0BD
	dw CODE_109FB5
	dw CODE_109F3F

CODE_109C80:
	PHP
	SEP.b #$30
	PHA
	LDY.b #$00
CODE_109C86:
	LDA.w !RAM_YI_Level_PauseMenuItemInventory,y
	BEQ.b CODE_109CA0
	INY
	CPY.b #$1B
	BNE.b CODE_109C86
	LDY.b #$00
	LDX.b #$01
CODE_109C94:
	LDA.w !RAM_YI_Level_PauseMenuItemInventory,x
	STA.w !RAM_YI_Level_PauseMenuItemInventory,y
	INX
	INY
	CPY.b #$1A
	BNE.b CODE_109C94
CODE_109CA0:
	PLA
	STA.w !RAM_YI_Level_PauseMenuItemInventory,y
	PLP
	RTS

CODE_109CA6:
	JSR.w CODE_109C80
	RTL

DATA_109CAA:
	dw $0020,$0000

DATA_109CAE:
	dw $0002,$FFFE

CODE_109CB2:
	SEP.b #$10
	STZ.b $87
	LDY.b $83
	LDA.b $85
	CMP.w DATA_109CAA,y
	BEQ.b CODE_109CC7
	INC.b $87
	CLC
	ADC.w DATA_109CAE,y
	STA.b $85
CODE_109CC7:
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #DATA_17A48C>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_17A48C
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.b $8D
	SEC
	SBC.w #$0008
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $8F
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDX.b #FXCODE_08B348>>16
	LDA.w #FXCODE_08B348
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.b $85
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #DATA_17A48C>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_17A48C
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.b $8D
	SEC
	SBC.w #$0008
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $8F
	CLC
	ADC.w #$00B0
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0002
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDX.b #FXCODE_08B348>>16
	LDA.w #FXCODE_08B348
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
CODE_109D27:
	JSL.l CODE_queue_dma_4args	: dl $7E56D0,$703A02 : dw $0348
	RTS

DATA_109D34:
	dw $68D8,$68D8,$68D8,$68D9,$68D8,$68D8

DATA_109D40:
	dw $3CD6,$FCD6,$3CC0,$3CD0,$3CC1,$3CD1,$3CC2,$3CD2
	dw $3CC3,$3CD3,$3CC4,$3CD4,$3CC5,$3CD5,$3CC2,$3CD0
	dw $3CC6,$3CD5,$FCD5,$FCC5,$0385,$0385,$0385,$0385
	dw $037B,$037B

CODE_109D74:
	LDA.w !RAM_YI_Level_CurrentBonusGame
	CMP.w #!Define_YI_BonusID_Roulette
	BNE.b CODE_109D87
	LDA.w !RAM_YI_Global_CurrentGameMode
	CMP.w #!Define_YI_GameMode2A
	BNE.b CODE_109D87
	DEC.w !RAM_YI_Level_CurrentLifeCountLo
CODE_109D87:
	LDY.w #$0000
	LDX.w #$0000
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
CODE_109D90:
	LDY.w #$0000
CODE_109D93:
	CMP.w #$000A
	BCC.b CODE_109D9E
	SBC.w #$000A
	INY
	BRA.b CODE_109D93

CODE_109D9E:
	ASL
	ASL
	STA.b $00,x
	TYA
	INX
	INX
	CPX.w #$0006
	BNE.b CODE_109D90
	LDX.w !RAM_YI_Level_CurrentBonusGame
	LDA.l DATA_109D34,x
	PHB
	LDX.w #$7E4800>>16
	PHX
	PLB
	LDY.w $7E4800
	STA.w $0000,y
	CLC
	ADC.w #$0020
	STA.w $0012,y
	LDA.w #$0180
	STA.w $0002,y
	STA.w $0014,y
	LDA.w #$0018
	STA.w $0004,y
	STA.w $0016,y
	TYA
	CLC
	ADC.w #$000C
	STA.w $0005,y
	CLC
	ADC.w #$0012
	STA.w $0017,y
	LDA.w #$007E
	STA.w $0007,y
	STA.w $0019,y
	LDA.w #$0006
	STA.w $0008,y
	STA.w $001A,y
	TYA
	CLC
	ADC.w #$0012
	STA.w $000A,y
	CLC
	ADC.w #$0012
	STA.w $001C,y
	STA.w $7E4800
	PLB
	PLB
	TYA
	SEC
	SBC.w #$4802
	TAX
	LDY.w #$0004
	STY.b $06
	STZ.b $08
	STZ.b $0A
CODE_109E1A:
	LDA.w $0000,y
	BNE.b CODE_109E23
	LDA.b $08
	BEQ.b CODE_109E3D
CODE_109E23:
	LDA.w $0000,y
	TAY
	LDA.w DATA_109D40,y
	STA.l $7E480E,x
	LDA.w DATA_109D40+$02,y
	STA.l $7E4820,x
	STA.b $08
	INC.b $0A
	INC.b $0A
	INX
	INX
CODE_109E3D:
	DEC.b $06
	DEC.b $06
	LDY.b $06
	BEQ.b CODE_109E23
	BPL.b CODE_109E1A
	LDA.w #$3C7D
	LDY.b $0A
CODE_109E4C:
	CPY.w #$0006
	BEQ.b CODE_109E5F
	STA.l $7E480E,x
	STA.l $7E4820,x
	INX
	INX
	INY
	INY
	BRA.b CODE_109E4C

CODE_109E5F:
	RTS

DATA_109E60:
	db $11,$11,$11,$11,$11,$11,$11,$11,$11,$11,$11,$11

DATA_109E6C:
	db $11,$11,$11,$11,$11,$11,$15,$15,$15,$15,$15,$15

CODE_109E78:
	SEP.b #$10
	LDY.b #$80
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #DATA_109E60
	STA.w $6002
	LDA.w #DATA_109E60>>16
	STA.w $6000
	LDA.w #$0012
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_08D995>>16
	LDA.w #FXCODE_08D995
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	STZ.w !REGISTER_VRAMAddressLo
	LDA.w #$705800
	STA.w DMA[$00].SourceLo
	LDY.b #$705800>>16
	STY.w DMA[$00].SourceBank
	LDA.w #$1000
	STA.w DMA[$00].SizeLo
	LDY.b #$01
	STY.w !REGISTER_DMAEnable
	LDA.w #DATA_109E6C
	STA.w $6002
	LDA.w #DATA_109E6C>>16
	STA.w $6000
	LDA.w #$0014
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_08D995>>16
	LDA.w #FXCODE_08D995
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$0800
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$705800
	STA.w DMA[$00].SourceLo
	LDY.b #$705800>>16
	STY.w DMA[$00].SourceBank
	LDA.w #$1000
	STA.w DMA[$00].SizeLo
	LDY.b #$01
	STY.w !REGISTER_DMAEnable
	REP.b #$10
	JSR.w CODE_10A68F
	RTS

CODE_109EF6:
	SEP.b #$10
	LDY.b #$80
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #DATA_109E60
	STA.w $6002
	LDA.w #DATA_109E60>>16
	STA.w $6000
	LDA.w #$0012
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_08D995>>16
	LDA.w #FXCODE_08D995
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	STZ.w !REGISTER_VRAMAddressLo
	LDY.b #$706100>>16
	STY.w DMA[$00].SourceBank
	LDY.b #$01
	LDX.b #$07
CODE_109F2A:
	LDA.w #$706100
	STA.w DMA[$00].SourceLo
	LDA.w #$0120
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	DEX
	BNE.b CODE_109F2A
	JMP.w CODE_10B76B

CODE_109F3F:
	SEP.b #$20
	LDA.w DATA_10BFB7
	STA.w $1126
	LDA.w DATA_10BFB7+$01
	STA.w $1127
	LDA.w DATA_10BFB7+$02
	STA.w $1128
	LDA.w DATA_10BFB7+$03
	STA.w $1129
	LDA.w DATA_10BFB7+$08
	STA.w $112A
	LDA.w DATA_10BFB7+$09
	STA.w $112B
	LDA.w DATA_10BFB7+$0A
	STA.w $112C
	LDA.w DATA_10BFB7+$0B
	STA.w $112D
	LDA.w DATA_10BFB7+$10
	STA.w $112E
	LDA.w DATA_10BFB7+$11
	STA.w $112F
	LDA.w DATA_10BFB7+$12
	STA.w $1130
	LDA.w DATA_10BFB7+$13
	STA.w $1131
	LDA.b #$04
	STA.w $113E
	STA.w $113F
	STA.w $1140
	STZ.w $114D
	REP.b #$20
	LDA.w #$5800
	STA.w $1132
	STA.w $1134
	STA.w $1136
	LDA.w #$5000
	STA.w $114E
	STA.w $1150
	STA.w $1152
	JSR.w CODE_10BD7F
	RTS

CODE_109FB5:
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
	STA.w $1176
	SEP.b #$30
	STZ.w $1165
	STZ.w $1166
	STZ.w $1167
	STZ.w $1183
	STZ.w $1174
	LDA.b #$60
	STA.w $1168
	LDA.b #$80
	STA.w $1169
	STZ.w $116E
	STZ.w $116F
	LDA.b #$09
	STA.w $1179
	STA.w $117A
	STZ.w $117B
	LDA.b #$01
	STA.w $1178
	STZ.w $117C
	STZ.w $117D
	STZ.w $117E
	LDA.b #$40
	STA.w $1180
	STZ.w $117F
	REP.b #$30
	RTS

CODE_10A000:
	SEP.b #$10
	LDY.b #$80
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #DATA_109E6C
	STA.w $6002
	LDA.w #DATA_109E6C>>16
	STA.w $6000
	LDA.w #$0014
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_08D995>>16
	LDA.w #FXCODE_08D995
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	STZ.w !REGISTER_VRAMAddressLo
	LDY.b #$705FE0>>16
	STY.w DMA[$00].SourceBank
	LDY.b #$01
	LDX.b #$06
CODE_10A034:
	LDA.w #$705FE0
	STA.w DMA[$00].SourceLo
	LDA.w #$0120
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	DEX
	BNE.b CODE_10A034
	LDA.w #DATA_109E60
	STA.w $6002
	LDA.w #DATA_109E60>>16
	STA.w $6000
	LDA.w #$0012
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_08D995>>16
	LDA.w #FXCODE_08D995
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$705800
	STA.w DMA[$00].SourceLo
	LDY.b #$705800>>16
	STY.w DMA[$00].SourceBank
	LDA.w #$0900
	STA.w DMA[$00].SizeLo
	LDY.b #$01
	STY.w !REGISTER_DMAEnable
	LDA.w #DATA_109E6C
	STA.w $6002
	LDA.w #DATA_109E6C>>16
	STA.w $6000
	LDA.w #$0014
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_08D995>>16
	LDA.w #FXCODE_08D995
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$0800
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$705800
	STA.w DMA[$00].SourceLo
	LDY.b #$705800>>16
	STY.w DMA[$00].SourceBank
	LDA.w #$1000
	STA.w DMA[$00].SizeLo
	LDY.b #$01
	STY.w !REGISTER_DMAEnable
	JMP.w CODE_10CDA4

DATA_10A0B1:
	db $15,$11,$11,$11,$11,$11,$11,$11,$11,$11,$11,$11

CODE_10A0BD:
	SEP.b #$10
	LDY.b #$80
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #DATA_10A0B1
	STA.w $6002
	LDA.w #DATA_10A0B1>>16
	STA.w $6000
	LDA.w #$0016
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_08D995>>16
	LDA.w #FXCODE_08D995
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	STZ.w !REGISTER_VRAMAddressLo
	LDA.w #$705800
	STA.w DMA[$00].SourceLo
	LDY.b #$705800>>16
	STY.w DMA[$00].SourceBank
	LDA.w #$1000
	STA.w DMA[$00].SizeLo
	LDY.b #$01
	STY.w !REGISTER_DMAEnable
	LDA.w #DATA_109E6C
	STA.w $6002
	LDA.w #DATA_109E6C>>16
	STA.w $6000
	LDA.w #$0014
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_08D995>>16
	LDA.w #FXCODE_08D995
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$0800
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$705800
	STA.w DMA[$00].SourceLo
	LDY.b #$705800>>16
	STY.w DMA[$00].SourceBank
	LDA.w #$1000
	STA.w DMA[$00].SizeLo
	LDY.b #$01
	STY.w !REGISTER_DMAEnable
	REP.b #$10
	JSR.w CODE_10D205
	RTS

;-------------------------------------------------------------------------
; CODE_gm2c_bonus_game -- Game mode $2C: BonusGameMain (raid: CODE_gm2c_bonus_game).
; Main per-frame handler for the bonus game (Flip Cards / Match Cards /
; Slot Machine). Reads which sub-game from $1112, dispatches the per-frame
; state via tables further down in this bank, and handles award payout
; (extra lives, eggs, stars) when the player completes it.
;-------------------------------------------------------------------------
CODE_gm2c_bonus_game:
CODE_10A13B:
	JSL.l CODE_init_oam_buffer
	JSL.l CODE_spr_edge_despawn_draw
	REP.b #$30
	JSR.w CODE_10A175
	LDX.w !RAM_YI_Level_CurrentBonusGame
	JSR.w (DATA_bonus_game_tick_ptrs,x)
	JSR.w CODE_10A21C
	JSR.w CODE_10A33D
	SEP.b #$30
	JSL.l CODE_04FA67
	REP.b #$20
	LDX.b #FXCODE_08B1EF>>16
	LDA.w #FXCODE_08B1EF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	PLB
	RTL

;-------------------------------------------------------------------------
; DATA_bonus_game_tick_ptrs -- Bonus-game per-variant tick pointer table (6 entries).
; Indexed by !RAM_YI_Level_CurrentBonusGame in CODE_gm2c_bonus_game. Each
; entry is the per-frame handler for one of the six post-level games:
; Flip Cards, Scratch & Match, Drawing Lots, Slot Machine, Match Cards,
; Roulette Lots (exact mapping depends on the game's bonus-game ID order).
;-------------------------------------------------------------------------
DATA_bonus_game_tick_ptrs:
DATA_10A169:
	dw CODE_10A26F
	dw CODE_10B5CE
	dw CODE_10CD4F
	dw CODE_10D181
	dw CODE_10C497
	dw CODE_10BD5D

CODE_10A175:
	LDY.w $6092
	LDA.w #$00C8
	STA.w $6000,y
	STA.w $6008,y
	LDA.w #$00D8
	STA.w $6010,y
	STA.w $6018,y
	LDA.w #$0018
	STA.w $6020,y
	STA.w $6028,y
	LDA.w #$0028
	STA.w $6030,y
	STA.w $6038,y
	LDA.w #$00C0
	STA.w $6002,y
	STA.w $6012,y
	STA.w $6022,y
	STA.w $6032,y
	LDA.w #$00D0
	STA.w $600A,y
	STA.w $601A,y
	STA.w $602A,y
	STA.w $603A,y
	LDA.w #$0F0D
	STA.w $6004,y
	STA.w $6024,y
	LDA.w #$0F2D
	STA.w $600C,y
	STA.w $602C,y
	LDA.w #$4F0D
	STA.w $6014,y
	STA.w $6034,y
	LDA.w #$4F2D
	STA.w $601C,y
	STA.w $603C,y
	LDA.w #$4002
	STA.w $6006,y
	STA.w $600E,y
	STA.w $6016,y
	STA.w $601E,y
	STA.w $6026,y
	STA.w $602E,y
	STA.w $6036,y
	STA.w $603E,y
	TYA
	CLC
	ADC.w #$0040
	STA.w $6092
	RTS

DATA_10A202:
	dw $44A6,$48C7,$4CE8,$5109

DATA_10A20A:
	dw $001F,$023F,$037F,$03F3,$0327,$7F20,$7E66,$7D77
	dw $7C1F

CODE_10A21C:
	LDA.b $30
	AND.w #$0007
	BNE.b CODE_10A26E
	INC.w $10E2
	LDA.w $10E2
	ASL
	TAY
	CPY.w #$0012
	BNE.b CODE_10A236
	LDY.w #$0000
	STY.w $10E2
CODE_10A236:
	LDX.w #$0010
CODE_10A239:
	LDA.w DATA_10A20A,y
	STA.l YI_Global_PaletteMirror[$13].LowByte,x
	INY
	INY
	CPY.w #$0012
	BNE.b CODE_10A24A
	LDY.w #$0000
CODE_10A24A:
	DEX
	DEX
	BPL.b CODE_10A239
	INC.w $10E4
	LDA.w $10E4
	AND.w #$0003
	ASL
	TAY
	LDX.w #$0006
CODE_10A25C:
	LDA.w DATA_10A202,y
	STA.l YI_Global_PaletteMirror[$1C].LowByte,x
	DEY
	DEY
	BPL.b CODE_10A26A
	LDY.w #$0006
CODE_10A26A:
	DEX
	DEX
	BPL.b CODE_10A25C
CODE_10A26E:
	RTS

CODE_10A26F:
	LDA.w $10DE
	ASL
	TAX
	JMP.w (DATA_10A277,x)

DATA_10A277:
	dw CODE_10A41C
	dw CODE_10A427
	dw CODE_10A444
	dw CODE_10A466
	dw CODE_10A481
	dw CODE_10A4EC
	dw CODE_10A549
	dw CODE_10A5B3
	dw CODE_10A70A
	dw CODE_10AE80
	dw CODE_10AB90
	dw CODE_10ABCD
	dw CODE_10A5C7
	dw CODE_10A9BE
	dw CODE_10B00E
	dw CODE_10B046
	dw CODE_10A621
	dw CODE_10B49E
	dw CODE_10B4BB

DATA_10A29D:
	dw $0046,$0047,$0046,$004D,$0044,$0045,$0044,$002F
	dw $002C,$002D,$002E,$002F,$0030,$0031,$0032,$0033
	dw $0034,$004C,$00DA,$00DB,$00DC,$00DD,$0011,$0012
	dw $0011,$00DE,$006B,$006C,$006D,$006E,$00DF,$00E0

DATA_10A2DD:
	dw $0000,$000E,$0022,$0032,$003C,$003E

DATA_10A2E9:
	dw $000E,$0022,$0032,$003C,$0040,$0040

DATA_10A2F5:
	dw $0006,$0006,$0006,$0006,$0006,$0006,$0006,$0001
	dw $0001,$0004,$0001,$0008,$0004,$0001,$0001,$0001
	dw $0005,$0004,$0008,$0004,$0008,$000C,$0004,$0004
	dw $0004,$0008,$0020,$0004,$0004,$8000,$0010,$0010

DATA_10A335:
	dw $0004,$0004,$0004,$0004

CODE_10A33D:
	LDA.w #$0030
	STA.w $6126
	LDX.w $10F0
	JSR.w (DATA_10A37C,x)
	LDA.b $30
	AND.w #$0007
	BNE.b CODE_10A35E
	LDA.b $30
	AND.w #$0018
	LSR
	LSR
	TAY
	LDA.w DATA_10A335,y
	STA.w $7402
CODE_10A35E:
	SEP.b #$10
	PHB
	LDX.b #YI_NorSpr061_BabyMario_Main>>16
	PHX
	PLB
	PHD
	LDA.w #$7960
	TCD
	LDX.b #$00
	STX.w $7972
	JSL.l YI_NorSpr061_BabyMario_Main
	JSL.l CODE_handle_ambient_sprites
	PLD
	PLB
	REP.b #$10
	RTS

DATA_10A37C:
	dw CODE_10A388
	dw CODE_10A3AB
	dw CODE_10A3CA
	dw CODE_10A388
	dw CODE_10A388
	dw CODE_10A388

CODE_10A388:
	DEC.w $61D2
	BNE.b CODE_10A3AA
	LDA.w $60F8
	INC
	INC
	CMP.w DATA_10A2E9,x
	BNE.b CODE_10A39A
	LDA.w DATA_10A2DD,x
CODE_10A39A:
	STA.w $60F8
	TAY
	LDA.w DATA_10A29D,y
	STA.w $60BE
	LDA.w DATA_10A2F5,y
	STA.w $61D2
CODE_10A3AA:
	RTS

CODE_10A3AB:
	DEC.w $61D2
	BNE.b CODE_10A3AA
	LDA.w $60F8
	INC
	INC
	CMP.w DATA_10A2E9,x
	BNE.b CODE_10A39A
	LDA.w #!Define_YI_SoundID20_SoaringEgg
	JSL.l CODE_push_sound_queue
	LDX.w #$0000
	STX.w $10F0
	TXA
	BRA.b CODE_10A39A

CODE_10A3CA:
	DEC.w $61D2
	BNE.b CODE_10A3FA
	LDA.w $60F8
	INC
	INC
	CMP.w DATA_10A2E9,x
	BNE.b CODE_10A3DC
	LDA.w DATA_10A2DD,x
CODE_10A3DC:
	STA.w $60F8
	TAY
	CMP.w #$0024
	BNE.b CODE_10A3EE
	LDA.w #$FC00
	STA.w $60AA
	INC.w $60C0
CODE_10A3EE:
	LDA.w DATA_10A29D,y
	STA.w $60BE
	LDA.w DATA_10A2F5,y
	STA.w $61D2
CODE_10A3FA:
	LDA.w $60C0
	BEQ.b CODE_10A41B
	LDA.w $60AA
	CLC
	ADC.w #$0040
	STA.w $60AA
	CLC
	ADC.w !EXRAM_YI_Player_SubYPosHi|!EXRAMBankMirror
	CMP.w #$A800
	BCC.b CODE_10A418
	STZ.w $60C0
	LDA.w #$A800
CODE_10A418:
	STA.w !EXRAM_YI_Player_SubYPosHi|!EXRAMBankMirror
CODE_10A41B:
	RTS

CODE_10A41C:
	DEC.w $10E0
	BNE.b CODE_10A426
	INC.w $10DE
	STZ.b $83
CODE_10A426:
	RTS

CODE_10A427:
	JSR.w CODE_109CB2
	LDA.b $87
	BNE.b CODE_10A437
	LDA.w #$0030
	STA.w $10E0
	INC.w $10DE
CODE_10A437:
	RTS

DATA_10A438:
	dw $0028,$0058,$00E8,$0118,$00B8,$0088

CODE_10A444:
	DEC.w $10E0
	BNE.b CODE_10A459
	LDX.w !RAM_YI_Level_CurrentBonusGame
	LDA.w DATA_10A438,x
	STA.l $704070
	INC.w !RAM_YI_Level_MessageBoxState 
	INC.w $10DE
CODE_10A459:
	RTS

DATA_10A45A:
	dw $0010,$000D,$000C,$000D,$0009,$000C

CODE_10A466:
	SEP.b #$30
	JSL.l CODE_message_box_handler
	REP.b #$30
	JSR.w CODE_109CB2
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_10A480
	LDY.w !RAM_YI_Level_CurrentBonusGame
	LDX.w $10DE
	INX
	STX.w $10DE
CODE_10A480:
	RTS

CODE_10A481:
	LDA.b $30
	AND.w #$0001
	BNE.b CODE_10A4CB
	LDA.w $0948
	SEC
	SBC.w #$0421
	STA.w $0948
	BNE.b CODE_10A4CB
	LDA.w #!Define_YI_SoundID46_BonusGameBoardFalls
	JSL.l CODE_push_sound_queue
	INC.w $10DE
	LDY.w !RAM_YI_Level_CurrentBonusGame
	CPY.w #!Define_YI_BonusID_SlotMachine
	BNE.b CODE_10A4CB
	SEP.b #$20
	LDA.b #$10
	STA.w !RAM_YI_Global_MainScreenWindowMask
	LDA.b #$91
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.b #$30
	STA.w !RAM_YI_Global_ObjectAndColorWindowSettings
	STZ.w !RAM_YI_Global_BG1And2WindowMaskSettings
	STZ.w !RAM_YI_Global_BG3And4WindowMaskSettings
	LDY.w #$4A53
	INC.w $114D
	STY.w $0948
	REP.b #$20
	JMP.w CODE_10A51C

CODE_10A4CB:
	LDY.w !RAM_YI_Level_CurrentBonusGame
	CPY.w #!Define_YI_BonusID_Roulette
	BNE.b CODE_10A4EB
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
	INC
	CMP.w #$0001
	BNE.b CODE_10A4EB
	LDA.w #$0001
	STA.w !RAM_YI_Level_CurrentLifeCountLo
	LDA.w #!Define_YI_GameMode1F
	STA.w !RAM_YI_Global_CurrentGameMode
	STZ.w !RAM_YI_Level_DoBonusChallengeFlagLo
CODE_10A4EB:
	RTS

CODE_10A4EC:
	LDA.b !RAM_YI_Global_Layer1YPosLo
	SEC
	SBC.w #$0008
	STA.b !RAM_YI_Global_Layer1YPosLo
	STA.b !RAM_YI_Global_Layer2YPosLo
	BNE.b CODE_10A514
	LDA.w #!Define_YI_SoundID46_BonusGameBoardFalls
	JSL.l CODE_push_sound_queue
	INC.w $10DE
	STZ.w $10EC
	LDY.w $10EC
	LDA.w DATA_10A535,y
	STA.w $10E6
	LDA.w DATA_10A53F,y
	STA.w $10E8
CODE_10A514:
	LDX.w !RAM_YI_Level_CurrentBonusGame
	CPX.w #!Define_YI_BonusID_SlotMachine
	BNE.b CODE_10A534
CODE_10A51C:
	SEP.b #$10
	LDA.b !RAM_YI_Global_Layer1YPosLo
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_08B3F5>>16
	LDA.w #FXCODE_08B3F5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	JSR.w CODE_109D27
	JMP.w CODE_10C017

CODE_10A534:
	RTS

DATA_10A535:
	dw $0000,$0000,$0000,$0000,$0000

DATA_10A53F:
	dw $0005,$0004,$0003,$0002,$0001

CODE_10A549:
	LDA.w $10E6
	SEC
	SBC.w #$8000
	STA.w $10E6
	LDA.w $10E8
	SBC.w #$0000
	STA.w $10E8
	LDA.w $10E6
	CLC
	ADC.w $10EA
	STA.w $10EA
	LDA.b !RAM_YI_Global_Layer1YPosLo
	ADC.w $10E8
	STA.b !RAM_YI_Global_Layer1YPosLo
	STA.b !RAM_YI_Global_Layer2YPosLo
	BPL.b CODE_10A5A4
	LDA.w #!Define_YI_SoundID46_BonusGameBoardFalls
	JSL.l CODE_push_sound_queue
	STZ.w $10EA
	STZ.b !RAM_YI_Global_Layer1YPosLo
	STZ.b !RAM_YI_Global_Layer2YPosLo
	LDA.w $10EC
	INC
	INC
	STA.w $10EC
	TAY
	CPY.w #$000A
	BNE.b CODE_10A598
	INC.w $10DE
	LDA.w #$0030
	STA.w $10E0
	BRA.b CODE_10A5A4

CODE_10A598:
	LDA.w DATA_10A535,y
	STA.w $10E6
	LDA.w DATA_10A53F,y
	STA.w $10E8
CODE_10A5A4:
	JMP.w CODE_10A514

DATA_10A5A7:
	dw $0005,$0005,$0010,$0015,$0010,$0029

CODE_10A5B3:
	DEC.w $10E0
	BNE.b CODE_10A5C4
	LDY.w !RAM_YI_Level_CurrentBonusGame
	LDA.w DATA_10A5A7,y
	STA.w $10E0
	INC.w $10DE
CODE_10A5C4:
	JMP.w CODE_10A514

CODE_10A5C7:
	SEP.b #$30
	JSL.l CODE_message_box_handler_entry
	REP.b #$30
	JSR.w CODE_109D27
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_10A620
	JSR.w CODE_10AE80
	LDX.w #$0008
	LDA.l $704094
	BEQ.b CODE_10A61D
	LDY.w !RAM_YI_Level_CurrentBonusGame
	CPY.w #!Define_YI_BonusID_FlipCards
	BNE.b CODE_10A619
	SEP.b #$30
	LDY.b #$06
CODE_10A5EF:
	LDA.w $10F9,y
	BNE.b CODE_10A5F9
	DEY
	BPL.b CODE_10A5EF
	BRA.b CODE_10A617

CODE_10A5F9:
	REP.b #$30
	LDA.w #$0005
	STA.b !RAM_YI_Global_PlayMusicLo
	LDA.w #$0090
	STA.w $10E0
	LDX.w #$0004
	STX.w $10F0
	LDA.w DATA_10A2DD,x
	JSR.w CODE_10A39A
	SEP.b #$30
	JSR.w CODE_10A8F6
CODE_10A617:
	REP.b #$30
CODE_10A619:
	LDX.w $10DE
	INX
CODE_10A61D:
	STX.w $10DE
CODE_10A620:
	RTS

CODE_10A621:
	JSR.w CODE_10AE80
	LDA.b $37
	AND.w #$00F0
	ORA.b $38
	BNE.b CODE_10A632
	DEC.w $10E0
	BNE.b CODE_10A643
CODE_10A632:
	LDA.w #!Define_YI_GameMode1F
	STA.w !RAM_YI_Global_CurrentGameMode
	STZ.w !RAM_YI_Level_DoBonusChallengeFlagLo
	SEP.b #$30
	JSL.l CODE_save_game
	REP.b #$30
CODE_10A643:
	LDX.w !RAM_YI_Level_CurrentBonusGame
	CPX.w #!Define_YI_BonusID_SlotMachine
	BNE.b CODE_10A64E
	JMP.w CODE_10C017

CODE_10A64E:
	RTS

DATA_10A64F:
	db $0A,$06,$05,$08,$00,$09,$02,$01,$0A,$06,$07,$08,$00,$09,$01,$01
	db $0A,$0A,$07,$02,$03,$0B,$01,$01,$0A,$0A,$06,$07,$06,$05,$01,$01
	db $0A,$07,$02,$03,$0B,$01,$01,$01,$0A,$0A,$0A,$07,$07,$07,$01,$01
	db $0A,$06,$06,$00,$09,$01,$01,$01,$0A,$0A,$06,$06,$07,$09,$01,$01

CODE_10A68F:
	JSL.l CODE_random_number_gen
	SEP.b #$30
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.b #$07
	TAX
	LDA.b #$00
CODE_10A69D:
	DEX
	BMI.b CODE_10A6A5
	CLC
	ADC.b #$08
	BRA.b CODE_10A69D

CODE_10A6A5:
	TAY
	REP.b #$20
	LDA.w DATA_10A64F,y
	STA.b $00
	LDA.w DATA_10A64F+$02,y
	STA.b $02
	LDA.w DATA_10A64F+$04,y
	STA.b $04
	LDA.w DATA_10A64F+$06,y
	STA.b $06
	LDA.w DATA_10A64F+$08,y
	STA.b $08
	SEP.b #$20
	LDA.b #$08
	STA.b $0A
	LDY.b #$00
CODE_10A6C9:
	JSL.l CODE_random_number_gen
	LDA.b $0A
	STA.w !REGISTER_Multiplicand
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	STA.w !REGISTER_Multiplier
	NOP #4
	REP.b #$20
	LDA.w !REGISTER_ProductOrRemainderLo
	XBA
	SEP.b #$20
	AND.b #$0F
	TAX
	LDA.b $00,x
	STA.w $1104,y
	INY
	CPY.b #$07
	BEQ.b CODE_10A6FE
	DEC.b $0A
CODE_10A6F3:
	CPX.b $0A
	BEQ.b CODE_10A6C9
	LDA.b $01,x
	STA.b $00,x
	INX
	BRA.b CODE_10A6F3

CODE_10A6FE:
	TXA
	EOR.b #$01
	TAX
	LDA.b $00,x
	STA.w $110B
	REP.b #$30
	RTS

CODE_10A70A:
	SEP.b #$30
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	BEQ.b CODE_10A716
	JSR.w CODE_10AE80
	BRA.b CODE_10A76F

CODE_10A716:
	LDA.w $10F3
	CMP.b #$0A
	BNE.b CODE_10A739
	REP.b #$30
	LDX.w #$0006
	STX.w $10F0
	LDA.w DATA_10A2DD,x
	JSR.w CODE_10A39A
	SEP.b #$30
	LDA.b #$10
	STA.w $10DE
	LDA.b #$C0
	STA.w $10E0
	BRA.b CODE_10A76F

CODE_10A739:
	LDA.w $1148
	CMP.b #$07
	BNE.b CODE_10A75F
	JSR.w CODE_10A8F6
	REP.b #$30
	LDX.w #$0004
	STX.w $10F0
	LDA.w DATA_10A2DD,x
	JSR.w CODE_10A39A
	SEP.b #$30
	LDA.b #$0E
	STA.w $10DE
	LDA.b #$60
	STA.w $10E0
	BRA.b CODE_10A76F

CODE_10A75F:
	LDA.w $10F8
	BEQ.b CODE_10A769
	JSR.w CODE_10A77A
	BRA.b CODE_10A76C

CODE_10A769:
	JSR.w CODE_10A7C3
CODE_10A76C:
	JSR.w CODE_10A928
CODE_10A76F:
	REP.b #$30
	RTS

DATA_10A772:
	db $58,$78,$98

DATA_10A775:
	db $60,$80,$A0

DATA_10A778:
	db $02,$FE

CODE_10A77A:
	SEP.b #$30
	LDA.w $10F8
	CMP.b #$03
	BCS.b CODE_10A7A0
	LDX.w $110D
	LDA.w DATA_10A772,x
	CMP.w $10F6
	BEQ.b CODE_10A7BD
	LDA.w $10F8
	AND.b #$01
	TAX
	LDA.w $10F6
	CLC
	ADC.w DATA_10A778,x
	STA.w $10F6
	BRA.b CODE_10A7C0

CODE_10A7A0:
	LDX.w $110E
	LDA.w DATA_10A775,x
	CMP.w $10F7
	BEQ.b CODE_10A7BD
	LDA.w $10F8
	AND.b #$01
	TAX
	LDA.w $10F7
	CLC
	ADC.w DATA_10A778,x
	STA.w $10F7
	BRA.b CODE_10A7C0

CODE_10A7BD:
	STZ.w $10F8
CODE_10A7C0:
	REP.b #$30
	RTS

CODE_10A7C3:
	SEP.b #$30
	LDA.w $093F
	AND.b #$C0
	BNE.b CODE_10A7D6
	LDA.w $093E
	AND.b #$80
	BNE.b CODE_10A7D6
	JMP.w CODE_10A838

CODE_10A7D6:
	LDA.w $110E
	ASL
	ORA.w $110E
	CLC
	ADC.w $110D
	STA.w $10F2
	CMP.b #$04
	BNE.b CODE_10A7F2
	LDA.b #$01
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	INC.w $10DE
	BRA.b CODE_10A821

CODE_10A7F2:
	BMI.b CODE_10A7F5
	DEC
CODE_10A7F5:
	TAX
	LDA.w $1104,x
	CMP.b #$FF
	BNE.b CODE_10A800
CODE_10A7FD:
	JMP.w CODE_10A8F3

CODE_10A800:
	STA.w $10F3
	LDA.b #$FF
	STA.w $1104,x
	LDA.b #$01
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	INC.w $1148
	INC.w $10DE
	LDA.w $10F3
	CMP.b #$01
	BEQ.b CODE_10A821
	CMP.b #$0A
	BEQ.b CODE_10A821
	JSR.w CODE_10A916
CODE_10A821:
	JSR.w CODE_10AD77
	REP.b #$30
	LDA.w #$002B
	STA.w $60BE
	LDX.w #$0002
	STX.w $10F0
	LDA.w DATA_10A2DD,x
	JMP.w CODE_10A39A

CODE_10A838:
	SEP.b #$30
	LDA.w $093F
	AND.b #$0F
	BEQ.b CODE_10A7FD
	LDA.b #!Define_YI_SoundID5C_ScrollTextbox
	JSL.l CODE_push_sound_queue
	LDA.w $093F
	AND.b #$03
	BEQ.b CODE_10A8B4
	AND.b #$02
	BEQ.b CODE_10A882
	LDA.w $110D
	BNE.b CODE_10A877
	LDX.b #$02
	STX.w $110D
	LDA.w DATA_10A772,x
	STA.w $10F6
	LDA.w $110E
	DEC
	BPL.b CODE_10A86A
	LDA.b #$02
CODE_10A86A:
	STA.w $110E
	TAX
	LDA.w DATA_10A775,x
	STA.w $10F7
	JMP.w CODE_10A8F3

CODE_10A877:
	DEC.w $110D
	LDA.b #$01
	STA.w $10F8
	JMP.w CODE_10A8F3

CODE_10A882:
	LDA.w $110D
	CMP.b #$02
	BNE.b CODE_10A8AA
	LDX.b #$00
	STX.w $110D
	LDA.w DATA_10A772,x
	STA.w $10F6
	LDA.w $110E
	INC
	CMP.b #$03
	BNE.b CODE_10A89E
	LDA.b #$00
CODE_10A89E:
	STA.w $110E
	TAX
	LDA.w DATA_10A775,x
	STA.w $10F7
	BRA.b CODE_10A8F3

CODE_10A8AA:
	INC.w $110D
	LDA.b #$02
	STA.w $10F8
	BRA.b CODE_10A8F3

CODE_10A8B4:
	LDA.w $093F
	AND.b #$08
	BEQ.b CODE_10A8D7
	LDA.w $110E
	BNE.b CODE_10A8CD
	LDX.b #$02
	STX.w $110E
	LDA.w DATA_10A775,x
	STA.w $10F7
	BRA.b CODE_10A8F3

CODE_10A8CD:
	DEC.w $110E
	LDA.b #$03
	STA.w $10F8
	BRA.b CODE_10A8F3

CODE_10A8D7:
	LDA.w $110E
	CMP.b #$02
	BNE.b CODE_10A8EB
	LDX.b #$00
	STX.w $110E
	LDA.w DATA_10A775,x
	STA.w $10F7
	BRA.b CODE_10A8F3

CODE_10A8EB:
	INC.w $110E
	LDA.b #$04
	STA.w $10F8
CODE_10A8F3:
	REP.b #$30
	RTS

CODE_10A8F6:
	SEP.b #$30
	LDX.b #$00
CODE_10A8FA:
	LDA.w $10F9,x
	BEQ.b CODE_10A909
	PHX
	JSR.w CODE_109C80
	PLX
	INX
	CPX.b #$07
	BNE.b CODE_10A8FA
CODE_10A909:
	RTS

DATA_10A90A:
	db !Define_YI_ItemID_StarCloud,!Define_YI_ItemID_FreeSlot,!Define_YI_ItemID_GreenMelon
	db !Define_YI_ItemID_RedMelon,!Define_YI_ItemID_FreeSlot,!Define_YI_ItemID_FullEgg
	db !Define_YI_ItemID_10Star,!Define_YI_ItemID_20Star,!Define_YI_ItemID_POW
	db !Define_YI_ItemID_MagnifyingGlass,!Define_YI_ItemID_FreeSlot,!Define_YI_ItemID_BlueMelon

CODE_10A916:
	SEP.b #$30
	LDY.w $1100
	LDX.w $10F3
	LDA.w DATA_10A90A,x
	STA.w $10F9,y
	INC.w $1100
	RTS

CODE_10A928:
	REP.b #$30
	LDY.w $6092
	LDA.b $30
	AND.w #$0008
	LSR
	LSR
	LSR
	STA.b $00
	LDA.b $30
	AND.w #$0010
	BEQ.b CODE_10A946
	LDA.b $00
	EOR.w #$FFFF
	INC
	STA.b $00
CODE_10A946:
	LDA.w $10F6
	INC
	CLC
	ADC.b $00
	AND.w #$00FF
	STA.w $6000,y
	STA.w $6010,y
	LDA.w $10F6
	DEC
	CLC
	ADC.w #$0010
	SEC
	SBC.b $00
	AND.w #$00FF
	STA.w $6008,y
	STA.w $6018,y
	LDA.w $10F7
	INC
	CLC
	ADC.b $00
	AND.w #$00FF
	STA.w $6002,y
	STA.w $600A,y
	LDA.w $10F7
	DEC
	CLC
	ADC.w #$0010
	SEC
	SBC.b $00
	AND.w #$00FF
	STA.w $6012,y
	STA.w $601A,y
	LDA.w #$309F
	STA.w $6004,y
	LDA.w #$709F
	STA.w $600C,y
	LDA.w #$B09F
	STA.w $6014,y
	LDA.w #$F09F
	STA.w $601C,y
	LDA.w #$0000
	STA.w $6006,y
	STA.w $600E,y
	STA.w $6016,y
	STA.w $601E,y
	TYA
	CLC
	ADC.w #$0020
	STA.w $6092
	RTS

CODE_10A9BE:
	JSR.w CODE_10AE80
	DEC.w $10E0
	BNE.b CODE_10AA09
	LDA.w $1102
	AND.w #$00FF
	BNE.b CODE_10A9DC
	LDA.w #$0080
	STA.w $10E0
	LDA.w #$0010
	STA.w $10DE
	BRA.b CODE_10AA09

CODE_10A9DC:
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
	CMP.w #$03E7
	BNE.b CODE_10A9F0
	SEP.b #$20
	STZ.w $1102
	REP.b #$20
	INC.w $10E0
	BRA.b CODE_10AA09

CODE_10A9F0:
	SEP.b #$20
	DEC.w $1102
	LDA.b #!Define_YI_SoundID08_1up
	JSL.l CODE_push_sound_queue
	REP.b #$20
	INC.w !RAM_YI_Level_CurrentLifeCountLo
	JSR.w CODE_109D74
	LDA.w #$0030
	STA.w $10E0
CODE_10AA09:
	RTS

DATA_10AA0A:
	dw $6E6D,$7B7A,$6F78,$7970,$7271,$7A73

DATA_10AA16:
	db $09,$0D,$0A,$0D,$0B,$0D,$0C,$0D,$0D,$0D,$0E,$0D,$0F,$0D,$10,$0D
	db $11,$0D,$12,$15,$13,$15,$14,$15,$15,$15,$16,$15,$17,$15,$18,$15
	db $19,$15,$1A,$15,$92,$11,$93,$11,$94,$11,$95,$11,$96,$11,$97,$11
	db $98,$11,$99,$11,$9A,$11,$9B,$15,$9C,$15,$9D,$15,$9E,$15,$9F,$15
	db $A0,$15,$A1,$15,$A2,$15,$A3,$15,$80,$0D,$81,$0D,$82,$0D,$83,$0D
	db $84,$0D,$85,$0D,$86,$0D,$87,$0D,$88,$0D,$1B,$0D,$1C,$0D,$1D,$0D
	db $1E,$0D,$1F,$0D,$20,$0D,$21,$0D,$22,$0D,$23,$0D,$24,$0D,$25,$0D
	db $26,$0D,$27,$0D,$28,$0D,$29,$0D,$2A,$0D,$2B,$0D,$2C,$0D,$89,$15
	db $8A,$15,$8B,$15,$8C,$15,$8D,$15,$8E,$15,$8F,$15,$90,$15,$91,$15
	db $2D,$15,$2E,$15,$2F,$15,$30,$15,$31,$15,$32,$15,$33,$15,$34,$15
	db $35,$15,$36,$0D,$37,$0D,$38,$0D,$39,$0D,$3A,$0D,$3B,$0D,$3C,$0D
	db $3D,$0D,$3E,$0D,$3F,$15,$40,$15,$41,$15,$42,$15,$43,$15,$44,$15
	db $45,$15,$46,$15,$47,$15,$92,$0D,$93,$0D,$94,$0D,$95,$0D,$96,$0D
	db $97,$0D,$98,$0D,$99,$0D,$9A,$0D,$00,$0D,$01,$0D,$02,$0D,$03,$0D
	db $04,$0D,$05,$0D,$06,$0D,$07,$0D,$08,$0D

DATA_10AB00:
	dw $698B,$698F,$6993,$6A0B

DATA_10AB08:
	dw $6A0F,$6A13,$6A8B,$6A8F,$6A93

DATA_10AB12:
	dw $0000,$0000,$0000

DATA_10AB18:
	db $54,$74,$94,$54

DATA_10AB1C:
	db $74,$94,$54,$74,$94

DATA_10AB21:
	db $5C,$5C,$5C,$7C

DATA_10AB25:
	db $7C,$7C,$9C,$9C,$9C

DATA_10AB2A:
	db $36,$32,$36,$32,$36,$32,$36,$32,$36

DATA_10AB33:
	db $32,$36,$34,$36,$32,$32,$32,$36,$36,$36,$36,$32

CODE_10AB3F:
	LDA.w $10F2
	AND.w #$00FF
	PHA
	ASL
	TAX
	LDA.w #$0003
	STA.b $0E
	LDY.w DATA_10AB00,x
CODE_10AB50:
	LDA.w #DATA_10AB12>>16
	STA.b $01
	LDX.w #DATA_10AB12
	LDA.w #$0006
	PHY
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0020
	TAY
	DEC.b $0E
	BNE.b CODE_10AB50
	PLA
	TAX
	CLC
	ADC.w #DATA_10AB2A
	STA.b $00
	TXA
	CLC
	ADC.w #DATA_10AB18
	STA.b $02
	TXA
	CLC
	ADC.w #DATA_10AB21
	STA.b $04
	JSR.w CODE_10ACB7
	STZ.w $10F4
	LDA.w #$006C
	LDX.w #$0011
	JSR.w CODE_10AC94
	RTS

CODE_10AB90:
	JSR.w CODE_10AE80
	LDA.w $10F4
	CLC
	ADC.w #$0008
	STA.w $10F4
	CMP.w #$0080
	BMI.b CODE_10ABA6
	INC.w $10DE
	RTS

CODE_10ABA6:
	LDA.w $10F2
	AND.w #$00FF
	TAX
	CLC
	ADC.w #DATA_10AB2A
	STA.b $00
	TXA
	CLC
	ADC.w #DATA_10AB18
	STA.b $02
	TXA
	CLC
	ADC.w #DATA_10AB21
	STA.b $04
	JSR.w CODE_10ACB7
	LDA.w #$006C
	LDX.w #$0011
	JMP.w CODE_10AC94

CODE_10ABCD:
	JSR.w CODE_10AE80
	LDA.w $10F4
	SEC
	SBC.w #$0008
	STA.w $10F4
	BMI.b CODE_10ABDF
	JMP.w CODE_10AC67

CODE_10ABDF:
	LDA.w $10F2
	AND.w #$00FF
	ASL
	TAX
	LDY.w DATA_10AB00,x
	LDA.w $10F3
	AND.w #$00FF
	STA.b $00
	ASL
	ASL
	ASL
	ASL
	CLC
	ADC.b $00
	CLC
	ADC.b $00
	CLC
	ADC.w #DATA_10AA16
	TAX
	LDA.w #$0003
	STA.b $0E
CODE_10AC06:
	LDA.w #DATA_10AA16>>16
	STA.b $01
	LDA.w #$0006
	PHX
	PHY
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0020
	TAY
	PLA
	CLC
	ADC.w #$0006
	TAX
	DEC.b $0E
	BNE.b CODE_10AC06
	LDA.w $10DE
	CMP.w #$000D
	BEQ.b CODE_10AC66
	LDA.w $1148
	CMP.w #$0009
	BNE.b CODE_10AC3F
	LDA.w #$0020
	STA.w $10E0
	LDA.w #$000F
	BRA.b CODE_10AC63

CODE_10AC3F:
	LDA.w $10F3
	AND.w #$00FF
	CMP.w #$0001
	BNE.b CODE_10AC4F
	LDA.w #!Define_YI_SoundID90_Incorrect
	BRA.b CODE_10AC5C

CODE_10AC4F:
	CMP.w #$000A
	BNE.b CODE_10AC59
	LDA.w #!Define_YI_SoundID7D_YoshiLostChallenge
	BRA.b CODE_10AC5C

CODE_10AC59:
	LDA.w #!Define_YI_SoundID8F_Correct
CODE_10AC5C:
	JSL.l CODE_push_sound_queue
	LDA.w #$0008
CODE_10AC63:
	STA.w $10DE
CODE_10AC66:
	RTS

CODE_10AC67:
	LDA.w $10F3
	AND.w #$00FF
	TAY
	CLC
	ADC.w #DATA_10AB33
	STA.b $00
	LDA.w $10F2
	AND.w #$00FF
	TAX
	CLC
	ADC.w #DATA_10AB18
	STA.b $02
	TXA
	CLC
	ADC.w #DATA_10AB21
	STA.b $04
	JSR.w CODE_10ACB7
	LDA.w DATA_10AA0A,y
	AND.w #$00FF
	LDX.w #$0011
CODE_10AC94:
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STX.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $10F4
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	SEP.b #$10
	LDX.b #FXCODE_08DE98>>16
	LDA.w #FXCODE_08DE98
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	JSR.w CODE_10AD19
	RTS

CODE_10ACB7:
	PHY
	LDY.w $6092
	LDA.b ($02)
	AND.w #$00FF
	STA.w $6000,y
	STA.w $6010,y
	CLC
	ADC.w #$0010
	STA.w $6008,y
	STA.w $6018,y
	LDA.b ($04)
	AND.w #$00FF
	STA.w $6002,y
	STA.w $600A,y
	CLC
	ADC.w #$0010
	STA.w $6012,y
	STA.w $601A,y
	LDA.b ($00)
	XBA
	AND.w #$FF00
	ORA.w #$01E8
	STA.w $6004,y
	INC
	INC
	STA.w $600C,y
	INC
	INC
	STA.w $6014,y
	INC
	INC
	STA.w $601C,y
	LDA.w #$0002
	STA.w $6006,y
	STA.w $600E,y
	STA.w $6016,y
	STA.w $601E,y
	TYA
	CLC
	ADC.w #$0020
	STA.w $6092
	PLY
	RTS

CODE_10AD19:
	LDA.w #$705800>>16
	STA.b $01
	LDY.w #$5E80
	LDX.w #$705800
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$5F80
	LDX.w #$705A00
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$5EC0
	LDX.w #$705C00
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$5FC0
	LDX.w #$705E00
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	RTS

DATA_10AD53:
	dw $0007,$000D,$000C,$000A,$0008,$0008,$0003,$FFFD
	dw $FFF6

DATA_10AD65:
	dw $000A,$0010,$0010,$000C,$000B,$0004,$0003,$0003
	dw $0003

CODE_10AD77:
	REP.b #$20
	SEP.b #$10
	LDY.b #$04
	LDA.w #!Define_YI_NorSpr022_FlashingEgg
	JSL.l CODE_03A366
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_10AD53
	STA.w $70E6
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_10AD65
	STA.w $7186
	STZ.w $7224
	STZ.w $7226
	LDA.w #$0001
	STA.w $74A6
	LDA.w #$0030
	STA.w $7046
	STZ.w $7A36
	REP.b #$10
	RTS

DATA_10ADB0:
	dw $0060,$0080,$00A0

DATA_10ADB6:
	dw $0068,$0088,$00A8

CODE_10ADBC:
	SEP.b #$10
	LDA.w $70E6
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7186
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w $110D
	AND.w #$00FF
	ASL
	TAX
	LDA.w DATA_10ADB0,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $110E
	AND.w #$00FF
	ASL
	TAX
	LDA.w DATA_10ADB6,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0600
	SEP.b #$10
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $7224
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w $7226
	REP.b #$10
	RTS

DATA_10AE06:
	dw $003C,$005C,$007C,$009C,$00BC,$002C,$004C,$00AC
	dw $00CC,$003C,$005C,$007C,$009C,$00BC

DATA_10AE22:
	dw $005C,$005C,$005C,$005C,$005C,$007C,$007C,$007C
	dw $007C,$009C,$009C,$009C,$009C,$009C

CODE_10AE3E:
	SEP.b #$10
	LDA.w $70E6
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7186
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w $1154
	AND.w #$00FF
	ASL
	TAX
	LDA.w DATA_10AE06,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w DATA_10AE22,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0600
	SEP.b #$10
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $7224
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w $7226
	REP.b #$10
	RTS

CODE_10AE80:
	REP.b #$20
	SEP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	BNE.b CODE_10AE8C
	JMP.w CODE_10AF37

CODE_10AE8C:
	CMP.w #$0002
	BEQ.b CODE_10AEDE
	CMP.w #$0003
	BNE.b CODE_10AE99
	JMP.w CODE_10AF18

CODE_10AE99:
	LDA.w $60BE
	CMP.w #$0034
	BNE.b CODE_10AEBE
	LDA.w #!Define_YI_SoundID4A_YoshiGrunt
	JSL.l CODE_push_sound_queue
	LDA.w !RAM_YI_Level_CurrentBonusGame
	CMP.w #!Define_YI_BonusID_MatchCards
	BEQ.b CODE_10AEB5
	JSR.w CODE_10ADBC
	BRA.b CODE_10AEB8

CODE_10AEB5:
	JSR.w CODE_10AE3E
CODE_10AEB8:
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	JMP.w CODE_10AF37

CODE_10AEBE:
	LDY.b #$02
	LDA.w $60F8
	SEC
	SBC.w DATA_10A2DD,y
	TAX
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_10AD53,x
	STA.w $70E6
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_10AD65,x
	STA.w $7186
	BRA.b CODE_10AF31

CODE_10AEDE:
	JSR.w CODE_10AFD4
	LDA.w !RAM_YI_Level_CurrentBonusGame
	CMP.w #!Define_YI_BonusID_MatchCards
	BEQ.b CODE_10AEEE
	JSR.w CODE_10AF3A
	BRA.b CODE_10AEF1

CODE_10AEEE:
	JSR.w CODE_10AF9C
CODE_10AEF1:
	CPY.b #$00
	BEQ.b CODE_10AF31
	LDA.w #$FF00
	STA.w $7224
	LDA.w #$FC00
	STA.w $7226
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	LDA.w $10DE
	CMP.w #$0011
	BEQ.b CODE_10AF31
	LDA.w #!Define_YI_SoundID67_EnemyTumbling
	JSL.l CODE_push_sound_queue
	INC.w $10DE
	BRA.b CODE_10AF31

CODE_10AF18:
	LDA.w $7186
	CMP.w #$00E0
	BCS.b CODE_10AF2C
	LDA.w $7226
	CLC
	ADC.w #$0040
	STA.w $7226
	BRA.b CODE_10AF31

CODE_10AF2C:
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	BRA.b CODE_10AF37

CODE_10AF31:
	LDX.b #$04
	JSL.l CODE_03B69D
CODE_10AF37:
	REP.b #$10
	RTS

CODE_10AF3A:
	SEP.b #$10
	LDY.b #$00
	LDA.w $110D
	AND.w #$00FF
	ASL
	TAX
	LDA.w $70E6
	CMP.w DATA_10ADB0,x
	BCC.b CODE_10AF5E
	LDA.w $110E
	AND.w #$00FF
	ASL
	TAX
	LDA.w $7186
	CMP.w DATA_10ADB6,x
	BCS.b CODE_10AF99
CODE_10AF5E:
	SEP.b #$20
	REP.b #$10
	LDA.w $110E
	ASL
	ORA.w $110E
	CLC
	ADC.w $110D
	CMP.b #$04
	BNE.b CODE_10AF91
	REP.b #$20
	JSR.w CODE_10B56F
	JSR.w CODE_10B4F1
	LDA.w #$0100
	STA.w $10F4
	JSR.w CODE_10B54F
	LDA.w #!Define_YI_SoundID08_1up
	JSL.l CODE_push_sound_queue
	LDA.w #$0011
	STA.w $10DE
	BRA.b CODE_10AF96

CODE_10AF91:
	REP.b #$20
	JSR.w CODE_10AB3F
CODE_10AF96:
	LDY.w #$0001
CODE_10AF99:
	SEP.b #$10
	RTS

CODE_10AF9C:
	SEP.b #$10
	LDY.b #$00
	LDA.w $1154
	AND.w #$00FF
	CMP.w #$0008
	BEQ.b CODE_10AFBF
	ASL
	TAX
	LDA.w $70E6
	CMP.w DATA_10AE06,x
	BCC.b CODE_10AFC9
	LDA.w $7186
	CMP.w DATA_10AE22,x
	BCS.b CODE_10AFD1
	BRA.b CODE_10AFC9

CODE_10AFBF:
	ASL
	TAX
	LDA.w $70E6
	CMP.w DATA_10AE06,x
	BCC.b CODE_10AFD1
CODE_10AFC9:
	REP.b #$10
	JSR.w CODE_10D588
	LDY.w #$0001
CODE_10AFD1:
	SEP.b #$10
	RTS

CODE_10AFD4:
	LDA.w $0030
	AND.w #$0001
	BNE.b CODE_10B00D
	LDA.w #!Define_YI_AmbSpr1DF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E6
	STA.w $70A2,y
	LDA.w $7186
	STA.w $7142,y
	LDA.w #$0005
	STA.w $7E4C,y
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w #$0006
	STA.w $7462,y
	LDA.w #$002C
	STA.w $7002,y
CODE_10B00D:
	RTS

CODE_10B00E:
	DEC.w $10E0
	BPL.b CODE_10B045
	SEP.b #$30
	LDA.b #$06
	STA.b !RAM_YI_Global_PlayMusicLo
	LDX.b #$00
CODE_10B01B:
	LDA.w $1104,x
	CMP.b #$FF
	BNE.b CODE_10B025
	INX
	BRA.b CODE_10B01B

CODE_10B025:
	STA.w $10F3
	CPX.b #$04
	BMI.b CODE_10B02D
	INX
CODE_10B02D:
	STX.w $10F2
	INC.w $1148
	INC.w $10DE
	REP.b #$30
	LDA.w #$0100
	STA.w $10F4
	LDA.w #!Define_YI_SoundID51_ThunderLakituAttacking1
	JSL.l CODE_push_sound_queue
CODE_10B045:
	RTS

CODE_10B046:
	JSR.w CODE_10B050
	JSR.w CODE_10B1CD
	JSR.w CODE_10B2DE
CODE_10B04F:
	RTS

CODE_10B050:
	LDA.w $1184
	ASL
	TAX
	JMP.w (DATA_10B058,x)

DATA_10B058:
	dw CODE_10B062
	dw CODE_10B083
	dw CODE_10B0F3
	dw CODE_10B123
	dw CODE_10B04F

CODE_10B062:
	JSR.w CODE_10B0B4
	LDA.w $10F4
	CMP.w #$0150
	BNE.b CODE_10B079
	LDA.w #!Define_YI_SoundID53_ThunderLakituAttacking3
	JSL.l CODE_push_sound_queue
	INC.w $1184
	BRA.b CODE_10B080

CODE_10B079:
	CLC
	ADC.w #$0004
	STA.w $10F4
CODE_10B080:
	JMP.w CODE_10B0D3

CODE_10B083:
	LDA.w $10F4
	CMP.w #$0120
	BNE.b CODE_10B09A
	INC.w $1186
	INC.w $1188
	LDA.w #!Define_YI_SoundID04_SpitOut
	JSL.l CODE_push_sound_queue
	BRA.b CODE_10B0A4

CODE_10B09A:
	CMP.w #$0100
	BNE.b CODE_10B0A4
	INC.w $1184
	BRA.b CODE_10B0B1

CODE_10B0A4:
	JSR.w CODE_10B0B4
	LDA.w $10F4
	SEC
	SBC.w #$0004
	STA.w $10F4
CODE_10B0B1:
	JMP.w CODE_10B0D3

CODE_10B0B4:
	LDA.w $10F2
	AND.w #$00FF
	TAX
	CLC
	ADC.w #DATA_10AB2A
	STA.b $00
	TXA
	CLC
	ADC.w #DATA_10AB18
	STA.b $02
	TXA
	CLC
	ADC.w #DATA_10AB21
	STA.b $04
	JSR.w CODE_10ACB7
	RTS

CODE_10B0D3:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0011
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$006C
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	SEP.b #$10
	LDX.b #FXCODE_08DBDE>>16
	LDA.w #FXCODE_08DBDE
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	JSR.w CODE_10AD19
	RTS

CODE_10B0F3:
	LDA.w $70E6
	CMP.w $118C
	BCS.b CODE_10B122
	SEP.b #$20
	LDA.b #$04
	STA.w $10F3
	LDA.b #$0A
	STA.w $1102
	REP.b #$20
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	LDA.w #$0040
	STA.w $118E
	STZ.w $1190
	JSR.w CODE_10AB3F
	LDA.w #!Define_YI_SoundID51_ThunderLakituAttacking1
	JSL.l CODE_push_sound_queue
	INC.w $1184
CODE_10B122:
	RTS

CODE_10B123:
	LDA.w $1190
	AND.w #$0001
	BNE.b CODE_10B148
	LDA.w $10F4
	CLC
	ADC.w $118E
	CMP.w #$0080
	BCC.b CODE_10B1AE
	SEC
	SBC.w #$0080
	STA.b $00
	LDA.w #$0080
	SEC
	SBC.b $00
	STA.w $10F4
	BRA.b CODE_10B18B

CODE_10B148:
	LDA.w $10F4
	SEC
	SBC.w $118E
	BPL.b CODE_10B1AE
	STA.b $00
	LDA.w $1190
	AND.w #$0003
	CMP.w #$0001
	BNE.b CODE_10B182
	LDX.w $118E
	CPX.w #$0004
	BNE.b CODE_10B182
	STZ.w $1148
	LDA.w $10F9
	CLC
	ADC.w #$000A
	STA.w $10F9
	LDA.w #$000D
	STA.w $10DE
	LDA.w #$0090
	STA.w $10E0
	JMP.w CODE_10ABDF

CODE_10B182:
	LDA.b $00
	EOR.w #$FFFF
	INC
	STA.w $10F4
CODE_10B18B:
	LDA.w $118E
	CMP.w #$0004
	BEQ.b CODE_10B19A
	SEC
	SBC.w #$0002
	STA.w $118E
CODE_10B19A:
	INC.w $1190
	LDA.w $1190
	AND.w #$0001
	BNE.b CODE_10B1B1
	LDA.w #!Define_YI_SoundID07_GoonieLoseWings
	JSL.l CODE_push_sound_queue
	BRA.b CODE_10B1B1

CODE_10B1AE:
	STA.w $10F4
CODE_10B1B1:
	LDA.w $10F4
	CMP.w #$007C
	BCC.b CODE_10B1BA
	RTS

CODE_10B1BA:
	LDA.w $1190
	AND.w #$0003
	ASL
	TAX
	JMP.w (DATA_10B1C5,x)

DATA_10B1C5:
	dw CODE_10ABA6
	dw CODE_10AC67
	dw CODE_10AC67
	dw CODE_10ABA6

CODE_10B1CD:
	LDA.w $1186
	BEQ.b CODE_10B1DD
	CMP.w #$0018
	BCS.b CODE_10B1DD
	JSR.w CODE_10B211
	INC.w $1186
CODE_10B1DD:
	RTS

DATA_10B1DE:
	dw $2CE1,$2CE2,$2CF0,$2CF1,$2CF2

DATA_10B1E8:
	db $04,$04,$04,$01,$01,$01,$01,$01,$01,$02,$02,$02,$02,$03,$03,$03
	db $03,$03,$00,$00,$00,$00,$00

DATA_10B1FF:
	db $61,$81,$A1,$61,$81,$A1,$61,$81,$A1

DATA_10B208:
	db $69,$69,$69,$89,$89,$89,$A9,$A9,$A9

CODE_10B211:
	LDA.w $1186
	DEC
	AND.w #$FFFC
	LSR
	LSR
	CLC
	ADC.w #$0011
	STA.b $0E
	LDA.w $10F2
	AND.w #$00FF
	TAX
	LDA.w DATA_10B1FF,x
	AND.w #$00FF
	STA.b $04
	TAY
	SEC
	SBC.b $0E
	STA.b $00
	TYA
	CLC
	ADC.b $0E
	STA.b $02
	LDA.w DATA_10B208,x
	AND.w #$00FF
	STA.b $0A
	TAY
	SEC
	SBC.b $0E
	STA.b $06
	TYA
	CLC
	ADC.b $0E
	STA.b $08
	JSR.w CODE_10B253
	RTS

CODE_10B253:
	LDY.w $6092
	LDA.b $00
	STA.w $6000,y
	STA.w $6018,y
	STA.w $6028,y
	LDA.b $02
	STA.w $6010,y
	STA.w $6020,y
	STA.w $6038,y
	LDA.b $04
	STA.w $6008,y
	STA.w $6030,y
	LDA.b $06
	STA.w $6002,y
	STA.w $600A,y
	STA.w $6012,y
	LDA.b $08
	STA.w $602A,y
	STA.w $6032,y
	STA.w $603A,y
	LDA.b $0A
	STA.w $601A,y
	STA.w $6022,y
	LDA.w $1186
	DEC
	TAX
	LDA.w DATA_10B1E8,x
	AND.w #$00FF
	ASL
	TAX
	LDA.w DATA_10B1DE,x
	STA.w $6004,y
	STA.w $600C,y
	STA.w $6014,y
	STA.w $601C,y
	STA.w $6024,y
	STA.w $602C,y
	STA.w $6034,y
	STA.w $603C,y
	LDA.w #$0000
	STA.w $6006,y
	STA.w $600E,y
	STA.w $6016,y
	STA.w $601E,y
	STA.w $6026,y
	STA.w $602E,y
	STA.w $6036,y
	STA.w $603E,y
	TYA
	CLC
	ADC.w #$0040
	STA.w $6092
	RTS

CODE_10B2DE:
	LDA.w $1188
	ASL
	TAX
	JMP.w (DATA_10B2E6,x)

DATA_10B2E6:
	dw CODE_10B04F
	dw CODE_10B316
	dw CODE_10B356
	dw CODE_10B44F
	dw CODE_10B47A
	dw CODE_10B04F

DATA_10B2F2:
	dw $6000,$8000,$A000,$6000,$8000,$A000,$6000,$8000
	dw $A000

DATA_10B304:
	dw $5800,$5800,$5800,$7800,$7800,$7800,$9800,$9800
	dw $9800

CODE_10B316:
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A6
	REP.b #$20
	STZ.w $6F04
	LDA.w $10F2
	AND.w #$00FF
	ASL
	TAX
	LDA.w DATA_10B2F2,x
	STA.w $70E6
	SEC
	SBC.w #$2000
	STA.w $118C
	LDA.w DATA_10B304,x
	STA.w $7186
	LDA.w #$0500
	STA.w $7224
	LDA.w #$FD00
	STA.w $7226
	LDA.w #$0020
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	JSR.w CODE_10B3D6
	INC.w $1188
	RTS

CODE_10B356:
	JSR.w CODE_10B398
	JSR.w CODE_10B3B2
	LDA.w $7224
	BPL.b CODE_10B372
	LDA.w #$0020
	STA.w $7224
	LDA.w #$0040
	STA.w $7226
	INC.w $1188
	BRA.b CODE_10B378

CODE_10B372:
	JSR.w CODE_10B37C
	JSR.w CODE_10B387
CODE_10B378:
	JSR.w CODE_10B3D6
	RTS

CODE_10B37C:
	LDA.w $70E6
	CLC
	ADC.w $7224
	STA.w $70E6
	RTS

CODE_10B387:
	LDA.w $7186
	CLC
	ADC.w $7226
	STA.w $7186
	RTS

DATA_10B392:
	dw $FFC0,$0000,$FFE0

CODE_10B398:
	LDA.w $1188
	SEC
	SBC.w #$0002
	ASL
	TAX
	LDA.w DATA_10B392,x
	CLC
	ADC.w $7224
	STA.w $7224
	RTS

DATA_10B3AC:
	dw $0010,$0006,$FFF0

CODE_10B3B2:
	LDA.w $1188
	SEC
	SBC.w #$0002
	ASL
	TAX
	LDA.w DATA_10B3AC,x
	CLC
	ADC.w $7226
	STA.w $7226
	RTS

DATA_10B3C6:
	dw $3709,$370B,$3729,$372B,$3749,$374B,$3769,$376B

CODE_10B3D6:
	LDY.w $6092
	LDA.w $70E6
	AND.w #$FF00
	CMP.w #$E000
	BCC.b CODE_10B3E7
	ORA.w #$00FF
CODE_10B3E7:
	XBA
	STA.w $6000,y
	STA.w $6010,y
	CLC
	ADC.w #$0010
	STA.w $6008,y
	STA.w $6018,y
	LDA.w $7186
	AND.w #$FF00
	XBA
	STA.w $6002,y
	STA.w $600A,y
	CLC
	ADC.w #$0010
	STA.w $6012,y
	STA.w $601A,y
	LDA.w $1188
	CMP.w #$0004
	BEQ.b CODE_10B41C
	LDX.w #$0000
	BRA.b CODE_10B41F

CODE_10B41C:
	LDX.w #$0008
CODE_10B41F:
	LDA.w DATA_10B3C6,x
	STA.w $6004,y
	LDA.w DATA_10B3C6+$02,x
	STA.w $600C,y
	LDA.w DATA_10B3C6+$04,x
	STA.w $6014,y
	LDA.w DATA_10B3C6+$06,x
	STA.w $601C,y
	LDA.w #$0002
	STA.w $6006,y
	STA.w $600E,y
	STA.w $6016,y
	STA.w $601E,y
	TYA
	CLC
	ADC.w #$0020
	STA.w $6092
	RTS

CODE_10B44F:
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	BPL.b CODE_10B46A
	LDA.w #$FFF0
	STA.w $7224
	LDA.w #$0200
	STA.w $7226
	LDA.w #!Define_YI_SoundID19_SelectWorld
	JSL.l CODE_push_sound_queue
	INC.w $1188
CODE_10B46A:
	JSR.w CODE_10B398
	JSR.w CODE_10B3B2
	JSR.w CODE_10B37C
	JSR.w CODE_10B387
	JSR.w CODE_10B3D6
	RTS

CODE_10B47A:
	LDA.w $70E6
	BPL.b CODE_10B48E
	CMP.w #$E000
	BCC.b CODE_10B48E
	CMP.w #$F000
	BCS.b CODE_10B48E
	INC.w $1188
	BRA.b CODE_10B49D

CODE_10B48E:
	JSR.w CODE_10B398
	JSR.w CODE_10B3B2
	JSR.w CODE_10B37C
	JSR.w CODE_10B387
	JSR.w CODE_10B3D6
CODE_10B49D:
	RTS

CODE_10B49E:
	JSR.w CODE_10AE80
	JSR.w CODE_10B4F1
	LDA.w $10F4
	CMP.w #$00C0
	BNE.b CODE_10B4B1
	INC.w $10DE
	BRA.b CODE_10B4B8

CODE_10B4B1:
	SEC
	SBC.w #$0020
	STA.w $10F4
CODE_10B4B8:
	JMP.w CODE_10B54F

CODE_10B4BB:
	JSR.w CODE_10AE80
	LDA.w $10F4
	CMP.w #$0100
	BNE.b CODE_10B4E1
	JSR.w CODE_10B5A4
	LDA.w #$0029
	STA.l $704070
	INC.w !RAM_YI_Level_MessageBoxState 
	LDA.w #$000C
	STA.w $10DE
	LDA.w #$0001
	STA.w $10E0
	BRA.b CODE_10B4EE

CODE_10B4E1:
	JSR.w CODE_10B4F1
	LDA.w $10F4
	CLC
	ADC.w #$0010
	STA.w $10F4
CODE_10B4EE:
	JMP.w CODE_10B54F

CODE_10B4F1:
	PHY
	LDY.w $6092
	LDA.w DATA_10AB1C
	AND.w #$00FF
	STA.w $6000,y
	STA.w $6010,y
	CLC
	ADC.w #$0010
	STA.w $6008,y
	STA.w $6018,y
	LDA.w DATA_10AB25
	AND.w #$00FF
	STA.w $6002,y
	STA.w $600A,y
	CLC
	ADC.w #$0010
	STA.w $6012,y
	STA.w $601A,y
	LDA.w #$39E8
	STA.w $6004,y
	INC
	INC
	STA.w $600C,y
	INC
	INC
	STA.w $6014,y
	INC
	INC
	STA.w $601C,y
	LDA.w #$0002
	STA.w $6006,y
	STA.w $600E,y
	STA.w $6016,y
	STA.w $601E,y
	TYA
	CLC
	ADC.w #$0020
	STA.w $6092
	PLY
	RTS

CODE_10B54F:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0015
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0081
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	SEP.b #$10
	LDX.b #FXCODE_08DBDE>>16
	LDA.w #FXCODE_08DBDE
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	JSR.w CODE_10AD19
	RTS

CODE_10B56F:
	LDA.w #$0003
	STA.b $0E
	LDY.w DATA_10AB08
CODE_10B577:
	LDA.w #DATA_10AB12>>16
	STA.b $01
	LDX.w #DATA_10AB12
	LDA.w #$0006
	PHY
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0020
	TAY
	DEC.b $0E
	BNE.b CODE_10B577
	RTS

DATA_10B592:
	dw $19D1,$19D2,$19D3,$19D4,$19D5,$19D6,$19D7,$19D8
	dw $19D9

CODE_10B5A4:
	LDA.w #$0003
	STA.b $0E
	LDY.w DATA_10AB08
	LDX.w #DATA_10B592
CODE_10B5AF:
	LDA.w #DATA_10B592>>16
	STA.b $01
	LDA.w #$0006
	PHX
	PHY
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0020
	TAY
	PLA
	CLC
	ADC.w #$0006
	TAX
	DEC.b $0E
	BNE.b CODE_10B5AF
	RTS

CODE_10B5CE:
	LDA.w $10DE
	ASL
	TAX
	JMP.w (DATA_10B5D6,x)

DATA_10B5D6:
	dw CODE_10A41C
	dw CODE_10A427
	dw CODE_10A444
	dw CODE_10A466
	dw CODE_10A481
	dw CODE_10A4EC
	dw CODE_10A549
	dw CODE_10A5B3
	dw CODE_10B7F1
	dw CODE_10B8B9
	dw CODE_10B97F
	dw CODE_10BC8C
	dw CODE_10B9F8
	dw CODE_10A621

DATA_10B5F2:
	dw $3987,$398B,$3A05,$3A09,$3A0D,$3A87,$3A8B

DATA_10B600:
	dw $0A23,$0A24,$0A25,$0A33,$0A34,$0A35,$0A43,$0A44
	dw $0A45

DATA_10B612:
	dw $0A20,$0A21,$0A22,$0A30,$0A31,$0A32,$0A40,$0A41
	dw $0A42

DATA_10B624:
	dl DATA_10B600
	dl DATA_10B612

DATA_10B62A:
	db $03,$00,$00,$03,$00,$00,$03

DATA_10B631:
	db $38,$58,$28,$48,$68,$38,$58

DATA_10B638:
	db $60,$60,$80,$80,$80,$A0,$A0

DATA_10B63F:
	db $00,$01,$FF,$00

DATA_10B643:
	db $05,$05,$FE,$FE,$FD,$FD,$FD

DATA_10B64A:
	db $02,$02,$03,$03,$02,$FB,$FB

DATA_10B651:
	dw $0000,$0090,$0120,$01B0,$0240,$02D0,$0360

DATA_10B65F:
	db $00,$00,$00,$17,$01,$00,$01,$17,$03,$00,$03,$17,$05,$00,$05,$17
	db $07,$00,$07,$17,$09,$00,$09,$17,$0B,$00,$0B,$17,$0D,$00,$0D,$17
	db $0F,$00,$0F,$17,$11,$00,$11,$17,$13,$00,$13,$17,$15,$00,$15,$17
	db $17,$00,$17,$17,$FF

DATA_10B694:
	db $01,$00,$00,$01,$03,$00,$00,$03,$05,$00,$00,$05,$07,$00,$00,$07
	db $09,$00,$00,$09,$0B,$00,$00,$0B,$0D,$00,$00,$0D,$0F,$00,$00,$0F
	db $11,$00,$00,$11,$13,$00,$00,$13,$15,$00,$00,$15,$17,$00,$00,$17
	db $16,$17,$17,$16,$14,$17,$17,$14,$12,$17,$17,$12,$10,$17,$17,$10
	db $0E,$17,$17,$0E,$0C,$17,$17,$0C,$0A,$17,$17,$0A,$08,$17,$17,$08
	db $06,$17,$17,$06,$04,$17,$17,$04,$02,$17,$17,$02,$00,$17,$17,$00
	db $FF

DATA_10B6F5:
	db $00,$00,$17,$17,$17,$00,$00,$17,$01,$00,$02,$17,$03,$00,$04,$17
	db $05,$00,$06,$17,$07,$00,$08,$17,$09,$00,$0A,$17,$0B,$00,$0C,$17
	db $0D,$00,$0E,$17,$0F,$00,$10,$17,$11,$00,$12,$17,$13,$00,$14,$17
	db $15,$00,$16,$17,$17,$00,$17,$17,$FF

DATA_10B72E:
	db $00,$17,$17,$17,$00,$15,$17,$15,$00,$13,$17,$13,$00,$11,$17,$11
	db $00,$0F,$17,$0F,$00,$0D,$17,$0D,$00,$0B,$17,$0B,$00,$09,$17,$09
	db $00,$07,$17,$07,$00,$05,$17,$05,$00,$03,$17,$03,$00,$01,$17,$01
	db $00,$00,$17,$00,$FF

DATA_10B763:
	dw DATA_10B65F,DATA_10B694,DATA_10B6F5,DATA_10B72E

CODE_10B76B:
	SEP.b #$30
	LDA.b #$00
	STA.w $1114
	TAY
	LDA.w DATA_10B631,y
	STA.w $10F6
	LDA.w DATA_10B638,y
	STA.w $10F7
	LDX.b #$06
	TXY
CODE_10B782:
	LDA.w DATA_10B62A,x
	STA.b $00,x
	DEX
	BPL.b CODE_10B782
	LDA.b #$15
	STA.b $2D
	LDA.b #$11
	STA.b $2E
	JSR.w CODE_random_list_generator
	STZ.w $111D
	STZ.w $111C
	LDY.b #$06
	LDA.b #$00
CODE_10B79F:
	STA.w $111E,y
	DEY
	BPL.b CODE_10B79F
	REP.b #$30
	LDY.w #$0006
CODE_10B7AA:
	PHY
	LDA.w $1115,y
	AND.w #$00FF
	TAX
	LDA.w DATA_10B624+$02,x
	AND.w #$00FF
	STA.b $01
	LDA.w DATA_10B624,x
	TAX
	TYA
	ASL
	TAY
	LDA.w DATA_10B5F2,y
	TAY
	LDA.w #$0003
	STA.b $1E
CODE_10B7CA:
	PHY
	PHX
	LDA.w #$0006
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0006
	TAX
	PLA
	CLC
	ADC.w #$0020
	TAY
	DEC.b $1E
	BNE.b CODE_10B7CA
	PLY
	DEY
	BPL.b CODE_10B7AA
	LDA.w #$0080
	STA.w $1110
	STA.w $1112
	RTS

CODE_10B7F1:
	JSL.l CODE_random_number_gen
	SEP.b #$20
	LDA.w $110F
	BEQ.b CODE_10B7FF
	DEC.w $110F
CODE_10B7FF:
	REP.b #$20
	LDA.w $10F6
	AND.w #$00FF
	CLC
	ADC.w #$0014
	STA.b $00
	LDA.w $10F7
	AND.w #$00FF
	CLC
	ADC.w #$0014
	STA.b $02
	LDA.w #$3564
	STA.b $04
	JSR.w CODE_10BBF9
	LDA.w $093E
	AND.w #$C080
	BNE.b CODE_10B82C
	JMP.w CODE_10B8B5

CODE_10B82C:
	LDA.w $1114
	AND.w #$00FF
	TAX
	LDA.w $111E,x
	AND.w #$00FF
	BEQ.b CODE_10B844
	LDA.w #!Define_YI_SoundID2A_ClankSound3
	JSL.l CODE_push_sound_queue
	BRA.b CODE_10B8B5

CODE_10B844:
	LDA.w #!Define_YI_SoundID09_Coin
	JSL.l CODE_push_sound_queue
	LDY.w #$000A
	STY.w $10F0
	LDA.w DATA_10A2DD,y
	JSR.w CODE_10A39A
	SEP.b #$30
	LDA.b #$18
	STA.w $110F
	INC.w $111E,x
	INC.w $10DE
	JSL.l CODE_random_number_gen
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	STA.w !REGISTER_Multiplicand
	LDA.b #$04
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL
	TAX
	REP.b #$20
	LDY.b #$00
	LDA.w DATA_10B763,x
	STA.b $A3
	LDA.b ($A3),y
	INY
	AND.w #$00FF
	XBA
	STA.w $1110
	LDA.b ($A3),y
	INY
	STY.w $111C
	AND.w #$00FF
	XBA
	STA.w $1112
	LDA.w #(FXDATA_538000+$04E4)>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #FXDATA_538000+$04E4
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_08DF7E>>16
	LDA.w #FXCODE_08DF7E
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	BRA.b CODE_10B8B8

CODE_10B8B5:
	JSR.w CODE_10BB07
CODE_10B8B8:
	RTS

CODE_10B8B9:
	SEP.b #$20
	LDA.w $110F
	BNE.b CODE_10B8CD
	LDA.b #$20
	STA.w $110F
	LDA.b #!Define_YI_SoundID32_HitMessageBox
	JSL.l CODE_push_sound_queue
	BRA.b CODE_10B8D0

CODE_10B8CD:
	DEC.w $110F
CODE_10B8D0:
	LDA.w $10F6
	CLC
	ADC.w $1111
	STA.b $00
	LDA.w $10F7
	CLC
	ADC.w $1113
	STA.b $02
	STZ.b $01
	STZ.b $03
	REP.b #$20
	LDA.w #$3564
	STA.b $04
	JSR.w CODE_10BBF9
	SEP.b #$10
	LDA.w $1111
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $1113
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_08DFA2>>16
	LDA.w #FXCODE_08DFA2
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDA.w #$705800>>16
	STA.b $01
	LDA.w $1114
	AND.w #$00FF
	ASL
	TAX
	LDY.w DATA_10B651,x
	LDX.w #$705800
	LDA.w #$0003
	STA.b $0E
CODE_10B927:
	LDA.w #$0060
	PHX
	PHY
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0030
	TAY
	PLA
	CLC
	ADC.w #$0200
	TAX
	DEC.b $0E
	BNE.b CODE_10B927
	SEP.b #$30
	LDY.w $111C
	LDA.b ($A3),y
	BPL.b CODE_10B979
	LDA.b #!Define_YI_SoundID90_Incorrect
	LDX.w $1114
	LDY.w $1115,x
	BEQ.b CODE_10B955
	LDA.b #!Define_YI_SoundID8F_Correct
CODE_10B955:
	JSL.l CODE_push_sound_queue
	INC.w $111D
	LDA.w $111D
	CMP.b #$03
	BNE.b CODE_10B968
	INC.w $10DE
	BRA.b CODE_10B97C

CODE_10B968:
	DEC.w $10DE
	REP.b #$30
	LDY.w #$0000
	STY.w $10F0
	LDA.w DATA_10A2DD,y
	JMP.w CODE_10A39A

CODE_10B979:
	JSR.w CODE_10BB72
CODE_10B97C:
	REP.b #$30
	RTS

CODE_10B97F:
	SEP.b #$30
	STZ.w $1125
	LDY.b #$06
CODE_10B986:
	LDA.w $111E,y
	BEQ.b CODE_10B993
	LDA.w $1115,y
	BEQ.b CODE_10B993
	INC.w $1125
CODE_10B993:
	DEY
	BPL.b CODE_10B986
	LDY.w $1125
	LDA.w DATA_10B9E0,y
	STA.w $1148
	STZ.w $1149
	LDA.w DATA_10B9F0,y
	STA.w $10E0
	LDA.w DATA_10B9F4,y
	STA.w $10E1
	STZ.b $A3
	STZ.b $A4
	STZ.b $A5
	STZ.b $A6
	LDA.w DATA_10B9E4,y
	CPY.b #$00
	BNE.b CODE_10B9C5
	PHY
	JSL.l CODE_push_sound_queue
	PLY
	BRA.b CODE_10B9C8

CODE_10B9C5:
	STA.w !RAM_YI_Global_PlayMusicLo
CODE_10B9C8:
	INC.w $10DE
	REP.b #$30
	TYA
	ASL
	TAY
	LDA.w DATA_10B9E8,y
	STA.w $10F0
	TAY
	LDA.w DATA_10A2DD,y
	JMP.w CODE_10A39A

CODE_10B9DD:
	REP.b #$30
	RTS

DATA_10B9E0:
	db $00,$01,$02,$05

DATA_10B9E4:
	db !Define_YI_SoundID7D_YoshiLostChallenge,!Define_YI_SoundID05_Powerup,!Define_YI_SoundID05_Powerup,!Define_YI_SoundID05_Powerup

DATA_10B9E8:
	dw $0006,$0004,$0004,$0004

DATA_10B9F0:
	db $78,$78,$78,$78

DATA_10B9F4:
	db $00,$00,$00,$00

CODE_10B9F8:
	LDA.w $10E0
	BEQ.b CODE_10BA02
	DEC.w $10E0
	BRA.b CODE_10BA7E

CODE_10BA02:
	LDA.w $1148
	BNE.b CODE_10BA12
CODE_10BA07:
	LDA.w #$0080
	STA.w $10E0
	INC.w $10DE
	BRA.b CODE_10BA7E

CODE_10BA12:
	LDY.w !RAM_YI_Level_CurrentLifeCountLo
	CPY.w #$03E7
	BEQ.b CODE_10BA07
	PHA
	LDA.w #!Define_YI_SoundID08_1up
	JSL.l CODE_push_sound_queue
	PLA
	LDY.w #$0030
	STY.w $10E0
	CMP.w #$006F
	BCS.b CODE_10BA5F
	CMP.w #$000B
	BCS.b CODE_10BA3E
	INC.w !RAM_YI_Level_CurrentLifeCountLo
	JSR.w CODE_109D74
	DEC.w $1148
	BRA.b CODE_10BA7E

CODE_10BA3E:
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
	CLC
	ADC.w #$000A
	CMP.w #$03E8
	BCC.b CODE_10BA4D
	LDA.w #$03E7
CODE_10BA4D:
	STA.w !RAM_YI_Level_CurrentLifeCountLo
	JSR.w CODE_109D74
	LDA.w $1148
	SEC
	SBC.w #$000A
	STA.w $1148
	BRA.b CODE_10BA7E

CODE_10BA5F:
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
	CLC
	ADC.w #$0064
	CMP.w #$03E8
	BCC.b CODE_10BA6E
	LDA.w #$03E7
CODE_10BA6E:
	STA.w !RAM_YI_Level_CurrentLifeCountLo
	JSR.w CODE_109D74
	LDA.w $1148
	SEC
	SBC.w #$0064
	STA.w $1148
CODE_10BA7E:
	RTS

CODE_10BA7F:
	LDA.w $10E0
	BEQ.b CODE_10BA8A
	DEC.w $10E0
	JMP.w CODE_10BB06

CODE_10BA8A:
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
	BEQ.b CODE_10BA94
	LDA.w $1148
	BNE.b CODE_10BA9F
CODE_10BA94:
	LDA.w #$0080
	STA.w $10E0
	INC.w $10DE
	BRA.b CODE_10BB06

CODE_10BA9F:
	LDY.w #$0030
	STY.w $10E0
	CMP.w #$006F
	BCS.b CODE_10BAE7
	CMP.w #$000B
	BCS.b CODE_10BAC6
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
	DEC
	CMP.w #$0001
	BPL.b CODE_10BABB
	LDA.w #$0001
CODE_10BABB:
	STA.w !RAM_YI_Level_CurrentLifeCountLo
	JSR.w CODE_109D74
	DEC.w $1148
	BRA.b CODE_10BB06

CODE_10BAC6:
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
	SEC
	SBC.w #$000A
	CMP.w #$0001
	BPL.b CODE_10BAD5
	LDA.w #$0001
CODE_10BAD5:
	STA.w !RAM_YI_Level_CurrentLifeCountLo
	JSR.w CODE_109D74
	LDA.w $1148
	SEC
	SBC.w #$000A
	STA.w $1148
	BRA.b CODE_10BB06

CODE_10BAE7:
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
	SEC
	SBC.w #$0064
	CMP.w #$0001
	BPL.b CODE_10BAF6
	LDA.w #$0001
CODE_10BAF6:
	STA.w !RAM_YI_Level_CurrentLifeCountLo
	JSR.w CODE_109D74
	LDA.w $1148
	SEC
	SBC.w #$0064
	STA.w $1148
CODE_10BB06:
	RTS

CODE_10BB07:
	SEP.b #$30
	LDA.w $093F
	AND.b #$0F
	BEQ.b CODE_10BB14
	LDY.b #$20
	BRA.b CODE_10BB1B

CODE_10BB14:
	LDY.w $110F
	BNE.b CODE_10BB6F
	LDY.b #$10
CODE_10BB1B:
	STY.w $110F
	LDA.w $093D
	AND.b #$0F
	BNE.b CODE_10BB27
	BRA.b CODE_10BB6F

CODE_10BB27:
	PHA
	AND.b #$03
	TAY
	LDA.w $1114
	CLC
	ADC.w DATA_10B63F,y
	BPL.b CODE_10BB38
	LDA.b #$06
	BRA.b CODE_10BB3E

CODE_10BB38:
	CMP.b #$07
	BCC.b CODE_10BB3E
	LDA.b #$00
CODE_10BB3E:
	STA.w $1114
	TAY
	PLA
	LSR
	LSR
	BIT.b #$01
	BEQ.b CODE_10BB50
	TYA
	CLC
	ADC.w DATA_10B64A,y
	BRA.b CODE_10BB59

CODE_10BB50:
	BIT.b #$02
	BEQ.b CODE_10BB5D
	TYA
	CLC
	ADC.w DATA_10B643,y
CODE_10BB59:
	STA.w $1114
	TAY
CODE_10BB5D:
	LDA.w DATA_10B631,y
	STA.w $10F6
	LDA.w DATA_10B638,y
	STA.w $10F7
	LDA.b #!Define_YI_SoundID5C_ScrollTextbox
	JSL.l CODE_push_sound_queue
CODE_10BB6F:
	REP.b #$30
	RTS

CODE_10BB72:
	REP.b #$20
	LDA.b ($A3),y
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	INY
	LDA.b ($A3),y
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $1111
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $1113
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0200
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $1110
	CLC
	ADC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $1110
	LDA.w $1112
	CLC
	ADC.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w $1112
	LDY.w $111C
	LDA.b ($A3),y
	AND.w #$00FF
	XBA
	SEC
	SBC.w $1110
	BEQ.b CODE_10BBD7
	EOR.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BPL.b CODE_10BBF6
	LDA.b ($A3),y
	AND.w #$00FF
	XBA
	STA.w $1110
CODE_10BBD7:
	INY
	LDA.b ($A3),y
	AND.w #$00FF
	XBA
	SEC
	SBC.w $1112
	BEQ.b CODE_10BBF2
	EOR.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	BPL.b CODE_10BBF6
	LDA.b ($A3),y
	AND.w #$00FF
	XBA
	STA.w $1112
CODE_10BBF2:
	INY
	STY.w $111C
CODE_10BBF6:
	SEP.b #$20
	RTS

CODE_10BBF9:
	LDY.w $6092
	LDA.b $00
	SEC
	SBC.w #$0007
	STA.w $6000,y
	LDA.b $02
	STA.w $6002,y
	LDA.b $04
	STA.w $6004,y
	LDA.w #$0002
	STA.w $6006,y
	TYA
	CLC
	ADC.w #$0008
	STA.w $6092
	RTS

DATA_10BC1E:
	dw $0CFC,$0CFC,$0CFC,$0CFC,$0CFC,$0CFC,$0CFC

DATA_10BC2C:
	dw $0A50,$0A51,$0CFC,$0A62,$0CCB,$0EE0,$0EE1,$0A60
	dw $0A61,$0A52,$0A64,$0CDB,$0EF0,$0EF1

DATA_10BC48:
	dw $0A50,$0A51,$0CFC,$0A62,$0CC8,$0EE0,$0EE1,$0A60
	dw $0A61,$0A52,$0A63,$0CD8,$0EF0,$0EF1

DATA_10BC64:
	dw $0A50,$0A51,$0CFC,$0A53,$0CC7,$0EE0,$0EE1,$0A60
	dw $0A61,$0A52,$0A54,$0CD7,$0EF0,$0EF1

DATA_10BC80:
	dw DATA_10BC64,DATA_10BC48,DATA_10BC2C

DATA_10BC86:
	dw $3A92,$3A32,$39D2

CODE_10BC8C:
	LDA.w $1125
	AND.w #$00FF
	BNE.b CODE_10BCA8
	LDA.w $10E0
	BEQ.b CODE_10BC9D
	DEC.w $10E0
	RTS

CODE_10BC9D:
	LDA.w #$0080
	STA.w $10E0
	INC.w $10DE
	BRA.b CODE_10BCB9

CODE_10BCA8:
	DEC
	ASL
	TAY
	LDA.w $10E0
	BNE.b CODE_10BCBD
	LDA.w #$0020
	STA.w $10E0
	JSR.w CODE_10BCDD
CODE_10BCB9:
	INC.w $10DE
	RTS

CODE_10BCBD:
	DEC.w $10E0
	LDA.b $A3
	BEQ.b CODE_10BCC8
	DEC.b $A3
	BRA.b CODE_10BCD8

CODE_10BCC8:
	LDA.b $A5
	EOR.w #$0002
	STA.b $A5
	TAX
	JSR.w (DATA_10BCD9,x)
	LDA.w #$0005
	STA.b $A3
CODE_10BCD8:
	RTS

DATA_10BCD9:
	dw CODE_10BD06
	dw CODE_10BCDD

CODE_10BCDD:
	LDA.w #DATA_10BC2C>>16
	STA.b $01
	LDX.w DATA_10BC80,y
	LDA.w DATA_10BC86,y
	TAY
	LDA.w #$000E
	PHX
	PHY
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0020
	TAY
	PLA
	CLC
	ADC.w #$000E
	TAX
	LDA.w #$000E
	JSL.l CODE_vram_dma_queue_add_180_2118
	RTS

CODE_10BD06:
	LDA.w #DATA_10BC1E>>16
	STA.b $01
	LDX.w #DATA_10BC1E
	LDA.w DATA_10BC86,y
	TAY
	LDA.w #$000E
	PHX
	PHY
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0020
	TAY
	PLX
	LDA.w #$000E
	JSL.l CODE_vram_dma_queue_add_180_2118
	RTS

;-------------------------------------------------------------------------
; CODE_random_list_generator -- RandomListGenerator (raid: CODE_random_list_generator).
; Builds a non-repeating randomized permutation of N items.
;   In:  $7E:0000 = item count
;        $7E:002D = destination pointer (where the shuffled list is written)
; Used by the bonus-game card-shuffle and prize-allocation routines.
;-------------------------------------------------------------------------
CODE_random_list_generator:
CODE_10BD2A:
	PHP
	SEP.b #$30
CODE_10BD2D:
	JSL.l CODE_random_number_gen
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	STA.w !REGISTER_Multiplicand
	TYA
	INC
	STA.w !REGISTER_Multiplier
	NOP #4
	LDX.w !REGISTER_ProductOrRemainderHi
	LDA.b $00,x
	STA.b ($2D),y
	STY.b $2F
CODE_10BD49:
	CPX.b $2F
	BEQ.b CODE_10BD54
	LDA.b $01,x
	STA.b $00,x
	INX
	BRA.b CODE_10BD49

CODE_10BD54:
	DEY
	BNE.b CODE_10BD2D
	LDA.b $00
	STA.b ($2D),y
	PLP
	RTS

CODE_10BD5D:
	LDA.w $10DE
	ASL
	TAX
	JMP.w (DATA_10BD65,x)

DATA_10BD65:
	dw CODE_10A41C
	dw CODE_10A427
	dw CODE_10A444
	dw CODE_10A466
	dw CODE_10A481
	dw CODE_10A4EC
	dw CODE_10A549
	dw CODE_10A5B3
	dw CODE_10BDB1
	dw CODE_10BDE8
	dw CODE_10C397
	dw CODE_10C219
	dw CODE_10A621

CODE_10BD7F:
	LDA.w #$0000
	STA.w $1138
	STA.w $113A
	STA.w $113C
	STZ.w $1148
	SEP.b #$20
	STZ.w $1141
	STZ.w $1142
	STZ.w $1143
	STZ.w $1144
	STZ.w $1145
	STZ.w $1146
	STZ.w $1147
	STZ.w $114A
	STZ.w $114B
	STZ.w $114C
	REP.b #$20
	RTS

CODE_10BDB1:
	LDA.w $1138
	BNE.b CODE_10BDC4
	LDX.w #$0008
	STX.w $10F0
	LDA.w DATA_10A2DD,x
	JSR.w CODE_10A39A
	BRA.b CODE_10BDCE

CODE_10BDC4:
	CMP.w #$0380
	BNE.b CODE_10BDCE
	INC.w $10DE
	BRA.b CODE_10BDDB

CODE_10BDCE:
	CLC
	ADC.w #$0010
	STA.w $1138
	STA.w $113A
	STA.w $113C
CODE_10BDDB:
	JSR.w CODE_10BF12
	JSR.w CODE_10BF2E
	JSR.w CODE_10C31D
	JSR.w CODE_10C017
	RTS

CODE_10BDE8:
	LDA.w $1138
	ORA.w $113A
	ORA.w $113C
	BNE.b CODE_10BE16
	JSR.w CODE_10C1B7
	LDA.w #$0080
	STA.w $10E0
	INC.w $10DE
	LDA.w $1148
	BEQ.b CODE_10BE11
	LDA.w #$0090
	STA.w $118A
	LDA.w #$0005
	STA.b !RAM_YI_Global_PlayMusicLo
	BRA.b CODE_10BE28

CODE_10BE11:
	INC.w $10DE
	BRA.b CODE_10BE28

CODE_10BE16:
	JSR.w CODE_10BE2C
	JSR.w CODE_10BEF2
	JSR.w CODE_10BF12
	JSR.w CODE_10BF2E
	JSR.w CODE_10C31D
	JSR.w CODE_10C16C
CODE_10BE28:
	JSR.w CODE_10C017
	RTS

CODE_10BE2C:
	SEP.b #$30
	LDA.w $114A
	BEQ.b CODE_10BE3D
	LDA.w $114B
	BEQ.b CODE_10BE3D
	LDA.w $114C
	BNE.b CODE_10BEBA
CODE_10BE3D:
	LDA.w $1141
	STA.b $00
	LDA.w $093F
	AND.b #$03
	BEQ.b CODE_10BE7A
	AND.b #$02
	BEQ.b CODE_10BE5C
	LDX.w $1141
CODE_10BE50:
	DEX
	BPL.b CODE_10BE55
	LDX.b #$02
CODE_10BE55:
	LDA.w $114A,x
	BNE.b CODE_10BE50
	BRA.b CODE_10BE6B

CODE_10BE5C:
	LDX.w $1141
CODE_10BE5F:
	INX
	CPX.b #$03
	BNE.b CODE_10BE66
	LDX.b #$00
CODE_10BE66:
	LDA.w $114A,x
	BNE.b CODE_10BE5F
CODE_10BE6B:
	STX.w $1141
	CPX.b $00
	BEQ.b CODE_10BEBA
	LDA.b #!Define_YI_SoundID5C_ScrollTextbox
	JSL.l CODE_push_sound_queue
	BRA.b CODE_10BEBA

CODE_10BE7A:
	LDA.w $093F
	AND.b #$C0
	BNE.b CODE_10BE88
	LDA.w $093E
	AND.b #$80
	BEQ.b CODE_10BEBA
CODE_10BE88:
	LDX.w $1141
	LDA.w $114A,x
	BNE.b CODE_10BEBA
	INC.w $114A,x
	JSR.w CODE_10BECF
	LDA.b #!Define_YI_SoundID33_StepOnNumberPlatform
	JSL.l CODE_push_sound_queue
	REP.b #$30
	JSR.w CODE_10C33D
	SEP.b #$30
	LDX.w $1141
CODE_10BEA6:
	INX
	CPX.b #$03
	BNE.b CODE_10BEAD
	LDX.b #$00
CODE_10BEAD:
	CPX.w $1141
	BEQ.b CODE_10BEBA
	LDA.w $114A,x
	BNE.b CODE_10BEA6
	STX.w $1141
CODE_10BEBA:
	REP.b #$30
	RTS

DATA_10BEBD:
	db $02,$04,$06,$08,$0A,$0C

DATA_10BEC3:
	dw $0310,$02A0,$0230,$01C0,$0150,$00E0

CODE_10BECF:
	SEP.b #$30
	INC.w $1142,x
	LDY.w $1142,x
	DEY
	LDA.w DATA_10BEBD,y
	STA.w $1145,x
	REP.b #$20
	TXA
	ASL
	TAY
	LDA.w $1142,x
	DEC
	ASL
	TAX
	LDA.w DATA_10BEC3,x
	STA.w $1138,y
	SEP.b #$20
	RTS

CODE_10BEF2:
	SEP.b #$30
	LDX.b #$02
CODE_10BEF6:
	LDA.w $1142,x
	BEQ.b CODE_10BF0C
	DEC.w $1145,x
	BPL.b CODE_10BF0C
	LDA.w $1142,x
	CMP.b #$06
	BEQ.b CODE_10BF0C
	PHX
	JSR.w CODE_10BECF
	PLX
CODE_10BF0C:
	DEX
	BPL.b CODE_10BEF6
	REP.b #$30
	RTS

CODE_10BF12:
	LDX.w #$0004
CODE_10BF15:
	LDA.w $1132,x
	CLC
	ADC.w $1138,x
	STA.w $1132,x
	LDA.w $114E,x
	CLC
	ADC.w $1138,x
	STA.w $114E,x
	DEX
	DEX
	BPL.b CODE_10BF15
	RTS

CODE_10BF2E:
	SEP.b #$30
	LDX.b #$02
CODE_10BF32:
	TXA
	ASL
	TAY
	LDA.w $1133,y
	CMP.b #$58
	BNE.b CODE_10BF60
	LDA.w $1142,x
	CMP.b #$06
	BCC.b CODE_10BF60
	LDA.w $1145,x
	BPL.b CODE_10BF60
	REP.b #$20
	LDA.w #$0000
	STA.w $1138,y
	LDA.w #$5800
	STA.w $1132,y
	LDA.w #$5000
	STA.w $114E,y
	SEP.b #$20
	BRA.b CODE_10BF7C

CODE_10BF60:
	LDA.w $1133,y
	CMP.b #$68
	BCC.b CODE_10BF7C
	LDA.b #!Define_YI_SoundID06_SlotMachineSpin
	JSL.l CODE_push_sound_queue
	JSR.w CODE_10BF82
	TXA
	ASL
	TAY
	LDA.w $1133,y
	SEC
	SBC.b #$20
	STA.w $1133,y
CODE_10BF7C:
	DEX
	BPL.b CODE_10BF32
	REP.b #$30
	RTS

CODE_10BF82:
	SEP.b #$30
	LDA.w $113E,x
	CLC
	ADC.b #$01
	AND.b #$07
	STA.w $113E,x
	TXA
	ASL
	ASL
	TAY
	LDA.w $1128,y
	STA.w $1129,y
	LDA.w $1127,y
	STA.w $1128,y
	LDA.w $1126,y
	STA.w $1127,y
	PHY
	TXA
	ASL
	ASL
	ASL
	CLC
	ADC.w $113E,x
	TAY
	LDA.w DATA_10BFB7,y
	PLY
	STA.w $1126,y
	RTS

DATA_10BFB7:
	db $00,$01,$02,$03,$04,$05,$00,$01,$01,$00,$03,$04,$05,$00,$01,$02
	db $02,$03,$04,$05,$00,$01,$02,$03

DATA_10BFCF:
	dw $0030,$0038,$0040,$0030,$0050,$0058,$0060,$0050
	dw $0070,$0078,$0080,$0070

DATA_10BFE7:
	dw $2100,$2111,$2102,$2120,$2103,$2114,$2105,$2123
	dw $2106,$2117,$2108,$2126,$2133,$2144,$2135,$2153
	dw $2136,$2147,$2138,$2156,$2130,$2141,$2132,$2150

CODE_10C017:
	LDY.w $6092
	LDA.w #$0000
	STA.b $00
CODE_10C01F:
	LDA.b $00
	ASL
	ASL
	ASL
	TAX
	LDA.w DATA_10BFCF,x
	STA.w $6000,y
	STA.w $6020,y
	STA.w $6040,y
	LDA.w DATA_10BFCF+$02,x
	STA.w $6008,y
	STA.w $6028,y
	STA.w $6048,y
	LDA.w DATA_10BFCF+$04,x
	STA.w $6010,y
	STA.w $6030,y
	STA.w $6050,y
	LDA.w DATA_10BFCF+$06,x
	STA.w $6018,y
	STA.w $6038,y
	STA.w $6058,y
	LDA.b $00
	ASL
	TAX
	LDA.w $1132,x
	XBA
	DEC
	AND.w #$00FF
	SEC
	SBC.b !RAM_YI_Global_Layer1YPosLo
	SEC
	SBC.w #$0008
	STA.w $6002,y
	STA.w $6012,y
	CLC
	ADC.w #$0008
	STA.w $600A,y
	CLC
	ADC.w #$0008
	STA.w $601A,y
	CLC
	ADC.w #$0010
	STA.w $6022,y
	STA.w $6032,y
	CLC
	ADC.w #$0008
	STA.w $602A,y
	CLC
	ADC.w #$0008
	STA.w $603A,y
	CLC
	ADC.w #$0010
	STA.w $6042,y
	STA.w $6052,y
	CLC
	ADC.w #$0008
	STA.w $604A,y
	CLC
	ADC.w #$0008
	STA.w $605A,y
	LDA.b $00
	ASL
	ASL
	STA.b $02
	TAX
	LDA.w $1126,x
	AND.w #$00FF
	ASL
	ASL
	ASL
	TAX
	LDA.w DATA_10BFE7,x
	STA.w $6004,y
	LDA.w DATA_10BFE7+$02,x
	STA.w $600C,y
	LDA.w DATA_10BFE7+$04,x
	STA.w $6014,y
	LDA.w DATA_10BFE7+$06,x
	STA.w $601C,y
	LDX.b $02
	LDA.w $1127,x
	AND.w #$00FF
	ASL
	ASL
	ASL
	TAX
	LDA.w DATA_10BFE7,x
	STA.w $6024,y
	LDA.w DATA_10BFE7+$02,x
	STA.w $602C,y
	LDA.w DATA_10BFE7+$04,x
	STA.w $6034,y
	LDA.w DATA_10BFE7+$06,x
	STA.w $603C,y
	LDX.b $02
	LDA.w $1128,x
	AND.w #$00FF
	ASL
	ASL
	ASL
	TAX
	LDA.w DATA_10BFE7,x
	STA.w $6044,y
	LDA.w DATA_10BFE7+$02,x
	STA.w $604C,y
	LDA.w DATA_10BFE7+$04,x
	STA.w $6054,y
	LDA.w DATA_10BFE7+$06,x
	STA.w $605C,y
	LDA.w #$0002
	STA.w $6006,y
	STA.w $600E,y
	STA.w $6026,y
	STA.w $602E,y
	STA.w $6046,y
	STA.w $604E,y
	LDA.w #$0000
	STA.w $6016,y
	STA.w $601E,y
	STA.w $6036,y
	STA.w $603E,y
	STA.w $6056,y
	STA.w $605E,y
	INC.b $00
	LDA.b $00
	CMP.w #$0003
	BEQ.b CODE_10C159
	TYA
	CLC
	ADC.w #$0060
	TAY
	JMP.w CODE_10C01F

CODE_10C159:
	LDA.w $6092
	CLC
	ADC.w #$0120
	STA.w $6092
	JMP.w CODE_10C25C

DATA_10C166:
	dw $0034,$0054,$0074

CODE_10C16C:
	LDA.w $114D
	BEQ.b CODE_10C1B6
	LDY.w $6092
	LDA.w $1141
	AND.w #$00FF
	ASL
	TAX
	LDA.w DATA_10C166,x
	STA.w $6000,y
	LDA.w #$00B0
	SEC
	SBC.b !RAM_YI_Global_Layer1YPosLo
	STA.w $6002,y
	LDA.w $093D
	AND.w #$00C0
	BNE.b CODE_10C19B
	LDA.w $093C
	AND.w #$0080
	BEQ.b CODE_10C1A0
CODE_10C19B:
	LDA.w #$3162
	BRA.b CODE_10C1A3

CODE_10C1A0:
	LDA.w #$3160
CODE_10C1A3:
	STA.w $6004,y
	LDA.w #$0002
	STA.w $6006,y
	LDA.w $6092
	CLC
	ADC.w #$0008
	STA.w $6092
CODE_10C1B6:
	RTS

CODE_10C1B7:
	SEP.b #$30
	LDA.w $1127
	CMP.b #$02
	BNE.b CODE_10C1D0
	LDA.w $112B
	CMP.b #$03
	BNE.b CODE_10C1D0
	LDA.w $112F
	CMP.b #$04
	BNE.b CODE_10C204
	BRA.b CODE_10C1F5

CODE_10C1D0:
	LDA.w $1127
	CMP.w $112B
	BNE.b CODE_10C204
	CMP.w $112F
	BNE.b CODE_10C204
	CMP.b #$00
	BNE.b CODE_10C1E5
	LDA.b #$02
	BRA.b CODE_10C1F7

CODE_10C1E5:
	CMP.b #$01
	BNE.b CODE_10C1ED
	LDA.b #$03
	BRA.b CODE_10C1F7

CODE_10C1ED:
	CMP.b #$05
	BNE.b CODE_10C1F5
	LDA.b #$05
	BRA.b CODE_10C1F7

CODE_10C1F5:
	LDA.b #$01
CODE_10C1F7:
	STA.w $1148
	REP.b #$30
	LDX.w #$0004
	STX.w $10F0
	BRA.b CODE_10C212

CODE_10C204:
	LDA.b #!Define_YI_SoundID7D_YoshiLostChallenge
	JSL.l CODE_push_sound_queue
	REP.b #$30
	LDX.w #$0006
	STX.w $10F0
CODE_10C212:
	LDA.w DATA_10A2DD,x
	JSR.w CODE_10A39A
	RTS

CODE_10C219:
	DEC.w $10E0
	BNE.b CODE_10C252
	LDA.w $1148
	AND.w #$00FF
	BNE.b CODE_10C231
CODE_10C226:
	LDA.w #$0080
	STA.w $10E0
	INC.w $10DE
	BRA.b CODE_10C252

CODE_10C231:
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
	CMP.w #$03E7
	BEQ.b CODE_10C226
	DEC.w $1148
	INC.w !RAM_YI_Level_CurrentLifeCountLo
	JSR.w CODE_109D74
	SEP.b #$20
	LDA.b #!Define_YI_SoundID08_1up
	JSL.l CODE_push_sound_queue
	REP.b #$20
	LDA.w #$0030
	STA.w $10E0
CODE_10C252:
	JSR.w CODE_10C017
	RTS

DATA_10C256:
	dw $0030,$0050,$0070

CODE_10C25C:
	LDY.w $6092
	LDA.w #$0000
	STA.b $00
CODE_10C264:
	LDA.b $00
	ASL
	TAX
	LDA.w DATA_10C256,x
	STA.w $6000,y
	STA.w $6018,y
	STA.w $6030,y
	CLC
	ADC.w #$0008
	STA.w $6008,y
	STA.w $6020,y
	STA.w $6038,y
	CLC
	ADC.w #$0008
	STA.w $6010,y
	STA.w $6028,y
	STA.w $6040,y
	LDA.b $00
	ASL
	TAX
	LDA.w $114E,x
	XBA
	DEC
	AND.w #$00FF
	SEC
	SBC.b !RAM_YI_Global_Layer1YPosLo
	SEC
	SBC.w #$0008
	STA.w $6002,y
	STA.w $600A,y
	STA.w $6012,y
	CLC
	ADC.w #$0020
	STA.w $601A,y
	STA.w $6022,y
	STA.w $602A,y
	CLC
	ADC.w #$0020
	STA.w $6032,y
	STA.w $603A,y
	STA.w $6042,y
	LDA.w #$2D68
	STA.w $6004,y
	STA.w $600C,y
	STA.w $6014,y
	STA.w $601C,y
	STA.w $6024,y
	STA.w $602C,y
	STA.w $6034,y
	STA.w $603C,y
	STA.w $6044,y
	LDA.w #$0000
	STA.w $6006,y
	STA.w $600E,y
	STA.w $6016,y
	STA.w $601E,y
	STA.w $6026,y
	STA.w $602E,y
	STA.w $6036,y
	STA.w $603E,y
	STA.w $6046,y
	INC.b $00
	LDA.b $00
	CMP.w #$0003
	BEQ.b CODE_10C312
	TYA
	CLC
	ADC.w #$0080
	TAY
	JMP.w CODE_10C264

CODE_10C312:
	LDA.w $6092
	CLC
	ADC.w #$0090
	STA.w $6092
	RTS

CODE_10C31D:
	LDX.w #$0004
CODE_10C320:
	LDA.w $114E,x
	CMP.w #$6800
	BCC.b CODE_10C332
	LDA.w $114E,x
	SEC
	SBC.w #$2000
	STA.w $114E,x
CODE_10C332:
	DEX
	DEX
	BPL.b CODE_10C320
	RTS

DATA_10C337:
	dw $6AA6,$6AAA,$6AAE

CODE_10C33D:
	LDA.w $1141
	AND.w #$00FF
	ASL
	TAY
	LDA.l $7E4000
	TAX
	LDA.w DATA_10C337,y
	STA.l $7E4002,x
	CLC
	ADC.w #$0020
	STA.l $7E400C,x
	LDA.w #$0005
	STA.l $7E4004,x
	STA.l $7E400E,x
	LDA.w #$3CF4
	STA.l $7E4006,x
	INC
	STA.l $7E4008,x
	INC
	STA.l $7E400A,x
	LDA.w #$3CF7
	STA.l $7E4010,x
	INC
	STA.l $7E4012,x
	INC
	STA.l $7E4014,x
	LDA.w #$FFFF
	STA.l $7E4016,x
	TXA
	CLC
	ADC.w #$0014
	STA.l $7E4000
CODE_10C396:
	RTS

CODE_10C397:
	JSR.w CODE_10C017
	DEC.w $118A
	BPL.b CODE_10C3A9
	LDA.w #$0001
	STA.w $10E0
	INC.w $10DE
	RTS

CODE_10C3A9:
	LDA.w $1148
	AND.w #$00FF
	DEC
	ASL
	TAX
	JMP.w (DATA_10C3B5,x)

DATA_10C3B5:
	dw CODE_10C421
	dw CODE_10C3C9
	dw CODE_10C3C9
	dw CODE_10C396
	dw CODE_10C3C9

DATA_10C3BF:
	dw $69F3,$69B3,$6973

DATA_10C3C5:
	dw $0000,$2CFC

CODE_10C3C9:
	LDA.w $1148
	AND.w #$00FF
	SEC
	SBC.w #$0002
	CMP.w #$0003
	BNE.b CODE_10C3D9
	DEC
CODE_10C3D9:
	ASL
	TAY
	LDA.l $7E4000
	TAX
	LDA.w DATA_10C3BF,y
	STA.l $7E4002,x
	CLC
	ADC.w #$0020
	STA.l $7E4008,x
	LDA.w #$000E
	ORA.w #$4000
	STA.l $7E4004,x
	STA.l $7E400A,x
	LDA.w $118A
	AND.w #$0004
	LSR
	TAY
	LDA.w DATA_10C3C5,y
	STA.l $7E4006,x
	STA.l $7E400C,x
	LDA.w #$FFFF
	STA.l $7E400E,x
	TXA
	CLC
	ADC.w #$000C
	STA.l $7E4000
	RTS

CODE_10C421:
	LDA.l $7E4000
	TAX
	LDA.w #$6A33
	STA.l $7E4002,x
	CLC
	ADC.w #$0020
	STA.l $7E4008,x
	CLC
	ADC.w #$0020
	STA.l $7E400E,x
	CLC
	ADC.w #$0020
	STA.l $7E4014,x
	CLC
	ADC.w #$0020
	STA.l $7E401A,x
	LDA.w #$000E
	ORA.w #$4000
	STA.l $7E4004,x
	STA.l $7E400A,x
	STA.l $7E4010,x
	STA.l $7E4016,x
	STA.l $7E401C,x
	LDA.w $118A
	AND.w #$0004
	LSR
	TAY
	LDA.w DATA_10C3C5,y
	STA.l $7E4006,x
	STA.l $7E400C,x
	STA.l $7E4012,x
	STA.l $7E4018,x
	STA.l $7E401E,x
	LDA.w #$FFFF
	STA.l $7E4020,x
	TXA
	CLC
	ADC.w #$001E
	STA.l $7E4000
	RTS

CODE_10C497:
	LDA.w $10DE
	ASL
	TAX
	JMP.w (DATA_10C49F,x)

DATA_10C49F:
	dw CODE_10A41C
	dw CODE_10A427
	dw CODE_10A444
	dw CODE_10A466
	dw CODE_10A481
	dw CODE_10A4EC
	dw CODE_10A549
	dw CODE_10A5B3
	dw CODE_10C4BF
	dw CODE_10A621

DATA_10C4B3:
	db CODE_10C4E3,CODE_10C574,CODE_10C5AF,CODE_10C61C

DATA_10C4B7:
	db CODE_10C4E3>>8,CODE_10C574>>8,CODE_10C5AF>>8,CODE_10C61C>>8

DATA_10C4BB:
	db CODE_10C4E3>>16,CODE_10C574>>16,CODE_10C5AF>>16,CODE_10C61C>>16

CODE_10C4BF:
	SEP.b #$30
	JSL.l CODE_10C4CB
	JSR.w CODE_10CC3A
	REP.b #$30
	RTS

CODE_10C4CB:
	LDX.w $1165
	LDA.l DATA_10C4B3,x
	STA.b $03
	LDA.l DATA_10C4B7,x
	STA.b $04
	LDA.l DATA_10C4BB,x
	STA.b $05
	JMP.w [$0003]

CODE_10C4E3:
	LDA.b $37
	AND.b #$80
	BNE.b CODE_10C4EF
	LDA.b $38
	BIT.b #$C0
	BEQ.b CODE_10C511
CODE_10C4EF:
	SEP.b #$20
	LDA.b #$01
	STA.w $1165
	LDA.b #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	REP.b #$30
	LDA.w #$0008
	STA.w $10F0
	TAY
	LDA.w DATA_10A2DD,y
	JSR.w CODE_10A39A
	SEP.b #$30
	JSR.w CODE_10C641
	RTL

CODE_10C511:
	AND.b #$0C
	BNE.b CODE_10C52C
	LDA.b $36
	AND.b #$0C
	BNE.b CODE_10C51F
	STZ.w $117E
	RTL

CODE_10C51F:
	INC.w $117E
	LDX.w $117E
	CPX.b #$20
	BNE.b CODE_10C573
	DEC.w $117E
CODE_10C52C:
	STA.b $0F
	LDA.w $117E
	CMP.b #$1F
	BNE.b CODE_10C53B
	LDA.b $30
	AND.b #$01
	BEQ.b CODE_10C554
CODE_10C53B:
	LDA.w $1177
	BNE.b CODE_10C54E
	LDA.w $1176
	CMP.b #$01
	BNE.b CODE_10C54E
	LDA.w $1178
	CMP.b #$01
	BEQ.b CODE_10C557
CODE_10C54E:
	LDA.b #!Define_YI_SoundID09_Coin
	JSL.l CODE_push_sound_queue
CODE_10C554:
	JSR.w CODE_10C8CE
CODE_10C557:
	REP.b #$30
	LDA.w $1178
	AND.w #$00FF
	STA.b $00
	LDA.w $1176
	SEC
	SBC.b $00
	INC
	STA.w !RAM_YI_Level_CurrentLifeCountLo
	JSR.w CODE_109D74
	SEP.b #$30
	JSR.w CODE_10CC80
CODE_10C573:
	RTL

CODE_10C574:
	LDA.w $1183
	BNE.b CODE_10C590
	LDA.b $37
	AND.b #$80
	BNE.b CODE_10C585
	LDA.b $38
	AND.b #$C0
	BEQ.b CODE_10C590
CODE_10C585:
	INC.w $1183
	LDA.b #$50
	STA.w $1168
	STA.w $1169
CODE_10C590:
	LDX.b #$00
CODE_10C592:
	LDA.w $1174
	DEC
	STA.b $00
	CPX.b $00
	BEQ.b CODE_10C59F
	JSR.w CODE_10C917
CODE_10C59F:
	INX
	CPX.b #$02
	BNE.b CODE_10C592
	REP.b #$30
	JSR.w CODE_109D74
	SEP.b #$30
	JSR.w CODE_10CC80
	RTL

CODE_10C5AF:
	DEC.w $1180
	BNE.b CODE_10C61B
	JSR.w CODE_10C624
	LDA.b #$40
	STA.w $1180
	INC.w $117F
	LDA.w $117F
	CMP.b #$01
	BNE.b CODE_10C61B
	LDA.b #$03
	STA.w $1165
	REP.b #$20
	LDA.w #$0040
	STA.w $10E0
	LDA.w $117C
	STA.w $1148
	SEP.b #$20
	BEQ.b CODE_10C5F0
	LDA.w $117D
	BNE.b CODE_10C5EA
	LDA.w $1178
	CMP.w $117C
	BCS.b CODE_10C5F6
CODE_10C5EA:
	LDA.b #$05
	STA.b !RAM_YI_Global_PlayMusicLo
	BRA.b CODE_10C5F6

CODE_10C5F0:
	LDA.b #!Define_YI_SoundID7D_YoshiLostChallenge
	JSL.l CODE_push_sound_queue
CODE_10C5F6:
	REP.b #$30
	LDX.w #$0004
	LDA.w $1178
	AND.w #$00FF
	CMP.w $117C
	BCC.b CODE_10C610
	PHP
	LDX.w #$0000
	PLP
	BEQ.b CODE_10C610
	LDX.w #$0006
CODE_10C610:
	STX.w $10F0
	LDA.w DATA_10A2DD,x
	JSR.w CODE_10A39A
	SEP.b #$30
CODE_10C61B:
	RTL

CODE_10C61C:
	REP.b #$30
	JSR.w CODE_10B9F8
	SEP.b #$30
	RTL

CODE_10C624:
	LDA.w $117F
	JSL.l CODE_execute_ptr

DATA_10C62B:
	dw CODE_10C7B2
	dw CODE_10C6C5

DATA_10C62F:
	dw $39F5,$0003,$2CFC,$2CFC,$3A15,$0003,$2CFC,$2CFC
	dw $FFFF

CODE_10C641:
	LDA.w $1178
	STA.b $0E
	STZ.b $0F
	JSR.w CODE_10CD09
	STZ.b $03
	STZ.b $05
	LDA.w $1179
	ASL
	STA.b $04
	LDA.w $117A
	ASL
	STA.b $02
	REP.b #$30
	LDA.l $7E4000
	CLC
	ADC.w #$0011
	TAX
	DEC
	STA.l $7E4000
	LDY.w #$0011
	SEP.b #$20
CODE_10C670:
	LDA.w DATA_10C62F,y
	STA.l $7E4002,x
	DEX
	DEY
	BPL.b CODE_10C670
	REP.b #$20
	LDA.l $7E4000
	SEC
	SBC.w #$000C
	TAX
	LDY.b $02
	BEQ.b CODE_10C694
	LDA.w DATA_10D159,y
	ORA.w #$0C00
	STA.l $7E4002,x
CODE_10C694:
	LDY.b $04
	LDA.w DATA_10D159,y
	ORA.w #$0C00
	STA.l $7E4004,x
	LDA.l $7E4000
	SEC
	SBC.w #$0004
	TAX
	LDY.b $02
	BEQ.b CODE_10C6B7
	LDA.w DATA_10D16D,y
	ORA.w #$0C00
	STA.l $7E4002,x
CODE_10C6B7:
	LDY.b $04
	LDA.w DATA_10D16D,y
	ORA.w #$0C00
	STA.l $7E4004,x
	SEP.b #$30
CODE_10C6C5:
	RTS

DATA_10C6C6:
	db $F7,$39,$01,$00,$FC,$2C,$17,$3A,$01,$00,$FC,$2C,$FF,$FF

DATA_10C6D4:
	dw $3EF8,$3EF6

DATA_10C6D8:
	dw $3EF9,$3EF7

CODE_10C6DC:
	PHX
	REP.b #$30
	LDA.l $7E4000
	CLC
	ADC.w #$000D
	TAX
	DEC
	STA.l $7E4000
	LDY.w #$000D
	SEP.b #$20
CODE_10C6F2:
	LDA.w DATA_10C6C6,y
	STA.l $7E4002,x
	DEX
	DEY
	BPL.b CODE_10C6F2
	LDA.w $1166
	TAY
	LDA.w DATA_10C869,y
	ASL
	TAY
	REP.b #$20
	LDA.l $7E4000
	SEC
	SBC.w #$0008
	TAX
	LDA.w DATA_10C6D4,y
	STA.l $7E4002,x
	LDA.l $7E4000
	SEC
	SBC.w #$0002
	TAX
	LDA.w DATA_10C6D8,y
	STA.l $7E4002,x
	SEP.b #$30
	PLX
	RTS

DATA_10C72C:
	db $F8,$39,$01,$00,$FC,$2C,$18,$3A,$01,$00,$FC,$2C,$FF,$FF

CODE_10C73A:
	PHX
	STZ.b $03
	LDY.w $1167
	LDA.w DATA_10C877,y
	ASL
	STA.b $02
	REP.b #$30
	LDA.l $7E4000
	CLC
	ADC.w #$000D
	TAX
	DEC
	STA.l $7E4000
	LDY.w #$000D
	SEP.b #$20
CODE_10C75B:
	LDA.w DATA_10C72C,y
	STA.l $7E4002,x
	DEX
	DEY
	BPL.b CODE_10C75B
	REP.b #$20
	LDA.l $7E4000
	SEC
	SBC.w #$0008
	TAX
	LDY.b $02
	LDA.w DATA_10D159,y
	ORA.w #$0C00
	STA.l $7E4002,x
	LDA.l $7E4000
	SEC
	SBC.w #$0002
	TAX
	LDA.w DATA_10D16D,y
	ORA.w #$0C00
	STA.l $7E4002,x
	SEP.b #$30
	PLX
	RTS

DATA_10C794:
	db $35,$3A,$09,$00,$FC,$2C,$FC,$2C,$FC,$2C,$9C,$3E,$9D,$3E,$55,$3A
	db $09,$00,$FC,$2C,$FC,$2C,$FC,$2C,$9E,$3E,$9F,$3E,$FF,$FF

CODE_10C7B2:
	JSR.w CODE_10C885
	LDA.w $117C
	STA.b $0E
	LDA.w $117D
	STA.b $0F
	JSR.w CODE_10CD09
	STZ.b $01
	STZ.b $03
	STZ.b $05
	LDA.w $1179
	ASL
	STA.b $04
	LDA.w $117A
	ASL
	STA.b $02
	LDA.w $117B
	ASL
	STA.b $00
	REP.b #$30
	LDA.l $7E4000
	CLC
	ADC.w #$001D
	TAX
	DEC
	STA.l $7E4000
	LDY.w #$001D
	SEP.b #$20
CODE_10C7EF:
	LDA.w DATA_10C794,y
	STA.l $7E4002,x
	DEX
	DEY
	BPL.b CODE_10C7EF
	REP.b #$20
	LDA.l $7E4000
	SEC
	SBC.w #$0018
	TAX
	LDY.b $00
	BEQ.b CODE_10C813
	LDA.w DATA_10D159,y
	ORA.w #$0C00
	STA.l $7E4002,x
CODE_10C813:
	LDY.b $02
	BNE.b CODE_10C81B
	LDA.b $00
	BEQ.b CODE_10C825
CODE_10C81B:
	LDA.w DATA_10D159,y
	ORA.w #$0C00
	STA.l $7E4004,x
CODE_10C825:
	LDY.b $04
	LDA.w DATA_10D159,y
	ORA.w #$0C00
	STA.l $7E4006,x
	LDA.l $7E4000
	SEC
	SBC.w #$000A
	TAX
	LDY.b $00
	BEQ.b CODE_10C848
	LDA.w DATA_10D16D,y
	ORA.w #$0C00
	STA.l $7E4002,x
CODE_10C848:
	LDY.b $02
	BNE.b CODE_10C850
	LDA.b $00
	BEQ.b CODE_10C85A
CODE_10C850:
	LDA.w DATA_10D16D,y
	ORA.w #$0C00
	STA.l $7E4004,x
CODE_10C85A:
	LDY.b $04
	LDA.w DATA_10D16D,y
	ORA.w #$0C00
	STA.l $7E4006,x
	SEP.b #$30
	RTS

DATA_10C869:
	dw $0001,$0100,$0100,$0100,$0000,$0001,$0001

DATA_10C877:
	dw $0003,$0001,$0002,$0001,$0002,$0001,$0001

CODE_10C885:
	LDX.w $1166
	LDA.w DATA_10C869,x
	JSL.l CODE_execute_ptr

DATA_10C88F:
	dw CODE_10C893
	dw CODE_10C8A4

CODE_10C893:
	STZ.w $117D
	LDY.w $1167
	LDA.w $1178
	CLC
	ADC.w DATA_10C877,y
	STA.w $117C
	RTS

CODE_10C8A4:
	STZ.b $00
	STZ.b $01
	LDY.w $1167
	LDX.w DATA_10C877,y
	BEQ.b CODE_10C8C2
	LDA.w $1178
CODE_10C8B3:
	DEX
	BEQ.b CODE_10C8C0
	CLC
	ADC.w $1178
	BCC.b CODE_10C8BE
	INC.b $01
CODE_10C8BE:
	BRA.b CODE_10C8B3

CODE_10C8C0:
	STA.b $00
CODE_10C8C2:
	REP.b #$20
	LDA.b $00
	STA.w $117C
	SEP.b #$20
	RTS

DATA_10C8CC:
	db $FF,$01

CODE_10C8CE:
	REP.b #$20
	LDA.w #$0063
	STA.b $00
	INC
	STA.b $02
	LDA.w $1176
	CMP.w #$0063
	BCS.b CODE_10C8E5
	STA.b $00
	INC
	STA.b $02
CODE_10C8E5:
	SEP.b #$20
	LDA.b $0F
	LSR
	LSR
	DEC
	TAX
	LDA.w $1178
	CLC
	ADC.w DATA_10C8CC,x
	STA.w $1178
	CMP.b $02
	BNE.b CODE_10C901
	LDA.b #$01
	STA.w $1178
	RTS

CODE_10C901:
	CMP.b #$00
	BNE.b CODE_10C90A
	LDA.b $00
	STA.w $1178
CODE_10C90A:
	RTS

DATA_10C90B:
	db $01,$03

DATA_10C90D:
	db $01,$01

DATA_10C90F:
	db $0E,$0E

DATA_10C911:
	db $00,$00

DATA_10C913:
	db $0D,$0D

DATA_10C915:
	db $08,$04

CODE_10C917:
	LDA.w $1183
	BEQ.b CODE_10C934
	LDA.w $116E,x
	BEQ.b CODE_10C92A
	CMP.b #$01
	BEQ.b CODE_10C945
	DEC.w $116E,x
	BRA.b CODE_10C960

CODE_10C92A:
	LDA.b $30
	AND.w DATA_10C90B,x
	BNE.b CODE_10C934
	DEC.w $1168,x
CODE_10C934:
	LDA.w $1168,x
	BEQ.b CODE_10C96C
	CMP.w DATA_10C915,x
	BNE.b CODE_10C960
	LDA.b #$50
	STA.w $116E,x
	BRA.b CODE_10C960

CODE_10C945:
	TXA
	INC
	ORA.w $1174
	STA.w $1174
	AND.b #$03
	CMP.b #$03
	BNE.b CODE_10C95C
	LDA.b #$02
	STA.w $1165
	JSR.w CODE_10C73A
	RTS

CODE_10C95C:
	JSR.w CODE_10C6DC
	RTS

CODE_10C960:
	LDA.w $1168,x
	CLC
	ADC.w $116A,x
	STA.w $116A,x
	BCC.b CODE_10C9B0
CODE_10C96C:
	TXY
	PHY
	LDA.b #!Define_YI_SoundID50_MessageAppears
	JSL.l CODE_push_sound_queue
	PLY
	LDA.w $1166,x
	CLC
	ADC.w DATA_10C90D,y
	CMP.w DATA_10C90F,y
	BNE.b CODE_10C984
	LDA.w DATA_10C911,y
CODE_10C984:
	STA.w $1166,x
	DEC
	BPL.b CODE_10C98D
	LDA.w DATA_10C913,y
CODE_10C98D:
	STA.w $116C,x
	LDA.b #$00
	CPX.b #$00
	BEQ.b CODE_10C998
	LDA.b #$10
CODE_10C998:
	STA.b $0F
	LDY.b #$00
	LDA.w $1166,x
	STA.w $1175
CODE_10C9A2:
	JSR.w CODE_10CBB9
	LDA.w $116C,x
	STA.w $1175
	INY
	CPY.b #$02
	BNE.b CODE_10C9A2
CODE_10C9B0:
	RTS

DATA_10C9B1:
	dw $3A2D,$0003

DATA_10C9B5:
	dw $3A6C,$0003

DATA_10C9B9:
	dw $3A8A,$0003

DATA_10C9BD:
	dw $3A88,$0003

DATA_10C9C1:
	dw $3A86,$0003

DATA_10C9C5:
	dw $3A64,$0003

DATA_10C9C9:
	dw $3A23,$0003

DATA_10C9CD:
	dw $39E3,$0003

DATA_10C9D1:
	dw $39A4,$0003

DATA_10C9D5:
	dw $3986,$0003

DATA_10C9D9:
	dw $3988,$0003

DATA_10C9DD:
	dw $398A,$0003

DATA_10C9E1:
	dw $39AC,$0003

DATA_10C9E5:
	dw $39ED,$0003

DATA_10C9E9:
	dw $3A31,$0003

DATA_10C9ED:
	dw $39F1,$0003

DATA_10C9F1:
	dw $39B2,$0003

DATA_10C9F5:
	dw $3994,$0003

DATA_10C9F9:
	dw $3996,$0003

DATA_10C9FD:
	dw $3998,$0003

DATA_10CA01:
	dw $39BA,$0003

DATA_10CA05:
	dw $39FB,$0003

DATA_10CA09:
	dw $3A3B,$0003

DATA_10CA0D:
	dw $3A7A,$0003

DATA_10CA11:
	dw $3A98,$0003

DATA_10CA15:
	dw $3A96,$0003

DATA_10CA19:
	dw $3A94,$0003

DATA_10CA1D:
	dw $3A72,$0003

DATA_10CA21:
	dw $2283,$6283

DATA_10CA25:
	dw $6288,$2288

DATA_10CA29:
	dw $A285,$E285

DATA_10CA2D:
	dw $E28A,$A28A

DATA_10CA31:
	dw $6288,$2288

DATA_10CA35:
	dw $2283,$6283

DATA_10CA39:
	dw $A289,$E289

DATA_10CA3D:
	dw $6284,$2284

DATA_10CA41:
	dw $E28A,$A28A

DATA_10CA45:
	dw $A285,$E285

DATA_10CA49:
	dw $2287,$6287

DATA_10CA4D:
	dw $6288,$2288

DATA_10CA51:
	dw $E286,$A286

DATA_10CA55:
	dw $A289,$E289

DATA_10CA59:
	dw $228B,$628B

DATA_10CA5D:
	dw $228C,$228D

DATA_10CA61:
	dw $228B,$628B

DATA_10CA65:
	dw $228C,$228D

DATA_10CA69:
	dw $228B,$628B

DATA_10CA6D:
	dw $2291,$2292

DATA_10CA71:
	dw $228B,$628B

DATA_10CA75:
	dw $228C,$228D

DATA_10CA79:
	dw $228B,$628B

DATA_10CA7D:
	dw $228E,$228F

DATA_10CA81:
	dw $228B,$628B

DATA_10CA85:
	dw $228C,$228D

DATA_10CA89:
	dw $228B,$628B

DATA_10CA8D:
	dw $228E,$228F

DATA_10CA91:
	dw $A283,$E283

DATA_10CA95:
	dw $E288,$A288

DATA_10CA99:
	dw $2285,$6285

DATA_10CA9D:
	dw $628A,$228A

DATA_10CAA1:
	dw $E288,$A288

DATA_10CAA5:
	dw $A283,$E283

DATA_10CAA9:
	dw $2289,$6289

DATA_10CAAD:
	dw $E284,$A284

DATA_10CAB1:
	dw $628A,$228A

DATA_10CAB5:
	dw $2285,$6285

DATA_10CAB9:
	dw $A287,$E287

DATA_10CABD:
	dw $E288,$A288

DATA_10CAC1:
	dw $6286,$2286

DATA_10CAC5:
	dw $2289,$6289

DATA_10CAC9:
	dw $A28B,$E28B

DATA_10CACD:
	dw $E28D,$A28D

DATA_10CAD1:
	dw $A28B,$E28B

DATA_10CAD5:
	dw $E28D,$A28D

DATA_10CAD9:
	dw $A28B,$E28B

DATA_10CADD:
	dw $A291,$2293

DATA_10CAE1:
	dw $A28B,$E28B

DATA_10CAE5:
	dw $E28D,$A28D

DATA_10CAE9:
	dw $A28B,$E28B

DATA_10CAED:
	dw $2290,$E28E

DATA_10CAF1:
	dw $A28B,$E28B

DATA_10CAF5:
	dw $E28D,$A28D

DATA_10CAF9:
	dw $A28B,$E28B

DATA_10CAFD:
	dw $2290,$E28E

DATA_10CB01:
	dw DATA_10C9D5,DATA_10C9D9,DATA_10C9DD,DATA_10C9E1,DATA_10C9E5,DATA_10C9B1,DATA_10C9B5,DATA_10C9B9
	dw DATA_10C9BD,DATA_10C9C1,DATA_10C9C5,DATA_10C9C9,DATA_10C9CD,DATA_10C9D1,DATA_10C9B1,DATA_10C9B1
	dw DATA_10C9FD,DATA_10CA01,DATA_10CA05,DATA_10CA09,DATA_10CA0D,DATA_10CA11,DATA_10CA15,DATA_10CA19
	dw DATA_10CA1D,DATA_10C9E9,DATA_10C9ED,DATA_10C9F1,DATA_10C9F5,DATA_10C9F9

DATA_10CB3D:
	dw DATA_10CA45,DATA_10CA49,DATA_10CA4D,DATA_10CA51,DATA_10CA55,DATA_10CA21,DATA_10CA25,DATA_10CA29
	dw DATA_10CA2D,DATA_10CA31,DATA_10CA35,DATA_10CA39,DATA_10CA3D,DATA_10CA41,DATA_10CA21,DATA_10CA21
	dw DATA_10CA6D,DATA_10CA71,DATA_10CA75,DATA_10CA79,DATA_10CA7D,DATA_10CA81,DATA_10CA85,DATA_10CA89
	dw DATA_10CA8D,DATA_10CA59,DATA_10CA5D,DATA_10CA61,DATA_10CA65,DATA_10CA69

DATA_10CB79:
	dw DATA_10CAB5,DATA_10CAB9,DATA_10CABD,DATA_10CAC1,DATA_10CAC5,DATA_10CA91,DATA_10CA95,DATA_10CA99
	dw DATA_10CA9D,DATA_10CAA1,DATA_10CAA5,DATA_10CAA9,DATA_10CAAD,DATA_10CAB1,DATA_10CA91,DATA_10CA91
	dw DATA_10CADD,DATA_10CAE1,DATA_10CAE5,DATA_10CAE9,DATA_10CAED,DATA_10CAF1,DATA_10CAF5,DATA_10CAF9
	dw DATA_10CAFD,DATA_10CAC9,DATA_10CACD,DATA_10CAD1,DATA_10CAD5,DATA_10CAD9

DATA_10CBB5:
	dw $0800,$1C00

CODE_10CBB9:
	REP.b #$20
	PHX
	PHY
	TYA
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_10CBB5,y
	STA.b $06
	LDA.w $1175
	AND.w #$00FF
	ORA.b $0F
	ASL
	TAX
	LDA.w DATA_10CB01,x
	STA.b $00
	LDA.w DATA_10CB3D,x
	STA.b $02
	LDA.w DATA_10CB79,x
	STA.b $04
	REP.b #$10
	LDA.l $7E4000
	TAX
	LDY.w #$0000
CODE_10CBEB:
	LDA.b ($00),y
	STA.l $7E4002,x
	CPY.w #$0000
	BNE.b CODE_10CBFA
	CLC
	ADC.w #$0020
CODE_10CBFA:
	STA.l $7E400A,x
	INX
	INX
	INY
	INY
	CPY.w #$0004
	BNE.b CODE_10CBEB
	LDY.w #$0000
CODE_10CC0A:
	LDA.b ($02),y
	ORA.b $06
	STA.l $7E4002,x
	LDA.b ($04),y
	ORA.b $06
	STA.l $7E400A,x
	INX
	INX
	INY
	INY
	CPY.w #$0004
	BNE.b CODE_10CC0A
	INX
	INX
	LDA.w #$FFFF
	STA.l $7E4008,x
	TXA
	CLC
	ADC.w #$0006
	STA.l $7E4000
	SEP.b #$30
	PLY
	PLX
	RTS

CODE_10CC3A:
	LDA.w $1174
	BEQ.b CODE_10CC6D
	LDX.b #$01
	AND.b #$02
	BNE.b CODE_10CC47
	LDX.b #$00
CODE_10CC47:
	LDA.b #$00
	CPX.b #$00
	BEQ.b CODE_10CC4F
	LDA.b #$10
CODE_10CC4F:
	STA.b $0F
	LDY.b #$00
	LDA.w $10DE
	CMP.b #$09
	BEQ.b CODE_10CC61
	LDA.b $30
	AND.b #$01
	BNE.b CODE_10CC61
	INY
CODE_10CC61:
	LDA.w $1166,x
	STA.w $1175
	JSR.w CODE_10CBB9
	DEX
	BPL.b CODE_10CC47
CODE_10CC6D:
	RTS

DATA_10CC6E:
	db $09,$3A,$03,$00,$FC,$2C,$FC,$2C,$29,$3A,$03,$00,$FC,$2C,$FC,$2C
	db $FF,$FF

CODE_10CC80:
	LDA.w $1178
	STA.b $0E
	STZ.b $0F
	JSR.w CODE_10CD09
	STZ.b $03
	STZ.b $05
	LDA.w $1179
	ASL
	STA.b $04
	LDA.w $117A
	ASL
	STA.b $02
	REP.b #$30
	LDA.l $7E4000
	CLC
	ADC.w #$0011
	TAX
	DEC
	STA.l $7E4000
	LDY.w #$0011
	SEP.b #$20
CODE_10CCAF:
	LDA.w DATA_10CC6E,y
	STA.l $7E4002,x
	DEX
	DEY
	BPL.b CODE_10CCAF
	REP.b #$20
	LDA.l $7E4000
	SEC
	SBC.w #$000C
	TAX
	LDA.b $02
	BEQ.b CODE_10CCD5
	LDY.b $02
	LDA.w DATA_10D159,y
	ORA.w #$0C00
	STA.l $7E4002,x
CODE_10CCD5:
	LDY.b $04
	LDA.w DATA_10D159,y
	ORA.w #$0C00
	STA.l $7E4004,x
	LDA.l $7E4000
	SEC
	SBC.w #$0004
	TAX
	LDA.b $02
	BEQ.b CODE_10CCFA
	LDY.b $02
	LDA.w DATA_10D16D,y
	ORA.w #$0C00
	STA.l $7E4002,x
CODE_10CCFA:
	LDY.b $04
	LDA.w DATA_10D16D,y
	ORA.w #$0C00
	STA.l $7E4004,x
	SEP.b #$30
	RTS

CODE_10CD09:
	STZ.w $117B
	STZ.w $117A
	STZ.w $1179
	REP.b #$20
	LDA.b $0E
	CMP.w #$0100
	BCC.b CODE_10CD31
	STZ.b $00
CODE_10CD1D:
	CMP.w #$0064
	BCC.b CODE_10CD2A
	INC.b $00
	SEC
	SBC.w #$0064
	BRA.b CODE_10CD1D

CODE_10CD2A:
	SEP.b #$20
	LDX.b $00
	STX.w $117B
CODE_10CD31:
	SEP.b #$20
	CMP.b #$64
	BCC.b CODE_10CD3F
	INC.w $117B
	SEC
	SBC.b #$64
	BRA.b CODE_10CD31

CODE_10CD3F:
	CMP.b #$0A
	BCC.b CODE_10CD4B
	INC.w $117A
	SEC
	SBC.b #$0A
	BRA.b CODE_10CD3F

CODE_10CD4B:
	STA.w $1179
	RTS

CODE_10CD4F:
	LDA.w $10DE
	ASL
	TAX
	JMP.w (DATA_10CD57,x)

DATA_10CD57:
	dw CODE_10A41C
	dw CODE_10A427
	dw CODE_10A444
	dw CODE_10A466
	dw CODE_10A481
	dw CODE_10A4EC
	dw CODE_10A549
	dw CODE_10A5B3
	dw CODE_10CF39
	dw CODE_10CFF2
	dw CODE_10D0B8
	dw CODE_10D0C1
	dw CODE_10A621

DATA_10CD71:
	dw $0000,$0090,$0120,$01B0,$0240,$02D0

DATA_10CD7D:
	db $50,$78,$A0,$50,$78,$A0

DATA_10CD83:
	db $68,$68,$68,$90,$90,$90

DATA_10CD89:
	db $03,$03,$03,$FD,$FD,$FD,$00,$01,$02,$03,$04,$05,$06,$07,$08

DATA_10CD98:
	dw $7E39AA,$7E39AF,$7E39B4,$7E3A4A,$7E3A4F,$7E3A54

CODE_10CDA4:
	SEP.b #$30
	LDA.b #$00
	STA.w $1114
	TAY
	LDA.w DATA_10CD7D,y
	STA.w $10F6
	LDA.w DATA_10CD83,y
	STA.w $10F7
	LDX.b #$08
	TXY
CODE_10CDBB:
	TXA
	STA.b $00,x
	DEX
	BPL.b CODE_10CDBB
	LDA.b #$04
	STA.b $2D
	LDA.b #$11
	STA.b $2E
	JSR.w CODE_random_list_generator
	LDX.b #$05
	TXY
CODE_10CDCF:
	TXA
	STA.b $00,x
	DEX
	BPL.b CODE_10CDCF
	LDA.b #$15
	STA.b $2D
	LDA.b #$11
	STA.b $2E
	JSR.w CODE_random_list_generator
	LDY.b #$02
	LDA.w $0381
	CMP.b #$32
	BCS.b CODE_10CDEB
	LDY.b #$00
CODE_10CDEB:
	LDA.b #$09
CODE_10CDED:
	LDX.w $1115,y
	STA.w $1104,x
	DEY
	BPL.b CODE_10CDED
	REP.b #$30
	LDA.w #$7E7BBE
	STA.b $12
	LDA.w #$7E7BBE>>16
	STA.b $14
	LDY.w #$0005
CODE_10CE05:
	TYA
	ASL
	TAX
	LDA.w DATA_10CD98,x
	STA.b $10
	LDA.w $1104,y
	AND.w #$00FF
	ASL
	TAX
	PHY
	LDA.w DATA_10CE30,x
	JSR.w CODE_10CF01
	PLY
	LDA.b $12
	CLC
	ADC.w #$0012
	STA.b $12
	LDA.b $14
	ADC.w #$0000
	STA.b $14
	DEY
	BPL.b CODE_10CE05
	RTS

DATA_10CE30:
	dw DATA_10CE44,DATA_10CE56,DATA_10CE68,DATA_10CE7A,DATA_10CE8C,DATA_10CE9E,DATA_10CEB0,DATA_10CEC2
	dw DATA_10CED4,DATA_10CEE6

DATA_10CE44:
	dw $0D5A,$0D5B,$0D5C,$0D5D,$0D5E,$0D5F,$0D60,$0D61
	dw $0D62

DATA_10CE56:
	dw $1589,$158A,$158B,$158C,$158D,$158E,$158F,$1590
	dw $1591

DATA_10CE68:
	dw $0D51,$0D52,$0D53,$0D54,$0D55,$0D56,$0D57,$0D58
	dw $0D59

DATA_10CE7A:
	dw $1563,$1564,$1565,$1566,$1567,$1568,$1569,$156A
	dw $156B

DATA_10CE8C:
	dw $0D3F,$0D40,$0D41,$0D42,$0D43,$0D44,$0D45,$0D46
	dw $0D47

DATA_10CE9E:
	dw $1192,$1193,$1194,$1195,$1196,$1197,$1198,$1199
	dw $119A

DATA_10CEB0:
	dw $159B,$159C,$159D,$159E,$159F,$15A0,$15A1,$15A2
	dw $15A3

DATA_10CEC2:
	dw $0D92,$0D93,$0D94,$0D95,$0D96,$0D97,$0D98,$0D99
	dw $0D9A

DATA_10CED4:
	dw $0D6C,$0D6D,$0D6E,$0D6F,$0D70,$0D71,$0D72,$0D73
	dw $0D74

DATA_10CEE6:
	dw $1575,$1576,$1577,$1578,$1579,$157A,$157B,$157C
	dw $157D

DATA_10CEF8:
	db !Define_YI_ItemID_10Star,!Define_YI_ItemID_20Star,!Define_YI_ItemID_FullEgg
	db !Define_YI_ItemID_POW,!Define_YI_ItemID_StarCloud,!Define_YI_ItemID_GreenMelon
	db !Define_YI_ItemID_RedMelon,!Define_YI_ItemID_BlueMelon,!Define_YI_ItemID_MagnifyingGlass

CODE_10CF01:
	STA.b $16
	LDX.w #$0009
	LDY.w #$0000
CODE_10CF09:
	LDA.b ($16),y
	STA.b [$12],y
	INY
	INY
	DEX
	BNE.b CODE_10CF09
	LDA.w #$0003
	STA.b $0E
	LDA.b $14
	STA.b $01
	LDY.b $10
	LDX.b $12
CODE_10CF1F:
	LDA.w #$0006
	PHY
	PHX
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0006
	TAX
	PLA
	CLC
	ADC.w #$0020
	TAY
	DEC.b $0E
	BNE.b CODE_10CF1F
	RTS

CODE_10CF39:
	SEP.b #$20
	LDA.w $110F
	BEQ.b CODE_10CF43
	DEC.w $110F
CODE_10CF43:
	REP.b #$20
	LDA.w $10F6
	AND.w #$00FF
	CLC
	ADC.w #$0014
	STA.b $00
	LDA.w $10F7
	AND.w #$00FF
	CLC
	ADC.w #$0014
	STA.b $02
	LDA.w #$3160
	STA.b $04
	JSR.w CODE_10BBF9
	LDA.w $093E
	AND.w #$C080
	BEQ.b CODE_10CF92
	LDA.w #!Define_YI_SoundID09_Coin
	JSL.l CODE_push_sound_queue
	LDY.w #$000A
	STY.w $10F0
	LDA.w DATA_10A2DD,y
	JSR.w CODE_10A39A
	SEP.b #$30
	LDA.b #$18
	STA.w $110F
	INC.w $10DE
	REP.b #$20
	STZ.w $111C
	REP.b #$10
	RTS

CODE_10CF92:
	SEP.b #$30
	LDA.w $093F
	AND.b #$0F
	BEQ.b CODE_10CF9F
	LDY.b #$20
	BRA.b CODE_10CFA6

CODE_10CF9F:
	LDY.w $110F
	BNE.b CODE_10CFEF
	LDY.b #$10
CODE_10CFA6:
	STY.w $110F
	LDA.w $093D
	AND.b #$0F
	BNE.b CODE_10CFB2
	BRA.b CODE_10CFEF

CODE_10CFB2:
	PHA
	AND.b #$03
	TAY
	LDA.w $1114
	CLC
	ADC.w DATA_10B63F,y
	BPL.b CODE_10CFC3
	LDA.b #$05
	BRA.b CODE_10CFC9

CODE_10CFC3:
	CMP.b #$06
	BCC.b CODE_10CFC9
	LDA.b #$00
CODE_10CFC9:
	STA.w $1114
	TAY
	PLA
	LSR
	LSR
	BIT.b #$03
	BEQ.b CODE_10CFDD
	TYA
	CLC
	ADC.w DATA_10CD89,y
	STA.w $1114
	TAY
CODE_10CFDD:
	LDA.w DATA_10CD7D,y
	STA.w $10F6
	LDA.w DATA_10CD83,y
	STA.w $10F7
	LDA.b #!Define_YI_SoundID5C_ScrollTextbox
	JSL.l CODE_push_sound_queue
CODE_10CFEF:
	REP.b #$30
	RTS

CODE_10CFF2:
	SEP.b #$20
	LDA.w $110F
	BNE.b CODE_10D006
	LDA.b #$20
	STA.w $110F
	LDA.b #!Define_YI_SoundID32_HitMessageBox
	JSL.l CODE_push_sound_queue
	BRA.b CODE_10D009

CODE_10D006:
	DEC.w $110F
CODE_10D009:
	REP.b #$20
	SEP.b #$10
	LDA.w #(FXDATA_538000+$2420)>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #FXDATA_538000+$2420
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $111C
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_08E01F>>16
	LDA.w #FXCODE_08E01F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDA.w #$705800>>16
	STA.b $01
	LDA.w $1114
	AND.w #$00FF
	ASL
	TAX
	LDY.w DATA_10CD71,x
	LDX.w #$705800
	LDA.w #$0003
	STA.b $0E
CODE_10D048:
	LDA.w #$0060
	PHX
	PHY
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0030
	TAY
	PLA
	CLC
	ADC.w #$0200
	TAX
	DEC.b $0E
	BNE.b CODE_10D048
	SEP.b #$30
	LDA.w $111C
	CMP.b #$0C
	BEQ.b CODE_10D076
	LDA.b $30
	AND.b #$03
	BNE.b CODE_10D073
	INC.w $111C
CODE_10D073:
	REP.b #$30
	RTS

CODE_10D076:
	REP.b #$30
	INC.w $10DE
	LDA.w $1114
	AND.w #$00FF
	TAY
	LDA.w $1104,y
	AND.w #$00FF
	CMP.w #$0009
	BEQ.b CODE_10D09F
	TAY
	LDA.w DATA_10CEF8,y
	JSR.w CODE_109C80
	LDA.w #$0005
	STA.w !RAM_YI_Global_PlayMusicLo
	LDY.w #$0004
	BRA.b CODE_10D0A9

CODE_10D09F:
	LDA.w #!Define_YI_SoundID7D_YoshiLostChallenge
	JSL.l CODE_push_sound_queue
	LDY.w #$0006
CODE_10D0A9:
	STY.w $10F0
	LDA.w #$0080
	STA.w $10E0
	LDA.w DATA_10A2DD,y
	JMP.w CODE_10A39A

CODE_10D0B8:
	DEC.w $10E0
	BNE.b CODE_10D0C0
	INC.w $10DE
CODE_10D0C0:
	RTS

CODE_10D0C1:
	LDA.w #(FXDATA_538000+$2420)>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #FXDATA_538000+$2420
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w $10E0
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	SEP.b #$10
	LDX.b #FXCODE_08E01F>>16
	LDA.w #FXCODE_08E01F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDA.w $1114
	AND.w #$00FF
	STA.b $0E
	LDX.w #$0005
CODE_10D0F1:
	CPX.b $0E
	BEQ.b CODE_10D12E
	PHX
	TXA
	ASL
	TAX
	LDA.w #$705800>>16
	STA.b $01
	LDY.w DATA_10CD71,x
	LDX.w #$705800
	LDA.w #$0060
	PHY
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0030
	TAY
	LDX.w #$705A00
	LDA.w #$0060
	PHY
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0030
	TAY
	LDX.w #$705C00
	LDA.w #$0060
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLX
CODE_10D12E:
	DEX
	BPL.b CODE_10D0F1
	LDA.w $10E0
	CMP.w #$000C
	BNE.b CODE_10D14E
	STZ.w !RAM_YI_Level_DeathsInCurrentLevelLo
	STZ.w !RAM_YI_Level_1upsCollectedInCurrentLevelLo
	LDA.w #$0064
	STA.w $0381
	LDA.w #$0080
	STA.w $10E0
	INC.w $10DE
CODE_10D14E:
	LDA.b $30
	AND.w #$0003
	BNE.b CODE_10D158
	INC.w $10E0
CODE_10D158:
	RTS

DATA_10D159:
	dw $00CF,$00C7,$00C8,$00C9,$00CA,$00CB,$00CC,$00CD
	dw $00CE,$80DC

DATA_10D16D:
	dw $80CF,$00D7,$00D8,$00D9,$00DA,$00DB,$00DC,$00DD
	dw $00DC,$00DE

CODE_10D181:
	LDA.w $10DE
	ASL
	TAX
	JMP.w (DATA_10D189,x)

DATA_10D189:
	dw CODE_10A41C
	dw CODE_10A427
	dw CODE_10A444
	dw CODE_10A466
	dw CODE_10A481
	dw CODE_10A4EC
	dw CODE_10A549
	dw CODE_10A5B3
	dw CODE_10D946
	dw CODE_10D295
	dw CODE_10AE80
	dw CODE_10D5CA
	dw CODE_10D5FE
	dw CODE_10A621
	dw CODE_10D748
	dw CODE_10D7A3
	dw CODE_10D7D4
	dw CODE_10D843
	dw CODE_10D895
	dw CODE_10D5CD
	dw CODE_10D601
	dw CODE_10D9B8
	dw CODE_10D843
	dw CODE_10D895

CODE_10D1B9:
	STZ.w $1148
	STZ.w $1184
	STZ.w $114E
	LDA.w #$00FF
	STA.w $1192
	STA.w $1194
	SEP.b #$30
	LDX.b #$0C
CODE_10D1CF:
	STZ.w $119A,x
	STZ.w $119B,x
	DEX
	DEX
	BPL.b CODE_10D1CF
	LDA.w DATA_10D3CA
	STA.w $10F6
	LDA.w DATA_10D3D8
	STA.w $10F7
	STZ.w $10F8
	STZ.w $1154
	STZ.w $1155
	STZ.w $1164
	REP.b #$30
	RTS

DATA_10D1F4:
	db $00,$02,$03,$05,$06,$07,$08,$09,$0B,$01,$01,$02,$02,$03,$03,$05
	db $32

CODE_10D205:
	SEP.b #$30
	JSR.w CODE_10D275
	STA.b $20
CODE_10D20C:
	JSR.w CODE_10D275
	CMP.b $20
	BEQ.b CODE_10D20C
	STA.b $21
	LDX.b #$00
	TXY
CODE_10D218:
	CPY.b $20
	BEQ.b CODE_10D229
	CPY.b $21
	BEQ.b CODE_10D229
	LDA.w DATA_10D1F4,y
	STA.b $00,x
	STA.b $01,x
	INX
	INX
CODE_10D229:
	INY
	CPX.b #$0E
	BNE.b CODE_10D218
	LDA.b #$0E
	STA.b $0E
	LDY.b #$00
CODE_10D234:
	JSL.l CODE_random_number_gen
	LDA.b $0E
	STA.w !REGISTER_Multiplicand
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	STA.w !REGISTER_Multiplier
	NOP #4
	REP.b #$20
	LDA.w !REGISTER_ProductOrRemainderLo
	XBA
	SEP.b #$20
	AND.b #$0F
	TAX
	LDA.b $00,x
	STA.w $1156,y
	INY
	CPY.b #$0D
	BEQ.b CODE_10D269
	DEC.b $0E
CODE_10D25E:
	CPX.b $0E
	BEQ.b CODE_10D234
	LDA.b $01,x
	STA.b $00,x
	INX
	BRA.b CODE_10D25E

CODE_10D269:
	TXA
	EOR.b #$01
	TAX
	LDA.b $00,x
	STA.w $1163
	REP.b #$30
	RTS

CODE_10D275:
	SEP.b #$20
	JSL.l CODE_random_number_gen
	LDA.b #$09
	STA.w !REGISTER_Multiplicand
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	STA.w !REGISTER_Multiplier
	NOP #4
	REP.b #$20
	LDA.w !REGISTER_ProductOrRemainderLo
	XBA
	SEP.b #$20
	AND.b #$0F
	RTS

CODE_10D295:
	SEP.b #$30
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	BEQ.b CODE_10D2A1
	JSR.w CODE_10AE80
	BRA.b CODE_10D2B6

CODE_10D2A1:
	LDA.w $1164
	CMP.b #$02
	BNE.b CODE_10D2AD
	JSR.w CODE_10D2B9
	BRA.b CODE_10D2B6

CODE_10D2AD:
	JSR.w CODE_10D3E8
	JSR.w CODE_10D470
	JSR.w CODE_10A928
CODE_10D2B6:
	REP.b #$30
	RTS

CODE_10D2B9:
	LDA.w $1148
	CMP.b #$06
	BNE.b CODE_10D2D8
	LDA.b #$0A
	STA.w $114E
	LDA.b #$05
	STA.b !RAM_YI_Global_PlayMusicLo
	LDA.b #$90
	STA.w $10E0
	REP.b #$30
	INC.w $1148
	JSR.w CODE_10D6CC
	BRA.b CODE_10D333

CODE_10D2D8:
	SEP.b #$30
	LDA.w $1192
	CMP.w $1194
	BNE.b CODE_10D341
	LDA.w $1148
	CMP.b #$05
	BNE.b CODE_10D2EC
	JSR.w CODE_10D3AE
CODE_10D2EC:
	LDA.b #$FF
	LDX.w $1196
	STA.w $1156,x
	LDX.w $1198
	STA.w $1156,x
	REP.b #$30
	INC.w $1148
	LDA.w $1148
	CMP.w #$0002
	BNE.b CODE_10D30A
	JSR.w CODE_10D37C
CODE_10D30A:
	JSR.w CODE_10D6CC
	LDA.w $1192
	AND.w #$00FF
	TAX
	LDA.w DATA_10A90A,x
	AND.w #$00FF
	JSR.w CODE_109C80
	LDA.w #$00FF
	STA.w $1192
	STA.w $1194
	LDA.w #!Define_YI_SoundID8F_Correct
	JSL.l CODE_push_sound_queue
CODE_10D32D:
	LDA.w #$0090
	STA.w $10E0
CODE_10D333:
	LDA.w #$000E
	STA.w $10DE
	LDX.w #$0004
	STX.w $10F0
	BRA.b CODE_10D373

CODE_10D341:
	REP.b #$30
	INC.w $1184
	LDA.w $1184
	CMP.w #$0002
	BNE.b CODE_10D35A
	LDA.w #!Define_YI_SoundID7D_YoshiLostChallenge
	JSL.l CODE_push_sound_queue
	LDA.w #$000D
	BRA.b CODE_10D364

CODE_10D35A:
	LDA.w #!Define_YI_SoundID90_Incorrect
	JSL.l CODE_push_sound_queue
	LDA.w #$000F
CODE_10D364:
	STA.w $10DE
	LDA.w #$0080
	STA.w $10E0
	LDX.w #$0006
	STX.w $10F0
CODE_10D373:
	LDA.w DATA_10A2DD,x
	JSR.w CODE_10A39A
	SEP.b #$30
	RTS

CODE_10D37C:
	LDA.l $7E4000
	TAX
	LDA.w #$6A13
	STA.l $7E4002,x
	LDA.w #$8003
	STA.l $7E4004,x
	LDA.w #$0CAF
	STA.l $7E4006,x
	LDA.w #$0CBF
	STA.l $7E4008,x
	LDA.w #$FFFF
	STA.l $7E400A,x
	TXA
	CLC
	ADC.w #$0008
	STA.l $7E4000
	RTS

CODE_10D3AE:
	LDX.b #$0D
CODE_10D3B0:
	CPX.w $1196
	BEQ.b CODE_10D3C6
	CPX.w $1198
	BEQ.b CODE_10D3C6
	LDA.w $1156,x
	CMP.b #$FF
	BEQ.b CODE_10D3C6
	LDA.b #$04
	STA.w $1156,x
CODE_10D3C6:
	DEX
	BPL.b CODE_10D3B0
	RTS

DATA_10D3CA:
	db $38,$58,$78,$98,$B8,$28,$48,$A8,$C8,$38,$58,$78,$98,$B8

DATA_10D3D8:
	db $58,$58,$58,$58,$58,$78,$78,$78,$78,$98,$98,$98,$98,$98

DATA_10D3E6:
	db $02,$FE

CODE_10D3E8:
	LDX.w $1154
	LDA.w $10F8
	BEQ.b CODE_10D435
	CMP.b #$03
	BCS.b CODE_10D40E
	LDA.w DATA_10D3CA,x
	CMP.w $10F6
	BEQ.b CODE_10D432
	LDA.w $10F8
	AND.b #$01
	TAX
	LDA.w DATA_10D3E6,x
	CLC
	ADC.w $10F6
	STA.w $10F6
	BRA.b CODE_10D435

CODE_10D40E:
	LDA.w $10F7
	CMP.w DATA_10D3D8,x
	BEQ.b CODE_10D432
	LDA.w $10F8
	AND.b #$01
	TAX
	LDA.w DATA_10D3E6,x
	CLC
	ADC.w $10F7
	STA.w $10F7
	LDA.w $1155
	CLC
	ADC.w $10F6
	STA.w $10F6
	BRA.b CODE_10D435

CODE_10D432:
	STZ.w $10F8
CODE_10D435:
	RTS

DATA_10D436:
	db $09,$0A,$0B,$0C,$0D,$00,$01,$03,$04,$05,$06,$02,$07,$08

DATA_10D444:
	db $05,$06,$0B,$07,$08,$09,$0A,$0C,$0D,$00,$01,$02,$03,$04

DATA_10D452:
	db $00,$00,$00,$00,$00,$01,$01,$FF,$FF,$FF,$FF,$00,$01,$01

DATA_10D460:
	db $FF,$FF,$00,$01,$01,$01,$01,$FF,$FF,$00,$00,$00,$00,$00

DATA_10D46E:
	db $FF,$01

CODE_10D470:
	LDA.w $10F8
	BEQ.b CODE_10D476
CODE_10D475:
	RTS

CODE_10D476:
	LDA.w $093F
	AND.b #$C0
	BNE.b CODE_10D484
	LDA.w $093E
	AND.b #$80
	BEQ.b CODE_10D487
CODE_10D484:
	JMP.w CODE_10D520

CODE_10D487:
	LDA.w $093F
	AND.b #$0F
	BEQ.b CODE_10D475
	AND.b #$03
	BEQ.b CODE_10D4D1
	AND.b #$01
	TAX
	LDA.w $1154
	CLC
	ADC.w DATA_10D46E,x
	STA.w $1154
	CPX.b #$00
	BNE.b CODE_10D4BA
	CMP.b #$FF
	BNE.b CODE_10D4AE
	LDA.b #$0D
	STA.w $1154
	BRA.b CODE_10D506

CODE_10D4AE:
	CMP.b #$04
	BEQ.b CODE_10D506
	CMP.b #$08
	BEQ.b CODE_10D506
	LDX.b #$00
	BRA.b CODE_10D515

CODE_10D4BA:
	CMP.b #$0E
	BNE.b CODE_10D4C5
	LDA.b #$00
	STA.w $1154
	BRA.b CODE_10D506

CODE_10D4C5:
	CMP.b #$05
	BEQ.b CODE_10D506
	CMP.b #$09
	BEQ.b CODE_10D506
	LDX.b #$01
	BRA.b CODE_10D515

CODE_10D4D1:
	LDA.w $093F
	AND.b #$08
	BEQ.b CODE_10D4EF
	LDX.w $1154
	LDA.w DATA_10D452,x
	STA.w $1155
	LDA.w DATA_10D436,x
	STA.w $1154
	CPX.b #$05
	BCC.b CODE_10D506
	LDX.b #$02
	BRA.b CODE_10D515

CODE_10D4EF:
	LDX.w $1154
	LDA.w DATA_10D460,x
	STA.w $1155
	LDA.w DATA_10D444,x
	STA.w $1154
	CPX.b #$09
	BCS.b CODE_10D506
	LDX.b #$03
	BRA.b CODE_10D515

CODE_10D506:
	TAX
	LDA.w DATA_10D3CA,x
	STA.w $10F6
	LDA.w DATA_10D3D8,x
	STA.w $10F7
	BRA.b CODE_10D519

CODE_10D515:
	INX
	STX.w $10F8
CODE_10D519:
	LDA.b #!Define_YI_SoundID5C_ScrollTextbox
	JSL.l CODE_push_sound_queue
	RTS

CODE_10D520:
	LDX.w $1154
	LDY.w $1156,x
	CPY.b #$FF
	BEQ.b CODE_10D536
	LDA.w $1164
	AND.b #$01
	BEQ.b CODE_10D537
	CPX.w $1196
	BNE.b CODE_10D537
CODE_10D536:
	RTS

CODE_10D537:
	STY.w $10F3
	LDA.w $1164
	AND.w #$0A01
	TAX
	TYA
	STA.w $1192,x
	LDA.w $1154
	STA.w $1196,x
	INC.w $1164
	LDA.b #$01
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	JSR.w CODE_10AD77
	REP.b #$30
	LDX.w #$0002
	STX.w $10F0
	LDA.w DATA_10A2DD,x
	JSR.w CODE_10A39A
	SEP.b #$30
	INC.w $10DE
	SEP.b #$30
	RTS

DATA_10D56C:
	dw $6967,$696B,$696F,$6973,$6977,$69E5,$69E9,$69F5
	dw $69F9,$6A67,$6A6B,$6A6F,$6A73,$6A77

CODE_10D588:
	LDA.w $1154
	AND.w #$00FF
	ASL
	TAX
	LDA.w #$0003
	STA.b $0E
	LDY.w DATA_10D56C,x
CODE_10D598:
	PHY
	LDA.w #DATA_10AB12>>16
	STA.b $01
	LDX.w #DATA_10AB12
	LDA.w #$0006
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0020
	TAY
	DEC.b $0E
	BNE.b CODE_10D598
	LDA.w #DATA_10D6B1
	STA.b $00
	JSR.w CODE_10D6B4
	STZ.w $10F4
	LDA.w #$0084
	LDX.w #$0015
	JMP.w CODE_10AC94

DATA_10D5C6:
	dw $0008,$0010

CODE_10D5CA:
	JSR.w CODE_10AE80
CODE_10D5CD:
	LDX.w #$0000
	LDA.w $10DE
	CMP.w #$0013
	BNE.b CODE_10D5DA
	INX
	INX
CODE_10D5DA:
	LDA.w $10F4
	CLC
	ADC.w DATA_10D5C6,x
	STA.w $10F4
	CMP.w #$0080
	BMI.b CODE_10D5ED
	INC.w $10DE
	RTS

CODE_10D5ED:
	LDA.w #DATA_10D6B1
	STA.b $00
	JSR.w CODE_10D6B4
	LDA.w #$0084
	LDX.w #$0015
	JMP.w CODE_10AC94

CODE_10D5FE:
	JSR.w CODE_10AE80
CODE_10D601:
	LDX.w #$0000
	LDA.w $10DE
	CMP.w #$0014
	BNE.b CODE_10D60E
	INX
	INX
CODE_10D60E:
	LDA.w $10F4
	SEC
	SBC.w DATA_10D5C6,x
	STA.w $10F4
	BPL.b CODE_10D673
	LDA.w $1154
	AND.w #$00FF
	ASL
	TAX
	LDY.w DATA_10D56C,x
	LDA.w $10F3
	AND.w #$00FF
	ASL
	STA.b $00
	ASL
	ASL
	ASL
	CLC
	ADC.b $00
	CLC
	ADC.w #DATA_10AA16
	TAX
	LDA.w #$0003
	STA.b $0E
	LDA.w #DATA_10AA16>>16
	STA.b $01
CODE_10D643:
	LDA.w #$0006
	PHX
	PHY
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0020
	TAY
	PLA
	CLC
	ADC.w #$0006
	TAX
	DEC.b $0E
	BNE.b CODE_10D643
	LDA.w $10DE
	CMP.w #$0014
	BEQ.b CODE_10D669
	LDA.w #$0009
	BRA.b CODE_10D66F

CODE_10D669:
	INC.w $1154
	LDA.w #$0008
CODE_10D66F:
	STA.w $10DE
	RTS

CODE_10D673:
	LDA.w $10F3
	AND.w #$00FF
	CLC
	ADC.w #DATA_10AB33
	STA.b $00
	JSR.w CODE_10D6B4
	LDA.w $10F3
	AND.w #$00FF
	TAY
	LDX.w #$0011
	LDA.w DATA_10AA0A,y
	AND.w #$00FF
	JMP.w CODE_10AC94

DATA_10D695:
	db $34,$54,$74,$94,$B4,$24,$44,$A4,$C4,$34,$54,$74,$94,$B4

DATA_10D6A3:
	db $54,$54,$54,$54,$54,$74,$74,$74,$74,$94,$94,$94,$94,$94

DATA_10D6B1:
	db $32,$32,$32

CODE_10D6B4:
	LDA.w $1154
	AND.w #$00FF
	TAX
	CLC
	ADC.w #DATA_10D695
	STA.b $02
	TXA
	CLC
	ADC.w #DATA_10D6A3
	STA.b $04
	JSR.w CODE_10ACB7
	RTS

CODE_10D6CC:
	LDX.w #$0000
	LDA.w $1148
	LDY.w #$0000
CODE_10D6D5:
	CMP.w #$000A
	BCC.b CODE_10D6E0
	SBC.w #$000A
	INY
	BRA.b CODE_10D6D5

CODE_10D6E0:
	STA.b $00
	STY.b $02
	LDA.l $7E4000
	TAX
	LDA.w #$6A0E
	STA.l $7E4002,x
	CLC
	ADC.w #$0020
	STA.l $7E400A,x
	LDA.w #$0003
	STA.l $7E4004,x
	STA.l $7E400C,x
	PHX
	LDA.w #$0002
	STA.b $04
	LDA.b $02
	BNE.b CODE_10D718
	LDA.w #$0000
	STA.l $7E4006,x
	BRA.b CODE_10D72A

CODE_10D716:
	LDA.b $00
CODE_10D718:
	ASL
	TAY
	LDA.w DATA_10D159,y
	ORA.w #$0C00
	STA.l $7E4006,x
	LDA.w DATA_10D16D,y
	ORA.w #$0C00
CODE_10D72A:
	STA.l $7E400E,x
	INX
	INX
	DEC.b $04
	DEC.b $04
	BPL.b CODE_10D716
	PLX
	LDA.w #$FFFF
	STA.l $7E4012,x
	TXA
	CLC
	ADC.w #$0010
	STA.l $7E4000
	RTS

CODE_10D748:
	LDA.w $10E0
	BEQ.b CODE_10D752
	DEC.w $10E0
	BRA.b CODE_10D7A2

CODE_10D752:
	LDA.w $114E
	BNE.b CODE_10D78C
	LDA.w $10F3
	AND.w #$00FF
	CMP.w #$0004
	BNE.b CODE_10D770
	LDA.w #$0080
	STA.w $10E0
	LDA.w #$000D
	STA.w $10DE
	BRA.b CODE_10D7A2

CODE_10D770:
	LDA.w $60C0
	BNE.b CODE_10D7A2
	STZ.w $1164
	LDX.w #$0000
	STX.w $10F0
	LDA.w DATA_10A2DD,x
	JSR.w CODE_10A39A
	LDA.w #$0009
	STA.w $10DE
	BRA.b CODE_10D7A2

CODE_10D78C:
	DEC.w $114E
	INC.w !RAM_YI_Level_CurrentLifeCountLo
	LDA.w #!Define_YI_SoundID08_1up
	JSL.l CODE_push_sound_queue
	JSR.w CODE_109D74
	LDA.w #$0030
	STA.w $10E0
CODE_10D7A2:
	RTS

CODE_10D7A3:
	LDA.w $10E0
	BEQ.b CODE_10D7AD
	DEC.w $10E0
	BRA.b CODE_10D7D3

CODE_10D7AD:
	DEC.w $1164
	BMI.b CODE_10D7BE
	LDA.w #!Define_YI_SoundID50_MessageAppears
	JSL.l CODE_push_sound_queue
	INC.w $10DE
	BRA.b CODE_10D7D3

CODE_10D7BE:
	STZ.w $1164
	LDX.w #$0000
	STX.w $10F0
	LDA.w DATA_10A2DD,x
	JSR.w CODE_10A39A
	LDA.w #$0009
	STA.w $10DE
CODE_10D7D3:
	RTS

CODE_10D7D4:
	LDA.w $1164
	AND.w #$00FF
	ASL
	TAX
	LDA.w $1196,x
	AND.w #$00FF
	ASL
	TAX
	LDA.w #$0003
	STA.b $0E
	LDY.w DATA_10D56C,x
CODE_10D7EC:
	PHY
	LDA.w #DATA_10AB12>>16
	STA.b $01
	LDX.w #DATA_10AB12
	LDA.w #$0006
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0020
	TAY
	DEC.b $0E
	BNE.b CODE_10D7EC
	LDA.w $1164
	AND.w #$00FF
	ASL
	TAX
	LDA.w $1192,x
	AND.w #$00FF
	CLC
	ADC.w #DATA_10AB33
	STA.b $00
	JSR.w CODE_10D926
	STZ.w $10F4
	LDA.w $1164
	AND.w #$00FF
	ASL
	TAX
	LDA.w $1192,x
	AND.w #$00FF
	TAY
	LDX.w #$0011
	LDA.w DATA_10AA0A,y
	AND.w #$00FF
	JSR.w CODE_10AC94
	INC.w $10DE
	RTS

DATA_10D83F:
	dw $0018,$0010

CODE_10D843:
	LDX.w #$0000
	LDA.w $10DE
	CMP.w #$0011
	BEQ.b CODE_10D850
	INX
	INX
CODE_10D850:
	LDA.w $10F4
	CLC
	ADC.w DATA_10D83F,x
	STA.w $10F4
	CMP.w #$0080
	BMI.b CODE_10D863
	INC.w $10DE
	RTS

CODE_10D863:
	LDA.w $1164
	AND.w #$00FF
	ASL
	TAX
	LDA.w $1192,x
	AND.w #$00FF
	CLC
	ADC.w #DATA_10AB33
	STA.b $00
	JSR.w CODE_10D926
	LDA.w $1164
	AND.w #$00FF
	ASL
	TAX
	LDA.w $1192,x
	AND.w #$00FF
	TAY
	LDX.w #$0011
	LDA.w DATA_10AA0A,y
	AND.w #$00FF
	JMP.w CODE_10AC94

CODE_10D895:
	LDX.w #$0000
	LDA.w $10DE
	CMP.w #$0012
	BEQ.b CODE_10D8A2
	INX
	INX
CODE_10D8A2:
	LDA.w $10F4
	SEC
	SBC.w DATA_10D83F,x
	STA.w $10F4
	BPL.b CODE_10D911
	LDA.w $1164
	AND.w #$00FF
	ASL
	TAX
	LDA.w $1196,x
	AND.w #$00FF
	ASL
	TAX
	LDY.w DATA_10D56C,x
	LDA.w #$00D8
	CLC
	ADC.w #DATA_10AA16
	TAX
	LDA.w #$0003
	STA.b $0E
CODE_10D8CE:
	LDA.w #DATA_10AA16>>16
	STA.b $01
	LDA.w #$0006
	PHX
	PHY
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0020
	TAY
	PLA
	CLC
	ADC.w #$0006
	TAX
	DEC.b $0E
	BNE.b CODE_10D8CE
	LDA.w $10DE
	CMP.w #$0012
	BNE.b CODE_10D907
	LDA.w $1164
	AND.w #$00FF
	ASL
	TAX
	LDA.w DATA_10D922,x
	STA.w $10E0
	LDA.w #$000F
	BRA.b CODE_10D90D

CODE_10D907:
	INC.w $1154
	LDA.w #$0015
CODE_10D90D:
	STA.w $10DE
	RTS

CODE_10D911:
	LDA.w #DATA_10D6B1
	STA.b $00
	JSR.w CODE_10D926
	LDA.w #$0084
	LDX.w #$0015
	JMP.w CODE_10AC94

DATA_10D922:
	dw $0040,$0010

CODE_10D926:
	LDA.w $1164
	AND.w #$00FF
	ASL
	TAX
	LDA.w $1196,x
	AND.w #$00FF
	TAX
	CLC
	ADC.w #DATA_10D695
	STA.b $02
	TXA
	CLC
	ADC.w #DATA_10D6A3
	STA.b $04
	JSR.w CODE_10ACB7
	RTS

CODE_10D946:
	LDA.w $1154
	CMP.w #$000E
	BEQ.b CODE_10D96A
	LDA.w $1154
	AND.w #$00FF
	TAX
	LDA.w $1156,x
	STA.w $10F3
	JSR.w CODE_10D97A
	LDA.w #!Define_YI_SoundID50_MessageAppears
	JSL.l CODE_push_sound_queue
	LDA.w #$0013
	BRA.b CODE_10D976

CODE_10D96A:
	STZ.w $1154
	LDA.w #$0040
	STA.w $10E0
	LDA.w #$0015
CODE_10D976:
	STA.w $10DE
	RTS

CODE_10D97A:
	LDA.w $1154
	AND.w #$00FF
	ASL
	TAX
	LDA.w #$0003
	STA.b $0E
	LDY.w DATA_10D56C,x
CODE_10D98A:
	PHY
	LDA.w #DATA_10AB12>>16
	STA.b $01
	LDX.w #DATA_10AB12
	LDA.w #$0006
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLA
	CLC
	ADC.w #$0020
	TAY
	DEC.b $0E
	BNE.b CODE_10D98A
	LDA.w #DATA_10D6B1
	STA.b $00
	JSR.w CODE_10D6B4
	STZ.w $10F4
	LDA.w #$0084
	LDX.w #$0015
	JMP.w CODE_10AC94

CODE_10D9B8:
	LDA.w $10E0
	BEQ.b CODE_10D9C2
	DEC.w $10E0
	BRA.b CODE_10D9EE

CODE_10D9C2:
	LDA.w $1154
	CMP.w #$000E
	BEQ.b CODE_10D9E5
	LDX.w $1154
	STX.w $1196
	LDA.w $1156,x
	STA.w $1192
	STZ.w $1164
	JSR.w CODE_10D7D4
	LDA.w #!Define_YI_SoundID50_MessageAppears
	JSL.l CODE_push_sound_queue
	BRA.b CODE_10D9EE

CODE_10D9E5:
	JSR.w CODE_10D1B9
	LDA.w #$0009
	STA.w $10DE
CODE_10D9EE:
	RTS

DATA_10D9EF:
	dw $01C0,$01A0,$0164,$0144,$0156,$016E,$0192,$01AE

DATA_10D9FF:
	dw $07A0,$07A6,$07A6,$07A0,$079A,$0798,$0798,$079A

DATA_10DA0F:
	db $44,!REGISTER_Window1LeftPositionDesignation : dl $7E5B18

DATA_10DA14:
	db $E9,$D0,$56,$E9,$74,$58,$00

DATA_10DA1B:
	db $42,!REGISTER_BG1HorizScrollOffset : dl $7E5B98

DATA_10DA20:
	db $E9,$2C,$55,$E9,$FE,$55,$00

DATA_10DA27:
	db $42,!REGISTER_BG2HorizScrollOffset : dl $7E5C18

DATA_10DA2C:
	db $E9,$40,$50,$E9,$12,$51,$00

;-------------------------------------------------------------------------
; CODE_gm38_load_intro_cutscene -- Game mode $38: LoadIntroCutscene (raid: CODE_gm38_load_intro_cutscene).
; Loads tilesets/palettes/sprite tables for the intro storybook sequence
; (the "Once upon a time..." baby-delivery animation). After load, advances
; to gamemode $39 to run the per-frame cinematic.
;-------------------------------------------------------------------------
CODE_gm38_load_intro_cutscene:
CODE_10DA33:
	JSL.l CODE_init_oam_and_bg3_tilemap
	JSL.l CODE_prepare_in_level_states
	JSL.l CODE_clear_all_sprites
	REP.b #$20
	LDY.b #$00
	STZ.b $21
	LDA.w #$000392
	STA.b $20
	LDA.w #$022E
	JSL.l CODE_dma_init_gen_purpose
	STZ.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	REP.b #$10
	LDA.w #$000A					; intro storybook uses translevel/tile-slot $0A
	ASL
	TAX
	LDA.l YI_LevelDataPtrsAndEntranceData_DATA_17F3E7,x	; -> byte offset into entrance records
	TAX
	LDA.l YI_LevelDataPtrsAndEntranceData_DATA_17F471,x	; record byte +0 = level-data ID (Ptrs key)
	AND.w #$00FF
	ASL
	STA.b $00
	ASL
	ADC.b $00					; X = level-data ID x6
	TAX
	LDA.l YI_LevelDataPtrsAndEntranceData_Ptrs,x
	STA.b !RAM_YI_Level_LevelDataPtrLo
	LDA.l YI_LevelDataPtrsAndEntranceData_Ptrs+$01,x
	STA.b !RAM_YI_Level_LevelDataPtrHi
	LDA.l YI_LevelDataPtrsAndEntranceData_Ptrs+$03,x
	STA.l !EXRAM_YI_Level_SpriteDataPtrLo
	LDA.l YI_LevelDataPtrsAndEntranceData_Ptrs+$05,x
	STA.l !EXRAM_YI_Level_SpriteDataPtrBank
	SEP.b #$20
	LDA.b #$23
	STA.b $10
	STA.b $11
	STA.b $12
	LDA.b #$B1
	STA.b $13
	LDA.b #$B2
	STA.b $14
	LDA.b #$1A
	STA.b $15
	LDA.b #$17
	STA.b $16
	LDA.b #$AB
	STA.b $17
	STA.w $6EB6
	LDA.b #$AC
	STA.b $18
	STA.w $6EB7
	LDA.b #$1A
	STA.b $19
	STA.w $6EB8
	STA.b $1A
	STA.w $6EB9
	STA.b $1B
	STA.w $6EBA
	STA.b $1C
	STA.w $6EBB
	REP.b #$10
	LDY.w #$0000
	JSL.l CODE_load_compressed_gfx_files_l
	REP.b #$30
	LDA.w #$00A8
	LDX.w #$5800
	JSL.l CODE_00B756
	LDX.w #$3800
	JSR.w CODE_10DC71
	LDA.w #$00A9
	LDX.w #$5800
	JSL.l CODE_00B756
	LDX.w #$3400
	JSR.w CODE_10DC71
	REP.b #$30
	LDX.w #$0000
CODE_10DAF8:
	LDA.w #$7FFF
	STA.l YI_Global_PaletteMirror[$00].LowByte,x
	STA.l $702D6C,x
	LDA.l DATA_5FEC4A,x
	STA.l $702F6C,x
	LDA.l DATA_5FED4A,x
	STA.l $70306C,x
	STA.l YI_Global_PaletteMirror[$80].LowByte,x
	STA.l $702E6C,x
	INX
	INX
	CPX.w #$0100
	BCC.b CODE_10DAF8
	SEP.b #$30
	LDX.b #$04
	JSL.l CODE_init_scene_regs
	LDA.b #$68
	STA.w !RAM_YI_Global_BG1AddressAndSize
	LDX.b #$04
CODE_10DB31:
	LDA.w DATA_10DA0F,x
	STA.w HDMA[$05].Parameters,x
	LDA.w DATA_10DA1B,x
	STA.w HDMA[$06].Parameters,x
	LDA.w DATA_10DA27,x
	STA.w HDMA[$07].Parameters,x
	DEX
	BPL.b CODE_10DB31
	LDA.b #$7E
	STA.w HDMA[$05].IndirectSourceBank
	STA.w HDMA[$06].IndirectSourceBank
	STA.w HDMA[$07].IndirectSourceBank
	LDX.b #$06
CODE_10DB53:
	LDA.w DATA_10DA14,x
	STA.l $7E5B18,x
	LDA.w DATA_10DA20,x
	STA.l $7E5B98,x
	LDA.w DATA_10DA2C,x
	STA.l $7E5C18,x
	DEX
	BPL.b CODE_10DB53
	JSL.l CODE_copy_division_lookup_to_sram
	LDX.b #$11
	JSL.l CODE_set_level_music
	JSL.l CODE_load_level_object_stream
	REP.b #$20
	LDA.w #$0720
	STA.w $0C27
	STA.b !RAM_YI_Global_Layer1YPosLo
	STA.w $60A6
	STA.b !RAM_YI_Global_Layer2YPosLo
	STA.w $609E
	STA.b !RAM_YI_Global_Layer3YPosLo
	STA.w $60A0
	LDA.w #$0000
	STA.b !RAM_YI_Global_Layer1XPosLo
	SEC
	SBC.w #$0100
	STA.w $60A4
	SEP.b #$20
	INC.w $038C
	JSL.l CODE_108FD6
	STZ.w $038C
	REP.b #$20
	LDA.w #$0040
	STA.w $0C23
	STA.b !RAM_YI_Global_Layer2XPosLo
	STA.b !RAM_YI_Global_Layer3XPosLo
	STA.w $6096
	STA.w $6098
	LDA.w #!Define_YI_Level_SoftMaxStarTimerThreshold
	STA.w !RAM_YI_Level_StarTimerLo
	LDA.w #$0003
	STA.w $03A1
	LDA.w #$000F
	STA.w !RAM_YI_Level_LevelHeaderBGScrollSettingLo
	LDA.w #$0001
	STA.w $0C1E
	STA.w $0C20
	LDA.w #$0180
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w #$0790
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	JSL.l CODE_04DC28
	LDA.b #$10
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	LDA.b #$03
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	REP.b #$20
	STZ.w $61B2
	LDA.w #!Define_YI_PlayerState1C_Prologue
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$0002
	STA.w $60C4
	LDX.b #$0E
CODE_10DC05:
	LDA.w #$012D
	JSL.l CODE_spawn_sprite_init
	LDA.w DATA_10D9EF,x
	STA.w $70E2,y
	LDA.w DATA_10D9FF,x
	STA.w $7182,y
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	SEC
	SBC.w #$0004
	CMP.w #$0008
	BCS.b CODE_10DC2B
	LDA.w #$0002
	STA.w $7400,y
CODE_10DC2B:
	TXA
	LSR
	DEC
	LSR
	BNE.b CODE_10DC37
	LDA.w #$0002
	STA.w $74A2,y
CODE_10DC37:
	DEX
	DEX
	BPL.b CODE_10DC05
	LDA.w #$01F0
	STA.w $7E1A
	SEP.b #$20
	LDA.b #$01
	STA.b !RAM_YI_Global_PlayMusicLo
	STZ.w $0121
	LDA.b #$02
	STA.w $0125
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$D8
	STA.w !REGISTER_VCountTimerLo
	LDA.b #$B1
	STA.w !REGISTER_IRQNMIAndJoypadEnableFlags
	LDA.b #$0F
	STA.w $0200
	LDA.w $0201
	EOR.b #$01
	AND.b #$01
	STA.w $0201
	JML.l CODE_increment_gamemode

CODE_10DC71:
	STX.b $00
	SEP.b #$10
	STA.w DMA[$00].SizeLo
	LDX.b #$80
CODE_10DC7A:
	STX.w !REGISTER_VRAMAddressIncrementValue
	LDA.b $00
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #$705800
	STA.w DMA[$00].SourceLo
	LDX.b #$705800>>16
	STX.w DMA[$00].SourceBank
	LDX.b #$01
	STX.w !REGISTER_DMAEnable
	REP.b #$10
	RTS

;-------------------------------------------------------------------------
; DATA_intro_cutscene_phase_ptrs -- Intro-cutscene sub-phase pointer table (9 entries).
; Indexed by $7E:0D27 in CODE_gm39_intro_cutscene. Each entry is one phase
; of the storybook intro (text scroll, stork delivery, Bowser kidnap,
; etc.). Multiple slots share CODE_10DD7C (the "wait for next page"
; spinner) since several phases use the same idle handler.
;-------------------------------------------------------------------------
DATA_intro_cutscene_phase_ptrs:
DATA_10DC9B:
	dw CODE_10DCF0
	dw CODE_10DD7C
	dw CODE_10DD4C
	dw CODE_10DD7C
	dw CODE_10DD60
	dw CODE_10DD61
	dw CODE_10DD6E
	dw CODE_10DD7C
	dw CODE_10DD60

;-------------------------------------------------------------------------
; CODE_gm39_intro_cutscene -- Game mode $39: IntroCutscene (raid: CODE_gm39_intro_cutscene).
; Per-frame driver for the prologue. Steps through Yoshi/Mario stork
; sub-sequences via dispatch table; coordinates BG scroll and BRR music.
;-------------------------------------------------------------------------
CODE_gm39_intro_cutscene:
CODE_10DCAD:					; Note: Routine related to the prologue Yoshis
	JSL.l CODE_init_oam_buffer
	LDA.w $0D27
	ASL
	TAX
	JSR.w (DATA_intro_cutscene_phase_ptrs,x)
	REP.b #$20
	LDA.w #$0081
	STA.w $7E20
	SEP.b #$20
	JSL.l CODE_04FD28
	JSL.l CODE_0394D3
	JSL.l CODE_04FA67
	JSL.l CODE_04DD9E
	JSL.l CODE_0397DF
	REP.b #$20
	LDX.b #FXCODE_08B1EF>>16
	LDA.w #FXCODE_08B1EF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.b !RAM_YI_Global_Layer1XPosLo
	STA.b !RAM_YI_Global_Layer3XPosLo
	STA.w $6098
	SEP.b #$20
	JSR.w CODE_10DDC3
	PLB
	RTL

CODE_10DCF0:
	LDA.b $30
	AND.b #$01
	BNE.b CODE_10DD4B
	REP.b #$20
	LDA.w $0C23
	CMP.w #$0100
	BCS.b CODE_10DD01
	INC
CODE_10DD01:
	STA.w $0C23
	STA.b !RAM_YI_Global_Layer2XPosLo
	STA.w $6096
	SEP.b #$20
	INC.w $0D29
	LDA.w $0D29
	AND.b #$07
	BNE.b CODE_10DD4B
	LDA.l $70336C
	CMP.b #$20
	BCC.b CODE_10DD30
	LDA.b #$00
	STA.l $70336C
	INC.w $0D27
	INC.w !RAM_YI_Level_MessageBoxState 
	LDA.b #$30
	STA.w $0D29
	BRA.b CODE_10DD4B

CODE_10DD30:
	REP.b #$20
	LDA.w #$2D6C
	STA.l $70336E
	LDA.w #$2F6C
	STA.l $703370
	LDX.b #FXCODE_08B4A9>>16
	LDA.w #FXCODE_08B4A9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
CODE_10DD4B:
	RTS

CODE_10DD4C:
	LDA.b #$22
	STA.l $704070
	JSR.w CODE_10DD88
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_10DD5F
	LDA.b #$40
	STA.w $0D29
CODE_10DD5F:
	RTS

CODE_10DD60:
	RTS

CODE_10DD61:
	INC.w !RAM_YI_Level_MessageBoxState 
	LDA.b #$23
	STA.l $704070
	INC.w $0D27
	RTS

CODE_10DD6E:
	JSR.w CODE_10DD88
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_10DD7B
	LDA.b #$30
	STA.w $0D29
CODE_10DD7B:
	RTS

CODE_10DD7C:
	DEC.w $0D29
	BNE.b CODE_10DD87
	STZ.w $0D29
	INC.w $0D27
CODE_10DD87:
	RTS

CODE_10DD88:
	JSL.l CODE_message_box_handler_entry
	LDA.b #$20
	TSB.w !RAM_YI_Global_HDMAEnable
	LDA.b #$00
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_10DDA9
	INC.w $0D27
	LDA.w !RAM_YI_Global_HDMAEnable
	EOR.b #$20
	STA.w !RAM_YI_Global_HDMAEnable
CODE_10DDA9:
	RTS

DATA_10DDAA:
	db $00,$40,$01,$57,$07,$00,$00,$01,$B7,$07,$00,$80,$02,$00,$08

DATA_10DDB9:
	db $00,$80,$01,$47,$07,$00,$00,$02,$00,$08

CODE_10DDC3:
	REP.b #$20
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $6000
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.b !RAM_YI_Global_Layer1YPosLo
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #DATA_10DDAA
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #DATA_10DDAA>>16
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$385E
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_08DC4D>>16
	LDA.w #FXCODE_08DC4D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$01A4
	JSL.l CODE_queue_dma_3args_plus_a	: dl $7E552C,$70385E
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $6000
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.b !RAM_YI_Global_Layer2YPosLo
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #DATA_10DDB9
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #DATA_10DDB9>>16
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$3516
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_08DC4D>>16
	LDA.w #FXCODE_08DC4D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$01A4
	JSL.l CODE_queue_dma_3args_plus_a	: dl $7E5040,$703516
	SEP.b #$20
	LDA.b #$C0
	TSB.w !RAM_YI_Global_HDMAEnable
	RTS

;-------------------------------------------------------------------------
; CODE_gm3f_load_game_over -- Game mode $3F: LoadGameOver (raid: CODE_gm3f_load_game_over).
; One-shot setup for the GAME OVER screen: clears VRAM, decompresses the
; large GAME OVER letter graphic, primes palette fade, and arms the
; per-frame handler (gamemode $40).
;-------------------------------------------------------------------------
CODE_gm3f_load_game_over:
CODE_10DE3F:
	JSL.l CODE_init_oam_and_bg3_tilemap
	JSL.l CODE_clear_basic_states
	JSL.l CODE_clear_all_sprites
	JSL.l CODE_init_oam_buffer
	LDX.b #$04
	JSL.l CODE_init_scene_regs
	LDA.b #$10
	STA.w !RAM_YI_Global_MainScreenLayers
	STZ.w !RAM_YI_Global_SubScreenLayers
	LDA.b #$22
	STA.w !RAM_YI_Global_OAMSizeAndDataAreaDesignation
	STA.w !REGISTER_OAMSizeAndDataAreaDesignation
	STZ.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDA.w #FXDATA_514986
	STA.l $704096
	LDA.w #FXDATA_514986>>16
	STA.l $704098
	LDX.b #FXCODE_09B03E>>16
	LDA.w #FXCODE_09B03E
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$4000
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #$705800
	STA.w DMA[$00].SourceLo
	LDY.b #$705800>>16
	STY.w DMA[$00].SourceBank
	LDA.w #$2000
	STA.w DMA[$00].SizeLo
	LDX.b #$01
	STX.w !REGISTER_DMAEnable
	LDA.w #$0000
	STA.w $0948
	STA.l YI_Global_PaletteMirror[$00].LowByte
	TAX
CODE_10DEAE:
	STA.l YI_Global_PaletteMirror[$90].LowByte,x
	INX
	INX
	CPX.b #$20
	BCC.b CODE_10DEAE
	LDA.w #$0000
	STA.l $70336C
	LDX.b #$00
CODE_10DEC1:
	STZ.w !RAM_YI_Level_LevelHeaderBackgroundColorLo,x
	INX
	INX
	CPX.b #$1C
	BCC.b CODE_10DEC1
	LDX.b #$00
CODE_10DECC:
	STZ.w $6C00,x
	STZ.w $6D00,x
	STZ.w $6D20,x
	DEX
	DEX
	BNE.b CODE_10DECC
	LDA.w #$0018
	STA.b $A1
	LDA.w #$0060
	STA.b $B1
	LDX.b #$00
CODE_10DEE5:
	LDA.b $B1,x
	STA.b $B3,x
	LDA.b $A1,x
	CLC
	ADC.w #$0018
	STA.b $A3,x
	INX
	INX
	CPX.b #$08
	BCC.b CODE_10DEE5
	CLC
	ADC.w #$0010
	STA.b $A1,x
CODE_10DEFD:
	LDA.b $B1,x
	STA.b $B3,x
	LDA.b $A1,x
	CLC
	ADC.w #$0018
	STA.b $A3,x
	INX
	INX
	CPX.b #$0E
	BCC.b CODE_10DEFD
	STZ.b $C3
	LDA.w #$0800
	STA.b $C5
	LDA.w #$0100
	STA.b $C8
	LDX.b #$07
CODE_10DF1D:
	LDA.w #$FFFF
CODE_10DF20:
	DEC
	BNE.b CODE_10DF20
	DEX
	BNE.b CODE_10DF1D
	SEP.b #$20
	LDA.b #$02
	STA.w $0125
	STZ.w !RAM_YI_Global_HDMAEnable
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$D8
	STA.w !REGISTER_VCountTimerLo
	LDA.b #$B1
	STA.w !REGISTER_IRQNMIAndJoypadEnableFlags
	LDA.b #$04
	STA.w !RAM_YI_Global_PlayMusicLo
	INC.w !RAM_YI_Global_CurrentGameMode
	BRA.b CODE_10DF5C

;-------------------------------------------------------------------------
; DATA_game_over_phase_ptrs -- Game-over sub-phase pointer table (5 entries).
; Indexed by $7E:008F in CODE_gm40_game_over. Phases: 0 = wait, 1 = fade
; palette, 2 = listen for START/SELECT, 3 = scroll quit prompt,
; 4 = transition back to title.
;-------------------------------------------------------------------------
DATA_game_over_phase_ptrs:
DATA_10DF49:
	dw CODE_10DF6B
	dw CODE_10DF82
	dw CODE_10DFBB
	dw CODE_10E17C
	dw CODE_10E199

;-------------------------------------------------------------------------
; CODE_gm40_game_over -- Game mode $40: GameOver (raid: CODE_gm40_game_over).
; Per-frame GAME OVER main loop. Animates the falling-letter effect, runs
; the slow palette fade, listens for START to return to title.
;-------------------------------------------------------------------------
CODE_gm40_game_over:
CODE_10DF53:
	JSL.l CODE_init_oam_buffer
	LDX.b $8F
	JSR.w (DATA_game_over_phase_ptrs,x)
CODE_10DF5C:
	REP.b #$20
	LDX.b #FXCODE_08B1EF>>16
	LDA.w #FXCODE_08B1EF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	PLB
	RTL

CODE_10DF6B:
	REP.b #$20
	INC.w $00CA
	LDA.w $00CA
	CMP.w #$0200
	BCC.b CODE_10DF7C
	INC.b $8F
	INC.b $8F
CODE_10DF7C:
	SEP.b #$20
	JSR.w CODE_10DFE7
	RTS

CODE_10DF82:
	REP.b #$20
	LDA.l YI_Global_PaletteMirror[$93].LowByte
	CLC
	ADC.w #$0842
	BPL.b CODE_10DF95
	INC.b $8F
	INC.b $8F
	LDA.w #$7FFF
CODE_10DF95:
	STA.l YI_Global_PaletteMirror[$93].LowByte
	SEP.b #$20
	JSR.w CODE_10DFE7
	RTS

DATA_10DF9F:
	db $15,$01,$16,$04,$17,$18,$04,$19

DATA_10DFA7:
	db $10,$30,$50,$70,$10,$30,$50,$70

DATA_10DFAF:
	db $50,$50,$50,$50,$70,$70,$70,$70

DATA_10DFB7:
	dw !Define_YI_SoundID43_MountYoshi,!Define_YI_SoundID2E_ClankSound7

CODE_10DFBB:
	LDA.b $37
	AND.b #$C0
	ORA.b $38
	AND.b #$D0
	BEQ.b CODE_10DFD5
	INC.b $8F
	INC.b $8F
	LDA.b #$5C
	LDX.w $00C3
	LDA.w DATA_10DFB7,x
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	BRA.b CODE_10DFE7

CODE_10DFD5:
	LDA.b $38
	AND.b #$03
	BEQ.b CODE_10DFE7
	LDA.b $C3
	EOR.b #$02
	AND.b #$02
	STA.b $C3
	LDA.b #!Define_YI_SoundID5C_ScrollTextbox
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
CODE_10DFE7:
	REP.b #$20
	LDA.w #$6800
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0800
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08D2F1>>16
	LDA.w #FXCODE_08D2F1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b #$00
	LDY.b #$07
CODE_10E002:
	LDA.w DATA_10DF9F,y
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $91,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $99,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w DATA_10DFA7,y
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w DATA_10DFAF,y
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $C1
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	PHY
	PHX
	LDX.b #FXCODE_08F165>>16
	LDA.w #FXCODE_08F165
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	PLY
	INX
	DEY
	BPL.b CODE_10E002
	REP.b #$10
	LDY.w #$5000
	LDA.w #$706800>>16
	STA.b $01
	LDA.w #$1000
	LDX.w #$706800
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDA.w #$3100
	STA.b $04
	LDX.w #$0000
	LDY.w $6092
CODE_10E062:
	LDA.b $A1,x
	STA.w $6000,y
	LDA.b $B1,x
	STA.w $6002,y
	LDA.b $04
	STA.w $6004,y
	LDA.w #$4002
	STA.w $6006,y
	LDA.b $04
	INC
	INC
	INC
	INC
	BIT.w #$000F
	BNE.b CODE_10E085
	LDA.w #$3140
CODE_10E085:
	STA.b $04
	INX
	INX
	TYA
	CLC
	ADC.w #$0008
	TAY
	CPY.w #$0240
	BCC.b CODE_10E062
	JSR.w CODE_10E0FB
	STY.w $6092
	SEP.b #$10
	LDA.b $C1
	CMP.w #$0030
	BCS.b CODE_10E0A8
	INC
	STA.b $C1
	BRA.b CODE_10E0F4

CODE_10E0A8:
	SEP.b #$20
	LDX.b #$00
	STZ.b $00
CODE_10E0AE:
	LDA.b $C6
	BNE.b CODE_10E0B8
	LDA.b $91,x
	BEQ.b CODE_10E0C1
	LDA.b #$01
CODE_10E0B8:
	CLC
	ADC.b $91,x
	STA.b $91,x
	ORA.b $00
	STA.b $00
CODE_10E0C1:
	LDA.b $C6
	BNE.b CODE_10E0CB
	LDA.b $99,x
	BEQ.b CODE_10E0D0
	LDA.b #$01
CODE_10E0CB:
	CLC
	ADC.b $99,x
	STA.b $99,x
CODE_10E0D0:
	INX
	CPX.b #$08
	BCC.b CODE_10E0AE
	REP.b #$20
	LDA.b $C5
	SEC
	SBC.w #$0010
	BPL.b CODE_10E0F2
	LDA.w #$0000
	LDX.b $00
	BNE.b CODE_10E0F4
	DEC.b $C8
	BNE.b CODE_10E0F2
	LDA.w #$0100
	STA.b $C8
	LDA.w #$0800
CODE_10E0F2:
	STA.b $C5
CODE_10E0F4:
	SEP.b #$20
	RTS

DATA_10E0F7:
	dw $0050,$007E

CODE_10E0FB:
	LDX.b $C3
	LDA.w DATA_10E0F7,x
	STA.w $6000,y
	STA.w $6008,y
	LDA.w #$00C0
	STA.w $6002,y
	STA.w $6012,y
	CLC
	ADC.w #$0008
	STA.w $600A,y
	LDA.w #$32A0
	STA.w $6004,y
	ORA.w #$0010
	STA.w $600C,y
	LDA.w #$4000
	STA.w $6006,y
	STA.w $600E,y
	TYA
	CLC
	ADC.w #$0010
	TAY
	LDA.w #$0048
	STA.b $00
	LDA.w #$3220
	STA.b $02
	LDX.w #$0006
CODE_10E13E:
	LDA.b $00
	STA.w $6000,y
	STA.w $6008,y
	CLC
	ADC.w #$0010
	STA.b $00
	LDA.w #$0090
	STA.w $6002,y
	CLC
	ADC.w #$0020
	STA.w $600A,y
	LDA.b $02
	STA.w $6004,y
	CLC
	ADC.w #$0040
	STA.w $600C,y
	LDA.w #$4002
	STA.w $6006,y
	STA.w $600E,y
	INC.b $02
	INC.b $02
	TYA
	CLC
	ADC.w #$0010
	TAY
	DEX
	BNE.b CODE_10E13E
	RTS

CODE_10E17C:
	JSR.w CODE_10DFE7
	LDA.b $C3
	BNE.b CODE_10E18F
	LDA.b #!Define_YI_GameMode1F
	STA.w !RAM_YI_Global_CurrentGameMode
	LDA.b #$03
	STA.w !RAM_YI_Level_CurrentLifeCountLo
	BRA.b CODE_10E198

CODE_10E18F:
	DEC.w $0200
	BNE.b CODE_10E198
	INC.b $8F
	INC.b $8F
CODE_10E198:
	RTS

CODE_10E199:
	STZ.w !REGISTER_IRQNMIAndJoypadEnableFlags
	LDX.b #$10
	JSL.l CODE_set_level_music
	STZ.w $011A
	LDA.b #$80
	STA.w $012B
	STZ.w !RAM_YI_Level_FinalWorldUnlockedFlagLo
	STZ.w $0217
	STZ.w $0200
	STZ.w $0201
	LDA.b #!Define_YI_GameMode09
	STA.w !RAM_YI_Global_CurrentGameMode
	LDA.b #$B1
	STA.w !REGISTER_IRQNMIAndJoypadEnableFlags
	RTS

;-------------------------------------------------------------------------
; CODE_gm17_final_cinema_sequence -- Game mode $17: FinalCinemaSequence (raid: CODE_gm17_final_cinema_sequence).
; Triggered after Bowser is beaten. Sets current world to the FinalCutscene
; ID, marks the secret 6-stage row as unlocked, and advances gamemode.
;-------------------------------------------------------------------------
CODE_gm17_final_cinema_sequence:
CODE_10E1C1:
	LDA.b #$FF
	STA.w $011A
	LDA.b #!Define_YI_WorldID_FinalCutscene
	STA.w !RAM_YI_Level_CurrentWorldLo
	INC.w !RAM_YI_Level_FinalWorldUnlockedFlagLo
	JML.l CODE_increment_gamemode

DATA_10E1D2:
	dw $5000,$47FF,$0000
	dw $FFFF

;-------------------------------------------------------------------------
; CODE_gm1b_load_credits -- Game mode $1B: LoadCredits (raid: CODE_gm1b_load_credits).
; Sets up the staff-roll: loads credits font + palette, primes the scroller
; queue, kicks off the credits BGM, then advances to gamemode $1C.
;-------------------------------------------------------------------------
CODE_gm1b_load_credits:
CODE_10E1DA:
	LDA.b #$24
	JSL.l CODE_008279
	JSL.l CODE_clear_basic_states
	REP.b #$10
	LDY.w #$01C3
	JSL.l CODE_load_compressed_gfx_files_l
	SEP.b #$20
	LDA.b #$81
	STA.w !REGISTER_VRAMAddressIncrementValue
	REP.b #$30
	LDA.w #$5084
	STA.b $00
	LDX.w #$0000
	LDA.w #$0018
	STA.b $02
CODE_10E203:
	LDA.b $00
	STA.w !REGISTER_VRAMAddressLo
	LDY.w #$0010
CODE_10E20B:
	STX.w !REGISTER_WriteToVRAMPortLo
	INX
	DEY
	BNE.b CODE_10E20B
	INC.b $00
	DEC.b $02
	BNE.b CODE_10E203
	LDX.w #$01FE
CODE_10E21B:
	LDA.l DATA_5FEE4A,x
	STA.l $701600,x
	STA.l $701800,x
	DEX
	DEX
	BPL.b CODE_10E21B
	LDX.w #$0006
CODE_10E22E:
	LDA.l $7017C2,x
	STA.w $0B93,x
	LDA.l $7017E2,x
	STA.w $0B9B,x
	DEX
	DEX
	BPL.b CODE_10E22E
	PHB
	LDY.w #$701200
	LDX.w #DATA_div_onebyx_lut
	LDA.w #$03FF
	MVN $701200>>16,DATA_div_onebyx_lut>>16
	PLB
	SEP.b #$30
	LDX.b #$26
	JSL.l CODE_init_scene_regs
	STZ.w !REGISTER_BG1HorizScrollOffset
	STZ.w !REGISTER_BG1HorizScrollOffset
	STZ.w !REGISTER_BG1VertScrollOffset
	STZ.w !REGISTER_BG1VertScrollOffset
	STZ.w !REGISTER_BG2HorizScrollOffset
	STZ.w !REGISTER_BG2HorizScrollOffset
	STZ.w !REGISTER_BG2VertScrollOffset
	STZ.w !REGISTER_BG2VertScrollOffset
	LDA.b #$03
	STA.w !RAM_YI_Global_OAMSizeAndDataAreaDesignation
	STA.w !REGISTER_OAMSizeAndDataAreaDesignation
	REP.b #$30
	LDX.w #$0402
CODE_10E27B:
	LDA.w DATA_10EA44,x
	STA.w $6CAA,x
	DEX
	DEX
	BPL.b CODE_10E27B
	LDA.w #$00C0
	STA.b $82
	LDA.w #$0CAA
	STA.b $7B
	SEP.b #$10
	LDA.w #$FFB0
	STA.b $73
	STZ.b $71
	LDA.w #$0030
	STA.w $0B91
	LDA.w #$0008
	STA.b $7E
	LDA.w #$03FC
	STA.b $80
	LDA.w #$0009
	STA.b $88
	JSR.w CODE_10E430
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $73
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $71
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.b $7B
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_09F03E>>16
	LDA.w #FXCODE_09F03E
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b #$80
	STX.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #$0000
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #$701C00
	STA.w DMA[$00].SourceLo
	LDX.b #$701C00>>16
	STX.w DMA[$00].SourceBank
	LDA.w #$6000
	STA.w DMA[$00].SizeLo
	LDX.b #$01
	STX.w !REGISTER_DMAEnable
	JSR.w CODE_10E430
	LDX.w $012E
	PHX
	LDX.b #!SuperFX_ScreenMode_ScreenHeight_160pixels|!SuperFX_ScreenMode_ColorMode_16Colors|!SuperFX_ScreenMode_SuperFXHasWRAMAccess|!SuperFX_ScreenMode_SuperFXHasROMAccess|!SuperFX_ScreenMode_ColorMode_Unused
	STX.w $012E
	LDX.b #FXCODE_09ECD8>>16
	LDA.w #FXCODE_09ECD8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	STX.w $012E
	LDA.w #$7000
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #$701C00
	STA.w DMA[$00].SourceLo
	LDX.b #$701C00>>16
	STX.w DMA[$00].SourceBank
	LDA.w #$2000
	STA.w DMA[$00].SizeLo
	LDX.b #$01
	STX.w !REGISTER_DMAEnable
	SEP.b #$20
	LDX.b #$13
	JSL.l CODE_set_level_music
	LDA.b #$01
	STA.b !RAM_YI_Global_PlayMusicLo
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$01
	STA.w !REGISTER_HCountTimerHi
	LDA.b #$D8
	STA.w !REGISTER_VCountTimerLo
	LDA.b #$B1
	STA.w !REGISTER_IRQNMIAndJoypadEnableFlags
	STZ.w $0200
	JML.l CODE_increment_gamemode

;-------------------------------------------------------------------------
; CODE_gm1c_credits_begin -- Game mode $1C: CreditsBegin (raid: CODE_gm1c_credits_begin).
; Bootstrap frame for the credits scroll: hands tilemap/HDMA setup off
; to the per-frame handler at gamemode $1D once first credits line is
; primed.
;-------------------------------------------------------------------------
CODE_gm1c_credits_begin:
CODE_10E357:
	LDA.b $8C
	AND.b #$03
	BNE.b CODE_10E360
	INC.w $0200
CODE_10E360:
	REP.b #$20
	INC.b $8C
	LDA.w $0200
	AND.w #$00FF
	CMP.w #$000F
	BCC.b CODE_10E3DD
	STZ.w $71AA
	INC.w !RAM_YI_Global_CurrentGameMode
	LDA.w $0201
	EOR.w #$0001
	AND.w #$0001
	STA.w $0201
	STZ.b $8C
	BRA.b CODE_10E3DD

;-------------------------------------------------------------------------
; DATA_credits_line_handler_ptrs -- Credits per-line handler pointer table.
; Indexed by $7E:0079 in CODE_gm1d_credits to select the renderer for each of
; the ~70 credit-roll lines (banner / role / name / spacer variants).
;-------------------------------------------------------------------------
DATA_credits_line_handler_ptrs:
DATA_10E385:
	dw CODE_10E44F
	dw CODE_10E478
	dw CODE_10E4B0
	dw CODE_10E530
	dw CODE_10E592
	dw CODE_10E5A8
	dw CODE_10E624
	dw CODE_10E66B
	dw CODE_10E692
	dw CODE_10E6C7
	dw CODE_10E592
	dw CODE_10E5A8
	dw CODE_10E6E7
	dw CODE_10E724
	dw CODE_10E735
	dw CODE_10E7AF
	dw CODE_10E7F1
	dw CODE_10E807
	dw CODE_10E7F1
	dw CODE_10E855
	dw CODE_10E7F1
	dw CODE_10E575
	dw CODE_10E8B8
	dw CODE_10E592
	dw CODE_10E5A8
	dw CODE_10E575
	dw CODE_10E8FB
	dw CODE_10E575
	dw CODE_10E922
	dw CODE_10E592
	dw CODE_10E5A8
	dw CODE_10E90C
	dw CODE_10E975
	dw CODE_10E992
	dw CODE_10E96B

;-------------------------------------------------------------------------
; CODE_gm1d_credits -- Game mode $1D: Credits (raid: CODE_gm1d_credits).
; Per-frame credits driver. Advances scroll position, fades each name line
; in/out, and on completion advances to gamemode $1E (post-credits demo).
;-------------------------------------------------------------------------
CODE_gm1d_credits:
CODE_10E3CB:
	REP.b #$20
	INC.b $8C
	LDA.w $0BD3
	BNE.b CODE_10E42C
	LDX.b $79
	CPX.b #$46
	BCS.b CODE_10E3DD
	JSR.w (DATA_credits_line_handler_ptrs,x)
CODE_10E3DD:
	LDA.b $79
	CMP.w #$0034
	BCS.b CODE_10E42C
	LDA.w $0BD3
	BNE.b CODE_10E42C
	JSR.w CODE_10E430
	LDA.b $6F
	CLC
	ADC.b $7E
	AND.w #$03FF
	STA.b $6F
	LDA.b $79
	CMP.w #$0014
	BCS.b CODE_10E400
	JSR.w CODE_10E9C9
CODE_10E400:
	LDA.b $77
	BEQ.b CODE_10E408
	CLC
	ADC.w #$0300
CODE_10E408:
	CLC
	ADC.b $6F
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $73
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $71
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.b $7B
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_09F03E>>16
	LDA.w #FXCODE_09F03E
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	LDA.b #$03
	STA.b $6B
CODE_10E42C:
	SEP.b #$20
	PLB
	RTL

CODE_10E430:
	LDA.w #$1C00
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0002
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STZ.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$3000
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08AA8B>>16
	LDA.w #FXCODE_08AA8B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	RTS

CODE_10E44F:
	DEC.w $0B91
	BNE.b CODE_10E458
	INC.b $79
	INC.b $79
CODE_10E458:
	RTS

DATA_10E459:
	db $1E,$3E,$3E,$1E,$3E,$3E,$3E,$3E,$3E,$1E,$3E,$3E,$1E,$3E,$1E,$3E
	db $3E,$1E,$3E,$1E,$3E,$3E,$3E,$3E,$3E,$3E,$3E,$1E,$3E,$1E,$3E

CODE_10E478:
	LDA.w $0B8F
	BEQ.b CODE_10E482
	LDA.w #$000C
	BRA.b CODE_10E494

CODE_10E482:
	LDA.w $0B8D
	CMP.w #$001F
	BCS.b CODE_10E49D
	TAX
	INC.w $0B8D
	LDA.w DATA_10E459,x
	AND.w #$00FF
CODE_10E494:
	STA.w $0B91
	DEC.b $79
	DEC.b $79
	BRA.b CODE_10E4A3

CODE_10E49D:
	INC.b $79
	INC.b $79
	BRA.b CODE_10E4AF

CODE_10E4A3:
	LDA.w $0B8F
	EOR.w #$0002
	AND.w #$0002
	STA.w $0B8F
CODE_10E4AF:
	RTS

CODE_10E4B0:
	LDA.w $0B8D
	CMP.w #$001F
	BCC.b CODE_10E4CB
	LDA.b $6F
	BNE.b CODE_10E4CB
	INC.b $79
	INC.b $79
	INC.b $78
	JSR.w CODE_10E4CC
	JSR.w CODE_10E511
	STZ.w $71AA
CODE_10E4CB:
	RTS

CODE_10E4CC:
	REP.b #$10
	LDA.w #$0000
	TAX
CODE_10E4D2:
	STA.l $701A00,x
	INX
	INX
	CPX.w #$0200
	BNE.b CODE_10E4D2
	LDX.w #$0006
CODE_10E4E0:
	LDA.l $7019C2,x
	STA.l $701BC2,x
	LDA.l $7019E2,x
	STA.l $701BE2,x
	DEX
	DEX
	BPL.b CODE_10E4E0
	SEP.b #$10
	RTS

DATA_10E4F7:
	dw $0000,$569C,$28F1,$0006,$5B9F,$2DF6,$004D,$6FDF

DATA_10E507:
	dw $0000,$679F,$1D51,$6FD9,$2144

CODE_10E511:
	LDX.b #$00
CODE_10E513:
	LDA.w DATA_10E4F7,x
	STA.l $701AA2,x
	INX
	INX
	CPX.b #$10
	BCC.b CODE_10E513
	LDX.b #$00
CODE_10E522:
	LDA.w DATA_10E507,x
	STA.l $701AC2,x
	INX
	INX
	CPX.b #$0A
	BCC.b CODE_10E522
	RTS

CODE_10E530:
	LDA.w $71AA
	CMP.w #$0020
	BCS.b CODE_10E555
	LDA.w #$1800
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$1A00
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$1600
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_09F64E>>16
	LDA.w #FXCODE_09F64E
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_10E574

CODE_10E555:
	INC.b $79
	INC.b $79
	STZ.w $71AA
	PHB
	LDX.b #$701600>>16
	PHX
	PLB
	LDX.b #$00
CODE_10E563:
	LDA.w $701600,x
	STA.w $701800,x
	LDA.w $701700,x
	STA.w $701900,x
	INX
	INX
	BNE.b CODE_10E563
	PLB
CODE_10E574:
	RTS

CODE_10E575:
	JSR.w CODE_10E530
	LDA.b $8C
	AND.w #$0001
	BNE.b CODE_10E587
	LDA.w $71AA
	BEQ.b CODE_10E587
	DEC.w $71AA
CODE_10E587:
	RTS

DATA_10E588:
	dw $01A7,$01A7,$021C,$021C,$021C

CODE_10E592:
	REP.b #$10
	LDY.b $84
	LDX.w DATA_10E588,y
	LDA.w #$6000
	BRA.b CODE_10E5B2

DATA_10E59E:
	dw $01A7,$01AA,$01AA,$01AA,$0039

CODE_10E5A8:
	REP.b #$10
	LDY.b $84
	LDX.w DATA_10E59E,y
	LDA.w #$6800
CODE_10E5B2:
	STA.w $0BD5
	LDA.l DATA_06FC79,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.l DATA_06FC79+$02,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0040
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	SEP.b #$10
	LDX.w $012E
	PHX
	LDX.b #!SuperFX_ScreenMode_ScreenHeight_160pixels|!SuperFX_ScreenMode_ColorMode_16Colors|!SuperFX_ScreenMode_SuperFXHasWRAMAccess|!SuperFX_ScreenMode_SuperFXHasROMAccess|!SuperFX_ScreenMode_ColorMode_Unused
	STX.w $012E
	LDX.b #FXCODE_0A8000>>16
	LDA.w #FXCODE_0A8000
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	STX.w $012E
	LDA.w #$1000
	STA.w $0BD7
	INC.w $0BD3
	INC.b $79
	INC.b $79
	STZ.b $69
	STZ.b $6B
	RTS

DATA_10E5F6:
	dw $00AB,$00AC,$00AD,$00AE

CODE_10E5FE:
	LDX.b $84
	LDA.w DATA_10E5F6,x
	LDX.w #$1C00
	JSL.l CODE_00B756
	SEP.b #$10
	LDA.w #$5CA0
	STA.w $0BD5
	LDA.w #$0300
	STA.w $0BD7
	INC.w $0BD3
	INC.b $84
	INC.b $84
	STZ.b $69
	STZ.b $6B
	RTS

CODE_10E624:
	REP.b #$10
	LDX.w #$0000
CODE_10E629:
	LDA.l DATA_5FF04A,x
	STA.l $701A00,x
	INX
	INX
	CPX.w #$0180
	BCC.b CODE_10E629
	LDX.w #$0006
CODE_10E63B:
	LDA.w DATA_10EE48,x
	STA.w $6CAA,x
	DEX
	DEX
	BPL.b CODE_10E63B
	JSR.w CODE_10E5FE
	SEP.b #$10
	LDA.w #$0000
	STA.b $82
	LDA.w #$0000
	STA.b $80
	STZ.b $6F
	STZ.b $73
	STZ.b $77
	STZ.b $7E
	LDA.w #$0060
	STA.b $75
	INC.b $79
	INC.b $79
	LDA.w #$FE30
	STA.b $86
	RTS

CODE_10E66B:
	JSR.w CODE_10E575
	LDA.w $71AA
	CMP.w #$0018
	BCC.b CODE_10E692
	LDA.w $0B8D
	CMP.w #$0020
	BEQ.b CODE_10E692
	LDA.w $0B8F
	EOR.w #$0002
	AND.w #$0002
	STA.w $0B8F
	INC.w $0B8D
	LDA.w #$000A
	STA.b $88
CODE_10E692:
	SEP.b #$20
	LDA.w $6CAD
	INC
	STA.w $6CAD
	REP.b #$20
	LDA.b $86
	BMI.b CODE_10E6BC
	CMP.w #$01B0
	BCC.b CODE_10E6BC
	JSR.w CODE_10E4CC
	JSR.w CODE_10E511
	INC.b $79
	INC.b $79
	LDA.w $0B8F
	EOR.w #$0002
	AND.w #$0002
	STA.w $0B8F
CODE_10E6BC:
	LDY.b $80
	LDA.b $86
	CLC
	ADC.w #$0008
	STA.b $86
	RTS

CODE_10E6C7:
	SEP.b #$20
	LDA.w $6CAD
	INC
	STA.w $6CAD
	LDA.w $6CAE
	BEQ.b CODE_10E6D9
	DEC
	STA.w $6CAE
CODE_10E6D9:
	REP.b #$20
	AND.w #$00FF
	CMP.w #$0010
	BCS.b CODE_10E6E6
	JSR.w CODE_10E575
CODE_10E6E6:
	RTS

CODE_10E6E7:
	REP.b #$10
	LDX.w #$0000
CODE_10E6EC:
	LDA.l DATA_5FF24A,x
	STA.l $701A00,x
	INX
	INX
	CPX.w #$0200
	BCC.b CODE_10E6EC
	LDX.w #$0048
CODE_10E6FE:
	LDA.w DATA_10EE50,x
	STA.w $6CAA,x
	DEX
	DEX
	BPL.b CODE_10E6FE
	JSR.w CODE_10E5FE
	SEP.b #$10
	STZ.b $6F
	STZ.b $77
	STZ.b $7E
	INC.b $79
	INC.b $79
	LDA.w #$0012
	STA.b $80
	STZ.b $75
	LDA.w #$0002
	STA.b !RAM_YI_Global_PlayMusicLo
	RTS

CODE_10E724:
	JSR.w CODE_10E575
	LDA.w $71AA
	CMP.w #$0008
	BCS.b CODE_10E730
	RTS

CODE_10E730:
	LDA.w #$0002
	STA.b $7E
CODE_10E735:
	SEP.b #$20
	LDA.b $6F
	AND.b #$02
	BNE.b CODE_10E761
	LDA.w $6CC4
	CLC
	ADC.b #$01
	STA.w $6CC4
	LDA.w $6CD0
	SEC
	SBC.b #$01
	STA.w $6CD0
	LDA.w $6CDC
	CLC
	ADC.b #$01
	STA.w $6CDC
	LDA.w $6CE8
	SEC
	SBC.b #$01
	STA.w $6CE8
CODE_10E761:
	LDA.w $6CE2
	CLC
	ADC.b #$01
	STA.w $6CE2
	LDA.w $6CEE
	SEC
	SBC.b #$01
	STA.w $6CEE
	LDA.w $6CCA
	CLC
	ADC.b #$01
	STA.w $6CCA
	LDA.w $6CD6
	SEC
	SBC.b #$01
	STA.w $6CD6
	LDA.w $6CCB
	SEC
	SBC.b #$01
	STA.w $6CCB
	STA.w $6CD7
	STA.w $6CE3
	STA.w $6CEF
	REP.b #$20
	LDA.b $6F
	CMP.w #$00A0
	BCC.b CODE_10E7A6
	INC.b $79
	INC.b $79
	STZ.b $7E
CODE_10E7A6:
	RTS

DATA_10E7A7:
	db $1A,$1B,$1C,$1D,$1E,$1F,$20,$1F

CODE_10E7AF:
	INC.b $75
	LDA.b $75
	CMP.w #$0010
	BCC.b CODE_10E7BD
	LDA.w #$0008
	STA.b $75
CODE_10E7BD:
	LSR
	TAY
	LDX.b $80
	SEP.b #$20
	LDA.w DATA_10E7A7,y
	STA.w $6CAF,x
	CPY.b #$04
	BCC.b CODE_10E7EE
	LDA.w $6CAD,x
	SEC
	SBC.b #$03
	STA.w $6CAD,x
	LDA.w $6CAC,x
	CLC
	ADC.b #$03
	STA.w $6CAC,x
	CMP.b #$48
	BCC.b CODE_10E7EE
	REP.b #$20
	LDA.w #$0040
	STA.b $75
	INC.b $79
	INC.b $79
CODE_10E7EE:
	REP.b #$20
	RTS

CODE_10E7F1:
	DEC.b $75
	BNE.b CODE_10E7FB
	INC.b $79
	INC.b $79
	STZ.b $75
CODE_10E7FB:
	RTS

DATA_10E7FC:
	db $21,$22,$23,$24,$25,$26,$27,$28,$29,$2A,$2B

CODE_10E807:
	SEP.b #$20
	INC.b $75
	LDA.b $75
	CMP.b #$0B
	BCC.b CODE_10E813
	LDA.b #$00
CODE_10E813:
	STA.b $75
	TAX
	LDA.w DATA_10E7FC,x
	STA.w $6CB5
	LDA.w $6CB2
	DEC
	DEC
	STA.w $6CB2
	AND.b #$02
	BNE.b CODE_10E83B
	LDA.w $6CB3
	DEC
	STA.w $6CB3
	CMP.b #$C0
	BNE.b CODE_10E83B
	INC.b $79
	INC.b $79
	LDA.b #$08
	STA.b $75
CODE_10E83B:
	REP.b #$20
	LDA.w #$0100
	CLC
	ADC.b $6F
	STA.w $6CB0
	RTS

DATA_10E847:
	dw CODE_10E877
	dw CODE_10E89B
	dw CODE_10E877
	dw CODE_10E89B
	dw CODE_10E89B
	dw CODE_10E89B
	dw CODE_10E877

CODE_10E855:
	LDA.b $75
	AND.w #$FFFE
	TAX
	JSR.w (DATA_10E847,x)
	INC.b $75
	LDA.b $75
	CMP.w #$000E
	BCC.b CODE_10E876
	JSR.w CODE_10E4CC
	JSR.w CODE_10E511
	INC.b $79
	INC.b $79
	LDA.w #$0010
	STA.b $75
CODE_10E876:
	RTS

CODE_10E877:
	LDA.w #$03FF
	STA.l $701610
	STA.l $701630
	STA.l $701650
	STA.l $701670
	STA.l $701810
	STA.l $701830
	STA.l $701850
	STA.l $701870
	RTS

CODE_10E89B:
	LDA.w #$1041
	STA.l $701610
	LDA.w #$1400
	STA.l $701630
	LDA.w #$1800
	STA.l $701650
	LDA.w #$1C00
	STA.l $701670
	RTS

CODE_10E8B8:
	REP.b #$10
	LDX.w #$0000
CODE_10E8BD:
	LDA.l DATA_5FF24A,x
	STA.l $701A00,x
	INX
	INX
	CPX.w #$0200
	BCC.b CODE_10E8BD
	LDX.w #$0000
CODE_10E8CF:
	LDA.l DATA_5FF44A,x
	STA.l $701A80,x
	INX
	INX
	CPX.w #$0020
	BCC.b CODE_10E8CF
	LDA.l DATA_5FF44A
	STA.l $701A00
	JSR.w CODE_10E5FE
	SEP.b #$10
	LDA.w #$0080
	STA.b $75
	LDA.w #$FFFF
	STA.w $6CAA
	INC.b $79
	INC.b $79
	RTS

CODE_10E8FB:
	DEC.b $75
	BNE.b CODE_10E90B
	JSR.w CODE_10E4CC
	JSR.w CODE_10E511
	INC.b $79
	INC.b $79
	STZ.b $75
CODE_10E90B:
	RTS

CODE_10E90C:
	JSR.w CODE_10E530
	LDA.w $71AA
	BEQ.b CODE_10E921
	DEC.w $71AA
	LDA.b $8C
	AND.w #$0002
	BNE.b CODE_10E921
	INC.w $71AA
CODE_10E921:
	RTS

CODE_10E922:
	REP.b #$10
	LDX.w #$0000
CODE_10E927:
	LDA.l DATA_5FF24A,x
	STA.l $701A00,x
	INX
	INX
	CPX.w #$0200
	BCC.b CODE_10E927
	JSR.w CODE_10E5FE
	LDA.w #$0340
	STA.w $0BD7
	SEP.b #$10
	LDX.b #$00
CODE_10E943:
	LDA.l DATA_5FF1CA,x
	STA.l $701A00,x
	INX
	INX
	CPX.b #$80
	BCC.b CODE_10E943
	LDA.w #$337F
	STA.l $701AB2
	STA.l $701AB4
	LDA.w #$0009
	STA.b $88
	LDA.w #$0030
	STA.b $75
	INC.b $79
	INC.b $79
	RTS

CODE_10E96B:
	LDA.b $75
	DEC
	BNE.b CODE_10E975
	LDA.w #$000A
	STA.b $88
CODE_10E975:
	DEC.b $75
	BNE.b CODE_10E991
	LDA.w $0B8F
	EOR.w #$0002
	AND.w #$0002
	STA.w $0B8F
	INC.w $0B8D
	INC.b $79
	INC.b $79
	LDA.w #$0170
	STA.b $75
CODE_10E991:
	RTS

CODE_10E992:
	DEC.b $75
	BNE.b CODE_10E9AB
	LDA.w $0B8F
	EOR.w #$0002
	AND.w #$0002
	STA.w $0B8F
	INC.b $79
	INC.b $79
	LDA.w #$0030
	STA.b $75
CODE_10E9AB:
	RTS

DATA_10E9AC:
	db $00,$01,$02,$03,$04,$05,$06,$07,$08,$09,$0A,$0B,$0C

DATA_10E9B9:
	db $0D,$8F,$12,$10

DATA_10E9BD:
	db $0E,$0D,$0E,$10

DATA_10E9C1:
	db $8F,$12,$10,$10

DATA_10E9C5:
	db $8F,$10,$10,$8F

CODE_10E9C9:
	REP.b #$10
	LDY.b $80
	LDA.b $86
	BNE.b CODE_10E9DC
	LDA.b $77
	BEQ.b CODE_10E9D9
	CLC
	ADC.w #$0300
CODE_10E9D9:
	CLC
	ADC.b $6F
CODE_10E9DC:
	STA.w $6CAA,y
	LDA.b $77
	BEQ.b CODE_10E9ED
	LDA.b $73
	BEQ.b CODE_10E9ED
	CLC
	ADC.w #$0002
	STA.b $73
CODE_10E9ED:
	INC.b $75
	LDA.b $75
	CMP.w #$000D
	BCC.b CODE_10E9F9
	LDA.w #$0000
CODE_10E9F9:
	STA.b $75
	TAX
	SEP.b #$20
	LDA.b $71
	STA.w $6CAC,y
	LDA.b $73
	BEQ.b CODE_10EA0A
	STA.w $6CAD,y
CODE_10EA0A:
	LDA.w DATA_10E9AC,x
	CLC
	ADC.b $82
	STA.w $6CAF,y
	SEP.b #$30
	LDA.b $84
	BNE.b CODE_10EA41
	LDA.b $70
	BNE.b CODE_10EA41
	LDA.b $6F
	BNE.b CODE_10EA41
	LDA.b $8A
	INC
	AND.b #$03
	STA.b $8A
	TAX
	LDA.w DATA_10E9B9,x
	STA.w $6EE9
	LDA.w DATA_10E9BD,x
	STA.w $6E65
	LDA.w DATA_10E9C1,x
	STA.w $6E8F
	LDA.w DATA_10E9C5,x
	STA.w $6E2F
CODE_10EA41:
	REP.b #$20
	RTS

DATA_10EA44:
	dw $05C0,$E872,$1040,$05C0,$E044,$1040,$05C0,$E216
	dw $1040,$05C0,$D8E8,$1040,$05C0,$E8BA,$1040,$05C0
	dw $E08C,$1040,$05A0,$2600,$9440,$0580,$E062,$1040
	dw $0580,$D834,$1040,$0580,$E806,$1040,$0580,$D8D8
	dw $1040,$0580,$E0AA,$1040,$057C,$0210,$1040,$057C
	dw $06EC,$1040,$0578,$0A26,$1040,$0578,$0DD7,$1040
	dw $0570,$24B9,$1040,$0570,$2452,$1040,$0568,$1416
	dw $1040,$0568,$1CE8,$1040,$0568,$0CC0,$1240,$0560
	dw $1E44,$1040,$0560,$24BA,$1040,$055C,$1A00,$1240
	dw $0558,$1A5F,$1040,$0558,$1AAC,$1040,$0540,$E27F
	dw $1040,$0540,$D851,$1040,$0540,$E023,$1040,$0540
	dw $E8F5,$1040,$0540,$E0C7,$1040,$0540,$D899,$1040
	dw $0500,$D872,$1040,$0500,$DE44,$1040,$0500,$E816
	dw $1040,$0500,$E0E8,$1040,$0500,$D8BA,$1040,$0500
	dw $E28C,$1040,$04C0,$E872,$1040,$04C0,$E044,$1040
	dw $04C0,$E216,$1040,$04C0,$D8E8,$1040,$04C0,$E8BA
	dw $1040,$04C0,$E08C,$1040,$0480,$E062,$1040,$0480
	dw $D834,$1040,$0480,$F006,$1040,$0480,$D8D8,$1040
	dw $0480,$E0AA,$1040,$0470,$D8F8,$1240,$0440,$E27F
	dw $1040,$0440,$D851,$1040,$0440,$E023,$1040,$0440
	dw $E8F5,$1040,$0440,$E0C7,$1040,$0440,$D899,$1040
	dw $0400,$D872,$1040,$0400,$DE44,$1040,$0400,$E816
	dw $1040,$0400,$E0E8,$1040,$0400,$D8BA,$1040,$0400
	dw $E28C,$1040,$03E0,$A060,$1240,$03E0,$B0A0,$1240
	dw $03E0,$E020,$8F30,$03C0,$D87F,$1040,$03C0,$E051
	dw $1040,$03C0,$E823,$1040,$03C0,$D8F5,$1040,$03C0
	dw $D2C7,$1040,$03C0,$E899,$1040,$03A0,$9090,$1340
	dw $03A0,$B070,$1240,$03A0,$E010,$0E40,$0380,$F062
	dw $1040,$0380,$E034,$1040,$0380,$D806,$1040,$0380
	dw $DED8,$1040,$0380,$E8AA,$1040,$0380,$E670,$1140
	dw $0360,$F0E0,$8F40,$0340,$E872,$1040,$0340,$E044
	dw $1040,$0340,$E216,$1040,$0340,$D8E8,$1040,$0340
	dw $E8BA,$1040,$0340,$E08C,$1040,$0320,$9000,$1340
	dw $0300,$E062,$1040,$0300,$D834,$1040,$0300,$F006
	dw $1040,$0300,$D8D8,$1040,$0300,$E0AA,$1040,$02E0
	dw $A060,$1240,$02E0,$B0E0,$1240,$02E0,$00C0,$0D40
	dw $02C0,$E27F,$1040,$02C0,$D851,$1040,$02C0,$E023
	dw $1040,$02C0,$E8F5,$1040,$02C0,$E0C7,$1040,$02C0
	dw $D899,$1040,$02C0,$D67F,$1140,$02A0,$B030,$1240
	dw $0280,$D872,$1040,$0280,$DE44,$1040,$0280,$E816
	dw $1040,$0280,$E0E8,$1040,$0280,$D8BA,$1040,$0280
	dw $E28C,$1040,$0280,$D68C,$1140,$0260,$9050,$1340
	dw $0240,$D87F,$1040,$0240,$E051,$1040,$0240,$E823
	dw $1040,$0240,$D8F5,$1040,$0240,$D2C7,$1040,$0240
	dw $E899,$1040,$0200,$F062,$1040,$0200,$E034,$1040
	dw $0200,$D806,$1040,$0200,$DED8,$1040,$0200,$E8AA
	dw $1040,$01C0,$E872,$1040,$01C0,$E044,$1040,$01C0
	dw $E216,$1040,$01C0,$D8E8,$1040,$01C0,$E8BA,$1040
	dw $01C0,$E08C,$1040,$0180,$E062,$1040,$0180,$D834
	dw $1040,$0180,$E806,$1040,$0180,$D8D8,$1040,$0180
	dw $E0AA,$1040,$0140,$E27F,$1040,$0140,$D851,$1040
	dw $0140,$E023,$1040,$0140,$E8F5,$1040,$0140,$E0C7
	dw $1040,$0140,$D899,$1040,$0100,$D872,$1040,$0100
	dw $DE44,$1040,$0100,$E816,$1040,$0100,$E0E8,$1040
	dw $0100,$D8BA,$1040,$0100,$E28C,$1040,$00C0,$E872
	dw $1040,$00C0,$E044,$1040,$00C0,$E216,$1040,$00C0
	dw $D8E8,$1040,$00C0,$E8BA,$1040,$00C0,$E08C,$1040
	dw $0080,$E062,$1040,$0080,$D834,$1040,$0080,$F006
	dw $1040,$0080,$D8D8,$1040,$0080,$E0AA,$1040,$0070
	dw $D8F8,$1240,$0040,$E27F,$1040,$0040,$D851,$1040
	dw $0040,$E023,$1040,$0040,$E8F5,$1040,$0040,$E0C7
	dw $1040,$0040,$D899,$1040,$0000,$D872,$1040,$0000
	dw $DE44,$1040,$0000,$E816,$1040,$0000,$E0E8,$1040
	dw $0000,$D8BA,$1040,$0000,$E28C,$1040,$0000,$B000
	dw $C010,$FFFF

DATA_10EE48:
	dw $0000,$B400,$C020,$FFFF

DATA_10EE50:
	dw $0130,$4000,$96B0,$0300,$1070,$2140,$0110,$2800
	dw $1540,$0100,$2018,$1A40,$00E0,$300C,$D840,$00D0
	dw $F818,$D740,$00E0,$30F4,$D940,$00D0,$F8D8,$D740
	dw $00D0,$3030,$D854,$00A0,$F828,$D750,$00D0,$30C8
	dw $D954,$00A0,$F8C8,$D750,$FFFF

DATA_10EE9A:
	dw DATA_10EEE3,DATA_10F12D

DATA_10EE9E:
	dw DATA_10EEA2,DATA_10F0EC

DATA_10EEA2:
	db $08,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$60,$00,$00,$00,$40,$00,$00
	db $00,$20,$00,$00,$02,$00,$00,$00,$02,$55,$00,$00,$02,$AA,$00,$00
	db $04,$00,$00,$00,$04,$04,$00,$00,$04,$08,$00,$00,$06,$00,$00,$00
	db $FF

DATA_10EEE3:
	db $2B,$42,$42,$00,$00,$B6,$19,$00,$00,$CD,$C7,$00,$00,$19,$EA,$00
	db $00,$26,$31,$00,$00,$FA,$1F,$58,$00,$FA,$1E,$58,$00,$B0,$00,$00
	db $00,$C7,$C7,$00,$00,$30,$30,$42,$00,$30,$30,$40,$00,$30,$30,$44
	db $00,$12,$52,$1A,$00,$12,$52,$1A,$00,$12,$52,$1A,$00,$30,$30,$1A
	db $01,$F7,$F6,$00,$02,$D6,$E3,$00,$03,$FE,$24,$00,$03,$D0,$0C,$00
	db $07,$D9,$2E,$00,$0B,$9D,$FE,$00,$0B,$C4,$28,$00,$0B,$D2,$45,$00
	db $09,$10,$DE,$04,$09,$24,$DF,$04,$09,$23,$F3,$04,$09,$0E,$F1,$04
	db $0A,$19,$EA,$04,$05,$26,$31,$04,$0C,$1A,$D2,$00,$0C,$1E,$BF,$00
	db $0C,$1C,$C8,$00,$0F,$F1,$DD,$00,$0F,$3D,$D6,$00,$0F,$4D,$DD,$00
	db $0F,$36,$EE,$00,$11,$51,$00,$00,$13,$2F,$4B,$00,$13,$28,$5A,$00
	db $13,$43,$38,$00,$11,$16,$32,$00,$11,$37,$54,$00,$11,$3D,$59,$00
	db $12,$12,$00,$00,$12,$1E,$FE,$00,$12,$2C,$ED,$00,$12,$00,$E1,$00
	db $12,$42,$C6,$00,$08,$F6,$47,$00,$13,$19,$26,$00,$13,$32,$23,$00
	db $13,$46,$16,$00,$0C,$19,$DC,$00,$0C,$06,$E7,$00,$0F,$07,$BD,$00
	db $0F,$2C,$D5,$00,$0F,$2A,$F7,$00,$12,$11,$C2,$00,$12,$FC,$A9,$00
	db $18,$A7,$C9,$00,$18,$B9,$DA,$00,$18,$A8,$E9,$00,$18,$A7,$C0,$00
	db $19,$BD,$3F,$00,$19,$B9,$4C,$00,$19,$BA,$24,$00,$19,$B4,$30,$00
	db $19,$AA,$37,$00,$19,$AB,$0B,$00,$19,$C7,$34,$00,$19,$C6,$4F,$00
	db $07,$B6,$F0,$00,$18,$A8,$D7,$00,$18,$C1,$D3,$00,$19,$A5,$16,$00
	db $19,$9C,$29,$00,$19,$AB,$26,$00,$19,$B3,$05,$00,$08,$23,$10,$00
	db $07,$ED,$B8,$00,$0B,$08,$AD,$00,$0B,$F0,$9F,$00,$13,$5A,$F0,$00
	db $11,$5C,$01,$00,$11,$6B,$02,$00,$11,$4A,$27,$00,$11,$5C,$18,$00
	db $12,$E2,$A6,$00,$12,$02,$9E,$00,$16,$FA,$1E,$58,$15,$D6,$F7,$49
	db $15,$21,$00,$49,$15,$08,$17,$4A,$15,$F8,$3B,$30,$06,$12,$52,$00
	db $15,$EF,$D0,$40,$15,$DE,$1F,$40,$1B,$D9,$E5,$43,$1B,$DD,$E8,$43
	db $1B,$E2,$EB,$45,$1B,$E6,$EE,$47,$1B,$EB,$F0,$4C,$1B,$F1,$F3,$50
	db $1B,$F7,$FA,$53,$1B,$F7,$FD,$53,$1B,$F7,$02,$54,$1B,$F7,$08,$55
	db $1B,$F8,$0F,$58,$1B,$F8,$15,$5B,$1B,$D2,$05,$36,$1B,$D2,$FE,$37
	db $1B,$D3,$F8,$39,$1B,$D4,$F2,$3B,$1B,$D5,$EB,$3E,$0A,$B6,$19,$04
	db $04,$CD,$C7,$04,$18,$D5,$BA,$00,$18,$C1,$C5,$00,$10,$D7,$B7,$00
	db $10,$E0,$CA,$00,$10,$B4,$D2,$00,$10,$B4,$BF,$00,$0D,$DE,$50,$00
	db $10,$B4,$D2,$00,$10,$B4,$BF,$00,$0D,$DE,$50,$00,$FF

DATA_10F0E0:
	dw $01CC,$01D0,$0070,$0074,$0168,$0070

DATA_10F0EC:
	db $08,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $04,$00,$00,$00,$04,$04,$00,$00,$04,$08,$00,$00,$00,$00,$00,$00
	db $FF

DATA_10F12D:
	db $31,$0A,$20,$50,$00,$00,$B0,$00,$00,$39,$C7,$00,$00,$50,$00,$00
	db $00,$39,$39,$00,$00,$00,$50,$00,$00,$09,$16,$00,$00,$B0,$00,$00
	db $00,$C7,$C7,$00,$00,$30,$30,$42,$00,$30,$30,$40,$00,$30,$30,$44
	db $00,$3D,$06,$1A,$00,$3D,$06,$1A,$00,$3D,$06,$1A,$00,$30,$30,$00
	db $15,$30,$30,$1A,$02,$DC,$22,$00,$03,$F2,$43,$00,$03,$0B,$E6,$00
	db $6E,$0B,$58,$00,$6E,$06,$BF,$00,$6E,$C1,$09,$00,$6E,$D8,$C0,$00
	db $6E,$33,$E6,$00,$6F,$DA,$05,$00,$6F,$BE,$2A,$00,$6F,$04,$2D,$00
	db $73,$09,$16,$00,$6C,$C2,$47,$00,$6C,$D8,$4B,$00,$6C,$B0,$E2,$00
	db $6C,$E6,$EC,$00,$6C,$38,$C8,$00,$6D,$4A,$F4,$00,$6D,$D9,$F5,$00
	db $10,$55,$DD,$00,$10,$AD,$1F,$00,$1A,$38,$27,$00,$1A,$2D,$26,$00
	db $1A,$23,$27,$00,$1A,$19,$20,$00,$1A,$1E,$23,$00,$5C,$E7,$66,$00
	db $5D,$EA,$59,$00,$61,$60,$29,$00,$61,$67,$14,$00,$61,$61,$00,$00
	db $62,$5F,$1A,$00,$62,$66,$22,$00,$66,$B7,$3A,$00,$67,$AA,$2F,$00
	db $67,$A2,$0C,$00,$68,$B0,$FF,$00,$68,$CD,$54,$00,$60,$37,$5C,$00
	db $60,$1D,$58,$00,$5C,$42,$4E,$00,$5C,$17,$6C,$00,$5C,$26,$5F,$00
	db $5B,$39,$52,$00,$61,$6A,$01,$00,$61,$5F,$0A,$00,$62,$67,$0B,$00
	db $62,$5F,$EB,$00,$06,$3D,$06,$00,$15,$20,$05,$40,$15,$1F,$3C,$30
	db $15,$EC,$FB,$30,$15,$C8,$3C,$20,$15,$D0,$E7,$20,$15,$1C,$D5,$20
	db $15,$0A,$20,$50,$15,$E8,$14,$50,$0E,$C2,$EB,$00,$0E,$EF,$01,$00
	db $0E,$23,$45,$00,$FF

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
DATA_level_2A_obj:
	incbin "LevelData/DATA_level_2A_obj.bin"

DATA_level_61_obj:
	incbin "LevelData/DATA_level_61_obj.bin"

DATA_level_8D_obj:
	incbin "LevelData/DATA_level_8D_obj.bin"

DATA_level_B2_obj:
	incbin "LevelData/DATA_level_B2_obj.bin"

DATA_level_2A_spr:
	incbin "LevelData/DATA_level_2A_spr.bin"

DATA_level_61_spr:
	incbin "LevelData/DATA_level_61_spr.bin"

DATA_level_8D_spr:
	incbin "LevelData/DATA_level_8D_spr.bin"

DATA_level_B2_spr:
	incbin "LevelData/DATA_level_B2_spr.bin"

	%InsertGarbageData($10FC40, incbin, DATA_10FC40_YI_U2.bin)
else
DATA_level_04_obj:
	incbin "LevelData/DATA_level_04_obj.bin"

;-------------------------------------------------------------------------
; Bank-tail per-level data blobs.
; The remainder of bank $10 is incbin'd level data (~3 KB each) -- the
; compressed Map16 tile-grid streams parsed by InitNewColumn/InitNewRow
; above. Each .bin is identified by its starting SNES address (DATA_xxxxxx
; = "../assets/yi/LevelData/DATA_xxxxxx.bin"). See docs/levelloader.md S3
; for the master per-level pointer table that resolves which level uses
; which blob.
;-------------------------------------------------------------------------
DATA_level_04_spr:
	incbin "LevelData/DATA_level_04_spr.bin"

DATA_level_30_obj:
	incbin "LevelData/DATA_level_30_obj.bin"

DATA_level_67_obj:
	incbin "LevelData/DATA_level_67_obj.bin"

DATA_level_93_obj:
	incbin "LevelData/DATA_level_93_obj.bin"

DATA_level_B6_obj:
	incbin "LevelData/DATA_level_B6_obj.bin"

DATA_level_C5_obj:
	incbin "LevelData/DATA_level_C5_obj.bin"

DATA_level_CC_obj:
	incbin "LevelData/DATA_level_CC_obj.bin"

DATA_level_30_spr:
	incbin "LevelData/DATA_level_30_spr.bin"

DATA_level_67_spr:
	incbin "LevelData/DATA_level_67_spr.bin"

DATA_level_93_spr:
	incbin "LevelData/DATA_level_93_spr.bin"

DATA_level_B6_spr:
	incbin "LevelData/DATA_level_B6_spr.bin"

DATA_level_C5_spr:
	incbin "LevelData/DATA_level_C5_spr.bin"

DATA_level_CC_spr:
	incbin "LevelData/DATA_level_CC_spr.bin"

	%FREE_BYTES($10FFA3, 93, $FF)
endif
%BANK_END(<EndBank>)
endmacro
