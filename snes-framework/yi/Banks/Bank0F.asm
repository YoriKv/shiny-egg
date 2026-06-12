;#############################################################################################################
;# Bank0F.asm -- normal-sprite Init/Main handlers + boss state machines + retry/cutscene gamemodes
;#               (SNES bank $0F, mirror $8F).
;#
;# Contents at a glance:
;#   $0F:8000-$0F:80FF  Sprite $00E -- GOAL letters intro (NorSpr00E)
;#   $0F:8134-$0F:835B  Sprite $00F -- Bonus Challenge sign (NorSpr00F)
;#   $0F:8380-$0F:8645  Sprite $181 -- Crazee Dayzee (Init/Main + stomp handler)
;#   $0F:8646-$0F:86EA  Sprite $041 -- Stork (Baby Mario delivery)
;#   $0F:86EB-$0F:898E  Sprite $01F -- Rotating Doors (state-machine boss-door)
;#   $0F:898F-$0F:89F8  Sprites $197/$198 -- Arrow Sign / Diagonal Arrow Sign
;#   $0F:89F9-$0F:8AB8  Sprite $182 -- Dragonfly
;#   $0F:8AB9-$0F:8B3F  Sprite $183 -- Butterfly
;#   $0F:8B40-$0F:8CC1  Sprites $164/$165 -- Nipper Plant / Nipper Spore (shared family)
;#   $0F:8CFC-$0F:8E48  Sprite $040 -- Baby Luigi (intro/outro cutscene actor)
;#   $0F:8E49-$0F:8F69  Sprite $067 -- Rock-Revealed Hidden Winged Cloud
;#   $0F:8F65-$0F:8FBA  Sprite $191 -- Bird
;#   $0F:90A4-$0F:90DE  Sprite $087 -- Mock-Up Laid Egg (red 1-up egg)
;#   $0F:90E5-$0F:9171  Sprite $163 -- Bouncing (Green) Needlenose
;#   $0F:9172-$0F:9408  Sprite $1AC -- Small Frog
;#   $0F:9409-$0F:96EE  Sprite $161 -- Bonus reward item (defeat-all-enemies room)
;#   $0F:96EF-$0F:9C0A  Sprites $0D3/$0D4 -- Large Milde / Medium Milde (shared StompRt at $0F:9772 / $0F:998E)
;#   $0F:9C0B-$0F:A8E8  Sprite $03C -- Tap-Tap the Red Nose boss (full state machine, state ptr at DATA_tap_tap_state_ptr)
;#   $0F:AC32-$0F:AD1E  Sprite $05A -- Raphael Spark Attack (boss projectile)
;#   $0F:AD1F-$0F:BB78  Sprite $00C -- Raphael the Raven boss (init/main state ptrs at DATA_raphael_init_ptr/DATA_raphael_main_ptr)
;#   $0F:BB7A-$0F:BC62  Gamemode $13 -- prepare retry screen ("Try again?" continue prompt)
;#   $0F:BC63-$0F:BC9D  Gamemode $15 -- retry-screen cutscene tick / branch to GM $3F/$3A/$32
;#   $0F:BDBE-$0F:BEB1  Gamemode $05 -- load cutscene (VRAM/HDMA/scene-register setup)
;#   $0F:BEBA-$0F:BF13  Gamemode $07 -- cutscene tick (waits down $1405, advances mode on timeout/button)
;#   $0F:BFD9+          shared spawn helper (used by retry-screen letter sprites)
;#   $0F:C000-$0F:CFFF  cutscene playback engine + tilemap-init queue data tables
;#   $0F:CF2D-$0F:E055  per-frame cutscene script tables (sprite spawn timeline)
;#   $0F:E822+          (V1.0 / V1.1 differ here -- level pointer table moved off-bank in V1.1)
;#
;# Cross-references:
;#   yoshisisland-disassembly/disassembly/bank0F.asm -- ~108 descriptive labels (Raidenthequick).
;#   docs/enginecore.md S3.2 -- DATA_game_mode_pointers table (69 entries, $00..$44).
;#   ../Constants/GameModes.asm, ../Constants/NormalSpriteIDs.asm
;#   docs/levelloader.md -- the level-loading pipeline (this bank holds the V1.1
;#     level-pointer table emitted at the bottom-of-bank %DATATABLE_* macro).
;#   docs/leveldataengine.md -- the downstream object-decode side of the same pipeline.
;#
;# See also (sibling reference files):
;#   ys_game.asm                 -- gamemode dispatch / per-mode handlers (parallels GM $05/$07/$13/$15)
;#   ys_main.asm                 -- top-level frame loop wiring the dispatcher
;#   ys_play.asm                 -- player/level integration shared by the boss state machines
;#   ys_init.asm                 -- one-shot scene setup helpers (retry-screen prepare uses the same shape)
;#   ys_boss1.asm, ys_boss2.asm  -- boss state-machine bodies (Tap-Tap, Raphael equivalents)
;#   ys_enmy.asm + ys_enmy2..14  -- per-sprite Init/Main handlers (Crazee Dayzee, Stork, Dragonfly, Milde family etc.)
;#   ys_chr.asm                  -- character / Baby Mario / Baby Luigi cutscene actor logic
;#   ys_w*.asm                   -- per-level data files (the pointer table at bank tail indexes into these)
;#
;# Notes:
;#   Game-mode handler labels here run on top of the global $00:GameModePtr dispatcher in Bank00;
;#   modes $05/$07 are paired (load then tick), as are $13/$15.
;#   The level-data pointer table lives at the end of this bank ($0F:E822) on V1.1 builds,
;#   and is hoisted from Bank17 by the version gate in the %DATATABLE_* emission below.
;#############################################################################################################

macro YIBank0FMacros(StartBank, EndBank)
%BANK_START(<StartBank>)

;---------------------------------------------------------------------------
; Sprite $00E init -- GOAL banner letters (one letter per spawn).
; Raiden: init_GOAL_text. Seeds palette mirror with the letter-color row from $5FCC10.
;---------------------------------------------------------------------------
YI_NorSpr00E_GOALLetters_Init:
init_GOAL_text:
;$0F8000
	LDY.b #$05
	STY.b $18,x
	LDX.b #$1C
CODE_0F8006:
	LDA.l DATA_5FCC10,x
	STA.l $702ECE,x
	STA.l YI_Global_PaletteMirror[$B1].LowByte,x
	DEX
	DEX
	BPL.b CODE_0F8006
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $00E main -- GOAL banner letter. Hands off animation to one of four
; phase routines via DATA_0F8061 (rising, settling, idle, sparkle).
; Raiden: main_GOAL_text.
;---------------------------------------------------------------------------
YI_NorSpr00E_GOALLetters_Main:
main_GOAL_text:
;$0F8019
	LDY.w $74A2,x
	BMI.b CODE_0F805B
	LDA.w #$00E0
	STA.w $7680,x
	CLC
	ADC.w !RAM_YI_Global_Layer1XPosLo
	STA.w $70E2,x
	LDA.w #$0020
	STA.w $7682,x
	CLC
	ADC.w !RAM_YI_Global_Layer1YPosLo
	STA.w $7182,x
	LDY.b $18,x
	TYA
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDY.b $19,x
	TYA
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.b $76,x
	TYA
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDY.b $77,x
	TYA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_09ACDA>>16
	LDA.w #FXCODE_09ACDA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_0F805B:
	LDY.b $16,x
	TYX
	JMP.w (DATA_0F8061,x)

; Phase pointer table for GOAL-letter animation, indexed by spr_wildcard_3_lo ($16,x).
;   $00 -> CODE_0F8069  rise toward final Y (adds $08 per tick until >=$A0)
;   $01 -> CODE_0F8082  settle back down (subtracts $04 until <$80, then arms timer)
;   $02 -> CODE_0F80A0  hold / idle while bonus-game routine runs
;   $03 -> CODE_0F80CD  done / sparkle finale
DATA_0F8061:
DATA_GOAL_ptr:                                       ; Raiden alias
	dw CODE_0F8069
	dw CODE_0F8082
	dw CODE_0F80A0
	dw CODE_0F80CD

CODE_0F8069:
	LDX.b $12
	SEP.b #$20
	LDA.b $19,x
	CLC
	ADC.b #$08
	STA.b $19,X
	TAY
	REP.b #$20
	CPY.b #$A0
	BCC.b CODE_0F8081
CODE_0F807B:
	LDY.b $16,x
	INY
	INY
	STY.b $16,x
CODE_0F8081:
	RTL

CODE_0F8082:
	LDX.b $12
	SEP.b #$20
	LDA.b $19,x
	SEC
	SBC.b #$04
	STA.b $19,x
	TAY
	REP.b #$20
	CPY.b #$80
	BCS.b CODE_0F8081
	LDY.b #$80
	STY.b $19,x
	LDA.w #$0040
	STA.w $7A96,x
	BRA.b CODE_0F807B

CODE_0F80A0:
	LDX.b $12
	LDA.w !RAM_YI_Level_DoBonusChallengeFlagLo
	BNE.b CODE_0F807B
	LDA.w $7A96,x
	BNE.b CODE_0F80C2
	LDY.b $77,x
	INY
	CPY.b #$40
	BCC.b CODE_0F80B5
	LDY.b #$40
CODE_0F80B5:
	STY.b $77,x
	SEP.b #$20
	LDA.b $76,x
	CLC
	ADC.b #$04
	STA.b $76,x
	REP.b #$20
CODE_0F80C2:
	RTL

DATA_0F80C3:
	dw $0008,$0014,$0014,$0014,$0014

CODE_0F80CD:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0F8134
	LDY.b $18,x
	DEY
	BPL.b CODE_0F80DD
	JML.l CODE_03A31E

CODE_0F80DD:
	STY.b $18,x
	TYX
	SEP.b #$20
	LDA.b #$00
	XBA
	LDA.l FXDATA_09AD61,x
	PHA
	TXA
	ASL
	TAX
	PLA
	REP.b #$20
	SEC
	SBC.w DATA_0F80C3,x
	STA.b $00
	LDX.b $12
	LDA.w !RAM_YI_Level_DoBonusChallengeFlagLo
	BMI.b CODE_0F8104
	LDA.w #!Define_YI_SoundID36_CollectFlower
	JSL.l CODE_push_sound_queue
CODE_0F8104:
	LDA.w #!Define_YI_AmbSpr1CD
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	SEC
	SBC.b $00
	SEC
	SBC.w #$0008
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7142,y
	LDA.w #$000B
	STA.w $7E4C,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w #$0008
	STA.w $7A96,x
CODE_0F8134:
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $00F init -- "BONUS" / "BONUS CHALLENGE" sign sprite seen on the
; world map and bonus-room entry. Raiden: init_BONUS.
;---------------------------------------------------------------------------
YI_NorSpr00F_BonusChallengeSign_Init:
init_BONUS:
;$0F8135
	LDA.w !RAM_YI_Global_Layer1XPosLo
	STA.b $78,x
	CLC
	ADC.w #$0080
	STA.w $70E2,x
	STA.w $7A36,x
	LDA.w !RAM_YI_Global_Layer1YPosLo
	SEC
	SBC.w #$0040
	STA.w $7182,x
	LDY.b #$02
	STY.b $18,x
	LDX.b #$1C
CODE_0F8154:
	LDA.l DATA_5FCBF2,x
	STA.l $702F2E,x
	STA.l YI_Global_PaletteMirror[$E1].LowByte,x
	DEX
	DEX
	BPL.b CODE_0F8154
	LDX.b $12
	LDA.w #!Define_YI_SoundID95_BonusChallenge
	JSL.l CODE_push_sound_queue
	RTL

;---------------------------------------------------------------------------

DATA_0F816E:
	dw $0000,$FE00,$FC00

;---------------------------------------------------------------------------
; Sprite $00F main -- BONUS sign animation/draw. Raiden: main_BONUS.
;---------------------------------------------------------------------------
YI_NorSpr00F_BonusChallengeSign_Main:
main_BONUS:
;$0F8174
	LDY.w $74A2,x
	BMI.b CODE_0F8196
	LDA.w #DATA_0F8276>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_0F8276
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$002E
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_09AE83>>16
	LDA.w #FXCODE_09AE83
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_0F8196:
	JSR.w CODE_0F822B
	LDY.b $16,x
	TYX
	JMP.w (DATA_0F819F,x)

DATA_0F819F:
	dw CODE_0F81AF
	dw CODE_0F81AF
	dw CODE_0F81CA
	dw CODE_0F81E4

DATA_0F81A7:
	dw $0021,$0022

DATA_0F81AB:
	dw $D000,$D400

CODE_0F81AF:
	REP.b #$10
	LDA.w DATA_0F81AB,x
	STA.w $0CF9
	LDA.w DATA_0F81A7,x
	JSL.l CODE_00B753
	SEP.b #$10
	LDX.b $12
	LDA.w #$0020
	STA.w $7A96,x
	BRA.b CODE_0F81DD

CODE_0F81CA:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0F81E3
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0800
	STA.w $75E2,x
CODE_0F81DD:
	LDY.b $16,x
	INY
	INY
	STY.b $16,x
CODE_0F81E3:
	RTL

CODE_0F81E4:
	LDX.b $12
	LDA.b $78,x
	SEC
	SBC.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w $7A36,x
	STA.w $70E2,x
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$0050
	CMP.w $7182,x
	BPL.b CODE_0F8210
	STA.w $7182,x
	LDY.b $18,x
	LDA.w DATA_0F816E,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	DEY
	DEY
	BMI.b CODE_0F8210
	STY.b $18,x
CODE_0F8210:
	RTL

DATA_0F8211:
	dw $44A6,$48C7,$4CE8,$5109

DATA_0F8219:
	dw $001F,$023F,$037F,$03F3,$0327,$7F20,$7E66,$7D77
	dw $7C1F

CODE_0F822B:
	LDA.b $14
	AND.w #$0007
	BNE.b CODE_0F8273
	LDY.b $76,x
	INY
	INY
	CPY.b #$12
	BNE.b CODE_0F823C
	LDY.b #$00
CODE_0F823C:
	STY.b $76,x
	LDX.b #$10
CODE_0F8240:
	LDA.w DATA_0F8219,y
	STA.l YI_Global_PaletteMirror[$E3].LowByte,x
	INY
	INY
	CPY.b #$12
	BNE.b CODE_0F824F
	LDY.b #$00
CODE_0F824F:
	DEX
	DEX
	BPL.b CODE_0F8240
	LDX.b $12
	LDY.b $77,x
	INY
	INY
	STY.b $77,x
	TYA
	AND.w #$0006
	TAY
	LDX.b #$06
CODE_0F8262:
	LDA.w DATA_0F8211,y
	STA.l YI_Global_PaletteMirror[$EC].LowByte,x
	DEY
	DEY
	BPL.b CODE_0F826F
	LDY.b #$06
CODE_0F826F:
	DEX
	DEX
	BPL.b CODE_0F8262
CODE_0F8273:
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

DATA_0F8276:
	dw $24E8,$3D0A,$2000,$0B14,$003D,$1428,$3D0C,$3000
	dw $600C,$027D,$1C18,$3D50,$0800,$0D14,$003D,$1418
	dw $3D0F,$1000,$0E14,$003D,$DCF8,$3D4E,$0800,$4EDC
	dw $007D,$D400,$3D10,$0000,$4FDC,$003D,$E410,$7D05
	dw $2800,$1CEC,$023D,$E428,$7D01,$1802,$1AEC,$023D
	dw $E418,$7D03,$1002,$19EC,$003D,$E400,$3D07,$0802
	dw $28F4,$023D,$0430,$3D4D,$B800,$5EF4,$003D,$F4C0
	dw $3D5F,$0000,$6714,$003D,$04C8,$3D40,$3800,$1EEC
	dw $023D,$14F0,$3D65,$2002,$4B04,$023D,$0410,$3D49
	dw $0002,$4704,$023D,$04F0,$3D45,$E002,$4304,$023D
	dw $04D0,$3D41,$F002,$05E4,$023D,$E4E0,$3D03,$D002
	dw $01E4,$023D,$14E8,$3D64,$D802,$6214,$023D,$14C8
	dw $3D60,$3802,$2EF4,$023D,$F428,$3D2C,$1802,$2AF4
	dw $023D,$F4F8,$3D26,$E802,$24F4,$023D,$F4D8,$3D22
	dw $C802,$20F4,$023D

DATA_0F835C:
	dw $0200,$0400,$0800,$0200,$0400,$0800,$0200,$0400

DATA_0F836C:
	dw $FFC0,$0040

;---------------------------------------------------------------------------
; Sprite $181 init -- Crazee Dayzee (the cheerful walking flower).
; Raiden: init_crazee_dayzee. See also: ys_enmy.asm + ys_enmy2..14 family.
;
; See docs/family-misc.md §3 for the full Crazee Dayzee write-up (3-state
; walk/pivot/launch-bubble cycle, $0212 happy-notes ambient emote every 32
; frames, head-bop dance reaction).
;---------------------------------------------------------------------------
YI_NorSpr181_CrazeeDayzee_Init:
init_crazee_dayzee:
;$0F8370
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0F839B
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	LSR
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEC
	BNE.b CODE_0F8395
	LDA.b $10
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_0F835C,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BRA.b CODE_0F839B

CODE_0F8395:
	LDA.w #$0800
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_0F839B:
	JMP.w CODE_0F84AE

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $181 main -- Crazee Dayzee per-frame. Raiden: main_crazee_dayzee.
;---------------------------------------------------------------------------
YI_NorSpr181_CrazeeDayzee_Main:
main_crazee_dayzee:
;$0F839E
	JSR.w CODE_0F858F
	LDA.w $6FA0,x
	LDY.w $7D38,x
	BNE.b CODE_0F83AE
	AND.w #$FDFF
	BRA.b CODE_0F83B1

CODE_0F83AE:
	ORA.w #$0200
CODE_0F83B1:
	STA.w $6FA0,x
	JSL.l CODE_03AF23
	JSL.l CODE_03A5B7
	JSR.w CODE_0F85CB
	LDA.b $16,x
	TAX
	JMP.w (DATA_0F83C5,x)

DATA_0F83C5:
	dw CODE_0F83E3
	dw CODE_0F8487
	dw CODE_0F84DB

DATA_0F83CB:
	db $01,$02,$03,$04,$05,$06,$05,$04,$03,$02,$01,$00

DATA_0F83D7:
	db $04,$04,$04,$04,$04,$08,$04,$04,$04,$04,$04,$08

CODE_0F83E3:
	LDX.b $12
	LDA.w $7A98,x
	BNE.b CODE_0F83F3
	LDA.w #$0020
	STA.w $7A98,x
	JSR.w CODE_0F85FC
CODE_0F83F3:
	LDA.w $7860,x
	BIT.w #$000C
	BNE.b CODE_0F8432
	BIT.w #$0001
	BEQ.b CODE_0F8432
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEC
	BEQ.b CODE_0F8412
	LDA.w $7AF6,x
	BNE.b CODE_0F8412
	LDA.b $10
	AND.w #$003F
	BEQ.b CODE_0F8450
CODE_0F8412:
	LDA.w $7A96,x
	BNE.b CODE_0F8431
	SEP.b #$20
	DEC.b $18,x
	BPL.b CODE_0F8421
	LDA.b #$0B
	STA.b $18,x
CODE_0F8421:
	LDY.b $18,x
	LDA.w DATA_0F83CB,y
	STA.w $7402,x
	LDA.w DATA_0F83D7,y
	STA.w $7A96,x
	REP.b #$20
CODE_0F8431:
	RTL

CODE_0F8432:
	LDA.w #$0007
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_0F846F,y
	STA.w $7402,x
	LDA.w DATA_0F8477,y
	STA.w $7A96,x
	REP.b #$20
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.b $16,x
	INC.b $16,x
	RTL

CODE_0F8450:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7A98,x
	SEP.b #$20
	LDY.b #$02
	STY.b $18,x
	LDA.w DATA_0F84D2,y
	STA.w $7402,x
	LDA.w DATA_0F84D5,y
	STA.w $7A96,x
	LDA.b #$04
	STA.b $16,x
	REP.b #$20
	RTL

DATA_0F846F:
	db $07,$07,$07,$07,$08,$07,$08,$07

DATA_0F8477:
	db $10,$10,$10,$10,$04,$04,$04,$04

DATA_0F847F:
	db $02,$02,$02,$00,$00,$00,$00,$00

CODE_0F8487:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0F84AD
	DEC.b $18,x
	BMI.b CODE_0F84AE
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_0F846F,y
	STA.w $7402,x
	LDA.w DATA_0F8477,y
	STA.w $7A96,x
	LDA.w $7400,x
	EOR.w DATA_0F847F,y
	STA.w $7400,x
	REP.b #$20
CODE_0F84AD:
	RTL

CODE_0F84AE:
	LDY.w $7400,x
	LDA.w DATA_0F836C,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7A98,x
	SEP.b #$20
	LDA.b #$0B
	STA.b $18,x
	TAY
	LDA.w DATA_0F83CB,y
	STA.w $7402,x
	LDA.w DATA_0F83D7,y
	STA.w $7A96,x
	REP.b #$20
	STZ.b $16,x
	RTL

DATA_0F84D2:
	db $09,$08,$07

DATA_0F84D5:
	db $20,$20,$08

DATA_0F84D8:
	db $00,$01,$00

CODE_0F84DB:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0F8504
	LDY.b $18,x
	DEY
	BMI.b CODE_0F8511
	STY.b $18,x
	SEP.b #$20
	LDA.w DATA_0F84D2,y
	STA.w $7402,x
	LDA.w DATA_0F84D5,y
	STA.w $7A96,x
	LDA.w DATA_0F84D8,y
	BEQ.b CODE_0F8502
	LDA.w $77C2,x
	STA.w $7400,x
CODE_0F8502:
	REP.b #$20
CODE_0F8504:
	LDY.b $18,x
	BNE.b CODE_0F8510
	LDA.w $7A98,x
	BNE.b CODE_0F8510
	JSR.w CODE_0F8521
CODE_0F8510:
	RTL

CODE_0F8511:
	LDA.w #$0020
	STA.w $7AF6,x
	BRA.b CODE_0F84AE

DATA_0F8519:
	dw $FD00,$0300

DATA_0F851D:
	dw $FFE8,$0008

CODE_0F8521:
	LDY.w $7400,x
	LDA.w DATA_0F8519,y
	STA.b $00
	LDA.w DATA_0F851D,y
	STA.b $02
	LDA.w #$0019
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0F8566
	LDA.w $7CD6,x
	CLC
	ADC.b $02
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$000A
	STA.w $7A98,y
	LDA.w #$0004
	STA.w $7402,y
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w $6FA0,y
	AND.w #$F9FF
	STA.w $6FA0,y
CODE_0F8566:
	RTS

DATA_0F8567:
	dw $0010,$0018,$0010,$0018,$0010,$0018,$0010,$0018
	dw $0010,$0018,$0018,$0020,$0018,$0020,$0008,$0010
	dw $0000,$0010,$0000,$0010

CODE_0F858F:
	LDA.w $7402,x
	ASL
	ASL
	TAY
	LDA.w DATA_0F8567,y
	STA.b $00
	LDA.w DATA_0F8567+$02,y
	STA.b $02
	LDY.w $74A2,x
	BMI.b CODE_0F85CA
	REP.b #$10
	LDA.w $7362,x
	BMI.b CODE_0F85C8
	CLC
	ADC.b $00
	TAY
	LDA.w $6004,y
	ORA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $6004,y
	LDA.w $7362,x
	CLC
	ADC.b $02
	TAY
	LDA.w $6004,y
	ORA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $6004,y
CODE_0F85C8:
	SEP.b #$10
CODE_0F85CA:
	RTS

CODE_0F85CB:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0F85F7
	BEQ.b CODE_0F85F7
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0F85F7
	LDA.w $7D38,y
	BEQ.b CODE_0F85F7
	LDA.w $7542,y
	CMP.w #$0040
	BCC.b CODE_0F85EF
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
CODE_0F85EF:
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	PLA
	RTL

CODE_0F85F7:
	RTS

DATA_0F85F8:
	dw $0060,$FFA0

CODE_0F85FC:
	LDY.w $7400,x
	LDA.w DATA_0F85F8,y
	STA.b $00
	LDA.w #!Define_YI_AmbSpr212
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7142,y
	STA.w $7E4C,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FF80
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0008
	STA.w $7502,y
	LDA.w #$0040
	STA.w $7782,y
	RTS

;---------------------------------------------------------------------------
; Sprite $181 stomp -- Crazee Dayzee head-bop reaction.
; Raiden: head_bop_crazee_daisy.
;---------------------------------------------------------------------------
YI_NorSpr181_CrazeeDayzee_StompRt:
head_bop_crazee_dayzee:
;$0F8636
	LDA.w #!Define_YI_SoundID39_PiranhaPlantMunch			; Note: This sound doesn't play. It gets overwritten by a different sound.
	JSL.l CODE_push_sound_queue
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	XBA
	STA.b $00
	JSL.l CODE_07FD68
	JML.l CODE_despawn_sprite_free_slot

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $041 init -- Stork (delivers Baby Mario in the intro/ending).
; Raiden: init_stork. See also: ys_chr.asm (baby/cutscene actors), ys_enmy.asm family.
;---------------------------------------------------------------------------
YI_NorSpr041_Stork_Init:
init_stork:
;$0F864B
	STZ.w $7400,x
	RTL

;---------------------------------------------------------------------------

