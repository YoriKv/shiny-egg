;#############################################################################################################
;# Bank06.asm -- bank $06 normal-sprite handlers (Init/Main pairs for sprite IDs $010..$193).
;#
;# All routines are reachable via the normal-sprite Init/Main dispatchers in Bank $03 (see
;# Routines/ROUTINE_YI_NorSpr*_*.asm). Each Init builds initial sprite state from level-header data;
;# each Main runs every frame the sprite is active. State is held in the per-slot EXRAM tables
;# (!EXRAM_YI_Level_NorSpr_*) and the bank-0x6F00-shaped DP-relative tables ($6FA0, $7000, ...).
;#
;# Contents at a glance (ranges keyed off the ;$06xxxx address comments at each handler entry):
;#   $068000..$0681EE -- Slime Block ($03F) Init + shared ground/wall probe used by Salvo
;#   $0681EF..$0683C9 -- Salvo The Slime ($02D) Init + state machine
;#   $0683CA..$0692E4 -- Salvo The Slime ($02D) Main + per-state handlers; Slime Block Main
;#   $0692E5..$0693E5 -- Eyes Of Salvo The Slime ($02E) Init + Main
;#   $0693E6..$06975F -- Lemon Drop ($132) Init + Main (W3 yellow-cliff acid drop hazard)
;#   $069760..$06AA28 -- Burt The Bashful ($046) boss Init + Main + state machine
;#   $06AA29..$06B932 -- Marching Milde ($0D2) boss Init + Main (rolling pink boss)
;#   $06B933..$06B9D9 -- Large Pop Effect ($12E) Init + Main (spawn/death visual)
;#   $06B9DA..$06BB79 -- Vertical Cloud Drop ($0EA) Init + Main + StompRt
;#   $06BB7A..$06BCC7 -- Horizontal Cloud Drop ($0EB) Init + Main + StompRt
;#   $06BCC8..$06D1A0 -- Baby Mario ($061) Init + Main + ride-Yoshi routine
;#                       (cry timer, off-Yoshi behavior, Kamek-bubble pickup)
;#   $06D1A1..$06D9BF -- Dangling Ghost ($090) Init + Main (Boo Guys hanging from sewer ceiling)
;#   $06D9C0..$06E02A -- Caged Ghost (Snake Block variant, $193) Init + Main
;#   $06E02B..$06E516 -- Rounded Caged Ghost ($010) Init + Main
;#   $06E517..$06E943 -- Fort Ghost With Platform ($0D6) Init + Main (fort/castle BG variant)
;#   $06E944..$06F08E -- Soft Block ($0DB) Init + Main (deformable terrain block)
;#   $06F08F..$06FEA9 -- Sewer Ghost With Platform ($057) Init + Main (sewer BG variant)
;#   $06FEAA..$06FFFF -- bank-tail garbage data (V1.1 ROM only -- empty in V1.0)
;#
;# Cross-references:
;#   ../../../yoshisisland-disassembly/disassembly/bank06.asm -- Raidenthequick's V1.0 disassembly;
;#                       primary source of the init_slime / init_salvo / init_burt / init_marching_milde /
;#                       init_baby_mario / init_platform_ghost descriptive aliases used here.
;#   ../Constants/NormalSpriteIDs.asm        -- the !Define_YI_NorSpr* sprite-ID symbols.
;#   ../Memory/SRAM_SpriteSlots.asm          -- layout of the $70:0EC0..$701DF8 per-slot tables.
;#   docs/spritestateengine.md               -- sprite engine architecture + ID space + Init/Main convention.
;#   see also: ys_enmy.asm, ys_enmy5.asm, ys_enmy7.asm -- adjacent enemy subsystems.
;#############################################################################################################

macro YIBank06Macros(StartBank, EndBank)
%BANK_START(<StartBank>)

;-------------------------------------------------------------------------
; Slime Block ($03F) Init handler.
; The Slime Block is the floor/ceiling tile that Salvo the Slime ($02D)
; oozes through and onto. This routine probes the level data buffer to
; locate the host tile (id $0174 in the buffer) and locks the sprite to
; that tile by writing the buffer index into $18,x. Once the host index
; is known, control falls through into shared logic at CODE_068064 which
; is also used by Salvo's body sprite for ground/wall projection.
; Raidenthequick: init_slime.
;-------------------------------------------------------------------------
YI_NorSpr03F_SlimeBlock_Init:
init_slime:                                ; Raidenthequick: init_slime
;$068000
	LDA.b $18,x
	BNE.b CODE_068064
	JSL.l CODE_03D406
	REP.b #$10
	LDA.w $7182,x
	STA.w $1094
	SEC
	SBC.w #$0038
	PHA
	AND.w #$FF00
	LSR
	LSR
	LSR
	LSR
	STA.b $00
	LDA.w $70E2,x
	STA.w $1092
	SEC
	SBC.w #$0018
	PHA
	AND.w #$FF00
	XBA
	ORA.b $00
	TAX
	PLA
	AND.w #$00F0
	LSR
	LSR
	LSR
	STA.b $00
	PLA
	AND.w #$00F0
	ASL
	ORA.b $00
	STA.b $00
	LDA.w $6CA9,x
	AND.w #$3F00
	ASL
	CLC
	ADC.b $00
	STA.b $00
	TAX
	LDA.l !RAM_YI_Level_LevelDataBuffer,x
	SEP.b #$10
	LDX.b $12
	CMP.w #$0174
	BEQ.b CODE_068060
CODE_06805C:
	JML.l CODE_03A31E

CODE_068060:
	LDA.b $00
	STA.b $18,x
CODE_068064:
	LDA.w $0CB2
	BNE.b CODE_06805C
	LDA.w $6120
	CLC
	ADC.w #$0030
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $70E2,x
	CLC
	ADC.w #$0010
	SEC
	SBC.w $611C
	CMP.b $00
	BCS.b CODE_06809D
	LDA.w $7182,x
	SEC
	SBC.w $611E
	SEC
	SBC.w $6122
	SEC
	SBC.w #$0041
	BPL.b CODE_06809D
	LDA.w $60FC
	AND.w #$0007
	BNE.b CODE_0680A4
CODE_06809D:
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	RTL

CODE_0680A4:
	INC.w $0CB2
	LDA.w #$0174
	JSL.l CODE_0681A6
	LDA.b $04
	XBA
	AND.w #$00E3
	STA.w $107E
	ORA.w #$0080
	STA.w $1080
	LDA.b $18,x
	STA.w $1090
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w $70E2,x
	STZ.w $107C
	LDA.w #$0008
	STA.b $02
	LDA.w $7182,x
	CLC
	ADC.w #$FFC8
	AND.w #$00F0
	ASL
	ASL
	STA.b $00
	LDA.w $70E2,x
	CLC
	ADC.w #$FFE0
	AND.w #$01F0
	LSR
	LSR
	LSR
	BIT.w #$0020
	BEQ.b CODE_0680F7
	EOR.w #$0420
CODE_0680F7:
	TSB.b $00
	LDA.b $00
	CLC
	ADC.w #$6800
	STA.b $00
	STA.w $108E
	LDA.w #$0006
	STA.b $0E
	PHB
	SEP.b #$20
	LDA.b #$7E4800>>16
	PHA
	PLB
	REP.b #$30
	LDX.w $7E4800
CODE_068115:
	LDA.b $00
	STA.w $0000,x
	LDA.w #$0880
	STA.w $0002,x
	LDA.w #$0019
	STA.w $0004,x
	LDA.w #$107E
	STA.w $0005,x
	LDA.w #$0000
	STA.w $0007,x
	LDA.w #$000C
	STA.w $0008,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,x
	TAX
	DEC.b $02
	BEQ.b CODE_06814F
	LDA.b $00
	CLC
	ADC.w #$0020
	STA.b $00
	BRA.b CODE_068115

CODE_06814F:
	LDA.b $00
	INC
	STA.w $0000,x
	LDA.w #$0880
	STA.w $0002,x
	LDA.w #$0019
	STA.w $0004,x
	LDA.w #$1080
	STA.w $0005,x
	LDA.w #$0000
	STA.w $0007,x
	LDA.w #$000A
	STA.w $0008,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,x
	STA.w $7E4800
	JSR.w CODE_0690D2
	PLB
	LDA.w #$0008
	STA.w $7A96,x
	LSR
	STA.w $105E
	LDA.w #$E000
	STA.w $1078
	STZ.w $1070
	LDA.w #$0001
	STA.w $10B6
	LDA.w #$883A
	STA.w $108C
	LDY.b #$0C
	STY.b $76,x
	RTL

;---------------------------------------------------------------------------

CODE_0681A6:
	PHY
	REP.b #$10
	TAY
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
	CLC
	ADC.b $00
	TAX
	LDA.l FXDATA_4C33F2,x
	STA.b $04
	LDA.l FXDATA_4C33F2+$02,x
	STA.b $06
	LDA.l FXDATA_4C33F2+$04,x
	STA.b $08
	LDA.l FXDATA_4C33F2+$06,x
	STA.b $0A
	SEP.b #$10
	PLY
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Salvo The Slime ($02D) -- Init state-pointer table.
; The Init dispatcher reads the per-slot state byte at $76,x and jumps
; through this table. Raidenthequick documents the slots as:
;   $00 -- Salvo spawn / appearing
;   $01..$03 -- (linkers / fall-throughs, no dedicated state body)
;   $04 -- pre-fight idle
;   $05 -- dripping from ceiling (gathering into body)
;   $06 -- bouncing back after spawn
;   $07 -- growing into the full blob form
; The Main state-pointer table sits at DATA_salvo_main_state_ptr below.
; Raidenthequick: DATA_salvo_init_state_ptr.
;-------------------------------------------------------------------------
DATA_0681DF:
DATA_salvo_init_state_ptr:                      ; Raidenthequick: DATA_salvo_init_state_ptr
	dw CODE_0681FE                         ; $00: salvo spawn
	dw CODE_06823D
	dw CODE_068292
	dw CODE_06833D
	dw CODE_068347
	dw CODE_068362                         ; $05: salvo dripping from ceiling
	dw CODE_0682A2                         ; $06: salvo bouncing back after spawning
	dw CODE_068384                         ; $07: salvo growing

;-------------------------------------------------------------------------
; Salvo The Slime ($02D) -- Init handler.
; Dispatches to one of the Init sub-states via DATA_salvo_init_state_ptr using $76,x as
; the state selector. Tail-stores #$0002 into the per-slot CurrentStatus
; word to keep the sprite alive next frame. Caller invariants: M=8, X=16.
; Raidenthequick: init_salvo. See docs/bossengine.md.
;-------------------------------------------------------------------------
YI_NorSpr02D_SalvoTheSlime_Init:
init_salvo:                                ; Raidenthequick: init_salvo
;$0681EF
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_salvo_init_state_ptr,x)
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	RTL

CODE_0681FE:
	TYX
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CMP.w #$01E0
	BMI.b CODE_06823C
	STZ.w $60A8
	STZ.w $60B4
	JSL.l CODE_04F74A
	LDA.w #$0048
	JSL.l CODE_spawn_sprite_init
	LDA.w #$0010
	STA.w $70E2,y
	LDA.w #!Define_YI_MusicID_FadeMusicCommand
	STA.w !RAM_YI_Global_PlayMusicLo
	LDA.w #$00DD
	JSL.l CODE_spawn_sprite_active
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0026
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	STZ.w $105A
	INC.b $76,x
CODE_06823C:
	RTS

CODE_06823D:
	TYX
	STZ.w $60C4
	LDY.w $105A
	BEQ.b CODE_068291
	LDA.w #$0132
	JSL.l CODE_spawn_sprite_active
	LDA.w #$0240
	STA.w $70E2,y
	LDA.w #$0730
	STA.w $7182,y
	LDA.w #$0006
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w $6FA2,y
	ORA.w #$2000
	STA.w $6FA2,y
	SEP.b #$20
	LDA.b #$01
	STA.w $74A2,y
	LDA.b #$2E
	STA.w $7042,y
	REP.b #$20
	LDA.w #!Define_YI_MusicID09_BossBattle
	STA.w !RAM_YI_Global_PlayMusicLo
	LDX.b #$20
CODE_06827E:
	LDA.l $702E8A,x
	STA.l YI_Global_PaletteMirror[$DF].LowByte,x
	DEX
	DEX
	BNE.b CODE_06827E
	LDX.b $12
	STZ.w $105A
	INC.b $76,x
CODE_068291:
	RTS

CODE_068292:
	TYX
	LDY.w $105A
	BEQ.b CODE_0682A1
	STZ.w $10B6
	LDY.b #$06
	STY.b $76,x
	INC.b $76,x
CODE_0682A1:
	RTS

CODE_0682A2:
	TYX
	JSL.l CODE_03D5E4
	STZ.w $7ECC
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w #$00A8
	STA.w $70E2,x
	LDA.w #$0728
	STA.w $7182,x
	STA.w $1076
	LDA.w #$07B0
	STA.w $108A
	INC.w $0CB2
	LDY.b #$05
	STY.b $76,x
	LDA.w #!Define_YI_AmbSpr1D1
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0006
	STA.w $7182,x
	STA.w $7142,y
	LDA.w $7182,x
	SEC
	SBC.w $609C
	CLC
	ADC.w #$0016
	STA.w $1062
	LDA.w #$FFFF
	STA.w $7782,y
	TYA
	STA.w $7A38,x
	TXA
	STA.w $7E4C,y
	STZ.w $105C
	STZ.w $105E
	STZ.w $1060
	STZ.w $1064
	STZ.w $1066
	LDA.w #$0100
	STA.w $1068
	STZ.w $106C
	STZ.w $1084
	STZ.w $1086
	LDA.w #$B000
	STA.w $1078
	STZ.w $106A
	LDA.w #$00E0
	STA.b $18,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $1070
	LDA.w #$0001
	STA.w $1082
	STZ.w $1088
	PLA
	RTL

CODE_06833D:
	LDA.w #$0016
	REP.b #$10
	LDY.w #$2800
	BRA.b CODE_06834F

CODE_068347:
	LDA.w #$0015
	REP.b #$10
	LDY.w #$2C00
CODE_06834F:
	PHA
	PHY
	SEP.b #$10
	LDA.w #$0404
	TRB.w !RAM_YI_Global_MainScreenLayers
CODE_068359:
	REP.b #$10
	PLY
	PLA
	JSR.w CODE_068395
	BRA.b CODE_06837F

CODE_068362:
	REP.b #$10
	LDA.w #$00DD
	LDY.w #$3400
	JSR.w CODE_068395
	LDX.b #$06
CODE_06836F:
	LDA.l DATA_5FE344,x
	STA.l $702D74,x
	STA.l YI_Global_PaletteMirror[$04].LowByte,x
	DEX
	DEX
	BPL.b CODE_06836F
CODE_06837F:
	LDX.b $12
	INC.b $76,x
	RTS

CODE_068384:
	JSR.w CODE_068603
	LDY.b #!REGISTER_BG2HorizScrollOffset
	STY.w HDMA[$03].Destination
	INY
	STY.w HDMA[$04].Destination
	LDX.b $12
	DEC.b $76,x
	RTS

CODE_068395:
	PHY
	LDX.w #$6800
	JSL.l CODE_00B756
	PLY
	LDX.w #$706800>>16
	STX.w $0001
	LDX.w #$706800
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$10
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Salvo The Slime ($02D) -- Main state-pointer table.
; Read at CODE_068999/etc. once Main has done the per-frame SuperFX blit
; setup. Each slot covers a Salvo fight phase (idle, ooze, attack,
; recover, etc.). Raidenthequick: DATA_salvo_main_state_ptr.
;-------------------------------------------------------------------------
DATA_0683AE:
DATA_salvo_main_state_ptr:                      ; Raidenthequick: DATA_salvo_main_state_ptr
	dw CODE_068999
	dw CODE_0689B1
	dw CODE_068A95
	dw CODE_068B08
	dw CODE_068999
	dw CODE_068B59
	dw CODE_068999
	dw CODE_068B94
	dw CODE_068BAD
	dw CODE_068BC6
	dw CODE_068C0B
	dw CODE_068C8A
	dw CODE_068D65
	dw CODE_068E80

;-------------------------------------------------------------------------
; Salvo The Slime ($02D) + Slime Block ($03F) -- shared Main handler.
; Runs every frame either sprite is active. Both sprite IDs share the
; same Main because the Slime Block is the host tile for Salvo's body
; projection; the per-slot state byte $76,x indexes DATA_salvo_main_state_ptr for the
; Salvo-specific phase logic. The SuperFX is invoked twice (FX routine
; FXCODE_0B86B6) to multiply/scale the blob bitmap into the level layer.
; Caller invariants: M=8, X=16. DBR set to bank $06.
; Raidenthequick: main_salvo.
;-------------------------------------------------------------------------
YI_NorSpr02D_SalvoTheSlime_Main:
YI_NorSpr03F_SlimeBlock_Main:
main_salvo:                                ; Raidenthequick: main_salvo
;$0683CA
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDY.w $1079
	TYA
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$0180
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $107A
	LDY.b $76,x
	CPY.b #$0C
	BPL.b CODE_068402
	JSR.w CODE_068442
	JSR.w CODE_068722
CODE_068402:
	JSR.w CODE_068622
	LDY.w $10B6
	BEQ.b CODE_068417
	LDY.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CPY.b #!Define_YI_PlayerState06
	BNE.b CODE_068417
	LDA.w #$0215
	STA.w !RAM_YI_Global_MainScreenLayers
CODE_068417:
	JSL.l CODE_03AF23
	LDY.b $76,x
	CPY.b #$0C
	BEQ.b CODE_06842B
	CPY.b #$0D
	BEQ.b CODE_068428
	JSR.w CODE_0687A5
CODE_068428:
	JSR.w CODE_068909
CODE_06842B:
	JSR.w CODE_06866E
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_salvo_main_state_ptr,x)
	LDA.w $106A
	BEQ.b CODE_06843E
	DEC.w $106A
CODE_06843E:
	JSR.w CODE_0686C1
	RTL

CODE_068442:
	LDY.b $76,x
	CPY.b #$05
	BEQ.b CODE_068452
	CPY.b #$0B
	BNE.b CODE_068464
	LDY.w $1088
	BEQ.b CODE_068464
	RTS

CODE_068452:
	STZ.w $600E
	STZ.w $6010
	LDY.w $7A38,x
	LDA.w $7142,y
	SEC
	SBC.w !RAM_YI_Global_Layer1YPosLo
	BRA.b CODE_0684AA

CODE_068464:
	LDY.w $7A38,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	PHA
	AND.w #$00FF
	TAY
	BPL.b CODE_068474
	ORA.w #$FF00
CODE_068474:
	STA.w $600E
	PLA
	AND.w #$FF00
	BPL.b CODE_068480
	ORA.w #$00FF
CODE_068480:
	XBA
	STA.b $00
	LDA.w #$0028
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $107A
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.b $00
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w #$0008
	STA.w $6010
	LDA.w #$0000
CODE_0684AA:
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $1062
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7680,x
	CLC
	ADC.w #$0008
	STA.w $6000
	LDA.w $7682,x
	STA.w $6002
	LDA.w $107A
	STA.w $6006
	TXA
	STA.w $6012
	LDA.w #$02C0
	SEC
	SBC.b $18,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
CODE_0684D6:
	LDY.w $1079
	TYA
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $6004
	LDA.w $1064
	STA.w $6008
	LDA.w $1066
	STA.w $600A
	LDA.w $1068
	STA.w $600C
	LDA.w $60B0
	STA.w $6014
	LDA.w $60B2
	STA.w $6016
	LDA.w $60C2
	STA.w $6018
	LDX.b #FXCODE_0A81C9>>16
	LDA.w #FXCODE_0A81C9
	JSL.l !RAM_YI_Global_RT_00DE91
	REP.b #$10
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	SEP.b #$30
	LDA.w $1076
	ORA.w $1077
	BEQ.b CODE_06853C
	LDA.b #$08
	TRB.w !RAM_YI_Global_BGModeAndTileSizeSetting
	LDY.b #$13
	LDA.b #$04
	BRA.b CODE_06854B

CODE_06853C:
	LDY.w $10B6
	BEQ.b CODE_068547
	LDY.b #$10
	LDA.b #$07
	BRA.b CODE_06854B

CODE_068547:
	LDY.b #$12
	LDA.b #$05
CODE_06854B:
	STY.w !RAM_YI_Global_MainScreenLayers
	STA.w !RAM_YI_Global_SubScreenLayers
	LDA.b #$02
	STA.w !RAM_YI_Global_ColorMathInitialSettings
	LDA.b #$20
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.b #$18
	TSB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDX.b $12
	JSR.w CODE_068591
	LDX.b $12
	LDA.w $6020
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.b $76,x
	CPY.b #$05
	BEQ.b CODE_068590
	LDY.w $7A38,x
	LDA.w $600E
	CLC
	ADC.w $70E2,x
	STA.w $70E2,y
	LDA.w $6010
	CLC
	ADC.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,y
CODE_068590:
	RTS

CODE_068591:
	LDY.w $10B6
	BEQ.b CODE_0685E0
	LDY.w $106A
	BEQ.b CODE_0685BE
	LDA.w $7AF6,x
	BNE.b CODE_0685DF
	LDA.w #$0004
	STA.w $7AF6,x
	LDA.l YI_Global_PaletteMirror[$01].LowByte
	EOR.w #$FFFF
	STA.l YI_Global_PaletteMirror[$01].LowByte
	STA.l $702D6E
	LDA.l YI_Global_PaletteMirror[$02].LowByte
	EOR.w #$FFFF
	BRA.b CODE_0685CC

CODE_0685BE:
	LDA.w #$637D
	STA.l YI_Global_PaletteMirror[$01].LowByte
	STA.l $702D6E
	LDA.w #$4A75
CODE_0685CC:
	STA.l YI_Global_PaletteMirror[$02].LowByte
	STA.l $702D70
	LDA.w #$0000
	STA.l YI_Global_PaletteMirror[$03].LowByte
	STA.l $702D72
CODE_0685DF:
	RTS

CODE_0685E0:
	LDY.w $106A
	BEQ.b CODE_068603
	LDA.w $7AF6,x
	BNE.b CODE_068603
	LDA.w #$0004
	STA.w $7AF6,x
	LDX.b #$1C
CODE_0685F2:
	LDA.l DATA_5FA56E,x
	STA.l YI_Global_PaletteMirror[$60].LowByte,x
	STA.l YI_Global_PaletteMirror[$70].LowByte,x
	DEX
	DEX
	BNE.b CODE_0685F2
	RTS

CODE_068603:
	LDX.b #$1C
CODE_068605:
	LDA.l DATA_5FE9C6,x
	STA.l $702E2C,x
	STA.l YI_Global_PaletteMirror[$60].LowByte,x
	LDA.l DATA_5FE9E2,x
	STA.l $702E4C,x
	STA.l YI_Global_PaletteMirror[$70].LowByte,x
	DEX
	DEX
	BNE.b CODE_068605
	RTS

CODE_068622:
	LDY.w $1082
	BNE.b CODE_068631
	LDY.b $76,x
	CPY.b #$04
	BEQ.b CODE_068631
	CPY.b #$03
	BPL.b CODE_06866D
CODE_068631:
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_06866D
	CMP.w #$000C
	BEQ.b CODE_06866D
	AND.w #$0008
	LSR
	LSR
	DEC
	CLC
	ADC.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w $10BC
	EOR.w #$FFFF
	INC
	STA.w $10BC
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $75E0,x
	EOR.w #$FFFF
	INC
	STA.w $75E0,x
CODE_06866D:
	RTS

CODE_06866E:
	LDY.w $1079
	CPY.b #$4C
	BCS.b CODE_0686C0
	LDY.w $10B6
	BNE.b CODE_068683
	LDY.w $0B59
	BNE.b CODE_068683
	JSL.l CODE_02A982
CODE_068683:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0686C0
	LDY.b $76,x
	CPY.b #$09
	BEQ.b CODE_0686C0
	CPY.b #$0A
	BEQ.b CODE_0686C0
	CPY.b #$0B
	BEQ.b CODE_0686C0
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w #$0040
	STA.w $7A96,x
	LDA.w #$000A
	STA.b $76,x
	LDA.w #$FFFF
	STA.w $7AF8,x
	STA.w $0B7B
	LDY.w $10B6
	BNE.b CODE_0686C0
	DEC.b $76,x
	LDA.w #!Define_YI_PlayerState02_InCutscene
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
CODE_0686C0:
	RTS

CODE_0686C1:
	LDA.w $10B6
	ORA.w $1082
	ORA.w $0B59
	BNE.b CODE_06871D
	LDY.b $76,x
	CPY.b #$09
	BPL.b CODE_06871D
	LDA.w #$0132
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	INC
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0991DB>>16
	LDA.w #FXCODE_0991DB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R6_MultiplierLo
	BNE.b CODE_06871D
	LDX.b #FXCODE_0991D5>>16
	LDA.w #FXCODE_0991D5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R6_MultiplierLo
	BNE.b CODE_06871D
	LDA.w #$0132
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_06871D
	LDA.b $10
	AND.w #$00FF
	CLC
	ADC.w #$01C8
	STA.w $70E2,y
	LDA.w #$0730
	STA.w $7182,y
	LDA.w #$0001
	STA.w $74A2,y
CODE_06871D:
	RTS

DATA_06871E:
	dw $FFFD,$FFFE

CODE_068722:
	LDY.b $76,x
	CPY.b #$05
	BNE.b CODE_06872C
	STZ.w $7860,x
	RTS

CODE_06872C:
	LDY.w $7223,x
	BMI.b CODE_068747
	LDA.w $108A
	BMI.b CODE_068747
	CMP.w $7182,x
	BPL.b CODE_068747
	STA.w $7182,x
	LDA.w $7860,x
	ORA.w #$0001
	STA.w $7860,x
CODE_068747:
	LDY.w $1070
	BNE.b CODE_06877D
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_068755
	INY
	INY
CODE_068755:
	LDA.w DATA_06871E,y
	AND.w $7860,x
	STA.w $7860,x
	AND.w #$0003
	BEQ.b CODE_068796
	AND.w #$0002
	BEQ.b CODE_06878A
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.w #$0004
	STA.w $1072
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.b $76,x
	STZ.w $7542,x
	INC.w $1070
CODE_06877D:
	LDA.w $1072
	CLC
	ADC.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BRA.b CODE_068793

CODE_06878A:
	LDA.w $7182,x
	AND.w #$FFF0
	ORA.w #$0001
CODE_068793:
	STA.w $7182,x
CODE_068796:
	LDA.w $7860,x
	AND.w #$0030
	LSR
	LSR
	ORA.w $7860,x
	STA.w $7860,x
	RTS

CODE_0687A5:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0687E8
	BEQ.b CODE_0687E8
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0687E8
	LDA.w $7D38,y
	BEQ.b CODE_0687E8
	CPY.w $10BA
	BEQ.b CODE_0687C5
	STY.w $10BA
	STZ.w $10B8
CODE_0687C5:
	LDA.w $1078
	CMP.w #$4C00
	BCC.b CODE_0687E3
	LDA.b $76,x
	CMP.w #$0003
	BEQ.b CODE_0687E3
	CMP.w #$0009
	BEQ.b CODE_0687E3
	CMP.w #$000A
	BEQ.b CODE_0687E3
	CMP.w #$000B
	BNE.b CODE_0687EE
CODE_0687E3:
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
CODE_0687E8:
	LDY.b #$FF
	STY.w $10BA
	RTS

CODE_0687EE:
	LDA.w #$0020
	STA.w $106A
	LDA.w $7A98,x
	BNE.b CODE_0687E8
	LDA.w $70E2,y
	STA.b $00
	LDA.w $7182,y
	STA.b $02
	LDA.w $7542,y
	STA.b $04
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	LDA.w $10B8
	AND.w #$0003
	ORA.w $10B6
	BNE.b CODE_06886C
	LDA.w #$0132
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	INC
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0991DB>>16
	LDA.w #FXCODE_0991DB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R6_MultiplierLo
	CPY.b #$06
	BPL.b CODE_06886C
	LDA.w #$0132
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_06886C
	SEP.b #$20
	LDA.b #$02
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.b #$10
	STA.w $7AF6,y
	LDA.w $6FA1,y
	AND.b #$F9
	STA.w $6FA1,y
	LDA.b #$01
	STA.w $74A2,y
	LDA.b #$2E
	STA.w $7042,y
	LDA.b #$40
	STA.w $7542,y
	REP.b #$20
	TYA
	CLC
	ADC.w #$0040
	TAY
	BRA.b CODE_068879

CODE_06886C:
	LDA.w #!Define_YI_AmbSpr217
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$FFFF
	STA.w $7782,y
CODE_068879:
	LDA.b $00
	STA.w $70A2,y
	LDA.b $02
	STA.w $7142,y
	SEP.b #$20
	LDA.b #$FF
	STA.w $7823,y
	REP.b #$20
	LDA.b $10
	PHA
	AND.w #$01FF
	SEC
	SBC.w #$0100
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	BMI.b CODE_0688A1
	LDA.w #$0002
	STA.w $73C0,y
CODE_0688A1:
	PLA
	XBA
	AND.w #$03FF
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	INC.w $10B8
	LDY.w $1084
	BNE.b CODE_0688E3
	INC.w $1084
	LDY.b #$02
	STY.w $1086
	LDY.b $76,x
	CPY.b #$02
	BNE.b CODE_0688CF
	LDA.w #$0003
	STA.w $106C
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
CODE_0688CF:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $75E0,x
	EOR.w #$FFFF
	INC
	STA.w $75E0,x
CODE_0688E3:
	LDA.w $1078
	SEC
	SBC.w #$0300
	CMP.w #$4C00
	BCS.b CODE_0688F2
	LDA.w #$4BFF
CODE_0688F2:
	STA.w $1078
	LDY.b #$02
	LDA.b $04
	CMP.w #$0040
	BPL.b CODE_068900
	LDY.b #$01
CODE_068900:
	TYA
	STA.w $7A98,x
CODE_068904:
	RTS

DATA_068905:
	dw $0080,$FF80

CODE_068909:
	LDA.w $601A
	BEQ.b CODE_068904
	STZ.w $60D4
	BIT.w #$0001
	BEQ.b CODE_06891B
	BIT.w #$000E
	BEQ.b CODE_068953
CODE_06891B:
	LDY.w $77C2,x
	LDA.w DATA_068905,y
	SEC
	SBC.w $7C16,x
	CMP.w #$8000
	ROR
	STA.b $00
	LDY.b $76,x
	CPY.b #$09
	BEQ.b CODE_068953
	CPY.b #$0A
	BEQ.b CODE_068953
	CPY.b #$0B
	BEQ.b CODE_068953
	LDA.w $60A8
	PHA
	CLC
	ADC.w #$0400
	CMP.w #$0800
	BCS.b CODE_068952
	PLA
	SEC
	SBC.b $00
	STA.w $60A8
	STA.w $60B4
	BRA.b CODE_068953

CODE_068952:
	PLA
CODE_068953:
	LDA.w $601A
	BIT.w #$0001
	BEQ.b CODE_068964
	LDA.w $60AA
	BMI.b CODE_068964
	LSR
	STA.w $60AA
CODE_068964:
	LDY.w $77C3,x
	LDA.w DATA_068905,y
	SEC
	SBC.w $7C18,x
	STA.b $00
	LDA.w $60AA
	PHA
	CLC
	ADC.w #$0200
	CMP.w #$0400
	BCS.b CODE_068997
	PLA
	SEC
	SBC.b $00
	SEC
	SBC.w #$0080
	STA.w $60AA
	BPL.b CODE_068998
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	RTS

CODE_068997:
	PLA
CODE_068998:
	RTS

CODE_068999:
	TYX
	JSR.w CODE_069114
	LDA.w $1066
	BEQ.b CODE_0689AC
	BMI.b CODE_0689A9
	DEC.w $1066
	BRA.b CODE_0689AC

CODE_0689A9:
	INC.w $1066
CODE_0689AC:
	RTS

DATA_0689AD:
	dw $0100,$FF00

CODE_0689B1:
	TYX
	LDY.w $1082
	BNE.b CODE_0689D8
	LDA.w $1086
	BEQ.b CODE_0689E5
	LDY.w $1079
	CPY.b #$4C
	BCC.b CODE_0689D8
	BIT.w #$0001
	BNE.b CODE_0689D9
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w #$0002
	STA.w $106C
	LDY.b #$03
	STY.b $76,x
CODE_0689D8:
	RTS

CODE_0689D9:
	LDA.w $1086
	AND.w #$0002
	TAY
	LDA.w DATA_0689AD,y
	BRA.b CODE_068A1E

CODE_0689E5:
	LDA.w #$00C0
	LDY.w $77C2,x
	BNE.b CODE_0689F1
	EOR.w #$FFFF
	INC
CODE_0689F1:
	STA.b $00
	LDA.w $7C16,x
	STA.b $02
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_068A10
	SEC
	SBC.w #$0006
	EOR.b $02
	BMI.b CODE_068A10
	LDA.b $00
	EOR.w #$FFFF
	INC
	STA.b $00
CODE_068A10:
	LDA.b $00
	LDY.w $1084
	BEQ.b CODE_068A1E
	STZ.w $1084
	EOR.w #$FFFF
	INC
CODE_068A1E:
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDY.w $1079
	TYA
	STA.b $00
	LDA.w #$0200
	SEC
	SBC.b $00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $75E0,x
	LDY.w $1086
	BEQ.b CODE_068A4F
	STZ.w $1086
	LDY.b #$04
	STY.b $76,x
	BRA.b CODE_068A7D

CODE_068A4F:
	LDA.w $7C16,x
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCS.b CODE_068A7B
	LDA.b $10
	BIT.w #$0003
	BEQ.b CODE_068A7B
	STZ.w $106C
	STZ.w $1066
	LDA.w #$0010
	STA.w $7540,x
	LDA.w #$0100
	STA.w $105C
	STA.b $78,x
	LDY.b #$02
	STY.b $76,x
	RTS

CODE_068A7B:
	STZ.b $76,x
CODE_068A7D:
	LDA.w #$0400
	STA.w $105C
	STA.b $78,x
	LDA.w #$FCE0
	STA.w $105E
	LDA.w $75E0,x
	STA.w $10BC
	STZ.w $7540,x
	RTS

CODE_068A95:
	TYX
	LDA.b $78,x
	CMP.w $105C
	BNE.b CODE_068AA7
	LDA.w $75E0,x
	BMI.b CODE_068AAC
CODE_068AA2:
	INC.w $1066
	BRA.b CODE_068AAF

CODE_068AA7:
	LDA.w $75E0,x
	BMI.b CODE_068AA2
CODE_068AAC:
	DEC.w $1066
CODE_068AAF:
	JSR.w CODE_06914C
	LDY.w $1079
	CPY.b #$4C
	BCC.b CODE_068AF9
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098F33>>16
	LDA.w #FXCODE_098F33
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_068AF9
	LDA.w $7CD6,y
	SEC
	SBC.w $7CD6,x
	STA.b $00
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCS.b CODE_068AF9
	LDA.b $00
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BPL.b CODE_068AF9
	LDA.w #$0001
	STA.b $76,x
	STA.w $1086
	LDA.b $00
	BMI.b CODE_068AF9
	LDA.w #$0003
	STA.w $1086
	RTS

CODE_068AF9:
	LDA.w $7860,x
	BIT.w #$000C
	BEQ.b CODE_068B07
	LDA.w #$0003
	STA.w $106C
CODE_068B07:
	RTS

CODE_068B08:
	TYX
	LDA.w $106C
	BNE.b CODE_068B22
	LDA.w $1066
	BMI.b CODE_068B17
	DEC.w $1066
	RTS

CODE_068B17:
	LDY.b #$01
	STY.b $76,x
	STZ.w $1066
	STZ.w $1086
	RTS

CODE_068B22:
	LDA.w $106C
	BIT.w #$0001
	BNE.b CODE_068B3B
	LDA.w $1068
	CLC
	ADC.w #$0040
	STA.w $1068
	CMP.w #$0800
	BNE.b CODE_068B4D
	BRA.b CODE_068B4A

CODE_068B3B:
	LDA.w $1068
	SEC
	SBC.w #$0040
	STA.w $1068
	CMP.w #$0100
	BNE.b CODE_068B4D
CODE_068B4A:
	DEC.w $106C
CODE_068B4D:
	LDA.w $1066
	CMP.w #$0008
	BCS.b CODE_068B58
	INC.w $1066
CODE_068B58:
	RTS

CODE_068B59:
	TYX
	LDY.w $7A38,x
	LDA.w $7182,x
	SEC
	SBC.w $7142,y
	CMP.w #$004A
	BMI.b CODE_068B90
	CMP.w #$004E
	BPL.b CODE_068B7C
	LDA.w #$0018
	STA.w $7542,x
	LDA.w #$0080
	STA.w $75E2,x
	BRA.b CODE_068B90

CODE_068B7C:
	STZ.w $1076
	LDA.w #$000C
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	INC.b $76,x
	JSR.w CODE_0690AA
CODE_068B90:
	JSR.w CODE_069114
	RTS

CODE_068B94:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_068BAC
	LDA.w $1078
	CLC
	ADC.w #$0240
	BMI.b CODE_068BA6
	LDA.w #$FFFF
CODE_068BA6:
	STA.w $1078
	JSR.w CODE_069114
CODE_068BAC:
	RTS

CODE_068BAD:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_068BBD
	STZ.w $1082
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDY.b #$01
	STY.b $76,x
CODE_068BBD:
	RTS

DATA_068BBE:
	dw $0100,$0200

DATA_068BC2:
	dw $0100,$FF00

CODE_068BC6:
	TYX
	LDY.b #$00
	LDA.w $7C16,x
	CLC
	ADC.w #$0050
	CMP.w #$00A0
	BCS.b CODE_068BDB
	STZ.w $617A
	INC.b $76,x
	RTS

CODE_068BDB:
	BPL.b CODE_068BDF
	INY
	INY
CODE_068BDF:
	LDA.w DATA_068BBE,y
	STA.w $617A
	LDA.w $60A8
	SEC
	SBC.w DATA_068BC2,y
	EOR.w DATA_068BC2,y
	BMI.b CODE_068BFA
	LDA.w DATA_068BC2,y
	STA.w $60A8
	STA.w $60B4
CODE_068BFA:
	RTS

DATA_068BFB:
	dw $0080,$0100,$0200,$0400

DATA_068C03:
	dw $FF80,$FF00,$FE00,$FC00

CODE_068C0B:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_068C72
	LDA.w #$0002
	STA.w $7A96,x
	LDA.b $10
	AND.w #$000E
	TAY
	LDA.w DATA_068BFB,y
	STA.b $00
	LDA.b $11
	AND.w #$0006
	TAY
	LDA.w DATA_068C03,y
	STA.b $02
	LDA.b $10
	AND.w #$000F
	SEC
	SBC.w #$0008
	STA.b $04
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr217
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	CLC
	ADC.b $04
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0004
	STA.w $7142,y
	LDA.w #$FFFF
	STA.w $7782,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $02
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	SEP.b #$20
	LDA.b #$FF
	STA.w $7823,y
	REP.b #$20
CODE_068C72:
	LDA.w $1078
	SEC
	SBC.w #$0020
	STA.w $1078
	CMP.w #$2000
	BCS.b CODE_068C89
	LDA.w #$0040
	STA.w $7A96,x
	INC.b $76,x
CODE_068C89:
	RTS

CODE_068C8A:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_068C89
	INC.w $1088
	LDY.w $1088
	CPY.b #$01
	BEQ.b CODE_068CBF
	CPY.b #$02
	BEQ.b CODE_068CA6
	STZ.w $7ECC
	PLA
	JML.l CODE_despawn_sprite_free_slot

CODE_068CA6:
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.b $02
	JSL.l CODE_02E1A3
	LDA.w #$00C0
	STA.w $7A96,x
	RTS

CODE_068CBF:
	LDA.w $7A38,x
CODE_068CC2:
	TAX
	LDA.w #!Define_YI_AmbSpr1C0
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w $7000,y
	AND.w #$FFFC
	STA.w $7000,y
	LDA.w #$FFC0
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0002
	STA.w $7E4C,y
	LDA.w #$0006
	STA.w $7782,y
	JSL.l CODE_03A31E
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	LDX.b #FXCODE_08D46A>>16
	LDA.w #FXCODE_08D46A
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	SEP.b #$10
	LDX.b $12
	LDA.w #$0002	
	STA.w $7A96,x
	LDY.w $10B6
	BEQ.b CODE_068D64
	LDA.w #$0027
	JSL.l CODE_spawn_sprite_init
	LDA.w $7A38,x
	TAX
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$FB00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.w $7D38,y
	LDA.w $1092
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LDA.w $1094
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDA.w #$0215
	STA.w !RAM_YI_Global_MainScreenLayers
	LDX.b $12
	PLA
	JML.l CODE_despawn_sprite_free_slot

CODE_068D64:
	RTS

CODE_068D65:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_068D7F
	DEC.w $105E
	BEQ.b CODE_068D7A
	LDA.w #$0008
	STA.w $7A96,x
	JSR.w CODE_0690D2
	RTS

CODE_068D7A:
	STZ.w $106E
	INC.b $76,x
CODE_068D7F:
	RTS

DATA_068D80:
	dw $B200,$B20A,$B30F,$B412,$B517,$B71B,$BA21,$BF28
	dw $C52F,$C932,$CC33,$CF35,$D438,$D838,$DB39,$DC3A
	dw $E03A,$E13B,$E83B,$EA3A,$EC39,$EF38,$F136,$F531
	dw $F72D,$FA27,$FB25,$FC1F,$FE19,$FF15,$FF0E,$000E
	dw $0000,$00F1,$FFF1,$FFEB,$FEE7,$FCE0,$FBDB,$FAD9
	dw $F7D3,$F5CF,$F1CA,$EFC8,$ECC7,$EAC6,$E8C5,$E1C5
	dw $E0C6,$DCC6,$DBC7,$D8C8,$D4C8,$CFCB,$CCCD,$C9CE
	dw $C5D2,$BFD8,$BADF,$B7E5,$B5E9,$B4EE,$B3F1,$B2F6

DATA_068E00:
	dw $C100,$C106,$C10C,$C112,$C118,$C11E,$C124,$C12A
	dw $C12F,$C52F,$C92F,$CD2F,$D12F,$D52F,$D92F,$DD2F
	dw $E12F,$E52F,$E92F,$ED2F,$F12F,$F52F,$F92F,$FD2F
	dw $002F,$002A,$0024,$001E,$0018,$0012,$000C,$0006
	dw $0000,$00FA,$00F4,$00EE,$00E8,$00E2,$00DC,$00D6
	dw $00D0,$FDD0,$F9D0,$F5D0,$F1D0,$EDD0,$E9D0,$E5D0
	dw $E1D0,$DDD0,$D9D0,$D5D0,$D1D0,$CDD0,$C9D0,$C5D0
	dw $C1D0,$C1D6,$C1DC,$C1E2,$C1E8,$C1EE,$C1F4,$C1FA

CODE_068E80:
	TYX
	LDA.w $106E
	BEQ.b CODE_068E89
	JMP.w CODE_068F82

CODE_068E89:
	PHA
	LDA.w #$0000
	JSL.l CODE_0681A6
	LDA.b $04
	LDX.b #$00
CODE_068E95:
	STA.w $1096,x
	INX
	INX
	CPX.b #$20
	BNE.b CODE_068E95
	LDA.w $108E
	STA.b $00
	LDA.w #$0008
	STA.b $02
	PHB
	SEP.b #$20
	LDA.b #$7E4800>>16
	PHA
	PLB
	REP.b #$30
	LDX.w #$7E4800
	INX
	INX
CODE_068EB6:
	LDA.b $00
	STA.w $0000,x
	LDA.w #$0180
	STA.w $0002,x
	LDA.w #$0018
	STA.w $0004,x
	LDA.w #$1096
	STA.w $0005,x
	LDA.w #$0000
	STA.w $0007,x
	LDA.w #$0018
	STA.w $0008,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,x
	TAX
	DEC.b $02
	BEQ.b CODE_068EF0
	LDA.b $00
	CLC
	ADC.w #$0020
	STA.b $00
	BRA.b CODE_068EB6

CODE_068EF0:
	TXA
	STA.w $7E4800
	PLB
	LDX.b $12
	LDA.w #$0004
	STA.b $0A
	LDA.w $108E
	SEC
	SBC.w #$6800
	STA.b $00
	STA.b $08
	LDA.w $7682,x
	SEC
	SBC.w #$0040
CODE_068F0E:
	STA.b $0E
	CMP.w #$0100
	BCS.b CODE_068F47
	LDY.w #$0006
	LDX.b $12
	LDA.w $7680,x
	SEC
	SBC.w #$0028
CODE_068F21:
	STA.b $0C
	CMP.w #$0130
	BCS.b CODE_068F3A
	LDA.b $00
	BIT.w #$0400
	BEQ.b CODE_068F32
	EOR.w #$0420
CODE_068F32:
	TAX
	LDA.w #$0000
	STA.l $70409E,x
CODE_068F3A:
	LDA.b $0C
	CLC
	ADC.w #$0010
	INC.b $00
	INC.b $00
	DEY
	BNE.b CODE_068F21
CODE_068F47:
	LDA.b $08
	CLC
	ADC.w #$0040
	STA.b $00
	STA.b $08
	LDA.b $0E
	CLC
	ADC.w #$0010
	DEC.b $0A
	BNE.b CODE_068F0E
	LDA.w #$0004
	STA.b $00
	LDX.w $1090
CODE_068F63:
	PHX
	LDY.w #$0006
CODE_068F67:
	LDA.w #$0000
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	INX
	INX
	DEY
	BNE.b CODE_068F67
	PLA
	CLC
	ADC.w #$0020
	TAX
	DEC.b $00
	BNE.b CODE_068F63
	SEP.b #$10
	LDX.b $12
	PLA
CODE_068F82:
	CMP.w #$0100
	BMI.b CODE_068FF0
	LDA.w #$0010
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	INC.w $0CB2
	LDA.w #$00A0
	STA.b $18,x
	STZ.w $7A36,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDY.b #$01
	STY.b $76,x
	STZ.w $105C
	STZ.w $105E
	STZ.w $1060
	STZ.w $1064
	STZ.w $1066
	LDA.w #$0100
	STA.w $1068
	STZ.w $106C
	STZ.w $1084
	STZ.w $1086
	LDA.w #$E000
	STA.w $1078
	STZ.w $106A
	STZ.w $1062
	LDA.w #$FFFF
	STA.w $108A
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $1070
	STZ.w $1082
	STZ.w $1088
	STZ.w $1076
	STZ.w $106E
	STZ.w $1076
	JMP.w CODE_0690AA

CODE_068FF0:
	LDA.w #DATA_068E00
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #DATA_068D80
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #DATA_068D80>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0040
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0021
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$449E
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $106E
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7680,x
	CLC
	ADC.w #$0008
	STA.w $6040
	LDA.w $7682,x
	STA.w $6042
	LDX.b #FXCODE_08E93B>>16
	LDA.w #FXCODE_08E93B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	LDA.b $12
	STA.w $6012
	LDA.w $60B0
	STA.w $6014
	LDA.w $60B2
	STA.w $6016
	LDA.w $60C2
	STA.w $6018
	LDX.b #FXCODE_0A8390>>16
	LDA.w #FXCODE_0A8390
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$30
	LDY.b #$10
	LDA.b #$07
	STY.w !RAM_YI_Global_MainScreenLayers
	STA.w !RAM_YI_Global_SubScreenLayers
	LDA.b #$02
	STA.w !RAM_YI_Global_ColorMathInitialSettings
	LDA.b #$20
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.b #$18
	TSB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDX.b $12
	LDA.w #$637D
	STA.l YI_Global_PaletteMirror[$01].LowByte
	STA.l $702D6E
	LDA.w #$4A75
	STA.l YI_Global_PaletteMirror[$02].LowByte
	STA.l $702D70
	LDA.w #$0000
	STA.l YI_Global_PaletteMirror[$03].LowByte
	STA.l $702D72
	LDA.w $106E
	CLC
	ADC.w #$0008
	STA.w $106E
	RTS

CODE_0690AA:
	LDA.w #$002E
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0690D1
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	TYA
	STA.w $7A38,x
	LDA.w #$0002
	STA.w $7402,y
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0038
	STA.w $7182,y
CODE_0690D1:
	RTS

;---------------------------------------------------------------------------

CODE_0690D2:
	REP.b #$10
	LDX.w $107C
	LDA.l DATA_5FA1A8,x
	STA.l YI_Global_PaletteMirror[$0C].LowByte
	STA.l $702D84
	LDA.l DATA_5FA1A8+$02,x
	STA.l YI_Global_PaletteMirror[$0D].LowByte
	STA.l $702D86
	LDA.l DATA_5FA1A8+$04,x
	STA.l YI_Global_PaletteMirror[$0E].LowByte
	STA.l $702D88
	LDA.l DATA_5FA1A8+$06,x
	STA.l YI_Global_PaletteMirror[$0F].LowByte
	STA.l $702D8A
	TXA
	CLC
	ADC.w #$0008
	STA.w $107C
	SEP.b #$10
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

CODE_069114:
	LDY.w $1070
	BEQ.b CODE_06911E
	LDA.w #$0002
	BRA.b CODE_069129

CODE_06911E:
	LDA.w $7860,x
	AND.w #$0003
	BEQ.b CODE_06915A
	AND.w #$0002
CODE_069129:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDY.w $1060
	BNE.b CODE_06914C
	INC.w $1060
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $10BC
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A36,x
	BMI.b CODE_069146
	EOR.w #$FFFF
	INC
CODE_069146:
	STA.w $7A36,x
	JSR.w CODE_069176
CODE_06914C:
	JSR.w CODE_06919E
	LDA.w $7A36,x
	BPL.b CODE_06916C
	EOR.w #$FFFF
	INC
	BRA.b CODE_06916C

CODE_06915A:
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.w $1060
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w $7A36,x
	BPL.b CODE_06916C
	EOR.w #$FFFF
	INC
CODE_06916C:
	LSR
	LSR
	LSR
	CLC
	ADC.w #$00A0
	STA.b $18,x
	RTS

CODE_069176:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$FF50
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $105C
	STA.b $78,x
	EOR.w #$FFFF
	INC
	STA.w $105E
	RTS

DATA_06919A:
	dw $00C0,$FF40

CODE_06919E:
	LDY.b $76,x
	CPY.b #$02
	BEQ.b CODE_0691AD
	CPY.b #$04
	BNE.b CODE_0691B2
	LDA.w #$4000
	BRA.b CODE_0691DD

CODE_0691AD:
	LDA.w #$0A00
	BRA.b CODE_0691DD

CODE_0691B2:
	LDA.w #$D000
	LDY.w $1086
	BEQ.b CODE_0691BD
	LDA.w #$CC00
CODE_0691BD:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $1079
	TYA
	SEC
	SBC.w #$0100
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w #$2000
CODE_0691DD:
	STA.b $00
	LDA.w $7A36,x
	BPL.b CODE_0691E8
	EOR.w #$FFFF
	INC
CODE_0691E8:
	CLC
	ADC.b $00
	ASL
	AND.w #$FF00
	XBA
	STA.b $0E
	LDA.b $78,x
	CMP.w $7A36,x
	BMI.b CODE_069237
	CMP.w $105C
	BEQ.b CODE_06922E
	LDY.b $76,x
	CPY.b #$02
	BEQ.b CODE_069218
	LDA.w $105E
	BEQ.b CODE_069213
	SEC
	ROR
	CMP.w #$FFE0
	BCC.b CODE_069213
	LDA.w #$0000
CODE_069213:
	STA.w $105E
	BRA.b CODE_069229

CODE_069218:
	INC.w $106C
	LDA.w $106C
	CMP.w #$0004
	BNE.b CODE_069229
	STZ.w $7540,x
	DEC.b $76,x
	RTS

CODE_069229:
	LDA.w $105C
	STA.b $78,x
CODE_06922E:
	LDA.w $7A36,x
	CLC
	ADC.b $0E
	JMP.w CODE_0692B3

CODE_069237:
	CMP.w $105C
	BEQ.b CODE_06923F
	JMP.w CODE_0692AD

CODE_06923F:
	LDY.b $76,x
	CPY.b #$02
	BEQ.b CODE_06925B
	LDA.w $105C
	BEQ.b CODE_06925B
	LSR
	CMP.w #$0020
	BCS.b CODE_069253
	LDA.w #$0000
CODE_069253:
	STA.w $105C
	LDA.w #$01D0
	BRA.b CODE_06925E

CODE_06925B:
	LDA.w #$0600
CODE_06925E:
	STA.b $00
	LDA.w $7A36,x
	BMI.b CODE_0692A8
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_069284
	LDY.b $76,x
	CPY.b #$07
	BEQ.b CODE_0692A8
	LDY.w $1082
	BEQ.b CODE_06927C
	DEY
	BNE.b CODE_06927C
	INC.w $1082
	ASL
CODE_06927C:
	CMP.b $00
	BCC.b CODE_0692A8
	EOR.w #$FFFF
	INC
CODE_069284:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID34_BurtJump
	JSL.l CODE_push_sound_queue
	LDA.w $10BC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $1070
	LDA.w #$0010
	STA.w $7542,x
	LDY.w $1082
	BEQ.b CODE_0692E4
	LDA.w #$00C0
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0692A8:
	LDA.w $105E
	STA.b $78,x
CODE_0692AD:
	LDA.w $7A36,x
	SEC
	SBC.b $0E
CODE_0692B3:
	STA.w $7A36,x
	LDA.w $105C
	ORA.w $105E
	BNE.b CODE_0692E4
	LDY.b $76,x
	CPY.b #$06
	BNE.b CODE_0692D3
	LDA.w #$FE00
	JSR.w CODE_069176
	LDA.w #$0020
	STA.w $7A96,x
	INC.b $76,x
	RTS

CODE_0692D3:
	CPY.b #$07
	BNE.b CODE_0692E0
	LDA.w #$0040
	STA.w $7A96,x
	INC.b $76,x
	RTS

CODE_0692E0:
	LDY.b #$01
	STY.b $76,x
CODE_0692E4:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Eyes Of Salvo The Slime ($02E) -- Init handler.
; No-op Init. The eyes are spawned by the Salvo body ($02D) once it is in
; place; their position/visibility is fully driven by Main + the Salvo
; phase. Raidenthequick: init_salvo_eyes. See docs/bossengine.md.
;-------------------------------------------------------------------------
YI_NorSpr02E_EyesOfSalvoTheSlime_Init:
init_salvo_eyes:                           ; Raidenthequick: init_salvo_eyes
;$0692E5
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Eyes Of Salvo The Slime ($02E) -- Main handler.
; Runs every frame the eyes sprite is alive. Calls into bank-3 shared
; sprite-bookkeeping ($03AF23), then per-frame blink/track logic via
; CODE_069329. The state byte at $76,x switches between idle and blink.
; Raidenthequick: main_salvo_eyes.
;-------------------------------------------------------------------------
YI_NorSpr02E_EyesOfSalvoTheSlime_Main:
main_salvo_eyes:                           ; Raidenthequick: main_salvo_eyes
;$0692E6
	JSL.l CODE_03AF23
	JSR.w CODE_069329
	LDA.w $7A96,x
	BNE.b CODE_069326
	LDA.b $76,x
	BEQ.b CODE_06931A
	BIT.w #$0001
	BNE.b CODE_069305
	DEC.w $7402,x
	LDA.w $7402,x
	BNE.b CODE_069312
	BRA.b CODE_069310

CODE_069305:
	INC.w $7402,x
	LDA.w $7402,x
	CMP.w #$0002
	BNE.b CODE_069312
CODE_069310:
	DEC.b $76,x
CODE_069312:
	LDA.w #$0004
	STA.w $7A96,x
	BRA.b CODE_069326

CODE_06931A:
	LDA.b $10
	BIT.w #$001F
	BNE.b CODE_069326
	LDA.w #$0004
	STA.b $76,x
CODE_069326:
	INC.b $16,x
	RTL

CODE_069329:
	LDA.b $78,x
	STA.b $0E
	LDA.w $7C16,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7C18,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	JSR.w CODE_069395
	SEP.b #$20
	LDA.b $0E
	CMP.b $02
	BEQ.b CODE_06936C
	LDA.b $0E
	BMI.b CODE_069362
	LDA.b $02
	BMI.b CODE_06936A
	CMP.b $0E
	BCC.b CODE_06936A
CODE_06935E:
	INC.b $0E
	BRA.b CODE_06936C

CODE_069362:
	LDA.b $02
	BPL.b CODE_06935E
	CMP.b $0E
	BCS.b CODE_06935E
CODE_06936A:
	DEC.b $0E
CODE_06936C:
	LDA.b $0F
	CMP.b $04
	BEQ.b CODE_06938E
	LDA.b $0F
	BMI.b CODE_069382
	LDA.b $04
	BMI.b CODE_06938C
	CMP.b $0F
	BCC.b CODE_06938C
CODE_06937E:
	INC.b $0F
	BRA.b CODE_06938E

CODE_069382:
	LDA.b $04
	BEQ.b CODE_06938E
	BPL.b CODE_06937E
	CMP.b $0F
	BCS.b CODE_06937E
CODE_06938C:
	DEC.b $0F
CODE_06938E:
	REP.b #$20
	LDA.b $0E
	STA.b $78,x
	RTS

CODE_069395:
	REP.b #$10
	ASL
	TAX
	PHX
	LDA.l DATA_cosine_lut_8bit_radians,x
	SEP.b #$20
	STA.w !REGISTER_Mode7MatrixParameterA
	XBA
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.b #$10
	STA.w !REGISTER_Mode7MatrixParameterB
	LDA.w !REGISTER_PPUMultiplicationProductMid
	STA.b $02
	BPL.b CODE_0693B7
	LDA.b #$FF
	BRA.b CODE_0693B9

CODE_0693B7:
	LDA.b #$00
CODE_0693B9:
	STA.b $03
	REP.b #$20
	PLX
	LDA.l DATA_sine_lut_8bit_radians,x
	SEP.b #$20
	STA.w !REGISTER_Mode7MatrixParameterA
	XBA
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.b #$10
	STA.w !REGISTER_Mode7MatrixParameterB
	LDA.w !REGISTER_PPUMultiplicationProductMid
	STA.b $04
	BPL.b CODE_0693DB
	LDA.b #$FF
	BRA.b CODE_0693DD

CODE_0693DB:
	LDA.b #$00
CODE_0693DD:
	STA.b $05
	REP.b #$20
	SEP.b #$10
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Lemon Drop ($132) -- Init handler.
; Seeds the per-slot state byte $76,x with $05 (the "fall" phase) and
; returns. Lemon Drops are the yellow acid droplets that fall from
; ceiling stalactites in W3 yellow-cliff cave levels.
; Raidenthequick: init_lemon_drop.
;-------------------------------------------------------------------------
YI_NorSpr132_LemonDrop_Init:
init_lemon_drop:                           ; Raidenthequick: init_lemon_drop
;$0693E6
	LDY.b #$05
	STY.b $76,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Lemon Drop ($132) -- Main state-pointer table.
; 11 entries covering: form-up, drop, splat, despawn, plus mirrored
; entries for the post-bounce phase. Indexed by $76,x.
;-------------------------------------------------------------------------
DATA_0693EB:
DATA_lemon_drop_state_ptr:
	dw CODE_0694F0
	dw CODE_069531
	dw CODE_069587
	dw CODE_0695BC
	dw CODE_069625
	dw CODE_06966D
	dw CODE_0694F0
	dw CODE_069531
	dw CODE_0696C0
	dw CODE_069703
	dw CODE_06974F

;-------------------------------------------------------------------------
; Lemon Drop ($132) -- Main handler.
; Runs every frame: clamps !CurrentStatus, then dispatches through
; DATA_lemon_drop_state_ptr. Death-on-touch: contact with Yoshi triggers damage.
; Raidenthequick: main_lemon_drop.
;-------------------------------------------------------------------------
YI_NorSpr132_LemonDrop_Main:
main_lemon_drop:                           ; Raidenthequick: main_lemon_drop
;$069401
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_06941D
CODE_069409:
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState02_InCutscene
	BNE.b CODE_06943E
	CMP.b $78,x
	BNE.b CODE_06943E
	LDA.w #!Define_YI_PlayerState00_Normal
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	BRA.b CODE_06943E

CODE_06941D:
	LDA.w $7D96,x
	BEQ.b CODE_069427
	STZ.w $6FA2,x
	BRA.b CODE_069409

CODE_069427:
	LDY.w $7D38,x
	BEQ.b CODE_06943E
	LDA.w #$0002
	STA.w $74A2,x
	STZ.w $7402,x
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_06943E:
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_lemon_drop_state_ptr,x)
	JSR.w CODE_06945F
	LDA.w $7AF6,x
	BNE.b CODE_06945B
	LDA.w $6FA0,x
	ORA.w #$0600
	STA.w $6FA0,x
CODE_06945B:
	JML.l CODE_0DC0F0

CODE_06945F:
	LDA.b $18,x
	BNE.b CODE_069486
	LDY.w $7D36,x
	BPL.b CODE_0694E3
	LDY.b $76,x
	CPY.b #$03
	BEQ.b CODE_0694E7
	CPY.b #$04
	BEQ.b CODE_0694E7
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCS.b CODE_069487
CODE_069482:
	JSL.l CODE_03A858
CODE_069486:
	RTS

CODE_069487:
	LDY.w $60AB
	BMI.b CODE_0694E7
	LDY.w $60C0
	BEQ.b CODE_069482
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0694E7
	LDA.w #$0020
	CMP.w $61D6
	BMI.b CODE_0694A4
	STA.w $61D6
CODE_0694A4:
	LDA.w $6086
	AND.w $0035
	STA.w $617A
	LDA.w $0037
	AND.w $6086
	STA.w $617C
	STZ.w $60D4
	LDA.w #!Define_YI_PlayerState02_InCutscene
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STA.b $78,x
	LDA.w #$7C60
	STA.w $6FA0,x
	STZ.w $60A8
	STZ.w $60B4
	STZ.w $60AA
	STZ.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.w $7A98,x
	STA.w $7402,x
	LDY.b #$03
	STY.b $76,x
	RTS

CODE_0694E3:
	JSL.l CODE_03A5B7
CODE_0694E7:
	RTS

DATA_0694E8:
	db $08,$09,$00,$01

DATA_0694EC:
	db $10,$06,$05,$04

CODE_0694F0:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_06951E
	INC.b $16,x
	LDY.b $16,x
	CPY.b #$05
	BNE.b CODE_06950C
	LDA.w #$0040
	STA.w $7542,x
	STZ.b $16,x
	STZ.w $7402,x
	INC.b $76,x
	RTS

CODE_06950C:
	LDA.w DATA_0694E8-$01,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_0694EC-$01,y
	AND.w #$00FF
	STA.w $7A98,x
CODE_06951E:
	RTS

DATA_06951F:
	db $01,$04,$05,$06,$01,$00,$02,$00,$01

DATA_069528:
	db $02,$02,$02,$02,$02,$02,$04,$02,$30

CODE_069531:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_069582
	LDA.w $7A98,x
	BNE.b CODE_069582
	INC.b $16,x
	LDY.b $16,x
	LDA.w DATA_06951F-$01,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_069528-$01,y
	AND.w #$00FF
	STA.w $7A98,x
	CPY.b #$02
	BNE.b CODE_069561
	LDA.w #!Define_YI_SoundID60_Splash2
	JSL.l CODE_push_sound_queue
	RTS

CODE_069561:
	CPY.b #$09
	BMI.b CODE_069582
	LDA.w $7A98,x
	STA.w $7A96,x
	LDY.w $77C2,x
	TYA
	STA.w $7400,x
	INC.b $76,x
	LDY.b $76,x
	CPY.b #$08
	BNE.b CODE_069582
	LDA.w #$0007
	STA.b $16,x
	INC.w $1015
CODE_069582:
	RTS

DATA_069583:
	dw $FFC0,$0040

CODE_069587:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0695B5
	STZ.b $18,x
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0695B5
	LDY.w $7400,x
	LDA.w DATA_069583,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A98,x
	BNE.b CODE_0695B5
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w $7402,x
	INC
	AND.w #$0003
	STA.w $7402,x
CODE_0695B5:
	RTS

DATA_0695B6:
	dw $001A,$0018,$0014

CODE_0695BC:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_069606
	INC.b $16,x
	INC.b $16,x
	LDY.b $16,x
	CPY.b #$06
	BMI.b CODE_0695FD
	LDA.w #$0003
	STA.w $7A96,x
	LDA.w #!Define_YI_AmbSpr1D2
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.w $7CD8,x
	STA.w $7142,y
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	SEP.b #$20
	LDA.b #$FF
	STA.w $7823,y
	REP.b #$20
	INC.b $76,x
	RTS

CODE_0695FD:
	LDA.w #$0004
	STA.w $7A98,x
	INC.w $7402,x
CODE_069606:
	LDA.w $60FC
	AND.w #$0007
	BNE.b CODE_069624
	LDY.b $16,x
	LDA.w $7182,x
	SEC
	SBC.w DATA_0695B6,y
	SEC
	SBC.w $6112
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60AA
	INC.w $61B4
CODE_069624:
	RTS

CODE_069625:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_069643
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_PlayerState00_Normal
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $617A
	STZ.w $617C
	PLA
	JML.l CODE_despawn_sprite_free_slot

CODE_069643:
	LDA.w $7CD6,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0040
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #$0200
	STA.w $6000
	LDA.w #$FE00
	STA.w $6002
	LDX.b #FXCODE_099253>>16
	LDA.w #FXCODE_099253
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	RTS

CODE_06966D:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_069691
	INC
	BNE.b CODE_069691
	INC
	STA.w $7402,x
	INC
	STA.w $74A2,x
	STA.b $76,x
	LDA.w #$0030
	STA.w $7A96,x
	LDY.w $77C2,x
	TYA
	STA.w $7400,x
	RTS

CODE_069691:
	LDA.w $7C16,x
	CLC
	ADC.w #$0030
	CMP.w #$0060
	BCS.b CODE_0696B8
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0007
	STA.w $7402,x
	INC
	STA.w $7A98,x
	LDA.w #$0002
	STA.w $74A2,x
	STZ.b $76,x
CODE_0696B8:
	RTS

DATA_0696B9:
	db $04,$05,$06,$05,$04,$00,$02

CODE_0696C0:
	TYX
	LDA.w $1015
	BPL.b CODE_0696FE
	LDA.w $7A98,x
	BNE.b CODE_0696FE
	DEC.b $16,x
	BPL.b CODE_0696ED
	LDA.w #$0002
	STA.w $7402,x
	STA.b $16,x
	LDA.w #$FA00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w $7860,x
	INC.b $76,x
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	RTS

CODE_0696ED:
	LDY.b $16,x
	LDA.w DATA_0696B9,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7A98,x
CODE_0696FE:
	RTS

DATA_0696FF:
	db $07,$08

DATA_069701:
	db $08,$10

CODE_069703:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_069722
	LDA.w $7860,x
	AND.w #$0002
	BEQ.b CODE_06974E
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	AND.w #$FFF0
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_069722:
	LDA.w $7A98,x
	BNE.b CODE_06974E
	DEC.b $16,x
	BPL.b CODE_06973A
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w #$00FF
	STA.w $74A2,x
	INC.b $76,x
	RTS

CODE_06973A:
	LDY.b $16,x
	LDA.w DATA_0696FF,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_069701,y
	AND.w #$00FF
	STA.w $7A98,x
CODE_06974E:
	RTS

CODE_06974F:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_06975F
	STZ.w $1015
	INC.w $105A
	JSL.l CODE_03A31E
CODE_06975F:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Burt The Bashful ($046) -- boss Init handler.
; Burt is the boss of World 1-4 (the pants-falling sumo). Init performs:
;   - shared-sprite setup ($03AEEB) and palette load ($0CE5D6 with idx $24)
;   - boss-state config (DBR-relative coords + horizontal speed $7A38)
;   - initial Y velocity, decompressed graphics handle
; The big sprite is drawn via the SuperFX with the "stretch the pants
; down" effect chained through later state-machine entries.
; Caller invariants: M=8, X=16. DBR is set to bank $06.
; Raidenthequick: init_burt. See docs/bossengine.md.
;-------------------------------------------------------------------------
YI_NorSpr046_BurtTheBashful_Init:
init_burt:                                 ; Raidenthequick: init_burt
;$069760
	JSL.l CODE_03AEEB
	LDY.b #$24
	JSL.l CODE_0CE5D6
	LDA.w #$0080
	STA.w $7E1A
	LDA.w $7182,x
	CLC
	ADC.w #$000F
	STA.w $7182,x
	LDA.w #$FFF8
	STA.w $7A38,x
	LDA.w #$0100
	STA.b $18,x
	STA.b $76,x
	LDA.w $6FA2,x
	ORA.w #$0001
	STA.w $6FA2,x
	LDA.w #$0200
	STA.w $7A98,x
	LDA.w #$FFF4
	STA.w $7720,x
	LDA.w #$0010
	STA.w $1066
	LDA.w #$0010
	STA.w $1064
	LDA.w #$0040
	STA.w $7542,x
	SEP.b #$20
	LDA.b #$04
	STA.w $7A37,x
	LDA.b #$40
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.b #$0A
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.b #$01
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	REP.b #$20
	LDA.w $7402,x
	ASL
	TAY
	LDA.w DATA_06A421,y
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$001C
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$6000
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6000)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	REP.b #$10
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0040
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #FXDATA_560000+$6020
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6020)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	SEP.b #$10
	LDX.b #FXCODE_08861B>>16
	LDA.w #FXCODE_08861B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	REP.b #$10
	LDA.w #$0001
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000E
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0040
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #FXDATA_560000+$6030
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6030)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	SEP.b #$10
	LDX.b #FXCODE_08861B>>16
	LDA.w #FXCODE_08861B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $7402,x
	ASL
	ASL
	TAY
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w DATA_06A409,y
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	PHX
	PHY
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLY
	PLX
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	CMP.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BPL.b CODE_0698BB
	LDA.w DATA_06A409+$02,y
	BEQ.b CODE_0698BE
	LDA.w DATA_06A409+$02,y
	EOR.w #$FFFF
	INC
	AND.w #$00FF
	BRA.b CODE_0698BE

CODE_0698BB:
	LDA.w DATA_06A409+$02,y
CODE_0698BE:
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0060
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$6040
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6040)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_0884A5>>16
	LDA.w #FXCODE_0884A5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $7402,x
	ASL
	TAY
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w DATA_06A419,y
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	PHX
	PHY
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLY
	PLX
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	STA.b $00
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0050
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$7030
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$7030)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_08861B>>16
	LDA.w #FXCODE_08861B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.b $00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0050
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$7020
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$7020)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_08861B>>16
	LDA.w #FXCODE_08861B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	JSR.w CODE_06A740
	RTL

;---------------------------------------------------------------------------

DATA_069988:
DATA_burt_bashful_postdispatch_ptr:             ; 3-entry post-dispatch ptr (per phase < 4): physics/anim/cleanup invoked after main state
	dw CODE_06A429
	dw CODE_06A5A6
	dw CODE_06A740

DATA_06998E:
DATA_burt_bashful_phase_dispatch:               ; 3-entry phase dispatch (indexed by $7A37,x = boss phase)
	dw CODE_06A36F
	dw CODE_06A36F
	dw CODE_06A3EF

DATA_069994:
	dw $00E0,$00D0,$00C0,$00C0,$00C0,$00C0

DATA_0699A0:
	dw $FA00,$FA40,$FA80,$FAC0,$FB00,$FB40,$F600,$F680
	dw $F700,$F780,$F800,$F880

DATA_0699B8:
	dw DATA_5FE7A6,DATA_5FE640,DATA_5FE640,DATA_5FE640,DATA_5FE640,DATA_5FE640

DATA_0699C4:
	dw DATA_5FE7DA,DATA_5FA5D8,DATA_5FA5D8,DATA_5FA5D8,DATA_5FA5D8,DATA_5FA5D8

DATA_0699D0:
	dw DATA_5FE7FA,DATA_5FA5F6,DATA_5FA5F6,DATA_5FA5F6,DATA_5FA5F6,DATA_5FA5F6

;-------------------------------------------------------------------------
; Burt The Bashful ($046) -- boss Main handler.
; Frame loop: dispatch via DATA_burt_bashful_phase_dispatch using $7A37,x as the phase index,
; then run shared bookkeeping ($06A77F) for phases < $04. The state
; machine covers intro, pants-fall sequence, bounce attacks, and defeat.
; Caller invariants: M=8, X=16. DBR is set to bank $06.
; Raidenthequick: main_burt.
;-------------------------------------------------------------------------
YI_NorSpr046_BurtTheBashful_Main:
main_burt:                                 ; Raidenthequick: main_burt
;$0699DC
	LDY.w $7A37,x
	TYX
	JSR.w (DATA_burt_bashful_phase_dispatch,x)
	LDY.w $7A37,x
	CPY.b #$04
	BCS.b CODE_0699ED
	JSR.w CODE_06A77F
CODE_0699ED:
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_0699F9
	LDY.w $7A37,x
	TYX
	JSR.w (DATA_burt_bashful_postdispatch_ptr,x)
CODE_0699F9:
	JSL.l CODE_03AF23
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	BNE.b CODE_069A19
	LDY.w $7A37,x
	CPY.b #$04
	BCS.b CODE_069A19
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CPY.b #$7F
	BCS.b CODE_069A19
	LDA.w $601A
	BEQ.b CODE_069A19
	JSL.l CODE_03A858
CODE_069A19:
	LDY.b $78,x
	BEQ.b CODE_069A21
	TYX
	JSR.w (DATA_burt_bashful_substep_ptr,x)
CODE_069A21:
	LDY.w $7A36,x
	TYX
	JMP.w (DATA_burt_bashful_anim_state_ptr,x)

DATA_069A28:
DATA_burt_bashful_substep_ptr:                  ; 3-entry sub-step dispatch (indexed by $78,x) for the bounce/attack pattern
	dw CODE_06A31F
	dw CODE_06A322
	dw CODE_06A34D

DATA_069A2E:
DATA_burt_bashful_anim_state_ptr:               ; 9-entry animation/visual state ptr (indexed by $7A36,x animation phase)
	dw CODE_069A7A
	dw CODE_069AD3
	dw CODE_069B36
	dw CODE_069BAD
	dw CODE_069BC0
	dw CODE_069C22
	dw CODE_069C56
	dw CODE_069C8E
	dw CODE_069CC6
	dw CODE_069CF5
	dw CODE_069D20
	dw CODE_069D65
	dw CODE_069DB7
	dw CODE_069DE4
	dw CODE_069E6A
	dw CODE_069EA9
	dw CODE_069F2D
	dw CODE_069F6A
	dw CODE_069FF4
	dw CODE_069FD5
	dw CODE_069FF4
	dw CODE_069FD5
	dw CODE_069FF4
	dw CODE_069FD5
	dw CODE_069FF4
	dw CODE_069FD5
	dw CODE_069FF4
	dw CODE_069FD5
	dw CODE_069FF4
	dw CODE_069FD5
	dw CODE_069FC4
	dw CODE_06A029
	dw CODE_06A044
	dw CODE_06A089
	dw CODE_06A0AF
	dw CODE_06A18F
	dw CODE_06A1DA
	dw CODE_06A305

CODE_069A7A:
	LDX.b $12
	LDA.w $60C0
	BNE.b CODE_069AD2
	LDA.w $7A96,x
	BNE.b CODE_069AD2
	LDA.b $18,x
	CLC
	ADC.w $1064
	STA.b $18,x
	LDA.b $76,x
	SEC
	SBC.w $1066
	STA.b $76,x
	CMP.w #$00C0
	BCS.b CODE_069AB0
	LDA.w $1066
	EOR.w #$FFFF
	INC
	STA.w $1066
	LDA.w $1064
	EOR.w #$FFFF
	INC
	STA.w $1064
	RTL

CODE_069AB0:
	CMP.w #$0100
	BCC.b CODE_069AD2
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
CODE_069AD2:
	RTL

CODE_069AD3:
	LDX.b $12
	LDA.b $76,x
	CMP.w #$0140
	BCS.b CODE_069AEA
	SEC
	SBC.w $1066
	STA.b $76,x
	LDA.b $18,x
	CLC
	ADC.w $1064
	STA.b $18,x
CODE_069AEA:
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_069B17
	STZ.w $7402,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $1066
	EOR.w #$FFFF
	INC
	STA.w $1066
	LDA.w $1064
	EOR.w #$FFFF
	INC
	STA.w $1064
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	RTL

CODE_069B17:
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_069B2B
	INY
	EOR.w #$FFFF
	INC
	CMP.w #$0300
	BCS.b CODE_069B31
	INY
	BRA.b CODE_069B31

CODE_069B2B:
	CMP.w #$0200
	BCS.b CODE_069B31
	INY
CODE_069B31:
	TYA
	STA.w $7402,x
	RTL

CODE_069B36:
	LDX.b $12
	LDA.b $18,x
	CLC
	ADC.w $1064
	STA.b $18,x
	LDA.b $76,x
	SEC
	SBC.w $1066
	STA.b $76,x
	LDY.w $1067
	BMI.b CODE_069B67
	CMP.w #$00C0
	BCS.b CODE_069B66
	LDA.w $1066
	EOR.w #$FFFF
	INC
	STA.w $1066
	LDA.w $1064
	EOR.w #$FFFF
	INC
	STA.w $1064
CODE_069B66:
	RTL

CODE_069B67:
	CMP.w #$0100
	BCC.b CODE_069BA1
	LDA.w #$0100
	STA.b $18,x
	STA.b $76,x
	LDA.w $70E2,x
	CMP.w #$00B0
	BCC.b CODE_069BA2
	LDA.w $1066
	EOR.w #$FFFF
	INC
	STA.w $1066
	LDA.w $1064
	EOR.w #$FFFF
	INC
	STA.w $1064
	SEP.b #$20
	LDA.b #$10
	STA.w $7A96,x
	LDA.w $7A36,x
	SEC
	SBC.b #$04
	STA.w $7A36,x
	REP.b #$20
CODE_069BA1:
	RTL

CODE_069BA2:
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	RTL

CODE_069BAD:
	LDX.b $12
	LDA.w #$0001
	STA.w $1015
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	RTL

CODE_069BC0:
	LDX.b $12
	LDA.w $1015
	BMI.b CODE_069BC8
	RTL

CODE_069BC8:
	LDA.w #$0008
	STA.w $1066
	LDA.w #$0008
	STA.w $1064
	LDX.b #$3C
CODE_069BD6:
	LDA.l DATA_5FE640,x
	STA.l $702E2E,x
	STA.l YI_Global_PaletteMirror[$61].LowByte,x
	DEX
	DEX
	BPL.b CODE_069BD6
	LDX.b $12
	SEP.b #$20
	LDA.b #!REGISTER_BG2HorizScrollOffset
	STA.w HDMA[$03].Destination
	LDA.b #!REGISTER_BG2VertScrollOffset
	STA.w HDMA[$04].Destination
	REP.b #$20
	LDA.w #$0030
	STA.w $6126
	LDA.w $7042
	AND.w #$FFCF
	ORA.w #$0030
	STA.w $7042
	LDA.w #$0510
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7720,x
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	RTL

CODE_069C22:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0400
	BMI.b CODE_069C55
	LDA.w #$0030
	STA.b $18,x
	STA.b $76,x
	STZ.w $1015
	SEP.b #$20
	LDA.b #$02
	STA.w $7A37,x
	LDA.w $6FA2,x
	AND.b #$E0
	STA.w $6FA2,x
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID20_SoaringEgg
	JSL.l CODE_push_sound_queue
CODE_069C55:
	RTL

CODE_069C56:
	LDX.b $12
	LDA.b $76,x
	CLC
	ADC.w $1066
	STA.b $76,x
	CMP.w #$0030
	BCC.b CODE_069C71
	CMP.w #$0100
	BCC.b CODE_069C70
	LDA.w #$FFE0
	STA.w $1066
CODE_069C70:
	RTL

CODE_069C71:
	LDA.w #$0030
	STA.b $76,x
	LDA.w #$0010
	STA.w $1066
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID20_SoaringEgg
	JSL.l CODE_push_sound_queue
	RTL

CODE_069C8E:
	LDX.b $12
	LDA.b $18,x
	CLC
	ADC.w $1064
	STA.b $18,x
	CMP.w #$0030
	BCC.b CODE_069CA9
	CMP.w #$0100
	BCC.b CODE_069CA8
	LDA.w #$FFE0
	STA.w $1064
CODE_069CA8:
	RTL

CODE_069CA9:
	LDA.w #$0030
	STA.b $18,x
	LDA.w #$0010
	STA.w $1064
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID20_SoaringEgg
	JSL.l CODE_push_sound_queue
	RTL

CODE_069CC6:
	LDX.b $12
	LDA.b $76,x
	CLC
	ADC.w $1066
	STA.b $76,x
	LDA.b $18,x
	CLC
	ADC.w $1064
	STA.b $18,x
	CMP.w #$0100
	BMI.b CODE_069CF4
	LDA.w #$0100
	STA.b $18,x
	LDA.w #$0100
	STA.b $76,x
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	STZ.w $7A37,x
	REP.b #$20
CODE_069CF4:
	RTL

CODE_069CF5:
	LDX.b $12
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_069D00
	RTL

CODE_069D00:
	LDA.w #$0020
	STA.w $7542,x
	LDA.w #$0300
	STA.w $75E2,x
	LDA.w #$0040
	STA.w $61C6
	STZ.w $1062
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	RTL

CODE_069D20:
	LDX.b $12
	LDA.b $18,x
	SEC
	SBC.w $7A38,x
	STA.b $18,x
	LDA.b $76,x
	CLC
	ADC.w $7A38,x
	STA.b $76,x
	CMP.w #$00C0
	BCS.b CODE_069D43
	LDA.w $7A38,x
	EOR.w #$FFFF
	INC
	STA.w $7A38,x
	LDA.b $76,x
CODE_069D43:
	CMP.w #$0100
	BCC.b CODE_069D64
	LDA.w #$0100
	STA.b $18,x
	STA.b $76,x
	LDA.w #$FFF8
	STA.w $7A38,x
	SEP.b #$20
	LDA.b #$40
	STA.w $7A98,x
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
CODE_069D64:
	RTL

CODE_069D65:
	LDX.b $12
	LDA.w $7A98,x
	BNE.b CODE_069D9F
	SEP.b #$20
	LDA.b $14
	BIT.b #$01
	BEQ.b CODE_069D81
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.b #$01
	CMP.b #$20
	BCC.b CODE_069DA0
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_069D81:
	LDY.b $78,x
	BNE.b CODE_069D9D
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.b #$20
	BEQ.b CODE_069DA0
	BCC.b CODE_069DA0
	LDA.b #$04
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	LDA.b #$07
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D9|!EXRAMBankMirror,x
	LDA.b #$02
	STA.w $7A96,x
CODE_069D9D:
	REP.b #$20
CODE_069D9F:
	RTL

CODE_069DA0:
	LDA.b #$20
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.b $78,x
	BNE.b CODE_069DB4
	LDA.b #$20
	STA.w $7A98,x
	INC.w $7A36,x
	INC.w $7A36,x
CODE_069DB4:
	REP.b #$20
	RTL

CODE_069DB7:
	LDX.b $12
	LDA.w $7A98,x
	BNE.b CODE_069DCB
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
CODE_069DCB:
	RTL

DATA_069DCC:
	dw $FEC0,$0140,$FEF0,$0110,$FF40,$00C0,$FF58,$00A8
	dw $FF70,$0090,$FF80,$0080

CODE_069DE4:
	LDX.b $12
	JSL.l CODE_06A860
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_069E4A
	LDA.w $1062
	BEQ.b CODE_069E07
	LDA.w #!Define_YI_SoundID23_GroundPound
	JSL.l CODE_push_sound_queue
	LDA.w #$0020
	STA.w $61C6
	STZ.w $1062
CODE_069E07:
	LDA.w $7A38,x
	BMI.b CODE_069E4B
	LDA.b $76,x
	CMP.w #$0110
	BMI.b CODE_069E4B
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w DATA_0699A0,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$00FF
	ASL
	ORA.w $7400,x
	TAY
	LDA.w DATA_069DCC,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	INC.w $1062
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
CODE_069E4A:
	RTL

CODE_069E4B:
	LDA.b $18,x
	SEC
	SBC.w $7A38,x
	STA.b $18,x
	LDA.b $76,x
	CLC
	ADC.w $7A38,x
	STA.b $76,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w DATA_069994,y
	BPL.b CODE_069E69
	LDA.w #$0008
	STA.w $7A38,x
CODE_069E69:
	RTL

CODE_069E6A:
	LDX.b $12
	JSL.l CODE_06A860
	LDA.b $18,x
	CMP.w #$00A0
	BCC.b CODE_069E85
	SEC
	SBC.w $7A38,x
	STA.b $18,x
	LDA.b $76,x
	CLC
	ADC.w $7A38,x
	STA.b $76,x
CODE_069E85:
	LDY.w $7223,x
	BPL.b CODE_069E98
	LDA.b $16,x
	CMP.w #$3000
	BPL.b CODE_069E98
	CLC
	ADC.w #$0800
	STA.b $16,x
	RTL

CODE_069E98:
	LDA.w #$0400
	STA.w $105C
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	RTL

CODE_069EA9:
	LDX.b $12
	JSL.l CODE_06A860
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0100
	BMI.b CODE_069EBE
	LDA.w #$FFF8
	STA.w $7A38,x
CODE_069EBE:
	LDA.b $18,x
	CMP.w #$00A0
	BCS.b CODE_069ECA
	LDY.w $7A39,x
	BPL.b CODE_069EDD
CODE_069ECA:
	CMP.w #$0100
	BCS.b CODE_069EDD
	SEC
	SBC.w $7A38,x
	STA.b $18,x
	LDA.b $76,x
	CLC
	ADC.w $7A38,x
	STA.b $76,x
CODE_069EDD:
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_069F1A
CODE_069EE5:
	LDY.w $7223,x
	BMI.b CODE_069EFB
	LDA.b $16,x
	BEQ.b CODE_069F19
	BPL.b CODE_069EF5
	LDA.w #$0000
	BRA.b CODE_069F17

CODE_069EF5:
	CLC
	ADC.w #$FE00
	BRA.b CODE_069F17

CODE_069EFB:
	LDA.b $16,x
	CMP.w #$2800
	BCC.b CODE_069F07
	CMP.w #$3000
	BCC.b CODE_069F13
CODE_069F07:
	LDA.w $105C
	EOR.w #$FFFF
	INC
	STA.w $105C
	LDA.b $16,x
CODE_069F13:
	CLC
	ADC.w $105C
CODE_069F17:
	STA.b $16,x
CODE_069F19:
	RTL

CODE_069F1A:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $16,x
	SEP.b #$20
	LDA.w $7A36,x
	SEC
	SBC.b #$04
	STA.w $7A36,x
	REP.b #$20
	RTL

CODE_069F2D:
	LDX.b $12
	JSR.w CODE_06A978
	LDA.b $18,x
	CMP.w #$0080
	BCC.b CODE_069F4B
	LDA.b $18,x
	SEC
	SBC.w $7A38,x
	STA.b $18,x
	LDA.b $76,x
	CLC
	ADC.w $7A38,x
	STA.b $76,x
	BRA.b CODE_069EE5

CODE_069F4B:
	LDA.w #$0080
	STA.b $18,x
	LDA.w #$0180
	STA.b $76,x
	LDA.w $7A38,x
	EOR.w #$FFFF
	INC
	STA.w $7A38,x
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	RTL

CODE_069F6A:
	LDX.b $12
	JSR.w CODE_06A978
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_069FA0
	LDA.b $18,x
	CMP.w #$0080
	BCC.b CODE_069F83
	CMP.w #$00C0
	BCC.b CODE_069F8D
CODE_069F83:
	LDA.w $7A38,x
	EOR.w #$FFFF
	INC
	STA.w $7A38,x
CODE_069F8D:
	LDA.b $18,x
	SEC
	SBC.w $7A38,x
	STA.b $18,x
	LDA.b $76,x
	CLC
	ADC.w $7A38,x
	STA.b $76,x
	JMP.w CODE_069EE5

CODE_069FA0:
	LDA.w #!Define_YI_SoundID23_GroundPound
	JSL.l CODE_push_sound_queue
	LDA.w #$0060
	STA.w $61C6
	STZ.w $1062
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FFF0
	STA.w $7A38,x
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	RTL

CODE_069FC4:
	LDX.b $12
	LDA.b $18,x
	CMP.w #$0100
	BMI.b CODE_06A015
	LDA.w #$0010
	STA.w $7A98,x
	BRA.b CODE_069FFD

CODE_069FD5:
	LDX.b $12
	LDA.b $18,x
	CMP.w $1060
	BPL.b CODE_06A015
	LDA.w $105E
	SEC
	SBC.w #$0010
	STA.w $105E
	LDA.w $1060
	CLC
	ADC.w #$0010
	STA.w $1060
	BRA.b CODE_069FFD

CODE_069FF4:
	LDX.b $12
	LDA.b $18,x
	CMP.w $105E
	BMI.b CODE_06A015
CODE_069FFD:
	LDA.w $7A38,x
	EOR.w #$FFFF
	INC
	STA.w $7A38,x
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	JSR.w CODE_06A978
	RTL

CODE_06A015:
	LDA.b $18,x
	SEC
	SBC.w $7A38,x
	STA.b $18,x
	LDA.b $76,x
	CLC
	ADC.w $7A38,x
	STA.b $76,x
	JSR.w CODE_06A978
	RTL

CODE_06A029:
	LDX.b $12
	LDA.w $7A98,x
	BNE.b CODE_06A040
	SEP.b #$20
	LDA.b #$08
	STA.w $7A98,x
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	RTL

CODE_06A040:
	JSR.w CODE_06A978
	RTL

CODE_06A044:
	LDX.b $12
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_06A050
	LDA.w $7A98,x
	BEQ.b CODE_06A065
CODE_06A050:
	JSR.w CODE_06A978
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CPY.b #$7F
	BCS.b CODE_06A065
	SEP.b #$20
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	REP.b #$20
	RTL

CODE_06A065:
	LDX.b #$03
	JSR.w CODE_06A984
	JSR.w CODE_06A849
	SEP.b #$20
	LDA.b #$20
	STA.w $7A98,x
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_06A088
	JSL.l CODE_028925
	JSR.w CODE_06A920
CODE_06A088:
	RTL

CODE_06A089:
	LDX.b $12
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_06A097
	JSL.l CODE_02A982
	JSR.w CODE_06A934
CODE_06A097:
	JSR.w CODE_06A9FB
	LDA.w $7A98,x
	BNE.b CODE_06A0AE
	SEP.b #$20
	LDA.b #$01
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
CODE_06A0AE:
	RTL

CODE_06A0AF:
	LDX.b $12
	JSR.w CODE_06A9FB
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_06A0BC
	JSR.w CODE_06A934
CODE_06A0BC:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w DATA_0699B8,y
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_5FE640>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0061
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000E
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	PHY
	LDX.b #FXCODE_08E167>>16
	LDA.w #FXCODE_08E167
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLY
	LDX.b $12
	LDA.w DATA_0699C4,y
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_5FA5D8>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$00E8
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0004
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	PHY
	LDX.b #FXCODE_08E167>>16
	LDA.w #FXCODE_08E167
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLY
	LDX.b $12
	LDA.w DATA_0699D0,y
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_5FA5F6>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$00F8
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0004
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08E167>>16
	LDA.w #FXCODE_08E167
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	SEP.b #$20
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	CLC
	ADC.b #$04
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	BCC.b CODE_06A171
	JSR.w CODE_06A8C8
	LDA.b #$05
	STA.w $74A2,x
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_06A174
	LDA.b #$1A
	STA.w $7A36,x
	REP.b #$20
	LDA.w #$FFF8
	STA.w $7A38,x
CODE_06A171:
	REP.b #$20
	RTL

CODE_06A174:
	INC.w $7A36,x
	INC.w $7A36,x
	LDA.b #$02
	STA.w $7A37,x
	REP.b #$20
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w #$0100
	STA.b $18,x
	STA.b $76,x
	RTL

CODE_06A18F:
	LDX.b $12
	JSR.w CODE_06A934
	LDA.w $7A96,x
	BNE.b CODE_06A1D1
	LDA.w #$00A0
	STA.w $7A96,x
	STZ.w $7542,x
	TXY
	LDA.b $10
	AND.w #$007E
	TAX
	LDA.l DATA_sine_lut_8bit_radians,x
	ASL
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.l DATA_cosine_lut_8bit_radians,x
	ASL
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	TYX
	LDA.w #!Define_YI_SoundID20_SoaringEgg
	JSL.l CODE_push_sound_queue
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
CODE_06A1D1:
	RTL

DATA_06A1D2:
	dw $0040,$0000,$0080,$00C0

CODE_06A1DA:
	LDX.b $12
	JSR.w CODE_06A934
	LDA.w $7A98,x
	BNE.b CODE_06A215
	LDA.w #!Define_YI_AmbSpr1DF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$0005
	STA.w $7E4C,y
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w #$0006
	STA.w $7462,y
	LDA.w #$0002
	STA.w $7A98,x
CODE_06A215:
	LDY.b #$00
	LDA.w $7680,x
	AND.w #$FF00
	BEQ.b CODE_06A22F
	BPL.b CODE_06A223
	INY
	INY
CODE_06A223:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_06A24D
	TYA
	ORA.w #$0004
	TAY
	BRA.b CODE_06A24D

CODE_06A22F:
	LDA.w $7682,x
	BMI.b CODE_06A23F
	CLC
	ADC.w #$0040
	AND.w #$FF00
	BEQ.b CODE_06A27E
	BPL.b CODE_06A243
CODE_06A23F:
	INY
	INY
	INY
	INY
CODE_06A243:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_06A24D
	TYA
	ORA.w #$0002
	TAY
CODE_06A24D:
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w DATA_06A1D2,y
	REP.b #$10
	AND.w #$00FF
	ASL
	TXY
	TAX
	LDA.l DATA_sine_lut_8bit_radians,x
	ASL
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.l DATA_cosine_lut_8bit_radians,x
	ASL
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	SEP.b #$10
	TYX
	LDA.w #!Define_YI_SoundID20_SoaringEgg
	JSL.l CODE_push_sound_queue
CODE_06A27E:
	LDA.b $18,x
	CMP.w #$0020
	BCC.b CODE_06A294
	SEC
	SBC.w #$0002
	STA.b $18,x
	LDA.b $76,x
	SEC
	SBC.w #$0002
	STA.b $76,x
	RTL

CODE_06A294:
	LDA.w $7A96,x
	BNE.b CODE_06A304
	LDA.w $7680,x
	CMP.w #$0040
	BCC.b CODE_06A304
	CMP.w #$00C0
	BCS.b CODE_06A304
	LDA.w $7682,x
	CMP.w #$0040
	BCC.b CODE_06A304
	CMP.w #$0080
	BCS.b CODE_06A304
	LDA.w #!Define_YI_AmbSpr1E6
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w $7142,y
	LDA.w #$0006
	STA.w $73C2,y
	STA.w $7E4C,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.b $02
	JSL.l CODE_02E19C
	SEP.b #$20
	LDA.b #$02
	TRB.w !RAM_YI_Global_MainScreenLayers
	LDA.b #$FF
	STA.w $74A2,x
	LDA.b #$04
	STA.w $7A37,x
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
CODE_06A304:
	RTL

CODE_06A305:
	LDX.b $12
	JSR.w CODE_06A934
	JML.l CODE_despawn_sprite_free_slot

CODE_06A30E:
	RTL

DATA_06A30F:
	db $00,$01,$02,$03,$03,$02,$01,$00

DATA_06A317:
	db $00,$00,$00,$02,$00,$00,$00,$00

CODE_06A31F:
	LDX.b $12
	RTS

CODE_06A322:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_06A347
	SEP.b #$20
	DEC.b $79,x
	BMI.b CODE_06A348
	LDY.b $79,x
	LDA.b #$04
	STA.w $7A96,x
	LDA.w DATA_06A30F,y
	STA.w $7402,x
	LDA.w $7400,x
	EOR.w DATA_06A317,y
	STA.w $7400,x
	REP.b #$20
CODE_06A347:
	RTS

CODE_06A348:
	STZ.b $78,x
	REP.b #$20
	RTS

CODE_06A34D:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_06A369
	SEP.b #$20
	DEC.b $79,x
	BMI.b CODE_06A36A
	LDY.b $79,x
	LDA.b #$02
	STA.w $7A96,x
	LDA.w DATA_06A30F,y
	STA.w $7402,x
	REP.b #$20
CODE_06A369:
	RTS

CODE_06A36A:
	STZ.b $78,x
	REP.b #$20
	RTS

CODE_06A36F:
	LDX.b $12
	LDY.w $74A2,x
	CPY.b #$FF
	BEQ.b CODE_06A3EC
	LDA.w $7362,x
	BMI.b CODE_06A3EC
	LDA.w #$01C0
	STA.w $6000
	LDA.w #$01C2
	STA.w $6002
	LDA.w #$01E0
	STA.w $6004
	LDA.w #$01E2
	STA.w $6006
	LDA.w #$01C4
	STA.w $6008
	LDA.w #$01C6
	STA.w $600A
	LDA.w #$01E4
	STA.w $600C
	LDA.w #$01E6
	STA.w $600E
	LDA.w #$01C8
	STA.w $6010
	LDA.w #$01E8
	STA.w $6012
	LDA.w #$01CC
	STA.w $6014
	LDA.w #$01CE
	STA.w $6016
	LDA.w #$01EC
	STA.w $6018
	LDA.w #$01EE
	STA.w $601A
	LDA.w #$01CA
	STA.w $601C
	STA.w $601E
	LDA.w #$01EA
	STA.w $6020
	STA.w $6022
	LDX.b #FXCODE_09A122>>16
	LDA.w #FXCODE_09A122
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_06A3EC:
	LDX.b $12
	RTS

CODE_06A3EF:
	LDX.b $12
	LDY.w $74A2,x
	CPY.b #$FF
	BEQ.b CODE_06A406
	LDA.w $7362,x
	BMI.b CODE_06A406
	LDX.b #FXCODE_09A511>>16
	LDA.w #FXCODE_09A511
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_06A406:
	LDX.b $12
	RTS

DATA_06A409:
	dw $0100,$0000,$00E6,$0007,$00B3,$000E,$0066,$0015

DATA_06A419:
	dw $0100,$00CC,$0099,$0066

DATA_06A421:
	dw $0100,$00E6,$00CC,$00B3

CODE_06A429:
	LDX.b $12
	REP.b #$10
	LDA.b $16,x
	EOR.w #$FFFF
	INC
	XBA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #FXDATA_560000+$6000
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6000)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	SEP.b #$10
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $7402,x
	ASL
	TAY
	LDA.w DATA_06A421,y
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$001C
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$6000
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6000)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $7402,x
	ASL
	ASL
	TAY
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w DATA_06A409,y
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	PHX
	PHY
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLY
	PLX
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	CMP.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BPL.b CODE_06A4DC
	LDA.w DATA_06A409+$02,y
	BEQ.b CODE_06A4DF
	LDA.w DATA_06A409+$02,y
	EOR.w #$FFFF
	INC
	AND.w #$00FF
	BRA.b CODE_06A4DF

CODE_06A4DC:
	LDA.w DATA_06A409+$02,y
CODE_06A4DF:
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0060
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$6040
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6040)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_0884A5>>16
	LDA.w #FXCODE_0884A5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $7402,x
	ASL
	TAY
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w DATA_06A419,y
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	PHX
	PHY
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLY
	PLX
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	STA.b $00
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0050
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$7030
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$7030)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_08861B>>16
	LDA.w #FXCODE_08861B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.b $00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0050
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$7020
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$7020)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_08861B>>16
	LDA.w #FXCODE_08861B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTS

CODE_06A5A6:
	LDX.b $12
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$6000
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6000)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $7402,x
	ASL
	TAY
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$001C
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$6000
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6000)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0040
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$6020
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6020)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_08861B>>16
	LDA.w #FXCODE_08861B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0001
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000E
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0040
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$6030
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6030)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_08861B>>16
	LDA.w #FXCODE_08861B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0060
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$6040
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6040)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0050
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$7030
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$7030)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_08861B>>16
	LDA.w #FXCODE_08861B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0050
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$7020
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$7020)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_08861B>>16
	LDA.w #FXCODE_08861B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTS

CODE_06A740:
	LDX.b $12
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$001B
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_548000+$00E1
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$00E1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTS

CODE_06A77F:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7680,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7682,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	TXA
	STA.w $6012
	LDA.w $60B0
	STA.w $6014
	LDA.w $60B2
	STA.w $6016
	LDA.w $60C2
	STA.w $6018
	LDX.b #FXCODE_0A897A>>16
	LDA.w #FXCODE_0A897A
	JSL.l !RAM_YI_Global_RT_00DE91
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	LDX.b $12
	LDA.w #$0002
	TSB.w !RAM_YI_Global_MainScreenLayers
	LDA.w #$0018
	TSB.w !RAM_YI_Global_HDMAEnable
	LDX.b $12
	LDY.w $7A36,x
	CPY.b #$48
	BCS.b CODE_06A848
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_06A80B
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_06A80B
	LDA.w $6002
	AND.w #$000F
	STA.b $00
	LDA.w $7182,x
	SEC
	SBC.b $00
	STA.w $7182,x
	SEP.b #$20
	STZ.w $7181,x
	REP.b #$20
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_06A80B:
	LDA.w $7860,x
	LDY.w $7221,x
CODE_06A811:
	BMI.b CODE_06A821
	BNE.b CODE_06A81A
	LDY.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_06A848
CODE_06A81A:
	BIT.w #$0014
	BEQ.b CODE_06A848
	BRA.b CODE_06A826

CODE_06A821:
	BIT.w #$0028
	BEQ.b CODE_06A848
CODE_06A826:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	BNE.b CODE_06A848
CODE_06A835:
	SEP.b #$20
	LDA.b #$02
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	LDA.b #$07
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D9|!EXRAMBankMirror,x
	LDA.b #$04
	STA.w $7A96,x
CODE_06A846:
	REP.b #$20
CODE_06A848:
	RTS

CODE_06A849:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	BNE.b CODE_06A85F
	LDA.w $70E2,x
	SEC
	SBC.w $611C
	STA.b $00
	LDA.w $7400,x
	DEC
	EOR.b $00
	BPL.b CODE_06A835
CODE_06A85F:
	RTS

CODE_06A860:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_06A8C7
	BEQ.b CODE_06A8C7
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_06A8C7
	LDA.w $7D38,y
	BEQ.b CODE_06A8C7
	LDA.w $70E2,x
	SEC
	SBC.w $7CD6,y
	STA.b $00
	EOR.w #$FFFF
	INC
	STA.w $7C76,y
	PHX
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	PLX
	LDA.w #$0200
	LDY.b $01
	BPL.b CODE_06A897
	EOR.w #$FFFF
	INC
CODE_06A897:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0010
	STA.w $7A38,x
	LDA.w #$0140
	STA.w $105E
	LDA.w #$00C0
	STA.w $1060
	INC.w $1062
	LDA.w #!Define_YI_SoundID78_HurtBoss
	JSL.l CODE_push_sound_queue
	SEP.b #$20
	LDA.b #$20
	STA.w $7A36,x
	REP.b #$20
	PLY
	PLA
CODE_06A8C7:
	RTL

CODE_06A8C8:
	LDA.b #DATA_5FE640>>16
	STA.b $02
	REP.b #$20
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w DATA_0699B8,y
	STA.b $00
	PHY
	LDX.b #$1A
CODE_06A8D9:
	TXY
	LDA.b [$00],y
	STA.l $702E2E,x
	STA.l YI_Global_PaletteMirror[$61].LowByte,x
	DEX
	DEX
	BPL.b CODE_06A8D9
	PLY
	LDA.w DATA_0699C4,y
	STA.b $00
	PHY
	LDX.b #$06
CODE_06A8F1:
	TXY
	LDA.b [$00],y
	STA.l $702F3C,x
	STA.l YI_Global_PaletteMirror[$E8].LowByte,x
	DEX
	DEX
	BPL.b CODE_06A8F1
	PLY
	LDA.w DATA_0699D0,y
	STA.b $00
	LDX.b #$06
CODE_06A908:
	TXY
	LDA.b [$00],y
	STA.l $702F5C,x
	STA.l YI_Global_PaletteMirror[$F8].LowByte,x
	DEX
	DEX
	BPL.b CODE_06A908
	SEP.b #$20
	LDX.b $12
	RTS

DATA_06A91C:
	dw $0200,$0100

CODE_06A920:
	LDY.b #$00
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BMI.b CODE_06A92D
	INY
	INY
CODE_06A92D:
	LDA.w DATA_06A91C,y
	STA.w $617A
	RTS

CODE_06A934:
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCS.b CODE_06A947
	STZ.w $617A
CODE_06A947:
	RTS

DATA_06A948:
	dl DATA_5FA570,$702E2E,$702E2E,$702E2E

DATA_06A954:
	dl DATA_5FA570,$702E4E,$702E4E,$702E4E

DATA_06A960:
	dl DATA_5FA570,$702F2E,$702F2E,$702F2E

DATA_06A96C:
	dl DATA_5FA570,$702F4E,$702F4E,$702F4E

CODE_06A978:
	LDA.b $14
	AND.w #$0003
	STA.b $00
	ASL
	CLC
	ADC.b $00
	TAX
CODE_06A984:
	LDA.w DATA_06A948,x
	STA.b $00
	LDY.w DATA_06A948+$02,x
	STY.b $02
	LDA.w #$7020C2
	STA.b $04
	LDY.b #$7020C2>>16
	STY.b $06
	LDY.b #$1C
CODE_06A999:
	LDA.b [$00],y
	STA.b [$04],y
	DEY
	DEY
	BPL.b CODE_06A999
	LDA.w DATA_06A954,x
	STA.b $00
	LDY.w DATA_06A954+$02,x
	STY.b $02
	LDA.w #$20E2
	STA.b $04
	LDY.b #$70
	STY.b $06
	LDY.b #$1C
CODE_06A9B6:
	LDA.b [$00],y
	STA.b [$04],y
	DEY
	DEY
	BPL.b CODE_06A9B6
	LDA.w DATA_06A960,x
	STA.b $00
	LDY.w DATA_06A960+$02,x
	STY.b $02
	LDA.w #$7021C2
	STA.b $04
	LDY.b #$7021C2>>16
	STY.b $06
	LDY.b #$1C
CODE_06A9D3:
	LDA.b [$00],y
	STA.b [$04],y
	DEY
	DEY
	BPL.b CODE_06A9D3
	LDA.w DATA_06A96C,x
	STA.b $00
	LDY.w DATA_06A96C+$02,x
	STY.b $02
	LDA.w #$7021E2
	STA.b $04
	LDY.b #$7021E2>>16
	STY.b $06
	LDY.b #$1C
CODE_06A9F0:
	LDA.b [$00],y
	STA.b [$04],y
	DEY
	DEY
	BPL.b CODE_06A9F0
	LDX.b $12
	RTS

CODE_06A9FB:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_06AA24
	LDA.w $0030
	AND.w #$0003
	CMP.w #$0002
	BCS.b CODE_06AA11
	LDA.w #$0002
	TRB.w !RAM_YI_Global_MainScreenLayers
CODE_06AA11:
	LDA.w !RAM_YI_Global_MainScreenLayers
	BIT.w #$0002
	BEQ.b CODE_06AA1E
	LDA.w #$0005
	BRA.b CODE_06AA21

CODE_06AA1E:
	LDA.w #$FFFF
CODE_06AA21:
	STA.w $74A2,x
CODE_06AA24:
	RTS

;---------------------------------------------------------------------------

DATA_06AA25:
	dw $FF80,$0080

;-------------------------------------------------------------------------
; Marching Milde ($0D2) -- boss Init handler.
; Milde is the World 4-4 rolling-pink boss. Init does:
;   - spawn the sub-sprite via CODE_03A366 (Define_YI_NorSpr0D2 + slot 4)
;   - mirror position into the sub-slot (Y) so the head/body align
;   - sprite-shared setup + boss-palette load (palette idx $2A)
;   - hand off to CODE_despawn_sprite_free_slot which finishes initial bookkeeping
; Caller invariants: M=8, X=16. DBR is set to bank $06.
; Raidenthequick: init_marching_milde. See docs/bossengine.md.
;-------------------------------------------------------------------------
YI_NorSpr0D2_MarchingMilde_Init:
init_marching_milde:                       ; Raidenthequick: init_marching_milde
;$06AA29
	LDA.w #!Define_YI_NorSpr0D2_MarchingMilde
	LDY.b #$04
	JSL.l CODE_03A366
	LDA.w #$0080
	STA.w $7E1A
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	TYX
	LDA.w #$FFF0
	STA.w $1013
	JSL.l CODE_03AEEB
	LDY.b #$2A
	JSL.l CODE_0CE5D6
	LDX.b $12
	JML.l CODE_despawn_sprite_free_slot

;---------------------------------------------------------------------------

DATA_06AA5B:
	dw $FFF9,$FFFA,$FFFB,$FFFC,$FFFD,$FFFE,$FFFF,$0000
	dw $0000,$FFFF,$FFFE,$FFFD,$FFFC,$FFFB,$FFFA,$FFF9

;-------------------------------------------------------------------------
; Marching Milde ($0D2) -- boss Main state-pointer table.
; 8 phase entries. Indexed by the world-shared boss-phase word $105C
; (Yoshi-engine boss-mode state). The phases run: roll-march, jump,
; split, mini-Mildes, defeat sequence, etc.
;-------------------------------------------------------------------------
DATA_06AA7B:
DATA_marching_milde_main_state_ptr:
	dw CODE_06AA91
	dw CODE_06AABB
	dw CODE_06AB08
	dw CODE_06AB1A
	dw CODE_06AB67
	dw CODE_06AC4C
	dw CODE_06AD12
	dw CODE_06AB2B

;-------------------------------------------------------------------------
; Marching Milde ($0D2) -- boss Main handler.
; Branches through DATA_marching_milde_main_state_ptr using the boss-phase word $105C as the
; index. The dispatch is a plain JMP (not JSR), so the called phase RTSs
; back to whoever invoked Main.
; Raidenthequick: main_marching_milde.
;-------------------------------------------------------------------------
YI_NorSpr0D2_MarchingMilde_Main:
main_marching_milde:                       ; Raidenthequick: main_marching_milde
;$06AA8B
	LDX.w $105C                            ; boss-phase index (shared $105C word)
	JMP.w (DATA_marching_milde_main_state_ptr,x)                  ; -> CODE_06AA91 / ... / CODE_06AB2B

CODE_06AA91:
	LDX.b $12
	LDA.w #$FFC0
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b #$07
	STY.b $18,x
	SEP.b #$20
	LDA.w DATA_06AAB3,y
	STA.w $7402,x
	LDA.b #$08
	STA.w $7A96,x
	REP.b #$20
	INC.w $105C
	INC.w $105C
	RTL

DATA_06AAB3:
	db $01,$02,$03,$04,$03,$02,$01,$00

CODE_06AABB:
	LDX.b $12
	JSL.l CODE_03AF23
	LDA.w $70E2,x
	CMP.w #$00C0
	BCC.b CODE_06AAE7
	LDA.w $7A96,x
	BNE.b CODE_06AAE6
	LDY.b $18,x
	DEY
	BPL.b CODE_06AAD5
	LDY.b #$07
CODE_06AAD5:
	STY.b $18,x
	SEP.b #$20
	LDA.w DATA_06AAB3,y
	STA.w $7402,x
	LDA.b #$08
	STA.w $7A96,x
	REP.b #$20
CODE_06AAE6:
	RTL

CODE_06AAE7:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0001
	STA.w $7402,x
	LDA.w #$0001
	STA.w $1015
	LDX.b $12
	LDA.w #$0080
	STA.w $7A96,x
	INC.w $1015
	INC.w $105C
	INC.w $105C
	RTL

CODE_06AB08:
	LDX.b $12
	JSL.l CODE_03AF23
	LDA.w $1015
	BPL.b CODE_06AB19
	INC.w $105C
	INC.w $105C
CODE_06AB19:
	RTL

CODE_06AB1A:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_06AB2A
	STZ.w $1015
	INC.w $105C
	INC.w $105C
CODE_06AB2A:
	RTL

CODE_06AB2B:
	LDX.b $12
	JSL.l CODE_03AF23
	LDA.b $18,x
	BNE.b CODE_06AB63
	LDA.w $1013
	BEQ.b CODE_06AB5C
	LDX.b #FXCODE_09AF4A>>16
	LDA.w #FXCODE_09AF4A
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	BPL.b CODE_06AB62
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.b $02
	JSL.l CODE_02E19C
CODE_06AB5C:
	JSL.l CODE_02A982
	INC.b $18,x
CODE_06AB62:
	RTL

CODE_06AB63:
	JML.l CODE_despawn_sprite_free_slot

CODE_06AB67:
	LDX.b $12
	LDA.w $7040,x
	AND.w #$07FC
	ORA.w #$0002
	STA.w $7040,x
	LDY.b #$1E
	STY.b $78,x
	LDY.b #$00
	STA.b $79,x
	LDA.w #$0020
	STA.b $18,x
	STA.b $76,x
	LSR
	LSR
	LSR
	LSR
	AND.w #$001E
	TAY
	LDA.w DATA_06AC3A,y
	STA.w $7720,x
	LDA.w $7182,x
	SEC
	SBC.w $7720,x
	STA.w $7182,x
	LDA.w #$0FFF
	STA.b $16,x
	CLC
	ADC.w #$2000
	XBA
	LSR
	LSR
	LSR
	AND.w #$0007
	STA.w $7402,x
	LDX.b #$1E
CODE_06ABB1:
	LDA.l DATA_5FE6BC,x
	STA.l $702E4E,x
	STA.l YI_Global_PaletteMirror[$71].LowByte,x
	DEX
	DEX
	BPL.b CODE_06ABB1
	LDX.b $12
	SEP.b #$20
	LDA.b #!REGISTER_BG2HorizScrollOffset
	STA.w HDMA[$03].Destination
	LDA.b #!REGISTER_BG2VertScrollOffset
	STA.w HDMA[$04].Destination
	REP.b #$20
	LDA.w #$0030
	STA.w $6126
	LDA.w $7042
	AND.w #$FFCF
	ORA.w #$0030
	STA.w $7042
	LDA.w #$0510
	STA.w !RAM_YI_Global_MainScreenLayers
	JSR.w CODE_06B223
	LDA.w #!Define_YI_SoundID87_CastleAboutToExplode
	JSL.l CODE_push_sound_queue
	INC.w $105C
	INC.w $105C
	RTL

DATA_06ABFA:
	dw $0110,$0100,$00F0,$00E0,$00D0,$00C0,$00B0,$00A0
	dw $0090,$0080,$0070,$0060,$0050,$0040,$0030,$0020

DATA_06AC1A:
	dw $0100,$00F0,$00E0,$00D0,$00C0,$00B0,$00A0,$0090
	dw $0080,$0070,$0060,$0050,$0040,$0030,$0020,$0050

DATA_06AC3A:
	dw $FFF6,$FFF6,$FFF8,$FFF9,$FFFA,$FFFB,$FFFC,$FFFD
	dw $FFFE

CODE_06AC4C:
	LDX.b $12
	LDA.w #$0001
	JSR.w CODE_06B072
	JSR.w CODE_06B2DC
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_06AC5F
	JSR.w CODE_06B223
CODE_06AC5F:
	JSL.l CODE_03AF23
	LDY.b $79,x
	TYX
	JMP.w (DATA_marching_milde_squash_dir_ptr,x)

DATA_06AC69:
DATA_marching_milde_squash_dir_ptr:             ; 3-entry squash/unsquash/recover handler dispatch indexed by $79,x
	dw CODE_06AC6F
	dw CODE_06AC9A
	dw CODE_06ACF5

CODE_06AC6F:
	LDX.b $12
	LDY.b $78,x
	LDA.b $18,x
	CLC
	ADC.w #$0004
	CMP.w DATA_06ABFA,y
	BCS.b CODE_06AC91
	STA.b $18,x
	STA.b $76,x
	LSR
	LSR
	LSR
	LSR
	AND.w #$001E
	TAY
	LDA.w DATA_06AC3A,y
	STA.w $7720,x
	RTL

CODE_06AC91:
	SEP.b #$20
	INC.b $79,x
	INC.b $79,x
	REP.b #$20
	RTL

CODE_06AC9A:
	LDX.b $12
	LDY.b $78,x
	LDA.b $18,x
	SEC
	SBC.w #$0004
	CMP.w DATA_06AC1A,y
	BCC.b CODE_06ACBC
	STA.b $18,x
	STA.b $76,x
	LSR
	LSR
	LSR
	LSR
	AND.w #$001E
	TAY
	LDA.w DATA_06AC3A,y
	STA.w $7720,x
	RTL

CODE_06ACBC:
	LDY.b $78,x
	DEY
	DEY
	BMI.b CODE_06ACCD
	STY.b $78,x
	SEP.b #$20
	DEC.b $79,x
	DEC.b $79,x
	REP.b #$20
	RTL

CODE_06ACCD:
	LDA.w #$0080
	STA.w $7A96,x
	LDA.w #$0100
	STA.b $18,x
	STA.b $76,x
	LDA.b $16,x
	CLC
	ADC.w #$2000
	XBA
	LSR
	AND.w #$001E
	TAY
	LDA.w DATA_06AA5B,y
	STA.w $7720,x
	SEP.b #$20
	INC.b $79,x
	INC.b $79,x
	REP.b #$20
	RTL

CODE_06ACF5:
	LDA.w $7A96,x
	BNE.b CODE_06AD11
	LDA.w #$0100
	STA.b $78,x
	LDY.w $7400,x
	LDA.w DATA_06AA25,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	INC.w $105C
	INC.w $105C
CODE_06AD11:
	RTL

CODE_06AD12:
	LDX.b $12
	LDA.w #$0000
	JSR.w CODE_06B072
	JSR.w CODE_06B2DC
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_06AD25
	JSR.w CODE_06B0FD
CODE_06AD25:
	JSL.l CODE_03AF23
	JSR.w CODE_06AFA7
	LDY.w $7A36,x
	TYX
	JMP.w (DATA_marching_milde_walk_state_ptr,x)

DATA_06AD33:
DATA_marching_milde_walk_state_ptr:             ; 8-entry walking/turn/bump state dispatch for split-form Marching Milde
	dw CODE_06AD47
	dw CODE_06ADA5
	dw CODE_06ADCC
	dw CODE_06AE08
	dw CODE_06AE44
	dw CODE_06AEA0
	dw CODE_06AEDD
	dw CODE_06AF09

DATA_06AD43:
	dw $0028,$0014

CODE_06AD47:
	LDX.b $12
	LDY.w $7400,x
	LDA.w $7860,x
	AND.w DATA_06AD43,y
	BEQ.b CODE_06AD5E
	LDA.w $7A36,x
	XBA
	ORA.w #$0002
	STA.w $7A36,x
CODE_06AD5E:
	LDA.b $16,x
	SEC
	SBC.b $78,x
	STA.b $00
	CLC
	ADC.w #$2000
	CMP.w #$4000
	BCC.b CODE_06AD7A
	LDA.b $78,x
	EOR.w #$FFFF
	INC
	STA.b $78,x
	LDA.b $16,x
	BRA.b CODE_06AD7E

CODE_06AD7A:
	LDA.b $00
	STA.b $16,x
CODE_06AD7E:
	CLC
	ADC.w #$2000
	XBA
	LSR
	PHA
	LSR
	LSR
	AND.w #$0007
	STA.w $7402,x
	PLA
	AND.w #$001E
	TAY
	LDA.w DATA_06AA5B,y
	STA.w $7720,x
	RTL

DATA_06AD99:
	db $03,$06,$08,$08,$06,$03

DATA_06AD9F:
	db $00,$00,$02,$00,$00,$00

CODE_06ADA5:
	LDX.b $12
	LDY.w $7402,x
	CPY.b #$03
	BEQ.b CODE_06ADB0
	BRA.b CODE_06AD5E

CODE_06ADB0:
	SEP.b #$20
	LDA.b #$05
	STA.w $7A38,x
	TAY
	LDA.w DATA_06AD99,y
	STA.w $7402,x
	LDA.b #$04
	STA.w $7A96,x
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	RTL

CODE_06ADCC:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_06ADF3
	SEP.b #$20
	DEC.w $7A38,x
	BMI.b CODE_06ADF4
	LDA.b #$04
	STA.w $7A96,x
	LDY.w $7A38,x
	LDA.w DATA_06AD99,y
	STA.w $7402,x
	LDA.w $7400,x
	EOR.w DATA_06AD9F,y
	STA.w $7400,x
	REP.b #$20
CODE_06ADF3:
	RTL

CODE_06ADF4:
	STZ.w $7A36,x
	LDA.b #$03
	STA.w $7402,x
	REP.b #$20
	LDY.w $7400,x
	LDA.w DATA_06AA25,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTL

CODE_06AE08:
	LDX.b $12
	LDA.b $76,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $76,x
	LDA.b $18,x
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $18,x
	CMP.w #$00FC
	BCS.b CODE_06AE26
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTL

CODE_06AE26:
	CMP.w #$0100
	BCS.b CODE_06AE2C
	RTL

CODE_06AE2C:
	LDA.w #$0100
	STA.b $18,x
	STA.b $76,x
	LDA.w #$FFFC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEP.b #$20
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	RTL

CODE_06AE44:
	LDX.b $12
	LDA.b $18,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $18,x
	LDA.b $76,x
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $76,x
	CMP.w #$00FC
	BCS.b CODE_06AE62
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTL

CODE_06AE62:
	CMP.w #$0100
	BCS.b CODE_06AE68
	RTL

CODE_06AE68:
	LDA.w #$0100
	STA.b $18,x
	STA.b $76,x
	LDA.w #$FFFC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEP.b #$20
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_06AE85
	DEC.w $7A36,x
	DEC.w $7A36,x
	REP.b #$20
	RTL

CODE_06AE85:
	STZ.w $7A36,x
	REP.b #$20
	LDY.w $7400,x
	LDA.w DATA_06AA25,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTL

DATA_06AE94:
	dw $FF00,$0100

DATA_06AE98:
	dw $0000,$0002

DATA_06AE9C:
	dw $FFEC,$001C

CODE_06AEA0:
	LDX.b $12
	STZ.w $60AA
	LDA.w $105E
	BIT.w #$0001
	BEQ.b CODE_06AEB7
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w $1060
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_06AEB7:
	LDA.b $76,x
	SEC
	SBC.w #$0010
	CMP.w #$0030
	BCC.b CODE_06AECD
	STA.b $76,x
	LDA.b $18,x
	CLC
	ADC.w #$0010
	STA.b $18,x
	RTL

CODE_06AECD:
	SEP.b #$20
	LDA.b #$08
	STA.w $7A96,x
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
	RTL

CODE_06AEDD:
	LDX.b $12
	STZ.w $60AA
	LDA.w $105E
	BIT.w #$0001
	BEQ.b CODE_06AEF4
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w $1060
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_06AEF4:
	LDA.w $7A96,x
	BNE.b CODE_06AF08
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A2,x
	INC.w $7A36,x
	INC.w $7A36,x
	REP.b #$20
CODE_06AF08:
	RTL

CODE_06AF09:
	LDX.b $12
	JSL.l CODE_03AEFD
	LDA.w #!Define_YI_SoundID85_MildePop1
	JSL.l CODE_push_sound_queue
	LDA.w #$012E
	JSL.l CODE_spawn_sprite_active
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.b $00
CODE_06AF34:
	LDA.w #$00D3
	JSL.l CODE_spawn_sprite_init
	LDA.w #$0020
	STA.w $7AF6,y
	LDA.w #$0030
	STA.w $7A96,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $7860,y
	AND.w #$FFFE
	STA.w $7860,y
	LDA.w $7182,x
	SEC
	SBC.w #$0030
	STA.w $7182,y
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	PHX
	LDA.b $00
	ASL
	TAX
	LDA.w DATA_06AE94,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w DATA_06AE98,x
	STA.w $7400,y
	LDA.w DATA_06AE9C,x
	PLX
	CLC
	ADC.w $70E2,x
	STA.w $70E2,y
	DEC.b $00
	BPL.b CODE_06AF34
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$0002
	TRB.w !RAM_YI_Global_MainScreenLayers
	TRB.w !RAM_YI_Global_SubScreenLayers
	STZ.b $18,x
	STZ.w $7A96,x
	INC.w $105C
	INC.w $105C
	RTL

CODE_06AFA7:
	LDY.w $74A2,x
	CPY.b #$FF
	BEQ.b CODE_06B029
	LDY.w $7D36,x
	DEY
	BMI.b CODE_06B016
	BEQ.b CODE_06B016
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_06B016
	LDA.w $7D38,y
	BEQ.b CODE_06B016
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $7CD6,y
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BEQ.b CODE_06AFD9
	EOR.b $00
	BMI.b CODE_06B016
CODE_06AFD9:
	LDA.b $00
	EOR.w #$FFFF
	INC
	STA.w $7C76,x
	PHX
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	PLX
	LDA.w $7A36,x
	CMP.w #$0006
	BCS.b CODE_06B016
CODE_06AFF1:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FFFC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.b $18,x
	STA.b $18,x
	SEP.b #$20
	LDA.b #$06
	STA.w $7A36,x
	LDA.b #$03
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID34_BurtJump
	JSL.l CODE_push_sound_queue
	PLA
	RTL

CODE_06B016:
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	BNE.b CODE_06B029
	LDA.w $105E
	BEQ.b CODE_06B029
	CMP.w #$0001
	BEQ.b CODE_06B02A
	JSL.l CODE_03A858
CODE_06B029:
	RTS

CODE_06B02A:
	LDA.w $60AA
	BMI.b CODE_06B029
	LDA.w #$0100
	STA.b $18,x
	STA.b $76,x
	LDA.w $60D4
	BNE.b CODE_06B048
	JSL.l CODE_03B20B
	LDA.w #!Define_YI_SoundID34_BurtJump
	JSL.l CODE_push_sound_queue
	BRA.b CODE_06AFF1

CODE_06B048:
	LDA.w $60AA
	BEQ.b CODE_06B029
	STZ.w $60AA
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w $1060
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	JSL.l CODE_028925
	LDA.w #$E000
	STA.b $16,x
	SEP.b #$20
	LDA.b #$09
	STA.w $7402,x
	LDA.b #$0A
	STA.w $7A36,x
	REP.b #$20
	RTS

CODE_06B072:
	STA.w $6004
	LDY.w $74A2,x
	CPY.b #$FF
	BEQ.b CODE_06B0CC
	LDA.b $16,x
	XBA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #DATA_06B36D>>16
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #DATA_06B36D
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7402,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0092
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w #$4000
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b $18,x
	STA.w $6000
	LDA.b $76,x
	STA.w $6002
	LDA.w $7680,x
	CLC
	ADC.w #$0008
	STA.w $6010
	LDA.w $7682,x
	CLC
	ADC.w #$0004
	STA.w $6012
	LDX.b #FXCODE_09A578>>16
	LDA.w #FXCODE_09A578
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_06B0CC:
	RTS

DATA_06B0CD:
	dw $0100,$0000,$0100,$0000,$0100,$0000,$0100,$0000
	dw $0100,$0000,$00F3,$00E4,$00E6,$00E4,$00D9,$00E4
	dw $0100,$0000,$00E6,$00E4,$00CC,$00E4,$0100,$0000

CODE_06B0FD:
	LDY.w $74A2,x
	CPY.b #$FF
	BNE.b CODE_06B105
	RTS

CODE_06B105:
	LDA.b $16,x
	XBA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #FXDATA_560000+$6060
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6060)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $7402,x
	CMP.w #$0009
	BCC.b CODE_06B17C
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$003F
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$001F
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$6001
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6001)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088C78>>16
	LDA.w #FXCODE_088C78
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	RTS

CODE_06B17C:
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$001F
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0040
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$6080
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6080)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $7402,x
	ASL
	ASL
	TAY
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w DATA_06B0CD,y
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	PHX
	PHY
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLY
	PLX
	LDA.b $18,x
	CMP.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BPL.b CODE_06B1EB
	LDA.w DATA_06B0CD+$02,y
	BEQ.b CODE_06B1EE
	LDA.w DATA_06B0CD+$02,y
	EOR.w #$FFFF
	INC
	AND.w #$00FF
	BRA.b CODE_06B1EE

CODE_06B1EB:
	LDA.w DATA_06B0CD+$02,y
CODE_06B1EE:
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$6040
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6040)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_0884A5>>16
	LDA.w #FXCODE_0884A5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
CODE_06B222:
	RTS

CODE_06B223:
	LDY.w $74A2,x
	CPY.b #$FF
	BEQ.b CODE_06B222
	LDA.b $16,x
	XBA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #FXDATA_560000+$6060
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6060)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_0884A5>>16
	LDA.w #FXCODE_0884A5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$001F
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0040
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$6080
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6080)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$6040
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6040)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
CODE_06B2DB:
	RTS

CODE_06B2DC:
	LDY.w $74A2,x
	CPY.b #$FF
	BEQ.b CODE_06B2DB
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7680,x
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7682,x
	CLC
	ADC.w #$0004
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	TXA
	STA.w $6012
	LDA.w $60B0
	STA.w $6014
	LDA.w $60B2
	STA.w $6016
	LDA.w $60C2
	STA.w $6018
	LDX.b #FXCODE_0A8974>>16
	LDA.w #FXCODE_0A8974
	JSL.l !RAM_YI_Global_RT_00DE91
	LDA.w $601A
	STA.w $105E
	LDA.w $601C
	STA.w $1060
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	LDX.b $12
	LDA.w #$0002
	TSB.w !RAM_YI_Global_MainScreenLayers
	LDA.w #$0018
	TSB.w !RAM_YI_Global_HDMAEnable
	LDX.b $12
	LDA.w $7860,x
	LDY.w $7221,x
	BMI.b CODE_06B364
	BNE.b CODE_06B35D
	LDY.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_06B36C
CODE_06B35D:
	BIT.w #$0014
	BEQ.b CODE_06B36C
	BRA.b CODE_06B369

CODE_06B364:
	BIT.w #$0028
	BEQ.b CODE_06B36C
CODE_06B369:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_06B36C:
	RTS

DATA_06B36D:
	dw $02F8,$F0F0,$3DC0,$0002,$C2F0,$023D,$00F0,$3DE0
	dw $0002,$E200,$093D,$F002,$E2F0,$02FF,$F000,$FFE0
	dw $F002,$C200,$02FF,$0000,$FFC0,$F002,$C2F0,$026F
	dw $F000,$6FC0,$F002,$E200,$026F,$0000,$6FE0,$F002
	dw $E0F0,$02AD,$F000,$ADE2,$F002,$C000,$02AD,$0000
	dw $ADC2,$9DDB,$FA02,$CAF0,$027D,$F00A,$7DC8,$FA02
	dw $EA00,$027D,$000A,$7DE8,$E702,$C8F0,$023F,$F0F7
	dw $3FCA,$E702,$E800,$023F,$00F7,$3FEA,$9F00,$F002
	dw $C4F0,$023F,$F000,$3FC6,$F002,$E400,$023F,$0000
	dw $3FE6,$02F8,$F0F0,$3DC0,$0002,$C2F0,$023D,$00F0
	dw $3DE0,$0002,$E200,$093D,$F002,$E2F0,$02FF,$F000
	dw $FFE0,$F002,$C200,$02FF,$0000,$FFC0,$F002,$C2F0
	dw $026F,$F000,$6FC0,$F002,$E200,$026F,$0000,$6FE0
	dw $F002,$E0F0,$02AD,$F000,$ADE2,$F002,$C000,$02AD
	dw $0000,$ADC2,$9DDD,$FA02,$CAF0,$027D,$F00A,$7DC8
	dw $FA02,$EA00,$027D,$000A,$7DE8,$E602,$C8F0,$023F
	dw $F0F6,$3FCA,$E602,$E800,$023F,$00F6,$3FEA,$9F02
	dw $F002,$C4F0,$023F,$F000,$3FC6,$F002,$E400,$023F
	dw $0000,$3FE6,$02F8,$F0F0,$3DC0,$0002,$C2F0,$023D
	dw $00F0,$3DE0,$0002,$E200,$093D,$F002,$E2F0,$02FF
	dw $F000,$FFE0,$F002,$C200,$02FF,$0000,$FFC0,$F002
	dw $C2F0,$026F,$F000,$6FC0,$F002,$E200,$026F,$0000
	dw $6FE0,$F002,$E0F0,$02AD,$F000,$ADE2,$F002,$C000
	dw $02AD,$0000,$ADC2,$9DDF,$FB02,$CAF0,$027D,$F00B
	dw $7DC8,$FB02,$EA00,$027D,$000B,$7DE8,$E502,$C8F0
	dw $023F,$F0F5,$3FCA,$E502,$E800,$023F,$00F5,$3FEA
	dw $9F05,$F002,$C4F0,$023F,$F000,$3FC6,$F002,$E400
	dw $023F,$0000,$3FE6,$02F8,$F0F0,$3DC0,$0002,$C2F0
	dw $023D,$00F0,$3DE0,$0002,$E200,$093D,$F002,$E2F0
	dw $02FF,$F000,$FFE0,$F002,$C200,$02FF,$0000,$FFC0
	dw $F002,$C2F0,$026F,$F000,$6FC0,$F002,$E200,$026F
	dw $0000,$6FE0,$F002,$E0F0,$02AD,$F000,$ADE2,$F002
	dw $C000,$02AD,$0000,$ADC2,$9DE2,$FD02,$CAF0,$027D
	dw $F00D,$7DC8,$FD02,$EA00,$027D,$000D,$7DE8,$E402
	dw $C8F0,$023F,$F0F4,$3FCA,$E402,$E800,$023F,$00F4
	dw $3FEA,$9F0A,$F002,$C4F0,$023F,$F000,$3FC6,$F002
	dw $E400,$023F,$0000,$3FE6,$02F8,$F0F0,$3DC0,$0002
	dw $C2F0,$023D,$00F0,$3DE0,$0002,$E200,$093D,$F002
	dw $E2F0,$02FF,$F000,$FFE0,$F002,$C200,$02FF,$0000
	dw $FFC0,$F002,$C2F0,$026F,$F000,$6FC0,$F002,$E200
	dw $026F,$0000,$6FE0,$F002,$E0F0,$02AD,$F000,$ADE2
	dw $F002,$C000,$02AD,$0000,$ADC2,$9DE7,$FE02,$CAF0
	dw $027D,$F00E,$7DC8,$FE02,$EA00,$027D,$000E,$7DE8
	dw $E202,$C8F0,$023F,$F0F2,$3FCA,$E202,$E800,$023F
	dw $00F2,$3FEA,$9F10,$F002,$C4F0,$023F,$F000,$3FC6
	dw $F002,$E400,$023F,$0000,$3FE6,$02F8,$F0F0,$3DC0
	dw $0002,$C2F0,$023D,$00F0,$3DE0,$0002,$E200,$093D
	dw $F002,$E2F0,$02FF,$F000,$FFE0,$F002,$C200,$02FF
	dw $0000,$FFC0,$F002,$C2F0,$026F,$F000,$6FC0,$F002
	dw $E200,$026F,$0000,$6FE0,$F002,$E0F0,$02AD,$F000
	dw $ADE2,$F002,$C000,$02AD,$0000,$ADC2,$9DEC,$FF02
	dw $CAF0,$027D,$F00F,$7DC8,$FF02,$EA00,$027D,$000F
	dw $7DE8,$E102,$C8F0,$023F,$F0F1,$3FCA,$E102,$E800
	dw $023F,$00F1,$3FEA,$9F15,$F002,$C4F0,$023F,$F000
	dw $3FC6,$F002,$E400,$023F,$0000,$3FE6,$02F8,$F0F0
	dw $3DC0,$0002,$C2F0,$023D,$00F0,$3DE0,$0002,$E200
	dw $093D,$F002,$E2F0,$02FF,$F000,$FFE0,$F002,$C200
	dw $02FF,$0000,$FFC0,$F002,$C2F0,$026F,$F000,$6FC0
	dw $F002,$E200,$026F,$0000,$6FE0,$F002,$E0F0,$02AD
	dw $F000,$ADE2,$F002,$C000,$02AD,$0000,$ADC2,$9DEF
	dw $0002,$CAF0,$027D,$F010,$7DC8,$0002,$EA00,$027D
	dw $0010,$7DE8,$E102,$C8F0,$023F,$F0F1,$3FCA,$E102
	dw $E800,$023F,$00F1,$3FEA,$9F19,$F002,$C4F0,$023F
	dw $F000,$3FC6,$F002,$E400,$023F,$0000,$3FE6,$02F8
	dw $F0F0,$3DC0,$0002,$C2F0,$023D,$00F0,$3DE0,$0002
	dw $E200,$093D,$F002,$E2F0,$02FF,$F000,$FFE0,$F002
	dw $C200,$02FF,$0000,$FFC0,$F002,$C2F0,$026F,$F000
	dw $6FC0,$F002,$E200,$026F,$0000,$6FE0,$F002,$E0F0
	dw $02AD,$F000,$ADE2,$F002,$C000,$02AD,$0000,$ADC2
	dw $9DF2,$0002,$CAF0,$027D,$F010,$7DC8,$0002,$EA00
	dw $027D,$0010,$7DE8,$E002,$C8F0,$023F,$F0F0,$3FCA
	dw $E002,$E800,$023F,$00F0,$3FEA,$9F1C,$F002,$C4F0
	dw $023F,$F000,$3FC6,$F002,$E400,$023F,$0000,$3FE6
	dw $02F8,$F0F0,$3DC0,$0002,$C2F0,$023D,$00F0,$3DE0
	dw $0002,$E200,$093D,$F002,$E2F0,$02FF,$F000,$FFE0
	dw $F002,$C200,$02FF,$0000,$FFC0,$F002,$C2F0,$026F
	dw $F000,$6FC0,$F002,$E200,$026F,$0000,$6FE0,$F002
	dw $E0F0,$02AD,$F000,$ADE2,$F002,$C000,$02AD,$0000
	dw $ADC2,$9DF6,$0002,$CAF0,$027D,$F010,$7DC8,$0002
	dw $EA00,$027D,$0010,$7DE8,$E002,$C8F0,$023F,$F0F0
	dw $3FCA,$E002,$E800,$023F,$00F0,$3FEA,$9F20,$F002
	dw $C4F0,$023F,$F000,$3FC6,$F002,$E400,$023F,$0000
	dw $3FE6,$02F8,$F0F0,$3DC0,$0002,$C2F0,$023D,$00F0
	dw $3DE0,$0002,$E200,$093D,$F002,$E2F0,$02FF,$F000
	dw $FFE0,$F002,$C200,$02FF,$0000,$FFC0,$F002,$C2F0
	dw $027D,$F000,$7DC0,$F002,$E200,$027D,$0000,$7DE0
	dw $F002,$E0F0,$02BF,$F000,$BFE2,$F002,$C000,$02BF
	dw $0000,$BFC2,$9800,$E002,$C8F0,$023D,$F0F0,$3DCA
	dw $E002,$E800,$023D,$00F0,$3DEA,$C002,$C4F0,$023F
	dw $F0D0,$3FC6,$C002,$E400,$023F,$00D0,$3FE6,$0002
	dw $CAF0,$027F,$F010,$7FC8,$0002,$EA00,$027F,$0010
	dw $7FE8,$2002,$C6F0,$027F,$F030,$7FC4,$2002,$E600
	dw $027F,$0030,$7FE4

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Large Pop Effect ($12E) -- Init handler.
; No-op (RTL). Spawn time-state is set by whoever spawns the pop sprite;
; Main does all the per-frame animation/dispatch.
;-------------------------------------------------------------------------
YI_NorSpr12E_LargePopEffect_Init:
init_large_pop_effect:
;$06B933
	RTL

;---------------------------------------------------------------------------

DATA_06B934:
	dl DATA_5FD98A
	dl DATA_5FD984
	dl DATA_5FD986
	dl DATA_5FD988

DATA_06B940:
	db $00,$06,$03,$06,$03,$06

DATA_06B946:
	db $00,$09,$06,$09,$06,$09

DATA_06B94C:
	dw DATA_06B940,DATA_06B946

;-------------------------------------------------------------------------
; Large Pop Effect ($12E) -- Main handler.
; The "POP!" particle effect that plays when something big breaks. Per
; frame: reposition the L3 BG so the effect is camera-centered, run
; shared sprite tick ($03AF23), enable the right screen/sub-screen
; layers, then advance the per-frame anim through DATA_06B940/B946.
;-------------------------------------------------------------------------
YI_NorSpr12E_LargePopEffect_Main:
main_large_pop_effect:
;$06B950
	LDA.w #$0180
	SEC
	SBC.w $7680,x
	STA.w !RAM_YI_Global_Layer3XPosLo
	LDA.w #$0180
	SEC
	SBC.w $7682,x
	STA.w !RAM_YI_Global_Layer3YPosLo
	JSL.l CODE_03AF23
	LDA.w !RAM_YI_Global_MainScreenLayers
	ORA.w !RAM_YI_Global_SubScreenLayers
	AND.w #$001B
	ORA.w #$0400
	STA.w !RAM_YI_Global_MainScreenLayers
	LDY.b #$33
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.w $7A96,x
	BNE.b CODE_06B9B7
	LDA.w #$0002
	STA.w $7A96,x
	LDY.b $16,x
	LDA.w DATA_06B94C,y
	STA.b $00
	LDY.b $18,x
	DEY
	BPL.b CODE_06B999
	DEC.b $76,x
	BMI.b CODE_06B9B8
	LDY.b #$05
CODE_06B999:
	STY.b $18,x
	LDA.b ($00),y
	TAY
	LDA.w DATA_06B934,y
	STA.b $00
	LDX.w DATA_06B934+$02,y
	STX.b $02
	LDX.b #$04
CODE_06B9AA:
	TXY
	LDA.b [$00],y
	STA.l YI_Global_PaletteMirror[$01].LowByte,x
	DEX
	DEX
	BPL.b CODE_06B9AA
	LDX.b $12
CODE_06B9B7:
	RTL

CODE_06B9B8:
	STZ.w $6098
	STZ.w $60A0
	JML.l CODE_03A31E

;---------------------------------------------------------------------------

DATA_06B9C2:
	db $08,$08,$08,$08,$08,$0C,$10,$10,$10,$10,$10,$10,$0C,$08,$10,$10
	db $10,$10,$10,$10,$10,$10,$00,$03

;-------------------------------------------------------------------------
; Vertical Cloud Drop ($0EA) -- Init handler.
; Cloud Drops are the fluffy white enemies that descend vertically from
; the top of the screen in sky/cloud levels. The Y-flag bit ($0010 of
; $70E2,x) picks "drop from ceiling" vs "rise from floor"; both modes
; configure initial Y-speed, animation index ($7402), and frame from
; the DATA_06B9C2 frame table. $7A96 is cleared (no animation timer).
; Raidenthequick: init_cloud_drop_vertical.
;-------------------------------------------------------------------------
YI_NorSpr0EA_VerticalCloudDrop_Init:
init_cloud_drop_vertical:                  ; Raidenthequick: init_cloud_drop_vertical
;$06B9DA
	LDA.w $7182,x
	STA.b $18,x
	LDA.w $70E2,x
	AND.w #$0010
	BEQ.b CODE_06BA05
	LDA.w DATA_06BA2F
	STA.w $75E2,x
	LDA.w #$FE70
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0006
	STA.w $7402,x
	TAY
	LDA.w DATA_06B9C2,y
	AND.w #$00FF
	STA.w $7B58,x
	BRA.b CODE_06BA21

CODE_06BA05:
	LDA.w DATA_06BA2F+$02
	STA.w $75E2,x
	LDA.w #$0180
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$000D
	STA.w $7402,x
	TAY
	LDA.w DATA_06B9C2,y
	AND.w #$00FF
	STA.w $7B58,x
CODE_06BA21:
	STZ.w $7A96,x
	RTL

;---------------------------------------------------------------------------

DATA_06BA25:
	db $05,$04,$03,$02,$01

DATA_06BA2A:
	db $0C,$0B,$0A,$09,$08

DATA_06BA2F:
	dw $0800,$F800

;-------------------------------------------------------------------------
; Vertical Cloud Drop ($0EA) -- Main handler.
; Each frame: skip when sprite-freeze flag, fuzzy-mosaic timer, or an
; item-in-use is active; otherwise advance animation, drift Y, and check
; for contact. Raidenthequick: main_cloud_drop_vertical.
;-------------------------------------------------------------------------
YI_NorSpr0EA_VerticalCloudDrop_Main:
main_cloud_drop_vertical:                  ; Raidenthequick: main_cloud_drop_vertical
;$06BA33
	LDA.w $7D38,x
	BEQ.b CODE_06BA50
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_06BA50
	LDA.w $6FA0,x
	ORA.w #$0200
	STA.w $6FA0,x
	JSL.l CODE_06BB4D
CODE_06BA50:
	JSL.l CODE_03AF23
	JSL.l CODE_06BAF3
	LDA.b $16,x
	BNE.b CODE_06BAAE
	LDA.w #$0010
	STA.w $7542,x
	LDY.b #$00
	LDA.w $7182,x
	CMP.b $18,x
	BCC.b CODE_06BA6D
	LDY.b #$02
CODE_06BA6D:
	LDA.w DATA_06BA2F,y
	STA.w $75E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_06BA88
	LDA.w #$0005
	STA.b $16,x
	LDA.w #$0004
	STA.w $7A96,x
	STZ.w $7542,x
	BRA.b CODE_06BAEE

CODE_06BA88:
	BPL.b CODE_06BA9C
	LDA.w #$000D
	STA.w $7402,x
	TAY
	LDA.w DATA_06B9C2,y
	AND.w #$00FF
	STA.w $7B58,x
	BRA.b CODE_06BAEE

CODE_06BA9C:
	LDA.w #$0006
	STA.w $7402,x
	TAY
	LDA.w DATA_06B9C2,y
	AND.w #$00FF
	STA.w $7B58,x
	BRA.b CODE_06BAEE

CODE_06BAAE:
	LDA.w #DATA_06BA25
	LDY.w $75E3,x
	BPL.b CODE_06BAB9
	LDA.w #DATA_06BA2A
CODE_06BAB9:
	STA.b $00
	LDA.b $16,x
	LSR
	BNE.b CODE_06BACC
	LDA.w $7A96,x
	LSR
	BNE.b CODE_06BACC
	LDA.w #$0010
	STA.w $7542,x
CODE_06BACC:
	LDY.b $16,x
	DEY
	LDA.b ($00),y
	AND.w #$00FF
	STA.w $7402,x
	TAY
	LDA.w DATA_06B9C2,y
	AND.w #$00FF
	STA.w $7B58,x
	LDA.w $7A96,x
	BNE.b CODE_06BAEE
	LDA.w #$0004
	STA.w $7A96,x
	DEC.b $16,x
CODE_06BAEE:
	JSL.l CODE_03A5B7
	RTL

CODE_06BAF3:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_06BB35
	BEQ.b CODE_06BB35
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_06BB35
	LDA.w $7D38,y
	BEQ.b CODE_06BB35
	JSL.l CODE_0CFF61
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w $75E0,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	PLY
	PLA
CODE_06BB35:
	RTL

;---------------------------------------------------------------------------

DATA_06BB36:
	db $0E,$0F,$10,$11,$12,$13,$14,$15

;-------------------------------------------------------------------------
; Vertical Cloud Drop ($0EA) -- Stomp/head-bop routine.
; Called from the player-contact tables when Yoshi lands on top of this
; Cloud Drop. Plays the squish anim and removes the sprite.
; Raidenthequick: head_bop_cloud_drop_vertical.
;-------------------------------------------------------------------------
YI_NorSpr0EA_VerticalCloudDrop_StompRt:
head_bop_cloud_drop_vertical:              ; Raidenthequick: head_bop_cloud_drop_vertical
;$06BB3E
	LDA.w #$0180
	STA.w $75E2,x
	LDA.w #$0010
	STA.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_06BB4D:
	LDA.w $7A98,x
	BNE.b CODE_06BB69
	SEP.b #$20
	LDA.b #$04
	STA.w $7A98,x
	LDY.b $76,x
	LDA.w DATA_06BB36,y
	STA.w $7402,x
	TYA
	INC
	AND.b #$07
	STA.b $76,x
	REP.b #$20
CODE_06BB69:
	RTL

;---------------------------------------------------------------------------

DATA_06BB6A:
	db $04,$04,$04,$04,$08,$0C,$08,$08,$08,$08,$0C,$0C,$0C,$0C,$08,$04

;-------------------------------------------------------------------------
; Horizontal Cloud Drop ($0EB) -- Init handler.
; Horizontal variant of $0EA -- drifts left/right across the screen
; instead of falling. Same animation/state shape; only the speed-vector
; setup differs. Raidenthequick: init_cloud_drop_horizontal.
;-------------------------------------------------------------------------
YI_NorSpr0EB_HorizontalCloudDrop_Init:
init_cloud_drop_horizontal:                ; Raidenthequick: init_cloud_drop_horizontal
;$06BB7A
	LDA.w $70E2,x
	STA.b $18,x
	LDA.w $70E2,x
	AND.w #$0010
	BEQ.b CODE_06BBA5
	LDA.w DATA_06BA2F
	STA.w $75E0,x
	LDA.w #$FE70
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$000F
	STA.w $7402,x
	TAY
	LDA.w DATA_06BB6A,y
	AND.w #$00FF
	STA.w $7B56,x
	BRA.b CODE_06BBC1

CODE_06BBA5:
	LDA.w DATA_06BA2F+$02
	STA.w $75E2,x
	LDA.w #$0180
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0005
	STA.w $7402,x
	TAY
	LDA.w DATA_06BB6A,y
	AND.w #$00FF
	STA.w $7B56,x
CODE_06BBC1:
	STZ.w $7A96,x
	LDA.w #$0010
	STA.w $7540,x
	RTL

;---------------------------------------------------------------------------

DATA_06BBCB:
	db $04,$03,$02,$01

DATA_06BBCF:
	db $0E,$0D,$0C,$0B

;-------------------------------------------------------------------------
; Horizontal Cloud Drop ($0EB) -- Main handler.
; Mirror of $0EA Main with X-axis drift logic.
; Raidenthequick: main_cloud_drop_horizontal.
;-------------------------------------------------------------------------
YI_NorSpr0EB_HorizontalCloudDrop_Main:
main_cloud_drop_horizontal:                ; Raidenthequick: main_cloud_drop_horizontal
;$06BBD3
	LDA.w $7D38,x
	BEQ.b CODE_06BBF0
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_06BBF0
	LDA.w $6FA0,x
	ORA.w #$0200
	STA.w $6FA0,x
	JSL.l CODE_06BCA9
CODE_06BBF0:
	JSL.l CODE_03AF23
	JSL.l CODE_06BAF3
	STZ.w $7400,x
	LDA.b $16,x
	BNE.b CODE_06BC51
	LDA.w #$0010
	STA.w $7540,x
	LDY.b #$00
	LDA.w $70E2,x
	CMP.b $18,x
	BCC.b CODE_06BC10
	LDY.b #$02
CODE_06BC10:
	LDA.w DATA_06BA2F,y
	STA.w $75E0,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_06BC2B
	LDA.w #$0004
	STA.b $16,x
	LDA.w #$0005
	STA.w $7A96,x
	STZ.w $7540,x
	BRA.b CODE_06BC91

CODE_06BC2B:
	BPL.b CODE_06BC3F
	LDA.w #$000F
	STA.w $7402,x
	TAY
	LDA.w DATA_06BB6A,y
	AND.w #$00FF
	STA.w $7B56,x
	BRA.b CODE_06BC91

CODE_06BC3F:
	LDA.w #$0005
	STA.w $7402,x
	TAY
	LDA.w DATA_06BB6A,y
	AND.w #$00FF
	STA.w $7B56,x
	BRA.b CODE_06BC91

CODE_06BC51:
	LDA.w #DATA_06BBCB
	LDY.w $75E1,x
	BPL.b CODE_06BC5C
	LDA.w #DATA_06BBCF
CODE_06BC5C:
	STA.b $00
	LDA.b $16,x
	LSR
	BNE.b CODE_06BC6F
	LDA.w $7A96,x
	LSR
	BNE.b CODE_06BC6F
	LDA.w #$0010
	STA.w $7540,x
CODE_06BC6F:
	LDY.b $16,x
	DEY
	LDA.b ($00),y
	AND.w #$00FF
	STA.w $7402,x
	TAY
	LDA.w DATA_06BB6A,y
	AND.w #$00FF
	STA.w $7B56,x
	LDA.w $7A96,x
	BNE.b CODE_06BC91
	LDA.w #$0005
	STA.w $7A96,x
	DEC.b $16,x
CODE_06BC91:
	JSL.l CODE_03A5B7
	RTL

;---------------------------------------------------------------------------

DATA_06BC96:
	db $06,$07,$08,$09

;-------------------------------------------------------------------------
; Horizontal Cloud Drop ($0EB) -- Stomp/head-bop routine.
; Raidenthequick: head_bop_cloud_drop_horizontal.
;-------------------------------------------------------------------------
YI_NorSpr0EB_HorizontalCloudDrop_StompRt:
head_bop_cloud_drop_horizontal:            ; Raidenthequick: head_bop_cloud_drop_horizontal
;$06BC9A
	LDA.w #$0180
	STA.w $75E2,x
	LDA.w #$0010
	STA.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_06BCA9:
	LDA.w $7A98,x
	BNE.b CODE_06BCC5
	SEP.b #$20
	LDA.b #$05
	STA.w $7A98,x
	LDY.b $76,x
	LDA.w DATA_06BC96,y
	STA.w $7402,x
	TYA
	INC
	AND.b #$03
	STA.b $76,x
	REP.b #$20
CODE_06BCC5:
	RTL

;---------------------------------------------------------------------------

CODE_06BCC6:
	TYX
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Baby Mario ($061) -- Init handler.
; Spawned both at level start (on Yoshi's back) and when Yoshi takes a
; hit (Mario drifts off in his bubble). The big lifting (cry timer,
; Kamek-bubble physics, re-mount) is all in Main + RideYoshiRt; Init
; just stamps the per-slot sprite-flags byte $7863,x with $C0 (the
; high-pri flag bits for Mario's OAM priority).
; Caller invariants: M=8, X=16. DBR is set to bank $06.
; Raidenthequick: init_baby_mario.
;-------------------------------------------------------------------------
YI_NorSpr061_BabyMario_Init:
init_baby_mario:                           ; Raidenthequick: init_baby_mario
;$06BCC8
	LDY.b #$C0                             ; OAM pri flag set
	STY.w $7863                            ; -> per-slot flags byte
	RTL

;---------------------------------------------------------------------------

DATA_06BCCE:
DATA_baby_mario_main_state_ptr:                 ; 15-entry state pointer table for off-Yoshi Baby Mario
	dw CODE_06C32B
	dw CODE_06C383
	dw CODE_06BCC6
	dw CODE_06C48E
	dw CODE_06BCC6
	dw CODE_06C4BD
	dw CODE_06C591
	dw CODE_06C6D1
	dw CODE_06C4C4
	dw CODE_06C61F
	dw CODE_06C4C4
	dw CODE_06C6EC
	dw CODE_06C812
	dw CODE_06C4C4
	dw CODE_06C61F

;-------------------------------------------------------------------------
; Baby Mario ($061) -- Main handler.
; Two-mode dispatch: while riding Yoshi, jumps into the very long
; "RideYoshi" routine below ($08:8770ish). When off-Yoshi, runs cry
; timer + Kamek-bubble physics + pickup test. Damage-on-touch with
; enemy -> bubble float; touch by Yoshi -> re-mount.
; Raidenthequick: main_baby_mario.
;-------------------------------------------------------------------------
YI_NorSpr061_BabyMario_Main:
main_baby_mario:                           ; Raidenthequick: main_baby_mario
;$06BCEC
	LDY.b #$06
	LDA.w $7040
	AND.w #$E000
	BEQ.b CODE_06BCF8
	LDY.b #$0C
CODE_06BCF8:
	STY.w $7BB6
	STY.w $7BB8
	LDY.w $0B59
	BEQ.b CODE_06BD2E
	LDA.w #$0006
	CLC
	ADC.w $6120
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7C16
	CMP.b $00
	BCS.b CODE_06BD2E
	LDA.w #$0006
	CLC
	ADC.w $6122
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7C18
	CMP.b $00
	BCS.b CODE_06BD2E
	LDY.b #$FF
	STY.w $7D36
CODE_06BD2E:
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.w #$0009
	BNE.b CODE_06BD39
	JMP.w CODE_06CA2D

CODE_06BD39:
	JSR.w CODE_06BD81
	LDA.w $7860
	ORA.w $0DB6
	STA.w $7860
	LDY.w $0B57
	BEQ.b CODE_06BD50
	LDA.w #$0030
	TSB.w $7042
CODE_06BD50:
	JSR.w CODE_06C281
	JSR.w CODE_06BFDC
	LDA.b $76
	ASL
	TAX
	JSR.w (DATA_baby_mario_main_state_ptr,x)
	LDX.b $12
	JSR.w CODE_06C1EF
	JSR.w CODE_06C2FA
	JSR.w CODE_06C26A
	LDA.w $61B2
	AND.w #$C000
	BEQ.b CODE_06BD75
	LDY.b #$FF
	STY.w $7862
CODE_06BD75:
	STZ.w $0DB6
	RTL

; Baby-Mario-bubble screen-edge bumper bitmasks, OR'd into $7860 (collision flags)
; via TSB. Y selects the edge being struck: 0=right ($08), 2=left ($04),
; 4=top ($02), 6=bottom ($01). Used by CODE_06BD81 (bubble bounce handler in
; the off-Yoshi Baby Mario state path).
DATA_baby_mario_bubble_edge_bits:
DATA_06BD79:
	dw $0008,$0004,$0002,$0001

CODE_06BD81:
	LDY.w $61CC
	BNE.b CODE_06BDCD
	LDY.b #$00
	LDA.w $70E2
	CMP.w $7E18
	BPL.b CODE_06BD95
	LDA.w $7E18
	BRA.b CODE_06BDA7

CODE_06BD95:
	SEC
	SBC.w #$00F0
	CMP.w $7E1A
	BMI.b CODE_06BDCE
	INY
	INY
	LDA.w $7E1A
	CLC
	ADC.w #$00EF
CODE_06BDA7:
	STA.w $70E2
	LDA.w DATA_06BD79,y
	TSB.w $7860
	LDA.w $75E0
	EOR.w #$FFFF
	INC
	STA.w $75E0
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	LDA.w $7400
	EOR.w #$0002
	STA.w $7400
CODE_06BDCD:
	RTS

CODE_06BDCE:
	LDA.w $0C1C
	BEQ.b CODE_06BDCD
	LDY.b $76
	CPY.b #$01
	BEQ.b CODE_06BDCD
	LDA.w $7040
	AND.w #$E000
	BEQ.b CODE_06BDCD
	LDY.b #$00
	LDA.w $7680
	SEC
	SBC.w #$0008
	BMI.b CODE_06BDFF
	SEC
	SBC.w #$00E0
	BMI.b CODE_06BE29
	STA.b $00
	INY
	INY
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w #$00E7
	BRA.b CODE_06BE08

CODE_06BDFF:
	STA.b $00
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w #$0008
CODE_06BE08:
	STA.w $70E2
	LDA.b $00
	EOR.w $75E0
	BMI.b CODE_06BE22
	LDA.w DATA_06BD79,y
	TSB.w $7860
	LDA.w $75E0
	EOR.w #$FFFF
	INC
	STA.w $75E0
CODE_06BE22:
	LDA.w $75E0
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
CODE_06BE29:
	LDY.b #$04
	LDA.w $7682
	SEC
	SBC.w #$0008
	BMI.b CODE_06BE47
	SEC
	SBC.w #$00C0
	BMI.b CODE_06BE71
	STA.b $00
	INY
	INY
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$00C7
	BRA.b CODE_06BE50

CODE_06BE47:
	STA.b $00
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$0008
CODE_06BE50:
	STA.w $7182
	LDA.b $00
	EOR.w $75E2
	BMI.b CODE_06BE6A
	LDA.w DATA_06BD79,y
	TSB.w $7860
	LDA.w $75E2
	EOR.w #$FFFF
	INC
	STA.w $75E2
CODE_06BE6A:
	LDA.w $75E2
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
CODE_06BE71:
	RTS

CODE_06BE72:
	LDA.w $7040
	AND.w #$E000
	BEQ.b CODE_06BE8A
	STZ.w $7540
	STZ.w $7542
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	LDY.b #$09
	BRA.b CODE_06BE8F

CODE_06BE8A:
	JSR.w CODE_06BF1E
	LDY.b #$08
CODE_06BE8F:
	STY.b $76
	LDA.w #$6040
	STA.w $6FA2
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	ASL
	STA.w $74A2
	STX.b $18
	LDA.w $61B2
	ORA.w #$4000
	STA.w $61B2
	STZ.w $0D9C
	LDA.w #!Define_YI_SoundID3D_MarioKidnapped
	JSL.l CODE_push_sound_queue
	RTL

CODE_06BEBA:
	LDA.w #!Define_YI_SoundID3D_MarioKidnapped
	JSL.l CODE_push_sound_queue
CODE_06BEC1:
	JSR.w CODE_06BF1E
	LDA.w #$0020
	STA.w $7542
	LDA.w #$0008
	STA.w $7540
	STZ.w $75E2
	STZ.w $75E0
	LDY.b #$0A
	STY.b $76
CODE_06BEDA:
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0030
	CLC
	ADC.w $609C
	CLC
	ADC.w #$0030
	CMP.w #$8000
	ROR
	STA.w $0DB2
	RTL

CODE_06BEF1:
	JSR.w CODE_06BF1E
	LDA.w #$0020
	STA.w $7542
	LDA.w #$0008
	STA.w $7540
	STZ.w $75E2
	STZ.w $75E0
	LDY.b #$0D
	STY.b $76
	LDA.w #!Define_YI_SoundID3D_MarioKidnapped
	JSL.l CODE_push_sound_queue
	RTL

CODE_06BF12:
	JSL.l CODE_06C114
	JSL.l CODE_06BF73
	JSR.w CODE_06C070
	RTL

CODE_06BF1E:
	LDA.w #$001B
	STA.w $7402
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	STZ.w $7540
	STZ.w $7542
	LDA.w #$F620
	STA.w $6FA0
	LDA.w #$604F
	STA.w $6FA2
	LDA.w #$3001
	STA.w $7040
	LDA.w $61B2
	BPL.b CODE_06BF5F
	AND.w #$7FFF
	STA.w $61B2
	LDA.w #$0040
	STA.w $7AF8
	LDA.w #$FFFF
	STA.w $7E48
	LDA.w #$0000
	STA.w $0D92
CODE_06BF5F:
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	STZ.b $16
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	STZ.w $7860
	LDY.b #$00
	STY.w $7862
	RTS

CODE_06BF73:
	LDA.w $7040
	AND.w #$E000
	BEQ.b CODE_06BFDB
	LDA.w #$000D
	STA.w $7402
	LDA.w #$0040
	STA.w $7542
	LDA.w #$0400
	STA.w $75E2
	STZ.w $7540
	LDA.w #$604F
	STA.w $6FA2
	LDA.w #$1801
	STA.w $7040
	STZ.w $7AF8
	LDY.b #$00
	STY.w $7862
CODE_06BFA4:
	LDA.w #!Define_YI_AmbSpr1E1
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2
	CLC
	ADC.w #$0008
	STA.w $70A2,y
	LDA.w $7182
	CLC
	ADC.w #$0008
	STA.w $7142,y
	LDA.w #$000A
	STA.w $73C2,y
	STA.w $7E4E,y
	LDA.w #$000C
	STA.w $7E4C,y
	LDA.w #$0001
	STA.w $7782,y
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
CODE_06BFDB:
	RTL

CODE_06BFDC:
	LDA.w $0B59
	BEQ.b CODE_06BFE9
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	CMP.w #$000A
	BEQ.b CODE_06BFEC
CODE_06BFE9:
	JSR.w CODE_06C9E1
CODE_06BFEC:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	CMP.w #$000A
	BEQ.b CODE_06C065
	LDY.w $0D9A
	BEQ.b CODE_06C00A
	JSL.l CODE_03B69D
CODE_06BFFD:
	JSL.l CODE_03B716
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	CMP.w #$0008
	BEQ.b CODE_06C028
	RTS

CODE_06C00A:
	LDY.b $76
	CPY.b #$05
	BMI.b CODE_06C020
	CPY.b #$08
	BPL.b CODE_06C020
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_06BFFD
	RTS

CODE_06C020:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	CMP.w #$0008
	BNE.b CODE_06C065
CODE_06C028:
	STA.w $0D9A
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDA.w #$8000
	TSB.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	LDY.b $76
	CPY.b #$08
	BMI.b CODE_06C042
	JSL.l CODE_06C114
	JSL.l CODE_06BF73
CODE_06C042:
	LDY.w $6150
	CPY.b #$04
	BNE.b CODE_06C053
	LDA.w $6154
	CMP.w #$FFF0
	BMI.b CODE_06C065
	BRA.b CODE_06C05F

CODE_06C053:
	LDA.w $6152
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_06C065
CODE_06C05F:
	STZ.w $6168
	JSR.w CODE_06C070
CODE_06C065:
	PLA
	STA.b $00
	JSL.l CODE_03AF23
	LDA.b $00
	PHA
	RTS

CODE_06C070:
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	LDY.b #$00
	STY.w $7862
	LDA.w #$0040
	STA.w $7542
	LDY.b #$01
	STY.b $76
	STZ.w $0D9C
	LDY.w $0B57
	BNE.b CODE_06C099
	INC.w $0D9A
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	INC.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
CODE_06C099:
	RTS

CODE_06C09A:
	LDA.w #$0400
	STA.w $75E2
	LDA.w #$0040
	STA.w $7542
	LDY.b #$0A
	LDA.w $7040
	AND.w #$E000
	BEQ.b CODE_06C0CF
	INY
	BRA.b CODE_06C0CF

CODE_06C0B3:
	LDA.b $76
	SEC
	SBC.w #$000D
	BRA.b CODE_06C0CB

CODE_06C0BB:
	LDA.b $76
	CMP.w #$0008
	BEQ.b CODE_06C0C7
	CMP.w #$0009
	BNE.b CODE_06C0FD
CODE_06C0C7:
	SEC
	SBC.w #$0008
CODE_06C0CB:
	CLC
	ADC.w #$000A
CODE_06C0CF:
	STA.b $76
	CMP.w #$000B
	BNE.b CODE_06C0FD
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	LDA.w #$0002
	STA.w $7540
	ASL
	STA.w $7542
	LDA.w #$FF00
	STA.w $75E2
	LDX.w $7400
	LDA.l DATA_06C4B9,x
	STA.w $75E0
	LDX.b $12
	STZ.w $7AF6
	STZ.b $16
CODE_06C0FD:
	STZ.b $18
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	LDA.w $61B2
	AND.w #$BFFF
	STA.w $61B2
	LDA.w #$604F
	STA.w $6FA2
	JMP.w CODE_06BEDA

CODE_06C114:
	LDY.b $18
	BNE.b CODE_06C119
	RTL

CODE_06C119:
	JSL.l CODE_06C0BB
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr0D9_FishinLakitu
	BNE.b CODE_06C12A
	LDA.w $100F
	BNE.b CODE_06C136
CODE_06C12A:
	LDA.w $70E2,y
	STA.w $70E2
	LDA.w $7182,y
	STA.w $7182
CODE_06C136:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr058_GreenToady
	BEQ.b CODE_06C16E
	CMP.w #!Define_YI_NorSpr05C_PinkToady
	BEQ.b CODE_06C173
	CMP.w #!Define_YI_NorSpr184_Bumpty
	BEQ.b CODE_06C16D
	CMP.w #!Define_YI_NorSpr0D9_FishinLakitu
	BEQ.b CODE_06C1B4
	CMP.w #!Define_YI_NorSpr119_Spooky
	BEQ.b CODE_06C16D
	CMP.w #!Define_YI_NorSpr017_FrogPirate
	BNE.b CODE_06C15A
	JMP.w CODE_06C1DF

CODE_06C15A:
	CMP.w #!Define_YI_NorSpr1A5_RunAwayMonkey
	BCC.b CODE_06C189
	CMP.w #!Define_YI_NorSpr1AA_HotLips
	BCS.b CODE_06C189
	TYX
	STZ.b $78,x
	JSL.l CODE_02B2BB
	LDX.b $12
CODE_06C16D:
	RTL

CODE_06C16E:
	LDA.w #$0000
	BRA.b CODE_06C176

CODE_06C173:
	LDA.w #$0005
CODE_06C176:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #$0040
	STA.w $7AF8,y
	LDA.w #$0000
	STA.w $7A38,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	RTL

CODE_06C189:
	SEP.b #$20
	LDA.b #$12
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	REP.b #$20
	LDA.w #$000A
	STA.w $7A36,y
	LDA.w #$0012
	STA.w $7402,y
	LDA.w #$0040
	STA.w $7A98,y
	LDA.w #$0000
	STA.w $7A38,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w $7540,y
	RTL

CODE_06C1B4:
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #$0100
	STA.w $75E2,y
	LDA.w #$0008
	STA.w $7542,y
	LDA.w #$0000
	STA.w $7A38,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	STA.w $7402,y
	LDA.w #$0060
	STA.w $7AF8,y
	LDA.w #$0200
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	RTL

CODE_06C1DF:
	SEP.b #$20
	LDA.b #$00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	REP.b #$20
	LDA.w #$0080
	STA.w $7AF8,y
	RTL

CODE_06C1EF:
	LDA.w $0D94
	ORA.w $614A
	ORA.w $0D9C
	BEQ.b CODE_06C1FB
CODE_06C1FA:
	RTS

CODE_06C1FB:
	LDY.w $7D36
	BPL.b CODE_06C1FA
	LDA.w $61D6
	CMP.w #$0050
	BPL.b CODE_06C1FA
	LDY.b $76
	CPY.b #$04
	BMI.b CODE_06C212
	CPY.b #$08
	BMI.b CODE_06C1FA
CODE_06C212:
	LDA.w $7AF8
	BEQ.b CODE_06C25F
	CMP.w #$0020
	BCS.b CODE_06C1FA
	LDY.b $18
	BEQ.b CODE_06C1FA
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr020_Bandit
	BEQ.b CODE_06C237
	CMP.w #!Define_YI_NorSpr0A3_LeftHidingBandit
	BEQ.b CODE_06C237
	CMP.w #!Define_YI_NorSpr0A4_RightHidingBandit
	BEQ.b CODE_06C237
	CMP.w #!Define_YI_NorSpr05B_RedCoinBandit
	BNE.b CODE_06C25F
CODE_06C237:
	SEP.b #$20
	LDA.b #$18
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	REP.b #$20
	LDA.w #$0017
	STA.w $7402,y
	LDA.w #$0007
	STA.w $7A36,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	LDA.w #$0020
	STA.w $7AF8
	RTS

CODE_06C25F:
	JSL.l CODE_06C114
	JSL.l CODE_06BF73
	JMP.w CODE_06C070

CODE_06C26A:
	LDA.w $6FA2
	AND.w #$9FFF
	LDY.w $0CC8
	BNE.b CODE_06C27A
	ORA.w #$6000
	BRA.b CODE_06C27D

CODE_06C27A:
	ORA.w #$4000
CODE_06C27D:
	STA.w $6FA2
	RTS

CODE_06C281:
	LDA.w !RAM_YI_Level_StarTimerLo
	CMP.w #!Define_YI_Level_StarTimerThatSpawnsToadiesThreshold-$01
	BPL.b CODE_06C2B4
	JSR.w CODE_06C2B5
	BPL.b CODE_06C2B1
	LDA.w $61B2
	BIT.w #$4000
	BEQ.b CODE_06C2A2
	LDX.b $18
	JSL.l CODE_03A31E
	LDX.b $12
	JSL.l CODE_06C114
CODE_06C2A2:
	LDA.w #$FFFF
	STA.w $7AF8
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	STZ.w $7542
CODE_06C2B1:
	JSR.w CODE_06C876
CODE_06C2B4:
	RTS

CODE_06C2B5:
	LDA.w #$0800
	CMP.w $7182
	BMI.b CODE_06C2F5
	LDA.w $7680,x
	CLC
	ADC.w #$0010
	CMP.w #$0120
	BCC.b CODE_06C2F6
	LDA.w $7682,x
	CLC
	ADC.w #$0010
	CMP.w #$0120
	BCC.b CODE_06C2F6
	PHX
	REP.b #$10
	LDA.w $7CD8
	AND.w #$FF00
	LSR
	LSR
	LSR
	LSR
	STA.b $00
	LDA.w $7CD6
	AND.w #$FF00
	XBA
	ORA.b $00
	TAX
	LDA.w $6CAA,x
	SEP.b #$10
	PLX
	TAY
CODE_06C2F5:
	RTS

CODE_06C2F6:
	LDA.w #$0000
	RTS

CODE_06C2FA:
	LDY.w $0B59
	BEQ.b CODE_06C326
	LDY.b $76
	CPY.b #$01
	BEQ.b CODE_06C326
	CPY.b #$02
	BEQ.b CODE_06C326
	LDA.w $7040
	AND.w #$E000
	BEQ.b CODE_06C326
	LDY.w $7402
	CPY.b #$1F
	BMI.b CODE_06C326
	JSL.l CODE_06C114
	LDA.w #$001F
	TRB.w $6FA2
	LDY.b #$0C
	STY.b $76,x
CODE_06C326:
	RTS

DATA_06C327:
	db $15,$16,$15,$17

CODE_06C32B:
	LDA.w $7860
	AND.w #$0001
	BNE.b CODE_06C33D
	LDY.w $7862
	BEQ.b CODE_06C352
	LDY.w $7223
	BMI.b CODE_06C37E
CODE_06C33D:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	PHA
	JSL.l CODE_06BEC1
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	RTS

CODE_06C352:
	LDY.w $7223
	BMI.b CODE_06C37E
	LDA.w $0B57
	BNE.b CODE_06C364
	LDA.w $0DB2
	CMP.w $7182
	BMI.b CODE_06C33D
CODE_06C364:
	LDY.w $7A98
	BNE.b CODE_06C37E
	LDY.b #$08
	STY.w $7A98
	LDA.b $16
	DEC
	AND.w #$0003
	TAY
	STY.b $16
	LDA.w DATA_06C327,y
	TAY
	STY.w $7402
CODE_06C37E:
	RTS

DATA_06C37F:
	dw $0100,$FF00

CODE_06C383:
	LDY.w $0B57
	BEQ.b CODE_06C38B
	JMP.w CODE_06C414

CODE_06C38B:
	SEP.b #$20
	LDA.b #$04
	STA.w $74A2
	REP.b #$20
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	CMP.w #$0008
	BNE.b CODE_06C3AA
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	STZ.w $6168
	LDY.b #$00
	STY.w $7862
CODE_06C3AA:
	LDY.w $0D9C
	BNE.b CODE_06C400
	LDA.w $7C16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$F800
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	STZ.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7C18
	BMI.b CODE_06C3E4
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$F800
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_06C3E4:
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	STZ.w $7860
	LDY.b #$0D
	STY.w $7402
	LDA.w #$6040
	STA.w $6FA2
	INC.w $0D9C
	RTS

CODE_06C400:
	LDY.w $7223
	BMI.b CODE_06C463
	LDA.w $7C18
	CMP.w #$0008
	BCS.b CODE_06C453
	LDA.w #!Define_YI_SoundID43_MountYoshi
	JSL.l CODE_push_sound_queue
CODE_06C414:
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	LDA.w #$000A
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	STZ.w $7A36
	STZ.w $7A38
	STZ.b $16
	STZ.b $76
	STZ.b $18
	LDA.w #$604F
	STA.w $6FA2
	LDY.b #$00
	STY.w $7862
	LDA.w $61B2
	AND.w #$0FFF
	ORA.w #$8000
	STA.w $61B2
	STZ.w $0D9C
	STZ.w $0D9A
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDX.b $12
	PLA
	RTL

CODE_06C453:
	LDA.w $7860
	AND.w #$0001
	BEQ.b CODE_06C463
	LDA.w #$0006
	STA.b $16
	STZ.w $0D9C
CODE_06C463:
	RTS

DATA_06C464:
	db $24,$25,$26,$27,$23,$22,$21,$20,$22,$23,$27,$26,$25,$24,$20,$21
	db $22,$23,$22,$21,$20

DATA_06C479:
	db $20,$04,$04,$20,$20,$04,$04,$20,$04,$20,$20,$04,$04,$20,$20,$04
	db $04,$20,$04,$04,$20

CODE_06C48E:
	LDY.w $7A98
	BNE.b CODE_06C4AE
	DEC.b $16
	BPL.b CODE_06C49C
	LDA.w #$0014
	STA.b $16
CODE_06C49C:
	LDY.b $16
	LDA.w DATA_06C464,y
	AND.w #$00FF
	STA.w $7402
	LDA.w DATA_06C479,y
	TAY
	STY.w $7A98
CODE_06C4AE:
	RTS

DATA_06C4AF:
	db $1B,$1C,$1D,$1F,$1E,$1F,$1D,$1F,$1E,$1F

DATA_06C4B9:
	dw $FF80,$0080

CODE_06C4BD:
	LDY.w $614E
	CPY.b #$03
	BNE.b CODE_06C51B
CODE_06C4C4:
	LDY.w $7A98
	BNE.b CODE_06C51B
	LDY.b #$02
	STY.w $7A98
	INC.b $16
	LDY.b $16
	CPY.b #$09
	BMI.b CODE_06C514
	PHY
	LDY.b $76
	CPY.b #$08
	BEQ.b CODE_06C50F
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	LDA.w #$FF80
	STA.w $75E2
	STZ.w $7542
	LDA.w #$0002
	STA.w $7542
	CPY.b #$0A
	BNE.b CODE_06C50F
	STA.w $7540
	ASL
	STA.w $7542
	LDA.w #$FF00
	STA.w $75E2
	LDY.w $7400
	LDA.w DATA_06C4B9,y
	STA.w $75E0
	STZ.w $7AF6
CODE_06C50F:
	PLY
	STZ.b $16
	INC.b $76
CODE_06C514:
	LDA.w DATA_06C4AF-$01,y
	TAY
	STY.w $7402
CODE_06C51B:
	LDY.b $76
	CPY.b #$08
	BEQ.b CODE_06C525
	CPY.b #$09
	BNE.b CODE_06C528
CODE_06C525:
	JSR.w CODE_06C529
CODE_06C528:
	RTS

CODE_06C529:
	LDY.b $18
	BEQ.b CODE_06C574
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0002
	BNE.b CODE_06C53A
	JSL.l CODE_06C0BB
	RTS

CODE_06C53A:
	CMP.w #$0010
	BNE.b CODE_06C574
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr1A2_HealthStar
	BEQ.b CODE_06C574
	CMP.w #!Define_YI_NorSpr115_Coin
	BEQ.b CODE_06C574
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr0D9_FishinLakitu
	BEQ.b CODE_06C578
	LDA.w $70E2,y
	SEC
	SBC.w $70E2
	CLC
	ADC.w #$0018
	CMP.w #$0030
	BCS.b CODE_06C574
	LDA.w $7182,y
	SEC
	SBC.w $7182
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCC.b CODE_06C578
CODE_06C574:
	JSL.l CODE_06C114
CODE_06C578:
	RTS

DATA_06C579:
	dw $201F,$211F,$2223,$2423

DATA_06C581:
	dw $0804,$0804,$1008,$1008,$1820,$0A10,$00E0,$0020

CODE_06C591:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_06C5A2
	JSL.l CODE_03B69D
CODE_06C5A2:
	LDA.w $0C8A
	ORA.w $614E
	BNE.b CODE_06C5CE
	JSL.l CODE_06BF73
	LDA.w #$000A
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	LDA.w $61B2
	AND.w #$0FFF
	ORA.w #$8000
	STA.w $61B2
	TXA
	STA.w $7E48
	LDA.w #$FFFF
	STA.w $0D92
	STZ.b $76
	PLA
	RTL

CODE_06C5CE:
	LDA.w $7860
	AND.w #$0003
	BEQ.b CODE_06C607
	PHA
	STZ.w $7860
	LDA.w $7182
	SEC
	SBC.w $72C2
	STA.w $7182
	PLA
	AND.w #$0002
	DEC
	EOR.w $75E2
	BMI.b CODE_06C5F3
	LDA.w $75E2
	BRA.b CODE_06C5FA

CODE_06C5F3:
	LDA.w $75E2
	EOR.w #$FFFF
	INC
CODE_06C5FA:
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	BRA.b CODE_06C60F

CODE_06C607:
	LDA.w $75E2
	CMP.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	BNE.b CODE_06C61F
CODE_06C60F:
	LDA.w #$0080
	STA.w $7A96
	LDA.w $75E2
	EOR.w #$FFFF
	INC
	STA.w $75E2
CODE_06C61F:
	LDY.w $7A98
	BEQ.b CODE_06C627
	JMP.w CODE_06C6CE

CODE_06C627:
	LDA.b $16
	INC
	AND.w #$0003
	STA.b $16
	LDY.b $76
	CPY.b #$06
	BEQ.b CODE_06C639
	CLC
	ADC.w #$0004
CODE_06C639:
	TAY
	LDA.w DATA_06C581,y
	AND.w #$00FF
	STA.w $7A98
	LDA.w DATA_06C579,y
	TAY
	STY.w $7402
	CPY.b #$24
	BNE.b CODE_06C657
	LDA.w #!Define_YI_SoundID44_MarioCrying
	JSL.l CODE_push_sound_queue
	BRA.b CODE_06C6CE

CODE_06C657:
	CPY.b #$22
	BNE.b CODE_06C6CE
	LDA.w !RAM_YI_Level_StarTimerLo
	CMP.w #!Define_YI_Level_MaxRegenStarTimerThreshold+$01
	BMI.b CODE_06C6A7
	LDA.b $10
	AND.w #$0003
	ASL
	ASL
	INC
	LDY.w $0DBA
	BNE.b CODE_06C674
	EOR.w #$FFFF
	INC
CODE_06C674:
	CLC
	ADC.w $0DB8
	STA.w $0DB8
	CMP.w #$000C
	BPL.b CODE_06C68A
	SEC
	SBC.w #$0018
	EOR.w #$FFFF
	INC
	BRA.b CODE_06C696

CODE_06C68A:
	CMP.w #$0029
	BMI.b CODE_06C6A2
	LDA.w #$0050
	SEC
	SBC.w $0DB8
CODE_06C696:
	STA.w $0DB8
	LDA.w $0DBA
	EOR.w #$0001
	STA.w $0DBA
CODE_06C6A2:
	LDA.w $0DB8
	BRA.b CODE_06C6CB

CODE_06C6A7:
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0200
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $7A98
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
CODE_06C6CB:
	STA.w $7A98
CODE_06C6CE:
	JMP.w CODE_06C51B

CODE_06C6D1:
	LDY.w $7223
	BMI.b CODE_06C6E7
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDA.w #$0020
	STA.w $61F4
	STZ.w $0C88
	DEC.b $76
CODE_06C6E7:
	RTS

DATA_06C6E8:
	dw $00F0,$00D0

CODE_06C6EC:
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	BMI.b CODE_06C6F5
	INY
	INY
CODE_06C6F5:
	STY.w $7400
	LDY.w $7AF6
	BEQ.b CODE_06C72D
	INC.w $7AF6
	LDA.w $0DB2
	CMP.w $7182
	BMI.b CODE_06C715
	LDA.w $7860
	AND.w #$0001
	BNE.b CODE_06C715
	LDY.w $7862
	BEQ.b CODE_06C72A
CODE_06C715:
	LDA.w #$FF40
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	LDA.w #$0080
	STA.w $75E2
	LDA.w #$0002
	STA.w $7542
	STZ.w $7AF6
CODE_06C72A:
	JMP.w CODE_06C61F

CODE_06C72D:
	LDA.w #$0004
	LDY.w $7683
	BEQ.b CODE_06C741
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	AND.w #$FFF0
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	LDA.w #$0010
CODE_06C741:
	STA.w $7542
	LDY.w $7D36
	DEY
	BMI.b CODE_06C784
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_06C784
	LDA.w $7D38,y
	BEQ.b CODE_06C784
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDY.b #$02
	STY.w $7AF6
	LDA.w #$0400
	STA.w $75E2
	LDA.w #$0040
	STA.w $7542
	STZ.w $75E0
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0030
	CMP.w #$07E0
	BMI.b CODE_06C77F
	LDA.w #$07E0
CODE_06C77F:
	STA.w $0DB2
	BRA.b CODE_06C72A

CODE_06C784:
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	BPL.b CODE_06C78D
	INY
	INY
CODE_06C78D:
	LDA.w DATA_06C6E8,y
	LDY.b #$00
	CMP.w $7680
	BMI.b CODE_06C799
	INY
	INY
CODE_06C799:
	LDA.w DATA_06C4B9,y
	STA.w $75E0
	LDY.w $7862
	BEQ.b CODE_06C7AB
	LDY.w $75E3
	BMI.b CODE_06C80F
	BRA.b CODE_06C7CF

CODE_06C7AB:
	LDA.w $7860
	AND.w #$0003
	BEQ.b CODE_06C7ED
	STZ.w $7860
	AND.w #$0002
	DEC
	EOR.w $75E2
	BMI.b CODE_06C7CF
	LDA.w $75E2
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	BRA.b CODE_06C80F

CODE_06C7CF:
	LDA.w $7182
	SEC
	SBC.w $72C2
	STA.w $7182
	LDA.w $75E2
	EOR.w #$FFFF
	INC
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	BRA.b CODE_06C805

CODE_06C7ED:
	LDA.w $75E2
	CMP.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	BNE.b CODE_06C80F
	LDA.w $0DB2
	SEC
	SBC.w $7182
	EOR.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	BPL.b CODE_06C80F
	JSL.l CODE_06BEDA
CODE_06C805:
	LDA.w $75E2
	EOR.w #$FFFF
	INC
	STA.w $75E2
CODE_06C80F:
	JMP.w CODE_06C61F

CODE_06C812:
	LDA.w #$0002
	STA.w $7400
	LDA.w $7C16
	PHP
	BPL.b CODE_06C822
	EOR.w #$FFFF
	INC
CODE_06C822:
	LSR
	CMP.w #$0018
	BMI.b CODE_06C82B
	LDA.w #$0018
CODE_06C82B:
	CLC
	ADC.w #$0018
	STA.w $7540
	ASL
	ASL
	ASL
	ASL
	PLP
	BMI.b CODE_06C840
	EOR.w #$FFFF
	INC
	STZ.w $7400
CODE_06C840:
	STA.w $75E0
	LDA.w $7C18
	PHP
	BPL.b CODE_06C84D
	EOR.w #$FFFF
	INC
CODE_06C84D:
	LSR
	CMP.w #$0018
	BMI.b CODE_06C856
	LDA.w #$0018
CODE_06C856:
	CLC
	ADC.w #$0018
	STA.w $7542
	ASL
	ASL
	ASL
	ASL
	PLP
	BMI.b CODE_06C868
	EOR.w #$FFFF
	INC
CODE_06C868:
	STA.w $75E2
	JMP.w CODE_06C61F

DATA_06C86E:
	dw $FFC0,$FFF0,$0000,$0020

CODE_06C876:
	LDX.b $12
	LDA.w $0E35
	BEQ.b CODE_06C886
	LDA.w $03A1
	ORA.w $03A3
	BEQ.b CODE_06C886
CODE_06C885:
	RTS

CODE_06C886:
	LDA.w $0E33
	BNE.b CODE_06C885
	INC.w $0E33
	STZ.w $61CC
	STZ.w $0E2F
	STZ.w $0E2D
	LDA.w #$0004
	STA.w $0E31
	LDA.w $6094
	STA.b $0A
	LDA.w $609C
	STA.b $0C
	STZ.b $0E
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.w #$0009
	BNE.b CODE_06C8BF
	LDA.w $609A
	STA.b $0A
	LDA.w $60A2
	STA.b $0C
	LDY.b #$06
	STY.b $0E
CODE_06C8BF:
	LDY.b #$08
	LDA.w #!Define_YI_NorSpr091_4RedToadies
	JSL.l CODE_03A366
	LDA.b $0A
	CLC
	ADC.w #$0080
	STA.w $70E2,y
	LDA.b $0C
	SEC
	SBC.w #$0010
	STA.w $7182,y
	LDA.w $74A1,y
	ORA.b $0E
	STA.w $74A1,y
	LDY.b #$00
	LDX.b #$0C
CODE_06C8E6:
	STZ.w $0E37,x
	STZ.w $0E39,x
	STZ.w $0E49,x
	STZ.w $0E4B,x
	LDA.w DATA_06C86E,y
	STA.w $0E38,x
	STZ.w $0E9B,x
	STZ.w $0EC9,x
	STZ.w $0E69,x
	STZ.w $0E6B,x
	STZ.w $0E89,x
	STZ.w $0E8B,x
	STZ.w $0E79,x
	STZ.w $0E7B,x
	STZ.w $0EAB,x
	STZ.w $0EB9,x
	STZ.w $0EBB,x
	STZ.w $0EA9,x
	STZ.w $0E59,x
	STZ.w $0E5B,x
	STZ.w $0E99,x
	INY
	INY
	DEX
	DEX
	DEX
	DEX
	BPL.b CODE_06C8E6
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

DATA_06C930:
	db $00,$01,$00,$02,$03,$03,$03,$03,$03,$03,$03,$03,$03,$03,$03,$04
	db $03,$05,$06,$07,$07,$08,$09,$0A,$0B,$0C,$0D,$0E,$0F,$10,$10,$11
	db $06,$12,$12,$06,$03,$13,$13,$03,$14,$14,$15,$10,$16,$17,$17,$16
	db $0F,$18,$19,$08,$10

DATA_06C965:
	dw FXDATA_520000+$5C00,FXDATA_520000+$5C40,FXDATA_520000+$5C00,FXDATA_520000+$5CC0,FXDATA_520000+$5C00,FXDATA_520000+$5D00,FXDATA_520000+$5C00,FXDATA_520000+$5C80
	dw FXDATA_520000+$58C0,FXDATA_520000+$5C80,FXDATA_520000+$5900,FXDATA_520000+$5C80,FXDATA_520000+$5800,FXDATA_520000+$5C80,FXDATA_520000+$5000,FXDATA_520000+$5040
	dw FXDATA_520000+$5480,FXDATA_520000+$54C0,FXDATA_520000+$5500,FXDATA_520000+$5540,FXDATA_520000+$5580,FXDATA_520000+$55C0,FXDATA_520000+$4800,FXDATA_520000+$4C00
	dw FXDATA_520000+$4840,FXDATA_520000+$4C40,FXDATA_520000+$4880,FXDATA_520000+$4C80,FXDATA_520000+$5900,FXDATA_520000+$5D80,FXDATA_520000+$5C00,FXDATA_520000+$5D80
	dw FXDATA_520000+$58C0,FXDATA_520000+$5D80,FXDATA_520000+$5080,FXDATA_520000+$50C0,FXDATA_520000+$4900,FXDATA_520000+$5C80

UNK_06C9B1:
	db $00

DATA_06C9B2:
	db $4D,$80,$5C,$00,$5C,$80,$59,$C0,$5D,$C0,$59,$00,$58,$80,$5D,$00
	db $49,$80,$5D,$80,$49,$80,$4D,$C0,$48,$C0,$4C,$03,$03,$03,$03,$03
	db $03,$03,$0D,$0C,$0B

CODE_06C9D7:
	PHB
	PHK
	PLB
	JSR.w CODE_06C9E1
	PLB
	LDX.b $12
	RTL

CODE_06C9E1:
	LDA.w $7402
	CMP.b $78
	BEQ.b CODE_06CA22
	STA.b $78
	TAY
	LDA.w $7040
	AND.w #$F800
	CMP.w #$3000
	BNE.b CODE_06C9FB
	LDA.w DATA_06C9B2,y
	BRA.b CODE_06C9FE

CODE_06C9FB:
	LDA.w DATA_06C930,y
CODE_06C9FE:
	AND.w #$00FF
	ASL
	ASL
	TAY
	PHX
	LDX.b #$00
CODE_06CA07:
	LDA.w DATA_06C965,y
	STA.w $0B87,x
	CLC
	ADC.w #$0200
	STA.w $0B89,x
	INY
	INY
	INX
	INX
	INX
	INX
	CPX.b #$08
	BMI.b CODE_06CA07
	INC.w $0B85
	PLX
CODE_06CA22:
	RTS

;---------------------------------------------------------------------------

DATA_06CA23:
DATA_baby_mario_levelmode9_state_ptr:           ; 5-entry state table for Baby Mario in level-mode $09 (intro cutscene path)
	dw CODE_06CDAB
	dw CODE_06CDEF
	dw CODE_06CE2F
	dw CODE_06CE2E
	dw CODE_06CEFB

CODE_06CA2D:
	LDA.w $03A1
	ORA.w $03A3
	BNE.b CODE_06CA38
	JSR.w CODE_06C876
CODE_06CA38:
	JSR.w CODE_06CB27
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	CMP.w #$000A
	BNE.b CODE_06CA4A
	JSR.w CODE_06C9E1
	JSL.l CODE_03AF23
CODE_06CA4A:
	JSR.w CODE_06CCF8
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_06CA60
	JSL.l CODE_03B716
	JSL.l CODE_03B69D
CODE_06CA60:
	LDA.w $7680
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611C
	CLC
	ADC.w !RAM_YI_Global_Layer1XPosLo
	STA.w $7C16
	LDA.w $7682
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611E
	CLC
	ADC.w !RAM_YI_Global_Layer1YPosLo
	STA.w $7C18
	JSR.w CODE_06CAA4
	LDA.b $76
	ASL
	TAX
	JSR.w (DATA_baby_mario_levelmode9_state_ptr,x)
	JSR.w CODE_06CB05
	LDY.b $76
	CPY.b #$03
	BEQ.b CODE_06CAA1
	CPY.b #$02
	BEQ.b CODE_06CAA1
	JSR.w CODE_06CC9E
	JSR.w CODE_06CB15
CODE_06CAA1:
	LDX.b $12
	RTL

CODE_06CAA4:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	CMP.w #$0008
	BNE.b CODE_06CB04
	LDY.b $76
	CPY.b #$02
	BEQ.b CODE_06CB04
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	STA.w $0D9A
	LDA.w #$8000
	TSB.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	LDY.w $6150
	CPY.b #$04
	BNE.b CODE_06CAD2
	LDA.w $6154
	CMP.w #$FFF0
	BMI.b CODE_06CB04
	BRA.b CODE_06CADE

CODE_06CAD2:
	LDA.w $6152
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_06CB04
CODE_06CADE:
	STZ.w $6168
CODE_06CAE1:
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	LDY.b #$00
	STY.w $7862
	LDY.b #$07
	STY.w $0DB4
	LDY.b #$02
	STY.b $76
	STZ.w $0D9C
	INC.w $0D9A
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	INC.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
CODE_06CB04:
	RTS

CODE_06CB05:
	LDA.w $7AF8
	BNE.b CODE_06CB14
	LDY.w $7D36
	BPL.b CODE_06CB14
	LDY.w $0D9C
	BEQ.b CODE_06CAE1
CODE_06CB14:
	RTS

CODE_06CB15:
	LDY.w $0B59
	BEQ.b CODE_06CB26
	LDA.w $7040
	AND.w #$E000
	BEQ.b CODE_06CB26
	LDY.b #$04
	STY.b $76
CODE_06CB26:
	RTS

CODE_06CB27:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	CMP.w #$000A
	BEQ.b CODE_06CB14
	LDA.w $0DB4
	CMP.w #$0007
	BPL.b CODE_06CB75
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7362
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #DATA_06CC0A>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_06CC0A
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w $7680
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7682
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7400
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0004
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08A16C>>16
	LDA.w #FXCODE_08A16C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	BRA.b CODE_06CB8B

CODE_06CB75:
	REP.b #$10
	LDY.w $7362
	LDA.w #$8000
	STA.w $6000,y
	STA.w $6008,y
	STA.w $6010,y
	STA.w $6018,y
	SEP.b #$10
CODE_06CB8B:
	LDY.w $7400
	LDA.w $7680
	CLC
	ADC.w #$FFF8
	STA.b $00
	LDA.w $7682
	SEC
	SBC.w #$0008
	STA.b $02
	LDA.w $7400
	AND.w #$FF00
	LSR
	LSR
	LSR
	ORA.w $7042
	XBA
	STA.b $06
	REP.b #$10
	LDY.w $7362
	LDA.b $00
	STA.w $6020,y
	STA.w $6030,y
	CLC
	ADC.w #$0010
	STA.w $6028,y
	STA.w $6038,y
	LDA.b $02
	STA.w $6022,y
	STA.w $602A,y
	CLC
	ADC.w #$0010
	STA.w $6032,y
	STA.w $603A,y
	LDA.b $06
	ORA.w #$0062
	STA.w $6024,y
	LDA.b $06
	ORA.w #$0064
	STA.w $602C,y
	LDA.b $06
	ORA.w #$0082
	STA.w $6034,y
	LDA.b $06
	ORA.w #$0084
	STA.w $603C,y
	LDA.w #$0202
	STA.w $6026,y
	STA.w $602E,y
	STA.w $6036,y
	STA.w $603E,y
	SEP.b #$10
	RTS

DATA_06CC0A:
	dw $0300,$0AA2,$0800,$A303,$000A,$0B00,$0AB2,$0800
	dw $B30B,$000A,$FAFA,$0A9C,$FA02,$7E06,$02CA,$0605
	dw $8A7E,$0502,$7EFA,$020A,$F5FA,$0A9C,$FB02,$7E05
	dw $02CA,$0505,$8A7E,$0602,$7EF5,$020A,$F8F8,$0A9C
	dw $F802,$7E04,$02CA,$0408,$8A7E,$0802,$7EF8,$020A
	dw $F7F9,$0A9C,$F902,$7E05,$02CA,$0507,$8A7E,$0702
	dw $7EF7,$020A,$F6FA,$0A9C,$FA02,$7E06,$02CA,$0606
	dw $8A7E,$0602,$7EF6,$020A,$F8F8,$0A9C,$F802,$7E04
	dw $02CA,$0408,$8A7E,$0802,$7EF8,$020A,$FE80,$0180
	dw $FF80,$0080

CODE_06CC9E:
	LDA.w $70E2
	SEC
	SBC.w $72C0
	STA.w $70E2
	LDA.w $7182
	SEC
	SBC.w $72C2
	STA.w $7182
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	EOR.w #$FFFF
	SEC
	ADC.w $0DAA
	BPL.b CODE_06CCC1
	LDA.w #$7FFF
CODE_06CCC1:
	CMP.w #$3800
	BPL.b CODE_06CCD3
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	LDA.w #$3800
CODE_06CCD3:
	STA.w $0DAA
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	BEQ.b CODE_06CCE5
	EOR.w #$FFFF
	SEC
	ADC.w $0DAC
	STA.w $0DAC
CODE_06CCE5:
	SEP.b #$20
	LDA.w $0DAB
	STA.b $0E
	LDA.w $0DAD
	STA.b $00
	JSL.l CODE_0FB8F0
	REP.b #$20
	RTS

CODE_06CCF8:
	LDA.w #(FXDATA_550000+$60E1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_550000+$60E1
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDY.b $76
	CPY.b #$03
	BNE.b CODE_06CD0F
	STZ.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BRA.b CODE_06CD22

CODE_06CD0F:
	LDY.w $0D05
	TYA
	STA.b $00
	LDY.w $0DAD
	TYA
	CLC
	ADC.b $00
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
CODE_06CD22:
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$4620
	STA.b $00
	LDA.w #$6000
	STA.b $02
	LDA.w #$0004
	STA.b $04
	PHB
	SEP.b #$20
	LDA.b #$7E4800>>16
	PHA
	PLB
	REP.b #$30
	LDX.w $7E4800
CODE_06CD55:
	LDA.b $00
	STA.w $0000,x
	LDA.w #$0180
	STA.w $0002,x
	LDA.w #$0018
	STA.w $0004,x
	LDA.b $02
	STA.w $0005,x
	LDA.w #$0070
	STA.w $0007,x
	LDA.w #$0080
	STA.w $0008,x
	LDA.b $00
	CLC
	ADC.w #$0100
	STA.b $00
	LDA.b $02
	CLC
	ADC.w #$0200
	STA.b $02
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,x
	TAX
	DEC.b $04
	BNE.b CODE_06CD55
	STX.w $7E4800
	SEP.b #$10
	PLB
	LDX.b $12
	RTS

DATA_06CD9D:
	db $00,$01,$02,$04,$03,$04,$02,$04,$03,$04

DATA_06CDA7:
	dw $FFC0,$0040

CODE_06CDAB:
	LDA.w $7A96
	BNE.b CODE_06CDE6
	LDY.w $7A98
	BNE.b CODE_06CDE6
	INC.b $16
	LDY.b $16
	CPY.b #$09
	BMI.b CODE_06CDDA
	LDY.w $7400
	LDA.w DATA_06CDA7,y
	STA.w $75E0
	LDA.w #$0004
	STA.w $7540
	LDA.w #$0004
	STA.w $7542
	STZ.w $75E2
	STZ.b $18
	INC.b $76
	RTS

CODE_06CDDA:
	LDA.w DATA_06CD9D-$01,y
	TAY
	STY.w $0DB4
	LDY.b #$02
	STY.w $7A98
CODE_06CDE6:
	RTS

DATA_06CDE7:
	db $04,$05,$04,$06

DATA_06CDEB:
	dw $0080,$FF80

CODE_06CDEF:
	LDY.w $7A98
	BNE.b CODE_06CE10
	LDA.b $16
	INC
	AND.w #$0003
	TAY
	STY.b $16
	AND.w #$0001
	ASL
	ASL
	CLC
	ADC.w #$0004
	STA.w $7A98
	LDA.w DATA_06CDE7,y
	TAY
	STY.w $0DB4
CODE_06CE10:
	LDY.w $7A96
	BNE.b CODE_06CE2E
	LDY.b #$60
	STY.w $7A96
	LDA.w #$0008
	STA.w $7542
	LDA.b $18
	EOR.w #$0002
	STA.b $18
	TAY
	LDA.w DATA_06CDEB,y
	STA.w $75E2
CODE_06CE2E:
	RTS

CODE_06CE2F:
	LDY.w $0D9C
	BNE.b CODE_06CE9E
	LDA.w $7C16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$F800
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	STZ.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7C18
	BMI.b CODE_06CE69
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$F800
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_06CE69:
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	STZ.w $7540
	LDA.w #$0040
	STA.w $7542
	LDA.w #$0400
	STA.w $75E2
	STZ.w $7860
	INC.w $0D9C
	LDY.w $0DB4
	CPY.b #$07
	BPL.b CODE_06CE93
	JSL.l CODE_06BFA4
CODE_06CE93:
	LDA.w $0DAC
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	STA.w $0DAC
	RTS

CODE_06CE9E:
	LDY.w $7223
	BMI.b CODE_06CE93
	LDA.w $7C18
	CMP.w #$0008
	BCS.b CODE_06CE93
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	LDA.w #!Define_YI_SoundID43_MountYoshi
	JSL.l CODE_push_sound_queue
	LDA.w #$000A
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	STZ.w $7A36
	STZ.w $7A38
	STZ.b $16
	STZ.b $76
	STZ.b $18
	LDY.b #$00
	STY.w $7862
	LDA.w #$000D
	STA.w $7402
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror
	LDA.w #$1801
	STA.w $7040
	LDA.w $61B2
	AND.w #$0FFF
	ORA.w #$8000
	STA.w $61B2
	STZ.w $0D9C
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDX.b $12
	PLA
	RTL

DATA_06CEF7:
	dw $0200,$FE00

CODE_06CEFB:
	LDY.w $0D05
	TYA
	STA.b $00
	LDY.w $0DAD
	TYA
	CLC
	ADC.b $00
	TAY
	PHP
	LDY.b #$00
	PLP
	BPL.b CODE_06CF11
	INY
	INY
CODE_06CF11:
	LDA.w DATA_06CEF7,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	JMP.w CODE_06CDEF

;-------------------------------------------------------------------------
; Baby Mario ($061) -- RideYoshi routine.
; The on-Yoshi state. Anchors Baby Mario to Yoshi's back, animates the
; bobbing, and triggers the cry / "bubble-away" sequence when Yoshi
; loses Mario from a hit. Largest single routine in the file (~340
; lines) -- includes anim tables, cry-timer ticks, and the Kamek-bubble
; spawn/glue logic. Raidenthequick: riding_baby_mario.
;-------------------------------------------------------------------------
YI_NorSpr061_BabyMario_RideYoshiRt:
riding_baby_mario:                         ; Raidenthequick: riding_baby_mario
;$06CF1A
	LDY.b #$00
	STY.w $7862
	LDA.w $0B59
	BEQ.b CODE_06CF34
	LDY.b #$FF
	LDA.w $60BE
	CMP.w #$0166
	BEQ.b CODE_06CF30
	LDY.b #$04
CODE_06CF30:
	STY.w $74A2
	RTL

CODE_06CF34:
	LDA.w $0B57
	BEQ.b CODE_06CF42
	LDA.w $60DE
	BEQ.b CODE_06CF42
	JSL.l CODE_03BD40
CODE_06CF42:
	TXA
	STA.w $7E48
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_06CF55
	JSL.l CODE_03B716
CODE_06CF55:
	JSR.w CODE_06CF66
	JSR.w CODE_06CFA5
	JSR.w CODE_06CFC4
	JSR.w CODE_06D019
	RTL

DATA_06CF62:
	dw $0003,$FFFB

CODE_06CF66:
	LDA.w $614E
	CMP.w #$0001
	BEQ.b CODE_06CF74
	LDY.w $0C8A
	BNE.b CODE_06CF74
	RTS

CODE_06CF74:
	LDY.b #$00
	STY.w $74A3
	LDY.w $60C4
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_06CF62,y
	STA.w $70E2
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$000A
	STA.w $7182
	LDA.w $7400
	EOR.w #$0002
	STA.w $7400
	INC.w $614E
	JSR.w CODE_06BF1E
	LDY.b #$05
	STY.b $76
	PLA
	RTL

CODE_06CFA5:
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState12_SmushedByWall
	BEQ.b CODE_06CFB6
	LDA.w $61D6
	SEC
	SBC.w #$009F
	BNE.b CODE_06CFC3
CODE_06CFB6:
	JSR.w CODE_06D110
	LDA.w $7182
	CLC
	ADC.w #$0004
	STA.w $7182
CODE_06CFC3:
	RTS

CODE_06CFC4:
	LDA.w #$FFFF
	LDY.w $74A2
	BMI.b CODE_06CFF2
	REP.b #$10
	LDY.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	CPY.w #!Define_YI_PlayerForm0E_Skiing
	BEQ.b CODE_06CFED
	LDY.w $60BE
	CPY.w #$0166
	BEQ.b CODE_06CFED
	LDA.w #$0002
	LDY.w $0E15
	BNE.b CODE_06CFED
	LDY.w $61CE
	BNE.b CODE_06CFED
	INC
	INC
CODE_06CFED:
	STA.w $74A2
	SEP.b #$10
CODE_06CFF2:
	RTS

CODE_06CFF3:
	LDY.w $0E15
	BEQ.b CODE_06D012
	LDY.b #$1B
	STY.w $7402
	LDY.b #$12
	STY.w $7A98
	LDA.w #$0004
	STA.b $16
	LDA.w #$000C
	STA.w $7A36
CODE_06D00D:
	STZ.w $7400
	INC.b $76
CODE_06D012:
	RTS

DATA_06D013:
	dw $000D,$0010,$0012

CODE_06D019:
	LDY.w $1078
	BEQ.b CODE_06D023
	LDY.b #$02
	JMP.w CODE_06D07C

CODE_06D023:
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState06
	BNE.b CODE_06D03E
	LDA.w $6106
	AND.w #$00FF
	CMP.w #$0002
	BEQ.b CODE_06D03B
	CMP.w #$0004
	BNE.b CODE_06D03E
CODE_06D03B:
	JMP.w CODE_06D0DE

CODE_06D03E:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_06D057
	LDY.w $0E15
	BEQ.b CODE_06D056
	LDY.b #$1F
	STY.w $7402
CODE_06D056:
	RTS

CODE_06D057:
	LDA.w !RAM_YI_Level_StarTimerLo
	CMP.w #$0032
	BPL.b CODE_06D060
	RTS

CODE_06D060:
	LDY.b #$02
	LDA.w $60C0
	BEQ.b CODE_06D06C
	LDA.w $60AA
	BRA.b CODE_06D07F

CODE_06D06C:
	LDA.w $60A8
	BEQ.b CODE_06D0AD
	CLC
	ADC.w #$0270
	CMP.w #$04E0
	BCS.b CODE_06D07C
	DEY
	DEY
CODE_06D07C:
	LDA.w $60A8
CODE_06D07F:
	BPL.b CODE_06D085
	EOR.w #$FFFF
	INC
CODE_06D085:
	CLC
	ADC.w $7A36
	CMP.w #$0F00
	BMI.b CODE_06D0A9
	SEC
	SBC.w #$0F00
	PHA
	INC.b $16
	LDA.b $16
	CLC
	ADC.w DATA_06D013,y
	CMP.w DATA_06D013+$02,y
	BMI.b CODE_06D0A5
	STZ.b $16
	LDA.w DATA_06D013,y
CODE_06D0A5:
	STA.w $7402
	PLA
CODE_06D0A9:
	STA.w $7A36
	RTS

CODE_06D0AD:
	LDY.b #$0D
	LDA.w $60CE
	BEQ.b CODE_06D0CD
	LDA.w $0DAE
	INC
	INC
	STA.w $0DAE
	BPL.b CODE_06D0C4
	LDA.w #$7FFF
	STA.w $0DAE
CODE_06D0C4:
	CMP.w #$0020
	BCC.b CODE_06D104
	LDY.b #$12
	BRA.b CODE_06D104

CODE_06D0CD:
	LDA.w $0DAE
	LSR
	STA.w $0DAE
	CPX.w $0D96
	BEQ.b CODE_06D104
	LDA.w $60C2
	BEQ.b CODE_06D0FD
CODE_06D0DE:
	LDA.w $0DB0
	INC
	INC
	STA.w $0DB0
	BPL.b CODE_06D0EE
	LDA.w #$7FFF
	STA.w $0DB0
CODE_06D0EE:
	CMP.w #$0020
	BCC.b CODE_06D104
	LDY.b #$13
	CMP.w #$0024
	BMI.b CODE_06D104
	INY
	BRA.b CODE_06D104

CODE_06D0FD:
	LDA.w $0DB0
	LSR
	STA.w $0DB0
CODE_06D104:
	STY.w $7402
CODE_06D107:
	RTS

DATA_06D108:
	dw $0180,$FE80

CODE_06D10C:
	PHA
	PHA
	BRA.b CODE_06D117

CODE_06D110:
	LDX.b $12
	CPX.w $0D96
	BEQ.b CODE_06D107
CODE_06D117:
	PHX
	LDA.w $60C4
	STA.w $7400
	EOR.w #$0002
	TAX
	LDA.l DATA_06D108,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	PLX
	LDA.w $61B2
	AND.w #$7FFF
	STA.w $61B2
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	LDY.b #$00
	STY.w $7862
	STZ.b $16
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	STZ.b $76
	LDA.w #$F629
	STA.w $6FA0
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.w #$0009
	BNE.b CODE_06D185
	LDA.w #$0005
	STA.w $7A96
	LDA.w #$4001
	STA.w $7040
	LDA.w #$6040
	STA.w $6FA2
	STZ.w $0DB4
	LDA.w $0D04
	EOR.w #$FFFF
	INC
	AND.w #$FF00
	STA.w $0DAC
	LDA.w #$5000
	STA.w $0DAA
	LDY.b #$10
	BRA.b CODE_06D191

CODE_06D185:
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0014
	STA.w $0DB2
	LDY.b #$20
CODE_06D191:
	STY.w $7AF8
	LDA.w #$FFFF
	STA.w $7E48
	PLA
	PLA
	RTL

;---------------------------------------------------------------------------

DATA_06D19D:
	dw $0400,$FC00

;-------------------------------------------------------------------------
; Dangling Ghost ($090) -- Init handler.
; Boo Guys that hang from a sewer ceiling on a stretchy filament.
; Init writes the anchor position and rest length.
; Raidenthequick: init_dangling_ghost.
;
; See docs/family-boos.md for the full Boo / ghost family breakdown.
; Bank06 carries 5 of the 10 Boo family sprites ($010 RoundedCagedGhost,
; $057 SewerGhostWithPlatform, $090 DanglingGhost, $0D6 FortGhostWithPlatform,
; $193 SnakeCagedGhost); each has its own Init/Main, no shared init body.
; $090 is the only family member that kidnaps baby Mario (SoundID3D).
;-------------------------------------------------------------------------
YI_NorSpr090_DanglingGhost_Init:
init_dangling_ghost:                       ; Raidenthequick: init_dangling_ghost
;$06D1A1
	LDA.w #$4000
	STA.b $18,x
	LDA.w #$2000
	STA.b $76,x
	LDY.b #$00
	LDA.w $70E2,x
	SEC
	SBC.w $611C
	BMI.b CODE_06D1B8
	LDY.b #$02
CODE_06D1B8:
	LDA.w DATA_06D19D,y
	STA.b $78,x
	STZ.w $7A36,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.w $7AF6,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Dangling Ghost ($090) -- Main handler.
; Per frame: applies pendulum physics to the filament, lunges at Yoshi
; if within range. Raidenthequick: main_dangling_ghost.
;-------------------------------------------------------------------------
YI_NorSpr090_DanglingGhost_Main:
main_dangling_ghost:                       ; Raidenthequick: main_dangling_ghost
;$06D1C7
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $0E
	JSR.w CODE_06D2AC
	JSR.w CODE_06D307
	JSR.w CODE_06D484
	JSR.w CODE_06D4FB
	JSL.l CODE_03AF23
	LDA.w $7680,x
	CLC
	ADC.w #$0090
	CMP.w #$0220
	BCS.b CODE_06D1F4
	LDA.w $7682,x
	CLC
	ADC.w #$00C8
	CMP.w #$019A
	BCC.b CODE_06D218
CODE_06D1F4:
	JSL.l CODE_03A31E
	LDA.b $0E
	BIT.w #$0010
	BEQ.b CODE_06D216
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror
	CMP.w #$000D
	BEQ.b CODE_06D20C
	CMP.w #$000E
	BNE.b CODE_06D216
CODE_06D20C:
	JSL.l CODE_06C0B3
	LDA.w #$0400
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
CODE_06D216:
	BRA.b CODE_06D226

CODE_06D218:
	LDA.w #$0C00
	TRB.b $0E
	JSR.w CODE_06D888
	JSR.w CODE_06D234
	JSR.w CODE_06D537
CODE_06D226:
	LDX.b $12
	LDA.b $0E
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDX.b $12
	RTL

DATA_06D230:
	dw $FFE0,$0000

CODE_06D234:
	LDA.w $61B2
	BMI.b CODE_06D265
	LDA.b $0E
	BIT.w #$0010
	BEQ.b CODE_06D26C
	LDA.w $7400,x
	AND.w #$0002
	TAY
	LDA.l $7049EA
	CLC
	ADC.w DATA_06D230,y
	CLC
	ADC.w $70E2,x
	STA.w $70E2
	LDA.l $7049E8
	CLC
	ADC.w #$0070
	CLC
	ADC.w $7182,x
	STA.w $7182
CODE_06D265:
	LDA.b $0E
	BIT.w #$0010
	BNE.b CODE_06D297
CODE_06D26C:
	LDA.b $0E
	AND.w #$000F
	CMP.w #$0001
	BNE.b CODE_06D2AB
	LDA.b $0E
	BIT.w #$0400
	BEQ.b CODE_06D2AB
	LDA.w $61B2
	BPL.b CODE_06D2AB
	LDA.b $0E
	PHA
	JSL.l CODE_06BEF1
	PLA
	ORA.w #$0010
	STA.b $0E
	LDA.w #!Define_YI_SoundID3D_MarioKidnapped
	JSL.l CODE_push_sound_queue
	RTS

CODE_06D297:
	LDA.w !RAM_YI_Level_StarTimerLo
	BEQ.b CODE_06D2A1
	LDA.w $61B2
	BPL.b CODE_06D2AB
CODE_06D2A1:
	LDA.w #$0800
	TSB.b $0E
	LDA.w #$0410
	TRB.b $0E
CODE_06D2AB:
	RTS

CODE_06D2AC:
	LDA.w #$0011
	ASL
	TAY
CODE_06D2B1:
	TYA
	ASL
	TAX
	LDA.w DATA_06D2E3,y
	AND.w #$00FF
	CMP.w #$0080
	BCC.b CODE_06D2C2
	ORA.w #$FF00
CODE_06D2C2:
	STA.l $7049C6,x
	LDA.w DATA_06D2E3+$01,y
	AND.w #$00FF
	CMP.w #$0080
	BCC.b CODE_06D2D4
	ORA.w #$FF00
CODE_06D2D4:
	SEC
	SBC.w #$0070
	STA.l $7049C8,x
	DEY
	DEY
	BPL.b CODE_06D2B1
	LDX.b $12
	RTS

DATA_06D2E3:
	dw $0000,$0010,$0010,$0708,$0708,$0708,$0708,$0708
	dw $1816,$2E00,$18EA,$07F7,$07F7,$07F7,$07F7,$07F7
	dw $00F0,$00F0

CODE_06D307:
	LDA.b $18,x
	XBA
	ASL
	AND.w #$00FE
	CLC
	ADC.w #$0100
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.b $00
	LDA.b $76,x
	STA.b $02
	ASL
	XBA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LSR
	STA.b $04
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LSR
	STA.b $06
	LDY.b #$04
CODE_06D33A:
	LDX.w DATA_06D47F,y
	LDA.l $7049C6,x
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.l $7049C6,x
	LDA.l $7049C8,x
	CLC
	ADC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.l $7049C8,x
	DEY
	BPL.b CODE_06D33A
	LDX.b $12
	LDA.b $0E
	AND.w #$000F
	CMP.w #$0001
	BEQ.b CODE_06D36A
	CMP.w #$0002
	BEQ.b CODE_06D36A
	RTS

CODE_06D36A:
	LDA.b $04
	CLC
	ADC.l $7049DA
	STA.l $7049DA
	LDA.b $04
	CLC
	ADC.l $7049FA
	STA.l $7049FA
	LDA.b $06
	CLC
	ADC.l $7049DC
	STA.l $7049DC
	LDA.b $06
	CLC
	ADC.l $7049FC
	STA.l $7049FC
	LDA.b $14
	ASL
	ASL
	ASL
	ASL
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $76,x
	XBA
	AND.w #$00FF
	LSR
	LSR
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	CLC
	ADC.b $00
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $02
	LSR
	XBA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.l $7049D6
	STA.l $7049D6
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.l $7049FE
	STA.l $7049FE
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	PHA
	CLC
	ADC.l $7049D8
	STA.l $7049D8
	PLA
	ADC.l $704A00
	STA.l $704A00
	LDA.b $14
	ASL
	ASL
	ASL
	ASL
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $76,x
	XBA
	AND.w #$00FF
	LSR
	LSR
	LSR
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.b $00
	SEC
	SBC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $02
	LSR
	CLC
	ADC.b $02
	XBA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.l $7049DE
	STA.l $7049DE
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.l $7049F6
	STA.l $7049F6
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	PHA
	CLC
	ADC.l $7049E0
	STA.l $7049E0
	PLA
	ADC.l $7049F8
	STA.l $7049F8
	LDX.b $12
	RTS

DATA_06D47F:
	db $1C,$20,$24,$28,$2C

CODE_06D484:
	LDA.w $7680,x
	CLC
	ADC.w #$0090
	CMP.w #$0220
	BCS.b CODE_06D49C
	LDA.w $7682,x
	CLC
	ADC.w #$00C8
	CMP.w #$019A
	BCC.b CODE_06D4AC
CODE_06D49C:
	LDY.b #$11
	STY.w !RAM_YI_Global_MainScreenLayers
	LDY.b #$02
	STY.w !RAM_YI_Global_SubScreenLayers
	LDY.b #$20
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	RTS

CODE_06D4AC:
	LDA.w #$0000
	CLC
	ADC.w $7680,x
	STA.w $6040
	LDA.w #$0070
	CLC
	ADC.w $7682,x
	STA.w $6042
	LDA.w #$0012
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08E64B>>16
	LDA.w #FXCODE_08E64B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	SEP.b #$30
	LDA.b #$13
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.b #$04
	STA.w !RAM_YI_Global_SubScreenLayers
	LDA.b #$22
	STA.w !RAM_YI_Global_ColorMathInitialSettings
	LDA.b #$63
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.b #$18
	TSB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDX.b $12
	RTS

CODE_06D4FB:
	REP.b #$10
	LDA.l $7049EA
	SEC
	SBC.w #$0008
	STA.b $00
	LDA.l $7049E8
	CLC
	ADC.w #$0070
	STA.b $02
	LDY.w $7362,x
	LDX.w #$000C
CODE_06D517:
	LDA.w $6000,y
	CLC
	ADC.b $00
	STA.w $6000,y
	LDA.w $6002,y
	CLC
	ADC.b $02
	STA.w $6002,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEX
	BNE.b CODE_06D517
	SEP.b #$10
	LDX.b $12
	RTS

CODE_06D537:
	LDA.b $0E
	BIT.w #$0800
	BEQ.b CODE_06D564
	LDA.b $0E
	AND.w #$FFE0
	ORA.w #$8022
	STA.b $0E
	LDA.w !RAM_YI_Level_StarTimerLo
	BEQ.b CODE_06D564
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror
	CMP.w #$000D
	BEQ.b CODE_06D55A
	CMP.w #$000E
	BNE.b CODE_06D564
CODE_06D55A:
	JSL.l CODE_06C0B3
	LDA.w #$0400
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
CODE_06D564:
	LDA.b $0E
	AND.w #$000F
	ASL
	TAY
	LDA.w DATA_06D577,y
	STA.b $00
	PER.w CODE_06D576-$01
	JMP.w ($0000+$7960)
CODE_06D576:
	RTS

DATA_06D577:
	dw CODE_06D589
	dw CODE_06D6F3
	dw CODE_06D7B6
	dw CODE_06D842

DATA_06D57F:
	dw $1000,$7000

DATA_06D583:
	dw $0000,$FFFF

DATA_06D587:
	db $00,$02

CODE_06D589:
	LDA.w $7400,x
	AND.w #$FFFD
	STA.w $7400,x
	LDY.b #$01
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w $70E2,x
	BPL.b CODE_06D59F
	LDY.b #$00
CODE_06D59F:
	LDA.w DATA_06D587,y
	AND.w #$00FF
	ORA.w $7400,x
	STA.w $7400,x
	STZ.w $7402,x
	LDA.b $18,x
	SEC
	SBC.w #$4000
	STA.b $00
	LDA.b $78,x
	CLC
	ADC.b $18,x
	STA.b $18,x
	SEC
	SBC.w #$4000
	EOR.b $00
	BPL.b CODE_06D5CC
	LDA.w #!Define_YI_SoundID34_BurtJump
	JSL.l CODE_push_sound_queue
CODE_06D5CC:
	LDY.b #$02
	LDA.b $18,x
	SEC
	SBC.w #$4000
	BPL.b CODE_06D5DB
	LDY.b #$00
	EOR.w #$FFFF
CODE_06D5DB:
	CMP.w #$3000
	BCC.b CODE_06D5E5
	LDA.w DATA_06D57F,y
	STA.b $18,x
CODE_06D5E5:
	LDY.b #$02
	LDA.b $18,x
	SEC
	SBC.w #$4000
	BPL.b CODE_06D5F5
	LDY.b #$00
	EOR.w #$FFFF
	INC
CODE_06D5F5:
	XBA
	AND.w #$00FF
	EOR.w DATA_06D583,y
	CLC
	ADC.b $78,x
	STA.b $78,x
	LDA.w $796E
	BIT.w #$0010
	BEQ.b CODE_06D60C
	JMP.w CODE_06D6E2

CODE_06D60C:
	LDA.w $611C
	SEC
	SBC.w $70E2,x
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCC.b CODE_06D621
CODE_06D61C:
	RTS

DATA_06D61D:
	dw $0042,$0062

CODE_06D621:
	LDA.w $61D6
	BNE.b CODE_06D61C
	LDA.w $7AF6,x
	BNE.b CODE_06D61C
	LDA.w $7A36,x
	CMP.w #$0003
	BCC.b CODE_06D63E
	LDA.w #$0050
	STA.w $7AF6,x
	STZ.w $7A36,x
	BRA.b CODE_06D61C

CODE_06D63E:
	LDY.b #$00
	LDA.w $70E2,x
	BIT.w #$0010
	BEQ.b CODE_06D64A
	LDY.b #$02
CODE_06D64A:
	LDA.b $76,x
	XBA
	AND.w #$00FF
	ASL
	STA.b $00
	LDA.w $70E2,x
	SEC
	SBC.w $611C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $611E
	SEC
	SBC.w $7182,x
	SEC
	SBC.w #$0018
	SEC
	SBC.b $00
	CMP.w #$0010
	BMI.b CODE_06D6E2
	CLC
	ADC.b $00
	CMP.w #$00C0
	BPL.b CODE_06D6E2
	CMP.w DATA_06D61D,y
	BMI.b CODE_06D680
	LDA.w DATA_06D61D,y
CODE_06D680:
	STA.b $00
	EOR.w #$FFFF
	INC
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEC
	SBC.w #$0080
	AND.w #$00FF
	XBA
	STA.w $7A38,x
	REP.b #$10
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	ASL
	TAX
	LDA.l DATA_sine_lut_8bit_radians,x
	ASL
	TAX
	LDA.l $702200,x
	STA.b $02
	SEP.b #$30
	LDX.b $02
	STX.w !REGISTER_Mode7MatrixParameterA
	LDX.b $03
	STX.w !REGISTER_Mode7MatrixParameterA
	LDA.b $00
	LSR
	STA.w !REGISTER_Mode7MatrixParameterB
	REP.b #$20
	LDX.b $12
	LDA.w !REGISTER_PPUMultiplicationProductMid
	AND.w #$00FF
	XBA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.b $0E
	AND.w #$FFF0
	ORA.w #$8001
	STA.b $0E
	INC.w $7A36,x
CODE_06D6E2:
	RTS

DATA_06D6E3:
	db $07,$06,$05,$04,$03,$02,$01,$00

DATA_06D6EB:
	db $40,$04,$03,$02,$02,$02,$01,$01

CODE_06D6F3:
	LDA.b $0E
	BPL.b CODE_06D704
	AND.w #$7FFF
	STA.b $0E
	LDA.w #$0006
	STA.b $16,x
	STZ.w $7A96,x
CODE_06D704:
	LDA.w $7A96,x
	BNE.b CODE_06D723
	LDA.b $16,x
	BEQ.b CODE_06D723
	DEC
	STA.b $16,x
	TAY
	LDA.w DATA_06D6E3,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_06D6EB,y
	AND.w #$00FF
	STA.w $7A96,x
CODE_06D723:
	LDA.b $0E
	BIT.w #$0010
	BNE.b CODE_06D73F
	LDA.w $611C
	SEC
	SBC.w $70E2,x
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCC.b CODE_06D74E
	STZ.b $78,x
	STZ.w $7A36,x
CODE_06D73F:
	LDA.b $0E
	AND.w #$FFF0
	ORA.w #$8002
	STA.b $0E
	RTS

DATA_06D74A:
	dw $FE00,$0200

CODE_06D74E:
	LDY.b #$00
	LDA.w $7A38,x
	SEC
	SBC.b $18,x
	STA.b $00
	BEQ.b CODE_06D76F
	BMI.b CODE_06D75E
	LDY.b #$02
CODE_06D75E:
	LDA.w DATA_06D74A,y
	CLC
	ADC.b $18,x
	PHA
	SEC
	SBC.w $7A38,x
	EOR.b $00
	ASL
	PLA
	BCS.b CODE_06D772
CODE_06D76F:
	LDA.w $7A38,x
CODE_06D772:
	STA.b $18,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.b $76,x
	BMI.b CODE_06D790
	ASL
	XBA
	AND.w #$00FF
	ASL
	ASL
	ASL
	CLC
	ADC.w #$0010
	CLC
	ADC.b $76,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BCC.b CODE_06D79D
CODE_06D790:
	LDA.b $0E
	AND.w #$FFF0
	ORA.w #$8002
	STA.b $0E
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_06D79D:
	STA.b $76,x
	LDX.b $12
	RTS

DATA_06D7A2:
	dw $1800,$1800

DATA_06D7A6:
	dw $0000,$8003

DATA_06D7AA:
	db $0E,$0D,$0C,$05,$06,$07

DATA_06D7B0:
	db $01,$01,$01,$01,$01,$01

CODE_06D7B6:
	LDA.b $0E
	BPL.b CODE_06D7C7
	AND.w #$7FFF
	STA.b $0E
	LDA.w #$0006
	STA.b $16,x
	STZ.w $7A96,x
CODE_06D7C7:
	LDA.w $7A96,x
	BNE.b CODE_06D7E6
	LDA.b $16,x
	BEQ.b CODE_06D7E6
	DEC
	STA.b $16,x
	TAY
	LDA.w DATA_06D7AA,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_06D7B0,y
	AND.w #$00FF
	STA.w $7A96,x
CODE_06D7E6:
	LDY.b #$00
	LDA.b $0E
	BIT.w #$0020
	BEQ.b CODE_06D7F1
	LDY.b #$02
CODE_06D7F1:
	LDA.b $76,x
	SEC
	SBC.w #$0400
	CMP.w DATA_06D7A2,y
	BCS.b CODE_06D835
	LDA.b $18,x
	SEC
	SBC.w #$4000
	XBA
	AND.w #$00FF
	EOR.w #$FFFF
	INC
	CLC
	ADC.w #$0400
	STA.b $78,x
	PHY
	LDY.b #$00
	LDA.b $0E
	BIT.w #$0020
	BEQ.b CODE_06D822
	LDA.w #$0100
	STA.w $7A98,x
	LDY.b #$02
CODE_06D822:
	LDA.b $0E
	AND.w #$FFD0
	ORA.w DATA_06D7A6,y
	STA.b $0E
	PLY
	ORA.w #$0000
	BMI.b CODE_06D842
	LDA.w DATA_06D7A2,y
CODE_06D835:
	STA.b $76,x
	LDX.b $12
	RTS

DATA_06D83A:
	db $10,$11,$10,$0F

DATA_06D83E:
	db $02,$20,$02,$10

CODE_06D842:
	LDA.b $0E
	BPL.b CODE_06D859
	AND.w #$7FFF
	STA.b $0E
	LDA.w #$0004
	STA.b $16,x
	STZ.w $7A96,x
	LDA.w #$0100
	STA.w $7A98,x
CODE_06D859:
	LDA.w $7A96,x
	BNE.b CODE_06D887
	DEC.b $16,x
	BPL.b CODE_06D867
	LDA.w #$0003
	STA.b $16,x
CODE_06D867:
	LDY.b $16,x
	LDA.w DATA_06D83A,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_06D83E,y
	AND.w #$00FF
	STA.w $7A96,x
	LDA.w $7A98,x
	BNE.b CODE_06D887
	LDA.b $0E
	AND.w #$FFF0
	STA.b $0E
CODE_06D887:
	RTS

CODE_06D888:
	LDA.w $7680,x
	CLC
	ADC.w #$0050
	CMP.w #$01A0
	BCS.b CODE_06D90F
	TXA
	STA.w $6012
	LDA.w $60B0
	STA.w $6014
	LDA.w $60B2
	STA.w $6016
	LDA.w $60C2
	STA.w $6018
	LDX.b #FXCODE_0A8390>>16
	LDA.w #FXCODE_0A8390
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $601A
	BEQ.b CODE_06D8F4
	LDX.b $12
	LDY.b #$00
	LDA.w $70E2,x
	CMP.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BMI.b CODE_06D8C6
	LDY.b #$02
CODE_06D8C6:
	LDA.w DATA_06D912,y
	CLC
	ADC.w $60B4
	PHA
	SEC
	SBC.w DATA_06D916,y
	EOR.w DATA_06D912,y
	ASL
	PLA
	BCS.b CODE_06D8DC
	LDA.w DATA_06D916,y
CODE_06D8DC:
	STA.w $60B4
	LDA.b $0E
	LDA.b $0E
	PHA
	LDX.b $12
	JSL.l CODE_03A858
	PLA
	STA.b $0E
	LDA.w #$0400
	TSB.b $0E
	LDX.b $12
CODE_06D8F4:
	LDX.b $12
	LDY.w $7D36,x
	DEY
	BMI.b CODE_06D90F
	LDA.w $7D38,y
	BEQ.b CODE_06D90F
	LDA.b $0E
	PHA
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	PLA
	ORA.w #$0800
	STA.b $0E
CODE_06D90F:
	LDX.b $12
	RTS

DATA_06D912:
	dw $0100,$FF00

DATA_06D916:
	dw $0200,$FE00

;---------------------------------------------------------------------------

CODE_06D91A:
	TXA
	STA.w $6012
	LDA.w $60B0
	STA.w $6014
	LDA.w $60B2
	STA.w $6016
	LDA.w $60C2
	STA.w $6018
	LDX.b #FXCODE_0A8390>>16
	LDA.w #FXCODE_0A8390
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $601A
	BEQ.b CODE_06D976
	LDX.b $12
	LDY.b #$00
	LDA.w $70E2,x
	CMP.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BMI.b CODE_06D94C
	LDY.b #$02
CODE_06D94C:
	LDA.w DATA_06D912,y
	CLC
	ADC.w $60B4
	PHA
	SEC
	SBC.w DATA_06D916,y
	EOR.w DATA_06D912,y
	ASL
	PLA
	BCS.b CODE_06D962
	LDA.w DATA_06D916,y
CODE_06D962:
	STA.w $60B4
	LDA.b $0E
	PHA
	LDX.b $12
	JSL.l CODE_03A858
	PLA
	ORA.w #$0400
	STA.b $0E
	LDX.b $12
CODE_06D976:
	LDA.w $6014
	BEQ.b CODE_06D9A2
	LDX.b $12
	LDY.b #$00
	LDA.w $70E2,x
	CMP.w $70E2
	BMI.b CODE_06D989
	LDY.b #$02
CODE_06D989:
	LDA.w DATA_06D912,y
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	PHA
	SEC
	SBC.w DATA_06D916,y
	EOR.w DATA_06D912,y
	ASL
	PLA
	BCS.b CODE_06D99F
	LDA.w DATA_06D916,y
CODE_06D99F:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
CODE_06D9A2:
	LDX.b $12
	LDY.w $7D36,x
	DEY
	BMI.b CODE_06D9BD
	LDA.w $7D38,y
	BEQ.b CODE_06D9BD
	LDA.b $0E
	PHA
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	PLA
	ORA.w #$0800
	STA.b $0E
CODE_06D9BD:
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Snake-block Caged Ghost ($193) -- Init handler.
; A Boo trapped inside the cage attached to a snake-block train. Init
; is small (sub-sprite already exists when this fires).
;-------------------------------------------------------------------------
YI_NorSpr193_SnakeCagedGhost_Init:
init_caged_ghost_snake:
;$06D9C0
	LDA.w #$0000
	STA.w $6040
	LDA.w #$0000
	STA.w $6042
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Snake-block Caged Ghost ($193) -- Main handler.
; Tracks the snake-block parent's position and feeds the Boo's idle
; bobbing while caged. Free-on-egg-hit elsewhere in the engine.
;-------------------------------------------------------------------------
YI_NorSpr193_SnakeCagedGhost_Main:
main_caged_ghost_snake:
;$06D9CD
	JSR.w CODE_06DA01
	JSR.w CODE_06DBA5
	JSR.w CODE_06DC4D
	JSL.l CODE_03AF23
	LDA.w $7680,x
	CLC
	ADC.w #$0200
	CMP.w #$0400
	BCS.b CODE_06D9F2
	LDA.w $7682,x
	CLC
	ADC.w #$01A0
	CMP.w #$0300
	BCC.b CODE_06D9F8
CODE_06D9F2:
	JSL.l CODE_03A31E
	BRA.b CODE_06D9FE

CODE_06D9F8:
	JSR.w CODE_06DC84
	JSR.w CODE_06DD53
CODE_06D9FE:
	LDX.b $12
	RTL

CODE_06DA01:
	LDA.b $18,x
	XBA
	AND.w #$00FF
	ASL
	TAX
	LDA.w DATA_06DA55,x
	STA.b $00
	LDA.w DATA_06DA55+$02,x
	STA.b $02
	LDY.b #$34
CODE_06DA15:
	TYA
	ASL
	TAX
	LDA.b ($00),y
	AND.w #$00FF
	SEC
	SBC.w #$00E0
	STA.l $7049F6,x
	LDA.b ($02),y
	AND.w #$00FF
	SEC
	SBC.w #$00E0
	STA.l $704B36,x
	LDA.b ($00),y
	AND.w #$FF00
	XBA
	SEC
	SBC.w #$0050
	STA.l $7049F8,x
	LDA.b ($02),y
	AND.w #$FF00
	XBA
	SEC
	SBC.w #$0050
	STA.l $704B38,x
	DEY
	DEY
	BPL.b CODE_06DA15
	LDX.b $12
	RTS

DATA_06DA55:
	dw DATA_06DA61,DATA_06DA97
	dw DATA_06DACD,DATA_06DB03
	dw DATA_06DB39,DATA_06DB6F

DATA_06DA61:
	db $E0,$50,$E0,$5F,$80,$5F,$72,$5F,$6E,$5D,$52,$41,$4E,$3F,$10,$2F
	db $10,$3F,$08,$3D,$02,$38,$01,$33,$01,$2C,$02,$27,$08,$22,$10,$20
	db $50,$20,$5E,$20,$62,$22,$7E,$3E,$82,$40,$E0,$43,$EF,$47,$F7,$4C
	db $FF,$56,$FF,$5B,$FC,$5F

DATA_06DA97:
	db $E0,$50,$E0,$5F,$80,$5F,$72,$5F,$6E,$5D,$52,$41,$50,$3F,$4F,$2F
	db $4F,$3F,$48,$3D,$42,$38,$41,$33,$41,$2C,$42,$27,$48,$22,$50,$20
	db $50,$20,$5E,$20,$62,$22,$7E,$3E,$82,$40,$E0,$43,$EF,$47,$F7,$4C
	db $FF,$56,$FF,$5B,$FC,$5F

DATA_06DACD:
	db $E0,$50,$E0,$5F,$80,$5F,$72,$5F,$6E,$5D,$50,$3E,$50,$3E,$5B,$34
	db $4F,$3E,$4C,$39,$4B,$30,$4D,$2B,$53,$25,$5D,$23,$62,$24,$68,$28
	db $68,$28,$68,$28,$68,$28,$68,$28,$82,$40,$E0,$43,$EF,$47,$F7,$4C
	db $FF,$56,$FF,$5B,$FC,$5F

DATA_06DB03:
	db $E0,$50,$E0,$5F,$80,$5F,$80,$5F,$69,$58,$69,$58,$69,$58,$73,$4C
	db $68,$58,$64,$51,$63,$48,$65,$43,$6B,$3D,$75,$3B,$7A,$3C,$7F,$40
	db $7F,$40,$7F,$40,$7F,$40,$7F,$40,$82,$40,$E0,$43,$EF,$47,$F7,$4C
	db $FF,$56,$FF,$5B,$FC,$5F

DATA_06DB39:
	db $E0,$50,$E0,$5F,$80,$5F,$80,$5F,$80,$5F,$80,$5F,$80,$5F,$7F,$4F
	db $7F,$5F,$78,$5D,$72,$58,$71,$53,$71,$4C,$72,$47,$78,$42,$80,$40
	db $80,$40,$80,$40,$80,$40,$80,$40,$80,$40,$E0,$43,$EF,$47,$F7,$4C
	db $FF,$56,$FF,$5B,$FC,$5F

DATA_06DB6F:
	db $E0,$50,$E0,$60,$E0,$60,$E0,$60,$E0,$60,$E0,$60,$E0,$60,$E0,$51
	db $DF,$60,$D8,$5E,$D2,$59,$D1,$54,$D1,$4D,$D2,$48,$D8,$43,$E0,$41
	db $E0,$41,$E0,$41,$E0,$41,$E0,$41,$E0,$41,$E0,$41,$EF,$48,$F7,$4D
	db $FF,$57,$FF,$5C,$FC,$60

CODE_06DBA5:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $0E
	LDA.w $7680,x
	CMP.w #$0100
	BCC.b CODE_06DBBA
	CMP.w #$FF00
	BCS.b CODE_06DBBA
	JMP.w CODE_06DC37

CODE_06DBBA:
	CLC
	ADC.w #$00E0
	STA.w $6040
CODE_06DBC1:
	LDA.w $7682,x
	CMP.w #$0200
	BCC.b CODE_06DBCE
	CMP.w #$FF00
	BCC.b CODE_06DC37
CODE_06DBCE:
	CLC
	ADC.w #$0020
	STA.w $6042
	LDA.w #$49F6
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$4B36
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$001B
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STZ.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$449E
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $18,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0000
	STA.w $605E
	LDX.b #FXCODE_08E8CA>>16
	LDA.w #FXCODE_08E8CA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	SEP.b #$30
	LDA.b #$13
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.b #$04
	STA.w !RAM_YI_Global_SubScreenLayers
	LDA.b #$22
	STA.w !RAM_YI_Global_ColorMathInitialSettings
	LDA.b #$63
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.b #$18
	TSB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDA.w #$0008
	TSB.b $0E
	BRA.b CODE_06DC45

CODE_06DC37:
	SEP.b #$20
	LDA.b #$04
	TRB.w !RAM_YI_Global_SubScreenLayers
	REP.b #$20
	LDA.w #$0008
	TRB.b $0E
CODE_06DC45:
	LDX.b $12
	LDA.b $0E
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTS

CODE_06DC4D:
	STZ.w $7400,x
	REP.b #$10
	LDY.w $7362,x
	LDX.w #$000C
CODE_06DC58:
	LDA.w $6000,y
	CLC
	ADC.l $7044BA
	CLC
	ADC.w #$00DE
	STA.w $6000,y
	LDA.w $6002,y
	CLC
	ADC.l $7044BC
	CLC
	ADC.w #$0018
	STA.w $6002,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEX
	BNE.b CODE_06DC58
	SEP.b #$10
	LDX.b $12
	RTS

CODE_06DC84:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BIT.w #$0008
	BNE.b CODE_06DC8F
	JMP.w CODE_06DD48

CODE_06DC8F:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$F7FF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TXA
	STA.w $6012
	LDA.w $60B0
	STA.w $6014
	LDA.w $60B2
	STA.w $6016
	LDA.w $60C2
	STA.w $6018
	LDX.b #FXCODE_0A8390>>16
	LDA.w #FXCODE_0A8390
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $601A
	BEQ.b CODE_06DCF4
	LDY.b #$00
	LDA.w $70E2,x
	CLC
	ADC.w #$00E0
	ASL
	CLC
	ADC.l $7044BA
	LSR
	CMP.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BMI.b CODE_06DCD5
	LDY.b #$02
CODE_06DCD5:
	LDA.w DATA_06DD4B,y
	CLC
	ADC.w $60B4
	PHA
	SEC
	SBC.w DATA_06DD4F,y
	EOR.w DATA_06DD4B,y
	ASL
	PLA
	BCS.b CODE_06DCEB
	LDA.w DATA_06DD4F,y
CODE_06DCEB:
	STA.w $60B4
	LDX.b $12
	JSL.l CODE_03A858
CODE_06DCF4:
	LDA.w $6014
	BEQ.b CODE_06DD2B
	LDX.b $12
	LDY.b #$00
	LDA.w $70E2,x
	CLC
	ADC.w #$00E0
	ASL
	CLC
	ADC.l $7044BA
	LSR
	CMP.w $70E2
	BMI.b CODE_06DD12
	LDY.b #$02
CODE_06DD12:
	LDA.w DATA_06DD4B,y
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	PHA
	SEC
	SBC.w DATA_06DD4F,y
	EOR.w DATA_06DD4B,y
	ASL
	PLA
	BCS.b CODE_06DD28
	LDA.w DATA_06DD4F,y
CODE_06DD28:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
CODE_06DD2B:
	LDX.b $12
	LDY.w $7D36,x
	DEY
	BMI.b CODE_06DD48
	LDA.w $7D38,y
	BEQ.b CODE_06DD48
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	ORA.w #$0800
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_06DD48:
	LDX.b $12
	RTS

DATA_06DD4B:
	dw $0100,$FF00

DATA_06DD4F:
	dw $0200,$FE00

CODE_06DD53:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $0E
	BIT.w #$0800
	BEQ.b CODE_06DD74
	LDA.w #$0010
	STA.w $7A96,x
	LDA.b $0E
	AND.w #$FFF8
	ORA.w #$0401
	STA.b $0E
	LDA.w #!Define_YI_SoundID79_HurtGhost
	JSL.l CODE_push_sound_queue
CODE_06DD74:
	AND.w #$0007
	ASL
	TAY
	LDA.w DATA_06DD98,y
	STA.b $00
	PER.w CODE_06DD84-$01
	JMP.w ($0000+$7960)
CODE_06DD84:
	LDA.b $0E
	AND.w #$7FFF
	BIT.w #$4000
	BEQ.b CODE_06DD94
	AND.w #$BFFF
	ORA.w #$8000
CODE_06DD94:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTS

DATA_06DD98:
	dw CODE_06DDA2
	dw CODE_06DE59
	dw CODE_06DE9F
	dw CODE_06DF02
	dw CODE_06DFB2

CODE_06DDA2:
	LDA.w $7AF8,x
	BEQ.b CODE_06DDA8
	RTS

CODE_06DDA8:
	LDA.b $18,x
	BEQ.b CODE_06DDCE
	JSL.l CODE_random_number_gen
	LDA.b $10
	BIT.w #$001F
	BNE.b CODE_06DDCE
	AND.w #$0001
	CLC
	ADC.w #$001C
	STA.w $7A96,x
	LDA.b $0E
	AND.w #$FFF8
	ORA.w #$0002
	STA.b $0E
	JMP.w CODE_06DE9F

CODE_06DDCE:
	LDA.w $7A98,x
	BNE.b CODE_06DE29
	LDA.w #$00F3
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	INC
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0991DB>>16
	LDA.w #FXCODE_0991DB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0003
	BCS.b CODE_06DE29
	STA.b $00
	LDX.b #FXCODE_0991D5>>16
	LDA.w #FXCODE_0991D5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CLC
	ADC.b $00
	CMP.w #$0006
	BCS.b CODE_06DE2B
	PHA
	LDA.b $0E
	AND.w #$FFF8
	ORA.w #$8003
	STA.b $0E
	PLA
	LDY.b #$00
	CMP.w #$0005
	BCC.b CODE_06DE1D
	LDY.b #$02
CODE_06DE1D:
	LDA.w DATA_06DE25,y
	STA.b $78,x
	JMP.w CODE_06DF02

DATA_06DE25:
	db $02,$00,$01,$00

CODE_06DE29:
	LDX.b $12
CODE_06DE2B:
	LDA.b $0E
	BPL.b CODE_06DE34
	STZ.b $76,x
	STZ.w $7A96,x
CODE_06DE34:
	LDA.w $7A96,x
	BNE.b CODE_06DE53
	LDA.b $76,x
	BNE.b CODE_06DE42
	LDA.w #$0006
	STA.b $76,x
CODE_06DE42:
	TAY
	LDA.w DATA_06DFF3,y
	STA.w $7402,x
	LDA.w DATA_06DFFB,y
	STA.w $7A96,x
	DEC.b $76,x
	DEC.b $76,x
CODE_06DE53:
	RTS

DATA_06DE54:
	db $0C,$30,$18,$30,$0C

CODE_06DE59:
	LDA.w #$000E
	STA.w $7402,x
	LDA.w $7A96,x
	BNE.b CODE_06DE7A
	LDA.w #$0407
	TRB.b $0E
	LDA.w #$0020
	STA.w $7AF8,x
	LDA.w #$0180
	STA.w $7A98,x
	STZ.w $7A96,x
	STZ.b $76,x
CODE_06DE7A:
	LDA.b $18,x
	XBA
	AND.w #$00FF
	TAY
	LDA.w DATA_06DE54,y
	AND.w #$00FF
	CLC
	ADC.b $18,x
	CMP.w #$0500
	BCC.b CODE_06DE9C
	LDA.b $0E
	AND.w #$FFF8
	ORA.w #$4004
	STA.b $0E
	LDA.w #$04FF
CODE_06DE9C:
	STA.b $18,x
	RTS

CODE_06DE9F:
	LDA.w $7A96,x
	BNE.b CODE_06DEAE
	LDA.b $0E
	AND.w #$FFF8
	ORA.w #$4000
	STA.b $0E
CODE_06DEAE:
	LDA.w #$0005
	STA.w $7402,x
	LDA.w #$00C0
	STA.w $0051
	LDA.b $18,x
	XBA
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_06DEDA,y
	CLC
	ADC.b $18,x
	BPL.b CODE_06DED7
	LDA.b $0E
	AND.w #$FFF8
	ORA.w #$4000
	STA.b $0E
	LDA.w #$0000
CODE_06DED7:
	STA.b $18,x
	RTS

DATA_06DEDA:
	dw $FFFE,$FFF8,$FFFC,$FFF8,$FFFE

DATA_06DEE4:
	db $07,$06,$05,$04,$03,$02,$0A,$0B,$0A,$01,$02,$03,$04,$05,$06

DATA_06DEF3:
	db $01,$01,$01,$01,$01,$01,$02,$0A,$02,$01,$01,$01,$01,$01,$01

CODE_06DF02:
	LDA.b $0E
	BPL.b CODE_06DF0B
	STZ.b $76,x
	STZ.w $7A96,x
CODE_06DF0B:
	LDA.w $7A96,x
	BEQ.b CODE_06DF13
	JMP.w CODE_06DFB1

CODE_06DF13:
	LDY.b $76,x
	CPY.b #$0F
	BCC.b CODE_06DF37
	DEC.b $78,x
	BEQ.b CODE_06DF25
	LDA.w #$4000
	TSB.b $0E
	JMP.w CODE_06DFB1

CODE_06DF25:
	LDA.w #$0060
	STA.w $7A98,x
	LDA.b $0E
	AND.w #$BFF8
	ORA.w #$4000
	STA.b $0E
	BRA.b CODE_06DFB1

CODE_06DF37:
	LDA.w DATA_06DEF3,y
	AND.w #$00FF
	STA.w $7A96,x
	CPY.b #$0E
	BNE.b CODE_06DF55
	LDA.b $78,x
	CMP.w #$0001
	BEQ.b CODE_06DF55
	LDA.w $7A96,x
	CLC
	ADC.w #$0040
	STA.w $7A96,x
CODE_06DF55:
	LDA.w DATA_06DEE4,y
	AND.w #$00FF
	STA.w $7402,x
	CPY.b #$07
	BNE.b CODE_06DFAF
	LDA.w #!Define_YI_SoundID77_EnemyJumpingOutOfPipe
	JSL.l CODE_push_sound_queue
	LDA.w #$00F3
	JSL.l CODE_spawn_sprite_init
	LDA.w $70E2,x
	CLC
	ADC.l $7044BA
	CLC
	ADC.w #$00CC
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.l $7044BC
	CLC
	ADC.w #$001E
	STA.w $7182,y
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FD80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	SEP.b #$20
	LDA.b #$01
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LDX.b #$04
	STX.b $76,y
	REP.b #$20
	LDA.w #$0000
	STA.w $7400,y
	LDX.b $12
CODE_06DFAF:
	INC.b $76,x
CODE_06DFB1:
	RTS

CODE_06DFB2:
	LDA.b $0E
	BPL.b CODE_06DFBB
	STZ.w $7A96,x
	STZ.b $76,x
CODE_06DFBB:
	LDA.w $7A96,x
	BNE.b CODE_06DFF2
	LDA.b $76,x
	BNE.b CODE_06DFC9
	LDA.w #$0012
	STA.b $76,x
CODE_06DFC9:
	TAY
	LDA.w DATA_06E017,y
	STA.w $7A96,x
	LDA.w DATA_06E003,y
	STA.w $7402,x
	DEC.b $76,x
	DEC.b $76,x
	BNE.b CODE_06DFF2
	LDA.b $0E
	AND.w #$FFF8
	ORA.w #$4000
	STA.b $0E
	LDA.w #$0100
	STA.w $7AF8,x
	LDA.w #$0180
	STA.w $7A98,x
CODE_06DFF2:
	RTS

DATA_06DFF3:
	dw $0008,$0009,$0008,$0007

DATA_06DFFB:
	dw $0004,$0008,$0004,$000A

DATA_06E003:
	dw $000F,$0010,$0011,$0010,$000F,$000F,$0010,$0011
	dw $0010,$000F

DATA_06E017:
	dw $000A,$0002,$0014,$0002,$000A,$000A,$0002,$0014
	dw $0002,$000A

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Rounded Caged Ghost ($010) -- Init handler.
; The round-cage Boo variant (visually distinct from the snake-cage
; one above). Raidenthequick: init_caged_ghost_round.
;-------------------------------------------------------------------------
YI_NorSpr010_RoundedCagedGhost_Init:
init_caged_ghost_round:                    ; Raidenthequick: init_caged_ghost_round
;$06E02B
	LDA.w #$0020
	STA.b $18,x
	LDA.w #$0118
	STA.b $76,x
	LDA.w #$0003
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0008
	STA.w $7A96,x
	LDA.w #$0008
	STA.b $16,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Rounded Caged Ghost ($010) -- Main handler.
; Raidenthequick: main_caged_ghost_round.
;-------------------------------------------------------------------------
YI_NorSpr010_RoundedCagedGhost_Main:
main_caged_ghost_round:                    ; Raidenthequick: main_caged_ghost_round
;$06E047
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $0E
	LDA.w #$0000
	STA.b $0C
	JSR.w CODE_06E42F
	JSR.w CODE_06E48B
	JSR.w CODE_06E0A5
	LDA.b $0E
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSL.l CODE_03AF23
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $0E
	LDA.w $7680,x
	CLC
	ADC.w #$0090
	CMP.w #$0220
	BCS.b CODE_06E080
	LDA.w $7682,x
	CLC
	ADC.w #$0100
	CMP.w #$0300
	BCC.b CODE_06E086
CODE_06E080:
	JSL.l CODE_03A31E
	BRA.b CODE_06E093

CODE_06E086:
	LDA.b $0E
	BIT.w #$0400
	BEQ.b CODE_06E090
	JSR.w CODE_06D91A
CODE_06E090:
	JSR.w CODE_06E123
CODE_06E093:
	LDX.b $12
	LDA.b $0E
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

DATA_06E09B:
	dw $0078,$0000,$0078,$0028,$0078

CODE_06E0A5:
	LDA.w $7402,x
	CMP.w #$0015
	BCS.b CODE_06E102
	LDA.b $0E
	AND.w #$000F
	ASL
	TAY
	LDA.b $18,x
	CMP.w DATA_06E09B,y
	BCC.b CODE_06E102
	CPY.b #$02
	BNE.b CODE_06E0C6
	LDA.b $0E
	BIT.w #$0200
	BEQ.b CODE_06E102
CODE_06E0C6:
	REP.b #$10
	LDA.w #$FFF8
	STA.b $00
	LDA.l $7044C8
	CLC
	ADC.w #$0010
	STA.b $02
	LDY.w $7362,x
	LDX.w #$000C
CODE_06E0DD:
	LDA.w $6000,y
	CLC
	ADC.b $00
	STA.w $6000,y
	LDA.w $6002,y
	CLC
	ADC.b $02
	STA.w $6002,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEX
	BNE.b CODE_06E0DD
	SEP.b #$10
	LDA.w #$0200
	TSB.b $0E
	LDX.b $12
	RTS

CODE_06E102:
	REP.b #$10
	LDY.w $7362,x
	LDX.w #$000C
CODE_06E10A:
	LDA.w #$00E8
	STA.w $6002,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEX
	BNE.b CODE_06E10A
	SEP.b #$10
	LDA.w #$0200
	TRB.b $0E
	LDX.b $12
	RTS

CODE_06E123:
	JSR.w CODE_06E147
	LDA.b $0E
	AND.w #$000F
	ASL
	TAY
	LDA.w DATA_caged_ghost_round_state_ptr,y
	STA.b $00
	PER.w CODE_06E138-$01
	JMP.w ($0000+$7960)
CODE_06E138:
	LDX.b $12
	RTS

DATA_06E13B:
DATA_caged_ghost_round_state_ptr:               ; 5-entry state pointer table for round caged ghost
	dw CODE_06E195
	dw CODE_06E225
	dw CODE_06E258
	dw CODE_06E274
	dw CODE_06E2A2

DATA_06E145:
	db $00,$02

CODE_06E147:
	LDY.b #$01
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w $70E2,x
	BPL.b CODE_06E154
	LDY.b #$00
CODE_06E154:
	LDA.w DATA_06E145,y
	AND.w #$00FF
	STA.w $7400,x
	LDA.b $0E
	BIT.w #$0800
	BEQ.b CODE_06E194
	LDA.w #!Define_YI_SoundID79_HurtGhost
	JSL.l CODE_push_sound_queue
	LDA.b $0E
	AND.w #$000F
	CMP.w #$0001
	BEQ.b CODE_06E194
	LDA.b $18,x
	SEC
	SBC.w #$0020
	CMP.w #$0030
	BCS.b CODE_06E183
	LDA.w #$0030
CODE_06E183:
	STA.b $76,x
	LDA.w #$0008
	STA.b $78,x
	LDA.b $0E
	AND.w #$F7F0
	ORA.w #$8001
	STA.b $0E
CODE_06E194:
	RTS

CODE_06E195:
	LDA.b $18,x
	CMP.w #$0118
	BCS.b CODE_06E1CD
	LDA.w $7A96,x
	BEQ.b CODE_06E1A2
	RTS

CODE_06E1A2:
	JSL.l CODE_random_number_gen
	LDA.b $10
	BIT.w #$F800
	BNE.b CODE_06E1CD
	AND.w #$0003
	ASL
	ASL
	CLC
	ADC.w #$0004
	CLC
	ADC.b $18,x
	CMP.w #$0118
	BCC.b CODE_06E1C1
	LDA.w #$0118
CODE_06E1C1:
	STA.b $76,x
	LDA.b $0E
	AND.w #$FFF0
	ORA.w #$8002
	STA.b $0E
CODE_06E1CD:
	LDA.w $7AF8,x
	BNE.b CODE_06E21F
	LDA.b $18,x
	CMP.w #$0078
	BCC.b CODE_06E21F
	LDA.w #$001E
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	INC
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0991DB>>16
	LDA.w #FXCODE_0991DB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0003
	BCS.b CODE_06E21F
	STA.b $00
	LDX.b #FXCODE_0991D5>>16
	LDA.w #FXCODE_0991D5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CLC
	ADC.b $00
	CMP.w #$0006
	BCS.b CODE_06E21F
	JSL.l CODE_random_number_gen
	LDA.b $10
	BIT.w #$0007
	BNE.b CODE_06E21F
	LDA.b $0E
	AND.w #$FFF0
	ORA.w #$8004
	STA.b $0E
CODE_06E21F:
	LDX.b $12
	JSR.w CODE_06E321
	RTS

CODE_06E225:
	JSR.w CODE_06E321
	LDA.b $78,x
	SEC
	SBC.w #$0001
	STA.b $78,x
	LDA.b $18,x
	CLC
	ADC.b $78,x
	CMP.b $76,x
	BCS.b CODE_06E255
	CMP.w #$0030
	BCS.b CODE_06E243
	LDA.w #$0180
	BRA.b CODE_06E246

CODE_06E243:
	LDA.w #$0080
CODE_06E246:
	STA.w $7A96,x
	LDA.b $0E
	AND.w #$FFF0
	ORA.w #$8000
	STA.b $0E
	LDA.b $76,x
CODE_06E255:
	STA.b $18,x
	RTS

CODE_06E258:
	JSR.w CODE_06E321
	LDA.b $18,x
	CLC
	ADC.w #$0002
	CMP.b $76,x
	BCC.b CODE_06E271
	LDA.b $0E
	AND.w #$FFF0
	ORA.w #$8000
	STA.b $0E
	LDA.b $76,x
CODE_06E271:
	STA.b $18,x
	RTS

CODE_06E274:
	LDA.w $7A96,x
	BNE.b CODE_06E299
	JSR.w CODE_06E321
	LDA.b $76,x
	SEC
	SBC.b $18,x
	BCC.b CODE_06E28B
	LSR
	LSR
	BEQ.b CODE_06E28B
	ADC.b $18,x
	BRA.b CODE_06E297

CODE_06E28B:
	LDA.b $0E
	AND.w #$FFF0
	ORA.w #$8000
	STA.b $0E
	LDA.b $76,x
CODE_06E297:
	STA.b $18,x
CODE_06E299:
	RTS

DATA_06E29A:
	dw $FFDE,$0012

DATA_06E29E:
	dw $FE00,$0200

CODE_06E2A2:
	LDA.w $7A98,x
	BNE.b CODE_06E31D
	LDA.b $16,x
	BNE.b CODE_06E2B7
	LDA.b $0E
	AND.w #$FFF0
	ORA.w #$8000
	STA.b $0E
	BRA.b CODE_06E31D

CODE_06E2B7:
	CMP.w #$0008
	BNE.b CODE_06E31D
	LDA.w #!Define_YI_SoundID77_EnemyJumpingOutOfPipe
	JSL.l CODE_push_sound_queue
	LDA.w #$001E
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_06E31D
	LDA.l $7044C8
	CLC
	ADC.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,y
	LDA.w $70E2,x
	SEC
	SBC.w #$0008
	STA.b $00
	LDA.w $7400,x
	AND.w #$0002
	STA.w $7400,y
	TAX
	LDA.w DATA_06E29A,x
	CLC
	ADC.b $00
	STA.w $70E2,y
	LDA.w DATA_06E29E,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FD80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0018
	STA.w $7A96,y
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDX.b $12
	LDA.w #$0048
	STA.w $7AF8,x
CODE_06E31D:
	JSR.w CODE_06E321
	RTS

CODE_06E321:
	LDA.b $0E
	BPL.b CODE_06E32F
	STZ.w $7A98,x
	STZ.b $16,x
	LDA.w #$8000
	TRB.b $0E
CODE_06E32F:
	CLC
	LDA.w $7A98,x
	BNE.b CODE_06E366
	REP.b #$10
	LDA.b $0E
	AND.w #$000F
	ASL
	TAY
	LDA.w DATA_06E371,y
	STA.b $00
	LDA.w DATA_06E37B,y
	STA.b $02
	LDA.b $16,x
	BNE.b CODE_06E34F
	LDA.w DATA_06E367,y
CODE_06E34F:
	DEC
	STA.b $16,x
	TAY
	LDA.b ($00),y
	AND.w #$00FF
	STA.w $7A98,x
	LDA.b ($02),y
	AND.w #$00FF
	STA.w $7402,x
	SEP.b #$10
	SEC
CODE_06E366:
	RTS

DATA_06E367:
	dw $0004,$0009,$0004,$0008,$000F

DATA_06E371:
	dw DATA_06E385,DATA_06E38D,DATA_06E39F,DATA_06E3A7,DATA_06E3B7

DATA_06E37B:
	dw DATA_06E389,DATA_06E396,DATA_06E3A3,DATA_06E3AF,DATA_06E3C6

DATA_06E385:
	db $04,$08,$04,$08

DATA_06E389:
	db $08,$09,$08,$07

DATA_06E38D:
	db $40,$02,$04,$01,$01,$01,$01,$01,$02

DATA_06E396:
	db $14,$13,$12,$0E,$0D,$0C,$05,$06,$07

DATA_06E39F:
	db $04,$08,$04,$08

DATA_06E3A3:
	db $08,$09,$08,$07

DATA_06E3A7:
	db $40,$04,$03,$02,$02,$01,$01,$01

DATA_06E3AF:
	db $07,$06,$05,$04,$03,$02,$01,$00

DATA_06E3B7:
	db $01,$01,$01,$01,$01,$01,$02,$10,$02,$01,$01,$01,$01,$01,$10

DATA_06E3C6:
	db $06,$05,$04,$03,$02,$01,$0A,$0B,$0A,$02,$03,$04,$05,$06,$07

CODE_06E3D5:
	RTL

CODE_06E3D6:
	RTL

DATA_06E3D7:
	dw DATA_06E3D7+$02,DATA_06E3DF,DATA_06E407

DATA_06E3DD:
	db $14,$0E

DATA_06E3DF:
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000

DATA_06E407:
	dw $0000,$00C8,$FFC5,$FEC4,$FAC3,$D9C5,$C1C9,$A9D1
	dw $A1D8,$9DE0,$9900,$9D21,$A129,$A930,$C138,$D93C
	dw $FA3E,$FE3D,$FF3C,$0039

CODE_06E42F:
	LDY.b $0C
	LDA.w DATA_06E3DD,y
	AND.w #$00FF
	STA.b $06
	TYA
	ASL
	TAY
	LDA.w DATA_06E3D7,y
	STA.b $00
	LDY.b #$00
	LDA.b ($00),y
	STA.b $02
	LDY.b #$02
	LDA.b ($00),y
	STA.b $04
	LDA.b $06
	DEC
	ASL
	TAY
CODE_06E452:
	TYA
	ASL
	TAX
	LDA.w #$0000
	STA.l $7049F6,x
	LDA.w #$0000
	STA.l $7049F8,x
	LDA.w DATA_06E407,y
	AND.w #$00FF
	CMP.w #$0080
	BCC.b CODE_06E471
	ORA.w #$FF00
CODE_06E471:
	STA.l $704B36,x
	LDA.w DATA_06E407,y
	AND.w #$FF00
	BPL.b CODE_06E480
	ORA.w #$00FF
CODE_06E480:
	XBA
	STA.l $704B38,x
	DEY
	BPL.b CODE_06E452
	LDX.b $12
	RTS

CODE_06E48B:
	LDA.w #$0004
	TRB.w !RAM_YI_Global_SubScreenLayers
	LDA.w #$0400
	TRB.b $0E
	LDA.w $7680,x
	CLC
	ADC.w #$0080
	CMP.w #$0200
	BCS.b CODE_06E514
	LDA.w $7682,x
CODE_06E4A5:
	CLC
	ADC.w #$0080
	CMP.w #$0200
	BCS.b CODE_06E514
	LDA.w $7680,x
	STA.w $6040
	LDA.w $7682,x
	STA.w $6042
	LDA.w #$49F6
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$4B36
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $06
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STZ.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$449E
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $18,x
	AND.w #$03FF
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0000
	STA.w $605E
	LDX.b #FXCODE_08E8CA>>16
	LDA.w #FXCODE_08E8CA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	SEP.b #$30
	LDA.b #$04
	TSB.w !RAM_YI_Global_SubScreenLayers
	LDA.b #$02
	TSB.w !RAM_YI_Global_ColorMathInitialSettings
	LDA.b #$63
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.b #$18
	TSB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDA.w #$0400
	TSB.b $0E
CODE_06E514:
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Fort Ghost With Platform ($0D6) -- Init handler.
; A Boo that holds a small platform Yoshi can ride. Fort/castle BG
; variant (graphics + palette differ from the sewer-BG version $057).
; Raidenthequick: init_platform_ghost.
;-------------------------------------------------------------------------
YI_NorSpr0D6_FortGhostWithPlatform_Init:
init_platform_ghost_fort:                  ; Raidenthequick: init_platform_ghost
                                           ; (Raiden's name is generic; we
                                           ;  disambiguate fort vs sewer here)
;$06E517
	LDA.w #$0100
	STA.b $18,x
	LDA.w #$0040
	STA.b $76,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	STZ.b $16,x
	LDA.w #$8000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Fort Ghost With Platform ($0D6) -- Main handler.
; Raidenthequick: main_platform_ghost.
;-------------------------------------------------------------------------
YI_NorSpr0D6_FortGhostWithPlatform_Main:
main_platform_ghost_fort:                  ; Raidenthequick: main_platform_ghost
;$06E530
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $0E
	JSR.w CODE_06E562
	JSR.w CODE_06E65D
	JSR.w CODE_06E58E
CODE_06E53E:
	JSR.w CODE_06E7E0
	JSR.w CODE_06E85A
	LDA.b $0E
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSL.l CODE_03AF23
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $0E
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $76,x
	JSR.w CODE_06E894
	LDX.b $12
	LDA.b $0E
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTL

CODE_06E562:
	LDA.l $7044DA
	CLC
	ADC.w $70E2,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.l $7044DC
CODE_06E571:
	CLC
	ADC.w $7182,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_06E58D
	LDA.w #$0002
	TSB.b $0E
CODE_06E58D:
	RTS

CODE_06E58E:
	LDA.w $7680,x
	CLC
	ADC.w #$0028
	CMP.w #$0150
	BCC.b CODE_06E5AA
	LDY.b #$11
	STY.w !RAM_YI_Global_MainScreenLayers
	LDY.b #$02
	STY.w !RAM_YI_Global_SubScreenLayers
	LDY.b #$20
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	RTS

CODE_06E5AA:
	LDA.w #DATA_06E8FC>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.b $18,x
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_06E623,y
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $18,x
	XBA
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_06E623,y
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$449E
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7680,x
	STA.w $6040
	LDA.w $7682,x
	STA.w $6042
	LDX.b #FXCODE_08E93B>>16
	LDA.w #FXCODE_08E93B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	SEP.b #$30
	LDA.b #$13
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.b #$04
	STA.w !RAM_YI_Global_SubScreenLayers
	LDA.b #$22
	STA.w !RAM_YI_Global_ColorMathInitialSettings
	LDA.b #$63
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.b #$18
	TSB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDX.b $12
	RTS

DATA_06E623:
	dw DATA_06E8FC,DATA_06E91C

DATA_06E627:
DATA_platform_ghost_fort_state_ptr:             ; (routine,arg) pairs for fort-ghost platform state machine
	dw CODE_06E6D1,$0001,CODE_06E708,$0001,CODE_06E760,$0001,CODE_06E7BB,$0001
	dw CODE_06E78C,$0001,CODE_06E708,$0001,CODE_06E760,$0001,CODE_06E7BB,$0001
	dw CODE_06E78C,$0001,CODE_06E708,$0001,CODE_06E764,$0001,CODE_06E7BB,$0001
	dw CODE_06E78C,$0001,$0000

CODE_06E65D:
	JSR.w CODE_06E6B3
	LDA.b $78,x
	ASL
	ASL
CODE_06E664:
	TAY
	LDA.w DATA_platform_ghost_fort_state_ptr,y
	BNE.b CODE_06E673
	STA.b $78,x
	LDA.w #$8000
	TSB.b $0E
	BRA.b CODE_06E664

CODE_06E673:
	STA.b $00
	LDA.w DATA_platform_ghost_fort_state_ptr+$02,y
	STA.b $18,x
	PER.w CODE_06E680-$01
	JMP.w ($0000+$7960)
CODE_06E680:
	LDA.b $0E
	AND.w #$7FFF
	BIT.w #$4000
	BEQ.b CODE_06E68F
	EOR.w #$C000
	INC.b $78,x
CODE_06E68F:
	STA.b $0E
	RTS

DATA_06E692:
	dw $0000,$0001,$0002,$0001,$0002,$0000,$0000,$0001
	dw $0002,$0001,$0002

CODE_06E6A8:
	LDA.w #$0015
	STA.w $7A98,x
	LDA.w #$0004
	TSB.b $0E
CODE_06E6B3:
	LDA.b $0E
	BIT.w #$0004
	BEQ.b CODE_06E6D0
	LDA.w $7A98,x
	PHA
	BNE.b CODE_06E6C5
	LDA.w #$0004
	TRB.b $0E
CODE_06E6C5:
	PLA
	AND.w #$FFFE
	TAY
	LDA.w DATA_06E692,y
	STA.w $7402,x
CODE_06E6D0:
	RTS

CODE_06E6D1:
	LDA.b $0E
	BPL.b CODE_06E6DB
	LDA.w #$00F0
	STA.w $7A96,x
CODE_06E6DB:
	LDA.b $0E
	BIT.w #$0004
	BNE.b CODE_06E707
	LDA.w #$0002
	STA.w $7402,x
	LDA.w $7A96,x
	BNE.b CODE_06E6F6
	LDA.w #$00F0
	STA.w $7A96,x
	JSR.w CODE_06E6A8
CODE_06E6F6:
	LDA.b $0E
	BIT.w #$0001
	BEQ.b CODE_06E707
	LDA.b $0E
	AND.w #$FFFB
	ORA.w #$4000
	STA.b $0E
CODE_06E707:
	RTS

CODE_06E708:
	LDA.b $0E
	BPL.b CODE_06E724
	LDA.w #$0180
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0080
	STA.w $7A96,x
	LDA.w #$0002
	STA.w $7400,x
	LDA.w #$0002
	STA.w $7402,x
CODE_06E724:
	LDA.b $0E
	BIT.w #$0002
	BNE.b CODE_06E754
	LDA.w $7680,x
	CLC
	ADC.w #$0080
	CMP.w #$0200
	BCS.b CODE_06E73D
	LDA.w #$00C0
	STA.w $0051
CODE_06E73D:
	LDA.w $7A96,x
	BNE.b CODE_06E74B
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$4000
	TSB.b $0E
	RTS

CODE_06E74B:
	CMP.w #$0017
	BNE.b CODE_06E753
	JSR.w CODE_06E6A8
CODE_06E753:
	RTS

CODE_06E754:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

DATA_06E758:
	dw $0003,$0006

DATA_06E75C:
	dw $0090,$0120

CODE_06E760:
	LDY.b #$00
	BRA.b CODE_06E766

CODE_06E764:
	LDY.b #$02
CODE_06E766:
	STZ.w $7402,x
	LDA.b $0E
	BPL.b CODE_06E773
	LDA.w #$001E
	STA.w $7A96,x
CODE_06E773:
	LDA.w $7A96,x
	BNE.b CODE_06E78B
	LDA.b $76,x
	CLC
	ADC.w DATA_06E758,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w DATA_06E75C,y
	BCC.b CODE_06E78B
	LDA.w #$4000
	TSB.b $0E
CODE_06E78B:
	RTS

CODE_06E78C:
	LDA.b $0E
	BPL.b CODE_06E799
	LDA.w #$0002
	STA.w $7402,x
	STZ.w $7A96,x
CODE_06E799:
	LDA.w $7A96,x
	BNE.b CODE_06E7BA
	LDA.w #$0002
	STA.w $7A96,x
	LDA.b $76,x
	SEC
	SBC.w #$0003
	CMP.w #$0040
	BPL.b CODE_06E7B7
	LDA.w #$4000
	TSB.b $0E
	LDA.w #$0040
CODE_06E7B7:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_06E7BA:
	RTS

CODE_06E7BB:
	LDA.b $0E
	BPL.b CODE_06E7C5
	LDA.w #$00C6
	STA.w $7A96,x
CODE_06E7C5:
	LDA.w $7A96,x
	CMP.w #$0017
	BNE.b CODE_06E7D0
	JSR.w CODE_06E6A8
CODE_06E7D0:
	LDA.w $7A96,x
	BNE.b CODE_06E7DF
	LDA.b $0E
	AND.w #$FFFB
	ORA.w #$4000
	STA.b $0E
CODE_06E7DF:
	RTS

CODE_06E7E0:
	LDA.b $18,x
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_06E623,y
	STA.b $00
	LDA.b $18,x
	XBA
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_06E623,y
	STA.b $02
	LDY.b #$12
	LDA.b ($00),y
	AND.w #$00FF
	BIT.w #$0080
	BEQ.b CODE_06E808
	ORA.w #$FF00
CODE_06E808:
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b ($02),y
	AND.w #$00FF
	BIT.w #$0080
	BEQ.b CODE_06E818
	ORA.w #$FF00
CODE_06E818:
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	INY
	LDA.b ($00),y
	AND.w #$00FF
	BIT.w #$0080
	BEQ.b CODE_06E829
	ORA.w #$FF00
CODE_06E829:
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b ($02),y
	AND.w #$00FF
	BIT.w #$0080
	BEQ.b CODE_06E839
	ORA.w #$FF00
CODE_06E839:
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_08EB9D>>16
	LDA.w #FXCODE_08EB9D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	STA.b $0A
	STA.b $16,x
	LDA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.b $0C
	RTS

CODE_06E85A:
	REP.b #$10
	LDA.w $7A36,x
	SEC
	SBC.w #$0008
	STA.b $00
	LDA.w $7A38,x
	CLC
	ADC.w #$0010
	STA.b $02
	LDY.w $7362,x
	LDX.w #$000D
CODE_06E874:
	LDA.w $6000,y
	CLC
	ADC.b $00
	STA.w $6000,y
	LDA.w $6002,y
	CLC
	ADC.b $02
	STA.w $6002,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEX
	BNE.b CODE_06E874
	SEP.b #$10
	LDX.b $12
	RTS

CODE_06E894:
	LDA.w $60AA
	BMI.b CODE_06E8F1
	LDA.w $611C
	SEC
	SBC.w $70E2,x
	CLC
	ADC.b $0A
	STA.b $00
	ASL
	LDA.w $6120
	BCS.b CODE_06E8AF
	EOR.w #$FFFF
	INC
CODE_06E8AF:
	CLC
	ADC.b $00
	CLC
	ADC.w #$0018
	CMP.w #$0030
	BCS.b CODE_06E8F1
	LDA.w $7182,x
	CLC
	ADC.b $0C
	SEC
	SBC.w #$0008
	STA.b $00
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	CMP.w #$000A
	BMI.b CODE_06E8F1
	CMP.w #$0020
	BCS.b CODE_06E8F1
	LDA.b $00
	SEC
	SBC.w #$0020
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC.w $61B4
	LDA.w #$0001
	TSB.b $0E
CODE_06E8E7:
	LDA.w $72C0,x
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_06E8F1:
	LDA.b $0A
	STA.w $7A36,x
	LDA.b $0C
	STA.w $7A38,x
	RTS

;---------------------------------------------------------------------------

DATA_06E8FC:
	dw $0000,$00C1,$F4C8,$E5D0,$D0D8,$ACE0,$91E8,$86F0
	dw $82F8,$8100,$8101,$8209,$8A11,$9819,$DE20,$0028

DATA_06E91C:
	dw $0000,$00C1,$00C8,$00D0,$00D8,$00E0,$00E8,$00F0
	dw $00F8,$0000,$0001,$0009,$0011,$0019,$0020,$0028

DATA_06E93C:
	dw $0040,$0040

DATA_06E940:
	dw $0030,$0030

;-------------------------------------------------------------------------
; Soft Block ($0DB) -- Init handler.
; A deformable squishy floor/ceiling block. Yoshi sinks into it on
; contact; release time controlled by Main's spring physics.
; Raidenthequick: init_soft_thing.
;-------------------------------------------------------------------------
YI_NorSpr0DB_SoftBlock_Init:
init_soft_block:                           ; Raidenthequick: init_soft_thing
;$06E944
	LDY.b #$00
	LDA.w $70E2,x
	BIT.w #$0010
	BEQ.b CODE_06E950
	LDY.b #$02
CODE_06E950:
	LDA.w DATA_06E93C,y
	STA.b $76,x
	LDA.w DATA_06E940,y
	STA.b $78,x
	STZ.w $7B56,x
	STZ.w $7B58,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Soft Block ($0DB) -- Main handler.
; Per-frame spring physics: tracks Yoshi-contact depth, runs damped
; oscillation back to rest. Raidenthequick: main_soft_thing.
;-------------------------------------------------------------------------
YI_NorSpr0DB_SoftBlock_Main:
main_soft_block:                           ; Raidenthequick: main_soft_thing
;$06E961
	LDA.w #$F880
	AND.b $18,x
	STA.b $18,x
	JSR.w CODE_06EA0A
	JSL.l CODE_03AF23
	LDA.w $7680,x
	CLC
	ADC.w #$0078
	CMP.w #$01F0
	BCS.b CODE_06E987
	LDA.w $7682,x
	CLC
	ADC.w #$0078
	CMP.w #$01C2
	BCC.b CODE_06E98C
CODE_06E987:
	JSL.l CODE_03A31E
	RTL

CODE_06E98C:
	LDA.b $76,x
	CMP.w #$8000
	ROR
	STA.w $7BB6,x
	LDA.b $78,x
	CMP.w #$8000
	ROR
	STA.w $7BB8,x
	JSR.w CODE_06EB2C
	JSR.w CODE_06EBF8
	JSR.w CODE_06EEFE
	REP.b #$10
	LDA.b $18,x
	AND.w #$07FF
	LDY.w $60D4
	BEQ.b CODE_06E9C6
	BIT.w #$0010
	BEQ.b CODE_06E9C6
	ORA.w #$0800
	BIT.w #$0400
	BEQ.b CODE_06E9C6
	LDY.w #$0000
	STY.w $60D4
CODE_06E9C6:
	LDY.w $60C0
	BNE.b CODE_06E9CE
	ORA.w #$4000
CODE_06E9CE:
	BIT.w #$0010
	BEQ.b CODE_06E9D6
	ORA.w #$1000
CODE_06E9D6:
	BIT.w #$0020
	BEQ.b CODE_06E9DE
	ORA.w #$2000
CODE_06E9DE:
	BIT.w #$0100
	BEQ.b CODE_06E9E6
	ORA.w #$8000
CODE_06E9E6:
	STA.b $18,x
	SEP.b #$10
	LDX.b $12
	RTL

CODE_06E9ED:
	LDA.b $76,x
	LSR
	BCS.b CODE_06E9F3
	DEC
CODE_06E9F3:
	STA.b $02
	SEC
	SBC.b $76,x
	INC
	STA.b $00
	LDA.b $78,x
	LSR
	BCS.b CODE_06EA01
	DEC
CODE_06EA01:
	STA.b $06
	SEC
	SBC.b $78,x
	INC
	STA.b $04
	RTS

CODE_06EA0A:
	LDA.w $7680,x
	ADC.w #$0078
	CMP.w #$01F0
	BCC.b CODE_06EA21
	SEP.b #$20
	LDA.b #$04
	TRB.w !RAM_YI_Global_MainScreenLayers
	REP.b #$20
	LDX.b $12
	RTS

CODE_06EA21:
	JSR.w CODE_06E9ED
	LDA.b $00
	SEC
	SBC.w $7A38,x
	STA.l $70449E
	STA.l $7044DA
	CLC
	ADC.w #$0001
	STA.l $7044A2
	STA.l $7044D6
	CLC
	ADC.w #$0001
	STA.l $7044A6
	STA.l $7044D2
	CLC
	ADC.w #$0002
	STA.l $7044AA
	STA.l $7044CE
	LDA.b $02
	CLC
	ADC.w $7A38,x
	STA.l $7044BA
	STA.l $7044BE
	SEC
	SBC.w #$0001
	STA.l $7044B6
	STA.l $7044C2
	SEC
	SBC.w #$0001
	STA.l $7044B2
	STA.l $7044C6
	SEC
	SBC.w #$0002
	STA.l $7044AE
	STA.l $7044CA
	LDA.b $04
	CLC
	ADC.w $7A38,x
	STA.l $7044AC
	STA.l $7044B0
	CLC
	ADC.w #$0001
	STA.l $7044A8
	STA.l $7044B4
	CLC
	ADC.w #$0001
	STA.l $7044A4
	STA.l $7044B8
	CLC
	ADC.w #$0002
	STA.l $7044A0
	STA.l $7044BC
	LDA.b $06
	STA.l $7044D0
	STA.l $7044CC
	SEC
	SBC.w #$0001
	STA.l $7044D4
	STA.l $7044C8
	SEC
	SBC.w #$0001
	STA.l $7044D8
	STA.l $7044C4
	SEC
	SBC.w #$0002
	STA.l $7044DC
	STA.l $7044C0
	LDA.w $7680,x
	STA.w $6040
	LDA.w $7682,x
	STA.w $6042
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$449E
	STA.w $6048
	LDA.w #$44DA
	STA.w $604A
	LDX.b #FXCODE_08E9E2>>16
	LDA.w #FXCODE_08E9E2
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	SEP.b #$30
	LDA.b #$04
	TSB.w !RAM_YI_Global_MainScreenLayers
	LDA.b #$18
	TSB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDX.b $12
	RTS

CODE_06EB2C:
	JSR.w CODE_06E9ED
	LDA.b $00
	CLC
	ADC.w $70E2,x
	STA.b $00
	LDA.b $02
	CLC
	ADC.w $70E2,x
	STA.b $02
	LDA.b $04
	CLC
	ADC.w $7182,x
	STA.b $04
	LDA.b $06
	CLC
	ADC.w $7182,x
	STA.b $06
	LDA.w #$0007
	STA.b $08
	JSR.w CODE_06EFC9
	LDX.b $12
	LDA.b $0E
	ORA.b $18,x
	STA.b $18,x
	LDA.b $0E
	AND.w #$0003
	BEQ.b CODE_06EBA7
	LDA.b $0E
	BIT.w #$0001
	BNE.b CODE_06EB87
	LDA.b $04
	EOR.w #$000F
	BEQ.b CODE_06EB9E
	INC
	AND.w #$000F
	STA.b $0A
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_06EB9E
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $72C2,x
	BRA.b CODE_06EB9E

CODE_06EB87:
	LDA.b $06
	INC
	AND.w #$000F
	EOR.w #$FFFF
	INC
	STA.b $0A
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_06EB9E
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $72C2,x
CODE_06EB9E:
	LDA.w $7182,x
	CLC
	ADC.b $0A
	STA.w $7182,x
CODE_06EBA7:
	LDA.b $0E
	AND.w #$000C
	BEQ.b CODE_06EBF3
	CMP.w #$000C
	BEQ.b CODE_06EBF3
	BIT.w #$0008
	BEQ.b CODE_06EBD3
	LDA.b $00
	AND.w #$000F
	EOR.w #$000F
	INC
	AND.w #$000F
	STA.b $08
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_06EBEA
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $72C2,x
	BRA.b CODE_06EBEA

CODE_06EBD3:
	LDA.b $02
	INC
	AND.w #$000F
	EOR.w #$FFFF
	INC
	STA.b $08
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_06EBEA
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $72C0,x
CODE_06EBEA:
	LDA.w $70E2,x
	CLC
	ADC.b $08
	STA.w $70E2,x
CODE_06EBF3:
	RTS

DATA_06EBF4:
	dw $0001,$FFFF

CODE_06EBF8:
	STZ.b $0E
	LDX.b $12
	LDA.b $76,x
	CMP.w #$8000
	ROR
	STA.w $7BB6,x
	LDA.b $78,x
	CMP.w #$8000
	ROR
	STA.w $7BB8,x
	LDA.w $60B4
	PHA
	JSR.w CODE_06EDF6
	PLA
	BCS.b CODE_06EC1B
	JMP.w CODE_06ECAF

CODE_06EC1B:
	CPY.b #$01
	BNE.b CODE_06EC8F
	LDA.b $0E
	BEQ.b CODE_06EC92
	LDA.w $60D4
	BEQ.b CODE_06EC88
	LDA.b $18,x
	AND.w #$000C
	CMP.w #$000C
	BEQ.b CODE_06EC88
	LDA.b $78,x
	CMP.w #$000E
	BCC.b CODE_06EC81
	LDA.b $76,x
	PHA
	LDA.b $78,x
	DEC
	TAY
	LDA.w #$0C00
	JSR.w CODE_06EFB7
	STA.b $76,x
	DEC.b $78,x
	LDA.b $78,x
	LSR
	BCS.b CODE_06EC55
	INC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC.w $7182,x
CODE_06EC55:
	PLA
	EOR.w #$FFFF
	SEC
	ADC.b $76,x
	LSR
	STA.b $00
	LDA.b $18,x
	BIT.w #$000C
	BEQ.b CODE_06EC88
	BIT.w #$0008
	BEQ.b CODE_06EC76
	LDA.w $70E2,x
	CLC
	ADC.b $00
	STA.w $70E2,x
	BRA.b CODE_06EC88

CODE_06EC76:
	LDA.w $70E2,x
	SEC
	SBC.b $00
	STA.w $70E2,x
	BRA.b CODE_06EC88

CODE_06EC81:
	LDA.b $18,x
	ORA.w #$0400
	STA.b $18,x
CODE_06EC88:
	LDA.b $18,x
	ORA.w #$0110
	STA.b $18,x
CODE_06EC8F:
	JMP.w CODE_06EDF1

CODE_06EC92:
	LDA.w $60C0
	BNE.b CODE_06ECA5
	LDY.b $06
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w $7962,y
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BRA.b CODE_06ECAC

CODE_06ECA5:
	LDA.b $18,x
	ORA.w #$0100
	STA.b $18,x
CODE_06ECAC:
	JMP.w CODE_06EDF1

CODE_06ECAF:
	CMP.w $60B4
	BNE.b CODE_06ECB7
	JMP.w CODE_06EDF1

CODE_06ECB7:
	STA.b $08
	LDA.b $18,x
	ORA.w #$0020
	STA.b $18,x
	LDY.b $06
	LDA.w $7962,y
	STA.b $0A
	LDA.b $18,x
	PHA
	AND.w #$BFFF
	STA.b $18,x
	PLA
	BIT.w #$4000
	BNE.b CODE_06ECDC
	LDY.b #$01
	LDA.w $60C0
	BNE.b CODE_06ED48
CODE_06ECDC:
	LDA.w $60DE
	BNE.b CODE_06ED48
	LDA.w $6150
	BNE.b CODE_06ED48
	LDY.b $06
	LDA.w $7962,y
	BPL.b CODE_06ECF6
	LDA.b $18,x
	BIT.w #$0004
	BNE.b CODE_06ED69
	BRA.b CODE_06ECFD

CODE_06ECF6:
	LDA.b $18,x
	BIT.w #$0008
	BNE.b CODE_06ED69
CODE_06ECFD:
	LDY.w $60AA
	BMI.b CODE_06ED48
	LDA.w $70E2,x
	SEC
	LDX.b $06
	SBC.w DATA_06EFA7,x
	LDX.b $12
	SEC
	SBC.b $0A
	STA.w $70E2,x
	LDA.b $08
	PHA
	CLC
	ADC.w #$00C0
	CMP.w #$0181
	PLA
	BCC.b CODE_06ED2A
	LDA.w #$00E0
	LDX.b $06
	BNE.b CODE_06ED2A
	LDA.w #$FF20
CODE_06ED2A:
	STA.w $60B4
	LDA.w #$0000
	STA.w $60A8
	LDA.w $7A96,x
	BNE.b CODE_06ED45
	LDA.w #!Define_YI_SoundID59_RollingRock
	JSL.l CODE_push_sound_queue
	LDA.w #$000A
	STA.w $7A96,x
CODE_06ED45:
	JMP.w CODE_06EDEB

CODE_06ED48:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	LDX.b $06
	ADC.w DATA_06EFA7,x
	LDX.b $12
	CLC
	ADC.b $0A
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CPY.b #$00
	BNE.b CODE_06ED60
	JMP.w CODE_06EDEB

CODE_06ED60:
	STZ.w $60A8
	STZ.w $60B4
	JMP.w CODE_06EDF1

CODE_06ED69:
	LDA.b $08
	PHA
	CLC
	ADC.w #$00C0
	CMP.w #$0181
	PLA
	BCC.b CODE_06ED80
	LDA.w #$00C0
	LDX.b $06
	BNE.b CODE_06ED80
	LDA.w #$FF40
CODE_06ED80:
	STA.w $60B4
	LDA.w #$0000
	STA.w $60A8
	LDX.b $12
	LDY.b #$00
	LDA.b $18,x
	AND.w #$0003
	CMP.w #$0003
	BEQ.b CODE_06ED48
	LDA.b $76,x
	DEC
	TAY
	LDA.w #$0C00
	JSR.w CODE_06EFB7
	LDY.b #$00
	CMP.w #$0041
	BCS.b CODE_06ED48
	STA.b $78,x
	DEC.b $76,x
	LDA.b $76,x
	AND.w #$0001
	ASL
	ASL
	CLC
	ADC.b $06
	TAY
	LDA.w DATA_06EFAF,y
	CLC
	ADC.w $70E2,x
	STA.w $70E2,x
	LDX.b $06
	LDA.w DATA_06EFA7,x
	LDX.w $7972
	CLC
	ADC.b $0A
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_06EFAF,y
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $7A96,x
	BNE.b CODE_06EDE9
	LDA.w #!Define_YI_SoundID59_RollingRock
	JSL.l CODE_push_sound_queue
	LDA.w #$000A
	STA.w $7A96,x
CODE_06EDE9:
	LDX.b $12
CODE_06EDEB:
	INC.w $61C2
	INC.w $60DC
CODE_06EDF1:
	RTS

DATA_06EDF2:
	dw $0001,$FFFF

CODE_06EDF6:
	STZ.b $0E
	BRA.b CODE_06EDFE

CODE_06EDFA:
	LDY.b #$00
	SEC
	RTS

CODE_06EDFE:
	LDA.w $6122
	CLC
	ADC.w $7BB8,x
	STA.b $00
	LDA.w $7C18,x
	SEC
	SBC.b $00
	CLC
	ADC.w $7A38,x
	BPL.b CODE_06EDFA
	STA.b $0A
	LDA.b $00
	SEC
	ADC.w $7C18,x
	BEQ.b CODE_06EDFA
	BMI.b CODE_06EDFA
	STA.b $08
	LDY.b #$00
	LDA.w $7C18,x
	BMI.b CODE_06EE2A
	LDY.b #$02
CODE_06EE2A:
	STY.b $0C
	LDA.w $6120
	CLC
	ADC.w $7BB6,x
	STA.b $00
	LDA.w $7C16,x
	SEC
	SBC.b $00
	BPL.b CODE_06EDFA
	STA.b $04
	LDA.b $00
	CLC
	ADC.w $7C16,x
	BEQ.b CODE_06EDFA
	BMI.b CODE_06EDFA
	STA.b $02
	LDY.b #$00
	LDA.w $7C16,x
	BMI.b CODE_06EE54
	LDY.b #$02
CODE_06EE54:
	STY.b $06
	LDA.w $7962,y
	BPL.b CODE_06EE5F
	EOR.w #$FFFF
	INC
CODE_06EE5F:
	STA.b $00
	LDY.b $0C
	LDA.w $7968,y
	BPL.b CODE_06EE6C
	EOR.w #$FFFF
	INC
CODE_06EE6C:
	CMP.b $00
	BCC.b CODE_06EE73
	JMP.w CODE_06EEE2

CODE_06EE73:
	CMP.w #$000D
	BCC.b CODE_06EE8B
	JMP.w CODE_06EEE2

CODE_06EE7B:
	LDA.w #$0040
	STA.w $60B4
	LDA.b $18,x
	ORA.w #$0040
	STA.b $18,x
	JMP.w CODE_06EEE2

CODE_06EE8B:
	LDA.w $7968,y
	BEQ.b CODE_06EE9E
	BMI.b CODE_06EE9E
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60D2
	BRA.b CODE_06EED3

CODE_06EE9E:
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $7182,x
	SEC
	SBC.w $6EBE
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDY.w $60AB
	BPL.b CODE_06EEBB
	JMP.w CODE_06EEFA

CODE_06EEBB:
	LDA.w $70E2,x
	SEC
	SBC.w $6EBC
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	INC.w $61B4
	INC.b $0E
	LDA.w $60AA
	STA.b $0C
CODE_06EED3:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_06EEDB
	LDA.w #$0000
CODE_06EEDB:
	STA.w $60AA
	LDY.b #$01
	SEC
	RTS

CODE_06EEE2:
	LDX.b $06
	LDA.b $00
	LSR
	BEQ.b CODE_06EEE9
CODE_06EEE9:
	LDA.w $60B4
	EOR.l DATA_06EDF2,x
	BPL.b CODE_06EEF8
	STZ.w $60A8
	STZ.w $60B4
CODE_06EEF8:
	LDX.b $12
CODE_06EEFA:
	LDY.b #$01
	CLC
	RTS

CODE_06EEFE:
	LDA.b $18,x
	BIT.w #$0100
	BEQ.b CODE_06EF1F
	LDA.b $18,x
	BIT.w #$8000
	BNE.b CODE_06EF3A
	LDA.w #$0003
	STA.w $7A36,x
	LDA.w $60D4
	BEQ.b CODE_06EF1D
	LDA.w #$0005
	STA.w $7A36,x
CODE_06EF1D:
	BRA.b CODE_06EF3A

CODE_06EF1F:
	LDA.b $18,x
	BIT.w #$0020
	BEQ.b CODE_06EF3A
	BIT.w #$2000
	BNE.b CODE_06EF3A
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	ORA.w #$0080
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	LDA.w #$FFFD
	STA.w $7A36,x
CODE_06EF3A:
	LDA.w $7A36,x
	BEQ.b CODE_06EFA6
CODE_06EF3F:
	SEC
	SBC.w $7A38,x
	BEQ.b CODE_06EF81
	AND.w #$8000
	CLC
	ROL
	ROL
	ASL
	TAY
	LDA.w DATA_06EBF4,y
	CLC
	ADC.w $7A38,x
	STA.w $7A38,x
	LDA.b $18,x
	BIT.w #$0010
	BEQ.b CODE_06EF6D
	LDA.w $60AA
	BMI.b CODE_06EF6D
	LDA.w DATA_06EBF4,y
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_06EF6D:
	LDA.w $7A98,x
	BNE.b CODE_06EFA6
	LDA.w #!Define_YI_SoundID62_MelonBugBump
	JSL.l CODE_push_sound_queue
	LDA.w #$000C
	STA.w $7A98,x
	BRA.b CODE_06EFA6

CODE_06EF81:
	LDA.b $18,x
	BIT.w #$0080
	BNE.b CODE_06EF97
	LDA.w $7A36,x
	EOR.w #$FFFF
	INC
	BMI.b CODE_06EF92
	DEC
CODE_06EF92:
	STA.w $7A36,x
	BRA.b CODE_06EF3F

CODE_06EF97:
	LDA.b $18,x
	AND.w #$FF7F
	STA.b $18,x
	LDA.w #$0001
	STA.w $7A36,x
	BRA.b CODE_06EF3F

CODE_06EFA6:
	RTS

DATA_06EFA7:
	dw $FFFF,$0001,$0001,$FFFF

DATA_06EFAF:
	dw $0000,$0001,$FFFF,$0000

CODE_06EFB7:
	STA.w !REGISTER_DividendLo
	STY.w !REGISTER_Divisor
	NOP #8
	LDA.w !REGISTER_QuotientLo
	RTS

CODE_06EFC9:
	STZ.b $0E
	DEC.b $00
	INC.b $02
	LDA.b $04
	CLC
	ADC.b $08
	STA.b $0A
	LDA.b $06
	SEC
	SBC.b $08
	STA.b $0C
CODE_06EFDD:
	LDA.b $00
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b $0A
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_06EFFC
	LDA.b $0E
	ORA.w #$0008
	STA.b $0E
CODE_06EFFC:
	LDA.b $02
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b $0A
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_06F01B
	LDA.b $0E
	ORA.w #$0004
	STA.b $0E
CODE_06F01B:
	LDA.b $0E
	AND.w #$000C
	CMP.w #$000C
	BEQ.b CODE_06F036
	LDA.b $0A
	AND.w #$FFF0
	CLC
	ADC.w #$0010
	STA.b $0A
	CMP.b $0C
	BEQ.b CODE_06EFDD
	BCC.b CODE_06EFDD
CODE_06F036:
	INC.b $00
	DEC.b $02
	DEC.b $04
	DEC.b $04
	INC.b $06
	LDA.b $00
	CLC
	ADC.b $08
	STA.b $0A
	LDA.b $02
	SEC
	SBC.b $08
	STA.b $0C
CODE_06F04E:
	LDA.b $0A
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b $06
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_06F06D
	LDA.b $0E
	ORA.w #$0001
	STA.b $0E
CODE_06F06D:
	LDA.b $0E
	AND.w #$0003
	CMP.w #$0003
	BEQ.b CODE_06F088
	LDA.b $0A
	AND.w #$FFF0
	CLC
	ADC.w #$0010
	STA.b $0A
	CMP.b $0C
	BEQ.b CODE_06F04E
	BCC.b CODE_06F04E
CODE_06F088:
	INC.b $04
	INC.b $04
	DEC.b $06
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Sewer Ghost With Platform ($057) -- Init handler.
; Sewer BG variant of the platform-ghost. Same Boo behavior, different
; graphics/palette and slightly different idle bobbing.
; Raidenthequick: init_platform_ghost_sewer.
;-------------------------------------------------------------------------
YI_NorSpr057_SewerGhostWithPlatform_Init:
init_platform_ghost_sewer:                 ; Raidenthequick: init_platform_ghost_sewer
;$06F08F
	LDA.l $70449E
	CLC
	ADC.w $70E2,x
	CLC
	ADC.w #$0018
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	LDA.l $7044A8
	CLC
	ADC.w $7182,x
	SEC
	SBC.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	LDA.w #$0600
	STA.b $18,x
	STZ.w $7400,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.w $7A96,x
	STZ.w $7A98,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Sewer Ghost With Platform ($057) -- Main handler.
; Raidenthequick: main_platform_ghost_sewer.
;-------------------------------------------------------------------------
YI_NorSpr057_SewerGhostWithPlatform_Main:
main_platform_ghost_sewer:                 ; Raidenthequick: main_platform_ghost_sewer
;$06F0C2
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $0E
	JSR.w CODE_06F0EF
	JSR.w CODE_06F1A4
	JSR.w CODE_06F1C6
	JSR.w CODE_06F23F
	JSL.l CODE_03AF23
	LDA.b $0E
	BMI.b CODE_06F0E1
	JSL.l CODE_03A31E
	BRA.b CODE_06F0E9

CODE_06F0E1:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $18,x
	JSR.w CODE_06F383
CODE_06F0E9:
	LDA.b $0E
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTL

CODE_06F0EF:
	LDA.w #$49F6
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$4B36
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #DATA_06F40B>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b $18,x
	XBA
	ASL
	TAY
	LDA.w DATA_06F3EF,y
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	INY
	INY
	LDA.w DATA_06F3EF,y
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w #$0032
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0019
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$449E
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $18,x
CODE_06F12B:
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$8000
	TRB.b $0E
	LDA.w $7680,x
	STA.b $00
	STA.w $6040
	CLC
	ADC.w #$0080
	CMP.w #$0200
	BCC.b CODE_06F14A
	JMP.w CODE_06F1A1

CODE_06F14A:
	LDA.w $7682,x
	STA.b $02
	STA.w $6042
	CLC
	ADC.w #$00D2
	CMP.w #$02A4
	BCC.b CODE_06F15E
	JMP.w CODE_06F1A1

CODE_06F15E:
	LDA.w #$FF83
	STA.w $6044
	LDA.w #$FF2A
	STA.w $6046
	LDX.b #FXCODE_08E800>>16
	LDA.w #FXCODE_08E800
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	SEP.b #$30
	LDA.b #$13
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.b #$04
	STA.w !RAM_YI_Global_SubScreenLayers
	LDA.b #$22
	STA.w !RAM_YI_Global_ColorMathInitialSettings
	LDA.b #$63
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.b #$18
	TSB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDA.w #$8000
	TSB.b $0E
CODE_06F1A1:
	LDX.b $12
	RTS

CODE_06F1A4:
	LDA.w #$0008
	STA.b $00
	LDA.b $18,x
	CMP.w #$0C00
	BCC.b CODE_06F1B7
	PHA
	LDA.w #$0004
	STA.b $00
	PLA
CODE_06F1B7:
	CLC
	ADC.b $00
	CMP.w #$0D00
	BCC.b CODE_06F1C2
	LDA.w #$0000
CODE_06F1C2:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTS

CODE_06F1C6:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	XBA
	ASL
	TAY
	LDA.w DATA_06F3EF,y
	STA.b $00
	INY
	INY
	LDA.w DATA_06F3EF,y
	STA.b $02
	LDY.b #$00
	LDA.b ($00),y
	AND.w #$00FF
	SEC
	SBC.w #$007D
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b ($02),y
	AND.w #$00FF
	SEC
	SBC.w #$007D
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDY.b #$05
	LDA.b ($00),y
	AND.w #$00FF
CODE_06F1F9:
	SEC
	SBC.w #$00D6
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b ($02),y
	AND.w #$00FF
	SEC
	SBC.w #$00D6
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_08EB9D>>16
	LDA.w #FXCODE_08EB9D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	CLC
	ADC.w $70E2,x
	CLC
	ADC.w #$0018
	STA.b $00
	LDA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	CLC
	ADC.w $7182,x
	SEC
	SBC.w #$0008
	STA.b $02
CODE_06F23A:
	RTS

DATA_06F23B:
	dw $FF80,$0080

CODE_06F23F:
	LDA.b $76,x
	SEC
	SBC.w $70E2,x
	SEC
	SBC.w #$0008
	STA.b $04
	LDA.b $78,x
	SEC
	SBC.w $7182,x
	SEC
	SBC.w #$0008
	STA.b $06
	LDA.b $00
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	BEQ.b CODE_06F274
	BCC.b CODE_06F26B
	LDA.w $7400,x
	ORA.w #$0002
	STA.w $7400,x
	BRA.b CODE_06F274

CODE_06F26B:
	LDA.w $7400,x
	AND.w #$FFFD
	STA.w $7400,x
CODE_06F274:
	LDA.b $02
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	BEQ.b CODE_06F291
	BCC.b CODE_06F288
	LDA.w $7400,x
	ORA.w #$0004
	STA.w $7400,x
	BRA.b CODE_06F291

CODE_06F288:
	LDA.w $7400,x
	AND.w #$FFFB
	STA.w $7400,x
CODE_06F291:
	LDA.w $7400,x
	AND.w #$0002
	TAY
	LDA.w DATA_06F23B,y
	CLC
	ADC.w $7A36,x
	STA.b $08
	BPL.b CODE_06F2A7
	EOR.w #$FFFF
	INC
CODE_06F2A7:
	CMP.w #$0400
	BCS.b CODE_06F2B1
	LDA.b $08
	STA.w $7A36,x
CODE_06F2B1:
	LDA.w $7A36,x
	AND.w #$FF00
	BPL.b CODE_06F2BC
	ORA.w #$00FF
CODE_06F2BC:
	XBA
	STA.b $08
	REP.b #$10
	LDY.w $7362,x
	LDX.w #$0004
CODE_06F2C7:
	LDA.b $08
	CLC
	ADC.b $04
	CLC
	ADC.w $6000,y
	STA.w $6000,y
	LDA.w $6002,y
	CLC
	ADC.b $06
	CLC
	ADC.w #$0008
	STA.w $6002,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEX
	BNE.b CODE_06F2C7
	LDX.w #$0003
CODE_06F2EC:
	LDA.w $6000,y
	CLC
	ADC.b $04
	STA.w $6000,y
	LDA.w $6002,y
	CLC
	ADC.b $06
	STA.w $6002,y
	LDA.w $6004,y
	AND.w #$7FFF
	STA.w $6004,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEX
	BNE.b CODE_06F2EC
	LDX.b $12
	SEP.b #$10
	LDA.w $7A96,x
	BNE.b CODE_06F348
	LDA.w #!Define_YI_AmbSpr1BA
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	SEC
	SBC.w #$0008
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$000C
	STA.w $7142,y
	LDA.w #$001A
	STA.w $7E4C,y
	LDA.w #$0003
	STA.w $7782,y
	LDA.w #$002E
	STA.w $7A96,x
	LDY.b #$00
CODE_06F348:
	SEP.b #$10
	RTS

DATA_06F34B:
	dw $0007,$0008,$0009,$000A,$0009,$0008,$0007,$0006
	dw $0005,$0004,$0003,$0002,$0001,$0000,$0003,$0004
	dw $0005,$0004,$0003,$0003,$0003,$0003,$0003,$0003
	dw $0003,$0003,$0003,$0003

CODE_06F383:
	LDA.b $0E
	BIT.w #$0001
	BEQ.b CODE_06F39B
	LDA.b $00
	SEC
	SBC.b $76,x
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w #$0001
	TRB.b $0E
CODE_06F39B:
	LDA.w $60AA
	BMI.b CODE_06F3E6
	LDA.w $611C
	SEC
	SBC.b $00
	STA.b $04
	ASL
	LDA.w $6120
	BCS.b CODE_06F3B2
	EOR.w #$FFFF
	INC
CODE_06F3B2:
	CLC
	ADC.b $04
	CLC
	ADC.w #$0018
	CMP.w #$0030
	BCS.b CODE_06F3E6
	LDA.b $02
	SEC
	SBC.w #$0008
	STA.b $04
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	CMP.w #$000A
	BMI.b CODE_06F3E6
	CMP.w #$0020
	BCS.b CODE_06F3E6
	LDA.b $04
	SEC
	SBC.w #$0020
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC.w $61B4
	LDA.w #$0001
	TSB.b $0E
CODE_06F3E6:
	LDA.b $00
	STA.b $76,x
	LDA.b $02
	STA.b $78,x
	RTS

DATA_06F3EF:
	dw DATA_06F40B,DATA_06F46F,DATA_06F4D3,DATA_06F537,DATA_06F59B,DATA_06F5FF,DATA_06F663,DATA_06F6C7
	dw DATA_06F72B,DATA_06F78F,DATA_06F7F3,DATA_06F857,DATA_06F8BB,DATA_06F40B

DATA_06F40B:
	dw $6C00,$6903,$670B,$6724,$692C,$6C2F,$7231,$7734
	dw $7D37,$823A,$873F,$8D44,$924B,$9752,$9D5A,$A262
	dw $A76A,$AD72,$B279,$B77F,$BD84,$C289,$C78C,$CD8F
	dw $D292,$D794,$DA93,$DB92,$DB67,$DA66,$D765,$D264
	dw $CD61,$C75E,$C25B,$BD56,$B751,$B24A,$AD43,$A73B
	dw $A233,$9D2B,$9723,$921C,$8D15,$8710,$820B,$7D08
	dw $7705,$7202

DATA_06F46F:
	dw $8603,$8306,$810E,$8127,$832F,$8632,$8B35,$8F38
	dw $933B,$973F,$9B44,$9F49,$A34F,$A755,$AB5C,$AF63
	dw $B36B,$B772,$BB78,$BF7D,$C382,$C787,$CB8B,$CF8E
	dw $D391,$D794,$DA93,$DB92,$DB67,$DA66,$D765,$D363
	dw $CF60,$CB5D,$C759,$C354,$BF4F,$BB49,$B743,$B33C
	dw $AF34,$AB2D,$A726,$A320,$9F1A,$9B15,$9710,$930C
	dw $8F09,$8B06

DATA_06F4D3:
	dw $9F0D,$9C10,$9A18,$9A31,$9C39,$9F3C,$A23F,$A542
	dw $A846,$AB4A,$AD4E,$B052,$B357,$B65D,$B963,$BB68	
	dw $BE6E,$C174,$C47A,$C77E,$C982,$CC86,$CF8A,$D28E
	dw $D591,$D794,$DA93,$DB92,$DB67,$DA66,$D765,$D563
	dw $D260,$CF5C,$CC58,$C954,$C750,$C44B,$C145,$BE3F
	dw $BB39,$B934,$B62E,$B328,$B023,$AD1F,$AB1B,$A817
	dw $A513,$A210

DATA_06F537:
	dw $B41E,$B121,$AF29,$AF42,$B14A,$B44D,$B650,$B853
	dw $BA56,$BB59,$BD5D,$BF60,$C164,$C268,$C46D,$C671
	dw $C875,$C97A,$CB7D,$CD81,$CF84,$D088,$D28B,$D48E
	dw $D691,$D794,$DA93,$DB92,$DB67,$DA66,$D765,$D663
	dw $D460,$D25D,$D05A,$CF56,$CD53,$CB4F,$C94B,$C846
	dw $C642,$C43E,$C239,$C135,$BF31,$BD2E,$BB2A,$BA27
	dw $B824,$B621

DATA_06F59B:
	dw $C533,$C236,$C03E,$C057,$C25F,$C562,$C665,$C767
	dw $C869,$C96C,$CA6E,$CB71,$CC73,$CD76,$CE79,$CE7B
	dw $CF7D,$D080,$D183,$D285,$D388,$D48A,$D58D,$D68F
	dw $D691,$D794,$DA93,$DB92,$DB67,$DA66,$D765,$D663
	dw $D661,$D55F,$D45C,$D35A,$D257,$D155,$D052,$CF4F
	dw $CE4C,$CE4A,$CD47,$CC44,$CB42,$CA3F,$C93D,$C83A
	dw $C738,$C636

DATA_06F5FF:
	dw $CF4C,$CC4F,$CA57,$CA70,$CC78,$CF7B,$D07D,$D07D
	dw $D17E,$D180,$D181,$D282,$D283,$D385,$D386,$D387
	dw $D488,$D48A,$D58B,$D58C,$D58D,$D68F,$D690,$D691
	dw $D692,$D794,$DA93,$DB92,$DB67,$DA66,$D765,$D664
	dw $D663,$D662,$D660,$D55F,$D55E,$D55D,$D45B,$D45A
	dw $D359,$D358,$D356,$D255,$D254,$D153,$D151,$D150
	dw $D04F,$D04E

DATA_06F663:
	dw $D266,$CF69,$CD71,$CD8A,$CF92,$D295,$D394,$D394
	dw $D394,$D394,$D494,$D494,$D494,$D494,$D594,$D594
	dw $D594,$D594,$D694,$D694,$D694,$D694,$D694,$D694
	dw $D694,$D794,$DA93,$DB92,$DB67,$DA66,$D765,$D666
	dw $D666,$D666,$D666,$D666,$D666,$D666,$D566,$D566
	dw $D566,$D566,$D466,$D466,$D466,$D466,$D366,$D366
	dw $D366,$D366

DATA_06F6C7:
	dw $CB80,$C883,$C68B,$C6A4,$C8AC,$CBAF,$CCAD,$CDAC
	dw $CDAB,$CEA9,$CEA8,$CFA7,$D0A5,$D0A4,$D1A2,$D1A1
	dw $D2A0,$D39E,$D39D,$D49B,$D49A,$D599,$D697,$D696
	dw $D695,$D794,$DA93,$DB92,$DB67,$DA66,$D765,$D667
	dw $D668,$D669,$D56B,$D46C,$D46D,$D36F,$D370,$D272
	dw $D173,$D174,$D076,$D077,$CF79,$CE7A,$CE7B,$CD7D
	dw $CD7D,$CC7E

DATA_06F72B:
	dw $B799,$B49C,$B2A4,$B2BD,$B4C5,$B7C8,$B9C6,$BBC4
	dw $BCC2,$BEBF,$BFBD,$C1BA,$C3B7,$C4B4,$C6B1,$C7AE
	dw $C9AA,$CBA7,$CCA4,$CEA1,$CF9E,$D19C,$D399,$D497
	dw $D695,$D794,$DA93,$DB92,$DB67,$DA66,$D765,$D667
	dw $D469,$D36B,$D16E,$CF70,$CE73,$CC76,$CB79,$C97C
	dw $C77F,$C682,$C485,$C388,$C18B,$BF8E,$BE90,$BC93
	dw $BB95,$B997

DATA_06F78F:
	dw $95AE,$92B1,$90B9,$90D2,$92DA,$95DD,$99DB,$9CD9
	dw $9FD6,$A3D3,$A6D0,$A9CC,$ADC8,$B0C3,$B3BD,$B6B8
	dw $BAB3,$BDAD,$C0A8,$C4A4,$C7A0,$CA9D,$CE9A,$D197
	dw $D495,$D794,$DA93,$DB92,$DB67,$DA66,$D765,$D467
	dw $D169,$CE6C,$CA6F,$C772,$C476,$C07A,$BD7E,$BA84
	dw $B689,$B38E,$B094,$AD99,$A99D,$A6A1,$A3A4,$9FA7
	dw $9CAA,$99AC

DATA_06F7F3:
	dw $6BBF,$68C2,$66CA,$66E3,$68EB,$6BEE,$71EC,$76EA
	dw $7CE8,$81E5,$86E1,$8CDC,$91D6,$97CF,$9CC8,$A1C1
	dw $A7B9,$ACB2,$B2AB,$B7A5,$BCA0,$C29C,$C799,$CD97
	dw $D295,$D794,$DA93,$DB92,$DB67,$DA66,$D765,$D267
	dw $CD69,$C76B,$C26E,$BC72,$B777,$B27D,$AC83,$A78A
	dw $A192,$9C99,$97A0,$91A7,$8CAD,$86B2,$81B6,$7CB9
	dw $76BB,$71BD

DATA_06F857:
	dw $39C9,$36CC,$34D4,$34ED,$36F5,$39F8,$41F7,$49F6
	dw $51F5,$59F2,$61ED,$69E8,$71E1,$79D8,$81CF,$88C6
	dw $90BC,$98B3,$A0AA,$A8A3,$B09E,$B899,$C096,$C895
	dw $D094,$D794,$DA93,$DB92,$DB67,$DA66,$D765,$D066
	dw $C867,$C068,$B86B,$B070,$A875,$A07C,$9884,$908D
	dw $8897,$81A0,$79A9,$71B2,$69B9,$61BE,$59C3,$51C6
	dw $49C7,$41C8

DATA_06F8BB:
	dw $05CC,$02CF,$00D7,$00F0,$02F8,$05FB,$10FC,$1AFC
	dw $25FB,$2FF9,$3AF5,$44EF,$4FE7,$59DD,$64D2,$6EC7
	dw $79BC,$83B1,$8EA7,$989F,$A399,$AD95,$B893,$C292
	dw $CD92,$D794,$DA93,$DB92,$DB67,$DA66,$D765,$CD64
	dw $C264,$B865,$AD67,$A36B,$9871,$8E79,$8382,$798D
	dw $6E98,$64A3,$59AE,$4FB8,$44C0,$3AC6,$2FCA,$25CC
	dw $1ACD,$10CD

;---------------------------------------------------------------------------

UNK_06F91F:
	dl $520000
	dl $528000
	dl $52C000
	dl $530000
	dl $538000
	dl $53C000
	dl $540000
	dl $548000
	dl $550000
	dl $558000
	dl $560000
	dl $566000
	dl $568000
	dl $569000
	dl $56A000
	dl $56B000
	dl $56C000
	dl $56D000
	dl $56E800
	dl $56EC00
	dl $56FC00

;-------------------------------------------------------------------------
; LZ2-compressed graphics pointer table. (Cart asm + framework call this
; format "lz1"; verified 2026-05-26 it's actually LC_LZ2 — see
; yi/SuperFX/Banks/Bank08.asm header on CODE_lz2_decompress.)
; Indexed by an 8-bit file ID (* 3 for the 3-byte stride). Each entry is
; a 24-bit `dl` pointer into the LZ2 source-data region (SuperFX-mapped
; banks $57+ / LoROM PC $2EBC00-$39BA88). Read via `LDA.l DATA_06F95E,x`
; + `LDA.l DATA_06F95E+$02,x` to load the source address into SuperFX R9
; and the source bank into R4 before invoking FXCODE_08A980 (the LZ2
; decompressor; stages output at SRAM $70:5800).
; Consumers:
;   CODE_00B54D (CODE_decompress_lc_lz2) -- in-level LZ-load dispatcher
;   CODE_00B753                          -- second LZ2 caller (gfx size query)
; See docs/enginecore.md Sec. 6 and docs/mchip.md Sec. 3.2.
;-------------------------------------------------------------------------
DATA_06F95E:
DATA_lz2_compressed_gfx_ptrs:                                    ; 265 dl entries; LZ2 source-pointer table (Lunar Compress FORMAT=1). 8-bit file ID * 3 = byte offset; each entry points into LZ2 source region in SuperFX banks $57+. Read via LDA.l DATA_lz2_compressed_gfx_ptrs,x + ,x+$02 into SuperFX R9/R4 before JSL'ing FXCODE_08A980 (CODE_lz2_decompress) which stages output at SRAM $70:5800. See docs/enginecore.md Sec. 6.
	dl DATA_573C00
	dl DATA_5748E9
	dl DATA_57555B
	dl DATA_576234
	dl DATA_576EAB
	dl DATA_5778F9
	dl DATA_57826C
	dl DATA_578DB8
	dl DATA_579952
	dl DATA_57A56A
	dl DATA_57AECB
	dl DATA_57B9B0
	dl DATA_57C271
	dl DATA_57CEA1
	dl DATA_57DBBA
	dl DATA_57E85A
	dl DATA_57F3C7
	dl DATA_57F85E
	dl DATA_57FDEA
	dl DATA_58025D
	dl DATA_5803E1
	dl DATA_5808D6
	dl DATA_580C65
	dl DATA_580FCD
	dl DATA_5814E1
	dl DATA_581B2C
	dl DATA_581FDA
	dl DATA_5822D0
	dl DATA_58285E
	dl DATA_582FC1
	dl DATA_5835E2
	dl DATA_583C34
	dl DATA_584016
	dl DATA_58451B
	dl DATA_584A74
	dl DATA_584FBF
	dl DATA_585A68
	dl DATA_586597
	dl DATA_58720F
	dl DATA_587E21
	dl DATA_5883AF
	dl DATA_5888CD
	dl DATA_588E8F
	dl DATA_589574
	dl DATA_589AE6
	dl DATA_589D4F
	dl DATA_589FC4
	dl DATA_58A2CD
	dl DATA_58A5D2
	dl DATA_58B241
	dl DATA_58BE20
	dl DATA_58C992
	dl DATA_58D774
	dl DATA_58E471
	dl DATA_58EE33
	dl DATA_58F928
	dl DATA_5902AB
	dl DATA_590E7D
	dl DATA_591A64
	dl DATA_592757
	dl DATA_593432
	dl DATA_5941AC
	dl DATA_594E69
	dl DATA_595892
	dl DATA_5964EC
	dl DATA_597241
	dl DATA_597F14
	dl DATA_598ABB
	dl DATA_5996AF
	dl DATA_599C37
	dl DATA_59A7C1
	dl DATA_59B3E4
	dl DATA_59C08B
	dl DATA_59CD17
	dl DATA_59D92C
	dl DATA_59ED9E
	dl DATA_5A05C4
	dl DATA_5A1135
	dl DATA_5A17A3
	dl DATA_5A1CED
	dl DATA_5A235C
	dl DATA_5A28D6
	dl DATA_5A2EE2
	dl DATA_5A3453
	dl DATA_5A3944
	dl DATA_5A4110
	dl DATA_5A4608
	dl DATA_5A4C5F
	dl DATA_5A53A6
	dl DATA_5A5905
	dl DATA_5A5E25
	dl DATA_5A64A1
	dl DATA_5A6952
	dl DATA_5A6DE8
	dl DATA_5A736D
	dl DATA_5A7994
	dl DATA_5A8748
	dl DATA_5A9257
	dl DATA_5A97E0
	dl DATA_5A9C3D
	dl DATA_5AA0EF
	dl DATA_5AA75A
	dl DATA_5AAD40
	dl DATA_5AB189
	dl DATA_5AB630
	dl DATA_5ABC4D
	dl DATA_5ACAD1
	dl DATA_5AD992
	dl DATA_5AE7A0
	dl DATA_5AF2D5
	dl DATA_5AFE28
	dl DATA_5B03C0
	dl DATA_5B08CC
	dl DATA_5B0C94
	dl DATA_5B121D
	dl DATA_5B17A1
	dl DATA_5B1A25
	dl DATA_5B1CC2
	dl DATA_5B2058
	dl DATA_5B2323
	dl DATA_5B25DB
	dl DATA_5B278F
	dl DATA_5B28B2
	dl DATA_5B2A43
	dl DATA_5B2BAB
	dl DATA_5B2EA9
	dl DATA_5B32B7
	dl DATA_5B35C3
	dl DATA_5B3942
	dl DATA_5B3C69
	dl DATA_5B40C4
	dl DATA_5B457B
	dl DATA_5B4937
	dl DATA_5B4D88
	dl DATA_5B51E9
	dl DATA_5B561D
	dl DATA_5B5A43
	dl DATA_5B5DE5
	dl DATA_5B6042
	dl DATA_5B6270
	dl DATA_5B6446
	dl DATA_5B6718
	dl DATA_5B69A5
	dl DATA_5B6C06
	dl DATA_5B6DDC
	dl DATA_5B70B5
	dl DATA_5B7361
	dl DATA_5B75AB
	dl DATA_5B77F0
	dl DATA_5B7AA3
	dl DATA_5B7B89
	dl DATA_5B7D18
	dl DATA_5B7EBC
	dl DATA_5B8070
	dl DATA_5B83C7
	dl DATA_5B85A0
	dl DATA_5B8C16
	dl DATA_5B8CE5
	dl DATA_5B8D8F
	dl DATA_5B8E39
	dl DATA_5B8F62
	dl DATA_5B9179
	dl DATA_5B92A1
	dl DATA_5B92AD
	dl DATA_5B93BC
	dl DATA_5B93C8
	dl DATA_5B94C1
	dl DATA_5B9588
	dl DATA_5B9669
	dl DATA_5B9A2E
	dl DATA_5B9BF5
	dl DATA_5B9F48
	dl DATA_5BA1BE
	dl DATA_5BA405
	dl DATA_5BA6A5
	dl DATA_5BA99E
	dl DATA_5BAD4E
	dl DATA_5BAE23
	dl DATA_5BBAC5
	dl DATA_5BBE47
	dl DATA_5BC472
	dl DATA_5BCB3F
	dl DATA_5BD161
	dl DATA_5BD781
	dl DATA_5BDC95
	dl DATA_5BE14B
	dl DATA_5BE7E6
	dl DATA_5BEDDD
	dl DATA_5BF3C3
	dl DATA_5BF986
	dl DATA_5BFCA8
	dl DATA_5C0892
	dl DATA_5C0BEA
	dl DATA_5C12CD
	dl DATA_5C145A
	dl DATA_5C1996
	dl DATA_5C1BFA
	dl DATA_5C1DA2
	dl DATA_5C1ED3
	dl DATA_5C24BA
	dl DATA_5C2658
	dl DATA_5C28B0
	dl DATA_5C2A9D
	dl DATA_5C340D
	dl DATA_5C3545
	dl DATA_5C3A30
	dl DATA_5C3D29
	dl DATA_5C3EDA
	dl DATA_5C437B
	dl DATA_5C4711
	dl DATA_5C490A
	dl DATA_5C50AB
	dl DATA_5C532C
	dl DATA_5C5727
	dl DATA_5C573B
	dl DATA_5C5839
	dl DATA_5C5CA3
	dl DATA_5C5D18
	dl DATA_5C6148
	dl DATA_5C63B8
	dl DATA_5C654D
	dl DATA_5C6564
	dl DATA_5C6790
	dl DATA_5C69A5
	dl DATA_5C6C1C
	dl DATA_5C6E1A
	dl DATA_5C6E26
	dl DATA_5C6E32
	dl DATA_5C6E3E
	dl DATA_5C7083
	dl DATA_5C7170
	dl DATA_5C7532
	dl DATA_5C7782
	dl DATA_5C7A54
	dl DATA_5C7C40
	dl DATA_5C7D9D
	dl DATA_5C7FD3
	dl DATA_5C84DD
	dl DATA_5C84EE
	dl DATA_5C8653
	dl DATA_5C86E9
	dl DATA_5C8892
	dl DATA_5C8A60
	dl DATA_5C8DA4
	dl DATA_5C8DC6
	dl DATA_5C8EF6
	dl DATA_5C9024
	dl DATA_5C90C8
	dl DATA_5C9456
	dl DATA_5C94CD
	dl DATA_5C97A4
	dl DATA_5C981D
	dl DATA_5C98D3
	dl DATA_5C9AC1
	dl DATA_5C9D51
	dl DATA_5CA15C
	dl DATA_5CA51B
	dl DATA_5CA62A
	dl DATA_5CA824
	dl DATA_5CACB2
	dl DATA_5CAF37
	dl DATA_5CB2B0
	dl DATA_5CB518
	dl DATA_5CB71B
	dl DATA_5CB929

;-------------------------------------------------------------------------
; LZ16-compressed graphics pointer table.
; Indexed by an 8-bit file ID (* 3 for the 3-byte stride). 187 entries
; covering all LZ16 files. Each entry is a 24-bit `dl` pointer into the
; LZ16 source-data region (SuperFX-mapped banks $5C+ / LoROM PC
; $39BA89-$3F8A36). Read via `LDA.l DATA_06FC79,x` + `+$02,x` to load the
; source address into SuperFX R1 and bank into R0 before invoking
; FXCODE_0A8000 (the LZ16 decompressor; streams output directly into the
; target VRAM destination set by scene_gfx_layout).
; Consumer:
;   CODE_00B544-area (LZ16 branch of CODE_decompress_gfx_file)
; See docs/enginecore.md Sec. 6 and docs/mchip.md Sec. 3.2.
;-------------------------------------------------------------------------
DATA_06FC79:
DATA_lz16_compressed_gfx_ptrs:                                   ; 187 dl entries; LZ16 source-pointer table (Lunar Compress FORMAT=15). 8-bit file ID * 3 = byte offset; each entry points into LZ16 source region in SuperFX banks $5C+. Read via LDA.l DATA_lz16_compressed_gfx_ptrs,x + ,x+$02 into SuperFX R1/R0 before JSL'ing FXCODE_0A8000 (CODE_lz16_decompress) which streams output directly into the VRAM destination set by scene_gfx_layout. See docs/enginecore.md Sec. 6.
	dl DATA_5CBA89
	dl DATA_5CC342
	dl DATA_5CCB44
	dl DATA_5CD671
	dl DATA_5CDFC6
	dl DATA_5CE630
	dl DATA_5CEEE1
	dl DATA_5CF376
	dl DATA_5CF91E
	dl DATA_5CFF0B
	dl DATA_5D04ED
	dl DATA_5D0FEB
	dl DATA_5D180F
	dl DATA_5D1FFF
	dl DATA_5D26DE
	dl DATA_5D2F69
	dl DATA_5D351B
	dl DATA_5D3A65
	dl DATA_5D3F7A
	dl DATA_5D4050
	dl DATA_5D46D0
	dl DATA_5D4B93
	dl DATA_5D511D
	dl DATA_5D57EE
	dl DATA_5D5D3A
	dl DATA_5D6469
	dl DATA_5D6ACF
	dl DATA_5D6C99
	dl DATA_5D6DAC
	dl DATA_5D6EA2
	dl DATA_5D7033
	dl DATA_5D728B
	dl DATA_5D7466
	dl DATA_5D7623
	dl DATA_5D7810
	dl DATA_5D79BB
	dl DATA_5D7B30
	dl DATA_5D7C85
	dl DATA_5D7E57
	dl DATA_5D80A3
	dl DATA_5D82C8
	dl DATA_5D845B
	dl DATA_5D86B4
	dl DATA_5D87F8
	dl DATA_5D8990
	dl DATA_5D8B43
	dl DATA_5D8D2D
	dl DATA_5D8E69
	dl DATA_5D8FC6
	dl DATA_5D90F8
	dl DATA_5D9242
	dl DATA_5D93BD
	dl DATA_5D952A
	dl DATA_5D969C
	dl DATA_5D98F0
	dl DATA_5D9AEC
	dl DATA_5D9C49
	dl DATA_5D9DC6
	dl DATA_5D9FFA
	dl DATA_5DA191
	dl DATA_5DA389
	dl DATA_5DA536
	dl DATA_5DA714
	dl DATA_5DA960
	dl DATA_5DAB59
	dl DATA_5DACF1
	dl DATA_5DAE74
	dl DATA_5DAFBA
	dl DATA_5DB0F3
	dl DATA_5DB321
	dl DATA_5DB48B
	dl DATA_5DB5F0
	dl DATA_5DB80E
	dl DATA_5DBA3E
	dl DATA_5DBC21
	dl DATA_5DBDC1
	dl DATA_5DBF2C
	dl DATA_5DC0DF
	dl DATA_5DC1EC
	dl DATA_5DC3EF
	dl DATA_5DC58C
	dl DATA_5DC70B
	dl DATA_5DC885
	dl DATA_5DC947
	dl DATA_5DCA3E
	dl DATA_5DCC2E
	dl DATA_5DCE2B
	dl DATA_5DCFDF
	dl DATA_5DD119
	dl DATA_5DD286
	dl DATA_5DD445
	dl DATA_5DD5FB
	dl DATA_5DD7C6
	dl DATA_5DD930
	dl DATA_5DDAF4
	dl DATA_5DDCCE
	dl DATA_5DDE10
	dl DATA_5DDFB0
	dl DATA_5DE0E8
	dl DATA_5DE1DC
	dl DATA_5DE3A5
	dl DATA_5DE581
	dl DATA_5DE6E9
	dl DATA_5DE8AE
	dl DATA_5DEA53
	dl DATA_5DEC4C
	dl DATA_5DEDF4
	dl DATA_5DEFCA
	dl DATA_5DF13D
	dl DATA_5DF2C3
	dl DATA_5DF399
	dl DATA_5DF4BE
	dl DATA_5DF5A6
	dl DATA_5DF70A
	dl DATA_5DF804
	dl DATA_5E03D3
	dl DATA_5E0596
	dl DATA_5E0750
	dl DATA_5E0956
	dl DATA_5E0AB6
	dl DATA_5E0F30
	dl DATA_5E16FA
	dl DATA_5E1DD1
	dl DATA_5E2450
	dl DATA_5E2E3F
	dl DATA_5E3939
	dl DATA_5E3E16
	dl DATA_5E42AC
	dl DATA_5E4D55
	dl DATA_5E57A7
	dl DATA_5E5E4B
	dl DATA_5E6583
	dl DATA_5E6AAE
	dl DATA_5E70E0
	dl DATA_5E77FD
	dl DATA_5E829F
	dl DATA_5E9360
	dl DATA_5EA7C0
	dl DATA_5EBA21
	dl DATA_5EC639
	dl DATA_5ED157
	dl DATA_5ED7BE
	dl DATA_5EE3D2
	dl DATA_5EE999
	dl DATA_5EEC88
	dl DATA_5EF3B1
	dl DATA_5EF5DC
	dl DATA_5EF845
	dl DATA_5EFA6E
	dl DATA_5EFCD6
	dl DATA_5EFEFF
	dl DATA_5F01FE
	dl DATA_5F0576
	dl DATA_5F0922
	dl DATA_5F0BBB
	dl DATA_5F10E1
	dl DATA_5F15BA
	dl DATA_5F1960
	dl DATA_5F1D97
	dl DATA_5F21AB
	dl DATA_5F25FB
	dl DATA_5F2948
	dl DATA_5F2CAC
	dl DATA_5F2EB0
	dl DATA_5F3352
	dl DATA_5F3A70
	dl DATA_5F4013
	dl DATA_5F45B7
	dl DATA_5F4D68
	dl DATA_5F5485
	dl DATA_5F55D7
	dl DATA_5F5742
	dl DATA_5F5942
	dl DATA_5F5B92
	dl DATA_5F5D48
	dl DATA_5F5F21
	dl DATA_5F6126
	dl DATA_5F62D2
	dl DATA_5F6925
	dl DATA_5F6E88
	dl DATA_5F725C
	dl DATA_5F7906
	dl DATA_5F7AC9
	dl DATA_5F7CE1
	dl DATA_5F7EA6
	dl DATA_5F80B8
	dl DATA_5F8589

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($06FEAA, incbin, DATA_06FEAA_YI_U2.bin)
else
	%FREE_BYTES($06FEAA, 342, $FF)
endif
%BANK_END(<EndBank>)
endmacro
