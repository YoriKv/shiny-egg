;#############################################################################################################
;# Bank0D.asm -- normal-sprite Init/Main handlers (SNES bank $0D, mirror $8D).
;#
;# A continuation of Bank0C -- more sprite handlers, plus one of the largest set pieces in
;# the game: the Baby Bowser boss fight ($134) and its supporting prop sprites
;# ($08E BowserRoomKamek, $128 GroundRipple, $0CF BowserRocks, $026 BowserFightGiantEgg,
;# $0CE BowserFire, $008 FallingRubble, $0AC FallingRockArrowAndShadow). Together those
;# eight sprites occupy roughly the back half of the bank.
;#
;# Contents at a glance:
;#   $101/$102 Rotating Mace / Double Rotating Mace -- $0D8002 / $0D801C
;#   $105/$106 Boo Guys carrying bombs (L/R)        -- $0D8085 / $0D8164
;#   $10C ChainedSpikeBall                          -- $0D8385 / $0D83EE
;#   $003/$10E CrateWithKey / CrateWith6Stars       -- $0D85FE / $0D862F  (shared)
;#   $126 SpikedLogOnPulley                         -- $0D8B36 / $0D8B91
;#   $127 PulleyOfSpikedLog                         -- $0D8CDC / $0D8CE2
;#   $135/$136 CirclingRaven                        -- $0D8DC5 / $0D8DE9  (shared)
;#   $13C DownFlippers                              -- $0D9241 / $0D9258
;#   $144 RightOrLeftFlippers                       -- $0D957B / $0D9591
;#   $154 SharkChomp                                -- $0D9C81 / $0D9D2E
;#   $15C/$15D Green/Red rotating platform switch   -- $0DA53D / $0DA552
;#   $15F/$160 Green/Red SpikedPlatform             -- $0DA579 / $0DA5C0
;#   $162 DoubleSpikePlatformWithSwitch             -- $0DA8DE / $0DA901
;#   $076/$077 Clockwise/CCW Piro Dangle            -- $0DB59C / $0DB5C2
;#   $06D/$06E Clockwise/CCW Hootie                 -- $0DBE8E / $0DBEC6
;#   $03A/$03B MiniRaven (3-pack / single)          -- $0DD060 / $0DD0BF
;#   $180 SpinningLog                               -- $0DD3F1 / $0DD418
;#   $0DA FlowerPot                                 -- $0DD685 / $0DD703
;#   $11C LakituCloud                               -- $0DDB7C / $0DDB99
;#   $109/$10A/$10B TapTap family                   -- $0DE34D / $0DE3A8
;#   $134 BabyBowser (boss fight)                   -- $0DC50C / $0DC55B
;#       RideYoshiRt at $0DE9F9 (cinematic mounted-on-Yoshi intro)
;#   $08E BowserRoomKamek                           -- $0DEAD3 / $0DEB70
;#   $128 GroundRippleInBabyBowserRoom              -- $0DF02C / $0DF038
;#   $0CF BowserRocks (BG quake)                    -- (init) / $0DF6FE main
;#   $026 BowserFightGiantEgg, $0CE BowserFire, $008 FallingRubble,
;#   $0AC FallingRockArrowAndShadow                 -- end-of-bank cluster
;#       (Init/Main pairs run through end of bank at ~$0DFBC2).
;#
;# Cross-references:
;#   yoshisisland-disassembly/disassembly/bank0D.asm -- Raidenthequick's V1.0 disassembly,
;#       with descriptive names for ~45 sprite handlers and most of the Baby Bowser fight.
;#   docs/spritestateengine.md                       -- sprite engine architecture + ID space.
;#   ../Constants/NormalSpriteIDs.asm                -- ID -> name defines.
;#   see also: ys_enmy*.asm (enemy/sprite handlers split across ys_enmy.asm..ys_enmy14.asm).
;#
;# CODE_0D8000 is a tiny 2-byte helper (TYX/RTS) used by other banks as a JSL-shared
;# register-shuffle stub. It predates the first sprite handler -- not part of any sprite.
;#############################################################################################################

macro YIBank0DMacros(StartBank, EndBank)
%BANK_START(<StartBank>)

;---------------------------------------------------------------------------
; CODE_0D8000: 2-byte shared register-shuffle stub. TYX / RTS.
; Called as JSL from foreign banks that need Y -> X in 16-bit register state.
;---------------------------------------------------------------------------
CODE_0D8000:
	TYX
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprites $101 / $102: Single and double rotating spiky mace.
; Raiden: init_spiky_mace (handles both via extra-info distinction).
;---------------------------------------------------------------------------
YI_NorSpr101_RotatingMace_Init:
YI_NorSpr102_DoubleRotatingMace_Init:
init_spiky_mace:
;$0D8002
	JSL.l CODE_03AE60
	LDA.w $7722,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSL.l CODE_03AD74
	BCS.b CODE_0D801C
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7722,x
	JML.l CODE_03A31E

CODE_0D801C:
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	STA.w $7400,x
	DEC
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	JSR.w CODE_0D82C0
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprites $101 / $102 main (shared). Raiden: main_spiky_mace.
;---------------------------------------------------------------------------
YI_NorSpr101_RotatingMace_Main:
YI_NorSpr102_DoubleRotatingMace_Main:
main_spiky_mace:
;$0D8031
	STZ.w $7400,x
	JSR.w CODE_0D8065
	JSL.l CODE_03AF23
	JSL.l CODE_despawn_sprite
	BCC.b CODE_0D804C
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7722,x
	JSL.l CODE_03AEFD
	RTL

CODE_0D804C:
	JSR.w CODE_0D821E
	JSR.w CODE_0D82B1
	LDA.w $7A96,x
	BNE.b CODE_0D8064
	LDA.w #$0008
	STA.w $7A96,x
	LDA.w #!Define_YI_SoundID1B_MaceTick
	JSL.l CODE_push_sound_queue
CODE_0D8064:
	RTL

CODE_0D8065:
	JSL.l CODE_03AA52
	LDA.w $7722,x
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7722,x
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0020
	TAY
	JSL.l CODE_03AA60
	PLA
	STA.w $7722,x
	REP.b #$10
	LDY.w $7362,x
	LDA.w $6024,y
	STA.w $6044,y
	LDA.w $602C,y
	STA.w $604C,y
	LDA.w $6034,y
	STA.w $6054,y
	LDA.w $603C,y
	STA.w $605C,y
	SEP.b #$10
	LDA.w #$FFE9
	STA.b $00
	LDA.w $7A38,x
	EOR.w #$FFFF
	INC
	AND.w #$01FE
	STA.b $02
	LDX.b #$00
	LDY.b #$02
CODE_0D80B9:
	LDA.b $00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $02
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	PHX
	PHY
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLY
	PLX
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $04,x
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.b $08,x
	LDA.b $00
	CLC
	ADC.w #$FFC8
	STA.b $00
	INX
	INX
	DEY
	BNE.b CODE_0D80B9
	LDX.b $12
	LDA.b $04
	STA.b $18,x
	LDA.b $06
	STA.b $76,x
	LDA.b $08
	STA.b $78,x
	LDA.b $0A
	STA.w $7A36,x
	REP.b #$10
	LDY.w $7362,x
	LDA.w $7CD6,x
	SEC
	SBC.w $6094
	STA.b $00
	LDA.w $7CD8,x
	SEC
	SBC.w $609C
	STA.b $02
	LDX.w #$0002
CODE_0D8114:
	LDA.b $04,x
	STA.b $0C
	LDA.b $08,x
	STA.b $0E
	JSR.w CODE_0D81F3
	TYA
	CLC
	ADC.w #$0020
	TAY
	DEX
	DEX
	BPL.b CODE_0D8114
	LDA.b $04
	CLC
	ADC.b $06
	CMP.w #$8000
	ROR
	STA.b $0C
	LDA.b $08
	CLC
	ADC.b $0A
	CMP.w #$8000
	ROR
	STA.b $0E
	JSR.w CODE_0D81F3
	SEP.b #$10
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr101_RotatingMace
	BNE.b CODE_0D814F
	RTS

CODE_0D814F:
	REP.b #$10
	LDY.w $7362,x
	LDA.w $6004,y
	ORA.w #$C000
	STA.w $60BC,y
	LDA.w $600C,y
	ORA.w #$C000
	STA.w $60B4,y
	LDA.w $6014,y
	ORA.w #$C000
	STA.w $60AC,y
	LDA.w $601C,y
	ORA.w #$C000
	STA.w $60A4,y
	LDA.w $6024,y
	ORA.w #$C000
	STA.w $607C,y
	STA.w $609C,y
	LDA.w $602C,y
	ORA.w #$C000
	STA.w $6074,y
	STA.w $6094,y
	LDA.w $6034,y
	ORA.w #$C000
	STA.w $606C,y
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror,y
	LDA.w $603C,y
	ORA.w #$C000
	STA.w $6064,y
	STA.w $6084,y
	LDX.w #$0006
CODE_0D81AB:
	LDA.b $04,x
	EOR.w #$FFFF
	INC
	STA.b $04,x
	DEX
	DEX
	BPL.b CODE_0D81AB
	TYA
	CLC
	ADC.w #$00A0
	TAY
	LDX.w #$0002
CODE_0D81C0:
	LDA.b $04,x
	STA.b $0C
	LDA.b $08,x
	STA.b $0E
	JSR.w CODE_0D81F3
	TYA
	SEC
	SBC.w #$0020
	TAY
	DEX
	DEX
	BPL.b CODE_0D81C0
	LDA.b $04
	CLC
	ADC.b $06
	CMP.w #$8000
	ROR
	STA.b $0C
	LDA.b $08
	CLC
	ADC.b $0A
	CMP.w #$8000
	ROR
	STA.b $0E
	JSR.w CODE_0D81F3
	SEP.b #$10
	LDX.b $12
	RTS

CODE_0D81F3:
	LDA.b $00
	CLC
	ADC.b $0E
	STA.w $6008,y
	STA.w $6018,y
	SEC
	SBC.w #$0010
	STA.w $6000,y
	STA.w $6010,y
	LDA.b $02
	CLC
	ADC.b $0C
	STA.w $6012,y
	STA.w $601A,y
	SEC
	SBC.w #$0010
	STA.w $6002,y
	STA.w $600A,y
	RTS

CODE_0D821E:
	LDA.b $18,x
	STA.b $00
	LDA.b $76,x
	STA.b $02
	CLC
	ADC.b $00
	CMP.w #$8000
	ROR
	STA.b $04
	LDA.b $78,x
	STA.b $06
	LDA.w $7A36,x
	STA.b $08
	CLC
	ADC.b $06
	CMP.w #$8000
	ROR
	STA.b $0A
	LDA.w $7C16,x
	STA.b $0C
	LDA.w $7C18,x
	STA.b $0E
	LDA.w $6120
	CLC
	ADC.w #$000A
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	ASL
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $6122
	CLC
	ADC.w #$000A
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	ASL
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	JSR.w CODE_0D8284
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr101_RotatingMace
	BEQ.b CODE_0D8283
	LDX.b #$0A
CODE_0D8274:
	LDA.b $00,x
	EOR.w #$FFFF
	INC
	STA.b $00,x
	DEX
	DEX
	BPL.b CODE_0D8274
	JSR.w CODE_0D8284
CODE_0D8283:
	RTS

CODE_0D8284:
	LDX.b #$04
CODE_0D8286:
	LDA.b $06,x
	CLC
	ADC.b $0C
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CMP.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BCS.b CODE_0D82A2
	LDA.b $00,x
	CLC
	ADC.b $0E
	CLC
	ADC.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	CMP.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	BCC.b CODE_0D82A9
CODE_0D82A2:
	DEX
	DEX
	BPL.b CODE_0D8286
	LDX.b $12
	RTS

CODE_0D82A9:
	LDX.b $12
	JSL.l CODE_03A858
	PLA
	RTS

CODE_0D82B1:
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0001
	BNE.b CODE_0D833C
CODE_0D82C0:
	LDA.w $7A38,x
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	AND.w #$01FE
	STA.w $7A38,x
	LDA.w #FXDATA_550000+$00A0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$00A0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #FXDATA_550000+$00C0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$00C0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
CODE_0D833C:
	RTS

;---------------------------------------------------------------------------

DATA_0D833D:
	dw $FFE0,$0020

DATA_0D8341:
	dw $FFF0,$0020,$FFE0,$0010

DATA_0D8349:
	dw $FFF0,$0010

;---------------------------------------------------------------------------
; Sprite $105: Boo Guys carrying a bomb leftward. Raiden: init_boo_guys_carrying_bombs_left.
;---------------------------------------------------------------------------
YI_NorSpr105_BooGuysCarryingBombToLeft_Init:
init_boo_guys_carrying_bombs_left:
;$0D834D
	LDA.w #$0000
	BRA.b CODE_0D8355

;---------------------------------------------------------------------------
; Sprite $106: Boo Guys carrying a bomb rightward.
; Raiden: init_boo_guys_carrying_bombs_right.
;---------------------------------------------------------------------------
YI_NorSpr106_BooGuysCarryingBombToRight_Init:
init_boo_guys_carrying_bombs_right:
	LDA.w #$0002
CODE_0D8355:
	STA.w $7400,x
	STA.w $7A36,x
	ASL
	TAY
	LDA.w $70E2,x
	AND.w #$0010
	BEQ.b CODE_0D8367
	INY
	INY
CODE_0D8367:
	LDA.w $0EEF,y
	BEQ.b CODE_0D8370
	JML.l CODE_03A31E

CODE_0D8370:
	LDA.w #$0001
	STA.w $0EEF,y
	TYA
	ASL
	ASL
	ASL
	TAY
	STY.b $78,x
	LDA.w #$FFFF
	STA.w $0EF7,y
	STA.w $0EF9,y
	STA.w $0EFB,y
	STA.w $0EFD,y
	STA.w $0EFF,y
	STA.w $0F01,y
	STA.w $0F03,y
	STA.w $0F05,y
	INC
	STA.w $0F37,y
	STA.w $0F39,y
	STA.w $0F3B,y
	STA.w $0F3D,y
	STA.w $0F3F,y
	STA.w $0F41,y
	STA.w $0F43,y
	STA.w $0F45,y
	LDY.w $7400,x
	LDA.w DATA_0D8349,y
	CLC
	ADC.w $7CD6,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDY.b #$02
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$00B6
	BMI.b CODE_0D83DC
	CMP.w #$00BB
	BMI.b CODE_0D83DE
CODE_0D83DC:
	LDY.b #$00
CODE_0D83DE:
	LDX.b $12
	TYA
	EOR.w $7400,x
	TAY
	LDA.w DATA_0D833D,y
	STA.b $06
	LDA.w $7400,x
	BEQ.b CODE_0D83F5
	TYA
	CLC
	ADC.w #$0004
	TAY
CODE_0D83F5:
	LDA.w DATA_0D8341,y
	CLC
	ADC.w $7CD6,x
	STA.b $04
	STA.b $0A
	STZ.b $08
	LDA.w $7CD8,x
	STA.b $02
CODE_0D8407:
	LDA.b $02
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.b $04
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$00B6
	BMI.b CODE_0D8427
	CMP.w #$00BB
	BMI.b CODE_0D8432
CODE_0D8427:
	LDA.b $04
	CLC
	ADC.b $06
	STA.b $04
	INC.b $08
	BRA.b CODE_0D8407

CODE_0D8432:
	LDX.b $12
	LDY.b $08
	STY.b $18,x
	TYA
	CLC
	ADC.w #$0009
	ASL
	ASL
	ASL
	XBA
	ORA.w $7040,x
	STA.w $7040,x
	LDA.b $04
	SEC
	SBC.b $0A
	STA.b $00
	LDA.w $7400,x
	DEC
	EOR.b $00
	BPL.b CODE_0D8467
	LDA.w $70E2,x
	CLC
	ADC.b $00
	STA.w $70E2,x
	LDA.b $00
	EOR.w #$FFFF
	INC
	STA.b $00
CODE_0D8467:
	LDA.b $00
	EOR.w #$FFFF
	INC
	BMI.b CODE_0D847E
	CLC
	ADC.w #$0140
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$FFC0
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BRA.b CODE_0D848B

CODE_0D847E:
	SEC
	SBC.w #$0040
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0140
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_0D848B:
	LDY.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CPY.b #$06
	BEQ.b CODE_0D8496
	CPY.b #$0E
	BNE.b CODE_0D84A0
CODE_0D8496:
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w $7182,x
CODE_0D84A0:
	LDY.b #$10
	STY.b $16,x
	RTL

;---------------------------------------------------------------------------

DATA_0D84A5:
	dw CODE_0D8787
	dw CODE_0D88D0
	dw CODE_0D8997

;---------------------------------------------------------------------------
; Sprites $105 / $106 main (shared). Raiden: main_boo_guys_carrying_bombs.
;---------------------------------------------------------------------------
YI_NorSpr105_BooGuysCarryingBombToLeft_Main:
YI_NorSpr106_BooGuysCarryingBombToRight_Main:
main_boo_guys_carrying_bombs:
;$0D84AB
	JSR.w CODE_0D85B8
	JSL.l CODE_03AF23
	JSR.w CODE_0D8729
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0D84A5,x)
	JSR.w CODE_0D8757
	LDA.w $61C6
	BEQ.b CODE_0D84CF
	LDY.b $76,x
	BNE.b CODE_0D84CF
	LDY.b #$16
	STY.b $16,x
	INC.b $76,x
CODE_0D84CF:
	RTL

DATA_0D84D0:
	dw $0000,$0000,$0002,$0002,$0002,$0004,$0004,$0004
	dw $0004,$0004,$0004,$0002,$0002,$0002,$0002,$0000
	dw $0000,$0006,$0006,$0006,$0006,$0006,$0006,$0008
	dw $000A,$000C,$000C,$000A,$000E

DATA_0D850A:
	dw $4000,$4000,$4000,$4000,$4000,$4000,$4000,$4000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $4000,$4000,$0000,$0000,$0000

DATA_0D8544:
	dw $8000,$0010,$0010,$0010,$000F,$000D,$000A,$0006
	dw $0000,$FFFA,$FFF6,$FFF3,$FFF1,$FFF0,$FFF0,$FFF0
	dw $8000,$0000,$0000,$0000,$0000,$0000,$8000,$8000
	dw $8000,$8000,$8000,$8000,$8000

DATA_0D857E:
	dw $8000,$0000,$0000,$0000,$FFFF,$FFFE,$FFFD,$FFFD
	dw $FFFD,$FFFD,$FFFD,$FFFE,$FFFF,$0000,$0000,$0000
	dw $8000,$FFF9,$FFF6,$FFF4,$FFF3,$FFF2,$8000,$8000
	dw $8000,$8000,$8000,$8000,$8000

CODE_0D85B8:
	LDA.w $70E2,x
	SEC
	SBC.w $6094
	STA.b $00
	LDA.w $7182,x
	SEC
	SBC.w $609C
	STA.b $02
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr105_BooGuysCarryingBombToLeft
	BEQ.b CODE_0D85D6
	INY
	INY
CODE_0D85D6:
	LDA.w DATA_0D833D,y
	STA.b $04
	LDA.b $18,x
	STA.b $0E
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	REP.b #$10
	LDY.w $7362,x
	STY.b $06
	LDA.w #$8000
	STA.w $6000,y
	STA.w $6008,y
	STA.w $6010,y
	STA.w $6018,y
	STA.w $6020,y
	STA.w $6028,y
	STA.w $6030,y
	STA.w $6038,y
	TYA
	CLC
	ADC.w #$0040
	STA.b $0C
	TAY
	PHY
	LDA.b $16,x
	ASL
	TAY
	LDA.w DATA_0D84D0,y
	STA.b $08
	LDA.w DATA_0D850A,y
	STA.b $0A
	PLY
CODE_0D861C:
	LDA.b $00
	CLC
	ADC.w #$0040
	CMP.w #$0180
	BCC.b CODE_0D862C
	LDA.w #$8000
	BRA.b CODE_0D862E

CODE_0D862C:
	LDA.b $00
CODE_0D862E:
	STA.w $6000,y
	LDA.b $02
	STA.w $6002,y
	LDA.w $6004,y
	ORA.b $08
	EOR.b $0A
	STA.w $6004,y
	LDA.b $00
	CLC
	ADC.b $04
	STA.b $00
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEC.b $0E
	BPL.b CODE_0D861C
	LDY.b $08
	CPY.w #$0006
	BNE.b CODE_0D865B
	SEP.b #$10
	RTS

CODE_0D865B:
	LDA.w $7400,x
	STA.b $0A
	XBA
	ASL
	ASL
	ASL
	ASL
	ASL
	STA.b $08
	LDA.b $16,x
	SEC
	SBC.w #$0010
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	STZ.b $00
	LDA.w #$0007
	STA.b $0E
	ASL
	CLC
	ADC.b $78,x
	TAX
CODE_0D867D:
	LDA.w $0EF7,x
	BPL.b CODE_0D8685
	JMP.w CODE_0D871B

CODE_0D8685:
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	ASL
	ASL
	ASL
	CLC
	ADC.b $0C
	TAY
	PHX
	LDA.w $0F37,x
	PHA
	LDA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	BEQ.b CODE_0D86A5
	LDA.w #$8000
	STA.b $02
	PLA
	PHA
	CMP.w #$001C
	BNE.b CODE_0D86D4
CODE_0D86A5:
	PLA
	PHA
	ASL
	TAX
	LDA.w DATA_0D84D0,x
	ORA.w $6004,y
	AND.w #$BFFF
	ORA.b $08
	EOR.w DATA_0D850A,x
	STA.w $6004,y
	LDA.w DATA_0D857E,x
	CLC
	ADC.w $6002,y
	STA.b $04
	LDA.w DATA_0D8544,x
	LDX.b $0A
	BEQ.b CODE_0D86CE
	EOR.w #$FFFF
	INC
CODE_0D86CE:
	CLC
	ADC.w $6000,y
	STA.b $02
CODE_0D86D4:
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CMP.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BNE.b CODE_0D86DF
	PLA
	BRA.b CODE_0D8702

CODE_0D86DF:
	TYA
	CLC
	ADC.w #$0008
	TAY
	PLA
	SEC
	SBC.w #$000C
	BMI.b CODE_0D86F1
	CMP.w #$0004
	BMI.b CODE_0D86F4
CODE_0D86F1:
	LDA.w #$0000
CODE_0D86F4:
	ASL
	TAX
	LDA.w $6004,y
	EOR.w #$4000
	ORA.w DATA_0D84D0,x
	STA.w $6004,y
CODE_0D8702:
	LDA.b $06
	CLC
	ADC.b $00
	TAY
	LDA.b $04
	STA.w $6002,y
	LDA.b $02
	STA.w $6000,y
	LDA.b $00
	CLC
	ADC.w #$0008
	STA.b $00
	PLX
CODE_0D871B:
	DEX
	DEX
	DEC.b $0E
	BMI.b CODE_0D8724
	JMP.w CODE_0D867D

CODE_0D8724:
	LDX.b $12
	SEP.b #$10
	RTS

CODE_0D8729:
	LDA.w $7680,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BMI.b CODE_0D8736
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_0D8756
CODE_0D8736:
	JSL.l CODE_03A31E
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr105_BooGuysCarryingBombToLeft
	BEQ.b CODE_0D8746
CODE_0D8744:
	LDY.b #$04
CODE_0D8746:
	LDA.w $70E2,x
	AND.w #$0010
	BEQ.b CODE_0D8750
	INY
	INY
CODE_0D8750:
	LDA.w #$0000
	STA.w $0EEF,y
CODE_0D8756:
	RTS

CODE_0D8757:
	LDY.b #$07
	TYA
	ASL
	CLC
	ADC.b $78,x
	TAX
CODE_0D875F:
	LDA.w $0F77,x
	BEQ.b CODE_0D8767
	DEC.w $0F77,x
CODE_0D8767:
	DEX
	DEX
	DEY
	BPL.b CODE_0D875F
	LDX.b $12
	RTS

DATA_0D876F:
	db $02,$02,$03,$03,$02,$02,$02,$02,$02,$02,$02,$02,$02,$03,$03,$02
	db $02,$02,$02,$02,$02,$02,$08,$10

CODE_0D8787:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0D87B5
	LDA.w #$0100
	STA.w $7A96,x
	LDY.b #$07
	TYA
	ASL
	CLC
	ADC.b $78,x
	TAX
CODE_0D879B:
	LDA.w $0EF7,x
	BMI.b CODE_0D87A7
	DEX
	DEX
	DEY
	BPL.b CODE_0D879B
	BRA.b CODE_0D87B5

CODE_0D87A7:
	STZ.w $0EF7,x
	STZ.w $0F37,x
	LDA.w #$0003
	STA.w $0F77,x
	LDX.b $12
CODE_0D87B5:
	LDA.b $18,x
	STA.b $00
	LDA.w $7C16,x
	STA.b $02
	LDA.w $7400,x
	STA.b $04
	LDY.b #$07
	TYA
	ASL
	CLC
	ADC.b $78,x
	TAX
CODE_0D87CB:
	LDA.w $0EF7,x
	BMI.b CODE_0D87E0
	LDA.w $0F37,x
	CMP.w #$0011
	BMI.b CODE_0D87DD
	JSR.w CODE_0D87E8
	BRA.b CODE_0D87E0

CODE_0D87DD:
	JSR.w CODE_0D886A
CODE_0D87E0:
	DEX
	DEX
	DEY
	BPL.b CODE_0D87CB
	LDX.b $12
CODE_0D87E7:
	RTS

CODE_0D87E8:
	LDA.w $0F77,x
	BNE.b CODE_0D87E7
	INC.w $0F37,x
	PHY
	LDA.w $0F37,x
	CMP.w #$0016
	BNE.b CODE_0D885D
	LDA.w $0EF7,x
	STA.b $00
	PHX
	LDX.b $12
	LDA.w #$0060
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0D8854
	LDA.b $00
	ASL
	ASL
	ASL
	ASL
	ASL
	PHY
	LDY.w $7400,x
	BNE.b CODE_0D881B
	EOR.w #$FFFF
	INC
CODE_0D881B:
	PLY
	CLC
	ADC.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$000A
	STA.w $7182,y
	LDA.w #$001C
	STA.w $7A96,y
	LDA.w $7400,x
	STA.w $7400,y
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0030
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	SEP.b #$20
	LDA.b #$7F
	STA.w $7863,y
	REP.b #$20
	PLX
	LDA.w #$0016
	BRA.b CODE_0D88C4

CODE_0D8854:
	PLX
	DEC.w $0F37,x
	LDA.w #$0015
	BRA.b CODE_0D88C4

CODE_0D885D:
	CMP.w #$0018
	BNE.b CODE_0D88C4
	LDA.w #$FFFF
	STA.w $0EF7,x
	PLY
	RTS

CODE_0D886A:
	LDA.w $0F77,x
	BNE.b CODE_0D88CF
	INC.w $0F37,x
	PHY
	LDA.w $0F37,x
	CMP.w #$0009
	BNE.b CODE_0D88A8
	LDA.w $0EF7,x
	CMP.b $00
	BEQ.b CODE_0D88A0
	ASL
	ASL
	ASL
	ASL
	ASL
	LDY.b $04
	BNE.b CODE_0D888F
	EOR.w #$FFFF
	INC
CODE_0D888F:
	CLC
	ADC.b $02
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCC.b CODE_0D88A0
	LDA.w #$0009
	BRA.b CODE_0D88C4

CODE_0D88A0:
	LDA.w #$0011
	STA.w $0F37,x
	BRA.b CODE_0D88C4

CODE_0D88A8:
	CMP.w #$000E
	BNE.b CODE_0D88B6
	PHA
	LDA.w #!Define_YI_SoundID55_ThunderLakituAttacking5
	JSL.l CODE_push_sound_queue
	PLA
CODE_0D88B6:
	AND.w #$000F
	BNE.b CODE_0D88C4
	INC.w $0EF7,x
	LDA.w #$0004
	STA.w $0F37,x
CODE_0D88C4:
	TAY
	LDA.w DATA_0D876F,y
	AND.w #$00FF
	STA.w $0F77,x
	PLY
CODE_0D88CF:
	RTS

CODE_0D88D0:
	TYX
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7400,x
	STA.b $02
	LDA.w $7182,x
	STA.b $06
	LDY.b #$07
	TYA
	ASL
	CLC
	ADC.b $78,x
	TAX
CODE_0D88E8:
	LDA.w $0EF7,x
	BPL.b CODE_0D88F0
	JMP.w CODE_0D8972

CODE_0D88F0:
	PHX
	PHY
	ASL
	ASL
	ASL
	ASL
	ASL
	LDY.b $02
	BNE.b CODE_0D88FF
	EOR.w #$FFFF
	INC
CODE_0D88FF:
	CLC
	ADC.b $00
	STA.b $04
	LDA.w $0F37,x
	BIT.w #$000F
	BEQ.b CODE_0D8970
	CMP.w #$0016
	BPL.b CODE_0D8970
	ASL
	TAY
	LDA.w DATA_0D857E,y
	CLC
	ADC.b $06
	STA.b $08
	LDA.w DATA_0D8544,y
	LDY.b $02
	BEQ.b CODE_0D8926
	EOR.w #$FFFF
	INC
CODE_0D8926:
	CLC
	ADC.b $04
	STA.b $04
	LDX.b $12
	LDA.w #$0060
	JSL.l CODE_spawn_sprite_active
	BCS.b CODE_0D893B
	PLY
	PLX
	LDX.b $12
	RTS

CODE_0D893B:
	LDA.b $04
	STA.w $70E2,y
	LDA.b $08
	STA.w $7182,y
	LDA.w #$0020
	STA.w $7A96,y
	LDA.w $7400,x
	STA.w $7400,y
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0030
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	SEP.b #$20
	LDA.b #$7F
	STA.w $7863,y
	REP.b #$20
	PLY
	PLX
	LDA.w #$001C
	STA.w $0F37,x
	BRA.b CODE_0D8972

CODE_0D8970:
	PLY
	PLX
CODE_0D8972:
	DEX
	DEX
	DEY
	BMI.b CODE_0D897A
	JMP.w CODE_0D88E8

CODE_0D897A:
	LDX.b $12
	LDA.w #$00C0
	STA.w $7A96,x
	LDA.w #$0044
	STA.w $7A98,x
	LDA.w #$0040
	STA.w $7AF6,x
	LDA.w #$0001
	STA.w $7A36,x
	INC.b $76,x
	RTS

CODE_0D8997:
	TYX
	LDA.w $7AF6,x
	BNE.b CODE_0D89FE
	LDY.b $16,x
	CPY.b #$16
	BNE.b CODE_0D89A7
	LDY.b #$18
	STY.b $16,x
CODE_0D89A7:
	LDA.w $7A96,x
	BNE.b CODE_0D89CD
	LDY.b #$07
	TYA
	ASL
	CLC
	ADC.b $78,x
	TAX
CODE_0D89B4:
	LDA.w $0EF7,x
	BMI.b CODE_0D89BF
	LDA.w #$FFFF
	STA.w $0EF7,x
CODE_0D89BF:
	DEX
	DEX
	DEY
	BPL.b CODE_0D89B4
	LDX.b $12
	LDY.b #$10
	STY.b $16,x
	STZ.b $76,x
	RTS

CODE_0D89CD:
	LDA.w $7A98,x
	BNE.b CODE_0D89FE
	LDA.w #$0004
	STA.w $7A98,x
	LDA.b $16,x
	CLC
	ADC.w $7A36,x
	CMP.w #$0017
	BEQ.b CODE_0D89ED
	CMP.w #$001C
	BNE.b CODE_0D89FC
	LDA.w #$001A
	BRA.b CODE_0D89F0

CODE_0D89ED:
	LDA.w #$0019
CODE_0D89F0:
	PHA
	LDA.w $7A36,x
	EOR.w #$FFFF
	INC
	STA.w $7A36,x
	PLA
CODE_0D89FC:
	STA.b $16,x
CODE_0D89FE:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $10C: Chained spike ball. Raiden: init_chained_spike_ball.
;---------------------------------------------------------------------------
YI_NorSpr10C_ChainedSpikeBall_Init:
init_chained_spike_ball:
;$0D89FF
	LDA.w $0FB7
	BEQ.b CODE_0D8A14
	CPX.w $0FB7
	BMI.b CODE_0D8A0C
	STX.w $0FB7
CODE_0D8A0C:
	LDA.w $0FB9
	STA.w $7722,x
	BRA.b CODE_0D8A21

CODE_0D8A14:
	JSL.l CODE_03AE60
	STX.w $0FB7
	LDA.w $7722,x
	STA.w $0FB9
CODE_0D8A21:
	INC.w $0FBB
	LDA.w #$010D
	JSL.l CODE_spawn_sprite_active
	BCS.b CODE_0D8A39
	DEC.w $0FBB
	BNE.b CODE_0D8A35
	STZ.w $0FB7
CODE_0D8A35:
	JML.l CODE_03A31E

CODE_0D8A39:
	STY.b $18,x
	LDA.w $7182,x
	STA.w $7182,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.w $7A98,y
	CLC
	ADC.w $70E2,x
	STA.w $70E2,y
	CLC
	ADC.w #$0004
	STA.w $70E2,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7182,x
	CLC
	ADC.w #$0020
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_0ACDFA>>16
	LDA.w #FXCODE_0ACDFA
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R12_LOOPCounterLo
	CPY.b #$0B
	BPL.b CODE_0D8A85
	LDA.w #$8000
	BRA.b CODE_0D8A90

CODE_0D8A85:
	LDA.w #$0013
	SEC
	SBC.w !REGISTER_SuperFX_R12_LOOPCounterLo
	ASL
	ASL
	ASL
	ASL
CODE_0D8A90:
	STA.w $7A36,x
	STZ.w $7400,x
	LDA.w $7182,x
	CLC
	ADC.w #$0030
	STA.w $7182,x
	CPX.w $0FB7
	BNE.b CODE_0D8AE0
	LDA.w #FXDATA_550000+$00A0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$00A0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088293>>16
	LDA.w #FXCODE_088293
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
CODE_0D8AE0:
	LDA.w #$0008
	STA.w $7720,x
	RTL

;---------------------------------------------------------------------------

DATA_0D8AE7:
	dw CODE_0D8CB5
	dw CODE_0D8CFA
	dw CODE_0D8D36
	dw CODE_0D8DC4
	dw CODE_0D8E06

;---------------------------------------------------------------------------
; Sprite $10C main. Raiden: main_chained_spike_ball.
;---------------------------------------------------------------------------
YI_NorSpr10C_ChainedSpikeBall_Main:
main_chained_spike_ball:
;$0D8AF1
	JSR.w CODE_0D8B3B
	JSR.w CODE_0D8B8B
	JSL.l CODE_03AF23
	LDY.w $7D36,x
	BPL.b CODE_0D8B06
	JSL.l CODE_03A858
	BRA.b CODE_0D8B0A

CODE_0D8B06:
	JSL.l CODE_03A5B7
CODE_0D8B0A:
	JSL.l CODE_03A2C7
	BCC.b CODE_0D8B2F
	LDA.b $18,x
	TAX
	JSL.l CODE_03A31E
	LDX.b $12
	DEC.w $0FBB
	BNE.b CODE_0D8B25
	STZ.w $0FB7
	JSL.l CODE_03AEFD
CODE_0D8B25:
	LDA.w #$FFFF
	STA.w $7722,x
	JSL.l CODE_03A31E
CODE_0D8B2F:
	JSR.w CODE_0D8C4B
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0D8AE7,x)
	RTL

CODE_0D8B3B:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_0D8B8A
	LDY.b $18,x
	LDA.w $70E2,y
	CLC
	ADC.w #$0004
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7182,y
	CLC
	ADC.w #$0020
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_0ACDFA>>16
	LDA.w #FXCODE_0ACDFA
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R12_LOOPCounterLo
	CPY.b #$0B
	BPL.b CODE_0D8B7C
	LDA.w #$8000
	BRA.b CODE_0D8B87

CODE_0D8B7C:
	LDA.w #$0013
	SEC
	SBC.w !REGISTER_SuperFX_R12_LOOPCounterLo
	ASL
	ASL
	ASL
	ASL
CODE_0D8B87:
	STA.w $7A36,x
CODE_0D8B8A:
	RTS

CODE_0D8B8B:
	LDY.b $18,x
	LDA.w $7182,y
	SEC
	SBC.w $609C
	STA.b $04
	REP.b #$10
	LDY.w $7362,x
	LDA.w $7A36,x
	BPL.b CODE_0D8BAB
	LDA.w #$8000
	STA.w $6000,y
	STA.w $6008,y
	BRA.b CODE_0D8BC3

CODE_0D8BAB:
	CLC
	ADC.b $04
	STA.w $6002,y
	STA.w $600A,y
	LDA.w $6004,y
	AND.w #$FE00
	ORA.w #$00C0
	STA.w $6004,y
	STA.w $600C,y
CODE_0D8BC3:
	TYA
	CLC
	ADC.w #$0010
	PHA
	TAY
	JSL.l CODE_03AA60
	REP.b #$10
	PLA
	CLC
	ADC.w #$0020
	TAY
	LDA.w $7A38,x
	BEQ.b CODE_0D8BE3
	LDA.b $04
	CLC
	ADC.w #$007A
	BRA.b CODE_0D8BEA

CODE_0D8BE3:
	LDA.w $7182,x
	SEC
	SBC.w $609C
CODE_0D8BEA:
	STA.b $00
	CLC
	ADC.b $78,x
	SEC
	SBC.w #$0004
	STA.b $02
	STZ.b $06
	STZ.b $08
	LDA.w $7AF6,x
	BEQ.b CODE_0D8C04
	INC.b $06
	LDA.b $10
	STA.b $08
CODE_0D8C04:
	LDA.w #$000B
	STA.b $0E
CODE_0D8C09:
	LDA.b $02
	SEC
	SBC.w #$000A
	STA.b $02
	CMP.b $00
	BPL.b CODE_0D8C19
	CMP.b $04
	BPL.b CODE_0D8C21
CODE_0D8C19:
	LDA.w #$8000
	STA.w $6000,y
	BRA.b CODE_0D8C3E

CODE_0D8C21:
	LDA.b $08
	AND.w #$0003
	SEC
	SBC.b $06
	STA.b $0A
	ADC.b $02
	STA.w $6002,y
	LDA.w $6000,y
	CLC
	ADC.b $0A
	STA.w $6000,y
	LDA.b $08
	ROR
	STA.b $08
CODE_0D8C3E:
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEC.b $0E
	BNE.b CODE_0D8C09
	SEP.b #$10
	RTS

CODE_0D8C4B:
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LSR
	STA.b $00
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $02
	LDA.w $6120
	CLC
	ADC.w #$0008
	STA.b $04
	ASL
	STA.b $06
	LDA.w $70E2,x
	CLC
	ADC.w #$0009
	SEC
	SBC.w $611C
	STA.b $0C
	CLC
	ADC.b $04
	CMP.b $06
	BCS.b CODE_0D8CB4
	LDA.w $6122
	CLC
	ADC.b $00
	STA.b $08
	ASL
	STA.b $0A
	LDA.b $02
	SEC
	SBC.w $611E
	CLC
	ADC.b $08
	CMP.b $0A
	BCS.b CODE_0D8CB4
	LDA.b $04
	LDY.b $0D
	BMI.b CODE_0D8C9D
	EOR.w #$FFFF
	INC
CODE_0D8C9D:
	CLC
	ADC.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611C
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	JSL.l CODE_03A858
CODE_0D8CB4:
	RTS

CODE_0D8CB5:
	TYX
	LDA.b $78,x
	BEQ.b CODE_0D8CEE
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0D8CE3
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_0D8CE3
	LDY.b $18,x
	LDA.w #$000C
	STA.w $7402,y
	LDA.w #$0005
	STA.w $7A98,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.b #$02
	STY.b $76,x
	RTS

CODE_0D8CE3:
	LDA.w $7974
	AND.w #$0001
	BNE.b CODE_0D8CED
	DEC.b $78,x
CODE_0D8CED:
	RTS

CODE_0D8CEE:
	LDA.w #$FF80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $76,x
	RTS

CODE_0D8CFA:
	TYX
	LDA.w $7974
	AND.w #$0003
	BNE.b CODE_0D8D0A
	LDA.w #!Define_YI_SoundID2F_ClankSound8
	JSL.l CODE_push_sound_queue
CODE_0D8D0A:
	LDY.b $18,x
	LDA.w $7182,x
	SEC
	SBC.w $7182,y
	CMP.w #$0028
	BPL.b CODE_0D8D35
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$000C
	STA.w $7402,y
	LDA.w #$0005
	STA.w $7A98,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #$0008
	STA.w $7542,x
	INC.b $76,x
CODE_0D8D35:
	RTS

CODE_0D8D36:
	TYX
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	LDA.b $78,x
	SEC
	SBC.w $72C2,x
	BPL.b +
	LDA.w #$0000
+:
	STA.b $78,x
endif
	INC.w $7542,x
	LDA.w #$0040
	CMP.w $7542,x
	BPL.b CODE_0D8D45
	STA.w $7542,x
CODE_0D8D45:
	LDY.b $18,x
	LDA.w #$007A
	SEC
	SBC.w $7182,x
	CLC
	ADC.w $7182,y
	BPL.b CODE_0D8D77
	CLC
	ADC.w $7182,x
	STA.w $7182,x
	LDA.w #!Define_YI_SoundID1B_MaceTick
	JSL.l CODE_push_sound_queue
	LDA.w $7A38,x
	BNE.b CODE_0D8DB2
	INC.w $7A38,x
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0010
	STA.w $7AF6,x
	RTS

CODE_0D8D77:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0D8DC3
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #!Define_YI_AmbSpr1F1
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7142,y
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #$0020
	STA.w $61C6
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
CODE_0D8DB2:
	STZ.w $7A38,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w #$0010
	STA.w $7AF6,x
	INC.b $76,x
CODE_0D8DC3:
	RTS

CODE_0D8DC4:
	TYX
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0D8DD8
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_0D8DD8
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEC.b $76,x
	RTS

CODE_0D8DD8:
	LDA.b $78,x
	CLC
	ADC.w #$0004
	STA.b $78,x
	LDY.b $18,x
	LDA.w #$007A
	SEC
	SBC.w $7182,x
	CLC
	ADC.w $7182,y
	SEC
	SBC.b $78,x
	BPL.b CODE_0D8E05
	CLC
	ADC.b $78,x
	STA.b $78,x
	LDA.w #$0003
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #$0020
	STA.w $7A96,x
	INC.b $76,x
CODE_0D8E05:
	RTS

CODE_0D8E06:
	TYX
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0D8E30
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_0D8E30
	LDY.b $18,x
	LDA.w #$000C
	STA.w $7402,y
	LDA.w #$0005
	STA.w $7A98,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.b #$02
	STY.b $76,x
	RTS

CODE_0D8E30:
	LDA.w $7A96,x
	BNE.b CODE_0D8E5F
	LDY.b $18,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CMP.w #$0003
	BEQ.b CODE_0D8E47
	CMP.w #$0005
	BNE.b CODE_0D8E5F
	STZ.b $76,x
	RTS

CODE_0D8E47:
	LDA.w #$0005
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	LDA.w #$0014
	STA.w $7402,y
	LDA.w #$0010
	STA.w $7A98,y
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
CODE_0D8E5F:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprites $003 / $10E: Wooden crate. $003 spawns a key on stomp, $10E spawns
; 6 stars. Raiden: init_crate.
;---------------------------------------------------------------------------
YI_NorSpr003_CrateWithKey_Init:
YI_NorSpr10E_CrateWith6Stars_Init:
init_crate:
;$0D8E60
	JSL.l CODE_03AE60
	LDA.w #$0100
	STA.w $7A36,x
	LDY.b $16,x
	BNE.b CODE_0D8E84
	LDA.w $70E2,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $04
	LDA.w $7182,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSL.l CODE_03D400
	BEQ.b CODE_0D8E84
	INC.b $79,x
CODE_0D8E84:
	LDA.w #$FFFA
	STA.w $7720,x
	LDY.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CPY.b #$03
	BEQ.b CODE_0D8E95
	CPY.b #$0D
	BNE.b CODE_0D8EA9
CODE_0D8E95:
	LDY.b #$04
	STY.b $19,x
	LDA.w #$FFF2
	STA.w $7720,x
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7182,x
CODE_0D8EA9:
	STZ.w $7400,x
	JSR.w CODE_0D9111
	RTL

;---------------------------------------------------------------------------

DATA_0D8EB0:
	dw CODE_0D8000
	dw CODE_0D917B
	dw CODE_0D918F
	dw CODE_0D91A3
	dw CODE_0D91B7
	dw CODE_0D93BE
	dw CODE_0D93C9

;---------------------------------------------------------------------------
; Sprites $003 / $10E main (shared). Raiden: main_crate.
;---------------------------------------------------------------------------
YI_NorSpr003_CrateWithKey_Main:
YI_NorSpr10E_CrateWith6Stars_Main:
main_crate:
;$0D8EBE
	JSR.w CODE_0D8F27
	JSL.l CODE_03AF23
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JSR.w CODE_0D8F38
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0D8EB0,x)
	JSR.w CODE_0D9111
	RTL

CODE_0D8ED7:
	PHX
	PHB
	PHK
	PLB
	LDA.w #$010E
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0D8F23
	LDA.b $00
	STA.w $70E2,y
	LDA.b $02
	STA.w $7182,y
	TYX
	JSL.l CODE_03AD74
	BCC.b CODE_0D8F1F
	LDY.b #$06
	STY.b $76,x
	LDA.w #$0060
	STA.w $7A96,x
	LDY.b #$02
	STY.b $78,x
	LDA.w #$0100
	STA.w $7A36,x
	LDA.w #$FFFF
	STA.w $74A2,x
	LDA.w #$2081
	STA.w $7040,x
	STZ.w $7542,x
	JSR.w CODE_0D9111
	PLB
	PLX
	SEC
	RTL

CODE_0D8F1F:
	JSL.l CODE_03A31E
CODE_0D8F23:
	PLB
	PLX
	CLC
	RTL

CODE_0D8F27:
	LDY.b $78,x
	BNE.b CODE_0D8F2F
	JSL.l CODE_03AA52
CODE_0D8F2F:
	RTS

DATA_0D8F30:
	dw $0040,$FFC0

DATA_0D8F34:
	dw $0018,$001C

CODE_0D8F38:
	LDY.b $78,x
	BNE.b CODE_0D8F2F
	LDY.b $19,x
	TYA
	LSR
	TAY
	LDA.w DATA_0D8F34,y
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.b $18,x
	BEQ.b CODE_0D8FAF
	LDA.w $60D4
	BNE.b CODE_0D8F7C
	LDY.w $60AB
	BMI.b CODE_0D8F97
	LDA.w $7BB6,x
	CLC
	ADC.w $6120
	ASL
	STA.b $02
	LSR
	CLC
	ADC.w $7C16,x
	CMP.b $02
	BCS.b CODE_0D8F97
	INC.w $61B4
CODE_0D8F7C:
	LDA.w $60FC
	AND.w #$0007
	BNE.b CODE_0D8FAE
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w #$001E
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	RTS

CODE_0D8F97:
	LDY.b #$00
	STY.b $18,x
	LDY.b #$03
	STY.b $76,x
	LDY.w $7D36,x
	BMI.b CODE_0D8FAE
	PLA
	STA.b $00
	JSL.l CODE_03A5B7
	LDA.b $00
	PHA
CODE_0D8FAE:
	RTS

CODE_0D8FAF:
	LDA.w $7BB6,x
	CLC
	ADC.w $6120
	STA.b $00
	ASL
	STA.b $02
	LDA.w $7C16,x
	CLC
	ADC.b $00
	CMP.b $02
	BCC.b CODE_0D8FC8
CODE_0D8FC5:
	JMP.w CODE_0D9027

CODE_0D8FC8:
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w #$0020
	STA.b $04
	SEC
	SBC.w #$0008
	STA.b $06
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	BMI.b CODE_0D8FC5
	CMP.b $04
	BPL.b CODE_0D8FC5
	CMP.b $06
	BMI.b CODE_0D9024
	LDA.w $60FC
	AND.w #$0007
	BNE.b CODE_0D8FC5
	LDY.w $60AB
	BMI.b CODE_0D8FC5
	LDY.w $60D4
	BNE.b CODE_0D9005
	INC.w $61B4
	LDY.b #$01
	BRA.b CODE_0D900D

CODE_0D9005:
	LDA.w #$0020
	STA.w $7A38,x
	LDY.b #$04
CODE_0D900D:
	STY.b $76,x
	STZ.w $60AA
	LDA.w $7182,x
	CLC
	ADC.w #$FFF2
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC.b $18,x
	BRA.b CODE_0D8FC5

CODE_0D9024:
	JSR.w CODE_0D9037
CODE_0D9027:
	LDY.w $7D36,x
	BMI.b CODE_0D9036
	PLA
	STA.b $00
	JSL.l CODE_03A5B7
	LDA.b $00
	PHA
CODE_0D9036:
	RTS

CODE_0D9037:
	LDA.w $60A8
	BEQ.b CODE_0D9036
	EOR.w $7C16,x
	BMI.b CODE_0D9036
	LDA.w #$0160
	STA.w $093A
	LDA.w $7BB6,x
	CLC
	ADC.w $6120
	DEC
	DEC
	LDY.w $77C2,x
	BNE.b CODE_0D9059
	EOR.w #$FFFF
	INC
CODE_0D9059:
	CLC
	ADC.w $7C16,x
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STZ.w $60A8
	STZ.w $60B4
	LDA.w $0036
	AND.w #$0003
	BEQ.b CODE_0D909C
	AND.w #$0001
	DEC
	EOR.w $7C16,x
	BMI.b CODE_0D909C
	LDA.w $60DE
	ORA.w $6150
	BNE.b CODE_0D909C
	INC.w $61C2
	LDY.w $77C2,x
	LDA.w DATA_0D8F30,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $60A8
	STA.w $60B4
	JSL.l CODE_0D90A1
	INC.w $60DC
CODE_0D909C:
	RTS

DATA_0D909D:
	dw $FFC0,$0040

CODE_0D90A1:
	LDA.w $7974
	AND.w #$000F
	BNE.b CODE_0D9100
	PHB
	PHK
	PLB
	LDA.w #!Define_YI_SoundID59_RollingRock
	JSL.l CODE_push_sound_queue
	LDY.w $77C2,x
	LDA.w DATA_0D909D,y
	STA.b $00
	LDA.w #!Define_YI_AmbSpr1D8
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $10
	AND.w #$0007
	SEC
	SBC.w #$0004
	CLC
	ADC.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0004
	STA.w $7142,y
	LDA.w #$0008
	STA.w $7782,y
	LDA.w #$0003
	STA.w $7E4C,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FF80
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $77C2,x
	AND.w #$00FF
	EOR.w #$0002
	STA.w $73C0,y
	PLB
CODE_0D9100:
	RTL

DATA_0D9101:
	dw (FXDATA_550000+$2080)>>16,(FXDATA_550000+$20A0)>>16,(FXDATA_548000+$6060)>>16,(FXDATA_550000+$20A0)>>16

DATA_0D9109:
	dw FXDATA_550000+$2080,FXDATA_550000+$20A0,FXDATA_548000+$6060,FXDATA_550000+$20A0

CODE_0D9111:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	BEQ.b CODE_0D917A
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0200
	SEC
	SBC.w $7A36,x
	LSR
	LSR
	LSR
	LSR
	CLC
	ADC.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	SEP.b #$20
	LDA.b $19,x
	CLC
	ADC.b $78,x
	TAY
	REP.b #$20
	TYA
	BIT.w #$0002
	BEQ.b CODE_0D9144
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
CODE_0D9144:
	LDA.w DATA_0D9101,y
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w DATA_0D9109,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	ASL
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
CODE_0D917A:
	RTS

CODE_0D917B:
	TYX
	LDA.w $7A36,x
	SEC
	SBC.w #$0010
	CMP.w #$00F0
	BPL.b CODE_0D919F
	INC.b $76,x
	LDA.w #$00F0
	BRA.b CODE_0D919F

CODE_0D918F:
	TYX
	LDA.w $7A36,x
	CLC
	ADC.w #$0008
	CMP.w #$00E0
	BMI.b CODE_0D919F
	LDA.w #$00E0
CODE_0D919F:
	STA.w $7A36,x
	RTS

CODE_0D91A3:
	TYX
	LDA.w $7A36,x
	CLC
	ADC.w #$0004
	CMP.w #$0100
	BMI.b CODE_0D919F
	STZ.b $76,x
	LDA.w #$0100
	BRA.b CODE_0D919F

CODE_0D91B7:
	TYX
	LDA.w $7A38,x
	DEC
	BEQ.b CODE_0D91C1
	STA.w $7A38,x
CODE_0D91C1:
	LDA.w $7A36,x
	SEC
	SBC.w $7A38,x
	CMP.w #$0080
	BMI.b CODE_0D91D1
	STA.w $7A36,x
CODE_0D91D0:
	RTS

CODE_0D91D1:
	JSR.w CODE_0D9236
	INC.b $76,x
	LDY.b $79,x
	BNE.b CODE_0D91D0
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr10E_CrateWith6Stars
	BNE.b CODE_0D91F7
	LDY.b $16,x
	BNE.b CODE_0D91F2
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $04
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSL.l CODE_03D3F3
CODE_0D91F2:
	JSL.l CODE_0D9329
	RTS

CODE_0D91F7:
	JMP.w CODE_0D9383

DATA_0D91FA:
	dw $FFF2,$FFF4,$0000,$000A,$000D,$0000

DATA_0D9206:
	dw $0000,$FFF4,$FFF2,$FFF4,$0000,$0000

DATA_0D9212:
	dw $0000,$000E,$000C,$000E,$0012,$000C

DATA_0D921E:
	dw $FC00,$FE00,$0000,$0200,$0400,$0000

DATA_0D922A:
	dw $FF00,$FE00,$FC80,$FE00,$FF00,$0000

CODE_0D9236:
	PHX
	LDA.w $7722,x
	TAX
	LDA.l DATA_03AA0E,x
	PLX
	AND.w #$000F
	STA.b $0E
	LDA.b $10
	STA.b $0C
	LDY.b #$0A
CODE_0D924B:
	LDA.w DATA_0D91FA,y
	STA.b $00
	LDA.w DATA_0D9206,y
	STA.b $02
	LDA.w DATA_0D9212,y
	STA.b $04
	LDA.w DATA_0D921E,y
	STA.b $06
	LDA.w DATA_0D922A,y
	STA.b $08
	PHY
	LDA.w #!Define_YI_AmbSpr1F3
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	CLC
	ADC.b $00
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.b $02
	STA.w $7142,y
	LDA.b $04
	STA.w $7E4E,y
	LDA.w #$0050
	STA.w $7782,y
	LDA.w #$0003
	STA.w $7E8E,y
	STA.w !EXRAM_YI_Level_AmbSpr_GenericTable7018C0|!EXRAMBankMirror,y
	LDA.b $0E
	STA.w $7E8C,y
	LDA.b $06
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $08
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0040
	STA.w $7500,y
	LDA.b $0C
	AND.w #$0002
	STA.w $73C0,y
	LDA.b $0C
	ROR
	STA.b $0C
	PLY
	DEY
	DEY
	BPL.b CODE_0D924B
	LDY.b #$02
	STY.b $78,x
	LDA.w #$0100
	STA.w $7A36,x
	LDA.w #$0060
	STA.w $7A96,x
	LDA.w #$FFFF
	STA.w $74A2,x
	LDA.w #$2081
	STA.w $7040,x
	RTS

DATA_0D92D6:
	dw $0241,$FDBF,$0195,$FE6B,$009B,$FF65

DATA_0D92E2:
	dw $FEEF,$FEEF,$FE11,$FE11,$FD94,$FD94

CODE_0D92EE:
	PHB
	PHK
	PLB
	LDY.b #$0A
CODE_0D92F3:
	LDA.w DATA_0D92D6,y
	STA.b $00
	LDA.w DATA_0D92E2,y
	STA.b $02
	PHY
	LDA.w #$0115
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0D9326
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	DEC
	DEC
	STA.w $7182,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $02
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	PLY
	DEY
	DEY
	BPL.b CODE_0D92F3
	PLB
	RTL

CODE_0D9326:
	PLB
	PLY
	RTL

CODE_0D9329:
	PHB
	PHK
	PLB
	LDA.w !RAM_YI_Level_StarTimerLo
	STA.b $04
	LDY.b #$0A
CODE_0D9333:
	LDA.b $04
	CLC
	ADC.w #$000A
	CMP.w #!Define_YI_Level_SoftMaxStarTimerThreshold+$0A
	BPL.b CODE_0D92F3
	STA.b $04
	LDA.w DATA_0D92D6,y
	STA.b $00
	LDA.w DATA_0D92E2,y
	STA.b $02
	PHY
	LDA.w #$01A2
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0D9326
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	DEC
	DEC
	STA.w $7182,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $02
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0180
	STA.w $7A96,y
	LDA.w #$0020
	STA.w $7AF6,y
	PLY
	DEY
	DEY
	BPL.b CODE_0D9333
	PLB
	RTL

DATA_0D937F:
	dw $0200,$FE00

CODE_0D9383:
	LDY.w $60C4
	LDA.w DATA_0D937F,y
	STA.b $00
	LDA.w #$0027
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0D93BD
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FB00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.w $7D38,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
CODE_0D93BD:
	RTS

CODE_0D93BE:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0D93C8
CODE_0D93C4:
	JSL.l CODE_despawn_sprite_free_slot
CODE_0D93C8:
	RTS

CODE_0D93C9:
	TYX
	LDA.w $7A96,x
	BEQ.b CODE_0D93C4
	CMP.w #$0050
	BMI.b CODE_0D9438
	LDA.w #!Define_YI_AmbSpr1F3
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $10
	AND.w #$0078
	SEC
	SBC.w #$0040
	CLC
	ADC.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$0050
	STA.w $7782,y
	PHX
	LDA.w $7722,x
	TAX
	LDA.l DATA_03AA0E,x
	PLX
	AND.w #$000F
	STA.w $7E8C,y
	LDA.b $10
	AND.w #$07FF
	SEC
	SBC.w #$0400
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $0F
	AND.w #$03FF
	CLC
	ADC.w #$0600
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.b $10
	AND.w #$0007
	CLC
	ADC.w #$0002
	STA.w !EXRAM_YI_Level_AmbSpr_GenericTable7018C0|!EXRAMBankMirror,y
	STA.w $7E8E,y
	LDA.w #$0004
	STA.w $7500,y
CODE_0D9438:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $126: Spiked log riding a pulley. Raiden: init_spiked_log.
;---------------------------------------------------------------------------
YI_NorSpr126_SpikedLogOnPulley_Init:
init_spiked_log:
;$0D9439
	LDA.w #$0127
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0D944F
	TYX
	JSL.l CODE_03AD74
	BCS.b CODE_0D9453
	JSL.l CODE_03A31E
	LDX.b $12
CODE_0D944F:
	JML.l CODE_03A31E

CODE_0D9453:
	PHX
	JSR.w CODE_0D9803
	PLY
	LDX.b $12
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	STY.b $18,x
	STZ.w $7400,x
	LDA.w #$0007
	STA.w $7720,x
	LDA.w $70E2,x
	CLC
	ADC.w #$000E
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEC
	SBC.w #$0008
	STA.w $70E2,x
	LDA.w $7182,x
	CLC
	ADC.w #$0030
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_0ACDFA>>16
	LDA.w #FXCODE_0ACDFA
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R12_LOOPCounterLo
	CPY.b #$0C
	BPL.b CODE_0D94B7
	LDA.w #$8000
	STA.w $7A36,x
	XBA
	BRA.b CODE_0D94C5

CODE_0D94B7:
	LDA.w #$0014
	SEC
	SBC.w !REGISTER_SuperFX_R12_LOOPCounterLo
	ASL
	ASL
	ASL
	ASL
	STA.w $7A36,x
CODE_0D94C5:
	CLC
	ADC.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,x
	LDY.b $18,x
	STA.w $7A36,y
	STA.b $78,x
	STZ.w $7400,x
	LDA.w #$000F
	SEC
	SBC.w !REGISTER_SuperFX_R12_LOOPCounterLo
	CMP.w #$0003
	BMI.b CODE_0D94E9
	LDA.w #$0003
CODE_0D94E9:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

DATA_0D94ED:
	dw CODE_0D8000
	dw CODE_0D96A5
	dw CODE_0D96BC
	dw CODE_0D96DF

;---------------------------------------------------------------------------
; Sprite $126 main. Raiden: main_chained_pulley_log.
;---------------------------------------------------------------------------
YI_NorSpr126_SpikedLogOnPulley_Main:
main_chained_pulley_log:
;$0D94F5
	JSR.w CODE_0D9560
	JSL.l CODE_03AF23
	JSR.w CODE_0D95EE
	JSL.l CODE_03A299
	BCC.b CODE_0D9512
	LDA.b $18,x
	TAX
	JSL.l CODE_03A31E
	LDX.b $12
	JML.l CODE_03A31E

CODE_0D9512:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0D94ED,x)
	JSL.l CODE_03D127
	LDY.w $7D36,x
	DEY
	BNE.b CODE_0D955B
	LDA.w $7CD6
	SEC
	SBC.w $7CD6,x
	STA.b $00
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	BPL.b CODE_0D955A
	LDA.w $7BB6,x
CODE_0D9535:
	CLC
	ADC.w $7BB6
	LDY.b $01
	BPL.b CODE_0D9541
	EOR.w #$FFFF
	INC
CODE_0D9541:
	CLC
	ADC.w $7CD6,x
	SEC
	SBC.w $7CD6
	CLC
	ADC.w $70E2
	STA.w $70E2
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
CODE_0D955A:
	RTL

CODE_0D955B:
	JSL.l CODE_03A5B7
	RTL

CODE_0D9560:
	LDY.b $18,x
	LDA.w $7182,y
	SEC
	SBC.w $609C
	STA.b $04
	REP.b #$10
	LDY.w $7362,x
	LDA.w $7A36,x
	BPL.b CODE_0D9580
	LDA.w #$8000
	STA.w $6000,y
	STA.w $6008,y
	BRA.b CODE_0D9589

CODE_0D9580:
	CLC
	ADC.b $04
	STA.w $6002,y
	STA.w $600A,y
CODE_0D9589:
	TYA
	CLC
	ADC.w #$0048
	TAY
	LDA.w $7182,x
	SEC
	SBC.w #$001A
	SEC
	SBC.w $609C
	STA.b $02
	STZ.b $06
	STZ.b $08
	LDA.w $7AF6,x
	BEQ.b CODE_0D95AB
	INC.b $06
	LDA.b $10
	STA.b $08
CODE_0D95AB:
	LDA.w #$0005
	STA.b $0E
CODE_0D95B0:
	LDA.b $02
	SEC
	SBC.w #$0010
	STA.b $02
	CMP.b $04
	BPL.b CODE_0D95C4
	LDA.w #$8000
	STA.w $6000,y
	BRA.b CODE_0D95E1

CODE_0D95C4:
	LDA.b $08
	AND.w #$0003
	SEC
	SBC.b $06
	STA.b $0A
	ADC.b $02
	STA.w $6002,y
	LDA.w $6000,y
	CLC
	ADC.b $0A
	STA.w $6000,y
	LDA.b $08
	ROR
	STA.b $08
CODE_0D95E1:
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEC.b $0E
	BNE.b CODE_0D95B0
	SEP.b #$10
	RTS

CODE_0D95EE:
	LDA.w $6120
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $611C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $6122
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $611E
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	JSR.w CODE_0D965E
	BCS.b CODE_0D962C
	LDA.b $04
	LDY.b $0D
	BMI.b CODE_0D9615
	EOR.w #$FFFF
	INC
CODE_0D9615:
	CLC
	ADC.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611C
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	JSL.l CODE_03A858
CODE_0D962C:
	LDA.w $7BB6
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7CD6
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7BB8
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7CD8
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	JSR.w CODE_0D965E
	BCS.b CODE_0D965D
	LDA.b $0C
	EOR.w #$FFFF
	INC
	STA.b $00
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	BPL.b CODE_0D965D
	LDA.w #$0008
	JSL.l CODE_0D9535
CODE_0D965D:
	RTS

CODE_0D965E:
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LSR
	STA.b $00
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $02
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w #$0008
	STA.b $04
	ASL
	STA.b $06
	LDA.w $70E2,x
	CLC
	ADC.w #$0009
	SEC
	SBC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.b $0C
	CLC
	ADC.b $04
	CMP.b $06
	BCS.b CODE_0D96A4
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	CLC
	ADC.b $00
	STA.b $08
	ASL
	STA.b $0A
	LDA.b $02
	SEC
	SBC.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	CLC
	ADC.b $08
	CMP.b $0A
CODE_0D96A4:
	RTS

CODE_0D96A5:
	TYX
	LDA.b $78,x
	CMP.w $7182,x
	BMI.b CODE_0D96BB
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0080
	STA.w $7A96,x
	INC.b $76,x
CODE_0D96BB:
	RTS

CODE_0D96BC:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0D96DE
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0016
	CLC
	ADC.b $78,x
	STA.b $78,x
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0080
	STA.w $7A96,x
	STZ.w $7A38,x
	INC.b $76,x
CODE_0D96DE:
	RTS

CODE_0D96DF:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0D96DE
	LDA.w $7A38,x
	CLC
	ADC.w #$0020
	CMP.w #$4000
	BMI.b CODE_0D96F4
	LDA.w #$4000
CODE_0D96F4:
	STA.w $7A38,x
	AND.w #$FF00
	XBA
	STA.w $7542,x
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0D9744
	LDA.w #!Define_YI_AmbSpr1F1
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $78,x
	STA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7142,y
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w $70A2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0020
	STA.w $61C6
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	LDA.w #$0010
	STA.w $7AF6,x
	BRA.b CODE_0D975B

CODE_0D9744:
	LDA.b $78,x
	CMP.w $7182,x
	BPL.b CODE_0D976F
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CPY.b #$03
	BMI.b CODE_0D9764
	STA.w $7182,x
	LDA.w #$0010
	STA.w $7AF6,x
CODE_0D975B:
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.b $76,x
	RTS

CODE_0D9764:
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.b $78,x
	CLC
	ADC.w #$0016
	STA.b $78,x
CODE_0D976F:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $127: The pulley itself (chain-anchor for $126). Raiden: init_pulley.
;---------------------------------------------------------------------------
YI_NorSpr127_PulleyOfSpikedLog_Init:
init_pulley:
;$0D9770
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $127 main. Raiden: main_pulley.
;---------------------------------------------------------------------------
YI_NorSpr127_PulleyOfSpikedLog_Main:
main_pulley:
;$0D9771
	JSL.l CODE_03AA52
	JSL.l CODE_03AF23
	LDY.w $7D36,x
	BEQ.b CODE_0D97C3
	DEY
	BPL.b CODE_0D9787
	JSL.l CODE_03A858
	BRA.b CODE_0D97C3

CODE_0D9787:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0D97C3
	LDA.w $7D38,y
	BEQ.b CODE_0D97C3
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDY.b $18,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	BMI.b CODE_0D97C3
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	DEC
	BMI.b CODE_0D97C3
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	SEC
	SBC.w #$0016
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.w #$FFC0
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0000
	STA.w $7542,y
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
CODE_0D97C3:
	LDY.b $18,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	BEQ.b CODE_0D97DB
	LDA.w $7182,y
	AND.w #$0002
	BNE.b CODE_0D97DB
	PHY
	LDA.w #!Define_YI_SoundID5A_PulleySqueak
	JSL.l CODE_push_sound_queue
	PLY
CODE_0D97DB:
	LDA.w $7A36,x
	SEC
	SBC.w $7182,y
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0C00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	AND.w #$01FE
	STA.w $7A38,x
	JSR.w CODE_0D9803
	RTL

CODE_0D9803:
	LDA.w #FXDATA_550000+$20E0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$20E0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprites $135 / $136: Small raven flying a circular path. Raiden: init_small_raven.
;---------------------------------------------------------------------------
YI_NorSpr135_CirclingRaven_Init:
YI_NorSpr136_CirclingRaven_Init:
init_small_raven:
;$0D983D
	JSL.l CODE_03AE60
	LDY.b #$00
	LDA.w $70E2,x
	SEC
	SBC.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	AND.w #$0010
	BNE.b CODE_0D9854
	INY
	INY
CODE_0D9854:
	TYA
	STA.w $7400,x
	STY.b $78,x
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr135_CirclingRaven
	BEQ.b CODE_0D9871
	LDA.w #$0080
	STA.b $18,x
CODE_0D9871:
	JSR.w CODE_0D98FB
	RTL

;---------------------------------------------------------------------------

DATA_0D9875:
	dw CODE_0D99AF
	dw CODE_0D99EF

;---------------------------------------------------------------------------
; Sprites $135 / $136 main (shared). Raiden: main_small_raven.
;---------------------------------------------------------------------------
YI_NorSpr135_CirclingRaven_Main:
YI_NorSpr136_CirclingRaven_Main:
main_small_raven:
;$0D9879
	JSL.l CODE_03AA52
	JSL.l CODE_03AF23
	JSR.w CODE_0D98CA
	JSR.w CODE_0D98FB
	JSR.w CODE_0D994E
	JSR.w CODE_0D9998
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0D9875,x)
	LDY.w $7D36,x
	BEQ.b CODE_0D98C5
	BPL.b CODE_0D98C1
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF6
	BCC.b CODE_0D98B6
	LDY.w $7223,x
	BMI.b CODE_0D98B6
	LDY.w $60C0
	BNE.b CODE_0D98BC
CODE_0D98B6:
	JSL.l CODE_03A858
	BRA.b CODE_0D98C5

CODE_0D98BC:
	JSL.l CODE_03A5B7
	RTL

CODE_0D98C1:
	JSL.l CODE_0DC14C
CODE_0D98C5:
	RTL

DATA_0D98C6:
	dw $0100,$0400

CODE_0D98CA:
	LDY.b $76,x
	BNE.b CODE_0D98F6
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr135_CirclingRaven
	ASL
	TAY
	LDA.w $7A36,x
	CLC
	ADC.w DATA_0D98C6,y
	PHA
	AND.w #$01FF
	STA.w $7A36,x
	PLA
	AND.w #$FE00
	BPL.b CODE_0D98EE
	ORA.w #$00FF
CODE_0D98EE:
	XBA
	CLC
	ADC.w $7A38,x
	STA.w $7A38,x
CODE_0D98F6:
	RTS

DATA_0D98F7:
	dw FXDATA_550000+$4080,FXDATA_550000+$40A0

CODE_0D98FB:
	LDY.b $77,x
	LDA.w DATA_0D98F7,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$4080)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.b $78,x
	STY.b $00
	LDA.w $7A38,x
	LDY.w $7400,x
	CPY.b $00
	BEQ.b CODE_0D9920
	BIT.w #$0080
	BEQ.b CODE_0D9920
	CLC
	ADC.w #$0100
CODE_0D9920:
	AND.w #$01FE
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	RTS

CODE_0D994E:
	LDY.w $7400,x
	STY.b $00
	PHP
	LDA.w $7A38,x
	LDY.b $78,x
	CPY.b $00
	BEQ.b CODE_0D9965
	BIT.w #$0080
	BEQ.b CODE_0D9965
	PLP
	BRA.b CODE_0D9968

CODE_0D9965:
	PLP
	BEQ.b CODE_0D996C
CODE_0D9968:
	EOR.w #$FFFF
	INC
CODE_0D996C:
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0018
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $7182,x
	RTS

CODE_0D9998:
	LDY.b $76,x
	BNE.b CODE_0D99AE
	LDA.w $7A98,x
	BNE.b CODE_0D99AE
	LDA.w #$0004
	STA.w $7A98,x
	LDA.b $77,x
	EOR.w #$0002
	STA.b $77,x
CODE_0D99AE:
	RTS

CODE_0D99AF:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr135_CirclingRaven
	BEQ.b CODE_0D99EE
	LDA.w $7A38,x
	SEC
	SBC.b $18,x
	BMI.b CODE_0D99EE
	INC.b $76,x
	LDA.b $18,x
	STA.w $7A38,x
	AND.w #$01FF
	BEQ.b CODE_0D99DD
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0004
	STA.w $7A96,x
	LDY.b #$01
	STY.b $16,x
	RTS

CODE_0D99DD:
	LDA.w #$0010
	STA.w $7A96,x
	LDA.b $10
	AND.w #$0003
	CLC
	ADC.w #$0003
	STA.b $16,x
CODE_0D99EE:
	RTS

CODE_0D99EF:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0D9A19
	DEC.b $16,x
	BNE.b CODE_0D9A0A
	LDY.w $7400,x
	STY.b $78,x
	LDA.w $7A38,x
	CLC
	ADC.w #$0080
	STA.b $18,x
	DEC.b $76,x
	RTS

CODE_0D9A0A:
	LDA.w #$0008
	STA.w $7A96,x
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_0D9A19:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $13C: Pinball flipper pointing down. Raiden: init_flipper_downwards.
;---------------------------------------------------------------------------
YI_NorSpr13C_DownFlippers_Init:
init_flipper_downwards:
;$0D9A1A
	JSL.l CODE_03AE60
	STZ.w $7400,x
	JSR.w CODE_0D9C93
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $13C main. Raiden: main_flipper_downwards.
;---------------------------------------------------------------------------
YI_NorSpr13C_DownFlippers_Main:
main_flipper_downwards:
;$0D9A25
	JSR.w CODE_0D9A40
	JSL.l CODE_03AF23
	JSR.w CODE_0D9B13
	JSR.w CODE_0D9C93
	LDA.w #$04B4
	LDY.b $18,x
	BEQ.b CODE_0D9A3C
	LDA.w #$0474
CODE_0D9A3C:
	STA.w $6FA0,x
	RTL

CODE_0D9A40:
	JSL.l CODE_03AA52
	LDA.w $7A38,x
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $7CD6,x
	SEC
	SBC.w #$0018
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w $6094
	STA.b $00
	LDA.w $7CD6,x
	CLC
	ADC.w #$0018
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w $6094
	STA.b $02
	LDA.w $7CD8,x
	CLC
	ADC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEC
	SBC.w $609C
	STA.b $04
	REP.b #$10
	LDY.w $7362,x
	LDA.b $00
	STA.w $6008,y
	STA.w $6018,y
	SEC
	SBC.w #$0010
	STA.w $6000,y
	STA.w $6010,y
	LDA.b $02
	STA.w $6020,y
	STA.w $6030,y
	SEC
	SBC.w #$0010
	STA.w $6028,y
	STA.w $6038,y
	LDA.b $04
	STA.w $6012,y
	STA.w $601A,y
	STA.w $6032,y
	STA.w $603A,y
	SEC
	SBC.w #$0010
	STA.w $6002,y
	STA.w $600A,y
	STA.w $6022,y
	STA.w $602A,y
	LDA.w $6004,y
	EOR.w #$4000
	STA.w $6024,y
	LDA.w $600C,y
	EOR.w #$4000
	STA.w $602C,y
	LDA.w $6014,y
	EOR.w #$4000
	STA.w $6034,y
	LDA.w $601C,y
	EOR.w #$4000
	STA.w $603C,y
	LDA.w $6006,y
	STA.w $6026,y
	LDA.w $600E,y
	STA.w $602E,y
	LDA.w $6016,y
	STA.w $6036,y
	LDA.w $601E,y
	STA.w $603E,y
	SEP.b #$10
	RTS

CODE_0D9B13:
	STZ.b $02
	LDY.w $7D36,x
	BPL.b CODE_0D9B86
	LDA.w $7C18,x
	EOR.w #$FFFF
	INC
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	STA.b $00
	DEC
	CMP.w #$FFF7
	BCC.b CODE_0D9B6F
	LDA.w $7A38,x
	CMP.w #$FFE0
	BMI.b CODE_0D9B86
	LDY.w $60AB
	BPL.b CODE_0D9B86
	LDA.b $00
	SEC
	ADC.w $7CD8,x
	INC
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	LDA.w $60AA
	CMP.w #$FF40
	BPL.b CODE_0D9B67
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0D9B67
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $7AF6,x
	STZ.b $78,x
CODE_0D9B67:
	STZ.w $60D2
	STZ.w $60AA
	BRA.b CODE_0D9B86

CODE_0D9B6F:
	LDY.b $18,x
	BNE.b CODE_0D9B80
	LDY.b #$02
	STY.b $18,x
	STZ.b $78,x
	LDA.w #!Define_YI_SoundID0E_ShellHit4
	JSL.l CODE_push_sound_queue
CODE_0D9B80:
	LDA.w #$0010
	STA.w $7AF6,x
CODE_0D9B86:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_0D9B93:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_0D9BA4
	BNE.b CODE_0D9BA7
	LDA.w $61B2
	ORA.w $61CC
	BEQ.b CODE_0D9BA7
CODE_0D9BA4:
	JMP.w CODE_0D9C85

CODE_0D9BA7:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr091_4RedToadies
	BEQ.b CODE_0D9BA4
	INC.b $02
	BRA.b CODE_0D9BBE

CODE_0D9BB3:
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_0D9B93

CODE_0D9BBE:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr006_WatermelonFreeze
	BEQ.b CODE_0D9BF6
	CMP.w #!Define_YI_NorSpr018_WatermelonFlame
	BEQ.b CODE_0D9BF6
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_0D9BDA
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BCS.b CODE_0D9BDA
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	BNE.b CODE_0D9BF6
CODE_0D9BDA:
	LDA.w $7CD8,y
	SEC
	SBC.w $7CD8,x
	STA.b $00
	BPL.b CODE_0D9BEE
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	DEC
	BMI.b CODE_0D9BEE
	JMP.w CODE_0D9C5F

CODE_0D9BEE:
	LDA.w $7A38,x
	CMP.w #$FFE0
	BPL.b CODE_0D9BF9
CODE_0D9BF6:
	JMP.w CODE_0D9C7B

CODE_0D9BF9:
	LDA.b $00
	SEC
	SBC.w $7BB8,y
	SEC
	SBC.w $7BB8,x
	EOR.w #$FFFF
	SEC
	ADC.w $7182,y
	INC
	INC
	STA.w $7182,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	CPY.b #$00
	BNE.b CODE_0D9C30
	LDY.b #$02
	STY.w $0DB6
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0D9C7B
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $7AF6,x
	STZ.b $78,x
	BRA.b CODE_0D9C7B

CODE_0D9C30:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	CMP.w #$FF40
	BPL.b CODE_0D9C48
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0D9C48
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $7AF6,x
	STZ.b $78,x
CODE_0D9C48:
	LDA.w $7D38,y
	BEQ.b CODE_0D9C7B
	TYX
	PHY
	JSL.l CODE_kill_sprite_by_hit_special_cases
	PLY
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w $7A96,y
	BRA.b CODE_0D9C7B

CODE_0D9C5F:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	BMI.b CODE_0D9BEE
	LDY.b $18,x
	BNE.b CODE_0D9C75
	LDY.b #$02
	STY.b $18,x
	STZ.b $78,x
	LDA.w #!Define_YI_SoundID0E_ShellHit4
	JSL.l CODE_push_sound_queue
CODE_0D9C75:
	LDA.w #$0010
	STA.w $7AF6,x
CODE_0D9C7B:
	LDA.b $02
	BEQ.b CODE_0D9C82
	JMP.w CODE_0D9BB3

CODE_0D9C82:
	JMP.w CODE_0D9B86

CODE_0D9C85:
	LDA.w $7AF6,x
	BNE.b CODE_0D9C92
	LDY.b $18,x
	BEQ.b CODE_0D9C92
	STZ.b $18,x
	STZ.b $78,x
CODE_0D9C92:
	RTS

CODE_0D9C93:
	LDY.b $78,x
	BEQ.b CODE_0D9C98
	RTS

CODE_0D9C98:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0D9CA6
	LDA.w $7A38,x
	LDY.b $18,x
	BNE.b CODE_0D9CD6
	BRA.b CODE_0D9CC4

CODE_0D9CA6:
	LDY.w $7AF6,x
	BNE.b CODE_0D9CBE
	LDA.w $7A38,x
	BPL.b CODE_0D9CB8
	STZ.w $7A38,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BRA.b CODE_0D9CCF

CODE_0D9CB8:
	SEC
	SBC.w #$0008
	BRA.b CODE_0D9CE6

CODE_0D9CBE:
	CLC
	ADC.w #$0008
	BRA.b CODE_0D9CE6

CODE_0D9CC4:
	CMP.w #$0000
	BPL.b CODE_0D9CCF
	CLC
	ADC.w #$0010
	BRA.b CODE_0D9CE6

CODE_0D9CCF:
	INC.b $78,x
	LDA.w #$0000
	BRA.b CODE_0D9CE6

CODE_0D9CD6:
	CMP.w #$FFA1
	BMI.b CODE_0D9CE1
	SEC
	SBC.w #$0018
	BRA.b CODE_0D9CE6

CODE_0D9CE1:
	INC.b $78,x
	LDA.w #$FFA0
CODE_0D9CE6:
	STA.w $7A38,x
	LDA.w #FXDATA_550000+$4060
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$4060)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	CLC
	ADC.w $7A36,x
	AND.w #$01FE
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	RTS

;---------------------------------------------------------------------------

DATA_0D9D2A:
	dw $0080,$FF80

;---------------------------------------------------------------------------
; Sprite $144: Pinball flippers left/right. Raiden: init_flipper_left_and_right.
;---------------------------------------------------------------------------
YI_NorSpr144_RightOrLeftFlippers_Init:
init_flipper_left_and_right:
;$0D9D2E
	JSL.l CODE_03AE60
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	TAY
	LDA.w DATA_0D9D2A,y
	STA.w $7A36,x
	STZ.w $7400,x
	JSR.w CODE_0D9C93
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $144 main. Raiden: main_flipped_left_and_right (sic).
;---------------------------------------------------------------------------
YI_NorSpr144_RightOrLeftFlippers_Main:
main_flipper_left_and_right:
;$0D9D49
	JSR.w CODE_0D9D64
	JSL.l CODE_03AF23
	JSR.w CODE_0D9E70
	JSR.w CODE_0D9C93
	LDA.w #$04B5
	LDY.b $18,x
	BEQ.b CODE_0D9D60
	LDA.w #$0475
CODE_0D9D60:
	STA.w $6FA0,x
	RTL

CODE_0D9D64:
	JSL.l CODE_03AA52
	LDA.w $7A38,x
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $70E2,x
	AND.w #$0010
	BNE.b CODE_0D9DBB
	LDA.w $7CD6,x
	CLC
	ADC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEC
	SBC.w $6094
	STA.b $00
	LDA.w $7CD8,x
	CLC
	ADC.w #$0018
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w $609C
	STA.b $02
	LDA.w $7CD8,x
	SEC
	SBC.w #$0018
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w $609C
	STA.b $04
	BRA.b CODE_0D9DEA

CODE_0D9DBB:
	LDA.w $7CD6,x
	SEC
	SBC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEC
	SBC.w $6094
	STA.b $00
	LDA.w $7CD8,x
	SEC
	SBC.w #$0018
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w $609C
	STA.b $02
	LDA.w $7CD8,x
	CLC
	ADC.w #$0018
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w $609C
	STA.b $04
CODE_0D9DEA:
	REP.b #$10
	LDY.w $7362,x
	LDA.b $00
	STA.w $6008,y
	STA.w $6018,y
	STA.w $6028,y
	STA.w $6038,y
	SEC
	SBC.w #$0010
	STA.w $6000,y
	STA.w $6010,y
	STA.w $6020,y
	STA.w $6030,y
	LDA.b $02
	STA.w $6012,y
	STA.w $601A,y
	SEC
	SBC.w #$0010
	STA.w $6002,y
	STA.w $600A,y
	LDA.b $04
	STA.w $6022,y
	STA.w $602A,y
	SEC
	SBC.w #$0010
	STA.w $6032,y
	STA.w $603A,y
	LDA.w $6004,y
	EOR.w #$8000
	STA.w $6024,y
	LDA.w $600C,y
	EOR.w #$8000
	STA.w $602C,y
	LDA.w $6014,y
	EOR.w #$8000
	STA.w $6034,y
	LDA.w $601C,y
	EOR.w #$8000
	STA.w $603C,y
	LDA.w $6006,y
	STA.w $6026,y
	LDA.w $600E,y
	STA.w $602E,y
	LDA.w $6016,y
	STA.w $6036,y
	LDA.w $601E,y
	STA.w $603E,y
	SEP.b #$10
	RTS

CODE_0D9E70:
	LDA.w $70E2,x
	AND.w #$0010
	DEC
	STA.b $0E
	STZ.b $02
	LDY.w $7D36,x
	BMI.b CODE_0D9E83
CODE_0D9E80:
	JMP.w CODE_0D9F55

CODE_0D9E83:
	LDY.b $18,x
	BNE.b CODE_0D9E8E
	LDA.w $7C16,x
	EOR.b $0E
	BPL.b CODE_0D9E91
CODE_0D9E8E:
	JMP.w CODE_0D9F38

CODE_0D9E91:
	LDA.w $7A38,x
	CMP.w #$FFE0
	BMI.b CODE_0D9E80
	LDA.w $60A8
	BNE.b CODE_0D9EAA
	LDA.w $0035
	AND.w #$0300
	BEQ.b CODE_0D9E80
	AND.w #$0100
	DEC
CODE_0D9EAA:
	EOR.b $0E
	BMI.b CODE_0D9E80
	LDA.w $60A8
	CLC
	ADC.w #$00C0
	CMP.w #$0180
	BCC.b CODE_0D9ECA
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0D9ECA
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $7AF6,x
	STZ.b $78,x
CODE_0D9ECA:
	LDA.w $6120
	CLC
	ADC.w $7BB6,x
	DEC
	DEC
	LDY.b $0E
	BMI.b CODE_0D9EDB
	EOR.w #$FFFF
	INC
CODE_0D9EDB:
	CLC
	ADC.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $60A8
	CLC
	ADC.w #$0280
	CMP.w #$0500
	BCC.b CODE_0D9F25
	LDA.w $60A8
	PHA
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	EOR.w #$FFFF
	INC
	STA.w $60A8
	STA.w $60B4
	PLA
	BMI.b CODE_0D9F13
	EOR.w #$FFFF
	INC
CODE_0D9F13:
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #!Define_YI_SoundID34_BurtJump
	JSL.l CODE_push_sound_queue
	BRA.b CODE_0D9F55

CODE_0D9F25:
	STZ.w $60A8
	STZ.w $60B4
	LDY.w $60C0
	BNE.b CODE_0D9F55
	INC.w $61C2
	INC.w $60DC
	BRA.b CODE_0D9F55

CODE_0D9F38:
	LDY.b $18,x
	BNE.b CODE_0D9F4F
	LDA.w #$0010
	STA.w $7BB6,x
	LDY.b #$02
	STY.b $18,x
	STZ.b $78,x
	LDA.w #!Define_YI_SoundID0E_ShellHit4
	JSL.l CODE_push_sound_queue
CODE_0D9F4F:
	LDA.w #$0010
	STA.w $7AF6,x
CODE_0D9F55:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_0D9F62:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_0D9F8A
	BNE.b CODE_0D9F73
	LDA.w $61B2
	ORA.w $61CC
	BMI.b CODE_0D9F8A
CODE_0D9F73:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr091_4RedToadies
	BEQ.b CODE_0D9F7F
	INC.b $02
	BRA.b CODE_0D9F9E

CODE_0D9F7F:
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_0D9F62

CODE_0D9F8A:
	LDA.w $7AF6,x
	BNE.b CODE_0D9F9D
	LDY.b $18,x
	BEQ.b CODE_0D9F9D
	LDA.w #$0008
	STA.w $7BB6,x
	STZ.b $18,x
	STZ.b $78,x
CODE_0D9F9D:
	RTS

CODE_0D9F9E:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	EOR.b $0E
	BPL.b CODE_0D9FB3
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	EOR.b $0E
	BPL.b CODE_0D9FB3
	JMP.w CODE_0DA05C

CODE_0D9FB3:
	LDA.w $7A38,x
	CMP.w #$FFE0
	BMI.b CODE_0DA028
	LDA.w $6FA2,x
	AND.w #$4000
	BEQ.b CODE_0D9FC6
	JMP.w CODE_0DA02A

CODE_0D9FC6:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BEQ.b CODE_0DA028
	EOR.b $0E
	BMI.b CODE_0DA028
	LDA.w $7D38,y
	BEQ.b CODE_0DA02A
	PHY
	LDA.w $7BB6,y
	SEC
	ADC.w $7BB6,x
	INC
	INC
	LDY.b $0E
	BMI.b CODE_0D9FE6
	EOR.w #$FFFF
	INC
CODE_0D9FE6:
	PLY
	CLC
	ADC.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	CLC
	ADC.w $70E2,y
	STA.w $70E2,y
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	CLC
	ADC.w #$00C0
	CMP.w #$0180
	BCC.b CODE_0DA012
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0DA012
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $7AF6,x
	STZ.b $78,x
CODE_0DA012:
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w $6FA2,y
	AND.w #$6000
	CMP.w #$6000
	BEQ.b CODE_0DA08D
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
CODE_0DA028:
	BRA.b CODE_0DA08D

CODE_0DA02A:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BEQ.b CODE_0DA08D
	EOR.b $0E
	BMI.b CODE_0DA08D
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w $7400,y
	EOR.w #$0002
	STA.w $7400,y
	LDA.w $75E0,y
	EOR.w #$FFFF
	INC
	STA.w $75E0,y
	LDA.w $70E2,y
	SEC
	SBC.w $72C0,y
	STA.w $70E2,y
	BRA.b CODE_0DA08D

CODE_0DA05C:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr09E_ChompRock
	BEQ.b CODE_0DA069
	LDA.w $7D38,y
	BEQ.b CODE_0DA02A
CODE_0DA069:
	LDA.b $18,x
	BNE.b CODE_0DA087
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	EOR.b $0E
	BPL.b CODE_0DA02A
	LDA.w #$0010
	STA.w $7BB6,x
	LDY.b #$02
	STY.b $18,x
	STZ.b $78,x
	LDA.w #!Define_YI_SoundID0E_ShellHit4
	JSL.l CODE_push_sound_queue
CODE_0DA087:
	LDA.w #$0010
	STA.w $7AF6,x
CODE_0DA08D:
	LDA.b $02
	BEQ.b CODE_0DA094
	JMP.w CODE_0D9F7F

CODE_0DA094:
	JMP.w CODE_0D9F55

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $154: Shark Chomp. Raiden: CODE_init_shark_chomp.
;---------------------------------------------------------------------------
YI_NorSpr154_SharkChomp_Init:
CODE_init_shark_chomp:
CODE_0DA097:
	LDA.w $70E2,x
	SEC
	SBC.w !RAM_YI_Global_Layer1XPosLo
	CMP.w #$FFB0
	BMI.b CODE_0DA0B0
	LDA.w #$00FF
	STA.w $74A2,x
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	RTL

CODE_0DA0B0:
	JSR.w CODE_0DA4CA
	STZ.w $7400,x
	LDA.w #$FFE8
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0007
	STA.w $74A2,x
	LDA.w #$0008
	STA.w $7540,x
	LDA.w #$0400
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.b #$15
	STY.w !RAM_YI_Global_MainScreenLayers
	LDA.w $6094
	SEC
	SBC.w $70E2,x
	CLC
	ADC.w #$0040
	STA.w !RAM_YI_Global_Layer3XPosLo
	LDA.w $609C
	SEC
	SBC.w $7182,x
	CLC
	ADC.w #$0040
	STA.w !RAM_YI_Global_Layer3YPosLo
	RTL

;---------------------------------------------------------------------------

DATA_0DA0F0:
; note: slots 3 and 4 are literal `dw $0004` (byte values, not code addresses). The current main_shark_chomp state-transition logic skips them entirely -- they look like leftover sentinels from a development branch where the state machine had 8-9 states rather than the 5 in production. See docs/family-fish.md.
	dw CODE_0DA21E
	dw CODE_0DA24A
	dw CODE_0DA270
	dw $0004
	dw $0004
	dw CODE_0DA2F4
	dw CODE_0DA332

;---------------------------------------------------------------------------
; Sprite $154 main. Raiden: main_shark_chomp.
;---------------------------------------------------------------------------
YI_NorSpr154_SharkChomp_Main:
main_shark_chomp:
;$0DA0FE
	JSR.w CODE_0DA167
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_0DA113
	LDA.w !RAM_YI_Global_MainScreenLayers
	AND.w #$1313
	STA.w !RAM_YI_Global_MainScreenLayers
	RTL

CODE_0DA113:
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0DA0F0,x)
	LDY.b $76,x
	CPY.b #$05
	BPL.b CODE_0DA15A
	JSR.w CODE_0DA416
	JSR.w CODE_0DA369
	JSR.w CODE_0DA386
	LDA.w #$0008
	STA.w $7540,x
	LDA.w $7680,x
	CMP.w #$FFC0
	BPL.b CODE_0DA141
	LDA.w #$0380
	BRA.b CODE_0DA144

CODE_0DA141:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_0DA144:
	STA.w $75E0,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCC.b CODE_0DA15A
	LDA.w #$0010
	STA.w $7540,x
CODE_0DA15A:
	RTL

DATA_0DA15B:
	dw $FFF0,$FFEE,$FFED

DATA_0DA161:
	dw $FFD1,$FFCE,$FFCC

CODE_0DA167:
	LDY.b $18,x
	LDA.w DATA_0DA15B,y
	CLC
	ADC.w $7680,x
	STA.b $00
	LDA.w DATA_0DA161,y
	CLC
	ADC.w $7682,x
	STA.b $02
	REP.b #$10
	LDY.w $7362,x
	LDA.b $00
	STA.w $6008,y
	STA.w $6010,y
	CLC
	ADC.w #$0008
	STA.w $6018,y
	CLC
	ADC.w #$0008
	STA.w $6000,y
	LDA.b $02
	STA.w $600A,y
	STA.w $601A,y
	CLC
	ADC.w #$0008
	STA.w $6012,y
	CLC
	ADC.w #$0008
	STA.w $6002,y
	SEP.b #$10
	LDA.w $6094
	SEC
	SBC.w $70E2,x
	CLC
	ADC.w #$0040
	STA.w !RAM_YI_Global_Layer3XPosLo
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCC.b CODE_0DA1CB
	LDA.w #$0100
	STA.w !RAM_YI_Global_Layer3XPosLo
CODE_0DA1CB:
	LDY.b $19,x
	BEQ.b CODE_0DA1F6
	LDA.w $7A36,x
	AND.w #$FF00
	XBA
	STA.b $00
	REP.b #$10
	LDY.w $7362,x
	LDA.w $604A,y
	CLC
	ADC.b $00
	STA.w $604A,y
	LDA.w $6052,y
	CLC
	ADC.b $00
	STA.w $6052,y
	SEP.b #$10
	LDA.w #$0000
	BRA.b CODE_0DA1FF

CODE_0DA1F6:
	LDA.b $10
	AND.w #$0003
	SEC
	SBC.w #$0002
CODE_0DA1FF:
	CLC
	ADC.w $609C
	SEC
	SBC.w $7182,x
	CLC
	ADC.w #$0040
	STA.w !RAM_YI_Global_Layer3YPosLo
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCC.b CODE_0DA21D
	LDA.w #$0100
	STA.w !RAM_YI_Global_Layer3YPosLo
CODE_0DA21D:
	RTS

CODE_0DA21E:
	TYX
	LDA.w $7680,x
	CMP.w #$0000
	BMI.b CODE_0DA241
	LDA.w #$0020
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.b #$01
	LDA.w $0C1C
	BEQ.b CODE_0DA23F
	LDA.w $70E2,x
	CLC
	ADC.w #$0080
	STA.b $78,x
	LDY.b #$03
CODE_0DA23F:
	STY.b $76,x
CODE_0DA241:
	RTS

DATA_0DA242:
	dw $0220,$0260,$0280,$02C0

CODE_0DA24A:
	TYX
	LDA.w $7680,x
	CMP.b $78,x
	BPL.b CODE_0DA267
	LDA.b $10
	AND.w #$001F
	STA.b $78,x
	LDA.b $10
	AND.w #$0006
	TAY
	LDA.w DATA_0DA242,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $76,x
CODE_0DA267:
	RTS

DATA_0DA268:
	dw $0080,$00A0,$00C0,$0100

CODE_0DA270:
	TYX
	LDA.w $7680,x
	CMP.b $78,x
	BMI.b CODE_0DA291
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$FFC0
	STA.b $78,x
	LDA.b $10
	AND.w #$0006
	TAY
	LDA.w DATA_0DA268,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEC.b $76,x
CODE_0DA291:
	RTS

DATA_0DA292:
	dw $0000,$0200,$0000,$0200

DATA_0DA29A:
	dw $0200,$0400

CODE_0DA29E:
	TYX
	LDA.w $70E2,x
	CMP.b $78,x
	BMI.b CODE_0DA2BD
	LDA.b $78,x
	CLC
	ADC.w #$0100
	STA.b $78,x
	LDY.w $7A38,x
	LDA.w DATA_0DA292,y
	TAY
	LDA.w DATA_0DA29A,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $76,x
CODE_0DA2BD:
	RTS

DATA_0DA2BE:
	dw $0002,$0000,$0200,$0000

DATA_0DA2C6:
	dw $0020,$0060

CODE_0DA2CA:
	TYX
	LDA.w $70E2,x
	CMP.b $78,x
	BMI.b CODE_0DA2F3
	LDA.b $78,x
	CLC
	ADC.w #$0080
	STA.b $78,x
	LDY.w $7A38,x
	LDA.w DATA_0DA2BE,y
	TAY
	LDA.w DATA_0DA2C6,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $7A38,x
	INC
	AND.w #$0007
	STA.w $7A38,x
	DEC.b $76,x
CODE_0DA2F3:
	RTS

CODE_0DA2F4:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0DA331
	LDA.b $78,x
	CLC
	ADC.w #$0008
	CMP.w #$0200
	BMI.b CODE_0DA308
	LDA.w #$0200
CODE_0DA308:
	STA.b $78,x
	CLC
	ADC.w $7A36,x
	CMP.w #$1400
	BMI.b CODE_0DA32E
	LDA.w #$FF00
	STA.b $78,x
	LDA.w #!Define_YI_SoundID56_ThunderLakituAttacking6
	JSL.l CODE_push_sound_queue
	DEC.b $16,x
	BNE.b CODE_0DA32B
	LDA.w #$0040
	STA.w $7A96,x
	INC.b $76,x
CODE_0DA32B:
	LDA.w #$1400
CODE_0DA32E:
	STA.w $7A36,x
CODE_0DA331:
	RTS

CODE_0DA332:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0DA350
	LDA.w #$0040
	CMP.w $7542,x
	BEQ.b CODE_0DA350
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #!Define_YI_SoundID82_BossFalling
	JSL.l CODE_push_sound_queue
CODE_0DA350:
	LDA.w $7682,x
	CMP.w #$0140
	BMI.b CODE_0DA368
	STZ.w $7ECC
	JSL.l CODE_despawn_sprite_free_slot
	LDA.w !RAM_YI_Global_MainScreenLayers
	AND.w #$1313
	STA.w !RAM_YI_Global_MainScreenLayers
CODE_0DA368:
	RTS

CODE_0DA369:
	LDA.w $7C16,x
	CLC
	ADC.w #$0018
	CMP.w #$0030
	BCS.b CODE_0DA385
	LDA.w $7C18,x
	CLC
	ADC.w #$0030
	CMP.w #$0060
	BCS.b CODE_0DA385
	JSL.l CODE_03A858
CODE_0DA385:
	RTS

CODE_0DA386:
	LDA.w #$0002
	STA.b $0E
CODE_0DA38B:
	LDA.w $70E2,x
	CLC
	ADC.w #$0030
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w $0091
	LDA.w $7182,x
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $0093
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$F800
	CMP.w #$4000
	BNE.b CODE_0DA3C1
	JSL.l CODE_0DA46B
	BRA.b CODE_0DA3FC

CODE_0DA3C1:
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_0DA3FC
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDY.b $18,x
	CPY.b #$04
	BNE.b CODE_0DA3FA
	LDA.w #!Define_YI_SoundID84_TapTapTheRedNoseWalk
	JSL.l CODE_push_sound_queue
	LDA.w #$0040
	STA.w $61C8
	INC.b $19,x
	STZ.b $78,x
	STZ.w $7A36,x
	LDY.b #$03
	STY.b $16,x
	LDA.w #$0040
	STA.w $7A96,x
	LDA.w #$5C01
	STA.w $7040,x
	LDY.b #$05
	STY.b $76,x
CODE_0DA3FA:
	PLA
	RTL

CODE_0DA3FC:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w #$0010
	CMP.w #$0028
	BMI.b CODE_0DA40B
	LDA.w #$FFE8
CODE_0DA40B:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC.b $0E
	BEQ.b CODE_0DA415
	JMP.w CODE_0DA38B

CODE_0DA415:
	RTS

CODE_0DA416:
	LDA.w $72C0,x
	CLC
	ADC.w $7A36,x
	CMP.w #$0008
	BMI.b CODE_0DA43D
	SEC
	SBC.w #$0008
	PHA
	LDY.b $18,x
	INY
	INY
	CPY.b #$06
	BNE.b CODE_0DA431
	LDY.b #$00
CODE_0DA431:
	STY.b $18,x
	JSR.w CODE_0DA4CA
	LDA.w #$0008
	STA.w $7A98,x
	PLA
CODE_0DA43D:
	STA.w $7A36,x
	LDA.w $7A98,x
	BNE.b CODE_0DA45D
	LDA.w #$0008
	STA.w $7A98,x
	STZ.w $7A36,x
	LDY.b $18,x
	INY
	INY
	CPY.b #$06
	BNE.b CODE_0DA458
	LDY.b #$00
CODE_0DA458:
	STY.b $18,x
	JSR.w CODE_0DA4CA
CODE_0DA45D:
	LDY.b $18,x
	CPY.b #$04
	BNE.b CODE_0DA46A
	LDA.w #!Define_YI_SoundID64_UnlockDoor
	JSL.l CODE_push_sound_queue
CODE_0DA46A:
	RTS

CODE_0DA46B:
	LDA.w #$0000
	STA.w $008F
	JSL.l CODE_change_map16
	LDX.b $12
	BRA.b CODE_0DA48C

CODE_0DA479:					; Note: Routine for when a chomp rock touches breakable soft dirt tiles.
	LDA.w #$0000
	STA.w $008F
	JSL.l CODE_change_map16
	LDX.b $12
CODE_0DA485:
	LDA.w #!Define_YI_SoundID0A_BreakDirt
	JSL.l CODE_push_sound_queue
CODE_0DA48C:
	LDA.w #!Define_YI_AmbSpr1C3
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $0091
	AND.w #$FFF0
	STA.w $70A2,y
	LDA.w $0093
	AND.w #$FFF0
	STA.w $7142,y
	LDA.w #$FF80
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$000A
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #$0008
	STA.w $7502,y
	LDA.w #$0400
	STA.w $75A2,y
	RTL

DATA_0DA4C4:
	dw $5DA8,$5FA8,$61A8

CODE_0DA4CA:
	LDY.b $18,x
	LDA.w DATA_0DA4C4,y
	STA.b $00
	PHX
	PHB
	SEP.b #$20
	LDA.b #$7E4800>>16
	PHA
	PLB
	REP.b #$30
	LDX.w #$7E4800
	INX
	INX
	LDA.w #$3401
	STA.w $0000,x
	LDA.w #$0180
	STA.w $0002,x
	LDA.w #$0018
	STA.w $0004,x
	LDA.b $00
	STA.w $0005,x
	LDA.w #$007E
	STA.w $0007,x
	LDA.w #$01CC
	STA.w $0008,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,x
	STA.w $7E4800
	SEP.b #$10
	PLB
	PLX
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprites $15C / $15D: Switches that toggle the green/red spiked-platform pair.
; Raiden: init_spiked_platform_switch.
;---------------------------------------------------------------------------
YI_NorSpr15C_GreenRotatingPlatformSwitch_Init:
YI_NorSpr15D_RedRotatingPlatformSwitch_Init:
init_spiked_platform_switch:
;$0DA513
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr15C_GreenRotatingPlatformSwitch
	ASL
	STA.b $78,x
	STZ.w $7400,x
	LDA.w $7182,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprites $15C / $15D main (shared). Raiden: main_spiked_platform_switch.
;---------------------------------------------------------------------------
YI_NorSpr15C_GreenRotatingPlatformSwitch_Main:
YI_NorSpr15D_RedRotatingPlatformSwitch_Main:
main_spiked_platform_switch:
;$0DA527
	JSL.l CODE_03AF23
	LDY.b $78,x
	LDA.w $0FD1,y
	CMP.w $0FD5,y
	BNE.b CODE_0DA538
	JSR.w CODE_0DAA6B
CODE_0DA538:
	JSL.l CODE_03D291
	JSL.l CODE_03D127
	LDA.w $7542,x
	BEQ.b CODE_0DA556
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w $7182,x
	BPL.b CODE_0DA556
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
CODE_0DA556:
	LDA.w $7040,x
	AND.w #$FFF3
	STA.w $7040,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprites $15F / $160: Green/Red spiked platform pair (the platforms themselves,
; controlled by switches $15C/$15D). Raiden: init_spiked_platform.
;
; See docs/family-platforms.md §3 for the full switch-driven platform
; sub-family. The pair-index ($78=0 green / $78=2 red) is derived from
; SpriteID - $15F << 1 and indexes 4 parallel global arrays
; ($0FC1+y / $0FCD+y / $0FD1+y / $0FD5+y) keyed by pair-index.
;---------------------------------------------------------------------------
YI_NorSpr15F_GreenSpikedPlatform_Init:
YI_NorSpr160_RedSpikedPlatform_Init:
init_spiked_platform:
;$0DA560
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr15F_GreenSpikedPlatform
	ASL
	STA.b $78,x
	TAY
	LDA.w $0FC1,y
	BNE.b CODE_0DA5A1
	JSL.l CODE_03AE60
	LDY.b $78,x
	LDA.w $7722,x
	INC
	STA.w $0FC1,y
	JSL.l CODE_03AD74
	BCS.b CODE_0DA58F
	LDY.b $78,x
	LDA.w #$0000
	STA.w $0FC1,y
	JML.l CODE_03A31E

CODE_0DA58F:
	LDY.b $78,x
	LDA.w $7722,x
	INC
	STA.w $0FC5,y
	LDA.w #$FFFF
	STA.w $7722,x
	JSR.w CODE_0DA712
CODE_0DA5A1:
	LDY.b $78,x
	LDA.w $0FCD,y
	INC
	STA.w $0FCD,y
	STZ.w $7400,x
	LDA.w #$0019
	STA.w $7BB6,x
	LDA.w #$0007
	STA.w $7BB8,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprites $15F / $160 main (shared). Raiden: main_spiked_platform.
;---------------------------------------------------------------------------
YI_NorSpr15F_GreenSpikedPlatform_Main:
YI_NorSpr160_RedSpikedPlatform_Main:
main_spiked_platform:
;$0DA5BA
	JSR.w CODE_0DA5D7
	JSL.l CODE_03AF23
	JSR.w CODE_0DA69C
	JSR.w CODE_0DA7E6
	JSR.w CODE_0DA8B8
	JSR.w CODE_0DA6DC
	LDA.w $7040,x
	AND.w #$FFF3
	STA.w $7040,x
	RTL

CODE_0DA5D7:
	LDA.w $7362,x
	BPL.b CODE_0DA5DD
CODE_0DA5DC:
	RTS

CODE_0DA5DD:
	LDY.b $78,x
	LDA.w $0FC1,y
	DEC
	STA.w $7722,x
	JSL.l CODE_03AA52
	LDY.b $78,x
	LDA.w $0FC5,y
	DEC
	STA.w $7722,x
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0020
	TAY
	JSL.l CODE_03AA60
	LDA.w #$FFFF
	STA.w $7722,x
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_0DA61C
	LDY.b $78,x
	LDA.w $0FBD,y
	CMP.w $7974
	BNE.b CODE_0DA5DC
CODE_0DA61C:
	LDY.b $78,x
	LDA.w $0FD9,y
	STA.b $00
	LDA.w $0FDD,y
	STA.b $02
	LDA.w $0FE1,y
	STA.b $04
	LDA.w $0FE5,y
	STA.b $06
	REP.b #$10
	LDY.w $7362,x
	BMI.b CODE_0DA699
	LDA.w $6000,y
	SEC
	SBC.b $00
	STA.w $6000,y
	STA.w $6010,y
	LDA.w $6008,y
	SEC
	SBC.b $00
	STA.w $6008,y
	STA.w $6018,y
	LDA.w $6002,y
	SEC
	SBC.b $02
	STA.w $6002,y
	STA.w $600A,y
	LDA.w $6012,y
	SEC
	SBC.b $02
	STA.w $6012,y
	STA.w $601A,y
	LDA.w $6020,y
	CLC
	ADC.b $04
	STA.w $6020,y
	STA.w $6030,y
	LDA.w $6028,y
	CLC
	ADC.b $04
	STA.w $6028,y
	STA.w $6038,y
	LDA.w $6022,y
	CLC
	ADC.b $06
	STA.w $6022,y
	STA.w $602A,y
	LDA.w $6032,y
	CLC
	ADC.b $06
	STA.w $6032,y
	STA.w $603A,y
CODE_0DA699:
	SEP.b #$10
CODE_0DA69B:
	RTS

CODE_0DA69C:
	JSL.l CODE_03A2C7
	BCC.b CODE_0DA69B
	LDY.b $78,x
	LDA.w $0FCD,y
	DEC
	STA.w $0FCD,y
	BNE.b CODE_0DA6D1
	LDA.w $0FC1,y
	DEC
	STA.w $7722,x
	LDA.w #$0000
	STA.w $0FC1,y
	JSL.l CODE_03AEFD
	LDY.b $78,x
	LDA.w $0FC5,y
	DEC
	STA.w $7722,x
	LDA.w #$0000
	STA.w $0FC5,y
	JSL.l CODE_03AEFD
CODE_0DA6D1:
	LDA.w #$FFFF
	STA.w $7722,x
	PLA
	JML.l CODE_03A31E

CODE_0DA6DC:
	LDY.b $78,x
	LDA.w $7974
	CMP.w $0FBD,y
	BEQ.b CODE_0DA711
	STA.w $0FBD,y
	LDA.w $0FD1,y
	CMP.w $0FD5,y
	BEQ.b CODE_0DA70E
	SEC
	SBC.w #$0020
	STA.w $0FD1,y
	SEC
	SBC.w $0FD5,y
	CLC
	ADC.w #$000F
	CMP.w #$001E
	BCS.b CODE_0DA70B
	LDA.w $0FD5,y
	STA.w $0FD1,y
CODE_0DA70B:
	JSR.w CODE_0DA712
CODE_0DA70E:
	JSR.w CODE_0DA61C
CODE_0DA711:
	RTS

CODE_0DA712:
	LDA.w #FXDATA_550000+$40C0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$40C0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.b $78,x
	LDA.w $0FD1,y
	AND.w #$01FE
	LSR
	STA.b $00
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $0FC1,y
	TAX
	DEX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #FXDATA_550000+$40C0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$40C0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.b $00
	EOR.w #$FFFF
	INC
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.b $78,x
	LDA.w $0FC5,y
	TAX
	DEX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	LDA.w #$000D
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.b $78,x
	LDA.w $0FD1,y
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.b $78,x
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $0FD9,y
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $0FDD,y
	LDA.w #$000C
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.b $78,x
	LDA.w $0FD1,y
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.b $78,x
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $0FE1,y
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $0FE5,y
	RTS

CODE_0DA7E6:
	LDY.b $78,x
	LDA.w $0FD1,y
	CMP.w $0FD5,y
	BNE.b CODE_0DA807
	JSL.l CODE_03D127
	BCC.b CODE_0DA806
	DEC.b $0E
	LDY.b $78,x
	LDA.w $0FC9,y
	DEC
	EOR.b $0E
	BPL.b CODE_0DA806
	JSL.l CODE_03A858
CODE_0DA806:
	RTS

CODE_0DA807:
	LDA.w $7C16,x
	CLC
	ADC.w #$0021
	CMP.w #$0042
	BCS.b CODE_0DA806
	LDA.w $7C18,x
	CLC
	ADC.w #$0013
	CMP.w #$0026
	BCS.b CODE_0DA806
	LDA.w $7C16,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7C18,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $00
	CLC
	ADC.w #$0080
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0400
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $60FC
	AND.w #$01E0
	BEQ.b CODE_0DA867
	AND.w #$0180
	DEC
	EOR.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BPL.b CODE_0DA870
CODE_0DA867:
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $60A8
	STA.w $60B4
CODE_0DA870:
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	EOR.w #$FFFF
	INC
	STA.b $00
	LDA.w $60FC
	AND.w #$001F
	BEQ.b CODE_0DA889
	AND.w #$0018
	DEC
	EOR.b $00
	BMI.b CODE_0DA89F
CODE_0DA889:
	LDA.b $00
	BPL.b CODE_0DA89C
	PHA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	PLA
	ASL
CODE_0DA89C:
	STA.w $60AA
CODE_0DA89F:
	LDY.b $78,x
	LDA.w $0FD1,y
	AND.w #$01FE
	SEC
	SBC.b $00
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCC.b CODE_0DA8B7
	JSL.l CODE_03A858
CODE_0DA8B7:
	RTS

CODE_0DA8B8:
	LDY.b $78,x
	LDA.w $0FD1,y
	CMP.w $0FD5,y
	BNE.b CODE_0DA8C6
	JSL.l CODE_03D291
CODE_0DA8C6:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $162: Two spiked platforms with one switch.
; Raiden: init_two_spiked_platforms_with_switch.
;---------------------------------------------------------------------------
YI_NorSpr162_DoubleSpikePlatformWithSwitch_Init:
init_two_spiked_platforms_with_switch:
;$0DA8C7
	JSL.l CODE_03AE60
	LDA.w $7722,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSL.l CODE_03AD74
	BCS.b CODE_0DA8E1
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7722,x
	JML.l CODE_03A31E

CODE_0DA8E1:
	JSR.w CODE_0DAB6A
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $7400,x
	LDA.w #$0008
	STA.w $7BB8,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $162 main. Raiden: main_two_spiked_platforms_with_switch.
;---------------------------------------------------------------------------
YI_NorSpr162_DoubleSpikePlatformWithSwitch_Main:
main_two_spiked_platforms_with_switch:
;$0DA8F1
	JSR.w CODE_0DA911
	JSL.l CODE_03AF23
	JSR.w CODE_0DAC2D
	JSR.w CODE_0DAA52
	JSR.w CODE_0DAC43
	JSR.w CODE_0DAF16
	JSR.w CODE_0DAAF5
	LDA.w $7040,x
	AND.w #$FFF3
	STA.w $7040,x
	RTL

CODE_0DA911:
	LDA.w $7362,x
	BPL.b CODE_0DA917
CODE_0DA916:
	RTS

CODE_0DA917:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_0DA916
CODE_0DA922:
	JSL.l CODE_03AA52
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0040
	TAY
	JSL.l CODE_03AA60
	LDA.w $7722,x
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7722,x
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0020
	TAY
	JSL.l CODE_03AA60
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0060
	TAY
	JSL.l CODE_03AA60
	PLA
	STA.w $7722,x
	LDA.b $18,x
	STA.b $00
	LDA.b $76,x
	STA.b $02
	LDA.b $78,x
	STA.b $04
	LDA.w $7A36,x
	STA.b $06
	REP.b #$10
	LDY.w $7362,x
	BMI.b CODE_0DA916
	LDA.w $6000,y
	SEC
	SBC.b $00
	STA.w $6000,y
	STA.w $6010,y
	LDA.w $6008,y
	SEC
	SBC.b $00
	STA.w $6008,y
	STA.w $6018,y
	LDA.w $6002,y
	SEC
	SBC.b $02
	STA.w $6002,y
	STA.w $600A,y
	LDA.w $6012,y
	SEC
	SBC.b $02
	STA.w $6012,y
	STA.w $601A,y
	LDA.w $6020,y
	SEC
	SBC.b $04
	STA.w $6020,y
	STA.w $6030,y
	LDA.w $6028,y
	SEC
	SBC.b $04
	STA.w $6028,y
	STA.w $6038,y
	LDA.w $6022,y
	SEC
	SBC.b $06
	STA.w $6022,y
	STA.w $602A,y
	LDA.w $6032,y
	SEC
	SBC.b $06
	STA.w $6032,y
	STA.w $603A,y
	LDA.w $6040,y
	CLC
	ADC.b $04
	STA.w $6040,y
	STA.w $6050,y
	LDA.w $6048,y
	CLC
	ADC.b $04
	STA.w $6048,y
	STA.w $6058,y
	LDA.w $6042,y
	CLC
	ADC.b $06
	STA.w $6042,y
	STA.w $604A,y
	LDA.w $6052,y
	CLC
	ADC.b $06
	STA.w $6052,y
	STA.w $605A,y
	LDA.w $6060,y
	CLC
	ADC.b $00
	STA.w $6060,y
	STA.w $6070,y
	LDA.w $6068,y
	CLC
	ADC.b $00
	STA.w $6068,y
	STA.w $6078,y
	LDA.w $6062,y
	CLC
	ADC.b $02
	STA.w $6062,y
	STA.w $606A,y
	LDA.w $6072,y
	CLC
	ADC.b $02
	STA.w $6072,y
	STA.w $607A,y
	LDA.w $7A98,x
	BNE.b CODE_0DAA43
	LDA.w $7A38,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0DAA4F
CODE_0DAA43:
	LDA.w $6084,y
	AND.w #$F1FF
	ORA.w #$F800
	STA.w $6084,y
CODE_0DAA4F:
	SEP.b #$10
	RTS

CODE_0DAA52:
	LDA.w $7A38,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0DAA5D
	JSR.w CODE_0DAA6B
CODE_0DAA5D:
	JSL.l CODE_03D127
	BCS.b CODE_0DAA66
	STZ.w $7D36,x
CODE_0DAA66:
	JSL.l CODE_03D291
	RTS

CODE_0DAA6B:
	LDY.w $60AB
	BPL.b CODE_0DAA96
	LDY.w $60C0
	BEQ.b CODE_0DAA96
	LDA.w $7C16,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_0DAA96
	LDA.w $7C18,x
	CMP.w #$FFE8
	BMI.b CODE_0DAA96
	CMP.w #$FFF0
	BPL.b CODE_0DAA96
	STZ.w $60AA
	STZ.w $60D2
	BRA.b CODE_0DAAAE

CODE_0DAA96:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0DAAF4
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0DAAF4
	LDA.w $7D38,y
	BEQ.b CODE_0DAAF4
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
CODE_0DAAAE:
	LDA.w #!Define_YI_SoundID32_HitMessageBox
	JSL.l CODE_push_sound_queue
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr162_DoubleSpikePlatformWithSwitch
	BEQ.b CODE_0DAAE4
	LDY.b $78,x
	LDA.w $0FC9,y
	EOR.w #$0002
	STA.w $0FC9,y
	LDA.w $0FD5,y
	SEC
	SBC.w #$0500
	STA.w $0FD5,y
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0DAAE3
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
CODE_0DAAE3:
	RTS

CODE_0DAAE4:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7A98,x
CODE_0DAAF4:
	RTS

CODE_0DAAF5:
	LDA.w $7A98,x
	BEQ.b CODE_0DAB0D
	DEC
	BNE.b CODE_0DAB57
	LDA.b $16,x
	EOR.w #$0002
	STA.b $16,x
	LDA.w #!Define_YI_SoundID40_OpenDoor
	JSL.l CODE_push_sound_queue
	BRA.b CODE_0DAB57

CODE_0DAB0D:
	LDA.w $7A38,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0DAB57
	AND.w #$00FE
	SEC
	SBC.w #$007E
	CMP.w #$0004
	BCS.b CODE_0DAB30
	LDA.w $7A96,x
	BEQ.b CODE_0DAB5B
	DEC
	BNE.b CODE_0DAB57
	LDA.w #!Define_YI_SoundID40_OpenDoor
	JSL.l CODE_push_sound_queue
CODE_0DAB30:
	LDA.w $7A38,x
	SEC
	SBC.w #$0004
	STA.w $7A38,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0002
	CMP.w #$0004
	BCS.b CODE_0DAB54
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $7A38,x
	LDA.w #!Define_YI_SoundID41_CloseDoor
	JSL.l CODE_push_sound_queue
CODE_0DAB54:
	JSR.w CODE_0DAB6A
CODE_0DAB57:
	JSR.w CODE_0DA922
	RTS

CODE_0DAB5B:
	LDA.w #$0040
	STA.w $7A96,x
	LDA.w #!Define_YI_SoundID41_CloseDoor
	JSL.l CODE_push_sound_queue
	BRA.b CODE_0DAB57

CODE_0DAB6A:
	LDA.w #FXDATA_550000+$40C0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$40C0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	AND.w #$01FE
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #FXDATA_550000+$40C0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$40C0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	EOR.w #$FFFF
	INC
	AND.w #$01FE
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	LDA.w #$002E
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A38,x
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $18,x
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.b $76,x
	LDA.w #$0016
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A38,x
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $78,x
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $7A36,x
CODE_0DAC2C:
	RTS

CODE_0DAC2D:
	JSL.l CODE_despawn_sprite
	BCC.b CODE_0DAC2C
	JSL.l CODE_03AEFD
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7722,x
	JSL.l CODE_03AEFD
	PLA
	RTL

CODE_0DAC43:
	LDA.w $7A98,x
	BNE.b CODE_0DAC71
	LDA.w $7A96,x
	BEQ.b CODE_0DAC69
	LDA.w #$0007
	STA.b $0C
	LDA.w #$0038
	STA.b $0E
	JSR.w CODE_0DAC9C
	BCS.b CODE_0DAC68
	LDA.b $16,x
	DEC
	EOR.w $7C16,x
	BPL.b CODE_0DAC68
	JSL.l CODE_03A858
CODE_0DAC68:
	RTS

CODE_0DAC69:
	LDA.w $7A38,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0DAC98
CODE_0DAC71:
	LDY.w $7D36,x
	BMI.b CODE_0DAC97
	LDA.w #$0038
	STA.b $0C
	LDA.w #$0007
	STA.b $0E
	JSR.w CODE_0DAC9C
	BCC.b CODE_0DAC97
	DEC.b $0E
	LDA.b $16,x
	DEC
	EOR.b $0E
	BPL.b CODE_0DAC97
	LDY.w $7D36,x
	BPL.b CODE_0DAC97
	JSL.l CODE_03A858
CODE_0DAC97:
	RTS

CODE_0DAC98:
	JSR.w CODE_0DACF2
	RTS

CODE_0DAC9C:
	STZ.w $7D36,x
	LDA.w $6120
	CLC
	ADC.b $0C
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7C16,x
	CMP.b $00
	BCS.b CODE_0DACF1
	LDA.w $6122
	CLC
	ADC.b $0E
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7C18,x
	CMP.b $00
	BCS.b CODE_0DACF1
	LDA.w #$00FF
	STA.w $7D36,x
	LDA.w $7BB6,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7BB8,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $0C
	STA.w $7BB6,x
	LDA.b $0E
	STA.w $7BB8,x
	JSL.l CODE_03D127
	PHP
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $7BB6,x
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $7BB8,x
	PLP
CODE_0DACF1:
	RTS

CODE_0DACF2:
	LDA.w $7A38,x
	CLC
	ADC.w #$0080
	AND.w #$00FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0006
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BMI.b CODE_0DAD19
	EOR.w #$FFFF
	INC
CODE_0DAD19:
	SEC
	SBC.w $6120
	STA.b $08
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEC
	SBC.w $6122
	STA.b $0A
	LDA.w $7C16,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7C18,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w #$0100
	AND.w #$01FE
	STA.b $06
	STZ.w $6000
	STZ.w $6002
	STZ.w $6004
	LDA.w $7A38,x
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.b $0C
	AND.w #$00FE
	STA.b $02
	ORA.w #$0100
	STA.b $04
	LDA.w #$0040
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $603E
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BPL.b CODE_0DAD89
	EOR.w #$FFFF
	INC
CODE_0DAD89:
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7C16,x
	CMP.b $00
	BCS.b CODE_0DADDC
	LDA.w $7C16,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	REP.b #$10
	LDA.b $0C
	AND.w #$00FE
	TAX
	LDA.l FXDATA_0BBA12,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	SEP.b #$10
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w $7C18,x
	STA.b $0E
	LDA.b $06
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	JSR.w CODE_0DAE9C
	LDA.w $60FC
	AND.w #$001F
	BEQ.b CODE_0DADDC
	AND.w #$0018
	DEC
	EOR.w $6000
	BPL.b CODE_0DADDC
	STZ.w $6000
CODE_0DADDC:
	LDA.w $603E
	BPL.b CODE_0DADE5
	EOR.w #$FFFF
	INC
CODE_0DADE5:
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7C18,x
	CMP.b $00
	BCS.b CODE_0DAE3B
	LDA.w $7C18,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	REP.b #$10
	LDA.w #$0080
	SEC
	SBC.b $0C
	AND.w #$00FE
	TAX
	LDA.l FXDATA_0BBA12,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	SEP.b #$10
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w $7C16,x
	STA.b $0E
	LDA.b $06
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	JSR.w CODE_0DAEDB
	LDA.w $60FC
	AND.w #$01E0
	BEQ.b CODE_0DAE3B
	AND.w #$0180
	EOR.w $6002
	BPL.b CODE_0DAE3B
	STZ.w $6002
CODE_0DAE3B:
	LDY.w $6004
	BNE.b CODE_0DAE41
	RTS

CODE_0DAE41:
	LDA.w $6000
	BPL.b CODE_0DAE4A
	EOR.w #$FFFF
	INC
CODE_0DAE4A:
	STA.b $00
	LDA.w $6002
	BPL.b CODE_0DAE55
	EOR.w #$FFFF
	INC
CODE_0DAE55:
	CMP.b $00
	BPL.b CODE_0DAE75
	LDA.w $6000
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDY.w $6001
	BPL.b CODE_0DAE6D
	INC.w $61B4
	BRA.b CODE_0DAE7F

CODE_0DAE6D:
	STZ.w $60AA
	STZ.w $60D2
	BRA.b CODE_0DAE7F

CODE_0DAE75:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w $6002
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_0DAE7F:
	LDA.b $06
	LDY.b $0D
	BEQ.b CODE_0DAE8F
	CMP.b $02
	BMI.b CODE_0DAE9B
	CMP.b $04
	BPL.b CODE_0DAE9B
	BRA.b CODE_0DAE97

CODE_0DAE8F:
	CMP.b $02
	BMI.b CODE_0DAE97
	CMP.b $04
	BMI.b CODE_0DAE9B
CODE_0DAE97:
	JSL.l CODE_03A858
CODE_0DAE9B:
	RTS

CODE_0DAE9C:
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDY.b $0C
	BMI.b CODE_0DAEAD
	CMP.b $02
	BMI.b CODE_0DAEC6
	CMP.b $04
	BPL.b CODE_0DAEC6
	BRA.b CODE_0DAEB5

CODE_0DAEAD:
	CMP.b $02
	BMI.b CODE_0DAEB5
	CMP.b $04
	BMI.b CODE_0DAEC6
CODE_0DAEB5:
	LDA.b $0E
	SEC
	SBC.b $0A
	CMP.w #$0008
	BCS.b CODE_0DAEDA
	STA.w $6000
	INC.w $6004
	RTS

CODE_0DAEC6:
	LDA.b $0E
	SEC
	SBC.w $6112
	CLC
	ADC.b $0A
	CMP.w #$FFF8
	BCC.b CODE_0DAEDA
	STA.w $6000
	INC.w $6004
CODE_0DAEDA:
	RTS

CODE_0DAEDB:
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDY.b $0C
	BMI.b CODE_0DAEEC
	CMP.b $02
	BMI.b CODE_0DAF05
	CMP.b $04
	BPL.b CODE_0DAF05
	BRA.b CODE_0DAEF4

CODE_0DAEEC:
	CMP.b $02
	BMI.b CODE_0DAF05
	CMP.b $04
	BPL.b CODE_0DAF05
CODE_0DAEF4:
	LDA.b $0E
	SEC
	SBC.b $08
	CMP.w #$0008
	BCS.b CODE_0DAF15
	STA.w $6002
	INC.w $6004
	RTS

CODE_0DAF05:
	LDA.b $0E
	CLC
	ADC.b $08
	CMP.w #$FFF8
	BCC.b CODE_0DAF15
	STA.w $6002
	INC.w $6004
CODE_0DAF15:
	RTS

CODE_0DAF16:
	LDA.w $7A98,x
	BNE.b CODE_0DAF23
	LDA.w $7A38,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0DAF4B
CODE_0DAF23:
	LDA.w $7BB6,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7BB8,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0038
	STA.w $7BB6,x
	LDA.w #$0007
	STA.w $7BB8,x
	JSL.l CODE_03D291
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $7BB6,x
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $7BB8,x
CODE_0DAF4B:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $077: Counter-clockwise Piro Dangle. Raiden: init_piro_dangle_anticlockwise.
;---------------------------------------------------------------------------
YI_NorSpr077_CounterclockwisePiroDangle_Init:
init_piro_dangle_anticlockwise:
;$0DAF4C
	LDY.b #$0A
	STY.b $79,x
;---------------------------------------------------------------------------
; Sprite $076: Clockwise Piro Dangle. Raiden: init_piro_dangle_clockwise.
;---------------------------------------------------------------------------
YI_NorSpr076_ClockwisePiroDangle_Init:
init_piro_dangle_clockwise:
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	XBA
	STA.w $7A36,x
	STZ.w $7400,x
	LDA.w #$0040
	STA.w $7542,x
	LDY.b #$04
	STY.b $76,x
	RTL

;---------------------------------------------------------------------------

DATA_0DAF68:
	dw CODE_0DB02D
	dw CODE_0DB040
	dw CODE_0DB062
	dw CODE_0DB09C
	dw CODE_0DB102
	dw CODE_0DB02D
	dw CODE_0DB040
	dw CODE_0DB062
	dw CODE_0DB09C

DATA_0DAF7A:
	db $00,$80,$40,$C0

;---------------------------------------------------------------------------
; Sprites $076 / $077 main (shared). Raiden: main_piro_dangle.
;---------------------------------------------------------------------------
YI_NorSpr076_ClockwisePiroDangle_Main:
YI_NorSpr077_CounterclockwisePiroDangle_Main:
main_piro_dangle:
;$0DAF7E
	LDA.w $7D96,x
	BNE.b CODE_0DAF86
	JSR.w CODE_0DB20B
CODE_0DAF86:
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0010
	TAY
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0DAFC9
	LDA.w #$FFF8
	CLC
	ADC.w $7680,x
	STA.w $6000,y
	STA.w $6010,y
	CLC
	ADC.w #$0010
	STA.w $6008,y
	STA.w $6018,y
	LDA.w #$FFF8
	CLC
	ADC.w $7682,x
	STA.w $6002,y
	STA.w $600A,y
	CLC
	ADC.w #$0010
	STA.w $6012,y
	STA.w $601A,y
	JSL.l CODE_03AA60
	BRA.b CODE_0DAFE9

CODE_0DAFC9:
	PHX
	LDA.b $78,x
	AND.w #$00FF
	TAX
	SEP.b #$20
	LDA.w $6005,y
	ORA.w DATA_0DAF7A,x
	STA.w $6005,y
	STA.w $600D,y
	STA.w $6015,y
	STA.w $601D,y
	REP.b #$20
	PLX
	SEP.b #$10
CODE_0DAFE9:
	JSL.l CODE_03AF23
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0DAFF6
	JSL.l CODE_03A5B7
CODE_0DAFF6:
	TXY
	LDA.b $76,x
	AND.w #$00FF
	ASL
	TAX
	JSR.w (DATA_0DAF68,x)
	LDA.w $7A96,x
	BNE.b CODE_0DB02C
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w $7A38,x
	CLC
	ADC.w #$0080
	AND.w #$01FE
	STA.w $7A38,x
	LDA.w $7402,x
	INC
	AND.w #$0003
	STA.w $7402,x
	LDA.b $78,x
	INC
	AND.w #$0003
	TAY
	STY.b $78,x
CODE_0DB02C:
	RTL

CODE_0DB02D:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0DB03F
	JSL.l CODE_03AD74
	BCC.b CODE_0DB03F
	LDY.b #$04
	STY.b $16,x
	INC.b $76,x
CODE_0DB03F:
	RTS

CODE_0DB040:
	TYX
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $7A36,x
	INC
	INC
	CMP.w #$0124
	BMI.b CODE_0DB057
	LDY.b #$00
	STY.b $18,x
	INC.b $76,x
	LDA.w #$00E0
CODE_0DB057:
	STA.w $7A36,x
	JSR.w CODE_0DB24B
	RTS

DATA_0DB05E:
	dw $0002,$FFFE

CODE_0DB062:
	TYX
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.b $18,x
	LDA.w $7A36,x
	CLC
	ADC.w DATA_0DB05E,y
	CMP.w #$0124
	BPL.b CODE_0DB086
	DEC.b $16,x
	BNE.b CODE_0DB07A
	INC.b $76,x
CODE_0DB07A:
	LDA.b $18,x
	EOR.w #$0002
	STA.b $18,x
	LDA.w #$0124
	BRA.b CODE_0DB095

CODE_0DB086:
	CMP.w #$01FF
	BMI.b CODE_0DB095
	LDA.b $18,x
	EOR.w #$0002
	STA.b $18,x
	LDA.w #$01FF
CODE_0DB095:
	STA.w $7A36,x
	JSR.w CODE_0DB24B
	RTS

CODE_0DB09C:
	TYX
	LDA.w $7A36,x
	DEC
	DEC
	CMP.w #$0100
	BPL.b CODE_0DB0C9
	LDA.w #$0040
	STA.w $7A98,x
	LDY.b $76,x
	CPY.b #$05
	PHP
	LDY.b #$00
	PLP
	BMI.b CODE_0DB0B9
	LDY.b #$05
CODE_0DB0B9:
	STY.b $76,x
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $7A36,x
	JSL.l CODE_03AEFD
	RTS

CODE_0DB0C9:
	STA.w $7A36,x
	JSR.w CODE_0DB24B
	RTS

UNK_0DB0D0:
	db $04

DATA_0DB0D1:
	db $02,$00,$00,$00,$08,$00,$04,$00,$00,$08,$02,$04,$02,$00,$00,$00
	db $08

DATA_0DB0E2:
	dw $FF00,$0100,$FF00,$0100

DATA_0DB0EA:
	dw $0100,$FF00,$FF00,$0100

DATA_0DB0F2:
	dw $0008,$0008,$0000,$0000

DATA_0DB0FA:
	dw $0040,$0140,$01C0,$00C0

CODE_0DB102:
	TYX
	LDA.w $6FA2,x
	AND.w #$FFE0
	ORA.w #$000B
	STA.w $6FA2,x
	LDY.w $7860,x
	BEQ.b CODE_0DB117
	JMP.w CODE_0DB198

CODE_0DB117:
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$0004
	BNE.b CODE_0DB13F
	RTS

CODE_0DB13F:
	LDY.b #$00
	LDA.w $70E2,x
	AND.w #$0010
	BNE.b CODE_0DB14B
	LDY.b #$04
CODE_0DB14B:
	LDA.b $79,x
	AND.w #$00FF
	BNE.b CODE_0DB154
	INY
	INY
CODE_0DB154:
	LDA.w DATA_0DB0E2,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w DATA_0DB0EA,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w DATA_0DB0F2,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w DATA_0DB0FA,y
	STA.b $0C
	LDA.w #$000B
	STA.b $77,x
	LDA.w $7182,x
	AND.w #$FFF0
	INC
	STA.w $7182,x
	SEP.b #$20
	STZ.w $70E1,x
	STZ.w $7181,x
	LDA.b #$FF
	LDY.w $7221,x
	BPL.b CODE_0DB18C
	STA.w $70E1,x
CODE_0DB18C:
	LDY.w $7223,x
	BPL.b CODE_0DB194
	STA.w $7181,x
CODE_0DB194:
	REP.b #$20
	BRA.b CODE_0DB1C6

CODE_0DB198:
	LDA.b $79,x
	AND.w #$00FF
	BEQ.b CODE_0DB1A7
	PHA
	TYA
	CLC
	ADC.w #$0006
	TAY
	PLA
CODE_0DB1A7:
	CLC
	ADC.w DATA_0DB0D1,y
	AND.w #$00FF
	LSR
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_0AE625>>16
	LDA.w #FXCODE_0AE625
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $6018
	STA.b $0C
CODE_0DB1C6:
	STZ.w $7542,x
	INC.b $19,x
	INC.b $16,x
	INC.b $76,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr03A_3MiniRavens
	BEQ.b CODE_0DB1DC
	CMP.w #!Define_YI_NorSpr03B_MiniRaven
	BNE.b CODE_0DB1E3
CODE_0DB1DC:
	LDA.b $0C
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BRA.b CODE_0DB20A

CODE_0DB1E3:
	CMP.w #!Define_YI_NorSpr06D_ClockwiseHootieTheBlueFish
	BEQ.b CODE_0DB1ED
	CMP.w #!Define_YI_NorSpr06E_CounterclockwiseHootieTheBlueFish
	BNE.b CODE_0DB1F6
CODE_0DB1ED:
	LDA.b $0C
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	JSR.w CODE_0DB47F
	RTS

CODE_0DB1F6:
	LDA.w $7722,x
	BMI.b CODE_0DB200
	LDY.b #$03
	STY.b $76,x
	RTS

CODE_0DB200:
	LDA.w #$0040
	STA.w $7A98,x
	LDY.b #$00
	STY.b $76,x
CODE_0DB20A:
	RTS

CODE_0DB20B:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_0DB24A
	LDY.b $19,x
	BEQ.b CODE_0DB24A
	LDY.b $77,x
	TYA
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDY.b $79,x
	TYA
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LSR
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.b $0C
	STA.w $6018
	LDX.b #FXCODE_0AE602>>16
	LDA.w #FXCODE_0AE602
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w $6018
	STA.b $0C
CODE_0DB24A:
	RTS

CODE_0DB24B:
	LDA.w #FXDATA_540000+$6030
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$6030)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	STZ.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0600
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w $6120
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $6122
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7400,x
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08D69F>>16
	LDA.w #FXCODE_08D69F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0003
	BNE.b CODE_0DB2AE
	INC.w $0CF9
CODE_0DB2AE:
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611C
	CLC
	ADC.w $6024
	CMP.w $6026
	BCS.b CODE_0DB2E8
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611E
	CLC
	ADC.w $6028
	CMP.w $602A
	BCS.b CODE_0DB2E8
	LDA.w $61D6
	BNE.b CODE_0DB2E8
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $60A8
	STA.w $60B4
	JSL.l CODE_03A858
CODE_0DB2E8:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $06E: Counter-clockwise Hootie the Blue Fish.
; Raiden: init_hootie_anticlockwise.
;---------------------------------------------------------------------------
YI_NorSpr06E_CounterclockwiseHootieTheBlueFish_Init:
init_hootie_anticlockwise:
;$0DB2E9
	LDY.b #$0A
	STY.b $79,x
	BRA.b CODE_0DB2F5

;---------------------------------------------------------------------------
; Sprite $06D: Clockwise Hootie the Blue Fish. Raiden: init_hootie_clockwise.
;---------------------------------------------------------------------------
YI_NorSpr06D_ClockwiseHootieTheBlueFish_Init:
init_hootie_clockwise:
;$0DB2EF
	LDA.w #$0100
	STA.w $7A38,x
CODE_0DB2F5:
	JSL.l CODE_03AE60
	INC.b $18,x
	LDA.w #$0080
	STA.w $7A36,x
	STZ.w $7400,x
	JSR.w CODE_0DB43E
	RTL

;---------------------------------------------------------------------------

DATA_0DB308:
	dw CODE_0DB102
	dw CODE_0DB4BD
	dw CODE_0DB504
	dw CODE_0DB5E1
	dw CODE_0DB764
	dw CODE_0DB58D
	dw CODE_0DB7C4

;---------------------------------------------------------------------------
; Sprites $06D / $06E main (shared). Raiden: main_hootie.
;---------------------------------------------------------------------------
YI_NorSpr06D_ClockwiseHootieTheBlueFish_Main:
YI_NorSpr06E_CounterclockwiseHootieTheBlueFish_Main:
main_hootie:
;$0DB316
	LDY.b $76,x
	CPY.b #$06
	BEQ.b CODE_0DB336
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0012
	BEQ.b CODE_0DB336
	LDA.w $7D96,x
	BNE.b CODE_0DB336
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $0C
	JSR.w CODE_0DB20B
	LDA.b $0C
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_0DB336:
	LDY.b $76,x
	CPY.b #$06
	BNE.b CODE_0DB342
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0DB342:
	JSR.w CODE_0DB3B9
	LDY.b $76,x
	CPY.b #$04
	BNE.b CODE_0DB352
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0DB35D
	BRA.b CODE_0DB35A

CODE_0DB352:
	CPY.b #$03
	BMI.b CODE_0DB35D
	CPY.b #$06
	BPL.b CODE_0DB35D
CODE_0DB35A:
	STZ.w $611A
CODE_0DB35D:
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0DB308,x)
	JSR.w CODE_0DB43E
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0DB3B8
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0DB3B8
	LDA.w $7D38,y
	BEQ.b CODE_0DB3B8
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDY.b $76,x
	CPY.b #$06
	BEQ.b CODE_0DB3B8
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A38,x
	STA.b $16,x
	INC
	INC
	AND.w #$01FE
	STA.w $7A38,x
	LDY.b #$06
	STY.b $76,x
	LDY.b #$00
	STY.b $19,x
	LDY.b $79,x
	TYA
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LSR
	TAY
	LDA.w DATA_0DB7FC,y
	SEP.b #$20
	STA.w $7A37,x
	REP.b #$20
CODE_0DB3B8:
	RTL

CODE_0DB3B9:
	JSL.l CODE_03AA52
	LDA.w #$FFF8
	LDY.b $79,x
	BEQ.b CODE_0DB3C7
	LDA.w #$0008
CODE_0DB3C7:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A38,x
	LDY.b $76,x
	CPY.b #$06
	BNE.b CODE_0DB3D5
	LDA.b $16,x
CODE_0DB3D5:
	CLC
	ADC.w #$0080
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	REP.b #$10
	LDY.w $7362,x
	LDA.w $6000,y
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $6000,y
	STA.w $6010,y
	LDA.w $6008,y
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $6008,y
	STA.w $6018,y
	LDA.w $6002,y
	CLC
	ADC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $6002,y
	STA.w $600A,y
	LDA.w $6012,y
	CLC
	ADC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $6012,y
	STA.w $601A,y
	SEP.b #$10
	LDA.w #$0008
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $7B56,x
	LDA.w #$0008
	CLC
	ADC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $7B58,x
	RTS

DATA_0DB43A:
	dw FXDATA_540000+$4041,FXDATA_540000+$4061

CODE_0DB43E:
	LDY.b $76,x
	CPY.b #$02
	BPL.b CODE_0DB47F
	LDA.w $7A38,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0DB45B
	LDY.b $18,x
	STY.b $00
	LDY.b $78,x
	CPY.b $00
	BEQ.b CODE_0DB4BC
	STY.b $18,x
	BRA.b CODE_0DB47F

CODE_0DB45B:
	PHP
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCC.b CODE_0DB46A
	PLP
	BPL.b CODE_0DB46D
	BRA.b CODE_0DB472

CODE_0DB46A:
	PLP
	BPL.b CODE_0DB472
CODE_0DB46D:
	LDA.w #$0004
	BRA.b CODE_0DB475

CODE_0DB472:
	LDA.w #$FFFC
CODE_0DB475:
	CLC
	ADC.w $7A38,x
	AND.w #$01FE
	STA.w $7A38,x
CODE_0DB47F:
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDY.b $78,x
	LDA.w DATA_0DB43A,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$4041)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7A36,x
	TYA
	ASL
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
CODE_0DB4BC:
	RTS

CODE_0DB4BD:
	TYX
	LDA.w $7A96,x
	ORA.w $7A98,x
	BNE.b CODE_0DB501
	LDA.w #$0008
	STA.w $7A98,x
	LDA.b $78,x
	EOR.w #$0002
	STA.b $78,x
	DEC.b $16,x
	BPL.b CODE_0DB501
	LDA.w $7C16,x
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCS.b CODE_0DB4F6
	LDA.w $7C18,x
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCS.b CODE_0DB4F6
	LDA.w #$0001
	STA.b $16,x
	BRA.b CODE_0DB501

CODE_0DB4F6:
	LDA.w #$0007
	STA.b $16,x
	LDA.w #$0040
	STA.w $7A96,x
CODE_0DB501:
	JMP.w CODE_0DB806

CODE_0DB504:
	TYX
	STX.w $61B6
	LDA.w $7CD6,x
	SEC
	SBC.w #$0008
	STA.b $00
	LDA.w $7CD8,x
	SEC
	SBC.w #$0008
	STA.b $02
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	PHA
	XBA
	AND.w #$00FF
	TAY
	BPL.b CODE_0DB528
	ORA.w #$FF00
CODE_0DB528:
	STA.b $04
	PLA
	AND.w #$00FF
	TAY
	BPL.b CODE_0DB534
	ORA.w #$FF00
CODE_0DB534:
	STA.b $06
	JSL.l CODE_049B42
	PHA
	LDY.b $04
	TYA
	XBA
	STA.b $04
	LDY.b $06
	TYA
	ORA.b $04
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.b $08
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.b $0A
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	PLA
	BNE.b CODE_0DB584
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDY.b #$05
	STY.b $76,x
	LDA.w #$0020
	STA.b $16,x
	STZ.w $611A
	LDY.w $7E48
	BMI.b CODE_0DB580
	STA.w $74A2,y
	DEC.b $76,x
	DEC.b $76,x
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.b $16,x
	LDA.w #!Define_YI_SoundID14_Gulp
	JSL.l CODE_push_sound_queue
CODE_0DB580:
	LDY.b #$00
	STY.b $78,x
CODE_0DB584:
	RTS

DATA_0DB585:
	dw $0004,$FFFC

DATA_0DB589:
	dw $0088,$0080

CODE_0DB58D:
	TYX
	LDA.w $7042,x
	AND.w #$FFE0
	ORA.w #$0022
	STA.w $7042,x
	LDY.w $7A36,x
	BPL.b CODE_0DB5EF
	LDA.w $7042,x
	AND.w #$FFE0
	ORA.w #$0024
	STA.w $7042,x
	LDA.w $0035
	AND.w #$CFF0
	CMP.w $0D98
	BEQ.b CODE_0DB5EF
	STA.w $0D98
	CMP.w #$0000
	BEQ.b CODE_0DB5EF
	LDA.b $16,x
	CMP.w #$0005
	BMI.b CODE_0DB5EF
	SEC
	SBC.w #$0010
	CMP.w #$0004
	BPL.b CODE_0DB5D1
	LDA.w #$0004
CODE_0DB5D1:
	AND.w #$FFFC
	STA.b $16,x
	SEP.b #$20
	LDA.b #$60
	STA.w $7A36,x
	REP.b #$20
	BRA.b CODE_0DB5EF

CODE_0DB5E1:
	TYX
	LDY.w $7E48
	CPY.b #$00
	BMI.b CODE_0DB5EF
	LDA.w #$FF00
	STA.w $74A2,y
CODE_0DB5EF:
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0003
	BNE.b CODE_0DB584
	LDA.b $16,x
	AND.w #$0002
	TAY
	LDA.w $7A36,x
	AND.w #$00FF
	CLC
	ADC.w DATA_0DB585,y
	CMP.w DATA_0DB589,y
	BEQ.b CODE_0DB616
	JMP.w CODE_0DB75C

CODE_0DB616:
	DEC.b $16,x
	DEC.b $16,x
	BEQ.b CODE_0DB61F
	JMP.w CODE_0DB759

CODE_0DB61F:
	PHY
	LDY.b $76,x
	CPY.b #$05
	BNE.b CODE_0DB629
	JMP.w CODE_0DB6DF

CODE_0DB629:
	LDA.w #$FC00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w $7E48
	LDA.w $7CD6,x
	SEC
	SBC.w #$0008
	STA.w $70E2,y
	LDA.w $7CD8,x
	SEC
	SBC.w #$0008
	STA.w $7182,y
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	CPY.b #$00
	BNE.b CODE_0DB6C0
	TYA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$00C0
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	LDA.w #$0010
	STA.w $7AF8
	LDA.w $61B2
	AND.w #$0FFF
	STA.w $61B2
	PHY
	LDA.w #!Define_YI_SoundID3C_InedibleObject
	JSL.l CODE_push_sound_queue
	PLY
CODE_0DB6C0:
	STZ.w $0390
	PHX
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	ASL
	TAX
	LDA.l FXDATA_0A9F1A,x
	AND.w #$00FF
	STA.w $74A2,y
	PLX
	LDA.w #$FFFF
	STA.w $7E48
	STA.w $0D96
	BRA.b CODE_0DB743

CODE_0DB6DF:
	LDA.w #!Define_YI_PlayerState00_Normal
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$FC00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $60A8
	STA.w $60B4
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	LDA.w $7CD6,x
	SEC
	SBC.w #$0010
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $7CD8,x
	SEC
	SBC.w #$0010
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $61B6
	STZ.w $0D94
	LDA.w #$0060
	STA.w $7AF8,x
	LDA.w #$004B
	STA.w $6FA2,x
	LDA.w #$2155
	STA.w $7040,x
CODE_0DB743:
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	LDA.w #$0020
	STA.w $7A96,x
	LDY.b #$02
	STY.b $78,x
	LDY.b #$04
	STY.b $76,x
	PLY
CODE_0DB759:
	LDA.w DATA_0DB589,y
CODE_0DB75C:
	SEP.b #$20
	STA.w $7A36,x
	REP.b #$20
	RTS

CODE_0DB764:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0DB7C3
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_0DB7B3
	STY.b $78,x
CODE_0DB771:
	LDA.w #$004B
	STA.w $6FA2,x
	LDY.b #$01
	STY.b $76,x
	STY.b $16,x
	LDY.w $7A37,x
	TYA
	LSR
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDY.b $77,x
	BEQ.b CODE_0DB798
	LDX.b #FXCODE_0AE81B>>16
	LDA.w #FXCODE_0AE81B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_0DB7A1

CODE_0DB798:
	LDX.b #FXCODE_0AE625>>16
	LDA.w #FXCODE_0AE625
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_0DB7A1:
	LDX.b $12
	LDA.w $6018
	STA.b $0C
	LDA.b $0C
	STA.w $7A38,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $19,x
	RTS

CODE_0DB7B3:
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.b $16,x
	LDY.b #$00
	STY.b $78,x
	LDY.b #$05
	STY.b $76,x
CODE_0DB7C3:
	RTS

CODE_0DB7C4:
	TYX
	LDA.w $7A38,x
	SEC
	SBC.b $16,x
	AND.w #$01FE
	CMP.w #$01F8
	BCC.b CODE_0DB7EE
	LDA.b $16,x
	STA.w $7A38,x
	STZ.b $16,x
	LDA.w $70E2,x
	PHA
	LDA.w $7182,x
	PHA
	JSR.w CODE_0DB771
	PLA
	STA.w $7182,x
	PLA
	STA.w $70E2,x
	RTS

CODE_0DB7EE:
	LDA.w $7A38,x
	CLC
	ADC.w #$0008
	AND.w #$01FE
	STA.w $7A38,x
CODE_0DB7FB:
	RTS

DATA_0DB7FC:
	db $04,$08,$02,$00,$00,$12,$0E,$0A,$00,$0C

CODE_0DB806:
	LDA.w !RAM_YI_Level_FreeMovementFlag
	ORA.w $7AF8,x
	BNE.b CODE_0DB7FB
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$FFF4
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $6120
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w $7C16,x
	CMP.b $00
	BCC.b CODE_0DB839
CODE_0DB838:
	RTS

CODE_0DB839:
	LDA.w $6122
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	CLC
	ADC.w $7C18,x
	CMP.b $00
	BCS.b CODE_0DB838
	LDA.w $0D94
	BNE.b CODE_0DB8C1
	LDY.b #$00
	STY.b $19,x
	LDY.b $79,x
	TYA
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LSR
	TAY
	LDA.w DATA_0DB7FC,y
	SEP.b #$20
	STA.w $7A37,x
	REP.b #$20
	JSL.l CODE_03BFF7
	INC.w $0D94
	LDY.w $7E48
	BMI.b CODE_0DB878
	TYA
	STA.w $0D96
CODE_0DB878:
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	AND.w #$00FF
	XBA
	STA.b $00
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	AND.w #$00FF
	ORA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.w $60D4
	JSL.l CODE_04F74A
	LDA.w #!Define_YI_PlayerState1A_DisableInput
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$0021
	STA.w $60BE
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$404B
	STA.w $6FA2,x
	LDA.w #$2105
	STA.w $7040,x
	LDY.b #$02
	STY.b $78,x
	INC.b $76,x
	PLA
	RTL

CODE_0DB8C1:
	RTS

;---------------------------------------------------------------------------

DATA_0DB8C2:
	dw $0A00,$0000

DATA_0DB8C6:
	dw $0050,$0030

;---------------------------------------------------------------------------
; Sprites $03A (3-pack) and $03B (single) Mini Raven. Raiden: init_mini_raven.
;---------------------------------------------------------------------------
YI_NorSpr03A_3MiniRavens_Init:
YI_NorSpr03B_MiniRaven_Init:
init_mini_raven:
;$0DB8CA
	LDA.w $7AF6,x
	BNE.b CODE_0DB913
	LDY.w $7400,x
	LDA.w DATA_0DB8C2,y
	STA.b $78,x
	STZ.w $7400,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr03A_3MiniRavens
	BNE.b CODE_0DB913
	LDA.w #$0002
	STA.b $02
CODE_0DB8E7:
	LDY.b $02
	LDA.w DATA_0DB8C6,y
	STA.b $00
	LDA.w #$003A
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0DB913
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.b $78,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.b $00
	STA.w $7AF6,y
	DEC.b $02
	DEC.b $02
	BPL.b CODE_0DB8E7
CODE_0DB913:
	RTL

;---------------------------------------------------------------------------

DATA_0DB914:
	dw CODE_0DB102
	dw CODE_0D8000

;---------------------------------------------------------------------------
; Sprites $03A / $03B main (shared). Raiden: main_mini_raven.
;---------------------------------------------------------------------------
YI_NorSpr03A_3MiniRavens_Main:
YI_NorSpr03B_MiniRaven_Main:
main_mini_raven:
;$0DB918
	LDA.w $7362,x
	BMI.b CODE_0DB988
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0012
	BEQ.b CODE_0DB959
	LDA.w $7D96,x
	BNE.b CODE_0DB959
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $0C
	JSR.w CODE_0DB20B
	LDA.b $0C
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $7AF6,x
	BEQ.b CODE_0DB959
	LDA.w $7860,x
	BNE.b CODE_0DB945
	LDY.b $77,x
	BEQ.b CODE_0DB959
CODE_0DB945:
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
CODE_0DB959:
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0DB914,x)
	JSR.w CODE_0DB9CA
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JSR.w CODE_0DB989
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	JSR.w CODE_0DB989
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0DB984
	JML.l CODE_0DC0F0

CODE_0DB984:
	JSL.l CODE_03A5B7
CODE_0DB988:
	RTL

CODE_0DB989:
	CMP.w #$0059
	BNE.b CODE_0DB991
	LDA.w #$0100
CODE_0DB991:
	CMP.w #$FFA7
	BNE.b CODE_0DB999
	LDA.w #$FF00
CODE_0DB999:
	CMP.w #$003E
	BNE.b CODE_0DB9A1
	LDA.w #$00B5
CODE_0DB9A1:
	CMP.w #$FFC2
	BNE.b CODE_0DB9A9
	LDA.w #$FF4B
CODE_0DB9A9:
	RTS

DATA_0DB9AA:
	db $00,$04,$02,$06,$00,$04,$02,$06,$00,$06,$02,$04,$00,$06,$02,$04

DATA_0DB9BA:
	db $A0,$A0,$60,$60,$60,$60,$A0,$A0,$20,$20,$20,$E0,$E0,$E0,$E0,$20

CODE_0DB9CA:
	LDA.w $7A98,x
	BNE.b CODE_0DB9DC
	LDA.w #$0003
	STA.w $7A98,x
	LDA.b $78,x
	EOR.w #$0001
	STA.b $78,x
CODE_0DB9DC:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w $7A38,x
	BEQ.b CODE_0DBA05
	STA.w $7A38,x
	ASL
	ASL
	XBA
	LDY.b $79,x
	BEQ.b CODE_0DB9F2
	CLC
	ADC.w #$0008
CODE_0DB9F2:
	TAY
	SEP.b #$20
	LDA.w DATA_0DB9BA,y
	STA.w $7042,x
	LDA.w DATA_0DB9AA,y
	AND.b #$FF
	STA.w $7A36,x
	REP.b #$20
CODE_0DBA05:
	LDA.b $78,x
	AND.w #$00FF
	ORA.w $7A36,x
	STA.w $7402,x
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $180: Spinning log (player-platform). Raiden: init_spinning_log.
;---------------------------------------------------------------------------
YI_NorSpr180_SpinningLog_Init:
init_spinning_log:
;$0DBA11
	JSL.l CODE_03AE60
	STZ.w $7400,x
	JSR.w CODE_0DBA3D
	LDA.w #$000C
	STA.w $7BB6,x
	RTL

;---------------------------------------------------------------------------

DATA_0DBA22:
	dw CODE_0DBB1F
	dw CODE_0DBB2E

;---------------------------------------------------------------------------
; Sprite $180 main. Raiden: main_spinning_log.
;---------------------------------------------------------------------------
YI_NorSpr180_SpinningLog_Main:
main_spinning_log:
;$0DBA26
	JSL.l CODE_03AA52
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0DBA22,x)
	JSR.w CODE_0DBA7D
	JSR.w CODE_0DBA3D
	RTL

CODE_0DBA3D:
	LDY.b $78,x
	BNE.b CODE_0DBA7C
	INC.b $78,x
	LDA.w #FXDATA_540000+$4060
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$4060)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7A38,x
	TYA
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
CODE_0DBA7C:
	RTS

CODE_0DBA7D:
	LDY.b $76,x
	BNE.b CODE_0DBA86
	JSL.l CODE_03D127
CODE_0DBA85:
	RTS

CODE_0DBA86:
	LDA.w $7C16,x
	CLC
	ADC.w #$001A
	CMP.w #$0034
	BCS.b CODE_0DBA85
	LDA.w $7C18,x
	CLC
	ADC.w #$0013
	CMP.w #$0026
	BCS.b CODE_0DBA85
	LDA.w $7C16,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7C18,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $00
	CLC
	ADC.w #$0080
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0400
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $60FC
	AND.w #$01E0
	BEQ.b CODE_0DBAE6
	AND.w #$0180
	DEC
	EOR.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BPL.b CODE_0DBAEF
CODE_0DBAE6:
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $60A8
	STA.w $60B4
CODE_0DBAEF:
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	EOR.w #$FFFF
	INC
	STA.b $00
	LDA.w $60FC
	AND.w #$001F
	BEQ.b CODE_0DBB08
	AND.w #$0018
	DEC
	EOR.b $00
	BMI.b CODE_0DBB1E
CODE_0DBB08:
	LDA.b $00
	BPL.b CODE_0DBB1B
	PHA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	PLA
	ASL
CODE_0DBB1B:
	STA.w $60AA
CODE_0DBB1E:
	RTS

CODE_0DBB1F:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0DBB2D
	LDA.w #$0080
	STA.w $7A96,x
	INC.b $76,x
CODE_0DBB2D:
	RTS

CODE_0DBB2E:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0DBB45
	LDA.w $7A38,x
	AND.w #$007F
	BNE.b CODE_0DBB45
	DEC.b $76,x
	LDA.w #$0080
	STA.w $7A96,x
	RTS

CODE_0DBB45:
	LDA.w $7A38,x
	CLC
	ADC.w #$0010
	STA.w $7A38,x
	STZ.b $78,x
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0DA: Flower pot. Raiden: init_flower_pot.
;---------------------------------------------------------------------------
YI_NorSpr0DA_FlowerPot_Init:
init_flower_pot:
;$0DBB52
	LDA.w $70E2,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $04
	LDA.w $7182,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSL.l CODE_03D400
	BEQ.b CODE_0DBB68
	INC.b $79,x
CODE_0DBB68:
	STZ.w $7400,x
	LDA.w #$0004
	STA.w $7B58,x
	ASL
	STA.w $7BB6,x
	LDA.w #$000C
	STA.w $7BB8,x
	RTL

;---------------------------------------------------------------------------

DATA_0DBB7C:
	dw CODE_0D8000
	dw CODE_0DBD11

;---------------------------------------------------------------------------
; Sprite $0DA main. Raiden: main_flower_pot.
;---------------------------------------------------------------------------
YI_NorSpr0DA_FlowerPot_Main:
main_flower_pot:
;$0DBB80
	JSL.l CODE_03AF23
	LDY.b $78,x
	BNE.b CODE_0DBB8B
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0DBB8B:
	STZ.w $7400,x
	JSR.w CODE_0DBC65
	JSR.w CODE_0DBBB1
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0DBB7C,x)
	LDY.b $18,x
	BEQ.b CODE_0DBBB0
	LDY.w $7223,x
	BPL.b CODE_0DBBB0
	LDA.w $60FC
	AND.w #$0018
	BEQ.b CODE_0DBBB0
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0DBBB0:
	RTL

CODE_0DBBB1:
	LDY.b $76,x
	BNE.b CODE_0DBBC4
	LDY.w $7D36,x
	BPL.b CODE_0DBBBE
	JSR.w CODE_0DBC1B
	RTS

CODE_0DBBBE:
	DEY
	BMI.b CODE_0DBBC4
	JSR.w CODE_0DBBD1
CODE_0DBBC4:
	LDY.b #$00
	STY.b $18,x
	RTS

DATA_0DBBC9:
	dw $FFC0,$0040,$FF80,$0080

CODE_0DBBD1:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0DBC12
	LDA.w $7D38,y
	BEQ.b CODE_0DBC12
	LDA.w $7542,y
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.b $02
	LDA.w $7CD6,y
	SEC
	SBC.w $7CD6,x
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.b #$00
	LDA.b $00
	BNE.b CODE_0DBC02
	LDY.b #$04
CODE_0DBC02:
	LDA.b $02
	BMI.b CODE_0DBC08
	INY
	INY
CODE_0DBC08:
	LDA.w DATA_0DBBC9,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b #$01
	STY.b $78,x
CODE_0DBC12:
	RTS

DATA_0DBC13:
	dw $0040,$FFC0,$0018,$001C

CODE_0DBC1B:
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	STA.b $04
	LDY.b $18,x
	BEQ.b CODE_0DBC47
	LDY.w $60AB
	BMI.b CODE_0DBC42
CODE_0DBC31:
	INC.w $61B4
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.b $04
	CLC
	ADC.w #$0002
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	RTS

CODE_0DBC42:
	LDY.b #$00
	STY.b $18,x
	RTS

CODE_0DBC47:
	CMP.w #$FFF8
	BCC.b CODE_0DBC5D
	LDY.w $60C0
	BEQ.b CODE_0DBC60
	LDY.w $60AB
	BMI.b CODE_0DBC60
	INC.b $18,x
	STZ.w $60AA
	BRA.b CODE_0DBC31

CODE_0DBC5D:
	JSR.w CODE_0D9037
CODE_0DBC60:
	RTS

DATA_0DBC61:
	dw $FE00,$FF00

CODE_0DBC65:
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_0DBC7A
	LDY.w $7A36,x
	BEQ.b CODE_0DBC79
	LDY.b $78,x
	BNE.b CODE_0DBC79
	INY
	STY.b $19,x
CODE_0DBC79:
	RTS

CODE_0DBC7A:
	STA.w $7A36,x
	LDY.b $78,x
	BEQ.b CODE_0DBCA8
	LDA.w $7182,x
	SEC
	SBC.w $7A38,x
	CMP.w #$0010
	BMI.b CODE_0DBC93
	LDY.b #$00
	STY.b $78,x
	BRA.b CODE_0DBCB3

CODE_0DBC93:
	CPY.b #$03
	BPL.b CODE_0DBCA3
	TYA
	ASL
	TAY
	LDA.w DATA_0DBC61-$02,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $78,x
	RTS

CODE_0DBCA3:
	LDY.b #$00
	STY.b $78,x
	RTS

CODE_0DBCA8:
	LDY.b $19,x
	BNE.b CODE_0DBCB3
	LDA.w $7182,x
	STA.w $7A38,x
	RTS

CODE_0DBCB3:
	LDY.b $76,x
	BNE.b CODE_0DBC79
	LDA.w $7040,x
	AND.w #$FFF3
	STA.w $7040,x
	LDA.w #$0002
	STA.w $7A98,x
	STZ.b $16,x
	LDA.w #!Define_YI_SoundID66_PotBreaking
	JSL.l CODE_push_sound_queue
	INC.b $76,x
	LDY.b $79,x
	BNE.b CODE_0DBC79
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	AND.w #$0010
	BEQ.b CODE_0DBCE0
	INY
CODE_0DBCE0:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$0010
	BEQ.b CODE_0DBCEA
	INY
	INY
CODE_0DBCEA:
	CPY.b #$03
	BEQ.b CODE_0DBD10
	CPY.b #$02
	BNE.b CODE_0DBCF8
	JSL.l CODE_0D92EE
	BRA.b CODE_0DBD00

CODE_0DBCF8:
	CPY.b #$01
	BNE.b CODE_0DBD0D
	JSL.l CODE_0D9329
CODE_0DBD00:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $04
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSL.l CODE_03D3F3
	RTS

CODE_0DBD0D:
	JSR.w CODE_0D9383
CODE_0DBD10:
	RTS

CODE_0DBD11:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0DBD10
	LDA.w #$0004
	STA.w $7A98,x
	INC.w $7402,x
	LDY.w $7402,x
	CPY.b #$06
	BMI.b CODE_0DBD10
	LDY.b $16,x
	BNE.b CODE_0DBD2D
	INC.b $16,x
CODE_0DBD2D:
	DEC.w $7402,x
	JSL.l CODE_03A2C7
	BCC.b CODE_0DBD3A
	JSL.l CODE_despawn_sprite_free_slot
CODE_0DBD3A:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $11C: Lakitu Cloud (after Lakitu is defeated). Raiden: init_lakitu_cloud.
;---------------------------------------------------------------------------
YI_NorSpr11C_LakituCloud_Init:
init_lakitu_cloud:
;$0DBD3B
	LDA.w #$0360
	STA.w $7A96,x
	LDA.w #$03C0
	STA.w $7AF6,x
	RTL

;---------------------------------------------------------------------------

DATA_0DBD48:
	dw $0008,$00E8,$0010,$FFF0

;---------------------------------------------------------------------------
; Sprite $11C main. Raiden: main_lakitu_cloud.
;---------------------------------------------------------------------------
YI_NorSpr11C_LakituCloud_Main:
main_lakitu_cloud:
;$0DBD50
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_0DBD61
	CPX.w $61B6
	BEQ.b CODE_0DBD69
	LDY.w $77C2,x
	BRA.b CODE_0DBD65

CODE_0DBD61:
	BMI.b CODE_0DBD65
	INY
	INY
CODE_0DBD65:
	TYA
	STA.w $7400,x
CODE_0DBD69:
	LDY.w $7D38,x
	BEQ.b CODE_0DBD73
	JSL.l CODE_03A2F8
	RTL

CODE_0DBD73:
	CPX.w $61B6
	BEQ.b CODE_0DBD7B
	JMP.w CODE_0DBDE9

CODE_0DBD7B:
	LDA.w $7680,x
	SEC
	SBC.w #$0080
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_0DBD8D
	EOR.b $00
	BMI.b CODE_0DBDAF
CODE_0DBD8D:
	LDA.w $7680,x
	CMP.w #$00F0
	BCC.b CODE_0DBDAF
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w $7C16,x
	SEC
	SBC.w $72C0,x
	STA.w $7C16,x
CODE_0DBDAF:
	LDA.w $7682,x
	SEC
	SBC.w #$0080
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_0DBDC1
	EOR.b $00
	BMI.b CODE_0DBDF3
CODE_0DBDC1:
	LDA.w $7682,x
	SEC
	SBC.w #$0020
	CMP.w #$00B0
	BCC.b CODE_0DBDF3
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
	LDA.w $7C18,x
	SEC
	SBC.w $72C2,x
	STA.w $7C18,x
	BRA.b CODE_0DBDF3

CODE_0DBDE9:
	JSL.l CODE_03A2C7
	BCC.b CODE_0DBDF3
	JML.l CODE_03A31E

CODE_0DBDF3:
	LDA.w $0C1C
	BEQ.b CODE_0DBE53
	CPX.w $61B6
	BNE.b CODE_0DBE53
	LDY.b #$00
	LDA.w $70E2,x
	SEC
	SBC.w $6094
	SEC
	SBC.w #$0008
	BMI.b CODE_0DBE14
	INY
	INY
	SEC
	SBC.w #$00E0
	BMI.b CODE_0DBE53
CODE_0DBE14:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_0DBE22
	SEC
	SBC.w $7E28
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0DBE53
CODE_0DBE22:
	LDA.w $7E28
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w $7C16,x
	SEC
	SBC.w $72C0,x
	STA.w $7C16,x
	STZ.w $72C0,x
	LDA.w $6094
	CLC
	ADC.w DATA_0DBD48,y
	STA.w $70E2,x
	SEP.b #$20
	LDA.w $7E27
	STA.w $70E1,x
	REP.b #$20
CODE_0DBE53:
	JSL.l CODE_03AF23
	JSR.w CODE_0DBF4A
	LDA.w $75E0,x
	BNE.b CODE_0DBE71
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_0DBE71
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
CODE_0DBE71:
	LDA.w $75E2,x
	BNE.b CODE_0DBE88
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_0DBE88
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
CODE_0DBE88:
	LDA.w $7A98,x
	BNE.b CODE_0DBECC
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
	LDA.w #!Define_YI_AmbSpr1F8
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0002
	STA.w $73C2,y
	LDA.b $10
	AND.w #$0003
	SEC
	SBC.w #$000A
	CLC
	ADC.w $7CD6,x
	STA.w $70A2,y
	LDA.b $10
	AND.w #$0007
	SEC
	SBC.w #$000C
	CLC
	ADC.w $7CD8,x
	STA.w $7142,y
	LDA.w #$0008
	STA.w $7782,y
	STA.w $7A98,x
CODE_0DBECC:
	LDY.b $16,x
	BEQ.b CODE_0DBED6
	LDA.w #$0080
	STA.w $7AF7,y
CODE_0DBED6:
	LDA.w $0B57
	BEQ.b CODE_0DBEE8
	LDA.w #$0006
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$FFFF
	STA.w $0B91,x
	RTL

CODE_0DBEE8:
	LDA.w $7A96,x
	BNE.b CODE_0DBF09
	LDA.w $7AF6,x
	BNE.b CODE_0DBEF9
	JSR.w CODE_0DBF59
	JML.l CODE_03A31E

CODE_0DBEF9:
	LDY.b #$FF
	LDA.w $7974
	AND.w #$0001
	BNE.b CODE_0DBF05
	LDY.b #$05
CODE_0DBF05:
	TYA
	STA.w $74A2,x
CODE_0DBF09:
	RTL

DATA_0DBF0A:
	dw $0000,$0300,$FD00,$0000,$0000,$0200,$FE00,$0000
	dw $0000,$0200,$FE00,$0000,$0000,$0200,$FE00,$0000

DATA_0DBF2A:
	dw $0000,$0000,$0000,$0000,$0300,$0200,$0200,$0200
	dw $FD00,$FE00,$FE00,$FE00,$0000,$0000,$0000,$0000

CODE_0DBF4A:
	LDA.w $0B57
	BNE.b CODE_0DBF59
	LDY.w $60AB
	BMI.b CODE_0DBF59
	LDY.w $0D94
	BEQ.b CODE_0DBF7B
CODE_0DBF59:
	CPX.w $61B6
	BNE.b CODE_0DBF7A
	STZ.w $61B6
	STZ.b $18,x
	STZ.w $75E0,x
	STZ.w $75E2,x
	LDA.w #$0600
	STA.w $6FA0,x
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState14_ActivateGoal
	BEQ.b CODE_0DBF7A
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
CODE_0DBF7A:
	RTS

CODE_0DBF7B:
	CPX.w $61B6
	BNE.b CODE_0DBFE6
	LDA.w $60FC
	AND.w #$01E0
	BEQ.b CODE_0DBFD0
	AND.w #$0180
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0DBFA8
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w $7C16,x
	SEC
	SBC.w $72C0,x
	STA.w $7C16,x
	STZ.w $72C0,x
CODE_0DBFA8:
	LDA.w $60FC
	AND.w #$001F
	BEQ.b CODE_0DBFD0
	AND.w #$0018
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0DBFD0
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
	LDA.w $7C18,x
	SEC
	SBC.w $72C2,x
	STA.w $7C18,x
	STZ.w $72C2,x
CODE_0DBFD0:
	LDA.w $7C16,x
	SEC
	SBC.w $72C0,x
	STA.w $7C16,x
	LDA.w $7C18,x
	SEC
	SBC.w $72C2,x
	STA.w $7C18,x
	BRA.b CODE_0DBFEE

CODE_0DBFE6:
	LDY.w $60C0
	BNE.b CODE_0DBFEE
	JMP.w CODE_0DBF59

CODE_0DBFEE:
	LDA.w $0B57
	BNE.b CODE_0DC011
	LDA.w $7C16,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_0DC011
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	BPL.b CODE_0DC011
	CMP.w #$FFF8
	BPL.b CODE_0DC014
CODE_0DC011:
	JMP.w CODE_0DBF59

CODE_0DC014:
	STA.b $00
	LDY.w $61B6
	BNE.b CODE_0DC043
	LDA.w $60FC
	AND.w #$001F
	BEQ.b CODE_0DC026
	JMP.w CODE_0DBF59

CODE_0DC026:
	STX.w $61B6
	LDA.w $7C16,x
	STA.b $18,x
	LDY.b #!Define_YI_PlayerState02_InCutscene
	STY.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w $60A8
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0060
	STA.w $6FA0,x
CODE_0DC043:
	CPX.w $61B6
	BEQ.b CODE_0DC049
	RTS

CODE_0DC049:
	LDA.w $6150
	BNE.b CODE_0DC060
	LDA.w $0035
	AND.w #$FCFF
	STA.w $617A
	LDA.w $0037
	AND.w #$FCFF
	STA.w $617C
CODE_0DC060:
	LDA.w $60FC
	AND.w #$0018
	BNE.b CODE_0DC078
	LDA.b $00
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	ADC.w $72C2,x
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC.w $61B4
CODE_0DC078:
	LDA.b $18,x
	CMP.w #$FFFD
	BEQ.b CODE_0DC087
	BPL.b CODE_0DC085
	INC.b $18,x
	BRA.b CODE_0DC087

CODE_0DC085:
	DEC.b $18,x
CODE_0DC087:
	LDA.w $60FC
	AND.w #$01E0
	BNE.b CODE_0DC09C
	LDA.w $7C16,x
	SEC
	SBC.b $18,x
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_0DC09C:
	LDA.w $60D4
	BEQ.b CODE_0DC0AD
	LDA.w #$0500
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_0DC0DD

CODE_0DC0AD:
	LDA.w $0036
	AND.w #$000F
	ASL
	TAY
	LDA.w DATA_0DBF0A,y
	STA.w $75E0,x
	BEQ.b CODE_0DC0CE
	LDA.w $6150
	ORA.w $60DE
	BNE.b CODE_0DC0CE
	LDA.w $0036
	AND.w #$0002
	STA.w $60C4
CODE_0DC0CE:
	LDA.w DATA_0DBF2A,y
	STA.w $75E2,x
	LDA.w #$0008
	STA.w $7540,x
	STA.w $7542,x
CODE_0DC0DD:
	STZ.w $60A8
	STZ.w $60B4
	STZ.w $60AA
	STZ.w !EXRAM_YI_Player_SubXPosLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Player_SubYPosLo|!EXRAMBankMirror
	STZ.w $60D4
	RTS

CODE_0DC0F0:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0DC14A
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0DC13E
	TYX
	JSL.l CODE_04906C
	BEQ.b CODE_0DC10B
	JSL.l CODE_0EBE8D
	BNE.b CODE_0DC118
CODE_0DC10B:
	LDX.b $12
	LDA.w $6FA0,x
	ORA.w #$0200
	STA.w $6FA0,x
	SEC
	RTL

CODE_0DC118:
	LDA.w $7D38,x
	BEQ.b CODE_0DC13E
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_0DC12A
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BCS.b CODE_0DC132
CODE_0DC12A:
	LDA.w $7542,x
	CMP.w #$0040
	BCC.b CODE_0DC136
CODE_0DC132:
	JSL.l CODE_kill_sprite_by_hit_special_cases
CODE_0DC136:
	LDX.b $12
	JSL.l CODE_kill_sprite_by_hit_special_cases
	SEC
	RTL

CODE_0DC13E:
	LDX.b $12
	PLA
	STA.b $00
	JSL.l CODE_03A5B7
	LDA.b $00
	PHA
CODE_0DC14A:
	CLC
	RTL

CODE_0DC14C:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0DC14A
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0DC14A
	LDA.w $7D38,y
	BEQ.b CODE_0DC14A
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	BCC.b CODE_0DC136
	LDA.w $6FA0,x
	ORA.w #$0200
	STA.w $6FA0,x
	SEC
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprites $109/$10A/$10B: Tap-Tap family (Bronze / Silver / Hopping Silver).
; Raiden: init_tap_tap.
;
; See docs/family-taptaps.md for the full Tap-Tap family breakdown -- this
; bank covers the 3 small variants; the $03C Red Nose boss lives in Bank0F.
;---------------------------------------------------------------------------
YI_NorSpr109_BronzeTapTap_Init:
YI_NorSpr10A_SilverTapTap_Init:
YI_NorSpr10B_HoppingSilverTapTap_Init:
init_tap_tap:
;$0DC171
	LDA.w $6FA2,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr10B_HoppingSilverTapTap
	BNE.b CODE_0DC188
	LDA.w #$000D
	STA.w $7402,x
	INC.w $7A36,x
CODE_0DC188:
	RTL

;---------------------------------------------------------------------------

DATA_0DC189:
	dw CODE_0DC389
	dw CODE_0DC3EE
	dw CODE_0DC41E
	dw CODE_0DC496
	dw CODE_0DC4CE
	dw CODE_0DC505

DATA_0DC195:
	dw $FE88,$0178,$FE00,$0200

DATA_0DC19D:
	dw $0180,$FE80

DATA_0DC1A1:
	dw $FF80,$0080

;---------------------------------------------------------------------------
; Sprites $109/$10A/$10B main (shared). Raiden: main_tap_tap.
;---------------------------------------------------------------------------
YI_NorSpr109_BronzeTapTap_Main:
YI_NorSpr10A_SilverTapTap_Main:
YI_NorSpr10B_HoppingSilverTapTap_Main:
main_tap_tap:
;$0DC1A5
	LDY.w $7402,x
	CPY.b #$0E
	BNE.b CODE_0DC1C6
	JSL.l CODE_03AA2E
	REP.b #$10
	LDY.w $7362,x
	LDA.w #$8000
	STA.w $6008,y
	STA.w $6010,y
	STA.w $6018,y
	STA.w $6020,y
	SEP.b #$10
CODE_0DC1C6:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BEQ.b CODE_0DC1D1
	JMP.w CODE_0DC273

CODE_0DC1D1:
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.w $6168
	LDA.w #$0005
	STA.w $74A2,x
	LDA.w $7042,x
	AND.w #$FF3F
	STA.w $7042,x
	LDY.b #$02
	LDA.w $6150
	CMP.w #$0003
	BMI.b CODE_0DC1F5
	INY
	INY
CODE_0DC1F5:
	STY.w $6150
	LDA.w $7040,x
	ORA.w #$0004
	STA.w $7040,x
	CPY.b #$02
	BEQ.b CODE_0DC217
	LDY.w $77C3,x
	BEQ.b CODE_0DC217
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.b #$05
	LDA.w #$000A
	BRA.b CODE_0DC268

CODE_0DC217:
	LDY.w $77C2,x
	TYA
	STA.w $7400,x
	LDA.w #$0020
	STA.w $7540,x
	LDA.w DATA_0DC19D,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w DATA_0DC1A1,y
	STA.b $00
	LDA.w #!Define_YI_AmbSpr1E0
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$000C
	STA.w $7142,y
	LDA.w #$0004
	STA.w $7782,y
	STA.w $7E4C,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FF80
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $73C0,y
	LDY.b #$04
	LDA.w #$0006
CODE_0DC268:
	STY.b $76,x
	STA.w $7402,x
	STZ.w $7A98,x
	PLA
	PLY
	RTL

CODE_0DC273:
	JSL.l CODE_03AF23
	LDY.w $7D36,x
	BNE.b CODE_0DC27F
CODE_0DC27C:
	JMP.w CODE_0DC315

CODE_0DC27F:
	DEY
	BPL.b CODE_0DC285
	JMP.w CODE_0DC311

CODE_0DC285:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0DC27C
	LDA.w $7D38,y
	BEQ.b CODE_0DC27C
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0008
	STA.w $7540,x
	LDA.w $7542,y
	CMP.w #$0040
	BPL.b CODE_0DC2AC
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0DC2AC:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	PHP
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDY.b #$00
	PLP
	BMI.b CODE_0DC2BC
	INY
	INY
CODE_0DC2BC:
	STY.b $78,x
	TYA
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0DC2C8
	CLC
	ADC.w #$0004
CODE_0DC2C8:
	TAY
	LDA.w DATA_0DC195,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID2E_ClankSound7
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr1EF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.w $7CD8,x
	STA.w $7142,y
	LDA.w #$0005
	STA.w $73C2,y
	ASL
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7782,y
	STA.b $76,x
	LDA.w $7722,x
	BPL.b CODE_0DC315
	JSL.l CODE_03AD24
	BCC.b CODE_0DC315
	STZ.w $7A38,x
	LDA.w #$000E
	STA.w $7402,x
	BRA.b CODE_0DC315

CODE_0DC311:
	JSL.l CODE_03A858
CODE_0DC315:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0DC189,x)
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.b $76,x
	CPY.b #$02
	BMI.b CODE_0DC329
	LDA.w #$0841
CODE_0DC329:
	STA.w $6FA2,x
	JSR.w CODE_0DC330
	RTL

CODE_0DC330:
	LDY.w $7402,x
	CPY.b #$0E
	BEQ.b CODE_0DC341
	LDA.w $7722,x
	BMI.b CODE_0DC37A
	JSL.l CODE_03AEFD
	RTS

CODE_0DC341:
	LDA.w #FXDATA_540000+$5000
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$5000)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08867E>>16
	LDA.w #FXCODE_08867E
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
CODE_0DC37A:
	RTS

DATA_0DC37B:
	dw $FF80,$00C0

DATA_0DC37F:
	db $01,$02,$01,$02,$01

DATA_0DC384:
	db $0F,$11,$0F,$11,$0F

CODE_0DC389:
	TYX
	LDY.w $7A36,x
	BEQ.b CODE_0DC3C7
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0DC3E2
	LDA.w $7A98,x
	BNE.b CODE_0DC3E2
	DEC.b $18,x
	BPL.b CODE_0DC3B2
	LDA.w #$0005
	STA.b $18,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0010
	STA.w $7402,x
	RTS

CODE_0DC3B2:
	LDY.b $18,x
	LDA.w DATA_0DC37F,y
	AND.w #$00FF
	STA.w $7A98,x
	LDA.w DATA_0DC384,y
	AND.w #$00FF
	STA.w $7402,x
	RTS

CODE_0DC3C7:
	INC.w $7402,x
	LDY.w $7402,x
	CPY.b #$04
	BNE.b CODE_0DC3E2
	TYA
	LSR
	STA.w $7A98,x
	LDY.w $7400,x
	LDA.w DATA_0DC37B,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
	RTS

CODE_0DC3E2:
	CPY.b #$02
	BNE.b CODE_0DC3ED
	LDA.w #!Define_YI_SoundID26_WalkingTapTap
	JSL.l CODE_push_sound_queue
CODE_0DC3ED:
	RTS

CODE_0DC3EE:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0DC41D
	LDA.w #$0002
	STA.w $7A98,x
	INC.w $7402,x
	LDY.w $7402,x
	CPY.b #$0A
	BMI.b CODE_0DC41D
	ASL
	STA.w $7A98,x
	STZ.w $7402,x
	LDY.w $7A36,x
	BEQ.b CODE_0DC418
	LDA.w #$000D
	STA.w $7402,x
	STZ.b $18,x
CODE_0DC418:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $76,x
CODE_0DC41D:
	RTS

CODE_0DC41E:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCS.b CODE_0DC452
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDY.w $7402,x
	CPY.b #$0E
	BNE.b CODE_0DC43C
	JSL.l CODE_03AEFD
CODE_0DC43C:
	STZ.w $7A38,x
	LDA.w #$000A
	STA.w $7402,x
	LDA.w #$0060
	STA.w $7A98,x
	LDY.b #$06
	STY.b $16,x
	INC.b $76,x
	RTS

CODE_0DC452:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0DC45B
	EOR.w #$FFFF
	INC
CODE_0DC45B:
	CLC
	ADC.w #$0080
	AND.w #$FF00
	ASL
	ASL
	ASL
	ASL
	ASL
	XBA
	STA.b $00
	LDA.w $7400,x
	EOR.b $78,x
	BEQ.b CODE_0DC479
	LDA.b $00
	EOR.w #$FFFF
	INC
	STA.b $00
CODE_0DC479:
	LDA.b $00
	CLC
	ADC.w $7A38,x
	AND.w #$01FE
	STA.w $7A38,x
	JSL.l CODE_0EC365
	RTS

DATA_0DC48A:
	db $0D,$0C,$0A,$0B,$0A,$0B

DATA_0DC490:
	db $12,$02,$10,$04,$08,$04

CODE_0DC496:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0DC4CD
	DEC.b $16,x
	BNE.b CODE_0DC4B9
	LDA.w #$0004
	STA.w $7A98,x
	STZ.w $7402,x
	LDY.w $7A36,x
	BEQ.b CODE_0DC4B6
	LDA.w #$000D
	STA.w $7402,x
	STZ.b $18,x
CODE_0DC4B6:
	STZ.b $76,x
	RTS

CODE_0DC4B9:
	LDY.b $16,x
	LDA.w DATA_0DC48A-$01,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_0DC490-$01,y
	AND.w #$00FF
	STA.w $7A98,x
CODE_0DC4CD:
	RTS

CODE_0DC4CE:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_0DC504
CODE_0DC4D4:
	LDA.w $7A98,x
	BNE.b CODE_0DC4E6
	STZ.w $7540,x
	LDA.w #$0010
	STA.w $7A96,x
	INC
	STA.w $7A98,x
CODE_0DC4E6:
	LDA.w $7A96,x
	BNE.b CODE_0DC504
	LDA.w #$0004
	STA.w $7A98,x
	STZ.w $7402,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr10B_HoppingSilverTapTap
	BNE.b CODE_0DC502
	LDA.w #$000D
	STA.w $7402,x
CODE_0DC502:
	STZ.b $76,x
CODE_0DC504:
	RTS

CODE_0DC505:
	TYX
	LDA.w $7860,x
	BNE.b CODE_0DC4D4
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $134: BABY BOWSER -- the World 6 end boss. Raiden: init_baby_bowser.
; This is the largest sprite handler in the game and the biggest in this file.
; The fight has two phases: (1) on-foot at normal size, (2) giant Bowser (post-
; Kamek transformation). $134 handles BOTH phases (state machine in Main).
; Supporting cast spawned by this handler: $0CF BowserRocks (rumble), $128
; GroundRipple (screen-shake), $0CE BowserFire (breath), $008 FallingRubble,
; $0AC FallingRockArrowAndShadow (giant-Bowser rock attack telegraph + shadow).
; All of those live in the end-of-bank cluster below ($0DF6FE+).
; See docs/bossengine.md.
;---------------------------------------------------------------------------
YI_NorSpr134_BabyBowser_Init:
init_baby_bowser:
;$0DC50C
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; DATA_baby_bowser_phase_ptrs -- Baby Bowser per-phase pointer table (39 entries).
; Indexed (via ASL of $76,x) by Baby Bowser's current AI phase. The first
; ~$13 entries are the small-Bowser intro / hop / chase; entries $13-$15
; jump into Kamek's "throw the magic dust" handlers (CODE_0DEBAA /
; CODE_0DEBE7); entries $16+ run the giant-Bowser phase.
;
; Baby Bowser itself is documented in docs/bossengine.md §10 Q3. The supporting
; cast that coordinates with this phase machine (FallingRubble $008, GiantEgg
; $026, BowserRoomKamek $08E, FallingRockArrow $0AC, BowserFire $0CE, BowserRocks
; $0CF, GroundRipple $128) -- including the 8 shared WRAM coordinator words
; ($1015, $1062, $1068/$106A/$106C, $1070-$1078, $105C, $105E) -- is documented
; in docs/family-bowserfight.md.
;-------------------------------------------------------------------------
DATA_baby_bowser_phase_ptrs:
DATA_0DC50D:
	dw CODE_0DC7D5
	dw CODE_0DC81A
	dw CODE_0DC834
	dw CODE_0DC876
	dw CODE_0DC916
	dw CODE_0DC985
	dw CODE_0DC9B3
	dw CODE_0DC9E4
	dw CODE_0DCA06
	dw CODE_0DCA0E
	dw CODE_0DCADC
	dw CODE_0DCAFD
	dw CODE_0DCB4C
	dw CODE_0DCB6C
	dw CODE_0DCB82
	dw CODE_0DCBC9
	dw CODE_0DCC11
	dw CODE_0DCC28
	dw CODE_0DCE3C
	dw CODE_0DEBAA
	dw CODE_0DEBE7
	dw CODE_0DCE3C
	dw CODE_0DD267
	dw CODE_0DD300
	dw CODE_0DD4AC
	dw CODE_0DD617
	dw CODE_0DD65E
	dw CODE_0DD71D
	dw CODE_0DDA15
	dw CODE_0DD77B
	dw CODE_0DD913
	dw CODE_0DF1A9
	dw CODE_0DD617
	dw CODE_0DF32A
	dw CODE_0DF358
	dw CODE_0DF360
	dw CODE_0DF383
	dw CODE_0DF4F7
	dw CODE_0DF5B2

;---------------------------------------------------------------------------
; Sprite $134 main. Raiden: main_baby_bowser. Very long state machine; see
; phase-2 (giant) handler in another file.
;---------------------------------------------------------------------------
YI_NorSpr134_BabyBowser_Main:
main_baby_bowser:
;$0DC55B
	LDY.b $76,x
	CPY.b #$24
	BPL.b CODE_0DC569
	CPY.b #$21
	BPL.b CODE_0DC56C
	CPY.b #$16
	BMI.b CODE_0DC56C
CODE_0DC569:
	JMP.w CODE_0DC5E6

CODE_0DC56C:
	JSR.w CODE_0DC5F9
	LDY.b $76,x
	CPY.b #$21
	BPL.b CODE_0DC5E6
	JSR.w CODE_0DC64B
	LDY.b $76,x
	CPY.b #$12
	BPL.b CODE_0DC5C5
	CPY.b #$0F
	BPL.b CODE_0DC5A7
	LDY.b #$22
	CPY.w !RAM_YI_Global_BGModeAndTileSizeSetting
	BEQ.b CODE_0DC59A
	STY.w !RAM_YI_Global_BGModeAndTileSizeSetting
	LDY.b #$04
	STY.w $011C
	LDA.w !RAM_YI_Global_Layer1YPosLo
	ORA.w #$2000
	STA.w $7EF0
CODE_0DC59A:
	LDX.b #FXCODE_0B96C3>>16
	LDA.w #FXCODE_0B96C3
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	BRA.b CODE_0DC5BF

CODE_0DC5A7:
	LDY.b #$69
	STY.w !RAM_YI_Global_BGModeAndTileSizeSetting
	LDY.b #$02
	STY.w $011C
	LDA.w #$0017
	LDY.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_0DC5BC
	LDA.w #$0413
CODE_0DC5BC:
	STA.w !RAM_YI_Global_MainScreenLayers
CODE_0DC5BF:
	JSL.l CODE_03AF23
	BRA.b CODE_0DC5D8

CODE_0DC5C5:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_0DC5D8
	JSL.l CODE_03B697
	JSL.l CODE_03B716
CODE_0DC5D8:
	LDY.b $76,x
	CPY.b #$0A
	BPL.b CODE_0DC5F0
	JSR.w CODE_0DC6CE
	JSR.w CODE_0DC77A
	BRA.b CODE_0DC5F0

CODE_0DC5E6:
	LDA.w #$0011
	STA.w $0B83
	JSL.l CODE_03AF23
CODE_0DC5F0:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_baby_bowser_phase_ptrs,x)
	RTL

CODE_0DC5F9:
	LDA.w $7362,x
	BMI.b CODE_0DC642
	LDY.w $74A2,x
	BMI.b CODE_0DC642
	LDA.w $7680,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7682,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7402,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7362,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w $7400,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #$000B
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #DATA_0DDFA5
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_0DDFA5>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_08A16C>>16
	LDA.w #FXCODE_08A16C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_0DC642:
	RTS

DATA_0DC643:
	dw $0008,$FFE8

DATA_0DC647:
	dw $FD00,$0300

CODE_0DC64B:
	LDY.w $60D4
	BEQ.b CODE_0DC670
	LDA.w $60FC
	AND.w #$0007
	BEQ.b CODE_0DC670
	LDY.w $1064
	BNE.b CODE_0DC673
	INC.w $1064
	STZ.b $0A
	LDA.w #$0010
	STA.b $0C
	LDA.w $611C
	STA.b $02
	JSR.w CODE_0DC674
	RTS

CODE_0DC670:
	STZ.w $1064
CODE_0DC673:
	RTS

CODE_0DC674:
	LDA.w #$0002
	STA.b $00
	STZ.b $06
	LDY.b #$00
CODE_0DC67D:
	STY.b $06
	LDY.b $00
	LDA.b $02
	CLC
	ADC.w DATA_0DC643,y
	STA.b $02
	LDA.w DATA_0DC647,y
	STA.b $04
	TXA
	SEC
	SBC.w #$0004
	TAY
	LDA.w #$0128
	JSL.l CODE_03A34E
	BCC.b CODE_0DC6CD
	LDA.b $02
	STA.w $70E2,y
	LDA.w #$07B8
	STA.w $7182,y
	LDA.b $04
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $00
	STA.w $7400,y
	LDA.b $0A
	STA.w $7AF6,y
	LDA.b $0C
	STA.w $7AF8,y
	LDA.b $06
	STA.w $7A36,y
	DEC.b $00
	DEC.b $00
	BPL.b CODE_0DC67D
	TYA
	LDY.b $06
	STA.w $7A36,y
CODE_0DC6CD:
	RTS

CODE_0DC6CE:
	LDA.w $7AF8,x
	BNE.b CODE_0DC6CD
	LDY.w $7D36,x
	BPL.b CODE_0DC6CD
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_0DC737
	LDY.w $60AB
	BMI.b CODE_0DC6CD
	LDY.w $60C0
	BEQ.b CODE_0DC6CD
	STZ.w $60D4
	LDA.w #$FA00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	LDY.b $76,x
	CPY.b #$0A
	BPL.b CODE_0DC6CD
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$002E
	STA.w $7402,x
	LDA.w #$0008
	STA.w $7A98,x
	LDA.w #$003B
	STA.w $7A36,x
	LDA.w #$003D
	STA.w $7A38,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.b #$07
	STY.b $76,x
	RTS

CODE_0DC737:
	LDY.b $76,x
	CPY.b #$03
	BEQ.b CODE_0DC742
	JSL.l CODE_03A858
	RTS

CODE_0DC742:
	LDA.w $61B2
	BPL.b CODE_0DC751
	JSL.l CODE_06D10C
	LDA.w #$0040
	STA.w $7AF8
CODE_0DC751:
	LDA.w #$000A
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	TXA
	STA.w $7E48
	STZ.w $1060
	STZ.b $18,x
	LDA.w #$8000
	STA.w $0390
	LDA.w #$FFFF
	STA.w $0CD0
	LDA.w #$0020
	STA.w $0CC8
	LDA.w #!Define_YI_SoundID8B_BabyBowserPound
	JSL.l CODE_push_sound_queue
CODE_0DC779:
	RTS

CODE_0DC77A:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0DC779
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0DC779
	LDA.w $7D38,y
	BEQ.b CODE_0DC779
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.b $00
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDY.b $76,x
	CPY.b #$07
	BPL.b CODE_0DC779
	LDA.w #$0080
	LDY.b $01
	BPL.b CODE_0DC7A7
	LDA.w #$FF80
CODE_0DC7A7:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $75E0,x
	LDA.w #$0040
	STA.w $7542,x
CODE_0DC7B3:
	STZ.b $16,x
	LDA.w #$0026
	STA.w $7402,x
	STZ.w $7A98,x
CODE_0DC7BE:
	LDA.w #$003D
	STA.w $7A36,x
	LDA.w #$003F
	STA.w $7A38,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.b #$09
	STY.b $76,x
	RTS

CODE_0DC7D5:
	TYX
	LDY.w $77C2,x
	TYA
	STA.w $7400,x
	LDA.w $7A98,x
	BNE.b CODE_0DC819
	INC.b $76,x
CODE_0DC7E4:
	LDA.w $7C16,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$F880
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$F800
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0017
	STA.w $7A36,x
	LDA.w #$001A
	STA.w $7A38,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_0DC819:
	RTS

CODE_0DC81A:
	JSR.w CODE_0DCF8F
	BCC.b CODE_0DC833
	LDA.w #$001A
	STA.w $7A36,x
	LDA.w #$0022
	STA.w $7A38,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $76,x
CODE_0DC833:
	RTS

CODE_0DC834:
	TYX
	LDY.w $7223,x
	BMI.b CODE_0DC875
	LDY.w $7542,x
	BEQ.b CODE_0DC846
	LDA.w #!Define_YI_SoundID8B_BabyBowserPound
	JSL.l CODE_push_sound_queue
CODE_0DC846:
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	TXY
	JSR.w CODE_0DCF8F
	BCC.b CODE_0DC875
	STZ.w $1066
	LDA.w #$0800
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w #$005B
	STA.w $7A36,x
	LDA.w #$005E
	STA.w $7A38,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $76,x
CODE_0DC875:
	RTS

CODE_0DC876:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_0DC8B1
	LDA.w $7974
	AND.w #$0003
	BNE.b CODE_0DC8B0
	LDA.w #!Define_YI_AmbSpr1DD
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $10
	AND.w #$000F
	SEC
	SBC.w #$0007
	CLC
	ADC.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$0004
	STA.w $7E4C,y
	LDA.w #$0006
	STA.w $7782,y
CODE_0DC8B0:
	RTS

CODE_0DC8B1:
	LDY.w $1066
	BNE.b CODE_0DC8ED
	INC.w $1066
	LDA.w #$0040
	STA.w $61C6
	LDA.w #!Define_YI_AmbSpr1DC
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #$000B
	STA.w $7E4C,y
	LDA.w #$0010
	STA.b $0A
	STZ.b $0C
	LDA.w $7CD6,x
	STA.b $02
	JSR.w CODE_0DC674
CODE_0DC8ED:
	LDA.w #$0040
	STA.w $7542,x
	TXY
	JSR.w CODE_0DCF8F
	BCC.b CODE_0DC915
CODE_0DC8F9:
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w #$000B
	STA.w $7A36,x
	LDA.w #$000F
	STA.w $7A38,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.b #$04
	STY.b $76,x
CODE_0DC915:
	RTS

CODE_0DC916:
	JSR.w CODE_0DCF8F
	BCS.b CODE_0DC920
	JSR.w CODE_0DC935
	BCC.b CODE_0DC934
CODE_0DC920:
	LDA.w #$0013
	STA.w $7A36,x
	LDA.w #$0015
	STA.w $7A38,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $76,x
CODE_0DC934:
	RTS

CODE_0DC935:
	LDY.w $60D4
	BEQ.b CODE_0DC94E
	LDA.w $60FC
	AND.w #$0007
	BNE.b CODE_0DC94E
	LDA.w $7C16,x
	CLC
	ADC.w #$0038
	CMP.w #$0070
	BCC.b CODE_0DC981
CODE_0DC94E:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0128
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDX.b #FXCODE_098EBF>>16
	LDA.w #FXCODE_098EBF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_0DC983
	LDA.w $7CD6,y
	SEC
	SBC.w $7CD6,x
	STA.b $00
	CLC
	ADC.w #$0038
	CMP.w #$0070
	BCS.b CODE_0DC983
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	EOR.b $00
	BPL.b CODE_0DC983
CODE_0DC981:
	SEC
	RTS

CODE_0DC983:
	CLC
	RTS

CODE_0DC985:
	JSR.w CODE_0DCF8F
	BCS.b CODE_0DC998
	LDY.w $7402,x
	CPY.b #$09
	BNE.b CODE_0DC9B2
	JSR.w CODE_0DC935
	BCC.b CODE_0DC9B2
	BRA.b CODE_0DC9CD

CODE_0DC998:
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0015
	STA.w $7A36,x
	LDA.w #$0017
	STA.w $7A38,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $76,x
CODE_0DC9B2:
	RTS

CODE_0DC9B3:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0DC9E3
	JSR.w CODE_0DCF8F
	BCS.b CODE_0DC9D4
	LDY.w $7402,x
	CPY.b #$0C
	BNE.b CODE_0DC9E3
	JSR.w CODE_0DC935
	BCC.b CODE_0DC9E3
CODE_0DC9CD:
	LDA.w #$0001
	STA.w $7A98,x
	RTS

CODE_0DC9D4:
	LDY.w $77C2,x
	TYA
	STA.w $7400,x
	LDA.w #$0002
	STA.w $7A98,x
	STZ.b $76,x
CODE_0DC9E3:
	RTS

CODE_0DC9E4:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0DC9E3
	JSR.w CODE_0DCF8F
	BCS.b CODE_0DCA03
	LDY.w $7402,x
	BNE.b CODE_0DC9E3
	LDY.w $7A98,x
	CPY.b #$10
	BPL.b CODE_0DC9E3
	JSR.w CODE_0DC935
	BCC.b CODE_0DC9E3
CODE_0DCA03:
	JMP.w CODE_0DCB51

CODE_0DCA06:
	JSR.w CODE_0DCF8F
	BCC.b CODE_0DCA22
	JMP.w CODE_0DCB74

CODE_0DCA0E:
	TYX
	LDY.w $7223,x
	BMI.b CODE_0DC9E3
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_0DCA23
	LDA.w #$0027
	STA.w $7402,x
CODE_0DCA22:
	RTS

CODE_0DCA23:
	JSR.w CODE_0DCA59
	JSR.w CODE_0DCA7B
	TXY
	JSR.w CODE_0DCF8F
	BCC.b CODE_0DC9E3
	INC.b $16,x
	LDY.b $16,x
	CPY.b #$03
	BMI.b CODE_0DCA3D
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JMP.w CODE_0DC8F9

CODE_0DCA3D:
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0027
	STA.w $7402,x
	LDA.w $75E0,x
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $75E0,x
	JMP.w CODE_0DC7BE

CODE_0DCA59:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_0DCA7B:
	LDA.w $7974
	AND.w #$0007
	BNE.b CODE_0DCADB
	LDA.w #!Define_YI_SoundID1F_HitHead
	JSL.l CODE_push_sound_queue
	LDA.w #$FFC0
	LDY.w $7221,x
	BMI.b CODE_0DCA95
	LDA.w #$0040
CODE_0DCA95:
	STA.b $00
	LDA.w #!Define_YI_AmbSpr1D8
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $10
	AND.w #$0007
	SEC
	SBC.w #$0004
	CLC
	ADC.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7142,y
	LDA.w #$0008
	STA.w $7782,y
	LDA.w #$0003
	STA.w $7E4C,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FF80
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $77C2,x
	AND.w #$00FF
	EOR.w #$0002
	STA.w $73C0,y
CODE_0DCADB:
	RTS

CODE_0DCADC:
	JSR.w CODE_0DCF8F
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0DCAFB
	JSR.w CODE_0DCA59
	LDY.w $7402,x
	CPY.b #$0F
	BNE.b CODE_0DCAFB
	LDA.w #!Define_YI_SoundID34_BurtJump
	JSL.l CODE_push_sound_queue
	JSR.w CODE_0DF343
CODE_0DCAFB:
	BRA.b CODE_0DCB22

CODE_0DCAFD:
	TYX
	JSR.w CODE_0DCA59
	TXY
	JSR.w CODE_0DCF8F
	BCC.b CODE_0DCB1F
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.w $1062
	LDY.w $1062
	CPY.b #$03
	BMI.b CODE_0DCB1C
	JSR.w CODE_0DCB2A
	LDY.b #$0E
	STY.b $76,x
	RTS

CODE_0DCB1C:
	JSR.w CODE_0DCBF6
CODE_0DCB1F:
	JSR.w CODE_0DCA7B
CODE_0DCB22:
	LDA.w $7974
	AND.w #$0002
	BNE.b CODE_0DCB3B
CODE_0DCB2A:
	LDX.b #$1C
CODE_0DCB2C:
	LDA.l $702F2C,x
	STA.l YI_Global_PaletteMirror[$E0].LowByte,x
	DEX
	DEX
	BNE.b CODE_0DCB2C
	LDX.b $12
	RTS

CODE_0DCB3B:
	LDX.b #$1C
CODE_0DCB3D:
	LDA.l DATA_5FA56E,x
	STA.l YI_Global_PaletteMirror[$E0].LowByte,x
	DEX
	DEX
	BNE.b CODE_0DCB3D
	LDX.b $12
	RTS

CODE_0DCB4C:
	JSR.w CODE_0DCF8F
	BCC.b CODE_0DCB22
CODE_0DCB51:
	LDA.w #$0002
	STA.w $7A98,x
	LDA.w #$005E
	STA.w $7A36,x
	LDA.w #$0061
	STA.w $7A38,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $76,x
	RTS

CODE_0DCB6C:
	JSR.w CODE_0DCF8F
	BCC.b CODE_0DCB22
	JSR.w CODE_0DCB2A
CODE_0DCB74:
	LDY.w $77C2,x
	TYA
	STA.w $7400,x
	LDY.b #$01
	STY.b $76,x
	JMP.w CODE_0DC7E4

CODE_0DCB82:
	TYX
	LDA.w #$0128
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	INC
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0991DB>>16
	LDA.w #FXCODE_0991DB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R6_MultiplierLo
	BNE.b CODE_0DCBC8
	LDA.w $7C16,x
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCS.b CODE_0DCBC8
	LDY.w $61B3
	BPL.b CODE_0DCBC8
	LDA.w #$0048
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0DCBC8
	LDA.w #$0010
	STA.w $70E2,y
	INC.w $1015
	JSL.l CODE_0181FB
	LDX.b $12
	INC.b $76,x
CODE_0DCBC8:
	RTS

CODE_0DCBC9:
	TYX
	LDY.w $1015
	BPL.b CODE_0DCC10
	PHB
	REP.b #$10
	LDX.w #$702D6C
	LDY.w #$702F6C
	LDA.w #$01FF
	MVN $702F6C>>16,$702D6C>>16
	SEP.b #$10
	PLB
	LDX.b #$20
	LDA.w #$0000
CODE_0DCBE6:
	STA.l $70312A,x
	DEX
	DEX
	BNE.b CODE_0DCBE6
	LDX.b $12
	LDA.w #!Define_YI_MusicID0B_BabyBowserBattlePhase1
	STA.w !RAM_YI_Global_PlayMusicLo
CODE_0DCBF6:
	LDA.w #$0030
	STA.w $7A98,x
	LDA.w #$0056
	STA.w $7A36,x
	LDA.w #$005B
	STA.w $7A38,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $76,x
CODE_0DCC10:
	RTS

CODE_0DCC11:
	JSR.w CODE_0DCF8F
	BCC.b CODE_0DCC27
	STZ.w $1015
	STZ.w $7400,x
	LDA.w #$0000
	STA.l $70336C
	STZ.b $16,x
	INC.b $76,x
CODE_0DCC27:
	RTS

CODE_0DCC28:
	TYX
	LDA.w $7974
	AND.w #$0003
	BNE.b CODE_0DCC7A
	LDA.l $70336C
	CMP.w #$0020
	BMI.b CODE_0DCC47
	LDA.w #$0048
	STA.b $18,x
	INC.w $0B59
	LDY.b #$16
	STY.b $76,x
	RTS

CODE_0DCC47:
	CMP.w #$0010
	BMI.b CODE_0DCC61
	LDY.b $16,x
	BNE.b CODE_0DCC61
	LDA.w #$00CF
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0DCC7A
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	STA.b $16,x
CODE_0DCC61:
	LDA.w #$2D6C
	STA.l $70336E
	LDA.w #$2F6C
	STA.l $703370
	LDX.b #FXCODE_08B4A9>>16
	LDA.w #FXCODE_08B4A9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_0DCC7A:
	RTS

DATA_0DCC7B:
	dw CODE_0DCF8F
	dw CODE_0DCFF3
	dw CODE_0DCFFC
	dw CODE_0DD011
	dw CODE_0DD01D
	dw CODE_0DD009
	dw CODE_0DD0A2
	dw CODE_0DD0A8
	dw CODE_0DD025
	dw CODE_0DD02B
	dw CODE_0DD087
	dw CODE_0DD036
	dw CODE_0DD052
	dw CODE_0DD06E
	dw CODE_0DD0AE

DATA_0DCC99:
	db $0A,$04,$04,$02,$02,$02,$02,$02,$02,$04,$0A,$02,$02,$02,$04,$08
	db $00

DATA_0DCCAA:
	dw $0002,$0040,$0000,$0000,$0004,$0001,$0000,$0000
	dw $0004,$0006,$0010,$0004,$0000,$0006,$000B,$0001
	dw $0006,$0000,$000B,$000F,$0002,$000B,$0010,$000A
	dw $0008,$0004,$0113,$000C,$0000,$000F,$0013,$0003
	dw $000F,$0000,$000B,$000F,$0002,$000B,$000E,$0008
	dw $0000,$0013,$0015,$0001,$0013,$0014,$0000,$FC00
	dw $0800,$0080,$001A,$0000,$0015,$0017,$0001,$0015
	dw $0014,$FDC0,$F900,$0400,$0040,$0000,$0017,$001A
	dw $0001,$0017,$0016,$0000,$001A,$0022,$0001,$001A
	dw $0014,$0000,$0800,$0400,$0000,$0018,$0000,$0022
	dw $0025,$0001,$0022,$0014,$0000,$FC00,$0800,$0080
	dw $0016,$0000,$001A,$0022,$0001,$001A,$0014,$0000
	dw $0800,$0400,$0000,$0018,$0000,$0022,$0025,$0001
	dw $0022,$0014,$0000,$FC00,$0800,$0080,$0016,$0000
	dw $001A,$0022,$0001,$001A,$0014,$0000,$0800,$0400
	dw $0000,$0018,$0000,$0022,$0025,$0001,$0022,$0010
	dw $0000,$002F,$0036,$0001,$002F,$0012,$0003,$0004
	dw $0114,$000C,$0000,$0036,$003B,$0001,$0036,$001C
	dw $0010,$0014,$FFE0,$0000,$0400,$0040,$0000,$0025
	dw $0027,$0003,$0025,$0014,$0000,$0000,$0400,$0040
	dw $000E,$0006,$000C,$0000,$0027,$002B,$0003,$0027
	dw $0000,$002B,$002F,$0002,$002B,$001C,$0010,$0014
	dw $FFE0,$0000,$0400,$0040,$0000,$0025,$0027,$0003
	dw $0025,$0014,$0000,$0000,$0400,$0040,$000E,$0006
	dw $000C,$0000,$0027,$002B,$0003,$0027,$000E,$0008
	dw $FFFF

CODE_0DCE3C:
	TYX
	BRA CODE_0DCE63

CODE_0DCE3F:
	LDA.w #$0048
	STA.b $18,x
	LDA.w #$7FFF
	STA.w $0948
	LDA.w $6094
	CLC
	ADC.w #$0080
	STA.w $70E2,x
	LDA.w $609C
	CLC
	ADC.w #$0080
	STA.w $7182,x
	LDY.b #$16
	STY.b $76,x
	RTS

CODE_0DCE63:
	LDA.b $78,x
	TAX
	JSR.w (DATA_0DCC7B,x)
	BCC.b CODE_0DCECC
	REP.b #$10
	LDY.b $18,x
	LDA.w DATA_0DCCAA-$02,y
	BPL.b CODE_0DCEA1
	SEP.b #$10
	STZ.w $0C1E
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #!Define_YI_MusicID0C_BabyBowserAndCastleBossTheme
	STA.w !RAM_YI_Global_PlayMusicLo
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0040
	STA.w $7542,x
	STZ.b $76,x
	LDX.b #$1C
CODE_0DCE92:
	LDA.l YI_Global_PaletteMirror[$E0].LowByte,x
	STA.l $702F2C,x
	DEX
	DEX
	BNE.b CODE_0DCE92
	LDX.b $12
	RTS

CODE_0DCEA1:
	STA.b $78,x
	PHA
	LDA.w DATA_0DCCAA,y
	STA.w $7A36,x
	LDA.w DATA_0DCCAA+$02,y
	STA.w $7A38,x
	LDA.w DATA_0DCCAA+$04,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w DATA_0DCCAA+$06,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	PLA
	LSR
	TAY
	LDA.w DATA_0DCC99,y
	AND.w #$00FF
	CLC
	ADC.b $18,x
	STA.b $18,x
	SEP.b #$10
CODE_0DCECC:
	RTS

DATA_0DCECD:
	db $02,$03,$04,$05,$06,$07,$05,$04,$03,$02,$00,$01,$00,$01,$00,$02
	db $03,$02,$00,$08,$09,$0B,$0C,$0B,$09,$0A,$0E,$0F,$10,$11,$12,$13
	db $09,$14,$15,$08,$00,$1A,$1B,$1E,$1F,$1E,$1C,$1D,$1C,$1D,$1C,$16
	db $17,$18,$19,$17,$0B,$0C,$1A,$0C,$1A,$0C,$1A,$08,$00,$08,$00,$22
	db $23,$22,$23,$22,$24,$25,$24,$09,$13,$12,$11,$10,$0F,$0E,$28,$29
	db $2A,$2B,$2A,$2B,$2A,$2B,$2C,$2D,$0E,$08,$00,$15,$08,$00,$08,$0B
	db $0C

DATA_0DCF2E:
	db $04,$04,$04,$04,$02,$02,$04,$04,$04,$04,$10,$04,$04,$04,$04,$02
	db $06,$02,$06,$08,$01,$08,$10,$08,$08,$10,$02,$02,$02,$02,$02,$02
	db $02,$10,$04,$04,$04,$08,$08,$02,$06,$02,$06,$04,$04,$04,$04,$10
	db $02,$02,$18,$02,$04,$01,$0C,$0C,$04,$04,$10,$04,$50,$08,$01,$20
	db $04,$04,$04,$20,$02,$10,$02,$02,$02,$02,$02,$02,$02,$02,$02,$02
	db $02,$02,$02,$04,$04,$10,$04,$04,$04,$08,$10,$04,$04,$20,$02,$02
	db $02

CODE_0DCF8F:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0DCFF1
	LDA.w $7A36,x
	CMP.w $7A38,x
	BMI.b CODE_0DCFA5
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0DCFFA
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_0DCFA5:
	INC
	STA.w $7A36,x
	TAY
	LDA.w DATA_0DCF2E-$01,y
	AND.w #$00FF
	STA.w $7A98,x
	LDA.w DATA_0DCECD-$01,y
	AND.w #$00FF
	STA.w $7402,x
	CPY.b #$05
	BPL.b CODE_0DCFCE
	CMP.w #$0002
	BNE.b CODE_0DCFF1
	LDA.w #!Define_YI_SoundID8D_BabyBowserYawn
	JSL.l CODE_push_sound_queue
	BRA.b CODE_0DCFF1

CODE_0DCFCE:
	CPY.b #$0F
	BMI.b CODE_0DCFF1
	CPY.b #$14
	BPL.b CODE_0DCFDD
	CMP.w #$0003
	BNE.b CODE_0DCFF1
	BRA.b CODE_0DCFEA

CODE_0DCFDD:
	CPY.b #$27
	BMI.b CODE_0DCFF1
	CPY.b #$2C
	BPL.b CODE_0DCFF1
	CMP.w #$001F
	BNE.b CODE_0DCFF1
CODE_0DCFEA:
	LDA.w #!Define_YI_SoundID8C_BabyBowserTalk
	JSL.l CODE_push_sound_queue
CODE_0DCFF1:
	CLC
	RTS

CODE_0DCFF3:
	TYX
	LDA.w $7A36,x
	STA.w $61C6
CODE_0DCFFA:
	SEC
	RTS

CODE_0DCFFC:
	TYX
	LDA.w $7A36,x
	STA.l $704070
	INC.w !RAM_YI_Level_MessageBoxState 
CODE_0DD007:
	SEC
	RTS

CODE_0DD009:
	TYX
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_0DD007
	CLC
	RTS

CODE_0DD011:
	TYX
	LDA.l $704073
	TAY
	CPY.b #$12
	BEQ.b CODE_0DD007
	CLC
	RTS

CODE_0DD01D:
	TYX
	LDA.w !RAM_YI_Level_MessageBoxState 
	BEQ.b CODE_0DD007
	CLC
	RTS

CODE_0DD025:
	TYX
	INC.w $105C
CODE_0DD029:
	SEC
	RTS

CODE_0DD02B:
	TYX
	LDY.w $7A36,x
	CPY.w $105C
	BEQ.b CODE_0DD029
CODE_0DD034:
	CLC
	RTS

CODE_0DD036:
	TYX
	LDA.w $7542,x
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0DD034
	LDA.w #!Define_YI_SoundID8B_BabyBowserPound
	JSL.l CODE_push_sound_queue
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	SEC
	RTS

CODE_0DD052:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0DD034
	LDA.w #$0020
	STA.w $61C6
	ASL
	STA.w $7542,x
	LDA.w #!Define_YI_SoundID23_GroundPound
	JSL.l CODE_push_sound_queue
	SEC
	RTS

CODE_0DD06E:
	TYX
	LDY.w $7223,x
	BMI.b CODE_0DD034
	LDA.w #$077D
	CMP.w $7182,x
	BPL.b CODE_0DD034
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	SEC
	RTS

CODE_0DD087:
	TYX
	LDA.w $7A36,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A38,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $75E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7542,x
	SEC
	RTS

CODE_0DD0A2:
	TYX
	STY.w $0071
	SEC
	RTS

CODE_0DD0A8:
	TYX
	STZ.w $0071
CODE_0DD0AC:
	SEC
	RTS

CODE_0DD0AE:
	TYX
	DEC.w $7A36,x
	BEQ.b CODE_0DD0AC
	CLC
	RTS

DATA_0DD0B6:
	db $6C,$58,$5A,$5A,$5B,$56,$59,$59,$5C,$55,$58,$58,$5C,$54,$58,$58
	db $5C,$53,$57,$57,$5C,$52,$57,$57,$5C,$51,$56,$56,$5C,$50,$56,$56
	db $5C,$3E,$3F,$50,$64,$3D,$40,$4F,$65,$3D,$41,$4E,$65,$3C,$42,$4D
	db $65,$3B,$44,$4D,$64,$3B,$45,$4C,$64,$3A,$44,$4B,$63,$2F,$43,$4B
	db $62,$2C,$41,$4A,$61,$2A,$43,$4A,$60,$28,$45,$49,$5F,$27,$45,$45
	db $60,$25,$44,$44,$62,$24,$43,$43,$63,$23,$43,$43,$64,$22,$43,$43
	db $65,$22,$43,$43,$66,$21,$43,$43,$66,$15,$43,$43,$66,$11,$43,$43
	db $65,$0E,$43,$43,$58,$0C,$43,$43,$50,$0B,$43,$43,$50,$09,$43,$43
	db $51,$08,$43,$43,$52,$07,$43,$43,$52,$06,$43,$43,$53,$05,$43,$43
	db $53,$05,$54,$69,$6B,$04,$54,$67,$6B,$03,$55,$66,$6B,$03,$55,$64
	db $6B,$02,$55,$62,$6B,$02,$56,$61,$6B,$02,$56,$5F,$6B,$01,$56,$5E
	db $6B,$01,$59,$5C,$6B,$01,$43,$43,$6B,$00,$43,$43,$6B,$00,$43,$43
	db $6B,$00,$43,$43,$6B,$00,$43,$43,$6B,$00,$43,$43,$6B,$00,$43,$43
	db $6B,$00,$43,$43,$6B,$00,$44,$44,$6B,$00,$44,$44,$6B,$00,$45,$45
	db $6B,$01,$46,$46,$6C,$01,$47,$47,$6C,$02,$48,$48,$6D,$02,$49,$49
	db $6E,$03,$4A,$4A,$6E,$04,$4B,$4B,$6F,$04,$4C,$4C,$7F,$05,$4D,$4D
	db $7F,$06,$4E,$4E,$7F,$08,$4F,$4F,$7E,$09,$50,$50,$7D,$0B,$51,$51
	db $7C,$0E,$51,$51,$7B,$21,$52,$52,$7B,$22,$52,$52,$7A,$24,$52,$52
	db $79,$28,$52,$52,$78,$2E,$53,$53,$77,$2F,$53,$53,$76,$30,$53,$53
	db $76,$2D,$53,$53,$76,$2C,$53,$53,$76,$2C,$53,$53,$76,$2C,$53,$53
	db $77,$25,$53,$53,$79,$24,$53,$53,$79,$24,$53,$53,$7A,$24,$53,$53
	db $7A,$24,$53,$53,$7A,$24,$53,$53,$7A,$24,$53,$53,$7A,$24,$53,$53
	db $7A,$24,$53,$53,$7A,$25,$53,$53,$7A,$25,$53,$53,$7A,$25,$53,$53
	db $79,$26,$53,$53,$79,$26,$53,$53,$78,$27,$53,$53,$77,$28,$53,$53
	db $76,$28,$53,$53,$75,$29,$53,$53,$73,$2A,$53,$53,$70,$2B,$53,$53
	db $6F,$2C,$53,$53,$6F,$2D,$41,$49,$6E,$2E,$41,$4A,$6D,$2F,$40,$4B
	db $6C,$30,$40,$4C,$6B,$31,$3F,$4E,$6A,$33,$3E,$51,$68,$36,$3C,$5A
	db $65

CODE_0DD267:
	TYX
	LDA.w #DATA_0DD0B6>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_0DD0B6
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0047
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0050
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7680,x
	CLC
	ADC.w #$0006
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7682,x
	CLC
	ADC.w #$0004
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_08BD37>>16
	LDA.w #FXCODE_08BD37
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E56D0,$703A02 : dw $0348
	LDX.b $12
	LDA.b $18,x
	CLC
	ADC.w #$0010
	STA.b $18,x
	CMP.w #$1000
	LDA.w #$0017
	LDY.b #$AA
	BCC.b CODE_0DD2CE
	INC.b $76,x
	JSL.l CODE_03BFF7
	LDY.b #$00
	TYA
	STY.w $0200
CODE_0DD2CE:
	STA.w !RAM_YI_Global_MainScreenLayers
	STA.w !RAM_YI_Global_MainScreenWindowMask
	STY.w !RAM_YI_Global_BG1And2WindowMaskSettings
	STY.w !RAM_YI_Global_BG3And4WindowMaskSettings
	STY.w !RAM_YI_Global_ObjectAndColorWindowSettings
	LDA.w #$0020
	TSB.w !RAM_YI_Global_HDMAEnable
	RTS

DATA_0DD2E4:
	dw $5000,$5800,$7000,$0000,$1000,$2000,$3000

DATA_0DD2F2:
	dw $0060,$005D,$005F,$00B3,$00B4,$00B5,$00B6

CODE_0DD300:
	PHD
	LDA.w #$0000
	TCD
	SEP.b #$20
	JSL.l CODE_disable_nmi
	LDX.b #$0C
	JSL.l CODE_set_level_music
	LDA.b #!Define_YI_MusicID01_MapAndLevelTheme
	STA.b !RAM_YI_Global_PlayMusicLo
	STA.w $0205
	LDA.b #$B1
	STA.w !REGISTER_IRQNMIAndJoypadEnableFlags
	REP.b #$20
	PLD
	LDX.b $12
	LDA.w #!Define_YI_PlayerState1A_DisableInput
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w $6094
	CMP.w #$0200
	BCS.b CODE_0DD354
	LDY.b #$01
	ADC.w #$0010
	CMP.w #$0200
	BCC.b CODE_0DD347
	LDA.w #$0240
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w #$0200
	STA.w $7E18
	DEY
CODE_0DD347:
	STY.w $0C1E
	STA.w $0C23
	LDA.w #$0280
	STA.w $7E1A
	RTS

CODE_0DD354:
	REP.b #$10
	LDA.w #$0800
	STA.b $00
	LDA.w $0C16
	BEQ.b CODE_0DD363
	JMP.w CODE_0DD42D

CODE_0DD363:
	LDA.w $0C14
	CMP.w #$0007
	BCS.b CODE_0DD36E
	JMP.w CODE_0DD3E9

CODE_0DD36E:
	STZ.w $0C18
	SEP.b #$10
	LDX.b #$1C
CODE_0DD375:
	LDA.w #$0000
	STA.l $702D6E,x
	STA.l YI_Global_PaletteMirror[$01].LowByte,x
	LDA.l DATA_5FF4BE,x
	STA.l $702F4E,x
	STA.l YI_Global_PaletteMirror[$F1].LowByte,x
	DEX
	DEX
	BPL.b CODE_0DD375
	LDA.w #DATA_5FF518>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_5FF518
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDX.b #FXCODE_09F572>>16
	LDA.w #FXCODE_09F572
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7F56DE,$705800 : dw $00D2
	JSL.l CODE_queue_dma_4args	: dl $7F5894,$7058D2 : dw $01A4
	JSL.l CODE_queue_dma_4args	: dl $7E5388,$70385E : dw $01A4
	LDX.b #$D2
	LDA.w #$0000
CODE_0DD3CE:
	STA.l $7E5110,x
	DEX
	DEX
	BNE.b CODE_0DD3CE
	LDX.b $12
	INC.b $76,x
	LDA.w #!Define_YI_PlayerState02_InCutscene
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w !RAM_YI_Global_MainScreenLayers
	LDY.b #$00
	STY.w !RAM_YI_Global_HDMAEnable
	RTS

CODE_0DD3E9:
	ASL
	TAY
	LDA.w #$6800
	STA.w $0C1A
	LDA.w DATA_0DD2E4,y
	STA.w $0C18
	LDX.w #$6800
	CMP.w #$4000
	BCS.b CODE_0DD402
	LDX.w #$7000
CODE_0DD402:
	LDA.w DATA_0DD2F2,y
	JSL.l CODE_00B756
	STA.w $0C16
	INC.w $0C14
	LDX.w $0C18
	CPX.w #$4000
	BCS.b CODE_0DD42D
	SEP.b #$10
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08AA5F>>16
	LDA.w #FXCODE_08AA5F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	ASL.w $0C16
	LDA.w $0C16
CODE_0DD42D:
	SEC
	SBC.w #$0800
	BCS.b CODE_0DD43B
	ADC.w #$0800
	STA.b $00
	LDA.w #$0000
CODE_0DD43B:
	STA.w $0C16
	LDX.w $0C1A
	TXA
	CLC
	ADC.b $00
	STA.w $0C1A
	LDA.w #$0070
	STA.w $0001
	LDY.w $0C18
	LDA.b $00
	CPY.w #$4000
	BCS.b CODE_0DD45E
	JSL.l CODE_00BF86
	BRA.b CODE_0DD464

CODE_0DD45E:
	JSL.l CODE_vram_dma_queue_add_180_2118
	LSR.b $00
CODE_0DD464:
	LDA.b $00
	CLC
	ADC.w $0C18
	STA.w $0C18
	SEP.b #$10
	LDX.b $12
	RTS

DATA_0DD472:
	db $00,!REGISTER_BGModeAndTileSizeSetting : dl $7E5040

DATA_0DD477:
	db $70,$07,$3B,$07,$01,$49,$00

DATA_0DD47E:
	db $70,$00,$11,$3B,$00,$11,$01,$00,$12,$00

DATA_0DD488:
	db $40,!REGISTER_CGRAMAddress : dl $7E5B98

DATA_0DD48D:
	db $E9 : dw $7E5112
	db $E9 : dw $7E517B
	db $00

DATA_0DD494:
	db $42,!REGISTER_WriteToCGRAMPort : dl $7E5C18

DATA_0DD499:
	db $E9 : dw $7E5388
	db $E9 : dw $7E545A
	db $00

DATA_0DD4A0:
	dw $0000,$00C0

DATA_0DD4A4:
	dw $0068,$0008

DATA_0DD4A8:
	dw $0020,$0040

CODE_0DD4AC:
	LDA.w $0C18
	CMP.w #$4000
	BCS.b CODE_0DD4CC
	REP.b #$10
	TAY
	ADC.b #$00
	PHP
	STA.w $0C18
	LDA.b #$00
	PHP
	LDX.w #$00FF
	JSL.l CODE_00BF4A
	SEP.b #$10
	LDX.b $12
	RTS

CODE_0DD4CC:
	SEP.b #$20
	LDX.b #$04
CODE_0DD4D0:
	LDA.w DATA_0DD472,x
	STA.w HDMA[$07].Parameters,x
	LDA.w DATA_0DD488,x
	STA.w HDMA[$03].Parameters,x
	LDA.w DATA_0DD494,x
	STA.w HDMA[$04].Parameters,x
	LDA.l DATA_hdma_channel_2_init,x
	STA.w HDMA[$02].Parameters,x
	LDA.l DATA_hdma_channel_1_init,x
	STA.w HDMA[$01].Parameters,x
	DEX
	BPL.b CODE_0DD4D0
	LDA.b #$7F
	STA.w HDMA[$02].IndirectSourceBank
	STA.w HDMA[$01].IndirectSourceBank
	LDX.b #$09
CODE_0DD4FD:
	LDA.w DATA_0DD477,x
	STA.l $7E5040,x
	LDA.w DATA_0DD47E,x
	STA.l $7E51E4,x
	DEX
	BPL.b CODE_0DD4FD
	LDX.b #$06
CODE_0DD510:
	LDA.w DATA_0DD48D,x
	STA.l $7E5B98,x
	LDA.w DATA_0DD499,x
	STA.l $7E5C18,x
	LDA.l DATA_hdma_indirect_table_4,x
	STA.l $7E5C98,x
	LDA.l DATA_hdma_indirect_table_5,x
	STA.l $7E5D18,x
	DEX
	BPL.b CODE_0DD510
	LDA.b #$C6
	STA.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDA.w #$0700
	STA.w $1068
	LDA.w #$0A00
	STA.w $106A
	LDA.w #$02C0
	STA.w $106C
	LDA.w #$0200
	STA.w !RAM_YI_Global_Mode7CenterXLo
	LDA.w #$0210
	STA.w !RAM_YI_Global_Mode7CenterYLo
	SEP.b #$10
	LDA.w #$00D5
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0DD5B5
	LDA.w #$0080
	STA.w $70E2,y
	STA.w $7182,y
	LDA.w #$F801
	STA.w $7040,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	SEP.b #$20
	LDA.b #$06
	STA.w $74A1,y
	REP.b #$20
	LDX.b #$02
CODE_0DD57E:
	LDA.w #$0083
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0DD5B5
	LDA.w !RAM_YI_Global_Layer2XPosLo
	CLC
	ADC.w DATA_0DD4A0,x
	STA.w $70E2,y
	LDA.w !RAM_YI_Global_Layer2YPosLo
	CLC
	ADC.w DATA_0DD4A4,x
	STA.w $7182,y
	LDA.w DATA_0DD4A8,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	CPX.b #$00
	BNE.b CODE_0DD5B1
	LDA.w #$0002
	STA.w $7402,y
	LDA.w #$2001
	STA.w $7040,y
CODE_0DD5B1:
	DEX
	DEX
	BPL.b CODE_0DD57E
CODE_0DD5B5:
	LDX.b $12
	LDA.w #$00CF
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0DD5C6
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
CODE_0DD5C6:
	LDY.b #$0A
	STY.w $011C
	LDY.b #$69
	STY.w !RAM_YI_Global_BG2AddressAndSize
	LDA.w #$000F
	STA.w !RAM_YI_Level_LevelHeaderBGScrollSettingLo
	LDA.w #$0002
	STA.w $7402,x
	LDA.w #$0180
	STA.w $7A96,x
	LDA.w #$0080
	STA.w $7A38,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$1200
	STA.w !RAM_YI_Global_MainScreenLayers
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $0B59
CODE_0DD5F7:
	INC.b $76,x
	STZ.b $18,x
	LDA.w !RAM_YI_Global_MainScreenLayers
	STA.w !RAM_YI_Global_MainScreenWindowMask
	LDY.b #$00
	STY.w !RAM_YI_Global_ObjectAndColorWindowSettings
	LDY.b #$22
	STY.w !RAM_YI_Global_ColorMathInitialSettings
	LDY.b #$20
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.w #$0020
	TRB.w !RAM_YI_Global_HDMAEnable
	RTS

CODE_0DD617:
	TYX
	LDA.w #$7FFF
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STZ.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	CLC
	ADC.w #$0001
	STA.b $18,x
	CMP.w #$0100
	BCC.b CODE_0DD633
	INC.b $76,x
CODE_0DD633:
	LDX.b #FXCODE_08E132>>16
	LDA.w #FXCODE_08E132
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDY.w $0B59
	BNE.b CODE_0DD655
	LSR
	LSR
	LSR
	XBA
	AND.w #$000F
	EOR.w #$000F
	TAY
	STY.w $0200
	RTS

CODE_0DD655:
	STA.l YI_Global_PaletteMirror[$00].LowByte
	RTS

DATA_0DD65A:
	db $30,$40,$20,$10

CODE_0DD65E:
	TYX
	JSR.w CODE_0DDEAA
	LDA.w #$0990
	SEC
	SBC.w $106A
	BPL.b CODE_0DD66E
	LDA.w #$0000
CODE_0DD66E:
	LSR
	CMP.w #$0100
	BMI.b CODE_0DD677
	LDA.w #$0100
CODE_0DD677:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #DATA_5FF482
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_5FF482>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0001
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08E167>>16
	LDA.w #FXCODE_08E167
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_0DD69D:
	LDA.w $7A96,x
	BNE.b CODE_0DD708
	LDA.b $14
	AND.w #$000F
	ORA.w #$0040
	STA.w $61C6
	LDA.w $106A
	SEC
	SBC.w #$0001
	STA.w $106A
	CMP.w #$0750
	BPL.b CODE_0DD6E2
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDX.b #$1C
CODE_0DD6C1:
	LDA.l DATA_5FF482,x
	STA.l $702D6E,x
	STA.l YI_Global_PaletteMirror[$01].LowByte,x
	DEX
	DEX
	BPL.b CODE_0DD6C1
	LDX.b $12
CODE_0DD6D3:
	LDA.w #$001B
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	LDA.w #$0005
	STA.b $78,x
	STZ.w $7AF8,x
	RTS

CODE_0DD6E2:
	CMP.w #$0900
	BPL.b CODE_0DD6ED
	LDA.w #$0001
	STA.w $61CE
CODE_0DD6ED:
	LDA.w $7A98,x
	BNE.b CODE_0DD708
	LDA.w #!Define_YI_SoundID48_LargeBlockLands
	JSL.l CODE_push_sound_queue
	LDA.b $10
	AND.w #$0003
	TAY
	LDA.w DATA_0DD65A,y
	AND.w #$00FF
	STA.w $7A98,x
CODE_0DD708:
	RTS

DATA_0DD709:
	dw $0002,$0004,$0006,$0004,$0002

DATA_0DD713:
	dw $00E0,$0004,$0130,$0004,$0080

CODE_0DD71D:
	TYX
	JSR.w CODE_0DDEAA
	LDY.w $1070
	CPY.b #$08
	BCC.b CODE_0DD72B
	JSR.w CODE_0DD8D3
CODE_0DD72B:
	LDA.w $7AF8,x
	BNE.b CODE_0DD760
	DEC.b $78,x
	BPL.b CODE_0DD73D
	INC.b $76,x
	LDA.w #$0100
	STA.w $7AF6,x
	RTS

CODE_0DD73D:
	LDA.b $78,x
	ASL
	TAY
	LDA.w DATA_0DD713,y
	STA.w $7AF8,x
	LDA.w DATA_0DD709,y
	STA.w $7402,x
	CMP.w #$0006
	BNE.b CODE_0DD760
	LDA.w #!Define_YI_SoundID91_BowserRoar
	JSL.l CODE_push_sound_queue
	LDA.w #$00CF
	JSL.l CODE_spawn_sprite_init
CODE_0DD760:
	RTS

DATA_0DD761:
	db $02,$04,$05,$04,$02,$04,$05,$04,$02,$04,$05,$04,$02

DATA_0DD76E:
	db $04,$04,$60,$04,$40,$04,$60,$04,$40,$04,$60,$04,$04

CODE_0DD77B:
	TYX
	JSR.w CODE_0DDEAA
	JSR.w CODE_0DD8D3
	LDA.w $7AF8,x
	BEQ.b CODE_0DD7F2
CODE_0DD787:
	LDY.w $7402,x
	CPY.b #$05
	BNE.b CODE_0DD7D4
	CMP.w #$0020
	BCC.b CODE_0DD7D4
	BNE.b CODE_0DD79F
	JSR.w CODE_0DD822
	LDA.w #$0030
	STA.w $7A36,x
	RTS

CODE_0DD79F:
	LDA.w #$0001
CODE_0DD7A2:
	PHA
	LDA.w #!Define_YI_AmbSpr1D3
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $611C
	SEC
	SBC.w #$0008
	STA.w $70A2,y
	LDA.w $611E
	SEC
	SBC.w #$0008
	STA.w $7142,y
	PLA
	STA.w $7782,y
	LDA.w $7A36,x
	STA.w $7E4C,y
	CMP.w #$0010
	BCC.b CODE_0DD7D5
	SEC
	SBC.w #$0004
	STA.w $7A36,x
CODE_0DD7D4:
	RTS

CODE_0DD7D5:
	LDA.b $14
	AND.w #$0007
	BNE.b CODE_0DD7E5
	PHY
	LDA.w #!Define_YI_SoundID63_AimedAt
	JSL.l CODE_push_sound_queue
	PLY
CODE_0DD7E5:
	LDA.b $14
	AND.w #$0004
	LSR
	ADC.w $7002,y
	STA.w $7002,y
	RTS

CODE_0DD7F2:
	DEC.b $78,x
	BPL.b CODE_0DD7FF
	DEC.b $76,x
	LDA.w #$0100
	STA.w $7AF6,x
	RTS

CODE_0DD7FF:
	LDY.b $78,x
	LDA.w DATA_0DD76E,y
	AND.w #$00FF
	STA.w $7AF8,x
	LDA.w DATA_0DD761,y
	AND.w #$00FF
	STA.w $7402,x
	CMP.w #$0005
	BNE.b CODE_0DD81F
	LDA.w #!Define_YI_SoundID91_BowserRoar
	JSL.l CODE_push_sound_queue
CODE_0DD81F:
	JMP.w CODE_0DD787

CODE_0DD822:
	LDA.w #!Define_YI_SoundID10_ShellHit6
	JSL.l CODE_push_sound_queue
	LDA.w #$0010
	JSR.w CODE_0DD7A2
	LDA.w $70A2,y
	STA.b $00
	LDA.w $7142,y
	STA.b $02
	LDA.w #$00CE
	JSL.l CODE_spawn_sprite_init
	BCS.b CODE_0DD845
	JMP.w CODE_0DD787

CODE_0DD845:
	LDA.w $106C
	SEC
	SBC.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	CLC
	ADC.w $1068
	SEC
	SBC.w #$0100
	STA.w $70E2,y
	LDA.w $106A
	SEC
	SBC.w #$0050
	STA.w $7182,y
	STY.b $04
	LDA.b $00
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $1068
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	CLC
	ADC.w #$0300
	ASL
	STA.b $06
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $04
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.b $16,x
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $02
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $1068
	STA.b $76,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.b $06
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $04
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDX.b $12
	RTS

DATA_0DD8CF:
	dw $0120,$FFD0

CODE_0DD8D3:
	LDA.w $7A98,x
	BNE.b CODE_0DD912
	LDX.b #FXCODE_09F743>>16
	LDA.w #FXCODE_09F743
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BNE.b CODE_0DD912
	LDA.w #$00CD
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0DD912
	LDA.b $10
	AND.w #$0002
	STA.w $7400,y
	TAX
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w DATA_0DD8CF,x
	STA.w $70E2,y
	LDA.w #$0770
	STA.w $7182,y
	LDX.b $12
	LDA.w #$0100
	STA.w $7A98,x
CODE_0DD912:
	RTS

CODE_0DD913:
	TYX
	JSR.w CODE_0DDEAA
	JSR.w CODE_0DD8D3
	LDA.w #$0006
	STA.w $7402,x
	LDA.b $14
	AND.w #$0008
	BEQ.b CODE_0DD937
	LDX.b #$1C
CODE_0DD929:
	LDA.l DATA_5FF538,x
	STA.l YI_Global_PaletteMirror[$01].LowByte,x
	DEX
	DEX
	BPL.b CODE_0DD929
	LDX.b $12
CODE_0DD937:
	LDY.w $1076
	LDA.w $7AF8,x
	BEQ.b CODE_0DD97F
	CPY.b #$07
	BEQ.b CODE_0DD97E
	LDA.w $1068
	CLC
	ADC.w #$0004
	STA.w $1068
	LDA.w $106A
	CLC
	ADC.w $72C2,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BMI.b CODE_0DD97B
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	LDA.w #$0008
	STA.w $61C6
	LDA.w #$F800
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0100
	STA.w $7542,x
	LDA.w #$0800
	STA.w $75E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_0DD97B:
	STA.w $106A
CODE_0DD97E:
	RTS

CODE_0DD97F:
	CPY.b #$07
	BEQ.b CODE_0DD98F
	CPY.b #$03
	BNE.b CODE_0DD98A
	JMP.w CODE_0DD6D3

CODE_0DD98A:
	DEC.b $76,x
	DEC.b $76,x
	RTS

CODE_0DD98F:
	JSR.w CODE_0DFC04
	JSL.l CODE_02A982
	LDA.w #$001F
	STA.b $76,x
	LDA.w #$0200
	STA.w $7A96,x
	LDA.w !RAM_YI_Global_HDMAEnable
	EOR.w #$001E
	STA.w !RAM_YI_Global_HDMAEnable
	STZ.w $0948
	LDA.w #$0013
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0DD9F6
	LDA.w #$0200
	SBC.w !RAM_YI_Global_Layer3XPosLo
	STA.w $7680,y
	CLC
	ADC.w !RAM_YI_Global_Layer1XPosLo
	STA.w $70E2,y
	LDA.w #$0200
	SEC
	SBC.w !RAM_YI_Global_Layer3YPosLo
	STA.w $7682,y
	CLC
	ADC.w !RAM_YI_Global_Layer1YPosLo
	STA.w $7182,y
	LDA.w #$611F
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	LDA.w #$0800
	STA.w $7A38,y
	LDA.w #$FFFF
	STA.w $7A96,y
	LDA.w #!Define_YI_SoundID74_BossExplosion
	JSL.l CODE_push_sound_queue
CODE_0DD9F6:
	JSL.l CODE_02E1E1
	RTS

DATA_0DD9FB:
	db $00,$02,$03,$01,$03,$02

DATA_0DDA01:
	dw $0840,$4008,$0808

DATA_0DDA07:
	dw $0700,$0680,$0600,$0400,$0300,$0200,$0000

CODE_0DDA15:
	TYX
	JSR.w CODE_0DDEAA
	JSR.w CODE_0DD8D3
	LDA.w $7AF8,x
	BEQ.b CODE_0DDA24
	JMP.w CODE_0DDAD3

CODE_0DDA24:
	LDY.b $78,x
	INY
	CPY.b #$06
	BCC.b CODE_0DDA2D
	LDY.b #$00
CODE_0DDA2D:
	TYA
	STA.b $78,x
	LDA.w $1076
	ASL
	TAX
	LDA.w $1068
	SEC
	SBC.w DATA_0DDA07,x
	ASL
	LDX.w DATA_0DDA01,y
	TXA
	BCS.b CODE_0DDA76
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b $12
	LDA.w #$0002
	STA.w $7AF6,x
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	SEC
	SBC.w #$0010
	BPL.b CODE_0DDA5D
	LDA.w #$0000
CODE_0DDA5D:
	STA.w $7A38,x
	PHY
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLY
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CMP.w #$0004
	BCS.b CODE_0DDA76
	LDA.w #$0004
CODE_0DDA76:
	LDX.b $12
	STA.w $7AF8,x
	LDA.w DATA_0DD9FB,y
	AND.w #$00FF
	STA.w $7402,x
	LSR
	BNE.b CODE_0DDAD3
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	LDA.w #$0020
	STA.w $61C6
	LDA.w $1068
	STA.b $00
	SEC
	SBC.w #$0020
	STA.w $1068
	CMP.w #$0100
	BPL.b CODE_0DDAB9
	CMP.w #$00E0
	BMI.b CODE_0DDAD3
	LDA.w #!Define_YI_SoundID81_BigBooPop
	JSL.l CODE_push_sound_queue
	LDA.w #$0200
	STA.w $61C8
	BRA.b CODE_0DDAD3

CODE_0DDAB9:
	CMP.w #$0180
	BMI.b CODE_0DDAD3
	LDA.w $7AF6,x
	BNE.b CODE_0DDAD3
	INC.b $76,x
	LDA.w #$000D
	STA.b $78,x
	LDA.w #$0030
	STA.w $7A36,x
	STZ.w $7A98,x
CODE_0DDAD3:
	LDA.w $1068
	CMP.w #$0100
	BPL.b CODE_0DDB29
	JSL.l CODE_03A858
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CPY.b #$60
	BCS.b CODE_0DDB29
	TYA
	BIT.w #$0004
	BEQ.b CODE_0DDAF0
	EOR.w #$FFFF
	INC
CODE_0DDAF0:
	ASL
	CLC
	ADC.w #$02C0
	STA.w $0091
	TYA
	AND.w #$0003
	ASL
	ASL
	ASL
	ASL
	ADC.w #$07C0
	STA.w $0093
	LDA.w #$0001
	STA.w $008F
	LDA.w #$0000
	STA.w $0095
	JSL.l CODE_change_map16
	JSL.l CODE_0DA485
	DEC.w !RAM_YI_Global_SoundQueueSizeLo
	LDA.w #!Define_YI_SoundID83_LungeFish
	JSL.l CODE_push_sound_queue
	LDX.b $12
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_0DDB29:
	RTS

DATA_0DDB2A:
	dw DATA_0DDC0A,$0000,DATA_0DDC0A,$0002,DATA_0DDB62,$0000,DATA_0DDB62,$0002
	dw DATA_0DDCB2,$0000,DATA_0DDD5A,$0000,DATA_0DDE02,$0000

DATA_0DDB46:
	dw $0010,$0010,$0000,$0000,$0000,$0000,$0000

DATA_0DDB54:
	dw $0010,$FFF0,$0000,$0000,$0000,$0000,$0000

DATA_0DDB62:
	dw $FFFF,$FFFF,$FFFF,$EEED,$FFEF,$FFFF,$FFFF,$FFFF
	dw $FFFF,$FFFF,$FEFD,$FFFF,$FFFF,$FFFF,$FFFF,$01FF
	dw $0C02,$0E0D,$FF0F,$0504,$FFFF,$FFFF,$11FF,$1C12
	dw $1E1D,$131F,$1514,$FFFF,$FFFF,$21FF,$2C28,$2E2D
	dw $292F,$2524,$FFFF,$FFFF,$3130,$3C38,$3E3D,$393F
	dw $353A,$FF25,$FFFF,$4140,$4C42,$4E4D,$434F,$4544
	dw $FFFF,$FFFF,$5150,$5C52,$5E5D,$535F,$5554,$FFFF
	dw $00FF,$6160,$0362,$0303,$6303,$6564,$FF82,$10FF
	dw $7170,$0372,$0303,$7303,$7574,$FF92,$20FF,$8180
	dw $0303,$0303,$0303,$8584,$FFA2,$FFFF,$9190,$0303
	dw $0303,$0303,$9594,$FFFF

DATA_0DDC0A:
	dw $FFFF,$FFFF,$FFFF,$EBEA,$FFEC,$FFFF,$FFFF,$FFFF
	dw $FFFF,$FFFF,$FBFA,$FFFC,$FFFF,$FFFF,$FFFF,$07FF
	dw $0C08,$0E0D,$FF0F,$0B0A,$FFFF,$FFFF,$17FF,$1C18
	dw $1E1D,$191F,$1B1A,$FFFF,$FFFF,$27FF,$2C28,$2E2D
	dw $292F,$2B2A,$FFFF,$FFFF,$3736,$3C38,$3E3D,$393F
	dw $3B3A,$FF99,$FFFF,$4746,$4C48,$4E4D,$494F,$4B4A
	dw $FFA9,$06FF,$5756,$5C58,$5E5D,$595F,$5B5A,$FFFF
	dw $16FF,$6766,$0368,$0303,$6903,$6B6A,$FFFF,$26FF
	dw $7776,$0378,$0303,$7903,$7B7A,$FF88,$FFFF,$8786
	dw $0303,$0303,$8903,$8B8A,$FF98,$FFFF,$9190,$0303
	dw $0303,$0303,$9B9A,$FFFF

DATA_0DDCB2:
	dw $FFFF,$FFFF,$FFFF,$FFFF,$FFFF,$FFFF,$FFFF,$FFFF
	dw $FFFF,$FFFF,$B0A0,$FFEF,$FFFF,$FFFF,$FFFF,$01FF
	dw $0C02,$0E0D,$FF0F,$0504,$FFFF,$FFFF,$11FF,$8312
	dw $2E2D,$1334,$1514,$FFFF,$FFFF,$21FF,$3C28,$3E3D
	dw $293F,$2524,$FFFF,$FFFF,$3130,$9338,$4E4D,$39AB
	dw $353A,$FF25,$FFFF,$4140,$A342,$CECD,$43BB,$4544
	dw $FFFF,$A4FF,$2322,$DC52,$DEDD,$53DF,$A6A5,$FFA7
	dw $B4FF,$3332,$0303,$0303,$0303,$B6B5,$FFB7,$C4FF
	dw $9796,$0303,$0303,$0303,$C6C5,$FFC7,$FFFF,$8786
	dw $0303,$0303,$0303,$F6F5,$FFFF,$FFFF,$9190,$0303
	dw $0303,$0303,$9594,$FFFF

DATA_0DDD5A:
	dw $FFFF,$FFFF,$FFFF,$FFFF,$FFFF,$FFFF,$FFFF,$FFFF
	dw $FFFF,$6CFF,$6E6D,$FF6F,$FFFF,$FFFF,$FFFF,$01FF
	dw $7C02,$7E7D,$FF7F,$0504,$FFFF,$FFFF,$11FF,$8C9D
	dw $8E8D,$9E8F,$1514,$FFFF,$FFFF,$21FF,$9CAD,$0909
	dw $AE9F,$2524,$FFFF,$FFFF,$3130,$ACBD,$0909,$BEAF
	dw $353A,$FF25,$FFFF,$4140,$BC42,$0909,$43BF,$4544
	dw $FFFF,$A4FF,$2322,$CC52,$CECD,$53CF,$A6A5,$FFA7
	dw $B4FF,$3332,$DC03,$DEDD,$03DF,$B6B5,$FFB7,$C4FF
	dw $9796,$0303,$0303,$0303,$C6C5,$FFC7,$FFFF,$8786
	dw $0303,$0303,$0303,$F6F5,$FFFF,$FFFF,$9190,$0303
	dw $0303,$0303,$9594,$FFFF

DATA_0DDE02:
	dw $FFFF,$FFFF,$FFFF,$FFFF,$FFFF,$FFFF,$FFFF,$FFFF
	dw $FFFF,$6CFF,$6E6D,$FF6F,$FFFF,$FFFF,$A1FF,$01FF
	dw $7C02,$7E7D,$FF7F,$05A8,$FFAA,$B1FF,$B3B2,$8C9D
	dw $8E8D,$9E8F,$B9B8,$FFBA,$C1C0,$C3C2,$9CAD,$0909
	dw $AE9F,$C9C8,$CBCA,$D1D0,$D3D2,$ACD4,$0909,$D7AF
	dw $D9D8,$DBDA,$FFFF,$E3E2,$BCE4,$0909,$E7BF,$E9E8
	dw $FFFF,$FFFF,$F3F2,$CCF4,$CECD,$F7CF,$F9F8,$FF25
	dw $FFFF,$E1E0,$DC03,$DEDD,$03DF,$D6D5,$FFFF,$FFFF
	dw $F1F0,$0303,$0303,$0303,$E6E5,$FFFF,$FFFF,$8786
	dw $0303,$0303,$0303,$F6F5,$FFFF,$FFFF,$9190,$0303
	dw $0303,$0303,$9594,$FFFF

CODE_0DDEAA:
	LDA.w $7402,x
	ASL
	ASL
	TAY
	REP.b #$10
	LDA.w DATA_0DDB2A+$02,y
	STA.w $7400,x
	LDA.w DATA_0DDB2A,y
	STA.b $00
	LDA.w #$1D39
	STA.b $02
	LDA.w #DATA_0DDC0A>>16
	STA.w $0001
	LDA.w #$000C
	STA.b $04
CODE_0DDECD:
	LDX.b $00
	TXA
	CLC
	ADC.w #$000E
	STA.b $00
	LDY.b $02
	TYA
	CLC
	ADC.w #$0080
	STA.b $02
	LDA.w #$000E
	JSL.l CODE_00BF16
	DEC.b $04
	BNE.b CODE_0DDECD
	SEP.b #$10
	LDX.b $12
	LDA.w $1068
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7402,x
	ASL
	TAY
	LDA.w $106A
	CLC
	ADC.w DATA_0DDB46,y
	CLC
	ADC.w $0CB0
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $106C
	CLC
	ADC.w DATA_0DDB54,y
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7400,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LSR
	STA.w !RAM_YI_Global_Mode7TilemapSettings
	LDX.b #FXCODE_09F6B0>>16
	LDA.w #FXCODE_09F6B0
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $6098
	STA.w !RAM_YI_Global_Layer3XPosLo
	LDA.w $60A0
	STA.w !RAM_YI_Global_Layer3YPosLo
	LDA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	STA.w !RAM_YI_Global_Mode7MatrixParameterALo
	STZ.w !RAM_YI_Global_Mode7MatrixParameterBLo
	STZ.w !RAM_YI_Global_Mode7MatrixParameterCLo
	STA.w !RAM_YI_Global_Mode7MatrixParameterDLo
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	ASL
	SEC
	SBC.w #$0048
	BPL.b CODE_0DDF4C
	LDA.w #$0000
CODE_0DDF4C:
	CMP.w #$0100
	BMI.b CODE_0DDF54
	LDA.w #$0100
CODE_0DDF54:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #DATA_5FF4FA
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_5FF4FA>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0001
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08E167>>16
	LDA.w #FXCODE_08E167
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $1074
	BEQ.b CODE_0DDFA4
	LDY.b $76,x
	CPY.b #$1E
	BCS.b CODE_0DDFA4
	INC.w $1076
	LDA.w #$0080
	STA.w $7A38,x
	LDA.w #!Define_YI_SoundID92_BowserHurt
	JSL.l CODE_push_sound_queue
	LDA.w #$001E
	STA.b $76,x
	LDA.w #$0080
	STA.w $7AF8,x
	PLA
	STZ.w $1074
CODE_0DDFA4:
	RTS

DATA_0DDFA5:
	dw $F5FA,$0C05,$0A00,$2D0D,$000C,$0DFC,$0C2C,$0600
	dw $360D,$000C,$0502,$0C26,$FA00,$05F5,$020C,$FDF2
	dw $0C14,$0602,$04F7,$000C,$0E00,$8C0A,$0800,$0B06
	dw $028C,$FE00,$8C1A,$FA02,$22F5,$000C,$0D0A,$0C2D
	dw $FC00,$2C0D,$000C,$0D06,$0C36,$0200,$2605,$000C
	dw $F5FA,$0C22,$F202,$14FD,$020C,$F706,$0C04,$0000
	dw $0A0E,$008C,$0608,$8C0B,$0002,$1AFE,$028C,$F8F2
	dw $0C37,$FA00,$6800,$020C,$F802,$0C39,$F200,$37F8
	dw $020C,$0D0A,$0C2D,$FC00,$2C0D,$000C,$0D06,$0C36
	dw $0700,$07F9,$000C,$0E00,$8C0A,$0800,$0B06,$028C
	dw $FE00,$8C1A,$F302,$37F7,$000C,$FFFB,$0C48,$0302
	dw $39F7,$000C,$F7F3,$0C37,$0A02,$2D0D,$000C,$0DFC
	dw $0C2C,$0600,$360D,$000C,$FA08,$0C07,$0000,$0A0E
	dw $008C,$0608,$8C0B,$0002,$1AFE,$028C,$F3F4,$0C45
	dw $0400,$57FA,$000C,$F3F4,$0C45,$FB02,$66FE,$020C
	dw $0D0A,$0C2D,$FC00,$2C0D,$000C,$0D06,$0C36,$0B00
	dw $07FB,$000C,$0E00,$8C0A,$0800,$0B06,$028C,$FE00
	dw $8C1A,$F502,$45F1,$000C,$F1F5,$0C45,$0502,$57F8
	dw $000C,$FDFC,$0C66,$0A02,$2D0D,$000C,$0DFC,$0C2C
	dw $0700,$360D,$000C,$F90D,$0C07,$0100,$0A0E,$008C
	dw $0609,$8C0B,$0102,$1AFE,$028C,$EEF7,$0C45,$0700
	dw $57F6,$000C,$FEFF,$0C66,$F702,$45EE,$020C,$0D0A
	dw $0C2D,$FC00,$2C0D,$000C,$0D07,$0C36,$0F00,$07F8
	dw $000C,$0E01,$8C0A,$0900,$0B06,$028C,$FE02,$8C1A
	dw $F702,$45EE,$000C,$EEF7,$0C45,$0702,$57F6,$000C
	dw $FDFF,$0C66,$0A02,$2D0D,$000C,$0DFC,$0C2C,$0700
	dw $360D,$000C,$F70F,$0C04,$0100,$0A0E,$008C,$0609
	dw $8C0B,$0202,$1AFE,$028C,$F9F9,$0C05,$0100,$2609
	dw $000C,$F9F9,$0C05,$F102,$1401,$020C,$0D0B,$0C2D
	dw $FB00,$2C0D,$000C,$0D05,$0C36,$0400,$04FA,$000C
	dw $0F00,$8C0A,$0800,$0B07,$028C,$FF00,$8C1A,$0B02
	dw $3406,$008C,$FF03,$0C26,$FB00,$05EF,$020C,$F7F3
	dw $0C14,$0802,$07F2,$000C,$0A00,$8C0A,$0800,$0B02
	dw $028C,$FA00,$8C1A,$0A02,$2D0E,$008C,$0E01,$8C2C
	dw $FC00,$3606,$000C,$070C,$0C35,$0B00,$2D0F,$000C
	dw $0FFE,$0C2C,$0100,$0A0E,$008C,$0603,$0C26,$F300
	dw $14FE,$020C,$F6FB,$0C05,$0702,$04F8,$000C,$0609
	dw $8C0B,$0102,$1AFE,$028C,$08FA,$4C35,$0200,$2606
	dw $000C,$F6FA,$0C05,$F202,$14FE,$020C,$090A,$4C36
	dw $0600,$04F8,$000C,$0C0E,$4C3C,$0000,$0A0E,$008C
	dw $0608,$8C0B,$0002,$1AFE,$028C,$0CFD,$0C3C,$FA00
	dw $3609,$000C,$0402,$0C26,$FA00,$05F4,$020C,$FCF2
	dw $0C14,$0902,$360A,$004C,$F606,$0C04,$0D00,$3C0C
	dw $004C,$0D00,$8C0A,$0800,$0B05,$028C,$FD00,$8C1A
	dw $FE02,$3C0C,$000C,$0AFD,$0C36,$0200,$2604,$000C
	dw $F4FA,$0C22,$F202,$14FC,$020C,$0A09,$4C36,$0600
	dw $04F6,$000C,$0C0D,$4C3C,$0000,$0A0D,$008C,$0508
	dw $8C0B,$0002,$1AFD,$028C,$0CFE,$0C3C,$FD00,$360A
	dw $000C,$0908,$0C36,$0E00,$2D0E,$004C,$0702,$0C29
	dw $FA00,$08F7,$020C,$FFF2,$0C17,$FD02,$54F4,$000C
	dw $0E02,$0C2C,$0A00,$0B03,$028C,$FB02,$8C1A,$FD02
	dw $3609,$000C,$0B02,$8C0A,$0900,$6C18,$00CC,$FE06
	dw $8C2F,$FE00,$2EFE,$008C,$0509,$0C34,$F100,$0710
	dw $004C,$0EF8,$0C6A,$0102,$6C10,$02CC,$0E06,$8C0F
	dw $FE00,$1EFE,$028C,$06F6,$8C0D,$0C02,$2D05,$008C
	dw $1809,$0C7B,$FF00,$041D,$00CC,$0604,$8C36,$0500
	dw $5F10,$000C,$00FD,$0C3E,$F502,$4D08,$020C,$1DFF
	dw $CC04,$0100,$6A10,$020C,$0D09,$CC6C,$0802,$2D02
	dw $000C,$02FF,$0C2C,$FF00,$2E17,$000C,$1F0B,$8C54
	dw $0300,$340A,$004C,$0504,$0C2D,$0B00,$541F,$008C
	dw $05FB,$0C2C,$0700,$0F07,$000C,$0FFF,$0C1E,$F702
	dw $0D07,$020C,$0F08,$0C6E,$0B02,$6C06,$024C,$1A07
	dw $8C3B,$0600,$6CFC,$000C,$0F03,$CC35,$FA00,$2C0B
	dw $000C,$0B03,$0C2D,$FF00,$5A0A,$008C,$12FF,$8C3A
	dw $0702,$4B0A,$028C,$050A,$0C6E,$0602,$6CFC,$020C
	dw $1314,$CC54,$0600,$340A,$004C,$050A,$0C26,$FA00
	dw $14FD,$020C,$F502,$0C05,$1002,$04FF,$008C,$0602
	dw $0C0A,$FB00,$2C0E,$000C,$0E04,$0C2D,$0200,$1A0E
	dw $020C,$060A,$0C0B,$FD02,$340A,$004C,$0702,$0C29
	dw $F200,$17FF,$020C,$F7FA,$0C08,$0202,$54F5,$004C
	dw $F502,$4C54,$0C00,$2D0D,$000C,$030C,$0C3D,$FC00
	dw $2C0D,$000C,$FE01,$8C1A,$0102,$0A0E,$008C,$0609
	dw $8C0B,$0102,$290A,$000C,$02F1,$0C17,$F902,$08FA
	dw $020C,$F7FD,$0C54,$FD00,$54F7,$000C,$060C,$0C35
	dw $FB00,$2C0B,$000C,$0B0E,$0C2D,$0100,$1AFE,$028C
	dw $0E01,$8C0A,$0900,$0B06,$028C,$0903,$0C29,$FB00
	dw $08F9,$020C,$01F3,$0C17,$0E02,$3504,$000C,$F906
	dw $0C04,$0D00,$3C0C,$004C,$0A02,$0C5A,$0A00,$4B02
	dw $020C,$FA02,$0C3A,$0002,$360C,$000C,$0211,$CC2C
	dw $0C00,$3408,$008C,$0BFD,$0C2C,$0600,$2600,$000C
	dw $F0FE,$0C05,$F602,$14F8,$020C,$F20A,$0C04,$0D00
	dw $3C0C,$004C,$0C02,$8C0A,$0A00,$0B04,$028C,$FC02
	dw $8C1A,$FB02,$3503,$004C,$EE05,$0C05,$0600,$3506
	dw $00CC,$04FD,$0C2D,$0D00,$26FE,$000C,$EE05,$0C05
	dw $FD02,$14F6,$020C,$F413,$0C07,$0D00,$3C0C,$004C
	dw $0C04,$8C0A,$0C00,$0B04,$028C,$FC04,$8C1A,$0402
	dw $05EE,$000C,$0607,$CC35,$FD00,$2D05,$000C,$FE0C
	dw $0C26,$0400,$05EE,$020C,$F6FC,$0C14,$1202,$07F4
	dw $000C,$0C0D,$4C3C,$0300,$0A0C,$008C,$040B,$8C0B
	dw $0302,$1AFC,$028C,$04F0,$0C24,$F800,$02F4,$020C
	dw $FCF8,$0C30,$0A02,$3409,$008C,$FCF0,$0C14,$0300
	dw $04F4,$000C,$0C0D,$4C3C,$FF00,$0A0D,$008C,$0507
	dw $8C0B,$FF02,$1AFD,$028C,$0CFE,$0C3C,$F100,$2406
	dw $000C,$F6F9,$0C02,$F902,$30FE,$020C,$070A,$0C35
	dw $F100,$14FE,$000C,$F604,$0C04,$0E00,$3C0C,$004C
	dw $0EFF,$8C0A,$0700,$0B06,$028C,$FEFF,$8C1A,$FC02
	dw $3C0C,$000C,$0402,$0C26,$FA00,$02F4,$020C,$FCF2
	dw $0C14,$F802,$4409,$000C,$0A09,$4C36,$0600,$04F6
	dw $000C,$0C0D,$4C3C,$0000,$0A0D,$008C,$0508,$8C0B
	dw $0002,$1AFD,$028C,$0CFE,$0C3C,$0200,$2604,$000C
	dw $F4FA,$0C22,$F202,$14FC,$020C,$09F8,$0C44,$0900
	dw $360A,$004C,$F606,$0C04,$0D00,$3C0C,$004C,$0D00
	dw $8C0A,$0800,$0B05,$028C,$FD00,$8C1A,$FE02,$3C0C
	dw $000C,$F1F9,$0C02,$FA02,$68FF,$020C,$F7F2,$0C37
	dw $F802,$4407,$000C,$0A09,$4C36,$0700,$07F8,$000C
	dw $0C0D,$4C3C,$0000,$0A0D,$008C,$0508,$8C0B,$0002
	dw $1AFD,$028C,$0CFE,$0C3C,$FA00,$02F0,$020C,$F6F3
	dw $0C37,$FB02,$48FE,$020C,$07F8,$0C44,$0900,$3609
	dw $004C,$F909,$0C07,$0D00,$3C0C,$004C,$0D00,$8C0A
	dw $0800,$0B05,$028C,$FD00,$8C1A,$FE02,$3C0C,$000C
	dw $02F3,$0C24,$FB00,$42FA,$020C,$0D0A,$0C2D,$0300
	dw $3D0A,$00CC,$F2FB,$0C05,$F302,$14FA,$000C,$0E00
	dw $8C0A,$0800,$0B06,$028C,$FE00,$8C1A,$0802,$04F5
	dw $000C,$0AFB,$CC3D,$0300,$3D0B,$00CC,$FEF9,$0C42
	dw $F102,$2406,$000C,$0A0B,$0C2D,$F900,$05F6,$020C
	dw $FEF1,$0C14,$FF00,$0A10,$008C,$0807,$8C0B,$FF02
	dw $1A00,$028C,$F805,$0C04,$FA00,$3D0B,$00CC,$FEF5
	dw $0C24,$FD00,$02EE,$020C,$F6FD,$0C30,$F502,$14F6
	dw $000C,$0D09,$0C2D,$0300,$3D0C,$00CC,$0E00,$8C0A
	dw $0800,$0B06,$028C,$FE00,$8C1A,$FE02,$3D0C,$00CC
	dw $F009,$0C04,$F500,$24FE,$000C,$EEFD,$0C22,$FD02
	dw $30F6,$020C,$F6F5,$0C14,$0900,$2D0D,$000C,$0C03
	dw $CC3D,$0000,$0A0E,$008C,$0608,$8C0B,$0002,$1AFE
	dw $028C,$0CFE,$CC3D,$0900,$04F0,$000C,$F7FA,$0C6C
	dw $FF02,$25FF,$000C,$FE07,$0C41,$FF00,$02EE,$020C
	dw $0D09,$0C2D,$0300,$3D0C,$00CC,$0E00,$8C0A,$0800
	dw $0B06,$028C,$FE00,$8C1A,$FE02,$3D0C,$00CC,$F008
	dw $0C07,$1100,$24FE,$004C,$F611,$4C14,$0100,$02EE
	dw $024C,$F601,$4C30,$0902,$2D0D,$000C,$0C03,$CC3D
	dw $0000,$0A0E,$008C,$0608,$8C0B,$0002,$1AFE,$028C
	dw $0CFE,$CC3D,$FD00,$04F0,$004C,$0A07,$0C2D,$0200
	dw $3D04,$004C,$FCFD,$0C68,$F502,$47FC,$000C,$F4F5
	dw $0C37,$FD00,$00F4,$024C,$0AFA,$0C2C,$0000,$0A0E
	dw $008C,$0608,$8C0B,$0002,$1AFE,$028C,$EF03,$0C54
	dw $FC00,$10F2,$000C,$080B,$0C2D,$FA00,$2C08,$000C
	dw $0206,$CC36,$0400,$3102,$008C,$F2FC,$0C10,$F402
	dw $17FA,$020C,$0D00,$8C0A,$0800,$0B05,$028C,$FD00
	dw $8C1A,$0302,$54F1,$004C,$FEFC,$0C10,$F402,$1706
	dw $020C,$0E04,$8C31,$FF00,$54FC,$000C,$040E,$8C3D
	dw $0A00,$5F05,$000C,$F502,$0C3E,$FA02,$4DFD,$020C
	dw $FBF8,$4C3D,$0C00,$2DF7,$000C,$F400,$0C2C,$1000
	dw $3D06,$008C,$FDFC,$0C10,$F402,$1705,$020C,$0D04
	dw $8C31,$0000,$54FB,$004C,$0A0C,$8C0F,$0400,$1EFA
	dw $028C,$F808,$4C2C,$1200,$2DFE,$000C,$FBFD,$4C3D
	dw $FC00,$0D02,$028C,$FCFC,$0C10,$F402,$1704,$020C
	dw $0C04,$8C31,$0100,$54FA,$004C,$FA01,$4C54,$0F00
	dw $3D0C,$008C,$0D03,$0C5A,$0300,$3AFD,$020C,$050B
	dw $0C4B,$0E02,$2C00,$00CC,$0717,$8C2D,$0B00,$3BFC
	dw $000C,$FDFC,$0C10,$F402,$1705,$020C,$0D04,$8C31
	dw $0200,$54FC,$004C,$FC02,$4C54,$0F00,$3D0B,$008C
	dw $0C03,$0C5A,$0300,$3AFC,$020C,$040B,$0C4B,$1602
	dw $2D0C,$008C,$FDFC,$0C08,$F402,$1705,$020C,$0D04
	dw $0C29,$0200,$54FC,$004C,$FA02,$0C3A,$0A00,$360A
	dw $004C,$FA02,$0C3A,$0A02,$4B02,$020C,$0C12,$CC2D
	dw $0A00,$2C0C,$008C,$0A02,$0C5A,$FB00,$08FD,$020C
	dw $05F3,$0C17,$0302,$290D,$000C,$FC01,$4C54,$0000
	dw $3AF8,$000C,$0808,$4C36,$0000,$3AF8,$020C,$0008
	dw $0C4B,$0F02,$2D0C,$00CC,$0C06,$8C2C,$0000,$5A08
	dw $000C,$FAF8,$0C10,$0000,$290A,$000C,$FAF8,$0C10
	dw $F002,$1702,$020C,$0D0C,$0C2D,$FA00,$2C0D,$000C
	dw $0D05,$0C36,$0300,$04FB,$000C,$0F00,$8C0A,$0800
	dw $0B07,$028C,$FF00,$8C1A,$0C02,$3608,$004C,$02FA
	dw $4C04,$FA00,$7008,$008C,$10FA,$8C50,$0202,$6108
	dw $028C,$FA03,$8C2E,$0B00,$0F0A,$008C,$FA03,$8C1E
	dw $FB02,$0D02,$028C,$040F,$8C2D,$0F00,$2D04,$008C

DATA_0DE9F5:
	dw $FE00,$0200

;---------------------------------------------------------------------------
; Sprite $134 RideYoshi handler -- the cinematic where Baby Bowser is briefly
; mounted on Yoshi during the fight intro. No Raiden equivalent.
;---------------------------------------------------------------------------
YI_NorSpr134_BabyBowser_RideYoshiRt:
ride_yoshi_baby_bowser:
;$0DE9F9
	LDA.w $60A8
	BEQ.b CODE_0DEA21
	STZ.w $1060
	CLC
	ADC.w #$0200
	CMP.w #$0400
	BCC.b CODE_0DEA44
	LDA.w $7A98,x
	BNE.b CODE_0DEA4A
	LDA.w #$0008
	STA.w $7A98,x
	INC.w $7402,x
	LDY.w $7402,x
	CPY.b #$21
	BEQ.b CODE_0DEA4A
	BRA.b CODE_0DEA44

CODE_0DEA21:
	LDA.w $60C2
	BNE.b CODE_0DEA2B
	LDA.w $0035
	BNE.b CODE_0DEA44
CODE_0DEA2B:
	LDY.w $1060
	INY
	INY
	STY.w $1060
	BPL.b CODE_0DEA3A
	LDY.b #$7F
	STY.w $1060
CODE_0DEA3A:
	CPY.b #$20
	BCC.b CODE_0DEA44
	TXY
	JSR.w CODE_0DCF8F
	BRA.b CODE_0DEA5F

CODE_0DEA44:
	LDA.w #$0020
	STA.w $7402,x
CODE_0DEA4A:
	LDA.w #$003F
	STA.w $7A36,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0047
	STA.w $7A38,x
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_0DEA5F:
	LDA.w $0035
	AND.w #$0300
	CMP.w $0D98
	BEQ.b CODE_0DEA8F
	STA.w $0D98
	CMP.w #$0000
	BEQ.b CODE_0DEA8F
	LDY.b $18,x
	BEQ.b CODE_0DEA83
	LDA.w $7A96,x
	BEQ.b CODE_0DEA83
	CPY.b #$04
	BPL.b CODE_0DEAA8
	INC.b $18,x
	BRA.b CODE_0DEA87

CODE_0DEA83:
	LDY.b #$01
	STY.b $18,x
CODE_0DEA87:
	LDA.w #$0040
	STA.w $7A96,x
	BRA.b CODE_0DEA96

CODE_0DEA8F:
	LDA.w $7A96,x
	BNE.b CODE_0DEA96
	STZ.b $18,x
CODE_0DEA96:
	LDA.w $60D4
	BEQ.b CODE_0DEAA3
	LDA.w $60FC
	AND.w #$0007
	BNE.b CODE_0DEAA8
CODE_0DEAA3:
	LDA.w $61B2
	BPL.b CODE_0DEAD2
CODE_0DEAA8:
	STZ.b $18,x
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.w $0390
	LDY.w $60C4
	LDA.w DATA_0DE9F5,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $75E0,x
	JSR.w CODE_0DC7B3
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7AF8,x
	ASL
	STA.w $7542,x
CODE_0DEAD2:
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $08E: Kamek as he appears in the Baby Bowser room (the one who casts
; the giant transformation). Raiden: init_bowser_room_kamek.
;---------------------------------------------------------------------------
YI_NorSpr08E_BowserRoomKamek_Init:
init_bowser_room_kamek:
;$0DEAD3
	LDA.w #$0080
	STA.w $7E1A
	LDA.w #$0134
	JSL.l CODE_spawn_sprite_active
	STY.w $105E
	STZ.w $105C
	LDA.w !RAM_YI_Level_BabyBowerHasBeenVisitedBeforeFlagLo
	BEQ.b CODE_0DEB33
	LDA.w #$0100
	STA.w $70E2,y
	LDA.w #$07B0
	STA.w $7182,y
	LDA.w #$000C
	STA.w $7402,y
	LDA.w #$0013
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDX.b #$1C
CODE_0DEB05:
	LDA.l DATA_5FEA3C,x
	STA.l $702F2E,x
	STA.l YI_Global_PaletteMirror[$E1].LowByte,x
	LDA.l DATA_5FEA00,x
	STA.l $702E2E,x
	STA.l YI_Global_PaletteMirror[$61].LowByte,x
	LDA.l DATA_5FEA1E,x
	STA.l $702E4E,x
	STA.l YI_Global_PaletteMirror[$71].LowByte,x
	DEX
	DEX
	BPL.b CODE_0DEB05
	LDX.b $12
	JML.l CODE_03A31E

CODE_0DEB33:
	INC.w !RAM_YI_Level_BabyBowerHasBeenVisitedBeforeFlagLo
	LDA.w #$0150
	STA.w $70E2,y
	LDA.w #$077D
	STA.w $7182,y
	LDA.w #$000A
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.w #$0012
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	JSL.l CODE_029507
	BRA.b CODE_0DEB58

ADDR_0DEB54:
	JML.l CODE_03A31E

CODE_0DEB58:
	INC.w $7402,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; DATA_bowser_room_kamek_state_ptrs -- Bowser-room Kamek per-sub-state pointer table.
; Indexed by $76,x (Kamek's animation/AI phase). 10 entries drive the
; "cinematic intro" -> "throw Bowser" -> "watch fight" sequence in the
; Baby Bowser arena.
;-------------------------------------------------------------------------
DATA_bowser_room_kamek_state_ptrs:
DATA_0DEB5C:
	dw CODE_0DEBAA
	dw CODE_0DEBE7
	dw CODE_0DEC74
	dw CODE_0DECE2
	dw CODE_0DED47
	dw CODE_0DEDAC
	dw CODE_0DEE00
	dw CODE_0DEEAB
	dw CODE_0DEEEC
	dw CODE_0DEFF1

;---------------------------------------------------------------------------
; Sprite $08E main. Raiden: main_bower_room_kamek (sic).
;---------------------------------------------------------------------------
YI_NorSpr08E_BowserRoomKamek_Main:
main_bowser_room_kamek:
;$0DEB70
	LDY.w $7402,x
	BNE.b CODE_0DEB8E
	JSL.l CODE_03AA52
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0020
	TAY
	LDA.w #$8000
	STA.w $6000,y
	STA.w $6008,y
	SEP.b #$10
CODE_0DEB8E:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_0DEBA1
	JSL.l CODE_03B697
	JSL.l CODE_03B716
CODE_0DEBA1:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_bowser_room_kamek_state_ptrs,x)
	RTL

CODE_0DEBAA:
	TYX
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CMP.w #$0060
	BMI.b CODE_0DEBE6
	LDA.w #!Define_YI_PlayerState02_InCutscene
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$0100
	STA.w $617A
	LDA.w #!Define_YI_MusicID_FadeMusicCommand
	STA.w !RAM_YI_Global_PlayMusicLo
	LDA.w $7C16,x
	CMP.w #$0068
	BPL.b CODE_0DEBD8
	STZ.w $617A
	LDA.w $60A8
	BNE.b CODE_0DEBE6
	INC.b $76,x
	RTS

CODE_0DEBD8:
	LDA.w #$0100
	CMP.w $60A8
	BPL.b CODE_0DEBE6
	STA.w $60A8
	STA.w $60B4
CODE_0DEBE6:
	RTS

CODE_0DEBE7:
	TYX
	STY.w $0C1E
	LDA.w $60B0
	CMP.w #$0020
	BPL.b CODE_0DEC1A
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr08E_BowserRoomKamek
	BEQ.b CODE_0DEC0A
	LDA.w #$0114
	STA.b $18,x
	LDA.w #$000C
	STA.b $78,x
	LDA.w #$0114
	BRA.b CODE_0DEC0D

CODE_0DEC0A:
	LDA.w #$0111
CODE_0DEC0D:
	STA.l $704070
	INC.w $0071
	INC.w !RAM_YI_Level_MessageBoxState 
	INC.b $76,x
	RTS

CODE_0DEC1A:
	INC.w !RAM_YI_Global_Layer1XPosLo
	LDA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $0C23
	RTS

DATA_0DEC24:
	db $08,$05,$08,$07,$08,$05,$08,$07,$08,$05,$08,$07,$09,$0A,$09,$07
	db $09,$0A,$09,$07,$09,$0A,$09,$07,$09,$0A,$09,$07,$09,$0A,$09,$07
	db $09,$0A,$09,$07,$09,$0A,$09,$07

DATA_0DEC4C:
	db $02,$06,$02,$06,$02,$06,$02,$06,$02,$06,$02,$20,$02,$06,$02,$06
	db $02,$06,$02,$06,$02,$06,$02,$06,$02,$06,$02,$06,$02,$06,$02,$06
	db $02,$06,$02,$06,$02,$06,$02,$01

CODE_0DEC74:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0DECE1
	LDY.b $16,x
	CPY.b #$28
	BMI.b CODE_0DECBF
	STZ.w $0071
	PHB
	REP.b #$10
	LDX.w #$702D6C
	LDY.w #$702F6C
	LDA.w #$01FF
	MVN $702F6C>>16,$702D6C>>16
	SEP.b #$10
	PLB
	LDX.b #$1C
CODE_0DEC97:
	LDA.l DATA_5FEA00,x
	STA.l $70302E,x
	LDA.l DATA_5FEA1E,x
	STA.l $70304E,x
	LDA.l DATA_5FF5B0,x
	STA.l $70312E,x
	DEX
	DEX
	BPL.b CODE_0DEC97
	LDX.b $12
	LDA.w #$0000
	STA.l $70336C
	INC.b $76,x
	RTS

CODE_0DECBF:
	INY
	STY.b $16,x
	LDA.w DATA_0DEC24-$01,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_0DEC4C-$01,y
	AND.w #$00FF
	STA.w $7A98,x
	TYA
	AND.w #$0007
	BNE.b CODE_0DECE1
	LDA.w #!Define_YI_SoundID5B_KamekTalk
	JSL.l CODE_push_sound_queue
CODE_0DECE1:
	RTS

CODE_0DECE2:
	TYX
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_0DED46
	LDA.l $70336C
	BNE.b CODE_0DECF4
	LDA.w #!Define_YI_MusicID09_BossBattle
	STA.w !RAM_YI_Global_PlayMusicLo
CODE_0DECF4:
	CMP.w #$0020
	BCS.b CODE_0DED13
	LDA.w #$2D6C
	STA.l $70336E
	LDA.w #$2F6C
	STA.l $703370
	LDX.b #FXCODE_08B4A9>>16
	LDA.w #FXCODE_08B4A9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	RTS

CODE_0DED13:
	LDY.w $105C
	BEQ.b CODE_0DED46
	LDA.w #$0040
	STA.w $7A98,x
	LDA.w #$000B
	STA.w $7402,x
	INC.b $76,x
	LDX.b #$1C
CODE_0DED28:
	LDA.l $70302E,x
	STA.l $702E2E,x
	LDA.l $70304E,x
	STA.l $702E4E,x
	LDA.l $70312E,x
	STA.l $702F2E,x
	DEX
	DEX
	BPL.b CODE_0DED28
	LDX.b $12
CODE_0DED46:
	RTS

CODE_0DED47:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0DED79
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_0DED67
	LDA.w #$0112
	STA.l $704070
	INC.w !RAM_YI_Level_MessageBoxState 
	STZ.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.w $0071
	INC.b $76,x
	RTS

CODE_0DED67:
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w #$000C
	STA.w $7402,x
CODE_0DED79:
	RTS

DATA_0DED7A:
	db $0D,$0C,$0B,$0C,$0D,$0C,$0B,$0C,$0D,$0C,$0B,$0C,$0D,$0C,$0B,$0C
	db $0D,$0C,$0B,$0C,$0D,$0C,$0B,$0C,$0D

DATA_0DED93:
	db $04,$02,$04,$02,$10,$02,$04,$02,$04,$02,$04,$02,$04,$02,$04,$02
	db $04,$02,$04,$02,$04,$02,$04,$02,$01

CODE_0DEDAC:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0DEDF7
	LDY.b $16,x
	CPY.b #$19
	BMI.b CODE_0DEDD5
	LDX.b #$1C
CODE_0DEDBA:
	LDA.l DATA_5FEA3C,x
	STA.l $70312E,x
	DEX
	DEX
	BPL.b CODE_0DEDBA
	LDX.b $12
	STZ.w $0071
	LDA.w #$0000
	STA.l $70336C
	INC.b $76,x
	RTS

CODE_0DEDD5:
	INY
	STY.b $16,x
	LDA.w DATA_0DED7A-$01,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_0DED93-$01,y
	AND.w #$00FF
	STA.w $7A98,x
	TYA
	AND.w #$0007
	BNE.b CODE_0DEDF7
	LDA.w #!Define_YI_SoundID5B_KamekTalk
	JSL.l CODE_push_sound_queue
CODE_0DEDF7:
	RTS

DATA_0DEDF8:
	dw $FF00,$FEC0,$FE40,$FE00

CODE_0DEE00:
	TYX
	LDY.w $105E
	LDA.w $7CD6,y
	SEC
	SBC.w $7CD6,x
	CMP.w #$0012
	BPL.b CODE_0DEE19
	LDA.w #$000E
	STA.w $7402,x
	INC.b $76,x
	RTS

CODE_0DEE19:
	LDA.w $7A98,x
	BNE.b CODE_0DEE2D
	LDA.w #$0002
	STA.w $7A98,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
CODE_0DEE2D:
	JSR.w CODE_0DEE80
	LDA.w $7A96,x
	BNE.b CODE_0DEE7F
	LDA.w #$0004
	STA.w $7A96,x
	LDA.b $10
	AND.w #$0006
	TAY
	LDA.w DATA_0DEDF8,y
	STA.b $00
	LDA.b $11
	AND.w #$0006
	TAY
	LDA.w DATA_0DEDF8,y
	STA.b $02
	LDA.w #!Define_YI_AmbSpr227
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	CLC
	ADC.w #$000C
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$000A
	STA.w $7142,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $02
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0010
	STA.w $7782,y
	STA.w $7500,y
CODE_0DEE7F:
	RTS

CODE_0DEE80:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	CMP.w #$007C
	BMI.b CODE_0DEEAA
	LDA.l $70336C
	CMP.w #$0020
	BPL.b CODE_0DEEAA
	LDA.w #$2D6C
	STA.l $70336E
	LDA.w #$2F6C
	STA.l $703370
	LDX.b #FXCODE_08B4A9>>16
	LDA.w #FXCODE_08B4A9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_0DEEAA:
	RTS

CODE_0DEEAB:
	TYX
	LDY.w $7D36,x
	BEQ.b CODE_0DEED4
	JSL.l CODE_03AD74
	LDA.w #$0100
	STA.w $7A36,x
	JSR.w CODE_0DEFA2
	LDA.w #$0002
	STA.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w #$0010
	STA.w $70E2,x
	STZ.w $7402,x
	INC.b $76,x
	RTS

CODE_0DEED4:
	LDA.w $7A98,x
	BNE.b CODE_0DEEE8
	LDA.w #$0002
	STA.w $7A98,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
CODE_0DEEE8:
	JSR.w CODE_0DEE80
CODE_0DEEEB:
	RTS

CODE_0DEEEC:
	TYX
	LDY.w $105C
	CPY.b #$01
	BEQ.b CODE_0DEF29
	LDY.w $105E
	LDA.w $7402,y
	CMP.w #$0018
	BNE.b CODE_0DEEEB
	LDA.w #$FD80
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0180
	STA.w $75E0,x
	LDA.w #$0010
	STA.w $7540,x
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$2000
	STA.w $6FA2,x
	STZ.b $16,x
	INC.b $76,x
	LDA.w #!Define_YI_SoundID0C_ShellHit2
	JSL.l CODE_push_sound_queue
	RTS

CODE_0DEF29:
	LDY.w $105E
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	BMI.b CODE_0DEF90
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $7182,x
	CLC
	ADC.w #$0018
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $00
	LDA.w #$000C
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w $105E
	LDA.w $7CD8,y
	SEC
	SBC.b $00
	CLC
	ADC.w $7BB8,y
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BMI.b CODE_0DEF90
	LDA.w $7A36,x
	SEC
	SBC.w #$0018
	CMP.w #$0020
	BPL.b CODE_0DEF9F
	LDA.w #$0020
	BRA.b CODE_0DEF9F

CODE_0DEF90:
	LDA.w $7A36,x
	CLC
	ADC.w #$0004
	CMP.w #$0060
	BMI.b CODE_0DEF9F
	LDA.w #$0060
CODE_0DEF9F:
	STA.w $7A36,x
CODE_0DEFA2:
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	ASL
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #(FXDATA_550000+$60C1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_550000+$60C1
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	RTS

DATA_0DEFE5:
	dw $0008,$FFFE

DATA_0DEFE9:
	dw $0060,$0020

DATA_0DEFED:
	dw $0001,$FFFF

CODE_0DEFF1:
	TYX
	JSL.l CODE_03A2C7
	BCC.b CODE_0DF000
	INC.w $105C
	PLA
	JML.l CODE_03A31E

CODE_0DF000:
	LDY.b $16,x
	LDA.w $7A36,x
	CLC
	ADC.w DATA_0DEFE5,y
	STA.w $7A36,x
	SEC
	SBC.w DATA_0DEFE9,y
	EOR.w DATA_0DEFED,y
	BMI.b CODE_0DF022
	LDA.w DATA_0DEFE9,y
	STA.w $7A36,x
	LDA.b $16,x
	EOR.w #$0002
	STA.b $16,x
CODE_0DF022:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w $75E0,x
	BNE.b CODE_0DF034
	LDA.w $75E0,x
	EOR.w #$FFFF
	INC
	STA.w $75E0,x
CODE_0DF034:
	JMP.w CODE_0DEFA2

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $128: Ground-shake-ripple visual in the Baby Bowser room.
; No standalone Raiden init label; logic flows into main_ground_shake.
;---------------------------------------------------------------------------
YI_NorSpr128_GroundRippleInBabyBowerRoom_Init:
init_ground_shake_ripple:
;$0DF037
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $128 main. Raiden: main_ground_shake.
;---------------------------------------------------------------------------
YI_NorSpr128_GroundRippleInBabyBowerRoom_Main:
main_ground_shake_ripple:
;$0DF038
	JSR.w CODE_0DF058
	JSL.l CODE_03AF23
	JSR.w CODE_0DF082
	JSR.w CODE_0DF0A3
	JSR.w CODE_0DF0B9
	JSR.w CODE_0DF182
	RTL

DATA_0DF04C:
	dw $FFE8,$0018

DATA_0DF050:
	dw $0002,$FFFE

DATA_0DF054:
	dw $0020,$FFE0

CODE_0DF058:
	LDA.b $78,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDY.w $7400,x
	LDA.w DATA_0DF04C,y
	CLC
	ADC.w $7680,x
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w DATA_0DF050,y
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w DATA_0DF054,y
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_0B96EA>>16
	LDA.w #FXCODE_0B96EA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	RTS

CODE_0DF082:
	LDA.b $76,x
	BEQ.b CODE_0DF092
	CLC
	ADC.b $78,x
	STA.b $78,x
	BPL.b CODE_0DF0A2
	PLA
	JML.l CODE_03A31E

CODE_0DF092:
	LDA.b $78,x
	CLC
	ADC.w #$00C0
	CMP.w #$0A00
	BMI.b CODE_0DF0A0
	LDA.w #$0A00
CODE_0DF0A0:
	STA.b $78,x
CODE_0DF0A2:
	RTS

CODE_0DF0A3:
	LDY.w $7D36,x
	BPL.b CODE_0DF0A2
	LDA.w $7AF8,x
	BNE.b CODE_0DF0A2
	STZ.w $60D4
	JSL.l CODE_03A858
CODE_0DF0B4:
	RTS

DATA_0DF0B5:
	dw $FE80,$0180

CODE_0DF0B9:
	LDA.w $7AF6,x
	BNE.b CODE_0DF0B4
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_0DF0CB:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_0DF0B4
	BEQ.b CODE_0DF0B4
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BEQ.b CODE_0DF0E7
CODE_0DF0DC:
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_0DF0CB

CODE_0DF0E7:
	CPY.w $105E
	BNE.b CODE_0DF13F
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CMP.w #$0009
	BPL.b CODE_0DF0DC
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	BMI.b CODE_0DF0DC
	LDY.w $7400,x
	LDA.w DATA_0DF0B5,y
	LDY.w $105E
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FA00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0040
	STA.w $7542,y
	LDA.w #$0047
	STA.w $7A36,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDA.w #$004E
	STA.w $7A38,y
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LDA.w #$000A
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #!Define_YI_SoundID8A_BabyBowserHurt
	LDY.w $1062
	CPY.b #$02
	BMI.b CODE_0DF139
	LDA.w #!Define_YI_SoundID8E_BabyBowserDefeated
CODE_0DF139:
	JSL.l CODE_push_sound_queue
CODE_0DF13D:
	BRA.b CODE_0DF0DC

CODE_0DF13F:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr128_GroundRippleInBabyBowerRoom
	BNE.b CODE_0DF0DC
	TYA
	CMP.w $7A36,x
	BEQ.b CODE_0DF0DC
	CMP.b $18,x
	BEQ.b CODE_0DF0DC
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BPL.b CODE_0DF0DC
	LDA.w $7CD6,y
	SEC
	SBC.w $7CD6,x
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0DF168
	JMP.w CODE_0DF0DC

CODE_0DF168:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CLC
	ADC.w #$FF40
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.b $76,x
	CLC
	ADC.w #$FF40
	STA.b $76,x
	STY.b $18,x
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	BRA.b CODE_0DF13D

CODE_0DF182:
	LDA.w $7A96,x
	BNE.b CODE_0DF19A
	LDA.b $10
	AND.w #$0003
	CLC
	ADC.w #$0004
	STA.w $7A96,x
	LDA.w #!Define_YI_SoundID14_Gulp
	JSL.l CODE_push_sound_queue
CODE_0DF19A:
	RTS

DATA_0DF19B:
	dw $0459,$052B,$0528,$0525,$0522,$004E,$004D

CODE_0DF1A9:
	TYX
	LDA.w $7A96,x
	BEQ.b CODE_0DF20F
	CMP.w #$0080
	BNE.b CODE_0DF1B9
	LDY.b #$0A
	STY.w !RAM_YI_Global_PlayMusicLo
CODE_0DF1B9:
	LSR
	BNE.b CODE_0DF20C
	LDY.b #$02
	STY.w $011C
	LDA.w #$1100
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.w !RAM_YI_Global_HDMAEnable
	EOR.w #$00DE
	STA.w !RAM_YI_Global_HDMAEnable
	LDA.w #$7FFF
	STA.l YI_Global_PaletteMirror[$00].LowByte
	LDA.w #$2800
	STA.w $0C18
	LDA.w #$0007
	STA.w $0C14
	LDA.w #$6800
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0002
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$01CE
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0400
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08AA8B>>16
	LDA.w #FXCODE_08AA8B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #$B400
	STA.w $0CF9
CODE_0DF20C:
	JMP.w CODE_0DDEAA

CODE_0DF20F:
	LDA.w #!Define_YI_PlayerState1A_DisableInput
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	LDA.w $6094
	CMP.w #$0280
	BCS.b CODE_0DF232
	ADC.w #$0010
	CMP.w #$0280
	BCC.b CODE_0DF22B
	LDA.w #$0280
CODE_0DF22B:
	STA.w $0C23
	STA.w $0C1E
	RTS

CODE_0DF232:
	STA.w $7E18
	STZ.w $0C1E
	REP.b #$10
	LDA.w $0C14
	ASL
	TAY
	LDX.w DATA_0DF19B-$02,y
	CPY.w #$000A
	BCC.b CODE_0DF25C
	BEQ.b CODE_0DF256
	TXA
	JSL.l CODE_00B753
	LDX.w #$6800
	LDA.w #$0800
	BRA.b CODE_0DF286

CODE_0DF256:
	LDA.w #$5600
	STA.w $0C18
CODE_0DF25C:
	LDA.l DATA_06F95E,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.l DATA_06F95E+$02,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	SEP.b #$10
	LDX.b #FXCODE_0A8000>>16
	LDA.w #FXCODE_0A8000
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDX.w #$705800
	LDA.w #$0400
CODE_0DF286:
	STA.b $00
	LDY.w #$705800>>16
	STY.w $0001
	LDY.w $0C18
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$10
	LDX.b $12
	LDA.b $00
	LSR
	ADC.w $0C18
	STA.w $0C18
	DEC.w $0C14
	BEQ.b CODE_0DF2A8
	RTS

CODE_0DF2A8:
	LDX.b #$1C
CODE_0DF2AA:
	LDA.l DATA_5FC328,x
	STA.l $702D6E,x
	STA.l YI_Global_PaletteMirror[$01].LowByte,x
	LDA.l DATA_5FEA3C,x
	STA.l $702F2E,x
	STA.l YI_Global_PaletteMirror[$E1].LowByte,x
	DEX
	DEX
	BPL.b CODE_0DF2AA
	LDX.b $12
	JSR.w CODE_0DD5F7
	LDA.w #$7FFF
	STA.l YI_Global_PaletteMirror[$00].LowByte
	STZ.w $61CE
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	JSL.l CODE_028922
	STZ.w $60C4
	LDA.w #$02C8
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w #$07A0
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$0358
	STA.w $70E2,x
	LDA.w #$0298
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0047
	STA.w $7A36,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$004E
	STA.w $7A38,x
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.b $16,x
	SEP.b #$20
	LDA.b #$2C
	STA.w $7180,x
	REP.b #$20
	RTS

CODE_0DF32A:
	JSR.w CODE_0DCF8F
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0DF357
	LDY.w $7402,x
	CPY.b #$0F
	BNE.b CODE_0DF357
	LDA.w #!Define_YI_SoundID8E_BabyBowserDefeated
	JSL.l CODE_push_sound_queue
CODE_0DF343:
	LDA.w #$004E
	STA.w $7A36,x
	LDA.w #$0056
	STA.w $7A38,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $76,x
CODE_0DF357:
	RTS

CODE_0DF358:
	JSR.w CODE_0DCF8F
	BCC.b CODE_0DF35F
	INC.b $76,x
CODE_0DF35F:
	RTS

CODE_0DF360:
	TYX
	LDY.b $16,x
	BNE.b CODE_0DF382
	LDA.w #$0125
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0DF382
	LDA.w #$0000
	STA.w $70E2,y
	INC.b $16,x
	LDA.w #$0015
	STA.w !RAM_YI_Global_MainScreenLayers
	STZ.w $6098
	STZ.w $60A0
CODE_0DF382:
	RTS

CODE_0DF383:
	TYX
	REP.b #$10
	LDA.w #$005E
	JSL.l CODE_00B753
	LDX.w #$706800
	LDA.w #$706800>>16
	STA.w $0001
	LDY.w #$5800
	LDA.w #$0800
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$10
	LDX.b #$1C
CODE_0DF3A4:
	LDA.l DATA_5FF592,x
	STA.l YI_Global_PaletteMirror[$E1].LowByte,x
	DEX
	DEX
	BPL.b CODE_0DF3A4
	LDX.b $12
	INC.b $76,x
	LDA.w #$9000
	STA.w $0C18
	LDA.w #$0480
	STA.w $7E1A
	LDA.w #!Define_YI_PlayerState26
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $617E
	STZ.w $61F6
	LDA.w #$0011
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.w #DATA_0DF3E8
	STA.b $18,x
	LDA.w #$9000
	STA.w $0C18
	LDY.b #!SuperFX_ScreenMode_ScreenHeight_128pixels|!SuperFX_ScreenMode_ColorMode_16Colors|!SuperFX_ScreenMode_SuperFXHasWRAMAccess|!SuperFX_ScreenMode_SuperFXHasROMAccess|!SuperFX_ScreenMode_ColorMode_Unused
	STY.w $012E
	LDY.b #$1A
	STY.w $012D
	RTS

table "Tables/Fonts/Main.txt"

DATA_0DF3E8:
	db "Thus, due to the marvelous"
	dw $0AFF
	db "team work of the Yoshi clan,"
	dw $09FF
	db "    the twins are reunited."
	dw $0AFF
	dw $0AFF
	dw $09FF
	db "The captured stork is freed"
	dw $0AFF
	db "  by Yoshi, and sets about"
	dw $09FF
	db "  his duty and finally makes"
	dw $0AFF
	db "  the long awaited delivery!"
	dw $09FF
	dw $0AFF
	db "Thank you, Yoshi! The twins"
	dw $09FF
	db " will meet the parents soon!"
	dw $09FF
	dw $FFFF

cleartable

CODE_0DF4F7:
	TYX
	LDA.w #DATA_0DF3E8>>16
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_09F7BC>>16
	LDA.w #FXCODE_09F7BC
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CPY.b #$FF
	BEQ.b CODE_0DF528
	LDA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	STA.b $18,x
	LDA.w $0C18
	STA.w $0CF9
	CLC
	ADC.w #$0300
	STA.w $0C18
	RTS

CODE_0DF528:
	INC.b $76,x
	LDX.b #FXCODE_09F77B>>16
	LDA.w #FXCODE_09F77B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #$B400
	STA.w $0CF9
	STZ.b $18,x
	LDA.w #$0A00
	STA.w $7A96,x
	LDA.w #$0300
	STA.w $7A98,x
	LDA.w #$7FFF
	STA.l $702D6E
	STA.l YI_Global_PaletteMirror[$01].LowByte
	STZ.w $6098
	STZ.w !RAM_YI_Global_Layer3XPosLo
	STZ.w $60A0
	STZ.w !RAM_YI_Global_Layer3YPosLo
	LDY.b #$01
	STY.w !RAM_YI_Global_BG3And4TileDataDesignation
	LDA.w #$0015
	STA.w !RAM_YI_Global_MainScreenLayers
	LDY.b #$20
	STY.w !RAM_YI_Global_ColorMathInitialSettings
	LDY.b #$B1
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.w !RAM_YI_Global_HDMAEnable
	EOR.w #$001E
	STA.w !RAM_YI_Global_HDMAEnable
	STZ.w $0948
	LDA.w #$0040
	JSL.l CODE_spawn_sprite_init
	LDA.w #$04F0
	STA.w $70E2,y
	LDA.w #$07A0
	STA.w $7182,y
	LDA.w #$0041
	JSL.l CODE_spawn_sprite_init
	LDA.w #$0530
	STA.w $70E2,y
	LDA.w #$0732
	STA.w $7182,y
	LDY.b #!SuperFX_ScreenMode_ScreenHeight_160pixels|!SuperFX_ScreenMode_ColorMode_16Colors|!SuperFX_ScreenMode_SuperFXHasWRAMAccess|!SuperFX_ScreenMode_SuperFXHasROMAccess|!SuperFX_ScreenMode_ColorMode_Unused
	STY.w $012E
	LDY.b #$16
	STY.w $012D
	RTS

CODE_0DF5B2:
	TYX
	LDA.w $60A0
	CMP.w #$00F0
	BCS.b CODE_0DF5F7
	LDA.w $7A98,x
	BNE.b CODE_0DF608
	INC.w $60A0
	LDA.w #$0004
	STA.w $7A98,x
	STZ.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$7FFF
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	CLC
	ADC.w #$0002
	CMP.w #$0100
	BCC.b CODE_0DF5E3
	LDA.w #$0100
CODE_0DF5E3:
	STA.b $18,x
	LDX.b #FXCODE_08E132>>16
	LDA.w #FXCODE_08E132
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STA.w $0948
	RTS

CODE_0DF5F7:
	LDA.w $7A96,x
	BNE.b CODE_0DF608
	LDA.w #!Define_YI_MusicID_FadeMusicCommand
	STA.w !RAM_YI_Global_PlayMusicLo
	LDA.w #!Define_YI_GameMode16
	STA.w !RAM_YI_Global_CurrentGameMode
CODE_0DF608:
	RTS

;---------------------------------------------------------------------------

DATA_0DF609:
	dw $0180,$00F8,$0060,$FFF0,$0128,$00A0,$0048

DATA_0DF617:
	dw $0180,$01FF,$0180,$0180,$01FF,$0180,$01FF

DATA_0DF625:
	dw $0000,$0020,$0040

DATA_0DF62B:
	dw $0100,$00C0,$0080

DATA_0DF631:
	dw $0000,$0020,$0040

;---------------------------------------------------------------------------
; Sprite $0CF: Falling rocks during the Bowser fight. Raiden: init_bowser_quake.
;---------------------------------------------------------------------------
YI_NorSpr0CF_BowserRocks_Init:
init_bowser_quake:
;$0DF637
	JSL.l CODE_03AEEB
	LDY.b #$04
CODE_0DF63D:
	PHY
	LDA.w DATA_0DF625,y
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w DATA_0DF62B,y
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w DATA_0DF631,y
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STZ.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_548000+$00E0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$00E0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLY
	DEY
	DEY
	BPL.b CODE_0DF63D
	INC.w $0CF9
	LDY.b #$1C
	LDX.w $011C
	CPX.b #$02
	BNE.b CODE_0DF67B
	LDY.b #$3C
CODE_0DF67B:
	PHB
	LDX.b #$7021C2>>16
	PHX
	PLB
	LDX.b #$1C
CODE_0DF682:
	LDA.l DATA_5FF4A0,x
	STA.w $702F2E,y
	STA.w $7021C2,y
	STA.w $70312E,y
	DEY
	DEY
	DEX
	DEX
	BPL.b CODE_0DF682
	PLB
	LDX.b $12
	LDA.w #$0010
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0DF6AA
	LDY.w $011C
	CPY.b #$02
	BEQ.b CODE_0DF6AA
	LDA.w #$0040
CODE_0DF6AA:
	STA.w $1072
	STA.b $18,x
	RTL

;---------------------------------------------------------------------------

DATA_0DF6B0:
	dw $0200,$0204,$0004,$0400,$0202,$0402,$0004,$0200

DATA_0DF6C0:
	dw $0800,$2001,$2001

DATA_0DF6C6:
	dw $0007,$0005,$0006

DATA_0DF6CC:
	dw $0C00,$0800,$0A00

DATA_0DF6D2:
	dw $FC00,$0500,$FF00,$0300,$FE00,$FD00,$0400,$0200
	dw $FD80,$0480,$FE80,$0280,$FD80,$FE80,$0380,$0180

DATA_0DF6F2:
	dw $0400,$FB00

DATA_0DF6F6:
	dw $D000,$3000

DATA_0DF6FA:
	db $40,$10,$50,$20

;---------------------------------------------------------------------------
; Sprite $0CF main. Raiden: main_bowser_quake.
;---------------------------------------------------------------------------
YI_NorSpr0CF_BowserRocks_Main:
main_bowser_quake:
;$0DF6FE
	JSL.l CODE_03AF23
	LDA.w $1072
	BNE.b CODE_0DF70A
	JMP.w CODE_0DF7C1

CODE_0DF70A:
	LDA.b $14
	AND.w #$000F
	ORA.w #$0040
	STA.w $61C6
	LDA.w $7AF6,x
	BNE.b CODE_0DF730
	LDA.b $10
	AND.w #$0003
	TAY
	LDA.w DATA_0DF6FA,y
	AND.w #$00FF
	STA.w $7AF6,x
	LDA.w #!Define_YI_SoundID99_BigExplosion
	JSL.l CODE_push_sound_queue
CODE_0DF730:
	LDA.w $7A96,x
	BEQ.b CODE_0DF736
	RTL

CODE_0DF736:
	LDA.w #$0010
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0DF741
	LDA.w #$0008
CODE_0DF741:
	STA.w $7A96,x
	LDA.b $18,x
	BEQ.b CODE_0DF7C0
	LDA.w #$0008
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0DF7C0
	DEC.b $18,x
	PHY
	LDA.b $18,x
	AND.w #$000F
	TAY
	LDX.w DATA_0DF6B0,y
	PLY
	TXA
	LSR
	LSR
	STA.w $7402,y
	LDA.w DATA_0DF6C0,x
	STA.w $7040,y
	LDA.w DATA_0DF6C6,x
	STA.w $74A2,y
	LDA.w DATA_0DF6CC,x
	STA.b $00
	LDA.b $10
	AND.w #$001E
	TAX
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w DATA_0DF6D2,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	CLC
	ADC.b $00
	STA.w $70E2,y
	LDA.b $10
	AND.w #$00C0
	ORA.w $7042,y
	LDX.w $011C
	CPX.b #$02
	BNE.b CODE_0DF7A5
	ORA.w #$002E
	PHA
	LDA.w #$0000
	STA.w $74A2,y
	PLA
CODE_0DF7A5:
	STA.w $7042,y
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w DATA_0DF6F2,x
	STA.w $7182,y
	LDA.w DATA_0DF6F6,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDX.b $12
CODE_0DF7C0:
	RTL

CODE_0DF7C1:
	LDA.b $18,x
	BNE.b CODE_0DF7F1
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_0DF842
	LDX.b #$1C
CODE_0DF7CC:
	LDA.l DATA_5FF4DC,x
	STA.l $702F2E,x
	STA.l YI_Global_PaletteMirror[$E1].LowByte,x
	DEX
	DEX
	BPL.b CODE_0DF7CC
	LDX.b $12
	STZ.w $74A2,x
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$00F0
	STA.w $7182,x
	LDA.w #$0005
	STA.b $18,x
	RTL

CODE_0DF7F1:
	LDA.b $14
	ASL
	ASL
	ASL
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_548000+$00E0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$00E0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	SEP.b #$10
	LDX.b #FXCODE_08877E>>16
	LDA.w #FXCODE_08877E
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	LDA.w $7682,x
	CMP.w #$00F0
	BMI.b CODE_0DF8A6
	LDY.w $1070
	CPY.b #$0E
	BCS.b CODE_0DF842
	DEC.b $18,x
	BNE.b CODE_0DF846
CODE_0DF842:
	JML.l CODE_03A31E

CODE_0DF846:
	INY
	INY
	STY.w $1070
	LDA.w DATA_0DF609-$02,y
	CLC
	ADC.w $7E18
	STA.w $70E2,x
	LDA.w !RAM_YI_Global_Layer1YPosLo
	SEC
	SBC.w #$0200
	STA.w $7182,x
	LDA.w DATA_0DF617-$02,y
	STA.b $76,x
	LDA.w #$07C0
	STA.b $78,x
	LDA.w #$0800
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$00AC
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0DF89F
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w #$07C0
	STA.w $7182,y
	LDA.w #$0080
	STA.w $7A96,y
	LDA.b $76,x
	INC
	XBA
	AND.w #$00FF
	ASL
	CLC
	ADC.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0040
	STA.w $7A98,y
CODE_0DF89F:
	LDA.w #!Define_YI_SoundID20_SoaringEgg
	JML.l CODE_push_sound_queue

CODE_0DF8A6:
	LDA.w $7182,x
	CMP.w #$07F0
	BPL.b CODE_0DF8E9
	CMP.b $78,x
	BMI.b CODE_0DF8E9
	STA.w $0093
	LDA.w $70E2,x
	SEC
	SBC.w #$0010
	STA.w $0091
	LDA.b $76,x
	INC
	ASL
	XBA
	TAY
	DEY
	STY.w $0095
	LDA.w #$0003
	STA.w $008F
	JSL.l CODE_change_map16
	LDX.b $12
	LDA.b $78,x
	CLC
	ADC.w #$0010
	STA.b $78,x
	CMP.w #$07D0
	BNE.b CODE_0DF8E9
	LDA.w #!Define_YI_SoundID99_BigExplosion
	JSL.l CODE_push_sound_queue
CODE_0DF8E9:
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $026: Giant egg sprite that Baby Bowser produces post-fight.
; Raiden: init_baby_bowser_egg.
;---------------------------------------------------------------------------
YI_NorSpr026_BowserFightGiantEgg_Init:
init_baby_bowser_egg:
;$0DF8EA
	RTL

;---------------------------------------------------------------------------

DATA_0DF8EB:
	db $00,$00,$00,$00,$00,$00,$00,$01,$01,$01,$02,$02,$02,$03,$03,$03

;---------------------------------------------------------------------------
; Sprite $026 main. Raiden: main_baby_bowser_egg.
;---------------------------------------------------------------------------
YI_NorSpr026_BowserFightGiantEgg_Main:
main_baby_bowser_egg:
;$0DF8FB
	LDA.w $7D38,x
	BNE.b CODE_0DF903
	JMP.w CODE_0DFA74

CODE_0DF903:
	LDA.w #$0004
	JSR.w CODE_0DFA94
	LDA.w $7682,x
	CLC
	ADC.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w $7682,x
	CMP.w #$FFC0
	BPL.b CODE_0DF98B
	LDA.w $70E2,x
	CLC
	ADC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $70E2,x
	LDA.w !RAM_YI_Global_Layer1YPosLo
	SEC
	SBC.w #$0080
	STA.w $7182,x
	LDA.b $10
	AND.w #$0003
	BNE.b CODE_0DF93F
	LDA.w #!Define_YI_SoundID32_HitMessageBox
	JSL.l CODE_push_sound_queue
	TXY
	JML.l CODE_make_star_or_coin_l

CODE_0DF93F:
	LDA.w #!Define_YI_SoundID2E_ClankSound7
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_NorSpr091_4RedToadies
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w $70E2,x
	CLC
	ADC.w #$0010
	STA.b $18,x
	LDA.w #$000C
	STA.w $7540,x
	LDA.w #$0020
	STA.w $7542,x
	LDA.w #$0200
	STA.w $75E2,x
	LDA.w $7042,x
	ORA.w #$0080
	STA.w $7042,x
	LDA.w #$0004
	STA.w $74A2,x
	LDA.w #$0004
	STA.w $7402,x
	LDA.w #$1801
	STA.w $7040,x
CODE_0DF98A:
	RTL

CODE_0DF98B:
	LDA.w #$0100
	SEC
	SBC.w !REGISTER_SuperFX_R6_MultiplierLo
	LSR
	LSR
	LSR
	LSR
	CMP.w #$000F
	BCC.b CODE_0DF99F
	JML.l CODE_03A31E

CODE_0DF99F:
	STA.w $7402,x
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_0DF98A
	LDA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	CMP.w $1068
	BPL.b CODE_0DF9C5
	LDA.w $7682,x
	CMP.w #$0090
	BPL.b CODE_0DF9C2
	LDY.b #$20
	JMP.w CODE_0DFA65

CODE_0DF9C2:
	JMP.w CODE_0DFA63

CODE_0DF9C5:
	CMP.w #$0100
	BMI.b CODE_0DFA1D
	LDY.w $7B56,x
	BNE.b CODE_0DF9D8
	CMP.w #$0800
	BMI.b CODE_0DF9C2
	JML.l CODE_03A31E

CODE_0DF9D8:
	STZ.w $7B56,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEC
	SBC.w $106C
	STA.b $00
	CLC
	ADC.w #$0054
	CMP.w #$0099
	BCS.b CODE_0DFA02
	LDA.w $7CD8,x
	SEC
	SBC.w $106A
	CLC
	ADC.w #$00EC
	CMP.w #$0119
	BCS.b CODE_0DFA02
	INC.w $1074
	BRA.b CODE_0DFA1D

CODE_0DFA02:
	LDA.b $00
	CLC
	ADC.w #$00B4
	CMP.w #$0159
	BCS.b CODE_0DFA63
	LDA.w $7CD8,x
	SEC
	SBC.w $106A
	CLC
	ADC.w #$00AC
	CMP.w #$02B9
	BCS.b CODE_0DFA63
CODE_0DFA1D:
	LDA.w #!Define_YI_AmbSpr218
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_AmbSpr_GenericTable7018C2|!EXRAMBankMirror,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$0011
	STA.w $7E4C,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w $7682,x
	CMP.w #$0090
	BMI.b CODE_0DFA53
	LDA.w $7002,y
	AND.w #$00CF
	STA.w $7002,y
CODE_0DFA53:
	LDA.w $7402,x
	TAX
	LDA.w DATA_0DF8EB,x
	STA.w $7E4E,y
	LDX.b $12
	JML.l CODE_03A31E

CODE_0DFA63:
	LDY.b #$00
CODE_0DFA65:
	LDA.w $7042,x
	AND.w #$00CF
	STA.b $00
	TYA
	ORA.b $00
	STA.w $7042,x
	RTL

CODE_0DFA74:
	JSL.l CODE_03B9DD
	LDA.b $78,x
	BEQ.b CODE_0DFA7F
	JMP.w CODE_0DFA8F

CODE_0DFA7F:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0DFA8B
	JSL.l CODE_03A590
CODE_0DFA8B:
	JML.l CODE_03B95E

CODE_0DFA8F:
	JSL.l CODE_03BB1D
	RTL

CODE_0DFA94:
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7362,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_09F5F4>>16
	LDA.w #FXCODE_09F5F4
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	STZ.w $72C0,x
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0CE: Bowser's fire breath projectile. Raiden: init_bowser_flame.
;---------------------------------------------------------------------------
YI_NorSpr0CE_BowserFire_Init:
init_bowser_flame:
;$0DFAC2
	JSL.l CODE_03AEEB
	LDA.w #$0007
	STA.w $74A2,x
	LDA.w #$0008
	STA.w $7402,x
CODE_0DFAD2:
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $76,x
	SEC
	SBC.w #$00AB
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0400
	BCS.b CODE_0DFAEE
	STZ.w $7402,x
	LDA.w #$0003
	STA.w $7040,x
CODE_0DFAEE:
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_548000+$00C0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$00C0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	SEP.b #$10
	LDX.b #FXCODE_0888AC>>16
	LDA.w #FXCODE_0888AC
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0CE main. Raiden: main_bowser_flame.
;---------------------------------------------------------------------------
YI_NorSpr0CE_BowserFire_Main:
main_bowser_flame:
;$0DFB1D
	LDA.w #$0020
	LDY.w $7402,x
	BEQ.b CODE_0DFB28
	LDA.w #$0004
CODE_0DFB28:
	JSR.w CODE_0DFA94
	LDA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	CMP.w #$0100
	BPL.b CODE_0DFB4F
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_09F70B>>16
	LDA.w #FXCODE_09F70B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BNE.b CODE_0DFB4B
	JSL.l CODE_03A858
CODE_0DFB4B:
	JML.l CODE_03A31E

CODE_0DFB4F:
	STA.b $76,x
	JSL.l CODE_03AF23
	JSL.l CODE_0DFAD2
	LDA.b $18,x
	CLC
	ADC.w #$0004
	AND.w #$00FF
	STA.b $18,x
	LDY.b #$00
	LDA.b $16,x
	BPL.b CODE_0DFB6B
	DEY
CODE_0DFB6B:
	LDA.w $7A36,x
	CLC
	ADC.b $16,x
	STA.w $7A36,x
	TYA
	ADC.w $7A38,x
	STA.w $7A38,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w $7A37,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w $70E2,x
	CLC
	ADC.w $7A37,x
	STA.w $70E2,x
	STZ.w $7A37,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $008: Falling rubble (Bowser-fight cosmetic debris). Raiden: init_rubble.
;---------------------------------------------------------------------------
YI_NorSpr008_FallingRubble_Init:
init_rubble:
;$0DFB93
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $008 main. Raiden: main_rubble.
;---------------------------------------------------------------------------
YI_NorSpr008_FallingRubble_Main:
main_rubble:
;$0DFB94
	LDA.w $7041,x
	AND.w #$00F8
	LSR
	LSR
	LSR
	JSR.w CODE_0DFA94
	JSL.l CODE_03AF23
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0DFBB2
	LDA.w $7682,x
	CMP.w #$F600
	BMI.b CODE_0DFBBA
CODE_0DFBB1:
	RTL

CODE_0DFBB2:
	LDA.w $7682,x
	CMP.w #$0700
	BMI.b CODE_0DFBB1
CODE_0DFBBA:
	DEC.w $1072
	JML.l CODE_03A31E

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0AC: Falling-rock warning arrow + shadow (telegraph the rocks).
; No Raiden equivalent label -- end-of-bank sprite.
;---------------------------------------------------------------------------
YI_NorSpr0AC_FallingRockArrowAndShadow_Init:
init_falling_rock_arrow_shadow:
;$0DFBC1
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0AC main.
;---------------------------------------------------------------------------
YI_NorSpr0AC_FallingRockArrowAndShadow_Main:
main_falling_rock_arrow_shadow:
;$0DFBC2
	LDY.w $74A2,x
	BPL.b CODE_0DFBD5
	LDA.w $0030
	AND.w #$0008
	BEQ.b CODE_0DFBD5
	LDY.b #$02
	JSL.l CODE_02D995
CODE_0DFBD5:
	JSL.l CODE_03AF23
	LDA.w $7A96,x
	BNE.b CODE_0DFBE2
	JML.l CODE_03A31E

CODE_0DFBE2:
	LDA.w $7A98,x
	BNE.b CODE_0DFC03
	LDA.w #$0002
	STA.w $7A98,x
	LDY.w $74A2,x
	BPL.b CODE_0DFBF9
	LDA.w #$0004
	STA.w $74A2,x
	RTL

CODE_0DFBF9:
	LDA.w $7402,x
	CMP.b $18,x
	BCS.b CODE_0DFC03
	INC.w $7402,x
CODE_0DFC03:
	RTL

CODE_0DFC04:
	PHD
	LDA.w #$0000
	TCD
	SEP.b #$20
	LDX.w !RAM_YI_Level_CurrentLevelFromMapLo
	LDA.b #$01
	STA.w !RAM_YI_Map_LevelClearFlags,x
	STZ.w $1135
	REP.b #$20
	LDA.w !RAM_YI_Level_StarTimerLo
CODE_0DFC1B:
	SEC
	SBC.w #$000A
	BMI.b CODE_0DFC26
	INC.w $1135
	BRA.b CODE_0DFC1B

CODE_0DFC26:
	LDA.w $1135
CODE_0DFC29:
	DEC.w !RAM_YI_Level_FlowersCollectedLo
	BMI.b CODE_0DFC34
	CLC
	ADC.w #$000A
	BRA.b CODE_0DFC29

CODE_0DFC34:
	CLC
	ADC.w !RAM_YI_Level_RedCoinsCollectedLo
	AND.w #$00FF
	SEP.b #$20
	CMP.w $02FB
	BCS.b CODE_0DFC45
	LDA.w $02FB
CODE_0DFC45:
	STA.w $1135
	STA.w $02FB
	STA.b $A0
	STZ.b $A1
	REP.b #$20
	LDX.b #$06
CODE_0DFC53:
	LDA.w $02F4,x
	AND.w #$00FF
	CLC
	ADC.b $A0
	STA.b $A0
	DEX
	BPL.b CODE_0DFC53
	LDA.b $A0
	CMP.w #$0320
	BCC.b CODE_0DFC77
	LDA.w #$0A09
	STA.w $0353
	LDX.w !RAM_YI_Level_CurrentLevelFromMapLo
	LDA.w #$0101
	STA.w $022A,x
CODE_0DFC77:
	SEP.b #$20
	JSL.l CODE_save_game
	REP.b #$20
	LDX.b $12
	PLD
	RTS

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($0DFC90, incbin, DATA_0DFC90_YI_U2.bin)
else
	%FREE_BYTES($0DFC83, 893, $FF)
endif
%BANK_END(<EndBank>)
endmacro