; Stork (NorSpr $041) flap-cycle data, all indexed by the Y-counter at $18,x
; (NOT Y-velocity; the Stork doesn't have one -- the camera scrolls past it).
;   DATA_0F864F : OAM tile-index pair {flap-down=$02, flap-up=$00}, written to $7402,x.
;   DATA_0F8655 : per-frame duration written to the generic countdown timer $7A96,x.
;   DATA_0F865B : post-flight tile-index cycle (also for $7402,x), used by CODE_0F86C1.
DATA_stork_flap_tile_pair:
DATA_0F864F:
	db $02,$00,$02,$00,$02,$00

DATA_stork_flap_duration:
DATA_0F8655:
	db $20,$04,$04,$08,$10,$30

DATA_stork_post_flight_tile_cycle:
DATA_0F865B:
	db $02,$03,$02,$01

;---------------------------------------------------------------------------
; Sprite $041 main -- Stork per-frame (flying cinematics).
; Raidenthequick does not name this Main routine explicitly.
;---------------------------------------------------------------------------
YI_NorSpr041_Stork_Main:
;$0F865F
	JSL.l CODE_03AF23
	LDY.b $16,x
	TYX
	JMP.w (DATA_0F8669,x)

DATA_0F8669:
	dw CODE_0F866F
	dw CODE_0F869A
	dw CODE_0F86C1

CODE_0F866F:
	LDX.b $12
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCS.b CODE_0F8699
	SEP.b #$20
	LDY.b #$05
	STY.b $18,x
	LDA.w DATA_0F864F,y
	STA.w $7402,x
	LDA.w DATA_0F8655,y
	STA.w $7A96,x
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
CODE_0F8699:
	RTL

CODE_0F869A:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0F86B8
	LDY.b $18,x
	DEY
	BMI.b CODE_0F86B9
CODE_0F86A6:
	STY.b $18,x
	SEP.b #$20
	LDA.w DATA_0F864F,y
	STA.w $7402,x
	LDA.w DATA_0F8655,y
	STA.w $7A96,x
	REP.b #$20
CODE_0F86B8:
	RTL

CODE_0F86B9:
	LDY.b $16,x
	INY
	INY
	STY.b $16,x
	BRA.b CODE_0F86CD

CODE_0F86C1:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0F86E0
	LDY.b $18,x
	DEY
	BPL.b CODE_0F86CF
CODE_0F86CD:
	LDY.b #$03
CODE_0F86CF:
	STY.b $18,x
	SEP.b #$20
	LDA.w DATA_0F865B,y
	STA.w $7402,x
	LDA.b #$04
	STA.w $7A96,x
	REP.b #$20
CODE_0F86E0:
	RTL

;---------------------------------------------------------------------------

DATA_0F86E1:
	db $00,$00,$40,$80,$C0

DATA_0F86E6:
	db $00,$00,$01,$02,$03

;---------------------------------------------------------------------------
; Sprite $01F init -- Rotating Doors (the spinning Bowser-style door divider).
; Raiden: init_rotating_doors.
;---------------------------------------------------------------------------
YI_NorSpr01F_RotatingDoors_Init:
init_rotating_doors:
;$0F86EB
	CPX.b #$04
	BEQ.b CODE_0F8710
	LDA.w #!Define_YI_NorSpr01F_RotatingDoors
	LDY.b #$04
	JSL.l CODE_03A366
	BCC.b CODE_0F870C
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
CODE_0F870C:
	JML.l CODE_03A31E

CODE_0F8710:
	JSL.l CODE_03AE60
	STZ.w $7400,x
	LDA.w #$0000
	STA.b $76,x
	JSR.w CODE_0F8788
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A2,x
	REP.b #$20
	STZ.w $105C
	STZ.w $105E
	STZ.w $1060
	STZ.w $1062
	STZ.w $1064
	LDA.w #$0008
	STA.b $00
CODE_0F873C:
	LDA.w #$001F
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0F877D
	LDA.w $7722,x
	STA.w $7722,y
	LDA.w $70E2,x
	STA.w $7A36,y
	LDA.w $7182,x
	STA.w $7A38,y
	SEP.b #$20
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LSR
	PHX
	TAX
	LDA.w DATA_0F86E1,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.w DATA_0F86E6,x
	STA.w $7402,y
	PLX
	REP.b #$20
	PHX
	TYX
	JSR.w CODE_0F88A4
	PLX
	DEC.b $00
	DEC.b $00
	BNE.b CODE_0F873C
CODE_0F877C:
	RTL

CODE_0F877D:
	LDA.b $00
	CMP.w #$0008
	BNE.b CODE_0F877C
	JSL.l CODE_03A31E
CODE_0F8788:
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_0F8796
	LDA.w $7722,x
	BMI.b CODE_0F8796
	JSL.l CODE_02A185
CODE_0F8796:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $01F main -- Rotating Doors per-frame; state machine dispatches via
; DATA_rotating_door_state_ptr (see DATA_rotating_door_state_ptr below).
; Raiden: main_rotating_doors.
;---------------------------------------------------------------------------
YI_NorSpr01F_RotatingDoors_Main:
main_rotating_doors:
;$0F8797
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TYX
	JMP.w (DATA_0F879E,x)

DATA_0F879E:
	dw CODE_0F87A8
	dw CODE_0F87D7
	dw CODE_0F87D7
	dw CODE_0F87D7
	dw CODE_0F87D7

CODE_0F87A8:
	LDX.b $12
	JSR.w CODE_0F8788
	LDY.b $79,x
	TYX
	JMP.w (DATA_0F87B3,x)

DATA_0F87B3:
	dw CODE_0F87B7
	dw CODE_0F87D4

CODE_0F87B7:
	LDX.b $12
	LDA.w $105C
	BEQ.b CODE_0F87D3
	LDA.w #$0018
	LDY.b #$08
CODE_0F87C3:
	CPY.w $105C
	BEQ.b CODE_0F87CF
	STA.w $105C,y
	SEC
	SBC.w #$0008
CODE_0F87CF:
	DEY
	DEY
	BNE.b CODE_0F87C3
CODE_0F87D3:
	RTL

CODE_0F87D4:
	LDX.b $12
	RTL

CODE_0F87D7:
	LDX.b $12
	LDY.w $74A2,x
	CMP.w #$00FF
	BEQ.b CODE_0F87EF
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0008
	TAY
	JSL.l CODE_02A20A
CODE_0F87EF:
	LDY.b $79,x
	TYX
	JMP.w (DATA_rotating_door_state_ptr,x)

; Rotating-doors state pointer table, indexed by spr_misc_state ($79,x).
;   0 -> CODE_0F87FD  idle / waiting on player approach
;   1 -> CODE_0F8825  begin rotation
;   2 -> CODE_0F8856  mid-rotation
;   3 -> CODE_0F8870  finish / commit room transition
DATA_0F87F5:
DATA_rotating_door_state_ptr:                        ; Raiden alias
	dw CODE_0F87FD
	dw CODE_0F8825
	dw CODE_0F8856
	dw CODE_0F8870

CODE_0F87FD:
	LDX.b $12
	JSL.l CODE_03AF23
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $105C,y
	BEQ.b CODE_0F8813
	STA.w $7A96,x
	LDY.b #$06
	STY.b $79,x
	RTL

CODE_0F8813:
	JSR.w CODE_0F88DE
	JSR.w CODE_0F88A4
	SEP.b #$20
	LDA.b $78,x
	CLC
	ADC.b #$08
	STA.b $78,x
	REP.b #$20
	RTL

CODE_0F8825:
	LDX.b $12
	JSL.l CODE_03AF23
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0F8855
	LDA.w #$0093
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0F8855
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	LDY.b #$04
	STY.b $79,x
CODE_0F8855:
	RTL

CODE_0F8856:
	LDX.b $12
	LDY.w $7D36,x
	BPL.b CODE_0F886F
	LDA.w $0036
	AND.w #$0008
	BEQ.b CODE_0F886F
CODE_0F8865:
	LDA.w #$FFFF
	STA.w $7722,x
	JSL.l CODE_03A31E
CODE_0F886F:
	RTL

CODE_0F8870:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0F88A3
	LDA.w #!Define_YI_SoundID36_CollectFlower
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr1CD
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	SEC
	SBC.w #$0008
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$000B
	STA.w $7E4C,y
	LDA.w #$0004
	STA.w $7782,y
	BRA.b CODE_0F8865

CODE_0F88A3:
	RTL

CODE_0F88A4:
	LDY.b $78,x
	TYA
	ASL
	TXY
	REP.b #$10
	TAX
	LDA.l DATA_cosine_lut_8bit_radians,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CLC
	ADC.w $7A36,y
	STA.w $70E2,y
	LDA.l DATA_sine_lut_8bit_radians,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CLC
	ADC.w $7A38,y
	STA.w $7182,y
	SEP.b #$10
	TYX
CODE_0F88DD:
	RTS

CODE_0F88DE:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0F88DD
	BEQ.b CODE_0F88DD
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0F88DD
	LDA.w $7D38,y
	BEQ.b CODE_0F88DD
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TYA
	STA.w $105C
	JSR.w CODE_0F892F
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w $6FA2,x
	ORA.w #$0001
	STA.w $6FA2,x
	LDY.b #$02
	STY.b $79,x
	PLA
	RTL

DATA_0F891F:
	dw $05B8,$0077,$07C6,$007A,$05CD,$005B,$00D3,$0677

CODE_0F892F:
	DEC
	DEC
	ASL
	CLC
	ADC.w #DATA_0F891F
	STA.b $00
	LDY.w $7A37,x
	TYA
	ASL
	ASL
	STA.b $02
	LDA.w $7A38,x
	AND.w #$0700
	LSR
	LSR
	ORA.b $02
	PHX
	REP.b #$10
	TAX
	LDA.b ($00)
	STA.l $7F7E00,x
	INC.b $00
	INC.b $00
	LDA.b ($00)
	STA.l $7F7E02,x
	SEP.b #$10
	PLX
	RTS

;---------------------------------------------------------------------------

DATA_0F8962:
	db $00,$01,$01,$00,$00,$40,$00,$C0

DATA_0F896A:
	db $02,$02,$02,$02

DATA_0F896E:
	db $00,$40,$80,$C0

;---------------------------------------------------------------------------
; Sprite $198 init -- Diagonal Arrow Sign (45-degree direction marker).
; Raiden: init_diagonal_arrow_sign.
;---------------------------------------------------------------------------
YI_NorSpr198_DiagonalArrowSign_Init:
init_diagonal_arrow_sign:
;$0F8972
	SEP.b #$20
	LDA.w $70E2,x
	AND.b #$10
	LSR
	LSR
	LSR
	LSR
	STA.b $00
	LDA.w $7182,x
	AND.b #$10
	LSR
	LSR
	LSR
	ORA.b $00
	TAY
	LDA.w DATA_0F896A,y
	STA.w $7402,x
	LDA.w $7042,x
	ORA.w DATA_0F896E,y
	STA.w $7042,x
	REP.b #$20
	BRA.b CODE_0F89C6

;---------------------------------------------------------------------------
; Sprite $197 init -- Cardinal Arrow Sign (up/down/left/right marker).
; Raiden: init_arrow_sign.
;---------------------------------------------------------------------------
YI_NorSpr197_ArrowSign_Init:
init_arrow_sign:
	SEP.b #$20
	LDA.w $70E2,x
	AND.b #$10
	LSR
	LSR
	LSR
	LSR
	STA.b $00
	LDA.w $7182,x
	AND.b #$10
	LSR
	LSR
	LSR
	ORA.b $00
	TAY
	LDA.w DATA_0F8962,y
	STA.w $7402,x
	LDA.w $7042,x
	EOR.w DATA_0F896E,y
	STA.w $7042,x
	REP.b #$20
CODE_0F89C6:
	LDA.w $70E2,x
	AND.w #$FFE0
	CLC
	ADC.w #$0008
	STA.w $70E2,x
	LDA.w $7182,x
	AND.w #$FFE0
	CLC
	ADC.w #$0008
	STA.w $7182,x
	STZ.w $7400,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprites $197 / $198 shared main -- arrow-sign per-frame (both variants).
; Raiden: main_arrow_sign.
;---------------------------------------------------------------------------
YI_NorSpr197_ArrowSign_Main:
YI_NorSpr198_DiagonalArrowSign_Main:
main_arrow_sign:
;$0F89E4
	RTL

;---------------------------------------------------------------------------

DATA_0F89E5:
	dw $FFF0,$FFE0,$FFF0,$0000,$0010,$0020,$0010,$0000

DATA_0F89F5:
	dw $0000,$0008

;---------------------------------------------------------------------------
; Sprite $182 init -- Dragonfly (ambient airborne creature).
; Raiden: init_dragonfly.
;---------------------------------------------------------------------------
YI_NorSpr182_Dragonfly_Init:
init_dragonfly:
;$0F89F9
	LDA.w #$0002
	STA.w $7A96,x
	LDA.w $70E2,x
	STA.b $18,x
	AND.w #$0010
	LSR
	LSR
	LSR
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_0F89F5,y
	STA.b $16,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $182 main -- Dragonfly per-frame. Raiden: main_dragonfly.
;---------------------------------------------------------------------------
YI_NorSpr182_Dragonfly_Main:
main_dragonfly:
;$0F8A17
	JSL.l CODE_03AF23
	JSR.w CODE_0F8A33
	LDA.w $7A96,x
	BNE.b CODE_0F8A32
	LDA.w #$0002
	STA.w $7A96,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
CODE_0F8A32:
	RTL

CODE_0F8A33:
	LDY.b $16,x
	LDA.b $18,x
	CLC
	ADC.w DATA_0F89E5,y
	SEC
	SBC.w $70E2,x
	ASL
	ASL
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_0F8A7A
	LDA.w $7A98,x
	BNE.b CODE_0F8A7A
	LDA.b $76,x
	BNE.b CODE_0F8A5C
	LDA.w #$0020
	STA.w $7A98,x
	INC.b $76,x
	BRA.b CODE_0F8A7A

CODE_0F8A5C:
	STZ.b $76,x
	LDA.b $16,x
	INC
	INC
	AND.w #$000E
	STA.b $16,x
	CMP.w #$0004
	BEQ.b CODE_0F8A71
	CMP.w #$000C
	BNE.b CODE_0F8A7A
CODE_0F8A71:
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_0F8A7A:
	RTS

;---------------------------------------------------------------------------

DATA_0F8A7B:
	dw $0000,$0002,$0004,$0008

DATA_0F8A83:
	dw $0020,$FFE0

DATA_0F8A87:
	dw $0008,$FFF8

DATA_0F8A8B:
	dw $FFC0,$0040

DATA_0F8A8F:
	dw $F800,$0800

;---------------------------------------------------------------------------
; Sprite $183 init -- Butterfly (ambient).
; Raiden: init_butterfly.
;---------------------------------------------------------------------------
YI_NorSpr183_Butterfly_Init:
init_butterfly:
;$0F8A93
	LDA.b $10
	AND.w #$0003
	ASL
	TAY
	LDA.w $7042,x
	ORA.w DATA_0F8A7B,y
	STA.w $7042,x
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w $70E2,x
	PHA
	STA.b $18,x
	AND.w #$0010
	LSR
	LSR
	LSR
	EOR.w #$0002
	STA.w $7400,x
	TAY
	PLA
	CLC
	ADC.w DATA_0F8A83,y
	STA.w $70E2,x
	LDA.w $7182,x
	STA.b $76,x
	CLC
	ADC.w DATA_0F8A87,y
	STA.w $7182,x
	LDA.w DATA_0F8A8B,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0100
	STA.w $7A98,x
	LDA.w DATA_0F8A8F,y
	STA.w $75E2,x
	LDA.w #$0008
	STA.w $7542,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $183 main -- Butterfly per-frame. Raiden: main_butterfly.
;---------------------------------------------------------------------------
YI_NorSpr183_Butterfly_Main:
main_butterfly:
;$0F8AE9
	JSL.l CODE_03AF23
	LDA.w $7A96,x
	BNE.b CODE_0F8B01
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
CODE_0F8B01:
	LDA.w $7A98,x
	BNE.b CODE_0F8B1C
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_0F8A8B,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0100
	STA.w $7A98,x
CODE_0F8B1C:
	LDY.b #$00
	LDA.w $7182,x
	CMP.b $76,x
	BPL.b CODE_0F8B27
	INY
	INY
CODE_0F8B27:
	LDA.w DATA_0F8A8F,y
	STA.w $75E2,x
	RTL

;---------------------------------------------------------------------------

DATA_0F8B2E:
	dw $FFF8,$0008

DATA_0F8B32:
	dw $0800,$F800

;---------------------------------------------------------------------------
; Sprite $165 init -- Nipper Spore (the projectile spat by Nipper Plant).
; Raiden: init_nipper_spore.
;---------------------------------------------------------------------------
YI_NorSpr165_NipperSpore_Init:
init_nipper_spore:
;$0F8B36
	STZ.w $7400,x
	LDA.w $70E2,x
	STA.b $78,x
	PHA
	AND.w #$0010
	LSR
	LSR
	LSR
	TAY
	LDA.w DATA_0F8B32,y
	STA.w $75E0,x
	PLA
	CLC
	ADC.w DATA_0F8B2E,y
	STA.w $70E2,x
	LDA.w #$0004
	STA.w $7540,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $164 init -- Nipper Plant (rooted enemy that spits spores).
; Raiden: init_nipper_plant.
;
; See docs/family-piranhas.md for the full Piranha family. Note the
; $165 Nipper Spore -> $164 Nipper Plant in-slot transmutation: the
; spore's Main calls CODE_spawn_sprite on its own slot to morph into
; a plant on ground-collide (only sprite in family using this pattern).
;---------------------------------------------------------------------------
YI_NorSpr164_NipperPlant_Init:
init_nipper_plant:
;$0F8B5B
	LDA.w #$0002
	STA.b $16,x
	LDA.w $7040,x
	ORA.w #$0120
	STA.w $7040,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0006
	STA.w $7402,x
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w #$0001
	STA.b $18,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $165 main -- Nipper Spore per-frame. Raiden: main_nipper_spore.
;---------------------------------------------------------------------------
YI_NorSpr165_NipperSpore_Main:
main_nipper_spore:
;$0F8B8D
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_main_nipper_plant
	LDA.w $6FA2,x
	AND.w #$8000
	BNE.b CODE_main_nipper_plant
	LDA.w #!Define_YI_NorSpr164_NipperPlant
	TXY
	JSL.l CODE_spawn_sprite
	JSL.l YI_NorSpr164_NipperPlant_Init
;---------------------------------------------------------------------------
; Sprite $164 main -- Nipper Plant per-frame. Raiden: CODE_main_nipper_plant.
;---------------------------------------------------------------------------
YI_NorSpr164_NipperPlant_Main:
CODE_main_nipper_plant:
CODE_0F8BA9:
	JSL.l CODE_03AF23
	LDA.b $16,x
	TAX
	JSR.w (DATA_0F8BB8,x)
	JSL.l CODE_03A5B7
	RTL

DATA_0F8BB8:
	dw CODE_0F8BD0
	dw CODE_0F8CC1
	dw CODE_0F8C6D
	dw CODE_0F8CA3

DATA_0F8BC0:
	db $01,$02,$03,$04,$03,$02,$01,$00,$08,$04,$08,$0C,$08,$04,$08,$0C

CODE_0F8BD0:
	LDX.b $12
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_0F8C1B
	LDY.b #$00
	LDA.w $70E2,x
	CMP.b $78,x
	BMI.b CODE_0F8BE5
	INY
	INY
CODE_0F8BE5:
	LDA.w DATA_0F8B32,y
	STA.w $75E0,x
CODE_0F8BEB:
	LDY.b #$02
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCC.b CODE_0F8C16
	CLC
	ADC.w #$0010
	CMP.w #$0040
	BCS.b CODE_0F8C0D
	LDY.b #$01
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0F8C16
	LDY.b #$03
	BRA.b CODE_0F8C16

CODE_0F8C0D:
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0F8C16
	LDY.b #$04
CODE_0F8C16:
	TYA
	STA.w $7402,x
	RTS

CODE_0F8C1B:
	LDA.w #!Define_YI_SoundID77_EnemyJumpingOutOfPipe
	JSL.l CODE_push_sound_queue
	JSL.l CODE_039F2B
	LDA.w $6FA0,x
	AND.w #$E7FF
	STA.w $6FA0,x
	LDA.w $6FA2,x
	AND.w #$7FFF
	ORA.w #$0040
	STA.w $6FA2,x
	LDA.w $7040,x
	ORA.w #$0120
	STA.w $7040,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0006
	STA.w $7402,x
	LDA.w #$0040
	STA.w $7A96,x
	LDA.w #$0001
	STA.b $18,x
	LDA.w #$0006
	STA.b $16,x
	RTS

CODE_0F8C6D:
	LDX.b $12
	LDY.w $7223,x
	BMI.b CODE_0F8CA0
	LDA.w $70E2,x
	SEC
	SBC.w #$0008
	STA.b $78,x
	LDA.w #$F800
	STA.w $75E0,x
	LDA.w $7040,x
	ORA.w #$0004
	STA.w $7040,x
	LDA.w $7682,x
	CMP.w #$FFF0
	BPL.b CODE_0F8C9E
	LDA.w $609C
	SEC
	SBC.w #$0010
	STA.w $7182,x
CODE_0F8C9E:
	STZ.b $16,x
CODE_0F8CA0:
	JMP.w CODE_0F8BEB

CODE_0F8CA3:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0F8CB7
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	LDY.b #$02
	STY.b $16,x
CODE_0F8CB7:
	RTS

DATA_0F8CB8:
	db $05,$06,$07

DATA_0F8CBB:
	db $07,$06

DATA_0F8CBD:
	dw $FF80,$0080

CODE_0F8CC1:
	LDX.b $12
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_0F8CF8
	LDA.w $6FA2,x
	AND.w #$F7FF
	LDA.w $6FA2,x
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w #$0000
	STA.b $18,x
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0F8CED
	INY
	CMP.w #$FF00
	BCC.b CODE_0F8CED
	INY
CODE_0F8CED:
	SEP.b #$20
	LDA.w DATA_0F8CB8,y
	STA.w $7402,x
	REP.b #$20
	RTS

CODE_0F8CF8:
	LDA.w $6FA2,x
	ORA.w #$0800
	LDA.w $6FA2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A96,x
	BNE.b CODE_0F8D1E
	DEC.b $18,x
	BMI.b CODE_0F8D1F
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_0F8CBB,y
	STA.w $7402,x
	LDA.b #$08
	STA.w $7A96,x
	REP.b #$20
CODE_0F8D1E:
	RTS

CODE_0F8D1F:
	LDY.w $7400,x
	LDA.w DATA_0F8CBD,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $040 init -- Baby Luigi (cutscene actor for intro / Bowser ending).
; Raiden: init_baby_luigi. See also: ys_chr.asm.
;---------------------------------------------------------------------------
YI_NorSpr040_BabyLuigi_Init:
init_baby_luigi:
;$0F8D2F
	JSL.l CODE_03AE60
	JSR.w CODE_0F8D44
	STZ.w $7400,x
	RTL

DATA_0F8D3A:
	db $20,$28,$28,$28,$28,$28,$28,$28,$28,$28

CODE_0F8D44:
	SEP.b #$20
	LDY.w $7402,x
	LDA.w $7041,x
	AND.b #$07
	ORA.w DATA_0F8D3A,y
	STA.w $7041,x
	REP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_0F8D57:
	db $20,$02,$02,$02,$20,$02,$20,$10,$02,$02,$02,$02,$02,$02,$10,$04
	db $04,$04,$04,$04,$04,$04,$04,$04,$04,$04,$04,$04,$04,$20

DATA_0F8D75:
	db $09,$08,$04,$06,$07,$06,$04,$05,$04,$03,$02,$01,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00

DATA_0F8D93:
	db $00,$00,$00,$00,$00,$00,$00,$04,$00,$02,$06,$06,$02,$00,$04,$00
	db $02,$00,$04,$00,$02,$00,$04,$00,$02,$00,$04,$00,$02,$00

;---------------------------------------------------------------------------
; Sprite $040 main -- Baby Luigi per-frame. Raiden: main_baby_luigi.
;---------------------------------------------------------------------------
YI_NorSpr040_BabyLuigi_Main:
main_baby_luigi:
;$0F8DB1
	JSR.w CODE_0F8E20
	JSR.w CODE_0F8E49
	JSL.l CODE_03AF23
	LDY.b $18,x
	TYX
	JMP.w (DATA_0F8DC1,x)

DATA_0F8DC1:
	dw CODE_0F8DC5
	dw CODE_0F8DF8

CODE_0F8DC5:
	LDX.b $12
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0030
	CMP.w #$0060
	BCS.b CODE_0F8DF7
	SEP.b #$20
	LDY.b #$1D
	STY.b $19,x
	LDA.w DATA_0F8D57,y
	STA.w $7A96,x
	LDA.w DATA_0F8D75,y
	STA.w $7402,x
	LDA.w DATA_0F8D93,y
	STA.b $16,x
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
	JSR.w CODE_0F8D44
CODE_0F8DF7:
	RTL

CODE_0F8DF8:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0F8E1E
	LDY.b $19,x
	DEY
	BMI.b CODE_0F8E1F
	STY.b $19,x
	SEP.b #$20
	LDA.w DATA_0F8D57,y
	STA.w $7A96,x
	LDA.w DATA_0F8D75,y
	STA.w $7402,x
	LDA.w DATA_0F8D93,y
	STA.b $16,x
	REP.b #$20
	JSR.w CODE_0F8D44
CODE_0F8E1E:
	RTL

CODE_0F8E1F:
	RTL

CODE_0F8E20:
	LDA.w $7402,x
	BNE.b CODE_0F8E2A
	JSL.l CODE_03AA52
	RTS

CODE_0F8E2A:
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0008
	TAY
	JSL.l CODE_03AA60
	RTS

DATA_0F8E39:
	dw $0100,$00E8,$0120,$00D0

DATA_0F8E41:
	dw $0100,$0120,$00E8,$0150

CODE_0F8E49:
	LDY.w $74A2,x
	CMP.w #$00FF
	BEQ.b CODE_0F8EA5
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_0F8EA5
	LDA.w $7722,x
	BMI.b CODE_0F8EA5
	LDY.b $16,x
	LDA.w DATA_0F8E39,y
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w DATA_0F8E41,y
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0019
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	REP.b #$10
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_548000+$20A0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$20A0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	SEP.b #$10
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
CODE_0F8EA5:
	RTS

;---------------------------------------------------------------------------

DATA_0F8EA6:
	dw !Define_YI_NorSpr0C1_WingedCloudWith5Stars
	dw !Define_YI_NorSpr0C8_WingedCloudWith6LeafSunflower
	dw !Define_YI_NorSpr0B8_WingedCloudWithFlower
	dw !Define_YI_NorSpr0B7_WingedCloudWithBubbled1up

;---------------------------------------------------------------------------
; Sprite $067 init -- Hidden Winged Cloud revealed by ground-pounding a rock.
; Raiden: init_hidden_winged_cloud_A.
;---------------------------------------------------------------------------
YI_NorSpr067_RockRevealedHiddenWingedCloud_Init:
init_hidden_winged_cloud_A:
;$0F8EAE
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0F8ECF
	SEP.b #$20
	LDA.w $70E2,x
	AND.b #$10
	LSR
	LSR
	LSR
	STA.b $00
	LDA.w $7182,x
	AND.b #$10
	LSR
	LSR
	ORA.b $00
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TAY
	REP.b #$20
CODE_0F8ECF:
	DEY
	TYX
	JMP.w (DATA_0F8ED4,x)

DATA_0F8ED4:
	dw CODE_0F8EDC
	dw CODE_0F8EE8
	dw CODE_0F8EDC
	dw CODE_0F8EDC

CODE_0F8EDC:
	LDX.b $12
	JSL.l CODE_03D3F8
	BEQ.b CODE_0F8EEA
	JML.l CODE_03A31E

CODE_0F8EE8:
	LDX.b $12
CODE_0F8EEA:
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $067 main -- Hidden Winged Cloud per-frame.
; Raiden: main_hidden_winged_cloud_A.
;---------------------------------------------------------------------------
YI_NorSpr067_RockRevealedHiddenWingedCloud_Main:
main_hidden_winged_cloud_A:
;$0F8EEB
	JSL.l CODE_03AF23
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_0F8EFC:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_0F8F4A
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr09E_ChompRock
	BEQ.b CODE_0F8F1B
	CMP.w #!Define_YI_NorSpr0DC_Snowball
	BEQ.b CODE_0F8F1B
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_0F8EFC

CODE_0F8F1B:
	LDA.w #!Define_YI_SoundID27_CollectSuperStar
	JSL.l CODE_push_sound_queue
	JSL.l CODE_039F2B
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEY
	LDA.w DATA_0F8EA6,y
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	SEP.b #$20
	LDA.b #$01
	STA.w $77C0,y
	REP.b #$20
CODE_0F8F4A:
	RTL

;---------------------------------------------------------------------------

DATA_0F8F4B:
	dw $0000,$0002,$0004,$0008

;---------------------------------------------------------------------------
; Sprite $191 init -- Sparrow / generic ambient bird.
; Raiden: init_sparrow.
;---------------------------------------------------------------------------
YI_NorSpr191_Bird_Init:
init_sparrow:
;$0F8F53
	LDA.b $10
	AND.w #$0003
	ASL
	TAY
	LDA.w $7042,x
	ORA.w DATA_0F8F4B,y
	STA.w $7042,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $191 main -- Sparrow per-frame. Raiden: main_sparrow.
;---------------------------------------------------------------------------
YI_NorSpr191_Bird_Main:
main_sparrow:
;$0F8F64
	JSL.l CODE_03AF23
	LDA.b $16,x
	TAX
	JMP.w (DATA_0F8F6E,x)

DATA_0F8F6E:
	dw CODE_0F8F92
	dw CODE_0F90A8

DATA_0F8F72:
	dw $FF80,$0080

DATA_0F8F76:
	dw $FD00,$FE00,$FF00,$FFC0,$0040,$0100,$0200,$0300

DATA_0F8F86:
	db $01,$02,$03,$02,$01,$00

DATA_0F8F8C:
	db $01,$02,$03,$02,$01,$03

CODE_0F8F92:
	LDX.b $12
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098F33>>16
	LDA.w #FXCODE_098F33
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_0F8FC8
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCS.b CODE_0F8FC8
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCC.b CODE_0F8FE8
CODE_0F8FC8:
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCS.b CODE_0F9034
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCS.b CODE_0F9034
CODE_0F8FE8:
	LDA.b $10
	AND.w #$0007
	ASL
	TAY
	LDA.w DATA_0F8F76,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	TYA
	AND.w #$0008
	LSR
	LSR
	STA.w $7400,x
	LDA.w #$FE00
	STA.w $75E2,x
	LDA.w #$0010
	STA.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
	LDA.w $7040,x
	AND.w #$FFFC
	STA.w $7040,x
	LDA.w #$0002
	STA.w $7A96,x
	STZ.w $7402,x
	INC.b $16,x
	INC.b $16,x
	LDA.w #!Define_YI_SoundID75_LitterMouserSqueak
	JSL.l CODE_push_sound_queue
	RTL

CODE_0F9034:
	LDA.b $18,x
	BNE.b CODE_0F9070
	LDA.w $7A98,x
	BNE.b CODE_0F905D
	DEC.b $76,x
	BPL.b CODE_0F904B
	LDA.w $7A96,x
	BEQ.b CODE_0F905E
	LDA.w #$0005
	STA.b $76,x
CODE_0F904B:
	SEP.b #$20
	LDY.b $76,x
	LDA.w DATA_0F8F86,y
	STA.w $7402,x
	LDA.w DATA_0F8F8C,y
	STA.w $7A98,x
	REP.b #$20
CODE_0F905D:
	RTL

CODE_0F905E:
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0020
	STA.w $7A96,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.b $18,x
	RTL

CODE_0F9070:
	LDA.w $7A96,x
	BEQ.b CODE_0F9090
CODE_0F9075:
	LDA.w $7AF6,x
	BNE.b CODE_0F908F
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.b $10
	AND.w #$0007
	CLC
	ADC.w #$0008
	STA.w $7AF6,x
CODE_0F908F:
	RTL

CODE_0F9090:
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0040
	STA.w $7A96,x
	LDY.w $7400,x
	LDA.w DATA_0F8F72,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $18,x
	RTL

CODE_0F90A8:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0F90BE
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7A96,x
CODE_0F90BE:
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $087 init -- Red 1-up egg "mock-up" sprite (decorative laid egg).
; Raiden: init_red_1up_egg.
;---------------------------------------------------------------------------
YI_NorSpr087_MockUpLaidEgg_Init:
init_red_1up_egg:
;$0F90BF
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $087 main -- Red 1-up egg per-frame. Raiden: main_red_1up_egg.
;---------------------------------------------------------------------------
YI_NorSpr087_MockUpLaidEgg_Main:
main_red_1up_egg:
;$0F90C0
	JSL.l CODE_03AF23
	LDY.b $16,x
	TYX
	JMP.w (DATA_0F90CA,x)

DATA_0F90CA:
	dw CODE_0F90CE
	dw CODE_0F90E6

CODE_0F90CE:
	LDX.b $12
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0F90E5
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0010
	STA.w $7A96,x
	LDY.b #$02
	STY.b $16,x
CODE_0F90E5:
	RTL

CODE_0F90E6:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0F9110
	LDA.w $70E2,x
	STA.w $0000
	LDA.w $7182,x
	STA.w $0002
	LDA.w $7042,x
	AND.w #$003E
	STA.w $0004
	JSL.l CODE_04F88E
	LDX.b $12
	JSL.l CODE_spawn_1up_score
	JSL.l CODE_despawn_sprite_free_slot
CODE_0F9110:
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $163 init -- Bouncing Green Needlenose (the spike enemy that hops).
; Raiden: init_bouncing_green_needlenose.
;---------------------------------------------------------------------------
YI_NorSpr163_BouncingNeedlenose_Init:
init_bouncing_green_needlenose:
;$0F9111
	RTL

;---------------------------------------------------------------------------

DATA_0F9112:
	dw $FC00,$FE00

;---------------------------------------------------------------------------
; Sprite $163 main -- Bouncing Green Needlenose per-frame.
; Raiden: main_bouncing_green_needlenose.
;---------------------------------------------------------------------------
YI_NorSpr163_BouncingNeedlenose_Main:
main_bouncing_green_needlenose:
;$0F9116
	LDA.w $7D38,x
	BEQ.b CODE_0F912D
	LDA.w $6FA0,x
	ORA.w #$0600
	STA.w $6FA0,x
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
CODE_0F912D:
	JSL.l CODE_03AF23
	LDA.w $6FA2,x
	BIT.w #$001F
	BEQ.b CODE_0F9173
	JSL.l CODE_03A5B7
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0F9173
	LDA.b $18,x
	CMP.w #$0002
	BCS.b CODE_0F9173
	ASL
	TAY
	LDA.w DATA_0F9112,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.b $18,x
	BEQ.b CODE_0F916A
	LDA.w $6FA0,x
	AND.w #$F99F
	STA.w $6FA0,x
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
CODE_0F916A:
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	INC.b $18,x
CODE_0F9173:
	RTL

;---------------------------------------------------------------------------

DATA_0F9174:
	dw $0000,$0002,$0004,$0008

;---------------------------------------------------------------------------
; Sprite $1AC init -- Small Frog enemy. Raiden: init_frog.
;---------------------------------------------------------------------------
YI_NorSpr1AC_SmallFrog_Init:
init_frog:
;$0F917C:
	LDA.b $10
	AND.w #$0006
	TAY
	LDA.w $7042,x
	ORA.w DATA_0F9174,y
	STA.w $7042,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $1AC main -- Small Frog per-frame. Raiden: main_frog.
;---------------------------------------------------------------------------
YI_NorSpr1AC_SmallFrog_Main:
main_frog:
;$0F918C
	JSL.l CODE_03AF23
	LDY.b $16,x
	TYX
	JMP.w (DATA_0F9197,x)

CODE_0F9196:
	RTL

DATA_0F9197:
	dw CODE_0F919F
	dw CODE_0F91FB
	dw CODE_0F9229
	dw CODE_0F9252

CODE_0F919F:
	LDX.b $12
	LDA.w $7C16,x
	BPL.b CODE_0F91AA
	EOR.w #$FFFF
	INC
CODE_0F91AA:
	CMP.w #$0030
	BPL.b CODE_0F91D5
	LDA.w $7C18,x
	BPL.b CODE_0F91B8
	EOR.w #$FFFF
	INC
CODE_0F91B8:
	CMP.w #$0030
	BPL.b CODE_0F91D5
	LDA.w $6FA2,x
	AND.w #$FF3F
	ORA.w #$0480
	STA.w $6FA2,x
	STZ.w $7A96,x
	LDA.b $16,x
	CLC
	ADC.w #$0004
	STA.b $16,x
	RTL

CODE_0F91D5:
	LDA.w $7A96,x
	BNE.b CODE_0F91FA
	INC.b $16,x
	INC.b $16,x
	LDA.b $10
	AND.w #$0002
	EOR.w $7400,x
	STA.w $7400,x
	PHP
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	PLP
	BEQ.b CODE_0F91F7
	EOR.w #$FFFF
	INC
CODE_0F91F7:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0F91FA:
	RTL

CODE_0F91FB:
	LDX.b $12
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_0F921A
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7402,x
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0020
	STA.w $7A96,x
	STZ.b $16,x
	RTL

CODE_0F921A:
	LDA.w #$0001
	LDY.w $7223,x
	BMI.b CODE_0F9225
	LDA.w #$0002
CODE_0F9225:
	STA.w $7402,x
	RTL

CODE_0F9229:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0F9251
	INC.b $16,x
	INC.b $16,x
	LDA.w $77C2,x
	AND.w #$00FF
	EOR.w #$0002
	STA.w $7400,x
	PHP
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	PLP
	BEQ.b CODE_0F924E
	EOR.w #$FFFF
	INC
CODE_0F924E:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0F9251:
	RTL

CODE_0F9252:
	LDX.b $12
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_0F926D
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7402,x
	LDA.w #$0010
	STA.w $7A96,x
	DEC.b $16,x
	DEC.b $16,x
	RTL

CODE_0F926D:
	LDA.w #$0001
	LDY.w $7223,x
	BMI.b CODE_0F9278
	LDA.w #$0002
CODE_0F9278:
	STA.w $7402,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $161 init -- Reward item dropped after clearing every enemy in a
; "defeat-all" bonus room. Raiden: init_bonus_sprite.
;---------------------------------------------------------------------------
YI_NorSpr161_RewardItemForDefeatingRoomEnemies_Init:
init_bonus_sprite:
;$0F927C
	JSL.l CODE_03D3F8
	BEQ.b CODE_0F9286
	JML.l CODE_03A31E

CODE_0F9286:
	SEP.b #$20
	LDA.w $70E2,x
	AND.b #$10
	LSR
	LSR
	LSR
	STA.b $00
	LDA.w $7182,x
	AND.b #$10
	LSR
	LSR
	ORA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	REP.b #$20
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $161 main -- Defeat-all bonus reward per-frame. Raiden: main_bonus_sprite.
;---------------------------------------------------------------------------
YI_NorSpr161_RewardItemForDefeatingRoomEnemies_Main:
main_bonus_sprite:
;$0F92A1
	JSL.l CODE_03AF23
	LDX.b #FXCODE_09AF4A>>16
	LDA.w #FXCODE_09AF4A
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	BMI.b CODE_0F92B6
	RTL

CODE_0F92B6:
	LDA.w #!Define_YI_SoundID95_BonusChallenge
	JSL.l CODE_push_sound_queue
	JSL.l CODE_039F2B
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w DATA_0F92D9,y
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TYX
	JMP.w (DATA_0F92E1,x)

DATA_0F92D9:
	dw !Define_YI_NorSpr115_Coin
	dw !Define_YI_NorSpr027_Key
	dw !Define_YI_NorSpr0FA_Flower
	dw !Define_YI_NorSpr093_Door

DATA_0F92E1:
	dw CODE_0F92E9
	dw CODE_0F931C
	dw CODE_0F931C
	dw CODE_0F931C

CODE_0F92E9:
	LDX.b $12
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $7042,x
	AND.w #$FFF1
	ORA.w #$0002
	STA.w $7042,x
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
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTL

CODE_0F931C:
	LDX.b $12
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%ROUTINE_YI_NorSpr053_KamekSayingOhMy($0F9328)
	%ROUTINE_YI_NorSpr0AA_BackgroundShyguy($0F9435)
	%ROUTINE_YI_NorSpr03E_ThinPlatform($0F94D6)
else
endif

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0D3 init -- Giant/Large Milde (the splitable purple blob).
; Raiden: init_giant_milde.
;---------------------------------------------------------------------------
YI_NorSpr0D3_LargeMilde_Init:
init_giant_milde:
;$0F9328
	JSL.l CODE_03ADD0
	BCS.b CODE_0F9332
	JML.l CODE_03A31E

CODE_0F9332:
	JSR.w CODE_0F9838
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0D3 main + stomp -- Giant Milde per-frame and stomp reaction
; (stomp on Giant Milde splits it into Medium Mildes).
; Raiden: main_giant_milde.
;---------------------------------------------------------------------------
YI_NorSpr0D3_LargeMilde_Main:
YI_NorSpr0D3_LargeMilde_StompRt:
main_giant_milde:
;$0F933F
	STZ.w $7D38,x
	REP.b #$10
	LDA.w $7362,x
	BMI.b CODE_0F935F
	CLC
	ADC.w #$0030
	PHA
	TAY
	JSL.l CODE_03AAAB
	REP.b #$10
	PLA
	CLC
	ADC.w #$0040
	TAY
	JSL.l CODE_03AAAB
CODE_0F935F:
	SEP.b #$10
	LDA.w $7AF6,x
	BNE.b CODE_0F9377
	LDA.b $76,x
	CMP.w #$0003
	BEQ.b CODE_0F9377
	JSR.w CODE_0F9797
	JSL.l CODE_0F9388
	JSR.w CODE_0F97EE
CODE_0F9377:
	JSL.l CODE_03AF23
	JSR.w CODE_0F94BF
	JSR.w CODE_0F93EA
	JSR.w CODE_0F9391
	JSR.w CODE_0F9838
	RTL

CODE_0F9388:
	JSL.l CODE_03A5B7
	RTL

DATA_0F938D:
	dw $FFFF,$0001

CODE_0F9391:
	SEP.b #$20
	LDA.w $7860,x
	AND.b #$0C
	REP.b #$20
	BEQ.b CODE_0F93E4
	LSR
	LSR
	AND.w #$0002
	TAY
	LDA.w $70E2,x
	CLC
	ADC.w DATA_0F938D,y
	STA.w $70E2,x
	LDA.b $76,x
	CMP.w #$0002
	BNE.b CODE_0F93C4
	LDA.w $7A36,x
	BEQ.b CODE_0F93C4
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_0F93E4

CODE_0F93C4:
	LDA.b $76,x
	CMP.w #$0002
	BNE.b CODE_0F93D0
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_0F93E4

CODE_0F93D0:
	LDA.w #$0001
	STA.b $76,x
	LDA.w #$0018
	STA.w $7A96,x
	LDY.w $7400,x
	LDA.w DATA_0F93E5,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0F93E4:
	RTS

DATA_0F93E5:
	dw $0020,$FFE0

CODE_0F93E9:
	RTS

CODE_0F93EA:
	LDY.w $7D36,x
	BEQ.b CODE_0F93E9
	BMI.b CODE_0F93E9
	DEY
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr0D3_LargeMilde
	BEQ.b CODE_0F93FF
	CMP.w #!Define_YI_NorSpr0D4_MediumMilde
	BNE.b CODE_0F93E9
CODE_0F93FF:
	STZ.b $00
	LDA.w $70E2,x
	SEC
	SBC.w $70E2,y
	BPL.b CODE_0F940E
	INC.b $00
	INC.b $00
CODE_0F940E:
	LDA.b $76,x
	CMP.w #$0000
	BEQ.b CODE_0F9442
	CMP.w #$0002
	BNE.b CODE_0F9477
	LDA.w $7A36,x
	BEQ.b CODE_0F9477
	STZ.w $7A36,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	JSR.w CODE_0F9812
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.w $7A36,y
	LDA.w #$00FF
	STA.w $7A96,y
	BRA.b CODE_0F9477

CODE_0F9442:
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_0F946B
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	DEC.w $7182,x
	DEC.w $7182,x
	JSR.w CODE_0F9812
	PHX
	TYX
	JSR.w CODE_0F9812
	PLX
	BRA.b CODE_0F94BE

CODE_0F946B:
	LDA.w $7400,x
	CMP.b $00
	BNE.b CODE_0F9477
	PHY
	JSR.w CODE_0F93C4
	PLY
CODE_0F9477:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CMP.w #$0000
	BEQ.b CODE_0F94B1
	CMP.w #$0002
	BNE.b CODE_0F94BE
	LDA.w $7A36,y
	BEQ.b CODE_0F94BE
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0001
	STA.w $7A36,x
	LDA.w #$0002
	STA.b $76,x
	LDA.w #$00FF
	STA.w $7A96,x
	LDA.w #$0000
	STA.w $7A36,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	PHX
	TYX
	JSR.w CODE_0F9812
	PLX
	BRA.b CODE_0F94BE

CODE_0F94B1:
	LDA.w $7400,y
	CMP.b $00
	BEQ.b CODE_0F94BE
	PHX
	TYX
	JSR.w CODE_0F93C4
	PLX
CODE_0F94BE:
	RTS

CODE_0F94BF:
	LDA.b $76,x
	ASL
	TXY
	TAX
	JMP.w (DATA_0F94C7,x)

DATA_0F94C7:
	dw CODE_0F94DD
	dw CODE_0F9517
	dw CODE_0F9571
	dw CODE_0F9672

DATA_0F94CF:
	dw $FF80,$0080

DATA_0F94D3:
	db $00,$01,$02,$03,$04,$05,$04,$03,$02,$01

CODE_0F94DD:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0F94EF
	LDY.w $7400,x
	LDA.w DATA_0F94CF,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0F94EF:
	SEP.b #$20
	DEC.w $7A38,x
	BPL.b CODE_0F9505
	LDA.b #$07
	STA.w $7A38,x
	INC.b $16,x
	LDA.b $16,x
	CMP.b #$0A
	BNE.b CODE_0F9505
	STZ.b $16,x
CODE_0F9505:
	LDY.b $16,x
	LDA.w DATA_0F94D3,y
	STA.w $7402,x
	REP.b #$20
	RTS

DATA_0F9510:
	db $00,$06,$07,$07,$06,$00,$00

CODE_0F9517:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0F9525
CODE_0F951D:
	LDA.w #$0000
	STA.b $76,x
	STZ.b $16,x
	RTS

CODE_0F9525:
	SEP.b #$20
	CMP.b #$0B
	BNE.b CODE_0F9535
	PHA
	LDA.w $7400,x
	EOR.b #$02
	STA.w $7400,x
	PLA
CODE_0F9535:
	LSR
	LSR
	TAY
	LDA.w DATA_0F9510,y
	STA.w $7402,x
	REP.b #$20
	RTS

DATA_0F9541:
	dw $0100,$0108,$0110,$0118,$0118,$0110,$0108,$0100

DATA_0F9551:
	dw $0100,$00F8,$00F0,$00E8,$00E8,$00F0,$00E8,$0100
	dw $0100,$0108,$0110,$0118,$0118,$0110,$0108,$0100

CODE_0F9571:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0F9586
	JSR.w CODE_0FA5E7
	JSR.w CODE_0FA5E7
	JSR.w CODE_0FA5E7
	JSR.w CODE_0FA5E7
CODE_0F9586:
	LDA.w $7A96,x
	BNE.b CODE_0F9597
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JMP.w CODE_0F951D

CODE_0F9597:
	NOP #2
	AND.w #$0007
	ASL
	ASL
	TAY
	LDA.w DATA_0F9541,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w DATA_0F9551,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	REP.b #$10
	LDA.w $7362,x
	TXY
	CLC
	ADC.w #$0018
	TAX
	LDA.w $7A96,y
	BIT.w #$0002
	BEQ.b CODE_0F95D7
	AND.w #$0004
	BEQ.b CODE_0F95CE
	INC.w $6002,x
	INC.w $600A,x
	INC.w $6012,x
	BRA.b CODE_0F95D7

CODE_0F95CE:
	DEC.w $6002,x
	DEC.w $600A,x
	DEC.w $6012,x
CODE_0F95D7:
	SEP.b #$10
	LDX.b $12
	RTS

DATA_0F95DC:
	dw $0107,$010E,$0115,$011C,$0123,$012A,$0131,$0138
	dw $0138,$0138,$0138,$0138,$0138,$0138,$0138

DATA_0F95FA:
	dw $00E9,$00D2,$00BB,$00A4,$008D,$0076,$005F,$0048
	dw $0048,$0048,$0048,$0048,$0048,$0048,$0048

DATA_0F9618:
	dw $0000,$0004,$0005,$0008,$000B,$000D,$0010,$0014
	dw $0014,$0014,$0014,$0014,$0014,$0014,$0014

DATA_0F9636:
	dw $0008,$0008,$0009,$000A,$000A,$000B,$000C,$000C
	dw $000C,$000C,$000C,$000C,$000C,$000C,$000C

DATA_0F9654:
	dw $FFD8,$FFDC,$FFE0,$FFE4,$FFE8,$FFEC,$FFF2,$FFF7
	dw $FFF7,$FFF7,$FFF7,$FFF7,$FFF7,$FFF7,$FFF7

CODE_0F9672:
	TYX
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b $16,x
	CPY.b #$1E
	BEQ.b CODE_0F96CC
	LDA.w $0030
	AND.w #$0001
	BNE.b CODE_0F9688
	INC.b $16,x
	INC.b $16,x
CODE_0F9688:
	LDA.w DATA_0F95DC,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w DATA_0F95FA,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w DATA_0F9636,y
	STA.w $7402,x
	LDA.w $7182,x
	CLC
	ADC.w DATA_0F9654,y
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60AA
	LDA.w DATA_0F9618,y
	STA.b $00
	REP.b #$10
	LDA.w #$000F
	STA.b $02
	LDY.w $7362,x
CODE_0F96B6:
	LDA.w $6032,y
	CLC
	ADC.b $00
	STA.w $6032,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEC.b $02
	BPL.b CODE_0F96B6
	SEP.b #$10
	RTS

CODE_0F96CC:
	STZ.w $60D4
	LDA.w #!Define_YI_SoundID86_MildePop2
	JSL.l CODE_push_sound_queue
	JSR.w CODE_0F96EA
	JSL.l CODE_despawn_sprite_free_slot
	RTS

DATA_0F96DE:
	dw $0100,$FF00

DATA_0F96E2:
	dw $0010,$FFF0

DATA_0F96E6:
	dw $0002,$0000

CODE_0F96EA:
	LDA.w #$012E
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0F970B
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w $7CD6,x
	STA.w $70E2,y
	LDA.w $7CD8,x
	STA.w $7182,y
CODE_0F970B:
	LDA.w $7CD6,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0050
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #$0400
	STA.w $6000
	LDA.w #$FC00
	STA.w $6002
	LDX.b #FXCODE_099253>>16
	LDA.w #FXCODE_099253
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	LDA.w #$0002
	STA.b $08
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	STA.b $02
CODE_0F974A:
	LDA.w #$00D4
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0F9796
	LDX.b $08
	LDA.b $00
	CLC
	ADC.w DATA_0F96E2,x
	STA.w $70E2,y
	LDA.w DATA_0F96DE,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w DATA_0F96E6,x
	STA.w $7400,y
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.b $02
	CLC
	ADC.w #$0000
	STA.w $7182,y
	LDA.w #$0020
	STA.w $7AF6,y
	LDA.w #$0030
	STA.w $7A96,y
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	LDX.b $12
	DEC.b $08
	DEC.b $08
	BPL.b CODE_0F974A
CODE_0F9796:
	RTS

CODE_0F9797:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0F97ED
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0F97ED
	LDA.w $7D38,y
	BEQ.b CODE_0F97ED
	LDA.b $76,x
	CMP.w #$0002
	BEQ.b CODE_0F97ED
	LDA.w #$0002
	STA.b $76,x
	PHY
	LDA.w #!Define_YI_SoundID34_BurtJump
	JSL.l CODE_push_sound_queue
	PLY
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0D4_MediumMilde
	BNE.b CODE_0F97E2
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$00FF
	STA.w $7A96,x
	INC.w $7A36,x
CODE_0F97E2:
	LDY.w $7D36,x
	DEY
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
CODE_0F97ED:
	RTS

CODE_0F97EE:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$000E
	BNE.b CODE_0F9826
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w $60D4
	BNE.b CODE_0F9827
	LDA.w #$0002
	STA.b $76,x
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w #$FB00
	STA.w $60AA
CODE_0F9812:
	LDA.w #$0002
	STA.b $76,x
	LDA.w #$0020
	STA.w $7A96,x
	PHY
	LDA.w #!Define_YI_SoundID34_BurtJump
	JSL.l CODE_push_sound_queue
	PLY
CODE_0F9826:
	RTS

CODE_0F9827:
	STZ.b $16,x
	LDA.w #$0003
	STA.b $76,x
	LDA.w $6FA0,x
	AND.w #$F9FF
	STA.w $6FA0,x
	RTS

CODE_0F9838:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$001F
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #FXDATA_560000+$60A0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$60A0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$001F
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STZ.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #FXDATA_560000+$60C0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$60C0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.l DATA_03A9CE,x
	CLC
	ADC.w #$0020
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0D4 init -- Large/Medium Milde (the smaller Milde left after splitting).
; Raiden: init_large_milde.
;---------------------------------------------------------------------------
YI_NorSpr0D4_MediumMilde_Init:
init_large_milde:
;$0F98BC
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0D4 main + stomp -- Medium Milde per-frame and stomp reaction.
; Raiden: main_large_milde.
;---------------------------------------------------------------------------
YI_NorSpr0D4_MediumMilde_Main:
YI_NorSpr0D4_MediumMilde_StompRt:
main_large_milde:
;$0F98BD
	STZ.w $7D38,x
	LDA.b $76,x
	CMP.w #$0003
	BNE.b CODE_0F98D5
	JSR.w CODE_0F9BB6
	JSL.l CODE_03AF23
	JSR.w CODE_0F993B
	JSR.w CODE_0F9BC9
	RTL

CODE_0F98D5:
	LDA.w $7AF6,x
	BNE.b CODE_0F98E4
	JSR.w CODE_0F9797
	JSL.l CODE_0F9388
	JSR.w CODE_0F98F2
CODE_0F98E4:
	JSL.l CODE_03AF23
	JSR.w CODE_0F993B
	JSR.w CODE_0F93EA
	JSR.w CODE_0F9391
	RTL

CODE_0F98F2:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$000E
	BNE.b CODE_0F9919
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w $60D4
	BNE.b CODE_0F991A
	LDA.w #$0002
	STA.b $76,x
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w #$FB00
	STA.w $60AA
	STZ.w $7A36,x
CODE_0F9919:
	RTS

CODE_0F991A:
	STZ.b $16,x
	LDA.w #$0003
	STA.b $76,x
	LDA.w #$0002
	STA.w $7402,x
	LDA.w $7040,x
	AND.w #$01FF
	ORA.w #$4000
	STA.w $7040,x
	JSL.l CODE_0F9BAB
	JSR.w CODE_0F9BB6
	RTS

CODE_0F993B:
	LDA.b $76,x
	ASL
	TXY
	TAX
	JMP.w (DATA_0F9943,x)

DATA_0F9943:
	dw CODE_0F9957
	dw CODE_0F99A2
	dw CODE_0F99C7
	dw CODE_0F9A8F

DATA_0F994B:
	dw $FF80,$0080

DATA_0F994F:
	db $00,$01,$02,$03,$06,$03,$02,$01

CODE_0F9957:
	TYX
	LDA.w $7040,x
	AND.w #$01FF
	ORA.w #$2000
	STA.w $7040,x
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0F9975
	LDY.w $7400,x
	LDA.w DATA_0F994B,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0F9975:
	SEP.b #$20
	DEC.w $7A38,x
	BPL.b CODE_0F998B
	LDA.b #$07
	STA.w $7A38,x
	INC.b $16,x
	LDA.b $16,x
	CMP.b #$08
	BNE.b CODE_0F998B
	STZ.b $16,x
CODE_0F998B:
	LDY.b $16,x
	LDA.w DATA_0F994F,y
	STA.w $7402,x
	REP.b #$20
	LDA.w $7A96,x
	BNE.b CODE_0F99F4
	RTS

DATA_0F999B:
	db $01,$02,$03,$06,$03,$02,$01

CODE_0F99A2:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0F99AB
	JMP.w CODE_0F99EC

CODE_0F99AB:
	SEP.b #$20
	CMP.b #$0B
	BNE.b CODE_0F99BB
	PHA
	LDA.w $7400,x
	EOR.b #$02
	STA.w $7400,x
	PLA
CODE_0F99BB:
	LSR
	LSR
	TAY
	LDA.w DATA_0F999B,y
	STA.w $7402,x
	REP.b #$20
	RTS

CODE_0F99C7:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0F99E7
	LDA.w $7A36,x
	BEQ.b CODE_0F99E4
	LDY.b #$1F
CODE_0F99D7:
	JSR.w CODE_0FA5E7
	DEY
	BPL.b CODE_0F99D7
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_0F99EC
	BNE.b CODE_0F99E7
CODE_0F99E4:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0F99E7:
	LDA.w $7A96,x
	BNE.b CODE_0F99F4
CODE_0F99EC:
	LDA.w #$0000
	STA.b $76,x
	STZ.b $16,x
	RTS

CODE_0F99F4:
	REP.b #$10
	LDA.w $7362,x
	TXY
	TAX
	LDA.w $0030
	AND.w #$0004
	BNE.b CODE_0F9A24
	LDA.w $7400,y
	BEQ.b CODE_0F9A16
	INC.w $6000,x
	INC.w $6010,x
	DEC.w $6008,x
	DEC.w $6018,x
	BRA.b CODE_0F9A30

CODE_0F9A16:
	DEC.w $6000,x
	DEC.w $6010,x
	INC.w $6008,x
	INC.w $6018,x
	BRA.b CODE_0F9A30

CODE_0F9A24:
	DEC.w $6002,x
	DEC.w $600A,x
	INC.w $6012,x
	INC.w $601A,x
CODE_0F9A30:
	SEP.b #$10
	LDX.b $12
	RTS

DATA_0F9A35:
	dw $0107,$010E,$0115,$011C,$0123,$012A,$0131,$0138
	dw $0138,$0138,$0138,$0138,$0138,$0138,$0138

DATA_0F9A53:
	dw $00E9,$00D2,$00BB,$00A4,$0088,$0088,$0088,$0088
	dw $0088,$0088,$0088,$0088,$0088,$0088,$0088

DATA_0F9A71:
	dw $FFE0,$FFE4,$FFE6,$FFE4,$FFE6,$FFEA,$FFEA,$FFEA
	dw $FFEA,$FFEA,$FFEA,$FFEA,$FFEA,$FFEA,$FFEA

CODE_0F9A8F:
	TYX
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b $16,x
	CPY.b #$1E
	BEQ.b CODE_0F9AC5
	LDA.w $0030
	AND.w #$0000
	BNE.b CODE_0F9AA5
	INC.b $16,x
	INC.b $16,x
CODE_0F9AA5:
	LDA.w DATA_0F9A35,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w DATA_0F9A53,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0002
	STA.w $7402,x
	LDA.w $7182,x
	CLC
	ADC.w DATA_0F9A71,y
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60AA
	RTS

CODE_0F9AC5:
	STZ.w $60D4
	LDA.w #!Define_YI_SoundID86_MildePop2
	JSL.l CODE_push_sound_queue
	JSR.w CODE_0F9AF7
	JSL.l CODE_despawn_sprite_free_slot
	RTS

DATA_0F9AD7:
	dw $FD00,$FD00,$FC00,$FC00

DATA_0F9ADF:
	dw $01C0,$FE40,$0100,$FF00

DATA_0F9AE7:
	dw $0010,$FFF0,$0008,$FFF8

DATA_0F9AEF:
	dw $0002,$0000,$0002,$0000

CODE_0F9AF7:
	LDA.w #!Define_YI_AmbSpr1EE
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.w $7CD8,x
	STA.w $7142,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #$0008
	STA.w $73C2,y
	LDA.w $7CD6,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0040
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #$0300
	STA.w $6000
	LDA.w #$FD00
	STA.w $6002
	LDX.b #FXCODE_099253>>16
	LDA.w #FXCODE_099253
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	LDA.w #$0006
	STA.b $08
	LDA.w #$0020
	STA.w $61D6
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	STA.b $02
CODE_0F9B5B:
	LDA.w #$0108
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0F9B9E
	LDX.b $08
	LDA.b $00
	CLC
	ADC.w DATA_0F9AE7,x
	STA.w $70E2,y
	LDA.w DATA_0F9ADF,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w DATA_0F9AEF,x
	STA.w $7400,y
	LDA.w DATA_0F9AD7,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.b $02
	CLC
	ADC.w #$0000
	STA.w $7182,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	BRA.b CODE_0F9BA2

CODE_0F9B9E:
	JSL.l CODE_04D1A2
CODE_0F9BA2:
	LDX.b $12
	DEC.b $08
	DEC.b $08
	BPL.b CODE_0F9B5B
	RTS

CODE_0F9BAB:
	JSL.l CODE_03AD74
	BCS.b CODE_0F9BB5
	JML.l CODE_03A31E

CODE_0F9BB5:
	RTL

CODE_0F9BB6:
	JSL.l CODE_03AA52
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0020
	TAY
	JSL.l CODE_03AA60
	RTS

CODE_0F9BC9:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$001F
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #FXDATA_560000+$60E0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$60E0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Sprite $03C init -- Tap-Tap the Red Nose boss (Tap-Tap the Red Nose's Fort).
; Raiden: init_tap_tap_the_red_nose. See also: ys_boss1.asm, ys_boss2.asm.
;
; See docs/family-taptaps.md for the full Tap-Tap family breakdown (18-state
; boss machine + lava-death cinematic + the smaller $109/$10A/$10B variants
; in Bank0D, plus the variant-encoding via $7402/$7A36 seeding).
;
; INPUTS:
;   M=16 X=16 (sprite-init contract). DBR set to bank $0F by sprite-init trampoline.
;   X = sprite-slot index (`!RAM_YI_Level_NorSpr_*[X]` per-slot fields).
;   $7E:021A = current level ID (determines whether to fire boss-fanfare sound).
;   $7E:7400,x already = $003C (sprite ID stamped by sprite-spawn handler).
; OUTPUTS:
;   $7E:7542,x := 0 (X-velocity cleared); $7E:7720,x := $0018 (Y-acceleration).
;   $7E:6FA2,x := $2280 (SuperFX render-slot priority + tile-allocation flags).
;   $7E:106C/$7E:1072/$7E:1073 := 0 (scratch counters cleared).
;   $7E:7182,x += $0010 (Y-offset so sprite spawns inside the lava bowl).
;   $7E:1064 := $0058 (target X for chase AI); $7E:7A96,x := $0040 (intro timer).
;   $7E:7402,x := $0015 (hp = 21 head-bops to defeat).
;   If level == TapTapTheRedNosesFort: queues SoundID $42 via CODE_0CE5D6 (boss-fanfare).
; MODIFIES: A (16-bit), Y; X preserved (sprite-slot index).
; CALLERS:
;   Bank10 sprite-spawn handler -- via the per-sprite init-pointer table
;   (sprite ID $03C). Spawned via sprite-stream records in fort-6-4 (Tap-Tap's
;   castle) and in test/overworld variants (the tiny Tap-Tap enemy).
;-------------------------------------------------------------------------
YI_NorSpr03C_TapTapTheRedNose_Init:
init_tap_tap_the_red_nose:
;$0F9C0B
	JSL.l CODE_03ADFE
	LDA.w #$0000
	STA.w $7542,x
	LDA.w #$0018
	STA.w $7720,x
	LDA.w #$2280
	STA.w $6FA2,x
	STZ.w $106C
	STZ.w $1072
	STZ.w $1073
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,x
	LDA.w #$0058
	STA.w $1064
	LDA.w #$0040
	STA.w $7A96,x
	LDA.w #$0015
	STA.w $7402,x
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	AND.w #$00FF
	CMP.w #!Define_YI_LevelID_TapTapTheRedNosesFort
	BNE.b CODE_0F9C57
	LDY.b #$42
	JSL.l CODE_0CE5D6
CODE_0F9C57:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Sprite $03C main -- Tap-Tap the Red Nose boss per-frame.
; Raiden: main_tap_tap_the_red_nose.
;
; INPUTS:
;   M=16 X=16 (sprite-main contract); DBR=$0F (set by trampoline).
;   X = sprite-slot index.
;   $7E:7862,x = contact-test result (set by CODE_03AF23 hit-detection):
;     value $18 means Yoshi head-bopped the boss this frame.
;   $7E:105F = current AI state index (0..$11), advanced by state handlers.
;   $7E:1060/1061/1069 = timer countdowns (decremented at top of tick).
;   $7E:1074 = parity bit derived from animation counter.
;   $7E:1015 = death-flag (negative => skip dispatch, branch to CODE_0F9DB6).
; OUTPUTS:
;   Each tick performs animation, gravity, contact, sound, and AI dispatch:
;     - On head-bop ($7862,x == $18): plays SoundID $7A (HurtNepEnut), queues
;       !Define_YI_MusicID_StopMusicCommand to silence music, masks $6FA0/$6FA2
;       to clear SuperFX render flags, sets $105F := $0E (start death sequence).
;     - Else: dispatches to one of 18 handlers via `JMP (DATA_tap_tap_state_ptr,x)`.
;   Sprite kinematics (X/Y in $70E2,x / $7182,x), SuperFX rotation registers,
;     and OAM tiles all updated per state handler.
; MODIFIES: A, Y, X (saved/restored via TXY/TYX); DP $00..$0F.
; CALLERS:
;   Bank10 sprite-main handler -- via per-sprite main-pointer table.
;
; State machine (DATA_tap_tap_state_ptr, 18 entries):
;   $00 init (tiny, doing nothing)            $0A knocked back from egg hit
;   $01 intro: Kamek talking                  $0B initially being egg hit
;   $02 intro: hops up, grows, rotates        $0C falling from egg hit in air
;   $03 intro: centers + falls down           $0D hobbling off-balance after egg hit
;   $04 intro: pauses                         $0E dying: sinking in lava
;   $05 walks forward                         $0F dying: rising in lava (mouth open/close)
;   $06 turns around                          $10 dying: submerging completely
;   $07 prepare to jump                       $11 dead: final explosion -> JML CODE_03A31E (despawn)
;   $08 jumping
;   $09 landed from jump
; Damage routing: $0A..$0D are entered by CODE_raphael_egg_hit_test (hit-test) when an egg
; collides; $0E is entered when hp ($7402,x) hits 0 inside the head-bop path.
;-------------------------------------------------------------------------
YI_NorSpr03C_TapTapTheRedNose_Main:
main_tap_tap_the_red_nose:
;$0F9C58
	SEP.b #$20
	JSR.w CODE_tap_tap_pre_dispatch_oam_setup
	REP.b #$20
	JSL.l CODE_03AF23
	JSR.w CODE_tap_tap_state_dispatch
	SEP.b #$20
	JSR.w CODE_0F9CA2
	LDA.w $7862,x
	CMP.b #$18
	BNE.b CODE_0F9C9F
	LDA.b #!Define_YI_SoundID7A_HurtNepEnut
	JSL.l CODE_push_sound_queue
	LDA.b #!Define_YI_MusicID_StopMusicCommand
	STA.w !RAM_YI_Global_PlayMusicLo
	STZ.w $7862,x
	JSR.w CODE_tap_tap_spawn_lava_splash
	LDA.b #$0E
	STA.w $105F
	REP.b #$20
	LDA.w $6FA0,x
	AND.w #$F9DF
	STA.w $6FA0,x
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
	STZ.w $7542,x
CODE_0F9C9F:
	REP.b #$20
	RTL

CODE_0F9CA2:
	JSR.w CODE_tap_tap_egg_hit_test
	LDA.w $1060
	BEQ.b CODE_0F9CAD
	DEC.w $1060
CODE_0F9CAD:
	LDA.w $1061
	BEQ.b CODE_0F9CB5
	DEC.w $1061
CODE_0F9CB5:
	LDA.w $1069
	BEQ.b CODE_0F9CBD
	DEC.w $1069
CODE_0F9CBD:
	JSR.w CODE_0F9D70
	JSR.w CODE_0F9D9F
	LDA.w $7860,x
	AND.b #$01
	STA.w $1074
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	CMP.b #!Define_YI_LevelID_TapTapTheRedNosesFort
	BEQ.b CODE_0F9CF6
	REP.b #$20
	LDA.w $7182,x
	SEC
	SBC.w !RAM_YI_Global_Layer1YPosLo
	CMP.w #$0120
	BCC.b CODE_0F9CF6
	BMI.b CODE_0F9CF6
	LDA.w !RAM_YI_Global_Layer1YPosLo
	SEC
	SBC.w #$0040
	STA.w $7182,x
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w #$0180
	STA.w $70E2,x
CODE_0F9CF6:
	SEP.b #$20
	RTS

DATA_0F9CF9:
	db $00,$10,$20,$30,$40,$50,$60,$70,$70,$70,$70,$70,$70,$70,$70,$70
	db $70,$70,$70,$70,$70,$70,$70,$70,$70,$70,$70,$70,$70,$70,$70,$70

CODE_0F9D19:
	LDA.w $1071
	BPL.b CODE_0F9D21
	EOR.b #$FF
	INC
CODE_0F9D21:
	TAY
	LDA.w DATA_0F9CF9,y
	STA.w !REGISTER_Multiplicand
	LDA.w $1066
	ASL
	ASL
	BPL.b CODE_0F9D32
	EOR.b #$FF
	INC
CODE_0F9D32:
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	STA.w !REGISTER_HVBlankFlagsAndJoypadStatus
	LDA.w $70E2,x
	SEC
	SBC.b #$78
	BPL.b CODE_0F9D4F
	EOR.b #$FF
	INC
CODE_0F9D4F:
	ASL
	NOP
	STA.w !REGISTER_ProgrammableIOPortInput
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	STA.w !REGISTER_HVBlankFlagsAndJoypadStatus
	LDY.w $1066
	BMI.b CODE_0F9D6B
	EOR.b #$FF
	INC
CODE_0F9D6B:
	NOP #2
	STA.b $00
	RTS

CODE_0F9D70:
	LDA.w $7860,x
	AND.b #$01
	BEQ.b CODE_0F9D9A
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7223,x
	LDA.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	LDY.w $1074
	BEQ.b CODE_0F9D9B
	CMP.w $105D
	BEQ.b CODE_0F9D9A
	BMI.b CODE_0F9D94
	INC.w $105D
	INC.w $105D
	BRA.b CODE_0F9D9A

CODE_0F9D94:
	DEC.w $105D
	DEC.w $105D
CODE_0F9D9A:
	RTS

CODE_0F9D9B:
	STA.w $105D
	RTS

CODE_0F9D9F:
	JSR.w CODE_raphael_egg_hit_test
	TXY
	REP.b #$20
	LDA.w $1015
	BMI.b CODE_0F9DAC
	BNE.b CODE_0F9DB6
CODE_0F9DAC:
	SEP.b #$20
	LDA.w $105F
	ASL
	TAX
	JMP.w (DATA_tap_tap_state_ptr,x)

CODE_0F9DB6:
	SEP.b #$20
	LDA.b #$40
	STA.w $7A96,x
	RTS

CODE_0F9DBE:
	LDA.w $6FA3,x
	AND.b #$FC
	ORA.b #$02
	STA.w $6FA3,x
	RTS

; Tap-Tap the Red Nose state pointer table, indexed by ($16,x)*2.
; Raiden: DATA_tap_tap_state_ptr. 18 entries:
;   $00 init (tiny, doing nothing)            $0A knocked back from egg hit
;   $01 intro: Kamek talking                  $0B initially being egg hit
;   $02 intro: hops up, grows, rotates        $0C falling from egg hit in air
;   $03 intro: centers + falls down           $0D hobbling off-balance after egg hit
;   $04 intro: pauses                         $0E dying: sinking in lava
;   $05 walks forward                         $0F dying: rising in lava (mouth open/close)
;   $06 turns around                          $10 dying: submerging completely
;   $07 prepare to jump                       $11 dead: final explosion
;   $08 jumping
;   $09 landed from jump
DATA_0F9DC9:
DATA_tap_tap_state_ptr:                              ; Raiden alias
	dw CODE_tap_tap_state_intro_idle
	dw CODE_tap_tap_state_intro_kamek_talking
	dw CODE_tap_tap_state_intro_grow_and_rotate
	dw CODE_tap_tap_state_intro_center_and_fall
	dw CODE_tap_tap_state_intro_pause_on_landing
	dw CODE_tap_tap_state_ai_walk_forward
	dw CODE_tap_tap_state_ai_turn_around
	dw CODE_tap_tap_state_ai_prepare_jump
	dw CODE_tap_tap_state_ai_airborne
	dw CODE_tap_tap_state_ai_landed
	dw CODE_tap_tap_state_damaged_knockback
	dw CODE_tap_tap_state_damaged_egg_impact
	dw CODE_tap_tap_state_damaged_falling_air
	dw CODE_tap_tap_state_damaged_hobble
	dw CODE_tap_tap_state_death_sinking_lava
	dw CODE_tap_tap_state_death_rising_lava
	dw CODE_tap_tap_state_death_submerging
	dw CODE_tap_tap_state_death_explode

CODE_0F9DED:
CODE_tap_tap_state_intro_idle:                       ; state $00 -- pre-boss idle; kicks Kamek cinematic when level matches
	TYX
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	CMP.b #!Define_YI_LevelID_TapTapTheRedNosesFort
	BEQ.b CODE_0F9E24
	LDA.b #$06
	STA.w $1063
	STA.w $106D
	STZ.w $7402,x
	LDA.b #$FF
	STA.w $1064
	LDA.b #$40
	STA.w $7542,x
	LDA.b #$40
	STA.w $7A96,x
	LDA.b #$04
	STA.w $105F
	LDA.b #$40
	STA.w $7A96,x
	LDA.b #$81
	STA.w $6FA2,x
	LDA.b #$E8
	STA.w $7041,x
	RTS

CODE_0F9E24:
	LDA.w $7A96,x
	BNE.b CODE_0F9E36
	INC.w $105F
	REP.b #$20
	LDA.w #$0001
	STA.w $1015
	SEP.b #$20
CODE_0F9E36:
	RTS

CODE_0F9E37:
CODE_tap_tap_state_intro_kamek_talking:              ; state $01 -- frozen while Kamek delivers his quip
	TYX
	REP.b #$20
	LDA.w $7A96,x
	BNE.b CODE_0F9E5D
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0018
	STA.w $7542,x
	STZ.w $1015
	SEP.b #$20
	LDA.b #$16
	STA.w $7402,x
	LDA.b #$0C
	STA.w $7A96,x
	INC.w $105F
CODE_0F9E5D:
	SEP.b #$20
	RTS

CODE_0F9E60:
CODE_tap_tap_state_intro_grow_and_rotate:            ; state $02 -- hops up, grows, rotates around center
	TYX
	SEP.b #$20
	LDA.w $7A96,x
	BEQ.b CODE_0F9E87
	CMP.b #$01
	BNE.b CODE_0F9E85
	LDA.w $7182,x
	CLC
	ADC.b #$00
	STA.w $7182,x
	STZ.w $7402,x
	LDA.b #$E8
	STA.w $7041,x
	LDA.b #$12
	STA.w $1063
	JSR.w CODE_tap_tap_state_dispatch
CODE_0F9E85:
	BRA.b CODE_0F9EC5

CODE_0F9E87:
	LDA.w $1064
	CMP.b #$FF
	BEQ.b CODE_0F9E98
	CLC
	ADC.b #$06
	STA.w $1064
	BCS.b CODE_0F9E98
	BRA.b CODE_0F9E9D

CODE_0F9E98:
	LDA.b #$FF
	STA.w $1064
CODE_0F9E9D:
	LDA.w $105D
	CLC
	ADC.b #$08
	STA.w $105D
	BEQ.b CODE_0F9EA9
	RTS

CODE_0F9EA9:
	LDA.b #$FF
	STA.w $7542,x
	LDA.b #$06
	STA.w $1063
	LDA.b #$00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.b #$00
	STA.w $7223,x
	LDA.b #$81
	STA.w $6FA2,x
	INC.w $105F
CODE_0F9EC5:
	RTS

CODE_0F9EC6:
CODE_tap_tap_state_intro_center_and_fall:            ; state $03 -- centers and falls down toward player's platform
	TYX
	SEP.b #$20
	LDA.w $7860,x
	AND.b #$01
	BEQ.b CODE_0F9EF3
	LDA.b #$06
	STA.w $1063
	STA.w $106D
	LDA.b #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	LDA.b #$18
	STA.w $61C6
	LDA.b #$40
	STA.w $7542,x
	LDA.b #$A0
	STA.w $7A96,x
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	INC.w $105F
CODE_0F9EF3:
	RTS

CODE_0F9EF4:
CODE_tap_tap_state_intro_pause_on_landing:           ; state $04 -- pauses on landing, awaits player approach
	TYX
	SEP.b #$20
	LDA.w $7A96,x
	BNE.b CODE_0F9EFF
	JSR.w CODE_0F9FFB
CODE_0F9EFF:
	RTS

DATA_0F9F00:
	db $00,$01,$02,$03,$04,$05,$06,$07,$08,$09,$0A,$0B,$0C,$0D,$0E,$0F

DATA_0F9F10:
	dw $FF00,$0100,$FE80,$0180

DATA_0F9F18:
	db $1F,$1F,$1F,$1F,$20,$20,$20,$20,$20,$20,$20,$20,$1F,$1F,$1F,$1F
	db $1F

CODE_0F9F29:
CODE_tap_tap_state_ai_walk_forward:                  ; state $05 -- chases player X via $1064
	TYX
	LDA.b #$40
	STA.w $7542,x
	JSR.w CODE_0F9DBE
	LDA.w $1061
	BNE.b CODE_0F9F78
	DEC.w $106C
	BPL.b CODE_0F9F78
	LDA.b #$01
	STA.w $106C
	LDA.w $106D
	INC
	AND.b #$0F
	STA.w $106D
	LDY.w $106D
	LDA.w DATA_0F9F00,y
	STA.w $1063
	DEC
	AND.b #$07
	BNE.b CODE_0F9F5B
	JSR.w CODE_0FA006
CODE_0F9F5B:
	LDA.w $1063
	AND.b #$07
	BNE.b CODE_0F9F78
	LDA.b #$0C
	STA.w $61C6
	LDA.b #$10
	STA.w $1061
	LDA.b #!Define_YI_SoundID84_TapTapTheRedNoseWalk
	JSL.l CODE_push_sound_queue
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7221,x
CODE_0F9F78:
	LDA.w $7860,x
	AND.b #$0C
	STA.w $106F
	BNE.b CODE_0F9F8E
	LDA.w $7860,x
	AND.b #$01
	BNE.b CODE_0F9F91
	LDA.w $1074
	BEQ.b CODE_0F9F91
CODE_0F9F8E:
	JMP.w CODE_0F9FCC

CODE_0F9F91:
	LDA.w $1063
	BEQ.b CODE_0F9FA2
	CMP.b #$01
	BEQ.b CODE_0F9FA2
	CMP.b #$0E
	BEQ.b CODE_0F9FA2
	CMP.b #$0F
	BNE.b CODE_0F9FBC
CODE_0F9FA2:
	JSR.w CODE_0FA5FE
	TYA
	CMP.w $7400,x
	BEQ.b CODE_0F9FBD
	LDA.w $0030
	AND.b #$00
	BNE.b CODE_0F9FBC
	LDA.b #$06
	STA.w $105F
	LDA.b #$10
	STA.w $1060
CODE_0F9FBC:
	RTS

CODE_0F9FBD:
	REP.b #$20
	LDA.b $0E
	CLC
	ADC.w #$0050
	CMP.w #$00A0
	SEP.b #$20
	BCS.b CODE_0F9FD3
CODE_0F9FCC:
	LDA.b #$07
	STA.w $105F
	STZ.b $16,x
CODE_0F9FD3:
	RTS

CODE_0F9FD4:
CODE_tap_tap_state_ai_turn_around:                   ; state $06 -- turns around when X overshoots / edge hit
	TYX
	LDA.b #$40
	STA.w $7542,x
	JSR.w CODE_0F9DBE
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7221,x
	LDY.w $1060
	BEQ.b CODE_0F9FFB
	LDA.w DATA_0F9F18,y
	STA.w $1063
	CPY.b #$08
	BNE.b CODE_0F9FFA
	LDA.w $7400,x
	EOR.b #$02
	STA.w $7400,x
CODE_0F9FFA:
	RTS

CODE_0F9FFB:
	LDA.b #$05
	STA.w $105F
	STZ.w $106C
	STZ.w $106D
CODE_0FA006:
	LDY.w $7400,x
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	CMP.b #!Define_YI_LevelID_TapTapTheRedNosesFort
	BEQ.b CODE_0FA014
	INY
	INY
	INY
	INY
CODE_0FA014:
	REP.b #$20
	LDA.w DATA_0F9F10,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	RTS

DATA_0FA01F:
	dw $FE00,$0200,$FF00,$0100

DATA_0FA027:
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F
	db $FF

CODE_0FA058:
CODE_tap_tap_state_ai_prepare_jump:                  ; state $07 -- jump windup animation
	TYX
	LDA.b #$40
	STA.w $7542,x
	JSR.w CODE_0F9DBE
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7221,x
	LDY.b $16,x
	INC.b $16,x
	LDA.w DATA_0FA027,y
	BMI.b CODE_0FA074
	STA.w $1063
	RTS

CODE_0FA074:
	LDA.b #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	LDA.b #$00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.b #$F9
	STA.w $7223,x
	LSR.w $7860,x
	ASL.w $7860,x
	INC.w $105F
	STZ.b $16,x
CODE_0FA08F:
	LDY.w $7400,x
	LDA.w $106F
	BEQ.b CODE_0FA09B
	INY
	INY
	INY
	INY
CODE_0FA09B:
	REP.b #$20
	LDA.w DATA_0FA01F,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	RTS

DATA_0FA0A6:
	db $10,$10,$11,$11,$11,$11,$11,$11,$11,$11,$11,$11,$11,$11,$11,$11
	db $11,$11,$11,$11,$11,$11,$11,$11,$11,$11,$10,$10,$10,$10

CODE_0FA0C4:
CODE_tap_tap_state_ai_airborne:                      ; state $08 -- mid-jump (airborne)
	TYX
	LDA.b #$40
	STA.w $7542,x
	JSR.w CODE_0F9DBE
	LDA.w $7860,x
	AND.b #$0C
	BNE.b CODE_0FA0D7
	JSR.w CODE_0FA08F
CODE_0FA0D7:
	LDY.b $16,x
	CPY.b #$1C
	BCS.b CODE_0FA0DF
	INC.b $16,x
CODE_0FA0DF:
	LDA.w DATA_0FA0A6,y
	STA.w $1063
	LDA.w $7860,x
	AND.b #$01
	BEQ.b CODE_0FA104
	LDA.b #$18
	STA.w $61C6
	LDA.b #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7223,x
	LDA.b #$09
	STA.w $105F
	STZ.b $16,x
CODE_0FA104:
	RTS

DATA_0FA105:
	db $0F,$0F,$0F,$0F,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$FF

CODE_0FA12A:
CODE_tap_tap_state_ai_landed:                        ; state $09 -- landed from jump, resume walk
	TYX
	LDA.b #$40
	STA.w $7542,x
	JSR.w CODE_0F9DBE
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7221,x
	LDY.b $16,x
	INC.b $16,x
	LDA.w DATA_0FA105,y
	BMI.b CODE_0FA146
	STA.w $1063
	RTS

CODE_0FA146:
	JSR.w CODE_0F9FFB
	JSR.w CODE_0F9FA2
	RTS

CODE_0FA14D:
CODE_tap_tap_state_damaged_knockback:                ; state $0A -- knocked back from egg hit
	TYX
	LDA.b #$40
	STA.w $7542,x
	LDA.b #$12
	STA.w $1063
	LDA.w $7860,x
	AND.b #$01
	BNE.b CODE_0FA16E
	LDA.w $7182,x
	CMP.b #$A0
	BCS.b CODE_0FA16E
	LDA.w $1074
	BEQ.b CODE_0FA16E
	JMP.w CODE_0FA279

CODE_0FA16E:
	LDA.w $1073
	CLC
	ADC.w $1072
	STA.w $1073
	LDY.w $1060
	BNE.b CODE_0FA18E
	LDA.w $1073
	CMP.b #$00
	BNE.b CODE_0FA18E
CODE_0FA184:
	STZ.w $1073
	STZ.b $16,x
	LDA.b #$0C
	STA.w $105F
CODE_0FA18E:
	RTS

DATA_0FA18F:
	db $16,$16,$16,$16,$15,$15,$15,$15,$14,$14,$14,$14,$12,$12,$12,$12
	db $12,$12,$12,$12,$12,$12,$12,$12,$12,$12,$12,$12,$12,$12,$12,$12
	db $12,$12,$12,$12,$12,$12,$12,$12,$FF

CODE_0FA1B8:
CODE_tap_tap_state_damaged_egg_impact:               ; state $0B -- initial egg-hit impact frame
	TYX
	LDA.b #$40
	STA.w $7542,x
	JSR.w CODE_0FA5CE
	NOP #6
	LDY.b $16,x
	INC.b $16,x
	LDA.w DATA_0FA18F,y
	BMI.b CODE_0FA1D4
	STA.w $1063
	RTS

CODE_0FA1D4:
	JMP.w CODE_0FA184

DATA_0FA1D7:
	db $12,$12,$12,$12,$12,$12,$12,$12,$12,$12,$12,$12,$12,$12,$12,$12
	db $12,$12,$12,$12,$13,$13,$13,$13,$13,$13,$13,$13,$13,$13,$12,$12
	db $12,$12,$13,$13,$13,$13,$13,$13,$13,$13,$13,$13,$14,$14,$14,$14
	db $15,$15,$15,$15,$16,$16,$16,$16,$00,$00,$00,$00,$0F,$0F,$0F,$0F
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$FF

DATA_0FA22C:
	dw $0000,$0000

CODE_0FA230:
CODE_tap_tap_state_damaged_falling_air:              ; state $0C -- falling after egg hit in air
	TYX
	LDA.b #$40
	STA.w $7542,x
	JSR.w CODE_0FA5CE
	NOP #6
	LDY.b $16,x
	INC.b $16,x
	LDA.w DATA_0FA1D7,y
	BMI.b CODE_0FA275
	STA.w $1063
	CPY.b #$30
	BNE.b CODE_0FA25F
	LDA.b #$80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.b #$FD
	STA.w $7223,x
	LSR.w $7860,x
	ASL.w $7860,x
CODE_0FA25F:
	CPY.b #$2C
	BCC.b CODE_0FA274
	CPY.b #$38
	BCS.b CODE_0FA274
	LDY.w $7400,x
	REP.b #$20
	LDA.w DATA_0FA22C,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
CODE_0FA274:
	RTS

CODE_0FA275:
	JSR.w CODE_0F9FFB
	RTS

CODE_0FA279:
	LDA.b #$0D
	STA.w $105F
	STZ.b $16,x
	RTS

DATA_0FA281:
	db $17,$17,$18,$18,$19,$19,$19,$19,$1A,$1A,$1A,$1A,$19,$19,$19,$19
	db $1A,$1A,$1A,$1A,$19,$19,$19,$19,$1A,$1A,$1A,$1A,$19,$19,$19,$19
	db $1A,$1A,$1A,$1A,$19,$19,$19,$19,$1A,$1A,$1A,$1A,$19,$19,$19,$19
	db $1A,$1A,$1A,$1A,$19,$19,$19,$19,$1A,$1A,$1A,$1A,$19,$19,$19,$19
	db $1A,$1A,$1A,$1A,$19,$19,$19,$19,$1A,$1A,$1A,$1A,$19,$19,$19,$19
	db $1A,$1A,$1A,$1A,$19,$19,$19,$19,$1A,$1A,$1A,$1A,$19,$19,$19,$19
	db $1A,$1A,$1A,$1A,$19,$19,$19,$19,$1A,$1A,$1A,$1A,$19,$19,$19,$19
	db $1A,$1A,$1A,$1A,$19,$19,$19,$19,$1A,$1A,$1A,$1A,$19,$19,$19,$19
	db $1A,$1A,$1A,$1A,$19,$19,$19,$19,$18,$18,$18,$18,$17,$17,$17,$17
	db $FF

DATA_0FA312:
	dw $0100,$FF00,$0100

CODE_0FA318:
CODE_tap_tap_state_damaged_hobble:                   ; state $0D -- hobbling off-balance after egg hit
	TYX
	LDA.w $6FA3,x
	AND.b #$FC
	STA.w $6FA3,x
	LDA.w $1073
	BNE.b CODE_0FA36A
	LDA.b $16,x
	LSR
	LSR
	NOP #4
	ASL
	AND.b #$02
	CLC
	ADC.w $7400,x
	TAY
	REP.b #$20
	LDA.w DATA_0FA312,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	SEP.b #$20
	LDY.b $16,x
	INC.b $16,x
	LDA.w DATA_0FA281,y
	BPL.b CODE_0FA352
	JMP.w CODE_0F9FFB

CODE_0FA352:
	PHA
	LDA.b #$00
	LDY.w $1072
	BMI.b CODE_0FA35C
	LDA.b #$02
CODE_0FA35C:
	PLY
	CMP.w $7400,x
	BNE.b CODE_0FA366
	INY
	INY
	INY
	INY
CODE_0FA366:
	STY.w $1063
	RTS

CODE_0FA36A:
	CLC
	ADC.w $1072
	STA.w $1073
	LDA.b #$12
	STA.w $1063
	RTS

DATA_0FA377:
	dw $0080,$FF80

DATA_0FA37B:
	dw $FF60,$FF80,$FF70,$FF80

CODE_0FA383:
CODE_tap_tap_state_death_sinking_lava:               ; state $0E -- sinking in lava (head-bop kill entry)
	TYX
	LDA.b #$12
	STA.w $1063
	LDA.w $7182,x
	CMP.b #$D0
	BCC.b CODE_0FA398
	INC.w $105F
	LDA.b #$60
	STA.w $7A96,x
CODE_0FA398:
	LDA.w $1073
	BEQ.b CODE_0FA3A4
	CLC
	ADC.w $1072
	STA.w $1073
CODE_0FA3A4:
	LDY.b #$01
	LDA.w $0030
	BIT.b #$03
	BNE.b CODE_0FA3BB
	AND.b #$20
	BEQ.b CODE_0FA3B3
	LDY.b #$FF
CODE_0FA3B3:
	TYA
	CLC
	ADC.w $105D
	STA.w $105D
CODE_0FA3BB:
	REP.b #$20
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $0030
	LSR
	LSR
	NOP #3
	AND.w #$0002
	TAY
	LDA.w DATA_0FA377,y
	CLC
	ADC.w #$0040
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0FA3D6:
CODE_tap_tap_per_frame_lava_anim:                    ; per-frame lava shimmer / palette animation for tap_tap death states
	REP.b #$20
	LDA.w $0030
	AND.w #$0003
	BNE.b CODE_0FA444
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$FFE0
	STA.b $00
	ASL
	ASL
	NOP
	STA.b $02
	LDA.b $10
	AND.w #$0003
	ASL
	TAY
	LDA.w DATA_0FA37B,y
	STA.b $04
	LDA.w #!Define_YI_AmbSpr1C7
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	CLC
	ADC.b $00
	STA.w $70A2,y
	LDA.w #$07C0
	STA.w $7142,y
	LDA.b $02
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $04
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0030
	STA.w $7782,y
	LDA.w #!Define_YI_AmbSpr1D9
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	CLC
	ADC.b $00
	STA.w $70A2,y
	LDA.w #$07C0
	STA.w $7142,y
	LDA.w #$000C
	STA.w $7782,y
	LDA.w #$0002
	STA.w $7E4C,y
CODE_0FA444:
	SEP.b #$20
	JSR.w CODE_0FA558
	RTS

DATA_0FA44A:
	dw $FFF0,$FFF4,$FFF8,$FFFC,$0004,$0008,$000C,$0010
	dw $FFEE,$FFF2,$FFF6,$FFFA,$0006,$000A,$000E,$0012

DATA_0FA46A:
	dw $FF00,$FF40,$FF80,$FFC0,$0040,$0080,$00C0,$0100
	dw $FF20,$FF60,$FFA0,$FFE0,$0020,$0060,$00A0,$00E0

DATA_0FA48A:
	dw $FE20,$FE00,$FE40,$FE10,$FDF0,$FDF8,$FE30,$FE60
	dw $FE58,$FE28,$FDF0,$FDE8,$FE08,$FE38,$FDF8,$FE18

DATA_0FA4AA:
	dw $0030,$0030,$0030,$0030,$0030,$0030,$0030,$0030
	dw $0030,$0030,$0030,$0030,$0030,$0030,$0030,$0030

CODE_0FA4CA:
CODE_tap_tap_spawn_lava_splash:                      ; spawns 30 lava-splash ambient sprites ($1C7) on tap-tap death
	REP.b #$20
	LDA.w $70E2,x
	STA.b $00
	LDA.w #$001E
	STA.b $08
CODE_0FA4D6:
	LDA.w #!Define_YI_AmbSpr1C7
	JSL.l CODE_spawn_ambient_sprite
	LDX.b $08
	LDA.b $00
	CLC
	ADC.w DATA_0FA44A,x
	STA.w $70A2,y
	LDA.w #$07C0
	STA.w $7142,y
	LDA.w DATA_0FA46A,x
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w DATA_0FA48A,x
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w DATA_0FA4AA,x
	STA.w $7782,y
	LDA.w #$0020
	STA.w $7502,y
	LDX.b $12
	DEC.b $08
	DEC.b $08
	BPL.b CODE_0FA4D6
	SEP.b #$20
	RTS

DATA_0FA511:
	dw $0080,$FF00

CODE_0FA515:
CODE_tap_tap_state_death_rising_lava:                ; state $0F -- rising in lava (mouth open/close convulsions)
	TYX
	JSR.w CODE_tap_tap_per_frame_lava_anim
	LDA.w $7A96,x
	BNE.b CODE_0FA521
	INC.w $105F
CODE_0FA521:
	LDY.b #$12
	LDA.w $0030
	AND.b #$18
	BEQ.b CODE_0FA52B
	INY
CODE_0FA52B:
	STY.w $1063
	LDY.b #$01
	LDA.w $0030
	BIT.b #$00
	BNE.b CODE_0FA545
	AND.b #$08
	BEQ.b CODE_0FA53D
	LDY.b #$FF
CODE_0FA53D:
	TYA
	CLC
	ADC.w $105D
	STA.w $105D
CODE_0FA545:
	REP.b #$20
	LDA.w $0030
	LSR
	LSR
	NOP #2
	AND.w #$0002
	TAY
	LDA.w DATA_0FA511,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0FA558:
	SEP.b #$20
	LDA.w $0030
	AND.b #$1F
	BNE.b CODE_0FA567
	LDA.b #!Define_YI_SoundID62_MelonBugBump
	JSL.l CODE_push_sound_queue
CODE_0FA567:
	RTS

DATA_0FA568:
	db $FF,$01

CODE_0FA56A:
CODE_tap_tap_state_death_submerging:                 ; state $10 -- submerging completely
	TYX
	JSR.w CODE_tap_tap_per_frame_lava_anim
	LDA.b #$40
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7223,x
	LDA.w $0030
	AND.b #$03
	BNE.b CODE_0FA58C
	LDA.w $7400,x
	LSR
	TAY
	LDA.w DATA_0FA568,y
	CLC
	ADC.w $1073
	STA.w $1073
CODE_0FA58C:
	LDA.w $7183,x
	CMP.b #$08
	BCC.b CODE_0FA5BB
	LDA.b #$11
	STA.w $105F
	LDA.b #$20
	STA.w $7A96,x
	REP.b #$20
	JSL.l CODE_02A982
	LDA.w $70E2,x
	CLC
	ADC.w #$0000
	STA.b $00
	LDA.w $7182,x
	CLC
	ADC.w #$0000
	STA.b $02
	JSL.l CODE_02E19C
	SEP.b #$20
CODE_0FA5BB:
	JSR.w CODE_0FA558
	RTS

CODE_0FA5BF:
CODE_tap_tap_state_death_explode:                    ; state $11 -- final explosion then JML to sprite-despawn
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0FA5CD
	REP.b #$20
	JSL.l CODE_despawn_sprite_free_slot
	SEP.b #$20
CODE_0FA5CD:
	RTS

CODE_0FA5CE:
	REP.b #$20
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_0FA5E1
	BPL.b CODE_0FA5DD
	CLC
	ADC.w #$0010
	BRA.b CODE_0FA5E1

CODE_0FA5DD:
	SEC
	SBC.w #$0010
CODE_0FA5E1:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	RTS

CODE_0FA5E7:
	REP.b #$20
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_0FA5FA
	BPL.b CODE_0FA5F6
	CLC
	ADC.w #$0002
	BRA.b CODE_0FA5FA

CODE_0FA5F6:
	SEC
	SBC.w #$0002
CODE_0FA5FA:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_0FA5FE:
	REP.b #$20
	LDY.b #$00
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.b $0E
	BPL.b CODE_0FA60F
	LDY.b #$02
CODE_0FA60F:
	SEP.b #$20
	RTS

DATA_0FA612:
	db $F8,$08

DATA_0FA614:
	dw $0100,$FF00,$0200,$FE00,$0100,$FF00,$0200,$FE00

CODE_0FA624:
CODE_tap_tap_egg_hit_test:                           ; egg-hit collision test; routes accepted hits into damage states
	REP.b #$20
	LDY.w $7D36,x
	DEY
	BPL.b CODE_0FA62F
CODE_0FA62C:
	JMP.w CODE_0FA6D0

CODE_0FA62F:
	LDA.w $1069
	BNE.b CODE_0FA62C
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0FA62C
	LDA.w $7D38,y
	BEQ.b CODE_0FA62C
	LDA.w $7542,y
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	ASL
	SEP.b #$20
	LDY.b #$00
	BCC.b CODE_0FA651
	INY
CODE_0FA651:
	LDA.b #$0B
	STA.w $105F
	STZ.b $16,x
	LDA.w DATA_0FA612,y
	STA.w $1072
	ROR
	EOR.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	BPL.b CODE_0FA666
	INY
	INY
CODE_0FA666:
	LDA.b $00
	CMP.b #$00
	BNE.b CODE_0FA675
	INY
	INY
	INY
	INY
	LDA.b #$0A
	STA.w $105F
CODE_0FA675:
	TYA
	ASL
	TAY
	REP.b #$20
	LDA.w DATA_0FA614,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.w $7860,x
	AND.b #$01
	BNE.b CODE_0FA6B5
	LDY.w $7D36,x
	DEY
	REP.b #$20
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ASL
	PHP
	PHP
	ROR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLP
	ROR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLP
	ROR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.b #$FE
	STA.w $7223,x
	LSR.w $7860,x
	ASL.w $7860,x
CODE_0FA6B5:
	LDA.b #!Define_YI_SoundID2E_ClankSound7
	JSL.l CODE_push_sound_queue
	LDA.b #$20
	STA.w $1069
	REP.b #$20
	LDY.w $7D36,x
	DEY
	TYX
	STZ.w $7D38,x
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
CODE_0FA6D0:
	SEP.b #$20
	RTS

DATA_0FA6D3:
	dw FXDATA_550000+$4081,FXDATA_550000+$40A1,FXDATA_550000+$6081,FXDATA_550000+$60A1

CODE_0FA6DB:
CODE_tap_tap_state_dispatch:                         ; main combat dispatch: $105F * 2 -> JMP (DATA_tap_tap_state_ptr,x)
	REP.b #$20
	LDA.w $7402,x
	BNE.b CODE_0FA71A
	LDA.w $0030
	AND.w #$0001
	BNE.b CODE_0FA703
	LDA.b $D9,x
	AND.w #$000F
	ASL
	STA.b $02
	LDA.w #$0040
	STA.b $00
	LDA.w $105D
	CLC
	ADC.w $1073
	JSR.w CODE_0FA71D
	BRA.b CODE_0FA71A

CODE_0FA703:
	LDA.w #$0006
	STA.b $02
	LDA.w #$0060
	STA.b $00
	LDA.w $105E
	CLC
	ADC.w $1073
	JSR.w CODE_0FA71D
	JSR.w CODE_0FA75B
CODE_0FA71A:
	SEP.b #$20
	RTS

CODE_0FA71D:
	LDY.w $7400,x
CODE_0FA720:
	BEQ.b CODE_0FA726
	EOR.w #$00FF
	INC
CODE_0FA726:
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $1064
	INC
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.b $02
	LDA.w DATA_0FA6D3,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$4081)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.b $00
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTS

