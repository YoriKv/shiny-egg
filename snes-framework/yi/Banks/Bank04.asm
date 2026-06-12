;#############################################################################################################
;# Bank04.asm -- bank $04 normal-sprite handlers (Init/Main pairs for sprite IDs $005..$192).
;#
;# All routines are reachable via the normal-sprite Init/Main dispatchers in Bank $03 (see
;# Routines/ROUTINE_YI_NorSpr*_*.asm). Each Init builds initial sprite state from level-header data;
;# each Main runs every frame the sprite is active. State is held in the per-slot EXRAM tables
;# (!EXRAM_YI_Level_NorSpr_*) and the bank-0x6F00-shaped DP-relative tables ($6FA0, $7000, ...).
;#
;# Contents at a glance:
;#   $04:8000          -- shy-guy state-05 stub (TYX/RTS)
;#   $04:8002..$048330 -- icy/regular/fire watermelons ($005/$007/$009) + submarine torpedo ($015)
;#                        + watermelon flame ($018) + freeze watermelon ($006) + air bubble ($019)
;#   $04:8662..$048930 -- ski lift ($01A) + Dr Freezegood-on-ski-lift ($01D)
;#                        + vertical lava log ($01B)
;#   $04:8987..$049134 -- shy-guy + lantern ghost + shy-guy bandit trap ($01E/$133/$12A)
;#   $04:9135..$04951D -- Stretch ($124) + Petal Guy ($192)
;#   $04:9521..$049E3F -- Lunge Fish ($02C) + Potted Spiked Fun Guy ($031) + small pot ($0A1)
;#   $04:9E40..$04A29F -- Grim Leecher ($037)
;#   $04:A2A0..$04A6FF -- grey rotating wooden board ($050) + large wheel ($051)
;#                        + brown wooden boards ($05E/$05F)
;#   $04:A6AE..$04A904 -- moving red ($089) / pink ($08A) platforms
;#                        + line-guided platforms ($185..$18E) + spiral platform ($18F)
;#   $04:AC00..$04AF60 -- log seesaw ($07F) + buoyant round platform ($116) + large seesaw ($03D)
;#   $04:B354..$04C24F -- Bigger Boo boss ($016) -- intro cinematic + fight state machine
;#   $04:C250..$04C7BD -- 4-platform rotators ($055/$056/$064/$15E)
;#   $04:C7BE..$04CA60 -- bubbled 1-up ($100) + coin ($115)
;#   $04:CA61..$04CB50 -- Thunder Lakitu fire blasts ($049/$04A/$04B)
;#   $04:CB46..$04CC4E -- donut lifts ($117/$118)
;#   $04:CC4F..$04CDA0 -- number-platform explosion ($121)
;#   $04:CCAD..$04CE6F -- spike ($074) + spike ball ($075)
;#   $04:CFD2..$04D200 -- Milde ($108)
;#   $04:D1C3..$04D5E0 -- Mace Guy ($09B) + Mace ($09C)
;#   $04:D5E1..$04DAE7 -- 4 Red Toadies ($091) + Boo Guys' moving mace ($103)
;#   $04:DAFF..$04DCC2 -- Bowser-fight cloud ($083) -- transformation/cutscene chrome
;#   $04:DCC3..$04FF05 -- shared/leaf helpers (Yoshi transform support, sprite cleanup)
;#
;# Cross-references:
;#   Raidenthequick disassembly/bank04.asm -- best descriptive labels (init_melon, init_bigger_boo,
;#                                            bigger_boo_intro_growing, init_stretch, ...).
;#   ys_enmy*.asm  -- per-sprite enemy handlers split by engine sub-system; pick the
;#                    matching file by codename when navigating (e.g. ys_enmy3 has the
;#                    bobbing/floating physics, ys_enmy4 has the side-walker family).
;#   Constants/NormalSpriteIDs.asm        -- the !Define_YI_NorSpr* sprite-ID constants used here.
;#   Memory/SRAM_SpriteSlots.asm          -- layout of the $70:0EC0-1DF8 per-slot tables.
;#############################################################################################################

macro YIBank04Macros(StartBank, EndBank)
%BANK_START(<StartBank>)

;-------------------------------------------------------------------------
; Shy-guy state-05 stub. The shy-guy state-pointer table dispatches here
; for a no-op transition; TYX/RTS just keeps Y aligned with X and returns.
; Raidenthequick: (unlabeled) "shy guy state 05".
;-------------------------------------------------------------------------
CODE_048000:
CODE_shy_guy_state_05_stub:                  ; Raidenthequick: "; shy guy state 05"
	TYX
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Init for the three thrown-watermelon variants (icy/regular/fire).
; All three share the same physics + visual setup; the per-variant behaviour
; only branches in the Main handler at $048031.
;   - Seeds R0/R8 with the sprite's pixel coords (offset +8/+10) for the
;     SuperFX collision-check routine FXCODE_0ACE2F.
;   - Reads R7 mod 4 after that runs; if non-zero the melon has hit terrain
;     and we tail-fall into the "set bounce velocity + sprite flags" block.
; Raidenthequick: init_melon.
;
; See docs/family-misc.md §2 for the full Watermelon family breakdown
; ($005 icy / $007 regular / $009 fire + $006 freeze overlay + $018 flame
; puff, with corner-table $048335 dispatch and per-variant collision tick).
;-------------------------------------------------------------------------
YI_NorSpr005_IcyWatermelon_Init:
YI_NorSpr007_Watermelon_Init:
YI_NorSpr009_FireWatermelon_Init:
init_melon:                                       ; Raidenthequick: init_melon
;$048002
	JSL.l CODE_02A007                             ; shared sprite-Init prologue (bank $02)
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w $70E2,x                                 ; pixel X
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo        ; SuperFX R8 = X+8 for collision query
	LDA.w $7182,x                                 ; pixel Y
	CLC
	ADC.w #$0010
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16                      ; \ run SuperFX collision routine $0ACE2F
	LDA.w #FXCODE_0ACE2F                          ; /
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12                                     ; restore sprite-slot index
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$0003                                  ; bottom 2 bits of R7 = collided-with-terrain flag
	BNE.b CODE_048066                             ; if hit, fall into bounce-state setup
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Main for the three thrown watermelons. Walks the standard
; "respond to collisions / apply per-flavor extra effect / settle" loop.
;   - If the icy variant ($005), apply per-frame freezing helper at $048131.
;   - Bounce/spawn variant flavor is selected by sprite ID at $0480FC..$04812F.
; Raidenthequick: main_melon.
;-------------------------------------------------------------------------
YI_NorSpr005_IcyWatermelon_Main:
YI_NorSpr007_Watermelon_Main:
YI_NorSpr009_FireWatermelon_Main:
main_melon:                                       ; Raidenthequick: main_melon
;$048031
	JSL.l CODE_03AF23
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr005_IcyWatermelon
	BNE.b CODE_048041
	JSL.l CODE_melon_icy_freeze_tick
CODE_048041:
	LDA.w $7542,x
	BNE.b CODE_04809D
	LDY.w $7D36,x
	DEY
	BMI.b CODE_04809C
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_04809C
	LDA.w $7D38,y
	BEQ.b CODE_04809C
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDX.b $12
CODE_048060:
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_048066:
	LDA.w $6FA0,x
	AND.w #$F9FF
	ORA.w #$0220
	STA.w $6FA0,x
CODE_048072:
	LDA.w $6FA2,x
	ORA.w #$0001
	STA.w $6FA2,x
	LDA.w $7040,x
	ORA.w #$0004
	STA.w $7040,x
	LDA.w #$0005
	STA.w $74A2,x
	LDA.w $7042,x
	AND.w #$00CF
	ORA.w #$0020
	STA.w $7042,x
	LDA.w #$0040
	STA.w $7542,x
CODE_04809C:
	RTL

CODE_04809D:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0480BF
	JSL.l CODE_03A590
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0480BC
	CMP.w #$0200
	BCC.b CODE_0480BC
	LSR
	EOR.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_0480BF

CODE_0480BC:
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0480BF:
	LDY.b $18,x
	BEQ.b CODE_0480FC
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0480EB
	LDA.w $70E2,y
	SEC
	SBC.w $70E2,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_0480EB
	LDA.w $7182,y
	SEC
	SBC.w $7182,x
	CLC
	ADC.w #$001C
	CMP.w #$0038
	BCC.b CODE_0480FC
CODE_0480EB:
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	STZ.b $18,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JMP.w CODE_048066

CODE_0480FC:
	LDA.b $76,x
	BEQ.b CODE_048130
	LDY.w $7D36,x
	BPL.b CODE_048115
	JSL.l CODE_03A858
	LDA.w $7C16,x
	ASL
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_048124

CODE_048115:
	LDA.w $7860,x
	AND.w #$0001
CODE_04811B:
	BEQ.b CODE_048130
	LDA.w #!Define_YI_SoundID1F_HitHead
	JSL.l CODE_push_sound_queue
CODE_048124:
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_048130:
	RTL

; Icy-melon per-frame freeze helper. Decrements its own debounce at $7A96
; then jumps into the shared "spawn freeze fragment" routine in bank $03.
CODE_048131:
CODE_melon_icy_freeze_tick:                            ; Raidenthequick: (helper of main_melon)
	LDA.w $7A96,x
	BNE.b CODE_0480FC
	LDA.w #$000C
	STA.w $7A96,x
	JML.l CODE_03B5C3

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Init for the submarine torpedo ($015). Wraps the shared sprite-Init
; prologue ($03AD24) and seeds bounce/timer state when the spawn check
; succeeds.
; Raidenthequick: init_torpedo.
;-------------------------------------------------------------------------
YI_NorSpr015_SubmarineTorpedo_Init:
init_torpedo:                                     ; Raidenthequick: init_torpedo
;$048140
	JSL.l CODE_03AD24
	BCS.b CODE_048149
	JMP.w CODE_0481C0

CODE_048149:
	SEP.b #$20
	LDA.b #$7F
	STA.w $7863,x
	REP.b #$20
	RTL

;---------------------------------------------------------------------------

DATA_048153:
	dw $0000,$8040,$8000,$00C0,$8080,$0040,$0080,$80C0

DATA_048163:
	dw $0200,$FE00

DATA_048167:
	dw $0800,$F800

;-------------------------------------------------------------------------
; Main for the submarine torpedo. Runs the shared motion + collision passes,
; then walks an on-collision arming state machine and finally chooses one of
; eight cardinal-direction velocity vectors from DATA_048153 based on
; player-relative position. Plays a hit-head SFX on impact.
; Raidenthequick: main_torpedo.
;-------------------------------------------------------------------------
YI_NorSpr015_SubmarineTorpedo_Main:
main_torpedo:                                     ; Raidenthequick: main_torpedo
;$04816B
	JSL.l CODE_03AA2E
	JSL.l CODE_03AF23
	INC.b $16,x
	JSL.l CODE_03A2F8
	BCS.b CODE_0481C4
	LDY.w $7D36,x
	DEY
	BMI.b CODE_04819C
	LDA.w $6FA2,y
	AND.w #$6000
	BNE.b CODE_04819C
CODE_048189:
	SEP.b #$20
	LDA.w $74A0,y
	STA.w $74A0,x
	REP.b #$20
	TYX
	JSL.l CODE_03B507
	LDX.b $12
	BRA.b CODE_0481A1

CODE_04819C:
	LDA.w $7860,x
	BEQ.b CODE_0481C8
CODE_0481A1:
	LDA.w #!Define_YI_AmbSpr1C4
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$0003
	STA.w $7E4C,y
	LDA.w #$0002
	STA.w $7782,y
CODE_0481C0:
	JSL.l CODE_03A31E
CODE_0481C4:
	STZ.w $61C4
	RTL

CODE_0481C8:
	LDA.b $18,x
	LDY.w $7400,x
	BNE.b CODE_0481D3
	EOR.w #$00FF
	INC
CODE_0481D3:
	AND.w #$01FE
	STA.b $00
	LDY.w $7862,x
	BNE.b CODE_0481E3
	LDA.w #$0080
	JMP.w CODE_04827F

CODE_0481E3:
	LDA.b $16,x
	AND.w #$0007
	BEQ.b CODE_0481ED
	JMP.w CODE_048290

CODE_0481ED:
	TXA
	STA.w $6000
	LDX.b #FXCODE_098D5E>>16
	LDA.w #FXCODE_098D5E
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDY.w $6000
	BPL.b CODE_04820C
	LDX.b $12
	LDY.b #$00
	LDA.b $76,x
	BMI.b CODE_048209
	LDY.b #$02
CODE_048209:
	JMP.w CODE_04828C

CODE_04820C:
	LDY.b #$00
	LDA.w $6002
	BPL.b CODE_048219
	LDY.b #$04
	EOR.w #$FFFF
	INC
CODE_048219:
	CMP #$0100
	BCS.b CODE_04828E
	STA.b $02
	TAX
	LDA.w $6004
	BPL.b CODE_04822C
	INY
	INY
	EOR.w #$FFFF
	INC
CODE_04822C:
	CMP.w #$0100
	BCS.b CODE_04828E
	CMP.b $02
	BCC.b CODE_048239
	INY
	TAX
	LDA.b $02
CODE_048239:
	CPX.b #$10
	BCS.b CODE_04824D
	LDY.w $6000
	LDA.w $6FA0,y
	AND.w #$0200
	BEQ.b CODE_04824D
	LDX.b $12
	JMP.w CODE_048189

CODE_04824D:
	XBA
	STA.w !REGISTER_DividendLo
	STX.w !REGISTER_Divisor
	TYA
	ASL
	TAY
	NOP #4
	REP.b #$10
	LDA.w !REGISTER_QuotientLo
	ASL
	TAX
	CPX.w #$0202
	BCC.b CODE_04826A
	LDX.w #$0200
CODE_04826A:
	LDA.w DATA_048153,y
	ASL
	STA.b $02
	LDA.l FXDATA_0BB810,x
	BCC.b CODE_04827A
	EOR.w #$FFFF
	INC
CODE_04827A:
	CLC
	ADC.b $02
	SEP.b #$10
CODE_04827F:
	SBC.b $00
	LDY.b #$00
	AND.w #$0100
	BEQ.b CODE_04828A
	LDY.b #$02
CODE_04828A:
	LDX.b $12
CODE_04828C:
	STY.b $78,x
CODE_04828E:
	LDX.b $12
CODE_048290:
	LDY.b $78,x
	LDA.b $76,x
	CMP.w DATA_048167,y
	BEQ.b CODE_04829F
	CLC
	ADC.w DATA_048163,y
	STA.b $76,x
CODE_04829F:
	AND.w #$FF00
	BPL.b CODE_0482A7
	ORA.w #$00FF
CODE_0482A7:
	XBA
	CLC
	ADC.b $00
	AND.w #$01FE
	STA.b $00
	SEC
	SBC.w #$0081
	LDY.b #$02
	CMP.w #$00FF
	LDA.b $00
	BCS.b CODE_0482C6
	EOR.w #$00FF
	INC
	AND.w #$01FE
	LDY.b #$00
CODE_0482C6:
	STA.b $18,x
	PHA
	REP.b #$10
	TYA
	STA.w $7400,x
	TXY
	LDX.b $00
	LDA.l DATA_cosine_lut_8bit_radians,x
	ASL
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.l DATA_sine_lut_8bit_radians,x
	EOR.w #$FFFF
	INC
	ASL
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	PLA
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.w $7722,y
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w #FXDATA_540000+$30A0
	LDA.b $14
	AND.w #$0002
	BEQ.b CODE_048311
	LDY.w #FXDATA_540000+$30B0
CODE_048311:
	TYA
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$30A0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	SEP.b #$10
	LDX.b #FXCODE_08867E>>16
	LDA.w #FXCODE_08867E
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Watermelon-flame ($018) Init -- the spawn parent already set up state;
; nothing to do here.
; Raidenthequick: init_melon_flame.
;-------------------------------------------------------------------------
YI_NorSpr018_WatermelonFlame_Init:
init_melon_flame:                                 ; Raidenthequick: init_melon_flame
;$04832C
	RTL

;---------------------------------------------------------------------------

DATA_04832D:
	dw $0008,$FFF8,$0008,$FFF8

DATA_048335:
	dw $0008,$0008,$FFF8,$FFF8

;-------------------------------------------------------------------------
; Main for the small flame trail spawned by a fire-watermelon impact.
; Indexes the parent sprite-slot table at $700000 to inherit position,
; jitters the per-frame x/y by the corner table DATA_04832D/DATA_048335,
; then asks SuperFX bank $54 to draw the flame puff using FXCODE_08867E.
; Raidenthequick: main_melon_flame.
;-------------------------------------------------------------------------
YI_NorSpr018_WatermelonFlame_Main:
main_melon_flame:                                 ; Raidenthequick: main_melon_flame
;$04833D
	JSL.l CODE_03AF23
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.l $700007,x
	AND.w #$00FF
	CMP.w #$0089
	BNE.b CODE_04839D
	LDA.l $700006,x
	AND.w #$00FF
	ASL
	TAY
	LDA.l $700000,x
	AND.w #$FFF0
	CLC
	ADC.w DATA_04832D,y
	STA.w $6000
	LDA.l $700002,x
	AND.w #$FFF0
	CLC
	ADC.w DATA_048335,y
	STA.w $6002
	JSL.l CODE_00E01F
	SEP.b #$10
	LDA.w #!Define_YI_AmbSpr213
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $6000
	STA.w $70A2,y
	LDA.w $6002
	STA.w $7142,y
	LDA.w #$0008
	STA.w $73C2,y
	LDA.w #$0004
	STA.w $7782,y
CODE_04839D:
	SEP.b #$10
	LDX.b $12
	LDA.w $7A96,x
	AND.w #$0003
	BNE.b CODE_0483B8
	INC.w $7402,x
	LDA.w $7402,x
	CMP.w #$0004
	BCC.b CODE_0483B8
	JML.l CODE_03A31E

CODE_0483B8:
	LDA.w $7A38,x
	BNE.b CODE_048413
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_0483CA:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_048412
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0483E1
	LDA.w $7040,y
	AND.w #$0010
	BNE.b CODE_0483EC
CODE_0483E1:
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_RT_00DE47
	BRA.b CODE_0483CA

CODE_0483EC:
	LDA.w #$0012
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w $7FEE
	BNE.b CODE_048400
	LDA.w $6FA2,y
	AND.w #$FFE0
	STA.w $6FA2,y
CODE_048400:
	LDA.w #$0000
	STA.w $7A96,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w $7540,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
CODE_048412:
	RTL

CODE_048413:
	LDY.w $7D36,x
	BPL.b CODE_048427
	LDA.w $61D6
	BNE.b CODE_048427
	JSL.l CODE_03A858
	LDA.w #$0002
	STA.w $03BC
CODE_048427:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Freeze-effect "chill" overlay ($006) spawned when an icy melon connects.
; Init is a no-op (parent set the state).
; Raidenthequick: init_chill.
;-------------------------------------------------------------------------
YI_NorSpr006_WatermelonFreeze_Init:
init_chill:                                       ; Raidenthequick: init_chill
;$048428
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Main for the freeze chill effect -- ticks $7A96 (per-sprite frame timer)
; and $7402 (lifespan), passes its X to SuperFX FXCODE_099011 each frame
; to render the icy crystals, terminates via $03A31E (despawn) when timer
; underflows.
; Raidenthequick: main_chill.
;-------------------------------------------------------------------------
YI_NorSpr006_WatermelonFreeze_Main:
main_chill:                                       ; Raidenthequick: main_chill
;$048429
	JSL.l CODE_03AF23
	LDA.w $7A96,x
	BNE.b CODE_048441
	LDA.w #$0006
	STA.w $7A96,x
	DEC.w $7402,x
	BPL.b CODE_048441
	JML.l CODE_03A31E

CODE_048441:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_04844E:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_0484BF
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_04846A
	LDA.w $7D96,y
	BNE.b CODE_04846A
	LDA.w $7040,y
	AND.w #$0040
	BNE.b CODE_048475
CODE_04846A:
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_RT_00DE47
	BRA.b CODE_04844E

CODE_048475:
	TYX
	LDA.w #!Define_YI_SoundIDA0_FreezeEnemy
	JSL.l CODE_push_sound_queue
	LDA.w #$0200
	STA.w $7D96,x
	STZ.w $7A98,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
CODE_04849E:
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
	LDX.b $12
CODE_0484BF:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Air-bubble ($019) Init -- the spawn parent supplies all state; no-op.
; Raidenthequick: init_bubble.
;-------------------------------------------------------------------------
YI_NorSpr019_Bubble_Init:
init_bubble:                                      ; Raidenthequick: init_bubble
;$0484C0
	RTL

;---------------------------------------------------------------------------

DATA_0484C1:
	dw $0003,$0003,$0002,$0002,$0002,$0002,$0002,$0002
	dw $0002,$0002,$0002,$0002,$0002,$0002,$0002,$0002
	dw $0002,$0002,$0002,$0002,$0001,$0000

DATA_0484ED:
	dw $FFF0,$0010,$FFE8,$0018,$FFE0,$0020,$FFD8,$0028

DATA_0484FD:
	dw $0001,$0002,$0000,$0002

DATA_048505:
	dw $FE00,$0200,$FE00,$0200

;-------------------------------------------------------------------------
; Air-bubble Main -- pulses size + wobble through DATA_0484C1/0484ED/0484FD
; tables (radius / x-offset pairs / spawn-direction / launch-velocity),
; counts down via $7A96 + $7A98, eventually popping (RTL with despawn).
; Raidenthequick: main_bubble.
;-------------------------------------------------------------------------
YI_NorSpr019_Bubble_Main:
main_bubble:                                      ; Raidenthequick: main_bubble
;$04850D
	JSL.l CODE_03AF23
	LDA.w $7A96,x
	BNE.b CODE_048579
	LDA.w $7A98,x
	BEQ.b CODE_048528
	LSR
	BEQ.b CODE_048524
	JSL.l CODE_0485E5
	BRA.b CODE_04852C

CODE_048524:
	INC
	STA.w $7402,x
CODE_048528:
	JSL.l CODE_0485C9
CODE_04852C:
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.w #$0003
	ASL
	LDY.w $7221,x
	BPL.b CODE_048539
	INC
CODE_048539:
	ASL
	TAY
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w DATA_0484ED,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w DATA_0484ED,y
	BMI.b CODE_04855D
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.w #$0006
	CLC
	ADC.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	LDA.w #$0030
	STA.w $7A96,x
CODE_04855D:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CMP.w #$FF80
	BPL.b CODE_048578
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.w #$0003
	ASL
	ASL
	TAY
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w DATA_0484ED+$02,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_048578:
	RTL

CODE_048579:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$0001
	BNE.b CODE_048585
	JML.l CODE_03A31E

CODE_048585:
	BIT.w #$0003
	BNE.b CODE_0485C9
	LSR
	LSR
	ASL
	TAY
	LDA.w DATA_0484C1,y
	STA.w $7402,x
	DEC
	BEQ.b CODE_0485B3
	DEC
	BNE.b CODE_0485B9
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	BMI.b CODE_0485B9
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	INC.b $18,x
	LDA.b $18,x
	AND.w #$0003
	ASL
	TAY
	LDA.w DATA_0484FD,y
	STA.w $7402,x
	BRA.b CODE_0485B9

CODE_0485B3:
	DEC.w $7182,x
	DEC.w $7182,x
CODE_0485B9:
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.w #$0001
	BNE.b CODE_0485C2
	DEC
CODE_0485C2:
	CLC
	ADC.w $70E2,x
	STA.w $70E2,x
CODE_0485C9:
	LDY.w $7D36,x
	BPL.b CODE_0485E5
	LDY.w $77C2,x
	LDA.w DATA_048505,y
	STA.w $60B4
	LDA.w #$FA00
	STA.w $60AA
	LDA.w #$0008
	STA.w $60C0
	BRA.b CODE_04862A

CODE_0485E5:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_048654
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_048654
	LDA.w $7040,y
	AND.w #$0020
	BEQ.b CODE_048654
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr1A5_RunAwayMonkey
	BCC.b CODE_048609
	CMP.w #!Define_YI_NorSpr1AA_HotLips
	BCS.b CODE_048609
	PHX
	TYX
	STX.b $12
	JSL.l CODE_02B2BB
	TXY
	PLX
	STX.b $12
endif
CODE_048609:
	LDA.w $7C16,y
	ASL
	LDA.w #$FE00
	BCS.b CODE_048615
	LDA.w #$0200
CODE_048615:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0020
	STA.w $7D38,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
CODE_04862A:
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr1D0
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$000A
	STA.w $7E4C,y
	LDA.w #$0002
	STA.w $7782,y
	JML.l CODE_03A31E

CODE_048654:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Init for Dr Freezegood riding a ski lift ($01D). Spawns the lift partner
; (sprite ID $01C, see $03A34C) and chains into the shared ski-lift Init
; below. If the partner spawn fails (no free slot), bail to $04868A (RTL).
; Raidenthequick: init_freezegood_ski_lift.
;-------------------------------------------------------------------------
YI_NorSpr01D_DrFreezegoodOnSkiLift_Init:
init_freezegood_ski_lift:                         ; Raidenthequick: init_freezegood_ski_lift
;$048655
	LDA.w #$001C
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_init_ski_lift
	INY
	TYA
	STA.w $7A38,x
	SEP.b #$20
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	REP.b #$20
	LDA.w $703F,y
	AND.w #$FFF3
	STA.w $703F,y
CODE_048674:
	LDA.w $70E2,x
	STA.w $70E1,y
	LDA.w $7182,x
	CLC
	ADC.w #$000D
	STA.w $7181,y
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $721F,y
;-------------------------------------------------------------------------
; Ski-lift ($01A) Init -- shares a code path with the Dr-Freezegood-on-lift
; spawn block above (falls through into here). Returns once the lift state
; ($70E1/$7181/$721F) has been seeded.
; Raidenthequick: CODE_init_ski_lift.
;-------------------------------------------------------------------------
YI_NorSpr01A_SkiLift_Init:
CODE_init_ski_lift:                                    ; Raidenthequick: CODE_init_ski_lift
CODE_04868A:
	RTL

;---------------------------------------------------------------------------

DATA_04868B:
	dw $0007,$0005

DATA_04868F:
	dw $0006,$0004

DATA_048693:
	dw $0080,$FF80

DATA_048697:
	dw $FFFC,$0004,$FFF0,$0000,$000F,$FFFF,$FFF8,$0000
	dw $0008,$000F,$0008,$FFFF,$001F,$FFFF,$000F,$FFF0

DATA_0486B7:
	dw $FFE0,$0000,$0000,$0000,$0002,$0002,$FFFE,$FFFE
	dw $0001,$0001,$0001,$FFFF,$FFFF,$FFFF,$FFFC,$FFFC
	dw $FFFC,$0004

DATA_0486DB:
	dw $0004,$0004,$0000,$0000,$00B5,$00B5,$00B5,$00B5
	dw $00E4,$00E4,$00E4,$00E4,$00E4,$00E4,$0072,$0072
	dw $0072,$0072,$0072,$0072,$0100,$0100

;-------------------------------------------------------------------------
; Main for both ski-lift variants (riderless $01A and Freezegood-on-lift
; $01D). Off-screen-cull check via $03A2DE, then drives the lift along its
; cable; the dual entry means rider state lives in $7A38 (sibling slot)
; while the lift body uses the standard sprite-slot registers.
; Raidenthequick: main_ski_lift.
;-------------------------------------------------------------------------
YI_NorSpr01A_SkiLift_Main:
YI_NorSpr01D_DrFreezegoodOnSkiLift_Main:
main_ski_lift:                                    ; Raidenthequick: main_ski_lift
;$048707
	JSL.l CODE_despawn_sprite
	BCC.b CODE_04871B
	LDY.w $7A38,x
	BEQ.b CODE_04871A
	DEY
	TYX
	JSL.l CODE_03A31E
	LDX.b $12
CODE_04871A:
	RTL

CODE_04871B:
	JSL.l CODE_03AF23
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.l $700006,x
	SEP.b #$10
	LDX.b $12
	SEC
	SBC.w #$0092
	CMP.w #$0002
	BCS.b CODE_04877B
	ASL
	TAY
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w DATA_048693,y
	EOR.w DATA_048693,y
	BMI.b CODE_04874A
	LDA.w DATA_048693,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_04874A:
	LDA.w DATA_048697,y
	LDY.b #$00
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_04875A
	LDY.b #$02
CODE_04875A:
	CLC
	ADC.w #$0010
	CMP.w #$0020
	STZ.w $7402,x
	BCS.b CODE_048769
	INC.w $7402,x
CODE_048769:
	TYA
	STA.w $7400,x
	LDA.w $7182,x
	AND.w #$FFF0
	ORA.w #$0008
	STA.w $7182,x
	BRA.b CODE_0487E7

CODE_04877B:
	CMP.w #$0004
	BCC.b CODE_0487E7
	CMP.w #$0016
	BCS.b CODE_0487E7
	ASL
	TAY
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.l $700000,x
	AND.w #$000F
	STA.b $00
	SEP.b #$10
	LDX.w DATA_0486B7,y
	STX.w !REGISTER_Mode7MatrixParameterA
	LDX.w DATA_0486B7+$01,y
	STX.w !REGISTER_Mode7MatrixParameterA
	TAX
	STX.w !REGISTER_Mode7MatrixParameterB
	LDX.b $12
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	AND.w #$000F
	STA.b $02
	LDA.w !REGISTER_PPUMultiplicationProductLo
	CMP.w #$8000
	ROR
	CLC
	ADC.w DATA_048693,y
	CLC
	SBC.b $02
	BPL.b CODE_0487E7
	LSR.b $00
	LSR.b $00
	LSR.b $00
	ADC.w $7182,x
	STA.w $7182,x
	LDA.w #$0200
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w DATA_0486DB,y
	LDY.w $7400,x
	BNE.b CODE_0487E4
	EOR.w #$FFFF
	INC
CODE_0487E4:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0487E7:
	LDY.w $7400,x
	LDA.w DATA_04868B,y
	STA.w $74A2,x
	LDA.w $7A38,x
	BEQ.b CODE_048815
	LDA.w DATA_04868F,y
	LDY.w $7A38,x
	STA.w $74A1,y
	LDA.w $7400,x
	STA.w $73FF,y
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_04880F
	ASL
	ROL
	AND.w #$0001
	INC
CODE_04880F:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D7|!EXRAMBankMirror,y
	JMP.w CODE_048674

CODE_048815:
	LDA.b $78,x
	BEQ.b CODE_048862
	LDA.w $60C0
	BEQ.b CODE_048844
	LDA.w $60B4
	BNE.b CODE_048836
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.b $78,x
	BMI.b CODE_048836
	LDA.w $72C0,x
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BRA.b CODE_048867

CODE_048836:
	STZ.b $78,x
	LDA.w $60B4
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $60B4
	BRA.b CODE_0488B3

CODE_048844:
	STZ.b $78,x
	LDA.w DATA_04868F,y
	STA.w $611A
	LDA.w $7C16,x
	SEC
	SBC.w $72C0,x
	STA.w $7C16,x
	LDA.w $72C0,x
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BRA.b CODE_048867

CODE_048862:
	LDA.w $60C0
	BEQ.b CODE_0488B3
CODE_048867:
	LDA.w $60AA
	BMI.b CODE_0488B3
	LDY.w $0D94
	BNE.b CODE_0488B3
	LDA.w $7C16,x
	CLC
	ADC.w #$0014
	CMP.w #$0028
	BCS.b CODE_0488B3
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	CMP.w #$FFF4
else
	CMP.w #$FFF5
endif
	BCC.b CODE_0488B3
	STA.b $00
	LDY.w $61B6
	BEQ.b CODE_048895
	CPX.w $61B6
	BNE.b CODE_0488B3
CODE_048895:
	STX.w $61B6
	LDA.b $00
	INC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$0400
	STA.w $60AA
	INC.w $61B4
	STZ.w $60FA
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.b $78,x
	RTL

CODE_0488B3:
	CPX.w $61B6
	BNE.b CODE_0488BB
	STZ.w $61B6
CODE_0488BB:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Vertical lava-log ($01B) Init. The log defaults to an 8-pixel-radius
; collision; if the active BG1 tileset is the lava tileset (id $03) it
; widens further. Sets the high-priority sprite flag at $7863.
; Raidenthequick: init_lava_log.
;-------------------------------------------------------------------------
YI_NorSpr01B_VerticalLavaLog_Init:
init_lava_log:                                    ; Raidenthequick: init_lava_log
;$0488BC
	SEP.b #$20
	LDA.b #$FF
	STA.w $7863,x
	REP.b #$20
	LDA.w #$0008
	LDY.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CPY.b #$03
	BEQ.b CODE_0488D3
	CPY.b #$0D
	BNE.b CODE_0488D6
CODE_0488D3:
	LDA.w #$FFF6
CODE_0488D6:
	STA.w $7720,x
	STA.b $16,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Lava-log Main -- bounces vertically with a fixed FF80 cap on upward speed,
; clears the player's "standing on this sprite" sentinel when descending.
; Raidenthequick: main_lava_log.
;-------------------------------------------------------------------------
YI_NorSpr01B_VerticalLavaLog_Main:
main_lava_log:                                    ; Raidenthequick: main_lava_log
;$0488DC
	JSL.l CODE_03AF23
	LDY.w $7862,x
	BEQ.b CODE_0488FA
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_04890F
	STZ.b $18,x
	SEC
	SBC.w #$0008
	CMP.w #$FF80
	BCS.b CODE_048930
	LDA.w #$FF80
	BRA.b CODE_048930

CODE_0488FA:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_04891C
	STZ.b $18,x
	CLC
	ADC.w #$0008
	CMP.w #$0080
	BCC.b CODE_048930
	LDA.w #$0080
	BRA.b CODE_048930

CODE_04890F:
	LSR
	LSR
	LSR
	EOR.w #$FFFF
	INC
	CLC
	ADC.w #$FFFC
	BRA.b CODE_048927

CODE_04891C:
	EOR.w #$FFFF
	INC
	LSR
	LSR
	LSR
	CLC
	ADC.w #$0004
CODE_048927:
	CLC
	ADC.b $18,x
	STA.b $18,x
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_048930:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.b $78,x
	LDA.w $60AA
	BMI.b CODE_04899B
	LDA.w $6120
	CLC
	ADC.w #$0005
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7C16,x
	CMP.b $00
	BCS.b CODE_04899B
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w #$0010
	CMP.w #$FFF6
	BCC.b CODE_04899B
	INC
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $7720,x
	SEC
	SBC.b $16,x
	BNE.b CODE_048981
	LDA.w #$FFF8
	CLC
	ADC.b $16,x
	STA.w $7720,x
	LDA.w $60AA
	LSR
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_048981:
	LDA.w #$0100
	STA.w $60AA
	INC.w $61B4
	STZ.w $60FA
	LDA.w $7C16,x
	BNE.b CODE_048993
	INC
CODE_048993:
	ASL
	AND.w #$01FE
	STA.b $78,x
	BRA.b CODE_0489B2

CODE_04899B:
	LDA.w $7720,x
	SEC
	SBC.b $16,x
	BEQ.b CODE_0489B2
	LDA.b $16,x
	STA.w $7720,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0489B2:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Shy-guy bandit-trap ($12A) Init -- preloads $76 = 5, which jumps the
; shared shy-guy state pointer into the "in-trap, dispense at touch"
; branch (see CODE_shy_guy_state_05_stub above and the dispatch in $03).
; Raidenthequick: (init_shy_guy variant); shares Main with shyguy/ghost.
;-------------------------------------------------------------------------
YI_NorSpr12A_ShyGuyBanditTrap_Init:
init_shy_guy_bandit_trap:                         ; (variant of init_shy_guy)
;$0489B3
	LDY.b #$05
	STY.b $76,x
	RTL

;---------------------------------------------------------------------------

; DATA_shy_guy_palette_indices -- SMWC: Shy-Guy color indices (Green, Red, Yellow, Pink). Word-sized.
DATA_0489B8:
DATA_shy_guy_palette_indices:
	dw $0001,$0003,$0005,$0009

;-------------------------------------------------------------------------
; Shared Init for shy-guy ($01E) and lantern ghost ($133). Both use the
; same state-machine layout and OAM template; they only differ in tile
; / palette selection (decided in Main).
; Sets up: gravity flags ($6FA0/A2 = 0x0060/0x4000), draw priority $7040 = 5,
; despawn-on-screen-edge sentinel $74A2 = $00FF, zero head-bonk counter,
; shifts pixel-X by +8 to match the visual centre.
; Raidenthequick: init_shy_guy.
;-------------------------------------------------------------------------
YI_NorSpr01E_Shyguy_Init:
YI_NorSpr133_LanternGhost_Init:
init_shy_guy:                                     ; Raidenthequick: init_shy_guy
;$0489C0
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_0489F8
	JSL.l CODE_0EB8AE
	BNE.b CODE_0489F8
	LDA.w #$0060
	STA.w $6FA0,x
	LDA.w #$4000
	STA.w $6FA2,x
	LDA.w #$0005
	STA.w $7040,x
	LDA.w #$00FF
	STA.w $74A2,x
	STZ.w $7542,x
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w $70E2,x
	LDY.b #$08
	STY.b $76,x
	RTL

CODE_0489F8:
	JSL.l CODE_048A18
	JSL.l CODE_02A007
CODE_048A00:
	LDA.w #$0018
	STA.w $7A96,x
	LDA.w #$0004
	STA.b $16,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr01E_Shyguy
	BEQ.b CODE_048A17
	LDY.b #$02
	STY.b $78,x
CODE_048A17:
	RTL

CODE_048A18:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BIT.w #$0001
	BNE.b CODE_048A3C
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	STA.b $00
	LDA.w $7182,x
	AND.w #$0010
	LSR
	LSR
	ORA.b $00
	TAY
	LDA.w DATA_shy_guy_palette_indices,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_048A3C:
	AND.w #$00FE
	ORA.w #$0020
	STA.w $7042,x
	RTL

;---------------------------------------------------------------------------

; See docs/family-shyguys.md for the full Shy Guy family breakdown (~30 sprites sharing variants of this machine).
DATA_048A46:
DATA_shy_guy_state_ptr:                                ; 9-entry $76,x sub-state dispatch table
	dw CODE_shy_guy_state_00_walk                                ;  0: walk on ground
	dw CODE_shy_guy_state_01_turn                                ;  1: turn / wall-bump
	dw CODE_shy_guy_state_02_stunned                                ;  2: stunned (post hit)
	dw CODE_shy_guy_state_03_airborne                                ;  3: airborne / falling
	dw CODE_shy_guy_state_04_in_mouth                                ;  4: in Yoshi's mouth
	dw CODE_shy_guy_state_05_stub                                ;  5: trap-trigger stub
	dw CODE_shy_guy_state_06_emerge                                ;  6: emerge from trap or pipe (child rises out)
	dw CODE_shy_guy_state_07_pop_out                                ;  7: pop-out animation
	dw CODE_shy_guy_state_08_pipe_generator                                ;  8: pipe enemy generator (set when spawned on a pipe; proximity-gated emit)

;-------------------------------------------------------------------------
; Shared Main for shy-guy ($01E), shy-guy bandit trap ($12A), lantern ghost
; ($133). Reads the per-slot sub-state from $76,x and dispatches through
; the 9-entry pointer table DATA_shy_guy_state_ptr:
;   $00 -> CODE_shy_guy_state_00_walk (walking on ground)
;   $01 -> CODE_shy_guy_state_01_turn (turning)
;   $02 -> CODE_shy_guy_state_02_stunned (stunned)
;   $03 -> CODE_shy_guy_state_03_airborne (falling/airborne)
;   $04 -> CODE_shy_guy_state_04_in_mouth (eaten/in mouth)
;   $05 -> CODE_shy_guy_state_05_stub (the TYX/RTS stub for trap-trigger)
;   $06 -> CODE_shy_guy_state_06_emerge (child rises out of a bandit trap or a pipe)
;   $07 -> CODE_shy_guy_state_07_pop_out (pop-out animation)
;   $08 -> CODE_shy_guy_state_08_pipe_generator (pipe enemy generator -- skips pre-dispatch physics via CPY #$08, but IS dispatched)
; Raidenthequick: main_shy_guy.
;-------------------------------------------------------------------------
YI_NorSpr01E_Shyguy_Main:
YI_NorSpr12A_ShyGuyBanditTrap_Main:
YI_NorSpr133_LanternGhost_Main:
main_shy_guy:                                     ; Raidenthequick: main_shy_guy
;$048A58
	LDY.b $76,x
	CPY.b #$08
	BEQ.b CODE_048A8A
	JSR.w CODE_048ACB
	LDY.b $76,x
	CPY.b #$02
	BNE.b CODE_048A8A
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	SEC
	SBC.w #$0010
	ORA.w $7D96,x
	BNE.b CODE_048A8A
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_048AAB
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_048A8E
	JML.l CODE_kill_sprite_by_hit

CODE_048A8A:
	JSL.l CODE_03AF23
CODE_048A8E:
	LDY.b $76,x
	TYA
	ASL
	TXY
	TAX
	JSR.w (DATA_shy_guy_state_ptr,x)
	LDY.b $76,x
	CPY.b #$08
	BEQ.b CODE_048AAB
	LDA.w $7AF6,x
	BNE.b CODE_048AA8
	JSR.w CODE_048B8D
	JSR.w sprite_scan_for_thrown_hit
CODE_048AA8:
	JSR.w CODE_048AAC
CODE_048AAB:
	RTL

CODE_048AAC:
	LDA.w $6FA0,x
	AND.w #$FFBF
	LDY.b $76,x
	CPY.b #$04
	BEQ.b CODE_048AC3
	LDY.w $7A36,x
	BEQ.b CODE_048AC3
	DEC.w $7A36,x
	ORA.w #$0040
CODE_048AC3:
	STA.w $6FA0,x
	RTS

DATA_048AC7:
	dw $001B,$001C

CODE_048ACB:
	LDA.w $7722,x
	BMI.b CODE_048B0D
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_048ADD
	LDY.w $74A2,x
	BMI.b CODE_048B0A
CODE_048ADD:
	LDY.w $7403,x
	BNE.b CODE_048B0A
	LDA.w $7362,x
	BMI.b CODE_048B0A
	JSL.l CODE_03AA2E
	REP.b #$10
	LDY.w $7362,x
	LDA.w #$8000
	STA.w $6008,y
	STA.w $6010,y
	LDA.w $7040,x
	AND.w #$2000
	BEQ.b CODE_048B0A
	LDA.w #$8000
	STA.w $6018,y
	STA.w $6020,y
CODE_048B0A:
	SEP.b #$10
	RTS

CODE_048B0D:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_048B72
	LDA.w $7D96,x
	BNE.b CODE_048B0A
	LDY.b $76,x
	CPY.b #$04
	BEQ.b CODE_048B24
CODE_048B20:
	LDY.b $78,x
	BNE.b CODE_048B3E
CODE_048B24:
	REP.b #$10
	LDY.w $7362,x
	LDA.w $6004,y
	AND.w #$F1FF
	STA.w $6004,y
	LDA.w $600C,y
	AND.w #$F1FF
	STA.w $600C,y
	SEP.b #$10
	RTS

CODE_048B3E:
	LDY.b $79,x
	LDA.w $7AF8,x
	BNE.b CODE_048B58
	LDA.b $10
	AND.w #$0003
	INC
	INC
	STA.w $7AF8,x
	INY
	INY
	TYA
	AND.w #$0002
	TAY
	STY.b $79,x
CODE_048B58:
	LDA.w DATA_048AC7,y
	STA.b $02
	REP.b #$10
	LDY.w $7362,x
	LDA.w $6004,y
	ORA.b $02
	AND.w #$F1FF
	ORA.w #$0200
	STA.w $6004,y
	SEP.b #$10
CODE_048B72:
	RTS

CODE_048B73:
	LDA.w #$0020
	STA.w $7A36,x
	LDA.w $7722,x
	BMI.b CODE_048B82
	JSL.l CODE_03AEFD
CODE_048B82:
	JSR.w CODE_048C80
	PHB
	PHK
	PLB
	JSR.w CODE_048EBB
	PLB
	RTL

CODE_048B8D:
	LDY.w $7D36,x
	BMI.b CODE_048B9B
	CPX.w $61B6
	BNE.b CODE_048B9A
	STZ.w $61B6
CODE_048B9A:
	RTS

CODE_048B9B:
	LDY.b $76,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr074_Spike
	BNE.b CODE_048BAB
	CPY.b #$03
	BNE.b CODE_048BBB
	BRA.b CODE_048BAF

CODE_048BAB:
	CPY.b #$02
	BNE.b CODE_048BB4
CODE_048BAF:
	PLA
	JML.l CODE_kill_sprite_by_hit

CODE_048BB4:
	CPY.b #$05
	BNE.b CODE_048BBB
	JSR.w CODE_048D13
CODE_048BBB:
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCS.b CODE_048BD0
	PLA
	JSL.l CODE_03A813
CODE_048BD0:
	PLA
	STA.b $00
	JSL.l CODE_03A5B7
	LDA.b $00
	PHA
	RTS

CODE_048BDB:
	JSR.w sprite_scan_for_thrown_hit
	RTL

sprite_scan_for_thrown_hit:                       ; victim-side scan: GSU FXCODE_099011 walks all 24 slots for one whose hitbox overlaps this sprite (slot in R1, candidate back in R14). Shared by many enemy Mains, not Shy-Guy-specific.
CODE_048BDF:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_048BEC:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_048BF5
	BNE.b sprite_thrown_hit_handle_candidate
CODE_048BF5:
	RTS

CODE_048BF6:
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_048BEC

sprite_thrown_hit_handle_candidate:               ; overlap candidate found (Y = slot): if this sprite is already tumbling ($76,x = 2, or 3 for Spike) take the re-hit shortcut at CODE_048CED, else filter the candidate below
CODE_048C01:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr074_Spike
	BNE.b CODE_048C16
	LDA.b $76,x
	AND.w #$00FF
	CMP.w #$0003
	BNE.b sprite_thrown_hit_filter
	JMP.w CODE_048CED

CODE_048C16:
	LDA.b $76,x
	AND.w #$00FF
	CMP.w #$0002
	BNE.b sprite_thrown_hit_filter
	JMP.w CODE_048CED

sprite_thrown_hit_filter:                         ; candidate must be a live thrown projectile ($6FA0,y bit $0200, status $10, $7D38,y nonzero = thrown by Yoshi); Cactus Jack ignored, Shy-Guy-likes/Spike kill both, others knock this sprite into a tumble
CODE_048C23:
	LDA.w $6FA0,y
	AND.w #$0200
	BEQ.b CODE_048BF6
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_048BF6
	LDA.w $7D38,y
	BEQ.b CODE_048BF6
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr156_CactusJack
	BEQ.b CODE_048BF6
	CMP.w #!Define_YI_NorSpr01E_Shyguy
	BEQ.b CODE_048C54
	CMP.w #!Define_YI_NorSpr12A_ShyGuyBanditTrap
	BEQ.b CODE_048C54
	CMP.w #!Define_YI_NorSpr133_LanternGhost
	BEQ.b CODE_048C54
	CMP.w #!Define_YI_NorSpr074_Spike
	BNE.b CODE_048C5E
CODE_048C54:
	TYX
	JSL.l CODE_kill_sprite_by_hit
	PLA
	JML.l CODE_kill_sprite_by_hit

CODE_048C5E:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	PHP
	LDA.w #$0200
	PLP
	BPL.b CODE_048C6B
	LDA.w #$FE00
CODE_048C6B:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID67_EnemyTumbling
	JSL.l CODE_push_sound_queue
CODE_048C80:
	LDA.w #$0001
	STA.w $7D38,x
	LDA.w #$FFF0
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_048CA0
	LDA.w $7400,x
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_048CA0
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_048CA0:
	STZ.w $75E0,x
	STZ.w $7540,x
	LDY.b #$02
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr074_Spike
	BNE.b CODE_048CB2
	LDY.b #$03
CODE_048CB2:
	STY.b $76,x
	LDA.w #$0040
	STA.w $7542,x
	LSR
	ORA.w $7042,x
	STA.w $7042,x
	LDA.w #$0005
	STA.w $7402,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr01E_Shyguy
	BNE.b CODE_048CD1
	STZ.b $78,x
CODE_048CD1:
	LDA.w #$0841
	STA.w $6FA2,x
	STZ.w $7A38,x
	JSL.l CODE_03AD24
	BCS.b CODE_048CEC
	LDA.w $7042,x
	ORA.w #$0080
	STA.w $7042,x
	STZ.w $7402,x
CODE_048CEC:
	RTS

CODE_048CED:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_048CFD
	LDA.w $6FA2,y
	AND.w #$6000
	BEQ.b CODE_048D00
CODE_048CFD:
	JMP.w CODE_048BF6

CODE_048D00:
	LDA.w $6FA0,y
	AND.w #$0020
	BNE.b CODE_048CFD
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr156_CactusJack
	BEQ.b CODE_048CFD
	JMP.w CODE_048C54

CODE_048D13:
	LDA.w $61B2
	BPL.b CODE_048D5C
	LDA.w $7E48
	BEQ.b CODE_048D1F
	BPL.b CODE_048D5C
CODE_048D1F:
	JSL.l CODE_06BEBA
	LDA.w #$0020
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_048D40
	LDA.w $70E2,x
	STA.w $70E2,y
	STA.b $04
	LDA.w $7182,x
	STA.w $7182,y
	STA.b $06
	JSL.l CODE_048D5F
CODE_048D40:
	LDA.w #$000A
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	TXA
	STA.w $7E48
	LDA.w #$8000
	STA.w $0390
	LDA.w #$FFFF
	STA.w $0CD0
	LDA.w #$0020
	STA.w $0CC8
CODE_048D5C:
	PLA
	PLA
	RTL

CODE_048D5F:
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400
	EOR.w #$0002
	STA.w $7400,y
	LDA.w #$0000
	STA.w $7402,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	SEP.b #$20
	LDA.b #$0E
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	REP.b #$20
	STY.b $18
	LDA.b $04
	STA.w $70E2
	LDA.b $06
	SEC
	SBC.w #$000E
	STA.w $7182
	TYX
	JSL.l CODE_06BE72
	LDX.b $12
	RTL

DATA_048D98:
	dw $FEF4,$010C

DATA_048D9C:
	dw $FFA7,$0059

CODE_048DA0:
CODE_shy_guy_state_00_walk:                            ; shared with stretch (table at $0491BB)
	TYX
	LDA.w $7860,x
	LSR
	BCC.b CODE_048DAA
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_048DAA:
	LDA.w $7A96,x
	BNE.b CODE_048DC2
	DEC.b $16,x
	BEQ.b CODE_048DC3
	LDA.w #$0018
	STA.w $7A96,x
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_048DC2:
	RTS

CODE_048DC3:
	LDA.b $10
	AND.w #$0003
	BNE.b CODE_048DD1
	LDY.w $77C2,x
	TYA
	STA.w $7400,x
CODE_048DD1:
	LDY.w $7400,x
	LDA.w DATA_048D9C,y
	STA.w $75E0,x
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0020
	CPY.b #$00
	BNE.b CODE_048DEB
	EOR.w #$FFFF
	INC
CODE_048DEB:
	CLC
	ADC.w $70E2,x
	STA.w $7A38,x
	LDA.w #$0005
	STA.w $7540,x
	INC.b $76,x
	RTS

DATA_048DFB:
	dw $0004,$0008

DATA_048DFF:
	db $02,$02,$03,$03,$03,$03,$02,$01,$01,$02,$02,$02,$02,$01

DATA_048E0D:
	db $00,$03,$00,$02,$04,$01,$02

CODE_048E14:
CODE_shy_guy_state_01_turn:                            ; shared with stretch
	TYX
	LDA.w $7860,x
	BIT.w #$000C
	BNE.b CODE_048E90
	AND.w #$0001
	STA.b $00
	LDY.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	TYA
	ORA.b $00
	BEQ.b CODE_048E90
	LDA.w $70E2,x
	SEC
	SBC.w $7A38,x
	CLC
	ADC.w #$0008
	CMP.w #$0010
	BCC.b CODE_048E90
	LDA.w $7A98,x
	BNE.b CODE_048E8F
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr124_Stretch
	BNE.b CODE_048E63
	LDY.b #$00
	LDA.w $7540,x
	CMP.w #$0005
	BNE.b CODE_048E53
	INY
	INY
CODE_048E53:
	LDA.w DATA_048DFB,y
	STA.w $7A98,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
	RTS

CODE_048E63:
	INC.b $77,x
	LDY.b $77,x
	CPY.b #$07
	BMI.b CODE_048E6F
	LDY.b #$00
	STY.b $77,x
CODE_048E6F:
	LDA.w DATA_048E0D,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w $7540,x
	CMP.w #$0005
	BEQ.b CODE_048E86
	TYA
	CLC
	ADC.w #$0007
	TAY
CODE_048E86:
	LDA.w DATA_048DFF,y
	AND.w #$00FF
	STA.w $7A98,x
CODE_048E8F:
	RTS

CODE_048E90:
	LDA.w #$0018
	STA.w $7A96,x
	LDA.b $10
	AND.w #$0001
	CLC
	ADC.w #$0003
	STA.b $16,x
	LDY.b #$00
	STY.b $77,x
	STZ.w $7402,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.b $76,x
	RTS

DATA_048EB1:
	dw FXDATA_540000+$6020,FXDATA_540000+$2040

CODE_048EB5:
CODE_shy_guy_state_02_stunned:                         ; shared with stretch (post-hit recoil)
	TYX
	LDA.w $7722,x
	BMI.b CODE_048F0E
CODE_048EBB:
	LDA.w $7A38,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	AND.w #$00FF
	STA.w $7A38,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr074_Spike
	BNE.b CODE_048EDA
	LDA.w #FXDATA_540000+$20B0
	LDY.b #(FXDATA_540000+$20B0)>>16
	BRA.b CODE_048EE1

CODE_048EDA:
	LDY.b $78,x
	LDA.w DATA_048EB1,y
	LDY.b #(FXDATA_540000+$2040)>>16
CODE_048EE1:
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	TYA
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
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
CODE_048F0E:
	RTS

CODE_048F0F:
CODE_shy_guy_state_03_airborne:                        ; shared with stretch (in-air/fall)
	TYX
	LDA.w $7860,x
	AND.w #$001F
	BEQ.b CODE_048F21
	LDA.w #$0040
	STA.w $7542,x
	JSR.w CODE_048E90
CODE_048F21:
	RTS

CODE_048F22:
CODE_shy_guy_state_04_in_mouth:                        ; held inside Yoshi's mouth, awaiting spit/swallow
	TYX
	PLA
	STA.b $00
	JSL.l CODE_04C833
	LDA.b $00
	PHA
	LDA.w $7A96,x
	ORA.w $7542,x
	BNE.b CODE_048F56
	LDY.b $16,x
	BNE.b CODE_048F48
	LDA.b $10
	AND.w #$0018
	CLC
	ADC.w #$0020
	STA.w $7A96,x
	INC.b $16,x
	RTS

CODE_048F48:
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	STZ.b $16,x
CODE_048F56:
	RTS

CODE_048F57:
CODE_shy_guy_state_06_emerge:            ; child rises out of a bandit trap ($12A) or a pipe (seeded by the $08 pipe generator); spits upward then -> $07 pop-out
	TYX
	LDA.w $7A98,x
	BNE.b CODE_048F8B
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_048F76
	LDA.b $18,x
	CMP.w $7182,x
	BMI.b CODE_048F8B
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7A98,x
	RTS

CODE_048F76:
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #!Define_YI_SoundID77_EnemyJumpingOutOfPipe
	JSL.l CODE_push_sound_queue
	INC.b $76,x
CODE_048F8B:
	RTS

DATA_048F8C:
	dw $FF00,$0100

CODE_048F90:
CODE_shy_guy_state_07_pop_out:                         ; bandit-trap pop-out animation post-dispense
	TYX
	LDY.w $7223,x
	BMI.b CODE_048FA2
	LDA.w $7860,x
	LSR
	BCC.b CODE_048FCF
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $76,x
	RTS

CODE_048FA2:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_048FCF
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	CLC
	ADC.w #$000F
	JSL.l CODE_0EB8B7
	BEQ.b CODE_048FCF
	STZ.b $18,x
	LDA.w #$0E81
	STA.w $6FA2,x
	LDY.w $7400,x
	LDA.w DATA_048F8C,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_048FCF:
	RTS

CODE_048FD0:
CODE_shy_guy_state_08_pipe_generator:                  ; pipe enemy generator: init_shy_guy sets $76=$08 when spawned on a pipe tile; when Yoshi nears (and <7 live) spawns a child that emerges from the pipe
	TYX
	LDA.w $7A96,x
	ORA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	ORA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	BNE.b CODE_048FCF
	LDA.w $7C16,x
	CLC
	ADC.w #$001C
	CMP.w #$0038
	BCS.b CODE_048FF4
	LDA.w $7C18,x
	CLC
	ADC.w #$0021
	CMP.w #$0042
	BCC.b CODE_049063
CODE_048FF4:
	LDX.b #FXCODE_099204>>16
	LDA.w #FXCODE_099204
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0007
	BPL.b CODE_049063
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_04906B
	LDA.w $70E2,x
	STA.w $70E2,y
	CLC
	ADC.w #$0008
	STA.w $7CD6,y
	LDA.w $7182,x
	STA.w $7182,y
	SEC
	SBC.w #$0006
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	CLC
	ADC.w #$000E
	STA.w $7CD8,y
	SEP.b #$20
	LDA.w $77C2,x
	STA.w $7400,y
	REP.b #$20
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0000
	STA.w $7542,y
	LDA.w #$0E80
	STA.w $6FA2,y
	TYX
	LDY.b #$06
	STY.b $76,x
	JSL.l CODE_048A18
	JSL.l CODE_048A00
	LDA.w #!Define_YI_SoundID76_EnemyPeekingOutOfPipe
	JSL.l CODE_push_sound_queue
CODE_049063:
	LDX.b $12
	LDA.w #$00C0
	STA.w $7A96,x
CODE_04906B:
	RTS

;---------------------------------------------------------------------------

CODE_04906C:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr01E_Shyguy
	BEQ.b CODE_049086
	CMP.w #!Define_YI_NorSpr133_LanternGhost
	BEQ.b CODE_049086
	CMP.w #!Define_YI_NorSpr12A_ShyGuyBanditTrap
	BEQ.b CODE_049086
	CMP.w #!Define_YI_NorSpr09B_MaceGuy
	BEQ.b CODE_049086
	CMP.w #!Define_YI_NorSpr074_Spike
CODE_049086:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Stomp-from-above handler for shy-guy and lantern ghost. Invokes the
; "head-bonk lantern ghost" sub then arms a 1-frame despawn timer and
; jumps to the shared "explode into stars" routine $039F9F.
; Raidenthequick: head_bonk_lantern_ghost / stomp dispatch.
;-------------------------------------------------------------------------
YI_NorSpr01E_Shyguy_StompRt:
YI_NorSpr133_LanternGhost_StompRt:
stomp_shy_guy:                                    ; Raidenthequick: head_bonk_lantern_ghost
;$049087
	JSR.w CODE_048B20
	LDA.w #$0001
	STA.w $7402,x
	JML.l CODE_head_bop_common

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; "Yoshi gets caught / bandit grabs Yoshi" handler for the bandit trap.
; Compares $61D6 (current sprite triggering interaction) to the bandit's
; pickup ID ($87); if matched, flags the level for a forced-exit cinema
; via $7E48 = $FFFF. Otherwise sets the "rideable" flag block.
; Raidenthequick: ride_bandit_shyguy.
;-------------------------------------------------------------------------
YI_NorSpr12A_ShyGuyBanditTrap_RideYoshiRt:
ride_bandit_shyguy:                               ; Raidenthequick: ride_bandit_shyguy
;$049094
	JSR.w CODE_04909B
	JSR.w CODE_0490AF
	RTL

CODE_04909B:
	LDA.w $61D6
	CMP.w #$0087
	BNE.b CODE_0490F0
	LDA.w #$FFFF
	STA.w $7E48
	BRA.b CODE_0490B4

DATA_0490AB:
	dw $0100,$FF00

CODE_0490AF:
	LDA.w $61B2
	BPL.b CODE_0490F0
CODE_0490B4:
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7AF6,x
	LDA.w #$0018
	STA.w $7A96,x
	LDA.w #$0004
	STA.b $16,x
	STZ.b $76,x
	LDA.w #!Define_YI_NorSpr01E_Shyguy
	STA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7D38,x
	ASL
	EOR.w $60C4
	TAY
	LDA.w DATA_0490AB,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $0390
CODE_0490F0:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Stretch ($124) Init -- the goofy elastic enemy from World 5 caves.
; Allocates a SuperFX dynamic-tile slot via $03AD74, primes the negated-X
; mirror at $7A36 (used by the bend animation), enters sub-state $06
; (extending) at $76, and pre-builds the first OAM frame via CODE_04942A.
; Raidenthequick: init_stretch.
;-------------------------------------------------------------------------
YI_NorSpr124_Stretch_Init:
init_stretch:                                     ; Raidenthequick: init_stretch
;$0490F1:
	LDA.w #$0018
	STA.w $7A96,x
	LDA.w #$0004
	STA.b $16,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BPL.b CODE_049129
	JSL.l CODE_03AD74
	BCC.b CODE_049132
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w $7A36,x
	LDA.w #$2079
	STA.w $7040,x
	LDA.w #$0002
	STA.w $7402,x
	LDY.b #$06
	STY.b $76,x
	JSR.w CODE_04942A
	LDA.w $6020
	BRA.b CODE_049132

CODE_049129:
	LDA.w #$01FF
	STA.w $7A36,x
	LDA.w #$001E
CODE_049132:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	JML.l CODE_048A18

;---------------------------------------------------------------------------

DATA_049139:
DATA_stretch_state_ptr:                                ; 7-entry $76,x sub-state dispatch
	dw CODE_shy_guy_state_00_walk                                ;  0: walk on ground (shared with shy_guy)
	dw CODE_shy_guy_state_01_turn                                ;  1: turn / wall-bump (shared with shy_guy)
	dw CODE_stretch_state_02_swing_toward_yoshi                                ;  2: stretched-out, swing toward Yoshi
	dw CODE_stretch_state_03_pull_yoshi                                ;  3: tug Yoshi back into stretch's body
	dw CODE_stretch_state_04_retract                                ;  4: retract / contract
	dw CODE_stretch_state_05_fly_out_defeated                                ;  5: fly-out post-defeat
	dw CODE_stretch_state_06_despawn                                ;  6: despawn / cleanup

;-------------------------------------------------------------------------
; Stretch Main -- dispatches to one of seven sub-state handlers via the
; pointer block immediately above ($7 entries). Off-screen cull,
; player-distance check, then per-state behaviour (idle / pulling / fully
; extended / retracting / fly-out / despawn).
; Raidenthequick: main_stretch.
;-------------------------------------------------------------------------
YI_NorSpr124_Stretch_Main:
main_stretch:                                     ; Raidenthequick: main_stretch
;$049147
	LDA.w $7722,x
	BMI.b CODE_049150
	JSL.l CODE_03AA52
CODE_049150:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_04916C
	LDY.w $74A2,x
	BPL.b CODE_04916C
	LDA.w $7722,x
	BMI.b CODE_04916C
	LDA.w $7A36,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_04916C:
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_stretch_state_ptr,x)
	STZ.b $02
	JSR.w CODE_049351
	BCC.b CODE_049194
	JSL.l CODE_03AD74
	BCC.b CODE_049194
	LDA.w #$2079
	STA.w $7040,x
	LDA.w #$0002
	STA.w $7402,x
	STA.b $76,x
	RTL

CODE_049194:
	JML.l CODE_0DC14C

DATA_049198:
	dw $FC00,$0400

DATA_04919C:
	dw $FFF8,$0008

CODE_0491A0:
CODE_stretch_state_02_swing_toward_yoshi:              ; arm extends, may spit projectile sub-spawn
	TYX
	PLA
	LDA.w $7A36,x
	SEC
	SBC.w #$0020
	CMP.w #$0020
	BPL.b CODE_0491B1
	LDA.w #$0020
CODE_0491B1:
	STA.w $7A36,x
	LDA.w $0036
	AND.w $6084
	BEQ.b CODE_0491C9
	LDA.w $60A8
	STA.b $78,x
	LDY.b #$05
	STY.b $76,x
	JSR.w CODE_049401
	RTL

CODE_0491C9:
	JSR.w CODE_049306
	BCS.b CODE_0491D0
	INC.b $76,x
CODE_0491D0:
	LDA.w $7A36,x
	CMP.w #$0020
	BEQ.b CODE_049242
	LDA.w $7A98,x
	BNE.b CODE_049242
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0005
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w $7400,x
	LDA.w DATA_049198,y
	STA.b $00
	LDA.w DATA_04919C,y
	STA.b $02
	LDA.w #$0107
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_049242
	LDA.w $70E2,x
	CLC
	ADC.b $02
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $7182,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.w $7D38,y
	STA.w $7A38,y
	LDA.w #$FFFF
	STA.w $7862,y
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w #!Define_YI_SoundID45_SpitSeed
	JSL.l CODE_push_sound_queue
CODE_049242:
	RTL

CODE_049243:
CODE_stretch_state_06_despawn:                         ; degenerate "pull short" -- routes to retract
	TYX
	PLA
	LDA.w #$0020
	BRA.b CODE_04924F

CODE_04924A:
CODE_stretch_state_03_pull_yoshi:                      ; tug Yoshi into the stretch body
	TYX
	PLA
	LDA.w #$0080
CODE_04924F:
	CLC
	ADC.w $7A36,x
	CMP.w #$01FF
	BMI.b CODE_049269
	LDA.w #$FE9A
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.b #$04
	STY.b $76,x
	LDA.w #$01FF
	STA.w $7A36,x
	RTL

CODE_049269:
	STA.w $7A36,x
	JSR.w CODE_049306
	BCC.b CODE_049275
	LDY.b #$02
	STY.b $76,x
CODE_049275:
	RTL

CODE_049276:
CODE_stretch_state_04_retract:                         ; shorten arm back to body, restore idle GFX
	TYX
	PLA
	LDA.w $7A36,x
	SEC
	SBC.w #$0010
	CMP.w #$01FF
	BPL.b CODE_0492B7
	STZ.w $7402,x
	LDA.w #$01FF
	STA.w $7A36,x
	LDA.w #$001E
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	JSL.l CODE_03AEFD
	LDA.w #$1079
	STA.w $7040,x
	LDA.w #$0018
	STA.w $7A96,x
	LDA.b $10
	AND.w #$0001
	CLC
	ADC.w #$0003
	STA.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.b $76,x
	RTL

CODE_0492B7:
	STA.w $7A36,x
	JSR.w CODE_049306
	BCC.b CODE_0492C3
	LDY.b #$02
	STY.b $76,x
CODE_0492C3:
	RTL

CODE_0492C4:
CODE_stretch_state_05_fly_out_defeated:                ; star-explosion + impulse after lock-down
	TYX
	PLA
	LDA.w $7A36,x
	CLC
	ADC.w #$0060
	CMP.w #$01FF
	BMI.b CODE_0492FB
	LDA.w #$01FF
	STA.w $7A36,x
	LDA.b $78,x
	STA.w $60A8
	LDA.w #$F800
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	INC.w $7E0A
	LDA.w #$FD34
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	DEC.b $76,x
	RTL

CODE_0492FB:
	STA.w $7A36,x
	JSR.w CODE_049401
	RTL

;---------------------------------------------------------------------------

DATA_049302:
	dw $0166,$FE9A

CODE_049306:
	JSR.w CODE_04942A
	LDA.w $7AF6,x
	BNE.b CODE_04932C
	LDA.w $6020
	PHA
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.w $72C2,x
	STA.b $02
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $7C16,x
	CLC
	ADC.w #$000E
	CMP.w #$001C
	BCC.b CODE_04932F
CODE_04932C:
	JMP.w CODE_0493F7

CODE_04932F:
	SEC
	SBC.w #$0004
	CMP.w #$0014
	BCC.b CODE_049365
	BPL.b CODE_04933F
	LDA.w #$0080
	BRA.b CODE_049342

CODE_04933F:
	LDA.w #$FF80
CODE_049342:
	STA.w $60A8
	STA.w $60B4
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_049365

CODE_049351:
	LDA.w $7AF6,x
	BNE.b CODE_04932C
	LDA.w $7C16,x
	CLC
	ADC.w #$000E
	CMP.w #$001C
	BCC.b CODE_049365
	JMP.w CODE_0493F7

CODE_049365:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.w #$0008
	STA.b $00
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.b $02
	DEC
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BPL.b CODE_0493F7
	CMP.b $00
	BMI.b CODE_0493C1
	LDY.w $60AB
	BMI.b CODE_0493F7
	LDY.w $0D94
	BNE.b CODE_0493F7
	CPX.w $61B6
	BEQ.b CODE_04939D
	LDY.w $61B6
	BNE.b CODE_0493F7
	STX.w $61B6
CODE_04939D:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDY.b #$00
	STY.w !EXRAM_YI_Player_SubYPosLo|!EXRAMBankMirror
	STZ.w $60AA
	STZ.w $60D4
	INC.w $61B4
	SEC
	RTS

CODE_0493C1:
	DEC
	CMP.w #$FFEC
	BCC.b CODE_0493F7
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0493D0
	INY
	INY
CODE_0493D0:
	LDA.w DATA_049302,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	CMP.w #$8000
	ROR
	STA.w $60A8
	STA.w $60B4
	STZ.w $75E0,x
	LDA.w #$0008
	STA.w $7540,x
	JSL.l CODE_03A858
	LDA.w #$0020
	STA.w $7AF6,x
CODE_0493F7:
	CPX.w $61B6
	BNE.b CODE_0493FF
	STZ.w $61B6
CODE_0493FF:
	CLC
	RTS

;---------------------------------------------------------------------------

CODE_049401:
	JSR.w CODE_04942A
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	SEC
	SBC.w $6020
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDY.b #$00
	STY.w !EXRAM_YI_Player_SubYPosLo|!EXRAMBankMirror
	STZ.w $60A8
	STZ.w $60B4
	STZ.w $60AA
	INC.w $61B4
	RTS

;---------------------------------------------------------------------------

CODE_04942A:
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	SEC
	SBC.w #$0100
	BMI.b CODE_049439
	LSR
	LSR
	LSR
CODE_049439:
	EOR.w #$FFFF
	INC
	CLC
	ADC.w #$0100
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0F00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	ASL
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #(FXDATA_540000+$7020)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_540000+$7020
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08D76B>>16
	LDA.w #FXCODE_08D76B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Petal Guy ($192) Init -- the flower-disguise shy guy. Reuses the shy-guy
; OAM/animation init at $048A18, then ORs $7042 with $0020 to add the petal-
; layer priority bit.
; Raidenthequick: init_mufti_guy.
;-------------------------------------------------------------------------
YI_NorSpr192_PetalGuy_Init:
init_mufti_guy:                                   ; Raidenthequick: init_mufti_guy
;$049481
	JSL.l CODE_048A18
	LDA.w #$0020
	STA.w $7042,x
	RTL

;---------------------------------------------------------------------------

DATA_04948C:
DATA_mufti_guy_state_ptr:                              ; 2-entry $76,x sub-state dispatch table
	dw CODE_mufti_guy_state_00_hide_as_flower                                ;  0: hide-as-flower, watch for petal-poke
	dw CODE_mufti_guy_state_01_reveal_animate                                ;  1: petals knocked off, animate revealed shy-guy

;-------------------------------------------------------------------------
; Petal Guy Main -- when state = $0008 (player attacks the flower), spawn
; a real shy-guy ($01E) at our slot (via $03A366 sprite-replace) and run
; the petal-burst helper at $0496A6. Otherwise stays in disguise.
; Raidenthequick: main_mufti_guy.
;-------------------------------------------------------------------------
YI_NorSpr192_PetalGuy_Main:
main_mufti_guy:                                   ; Raidenthequick: main_mufti_guy
;$049490
	JSR.w CODE_0494EB
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_0494D2
	JSR.w CODE_mufti_guy_burst_petals
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	PHA
	LDA.w $74A0,x
	PHA
	STZ.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	TXY
	LDA.w #!Define_YI_NorSpr01E_Shyguy
	JSL.l CODE_03A366
	PLA
	SEP.b #$20
	STA.w $74A0,x
	REP.b #$20
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$00FE
	ORA.w #$0020
	STA.w $7042,x
	LDA.w #$0020
	STA.w $7AF6,x
	LDA.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
CODE_0494D2:
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_mufti_guy_state_ptr,x)
	JSR.w CODE_0495DD
	RTL

DATA_0494E2:
	db $10,$10,$10,$10,$08,$20,$20,$FF,$FF

CODE_0494EB:
	LDY.w $7402,x
	LDA.w DATA_0494E2,y
	TAY
	BMI.b CODE_04950A
	REP.b #$10
	TYA
	CLC
	ADC.w $7362,x
	TAY
	LDA.w $6005,y
	AND.w #$FFF1
	ORA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $6005,y
	SEP.b #$10
CODE_04950A:
	RTS

DATA_04950B:
	dw $FFA7,$0059,$FEF4,$010C

DATA_049513:
	dw $0005,$000B

DATA_049517:
	db $05,$06,$07,$08,$07,$06,$05

CODE_04951E:
CODE_mufti_guy_state_00_hide_as_flower:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_049553
	LDA.w #$0004
	STA.w $7A98,x
	INC.b $18,x
	LDY.b $18,x
	LDA.w DATA_049517,y
	AND.w #$00FF
	STA.w $7402,x
	CPY.b #$03
	BNE.b CODE_049554
	LDA.w #$0040
	STA.w $7A98,x
	LDY.w $77C2,x
	LDA.b $10
	BIT.w #$0001
	BNE.b CODE_04954F
	AND.w #$0002
	TAY
CODE_04954F:
	TYA
	STA.w $7400,x
CODE_049553:
	RTS

CODE_049554:
	CPY.b #$07
	BNE.b CODE_049587
	LDY.w $7400,x
	LDA.w DATA_04950B,y
	STA.w $75E0,x
	TYA
	LSR
	AND.w #$FFFE
	TAY
	LDA.w DATA_049513,y
	STA.w $7540,x
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0040
	STA.w $7A96,x
	LDA.w #$0003
	STA.w $7402,x
	INC
	STA.w $7A98,x
	STZ.b $18,x
	INC.b $76,x
CODE_049587:
	RTS

DATA_049588:
	db $03,$04,$03,$02,$00,$01,$02

CODE_04958F:
CODE_mufti_guy_state_01_reveal_animate:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0495DC
	LDA.w #$0004
	LDY.w $7540,x
	CPY.b #$05
	BEQ.b CODE_0495A0
	LSR
CODE_0495A0:
	STA.w $7A98,x
	INC.b $18,x
	LDY.b $18,x
	CPY.b #$07
	BMI.b CODE_0495AF
	STZ.b $18,x
	LDY.b #$00
CODE_0495AF:
	LDA.w $7402,x
	CMP.w #$0003
	BNE.b CODE_0495D3
	LDA.w $7A96,x
	BNE.b CODE_0495D3
	LDA.w #$0005
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
	STZ.b $18,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $76,x
	RTS

CODE_0495D3:
	LDA.w DATA_049588,y
	AND.w #$00FF
	STA.w $7402,x
CODE_0495DC:
	RTS

CODE_0495DD:
	LDY.w $7D36,x
	BPL.b CODE_04963F
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_04963A
	LDY.w $60AB
	BMI.b CODE_0495DC
	LDY.w $60C0
	BEQ.b CODE_0495DC
	LDA.w #$FC00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	JSR.w CODE_mufti_guy_burst_petals
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	PHA
	LDA.w $74A0,x
	PHA
	STZ.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	TXY
	LDA.w #$001E
	JSL.l CODE_03A34E
	PLA
	SEP.b #$20
	STA.w $74A0,x
	REP.b #$20
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$FFFE
	ORA.w #$0020
	STA.w $7042,x
	RTS

CODE_04963A:
	JSL.l CODE_03A858
	RTS

CODE_04963F:
	DEY
	BMI.b CODE_0496A5
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0496A5
	LDA.w $7D38,y
	BEQ.b CODE_0496A5
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	PHP
	LDA.w #$FE00
	PLP
	BMI.b CODE_04965C
	LDA.w #$0200
CODE_04965C:
	STA.b $0E
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	BCC.b CODE_04966C
	LDA.w #$4E00
	STA.w $6FA0,x
	RTS

CODE_04966C:
	JSR.w CODE_mufti_guy_burst_petals
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	PHA
	LDA.w $74A0,x
	PHA
	STZ.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	TXY
	LDA.w #!Define_YI_NorSpr01E_Shyguy
	JSL.l CODE_03A366
	PLA
	SEP.b #$20
	STA.w $74A0,x
	REP.b #$20
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$FFFE
	ORA.w #$0020
	STA.w $7042,x
	LDA.b $0E
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.w $7D38,x
	LDA.w #$0020
	STA.w $7AF6,x
CODE_0496A5:
	RTS

CODE_0496A6:					; Note: Routine that spawns the flower petals when attacking a flower guy.
CODE_mufti_guy_burst_petals:                           ; ambient-spawn 4 petal puffs around the disguise
	LDA.w #!Define_YI_AmbSpr210
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.w $7CD8,x
	STA.w $7142,y
	LDA.w #$0001
	STA.w $7782,y
	LDA.w #$0017
	STA.w $73C2,y
	LDA.w #$0022
	STA.w $7002,y
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Lunge Fish ($02C) Init -- the dock-side jumping eater. Caches the
; starting Y-position at $7A36 as the "home depth" so the jump arc can
; return to it.
; Raidenthequick: init_lunge_fish.
;
; See docs/family-fish.md for the full aquatic-enemy family breakdown
; (~17 sprites: Hootie / Crab / Jean De Fillet / Flopsy Fish (4 variants
; split across Bank07 + Bank05) / Spray Fish / Sluggy / Shark Chomp /
; Piscatory Pete / Preying Mantas / Loch Nestor).
;-------------------------------------------------------------------------
YI_NorSpr02C_LungeFish_Init:
init_lunge_fish:                                  ; Raidenthequick: init_lunge_fish
;$0496CC
	LDA.w $7182,x
	STA.w $7A36,x
	SEC
	SBC.w #$0020
	STA.w $7182,x
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $70E2,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

DATA_0496E6:
DATA_lunge_fish_state_ptr:                             ; 10-entry $76,x sub-state dispatch table
	dw CODE_lunge_fish_state_00_submerged_wait                                ;  0: submerged, wait for Yoshi overhead
	dw CODE_lunge_fish_state_01_rise_to_surface                                ;  1: rise toward surface
	dw CODE_lunge_fish_state_02_aim_and_lunge                                ;  2: pick aim angle, queue lunge
	dw CODE_lunge_fish_state_03_airborne_grab                                ;  3: airborne, hunt for Yoshi grab
	dw CODE_lunge_fish_state_04_drag_yoshi_down                                ;  4: gripping Yoshi (drag-down)
	dw CODE_lunge_fish_state_05_pin_yoshi                                ;  5: hold Yoshi pinned underwater
	dw CODE_lunge_fish_state_06_life_loss_handoff                                ;  6: trigger life-loss handoff
	dw CODE_lunge_fish_state_07_splash_settle                                ;  7: re-entry/splash settle
	dw CODE_lunge_fish_state_08_sink_below                                ;  8: sink back below surface
	dw CODE_lunge_fish_state_09_rise_cooldown                                ;  9: cooldown / rise-again delay

;-------------------------------------------------------------------------
; Lunge Fish Main -- dispatches via DATA_lunge_fish_state_ptr pointer table indexed by
; $76,x sub-state (waiting / lunging / mid-air / falling / settling).
; Off-screen-cull post-pass at CODE_04970A.
; Raidenthequick: main_lunge_fish, DATA_lunge_fish_state_ptr.
;-------------------------------------------------------------------------
YI_NorSpr02C_LungeFish_Main:
main_lunge_fish:                                  ; Raidenthequick: main_lunge_fish
;$0496FA
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_lunge_fish_state_ptr,x)
	JSR.w CODE_04970A
	RTL

CODE_04970A:
	LDY.w $74A2,x
	BMI.b CODE_049755
	LDY.b $76,x
	CPY.b #$04
	BMI.b CODE_049719
	CPY.b #$07
	BMI.b CODE_049755
CODE_049719:
	LDY.w $7D36,x
	BEQ.b CODE_049755
	BPL.b CODE_049756
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_049751
	LDY.w $60AB
	BMI.b CODE_049755
	LDY.w $60C0
	BEQ.b CODE_049755
	LDA.w #$FA00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	STZ.w $60D4
	BRA.b CODE_049770

CODE_049751:
	JSL.l CODE_03A858
CODE_049755:
	RTS

CODE_049756:
	LDA.w $6EFF,y
	CMP.w #$0010
	BNE.b CODE_049789
	LDA.w $7D37,y
	BEQ.b CODE_049789
	DEY
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDY.w $7402,x
	CPY.b #$02
	BEQ.b CODE_049789
CODE_049770:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w #$0040
	STA.w $7A96,x
	LDA.w #$0002
	STA.w $7402,x
	LDY.b #$07
	STY.b $76,x
CODE_049789:
	RTS

CODE_04978A:
CODE_lunge_fish_state_00_submerged_wait:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0497A5
	LDA.w $7C16,x
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCS.b CODE_0497A5
	LDA.w #$0400
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
CODE_0497A4:
	RTS

CODE_0497A5:
	JSL.l CODE_03A2F8
	BCC.b CODE_0497A4
	PLA
	RTL

CODE_0497AD:
CODE_lunge_fish_state_01_rise_to_surface:
	TYX
	JSR.w CODE_049943
	BPL.b CODE_0497BD
	LDA.w #$0040
	STA.w $7A96,x
	STZ.b $16,x
	INC.b $76,x
CODE_0497BD:
	RTS

DATA_0497BE:
	dw $0020,$FFE0

DATA_0497C2:
	dw $FF00,$0100

CODE_0497C6:
CODE_lunge_fish_state_02_aim_and_lunge:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0497BD
	LDY.b #$00
	LDA.w $60A8
	BMI.b CODE_0497E0
	BNE.b CODE_0497DE
	LDA.w $60C4
	EOR.w #$0002
	TAY
	BRA.b CODE_0497E0

CODE_0497DE:
	INY
	INY
CODE_0497E0:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_0497BE,y
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LSR
	CLC
	ADC.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $02
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BCC.b CODE_049831
	BMI.b CODE_049808
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BRA.b CODE_04980F

CODE_049808:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_04980F:
	STA.w $70E2,x
	LDY.w $77C2,x
	LDA.b $00
	CLC
	ADC.w #$0100
	STA.b $00
	LDA.b $02
	CLC
	ADC.w #$0080
	CMP.b $00
	BCC.b CODE_049831
	STZ.w $7402,x
	LDA.w #$0008
	STA.b $76,x
	BRA.b CODE_04987D

CODE_049831:
	LDA.w $7C18,x
	CMP.w #$0040
	BMI.b CODE_049858
	INC.b $16,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	CMP.w #$0080
	BMI.b CODE_04988D
	STZ.w $7402,x
	LDA.w #$0060
	STA.w $7A96,x
	LDY.b #$09
	STY.b $76,x
	LDY.w $77C2,x
	LDA.w #$FF00
	BRA.b CODE_049880

CODE_049858:
	LDA.w DATA_0497C2,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7542,x
	LDA.w #$0340
	STA.w $75E2,x
	LDA.w #$0001
	STA.w $7402,x
	STZ.b $18,x
	PHY
	LDA.w #!Define_YI_SoundID83_LungeFish
	JSL.l CODE_push_sound_queue
	PLY
	INC.b $76,x
CODE_04987D:
	LDA.w #$FCC0
CODE_049880:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	TYA
	STA.w $7400,x
	LDA.w #$0002
	STA.w $74A2,x
CODE_04988D:
	RTS

DATA_04988E:
	dw $0020,$FFE0

DATA_049892:
	dw $0180,$FE80

CODE_049896:
CODE_lunge_fish_state_03_airborne_grab:
	TYX
	LDY.w $7223,x
	BMI.b CODE_0498A5
	LDA.w #$0002
	STA.w $7402,x
	JMP.w CODE_049931

CODE_0498A5:
	JSR.w CODE_049AA4
	LDA.w $7400,x
	DEC
	EOR.w $7C16,x
	BPL.b CODE_0498F0
	LDA.w $7C16,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_0498F0
	LDA.w $7C18,x
	CLC
	ADC.w #$0030
	CMP.w #$0040
	BCS.b CODE_0498F0
	JSL.l CODE_04F74A
	LDA.w #!Define_YI_PlayerState1A_DisableInput
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$006B
	STA.w $60BE
	STA.w !RAM_YI_Level_CantUseItemsFlagLo
	LDA.w $7C16,x
	STA.b $78,x
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w $7A38,x
	INC.b $18,x
	INC.b $76,x
	RTS

CODE_0498F0:
	LDA.w $7400,x
	TAY
	DEC
	EOR.w $7C16,x
	BPL.b CODE_049931
	LDA.w $7C16,x
	CLC
	ADC.w #$0012
	CMP.w #$0024
	BCS.b CODE_049931
	LDA.w $7C18,x
	CLC
	ADC.w #$0018
	CMP.w #$0030
	BCS.b CODE_049931
	LDA.w DATA_04988E,y
	CLC
	ADC.w $60A8
	STA.w $60A8
	STA.w $60B4
	CLC
	ADC.w #$0180
	CMP.w #$0300
	BCC.b CODE_049931
	LDA.w DATA_049892,y
	STA.w $60A8
	STA.w $60B4
CODE_049931:
	JSR.w CODE_049943
	BPL.b CODE_049942
	LDA.w #$00A0
	STA.w $7A96,x
	STZ.b $16,x
	LDY.b #$02
	STY.b $76,x
CODE_049942:
	RTS

CODE_049943:
	LDA.w $7A36,x
	CMP.w $7182,x
	BPL.b CODE_049990
	STA.w $7182,x
	LDA.w #!Define_YI_AmbSpr1CE
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0001
	STA.w $7E4C,y
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0012
	STA.w $7782,y
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7142,y
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w $75E2,x
	LDA.w #!Define_YI_SoundID5F_Splash1
	JSL.l CODE_push_sound_queue
	LDA.w #$FFFF
	STA.w $74A2,x
CODE_049990:
	RTS

CODE_049991:
CODE_lunge_fish_state_04_drag_yoshi_down:
	TYX
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	STA.b $02
	LDA.b $78,x
	STA.b $04
	LDA.w $7A38,x
	STA.b $06
	JSL.l CODE_049B42
	STA.b $0C
	LDA.b $04
	STA.b $78,x
	LDA.b $06
	STA.w $7A38,x
	LDA.b $08
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.b $0A
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.b $0C
	BNE.b CODE_0499D2
	STZ.w $7402,x
	LDA.w $7182,x
	CLC
	ADC.w #$0020
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC.b $76,x
	RTS

CODE_0499D2:
	JSR.w CODE_049943
	BPL.b CODE_0499F1
	LDA.w $70E2,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $7182,x
	CLC
	ADC.w #$0020
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$0020
	STA.w $7A98,x
	LDY.b #$06
	STY.b $76,x
CODE_0499F1:
	RTS

CODE_0499F2:
CODE_lunge_fish_state_05_pin_yoshi:
	TYX
	LDA.w $70E2,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $7182,x
	CLC
	ADC.w #$0020
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	JSR.w CODE_049943
	BPL.b CODE_049A10
	LDA.w #$0020
	STA.w $7A98,x
	INC.b $76,x
CODE_049A10:
	RTS

CODE_049A11:
CODE_lunge_fish_state_06_life_loss_handoff:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_049A10
	REP.b #$10
	JSL.l CODE_player_death_spike
	SEP.b #$10
	PLA
	RTL

CODE_049A21:
CODE_lunge_fish_state_07_splash_settle:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_049A44
	LDA.w #$0020
	STA.w $7542,x
	LDA.w #$0340
	STA.w $75E2,x
	JSR.w CODE_049943
	BPL.b CODE_049A44
	LDA.w #$00A0
	STA.w $7A96,x
	STZ.b $16,x
	LDY.b #$02
	STY.b $76,x
CODE_049A44:
	RTS

CODE_049A45:
CODE_lunge_fish_state_08_sink_below:
	TYX
	LDA.w $7A36,x
	SEC
	SBC.w #$0020
	CMP.w $7182,x
	BMI.b CODE_049A60
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7A96,x
	STZ.b $76,x
CODE_049A60:
	RTS

CODE_049A61:
CODE_lunge_fish_state_09_rise_cooldown:
	TYX
	LDA.w $7A36,x
	SEC
	SBC.w #$0008
	CMP.w $7182,x
	BMI.b CODE_049A83
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A96,x
	BNE.b CODE_049A83
	LDA.w #$0400
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.b #$01
	STY.b $76,x
CODE_049A83:
	RTS

;---------------------------------------------------------------------------

DATA_049A84:
	dw $0028,$0030,$0038,$003F,$FFD8,$FFD0,$FFC8,$FFC1

DATA_049A94:
	dw $002C,$0028,$0034,$0000,$0008,$0010,$0018,$0020

CODE_049AA4:
	LDA.b $10
	AND.w #$0003
	STA.b $00
	LDA.w $7400,x
	ASL
	CLC
	ADC.b $00
	ASL
	TAY
	LDA.w DATA_049A84,y
	STA.b $00
	LDA.b $11
	AND.w #$000E
	TAY
	LDA.w DATA_049A94,y
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1CF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0010
	STA.w $7782,y
	LDA.w $70E2,x
	SEC
	SBC.b $00
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.b $02
	STA.w $7142,y
	TXA
	STA.w $7E4C,y
	LDA.b $00
	STA.w $7E8C,y
	LDA.b $02
	STA.w $7E4E,y
	RTS

;---------------------------------------------------------------------------

DATA_049AF2:
	db $00,$00,$01,$02,$03,$04,$05,$05,$06,$07,$08,$09,$0A,$0B,$0B,$0C
	db $0D,$0E,$0F,$10,$11,$12,$12,$13,$14,$15,$16,$17,$18,$19,$1A,$1B
	db $1B,$1C,$1D,$1E,$1F,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$2A
	db $2B,$2C,$2D,$2D,$2E,$2F,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39
	db $3A,$3B,$3C,$3D,$3E,$3F,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49

CODE_049B42:
	PHB
	PHK
	PLB
	LDA.b $00
	SEC
	SBC.b $04
	STA.b $08
	LDA.b $02
	SEC
	SBC.b $06
	STA.b $0A
	LDA.b $04
	BEQ.b CODE_049B91
	BMI.b CODE_049B62
	TAY
	LDA.w DATA_049AF2,y
	AND.w #$00FF
	BRA.b CODE_049B71

CODE_049B62:
	EOR.w #$FFFF
	INC
	TAY
	LDA.w DATA_049AF2,y
	AND.w #$00FF
	EOR.w #$FFFF
	INC
CODE_049B71:
	STA.b $04
	LDA.b $06
CODE_049B75:
	BMI.b CODE_049B80
	TAY
	LDA.w DATA_049AF2,y
	AND.w #$00FF
	BRA.b CODE_049B9B

CODE_049B80:
	EOR.w #$FFFF
	INC
	TAY
	LDA.w DATA_049AF2,y
	AND.w #$00FF
	EOR.w #$FFFF
	INC
	BRA.b CODE_049B9B

CODE_049B91:
	LDA.b $06
	BNE.b CODE_049B75
	ORA.b $04
	BNE.b CODE_049B9D
	PLB
	RTL

CODE_049B9B:
	STA.b $06
CODE_049B9D:
	LDA.w #$0001
	PLB
	RTL

;---------------------------------------------------------------------------

DATA_049BA2:
	dw $FFC0,$0040

DATA_049BA6:
	dw $FF80,$0080

;-------------------------------------------------------------------------
; Potted Spiked Fun Guy ($031) Init -- spiked-shy-guy that pops out of a
; ceramic pot. Seeds X-velocity from DATA_049BA6 (slow drift) on first
; spawn, schedules a 0x40-frame timer at $7542, advances $76 sub-state.
; Raidenthequick: init_potted_spiked_guy.
;-------------------------------------------------------------------------
YI_NorSpr031_PottedSpikedFunGuy_Init:
init_potted_spiked_guy:                           ; Raidenthequick: init_potted_spiked_guy
;$049BAA
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_049BCA
	CMP.w #$FFFF
	BNE.b CODE_049BCA
CODE_049BB7:
	LDY.w $7400,x
	LDA.w DATA_049BA6,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	INC.b $76,x
	BRA.b CODE_049BFB

CODE_049BCA:
	LDA.w $70E2,x
	AND.w #$0010
	BNE.b CODE_049BB7
	LDA.w #$00A1
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_049BB7
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	SEC
	SBC.w #$000A
	STA.w $7182,x
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	TXA
	STA.w $7A38,y
CODE_049BFB:
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

DATA_049C02:
	db $47,$09,$07,$00

DATA_049C06:
DATA_potted_spiked_guy_state_ptr:                      ; 2-entry $76,x sub-state dispatch
	dw CODE_shy_guy_state_05_stub                                ;  0: idle inside pot (TYX/RTS stub)
	dw CODE_potted_spiked_guy_state_01_emerge_walk                                ;  1: emerge from pot, walk

;-------------------------------------------------------------------------
; Potted Spiked Fun Guy Main -- dispatches via DATA_potted_spiked_guy_state_ptr[2]: idle (the
; TYX/RTS stub at $048000) vs spawn-and-walk (CODE_potted_spiked_guy_state_01_emerge_walk). Despawn if
; the parent pot-slot's lifespan ($7D36) has run out.
; Raidenthequick: main_potted_spiked_guy.
;-------------------------------------------------------------------------
YI_NorSpr031_PottedSpikedFunGuy_Main:
main_potted_spiked_guy:                           ; Raidenthequick: main_potted_spiked_guy
;$049C0A
	LDY.b #$00
	LDA.w $7D38,x
	ORA.w $7D96,x
	BEQ.b CODE_049C1F
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	INY
	INY
CODE_049C1F:
	LDA.w DATA_049C02,y
	STA.w $6FA2,x
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_potted_spiked_guy_state_ptr,x)
	LDY.w $7D36,x
	DEY
	BPL.b CODE_049C3C
	JSL.l CODE_03A5B7
	RTL

CODE_049C3C:
	JML.l CODE_0DC14C

CODE_049C40:
CODE_potted_spiked_guy_state_01_emerge_walk:
	TYX
	LDY.w $7D36,x
	DEY
	BMI.b CODE_049C87
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr0A1_SmallPot
	BNE.b CODE_049C87
	LDA.w $7A38,y
	BNE.b CODE_049C87
	LDA.w $7D38,y
	BNE.b CODE_049C87
	LDA.w $70E2,x
	SEC
	SBC.w $70E2,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LDA.w $7182,x
	SEC
	SBC.w $7182,y
	CLC
	ADC.w #$000A
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDA.w #$0000
	STA.w $7D38,y
	TXA
	STA.w $7A38,y
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.b $76,x
	RTS

CODE_049C87:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098E44>>16
	LDA.w #FXCODE_098E44
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_049CB2
	STZ.w $7400,x
	LDA.w $70E2,y
	CMP.w $70E2,x
	BMI.b CODE_049CAC
	LDA.w #$0002
	STA.w $7400,x
CODE_049CAC:
	LDA.w #$0087
	STA.w $6FA2,x
CODE_049CB2:
	LDY.w $7400,x
	LDA.w DATA_049BA6,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_049CC4
	EOR.w #$FFFF
	INC
CODE_049CC4:
	CLC
	ADC.w $7A36,x
	CMP.w #$0200
	BMI.b CODE_049CDC
	PHA
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
	PLA
	SEC
	SBC.w #$0200
CODE_049CDC:
	STA.w $7A36,x
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Small Pot ($0A1) Init -- empty, the pot is purely physical (carry/throw),
; spawn-side state is set by the parent.
; Raidenthequick: init_pot_of_potted_spiked_guy.
;-------------------------------------------------------------------------
YI_NorSpr0A1_SmallPot_Init:
init_pot_of_potted_spiked_guy:                    ; Raidenthequick: init_pot_of_potted_spiked_guy
;$049CE0
	RTL

;---------------------------------------------------------------------------

DATA_049CE1:
	dw $FA00,$FB80

;-------------------------------------------------------------------------
; Small Pot Main -- when stunned ($CurrentStatus = $0008) and the partner
; slot at $7A38 is set, spawn the pot-break helper at $049DFC. Otherwise
; carries through to the normal carryable-sprite update path.
; Raidenthequick: main_pot_of_potted_spiked_guy.
;-------------------------------------------------------------------------
YI_NorSpr0A1_SmallPot_Main:
main_pot_of_potted_spiked_guy:                    ; Raidenthequick: main_pot_of_potted_spiked_guy
;$049CE5
	STZ.w $7400,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_049CFC
	LDY.w $7A38,x
	BEQ.b CODE_049CFC
	STZ.w $7A38,x
	JSR.w CODE_049DFC
	RTL

CODE_049CFC:
	JSL.l CODE_03AF23
	JSL.l CODE_03A2C7
	BCC.b CODE_049D12
	LDY.w $7A38,x
	BEQ.b CODE_049D0E
	JSR.w CODE_049DFC
CODE_049D0E:
	JML.l CODE_despawn_sprite_free_slot

CODE_049D12:
	LDY.w $7A38,x
	BNE.b CODE_049D26
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_049D25
	STZ.w $7402,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_049D25:
	RTL

CODE_049D26:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_049D36
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr031_PottedSpikedFunGuy
	BEQ.b CODE_049D3A
CODE_049D36:
	STZ.w $7A38,x
	RTL

CODE_049D3A:
	LDA.w $7D96,y
	BEQ.b CODE_049D49
	STZ.w $7A38,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	RTL

CODE_049D49:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	ORA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $02
	LDA.w #$000C
	STA.b $00
	LDA.w #$0001
	STA.w $7402,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_049DB1
	LDA.w #$000A
	STA.b $00
	STZ.w $7402,x
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_049DB1
	LDA.w $7AF8,x
	BEQ.b CODE_049D7B
	DEC
	BEQ.b CODE_049D86
	BRA.b CODE_049DB1

CODE_049D7B:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0010
	STA.w $7AF8,x
	BRA.b CODE_049DB1

CODE_049D86:
	PHY
	LDY.b $02
	BNE.b CODE_049DB0
	LDY.w $77C2,x
	LDA.w DATA_049BA2,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b #$00
	LDA.b $10
	AND.w #$0003
	BEQ.b CODE_049DA8
	INC.b $76,x
	LDA.b $76,x
	CMP.w #$0003
	BEQ.b CODE_049DA8
	INY
	INY
CODE_049DA8:
	STZ.b $76,x
	LDA.w DATA_049CE1,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_049DB0:
	PLY
CODE_049DB1:
	LDA.w $70E2,x
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.b $00
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7182,y
	LDA.w $7402,x
	STA.w $7402,y
	PHY
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_049DD8
	INY
	INY
CODE_049DD8:
	TYA
	PLY
	STA.w $7400,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_049DEC
	BPL.b CODE_049DE9
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BRA.b CODE_049DEC

CODE_049DE9:
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_049DEC:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_049DFB
	BPL.b CODE_049DF8
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BRA.b CODE_049DFB

CODE_049DF8:
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_049DFB:
	RTL

CODE_049DFC:
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #$0040
	STA.w $7542,y
	LDA.w $7400,y
	PHY
	TAY
	LDA.w DATA_049BA6,y
	PLY
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Grim Leecher ($037) Init -- the ghostly enemy that detaches and rides
; Yoshi. Seeds $701900 = 8 (active-phase counter) and $7A38 = $0100
; (drop-off cooldown frames).
; Raidenthequick: init_grim_leecher.
;-------------------------------------------------------------------------
YI_NorSpr037_GrimLeecher_Init:
init_grim_leecher:                                ; Raidenthequick: init_grim_leecher
;$049E15
	LDA.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0100
	STA.w $7A38,x
	RTL

;---------------------------------------------------------------------------

DATA_049E22:
DATA_grim_leecher_state_ptr:                           ; 7-entry $76,x sub-state dispatch
	dw CODE_grim_leecher_state_00_idle_seek                                ;  0: idle, wait for Yoshi nearby
	dw CODE_grim_leecher_state_01_hop_at_yoshi                                ;  1: hop toward Yoshi
	dw CODE_grim_leecher_state_02_drain                                ;  2: mounted on Yoshi, drain timer
	dw CODE_grim_leecher_state_03_dismount                                ;  3: dismount
	dw CODE_grim_leecher_state_04_fly_away                                ;  4: fly away after dismount
	dw CODE_grim_leecher_state_05_settle                                ;  5: settle / land
	dw CODE_grim_leecher_state_06_cleanup                                ;  6: cleanup / despawn

;-------------------------------------------------------------------------
; Grim Leecher Main -- 7-state machine dispatched through DATA_grim_leecher_state_ptr:
;   0 idle    1 hop-onto-Yoshi    2 mounted/draining    3 dismounting
;   4 fly-away    5 settle    6 cleanup
; While sub-state = 2 (mounted), the player slot is being drained.
; Raidenthequick: main_grim_leecher.
;-------------------------------------------------------------------------
YI_NorSpr037_GrimLeecher_Main:
main_grim_leecher:                                ; Raidenthequick: main_grim_leecher
;$049E30
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_grim_leecher_state_ptr,x)
	LDA.b $76,x
	CMP.w #$0002
	BEQ.b CODE_049E4C
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
CODE_049E4C:
	LDA.w $7860,x
	BIT.w #$0002
	BEQ.b CODE_049E61
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_049E61:
	LDA.b $16,x
	CMP.w #$0006
	BNE.b CODE_049E78
	STZ.b $16,x
	INC.w $7402,x
	LDA.w $7402,x
	CMP.w #$0003
	BNE.b CODE_049E78
	STZ.w $7402,x
CODE_049E78:
	INC.b $16,x
	JML.l CODE_0DC14C

CODE_049E7E:
CODE_grim_leecher_state_00_idle_seek:
	TYX
	STZ.w $75E0,x
	STZ.w $7540,x
	LDA.w $7C16,x
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_049EAE
	LDA.w #$0004
	STA.w $7540,x
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0060
	LDY.w $7C17,x
	BMI.b CODE_049EA9
	EOR.w #$FFFF
	INC
CODE_049EA9:
	STA.w $75E0,x
	INC.b $76,x
CODE_049EAE:
	RTS

CODE_049EAF:
CODE_grim_leecher_state_01_hop_at_yoshi:
	TYX
	JSR.w CODE_04A085
	LDA.b $10
	AND.w #$003F
	LDY.w $7C19,x
	BMI.b CODE_049EC1
	EOR.w #$FFFF
	INC
CODE_049EC1:
	CLC
	ADC.w $7A38,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.b $11
	AND.w #$001F
	CLC
	ADC.w #$0060
	LDY.w $7C16,x
	BMI.b CODE_049EDA
	EOR.w #$FFFF
	INC
CODE_049EDA:
	STA.w $75E0,x
	LDA.w $7C16,x
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCC.b CODE_049EF4
	STZ.w $75E0,x
	LDA.w #$0040
	STA.w $75E2,x
	STZ.b $76,x
CODE_049EF4:
	LDY.w $7D36,x
	BPL.b CODE_049F6D
	LDA.w $7E48
	AND.w #$00FF
	ORA.w $0CD0
	ORA.w $61D6
	BNE.b CODE_049F6D
	LDA.w $61B2
	BPL.b CODE_049F25
	AND.w #$0FFF
	STA.w $61B2
	STZ.b $18
	LDA.w #$0006
	STA.b $16
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	LDA.w #$0040
	STA.w $7AF8
CODE_049F25:
	LDA.w #$000A
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	TXA
	STA.w $7E48
	LDA.w #$2881
	STA.w $6FA2,x
	LDA.w #$0904
	STA.w $7040,x
	LDA.w #$0020
	STA.w $0CC8
	STZ.w $7540,x
	STZ.w $75E0,x
	LDA.w #$0260
	STA.w $7AF6,x
	LDA.w #$003E
	STA.w $7A96,x
	LDA.w #$0008
	STA.w $7A98,x
	LDA.w #$0010
	STA.w $7AF8,x
	LDA.w #$FFFF
	STA.w $0CD0
	LDA.w #$8000
	STA.w $0390
	STZ.b $76,x
CODE_049F6D:
	RTS

CODE_049F6E:
CODE_grim_leecher_state_02_drain:                      ; mounted; drains Yoshi while screen flashes
	TYX
	JSR.w CODE_04A085
	LDA.w $7A38,x
	BPL.b CODE_049F7B
	EOR.w #$FFFF
	INC
CODE_049F7B:
	LSR
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCC.b CODE_049F95
	LDA.w $75E0,x
	EOR.w #$FFFF
	INC
	STA.w $75E0,x
CODE_049F95:
	LDA.w $7A96,x
	BNE.b CODE_049FA1
	RTS

CODE_049F9B:
CODE_grim_leecher_state_03_dismount:
	TYX
	LDA.w $7A96,x
	BEQ.b CODE_049FBA
CODE_049FA1:
	LDA.w $7A98,x
	BNE.b CODE_049FB9
	LDA.w #$0008
	STA.w $7A98,x
	LDA.w $6116
	EOR.w #$0002
	STA.w $6116
	JSL.l CODE_04FB41
CODE_049FB9:
	RTS

CODE_049FBA:
	LDY.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CPY.b #$10
	BEQ.b CODE_049FC7
	LDA.w #$FFFF
	STA.w $61EC
CODE_049FC7:
	INC.b $76,x
	RTS

CODE_049FCA:
CODE_grim_leecher_state_04_fly_away:
	TYX
	LDA.w $7AF6,x
	BNE.b CODE_049FE8
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0060
	LDY.w $7C16,x
	BMI.b CODE_049FE2
	EOR.w #$FFFF
	INC
CODE_049FE2:
	STA.w $75E0,x
	STZ.b $76,x
	RTS

CODE_049FE8:
	JSR.w CODE_04A085
	LDA.w $7A38,x
	BMI.b CODE_049FF4
	EOR.w #$FFFF
	INC
CODE_049FF4:
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_049FF9:
CODE_grim_leecher_state_05_settle:
	TYX
	LDA.w #$0004
	STA.w $7540,x
	LDA.w #$0080
	STA.w $75E0,x
	TXA
	AND.w #$000F
	LSR
	LSR
	LSR
	BEQ.b CODE_04A015
	LDA.w #$FF80
	STA.w $75E0,x
CODE_04A015:
	LDA.w #$0040
	STA.w $75E2,x
	LDA.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0060
	STA.w $7A38,x
	LDA.w #$0004
	STA.w $7542,x
	LDA.w #$0080
	STA.w $7A96,x
	INC.b $76,x
	RTS

CODE_04A03C:
CODE_grim_leecher_state_06_cleanup:
	TYX
	JSR.w CODE_04A085
	LDA.w $7A38,x
	BPL.b CODE_04A049
	EOR.w #$FFFF
	INC
CODE_04A049:
	STA.b $02
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	TXA
	AND.w #$000F
	LSR
	LSR
	LSR
	BCS.b CODE_04A066
	LDA.b $02
	LSR
	LSR
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_04A066:
	LDA.w $7A96,x
	BNE.b CODE_04A084
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0060
	LDA.w $7C16,x
	BMI.b CODE_04A07D
	EOR.w #$FFFF
	INC
CODE_04A07D:
	STA.w $75E0,x
	LDY.b #$01
	STY.b $76,x
CODE_04A084:
	RTS

CODE_04A085:
	LDA.w $7A38,x
	PHA
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCC.b CODE_04A09C
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_04A09C:
	PLA
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $7A38,x
	RTS

;---------------------------------------------------------------------------

DATA_04A0A5:
DATA_ride_grim_leecher_state_ptr:                      ; 3-entry $76,x sub-state dispatch (ride hook)
	dw CODE_grim_leecher_state_03_dismount                                ;  0: re-uses CODE_grim_leecher_state_03_dismount
	dw CODE_ride_grim_leecher_state_01_just_mounted                                ;  1: just-mounted (attach + drain begin)
	dw CODE_ride_grim_leecher_state_02_struggle_off                                ;  2: struggling-off (boss-flash cooldown)

;-------------------------------------------------------------------------
; Hook invoked when player rides the Grim Leecher off-Yoshi -- dispatches
; via DATA_ride_grim_leecher_state_ptr (2 sub-states) to either CODE_ride_grim_leecher_state_01_just_mounted (just-mounted) or
; CODE_ride_grim_leecher_state_02_struggle_off (struggling-off).
; Raidenthequick: ride_grim_leecher.
;-------------------------------------------------------------------------
YI_NorSpr037_GrimLeecher_RideYoshiRt:
ride_grim_leecher:                                ; Raidenthequick: ride_grim_leecher
;$04A0AB
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_ride_grim_leecher_state_ptr,x)
	RTL

DATA_04A0B4:
	dw $0040,$FFC0

CODE_04A0B8:
CODE_ride_grim_leecher_state_01_just_mounted:
	TYX
	LDY.w $61B3
	BMI.b CODE_04A0C3
	LDA.w $7AF6,x
	BNE.b CODE_04A0D1
CODE_04A0C3:
	LDY.w $77C2,x
	LDA.w DATA_04A0B4,y
	STA.w $75E0,x
	LDA.w #$0079
	BRA.b CODE_04A106

CODE_04A0D1:
	LDA.w $60FC
	BIT.w #$0018
	BEQ.b CODE_04A0ED
	CPX.w $0D96
	BNE.b CODE_04A0ED
	LDA.w #$0030
	STA.w $7A96,x
	LDA.w #$0004
	STA.w $7A98,x
	INC.b $76,x
CODE_04A0EC:
	RTS

CODE_04A0ED:
	LDA.w $61D6
	BEQ.b CODE_04A0EC
	CPX.w $0D96
	BEQ.b CODE_04A0EC
	LDA.w $6FA0,x
	EOR.w #$0E40
	STA.w $6FA0,x
	STZ.w $6FA2,x
	LDA.w #$FFFF
CODE_04A106:
	STA.w $7AF6,x
	LDA.w #$0004
	STA.w $7540,x
	LDA.w #$003E
	STA.w $7A96,x
	STA.w $0CD0
	STA.w $61EC
	LDA.w #$0008
	STA.w $7A98,x
	LDA.w #$0003
	STA.b $76,x
	BRA.b CODE_04A17C

CODE_04A128:
CODE_ride_grim_leecher_state_02_struggle_off:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_04A196
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w $7042,x
	EOR.w #$000E
	STA.w $7042,x
	LDA.w $7A96,x
	BNE.b CODE_04A196
	LDA.w $6FA0,x
	EOR.w #$0E40
	STA.w $6FA0,x
	STZ.w $6FA2,x
	LDA.w $7042,x
	ORA.w #$0080
	STA.w $7042,x
	LDA.w #$0080
	STA.w $75E0,x
	LDA.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0002
	STA.w $7540,x
	LDA.w #$0038
	STA.w $7A96,x
	INC
	STA.w $0CD0
	STA.w $61EC
	LDA.w #$0004
	STA.w $7A98,x
CODE_04A17C:
	STZ.b $16,x
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$FFFF
	STA.w $7E48
	LDA.w #$0881
	STA.w $6FA2,x
	LDA.w #$0954
	STA.w $7040,x
CODE_04A196:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Grey rotating wooden board ($050) Init -- the BG3-aligned plank that
; spins on a pivot. Calls $02813E (BG3-platform spawn helper), nudges
; pivot X by -8 (visual centring), seeds $7A36 = $0140 (rotation period).
; Raidenthequick: init_board_bg3.
;-------------------------------------------------------------------------
YI_NorSpr050_GreyRotatingWoodenBoard_Init:
init_board_bg3:                                   ; Raidenthequick: init_board_bg3
;$04A197
	JSL.l CODE_02813E
	LDA.w $70E2,x
	SEC
	SBC.w #$0008
	STA.w $70E2,x
	LDA.w #$0140
	STA.w $7A36,x
	RTL

;---------------------------------------------------------------------------

DATA_04A1AC:
	dw $FFFC,$0004

DATA_04A1B0:
	dw $FEC0,$0140

;-------------------------------------------------------------------------
; Grey rotating board Main -- if any global "freeze sprites"/fuzzy/item
; flag is set, skip motion (jump to CODE_04A250 = held-still drawer).
; Otherwise tick the rotation and re-emit BG3 tiles via CODE_04A300.
; Raidenthequick: main_board_bg3.
;-------------------------------------------------------------------------
YI_NorSpr050_GreyRotatingWoodenBoard_Main:
main_board_bg3:                                   ; Raidenthequick: main_board_bg3
;$04A1B4
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_04A1C2
	JMP.w CODE_04A250

CODE_04A1C2:
	JSR.w CODE_04A300
	BCC.b CODE_04A1CB
	STZ.w $0CB2
	RTL

CODE_04A1CB:
	LDA.b $78,x
	CMP.w #$2000
	BPL.b CODE_04A1EB
	LDY.b #$20
	LDA.w #$0030
	JSR.w CODE_04A280
	BCS.b CODE_04A1EB
	LDA.w #$0008
	STA.w $7A38,x
	CLC
	ADC.w $7A36,x
	STA.w $7A36,x
	BRA.b CODE_04A248

CODE_04A1EB:
	LDY.w $7A38,x
	BEQ.b CODE_04A21B
	LDA.b $78,x
	BMI.b CODE_04A205
	LDA.w $7A36,x
	CMP.w #$0140
	BMI.b CODE_04A205
	SEC
	SBC.w #$0010
	STA.w $7A36,x
	BPL.b CODE_04A248
CODE_04A205:
	STZ.w $7A38,x
	LDA.w #!Define_YI_SoundID40_OpenDoor
	JSL.l CODE_push_sound_queue
	LDY.b #$00
	LDA.b $78,x
	BPL.b CODE_04A217
	INY
	INY
CODE_04A217:
	STY.b $16,x
	BRA.b CODE_04A248

CODE_04A21B:
	LDY.b $16,x
	LDA.w $7A36,x
	CLC
	ADC.w DATA_04A1AC,y
	STA.w $7A36,x
	SEC
	SBC.w DATA_04A1B0,y
	EOR.w DATA_04A1B0,y
	BMI.b CODE_04A248
	LDA.w DATA_04A1B0,y
	STA.w $7A36,x
	EOR.b $78,x
	BMI.b CODE_04A248
	LDA.w #!Define_YI_SoundID40_OpenDoor
	JSL.l CODE_push_sound_queue
	LDA.b $16,x
	EOR.w #$0002
	STA.b $16,x
CODE_04A248:
	LDA.b $78,x
	CLC
	ADC.w $7A36,x
	STA.b $78,x
CODE_04A250:
	LDA.w #$0104
	STA.w $0CB8
	LDY.b $79,x
	TYA
	STA.b $00
	LDA.w #$00C0
	SEC
	SBC.b $00
	STA.w $7E40
	LDA.w $7682,x
	PHA
	SEC
	SBC.w #$0008
	STA.w $7682,x
	LDY.b #$02
	JSL.l CODE_02841C
	PLA
	STA.w $7682,x
	LDA.w #$0710
	STA.w !RAM_YI_Global_MainScreenLayers
	RTL

CODE_04A280:
	STA.b $04
	ASL
	STA.b $06
	TYA
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable7019D9|!EXRAMBankMirror,x
	TYA
	ASL
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	EOR.w #$FFFF
	SEC
	ADC.w $7CD8,x
	SEC
	SBC.w #$0008
	STA.b $02
	SEC
	SBC.w $611E
	SEC
	SBC.w $6112
	SEC
	SBC.w $6122
	DEC
	CMP.w #$FFF4
	BCC.b CODE_04A2E4
	STA.b $00
	LDA.w $60AA
	BMI.b CODE_04A2E4
	LDA.w $7C16,x
	CLC
	ADC.b $04
	CMP.b $06
	BCS.b CODE_04A2E4
	LDA.b $00
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0003
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC.w $61B4
	STZ.w $60AA
	CLC
	RTS

CODE_04A2E4:
	SEC
	RTS

;---------------------------------------------------------------------------

CODE_04A2E6:
	LDA.w $7680,x
	CLC
	ADC.w #$0068
	CMP.w #$01D0
	BCS.b CODE_04A318
	LDA.w $7682,x
	CLC
	ADC.w #$00A0
	CMP.w #$0220
	BCC.b CODE_04A31E
	BRA.b CODE_04A318

CODE_04A300:
	LDA.w $7680,x
	CLC
	ADC.w #$0068
	CMP.w #$01D0
	BCS.b CODE_04A318
	LDA.w $7682,x
	CLC
	ADC.w #$0080
	CMP.w #$01E0
	BCC.b CODE_04A31E
CODE_04A318:
	PHP
	JSL.l CODE_03A31E
	PLP
CODE_04A31E:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Large wheel ($051) Init -- the big BG3 cart-wheel platform. Preserves
; $0073 across the BG3 spawn call so the parent's working register isn't
; clobbered, captures the main-screen layer mask into the local mirror
; for the per-spin redraw.
; Raidenthequick: (init_large_log_bg3 family).
;-------------------------------------------------------------------------
YI_NorSpr051_LargeWheel_Init:
init_large_wheel:                                 ; Raidenthequick: init_large_log_bg3
;$04A31F
	LDA.w $0073
	STA.b $00
	JSL.l CODE_02813E
	LDA.b $00
	STA.w $0073
	LDA.w $70E2,x
	SEC
	SBC.w #$0008
	STA.w $70E2,x
	LDA.w !RAM_YI_Global_MainScreenLayers
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

DATA_04A33E:
	dw $FFA0,$0060

;-------------------------------------------------------------------------
; Large wheel Main -- horizontal drift via DATA_04A33E (-60/+60),
; continuously requeues the BG3 stripe redraw for the wheel art.
; Raidenthequick: main_large_log_bg3 (related).
;-------------------------------------------------------------------------
YI_NorSpr051_LargeWheel_Main:
main_large_wheel:                                 ; Raidenthequick: main_large_log_bg3
;$04A342
	LDA.w #$0104
	STA.w $0CB8
	LDA.b $79,x
	AND.w #$00FF
	STA.b $00
	LDA.w #$0010
	SEC
	SBC.b $00
	STA.w $7E40
	LDY.b #$04
	JSL.l CODE_02841C
	LDA.w #$0710
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState06
	BNE.b CODE_04A372
	LDA.w #$0215
	STA.w !RAM_YI_Global_MainScreenLayers
CODE_04A372:
	JSL.l CODE_03AF23
	JSR.w CODE_04A2E6
	BCC.b CODE_04A3A0
	LDX.b #FXCODE_08D46A>>16
	LDA.w #FXCODE_08D46A
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $01A4
	SEP.b #$10
	LDX.b $12
	STZ.w $0CB2
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !RAM_YI_Global_MainScreenLayers
	RTL

CODE_04A3A0:
	LDA.b $19,x
	AND.w #$00FF
	CMP.w #$0020
	BCC.b CODE_04A3AD
	JMP.w CODE_04A45D

CODE_04A3AD:
	LDY.w $60C0
	BEQ.b CODE_04A3BA
	LDY.w $60AB
	BPL.b CODE_04A3BA
	JMP.w CODE_04A45D

CODE_04A3BA:
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w $6112
	BMI.b CODE_04A3CC
	CMP.w #$0038
	BCC.b CODE_04A3CF
CODE_04A3CC:
	JMP.w CODE_04A45D

CODE_04A3CF:
	LDA.w $7C16,x
	CLC
	ADC.w #$0030
	CMP.w #$0060
	BCS.b CODE_04A3CC
	LDA.w $7A38,x
	BNE.b CODE_04A406
	LDA.w #$0038
	SEC
	SBC.w $7182,x
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.b $02
	SEP.b #$20
	LDA.b #$92
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.b #$00
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.b $02
	STA.w !REGISTER_Mode7MatrixParameterB
	REP.b #$20
	LDA.w !REGISTER_PPUMultiplicationProductMid
	XBA
	STA.b $18,x
CODE_04A406:
	SEP.b #$20
	LDA.b #$C0
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.b #$01
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.b $19,x
	STA.w !REGISTER_Mode7MatrixParameterB
	REP.b #$20
	LDA.w !REGISTER_PPUMultiplicationProductMid
	CLC
	ADC.w $7182,x
	SEC
	SBC.w #$0037
	SEC
	SBC.w $6112
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC.w $61B4
	LDY.w $7A38,x
	BNE.b CODE_04A43B
	LDA.w $7A36,x
	BPL.b CODE_04A43B
	STZ.w $7A36,x
CODE_04A43B:
	LDA.w #$0001
	STA.w $7A38,x
	STZ.w $60AA
	LDA.w $7A36,x
	CLC
	ADC.w #$0008
	CMP.w #$0400
	BCS.b CODE_04A453
	STA.w $7A36,x
CODE_04A453:
	LDA.b $18,x
	CLC
	ADC.w $7A36,x
	STA.b $18,x
	BRA.b CODE_04A4A8

CODE_04A45D:
	LDA.w $7A38,x
	BEQ.b CODE_04A478
	STZ.w $7A38,x
	LDA.b $19,x
	AND.w #$00FF
	CMP.w #$0020
	BCC.b CODE_04A478
	LDA.w #$0400
	STA.w $60AA
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_04A478:
	STZ.b $18,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAY
	DEC
	STA.b $00
	LDA.w #$0002
	CPY.b #$00
	BNE.b CODE_04A48C
	EOR.w #$FFFF
	INC
CODE_04A48C:
	CLC
	ADC.w $7A36,x
	STA.w $7A36,x
	SEC
	SBC.w DATA_04A33E,y
	EOR.b $00
	BMI.b CODE_04A4A8
	TYA
	EOR.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w DATA_04A33E,y
	STA.w $7A36,x
CODE_04A4A8:
	LDA.b $78,x
	CLC
	ADC.w $7A36,x
	STA.b $78,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Brown wooden board ($05E manual, $05F auto-rotate) Init. Increments the
; global $0DF9 (count of active boards driving the swing-cluster physics)
; and exits; per-board state comes from the level header.
; Raidenthequick: init_plank_bg3.
;-------------------------------------------------------------------------
YI_NorSpr05E_BrownWoodenBoard_Init:
YI_NorSpr05F_AutoRotateBrownWoodenBoard_Init:
init_plank_bg3:                                   ; Raidenthequick: init_plank_bg3
;$04A4B1
	INC.w $0DF9
	RTL

;---------------------------------------------------------------------------

DATA_04A4B5:
	dw DATA_04A4B7

DATA_04A4B7:
	db $04,$08,$E8,$30,$F8,$E8,$30,$F8,$18,$30,$08,$18,$30,$04,$60,$00
	db $01,$A2,$01,$02,$E0,$02,$03,$22,$03,$00

DATA_04A4D1:
DATA_plank_bg3_state_ptr:                              ; 2-entry SpriteID-relative dispatch
	dw CODE_plank_bg3_state_00_manual_swing                                ;  $05E: manual swing (Yoshi-driven)
	dw CODE_plank_bg3_state_01_auto_rotate                                ;  $05F: auto-rotate (continuous)

;-------------------------------------------------------------------------
; Brown wooden board Main. Dispatches via DATA_plank_bg3_state_ptr (2 entries:
; manual-swing CODE_plank_bg3_state_00_manual_swing / auto-rotate CODE_plank_bg3_state_01_auto_rotate). Synchronises the
; shared cluster phase via $0DF7 (frame stamp) and $0DFB (active-count
; snapshot) so all boards in a level swing in unison.
; Raidenthequick: main_plank_bg3.
;-------------------------------------------------------------------------
YI_NorSpr05E_BrownWoodenBoard_Main:
YI_NorSpr05F_AutoRotateBrownWoodenBoard_Main:
main_plank_bg3:                                   ; Raidenthequick: main_plank_bg3
;$04A4D5
	LDA.w $0030
	CMP.w $0DF7
	BEQ.b CODE_04A4F1
	STA.w $0DF7
	LDA.w $0DF9
	STA.w $0DFB
	LDX.b #FXCODE_08D46A>>16
	LDA.w #FXCODE_08D46A
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_04A4F1:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_04A4FF
	JMP.w CODE_04A586

CODE_04A4FF:
	LDX.b $12
	JSR.w CODE_04A300
	BCC.b CODE_04A579
	DEC.w $0DF9
	DEC.w $0DFB
	BNE.b CODE_04A578
CODE_04A50E:
	REP.b #$10
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	SEP.b #$30
	LDA.b #$10
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.b #$07
	STA.w !RAM_YI_Global_SubScreenLayers
	LDA.b #$02
	STA.w !RAM_YI_Global_ColorMathInitialSettings
	LDA.b #$20
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.b #$18
	STA.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDA.w #$14E9
	STA.l YI_Global_PaletteMirror[$01].LowByte
	STA.l $702D6E
	LDA.w #$14E9
	STA.l YI_Global_PaletteMirror[$08].LowByte
	STA.l $702D7C
	LDA.w #$3216
	STA.l YI_Global_PaletteMirror[$02].LowByte
	STA.l $702D70
	LDA.w #$3216
	STA.l YI_Global_PaletteMirror[$09].LowByte
	STA.l $702D7E
	LDA.w #$0000
	STA.l YI_Global_PaletteMirror[$03].LowByte
	STA.l $702D72
	STA.l YI_Global_PaletteMirror[$0A].LowByte
	STA.l $702D80
CODE_04A578:
	RTL

CODE_04A579:
	TXY
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr05E_BrownWoodenBoard
	ASL
	TAX
	JSR.w (DATA_plank_bg3_state_ptr,x)
CODE_04A586:
	LDA.w #$0104
	STA.w $0CB8
	LDA.b $79,x
	AND.w #$00FF
	STA.b $00
	LDA.w #$00C0
	SEC
	SBC.b $00
	STA.w $7E40
	LDA.w $7682,x
	PHA
	SEC
	SBC.w #$0010
	STA.w $7682,x
	LDY.b #$00
	LDA.w DATA_04A4B5,y
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #$0078
	SEC
	SBC.w $7680,x
	STA.w !RAM_YI_Global_Layer3XPosLo
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7682,x
	CLC
	ADC.w #$000F
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	CLC
	ADC.w !RAM_YI_Global_Layer1YPosLo
	STA.w $0CB6
	LDA.w $0CB8
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7E40
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #DATA_04A4B7>>16
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08D486>>16
	LDA.w #FXCODE_08D486
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	DEC.w $0DFB
	BNE.b CODE_04A5F4
	JSL.l CODE_04A50E
CODE_04A5F4:
	LDX.b $12
	PLA
	STA.w $7682,x
	RTL

CODE_04A5FB:
CODE_plank_bg3_state_00_manual_swing:
	TYX
	LDA.w $7A38,x
	BEQ.b CODE_04A612
CODE_04A601:
	LDA.b $78,x
	CLC
	ADC.w $7A36,x
	BPL.b CODE_04A60F
	STZ.w $7A38,x
	LDA.w #$0000
CODE_04A60F:
	STA.b $78,x
	RTS

CODE_04A612:
	LDA.b $79,x
	AND.w #$00FF
	CMP.w #$0020
	BCC.b CODE_04A621
	INC.w $7A38,x
	BRA.b CODE_04A601

CODE_04A621:
	LDY.b #$20
	LDA.w #$0018
	JSR.w CODE_04A280
	BCS.b CODE_04A64B
	LDA.b $78,x
	CLC
	ADC.w $7A36,x
	CMP.w #$4000
	BCC.b CODE_04A639
	LDA.w #$4000
CODE_04A639:
	STA.b $78,x
	LDA.w $7A36,x
	CLC
	ADC.w #$0003
	CMP.w #$0200
	BCS.b CODE_04A65B
	STA.w $7A36,x
	RTS

CODE_04A64B:
	STZ.w $7A36,x
	LDA.b $78,x
	SEC
	SBC.w #$0100
	BPL.b CODE_04A659
	LDA.w #$0000
CODE_04A659:
	STA.b $78,x
CODE_04A65B:
	RTS

CODE_04A65C:
CODE_plank_bg3_state_01_auto_rotate:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_04A69E
	INC.w $7A38,x
	LDA.w $7A36,x
	CLC
	ADC.w #$0010
	CLC
	ADC.w $7A38,x
	CMP.w #$0400
	BCS.b CODE_04A678
	STA.w $7A36,x
CODE_04A678:
	LDA.b $78,x
	CLC
	ADC.w $7A36,x
	BPL.b CODE_04A69C
	STZ.w $7A38,x
	STZ.w $7A36,x
	LDA.w $70E2,x
	AND.w #$0010
	BNE.b CODE_04A693
	LDA.w #$0060
	BRA.b CODE_04A696

CODE_04A693:
	LDA.w #$0080
CODE_04A696:
	STA.w $7A96,x
	LDA.w #$0000
CODE_04A69C:
	STA.b $78,x
CODE_04A69E:
	LDA.b $78,x
	CMP.w #$1500
	BCS.b CODE_04A6AD
	LDY.b #$20
	LDA.w #$0018
	JSR.w CODE_04A280
CODE_04A6AD:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Horizontal moving red platform ($089) Init. Picks initial X-velocity by
; the low nibble of pixel-Y (bit 4 -> negative), stores the +0x28/-0x28
; sweep limits into 701900/701902.
; Raidenthequick: CODE_init_red_platform.
;-------------------------------------------------------------------------
YI_NorSpr089_HorizontalMovingRedPlatform_Init:
CODE_init_red_platform:                                ; Raidenthequick: CODE_init_red_platform
CODE_04A6AE:
	LDA.w $7182,x
	AND.w #$0010
	BEQ.b CODE_04A6BB
	LDA.w #$FF90
	BRA.b CODE_04A6BE

CODE_04A6BB:
	LDA.w #$0070
CODE_04A6BE:
	STA.w $75E0,x
	LDA.w #$0005
	STA.w $7540,x
	LDA.w $70E2,x
	CLC
	ADC.w #$0028
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.w #$0050
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_04A6D8:
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CMP.w #$0003
	BEQ.b CODE_04A6E5
	CMP.w #$000D
	BNE.b CODE_04A6EB
CODE_04A6E5:
	INC.w $7B58,x
	INC.w $7B58,x
CODE_04A6EB:
	LDA.w #$0014
	STA.w $7BB6,x
	LDA.w #$0008
	STA.w $7BB8,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Horizontal red-platform Main -- if X breaches the sweep limits, snap
; back, negate X-speed, fall through to the shared "ride the rail" block
; at CODE_04A77C.
; Raidenthequick: main_red_platform.
;-------------------------------------------------------------------------
YI_NorSpr089_HorizontalMovingRedPlatform_Main:
main_red_platform:                                ; Raidenthequick: main_red_platform
;$04A6F8
	JSL.l CODE_03AF23
	LDA.w $70E2,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_04A709
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BMI.b CODE_04A722
CODE_04A709:
	LDA.b $18,x
	STA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w $7CD6,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $75E0,x
	EOR.w #$FFFF
	INC
	STA.w $75E0,x
CODE_04A722:
	JMP.w CODE_04A77C

;-------------------------------------------------------------------------
; Vertical pink-platform ($08A) Init. Same shape as the horizontal red
; version but on Y: bit 4 of pixel-X picks the initial speed sign, then
; arms the bob timer at $7542.
; Raidenthequick: CODE_init_pink_platform.
;-------------------------------------------------------------------------
YI_NorSpr08A_VerticalMovingPinkPlatform_Init:
CODE_init_pink_platform:                               ; Raidenthequick: CODE_init_pink_platform
CODE_04A725:
	LDA.w $70E2,x
	AND.w #$0010
	BEQ.b CODE_04A732
	LDA.w #$FF90
	BRA.b CODE_04A735

CODE_04A732:
	LDA.w #$0070
CODE_04A735:
	STA.w $75E2,x
	LDA.w #$0005
	STA.w $7542,x
	LDA.w $7182,x
	CLC
	ADC.w #$0020
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.w #$0040
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JMP.w CODE_04A6D8

;-------------------------------------------------------------------------
; Pink-platform Main -- mirror of red-platform but on Y. Continues into
; CODE_04A77C for the shared player-stand check + interaction.
; Raidenthequick: main_pink_platform.
;-------------------------------------------------------------------------
YI_NorSpr08A_VerticalMovingPinkPlatform_Main:
main_pink_platform:                               ; Raidenthequick: main_pink_platform
;$04A752
	JSL.l CODE_03AF23
	LDA.w $7182,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_04A763
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BMI.b CODE_04A77C
CODE_04A763:
	LDA.b $78,x
	STA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7CD8,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $75E2,x
	EOR.w #$FFFF
	INC
	STA.w $75E2,x
CODE_04A77C:
	LDA.w $70E2,x
	SEC
	SBC.b $18,x
	STA.w $72C0,x
	LDA.w $7182,x
	SEC
	SBC.b $78,x
	STA.w $72C2,x
CODE_04A78E:
	LDY.w $0B59
	BNE.b CODE_04A7F3
	LDY.w $60AB
	BMI.b CODE_04A7F3
	LDY.w $0D94
	BNE.b CODE_04A7F3
	CPX.w $61B6
	BNE.b CODE_04A7EE
	LDA.w $60FC
	AND.w #$01E0
	BEQ.b CODE_04A7B3
	AND.w #$0180
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_04A7C7
CODE_04A7B3:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C0,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $611C
	CLC
	ADC.w $72C0,x
	STA.w $611C
CODE_04A7C7:
	LDA.w $60FC
	AND.w #$001F
	BEQ.b CODE_04A7D8
	AND.w #$0018
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_04A7EE
CODE_04A7D8:
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C2,x
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $611E
	CLC
	ADC.w $72C2,x
	STA.w $611E
	BRA.b CODE_04A7F6

CODE_04A7EE:
	LDY.w $60C0
	BNE.b CODE_04A7F6
CODE_04A7F3:
	JMP.w CODE_04A853

CODE_04A7F6:
	LDA.w $7BB6,x
	CLC
	ADC.w $6120
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7CD6,x
	SEC
	SBC.w $611C
	CMP.b $00
	BCS.b CODE_04A853
	LDA.w $7BB8,x
	CLC
	ADC.w $6122
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7CD8,x
	SEC
	SBC.w $611E
	CMP.b $00
	BCS.b CODE_04A853
	SEC
	SBC.b $00
	STA.b $02
	CMP.w #$FFF6
	BCC.b CODE_04A853
	CPX.w $61B6
	BEQ.b CODE_04A83B
	LDY.w $61B6
	BNE.b CODE_04A85B
	STX.w $61B6
CODE_04A83B:
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.b $02
	CLC
	ADC.w #$0002
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60D2
	STZ.w $60AA
	INC.w $61B4
	BRA.b CODE_04A85B

CODE_04A853:
	CPX.w $61B6
	BNE.b CODE_04A85B
	STZ.w $61B6
CODE_04A85B:
	LDA.w $70E2,x
	STA.b $18,x
	LDA.w $7182,x
	STA.b $78,x
	RTL

;---------------------------------------------------------------------------

; See docs/family-platforms.md for the full movable-platform family
; breakdown (~30 sprites across 7 sub-families). The 10-label line-guided
; cluster $185-$18E shares a single Main body at Bank04:5585 -- the
; variant encoding splits SpriteID-bit 1 (color-pair) and bit 0
; (direction-flip), with $701900 doing triple duty (moving flag / rail-id
; / per-state modifier).

DATA_04A866:
	dw $AA00,$0000,$5400,$0001,$0000,$0004

YI_NorSpr185_MovingLineGuidedGreenPlatformLeft_Init:
YI_NorSpr186_MovingLineGuidedGreenPlatformRight_Init:
YI_NorSpr187_MovingLineGuidedYellowPlatformLeft_Init:
YI_NorSpr188_MovingLineGuidedYellowPlatformRight_Init:
init_moving_line_guided_platform:                 ; rail-following platform, color/direction by SpriteID
;$04A872
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr185_MovingLineGuidedGreenPlatformLeft
	AND.w #$0002
	ASL
	TAY
	LDA.w DATA_04A866,y
	STA.w $7A36,x
	LDA.w DATA_04A866+$02,y
	STA.w $7A38,x
YI_NorSpr189_LineGuidedGreenPlatformLeft_Init:
YI_NorSpr18A_LineGuidedGreenPlatformRight_Init:
YI_NorSpr18B_LineGuidedYellowPlatformLeft_Init:
YI_NorSpr18C_LineGuidedYellowPlatformRight_Init:
YI_NorSpr18D_LineGuidedRedPlatformLeft_Init:
YI_NorSpr18E_LineGuidedGreenPlatformRight_Init:
init_line_guided_platform:                        ; stationary-when-not-stood-on rail platform
	LDA.w #$0080
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0185
	AND.w #$0001
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr185_MovingLineGuidedGreenPlatformLeft
	AND.w #$0001
	CMP.b $00
	BNE.b CODE_04A8AB
	LDA.w #$8000
	STA.b $16,x
CODE_04A8AB:
	LDA.w #$0014
	STA.w $7BB6,x
	LDA.w #$0008
	STA.w $7BB8,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr185_MovingLineGuidedGreenPlatformLeft_Main:
YI_NorSpr186_MovingLineGuidedGreenPlatformRight_Main:
YI_NorSpr187_MovingLineGuidedYellowPlatformLeft_Main:
YI_NorSpr188_MovingLineGuidedYellowPlatformRight_Main:
YI_NorSpr189_LineGuidedGreenPlatformLeft_Main:
YI_NorSpr18A_LineGuidedGreenPlatformRight_Main:
YI_NorSpr18B_LineGuidedYellowPlatformLeft_Main:
YI_NorSpr18C_LineGuidedYellowPlatformRight_Main:
YI_NorSpr18D_LineGuidedRedPlatformLeft_Main:
YI_NorSpr18E_LineGuidedGreenPlatformRight_Main:
main_line_guided_platform:                        ; common Main for all 10 line-guided variants
;$04A8B8
	JSL.l CODE_03AF23
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	STA.b $02
	JSL.l CODE_04A9FD
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BMI.b CODE_04A8FF
	LDA.w $70E2,x
	SEC
	SBC.b $00
	CLC
	ADC.w $72C0,x
	STA.w $72C0,x
	LDA.w $7182,x
	SEC
	SBC.b $02
	CLC
	ADC.w $72C2,x
	STA.w $72C2,x
	LDA.w $70E2,x
	CLC
	ADC.w $7B56,x
	STA.w $7CD6,x
	LDA.w $7182,x
	CLC
	ADC.w $7B58,x
	STA.w $7CD8,x
	BRA.b CODE_04A92A

CODE_04A8FF:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_04A92A
	CMP.w #$8000
	ROR
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $75E0,x
	LSR
	XBA
	STA.b $16,x
CODE_04A92A:
	LDY.w $61B6
	STY.b $0E
	JSL.l CODE_04A78E
	LDA.w $7A38,x
	ORA.w $7A36,x
	BNE.b CODE_04A959
	CPX.w $61B6
	BNE.b CODE_04A958
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr189_LineGuidedGreenPlatformLeft
	AND.w #$0006
	ASL
	TAY
	LDA.w DATA_04A866,y
	STA.w $7A36,x
	LDA.w DATA_04A866+$02,y
	STA.w $7A38,x
CODE_04A958:
	RTL

CODE_04A959:
	CPX.b $0E
	BNE.b CODE_04A958
	CPX.w $61B6
	BEQ.b CODE_04A958
	LDA.w $61D6
	BNE.b CODE_04A958
	LDY.w $0D94
	BNE.b CODE_04A958
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BMI.b CODE_04A9A8
	LDA.b $16,x
	AND.w #$FF00
	XBA
	ASL
	EOR.w #$0100
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7A37,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w $60A8
	STA.w $60A8
	STA.w $60B4
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	CLC
	ADC.w $60AA
	STA.w $60AA
	BRA.b CODE_04A9CD

CODE_04A9A8:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ORA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_04A9FC
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w $60A8
	STA.w $60A8
	STA.w $60B4
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_04A9C6
	CMP.w #$8000
	ROR
CODE_04A9C6:
	CLC
	ADC.w $60AA
	STA.w $60AA
CODE_04A9CD:
	LDA.w $60A8
	CMP.w #$0800
	BMI.b CODE_04A9D8
	LDA.w #$0800
CODE_04A9D8:
	CMP.w #$F800
	BPL.b CODE_04A9E0
	LDA.w #$F800
CODE_04A9E0:
	STA.w $60A8
	STA.w $60B4
	LDA.w $60AA
	CMP.w #$0800
	BMI.b CODE_04A9F1
	LDA.w #$0800
CODE_04A9F1:
	CMP.w #$F800
	BPL.b CODE_04A9F9
	LDA.w #$F800
CODE_04A9F9:
	STA.w $60AA
CODE_04A9FC:
	RTL

;---------------------------------------------------------------------------

CODE_04A9FD:
	LDA.b $16,x
	STA.w $6046
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #$FFFF
	STA.w $6040
	LDA.w $75E0,x
	STA.w $601E
	LDX.b #FXCODE_0B89E9>>16
	LDA.w #FXCODE_0B89E9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $601E
	STA.w $75E0,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr18F_SpiralPlatform_Init:
init_spiral_platform:                             ; standing platform that spirals around pivot
;$04AA24
	JSL.l CODE_03AE60
	LDA.w #$0080
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $7400,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr18F_SpiralPlatform_Main:
main_spiral_platform:                             ; tracks pivot delta + applies to platform pos
;$04AA32
	JSL.l CODE_03AA52
	JSL.l CODE_03AF23
	STZ.b $0E
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	STA.b $02
	JSR.w CODE_04AAA2
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BMI.b CODE_04AA6A
	LDA.w $70E2,x
	SEC
	SBC.b $00
	CLC
	ADC.w $72C0,x
	STA.w $72C0,x
	LDA.w $7182,x
	SEC
	SBC.b $02
	CLC
	ADC.w $72C2,x
	STA.w $72C2,x
	BRA.b CODE_04AA95

CODE_04AA6A:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_04AA95
	CMP.w #$8000
	ROR
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $75E0,x
	LSR
	XBA
	STA.b $16,x
CODE_04AA95:
	JSR.w CODE_04AABE
	JSR.w CODE_04ABC6
	JSR.w CODE_04ABED
	JSR.w CODE_04AC61
	RTL

CODE_04AAA2:
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w $75E0,x
	STA.w $601E
	LDX.b #FXCODE_0B89E9>>16
	LDA.w #FXCODE_0B89E9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $601E
	STA.w $75E0,x
	RTS

CODE_04AABE:
	LDY.w $7D36,x
	BMI.b CODE_04AB06
CODE_04AAC3:
	CPX.w $61B6
	BNE.b CODE_04AB05
	STZ.w $61B6
	LDY.w $0D94
	BNE.b CODE_04AB05
	LDA.b $16,x
	AND.w #$FF00
	XBA
	ASL
	EOR.w #$0100
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7A37,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w $60A8
	STA.w $60A8
	STA.w $60B4
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	CLC
	ADC.w $60AA
	STA.w $60AA
CODE_04AB05:
	RTS

CODE_04AB06:
	LDY.w $60AB
	BMI.b CODE_04AAC3
	LDY.w $0D94
	BNE.b CODE_04AAC3
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_04AAC3
	CPX.w $61B6
	BEQ.b CODE_04AB35
	LDY.w $61B6
	BNE.b CODE_04AB05
	STX.w $61B6
	LDA.w !EXRAM_YI_Player_SubXPosHi|!EXRAMBankMirror
	AND.w #$FF00
	STA.b $76,x
CODE_04AB35:
	LDA.w $7182,x
	SEC
	SBC.w #$0022
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60AA
	INC.w $61B4
	LDA.w #$0120
	JSL.l CODE_04AB6F
	LDA.b $16,x
	CLC
	ADC.w #$4000
	PHP
	LDA.w $7C16,x
	XBA
	AND.w #$FF00
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	PLP
	BPL.b CODE_04AB69
	EOR.w #$FFFF
	INC
CODE_04AB69:
	CLC
	ADC.b $0E
	STA.b $0E
	RTS

;---------------------------------------------------------------------------

CODE_04AB6F:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $72BF,x
	AND.w #$FF00
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !EXRAM_YI_Player_SubXPosHi|!EXRAMBankMirror
	AND.w #$FF00
	STA.b $00
	LDY.b $76,x
	TYA
	ORA.b $00
	STA.b $76,x
	LDA.w !EXRAM_YI_Player_XPosHi|!EXRAMBankMirror
	AND.w #$00FF
	STA.b $00
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BPL.b CODE_04ABAE
	CLC
	ADC.b $76,x
	STA.b $76,x
	LDA.b $00
	SBC.w #$0000
	BRA.b CODE_04ABB8

CODE_04ABAE:
	CLC
	ADC.b $76,x
	STA.b $76,x
	LDA.b $00
	ADC.w #$0000
CODE_04ABB8:
	XBA
	STA.b $00
	LDA.b $77,x
	AND.w #$00FF
	ORA.b $00
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	RTL

;---------------------------------------------------------------------------

CODE_04ABC6:
	LDA.b $16,x
	AND.w #$FF00
	XBA
	ASL
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$FC00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BPL.b CODE_04ABE7
	ASL
CODE_04ABE7:
	CLC
	ADC.b $0E
	STA.b $0E
	RTS

;---------------------------------------------------------------------------

CODE_04ABED:
	LDA.b $0E
	SEC
	SBC.w #$0080
	BPL.b CODE_04AC24
	CLC
	ADC.w $7A36,x
	STA.w $7A36,x
	LDA.w $7A38,x
	SBC.w #$0000
	STA.w $7A38,x
	BPL.b CODE_04AC48
	STZ.w $7A38,x
	STZ.w $7A36,x
	LDA.b $16,x
	CLC
	ADC.w #$8000
	STA.b $16,x
	LDA.w $75E0,x
	CLC
	ADC.w #$0100
	AND.w #$01FE
	STA.w $75E0,x
	BRA.b CODE_04AC48

CODE_04AC24:
	CLC
	ADC.w $7A36,x
	STA.w $7A36,x
	LDA.w $7A38,x
	ADC.w #$0000
	STA.w $7A38,x
	LDA.w $7A37,x
	CMP.w #$0200
	BMI.b CODE_04AC48
	LDA.w #$0002
	STA.w $7A38,x
	LDA.w #$0000
	STZ.w $7A36,x
CODE_04AC48:
	LDA.b $16,x
	CLC
	ADC.w #$4000
	PHP
	LDA.w $7A37,x
	ASL
	ASL
	PLP
	BPL.b CODE_04AC5B
	EOR.w #$FFFF
	INC
CODE_04AC5B:
	CLC
	ADC.b $78,x
	STA.b $78,x
	RTS

;---------------------------------------------------------------------------

CODE_04AC61:
	LDA.w #FXDATA_550000+$0001
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$0001)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.b $79,x
	AND.w #$00FF
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

; SMWC: Kill Yoshi Subroutine (spike-death variant). Companion to
; CODE_player_death_lava at $00:E101.
CODE_04AC9C:
CODE_player_death_spike:
	LDA.w #!Define_YI_PlayerState0E_TouchedSpike
	JSL.l CODE_04F6E2
	STZ.w $60C6
	LDA.w #$003A
	STA.w $60F8
	LDA.w #$0022
	STA.w $61D2
	STZ.w $61F4
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	RTL

;---------------------------------------------------------------------------

YI_NorSpr07F_LogSeesawPlatform_Init:
init_log_seesaw_platform:                         ; log-on-a-pivot that tips when stood on
;$04ACB9
	JSL.l CODE_03AE60
	JSL.l CODE_04AE9D
	STZ.w $7400,x
	LDA.w #$2000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

DATA_04ACCB:
	dw $0020,$FFE0

DATA_04ACCF:
	dw $FF00,$0100

YI_NorSpr07F_LogSeesawPlatform_Main:
main_log_seesaw_platform:                         ; rocks based on Yoshi-side, applies pivot xform
;$04ACD3
	LDY.b #$00
	JSR.w CODE_04AEDF
	LDY.b #$00
	LDA.w $7A39,x
	AND.w #$00FF
	CLC
	ADC.w #$0020
	AND.w #$00FF
	CMP.w #$0040
	BCC.b CODE_04AD09
	CMP.w #$0080
	BMI.b CODE_04ACF3
	INY
	INY
CODE_04ACF3:
	LDA.w DATA_04ACCF,y
	STA.w $75E0,x
	LDA.w #$0020
	STA.w $7540,x
	ASL
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
CODE_04AD09:
	LDA.w $7A39,x
	AND.w #$00FF
	ASL
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$1A00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B855B>>16
	LDA.w #FXCODE_0B855B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	PHX
	LDA.w $7722,x
	LSR
	CLC
	ADC.w #$01C0
	STA.b $00
	LDA.w $7042,x
	XBA
	AND.w #$FF00
	ORA.b $00
	STA.b $00
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $6094
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $02
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $609C
	SEC
	SBC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.b $04
	LDA.w #$0003
	STA.b $06
	REP.b #$10
	LDY.w $7362,x
CODE_04AD66:
	LDA.b $02
	SEC
	SBC.w #$0010
	STA.w $6000,y
	STA.w $6010,y
	LDA.b $02
	STA.w $6008,y
	STA.w $6018,y
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $02
	LDA.b $04
	SEC
	SBC.w #$0010
	STA.w $6002,y
	STA.w $600A,y
	LDA.b $04
	STA.w $6012,y
	STA.w $601A,y
	CLC
	ADC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.b $04
	LDA.b $00
	STA.w $6004,y
	INC
	INC
	STA.w $600C,y
	CLC
	ADC.w #$001E
	STA.w $6014,y
	INC
	INC
	STA.w $601C,y
	TYA
	CLC
	ADC.w #$0020
	TAY
	DEC.b $06
	BNE.b CODE_04AD66
	SEP.b #$10
	PLX
	JSL.l CODE_03AF23
	LDA.w $60AA
	BPL.b CODE_04ADC9
	JMP.w CODE_04AE51

CODE_04ADC9:
	LDA.w $7A39,x
	AND.w #$00FF
	CLC
	ADC.w #$0028
	AND.w #$00FF
	CMP.w #$0050
	BCC.b CODE_04ADDE
	JMP.w CODE_04AE56

CODE_04ADDE:
	LDA.w #$FA00
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDY.b $18,x
	BEQ.b CODE_04AE00
	LDA.w $7E12
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BPL.b CODE_04ADF5
	EOR.w #$FFFF
	INC
CODE_04ADF5:
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0004
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_04AE00:
	LDY.b #$00
	LDA.w $611C
	SEC
	SBC.w $7CD6,x
	BMI.b CODE_04AE0D
	INY
	INY
CODE_04AE0D:
	JSR.w CODE_04AF4D
	LDA.w $603E
	BEQ.b CODE_04AE51
	LDA.w $7CD8,x
	CLC
	ADC.w $603C
	SEC
	SBC.w $6112
	SEC
	SBC.w #$0020
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $60AA
	ASL
	ASL
	ASL
	STZ.w $60AA
	INC.w $61B4
	LDY.b $18,x
	BNE.b CODE_04AE3B
	INC.b $18,x
	BRA.b CODE_04AE49

CODE_04AE3B:
	LDA.b $04
	BPL.b CODE_04AE43
	EOR.w #$FFFF
	INC
CODE_04AE43:
	ASL
	ASL
	CLC
	ADC.w #$0200
CODE_04AE49:
	STA.b $00
	LDY.b $02
	CPY.b #$01
	BRA.b CODE_04AE62

CODE_04AE51:
	LDY.w $7A39,x
	BRA.b CODE_04AE59

CODE_04AE56:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_04AE59:
	STZ.b $18,x
	LDA.w #$0200
	STA.b $00
	CPY.b #$00
CODE_04AE62:
	BPL.b CODE_04AE80
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	ADC.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0100
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BPL.b CODE_04AE9D
	BRA.b CODE_04AE9A

CODE_04AE80:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SBC.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$FF00
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BMI.b CODE_04AE9D
CODE_04AE9A:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
CODE_04AE9D:
	LDA.w #FXDATA_540000+$4060
	LDY.b #(FXDATA_540000+$4060)>>16
CODE_04AEA2:
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	TYA
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7A39,x
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
	RTL

;---------------------------------------------------------------------------

DATA_04AED7:
	dw $C000,$4001,$E000,$2001

CODE_04AEDF:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_04AF3C
	LDA.w $7A38,x
	STA.b $00
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BPL.b CODE_04AEFF
	CMP.w DATA_04AED7,y
	BPL.b CODE_04AF39
	LDA.w DATA_04AED7,y
	BRA.b CODE_04AF07

CODE_04AEFF:
	CMP.w DATA_04AED7+$02,y
	BMI.b CODE_04AF39
	LDA.w DATA_04AED7+$02,y
CODE_04AF07:
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr03D_LargeSeesaw
	BNE.b CODE_04AF38
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	CMP.b #$80
	ROR
	CMP.b #$80
	ROR
	EOR.b #$FF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	REP.b #$20
CODE_04AF38:
	PLA
CODE_04AF39:
	STA.w $7A38,x
CODE_04AF3C:
	RTS

;---------------------------------------------------------------------------

DATA_04AF3D:
	dw $D900,$2700,$F000,$1000,$8C00,$7400

DATA_04AF49:
	dw $0000,$8000

CODE_04AF4D:
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	STA.b $04
	LDA.w DATA_04AF3D,y
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	TYA
	AND.w #$0002
	TAY
	LDA.w DATA_04AF49,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	STY.b $02
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w $6112
	CLC
	ADC.w #$0020
	SEC
	SBC.w $7CD8,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7A39,x
	TYA
	ASL
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	PHX
	REP.b #$10
	TAX
	LDA.l FXDATA_0BBA12,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEP.b #$10
	PLX
	LDX.b #FXCODE_0B8500>>16
	LDA.w #FXCODE_0B8500
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

YI_NorSpr116_BuoyantRoundPlatform_Init:
init_buoyant_round_platform:                      ; floats on water; bobs from Yoshi weight
;$04AF9E
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w $70E2,x
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7182,x
	LDA.w #$0080
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7400,x
	RTL

;---------------------------------------------------------------------------

DATA_04AFBC:
	dw $FE00,$0200

YI_NorSpr116_BuoyantRoundPlatform_Main:
main_buoyant_round_platform:                      ; buoyancy + tilt feedback
;$04AFC0
	LDY.w $7722,x
	BMI.b CODE_04AFC9
	JSL.l CODE_03AA52
CODE_04AFC9:
	JSL.l CODE_03AF23
	LDY.b #$04
	JSR.w CODE_04AEDF
	LDY.b $18,x
	BNE.b CODE_04AFEB
	CLC
	ADC.w #$0200
	CMP.w #$0400
	BCS.b CODE_04AFEB
	STZ.w $7A38,x
	LDY.w $7722,x
	BMI.b CODE_04AFEB
	JSL.l CODE_03AEFD
CODE_04AFEB:
	LDY.w $60AB
	BPL.b CODE_04AFF3
	JMP.w CODE_04B09F

CODE_04AFF3:
	LDA.w #$F800
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDY.b $18,x
	BEQ.b CODE_04B015
	LDA.w $7E12
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BPL.b CODE_04B00A
	EOR.w #$FFFF
	INC
CODE_04B00A:
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0004
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_04B015:
	LDY.b #$04
	LDA.w $611C
	SEC
	SBC.w $7CD6,x
	BMI.b CODE_04B022
	INY
	INY
CODE_04B022:
	JSR.w CODE_04AF4D
	LDA.w $603E
	BEQ.b CODE_04B09F
	LDA.w $7CD8,x
	CLC
	ADC.w $603C
	SEC
	SBC.w #$0020
	SEC
	SBC.w $6112
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $60AA
	ASL
	ASL
	ASL
	PHA
	STZ.w $60AA
	LDY.w $7A39,x
	TYA
	ASL
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	CLC
	ADC.w #$0020
	AND.w #$01FE
	CMP.w #$0040
	BCC.b CODE_04B078
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	CLC
	ADC.w $60A8
	STA.w $60A8
	STA.w $60B4
CODE_04B078:
	INC.w $61B4
	LDY.w $7722,x
	BPL.b CODE_04B084
	JSL.l CODE_03AD74
CODE_04B084:
	LDY.b $18,x
	BNE.b CODE_04B093
	LDA.w #$FFFA
	STA.w $7720,x
	INC.b $18,x
	PLA
	BRA.b CODE_04B097

CODE_04B093:
	PLA
	LDA.w #$1000
CODE_04B097:
	STA.b $00
	LDY.b $02
	CPY.b #$01
	BRA.b CODE_04B0BE

CODE_04B09F:
	STZ.b $18,x
	STZ.w $7720,x
	LDY.b #$00
	LDA.w $7A38,x
	BNE.b CODE_04B0B3
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BRA.b CODE_04B0F6

CODE_04B0B3:
	BPL.b CODE_04B0B7
	INY
	INY
CODE_04B0B7:
	LDA.w DATA_04AFBC,y
	BRA.b CODE_04B0F3

CODE_04B0BC:
	CPY.b #$00
CODE_04B0BE:
	BPL.b CODE_04B0DC
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	ADC.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0100
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BPL.b CODE_04B0F6
	BRA.b CODE_04B0F3

CODE_04B0DC:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SBC.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$FF00
	BMI.b CODE_04B0F6
CODE_04B0F3:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
CODE_04B0F6:
	LDA.w $7722,x
	BMI.b CODE_04B104
	LDA.w #FXDATA_550000+$2060
	LDY.b #(FXDATA_550000+$2060)>>16
	JSL.l CODE_04AEA2
CODE_04B104:
	LDA.w #$0040
	LDY.w $7862,x
	BEQ.b CODE_04B10F
	LDA.w #$FFC0
CODE_04B10F:
	STA.w $75E2,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $7862,x
	REP.b #$20
	RTL

;---------------------------------------------------------------------------

YI_NorSpr03D_LargeSeesaw_Init:
init_large_seesaw:                                ; large two-platform seesaw; first-spawn guard via $0CB2
;$04B11C
	LDA.w $0CB2
	BEQ.b CODE_04B125
	JML.l CODE_03A31E

CODE_04B125:
	INC.w $0CB2
	LDA.w #$0078
	LDY.w $0073
	BEQ.b CODE_04B133
	LDA.w #$FF88
CODE_04B133:
	CLC
	ADC.w $70E2,x
	STA.w $70E2,x
	LDX.b #$04
CODE_04B13C:
	LDA.l DATA_5FE33E,x
	STA.l YI_Global_PaletteMirror[$01].LowByte,x
	STA.l $702D6E,x
	DEX
	DEX
	BPL.b CODE_04B13C
	LDX.b $12
	LDA.w !RAM_YI_Global_MainScreenLayers
	STA.w $7A36,x
	LDA.w #$1000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr03D_LargeSeesaw_Main:
main_large_seesaw:                                ; bg-fill BG3 + tip based on Yoshi weight
;$04B15B
	JSR.w CODE_04B2B3
	JSL.l CODE_03AF23
	JSR.w CODE_04B169
	JSR.w CODE_04B191
	RTL

CODE_04B169:
	LDY.b #$04
	JSR.w CODE_04AEDF
	SEC
	SBC.b $00
	BPL.b CODE_04B177
	EOR.w #$FFFF
	INC
CODE_04B177:
	CLC
	ADC.w $75E0,x
	CMP.w #$1000
	BMI.b CODE_04B18D
	PHA
	LDA.w #!Define_YI_SoundID1F_HitHead
	JSL.l CODE_push_sound_queue
	PLA
	SEC
	SBC.w #$1000
CODE_04B18D:
	STA.w $75E0,x
	RTS

CODE_04B191:
	LDY.w $60AB
	BPL.b CODE_04B19E
	LDY.w $60C0
	BEQ.b CODE_04B19E
	JMP.w CODE_04B238

CODE_04B19E:
	LDA.w #$F800
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDY.b $18,x
	BEQ.b CODE_04B1C8
	LDA.w $60FC
	AND.w #$0007
	BNE.b CODE_04B1C8
	LDA.w $7E12
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BPL.b CODE_04B1BD
	EOR.w #$FFFF
	INC
CODE_04B1BD:
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0004
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_04B1C8:
	LDY.b #$08
	LDA.w $611C
	SEC
	SBC.w $7CD6,x
	BMI.b CODE_04B1D5
	INY
	INY
CODE_04B1D5:
	JSR.w CODE_04AF4D
	LDA.w $603E
	BEQ.b CODE_04B238
	LDA.w $60FC
	AND.w #$0007
	BNE.b CODE_04B238
	LDA.w $7CD8,x
	CLC
	ADC.w $603C
	SEC
	SBC.w $6112
	SEC
	SBC.w #$0020
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $60AA
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0180
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STZ.w $60AA
	INC.w $61B4
	LDY.b $18,x
	BNE.b CODE_04B21F
	INC.b $18,x
	BRA.b CODE_04B22C

CODE_04B21F:
	LDA.b $04
	BPL.b CODE_04B227
	EOR.w #$FFFF
	INC
CODE_04B227:
	ASL
	CLC
	ADC.w #$0100
CODE_04B22C:
	STA.b $00
	LDY.b $02
	CPY.b #$01
	BRA.b CODE_04B277

DATA_04B234:
	dw $0020,$0010

CODE_04B238:
	STZ.b $18,x
	LDY.b #$00
	LDA.w $7A38,x
	EOR.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BPL.b CODE_04B246
	INY
	INY
CODE_04B246:
	LDA.w $7A38,x
	BPL.b CODE_04B24F
	EOR.w #$FFFF
	INC
CODE_04B24F:
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CMP.w #$0400
	BPL.b CODE_04B25C
	LDA.w #$0020
	BRA.b CODE_04B270

CODE_04B25C:
	LDA.w DATA_04B234,y
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
CODE_04B270:
	STA.b $00
	LDY.w $7A39,x
	CPY.b #$00
CODE_04B277:
	BPL.b CODE_04B295
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	ADC.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0100
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BPL.b CODE_04B2B2
	BRA.b CODE_04B2AF

CODE_04B295:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SBC.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$FF00
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BMI.b CODE_04B2B2
CODE_04B2AF:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
CODE_04B2B2:
	RTS

CODE_04B2B3:
	JSL.l CODE_03A299
	BCC.b CODE_04B2CF
	LDY.b $78,x
CODE_04B2BB:
	BNE.b CODE_04B2CF
	PLA
	LDY.b $16,x
	BEQ.b CODE_04B2C9
	STZ.w $0CB2
	JML.l CODE_03A31E

CODE_04B2C9:
	INC.b $16,x
	JSR.w CODE_04B601
	RTL

CODE_04B2CF:
	LDA.w #DATA_04B32F>>16
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #DATA_04B32F
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7A39,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7680,x
	CLC
	ADC.w #$0008
	STA.w $6040
	LDA.w $7682,x
	CLC
	ADC.w #$0010
	STA.w $6042
	LDX.b #FXCODE_08E447>>16
	LDA.w #FXCODE_08E447
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	SEP.b #$30
	LDA.b #$11
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.b #$06
	STA.w !RAM_YI_Global_SubScreenLayers
	LDA.b #$20
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.b #$08
	TSB.w !RAM_YI_Global_BGModeAndTileSizeSetting
	LDA.b #$18
	TSB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDX.b $12
	RTS

DATA_04B32F:
	db $10,$74,$F0,$75,$F1,$76,$F3,$77,$F6,$77,$FA,$76,$FD,$75,$FF,$74
	db $00,$8C,$00,$8B,$FF,$8A,$FD,$89,$FA,$89,$F6,$8A,$F3,$8B,$F1,$8C
	db $F0

;---------------------------------------------------------------------------

DATA_04B350:
DATA_bigger_boo_init_ptr:                              ; 2-entry sub-state dispatch table
	dw CODE_04B363
	dw CODE_04B467

;-------------------------------------------------------------------------
; Bigger Boo (sprite $016) -- World 1-4 castle boss.  Kamek-enlarges a
; small Boo into the giant rotating Boo who chases Yoshi.  Init dispatches
; through DATA_bigger_boo_init_ptr keyed by $76,x to pick "fresh-spawn" vs "growing
; cinematic" entry, then sets CurrentStatus = $02 (active).
; see also: ys_enmy*.asm (boss-class sprite handlers).
; Raidenthequick: init_bigger_boo.
;-------------------------------------------------------------------------
YI_NorSpr016_BiggerBoo_Init:
init_bigger_boo:                                  ; Raidenthequick: init_bigger_boo
;$04B354
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_bigger_boo_init_ptr,x)
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	RTL

CODE_04B363:
	TYX
	LDA.w #$0000
	STA.l $70336C
	STZ.w $1060
	SEP.b #$20
	LDA.b #$61
	STA.w !RAM_YI_Global_BGModeAndTileSizeSetting
	LDA.b #$22
	STA.w !RAM_YI_Global_ColorMathInitialSettings
	REP.b #$20
	LDY.w !RAM_YI_Level_LevelHeaderBG2TilesetLo
	CPY.b #$16
	BEQ.b CODE_04B386
	JMP.w CODE_04B42D

CODE_04B386:
	INC.w $1060
	LDA.w #$0001
	STA.w $1064
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CMP.w #$0C38
	BMI.b CODE_04B3B2
	LDA.w #!Define_YI_MusicID_FadeMusicCommand
	STA.w !RAM_YI_Global_PlayMusicLo
	JSL.l CODE_03AD74
	BCC.b CODE_04B3B2
	LDY.w $7722,x
	STY.b $77,x
	JSL.l CODE_03AD74
	BCS.b CODE_04B3B3
	JSL.l CODE_03AEFD
CODE_04B3B2:
	RTS

CODE_04B3B3:
	STZ.w $60A8
	STZ.w $60B4
	JSL.l CODE_04F74A
	LDA.w #$0048
	JSL.l CODE_spawn_sprite_init
	LDA.w #$0000
	STA.w $70E2,y
	LDA.w $6094
	SEC
	SBC.w #$0060
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0020
	STA.w $7182,x
	LDA.w #$0003
	STA.w $74A2,x
	LDA.w #$0004
	STA.w $7542,x
	LDA.w #$0080
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0002
	STA.w $7400,x
	LDY.b #$04
	STY.b $76,x
	LDX.b #$20
CODE_04B3FC:
	LDA.l $702E8C,x
	STA.l YI_Global_PaletteMirror[$E0].LowByte,x
	DEX
	DEX
	BPL.b CODE_04B3FC
	LDX.b #$C0
	LDA.w #$0000
CODE_04B40D:
	STA.l $702F6A,x
	DEX
	DEX
	BNE.b CODE_04B40D
	LDX.b #$20
CODE_04B417:
	LDA.l YI_Global_PaletteMirror[$5F].LowByte,x
	STA.l $70302A,x
	LDA.l YI_Global_PaletteMirror[$6F].LowByte,x
	STA.l $70304A,x
	DEX
	DEX
	BNE.b CODE_04B417
	BRA.b CODE_04B44A

CODE_04B42D:
	INC.b $76,x
	LDX.b #$20
CODE_04B431:
	LDA.l $701FFE,x
	STA.l $702F6A,x
	DEX
	DEX
	BNE.b CODE_04B431
	LDX.b #$E0
	LDA.w #$0000
CODE_04B442:
	STA.l $702F8A,x
	DEX
	DEX
	BNE.b CODE_04B442
CODE_04B44A:
	LDX.b #$00
CODE_04B44C:
	LDA.l YI_Global_PaletteMirror[$7F].LowByte,x
	STA.l $70306A,x
	DEX
	DEX
	BNE.b CODE_04B44C
	LDX.b $12
	LDY.w $1060
	BEQ.b CODE_04B48A
	LDA.w #$0080
	STA.w $7A98,x
	PLA
	RTL

CODE_04B467:
	TYX
	LDA.l $70336C
	CMP.w #$0011
	BPL.b CODE_04B48B
	LDA.w #$2D6C
	STA.l $70336E
	LDA.w #$2F6C
	STA.l $703370
	LDX.b #FXCODE_08B4A9>>16
	LDA.w #FXCODE_08B4A9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_04B48A:
	RTS

CODE_04B48B:
	JSL.l CODE_03AD74
	BCC.b CODE_04B4A0
	LDY.w $7722,x
	STY.b $77,x
	JSL.l CODE_03AD74
	BCS.b CODE_04B4A1
	JSL.l CODE_03AEFD
CODE_04B4A0:
	RTS

CODE_04B4A1:
	LDA.l DATA_5FDFF4
	STA.l $702D76
	LDA.l DATA_5FDFF6
	STA.l $702D78
	LDY.w $7400,x
	STY.b $18,x
	LDX.b #$00
CODE_04B4B8:
	LDA.l $701FFE,x
	STA.l $702F6A,x
	LDA.l $702D6A,x
	STA.l $701FFE,x
	DEX
	DEX
	BNE.b CODE_04B4B8
	LDX.b $12
	LDY.b #$00
	STY.b $76,x
	LDA.w #$0009
	STA.w !RAM_YI_Global_PlayMusicLo
	PLA
	RTL

;---------------------------------------------------------------------------

DATA_04B4DA:
DATA_bigger_boo_state_ptr:                             ; 8-entry $76,x sub-state dispatch
	dw CODE_bigger_boo_state_00_spawn_appear                                ;  0: spawn / first-appear
	dw CODE_bigger_boo_state_01_growth_pulse                                ;  1: growth pulse
	dw CODE_bigger_boo_state_02_chase_yoshi                                ;  2: chase Yoshi (active)
	dw CODE_bigger_boo_state_03_facing_away_invincible                                ;  3: facing-away invincible
	dw CODE_bigger_boo_state_04_hit_recoil                                ;  4: hit recoil / shrinking flash
	dw CODE_bigger_boo_state_05_defeat_prep                                ;  5: defeat-animation prep
	dw CODE_bigger_boo_state_06_defeat_fall                                ;  6: defeat-fall
	dw CODE_bigger_boo_state_07_post_defeat                                ;  7: post-defeat / clear

;-------------------------------------------------------------------------
; Bigger Boo Main: per-frame state machine for the boss.  $76,x indexes the
; pointer table above (sub-states: spawn, growing, chasing, vulnerable,
; defeat-animation, fall, etc.); state $03 is the "facing-away invincible"
; check which skips the regular sprite update.  See the dispatch table just
; above for sub-state handler addresses.
; see also: ys_enmy*.asm (boss-class sprite handlers).
; Raidenthequick: main_bigger_boo.
;-------------------------------------------------------------------------
YI_NorSpr016_BiggerBoo_Main:
main_bigger_boo:                                  ; Raidenthequick: main_bigger_boo
;$04B4EA
	LDY.b $76,x
	CPY.b #$03
	BEQ.b CODE_04B4F8
	LDA.w $7040,x
	AND.w #$0001
	BEQ.b CODE_04B4FE
CODE_04B4F8:
	JSL.l CODE_03AF23
	BRA.b CODE_04B50B

CODE_04B4FE:
	JSR.w CODE_04B541
	JSR.w CODE_04B5A2
	JSL.l CODE_03AF23
	JSR.w CODE_04B712
CODE_04B50B:
	LDY.b $76,x
	TYA
	ASL
	TXY
	TAX
	JSR.w (DATA_bigger_boo_state_ptr,x)
	LDY.b $76,x
	CPY.b #$02
	BPL.b CODE_04B52C
	JSR.w CODE_04B905
	JSR.w CODE_04B9C5
	JSR.w CODE_04B645
	JSR.w CODE_04B6D4
	JSR.w CODE_04B808
	JSR.w CODE_04B8E4
CODE_04B52C:
	LDY.w $1066
	BEQ.b CODE_04B540
	LDA.w $7A36,x
	CMP.b $16,x
	BNE.b CODE_04B540
	LDY.w $7D36,x
	BMI.b CODE_04B540
	STZ.w $1066
CODE_04B540:
	RTL

CODE_04B541:
	LDY.w $74A2,x
	BMI.b CODE_04B54B
	LDA.w $7362,x
	BPL.b CODE_04B54C
CODE_04B54B:
	RTS

CODE_04B54C:
	JSL.l CODE_03AA52
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0020
	TAY
	LDA.w $7722,x
	PHA
	LDA.b $77,x
	AND.w #$00FF
	STA.w $7722,x
	JSL.l CODE_03AA60
	PLA
	STA.w $7722,x
	LDA.w $7680,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7682,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $105C
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$FFF0
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7400,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_08A248>>16
	LDA.w #FXCODE_08A248
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_04B5A1:
	RTS

CODE_04B5A2:
	LDA.w #DATA_04BD8D>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDY.b $18,x
	LDA.w DATA_04BD83,y
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7680,x
	CLC
	ADC.w #$0008
	STA.w $6000
	LDA.w $7682,x
	STA.w $6002
	STZ.w $6004
	STZ.w $6006
	STZ.w $600E
	LDA.w #$3516
	STA.w $600A
	LDA.w #$3372
	STA.w $600C
CODE_04B5DE:
	LDX.b #FXCODE_08E315>>16
	LDA.w #FXCODE_08E315
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	SEP.b #$30
	LDA.b #$18
	TSB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDX.b $12
	RTS

CODE_04B601:
	LDX.b #FXCODE_08D46A>>16
	LDA.w #FXCODE_08D46A
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	SEP.b #$10
	REP.b #$20
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr03D_LargeSeesaw
	BNE.b CODE_04B62B
	LDA.w $7A36,x
	BRA.b CODE_04B638

CODE_04B62B:
	LDY.w $1060
	BNE.b CODE_04B635
	LDA.w #$0314
	BRA.b CODE_04B638

CODE_04B635:
	LDA.w #$0512
CODE_04B638:
	STA.w !RAM_YI_Global_MainScreenLayers
	SEP.b #$20
	LDA.b #$18
	TSB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	RTS

CODE_04B645:
	LDA.w $7A36,x
	CMP.b $16,x
	BMI.b CODE_04B69A
	LDY.w $77C2,x
	TYA
	STA.b $00
	LDY.b $18,x
	CPY.b #$04
	BMI.b CODE_04B69B
	CPY.b #$08
	BEQ.b CODE_04B69A
	LDY.w $7D36,x
	BMI.b CODE_04B69A
	LDA.b $00
	CMP.w $7400,x
	BEQ.b CODE_04B66F
	LDY.b #$01
	STY.b $79,x
	STY.b $76,x
	RTS

CODE_04B66F:
	LDA.w $60C4
	CMP.w $7400,x
	BNE.b CODE_04B67B
	CMP.b $00
	BEQ.b CODE_04B694
CODE_04B67B:
	LDA.w $7AF8,x
	BNE.b CODE_04B69A
	LDY.b $76,x
	CPY.b #$01
	BEQ.b CODE_04B694
	LDY.b $18,x
	TYA
	AND.w #$0002
	TAY
	STY.b $18,x
	LDY.b #$F8
	STY.b $19,x
	RTS

CODE_04B694:
	LDA.w #$0020
	STA.w $7AF8,x
CODE_04B69A:
	RTS

CODE_04B69B:
	LDA.w $7400,x
	DEC
	EOR.w $7C16,x
	BPL.b CODE_04B6B9
	LDY.w $1066
	BNE.b CODE_04B6B9
	LDY.b #$F8
	STY.b $19,x
	LDA.w $60C4
	CMP.w $7400,x
	BNE.b CODE_04B6D3
	CMP.b $00
	BNE.b CODE_04B6D3
CODE_04B6B9:
	LDY.b $18,x
	TYA
	CLC
	ADC.w #$0004
	TAY
	STY.b $18,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w $7542,x
	LDY.b #$08
	STY.b $19,x
CODE_04B6D3:
	RTS

CODE_04B6D4:
	LDY.b $79,x
	BEQ.b CODE_04B711
	LDA.w $7AF6,x
	BNE.b CODE_04B711
	LDA.w #$0002
	STA.w $7AF6,x
	TYA
	CPY.b #$00
	BPL.b CODE_04B6EB
	ORA.w #$FF00
CODE_04B6EB:
	CLC
	ADC.w $105C
	CMP.w #$FFF4
	BNE.b CODE_04B705
	STA.w $105C
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDY.b #$FF
	STY.b $79,x
	RTS

CODE_04B705:
	CMP.w #$FFEC
	BNE.b CODE_04B70E
	LDY.b #$00
	STY.b $79,x
CODE_04B70E:
	STA.w $105C
CODE_04B711:
	RTS

CODE_04B712:
	LDA.b $16,x
	LDY.b $76,x
	CPY.b #$07
	BEQ.b CODE_04B745
	CPY.b #$04
	BPL.b CODE_04B72E
	CPY.b #$02
	BEQ.b CODE_04B748
	LDA.w $7A36,x
	CMP.b $16,x
	BPL.b CODE_04B72E
	LDA.w #$0002
	BRA.b CODE_04B742

CODE_04B72E:
	LDA.b $18,x
	BIT.w #$0008
	BEQ.b CODE_04B738
	LDA.w #$0004
CODE_04B738:
	AND.w #$0004
	LSR
	LSR
	CMP.w $7402,x
	BEQ.b CODE_04B7AD
CODE_04B742:
	STA.w $7402,x
CODE_04B745:
	LDA.w $7A36,x
CODE_04B748:
	SEC
	SBC.w #$01C0
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$FF90
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #$0100
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $04
	LDY.b $76,x
	CPY.b #$02
	BNE.b CODE_04B772
	LDA.w #$0100
CODE_04B772:
	STA.b $02
	LDA.w $7722,x
	STA.b $06
	LDY.b $77,x
	TYA
	STA.b $08
	LDY.w $7402,x
	DEY
	BEQ.b CODE_04B7A0
	BMI.b CODE_04B793
	LDY.b #$06
	JSR.w CODE_04B7CC
	LDA.b $08
CODE_04B78D:
	STA.b $06
	LDY.b #$08
	BRA.b CODE_04B7A2

CODE_04B793:
	LDY.b #$00
	JSR.w CODE_04B7CC
	LDA.b $08
	STA.b $06
	LDY.b #$02
	BRA.b CODE_04B7A2

CODE_04B7A0:
	LDY.b #$04
CODE_04B7A2:
	JSR.w CODE_04B7CC
	LDX.b $12
	INC.w $0CF9
	JSR.w CODE_04B541
CODE_04B7AD:
	RTS

DATA_04B7AE:
	dw FXDATA_550000+$4041,FXDATA_550000+$6041,FXDATA_550000+$4061,FXDATA_550000+$2001,FXDATA_560000+$6061

DATA_04B7B8:
	dw (FXDATA_550000+$4041)>>16,(FXDATA_550000+$6041)>>16,(FXDATA_550000+$4061)>>16,(FXDATA_550000+$2001)>>16,(FXDATA_560000+$6061)>>16

DATA_04B7C2:
	dw $0020,$0000,$0010,$0020,$0000

CODE_04B7CC:
	LDA.w DATA_04B7AE,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w DATA_04B7B8,y
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.b $02
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.b $04
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w DATA_04B7C2,y
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b $06
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	RTS

CODE_04B808:
	LDY.b $78,x
	BNE.b CODE_04B81E
	LDA.b $16,x
	CMP.w $7A36,x
	BNE.b CODE_04B81E
	LDY.b $19,x
	DEY
	BPL.b CODE_04B81E
	JSR.w CODE_04B81F
	JSR.w CODE_04B82E
CODE_04B81E:
	RTS

CODE_04B81F:
	LDY.w $7D36,x
	BPL.b CODE_04B82D
	LDY.w $1066
	BNE.b CODE_04B82D
	JSL.l CODE_03A858
CODE_04B82D:
	RTS

CODE_04B82E:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098F33>>16
	LDA.w #FXCODE_098F33
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_04B82D
	LDA.w $7BB6,x
	CLC
	ADC.w $7BB6,y
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7CD6,y
	SEC
	SBC.w $7CD6,x
	CMP.b $00
	BCS.b CODE_04B82D
	LDA.w $7BB8,x
	CLC
	ADC.w $7BB8,y
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7CD8,y
	SEC
	SBC.w $7CD8,x
	CMP.b $00
	BCS.b CODE_04B82D
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_04B82D
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BCS.b CODE_04B82D
	PHY
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	PLY
	LDA.w $7A36,x
	CMP.b $16,x
	BNE.b CODE_04B8E3
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	CMP.w #$0002
	BPL.b CODE_04B8E3
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w $7542,x
	INC.w $1066
	LDA.w #!Define_YI_SoundID78_HurtBoss
	JSL.l CODE_push_sound_queue
	LDA.b $16,x
	CLC
	ADC.w #$0018
	STA.w $105E
	CLC
	ADC.w #$0030
	CMP.w #$01C1
	BMI.b CODE_04B8DF
	STA.b $16,x
	LDY.b #$08
	STY.b $19,x
	JSL.l CODE_02A982
	STZ.w !RAM_YI_Level_NorSpr_BatGeneratorActiveFlagLo
	LDA.w #$0000
	STA.l $70336C
	LDA.w #$0002
	STA.w $7402,x
	INC.w $0B7B
	LDY.b #$02
	STY.b $76,x
	JMP.w CODE_04BB4E

CODE_04B8DF:
	STA.b $16,x
	INC.b $78,x
CODE_04B8E3:
	RTS

CODE_04B8E4:
	LDA.w #$0030
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $7BB6,x
	STA.w $7BB8,x
	RTS

CODE_04B905:
	LDY.b #$60
	LDA.b $78,x
	AND.w #$00FF
	BEQ.b CODE_04B917
	LDY.b #$64
	LDA.w $1060
	BEQ.b CODE_04B917
	LDY.b #$62
CODE_04B917:
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDY.b $19,x
	BEQ.b CODE_04B941
	TYA
	CPY.b #$00
	BPL.b CODE_04B926
	ORA.w #$FF00
CODE_04B926:
	STA.b $00
	LDY.b $78,x
	TYA
	CLC
	ADC.b $00
	BMI.b CODE_04B939
	CMP.w #$0100
	BMI.b CODE_04B942
	LDY.b #$FF
	BRA.b CODE_04B93B

CODE_04B939:
	LDY.b #$00
CODE_04B93B:
	STY.b $78,x
	LDY.b #$00
	STY.b $19,x
CODE_04B941:
	RTS

CODE_04B942:
	TAY
	STY.b $78,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $1060
	BNE.b CODE_04B970
	LDA.w #DATA_5FDFF8
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_5FDFF8>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0005
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0002
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08E167>>16
	LDA.w #FXCODE_08E167
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_04B9B2

CODE_04B970:
	LDA.w #DATA_5FE878
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_5FE878>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0061
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000E
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08E167>>16
	LDA.w #FXCODE_08E167
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #DATA_5FE894
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_5FE894>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0071
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000E
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08E167>>16
	LDA.w #FXCODE_08E167
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_04B9B2:
	LDX.b $12
	RTS

DATA_04B9B5:
	dw $7F26,$7FFF,$6F35,$0000,$7F26,$477F,$323F,$7FFF

CODE_04B9C5:
	LDY.w $1064
	BNE.b CODE_04B9F8
	LDA.w $7A36,x
	CMP.b $16,x
	BPL.b CODE_04B9F8
	LDY.w $0CE8
	BEQ.b CODE_04B9DD
	LDA.w $1060
	BNE.b CODE_04BA0B
	BRA.b CODE_04BA19

CODE_04B9DD:
	CMP.w $105E
	BMI.b CODE_04B9F9
	LDA.w #$0020
	STA.w $0CE8
	LDA.w $105E
	CLC
	ADC.w #$0018
	CMP.b $16,x
	BMI.b CODE_04B9F5
	LDA.b $16,x
CODE_04B9F5:
	STA.w $105E
CODE_04B9F8:
	RTS

CODE_04B9F9:
	CLC
	ADC.w #$0008
	STA.w $7A36,x
	CMP.b $16,x
	BMI.b CODE_04BA0B
	LDY.w $1060
	BEQ.b CODE_04BA19
	BRA.b CODE_04BA3B

CODE_04BA0B:
	LDA.w $7974
	LDY.w $1060
	BNE.b CODE_04BA36
	AND.w #$0002
	ASL
	ASL
	TAY
CODE_04BA19:
	LDA.w DATA_04B9B5,y
	STA.l YI_Global_PaletteMirror[$04].LowByte
	LDA.w DATA_04B9B5+$02,y
	STA.l YI_Global_PaletteMirror[$05].LowByte
	LDA.w DATA_04B9B5+$04,y
	STA.l YI_Global_PaletteMirror[$06].LowByte
	LDA.w DATA_04B9B5+$06,y
	STA.l YI_Global_PaletteMirror[$07].LowByte
	RTS

CODE_04BA36:
	AND.w #$0002
	BNE.b CODE_04BA54
CODE_04BA3B:
	LDX.b #$1C
CODE_04BA3D:
	LDA.l DATA_5FE83E,x
	STA.l YI_Global_PaletteMirror[$60].LowByte,x
	LDA.l DATA_5FE85A,x
	STA.l YI_Global_PaletteMirror[$70].LowByte,x
	DEX
	DEX
	BNE.b CODE_04BA3D
	LDX.b $12
	RTS

CODE_04BA54:
	LDX.b #$1C
CODE_04BA56:
	LDA.l DATA_5FA56E,x
	STA.l YI_Global_PaletteMirror[$60].LowByte,x
	STA.l YI_Global_PaletteMirror[$70].LowByte,x
	DEX
	DEX
	BNE.b CODE_04BA56
	LDX.b $12
	RTS

DATA_04BA69:
	dw $FF80,$0080

CODE_04BA6D:
CODE_bigger_boo_state_00_spawn_appear:
	TYX
	LDY.b $18,x
	CPY.b #$03
	BPL.b CODE_04BAA1
	LDA.w $7A96,x
	BNE.b CODE_04BAA1
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w $7A36,x
	CMP.b $16,x
	BNE.b CODE_04BAA1
	LDY.w $77C2,x
	LDA.w DATA_04BA69,y
	STA.w $75E0,x
	LDY.w $77C3,x
	LDA.w DATA_04BA69,y
	STA.w $75E2,x
	LDA.w #$0002
	STA.w $7540,x
	STA.w $7542,x
CODE_04BAA1:
	RTS

CODE_04BAA2:
CODE_bigger_boo_state_01_growth_pulse:
	TYX
	LDA.w $105C
	SEC
	SBC.w #$FFF1
	CMP.w #$0006
	BCS.b CODE_04BAB3
	LDY.b #$08
	BRA.b CODE_04BABB

CODE_04BAB3:
	LDA.w $7400,x
	CLC
	ADC.w #$0004
	TAY
CODE_04BABB:
	STY.b $18,x
	LDY.b $79,x
	BNE.b CODE_04BAC3
	STY.b $76,x
CODE_04BAC3:
	RTS

CODE_04BAC4:
CODE_bigger_boo_state_02_chase_yoshi:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_04BAF4
	LDA.w $7A36,x
	CMP.b $16,x
	BPL.b CODE_04BB1A
	CMP.w $105E
	BNE.b CODE_04BAE5
	CLC
	ADC.w #$0018
	STA.w $105E
	LDA.w #$0020
	STA.w $7A96,x
	BRA.b CODE_04BAF4

CODE_04BAE5:
	CLC
	ADC.w #$0008
	CMP.w #$0200
	BMI.b CODE_04BAF1
	LDA.w #$01FF
CODE_04BAF1:
	STA.w $7A36,x
CODE_04BAF4:
	JSR.w CODE_04BA0B
	LDA.l $70336C
	CMP.w #$0020
	BPL.b CODE_04BB19
	LDA.w #$2F6C
	STA.l $70336E
	LDA.w #$2D6C
	STA.l $703370
	LDX.b #FXCODE_08B4A9>>16
	LDA.w #FXCODE_08B4A9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_04BB19:
	RTS

CODE_04BB1A:
	LDA.w #$012E
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_04BB4D
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #!Define_YI_SoundID81_Unknown
	JSL.l CODE_push_sound_queue
	JSR.w CODE_04B601
	LDA.w #$0040
	STA.w $7A96,x
	LDA.w #$0050
	STA.w $61C6
	INC.b $76,x
CODE_04BB4D:
	RTS

CODE_04BB4E:
	LDX.b #$00
CODE_04BB50:
	LDA.l $702F6A,x
	STA.l $701FFE,x
	DEX
	DEX
	BNE.b CODE_04BB50
	LDX.b $12
	LDA.w #$0000
	STA.l $70336C
	LDY.b #$20
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	RTS

CODE_04BB6B:
CODE_bigger_boo_state_03_facing_away_invincible:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_04BB4D
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	STA.b $02
	JSL.l CODE_02E19C
	LDA.w #$0100
	STA.w $7A96,x
	PLA
	JML.l CODE_despawn_sprite_free_slot

CODE_04BB8A:
	RTS

DATA_04BB8B:
	dw $FF80,$0080

CODE_04BB8F:
CODE_bigger_boo_state_04_hit_recoil:
	TYX
	STZ.w $60C4
	LDA.w $7A98,x
	BNE.b CODE_04BBA1
	LDA.w #$0009
	STA.w !RAM_YI_Global_PlayMusicLo
	DEC.w $7A98,x
CODE_04BBA1:
	LDA.w $7C16,x
	SEC
	SBC.w #$FFA0
	BNE.b CODE_04BBB6
	INC.w $7540,x
	INC.w $1015
	STZ.w $7A98,x
	INC.b $76,x
	RTS

CODE_04BBB6:
	STA.w $0C1E
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CMP.w #$0BC0
	BEQ.b CODE_04BBDB
	SEC
	SBC.w #$0BC0
	STA.b $00
	LDA.w $7974
	AND.w #$0001
	PHP
	LDA.w !RAM_YI_Global_Layer1XPosLo
	PLP
	BNE.b CODE_04BBDB
	DEC
	LDY.b $01
	BPL.b CODE_04BBDB
	INC
	INC
CODE_04BBDB:
	STA.w $0C23
	LDA.w $7C18,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	EOR.w #$FFFF
	SEC
	ADC.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_04BBF3:
	LDA.w $7A96,x
	BNE.b CODE_04BC07
	LDA.w #$0020
	STA.w $7A96,x
	LDY.w $77C3,x
	LDA.w DATA_04BB8B,y
	STA.w $75E2,x
CODE_04BC07:
	RTS

CODE_04BC08:
CODE_bigger_boo_state_05_defeat_prep:                  ; halt motion, queue defeat-fall
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_04BC14
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
CODE_04BC14:
	LDA.w $1015
	BMI.b CODE_04BC3A
	CMP.w #$0002
	BMI.b CODE_04BBF3
	STZ.w $75E2,x
	LDA.w #$0002
	STA.w $7542,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0002
	CMP.w #$0004
	BCS.b CODE_04BC42
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	RTS

CODE_04BC3A:
	LDA.w #$0030
	STA.w $7A96,x
	INC.b $76,x
CODE_04BC42:
	RTS

CODE_04BC43:
CODE_bigger_boo_state_06_defeat_fall:                  ; flash + fade-down + cinema queue
	TYX
	LDA.w $7A96,x
	BNE.b CODE_04BC42
	LDA.l $70336C
	CMP.w #$0011
	BPL.b CODE_04BC6C
	LDA.w #$2D6C
	STA.l $70336E
	LDA.w #$2F6C
	STA.l $703370
	LDX.b #FXCODE_08B4A9>>16
	LDA.w #FXCODE_08B4A9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	RTS

CODE_04BC6C:
	LDX.b #$1C
CODE_04BC6E:
	LDA.l DATA_5FE83E,x
	STA.l $702E2C,x
	STA.l YI_Global_PaletteMirror[$60].LowByte,x
	LDA.l DATA_5FE85A,x
	STA.l $702E4C,x
	STA.l YI_Global_PaletteMirror[$70].LowByte,x
	DEX
	DEX
	BNE.b CODE_04BC6E
	LDY.b #!REGISTER_BG2HorizScrollOffset
	STY.w HDMA[$03].Destination
	INY
	STY.w HDMA[$04].Destination
	LDA.w #$0512
	STA.w !RAM_YI_Global_MainScreenLayers
	LDY.b #$60
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDX.b #$00
CODE_04BCA0:
	LDA.l $701FFE,x
	STA.l $702F6A,x
	LDA.l $702D6A,x
	STA.l $701FFE,x
	DEX
	DEX
	BNE.b CODE_04BCA0
	LDX.b $12
	LDA.w #$4002
	STA.w $7040,x
	LDA.w #$0007
	STA.w $74A2,x
	SEP.b #$20
	LDA.b #$22
	STA.w $7042,x
	STZ.w $7180,x
	REP.b #$20
	LDA.w #$0050
	STA.b $16,x
	LDA.w #$0040
	STA.w $7A36,x
	SEC
	SBC.w #$01C0
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$FF90
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #$0100
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $02
	STA.b $04
	LDA.w $7722,x
	STA.b $06
	LDY.b $77,x
	TYA
	STA.b $08
	LDY.b #$00
	JSR.w CODE_04B7CC
	LDA.b $08
	STA.b $06
	LDY.b #$02
	JSR.w CODE_04B7CC
	LDX.b $12
	INC.w $0CF9
	LDA.w #$FFEC
	STA.w $105C
	LDA.w $7182,x
	SEC
	SBC.w #$0004
	STA.w $7182,x
	LDA.w #$0002
	STA.b $18,x
	LDY.b #$00
	STY.b $78,x
	JSR.w CODE_04B601
	LDA.w #$0040
	STA.w $7A96,x
	STZ.w $1015
	INC.b $76,x
	RTS

CODE_04BD41:
CODE_bigger_boo_state_07_post_defeat:                  ; clear, spawn key/heart
	TYX
	LDA.w $7A96,x
	BNE.b CODE_04BD82
	LDA.w $7A36,x
	CLC
	ADC.w #$0002
	STA.w $7A36,x
	CMP.b $16,x
	BMI.b CODE_04BD82
	LDA.w #$0020
	STA.w $7A96,x
	LDA.b $16,x
	CLC
	ADC.w #$0010
	CMP.w #$0090
	BNE.b CODE_04BD80
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDY.b #$00
	STY.b $76,x
	STZ.w $7A96,x
	STZ.w $0C1E
	STZ.w $1064
	LDA.w #$01DE
	JSL.l CODE_039788
	LDA.w #$0080
CODE_04BD80:
	STA.b $16,x
CODE_04BD82:
	RTS

DATA_04BD83:
	dw DATA_04BD8D,DATA_04BF6F,DATA_04C060,DATA_04C151,DATA_04BE7E

DATA_04BD8D:
	db $78,$06,$10,$06,$1A,$06,$22,$06,$28,$06,$2E,$06,$32,$06,$36,$06
	db $3A,$06,$3C,$06,$40,$06,$42,$06,$46,$06,$48,$06,$4A,$06,$4E,$06
	db $50,$06,$52,$06,$54,$06,$56,$06,$58,$06,$5A,$06,$5A,$06,$5C,$06
	db $5E,$02,$76,$02,$7A,$02,$7C,$01,$7D,$01,$7D,$01,$7D,$01,$7D,$01
	db $7D,$01,$7D,$02,$7C,$02,$7C,$01,$7B,$02,$7A,$02,$7A,$02,$78,$02
	db $77,$02,$76,$03,$76,$03,$75,$04,$74,$04,$73,$05,$73,$06,$72,$06
	db $72,$06,$72,$06,$72,$06,$74,$06,$74,$06,$74,$06,$74,$06,$74,$06
	db $74,$06,$74,$06,$74,$06,$74,$05,$75,$05,$75,$05,$75,$05,$75,$05
	db $75,$05,$76,$05,$76,$05,$76,$05,$76,$04,$77,$04,$77,$04,$76,$03
	db $77,$03,$77,$03,$78,$03,$78,$02,$78,$01,$79,$01,$79,$01,$7A,$00
	db $7A,$FF,$7B,$FF,$7C,$FE,$7C,$FE,$7C,$FE,$7C,$FD,$7B,$FE,$7A,$FD
	db $79,$FD,$77,$FE,$76,$FD,$75,$FD,$73,$FE,$72,$FD,$71,$FD,$6F,$FD
	db $6D,$FE,$6C,$FE,$6A,$FE,$68,$FE,$66,$FE,$64,$FE,$62,$FE,$60,$FE
	db $5E,$FE,$5B,$FE,$59,$FE,$56,$FE,$53,$FE,$51,$FE,$4D,$FF,$4A,$FF
	db $46,$FF,$42,$FF,$3E,$FF,$3A,$FF,$35,$FF,$2F,$FF,$27,$FF,$1F,$FF
	db $13

DATA_04BE7E:
	db $78,$00,$10,$00,$1A,$00,$22,$00,$28,$00,$2E,$00,$32,$00,$36,$00
	db $3A,$00,$3C,$00,$40,$00,$42,$00,$46,$00,$48,$00,$4A,$00,$4E,$00
	db $50,$00,$52,$00,$54,$00,$56,$00,$58,$00,$58,$00,$5A,$00,$5C,$00
	db $5E,$00,$5E,$00,$60,$00,$62,$00,$62,$00,$64,$00,$66,$00,$66,$00
	db $68,$00,$68,$00,$6A,$00,$6A,$00,$6C,$00,$6C,$00,$6C,$00,$6E,$00
	db $6E,$00,$6E,$00,$70,$00,$70,$00,$70,$00,$70,$00,$72,$00,$72,$00
	db $72,$00,$72,$00,$72,$00,$74,$00,$74,$00,$74,$00,$74,$00,$74,$00
	db $74,$00,$74,$00,$74,$00,$74,$00,$74,$00,$74,$00,$74,$00,$74,$00
	db $74,$00,$74,$00,$74,$00,$74,$00,$74,$00,$74,$00,$74,$00,$72,$00
	db $72,$00,$72,$00,$72,$00,$72,$00,$70,$00,$70,$00,$70,$00,$70,$00
	db $6E,$00,$6E,$00,$6E,$00,$6C,$00,$6C,$00,$6C,$00,$6A,$00,$6A,$00
	db $68,$00,$68,$00,$66,$00,$66,$00,$64,$00,$62,$00,$62,$00,$60,$00
	db $5E,$00,$5E,$00,$5C,$00,$5A,$00,$58,$00,$58,$00,$56,$00,$54,$00
	db $52,$00,$50,$00,$4E,$00,$4A,$00,$48,$00,$46,$00,$42,$00,$40,$00
	db $3C,$00,$3A,$00,$36,$00,$32,$00,$2E,$00,$28,$00,$22,$00,$1A,$00
	db $10

DATA_04BF6F:
	db $78,$FA,$10,$FA,$1A,$FA,$22,$FA,$28,$FA,$2E,$FA,$32,$FA,$36,$FA
	db $3A,$FA,$3C,$FA,$40,$FA,$42,$FA,$46,$FA,$48,$FA,$4A,$FA,$4E,$FA
	db $50,$FA,$52,$FA,$54,$FA,$56,$FA,$58,$FA,$5A,$FA,$5A,$FA,$5C,$FA
	db $5E,$FE,$76,$FE,$7A,$FE,$7C,$FE,$7D,$FE,$7D,$FE,$7D,$FE,$7D,$FE
	db $7D,$FE,$7D,$FE,$7C,$FE,$7C,$FE,$7B,$FE,$7A,$FE,$7A,$FE,$78,$FD
	db $77,$FE,$76,$FD,$76,$FC,$75,$FC,$74,$FB,$73,$FA,$73,$FA,$72,$FA
	db $72,$FA,$72,$FA,$72,$FA,$74,$FA,$74,$FA,$74,$FA,$74,$FA,$74,$FA
	db $74,$FA,$74,$FA,$74,$FA,$74,$FA,$75,$FA,$75,$FA,$75,$FA,$75,$FA
	db $75,$FB,$76,$FB,$76,$FB,$76,$FB,$76,$FB,$77,$FB,$77,$FC,$76,$FC
	db $77,$FC,$77,$FD,$78,$FD,$78,$FE,$78,$FE,$79,$FE,$79,$FF,$7A,$00
	db $7A,$00,$7B,$01,$7C,$02,$7C,$02,$7C,$02,$7C,$02,$7B,$02,$7A,$02
	db $79,$02,$77,$02,$76,$02,$75,$02,$73,$02,$72,$02,$71,$02,$6F,$02
	db $6D,$02,$6C,$02,$6A,$02,$68,$02,$66,$02,$64,$02,$62,$02,$60,$02
	db $5E,$01,$5B,$01,$59,$02,$56,$01,$53,$01,$51,$01,$4D,$01,$4A,$01
	db $46,$01,$42,$01,$3E,$01,$3A,$00,$35,$00,$2F,$00,$27,$00,$1F,$00
	db $13

DATA_04C060:
	db $78,$06,$10,$06,$1A,$06,$22,$06,$28,$06,$2E,$06,$32,$06,$36,$06
	db $3A,$06,$3C,$06,$40,$06,$42,$06,$46,$06,$48,$06,$4A,$06,$4E,$06
	db $50,$06,$52,$06,$54,$06,$56,$06,$58,$06,$58,$06,$5A,$06,$5C,$06
	db $5E,$06,$5E,$06,$60,$06,$62,$06,$62,$06,$64,$06,$66,$06,$66,$06
	db $68,$06,$68,$06,$6A,$06,$6A,$06,$6C,$06,$6C,$06,$6C,$06,$6E,$06
	db $6E,$06,$6E,$06,$70,$06,$70,$06,$70,$06,$70,$06,$72,$06,$72,$06
	db $72,$06,$72,$06,$72,$06,$74,$06,$74,$06,$74,$06,$74,$06,$74,$06
	db $74,$06,$74,$06,$74,$06,$74,$05,$75,$05,$75,$05,$75,$05,$75,$05
	db $75,$05,$76,$05,$76,$05,$76,$05,$76,$04,$77,$04,$77,$04,$76,$03
	db $77,$03,$77,$03,$78,$03,$78,$02,$78,$01,$79,$01,$79,$01,$7A,$00
	db $7A,$FF,$7B,$FF,$7C,$FE,$7C,$FE,$7C,$FE,$7C,$FD,$7B,$FE,$7A,$FD
	db $79,$FD,$77,$FE,$76,$FD,$75,$FD,$73,$FE,$72,$FD,$71,$FD,$6F,$FD
	db $6D,$FE,$6C,$FE,$6A,$FE,$68,$FE,$66,$FE,$64,$FE,$62,$FE,$60,$FE
	db $5E,$FE,$5B,$FE,$59,$FE,$56,$FE,$53,$FE,$51,$FE,$4D,$FF,$4A,$FF
	db $46,$FF,$42,$FF,$3E,$FF,$3A,$FF,$35,$FF,$2F,$FF,$27,$FF,$1F,$FF
	db $13

DATA_04C151:
	db $78,$FA,$10,$FA,$1A,$FA,$22,$FA,$28,$FA,$2E,$FA,$32,$FA,$36,$FA
	db $3A,$FA,$3C,$FA,$40,$FA,$42,$FA,$46,$FA,$48,$FA,$4A,$FA,$4E,$FA
	db $50,$FA,$52,$FA,$54,$FA,$56,$FA,$58,$FA,$58,$FA,$5A,$FA,$5C,$FA
	db $5E,$FA,$5E,$FA,$60,$FA,$62,$FA,$62,$FA,$64,$FA,$66,$FA,$66,$FA
	db $68,$FA,$68,$FA,$6A,$FA,$6A,$FA,$6C,$FA,$6C,$FA,$6C,$FA,$6E,$FA
	db $6E,$FA,$6E,$FA,$70,$FA,$70,$FA,$70,$FA,$70,$FA,$72,$FA,$72,$FA
	db $72,$FA,$72,$FA,$72,$FA,$74,$FA,$74,$FA,$74,$FA,$74,$FA,$74,$FA
	db $74,$FA,$74,$FA,$74,$FA,$74,$FA,$75,$FA,$75,$FA,$75,$FA,$75,$FA
	db $75,$FB,$76,$FB,$76,$FB,$76,$FB,$76,$FB,$77,$FB,$77,$FC,$76,$FC
	db $77,$FC,$77,$FD,$78,$FD,$78,$FE,$78,$FE,$79,$FE,$79,$FF,$7A,$00
	db $7A,$00,$7B,$01,$7C,$02,$7C,$02,$7C,$02,$7C,$02,$7B,$02,$7A,$02
	db $79,$02,$77,$02,$76,$02,$75,$02,$73,$02,$72,$02,$71,$02,$6F,$02
	db $6D,$02,$6C,$02,$6A,$02,$68,$02,$66,$02,$64,$02,$62,$02,$60,$02
	db $5E,$01,$5B,$01,$59,$02,$56,$01,$53,$01,$51,$01,$4D,$01,$4A,$01
	db $46,$01,$42,$01,$3E,$01,$3A,$00,$35,$00,$2F,$00,$27,$00,$1F,$00
	db $13

;---------------------------------------------------------------------------

DATA_04C242:
	db $80,$7F

YI_NorSpr15E_4PinkRotatingPlatformsWithShyGuys_Init:
init_four_rotating_platforms_with_shyguys:        ; spawn 4 platforms + 4 shyguy passengers
;$04C244
	LDA.w $7974
	STA.w $0FF9
	LDY.b #$F0
	STY.b $79,x
	LDY.b #$00
	JSR.w CODE_04C433
	LDA.w #$0004
	STA.b $00
CODE_04C258:
	LDA.b $00
	ASL
	TAY
	LDA.w $0FF9,y
	STA.b $04
	LDA.w $1001,y
	STA.b $06
	LDA.w #$001E
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_init_four_auto_rotating_pink_platforms
	LDA.b $04
	STA.w $7A36,y
	SEC
	SBC.w #$0008
	STA.w $70E2,y
	LDA.b $06
	STA.w $7A38,y
	SEC
	SBC.w #$0010
	STA.w $7182,y
	LDA.b $00
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w $0FF9
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	DEC.b $00
	BNE.b CODE_04C258
YI_NorSpr064_4AutoRotatingPinkPlatforms_Init:
CODE_init_four_auto_rotating_pink_platforms:           ; standalone 4-platform rotator (no riders)
CODE_04C2A7:
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	LSR
	TAY
	LDA.w DATA_04C242,y
	TAY
	STY.b $19,x
YI_NorSpr055_4GreenRotatingPlatforms_Init:
YI_NorSpr056_4PinkRotatingPlatforms_Init:
init_four_rotating_platforms:                     ; manual-rotation (Yoshi push to turn)
	STZ.w $7400,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $7863,x
	REP.b #$20
	LDA.w #$8000
	STA.w $75E0,x
	XBA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.b #$F0
	STY.b $79,x
	STZ.w $7BB6,x
	STZ.w $7BB8,x
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w $7182,x
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CMP.w #$0003
	BEQ.b CODE_04C2EF
	CMP.w #$000D
	BNE.b CODE_04C2F5
CODE_04C2EF:
	INC.w $7B58,x
	INC.w $7B58,x
CODE_04C2F5:
	RTL

;---------------------------------------------------------------------------

YI_NorSpr055_4GreenRotatingPlatforms_Main:
YI_NorSpr056_4PinkRotatingPlatforms_Main:
YI_NorSpr064_4AutoRotatingPinkPlatforms_Main:
YI_NorSpr15E_4PinkRotatingPlatformsWithShyGuys_Main:
main_four_rotating_platforms:                     ; common Main for all 4 variants
;$04C2F6
	STZ.b $04
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr056_4PinkRotatingPlatforms
	BEQ.b CODE_04C30D
	CMP.w #!Define_YI_NorSpr064_4AutoRotatingPinkPlatforms
	BNE.b CODE_04C311
	LDA.w $7182,x
	AND.w #$0010
	BNE.b CODE_04C311
CODE_04C30D:
	INC.b $04
	INC.b $04
CODE_04C311:
	JSR.w CODE_04C332
	JSL.l CODE_03AF23
	LDA.w $7362,x
	BMI.b CODE_04C331
	LDY.w $74A2,x
	BMI.b CODE_04C331
	JSR.w CODE_04C530
	JSR.w CODE_04C776
	JSR.w CODE_04C574
	JSR.w CODE_04C66A
	JSR.w CODE_04C7F4
CODE_04C331:
	RTL

CODE_04C332:
	LDA.w $7362,x
	BMI.b CODE_04C33C
	LDY.w $74A2,x
	BPL.b CODE_04C33D
CODE_04C33C:
	RTS

CODE_04C33D:
	LDY.b $04
	JSR.w CODE_04C433
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	STA.b $0C
	LDA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.b $0E
	LDA.w $7680,x
	CLC
	ADC.w #$0008
	STA.b $08
	LDA.w $7682,x
	STA.b $0A
	REP.b #$10
	LDY.w $7362,x
	LDA.b $08
	CLC
	ADC.w !REGISTER_SuperFX_R8_MERGEYPosLo
	SEC
	SBC.b $00
	STA.w $6000,y
	CLC
	ADC.b $02
	STA.w $6008,y
	LDA.b $08
	CLC
	ADC.w !REGISTER_SuperFX_R7_MERGEXPosLo
	SEC
	SBC.b $00
	STA.w $6010,y
	CLC
	ADC.b $02
	STA.w $6018,y
	LDA.b $08
	SEC
	SBC.w !REGISTER_SuperFX_R8_MERGEYPosLo
	SEC
	SBC.b $00
	STA.w $6020,y
	CLC
	ADC.b $02
	STA.w $6028,y
	LDA.b $08
	SEC
	SBC.w !REGISTER_SuperFX_R7_MERGEXPosLo
	SEC
	SBC.b $00
	STA.w $6030,y
	CLC
	ADC.b $02
	STA.w $6038,y
	LDA.b $0A
	SEC
	SBC.w !REGISTER_SuperFX_R7_MERGEXPosLo
	STA.w $6002,y
	STA.w $600A,y
	LDA.b $0A
	CLC
	ADC.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w $6012,y
	STA.w $601A,y
	LDA.b $0A
	CLC
	ADC.w !REGISTER_SuperFX_R7_MERGEXPosLo
	STA.w $6022,y
	STA.w $602A,y
	LDA.b $0A
	SEC
	SBC.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w $6032,y
	STA.w $603A,y
	JSR.w CODE_04C4C7
	LDA.b $04
	BEQ.b CODE_04C40B
	LDA.w $6004,y
	AND.w #$F1FF
	ORA.w #$0800
	STA.w $6004,y
	STA.w $6014,y
	STA.w $6024,y
	STA.w $6034,y
	LDA.w $600C,y
	AND.w #$F1FF
	ORA.w #$0800
	STA.w $600C,y
	STA.w $601C,y
	STA.w $602C,y
	STA.w $603C,y
	SEP.b #$10
	RTS

CODE_04C40B:
	LDA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	CLC
	ADC.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	CLC
	ADC.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	TYA
	CLC
	ADC.w #$0020
	TAY
	JSR.w CODE_04C4C7
	SEP.b #$10
	RTS

;---------------------------------------------------------------------------

DATA_04C42B:
	db $10,$10,$0C,$08

DATA_04C42F:
	dw $0028,$0018

CODE_04C433:
	LDA.w DATA_04C42B,y
	AND.w #$00FF
	STA.b $00
	LDA.w DATA_04C42B+$01,y
	AND.w #$00FF
	STA.b $02
	LDA.w DATA_04C42F,y
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0003
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	CPY.b #$00
	BEQ.b CODE_04C456
	DEC.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
CODE_04C456:
	LDY.b $79,x
	TYA
	ASL
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_0B85D0>>16
	LDA.w #FXCODE_0B85D0
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr15E_4PinkRotatingPlatformsWithShyGuys
	BNE.b CODE_04C4C6
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.b $06
	LDA.w $7182,x
	STA.b $08
	LDA.b $06
	CLC
	ADC.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w $0FFB
	LDA.b $06
	CLC
	ADC.w !REGISTER_SuperFX_R7_MERGEXPosLo
	STA.w $0FFD
	LDA.b $06
	SEC
	SBC.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w $0FFF
	LDA.b $06
	SEC
	SBC.w !REGISTER_SuperFX_R7_MERGEXPosLo
	STA.w $1001
	LDA.b $08
	SEC
	SBC.w !REGISTER_SuperFX_R7_MERGEXPosLo
	STA.w $1003
	LDA.b $08
	CLC
	ADC.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w $1005
	LDA.b $08
	CLC
	ADC.w !REGISTER_SuperFX_R7_MERGEXPosLo
	STA.w $1007
	LDA.b $08
	SEC
	SBC.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w $1009
CODE_04C4C6:
	RTS

;---------------------------------------------------------------------------

CODE_04C4C7:
	LDA.b $08
	CLC
	ADC.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	SEC
	SBC.w #$0004
	STA.w $6048,y
	LDA.b $08
	CLC
	ADC.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	SEC
	SBC.w #$0004
	STA.w $6050,y
	LDA.b $08
	SEC
	SBC.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	SEC
	SBC.w #$0004
	STA.w $6058,y
	LDA.b $08
	SEC
	SBC.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	SEC
	SBC.w #$0004
	STA.w $6060,y
	LDA.b $0A
	SEC
	SBC.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	CLC
	ADC.w #$0004
	STA.w $604A,y
	LDA.b $0A
	CLC
	ADC.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	CLC
	ADC.w #$0004
	STA.w $6052,y
	LDA.b $0A
	CLC
	ADC.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	CLC
	ADC.w #$0004
	STA.w $605A,y
	LDA.b $0A
	SEC
	SBC.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	CLC
	ADC.w #$0004
	STA.w $6062,y
	RTS

CODE_04C530:
	LDA.w $75E0,x
	CMP.w #$8000
	BNE.b CODE_04C56B
	STZ.w $75E0,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr064_4AutoRotatingPinkPlatforms
	BEQ.b CODE_04C562
	CMP.w #!Define_YI_NorSpr15E_4PinkRotatingPlatformsWithShyGuys
	BEQ.b CODE_04C562
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.l $700006,x
	SEP.b #$10
	LDX.b $12
	AND.w #$FF00
	CMP.w #$8700
	BNE.b CODE_04C562
	INC.b $77,x
	BRA.b CODE_04C56B

CODE_04C562:
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
CODE_04C56B:
	RTS

DATA_04C56C:
	dw $0010,$000C

DATA_04C570:
	db !Define_YI_SoundID6A_ManuallyRotatePlatform1,!Define_YI_SoundID6B_ManuallyRotatePlatform2
	db !Define_YI_SoundID6C_ManuallyRotatePlatform3,!Define_YI_SoundID6B_ManuallyRotatePlatform2

CODE_04C574:
	LDY.b $77,x
	BNE.b CODE_04C5B9
	LDY.b $04
	LDA.w DATA_04C56C,y
	STA.w $6028
	LDA.w $7CD6,x
	STA.w $602A
	LDA.w $7CD8,x
	STA.w $602C
	LDA.b $78,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $19,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $0C
	STA.w $603C
	LDA.b $0E
	STA.w $603E
	LDX.b #FXCODE_0AE864>>16
	LDA.w #FXCODE_0AE864
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $7860,x
	BEQ.b CODE_04C60D
	LDY.b #$00
	STY.b $19,x
	BRA.b CODE_04C60D

CODE_04C5B9:
	LDA.b $16,x
	SEC
	SBC.w #$4000
	EOR.b $18,x
	BMI.b CODE_04C5E5
	LDA.b $16,x
	CLC
	ADC.w #$8000
	STA.b $16,x
	LDA.w $75E0,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CPY.b #$02
	BPL.b CODE_04C5DE
	CLC
	ADC.w #$0100
	AND.w #$01FE
	BRA.b CODE_04C5E2

CODE_04C5DE:
	EOR.w #$FFFF
	INC
CODE_04C5E2:
	STA.w $75E0,x
CODE_04C5E5:
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	STA.b $02
	JSL.l CODE_04A9FD
	LDA.w $70E2,x
	SEC
	SBC.b $00
	CLC
	ADC.w $72C0,x
	STA.w $72C0,x
	LDA.w $7182,x
	SEC
	SBC.b $02
	CLC
	ADC.w $72C2,x
	STA.w $72C2,x
CODE_04C60D:
	LDY.b $19,x
	TYA
	CPY.b #$00
	BPL.b CODE_04C617
	ORA.w #$FF00
CODE_04C617:
	STA.b $00
	ASL
	CLC
	ADC.b $78,x
	STA.b $78,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr064_4AutoRotatingPinkPlatforms
	BEQ.b CODE_04C65B
	CMP.w #!Define_YI_NorSpr15E_4PinkRotatingPlatformsWithShyGuys
	BEQ.b CODE_04C65B
	LDA.b $00
	BPL.b CODE_04C634
	EOR.w #$FFFF
	INC
CODE_04C634:
	CLC
	ADC.w $7BB6,x
	CMP.w #$0600
	BMI.b CODE_04C657
	PHA
	LDA.w $7BB8,x
	INC
	AND.w #$0003
	STA.w $7BB8,x
	TAY
	LDA.w DATA_04C570,y
	TAY
	TYA
	JSL.l CODE_push_sound_queue
	PLA
	SEC
	SBC.w #$0600
CODE_04C657:
	STA.w $7BB6,x
	RTS

CODE_04C65B:
	LDY.b $19,x
	BEQ.b CODE_04C665
	LDA.w #$00E0
	STA.w $0051
CODE_04C665:
	RTS

DATA_04C666:
	dw $0014,$0010

CODE_04C66A:
	LDY.b $04
	LDA.w DATA_04C666,y
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	ASL
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $0C
	EOR.w #$FFFF
	INC
	STA.b $08
	LDA.b $0E
	EOR.w #$FFFF
	INC
	STA.b $0A
	STZ.b $06
	LDA.b $0C
	STA.b $00
	LDA.b $0E
	JSR.w CODE_04C6B3
	INC.b $06
	LDA.b $0E
	STA.b $00
	LDA.b $08
	JSR.w CODE_04C6B3
	INC.b $06
	LDA.b $08
	STA.b $00
	LDA.b $0A
	JSR.w CODE_04C6B3
	INC.b $06
	LDA.b $0A
	STA.b $00
	LDA.b $0C
	JSR.w CODE_04C6B3
	RTS

CODE_04C6B3:
	STA.b $02
	CPX.w $61B6
	BEQ.b CODE_04C6F9
	LDY.w $60AB
	BMI.b CODE_04C6F8
	LDA.w $7C16,x
	CLC
	ADC.b $00
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CMP.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BCS.b CODE_04C6F8
	LDA.w $7C18,x
	CLC
	ADC.b $02
	SEC
	SBC.w $6122
	SEC
	SBC.w #$0008
	CMP.w #$FFF6
	BCC.b CODE_04C6F8
	LDY.w $61B6
	BNE.b CODE_04C6F8
	STX.w $61B6
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDY.b $06
	STY.b $18,x
	JMP.w CODE_04C766

CODE_04C6F8:
	RTS

CODE_04C6F9:
	LDY.b $18,x
	CPY.b $06
	BNE.b CODE_04C6F8
	LDY.w $60AB
	BMI.b CODE_04C758
	LDY.w $0D94
	BNE.b CODE_04C758
	LDY.b $76,x
	TYA
	CPY.b #$00
	BPL.b CODE_04C713
	ORA.w #$FF00
CODE_04C713:
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $00
	SEC
	SBC.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	CLC
	ADC.w $72C0,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	CLC
	ADC.w $7C16,x
	STA.w $7C16,x
	LDA.w $7C18,x
	CLC
	ADC.b $02
	SEC
	SBC.w $6122
	SEC
	SBC.w #$0008
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $7C16,x
	CLC
	ADC.b $00
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CMP.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BCC.b CODE_04C766
CODE_04C758:
	CPX.w $61B6
	BNE.b CODE_04C760
	STZ.w $61B6
CODE_04C760:
	LDY.b #$00
	STY.b $18,x
	PLA
	RTS

CODE_04C766:
	INC.w $61B4
	LDY.b $00
	STY.b $76,x
	STZ.w $60AA
	PLA
CODE_04C771:
	RTS

DATA_04C772:
	db $00,$40,$80,$C0

CODE_04C776:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr064_4AutoRotatingPinkPlatforms
	BEQ.b CODE_04C771
	CMP.w #!Define_YI_NorSpr15E_4PinkRotatingPlatformsWithShyGuys
	BEQ.b CODE_04C771
	CPX.w $61B6
	BNE.b CODE_04C7D1
	LDY.b $18,x
	LDA.w DATA_04C772,y
	AND.w #$00FF
	CLC
	ADC.b $79,x
	AND.w #$00FF
	ASL
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$FFF0
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	INC
	CMP.w #$0002
	BCC.b CODE_04C7D1
	LDY.b $19,x
	TYA
	CPY.b #$00
	BPL.b CODE_04C7BE
	ORA.w #$FF00
CODE_04C7BE:
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	TAY
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCC.b CODE_04C7CE
	LDY.b $19,x
CODE_04C7CE:
	STY.b $19,x
	RTS

CODE_04C7D1:
	LDY.b $19,x
	TYA
	CPY.b #$00
	BPL.b CODE_04C7E1
	ORA.w #$FF00
	CLC
	ADC.w #$0002
	BRA.b CODE_04C7E5

CODE_04C7E1:
	SEC
	SBC.w #$0002
CODE_04C7E5:
	TAY
	CLC
	ADC.w #$0002
	CMP.w #$0004
	BCS.b CODE_04C7F1
	LDY.b #$00
CODE_04C7F1:
	STY.b $19,x
	RTS

CODE_04C7F4:
	SEP.b #$20
	LDA.b $19,x
	PHP
	BPL.b CODE_04C7FE
	EOR.b #$FF
	INC
CODE_04C7FE:
	TAY
	REP.b #$20
	TYA
	STA.w $7A37,x
	SEP.b #$20
	STZ.w $7A39,x
	PLP
	BPL.b CODE_04C810
	DEC.w $7A39,x
CODE_04C810:
	REP.b #$20
	LDY.b $77,x
	BNE.b CODE_04C832
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr064_4AutoRotatingPinkPlatforms
	BEQ.b CODE_04C832
	CMP.w #!Define_YI_NorSpr15E_4PinkRotatingPlatformsWithShyGuys
	BEQ.b CODE_04C832
	LDA.w $7A37,x
	LDY.w $7A39,x
	BNE.b CODE_04C82F
	EOR.w #$FFFF
	INC
CODE_04C82F:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_04C832:
	RTS

;---------------------------------------------------------------------------

CODE_04C833:
	LDY.b $18,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_04C84D
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr15E_4PinkRotatingPlatformsWithShyGuys
	BNE.b CODE_04C84D
	LDA.w $0FF9
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_04C853
CODE_04C84D:
	PLY
	PLA
	JML.l CODE_03A31E

CODE_04C853:
	LDY.b $78,x
	LDA.w $0FF9,y
	SEC
	SBC.w $7A36,x
	CLC
	ADC.w $70E2,x
	STA.w $70E2,x
	LDA.w $1001,y
	SEC
	SBC.w $7A38,x
	CLC
	ADC.w $7182,x
	STA.w $7182,x
	LDA.w $1001,y
	SEC
	SBC.w #$0010
	CMP.w $7182,x
	BPL.b CODE_04C886
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
CODE_04C886:
	LDA.w $0FF9,y
	STA.w $7A36,x
	LDA.w $1001,y
	STA.w $7A38,x
	LDY.w $77C2,x
	TYA
	STA.w $7400,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr100_Bubbled1up_Init:
init_bubbled_1up:                                 ; 1-up trapped in a bubble (no-op spawn)
;$04C89A
	RTL

;---------------------------------------------------------------------------

YI_NorSpr100_Bubbled1up_Main:
main_bubbled_1up:                                 ; bobs; pop on egg/sprite hit -> award 1-up
;$04C89B
	STZ.w $7400,x
	LDY.b $18,x
	BEQ.b CODE_04C8B8
	LDA.w $7362,x
	BMI.b CODE_04C8B8
	REP.b #$10
	TAY
	LDA.w $6024,y
	AND.w #$FF00
	ORA.w #$004A
	STA.w $6024,y
	SEP.b #$10
CODE_04C8B8:
	JSL.l CODE_03AF23
	LDY.b $76,x
	BNE.b CODE_04C8C3
	INC.b $76,x
	RTL

CODE_04C8C3:
	LDY.w $7D36,x
	BMI.b CODE_04C8DD
	BEQ.b CODE_04C92D
	LDA.w $6EFF,y
	CMP.w #$0010
	BNE.b CODE_04C92D
	LDA.w $7D37,y
	BEQ.b CODE_04C92D
	DEY
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
CODE_04C8DD:
	LDA.w $7CD6,x
	SEC
	SBC.w #$0008
	STA.w $0000
	LDA.w $7CD8,x
	SEC
	SBC.w #$0008
	STA.w $0002
	LDY.b $18,x
	BNE.b CODE_04C8FB
	JSL.l CODE_03A4A2
	BRA.b CODE_04C8FF

CODE_04C8FB:
	JSL.l CODE_spawn_3up_score
CODE_04C8FF:
	LDA.w #!Define_YI_AmbSpr1E4
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$000C
	STA.w $73C2,y
	LDA.w #$0008
	STA.w $7782,y
	LDA.b $78,x
	STA.b $04
	LDA.w $7A36,x
	JSL.l CODE_03D3F3
	JML.l CODE_despawn_sprite_free_slot

CODE_04C92D:
	LDA.w $75E2,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0002
	CMP.w #$0004
	BCS.b CODE_04C947
	LDA.w $75E2,x
	EOR.w #$FFFF
	INC
	STA.w $75E2,x
CODE_04C947:
	LDA.w $7A98,x
	BNE.b CODE_04C95C
	LDA.w #$0008
	STA.w $7A98,x
	LDA.w $7402,x
	INC
	AND.w #$0003
	STA.w $7402,x
CODE_04C95C:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_04C967
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_04C967:
	RTL

;---------------------------------------------------------------------------

YI_NorSpr115_Coin_Init:
CODE_init_coin:                                        ; standard coin spawn (seed timers)
CODE_04C968:
	LDA.w #$0100
	STA.w $7A96,x
	LDA.w #$0140
	STA.w $7A98,x
	LDA.w #$0010
	STA.w $7AF6,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr115_Coin_Main:
main_coin:                                        ; coin: collect, sparkle, bounce-on-hit
;$04C97B
	JSL.l CODE_03AF23
	LDA.w $7974
	LSR
	LSR
	LSR
	AND.w #$0003
	STA.w $7402,x
	LDY.b $76,x
	BEQ.b CODE_04C9BF
	LDA.w $7860,x
	LSR
	BCC.b CODE_04C9BE
	JSL.l CODE_init_coin
	LDA.b $10
	AND.w #$01FF
	CLC
	ADC.w #$FF80
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $10
	XBA
	AND.w #$01FF
	EOR.w #$FFFF
	INC
	CLC
	ADC.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0002
	STA.w $74A2,x
	STZ.b $76,x
CODE_04C9BE:
	RTL

CODE_04C9BF:
	LDA.w $7860,x
	LSR
	BCC.b CODE_04C9DB
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FD80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
CODE_04C9DB:
	LDA.w $7AF6,x
	BNE.b CODE_04CA09
	LDY.w $7D36,x
	BEQ.b CODE_04CA09
	BMI.b CODE_04CA01
	LDA.w $6EFF,y
	CMP.w #$0010
	BNE.b CODE_04CA09
	LDA.w $7D37,y
	BEQ.b CODE_04CA09
	LDA.w $735F,y
	CMP.w #$0022
	BMI.b CODE_04CA09
	CMP.w #$002C
	BPL.b CODE_04CA09
CODE_04CA01:
	JSL.l CODE_04CA3A
	JML.l CODE_despawn_sprite_free_slot

CODE_04CA09:
	LDA.w $7A96,x
	BNE.b CODE_04CA26
	LDA.w $7A98,x
	BNE.b CODE_04CA1B
	LDY.b $78,x
	BNE.b CODE_04CA01
	JML.l CODE_03A31E

CODE_04CA1B:
	LDA.w $7974
	AND.w #$0001
	ASL
	DEC
	STA.w $74A2,x
CODE_04CA26:
	RTL

;---------------------------------------------------------------------------

CODE_04CA27:
	PHB
	PHK
	PLB
	PHD
	LDA.w #$7960
	TCD
	JSL.l CODE_04CA3A
	JSL.l CODE_despawn_sprite_free_slot
	PLD
	PLB
	RTL

CODE_04CA3A:
	LDA.w #!Define_YI_AmbSpr1E4
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$000C
	STA.w $73C2,y
	LDA.w #$0008
	STA.w $7782,y
	JSL.l CODE_03B353
	JML.l CODE_0CF957

;---------------------------------------------------------------------------

YI_NorSpr049_ThunderLakituFireBlast1_Init:
YI_NorSpr04A_ThunderLakituFireBlast2_Init:
YI_NorSpr04B_ThunderLakituFireBlast3_Init:
init_thunder_lakitu_fire_blast:                   ; thunder-lakitu fire-blast variants (no-op spawn)
;$04CA61
	RTL

;---------------------------------------------------------------------------

YI_NorSpr049_ThunderLakituFireBlast1_Main:
main_thunder_lakitu_fire_blast_1:                 ; first phase: spawn child piranha-munch projectile
;$04CA62
	JSL.l CODE_03AF23
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_04CA73
	AND.w #$000C
	BEQ.b CODE_04CA77
CODE_04CA73:
	JML.l CODE_03A31E

CODE_04CA77:
	LDA.w $7A96,x
	BNE.b CODE_04CABC
	LDA.w #$004B
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_04CABC
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$0001
	STA.w $7402,y
	INC
	STA.w $7BB8,y
	INC
	STA.w $7A98,y
	LDA.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$000B
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	INC
	STA.w $7B58,y
	LDA.w #!Define_YI_SoundID39_PiranhaPlantMunch
	JSL.l CODE_push_sound_queue
	LDA.w #$0006
	STA.w $7A96,x
CODE_04CABC:
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCS.b CODE_04CA73
	RTL

;---------------------------------------------------------------------------

DATA_04CACD:
	db $0B,$0A,$09,$08,$07,$06,$05,$04,$03,$02,$01,$12,$11,$09,$10

DATA_04CADC:
	db $0F,$0E,$0D,$0C,$04,$08,$0C,$10,$08,$04,$02,$00,$00,$00,$00

DATA_04CAEB:
	db $04,$06,$0A,$04,$0C,$08,$04,$00,$08,$0C,$0E,$00,$00,$00,$00,$0C
	db $0A,$06,$0C

YI_NorSpr04A_ThunderLakituFireBlast2_Main:
YI_NorSpr04B_ThunderLakituFireBlast3_Main:
main_thunder_lakitu_fire_blast_23:                ; child-blast phases: step animation tables, despawn
;$04CAFE
	JSL.l CODE_03AF23
	LDA.w $7A98,x
	BNE.b CODE_04CB36
	DEC.b $18,x
	BPL.b CODE_04CB0F
	JML.l CODE_03A31E

CODE_04CB0F:
	LDA.b $18,x
	CLC
	ADC.b $78,x
	TAY
	LDA.w DATA_04CACD,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0003
	STA.w $7A98,x
	LDA.w DATA_04CADC,y
	AND.w #$00FF
	STA.w $7BB8,x
	LDA.w DATA_04CAEB,y
	AND.w #$00FF
	STA.w $7B58,x
CODE_04CB36:
	LDY.b $18,x
	CPY.b #$04
	BMI.b CODE_04CB45
	LDY.w $7D36,x
	BPL.b CODE_04CB45
	JSL.l CODE_03A858
CODE_04CB45:
	RTL

;---------------------------------------------------------------------------

YI_NorSpr117_DonutLift_Init:
YI_NorSpr118_LargeDonutLift_Init:
init_donut_lift:                                  ; donut platform: small ($117 = 8w) / large ($118 = 16w)
;$04CB46
	LDY.b #$08
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr117_DonutLift
	BEQ.b CODE_04CB52
	LDY.b #$10
CODE_04CB52:
	TYA
	STA.w $7BB6,x
	STA.w $7BB8,x
	RTL

;---------------------------------------------------------------------------

DATA_04CB5A:
	dw $0001,$0004

DATA_04CB5E:
	dw $7502,$7500,$7501,$3DAA,$3DAB

DATA_04CB68:
	dw $0000,$0000,$0010,$FFF0,$0010

DATA_04CB72:
	dw $0000,$0000,$0000,$0010,$0000

YI_NorSpr117_DonutLift_Main:
YI_NorSpr118_LargeDonutLift_Main:
main_donut_lift:                                  ; wobble + fall once stood on; respawn cooldown
;$04CB7C
	STZ.w $7400,x
	JSL.l CODE_03AF23
	LDY.b $76,x
	BEQ.b CODE_04CB8B
	JML.l CODE_03A31E

CODE_04CB8B:
	LDA.w $7A96,x
	DEC
	CMP.w #$0050
	BCS.b CODE_04CBB6
	CMP.w #$0040
	BNE.b CODE_04CB9F
	LDA.w #$0004
	STA.w $7542,x
CODE_04CB9F:
	LDA.b $14
	LSR
	BCC.b CODE_04CBB6
	LDA.w $70E2,x
	EOR.w #$0001
	PHA
	SEC
	SBC.w $70E2,x
	STA.w $72C0,x
	PLA
	STA.w $70E2,x
CODE_04CBB6:
	LDA.w $61B4
	PHA
	JSL.l CODE_03D22D
	PLA
	SEC
	SBC.w $61B4
	ORA.w $7542,x
	BNE.b CODE_04CBF9
	LDA.w $7362,x
	BMI.b CODE_04CBF9
	LDA.w $70E2,x
	STA.b $04
	LDA.w $7182,x
	STA.b $06
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr117_DonutLift
	ASL
	TAY
	LDA.w DATA_04CB5A,y
	STA.b $00
CODE_04CBE5:
	LDA.w DATA_04CB5E,y
	STA.b $02
	PHY
	JSR.w CODE_04CBFA
	LDX.b $12
	PLY
	INY
	INY
	DEC.b $00
	BNE.b CODE_04CBE5
	INC.b $76,x
CODE_04CBF9:
	RTL

;---------------------------------------------------------------------------

CODE_04CBFA:
	LDA.w DATA_04CB68,y
	CLC
	ADC.b $04
	STA.b $04
	LDA.w DATA_04CB72,y
	CLC
	ADC.b $06
	STA.b $06
	LDA.b $04
	STA.w $0091
	LDA.b $06
	STA.w $0093
	LDA.w #$0001
	STA.w $008F
	LDA.b $02
	STA.w $0095
	JSL.l CODE_change_map16
	RTS

;---------------------------------------------------------------------------

YI_NorSpr121_NumberPlatformExplosion_Init:
init_number_platform_explosion:                   ; numbered floor-tile shatter FX (no-op spawn)
;$04CC24
	RTL

;---------------------------------------------------------------------------

DATA_04CC25:
	dw $0000,$0000,$0000,$0000,$7600,$7601,$7775,$7776
	dw $7602,$7603,$7777,$7778,$7604,$7605,$7779,$777A

YI_NorSpr121_NumberPlatformExplosion_Main:
main_number_platform_explosion:                   ; rewrites 4 Map16 tiles + spawns puff, then despawns
;$04CC45
	JSL.l CODE_03AF23
	LDY.b $76,x
	BNE.b CODE_04CC50
	INC.b $76,x
	RTL

CODE_04CC50:
	LDA.w $61B4
	PHA
	JSL.l CODE_03D22D
	PLA
	CMP.w $61B4
	BNE.b CODE_04CCAC
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	LDA.b $18,x
	BNE.b CODE_04CC7C
	LDA.w $7CD6,x
	STA.b $00
	LDA.w $7CD8,x
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1E6
	JSL.l CODE_spawn_ambient_stomp_puff_common
	LDA.b $18,x
CODE_04CC7C:
	ASL
	ASL
	ASL
	TAY
	LDA.w $70E2,x
	STA.b $04
	LDA.w $7182,x
	STA.b $06
	LDA.w #$0004
	STA.b $00
CODE_04CC8F:
	LDA.w DATA_04CC25,y
	STA.b $02
	PHY
	TYA
	AND.w #$0007
	TAY
	INY
	INY
	JSR.w CODE_04CBFA
	LDX.b $12
	PLY
	INY
	INY
	DEC.b $00
	BNE.b CODE_04CC8F
	JSL.l CODE_03A31E
CODE_04CCAC:
	RTL

;---------------------------------------------------------------------------

DATA_04CCAD:
	dw $FFBD,$0046

YI_NorSpr074_Spike_Init:
init_spike:                                       ; pick facing toward player + initial speed
;$04CCB1
	INC.b $78,x
	LDY.b #$00
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w $70E2,x
	BMI.b CODE_04CCC0
	INY
	INY
CODE_04CCC0:
	TYA
	STA.w $7400,x
	LDA.w DATA_04CCAD,y
	STA.w $75E0,x
	RTL

;---------------------------------------------------------------------------

DATA_04CCCB:
DATA_spike_state_ptr:                                  ; 4-entry $76,x sub-state dispatch
	dw CODE_spike_state_00_walk_and_spit                                ;  0: walking, watching for spit trigger
	dw CODE_spike_state_01_post_spit_wait                                ;  1: ball-spit aftermath / wait
	dw CODE_spike_state_02_rolling_ball_subspawn                                ;  2: rolled spike-ball child (see also CODE_shy_guy_state_02_stunned)
	dw CODE_shy_guy_state_02_stunned                                ;  3: stunned (shared with shy_guy)

YI_NorSpr074_Spike_Main:
main_spike:                                       ; walks, periodically spits spike-ball ($075)
;$04CCD3
	LDY.w $7722,x
	BMI.b CODE_04CCDC
	JSL.l CODE_03AA2E
CODE_04CCDC:
	LDY.b $76,x
	CPY.b #$03
	BNE.b CODE_04CD01
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_04CD01
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_04CD22
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_04CD05
	JML.l CODE_kill_sprite_by_hit

CODE_04CD01:
	JSL.l CODE_03AF23
CODE_04CD05:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_spike_state_ptr,x)
	LDY.b #$00
	LDA.w $75E0,x
	BEQ.b CODE_04CD1C
	BMI.b CODE_04CD18
	INY
	INY
CODE_04CD18:
	TYA
	STA.w $7400,x
CODE_04CD1C:
	JSR.w CODE_048B8D
	JSR.w sprite_scan_for_thrown_hit
CODE_04CD22:
	RTL

DATA_04CD23:
	db $0C,$20,$18

CODE_04CD26:
CODE_spike_state_00_walk_and_spit:
	TYX
	STZ.w $7540,x
	LDY.w $7402,x
	CPY.b #$03
	BMI.b CODE_04CD45
	LDA.w $7A96,x
	BEQ.b CODE_04CD37
	RTS

CODE_04CD37:
	INC.w $7402,x
	LDY.w $7402,x
	CPY.b #$05
	BMI.b CODE_04CDB9
	INC.b $76,x
	BRA.b CODE_04CDB9

CODE_04CD45:
	LDA.w $7A98,x
	BEQ.b CODE_04CD4D
	JMP.w CODE_04CDCC

CODE_04CD4D:
	LDA.w $75E0,x
	EOR.w $7C16,x
	BPL.b CODE_04CDCC
	LDA.w $7C16,x
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCS.b CODE_04CDCC
	LDA.w $7C18,x
	CLC
	ADC.w #$0030
	CMP.w #$0060
	BCS.b CODE_04CDCC
	LDA.w #$0075
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_04CDCC
	PHX
	TYX
	JSL.l CODE_03AD74
	BCC.b CODE_04CDB4
	TXY
	PLX
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$01C0
	STA.w $7A38,y
	LDA.w #$0080
	STA.w $7A36,y
	SEP.b #$20
	LDA.w $7400,x
	STA.w $7400,y
	REP.b #$20
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w #$0003
	STA.w $7402,x
	BRA.b CODE_04CDB9

CODE_04CDB4:
	JSL.l CODE_03A31E
	PLX
CODE_04CDB9:
	LDY.w $7402,x
	LDA.w DATA_04CD23-$03,y
	AND.w #$00FF
	STA.w $7A96,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	RTS

CODE_04CDCC:
	LDA.w #$000B
	STA.w $7540,x
	LDA.w $7860,x
	BIT.w #$000C
	BNE.b CODE_04CDE9
	AND.w #$0001
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	AND.w #$00FF
	ORA.b $00
	BNE.b CODE_04CDEF
CODE_04CDE9:
	LDA.w #$0020
	STA.w $7A98,x
CODE_04CDEF:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_04CDF8
	EOR.w #$FFFF
	INC
CODE_04CDF8:
	CLC
	ADC.b $18,x
	CMP.w #$0200
	BCC.b CODE_04CE1E
	PHA
	LDA.w $7402,x
	CLC
	ADC.b $78,x
	CMP.w #$0003
	BCC.b CODE_04CE16
	LDA.b $78,x
	EOR.w #$FFFF
	INC
	STA.b $78,x
	BRA.b CODE_04CE19

CODE_04CE16:
	STA.w $7402,x
CODE_04CE19:
	PLA
	SEC
	SBC.w #$0200
CODE_04CE1E:
	STA.b $18,x
	RTS

DATA_04CE21:
	dw $0059,$FFA7

CODE_04CE25:
CODE_spike_state_01_post_spit_wait:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_04CE45
	LDA.w #$0002
	STA.w $7402,x
	LDA.w #$FE9A
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7860,x
	LDY.w $7400,x
	LDA.w DATA_04CE21,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
CODE_04CE45:
	RTS

CODE_04CE46:
CODE_spike_state_02_rolling_ball_subspawn:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_04CE5D
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0060
	STA.w $7A98,x
	STZ.w $7402,x
	STZ.b $76,x
CODE_04CE5D:
	RTS

;---------------------------------------------------------------------------

YI_NorSpr075_SpikeBall_Init:
init_spike_ball:                                  ; spit-out projectile from a spike ($074)
;$04CE5E
	JSR.w CODE_04CF1A
	RTL

;---------------------------------------------------------------------------

DATA_04CE62:
	dw $0010,$FFF0

DATA_04CE66:
DATA_spike_ball_state_ptr:                             ; 5-entry $76,x sub-state dispatch
	dw CODE_spike_ball_state_00_launch_arc                                ;  0: launch / arc
	dw CODE_spike_ball_state_01_roll_along                                ;  1: roll along ground
	dw CODE_spike_ball_state_02_bounce                                ;  2: bounce / collision
	dw CODE_spike_ball_state_03_post_collide_cleanup                                ;  3: post-collide cleanup
	dw CODE_shy_guy_state_05_stub                                ;  4: idle stub (TYX/RTS)

YI_NorSpr075_SpikeBall_Main:
main_spike_ball:                                  ; rolling spike-ball projectile
;$04CE70
	LDY.w $74A2,x
	BMI.b CODE_04CE79
	JSL.l CODE_03AA52
CODE_04CE79:
	JSL.l CODE_03AF23
	LDY.b $18,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_04CE8C
	LDA.w $7D38,y
	BEQ.b CODE_04CEA2
CODE_04CE8C:
	LDY.b $76,x
	CPY.b #$03
	BPL.b CODE_04CEA2
	LDA.w #$02CC
	STA.w $75E2,x
	LDA.w #$002C
	STA.w $7542,x
	LDY.b #$04
	STY.b $76,x
CODE_04CEA2:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_spike_ball_state_ptr,x)
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0003
	BEQ.b CODE_04CEBA
	RTL

CODE_04CEBA:
	LDA.w #$0002
	STA.w $74A2,x
	JSR.w CODE_04CF1A
	LDY.b $76,x
	CPY.b #$03
	BPL.b CODE_04CEDF
	LDY.b $18,x
	LDA.w $70E2,y
	SEC
	SBC.w $6022
	STA.w $70E2,x
	LDA.w $7182,y
	SEC
	SBC.w $6020
	STA.w $7182,x
CODE_04CEDF:
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611C
	CLC
	ADC.w $6024
	CMP.w $6026
	BCS.b CODE_04CF19
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611E
	CLC
	ADC.w $6028
	CMP.w $602A
	BCS.b CODE_04CF19
	LDA.w $61D6
	BNE.b CODE_04CF19
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $60A8
	STA.w $60B4
	JSL.l CODE_03A858
CODE_04CF19:
	RTL

CODE_04CF1A:
	LDA.w #FXDATA_540000+$6000
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$6000)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0A00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
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
	INC.w $0CF9
	RTS

CODE_04CF72:
CODE_spike_ball_state_00_launch_arc:
	TYX
	LDA.w $7A36,x
	CLC
	ADC.w #$0009
	CMP.w #$01FF
	BMI.b CODE_04CF84
	INC.b $76,x
	LDA.w #$01FF
CODE_04CF84:
	STA.w $7A36,x
	RTS

CODE_04CF88:
CODE_spike_ball_state_01_roll_along:
	TYX
	LDA.w $7A38,x
	SEC
	SBC.w #$0008
	AND.w #$01FE
	CMP.w #$0160
	BCS.b CODE_04CF9A
	INC.b $76,x
CODE_04CF9A:
	STA.w $7A38,x
	RTS

DATA_04CF9E:
	dw $FDE7,$0219

CODE_04CFA2:
CODE_spike_ball_state_02_bounce:
	TYX
	LDA.w $7A38,x
	CLC
	ADC.w #$0008
	AND.w #$01FE
	CMP.w #$0180
	BCC.b CODE_04CFC6
	LDY.b #$00
	LDA.w $7400,x
	BEQ.b CODE_04CFBB
	INY
	INY
CODE_04CFBB:
	LDA.w DATA_04CF9E,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
	LDA.w #$0160
CODE_04CFC6:
	STA.w $7A38,x
	RTS

CODE_04CFCA:
CODE_spike_ball_state_03_post_collide_cleanup:
	TYX
	LDA.w $7A38,x
	CLC
	ADC.w #$0008
	AND.w #$01FE
	STA.w $7A38,x
	RTS

;---------------------------------------------------------------------------

DATA_04CFD9:
	dw $FFC0,$0040

YI_NorSpr108_Milde_Init:
init_milde:                                       ; pick initial walking direction + override GFX
;$04CFDD
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_04CFE5
	STA.w $7040,x
CODE_04CFE5:
	LDY.w $7400,x
	LDA.w DATA_04CFD9,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.b $16,x
	RTL

;---------------------------------------------------------------------------

DATA_04CFF1:
	dw $0941,$0841

DATA_04CFF5:
DATA_milde_state_ptr:                                  ; 2-entry $76,x sub-state dispatch
	dw CODE_milde_state_00_walk_bounce                                ;  0: walking / animate-bounce
	dw CODE_milde_state_01_eat_yoshi                                ;  1: eating Yoshi (cutscene state)

YI_NorSpr108_Milde_Main:
main_milde:                                       ; spew/eat-Yoshi handler; calls split-trace helper
;$04CFF9
	LDY.b #$00
	LDA.w $7D38,x
	BEQ.b CODE_04D002
	INY
	INY
CODE_04D002:
	LDA.w DATA_04CFF1,y
	STA.w $6FA2,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_04D022
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState02_InCutscene
	BNE.b CODE_04D022
	CMP.b $18,x
	BNE.b CODE_04D022
	LDA.w #!Define_YI_PlayerState00_Normal
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
CODE_04D022:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_04D037
	CMP.w #$0008
	BEQ.b CODE_04D037
	LDY.b $78,x
	BNE.b CODE_04D037
	JSL.l CODE_04D1A0
CODE_04D037:
	JSL.l CODE_03AF23
	LDY.b $76,x
	BEQ.b CODE_04D042
	JMP.w CODE_04D0CB

CODE_04D042:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_04D053
	LDY.w $7400,x
	LDA.w DATA_04CFD9,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_04D053:
	LDY.w $7D36,x
	BPL.b CODE_04D0C5
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_04D0BF
	LDY.w $60AB
	BMI.b CODE_04D0CB
	LDY.w $60C0
	BEQ.b CODE_04D0BF
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_04D0CB
	LDA.w #$0020
	CMP.w $61D6
	BMI.b CODE_04D085
	STA.w $61D6
CODE_04D085:
	LDA.w $6086
	AND.w $0035
	STA.w $617A
	STZ.w $60D4
	LDA.w #!Define_YI_PlayerState02_InCutscene
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STA.b $18,x
	LDA.w #$7C60
	STA.w $6FA0,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $60A8
	STZ.w $60B4
	STZ.w $60AA
	LDA.w #$1175
	STA.w $7040,x
	LDA.w #$000A
	STA.w $7402,x
	DEC
	STA.w $7A98,x
	INC.b $76,x
	BRA.b CODE_04D0CB

CODE_04D0BF:
	JSL.l CODE_03A813
	BRA.b CODE_04D0CB

CODE_04D0C5:
	JSL.l CODE_0DC0F0
	BCS.b CODE_04D0D3
CODE_04D0CB:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_milde_state_ptr,x)
CODE_04D0D3:
	RTL

CODE_04D0D4:
CODE_milde_state_00_walk_bounce:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_04D0FF
	LDA.w #$0006
	STA.w $7A98,x
	LDA.b $16,x
	CLC
	ADC.w $7402,x
	BPL.b CODE_04D0EF
	LDA.w #$0001
	STA.b $16,x
	BRA.b CODE_04D0FC

CODE_04D0EF:
	CMP.w #$0005
	BNE.b CODE_04D0FC
	LDA.w #$FFFF
	STA.b $16,x
	LDA.w #$0003
CODE_04D0FC:
	STA.w $7402,x
CODE_04D0FF:
	RTS

DATA_04D100:
	dw $0018,$0014

CODE_04D104:
CODE_milde_state_01_eat_yoshi:                         ; cutscene: gulp + pop Yoshi back out
	TYX
	LDA.w $7A98,x
	BNE.b CODE_04D17E
	LDY.w $7402,x
	CPY.b #$0B
	BNE.b CODE_04D175
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
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_PlayerState00_Normal
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $617A
	STZ.w $617C
	JSL.l CODE_04D1A0
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
	JSL.l CODE_despawn_sprite_free_slot
	RTS

CODE_04D175:
	INC.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
CODE_04D17E:
	LDA.w $60FC
	AND.w #$0007
	BNE.b CODE_04D19F
	LDA.w $7402,x
	ASL
	TAY
	LDA.w $7182,x
	SEC
	SBC.w DATA_04D100-$14,y
	SEC
	SBC.w $6112
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60AA
	INC.w $61B4
CODE_04D19F:
	RTS

;---------------------------------------------------------------------------

CODE_04D1A0:
	INC.b $78,x
CODE_04D1A2:
	INC.w $1013
	BNE.b CODE_04D1B5
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	STA.b $02
	JSL.l CODE_02E19C
CODE_04D1B5:
	RTL

;---------------------------------------------------------------------------

CODE_04D1B6:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr108_Milde
	BNE.b CODE_04D1C2
	JSL.l CODE_04D1A0
CODE_04D1C2:
	RTL

;---------------------------------------------------------------------------

YI_NorSpr09B_MaceGuy_Init:
init_mace_guy:                                    ; spawn child mace sprite ($09C) attached via $18,x
;$04D1C3
	LDA.w #$009C
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_04D1D5
	STY.b $18,x
	TYX
	JSL.l CODE_03AD74
	BCS.b CODE_04D1DB
CODE_04D1D5:
	LDX.b $12
	JML.l CODE_03A31E

CODE_04D1DB:
	LDX.b $12
	LDY.b $18,x
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,y
	LDA.w #$0100
	STA.w $7A36,y
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$FFC0
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0005
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDA.w $7400,x
	STA.w $7400,y
	RTL

;---------------------------------------------------------------------------

YI_NorSpr09B_MaceGuy_Main:
main_mace_guy:                                    ; mace-guy walks; mace child orbits & may detach
;$04D20C
	JSL.l CODE_03A2C7
	BCC.b CODE_04D223
	LDY.b $18,x
	TYX
	JSL.l CODE_despawn_sprite
	BCC.b CODE_04D221
	LDX.b $12
	JML.l CODE_03A31E

CODE_04D221:
	LDX.b $12
CODE_04D223:
	LDA.w $7D96,x
	BNE.b CODE_04D230
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_04D233
CODE_04D230:
	JSR.w CODE_04D27E
CODE_04D233:
	JSL.l CODE_03AF23
	STZ.w $7402,x
	LDY.b $18,x
	LDA.w $7A38,y
	SEC
	SBC.w #$0010
	AND.w #$01FE
	CMP.w #$0080
	BMI.b CODE_04D25E
	INC.w $7402,x
	CMP.w #$0100
	BMI.b CODE_04D25E
	INC.w $7402,x
	CMP.w #$0180
	BMI.b CODE_04D25E
	INC.w $7402,x
CODE_04D25E:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_04D279
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_04D27D
	LDA.w $7D38,y
	BEQ.b CODE_04D27D
	JSR.w CODE_04D27E
	JSL.l CODE_048BDB
	RTL

CODE_04D279:
	JSL.l CODE_03A5B7
CODE_04D27D:
	RTL

CODE_04D27E:
	PHY
	LDA.w $7D96,x
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PHA
	LDA.w $7042,x
	PHA
	TXY
	LDA.w #!Define_YI_NorSpr01E_Shyguy
	JSL.l CODE_spawn_sprite
	PLA
	STA.w $7042,x
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLA
	STA.w $7D96,x
	PLY
	RTS

;---------------------------------------------------------------------------

YI_NorSpr09C_Mace_Init:
init_mace:                                        ; mace child of a mace-guy ($09B), tied via $18,x
;$04D2A5
	JSR.w CODE_04D4E7
	RTL

;---------------------------------------------------------------------------

DATA_04D2A9:
DATA_mace_state_ptr:                                   ; 2-entry $76,x sub-state dispatch
	dw CODE_mace_state_00_orbit_parent                                ;  0: orbiting mace-guy parent
	dw CODE_mace_state_01_detached_fly                                ;  1: detached / flying free

DATA_04D2AD:
	dw $0006,$0001

YI_NorSpr09C_Mace_Main:
main_mace:                                        ; orbits parent mace-guy ($09B) until released
;$04D2B1
	LDY.b $18,x
	BEQ.b CODE_04D330
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr09B_MaceGuy
	BNE.b CODE_04D2CA
	LDA.w $7D96,y
	BNE.b CODE_04D2CA
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BEQ.b CODE_04D31D
CODE_04D2CA:
	LDA.w #$0100
	SEC
	SBC.w $7A38,x
	BPL.b CODE_04D2D7
	EOR.w #$FFFF
	INC
CODE_04D2D7:
	ASL
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0200
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDY.w $7A39,x
	BNE.b CODE_04D2F8
	EOR.w #$FFFF
	INC
CODE_04D2F8:
	LDY.w $7400,x
	BEQ.b CODE_04D301
	EOR.w #$FFFF
	INC
CODE_04D301:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	STZ.b $18,x
	LDA.w $7040,x
	ORA.w #$0008
	STA.w $7040,x
	BRA.b CODE_04D330

CODE_04D31D:
	LDA.w $70E2,y
	SEC
	SBC.w $70E2,x
	STA.b $16,x
	LDA.w $7182,y
	SEC
	SBC.w $7182,x
	STA.w $75E0,x
CODE_04D330:
	JSR.w CODE_04D3DA
	JSL.l CODE_03AF23
	LDY.b $18,x
	BEQ.b CODE_04D387
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	CMP.w $7182,y
	BPL.b CODE_04D34A
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_04D34A:
	LDY.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w #$6000
	BNE.b CODE_04D356
	LDY.b #$08
CODE_04D356:
	TYA
	CLC
	ADC.w $7A38,x
	AND.w #$01FE
	STA.w $7A38,x
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_mace_state_ptr,x)
	LDA.w $7A38,x
	STA.b $78,x
	LDY.b #$00
	LDA.w $7A38,x
	SEC
	SBC.w #$0080
	AND.w #$01FE
	CMP.w #$0100
	BMI.b CODE_04D381
	LDY.b #$02
CODE_04D381:
	LDA.w DATA_04D2AD,y
	STA.w $74A2,x
CODE_04D387:
	JSR.w CODE_04D4E7
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w $6024
	CMP.w $6026
	BCS.b CODE_04D3D1
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	CLC
	ADC.w $6028
	CMP.w $602A
	BCS.b CODE_04D3D1
	LDA.w $61D6
	BNE.b CODE_04D3D1
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $60A8
	STA.w $60B4
	LDA.w #$FF00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	STZ.w $60D4
	JSL.l CODE_03A858
CODE_04D3D1:
	RTL

DATA_04D3D2:
	dw $FFF8,$0008

DATA_04D3D6:
	dw $0010,$FFF0

CODE_04D3DA:
	LDY.b $18,x
	BNE.b CODE_04D3EF
	LDA.b $16,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.b $00
	LDA.w $75E0,x
	BRA.b CODE_04D407

CODE_04D3EF:
	LDA.w $70E2,y
	SEC
	SBC.w $70E2,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.b $00
	LDA.w $7182,y
	SEC
	SBC.w $7182,x
CODE_04D407:
	CLC
	ADC.w #$0004
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.b $02
	LDA.w $7680,x
	CLC
	ADC.w #$0008
	STA.b $04
	LDA.w $7682,x
	CLC
	ADC.w #$0004
	STA.b $06
	LDA.w #$0003
	STA.b $0C
	LDA.w #$0008
	STA.b $0E
	REP.b #$10
	LDY.w $7362,x
	LDA.w $7A38,x
	SEC
	SBC.w #$0080
	AND.w #$01FE
	CMP.w #$0100
	BMI.b CODE_04D44C
	TYA
	CLC
	ADC.w #$0020
	BRA.b CODE_04D45B

CODE_04D44C:
	LDA.w #$FFF8
	STA.b $0E
	TYA
	CLC
	ADC.w #$0018
	TAY
	SEC
	SBC.w #$0008
CODE_04D45B:
	PHY
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	JSL.l CODE_03AA60
	REP.b #$10
	LDY.w $7400,x
	LDA.w DATA_04D3D2,y
	STA.b $08
	LDA.w DATA_04D3D6,y
	STA.b $0A
	PLY
	LDA.w $7680,x
	CLC
	ADC.b $08
	STA.w $6000,y
	STA.w $6010,y
	CLC
	ADC.b $0A
	STA.w $6008,y
	STA.w $6018,y
	LDA.w $7682,x
	SEC
	SBC.w #$0008
	STA.w $6002,y
	STA.w $600A,y
	CLC
	ADC.w #$0010
	STA.w $6012,y
	STA.w $601A,y
	LDA.w #$0002
	STA.w $6006,y
	STA.w $600E,y
	STA.w $6016,y
	STA.w $601E,y
	STZ.b $08
	STZ.b $0A
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
CODE_04D4B5:
	LDA.b $08
	CLC
	ADC.b $00
	STA.b $08
	CLC
	ADC.b $04
	STA.w $6000,y
	LDA.b $0A
	CLC
	ADC.b $02
	STA.b $0A
	CLC
	ADC.b $06
	STA.w $6002,y
	LDA.w #$20BD
	STA.w $6004,y
	LDA.w #$0000
	STA.w $6006,y
	TYA
	CLC
	ADC.b $0E
	TAY
	DEC.b $0C
	BNE.b CODE_04D4B5
	SEP.b #$10
	RTS

CODE_04D4E7:
	LDA.w #FXDATA_540000+$6000
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$6000)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	STZ.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0A00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
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
	INC.w $0CF9
	RTS

CODE_04D53B:
CODE_mace_state_00_orbit_parent:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0060
	CMP.w #$2001
	BPL.b CODE_04D54B
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_04D54B:
	JSR.w CODE_04D5AD
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	ASL
	XBA
	AND.w #$00FF
	CMP.w #$0080
	BMI.b CODE_04D560
	ORA.w #$FF00
	BRA.b CODE_04D562

CODE_04D560:
	ASL
	ASL
CODE_04D562:
	CLC
	ADC.w #$0100
	STA.w $7A36,x
	LDA.w $7A38,x
	CMP.b $78,x
	BPL.b CODE_04D57D
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_04D57D
	LDA.w #$6000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $76,x
CODE_04D57D:
	RTS

CODE_04D57E:
CODE_mace_state_01_detached_fly:
	TYX
	LDA.w $7A38,x
	CMP.w #$0100
	BNE.b CODE_04D595
	LDA.w #$1FE0
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0005
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC.b $76,x
CODE_04D595:
	JSR.w CODE_04D5AD
	LDY.w $7A38,x
	BPL.b CODE_04D5AC
	LDA.w $7A36,x
	SEC
	SBC.w #$0010
	CMP.w #$00C0
	BMI.b CODE_04D5AC
	STA.w $7A36,x
CODE_04D5AC:
	RTS

CODE_04D5AD:
	LDA.w $7A38,x
	LDY.w $7400,x
	BEQ.b CODE_04D5BC
	EOR.w #$FFFF
	INC
	AND.w #$01FE
CODE_04D5BC:
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.b $18,x
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	XBA
	AND.w #$00FF
	CMP.w #$0080
	BMI.b CODE_04D5E1
	ORA.w #$FF00
CODE_04D5E1:
	CLC
	ADC.w $70E2,y
	STA.w $70E2,x
	RTS

;---------------------------------------------------------------------------

YI_NorSpr091_4RedToadies_Init:
init_four_red_toadies:                            ; no-op; spawn handled in main
;$04D5E9
	RTL

;---------------------------------------------------------------------------

DATA_04D5EA:
DATA_red_toadies_state_ptr:                            ; 5-entry $76 sub-state dispatch (4-toady ambush)
	dw CODE_red_toadies_state_00_idle_watch                                ;  0: idle, watch for star-timer trigger
	dw CODE_red_toadies_state_01_descend                                ;  1: descend on Yoshi
	dw CODE_red_toadies_state_02_lift_yoshi                                ;  2: lifting Yoshi
	dw CODE_red_toadies_state_03_carry_off                                ;  3: carry Yoshi away
	dw CODE_red_toadies_state_04_drop_disperse                                ;  4: drop / disperse

DATA_04D5F4:
	dw $FFC0,$0040,$FF00,$0100

YI_NorSpr091_4RedToadies_Main:
main_four_red_toadies:                            ; quad-toady ambush when star-timer expires
;$04D5FC
	JSR.w CODE_04D7EA
	JSL.l CODE_03AF23
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.w #$0009
	BNE.b CODE_04D64C
	LDA.w $70E2,x
	SEC
	SBC.w $609A
	CLC
	ADC.w $6094
	STA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w $7CD6,x
	LDA.w $7182,x
	SEC
	SBC.w $60A2
	CLC
	ADC.w $609C
	STA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7CD8,x
	LDY.b $76
	CPY.b #$03
	BNE.b CODE_04D64C
	LDA.w $0DBC
	CLC
	ADC.w $6094
	STA.w $70E2
	CLC
	ADC.w #$0008
	STA.w $7CD6
CODE_04D64C:
	LDA.w $70E2,x
	STA.w $6000
	LDA.w $7182,x
	STA.w $6002
	LDA.w $7CD6,x
	STA.w $6004
	LDA.w $7CD8,x
	STA.w $6006
	LDY.w $0E2D
	BNE.b CODE_04D6C0
	LDA.w $61B2
	BMI.b CODE_04D691
	LDA.w $0B59
	ORA.w $0B57
	BNE.b CODE_04D67E
	LDA.w !RAM_YI_Level_StarTimerLo
	CMP.w #!Define_YI_Level_StarTimerThatSpawnsToadiesThreshold
	BMI.b CODE_04D689
CODE_04D67E:
	LDA.w $61CC
	BEQ.b CODE_04D691
	JSL.l CODE_06C09A
	BRA.b CODE_04D691

CODE_04D689:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	CMP.w #$0010
	BEQ.b CODE_04D6C0
CODE_04D691:
	INC.w $0E2D
	STZ.w $61CC
	LDX.b #$0C
CODE_04D699:
	LDA.w #$0004
	STA.w $0EC9,x
	TXA
	LSR
	TAY
	LDA.w DATA_04D5F4,y
	STA.w $0E69,x
	LDA.w #$0200
	STA.w $0E6B,x
	LDA.w #$F800
	STA.w $0E8B,x
	LDA.w #$0010
	STA.w $0E7B,x
	DEX
	DEX
	DEX
	DEX
	BPL.b CODE_04D699
CODE_04D6C0:
	LDX.b #$0C
CODE_04D6C2:
	LDA.w $0E9B,x
	BEQ.b CODE_04D6CA
	JMP.w CODE_04D7A8

CODE_04D6CA:
	LDA.w $0E69,x
	CMP.w $0E89,x
	BMI.b CODE_04D6D8
	SEC
	SBC.w $0E79,x
	BRA.b CODE_04D6DC

CODE_04D6D8:
	CLC
	ADC.w $0E79,x
CODE_04D6DC:
	STA.w $0E69,x
	BPL.b CODE_04D6F0
	CLC
	ADC.w $0E37,x
	STA.w $0E37,x
	LDA.w $0E39,x
	SBC.w #$0000
	BRA.b CODE_04D6FD

CODE_04D6F0:
	CLC
	ADC.w $0E37,x
	STA.w $0E37,x
	LDA.w $0E39,x
	ADC.w #$0000
CODE_04D6FD:
	STA.w $0E39,x
	LDA.w $6000
	CLC
	ADC.w $0E38,x
	STA.w $6020
	LDA.w $6004
	CLC
	ADC.w $0E38,x
	STA.w $6024
	LDA.w $0E6B,x
	CMP.w $0E8B,x
	BMI.b CODE_04D722
	SEC
	SBC.w $0E7B,x
	BRA.b CODE_04D726

CODE_04D722:
	CLC
	ADC.w $0E7B,x
CODE_04D726:
	STA.w $0E6B,x
	BPL.b CODE_04D73A
	CLC
	ADC.w $0E49,x
	STA.w $0E49,x
	LDA.w $0E4B,x
	SBC.w #$0000
	BRA.b CODE_04D747

CODE_04D73A:
	CLC
	ADC.w $0E49,x
	STA.w $0E49,x
	LDA.w $0E4B,x
	ADC.w #$0000
CODE_04D747:
	STA.w $0E4B,x
	LDA.w $6002
	CLC
	ADC.w $0E4A,x
	STA.w $6022
	LDA.w $6006
	CLC
	ADC.w $0E4A,x
	STA.w $6026
	LDA.w $0EAB,x
	BEQ.b CODE_04D766
	DEC.w $0EAB,x
CODE_04D766:
	LDA.w $0EB9,x
	BEQ.b CODE_04D76E
	DEC.w $0EB9,x
CODE_04D76E:
	LDA.w $0EBB,x
	BEQ.b CODE_04D776
	DEC.w $0EBB,x
CODE_04D776:
	TXY
	LDA.w $0EC9,x
	ASL
	TAX
	JSR.w (DATA_red_toadies_state_ptr,x)
	LDA.w $0EB9,x
	BNE.b CODE_04D794
	LDA.w #$0006
	STA.w $0EB9,x
	LDA.w $0EA9,x
	INC
	AND.w #$0003
	STA.w $0EA9,x
CODE_04D794:
	LDA.w $6020
	SEC
	SBC.w $6000
	STA.w $0E38,x
	LDA.w $6022
	SEC
	SBC.w $6002
	STA.w $0E4A,x
CODE_04D7A8:
	DEX
	DEX
	DEX
	DEX
	BMI.b CODE_04D7B1
	JMP.w CODE_04D6C2

CODE_04D7B1:
	LDX.b $12
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.w #$0009
	BNE.b CODE_04D7E5
	LDA.w $70E2,x
	SEC
	SBC.w $6094
	CLC
	ADC.w $609A
	STA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w $7CD6,x
	LDA.w $7182,x
	SEC
	SBC.w $609C
	CLC
	ADC.w $60A2
	STA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7CD8,x
CODE_04D7E5:
	RTL

DATA_04D7E6:
	db $2C,$2D,$3C,$3D

CODE_04D7EA:
	REP.b #$10
	LDY.w $7362,x
	LDX.w #$000C
CODE_04D7F2:
	LDA.w $0E9B,x
	BEQ.b CODE_04D805
	LDA.w #$8000
	STA.w $6000,y
	STA.w $6008,y
	STA.w $6010,y
	BRA.b CODE_04D857

CODE_04D805:
	LDA.w $6000,y
	CLC
	ADC.w $0E38,x
	STA.w $6000,y
	STA.w $6008,y
	CLC
	ADC.w #$0008
	STA.w $6010,y
	LDA.w $6002,y
	CLC
	ADC.w $0E4A,x
	STA.w $6002,y
	SEC
	SBC.w #$0008
	STA.w $600A,y
	STA.w $6012,y
	LDA.w $0E99,x
	XBA
	LSR
	LSR
	LSR
	XBA
	STA.b $00
	PHY
	LDY.w $0EA9,x
	LDA.w DATA_04D7E6,y
	AND.w #$00FF
	PLY
	CLC
	ADC.w $600C,y
	STA.w $600C,y
	EOR.w #$4000
	STA.w $6014,y
	LDA.w $6004,y
	EOR.b $00
	STA.w $6004,y
CODE_04D857:
	TYA
	CLC
	ADC.w #$0018
	TAY
	DEX
	DEX
	DEX
	DEX
	BPL.b CODE_04D7F2
	SEP.b #$10
	LDX.b $12
	RTS

DATA_04D868:
	dw $0300,$FD00

CODE_04D86C:
CODE_red_toadies_state_00_idle_watch:
	TYX
	LDA.w #$0002
	STA.w $0E99,x
	LDA.w $7CD6
	SEC
	SBC.w $6024
	PHP
	BPL.b CODE_04D881
	EOR.w #$FFFF
	INC
CODE_04D881:
	LSR
	CMP.w #$0018
	BMI.b CODE_04D88A
	LDA.w #$0018
CODE_04D88A:
	CLC
	ADC.w #$0018
	STA.w $0E79,x
	ASL
	ASL
	ASL
	ASL
	PLP
	BPL.b CODE_04D89F
	EOR.w #$FFFF
	INC
	STZ.w $0E99,x
CODE_04D89F:
	STA.w $0E89,x
	LDA.w $7CD8
	SEC
	SBC.w $6026
	PHP
	BPL.b CODE_04D8B0
	EOR.w #$FFFF
	INC
CODE_04D8B0:
	LSR
	CMP.w #$0018
	BMI.b CODE_04D8B9
	LDA.w #$0018
CODE_04D8B9:
	CLC
	ADC.w #$0018
	STA.w $0E7B,x
	ASL
	ASL
	ASL
	ASL
	PLP
	BPL.b CODE_04D8CB
	EOR.w #$FFFF
	INC
CODE_04D8CB:
	STA.w $0E8B,x
	LDA.w $7CD6
	SEC
	SBC.w $6024
	CLC
	ADC.w #$000C
	CMP.w #$0018
	BCC.b CODE_04D8DF
CODE_04D8DE:
	RTS

CODE_04D8DF:
	LDA.w $7CD8
	SEC
	SBC.w $6026
	CLC
	ADC.w #$000C
	CMP.w #$0018
	BCS.b CODE_04D8DE
	LDA.w $61CC
	PHP
	AND.w #$0002
	STA.w $0E99,x
	PLP
	BNE.b CODE_04D938
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.w #$0009
	BNE.b CODE_04D91D
	LDA.w $7680
	STA.w $0DBC
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	STZ.w $75E2
	JSL.l CODE_06BFA4
	LDY.b #$07
	STY.w $0DB4
	LDY.b #$03
	BRA.b CODE_04D936

CODE_04D91D:
	JSL.l CODE_06C114
	JSL.l CODE_06BF73
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	STZ.w $7542
	LDA.w #$6040
	STA.w $6FA2
	LDY.b #$02
CODE_04D936:
	STY.b $76
CODE_04D938:
	LDY.w $61CC
	CPY.b #$06
	BNE.b CODE_04D954
	LDA.w $7680
	AND.w #$FF00
	STA.b $00
	LDA.w $7682
	AND.w #$FF00
	ORA.b $00
	BEQ.b CODE_04D954
	JMP.w CODE_04DA48

CODE_04D954:
	TYA
	STA.w $0E59,x
	INC.w $61CC
	INC.w $61CC
	STZ.w $0E69,x
	STZ.w $0E79,x
	STZ.w $0E6B,x
	STZ.w $0E7B,x
	INC.w $0EC9,x
	RTS

DATA_04D96E:
	dw $FFF6,$000A,$FFFA,$0006

DATA_04D976:
	dw $0008,$0009,$0010,$000F

CODE_04D97E:
CODE_red_toadies_state_01_descend:
	TYX
	LDY.b #$02
	STY.b $00
	TXA
	LSR
	TAY
	LDA.w $70E2
	CLC
	ADC.w DATA_04D96E,y
	STA.b $02
	LDA.w $6020
	SEC
	SBC.b $02
	STA.b $04
	INC
	CMP.w #$0002
	BCS.b CODE_04D9A1
	STZ.b $04
	DEC.b $00
CODE_04D9A1:
	LDA.b $04
	CMP.w #$8000
	ROR
	CLC
	ADC.b $02
	STA.w $6020
	LDA.w $7182
	CLC
	ADC.w DATA_04D976,y
	STA.b $02
	LDA.w $6022
	SEC
	SBC.b $02
	STA.b $04
	INC
	CMP.w #$0002
	BCS.b CODE_04D9C8
	STZ.b $04
	DEC.b $00
CODE_04D9C8:
	LDA.b $04
	CMP.w #$8000
	ROR
	CLC
	ADC.b $02
	STA.w $6022
	LDY.b $00
	BNE.b CODE_04D9DB
	INC.w $0EC9,x
CODE_04D9DB:
	RTS

CODE_04D9DC:
CODE_red_toadies_state_02_lift_yoshi:
	TYX
	LDY.w $61CC
	CPY.b #$08
	BMI.b CODE_04DA0D
	LDY.w $0E2F
	CPY.b #$04
	BPL.b CODE_04DA02
	LDY.w $0E5B,x
	BNE.b CODE_04DA0D
	INC.w $0E5B,x
	INC.w $0E2F
	LDY.w $0E59,x
	BNE.b CODE_04DA0D
	LDA.w #!Define_YI_SoundID3D_MarioKidnapped
	STA.w !RAM_YI_Global_PlaySoundHighPriorityLo
	RTS

CODE_04DA02:
	INC.w $0EC9,x
	TXA
	LSR
	AND.w #$0002
	STA.w $0E99,x
CODE_04DA0D:
	RTS

CODE_04DA0E:
CODE_red_toadies_state_03_carry_off:
	TYX
	TXA
	LSR
	TAY
	AND.w #$0002
	STA.w $0E99,x
	CPY.b #$06
	BNE.b CODE_04DA5F
	LDA.w #$0040
	STA.w $0E7B,x
	LDA.w #$F800
	STA.w $0E8B,x
	LDA.w $6020
	SEC
	SBC.w #$0006
	STA.w $70E2
	LDA.w $6022
	SEC
	SBC.w #$000F
	STA.w $7182
	LDA.w $6022
	SEC
	SBC.w $609C
	CMP.w #$FFF0
	BPL.b CODE_04DA7B
CODE_04DA48:
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState0E_TouchedSpike
	BEQ.b CODE_04DA5E
	REP.b #$10
	JSL.l CODE_04F6F1
	LDA.w #!Define_YI_GameMode12
	STA.w !RAM_YI_Global_CurrentGameMode
	SEP.b #$10
CODE_04DA5E:
	RTS

CODE_04DA5F:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	CMP.w #$0010
	BNE.b CODE_04DA7B
	LDA.w $70E2
	CLC
	ADC.w DATA_04D96E,y
	STA.w $6020
	LDA.w $7182
	CLC
	ADC.w DATA_04D976,y
	STA.w $6022
CODE_04DA7B:
	RTS

CODE_04DA7C:
CODE_red_toadies_state_04_drop_disperse:
	TYX
	LDY.w $0E6C,x
	BPL.b CODE_04DA88
	LDA.w #$0040
	STA.w $0E7B,x
CODE_04DA88:
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.w #$0009
	BEQ.b CODE_04DAA0
	LDA.w $6020
	SEC
	SBC.w $6094
	CLC
	ADC.w #$0040
	CMP.w #$0180
	BCS.b CODE_04DAB0
CODE_04DAA0:
	LDA.w $6022
	SEC
	SBC.w $609C
	CLC
	ADC.w #$0040
	CMP.w #$0160
	BCC.b CODE_04DAC8
CODE_04DAB0:
	INC.w $0E9B,x
	DEC.w $0E31
	BNE.b CODE_04DAE8
	STZ.w $0E33
	STZ.w $0E2D
	STZ.w $0CE6
	LDX.b $12
	PLA
	JML.l CODE_03A31E

CODE_04DAC8:
	LDA.w $61B2
	BMI.b CODE_04DAE8
	LDY.w $0E31
	CPY.b #$04
	BNE.b CODE_04DAE8
	LDA.w !RAM_YI_Level_StarTimerLo
	CMP.w #!Define_YI_Level_StarTimerThatSpawnsToadiesThreshold
	BPL.b CODE_04DAE8
	STZ.w $0EC9,x
	STZ.w $0E2F
	STZ.w $0E2D
	STZ.w $0E5B,x
CODE_04DAE8:
	RTS

;---------------------------------------------------------------------------

YI_NorSpr103_BooGuysMovingMace_Init:
init_boo_guys_moving_mace:                        ; mace tossed between boo-guys; X-pos bit picks owner
;$04DAE9
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	STA.w $7400,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr103_BooGuysMovingMace_Main:
main_boo_guys_moving_mace:                        ; 5-frame swap animation between owners
;$04DAF6
	JSL.l CODE_03AF23
	LDA.w $7A98,x
	BNE.b CODE_04DB14
	LDA.w #$0008
	STA.w $7A98,x
	LDA.w $7402,x
	INC
	CMP.w #$0005
	BMI.b CODE_04DB11
	LDA.w #$0000
CODE_04DB11:
	STA.w $7402,x
CODE_04DB14:
	RTL

;---------------------------------------------------------------------------

DATA_04DB15:
	dw $0020,$0040

YI_NorSpr083_BowserFightCloud_Init:
init_bowser_fight_cloud:                          ; final-fight cloud platform under Yoshi
;$04DB19
	SEP.b #$20
	LDA.b #$02
	STA.w $74A1,x
	REP.b #$20
	RTL

;---------------------------------------------------------------------------

DATA_04DB23:
	dw $0030,$0040,$0050,$0060

YI_NorSpr083_BowserFightCloud_Main:
main_bowser_fight_cloud:                          ; horizontal drift across boss arena
;$04DB2B
	JSL.l CODE_03AF23
	LDA.w $7680,x
	CMP.w #$0130
	BMI.b CODE_04DB47
	LDA.b $10
	AND.w #$0006
	TAY
	LDA.w !RAM_YI_Global_Layer2XPosLo
	SEC
	SBC.w DATA_04DB23,y
	STA.w $70E2,x
CODE_04DB47:
	RTL

;---------------------------------------------------------------------------

DATA_04DB48:
	dw $003B,$003C,$003D,$003E,$003F

DATA_04DB52:
	dw !Define_YI_PlayerState00_Normal
	dw !Define_YI_PlayerState0C
	dw !Define_YI_PlayerState06
	dw !Define_YI_PlayerState06
	dw !Define_YI_PlayerState06
	dw !Define_YI_PlayerState06
	dw !Define_YI_PlayerState06
	dw !Define_YI_PlayerState06
	dw !Define_YI_PlayerState06
	dw !Define_YI_PlayerState06
	dw !Define_YI_PlayerState20_EnteringRaphaelBossRoom

CODE_04DB68:
	REP.b #$30
	PHB
	PHK
	PLB
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	ASL
	TAY
	LDX.w #$0020
	LDA.w DATA_04DB52,y
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	CMP.w #$000C
	BNE.b CODE_04DBA5
	LDA.w #!Define_YI_PlayerForm0E_Skiing
	STA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0010
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STZ.w $60B4
	STZ.w $60A8
	STZ.w $60AA
	STZ.w $60D4
	JSL.l CODE_04EF27
	BRA.b CODE_04DBEC

CODE_04DBA5:
	CMP.w #$0006
	BNE.b CODE_04DBEC
	PHA
	TYA
	CLC
	ADC.w #$FFFE
	CMP.w #$000A
	BCS.b CODE_04DBC0
	LDX.w #$0112
	STX.w $60BE
	LDX.w #$0010
	BRA.b CODE_04DBC9

CODE_04DBC0:
	SBC.w #$0008
	ORA.w #$8000
	LDX.w #$0020
CODE_04DBC9:
	ORA.w #$4000
	STA.w $6106
	AND.w #$00FF
	CMP.w #$0006
	BCC.b CODE_04DBE2
	TAY
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	ORA.w #$0008
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	TYA
CODE_04DBE2:
	AND.w #$0002
	EOR.w #$0002
	STA.w $60C4
	PLA
CODE_04DBEC:
	STX.w $6126
	SEP.b #$10
	CMP.w #$0020
	BNE.b CODE_04DC0B
	LDX.b #$1C
CODE_04DBF8:
	LDA.l DATA_5FE5AA,x
	STA.l YI_Global_PaletteMirror[$D1].LowByte,x
	STA.l $702F0E,x
	DEX
	DEX
	BPL.b CODE_04DBF8
	STZ.w $617E
CODE_04DC0B:
	LDA.w #$0001
	STA.w $60CC
	PLB
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0078
	STA.w $6094
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0064
	STA.w $609C
	BRA.b CODE_04DC2E

CODE_04DC28:
	LDA.w #$0020
	STA.w $6126
CODE_04DC2E:
	LDA.w #!Define_YI_NorSpr061_BabyMario
	LDY.b #$00
	JSL.l CODE_03A366
	LDA.w #$000A
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w #$000D
	STA.w $7402,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDA.w #$8000
	STA.w $61B2
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $70E2,y
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w $7182,y
	LDA.w $7042,y
	AND.w #$00CF
	ORA.w $6126
	STA.w $7042,y
	JSL.l CODE_restore_egg_inventory
	REP.b #$10
	LDX.w #$0126
CODE_04DC70:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $05C2,x
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0010
	STA.w $06EA,x
	LDA.w $6126
	STA.w $0812,x
	DEX
	DEX
	BPL.b CODE_04DC70
	SEP.b #$10
	LDA.w !EXRAM_YI_Player_SubXPosLo|!EXRAMBankMirror
	STA.w $7E10
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $7E12
	LDA.w !EXRAM_YI_Player_SubYPosLo|!EXRAMBankMirror
	STA.w $7E14
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w $7E16
	STZ.w $7E18
	LDA.w #$0F00
	STA.w $7E1A
	STZ.w $7E1C
	LDA.w #$070C
	STA.w $7E1E
	LDA.w #$006C
	STA.w $7E20
	LDA.w #$0058
	STA.w $7E22
	SEP.b #$20
CODE_04DCC4:
	JSL.l CODE_04FD28
	LDY.w !RAM_YI_Level_LevelHeaderBG3TilesetLo
	CPY.b #$1A
	BNE.b CODE_04DCE5
	REP.b #$20
	LDA.w #$0000
	SEC
	SBC.b !RAM_YI_Global_Layer3XPosLo
	STA.w $0C90
	LDA.w #$0100
	SEC
	SBC.b !RAM_YI_Global_Layer3YPosLo
	STA.w $0C92
	SEP.b #$20
CODE_04DCE5:
	PHB
	PHK
	PLB
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.b #!Define_YI_PlayerState0C
	BEQ.b CODE_04DCF7
	JSR.w CODE_04FA33
	BNE.b CODE_04DCF7
	INC.w $0C8E
CODE_04DCF7:
	PLB
	RTL

;---------------------------------------------------------------------------

CODE_04DCF9:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w !RAM_YI_Global_Layer1XPosLo
	SEC
	SBC.w #$000C
	CMP.w #$0030
	BPL.b CODE_04DD0C
	LDA.w #$0030
CODE_04DD0C:
	CMP.w #$00A8
	BMI.b CODE_04DD14
	LDA.w #$00A8
CODE_04DD14:
	STA.w $7E20
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w !RAM_YI_Global_Layer1YPosLo
	CMP.w #$0040
	BPL.b CODE_04DD26
	LDA.w #$0040
CODE_04DD26:
	CMP.w #$00A0
	BMI.b CODE_04DD2E
	LDA.w #$00A0
CODE_04DD2E:
	STA.w $7E22
	RTL

;---------------------------------------------------------------------------

DATA_04DD32:
	dw $0080,$0080

DATA_04DD36:
	dw $4000,$4000

DATA_04DD3A:
	dw $8000,$8000

DATA_04DD3E:
	dw $000C,$000C,$0004,$0004,$0010,$0010,$000C,$000C
	dw $000D,$000D,$0008,$0008,$0007,$0007,$0007,$0007

DATA_04DD5E:
	dw $000C,$FFF4,$0008,$FFF8,$0004,$FFFC,$0004,$FFFC
	dw $000B,$FFF5,$0008,$FFF8

DATA_04DD76:
	dw $0008,$0008,$0008,$0008,$0006,$000A

DATA_04DD82:
	dw $0004,$0004,$0004,$0004,$0002,$0002,$0004,$FFFC
	dw $0004,$FFFC,$0008,$FFF8,$0800,$0000

CODE_04DD9E:
	PHB
	PHK
	PLB
	REP.b #$30
	LDX.w !EXRAM_YI_Global_EggThrowSetting|!EXRAMBankMirror
	LDA.w DATA_04DD36,x
	STA.w $6088
	LDA.w DATA_04DD32,x
	STA.w $6086
	LDA.w DATA_04DD3A,x
	STA.w $6084
	JSR.w CODE_04F04F
	LDA.w $616E
	BEQ.b CODE_04DDCC
	LSR
	BNE.b CODE_04DDC9
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
CODE_04DDC9:
	DEC.w $616E
CODE_04DDCC:
	LDA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	BMI.b CODE_04DDD9
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_04DDE8
CODE_04DDD9:
	JSR.w CODE_04DE5F
	JSR.w CODE_04DF4A
	JSR.w CODE_04DE7E
	STZ.w $61B4
	STZ.w $61C2
CODE_04DDE8:
	LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	BNE.b CODE_04DE48
	LDA.w $6150
	INC
	AND.w #$0006
	TAX
	BEQ.b CODE_04DDFD
	LDY.w $60C6
	BEQ.b CODE_04DDFD
	INX
CODE_04DDFD:
	TXA
	ASL
	ASL
	ORA.w $60C4
	TAY
	TXA
	ASL
	ORA.w $60C4
	TAX
	LDA.w DATA_04DD5E,y
	CLC
	ADC.w $6152
	STA.w $0C80
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_04DD76,x
	STA.w $615A
	LDA.w $60B0
	CLC
	ADC.w $0C80
	STA.w $6156
	LDA.w DATA_04DD3E,y
	CLC
	ADC.w $6154
	STA.w $0C82
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_04DD82,x
	STA.w $615C
	LDA.w $60B0
	CLC
	ADC.w $0C80
	STA.w $6156
CODE_04DE48:
	LDY.w $61CE
	BEQ.b CODE_04DE5B
	LDA.w $60BE
	CMP.w #$0055
	BCS.b CODE_04DE5B
	ADC.w #$01AF
	STA.w $60BE
CODE_04DE5B:
	SEP.b #$30
	PLB
	RTL

CODE_04DE5F:
	LDX.w #$0028
CODE_04DE62:
	LDA.w $0CC6,x
	BEQ.b CODE_04DE6A
	DEC.w $0CC6,x
CODE_04DE6A:
	DEX
	DEX
	BPL.b CODE_04DE62
	LDX.w #$0026
CODE_04DE71:
	LDA.w $61D0,x
	BEQ.b CODE_04DE79
	DEC.w $61D0,x
CODE_04DE79:
	DEX
	DEX
	BPL.b CODE_04DE71
	RTS

CODE_04DE7E:
	LDA.w $61B4
	LDY.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CPY.w #$000D
	BNE.b CODE_04DE8C
	LDA.w #$0000
CODE_04DE8C:
	STA.w $61B8
	ORA.w $60C0
	STA.b $6B
	STZ.b $69
	LDX.w $7DF6
	BEQ.b CODE_04DEE3
CODE_04DE9B:
	LDY.w $7DF6,x
	LDA.w $05C0
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	BPL.b CODE_04DEAB
	CLC
	ADC.w #$0128
CODE_04DEAB:
	TAY
	LDA.w $0813,y
	AND.w #$00FF
	TSB.b $69
	DEX
	DEX
	BNE.b CODE_04DE9B
	LDA.b $69
	ORA.b $6B
	ORA.w $0C8A
	ORA.w $0B57
	BNE.b CODE_04DEE3
	LDA.w $60B4
	CLC
	ADC.w $7E3A
	BPL.b CODE_04DED1
	EOR.w #$FFFF
	INC
CODE_04DED1:
	CLC
	ADC.w $093A
	STA.w $093A
	CMP.w #$0160
	BCC.b CODE_04DF49
	SBC.w #$0160
	STA.w $093A
CODE_04DEE3:
	LDY.w $05C0
	LDA.w $0C8A
	BNE.b CODE_04DEF5
	LDA.w $0B57
	BEQ.b CODE_04DF19
	LDA.w $61B2
	BMI.b CODE_04DF19
CODE_04DEF5:
	LDA.w $70E2
	STA.w $05C2,y
	LDA.w $7182
	SEC
	SBC.w #$FFF3
	STA.w $06EA,y
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	AND.w #$FF00
	ORA.w #$0100
	ORA.w $7042
	AND.w #$FF30
	LDY.w $05C0
	BRA.b CODE_04DF39

CODE_04DF19:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $05C2,y
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0010
	STA.w $06EA,y
	LDA.b $6B
	BEQ.b CODE_04DF36
	LDA.w $60AA
	AND.w #$FF00
	ORA.w #$0100
CODE_04DF36:
	ORA.w $6126
CODE_04DF39:
	STA.w $0812,y
	INY
	INY
	CPY.w #$0128
	BCC.b CODE_04DF46
	LDY.w #$0000
CODE_04DF46:
	STY.w $05C0
CODE_04DF49:
	RTS

CODE_04DF4A:
	LDX.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	JMP.w (DATA_player_state_dispatch_ptr,x)

DATA_04DF50:
DATA_player_state_dispatch_ptr:                        ; 22-entry table indexed by !EXRAM_YI_Player_CurrentStateLo
                                                  ; (see Constants/PlayerStates.asm)
	dw CODE_player_state_00_normal                                ;  $00 PlayerState00_Normal
	dw CODE_player_state_02_in_cutscene                                ;  $02 PlayerState02_InCutscene
	dw CODE_player_state_04                                ;  $04 PlayerState04
	dw CODE_player_state_06                                ;  $06 PlayerState06
	dw CODE_player_state_08                                ;  $08 PlayerState08
	dw CODE_04F8F1                                ;  $0A PlayerState0A_EnteringDoor
	dw CODE_04E413                                ;  $0C PlayerState0C
	dw CODE_04F800                                ;  $0E PlayerState0E_TouchedSpike
	dw CODE_player_state_10_transforming                                ;  $10 PlayerState10_Transforming
	dw CODE_player_state_12_smushed_by_wall                                ;  $12 PlayerState12_SmushedByWall
	dw CODE_player_state_14_activate_goal                                ;  $14 PlayerState14_ActivateGoal
	dw CODE_player_state_16_level_intro                                ;  $16 PlayerState16_LevelIntro
	dw CODE_player_state_18_sent_towards_baby_mario                                ;  $18 PlayerState18_SentTowardsBabyMario
	dw CODE_04F849                                ;  $1A PlayerState1A_DisableInput
	dw CODE_04F846                                ;  $1C PlayerState1C_Prologue
	dw CODE_04E3C6                                ;  $1E PlayerState1E_PushedAwayByRaphael
	dw CODE_player_state_20_entering_raphael_boss_room                                ;  $20 PlayerState20_EnteringRaphaelBossRoom
	dw CODE_player_state_22_enter_keyhole                                ;  $22 PlayerState22_EnterKeyhole
	dw CODE_player_state_24                                ;  $24 PlayerState24
	dw CODE_player_state_26                                ;  $26 PlayerState26
	dw CODE_player_state_28_touched_lava                                ;  $28 PlayerState28_TouchedLava
	dw CODE_04E770                                ;  $2A PlayerState2A

CODE_04DF7C:
CODE_player_state_28_touched_lava:                     ; PlayerState28_TouchedLava
	SEP.b #$10
	JSL.l CODE_04F74A
	LDA.w $61F6
	BEQ.b CODE_04DF8E
	REP.b #$10
	DEC.w $61F6
	BRA.b CODE_04DFFE

CODE_04DF8E:
	LDA.w $0030
	AND.w #$0001
	BNE.b CODE_04DFC5
	LDA.w #!Define_YI_AmbSpr1DF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $70A2,y
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$000C
	STA.w $7142,y
	LDA.w #$0005
	STA.w $7E4C,y
	STA.w $7E4E,y
	STA.w $73C2,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w #$0006
	STA.w $7462,y
CODE_04DFC5:
	LDX.b #FXCODE_0BC70A>>16
	LDA.w #FXCODE_0BC70A
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDA.w $60B2
	CMP.w #$0120
	BMI.b CODE_04DFE0
	JSL.l CODE_04F6CE
	INC.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	RTS

CODE_04DFE0:
	LDX.w #$01AE
	LDA.w $60AA
	CLC
	ADC.w #$0028
	CMP.w #$0400
	BMI.b CODE_04DFF2
	LDA.w #$0400
CODE_04DFF2:
	STA.w $60AA
	TAY
	BMI.b CODE_04E001
	LDA.w #$0030
	STA.w $6126
CODE_04DFFE:
	LDX.w #$006B
CODE_04E001:
	STX.w $60BE
	RTS

DATA_04E005:
	db $02,$08,$03,$2C,$02,$16,$03,$12,$02,$1C,$03,$1C,$02,$26,$00,$FF
	db $02,$10,$00,$40,$01,$06,$00,$14,$01,$06,$00,$40,$01,$06,$00,$14
	db $01,$06,$00,$40,$01,$06,$00,$14,$01,$06,$00,$40,$01,$06,$00,$14
	db $01,$06,$00,$7F,$FF

CODE_04E03A:
CODE_player_state_26:                                  ; PlayerState26
	SEP.b #$10
	LDA.w $61F6
	BNE.b CODE_04E07B
CODE_04E041:
	LDA.w $617E
	ASL
	TAX
	CPX.b #$08
	BCC.b CODE_04E04D
	STA.w $1078
CODE_04E04D:
	LDY.w DATA_04E005,x
	BPL.b CODE_04E05F
	TYA
	ORA.w #$FF00
	CLC
	ADC.w $617E
	STA.w $617E
	BRA.b CODE_04E041

CODE_04E05F:
	TYA
	LSR
	XBA
	BCC.b CODE_04E067
	ORA.w $6084
CODE_04E067:
	STA.w $617A
	STA.w $617C
	LDA.w DATA_04E005+$01,x
	AND.w #$00FF
	STA.w $61F6
	INC.w $617E
	BRA.b CODE_04E07E

CODE_04E07B:
	STZ.w $617C
CODE_04E07E:
	REP.b #$10
	LDA.w $617A
	STA.w $6070
	LDA.w $617C
	STA.w $6072
	JSR.w CODE_04F6A2
	LDA.w $60C0
	BEQ.b CODE_04E0BB
	LDX.w $617E
	CPX.w #$0008
	BCC.b CODE_04E0AD
	CMP.w #$00DA
	BCS.b CODE_04E0AA
	LDA.w #$00DA
	STA.w $60C0
	STA.w $6182
CODE_04E0AA:
	JSR.w CODE_04E271
CODE_04E0AD:
	LDA.w #$07A0
	CMP.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	BPL.b CODE_04E0BB
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60C0
CODE_04E0BB:
	RTS

CODE_04E0BC:
CODE_player_state_22_enter_keyhole:                    ; PlayerState22_EnterKeyhole
	INC.w $61B4
	SEP.b #$10
	LDX.b #FXCODE_0BC703>>16
	LDA.w #FXCODE_0BC703
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$0100
	STA.w $6070
	LDA.w $60B0
	CMP.w #$0080
	BPL.b CODE_04E0E6
	STZ.w $6072
	LDA.b !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$0080
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	BRA.b CODE_04E0FC

CODE_04E0E6:
	LDA.w $60C0
	BNE.b CODE_04E0F1
	LDA.w $6084
	STA.w $6072
CODE_04E0F1:
	LDA.w $60AA
	BPL.b CODE_04E0FC
	LDA.w $6084
	TSB.w $6070
CODE_04E0FC:
	INC.w $60CC
	LDX.b #FXCODE_0BC6EF>>16
	LDA.w #FXCODE_0BC6EF
	JSL.l !RAM_YI_Global_RT_00DECF
	REP.b #$10
	RTS

CODE_04E10B:
CODE_player_state_04:                                  ; PlayerState04 (generic locked-input variant)
	LDA.w $61B2
	BMI.b CODE_04E13F
	LDA.w $60C0
	ORA.w $61D4
	BNE.b CODE_04E152
	LDA.w $617E
	CMP.w #$0002
	BCS.b CODE_04E125
	INC.w $617E
	BRA.b CODE_04E19A

CODE_04E125:
	LDA.w #$0080
	STA.w $61F6
	LDA.w $60B4
	CMP.w #$FF00
	BPL.b CODE_04E139
	LDA.w #$FF00
	STA.w $60B4
CODE_04E139:
	LDA.w #$0200
	JMP.w CODE_04E216

CODE_04E13F:
	LDA.w $0D27
	CMP.w #$0008
	BCS.b CODE_04E158
	LDA.w $61F6
	BEQ.b CODE_04E152
	LSR
	BNE.b CODE_04E152
	INC.w $0D27
CODE_04E152:
	LDA.w #$0000
	JMP.w CODE_04E216

CODE_04E158:
	STZ.w $0C1E
	LDA.w $60B0
	CMP.w #$00A0
	BPL.b CODE_04E1A8
	LDA.w $617E
	ORA.w $60C0
	ORA.w $61D4
	BEQ.b CODE_04E176
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CMP.w #$01D0
	BPL.b CODE_04E179
CODE_04E176:
	JMP.w CODE_04E205

CODE_04E179:
	LDA.w $60B4
	BEQ.b CODE_04E184
	LDA.w #$0040
	STA.w $61F6
CODE_04E184:
	LDA.w #$0002
	STA.w $60C4
	LDA.w $61F6
	BNE.b CODE_04E152
	LDA.w $60C0
	ORA.w $61D4
	BNE.b CODE_04E152
	DEC.w $617E
CODE_04E19A:
	LDA.w #$FA00
CODE_04E19D:
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	BRA.b CODE_04E152

CODE_04E1A8:
	CMP.w #$0120
	BMI.b CODE_04E1BA
	LDA.w #!Define_YI_GameMode0B                ; SMWC tweak $04E1AE: low byte of GameMode immediate. Default [$0B] (Welcome-Level intro); change to [$1F] together with $04E1B4 -> [$00] to skip Welcome and boot straight into 1-1.
	STA.w !RAM_YI_Global_CurrentGameMode
	LDA.w #!Define_YI_LevelID_WelcomeToYoshisIsland  ; SMWC tweak $04E1B4: low byte of Level ID immediate. Default [Welcome]; change to [$00] (level 1-1) -- see paired tweak $04E1AE.
	STA.w !RAM_YI_Level_CurrentLevelFromMapLo
	RTS

CODE_04E1BA:
	LDA.w $617E
	CMP.w #$FFFE
	BNE.b CODE_04E179
	LDA.w $60C0
	ORA.w $61D4
	BEQ.b CODE_04E1E3
	LDA.w $60B0
	CMP.w #$00C0
	BMI.b CODE_04E1DA
	LDA.w $6084
	ORA.w #$0100
	BRA.b CODE_04E216

CODE_04E1DA:
	LDA.w #$0040
CODE_04E1DD:
	STA.w $61F6
CODE_04E1E0:
	JMP.w CODE_04E152

CODE_04E1E3:
	LDA.w $60B0
	CMP.w #$00C0
	BMI.b CODE_04E1F0
	LDA.w #$FB00
	BRA.b CODE_04E19D

CODE_04E1F0:
	LDA.w $61F6
	BEQ.b CODE_04E213
	LSR
	BNE.b CODE_04E1E0
	LDA.w $60C4
	BEQ.b CODE_04E1E0
	STZ.w $60C4
	LDA.w #$0060
	BRA.b CODE_04E1DD

CODE_04E205:
	LDA.w $60B4
	CMP.w #$0100
	BMI.b CODE_04E213
	LDA.w #$0100
	STA.w $60B4
CODE_04E213:
	LDA.w #$0100
CODE_04E216:
	STA.w $6070
	STZ.w $6072
	JMP.w CODE_04F6A2

CODE_04E21F:
CODE_player_state_24:                                  ; PlayerState24
	LDA.w $6084
	STA.w $6070
	STZ.w $6072
	STZ.w $60D2
	LDA.w #$0001
	STA.w $61E6
	JSR.w CODE_04F6A2
	LDA.w $6180
	BEQ.b CODE_04E248
	DEC.w $6180
	CMP.w #$0040
	BCS.b CODE_04E247
	LDA.w #$004C
	STA.w $60BE
CODE_04E247:
	RTS

CODE_04E248:
	LDA.w $60C0
	BNE.b CODE_04E271
	LDA.w $61D4
	BNE.b CODE_04E295
	DEC.w $617E
	BPL.b CODE_04E25E
	LDA.w #!Define_YI_PlayerState02_InCutscene
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	RTS

CODE_04E25E:
	LDA.w #$FD00
	STA.w $60AA
	LDA.w #$00DA
	STA.w $60C0
	STA.w $6182
	STZ.w $60D2
	RTS

CODE_04E271:
	LDA.w $60AA
	CMP.w #$FF00
	BMI.b CODE_04E28F
	LDA.w $61D4
	BNE.b CODE_04E28F
	LDA.w #$0004
	STA.w $61D4
	LDA.w $6182
	CMP.w #$00DD
	BCS.b CODE_04E28F
	INC.w $6182
CODE_04E28F:
	LDA.w $6182
	STA.w $60BE
CODE_04E295:
	RTS

CODE_04E296:
CODE_player_state_20_entering_raphael_boss_room:       ; PlayerState20_EnteringRaphaelBossRoom
	SEP.b #$10
	LDX.b #FXCODE_0BC70A>>16
	LDA.w #FXCODE_0BC70A
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $617E
	BNE.b CODE_04E2B9
	LDA.w #!Define_YI_SoundID89_FallingToMoon
	JSL.l CODE_push_sound_queue
	LDA.w #$FA00
	STA.w $6180
	LDA.w #$0800
	STA.w $617E
CODE_04E2B9:
	SEC
	SBC.w #$0008
	CMP.w #$0100
	BCS.b CODE_04E2C5
	LDA.w #$0100
CODE_04E2C5:
	STA.w $617E
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0001
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_0A91C9>>16
	LDA.w #FXCODE_0A91C9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	STA.b $00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $6180
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_08B2B2>>16
	LDA.w #FXCODE_08B2B2
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $2FFF
	AND.w #$FF00
	STA.b $02
	LDA.w !REGISTER_SuperFX_R4_LMULTResultHi
	AND.w #$00FF
	ORA.b $02
	STA.w $60A8
	LDA.w #$FC00
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_08B2B2>>16
	LDA.w #FXCODE_08B2B2
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $2FFF
	AND.w #$FF00
	STA.b $02
	LDA.w !REGISTER_SuperFX_R4_LMULTResultHi
	AND.w #$00FF
	ORA.b $02
	STA.w $60AA
	LDA.w $6180
	CLC
	ADC.w #$0008
	STA.w $6180
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7974
	ASL
	ASL
	ASL
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #FXDATA_540000+$0040
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$0040)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$0164
	STA.w $60BE
	LDA.w !RAM_YI_Level_CurrentYoshiColorLo
	ASL
	TAX
	LDA.l DATA_yoshi_palette_ptrs,x
	CLC
	ADC.w #DATA_master_palette_rom_blob
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_master_palette_rom_blob>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.b $00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$00D1
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08E167>>16
	LDA.w #FXCODE_08E167
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDY.b #$0A
	LDX.b #$40
	LDA.w $60B2
	CMP.w #$FF80
	BPL.b CODE_04E3BD
	LDA.w !RAM_YI_Level_CurrentYoshiColorLo
	ASL
	STA.w $6116
	JSL.l CODE_04FB41
	LDA.w #!Define_YI_PlayerState02_InCutscene
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$0140
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w #$0000
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDY.b #$2A
	LDX.b #$00
CODE_04E3BD:
	STY.w $7042
	STX.w $70E0
	REP.b #$10
	RTS

CODE_04E3C6:
CODE_player_state_1E_pushed_away_by_raphael:           ; PlayerState1E_PushedAwayByRaphael
	SEP.b #$10
	LDX.b #FXCODE_0BC70A>>16
	LDA.w #FXCODE_0BC70A
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b #FXCODE_0BC6F7>>16
	LDA.w #FXCODE_0BC6F7
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDA.w $60FC
	AND.w #$0180
	BEQ.b CODE_04E3EC
	LDA.w #$0800
	LDY.w #$FC00
	BRA.b CODE_04E3FA

CODE_04E3EC:
	LDA.w $60FC
	AND.w #$0060
	BEQ.b CODE_04E400
	LDA.w #$FC00
	LDY.w #$F800
CODE_04E3FA:
	STA.w $60A8
	STY.w $60AA
CODE_04E400:
	LDA.w $60B2
	CMP.w #$FFC0
	BPL.b CODE_04E40C
	JSL.l CODE_02A4B5
CODE_04E40C:
	LDA.w #$006B
	STA.w $60BE
	RTS

CODE_04E413:
CODE_player_state_0C:                                  ; PlayerState0C
	LDA.w $60B0
	CMP.w #$0020
	BMI.b CODE_04E41E
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
CODE_04E41E:
	LDA.w #$0300
	STA.w $60B4
	LDA.w #$0100
	STA.w $6070
	STZ.w $6072
	JSR.w CODE_04F6A2
	LDA.w #$000F
	TRB.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	RTS

DATA_04E437:
	dw $0080,$FF80

DATA_04E43B:
	dw $0008,$0006

DATA_04E43F:
	dw $0100,$F400,$0100

DATA_04E445:
	dw $FF00,$0011,$0012,$0011,$010C,$010D,$010E,$010F
	dw $0101,$0102,$0103,$0104,$0105,$0106,$0107,$0108

DATA_04E465:
	dw $0109,$010A

DATA_04E469:
	dw $010B,$0000

DATA_04E46D:
	dw $000E,$0007,$000B,$0006,$0004

DATA_04E477:
	dw $0001,$FFFF

DATA_04E47B:
	dw $FFFE,$0002,$FFE1,$001F,$0000

DATA_04E485:
	dw $0000,$0000,$0000,$FFE1,$001F

CODE_04E48F:
CODE_player_state_06:                                  ; PlayerState06
	LDA.w $60A8
	ORA.w $60AA
	ORA.w $60C0
	BNE.b CODE_04E4B1
	LDA.w #!Define_YI_SoundID31_EnterPipe
	LDY.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CPY.w #$000D
	BNE.b CODE_04E4AD
	LDY.w $6106
	BMI.b CODE_04E4B1
	LDA.w #!Define_YI_SoundID14_Gulp
CODE_04E4AD:
	JSL.l CODE_push_sound_queue
CODE_04E4B1:
	INC.w $61B4
	SEP.b #$10
	LDY.w $6106
	CPY.b #$06
	BCS.b CODE_04E4C0
	JMP.w CODE_04E589

CODE_04E4C0:
	STZ.w $60B4
	STZ.w $60A8
	BIT.w $6106
	BVC.b CODE_04E511
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	AND.w #$000F
	CMP.w #$0008
	BEQ.b CODE_04E4E6
	LDX.b #$00
	BCC.b CODE_04E4DC
	LDX.b #$02
CODE_04E4DC:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_04E477,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_04E4E6:
	LDA.w $6106
	AND.w #$A000
	CMP.w #$8000
	BNE.b CODE_04E4FC
	LDA.w DATA_04E437-$02,y
	STA.w $60C0
	LDA.w DATA_04E43B-$02,y
	BRA.b CODE_04E505

CODE_04E4FC:
	LDA.w #$0112
	STA.w $60C0
	LDA.w DATA_04E43F-$02,y
CODE_04E505:
	STA.w $60AA
	BPL.b CODE_04E50E
	EOR.w #$FFFF
	INC
CODE_04E50E:
	JMP.w CODE_04E5A2

CODE_04E511:
	LDX.w $60C4
	LDA.w $610E
	CLC
	ADC.w DATA_04E47B,x
	LDX.b #$00
	CMP.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BEQ.b CODE_04E530
	BPL.b CODE_04E526
	LDX.b #$02
CODE_04E526:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_04E477,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_04E530:
	LDA.w $61F6
	BNE.b CODE_04E546
	LDA.w $610A
	CMP.w DATA_04E469,y
	BEQ.b CODE_04E546
	INC.w $610A
	LDA.w DATA_04E46D,y
	STA.w $61F6
CODE_04E546:
	LDA.w $610A
	ASL
	ADC.w DATA_04E465,y
	TAX
	LDA.w DATA_04E445,x
	STA.w $60C0
	STZ.w $60C2
	LDA.w $0030
	AND.w #$0001
	BNE.b CODE_04E56B
	LDA.w $610C
	ASL
	BCC.b CODE_04E568
	LDA.w #$FFFF
CODE_04E568:
	STA.w $610C
CODE_04E56B:
	LDA.w $610C
	XBA
	AND.w #$00FF
	CPY.b #$06
	BEQ.b CODE_04E57A
	EOR.w #$FFFF
	INC
CODE_04E57A:
	CLC
	ADC.w $60AA
	STA.w $60AA
	BPL.b CODE_04E5A2
	EOR.w #$FFFF
	INC
	BRA.b CODE_04E5A2

CODE_04E589:
	STZ.w $60AA
	LDX.b #$00
	LDA.w DATA_04E437-$02,y
	STA.w $60B4
	STA.w $60A8
	BPL.b CODE_04E59F
	LDX.b #$02
	EOR.w #$FFFF
	INC
CODE_04E59F:
	STX.w $60C4
CODE_04E5A2:
	CLC
	ADC.w $6108
	STA.w $6108
	CMP.w #$1F00
	BCS.b CODE_04E5B1
	JMP.w CODE_04E644

CODE_04E5B1:
	BIT.w $6106
	BVC.b CODE_04E5D9
	LDA.w $60AA
	CMP.w #$FF00
	BPL.b CODE_04E5C6
	LDA.w #!Define_YI_PlayerState2A
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	BRA.b CODE_04E5D7

CODE_04E5C6:
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDA.w $60C0
	BEQ.b CODE_04E5D7
	LDA.w #$0008
	STA.w $60C0
CODE_04E5D7:
	BRA.b CODE_04E64C

CODE_04E5D9:
	LDA.w $6106
	AND.w #$2000
	BEQ.b CODE_04E620
	LDA.w #!Define_YI_PlayerState08
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0038
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDA.w #$0000
	LDY.w !REGISTER_SuperFX_R6_MultiplierHi
	CPY.b #$3D
	BEQ.b CODE_04E60D
	LDA.w #$0002
CODE_04E60D:
	STA.w $6106
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0008
	AND.w #$FFF0
	DEC
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	BRA.b CODE_04E65E

CODE_04E620:
	LDY.w $6106
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_04E47B+$02,y
	XBA
	AND.w #$000F
	ASL
	ASL
	STA.b $00
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_04E485,y
	AND.w #$0F00
	LSR
	LSR
	ORA.b $00
	JSL.l CODE_02A4CB
CODE_04E644:
	LDA.w #$0010
	BIT.w $6106
	BPL.b CODE_04E64F
CODE_04E64C:
	LDA.w #$0020
CODE_04E64F:
	STA.w $6126
	JSR.w CODE_04E661
	LDX.b #FXCODE_0BC6DA>>16
	LDA.w #FXCODE_0BC6DA
	JSL.l !RAM_YI_Global_RT_00DECF
CODE_04E65E:
	REP.b #$10
	RTS

CODE_04E661:
	LDA.w $7042
	AND.w #$00CF
	ORA.w $6126
	STA.w $7042
	LDX.w $7DF6
	BEQ.b CODE_04E685
CODE_04E672:
	LDY.w $7DF6,x
	LDA.w $7042,y
	AND.w #$00CF
	ORA.w $6126
	STA.w $7042,y
	DEX
	DEX
	BNE.b CODE_04E672
CODE_04E685:
	RTS

DATA_04E686:
	dw $007C,$008C

DATA_04E68A:
	dw $0004,$FFFC

DATA_04E68E:
	dw $FFF1,$0000

DATA_04E692:
	dw $3D35,$3D2F

CODE_04E696:
CODE_player_state_08:                                  ; PlayerState08
	STZ.w $60C0
	INC.w $61B4
	SEP.b #$10
	LDY.w $6106
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_04E68A,y
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_04E68E,y
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDY.w $6106
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w DATA_04E692,y
	BNE.b CODE_04E748
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$7D24
	BNE.b CODE_04E729
	LDX.w $7DF6
	BEQ.b CODE_04E6FD
	LDY.w $7DF6,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr027_Key
	BEQ.b CODE_04E708
CODE_04E6FD:
	LDA.w $6106
	EOR.w #$0002
	STA.w $6106
	BRA.b CODE_04E748

CODE_04E708:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.b $91
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0008
	STA.b $93
	LDA.w #$0001
	STA.w $008F
	LDA.w #$7D22
	STA.w $0095
	JSL.l CODE_change_map16
	INC.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
CODE_04E729:
	LDA.w #!Define_YI_PlayerState06
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$E008
	STA.w $6106
	STZ.w $6108
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0008
	AND.w #$FFF0
	DEC
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	BRA.b CODE_04E74B

CODE_04E748:
	STZ.w $611A
CODE_04E74B:
	JSR.w CODE_04E751
	REP.b #$10
	RTS

CODE_04E751:
	LDX.w $611A
	DEX
	TXY
	BMI.b CODE_04E75C
	LDX.b #$04
	LDY.b #$05
CODE_04E75C:
	STX.w $74A2
	TYA
	LDX.w $7DF6
	BEQ.b CODE_04E76F
CODE_04E765:
	LDY.w $7DF6,x
	STA.w $74A2,y
	DEX
	DEX
	BNE.b CODE_04E765
CODE_04E76F:
	RTS

CODE_04E770:
CODE_player_state_2A:                                  ; PlayerState2A
	STZ.w $617A
	STZ.w $617C
	LDA.w $60C0
	BNE.b CODE_player_state_02_in_cutscene
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	RTS

CODE_04E782:
CODE_player_state_02_in_cutscene:                      ; PlayerState02_InCutscene
	LDA.w $617A
	STA.w $6070
	LDA.w $617C
	STA.w $6072
	JMP.w CODE_04F6A2

DATA_04E791:
	dw FXDATA_540000+$60A0,FXDATA_540000+$2060,FXDATA_540000+$00A0,FXDATA_540000+$2000,FXDATA_540000+$00C0,FXDATA_540000+$0000

CODE_04E79D:
CODE_player_state_18_sent_towards_baby_mario:          ; PlayerState18_SentTowardsBabyMario
	STZ.w $61B6
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDA.w $61F4
	BEQ.b CODE_04E7BD
	LSR
	BNE.b CODE_04E7BA
	LDA.w $0C88
	BEQ.b CODE_04E7BA
	LDA.w #!Define_YI_SoundID7D_YoshiLostChallenge
	JSL.l CODE_push_sound_queue
CODE_04E7BA:
	JMP.w CODE_04E8AB

CODE_04E7BD:
	STZ.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	SEP.b #$10
	LDA.w #$0186
	STA.w $60BE
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $0C84
	CLC
	ADC.w #$0010
	AND.w #$00FF
	STA.w $0C84
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $0C8A
	LDA.w DATA_04E791-$02,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$0000)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $70E2
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7182
	SEC
	SBC.w #$0010
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0800
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $60A8
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w $60AA
	LDX.b #FXCODE_0BC70A>>16
	LDA.w #FXCODE_0BC70A
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDA.w $70E2
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BEQ.b CODE_04E855
	EOR.w $60A8
	BPL.b CODE_04E8AB
	LDA.w $70E2
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_04E855:
	LDA.w $7182
	SEC
	SBC.w #$0010
	STA.b $00
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	BEQ.b CODE_04E86E
	EOR.w $60AA
	BPL.b CODE_04E8AB
	LDA.b $00
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_04E86E:
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	JSL.l CODE_04EF27
	STZ.w $0C8A
	STZ.w $6150
	STZ.w $60C6
	LDA.w #$0003
	STA.w $60C2
	STZ.w $60B4
	STZ.w $60A8
	STZ.w $60AA
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	STZ.w $6112
	LDA.w #FXDATA_520000+$BC00
	STA.w $6114
	SEP.b #$30
	LDX.w $0BF1
	BEQ.b CODE_04E8A9
CODE_04E8A0:
	STZ.w $0BF1,x
	DEX
	BNE.b CODE_04E8A0
	STZ.w $0BF1
CODE_04E8A9:
	REP.b #$30
CODE_04E8AB:
	RTS

CODE_04E8AC:
CODE_player_state_16_level_intro:                      ; PlayerState16_LevelIntro
	LDA.w $6084
	STA.w $6070
	STZ.w $6072
	STZ.w $60D2
	LDA.w #$0001
	STA.w $61E6
	SEP.b #$10
	LDX.b #FXCODE_0BC703>>16
	LDA.w #FXCODE_0BC703
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $60AA
	BMI.b CODE_04E8EA
	LDA.b !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$0094
	CMP.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	BCS.b CODE_04E8EA
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $60C0
	BEQ.b CODE_04E8EA
	STZ.w $60C0
	LDA.w #$0005
	STA.w $61D4
CODE_04E8EA:
	INC.w $60CC
	LDX.b #FXCODE_0BC6EF>>16
	LDA.w #FXCODE_0BC6EF
	JSL.l !RAM_YI_Global_RT_00DECF
	REP.b #$10
	RTS

DATA_04E8F9:
	dw $0003,$FFFD,$0010,$FFF0,$0100,$FF00

CODE_04E905:
CODE_player_state_12_smushed_by_wall:                  ; PlayerState12_SmushedByWall
	LDY.w $7E40
	BEQ.b CODE_04E90D
	JMP.w CODE_04E9D0

CODE_04E90D:
	SEP.b #$10
	LDY.w $0CBC
	BNE.b CODE_04E944
	LDA.w #!Define_YI_SoundID7D_YoshiLostChallenge
	JSL.l CODE_push_sound_queue
	LDY.w $60C4
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_04E8F9,y
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0008
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $0CBB
	INC.w $0CBC
	STZ.w $0CBE
	LDA.w #$007F
	STA.w $0CC0
	JMP.w CODE_04E9C0

CODE_04E944:
	CPY.b #$38
	BCC.b CODE_04E96C
	LDA.w $60AA
	CLC
	ADC.w #$0008
	CMP.w #$0080
	BMI.b CODE_04E957
	LDA.w #$0080
CODE_04E957:
	STA.w $60AA
	LDX.b #FXCODE_0BC711>>16
	LDA.w #FXCODE_0BC711
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b #FXCODE_0BC6F7>>16
	LDA.w #FXCODE_0BC6F7
	JSL.l !RAM_YI_Global_RT_00DECF
CODE_04E96C:
	LDA.w $0CBC
	CMP.w #$0079
	BNE.b CODE_04E982
	LDA.w #!Define_YI_PlayerState00_Normal
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $61B6
	STA.w $0D94
	BRA.b CODE_04E998

CODE_04E982:
	LDA.w $0CBE
	CMP.w #$0180
	BEQ.b CODE_04E991
	CLC
	ADC.w #$0010
	STA.w $0CBE
CODE_04E991:
	CLC
	ADC.w $0CBB
	STA.w $0CBB
CODE_04E998:
	LDA.w $0CBC
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #(FXDATA_540000+$40E0)>>16
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #FXDATA_540000+$40E0
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #FXDATA_540000+$6060
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w $0CC0
	XBA
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_08C136>>16
	LDA.w #FXCODE_08C136
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_04E9C0:
	LDA.w #$0196
	LDY.w $0CBC
	CPY.b #$68
	BCS.b CODE_04E9CD
	LDA.w #$0197
CODE_04E9CD:
	JMP.w CODE_04EA92

CODE_04E9D0:
	STZ.w $0CBC
	LDA.w $0CBA
	BPL.b CODE_04E9DD
	LDA.w #FXDATA_540000+$0080
	BRA.b CODE_04EA3A

CODE_04E9DD:
	LDY.w $0CB4
	DEY
	BNE.b CODE_04EA37
	CLC
	ADC.w #$0004
	XBA
	STA.w !REGISTER_DividendLo
	LDA.w #$001C
	STA.w !REGISTER_Divisor
	NOP #7
	REP.b #$20
	LDA.w !REGISTER_QuotientLo
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$001F
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #FXDATA_540000+$40E0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$40E0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	SEP.b #$10
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$0164
	BRA.b CODE_04EA92

CODE_04EA37:
	LDA.w #FXDATA_540000+$40E0
CODE_04EA3A:
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #(FXDATA_540000+$40E0)>>16
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w $7E46
	LDY.w $60C4
	BNE.b CODE_04EA4F
	EOR.w #$FFFF
	INC
CODE_04EA4F:
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$FFA0
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $0CB8
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7E40
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	SEP.b #$10
	LDX.b #FXCODE_08C045>>16
	LDA.w #FXCODE_08C045
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $6000
	LDY.w $60C4
	BNE.b CODE_04EA7E
	EOR.w #$FFFF
	INC
CODE_04EA7E:
	CLC
	ADC.w $7E42
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $0CB6
	CLC
	ADC.w $6002
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$0195
CODE_04EA92:
	STA.w $60BE
	REP.b #$10
	RTS

DATA_04EA98:
	db $E0,$5F,$20,$0B,$0F,$0F,$13,$0B,$0F,$0F,$14,$0B,$0F,$0F,$14,$0B
	db $0F,$0F,$13,$0A,$0F,$0F,$12,$09,$12,$16,$18,$08,$13,$15,$19,$02
	db $04,$08,$19,$01,$0E,$0E,$19,$00,$0E,$0E,$19,$00,$0E,$0E,$18,$00
	db $0E,$0E,$18,$00,$0E,$0E,$19,$00,$0F,$0F,$1B,$01,$10,$10,$1C,$01
	db $10,$10,$1E,$02,$10,$10,$1E,$04,$11,$11,$1E,$04,$11,$11,$1E,$04
	db $11,$11,$1E,$03,$10,$10,$1E,$02,$10,$10,$1E,$02,$10,$10,$1E,$02
	db $0F,$0F,$1E,$02,$0F,$0F,$1E,$03,$13,$19,$1E,$03,$12,$1A,$1F,$04
	db $11,$1B,$1F,$05,$11,$1C,$1E,$09,$10,$10,$11,$0A,$10,$10,$10,$0B
	db $0C,$0E,$0F

DATA_04EB1B:
	db $C0,$77,$15,$03,$10,$10,$1E,$02,$10,$10,$1E,$02,$10,$10,$1F,$01
	db $0F,$0F,$1F,$01,$0F,$0F,$1F,$00,$0F,$0F,$1E,$00,$0F,$0F,$1E,$00
	db $0F,$0F,$1F,$01,$0F,$0F,$1F,$01,$0F,$0F,$1F,$02,$0F,$0F,$1E,$03
	db $0F,$0F,$1E,$05,$0F,$0F,$1D,$08,$0F,$0F,$1C,$08,$0F,$0F,$1B,$08
	db $0F,$0F,$19,$09,$0E,$0E,$16,$09,$0E,$0E,$14,$0A,$0E,$0E,$13,$0B
	db $0E,$0E,$12,$0C,$0D,$0F,$11

DATA_04EB72:
	db $E0,$7F,$16,$00,$07,$09,$1D,$00,$14,$14,$1E,$00,$14,$14,$1F,$00
	db $14,$14,$1F,$01,$14,$14,$1F,$01,$14,$14,$1F,$02,$14,$14,$1E,$01
	db $13,$13,$1E,$01,$12,$12,$1D,$01,$11,$11,$1D,$01,$10,$10,$1D,$01
	db $0F,$0F,$1C,$02,$0F,$0F,$1C,$03,$0F,$0F,$1B,$05,$0F,$0F,$1A,$09
	db $0F,$0F,$19,$09,$0F,$0F,$17,$0A,$11,$13,$14,$13,$14,$14,$16,$13
	db $14,$14,$14,$13,$13,$15,$16,$13,$13,$13,$13

DATA_04EBCD:
	db $20,$17,$18,$0A,$0E,$0E,$0F,$07,$0F,$0F,$13,$05,$15,$1C,$1D,$04
	db $17,$1B,$1D,$03,$18,$1B,$1D,$02,$12,$12,$1D,$02,$12,$12,$1E,$01
	db $12,$12,$1F,$01,$12,$12,$1F,$01,$12,$12,$1F,$02,$12,$12,$1F,$02
	db $11,$11,$1D,$03,$19,$1B,$1E,$04,$17,$1B,$1E,$06,$15,$1B,$1E,$09
	db $17,$1C,$1D,$09,$0F,$0F,$18,$09,$0F,$0F,$17,$0A,$0F,$0F,$15,$0B
	db $0E,$0E,$14,$11,$12,$12,$13,$0F,$12,$12,$13,$0F,$11,$11,$13,$0F
	db $10,$10,$12

DATA_04EC30:
	db $A0,$1B,$18,$04,$11,$11,$19,$03,$11,$11,$1A,$02,$11,$11,$19,$02
	db $0C,$0E,$15,$02,$04,$06,$14,$05,$11,$11,$14,$04,$12,$12,$14,$03
	db $03,$05,$15,$02,$13,$13,$16,$02,$13,$13,$16,$02,$17,$1A,$1D,$02
	db $19,$1E,$1E,$03,$1B,$1E,$1E,$04,$1D,$1F,$1F,$05,$1D,$1F,$1F,$06
	db $1D,$1F,$1F,$06,$13,$18,$1F,$06,$13,$1B,$1E,$06,$13,$1E,$1E,$07
	db $13,$1A,$1D,$08,$0A,$0C,$13,$08,$15,$17,$1B,$10,$11,$11,$13,$11
	db $11,$11,$12

DATA_04EC93:
	db $00,$3E,$1E,$0D,$11,$15,$19,$04,$12,$14,$1A,$04,$12,$14,$1A,$05
	db $12,$14,$1A,$06,$12,$14,$1A,$05,$11,$11,$1C,$05,$11,$11,$1C,$04
	db $11,$11,$1C,$03,$11,$11,$1C,$03,$11,$11,$1A,$03,$11,$11,$1A,$03
	db $11,$11,$1A,$03,$11,$11,$1A,$03,$11,$11,$1A,$02,$11,$11,$1A,$02
	db $11,$11,$1A,$02,$11,$11,$1A,$02,$15,$17,$1A,$02,$16,$18,$1A,$02
	db $15,$17,$1A,$02,$10,$10,$1A,$03,$0F,$0F,$1A,$07,$0E,$0E,$1B,$06
	db $0E,$0E,$1B,$06,$0F,$0F,$1B,$06,$0F,$0F,$1A,$06,$0F,$0F,$18,$06
	db $0E,$0E,$0F,$07,$0D,$0D,$0E,$08,$0D,$0D,$0D

DATA_04ED0E:
	db $80,$5F,$16,$0D,$0F,$0F,$12,$0B,$0F,$0F,$14,$0A,$0F,$0F,$15,$09
	db $0F,$0F,$16,$09,$0F,$0F,$16,$09,$0F,$0F,$16,$09,$0F,$0F,$15,$0A
	db $0F,$0F,$14,$08,$0F,$0F,$16,$06,$0F,$0F,$19,$05,$0F,$0F,$1A,$04
	db $0F,$0F,$1B,$04,$0F,$0F,$1B,$04,$0F,$0F,$1B,$05,$0F,$0F,$1A,$05
	db $0F,$0F,$1A,$06,$0F,$0F,$19,$07,$0F,$0F,$18,$08,$0F,$0F,$17,$09
	db $0F,$0F,$16,$0B,$0F,$0F,$15,$0D,$0F,$0F,$12

DATA_04ED69:
	dw DATA_04EA98,DATA_04EB1B,DATA_04EB72,DATA_04EC30,DATA_04EC93,DATA_04ED0E,DATA_04EBCD

DATA_04ED77:
	dw $0000,$016B,$0178,$0181,$0186,$0182,$0171,$000A
	dw $0004,$03FF,$023F,$001F,$4010,$7C00,$7E00,$47E0
	dw $03F4,$03FF,$031F,$021F,$011F,$001F,$2018,$4010
	dw $6008,$7C00,$7D00,$7E00,$6300,$47E0,$23EA,$03F4
	dw $03FA

DATA_04EDB9:
	dw $000C,$0006

CODE_04EDBD:					; Note: Yoshi transforming state.
CODE_player_state_10_transforming:                     ; PlayerState10_Transforming (helicopter/sub/etc.)
	LDA.w #$00FF
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	STA.w $7E0A
	LDY.w $614E
	BNE.b CODE_04EDCC
	RTS

CODE_04EDCC:
	DEY
	DEY
	DEY
	BPL.b CODE_04EDD4
	JMP.w CODE_04EE63

CODE_04EDD4:
	BNE.b CODE_04EE0E
	LDA.l $70336C
	CMP.w #$0020
	BCC.b CODE_04EDF0
	LDA.w #$FF80
CODE_04EDE2:
	STA.w $0C86
	LDA.w #$0000
	STA.l $70336C
	INC.w $614E
	RTS

CODE_04EDF0:
	LDA.w #$2D6C
	LDY.w #$2F6C
CODE_04EDF6:
	STA.l $70336E
	TYA
	STA.l $703370
	SEP.b #$10
	LDX.b #FXCODE_08B4A9>>16
	LDA.w #FXCODE_08B4A9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	BRA.b CODE_04EE63

CODE_04EE0E:
	DEY
	BNE.b CODE_04EE40
	LDA.w #!Define_YI_SoundID70_Transforming
	JSL.l CODE_push_sound_queue
	SEP.b #$10
	LDA.w #!Define_YI_AmbSpr1C2
	JSL.l CODE_spawn_ambient_sprite
	LDX.w $60C4
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_04EDB9,x
	STA.w $70A2,y
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w $7142,y
	LDA.w #$00F0
	STA.w $7782,y
	REP.b #$10
	INC.w $614E
	RTS

CODE_04EE40:
	DEY
	BNE.b CODE_04EE98
	LDA.w $0C86
	CMP.w #$0100
	BMI.b CODE_04EE57
	LDX.w $0C88
	STX.w $0C8A
	LDA.w #$0000
	JMP.w CODE_04EDE2

CODE_04EE57:
	LDA.w $0C86
	CLC
	ADC.w #$0002
	STA.w $0C86
	BPL.b CODE_04EE66
CODE_04EE63:
	LDA.w #$0000
CODE_04EE66:
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.w $0C8A
	LDA.w DATA_04ED69,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.w $0C88
	LDA.w DATA_04ED69,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #DATA_04EA98>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STZ.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	SEP.b #$10
	LDX.b #FXCODE_08BA44>>16
	LDA.w #FXCODE_08BA44
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
CODE_04EE97:
	RTS

CODE_04EE98:
	LDA.l $70336C
	CMP.w #$0020
	BCS.b CODE_04EEAD
	LDA.w #$2F6C
	LDY.w #$2D6C
	JSR.w CODE_04EDF6
	JMP.w CODE_04EE97

CODE_04EEAD:
	LDA.w #$0000
	STA.l $70336C
	STZ.w $614E
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDA.w #!Define_YI_PlayerState00_Normal
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $60B4
	STZ.w $60A8
	STZ.w $60AA
	STZ.w $60D4
	LDX.w $0C8A
	STX.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	BEQ.b CODE_04EEDF
	LDA.w #$0500
	STA.w $61F4
	STZ.w $60C6
	BRA.b CODE_04EEDF

CODE_04EEDF:
	LDA.w DATA_04ED77,x
	STA.w $60BE
	JSL.l CODE_04EF27
	JMP.w (DATA_transform_finalize_ptr,x)

CODE_04EEEC:
	TXY
	STA.b $00
	ASL
	STA.b $02
	STA.b $04
	LDA.w #$706000
CODE_04EEF7:
	STA.w $6128,x
	CLC
	ADC.w #$0200
	STA.w $612A,x
	CLC
	ADC.w #$0200
	INX
	INX
	INX
	INX
	DEC.b $00
	BNE.b CODE_04EF10
	LDA.w #$6040
CODE_04EF10:
	DEC.b $02
	BNE.b CODE_04EEF7
	SEP.b #$20
	LDA.b #$706000>>16
	TYX
CODE_04EF19:
	STA.w $612A,x
	INX
	INX
	INX
	INX
	DEC.b $04
	BNE.b CODE_04EF19
	REP.b #$20
	RTS

CODE_04EF27:
	PHP
	REP.b #$30
	PHX
	STZ.w $60D4
	STZ.w $60DE
	STZ.w $61D0
	STZ.w $60C2
	STZ.w $60F8
	LDX.w #$002E
CODE_04EF3D:
	STZ.w $617E,x
	DEX
	DEX
	BPL.b CODE_04EF3D
	PLX
	PLP
	RTL

DATA_04EF47:
DATA_transform_finalize_ptr:                           ; 7-entry dispatch keyed on new $0C8A (PlayerForm)
                                                  ; (see Constants/PlayerStates.asm PlayerForm*)
	dw CODE_transform_finalize_yoshi_or_mushroom_noop                                ;  $00 Yoshi (no-op)
	dw CODE_transform_finalize_car_full_reset                                ;  $02 Car (full RAM scrub)
	dw CODE_transform_finalize_mole                                ;  $04 Mole
	dw CODE_transform_finalize_helicopter                                ;  $06 Helicopter
	dw CODE_transform_finalize_train                                ;  $08 Train (preserve $617E sign)
	dw CODE_transform_finalize_yoshi_or_mushroom_noop                                ;  $0A Mushroom (no-op)
	dw CODE_transform_finalize_submarine                                ;  $0C Submarine

CODE_04EF55:
CODE_transform_finalize_yoshi_or_mushroom_noop:        ; Forms $00 / $0A finalize (no-op)
	RTS

CODE_04EF56:
	JSR.w CODE_transform_finalize_car_full_reset
	JMP.w CODE_04EFA8

CODE_04EF5C:
CODE_transform_finalize_car_full_reset:                ; Form $02 Car: clear all transform state vars
	STZ.w $617E
	STZ.w $6180
	STZ.w $6182
	STZ.w $6184
	STZ.w $6186
	STZ.w $6188
	STZ.w $6112
	STZ.w $618A
	LDA.w #$0100
	STA.w $618C
	STZ.w $618E
	STZ.w $6190
	STZ.w $60FC
	STZ.w $6192
	STZ.w $6194
	STZ.w $6196
	STZ.w $619E
	STZ.w $61A0
	STZ.w $61A2
	STZ.w $61A4
	STZ.w $61A6
	STZ.w $61A8
	STZ.w $61AA
	STZ.w $61AC
	STZ.w $61E4
	RTS

CODE_04EFA8:
	STZ.w $6070
	STZ.w $6072
	JSR.w CODE_04F6A2
	RTL

CODE_04EFB2:
CODE_transform_finalize_helicopter:                    ; Form $06 Helicopter
	STZ.w $617E
	STZ.w $6182
	STZ.w $6184
	STZ.w $61F6
	RTS

CODE_04EFBF:
CODE_transform_finalize_submarine:                     ; Form $0C Submarine
	STZ.w $617E
	RTS

CODE_04EFC3:
CODE_transform_finalize_mole:                          ; Form $04 Mole
	STZ.w $617E
	STZ.w $6182
	STZ.w $6184
	STZ.w $6180
	STZ.w $618A
	RTS

CODE_04EFD3:
CODE_transform_finalize_train:                         ; Form $08 Train (preserve direction bit in $617E)
	LDA.w $60C4
	BEQ.b CODE_04EFDB
	LDA.w #$8000
CODE_04EFDB:
	STA.w $617E
	STZ.w $6180
	STZ.w $618A
	STZ.w $6184
	STZ.w $6186
	LDA.w #$0100
	STA.w $6182
	RTS

CODE_04EFF1:
	LDA.w $61F4
	SEC
	SBC.w #$0020
	BCC.b CODE_04F00E
	CMP.w #$00C0
	BCS.b CODE_04F04C
	INC
	AND.w #$003F
	BNE.b CODE_04F04C
	LDA.w #!Define_YI_SoundID7F_SwitchTimerEnding
	JSL.l CODE_push_sound_queue
	BRA.b CODE_04F04C

CODE_04F00E:
	LDA.w #!Define_YI_PlayerState18_SentTowardsBabyMario
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $0C84
	SEP.b #$10
	LDA.w #!Define_YI_AmbSpr1E1
	JSL.l CODE_spawn_ambient_sprite
	TYX
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0008
	STA.w $70A2,x
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0014
	STA.w $7142,x
	LDA.w #$000B
	STA.w $7E4C,x
	LDA.w #$00FF
	STA.w $7E4E,x
	STZ.w $73C2,x
	LDA.w #$0002
	STA.w $7782,x
	REP.b #$10
CODE_04F04C:
	JMP.w CODE_04F690

CODE_04F04F:
	LDA.w $7FEA
	BEQ.b CODE_04F05D
	ASL
	ASL
	ORA.w $7FEC
	TAX
	JSR.w (DATA_transform_transition_ptr-$04,x)
CODE_04F05D:
	RTS

DATA_04F05E:
DATA_transform_transition_ptr:                         ; 14-entry table, indexed by ($7FEA<<2)|$7FEC, biased -$04
                                                  ; each entry steps a sub-stage of the transformation FX
	dw CODE_04F094                                ; +0
	dw CODE_04F0F3                                ; +1
	dw CODE_04F1EE                                ; +2
	dw CODE_04F0F9                                ; +3
	dw CODE_04F0F3                                ; +4
	dw CODE_04F0AE                                ; +5
	dw CODE_04F0F9                                ; +6
	dw CODE_04F0AE                                ; +7
	dw CODE_04F07A                                ; +8
	dw CODE_04F13B                                ; +9
	dw $0000                                      ; +A (skip)
	dw CODE_04F094                                ; +B
	dw $0000                                      ; +C (skip)
	dw CODE_04F07A                                ; +D

CODE_04F07A:
	STZ.w $7FEA
	LDA.w #$0000
	STA.l $70336C
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDA.w $7FEC
	EOR.w #$0002
	STA.w $7FEC
	RTS

CODE_04F094:
	JSR.w CODE_04F54B
	LDA.l $70336C
	INC
	STA.l $70336C
	CMP.w #$0010
	BCS.b CODE_04F0EF
	RTS

DATA_04F0A6:
	dw $7E6800,$7E6C00

DATA_04F0AA:
	dw $65A6,$6DA6

CODE_04F0AE:
	PHB
	PEA.w $7E4800>>8
	PLB
	PLB
	LDY.w $7E4800
	LDA.l $007FEA
	ASL
	TAX
	LDA.l DATA_04F0A6-$06,x
	STA.w $0000,y
	LDA.w #$0080
	STA.w $0002,y
	LDA.w #((!REGISTER_ReadFromVRAMPortLo&$0000FF)<<8)+$81
	STA.w $0003,y
	LDA.l DATA_04F0AA-$06,x
	STA.w $0005,y
	LDA.w #$7E6800>>16
	STA.w $0007,y
	LDA.w #$07C0
	STA.w $0008,y
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,y
	STA.w $7E4800
	PLB
CODE_04F0EF:
	INC.w $7FEA
	RTS

CODE_04F0F3:
	BRA.b CODE_04F0EF

DATA_04F0F5:
	dw $0002,$FFFE

CODE_04F0F9:
	LDX.w $7FEC
	LDA.l $70336C
	CLC
	ADC.w DATA_04F0F5,x
	AND.w #$001E
	STA.l $70336C
	BEQ.b CODE_04F0EF
	BIT.w #$0002
	BNE.b CODE_04F13A
	AND.w #$001C
	LSR
	STA.b $00
	LSR
	ADC.b $00
	ASL
	ADC.w #$0004
	TAX
	PHB
	PEA.w $70200A>>8
	PLB
	PLB
	LDY.w #$0004
CODE_04F129:
	LDA.l DATA_5FCB4A,x
	STA.w $70200A,y
	STA.w $702D76,y
	DEX
	DEX
	DEY
	DEY
	BPL.b CODE_04F129
	PLB
CODE_04F13A:
	RTS

CODE_04F13B:
	PHB
	PEA.w $7E65A6>>8
	PLB
	PLB
	LDX.w #$07BE
	LDY.w #$03FE
CODE_04F147:
	PHX
	LDA.w #$0010
	STA.b $00
	STA.b $02
CODE_04F14F:
	PHY
	LDA.w $7E6DA6,x
	TAY
	AND.w #$03FF
	CMP.w #$0180
	BCC.b CODE_04F161
	CMP.w #$0200
	BCC.b CODE_04F166
CODE_04F161:
	LDA.w #$01CE
	BRA.b CODE_04F16D

CODE_04F166:
	TYA
	AND.w #$C07F
	ORA.w #$2100
CODE_04F16D:
	PLY
	STA.w $7E71A6,y
	STA.w $7E75A6,y
	DEY
	DEY
	DEX
	DEX
	DEX
	DEX
	DEC.b $00
	BNE.b CODE_04F14F
	PLX
CODE_04F17F:
	PHY
	LDA.w $7E65A6,x
	TAY
	AND.w #$03FF
	CMP.w #$0180
	BCC.b CODE_04F191
	CMP.w #$0200
	BCC.b CODE_04F196
CODE_04F191:
	LDA.w #$01CE
	BRA.b CODE_04F19D

CODE_04F196:
	TYA
	AND.w #$C07F
	ORA.w #$2100
CODE_04F19D:
	PLY
	STA.w $7E71A6,y
	STA.w $7E75A6,y
	DEY
	DEY
	DEX
	DEX
	DEX
	DEX
	DEC.b $02
	BNE.b CODE_04F17F
	TXA
	AND.w #$FFBF
	TAX
	BPL.b CODE_04F147
	PLB
	LDA.w #(($7E71A6&$0000FF)<<8)+(!REGISTER_WriteToVRAMPortLo&$0000FF)
	LDY.w #$7E71A6>>8
	PHB
	PEA.w $7E4800>>8
	PLB
	PLB
	LDX.w $7E4800
	STA.w $0004,x
	TYA
	STA.w $0006,x
	LDA.w #$3400
	STA.w $0000,x
	LDA.w #$0180
	STA.w $0002,x
	LDA.w #$0800
	STA.w $0008,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,x
	STA.w $7E4800
	PLB
CODE_04F1EA:
	INC.w $7FEA
	RTS

CODE_04F1EE:
	BRA.b CODE_04F1EA

DATA_04F1F0:
	dw $0FFE,$07FE,$0FFE

CODE_04F1F6:
	LDA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	ORA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_ItemBeingUsed
	ORA.w $7E2A
	BEQ.b CODE_04F205
	RTL

CODE_04F205:
	LDA.w #!Define_YI_SoundID04_SpitOut
	JSL.l CODE_push_sound_queue
	INC.w $7FEA
	LDX.w $7FEC
	PHB
	PEA.w $705800>>8
	PLB
	PLB
	PHX
	LDA.l DATA_04F1F0+$02,x
	TAX
	LDY.w #$07FE
CODE_04F221:
	STZ.w $706800,x
	DEX
	DEX
	DEY
	DEY
	BPL.b CODE_04F221
	PLX
	LDA.l DATA_04F1F0,x
	TAY
	LDX.w #$07FE
CODE_04F233:
	LDA.l $7E5DA6,x
	STA.w $706800,y
	DEY
	DEY
	DEX
	DEX
	BPL.b CODE_04F233
	PLB
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	RTL

DATA_04F24B:
	db $00,$07,$01,$06,$00,$07,$02,$05,$01,$06,$00,$07,$03,$04,$02,$05
	db $01,$06,$00,$07,$04,$03,$03,$04,$02,$05,$01,$06,$00,$07,$05,$02
	db $04,$03,$03,$04,$02,$05,$01,$06,$00,$07,$06,$01,$05,$02,$04,$03
	db $03,$04,$02,$05,$01,$06,$00,$07,$07,$00,$06,$01,$05,$02,$04,$03
	db $00,$01,$02,$03,$04,$05,$06,$07,$07,$07,$07,$07,$07,$07,$07,$06
	db $05,$04,$03,$02,$01,$00,$00,$00,$00,$00,$00,$00,$01,$02,$03,$04
	db $05,$06,$06,$06,$06,$06,$06,$05,$04,$03,$02,$01,$01,$01,$01,$01
	db $02,$03,$04,$05,$05,$05,$05,$04,$03,$02,$02,$02,$03,$04,$04,$03
	db $00,$05,$02,$04,$03,$07,$01,$06,$02,$04,$01,$06,$00,$05,$04,$05
	db $03,$06,$03,$07,$00,$03,$04,$07,$01,$05,$01,$05,$00,$06,$01,$07
	db $02,$05,$03,$07,$02,$03,$03,$07,$01,$07,$02,$06,$02,$06,$00,$05
	db $02,$04,$02,$05,$00,$04,$01,$04,$00,$07,$03,$06,$00,$04,$01,$06
	db $00,$01,$02,$03,$04,$05,$06,$07,$07,$07,$07,$07,$07,$07,$07,$06
	db $05,$04,$03,$02,$01,$01,$01,$01,$01,$01,$02,$03,$04,$05,$05,$05
	db $05,$04,$03,$03,$04,$04,$03,$02,$02,$02,$02,$03,$04,$05,$06,$06
	db $06,$06,$06,$06,$05,$04,$03,$02,$01,$00,$00,$00,$00,$00,$00,$00
	db $03,$04,$00,$00,$03,$04,$07,$07,$02,$05,$00,$00,$02,$05,$07,$07
	db $03,$04,$01,$01,$03,$04,$06,$06,$01,$06,$00,$00,$01,$06,$07,$07
	db $02,$05,$01,$01,$02,$05,$06,$06,$03,$04,$02,$02,$03,$04,$05,$05
	db $00,$07,$00,$07,$01,$06,$01,$06,$02,$05,$02,$05,$03,$04,$03,$04
	db $03,$04,$00,$07,$03,$04,$00,$07,$02,$05,$01,$06,$03,$04,$00,$07
	db $02,$05,$01,$06,$03,$04,$00,$07,$01,$06,$02,$05,$02,$05,$01,$06
	db $03,$04,$00,$07,$01,$06,$02,$05,$02,$05,$01,$06,$03,$04,$00,$07
	db $00,$07,$00,$07,$01,$06,$01,$06,$02,$05,$02,$05,$03,$04,$03,$04

DATA_04F3CB:
	db $00,$07,$00,$07,$01,$06,$00,$07,$01,$06,$02,$05,$00,$07,$01,$06
	db $02,$05,$03,$04,$00,$07,$01,$06,$02,$05,$03,$04,$04,$03,$00,$07
	db $01,$06,$02,$05,$03,$04,$04,$03,$05,$02,$00,$07,$01,$06,$02,$05
	db $03,$04,$04,$03,$05,$02,$06,$01,$00,$07,$01,$06,$02,$05,$03,$04
	db $00,$00,$00,$00,$00,$00,$00,$00,$01,$02,$03,$04,$05,$06,$07,$07
	db $07,$07,$07,$07,$07,$07,$06,$05,$04,$03,$02,$01,$01,$01,$01,$01
	db $01,$01,$02,$03,$04,$05,$06,$06,$06,$06,$06,$06,$05,$04,$03,$02
	db $02,$02,$02,$02,$03,$04,$05,$05,$05,$05,$04,$03,$03,$03,$04,$04
	db $02,$05,$05,$01,$03,$07,$07,$03,$01,$06,$04,$01,$00,$02,$04,$00
	db $00,$06,$07,$04,$05,$02,$05,$02,$02,$07,$06,$03,$03,$07,$01,$03
	db $04,$01,$06,$01,$00,$04,$01,$05,$05,$00,$06,$00,$03,$05,$07,$04
	db $07,$02,$02,$06,$01,$03,$03,$07,$04,$06,$05,$02,$06,$00,$00,$04
	db $00,$00,$00,$00,$00,$00,$00,$00,$01,$02,$03,$04,$05,$06,$07,$07
	db $07,$07,$07,$07,$07,$06,$05,$04,$03,$02,$02,$02,$02,$02,$03,$04
	db $05,$05,$05,$04,$04,$03,$03,$03,$04,$05,$06,$06,$06,$06,$06,$05
	db $04,$03,$02,$01,$01,$01,$01,$01,$01,$01,$02,$03,$04,$05,$06,$07
	db $00,$00,$03,$04,$07,$07,$03,$04,$00,$00,$02,$05,$07,$07,$02,$05
	db $01,$01,$03,$04,$06,$06,$03,$04,$00,$00,$01,$06,$07,$07,$01,$06
	db $01,$01,$02,$05,$06,$06,$02,$05,$02,$02,$03,$04,$05,$05,$03,$04
	db $00,$07,$07,$00,$01,$06,$06,$01,$02,$05,$05,$02,$03,$04,$04,$03
	db $00,$00,$07,$07,$01,$01,$06,$06,$00,$00,$07,$07,$02,$02,$05,$05
	db $01,$01,$06,$06,$03,$03,$04,$04,$00,$00,$07,$07,$02,$02,$05,$05
	db $04,$04,$03,$03,$01,$01,$06,$06,$03,$03,$04,$04,$05,$05,$02,$02
	db $00,$00,$01,$01,$02,$02,$03,$03,$04,$04,$05,$05,$06,$06,$07,$07

CODE_04F54B:
	SEP.b #$10
	LDY.w $012D
	PHY
	LDY.b #$1A
	STY.w $012D
	LDY.w $012E
	PHY
	LDY.b #!SuperFX_ScreenMode_ScreenHeight_128pixels|!SuperFX_ScreenMode_ColorMode_16Colors|!SuperFX_ScreenMode_SuperFXHasWRAMAccess|!SuperFX_ScreenMode_SuperFXHasROMAccess|!SuperFX_ScreenMode_ColorMode_Unused
	STY.w $012E
	LDX.b #FXCODE_08BCE0>>16
	REP.b #$10
	LDA.l $70336C
	ASL
	ASL
	TAY
CODE_04F56A:
	LDA.w DATA_04F24B,y
	AND.w #$00FF
	STA.w $6000
	LDA.w DATA_04F3CB,y
	AND.w #$00FF
	STA.w $6002
	PHY
	SEP.b #$10
	LDA.w #FXCODE_08BCE0
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	PLY
	INY
	TYA
	AND.w #$0003
	BNE.b CODE_04F56A
	PHB
	PEA.w $7E4800>>8
	PLB
	PLB
	LDX.w $7E4800
	LDA.w #$2800
	STA.w $0000,x
	LDA.w #$0180
	STA.w $0002,x
	LDA.w #(($707000&$0000FF)<<8)+(!REGISTER_WriteToVRAMPortLo&$0000FF)
	STA.w $0004,x
	LDA.w #$707000>>8
	STA.w $0006,x
	LDA.w #$0800
	STA.w $0008,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,x
	STA.w $7E4800
	PLB
	SEP.b #$10
	PLY
	STY.w $012E
	PLY
	STY.w $012D
	REP.b #$10
	RTS

UNK_04F5D0:
	dw $053D,$0063,$0470,$0078,$BB74,$007A,$04CF,$004D
	dw $12BF,$0461,$0D7F,$0042,$0682,$0064,$0D86,$0078
	dw $0A8A,$007A,$03C4,$054B,$49CC,$0264,$04DD,$007A

ADDR_04F600:
	LDA.w $0035
	CMP.w #$00F0
	BNE.b ADDR_04F64B
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
ADDR_04F60B:
	CMP.w #!Define_YI_Map_LevelsPerWorld
	BCC.b ADDR_04F615
	SBC.w #!Define_YI_Map_LevelsPerWorld
	BRA.b ADDR_04F60B

ADDR_04F615:
	CMP.w #$0003
	BEQ.b ADDR_04F61F
	CMP.w #$0007
	BNE.b ADDR_04F64B
ADDR_04F61F:
	AND.w #$0004
	LSR
	LSR
	ORA.w !RAM_YI_Level_CurrentWorldLo
	ASL
	ASL
	TAX
	LDA.w UNK_04F5D0,x
	STA.l $7F7E00
	LDA.w UNK_04F5D0+$02,x
	STA.l $7F7E02
	STZ.w $038E
	LDA.w #$0001
	STA.w $038C
	LDA.w #!Define_YI_GameMode0B
	STA.w !RAM_YI_Global_CurrentGameMode
	JSL.l CODE_save_egg_inventory
ADDR_04F64B:
	RTS

CODE_04F64C:
CODE_player_state_00_normal:                           ; PlayerState00_Normal -- main gameplay loop
if !Define_YI_Global_EnableDebugFeatures == !TRUE
	NOP #2
else
	BRA.b CODE_04F673
endif

ADDR_04F64E:
	JSR.w ADDR_04F600
	LDA.b $35
	AND.w #$0030
	BEQ.b ADDR_04F668
	LDA.b $38
	AND.w #$0008
	BEQ.b ADDR_04F668
	LDA.w !RAM_YI_Level_FreeMovementFlag
	EOR.w #$0001
	STA.w !RAM_YI_Level_FreeMovementFlag
ADDR_04F668:
	LDA.w !RAM_YI_Level_FreeMovementFlag
	BEQ.b CODE_04F673
	STZ.w $61B6
	JMP.w ADDR_04F718

CODE_04F673:
	LDA.w $60B2
	CMP.w #$0140
	BMI.b CODE_04F688
	LDA.w $7E2A
	BNE.b CODE_04F688
	LDA.w #!Define_YI_PlayerState1A_DisableInput
	JSL.l CODE_04F6CA
	RTS

CODE_04F688:
	LDA.w $0C8A
	BEQ.b CODE_04F690
	JMP.w CODE_04EFF1

CODE_04F690:
	LDA.b $35
	LDY.w $0CCC
	BEQ.b CODE_04F69A
	AND.w #$FCFF
CODE_04F69A:
	STA.w $6070
	LDA.b $37
	STA.w $6072
CODE_04F6A2:
	STZ.w $6076
	STZ.w $607A
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	STA.w $607C
	SEP.b #$10
	LDX.b #FXCODE_0BC71B>>16
	LDA.w #FXCODE_0BC71B
	JSL.l !RAM_YI_Global_RT_00DECF
	LDA.w $6076
	STA.b $51
	LDA.w $607A
	BEQ.b CODE_04F6C7
	JSL.l CODE_push_sound_queue
CODE_04F6C7:
	REP.b #$10
	RTS

CODE_04F6CA:
	JSL.l CODE_04F6E2
CODE_04F6CE:
	LDA.w #!Define_YI_GameMode11
	STA.w !RAM_YI_Global_CurrentGameMode
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	STZ.w $0B4C
	SEP.b #$20
	STZ.w $0D21
	REP.b #$20
	RTL

CODE_04F6E2:
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	STZ.w $61D6
	LDA.w #$0007
	STA.w !RAM_YI_Global_PlayMusicLo
CODE_04F6F1:
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	CMP.w #!Define_YI_LevelID_WelcomeToYoshisIsland
	BEQ.b CODE_04F707
	DEC.w !RAM_YI_Level_CurrentLifeCountLo
	LDA.w !RAM_YI_Level_DeathsInCurrentLevelLo
	CMP.w #$03E7
	BCS.b CODE_04F707
	INC.w !RAM_YI_Level_DeathsInCurrentLevelLo
CODE_04F707:
	RTL

UNK_04F708:
	dw $0000,$0000,$0001,$0004,$FFFF,$FFFC,$FFFF,$FFFC

ADDR_04F718:
	STZ.w $60C0
	LDA.b $36
	AND.w #$0003
	ASL
	BIT.b $34
	BPL.b ADDR_04F726
	INC
ADDR_04F726:
	ASL
	TAX
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w UNK_04F708,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.b $36
	AND.w #$000C
	LSR
	BIT.b $34
	BPL.b ADDR_04F73D
	INC
ADDR_04F73D:
	ASL
	TAX
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w UNK_04F708,x
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	RTS

CODE_04F74A:
	STZ.w $60DE
CODE_04F74D:
	STZ.w $60D4
	PHX
	LDX.w $6162
	BNE.b CODE_04F75D
	LDX.w $6168
	BEQ.b CODE_04F79D
	BRA.b CODE_04F7A0

CODE_04F75D:
	LDA.w $6152
	ORA.w $6154
	BNE.b CODE_04F774
	LDA.w $6168
	BEQ.b CODE_04F794
	LDA.w !EXRAM_YI_Level_Player_AmmoTypeInMouthLo|!EXRAMBankMirror
	BEQ.b CODE_04F7AC
	STZ.w $616C
	BRA.b CODE_04F79D

CODE_04F774:
	DEX
	BNE.b CODE_04F77C
	LDA.w $0B57
	BNE.b CODE_04F794
CODE_04F77C:
	JSL.l CODE_039D68
	LDA.w $6FA2,x
	AND.w #$6000
	CMP.w #$6000
	BNE.b CODE_04F794
	LDA.w $7542,x
	BNE.b CODE_04F794
	JSL.l CODE_048066
CODE_04F794:
	STZ.w $6162
	STZ.w $6168
	STZ.w !EXRAM_YI_Level_Player_AmmoTypeInMouthLo|!EXRAMBankMirror
CODE_04F79D:
	STZ.w $6150
CODE_04F7A0:
	STZ.w $6152
	STZ.w $6154
	STZ.w $615E
	STZ.w $6160
CODE_04F7AC:
	PLX
	RTL

DATA_04F7AE:
	dw $0080,$0005,$0002,$0002,$0002,$000C,$0006,$0006
	dw $0006,$0006,$0006,$0006,$0004,$0004,$0004,$0004
	dw $0004,$0004,$0003,$0003,$0003,$0003,$0003,$0003
	dw $0002,$0002,$0002,$0002,$0002

DATA_04F7E8:
	dw $006E,$006D,$006E,$006D,$006C,$006F,$0074,$0073
	dw $0072,$0071,$0070,$006F

CODE_04F800:
CODE_player_state_0E_touched_spike:                    ; PlayerState0E_TouchedSpike
	SEP.b #$10
	JSL.l CODE_04F74A
	REP.b #$10
	LDX.w $60F8
	LDA.w $61D2
	BNE.b CODE_04F82D
	DEX
	DEX
	BPL.b CODE_04F81C
	JSL.l CODE_04F6CE
	INC.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	RTS

CODE_04F81C:
	STX.w $60F8
	LDA.w DATA_04F7AE,x
	CPX.w #$003A
	BCC.b CODE_04F82A
	LDA.w #$0001
CODE_04F82A:
	STA.w $61D2
CODE_04F82D:
	CPX.w #$000C
	BCC.b CODE_04F83F
	TXA
	SBC.w #$000C
CODE_04F836:
	SBC.w #$000C
	BCS.b CODE_04F836
	ADC.w #$0018
	TAX
CODE_04F83F:
	LDA.w DATA_04F7E8,x
	STA.w $60BE
	RTS

CODE_04F846:
CODE_player_state_1C_prologue:                         ; PlayerState1C_Prologue
	STZ.w $611A
CODE_04F849:
CODE_player_state_1A_disable_input:                    ; PlayerState1A_DisableInput (RTS stub)
	RTS

CODE_04F84A:
CODE_player_state_14_activate_goal:                    ; PlayerState14_ActivateGoal
	STZ.w $6070
	STZ.w $6072
	SEP.b #$10
	LDX.b #FXCODE_0BC6E7>>16
	LDA.w #FXCODE_0BC6E7
	JSL.l !RAM_YI_Global_RT_00DECF
	REP.b #$10
	RTS

;---------------------------------------------------------------------------

DATA_04F85E:
	dw $FFFC,$0004,$FFFC,$0004

DATA_04F866:
	dw $FFFC,$FFFC,$0004,$0004

DATA_04F86E:
	dw $FF00,$0100,$FF80,$0080

DATA_04F876:
	dw $FD00,$FD00,$FE00,$FE00

DATA_04F87E:
	dw $0000,$0040,$0080,$00C0

DATA_04F886:
	dw $0010,$0010,$0001,$0001

CODE_04F88E:
	LDX.b #$06
CODE_04F890:
	LDA.w #!Define_YI_AmbSpr1BD
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $0000
	CLC
	ADC.l DATA_04F85E,x
	STA.w $70A2,y
	LDA.w $0002
	CLC
	ADC.l DATA_04F866,x
	STA.w $7142,y
	LDA.l DATA_04F86E,x
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.l DATA_04F876,x
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $0004
	ORA.l DATA_04F87E,x
	STA.w $7002,y
	LDA.l DATA_04F886,x
	STA.w $7782,y
	DEX
	DEX
	BPL.b CODE_04F890
	RTL

;---------------------------------------------------------------------------

DATA_04F8D1:
	dw $007D,$007E,$007F,$0080,$0081,$0082,$0083,$0084
	dw $0085,$0086,$0110,$0111,$0112,$0113,$0114,$0115

CODE_04F8F1:
CODE_player_state_0A_entering_door:                    ; PlayerState0A_EnteringDoor
	LDA.w $60C0
	BEQ.b CODE_04F8F9
	JMP.w CODE_04F998

CODE_04F8F9:
	LDY.w $60F8
	LDA.w $61D2
	BNE.b CODE_04F968
	INY
	INY
	LDA.w $0C8C
	BEQ.b CODE_04F915
	STZ.w $0E15
	CPY.w #$0020
	BCC.b CODE_04F921
	LDY.w #$0014
	BRA.b CODE_04F921

CODE_04F915:
	INC
	STA.w $0E15
	CPY.w #$0014
	BCC.b CODE_04F921
	LDY.w #$0004
CODE_04F921:
	STY.w $60F8
	LDA.w #$0006
	CPY.w #$0004
	BCS.b CODE_04F965
	PHY
	LDA.w #$2D6C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$2F6C
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0200
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	SEP.b #$10
	LDX.b #FXCODE_08AA7F>>16
	LDA.w #FXCODE_08AA7F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	PLY
	LDX.w #$001C
	LDA.w #$0000
CODE_04F953:
	STA.l $70310E,x
	DEX
	DEX
	BPL.b CODE_04F953
	LDA.w #$FFFF
	STA.l $70336C
	LDA.w #$0004
CODE_04F965:
	STA.w $61D2
CODE_04F968:
	LDA.w DATA_04F8D1,y
	STA.w $60BE
	CPY.w #$0004
	BCC.b CODE_04F997
	LDA.l $70336C
	CMP.w #$0020
	BPL.b CODE_04F998
	LDA.w #$2D6C
	STA.l $70336E
	LDA.w #$2F6C
	STA.l $703370
	SEP.b #$10
	LDX.b #FXCODE_08B4A9>>16
	LDA.w #FXCODE_08B4A9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
CODE_04F997:
	RTS

CODE_04F998:
	LDA.w $6104
	CMP.w #$0100
	BEQ.b CODE_04F9AD
	SEP.b #$30
	JSR.w CODE_04FA33
	REP.b #$30
	BEQ.b CODE_04F9B2
	STZ.w $6104
	RTS

CODE_04F9AD:
	JSL.l CODE_02A4B5
	RTS

CODE_04F9B2:
	LDA.w #$0200
	STA.w $6104
	STZ.w $60B4
	LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	BNE.b CODE_04FA22
	LDA.w $0C8C
	BEQ.b CODE_04FA21
	LDA.w #!Define_YI_PlayerForm0E_Skiing
	STA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	JSL.l CODE_04EF27
	LDA.w #!Define_YI_PlayerState0A_EnteringDoor
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	INC.w $0C8C
	LDA.w #$0012
	STA.w $60F8
	STZ.w $61D2
	LDA.w !RAM_YI_Level_CurrentYoshiColorLo
	ASL
	STA.w $6116
	JSL.l CODE_04FB41
	LDA.w #$2D6C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$2F6C
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0200
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	SEP.b #$10
	LDX.b #FXCODE_08AA7F>>16
	LDA.w #FXCODE_08AA7F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDA.w #$0000
	STA.l $70336C
	LDX.w #$001C
CODE_04FA15:
	STA.l YI_Global_PaletteMirror[$D1].LowByte,x
	STA.l $702F0E,x
	DEX
	DEX
	BPL.b CODE_04FA15
CODE_04FA21:
	RTS

CODE_04FA22:
	LDA.w $0C8E
	BNE.b CODE_04FA30
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $60C4
	STZ.w $60F8
CODE_04FA30:
	RTS

;---------------------------------------------------------------------------

DATA_04FA31:
	db !Define_YI_LevelID_DangerIcyConditionsAhead
	db !Define_YI_LevelID_KameksRevenge

CODE_04FA33:
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CMP.b #$04
	BNE.b CODE_04FA4E
	LDX.w !RAM_YI_Level_LevelHeaderItemMemorySettingLo
	CPX.b #$03
	BNE.b CODE_04FA4E
	LDX.b #$01
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
CODE_04FA46:
	CMP.w DATA_04FA31,x
	BEQ.b CODE_04FA4E
	DEX
	BPL.b CODE_04FA46
CODE_04FA4E:
	RTS

;---------------------------------------------------------------------------

DATA_04FA4F:
	dw $0000,$0000,$0001,$0001,$0002,$0002,$0004,$0004
	dw $0004,$0004,$0004,$0004

CODE_04FA67:
	REP.b #$30
	LDA.w !EXRAM_YI_Player_SubXPosLo|!EXRAMBankMirror
	STA.w $7E10
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $7E12
	SEC
	SBC.w $6094
	STA.w $60B0
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	CLC
	ADC.w $0C80
	STA.w $6156
	LDA.w !EXRAM_YI_Player_SubYPosLo|!EXRAMBankMirror
	STA.w $7E14
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w $7E16
	SEC
	SBC.w $609C
	STA.w $60B2
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	CLC
	ADC.w $0C82
	STA.w $6158
	LDA.w $611A
	BEQ.b CODE_04FB16
	LDA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w $614A
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_04FAE9
	LDA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	BNE.b CODE_04FAC0
	LDA.w $61F4
	BEQ.b CODE_04FAD7
CODE_04FAC0:
	CMP.w #$00C0
	BCS.b CODE_04FAD7
	STA.b $00
	LSR
	LSR
	LSR
	LSR
	ASL
	TAX
	LDA.l DATA_04FA4F,x
	AND.b $00
	BEQ.b CODE_04FAE9
	BRA.b CODE_04FB16

CODE_04FAD7:
	LDA.w $61D6
	LSR
	LSR
	LSR
	LSR
	ASL
	TAX
	LDA.w $7974
	AND.l DATA_04FA4F,x
	BNE.b CODE_04FB16
CODE_04FAE9:
	LDA.w $60C4
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $60BE
	TAY
	ASL
	TAX
	LDA.l FXDATA_4C0204,x
	CLC
	ADC.w #FXDATA_4C060C
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	TYX
	LDA.l FXDATA_4C0000,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	SEP.b #$10
	LDX.b #FXCODE_09835F>>16
	LDA.w #FXCODE_09835F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_04FB16:
	SEP.b #$30
	LDA.b #$03
	STA.w $611A
	LDA.b #$0A
	STA.w $6124
	RTL

;---------------------------------------------------------------------------

DATA_04FB23:
	dw $005C,$007A,$0098,$00B6,$00D4,$00F2,$0110,$012E

DATA_04FB33:
	dw $27AA,$27C8,$27E6,$2804,$2822,$2840,$285E

CODE_04FB41:
	PHP
	REP.b #$30
	PHA
	PHX
	PHY
	PHB
	LDX.w $6116
	PEA.w $702000>>8
	PLB
	PLB
	LDA.l DATA_04FB23,x
	TAX
	LDY.w #$001C
CODE_04FB58:
	LDA.l DATA_master_palette_rom_blob,x
	STA.w $7021A2,y
	STA.w $702F0E,y
	DEX
	DEX
	DEY
	DEY
	BPL.b CODE_04FB58
	PLB
	PLY
	PLX
	PLA
	PLP
	RTL

;---------------------------------------------------------------------------

DATA_04FB6E:
	dw $0040,$0080,$0100,$0080,$0080,$0080,$0080,$0080
	dw $0040,$00C0,$0080,$00C0,$0000,$0080,$0000,$0000
	dw $0080,$0080,$0080,$0080,$0040,$0100,$0100,$0100
	dw $0100,$0100,$0100,$0100,$0100,$0100,$0100,$0100

DATA_04FBAE:
	dw $0040,$FFFF,$FFFF,$0040,$0040,$0040,$0040,$0040
	dw $FFFF,$0060,$0040,$FFFF,$0000,$FFFF,$0000,$0000
	dw $0100,$0040,$0040,$0040,$0040,$0100,$0100,$0100
	dw $0100,$0100,$0100,$0100,$0100,$0100,$0100,$0100

DATA_04FBEE:
	dw $0020,$0040,$0100,$0100,$0000,$0040,$0133,$0080
	dw $0040,$0040,$0020,$0000,$0040,$0000,$0040,$0000
	dw $0040,$0040,$0080,$00C0,$0000,$0100,$0100,$0100
	dw $0100,$0100,$0100,$0100,$0100,$0100,$0100,$0100

DATA_04FC2E:
	dw $0020,$FFFF,$FFFF,$FFFF,$0000,$0040,$0133,$0040
	dw $FFFF,$0020,$0020,$0000,$0020,$0000,$0040,$0000
	dw $0100,$0020,$0040,$0060,$0000,$0100,$0100,$0100
	dw $0100,$0100,$0100,$0100,$0100,$0100,$0100,$0100

DATA_04FC6E:
	dw $0100,$0100,$0100,$0100,$0100,$0100,$0166,$0000
	dw $0100,$0100,$0100,$0000,$0000,$0100,$0000,$0000
	dw $0020,$0060,$0100,$0100,$0000,$0100,$0100,$0100
	dw $0100,$0100,$0100,$0100,$0100,$0100,$0100,$0100

DATA_04FCAE:
	dw $0100,$0100,$0100,$0100,$0100,$0100,$0000,$0000
	dw $0100,$0100,$0100,$0000,$0000,$0100,$0000,$0000
	dw $0100,$0020,$0100,$0100,$0000,$0100,$0100,$0100
	dw $0100,$0100,$0100,$0100,$0100,$0100,$0100,$0100
	dw $0023,$0600,$0406,$0206,$0106,$0606,$0102,$0104
	dw $0001,$0000,$0000,$0000,$0100,$0000,$FF00,$0100
	dw $00FF,$0000,$0000,$0000,$0100,$0000,$0100,$FF00
	dw $00FF,$FFF8,$0008,$FFF8,$0008

CODE_04FD28:
	PHB
	PHK
	PLB
	REP.b #$20
	LDA.w !RAM_YI_Level_MessageBoxState 
	BEQ.b CODE_04FD35
	JMP.w CODE_04FDC1

CODE_04FD35:
	LDA.w $7E2A
	ORA.w $0B57
	BNE.b CODE_04FD55
	LDA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	ORA.w $0C8E
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_04FDC1
	LDA.w $614E
	BEQ.b CODE_04FD55
	CMP.w #$0005
	BCS.b CODE_04FDC1
CODE_04FD55:
	REP.b #$10
	LDA.w $0C1C
	TAY
	BEQ.b CODE_04FD67
	JSL.l CODE_main_autoscrolls
	LDA.w $0C2A
	LDY.w $0C22
CODE_04FD67:
	STA.w $7E28
	STY.w $7E26
	SEP.b #$10
	LDX.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CPX.b #!Define_YI_PlayerState16_LevelIntro
	BEQ.b CODE_04FDC1
	LDX.w !RAM_YI_Level_LevelHeaderBGScrollSettingLo
	CPX.b #$0D
	BNE.b CODE_04FDAE
	LDX.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CPX.b #!Define_YI_PlayerState08
	BNE.b CODE_04FDA2
	LDY.w $6106
	LDA.w DATA_04E686
	STA.w $7E22
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w $609C
	SEC
	SBC.w $7E22
	EOR.w DATA_04E68A,y
	BMI.b CODE_04FDA2
	LDA.w #$0000
	BRA.b CODE_04FDAB

CODE_04FDA2:
	LDA.w $609C
	STA.w $0C27
	LDA.w #$0001
CODE_04FDAB:
	STA.w $0C20
CODE_04FDAE:
	LDX.b #FXCODE_0994D7>>16
	LDA.w #FXCODE_0994D7
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $609C
	CLC
	ADC.w #$000C
	STA.w $609C
CODE_04FDC1:
	LDA.w $6094
	LDY.w $0C1E
	BEQ.b CODE_04FDD8
	LDA.w $0C22
	AND.w #$00FF
	STA.w $7E0C
	LDA.w $0C23
	STA.w $6094
CODE_04FDD8:
	LDY.b #$00
	CMP.b !RAM_YI_Global_Layer1XPosLo
	BPL.b CODE_04FDE0
	LDY.b #$02
CODE_04FDE0:
	STY.b $73
	STA.b !RAM_YI_Global_Layer1XPosLo
	LDA.w $609C
	LDY.w $0C20
	BEQ.b CODE_04FDFB
	LDA.w $0C26
	AND.w #$00FF
	STA.w $7E0E
	LDA.w $0C27
	STA.w $609C
CODE_04FDFB:
	LDY.b #$00
	CMP.b !RAM_YI_Global_Layer1YPosLo
	BPL.b CODE_04FE03
	LDY.b #$02
CODE_04FE03:
	STY.b $75
	STA.b !RAM_YI_Global_Layer1YPosLo
	STA.b !RAM_YI_Global_Layer1YPosLo
	LDY.w !RAM_YI_Level_LevelHeaderBackgroundColorLo
	CPY.b #$10
	BCC.b CODE_04FE23
	LSR
	LSR
	LSR
	PHA
	CLC
	ADC.w #$56DE
	STA.w $0D0B
	PLA
	ASL
	ADC.w #$5894
	STA.w $0D09
CODE_04FE23:
	LDA.w $0D0D
	BEQ.b CODE_04FE43
	LDA.b !RAM_YI_Global_Layer3YPosLo
	SEC
	SBC.w #$0029
	BPL.b CODE_04FE33
	LDA.w #$0000
CODE_04FE33:
	PHA
	CLC
	ADC.w #$56DE
	STA.w $0D0B
	PLA
	ASL
	ADC.w #$5894
	STA.w $0D09
CODE_04FE43:
	LDA.w !RAM_YI_Level_LevelHeaderBGScrollSettingLo
	ASL
	TAX
	LDA.w DATA_04FB6E,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w DATA_04FBAE,x
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w DATA_04FBEE,x
	LDY.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CPY.b #$03
	BNE.b CODE_04FE61
	LDA.w #$0000
CODE_04FE61:
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w DATA_04FC2E,x
	LDY.w !RAM_YI_Level_LevelHeaderBG3TilesetLo
	CPY.b #$1C
	BNE.b CODE_04FE74
	JSR.w CODE_04FF06
	LDA.w #$0000
CODE_04FE74:
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w DATA_04FC6E,x
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w DATA_04FCAE,x
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_0993B3>>16
	LDA.w #FXCODE_0993B3
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $6096
	STA.b !RAM_YI_Global_Layer2XPosLo
	LDA.w $609E
	STA.b !RAM_YI_Global_Layer2YPosLo
	LDY.w !RAM_YI_Level_LevelHeaderBG3TilesetLo
	CPY.b #$1A
	BNE.b CODE_04FEC1
	LDA.w $7974
	LSR
	LSR
	PHA
	CLC
	ADC.w $6098
	CLC
	ADC.w $0C90
	STA.w $6098
	STA.b !RAM_YI_Global_Layer3XPosLo
	PLA
	LSR
	CLC
	ADC.w $60A0
	CLC
	ADC.w $0C92
	STA.w $60A0
	STA.b !RAM_YI_Global_Layer3YPosLo
	BRA.b CODE_04FEF8

CODE_04FEC1:
	CPY.b #$2D
	BNE.b CODE_04FED7
	LDA.w $7974
	LSR
	LSR
	LSR
	ADC.w $6094
	STA.w $6098
	LDA.w $609C
	STA.w $60A0
CODE_04FED7:
	DEY
	BNE.b CODE_04FEEE
	LDA.w $7974
	LSR
	LSR
	CLC
	ADC.w $6098
	CLC
	ADC.w $0C90
	STA.w $6098
	STA.b !RAM_YI_Global_Layer3XPosLo
	BRA.b CODE_04FEF8

CODE_04FEEE:
	LDA.w $6098
	STA.b !RAM_YI_Global_Layer3XPosLo
	LDA.w $60A0
	STA.b !RAM_YI_Global_Layer3YPosLo
CODE_04FEF8:
	LDA.w $609A
	STA.b !RAM_YI_Global_Layer4XPosLo
	LDA.w $60A2
	STA.b !RAM_YI_Global_Layer4YPosLo
	SEP.b #$30
	PLB
	RTL

CODE_04FF06:
	LDA.w #$00F8
	SEC
	SBC.w $60B0
	STA.w $6098
	LDA.w #$00F0
	SEC
	SBC.w $60B2
	STA.w $60A0
	RTS

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($04FF34, incbin, DATA_04FF34_YI_U2.bin)
else
	%FREE_BYTES($04FF1B, 229, $FF)
endif
%BANK_END(<EndBank>)
endmacro
