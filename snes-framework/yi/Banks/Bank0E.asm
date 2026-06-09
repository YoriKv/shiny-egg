;#############################################################################################################
;# Bank0E.asm -- normal-sprite Init/Main handlers (SNES bank $0E, mirror $8E).
;#
;# Continuation of Bank0C/0D's sprite-handler series. Notably contains:
;#   - Cannonball / Bomb shared handler ($00B / $060)
;#   - The full Goonie family: Goonie ($0E8), 3 wingless ($0E9), Goonie w/ Shy Guy ($153),
;#     Fat Goonie ($155), Bowling Goonie ($158)
;#   - Incoming-Chomp series ($0A6 / $0A7 / $0A8 / $0A9) -- the foreground chomp + flock
;#     + falling variant + projected ground shadow
;#   - Boo Blah ($0E2) + Boo Blah-with-Piro-Dangle composite ($0E3)
;#   - Huffin Puffin parent + children family ($0F6 / $028) and Blow Hard ($0F8 / $04C up)
;#   - Needlenose family (Spiny Egg, Lakitu fireball, Green/Yellow Needlenose -- all share Init)
;#   - Snowball ($0DC), Flower ($0FA / $110), Red POW switch ($09D), Cactus Jack ($156),
;#     Chomp Rock ($09E), Barney Bubble ($0F7)
;#   - Bandit family: Bandit, Hiding (L/R) Bandit, Red Coin Bandit (+ shared StompRt)
;#   - Toady family: Green/Pink Toady ($058 / $05C)
;#   - Frog Pirate boss-ish ($017, +StompRt) and Fishin' Lakitu ($0D9, +StompRt)
;#
;# Cross-references:
;#   yoshisisland-disassembly/disassembly/bank0E.asm -- ~55 descriptive labels.
;#   docs/spritestateengine.md     -- sprite engine architecture + ID space.
;#   ../Constants/NormalSpriteIDs.asm
;#   see also: ys_enmy*.asm (enemy/sprite handlers split across ys_enmy.asm..ys_enmy14.asm).
;#
;# CODE_0E8000 mirrors CODE_0D8000 -- TYX/RTS shared register-shuffle stub.
;#############################################################################################################

macro YIBank0EMacros(StartBank, EndBank)
%BANK_START(<StartBank>)

;---------------------------------------------------------------------------
; CODE_0E8000: TYX / RTS shared register-shuffle stub (mirror of CODE_0D8000).
;---------------------------------------------------------------------------
CODE_0E8000:
	TYX
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprites $00B / $060: Cannonball and Bomb (shared init).
; Raiden: init_cannonball.
;
; See docs/family-cannons.md for the full projectile-weapon family
; breakdown. Cannonball + Bomb share this Init body, then two separate
; Main labels run: Cannonball's Main is a 2-line wedge that checks
; $7D38 (Kaboomba-fired-flag sentinel) before falling into Bomb's Main.
; Cannonball is exclusively Kaboomba-spawned (one call site in the
; whole codebase); the $7D38 = 1 sentinel reliably distinguishes
; fired vs placed.
;---------------------------------------------------------------------------
YI_NorSpr00B_Cannonball_Init:
YI_NorSpr060_Bomb_Init:
init_cannonball:
;$0E8002
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0030
	STA.b $16,x
	SEP.b #$20
	LDA.b #$7F
	STA.w $7863,x
	REP.b #$20
	INC.b $78,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $00B main. Raiden: main_cannonball.
;---------------------------------------------------------------------------
YI_NorSpr00B_Cannonball_Main:
main_cannonball:
;$0E8019
	LDY.w $7D38,x
	BEQ.b CODE_main_bomb
	LDY.w $7D36,x
	BMI.b CODE_0E809E
;---------------------------------------------------------------------------
; Sprite $060: Bomb main (separate label from cannonball Main, despite shared Init).
;---------------------------------------------------------------------------
YI_NorSpr060_Bomb_Main:
CODE_main_bomb:
CODE_0E8023:
	JSL.l CODE_03AF23
	LDY.b $76,x
	BEQ.b CODE_0E802F
	JSR.w CODE_0E814D
	RTL

CODE_0E802F:
	LDY.b $18,x
	BEQ.b CODE_0E803E
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0E809E
	JMP.w CODE_0E80DD

CODE_0E803E:
	LDY.w $7D36,x
	BMI.b CODE_0E809E
	BEQ.b CODE_0E8055
	LDA.w $735F,y
	CMP.w #$0015
	BNE.b CODE_0E8055
	TYX
	DEX
	JSL.l CODE_03B25B
	BRA.b CODE_0E809E

CODE_0E8055:
	LDA.w $7A96,x
	BNE.b CODE_0E808E
	LDY.w $7223,x
	BMI.b CODE_0E8082
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr00B_Cannonball
	BEQ.b CODE_0E8082
	LDA.w $6FA2,x
	AND.w #$001F
	BEQ.b CODE_0E808A
	REP.b #$10
	TXY
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.l $700024,x
	SEP.b #$10
	TYX
	AND.w #$0004
	BNE.b CODE_0E809A
CODE_0E8082:
	LDA.w $7860,x
	AND.w #$002F
	BNE.b CODE_0E809A
CODE_0E808A:
	LDY.b #$01
	STY.b $78,x
CODE_0E808E:
	LDY.w $7862,x
	BEQ.b CODE_0E8097
	DEC.b $16,x
	BMI.b CODE_0E809A
CODE_0E8097:
	JMP.w CODE_0E80D9

CODE_0E809A:
	LDA.b $78,x
	BEQ.b CODE_0E808E
CODE_0E809E:
	LDA.w #!Define_YI_AmbSpr1ED
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.w $7CD8,x
	STA.w $7142,y
	LDA.w #$000D
	STA.w $73C2,y
	LDA.w #$0003
	STA.w $7782,y
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7D38,x
	LDA.w #$68A0
	STA.w $6FA0,x
	INC.b $76,x
	RTL

CODE_0E80D9:
	JSL.l CODE_03A5B7
CODE_0E80DD:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr00B_Cannonball
	BEQ.b CODE_0E8128
	LDA.w $7362,x
	BMI.b CODE_0E8128
	LDA.w $0030
	AND.w #$0001
	BNE.b CODE_0E8128
	LDA.b $10
	PHA
	AND.w #$0003
	SEC
	SBC.w #$000A
	STA.b $00
	PLA
	XBA
	AND.w #$0003
	SEC
	SBC.w #$000A
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1EC
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7CD6,x
	CLC
	ADC.b $00
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.b $02
	STA.w $7142,y
	LDA.w #$0002
	STA.w $7782,y
CODE_0E8128:
	RTL

DATA_0E8129:
	dw $0000,$FFF0,$0010,$0010,$FFF0,$0000,$0010,$FFF0

DATA_0E8139:
	dw $0010,$0000,$FFF0,$0010,$0010,$FFF0,$0000,$FFF0
	dw $FF00,$0100

CODE_0E814D:
	LDY.w $7A36,x
	PHY
	JSR.w CODE_0E818B
	PLY
	INY
	INY
	JSR.w CODE_0E818B
	LDA.w $7A36,x
	CLC
	ADC.w #$0004
	STA.w $7A36,x
	CMP.w #$0010
	BMI.b CODE_0E816E
	JSL.l CODE_03A31E
	RTS

CODE_0E816E:
	LDA.w $7C16,x
	CLC
	ADC.w #$0018
	CMP.w #$0030
	BCS.b CODE_0E818A
	LDA.w $7C18,x
	CLC
	ADC.w #$0018
	CMP.w #$0030
	BCS.b CODE_0E818A
	JSL.l CODE_03A858
CODE_0E818A:
	RTS

CODE_0E818B:
	LDA.w DATA_0E8129,y
	CLC
	ADC.w $7CD6,x
	STA.w $0091
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w DATA_0E8139,y
	CLC
	ADC.w $7CD8,x
	STA.w $0093
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$F800
	CMP.w #$4000
	BNE.b CODE_0E81BF
	JSL.l CODE_0DA479
CODE_0E81BF:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $09A: Green swinging platform (a.k.a. flatbed ferry).
; Raiden: init_flatbed_ferry_green.
;---------------------------------------------------------------------------
YI_NorSpr09A_SwingingGreenPlatform_Init:
init_flatbed_ferry_green:
;$0E81C0
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$C000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.w $7400,x
	RTL

;---------------------------------------------------------------------------

DATA_0E81CD:
	dw $FFA0,$0060

;---------------------------------------------------------------------------
; Sprite $09A main. Raiden: main_flatbed_ferry_green.
;---------------------------------------------------------------------------
YI_NorSpr09A_SwingingGreenPlatform_Main:
main_flatbed_ferry_green:
;$0E81D1
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.b $02
	LDA.w $70E2,x
	SEC
	SBC.w $6094
	CLC
	ADC.w #$0004
	STA.b $04
	LDA.w $7182,x
	SEC
	SBC.w $609C
	CLC
	ADC.w #$0004
	STA.b $06
	STZ.b $08
	STZ.b $0A
	LDA.w #$0003
	STA.b $0C
	REP.b #$10
	LDY.w $7362,x
CODE_0E8213:
	LDA.b $08
	CLC
	ADC.b $00
	STA.b $08
	CLC
	ADC.w #$0080
	XBA
	AND.w #$00FF
	CMP.w #$0080
	BMI.b CODE_0E822A
	ORA.w #$FF00
CODE_0E822A:
	CLC
	ADC.b $04
	STA.w $6008,y
	LDA.b $0A
	CLC
	ADC.b $02
	STA.b $0A
	CLC
	ADC.w #$0080
	XBA
	AND.w #$00FF
	CMP.w #$0080
	BMI.b CODE_0E8247
	ORA.w #$FF00
CODE_0E8247:
	CLC
	ADC.b $06
	STA.w $600A,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEC.b $0C
	BNE.b CODE_0E8213
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0080
	XBA
	AND.w #$00FF
	CMP.w #$0080
	BMI.b CODE_0E826A
	ORA.w #$FF00
CODE_0E826A:
	CLC
	ADC.b $04
	CLC
	ADC.w #$0004
	STA.w $6010,y
	SEC
	SBC.w #$0010
	STA.w $6008,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w #$0080
	XBA
	AND.w #$00FF
	CMP.w #$0080
	BMI.b CODE_0E828E
	ORA.w #$FF00
CODE_0E828E:
	CLC
	ADC.b $06
	STA.w $600A,y
	STA.w $6012,y
	SEP.b #$10
	JSL.l CODE_03AF23
	LDA.w $7A38,x
	INC
	INC
	STA.w $7A38,x
	CLC
	ADC.w #$0080
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$5800
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0080
	XBA
	AND.w #$00FF
	TAY
	BPL.b CODE_0E82D4
	ORA.w #$FF00
CODE_0E82D4:
	STA.b $08
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w #$0080
	XBA
	AND.w #$00FF
	TAY
	BPL.b CODE_0E82EA
	ORA.w #$FF00
CODE_0E82EA:
	STA.b $0A
	LDY.b $18,x
	BNE.b CODE_0E8314
	LDY.w $60AB
	BMI.b CODE_0E835B
	LDA.b $0A
	CLC
	ADC.w $7182,x
	CLC
	ADC.w #$0004
	SEC
	SBC.w $611E
	SEC
	SBC.w $6112
	BMI.b CODE_0E835B
	SEC
	SBC.w $6122
	CMP.w #$0004
	BMI.b CODE_0E8338
	BRA.b CODE_0E835B

CODE_0E8314:
	LDY.w $60AB
	BMI.b CODE_0E835B
	LDY.w $0D94
	BNE.b CODE_0E835B
	CPX.w $61B6
	BNE.b CODE_0E835B
	LDA.b $08
	SEC
	SBC.b $78,x
	PHA
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	PLA
	CLC
	ADC.w $611C
	STA.w $611C
CODE_0E8338:
	LDA.b $08
	CLC
	ADC.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611C
	BPL.b CODE_0E834E
	CLC
	ADC.w $6120
	BRA.b CODE_0E8352

CODE_0E834E:
	SEC
	SBC.w $6120
CODE_0E8352:
	CLC
	ADC.w #$000E
	CMP.w #$001C
	BCC.b CODE_0E8367
CODE_0E835B:
	CPX.w $61B6
	BNE.b CODE_0E8363
	STZ.w $61B6
CODE_0E8363:
	STZ.b $18,x
	BRA.b CODE_0E838C

CODE_0E8367:
	CPX.w $61B6
	BEQ.b CODE_0E8374
	LDY.w $61B6
	BNE.b CODE_0E8363
	STX.w $61B6
CODE_0E8374:
	LDA.b $0A
	CLC
	ADC.w $7182,x
	CLC
	ADC.w #$FFE4
	SEC
	SBC.w $6112
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC.w $61B4
	LDY.b #$01
	STY.b $18,x
CODE_0E838C:
	LDA.b $08
	STA.b $78,x
	JSL.l CODE_03D127
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0A6: Incoming Chomp (single). Raiden: init_incoming_chomp.
;---------------------------------------------------------------------------
YI_NorSpr0A6_IncomingChomp_Init:
init_incoming_chomp:
;$0E8395
	LDY.w $0073
	BNE.b CODE_0E83AF
	SEP.b #$20
	LDA.b #$40
	STA.w $70E0,x
	REP.b #$20
	BRA.b CODE_0E83CC

;---------------------------------------------------------------------------
; Sprite $0A7: Group of incoming chomps (flock). Raiden: init_incoming_chomp_flock.
;---------------------------------------------------------------------------
YI_NorSpr0A7_GroupOfIncomingChomps_Init:
init_incoming_chomp_flock:
	LDY.w $0073
	BNE.b CODE_0E83AF
	LDY.w $0DC2
	BEQ.b CODE_0E83B3
CODE_0E83AF:
	JML.l CODE_03A31E

CODE_0E83B3:
	INC.w $0DC2
	LDA.w $70E2,x
	AND.w #$FF00
	ORA.w #$0080
	STA.w $0DC4
	LDA.w $70E2,x
	SEC
	SBC.w #$0020
	STA.w $70E2,x
CODE_0E83CC:
	LDA.w !RAM_YI_Global_Layer1XPosLo
	AND.w #$FFF0
	STA.b $00
	LDA.w $70E2,x
	STA.b $18,x
	SEC
	SBC.b $00
	LSR.b $00
	CLC
	ADC.b $00
	STA.w $70E2,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $7182,x
	SEC
	SBC.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w !RAM_YI_Global_Layer2YPosLo
	AND.w #$FFF8
	CLC
	ADC.w #$0012
	LDY.w !RAM_YI_Level_CurrentLevelFromMapLo
	CPY.b #!Define_YI_LevelID_MarchingMildesFort
	BNE.b CODE_0E8406
	SEC
	SBC.w #$0008
	BRA.b CODE_0E8415

CODE_0E8406:
	CPY.b #!Define_YI_LevelID_WatchOutBelow
	BNE.b CODE_0E8415
	LDY.w $70E3,x
	CPY.b #$06
	BNE.b CODE_0E8415
	SEC
	SBC.w #$000A
CODE_0E8415:
	STA.w $7182,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0A7_GroupOfIncomingChomps
	BNE.b CODE_0E842A
	LDA.w $7182,x
	CLC
	ADC.w #$0016
	STA.w $7182,x
CODE_0E842A:
	LDA.w $7182,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	INC.w $74A1,x
	INC.w $74A1,x
;---------------------------------------------------------------------------
; Sprite $0A8: Falling incoming chomp. Raiden: init_incoming_chomp_falling.
;---------------------------------------------------------------------------
YI_NorSpr0A8_FallingIncomingChomp_Init:
init_incoming_chomp_falling:
	LDA.w $7042,x
	AND.w #$FFDF
	STA.w $7042,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; DATA_incoming_chomp_state_ptrs -- Incoming-Chomp per-state pointer table (7 entries).
; Indexed by ASL of $76,x in main_incoming_chomp. Shared by sprites
; $0A6 (IncomingChomp) and $0A8 (FallingIncomingChomp): drives the
; perched / charging / falling / impact / ground-shadow phases.
;---------------------------------------------------------------------------
DATA_incoming_chomp_state_ptrs:
DATA_0E8440:
	dw CODE_0E8515
	dw CODE_0E85B2
	dw CODE_0E85FE
	dw CODE_0E866E
	dw CODE_0E8713
	dw CODE_0E88D7
	dw CODE_0E89DE

DATA_0E844E:
	dw FXDATA_548000+$4000,FXDATA_548000+$4020,FXDATA_548000+$4040,FXDATA_548000+$4020

;---------------------------------------------------------------------------
; Sprites $0A6 / $0A8 main (shared). Raiden: main_incoming_chomp.
;---------------------------------------------------------------------------
YI_NorSpr0A6_IncomingChomp_Main:
YI_NorSpr0A8_FallingIncomingChomp_Main:
main_incoming_chomp:
;$0E8456
	LDY.w $7041,x
	BPL.b CODE_0E8464
	LDA.w $7722,x
	BMI.b CODE_0E8464
	JSL.l CODE_03ABFA
CODE_0E8464:
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_incoming_chomp_state_ptrs,x)
	LDY.b $76,x
	CPY.b #$05
	BMI.b CODE_0E8492
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0E848E
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0E848E
	LDA.w $7D38,y
	BEQ.b CODE_0E848E
	TYX
	JSL.l CODE_03B25B
CODE_0E848E:
	JSL.l CODE_03D127
CODE_0E8492:
	JSR.w CODE_0E84BA
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr0A6_IncomingChomp
	ORA.w $7A38,x
	BNE.b CODE_0E84B9
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.b $18,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_0E84B9
	LDY.b $76,x
	CPY.b #$05
	BPL.b CODE_0E84B9
	INC.w $7A38,x
CODE_0E84B9:
	RTL

CODE_0E84BA:
	LDY.w $7041,x
	BPL.b CODE_0E8510
	LDA.w $7722,x
	BMI.b CODE_0E8510
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0001
	BNE.b CODE_0E8510
CODE_0E84D3:
	LDY.b $77,x
	LDA.w DATA_0E844E,y
	LDY.b #(FXDATA_548000+$4000)>>16
CODE_0E84DA:
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	TYA
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A36,x
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
	LDX.b #FXCODE_088A0F>>16
	LDA.w #FXCODE_088A0F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
CODE_0E8510:
	RTS

DATA_0E8511:
	dw $FFC0,$0040

CODE_0E8515:
	TYX
	STZ.w $7181,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0A6_IncomingChomp
	BEQ.b CODE_0E857C
	LDY.w $0DC0
	BNE.b CODE_0E857C
	LDA.w #$00A8
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0E857C
	TYX
	JSL.l CODE_03ADD0
	BCS.b CODE_0E8546
	JSL.l CODE_03A31E
	LDX.b $12
	RTS

CODE_0E8546:
	TXY
	LDX.b $12
	DEC.w $0DC0
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w $7400,x
	STA.w $7400,y
	SEP.b #$20
	LDA.b #$40
	STA.w $70E0,y
	LDA.b #$02
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D7|!EXRAMBankMirror,y
	STA.w $74A1,y
	REP.b #$20
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w $7042,y
	AND.w #$FFDF
	STA.w $7042,y
CODE_0E857C:
	LDA.w $7AF6,x
	BNE.b CODE_0E85A9
	LDA.b $10
	PHA
	AND.w #$0003
	INC
	STA.b $16,x
	PLA
	XBA
	AND.w #$0002
	CMP.w $7400,x
	BNE.b CODE_0E85A3
	TAY
	LDA.w DATA_0E8511,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FF80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
CODE_0E85A3:
	INC.b $76,x
	LDY.b #$04
	STY.b $77,x
CODE_0E85A9:
	RTS

DATA_0E85AA:
	db $00,$02

DATA_0E85AC:
	db $00,$00

DATA_0E85AE:
	db $00,$01

DATA_0E85B0:
	db $01,$00

CODE_0E85B2:
	TYX
	STZ.w $7181,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A98,x
	BNE.b CODE_0E85FD
	SEP.b #$20
	DEC.b $77,x
	REP.b #$20
	LDY.b $77,x
	BPL.b CODE_0E85E0
	LDY.w $7400,x
	LDA.w DATA_0E8511,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FF80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
	RTS

CODE_0E85E0:
	LDY.b $77,x
	LDA.w DATA_0E85AE,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_0E85AA,y
	AND.w #$00FF
	EOR.w $7400,x
	STA.w $7400,x
	LDA.w #$0006
	STA.w $7A98,x
CODE_0E85FD:
	RTS

CODE_0E85FE:
	TYX
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCC.b CODE_0E8617
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0E8617
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0E8617:
	LDA.w $7182,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_0E866D
	STZ.w $7181,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0A6_IncomingChomp
	BNE.b CODE_0E8652
	LDY.w $7A38,x
	BEQ.b CODE_0E8652
	LDY.w $0DC0
	BNE.b CODE_0E8652
	JSL.l CODE_03ADD0
	BCC.b CODE_0E8652
	DEC.w $0DC0
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w #$0203
	STA.b $76,x
	RTS

CODE_0E8652:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_0E865B
	DEC.b $16,x
	BNE.b CODE_0E8667
CODE_0E865B:
	LDA.w #$0020
	STA.w $7AF6,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $76,x
	RTS

CODE_0E8667:
	LDA.w #$FF80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0E866D:
	RTS

CODE_0E866E:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0E86D2
	SEP.b #$20
	DEC.b $77,x
	REP.b #$20
	LDY.b $77,x
	BPL.b CODE_0E86B5
	JSL.l CODE_03AEFD
	JSL.l CODE_03ADD0
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0A6_IncomingChomp
	BEQ.b CODE_0E8694
	LDA.w #$0040
	STA.w $7AF6,x
CODE_0E8694:
	LDA.w #$0080
	STA.w $7A36,x
	LDA.w #$8081
	STA.w $7040,x
	LDA.w #$0001
	STA.w $7402,x
	JSR.w CODE_0E84D3
	LDA.w #$0007
	STA.w $74A2,x
	LDA.w #$0004
	STA.b $76,x
	RTS

CODE_0E86B5:
	LDY.b $77,x
	LDA.w DATA_0E85B0,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_0E85AC,y
	AND.w #$00FF
	EOR.w $7400,x
	STA.w $7400,x
	LDA.w #$0006
	STA.w $7A98,x
CODE_0E86D2:
	RTS

DATA_0E86D3:
	dw $FFC0,$0000,$0020,$0010,$0040,$0060,$0080,$00A0
	dw $00C0

DATA_0E86E5:
	dw $0018,$0068,$00B8,$0038,$00C8

DATA_0E86EF:
	dw $0000,$0000,$0200,$0202,$0202,$0404,$0404,$0404
	dw $0608,$0606,$0606,$0606,$0806,$0808,$0808,$0808

DATA_0E870F:
	dw $FF00,$0100

CODE_0E8713:
	TYX
	LDA.w $7AF6,x
	BNE.b CODE_0E86D2
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0A6_IncomingChomp
	BNE.b CODE_0E872C
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$00C0
	BRA.b CODE_0E8757

CODE_0E872C:
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7680,x
	SEC
	SBC.w #$0080
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7682,x
	CLC
	ADC.w #$0040
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0B8739>>16
	LDA.w #FXCODE_0B8739
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
CODE_0E8757:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7682,x
	CMP.w #$FFC0
	BMI.b CODE_0E87A8
	LDA.w $7A36,x
	CLC
	ADC.w #$000A
	STA.w $7A36,x
	CMP.w #$0100
	BMI.b CODE_0E878C
	CMP.w #$01FF
	BMI.b CODE_0E877C
	LDA.w #$01FF
	STA.w $7A36,x
CODE_0E877C:
	LDA.w $7042,x
	ORA.w #$0002
	STA.w $7042,x
	SEP.b #$20
	STZ.w $70E0,x
	REP.b #$20
CODE_0E878C:
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0001
	BNE.b CODE_0E87A7
	SEP.b #$20
	LDA.b $77,x
	INC
	INC
	AND.b #$07
	STA.b $77,x
	REP.b #$20
CODE_0E87A7:
	RTS

CODE_0E87A8:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $74A2,x
	LDA.w $70E2,x
	SEC
	SBC.w !RAM_YI_Global_Layer2XPosLo
	CLC
	ADC.w !RAM_YI_Global_Layer1XPosLo
	STA.w $70E2,x
	LDA.w $7182,x
	SEC
	SBC.w !RAM_YI_Global_Layer2YPosLo
	CLC
	ADC.w !RAM_YI_Global_Layer1YPosLo
	STA.w $7182,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0A8_FallingIncomingChomp
	BEQ.b CODE_0E87D8
	JMP.w CODE_0E885B

CODE_0E87D8:
	LDA.w $60A8
	CLC
	ADC.w #$0400
	CMP.w #$0800
	BCC.b CODE_0E87EE
	BPL.b CODE_0E87EB
	LDA.w #$0000
	BRA.b CODE_0E87EE

CODE_0E87EB:
	LDA.w #$0800
CODE_0E87EE:
	AND.w #$FF00
	XBA
	ASL
	TAY
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_0E86D3,y
CODE_0E87FB:
	STA.b $00
	SEC
	SBC.w $70E2,x
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCC.b CODE_0E8813
	SEC
	SBC.w #$0100
	CLC
	ADC.b $00
	BRA.b CODE_0E87FB

CODE_0E8813:
	LDA.b $00
	AND.w #$00F0
	LSR
	LSR
	LSR
	LSR
	LDY.w !RAM_YI_Level_CurrentWorldLo
	BEQ.b CODE_0E8825				; Note: !Define_YI_WorldID_World1
	CPY.b #!Define_YI_WorldID_World6
	BNE.b CODE_0E8829
CODE_0E8825:
	CLC
	ADC.w #$0010
CODE_0E8829:
	TAY
	LDA.w DATA_0E86EF,y
	TAY
	LDA.b $00
	AND.w #$FF00
	ORA.w DATA_0E86E5,y
	STA.w $70E2,x
CODE_0E8839:
	LDY.b #$00
	LDA.w $70E2,x
	SEC
	SBC.w $0DC4
	CLC
	ADC.w #$0100
	CMP.w #$0380
	BCC.b CODE_0E8864
	BPL.b CODE_0E884F
	INY
	INY
CODE_0E884F:
	LDA.w $70E2,x
	CLC
	ADC.w DATA_0E870F,y
	STA.w $70E2,x
	BRA.b CODE_0E8839

CODE_0E885B:
	LDA.b $18,x
	CLC
	ADC.w #$00F8
	STA.w $70E2,x
CODE_0E8864:
	JSL.l CODE_03AEFD
	STZ.w $7402,x
	LDA.w #$0881
	STA.w $7040,x
	LDA.w #$0050
	STA.w $7AF6,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0A6_IncomingChomp
	BNE.b CODE_0E8885
	LDA.w #$0030
	STA.w $7AF6,x
CODE_0E8885:
	STZ.w $7542,x
	STZ.w $75E2,x
	JSR.w CODE_0E8B53
	LDA.w $7042,x
	AND.w #$FFF3
	ORA.w #$0020
	STA.w $7042,x
	SEP.b #$20
	LDA.b #$02
	STA.w $74A2,x
	STZ.w $74A1,x
	REP.b #$20
	LDA.w #$01FF
	STA.w $7A36,x
	STZ.w $7A38,x
	STZ.w $75E0,x
	STZ.b $16,x
	LDA.w #$0018
	STA.w $7BB6,x
	STA.w $7BB8,x
	LDA.w #!Define_YI_SoundID6D_FallingChomp
	JSL.l CODE_push_sound_queue
	INC.b $76,x
	RTS

DATA_0E88C7:
	dw $FFE8,$FFF8,$0008,$0018

DATA_0E88CF:
	dw $FE00,$FF00,$0100,$0200

CODE_0E88D7:
	TYX
	LDA.w $7AF6,x
	BEQ.b CODE_0E88E1
	JSR.w CODE_0E8B53
	RTS

CODE_0E88E1:
	LDY.w $75E0,x
	BNE.b CODE_0E8943
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0A6_IncomingChomp
	BNE.b CODE_0E8943
	LDA.w $7680,x
	CLC
	ADC.w #$0030
	CMP.w #$0160
	BCC.b CODE_0E8943
	LDY.b $78,x
	TYA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.w #$000C
	STA.w $7042,x
	STZ.w $7402,x
	LDA.w #$0881
	STA.w $7040,x
	SEP.b #$20
	LDA.b #$40
	STA.w $70E0,x
	LDA.b #$FF
	STA.w $74A2,x
	LDA.b #$02
	STA.w $74A1,x
	REP.b #$20
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7182,x
	STZ.w $7A38,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w $0DC0
	STZ.b $78,x
	INC.b $76,x
	JSL.l CODE_03AEFD
CODE_0E8942:
	RTS

CODE_0E8943:
	LDA.w #$6C73
	STA.w $6FA0,x
	LDA.w #$0020
	STA.w $7BB6,x
	STA.w $7BB8,x
	LDY.w $7722,x
	BPL.b CODE_0E8975
	JSL.l CODE_03ADD0
	BCC.b CODE_0E8942
	JSR.w CODE_0E84D3
	INC.w $7402,x
	INC.w $7402,x
	LDA.w #$8081
	STA.w $7040,x
	LDA.w #$0800
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $0DC0
CODE_0E8975:
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0001
	BNE.b CODE_0E8990
	SEP.b #$20
	LDA.b $77,x
	INC
	INC
	AND.b #$07
	STA.b $77,x
	REP.b #$20
CODE_0E8990:
	LDA.w $7182,x
	CMP.w #$07FF
	BMI.b CODE_0E899D
	PLA
	JML.l CODE_despawn_sprite_free_slot

CODE_0E899D:
	JSR.w CODE_0E8A3F
	LDY.w $75E0,x
	BEQ.b CODE_0E89DD
	LDY.b $78,x
	BEQ.b CODE_0E89AF
	TYA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	STZ.b $78,x
CODE_0E89AF:
	LDA.w $7974
	AND.w #$0001
	BNE.b CODE_0E89DD
	LDA.b $10
	AND.w #$0006
	TAY
	LDA.w DATA_0E88C7,y
	CLC
	ADC.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	STA.b $02
	LDA.w DATA_0E88CF,y
	STA.b $04
	LDA.w #$FF00
	STA.b $06
	LDA.w #$0010
	STA.b $08
	JSR.w CODE_0E8B1B
CODE_0E89DD:
	RTS

CODE_0E89DE:
	TYX
	LDA.w $70E2,x
	SEC
	SBC.w !RAM_YI_Global_Layer2XPosLo
	CLC
	ADC.w #$0020
	CMP.w #$0140
	BCS.b CODE_0E89FF
	LDA.w $7182,x
	SEC
	SBC.w !RAM_YI_Global_Layer2YPosLo
	CLC
	ADC.w #$0020
	CMP.w #$0140
	BCC.b CODE_0E8A14
CODE_0E89FF:
	SEP.b #$20
	STZ.w $74A2,x
	REP.b #$20
	LDA.w #$0100
	STA.w $75E2,x
	LDA.w #$0008
	STA.w $7542,x
	STZ.b $76,x
CODE_0E8A14:
	RTS

DATA_0E8A15:
	dw DATA_0E8A2F,DATA_0E8A2D,DATA_0E8A2D,DATA_0E8A31

DATA_0E8A1D:
	dw $1C20,$1C22,$1C22,$1C24,$1BF8,$1C04,$1C04,$1BFA

DATA_0E8A2D:
	dw $0000

DATA_0E8A2F:
	dw $007E

DATA_0E8A31:
	dw $007F,$FFE8,$FFF8,$0008,$0018

DATA_0E8A3B:
	dw $0018,$FFF8

CODE_0E8A3F:
	LDA.w $7182,x
	AND.w #$FFF0
	CMP.b $16,x
	BEQ.b CODE_0E8A9F
	LDY.w $75E0,x
	BNE.b CODE_0E8AA0
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w $1C22
	BEQ.b CODE_0E8AA0
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7CD6,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$2A00
	BEQ.b CODE_0E8AA0
	CMP.w #$2A01
	BEQ.b CODE_0E8AA0
	CMP.w #$2A2D
	BEQ.b CODE_0E8AA0
	CMP.w #$2A2E
	BEQ.b CODE_0E8AA0
CODE_0E8A9F:
	RTS

CODE_0E8AA0:
	LDA.w $7182,x
	AND.w #$FFF0
	STA.b $16,x
	LDA.w #$0004
	STA.b $0C
	LDA.w $7A38,x
	AND.w #$0007
	LSR
	TAY
	LDA.w $70E2,x
	SEC
	SBC.w DATA_0E8A3B,y
	STA.b $04
	LDA.w $7182,x
	STA.b $02
	LDY.w $7A38,x
	BNE.b CODE_0E8AD1
	INC.w $75E0,x
	LDA.w #$0050
	STA.w $61C8
CODE_0E8AD1:
	REP.b #$10
	TYA
	AND.w #$00FF
	TAY
	PHX
	LDA.w DATA_0E8A15,y
	TAX
	LDA.w $0000,x
	STA.b $0E
	PLX
	SEP.b #$10
	INY
	INY
	PHY
	LDA.b $04
	STA.w $0091
	LDA.b $02
	STA.w $0093
	LDA.w #$0001
	STA.w $008F
	LDA.b $0E
	STA.w $0095
	JSL.l CODE_change_map16
	PLY
	LDA.b $04
	CLC
	ADC.w #$0010
	STA.b $04
	DEC.b $0C
	BNE.b CODE_0E8AD1
	LDX.b $12
	CPY.b #$18
	BMI.b CODE_0E8B16
	LDY.b #$10
CODE_0E8B16:
	TYA
	STA.w $7A38,x
	RTS

CODE_0E8B1B:
	LDA.w #!Define_YI_AmbSpr1C3
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	STA.w $70A2,y
	LDA.b $02
	STA.w $7142,y
	LDA.b $08
	STA.w $7782,y
	LDA.b $04
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $06
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0007
	STA.w $7E4C,y
	DEC
	STA.w $7502,y
	LDA.w #$0400
	STA.w $75A2,y
	LDA.w #!Define_YI_SoundID0A_BreakDirt
	JSL.l CODE_push_sound_queue
CODE_0E8B52:
	RTS

CODE_0E8B53:
	LDY.w $75E2,x
	BNE.b CODE_0E8B52
	STZ.b $02
	LDA.w $7182,x
	STA.b $00
	LDA.w $70E2,x
	STA.b $04
CODE_0E8B64:
	LDA.b $00
	CLC
	ADC.b $02
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.b $04
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0000
	BNE.b CODE_0E8B8C
	LDA.b $02
	CLC
	ADC.w #$0010
	STA.b $02
	BRA.b CODE_0E8B64

CODE_0E8B8C:
	LDX.b $12
	CMP.w #$2A00
	BEQ.b CODE_0E8BA2
	CMP.w #$2A01
	BEQ.b CODE_0E8BA2
	CMP.w #$2A2D
	BEQ.b CODE_0E8BA2
	CMP.w #$2A2E
	BNE.b CODE_0E8BE0
CODE_0E8BA2:
	LDA.w #$00A9
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0E8BE3
	TYX
	JSL.l CODE_03ADD0
	TXY
	LDX.b $12
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.b $02
	STA.w $7182,y
	LDA.w #$0028
	STA.w $7A98,y
	LDA.w #$0010
	STA.w $7AF6,y
	INC
	STA.w $7AF6,x
	LDA.w #$0100
	STA.w $7A36,y
	LDA.w $0030
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	STY.b $78,x
CODE_0E8BE0:
	INC.w $75E2,x
CODE_0E8BE3:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0A7 main. Raiden: main_incoming_chomp_flock.
;---------------------------------------------------------------------------
YI_NorSpr0A7_GroupOfIncomingChomps_Main:
main_incoming_chomp_flock:
;$0E8BE4
	LDY.b $78,x
	BEQ.b CODE_0E8BEB
	JSR.w CODE_0E8C1C
CODE_0E8BEB:
	JSL.l CODE_03AF23
	LDA.w $7680,x
	CLC
	ADC.w #$00A0
	CMP.w #$0200
	BCC.b CODE_0E8C10
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
	RTL

CODE_0E8C10:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_incoming_chomp_state_ptrs,x)
	JSR.w CODE_0E8C9A
	RTL

CODE_0E8C1C:
	LDY.w $7363,x
	BPL.b CODE_0E8C22
	RTS

CODE_0E8C22:
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $02
	LDY.w $7362,x
	LDX.w #$0006
CODE_0E8C34:
	LDA.w $0DC6,x
	LSR
	LSR
	LSR
	LSR
	AND.w #$00FF
	CMP.w #$0080
	BMI.b CODE_0E8C46
	ORA.w #$FF00
CODE_0E8C46:
	CLC
	ADC.b $00
	SEC
	SBC.w !RAM_YI_Global_Layer2XPosLo
	STA.w $6008,y
	LDA.w $0DCE,x
	LSR
	LSR
	LSR
	LSR
	AND.w #$00FF
	CMP.w #$0080
	BMI.b CODE_0E8C62
	ORA.w #$FF00
CODE_0E8C62:
	CLC
	ADC.b $02
	SEC
	SBC.w !RAM_YI_Global_Layer2YPosLo
	STA.w $600A,y
	LDA.w $0DE7,x
	AND.w #$00FF
	XBA
	LSR
	LSR
	XBA
	STA.b $04
	LDA.w $0DE6,x
	AND.w #$00FF
	ASL
	CLC
	ADC.w $600C,y
	AND.w #$3FFF
	ORA.b $04
	STA.w $600C,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEX
	DEX
	BPL.b CODE_0E8C34
	SEP.b #$10
	LDX.b $12
	RTS

CODE_0E8C9A:
	LDA.b $78,x
	BNE.b CODE_0E8CB8
	INC.b $78,x
	LDX.b #$06
CODE_0E8CA2:
	STA.w $0DC6,x
	STA.w $0DCE,x
	STA.w $0DD6,x
	STA.w $0DDE,x
	STA.w $0DE6,x
	STA.w $0DEE,x
	DEX
	DEX
	BNE.b CODE_0E8CA2
CODE_0E8CB8:
	SEP.b #$20
	LDX.b #$06
CODE_0E8CBC:
	LDY.w !REGISTER_SoftwareLatchForHVCounter
	LDA.w !REGISTER_HCounter
	CLC
	ADC.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	JSR.w CODE_0E8CDB
	JSR.w CODE_0E8CEA
	JSR.w CODE_0E8D9B
	DEX
	DEX
	BPL.b CODE_0E8CBC
	REP.b #$20
	LDX.b $12
	RTS

CODE_0E8CDB:
	LDA.w $0DEF,x
	BEQ.b CODE_0E8CE3
	DEC.w $0DEF,x
CODE_0E8CE3:
	RTS

DATA_0E8CE4:
	dw CODE_0E8CF6
	dw CODE_0E8D2F
	dw CODE_0E8D66

CODE_0E8CEA:
	TXY
	LDA.w $0DDE,x
	ASL
	TAX
	JSR.w (DATA_0E8CE4,x)
	RTS

DATA_0E8CF4:
	db $FC,$04

CODE_0E8CF6:
	TYX
	LDA.w $0DEF,x
	BNE.b CODE_0E8D26
	LDA.b $10
	PHA
	AND.b #$03
	INC
	STA.w $0DEE,x
	PLA
	LSR
	LSR
	AND.b #$01
	CMP.w $0DE7,x
	BNE.b CODE_0E8D1E
	TAY
	LDA.w DATA_0E8CF4,y
	STA.w $0DD6,x
	LDA.b #$F8
	STA.w $0DD7,x
	INC.w $0DDE,x
CODE_0E8D1E:
	INC.w $0DDE,x
	LDA.b #$04
	STA.w $0DDF,x
CODE_0E8D26:
	RTS

DATA_0E8D27:
	dw $0100,$0000

DATA_0E8D2B:
	dw $0100,$0001

CODE_0E8D2F:
	TYX
	LDA.w $0DEF,x
	BNE.b CODE_0E8D65
	DEC.w $0DDF,x
	BPL.b CODE_0E8D4C
	LDY.w $0DE7,x
	LDA.w DATA_0E8CF4,y
	STA.w $0DD6,x
	LDA.b #$F0
	STA.w $0DD7,x
	INC.w $0DDE,x
	RTS

CODE_0E8D4C:
	LDY.w $0DDF,x
	LDA.w DATA_0E8D2B,y
	AND.b #$FF
	STA.w $0DE6,x
	LDA.w DATA_0E8D27,y
	EOR.w $0DE7,x
	STA.w $0DE7,x
	LDA.b #$06
	STA.w $0DEF,x
CODE_0E8D65:
	RTS

CODE_0E8D66:
	TYX
	LDA.w $0DC7,x
	INC
	CMP.b #$02
	BCC.b CODE_0E8D77
	EOR.w $0DD6,x
	BMI.b CODE_0E8D77
	STZ.w $0DD6,x
CODE_0E8D77:
	LDA.w $0DCF,x
	BMI.b CODE_0E8D9A
	LDA.w $0DD6,x
	BEQ.b CODE_0E8D86
	DEC.w $0DEE,x
	BNE.b CODE_0E8D95
CODE_0E8D86:
	LDA.b #$20
	STA.w $0DEF,x
	STZ.w $0DD6,x
	STZ.w $0DDF,x
	STZ.w $0DDE,x
	RTS

CODE_0E8D95:
	LDA.b #$F0
	STA.w $0DD7,x
CODE_0E8D9A:
	RTS

CODE_0E8D9B:
	LDA.w $0DD7,x
	CLC
	ADC.b #$01
	CMP.b #$10
	BMI.b CODE_0E8DA7
	LDA.b #$10
CODE_0E8DA7:
	STA.w $0DD7,x
	LDA.w $0DD6,x
	BPL.b CODE_0E8DBD
	CLC
	ADC.w $0DC6,x
	STA.w $0DC6,x
	LDA.w $0DC7,x
	SBC.b #$00
	BRA.b CODE_0E8DC9

CODE_0E8DBD:
	CLC
	ADC.w $0DC6,x
	STA.w $0DC6,x
	LDA.w $0DC7,x
	ADC.b #$00
CODE_0E8DC9:
	STA.w $0DC7,x
	LDA.w $0DD7,x
	BPL.b CODE_0E8DDF
	CLC
	ADC.w $0DCE,x
	STA.w $0DCE,x
	LDA.w $0DCF,x
	SBC.b #$00
	BRA.b CODE_0E8DEB

CODE_0E8DDF:
	CLC
	ADC.w $0DCE,x
	STA.w $0DCE,x
	LDA.w $0DCF,x
	ADC.b #$00
CODE_0E8DEB:
	BMI.b CODE_0E8DFA
	EOR.w $0DD7,x
	BMI.b CODE_0E8DFA
	STZ.w $0DD7,x
	LDA.b #$00
	STA.w $0DCE,x
CODE_0E8DFA:
	STA.w $0DCF,x
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0A9: Ground shadow projected under a falling incoming chomp.
; Raiden: init_incoming_chomp_falling_shadow.
;---------------------------------------------------------------------------
YI_NorSpr0A9_IncomingChompShadow_Init:
init_incoming_chomp_falling_shadow:
;$0E8DFE
	JSR.w CODE_0E8E6B
	RTL

;---------------------------------------------------------------------------

DATA_0E8E02:
	db $05,$FF

DATA_0E8E04:
	db $0C,$0E,$0A,$0A

;---------------------------------------------------------------------------
; Sprite $0A9 main. Raiden: main_incoming_chomp_falling_shadow.
;---------------------------------------------------------------------------
YI_NorSpr0A9_IncomingChompShadow_Main:
main_incoming_chomp_falling_shadow:
;$0E8E08
	LDY.w $7041,x
	BPL.b CODE_0E8E11
	JSL.l CODE_03ABFA
CODE_0E8E11:
	JSL.l CODE_03AF23
	LDA.w $0030
	CMP.b $18,x
	BEQ.b CODE_0E8E22
	LDA.w #$0004
	STA.w $74A2,x
CODE_0E8E22:
	LDA.b $78,x
	BEQ.b CODE_0E8E3B
	LDY.w $7722,x
	BMI.b CODE_0E8E37
	LDA.w #$0004
	STA.w $7402,x
	LDA.w #$2081
	STA.w $7040,x
CODE_0E8E37:
	JML.l CODE_03A31E

CODE_0E8E3B:
	LDA.w $7AF6,x
	BNE.b CODE_0E8E55
	LDY.w $7722,x
	BMI.b CODE_0E8E6A
	LDA.w #$0004
	STA.w $7402,x
	LDA.w #$2081
	STA.w $7040,x
	JML.l CODE_03AEFD

CODE_0E8E55:
	LDA.w $7A36,x
	CLC
	ADC.w #$0010
	CMP.w #$01FF
	BMI.b CODE_0E8E64
	LDA.w #$01FF
CODE_0E8E64:
	STA.w $7A36,x
	JSR.w CODE_0E8E6B
CODE_0E8E6A:
	RTL

CODE_0E8E6B:
	LDA.w $7A36,x
	AND.w #$00FF
	ASL
	ASL
	XBA
	TAY
	SEP.b #$20
	LDA.w $7042,x
	AND.b #$F1
	ORA.w DATA_0E8E04,y
	STA.w $7042,x
	REP.b #$20
	LDA.w #FXDATA_548000+$60E0
	LDY.b #(FXDATA_548000+$60E0)>>16
	JSR.w CODE_0E84DA
	RTS

;---------------------------------------------------------------------------

DATA_0E8E8D:
	dw $FF80,$0080

;---------------------------------------------------------------------------
; Sprites $0E2 / $0E3: Boo Blah and Boo Blah carrying a Piro Dangle (shared init).
; Raiden: init_boo_blah.
;
; See docs/family-boos.md for the full Boo / ghost family breakdown. BooBlah
; is the cleanest variant encoding in the family: (SpriteID - $0E2) -> {0,1}
; -> ASL^2 -> {0,4} + ceiling-bit {0,1} packs four observable variants
; (floor/ceiling x with/without Piro partner) into one $0E shadow byte.
;---------------------------------------------------------------------------
YI_NorSpr0E2_BooBlah_Init:
YI_NorSpr0E3_BooBlahWithPiroDangle_Init:
init_boo_blah:
;$0E8E91
	LDY.w $7400,x
	LDA.w DATA_0E8E8D,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	LSR
	PHP
	INC
	STA.b $00
	PLP
	BEQ.b CODE_0E8ED4
	LDA.w $7042,x
	EOR.w #$00C0
	STA.w $7042,x
	LDA.w $7182,x
	DEC
	AND.w #$FFF0
	ORA.w #$000F
	STA.w $7182,x
	LDA.w $75E2,x
	EOR.w #$FFFF
	INC
	STA.w $75E2,x
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_0E8ED4:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr0E2_BooBlah
	ASL
	ASL
	PHP
	CLC
	ADC.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	PLP
	BEQ.b CODE_0E8F29
	LDA.w #$0076
	JSL.l CODE_spawn_sprite_active
	BCS.b CODE_0E8EF8
	LDA.w #!Define_YI_NorSpr0E2_BooBlah
	STA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	BRA.b CODE_0E8F29

CODE_0E8EF8:
	STY.b $18,x
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w $7182,y
	LDA.w #$0000
	STA.w $7542,y
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	LDA.w #$0100
	STA.w $7A36,y
	LDA.w #$0005
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
CODE_0E8F29:
	LDY.b #$03
	STY.b $16,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; DATA_boo_blah_state_ptrs -- Boo Blah per-state pointer table (7 entries).
; Indexed by ASL of $76,x in main_boo_blah. Drives the Blah's
; expand/contract pulse and the hit-by-egg / kill paths. Shared by
; sprites $0E2 (BooBlah) and $0E3 (BooBlahWithPiroDangle).
;---------------------------------------------------------------------------
DATA_boo_blah_state_ptrs:
DATA_0E8F2E:
	dw CODE_0E90D8
	dw CODE_0E9138
	dw CODE_0E9194
	dw CODE_0E916E
	dw CODE_0E9194
	dw CODE_0E91E0
	dw CODE_0E9206

DATA_0E8F3C:
	dw $FFFC,$0004,$FFFC

DATA_0E8F42:
	db $00,$04,$08,$04,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00

DATA_0E8F53:
	db $02,$00,$02,$00,$0C,$10,$14,$18,$1C,$08,$1C,$1C,$1C,$00,$00,$00
	db $00

DATA_0E8F64:
	db $04,$04,$04,$04,$06,$07,$08,$09,$0A,$05,$0B,$0B,$0B,$03,$02,$01
	db $00

DATA_0E8F75:
	dw $0000,$000F

;---------------------------------------------------------------------------
; Sprites $0E2 / $0E3 main (shared). Raiden: main_boo_blah.
;---------------------------------------------------------------------------
YI_NorSpr0E2_BooBlah_Main:
YI_NorSpr0E3_BooBlahWithPiroDangle_Main:
main_boo_blah:
;$0E8F79
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_0E8FAB
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0E3_BooBlahWithPiroDangle
	BNE.b CODE_0E8FAB
	LDY.b $18,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CMP.w #$0005
	BMI.b CODE_0E8FAB
	LDA.w #$0040
	STA.w $7542,y
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	ORA.w $7040,y
	STA.w $7040,y
CODE_0E8FAB:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$0002
	TAY
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$0003
	DEC
	STA.b $00
	LDA.w $7182,x
	SEC
	SBC.b $00
	AND.w #$FFF0
	ORA.w DATA_0E8F75,y
	STA.w $7182,x
	JSL.l CODE_03AF23
	JSL.l CODE_03A2F8
	BCC.b CODE_0E8FE5
	LDY.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CPY.b #!Define_YI_NorSpr0E2_BooBlah
	BEQ.b CODE_0E8FE4
	LDA.b $18,x
	TAX
	JSL.l CODE_03A31E
	LDX.b $12
CODE_0E8FE4:
	RTL

CODE_0E8FE5:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0E9002
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0E9002
	LDA.w $7D38,y
	BEQ.b CODE_0E9002
	LDY.b #$02
	STY.b $76,x
	STZ.w $7A98,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0E9002:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_boo_blah_state_ptrs,x)
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$0002
	BEQ.b CODE_0E903E
	AND.w $7860,x
	BNE.b CODE_0E903E
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
CODE_0E903E:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$0004
	BEQ.b CODE_0E90C5
	LDY.w $7402,x
	LDA.w DATA_0E8F53,y
	AND.w #$00FF
	SEC
	SBC.w #$0004
	STA.b $00
	LDA.w DATA_0E8F42,y
	AND.w #$00FF
	EOR.w #$FFFF
	INC
	LDY.w $7042,x
	BPL.b CODE_0E9071
	LDY.w $7400,x
	BNE.b CODE_0E906D
	EOR.w #$FFFF
	INC
CODE_0E906D:
	INY
	INY
	BRA.b CODE_0E907A

CODE_0E9071:
	LDY.w $7400,x
	BEQ.b CODE_0E907A
	EOR.w #$FFFF
	INC
CODE_0E907A:
	CLC
	ADC.w DATA_0E8F3C,y
	LDY.b $18,x
	CLC
	ADC.w $70E2,x
	STA.w $70E2,y
	LDA.w $7A36,y
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	PHX
	PHY
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLY
	PLX
	LDA.b $00
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w #$0008
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$0002
	BEQ.b CODE_0E90BC
	LDA.b $00
	EOR.w #$FFFF
	INC
	STA.b $00
CODE_0E90BC:
	LDA.w $7182,x
	SEC
	SBC.b $00
	STA.w $7182,y
CODE_0E90C5:
	JSR.w CODE_0E9267
	LDY.w $7402,x
	LDA.w DATA_0E8F64,y
	AND.w #$00FF
	STA.b $78,x
	RTL

DATA_0E90D4:
	db $08,$02,$06,$06

CODE_0E90D8:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0E910D
	LDA.w $7402,x
	INC
	AND.w #$0003
	STA.w $7402,x
	TAY
	BNE.b CODE_0E9104
	DEC.b $16,x
	BNE.b CODE_0E9104
	LDY.b #$16
	STY.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID34_BurtJump
	JSL.l CODE_push_sound_queue
	INC.b $76,x
	LDA.w #$0002
	BRA.b CODE_0E910A

CODE_0E9104:
	LDA.w DATA_0E90D4,y
	AND.w #$00FF
CODE_0E910A:
	STA.w $7A98,x
CODE_0E910D:
	RTS

DATA_0E910E:
	db $01,$09,$04,$05,$06,$07,$08,$0B,$0C,$0B,$0A,$0B,$0C,$0B,$0A,$08
	db $07,$06,$05,$04,$09

DATA_0E9123:
	db $02,$02,$02,$02,$02,$02,$08,$04,$04,$04,$04,$04,$04,$04,$04,$08
	db $02,$02,$02,$02,$02

CODE_0E9138:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0E916D
	DEC.b $16,x
	BNE.b CODE_0E9159
	LDY.b #$04
	STY.b $16,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$0002
	EOR.w $7400,x
	TAY
	LDA.w DATA_0E8E8D,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	DEC.b $76,x
	RTS

CODE_0E9159:
	LDY.b $16,x
	LDA.w DATA_0E910E-$01,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_0E9123-$01,y
	AND.w #$00FF
	STA.w $7A98,x
CODE_0E916D:
	RTS

CODE_0E916E:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0E916D
	INC.b $78,x
	LDY.b $78,x
	CPY.b #$04
	BMI.b CODE_0E91CB
	BRA.b CODE_0E91B0

DATA_0E917E:
	db $10,$0F,$0E,$0D,$01,$09,$04,$05,$06,$07,$08

DATA_0E9189:
	db $06,$03,$02,$01,$02,$02,$02,$02,$02,$02,$02

CODE_0E9194:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0E91DF
	DEC.b $78,x
	BPL.b CODE_0E91CB
	LDY.b $76,x
	CPY.b #$02
	BNE.b CODE_0E91C0
	TYA
	STA.w $7A98,x
	INC.b $76,x
	RTS

CODE_0E91AB:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0E91C0
CODE_0E91B0:
	LDY.b #$04
	STY.b $16,x
	LDY.w $7400,x
	LDA.w DATA_0E8E8D,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $76,x
	RTS

CODE_0E91C0:
	LDA.w #$0002
	STA.w $7A98,x
	LDY.b #$06
	STY.b $76,x
	RTS

CODE_0E91CB:
	LDY.b $78,x
	LDA.w DATA_0E917E,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_0E9189,y
	AND.w #$00FF
	STA.w $7A98,x
CODE_0E91DF:
	RTS

CODE_0E91E0:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0E91DF
	DEC.b $78,x
	LDY.b $78,x
	CPY.b #$04
	BPL.b CODE_0E91CB
	BRA.b CODE_0E91AB

DATA_0E91F0:
	dw $F900,$F900,$F900,$F900,$F980,$FA00,$FA80,$FB00
	dw $FC00,$FD00,$FE00

CODE_0E9206:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0E91DF
	INC.b $78,x
	LDY.b $78,x
	CPY.b #$04
	BNE.b CODE_0E921B
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0E91CB
	BRA.b CODE_0E91B0

CODE_0E921B:
	CPY.b #$08
	BMI.b CODE_0E91CB
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0E9244
	LDA.w $7A38,x
	ASL
	TAY
	CPY.b #$15
	BMI.b CODE_0E922F
	LDY.b #$14
CODE_0E922F:
	LDA.w DATA_0E91F0,y
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_0E9244:
	CPY.b #$0B
	BMI.b CODE_0E91CB
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0E9253
	LDA.w #$0008
	STA.w $7A98,x
CODE_0E9253:
	DEC.b $76,x
	RTS

DATA_0E9256:
	db $10,$10,$10,$10,$18,$1C,$1E,$1F,$20,$10,$20,$20,$20,$08,$08,$04
	db $03

CODE_0E9267:
	LDY.w $7402,x
	LDA.w DATA_0E9256,y
	AND.w #$00FF
	SEC
	SBC.w #$0010
	STA.b $00
	LDA.w $6120
	CLC
	ADC.w $7BB6,x
	STA.b $02
	ASL
	STA.b $04
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$0002
	BEQ.b CODE_0E928D
	JMP.w CODE_0E9336

CODE_0E928D:
	LDY.b $76,x
	CPY.b #$02
	BMI.b CODE_0E92BB
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0E92BB
	LDA.w $7C16,x
	CLC
	ADC.b $02
	CMP.b $04
	BCS.b CODE_0E92B7
	LDY.w $60C0
	BEQ.b CODE_0E92FD
	LDY.w $60AB
	BPL.b CODE_0E92FD
	LDA.b $78,x
	STA.w $7A38,x
	LDY.b #$06
	STY.b $76,x
	BRA.b CODE_0E92FD

CODE_0E92B7:
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTS

CODE_0E92BB:
	LDA.w $7C16,x
	CLC
	ADC.b $02
	CMP.b $04
	BCS.b CODE_0E9335
	LDA.w $6122
	EOR.w #$FFFF
	INC
	STA.b $02
	CLC
	ADC.w #$0008
	STA.b $04
	LDA.b $00
	SEC
	SBC.w $7182,x
	CLC
	ADC.w $611E
	CMP.b $02
	BMI.b CODE_0E9335
	CMP.b $04
	BPL.b CODE_0E9324
	LDY.w $60C0
	BEQ.b CODE_0E9335
	LDY.w $60AB
	BMI.b CODE_0E9335
	STZ.w $7A38,x
	LDY.b #$04
	STY.b $76,x
	STZ.w $7A98,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0E92FD:
	LDA.w $7182,x
	SEC
	SBC.b $00
	SEC
	SBC.w $6122
	SEC
	SBC.w $611E
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC
	INC
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $60AA
	STZ.w $60D4
	INC.w $61B4
	RTS

CODE_0E9324:
	SEC
	SBC.b $00
	SEC
	SBC.w #$0010
	SEC
	SBC.w $6122
	BPL.b CODE_0E9335
	JSL.l CODE_03A858
CODE_0E9335:
	RTS

CODE_0E9336:
	LDA.w $7C16,x
	CLC
	ADC.b $02
	CMP.b $04
	BCS.b CODE_0E9363
	LDA.w $6122
	CLC
	ADC.w $7BB8,x
	STA.b $02
	LDA.b $00
	PHA
	LSR
	CLC
	ADC.b $02
	ASL
	STA.b $04
	PLA
	CLC
	ADC.w $7C18,x
	CLC
	ADC.b $02
	CMP.b $04
	BCS.b CODE_0E9363
	JSL.l CODE_03A858
CODE_0E9363:
	RTS

;---------------------------------------------------------------------------

DATA_0E9364:
	dw $FF40,$00C0

DATA_0E9368:
	db $10,$20

DATA_0E936A:
	dw $FFE0,$0130

;---------------------------------------------------------------------------
; Sprite $0E9: 3-pack of wingless Goonies. Raiden: init_flightless_goonie.
;---------------------------------------------------------------------------
YI_NorSpr0E9_3WinglessGoonies_Init:
init_flightless_goonie:
;$0E936E
	INC.b $18,x
	LDA.w #$000C
	STA.w $7402,x
	LDY.b #$04
	STY.b $76,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC
	BEQ.b CODE_0E93E0
	LDA.w #$0002
	STA.b $00
	STA.b $18,x
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	STA.b $04
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	STA.b $06
CODE_0E9399:
	LDY.b $00
	LDA.w DATA_0E9368-$01,y
	AND.w #$00FF
	STA.b $02
	LDA.w #$00E9
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0E93E0
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w $7400,x
	STA.w $7400,y
	LDA.b $02
	STA.w $7A96,y
	LDA.w #$000C
	STA.w $7402,y
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.b $04
	STA.w $7C16,y
	LDA.b $06
	STA.w $7C18,y
	DEC.b $00
	BNE.b CODE_0E9399
CODE_0E93E0:
	BRA.b CODE_0E943B

;---------------------------------------------------------------------------
; Sprite $0E8: Single Goonie. Raiden: init_goonie.
;
; See docs/family-goonies.md for the full Goonie family breakdown (~8 sprites
; including Fat Goonie / Bowling Goonie / Skeleton Goonie tribe -- with the
; $153 self-retag trick that morphs back to $0E8 after spawning a Shy Guy
; passenger, and the $0C7C flock-counter level-edge respawn loop).
;---------------------------------------------------------------------------
YI_NorSpr0E8_Goonie_Init:
init_goonie:
;$0E93E2
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC
	BEQ.b CODE_0E9433
	LDA.w $7182,x
	BIT.w #$0010
	BEQ.b CODE_init_goonie_with_shyguy
	AND.w #$FFE0
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	TAY
	LDA.w DATA_0E936A,y
	STA.w $7A36,x
	LDA.w #$00FF
	STA.w $74A2,x
	LDA.w #$0060
	STA.w $6FA0,x
	LDA.w #$4000
	STA.w $6FA2,x
	LDA.w #$0002
	STA.w $7040,x
	STZ.w $7542,x
	INC.w $7A38,x
	LDY.w $0C7C
	BNE.b CODE_0E942C
	INC.w $0C7C
CODE_0E942C:
	RTL

;---------------------------------------------------------------------------
; Sprite $153: Goonie carrying a Shy Guy. (No Raiden label here -- shares init body.)
;---------------------------------------------------------------------------
YI_NorSpr153_GoonieWithShyGuy_Init:
CODE_init_goonie_with_shyguy:
CODE_0E942D:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC
	BNE.b CODE_0E9463
CODE_0E9433:
	INC.b $18,x
	LDA.w #$0040
	STA.w $7A96,x
CODE_0E943B:
	LDA.w #$000C
	STA.w $7402,x
	LDA.w #$0003
	STA.w $7A98,x
	INC
	STA.b $76,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0841
	STA.w $6FA2,x
	LDA.w #$6C00
	STA.w $6FA0,x
	RTL

CODE_0E9463:
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $70E2,x
	PHA
	SEC
	SBC.w $6094
	STA.b $00
	PLA
	AND.w #$0010
	EOR.w #$0010
	DEC
	EOR.b $00
	BMI.b CODE_0E9496
	LDA.w #$00FF
	STA.w $74A2,x
	LDA.w #$6860
	STA.w $6FA0,x
	LDA.w #$000E
	STA.w $7BB6,x
	STZ.w $7542,x
	LDY.b #$05
	STY.b $76,x
	RTL

CODE_0E9496:
	LDA.b $10
	AND.w #$0001
	CLC
	ADC.w #$0003
	STA.b $16,x
	LDY.w $7400,x
	LDA.w DATA_0E98A5,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w #$0020
	STA.w $75E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr153_GoonieWithShyGuy
	BNE.b CODE_0E94C3
	JSR.w CODE_0E94C4
CODE_0E94C3:
	RTL

CODE_0E94C4:
	TXY
	LDA.w #!Define_YI_NorSpr01E_Shyguy
	JSL.l CODE_03A366
	BCC.b CODE_0E9509
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,y
	LDA.w #$0003
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	ASL
	STA.w $7402,y
	LDA.w $7400,x
	STA.w $7400,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	STY.b $78,x
	LDA.w #$000F
	STA.w $7402,x
	LDY.w $7400,x
	LDA.w DATA_0E98A5,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b #$06
	STY.b $76,x
CODE_0E9509:
	LDA.w #!Define_YI_NorSpr0E8_Goonie
	STA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; DATA_goonie_state_ptrs -- Goonie per-state pointer table (7 entries).
; Indexed by ASL of $76,x in main_goonie. Drives the Goonie flock's
; perch / launch / fly / dive / despawn behaviour; shared by $0E8,
; $0E9, and $153 since all three sprites JSR through this table.
;---------------------------------------------------------------------------
DATA_goonie_state_ptrs:
DATA_0E9510:
	dw CODE_0E98A9
	dw CODE_0E98EF
	dw CODE_0E9939
	dw CODE_0E995F
	dw CODE_0E999B
	dw CODE_0E99D0
	dw CODE_0E9A2F

;---------------------------------------------------------------------------
; Sprites $0E8 / $0E9 / $153 main (shared). Raiden: main_goonie.
;---------------------------------------------------------------------------
YI_NorSpr0E8_Goonie_Main:
YI_NorSpr0E9_3WinglessGoonies_Main:
YI_NorSpr153_GoonieWithShyGuy_Main:
main_goonie:
;$0E951E
	LDY.w $7A38,x
	BNE.b CODE_0E9561
	LDA.w $7D96,x
	BEQ.b CODE_0E952B
	STZ.w $6FA2,x
CODE_0E952B:
	LDY.b $76,x
	CPY.b #$05
	BNE.b CODE_0E9537
	JSL.l CODE_03AF23
	BRA.b CODE_0E9541

CODE_0E9537:
	JSR.w CODE_0E95AE
	JSL.l CODE_03AF23
	JSR.w CODE_0E971F
CODE_0E9541:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_goonie_state_ptrs,x)
	LDY.b $76,x
	CPY.b #$04
	BEQ.b CODE_0E9557
	CPY.b #$05
	BEQ.b CODE_0E9560
	JSR.w CODE_0E9638
	RTL

CODE_0E9557:
	LDA.w $7AF8,x
	BNE.b CODE_0E9560
	JSL.l CODE_0DC0F0
CODE_0E9560:
	RTL

CODE_0E9561:
	JSL.l CODE_03AF23
	LDY.w $0C7C
	BEQ.b CODE_0E9576
	LDA.w $7682,x
	CLC
	ADC.w #$0040
	CMP.w #$0160
	BCC.b CODE_0E957A
CODE_0E9576:
	JML.l CODE_03A31E

CODE_0E957A:
	LDA.w $7A96,x
	BNE.b CODE_0E95AD
	LDA.w #$00E8
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0E95AD
	LDA.w $6094
	AND.w #$FFEF
	CLC
	ADC.w $7A36,x
	STA.w $70E2,y
	AND.w #$0010
	LSR
	LSR
	LSR
	EOR.w #$0002
	STA.w $7400,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7182,y
	LDA.w #$0100
	STA.w $7A96,x
CODE_0E95AD:
	RTL

CODE_0E95AE:
	LDY.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CPY.b #$10
	BNE.b CODE_0E95B6
	RTS

CODE_0E95B6:
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	CPY.b #$08
	BNE.b CODE_0E9637
	LDY.b $78,x
	BEQ.b CODE_0E95D2
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STZ.b $78,x
CODE_0E95D2:
	LDY.b $18,x
	BNE.b CODE_0E95FD
	INC.b $18,x
	LDA.w #!Define_YI_AmbSpr1FF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$FFFF
	STA.w $7782,y
	LDA.w #$00C0
	STA.w $7E8E,y
	LDA.w #$0020
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
CODE_0E95FD:
	LDY.w $74A2,x
	BPL.b CODE_0E9608
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_0E9608:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr155_FatGoonie
	BEQ.b CODE_0E9615
	CMP.w #!Define_YI_NorSpr158_BowlingGoonie
	BNE.b CODE_0E9623
CODE_0E9615:
	JSR.w CODE_0E9DC0
	LDA.w #$74A2
	PHA
	LDY.b #$01
	LDA.w #$0843
	BRA.b CODE_0E962C

CODE_0E9623:
	LDA.w #$6C00
	PHA
	LDY.b #$0C
	LDA.w #$0841
CODE_0E962C:
	STA.w $6FA2,x
	TYA
	STA.w $7402,x
	PLA
	STA.w $6FA0,x
CODE_0E9637:
	RTS

CODE_0E9638:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_0E9650

CODE_0E9647:
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_0E9650:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_0E9637
	BEQ.b CODE_0E9637
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0E9647
	LDA.w $7D38,y
	BEQ.b CODE_0E9647
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_0E967A
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BCS.b CODE_0E967A
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	BNE.b CODE_0E9647
	BRA.b CODE_0E9687

CODE_0E967A:
	LDA.w $6FA2,y
	AND.w #$4000
	BNE.b CODE_0E9647
	TYX
	JSL.l CODE_03B25B
CODE_0E9687:
	JSR.w CODE_0E9885
	INC.b $18,x
	LDY.b $78,x
	BEQ.b CODE_0E9698
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STZ.b $78,x
CODE_0E9698:
	LDA.w $7CD6,x
	STA.b $00
	LDA.w $7CD8,x
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1E7
	JSL.l CODE_spawn_ambient_stomp_puff_common
	LDA.w #!Define_YI_SoundID0B_ShellHit1
	JSL.l CODE_push_sound_queue
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0E8_Goonie
	BEQ.b CODE_0E96F8
	CMP.w #!Define_YI_NorSpr153_GoonieWithShyGuy
	BEQ.b CODE_0E96F8
	LDA.w #$0001
	STA.w $7402,x
	LDY.b #$0A
	STY.b $76,x
	LDA.w #$0843
	STA.w $6FA2,x
	LDA.w #$7CA2
	STA.w $6FA0,x
	LDY.w $7400,x
	LDA.w DATA_0E9A97,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0100
	STA.w $7A36,x
	RTS

CODE_0E96F8:
	LDA.w #$000C
	STA.w $7402,x
	LDA.w #$0040
	STA.w $7A96,x
	LDA.w #$0010
	STA.w $7AF8,x
	LDY.b #$04
	STY.b $76,x
	LDA.w #$0841
	STA.w $6FA2,x
	LDA.w #$6C00
	STA.w $6FA0,x
CODE_0E971A:
	RTS

DATA_0E971B:
	dw $FF80,$0080

CODE_0E971F:
	LDA.w #$6C20
	LDY.b $76,x
	CPY.b #$04
	BNE.b CODE_0E972B
	LDA.w #$6C00
CODE_0E972B:
	STA.w $6FA0,x
	CPX.w $61B6
	BNE.b CODE_0E9736
	STZ.w $61B6
CODE_0E9736:
	LDA.w $7AF6,x
	BNE.b CODE_0E971A
	LDY.b $76,x
	CPY.b #$03
	BNE.b CODE_0E974A
	LDA.w #$6C60
	STA.w $6FA0,x
	JMP.w CODE_0E97D0

CODE_0E974A:
	JSR.w CODE_0E985E
	BCS.b CODE_0E97B4
	LDA.w $7C18,x
	SEC
	SBC.b $02
	CMP.w #$FFF6
	BCC.b CODE_0E97CB
	STA.b $00
	LDY.b $76,x
	CPY.b #$04
	BEQ.b CODE_0E97B5
	LDY.w $61B6
	BNE.b CODE_0E97B4
	LDA.w $60AA
	BMI.b CODE_0E97B4
	CMP.w #$8000
	ROR
	CMP.w #$0180
	BMI.b CODE_0E9778
	LDA.w #$0180
CODE_0E9778:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7402,x
	LDA.w #$0008
	STA.w $7A98,x
	ASL
	STA.w $75E2,x
	LDY.w $7400,x
	LDA.w DATA_0E971B,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b #$03
	STY.b $76,x
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	ADC.b $00
	INC
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60AA
	STZ.w $60C0
	STZ.w $60D4
	INC.w $61B4
	STX.w $61B6
	LDA.w #$6C60
	STA.w $6FA0,x
CODE_0E97B4:
	RTS

CODE_0E97B5:
	LDX.b $12
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FC00
	STA.w $60AA
	PLA
	JML.l CODE_03B51F

CODE_0E97CB:
	JSL.l CODE_03A858
	RTS

CODE_0E97D0:
	LDA.w $60FC
	AND.w #$001F
	BNE.b CODE_0E97EC
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C2,x
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $7C18,x
	SEC
	SBC.w $72C2,x
	STA.w $7C18,x
CODE_0E97EC:
	LDA.w $60FC
	AND.w #$01E0
	BEQ.b CODE_0E97FD
	AND.w #$0180
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0E9811
CODE_0E97FD:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C0,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $7C16,x
	SEC
	SBC.w $72C0,x
	STA.w $7C16,x
CODE_0E9811:
	JSR.w CODE_0E985E
	BCS.b CODE_0E983D
	LDY.w $61B6
	BNE.b CODE_0E983D
	LDA.w $7C18,x
	SEC
	SBC.b $02
	CMP.w #$FFF6
	BCC.b CODE_0E983D
	LDY.w $60AB
	BMI.b CODE_0E983D
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60AA
	INC.w $61B4
	STX.w $61B6
	RTS

CODE_0E983D:
	LDA.b $10
	AND.w #$0001
	CLC
	ADC.w #$0005
	STA.b $16,x
	LDY.w $7400,x
	LDA.w DATA_0E9364,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0008
	STA.w $7AF6,x
	ASL
	STA.w $7542,x
	STZ.b $76,x
	RTS

CODE_0E985E:
	LDA.w $6120
	CLC
	ADC.w $7BB6,x
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7C16,x
	CMP.b $00
	BCS.b CODE_0E9884
	LDA.w $6122
	CLC
	ADC.w $7BB8,x
	STA.b $02
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7C18,x
	CMP.b $00
CODE_0E9884:
	RTS

CODE_0E9885:
	LDA.w #!Define_YI_AmbSpr211
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.w $7CD8,x
	STA.w $7142,y
	LDA.w #$0017
	STA.w $73C2,y
	LDA.w #$0001
	STA.w $7782,y
	RTS

DATA_0E98A5:
	dw $FF00,$0100

CODE_0E98A9:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0E98EE
	LDY.w $7402,x
	INY
	CPY.b #$09
	BMI.b CODE_0E98D3
	DEC.b $16,x
	BNE.b CODE_0E98D1
	LDA.b $10
	AND.w #$0001
	CLC
	ADC.w #$0003
	STA.b $16,x
	LDY.w $7400,x
	LDA.w DATA_0E98A5,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
CODE_0E98D1:
	LDY.b #$00
CODE_0E98D3:
	TYA
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w #$0020
	CPY.b #$02
	BMI.b CODE_0E98EB
	CPY.b #$06
	BPL.b CODE_0E98EB
	LDA.w #$FD80
CODE_0E98EB:
	STA.w $75E2,x
CODE_0E98EE:
	RTS

CODE_0E98EF:
	TYX
	LDA.w #$0100
	STA.w $75E2,x
	LDA.w $7A98,x
	BNE.b CODE_0E9938
	LDY.w $7402,x
	BNE.b CODE_0E990A
	LDA.w #$0003
	STA.w $7A98,x
	INC.w $7402,x
	RTS

CODE_0E990A:
	CPY.b #$01
	BNE.b CODE_0E9910
	LDY.b #$08
CODE_0E9910:
	CPY.b #$09
	BNE.b CODE_0E9927
	DEC.b $16,x
	BNE.b CODE_0E9927
	LDA.w #$0001
	STA.w $7402,x
	LDA.w #$0003
	STA.w $7A98,x
	INC.b $76,x
	RTS

CODE_0E9927:
	INY
	CPY.b #$0C
	BMI.b CODE_0E992E
	LDY.b #$09
CODE_0E992E:
	TYA
	STA.w $7402,x
	LDA.w #$0005
	STA.w $7A98,x
CODE_0E9938:
	RTS

CODE_0E9939:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0E995E
	LDA.w #$0004
	STA.w $7A98,x
	LDA.b $10
	AND.w #$0001
	CLC
	ADC.w #$0006
	STA.b $16,x
	STZ.w $7402,x
	LDY.w $7400,x
	LDA.w DATA_0E9364,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $76,x
CODE_0E995E:
	RTS

CODE_0E995F:
	TYX
	LDA.w #$0010
	LDY.w $7223,x
	BPL.b CODE_0E996B
	LDA.w #$0040
CODE_0E996B:
	STA.w $7542,x
	LDA.w $75E2,x
	DEC
	CMP.w #$FFE0
	BPL.b CODE_0E997A
	LDA.w #$FFE0
CODE_0E997A:
	STA.w $75E2,x
	LDA.w $7A98,x
	BNE.b CODE_0E9996
	LDY.w $7402,x
	INY
	CPY.b #$09
	BMI.b CODE_0E998C
	LDY.b #$00
CODE_0E998C:
	TYA
	STA.w $7402,x
	LDA.w #$0001
	STA.w $7A98,x
CODE_0E9996:
	RTS

DATA_0E9997:
	dw $FE00,$0200

CODE_0E999B:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0E99CF
	LDY.w $7400,x
	LDA.w DATA_0E9997,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0841
	STA.w $6FA2,x
	LDA.w $7A98,x
	BNE.b CODE_0E99CF
	LDA.w #$0002
	STA.w $7A98,x
	LDY.w $7402,x
	INY
	CPY.b #$0F
	BMI.b CODE_0E99CB
	LDY.b #$0C
CODE_0E99CB:
	TYA
	STA.w $7402,x
CODE_0E99CF:
	RTS

CODE_0E99D0:
	TYX
	LDA.w $7680,x
	CLC
	ADC.w #$0020
	CMP.w #$0140
	BCC.b CODE_0E9A2E
	LDA.w $70E2,x
	AND.w #$0010
	DEC
	EOR.w $7680,x
	BPL.b CODE_0E9A2E
	LDA.w #$0005
	STA.w $74A2,x
	LDA.w #$6800
	STA.w $6FA0,x
	LDA.w #$0010
	STA.w $7542,x
	LDA.b $10
	AND.w #$0001
	CLC
	ADC.w #$0003
	STA.b $16,x
	LDY.w $77C2,x
	TYA
	STA.w $7400,x
	LDA.w DATA_0E98A5,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w #$0020
	STA.w $75E2,x
	LDY.b #$01
	STY.b $76,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr153_GoonieWithShyGuy
	BNE.b CODE_0E9A2E
	JSR.w CODE_0E94C4
CODE_0E9A2E:
	RTS

CODE_0E9A2F:
	TYX
	LDY.b $78,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0E9A64
	LDA.w $7D96,y
	BNE.b CODE_0E9A64
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CMP.w #$0003
	BNE.b CODE_0E9A64
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $7C16,x
	CLC
	ADC.w #$0038
	CMP.w #$0070
	BCS.b CODE_0E9A6C
	LDA.w $7C18,x
	BPL.b CODE_0E9A6C
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
CODE_0E9A64:
	STZ.w $7402,x
	STZ.b $78,x
	STZ.b $76,x
	RTS

CODE_0E9A6C:
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,y
	LDA.w $7A98,x
	BNE.b CODE_0E9A96
	LDA.w #$0005
	STA.w $7A98,x
	LDA.w $7402,x
	INC
	CMP.w #$0012
	BMI.b CODE_0E9A93
	LDA.w #$000F
CODE_0E9A93:
	STA.w $7402,x
CODE_0E9A96:
	RTS

;---------------------------------------------------------------------------

DATA_0E9A97:
	dw $FF40,$00C0

;---------------------------------------------------------------------------
; Sprite $155: Fat Goonie. Raiden: init_fat_goonie.
;---------------------------------------------------------------------------
YI_NorSpr155_FatGoonie_Init:
init_fat_goonie:
;$0E9A9B
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC
	BNE.b CODE_0E9ACD
;---------------------------------------------------------------------------
; Sprite $158: Bowling Goonie (carries Bowling Ball). Raiden: init_bowling_goonie.
;---------------------------------------------------------------------------
YI_NorSpr158_BowlingGoonie_Init:
init_bowling_goonie:
	INC.b $18,x
	INC.w $7402,x
	LDY.b #$0A
	STY.b $76,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0843
	STA.w $6FA2,x
	LDA.w #$74A2
	STA.w $6FA0,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $7400,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BRA.b CODE_0E9B01

CODE_0E9ACD:
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $70E2,x
	PHA
	SEC
	SBC.w $6094
	STA.b $00
	PLA
	AND.w #$0010
	EOR.w #$0010
	SEC
	SBC.w #$0010
	EOR.b $00
	BPL.b CODE_0E9AF4
	LDA.b $00
	CLC
	ADC.w #$0010
	CMP.w #$0120
	BCS.b CODE_0E9B01
CODE_0E9AF4:
	LDA.w #$00FF
	STA.w $74A2,x
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	RTL

CODE_0E9B01:
	JSL.l CODE_03AE60
	LDY.w $7400,x
	LDA.w DATA_0E9A97,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0100
	STA.w $7A36,x
	LDA.w #$0005
	STA.w $74A2,x
	JSR.w CODE_0E9DC0
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; DATA_fat_goonie_state_ptrs -- Fat Goonie / Bowling Goonie per-state pointer table
; (11 entries, indexed by ASL of $76,x in main_fat_goonie). Drives the
; perch / drop-shy-guy / fly / dive cycle. Shared by $155 (FatGoonie)
; and $158 (BowlingGoonie). Note entries 4-6 alias entries 1-3 (the
; bowling-variant uses the same handlers but enters them via a different
; trigger path).
;---------------------------------------------------------------------------
DATA_fat_goonie_state_ptrs:
DATA_0E9B1E:
	dw CODE_0E9FA6
	dw CODE_0E9FFE
	dw CODE_0EA01A
	dw CODE_0EA06E
	dw CODE_0E9FFE
	dw CODE_0EA01A
	dw CODE_0EA06E
	dw CODE_0EA086
	dw CODE_0EA09C
	dw CODE_0EA0DD
	dw CODE_0EA0F7

DATA_0E9B34:
	dw $74A2,$7442

;---------------------------------------------------------------------------
; Sprites $155 / $158 main (shared). Raiden: main_fat_goonie.
;---------------------------------------------------------------------------
YI_NorSpr155_FatGoonie_Main:
YI_NorSpr158_BowlingGoonie_Main:
main_fat_goonie:
;$0E9B38
	JSR.w CODE_0E9CED
	JSR.w CODE_0E95AE
	LDA.w $7D96,x
	BEQ.b CODE_0E9B46
	STZ.w $6FA2,x
CODE_0E9B46:
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_fat_goonie_state_ptrs,x)
	LDY.w $7402,x
	BNE.b CODE_0E9B5A
	JSR.w CODE_0E9638
CODE_0E9B5A:
	JSR.w CODE_0E9DC0
	LDA.w $61B4
	STA.b $00
	LDY.w $7402,x
	BNE.b CODE_0E9B6E
	JSR.w CODE_0E9E86
	JSR.w CODE_0E9F2D
	RTL

CODE_0E9B6E:
	JSL.l CODE_05E379
	JSL.l CODE_03A5B7
	LDY.b #$00
	LDA.w $61B4
	CMP.b $00
	BEQ.b CODE_0E9B81
	INY
	INY
CODE_0E9B81:
	LDA.w DATA_0E9B34,y
	STA.w $6FA0,x
	LDA.w #$0008
	STA.w $7B56,x
	STA.w $7B58,x
	RTL

DATA_0E9B91:
	dw DATA_0E9BA5,DATA_0E9BC3,DATA_0E9BE1,DATA_0E9BFF,DATA_0E9C1D,DATA_0E9C3B,DATA_0E9C59,DATA_0E9C77
	dw DATA_0E9C95,DATA_0E9CB3

DATA_0E9BA5:
	dw $ED0E,$0005,$0E02,$07FD,$0000,$E610,$000D,$F400
	dw $05ED,$0240,$FDFC,$4007,$FA00,$0DE6,$0040

DATA_0E9BC3:
	dw $F510,$0008,$1502,$0DF0,$0000,$F015,$000D,$F200
	dw $08F5,$0240,$F0F5,$400D,$F500,$0DF0,$0040

DATA_0E9BE1:
	dw $FD10,$000A,$1002,$0AFD,$0000,$0510,$001A,$F200
	dw $0AFD,$0240,$FDFA,$400A,$FA00,$1A05,$0040

DATA_0E9BFF:
	dw $0610,$000C,$1002,$0C06,$0000,$0610,$000C,$F200
	dw $0C06,$0240,$06FA,$400C,$FA00,$0C0E,$0040

DATA_0E9C1D:
	dw $0810,$0017,$1000,$1708,$0000,$1010,$000E,$FA02
	dw $1708,$0040,$08FA,$4017,$F200,$0E10,$0240

DATA_0E9C3B:
	dw $0710,$8008,$1502,$0D14,$0080,$1415,$800D,$F200
	dw $0807,$02C0,$14F5,$C00D,$F500,$0D14,$00C0

DATA_0E9C59:
	dw $FF10,$800A,$1002,$0A07,$0080,$FF10,$801A,$F200
	dw $0AFF,$02C0,$07FA,$C00A,$FA00,$1AFF,$00C0

DATA_0E9C77:
	dw $F60F,$800C,$0F02,$0CFE,$0080,$F60F,$801C,$F300
	dw $0CF6,$02C0,$FEFB,$C00C,$FB00,$1CF6,$00C0

DATA_0E9C95:
	dw $FE0F,$8017,$0F00,$17FE,$0080,$EE0F,$800E,$FB02
	dw $17FE,$00C0,$FEFB,$C017,$F300,$0EEE,$02C0

DATA_0E9CB3:
	dw $F510,$0008,$1502,$0DF0,$0000,$F015,$000D,$F200
	dw $08F5,$0240,$F0F5,$400D,$F500,$0DF0,$0040

DATA_0E9CD1:
	dw $FD08,$FDFA,$FDF8,$FD06

DATA_0E9CD9:
	dw $0000,$0000,$0000,$0010,$FFF0

DATA_0E9CE3:
	dw $0000,$0010,$FFF0,$0000,$0000

CODE_0E9CED:
	LDY.w $74A2,x
	BPL.b CODE_0E9CF3
	RTS

CODE_0E9CF3:
	LDY.w $7402,x
	BEQ.b CODE_0E9CFB
	JMP.w CODE_0E9D8B

CODE_0E9CFB:
	LDA.w $7680,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7682,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7A36,x
	STA.w $604C
	CMP.w #$0100
	BPL.b CODE_0E9D1C
	ASL
	EOR.w #$FFFF
	CLC
	ADC.w #$0301
	BRA.b CODE_0E9D3E

CODE_0E9D1C:
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0140
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w #$FF00
	EOR.w #$FFFF
	INC
CODE_0E9D3E:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.b $79,x
	TYA
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w $7400,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #DATA_0E9CD1>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_0E9CD1
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_0E9B91
	STA.w $6000
	LDY.b $78,x
	LDA.w DATA_0E9CD9,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w DATA_0E9CE3,y
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_0B8751>>16
	LDA.w #FXCODE_0B8751
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0018
	TAY
	JSL.l CODE_03AA60
	RTS

CODE_0E9D8B:
	JSL.l CODE_03AA52
	REP.b #$10
	LDY.w $7362,x
	LDA.w #$8000
	STA.w $6020,y
	STA.w $6028,y
	STA.w $6030,y
	STA.w $6038,y
	STA.w $6040,y
	STA.w $6048,y
	SEP.b #$10
	RTS

DATA_0E9DAC:
	dw $0000,$0010,$0010,$0004,$001C

DATA_0E9DB6:
	dw $0000,$0004,$001C,$0010,$0010

CODE_0E9DC0:
	LDY.w $7402,x
	BEQ.b CODE_0E9DC8
	JMP.w CODE_0E9E4C

CODE_0E9DC8:
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	CMP.w #$0100
	BPL.b CODE_0E9DDD
	ASL
	EOR.w #$FFFF
	CLC
	ADC.w #$0301
	BRA.b CODE_0E9DFF

CODE_0E9DDD:
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0140
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w #$FF00
	EOR.w #$FFFF
	INC
CODE_0E9DFF:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #(FXDATA_540000+$2081)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_540000+$2081
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDY.b $78,x
	LDA.w DATA_0E9DAC,y
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w DATA_0E9DB6,y
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDY.w $7400,x
	BEQ.b CODE_0E9E2B
	LDA.w #$0020
	SEC
	SBC.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
CODE_0E9E2B:
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

CODE_0E9E4C:
	LDA.w #(FXDATA_540000+$2081)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_540000+$2081
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
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
	RTS

CODE_0E9E86:
	LDA.w $7BB6,x
	CLC
	ADC.w $6120
	STA.b $00
	ASL
	STA.b $02
	LDA.w $7BB8,x
	CLC
	ADC.w $6122
	STA.b $04
	ASL
	STA.b $06
	LDY.w $7A38,x
	BEQ.b CODE_0E9EA6
	JMP.w CODE_0E9EFA

CODE_0E9EA6:
	LDA.w $7C16,x
	CLC
	ADC.b $00
	CMP.b $02
	BCS.b CODE_0E9EF9
	LDA.w $7C18,x
	CLC
	ADC.b $04
	SEC
	SBC.b $06
	BCS.b CODE_0E9EF9
	CMP.w #$FFF8
	BCC.b CODE_0E9EF5
	LDY.w $60C0
	BEQ.b CODE_0E9ECA
	LDY.w $60AB
	BMI.b CODE_0E9EF9
CODE_0E9ECA:
	LDA.w $7CD8,x
	SEC
	SBC.b $04
	SEC
	SBC.w $611E
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$0001
	STA.w $7A38,x
	STZ.w $60AA
	STZ.w $60C0
	STZ.w $60D4
	INC.w $61B4
	LDA.w #$7460
	STA.w $6FA0,x
	RTS

CODE_0E9EF5:
	JSL.l CODE_03A858
CODE_0E9EF9:
	RTS

CODE_0E9EFA:
	STZ.w $7A38,x
	LDA.w #$7400
	STA.w $6FA0,x
	LDA.w $7C16,x
	CLC
	ADC.b $00
	CMP.b $02
	BCS.b CODE_0E9EF9
	LDY.w $60C0
	BEQ.b CODE_0E9F17
	LDY.w $60AB
	BMI.b CODE_0E9EF9
CODE_0E9F17:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C0,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C2,x
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	BRA.b CODE_0E9ECA

CODE_0E9F2D:
	LDA.w #$000C
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.b $78,x
	CPY.b #$06
	BPL.b CODE_0E9F75
	CPY.b #$02
	BNE.b CODE_0E9F57
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w #$0004
	BRA.b CODE_0E9F5E

CODE_0E9F57:
	LDA.w #$0014
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
CODE_0E9F5E:
	STA.b $00
	LDY.w $7A38,x
	BEQ.b CODE_0E9F70
	SEC
	SBC.w $7B58,x
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_0E9F70:
	LDA.b $00
	STA.w $7B58,x
CODE_0E9F75:
	LDY.w $7A38,x
	BEQ.b CODE_0E9F88
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w $7BB8,x
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_0E9F88:
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $7BB8,x
	RTS

DATA_0E9F8F:
	db $04,$02,$04,$08,$04,$02,$04,$06,$04,$02,$04,$02,$04

DATA_0E9F9C:
	db $02,$04,$04,$00,$01,$00,$07,$00,$07,$00

CODE_0E9FA6:
	TYX
	LDA.w $7860,x
	AND.w #$000F
	BEQ.b CODE_0E9FC9
	TAY
	LDA.w DATA_0E9F8F-$01,y
	TAY
	STY.b $78,x
	LDA.w DATA_0E9F9C,y
	STA.b $76,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDY.b #$09
	STY.b $79,x
	RTS

CODE_0E9FC9:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CMP.w #$0100
	BMI.b CODE_0E9FE1
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	STZ.b $79,x
	BRA.b CODE_0E9FF8

CODE_0E9FE1:
	JSR.w CODE_0EA11D
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CMP.w #$FF00
	BMI.b CODE_0E9FF8
	LDA.w #$0008
	STA.w $7542,x
	LDA.w #$0100
	STA.w $75E2,x
CODE_0E9FF8:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.b $16,x
	RTS

CODE_0E9FFE:
	TYX
	LDA.w $7A36,x
	SEC
	SBC.w #$0004
	CMP.w #$00D0
	BPL.b CODE_0EA016
	LDA.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $76,x
	LDA.w #$00D0
CODE_0EA016:
	STA.w $7A36,x
	RTS

CODE_0EA01A:
	TYX
	LDA.w $7A36,x
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w #$0100
	BMI.b CODE_0EA06A
	PHA
	LDA.w #!Define_YI_SoundID03_Swim
	JSL.l CODE_push_sound_queue
	LDY.b $76,x
	CPY.b #$02
	BNE.b CODE_0EA053
	LDY.w $7223,x
	BMI.b CODE_0EA050
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0200
	STA.w $75E2,x
	LDA.w #$0020
	STA.w $7542,x
	LSR
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_0EA050:
	JSR.w CODE_0EA11D
CODE_0EA053:
	LDA.w #$0020
	STA.w $7542,x
	LDY.w $7400,x
	LDA.w DATA_0E9A97,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLA
	CMP.w #$0140
	BMI.b CODE_0EA06A
	INC.b $76,x
CODE_0EA06A:
	STA.w $7A36,x
	RTS

CODE_0EA06E:
	TYX
	LDA.w $7A36,x
	SEC
	SBC.w #$0008
	CMP.w #$0100
	BPL.b CODE_0EA080
	STZ.b $76,x
	LDA.w #$0100
CODE_0EA080:
	STA.w $7A36,x
	JMP.w CODE_0EA11D

CODE_0EA086:
	TYX
	LDA.w $7A36,x
	CLC
	ADC.w #$0008
	CMP.w #$0140
	BMI.b CODE_0EA098
	INC.b $76,x
	LDA.w #$0140
CODE_0EA098:
	STA.w $7A36,x
	RTS

CODE_0EA09C:
	TYX
	LDA.w $7A36,x
	SEC
	SBC.w #$0004
	CMP.w #$0100
	BPL.b CODE_0EA0D2
	LDY.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_0EA0D2
	PHA
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_0E9A97,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $16,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7542,x
	LDA.w #!Define_YI_SoundID03_Swim
	JSL.l CODE_push_sound_queue
	PLA
CODE_0EA0D2:
	CMP.w #$00E8
	BPL.b CODE_0EA0D9
	INC.b $76,x
CODE_0EA0D9:
	STA.w $7A36,x
	RTS

CODE_0EA0DD:
	TYX
	LDA.w $7A36,x
	CLC
	ADC.w #$0004
	CMP.w #$0100
	BMI.b CODE_0EA0EF
	STZ.b $76,x
	LDA.w #$0100
CODE_0EA0EF:
	STA.w $7A36,x
	RTS

DATA_0EA0F3:
	dw $0004,$FFFC

CODE_0EA0F7:
	TYX
	LDY.b $19,x
	LDA.w $7A38,x
	CLC
	ADC.w DATA_0EA0F3,y
	AND.w #$01FE
	STA.w $7A38,x
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_0EA11C
	LDA.b $19,x
	EOR.w #$0002
	STA.b $19,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7400,x
CODE_0EA11C:
	RTS

CODE_0EA11D:
	LDA.w $7A98,x
	BNE.b CODE_0EA130
	INC.w $7A98,x
	LDY.b $79,x
	INY
	CPY.b #$09
	BMI.b CODE_0EA12E
	LDY.b #$00
CODE_0EA12E:
	STY.b $79,x
CODE_0EA130:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0F7: Barney Bubble. Raiden: init_barney_bubble.
;---------------------------------------------------------------------------
YI_NorSpr0F7_BarneyBubble_Init:
init_barney_bubble:
;$0EA131
	LDA.w #$0100
	STA.w $7A36,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; DATA_barney_bubble_state_ptrs -- Barney Bubble per-state pointer table (4 entries).
; Indexed by ASL of $76,x in main_barney_bubble. Drives the bubble's
; idle bob -> drift -> pop -> despawn cycle.
;---------------------------------------------------------------------------
DATA_barney_bubble_state_ptrs:
DATA_0EA138:
	dw CODE_0EA2FA
	dw CODE_0EA335
	dw CODE_0EA36B
	dw CODE_0EA433

;---------------------------------------------------------------------------
; Sprite $0F7 main. Raiden: main_barney_bubble.
;---------------------------------------------------------------------------
YI_NorSpr0F7_BarneyBubble_Main:
main_barney_bubble:
;$0EA140
	LDY.w $7722,x
	BMI.b CODE_0EA1B9
	LDY.w $74A2,x
	BMI.b CODE_0EA1B9
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0008
	TAY
	JSL.l CODE_03AA60
	LDA.w #$0004
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0200
	SEC
	SBC.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $7CD6,x
	SEC
	SBC.w $6094
	STA.b $00
	REP.b #$10
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDY.w $7400,x
	BEQ.b CODE_0EA19E
	LDY.w $7362,x
	LDA.b $00
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w #$0008
	STA.w $6000,y
	LDA.b $00
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BRA.b CODE_0EA1B4

CODE_0EA19E:
	LDY.w $7362,x
	LDA.b $00
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $6000,y
	LDA.b $00
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w #$0008
CODE_0EA1B4:
	STA.w $6028,y
	SEP.b #$10
CODE_0EA1B9:
	JSL.l CODE_03AF23
	JSR.w CODE_0EA1CF
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_barney_bubble_state_ptrs,x)
	JSR.w CODE_0EA29F
	JML.l CODE_0DC14C

CODE_0EA1CF:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0EA1E4
	LDY.w $60AB
	BMI.b CODE_0EA1E1
	LDY.w $0D94
	BEQ.b CODE_0EA1E4
CODE_0EA1E1:
	JMP.w CODE_0EA290

CODE_0EA1E4:
	LDA.w #$0006
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0200
	SEC
	SBC.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w $6120
	STA.b $00
	ASL
	STA.b $02
	LDA.w $7C16,x
	CLC
	ADC.b $00
	CMP.b $02
	BCS.b CODE_0EA1E1
	LDA.w #$000C
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $7182,x
	CLC
	ADC.w #$000F
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w $611E
	SEC
	SBC.w $6122
	STA.b $00
	CMP.w #$FFF8
	BCC.b CODE_0EA285
	CPX.w $61B6
	BEQ.b CODE_0EA26B
	LDY.w $61B6
	BNE.b CODE_0EA290
	STX.w $61B6
	LDY.w $7722,x
	BPL.b CODE_0EA264
	JSL.l CODE_03AD74
	BCC.b CODE_0EA264
	LDA.w #$0004
	STA.w $7402,x
CODE_0EA264:
	LDY.b #$02
	STY.b $76,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0EA26B:
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	ADC.b $00
	INC
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60D4
	STZ.w $60AA
	INC.w $61B4
	LDA.w #$7440
	STA.w $6FA0,x
	RTS

CODE_0EA285:
	BPL.b CODE_0EA290
	LDY.w $7D36,x
	BPL.b CODE_0EA295
	JSL.l CODE_03A858
CODE_0EA290:
	CPX.w $61B6
	BNE.b CODE_0EA298
CODE_0EA295:
	STZ.w $61B6
CODE_0EA298:
	LDA.w #$7480
	STA.w $6FA0,x
	RTS

CODE_0EA29F:
	LDY.w $7722,x
	BMI.b CODE_0EA2F5
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0200
	SEC
	SBC.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #(FXDATA_540000+$3050)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_540000+$3050
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	ASL
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0882FA>>16
	LDA.w #FXCODE_0882FA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	LDY.w $7402,x
	CPY.b #$03
	BNE.b CODE_0EA2F5
	JSL.l CODE_03AEFD
CODE_0EA2F5:
	RTS

DATA_0EA2F6:
	dw $FF00,$0100

CODE_0EA2FA:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0EA30B
	LDA.w #$0841
	STA.w $6FA2,x
	BRA.b CODE_0EA30E

CODE_0EA30B:
	INC.w $7A96,x
CODE_0EA30E:
	LDA.w $7A96,x
	BNE.b CODE_0EA330
	LDA.b $10
	PHA
	AND.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_0EA2F6,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLA
	AND.w #$001F
	CLC
	ADC.w #$0020
	STA.w $7A96,x
	INC.b $76,x
CODE_0EA330:
	RTS

DATA_0EA331:
	db $00,$01,$02,$01

CODE_0EA335:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0EA353
	LDA.w #$0003
	STA.w $7402,x
	LDA.b $10
	AND.w #$000F
	CLC
	ADC.w #$0008
	STA.w $7A96,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $76,x
	RTS

CODE_0EA353:
	LDA.b $78,x
	INC
	AND.w #$0003
	STA.b $78,x
	LDY.b $78,x
	LDA.w DATA_0EA331,y
	AND.w #$00FF
	STA.w $7402,x
	RTS

DATA_0EA367:
	dw $FD00,$0300

CODE_0EA36B:
	TYX
	LDA.w $7860,x
	LSR
	BCC.b CODE_0EA37E
	CPX.w $61B6
	BEQ.b CODE_0EA37F
	LDA.w #$0002
	STA.b $16,x
	INC.b $76,x
CODE_0EA37E:
	RTS

CODE_0EA37F:
	LDA.w $7A36,x
	SEC
	SBC.w #$0010
	CMP.w #$0040
	BPL.b CODE_0EA392
	LDA.w #$0040
	STA.w $7A36,x
	RTS

CODE_0EA392:
	STA.w $7A36,x
	LDA.w $7A98,x
	BNE.b CODE_0EA37E
	LDA.w #$0006
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0200
	SEC
	SBC.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w $7400,x
	LDA.w DATA_0EA367,y
	STA.b $00
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CPY.b #$00
	BNE.b CODE_0EA3CC
	EOR.w #$FFFF
	INC
	SEC
	SBC.w #$0010
CODE_0EA3CC:
	STA.b $02
	LDA.w #$0006
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #$0019
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	JSL.l CODE_spawn_sprite_init
else
	JSL.l CODE_spawn_sprite_active
endif
	BCC.b CODE_0EA42A
	LDA.w $7CD6,x
	CLC
	ADC.b $02
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $7182,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$000A
	STA.w $7A98,y
	LDA.w #$0004
	STA.w $7402,y
	DEC
	STA.w $7A98,x
	LDA.w $6FA0,y
	AND.w #$F9FF
	STA.w $6FA0,y
	LDA.w #!Define_YI_SoundID61_Splash3
	JSL.l CODE_push_sound_queue
CODE_0EA42A:
	RTS

DATA_0EA42B:
	dw $FFF0,$0020

DATA_0EA42F:
	dw $0100,$01C0

CODE_0EA433:
	TYX
	LDY.b $16,x
	LDA.w $7A36,x
	CLC
	ADC.w DATA_0EA42B,y
	CMP.w DATA_0EA42F,y
	PHP
	CPY.b #$00
	BEQ.b CODE_0EA458
	PLP
	BMI.b CODE_0EA46E
	STZ.b $16,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0841
	STA.w $6FA2,x
	BRA.b CODE_0EA46B

CODE_0EA458:
	PLP
	BPL.b CODE_0EA46E
	LDA.w #$0010
	STA.w $7A96,x
	LDA.w #$0003
	STA.w $7402,x
	STZ.b $78,x
	STZ.b $76,x
CODE_0EA46B:
	LDA.w DATA_0EA42F,y
CODE_0EA46E:
	STA.w $7A36,x
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0F6: Mother (parent) Huffin Puffin. Raiden: init_parent_huffin_puffin.
;---------------------------------------------------------------------------
YI_NorSpr0F6_MotherHuffinPuffin_Init:
init_parent_huffin_puffin:
;$0EA472
	LDA.w #$0100
	STA.w $7A36,x
	JSL.l CODE_03AE60
	LDX.b #FXCODE_0991D5>>16
	LDA.w #FXCODE_0991D5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	SEC
	SBC.w #$0006
	BPL.b CODE_0EA4E3
	CMP.w #$FFFE
	BPL.b CODE_0EA498
	LDA.w #$FFFE
CODE_0EA498:
	EOR.w #$FFFF
	INC
	STA.b $00
	LDA.w #$0010
	STA.b $02
	TXY
CODE_0EA4A4:
	STY.b $04
	LDA.w #$0028
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0EA4E3
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w $7400,x
	STA.w $7400,y
	LDA.b $02
	STA.w $7A96,y
	CLC
	ADC.w #$0008
	STA.b $02
	LDA.w $7974
	STA.w $7A38,y
	SEP.b #$20
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.b $04
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701979|!EXRAMBankMirror,y
	REP.b #$20
	DEC.b $00
	BNE.b CODE_0EA4A4
CODE_0EA4E3:
	JSR.w CODE_0EA57E
	LDA.w $7974
	STA.w $7A38,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; DATA_mother_huffin_puffin_state_ptrs -- Mother Huffin Puffin per-state pointer table (4 entries).
; Indexed by ASL of $76,x in main_parent_huffin_puffin. Drives the parent
; bird's idle / lay-eggs / panic / despawn phases.
;---------------------------------------------------------------------------
DATA_mother_huffin_puffin_state_ptrs:
DATA_0EA4ED:
	dw CODE_0EA675
	dw CODE_0EA70E
	dw CODE_0EA745
	dw CODE_0EA768

;---------------------------------------------------------------------------
; Sprite $0F6 main. Raiden: main_parent_huffin_puffin.
;---------------------------------------------------------------------------
YI_NorSpr0F6_MotherHuffinPuffin_Main:
main_parent_huffin_puffin:
;$0EA4F5
	JSR.w CODE_0EA519
	JSL.l CODE_03AF23
	JSR.w CODE_0EA533
	STZ.b $0E
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_mother_huffin_puffin_state_ptrs,x)
	JSR.w CODE_0EA57E
	JSR.w CODE_0EA5D5
	RTL

DATA_0EA510:
	db $00,$10,$08,$10,$10,$10,$10,$10,$00

CODE_0EA519:
	LDY.w $7722,x
	BMI.b CODE_0EA532
	REP.b #$10
	LDY.w $7402,x
	LDA.w DATA_0EA510,y
	AND.w #$00FF
	CLC
	ADC.w $7362,x
	TAY
	JSL.l CODE_03AA60
CODE_0EA532:
	RTS

CODE_0EA533:
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
	ADC.w #$0010
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w $7CD8,x
	CLC
	ADC.w $7B58,x
	STA.w $7B58,x
	LDA.w #$000A
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $7BB8,x
	RTS

CODE_0EA57E:
	LDY.w $7722,x
	BMI.b CODE_0EA5D0
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $0E
	BEQ.b CODE_0EA59D
	LDA.w #$0200
	SEC
	SBC.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
CODE_0EA59D:
	LDA.w #(FXDATA_550000+$2000)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_550000+$2000
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	ASL
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
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
CODE_0EA5D0:
	RTS

DATA_0EA5D1:
	dw $FE00,$0200

CODE_0EA5D5:
	LDY.w $7D36,x
	BMI.b CODE_0EA5F2
	BEQ.b CODE_0EA5F1
	LDA.w $6EFF,y
	CMP.w #$0010
	BNE.b CODE_0EA5F1
	LDA.w $7D37,y
	BEQ.b CODE_0EA5F1
	DEY
	TYX
	JSL.l CODE_03B25B
	BRA.b CODE_0EA62D

CODE_0EA5F1:
	RTS

CODE_0EA5F2:
	LDA.w $60FC
	AND.w #$0018
	BNE.b CODE_0EA660
	LDY.w $60AB
	BMI.b CODE_0EA64B
	LDY.w $60C0
	BEQ.b CODE_0EA64B
	LDA.w $7C18,x
	SEC
	SBC.w $7BB8,x
	SEC
	SBC.w $6122
	CMP.w #$FFF8
	BCC.b CODE_0EA64B
	LDA.w #$FA00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	STZ.w $60D2
	STZ.w $60D4
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
CODE_0EA62D:
	LDA.w #$0006
	STA.w $7402,x
	STA.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b #$01
	STY.b $76,x
	STY.b $18,x
	LDA.w $6FA2,x
	AND.w #$F83F
	ORA.w #$0480
	STA.w $6FA2,x
	RTS

CODE_0EA64B:
	LDA.w #$FC00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	STZ.w $60D4
CODE_0EA660:
	LDY.w $77C2,x
	LDA.w DATA_0EA5D1,y
	STA.w $60A8
	STA.w $60B4
	RTS

DATA_0EA66D:
	dw $FF40,$00C0

DATA_0EA671:
	dw $FFFE,$0002

CODE_0EA675:
	TYX
	LDY.b $18,x
	BEQ.b CODE_0EA684
	LDY.w $77C2,x
	TYA
	EOR.w #$0002
	STA.w $7400,x
CODE_0EA684:
	LDY.w $7400,x
	LDA.w DATA_0EA66D,y
	LDY.b $18,x
	BEQ.b CODE_0EA68F
	ASL
CODE_0EA68F:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JSR.w CODE_0EA6E1
	LDA.w $7A98,x
	BNE.b CODE_0EA6B5
	LDA.w #$0008
	LDY.b $18,x
	BEQ.b CODE_0EA6A3
	LSR
	LSR
CODE_0EA6A3:
	STA.w $7A98,x
	LDA.w $7402,x
	INC
	CMP.w #$0006
	BNE.b CODE_0EA6B2
	LDA.w #$0000
CODE_0EA6B2:
	STA.w $7402,x
CODE_0EA6B5:
	LDA.w $7402,x
	INC
	AND.w #$0004
	LSR
	TAY
	LDA.w DATA_0EA671,y
	LDY.b $18,x
	BEQ.b CODE_0EA6C7
	ASL
	ASL
CODE_0EA6C7:
	CLC
	ADC.w $7A36,x
	CMP.w #$010C
	BMI.b CODE_0EA6D3
	LDA.w #$010C
CODE_0EA6D3:
	CMP.w #$00F0
	BPL.b CODE_0EA6DB
	LDA.w #$00F0
CODE_0EA6DB:
	STA.w $7A36,x
	INC.b $0E
	RTS

CODE_0EA6E1:
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_0EA6F5
	AND.w #$0008
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0EA6F5
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0EA6F5:
	RTS

DATA_0EA6F6:
	dw $0100,$00C0,$0120,$0080

DATA_0EA6FE:
	dw $0018,$FFE8,$0010,$FFF0

DATA_0EA706:
	dw $FFFF,$0000,$FFFF,$0000

CODE_0EA70E:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0EA744
	LDY.b $16,x
	LDA.w $7A36,x
	SEC
	SBC.w DATA_0EA6F6,y
	EOR.w DATA_0EA706,y
	BPL.b CODE_0EA73A
	LDA.w DATA_0EA6F6,y
	STA.w $7A36,x
	DEC.b $16,x
	DEC.b $16,x
	BPL.b CODE_0EA739
	LDA.w #$0020
	STA.w $7A98,x
	INC.b $76,x
CODE_0EA739:
	RTS

CODE_0EA73A:
	LDA.w $7A36,x
	CLC
	ADC.w DATA_0EA6FE,y
	STA.w $7A36,x
CODE_0EA744:
	RTS

CODE_0EA745:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0EA767
	INC.w $7402,x
	LDY.w $7402,x
	CPY.b #$08
	BNE.b CODE_0EA761
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7860,x
	INC.b $76,x
	RTS

CODE_0EA761:
	LDA.w #$0004
	STA.w $7A98,x
CODE_0EA767:
	RTS

CODE_0EA768:
	TYX
	LDY.w $7223,x
	BMI.b CODE_0EA77E
	LDA.w #$0005
	STA.w $7402,x
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0EA77E
	STZ.b $76,x
CODE_0EA77E:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $028: Running Huffin Puffin (child). Raiden: init_huffin_puffin_running.
;---------------------------------------------------------------------------
YI_NorSpr028_HuffinPuffin_Init:
init_huffin_puffin_running:
;$0EA77F
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; DATA_huffin_puffin_chick_state_ptrs -- Child Huffin Puffin per-state pointer table (3 entries).
; Indexed by ASL of $76,x in main_huffin_puffin_running. Drives the
; chick's run -> jump -> land cycle.
;---------------------------------------------------------------------------
DATA_huffin_puffin_chick_state_ptrs:
DATA_0EA780:
	dw CODE_0EA8FC
	dw CODE_0EA96A
	dw CODE_0EA9EF

DATA_0EA786:
	dw $0006,$FFFA

DATA_0EA78A:
	dw $FFB0,$0050,$FC00,$0400

;---------------------------------------------------------------------------
; Sprite $028 main. Raiden: main_huffin_puffin_running.
;---------------------------------------------------------------------------
YI_NorSpr028_HuffinPuffin_Main:
main_huffin_puffin_running:
;$0EA792
	LDA.w $7D38,x
	BEQ.b CODE_0EA7B1
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LSR
	BNE.b CODE_0EA7B4
	LDY.w $7D36,x
	BPL.b CODE_0EA7B4
	LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	ORA.w $7A36,x
	BNE.b CODE_0EA7B4
	STZ.w $7D38,x
	JSL.l CODE_03BEB9
CODE_0EA7B1:
	JMP.w CODE_0EA898

CODE_0EA7B4:
	LDA.w $7542,x
	CMP.w #$0040
	BCC.b CODE_0EA7BF
	JMP.w CODE_0EA898

CODE_0EA7BF:
	LDA.w $7C16,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7C18,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDY.w $0B57
	BEQ.b CODE_0EA7E1
	EOR.w #$0100
CODE_0EA7E1:
	BIT.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BMI.b CODE_0EA7ED
	EOR.w #$00FF
	INC
	AND.w #$01FE
CODE_0EA7ED:
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	AND.w #$01FE
	STA.b $00
	BIT.w #$0100
	BEQ.b CODE_0EA7FF
	EOR.w #$01FF
	INC
CODE_0EA7FF:
	LDY.b #$00
	CMP.w #$0080
	BCS.b CODE_0EA80F
	LDA.b $00
	AND.w #$0100
	BEQ.b CODE_0EA80F
	LDY.b #$02
CODE_0EA80F:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w DATA_0EA786,y
	AND.w #$01FE
	REP.b #$10
	TAY
	BIT.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BPL.b CODE_0EA824
	ORA.w #$8000
CODE_0EA824:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TYX
	LDY.w #$0000
	LDA.l DATA_sine_lut_8bit_radians,x
	ASL
	ASL
	BMI.b CODE_0EA836
	LDY.w #$0002
CODE_0EA836:
	STA.b $02
	STY.b $04
	LDA.l DATA_cosine_lut_8bit_radians,x
	ASL
	ASL
	SEP.b #$10
	LDX.b $12
	BIT.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BMI.b CODE_0EA84D
	EOR.w #$FFFF
	INC
CODE_0EA84D:
	LDY.b #$00
	CMP.w #$0000
	BMI.b CODE_0EA856
	LDY.b #$02
CODE_0EA856:
	STA.b $00
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.b $00
	BPL.b CODE_0EA865
	TYA
	EOR.w #$0002
	TAY
CODE_0EA865:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w DATA_0EA78A,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	AND.w #$8000
	BEQ.b CODE_0EA877
	LDA.w #$0002
CODE_0EA877:
	EOR.w #$0002
	STA.w $7400,x
	LDY.b $04
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.b $02
	EOR.b $02
	BMI.b CODE_0EA88E
	TYA
	EOR.w #$0002
	TAY
CODE_0EA88E:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w DATA_0EA78A,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0EA898:
	JSL.l CODE_03B9DD
	LDA.b $78,x
	BEQ.b CODE_0EA8A3
	JMP.w CODE_0EAA25

CODE_0EA8A3:
	LDA.w $7A36,x
	BMI.b CODE_0EA8F7
	LSR
	BNE.b CODE_0EA8B3
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_huffin_puffin_chick_state_ptrs,x)
CODE_0EA8B3:
	LDY.w $7D36,x
	BPL.b CODE_0EA8E0
	LDA.w $7AF6,x
	BNE.b CODE_0EA8E0
	LDY.b $18,x
	BMI.b CODE_0EA8C6
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	BEQ.b CODE_0EA8E0
CODE_0EA8C6:
	LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	BNE.b CODE_0EA8E0
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_0EA8D8
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0EA8E0
CODE_0EA8D8:
	LDY.b #$FF
	STY.b $19,x
	JSL.l CODE_03BEB9
CODE_0EA8E0:
	LDY.b $19,x
	STY.b $02
	LDY.b $18,x
	BMI.b CODE_0EA8F7
	CPY.b $02
	BEQ.b CODE_0EA8F7
	LDY.b $02
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	BEQ.b CODE_0EA8F7
	LDY.b $18,x
	STY.b $19,x
CODE_0EA8F7:
	RTL

DATA_0EA8F8:
	dw $FFC0,$0040

CODE_0EA8FC:
	TYX
	JSR.w CODE_0EA9C2
	LDA.w $7A96,x
	BNE.b CODE_0EA965
	LDY.b $19,x
	BPL.b CODE_0EA912
	LDA.w $77C2,x
	EOR.w #$0002
	TAY
	BRA.b CODE_0EA92B

CODE_0EA912:
	LDA.w $7CD6,y
	SEC
	SBC.w $7CD6,x
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCC.b CODE_0EA938
	LDY.b #$00
	CMP.w #$0000
	BMI.b CODE_0EA92B
	INY
	INY
CODE_0EA92B:
	TYA
	STA.w $7400,x
	LDA.w #$0004
	STA.w $7402,x
	INC.b $76,x
	RTS

CODE_0EA938:
	LDY.b $18,x
	BMI.b CODE_0EA93F
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
CODE_0EA93F:
	PHP
	LDY.w $7400,x
	LDA.w DATA_0EA8F8,y
	PLP
	BEQ.b CODE_0EA94A
	ASL
CODE_0EA94A:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JSR.w CODE_0EA6E1
	LDA.w $7A98,x
	BNE.b CODE_0EA965
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w $7402,x
	INC
	AND.w #$0003
	STA.w $7402,x
CODE_0EA965:
	RTS

DATA_0EA966:
	dw $FF00,$0100

CODE_0EA96A:
	TYX
	JSR.w CODE_0EA9C2
	LDY.b $19,x
	BPL.b CODE_0EA97E
	LDA.w $77C2,x
	EOR.w #$0002
	STA.w $7400,x
	TAY
	BRA.b CODE_0EA997

CODE_0EA97E:
	LDA.w $7CD6,y
	SEC
	SBC.w $7CD6,x
	CLC
	ADC.w #$0018
	CMP.w #$0030
	BCS.b CODE_0EA997
	LDA.w #$0002
	STA.w $7402,x
	DEC.b $76,x
	RTS

CODE_0EA997:
	LDY.b $18,x
	BMI.b CODE_0EA99E
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
CODE_0EA99E:
	PHP
	LDY.w $7400,x
	LDA.w DATA_0EA966,y
	PLP
	BEQ.b CODE_0EA9A9
	ASL
CODE_0EA9A9:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JSR.w CODE_0EA6E1
CODE_0EA9AF:
	LDA.w $7A98,x
	BNE.b CODE_0EA9C1
	LDA.w #$0002
	STA.w $7A98,x
	DEC
	EOR.w $7402,x
	STA.w $7402,x
CODE_0EA9C1:
	RTS

CODE_0EA9C2:
	LDY.b $18,x
	BMI.b CODE_0EA9EA
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0EA9DE
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr0F6_MotherHuffinPuffin
	BNE.b CODE_0EA9DE
	LDA.w $7A38,y
	CMP.w $7A38,x
	BEQ.b CODE_0EA9EA
CODE_0EA9DE:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0002
	STA.w $7402,x
	STA.b $76,x
	PLA
CODE_0EA9EA:
	RTS

DATA_0EA9EB:
	dw $0280,$FD80

CODE_0EA9EF:
	TYX
	LDY.w $77C2,x
	TYA
	EOR.w #$0002
	STA.w $7400,x
	LDA.w DATA_0EA9EB,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JSR.w CODE_0EA6E1
	BRA.b CODE_0EA9AF

DATA_0EAA05:
	dw $0000,$0000,$FFFF,$FFFE,$FFFE,$FFFD,$FFFD,$FFFD
	dw $FFFD,$FFFE,$FFFE,$FFFF,$FFFF,$0000,$0000,$0000

CODE_0EAA25:
	JSL.l CODE_03BB1D
	LDA.w $70E2,x
	SEC
	SBC.w $6EBC
	STA.b $00
	BNE.b CODE_0EAA45
	LDA.w $60A8
	BEQ.b CODE_0EAA51
	PHP
	LDA.w #$0001
	PLP
	BPL.b CODE_0EAA43
	LDA.w #$FFFF
CODE_0EAA43:
	STA.b $00
CODE_0EAA45:
	ASL
	ROL
	ASL
	AND.w #$0002
	EOR.w #$0002
	STA.w $7400,x
CODE_0EAA51:
	LDA.w #$0006
	STA.w $7402,x
	LDA.w $0812,y
	AND.w #$FF00
	BEQ.b CODE_0EAA66
	BMI.b CODE_0EAAA0
	STZ.w $7402,x
	BRA.b CODE_0EAAA0

CODE_0EAA66:
	LDA.b $00
	BNE.b CODE_0EAA7E
	LDA.b $16,x
	AND.w #$000F
	ASL
	TAY
	LDA.w DATA_0EAA05,y
	BNE.b CODE_0EAAA7
	LDA.w #$0002
	STA.w $7402,x
	BRA.b CODE_0EAAA7

CODE_0EAA7E:
	LDA.b $00
	BPL.b CODE_0EAA86
	EOR.w #$FFFF
	INC
CODE_0EAA86:
	TAY
	XBA
	CLC
	ADC.b $16,x
	STA.b $16,x
	XBA
	LSR
	LSR
	AND.w #$0003
	CPY.b #$02
	BCC.b CODE_0EAA9D
	AND.w #$0001
	ORA.w #$0004
CODE_0EAA9D:
	STA.w $7402,x
CODE_0EAAA0:
	LDA.b $16,x
	AND.w #$000F
	BEQ.b CODE_0EAAAA
CODE_0EAAA7:
	LDA.w #$0001
CODE_0EAAAA:
	SEP.b #$10
	CLC
	ADC.b $16,x
	STA.b $16,x
	AND.w #$000F
	ASL
	TAY
	LDA.w $7182,x
	CLC
	ADC.w DATA_0EAA05,y
	STA.w $7182,x
	RTL

;---------------------------------------------------------------------------

DATA_0EAAC1:
	dw $0040,$01C0

;---------------------------------------------------------------------------
; Sprites $04C / $0F8: Upside-down Blow Hard and normal Blow Hard.
; Raiden: init_blow_hard.
;
; See docs/family-piranhas.md for the full Piranha family breakdown
; (11-state inhale/hold/exhale/sleep machine shared with $04C upside-down).
;---------------------------------------------------------------------------
YI_NorSpr04C_UpsidedownBlowHard_Init:
YI_NorSpr0F8_BlowHard_Init:
init_blow_hard:
;$0EAAC5
	LDY.w $7400,x
	LDA.w DATA_0EAAC1,y
	STA.b $78,x
	LDA.w #$0100
	STA.w $7A36,x
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; DATA_blow_hard_state_ptrs -- Blow Hard per-state pointer table (11 entries).
; Indexed by ASL of $76,x in main_blow_hard. Drives the inhale / hold /
; exhale / sleep cycle plus damage/death paths. Shared by sprites $04C
; (UpsidedownBlowHard) and $0F8 (BlowHard).
;---------------------------------------------------------------------------
DATA_blow_hard_state_ptrs:
DATA_0EAADA:
	dw CODE_0EAD45
	dw CODE_0EAD5A
	dw CODE_0EAD8F
	dw CODE_0EAE14
	dw CODE_0EAE31
	dw CODE_0EAEEF
	dw CODE_0EAF36
	dw CODE_0EAF70
	dw CODE_0EB032
	dw CODE_0EB05A
	dw CODE_0EB08C

;---------------------------------------------------------------------------
; Sprites $04C / $0F8 main (shared). Raiden: main_blow_hard.
;---------------------------------------------------------------------------
YI_NorSpr04C_UpsidedownBlowHard_Main:
YI_NorSpr0F8_BlowHard_Main:
main_blow_hard:
;$0EAAF0
	JSR.w CODE_0EAB30
	LDA.w $7D96,x
	BEQ.b CODE_0EAB03
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr04C_UpsidedownBlowHard
	BNE.b CODE_0EAB03
	STZ.w $6FA2,x
CODE_0EAB03:
	JSL.l CODE_03AF23
	JSR.w CODE_0EABC0
	JSR.w CODE_0EABAC
	LDY.b $76,x
	TYA
	ASL
	TXY
	TAX
	JSR.w (DATA_blow_hard_state_ptrs,x)
	JSR.w CODE_0EAC07
	JSR.w CODE_0EACB4
	LDA.w #$3155
	LDY.b $76,x
	CPY.b #$07
	BMI.b CODE_0EAB28
	LDA.w #$3055
CODE_0EAB28:
	STA.w $7040,x
	RTL

DATA_0EAB2C:
	dw $FFFC,$0004

CODE_0EAB30:
	LDY.w $7402,x
	BNE.b CODE_0EAB36
	RTS

CODE_0EAB36:
	JSL.l CODE_03AA52
	LDA.w $7CD6,x
	SEC
	SBC.w $6094
	STA.b $00
	SEC
	SBC.w #$0010
	STA.b $02
	LDA.w $7042,x
	AND.w #$0080
	ASL
	ASL
	XBA
	TAY
	LDA.w $7CD8,x
	CLC
	ADC.w DATA_0EAB2C,y
	SEC
	SBC.w $609C
	STA.b $04
	SEC
	SBC.w #$0010
	STA.b $06
	LDY.w $7400,x
	BEQ.b CODE_0EAB75
	LDA.b $00
	PHA
	LDA.b $02
	STA.b $00
	PLA
	STA.b $02
CODE_0EAB75:
	LDY.w $7042,x
	BPL.b CODE_0EAB84
	LDA.b $04
	PHA
	LDA.b $06
	STA.b $04
	PLA
	STA.b $06
CODE_0EAB84:
	REP.b #$10
	LDY.w $7362,x
	LDA.b $02
	STA.w $6000,y
	STA.w $6010,y
	LDA.b $00
	STA.w $6008,y
	STA.w $6018,y
	LDA.b $04
	STA.w $6012,y
	STA.w $601A,y
	LDA.b $06
	STA.w $6002,y
	STA.w $600A,y
	SEP.b #$10
	RTS

CODE_0EABAC:
	LDY.w $7D36,x
	BPL.b CODE_0EABBB
	LDY.b $76,x
	CPY.b #$09
	BPL.b CODE_0EABBB
	CPY.b #$06
	BPL.b CODE_0EABBF
CODE_0EABBB:
	JSL.l CODE_03B22F
CODE_0EABBF:
	RTS

CODE_0EABC0:
	LDY.b $76,x
	CPY.b #$06
	BPL.b CODE_0EABDE
	LDA.w $61C6
	BNE.b CODE_0EABDF
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0EABDE
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0EABDE
	LDA.w $7D38,y
	BNE.b CODE_0EABDF
CODE_0EABDE:
	RTS

CODE_0EABDF:
	LDA.w #$0006
	STA.b $76,x
	LDA.w #$0100
	STA.w $7A36,x
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$000A
	STA.b $16,x
	LDA.w $7042,x
	AND.w #$FFF1
	STA.w $7042,x
	RTS

DATA_0EABFF:
	dw FXDATA_550000+$2020,FXDATA_550000+$2040

DATA_0EAC03:
	dw $0008,$FFF8

CODE_0EAC07:
	LDY.b $76,x
	CPY.b #$06
	BMI.b CODE_0EAC33
	LDY.b #$00
	LDA.w $7A38,x
	BEQ.b CODE_0EAC5B
	CMP.w #$0100
	BPL.b CODE_0EAC1B
	INY
	INY
CODE_0EAC1B:
	CLC
	ADC.w DATA_0EAC03,y
	AND.w #$01FE
	STA.w $7A38,x
	CLC
	ADC.w #$0008
	CMP.w #$0010
	BCS.b CODE_0EAC5B
	STZ.w $7A38,x
	BRA.b CODE_0EAC5B

CODE_0EAC33:
	LDA.b $78,x
	SEC
	SBC.w #$0080
	CMP.w #$0100
	BCC.b CODE_0EAC45
	STZ.w $7400,x
	LDA.b $78,x
	BRA.b CODE_0EAC55

CODE_0EAC45:
	LDA.w #$0002
	STA.w $7400,x
	LDA.b $78,x
	CLC
	ADC.w #$0100
	EOR.w #$FFFF
	INC
CODE_0EAC55:
	AND.w #$01FE
	STA.w $7A38,x
CODE_0EAC5B:
	LDY.w $7402,x
	BNE.b CODE_0EAC61
	RTS

CODE_0EAC61:
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BPL.b CODE_0EAC73
	LDA.w #$0200
	SEC
	SBC.w $7A36,x
CODE_0EAC73:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDY.b $77,x
	LDA.w DATA_0EABFF,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$2020)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0884A5>>16
	LDA.w #FXCODE_0884A5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	RTS

DATA_0EACAC:
	dw $0008,$000A

DATA_0EACB0:
	dw $0000,$FFF0

CODE_0EACB4:
	LDA.b $78,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDY.w $7042,x
	BPL.b CODE_0EACCB
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	EOR.w #$FFFF
	INC
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
CODE_0EACCB:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BPL.b CODE_0EACD7
	LDA.w #$0200
	SEC
	SBC.w $7A36,x
CODE_0EACD7:
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDY.b $77,x
	LDA.w DATA_0EACAC,y
	CLC
	ADC.b $18,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0B86FA>>16
	LDA.w #FXCODE_0B86FA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w $7CD6,x
	CLC
	ADC.w $7B56,x
	STA.w $7B56,x
	LDA.w $7042,x
	AND.w #$0080
	ASL
	ASL
	XBA
	TAY
	LDA.w $7182,x
	SEC
	SBC.w DATA_0EACB0,y
	SEC
	SBC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEC
	SBC.w $7CD8,x
	CLC
	ADC.w $7B58,x
	STA.w $7B58,x
	LDA.w #$0008
	STA.w $7BB6,x
	LDA.w #$000C
	STA.w $7BB8,x
	LDY.b $76,x
	CPY.b #$06
	BPL.b CODE_0EAD44
	LDA.b $18,x
	BEQ.b CODE_0EAD44
	DEC.b $18,x
CODE_0EAD44:
	RTS

CODE_0EAD45:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0EAD59
	JSL.l CODE_03AD74
	BCC.b CODE_0EAD59
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	INC.w $7402,x
	INC.b $76,x
CODE_0EAD59:
	RTS

CODE_0EAD5A:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0EAD8B
	LDA.w $7A98,x
	BNE.b CODE_0EAD88
	LDA.w $7680,x
	SEC
	SBC.w #$0018
	CMP.w #$00D0
	BCS.b CODE_0EAD88
	LDY.b #$02
	STY.b $77,x
	LDA.w #$00D0
	STA.w $7A36,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0030
	STA.w $7A96,x
	STZ.b $16,x
	INC.b $76,x
CODE_0EAD88:
	JSR.w CODE_0EB0E4
CODE_0EAD8B:
	RTS

DATA_0EAD8C:
	db $00,$04,$02

CODE_0EAD8F:
	TYX
	LDA.w $7680,x
	CLC
	ADC.w #$0010
	CMP.w #$1020
	BCC.b CODE_0EADB8
	LDY.b #$00
	STY.b $77,x
	LDA.w $7042,x
	AND.w #$FFF1
	STA.w $7042,x
	LDA.w #$0100
	STA.w $7A36,x
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEC.b $76,x
	RTS

CODE_0EADB8:
	LDA.w $7A36,x
	CLC
	ADC.w #$0004
	CMP.w #$0100
	BMI.b CODE_0EAE0C
	LDA.w $7A96,x
	BNE.b CODE_0EADEB
	LDA.w $7042,x
	AND.w #$FFF1
	STA.w $7042,x
	LDA.w #$0100
	STA.w $7A36,x
	LDA.w #$00D0
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.w $7A96,x
	JSL.l CODE_0EB14D
	INC.b $76,x
	RTS

CODE_0EADEB:
	LDY.b $16,x
	INY
	CPY.b #$03
	BNE.b CODE_0EADF4
	LDY.b #$00
CODE_0EADF4:
	STY.b $16,x
	LDA.w DATA_0EAD8C,y
	AND.w #$00FF
	STA.b $00
	LDA.w $7042,x
	AND.w #$FFF1
	ORA.b $00
	STA.w $7042,x
	LDA.w #$0100
CODE_0EAE0C:
	STA.w $7A36,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BRA.b CODE_0EAE29

CODE_0EAE14:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0EAE29
	TAY
	STY.b $77,x
	DEC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $76,x
	LDA.w #$0130
CODE_0EAE26:
	STA.w $7A36,x
CODE_0EAE29:
	JSR.w CODE_0EB0E4
	JSL.l CODE_0EB14D
	RTS

CODE_0EAE31:
	TYX
	LDA.w $7A36,x
	SEC
	SBC.w #$0010
	CMP.w #$00E0
	BPL.b CODE_0EAE26
	LDA.b $78,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDY.w $7042,x
	BPL.b CODE_0EAE55
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	EOR.w #$FFFF
	INC
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
CODE_0EAE55:
	PHA
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #!Define_YI_AmbSpr1E9
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7CD6,x
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $00
	STA.w $70A2,y
	LDA.w $7CD8,x
	SEC
	SBC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.b $02
	STA.w $7142,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #$0006
	STA.w $7462,y
	PLA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$FC00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #$00F9
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0EAED8
	LDA.b $00
	SEC
	SBC.w #$0008
	STA.w $70E2,y
	LDA.b $02
	SEC
	SBC.w #$0008
	STA.w $7182,y
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDY.b #$08
	STY.b $16,x
	JSL.l CODE_0EB148
	INC.b $76,x
CODE_0EAED8:
	LDA.w #$00E0
	STA.w $7A36,x
	RTS

DATA_0EAEDF:
	dw $000A,$FFF4,$0010,$FFF0

DATA_0EAEE7:
	dw $0100,$00C0,$00F0,$00A0

CODE_0EAEEF:
	TYX
	LDY.b $16,x
	LDA.w $7A36,x
	CLC
	ADC.w DATA_0EAEDF-$02,y
	CMP.w DATA_0EAEE7-$02,y
	PHP
	CPY.b #$00
	BNE.b CODE_0EAF06
	PLP
	BMI.b CODE_0EAF22
	BRA.b CODE_0EAF09

CODE_0EAF06:
	PLP
	BPL.b CODE_0EAF22
CODE_0EAF09:
	DEC.b $16,x
	DEC.b $16,x
	BNE.b CODE_0EAF1F
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w #$0140
	STA.w $7A98,x
	LDY.b #$01
	STY.b $76,x
CODE_0EAF1F:
	LDA.w DATA_0EAEE7-$02,y
CODE_0EAF22:
	STA.w $7A36,x
	RTS

DATA_0EAF26:
	dw $0018,$FFE8

DATA_0EAF2A:
	dw $0100,$00A0,$0140,$00A0,$0140,$00A0

CODE_0EAF36:
	TYX
	LDA.b $16,x
	AND.w #$0002
	PHP
	TAY
	LDA.w $7A36,x
	CLC
	ADC.w DATA_0EAF26,y
	STA.w $7A36,x
	LDY.b $16,x
	PLP
	BNE.b CODE_0EAF54
	CMP.w DATA_0EAF2A,y
	BMI.b CODE_0EAF67
	BRA.b CODE_0EAF59

CODE_0EAF54:
	CMP.w DATA_0EAF2A,y
	BPL.b CODE_0EAF67
CODE_0EAF59:
	DEC.b $16,x
	DEC.b $16,x
	BPL.b CODE_0EAF67
	LDA.w #$0100
	STA.w $7A36,x
	INC.b $76,x
CODE_0EAF67:
	RTS

DATA_0EAF68:
	dw $FFFC,$0004

DATA_0EAF6C:
	dw $0058,$00A8

CODE_0EAF70:
	TYX
	LDY.w $7400,x
	LDA.b $78,x
	SEC
	SBC.w DATA_0EAF6C,y
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_0EAF8A
	LDA.w DATA_0EAF6C,y
	STA.b $78,x
	BRA.b CODE_0EAFA0

CODE_0EAF8A:
	PHP
	LDY.b #$00
	CLC
	ADC.w #$00F0
	CMP.w #$0200
	BCS.b CODE_0EAF9B
	PLP
	BPL.b CODE_0EAFA0
	BRA.b CODE_0EAF9E

CODE_0EAF9B:
	PLP
	BMI.b CODE_0EAFA0
CODE_0EAF9E:
	INY
	INY
CODE_0EAFA0:
	LDA.b $78,x
	CLC
	ADC.w DATA_0EAF68,y
	AND.w #$01FE
	STA.b $78,x
	LDY.w $7400,x
	SEC
	SBC.w DATA_0EAF6C,y
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCS.b CODE_0EB01E
	LDA.w $7A36,x
	SEC
	SBC.w #$000C
	CMP.w #$00A0
	BPL.b CODE_0EB01B
	JSL.l CODE_03AEFD
	STZ.w $7402,x
	LDA.w #$0140
	STA.w $7A96,x
	INC.b $76,x
	LDA.w #$FFF8
	LDY.w $7042,x
	BPL.b CODE_0EAFE1
	LDA.w #$0008
CODE_0EAFE1:
	STA.b $00
	LDA.b $E2,x
	AND.w #$0080
	STA.b $02
	LDA.w #!Define_YI_AmbSpr209
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.w $7CD8,x
	CLC
	ADC.b $00
	STA.w $7142,y
	LDA.w #$0005
	STA.w $73C2,y
	DEC
	STA.w $7E8E,y
	LDA.w #$0140
	STA.w $7782,y
	LDA.w $7002,y
	ORA.b $02
	STA.w $7002,y
	LDA.w #$00A0
CODE_0EB01B:
	STA.w $7A36,x
CODE_0EB01E:
	LDA.w $7974
	AND.w #$0001
	CLC
	ADC.b $18,x
	CMP.w #$0008
	BMI.b CODE_0EB02F
	LDA.w #$0008
CODE_0EB02F:
	STA.b $18,x
	RTS

CODE_0EB032:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0EB051
	JSL.l CODE_03AD74
	BCC.b CODE_0EB051
	INC.w $7402,x
	LDA.w #$0020
	STA.w $7A96,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0002
	STA.b $16,x
	INC.b $76,x
CODE_0EB051:
	RTS

DATA_0EB052:
	dw $FFF0,$000A,$0100,$0120

CODE_0EB05A:
	TYX
	LDY.b $16,x
	LDA.w $7A36,x
	CLC
	ADC.w DATA_0EB052,y
	STA.w $7A36,x
	CPY.b #$00
	BNE.b CODE_0EB072
	CMP.w #$0100
	BPL.b CODE_0EB08B
	BRA.b CODE_0EB077

CODE_0EB072:
	CMP.w #$0120
	BMI.b CODE_0EB08B
CODE_0EB077:
	DEC.b $16,x
	DEC.b $16,x
	BPL.b CODE_0EB08B
	LDA.w #$0100
	STA.w $7A36,x
	INC.b $76,x
	LDA.w #$0040
	STA.w $7A96,x
CODE_0EB08B:
	RTS

CODE_0EB08C:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0EB096
	LDY.b #$01
	STY.b $76,x
CODE_0EB096:
	RTS

DATA_0EB097:
	dw $FFFC,$0004

CODE_0EB09B:
	STA.b $08
	LDA.w $7A36,x
	STA.b $02
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $04
	STZ.b $00
	LDX.b #$02
CODE_0EB0AB:
	LDA.b $02,x
	SEC
	SBC.b $08
	CLC
	ADC.w #$0008
	CMP.w #$0010
	BCS.b CODE_0EB0BF
	INC.b $00
	LDA.b $08
	BRA.b CODE_0EB0CD

CODE_0EB0BF:
	PHP
	LDY.b #$00
	PLP
	BPL.b CODE_0EB0C7
	INY
	INY
CODE_0EB0C7:
	LDA.b $02,x
	CLC
	ADC.w DATA_0EB097,y
CODE_0EB0CD:
	STA.b $02,x
	DEX
	DEX
	BPL.b CODE_0EB0AB
	LDX.b $12
	LDA.b $02
	STA.w $7A36,x
	LDA.b $04
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTS

DATA_0EB0E0:
	dw $0004,$FFFC

CODE_0EB0E4:
	LDA.w $7C16,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7C18,x
	CLC
	ADC.w #$000C
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w $7042,x
	BPL.b CODE_0EB10E
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	EOR.w #$FFFF
	INC
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
CODE_0EB10E:
	LDY.b #$00
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w #$0100
	AND.w #$01FE
	SEC
	SBC.b $78,x
	PHP
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCS.b CODE_0EB137
	SEC
	SBC.w #$00FC
	CMP.w #$0008
	BCS.b CODE_0EB132
	PLP
	RTS

CODE_0EB132:
	PLP
	BMI.b CODE_0EB13A
	BRA.b CODE_0EB13C

CODE_0EB137:
	PLP
	BMI.b CODE_0EB13C
CODE_0EB13A:
	INY
	INY
CODE_0EB13C:
	LDA.b $78,x
	CLC
	ADC.w DATA_0EB0E0,y
	AND.w #$01FE
	STA.b $78,x
	RTS

CODE_0EB148:
	LDA.w #$0010
	BRA.b CODE_0EB150

CODE_0EB14D:
	LDA.w #$0000
CODE_0EB150:
	STA.b $02
	STZ.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w #$0002
	CMP.w #$0020
	BCS.b CODE_0EB165
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BRA.b CODE_0EB178

CODE_0EB165:
	LDY.b #$04
	STY.b $00
	LDA.w $7974
	AND.w #$0007
	BNE.b CODE_0EB178
	LDA.w #!Define_YI_SoundID63_AimedAt
	JSL.l CODE_push_sound_queue
CODE_0EB178:
	LDA.w #!Define_YI_AmbSpr1E2
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $611C
	SEC
	SBC.w #$0008
	STA.w $70A2,y
	LDA.w $611E
	SEC
	SBC.w #$0008
	STA.w $7142,y
	LDA.b $02
	STA.w $7782,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7E4C,y
	LDA.w $7974
	AND.b $00
	LSR
	CLC
	ADC.w #$0004
	STA.w !EXRAM_YI_Level_AmbSpr_GenericTable7018C2|!EXRAMBankMirror,x
	ORA.w $7002,y
	STA.w $7002,y
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Needlenose-family shared Init: Spiny Egg ($099 / $11D), Thunder Lakitu Fireball
; ($0A2), Green Needlenose ($0E5), Yellow Needlenose ($0F9).
; Raiden: init_green_needlenose (Raiden labels just the green variant; all 5
; resolve to the same body here).
;---------------------------------------------------------------------------
; See docs/family-spikes.md for the full spikes / needlenose / cactus
; family. The 5 sprites below share this RTL-only Init, then share
; main_needlenose_family with a per-SpriteID branch in CODE_0EB1D4
; that selects ambient-spawn ($1DF damage burst vs custom). Green
; Needlenose ($0E5) emits NO ambient particle while Yellow ($0F9)
; emits $1DF -- mechanically identical except for the visual trail.
; Thunder Lakitu Fireball ($0A2) is the ONLY family member that gets
; a second collision pass per frame (more aggressive than its silent-
; pellet cousins). $099 / $11D are the Spiny Egg projectile flavors.

YI_NorSpr099_SpinyEgg_Init:
YI_NorSpr0A2_ThunderLakituFireball_Init:
YI_NorSpr0E5_GreenNeedlenose_Init:
YI_NorSpr0F9_YellowNeedlenose_Init:
YI_NorSpr11D_SpinyEgg_Init:
init_needlenose_family:
;$0EB1B2
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Spiny Egg + Green/Yellow Needlenose main (shared). Raiden: main_green_needlenose.
;---------------------------------------------------------------------------
YI_NorSpr099_SpinyEgg_Main:
YI_NorSpr0E5_GreenNeedlenose_Main:
YI_NorSpr0F9_YellowNeedlenose_Main:
YI_NorSpr11D_SpinyEgg_Main:
main_needlenose_family:
;$0EB1B3
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_main_thunder_lakitu_fireball
	JSR.w CODE_0EB27C
;---------------------------------------------------------------------------
; Sprite $0A2: Thunder Lakitu fireball -- own Main (different from rest of family).
;---------------------------------------------------------------------------
YI_NorSpr0A2_ThunderLakituFireball_Main:
CODE_main_thunder_lakitu_fireball:
CODE_0EB1BE:
	JSL.l CODE_03AF23
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0A2_ThunderLakituFireball
	BNE.b CODE_0EB1CD
	JSR.w CODE_0EB27C
CODE_0EB1CD:
	JSR.w CODE_0EB1D4
	JSR.w CODE_0EB23F
	RTL

CODE_0EB1D4:
	LDA.w $7A38,x
	ORA.w $7A98,x
	BNE.b CODE_0EB23E
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0A2_ThunderLakituFireball
	BNE.b CODE_0EB20A
	LDA.w #!Define_YI_AmbSpr20F
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0001
	STA.w $7782,y
	RTS

CODE_0EB20A:
	CMP.w #!Define_YI_NorSpr0F9_YellowNeedlenose
	BEQ.b CODE_0EB21A
	CMP.w #!Define_YI_NorSpr0E5_GreenNeedlenose
	BEQ.b CODE_0EB23E
	LDA.w #$0008
	STA.w $7A98,x
CODE_0EB21A:
	LDA.w #!Define_YI_AmbSpr1DF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$0004
	STA.w $7782,y
	INC
	STA.w $73C2,y
	STA.w $7E4C,y
	INC
	STA.w $7462,y
CODE_0EB23E:
	RTS

CODE_0EB23F:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0EB25C
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0EB26F
	LDA.w $7D38,y
	BEQ.b CODE_0EB26F
	TYX
	JSL.l CODE_03B25B
CODE_0EB257:
	PLA
	JML.l CODE_03B25B

CODE_0EB25C:
	INY
	BEQ.b CODE_0EB26F
	LDY.b $18,x
	BEQ.b CODE_0EB26B
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BEQ.b CODE_0EB26F
CODE_0EB26B:
	JSL.l CODE_03A858
CODE_0EB26F:
	RTS

DATA_0EB270:
	dw $0018,$0010,$0008,$0000

DATA_0EB278:
	dw $0200,$FE00

CODE_0EB27C:
	LDY.b $18,x
	BNE.b CODE_0EB26F
	LDA.w $7860,x
	AND.w #$000F
	BEQ.b CODE_0EB2DD
	LDY.b #$00
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_0EB2A2
	INY
	INY
	BIT.w #$0002
	BNE.b CODE_0EB2A2
	INY
	INY
	BIT.w #$0004
	BNE.b CODE_0EB2A2
	INY
	INY
CODE_0EB2A2:
	LDA.w DATA_0EB270,y
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	REP.b #$10
	TAX
	LDA.l $70000C,x
	AND.w #$F800
	CMP.w #$4000
	BNE.b CODE_0EB2CE
	LDA.l $700008,x
	STA.w $0091
	LDA.l $70000A,x
	STA.w $0093
	SEP.b #$10
	LDX.b $12
	JSL.l CODE_0DA479
CODE_0EB2CE:
	SEP.b #$10
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0A2_ThunderLakituFireball
	BEQ.b CODE_0EB302
	JMP.w CODE_0EB257

CODE_0EB2DD:
	LDY.w $7223,x
	BPL.b CODE_0EB301
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_0EB301
	LDA.w DATA_0EB270
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	REP.b #$10
	TAX
	LDA.l $70000C,x
	AND.w #$0004
	BNE.b CODE_0EB2CE
	SEP.b #$10
	LDX.b $12
CODE_0EB301:
	RTS

CODE_0EB302:
	LDA.w #$004A
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0EB358
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$000B
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	INC
	STA.w $7B58,y
	LDA.w #$0003
	STA.w $7A98,y
	INC
	STA.w $7BB8,y
	LDY.b #$02
CODE_0EB32D:
	PHY
	LDA.w DATA_0EB278,y
	STA.b $00
	LDA.w #$0049
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0EB357
	LDA.w $70E2,x
	STA.w $70E2,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	PLY
	DEY
	DEY
	BPL.b CODE_0EB32D
	BRA.b CODE_0EB358

CODE_0EB357:
	PLY
CODE_0EB358:
	LDA.w #$0020
	STA.w $61C6
	LDA.w #!Define_YI_SoundID3E_Tongue
	JSL.l CODE_push_sound_queue
	PLA
	JML.l CODE_03A31E

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0FA: Flower (decorative). Raiden: init_flower.
;---------------------------------------------------------------------------
YI_NorSpr0FA_Flower_Init:
init_flower:
;$0EB36A
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0EB374
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0EB37F
CODE_0EB374:
	STA.b $04
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSL.l CODE_03D40E
	BRA.b CODE_0EB383

CODE_0EB37F:
	JSL.l CODE_03D406
CODE_0EB383:
	LDA.w $7722,x
	BPL.b CODE_0EB397
	JSL.l CODE_03AE60
	LDA.w #$0100
	STA.w $7A36,x
	JSR.w CODE_0EB3CF
	BRA.b CODE_0EB39B

CODE_0EB397:
	JSL.l CODE_03AA52
CODE_0EB39B:
	JSL.l CODE_02A007
	RTL

;---------------------------------------------------------------------------

DATA_0EB3A0:
	dw CODE_0EB41A
	dw CODE_0EB42A
	dw CODE_0EB457
	dw CODE_0EB525

DATA_0EB3A8:
	dw FXDATA_540000+$4010,FXDATA_540000+$4020

;---------------------------------------------------------------------------
; Sprite $0FA main. Raiden: main_flower.
;---------------------------------------------------------------------------
YI_NorSpr0FA_Flower_Main:
main_flower:
;$0EB3AC
	JSL.l CODE_03AA52
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0EB3A0,x)
	JSR.w CODE_0EB3C0
	RTL

CODE_0EB3C0:
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0003
	BNE.b CODE_0EB419
CODE_0EB3CF:
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDY.b $78,x
	PHP
	LDA.w DATA_0EB3A8,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$4010)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	PLP
	BEQ.b CODE_0EB40B
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_0EB414

CODE_0EB40B:
	LDX.b #FXCODE_08835F>>16
	LDA.w #FXCODE_08835F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_0EB414:
	LDX.b $12
	INC.w $0CF9
CODE_0EB419:
	RTS

CODE_0EB41A:
	TYX
	LDY.b #$04
	STY.b $16,x
	INC.b $76,x
	RTS

DATA_0EB422:
	dw $0100,$0150

DATA_0EB426:
	dw $0100,$00B0

CODE_0EB42A:
	TYX
	LDY.b $16,x
	LDA.w $7A36,x
	CLC
	ADC.w #$0010
	CMP.w DATA_0EB422-$02,y
	BMI.b CODE_0EB44F
	LDA.w #$0002
	STA.b $78,x
	DEC.b $16,x
	DEC.b $16,x
	BNE.b CODE_0EB44C
	LDA.w #$000C
	STA.w $7A98,x
	INC.b $76,x
CODE_0EB44C:
	LDA.w DATA_0EB426-$02,y
CODE_0EB44F:
	STA.w $7A36,x
	RTS

DATA_0EB453:
	dw $0002,$FFFE

CODE_0EB457:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0EB46A
	LDA.w #$0018
	STA.w $7A98,x
	LDA.b $16,x
	EOR.w #$0002
	STA.b $16,x
CODE_0EB46A:
	LDY.b $16,x
	LDA.w $7A38,x
	CLC
	ADC.w DATA_0EB453,y
	AND.w #$01FE
	STA.w $7A38,x
CODE_0EB479:
	LDY.w $7D36,x
	BNE.b CODE_0EB47F
CODE_0EB47E:
	RTS

CODE_0EB47F:
	BMI.b CODE_0EB494
	LDA.w $6EFF,y
	CMP.w #$0010
	BNE.b CODE_0EB47E
	LDA.w $7D37,y
	BEQ.b CODE_0EB47E
	DEY
	TYX
	JSL.l CODE_03B25B
CODE_0EB494:
	JSL.l CODE_0EB4AE
	RTS

CODE_0EB499:
	PHB
	PHK
	PLB
	PHD
	LDA.w #$7960
	TCD
	LDY.b $76,x
	CPY.b #$02
	BNE.b CODE_0EB4AB
	JSL.l CODE_0EB4AE
CODE_0EB4AB:
	PLD
	PLB
	RTL

CODE_0EB4AE:
	LDA.w #$0020
	STA.w $7AF6,x
	LDA.w #$00FF
	STA.w $74A2,x
	INC.b $76,x
	INC.w !RAM_YI_Level_FlowersCollectedLo
	LDY.w !RAM_YI_Level_FlowersCollectedLo
	CPY.b #$05
	BCC.b CODE_0EB4E8
	LDY.b #$05
	STY.w !RAM_YI_Level_FlowersCollectedLo
	LDA.w $7CD6,x
	SEC
	SBC.w #$0008
	STA.w $0000
	LDA.w $7CD8,x
	SEC
	SBC.w #$0008
	STA.w $0002
	JSL.l CODE_03A4A2
	LDA.w #!Define_YI_SoundID08_1up
	BRA.b CODE_0EB4EB

CODE_0EB4E8:
	LDA.w #!Define_YI_SoundID36_CollectFlower
CODE_0EB4EB:
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr1CD
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$000B
	STA.w $7E4C,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0EB518
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0EB521
CODE_0EB518:
	STA.b $04
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JML.l CODE_03D3F3

CODE_0EB521:
	JML.l CODE_03D3EB

CODE_0EB525:
	TYX
	LDA.w $7AF6,x
	BNE.b CODE_0EB54D
	LDA.w !RAM_YI_Level_TutorialMessageFlagsLo
	AND.w #!Define_YI_TutorialMessage_FirstFlower
	ORA.w !RAM_YI_Level_CurrentLevelFromMapLo			; Note: !Define_YI_LevelID_MakeEggsThrowEggs
	BNE.b CODE_0EB549
	LDA.w !RAM_YI_Level_TutorialMessageFlagsLo
	ORA.w #!Define_YI_TutorialMessage_FirstFlower
	STA.w !RAM_YI_Level_TutorialMessageFlagsLo
	LDA.w #$002D
	STA.l $704070
	INC.w !RAM_YI_Level_MessageBoxState 
CODE_0EB549:
	JSL.l CODE_despawn_sprite_free_slot
CODE_0EB54D:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $110: Second Flower variant. Raiden: init_flower_2.
;---------------------------------------------------------------------------
YI_NorSpr110_Flower_Init:
init_flower_2:
;$0EB54E
	JSL.l CODE_03D406
	JSL.l CODE_02A007
	RTL

;---------------------------------------------------------------------------

DATA_0EB557:
	dw CODE_0EB56C
	dw CODE_0EB586
	dw CODE_0EB5A5
	dw CODE_0EB525

;---------------------------------------------------------------------------
; Sprite $110 main. Raiden: main_flower_2.
;---------------------------------------------------------------------------
YI_NorSpr110_Flower_Main:
main_flower_2:
;$0EB55F
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0EB557,x)
	RTL

CODE_0EB56C:
	TYX
	LDA.w $7680,x
	AND.w #$FF00
	STA.b $00
	LDA.w $7682,x
	AND.w #$FF00
	ORA.b $00
	BNE.b CODE_0EB585
	LDY.b #$09
	STY.b $16,x
	INC.b $76,x
CODE_0EB585:
	RTS

CODE_0EB586:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0EB5A4
	LDA.w #$0002
	STA.w $7A98,x
	INC.w $7402,x
	LDY.w $7402,x
	CPY.b #$04
	BMI.b CODE_0EB5A4
	LDA.w #$0008
	STA.w $7A98,x
	INC.b $76,x
CODE_0EB5A4:
	RTS

CODE_0EB5A5:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0EB5D8
	LDA.w #$0004
	STA.w $7A98,x
	LDA.b $16,x
	CMP.w $7402,x
	BMI.b CODE_0EB5BD
	INC.w $7402,x
	BRA.b CODE_0EB5C0

CODE_0EB5BD:
	DEC.w $7402,x
CODE_0EB5C0:
	LDA.b $16,x
	CMP.w $7402,x
	BNE.b CODE_0EB5D8
	TAY
	LDA.w #$0008
	STA.w $7A98,x
	LSR
	CPY.b #$04
	BNE.b CODE_0EB5D6
	LDA.w #$0009
CODE_0EB5D6:
	STA.b $16,x
CODE_0EB5D8:
	JSR.w CODE_0EB479
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $09D: Red POW switch. Raiden: init_red_pow_switch.
;---------------------------------------------------------------------------
YI_NorSpr09D_RedSwitch_Init:
init_red_pow_switch:
;$0EB5DC
	JSL.l CODE_03AE60
	LDA.w #$0100
	STA.w $7A36,x
	STA.w $7A38,x
	JSR.w CODE_0EB6A1
	LDA.w #$000C
	STA.w $7BB6,x
	LDA.w #$0012
	STA.w $7BB8,x
	RTL

;---------------------------------------------------------------------------

DATA_0EB5F9:
	dw CODE_0E8000
	dw CODE_0EB6FF
	dw CODE_0EB76D
	dw CODE_0EB807

;---------------------------------------------------------------------------
; Sprite $09D main. Raiden: main_red_pow_switch.
;---------------------------------------------------------------------------
YI_NorSpr09D_RedSwitch_Main:
main_red_pow_switch:
;$0EB601
	LDY.b $76,x
	CPY.b #$03
	BEQ.b CODE_0EB60E
	JSL.l CODE_03AA52
	JSR.w CODE_0EB61A
CODE_0EB60E:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0EB5F9,x)
	JSR.w CODE_0EB698
	RTL

CODE_0EB61A:
	LDY.w $74A2,x
	BMI.b CODE_0EB697
	LDY.w $60AB
	BMI.b CODE_0EB697
	LDA.w $7BB6,x
	CLC
	ADC.w $6120
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7C16,x
	CMP.b $00
	BCS.b CODE_0EB697
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	SEC
	SBC.w $7BB8,x
	SEC
	SBC.w $611E
	SEC
	SBC.w $6122
	LDY.b $76,x
	CPY.b #$01
	BEQ.b CODE_0EB65C
	CPY.b #$02
	BEQ.b CODE_0EB65C
	CMP.w #$FFF8
	BCC.b CODE_0EB697
	STX.w $1011
CODE_0EB65C:
	INC
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60AA
	INC.w $61B4
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0EB697
	LDY.b $76,x
	BNE.b CODE_0EB697
	LDA.w $60A8
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $60A8
	STZ.w $60B4
	LDA.w #!Define_YI_PlayerState02_InCutscene
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	INC.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	INC.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	INC.b $76,x
	LDA.w #!Define_YI_SoundID33_StepOnNumberPlatform
	JSL.l CODE_push_sound_queue
CODE_0EB697:
	RTS

CODE_0EB698:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	BEQ.b CODE_0EB6FE
	CPY.b #$03
	BPL.b CODE_0EB6FE
CODE_0EB6A1:
	LDA.w #$0C00
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$1200
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #(FXDATA_540000+$00C1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_540000+$00C1
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
	LDX.b #FXCODE_08D984>>16
	LDA.w #FXCODE_08D984
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $6020
	STA.w $7BB6,x
	LDA.w $6022
	STA.w $7BB8,x
	INC.w $0CF9
CODE_0EB6FE:
	RTS

CODE_0EB6FF:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0EB6FE
	LDA.w $7A38,x
	SEC
	SBC.w #$0040
	AND.w #$FFF8
	LSR
	LSR
	INC
	INC
	STA.b $02
	LSR
	CLC
	ADC.w #$0004
	STA.b $04
	LDA.w #$0002
	STA.b $00
	LDA.w $7A36,x
	CLC
	ADC.b $04
	CMP.w #$0180
	BMI.b CODE_0EB734
	DEC.b $00
	LDA.w #$0180
CODE_0EB734:
	STA.w $7A36,x
	LDA.w $7A38,x
	SEC
	SBC.b $02
	CMP.w #$0040
	BPL.b CODE_0EB747
	DEC.b $00
	LDA.w #$0040
CODE_0EB747:
	STA.w $7A38,x
	LDY.b $00
	BNE.b CODE_0EB76C
	LDA.w $7042,x
	AND.w #$0020
	ORA.w #$0004
	STA.w $7042,x
	STZ.w $039E
	LDA.w #$0008
	TSB.w $7E08
	LDA.w #!Define_YI_SoundID32_HitMessageBox
	JSL.l CODE_push_sound_queue
	INC.b $76,x
CODE_0EB76C:
	RTS

CODE_0EB76D:
	TYX
	LDA.w $7A38,x
	SEC
	SBC.w #$0040
	AND.w #$FFF4
	INC
	INC
	STA.b $02
	LSR
	CLC
	ADC.w #$0004
	STA.b $04
	LDY.b #$02
	STY.b $00
	LDA.w $7A36,x
	SEC
	SBC.b $04
	CMP.w #$0100
	BPL.b CODE_0EB797
	DEC.b $00
	LDA.w #$0100
CODE_0EB797:
	STA.w $7A36,x
	LDA.w $7A38,x
	CLC
	ADC.b $02
	CMP.w #$0100
	BMI.b CODE_0EB7AA
	DEC.b $00
	LDA.w #$0100
CODE_0EB7AA:
	STA.w $7A38,x
	LDY.b $00
	BNE.b CODE_0EB806
	LDA.w $7CD6,x
	STA.b $00
	LDA.w $7CD8,x
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1E7
	JSL.l CODE_spawn_ambient_stomp_puff_common
	LDA.w #$0280
	STA.w !RAM_YI_Level_RedSwitchTimer
	LDA.w #$00FF
	STA.w $74A2,x
	LDA.w #!Define_YI_PlayerState00_Normal
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$FA00
	STA.w $60AA
	LDA.w #$0100
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BPL.b CODE_0EB7EB
	LDA.w #$FF00
CODE_0EB7EB:
	STA.w $60A8
	STA.w $60B4
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w $61B4
	LDA.w #$2001
	STA.w $7040,x
	JSL.l CODE_03AEFD
	INC.b $76,x
CODE_0EB806:
	RTS

CODE_0EB807:
	TYX
	CPX.w $1011
	BNE.b CODE_0EB818
	LDA.w !RAM_YI_Level_RedSwitchTimer
	BNE.b CODE_0EB81D
	LDA.w #$0008
	TRB.w $7E08
CODE_0EB818:
	PLA
	JML.l CODE_03A31E

CODE_0EB81D:
	LDA.w $7A98,x
	BNE.b CODE_0EB838
	LDA.w #$0040
	STA.w $7A98,x
	LDY.b #!Define_YI_SoundID7E_SwitchTicking
	LDA.w !RAM_YI_Level_RedSwitchTimer
	CMP.w #$00C0
	BPL.b CODE_0EB833
	INY
CODE_0EB833:
	TYA
	JSL.l CODE_push_sound_queue
CODE_0EB838:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $156: Cactus Jack. Raiden: init_cactus_jack.
;---------------------------------------------------------------------------
YI_NorSpr156_CactusJack_Init:
init_cactus_jack:
;$0EB839
	JSL.l CODE_03AE60
	LDA.w #$0100
	STA.b $78,x
	DEC.b $18,x
	LDA.w #$0006
	STA.w $7BB6,x
	STA.w $7BB8,x
	STZ.w $7400,x
	LDA.w $7974
	STA.w $75E0,x
	JSL.l CODE_0EB8AE
	BNE.b CODE_0EB88C
	LDA.w $7042,x
	EOR.w #$0030
	STA.w $7042,x
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,x
	SEC
	SBC.w #$0020
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w $70E2,x
	BIT.w #$0010
	BEQ.b CODE_0EB888
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_0EB888:
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTL

CODE_0EB88C:
	JSR.w CODE_0EB8DC
	LDA.b $02
	SEC
	SBC.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$00FF
	STA.w $74A2,x
	LDA.w $70E2,x
	BIT.w #$0010
	BEQ.b CODE_0EB8A9
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_0EB8A9:
	LDY.b #$02
	STY.b $76,x
	RTL

;---------------------------------------------------------------------------

CODE_0EB8AE:
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
CODE_0EB8B7:
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$79F1
	BEQ.b CODE_0EB8DB
	CMP.w #$79F2
	BEQ.b CODE_0EB8DB
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$F800
	CMP.w #$A000
CODE_0EB8DB:
	RTL

;---------------------------------------------------------------------------

CODE_0EB8DC:
	LDA.w $70E2,x
	STA.b $00
	LDA.w #$0010
	STA.b $04
	CLC
	ADC.w $7182,x
	STA.b $02
	STA.b $06
CODE_0EB8EE:
	LDA.b $00
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b $02
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$0003
	BNE.b CODE_0EB91B
	DEC.b $04
	BMI.b CODE_0EB917
	LDA.b $02
	CLC
	ADC.w #$0010
	STA.b $02
	BRA.b CODE_0EB8EE

CODE_0EB917:
	LDA.b $06
	STA.b $02
CODE_0EB91B:
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

DATA_0EB91E:
	dw CODE_0EBD1E
	dw CODE_0EBD67
	dw CODE_0EBD87
	dw CODE_0EBDA9
	dw CODE_0EBE5E
	dw CODE_0EBE6A
	dw CODE_0E8000
	dw CODE_0E8000

;---------------------------------------------------------------------------
; Sprite $156 main. Raiden: main_cactus_jack.
;---------------------------------------------------------------------------
YI_NorSpr156_CactusJack_Main:
main_cactus_jack:
;$0EB92E
	STZ.w $7400,x
	JSL.l CODE_03AA52
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_0EB958
	CMP.w #$0008
	BNE.b CODE_0EB955
	LDY.w $74A2,x
	BPL.b CODE_0EB958
	LDA.b $18,x
	INC
	BEQ.b CODE_0EB955
	INC
	BEQ.b CODE_0EB955
	LDA.w #$FFFF
	STA.w $7722,x
CODE_0EB955:
	JSR.w CODE_0EBBD2
CODE_0EB958:
	LDY.b $76,x
	CPY.b #$04
	BEQ.b CODE_0EB962
	CPY.b #$05
	BNE.b CODE_0EB975
CODE_0EB962:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_0EB997
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_0EB979
CODE_0EB975:
	JSL.l CODE_03AF23
CODE_0EB979:
	JSR.w CODE_0EB998
	LDY.w $74A2,x
	BMI.b CODE_0EB987
	JSR.w CODE_0EB99F
	JSR.w CODE_0EB9DB
CODE_0EB987:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0EB91E,x)
	LDY.w $74A2,x
	BMI.b CODE_0EB997
	JSR.w CODE_0EBC3B
CODE_0EB997:
	RTL

CODE_0EB998:
	JSL.l CODE_03A2C7
	BCS.b CODE_0EB9CB
CODE_0EB99E:
	RTS

CODE_0EB99F:
	LDY.b $76,x
	CPY.b #$04
	BNE.b CODE_0EB99E
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_0EB99E
	LDA.w $7CD6,x
	STA.b $00
	LDA.w $7CD8,x
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1E6
	JSL.l CODE_spawn_ambient_stomp_puff_common
	JSL.l CODE_05AE0B
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
CODE_0EB9CB:
	JSR.w CODE_0EBB67
	PLA
	RTL

DATA_0EB9D0:
	dw $0200,$FE00

DATA_0EB9D4:
	db !Define_YI_SoundID0C_ShellHit2,!Define_YI_SoundID0D_ShellHit3,!Define_YI_SoundID0E_ShellHit4,!Define_YI_SoundID0F_ShellHit5
	db !Define_YI_SoundID10_ShellHit6,!Define_YI_SoundID11_ShellHit7,!Define_YI_SoundID12_ShellHit8

CODE_0EB9DB:
	LDA.w $6FA0,x
	AND.w #$0600
	BEQ.b CODE_0EB99E
	LDY.w $7D36,x
	BPL.b CODE_0EB9F1
	LDA.w $7AF8,x
	BNE.b CODE_0EB9F1
	JSL.l CODE_03A858
CODE_0EB9F1:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.b $76,x
	CPY.b #$04
	BNE.b CODE_0EBA12
	JMP.w CODE_0EBAB7

CODE_0EBA09:
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_0EBA12:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	DEY
	BMI.b CODE_0EB99E
	LDA.w $6F01,y
	CMP.w #$0010
	BNE.b CODE_0EBA09
	LDA.w $7D39,y
	BEQ.b CODE_0EBA09
	LDA.w $6FA3,y
	AND.w #$4000
	BNE.b CODE_0EBA09
	LDA.w $7361,y
	CMP.w #$0156
	BNE.b CODE_0EBA54
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D7|!EXRAMBankMirror,y
	CMP.w #$0004
	BNE.b CODE_0EBA54
	LDA.w $6FA1,y
	AND.w #$0200
	BEQ.b CODE_0EBA09
	LDA.w $75E0,x
	CMP.w $75E1,y
	BEQ.b CODE_0EBA09
	LDX.b $12
	JMP.w CODE_0EBB38

CODE_0EBA54:
	LDA.w $7543,y
	CMP.w #$0040
	PHP
	STZ.b $16,x
	LDA.w $7221,y
	BPL.b CODE_0EBA67
	LDA.w #$0002
	STA.b $16,x
CODE_0EBA67:
	INY
	TYX
	JSL.l CODE_03B24B
	STZ.w $6FA2,x
	PLP
	BMI.b CODE_0EBA76
	JMP.w CODE_0EBB38

CODE_0EBA76:
	LDA.w #$0003
	STA.w $6FA2,x
	LDY.b $16,x
	LDA.w DATA_0EB9D0,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $18,x
	INC
	BEQ.b CODE_0EBA8D
	JSL.l CODE_03AD74
CODE_0EBA8D:
	LDY.b #$04
	STY.b $76,x
	LDA.w #!Define_YI_SoundID67_EnemyTumbling
	JSL.l CODE_push_sound_queue
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0060
	STA.w $7542,x
	LDA.w #$0001
	STA.w $7D38,x
	JSR.w CODE_0EBBD2
CODE_0EBAAD:
	RTS

CODE_0EBAAE:
	LDX.b #FXCODE_09907B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_0EBAB7:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	DEY
	BMI.b CODE_0EBAAD
	INY
	LDA.w $6FA2,y
	AND.w #$4000
	BNE.b CODE_0EBAAE
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0EBAAE
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr156_CactusJack
	BNE.b CODE_0EBAF9
	LDA.w $6FA0,y
	AND.w #$0200
	BEQ.b CODE_0EBAF8
	LDA.w $75E0,x
	CMP.w $75E0,y
	BEQ.b CODE_0EBAAE
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CMP.w #$0004
	PHP
	TYX
	JSR.w CODE_0EBB38
	LDX.b $12
	PLP
	BEQ.b CODE_0EBB38
CODE_0EBAF8:
	RTS

CODE_0EBAF9:
	LDA.w $6FA2,y
	AND.w #$6000
	BNE.b CODE_0EBAAE
	LDA.w $6FA0,y
	AND.w #$0020
	BNE.b CODE_0EBAAE
	INC.w $7A36,x
	LDA.w $7A36,x
	CMP.w #$0008
	BCC.b CODE_0EBB1D
	LDA.w $7040,y
	ORA.w #$0600
	STA.w $7040,y
CODE_0EBB1D:
	JSR.w CODE_0EC413
	LDX.b $12
	LDA.w $7A36,x
	CMP.w #$0008
	BCS.b CODE_0EBAAE
	TAY
	LDA.w DATA_0EB9D4-$01,y
	AND.w #$00FF
	JSL.l CODE_push_sound_queue
	JMP.w CODE_0EBAAE

CODE_0EBB38:
	LDA.w #$6862
	STA.w $6FA0,x
	STZ.w $6FA2,x
	LDA.b $18,x
	INC
	BEQ.b CODE_0EBB4A
	JSL.l CODE_03AD74
CODE_0EBB4A:
	LDY.b #$04
	STY.b $76,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0060
	STA.w $7542,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	JSR.w CODE_0EBBD2
	RTS

CODE_0EBB67:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0EBB74
	BIT.w #$0001
	BNE.b CODE_0EBB85
	JSR.w CODE_0EBBD2
CODE_0EBB74:
	LDA.b $18,x
	INC
	BEQ.b CODE_0EBB7F
	LDA.w #$FFFF
	STA.w $7722,x
CODE_0EBB7F:
	PLA
	PLA
	JML.l CODE_03A31E

CODE_0EBB85:
	SEC
	SBC.w $6094
	CLC
	ADC.w #$0040
	CMP.w #$0180
	BCS.b CODE_0EBB74
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEC
	SBC.w $609C
	CLC
	ADC.w #$0040
	CMP.w #$0180
	BCS.b CODE_0EBB74
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w #$0020
	STA.w $7182,x
	STZ.w $7542,x
	LDA.w $7042,x
	EOR.w #$0030
	STA.w $7042,x
	STZ.b $76,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0100
	STA.b $78,x
	STZ.w $7A38,x
	STZ.w $6FA2,x
	RTS

CODE_0EBBD2:
	LDY.b $18,x
	BMI.b CODE_0EBC14
	STY.b $00
	LDY.b $19,x
	BMI.b CODE_0EBBF7
	SEP.b #$20
	LDX.b $00
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	STY.b $19,x
	REP.b #$20
	LDA.w #$0060
	STA.w $7542,x
	LDA.w #$0006
	STA.b $76,x
	LDX.b $12
	BRA.b CODE_0EBC21

CODE_0EBBF7:
	SEP.b #$20
	TYA
	LDY.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701979|!EXRAMBankMirror,y
	REP.b #$20
	LDA.w #$0060
	STA.w $7542,y
	LDA.b $78,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.w #$0003
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	BRA.b CODE_0EBC27

CODE_0EBC14:
	LDY.b $19,x
	BMI.b CODE_0EBC35
	SEP.b #$20
	LDA.b #$FF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	REP.b #$20
CODE_0EBC21:
	LDA.w #$0080
	STA.w $7A96,y
CODE_0EBC27:
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	LDA.w #$FFFE
	BRA.b CODE_0EBC38

CODE_0EBC35:
	LDA.w #$FFFF
CODE_0EBC38:
	STA.b $18,x
CODE_0EBC3A:
	RTS

CODE_0EBC3B:
	LDA.w #(FXDATA_550000+$6060)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_550000+$6060
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDY.b $76,x
	CPY.b #$04
	BNE.b CODE_0EBC50
	JMP.w CODE_0EBCED

CODE_0EBC50:
	LDY.b $19,x
	BPL.b CODE_0EBC3A
	LDA.b $78,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	PHA
	CMP.w #$0100
	BPL.b CODE_0EBC69
	ASL
	EOR.w #$FFFF
	CLC
	ADC.w #$0301
	BRA.b CODE_0EBC70

CODE_0EBC69:
	EOR.w #$FFFF
	CLC
	ADC.w #$01C1
CODE_0EBC70:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
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
	INC.w $0CF9
	PLA
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0014
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.b $18,x
	BMI.b CODE_0EBCEC
	LDA.w $7182,x
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $00
CODE_0EBCBD:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CMP.w #$0006
	BNE.b CODE_0EBCDB
	LDA.b $00
	CMP.w $7182,y
	BPL.b CODE_0EBCEC
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w $7542,y
	LDA.w #$0007
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
CODE_0EBCDB:
	LDA.b $00
	STA.w $7182,y
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	TAY
	BPL.b CODE_0EBCBD
CODE_0EBCEC:
	RTS

CODE_0EBCED:
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
	INC.w $0CF9
	RTS

CODE_0EBD1E:
	TYX
	LDY.w $7542,x
	BEQ.b CODE_0EBD46
	LDY.w $7223,x
	BMI.b CODE_0EBD5E
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w $7182,x
	BPL.b CODE_0EBD5E
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w $7042,x
	EOR.w #$0030
	STA.w $7042,x
	INC.b $76,x
	RTS

CODE_0EBD46:
	LDA.w $7C16,x
	CLC
	ADC.w #$0050
	CMP.w #$00A0
	BCS.b CODE_0EBD5E
	LDA.w #$0060
	STA.w $7542,x
	LDA.w #$FA00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0EBD5E:
	RTS

DATA_0EBD5F:
	dw $FFFC,$0008

DATA_0EBD63:
	dw $00E0,$0140

CODE_0EBD67:
	TYX
	LDY.b $16,x
	LDA.b $78,x
	CLC
	ADC.w DATA_0EBD5F,y
	CMP.w #$00E0
	BMI.b CODE_0EBD7A
	CMP.w #$0140
	BMI.b CODE_0EBD84
CODE_0EBD7A:
	LDA.b $16,x
	EOR.w #$0002
	STA.b $16,x
	LDA.w DATA_0EBD63,y
CODE_0EBD84:
	STA.b $78,x
	RTS

CODE_0EBD87:
	TYX
	LDY.w $7681,x
	BNE.b CODE_0EBDA8
	LDA.w $609C
	SEC
	SBC.w #$0020
	STA.w $7182,x
	LDA.w #$0060
	STA.w $7542,x
	LDA.w #$0005
	STA.w $74A2,x
	STZ.w $6FA2,x
	INC.b $76,x
CODE_0EBDA8:
	RTS

CODE_0EBDA9:
	TYX
	LDA.w $7542,x
	BEQ.b CODE_0EBDCC
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w $7182,x
	BPL.b CODE_0EBDCB
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w $7A96,x
	BNE.b CODE_0EBDCB
	LDA.w #$0040
	STA.w $7A96,x
CODE_0EBDCB:
	RTS

CODE_0EBDCC:
	JSR.w CODE_0EBD67
	JSR.w CODE_0EB8DC
	LDA.b $02
	SEC
	SBC.w #$0010
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0EBDE7
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0060
	STA.w $7542,x
	RTS

CODE_0EBDE7:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0EBDCB
	LDY.b $18,x
	BMI.b CODE_0EBDF6
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	TAY
	BPL.b CODE_0EBDCB
CODE_0EBDF6:
	LDA.w $7A96,x
	BNE.b CODE_0EBE5D
	LDA.w #$0156
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0EBE5D
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $70E2,y
	LDA.w $609C
	SEC
	SBC.w #$0020
	STA.w $7182,y
	LDA.w #$0060
	STA.w $7542,y
	LDA.w $7722,x
	STA.w $7722,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDA.w #$0006
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w $75E0,x
	STA.w $75E0,y
	SEP.b #$20
	LDA.w $74A0,x
	STA.w $74A0,y
	LDA.b #$FF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	BMI.b CODE_0EBE4B
	TAX
CODE_0EBE4B:
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701979|!EXRAMBankMirror,y
	TYA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	LDX.b $12
	REP.b #$20
	LDA.w #$0040
	STA.w $7A96,x
CODE_0EBE5D:
	RTS

CODE_0EBE5E:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_0EBE67
	INC.b $76,x
	RTS

CODE_0EBE67:
	JMP.w CODE_0EC858

CODE_0EBE6A:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0EBE8C
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w $7D38,x
	LDY.b #$03
	STY.b $76,x
CODE_0EBE8C:
	RTS

CODE_0EBE8D:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr156_CactusJack
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $09E: Chomp Rock (push-able boulder). Raiden: init_chomp_rock.
;---------------------------------------------------------------------------
YI_NorSpr09E_ChompRock_Init:
init_chomp_rock:
;$0EBE94
	JSL.l CODE_03AE60
	LDY.w !RAM_YI_Level_CurrentLevelFromMapLo
	BNE.b CODE_0EBEA6
	LDY.w !RAM_YI_Level_LevelHeaderItemMemorySettingLo
	CPY.b #$01
	BEQ.b CODE_0EBEB3
	BRA.b CODE_0EBEC8

CODE_0EBEA6:
	CPY.b #$28
	BNE.b CODE_0EBEC8
	LDY.w $0E29
	BEQ.b CODE_0EBEB3
	JML.l CODE_03A31E

CODE_0EBEB3:
	INC.w $0E29
	LDA.w #$2001
	STA.w $7040,x
	LDA.w $7042,x
	AND.w #$FFF0
	ORA.w #$0008
	STA.w $7042,x
CODE_0EBEC8:
	JSR.w CODE_0EC869
	LDA.w #$000C
	STA.w $7BB6,x
	STA.w $7BB8,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $09E main. Raiden: main_chomp_rock.
;---------------------------------------------------------------------------
YI_NorSpr09E_ChompRock_Main:
main_chomp_rock:
;$0EBED5
	JSL.l CODE_03A2C7
	BCC.b CODE_0EBEE8
	JSR.w CODE_0EBF49
	JSR.w CODE_0EC54A
	JSR.w CODE_0EC71A
	JSR.w CODE_0EC858
	RTL

CODE_0EBEE8:
	JSL.l CODE_03AA52
	JSL.l CODE_03AF23
	STZ.w $7400,x
	JSR.w CODE_0EBF49
	JSL.l CODE_0EC365
	JSR.w CODE_0EBFBB
	JSR.w CODE_0EC54A
	JSR.w CODE_0EC71A
	JSR.w CODE_0EC858
	JSR.w CODE_0EC869
	JSR.w CODE_0EC8A3
	STZ.w $7542,x
	LDA.w $7A98,x
	BNE.b CODE_0EBF1A
	LDA.w #$0040
	STA.w $7542,x
CODE_0EBF1A:
	JSR.w CODE_0EC8C4
	LDA.w #$400E
	STA.w $6FA2,x
	LDA.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	AND.w #$00FF
	TAY
	BEQ.b CODE_0EBF3C
	BPL.b CODE_0EBF31
	ORA.w #$FF00
CODE_0EBF31:
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0EBF3C
	LDA.w #$4010
	STA.w $6FA2,x
CODE_0EBF3C:
	RTL

DATA_0EBF3D:
	dw $FFFA,$0016

DATA_0EBF41:
	dw $0008,$0004

DATA_0EBF45:
	dw $0000,$0008

CODE_0EBF49:
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,X
	BMI.b CODE_0EBF52
	INY
	INY
CODE_0EBF52:
	LDA.w DATA_0EBF45,y
	STA.b $02
	LDA.w DATA_0EBF41,y
	STA.b $00
	AND.w $7860,x
	BNE.b CODE_0EBFB6
	LDA.w DATA_0EBF3D,y
	CLC
	ADC.w $70E2,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	SEC
	SBC.w #$0004
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_0EBFB6
	LDA.w $7860,x
	ORA.b $00
	STA.w $7860,x
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.b $02
	TAX
	LDA.w $6000
	STA.l $700008,x
	LDA.w $6002
	STA.l $70000A,x
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	STA.l $70000C,x
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	STA.l $70000E,x
	SEP.b #$10
	LDX.b $12
CODE_0EBFB6:
	RTS

DATA_0EBFB7:
	dw $FF00,$0100

CODE_0EBFBB:
	LDA.w $61D6
	BNE.b CODE_0EBFF6
	LDY.w $0D94
	BNE.b CODE_0EBFF6
	LDA.w $7BB6,x
	CLC
	ADC.w $6120
	ASL
	STA.b $02
	LSR
	CLC
	ADC.w $7C16,x
	CMP.b $02
	BCS.b CODE_0EBFF6
	LDA.w #$0000
	LDY.b $19,x
	BEQ.b CODE_0EBFE2
	LDA.w #$0008
CODE_0EBFE2:
	CLC
	ADC.w $7BB8,x
	CLC
	ADC.w $6122
	ASL
	STA.b $02
	LSR
	CLC
	ADC.w $7C18,x
	CMP.b $02
	BCC.b CODE_0EC01A
CODE_0EBFF6:
	STZ.b $18,x
	CPX.w $61B6
	BNE.b CODE_0EC000
	STZ.w $61B6
CODE_0EC000:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr09E_ChompRock
	BEQ.b CODE_0EC011
	CPX.w $0E2B
	BNE.b CODE_0EC019
	STZ.w $0E2B
	RTS

CODE_0EC011:
	CPX.w $0E27
	BNE.b CODE_0EC019
	STZ.w $0E27
CODE_0EC019:
	RTS

CODE_0EC01A:
	LDA.w $7C16,x
	BPL.b CODE_0EC029
	CLC
	ADC.w $6120
	CLC
	ADC.w $7BB6,x
	BRA.b CODE_0EC031

CODE_0EC029:
	SEC
	SBC.w $6120
	SEC
	SBC.w $7BB6,x
CODE_0EC031:
	STA.b $06
	LDA.w $7C18,x
	BPL.b CODE_0EC042
	CLC
	ADC.w $6122
	CLC
	ADC.w $7BB8,x
	BRA.b CODE_0EC04A

CODE_0EC042:
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
CODE_0EC04A:
	STA.b $08
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $603E
	LDY.b $18,x
	BEQ.b CODE_0EC05B
	JSR.w CODE_0EC230
	BRA.b CODE_0EC067

CODE_0EC05B:
	LDY.b $19,x
	BEQ.b CODE_0EC064
	JSR.w CODE_0EC2AA
	BRA.b CODE_0EC067

CODE_0EC064:
	JSR.w CODE_0EC06C
CODE_0EC067:
	RTS

DATA_0EC068:
	dw $FC00,$0400

CODE_0EC06C:
	LDA.b $08
	BMI.b CODE_0EC080
	CMP.w #$0008
	BCS.b CODE_0EC080
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_0EC085
	JMP.w CODE_0EC112

CODE_0EC080:
	CMP.w #$FFF6
	BCS.b CODE_0EC088
CODE_0EC085:
	JMP.w CODE_0EC154

CODE_0EC088:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr09E_ChompRock
	BEQ.b CODE_0EC09A
	CPX.w $0E2B
	BNE.b CODE_0EC0A2
	STZ.w $0E2B
	BRA.b CODE_0EC0A2

CODE_0EC09A:
	CPX.w $0E27
	BNE.b CODE_0EC0A2
	STZ.w $0E27
CODE_0EC0A2:
	LDY.w $60AB
	BMI.b CODE_0EC0B4
	LDA.w $60FC
	AND.w #$0018
	BNE.b CODE_0EC0B4
	LDY.w $61B6
	BEQ.b CODE_0EC0B5
CODE_0EC0B4:
	RTS

CODE_0EC0B5:
	JSR.w CODE_0EC1E2
	STX.w $61B6
	STZ.w $60AA
	INC.w $61B4
	INC.b $18,x
	LDA.w !EXRAM_YI_Player_SubXPosHi|!EXRAMBankMirror
	AND.w #$FF00
	STA.b $76,x
	LDA.w $7C16,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$FFE0
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b #$00
	LDA.w $60A8
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $60A8
	CLC
	ADC.w #$0400
	CMP.w #$0800
	BCC.b CODE_0EC10B
	BMI.b CODE_0EC105
	INY
	INY
CODE_0EC105:
	LDA.w DATA_0EC068,y
	STA.w $60A8
CODE_0EC10B:
	LDA.w $60A8
	STA.w $60B4
	RTS

CODE_0EC112:
	LDA.w $60FC
	AND.w #$0007
	BNE.b CODE_0EC130
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0002
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$0006
	STA.w $60C0
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w $60AA
CODE_0EC130:
	LDA.w $60FC
	AND.w #$01E0
	BEQ.b CODE_0EC149
	LDA.w $60A8
	BEQ.b CODE_0EC153
	LDA.w $60FC
	AND.w #$0180
	DEC
	EOR.w $60A8
	BMI.b CODE_0EC153
CODE_0EC149:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ASL
	STA.w $60A8
	STA.w $60B4
CODE_0EC153:
	RTS

CODE_0EC154:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr09E_ChompRock
	BEQ.b CODE_0EC1AF
	CPX.w $0E2B
	BEQ.b CODE_0EC1DD
	LDY.w $0E2B
	BNE.b CODE_0EC1B9
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_0EC173
	EOR.w $60A8
	BPL.b CODE_0EC1D5
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0EC173:
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCC.b CODE_0EC1D5
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	STA.b $02
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $60A8
	STA.w $60B4
	LDA.b $02
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	LDA.w $60FC
	AND.w #$0007
	BEQ.b CODE_0EC1AE
	LDA.w #$FC00
	STA.w $60AA
CODE_0EC1AE:
	RTS

CODE_0EC1AF:
	LDY.w $0E27
	BEQ.b CODE_0EC1DA
	CPX.w $0E27
	BEQ.b CODE_0EC1DD
CODE_0EC1B9:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w $70E2,x
	SEC
	SBC.b $06
	STA.w $70E2,x
	JSL.l CODE_03A858
	RTS

CODE_0EC1D5:
	STX.w $0E2B
	BRA.b CODE_0EC1DD

CODE_0EC1DA:
	STX.w $0E27
CODE_0EC1DD:
	JSL.l CODE_05CDF9
	RTS

CODE_0EC1E2:
	LDA.b $08
	INC
	INC
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w $611C
	SEC
	SBC.w #$0004
	STA.w $6020
	CLC
	ADC.w #$0008
	STA.w $6024
	LDA.w $611E
	SEC
	SBC.w $6122
	STA.b $00
	STA.w $6022
	STA.w $6026
	LDA.w #$0001
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_0AEA19>>16
	LDA.w #FXCODE_0AEA19
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	BEQ.b CODE_0EC222
	INC.w $6022
CODE_0EC222:
	LDA.w $6022
	SEC
	SBC.b $00
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	RTS

CODE_0EC230:
	LDY.w $60AB
	BMI.b CODE_0EC2A3
	LDA.b $08
	CMP.w #$FFF6
	BCC.b CODE_0EC2A3
	JSR.w CODE_0EC1E2
	LDA.w $7AF6,x
	BNE.b CODE_0EC26B
	LDA.w #$0004
	STA.w $7AF6,x
	LDA.w $7C16,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$FFE0
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0EC26B:
	STZ.w $60AA
	INC.w $61B4
	LDA.w $60A8
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PHA
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	PHA
	LDA.w #$0180
	JSL.l CODE_04AB6F
	PLA
	PHA
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	EOR.w #$FFFF
	INC
	STA.b $06
	PLA
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.b $06
	JSL.l CODE_05CEAB
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLA
	STA.w $60A8
	RTS

CODE_0EC2A3:
	JMP.w CODE_0EBFF6

DATA_0EC2A6:
	dw $0400,$FC00

CODE_0EC2AA:
	LDA.w $7A36,x
	LDY.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CPY.b #!Define_YI_NorSpr09E_ChompRock
	BEQ.b CODE_0EC2B7
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_0EC2B7:
	STA.b $02
	LDA.w $0035
	BIT.b $02
	BEQ.b CODE_0EC2D0
	AND.w $6084
	BEQ.b CODE_0EC2E3
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $60A8
	STA.w $60B4
	BRA.b CODE_0EC2E0

CODE_0EC2D0:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C0,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w #$0160
	STA.w $093A
CODE_0EC2E0:
	JMP.w CODE_0EBFF6

CODE_0EC2E3:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_0EC2F9
	LDA.w $60FC
	AND.w #$01E0
	BEQ.b CODE_0EC2F9
	AND.w #$0180
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0EC2D0
CODE_0EC2F9:
	JSL.l CODE_05CE9F
	LDA.w $60DE
	ORA.w $6150
	BNE.b CODE_0EC35C
	LDA.w $60A8
	BPL.b CODE_0EC30E
	EOR.w #$FFFF
	INC
CODE_0EC30E:
	AND.w #$FF00
	XBA
	SEC
	ADC.w $7540,x
	LDY.w $77C2,x
	BEQ.b CODE_0EC31F
	EOR.w #$FFFF
	INC
CODE_0EC31F:
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.b $0E
	CLC
	ADC.w #$0400
	LDY.b #$00
	CMP.w #$0800
	BCC.b CODE_0EC339
	BPL.b CODE_0EC334
	INY
	INY
CODE_0EC334:
	LDA.w DATA_0EC2A6,y
	STA.b $0E
CODE_0EC339:
	LDA.b $0E
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.w $61C2
	LDA.w $60A8
	BPL.b CODE_0EC34A
	EOR.w #$FFFF
	INC
CODE_0EC34A:
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w #$0040
	BMI.b CODE_0EC359
	INC.w $60DC
	AND.w #$003F
CODE_0EC359:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_0EC35C:
	RTS

DATA_0EC35D:
	dw $0200,$FE00

DATA_0EC361:
	dw $FFFF,$0001

CODE_0EC365:
	PHB
	PHK
	PLB
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_0EC380

CODE_0EC377:
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_0EC380:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	DEY
	BPL.b CODE_0EC38A
	PLB
	RTL

CODE_0EC38A:
	INY
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr09E_ChompRock
	BNE.b CODE_0EC398
	JSR.w CODE_0EC43B
	BRA.b CODE_0EC377

CODE_0EC398:
	CMP.w #!Define_YI_NorSpr0F5_Slugger
	BEQ.b CODE_0EC377
	LDA.w $6FA2,y
	AND.w #$0800
	BEQ.b CODE_0EC377
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_0EC406
	LDA.w $7CD6,y
	SEC
	SBC.w $7CD6,x
	STA.b $0A
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BEQ.b CODE_0EC3EF
	EOR.b $0A
	BPL.b CODE_0EC377
	LDA.w $70E2,y
	SEC
	SBC.w $72C0,y
	STA.w $70E2,y
	LDA.w $7400,y
	EOR.w #$0002
	STA.w $7400,y
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	EOR.w $75E0,y
	BPL.b CODE_0EC3EF
	LDA.w $75E0,y
	EOR.w #$FFFF
	INC
	STA.w $75E0,y
CODE_0EC3EF:
	LDX.b #$00
	LDA.b $0A
	BMI.b CODE_0EC3F7
	INX
	INX
CODE_0EC3F7:
	LDA.w $70E2,y
	CLC
	ADC.w DATA_0EC361,x
	STA.w $70E2,y
	LDX.b $12
CODE_0EC403:
	JMP.w CODE_0EC377

CODE_0EC406:
	LDA.w $6FA2,y
	AND.w #$6000
	BNE.b CODE_0EC403
	JSR.w CODE_0EC413
	BRA.b CODE_0EC403

CODE_0EC413:
	LDA.w $7040,y
	ORA.w #$0004
	STA.w $7040,y
	PHY
	TYX
	JSL.l CODE_03B25B
	PLX
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$000C
	BNE.b CODE_0EC43A
	LDY.b #$00
	LDA.w $6000
	BPL.b CODE_0EC434
	INY
	INY
CODE_0EC434:
	LDA.w DATA_0EC35D,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0EC43A:
	RTS

CODE_0EC43B:
	LDA.w $7BB8,x
	ASL
	STA.b $00
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	BPL.b CODE_0EC453
	CLC
	ADC.b $00
	CMP.w #$0008
	BCS.b CODE_0EC4BA
	RTS

CODE_0EC453:
	SEC
	SBC.b $00
	DEC
	CMP.w #$FFF7
	BCC.b CODE_0EC4BA
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0EC475
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	EOR.w #$FFFF
	INC
	BRA.b CODE_0EC480

CODE_0EC475:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	PLA
CODE_0EC480:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
	LDA.w $7182,y
	SEC
	SBC.w $72C2,y
	STA.w $7182,y
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	PHP
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BPL.b CODE_0EC4A8
	EOR.w #$FFFF
	INC
CODE_0EC4A8:
	LSR
	LSR
	LSR
	PLP
	BPL.b CODE_0EC4B2
	EOR.w #$FFFF
	INC
CODE_0EC4B2:
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_0EC4BA:
	LDA.w $72C0,x
	ORA.w $72C0,y
	BNE.b CODE_0EC513
	LDA.w $7CD6,y
	SEC
	SBC.w $7CD6,x
	STA.b $00
	CPX.w $0E27
	BNE.b CODE_0EC4EF
	LDA.b $00
	PHP
	LDA.w $7BB6,x
	ASL
	INC
	PLP
	BPL.b CODE_0EC4DF
	EOR.w #$FFFF
	INC
CODE_0EC4DF:
	CLC
	ADC.w $70E2,x
	STA.w $70E2,y
	CLC
	ADC.w $7B56,y
	STA.w $7CD6,y
	BRA.b CODE_0EC53B

CODE_0EC4EF:
	CPY.w $0E27
	BNE.b CODE_0EC513
	LDA.b $00
	PHP
	LDA.w $7BB6,x
	ASL
	INC
	PLP
	BMI.b CODE_0EC503
	EOR.w #$FFFF
	INC
CODE_0EC503:
	CLC
	ADC.w $70E2,y
	STA.w $70E2,x
	CLC
	ADC.w $7B56,x
	STA.w $7CD6,x
	BRA.b CODE_0EC53B

CODE_0EC513:
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w $7CD6,x
	SEC
	SBC.w $72C0,x
	STA.w $7CD6,x
	LDA.w $70E2,y
	SEC
	SBC.w $72C0,y
	STA.w $70E2,y
	LDA.w $7CD6,y
	SEC
	SBC.w $72C0,y
	STA.w $7CD6,y
CODE_0EC53B:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	RTS

CODE_0EC54A:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCS.b CODE_0EC561
	LDA.b $16,x
	CLC
	ADC.w #$0110
	CMP.w #$0220
	BCC.b CODE_0EC5A9
CODE_0EC561:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $02
	STZ.b $04
	LDA.w $70E2,x
	STA.b $06
	LDA.w $7182,x
	STA.b $08
	STZ.b $0E
	JSR.w CODE_0EC5BA
	LDY.b #$08
	STY.b $04
	JSR.w CODE_0EC5BA
	LDY.b #$10
	STY.b $04
	JSR.w CODE_0EC5BA
	LDY.b #$18
	STY.b $04
	JSR.w CODE_0EC5BA
	LDX.b $12
	LDY.b $0E
	BEQ.b CODE_0EC59C
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0EC59C:
	LDY.b $0F
	BEQ.b CODE_0EC5A9
	LDA.b $16,x
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0EC5A9:
	RTS

DATA_0EC5AA:                                    ; flavor: data (followed by dw); CODE_ name is a documentation bug
	dw $FFF9,$0008,$0017,$0008,$0008,$FFF9,$0008,$0017

CODE_0EC5BA:
	REP.b #$10
	LDA.b $02
	CLC
	ADC.b $04
	TAX
	LDA.l $700008,x
	STA.w $0091
	LDA.l $70000A,x
	STA.w $0093
	LDA.l $70000C,x
	AND.w #$F800
	CMP.w #$4000
	BNE.b CODE_0EC5E4
	SEP.b #$10
	JSL.l CODE_0DA479
	BRA.b CODE_0EC603				; Glitch: X/Y is 8-bit, but the location this jumps to expects it to be 16-bit! A BRK is executed but by sheer luck, it doesn't break the game.

CODE_0EC5E4:
	LDA.l $70000F,x
	AND.w #$00FF
	CMP.w #$007B
	BNE.b CODE_0EC5F8
	SEP.b #$10
	JSL.l CODE_0EC61E
	BRA.b CODE_0EC603

CODE_0EC5F8:
	CMP.w #$007C
	BNE.b CODE_0EC61A
	SEP.b #$10
	JSL.l CODE_0EC68D
CODE_0EC603:
	LDY.b $04
	CPY.w #$0018
	BPL.b CODE_0EC60E
	INC.b $0E
	BRA.b CODE_0EC610

CODE_0EC60E:
	INC.b $0F
CODE_0EC610:
	SEP.b #$10
	LDA.w #$0010
	STA.w $7A98,x
	SEC
	RTS

CODE_0EC61A:
	SEP.b #$10
	CLC
	RTS

CODE_0EC61E:
	LDA.w $0093
	PHA
	LDA.w $0091
	PHA
	LDA.w #$0000
	STA.w $0095
	LDA.w #$0001
	STA.w $008F
	JSL.l CODE_change_map16
	LDA.w $0091
	CLC
	ADC.w #$0010
	STA.w $0091
	JSL.l CODE_change_map16
	LDA.w $0093
	CLC
	ADC.w #$0010
	STA.w $0093
	JSL.l CODE_change_map16
	PLA
	STA.w $0091
	JSL.l CODE_change_map16
	PLA
	STA.w $0093
	LDX.b $12
	LDA.w #!Define_YI_AmbSpr20C
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $0091
	AND.w #$FFF0
	STA.w $70A2,y
	LDA.w $0093
	AND.w #$FFF0
	STA.w $7142,y
	LDA.w #$000D
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #!Define_YI_SoundID48_LargeBlockLands
	JSL.l CODE_push_sound_queue
	RTL

CODE_0EC68D:
	LDA.w #$0006
	STA.w $008F
	JSL.l CODE_change_map16
	LDX.b $12
	LDA.w #!Define_YI_AmbSpr20B
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $0091
	AND.w #$FFF0
	STA.w $70A2,y
	LDA.w $0093
	AND.w #$FFF0
	STA.w $7142,y
	LDA.w #$000C
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #!Define_YI_SoundID0A_BreakDirt
	JSL.l CODE_push_sound_queue
	RTL

DATA_0EC6C6:
	dw $0004,$0006,$0008,$0008,$0006,$0004

DATA_0EC6D2:
	dw $0001,$0002,$0003,$0003,$0002,$0001,$0020,$0040
	dw $0060,$0060,$0040,$0020

DATA_0EC6EA:
	dw $0380,$0224,$01C0,$FE40,$FDDC,$FC80

DATA_0EC6F6:
	dw $0180,$00D2,$00A0,$FF60,$FF2E,$FE80,$FFB0,$FF97
	dw $FF40,$FF60,$FF2E,$FE80,$0180,$00D2,$00A0,$0050
	dw $0069,$00C0

CODE_0EC71A:
	STZ.w $7540,x
	LDA.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	AND.w #$00FF
	BEQ.b CODE_0EC79D
	LDY.b #$00
	CMP.w #$0080
	BMI.b CODE_0EC737
	ORA.w #$FF00
	LDY.b #$02
	CLC
	ADC.w #$0020
	BRA.b CODE_0EC73D

CODE_0EC737:
	LDY.b #$08
	SEC
	SBC.w #$0020
CODE_0EC73D:
	BEQ.b CODE_0EC747
	BMI.b CODE_0EC745
	DEY
	DEY
	BRA.b CODE_0EC747

CODE_0EC745:
	INY
	INY
CODE_0EC747:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr09E_ChompRock
	BEQ.b CODE_0EC78F
	PHY
	LDA.b $19,x
	AND.w #$00FF
	BEQ.b CODE_0EC768
	TYA
	CLC
	ADC.w #$000C
	TAY
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0EC768
	TYA
	CLC
	ADC.w #$000C
	TAY
CODE_0EC768:
	LDA.w DATA_0EC6F6,y
	STA.w $75E0,x
	PLY
	LDA.w $75E0,x
	BPL.b CODE_0EC778
	EOR.w #$FFFF
	INC
CODE_0EC778:
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.b $00
	BCC.b CODE_0EC78A
	TYA
	CLC
	ADC.w #$000C
	TAY
CODE_0EC78A:
	LDA.w DATA_0EC6D2,y
	BRA.b CODE_0EC798

CODE_0EC78F:
	LDA.w DATA_0EC6EA,y
	STA.w $75E0,x
	LDA.w DATA_0EC6C6,y
CODE_0EC798:
	STA.w $7540,x
	BRA.b CODE_0EC7D3

CODE_0EC79D:
	LDA.w $7860,x
	AND.w #$000F
	BEQ.b CODE_0EC810
	BIT.w #$0001
	BEQ.b CODE_0EC7D3
	LDA.b $18,x
	BNE.b CODE_0EC7D3
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0004
	CMP.w #$0008
	BCS.b CODE_0EC7BF
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_0EC7D3

CODE_0EC7BF:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0EC7C8
	EOR.w #$FFFF
	INC
CODE_0EC7C8:
	XBA
	AND.w #$00FF
	INC
	STA.w $7540,x
	STZ.w $75E0,x
CODE_0EC7D3:
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_0EC810
	SEC
	SBC.w #$0008
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0EC810
	LDA.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	BEQ.b CODE_0EC7F4
	LDA.w $6FA2,x
	AND.w #$001F
	CMP.w #$000E
	BEQ.b CODE_0EC810
CODE_0EC7F4:
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0EC810:
	RTS

CODE_0EC811:
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_0EC857
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0180
	CMP.w #$0300
	BCC.b CODE_0EC857
	LDA.w #!Define_YI_AmbSpr1CC
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0008
	STA.w $7E4C,y
	LDA.w #$0001
	STA.w $7782,y
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #!Define_YI_SoundID37_FlutterJump
	JSL.l CODE_push_sound_queue
CODE_0EC857:
	RTS

CODE_0EC858:
	LDA.w $72C0,x
	ASL
	ASL
	ASL
	EOR.w #$FFFF
	SEC
	ADC.w $7A38,x
	STA.w $7A38,x
	RTS

CODE_0EC869:
	LDA.w #(FXDATA_550000+$6020)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_550000+$6020
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
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
	RTS

CODE_0EC8A3:
	LDA.w $72C0,x
	BPL.b CODE_0EC8AC
	EOR.w #$FFFF
	INC
CODE_0EC8AC:
	CLC
	ADC.b $78,x
	CMP.w #$0010
	BMI.b CODE_0EC8C1
	SEC
	SBC.w #$0010
	PHA
	LDA.w #!Define_YI_SoundID59_RollingRock
	JSL.l CODE_push_sound_queue
	PLA
CODE_0EC8C1:
	STA.b $78,x
	RTS

CODE_0EC8C4:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.b $16,x
	LDA.w #$04A2
	LDY.b $18,x
	BEQ.b CODE_0EC8D3
	LDA.w #$04E2
CODE_0EC8D3:
	STA.w $6FA0,x
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0DC: Snowball. Raiden: init_snowball.
;---------------------------------------------------------------------------
YI_NorSpr0DC_Snowball_Init:
init_snowball:
;$0EC8D7
	JSL.l CODE_03AEEB
	LDY.w !RAM_YI_Level_CurrentLevelFromMapLo
	CPY.b #!Define_YI_LevelID_RideTheSkiLifts
	BNE.b CODE_0EC8E8
	LDA.w #$8001
	STA.w $7040,x
CODE_0EC8E8:
	JSR.w CODE_0EC924
	LDA.w #$0598
	STA.w $7A36,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0DC main. Raiden: main_snowball.
;---------------------------------------------------------------------------
YI_NorSpr0DC_Snowball_Main:
main_snowball:
;$0EC8F2
	JSL.l CODE_03AB1C
	JSL.l CODE_03AF23
	STZ.w $7400,x
	JSL.l CODE_0EC365
	JSR.w CODE_0EBFBB
	JSR.w CODE_0EC71A
	JSR.w CODE_0EC914
	JSR.w CODE_0EC924
	JSR.w CODE_0EC8A3
	JSR.w CODE_0EC8C4
	RTL

CODE_0EC914:
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_0B9567>>16
	LDA.w #FXCODE_0B9567
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	RTS

CODE_0EC924:
	LDA.w #(FXDATA_548000+$6080)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_548000+$6080
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDY.w $7A39,x
	TYA
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7A36,x
	LSR
	LSR
	LSR
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08877E>>16
	LDA.w #FXCODE_08877E
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	RTS

CODE_0EC961:
	TYX
	RTS

;---------------------------------------------------------------------------

DATA_0EC963:
	dw $FFFC,$0004

;---------------------------------------------------------------------------
; Sprites $0A3 / $0A4: Bandits hiding under cover (left/right variant).
; Raiden: init_bandit_under_cover.
;---------------------------------------------------------------------------
YI_NorSpr0A3_LeftHidingBandit_Init:
YI_NorSpr0A4_RightHidingBandit_Init:
init_bandit_under_cover:
;$0EC967
	LDA.w #$001E
	STA.w $7402,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr0A3_LeftHidingBandit
	ASL
	STA.w $7400,x
	TAY
	LDA.w DATA_0EC963,y
	CLC
	ADC.w $70E2,x
	STA.w $70E2,x
	LDY.b #$16
	STY.b $76,x
;---------------------------------------------------------------------------
; Sprite $020: Bandit (the standard egg-thief). Raiden: init_bandit.
;---------------------------------------------------------------------------
YI_NorSpr020_Bandit_Init:
init_bandit:
	LDA.w #$0001
	STA.b $16,x
CODE_0EC98C:
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

; 13-state $76,x dispatch for main_bandit -- shared by Bandit $020, RedCoinBandit $05B,
; LeftHidingBandit $0A3, RightHidingBandit $0A4. See docs/family-bandits.md for the
; per-state breakdown + variant-encoding (Pattern A position-derived vs Pattern B
; per-ID CMP-and-branch). 4-stomp kill via $78,x counter + DATA_0ECBF7 sound table.
DATA_0EC993:
	dw CODE_0ECD8A
	dw CODE_0ECE01
	dw CODE_0ECEB1
	dw CODE_0ECF19
	dw CODE_0ECFEE
	dw CODE_0ED032
	dw CODE_0ED08F
	dw CODE_0ED0E9
	dw CODE_0ED183
	dw CODE_0ED1D0
	dw CODE_0ED1D0
	dw CODE_0ED264
	dw CODE_0ED0E9

;---------------------------------------------------------------------------
; Sprites $020 / $0A3 / $0A4 main (shared). Raiden: main_bandit.
;---------------------------------------------------------------------------
YI_NorSpr020_Bandit_Main:
YI_NorSpr0A3_LeftHidingBandit_Main:
YI_NorSpr0A4_RightHidingBandit_Main:
main_bandit:
;$0EC9AD
	LDA.w #$FC20
	LDY.b $76,x
	CPY.b #$16
	BPL.b CODE_0EC9C3
	LDY.w $61B3
	BMI.b CODE_0EC9C3
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_0EC9C3
	LDA.w #$7C20
CODE_0EC9C3:
	STA.w $6FA0,x
	LDA.w #$0040
	STA.w $7542,x
	JSR.w CODE_0EC9DA
	TXY
	LDA.b $76,x
	AND.w #$00FF
	TAX
	JSR.w (DATA_0EC993,x)
	RTL

CODE_0EC9DA:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_0EC9ED
	CMP.w #$0008
	BEQ.b CODE_0EC9EA
	JMP.w CODE_0ECA77

CODE_0EC9EA:
	JMP.w CODE_0ECBAB

CODE_0EC9ED:
	LDA.w $7D38,x
	BNE.b CODE_0ECA3A
	LDY.b $76,x
	CPY.b #$16
	BEQ.b CODE_0ECA06
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_0ECA06
	JSR.w CODE_0ECAA8
CODE_0ECA06:
	LDA.w $70E2,x
	LDY.w $7400,x
	BNE.b CODE_0ECA15
	CMP.w #$0014
	BMI.b CODE_0ECA1E
	BRA.b CODE_0ECA2C

CODE_0ECA15:
	SEC
	SBC.w #$00F0
	CMP.w $7E1A
	BMI.b CODE_0ECA2C
CODE_0ECA1E:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0ECA2C
	LDY.b $76,x
	CPY.b #$18
	BEQ.b CODE_0ECA2C
	JSR.w CODE_0ECAF8
CODE_0ECA2C:
	JSL.l CODE_03A2C7
	BCS.b CODE_0ECA35
	JMP.w CODE_0ECA8D

CODE_0ECA35:
	JSR.w CODE_0ECC9F
	PLA
	RTL

CODE_0ECA3A:
	JSR.w CODE_0ECCC7
	JSL.l CODE_03A2C7
	BCC.b CODE_0ECA47
	JSL.l CODE_03A31E
CODE_0ECA47:
	PLA
	JSL.l CODE_03AF23
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr020_Bandit
	BEQ.b CODE_0ECA66
	LDA.w #$FC20
	STA.w $6FA0,x
	LDA.w #$0801
	STA.w $6FA2,x
	LDA.w #$0002
	STA.w $74A2,x
CODE_0ECA66:
	LDY.b #$12
	STY.b $76,x
	LDA.w #$000A
	STA.w $7A36,x
	LDA.w #$0012
	STA.w $7402,x
	RTL

CODE_0ECA77:
	JSR.w CODE_0ECCC7
	PLA
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$000C
	BEQ.b CODE_0ECA88
	CMP.w #$0008
	BNE.b CODE_0ECA8C
CODE_0ECA88:
	JSL.l CODE_03AF23
CODE_0ECA8C:
	RTL

CODE_0ECA8D:
	PLA
	STA.b $00
	JSL.l CODE_03AF23
	LDA.b $00
	PHA
	RTS

DATA_0ECA98:
	dw $0000,$0100,$FF00

DATA_0ECA9E:
	dw $FD80,$FE00,$FE00

DATA_0ECAA4:
	dw $FF00,$0100

CODE_0ECAA8:
	LDY.w $7D36,x
	BEQ.b CODE_0ECAD2
	BMI.b CODE_0ECAD3
	LDY.w $7D36,x
	LDA.w $6EFF,y
	CMP.w #$0010
	BNE.b CODE_0ECAC2
	LDA.w $7D37,y
	BEQ.b CODE_0ECAC2
	JMP.w CODE_0ECBFE

CODE_0ECAC2:
	PLA
	STA.b $00
	PLA
	STA.b $02
	JSL.l CODE_03A5B7
	LDA.b $02
	PHA
	LDA.b $00
	PHA
CODE_0ECAD2:
	RTS

CODE_0ECAD3:
	LDA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	BNE.b CODE_0ECB47
	LDY.w $60AB
	BMI.b CODE_0ECAD2
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_0ECAD2
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEY
	BMI.b CODE_0ECB1B
	LDA.w $7AF8
	BEQ.b CODE_0ECB17
CODE_0ECAF8:
	LDY.b #$18
	STY.b $76,x
	LDA.w #$0007
	STA.w $7A36,x
	LDA.w #$0017
	STA.w $7402,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.b $16,x
	LDA.w #$0020
	STA.w $7AF8
	RTS

CODE_0ECB17:
	JSL.l CODE_06BF12
CODE_0ECB1B:
	LDA.w $60FC
	AND.w #$0018
	BNE.b CODE_0ECAD2
	LDA.w #$FA00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDY.w $77C2,x
	LDA.w DATA_0ECAA4,y
	STA.w $60A8
	STA.w $60B4
	LDY.w $60D4
	BNE.b CODE_0ECB47
	LDY.b $79,x
	INY
	CPY.b #$03
	BMI.b CODE_0ECB4D
CODE_0ECB47:
	JSR.w CODE_0ECB73
	JMP.w CODE_0ECC0C

CODE_0ECB4D:
	STY.b $79,x
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0ECB5C:
	LDA.w #$0007
	STA.w $7A36,x
	LDA.w #$0015
	STA.w $7402,x
	LDA.w #$0001
	STA.w $7A98,x
	LDY.b #$14
	STY.b $76,x
	RTS

CODE_0ECB73:
	LDY.b #$04
CODE_0ECB75:
	LDA.w DATA_0ECA98,y
	STA.b $00
	LDA.w DATA_0ECA9E,y
	STA.b $02
	PHY
	LDA.w #$0115
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0ECBA5
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $02
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	PLY
	DEY
	DEY
	BPL.b CODE_0ECB75
	RTS

CODE_0ECBA5:
	PLY
	RTS

DATA_0ECBA7:
	dw $0100,$FF00

CODE_0ECBAB:
	JSR.w CODE_0ECCC7
CODE_0ECBAE:
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.w $6168
	LDA.w #!Define_YI_SoundID3C_InedibleObject
	JSL.l CODE_push_sound_queue
	LDY.b #$02
	LDA.w $6150
	CMP.w #$0003
	BMI.b CODE_0ECBCA
	INY
	INY
CODE_0ECBCA:
	STY.w $6150
	CPY.b #$02
	BEQ.b CODE_0ECBDB
	LDY.w $77C3,x
	BEQ.b CODE_0ECBDB
	LDA.w #$FD00
	BRA.b CODE_0ECBE7

CODE_0ECBDB:
	LDY.w $77C2,x
CODE_0ECBDE:
	LDA.w DATA_0ECBA7,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FF00
CODE_0ECBE7:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0010
	STA.w $7540,x
	STZ.w $75E0,x
	JSR.w CODE_0ECB5C
	RTS

DATA_0ECBF7:
	db !Define_YI_SoundID0C_ShellHit2,!Define_YI_SoundID0D_ShellHit3,!Define_YI_SoundID0E_ShellHit4,!Define_YI_SoundID0F_ShellHit5
	db !Define_YI_SoundID10_ShellHit6,!Define_YI_SoundID11_ShellHit7,!Define_YI_SoundID12_ShellHit8

CODE_0ECBFE:
	LDY.w $7D36,x
	DEY
	TYX
	JSL.l CODE_03B25B
	JSR.w CODE_0ECC34
	BCC.b CODE_0ECC12
CODE_0ECC0C:
	PLA
	PLA
	JML.l CODE_03B24B

CODE_0ECC12:
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	INC.b $78,x
	JSR.w CODE_0ECCC7
	LDY.w $7D36,x
	LDA.w $7CD5,y
	LDY.b #$00
	SEC
	SBC.w $7CD6,x
	BMI.b CODE_0ECBDE
	INY
	INY
	BRA.b CODE_0ECBDE

DATA_0ECC30:
	dw $0100,$FF00

CODE_0ECC34:
	LDY.b $78,x
	INY
	CPY.b #$04
	BMI.b CODE_0ECC53
	PHY
	LDA.w $70E2,x
	STA.w $0000
	LDA.w $7182,x
	STA.w $0002
	JSL.l CODE_03A4A2
	PLY
	CPY.b #$06
	BMI.b CODE_0ECC9D
	SEC
	RTS

CODE_0ECC53:
	LDY.w $7400,x
	LDA.w DATA_0ECC30,y
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.b $02
	LDA.w #$0115
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0ECC9D
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.b $02
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0100
	STA.w $7A96,y
	LDA.w #$0140
	STA.w $7A98,y
	LDA.w #$0020
	STA.w $7AF6,y
	LDY.b $78,x
	LDA.w DATA_0ECBF7,y
	AND.w #$00FF
	JSL.l CODE_push_sound_queue
CODE_0ECC9D:
	CLC
	RTS

CODE_0ECC9F:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0ECCB1
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
CODE_0ECCB1:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0ECCF3
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	CMP.w #$0010
	BEQ.b CODE_0ECCDC
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	BEQ.b CODE_0ECCC7
	CPX.b $18
	BEQ.b CODE_0ECCDC
CODE_0ECCC7:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEY
	BMI.b CODE_0ECCDB
	LDY.b $76
	CPY.b #$08
	BEQ.b CODE_0ECCD7
	CPY.b #$09
	BNE.b CODE_0ECCDB
CODE_0ECCD7:
	JSL.l CODE_06C114
CODE_0ECCDB:
	RTS

CODE_0ECCDC:
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$000E
	STA.w $7182,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	RTS

CODE_0ECCF3:
	PLA
	PLA
	JML.l CODE_03A31E

CODE_0ECCF9:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0ECD12
	JSL.l CODE_03A2C7
	BCC.b CODE_0ECD30
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	BRA.b CODE_0ECD30

CODE_0ECD12:
	JSL.l CODE_03A2C7
	BCS.b CODE_0ECD4F
	RTS

CODE_0ECD19:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0ECD2B
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
CODE_0ECD2B:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0ECD4F
CODE_0ECD30:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	CMP.w #$0010
	BEQ.b CODE_0ECD3B
	JMP.w CODE_0ECCC7

CODE_0ECD3B:
	LDA.w $70E2,x
	STA.w $70E2
	LDA.w $7182,x
	SEC
	SBC.w #$000E
	STA.w $7182
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	RTS

CODE_0ECD4F:
	PLA
	JML.l CODE_03A31E

CODE_0ECD54:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0ECD67
	JSL.l CODE_03A2C7
	BCC.b CODE_0ECD30
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	BRA.b CODE_0ECD30

CODE_0ECD67:
	JSL.l CODE_03A2C7
	BCS.b CODE_0ECD4F
	RTS

DATA_0ECD6E:
	dw $FFA7,$0059

DATA_0ECD72:
	dw $FE40,$01C0,$FDE0,$0220,$FD80,$0280

DATA_0ECD7E:
	dw $FE80,$0180,$FE40,$01C0,$FE00,$0200

CODE_0ECD8A:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0ECDAA
	LDA.b $16,x
	BEQ.b CODE_0ECDB8
	DEC.b $16,x
	BEQ.b CODE_0ECDB8
	LDA.w #$0010
	STA.w $7A98,x
	LDA.w $7402,x
	EOR.w #$0003
	AND.w #$000B
	STA.w $7402,x
CODE_0ECDAA:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr05B_RedCoinBandit
	BEQ.b CODE_0ECDB5
	JMP.w CODE_0ED436

CODE_0ECDB5:
	JMP.w CODE_0ECE65

CODE_0ECDB8:
	LDA.b $10
	BIT.w #$0003
	BNE.b CODE_0ECDC7
	LDA.w $77C2,x
	AND.w #$00FF
	BRA.b CODE_0ECDCB

CODE_0ECDC7:
	XBA
	AND.w #$0002
CODE_0ECDCB:
	STA.w $7400,x
	TAY
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0020
	CPY.b #$02
	BEQ.b CODE_0ECDE0
	EOR.w #$FFFF
	INC
CODE_0ECDE0:
	CLC
	ADC.w $70E2,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w DATA_0ECD6E,y
	STA.w $75E0,x
	LDA.w #$0002
	STA.w $7402,x
	STZ.w $7A36,x
	LDY.b #$02
	STY.b $76,x
	RTS

DATA_0ECDFB:
	db $07,$06,$05,$04,$03,$02

CODE_0ECE01:
	TYX
	JSR.w CODE_0ED55C
	LDA.w $7A98,x
	BNE.b CODE_0ECE29
	DEC.w $7A36,x
	BPL.b CODE_0ECE17
	LDY.b #$02
	LDA.w #$0005
	STA.w $7A36,x
CODE_0ECE17:
	LDA.w #$0003
	STA.w $7A98,x
	LDY.w $7A36,x
	LDA.w DATA_0ECDFB,y
	AND.w #$00FF
	STA.w $7402,x
CODE_0ECE29:
	LDA.w #$000B
	STA.w $7540,x
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0002
	CMP.w #$0004
	BCS.b CODE_0ECE5A
	LDA.b $10
	AND.w #$0001
	CLC
	ADC.w #$0003
	STA.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w #$0009
	STA.w $7402,x
	LDY.b #$00
	STY.b $76,x
CODE_0ECE5A:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr05B_RedCoinBandit
	BEQ.b CODE_0ECE65
	JMP.w CODE_0ED436

CODE_0ECE65:
	LDY.w $77C2,x
	TYA
	CMP.w $7400,x
	BNE.b CODE_0ECEA2
	LDA.w $7C16,x
	CLC
	ADC.w #$0050
	CMP.w #$00A0
	BCS.b CODE_0ECEA2
	LDA.w $7C18,x
	CLC
	ADC.w #$0030
	CMP.w #$0060
	BCS.b CODE_0ECEA2
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w #$0007
	STA.w $7A36,x
	LDA.w #$0017
	STA.w $7402,x
	LDY.b #$04
	STY.b $76,x
CODE_0ECEA2:
	RTS

DATA_0ECEA3:
	db $01,$01,$01,$01,$04,$02,$02

DATA_0ECEAA:
	db $09,$0C,$1D,$1C,$1B,$1A,$19

CODE_0ECEB1:
	TYX
	LDA.w $7860,x
	BIT.w #$000C
	BEQ.b CODE_0ECEC9
	PHA
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLA
CODE_0ECEC9:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0ECF18
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_0ECEDD
	LDA.w #$0018
	STA.w $7402,x
	RTS

CODE_0ECEDD:
	LDA.w $7A98,x
	BNE.b CODE_0ECF18
	DEC.w $7A36,x
	BPL.b CODE_0ECF03
	STZ.w $7402,x
	LDY.b #$06
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr05B_RedCoinBandit
	BNE.b CODE_0ECF00
	LDY.w $77C2,x
	TYA
	EOR.w #$0002
	STA.w $7400,x
	LDY.b #$08
CODE_0ECF00:
	STY.b $76,x
	RTS

CODE_0ECF03:
	LDY.w $7A36,x
	LDA.w DATA_0ECEA3,y
	AND.w #$00FF
	STA.w $7A98,x
	LDA.w DATA_0ECEAA,y
	AND.w #$00FF
	STA.w $7402,x
CODE_0ECF18:
	RTS

CODE_0ECF19:
	TYX
	LDA.b $16,x
	BPL.b CODE_0ECF25
	JSR.w CODE_0ED7F7
	STZ.b $16,x
	BRA.b CODE_0ECF28

CODE_0ECF25:
	JSR.w CODE_0ED640
CODE_0ECF28:
	LDA.w #$000B
	STA.w $7540,x
	LDA.w $70E2
	LDY.b #$00
	SEC
	SBC.w $70E2,x
	PHA
	BMI.b CODE_0ECF3C
	INY
	INY
CODE_0ECF3C:
	TYA
	STA.w $7400,x
	LDY.b $79,x
	TYA
	ASL
	ASL
	CLC
	ADC.w $7400,x
	TAY
	LDA.w DATA_0ECD72,y
	STA.w $75E0,x
	LDA.w $7A98,x
	BNE.b CODE_0ECF67
	LDA.w #$0002
	STA.w $7A98,x
	LDA.w $7402,x
	EOR.w #$0001
	AND.w #$0001
	STA.w $7402,x
CODE_0ECF67:
	PLA
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCS.b CODE_0ECFCC
	LDA.w $7182
	SEC
	SBC.w $7182,x
	BPL.b CODE_0ECFCC
	CMP.w #$FFA0
	BMI.b CODE_0ECFCC
	CMP.w #$FFE8
	BPL.b CODE_0ECFCC
	LDY.w $61B3
	BMI.b CODE_0ECFCC
	EOR.w #$FFFF
	INC
	AND.w #$00F0
	LSR
	LSR
	LSR
	TAY
	LDA.w DATA_0ED5AE,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $7540,x
	STA.w $7A36,x
	STZ.w $7540,x
	STZ.w $7542,x
	LDY.b #$0C
	STY.b $76,x
	LDA.w #$0004
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
	PLA
	RTL

CODE_0ECFCC:
	JSR.w CODE_0ED488
	JSR.w CODE_0ED39D
	BCS.b CODE_0ECFED
	SEP.b #$20
	LDA.b $00
	STA.b $18,x
	LDA.b $02
	CLC
	ADC.b #$0E
	STA.b $19,x
	REP.b #$20
	LDY.b #$0A
	STY.b $76,x
	LDA.w #$0000
	STA.w $7402,x
CODE_0ECFED:
	RTS

CODE_0ECFEE:
	TYX
	JSR.w CODE_0ED80D
	LDA.w $7A98,x
	BNE.b CODE_0ED02F
	LDA.b $16,x
	BEQ.b CODE_0ED013
	DEC.b $16,x
	BEQ.b CODE_0ED013
	LDA.w #$0008
	STA.w $7A98,x
	LDA.w $7402,x
	EOR.w #$0003
	AND.w #$000B
	STA.w $7402,x
	BRA.b CODE_0ED02F

CODE_0ED013:
	LDY.w $7A36,x
	LDA.w DATA_0ED5AE,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w #$0004
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
	LDY.b #$0C
	STY.b $76,x
CODE_0ED02F:
	JMP.w CODE_0ED089

CODE_0ED032:
	TYX
	LDA.b $16,x
	BPL.b CODE_0ED03E
	JSR.w CODE_0ED7F7
	STZ.b $16,x
	BRA.b CODE_0ED041

CODE_0ED03E:
	JSR.w CODE_0ED640
CODE_0ED041:
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	EOR.w #$0002
	TAY
	LDA.w $7A98,x
	BNE.b CODE_0ED062
	LDA.w #$0002
	STA.w $7A98,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
CODE_0ED062:
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDY.b $79,x
	TYA
	ASL
	ASL
	CLC
	ADC.w $7400,x
	TAY
	LDA.w DATA_0ECD7E,y
	STA.w $75E0,x
	LDA.w #$000B
	STA.w $7540,x
	LDA.w $7A96,x
	BNE.b CODE_0ED089
	JSR.w CODE_0ED34B
CODE_0ED089:
	JSR.w CODE_0ED488
	JMP.w CODE_0ED2EC

CODE_0ED08F:
	TYX
	STZ.w $7542,x
	LDA.w $7A98,x
	BNE.b CODE_0ED0A8
	LDY.b #$0E
	STY.b $76,x
	LDA.w #$0017
	STA.w $7402,x
	LDA.w #$0007
	STA.w $7A36,x
CODE_0ED0A8:
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
CODE_0ED0BC:
	JSR.w CODE_0ED488
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0ED0C7
	JSR.w CODE_0ED2EC
CODE_0ED0C7:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_0ED0E0
	JSR.w CODE_0ED39D
	BCS.b CODE_0ED0E0
	SEP.b #$20
	LDA.b $00
	STA.b $18,x
	LDA.b $02
	CLC
	ADC.b #$0E
	STA.b $19,x
	REP.b #$20
CODE_0ED0E0:
	RTS

DATA_0ED0E1:
	dw $0006,$000A

DATA_0ED0E5:
	dw $0200,$FE00

CODE_0ED0E9:
	TYX
	JSR.w CODE_0ED7F7
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0ED171
	LDY.b $76,x
	CPY.b #$0E
	BEQ.b CODE_0ED125
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0ED125
	JSL.l CODE_06C0BB
	LDA.w #$0040
	STA.w $7AF8
	LDY.w $77C2,x
	LDA.w DATA_0ED0E5,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	LDA.w $70E2,x
	STA.w $70E2
	LDA.w $7182,x
	STA.w $7182
	STZ.w $7A38,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.w $7540,x
CODE_0ED125:
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_0ED135
	LDA.w #$0018
	STA.w $7402,x
	BRA.b CODE_0ED171

CODE_0ED135:
	LDA.w $72C2,x
	CMP.w #$0003
	BMI.b CODE_0ED14A
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A98,x
	BNE.b CODE_0ED171
	DEC.w $7A36,x
	BPL.b CODE_0ED15C
CODE_0ED14A:
	STZ.w $7402,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w DATA_0ED0E1,y
	TAY
	STY.b $76,x
	LDA.w #$FFFF
	STA.b $16,x
	RTS

CODE_0ED15C:
	LDY.w $7A36,x
	LDA.w DATA_0ECEA3,y
	AND.w #$00FF
	STA.w $7A98,x
	LDA.w DATA_0ECEAA,y
	AND.w #$00FF
	STA.w $7402,x
CODE_0ED171:
	LDY.b $76,x
	CPY.b #$0E
	BEQ.b CODE_0ED180
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0ED17F
	JSR.w CODE_0ED2EC
CODE_0ED17F:
	RTS

CODE_0ED180:
	JMP.w CODE_0ED0BC

CODE_0ED183:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0ED198
	LDA.w #$0002
	STA.w $7A98,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
CODE_0ED198:
	LDA.w $7AF6,x
	BNE.b CODE_0ED1A7
	LDA.w #$0012
	STA.w $7A36,x
	LDY.b #$0A
	STY.b $76,x
CODE_0ED1A7:
	JSR.w CODE_0ED640
	LDA.w $7A96,x
	BNE.b CODE_0ED1B2
	JSR.w CODE_0ED34B
CODE_0ED1B2:
	JMP.w CODE_0ED089

DATA_0ED1B5:
	db $14,$02,$02,$02,$02,$02,$14,$02,$02,$02

DATA_0ED1BF:
	db $15,$16,$15,$16,$15,$16,$15,$14,$13,$12

DATA_0ED1C9:
	db $15,$14,$13,$12,$13,$14,$15

CODE_0ED1D0:
	TYX
	LDA.w $7540,x
	BEQ.b CODE_0ED1E8
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.b $00
	BCS.b CODE_0ED1E8
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
CODE_0ED1E8:
	LDA.w $7A98,x
	BNE.b CODE_0ED25F
	DEC.w $7A36,x
	BPL.b CODE_0ED231
	LDA.w $7540,x
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.b $00
	BCS.b CODE_0ED207
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0ED207:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr05B_RedCoinBandit
	BEQ.b CODE_0ED214
	LDY.b #$00
	STY.b $76,x
	RTS

CODE_0ED214:
	LDA.w #$0801
	STA.w $6FA2,x
	STZ.w $7402,x
	STZ.w $7A36,x
	LDA.w $77C2,x
	AND.w #$00FF
	EOR.w #$0002
	STA.w $7400,x
	LDY.b #$08
	STY.b $76,x
	RTS

CODE_0ED231:
	LDY.b $76,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr05B_RedCoinBandit
	BEQ.b CODE_0ED24A
	CPY.b #$14
	BNE.b CODE_0ED24A
	LDY.w $7A36,x
	INC.w $7A98,x
	LDA.w DATA_0ED1C9,y
	BRA.b CODE_0ED259

CODE_0ED24A:
	LDY.w $7A36,x
	LDA.w DATA_0ED1B5,y
	AND.w #$00FF
	STA.w $7A98,x
	LDA.w DATA_0ED1BF,y
CODE_0ED259:
	AND.w #$00FF
	STA.w $7402,x
CODE_0ED25F:
	RTS

DATA_0ED260:
	dw $FE9A,$0166

CODE_0ED264:
	TYX
	LDA.w $70E2
	SEC
	SBC.w $70E2,x
	STA.b $00
	CLC
	ADC.w #$0070
	CMP.w #$00E0
	BCS.b CODE_0ED2B4
	LDA.w $61B2
	BNE.b CODE_0ED2B4
	LDY.b #$00
	LDA.b $00
	BMI.b CODE_0ED284
	INY
	INY
CODE_0ED284:
	TYA
	STA.w $7400,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr0A3_LeftHidingBandit
	ASL
	TAY
	LDA.w DATA_0ED260,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0002
	STA.w $74A2,x
	LDA.w #$FC20
	STA.w $6FA0,x
	LDA.w #$0801
	STA.w $6FA2,x
	INC.w $7A38,x
	STZ.w $7402,x
	LDY.b #$06
	STY.b $76,x
	RTS

CODE_0ED2B4:
	LDA.w $60C4
	DEC
	EOR.w $7C16,x
	BPL.b CODE_0ED2C4
	LDA.w #$0020
	STA.w $7402,x
	RTS

CODE_0ED2C4:
	LDY.w $7402,x
	CPY.b #$20
	BNE.b CODE_0ED2D1
	LDA.w #$001E
	STA.w $7402,x
CODE_0ED2D1:
	LDA.w $7A98,x
	BNE.b CODE_0ED2EB
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0010
	STA.w $7A98,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
CODE_0ED2EB:
	RTS

CODE_0ED2EC:
	LDA.w #$000E
CODE_0ED2EF:
	STA.b $04
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0ED346
	LDA.b $18,x
	AND.w #$00FF
	BEQ.b CODE_0ED309
	CMP.w #$0080
	BMI.b CODE_0ED308
	ORA.w #$FF00
	INC
	BRA.b CODE_0ED309

CODE_0ED308:
	DEC
CODE_0ED309:
	STA.b $00
	LDA.b $19,x
	AND.w #$00FF
	BEQ.b CODE_0ED31E
	CMP.w #$0080
	BMI.b CODE_0ED31D
	ORA.w #$FF00
	INC
	BRA.b CODE_0ED31E

CODE_0ED31D:
	DEC
CODE_0ED31E:
	STA.b $02
	LDY.w $7400,x
	STY.w $7400
	LDA.w $70E2,x
	CLC
	ADC.b $00
	STA.w $70E2
	LDA.w $7182,x
	SEC
	SBC.b $04
	CLC
	ADC.b $02
	STA.w $7182
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	LDY.b $00
	STY.b $18,x
	LDY.b $02
	STY.b $19,x
CODE_0ED346:
	RTS

DATA_0ED347:
	dw $000C,$FFF4

CODE_0ED34B:
	LDA.w #$0010
	STA.w $7A96,x
	LDY.w $7400,x
	LDA.w DATA_0ED347,y
	STA.b $04
	LDA.w #!Define_YI_AmbSpr1D7
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_0ED36D
	LDA.w #$0000
	BRA.b CODE_0ED370

CODE_0ED36D:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0ED370:
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FF40
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0010
	STA.w $7782,y
	LDA.w $70E2,x
	CLC
	ADC.b $04
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$000E
	STA.w $7142,y
	LDA.w $7400,x
	STA.w $73C0,y
	RTS

CODE_0ED39D:
	LDY.w $61CC
	BNE.b CODE_0ED3C2
	LDA.w $70E2
	SEC
	SBC.w $70E2,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_0ED3C2
	LDA.w $7182
	SEC
	SBC.w $7182,x
	CLC
	ADC.w #$0014
	CMP.w #$0020
	BCC.b CODE_0ED3C4
CODE_0ED3C2:
	SEC
	RTS

CODE_0ED3C4:
	LDA.b $76
	CMP.w #$0001
	BEQ.b CODE_0ED3C2
CODE_0ED3CB:
	LDY.w $61CC
	BNE.b CODE_0ED3C2
	LDY.b $18
	BNE.b CODE_0ED3C2
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	CMP.w #$0008
	BNE.b CODE_0ED3E2
	STZ.w $6162
	STZ.w $6168
CODE_0ED3E2:
	LDA.w $61B2
	BPL.b CODE_0ED3F9
	LDA.w #!Define_YI_SoundID0B_ShellHit1
	JSL.l CODE_push_sound_queue
	LDA.w #$0020
	CMP.w $61D6
	BMI.b CODE_0ED3F9
	STA.w $61D6
CODE_0ED3F9:
	LDA.w $7400,x
	STA.w $7400
	JSL.l CODE_06BE72
	LDA.w $70E2
	SEC
	SBC.w $70E2,x
	STA.b $00
	LDA.w $7182
	SEC
	SBC.w $7182,x
	STA.b $02
	CLC
	RTS

CODE_0ED417:
	LDA.w $7CD6
	SEC
	SBC.w $7CD6,x
	CLC
	ADC.w #$0050
	CMP.w #$00A0
	BCS.b CODE_0ED435
	LDA.w $7CD8
	SEC
	SBC.w $7CD8,x
	CLC
	ADC.w #$0040
	CMP.w #$0080
CODE_0ED435:
	RTS

CODE_0ED436:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0ED435
	LDA.w $7A38,x
	BNE.b CODE_0ED457
	JSR.w CODE_0ED417
	BCS.b CODE_0ED435
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	BEQ.b CODE_0ED451
	LDA.b $18
	BNE.b CODE_0ED487
CODE_0ED451:
	LDA.w #$0001
	STA.w $7A38,x
CODE_0ED457:
	STZ.w $7402,x
	STZ.w $7400,x
	LDA.w $70E2
	CMP.w $70E2,x
	BMI.b CODE_0ED46B
	LDA.w #$0002
	STA.w $7400,x
CODE_0ED46B:
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDY.b #$04
	STY.b $76,x
	LDA.w #$0007
	STA.w $7A36,x
	LDA.w #$0017
	STA.w $7402,x
CODE_0ED487:
	RTS

CODE_0ED488:
	LDY.b $76,x
	CPY.b #$0E
	BEQ.b CODE_0ED49A
	CPY.b #$0C
	BEQ.b CODE_0ED49A
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0ED487
CODE_0ED49A:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	STA.b $00
	BNE.b CODE_0ED4A4
	JMP.w CODE_0ED51C

CODE_0ED4A4:
	LDA.b $76,x
	AND.w #$00FF
	CMP.w #$0008
	BEQ.b CODE_0ED4C2
	CMP.w #$000A
	BEQ.b CODE_0ED4C2
	CMP.w #$000E
	BEQ.b CODE_0ED4BD
	CMP.w #$000C
	BNE.b CODE_0ED4C9
CODE_0ED4BD:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0ED4C9
CODE_0ED4C2:
	LDA.b $00
	CMP.w #$0008
	BEQ.b CODE_0ED4E6
CODE_0ED4C9:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	BEQ.b CODE_0ED51B
	CPX.b $18
	BEQ.b CODE_0ED4DB
	LDY.b $18
	BNE.b CODE_0ED4DC
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_0ED51C
CODE_0ED4DB:
	RTS

CODE_0ED4DC:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr05B_RedCoinBandit
	BEQ.b CODE_0ED54A
	BRA.b CODE_0ED51C

CODE_0ED4E6:
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	LDA.w $61B2
	AND.w #$BFFF
	STA.w $61B2
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr05B_RedCoinBandit
	BEQ.b CODE_0ED51C
	STZ.w $7A38,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7A98,x
	JSL.l CODE_0ECA66
	PLA
CODE_0ED51B:
	RTS

CODE_0ED51C:
	LDY.b #$00
	STY.b $76,x
	LDA.w #$0080
	STA.w $7AF8,x
	LDA.w #$0018
	STA.w $7A98,x
	LDA.b $10
	AND.w #$0001
	CLC
	ADC.w #$0003
	STA.b $16,x
	STZ.w $7A38,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w #$0009
	STA.w $7402,x
	PLA
CODE_0ED54A:
	RTS

CODE_0ED54B:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0ED55B
	LDA.w $61B2
	AND.w #$6000
	BEQ.b CODE_0ED51C
CODE_0ED55B:
	RTS

CODE_0ED55C:
	LDA.w $7860,x
	BIT.w #$000C
	BEQ.b CODE_0ED578
	LDA.w $7860,x
	AND.w #$0008
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0ED575
	JSR.w CODE_0ED80D
	BRA.b CODE_0ED591

CODE_0ED575:
	LDA.w $7860,x
CODE_0ED578:
	AND.w #$0001
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	AND.w #$00FF
	ORA.b $00
	BNE.b CODE_0ED5AD
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
CODE_0ED591:
	LDA.w #$0001
	STA.b $16,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0009
	STA.w $7402,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDY.b #$00
	STY.b $76,x
	PLA
CODE_0ED5AD:
	RTS

DATA_0ED5AE:
	dw $FCC0,$FBC0,$FAC0,$F9C0,$F940,$F8C0,$F7C0

DATA_0ED5BC:
	dw $FFF0,$0010

DATA_0ED5C0:
	dw $00E0,$0160,$01A0,$01F0,$00F0,$0160,$01C0,$0200
	dw $0100,$0160,$01D0,$0220,$0100,$0170,$01F0,$0240
	dw $0100,$0180,$0200,$0240,$0100,$0190,$0210,$0260
	dw $00E0,$01A0,$0220,$0260,$00E0,$01A0,$0220,$0260

DATA_0ED600:
	dw $FF00,$FE80,$FD80,$FD00,$FE80,$FDA0,$FD00,$FCA0
	dw $FE00,$FD00,$FD00,$FC60,$FD20,$FCA0,$FC80,$FC20
	dw $FC80,$FC40,$FC00,$FB80,$FBD0,$FBD0,$FBA0,$FB40
	dw $FB00,$FB10,$FB00,$FAD0,$FA80,$FA20,$FA80,$F980

CODE_0ED640:
	LDA.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	AND.w #$00FF
	BNE.b CODE_0ED650
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_0ED653
CODE_0ED650:
	JMP.w CODE_0ED747

CODE_0ED653:
	BIT.w #$000C
	BEQ.b CODE_0ED65B
	JMP.w CODE_0ED752

CODE_0ED65B:
	LDY.w $7400,x
	LDA.w $7CD6,x
	CLC
	ADC.w DATA_0ED5BC,y
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7CD8,x
	CLC
	ADC.w #$0040
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w DATA_0ED5BC,y
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0004
	STA.w $6020
	STZ.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDX.b #FXCODE_0ACE3F>>16
	LDA.w #FXCODE_0ACE3F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BPL.b CODE_0ED6DC
CODE_0ED697:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_0ED6A4
	LDA.b $10
	AND.w #$0001
	JMP.w CODE_0ED7AF

CODE_0ED6A4:
	JSR.w CODE_0ED80D
	LDA.w $75E0,x
	EOR.w #$FFFF
	INC
	STA.w $75E0,x
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0010
	STA.w $7AF6,x
	LDA.w #$000C
	LDY.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CPY.b #!Define_YI_NorSpr05B_RedCoinBandit
	BEQ.b CODE_0ED6D7
	LDA.w #$0010
CODE_0ED6D7:
	TAY
	STY.b $76,x
	PLA
	RTS

CODE_0ED6DC:
	AND.w #$000F
	ASL
	STA.b $00
	LDA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	AND.w #$00F0
	LSR
	CLC
	ADC.b $00
	TAY
	LDA.w DATA_0ED5C0,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w DATA_0ED600,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.w $7400,x
	BNE.b CODE_0ED708
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0ED708:
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $7540,x
	STA.w $7A36,x
	STZ.w $7540,x
	LDA.w #$0004
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
	STZ.w $7542,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr05B_RedCoinBandit
	BEQ.b CODE_0ED730
	LDA.w #$000C
	BRA.b CODE_0ED742

CODE_0ED730:
	LDA.w #$0017
	STA.w $7402,x
	LDA.w #$0007
	STA.w $7A36,x
	STZ.w $7A98,x
	LDA.w #$000A
CODE_0ED742:
	TAY
	STY.b $76,x
	PLA
	RTS

CODE_0ED747:
	LDA.w $7860,x
	BIT.w #$000C
	BNE.b CODE_0ED752
CODE_0ED74F:
	JMP.w CODE_0ED7F6

CODE_0ED752:
	LDA.w $7860,x
	AND.w #$0008
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0ED74F
	JSR.w CODE_0ED80D
	LDY.w $7400,x
	LDA.w $7CD6,x
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	CLC
	ADC.w DATA_0ED5BC,y
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7CD8,x
	SEC
	SBC.w #$0010
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #$FFF0
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0005
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	STA.w $6058
	STZ.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDX.b #FXCODE_0ACE92>>16
	LDA.w #FXCODE_0ACE92
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BPL.b CODE_0ED7A3
	JMP.w CODE_0ED697

CODE_0ED7A3:
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w #$0010
	BMI.b CODE_0ED7AF
	SEC
	SBC.w #$000F
CODE_0ED7AF:
	ASL
	STA.w $7A36,x
	LDY.b #$0A
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr05B_RedCoinBandit
	BEQ.b CODE_0ED7D5
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0ED7D3
	LDY.b #$08
	STY.b $76,x
	LDA.w #$0009
	STA.w $7402,x
	LDA.w #$0002
	STA.b $16,x
	PLA
	RTS

CODE_0ED7D3:
	LDY.b #$0C
CODE_0ED7D5:
	STY.b $76,x
	LDA.w #$0004
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
	LDY.w $7A36,x
	LDA.w DATA_0ED5AE,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0007
	STA.w $7A36,x
	STZ.w $7542,x
	PLA
CODE_0ED7F6:
	RTS

CODE_0ED7F7:
	LDA.w $7860,x
	BIT.w #$000C
	BEQ.b CODE_0ED808
	AND.w #$0008
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0ED80D
CODE_0ED808:
	RTS

DATA_0ED809:
	dw $000E,$0002

CODE_0ED80D:
	LDA.w #$000E
	CMP.w $70E2,x
	BMI.b CODE_0ED819
	STA.w $70E2,x
	RTS

CODE_0ED819:
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_0ED82C
	LDA.w $7860,x
	BEQ.b CODE_0ED83C
	AND.w #$0008
	BNE.b CODE_0ED830
	BRA.b CODE_0ED82E

CODE_0ED82C:
	BMI.b CODE_0ED830
CODE_0ED82E:
	INY
	INY
CODE_0ED830:
	LDA.w $70E2,x
	AND.w #$FFF0
	ORA.w DATA_0ED809,y
	STA.w $70E2,x
CODE_0ED83C:
	RTS

;---------------------------------------------------------------------------
; Shared head-bop handler for the entire Bandit family ($020 / $05B / $0A3 / $0A4).
; Raiden: head_bop_bandit.
;---------------------------------------------------------------------------
YI_NorSpr020_Bandit_StompRt:
YI_NorSpr05B_RedCoinBandit_StompRt:
YI_NorSpr0A3_LeftHidingBandit_StompRt:
YI_NorSpr0A4_RightHidingBandit_StompRt:
head_bop_bandit:
;$0ED83D
	JSR.w CODE_0ECCC7
	JML.l CODE_head_bop_common

;---------------------------------------------------------------------------

CODE_0ED844:
	TXY
	BRA.b CODE_0ED88C

;---------------------------------------------------------------------------
; Sprite $05B: Red Coin Bandit (the bandit who steals a red coin instead of egg).
; Raiden: init_coin_bandit.
;---------------------------------------------------------------------------
YI_NorSpr05B_RedCoinBandit_Init:
init_coin_bandit:
;$0ED847
	JSL.l CODE_03D406
	LDX.b $12
	LDA.w #$0115
	JSL.l CODE_spawn_sprite_active
	BCS.b CODE_0ED85A
	JML.l CODE_03A31E

CODE_0ED85A:
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,y
	LDA.w #$FFFF
	STA.w $7A96,y
	STA.w $7A98,y
	STA.w $7AF6,y
	INC
	STA.w $7542,y
	LDA.w #$0022
	STA.w $7042,y
	LDA.w #$0800
	STA.w $7040,y
	STY.b $18,x
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
CODE_0ED88C:
	LDA.w $7182,x
	ASL
	ASL
	ASL
	ASL
	AND.w #$FF00
	ORA.w #$8000
	STA.b $00
	LDA.w $70E2,x
	LSR
	LSR
	LSR
	LSR
	AND.w #$00FF
	ORA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	RTL

;---------------------------------------------------------------------------

DATA_0ED8AB:
	dw CODE_0ECD8A
	dw CODE_0ECE01
	dw CODE_0ECEB1
	dw CODE_0ED1D0
	dw CODE_0EDA32
	dw CODE_0EDA7C
	dw CODE_0EDACD

;---------------------------------------------------------------------------
; Sprite $05B main. Raiden: main_coin_bandit.
;---------------------------------------------------------------------------
YI_NorSpr05B_RedCoinBandit_Main:
main_coin_bandit:
;$0ED8B9
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_0ED8D9
	JSR.w CODE_0ED956
	JSL.l CODE_03A2C7
	BCC.b CODE_0ED8E8
	LDY.b $18,x
	BMI.b CODE_0ED8D3
	TYX
	JSL.l CODE_03A31E
CODE_0ED8D3:
	LDX.b $12
	JML.l CODE_03A31E

CODE_0ED8D9:
	CMP.w #$0008
	BNE.b CODE_0ED8E5
	JSR.w CODE_0ED9C2
	JSR.w CODE_0ECBAE
	RTL

CODE_0ED8E5:
	JSR.w CODE_0ED9C2
CODE_0ED8E8:
	JSL.l CODE_03AF23
	LDA.w #$0040
	STA.w $7542,x
	TXY
	LDA.b $76,x
	TAX
	JSR.w (DATA_0ED8AB,x)
	LDY.b $18,x
	BMI.b CODE_0ED934
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0ED913
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr115_Coin
	BNE.b CODE_0ED913
	TXA
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	BEQ.b CODE_0ED919
CODE_0ED913:
	LDA.w #$FFFF
	STA.b $18,x
	RTL

CODE_0ED919:
	LDA.w $70E2,x
	STA.w $70E2,y
	LDY.w $7402,x
	LDA.w DATA_0ED935,y
	AND.w #$00FF
	ORA.w #$FF00
	CLC
	ADC.w $7182,x
	LDY.b $18,x
	STA.w $7182,y
CODE_0ED934:
	RTL

DATA_0ED935:
	db $E5,$E6,$E8,$E9,$EA,$E9,$E8,$E7,$E5,$E6,$E6,$E6,$E7,$E7,$E7,$E7
	db $E7,$E7,$ED,$EC,$EB,$EA,$EA,$E2,$E3,$EC,$EC,$EC,$EC,$EA,$E6,$E6
	db $E6

CODE_0ED956:
	LDY.w $7D36,x
	BMI.b CODE_0ED979
	LDY.w $7D36,x
	LDA.w $6EFF,y
	CMP.w #$0010
	BNE.b CODE_0ED96E
	LDA.w $7D37,y
	BEQ.b CODE_0ED96E
	JMP.w CODE_0EDA0F

CODE_0ED96E:
	PLA
	STA.b $00
	JSL.l CODE_03A5B7
	LDA.b $00
	PHA
CODE_0ED978:
	RTS

CODE_0ED979:
	LDA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	BNE.b CODE_0ED9B6
	LDY.w $60AB
	BMI.b CODE_0ED978
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_0ED978
	LDA.w $60FC
	AND.w #$0018
	BNE.b CODE_0ED978
	LDA.w #$FA00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDY.w $60D4
	BNE.b CODE_0ED9B6
	JSR.w CODE_0ED9C2
	INC.b $79,x
	JSR.w CODE_0ECBDB
	PLA
	RTL

CODE_0ED9B6:
	JSR.w CODE_0ECB73
	PLA
	JML.l CODE_03B24B

DATA_0ED9BE:
	dw $FE00,$0200

CODE_0ED9C2:
	LDY.w $7400,x
	LDA.w DATA_0ED9BE,y
	LDY.b $18,x
	BMI.b CODE_0ED9F5
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0100
	STA.w $7A96,y
	LDA.w #$0140
	STA.w $7A98,y
	LDA.w #$0020
	STA.w $7AF6,y
	ASL
	STA.w $7542,y
	SEP.b #$20
	LDA.w $74A0,x
	STA.w $74A0,y
	REP.b #$20
CODE_0ED9F5:
	LDA.w $7042,x
	PHA
	LDA.w #!Define_YI_NorSpr020_Bandit
	TXY
	JSL.l CODE_spawn_sprite
	PLA
	STA.w $7042,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	RTS

CODE_0EDA0F:
	LDY.w $7D36,x
	DEY
	TYX
	JSL.l CODE_03B24B
	JSR.w CODE_0ED9C2
	INC.b $78,x
	LDY.w $7D36,x
	LDA.w $7CD5,y
	LDY.b #$00
	SEC
	SBC.w $7CD6,x
	BMI.b CODE_0EDA2D
	INY
	INY
CODE_0EDA2D:
	JSR.w CODE_0ECBDE
	PLA
	RTL

CODE_0EDA32:
	TYX
	LDA.b $16,x
	BPL.b CODE_0EDA3E
	JSR.w CODE_0ED7F7
	STZ.b $16,x
	BRA.b CODE_0EDA41

CODE_0EDA3E:
	JSR.w CODE_0ED640
CODE_0EDA41:
	LDA.w #$000B
	STA.w $7540,x
	LDY.b $79,x
	TYA
	ASL
	ASL
	CLC
	ADC.w $7400,x
	TAY
	LDA.w DATA_0ECD7E,y
	STA.w $75E0,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_0EDA7B
	LDA.w #$0017
	STA.w $7402,x
	LDA.w #$0007
	STA.w $7A36,x
	STZ.w $7A98,x
	LDY.b #$0A
	STY.b $76,x
CODE_0EDA7B:
	RTS

CODE_0EDA7C:
	TYX
	JSR.w CODE_0ED7F7
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0EDACC
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_0EDA95
	LDA.w #$0018
	STA.w $7402,x
	BRA.b CODE_0EDACC

CODE_0EDA95:
	LDA.w $72C2,x
	CMP.w #$0003
	BMI.b CODE_0EDAAA
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A98,x
	BNE.b CODE_0EDACC
	DEC.w $7A36,x
	BPL.b CODE_0EDAB7
CODE_0EDAAA:
	STZ.w $7402,x
	LDY.b #$08
	STY.b $76,x
	LDA.w #$FFFF
	STA.b $16,x
	RTS

CODE_0EDAB7:
	LDY.w $7A36,x
	LDA.w DATA_0ECEA3,y
	AND.w #$00FF
	STA.w $7A98,x
	LDA.w DATA_0ECEAA,y
	AND.w #$00FF
	STA.w $7402,x
CODE_0EDACC:
	RTS

CODE_0EDACD:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0EDAE2
	LDA.w #$0002
	STA.w $7A98,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
CODE_0EDAE2:
	LDA.w $7AF6,x
	BNE.b CODE_0EDAF1
	STZ.w $7402,x
	STZ.w $7A36,x
	LDY.b #$08
	STY.b $76,x
CODE_0EDAF1:
	JSR.w CODE_0ED640
	LDA.w $7A96,x
	BNE.b CODE_0EDACC
	JMP.w CODE_0ED34B

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprites $058 / $05C: Green and Pink Toady (Toadies). Raiden: init_toadie.
;
; See docs/family-misc.md §5 for the full Toady family breakdown. Pink
; vs Green Toady is essentially identical code -- shared 6-state
; main_toadies; the "Pink is stronger/faster" perception is just
; palette + level placement (one $74A2 palette-frame branch differs).
;---------------------------------------------------------------------------
YI_NorSpr058_GreenToady_Init:
YI_NorSpr05C_PinkToady_Init:
init_toadie:
;$0EDAFC
	LDA.w #$0000
	STA.b $78,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr058_GreenToady
	BEQ.b CODE_0EDB33
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0EDB19
	JSR.w CODE_0EDE60
	LDY.b #$05
	STY.b $76,x
	RTL

CODE_0EDB19:
	LDA.w $7182,x
	LSR
	LSR
	LSR
	LSR
	XBA
	STA.b $00
	LDA.w $70E2,x
	LSR
	LSR
	LSR
	LSR
	ORA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.b #$02
	STY.b $76,x
CODE_0EDB33:
	RTL

;---------------------------------------------------------------------------

DATA_0EDB34:
	dw CODE_0EDC86
	dw CODE_0EDD6F
	dw CODE_0EDE44
	dw CODE_0EDE79
	dw CODE_0EDF03
	dw CODE_0EDFBD

;---------------------------------------------------------------------------
; Sprites $058 / $05C main (shared). Raiden: main_toadies.
;---------------------------------------------------------------------------
YI_NorSpr058_GreenToady_Main:
YI_NorSpr05C_PinkToady_Main:
main_toadies:
;$0EDB40
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_0EDBBB
	LDA.w $7D38,x
	BEQ.b CODE_0EDB5B
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr058_GreenToady
	BEQ.b CODE_0EDB5B
	LDA.w #$0002
	STA.w $74A2,x
CODE_0EDB5B:
	LDA.w $70E2,x
	SEC
	SBC.w #$0008
	CMP.w #$0FF0
	BCC.b CODE_0EDB76
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	JSR.w CODE_0ECCF9
	BRA.b CODE_0EDBBE

CODE_0EDB76:
	JSL.l CODE_03A2C7
	BCC.b CODE_0EDBBE
	LDY.b $76,x
	CPY.b #$01
	BEQ.b CODE_0EDBBE
	CPY.b #$04
	BEQ.b CODE_0EDBBE
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0EDBB7
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	CMP.w #$0010
	BEQ.b CODE_0EDBA3
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTL

CODE_0EDBA3:
	LDA.w $70E2,x
	STA.w $70E2
	LDA.w $7182,x
	SEC
	SBC.w #$000E
	STA.w $7182
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	RTL

CODE_0EDBB7:
	JML.l CODE_03A31E

CODE_0EDBBB:
	JSR.w CODE_0EDC67
CODE_0EDBBE:
	LDY.b $76,x
	CPY.b #$02
	BEQ.b CODE_0EDC32
	LDY.w $7D36,x
	BPL.b CODE_0EDC32
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF6
	BCC.b CODE_0EDC32
	LDY.w $60AB
	BMI.b CODE_0EDC32
	LDY.w $60C0
	BEQ.b CODE_0EDC32
	LDA.w #$0020
	STA.w $7542,x
	LDA.w #$0200
	STA.w $75E2,x
	LDA.w $7042,x
	ORA.w #$0080
	STA.w $7042,x
	LDA.w #$EE60
	STA.w $6FA0,x
	LDA.w #$1000
	STA.w $6FA2,x
	LDA.w #$2805
	STA.w $7040,x
	LDY.b #!Define_YI_SoundID3A_StompShyGuy
	JSL.l CODE_03A0E7
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$FC00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	JSR.w CODE_0EDC67
	RTL

CODE_0EDC32:
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0EDB34,x)
	LDA.w $7A98,x
	BNE.b CODE_0EDC53
	LDA.w #$0006
	STA.w $7A98,x
	LDA.w $7402,x
	INC
	AND.w #$0003
	STA.w $7402,x
CODE_0EDC53:
	LDY.w $75E3,x
	BPL.b CODE_0EDC66
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0EDC66
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0EDC66:
	RTL

CODE_0EDC67:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0EDC73
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSL.l CODE_06C114
CODE_0EDC73:
	RTS

DATA_0EDC74:
	dw $FF4D,$00B3,$FEF4,$010C,$FDE7,$0219

DATA_0EDC80:
	dw $0016,$002C,$0043

CODE_0EDC86:
	TYX
	LDA.w #$0005
	STA.w $7540,x
	STA.w $7542,x
	LDA.w $7AF8,x
	BEQ.b CODE_0EDCBE
CODE_0EDC95:
	LDA.w $7A96,x
	BNE.b CODE_0EDCBD
	LDA.w #$0030
	STA.w $7A96,x
	LDA.b $10
	AND.w #$0002
	TAY
	LDA.w DATA_0EDC74,y
	STA.w $75E0,x
	TYA
	STA.w $7400,x
	LDA.b $10
	XBA
	AND.w #$0002
	TAY
	LDA.w DATA_0EDC74,y
	STA.w $75E2,x
CODE_0EDCBD:
	RTS

CODE_0EDCBE:
	LDY.w $7D36,x
	BPL.b CODE_0EDCD0
	LDY.w $61B3
	BPL.b CODE_0EDCF2
	JSR.w CODE_0EDD2E
	JSR.w CODE_0ED3CB
	BRA.b CODE_0EDCE0

CODE_0EDCD0:
	DEY
	BNE.b CODE_0EDCF2
	LDA.w $61B2
	AND.w #$6000
	BNE.b CODE_0EDC95
	JSR.w CODE_0ED39D
	BCS.b CODE_0EDCF2
CODE_0EDCE0:
	INC.b $76,x
	SEP.b #$20
	LDA.b $00
	STA.b $18,x
	LDA.b $02
	SEC
	SBC.b #$0E
	STA.b $19,x
	REP.b #$20
	RTS

CODE_0EDCF2:
	LDA.w $7A96,x
	BNE.b CODE_0EDD25
	LDA.w #$0030
	STA.w $7A96,x
	LDY.b #$00
	LDA.w $70E2
	CMP.w $70E2,x
	BMI.b CODE_0EDD09
	INY
	INY
CODE_0EDD09:
	LDA.w DATA_0EDC74,y
	STA.w $75E0,x
	TYA
	STA.w $7400,x
	LDY.b #$00
	LDA.w $7182
	CMP.w $7182,x
	BMI.b CODE_0EDD1F
	INY
	INY
CODE_0EDD1F:
	LDA.w DATA_0EDC74,y
	STA.w $75E2,x
CODE_0EDD25:
	RTS

DATA_0EDD26:
	dw $000F,$FFF1

DATA_0EDD2A:
	dw $0017,$FFE9

CODE_0EDD2E:
	LDY.b #$00
	LDA.w $70E2
	SEC
	SBC.w $70E2,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCC.b CODE_0EDD4E
	BPL.b CODE_0EDD44
	INY
	INY
CODE_0EDD44:
	LDA.w DATA_0EDD26,y
	CLC
	ADC.w $70E2,x
	STA.w $70E2
CODE_0EDD4E:
	LDY.b #$00
	LDA.w $7182
	SEC
	SBC.w $7182,x
	CLC
	ADC.w #$0018
	CMP.w #$0030
	BCC.b CODE_0EDD6E
	BPL.b CODE_0EDD64
	INY
	INY
CODE_0EDD64:
	LDA.w DATA_0EDD2A,y
	CLC
	ADC.w $7182,x
	STA.w $7182
CODE_0EDD6E:
	RTS

CODE_0EDD6F:
	TYX
	LDA.w $60A8
	BPL.b CODE_0EDD79
	EOR.w #$FFFF
	INC
CODE_0EDD79:
	CLC
	ADC.w #$0080
	AND.w #$0200
	ASL
	XBA
	STA.b $00
	LDY.w $77C2,x
	TYA
	CLC
	ADC.b $00
	EOR.w #$0002
	TAY
	LDA.w DATA_0EDC74,y
	ASL
	STA.w $75E0,x
	PHY
	TYA
	AND.w #$0004
	LSR
	TAY
	LDA.w DATA_0EDC80,y
	ASL
	STA.w $7540,x
	PLY
	TYA
	EOR.w #$0002
	AND.w #$0002
	STA.w $7400,x
	STZ.b $00
	LDA.w $7C18,x
	SEC
	SBC.w #$0010
	BPL.b CODE_0EDDBE
	INC.b $00
	INC.b $00
CODE_0EDDBE:
	LDA.w $60AA
	BPL.b CODE_0EDDC7
	EOR.w #$FFFF
	INC
CODE_0EDDC7:
	CLC
	ADC.w #$0080
	AND.w #$0200
	ASL
	XBA
	CLC
	ADC.b $00
	EOR.w #$0002
	TAY
	LDA.w DATA_0EDC74,y
	ASL
	STA.w $75E2,x
	TYA
	AND.w #$0004
	LSR
	TAY
	LDA.w DATA_0EDC80,y
	ASL
	STA.w $7542,x
	LDA.w $7680,x
	SEC
	SBC.w #$0020
	CMP.w #$00C0
	BCC.b CODE_0EDE06
	EOR.w $75E0,x
	BMI.b CODE_0EDE06
	LDA.w $75E0,x
	EOR.w #$FFFF
	INC
	STA.w $75E0,x
CODE_0EDE06:
	LDA.w $7C18,x
	BPL.b CODE_0EDE17
	LDA.w $7682,x
	SEC
	SBC.w #$0030
	CMP.w #$00A0
	BCC.b CODE_0EDE26
CODE_0EDE17:
	EOR.w $75E2,x
	BMI.b CODE_0EDE26
	LDA.w $75E2,x
	EOR.w #$FFFF
	INC
	STA.w $75E2,x
CODE_0EDE26:
	JSR.w CODE_0EDE2F
	LDA.w #$FFF2
	JMP.w CODE_0ED2EF

CODE_0EDE2F:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	BEQ.b CODE_0EDE3E
	CMP.w #$0008
	BEQ.b CODE_0EDE3E
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_0EDE43
CODE_0EDE3E:
	JSL.l CODE_06C114
	PLA
CODE_0EDE43:
	RTS

CODE_0EDE44:
	TYX
	LDA.w $61B2
	BNE.b CODE_0EDE78
	LDA.w $6094
	CLC
	ADC.w #$0080
	STA.w $70E2,x
	LDA.w $609C
	SEC
	SBC.w #$0018
	STA.w $7182,x
	INC.b $76,x
CODE_0EDE60:
	LDA.w #$EE00
	STA.w $6FA0,x
	LDA.w #$0881
	STA.w $6FA2,x
	LDA.w #$2801
	STA.w $7040,x
	LDA.w #$0002
	STA.w $74A2,x
CODE_0EDE78:
	RTS

CODE_0EDE79:
	TYX
	LDA.w $61B2
	BEQ.b CODE_0EDE84
	LDY.b #$05
	STY.b $76,x
	RTS

CODE_0EDE84:
	LDA.w #$0002
	STA.w $7400,x
	LDA.w $7CD6
	SEC
	SBC.w $7CD6,x
	PHP
	BPL.b CODE_0EDE98
	EOR.w #$FFFF
	INC
CODE_0EDE98:
	LSR
	CMP.w #$0018
	BMI.b CODE_0EDEA1
	LDA.w #$0018
CODE_0EDEA1:
	CLC
	ADC.w #$0018
	STA.w $7540,x
	ASL
	ASL
	ASL
	ASL
	PLP
	BPL.b CODE_0EDEB6
	EOR.w #$FFFF
	INC
	STZ.w $7400,x
CODE_0EDEB6:
	STA.w $75E0,x
	LDA.w $7CD8
	SEC
	SBC.w $7CD8,x
	PHP
	BPL.b CODE_0EDEC7
	EOR.w #$FFFF
	INC
CODE_0EDEC7:
	LSR
	CMP.w #$0018
	BMI.b CODE_0EDED0
	LDA.w #$0018
CODE_0EDED0:
	CLC
	ADC.w #$0018
	STA.w $7542,x
	ASL
	ASL
	ASL
	ASL
	PLP
	BPL.b CODE_0EDEE2
	EOR.w #$FFFF
	INC
CODE_0EDEE2:
	STA.w $75E2,x
	JSR.w CODE_0ED39D
	BCS.b CODE_0EDEFE
	STZ.w $7A36,x
	INC.b $76,x
	SEP.b #$20
	LDA.b $00
	STA.b $18,x
	LDA.b $02
	SEC
	SBC.b #$0E
	STA.b $19,x
	REP.b #$20
CODE_0EDEFE:
	RTS

DATA_0EDEFF:
	dw $FF00,$0100

CODE_0EDF03:
	TYX
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TYA
	ASL
	INC
	ASL
	ASL
	ASL
	STA.b $00
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	TYA
	ASL
	INC
	ASL
	ASL
	ASL
	STA.b $02
	LDA.b $00
	SEC
	SBC.w $7CD6,x
	STA.b $00
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCC.b CODE_0EDF3A
	EOR.w $75E0,x
	BPL.b CODE_0EDF3A
	LDA.w $75E0,x
	EOR.w #$FFFF
	INC
	STA.w $75E0,x
CODE_0EDF3A:
	LDY.w $77C2,x
	TYA
	STA.w $7400,x
	LDY.w $7A36,x
	BEQ.b CODE_0EDF5E
	LDA.w $7A96,x
	BNE.b CODE_0EDF5B
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w $75E2,x
	EOR.w #$FFFF
	INC
	STA.w $75E2,x
CODE_0EDF5B:
	JMP.w CODE_0EDE26

CODE_0EDF5E:
	LDA.b $02
	SEC
	SBC.w $7CD8,x
	STA.b $02
	CLC
	ADC.w #$0004
	CMP.w #$0008
	BCS.b CODE_0EDF93
	LDA.w #$0020
	STA.w $7A96,x
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0EDF7E
	INY
	INY
CODE_0EDF7E:
	LDA.w #$0020
	STA.w $7542,x
	INC.w $7A36,x
	LDA.w DATA_0EDEFF,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	BRA.b CODE_0EDFB7

CODE_0EDF93:
	LDA.b $02
	PHP
	BPL.b CODE_0EDF9C
	EOR.w #$FFFF
	INC
CODE_0EDF9C:
	LSR
	CMP.w #$0018
	BMI.b CODE_0EDFA5
	LDA.w #$0018
CODE_0EDFA5:
	CLC
	ADC.w #$0018
	STA.w $7542,x
	ASL
	ASL
	ASL
	ASL
	PLP
	BPL.b CODE_0EDFB7
	EOR.w #$FFFF
	INC
CODE_0EDFB7:
	STA.w $75E2,x
	JMP.w CODE_0EDE26

CODE_0EDFBD:
	TYX
	LDA.w $61B2
	BNE.b CODE_0EDFC8
	LDY.b #$03
	STY.b $76,x
	RTS

CODE_0EDFC8:
	STZ.w $75E0,x
	LDA.w #$0004
	STA.w $7540,x
	LDA.w #$FE00
	STA.w $75E2,x
	LDA.w #$0020
	STA.w $7542,x
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $017: Frog Pirate. Raiden: init_frog_pirate. See docs/bossengine.md.
;---------------------------------------------------------------------------
YI_NorSpr017_FrogPirate_Init:
init_frog_pirate:
;$0EDFDE
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $7863,x
	REP.b #$20
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	INC
	INC
	TAY
	STY.b $77,x
	RTL

;---------------------------------------------------------------------------

DATA_0EDFF9:
	dw CODE_0EE540
	dw CODE_0EE65A
	dw CODE_0EE699
	dw CODE_0EE774
	dw CODE_0EE7B1
	dw CODE_0EE871
	dw CODE_0EE8A6
	dw CODE_0EE699
	dw CODE_0EE91F
	dw CODE_0EE986
	dw CODE_0EE9A7
	dw CODE_0EE9DB
	dw CODE_0EEA0B
	dw CODE_0EEA97
	dw CODE_0EE699
	dw CODE_0EEAEB
	dw CODE_0EE774
	dw CODE_0EE7B1
	dw CODE_0EEB90
	dw CODE_0EEBAC
	dw CODE_0EEC2C

;---------------------------------------------------------------------------
; Sprite $017 main. Raiden: main_frog_pirate.
;---------------------------------------------------------------------------
YI_NorSpr017_FrogPirate_Main:
main_frog_pirate:
;$0EE023
	JSR.w CODE_0EE112
	LDY.b $76,x
	CPY.b #$0D
	BPL.b CODE_0EE094
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0EE046
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_0EE04D
	JSL.l CODE_03B69D
	JSL.l CODE_03B716
	BRA.b CODE_0EE04D

CODE_0EE046:
	JSR.w CODE_0EE1B3
	JSL.l CODE_03AF23
CODE_0EE04D:
	JSR.w CODE_0EE1D9
	JSR.w CODE_0EE231
	LDY.b $76,x
	TYA
	ASL
	TXY
	TAX
	JSR.w (DATA_0EDFF9,x)
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_0EE06D
	JSR.w CODE_0EE2C6
	JSR.w CODE_0EE4DD
CODE_0EE06D:
	JSR.w CODE_0EE519
	STZ.w $7540,x
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0EE093
	LDA.w #$0040
	STA.w $7540,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_0EE093
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
CODE_0EE093:
	RTL

CODE_0EE094:
	CPY.b #$15
	BPL.b CODE_0EE0D3
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0EE0B0
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_0EE0B0
	JSL.l CODE_03B69D
	JSL.l CODE_03B716
CODE_0EE0B0:
	LDY.b $76,x
	TYA
	ASL
	TXY
	TAX
	JSR.w (DATA_0EDFF9,x)
	JSR.w CODE_0EEDF2
	JSR.w CODE_0EE519
	LDA.w $60BE
	CMP.w #$0166
	BNE.b CODE_0EE0D2
	LDA.w $7A96,x
	BNE.b CODE_0EE0D2
	LDA.w #$000C
	STA.w $6124
CODE_0EE0D2:
	RTL

CODE_0EE0D3:
	JSL.l CODE_03AF23
	JSR.w CODE_0EE1D9
	JSR.w CODE_0EE519
	RTL

CODE_0EE0DE:
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$000C
	STA.w $7402,x
	LDA.w $7042,x
	ORA.w #$0080
	STA.w $7042,x
	LDA.w #$4060
	STA.w $6FA0,x
	LDA.w #$8840
	STA.w $6FA2,x
	LDY.b #$15
	STY.b $76,x
	RTL

DATA_0EE10A:
	db $FE,$0A,$03,$05

DATA_0EE10E:
	db $05,$05,$01,$01

CODE_0EE112:
	LDA.w $7362,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	BMI.b CODE_0EE11F
	LDY.w $74A2,x
	BPL.b CODE_0EE120
CODE_0EE11F:
	RTS

CODE_0EE120:
	LDY.b $79,x
	TYA
	STA.w $602A
	STA.w $602C
	LDY.b $18,x
	BEQ.b CODE_0EE132
	STZ.w $602A
	BRA.b CODE_0EE135

CODE_0EE132:
	STZ.w $602C
CODE_0EE135:
	LDA.w $7400,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	BEQ.b CODE_0EE148
	INY
	LDA.w $602A
	EOR.w #$FFFF
	INC
	STA.w $602A
CODE_0EE148:
	LDA.w DATA_0EE10A,y
	AND.w #$00FF
	STA.w $6038
	LDA.w DATA_0EE10E,y
	AND.w #$00FF
	STA.w $603A
	LDY.b $78,x
	LDA.w DATA_0EF2E0,y
	AND.w #$00FF
	STA.w $6024
	TYA
	BEQ.b CODE_0EE16D
	ASL
	TAY
	LDA.w DATA_0EF2FF-$02,y
CODE_0EE16D:
	STA.w $6026
	LDY.w $7402,x
	LDA.w DATA_0EEEB7,y
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	TYA
	ASL
	TAY
	LDA.w DATA_0EEEC8,y
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w DATA_0EF798,y
	STA.w $6028
	LDA.w #DATA_0EEEEA>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7680,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7682,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7400,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_08A2C6>>16
	LDA.w #FXCODE_08A2C6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	RTS

CODE_0EE1B3:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_0EE1C8
	LDY.w $74A2,x
	BPL.b CODE_0EE1C8
	STZ.w $7402,x
	STZ.b $78,x
	JMP.w CODE_0EE519

CODE_0EE1C8:
	LDY.w $7D38,x
	BEQ.b CODE_0EE1D8
	LDY.w $7862,x
	BEQ.b CODE_0EE1D8
	LDA.w #$0001
	STA.w $7860,x
CODE_0EE1D8:
	RTS

CODE_0EE1D9:
	LDA.w #$07E0
	CMP.w $7182,x
	BPL.b CODE_0EE1E4
	STA.w $7182,x
CODE_0EE1E4:
	LDA.w $70E2,x
	SEC
	SBC.w #$0010
	BPL.b CODE_0EE20C
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0EE20C
	LDA.w #$0010
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	RTS

CODE_0EE20C:
	JSL.l CODE_03A2C7
	BCC.b CODE_0EE230
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_0EE21C
	PLA
	JML.l CODE_03A31E

CODE_0EE21C:
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
CODE_0EE230:
	RTS

CODE_0EE231:
	LDY.b $76,x
	CPY.b #$06
	BEQ.b CODE_0EE275
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_0EE276
	LDY.w $7862,x
	BEQ.b CODE_0EE275
	LDA.w $7A38,x
	BNE.b CODE_0EE275
	LDA.w $70E2,x
	STA.w $7A38,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0006
	LDY.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CPY.b #$01
	BNE.b CODE_0EE25F
	LDA.w #$FFFD
CODE_0EE25F:
	STA.w $7720,x
	LDA.w $6FA2,x
	AND.w #$F7FF
	STA.w $6FA2,x
	LDY.b $76,x
	CPY.b #$08
	BEQ.b CODE_0EE275
	LDY.b #$09
	STY.b $76,x
CODE_0EE275:
	RTS

CODE_0EE276:
	LDY.b $76,x
	CPY.b #$08
	BEQ.b CODE_0EE28C
	CPY.b #$09
	BEQ.b CODE_0EE28C
	CPY.b #$0A
	BEQ.b CODE_0EE28C
	CPY.b #$0B
	BEQ.b CODE_0EE28C
	CPY.b #$0C
	BNE.b CODE_0EE275
CODE_0EE28C:
	LDA.w $7A38,x
	BEQ.b CODE_0EE275
	STZ.w $7A38,x
	STZ.w $7720,x
	LDA.w $6FA2,x
	ORA.w #$0800
	STA.w $6FA2,x
	LDA.w #$0080
	STA.w $7542,x
	LDA.w #$0800
	STA.w $75E2,x
	STZ.w $7A96,x
	LDY.b $76,x
	CPY.b #$08
	BEQ.b CODE_0EE275
	LDY.b #$00
	STY.b $76,x
	RTS

DATA_0EE2BA:
	dw $0180,$FE80

DATA_0EE2BE:
	dw $0040,$FFC0

DATA_0EE2C2:
	dw $FC80,$0380

CODE_0EE2C6:
	LDY.w $7D36,x
	BMI.b CODE_0EE308
	DEY
	BNE.b CODE_0EE305
	LDA.w $61B2
	AND.w #$6000
	BNE.b CODE_0EE304
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	SEC
	SBC.w #$0010
	ORA.w $7AF8,x
	ORA.w $0D9C
	ORA.w $61CC
	BNE.b CODE_0EE304
	LDY.b $76
	CPY.b #$04
	BEQ.b CODE_0EE304
	CPY.b #$01
	BEQ.b CODE_0EE304
	LDY.b $76,x
	CPY.b #$08
	BEQ.b CODE_0EE304
	CPY.b #$09
	BEQ.b CODE_0EE304
	CPY.b #$0B
	BEQ.b CODE_0EE304
	CPY.b #$0C
	BNE.b CODE_0EE36E
CODE_0EE304:
	RTS

CODE_0EE305:
	JMP.w CODE_0EE411

CODE_0EE308:
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_0EE352
	LDY.w $60AB
	BMI.b CODE_0EE304
	LDY.w $7402,x
	CPY.b #$08
	BEQ.b CODE_0EE328
	CPY.b #$09
	BNE.b CODE_0EE333
CODE_0EE328:
	LDY.b $76,x
	CPY.b #$08
	BEQ.b CODE_0EE39C
	JSL.l CODE_03A858
	RTS

CODE_0EE333:
	LDA.w $7AF6,x
	BNE.b CODE_0EE304
	LDA.w $60FC
	AND.w #$0018
	BNE.b CODE_0EE304
	LDA.w #$FA00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	STZ.w $60D4
	JMP.w CODE_0EE458

CODE_0EE352:
	LDY.b $76,x
	CPY.b #$08
	BEQ.b CODE_0EE39C
	CPY.b #$09
	BEQ.b CODE_0EE39C
	CPY.b #$0B
	BEQ.b CODE_0EE39C
	CPY.b #$0C
	BEQ.b CODE_0EE39C
	LDA.w $7AF6,x
	BNE.b CODE_0EE39C
	LDY.w $61B3
	BPL.b CODE_0EE39C
CODE_0EE36E:
	LDA.w $7AF8,x
	BNE.b CODE_0EE304
	JSR.w CODE_0EED35
	JSR.w CODE_0EEE29
	LDA.w #$0101
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.b #$06
	STY.b $76,x
	LDA.w #$0040
	TSB.w $6FA0
	LDY.b $79,x
	CPY.b #$58
	BNE.b CODE_0EE39B
	LDA.w #$580B
	LDY.b $18,x
	BEQ.b CODE_0EE399
	LDA.w #$5816
CODE_0EE399:
	STA.b $78,x
CODE_0EE39B:
	RTS

CODE_0EE39C:
	LDA.w $61D6
	BNE.b CODE_0EE39B
	LDY.b #$00
	LDA.w $60A8
	BNE.b CODE_0EE3AF
	LDA.w $60C4
	EOR.w #$0002
	DEC
CODE_0EE3AF:
	BPL.b CODE_0EE3B3
	INY
	INY
CODE_0EE3B3:
	LDA.w DATA_0EE2BE,y
	LDY.w $7A38,x
	BNE.b CODE_0EE3D9
	ASL
	ASL
	PHA
	LDA.w $7860,x
	AND.w #$0002
	BNE.b CODE_0EE3CC
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0EE3CC:
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	PLA
CODE_0EE3D9:
	CLC
	ADC.w $60A8
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b #$00
	CLC
	ADC.w #$0380
	CMP.w #$0700
	BCC.b CODE_0EE3F5
	BMI.b CODE_0EE3EF
	INY
	INY
CODE_0EE3EF:
	LDA.w DATA_0EE2C2,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0EE3F5:
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_0EE409
	SEC
	SBC.w #$0008
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0EE409
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0EE409:
	LDA.w #!Define_YI_SoundID65_JumpOnFrog
	JSL.l CODE_push_sound_queue
CODE_0EE410:
	RTS

CODE_0EE411:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098F33>>16
	LDA.w #FXCODE_098F33
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_0EE410
	LDA.w $7BB6,x
	CLC
	ADC.w $7BB6,y
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	CMP.b $00
	BCS.b CODE_0EE410
	LDA.w $7BB8,x
	CLC
	ADC.w $7BB8,y
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	CMP.b $00
	BCS.b CODE_0EE410
	TYX
	JSL.l CODE_03B24B
CODE_0EE458:
	LDA.w #!Define_YI_SoundID65_JumpOnFrog
	JSL.l CODE_push_sound_queue
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0800
	STA.w $75E2,x
	LDA.w #$0080
	STA.w $7542,x
	LDA.w $7A38,x
	BEQ.b CODE_0EE482
	STZ.w $7542,x
	STZ.w $75E2,x
	LDA.w #$0080
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0EE482:
	LDA.w #$000B
	LDY.w $7402,x
	CPY.b #$08
	BEQ.b CODE_0EE498
	CPY.b #$09
	BEQ.b CODE_0EE498
	CPY.b #$0D
	BEQ.b CODE_0EE498
	CPY.b #$0E
	BNE.b CODE_0EE49B
CODE_0EE498:
	LDA.w #$000D
CODE_0EE49B:
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
	LDY.b $76,x
	CPY.b #$08
	BEQ.b CODE_0EE4C9
	LDY.b #$08
	STY.b $76,x
	LDA.w $6FA2,x
	ORA.w #$0480
	STA.w $6FA2,x
	LDY.b $79,x
	CPY.b #$58
	BNE.b CODE_0EE4C9
	LDA.w #$580A
	LDY.b $18,x
	BEQ.b CODE_0EE4C7
	LDA.w #$5816
CODE_0EE4C7:
	STA.b $78,x
CODE_0EE4C9:
	LDA.w #$0040
	STA.w $7A96,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0EE4D8
	JSL.l CODE_06C114
CODE_0EE4D8:
	RTS

DATA_0EE4D9:
	dw $FFFC,$0004

CODE_0EE4DD:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0EE518
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	CMP.w #$0010
	BEQ.b CODE_0EE4FA
	SEP.b #$20
	LDA.b #$00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	REP.b #$20
	LDA.w #$0080
	STA.w $7AF8,x
	RTS

CODE_0EE4FA:
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400
	TAY
	LDA.w $70E2,x
	CLC
	ADC.w DATA_0EE4D9,y
	STA.w $70E2
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w $7182
CODE_0EE518:
	RTS

CODE_0EE519:
	SEP.b #$20
	LDA.b #$00
	LDY.b $78,x
	BEQ.b CODE_0EE524
	LDA.w DATA_0EF2E0,y
CODE_0EE524:
	LDY.w $7402,x
	CLC
	ADC.w DATA_0EEEB7,y
	CLC
	ADC.w DATA_0EF787,y
	ASL
	ASL
	ASL
	STA.w $7041,x
	REP.b #$20
	RTS

DATA_0EE538:
	dw $0001,$0000

DATA_0EE53C:
	dw $0003,$0001

CODE_0EE540:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0EE5AB
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A96,x
	BNE.b CODE_0EE5B8
	LDY.w $7862,x
	BNE.b CODE_0EE571
	LDA.b $11
	AND.w #$0001
	BNE.b CODE_0EE571
	LDA.w #$0002
	STA.w $7402,x
	ASL
	STA.b $16,x
	LDA.w #$0010
	STA.w $7A98,x
	LDY.b #$01
	STY.b $76,x
	RTS

CODE_0EE571:
	LDA.b $10
	AND.w #$0002
	STA.w $7400,x
	DEC
	STA.b $00
	LDY.b $77,x
	LDA.w $7A36,x
	CLC
	ADC.w DATA_0EE538-$02,y
	CMP.w DATA_0EE53C-$02,y
	BCC.b CODE_0EE597
	EOR.b $00
	BPL.b CODE_0EE597
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_0EE597:
	LDY.b #$02
	STY.b $76,x
CODE_0EE59B:
	LDA.w #$0002
	STA.b $16,x
	LDA.w $7400,x
	DEC
	CLC
	ADC.w $7A36,x
	STA.w $7A36,x
CODE_0EE5AB:
	RTS

DATA_0EE5AC:
	dw $0001,$0005

DATA_0EE5B0:
	dw $0004,$0008

DATA_0EE5B4:
	dw $0003,$0004

CODE_0EE5B8:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TYA
	ORA.w $7AF6,x
	BNE.b CODE_0EE5F0
	LDY.w $61B3
	BPL.b CODE_0EE5F1
	LDA.w $7C16,x
	STA.b $00
	LDA.w $7C18,x
	JSR.w CODE_0EE607
	BCS.b CODE_0EE5F0
CODE_0EE5D3:
	LDA.w DATA_0EE5AC,y
	STA.w $7402,x
	LDA.w DATA_0EE5B4,y
	STA.b $16,x
	LDA.w DATA_0EE5B0,y
	STA.w $7A98,x
	STY.b $18,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.b #$03
	STY.b $76,x
CODE_0EE5F0:
	RTS

CODE_0EE5F1:
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6
	STA.b $00
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8
	JSR.w CODE_0EE607
	BCC.b CODE_0EE5D3
	RTS

CODE_0EE607:
	STA.b $02
	LDY.b #$02
	LDA.b $00
	CLC
	ADC.w #$0030
	CMP.w #$0060
	BCS.b CODE_0EE622
	LDA.b $02
	CMP.w #$0040
	BCS.b CODE_0EE622
	CMP.w #$0018
	BCS.b CODE_0EE652
CODE_0EE622:
	LDA.w $7A38,x
	BEQ.b CODE_0EE629
	SEC
	RTS

CODE_0EE629:
	LDA.w $7400,x
	DEC
	EOR.b $00
	BMI.b CODE_0EE63A
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_0EE63A:
	LDA.b $00
	CLC
	ADC.w #$0050
	CMP.w #$00A0
	BCS.b CODE_0EE653
	LDA.b $02
	CLC
	ADC.w #$0018
	CMP.w #$0030
	BCS.b CODE_0EE653
	DEY
	DEY
CODE_0EE652:
	CLC
CODE_0EE653:
	RTS

DATA_0EE654:
	db $03,$02,$03

DATA_0EE657:
	db $10,$10,$10

CODE_0EE65A:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0EE687
	DEC.b $16,x
	BNE.b CODE_0EE667
	JMP.w CODE_0EE94B

CODE_0EE667:
	LDY.b $16,x
	LDA.w DATA_0EE657-$01,y
	AND.w #$00FF
	STA.w $7A98,x
	LDA.w DATA_0EE654-$01,y
	AND.w #$00FF
	STA.w $7402,x
	CMP.w #$0002
	BNE.b CODE_0EE687
	LDA.w #!Define_YI_SoundID5E_FrogCroak
	JSL.l CODE_push_sound_queue
CODE_0EE687:
	RTS

DATA_0EE688:
	db $0A,$02,$01

DATA_0EE68B:
	db $00,$10,$04,$00,$06,$02

DATA_0EE691:
	dw $FE60,$01A0,$FE00,$0200

CODE_0EE699:
	TYX
	LDY.b $16,x
	BMI.b CODE_0EE706
	LDA.w $7A98,x
	BNE.b CODE_0EE705
	LDA.w DATA_0EE688,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$00FF
	BNE.b CODE_0EE6BD
	LDA.w DATA_0EE68B,y
	AND.w #$00FF
	STA.w $7A98,x
CODE_0EE6BD:
	DEY
	STY.b $16,x
	BPL.b CODE_0EE705
	LDA.w #!Define_YI_SoundID35_FrogHop
	JSL.l CODE_push_sound_queue
	LDA.w #$F980
	LDY.b $76,x
	CPY.b #$0E
	BNE.b CODE_0EE6D5
	LDA.w #$F680
CODE_0EE6D5:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0080
	STA.w $7542,x
	LDA.w #$0800
	STA.w $75E2,x
	LDY.w $7400,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$00FF
	BEQ.b CODE_0EE6FB
	TYA
	CLC
	ADC.w #$0004
	TAY
	LDA.w #$F800
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0EE6FB:
	LDA.w DATA_0EE691,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b #$00
	STY.b $19,x
CODE_0EE705:
	RTS

CODE_0EE706:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0EE761
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.w $7402,x
	CPY.b #$0B
	BEQ.b CODE_0EE729
	INC.w $7402,x
	LDA.w #$0004
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_0EE726
	LDA.w #$000A
CODE_0EE726:
	STA.w $7A98,x
CODE_0EE729:
	LDA.w $7A98,x
	BNE.b CODE_0EE761
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_0EE753
	LDY.b $76,x
	CPY.b #$0E
	BEQ.b CODE_0EE73C
	JMP.w CODE_0EE94B

CODE_0EE73C:
	STZ.w $7402,x
	INC.w $1015
	LDA.w #$0000
	LDY.w !RAM_YI_Level_BossHasBeenVisitedBeforeFlagLo
	BNE.b CODE_0EE74D
	LDA.w #$0180
CODE_0EE74D:
	STA.w $7A96,x
	INC.b $76,x
	RTS

CODE_0EE753:
	STZ.w $7402,x
	LDA.w #$0002
	STA.b $16,x
	STA.w $7400,x
	STZ.w $7A98,x
CODE_0EE761:
	RTS

DATA_0EE762:
	db $04,$03,$02,$09,$08,$07,$06

DATA_0EE769:
	db $00,$02,$08,$00,$02,$08,$02

DATA_0EE770:
	db $01,$08,$0C,$08

CODE_0EE774:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0EE7AE
	DEC.b $16,x
	LDA.b $16,x
	BNE.b CODE_0EE793
	LDY.b $18,x
	LDA.w DATA_0EE770,y
	STA.b $78,x
	LDA.w #!Define_YI_SoundID3E_Tongue
	JSL.l CODE_push_sound_queue
	INC.b $76,x
	LDA.w #$0000
CODE_0EE793:
	LDY.b $18,x
	BEQ.b CODE_0EE79B
	CLC
	ADC.w #$0003
CODE_0EE79B:
	TAY
	LDA.w DATA_0EE762,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_0EE769,y
	AND.w #$00FF
	STA.w $7A98,x
CODE_0EE7AE:
	JMP.w CODE_0EEE8A

CODE_0EE7B1:
	TYX
	LDA.w $7A98,x
	BEQ.b CODE_0EE7BA
	JMP.w CODE_0EE855

CODE_0EE7BA:
	LDY.b $19,x
	BNE.b CODE_0EE815
	LDA.b $78,x
	CLC
	ADC.w #$0801
	STA.b $78,x
	XBA
	TAY
	CPY.b #$60
	BEQ.b CODE_0EE7CF
	JMP.w CODE_0EE855

CODE_0EE7CF:
	LDY.b $76,x
	CPY.b #$11
	BNE.b CODE_0EE7FA
	LDA.w #$580B
	STA.b $78,x
	LDA.w #$0006
	STA.w $7A98,x
	LDY.b #$02
	STY.b $19,x
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w $70E2,x
	SEC
	SBC.w $6038
	AND.w #$00FF
	XBA
	ORA.w #$0058
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTS

CODE_0EE7FA:
	LDA.w #$5817
	LDY.b $18,x
	BEQ.b CODE_0EE804
	LDA.w #$581B
CODE_0EE804:
	STA.b $78,x
	LDA.w #$0008
	STA.b $16,x
	LDA.w #!Define_YI_SoundID35_FrogHop
	JSL.l CODE_push_sound_queue
	INC.b $76,x
	RTS

CODE_0EE815:
	LDA.b $78,x
	SEC
	SBC.w #$0801
	STA.b $78,x
	XBA
	TAY
	CPY.b #$00
	BNE.b CODE_0EE855
	STZ.w $7402,x
	STZ.b $78,x
	LDY.b #$00
	STY.b $19,x
	LDY.b $76,x
	CPY.b #$11
	BNE.b CODE_0EE842
	LDA.w #!Define_YI_SoundID14_Gulp
	JSL.l CODE_push_sound_queue
	LDA.w #$0040
	STA.w $7A98,x
	INC.b $76,x
	RTS

CODE_0EE842:
	LDA.w $7A38,x
	BEQ.b CODE_0EE852
	LDA.w #$0006
	STA.w $7A96,x
	LDY.b #$0B
	STY.b $76,x
CODE_0EE851:
	RTS

CODE_0EE852:
	JMP.w CODE_0EE571

CODE_0EE855:
	LDY.b $76,x
	CPY.b #$11
	BEQ.b CODE_0EE851
	JSR.w CODE_0EEC41
	JMP.w CODE_0EEE8A

DATA_0EE861:
	db $0B,$19,$1A,$19,$1A,$17,$18,$17,$16,$1D,$1E,$1D,$1E,$1C,$1B,$1C

CODE_0EE871:
	TYX
	STX.b $00
	DEC.b $16,x
	BNE.b CODE_0EE884
	LDA.w #$0006
	STA.w $7A98,x
	LDY.b #$02
	STY.b $19,x
	DEC.b $76,x
CODE_0EE884:
	LDA.b $16,x
	LDY.b $18,x
	BEQ.b CODE_0EE88E
	CLC
	ADC.w #$0008
CODE_0EE88E:
	TAY
	LDA.w DATA_0EE861,y
	AND.w #$00FF
	ORA.w #$5800
	STA.b $78,x
	LDY.b $76,x
	CPY.b $00
	BNE.b CODE_0EE851
	JSR.w CODE_0EEC41
	JMP.w CODE_0EEE8A

CODE_0EE8A6:
	TYX
	LDA.b $78,x
	SEC
	SBC.w #$0801
	STA.b $78,x
	XBA
	TAY
	CPY.b #$00
	BEQ.b CODE_0EE8B7
	BPL.b CODE_0EE8BC
CODE_0EE8B7:
	STZ.w $7402,x
	STZ.b $78,x
CODE_0EE8BC:
	LDA.w $0D9A
	BNE.b CODE_0EE8C4
	JMP.w CODE_0EED91

CODE_0EE8C4:
	LDY.w $7223
	BMI.b CODE_0EE91E
	LDA.w $7CD8
	SEC
	SBC.w $7CD8,x
	CMP.w #$0008
	BCS.b CODE_0EE91E
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7AF6,x
	LDA.w #$0040
	TRB.w $6FA0
	JSL.l CODE_06BE72
	LDA.w #$0020
	STA.w $7AF8
	STZ.w $0D9A
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDA.w $7A38,x
	BNE.b CODE_0EE914
	LDA.w #$0002
	STA.b $16,x
	STA.w $7400,x
	STZ.w $7A98,x
	LDY.b #$07
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_0EE91C
	JMP.w CODE_0EE94B

CODE_0EE914:
	LDA.w #$0006
	STA.w $7A96,x
	LDY.b #$0B
CODE_0EE91C:
	STY.b $76,x
CODE_0EE91E:
	RTS

CODE_0EE91F:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0EE975
	LDA.b $78,x
	SEC
	SBC.w #$0801
	STA.b $78,x
	XBA
	TAY
	CPY.b #$01
	BPL.b CODE_0EE985
	LDA.w $6FA2,x
	AND.w #$FB7F
	STA.w $6FA2,x
	STZ.w $7402,x
	STZ.b $78,x
	LDY.b #$00
	STY.b $19,x
	LDA.w #$0020
	STA.w $7AF6,x
CODE_0EE94B:
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0020
	STA.w $7A96,x
	STZ.b $76,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w $7A38,x
	BEQ.b CODE_0EE974
	LDA.w #$0006
	STA.w $7A96,x
	LDY.b #$0B
	STY.b $76,x
CODE_0EE974:
	RTS

CODE_0EE975:
	LDA.w $7A98,x
	BNE.b CODE_0EE985
	LDA.w $7402,x
	BIT.w #$0001
	BEQ.b CODE_0EE985
	INC.w $7402,x
CODE_0EE985:
	RTS

CODE_0EE986:
	TYX
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDY.w $7862,x
	BNE.b CODE_0EE9A6
	LDA.w #$0060
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w $75E2,x
	LDA.w #$0004
	STA.w $7542,x
	INC.b $76,x
CODE_0EE9A6:
	RTS

CODE_0EE9A7:
	TYX
	LDY.w $7862,x
	BEQ.b CODE_0EE9B5
	LDA.w #$FFA0
	STA.w $75E2,x
	BRA.b CODE_0EE9CC

CODE_0EE9B5:
	LDY.w $75E3,x
	BPL.b CODE_0EE9CC
	LDA.w #$0006
	STA.w $7A96,x
	LDA.w #$FFFF
	STA.w $7AF6,x
	STA.w $7AF8,x
	INC.b $76,x
	RTS

CODE_0EE9CC:
	SEP.b #$20
	LDA.b #$FF
	STA.w $7862,x
	REP.b #$20
	JSR.w CODE_0EEE6C
	JMP.w CODE_0EE5B8

CODE_0EE9DB:
	TYX
	LDA.w #$0600
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w $7A96,x
	BNE.b CODE_0EE9FE
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.b $10
	AND.w #$0007
	CLC
	ADC.w #$0020
	STA.w $7A96,x
	INC.b $76,x
CODE_0EE9FE:
	RTS

DATA_0EE9FF:
	dw $0020,$FFE0,$0040,$FFC0

DATA_0EEA07:
	dw $FFF0,$0010

CODE_0EEA0B:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0EE9FE
	STZ.w $7AF6,x
	STZ.w $7AF8,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0EEA1F
	STZ.w $7AF8
CODE_0EEA1F:
	LDA.w #$0003
	STA.b $00
	LDA.w $70E2,x
	STA.b $02
	LDA.b $10
	AND.w #$0002
	TAY
	LDA.w DATA_0EEA07,y
	STA.b $0E
	TYA
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_0EEA3E
	CLC
	ADC.w #$0004
CODE_0EEA3E:
	TAY
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_0EE9FF,y
CODE_0EEA46:
	STA.w $70E2,x
	SEC
	SBC.w $7A38,x
	CLC
	ADC.w #$0050
	CMP.w #$00A0
	BCS.b CODE_0EEA72
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_0EEA85
CODE_0EEA72:
	DEC.b $00
	BNE.b CODE_0EEA7D
	LDA.b $02
	STA.w $70E2,x
	BRA.b CODE_0EEA85

CODE_0EEA7D:
	LDA.w $70E2,x
	CLC
	ADC.b $0E
	BRA.b CODE_0EEA46

CODE_0EEA85:
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w $7CD6,x
	JSR.w CODE_0EEE6C
	LDY.b #$09
	STY.b $76,x
	RTS

CODE_0EEA97:
	TYX
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CMP.w #$0090
	BPL.b CODE_0EEAC6
	LDA.w #$0048
	JSL.l CODE_spawn_sprite_init
	LDA.w #$0000
	STA.w $70E2,y
	JSR.w CODE_0EE59B
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $7863,x
	REP.b #$20
	INC.b $76,x
	RTS

CODE_0EEAC6:
	LDA.w #$0004
	STA.w $7542,x
	LDA.w #$0040
	LDY.w $7862,x
	BEQ.b CODE_0EEAD7
	LDA.w #$FFA0
CODE_0EEAD7:
	PHA
	EOR.w $75E2,x
	BPL.b CODE_0EEAE6
	SEP.b #$20
	LDA.b #$FF
	STA.w $7862,x
	REP.b #$20
CODE_0EEAE6:
	PLA
	STA.w $75E2,x
	RTS

CODE_0EEAEB:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0EEB52
	LDA.w $1015
	BNE.b CODE_0EEB2F
	LDA.w $105C
	DEC
	CMP.w #$0060
	BPL.b CODE_0EEB02
	LDA.w #$0060
CODE_0EEB02:
	STA.w $105C
	JSR.w CODE_0EEB53
	LDA.w $105C
	CMP.w #$0060
	BNE.b CODE_0EEB52
	LDY.b #$00
	STY.b $18,x
	LDA.w #$0001
	STA.w $7402,x
	LDA.w #$0003
	STA.b $16,x
	INC
	STA.w $7A98,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0060
	STA.w $7A98,x
	INC.b $76,x
	RTS

CODE_0EEB2F:
	BPL.b CODE_0EEB35
	STZ.w $1015
	RTS

CODE_0EEB35:
	CMP.w #$0002
	BNE.b CODE_0EEB52
	LDA.w #$0100
	CMP.w $105C
	BEQ.b CODE_0EEB52
	STA.w $105C
	LDA.w #$0030
	STA.w $7A96,x
	JSR.w CODE_0EEB53
	JSL.l CODE_03BFF7
CODE_0EEB52:
	RTS

CODE_0EEB53:
	LDA.w #!Define_YI_PlayerState1A_DisableInput
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$0166
	STA.w $60BE
	LDA.w $105C
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LSR
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$001F
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #FXDATA_540000+$0040
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$0040)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088293>>16
	LDA.w #FXCODE_088293
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	RTS

CODE_0EEB90:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0EEBA7
	LDA.w #$0002
	STA.w $7402,x
	INC
	STA.b $16,x
	LDA.w #$0010
	STA.w $7A98,x
	INC.b $76,x
CODE_0EEBA7:
	RTS

DATA_0EEBA8:
	db $02,$03

DATA_0EEBAA:
	db $10,$20

CODE_0EEBAC:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0EEBF9
	DEC.b $16,x
	BNE.b CODE_0EEBC5
	LDA.w #$0040
	STA.w $7A98,x
	LDA.w #$0002
	STA.w $7402,x
	INC.b $76,x
	RTS

CODE_0EEBC5:
	SEP.b #$20
	LDY.b $16,x
	LDA.w DATA_0EEBAA-$01,y
	STA.w $7A98,x
	LDA.w DATA_0EEBA8-$01,y
	STA.w $7402,x
	REP.b #$20
	DEY
	BEQ.b CODE_0EEBF9
	LDA.w #!Define_YI_SoundID65_JumpOnFrog
	JSL.l CODE_push_sound_queue
	LDA.w #$FE00
	STA.b $00
	LDA.w #$FF80
	STA.b $02
	LDA.w $70E2,x
	STA.b $0A
	LDA.w $7182,x
	STA.b $0C
	JSL.l CODE_0EEBFA
CODE_0EEBF9:
	RTS

CODE_0EEBFA:
	LDA.w #!Define_YI_AmbSpr1D9
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $0A
	STA.w $70A2,y
	LDA.b $0C
	STA.w $7142,y
	LDA.w #$000C
	STA.w $7782,y
	LDA.w #$0002
	STA.w $7E4C,y
	ASL
	STA.w $7500,y
	STA.w $7502,y
	STA.w $7462,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $02
	STA.w $75A2,y
	RTL

CODE_0EEC2C:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0EEC36
	JSL.l CODE_02A4B5
CODE_0EEC36:
	RTS

DATA_0EEC37:
	dw $FF00,$00FF

DATA_0EEC3B:
	dw $FF00,$0100,$0001

CODE_0EEC41:
	LDY.b $79,x
	CPY.b #$01
	BMI.b CODE_0EECBB
	TYA
	LSR
	LDY.b $18,x
	BNE.b CODE_0EEC68
	STA.w $6004
	LDA.w #$0004
	STA.w $6006
	LDA.w $7400,x
	DEC
	STA.b $00
	LDA.w $7CD6
	SEC
	SBC.w $7CD6,x
	EOR.b $00
	BPL.b CODE_0EEC79
	RTS

CODE_0EEC68:
	STA.w $6006
	LDA.w #$0004
	STA.w $6004
	LDA.w $7CD8
	CMP.w $7CD8,x
	BPL.b CODE_0EECBB
CODE_0EEC79:
	LDA.w $70E2,x
	CLC
	ADC.w $603C
	STA.w $6000
	LDA.w $7182,x
	CLC
	ADC.w $603E
	STA.w $6002
	LDA.w $6004
	CLC
	ADC.w $7BB6
	ASL
	STA.b $04
	LSR
	CLC
	ADC.w $6000
	SEC
	SBC.w $7CD6
	CMP.b $04
	BCS.b CODE_0EECBB
	LDA.w $6006
	CLC
	ADC.w $7BB8
	ASL
	STA.b $04
	LSR
	CLC
	ADC.w $6002
	SEC
	SBC.w $7CD8
	CMP.b $04
	BCC.b CODE_0EECBC
CODE_0EECBB:
	RTS

CODE_0EECBC:
	LDA.w $61B2
	AND.w #$6000
	BNE.b CODE_0EECBB
	LDA.w $7AF8,x
	ORA.w $0D9C
	ORA.w $61CC
	BNE.b CODE_0EECBB
	LDY.b $76
	CPY.b #$04
	BEQ.b CODE_0EECBB
	JSL.l CODE_06C114
	JSR.w CODE_0EED35
	LDA.w $70E2
	SEC
	SBC.w $70E2,x
	SEC
	SBC.w $6038
	AND.w #$00FF
	XBA
	STA.b $06
	LDA.w $7182
	SEC
	SBC.w $7182,x
	SEC
	SBC.w $603A
	AND.w #$00FF
	ORA.b $06
	STA.b $06
	LDY.b $18,x
	LDA.w DATA_0EEC37,y
	AND.b $06
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0EED1A
	LDA.b $18,x
	ASL
	TAY
	BNE.b CODE_0EED14
	LDY.w $7400,x
CODE_0EED14:
	LDA.w DATA_0EEC3B,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_0EED1A:
	LDY.b #$02
	STY.b $19,x
	LDY.b #$06
	STY.b $76,x
	LDY.b $79,x
	CPY.b #$58
	BNE.b CODE_0EED34
	LDA.w #$580B
	LDY.b $18,x
	BEQ.b CODE_0EED32
	LDA.w #$5816
CODE_0EED32:
	STA.b $78,x
CODE_0EED34:
	RTS

CODE_0EED35:
	LDA.w $61B2
	BPL.b CODE_0EED51
	LDA.w #$0100
	STA.w $614A
	LSR
	STA.w $61D6
	STZ.w $60A8
	STZ.w $60B4
	JSL.l CODE_04F74A
	LDA.w $61B2
CODE_0EED51:
	AND.w #$7FFF
	STA.w $61B2
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	LDY.b #$00
	STY.w $7862
	LDY.b #$04
	STY.b $76
	LDA.w #$6040
	STA.w $6FA2
	STZ.b $16
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	LDA.w #$FFFF
	STA.w $7E48
	STA.w $7AF8
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w $7542,x
	INC.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	INC.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
CODE_0EED8C:
	RTS

DATA_0EED8D:
	dw $0100,$FF00

CODE_0EED91:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0EED8C
	SEP.b #$20
	LDY.b $18,x
	BEQ.b CODE_0EEDAD
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.b #$08
	ORA.b #$01
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.b #$F0
	BPL.b CODE_0EEDC6
	BRA.b CODE_0EEDCB

CODE_0EEDAD:
	LDA.b #$08
	LDY.w $7400,x
	BEQ.b CODE_0EEDB6
	LDA.b #$F8
CODE_0EEDB6:
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	ORA.b #$01
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	CLC
	ADC.b #$10
	CMP.b #$20
	BCS.b CODE_0EEDCB
CODE_0EEDC6:
	REP.b #$20
	JMP.w CODE_0EEE29

CODE_0EEDCB:
	REP.b #$20
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	TYA
	CPY.b #$00
	BPL.b CODE_0EEDD8
	ORA.w #$FF00
CODE_0EEDD8:
	CLC
	ADC.w $70E2,x
	STA.w $70E2
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TYA
	CPY.b #$00
	BPL.b CODE_0EEDEA
	ORA.w #$FF00
CODE_0EEDEA:
	CLC
	ADC.w $7182,x
	STA.w $7182
	RTS

CODE_0EEDF2:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BEQ.b CODE_0EEE28
	SEP.b #$20
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.b $79,x
	BEQ.b CODE_0EEE08
	PHA
	LDA.b $79,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	PLA
CODE_0EEE08:
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BMI.b CODE_0EEE14
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
CODE_0EEE14:
	REP.b #$20
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	TYA
	CPY.b #$00
	BPL.b CODE_0EEE21
	ORA.w #$FF00
CODE_0EEE21:
	CLC
	ADC.w $70E2,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_0EEE28:
	RTS

CODE_0EEE29:
	LDY.b #$00
	LDA.w $7CD6
	SEC
	SBC.w $70E2,x
	SEC
	SBC.w $6038
	ASL
	ASL
	ASL
	EOR.w #$FFFF
	INC
	STA.b $00
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCC.b CODE_0EEE51
	BPL.b CODE_0EEE4C
	INY
	INY
CODE_0EEE4C:
	LDA.w DATA_0EED8D,y
	STA.b $00
CODE_0EEE51:
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	LDA.w #$0040
	STA.w $7542
	STA.w $0D9A
	LDA.w #$0400
	STA.w $75E2
	RTS

CODE_0EEE6C:
	LDA.w $611C
	LDY.w $61B3
	BMI.b CODE_0EEE7C
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_0EEE7C
	LDA.w $7CD6
CODE_0EEE7C:
	LDY.b #$00
	CMP.w $7CD6,x
	BMI.b CODE_0EEE85
	INY
	INY
CODE_0EEE85:
	TYA
	STA.w $7400,x
	RTS

CODE_0EEE8A:
	LDA.w $7A38,x
	BEQ.b CODE_0EEEB6
	LDA.w #$0004
	STA.w $7542,x
	LDA.w #$0040
	LDY.w $7862,x
	BEQ.b CODE_0EEEA0
	LDA.w #$FFA0
CODE_0EEEA0:
	PHA
	EOR.w $75E2,x
	BPL.b CODE_0EEEAF
	SEP.b #$20
	LDA.b #$FF
	STA.w $7862,x
	REP.b #$20
CODE_0EEEAF:
	PLA
	STA.w $75E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0EEEB6:
	RTS

DATA_0EEEB7:
	db $0A,$0A,$0A,$0B,$0B,$0A,$0A,$0A,$0F,$0F,$0A,$0A,$0B,$0F,$0F,$0F
	db $0F

DATA_0EEEC8:
	dw DATA_0EEEEA,DATA_0EEF1C,DATA_0EEF4E,DATA_0EEF80,DATA_0EEFB7,DATA_0EEFEE,DATA_0EF020,DATA_0EF052
	dw DATA_0EF084,DATA_0EF0CF,DATA_0EF11A,DATA_0EF14C,DATA_0EF17E,DATA_0EF1B5,DATA_0EF200,DATA_0EF24B
	dw DATA_0EF296

DATA_0EEEEA:
	db $FC,$0A,$06,$02,$00,$05,$0A,$06,$02,$00,$0E,$0A,$18,$02,$00,$0E
	db $02,$08,$02,$00,$04,$FB,$0C,$02,$00,$FD,$FB,$0C,$02,$00,$00,$00
	db $01,$02,$02,$F8,$00,$00,$02,$02,$FE,$0A,$18,$42,$00,$FE,$02,$08
	db $42,$00

DATA_0EEF1C:
	db $FC,$0A,$06,$02,$00,$05,$0A,$06,$02,$00,$0E,$0A,$18,$02,$00,$0E
	db $02,$08,$02,$00,$05,$FB,$0C,$02,$00,$FE,$FB,$0C,$02,$00,$01,$00
	db $01,$02,$02,$F9,$00,$00,$02,$02,$FE,$0A,$18,$42,$00,$FE,$02,$08
	db $42,$00

DATA_0EEF4E:
	db $FF,$FC,$0B,$42,$00,$06,$FC,$0B,$02,$00,$FC,$0A,$06,$02,$00,$05
	db $0A,$06,$02,$00,$0E,$0A,$18,$02,$00,$0E,$02,$08,$02,$00,$02,$01
	db $01,$02,$02,$FA,$01,$00,$02,$02,$FE,$0A,$18,$42,$00,$FE,$02,$08
	db $42,$00

DATA_0EEF80:
	db $FD,$FB,$0B,$42,$00,$04,$FB,$0B,$02,$00,$0E,$0A,$18,$02,$00,$0E
	db $02,$08,$02,$00,$05,$0A,$06,$02,$00,$08,$08,$12,$02,$00,$00,$08
	db $14,$02,$00,$08,$00,$05,$02,$00,$00,$00,$04,$02,$00,$F8,$00,$03
	db $02,$00,$FC,$0A,$06,$02,$00

DATA_0EEFB7:
	db $FB,$FB,$0B,$42,$00,$02,$FB,$0B,$02,$00,$0E,$0A,$18,$02,$00,$0E
	db $02,$08,$02,$00,$05,$0A,$06,$02,$00,$06,$08,$12,$02,$00,$FE,$08
	db $14,$02,$00,$06,$00,$05,$02,$00,$FE,$00,$04,$02,$00,$F6,$00,$03
	db $02,$00,$FC,$0A,$06,$02,$00

DATA_0EEFEE:
	db $04,$FB,$1A,$02,$00,$FD,$FB,$1A,$02,$00,$FC,$0A,$06,$02,$00,$05
	db $0A,$06,$02,$00,$0E,$0A,$18,$02,$00,$0E,$02,$08,$02,$00,$00,$00
	db $01,$02,$02,$F8,$00,$00,$02,$02,$FE,$0A,$18,$42,$00,$FE,$02,$08
	db $42,$00

DATA_0EF020:
	db $05,$FB,$1A,$02,$00,$FE,$FB,$1A,$02,$00,$FC,$0A,$06,$02,$00,$05
	db $0A,$06,$02,$00,$0E,$0A,$18,$02,$00,$0E,$02,$08,$02,$00,$01,$00
	db $01,$02,$02,$F9,$00,$00,$02,$02,$FE,$0A,$18,$42,$00,$FE,$02,$08
	db $42,$00

DATA_0EF052:
	db $06,$FC,$1A,$02,$00,$FF,$FC,$1A,$02,$00,$FC,$0A,$06,$02,$00,$05
	db $0A,$06,$02,$00,$0E,$0A,$18,$02,$00,$0E,$02,$08,$02,$00,$02,$01
	db $01,$02,$02,$FA,$01,$00,$02,$02,$FE,$0A,$18,$42,$00,$FE,$02,$08
	db $42,$00

DATA_0EF084:
	db $FC,$0A,$06,$02,$00,$FD,$00,$15,$02,$00,$05,$0A,$06,$02,$00,$0E
	db $0A,$18,$02,$00,$0E,$02,$08,$02,$00,$0D,$02,$1B,$02,$00,$0E,$FB
	db $1B,$02,$00,$09,$08,$13,$02,$00,$01,$08,$11,$02,$00,$F9,$08,$10
	db $02,$00,$09,$00,$17,$02,$00,$09,$F8,$07,$02,$00,$04,$02,$06,$02
	db $00,$FE,$0A,$18,$42,$00,$FE,$02,$08,$42,$00

DATA_0EF0CF:
	db $FC,$FE,$15,$02,$00,$FC,$0A,$06,$02,$00,$05,$0A,$06,$02,$00,$0E
	db $0A,$18,$02,$00,$0E,$02,$08,$02,$00,$0C,$00,$1B,$02,$00,$0D,$F9
	db $1B,$02,$00,$08,$06,$13,$02,$00,$00,$06,$11,$02,$00,$F8,$06,$10
	db $02,$00,$08,$FE,$17,$02,$00,$08,$F6,$07,$02,$00,$03,$00,$06,$02
	db $00,$FE,$0A,$18,$42,$00,$FE,$02,$08,$42,$00

DATA_0EF11A:
	db $0A,$0D,$19,$02,$00,$01,$0D,$19,$02,$00,$04,$FB,$0C,$02,$00,$FD
	db $FB,$0C,$02,$00,$00,$00,$01,$02,$02,$F8,$00,$00,$02,$02,$04,$0B
	db $09,$02,$00,$0E,$0B,$09,$02,$00,$13,$10,$19,$02,$00,$0A,$10,$19
	db $02,$00

DATA_0EF14C:
	db $FD,$FE,$0B,$42,$00,$04,$FE,$0B,$02,$00,$FC,$0B,$06,$02,$00,$05
	db $0B,$06,$02,$00,$0E,$09,$18,$02,$00,$0E,$01,$08,$02,$00,$00,$03
	db $01,$02,$02,$F8,$03,$00,$02,$02,$FE,$07,$18,$42,$00,$FE,$FF,$08
	db $42,$00

DATA_0EF17E:
	db $05,$0B,$06,$02,$00,$0E,$09,$18,$02,$00,$0E,$01,$08,$02,$00,$04
	db $FD,$1A,$02,$00,$FD,$FD,$1A,$02,$00,$08,$0B,$12,$02,$00,$00,$0B
	db $14,$02,$00,$08,$03,$05,$02,$00,$00,$03,$04,$02,$00,$F8,$03,$03
	db $02,$00,$FC,$0B,$06,$02,$00

DATA_0EF1B5:
	db $FA,$0A,$06,$02,$00,$03,$0A,$06,$02,$00,$0E,$01,$08,$02,$00,$0E
	db $09,$18,$02,$00,$0F,$FB,$1A,$02,$00,$0E,$02,$1A,$02,$00,$08,$08
	db $13,$02,$00,$00,$08,$11,$02,$00,$F8,$08,$10,$02,$00,$08,$00,$17
	db $02,$00,$08,$F8,$07,$02,$00,$FC,$00,$15,$02,$00,$03,$02,$06,$02
	db $00,$FE,$0A,$18,$42,$00,$FE,$02,$08,$42,$00

DATA_0EF200:
	db $FD,$02,$15,$02,$00,$03,$0A,$06,$02,$00,$0E,$08,$18,$02,$00,$0E
	db $00,$08,$02,$00,$11,$06,$1A,$02,$00,$12,$FD,$1A,$02,$00,$09,$0A
	db $13,$02,$00,$01,$0A,$11,$02,$00,$F9,$0A,$10,$02,$00,$09,$02,$17
	db $02,$00,$09,$FA,$07,$02,$00,$04,$04,$06,$02,$00,$FA,$0A,$06,$02
	db $00,$FE,$0A,$18,$42,$00,$FE,$02,$08,$42,$00

DATA_0EF24B:
	db $24,$1C,$0C,$02,$00,$1E,$0D,$19,$C2,$00,$20,$10,$12,$C2,$00,$28
	db $0F,$14,$C2,$00,$28,$18,$04,$C2,$00,$29,$13,$16,$82,$00,$1A,$0E
	db $09,$02,$00,$20,$18,$05,$C2,$00,$22,$0D,$09,$02,$00,$2A,$0C,$19
	db $82,$00,$31,$13,$0D,$02,$00,$30,$18,$03,$C2,$00,$1D,$08,$19,$C2
	db $00,$15,$09,$19,$C2,$00,$2B,$1C,$0C,$42,$00

DATA_0EF296:
	db $2E,$10,$0D,$02,$00,$1F,$0E,$19,$C2,$00,$24,$1B,$0C,$02,$00,$1A
	db $0D,$09,$02,$00,$28,$10,$14,$C2,$00,$29,$12,$16,$02,$00,$20,$0F
	db $12,$C2,$00,$20,$16,$05,$C2,$00,$28,$19,$04,$C2,$00,$24,$0C,$09
	db $02,$00,$29,$0C,$19,$82,$00,$30,$1A,$03,$42,$00,$1F,$07,$19,$C2
	db $00,$16,$09,$19,$C2,$00,$2B,$1D,$0C,$42

DATA_0EF2E0:
	db $00,$01,$02,$03,$04,$05,$06,$07,$08,$09,$0A,$0B,$01,$02,$03,$04
	db $05,$06,$07,$08,$09,$0A,$0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B

DATA_0EF2FF:
	dw DATA_0EF33B,DATA_0EF340,DATA_0EF34A,DATA_0EF359,DATA_0EF36D,DATA_0EF386,DATA_0EF3A4,DATA_0EF3C7
	dw DATA_0EF3EF,DATA_0EF41C,DATA_0EF44E,DATA_0EF485,DATA_0EF48A,DATA_0EF494,DATA_0EF4A3,DATA_0EF4B7
	dw DATA_0EF4D0,DATA_0EF4EE,DATA_0EF511,DATA_0EF539,DATA_0EF566,DATA_0EF598,DATA_0EF5CF,DATA_0EF606
	dw DATA_0EF63D,DATA_0EF674,DATA_0EF6AB,DATA_0EF6E2,DATA_0EF719,DATA_0EF750

DATA_0EF33B:
	db $FC,$04,$0D,$02,$00

DATA_0EF340:
	db $FC,$05,$16,$02,$00,$F5,$04,$0D,$02,$00

DATA_0EF34A:
	db $FC,$03,$16,$82,$00,$F4,$05,$16,$02,$00,$ED,$04,$0D,$02,$00

DATA_0EF359:
	db $FC,$05,$16,$02,$00,$F4,$03,$16,$82,$00,$EC,$05,$16,$02,$00,$E5
	db $04,$0D,$02,$00

DATA_0EF36D:
	db $FC,$05,$16,$82,$00,$F4,$07,$16,$02,$00,$EC,$05,$16,$82,$00,$E4
	db $07,$16,$02,$00,$DD,$06,$0D,$02,$00

DATA_0EF386:
	db $FC,$07,$16,$02,$00,$F4,$06,$16,$82,$00,$EC,$07,$16,$02,$00,$E4
	db $06,$16,$82,$00,$DC,$07,$16,$02,$00,$D5,$06,$0D,$02,$00

DATA_0EF3A4:
	db $FC,$06,$16,$82,$00,$F4,$07,$16,$02,$00,$EC,$06,$16,$82,$00,$E4
	db $07,$16,$02,$00,$DC,$06,$16,$82,$00,$D4,$07,$16,$02,$00,$CD,$06
	db $0D,$02,$00

DATA_0EF3C7:
	db $FC,$06,$1C,$02,$00,$F4,$05,$1C,$02,$00,$EC,$06,$1C,$02,$00,$E4
	db $05,$1C,$02,$00,$DC,$06,$1C,$02,$00,$D4,$05,$1C,$02,$00,$CC,$06
	db $1C,$02,$00,$C5,$06,$0D,$02,$00

DATA_0EF3EF:
	db $FC,$05,$1C,$02,$00,$F4,$06,$1C,$02,$00,$EC,$05,$1C,$02,$00,$E4
	db $06,$1C,$02,$00,$DC,$05,$1C,$02,$00,$D4,$06,$1C,$02,$00,$CC,$05
	db $1C,$02,$00,$C4,$06,$1C,$02,$00,$BD,$06,$0D,$02,$00

DATA_0EF41C:
	db $FC,$06,$1C,$02,$00,$F4,$06,$1C,$02,$00,$EC,$06,$1C,$02,$00,$E4
	db $06,$1C,$02,$00,$DC,$06,$1C,$02,$00,$D4,$06,$1C,$02,$00,$CC,$06
	db $1C,$02,$00,$C4,$06,$1C,$02,$00,$BC,$06,$1C,$02,$00,$B5,$06,$0D
	db $02,$00

DATA_0EF44E:
	db $B4,$06,$1C,$02,$00,$AD,$06,$0D,$02,$00,$FC,$06,$1C,$02,$00,$F4
	db $06,$1C,$02,$00,$EC,$06,$1C,$02,$00,$E4,$06,$1C,$02,$00,$DC,$06
	db $1C,$02,$00,$D4,$06,$1C,$02,$00,$CC,$06,$1C,$02,$00,$C4,$06,$1C
	db $02,$00,$BC,$06,$1C,$02,$00

DATA_0EF485:
	db $02,$FD,$0D,$02,$00

DATA_0EF48A:
	db $02,$FD,$0A,$02,$00,$03,$F6,$0D,$02,$00

DATA_0EF494:
	db $02,$FD,$0A,$42,$00,$00,$F5,$0A,$02,$00,$01,$EE,$0D,$02,$00

DATA_0EF4A3:
	db $00,$ED,$0A,$02,$00,$00,$FD,$0A,$02,$00,$02,$F5,$0A,$42,$00,$01
	db $E6,$0D,$02,$00

DATA_0EF4B7:
	db $00,$E5,$0A,$02,$00,$01,$DE,$0D,$02,$00,$02,$ED,$0A,$42,$00,$02
	db $FD,$0A,$42,$00,$00,$F5,$0A,$02,$00

DATA_0EF4D0:
	db $00,$DD,$0A,$02,$00,$01,$E5,$0A,$42,$00,$00,$ED,$0A,$02,$00,$00
	db $FD,$0A,$02,$00,$01,$F5,$0A,$42,$00,$01,$D6,$0D,$02,$00

DATA_0EF4EE:
	db $00,$D5,$0A,$02,$00,$01,$CE,$0D,$02,$00,$01,$DD,$0A,$42,$00,$00
	db $E5,$0A,$02,$00,$01,$ED,$0A,$42,$00,$01,$FD,$0A,$42,$00,$00,$F5
	db $0A,$02,$00

DATA_0EF511:
	db $02,$FD,$1D,$02,$00,$03,$F5,$1D,$02,$00,$02,$ED,$1D,$02,$00,$03
	db $E5,$1D,$02,$00,$02,$DD,$1D,$02,$00,$03,$D5,$1D,$02,$00,$02,$CD
	db $1D,$02,$00,$02,$C6,$0D,$02,$00

DATA_0EF539:
	db $00,$FD,$1D,$42,$00,$01,$F5,$1D,$42,$00,$00,$ED,$1D,$42,$00,$01
	db $E5,$1D,$42,$00,$00,$DD,$1D,$42,$00,$01,$D5,$1D,$42,$00,$00,$CD
	db $1D,$42,$00,$01,$C5,$1D,$42,$00,$01,$BE,$0D,$02,$00

DATA_0EF566:
	db $01,$FD,$1D,$42,$00,$01,$F5,$1D,$42,$00,$01,$ED,$1D,$42,$00,$01
	db $E5,$1D,$42,$00,$01,$DD,$1D,$42,$00,$01,$D5,$1D,$42,$00,$01,$CD
	db $1D,$42,$00,$01,$C5,$1D,$42,$00,$01,$BD,$1D,$42,$00,$01,$B6,$0D
	db $02,$00

DATA_0EF598:
	db $01,$FD,$1D,$42,$00,$01,$F5,$1D,$42,$00,$01,$ED,$1D,$42,$00,$01
	db $E5,$1D,$42,$00,$01,$DD,$1D,$42,$00,$01,$D5,$1D,$42,$00,$01,$CD
	db $1D,$42,$00,$01,$C5,$1D,$42,$00,$01,$BD,$1D,$42,$00,$01,$B5,$1D
	db $42,$00,$01,$AE,$0D,$02,$00

DATA_0EF5CF:
	db $B4,$06,$1C,$02,$00,$AD,$06,$0D,$02,$00,$FC,$06,$1C,$02,$00,$F4
	db $07,$1C,$02,$00,$EC,$07,$1C,$02,$00,$E4,$08,$1C,$02,$00,$DC,$08
	db $1C,$02,$00,$D4,$08,$1C,$02,$00,$CC,$08,$1C,$02,$00,$C4,$07,$1C
	db $02,$00,$BC,$07,$1C,$02,$00

DATA_0EF606:
	db $B4,$06,$1C,$02,$00,$AD,$06,$0D,$02,$00,$FC,$06,$1C,$02,$00,$F4
	db $05,$1C,$02,$00,$EC,$05,$1C,$02,$00,$E4,$04,$1C,$02,$00,$DC,$04
	db $1C,$02,$00,$D4,$04,$1C,$02,$00,$CC,$04,$1C,$02,$00,$C4,$05,$1C
	db $02,$00,$BC,$05,$1C,$02,$00

DATA_0EF63D:
	db $B4,$06,$1C,$02,$00,$AD,$06,$0D,$02,$00,$FC,$06,$1C,$02,$00,$F4
	db $06,$1C,$02,$00,$EC,$07,$1C,$02,$00,$E4,$07,$1C,$02,$00,$DC,$08
	db $1C,$02,$00,$D4,$08,$1C,$02,$00,$CC,$07,$1C,$02,$00,$C4,$07,$1C
	db $02,$00,$BC,$06,$1C,$02,$00

DATA_0EF674:
	db $B4,$06,$1C,$02,$00,$AD,$06,$0D,$02,$00,$FC,$06,$1C,$02,$00,$F4
	db $06,$1C,$02,$00,$EC,$05,$1C,$02,$00,$E4,$05,$1C,$02,$00,$DC,$04
	db $1C,$02,$00,$D4,$04,$1C,$02,$00,$CC,$05,$1C,$02,$00,$C4,$05,$1C
	db $02,$00,$BC,$06,$1C,$02,$00

DATA_0EF6AB:
	db $01,$FD,$1D,$42,$00,$02,$F5,$1D,$42,$00,$02,$ED,$1D,$42,$00,$03
	db $E5,$1D,$42,$00,$03,$DD,$1D,$42,$00,$03,$D5,$1D,$42,$00,$03,$CD
	db $1D,$42,$00,$02,$C5,$1D,$42,$00,$02,$BD,$1D,$42,$00,$01,$B5,$1D
	db $42,$00,$01,$AE,$0D,$02,$00

DATA_0EF6E2:
	db $01,$FD,$1D,$42,$00,$00,$F5,$1D,$42,$00,$00,$ED,$1D,$42,$00,$FF
	db $E5,$1D,$42,$00,$FF,$DD,$1D,$42,$00,$FF,$D5,$1D,$42,$00,$FF,$CD
	db $1D,$42,$00,$00,$C5,$1D,$42,$00,$00,$BD,$1D,$42,$00,$01,$B5,$1D
	db $42,$00,$01,$AE,$0D,$02,$00

DATA_0EF719:
	db $01,$FD,$1D,$42,$00,$01,$F5,$1D,$42,$00,$00,$ED,$1D,$42,$00,$00
	db $E5,$1D,$42,$00,$FF,$DD,$1D,$42,$00,$FF,$D5,$1D,$42,$00,$00,$CD
	db $1D,$42,$00,$00,$C5,$1D,$42,$00,$01,$BD,$1D,$42,$00,$01,$B5,$1D
	db $42,$00,$01,$AE,$0D,$02,$00

DATA_0EF750:
	db $01,$FD,$1D,$42,$00,$01,$F5,$1D,$42,$00,$02,$ED,$1D,$42,$00,$02
	db $E5,$1D,$42,$00,$03,$DD,$1D,$42,$00,$03,$D5,$1D,$42,$00,$02,$CD
	db $1D,$42,$00,$02,$C5,$1D,$42,$00,$01,$BD,$1D,$42,$00,$01,$B5,$1D
	db $42,$00,$01,$AE,$0D,$02,$00

DATA_0EF787:
	db $00,$00,$00,$02,$02,$00,$00,$00,$00,$00,$00,$00,$02,$00,$00,$00
	db $00

DATA_0EF798:
	dw $0000,$0000,$0000,DATA_0EF7BA,DATA_0EF7BA,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000,DATA_0EF7C4,$0000,$0000,$0000
	dw $0000

DATA_0EF7BA:
	dw $0AFE,$4218,$FE00,$0802,$0042

DATA_0EF7C4:
	dw $09FE,$4218,$FE00,$0801,$0042

;---------------------------------------------------------------------------
; Sprite $017 head-bop. No Raiden label for the Frog Pirate stomp.
;---------------------------------------------------------------------------
YI_NorSpr017_FrogPirate_StompRt:
head_bop_frog_pirate:
;$0EF7CE
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState02_InCutscene
	BEQ.b CODE_0EF7DF
	LDA.w #$000C
	STA.w $6124
	JSR.w CODE_0EEB53
CODE_0EF7DF:
	JSL.l YI_NorSpr017_FrogPirate_Main
	LDA.w $7A96,x
	BNE.b CODE_0EF7FC
	LDA.w $105C
	CMP.w #$0100
	BCC.b CODE_0EF7F5
	JSL.l CODE_028925
	RTL

CODE_0EF7F5:
	ADC.w #$0002
	STA.w $105C
	RTL

CODE_0EF7FC:
	CMP.w #$0040
	BNE.b CODE_0EF81A
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.b $00
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0008
	STA.b $02
	JSL.l CODE_02E19C
	LDA.w #!Define_YI_PlayerState1A_DisableInput
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	RTL

CODE_0EF81A:
	BCC.b CODE_0EF837
	LDY.b #$0F
	LDA.b $14
	BIT.w #$0004
	BEQ.b CODE_0EF833
	AND.w #$0003
	BNE.b CODE_0EF831
	LDA.w #!Define_YI_SoundID5E_FrogCroak
	JSL.l CODE_push_sound_queue
CODE_0EF831:
	LDY.b #$10
CODE_0EF833:
	TYA
	STA.w $7402,x
CODE_0EF837:
	RTL

;---------------------------------------------------------------------------

DATA_0EF838:
	dw $FF00,$0100

;---------------------------------------------------------------------------
; Sprite $0D9: Fishin' Lakitu (dangles bait). Raiden: init_fishin_lakitu.
;---------------------------------------------------------------------------
YI_NorSpr0D9_FishinLakitu_Init:
init_fishin_lakitu:
;$0EF83C
	LDY.w !RAM_YI_Level_CurrentLevelFromMapLo
	CPY.b #!Define_YI_LevelID_DontLookBack
	BNE.b CODE_0EF847
	LDY.b #$02
	STY.b $78,x
CODE_0EF847:
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.w $7400,x
	LDA.w DATA_0EF838,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7400,x
	STZ.w $100D
	STZ.w $100B
	STZ.w $100F
	RTL

;---------------------------------------------------------------------------

DATA_0EF863:
	dw CODE_0EFD11
	dw CODE_0EFD37
	dw CODE_0EFDC7
	dw CODE_0EFE57
	dw CODE_0EFE7B
	dw CODE_0EFE7F

;---------------------------------------------------------------------------
; Sprite $0D9 main. Raiden: main_fishin_lakitu.
;---------------------------------------------------------------------------
YI_NorSpr0D9_FishinLakitu_Main:
main_fishin_lakitu:
;$0EF86F
	JSR.w CODE_0EF9FE
	JSR.w CODE_0EF98E
	JSL.l CODE_03AF23
	JSR.w CODE_0EFBC0
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0EF863,x)
	JSR.w CODE_0EFC6F
	JSR.w CODE_0EFCD5
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0300
	CMP.w #$0600
	BCC.b CODE_0EF8A4
	LDA.w #$0300
	LDY.w $7221,x
	BPL.b CODE_0EF8A1
	LDA.w #$FD00
CODE_0EF8A1:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0EF8A4:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0300
	CMP.w #$0600
	BCC.b CODE_0EF8BE
	LDA.w #$0300
	LDY.w $7223,x
	BPL.b CODE_0EF8BB
	LDA.w #$FD00
CODE_0EF8BB:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0EF8BE:
	JSR.w CODE_0EFAF6
	JSR.w CODE_0EFB1F
	JSR.w CODE_0EFA93
	RTL

DATA_0EF8C8:
	db $FD,$FA,$04,$02,$02,$03,$F3,$0D,$02,$00,$FC,$04,$08,$04,$02,$04
	db $04,$08,$44,$02,$09,$FD,$1D,$00,$00,$FD,$FA,$04,$02,$02,$04,$F3
	db $0D,$02,$00,$FC,$04,$08,$04,$02,$04,$04,$08,$44,$02,$09,$FD,$1D
	db $00,$00,$01,$F5,$02,$02,$02,$08,$F0,$0D,$02,$00,$FC,$04,$08,$04
	db $02,$04,$04,$08,$44,$02,$0A,$FD,$1D,$00,$00,$FD,$FA,$04,$02,$02
	db $FC,$04,$08,$04,$02,$04,$04,$08,$44,$02,$04,$F3,$0D,$02,$00,$09
	db $FE,$1D,$00,$00,$FE,$F5,$02,$02,$02,$05,$F0,$0D,$02,$00,$FC,$04
	db $08,$04,$02,$04,$04,$08,$44,$02,$0A,$FD,$1D,$00,$00,$FE,$F7,$02
	db $02,$02,$05,$F2,$0D,$02,$00,$FC,$04,$08,$04,$02,$04,$04,$08,$44
	db $02,$0A,$FD,$1D,$00,$00,$FF,$FB,$02,$02,$02,$02,$F5,$0D,$42,$00
	db $02,$F5,$0D,$42,$00,$02,$F5,$0D,$42,$00,$01,$00,$06,$02,$02

DATA_0EF977:
	dw $FF00,$0100

CODE_0EF97B:
	LDA.w $7CD6,x
	STA.b $00
	LDA.w $7CD8,x
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1E6
	JSL.l CODE_spawn_ambient_stomp_puff_common
	BRA.b CODE_0EF9C6

CODE_0EF98E:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_0EF9F9
	LDA.w #$011C
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0EF9F9
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	TYA
	INC
	STA.w $6162
	LDA.w $7040,x
	AND.w #$FFF3
	STA.w $7040,x
	TXA
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	STY.b $18,x
CODE_0EF9C6:
	JSR.w CODE_0ECCC7
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0006
	STA.w $7402,x
	LDA.w #$FFFF
	STA.w $7AF8,x
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0EF9F0
	INY
	INY
CODE_0EF9F0:
	LDA.w DATA_0EF977,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
CODE_0EF9F9:
	RTS

DATA_0EF9FA:
	dw $0003,$0002

CODE_0EF9FE:
	STZ.b $0C
	STZ.b $0E
	LDA.w $7362,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	BMI.b CODE_0EF9F9
	LDY.w $74A2,x
	BMI.b CODE_0EF9F9
	LDY.w $7402,x
	CPY.b #$03
	BPL.b CODE_0EFA59
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w $100B
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w DATA_0EF9FA,y
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $1010
	TYA
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDX.b #FXCODE_0B95E6>>16
	LDA.w #FXCODE_0B95E6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEC
	SBC.w $7680,x
	STA.b $0C
	CLC
	ADC.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	STA.b $08
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEC
	SBC.w $7682,x
	STA.b $0E
	CLC
	ADC.w #$0008
	STA.b $0A
CODE_0EFA59:
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #DATA_0EF8C8>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_0EF8C8
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w $7680,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7682,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7400,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0005
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w $7402,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_08A16C>>16
	LDA.w #FXCODE_08A16C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	RTS

CODE_0EFA93:
	LDY.w $7D36,x
	BPL.b CODE_0EFAF5
	LDA.w $7C18,x
	SEC
	SBC.w $7BB8,x
	SEC
	SBC.w $6122
	CMP.w #$FFF8
	BCC.b CODE_0EFAEB
	LDY.w $60AB
	BMI.b CODE_0EFAF5
	LDY.w $60C0
	BEQ.b CODE_0EFAF5
	LDA.w $60FC
	AND.w #$0018
	BNE.b CODE_0EFAC6
	LDA.w #$FC00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
CODE_0EFAC6:
	LDA.w #$011C
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0EFAF5
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0004
	STA.w $7182,y
	TXA
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	STY.b $18,x
	JSR.w CODE_0EF9C6
	PLA
	RTL

CODE_0EFAEB:
	PLA
	STA.b $00
	JSL.l CODE_03A5B7
	LDA.b $00
	PHA
CODE_0EFAF5:
	RTS

CODE_0EFAF6:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0EFAF5
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0EFAF5
	LDA.w $7D38,y
	BEQ.b CODE_0EFAF5
	TYX
	JSL.l CODE_03B24B
	JSR.w CODE_0EF97B
	PLA
	RTL

DATA_0EFB13:
	dw $FFF4,$FFFA,$FFFD

DATA_0EFB19:
	dw $FFF0,$FFEA,$FFE8

CODE_0EFB1F:
	LDA.w $7AF8,x
	BNE.b CODE_0EFAF5
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_0EFB65
	LDA.w $7CD6
	SEC
	SBC.w $7CD6,x
	SEC
	SBC.b $0C
	CLC
	ADC.w #$0008
	CMP.w #$0010
	BCS.b CODE_0EFB64
	LDA.w $7CD8
	SEC
	SBC.w $7CD8,x
	SEC
	SBC.b $0E
	CLC
	ADC.w #$0008
	CMP.w #$0010
	BCS.b CODE_0EFB64
	JSR.w CODE_0ED3C4
	BCS.b CODE_0EFB64
	LDA.w #$FEC0
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0002
	STA.w $7402,x
	LDY.b #$02
	STY.b $76,x
CODE_0EFB64:
	RTS

CODE_0EFB65:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	CMP.w #$0010
	BEQ.b CODE_0EFB79
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	BEQ.b CODE_0EFB76
	CPX.b $18
	BEQ.b CODE_0EFB79
CODE_0EFB76:
	JMP.w CODE_0ECCC7

CODE_0EFB79:
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	LDA.b $0C
	ORA.b $0E
	BNE.b CODE_0EFBA7
	LDA.w $7402,x
	SEC
	SBC.w #$0003
	ASL
	TAY
	LDA.w DATA_0EFB19,y
	CLC
	ADC.w $7182,x
	STA.w $7182
	LDA.w DATA_0EFB13,y
	LDY.w $7400,x
	BEQ.b CODE_0EFBA1
	EOR.w #$FFFF
	INC
CODE_0EFBA1:
	CLC
	ADC.w $70E2,x
	BRA.b CODE_0EFBB6

CODE_0EFBA7:
	LDA.w $7182,x
	CLC
	ADC.b $0A
	STA.w $7182
	LDA.w $70E2,x
	CLC
	ADC.b $08
CODE_0EFBB6:
	STA.w $70E2
	LDY.w $7400,x
	STY.w $7400
	RTS

CODE_0EFBC0:
	LDA.w $70E2,x
	SEC
	SBC.w $7E18
	BMI.b CODE_0EFBD6
	LDA.w $70E2,x
	SEC
	SBC.w #$0100
	SEC
	SBC.w $7E1A
	BMI.b CODE_0EFBDD
CODE_0EFBD6:
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0EFC0C
	BRA.b CODE_0EFBEE

CODE_0EFBDD:
	LDA.w $7860,x
	BIT.w #$000C
	BEQ.b CODE_0EFC0C
	AND.w #$0008
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0EFC0C
CODE_0EFBEE:
	LDA.w $75E0,x
	EOR.w #$FFFF
	INC
	STA.w $75E0,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
CODE_0EFC0C:
	LDA.w $7182,x
	SEC
	SBC.w $7E1C
	BMI.b CODE_0EFC22
	LDA.w $7182,x
	SEC
	SBC.w #$0100
	SEC
	SBC.w $7E1E
	BMI.b CODE_0EFC27
CODE_0EFC22:
	EOR.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0EFC56
CODE_0EFC27:
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	CLC
	ADC.w #$0014
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$0002
	BNE.b CODE_0EFC56
	LDA.w $7860,x
	AND.w #$0002
	BEQ.b CODE_0EFC6A
CODE_0EFC56:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
CODE_0EFC6A:
	RTS

DATA_0EFC6B:
	dw $0010,$0014

CODE_0EFC6F:
	LDA.w $100F
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BPL.b CODE_0EFC7B
	LDA.w #$0000
CODE_0EFC7B:
	CMP.w #$4001
	BPL.b CODE_0EFC83
	STA.w $100F
CODE_0EFC83:
	LDA.w $100F
	CLC
	ADC.w #$0700
	AND.w #$F800
	CLC
	ADC.w #$3802
	STA.w $7040,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w $100B
	BPL.b CODE_0EFCC6
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w $100D
	BEQ.b CODE_0EFCD4
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w DATA_0EFC6B,y
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w $100D
	STA.w $100D
CODE_0EFCC6:
	LDA.w $100D
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w $100B
	STA.w $100B
CODE_0EFCD4:
	RTS

CODE_0EFCD5:
	LDA.w $0CEE
	BNE.b CODE_0EFD10
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
	STA.w $0CEE
CODE_0EFD10:
	RTS

CODE_0EFD11:
	TYX
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_0EFD2A
	LDA.w #$0200
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $76,x
CODE_0EFD2A:
	RTS

DATA_0EFD2B:
	dw $0040,$0080,$0020,$0040,$FFE0,$FFD0

CODE_0EFD37:
	TYX
	LDY.w $77C2,x
	TYA
	STA.w $7400,x
	LDA.w $7CD6
	SEC
	SBC.w $7CD6,x
	SEC
	SBC.b $0C
	PHP
	BPL.b CODE_0EFD50
	EOR.w #$FFFF
	INC
CODE_0EFD50:
	LSR
	CMP.w #$0018
	BMI.b CODE_0EFD59
	LDA.w #$0018
CODE_0EFD59:
	CLC
	ADC.w #$0018
	STA.w $7540,x
	ASL
	ASL
	ASL
	PLP
	BPL.b CODE_0EFD6A
	EOR.w #$FFFF
	INC
CODE_0EFD6A:
	STA.w $75E0,x
	LDA.w $7CD8
	SEC
	SBC.w $7CD8,x
	SEC
	SBC.b $0E
	SEC
	SBC.w #$0010
	PHP
	BPL.b CODE_0EFD82
	EOR.w #$FFFF
	INC
CODE_0EFD82:
	LSR
	CMP.w #$0018
	BMI.b CODE_0EFD8B
	LDA.w #$0018
CODE_0EFD8B:
	CLC
	ADC.w #$0018
	PLP
	BPL.b CODE_0EFD96
	EOR.w #$FFFF
	INC
CODE_0EFD96:
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A98,x
	BNE.b CODE_0EFDB1
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
CODE_0EFDB1:
	LDA.w $7AF6,x
	BNE.b CODE_0EFDC6
	LDA.w #$0050
	STA.w $7AF6,x
	LDA.w $75E2,x
	EOR.w #$FFFF
	INC
	STA.w $75E2,x
CODE_0EFDC6:
	RTS

CODE_0EFDC7:
	TYX
	LDA.w $100F
	BNE.b CODE_0EFDDD
	INC.w $7402,x
	LDA.w #$0002
	STA.b $16,x
	LDA.w #$0008
	STA.w $7A98,x
	INC.b $76,x
CODE_0EFDDD:
	JSR.w CODE_0EFDE8
	INX
	INX
	JSR.w CODE_0EFDE8
	LDX.b $12
	RTS

CODE_0EFDE8:
	LDA.w $7C16,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w #$0030
	CMP.w #$0060
	BCS.b CODE_0EFE27
	PHX
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	PHP
	BPL.b CODE_0EFE02
	EOR.w #$FFFF
	INC
CODE_0EFE02:
	REP.b #$10
	ASL
	TAX
	LDA.l $702200,x
	PLP
	BPL.b CODE_0EFE11
	EOR.w #$FFFF
	INC
CODE_0EFE11:
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEP.b #$10
	LDA.w #$0050
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_0EFE40

CODE_0EFE27:
	CLC
	ADC.w #$0020
	CMP.w #$00A0
	BCC.b CODE_0EFE54
	LDA.w #$FD00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	PHX
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_0EFE40:
	PLX
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $75E0,x
	BPL.b CODE_0EFE4D
	EOR.w #$FFFF
	INC
CODE_0EFE4D:
	LSR
	LSR
	LSR
	LSR
	STA.w $7540,x
CODE_0EFE54:
	RTS

DATA_0EFE55:
	db $10,$20

CODE_0EFE57:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0EFE78
	DEC.b $16,x
	BPL.b CODE_0EFE6A
	LDY.b $78,x
	BEQ.b CODE_0EFE67
	INC.b $76,x
CODE_0EFE67:
	INC.b $76,x
CODE_0EFE69:
	RTS

CODE_0EFE6A:
	LDY.b $16,x
	LDA.w DATA_0EFE55,y
	AND.w #$00FF
	STA.w $7A98,x
	INC.w $7402,x
CODE_0EFE78:
	JMP.w CODE_0EFDDD

CODE_0EFE7B:
	TYX
	JMP.w CODE_0EFDDD

CODE_0EFE7F:
	TYX
	LDA.w $7AF8,x
	BNE.b CODE_0EFE69
	LDA.w $6094
	CLC
	ADC.w #$00A0
	STA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.b $00
	LDA.w $609C
	SEC
	SBC.w #$0020
	STA.w $7182,x
	CLC
	ADC.w #$0008
	STA.b $02
	JSL.l CODE_0EFF63
	BMI.b CODE_0EFF1F
	LDA.b $00
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b $02
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BNE.b CODE_0EFF1F
	LDA.b $00
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b $02
	SEC
	SBC.w #$0010
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BNE.b CODE_0EFF1F
	LDA.w #$0005
	STA.w $74A2,x
	LDA.w #$3802
	STA.w $7040,x
	LDA.w #$0100
	STA.w $75E2,x
	LDA.w #$0008
	STA.w $7542,x
	LDA.w DATA_0EF838
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7400,x
	STZ.w $7402,x
	STZ.w $100D
	STZ.w $100B
	STZ.w $100F
	STZ.b $76,x
CODE_0EFF1F:
	RTS

;---------------------------------------------------------------------------
; Sprite $0D9 head-bop. No Raiden label for Fishin' Lakitu stomp.
;---------------------------------------------------------------------------
YI_NorSpr0D9_FishinLakitu_StompRt:
head_bop_fishin_lakitu:
;$0EFF20
	JSR.w CODE_0EF9FE
	JSL.l CODE_03A2C7
	BCC.b CODE_0EFF62
	LDY.b $18,x
	BEQ.b CODE_0EFF3D
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0EFF3D
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr11C_LakituCloud
	BEQ.b CODE_0EFF62
CODE_0EFF3D:
	LDA.w $7AF8,x
	CMP.w #$FF00
	BCS.b CODE_0EFF62
	AND.w #$FF00
	BEQ.b CODE_0EFF50
	LDA.w #$0040
	STA.w $7AF8,x
CODE_0EFF50:
	STZ.b $18,x
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$00FF
	STA.w $74A2,x
	LDY.b #$05
	STY.b $76,x
CODE_0EFF62:
	RTL

CODE_0EFF63:
	PHX
	REP.b #$10
	LDA.b $02
	AND.w #$FF00
	LSR
	LSR
	LSR
	LSR
	STA.b $04
	LDA.b $00
	AND.w #$FF00
	XBA
	ORA.b $04
	TAX
	LDA.w $6CAA,x
	SEP.b #$10
	PLX
	TAY
	RTL

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($0EFF82, incbin, DATA_0EFF82_YI_U2.bin)
else
	%FREE_BYTES($0EFF82, 126, $FF)
endif
%BANK_END(<EndBank>)
endmacro