CODE_0FA75B:
	LDY.w $1073
	TYA
	CLC
	ADC.w $105D
	LDY.w $7400,x
	BEQ.b CODE_0FA76C
	EOR.w #$00FF
	INC
CODE_0FA76C:
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $1064
	INC
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.b $02
	LDA.w #FXDATA_550000+$00C1
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$00C1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08881C>>16
	LDA.w #FXCODE_08881C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTS

DATA_0FA79F:
	db $B0,$98,$05,$F7,$B0,$98,$09,$F5,$B0,$98,$0A,$F2,$B0,$98,$0D,$EF
	db $B0,$98,$0F,$EC,$B0,$98,$11,$E9,$B0,$98,$17,$E9,$B1,$98,$18,$E8
	db $B0,$98,$17,$E9,$B0,$98,$17,$EE,$B0,$98,$F0,$14,$B0,$98,$12,$F4
	db $B0,$98,$10,$F7,$B0,$98,$0C,$F9,$B0,$98,$05,$F8,$B0,$98,$06,$F6
	db $B0,$98,$06,$F9,$B0,$98,$09,$FD,$B0,$98,$DF,$D7,$B0,$98,$DF,$D7
	db $B0,$98,$E6,$DB,$B0,$98,$F0,$E2,$B0,$98,$FB,$EE,$B0,$98,$12,$FB
	db $B0,$98,$1C,$FB,$B0,$98,$29,$03,$B0,$98,$29,$02,$B0,$98,$06,$EC
	db $B0,$98,$03,$E0,$B0,$98,$02,$D9,$B0,$98,$FD,$D6,$AC,$98,$10,$F0
	db $A0,$98,$17,$E9

DATA_0FA823:
	db $17,$0A,$19,$1A,$17,$0A,$1D,$18,$17,$0A,$1F,$1A,$17,$0A,$20,$19
	db $17,$0A,$22,$1B,$17,$0A,$20,$1C,$17,$0A,$1F,$1F,$17,$0A,$1E,$1E
	db $17,$0A,$1E,$1E,$17,$0A,$1C,$20,$17,$0A,$21,$1B,$17,$0A,$19,$20
	db $17,$0A,$19,$20,$17,$0A,$1A,$1E,$17,$0A,$19,$1A,$17,$0A,$17,$18
	db $17,$0A,$20,$20,$17,$0A,$24,$25,$17,$0A,$13,$1A,$17,$0A,$13,$1A
	db $17,$0A,$14,$1A,$17,$0A,$16,$1A,$17,$0A,$19,$1B,$17,$0A,$1D,$1E
	db $17,$0A,$1C,$23,$17,$0A,$20,$26,$17,$0A,$1E,$25,$17,$0A,$1F,$1D
	db $17,$0A,$23,$1E,$17,$0A,$25,$1B,$17,$0A,$26,$1F,$13,$0A,$1C,$1C
	db $0C,$0A,$1E,$1E

DATA_0FA8A7:
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $03,$06,$1A,$1A,$1C,$1D,$1F,$02,$05,$09,$08,$03,$06,$08,$07,$00
	db $00

DATA_0FA8C8:
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$01,$02,$02,$02,$02,$02,$02,$02,$02,$02,$02,$02,$02,$00
	db $00

CODE_0FA8E9:
CODE_tap_tap_pre_dispatch_oam_setup:                 ; sets up sprite OAM frame index from $1063 before state dispatch
	LDA.w $7402,x
	BEQ.b CODE_0FA8EF
CODE_0FA8EE:
	RTS

CODE_0FA8EF:
	LDA.w $7363,x
	BMI.b CODE_0FA8EE
	LDY.w $1063
	LDA.w DATA_0FA8C8,y
	STA.b $D9,x
	LDA.w DATA_0FA8A7,y
	ASL
	ASL
	ASL
	LDY.w $7400,x
	BEQ.b CODE_0FA90A
	EOR.b #$FF
	INC
CODE_0FA90A:
	CLC
	ADC.w $105D
	STA.w $105E
	LDA.b #$03
	STA.b $0A
CODE_0FA915:
	LDA.w $1063
	ASL
	ASL
	CLC
	ADC.b $0A
	TAY
	LDA.w DATA_0FA823,y
	STA.w !REGISTER_Multiplicand
	PHX
	LDX.w $1064
	INX
	STX.w !REGISTER_Multiplier
	BEQ.b CODE_0FA938
	NOP #2
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
CODE_0FA938:
	STA.b $0E
	PLX
	LDA.w DATA_0FA79F,y
	LDY.w $7400,x
	BEQ.b CODE_0FA946
	EOR.b #$FF
	INC
CODE_0FA946:
	STA.b $00
	JSR.w CODE_0FA9BD
	DEC.b $0A
	BPL.b CODE_0FA915
	LDY.w $1063
	LDA.w DATA_0FA99C,y
	CLC
	ADC.b #$00
	PHA
	BPL.b CODE_0FA95E
	EOR.b #$FF
	INC
CODE_0FA95E:
	STA.b $0E
	LDA.w $105D
	CLC
	ADC.b #$80
	STA.b $0C
	JSR.w CODE_0FB91A
	PLY
	REP.b #$20
	LDA.b $02
	CPY.b #$00
	BPL.b CODE_0FA978
	EOR.w #$FFFF
	INC
CODE_0FA978:
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $00
	CPY.b #$00
	BPL.b CODE_0FA985
	EOR.w #$FFFF
	INC
CODE_0FA985:
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7362,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_09A02A>>16
	LDA.w #FXCODE_09A02A
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	LDX.b $12
	RTS

DATA_0FA99C:
	db $00,$03,$05,$05,$07,$04,$01,$00,$00,$04,$06,$06,$06,$05,$00,$FE
	db $02,$04,$00,$00,$00,$00,$00,$06,$0E,$0F,$0E,$06,$0E,$0F,$0E,$00
	db $00

CODE_0FA9BD:
	LDA.w $105D
	CLC
	ADC.w $1073
	CLC
	ADC.b $00
	STA.b $0C
	LSR
	LSR
	LSR
	LSR
	LSR
	AND.b #$06
	TAX
	JMP.w (DATA_0FA9D4,x)

DATA_0FA9D4:
	dw CODE_0FA9DC
	dw CODE_0FAA22
	dw CODE_0FAA6B
	dw CODE_0FAAB7

CODE_0FA9DC:
	LDA.b $0C
	AND.b #$3F
	TAY
	LDA.w DATA_0FBA89,y
	STA.w !REGISTER_Multiplicand
	LDA.b $0E
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	STA.b $00
	LDA.b $0C
	AND.b #$3F
	STA.b $0F
	LDA.b #$40
	SEC
	SBC.b $0F
	TAY
	LDA.w DATA_0FBA89,y
	STA.w !REGISTER_Multiplicand
	LDA.b $0E
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	STA.b $02
	JMP.w CODE_0FAB04

CODE_0FAA22:
	LDA.b $0C
	AND.b #$3F
	TAY
	LDA.w DATA_0FBA89,y
	STA.w !REGISTER_Multiplicand
	LDA.b $0E
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	STA.b $02
	LDA.b $0C
	AND.b #$3F
	STA.b $0F
	LDA.b #$40
	SEC
	SBC.b $0F
	TAY
	LDA.w DATA_0FBA89,y
	STA.w !REGISTER_Multiplicand
	LDA.b $0E
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	EOR.b #$FF
	INC
	STA.b $00
	JMP.w CODE_0FAB04

CODE_0FAA6B:
	LDA.b $0C
	AND.b #$3F
	TAY
	LDA.w DATA_0FBA89,y
	STA.w !REGISTER_Multiplicand
	LDA.b $0E
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	EOR.b #$FF
	INC
	STA.b $00
	LDA.b $0C
	AND.b #$3F
	STA.b $0F
	LDA.b #$40
	SEC
	SBC.b $0F
	TAY
	LDA.w DATA_0FBA89,y
	STA.w !REGISTER_Multiplicand
	LDA.b $0E
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	EOR.b #$FF
	INC
	STA.b $02
	JMP.w CODE_0FAB04

CODE_0FAAB7:
	LDA.b $0C
	AND.b #$3F
	TAY
	LDA.w DATA_0FBA89,y
	STA.w !REGISTER_Multiplicand
	LDA.b $0E
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	EOR.b #$FF
	INC
	STA.b $02
	LDA.b $0C
	AND.b #$3F
	STA.b $0F
	LDA.b #$40
	SEC
	SBC.b $0F
	TAY
	LDA.w DATA_0FBA89,y
	STA.w !REGISTER_Multiplicand
	LDA.b $0E
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	STA.b $00
	JMP.w CODE_0FAB04

DATA_0FAB00:
	db $00,$48,$08,$28

CODE_0FAB04:
	LDX.b $12
	STZ.b $01
	LDA.b $00
	BPL.b CODE_0FAB0E
	DEC.b $01
CODE_0FAB0E:
	STZ.b $03
	LDA.b $02
	BPL.b CODE_0FAB16
	DEC.b $03
CODE_0FAB16:
	STZ.b $0B
	LDA.b $0A
	REP.b #$30
	AND.w #$000F
	TAY
	CPY.w #$0001
	BCC.b CODE_0FAB54
	LDA.w $7400,x
	AND.w #$00FF
	BEQ.b CODE_0FAB54
	LDA.w DATA_0FAB00,y
	AND.w #$00FF
	CLC
	ADC.w $7362,x
	TAY
	LDA.w $6000,y
	CLC
	ADC.b $02
	CLC
	ADC.w #$0000
	STA.w $6000,y
	STA.w $6010,y
	CLC
	ADC.w #$FFF0
	STA.w $6008,y
	STA.w $6018,y
	BRA.b CODE_0FAB79

CODE_0FAB54:
	LDA.w DATA_0FAB00,y
	AND.w #$00FF
	CLC
	ADC.w $7362,x
	TAY
	LDA.w $6000,y
	CLC
	ADC.b $02
	STA.w $6000,y
	LDX.b $0A
	BEQ.b CODE_0FAB79
	STA.w $6010,y
	CLC
	ADC.w #$0010
	STA.w $6008,y
	STA.w $6018,y
CODE_0FAB79:
	LDA.w $6002,y
	CLC
	ADC.b $00
	STA.w $6002,y
	LDX.b $0A
	BEQ.b CODE_0FAB93
	STA.w $600A,y
	CLC
	ADC.w #$0010
	STA.w $6012,y
	STA.w $601A,y
CODE_0FAB93:
	LDA.b $12
	AND.w #$00FF
	TAX
	LDY.w $7362,x
	LDA.w $1064
	AND.w #$00FF
	SEC
	SBC.w #$0050
	LSR
	LSR
	LSR
	LSR
	ASL
	TAX
	LDA.w $6004,y
	AND.w #$FF00
	ORA.w DATA_0FABBD,x
	STA.w $6004,y
	SEP.b #$30
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

DATA_0FABBD:
	dw $0008,$0008,$0008,$0008,$000A,$000A,$000A,$000A
	dw $000C,$000C,$000E

ADDR_0FABD3:
	REP.b #$20
	SEP.b #$10
;---------------------------------------------------------------------------
; Sprite $05A init -- Raphael Spark Attack (the spark projectiles he summons).
; Raiden: init_raph_spark. See also: ys_boss2.asm.
;---------------------------------------------------------------------------
YI_NorSpr05A_RaphaelSparkAttack_Init:
init_raph_spark:
	RTL

;---------------------------------------------------------------------------

DATA_0FABD8:
	dw $0003,$FFFD

DATA_0FABDC:
	db $00,$00,$00,$00,$04,$04,$04,$04,$FF

;---------------------------------------------------------------------------
; Sprite $05A main -- Raphael Spark per-frame. Raiden: main_raph_spark.
;---------------------------------------------------------------------------
YI_NorSpr05A_RaphaelSparkAttack_Main:
main_raph_spark:
;$0FABE5
	JSL.l CODE_03AF23
	SEP.b #$20
	LDA.b #$47
	STA.l $000051
	LDA.w $7A38,x
	BEQ.b CODE_0FAC0F
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w DATA_0FABDC,y
	BMI.b CODE_0FAC52
	STA.w $7402,x
	LDA.w $7040,x
	AND.b #$FC
	STA.w $7040,x
	REP.b #$20
	RTL

CODE_0FAC0F:
	LDY.w $7400,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	CLC
	ADC.w DATA_0FABD8,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	STA.b $00
	LDA.b #$38
	STA.b $0E
	JSR.w CODE_0FB8F8
	LDA.w $0030
	AND.b #$03
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	STA.w $7402,x
	LDA.w $0030
	AND.b #$00
	BNE.b CODE_0FAC4C
	LDA.w $7A36,x
	CLC
	ADC.b #$01
	STA.w $7A36,x
	CMP.b #$80
	BCC.b CODE_0FAC4C
	INC.w $7A38,x
CODE_0FAC4C:
	JSR.w CODE_raphael_egg_hit_test
	REP.b #$20
	RTL

CODE_0FAC52:
	REP.b #$20
	JSL.l CODE_03A31E
	RTL

DATA_0FAC59:
	dw $FFF8,$0008

DATA_0FAC5D:
	dw $FFF0,$0010

CODE_0FAC61:
CODE_raphael_spawn_spark_volley:                     ; fires 3 spark sprites ($05A) per attack via spawn-secondary helper
	SEP.b #$20
	LDA.w $1062
	PHA
	REP.b #$20
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	LDA.w #$0018
	STA.w $61C6
	SEP.b #$20
	STZ.w $1062
	JSR.w CODE_0FAC8B
	LDA.b #$02
	STA.w $1062
	JSR.w CODE_0FAC8B
	PLA
	STA.w $1062
	RTS

CODE_0FAC8B:
	REP.b #$20
	LDA.w #$005A
	JSL.l CODE_spawn_sprite_active
	SEP.b #$20
	BCC.b CODE_0FACAE
	LDA.w $105D
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w $1062
	STA.w $7400,y
	LDA.b #$00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.b #$05
	STA.w $74A2,y
CODE_0FACAE:
	REP.b #$20
	LDA.w #$005A
	JSL.l CODE_spawn_sprite_active
	SEP.b #$20
	BCC.b CODE_0FACE5
	LDX.w $1062
	TXA
	STA.w $7400,y
	LDA.w $105D
	CLC
	ADC.w DATA_0FAC59,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.b #$00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.w $7040,y
	AND.b #$FC
	STA.w $7040,y
	LDA.b #$06
	STA.w $74A2,y
	LDA.b #$04
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LDX.b $12
CODE_0FACE5:
	REP.b #$20
	LDA.w #$005A
	JSL.l CODE_spawn_sprite_active
	SEP.b #$20
	BCC.b CODE_0FAD1C
	LDX.w $1062
	TXA
	STA.w $7400,y
	LDA.w $105D
	CLC
	ADC.w DATA_0FAC5D,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.b #$04
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.w $7040,y
	AND.b #$FC
	STA.w $7040,y
	LDA.b #$07
	STA.w $74A2,y
	LDA.b #$06
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LDX.b $12
CODE_0FAD1C:
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Sprite $00C init -- Raphael the Raven boss (W6 castle).
; Raiden: init_raphael. See also: ys_boss2.asm. See docs/bossengine.md §7.1.
; Delegates to a shared sub at CODE_raphael_seed_init which seeds:
;   - 4 Raphael-specific SRAM tracks ($60A8/B4/B5 spark-spawn flags, $0CF9 GSU counter)
;   - $7402,x = $0001 (alive-flag for branching in main); $18,x = 0 (init phase=0)
;   - Moon-stomp camera mode setup if header LevelMode==9.
;
; INPUTS:
;   M=16 X=16 (sprite-init contract). DBR=$0F.
;   X = sprite-slot index. Sprite ID $00C stamped in $7E:7400,x.
;   $7E:0146 (!RAM_YI_Level_LevelHeaderLevelModeLo) = 9 in 5-8 (Raphael's castle).
; OUTPUTS:
;   Per-slot scratch initialized as documented above (via CODE_raphael_seed_init).
;   $7E:1015 cleared (alive flag). State byte $18,x = 0 (entering init-phase state $00).
;   Player-state hint at $7E:60A8 / $7E:60B4 cleared so spark spawns can fire later.
; MODIFIES: A, Y (16-bit each), DP $00..$0F; X preserved.
; CALLERS:
;   Bank10 sprite-spawn handler -- via per-sprite init-pointer table (sprite ID $00C).
;   Only spawned in 5-8 RaphaelTheRavensCastle level via sprite-stream records.
;-------------------------------------------------------------------------
YI_NorSpr00C_RaphaelTheRaven_Init:
init_raphael:
;$0FAD1F
	JSR.w CODE_raphael_seed_init
	RTL

;---------------------------------------------------------------------------

DATA_0FAD23:
	dw FXDATA_550000+$0081,FXDATA_550000+$00C1

;-------------------------------------------------------------------------
; Sprite $00C main -- Raphael the Raven per-frame. Raiden: main_raphael.
; See also: ys_boss2.asm. See docs/bossengine.md §7.1 for the Mode-7 details.
;
; INPUTS:
;   M=16 X=16; DBR=$0F. X = sprite-slot index.
;   $7E:0146 (!RAM_YI_Level_LevelHeaderLevelModeLo) -- value $0009 means we're
;     in the moon-stomp camera; routes through CODE_raphael_set_rotation_player_pos (Raphael camera tick).
;   $7E:7402,x = alive-flag (0 = init phase, !=0 = combat AI).
;   $7E:1015 = death-state flag (negative => skip dispatch).
;   $7E:0030 = global frame counter (used as random source for animation/flicker).
;   $7E:1060 / $7E:1064 / $7E:1065 / $7E:1066 = state-machine timers.
;   $7E:105F = current state index (0..$14 in combat, 0..$09 in pre-fight).
;   $7E:105C/$7E:105D/$7E:1063 = Raphael's polar coordinates (angle/radius) on the moon.
;   FX-blob constant tables: DATA_0FAD23 (scaling pairs), DATA_0FADC0.
; OUTPUTS:
;   Each tick:
;     - If init phase ($7402,x == 0): seeds SuperFX R3/R5/R6/R11/R12/R13 and kicks
;       FXCODE_088B49 (Raphael rotate-scale render).
;     - Else: calls CODE_0FADC4 (SuperFX FX-blob 088205) for the combat render.
;     - Calls CODE_03AF23 (hit-test + egg-collide), then:
;       - LevelMode==9: CODE_raphael_main_state_dispatch_outer (moon-camera AI), dispatches via DATA_raphael_main_ptr.
;       - Else: CODE_0FAE12 (intro-cinematic AI), dispatches via DATA_raphael_init_ptr.
;   Per-state handlers update $105C/$105D (Raphael polar pos), $105F (state),
;     timers, spark-spawn flags ($60A8/$60B4 lower bits), and OAM tiles.
; MODIFIES: A, Y; X preserved across dispatch via TXY/TYX pairs.
; CALLERS:
;   Bank10 sprite-main handler -- per-sprite main-pointer table.
;
; The two state machines are documented at their respective ptr tables below:
;   DATA_raphael_init_ptr -- 10 entries for pre-fight cinematic.
;   DATA_raphael_main_ptr -- 21 entries for combat / damaged / death.
;-------------------------------------------------------------------------
YI_NorSpr00C_RaphaelTheRaven_Main:
main_raphael:
;$0FAD27
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.w #$0009
	BNE.b CODE_0FAD33
	JSL.l CODE_raphael_set_rotation_player_pos
CODE_0FAD33:
	LDA.w $7402,x
	BEQ.b CODE_0FAD4A
	LDA.w $7040,x
	AND.w #$07FF
	ORA.w #$2000
	STA.w $7040,x
	JSL.l CODE_03AA52
	BRA.b CODE_0FAD4E

CODE_0FAD4A:
	JSL.l CODE_03AB1C
CODE_0FAD4E:
	LDA.w $7402,x
	BNE.b CODE_0FADA9
	LDA.w $105E
	LDY.w $7400,x
	BEQ.b CODE_0FAD5F
	EOR.w #$00FF
	INC
CODE_0FAD5F:
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $1064
	AND.w #$00FF
	INC
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $1065
	AND.w #$00FF
	INC
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDY.b #$00
	LDA.w DATA_0FAD23,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$0081)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088B49>>16
	LDA.w #FXCODE_088B49
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	BRA.b CODE_0FADAC

CODE_0FADA9:
	JSR.w CODE_0FADC4
CODE_0FADAC:
	JSL.l CODE_03AF23
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.w #$0009
	BNE.b CODE_0FADBC
	JSR.w CODE_raphael_main_state_dispatch_outer
	RTL

CODE_0FADBC:
	JSR.w CODE_0FAE12
	RTL

DATA_0FADC0:
	dw FXDATA_550000+$4080,FXDATA_550000+$40A0

CODE_0FADC4:
	LDA.w $105E
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w $106E
	LSR
	LSR
	AND.w #$0002
	TAY
	LDA.w DATA_0FADC0,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$4080)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTS

CODE_0FAE12:
	LDA.w $1015
	BMI.b CODE_raphael_init_state_dispatch
	BNE.b CODE_0FAE21
CODE_0FAE19:
CODE_raphael_init_state_dispatch:                    ; selector: A = $18,x * 2; JMP (DATA_raphael_init_ptr,x)
	LDA.b $18,x
	ASL
	TXY
	TAX
	JMP.w (DATA_raphael_init_ptr,x)

CODE_0FAE21:
	LDA.w #$0040
	STA.w $7A96,x
	LDA.w $1070
	BNE.b CODE_0FAE4C
	LDY.b #$5C
CODE_0FAE2E:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr048_CutsceneKamek
	BNE.b CODE_0FAE4D
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	BEQ.b CODE_0FAE4D
	LDA.w $7A98,y
	CMP.w #$0030
	BCC.b CODE_0FAE4C
	LDA.w #$0002
	STA.w $7A98,y
	STA.w $1070
CODE_0FAE4C:
	RTS

CODE_0FAE4D:
	DEY
	DEY
	DEY
	DEY
	BPL.b CODE_0FAE2E
	RTS

; Raphael "init" (pre-fight cinematic) state pointer table.
; Raiden: DATA_raphael_init_ptr. 10 entries:
;   $00 walking down the right wall            $05 trembling, about to grow
;   $01 rotating at the corner                 $06 growing + doing a flip
;   $02 walking left toward Yoshi              $07 stomping on ground
;   $03 pausing                                $08 lunging at Yoshi
;   $04 waiting on Kamek                       $09 stop, wait for Yoshi to fly offscreen
DATA_0FAE54:
DATA_raphael_init_ptr:                               ; Raiden alias
	dw CODE_raphael_state_init_walk_down_wall
	dw CODE_raphael_state_init_rotate_corner
	dw CODE_raphael_state_init_walk_left_to_yoshi
	dw CODE_raphael_state_init_pause_anticipation
	dw CODE_raphael_state_init_wait_for_kamek
	dw CODE_raphael_state_init_tremble_pre_grow
	dw CODE_raphael_state_init_grow_and_flip
	dw CODE_raphael_state_init_stomp_ground
	dw CODE_raphael_state_init_lunge
	dw CODE_raphael_state_init_wait_yoshi_offscreen

CODE_0FAE68:
CODE_raphael_state_init_walk_down_wall:              ; state $00 -- descending the right wall into the arena
	TYX
	INC.w $106E
	INC.w $106E
	LDA.w $7A96,x
	BNE.b CODE_0FAE87
	LDA.w #$0200
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7182,x
	CMP.w #$048E
	BCC.b CODE_0FAE87
	INC.b $18,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0FAE87:
	RTS

CODE_0FAE88:
CODE_raphael_state_init_rotate_corner:               ; state $01 -- rotating at the corner of the arena
	TYX
	SEP.b #$20
	INC.w $106E
	INC.w $106E
	LDA.w $105E
	SEC
	SBC.b #$08
	STA.w $105E
	BNE.b CODE_0FAE9E
	INC.b $18,x
CODE_0FAE9E:
	REP.b #$20
	RTS

CODE_0FAEA1:
CODE_raphael_state_init_walk_left_to_yoshi:          ; state $02 -- walking left toward Yoshi
	TYX
	INC.w $106E
	INC.w $106E
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $70E2,x
	AND.w #$00FF
	CMP.w #$00A0
	BCS.b CODE_0FAECA
	LDA.w #$00FF
	STA.w $106E
	INC.b $18,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7A96,x
CODE_0FAECA:
	RTS

CODE_0FAECB:
CODE_raphael_state_init_pause_anticipation:          ; state $03 -- pausing (anticipation beat)
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0FAEDA
	INC.b $18,x
	LDA.w #$0001
	STA.w $1015
	RTS

CODE_0FAEDA:
	SEP.b #$20
	REP.b #$20
	LDA.w $7182,x
	CMP.w #$048E
	BCC.b CODE_0FAEF2
	LDA.w #$048E
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
CODE_0FAEF2:
	RTS

CODE_0FAEF3:
CODE_raphael_state_init_wait_for_kamek:              ; state $04 -- waiting on Kamek to finish exposition
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0FAF23
	SEP.b #$20
	INC.b $18,x
	LDA.w $7182,x
	CLC
	ADC.b #$10
	STA.w $7182,x
	LDA.b #$40
	STA.w $7A96,x
	STZ.w $7402,x
	REP.b #$20
	LDA.w $7040,x
	AND.w #$07FF
	ORA.w #$8000
	STA.w $7040,x
	JSL.l CODE_03AB1C
	STZ.w $1015
CODE_0FAF23:
	RTS

CODE_0FAF24:
CODE_raphael_state_init_tremble_pre_grow:            ; state $05 -- trembling, about to grow
	TYX
	SEP.b #$20
	LDA.w $7A96,x
	BNE.b CODE_0FAF43
	LDA.b #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	INC.b $18,x
	LDA.b #$C0
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.b #$FC
	STA.w $7223,x
	LDA.b #$18
	STA.w $7542,x
CODE_0FAF43:
	AND.b #$03
	BNE.b CODE_0FAF52
	LDA.w $1064
	EOR.b #$08
	STA.w $1064
	STA.w $1065
CODE_0FAF52:
	REP.b #$20
	RTS

DATA_0FAF55:
	db $80,$84,$88,$8C,$90,$94,$98,$9C,$A0,$98,$94,$90,$8C,$88,$84,$84

DATA_0FAF65:
	db $A0,$98,$94,$90,$8C,$88,$84,$84,$80,$84,$88,$8C,$90,$94,$98,$9C

CODE_0FAF75:
CODE_raphael_state_init_grow_and_flip:               ; state $06 -- growing + doing a flip (sprite scale animation)
	TYX
	SEP.b #$20
	LDA.w $105E
	CLC
	ADC.b #$08
	STA.w $105E
	LDA.b $D6,x
	CMP.b #$80
	BEQ.b CODE_0FAFB3
	CLC
	ADC.b #$04
	STA.b $D6,x
	LDA.w $0030
	NOP #4
	AND.b #$0F
	TAY
	LDA.w DATA_0FAF55,y
	CLC
	ADC.b $D6,x
	BCC.b CODE_0FAFA0
	LDA.b #$FF
CODE_0FAFA0:
	STA.w $1064
	LDA.w DATA_0FAF65,y
	CLC
	ADC.b $D6,x
	BCC.b CODE_0FAFAD
	LDA.b #$FF
CODE_0FAFAD:
	STA.w $1065
	REP.b #$20
	RTS

CODE_0FAFB3:
	LDA.b #$FF
	STA.w $1064
	STA.w $1065
	STZ.w $105E
	REP.b #$20
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $18,x
	LDA.w #$0020
	STA.w $7A96,x
	RTS

CODE_0FAFCF:
CODE_raphael_state_init_stomp_ground:                ; state $07 -- pre-fight final stomp
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0FB004
	LDA.w #$0800
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7182,x
	CMP.w #$0493
	BCC.b CODE_0FB004
	LDA.w #$0493
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	INC.b $18,x
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	LDA.w #$0018
	STA.w $61C6
CODE_0FB004:
	RTS

CODE_0FB005:
CODE_raphael_state_init_lunge:                       ; state $08 -- lunging at Yoshi
	TYX
	SEP.b #$20
	LDA.w $0030
	NOP #3
	AND.b #$07
	TAY
	LDA.w DATA_0FB48D,y
	STA.w $1064
	LDA.w DATA_0FB495,y
	STA.w $1065
	REP.b #$20
	LDY.w $7A96,x
	BNE.b CODE_0FB004
	LDA.w $0030
	AND.w #$0001
	BNE.b CODE_0FB05C
	LDA.w #!Define_YI_AmbSpr1DF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	CLC
	ADC.w #$0010
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0012
	STA.w $7142,y
	LDA.w #$0005
	STA.w $7E4C,y
	STA.w $73C2,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w #$0000
	STA.w $7462,y
CODE_0FB05C:
	LDA.w #$FB80
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.w $7D36,x
	BPL.b CODE_0FB0B3
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_PlayerState1E_PushedAwayByRaphael
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	JSL.l CODE_03BFF7
	LDA.w #$FC00
	STA.w $60A8
	LDA.w #$FE00
	STA.w $60AA
	INC.b $18,x
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr1E6
	JSL.l CODE_spawn_ambient_sprite
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0008
	STA.w $70A2,y
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0008
	STA.w $7142,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w #$0007
	STA.w $73C2,y
	STA.w $7E4C,y
CODE_0FB0B3:
	RTS

CODE_0FB0B4:
CODE_raphael_state_init_wait_yoshi_offscreen:        ; state $09 -- stop, wait for Yoshi to fly offscreen
	TYX
	RTS

CODE_0FB0B6:
CODE_raphael_seed_init:                              ; delegate from raphael Init: clears spark flags + GSU counter, arms SuperFX
	REP.b #$20
	JSL.l CODE_03ADFE
	SEP.b #$20
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.b #$09
	BEQ.b CODE_0FB0FD
	LDA.b #$40
	STA.w $105E
	LDA.b #$7F
	STA.w $1064
	STA.w $1065
	STZ.b $D6,x
	STZ.w $1070
	STZ.w $1071
	LDA.b #$04
	STA.w $7402,x
	LDA.b #$40
	STA.w $7A96,x
	REP.b #$20
	STZ.w $60C4
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w $7182,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	JSR.w CODE_0FADC4
	RTS

CODE_0FB0FD:
	SEP.b #$20
	LDA.b #$80
	STA.w $105D
	STA.w $105E
	LDA.b #$07
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.b #$60
	STA.w $105C
	LDA.b #$50
	STA.w $1064
	STA.w $1065
	LDA.b #$00
	STA.b $D9,x
	DEC
	STA.b $76,x
	STZ.b $77,x
	LDA.b #$80
	STA.w $1068
	REP.b #$20
	LDA.w #$0140
	STA.w $70E2,x
	LDA.w $6FA0,x
	AND.w #$C7FF
	STA.w $6FA0,x
	JSL.l CODE_0CDB4D
	RTS

CODE_0FB13D:
	LDA.b #$42
	STA.w $105C
	LDA.b #$FF
	STA.w $1064
	STA.w $1065
	RTS

CODE_0FB14B:
CODE_raphael_main_state_dispatch_outer:              ; combat-Main: $76,x doubled -> JSR (DATA_raphael_main_ptr,x)
	SEP.b #$20
	LDA.w $1068
	CMP.b #$80
	BEQ.b CODE_0FB15F
	BCS.b CODE_0FB15C
	INC.w $1068
	INC.w $1068
CODE_0FB15C:
	DEC.w $1068
CODE_0FB15F:
	LDA.w $60A0
	CMP.w $1068
	BEQ.b CODE_0FB16F
	BCS.b CODE_0FB16B
	INC
	INC
CODE_0FB16B:
	DEC
	STA.w $60A0
CODE_0FB16F:
	LDA.b $D6,x
	BEQ.b CODE_0FB175
	DEC.b $D6,x
CODE_0FB175:
	AND.b #$02
	CLC
	ADC.w $60A0
	STA.w $60A0
	LDA.w $1062
	STA.w $7400,x
	LDA.w $1060
	BEQ.b CODE_0FB18C
	DEC.w $1060
CODE_0FB18C:
	LDA.w $1061
	BEQ.b CODE_0FB194
	DEC.w $1061
CODE_0FB194:
	JSR.w CODE_raphael_main_state_dispatch
	LDA.w $105C
	CLC
	ADC.w $1074
	STA.b $0E
	STZ.w $1074
	JSR.w CODE_0FB905
	JSR.w CODE_0FB22F
	JSR.w CODE_0FB1E6
	REP.b #$20
	RTS

CODE_0FB1AF:
	LDA.b $76,x
	CMP.b #$FF
	BEQ.b CODE_0FB1BE
	TYA
	CLC
	ADC.b $76,x
	STA.b $76,x
	BCS.b CODE_0FB1BE
	RTS

CODE_0FB1BE:
	LDA.b #$FF
	STA.b $76,x
	LDA.b $16,x
	ASL
	TAY
	LDA.w DATA_0FB21B,y
	STA.b $00
	LDA.w DATA_0FB21B+$01,y
	STA.b $01
	LDA.b #DATA_5FE58C>>16
	STA.b $02
	PHX
	LDX.b #$00
	TXY
CODE_0FB1D8:
	LDA.b [$00],y
	STA.l $702F2E,x
	INY
	INX
	CPX.b #$1E
	BNE.b CODE_0FB1D8
	PLX
	RTS

CODE_0FB1E6:
	REP.b #$20
	LDA.b $16,x
	ASL
	TAY
	LDA.w DATA_0FB21B,y
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_5FE58C>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.b $76,x
	AND.w #$00FF
	INC
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$00E1
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08E167>>16
	LDA.w #FXCODE_08E167
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$30
	LDX.b $12
	RTS

DATA_0FB21B:
	dw DATA_5FE58C,DATA_5FE5AA,DATA_5FE5C8,DATA_5FE5E6,DATA_5FE604,DATA_5FE622,DATA_5FE6DA,DATA_5FE6F8
	dw DATA_5FE716,DATA_5FE734

CODE_0FB22F:
	LDA.w $093C
	AND.b #$10
	BRA.b CODE_0FB242

CODE_0FB236:
	LDA.b #$00
	STA.b $16,x
	JSR.w CODE_raphael_seed_init
	SEP.b #$20
	STZ.w $105F
CODE_0FB242:
	RTS

CODE_0FB243:
CODE_raphael_egg_hit_test:                           ; intra-bank hit test; routes accepted hits into damage states $0A..$0D
	REP.b #$20
	LDY.w $7D36,x
	BPL.b CODE_0FB24E
	JSL.l CODE_03A858
CODE_0FB24E:
	SEP.b #$20
	RTS

CODE_0FB251:
	REP.b #$20
	JSL.l CODE_0F9388
	SEP.b #$20
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.b #$0E
	BNE.b CODE_0FB281
	LDA.b #$10
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.b #$0C
	STA.w $105F
	LDA.b #!Define_YI_SoundID34_BurtJump
	JSL.l CODE_push_sound_queue
	LDA.b #$20
	STA.w $7A96,x
	LDA.b #$00
	STA.w $60AA
	LDA.b #$FC
	STA.w $60AB
	PLA
	PLA
CODE_0FB281:
	RTS

; Raphael "main" AI state pointer table. Raiden: DATA_raphael_main_ptr.
; 21 entries grouped into beginning-cinematic, main, attack, damaged, death:
;   beginning cinematics:
;     $00 Yoshi flying up to moon              $01 Yoshi falling onto initial platform
;     $02 camera pans down, Raphael moving bg  $03 flying up to moon
;     $04 turning around
;   main sequence:
;     $05 moving forward                       $06 stomping down on moon
;     $07 turning around to choose direction   $08 preparing to move
;   attack sequence:
;     $09 hopping up to initiate attack        $0A pounding down + shooting flames
;   damaged states:
;     $0B damaged from stake ground-pound      $0C stunned (Yoshi head-bopped)
;   death cinematics:
;     $0D final stake pound, dying             $0E turning slightly from death spot
;     $0F rotating/scaling back to sky         $10 rotating/fading into twinkle
;     $11 twinkle fades out                    $12 star forms
;     $13 constellation fade-in                $14 done with fight, final state
DATA_0FB282:
DATA_raphael_main_ptr:                               ; Raiden alias
	dw CODE_raphael_state_main_intro_yoshi_to_moon
	dw CODE_raphael_state_main_intro_yoshi_landing
	dw CODE_raphael_state_main_intro_camera_pan
	dw CODE_raphael_state_main_intro_fly_to_moon
	dw CODE_raphael_state_main_intro_turn_around
	dw CODE_raphael_state_main_move_forward
	dw CODE_raphael_state_main_stomp_creates_sparks
	dw CODE_raphael_state_main_turn_to_choose_dir
	dw CODE_raphael_state_main_prepare_move
	dw CODE_raphael_state_main_attack_hop_up
	dw CODE_raphael_state_main_attack_pound_shoot
	dw CODE_raphael_state_main_damaged_stake_pound
	dw CODE_raphael_state_main_damaged_stunned
	dw CODE_raphael_state_main_death_final_pound
	dw CODE_raphael_state_main_death_turn_from_spot
	dw CODE_raphael_state_main_death_rotate_to_sky
	dw CODE_raphael_state_main_death_fade_to_twinkle
	dw CODE_raphael_state_main_death_twinkle_fade_out
	dw CODE_raphael_state_main_death_star_forming
	dw CODE_raphael_state_main_death_constellation_fade_in
	dw CODE_raphael_state_main_done_wait_for_exit

CODE_0FB2AC:
CODE_raphael_main_state_dispatch:                    ; combat selector with $0D07 egg-hit gate + $105D angle damage check
	LDA.w $0D07
	BEQ.b CODE_0FB311
	STZ.w $0D07
	LDA.w $105D
	CLC
	ADC.w $0D05
	CLC
	ADC.b #$80
	CLC
	ADC.b #$0E
	CMP.b #$1C
	BCS.b CODE_0FB311
	LDA.w $105C
	CMP.b #$44
	BCS.b CODE_0FB311
	LDA.b #!Define_YI_SoundID78_HurtBoss
	JSL.l CODE_push_sound_queue
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.b #$01
	BNE.b CODE_0FB2FA
	LDA.b #$0D
	STA.w $105F
	LDA.b #$A0
	STA.w $1060
	LDA.b #$A0
	STA.w $1061
	REP.b #$20
	LDA.w #!Define_YI_PlayerState02_InCutscene
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $617A
	STZ.w $617C
	SEP.b #$20
	BRA.b CODE_0FB311

CODE_0FB2FA:
	LDA.b #$0B
	STA.w $105F
	LDA.b #$08
	STA.w $106C
	LDA.b #$A0
	STA.w $1065
	STZ.w $1060
	LDA.b #$18
	STA.w $1061
CODE_0FB311:
	TXY
	LDA.w $105F
	ASL
	TAX
	JMP.w (DATA_raphael_main_ptr,x)

CODE_0FB31A:
CODE_raphael_state_main_intro_yoshi_to_moon:         ; state $00 -- camera intro: Yoshi flying up to moon
	TYX
	LDA.w $0030
	LSR
	LSR
	LSR
	LSR
	AND.b #$01
	STA.w $1063
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.b #!Define_YI_PlayerState20_EnteringRaphaelBossRoom
	BEQ.b CODE_0FB336
	INC.w $105F
	LDA.b #$50
	STA.w $1060
CODE_0FB336:
	RTS

CODE_0FB337:
CODE_raphael_state_main_intro_yoshi_landing:         ; state $01 -- Yoshi falling onto initial platform
	TYX
	LDA.w $0030
	LSR
	LSR
	LSR
	LSR
	AND.b #$01
	STA.w $1063
	LDA.w $1060
	BNE.b CODE_0FB362
	LDA.b #$01
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w $60A8
	STZ.w $60A9
	STZ.w $60B4
	STZ.w $60B5
	INC.w $105F
	LDA.b #$A0
	STA.w $1060
CODE_0FB362:
	RTS

CODE_0FB363:
CODE_raphael_state_main_intro_camera_pan:            ; state $02 -- camera pans down; Raphael moving in background
	TYX
	JSR.w CODE_0FB40E
	LDA.w $1060
	BEQ.b CODE_0FB37D
	CMP.b #$30
	BCC.b CODE_0FB37C
	AND.b #$0F
	BNE.b CODE_0FB37C
	LDA.w $1062
	EOR.b #$02
	STA.w $1062
CODE_0FB37C:
	RTS

CODE_0FB37D:
	INC.w $105F
	LDA.b #$00
	STA.w $1066
	LDA.b #$50
	STA.w $1060
	LDA.b #!Define_YI_SoundID89_FallingToMoon
	JSL.l CODE_push_sound_queue
	RTS

CODE_0FB391:
CODE_raphael_state_main_intro_fly_to_moon:           ; state $03 -- flying up to the moon (player's POV)
	TYX
	JSR.w CODE_0FB40E
	LDA.w $0030
	AND.b #$03
	BEQ.b CODE_0FB3A5
	LDA.b $76,x
	BEQ.b CODE_0FB3A5
	SEC
	SBC.b #$01
	STA.b $76,x
CODE_0FB3A5:
	LDA.w $0030
	LSR
	LSR
	LSR
	AND.b #$01
	STA.w $1063
	LDA.w $0030
	AND.b #$07
	BNE.b CODE_0FB3BA
	INC.w $1066
CODE_0FB3BA:
	JSR.w CODE_0FB3EC
	LDA.w $1060
	AND.b #$01
	BNE.b CODE_0FB3D2
	LDA.w $1064
	CMP.b #$F8
	BEQ.b CODE_0FB3D2
	INC
	STA.w $1064
	STA.w $1065
CODE_0FB3D2:
	LDA.w $105D
	AND.b #$FE
	CMP.b #$7E
	BNE.b CODE_0FB3EB
	LDA.b #$80
	STA.w $105D
	INC.w $105F
	LDA.b #$30
	STA.w $1060
	STZ.w $106C
CODE_0FB3EB:
	RTS

CODE_0FB3EC:
	LDA.w $1066
	ASL
	ASL
	ASL
	ASL
	CLC
	ADC.w $1067
	STA.w $1067
	LDA.w $1066
	PHP
	LSR
	LSR
	LSR
	LSR
	PLP
	BPL.b CODE_0FB407
	ORA.b #$F0
CODE_0FB407:
	ADC.w $105D
	STA.w $105D
	RTS

CODE_0FB40E:
	REP.b #$20
	LDA.w $7182,x
	SEC
	SBC.w #$00B8
	LSR
	LSR
	NOP #2
	CLC
	ADC.w #$0076
	STA.w $1068
	SEP.b #$20
	RTS

CODE_0FB425:
CODE_raphael_state_main_intro_turn_around:           ; state $04 -- turning around (Raphael's POV)
	TYX
	JSR.w CODE_0FB40E
	LDA.b $D9,x
	AND.b #$FE
	CMP.b #$80
	BEQ.b CODE_0FB437
	CLC
	ADC.b #$08
	STA.b $D9,x
	RTS

CODE_0FB437:
	STA.b $D9,x
	LDA.w $1060
	BNE.b CODE_0FB455
	LDA.w $105C
	CLC
	ADC.w $106C
	STA.w $105C
	DEC.w $106C
	DEC.w $106C
	LDA.w $105C
	CMP.b #$42
	BCC.b CODE_0FB456
CODE_0FB455:
	RTS

CODE_0FB456:
	JSR.w CODE_0FB4E0
	LDA.b #$80
	STA.w $1060
	LDA.b #$80
	STA.b $D9,x
	LDA.b #$20
	STA.b $D6,x
	LDA.b #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	PHX
	LDX.b #$00
CODE_0FB46F:
	LDA.l DATA_5FE6DA,x
	STA.l $702F2E,x
	INX
	CPX.b #$1E
	BNE.b CODE_0FB46F
	PLX
	LDA.b #$FF
	STA.b $76,x
	LDA.b #$06
	STA.b $16,x
	JSR.w CODE_0FB13D
	RTS

DATA_0FB489:
	db $01,$00,$FF,$00

DATA_0FB48D:
	db $FF,$F0,$E0,$D0,$D0,$E0,$F0,$FF

DATA_0FB495:
	db $E8,$F0,$F8,$FF,$FF,$F8,$F0,$E8

DATA_0FB49D:
	db $FD,$FE,$FF,$00,$00,$FF,$FE,$FD

CODE_0FB4A5:
CODE_raphael_state_main_move_forward:                ; state $05 -- moving forward
	TYX
	JSR.w CODE_0FB251
	LDY.b #$08
	JSR.w CODE_0FB1AF
	LDA.w $106C
	BPL.b CODE_0FB4BA
	LDA.w $105C
	CMP.b #$43
	BCC.b CODE_0FB4CC
CODE_0FB4BA:
	LDA.w $105C
	CLC
	ADC.w $106C
	STA.w $105C
	CMP.b #$43
	BCC.b CODE_0FB4CC
	DEC.w $106C
	RTS

CODE_0FB4CC:
	LDA.b #$42
	STA.w $105C
	LDA.w $1060
	BNE.b CODE_0FB4EB
	LDA.w $105D
	CLC
	ADC.b #$00
	AND.b #$1F
	BNE.b CODE_0FB4EB
CODE_0FB4E0:
	LDA.b #$14
	STA.w $1060
	LDA.b #$06
	STA.w $105F
	RTS

CODE_0FB4EB:
	LDA.w $105D
	NOP #3
	AND.b #$07
	TAY
	LDA.w DATA_0FB48D,y
	STA.w $1064
	LDA.w DATA_0FB495,y
	STA.w $1065
	LDA.w DATA_0FB49D,y
	STA.w $1074
	LDY.w $1062
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.b #$07
	BEQ.b CODE_0FB518
	AND.w $0030
	BNE.b CODE_0FB518
	JSR.w CODE_0FB518
CODE_0FB518:
	LDA.w $105D
	CLC
	ADC.w DATA_0FB489,y
	STA.w $105D
	RTS

CODE_0FB523:
CODE_raphael_state_main_stomp_creates_sparks:        ; state $06 -- stomping down on the moon (creates spark hazards)
	TYX
	JSR.w CODE_0FB251
	JSR.w CODE_0FB65A
	LDA.w $1060
	BNE.b CODE_0FB53B
	INC.w $105F
	LDA.b $10
	AND.b #$30
	ADC.b #$40
	STA.w $1060
CODE_0FB53B:
	RTS

CODE_0FB53C:
CODE_raphael_state_main_turn_to_choose_dir:          ; state $07 -- turning around to choose direction
	TYX
	JSR.w CODE_0FB251
	JSR.w CODE_0FB65A
	LDA.w $1060
	BEQ.b CODE_0FB578
	CMP.b #$28
	BNE.b CODE_0FB568
	LDA.w $105E
	CLC
	ADC.b #$40
	BMI.b CODE_0FB568
	LDA.w $105E
	ASL
	ROL
	ROL
	AND.b #$02
	EOR.b #$02
	STA.w $1062
	LDA.b #$08
	STA.w $106C
	BRA.b CODE_0FB578

CODE_0FB568:
	LDA.w $1060
	AND.b #$0F
	BNE.b CODE_0FB577
	LDA.w $1062
	EOR.b #$02
	STA.w $1062
CODE_0FB577:
	RTS

CODE_0FB578:
	INC.w $105F
	LDA.b #$14
	STA.w $1060
	RTS

CODE_0FB581:
CODE_raphael_state_main_prepare_move:                ; state $08 -- preparing to move (decision tick)
	TYX
	JSR.w CODE_0FB251
	JSR.w CODE_0FB65A
	LDY.b #$10
	JSR.w CODE_0FB1AF
	LDA.w $1060
	BNE.b CODE_0FB5C3
	LDA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	BNE.b CODE_0FB5AF
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	NOP #2
	STA.b $00
	LDA.b $10
	AND.b $00
	BNE.b CODE_0FB5AF
	LDA.b #$09
	STA.w $105F
	LDA.b #$08
	STA.w $106C
	RTS

CODE_0FB5AF:
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
CODE_0FB5B5:
	LDA.b #$05
	STA.w $105F
	LDA.b $10
	AND.b #$7F
	ADC.b #$80
	STA.w $1060
CODE_0FB5C3:
	RTS

DATA_0FB5C4:
	db $D0,$D6,$DC,$E2,$E8,$EE,$F4,$FF

DATA_0FB5CC:
	db $FF,$F4,$EE,$E8,$E2,$DC,$D6,$D0

CODE_0FB5D4:
CODE_raphael_state_main_damaged_stake_pound:         ; state $0B -- damaged from stake ground-pound
	TYX
	LDA.w $1061
	LSR
	AND.b #$02
	ORA.b #$2C
	STA.w $7042,x
	LDA.w $1060
	BEQ.b CODE_0FB5FB
	CMP.b #$01
	BEQ.b CODE_0FB60F
	NOP #2
	AND.b #$07
	TAY
	LDA.w DATA_0FB5C4,y
	STA.w $1064
	LDA.w DATA_0FB5CC,y
	STA.w $1065
	RTS

CODE_0FB5FB:
	JSR.w CODE_0FB65A
	LDA.w $105C
	CMP.b #$42
	BNE.b CODE_0FB60E
	LDA.b #$30
	STA.w $1060
	JSR.w CODE_0FB13D
	RTS

CODE_0FB60E:
	RTS

CODE_0FB60F:
	LSR.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $77,x
	LDY.b $77,x
	LDA.w DATA_0FB6A1,y
	STA.b $16,x
	STZ.b $76,x
	JSR.w CODE_0FB13D
	JMP.w CODE_0FB4E0

DATA_0FB623:
	dw $E8E4,$F0EC,$F8F4,$FFFC

DATA_0FB62B:
	dw $FCFF,$F4F8,$ECF0,$E4E8

CODE_0FB633:
CODE_raphael_state_main_damaged_stunned:              ; state $0C -- stunned after Yoshi head-bopped him while flipped
	TYX
	JSR.w CODE_0FB251
	JSR.w CODE_0FB65A
	LDA.w $7A96,x
	BNE.b CODE_0FB64A
	LDA.b #$FF
	STA.w $1064
	STA.w $1065
	JMP.w CODE_0FB4E0

CODE_0FB64A:
	AND.b #$07
	TAY
	LDA.w DATA_0FB623,y
	STA.w $1064
	LDA.w DATA_0FB62B,y
	STA.w $1065
	RTS

CODE_0FB65A:
	LDA.w $105C
	CLC
	ADC.w $106C
	STA.w $105C
	DEC.w $106C
	DEC.w $106C
	LDA.w $105C
	CMP.b #$42
	BCS.b CODE_0FB679
	LDA.b #$42
	STA.w $105C
	STZ.w $106C
CODE_0FB679:
	RTS

CODE_0FB67A:
CODE_raphael_state_main_attack_hop_up:               ; state $09 -- hopping up to initiate attack
	TYX
	JSR.w CODE_0FB251
	JSR.w CODE_0FB65A
	LDA.w $105C
	CMP.b #$42
	BNE.b CODE_0FB693
	JSR.w CODE_raphael_spawn_spark_volley
	INC.w $105F
	LDA.b #$40
	STA.w $1060
CODE_0FB693:
	RTS

CODE_0FB694:
CODE_raphael_state_main_attack_pound_shoot:          ; state $0A -- pounding down + shooting flames (spawns spark sprites)
	TYX
	JSR.w CODE_0FB251
	LDA.w $1060
	BNE.b CODE_0FB6A0
	JSR.w CODE_0FB5B5
CODE_0FB6A0:
	RTS

DATA_0FB6A1:
	db $06,$08,$09,$09,$09,$09,$09,$09

DATA_0FB6A9:
	db $A0,$AC,$B8,$C4,$D0,$DC,$E8,$FF,$FF,$E8,$DC,$D0,$C4,$B8,$AC,$A0

DATA_0FB6B9:
	db $FF,$E8,$DC,$D0,$C4,$B8,$AC,$A0,$A0,$AC,$B8,$C4,$D0,$DC,$E8,$FF

CODE_0FB6C9:
CODE_raphael_state_main_death_final_pound:           ; state $0D -- final stake pound, dying
	TYX
	JSR.w CODE_0FB40E
	LDA.w $1060
	BNE.b CODE_0FB6E6
	INC.w $105F
	STZ.b $76,x
	LDA.b #$01
	STA.b $16,x
	LDA.b #$30
	STA.w $1066
	LDA.b #!Define_YI_SoundID82_BossFalling
	JSL.l CODE_push_sound_queue
CODE_0FB6E6:
	LDA.b $D9,x
	CLC
	ADC.b #$00
	STA.b $D9,x
	LDA.w $1061
	LSR
	AND.b #$02
	ORA.b #$2C
	STA.w $7042,x
	LDA.w $1060
	AND.b #$0F
	TAY
	LDA.w DATA_0FB6A9,y
	STA.w $1064
	LDA.w DATA_0FB6B9,y
	STA.w $1065
	LDA.w $1060
	CMP.b #$9C
	BNE.b CODE_0FB732
	REP.b #$20
	LDA.w $70E2,x
	CLC
	ADC.w #$0000
	STA.b $00
	LDA.w $7182,x
	CLC
	ADC.w #$0000
	STA.b $02
	JSL.l CODE_02A982
	LDA.w #$FFFF
	JSL.l CODE_02E1A6
	SEP.b #$20
CODE_0FB732:
	RTS

CODE_0FB733:
CODE_raphael_state_main_death_turn_from_spot:        ; state $0E -- turning slightly from death spot
	TYX
	JSR.w CODE_0FB40E
	LDA.w $1064
	CMP.b #$FE
	BCS.b CODE_0FB744
	INC.w $1064
	INC.w $1064
CODE_0FB744:
	JSR.w CODE_0FB3EC
	LDA.w $105D
	AND.b #$FC
	CMP.b #$D8
	BNE.b CODE_0FB758
	INC.w $105F
	LDA.b #$30
	STA.w $1061
CODE_0FB758:
	INC.b $D9,x
	INC.b $D9,x
	LDA.w $0030
	AND.b #$01
	BNE.b CODE_0FB76D
	LDA.w $105C
	CMP.b #$60
	BEQ.b CODE_0FB76D
	INC.w $105C
CODE_0FB76D:
	RTS

CODE_0FB76E:
CODE_raphael_state_main_death_rotate_to_sky:         ; state $0F -- rotating/scaling back up to the sky
	TYX
	JSR.w CODE_0FB40E
	JSR.w CODE_0FB758
	LDA.w $1064
	CMP.b #$40
	BEQ.b CODE_0FB785
	SEC
	SBC.b #$01
	STA.w $1064
	STA.w $1065
CODE_0FB785:
	LDA.w $0030
	AND.b #$01
	BNE.b CODE_0FB794
	LDA.b $76,x
	CMP.b #$A0
	BEQ.b CODE_0FB794
	INC.b $76,x
CODE_0FB794:
	JSR.w CODE_0FB3EC
	LDA.w $0030
	AND.b #$03
	BNE.b CODE_0FB7A8
	LDA.w $1066
	CMP.b #$04
	BCC.b CODE_0FB7A8
	DEC.w $1066
CODE_0FB7A8:
	LDA.w $105D
	LDY.w $1061
	BNE.b CODE_0FB7BC
	AND.b #$FE
	CMP.b #$04
	BNE.b CODE_0FB7BC
	INC.w $105F
	STZ.w $1060
CODE_0FB7BC:
	RTS

CODE_0FB7BD:
CODE_raphael_state_main_death_fade_to_twinkle:       ; state $10 -- rotating/fading into a twinkle
	TYX
	JSR.w CODE_0FB40E
	LDY.b #$01
	JSR.w CODE_0FB1AF
	LDA.w $1060
	BEQ.b CODE_0FB7D4
	CMP.b #$01
	BEQ.b CODE_0FB81B
	CMP.b #$08
	BEQ.b CODE_0FB7E9
	RTS

CODE_0FB7D4:
	LDA.b $76,x
	CMP.b #$FF
	BEQ.b CODE_0FB7DF
	INC.b $76,x
	INC.b $D9,x
	RTS

CODE_0FB7DF:
	LDA.b #$30
	STA.w $1060
	LDA.b #$80
	STA.b $D9,x
	RTS

CODE_0FB7E9:
	REP.b #$20
	LDA.w #!Define_YI_AmbSpr21F
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w $70E2,x
	SEC
	SBC.w #$FFFE
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0004
	STA.w $7142,y
	SEP.b #$20
	LDA.b #!Define_YI_SoundID18_CoinSpillage
	JSL.l CODE_push_sound_queue
	RTS

CODE_0FB81B:
	LDA.b #$02
	STA.b $16,x
	LDA.b #$A0
	STA.w $1064
	STA.w $1065
	INC.w $105F
	LDA.b #$50
	STA.w $1060
	STZ.w $7042,x
	RTS

CODE_0FB833:
CODE_raphael_state_main_death_twinkle_fade_out:      ; state $11 -- twinkle fading out
	TYX
	JSR.w CODE_0FB40E
	LDY.b #$01
	JSR.w CODE_0FB1AF
	LDA.w $1060
	BNE.b CODE_0FB84C
	LDA.b #$05
	STA.b $16,x
	STZ.b $76,x
	STZ.b $77,x
	INC.w $105F
CODE_0FB84C:
	RTS

CODE_0FB84D:
CODE_raphael_state_main_death_star_forming:          ; state $12 -- star forming (constellation sprite spawn)
	TYX
	JSR.w CODE_0FB40E
	JSR.w CODE_0FB881
	LDA.b $76,x
	CLC
	ADC.b #$08
	STA.b $76,x
	BEQ.b CODE_0FB85E
	RTS

CODE_0FB85E:
	INC.w $105F
	STZ.b $76,x
	STZ.b $77,x
	RTS

CODE_0FB866:
CODE_raphael_state_main_death_constellation_fade_in: ; state $13 -- constellation fade-in
	TYX
	JSR.w CODE_0FB40E
	JSR.w CODE_0FB8AE
	LDA.b $76,x
	CMP.b #$FE
	BEQ.b CODE_0FB878
	INC.b $76,x
	INC.b $76,x
	RTS

CODE_0FB878:
	INC.w $105F
	LDA.b #$02
	STA.w $7A96,x
	RTS

CODE_0FB881:
	REP.b #$20
	LDA.w #$24A0
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$5FFF
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $76,x
	INC
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_08E132>>16
	LDA.w #FXCODE_08E132
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STA.l $702DEA
	STA.l YI_Global_PaletteMirror[$3F].LowByte
	SEP.b #$20
	RTS

CODE_0FB8AE:
	REP.b #$20
	LDA.w #$24A0
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$7E60
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $76,x
	INC
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_08E132>>16
	LDA.w #FXCODE_08E132
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STA.l $702DE8
	STA.l YI_Global_PaletteMirror[$3E].LowByte
	SEP.b #$20
	RTS

CODE_0FB8DB:
CODE_raphael_state_main_done_wait_for_exit:          ; state $14 -- done with fight, final state (waits for level-exit)
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0FB8EF
	REP.b #$20
	LDA.w #$0005
	STA.w !RAM_YI_Global_PlayMusicLo
	JSL.l CODE_02E191
	SEP.b #$20
CODE_0FB8EF:
	RTS

CODE_0FB8F0:
	PHB
	PHK
	PLB
	JSR.w CODE_0FB8F8
	PLB
	RTL

CODE_0FB8F8:
	LDA.b $00
	CLC
	ADC.w $0D05
	CLC
	ADC.b #$80
	STA.b $0C
	BRA.b CODE_0FB91A

CODE_0FB905:
	LDA.w $105D
	CLC
	ADC.w $0D05
	CLC
	ADC.b #$80
	STA.b $0C
	PHA
	CLC
	ADC.w $7A39,x
	STA.w $105E
	PLA
CODE_0FB91A:
	LSR
	LSR
	LSR
	LSR
	LSR
	AND.b #$06
	TAX
	JMP.w (DATA_0FB925,x)

DATA_0FB925:
	dw CODE_0FB92D
	dw CODE_0FB973
	dw CODE_0FB9BC
	dw CODE_0FBA08

CODE_0FB92D:
	LDA.b $0C
	AND.b #$3F
	TAY
	LDA.w DATA_0FBA89,y
	STA.w !REGISTER_Multiplicand
	LDA.b $0E
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	STA.b $00
	LDA.b $0C
	AND.b #$3F
	STA.b $0F
	LDA.b #$40
	SEC
	SBC.b $0F
	TAY
	LDA.w DATA_0FBA89,y
	STA.w !REGISTER_Multiplicand
	LDA.b $0E
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	STA.b $02
	JMP.w CODE_0FBA51

CODE_0FB973:
	LDA.b $0C
	AND.b #$3F
	TAY
	LDA.w DATA_0FBA89,y
	STA.w !REGISTER_Multiplicand
	LDA.b $0E
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	STA.b $02
	LDA.b $0C
	AND.b #$3F
	STA.b $0F
	LDA.b #$40
	SEC
	SBC.b $0F
	TAY
	LDA.w DATA_0FBA89,y
	STA.w !REGISTER_Multiplicand
	LDA.b $0E
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	EOR.b #$FF
	INC
	STA.b $00
	JMP.w CODE_0FBA51

CODE_0FB9BC:
	LDA.b $0C
	AND.b #$3F
	TAY
	LDA.w DATA_0FBA89,y
	STA.w !REGISTER_Multiplicand
	LDA.b $0E
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	EOR.b #$FF
	INC
	STA.b $00
	LDA.b $0C
	AND.b #$3F
	STA.b $0F
	LDA.b #$40
	SEC
	SBC.b $0F
	TAY
	LDA.w DATA_0FBA89,y
	STA.w !REGISTER_Multiplicand
	LDA.b $0E
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	EOR.b #$FF
	INC
	STA.b $02
	JMP.w CODE_0FBA51

CODE_0FBA08:
	LDA.b $0C
	AND.b #$3F
	TAY
	LDA.w DATA_0FBA89,y
	STA.w !REGISTER_Multiplicand
	LDA.b $0E
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	EOR.b #$FF
	INC
	STA.b $02
	LDA.b $0C
	AND.b #$3F
	STA.b $0F
	LDA.b #$40
	SEC
	SBC.b $0F
	TAY
	LDA.w DATA_0FBA89,y
	STA.w !REGISTER_Multiplicand
	LDA.b $0E
	STA.w !REGISTER_Multiplier
	NOP #4
	LDA.w !REGISTER_ProductOrRemainderHi
	ASL.w !REGISTER_ProductOrRemainderLo
	ADC.b #$00
	STA.b $00
	JMP.w CODE_0FBA51

CODE_0FBA51:
	LDX.b $12
	STZ.b $01
	LDA.b $00
	BPL.b CODE_0FBA5B
	DEC.b $01
CODE_0FBA5B:
	STZ.b $03
	LDA.b $02
	BPL.b CODE_0FBA63
	DEC.b $03
CODE_0FBA63:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.b #!Define_YI_NorSpr03C_TapTapTheRedNose
	BEQ.b CODE_0FBA88
	REP.b #$20
	LDA.b $00
	CLC
	ADC.w #$0118
	STA.w $7182,x
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState20_EnteringRaphaelBossRoom
	BEQ.b CODE_0FBA86
	LDA.b $02
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $70E2,x
CODE_0FBA86:
	SEP.b #$20
CODE_0FBA88:
	RTS

DATA_0FBA89:
	db $FF,$FF,$FF,$FF,$FE,$FE,$FD,$FC,$FB,$FA,$F8,$F7,$F5,$F3,$F1,$EF
	db $ED,$EA,$E7,$E5,$E2,$DF,$DC,$D8,$D5,$D1,$CE,$CA,$C6,$C2,$BE,$B9
	db $B5,$B1,$AC,$A7,$A2,$9D,$98,$93,$8E,$89,$84,$7E,$79,$73,$6D,$68
	db $62,$5C,$56,$50,$4A,$44,$3E,$38,$32,$2C,$26,$1F,$19,$13,$0D,$06
	db $00

DATA_0FBACA:
	dw CODE_0FC089
	dw CODE_0FC089
	dw CODE_0FC089
	dw CODE_0FC1C7
	dw CODE_0FC8EB
	dw CODE_0FC8E1
	dw CODE_0FC8E6
	dw CODE_0FC99E
	dw CODE_0FCA26
	dw CODE_0FCA9A
	dw CODE_0FCAF3
	dw CODE_0FCA8A
	dw CODE_0FD56E
	dw CODE_0FD8D5
	dw CODE_0FD966
	dw CODE_0FDB30
	dw CODE_0FDBD5
	dw CODE_0FDBEE
	dw CODE_0FDD42
	dw CODE_0FDF52
	dw CODE_0FDF8E
	dw CODE_0FE01D

DATA_0FBAF6:
	dw CODE_0FC094
	dw CODE_0FC162
	dw CODE_0FC1AF
	dw CODE_0FC21A
	dw CODE_0FC8F4
	dw CODE_0FC8F4
	dw CODE_0FC8F4
	dw CODE_0FC9A3
	dw CODE_0FCA2C
	dw CODE_0FCAB2
	dw CODE_0FCAF8
	dw CODE_0FCAD3
	dw CODE_0FD57D
	dw CODE_0FD8F4
	dw CODE_0FD973
	dw CODE_0FDB43
	dw CODE_0FDBD5
	dw CODE_0FDC6A
	dw CODE_0FDD61
	dw CODE_0FDF65
	dw CODE_0FDFDF
	dw CODE_0FE01E

DATA_0FBB22:
	db $01,$58,$01,$58,$01,$48,$01,$60,$01,$30,$01,$10,$00,$08,$01,$80
	db $01,$40,$04,$08,$01,$80,$05,$20,$01,$40,$00,$08,$01,$20,$01,$20
	db $05,$20,$01,$50,$05,$20,$05,$20,$05,$60,$01,$20

DATA_0FBB4E:
	db $00,$20,$01,$20,$01,$20,$05,$10,$04,$10,$06,$10,$07,$10,$FF,$12
	db $05,$10,$05,$10,$FF,$14,$05,$10,$07,$20,$06,$22,$06,$24,$FF,$2A
	db $04,$20,$04,$10,$04,$1E,$03,$10,$04,$10,$04,$1E

;-------------------------------------------------------------------------
; Gamemode $13 -- prepare retry-screen.
; Raiden: CODE_gm13_prepare_retry_screen. See also: ys_game.asm, ys_init.asm.
; One-shot scene setup before the "Try Again?" / continue prompt that runs
; after Yoshi runs out of stars and loses Baby Mario. Mirrors the halftime/
; restart shared init pattern (clear VRAM/URAM, set message no., call the
; "again init" sub) using framework hooks.
;
; INPUTS:
;   M=8 X=8 (gamemode-dispatcher contract).
;   $7E:0118 (!RAM_YI_Global_CurrentGameMode) = $13 (just arrived here).
;   $7E:0379 (!RAM_YI_Level_CurrentLifeCountLo) -- read by the subsequent gm15
;     tick, NOT by gm13 itself.
; OUTPUTS:
;   VRAM tile data for retry screen loaded. Palette mirror reset, palette $4A
;     uploaded. BG1-only screen mask installed.
;   4 letter-balloon sprites populated at hardcoded offscreen positions.
;   $7E:0118 advances by 1 (-> $14 / fade-in) via JML CODE_enable_nmi_and_advance.
;   Music stops (StopMusicCommand queued).
; MODIFIES: A, X, Y; OAM regions and HDMA channels through the GFX load chain.
; CALLERS:
;   Bank00 `DATA_game_mode_pointers[$13]` -- entered when player runs out of stars
;     and loses Baby Mario. One-shot; gm14 fade then gm15 tick follow.
;
; Phases (in order):
;   1. CODE_init_oam_and_bg3_tilemap  init OAM + BG3 tilemap            (Bank00: CODE_init_oam_and_bg3_tilemap)
;   2. CODE_clear_basic_states  clear basic states                (Bank00: CODE_clear_basic_states)
;   3. CODE_clear_all_sprites  clear all sprites                 (Bank03: CODE_clear_all_sprites)
;   4. Load compressed GFX bundle #$006E for the retry-screen tiles.
;   5. Zero palette mirror, then JSL CODE_00BB05 with palette index $4A.
;   6. JSL CODE_init_scene_regs to install scene-register set #$02.
;   7. Enable BG1 only on TM ($10).
;   8. Spawn the four "Yoshi heart-balloon" letter sprites at hardcoded
;      positions via CODE_0FBFD9 (shared spawn helper at $0FBFD9).
;   9. JSL CODE_0FBC63 -- jump into the gm15 tick body to render the
;      initial frame so the screen isn't blank on first display.
;  10. Stop music (!Define_YI_MusicID_StopMusicCommand) and JML CODE_enable_nmi_and_advance
;      to advance the global game-mode counter (next tick runs gm14/gm15).
;-------------------------------------------------------------------------
CODE_0FBB7A:
CODE_gm13_prepare_retry_screen:                      ; Raiden alias
	JSL.l CODE_init_oam_and_bg3_tilemap
	JSL.l CODE_clear_basic_states
	JSL.l CODE_clear_all_sprites
	REP.b #$10
	LDY.w #$006E
	JSL.l CODE_load_compressed_gfx_files_l
	REP.b #$30
	LDA.w #$0000
	STA.l YI_Global_PaletteMirror[$00].LowByte
	LDX.w #$004A
	JSL.l CODE_00BB05
	LDX.b #$02
	JSL.l CODE_init_scene_regs
	LDA.b #$10
	STA.w !RAM_YI_Global_MainScreenLayers
	STA.w !REGISTER_MainScreenLayers
	JSL.l CODE_clear_lz2_staging_buffer
	REP.b #$20
	LDA.w #$022F
	JSR.w CODE_0FBFD9
	LDA.w #$0070
	STA.w $70E2,y
	LDA.w #$0080
	STA.w $7182,y
	LDA.w #$0020
	STA.w $7A96,y
	LDA.w #$0008
	STA.w $7A98,y
	LDA.w #$0230
	JSR.w CODE_0FBFD9
	LDA.w #$001C
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w #$0062
	STA.w $70E2,y
	LDA.w #$0071
	STA.w $7182,y
	LDA.w #$0002
	STA.w $7A98,y
	LDA.w #$0230
	JSR.w CODE_0FBFD9
	LDA.w #$001C
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w #$0098
	STA.w $70E2,y
	LDA.w #$006F
	STA.w $7182,y
	LDA.w #$0002
	STA.w $7400,y
	LDA.w #$0004
	STA.w $7A98,y
	LDA.w #$0230
	JSR.w CODE_0FBFD9
	LDA.w #$001C
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w #$008A
	STA.w $70E2,y
	LDA.w #$007E
	STA.w $7182,y
	LDA.w #$0002
	STA.w $7400,y
	LDA.w #$0006
	STA.w $7A98,y
	LDA.w #$0231
	JSR.w CODE_0FBFD9
	LDA.w #$001C
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w #$0080
	STA.w $70E2,y
	LDA.w #$0060
	STA.w $7182,y
	LDA.w #$0006
	STA.w $7A98,y
	SEP.b #$20
	JSL.l CODE_0FBC63
	LDA.b #!Define_YI_MusicID_StopMusicCommand
	STA.b !RAM_YI_Global_PlayMusicLo
	JML.l CODE_enable_nmi_and_advance

;-------------------------------------------------------------------------
; CODE_0FBC63 -- bank-prologue entry for the gm15 retry-screen tick.
; Falls through to CODE_gm15_retry_screen_cutscene. Used by gm13 to render the first frame
; from inside its setup path (gm13 calls in via JSL, so PHB/PHK/PLB sets
; DBR=PB=$0F so the rest of the routine can use bank-local addressing).
;-------------------------------------------------------------------------
CODE_0FBC63:
	PHB
	PHK
	PLB

;-------------------------------------------------------------------------
; Gamemode $15 -- retry-screen cutscene tick.
; Raiden: CODE_gm15_retry_screen_cutscene. See also: ys_game.asm.
; The "course again" loop -- polls controller2 for player input on the prompt.
; Each frame:
;   - Tick OAM buffer + sprite-edge despawn/draw.
;   - Run GSU job FXCODE_08B1EF (renders the heart-balloon letters).
;   - Inspect $0B4C (continue-was-selected flag). If clear, just return.
;   - Otherwise, with !RAM_YI_Level_CurrentLifeCountLo == 0 (out of lives):
;       - Clear $0B4C and go to GameMode $3F (Game Over).
;     Else (continue, lives remain):
;       - If middle-rings touched in this attempt: go to GameMode $32
;         (restart from middle-ring checkpoint).
;       - Else: go to GameMode $3A (restart from level start).
;
; INPUTS:
;   M=8 X=8.
;   $7E:0B4C = continue-selected flag (set by retry-screen sprite when player
;     picks Yes on the prompt).
;   $7E:0379 (!RAM_YI_Level_CurrentLifeCountLo) -- 0 means game-over instead of retry.
;   $7E:03AC (!RAM_YI_Level_MiddleRingsTouchedLo) -- non-zero means restart from midring.
; OUTPUTS:
;   When continue picked: !RAM_YI_Global_CurrentGameMode := $3A / $32 / $3F.
;   OAM updated each frame; SuperFX render queued.
; MODIFIES: A, X, Y; DBR (PHB/PHK/PLB pair at CODE_0FBC63 entry); DP $00..$0F.
; CALLERS:
;   Bank00 `DATA_game_mode_pointers[$15]` -- per-frame tick after the gm14 fade-in.
;   Also re-entered via JSL from gm13 to render the first frame at setup time.
;-------------------------------------------------------------------------
CODE_0FBC66:
CODE_gm15_retry_screen_cutscene:                     ; Raiden alias
	JSL.l CODE_init_oam_buffer
	JSL.l CODE_spr_edge_despawn_draw
	JSL.l CODE_0FBF39
	REP.b #$20
	LDX.b #FXCODE_08B1EF>>16
	LDA.w #FXCODE_08B1EF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $0B4C
	BEQ.b CODE_0FBC9A
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
	BNE.b CODE_0FBC8E
	STZ.w $0B4C
	LDX.b #!Define_YI_GameMode3F
	BRA.b CODE_0FBC97

CODE_0FBC8E:
	LDX.b #!Define_YI_GameMode3A
	LDA.w !RAM_YI_Level_MiddleRingsTouchedLo
	BEQ.b CODE_0FBC97
	LDX.b #!Define_YI_GameMode32
CODE_0FBC97:
	STX.w !RAM_YI_Global_CurrentGameMode
CODE_0FBC9A:
	SEP.b #$20
	PLB
	RTL

DATA_0FBC9E:
	dw $6400,$47FF,$03FF
	dw $6C00,$47FF,$03FF
	dw $7C00,$47FF,$0130
	dw $3FF0,$401F,$0000
	dw $FFFF

DATA_0FBCB8:
	db $00,!REGISTER_BGModeAndTileSizeSetting : dl $7E5B18

DATA_0FBCBD:
	db $46,$09,$46,$09,$01,$00,$00,$00

DATA_0FBCC5:
	db $01,!REGISTER_MainScreenLayers : dl $7E5B98

DATA_0FBCCA:
	db $46,$15,$02,$46,$15,$02,$01,$08,$00,$00

DATA_0FBCD4:
	db $44,!REGISTER_Window1LeftPositionDesignation : dl $7E5C18

DATA_0FBCD9:
	db $12,$E4,$51,$F0,$EC,$51,$10,$E4,$51,$28,$E8,$51,$01,$E4,$51,$00

DATA_0FBCE9:
	db $42,!REGISTER_BG2HorizScrollOffset : dl $7E5C98

DATA_0FBCEE:
	db $24,$40,$50,$3D,$40,$50,$98,$42,$50,$01,$40,$50,$00

DATA_0FBCFB:
	db $42,!REGISTER_BG2HorizScrollOffset : dl $7E5D18

DATA_0FBD00:
	db $29,$40,$50,$40,$42,$50,$01,$3D,$00,$00

DATA_0FBD0A:
	dw $0232,$0088,$0058,$0000

DATA_0FBD12:
	dw $0233,$0010,$0050,$0233,$00B0,$0078,$0233,$0050
	dw $0068,$0233,$00E0,$0080,$0234,$0010,$0058,$0234
	dw $0010,$00A8,$0234,$0050,$0078,$0234,$0060,$0048
	dw $0234,$0088,$0068,$0234,$00A8,$0050,$0234,$00D8
	dw $0030,$0234,$00E0,$006C,$0235,$0010,$0068,$0235
	dw $0018,$0040,$0235,$0040,$0068,$0235,$0050,$007C
	dw $0235,$0058,$0038,$0235,$0080,$0076,$0235,$00A8
	dw $0078,$0235,$00D0,$0070,$0000

DATA_0FBD8C:
	dw $0236,$00B8,$0040,$0000

DATA_0FBD94:
	dw $0237,$0600,$0038,$0000

DATA_0FBD9C:
	dw $0239,$0078,$0050,$0000

DATA_0FBDA4:
	dw $023B,$0140,$0070,$0000,$0000

DATA_0FBDAE:
	dw $0240,$0050,$0082,$0000

DATA_0FBDB6:
	dw $0243,$0080,$0070,$0000

;-------------------------------------------------------------------------
; Gamemode $05 -- load cutscene scene.
; Raiden: CODE_gm05_load_cutscene. See also: ys_game.asm, ys_init.asm.
; The one-shot setup that arms the cutscene engine before gm06/gm07 take over
; per-frame playback.
;
; Phases:
;   1. CODE_0082D0  pre-scene system reset.
;   2. init OAM + BG3 tilemap, clear basic + sprite states.
;   3. Load compressed GFX bundle #$0079 (cutscene tileset).
;   4. STA #$15 at $0127, then JSL CODE_prepare_tilemap_dma_queue_l -- CODE_prepare_tilemap_dma_queue.
;   5. JSL CODE_00BB05 X=$0050 (load cutscene palette).
;   6. JSL CODE_init_scene_regs X=$24 (init scene regs).
;   7. Set BG4 base = $7C.
;   8. If $012B == 0 then queue music ID $02.
;   9. Bulk-copy 5 HDMA channel parameter sets from DATA_0FBCB8/_0FBCC5/
;      _0FBCD4/_0FBCE9/_0FBCFB into channels 3..7, fill indirect bank = $7E.
;  10. Bulk-copy 21 bytes of HDMA table seed data into WRAM staging area
;      $7E:5B18 / $7E:5B98 / $7E:5C18 / $7E:5C98 / $7E:5D18.
;  11. Mirror $7E:5B99 to $1407.
;  12. Wave-table seed: $7E:51E4/E6 = $00FF, $7E:51E8/EA = $FF00.
;  13. Enable HDMA channels 5-7 (HDMAEN = $E0).
;  14. JSL CODE_copy_division_lookup_to_sram (copy GSU 1/x division table into SRAM $702200+).
;  15. JSR CODE_0FBF14 X=DATA_0FBD0A (seed sprite spawn list).
;  16. JSL CODE_0FBEB2 (one extra setup pass + branch into gm07 body).
;  17. IRQ setup: HCOUNT=$50, VCOUNT=$C6, IE=$B1 (NMI+IRQ+joypad).
;  18. Cutscene timer: $1405 = $3100.
;  19. JML CODE_increment_gamemode (commit + return to dispatcher; advances game mode).
;
; INPUTS:
;   M=8 X=8.
;   $7E:0118 (!RAM_YI_Global_CurrentGameMode) = $05.
;   $7E:012B = cutscene-music-already-queued sentinel (0 = fresh, !=0 = re-entry).
; OUTPUTS:
;   All cutscene scaffolding loaded as above. !RAM_YI_Global_CurrentGameMode
;     advances by 1 (-> $06 / fade-in).
;   $7E:1405 = $3100 (per-scene timer, ticked down by gm07).
; MODIFIES: A, X, Y; HDMA channels $03-$07; DP $00..$0F.
; CALLERS:
;   Bank00 `DATA_game_mode_pointers[$05]` -- one-shot setup; gm06 fade then gm07 tick follow.
;-------------------------------------------------------------------------
CODE_0FBDBE:
CODE_gm05_load_cutscene:                             ; Raiden alias
	JSL.l CODE_0082D0
	JSL.l CODE_init_oam_and_bg3_tilemap
	JSL.l CODE_clear_basic_states
	JSL.l CODE_clear_all_sprites
	REP.b #$10
	LDY.w #$0079
	JSL.l CODE_load_compressed_gfx_files_l
	LDA.b #$15
	STA.w $0127
	JSL.l CODE_prepare_tilemap_dma_queue_l
	REP.b #$30
	LDX.w #$0050
	JSL.l CODE_00BB05
	LDX.b #$24
	JSL.l CODE_init_scene_regs
	LDA.b #$7C
	STA.w !REGISTER_BG4AddressAndSize
	LDA.w $012B
	BNE.b CODE_0FBDFE
	LDA.b #$02
	STA.w !RAM_YI_Global_PlayMusicLo
CODE_0FBDFE:
	LDX.b #$04
CODE_0FBE00:
	LDA.w DATA_0FBCB8,x
	STA.w HDMA[$07].Parameters,x
	LDA.w DATA_0FBCC5,x
	STA.w HDMA[$06].Parameters,x
	LDA.w DATA_0FBCD4,x
	STA.w HDMA[$05].Parameters,x
	LDA.w DATA_0FBCE9,x
	STA.w HDMA[$04].Parameters,x
	LDA.w DATA_0FBCFB,x
	STA.w HDMA[$03].Parameters,x
	DEX
	BPL.b CODE_0FBE00
	LDA.b #$7E
	STA.w HDMA[$07].IndirectSourceBank
	STA.w HDMA[$06].IndirectSourceBank
	STA.w HDMA[$05].IndirectSourceBank
	STA.w HDMA[$04].IndirectSourceBank
	STA.w HDMA[$03].IndirectSourceBank
	LDX.b #$14
CODE_0FBE34:
	LDA.w DATA_0FBCBD,x
	STA.l $7E5B18,x
	LDA.w DATA_0FBCCA,x
	STA.l $7E5B98,x
	LDA.w DATA_0FBCD9,x
	STA.l $7E5C18,x
	LDA.w DATA_0FBCEE,x
	STA.l $7E5C98,x
	LDA.w DATA_0FBD00,x
	STA.l $7E5D18,x
	DEX
	BPL.b CODE_0FBE34
	REP.b #$20
	LDA.l $7E5B99
	STA.w $1407
	LDA.w #$00FF
	STA.l $7E51E4
	STA.l $7E51E6
	LDA.w #$FF00
	STA.l $7E51E8
	STA.l $7E51EA
	SEP.b #$20
	LDA.b #$E0
	STA.w !RAM_YI_Global_HDMAEnable
	JSL.l CODE_copy_division_lookup_to_sram
	REP.b #$30
	LDX.w #DATA_0FBD0A
	JSR.w CODE_0FBF14
	JSL.l CODE_0FBEB2
	LDA.b #$02
	STA.w $0125
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$C6
	STA.w !REGISTER_VCountTimerLo
	LDA.b #$B1
	STA.w !REGISTER_IRQNMIAndJoypadEnableFlags
	REP.b #$20
	LDA.w #$3100
	STA.w $1405
	SEP.b #$20
	JML.l CODE_increment_gamemode

CODE_0FBEB2:
	PHB
	PHK
	PLB
	JSR.w CODE_cutscene_oam_buffer_init
	BRA.b CODE_0FBEE5

;-------------------------------------------------------------------------
; Gamemode $07 -- cutscene per-frame tick.
; Raiden: CODE_gm07_cutscene. See also: ys_game.asm.
;
; The cutscene engine driven here is:
;   - $1405/$1406 is a 24-bit timer counting down per tick (DEC $1405 below).
;   - When the timer hits 0, OR a Start/Select button is pressed
;     ($35 & $C0) | ($36 & $D0), advance to the next game mode (INC
;     !RAM_YI_Global_CurrentGameMode), queue the "fade music" SPC command
;     once (gated on $012B sentinel), and exit early.
;   - Otherwise, do per-frame cutscene render: init OAM buffer, run the
;     script tick at CODE_cutscene_script_tick (decodes the per-frame timeline tables
;     starting around $0FCF2D), then the shared sprite step + edge
;     despawn / draw. If any large object-style sprite is loaded
;     (!RAM_YI_Global_OAMSizeAndDataAreaDesignation & $00E0 != 0), run
;     GSU job FXCODE_089067 for it. Always run GSU job FXCODE_08B1EF
;     (the standard cutscene OAM finalizer).
;
; INPUTS:
;   M=8 X=8 (forced via SEP at top).
;   $7E:1405/$1406 = 24-bit countdown timer (set to $3100 by gm05).
;   $7E:0035/0036 = controller mirrors (Start/Select skip handling).
;   $7E:012B = music-fade-armed sentinel.
; OUTPUTS:
;   On timeout / Start+Select: INC !RAM_YI_Global_CurrentGameMode -> $08 (fade-out).
;   On normal frame: cutscene script ticked (CODE_cutscene_script_tick + DATA_0FCF2D timeline),
;     SuperFX FX-blob 089067 / 08B1EF kicked to render OAM.
; MODIFIES: A, X, Y, DP $00..$0F.
; CALLERS:
;   Bank00 `DATA_game_mode_pointers[$07]` -- per-frame tick (every cutscene frame).
;-------------------------------------------------------------------------
CODE_0FBEBA:
CODE_gm07_cutscene:                                  ; Raiden alias
	REP.b #$20
	DEC.w $1405
	SEP.b #$20
	LDA.w $1405
	ORA.w $1406
	BEQ.b CODE_0FBED3
	LDA.b $35
	AND.b #$C0
	ORA.b $36
	AND.b #$D0
	BEQ.b CODE_0FBEE5
CODE_0FBED3:
	INC.w !RAM_YI_Global_CurrentGameMode
	LDA.w $012B
	BNE.b CODE_0FBF12
	LDA.b #!Define_YI_MusicID_FadeMusicCommand
	STA.w !RAM_YI_Global_PlayMusicLo
	STA.w $012B
	BRA.b CODE_0FBF12

CODE_0FBEE5:
	JSL.l CODE_init_oam_buffer
	JSR.w CODE_cutscene_script_tick
	JSL.l CODE_0FBF39
	JSL.l CODE_spr_edge_despawn_draw
	REP.b #$20
	LDA.w !RAM_YI_Global_OAMSizeAndDataAreaDesignation
	AND.w #$00E0
	BEQ.b CODE_0FBF07
	LDX.b #FXCODE_089067>>16
	LDA.w #FXCODE_089067
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_0FBF07:
	LDX.b #FXCODE_08B1EF>>16
	LDA.w #FXCODE_08B1EF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
CODE_0FBF12:
	PLB
	RTL

CODE_0FBF14:
	LDA.w $0000,x
	BEQ.b CODE_0FBF36
	PHX
	SEP.b #$10
	JSR.w CODE_0FBFCD
	REP.b #$10
	PLX
	LDA.w $0002,x
	STA.w $70E2,y
	LDA.w $0004,x
	STA.w $7182,y
	TXA
	CLC
	ADC.w #$0006
	TAX
	BRA.b CODE_0FBF14

CODE_0FBF36:
	SEP.b #$30
	RTS

CODE_0FBF39:
	PHB
	PHK
	PLB
	PHD
	REP.b #$20
	LDA.w #$7960
	TCD
	INC.b $14
	LDX.b #FXCODE_09884C>>16
	LDA.w #FXCODE_09884C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b #$5C
CODE_0FBF50:
	STX.b $12
	LDY.w !REGISTER_SoftwareLatchForHVCounter
	LDY.w !REGISTER_PPUStatusFlag2
	LDA.w !REGISTER_HCounter
	CLC
	ADC.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	JSR.w CODE_0FBF70
	DEX
	DEX
	DEX
	DEX
	BPL.b CODE_0FBF50
	SEP.b #$20
	PLD
	PLB
	RTL

CODE_0FBF70:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	BEQ.b CODE_0FBF7F
	JSR.w CODE_0FBF84
	LDY.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w DATA_0FBF80-$1A,y
	PHA
CODE_0FBF7F:
	RTS

DATA_0FBF80:
	dw CODE_0FBFA5-$01
	dw CODE_0FBFBC-$01

CODE_0FBF84:
	LDA.w $7A96,x
	BEQ.b CODE_0FBF8C
	DEC.w $7A96,x
CODE_0FBF8C:
	LDA.w $7A98,x
	BEQ.b CODE_0FBF94
	DEC.w $7A98,x
CODE_0FBF94:
	LDA.w $7AF6,x
	BEQ.b CODE_0FBF9C
	DEC.w $7AF6,x
CODE_0FBF9C:
	LDA.w $7AF8,x
	BEQ.b CODE_0FBFA4
	DEC.w $7AF8,x
CODE_0FBFA4:
	RTS

CODE_0FBFA5:
	LDA.w #$001C
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	ASL
	REP.b #$10
	TAY
	LDA.w DATA_0FBACA-(!Define_YI_AmbSpr22F_Invalid*$02),y
	STA.b $00
	SEP.b #$10
	JMP.w ($0000+$7960)

CODE_0FBFBC:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	ASL
	REP.b #$10
	TAY
	LDA.w DATA_0FBAF6-(!Define_YI_AmbSpr22F_Invalid*$02),y
	STA.b $00
	SEP.b #$10
	JMP.w ($0000+$7960)

CODE_0FBFCD:
	JSR.w CODE_0FBFD9
	BCC.b CODE_0FBFD8
	LDA.w #$02FF
	STA.w $74A0,y
CODE_0FBFD8:
	RTS

;-------------------------------------------------------------------------
; CODE_0FBFD9 -- shared sprite-spawn helper used by gm13 retry-screen
; (heart-balloon letters) and CODE_0FBFCD (general spawn-with-flag wrapper).
;
; Walks the retry-screen sprite slot range top-down ($5C, $58, ..., $00 -- 24
; 4-byte slots) looking for an empty slot (`CurrentStatus == 0`). On hit,
; stamps the sprite ID (from caller's A) and zero-initializes ~30 per-slot
; fields (position, speed, animation timers, GenericTable scratch words),
; returns CS set with Y = slot index. On miss (all slots occupied) returns
; CC and A restored.
;
; INPUTS:
;   M=16 X=16. A = sprite ID to spawn (low word). Y clobbered.
; OUTPUTS:
;   CS + Y = slot offset on success (sprite ID stored at $7E:7400,y); CC on miss.
;   ~30 per-slot words zeroed; CurrentStatus[y] := $001A (active flag); $74A0,y := $00FF.
; MODIFIES: A, Y; many !EXRAM_YI_Level_NorSpr_* slot fields.
;-------------------------------------------------------------------------
CODE_0FBFD9:
	PHA
	LDY.b #$5C
CODE_0FBFDC:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	BEQ.b CODE_0FBFEA
	DEY
	DEY
	DEY
	DEY
	BPL.b CODE_0FBFDC
	PLA
	CLC
	RTS

CODE_0FBFEA:
	LDA.w #$001A
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w #$00FF
	STA.w $74A0,y
	LDA.w #$0000
	STA.w $7D96,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	STA.w $7400,y
	STA.w $70E0,y
	STA.w $7180,y
	STA.w $7D36,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	STA.w $7A36,y
	STA.w $7A38,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	STA.w $7A96,y
	STA.w $7A98,y
	STA.w $7AF6,y
	STA.w $7AF8,y
	STA.w $7402,y
	STA.w $7860,y
	STA.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,y
	STA.w $7D38,y
	STA.w $7680,y
	STA.w $7682,y
	STA.w $7540,y
	STA.w $75E0,y
	STA.w $77C0,y
	STA.w $7542,y
	STA.w $75E2,y
	STA.w $6FA0,y
	STA.w $6FA2,y
	DEC
	STA.w $7722,y
	LDA.w #$1FFF
	STA.w $7862,y
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	PHX
	ASL
	REP.b #$10
	TAX
	LDA.w DATA_0FBB4E-((!Define_YI_AmbSpr22F_Invalid*$02)-$01),x
	AND.w #$00FF
	STA.w $7042,y
	LDA.w DATA_0FBB4E-(!Define_YI_AmbSpr22F_Invalid*$02),x
	AND.w #$00FF
	STA.w $74A2,y
	LDA.w DATA_0FBB22-(!Define_YI_AmbSpr22F_Invalid*$02),x
	STA.w $7040,y
	SEP.b #$10
	PLX
	SEC
	RTS

CODE_0FC089:
	LDA.w #$0009
	STA.w $7AF6,y
	RTS

DATA_0FC090:
	dw $0030,$0000

CODE_0FC094:
	LDA.b $76,x
	DEC
	BEQ.b CODE_0FC0C8
	DEC
	BEQ.b CODE_0FC10C
	DEC
	BEQ.b CODE_0FC0FE
	LDA.w $7A96,x
	BNE.b CODE_0FC0C5
	LDA.w #$0008
	STA.w !RAM_YI_Global_PlayMusicLo
	INC.b $76,x
	LDA.b $76,x
	ASL
	TAY
	LDA.w DATA_0FC090-$02,y
	STA.w $7A96,x
	LDA.w #$0003
	STA.w $7402,x
	LDA.w #$000A
	STA.w $7A98,x
	JMP.w CODE_0FC17C

CODE_0FC0C5:
	JMP.w CODE_0FC162

CODE_0FC0C8:
	LDA.w $7A96,x
	BNE.b CODE_0FC0E1
	INC.b $76,x
	LDA.w #$0010
	STA.w $7A96,x
	LDA.w #$0008
	STA.w $7A98,x
	STZ.w $7402,x
	JMP.w CODE_0FC162

CODE_0FC0E1:
	LDA.w $7A98,x
	BNE.b CODE_0FC0FB
	LDA.w #$0003
	STA.w $7A98,x
	LDA.w $7402,x
	INC
	CMP.w #$0005
	BCC.b CODE_0FC0F8
	LDA.w #$0003
CODE_0FC0F8:
	STA.w $7402,x
CODE_0FC0FB:
	JMP.w CODE_0FC17C

CODE_0FC0FE:
	LDA.w $7182,x
	CMP.w #$FFC0
	BPL.b CODE_0FC109
	INC.w $0B4C
CODE_0FC109:
	JMP.w CODE_0FC162

CODE_0FC10C:
	LDA.w $7A96,x
	BNE.b CODE_0FC109
	INC.b $76,x
	LDA.w #$FC00
	STA.w $75E2,x
	STA.w $762E
	STA.w $7632
	STA.w $7636
	STA.w $763A
	LDA.w #$0040
	STA.w $7542,x
	STA.w $758E
	STA.w $7592
	STA.w $7596
	STA.w $759A
	JMP.w CODE_0FC162

DATA_0FC13A:
	dw $0001,$0001,$0002,$0002,$0003,$0002,$0002,$0001
	dw $FFFF,$FFFE,$FFFE,$FFFD,$FFFE,$FFFE,$FFFF,$FFFF

DATA_0FC15A:
	dw $0CC4,$0CC6,$0CC8,$4CC6

CODE_0FC162:
	LDA.w $7A98,x
	BNE.b CODE_0FC17C
	LDA.w $7402,x
	INC
	CMP.w #$0003
	BNE.b CODE_0FC173
	LDA.w #$0000
CODE_0FC173:
	STA.w $7402,x
	LDA.w #$0008
	STA.w $7A98,x
CODE_0FC17C:
	LDA.b $14
	AND.w #$0006
	TAY
	LDA.w DATA_0FC15A,y
	REP.b #$10
	LDY.w $7362,x
	STA.w $6004,y
	SEP.b #$10
CODE_0FC18F:
	LDA.w $7AF6,x
	BNE.b CODE_0FC1AE
	LDA.w #$0008
	STA.w $7AF6,x
	LDA.b $18,x
	INC
	INC
	AND.w #$001F
	STA.b $18,x
	TAY
	LDA.w $7182,x
	CLC
	ADC.w DATA_0FC13A,y
	STA.w $7182,x
CODE_0FC1AE:
	RTS

CODE_0FC1AF:
	LDA.w $7A98,x
	BNE.b CODE_0FC1C4
	LDA.w $7402,x
	INC
	AND.w #$0001
	STA.w $7402,x
	LDA.w #$0006
	STA.w $7A98,x
CODE_0FC1C4:
	JMP.w CODE_0FC18F

CODE_0FC1C7:
	REP.b #$10
	LDX.w #$01FE
CODE_0FC1CC:
	LDA.l YI_Global_PaletteMirror[$00].LowByte,x
	STA.l $702D6C,x
	STA.l $702F6C,x
	DEX
	DEX
	BPL.b CODE_0FC1CC
	SEP.b #$10
	JSR.w CODE_0FC807
	LDA.w #$2D6C
	STA.l $70336E
	LDA.w #$2F6C
	STA.l $703370
	STZ.w !RAM_YI_Global_Layer1YPosLo
	STZ.w !RAM_YI_Global_Layer2YPosLo
	STZ.w !RAM_YI_Global_Layer1XPosLo
	STZ.w !RAM_YI_Global_Layer2XPosLo
	STZ.w $6094
	STZ.w $6096
	STZ.w $609C
	STZ.w $609E
	LDX.b #$00
	JSR.w CODE_0FC884
	LDX.b #$04
	JSR.w CODE_0FC884
	LDA.w #$0200
	STA.w $7AF8,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_0FC21A:
	LDY.b $18,x
	TYX
	JMP.w (DATA_0FC220,x)

DATA_0FC220:
	dw CODE_0FC232
	dw CODE_0FC267
	dw CODE_0FC34D
	dw CODE_0FC3C5
	dw CODE_0FC430
	dw CODE_0FC4BD
	dw CODE_0FC517
	dw CODE_0FC57A
	dw CODE_0FC5D2

CODE_0FC232:
	LDX.b $12
	JSR.w CODE_0FC281
	JSR.w CODE_0FC253
	BNE.b CODE_0FC252
	REP.b #$10
	LDX.w #DATA_0FBD12
	JSR.w CODE_0FBF14
	REP.b #$20
	LDX.b $12
	LDA.w #$0500
	STA.w $7AF8,x
CODE_0FC24E:
	INC.b $18,x
	INC.b $18,x
CODE_0FC252:
	RTS

CODE_0FC253:
	LDA.w $7AF8,x
	BNE.b CODE_0FC260
	LDY.w $1402
	BNE.b CODE_0FC261
	INC.w $1402
CODE_0FC260:
	RTS

CODE_0FC261:
	LDY.b #$00
	STY.w $1402
	RTS

CODE_0FC267:
	LDX.b $12
	JSR.w CODE_0FC884
	JSR.w CODE_0FC61D
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CMP.w #$0100
	BCS.b CODE_0FC2E8
	CLC
	ADC.w #$0002
	STA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $6094
CODE_0FC281:
	LDA.b $14
	AND.w #$0003
	BNE.b CODE_0FC2E7
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0050
	CMP.w #$00F0
	BCC.b CODE_0FC297
	LDA.w #$0000
CODE_0FC297:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	ORA.w #$1900
	STA.b $00
	REP.b #$10
	LDA.l $7E4000
	TAX
	LDA.w #$0005
	STA.b $02
	LDA.w #$6108
	STA.b $04
CODE_0FC2B0:
	LDA.b $04
	STA.l $7E4002,x
	CLC
	ADC.w #$0020
	STA.b $04
	LDA.w #$001F
	STA.l $7E4004,x
	LDY.w #$0010
	LDA.b $00
CODE_0FC2C8:
	STA.l $7E4006,x
	INC
	INX
	INX
	DEY
	BNE.b CODE_0FC2C8
	STA.b $00
	INX
	INX
	INX
	INX
	DEC.b $02
	BNE.b CODE_0FC2B0
	LDA.w #$FFFF
	STA.l $7E4002,x
	SEP.b #$10
	LDX.b $12
CODE_0FC2E7:
	RTS

CODE_0FC2E8:
	LDA.l $70336C
	CMP.w #$0020
	BCC.b CODE_0FC2FB
	LDA.b $16,x
	CMP.w #$01C2
	BCS.b CODE_0FC309
	JSR.w CODE_0FC807
CODE_0FC2FB:
	LDA.b $14
	LSR
	BCC.b CODE_0FC309
	LDX.b #FXCODE_08B4A9>>16
	LDA.w #FXCODE_08B4A9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_0FC309:
	LDX.b $12
	JSR.w CODE_0FC253
	BNE.b CODE_0FC34C
	LDA.w #$0076
	JSR.w CODE_0FC78D
	LDX.b #$1C
CODE_0FC318:
	LDA.l DATA_5FCE72,x
	STA.l YI_Global_PaletteMirror[$41].LowByte,x
	LDA.l DATA_5FCE90,x
	STA.l YI_Global_PaletteMirror[$51].LowByte,x
	DEX
	DEX
	BPL.b CODE_0FC318
	REP.b #$10
	LDX.w #DATA_0FBD8C
	JSR.w CODE_0FBF14
	LDA.b #$10
	TRB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDX.b $12
	LDA.w #$01C0
	STA.w $7AF8,x
	LDA.w #$0002
	STA.w $7A98,x
	JMP.w CODE_0FC24E

CODE_0FC34C:
	RTS

CODE_0FC34D:
	LDX.b $12
	LDA.w $6094
	CMP.w #$0300
	BCS.b CODE_0FC36B
	ADC.w #$0002
	STA.w $6094
	CMP.w #$0100
	BCC.b CODE_0FC365
	LDA.w #$0100
CODE_0FC365:
	STA.w !RAM_YI_Global_Layer1XPosLo
	JMP.w CODE_0FC61D

CODE_0FC36B:
	LDA.w #$00FF
	STA.w $74A2,x
	JSR.w CODE_0FC253
	BNE.b CODE_0FC3C4
	LDA.w #$0075
	JSR.w CODE_0FC78D
	REP.b #$10
	LDX.w #DATA_0FBD94
	JSR.w CODE_0FBF14
	REP.b #$20
	LDX.b $12
	LDA.w #$0088
	STA.w $70E2,x
	LDA.w #$0048
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w $75E2,x
	STZ.w $7540,x
	STZ.w $75E0,x
	LDA.w #$0005
	STA.w $74A2,x
	LDA.w $7042,x
	EOR.w #$0030
	STA.w $7042,x
	LDA.w #$02FF
	STA.w $74A0,x
	LDA.w #$0200
	STA.w $7AF8,x
	JMP.w CODE_0FC24E

CODE_0FC3C4:
	RTS

CODE_0FC3C5:
	LDX.b $12
	JSR.w CODE_0FC884
	JSR.w CODE_0FC61D
	LDA.w $6094
	CMP.w #$0300
	BCS.b CODE_0FC3E7
	ADC.w #$0002
	STA.w $6094
	CMP.w #$0100
	BCC.b CODE_0FC3E3
	LDA.w #$0100
CODE_0FC3E3:
	STA.w !RAM_YI_Global_Layer1XPosLo
	RTS

CODE_0FC3E7:
	JSR.w CODE_0FC253
	BNE.b CODE_0FC42F
	LDX.b #$48
	LDA.w #$1000
	JSR.w CODE_0FC74B
	LDA.w #$0077
	JSR.w CODE_0FC78D
	LDX.b #$1C
CODE_0FC3FC:
	LDA.l DATA_5FCEAE,x
	STA.l YI_Global_PaletteMirror[$41].LowByte,x
	DEX
	DEX
	BPL.b CODE_0FC3FC
	REP.b #$10
	LDX.w #DATA_0FBD9C
	JSR.w CODE_0FBF14
	LDA.b #$10
	TRB.w !RAM_YI_Global_HDMAEnable
	LDA.b #$03
	TRB.w !RAM_YI_Global_BG2AddressAndSize
	REP.b #$20
	LDA.w #$FE24
	STA.w !RAM_YI_Global_Layer2XPosLo
	STZ.b $14
	LDX.b $12
	LDA.w #$0300
	STA.w $7AF8,x
	JMP.w CODE_0FC24E

CODE_0FC42F:
	RTS

CODE_0FC430:
	LDX.b $12
	LDA.b $14
	LSR
	BCC.b CODE_0FC43D
	INC.w !RAM_YI_Global_Layer2XPosLo
	INC.w !RAM_YI_Global_Layer2YPosLo
CODE_0FC43D:
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CMP.w #$0100
	BCS.b CODE_0FC451
	ADC.w #$0002
	STA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $6094
	JMP.w CODE_0FC61D

CODE_0FC451:
	LDA.w #$00FF
	STA.w $74A2,x
	JSR.w CODE_0FC253
	BNE.b CODE_0FC4BC
	LDA.w #$0017
	STA.w $1407
	LDY.b #$10
	STY.w !RAM_YI_Global_ColorMathInitialSettings
	LDY.b #$02
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.w #$1088
	STA.w $0948
	LDA.w #$0001
	TSB.w !RAM_YI_Global_BG2AddressAndSize
	LDX.b #$49
	LDA.w #$1800
	JSR.w CODE_0FC74B
	LDA.w #$0078
	JSR.w CODE_0FC78D
	LDX.b #$1C
CODE_0FC488:
	LDA.l DATA_5FCFBC,x
	STA.l YI_Global_PaletteMirror[$51].LowByte,x
	LDA.l DATA_5FCFDA,x
	STA.l YI_Global_PaletteMirror[$61].LowByte,x
	DEX
	DEX
	BPL.b CODE_0FC488
	REP.b #$10
	LDX.w #DATA_0FBDA4
	JSR.w CODE_0FBF14
	LDA.b #$03
	TRB.w !RAM_YI_Global_BG2AddressAndSize
	REP.b #$20
	LDA.w #$0178
	STA.w !RAM_YI_Global_Layer2XPosLo
	LDX.b $12
	LDA.w #$0400
	STA.w $7AF8,x
	JMP.w CODE_0FC24E

CODE_0FC4BC:
	RTS

CODE_0FC4BD:
	LDA.w $6096
	JSR.w CODE_0FCB3D
	LDX.b $12
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CMP.w #$0100
	BCS.b CODE_0FC4DF
	ADC.w #$0002
	STA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $6094
	LDA.b $14
	LSR
	BCC.b CODE_0FC4DE
	INC.w !RAM_YI_Global_Layer1YPosLo
CODE_0FC4DE:
	RTS

CODE_0FC4DF:
	JSR.w CODE_0FC253
	BNE.b CODE_0FC516
	LDA.w #$0001
	TSB.w !RAM_YI_Global_BG2AddressAndSize
	LDA.w #$0079
	JSR.w CODE_0FC78D
	LDX.b #$1C
CODE_0FC4F2:
	LDA.l DATA_5FCFF8,x
	STA.l YI_Global_PaletteMirror[$31].LowByte,x
	LDA.l DATA_5FD016,x
	STA.l YI_Global_PaletteMirror[$41].LowByte,x
	DEX
	DEX
	BPL.b CODE_0FC4F2
	LDY.b #$01
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDX.b $12
	LDA.w #$0100
	STA.w $7AF8,x
	JMP.w CODE_0FC24E

CODE_0FC516:
	RTS

CODE_0FC517:
	LDX.b $12
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CMP.w #$0100
	BCS.b CODE_0FC530
	ADC.w #$0002
	STA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $6094
	JSR.w CODE_0FCB3D
	LDX.b $12
	RTS

CODE_0FC530:
	JSR.w CODE_0FC253
	BNE.b CODE_0FC579
	LDA.w #$007A
	JSR.w CODE_0FC78D
	LDX.b #$1C
CODE_0FC53D:
	LDA.l DATA_5FD034,x
	STA.l YI_Global_PaletteMirror[$51].LowByte,x
	LDA.l DATA_5FD052,x
	STA.l YI_Global_PaletteMirror[$61].LowByte,x
	DEX
	DEX
	BPL.b CODE_0FC53D
	REP.b #$10
	LDX.w #DATA_0FBDAE
	JSR.w CODE_0FBF14
	REP.b #$20
	LDA.w #$0215
	STA.w $1407
	LDY.b #$02
	STY.w !RAM_YI_Global_ColorMathInitialSettings
	LDY.b #$20
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	STZ.w $0948
	LDX.b $12
	LDA.w #$0480
	STA.w $7AF8,x
	JMP.w CODE_0FC24E

CODE_0FC579:
	RTS

CODE_0FC57A:
	LDX.b $12
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CMP.w #$0100
	BCS.b CODE_0FC58E
	ADC.w #$0002
	STA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $6094
	RTS

CODE_0FC58E:
	JSR.w CODE_0FC253
	BNE.b CODE_0FC5D1
	LDA.w #$007B
	JSR.w CODE_0FC78D
	LDX.b #$1C
CODE_0FC59B:
	LDA.l DATA_5FD070,x
	STA.l YI_Global_PaletteMirror[$21].LowByte,x
	LDA.l DATA_5FD08E,x
	STA.l YI_Global_PaletteMirror[$31].LowByte,x
	LDA.l DATA_5FCF9E,x
	STA.l YI_Global_PaletteMirror[$F1].LowByte,x
	DEX
	DEX
	BPL.b CODE_0FC59B
	REP.b #$10
	LDX.w #DATA_0FBDB6
	JSR.w CODE_0FBF14
	LDA.b #$03
	TRB.w !RAM_YI_Global_BG2AddressAndSize
	REP.b #$20
	LDX.b $12
	LDA.w #$0300
	STA.w $7AF8,x
	JMP.w CODE_0FC24E

CODE_0FC5D1:
	RTS

CODE_0FC5D2:
	LDX.b $12
	LDA.w !RAM_YI_Global_Layer2XPosLo
	LSR
	STA.l $7E5042
	LSR
	STA.l $7E5040
	LDA.w #$0008
	TSB.w !RAM_YI_Global_HDMAEnable
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CMP.w #$0100
	BCS.b CODE_0FC5F9
	ADC.w #$0002
	STA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $6094
	RTS

CODE_0FC5F9:
	JSR.w CODE_0FC253
	BNE.b CODE_0FC5FE
CODE_0FC5FE:
	RTS

DATA_0FC5FF:
	dw $0001,$0002

DATA_0FC603:
	dw $0010,$FFC0

DATA_0FC607:
	dw $0010,$0008,$0018,$0004

DATA_0FC60F:
	dw $0055,$0040,$0055,$0055,$0055,$0008,$0100

CODE_0FC61D:
	LDA.w #$0080
	LDY.w $7A98,x
	BNE.b CODE_0FC633
	LDY.b $76,x
	LDA.w $7A38,x
	CMP.w DATA_0FC60F,y
	BMI.b CODE_0FC633
	SEC
	SBC.w #$0002
CODE_0FC633:
	STA.w $7A38,x
	CLC
	ADC.w $7A36,x
	CMP.w #$0C00
	BCC.b CODE_0FC6B6
	LDY.b $76,x
	BNE.b CODE_0FC648
	AND.w #$00FF
	BRA.b CODE_0FC6B6

CODE_0FC648:
	PHA
	XBA
	AND.w #$00FF
	ASL
	TAY
	CPY.b #$22
	BCS.b CODE_0FC6AA
	LDA.w $7A37,x
	AND.w #$00FF
	ASL
	STA.b $00
	CPY.b #$20
	BNE.b CODE_0FC69B
	CMP.w #$001E
	BNE.b CODE_0FC6AA
	PHY
	LDA.w #$0238
	JSR.w CODE_0FBFCD
	LDA.w $70E2,x
	CLC
	ADC.w #$0014
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$FFE8
	STA.w $7182,y
	LDA.w #$023A
	JSR.w CODE_0FBFCD
	LDA.w $70E2,x
	CLC
	ADC.w #$0014
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$FFE8
	STA.w $7182,y
	PLY
CODE_0FC69B:
	CPY.b $00
	BEQ.b CODE_0FC6AA
	LDA.w DATA_0FC5FF-$04,y
	STA.w $7A38,x
	PLA
	AND.w #$FF00
	PHA
CODE_0FC6AA:
	PLA
	CMP.w #$1800
	BCC.b CODE_0FC6B6
	AND.w #$00FF
	ORA.w #$1000
CODE_0FC6B6:
	STA.w $7A36,x
	XBA
	AND.w #$00FF
	STA.w $7402,x
	LDY.b $76,x
	BEQ.b CODE_0FC718
	LDA.w $75E0,x
	SEC
	SBC.w #$0001
	CMP.w #$0010
	BPL.b CODE_0FC6D3
	LDA.w #$0010
CODE_0FC6D3:
	STA.w $75E0,x
	LDY.b #$58
CODE_0FC6D8:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	BEQ.b CODE_0FC711
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_AmbSpr233_Invalid
	BCC.b CODE_0FC711
	CMP.w #!Define_YI_AmbSpr236_Invalid
	BCS.b CODE_0FC711
	LDA.w $75E0,y
	EOR.w #$FFFF
	INC
	SEP.b #$20
	STA.w !REGISTER_Mode7MatrixParameterA
	XBA
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.w $75E0,x
	STA.w !REGISTER_Mode7MatrixParameterB
	LDA.w !REGISTER_PPUMultiplicationProductLo
	ASL
	REP.b #$20
	LDA.w !REGISTER_PPUMultiplicationProductMid
	ROL
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
CODE_0FC711:
	DEY
	DEY
	DEY
	DEY
	BPL.b CODE_0FC6D8
	RTS

CODE_0FC718:
	LDA.w $7182,x
	CMP.w #$0058
	BCC.b CODE_0FC72D
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.w #$0006
	TAY
	LDA.w DATA_0FC607,y
	STA.w $7A98,x
CODE_0FC72D:
	LDY.w $7A98,x
	BEQ.b CODE_0FC734
	LDY.b #$02
CODE_0FC734:
	LDA.w DATA_0FC5FF,y
	STA.w $7542,x
	STA.w $7540,x
	LDA.w DATA_0FC603,y
	STA.w $75E2,x
	EOR.w #$FFFF
	INC
	STA.w $75E0,x
	RTS

CODE_0FC74B:
	PHA
	REP.b #$10
	TXA
	LDX.w #$5800
	JSL.l CODE_00B756
	TAY
	LDA.l $7E4800
	TAX
	PLA
	STA.l $7E0000,x
	LDA.w #$0180
	STA.l $7E0002,x
	LDA.w #$0018
	STA.l $7E0004,x
	LDA.w #$7058
	STA.l $7E0006,x
	TYA
	STA.l $7E0008,x
	TXA
	CLC
	ADC.w #$000C
	STA.l $7E000A,x
	STA.l $7E4800
	SEP.b #$10
	LDX.b $12
	RTS

CODE_0FC78D:
	REP.b #$10
	JSL.l CODE_00B753
	TAY
	LDA.l $7E4800
	TAX
	LDA.w !RAM_YI_Global_Layer2YPosLo
	STA.w !RAM_YI_Global_Layer1YPosLo
	STZ.w !RAM_YI_Global_Layer1XPosLo
	STZ.w $6094
	STZ.w !RAM_YI_Global_Layer2YPosLo
	LDA.w !RAM_YI_Global_BG1AddressAndSize
	XBA
	STA.w !RAM_YI_Global_BG1AddressAndSize
	AND.w #$FC00
	STA.l $7E0000,x
	LDA.w #$0180
	STA.l $7E0002,x
	LDA.w #$0018
	STA.l $7E0004,x
	LDA.w #$7068
	STA.l $7E0006,x
	TYA
	STA.l $7E0008,x
	TXA
	CLC
	ADC.w #$000C
	STA.l $7E000A,x
	STA.l $7E4800
	SEP.b #$10
	LDX.b $12
	LDY.b #$5C
CODE_0FC7E3:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	BEQ.b CODE_0FC800
	LDA.w #$00FF
	STA.w $74A0,y
	LDA.w $74A2,y
	AND.w #$FFFB
	STA.w $74A2,y
	LDA.w $7042,y
	ORA.w #$0030
	STA.w $7042,y
CODE_0FC800:
	DEY
	DEY
	DEY
	DEY
	BPL.b CODE_0FC7E3
	RTS

CODE_0FC807:
	PHB
	LDY.b #$702042>>16
	PHY
	PLB
	LDA.w #$0000
	STA.l $70336C
	LDA.b $16,x
	CLC
	ADC.w #$001E
	STA.b $16,x
	REP.b #$10
	TAX
	LDY.w #$001C
CODE_0FC821:
	LDA.w $702042,y
	STA.w $702DAE,y
	LDA.l DATA_5FD0C8,x
	STA.w $702FAE,y
	LDA.w $702062,y
	STA.w $702DCE,y
	LDA.l DATA_5FD2A8,x
	STA.w $702FCE,y
	LDA.w $702102,y
	STA.w $702E6E,y
	LDA.l DATA_5FD488,x
	STA.w $70306E,y
	DEX
	DEX
	DEY
	DEY
	BPL.b CODE_0FC821
	SEP.b #$10
	LDX.b $12
	PLB
	RTS

DATA_0FC854:
	dw $0001,$0001,$0000,$0001,$0002,$0002,$0002,$0001
	dw $0002,$0003,$0001,$0002,$0003,$0003,$0002,$0003
	dw $0002,$0003,$0002,$0002,$0003,$0003,$0002,$0003

CODE_0FC884:
	PHB
	LDY.b #DATA_cosine_lut_8bit_radians>>16
	PHY
	PLB
	LDA.w !RAM_YI_Global_Layer2XPosLo
	STA.l $7E5040
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w #$0004
	AND.w #$01FE
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	REP.b #$10
	TAY
	LDX.w #$002E
CODE_0FC8A3:
	LDA.w !RAM_YI_Global_Layer2XPosLo
	BNE.b CODE_0FC8C4
	LDA.w DATA_cosine_lut_8bit_radians,y
	SEP.b #$20
	STA.w !REGISTER_Mode7MatrixParameterA
	XBA
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.l DATA_0FC854,x
	STA.w !REGISTER_Mode7MatrixParameterB
	REP.b #$20
	LDA.w !RAM_YI_Global_Layer2XPosLo
	CLC
	ADC.w !REGISTER_PPUMultiplicationProductMid
CODE_0FC8C4:
	STA.l $7E5042,x
	TYA
	SEC
	SBC.w #$0060
	AND.w #$01FE
	TAY
	DEX
	DEX
	BPL.b CODE_0FC8A3
	SEP.b #$10
	LDA.w #$0010
	TSB.w !RAM_YI_Global_HDMAEnable
	LDX.b $12
	PLB
	RTS

CODE_0FC8E1:
	LDA.w #$FEC0
	BRA.b CODE_0FC8EE

CODE_0FC8E6:
	LDA.w #$FFC0
	BRA.b CODE_0FC8EE

CODE_0FC8EB:
	LDA.w #$FC00
CODE_0FC8EE:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $75E0,x
CODE_0FC8F4:
	LDY.w $74A1,x
	LDA.w $6094,y
	BNE.b CODE_0FC8FF
	JMP.w CODE_0FC992

CODE_0FC8FF:
	LDA.w $7680,x
	BMI.b CODE_0FC907
	JMP.w CODE_0FC99D

CODE_0FC907:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	LSR
	LSR
	LSR
	ADC.w #$0040
	TAY
	STY.w !REGISTER_Multiplicand
	LDY.w $70E2,x
	STY.w !REGISTER_Multiplier
	LDA.w #$02FF
	STA.w $74A0,x
	LDA.w $74A2,x
	EOR.w #$0004
	STA.w $74A2,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
	LDA.w !REGISTER_ProductOrRemainderLo
	LSR
	LSR
	LSR
	LSR
	LSR
	LSR
	EOR.w #$FFFF
	SEC
	ADC.w #$00F0
	STA.w $70E2,x
	INC.b $18,x
	LDA.b $18,x
	CMP.w #$0003
	BCC.b CODE_0FC956
	JSL.l CODE_03A31E
	RTS

CODE_0FC956:
	LSR
	BCC.b CODE_0FC975
	TXA
	AND.w #$0004
	BEQ.b CODE_0FC968
	LDA.w $74A2,x
	ORA.w #$00F0
	STA.w $74A2,x
CODE_0FC968:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	BRA.b CODE_0FC983

CODE_0FC975:
	LDA.w $74A2,x
	AND.w #$000F
	STA.w $74A2,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ASL
	ASL
CODE_0FC983:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $75E0,x
	LDA.w $7042,x
	EOR.w #$0030
	STA.w $7042,x
CODE_0FC992:
	LDA.w $70E2,x
	BPL.b CODE_0FC99D
	LDA.w #$00F0
	STA.w $70E2,x
CODE_0FC99D:
	RTS

CODE_0FC99E:
	LDA.w #$1800
	STA.b $16,x
CODE_0FC9A3:
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CMP.w #$0100
	BCC.b CODE_0FCA25
	LDA.w #$10C0
	STA.b $00
	LDA.w #FXDATA_548000+$0001
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.b $16,x
	SEC
	SBC.w #$0014
	CMP.w #$0080
	BCS.b CODE_0FC9D2
	JSL.l CODE_03A31E
	LDY.b #$02
	STY.w !RAM_YI_Global_OAMSizeAndDataAreaDesignation
	LDX.b #$4A
	LDA.w #$5000
	JMP.w CODE_0FC74B

CODE_0FC9D2:
	STA.b $16,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0480
	LDA.w #$0007
	BCS.b CODE_0FC9E2
	LDA.w #$0004
CODE_0FC9E2:
	STA.w $74A2,x
	LDA.w #FXDATA_540000>>16
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDX.b #FXCODE_089004>>16
	LDA.w #FXCODE_089004
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$2000
	STA.w $0CF9
	LDX.b $12
	LDY.b #$62
	STY.w !RAM_YI_Global_OAMSizeAndDataAreaDesignation
	LDY.w !REGISTER_SuperFX_R4_LMULTResultLo
	STY.w !REGISTER_Mode7MatrixParameterA
	LDY.w !REGISTER_SuperFX_R4_LMULTResultHi
	STY.w !REGISTER_Mode7MatrixParameterA
	LDY.b $00
	STY.w !REGISTER_Mode7MatrixParameterB
	LDA.w !REGISTER_PPUMultiplicationProductMid
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b $01
	STY.w !REGISTER_Mode7MatrixParameterB
	LDA.w !REGISTER_PPUMultiplicationProductMid
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0FCA25:
	RTS

CODE_0FCA26:
	LDA.w #$F7A0
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0FCA2C:
	LDA.w $70E2,x
	BPL.b CODE_0FCA36
	JSL.l CODE_03A31E
	RTS

CODE_0FCA36:
	CMP.w #$0200
	BPL.b CODE_0FCA72
	LDY.b $D2
	BNE.b CODE_0FCA73
	LDA.w #$0200
	STA.w $70E2,x
	LDY.w $745E
	CPY.b #$0B
	BNE.b CODE_0FCA72
	LDA.w #$0002
	STA.b $D2
	LDA.w #$0080
	STA.w $763C
	LDA.w #$0100
	STA.w $7A94
	STZ.w $7AF4
	STZ.w $727C
	STZ.w $727E
	STZ.w $759C
	STZ.w $759E
	LDA.w #$0029
	STA.w $7A96,x
CODE_0FCA72:
	RTS

CODE_0FCA73:
	LDA.w $7A96,x
	BNE.b CODE_0FCA89
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w $7402,x
	CMP.w #$0003
	BCS.b CODE_0FCA89
	INC.w $7402,x
CODE_0FCA89:
	RTS

CODE_0FCA8A:
	LDA.w #$0080
	STA.b $76,x
	LDA.w #$0080
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FC00
	BRA.b CODE_0FCAA3

CODE_0FCA9A:
	LDA.w #$FF80
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FD00
CODE_0FCAA3:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7542,x
	LDA.w #$0300
	STA.w $75E2,x
CODE_0FCAB2:
	RTS

DATA_0FCAB3:
	dw $0000,$0001,$0001,$0000,$0000,$0001,$0001,$0000

DATA_0FCAC3:
	dw $0000,$0000,$0040,$0040,$00C0,$00C0,$0080,$0080

CODE_0FCAD3:
	LDA.b $78,x
	CLC
	ADC.b $76,x
	STA.b $78,x
	XBA
	AND.w #$0007
	ASL
	TAY
	LDA.w DATA_0FCAB3,y
	STA.w $7402,x
	LDA.w $7042,x
	AND.w #$003F
	ORA.w DATA_0FCAC3,y
	STA.w $7042,x
	RTS

CODE_0FCAF3:
	LDA.w #$0080
	STA.b $16,x
CODE_0FCAF8:
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CMP.w #$0100
	BCC.b CODE_0FCB3C
	LDA.w #$0000
	STA.b $00
	LDA.w #FXDATA_548000+$0041
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.b $16,x
	CLC
	ADC.w #$0010
	CMP.w #$1B00
	BCC.b CODE_0FCB39
	LDY.w $74A2,x
	BMI.b CODE_0FCB2D
	DEY
	TYA
	STA.w $74A2,x
	LDY.b #$02
	STY.w !RAM_YI_Global_OAMSizeAndDataAreaDesignation
	LDX.b #$4B
	LDA.w #$4000
	JMP.w CODE_0FC74B

CODE_0FCB2D:
	JSL.l CODE_03A31E
	LDX.b #$09
	LDA.w #$5400
	JMP.w CODE_0FC74B

CODE_0FCB39:
	JSR.w CODE_0FC9D2
CODE_0FCB3C:
	RTS

CODE_0FCB3D:
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #$0030
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0070
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0090
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$00A0
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$3800
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$5800
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w #$7000
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$8000
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_089083>>16
	LDA.w #FXCODE_089083
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	JSL.l CODE_queue_dma_4args	: dl $7E51EC,$703372 : dw $01C0
	SEP.b #$10
	RTS

CODE_0FCB8A:
CODE_cutscene_oam_buffer_init:                       ; one-shot setup: init OAM buffer slots ($1400/$1800/$1C00) for cutscene render
	REP.b #$20
	LDX.b #$00
	LDA.w #$1400
	STA.b $00
	LDA.w #$1800
	STA.b $02
	LDA.w #$1C00
	STA.b $04
CODE_0FCB9D:
	LDA.b $00
	STA.w $13BE,x
	LDA.b $02
	STA.w $11BE,x
	CLC
	ADC.w #$0010
	STA.w $123E,x
	CLC
	ADC.w #$0010
	STA.w $12BE,x
	CLC
	ADC.w #$0010
	STA.w $133E,x
	LDA.b $04
	STA.w $11FE,x
	CLC
	ADC.w #$0010
	STA.w $127E,x
	CLC
	ADC.w #$0010
	STA.w $12FE,x
	CLC
	ADC.w #$0010
	STA.w $137E,x
	INC.b $02
	INC.b $04
	INX
	INX
	CPX.b #$20
	BCC.b CODE_0FCB9D
	LDA.w #$1840
	STA.b $02
	LDA.w #$1C40
	STA.b $04
CODE_0FCBEA:
	LDA.b $00
	STA.w $13BE,x
	LDA.b $02
	STA.w $11BE,x
	CLC
	ADC.w #$0010
	STA.w $123E,x
	CLC
	ADC.w #$0010
	STA.w $12BE,x
	CLC
	ADC.w #$0010
	STA.w $133E,x
	LDA.b $04
	STA.w $11FE,x
	CLC
	ADC.w #$0010
	STA.w $127E,x
	CLC
	ADC.w #$0010
	STA.w $12FE,x
	CLC
	ADC.w #$0010
	STA.w $137E,x
	INC.b $02
	INC.b $04
	INX
	INX
	CPX.b #$40
	BCC.b CODE_0FCBEA
	JSR.w CODE_0FCF2D
	LDA.w #$7E80
	STA.w $11BC
	JSR.w CODE_0FCCBC
	INC.w $0D15
	LDA.w #$00A0
	STA.w $11B6
	STZ.w $11B8
	STZ.w $11BA
	STZ.w $13FE
	STZ.w $1400
	STZ.w $1402
	LDA.w #$FFFF
	STA.b !RAM_YI_Global_Layer4YPosLo
	LDA.w #$0000
	STA.l YI_Global_PaletteMirror[$79].LowByte
	STA.l YI_Global_PaletteMirror[$7B].LowByte
	STA.l YI_Global_PaletteMirror[$7E].LowByte
	STA.l YI_Global_PaletteMirror[$7F].LowByte
	SEP.b #$20
	STZ.w $1404
	RTS

;-------------------------------------------------------------------------
; CODE_cutscene_script_tick -- cutscene script tick (called from gm07 each frame).
;
; Two-tier scheduler:
;   - $7E:11B6 (pre-stage hold timer): if non-zero, decrement and skip the
;     stage handler -- the cutscene is in a "wait N frames before next stage"
;     hold period.
;   - $7E:11B8 (stage index): selects one of 7 stage handlers via DATA_cutscene_script_step_ptr
;     (`JSR (DATA_cutscene_script_step_ptr,x)`). Stages run in sequence:
;       $00 CODE_0FCCA7 -- init: seed palette state, $1404 timer, $11BC ptr.
;       $01 CODE_0FCCBC -- alias of stage $04 (script-reader).
;       $02 CODE_0FCCC0 -- palette-fade pre-roll (ADC #$0421 fade ramp).
;       $03 CODE_0FCCF5 -- main script-reader (walks DATA_0FCD56 timeline).
;       $04 CODE_0FCDAA -- script-reader tail.
;       $05 CODE_0FCE63 -- exit/cleanup branch.
;       $06 CODE_0FCEA0 -- per-frame OAM-spawn dispatch (sprite-timeline-driven).
;
; After the stage handler: tail-check at CODE_0FCC83 detects "stage $06 with
; null entry pointer" -> sets $1402 (done flag) so gm07 advances next frame.
;
; INPUTS:
;   M=8 X=8 from gm07 caller.
;   $7E:11B6 = hold-timer; $7E:11B8 = stage index; $7E:11BA = script row offset.
; OUTPUTS:
;   Updates $7E:11B6 / $7E:11B8 / $7E:11BA / $7E:1402 / palette mirror.
; MODIFIES: A, X, Y; DP $00..$0F.
;-------------------------------------------------------------------------
CODE_0FCC6F:
CODE_cutscene_script_tick:                           ; per-frame cutscene timeline tick; $11B6 wait, $11B8 step index -> DATA_cutscene_script_step_ptr
	REP.b #$20
	LDA.w $11B6
	BNE.b CODE_0FCC80
	LDA.w $11B8
	ASL
	TAX
	JSR.w (DATA_cutscene_script_step_ptr,x)
	BRA.b CODE_0FCC83

CODE_0FCC80:
	DEC.w $11B6
CODE_0FCC83:
	LDA.w $11B8
	CMP.w #$0006
	BNE.b CODE_0FCC93
	LDX.w $11BA
	LDA.w DATA_0FCD56,x
	BEQ.b CODE_0FCC96
CODE_0FCC93:
	STZ.w $1402
CODE_0FCC96:
	SEP.b #$20
	RTS

DATA_0FCC99:
DATA_cutscene_script_step_ptr:                       ; 7-entry cutscene step dispatch; indexed by $11B8 (current step)
	dw CODE_0FCCA7
	dw CODE_0FCCBC
	dw CODE_0FCCC0
	dw CODE_0FCCF5
	dw CODE_0FCDAA
	dw CODE_0FCE63
	dw CODE_0FCEA0

CODE_0FCCA7:
	JSR.w CODE_0FCCF5
	LDA.w #$7E80
	STA.w $11BC
	STZ.w $1400
	LDA.w #$FFFF
	STA.b !RAM_YI_Global_Layer4YPosLo
	STZ.w $13FE
	RTS

CODE_0FCCBC:
	JSR.w CODE_0FCDAA
	RTS

CODE_0FCCC0:
	LDA.l YI_Global_PaletteMirror[$79].LowByte
	CLC
	ADC.w #$0421
	CMP.w #$8000
	BCC.b CODE_0FCCE4
	LDA.w $1404
	AND.w #$00FF
	ASL
	TAX
	LDA.w DATA_0FCEDB,x
	STA.w $11B6
	INC.w $1404
	INC.w $11B8
	LDA.w #$7FFF
CODE_0FCCE4:
	STA.l YI_Global_PaletteMirror[$79].LowByte
	STA.l YI_Global_PaletteMirror[$7B].LowByte
	STA.l YI_Global_PaletteMirror[$7E].LowByte
	STA.l YI_Global_PaletteMirror[$7F].LowByte
	RTS

CODE_0FCCF5:
	LDX.w $11BA
	LDA.w DATA_0FCD56,x
	BEQ.b CODE_0FCD4A
	CMP.w #$FFFF
	BEQ.b CODE_0FCD55
	STA.w $60A8
	LDA.w #DATA_0FCF78>>16
	STA.w $60AA
	SEP.b #$20
	LDA.w $012D
	PHA
	LDA.w $012E
	PHA
	LDA.b #$13
	STA.w $012D
	LDA.b #!SuperFX_ScreenMode_ScreenHeight_128pixels|!SuperFX_ScreenMode_ColorMode_16Colors|!SuperFX_ScreenMode_SuperFXHasWRAMAccess|!SuperFX_ScreenMode_SuperFXHasROMAccess|!SuperFX_ScreenMode_ColorMode_Unused
	STA.w $012E
	REP.b #$20
	LDX.b #FXCODE_09E9AF>>16
	LDA.w #FXCODE_09E9AF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	PLA
	STA.w $012E
	PLA
	STA.w $012D
	REP.b #$20
	INC.w $0D15
	INC.w $11B8
	INC.w $11BA
	INC.w $11BA
	INC.w $13FE
	INC.w $13FE
	BRA.b CODE_0FCD55

CODE_0FCD4A:
	LDA.w $1402
	BEQ.b CODE_0FCD55
	LDA.w #$0006
	STA.w $11B8
CODE_0FCD55:
	RTS

DATA_0FCD56:
	dw DATA_0FCF78,DATA_0FCF9A,$0000,DATA_0FCFD1,DATA_0FD00D,DATA_0FD042,DATA_0FD084,$0000
	dw DATA_0FD0C0,DATA_0FD0D9,$0000,DATA_0FD0F8,DATA_0FD108,DATA_0FD142,$0000,DATA_0FD174
	dw DATA_0FD1A8,DATA_0FD1C0,$0000,DATA_0FD1D2,DATA_0FD215,DATA_0FD24F,DATA_0FD25F,DATA_0FD293
	dw DATA_0FD2D1,DATA_0FD309,$0000,DATA_0FD327,DATA_0FD365,DATA_0FD395,$0000,DATA_0FD3C6
	dw DATA_0FD3DF,DATA_0FD420,DATA_0FD44B,$0000,DATA_0FD487,DATA_0FD4C3,DATA_0FD4ED,$0000
	dw DATA_0FD52A,$FFFF

CODE_0FCDAA:
	INC.w $11B8
	REP.b #$10
	LDA.w #$0000
	STA.b $01
	LDA.w $60B0
	BEQ.b CODE_0FCDD2
	LDY.w $11BC
	LDX.w $1400
	LDA.w DATA_0FCE38,x
	TAX
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	JSR.w CODE_0FCE40
	JSR.w CODE_0FCE4D
	BRA.b CODE_0FCDF9

CODE_0FCDD2:
	LDY.w $11BC
	LDX.w $1400
	LDA.w DATA_0FCE38,x
	TAX
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	JSR.w CODE_0FCE40
	JSR.w CODE_0FCE4D
	LDY.w $11BC
	LDX.w #$13BE
	LDA.w #$0040
	JSL.l CODE_vram_dma_queue_add_180_2118
	JSR.w CODE_0FCE4D
CODE_0FCDF9:
	LDY.w $11BC
	LDX.w $1400
	LDA.w DATA_0FCE38,x
	TAX
	LDA.w #$0080
	JSL.l CODE_vram_dma_queue_add_180_2118
	JSR.w CODE_0FCE40
	JSR.w CODE_0FCE4D
	LDY.w $11BC
	LDX.w #$13BE
	LDA.w #$0040
	JSL.l CODE_vram_dma_queue_add_180_2118
	JSR.w CODE_0FCE4D
	LDA.w $60B0
	BEQ.b CODE_0FCE35
	LDY.w $11BC
	LDX.w #$13BE
	LDA.w #$0040
	JSL.l CODE_vram_dma_queue_add_180_2118
	JSR.w CODE_0FCE4D
CODE_0FCE35:
	SEP.b #$10
	RTS

DATA_0FCE38:
	dw $11BE,$123E,$12BE,$133E

CODE_0FCE40:
	LDA.w $1400
	CLC
	ADC.w #$0002
	AND.w #$0007
	STA.w $1400
CODE_0FCE4D:
	LDA.w $11BC
	CLC
	ADC.w #$0020
	STA.w $11BC
	AND.w #$7FF0
	BNE.b CODE_0FCE62
	LDA.w #$7C00
	STA.w $11BC
CODE_0FCE62:
	RTS

CODE_0FCE63:
	LDX.w $13FE
	LDA.b !RAM_YI_Global_Layer4YPosLo
	CLC
	ADC.w #$0002
	STA.b !RAM_YI_Global_Layer4YPosLo
	CMP.w DATA_0FCE90-$02,x
	BCC.b CODE_0FCE8F
	LDA.w DATA_0FCE90-$02,x
	STA.b !RAM_YI_Global_Layer4YPosLo
	LDA.w #$0003
	STA.w $11B8
	LDA.w $1404
	AND.w #$00FF
	ASL
	TAX
	LDA.w DATA_0FCEDB,x
	STA.w $11B6
	INC.w $1404
CODE_0FCE8F:
	RTS

DATA_0FCE90:
	dw $002F,$005F,$008F,$00BF,$00EF,$011F,$014F,$017F

CODE_0FCEA0:
	LDA.l YI_Global_PaletteMirror[$79].LowByte
	SEC
	SBC.w #$0421
	BPL.b CODE_0FCECA
	INC.w $11BA
	INC.w $11BA
	JSR.w CODE_0FCF2D
	STZ.w $11B8
	LDA.w $1404
	AND.w #$00FF
	ASL
	TAX
	LDA.w DATA_0FCEDB,x
	STA.w $11B6
	INC.w $1404
	LDA.w #$0000
CODE_0FCECA:
	STA.l YI_Global_PaletteMirror[$79].LowByte
	STA.l YI_Global_PaletteMirror[$7B].LowByte
	STA.l YI_Global_PaletteMirror[$7E].LowByte
	STA.l YI_Global_PaletteMirror[$7F].LowByte
	RTS

DATA_0FCEDB:
	dw $0180,$0140,$0050,$0180,$01E0,$0100,$0130,$0020
	dw $00C0,$0100,$0050,$00A0,$01C0,$0180,$0050,$0170
	dw $0100,$0080,$0050,$0140,$0140,$0080,$0150,$0160
	dw $0160,$0120,$0050,$0180,$0180,$0180,$0050,$0090
	dw $0180,$0180,$0180,$0050,$0180,$0180,$0180,$0050
	dw $0000

CODE_0FCF2D:
	LDA.w #$0000
	STA.b $01
	REP.b #$10
	LDY.w #$7E60
	LDX.w #$13BE
	LDA.w #$0040
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7E80
	LDX.w #$13BE
	LDA.w #$0040
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7EA0
	LDX.w #$13BE
	LDA.w #$0040
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7EC0
	LDX.w #$13BE
	LDA.w #$0040
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDY.w #$7EE0
	LDX.w #$13BE
	LDA.w #$0040
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$10
	RTS

table "Tables/Fonts/Main.txt"

DATA_0FCF78:
	db $FE,$00,$FD,$00,$FC,$2E
	db "A long, long time ago ..."
	db $FE,$01,$FF

DATA_0FCF9A:
	db $FE,$02,$FD,$10,$FC,$38
	db "This is a story about"
	db $FE,$03,$FD,$18,$FC,$3A
	db "baby Mario and Yoshi."
	db $FF

DATA_0FCFD1:
	db $FE,$00,$FD,$00,$FC,$20
	db " A stork hurries across the"
	db $FE,$01,$FD,$08,$FC,$36
	db "dusky, pre-dawn sky."
	db $FF

DATA_0FD00D:
	db $FE,$02,$FD,$10,$FC,$30
	db "In his bill, he supports"
	db $FE,$03,$FD,$18,$FC,$4D
	db "a pair of twins."
	db $FF

DATA_0FD042:
	db $FE,$00,$FD,$00,$FC,$20
	db "Suddenly, a shadow appears"
	db $FE,$01,$FD,$08,$FC,$24
	db "in a gap between the clouds"
	db $FF

DATA_0FD084:
	db $FE,$02,$FD,$10,$FC,$30
	db "and races towards the"
	db $FE,$03,$FD,$18,$FC,$29
	db "stork with blinding speed."
	db $FF

DATA_0FD0C0:
	db $FE,$00,$FE,$01,$FD,$00,$FC,$10,$FB,$D2
	db "SCRREEEECH!!!"
	db $D2,$FF

DATA_0FD0D9:
	db $FE,$02,$FD,$10,$FC,$37,$D2
	db "THE BABIES ARE MINE!"
	db $D2,$FE,$03,$FF

DATA_0FD0F8:
	db $FE,$00,$FE,$01,$FD,$00,$FC,$54,$FB
	db "WOW!!!"
	db $FF

DATA_0FD108:
	db $FE,$02,$FD,$10,$FC,$30
	db "Snatching only one baby,"
	db $FE,$03,$FD,$18,$FC,$39
	db "the creature vanishes"
	db $FF

DATA_0FD142:
	db $FE,$00,$FD,$00,$FC,$47
	db "into the darkness"
	db $FE,$01,$FD,$08,$FC,$41
	db "from whence it came."
	db $FF

DATA_0FD174:
	db $FE,$00,$FD,$00,$FC,$34
	db "The second baby falls"
	db $FE,$01,$FD,$08,$FC,$3B
	db "undetected towards"
	db $FF

DATA_0FD1A8:
	db $FE,$02,$FE,$03,$FD,$10,$FC,$48
	db "the open sea..."
	db $FF

DATA_0FD1C0:
	db $FE,$00,$FE,$01,$FD,$00,$FC,$48,$FB
	db "OH NO..."
	db $FF

DATA_0FD1D2:
	db $FE,$00,$FD,$00,$FC,$28
	db "Meanwhile, here is Yoshi's"
	db $FE,$01,$FD,$08,$FC,$26
	db "Island, home to all Yoshies."
	db $FF

DATA_0FD215:
	db $FE,$02,$FD,$10,$FC,$4A
	db "It's a lovely day,"
	db $FE,$03,$FD,$18,$FC,$2D
	db "and Yoshi is taking a walk."
	db $FF

DATA_0FD24F:
	db $FE,$00,$FE,$01,$FD,$00,$FC,$4C,$FB
	db "HUH?!?"
	db $FF

DATA_0FD25F:
	db $FE,$02,$FD,$10,$FC,$28
	db "Suddenly, a baby drops in"
	db $FE,$03,$FD,$18,$FC,$4C
	db "onto his back."
	db $FF

DATA_0FD293:
	db $FE,$00,$FD,$00,$FC,$26
	db "The baby seems to be fine."
	db $FE,$01,$FD,$08,$FC,$30
	db "This is very fortunate!"
	db $FF

DATA_0FD2D1:
	db $FE,$02,$FD,$10,$FC,$2B
	db "Wha-?  Something else fell"
	db $FE,$03,$FD,$18,$FC,$4E
	db "with the baby ..."
	db $FF

DATA_0FD309:
	db $FE,$00,$FD,$00,$FC,$38
	db "Let's take a peek ..."
	db $FE,$01,$FF

DATA_0FD327:
	db $FE,$00,$FD,$00,$FC,$28
	db "It looks like a map. Maybe"
	db $FE,$01,$FD,$08,$FC,$30
	db "the stork was using it?"
	db $FF

DATA_0FD365:
	db $FE,$02,$FD,$10,$FC,$28
	db "But Yoshi can't figure it"
	db $FE,$03,$FD,$18,$FC,$58
	db "      out."
	db $FF

DATA_0FD395:
	db $FE,$00,$FD,$00,$FC,$2F
	db "Yoshi decides to talk to"
	db $FE,$01,$FD,$08,$FC,$5D
	db "his friends."
	db $FF

DATA_0FD3C6:
	db $FE,$00,$FE,$01,$FD,$00,$FC,$10,$FB
	db "AAAAAAAAAAKK!!!"
	db $FF

DATA_0FD3DF:
	db $FE,$02,$FD,$10,$FC,$28
	db "Kamek, the evil Magikoopa,"
	db $FE,$03,$FD,$18,$FC,$27
	db "and kidnapper of the baby,"
	db $FF

DATA_0FD420:
	db $FE,$00,$FD,$00,$FC,$34
	db "quickly dispatches his"
	db $FE,$01,$FD,$08,$FC,$6A
	db "toadies,"
	db $FF

DATA_0FD44B:
	db $FE,$02,$FD,$10,$FC,$2C
	db "when he discovers that he"
	db $FE,$03,$FD,$18,$FC,$36
	db "missed the other baby!"
	db $FF

DATA_0FD487:
	db $FE,$00,$FD,$00,$FC,$29
	db "Yoshi heads leisurely back"
	db $FE,$01,$FD,$08,$FC,$37
	db "to the other Yoshies,"
	db $FF

DATA_0FD4C3:
	db $FE,$02,$FD,$10,$FC,$38
	db "unaware of the danger"
	db $FE,$03,$FD,$18,$FC,$6A
	db "at hand."
	db $FF

DATA_0FD4ED:
	db $FE,$00,$FD,$00,$FC,$20
	db "Kamek's forces are actively"
	db $FE,$01,$FD,$08,$FC,$3A
	db "searching the island."
	db $FF

DATA_0FD52A:
	db $FE,$00,$FD,$00,$FC,$22
	db "Will these two children ever"
	db $FE,$01,$FD,$08,$FC,$21
	db "reach their parents safely?"
	db $FF

cleartable

CODE_0FD56E:
	LDA.w #$FFC0
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

DATA_0FD575:
	dw CODE_0FD589
	dw CODE_0FD5D2
	dw CODE_0FD67E
	dw CODE_0FD6FD

CODE_0FD57D:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0FD575,x)
	JSR.w CODE_0FD725
	RTS

CODE_0FD589:
	TYX
	LDA.w $70E2,x
	CMP.w #$0084
	BPL.b CODE_0FD5AA
	LDA.w #$0066
	STA.w $7A96,x
	LDA.w #$0058
	STA.w $7AF6,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0030
	STA.w $7A98,x
	INC.b $76,x
	RTS

CODE_0FD5AA:
	LDA.w $7A98,x
	BNE.b CODE_0FD5C3
	LDA.w #$0006
	STA.w $7A98,x
	INC.w $7402,x
	LDA.w $7402,x
	CMP.w #$0008
	BMI.b CODE_0FD5C3
	STZ.w $7402,x
CODE_0FD5C3:
	LDA.w $7AF8,x
	BNE.b CODE_0FD5D1
	LDA.w #$0002
	STA.w $7AF8,x
	DEC.w !RAM_YI_Global_Layer2XPosLo
CODE_0FD5D1:
	RTS

CODE_0FD5D2:
	TYX
	LDA.w $7AF6,x
	BNE.b CODE_0FD605
	DEC
	STA.w $7AF6,x
	LDA.w #$023D
	JSR.w CODE_0FBFCD
	LDA.w $70E2,x
	SEC
	SBC.w #$0010
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0070
	STA.w $7182,y
	LDA.w #$0700
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w $75E2,y
	LDA.w #$0100
	STA.w $7A36,y
CODE_0FD605:
	LDY.w $7402,x
	CPY.b #$09
	BEQ.b CODE_0FD625
	LDA.w $7A98,x
	BNE.b CODE_0FD624
	CPY.b #$06
	BNE.b CODE_0FD61B
	LDA.w #$0007
	STA.w $7402,x
CODE_0FD61B:
	LDA.w #$0002
	STA.w $7A98,x
	INC.w $7402,x
CODE_0FD624:
	RTS

CODE_0FD625:
	LDA.w $7A96,x
	BNE.b CODE_0FD639
	INC.w $7402,x
	LDY.b #$22
	STY.b $18,x
	LDA.w #$02E0
	STA.w $7A96,x
	INC.b $76,x
CODE_0FD639:
	RTS

DATA_0FD63A:
	db $1E,$22,$23,$24,$25,$24,$23,$1E,$22,$21,$1F,$20,$1F,$1E,$1E,$1D
	db $1C,$1B,$1A,$19,$18,$17,$16,$15,$14,$13,$12,$11,$10,$0F,$0E,$0D
	db $0C,$0B

DATA_0FD65C:
	db $FF,$04,$04,$04,$32,$03,$03,$10,$02,$02,$03,$04,$02,$F0,$FF,$24
	db $02,$02,$A0,$02,$02,$02,$02,$02,$02,$02,$02,$02,$20,$02,$02,$02
	db $02,$04

CODE_0FD67E:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0FD6CA
	DEC.b $18,x
	BPL.b CODE_0FD691
	LDA.w #$4005
	STA.w $7040,x
	INC.b $76,x
	RTS

CODE_0FD691:
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_0FD65C,y
	STA.w $7A98,x
	LDA.w DATA_0FD63A,y
	STA.w $7402,x
	REP.b #$20
	TAY
	CPY.b #$1C
	BNE.b CODE_0FD6BC
	LDA.w #$023F
	JSR.w CODE_0FBFCD
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	STY.b $78,x
CODE_0FD6BC:
	LDY.b $78,x
	BEQ.b CODE_0FD6CA
	LDA.w $7402,x
	SEC
	SBC.w #$001C
	STA.w $7402,y
CODE_0FD6CA:
	LDA.w $7A96,x
	BNE.b CODE_0FD6FC
	DEC
	STA.w $7A96,x
	LDA.w #$023C
	JSR.w CODE_0FBFCD
	LDA.w $70E2,x
	SEC
	SBC.w #$0012
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0070
	STA.w $7182,y
	LDA.w #$0400
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w $75E2,y
	LDA.w #$0040
	STA.w $7542,y
CODE_0FD6FC:
	RTS

CODE_0FD6FD:
	TYX
	RTS

DATA_0FD6FF:
	db $00,$01,$02,$03,$04,$05,$06,$07,$08,$09,$0A,$0B,$0C,$0D,$0D,$0E
	db $0F,$10,$11,$10,$0F,$11,$10,$10,$10,$10,$12,$13,$14,$15,$15,$15
	db $15,$15,$15,$14,$16,$16

CODE_0FD725:
	LDA.w $7402,x
	CMP.w $7A36,x
	BEQ.b CODE_0FD764
	STA.w $7A36,x
	REP.b #$10
	TAY
	LDA.w DATA_0FD6FF,y
	AND.w #$00FF
	ASL
	ASL
	ASL
	ASL
	TAY
	LDA.w #$0008
	STA.b $00
	PHX
	LDX.w #$0000
CODE_0FD747:
	LDA.w DATA_0FD765,y
	STA.w $6128,x
	CLC
	ADC.w #$0200
	STA.w $612A,x
	INX
	INX
	INX
	INX
	INY
	INY
	DEC.b $00
	BNE.b CODE_0FD747
	INC.w $0B85
	PLX
	SEP.b #$10
CODE_0FD764:
	RTS

DATA_0FD765:
	dw FXDATA_53C000+$0000,FXDATA_53C000+$0040,FXDATA_53C000+$0200,FXDATA_53C000+$0240,FXDATA_53C000+$0C00,FXDATA_53C000+$0C40,FXDATA_53C000+$2000,FXDATA_53C000+$2400
	dw FXDATA_53C000+$0080,FXDATA_53C000+$00C0,FXDATA_53C000+$0280,FXDATA_53C000+$02C0,FXDATA_53C000+$0C80,FXDATA_53C000+$0CC0,FXDATA_53C000+$2040,FXDATA_53C000+$2440
	dw FXDATA_53C000+$0100,FXDATA_53C000+$0140,FXDATA_53C000+$0300,FXDATA_53C000+$0340,FXDATA_53C000+$0D00,FXDATA_53C000+$0D40,FXDATA_53C000+$2080,FXDATA_53C000+$2480
	dw FXDATA_53C000+$0180,FXDATA_53C000+$01C0,FXDATA_53C000+$0380,FXDATA_53C000+$03C0,FXDATA_53C000+$0D80,FXDATA_53C000+$0DC0,FXDATA_53C000+$20C0,FXDATA_53C000+$24C0
	dw FXDATA_53C000+$0600,FXDATA_53C000+$0640,FXDATA_53C000+$0800,FXDATA_53C000+$0840,FXDATA_53C000+$1000,FXDATA_53C000+$1040,FXDATA_53C000+$2000,FXDATA_53C000+$2400
	dw FXDATA_53C000+$0680,FXDATA_53C000+$06C0,FXDATA_53C000+$0880,FXDATA_53C000+$08C0,FXDATA_53C000+$1080,FXDATA_53C000+$10C0,FXDATA_53C000+$2440,FXDATA_53C000+$2040
	dw FXDATA_53C000+$0700,FXDATA_53C000+$0740,FXDATA_53C000+$0900,FXDATA_53C000+$0940,FXDATA_53C000+$1100,FXDATA_53C000+$1140,FXDATA_53C000+$2480,FXDATA_53C000+$2080
	dw FXDATA_53C000+$0780,FXDATA_53C000+$07C0,FXDATA_53C000+$0980,FXDATA_53C000+$09C0,FXDATA_53C000+$1180,FXDATA_53C000+$11C0,FXDATA_53C000+$24C0,FXDATA_53C000+$20C0
	dw FXDATA_53C000+$1400,FXDATA_53C000+$1440,FXDATA_53C000+$1600,FXDATA_53C000+$1640,FXDATA_53C000+$1100,FXDATA_53C000+$1140,FXDATA_53C000+$2480,FXDATA_53C000+$2080
	dw FXDATA_53C000+$1480,FXDATA_53C000+$14C0,FXDATA_53C000+$1680,FXDATA_53C000+$16C0,FXDATA_53C000+$1100,FXDATA_53C000+$1140,FXDATA_53C000+$2480,FXDATA_53C000+$2080
	dw FXDATA_53C000+$1A60,FXDATA_53C000+$1AA0,FXDATA_53C000+$1AE0,FXDATA_53C000+$1AE0,FXDATA_53C000+$1180,FXDATA_53C000+$11C0,FXDATA_53C000+$2100,FXDATA_53C000+$2100
	dw FXDATA_53C000+$1B20,FXDATA_53C000+$1B60,FXDATA_53C000+$1BA0,FXDATA_53C000+$1BA0,FXDATA_53C000+$0C80,FXDATA_53C000+$0CC0,FXDATA_53C000+$2140,FXDATA_53C000+$2140
	dw FXDATA_53C000+$1A60,FXDATA_53C000+$1AA0,FXDATA_53C000+$1AE0,FXDATA_53C000+$1AE0,FXDATA_53C000+$0C00,FXDATA_53C000+$0C40,FXDATA_53C000+$2140,FXDATA_53C000+$2140
	dw FXDATA_53C000+$0000,FXDATA_53C000+$0040,FXDATA_53C000+$0200,FXDATA_53C000+$0240,FXDATA_53C000+$0C00,FXDATA_53C000+$0C40,FXDATA_53C000+$2140,FXDATA_53C000+$2140
	dw FXDATA_53C000+$0000,FXDATA_53C000+$0040,FXDATA_53C000+$0200,FXDATA_53C000+$0240,FXDATA_53C000+$0D00,FXDATA_53C000+$0D40,FXDATA_53C000+$2140,FXDATA_53C000+$2140
	dw FXDATA_53C000+$0000,FXDATA_53C000+$0040,FXDATA_53C000+$0200,FXDATA_53C000+$0240,FXDATA_53C000+$1100,FXDATA_53C000+$1140,FXDATA_53C000+$2140,FXDATA_53C000+$2140
	dw FXDATA_53C000+$0000,FXDATA_53C000+$0040,FXDATA_53C000+$0200,FXDATA_53C000+$0240,FXDATA_53C000+$0D00,FXDATA_53C000+$0D40,FXDATA_53C000+$2140,FXDATA_53C000+$2140
	dw FXDATA_53C000+$0000,FXDATA_53C000+$0040,FXDATA_53C000+$0200,FXDATA_53C000+$0240,FXDATA_53C000+$1180,FXDATA_53C000+$11C0,FXDATA_53C000+$2140,FXDATA_53C000+$2140
	dw FXDATA_53C000+$0100,FXDATA_53C000+$0140,FXDATA_53C000+$0200,FXDATA_53C000+$0240,FXDATA_53C000+$0D00,FXDATA_53C000+$0D40,FXDATA_53C000+$2140,FXDATA_53C000+$2140
	dw FXDATA_53C000+$1580,FXDATA_53C000+$15C0,FXDATA_53C000+$1780,FXDATA_53C000+$17C0,FXDATA_53C000+$0D00,FXDATA_53C000+$0D40,FXDATA_53C000+$2140,FXDATA_53C000+$2140
	dw FXDATA_53C000+$1A00,FXDATA_53C000+$1A20,FXDATA_53C000+$1C00,FXDATA_53C000+$1C20,FXDATA_53C000+$0D00,FXDATA_53C000+$0D40,FXDATA_53C000+$2140,FXDATA_53C000+$2140
	dw FXDATA_53C000+$1500,FXDATA_53C000+$1520,FXDATA_53C000+$1700,FXDATA_53C000+$1720,FXDATA_53C000+$0D00,FXDATA_53C000+$0D40,FXDATA_53C000+$2140,FXDATA_53C000+$2140
	dw FXDATA_53C000+$0000,FXDATA_53C000+$0040,FXDATA_53C000+$0200,FXDATA_53C000+$0240,FXDATA_53C000+$0D00,FXDATA_53C000+$0D40,FXDATA_53C000+$2140,FXDATA_53C000+$2140

CODE_0FD8D5:
	RTS

DATA_0FD8D6:
	db $00,$01,$01,$00,$00,$01,$01,$00

DATA_0FD8DE:
	db $00,$00,$04,$04,$06,$06,$02,$02

DATA_0FD8E6:
	dw $0060,$0074,$0076

DATA_0FD8EC:
	dw $0600,$FC00,$FE00,$0000

CODE_0FD8F4:
	LDY.b $78,x
	CPY.b #$06
	BNE.b CODE_0FD916
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w #$0001
	STA.w $7402,x
	LDA.w #$007C
	STA.w $7182,x
	LDA.w #$0804
	STA.w $7040,x
	RTS

CODE_0FD916:
	LDA.w DATA_0FD8E6,y
	CMP.w $7182,x
	BPL.b CODE_0FD931
	STA.w $7182,x
	INY
	INY
	STY.b $78,x
	LDA.w DATA_0FD8EC,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FF20
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0FD931:
	LDA.w $7A98,x
	BNE.b CODE_0FD965
	LDA.b $78,x
	AND.w #$0002
	LSR
	TAY
	LDA.w DATA_0FD8EC,y
	STA.b $00
	INC.b $18,x
	LDA.b $18,x
	BIT.w #$0008
	BEQ.b CODE_0FD94D
	STZ.b $18,x
CODE_0FD94D:
	TAY
	SEP.b #$20
	LDA.w DATA_0FD8DE,y
	EOR.b $00
	STA.w $7400,x
	LDA.b #$02
	STA.w $7A98,x
	LDA.w DATA_0FD8D6,y
	STA.w $7402,x
	REP.b #$20
CODE_0FD965:
	RTS

CODE_0FD966:
	RTS

DATA_0FD967:
	dw CODE_0FD9BA
	dw CODE_0FD9D4
	dw CODE_0FDA04
	dw CODE_0FDA3B
	dw CODE_0FDA8A
	dw CODE_0FD6FD

CODE_0FD973:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0FD967,x)
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	EOR.w #$FFFF
	INC
	CLC
	ADC.w #$0200
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #(FXDATA_548000+$20E0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_548000+$20E0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STZ.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	ASL
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$0800
	STA.w $0CF9
	LDX.b $12
	RTS

CODE_0FD9BA:
	TYX
	LDA.w #$0050
	CMP.w $7182,x
	BPL.b CODE_0FD9CB
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
CODE_0FD9CB:
	RTS

DATA_0FD9CC:
	dw $0140,$00C0

DATA_0FD9D0:
	dw $0020,$FFE0

CODE_0FD9D4:
	TYX
	LDY.b $78,x
	LDA.w $7A36,x
	CMP.w DATA_0FD9CC,y
	BEQ.b CODE_0FD9E7
	CLC
	ADC.w DATA_0FD9D0,y
	STA.w $7A36,x
	RTS

CODE_0FD9E7:
	INY
	INY
	STY.b $78,x
	CPY.b #$04
	BNE.b CODE_0FDA03
	LDA.w #$0080
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	INC.b $76,x
CODE_0FDA03:
	RTS

CODE_0FDA04:
	TYX
	LDA.w $7A36,x
	CMP.w #$0100
	BEQ.b CODE_0FDA14
	CLC
	ADC.w #$0010
	STA.w $7A36,x
CODE_0FDA14:
	LDA.w #$006E
	CMP.w $7182,x
	BPL.b CODE_0FDA2A
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	INC.b $76,x
CODE_0FDA2A:
	RTS

DATA_0FDA2B:
	dw $0140,$00C0,$0120,$0100

DATA_0FDA33:
	dw $0010,$FFF0,$0008,$FFF8

CODE_0FDA3B:
	TYX
	LDY.b $78,x
	LDA.w $7A36,x
	CMP.w DATA_0FDA2B,y
	BEQ.b CODE_0FDA4E
	CLC
	ADC.w DATA_0FDA33,y
	STA.w $7A36,x
	RTS

CODE_0FDA4E:
	INY
	INY
	CPY.b #$08
	BEQ.b CODE_0FDA57
	STY.b $78,x
	RTS

CODE_0FDA57:
	LDA.w #$0040
	STA.w $7A96,x
	STZ.b $78,x
	LDA.w #$007A
	STA.w $7AF6,x
	INC.b $76,x
	RTS

DATA_0FDA68:
	dw $00C0,$0140,$00C0,$0140,$00E0,$0100

DATA_0FDA74:
	dw $FFE0,$0020,$FFE0,$0020,$FFE0

DATA_0FDA7E:
	dw $0020,$0024,$0000,$0010,$0000,$0000

CODE_0FDA8A:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0FDACD
	LDA.w $7A98,x
	BNE.b CODE_0FDACD
	LDY.b $78,x
	LDA.w $7A36,x
	CMP.w DATA_0FDA68,y
	BEQ.b CODE_0FDAA8
	CLC
	ADC.w DATA_0FDA74,y
	STA.w $7A36,x
	BRA.b CODE_0FDACD

CODE_0FDAA8:
	INY
	INY
	STY.b $78,x
	LDA.w DATA_0FDA7E,y
	STA.w $7A98,x
	CPY.b #$0C
	BNE.b CODE_0FDACD
	LDY.b $18,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #$0080
	STA.w $7A98,y
	LDA.w #$2005
	STA.w $7040,x
	INC.b $76,x
	RTS

CODE_0FDACD:
	LDA.w $7AF6,x
	BNE.b CODE_0FDAF0
	DEC
	STA.w $7AF6,x
	LDA.w #$023E
	JSR.w CODE_0FBFCD
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w #$000A
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0002
	STA.w $7A98,y
	STY.b $18,x
CODE_0FDAF0:
	LDY.b $18,x
	BEQ.b CODE_0FDB2F
	LDA.w $7A36,x
	STA.w $7A36,y
	EOR.w #$FFFF
	INC
	CLC
	ADC.w #$0200
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$001C
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.b $18,x
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $7182,y
	LDA.w $7A98,y
	BNE.b CODE_0FDB2F
	INC
	STA.w $7402,y
CODE_0FDB2F:
	RTS

CODE_0FDB30:
	RTS

DATA_0FDB31:
	dw CODE_0FD6FD
	dw CODE_0FDBB0
	dw CODE_0FD6FD

DATA_0FDB37:
	dw FXDATA_548000+$20A1,FXDATA_548000+$2081,FXDATA_548000+$20E1,FXDATA_548000+$20C1,FXDATA_548000+$0081,FXDATA_548000+$00A1

CODE_0FDB43:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0FDB31,x)
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	EOR.w #$FFFF
	INC
	CLC
	ADC.w #$0200
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDY.b $78,x
	LDA.w #(FXDATA_548000+$0081)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w DATA_0FDB37,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STZ.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LSR
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$0800
	STA.w $0CF9
	LDX.b $12
	LDY.w $74A2,x
	BPL.b CODE_0FDB99
	SEP.b #$20
	LDA.b #$06
	STA.w $74A2,x
	REP.b #$20
CODE_0FDB99:
	RTS

DATA_0FDB9A:
	db $00,$08,$0A,$08,$00,$02,$04,$06,$04,$02,$00

DATA_0FDBA5:
	db $FF,$03,$40,$03,$03,$03,$04,$40,$03,$04,$30

CODE_0FDBB0:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0FDBD4
	DEC.b $18,x
	BPL.b CODE_0FDBC3
	INC.b $76,x
	LDA.w #$2005
	STA.w $7040,x
	RTS

CODE_0FDBC3:
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_0FDBA5,y
	STA.w $7A98,x
	LDA.w DATA_0FDB9A,y
	STA.b $78,x
	REP.b #$20
CODE_0FDBD4:
	RTS

CODE_0FDBD5:
	RTS

DATA_0FDBD6:
	dw $0090,$007C,$008C,$00A4

DATA_0FDBDE:
	dw $007B,$0076,$006E,$0077

DATA_0FDBE6:
	dw $0218,$01B0,$0190,$0180

CODE_0FDBEE:
	LDY.b #$07
	STY.b $16,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0008
	STA.b $00
CODE_0FDBFD:
	LDY.b $00
	LDA.w DATA_0FDBD6-$02,y
	STA.b $02
	LDA.w DATA_0FDBDE-$02,y
	STA.b $04
	LDA.w DATA_0FDBE6-$02,y
	STA.b $06
	LDA.w #$0241
	JSR.w CODE_0FBFCD
	LDA.b $02
	STA.w $70E2,y
	LDA.b $04
	STA.w $7182,y
	LDA.b $06
	STA.w $7A96,y
	LDA.b $00
	STA.w $7722,y
	LSR
	DEC
	STA.w $7402,y
	LDA.w #$0100
	STA.w $7A98,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LDA.w #$0100
	STA.w $7A36,y
	DEC.b $00
	DEC.b $00
	BNE.b CODE_0FDBFD
	LDA.w #$0242
	JSR.w CODE_0FBFCD
	LDA.w #$0060
	STA.w $70E2,y
	LDA.w #$0078
	STA.w $7182,y
	LDA.w #$0009
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	RTS

DATA_0FDC64:
	dw CODE_0FDC73
	dw CODE_0FDCB6
	dw CODE_0FDCEC

CODE_0FDC6A:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0FDC64,x)
	RTS

CODE_0FDC73:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0FDC7C
	STZ.w $7402,x
CODE_0FDC7C:
	LDA.w $7A96,x
	BNE.b CODE_0FDCB5
	INC.b $76,x
	DEC.b $16,x
	BNE.b CODE_0FDCA6
	LDA.w #$0014
	STA.w $7A98,x
	LDA.w #$0004
	STA.w $7402,x
	DEC
	STA.b $18,x
	INC.b $76,x
	LDA.w #$0004
	LDY.w $7A36,x
	BEQ.b CODE_0FDCA3
	LDA.w #$0001
CODE_0FDCA3:
	STA.b $16,x
	RTS

CODE_0FDCA6:
	INC.w $7402,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
CODE_0FDCB5:
	RTS

CODE_0FDCB6:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0FDCE7
	LDA.w #$0002
	STA.w $7402,x
	LDA.w #$0086
	CMP.w $7182,x
	BPL.b CODE_0FDCE7
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w #$0003
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w #$000A
	STA.w $7A96,x
	DEC.b $76,x
CODE_0FDCE7:
	RTS

DATA_0FDCE8:
	db $18,$98

DATA_0FDCEA:
	db $10,$90

CODE_0FDCEC:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0FDD41
	LDA.w $7402,x
	INC
	CMP.w #$0008
	BNE.b CODE_0FDCFE
	LDA.w #$0004
CODE_0FDCFE:
	STA.w $7402,x
	DEC.b $18,x
	BNE.b CODE_0FDD3B
	DEC.b $16,x
	BNE.b CODE_0FDD32
	LDA.w #$5005
	STA.w $7040,x
	LDA.w #$0003
	LDY.w $7A36,x
	BEQ.b CODE_0FDD1A
	LDA.w #$FFFF
CODE_0FDD1A:
	STA.b $16,x
	INC.w $7A36,x
	STZ.b $76,x
	LDA.w DATA_0FDCE8,y
	AND.w #$00FF
	STA.w $7A96,x
	LDA.w DATA_0FDCEA,y
	AND.w #$00FF
	BRA.b CODE_0FDD3E

CODE_0FDD32:
	LDY.b #$03
	STY.b $18,x
	LDA.w #$0014
	BRA.b CODE_0FDD3E

CODE_0FDD3B:
	LDA.w #$0004
CODE_0FDD3E:
	STA.w $7A98,x
CODE_0FDD41:
	RTS

CODE_0FDD42:
	RTS

DATA_0FDD43:
	dw FXDATA_548000+$4001,FXDATA_548000+$6001,FXDATA_548000+$6021,FXDATA_548000+$6041,FXDATA_548000+$6061

DATA_0FDD4D:
	dw $0000,$0020,$0040,$0060

DATA_0FDD55:
	dw CODE_0FDDB3
	dw CODE_0FDE06
	dw CODE_0FDE3D
	dw CODE_0FDE65
	dw CODE_0FDEFD
	dw CODE_0FDF25

CODE_0FDD61:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_0FDD55,x)
CODE_0FDD69:
	LDY.b $78,x
	LDA.w DATA_0FDD43,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #FXDATA_548000+$4001>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0200
	SEC
	SBC.w !REGISTER_SuperFX_R6_MultiplierLo
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDY.w $7722,x
	LDA.w DATA_0FDD4D-$02,y
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STZ.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0884A5>>16
	LDA.w #FXCODE_0884A5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #$0800
	STA.w $0CF9
	RTS

DATA_0FDDAB:
	dw $0048,$0120,$00C0,$0018

CODE_0FDDB3:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0FDDDA
	DEC.b $18,x
	LDY.b $18,x
	BNE.b CODE_0FDDC5
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
	RTS

CODE_0FDDC5:
	LDY.w $7722,x
	LDA.w DATA_0FDDAB-$02,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$000E
	STA.w $7A98,x
	LDA.w #$000A
	STA.w $7AF8,x
CODE_0FDDDA:
	LDY.b $18,x
	CPY.b #$01
	BNE.b CODE_0FDE05
	LDA.w $7A36,x
	LDY.w $7AF8,x
	BNE.b CODE_0FDDF6
	SEC
	SBC.w #$0030
	CMP.w #$0100
	BPL.b CODE_0FDE02
	LDA.w #$0100
	BRA.b CODE_0FDE02

CODE_0FDDF6:
	CLC
	ADC.w #$0010
	CMP.w #$0180
	BMI.b CODE_0FDE02
	LDA.w #$0180
CODE_0FDE02:
	STA.w $7A36,x
CODE_0FDE05:
	RTS

CODE_0FDE06:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0FDE05
	LDY.w $7722,x
	CPY.b #$02
	BNE.b CODE_0FDE24
	LDA.w #$0010
	STA.w $7A98,x
	LDA.w #$0002
	STA.b $16,x
	STA.b $78,x
	ASL
	STA.b $76,x
	RTS

CODE_0FDE24:
	LDY.b #$02
	STY.b $78,x
	LDA.w #$0010
	STA.w $7540,x
	LDA.w #$0040
	STA.w $75E2,x
	LDA.w #$0300
	STA.w $75E0,x
	INC.b $76,x
	RTS

CODE_0FDE3D:
	TYX
	LDA.w #$0078
	CMP.w $7182,x
	BNE.b CODE_0FDE4F
	LDA.w #$0010
	STA.w $7542,x
	INC.b $76,x
	RTS

CODE_0FDE4F:
	BPL.b CODE_0FDE55
	DEC.w $7182,x
	RTS

CODE_0FDE55:
	INC.w $7182,x
	RTS

DATA_0FDE59:
	dw $0002,$FFFE

DATA_0FDE5D:
	dw $000A,$0000

DATA_0FDE61:
	dw $0006,$0004

CODE_0FDE65:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0FDE89
	LDA.w #$0010
	STA.w $7A96,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_AmbSpr244_Invalid
	BNE.b CODE_0FDE7F
	LDA.w #$0040
	STA.w $7A96,x
CODE_0FDE7F:
	LDA.w $75E2,x
	EOR.w #$FFFF
	INC
	STA.w $75E2,x
CODE_0FDE89:
	LDA.w $7AF6,x
	BNE.b CODE_0FDEE0
	LDA.w #$0002
	STA.w $7AF6,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEP.b #$20
	EOR.b #$FF
	INC
	CMP.b #$80
	ROR
	REP.b #$20
	SEC
	SBC.w $7A38,x
	BEQ.b CODE_0FDEE0
	BPL.b CODE_0FDECE
	CMP.w #$FF80
	BMI.b CODE_0FDED3
CODE_0FDEC5:
	LDA.w $7A38,x
	SEC
	SBC.w #$0002
	BRA.b CODE_0FDEDA

CODE_0FDECE:
	CMP.w #$0080
	BPL.b CODE_0FDEC5
CODE_0FDED3:
	LDA.w $7A38,x
	CLC
	ADC.w #$0002
CODE_0FDEDA:
	AND.w #$00FF
	STA.w $7A38,x
CODE_0FDEE0:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.b $78,x
	CLC
	ADC.w DATA_0FDE59,y
	CMP.w DATA_0FDE5D,y
	BNE.b CODE_0FDEFA
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	EOR.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w DATA_0FDE61,y
CODE_0FDEFA:
	STA.b $78,x
	RTS

CODE_0FDEFD:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0FDF24
	DEC.b $16,x
	BNE.b CODE_0FDF1C
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0080
	STA.w $7542,x
	LDA.w #$0800
	STA.w $75E2,x
	INC.b $76,x
	RTS

CODE_0FDF1C:
	STZ.b $78,x
	LDA.w #$0020
	STA.w $7A98,x
CODE_0FDF24:
	RTS

CODE_0FDF25:
	TYX
	LDA.w #$0077
	CMP.w $7182,x
	BPL.b CODE_0FDF51
	STA.w $7182,x
	LDY.b #$02
	STY.b $78,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0010
	STA.w $7540,x
	STZ.w $7542,x
	LDA.w #$0040
	STA.w $75E2,x
	LDA.w #$0300
	STA.w $75E0,x
	LDY.b #$02
	STY.b $76,x
CODE_0FDF51:
	RTS

CODE_0FDF52:
	RTS

DATA_0FDF53:
	db $04,$02,$08,$02,$04,$02,$08,$04,$10

DATA_0FDF5C:
	db $01,$00,$02,$00,$01,$00,$02,$01,$00

CODE_0FDF65:
	LDA.w $7A98,x
	BNE.b CODE_0FDF85
	DEC.b $16,x
	BPL.b CODE_0FDF73
	LDA.w #$0008
	STA.b $16,x
CODE_0FDF73:
	SEP.b #$20
	LDY.b $16,x
	LDA.w DATA_0FDF53,y
	STA.w $7A98,x
	LDA.w DATA_0FDF5C,y
	STA.w $7402,x
	REP.b #$20
CODE_0FDF85:
	RTS

DATA_0FDF86:
	dw $0000,$0015,$0025

CODE_0FDF8C:
	LDY.b #$02
CODE_0FDF8E:
	LDA.w #$0100
	STA.w $7A96,x
	LDA.w #$FF40
	STA.w $75E0,x
	LDA.w #$00C0
	STA.b $76,x
	LDA.w #$0008
	STA.b $00
CODE_0FDFA4:
	LDY.b $00
	LDA.w DATA_0FDF86-$02,y
	STA.b $02
	LDA.w #$0244
	JSR.w CODE_0FBFCD
	LDA.w #$04E0
	STA.w $70E2,y
	LDA.w #$0040
	STA.w $7182,y
	LDA.b $02
	STA.w $7AF8,y
	LDA.b $00
	STA.w $7722,y
	LSR
	DEC
	STA.w $7402,y
	LDA.w #$0100
	STA.w $7A36,y
	LDA.w #$0002
	STA.w $7400,y
	DEC.b $00
	DEC.b $00
	BNE.b CODE_0FDFA4
	RTS

CODE_0FDFDF:
	LDA.w $7A96,x
	BNE.b CODE_0FDFEE
	INC
	STA.w $7540,x
	DEC.b $76,x
	BPL.b CODE_0FDFEE
	STZ.b $76,x
CODE_0FDFEE:
	LDA.w $7A98,x
	BNE.b CODE_0FE007
	LDA.w #$0006
	STA.w $7A98,x
	INC.w $7402,x
	LDA.w $7402,x
	CMP.w #$0008
	BMI.b CODE_0FE007
	STZ.w $7402,x
CODE_0FE007:
	LDA.b $18,x
	CLC
	ADC.b $76,x
	BIT.w #$FF00
	BEQ.b CODE_0FE017
	DEC.w !RAM_YI_Global_Layer2XPosLo
	AND.w #$00FF
CODE_0FE017:
	STA.b $18,x
	JSR.w CODE_0FD725
	RTS

CODE_0FE01D:
	RTS

CODE_0FE01E:
	LDA.w $7AF8,x
	BNE.b CODE_0FE055
	LDA.w $7A98,x
	BNE.b CODE_0FE04E
	DEC
	STA.w $7A98,x
	LDA.w #$FE80
	LDY.w $7722,x
	CPY.b #$08
	BNE.b CODE_0FE039
	LDA.w #$FD00
CODE_0FE039:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7542,x
	LDA.w #$0080
	STA.w $75E2,x
	LDA.w #$FF80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0FE04E:
	TXY
	JSR.w CODE_0FDE65
	JSR.w CODE_0FDD69
CODE_0FE055:
	RTS

; ============================================================================
; V1.1 / V1.0 split: the level-data pointer table lives in different banks.
;
; In V1.1 (this `if` branch, !ROM_YI_U2 set), %DATATABLE_YI_LevelDataPtrsAndEntranceData
; is emitted starting at $0F:E446. The 222-entry `Ptrs:` table itself begins at
; $0F:E822 inside that emission. See docs/levelloader.md S3 for the table semantics,
; and yi/Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm for per-entry annotations.
;
; In V1.0 (`else` branch, !ROM_YI_U2 == 0), this byte range is just blank
; FF-padding (the table lives in Bank17 at $17:F3E7 instead). The `FREE_BYTES`
; macro reserves 6058 bytes of `$FF` between $0FE056 and $0FFFFF in V1.0 builds.
;
; The `Ptrs:` label inside %DATATABLE_* resolves to whichever address the
; table lands at, so label-based references stay correct regardless of the
; V1.0/V1.1 physical-address difference.
; ============================================================================
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%DATATABLE_YI_LevelDataPtrsAndEntranceData($0FE446)
	%InsertGarbageData($0FED56, incbin, DATA_0FED56_YI_U2.bin)
else
	%FREE_BYTES($0FE056, 6058, $FF)
endif

DATA_0FF800:								; Note: Title screen tilemap
	dw $12E8,$12E8,$12E8,$12E8,$12E8,$12E8,$12E8,$12E8
	dw $12E8,$12E8,$12E8,$12E8,$12E8,$12E8,$12E8,$12E8
	dw $12E8,$12E8,$12E8,$12E8,$12E8,$12E8,$12E8,$12E8
	dw $12E8,$12E8,$12E8,$1284,$1286,$1288,$12E8,$12E8
	dw $12E8,$12E8,$12E8,$12E8,$12E8,$12E8,$12E8,$12E8
	dw $12E8,$1284,$1286,$1288,$12E8,$12E8,$12E8,$12E8
	dw $12E8,$12E8,$12E8,$12E8,$12E8,$12E8,$12E8,$12E8
	dw $12E8,$12E8,$12E8,$12E8,$12E8,$12E8,$12E8,$12E8
	dw $12E8,$12E8,$12E8,$12E8,$12E8,$12E8,$12E8,$12E8
	dw $12E8,$12E8,$12E8,$12E8,$12E8,$128C,$128E,$12E8
	dw $12E8,$1284,$1286,$1288,$12E8,$12E8,$12E8,$1284
	dw $1286,$1288,$128C,$128E,$12E8,$12E8,$12E8,$12E8
	dw $1280,$1282,$1284,$1286,$1288,$12E8,$12E8,$12E8
	dw $12E8,$12E8,$12E8,$12E8,$12AA,$12AC,$12AE,$12E8
	dw $12E8,$12E8,$12E8,$12E8,$12E8,$1280,$1282,$12E8
	dw $12E8,$12AA,$12AC,$12AE,$12E8,$12E8,$12E8,$12E8
	dw $12A0,$12A2,$12A4,$12A6,$12A8,$12E8,$12E8,$128C
	dw $128E,$12E8,$12E8,$12E8,$12CA,$12CC,$12CE,$12E8
	dw $12E8,$12E8,$12E8,$12E8,$12E8,$12C0,$12C2,$128C
	dw $128E,$12CA,$12CC,$12CE,$128C,$128E,$12E8,$12E8
	dw $12C0,$12C2,$12C4,$12C6,$12C8,$12E8,$12AA,$12AC
	dw $12AE,$12E8,$12E8,$12E8,$12EA,$12EC,$12EE,$12E8
	dw $1280,$1282,$12A4,$12A6,$12A8,$12C0,$12C2,$12AC
	dw $12AE,$12EA,$12EC,$12C6,$12C6,$12AE,$12E8,$12E8
	dw $16E0,$16E0,$16E0,$16E0,$16E0,$16E2,$16E2,$16E0
	dw $16E0,$16E2,$16E2,$16E2,$16E0,$16E0,$16E0,$16E2
	dw $16E0,$16E0,$16E0,$16E0,$16E2,$16E0,$16E0,$16E0
	dw $16E0,$16E0,$16E0,$16E0,$16E0,$16E0,$16E2,$16E2
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$12E4,$128A,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$12E4,$128A,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $12E4,$128A,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$12E4,$128A
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$12E4,$128A,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$12E4,$128A,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$12E4,$128A,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6,$16E6
	dw $16E6,$16E6,$16E6,$16E6,$12E4,$128A,$16E6,$16E6

; DATA_title_screen_logo_tilemap -- SMWC: Tilemap for the Title Screen logo (896 bytes).
DATA_0FFC80:
DATA_title_screen_logo_tilemap:
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2B00,$2F01,$2302,$2303
	dw $2304,$2B05,$2F06,$2F07,$2308,$2B09,$2F0A,$2722
	dw $2F0B,$2F0C,$2F0B,$2F0C,$2F0B,$2F0C,$2F0B,$2F0C
	dw $2F0B,$2F0C,$2F0B,$2F0C,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2B10,$2F11,$2312,$2313
	dw $2314,$2B15,$2F16,$2F17,$2318,$2B19,$2F1A,$2778
	dw $2F1B,$2F1C,$2F1B,$2F1C,$2F1B,$2F1C,$2F1B,$2F1C
	dw $2F1B,$2F1C,$2F1B,$2F1C,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2720,$2721,$277F,$A76A
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2723
	dw $2724,$2722,$2722,$2722,$2722,$2722,$A777,$277F
	dw $2725,$2726,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2727,$2728,$2729,$272A
	dw $272B,$272C,$E76A,$272D,$272E,$272F,$2722,$2730
	dw $2731,$2732,$2733,$2734,$2735,$2736,$2737,$2738
	dw $2739,$273A,$273B,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$273C,$273D,$273E
	dw $273F,$2740,$2741,$2742,$2743,$2744,$A76A,$2730
	dw $2745,$2746,$2747,$2748,$2749,$274A,$274B,$274C
	dw $274D,$274E,$274F,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2750,$2751
	dw $2752,$2753,$2754,$2755,$2756,$2757,$2740,$2730
	dw $2757,$2758,$2759,$275A,$275B,$275C,$2739,$275D
	dw $275E,$275F,$A73B,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2760,$2761
	dw $2762,$2763,$2764,$2765,$2766,$2767,$2768,$2730
	dw $2767,$2768,$2769,$276A,$276B,$276C,$276D,$276E
	dw $276F,$2770,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2771,$6772
	dw $2772,$2773,$2722,$2722,$2774,$2776,$A726,$2775
	dw $2776,$A726,$2722,$2722,$2722,$2722,$2777,$2775
	dw $2779,$277A,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $277B,$277C,$270D,$270E,$270F,$277D,$277E,$271D
	dw $271E,$271F,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722
	dw $2722,$2722,$2722,$2722,$2722,$2722,$2722,$2722

%BANK_END(<EndBank>)
endmacro
