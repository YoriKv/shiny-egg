;#############################################################################################################
;# Bank0C.asm -- normal-sprite Init/Main handlers (SNES bank $0C, mirror $8C).
;#
;# All sprite IDs in this bank are members of the "normal sprite" set (loaded via the
;# YI_NorSpr<id>_<Name>_Init / _Main convention). Each entry is the bytecode behind one
;# sprite type. The init runs once on spawn; main runs every frame the sprite is active.
;#
;# Contents at a glance (sprite ID -> Init / Main entry; addresses come from the ;$0Cxxxx
;# comments at each handler in this file):
;#   $190 FallingIcicle              -- $0C800C / $0C8016
;#   $062 Goomba                     -- $0C8364 / $0C8369   (+ StompRt at $0C858D)
;#   $195 SmallUnstableSnowPlatform  -- $0C863E / $0C86BD
;#   $196 UnstableSnowPlatform       -- $0C8671 / $0C87D1
;#   $199 DizzyDandy                 -- $0C88E6 / $0C890B
;#   $19A BooGuy                     -- $0C8B61 / $0C8BAF   (+ StompRt at $0C8FE3)
;#   $194 Blargg                     -- $0C905A / $0C9080   (W4 lava-pop hazard)
;#   $184 Bumpty                     -- $0C9306 / $0C930E   (penguin enemy)
;#   $19B TacklingBumpty             -- $0C970A / $0C971D
;#   $19C FlyingBumpty               -- $0C99B5 / $0C9A13
;#   $19D SkeletonGoonie             -- $0C9B6C / $0C9B8A   (+ StompRt at $0C9C48)
;#   $19E WinglessSkeletonGoonie     -- $0C9CF3 / $0C9CFD
;#   $19F SkeletonGoonieCarryingBomb -- $0C9D6C / $0C9DF4   (+ StompRt at $0C9FDE)
;#   $1A0 DoubleFirebar / $1A1 Firebar -- $0CA00F / $0CA03C (shared Init/Main)
;#   $02F LittleMouserHole           -- $0CA07E / $0CA082
;#   $032 PeekingLittleMouser        -- $0CA087 / $0CA0B4
;#   $030 LittleMouser               -- $0CA21C / $0CA2C7
;#   $033 LittleMouserExitingNest    -- $0CA918 / $0CA98E
;#   $1A3 LittleSkullMouser          -- $0CB304 / $0CB36A
;#   $1A2 HealthStar                 -- $0CB530 / $0CB537
;#   $104 JeanDeFillet               -- $0CB636 / $0CB6AC   (knife-throwing fish chef)
;#   $1AA HotLips                    -- $0CB914 / $0CBA2C   (lava-spitter)
;#   $1AB BooBalloon                 -- $0CBE98 / $0CBED6   (+ StompRt at $0CC2A4)
;#   $1AD MagicShootingKamek         -- $0CC369 / $0CC39B   (+ StompRt at $0CC795)
;#   $1AE MagicShot                  -- $0CC796 / $0CC797   (Kamek's transform projectile)
;#   $0A0 Tulip                      -- $0CC8E3 / $0CC91D
;#   $0DF PiscatoryPete              -- $0CCE4D / $0CCE83
;#   $0E0 PreyingMantas              -- $0CD064 / $0CD093   (flying enemy)
;#   $0E1 LochNestor                 -- $0CD122 / $0CD154   (W5-2 lake serpent)
;#   $071 BigBoo                     -- $0CD4F5 / $0CD545
;#   $048 CutsceneKamek              -- $0CDB06 / $0CDB6C
;#   $047 ShyguyPushingRoger         -- $0CE5E9 / $0CE658
;#   $1AF FloatingCoin               -- $0CE961 / $0CE98B
;#   $065 RedCoin                    -- $0CEA06 / $0CEA40
;#   $1B0 DeflatingBalloon           -- $0CEB10 / $0CEBBA
;#   $073 BalloonPump                -- $0CEFC4 / $0CF005
;#   $072 TrainBandit                -- $0CF18C / $0CF1D5
;#   $12C FlyOrWhirlyGuy             -- $0CF38B / $0CF42B   (+ StompRt at $0CF848)
;#   $12D PrologueCutsceneYoshi      -- $0CFA4B / $0CFA6E
;#   $0F3 WoozyGuy                   -- $0CFB8F / $0CFC37
;#   $0CFF84..$0CFFFF -- bank-tail garbage data (V1.1 ROM only; 151 free bytes in V1.0).
;#
;# Cross-references:
;#   ../../../yoshisisland-disassembly/disassembly/bank0C.asm -- Raidenthequick's V1.0 disassembly,
;#       primary source for descriptive names (init_falling_icicle, init_goomba, etc.).
;#       Their per-line "; $0Cxxxx |" address column maps 1:1 onto this file.
;#   docs/spritestateengine.md                        -- sprite ID space + head-bop convention
;#       (state $0E head-bop handler is documented in S5.6 there).
;#   ../Constants/NormalSpriteIDs.asm                 -- the !Define_YI_NorSprXXX_<Name> symbols
;#       that resolve to the IDs used in the Init/Main label templates.
;#   see also: ys_enmy.asm, ys_enmy7.asm, ys_enmy8.asm -- adjacent enemy subsystems.
;#
;# Naming convention recap:
;#   YI_NorSpr<HEXID>_<Name>_Init       -- single-shot on-spawn handler (RTL back).
;#   YI_NorSpr<HEXID>_<Name>_Main       -- per-frame handler; JMPs into a per-state table.
;#   YI_NorSpr<HEXID>_<Name>_StompRt    -- "head-bop" handler (Yoshi stomped this sprite).
;#   CODE_<HEXADDR>                     -- anonymous internal routine (state, branch target).
;#   DATA_<HEXADDR>                     -- anonymous data table (state pointers, anim frames).
;#
;# Each handler block below also gets a descriptive alias from Raidenthequick where one
;# exists; both labels resolve to the same byte address so existing tooling that greps
;# for YI_NorSpr* keeps working.
;#############################################################################################################

macro YIBank0CMacros(StartBank, EndBank)
%BANK_START(<StartBank>)

DATA_0C8000:
	dw $0000,$FFF9,$FFF3

DATA_0C8006:
	dw $000E,$0015,$001B

;---------------------------------------------------------------------------
; Sprite $190: Falling Icicle. Spawn-time setup -- zero vertical speed and
; mark the sprite as "not yet falling" via $74A2 = $FFFF (see Main's BMI gate).
; Raiden: init_falling_icicle.
;---------------------------------------------------------------------------
YI_NorSpr190_FallingIcicle_Init:
init_falling_icicle:
;$0C800C
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FFFF
	STA.w $74A2,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $190 main: dispatches on $16,x state through DATA_falling_icicle_state_ptr:
;   0 -- waiting (player-proximity test, transitions to falling)
;   1 -- falling (gravity tick via JSL CODE_03AF23 piggybacking the shared engine)
;   2-3 -- impact and despawn states
; Tables DATA_0C8000 / DATA_0C8006 index x/y shake offsets via $7402,x animation frame.
; Raiden: main_falling_icicle.
;---------------------------------------------------------------------------
YI_NorSpr190_FallingIcicle_Main:
main_falling_icicle:
;$0C8016
	JSL.l CODE_03AF23
	LDA.w $7402,x
	ASL
	TAY
	LDA.w DATA_0C8000,y
	STA.w $7B58,x
	LDA.w DATA_0C8006,y
	STA.w $7BB8,x
	LDA.b $16,x
	TAX
	JMP.w (DATA_falling_icicle_state_ptr,x)

DATA_0C8031:
DATA_falling_icicle_state_ptr:                  ; 4-entry Falling Icicle state ptr: hang / wobble / fall / shatter
	dw CODE_0C8039
	dw CODE_0C8065
	dw CODE_0C80AD
	dw CODE_0C80DB

CODE_0C8039:
	LDX.b $12
	JSR.w CODE_0C80E4
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCS.b CODE_0C8064
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	SEC
	SBC.w #$0020
	BPL.b CODE_0C8064
	LDA.w #$0030
	STA.b $18,x
	INC.b $16,x
	INC.b $16,x
CODE_0C8064:
	RTL

CODE_0C8065:
	LDX.b $12
	JSR.w CODE_0C8133
	LDA.w #!Define_YI_SoundID59_RollingRock
	JSL.l CODE_push_sound_queue
	LDA.w $7402,x
	STA.b $76,x
	INC.b $16,x
	INC.b $16,x
	RTL

DATA_0C807B:
	dw $0000,$FFFF,$0001,$0001,$FFFF,$FFFF,$0001,$0001
	dw $FFFF,$FFFF,$0001,$0001,$FFFF,$FFFF,$0001,$0001
	dw $FFFF,$FFFF,$0001,$0001,$FFFF,$FFFF,$0001,$0001
	dw $FFFF

CODE_0C80AD:
	LDX.b $12
	JSR.w CODE_0C8278
	LDA.w $7A96,x
	BNE.b CODE_0C80CF
	LDY.b $18,x
	BEQ.b CODE_0C80D0
	LDA.w $70E2,x
	CLC
	ADC.w DATA_0C807B,y
	STA.w $70E2,x
	LDA.w #$0001
	STA.w $7A96,x
	DEC.b $18,x
	DEC.b $18,x
CODE_0C80CF:
	RTL

CODE_0C80D0:
	LDA.w #$0040
	STA.w $7542,x
	INC.b $16,x
	INC.b $16,x
	RTL

CODE_0C80DB:
	LDX.b $12
	JSR.w CODE_0C82B4
	JSR.w CODE_0C8278
	RTL

CODE_0C80E4:
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$8E00
	BEQ.b CODE_0C811A
	CMP.w #$8E01
	BEQ.b CODE_0C811A
	CMP.w #$8E02
	BEQ.b CODE_0C811A
	PLA
	JML.l CODE_despawn_sprite_free_slot

CODE_0C811A:
	RTS

DATA_0C811B:
	dw $0000,$0000,$0000,$8D94

DATA_0C8123:
	dw $0000,$0000,$8D94,$799E

DATA_0C812B:
	dw $0000,$8D94,$799F,$799E

CODE_0C8133:
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.b $00
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $02
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$8E00
	BNE.b CODE_0C8178
	LDA.w #$0002
	STA.w $7402,x
	LDA.w $7182,x
	CLC
	ADC.w #$0020
	STA.w $7182,x
	LDA.w #DATA_0C811B
	STA.b $04
	LDY.b #$06
	JMP.w CODE_0C8235

CODE_0C8178:
	CMP.w #$8E01
	BNE.b CODE_0C81C6
	LDA.w #$0001
	STA.w $7402,x
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,x
	LDA.w #DATA_0C8123
	STA.b $04
	LDA.b $00
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b $02
	SEC
	SBC.w #$0010
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $02
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDY.b #$06
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$8E00
	BNE.b CODE_0C81BA
	JMP.w CODE_0C8235

CODE_0C81BA:
	LDA.b $02
	CLC
	ADC.w #$0010
	STA.b $02
	DEY
	DEY
	BRA.b CODE_0C8235

CODE_0C81C6:
	CMP.w #$8E02
	BNE.b CODE_0C8230
	LDA.w #$0000
	STA.w $7402,x
	LDA.w #DATA_0C812B
	STA.b $04
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
	LDY.b #$02
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$799D
	BEQ.b CODE_0C8235
	INY
	INY
	PHY
	LDA.b $00
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b $02
	SEC
	SBC.w #$0010
	STA.b $02
	SEC
	SBC.w #$0010
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	PLY
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$799D
	BEQ.b CODE_0C8235
	LDA.b $02
	SEC
	SBC.w #$0010
	STA.b $02
	INY
	INY
	BRA.b CODE_0C8235

CODE_0C8230:
	PLA
	JML.l CODE_despawn_sprite_free_slot

CODE_0C8235:
	PHY
	LDA.w $7402,x
	ASL
	TAY
	LDA.w DATA_0C8000,y
	STA.w $7B58,x
	LDA.w DATA_0C8006,y
	STA.w $7BB8,x
	LDA.w #$0005
	STA.w $74A2,x
	PLY
CODE_0C824E:
	LDA.b $00
	STA.w $0091
	LDA.b $02
	STA.w $0093
	LDA.w #$0001
	STA.w $008F
	LDA.b ($04),y
	STA.w $0095
	PHY
	JSL.l CODE_change_map16
	PLY
	LDA.b $02
	CLC
	ADC.w #$0010
	STA.b $02
	DEY
	DEY
	BPL.b CODE_0C824E
	LDX.b $12
	RTS

CODE_0C8278:
	LDY.w $7D36,x
	BPL.b CODE_0C8282
	JSL.l CODE_03A858
CODE_0C8281:
	RTS

CODE_0C8282:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	PHX
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_0C8281
	BEQ.b CODE_0C8281
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$000E
	BCC.b CODE_0C8281
	LDA.w $6FA2,y
	BIT.w #$6000
	BNE.b CODE_0C8281
	TYX
	JSL.l CODE_0CFF61
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	RTS

CODE_0C82B4:
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_0C82BD
	RTS

CODE_0C82BD:
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.l $700024,x
	AND.w #$F800
	CMP.w #$4000
	BNE.b CODE_0C831E
	LDA.l $700020,x
	STA.w $0091
	STA.b $00
	LDA.l $700022,x
	STA.w $0093
	STA.b $02
	LDA.w #$0000
	STA.w $008F
	SEP.b #$10
	JSL.l CODE_change_map16
	LDA.w #!Define_YI_AmbSpr1C3
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	AND.w #$FFF0
	STA.w $70A2,y
	LDA.b $02
	AND.w #$FFF0
	STA.w $7142,y
	LDA.w #$000A
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #!Define_YI_SoundID66_PotBreaking
	JSL.l CODE_push_sound_queue
	LDX.b $12
	DEC.b $76,x
	BMI.b CODE_0C831E
	RTS

CODE_0C831E:
	SEP.b #$10
	LDX.b $12
	LDA.w #!Define_YI_SoundID66_PotBreaking
	JSL.l CODE_push_sound_queue
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.b $00
	LDA.w $7402,x
	STA.b $02
CODE_0C8337:
	LDA.w #!Define_YI_AmbSpr1F2
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.b $00
	STA.w $7142,y
	SEC
	SBC.w #$0008
	STA.b $00
	LDA.w #$000B
	STA.w $73C2,y
	LDA.w #$0004
	STA.w $7782,y
	DEC.b $02
	BPL.b CODE_0C8337
	PLA
	JML.l CODE_despawn_sprite_free_slot

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $062: Goomba. Spawn-time setup. Raiden: init_goomba.
;
; See docs/family-koopas.md for the full Goomba + Koopa + Parakoopa
; breakdown. The Goomba is the only family member using TWO state bytes
; ($16,x main + $76,x head-bop) -- needed so a kicked-rolling Goomba
; (state $08) can be re-stomped while its head-bop animates.
;---------------------------------------------------------------------------
YI_NorSpr062_Goomba_Init:
init_goomba:
;$0C8364
	JSL.l CODE_0C83DF
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $062 main: per-frame walk + gravity. Raiden: main_goomba.
;---------------------------------------------------------------------------
YI_NorSpr062_Goomba_Main:
main_goomba:
;$0C8369
	JSL.l CODE_03AF23
	JSL.l CODE_07E336
	JSL.l CODE_03A5B7
	LDY.b $16,x
	TYX
	JMP.w (DATA_goomba_state_ptr,x)

DATA_0C837B:
DATA_goomba_state_ptr:                          ; 6-entry Goomba state ptr (walk / turn / fall / squashed / kicked / despawn)
	dw CODE_0C83EE
	dw CODE_0C8425
	dw CODE_0C8450
	dw CODE_0C84E6
	dw CODE_0C856D
	dw CODE_0C84B1

DATA_0C8387:
	db $00,$0F,$10,$00,$08,$00,$08,$00

DATA_0C838F:
	db $20,$00,$00,$04,$04,$04,$04,$20

CODE_0C8397:
	LDA.w #$0004
	STA.b $16,x
	LDA.w #$0007
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_0C8387,y
	STA.w $7402,x
	LDA.w DATA_0C838F,y
	STA.w $7A96,x
	REP.b #$20
	RTL

DATA_0C83B3:
	db $00,$00,$08,$00,$08,$00

DATA_0C83B9:
	db $04,$04,$04,$04,$04,$20

CODE_0C83BF:
	LDA.w #$0002
	STA.b $16,x
	LDA.w #$0005
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_0C83B3,y
	STA.w $7402,x
	LDA.w DATA_0C83B9,y
	STA.w $7A96,x
	REP.b #$20
	RTL

DATA_0C83DB:
	dw $FF00,$0100

CODE_0C83DF:
	STZ.b $16,x
	LDA.w #$0004
	STA.w $7A96,x
	STZ.w $7402,x
	LDY.w $7400,x
	RTL

CODE_0C83EE:
	LDX.b $12
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_0C8397
	BIT.w #$000C
	BNE.b CODE_0C83BF
	LDA.w $7A96,x
	BNE.b CODE_0C8416
	LDA.w $7402,x
	INC
	AND.w #$0007
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A96,x
	RTL

CODE_0C8416:
	CMP.w #$0001
	BNE.b CODE_0C8424
	LDY.w $7400,x
	LDA.w DATA_0C83DB,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0C8424:
	RTL

CODE_0C8425:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0C844B
	DEC.b $18,x
	BMI.b CODE_0C83DF
	SEP.b #$20
	BNE.b CODE_0C843C
	LDA.w $7400,x
	EOR.b #$02
	STA.w $7400,x
CODE_0C843C:
	LDY.b $18,x
	LDA.w DATA_0C83B3,y
	STA.w $7402,x
	LDA.b #$04
	STA.w $7A96,x
	REP.b #$20
CODE_0C844B:
	RTL

DATA_0C844C:
	dw $FFC0,$0040

CODE_0C8450:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0C8497
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_0C8498
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	DEC.b $18,x
	BPL.b CODE_0C8469
	JMP.w CODE_0C83DF

CODE_0C8469:
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_0C8387,y
	STA.w $7402,x
	LDA.w DATA_0C838F,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$02
	BNE.b CODE_0C8497
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.w $7400,x
	LDA.w DATA_0C844C,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0C8497:
	RTL

CODE_0C8498:
	LDA.w #$000F
	LDY.w $7223,x
	BMI.b CODE_0C84A3
	LDA.w #$0010
CODE_0C84A3:
	STA.w $7402,x
	RTL

DATA_0C84A7:
	db $00,$09,$0A,$0B,$0C

DATA_0C84AC:
	db $20,$04,$08,$04,$20

CODE_0C84B1:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0C84CE
	SEP.b #$20
	DEC.b $18,x
	BMI.b CODE_0C84CF
	LDY.b $18,x
	LDA.w DATA_0C84A7,y
	STA.w $7402,x
	LDA.w DATA_0C84AC,y
	STA.w $7A96,x
	REP.b #$20
CODE_0C84CE:
	RTL

CODE_0C84CF:
	REP.b #$20
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	RTL

DATA_0C84E0:
	db $0E,$0D

DATA_0C84E2:
	dw $FF80,$0080

CODE_0C84E6:
	LDX.b $12
	JSL.l CODE_07FC2A
	BEQ.b CODE_0C84F0
	BCS.b CODE_0C84F9
CODE_0C84F0:
	STZ.b $78,x
	LDA.w $7A98,x
	BEQ.b CODE_0C8548
	BRA.b CODE_0C8503

CODE_0C84F9:
	LDA.w #$0100
	STA.w $7A98,x
	LDA.b $78,x
	BEQ.b CODE_0C8527
CODE_0C8503:
	LDA.w $7A96,x
	BNE.b CODE_0C8526
	SEP.b #$20
	LDA.b $18,x
	DEC
	AND.b #$01
	STA.b $18,x
	TAY
	LDA.w DATA_0C84E0,y
	STA.w $7402,x
	LDA.b #$02
	STA.w $7A96,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID1B_MaceTick
	JSL.l CODE_push_sound_queue
CODE_0C8526:
	RTL

CODE_0C8527:
	INC.b $78,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0008
	STA.b $16,x
	LDA.w #$0003
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_0C8565,y
	STA.w $7402,x
	LDA.w DATA_0C8569,y
	STA.w $7A96,x
	REP.b #$20
	RTL

CODE_0C8548:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$04
	STA.b $18,x
	TAY
	LDA.w DATA_0C84A7,y
	STA.w $7402,x
	LDA.w DATA_0C84AC,y
	STA.w $7A96,x
	LDA.b #$0A
	STA.b $16,x
	REP.b #$20
	RTL

DATA_0C8565:
	db $0C,$0B,$0A,$0B

DATA_0C8569:
	db $20,$01,$02,$01

CODE_0C856D:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0C858A
	DEC.b $18,x
	BMI.b CODE_0C858B
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_0C8565,y
	STA.w $7402,x
	LDA.w DATA_0C8569,y
	STA.w $7A96,x
	REP.b #$20
CODE_0C858A:
	RTL

CODE_0C858B:
	BRA.b CODE_0C8606

;---------------------------------------------------------------------------
; Sprite $062 head-bop: Yoshi-stomped Goomba squish + score. Raiden: head_bop_goomba.
;---------------------------------------------------------------------------
YI_NorSpr062_Goomba_StompRt:
head_bop_goomba:
;$0C858D
	LDA.b $76,x
	TAX
	JMP.w (DATA_goomba_stomp_state_ptr,x)

CODE_0C8593:
	LDX.b $12
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_0C8634,y
	STA.w $7402,x
	LDA.w DATA_0C8639,y
	STA.w $7A96,x
	REP.b #$20
	INC.b $76,x
	INC.b $76,x
	RTL

CODE_0C85B3:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0C85D0
	DEC.b $18,x
	BMI.b CODE_0C85D1
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_0C8634,y
	STA.w $7402,x
	LDA.w DATA_0C8639,y
	STA.w $7A96,x
	REP.b #$20
CODE_0C85D0:
	RTL

CODE_0C85D1:
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.b $76,x
	LDA.w $6FA0,x
	AND.w #$07FF
	ORA.w #$F640
	STA.w $6FA0,x
	LDA.w $6FA2,x
	AND.w #$F03F
	ORA.w #$0140
	STA.w $6FA2,x
	LDA.w #$000C
	STA.w $7B58,x
	LDA.w #$0005
	STA.w $7BB8,x
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
CODE_0C8606:
	LDA.w #$0100
	STA.w $7A98,x
	LDA.w #$0006
	STA.b $16,x
	LDA.w #$0001
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_0C84E0,y
	STA.w $7402,x
	LDA.b #$02
	STA.w $7A96,x
	REP.b #$20
	LDY.w $7400,x
	LDA.w DATA_0C84E2,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTL

DATA_0C8630:
DATA_goomba_stomp_state_ptr:                    ; 2-entry Goomba head-bop state ptr: squish-anim / score-popup
	dw CODE_0C8593
	dw CODE_0C85B3

;---------------------------------------------------------------------------

DATA_0C8634:
	db $0C,$0B,$0A,$09,$00

DATA_0C8639:
	db $20,$01,$02,$01,$01

;---------------------------------------------------------------------------
; Sprite $195: Small unbalanced snowy platform (tips on Yoshi's weight).
; Raiden: init_unbalanced_snowy_platform (Raiden shares one label across the family).
;---------------------------------------------------------------------------
YI_NorSpr195_SmallUnstableSnowPlatform_Init:
init_small_unstable_snow_platform:
;$0C863E
	STZ.w $7400,x
	LDA.w $70E2,x
	STA.b $18,x
	STA.w $7B56,x
	STA.w $7A36,x
	LDA.w $7182,x
	STA.w $7B58,x
	STA.w $7A38,x
	CLC
	ADC.w #$0010
	STA.b $76,x
	LDA.w #$0018
	STA.w $7BB6,x
	STZ.w $7BB8,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	JSL.l CODE_03AE60
	BCC.b CODE_0C86AA
	JSR.w CODE_0C878D
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $196: Larger unbalanced snowy platform. Raiden: init_unbalanced_snowy_platform.
;---------------------------------------------------------------------------
YI_NorSpr196_UnstableSnowPlatform_Init:
init_unstable_snow_platform:
;$0C8671
	STZ.w $7400,x
	LDA.w $70E2,x
	STA.b $18,x
	STA.w $7B56,x
	STA.w $7A36,x
	LDA.w $7182,x
	STA.w $7A38,x
	CLC
	ADC.w #$0020
	STA.b $76,x
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7B58,x
	LDA.w #$0028
	STA.w $7BB6,x
	LDA.w #$FFF0
	STA.w $7BB8,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	JSL.l CODE_03ADFE
	BCS.b CODE_0C86B1
CODE_0C86AA:
	STZ.w $61C0
	JML.l CODE_03A31E

CODE_0C86B1:
	JSR.w CODE_0C88A2
	RTL

;---------------------------------------------------------------------------

DATA_0C86B5:
	dw $0010,$0000,$FFF0,$FFE0

;---------------------------------------------------------------------------
; Sprite $195 main: tip + fall on Yoshi proximity. Raiden: main_unbalanced_snowy_playform.
;---------------------------------------------------------------------------
YI_NorSpr195_SmallUnstableSnowPlatform_Main:
main_small_unstable_snow_platform:
;$0C86BD
	JSL.l CODE_03AA52
	JSL.l CODE_03AF23
	JSR.w CODE_0C878D
	LDA.b $16,x
	STA.w $603E
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0C8710
	LDA.w $61C0
	BEQ.b CODE_0C870D
	DEC.w $61C0
	DEC
	AND.w #$0001
	ASL
	TAY
	LDA.w $70E2,x
	CLC
	ADC.w DATA_0C86B5+$02,y
	STA.w $0091
	LDA.w $61C0
	AND.w #$0002
	TAY
	LDA.w $7182,x
	CLC
	ADC.w DATA_0C86B5+$02,y
	STA.w $0093
	LDA.w #$0001
	STA.w $008F
	LDA.w #$0000
	STA.w $0095
	JSL.l CODE_change_map16
	BRA.b CODE_0C8731

CODE_0C870D:
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_0C8710:
	LDA.b $16,x
	CLC
	ADC.b $78,x
	STA.b $00
	CLC
	ADC.w #$3000
	CMP.w #$6000
	BCS.b CODE_0C8731
	LDA.b $00
	STA.b $16,x
	LDX.b #FXCODE_099F21>>16
	LDA.w #FXCODE_099F21
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	BRA.b CODE_0C8744

CODE_0C8731:
	LDA.w #$FF80
	LDY.b $17,x
	BMI.b CODE_0C873B
	LDA.w #$0080
CODE_0C873B:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
CODE_0C8744:
	LDX.b #FXCODE_099D9D>>16
	LDA.w #FXCODE_099D9D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BEQ.b CODE_0C8768
	LDA.w $70E2
	CLC
	ADC.w $72C0,x
	STA.w $70E2
	LDA.w $7182
	CLC
	ADC.w $72C2,x
	STA.w $7182
CODE_0C8768:
	LDX.b #FXCODE_099C0D>>16
	LDA.w #FXCODE_099C0D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BEQ.b CODE_0C878C
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C0,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C2,x
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_0C878C:
	RTL

CODE_0C878D:
	REP.b #$10
	LDA.b $16,x
	EOR.w #$FFFF
	INC
	XBA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #FXDATA_550000+$2021
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$2021)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	SEP.b #$10
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTS

;---------------------------------------------------------------------------
; Sprite $196 main: tip + fall on Yoshi proximity (large variant).
;---------------------------------------------------------------------------
YI_NorSpr196_UnstableSnowPlatform_Main:
main_unstable_snow_platform:
;$0C87D1
	JSL.l CODE_03AB1C
	JSL.l CODE_03AF23
	JSR.w CODE_0C88A2
	LDA.b $16,x
	STA.w $603E
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0C8825
	LDA.w $61C0
	BEQ.b CODE_0C8822
	DEC.w $61C0
	DEC
	AND.w #$0003
	ASL
	TAY
	LDA.w $70E2,x
	CLC
	ADC.w DATA_0C86B5,y
	STA.w $0091
	LDA.w $61C0
	AND.w #$000C
	LSR
	TAY
	LDA.w $7182,x
	CLC
	ADC.w DATA_0C86B5,y
	STA.w $0093
	LDA.w #$0001
	STA.w $008F
	LDA.w #$0000
	STA.w $0095
	JSL.l CODE_change_map16
	BRA.b CODE_0C8846

CODE_0C8822:
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_0C8825:
	LDA.b $16,x
	CLC
	ADC.b $78,x
	STA.b $00
	CLC
	ADC.w #$3000
	CMP.w #$6000
	BCS.b CODE_0C8846
	LDA.b $00
	STA.b $16,x
	LDX.b #FXCODE_099F21>>16
	LDA.w #FXCODE_099F21
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	BRA.b CODE_0C8859

CODE_0C8846:
	LDA.w #$FF80
	LDY.b $17,x
	BMI.b CODE_0C8850
	LDA.w #$0080
CODE_0C8850:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
CODE_0C8859:
	LDX.b #FXCODE_099D9D>>16
	LDA.w #FXCODE_099D9D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BEQ.b CODE_0C887D
	LDA.w $70E2
	CLC
	ADC.w $72C0,x
	STA.w $70E2
	LDA.w $7182
	CLC
	ADC.w $72C2,x
	STA.w $7182
CODE_0C887D:
	LDX.b #FXCODE_099C0D>>16
	LDA.w #FXCODE_099C0D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BEQ.b CODE_0C88A1
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C0,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C2,x
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_0C88A1:
	RTL

CODE_0C88A2:
	REP.b #$10
	LDA.b $16,x
	EOR.w #$FFFF
	INC
	XBA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #FXDATA_550000+$4001
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$4001)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	SEP.b #$10
	LDX.b #FXCODE_088B47>>16
	LDA.w #FXCODE_088B47
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $199: Dizzy Dandy (spinning flower hazard). Raiden: init_dizzy_dandy.
;---------------------------------------------------------------------------
YI_NorSpr199_DizzyDandy_Init:
init_dizzy_dandy:
;$0C88E6
	LDA.w #$0001
	STA.b $76,x
	LDA.w #$0100
	STA.b $78,x
	JSL.l CODE_03AE60
	JMP.w CODE_0C891C

DATA_0C88F7:
	dw FXDATA_550000+$2041,FXDATA_550000+$2041,FXDATA_550000+$2061,FXDATA_550000+$2041,FXDATA_550000+$2061

DATA_0C8901:
	dw (FXDATA_550000+$2041)>>16,(FXDATA_550000+$2041)>>16,(FXDATA_550000+$2061)>>16,(FXDATA_550000+$2041)>>16,(FXDATA_550000+$2061)>>16

;---------------------------------------------------------------------------
; Sprite $199 main. Raiden: main_dizzy_dandy.
;---------------------------------------------------------------------------
YI_NorSpr199_DizzyDandy_Main:
main_dizzy_dandy:
;$0C890B
	JSL.l CODE_03AA52
	JSL.l CODE_03AF23
	JSR.w CODE_0C8A80
	LDY.b $18,x
	TYX
	JSR.w (DATA_dizzy_dandy_state_ptr,x)
CODE_0C891C:
	LDA.w $7400,x
	STA.w $7A36,x
	REP.b #$10
	LDA.b $16,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDY.b $18,x
	LDA.w DATA_0C88F7,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w DATA_0C8901,y
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.b $78,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7722,x
	TAX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEP.b #$10
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

DATA_0C8965:
DATA_dizzy_dandy_state_ptr:                     ; 5-entry Dizzy Dandy state ptr (sleep / wake / chase / dizzy / fall)
	dw CODE_0C896F
	dw CODE_0C8994
	dw CODE_0C89B5
	dw CODE_0C8A5D
	dw CODE_0C8A13

CODE_0C896F:
	LDX.b $12
	JSR.w CODE_0C8AEC
	JSR.w CODE_0C8B28
CODE_0C8977:
	LDA.b $16,x
	CLC
	ADC.b $76,x
	STA.b $16,x
	CLC
	ADC.w #$000C
	CMP.w #$0018
	BCC.b CODE_0C898F
	LDA.b $76,x
	EOR.w #$FFFF
	INC
	STA.b $76,x
CODE_0C898F:
	RTS

DATA_0C8990:
	dw $FE00,$0200

CODE_0C8994:
	LDX.b $12
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_0C89B4
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	TAY
	LDA.w DATA_0C8990,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b $18,x
	INY
	INY
	STY.b $18,x
CODE_0C89B4:
	RTS

CODE_0C89B5:
	LDX.b $12
	LDA.w $7400,x
	CMP.w $7A36,x
	BNE.b CODE_0C89E8
	LDA.b $14
	AND.w #$000F
	BNE.b CODE_0C89CD
	LDA.w #!Define_YI_SoundID59_RollingRock
	JSL.l CODE_push_sound_queue
CODE_0C89CD:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0C89D6
	EOR.w #$FFFF
	INC
CODE_0C89D6:
	LSR
	LSR
	LSR
	LSR
	LSR
	LSR
	AND.w #$00FF
	CLC
	ADC.b $16,x
	AND.w #$00FF
	STA.b $16,x
	RTS

CODE_0C89E8:
	LDA.w #!Define_YI_SoundID36_CollectFlower
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
	PLA
	JML.l CODE_03A31E

CODE_0C8A13:
	LDX.b $12
	JSR.w CODE_0C8AEC
	JSR.w CODE_0C8B28
	LDA.w $7A98,x
	BNE.b CODE_0C8A2D
	LDA.w #!Define_YI_SoundID3D_MarioKidnapped
	JSL.l CODE_push_sound_queue
	LDA.w #$0020
	STA.w $7A98,x
CODE_0C8A2D:
	LDA.w $7A96,x
	BEQ.b CODE_0C8A4E
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	LDA.b $78,x
	SEC
	SBC.w #$0008
	CMP.w #$00C0
	BCS.b CODE_0C8A49
	LDA.w #$0100
CODE_0C8A49:
	STA.b $78,x
	JMP.w CODE_0C8977

CODE_0C8A4E:
	STZ.b $16,x
	LDA.w #$0001
	STA.b $76,x
	LDA.w #$0100
	STA.b $78,x
	JMP.w CODE_0C8B09

CODE_0C8A5D:
	LDX.b $12
	JSR.w CODE_0C8AEC
	LDA.b $78,x
	CLC
	ADC.w #$0004
	CMP.w #$0100
	BCS.b CODE_0C8A70
	STA.b $78,x
	RTS

CODE_0C8A70:
	LDA.w #$0040
	STA.w $7A96,x
	LDA.w #$0100
	STA.b $78,x
	LDY.b #$08
	STY.b $18,x
	RTS

CODE_0C8A80:
	LDY.w $7D36,x
	BPL.b CODE_0C8AA0
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_0C8A9B
	JSL.l CODE_03B20B
	BRA.b CODE_0C8A9F

CODE_0C8A9B:
	JSL.l CODE_03A858
CODE_0C8A9F:
	RTS

CODE_0C8AA0:
	LDY.b $18,x
	CPY.b #$02
	BCC.b CODE_0C8A9F
	CPY.b #$05
	BCS.b CODE_0C8A9F
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	PHX
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_0C8A9F
	BEQ.b CODE_0C8A9F
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$000E
	BCC.b CODE_0C8A9F
	LDA.w $6FA2,y
	AND.w #$6000
	BNE.b CODE_0C8A9F
	LDA.w $6FA0,y
	AND.w #$0020
	BNE.b CODE_0C8A9F
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr02C_LungeFish
	BEQ.b CODE_0C8A9F
	TYX
	JSL.l CODE_0CFF61
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	RTS

CODE_0C8AEC:
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0020
	BPL.b CODE_0C8B27
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCS.b CODE_0C8B27
CODE_0C8B09:
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w $6FA2,x
	ORA.w #$0043
	STA.w $6FA2,x
	LDY.b #$02
	STY.b $18,x
	LDA.w #$0100
	STA.b $78,x
CODE_0C8B27:
	RTS

CODE_0C8B28:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0C8B60
	BEQ.b CODE_0C8B60
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0C8B60
	LDA.w $7D38,y
	BEQ.b CODE_0C8B60
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDX.b $12
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	STZ.b $16,x
	LDY.b #$06
	STY.b $18,x
	LDA.w #$00C0
	STA.b $78,x
	PLA
CODE_0C8B60:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $19A: Boo Guy. Raiden: init_boo_guy.
;---------------------------------------------------------------------------
YI_NorSpr19A_BooGuy_Init:
init_boo_guy:
;$0C8B61
	JSL.l CODE_0EB8AE
	BEQ.b CODE_0C8B74
	LDA.w $7182,x
	STA.w $7A38,x
	LDA.w #$0004
	STA.w $7B58,x
	RTL

CODE_0C8B74:
	SEP.b #$20
	LDA.b #$01
	STA.w $7A36,x
	LDA.b #$FF
	STA.w $74A2,x
	REP.b #$20
	LDA.w #$0060
	STA.w $6FA0,x
	LDA.w #$2000
	STA.w $6FA2,x
	LDA.w $7040,x
	AND.w #$FE0F
	STA.w $7040,x
	STZ.w $7542,x
	STZ.w $75E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w $70E2,x
	RTL

;---------------------------------------------------------------------------

DATA_0C8BAB:
	dw $FF80,$0080

;---------------------------------------------------------------------------
; Sprite $19A main. Raiden: main_boo_guy.
;---------------------------------------------------------------------------
YI_NorSpr19A_BooGuy_Main:
main_boo_guy:
;$0C8BAF
	LDY.w $7A36,x
	BEQ.b CODE_0C8BB7
	JMP.w CODE_0C8F5D

CODE_0C8BB7:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_0C8BD3
	LDA.w $7D38,x
	BEQ.b CODE_0C8BD3
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w $6FA2,x
	ORA.w #$0001
	STA.w $6FA2,x
endif
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0180
	CMP.w #$0301
	BCC.b CODE_0C8BD3
	JMP.w CODE_0C8D2F

CODE_0C8BD3:
	JSL.l CODE_03AF23
	LDY.b $16,x
	CPY.b #$04
	BEQ.b CODE_0C8BE5
	JSL.l CODE_03A5B7
	JSL.l CODE_0C8E50
CODE_0C8BE5:
	LDY.b $16,x
	TYX
	JMP.w (DATA_boo_guy_state_ptr,x)

DATA_0C8BEB:
DATA_boo_guy_state_ptr:                         ; 6-entry Boo Guy state ptr (idle / walk / surprise / chase / fade / vanish)
	dw CODE_0C8BF7
	dw CODE_0C8C15
	dw CODE_0C8C5A
	dw CODE_0C8C7F
	dw CODE_0C8CA0
	dw CODE_0C8CCE

CODE_0C8BF7:
	LDX.b $12
	JSR.w CODE_0C8D19
	LDA.w $7A96,x
	BNE.b CODE_0C8C14
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0020
	STA.w $7A96,x
	INC.b $16,x
	INC.b $16,x
CODE_0C8C14:
	RTL

CODE_0C8C15:
	LDX.b $12
	JSR.w CODE_0C8D19
	LDA.w $7A96,x
	BNE.b CODE_0C8C3B
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0040
	STA.w $7A96,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	LDY.w $7400,x
	LDA.w DATA_0C8BAB,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JSR.w CODE_0C8CE6
CODE_0C8C3A:
	RTL

CODE_0C8C3B:
	LDA.w $7AF6,x
	BNE.b CODE_0C8C3A
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.b $10
	AND.w #$000F
	CLC
	ADC.w #$0010
	STA.w $7AF6,x
	RTL

DATA_0C8C56:
	dw $FF00,$0100

CODE_0C8C5A:
	LDX.b $12
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	CLC
	ADC.w #$0003
	JSL.l CODE_0EB8B7
	BEQ.b CODE_0C8C7E
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7A96,x
	LDY.b $16,x
	INY
	INY
	STY.b $16,x
CODE_0C8C7E:
	RTL

CODE_0C8C7F:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0C8C9F
	LDA.w #!Define_YI_SoundID77_EnemyJumpingOutOfPipe
	JSL.l CODE_push_sound_queue
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.b $16,x
	INY
	INY
	STY.b $16,x
CODE_0C8C9F:
	RTL

CODE_0C8CA0:
	LDX.b $12
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	CLC
	ADC.w #$000F
	JSL.l CODE_0EB8B7
	BEQ.b CODE_0C8CCD
	LDY.w $7400,x
	LDA.w DATA_0C8C56,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $6FA2,x
	ORA.w #$0001
	STA.w $6FA2,x
	LDY.b $16,x
	INY
	INY
	STY.b $16,x
CODE_0C8CCD:
	RTL

CODE_0C8CCE:
	LDX.b $12
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0C8CE5
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.w $7B58,x
	LDY.b #$00
	STY.b $16,x
CODE_0C8CE5:
	RTL

CODE_0C8CE6:
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BNE.b CODE_0C8D18
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_0C8D18
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_0C8D18
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0C8D18:
	RTS

CODE_0C8D19:
	LDA.w $7A98,x
	BNE.b CODE_0C8D2E
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w $7402,x
	INC
	AND.w #$0007
	STA.w $7402,x
CODE_0C8D2E:
	RTS

CODE_0C8D2F:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_0C8D3B
	RTL

CODE_0C8D3B:
	LDA.w $7D38,x
	DEC
	BEQ.b CODE_0C8D44
	STA.w $7D38,x
CODE_0C8D44:
	LDY.b $78,x
	TYX
	JMP.w (DATA_boo_guy_burst_state_ptr,x)

DATA_0C8D4A:
DATA_boo_guy_burst_state_ptr:                   ; 2-entry Boo Guy explode/burst state ptr (post-defeat fragment behavior)
	dw CODE_0C8D6A
	dw CODE_0C8DB6

DATA_0C8D4E:
	dw $0200,$FE00,$0000,$0000,$0000,$0000,$FA00,$FA00
	dw $0000,$0000,$FFF0,$FFF0

DATA_0C8D66:
	dw $1000,$F000

CODE_0C8D6A:
	LDX.b $12
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0C8D75
	INY
	INY
CODE_0C8D75:
	TYA
	EOR.w $7400,x
	TAY
	LDA.w DATA_0C8D66,y
	STA.b $18,x
	STZ.w $7402,x
	LDA.w $6FA2,x
	AND.w #$FCFF
	ORA.w #$0001
	STA.w $6FA2,x
	LDA.w #$0008
	STA.w $7B58,x
	LDY.b $78,x
	INY
	INY
	STY.b $78,x
	LDA.w $7722,x
	BMI.b CODE_0C8DAC
	LDA.w $7040,x
	AND.w #$07FC
	ORA.w #$0800
	STA.w $7040,x
	RTL

CODE_0C8DAC:
	LDA.w $7042,x
	ORA.w #$0080
	STA.w $7042,x
	RTL

CODE_0C8DB6:
	LDX.b $12
	LDA.w $7722,x
	BMI.b CODE_0C8DC7
	JSL.l CODE_03AA2E
	JSL.l CODE_0C8E07
	BRA.b CODE_0C8DD3

CODE_0C8DC7:
	LDA.w $7040,x
	AND.w #$07FC
	ORA.w #$1001
	STA.w $7040,x
CODE_0C8DD3:
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_0C8DEE
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	AND.w #$8000
	ASL
	ROL
	ASL
	TAY
	LDA.w DATA_0C8D4E,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
CODE_0C8DEE:
	BIT.w #$000C
	BEQ.b CODE_0C8DF7
	JSL.l CODE_0C8F3F
CODE_0C8DF7:
	JSL.l CODE_0C8EDE
	SEP.b #$20
	LDA.b $18,x
	CLC
	ADC.b $19,x
	STA.b $18,x
	REP.b #$20
	RTL

CODE_0C8E07:
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_0C8E4F
	LDA.w $7722,x
	BMI.b CODE_0C8E4F
	REP.b #$10
	LDA.b $18,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #FXDATA_540000+$5010
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$5010)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7722,x
	TAX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEP.b #$10
	LDX.b #FXCODE_08867E>>16
	LDA.w #FXCODE_08867E
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
CODE_0C8E4F:
	RTL

CODE_0C8E50:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0C8EB4
	BEQ.b CODE_0C8EB4
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0C8EB4
	LDA.w $7D38,y
	BEQ.b CODE_0C8EB4
	PHY
	JSL.l CODE_03AD24
	BCC.b CODE_0C8E70
	JSL.l CODE_0C8E07
CODE_0C8E70:
	PLY
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	AND.w #$8000
	ASL
	ROL
	ASL
	STA.b $00
	JSR.w CODE_0C8EBF
	BCS.b CODE_0C8E8C
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	BRA.b CODE_0C8E91

CODE_0C8E8C:
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
CODE_0C8E91:
	LDX.b $12
	LDY.b #$00
	STY.b $78,x
	LDA.w #$0001
	STA.w $7D38,x
	LDY.b $00
	LDA.w DATA_0C8D4E,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JSL.l CODE_0C8D6A
	LDX.b $12
	LDA.w #!Define_YI_SoundID67_EnemyTumbling
	JSL.l CODE_push_sound_queue
	PLY
	PLA
CODE_0C8EB4:
	RTL

DATA_0C8EB5:
	dw !Define_YI_NorSpr19A_BooGuy
	dw !Define_YI_NorSpr01E_Shyguy
	dw !Define_YI_NorSpr133_LanternGhost
	dw !Define_YI_NorSpr12B_FatGuy
	dw !Define_YI_NorSpr0F3_WoozyGuy

CODE_0C8EBF:
	LDX.b #$08
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
CODE_0C8EC4:
	CMP.w DATA_0C8EB5,x
	BEQ.b CODE_0C8ED1
	DEX
	DEX
	BPL.b CODE_0C8EC4
	LDX.b $12
	CLC
	RTS

CODE_0C8ED1:
	LDX.b $12
	SEC
	RTS

DATA_0C8ED5:
DATA_boo_guy_shell_hit_sound_ids:               ; per-bounce shell-hit pitch sequence for Boo Guy (last index saturates)
	db !Define_YI_SoundID0C_ShellHit2,!Define_YI_SoundID0C_ShellHit2,!Define_YI_SoundID0D_ShellHit3,!Define_YI_SoundID0E_ShellHit4
	db !Define_YI_SoundID0F_ShellHit5,!Define_YI_SoundID10_ShellHit6,!Define_YI_SoundID11_ShellHit7,!Define_YI_SoundID12_ShellHit8
	db !Define_YI_SoundID12_ShellHit8

CODE_0C8EDE:
	LDY.w $7D36,x
	BMI.b CODE_0C8F3F
	PHX
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_0C8EB4
	BEQ.b CODE_0C8EB4
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$000E
	BCC.b CODE_0C8EB4
	LDA.w $6FA2,y
	BIT.w #$6000
	BNE.b CODE_0C8EB4
	JSR.w CODE_0C8EBF
	BCS.b CODE_0C8F16
	LDA.w $6FA0,y
	BIT.w #$0020
	BNE.b CODE_0C8EB4
CODE_0C8F16:
	LDA.b $76,x
	CMP.w #$0008
	BCS.b CODE_0C8F21
	INC.b $76,x
	BRA.b CODE_0C8F2A

CODE_0C8F21:
	PHX
	PHY
	TYX
	JSL.l CODE_spawn_1up_score
	PLY
	PLX
CODE_0C8F2A:
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDX.w $7972
	LDY.b $76,x
	LDA.w DATA_boo_guy_shell_hit_sound_ids,y
	AND.w #$00FF
	JSL.l CODE_push_sound_queue
CODE_0C8F3E:
	RTL

CODE_0C8F3F:
	LDA.w $7CD6,x
	STA.b $00
	LDA.w $7CD8,x
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1E7
	JSL.l CODE_spawn_ambient_stomp_puff_common
	LDA.w #!Define_YI_SoundID0B_ShellHit1
	JSL.l CODE_push_sound_queue
	PLY
	PLA
	JML.l CODE_despawn_sprite_free_slot

CODE_0C8F5D:
CODE_boo_guy_pipe_generator:                    ; pipe enemy generator (Boo Guy twin of CODE_shy_guy_state_08_pipe_generator): init_boo_guy sets the on-pipe flag when spawned on a pipe-mouth tile; when Yoshi nears (and <7 live) spawns a Boo Guy ($19A) that emerges from the pipe
	JSL.l CODE_03AF23
	LDA.w $7A96,x
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	BNE.b CODE_0C8F3E
else
	BNE.b CODE_0C8FE2
endif
	LDX.b #FXCODE_099204>>16
	LDA.w #FXCODE_099204
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0007
	BCS.b CODE_0C8FE2
	LDA.w $7C16,x
	CLC
	ADC.w #$001C
	CMP.w #$0038
	BCS.b CODE_0C8F91
	LDA.w $7C18,x
	CLC
	ADC.w #$0021
	CMP.w #$0042
	BCC.b CODE_0C8FDC
CODE_0C8F91:
	LDA.w #$019A
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0C8FE2
	LDA.w $70E2,x
	STA.w $70E2,y
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	STA.w $7CD6,y
endif
	LDA.w $7182,x
	STA.w $7182,y
	STA.w $7A38,y
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	STA.w $7CD8,y
endif
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0000
	STA.w $7542,y
	LDA.w $6FA2,y
	AND.w #$FFE0
	STA.w $6FA2,y
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,y
	SEP.b #$20
	LDA.b #$00
	STA.w $7862,y
	LDA.b #$04
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	REP.b #$20
	LDA.w #!Define_YI_SoundID76_EnemyPeekingOutOfPipe
	JSL.l CODE_push_sound_queue
CODE_0C8FDC:
	LDA.w #$0080
	STA.w $7A96,x
CODE_0C8FE2:
	RTL

;---------------------------------------------------------------------------
; Sprite $19A head-bop. Raiden: head_bop_boo_guy.
;---------------------------------------------------------------------------
YI_NorSpr19A_BooGuy_StompRt:
head_bop_boo_guy:
;$0C8FE3
	LDA.w $6FA0,x
	AND.w #$F9FF
	STA.w $6FA0,x
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	STZ.w $74A2,x
	LDA.w $7040,x
	AND.w #$FFF3
	ORA.w #$0004
	STA.w $7040,x
	LDA.w $7042,x
	ORA.w #$0080
	LDY.b $16,x
	CPY.b #$06
	BEQ.b CODE_0C9027
	CPY.b #$08
	BEQ.b CODE_0C9027
	ORA.w #$0030
	STA.w $7042,x
CODE_0C9026:
	RTL

CODE_0C9027:
	STA.w $7042,x
	LDA.w $7182,x
	CMP.w $7A38,x
	BMI.b CODE_0C9026
	JML.l CODE_03A31E

;---------------------------------------------------------------------------

DATA_0C9036:
	dw $0007,$0007,$0006,$0005,$0004,$0003,$0002,$0001
	dw $0000

DATA_0C9048:
	dw $0008,$0008,$0008,$0009,$000A,$000B,$000C,$000D
	dw $000E

;---------------------------------------------------------------------------
; Sprite $194: Blargg (lava hazard). Raiden: init_blargg.
;---------------------------------------------------------------------------
YI_NorSpr194_Blargg_Init:
init_blargg:
;$0C905A
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w $7182,x
	STA.w $7A38,x
	LDA.w #$0008
	STA.w $7B56,x
	LDA.w #$000A
	STA.w $7BB6,x
	LDA.w DATA_0C9036
	STA.w $7B58,x
	LDA.w DATA_0C9048
	STA.w $7BB8,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $194 main. Raiden: main_blargg.
;---------------------------------------------------------------------------
YI_NorSpr194_Blargg_Main:
main_blargg:
;$0C9080
	JSL.l CODE_03AF23
	LDA.b $16,x
	TAX
	JMP.w (DATA_blargg_state_ptr,x)

DATA_0C908A:
DATA_blargg_state_ptr:                          ; 4-entry Blargg state ptr (submerged / rise / attack / sink)
	dw CODE_0C9092
	dw CODE_0C915E
	dw CODE_0C921B
	dw CODE_0C9263

CODE_0C9092:
	LDX.b $12
	JSL.l CODE_03A5B7
	JSL.l CODE_0C910B
	JSL.l CODE_0C9284
	LDA.b $18,x
	TAX
	JSR.w (DATA_blargg_substate_ptr,x)
	RTL

DATA_0C90A7:
DATA_blargg_substate_ptr:                       ; 2-entry Blargg sub-state ptr (used while submerged: idle / approach)
	dw CODE_0C90AB
	dw CODE_0C90C3

CODE_0C90AB:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0C90C2
	LDA.w #$0010
	STA.w $7A96,x
	LDA.w #$0004
	STA.w $7A98,x
	INC.b $18,x
	INC.b $18,x
CODE_0C90C2:
	RTS

CODE_0C90C3:
	LDX.b $12
	LDA.w $7A96,x
	BEQ.b CODE_0C90ED
	LDA.w $7A98,x
	BNE.b CODE_0C90EC
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
	ASL
	TAY
	LDA.w DATA_0C9036,y
	STA.w $7B58,x
	LDA.w DATA_0C9048,y
	STA.w $7BB8,x
CODE_0C90EC:
	RTS

CODE_0C90ED:
	STZ.w $7402,x
	LDA.w DATA_0C9036
	STA.w $7B58,x
	LDA.w DATA_0C9048
	STA.w $7BB8,x
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0040
	STA.w $7A96,x
	STZ.b $18,x
	RTS

CODE_0C910B:
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCS.b CODE_0C915D
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	CLC
	ADC.w #$0020
	CMP.w #$0080
	BCS.b CODE_0C915D
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	LDA.w #$0100
	STA.w $75E2,x
	LDA.w #$0010
	STA.w $7542,x
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7402,x
	LDA.w DATA_0C9036
	STA.w $7B58,x
	LDA.w DATA_0C9048
	STA.w $7BB8,x
	STZ.b $18,x
	INC.b $16,x
	INC.b $16,x
	PLY
	PLA
CODE_0C915D:
	RTL

CODE_0C915E:
	LDX.b $12
	JSL.l CODE_03A5B7
	JSL.l CODE_0C92D0
	LDA.b $18,x
	TAX
	JMP.w (DATA_blargg_rise_substate_ptr,x)

DATA_0C916E:
DATA_blargg_rise_substate_ptr:                  ; 2-entry Blargg rise-phase sub-state ptr (emerge / pursue)
	dw CODE_0C9176
	dw CODE_0C91EE

DATA_0C9172:
	dw $FF00,$0100

CODE_0C9176:
	LDX.b $12
	LDA.w $7A38,x
	CLC
	ADC.w #$0010
	CMP.w $7182,x
	BPL.b CODE_0C91D1
	STA.w $7182,x
	LDA.w #$FEA0
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0008
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDY.w $7400,x
	LDA.w DATA_0C9172,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID48_LargeBlockLands
	JSL.l CODE_push_sound_queue
	LDA.w #$000D
	STA.b $76,x
	SEP.b #$20
	TAY
	LDA.w DATA_0C91E0,y
	STA.w $7A96,x
	LDA.w DATA_0C91D2,y
	STA.w $7402,x
	ASL
	TAY
	REP.b #$20
	LDA.w DATA_0C9036,y
	STA.w $7B58,x
	LDA.w DATA_0C9048,y
	STA.w $7BB8,x
	INC.b $18,x
	INC.b $18,x
CODE_0C91D1:
	RTL

DATA_0C91D2:
	db $02,$03,$04,$05,$06,$07,$08,$07,$06,$05,$04,$03,$02,$00

DATA_0C91E0:
	db $02,$02,$02,$02,$02,$02,$18,$02,$02,$02,$02,$02,$02,$10

CODE_0C91EE:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0C9219
	DEC.b $76,x
	BMI.b CODE_0C921A
	SEP.b #$20
	LDY.b $76,x
	LDA.w DATA_0C91E0,y
	STA.w $7A96,x
	LDA.w DATA_0C91D2,y
	STA.w $7402,x
	ASL
	TAY
	REP.b #$20
	LDA.w DATA_0C9036,y
	STA.w $7B58,x
	LDA.w DATA_0C9048,y
	STA.w $7BB8,x
CODE_0C9219:
	RTL

CODE_0C921A:
	RTL

CODE_0C921B:
	LDX.b $12
	LDA.b $18,x
	BEQ.b CODE_0C9236
	LDA.w $7A96,x
	BNE.b CODE_0C9235
	DEC.w $7182,x
	LDA.w $7182,x
	CMP.w $7A38,x
	BNE.b CODE_0C9235
	STZ.b $16,x
	STZ.b $18,x
CODE_0C9235:
	RTL

CODE_0C9236:
	LDA.w $7A38,x
	CLC
	ADC.w #$0020
	CMP.w $7182,x
	BPL.b CODE_0C9262
	STA.w $7182,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7402,x
	LDA.w DATA_0C9036
	STA.w $7B58,x
	LDA.w DATA_0C9048
	STA.w $7BB8,x
	LDA.w #$0080
	STA.w $7A96,x
	INC.b $18,x
CODE_0C9262:
	RTL

CODE_0C9263:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0C9283
	LDA.w $7402,x
	CMP.w #$0001
	BEQ.b CODE_0C9283
	BCS.b CODE_0C9279
	LDA.w #$0001
	BRA.b CODE_0C927A

CODE_0C9279:
	DEC
CODE_0C927A:
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7A96,x
CODE_0C9283:
	RTL

CODE_0C9284:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0C92CF
	BEQ.b CODE_0C92CF
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0C92CF
	LDA.w $7D38,y
	BEQ.b CODE_0C92CF
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDX.b $12
	LDA.w #$0001
	STA.w $7402,x
	ASL
	TAY
	LDA.w DATA_0C9036,y
	STA.w $7B58,x
	LDA.w DATA_0C9048,y
	STA.w $7BB8,x
	LDA.w #$0100
	STA.w $75E2,x
	LDA.w #$0010
	STA.w $7542,x
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.b $18,x
	LDA.w #$0004
	STA.b $16,x
	PLY
	PLA
CODE_0C92CF:
	RTL

CODE_0C92D0:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0C9305
	BEQ.b CODE_0C9305
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0C9305
	LDA.w $7D38,y
	BEQ.b CODE_0C9305
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDX.b $12
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0001
	STA.w $7542,x
	LDA.w #$0100
	STA.w $75E2,x
	LDA.w #$0006
	STA.b $16,x
	PLY
	PLA
CODE_0C9305:
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $184: Bumpty (penguin). Raiden: init_bumpty.
;
; See docs/family-bumpties.md for the full Bumpty family breakdown ($184
; base + $19B Tackling + $19C Flying, all sharing head_bop_common which
; encodes the "can't stomp Bumpties" rule + the contact-mechanic launch).
;---------------------------------------------------------------------------
YI_NorSpr184_Bumpty_Init:
init_bumpty:
;$0C9306
	JSL.l CODE_02A007
	JSR.w CODE_0C9497
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $184 main. Raiden: main_bumpty.
;---------------------------------------------------------------------------
YI_NorSpr184_Bumpty_Main:
main_bumpty:
;$0C930E
	JSL.l CODE_03AF23
	JSR.w CODE_0C9613
	LDA.b $16,x
	TAX
	JMP.w (DATA_bumpty_state_ptr,x)

DATA_0C931B:
DATA_bumpty_state_ptr:                          ; 4-entry Bumpty state ptr (walk / collide-recover / bumped / despawn)
	dw CODE_0C9323
	dw CODE_0C9379
	dw CODE_0C93EF
	dw CODE_0C9408

CODE_0C9323:
	LDX.b $12
	LDA.w $7A38,x
	BEQ.b CODE_0C9345
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_0C9338
	LDA.w $7400,x
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0C9344
CODE_0C9338:
	STZ.w $7A38,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JSR.w CODE_0C9497
CODE_0C9344:
	RTL

CODE_0C9345:
	JSR.w CODE_0C9364
	LDA.w $7860,x
	BIT.w #$000C
	BNE.b CODE_0C935C
	BIT.w #$0001
	BEQ.b CODE_0C935C
	LDA.b $18,x
	TAX
	JSR.w (DATA_bumpty_floor_substate_ptr,x)
	RTL

CODE_0C935C:
	JSR.w CODE_0C9497
	RTL

DATA_0C9360:
DATA_bumpty_floor_substate_ptr:                 ; 2-entry Bumpty floor-hit sub-state ptr (slide / bounce)
	dw CODE_0C9583
	dw CODE_0C9487

CODE_0C9364:
	LDY.w $61CC
	BNE.b CODE_0C936E
	LDA.w $61B2
	BEQ.b CODE_0C936F
CODE_0C936E:
	RTS

CODE_0C936F:
	LDA.w #$0002
	STA.b $16,x
	JSR.w CODE_0C95CB
	PLA
	RTL

CODE_0C9379:
	LDX.b $12
	JSR.w CODE_0C93CE
	JSR.w CODE_0C96CF
	BCS.b CODE_0C93C3
	JSL.l CODE_06BE72
	LDA.w #$0004
	STA.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0006
	STA.w $7402,x
	LDA.b $00
	AND.w #$8000
	ASL
	ROL
	ASL
	STA.w $7400,x
	STZ.b $18,x
	LDA.b $00
	BPL.b CODE_0C93AA
	EOR.w #$FFFF
	INC
CODE_0C93AA:
	ASL
	ASL
	ASL
	ASL
	LDY.b $01
	BPL.b CODE_0C93B6
	EOR.w #$FFFF
	INC
CODE_0C93B6:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	LDA.w $7860
	AND.w #$FFFE
	STA.w $7860
	RTL

CODE_0C93C3:
	LDA.b $18,x
	TAX
	JSR.w CODE_0C94DA
	RTL

UNK_0C93CA:
	dw CODE_0C95CB
	dw CODE_0C94DA

CODE_0C93CE:
	LDA.w $61CC
	ORA.w $61B2
	BNE.b CODE_0C93D7
	RTS

CODE_0C93D7:
	LDA.w #$0000
	STA.b $16,x
	LDA.b $76,x
	BNE.b CODE_0C93E5
	JSR.w CODE_0C9497
	BRA.b CODE_0C93ED

CODE_0C93E5:
	LDA.w #$0002
	STA.b $18,x
	JSR.w CODE_0C9597
CODE_0C93ED:
	PLA
	RTL

CODE_0C93EF:
	LDX.b $12
	JSR.w CODE_0C93FF
	LDA.b $18,x
	TAX
	JSR.w (DATA_bumpty_bumped_substate_ptr,x)
	RTL

DATA_0C93FB:
DATA_bumpty_bumped_substate_ptr:                ; 2-entry Bumpty bumped sub-state ptr (skid / land)
	dw CODE_0C9414
	dw CODE_0C944A

CODE_0C93FF:
	LDA.w $61B2
	CMP.w #$4000
	BNE.b CODE_0C93D7
	RTS

CODE_0C9408:
	LDX.b $12
	JSR.w CODE_0C93FF
	JSR.w CODE_0C96BE
	JSR.w CODE_0C955C
	RTL

CODE_0C9414:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	BMI.b CODE_0C9449
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	JSR.w CODE_0C96BE
	INC.b $18,x
	INC.b $18,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0010
	STA.w $7A96,x
	LDA.w #$0006
	STA.w $7402,x
	LDA.b $10
	AND.w #$0007
	CLC
	ADC.w #$0008
	STA.w $7AF6,x
CODE_0C9449:
	RTS

CODE_0C944A:
	LDX.b $12
	JSR.w CODE_0C96BE
	LDA.w $7A96,x
	BNE.b CODE_0C9468
	LDA.w #$0006
	STA.b $16,x
	LDA.w $77C2,x
	AND.w #$00FF
	EOR.w #$0002
	STA.w $7400,x
	JMP.w CODE_0C95DB

CODE_0C9468:
	LDA.w $7AF6,x
	BNE.b CODE_0C9482
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.b $10
	AND.w #$0007
	CLC
	ADC.w #$0008
	STA.w $7AF6,x
CODE_0C9482:
	RTS

DATA_0C9483:
	dw $FF80,$0080

CODE_0C9487:
	LDX.b $12
	LDA.w #DATA_0C9483
	STA.b $78,x
	LDA.b $76,x
	BNE.b CODE_0C950B
	LDA.w $7A96,x
	BNE.b CODE_0C94BB
CODE_0C9497:
	STZ.b $18,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0040
	STA.w $7A96,x
	LDA.w #$0006
	STA.w $7402,x
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0008
	STA.w $7AF6,x
	RTS

CODE_0C94BB:
	LDA.w $7AF6,x
	BNE.b CODE_0C94D1
	DEC.w $7402,x
	BPL.b CODE_0C94D1
CODE_0C94C5:
	LDA.w #$0005
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7AF6,x
CODE_0C94D1:
	RTS

DATA_0C94D2:
	dw $FF00,$0100

DATA_0C94D6:
	dw $FE00,$0200

CODE_0C94DA:
	LDX.b $12
	LDA.w #DATA_0C94D6
	STA.b $78,x
	LDA.b $76,x
	BNE.b CODE_0C950B
	JSR.w CODE_0C969E
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6
	STA.b $00
	LDA.w $7400,x
	DEC
	EOR.b $00
	BMI.b CODE_0C94BB
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_0C94D2,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_0C94BB

CODE_0C950B:
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_0C9530
	BIT.w #$000C
	BEQ.b CODE_0C9521
	LDY.w $7400,x
	LDA.w DATA_0C94D2,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0C9521:
	LDA.w #$0007
	LDY.w $7223,x
	BMI.b CODE_0C952C
	LDA.w #$0008
CODE_0C952C:
	STA.w $7402,x
	RTS

CODE_0C9530:
	LDA.b $76,x
	CMP.w #$0001
	BNE.b CODE_0C9545
	LDA.w #$0009
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7AF6,x
	INC.b $76,x
CODE_0C9545:
	LDA.w $7AF6,x
	BNE.b CODE_0C955B
	LDY.w $7400,x
	LDA.b $78,x
	STA.b $00
	LDA.b ($00),y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $76,x
	JMP.w CODE_0C94C5

CODE_0C955B:
	RTS

CODE_0C955C:
	LDX.b $12
	LDA.w #DATA_0C94D6
	STA.b $78,x
	LDA.b $76,x
	BNE.b CODE_0C950B
	LDA.w $7860,x
	BIT.w #$000C
	BNE.b CODE_0C9577
	BIT.w #$0001
	BEQ.b CODE_0C9580
	JMP.w CODE_0C94BB

CODE_0C9577:
	LDY.w $7400,x
	LDA.w DATA_0C94D6,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0C9580:
	JMP.w CODE_0C95DB

CODE_0C9583:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0C95B0
	INC.b $18,x
	INC.b $18,x
	LDY.w $7400,x
	LDA.w DATA_0C9483,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0C9597:
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0040
	STA.w $7A96,x
	LDA.w #$0005
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7AF6,x
	RTS

CODE_0C95B0:
	LDA.w $7AF6,x
	BNE.b CODE_0C95CA
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0008
	STA.w $7AF6,x
CODE_0C95CA:
	RTS

CODE_0C95CB:
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6
	AND.w #$8000
	ASL
	ROL
	ASL
	STA.w $7400,x
CODE_0C95DB:
	LDA.w #$0001
	STA.b $76,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	RTS

CODE_0C95F0:
	LDA.w $7AF6,x
	BNE.b CODE_0C960A
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0008
	STA.w $7AF6,x
CODE_0C960A:
	RTS

DATA_0C960B:
	dw $FD00,$0300

DATA_0C960F:
	dw $0180,$0060

CODE_0C9613:
	LDY.w $7D36,x
	BMI.b CODE_0C9621
	CPX.w $61B6
	BNE.b CODE_0C960A
	STZ.w $61B6
	RTS

CODE_0C9621:
	LDA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	BEQ.b CODE_0C962B
	PLA
	JML.l CODE_kill_sprite_by_hit_special_cases

CODE_0C962B:
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_0C964C
	LDA.w $60AA
	BMI.b CODE_0C95CA
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	JSL.l CODE_03B20B
	RTS

CODE_0C964C:
	LDA.w $60AA
	BPL.b CODE_0C965B
	STZ.w $60AA
	STZ.w $60C0
	STZ.w $60D2
	RTS

CODE_0C965B:
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	LDY.w $77C2,x
	LDA.w $60FC
	AND.w DATA_0C960F,y
	BNE.b CODE_0C9676
	LDA.w DATA_0C960B,y
	STA.w $60A8
	STA.w $60B4
CODE_0C9676:
	LDA.b $16,x
	CMP.w #$0000
	BNE.b CODE_0C9699
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	TAY
	LDA.w DATA_0C969A,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0010
	STA.w $7540,x
	LDA.w #$0001
	STA.w $7A38,x
CODE_0C9699:
	RTS

DATA_0C969A:
	dw $0100,$FF00

CODE_0C969E:
	LDY.w $7400,x
	LDA.w $7860,x
	BIT.w #$000C
	BEQ.b CODE_0C96AE
	LDA.w DATA_0C94D2,y
	BRA.b CODE_0C96B6

CODE_0C96AE:
	BIT.w #$0001
	BNE.b CODE_0C96BD
	LDA.w DATA_0C94D6,y
CODE_0C96B6:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLA
	JMP.w CODE_0C95DB

CODE_0C96BD:
	RTS

CODE_0C96BE:
	LDA.w $70E2,x
	STA.w $70E2
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182
	RTS

CODE_0C96CF:
	LDA.w $7BB6,x
	CLC
	ADC.w $7BB6
	STA.b $04
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6
	STA.b $00
	BPL.b CODE_0C96E7
	EOR.w #$FFFF
	INC
CODE_0C96E7:
	CMP.b $04
	BCS.b CODE_0C9705
	LDA.w $7BB8,x
	CLC
	ADC.w $7BB8
	STA.b $04
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8
	STA.b $02
	BPL.b CODE_0C9703
	EOR.w #$FFFF
	INC
CODE_0C9703:
	CMP.b $04
CODE_0C9705:
	RTS

;---------------------------------------------------------------------------

DATA_0C9706:
	dw $FE58,$01A8

;---------------------------------------------------------------------------
; Sprite $19B: Tackling Bumpty. Raiden: init_bumpty_tackling.
;---------------------------------------------------------------------------
YI_NorSpr19B_TacklingBumpty_Init:
init_bumpty_tackling:
;$0C970A
	LDA.w $7400,x
	STA.b $76,x
	TAY
	LDA.w DATA_0C9706,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0008
	STA.w $7A98,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $19B main. Raiden: main_bumpty_tackling.
;---------------------------------------------------------------------------
YI_NorSpr19B_TacklingBumpty_Main:
main_bumpty_tackling:
;$0C971D
	JSL.l CODE_03AF23
	JSL.l CODE_0C9926
	LDA.b $16,x
	TAX
	JMP.w (DATA_bumpty_tackling_state_ptr,x)

DATA_0C972B:
DATA_bumpty_tackling_state_ptr:                 ; 6-entry Tackling Bumpty state ptr (walk / charge / tackle / recover / fall / despawn)
	dw CODE_0C9737
	dw CODE_0C9797
	dw CODE_0C9845
	dw CODE_0C98BA
	dw CODE_0C97F5
	dw CODE_0C98E8

CODE_0C9737:
	LDX.b $12
	JSR.w CODE_0C990C
	LDA.b $18,x
	BNE.b CODE_0C9771
	LDA.w $7A96,x
	BNE.b CODE_0C975F
	LDA.w $7A98,x
	BEQ.b CODE_0C9760
	LDA.w #$0002
	STA.w $7A96,x
	LDA.w $7402,x
	DEC
	CMP.w #$0006
	BCC.b CODE_0C975C
	LDA.w #$0005
CODE_0C975C:
	STA.w $7402,x
CODE_0C975F:
	RTL

CODE_0C9760:
	LDA.w #$0006
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7A96,x
	INC.b $16,x
	INC.b $16,x
	RTL

CODE_0C9771:
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_0C9788
	LDA.w #$0007
	LDY.w $7223,x
	BMI.b CODE_0C9784
	LDA.w #$0008
CODE_0C9784:
	STA.w $7402,x
	RTL

CODE_0C9788:
	LDA.w #$0009
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7A96,x
	STZ.b $18,x
	RTL

CODE_0C9797:
	LDX.b $12
	JSR.w CODE_0C990C
	LDA.b $18,x
	BNE.b CODE_0C9771
	LDA.w $7A96,x
	BNE.b CODE_0C97B5
	LDA.w $7402,x
	CMP.w #$0006
	BNE.b CODE_0C97B6
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $18,x
CODE_0C97B5:
	RTL

CODE_0C97B6:
	LDA.w #$0006
	STA.b $78,x
	TAY
	LDA.w DATA_0C9836,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0C97CE
	EOR.w #$FFFF
	INC
CODE_0C97CE:
	LSR
	LSR
	AND.w #$0007
	TAY
	LDA.w DATA_0C983D,y
	AND.w #$00FF
	STA.w $7A96,x
	LDA.w #$0004
	STA.w $7540,x
	LDA.w $6FA2,x
	AND.w #$FF3F
	ORA.w #$0080
	STA.w $6FA2,x
	LDA.w #$0004
	STA.b $16,x
	RTL

CODE_0C97F5:
	LDX.b $12
	LDA.b $18,x
	BEQ.b CODE_0C97FE
	JMP.w CODE_0C9771

CODE_0C97FE:
	LDA.w $7A96,x
	BNE.b CODE_0C9818
	DEC.b $78,x
	BMI.b CODE_0C9819
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	STA.b $76,x
CODE_0C9818:
	RTL

CODE_0C9819:
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	STA.b $76,x
	TAY
	LDA.w DATA_0C9706,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0008
	STA.w $7A98,x
	STZ.b $78,x
	STZ.b $16,x
	RTL

DATA_0C9836:
	db $0D,$0A,$0B,$0C,$0C,$0B,$0A

DATA_0C983D:
	db $0B,$0A,$09,$08,$07,$06,$05,$04

CODE_0C9845:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_0C9897
	LDA.b $76,x
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0C9897
	LDA.w $7A96,x
	BNE.b CODE_0C9896
	DEC.b $78,x
	BPL.b CODE_0C9862
	LDA.w #$0006
	STA.b $78,x
CODE_0C9862:
	LDY.b $78,x
	LDA.w DATA_0C9836,y
	AND.w #$00FF
	STA.w $7402,x
	CPY.b #$06
	BEQ.b CODE_0C9875
	CPY.b #$03
	BNE.b CODE_0C987E
CODE_0C9875:
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_0C987E:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0C9887
	EOR.w #$FFFF
	INC
CODE_0C9887:
	LSR
	LSR
	AND.w #$0007
	TAY
	LDA.w DATA_0C983D,y
	AND.w #$00FF
	STA.w $7A96,x
CODE_0C9896:
	RTL

CODE_0C9897:
	LDA.w $6FA2,x
	AND.w #$FF3F
	ORA.w #$0040
	STA.w $6FA2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w #$0040
	STA.w $7A96,x
	LDA.b $76,x
	STA.w $7400,x
	LDA.w #$0006
	STA.b $16,x
	RTL

CODE_0C98BA:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0C98D5
	LDA.w $7402,x
	CMP.w #$0006
	BEQ.b CODE_0C98D6
	LDA.w #$0006
	STA.w $7402,x
	LDA.w #$0008
	STA.w $7A96,x
CODE_0C98D5:
	RTL

CODE_0C98D6:
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0003
	STA.b $78,x
	INC.b $18,x
	INC.b $16,x
	INC.b $16,x
	RTL

CODE_0C98E8:
	LDX.b $12
	LDY.b #$00
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_0C98F6
	LDY.b #$10
CODE_0C98F6:
	TYA
	STA.w $7540,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_0C9908
	LDA.w $7400,x
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0C990B
CODE_0C9908:
	JMP.w CODE_0C9897

CODE_0C990B:
	RTL

CODE_0C990C:
	LDA.w $7860,x
	BIT.w #$000C
	BEQ.b CODE_0C9919
	LDA.w $7400,x
	STA.b $76,x
CODE_0C9919:
	RTS

DATA_0C991A:
	dw $FD00,$0300

DATA_0C991E:
	dw $0180,$0060

DATA_0C9922:
	dw $0100,$FF00

CODE_0C9926:
	LDY.w $7D36,x
	BMI.b CODE_0C9935
	CPX.w $61B6
	BNE.b CODE_0C9960
	STZ.w $61B6
	BRA.b CODE_0C9960

CODE_0C9935:
	LDA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	BEQ.b CODE_0C9940
	PLY
	PLA
	JML.l CODE_kill_sprite_by_hit_special_cases

CODE_0C9940:
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_0C9961
	LDA.w $60AA
	BMI.b CODE_0C9960
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	JSL.l CODE_03B20B
CODE_0C9960:
	RTL

CODE_0C9961:
	LDA.w $60AA
	BPL.b CODE_0C9970
	STZ.w $60AA
	STZ.w $60C0
	STZ.w $60D2
	RTL

CODE_0C9970:
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	LDY.w $77C2,x
	LDA.w $60FC
	AND.w DATA_0C991E,y
	BNE.b CODE_0C998B
	LDA.w DATA_0C991A,y
	STA.w $60A8
	STA.w $60B4
CODE_0C998B:
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	STA.b $76,x
	TAY
	LDA.w DATA_0C9922,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$000A
	STA.w $7402,x
	LDA.w #$000A
	STA.b $16,x
	RTL

;---------------------------------------------------------------------------

DATA_0C99A9:
	dw $FFE8,$0018

DATA_0C99AD:
	dw $0800,$F800

DATA_0C99B1:
	dw $FF80,$0080

;---------------------------------------------------------------------------
; Sprite $19C: Flying Bumpty. Raiden: init_bumpty_flying.
;---------------------------------------------------------------------------
YI_NorSpr19C_FlyingBumpty_Init:
init_bumpty_flying:
;$0C99B5
	LDA.w $7182,x
	STA.w $7A36,x
	SEC
	SBC.w #$0008
	STA.w $7182,x
	LDA.w DATA_0C99AD
	STA.w $75E2,x
	LDA.w #$0008
	STA.w $7542,x
	LDA.w $70E2,x
	BIT.w #$0010
	BNE.b CODE_0C99FB
	STA.w $7A38,x
	STZ.b $16,x
	LDY.w $7400,x
	CLC
	ADC.w DATA_0C99A9,y
	STA.w $70E2,x
	LDA.w DATA_0C99AD,y
	STA.w $75E0,x
	LDA.w #$0002
	STA.w $7540,x
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	RTL

CODE_0C99FB:
	LDA.w #$0002
	STA.b $16,x
	LDY.w $7400,x
	LDA.w DATA_0C99B1,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $6FA2,x
	ORA.w #$0001
	STA.w $6FA2,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $19C main. Raiden: main_bumpty_flying.
;---------------------------------------------------------------------------
YI_NorSpr19C_FlyingBumpty_Main:
main_bumpty_flying:
;$0C9A13
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_0C9A23
	LDA.w #!Define_YI_NorSpr184_Bumpty
	TXY
	JML.l CODE_spawn_sprite

CODE_0C9A23:
	JSL.l CODE_03AF23
	JSL.l CODE_0C9B02
	LDY.b #$00
	LDA.w $7182,x
	CMP.w $7A36,x
	BMI.b CODE_0C9A37
	INY
	INY
CODE_0C9A37:
	LDA.w DATA_0C99AD,y
	STA.w $75E2,x
	LDA.b $16,x
	TAX
	JMP.w (DATA_bumpty_flying_state_ptr,x)

DATA_0C9A43:
DATA_bumpty_flying_state_ptr:                   ; 2-entry Flying Bumpty state ptr (hover / dive)
	dw CODE_0C9A47
	dw CODE_0C9A97

CODE_0C9A47:
	LDX.b $12
	LDY.b #$00
	LDA.w $70E2,x
	CMP.w $7A38,x
	BMI.b CODE_0C9A55
	INY
	INY
CODE_0C9A55:
	LDA.w DATA_0C99AD,y
	STA.w $75E0,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0008
	CMP.w #$0010
	BCS.b CODE_0C9A81
	LDA.w #$0000
	STA.w $7402,x
	LDA.w $7400,x
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0C9A7F
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_0C9A7F:
	BRA.b CODE_0C9A96

CODE_0C9A81:
	LDY.b #$00
	LDA.w $7400,x
	DEC
	EOR.w $75E0,x
	BPL.b CODE_0C9A8E
	INY
	INY
CODE_0C9A8E:
	LDA.w DATA_0C9ADF,y
	STA.b $00
	JSR.w CODE_0C9AE7
CODE_0C9A96:
	RTL

CODE_0C9A97:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_0C9AA7
	LDA.w DATA_0C9ADF
	STA.b $00
	JSR.w CODE_0C9AE7
	RTL

CODE_0C9AA7:
	LDA.w $7A96,x
	BNE.b CODE_0C9ADE
	SEP.b #$20
	LDA.b #$00
	STA.w $7402,x
	LDA.b #$02
	STA.w $7A96,x
	INC.b $77,x
	REP.b #$20
	LDY.b $77,x
	CPY.b #$02
	BNE.b CODE_0C9ACB
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_0C9ACB:
	CPY.b #$03
	BCC.b CODE_0C9ADE
	SEP.b #$20
	STZ.b $77,x
	REP.b #$20
	LDY.w $7400,x
	LDA.w DATA_0C99B1,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0C9ADE:
	RTL

DATA_0C9ADF:
	dw DATA_0C9AE3,DATA_0C9AE5

DATA_0C9AE3:
	db $01,$02

DATA_0C9AE5:
	db $03,$04

CODE_0C9AE7:
	LDA.w $7A96,x
	BNE.b CODE_0C9B01
	SEP.b #$20
	LDA.b $76,x
	EOR.b #$01
	STA.b $76,x
	TAY
	LDA.b ($00),y
	STA.w $7402,x
	LDA.b #$03
	STA.w $7A96,x
	REP.b #$20
CODE_0C9B01:
	RTS

CODE_0C9B02:
	LDY.w $7D36,x
	BMI.b CODE_0C9B11
	CPX.w $61B6
	BNE.b CODE_0C9B3C
	STZ.w $61B6
	BRA.b CODE_0C9B3C

CODE_0C9B11:
	LDA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	BEQ.b CODE_0C9B1C
	PLY
	PLA
	JML.l CODE_kill_sprite_by_hit_special_cases

CODE_0C9B1C:
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_0C9B3D
	LDA.w $60AA
	BMI.b CODE_0C9B3C
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	JSL.l CODE_03B20B
CODE_0C9B3C:
	RTL

CODE_0C9B3D:
	LDA.w $60AA
	BPL.b CODE_0C9B4C
	STZ.w $60AA
	STZ.w $60C0
	STZ.w $60D2
	RTL

CODE_0C9B4C:
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	LDY.w $77C2,x
	LDA.w $60FC
	AND.w DATA_0C991E,y
	BNE.b CODE_0C9B67
	LDA.w DATA_0C991A,y
	STA.w $60A8
	STA.w $60B4
CODE_0C9B67:
	RTL


;---------------------------------------------------------------------------

DATA_0C9B68:
	dw $FF00,$0100

;---------------------------------------------------------------------------
; Sprite $19D: Skeleton Goonie. Raiden: init_skeleton_goonie.
;
; See docs/family-goonies.md for the full Goonie family breakdown -- this
; bank carries the Skeleton tribe ($19D winged / $19E wingless / $19F with
; bomb) sharing morph-on-status patterns via CODE_spawn_sprite re-tags.
;---------------------------------------------------------------------------
YI_NorSpr19D_SkeletonGoonie_Init:
init_skeleton_goonie:
;$0C9B6C
	LDY.w $7400,x
	LDA.w DATA_0C9B68,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w #$0008
	STA.w $7402,x
	ASL
	TAY
	LDA.w DATA_0C9BBC,y
	STA.w $7CD8,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $19D main. Raiden: main_skeleton_goonie.
;---------------------------------------------------------------------------
YI_NorSpr19D_SkeletonGoonie_Main:
main_skeleton_goonie:
;$0C9B8A
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_0C9BA6
	LDA.w #!Define_YI_AmbSpr216
	STA.b $06
	LDA.w #$0000
	JSL.l CODE_0C9C8A
	LDA.w #!Define_YI_NorSpr19E_WinglessSkeletonGoonie
	TXY
	JML.l CODE_spawn_sprite

CODE_0C9BA6:
	JSL.l CODE_03AF23
	JSL.l CODE_07E336
	JSL.l CODE_03A5B7
	JSR.w CODE_0C9C23
	JSR.w CODE_0C9BF2
	JSR.w CODE_0C9BCE
	RTL

DATA_0C9BBC:
	dw $0008,$0007,$0007,$0006,$0006,$0007,$0007,$0008
	dw $0008

CODE_0C9BCE:
	LDA.w $7A96,x
	BNE.b CODE_0C9BF1
	SEP.b #$20
	DEC.w $7402,x
	BPL.b CODE_0C9BDF
	LDA.b #$08
	STA.w $7402,x
CODE_0C9BDF:
	LDA.b #$04
	STA.w $7A96,x
	LDA.w $7402,x
	ASL
	TAY
	REP.b #$20
	LDA.w DATA_0C9BBC,y
	STA.w $7CD8,x
CODE_0C9BF1:
	RTS

CODE_0C9BF2:
	LDA.w $7A98,x
	BNE.b CODE_0C9C22
	LDA.w #!Define_YI_AmbSpr215
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$FFFF
	STA.w $7782,y
	LDA.w #$00C0
	STA.w $7E8E,y
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0040
	STA.w $7A98,x
CODE_0C9C22:
	RTS

CODE_0C9C23:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0C9C47
	BEQ.b CODE_0C9C47
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0C9C47
	LDA.w $7D38,y
	BEQ.b CODE_0C9C47
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDX.b $12
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	PLA
	RTL

CODE_0C9C47:
	RTS

;---------------------------------------------------------------------------
; Sprite $19D head-bop. Raiden: head_bop_skeleton_goonie.
;---------------------------------------------------------------------------
YI_NorSpr19D_SkeletonGoonie_StompRt:
head_bop_skeleton_goonie:
;$0C9C48
	JSL.l CODE_0C9C7B
	LDA.w #!Define_YI_NorSpr19E_WinglessSkeletonGoonie
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	RTL

DATA_0C9C5B:
	dw $FE80,$FF00,$FF80,$0000,$0080,$0100,$0180,$0200

DATA_0C9C6B:
	dw $FC00,$FC80,$FD00,$FD80,$FE00,$FE80,$FF00,$FF80

CODE_0C9C7B:
	LDA.w #!Define_YI_AmbSpr216
CODE_0C9C7E:
	STA.b $06
	LDA.w #!Define_YI_SoundID07_GoonieLoseWings
	JSL.l CODE_push_sound_queue
	LDA.w #$0004
CODE_0C9C8A:
	STA.b $00
CODE_0C9C8C:
	LDA.b $10
	AND.w #$0007
	ASL
	TAY
	LDA.w DATA_0C9C5B,y
	STA.b $02
	LDA.b $10
	AND.w #$0038
	LSR
	LSR
	TAY
	LDA.w DATA_0C9C6B,y
	STA.b $04
	LDA.b $06
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0040
	STA.w $7782,y
	LDA.w #$0002
	STA.w $7E8E,y
	LDA.w #$0003
	STA.w $73C2,y
	STA.w $7E4C,y
	LDA.w $7CD6,x
	SEC
	SBC.w #$0004
	STA.w $70A2,y
	LDA.w $7CD8,x
	SEC
	SBC.w #$0004
	STA.w $7142,y
	LDA.w #$0020
	STA.w $7502,y
	LDA.w #$0200
	STA.w $75A2,y
	LDA.b $02
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $04
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	JSL.l CODE_random_number_gen
	DEC.b $00
	BPL.b CODE_0C9C8C
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $19E: Wingless Skeleton Goonie. Raiden: init_skeleton_goonie_flightless.
;---------------------------------------------------------------------------
YI_NorSpr19E_WinglessSkeletonGoonie_Init:
init_skeleton_goonie_flightless:
;$0C9CF3
	LDA.w #$0002
	STA.b $16,x
	RTL

;---------------------------------------------------------------------------

DATA_0C9CF9:
	dw $FE00,$0200

;---------------------------------------------------------------------------
; Sprite $19E main. Raiden: main_skeleton_goonie_flightless.
;---------------------------------------------------------------------------
YI_NorSpr19E_WinglessSkeletonGoonie_Main:
main_skeleton_goonie_flightless:
;$0C9CFD
	JSL.l CODE_03AF23
	JSL.l CODE_03A5B7
	LDY.b $16,x
	TYX
	JMP.w (DATA_skeleton_goonie_flightless_state_ptr,x)

DATA_0C9D0B:
DATA_skeleton_goonie_flightless_state_ptr:      ; 3-entry Wingless Skeleton Goonie state ptr (walk / fall / despawn)
	dw CODE_0C9D11
	dw CODE_0C9D26
	dw CODE_0C9D3B

CODE_0C9D11:
	LDX.b $12
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_0C9D25
	LDA.w #$0040
	STA.w $7A96,x
	INC.b $16,x
	INC.b $16,x
CODE_0C9D25:
	RTL

CODE_0C9D26:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0C9D3A
	LDY.w $7400,x
	LDA.w DATA_0C9CF9,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.b $16,x
	INC.b $16,x
CODE_0C9D3A:
	RTL

CODE_0C9D3B:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0C9D55
	SEP.b #$20
	DEC.w $7402,x
	BPL.b CODE_0C9D4E
	LDA.b #$02
	STA.w $7402,x
CODE_0C9D4E:
	LDA.b #$02
	STA.w $7A96,x
	REP.b #$20
CODE_0C9D55:
	RTL

;---------------------------------------------------------------------------

DATA_0C9D56:
	dw $0001,$FFFF

DATA_0C9D5A:
	dw $0010,$000F,$000E,$000D,$000D,$000E,$000F,$0010
	dw $0011

;---------------------------------------------------------------------------
; Sprite $19F: Skeleton Goonie carrying bomb. Raiden: init_skeleton_goonie_with_bomb.
;---------------------------------------------------------------------------
YI_NorSpr19F_SkeletonGoonieCarryingBomb_Init:
init_skeleton_goonie_with_bomb:
;$0C9D6C
	LDY.w $7400,x
	LDA.w DATA_0C9B68,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w #$0008
	STA.w $7402,x
	ASL
	TAY
	LDA.w DATA_0C9BBC,y
	STA.w $7CD8,x
	LDA.w $7182,x
	CLC
	ADC.w DATA_0C9D5A,y
	STA.b $02
	LDY.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_0C9D56,y
	STA.b $00
	LDA.w #$0060
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0C9DEC
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.b $00
	STA.w $70E2,y
	LDA.b $02
	STA.w $7182,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.w $6FA2,y
	AND.w #$FFE0
	STA.w $6FA2,y
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0030
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	SEP.b #$20
	LDA.b #$7F
	STA.w $7863,y
	LDA.b #$00
	STA.w $7862,y
	REP.b #$20
	TYA
	STA.w $7A36,x
	RTL

;---------------------------------------------------------------------------

CODE_0C9DEC:
	LDA.w #!Define_YI_NorSpr19D_SkeletonGoonie
	TXY
	JML.l CODE_spawn_sprite

;---------------------------------------------------------------------------
; Sprite $19F main. Raiden: main_skeleton_goonie_with_bomb.
;---------------------------------------------------------------------------
YI_NorSpr19F_SkeletonGoonieCarryingBomb_Main:
main_skeleton_goonie_with_bomb:
;$0C9DF4
	JSR.w CODE_0C9F9D
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_0C9E34
	LDY.w $7A36,x
	LDA.w $6FA2,y
	ORA.w #$001B
	STA.w $6FA2,y
	LDA.w $7040,y
	ORA.w #$0004
	STA.w $7040,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w #!Define_YI_AmbSpr216
	STA.b $06
	LDA.w #$0000
	JSL.l CODE_0C9C8A
	LDA.w #!Define_YI_NorSpr19E_WinglessSkeletonGoonie
	TXY
	JML.l CODE_spawn_sprite

CODE_0C9E34:
	CMP.w #$0010
	BNE.b CODE_0C9E3E
	LDA.w $7D96,x
	BEQ.b CODE_0C9E74
CODE_0C9E3E:
	LDY.w $7A36,x
	LDA.w $6FA2,y
	ORA.w #$001B
	STA.w $6FA2,y
	LDA.w $7040,y
	ORA.w #$0004
	STA.w $7040,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w #!Define_YI_NorSpr19D_SkeletonGoonie
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	RTL

CODE_0C9E74:
	JSL.l CODE_03AF23
	JSR.w CODE_0C9F76
	LDY.w $7D36,x
	BPL.b CODE_0C9EC2
	LDA.w $60D4
	BEQ.b CODE_0C9EC2
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_0C9EC2
	LDY.w $7A36,x
	LDA.w $6FA2,y
	ORA.w #$001B
	STA.w $6FA2,y
	LDA.w $7040,y
	ORA.w #$0004
	STA.w $7040,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	JSL.l CODE_0C9C7B
	JSL.l CODE_0CFF61
	JML.l CODE_kill_sprite_by_hit

CODE_0C9EC2:
	JSL.l CODE_03A5B7
	JSR.w CODE_0C9EFE
	JSR.w CODE_0C9C23
	JSR.w CODE_0C9BF2
	JSR.w CODE_0C9BCE
	JSR.w CODE_0C9ED6
	RTL

CODE_0C9ED6:
	LDY.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_0C9D56,y
	STA.b $00
	LDA.w $7402,x
	ASL
	TAY
	LDA.w $7182,x
	CLC
	ADC.w DATA_0C9D5A,y
	STA.b $02
	LDY.w $7A36,x
	LDA.b $00
	STA.w $70E2,y
	LDA.b $02
	STA.w $7182,y
	RTS

CODE_0C9EFE:
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	BMI.b CODE_0C9F0C
	CMP.w #$0010
	BPL.b CODE_0C9F75
CODE_0C9F0C:
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_0C9F75
	LDY.w $7A36,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w $6FA2,y
	ORA.w #$001B
	STA.w $6FA2,y
	LDA.w $7040,y
	ORA.w #$0004
	STA.w $7040,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w $7402,x
	STA.b $00
	LDA.w $7A96,x
	STA.b $02
	LDA.w $7A98,x
	STA.b $04
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.b $06
	LDA.w #!Define_YI_NorSpr19D_SkeletonGoonie
	TXY
	JSL.l CODE_spawn_sprite
	LDA.b $06
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $04
	STA.w $7A98,x
	LDA.b $02
	STA.w $7A96,x
	LDA.b $00
	STA.w $7402,x
	PLA
	RTL

CODE_0C9F75:
	RTS

CODE_0C9F76:
	JSL.l CODE_03A2F8
	BCC.b CODE_0C9F9C
	LDY.w $7A36,x
	CPY.b #$60
	BCS.b CODE_0C9F9A
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0C9F9A
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr060_Bomb
	BNE.b CODE_0C9F9A
	TYX
	JSL.l CODE_03A31E
	LDX.b $12
CODE_0C9F9A:
	PLA
	RTL

CODE_0C9F9C:
	RTS

CODE_0C9F9D:
	LDY.w $7A36,x
	CPY.b #$60
	BCS.b CODE_0C9FB4
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0C9FB4
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr060_Bomb
	BEQ.b CODE_0C9F9C
CODE_0C9FB4:
	LDA.w $7402,x
	PHA
	LDA.w $7A96,x
	PHA
	LDA.w $7A98,x
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PHA
	LDA.w #!Define_YI_NorSpr19D_SkeletonGoonie
	TXY
	JSL.l CODE_spawn_sprite
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLA
	STA.w $7A98,x
	PLA
	STA.w $7A96,x
	PLA
	STA.w $7402,x
	PLA
	RTL

;---------------------------------------------------------------------------
; Sprite $19F head-bop. Raiden: head_bop_skeleton_goonie_bomb.
;---------------------------------------------------------------------------
YI_NorSpr19F_SkeletonGoonieCarryingBomb_StompRt:
head_bop_skeleton_goonie_bomb:
;$0C9FDE
	LDY.w $7A36,x
	LDA.w $6FA2,y
	ORA.w #$001B
	STA.w $6FA2,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	JSL.l CODE_0C9C7B
	LDA.w #!Define_YI_NorSpr19E_WinglessSkeletonGoonie
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

DATA_0CA003:
	dw $4202,$0202,$4200,$0200

DATA_0CA00B:
	dw $FF00,$0100

;---------------------------------------------------------------------------
; Sprites $1A0/$1A1: Double Firebar / single Firebar. Raiden: init_firebar
; (shared between the two variants -- the size/count is encoded in extra fields).
;---------------------------------------------------------------------------
YI_NorSpr1A0_DoubleFirebar_Init:
YI_NorSpr1A1_Firebar_Init:
init_firebar:
;$0CA00F
	STZ.w $7400,x
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	TAY
	LDA.w DATA_0CA00B,y
	STA.b $78,x
	LDA.w $70E2,x
	CLC
	ADC.w #$FFF8
	STA.w $70E2,x
	LDA.w #$FFB8
	STA.b $18,x
	LDA.w #$0003
	STA.b $76,x
	LDA.w #$0006
	STA.w $7A96,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprites $1A0/$1A1 main (shared). Raiden: main_firebar.
;---------------------------------------------------------------------------
YI_NorSpr1A0_DoubleFirebar_Main:
YI_NorSpr1A1_Firebar_Main:
main_firebar:
;$0CA03C
	LDA.w #DATA_0CA003>>16
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #DATA_0CA003
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0896DF>>16
	LDA.w #FXCODE_0896DF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	JSL.l CODE_03AF23
	LDY.w $7D36,x
	BPL.b CODE_0CA060
	JSL.l CODE_03A858
CODE_0CA060:
	LDA.b $16,x
	CLC
	ADC.b $78,x
	STA.b $16,x
	LDA.w $7A96,x
	BNE.b CODE_0CA07D
	SEP.b #$20
	DEC.b $76,x
	BPL.b CODE_0CA076
	LDA.b #$03
	STA.b $76,x
CODE_0CA076:
	LDA.b #$06
	STA.w $7A96,x
	REP.b #$20
CODE_0CA07D:
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $02F: Little Mouser nest (the hole). Raiden: init_little_mouser_nest.
;
; See docs/family-misc.md §4 for the full Mouser family breakdown -- this
; bank carries the $02F nest + $030 walking mouse + $032 peeking + $033
; exiting choreography. The 8-substate exit ($033) only runs in castle
; tileset (LevelHeaderBG1Tileset == 3) -- the most expensive Mouser
; animation in the game runs in exactly one tileset.
;---------------------------------------------------------------------------
YI_NorSpr02F_LittleMouserHole_Init:
init_little_mouser_nest:
;$0CA07E
	STZ.w $7400,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $02F main. Raiden: main_little_mouser_nest.
;---------------------------------------------------------------------------
YI_NorSpr02F_LittleMouserHole_Main:
main_little_mouser_nest:
;$0CA082
	JSL.l CODE_03AF23
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $032: Little Mouser peeking out of the nest. Raiden: init_little_mouser_in_nest.
;---------------------------------------------------------------------------
YI_NorSpr032_PeekingLittleMouser_Init:
init_little_mouser_in_nest:
;$0CA087
	STZ.w $7400,x
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	STA.b $16,x
	TAX
	JMP.w (DATA_peeking_mouser_init_variant_ptr,x)

DATA_0CA099:
DATA_peeking_mouser_init_variant_ptr:           ; 2-entry Peeking Little Mouser init variant (by $70E2 bit-4 / cell-column parity: even = peek-animation loop forever, odd = emerge-and-hop sequence). NOT left/right-facing (old misgloss).
	dw CODE_0CA119
	dw CODE_0CA09D

CODE_0CA09D:
	LDX.b $12
	LDA.w #$0008
	STA.w $7402,x
	LDA.w $7182,x
	STA.b $78,x
	SEC
	SBC.w #$0018
	STA.w $7A36,x
	JMP.w CODE_0CA20F

;---------------------------------------------------------------------------
; Sprite $032 main. Raiden: main_little_mouser_in_nest.
;---------------------------------------------------------------------------
YI_NorSpr032_PeekingLittleMouser_Main:
main_little_mouser_in_nest:
;$0CA0B4
	JSL.l CODE_03AF23
	LDA.b $16,x
	TAX
	JMP.w (DATA_peeking_mouser_state_ptr,x)

DATA_0CA0BE:
DATA_peeking_mouser_state_ptr:                  ; 2-entry Peeking Little Mouser state ptr (cycle-anim / emerge)
	dw CODE_0CA0F0
	dw CODE_0CA143

DATA_0CA0C2:
	dw DATA_0CA0CA,DATA_0CA0DA

DATA_0CA0C6:
	dw DATA_0CA0D2,DATA_0CA0E3

DATA_0CA0CA:
	db $02,$01,$02,$01,$02,$01,$02,$00

DATA_0CA0D2:
	db $02,$40,$04,$10,$04,$20,$04,$40

DATA_0CA0DA:
	db $02,$05,$06,$05,$02,$03,$04,$03,$01

DATA_0CA0E3:
	db $02,$02,$10,$02,$02,$02,$10,$02,$40

DATA_0CA0EC:
	dw $0007,$0008

CODE_0CA0F0:
	LDX.b $12
	LDA.b $18,x
	TAY
	LDA.w DATA_0CA0C2,y
	STA.b $00
	LDA.w DATA_0CA0C6,y
	STA.b $02
	LDA.w $7A96,x
	BNE.b CODE_0CA118
	DEC.b $76,x
	BMI.b CODE_0CA11B
	SEP.b #$20
	LDY.b $76,x
	LDA.b ($00),y
	STA.w $7402,x
	LDA.b ($02),y
	STA.w $7A96,x
	REP.b #$20
CODE_0CA118:
	RTL

CODE_0CA119:
	LDX.b $12
CODE_0CA11B:
	LDA.b $10
	AND.w #$0001
	ASL
	STA.b $18,x
	TAY
	LDA.w DATA_0CA0C2,y
	STA.b $00
	LDA.w DATA_0CA0C6,y
	STA.b $02
	LDA.w DATA_0CA0EC,y
	STA.b $76,x
	TAY
	SEP.b #$20
	LDA.b ($00),y
	STA.w $7402,x
	LDA.b ($02),y
	STA.w $7A96,x
	REP.b #$20
	RTL

CODE_0CA143:
	LDX.b $12
	LDA.b $18,x
	TAX
	JMP.w (DATA_peeking_mouser_emerge_substate_ptr,x)

DATA_0CA14B:
DATA_peeking_mouser_emerge_substate_ptr:        ; 5-entry Peeking Mouser emerge sub-state ptr (lift / hop / lunge / land / vanish)
	dw CODE_0CA155
	dw CODE_0CA197
	dw CODE_0CA1D4
	dw CODE_0CA1E6
	dw CODE_0CA208

CODE_0CA155:
	LDX.b $12
	LDA.w $7A36,x
	CMP.w $7182,x
	BMI.b CODE_0CA177
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.b $10
	AND.w #$0003
	BEQ.b CODE_0CA178
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w #$0004
	STA.b $18,x
CODE_0CA177:
	RTL

CODE_0CA178:
	LDA.w #$0006
	STA.b $76,x
	INC.b $18,x
	INC.b $18,x
	RTL

DATA_0CA182:
	db $08,$07,$08,$07,$08,$07,$08

DATA_0CA189:
	db $02,$10,$30,$10,$02,$20,$02

DATA_0CA190:
	db $00,$01,$00,$01,$00,$01,$00

CODE_0CA197:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CA1C4
	DEC.b $76,x
	BMI.b CODE_0CA1C5
	SEP.b #$20
	LDY.b $76,x
	LDA.w DATA_0CA182,y
	STA.w $7402,x
	LDA.w DATA_0CA189,y
	STA.w $7A96,x
	LDA.w DATA_0CA190,y
	BEQ.b CODE_0CA1C2
	LDA.b $10
	AND.b #$01
	ASL
	EOR.w $7400,x
	STA.w $7400,x
CODE_0CA1C2:
	REP.b #$20
CODE_0CA1C4:
	RTL

CODE_0CA1C5:
	STZ.w $7400,x
	LDA.w #$0400
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0006
	STA.b $18,x
	RTL

CODE_0CA1D4:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CA1E5
	LDA.w #$0400
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $18,x
	INC.b $18,x
CODE_0CA1E5:
	RTL

CODE_0CA1E6:
	LDX.b $12
	LDA.w $7182,x
	CMP.b $78,x
	BMI.b CODE_0CA207
	LDA.b $78,x
	STA.w $7182,x
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0040
	STA.w $7A96,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $18,x
	INC.b $18,x
CODE_0CA207:
	RTL

CODE_0CA208:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CA217
CODE_0CA20F:
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.b $18,x
CODE_0CA217:
	RTL

;---------------------------------------------------------------------------

DATA_0CA218:
	dw $FE80,$0180

;---------------------------------------------------------------------------
; Sprite $030: Little Mouser (free-roaming). Raiden: init_little_mouser.
;---------------------------------------------------------------------------
YI_NorSpr030_LittleMouser_Init:
init_little_mouser:
;$0CA21C
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0CA24F
CODE_0CA221:
	SEP.b #$20
	LDA.b #$01
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.b #$02
	STA.b $18,x
	TAY
	LDA.w DATA_0CA430,y
	STA.w $7402,x
	LDA.b #$02
	STA.w $7A98,x
	REP.b #$20
	LDA.w #$0020
	STA.w $7A96,x
	LDY.w $7400,x
	LDA.w DATA_0CA218,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FFFF
	STA.b $76,x
	RTL

CODE_0CA24F:
	SEP.b #$20
	LDA.w $70E2,x
	AND.b #$10
	LSR
	LSR
	LSR
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	PHA
	LDA.b #$02
	STA.b $18,x
	TAY
	LDA.w DATA_0CA430,y
	STA.w $7402,x
	LDA.b #$02
	STA.w $7A98,x
	REP.b #$20
	LDA.w #$0020
	STA.w $7A96,x
	LDY.w $7400,x
	LDA.w DATA_0CA218,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLY
	DEY
	BNE.b CODE_0CA289
	LDA.w #$FFFF
	STA.b $76,x
	RTL

CODE_0CA289:
	LDA.w #$0025
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0CA221
	LDA.w $6FA2,y
	AND.w #$FFE0
	STA.w $6FA2,y
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	LDA.w #$0001
	STA.w $7A36,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,y
	TYA
	STA.b $76,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $030 main. Raiden: main_little_mouser.
;---------------------------------------------------------------------------
YI_NorSpr030_LittleMouser_Main:
main_little_mouser:
;$0CA2C7
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_0CA2F7
	LDY.b $76,x
	BMI.b CODE_0CA2F7
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_0CA2F7
	CMP.w #!Define_YI_NorSpr026_BowserFightGiantEgg
	BCS.b CODE_0CA2F7
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	BNE.b CODE_0CA2F7
	LDA.w $6FA2,y
	ORA.w #$0001
	STA.w $6FA2,y
	LDA.w $7040,y
	ORA.w #$0004
	STA.w $7040,y
CODE_0CA2F7:
	JSL.l CODE_03AF23
	JSL.l CODE_03A2F8
	BCC.b CODE_0CA322
	LDY.b $76,x
	BMI.b CODE_0CA321
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CA321
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_0CA321
	CMP.w #!Define_YI_NorSpr026_BowserFightGiantEgg
	BCS.b CODE_0CA321
	TYX
	JSL.l CODE_03A31E
	LDX.b $12
CODE_0CA321:
	RTL

CODE_0CA322:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEY
	BNE.b CODE_0CA375
	LDA.b $16,x
	CMP.w #$0006
	BCC.b CODE_0CA334
	CMP.w #$0009
	BCC.b CODE_0CA34D
CODE_0CA334:
	LDA.b $16,x
	CMP.w #$000A
	BCC.b CODE_0CA340
	CMP.w #$000F
	BCC.b CODE_0CA34D
CODE_0CA340:
	JSR.w CODE_0CA8C2
	LDA.b $16,x
	CMP.w #$0004
	BEQ.b CODE_0CA34D
	JSR.w CODE_0CA867
CODE_0CA34D:
	LDA.b $16,x
	CMP.w #$0008
	BEQ.b CODE_0CA36A
	CMP.w #$0006
	BEQ.b CODE_0CA36A
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_0CA36A
	LDA.b $16,x
	STA.b $78,x
	LDA.w #$0008
	STA.b $16,x
CODE_0CA36A:
	LDA.b $16,x
	TAX
	JSR.w (DATA_little_mouser_state_ptr,x)
	JSL.l CODE_03A5B7
	RTL

CODE_0CA375:
	LDY.b $76,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CA396
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_0CA396
	CMP.w #!Define_YI_NorSpr026_BowserFightGiantEgg
	BCS.b CODE_0CA396
	LDA.w $7D38,y
	BNE.b CODE_0CA396
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	BEQ.b CODE_0CA3C7
CODE_0CA396:
	LDA.w #$FFFF
	STA.b $76,x
	STZ.w $7A36,x
	SEP.b #$20
	LDA.b #$01
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	REP.b #$20
	PHY
	LDA.w #!Define_YI_SoundID75_LitterMouserSqueak
	JSL.l CODE_push_sound_queue
	PLY
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	LDA.w $6FA2,x
	JSR.w CODE_0CA50F
	BRA.b CODE_0CA41B

CODE_0CA3C7:
	LDA.w #$0002
	STA.w $7A36,x
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,y
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCS.b CODE_0CA415
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w #$0050
	CMP.w #$00A0
	BCS.b CODE_0CA415
	SEP.b #$20
	LDA.b #$01
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	REP.b #$20
	LDA.w $6FA2,x
	AND.w #$F83F
	ORA.w #$0480
	STA.w $6FA2,x
	JSR.w CODE_0CA7BF
CODE_0CA415:
	LDA.b $16,x
	TAX
	JSR.w (DATA_little_mouser_state_ptr,x)
CODE_0CA41B:
	JSL.l CODE_03A5B7
	RTL

DATA_0CA420:
DATA_little_mouser_state_ptr:                   ; 8-entry Little Mouser state ptr (walk / chase / sniff / grab-egg / carry / drop / squashed / vanish)
	dw CODE_0CA433
	dw CODE_0CA475
	dw CODE_0CA4CC
	dw CODE_0CA534
	dw CODE_0CA572
	dw CODE_0CA5DD
	dw CODE_0CA70A
	dw CODE_0CA7D9

DATA_0CA430:
	db $04,$03,$02

CODE_0CA433:
	LDX.b $12
	LDA.w $7A96,x
	BEQ.b CODE_0CA43D
	JMP.w CODE_0CA6EB

CODE_0CA43D:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$02
	STA.b $18,x
	TAY
	LDA.w DATA_0CA46F,y
	STA.w $7402,x
	LDA.b $10
	AND.b #$03
	INC
	STA.b $19,x
	LDA.b $10
	LSR
	LSR
	AND.b #$07
	CLC
	ADC.b #$02
	STA.w $7A96,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID75_LitterMouserSqueak
	JSL.l CODE_push_sound_queue
	LDA.w #$0002
	STA.b $16,x
	RTS

DATA_0CA46F:
	db $00,$01,$00

DATA_0CA472:
	db $02,$00,$00

CODE_0CA475:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CA4A7
	SEP.b #$20
	DEC.b $18,x
	BPL.b CODE_0CA48A
	DEC.b $19,x
	BMI.b CODE_0CA4A8
	LDA.b #$02
	STA.b $18,x
CODE_0CA48A:
	LDY.b $18,x
	LDA.w DATA_0CA46F,y
	STA.w $7402,x
	LDA.w $7400,x
	EOR.w DATA_0CA472,y
	STA.w $7400,x
	LDA.b $10
	AND.b #$1F
	CLC
	ADC.b #$02
	STA.w $7A96,x
	REP.b #$20
CODE_0CA4A7:
	RTS

CODE_0CA4A8:
	LDA.b #$02
	STA.b $18,x
	TAY
	LDA.w DATA_0CA430,y
	STA.w $7402,x
	LDA.b #$02
	STA.w $7A98,x
	REP.b #$20
	LDA.w #$0020
	STA.w $7A96,x
	LDY.w $7400,x
	LDA.w DATA_0CA218,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $16,x
	RTS

CODE_0CA4CC:
	LDX.b $12
	LDA.w $7860,x
	BIT.w #$000C
	BEQ.b CODE_0CA4EF
CODE_0CA4D6:
	STZ.w $7402,x
	LDA.w #$0008
	STA.w $7A96,x
	LDA.w #$0001
	STA.w $7A36,x
	LDA.b $16,x
	STA.b $78,x
	LDA.w #$0006
	STA.b $16,x
	RTS

CODE_0CA4EF:
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCS.b CODE_0CA50F
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w #$0070
	CMP.w #$00E0
	BCC.b CODE_0CA51E
CODE_0CA50F:
	LDA.w $6FA2,x
	AND.w #$F83F
	ORA.w #$0140
	STA.w $6FA2,x
	JMP.w CODE_0CA43D

CODE_0CA51E:
	LDA.w $77C2,x
	AND.w #$00FF
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_0CA218,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JMP.w CODE_0CA6EB

CODE_0CA534:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CA555
	LDA.w #!Define_YI_SoundID75_LitterMouserSqueak
	JSL.l CODE_push_sound_queue
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.w $7400,x
	LDA.w DATA_0CA218,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.b $16,x
	INC.b $16,x
CODE_0CA555:
	LDA.w $7A36,x
	DEC
	BEQ.b CODE_0CA56D
	LDY.b $76,x
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,y
CODE_0CA56D:
	RTS

DATA_0CA56E:
	dw $FF00,$0100

CODE_0CA572:
	LDX.b $12
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_0CA5D5
	LDY.b #$19
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCC.b CODE_0CA5A8
	LDY.b #$18
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0CA5A8
	LDY.b #$1A
	CMP.w #$0100
	BCC.b CODE_0CA5A8
	LDY.b #$1B
	CMP.w #$0180
	BCC.b CODE_0CA5A8
	LDY.b #$1C
	CMP.w #$0200
	BCC.b CODE_0CA5A8
	LDY.b #$1D
CODE_0CA5A8:
	TYA
	STA.w $7402,x
	LDA.w $7A36,x
	BEQ.b CODE_0CA5D4
	DEC
	BEQ.b CODE_0CA5C6
	LDY.b $76,x
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,y
CODE_0CA5C6:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_0CA5D4
	LDY.w $7400,x
	LDA.w DATA_0CA56E,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0CA5D4:
	RTS

CODE_0CA5D5:
	STZ.w $7A36,x
	LDA.b $78,x
	STA.b $16,x
	RTS

CODE_0CA5DD:
	LDX.b $12
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0CA616
	BEQ.b CODE_0CA616
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CA616
	LDA.w $7D38,y
	BNE.b CODE_0CA616
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_0CA616
	CMP.w #!Define_YI_NorSpr026_BowserFightGiantEgg
	BCS.b CODE_0CA616
	LDA.w $7A36,y
	BNE.b CODE_0CA616
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D7|!EXRAMBankMirror,y
	BMI.b CODE_0CA616
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	STA.b $02
	BRA.b CODE_0CA692

CODE_0CA616:
	LDA.w #$0022
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #$0026
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_099FA5>>16
	LDA.w #FXCODE_099FA5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BPL.b CODE_0CA651
	PHY
	LDA.w #!Define_YI_SoundID75_LitterMouserSqueak
	JSL.l CODE_push_sound_queue
	PLY
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	JMP.w CODE_0CA50F

CODE_0CA651:
	LDA.w $7860,x
	BIT.w #$000C
	BEQ.b CODE_0CA65C
	JMP.w CODE_0CA4D6

CODE_0CA65C:
	LDA.w $7BB6,x
	CLC
	ADC.w $7BB6,y
	STA.b $00
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	STA.b $02
	BPL.b CODE_0CA674
	EOR.w #$FFFF
	INC
CODE_0CA674:
	CMP.b $00
	BCS.b CODE_0CA6D4
	LDA.w $7BB8,x
	CLC
	ADC.w $7BB8,y
	STA.b $00
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	BPL.b CODE_0CA68E
	EOR.w #$FFFF
	INC
CODE_0CA68E:
	CMP.b $00
	BCS.b CODE_0CA6C2
CODE_0CA692:
	TYX
	JSL.l CODE_03BF87
	TXY
	LDX.b $12
	LDA.w #$000C
	STA.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7402,x
	TYA
	STA.b $76,x
	LDA.w $7860,y
	AND.w #$FFFE
	STA.w $7860,y
	LDA.b $02
	ASL
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	PLA
	RTL

CODE_0CA6C2:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID75_LitterMouserSqueak
	JSL.l CODE_push_sound_queue
	PLA
	RTL

CODE_0CA6D4:
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	AND.w #$8000
	ASL
	ROL
	ASL
	STA.w $7400,x
	TAY
	LDA.w DATA_0CA218,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0CA6EB:
	LDA.w $7A98,x
	BNE.b CODE_0CA709
	SEP.b #$20
	DEC.b $18,x
	BPL.b CODE_0CA6FA
	LDA.b #$02
	STA.b $18,x
CODE_0CA6FA:
	LDY.b $18,x
	LDA.w DATA_0CA430,y
	STA.w $7402,x
	LDA.b #$02
	STA.w $7A98,x
	REP.b #$20
CODE_0CA709:
	RTS

CODE_0CA70A:
	LDX.b $12
	LDY.b $76,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CA732
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_0CA732
	CMP.w #!Define_YI_NorSpr026_BowserFightGiantEgg
	BCS.b CODE_0CA732
	LDA.w $7D38,y
	BNE.b CODE_0CA732
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	BNE.b CODE_0CA732
	LDA.w $7A36,y
	BEQ.b CODE_0CA752
CODE_0CA732:
	LDA.w #$FFFF
	STA.b $76,x
	PHY
	LDA.w #!Define_YI_SoundID75_LitterMouserSqueak
	JSL.l CODE_push_sound_queue
	PLY
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	JMP.w CODE_0CA50F

CODE_0CA752:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	BMI.b CODE_0CA78D
	LDA.w $7BB6,x
	CLC
	ADC.w $7BB6,y
	STA.b $00
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	STA.b $02
	BPL.b CODE_0CA76F
	EOR.w #$FFFF
	INC
CODE_0CA76F:
	CMP.b $00
	BCS.b CODE_0CA78D
	LDA.w $7BB8,x
	CLC
	ADC.w $7BB8,y
	STA.b $00
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	BPL.b CODE_0CA789
	EOR.w #$FFFF
	INC
CODE_0CA789:
	CMP.b $00
	BCC.b CODE_0CA78E
CODE_0CA78D:
	RTS

CODE_0CA78E:
	LDA.w $6FA2,y
	AND.w #$FFE0
	STA.w $6FA2,y
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	LDA.w #$0001
	STA.w $7A36,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,y
CODE_0CA7BF:
	LDA.w #$000E
	STA.b $16,x
	LDA.w $77C2,x
	AND.w #$00FF
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_0CA218,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLA
	RTL

CODE_0CA7D9:
	LDX.b $12
	LDY.b $76,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CA7FC
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_0CA7FC
	CMP.w #!Define_YI_NorSpr026_BowserFightGiantEgg
	BCS.b CODE_0CA7FC
	LDA.w $7D38,y
	BNE.b CODE_0CA7FC
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	BEQ.b CODE_0CA81F
CODE_0CA7FC:
	LDA.w #$FFFF
	STA.b $76,x
	STZ.w $7A36,x
	PHY
	LDA.w #!Define_YI_SoundID75_LitterMouserSqueak
	JSL.l CODE_push_sound_queue
	PLY
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	JMP.w CODE_0CA50F

CODE_0CA81F:
	LDA.w #$0002
	STA.w $7A36,x
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,y
	LDA.w $7860,x
	BIT.w #$000C
	BEQ.b CODE_0CA851
	STZ.w $7402,x
	LDA.w #$0004
	STA.w $7A96,x
	LDA.b $16,x
	STA.b $78,x
	LDA.w #$0006
	STA.b $16,x
	PLA
	RTL

CODE_0CA851:
	LDA.w $77C2,x
	AND.w #$00FF
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_0CA218,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JMP.w CODE_0CA6EB

CODE_0CA867:
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCS.b CODE_0CA887
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w #$0050
	CMP.w #$00A0
	BCC.b CODE_0CA888
CODE_0CA887:
	RTS

CODE_0CA888:
	SEP.b #$20
	LDA.b #$02
	STA.b $18,x
	TAY
	LDA.w DATA_0CA430,y
	STA.w $7402,x
	LDA.b #$02
	STA.w $7A98,x
	REP.b #$20
	LDA.w $6FA2,x
	AND.w #$F83F
	ORA.w #$0480
	STA.w $6FA2,x
	LDA.w $77C2,x
	AND.w #$00FF
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_0CA218,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.b $16,x
	PLA
	RTL

CODE_0CA8C2:
	LDA.w #$0022
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #$0026
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_099FA5>>16
	LDA.w #FXCODE_099FA5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BPL.b CODE_0CA8E3
	RTS

CODE_0CA8E3:
	LDA.w $6FA2,x
	AND.w #$F83F
	ORA.w #$0480
	STA.w $6FA2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PHY
	LDA.w #!Define_YI_SoundID75_LitterMouserSqueak
	JSL.l CODE_push_sound_queue
	PLY
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	AND.w #$8000
	ASL
	ROL
	ASL
	STA.w $7400,x
	LDA.w #$000A
	STA.b $16,x
	PLA
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $033: Little Mouser exiting nest. Raiden: init_little_mouser_from_nest.
;---------------------------------------------------------------------------
YI_NorSpr033_LittleMouserExitingNest_Init:
init_little_mouser_from_nest:
;$0CA918
	STZ.w $7400,x
	LDY.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CPY.b #$03
	BEQ.b CODE_0CA946
	LDA.w $6FA2,x
	ORA.w #$0141
	STA.w $6FA2,x
	LDA.w #$0004
	STA.b $16,x
	SEP.b #$20
	LDA.b #$02
	STA.b $19,x
	TAY
	LDA.w DATA_0CAF00,y
	STA.w $7402,x
	LDA.w DATA_0CAF03,y
	STA.w $7A96,x
	REP.b #$20
	RTL

CODE_0CA946:
	LDA.w $6FA2,x
	ORA.w #$0006
	STA.w $6FA2,x
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	STA.b $16,x
	BNE.b CODE_0CA977
	SEP.b #$20
	LDA.b #$01
	STA.w $74A2,x
	LDA.b #$02
	STA.b $19,x
	TAY
	LDA.w DATA_0CA9E7,y
	STA.w $7402,x
	LDA.w DATA_0CA9EA,y
	STA.w $7A96,x
	REP.b #$20
	RTL

CODE_0CA977:
	SEP.b #$20
	LDA.w $7042,x
	AND.b #$CF
	STA.w $7042,x
	LDA.b #$FF
	STA.w $74A2,x
	LDA.b #$0C
	STA.w $7402,x
	REP.b #$20
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $033 main. Raiden: main_little_mouser_from_nest.
;---------------------------------------------------------------------------
YI_NorSpr033_LittleMouserExitingNest_Main:
main_little_mouser_from_nest:
;$0CA98E
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_0CA9A8
	LDA.w #!Define_YI_NorSpr030_LittleMouser
	TXY
	JSL.l CODE_spawn_sprite
	SEP.b #$20
	LDA.b #$01
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	REP.b #$20
	RTL

CODE_0CA9A8:
	CMP.w #$0010
	BNE.b CODE_0CA9BB
	LDA.w $7D96,x
	BEQ.b CODE_0CA9BB
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
CODE_0CA9BB:
	JSL.l CODE_03AF23
	JSR.w CODE_0CB29D
	LDA.b $16,x
	TAX
	JMP.w (DATA_mouser_from_nest_state_ptr,x)

DATA_0CA9C8:
DATA_mouser_from_nest_state_ptr:                ; 3-entry "exiting nest" Little Mouser state ptr (exit-sequence / carry-egg / leave)
	dw CODE_0CA9CE
	dw CODE_0CAC25
	dw CODE_0CAEE1

CODE_0CA9CE:
	LDX.b $12
	LDY.b $18,x
	TYX
	JMP.w (DATA_mouser_from_nest_exit_substate_ptr,x)

CODE_0CA9D6:
	RTL

DATA_0CA9D7:
DATA_mouser_from_nest_exit_substate_ptr:        ; 8-entry exit-from-nest sub-state ptr (rise / hop / lunge / etc.)
	dw CODE_0CA9ED
	dw CODE_0CAA27
	dw CODE_0CAA63
	dw CODE_0CAAF0
	dw CODE_0CAB3F
	dw CODE_0CAB5B
	dw CODE_0CAB99
	dw CODE_0CB1CF

DATA_0CA9E7:
	db $06,$05,$16

DATA_0CA9EA:
	db $03,$14,$40

CODE_0CA9ED:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CAA0A
	SEP.b #$20
	DEC.b $19,x
	BMI.b CODE_0CAA0B
	LDY.b $19,x
	LDA.w DATA_0CA9E7,y
	STA.w $7402,x
	LDA.w DATA_0CA9EA,y
	STA.w $7A96,x
	REP.b #$20
CODE_0CAA0A:
	RTL

CODE_0CAA0B:
	INC.b $18,x
	INC.b $18,x
	LDA.b #$07
	STA.w $7402,x
	REP.b #$20
	LDA.w $7182,x
	SEC
	SBC.w #$000A
	STA.w $7182,x
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTL

CODE_0CAA27:
	LDX.b $12
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.l $700026,x
	SEP.b #$10
	LDX.b $12
	CMP.w #$0100
	BCC.b CODE_0CAA62
	CMP.w #$0103
	BCC.b CODE_0CAA46
	CMP.w #$010A
	BNE.b CODE_0CAA62
CODE_0CAA46:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$08
	STA.w $7402,x
	LDA.b #$03
	STA.w $7A96,x
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
CODE_0CAA62:
	RTL

CODE_0CAA63:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CAA70
	LDA.w #$0009
	STA.w $7402,x
CODE_0CAA70:
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.l $700026,x
	SEP.b #$10
	LDX.b $12
	CMP.w #$0028
	BCC.b CODE_0CAACE
	CMP.w #$002B
	BCC.b CODE_0CAA8D
	CMP.w #$002D
	BNE.b CODE_0CAACE
CODE_0CAA8D:
	LDA.w $6FA0,x
	AND.w #$FF9F
	STA.w $6FA0,x
	LDA.w $7040,x
	ORA.w #$0150
	STA.w $7040,x
	LDA.b $10
	AND.w #$0001
	BNE.b CODE_0CAACF
CODE_0CAAA6:
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$05
	STA.w $74A2,x
	LDA.b #$03
	STA.b $19,x
	TAY
	LDA.w DATA_0CAAE4,y
	STA.w $7402,x
	LDA.w DATA_0CAAE8,y
	STA.w $7A96,x
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID75_LitterMouserSqueak
	JSL.l CODE_push_sound_queue
CODE_0CAACE:
	RTL

CODE_0CAACF:
	SEP.b #$20
	LDA.b #$07
	STA.w $74A2,x
	LDA.b $18,x
	CLC
	ADC.b #$04
	STA.b $18,x
	REP.b #$20
	RTL

DATA_0CAAE0:
	dw $0000,$0100

DATA_0CAAE4:
	dw $0000,$0B00

DATA_0CAAE8:
	dw $1024,$0324

DATA_0CAAEC:
	dw $0202,$0000

CODE_0CAAF0:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CAB16
	SEP.b #$20
	DEC.b $19,x
	BMI.b CODE_0CAB17
	LDY.b $19,x
	LDA.w DATA_0CAAE4,y
	STA.w $7402,x
	LDA.w DATA_0CAAE8,y
	STA.w $7A96,x
	LDA.w $7400,x
	EOR.w DATA_0CAAEC,y
	STA.w $7400,x
	REP.b #$20
CODE_0CAB16:
	RTL

CODE_0CAB17:
	INC.b $18,x
	INC.b $18,x
	LDA.w $6FA0,x
	ORA.b #$60
	STA.w $6FA0,x
	LDA.b #$07
	STA.w $74A2,x
	LDA.b #$09
	STA.w $7402,x
	REP.b #$20
	LDA.w $7040,x
	AND.w #$FEAF
	STA.w $7040,x
	LDA.w #$FE80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTL

CODE_0CAB3F:
	LDX.b $12
	SEP.b #$20
	LDA.w $6FA0,x
	ORA.b #$60
	STA.w $6FA0,x
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
	LDA.w $7040,x
	AND.w #$FEAF
	STA.w $7040,x
	RTL

CODE_0CAB5B:
	LDX.b $12
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.l $700006,x
	SEP.b #$10
	LDX.b $12
	CMP.w #$0028
	BCC.b CODE_0CAB7A
	CMP.w #$002B
	BCC.b CODE_0CAB98
	CMP.w #$002D
	BEQ.b CODE_0CAB98
CODE_0CAB7A:
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$0A
	STA.w $7402,x
	LDA.w $7042,x
	AND.b #$CF
	STA.w $7042,x
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
	LDA.w #$0300
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0CAB98:
	RTL

CODE_0CAB99:
	LDX.b $12
	JSR.w CODE_0CB21B
	BMI.b CODE_0CAB98
	BEQ.b CODE_0CAB98
	LDA.w $7BB6,x
	CLC
	ADC.w $7BB6,y
	STA.b $00
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	BPL.b CODE_0CABB8
	EOR.w #$FFFF
	INC
CODE_0CABB8:
	CMP.b $00
	BCS.b CODE_0CAC24
	LDA.w $7BB8,x
	CLC
	ADC.w $7BB8,y
	STA.b $00
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	BPL.b CODE_0CABD2
	EOR.w #$FFFF
	INC
CODE_0CABD2:
	CMP.b $00
	BCS.b CODE_0CAC24
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7182,y
	STA.w $7182,x
	LDA.b $10
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_0CB1A3,y
	STA.w $7A36,x
	STA.b $00
	LDA.w DATA_0CB1A7,y
	STA.w $7A38,x
	STA.b $02
	JSL.l CODE_random_number_gen
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A2,x
	LDA.w $7042,x
	ORA.b #$20
	STA.w $7042,x
	LDA.w DATA_0CB19F,y
	STA.b $19,x
	TAY
	LDA.b ($00),y
	STA.w $7402,x
	LDA.b $10
	AND.b #$1F
	CLC
	ADC.b #$20
	STA.w $7A96,x
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
CODE_0CAC24:
	RTL

CODE_0CAC25:
	LDX.b $12
	LDY.b $18,x
	TYX
	JMP.w (DATA_mouser_from_nest_carry_substate_ptr,x)

DATA_0CAC2D:
DATA_mouser_from_nest_carry_substate_ptr:       ; 9-entry carry-egg sub-state ptr (carry / position / drop / etc.)
	dw CODE_0CAC3F
	dw CODE_0CACC1
	dw CODE_0CAD09
	dw CODE_0CAD56
	dw CODE_0CAB3F
	dw CODE_0CADA5
	dw CODE_0CADD8
	dw CODE_0CAE3B
	dw CODE_0CAE90

CODE_0CAC3F:
	LDX.b $12
	LDA.w $7A96,x
	BEQ.b CODE_0CAC47
	RTL

CODE_0CAC47:
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	JSR.w CODE_0CB21B
	BMI.b CODE_0CAC91
	BEQ.b CODE_0CAC91
	LDA.w $7BB6,x
	CLC
	ADC.w $7BB6,y
	STA.b $00
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	BPL.b CODE_0CAC6A
	EOR.w #$FFFF
	INC
CODE_0CAC6A:
	CMP.b $00
	BCS.b CODE_0CAC88
	LDA.w $7BB8,x
	CLC
	ADC.w $7BB8,y
	STA.b $00
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	BPL.b CODE_0CAC84
	EOR.w #$FFFF
	INC
CODE_0CAC84:
	CMP.b $00
	BCC.b CODE_0CAC91
CODE_0CAC88:
	SEP.b #$20
	LDA.b #$07
	STA.w $74A2,x
	REP.b #$20
CODE_0CAC91:
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.l $700006,x
	SEP.b #$10
	LDX.b $12
	CMP.w #$0000
	BNE.b CODE_0CACC0
	SEP.b #$20
	INC.b $18,x
	INC.b $18,x
	LDA.b #$03
	STA.b $19,x
	TAY
	LDA.w DATA_0CAAE0,y
	STA.w $7402,x
	LDA.w DATA_0CAAE8,y
	STA.w $7A96,x
	REP.b #$20
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0CACC0:
	RTL

CODE_0CACC1:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CACE7
	SEP.b #$20
	DEC.b $19,x
	BMI.b CODE_0CACE8
	LDY.b $19,x
	LDA.w DATA_0CAAE0,y
	STA.w $7402,x
	LDA.w DATA_0CAAE8,y
	STA.w $7A96,x
	LDA.w $7400,x
	EOR.w DATA_0CAAEC,y
	STA.w $7400,x
	REP.b #$20
CODE_0CACE7:
	RTL

CODE_0CACE8:
	INC.b $18,x
	INC.b $18,x
	LDA.b #$0D
	STA.w $7402,x
	LDA.w $7042,x
	ORA.b #$20
	STA.w $7042,x
	REP.b #$20
	LDA.w #$0180
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID75_LitterMouserSqueak
	JSL.l CODE_push_sound_queue
	RTL

CODE_0CAD09:
	LDX.b $12
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.l $700026,x
	SEP.b #$10
	LDX.b $12
	CMP.w #$0100
	BCC.b CODE_0CAD44
	CMP.w #$0103
	BCC.b CODE_0CAD28
	CMP.w #$010A
	BNE.b CODE_0CAD44
CODE_0CAD28:
	LDA.w $6FA0,x
	AND.w #$FF9F
	STA.w $6FA0,x
	LDA.w $7040,x
	ORA.w #$0150
	STA.w $7040,x
	LDA.b $10
	AND.w #$0001
	BNE.b CODE_0CAD45
	JMP.w CODE_0CAAA6

CODE_0CAD44:
	RTL

CODE_0CAD45:
	SEP.b #$20
	LDA.b #$01
	STA.w $74A2,x
	LDA.b $18,x
	CLC
	ADC.b #$04
	STA.b $18,x
	REP.b #$20
	RTL

CODE_0CAD56:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CAD7C
	SEP.b #$20
	DEC.b $19,x
	BMI.b CODE_0CAD7D
	LDY.b $19,x
	LDA.w DATA_0CAAE4,y
	STA.w $7402,x
	LDA.w DATA_0CAAE8,y
	STA.w $7A96,x
	LDA.w $7400,x
	EOR.w DATA_0CAAEC,y
	STA.w $7400,x
	REP.b #$20
CODE_0CAD7C:
	RTL

CODE_0CAD7D:
	INC.b $18,x
	INC.b $18,x
	LDA.w $6FA0,x
	ORA.b #$60
	STA.w $6FA0,x
	LDA.b #$01
	STA.w $74A2,x
	LDA.b #$0D
	STA.w $7402,x
	REP.b #$20
	LDA.w $7040,x
	AND.w #$FEAF
	STA.w $7040,x
	LDA.w #$0180
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTL

CODE_0CADA5:
	LDX.b $12
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.l $700026,x
	SEP.b #$10
	LDX.b $12
	CMP.w #$0100
	BCC.b CODE_0CADC4
	CMP.w #$0103
	BCC.b CODE_0CADD7
	CMP.w #$010A
	BEQ.b CODE_0CADD7
CODE_0CADC4:
	LDA.w #$0300
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$0E
	STA.w $7402,x
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
CODE_0CADD7:
	RTL

CODE_0CADD8:
	LDX.b $12
	JSR.w CODE_0CB21B
	BMI.b CODE_0CAE3A
	BEQ.b CODE_0CAE3A
	LDA.w $7BB6,x
	CLC
	ADC.w $7BB6,y
	STA.b $00
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	BPL.b CODE_0CADF7
	EOR.w #$FFFF
	INC
CODE_0CADF7:
	CMP.b $00
	BCS.b CODE_0CAE3A
	LDA.w $7BB8,x
	CLC
	ADC.w $7BB8,y
	STA.b $00
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	BPL.b CODE_0CAE11
	EOR.w #$FFFF
	INC
CODE_0CAE11:
	CMP.b $00
	BCS.b CODE_0CAE3A
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $70E2,y
	STA.w $70E2,x
	LDA.w $7182,y
	STA.w $7182,x
	SEP.b #$20
	LDA.b #$01
	STA.b $19,x
	LDA.b #$0F
	STA.w $7402,x
	LDA.b #$03
	STA.w $7A96,x
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
CODE_0CAE3A:
	RTL

CODE_0CAE3B:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CAE54
	SEP.b #$20
	DEC.b $19,x
	BMI.b CODE_0CAE55
	LDA.b #$10
	STA.w $7402,x
	LDA.b #$03
	STA.w $7A96,x
	REP.b #$20
CODE_0CAE54:
	RTL

CODE_0CAE55:
	REP.b #$20
	LDA.b $10
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_0CB1A3,y
	STA.w $7A36,x
	STA.b $00
	LDA.w DATA_0CB1A7,y
	STA.w $7A38,x
	STA.b $02
	JSL.l CODE_random_number_gen
	SEP.b #$20
	LDA.w DATA_0CB19F,y
	STA.b $19,x
	TAY
	LDA.b ($00),y
	STA.w $7402,x
	LDA.b $10
	AND.b #$1F
	CLC
	ADC.b #$20
	STA.w $7A96,x
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
	RTL

CODE_0CAE90:
	LDX.b $12
	LDA.w $7A36,x
	STA.b $00
	LDA.w $7A38,x
	STA.b $02
	LDA.w $7A96,x
	BNE.b CODE_0CAED1
	SEP.b #$20
	DEC.b $19,x
	BPL.b CODE_0CAED2
	LDA.w $7042,x
	AND.b #$CF
	STA.w $7042,x
	LDA.b #$FF
	STA.w $74A2,x
	LDA.b #$0C
	STA.w $7402,x
	LDA.b $10
	AND.b #$1F
	CLC
	ADC.b #$20
	STA.w $7A96,x
	STZ.b $18,x
	REP.b #$20
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,x
CODE_0CAED1:
	RTL

CODE_0CAED2:
	LDY.b $19,x
	LDA.b ($00),y
	STA.w $7402,x
	LDA.b ($02),y
	STA.w $7A96,x
	REP.b #$20
	RTL

CODE_0CAEE1:
	LDX.b $12
	JSR.w CODE_0CB2C2
CODE_0CAEE6:
	LDY.b $18,x
	TYX
	JMP.w (DATA_mouser_from_nest_leave_substate_ptr,x)

DATA_0CAEEC:
DATA_mouser_from_nest_leave_substate_ptr:       ; 10-entry leave-sequence sub-state ptr (final exit anim phases)
	dw CODE_0CAF06
	dw CODE_0CAF5B
	dw CODE_0CAF95
	dw CODE_0CAFDD
	dw CODE_0CB05A
	dw CODE_0CB091
	dw CODE_0CB0ED
	dw CODE_0CB125
	dw CODE_0CB131
	dw CODE_0CB1CF

DATA_0CAF00:
	db $15,$14,$16

DATA_0CAF03:
	db $04,$04,$40

CODE_0CAF06:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CAF23
	SEP.b #$20
	DEC.b $19,x
	BMI.b CODE_0CAF24
	LDY.b $19,x
	LDA.w DATA_0CAF00,y
	STA.w $7402,x
	LDA.w DATA_0CAF03,y
	STA.w $7A96,x
	REP.b #$20
CODE_0CAF23:
	RTL

CODE_0CAF24:
	INC.b $18,x
	INC.b $18,x
	LDA.b #$0D
	STA.w $7402,x
	LDA.b #$04
	STA.w $7A96,x
	LDA.b #$05
	STA.w $74A2,x
	LDA.w $6FA0,x
	AND.b #$9F
	STA.w $6FA0,x
	REP.b #$20
	LDA.w $7040,x
	ORA.w #$0150
	STA.w $7040,x
	LDA.w $7182,x
	CLC
	ADC.w #$0002
	STA.w $7182,x
	LDA.w #$0400
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTL

CODE_0CAF5B:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CAF72
	SEP.b #$20
	LDA.w $7860,x
	AND.b #$01
	BNE.b CODE_0CAF73
	LDA.b #$0E
	STA.w $7402,x
	REP.b #$20
CODE_0CAF72:
	RTL

CODE_0CAF73:
	INC.b $18,x
	INC.b $18,x
	LDA.b #$01
	STA.b $19,x
	TAY
	LDA.w DATA_0CAF91,y
	STA.w $7402,x
	LDA.w DATA_0CAF93,y
	STA.w $7A96,x
	REP.b #$20
	LDA.w #$0040
	STA.w $7542,x
	RTL

DATA_0CAF91:
	db $00,$17

DATA_0CAF93:
	db $20,$04

CODE_0CAF95:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CAFB2
	SEP.b #$20
	DEC.b $19,x
	BMI.b CODE_0CAFB3
	LDY.b $19,x
	LDA.w DATA_0CAF91,y
	STA.w $7402,x
	LDA.w DATA_0CAF93,y
	STA.w $7A96,x
	REP.b #$20
CODE_0CAFB2:
	RTL

CODE_0CAFB3:
	INC.b $18,x
	INC.b $18,x
	STZ.b $77,x
	LDA.b $10
	AND.b #$03
	INC
CODE_0CAFBE:
	STA.b $76,x
	LDA.b #$02
	STA.b $19,x
	TAY
	LDA.w DATA_0CA46F,y
	STA.w $7402,x
CODE_0CAFCB:
	LDA.b $10
	LSR
	LSR
	AND.b #$07
	CLC
	ADC.b #$02
	STA.w $7A96,x
	REP.b #$20
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTL

CODE_0CAFDD:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CB00F
	SEP.b #$20
	DEC.b $19,x
	BPL.b CODE_0CAFF2
	DEC.b $76,x
	BMI.b CODE_0CB010
	LDA.b #$02
	STA.b $19,x
CODE_0CAFF2:
	LDY.b $19,x
	LDA.w DATA_0CA46F,y
	STA.w $7402,x
	LDA.w $7400,x
	EOR.w DATA_0CA472,y
	STA.w $7400,x
	LDA.b $10
	AND.b #$07
	CLC
	ADC.b #$02
	STA.w $7A96,x
	REP.b #$20
CODE_0CB00F:
	RTL

CODE_0CB010:
	LDA.b $77,x
	BNE.b CODE_0CB039
	INC.b $18,x
	INC.b $18,x
	LDA.b #$20
	STA.w $7A96,x
CODE_0CB01D:
	LDA.b #$02
	STA.b $19,x
	TAY
	LDA.w DATA_0CA430,y
	STA.w $7402,x
	LDA.b #$02
	STA.w $7A98,x
	REP.b #$20
	LDY.w $7400,x
	LDA.w DATA_0CA218,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTL

CODE_0CB039:
	REP.b #$20
	JSR.w CODE_0CB21B
	BMI.b CODE_0CB052
	BEQ.b CODE_0CB052
	LDA.w $70E2,x
	SEC
	SBC.w $70E2,y
	AND.w #$8000
	ASL
	ROL
	ASL
	STA.w $7400,x
CODE_0CB052:
	SEP.b #$20
	LDA.b #$0A
	STA.b $18,x
	BRA.b CODE_0CB01D

CODE_0CB05A:
	LDX.b $12
	LDA.w $7A96,x
	BEQ.b CODE_0CB080
	LDA.w $7A98,x
	BNE.b CODE_0CB07F
	SEP.b #$20
	DEC.b $19,x
	BPL.b CODE_0CB070
	LDA.b #$02
	STA.b $19,x
CODE_0CB070:
	LDY.b $19,x
	LDA.w DATA_0CA430,y
	STA.w $7402,x
	LDA.b #$02
	STA.w $7A98,x
	REP.b #$20
CODE_0CB07F:
	RTL

CODE_0CB080:
	SEP.b #$20
	LDA.b $10
	AND.b #$04
	STA.b $77,x
	LDA.b #$06
	STA.b $18,x
	LDA.b #$03
	JMP.w CODE_0CAFBE

CODE_0CB091:
	LDX.b $12
	JSR.w CODE_0CB21B
	BMI.b CODE_0CB0A8
	LDA.w $70E2,x
	SEC
	SBC.w $70E2,y
	CLC
	ADC.w #$0002
	CMP.w #$0004
	BCC.b CODE_0CB0C7
CODE_0CB0A8:
	LDA.w $7A98,x
	BNE.b CODE_0CB0C6
	SEP.b #$20
	DEC.b $19,x
	BPL.b CODE_0CB0B7
	LDA.b #$02
	STA.b $19,x
CODE_0CB0B7:
	LDY.b $19,x
	LDA.w DATA_0CA430,y
	STA.w $7402,x
	LDA.b #$02
	STA.w $7A98,x
	REP.b #$20
CODE_0CB0C6:
	RTL

CODE_0CB0C7:
	LDA.w $70E2,y
	STA.w $70E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w $7400,x
	SEP.b #$20
	LDA.b #$17
	STA.w $7402,x
	LDA.b #$04
	STA.w $7A96,x
	LDA.b #$01
	STA.b $19,x
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
	RTL

CODE_0CB0ED:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CB109
	JSR.w CODE_0CB234
	SEP.b #$20
	DEC.b $19,x
	BMI.b CODE_0CB10A
	LDA.b #$11
	STA.w $7402,x
	LDA.b #$04
	STA.w $7A96,x
	REP.b #$20
CODE_0CB109:
	RTL

CODE_0CB10A:
	INC.b $18,x
	INC.b $18,x
	LDA.b #$07
	STA.w $7402,x
	REP.b #$20
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	RTL

CODE_0CB125:
	LDX.b $12
	JSR.w CODE_0CB234
	RTL

DATA_0CB12B:
	db $13,$12,$09

DATA_0CB12E:
	db $00,$00,$08

CODE_0CB131:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CB15F
	SEP.b #$20
	DEC.b $19,x
	BMI.b CODE_0CB160
	LDY.b $19,x
	LDA.w DATA_0CB12B,y
	STA.w $7402,x
	LDA.b #$04
	STA.w $7A96,x
	LDA.w DATA_0CB12E,y
	STA.b $00
	STZ.b $01
	REP.b #$20
	LDY.b $78,x
	LDA.w $7182,y
	CLC
	ADC.b $00
	STA.w $7182,x
CODE_0CB15F:
	RTL

CODE_0CB160:
	INC.b $18,x
	INC.b $18,x
	LDA.b $10
	AND.w #$0A01
	TAY
	REP.b #$20
	LDA.w DATA_0CB1A3,y
	STA.w $7A36,x
	STA.b $00
	LDA.w DATA_0CB1A7,y
	STA.w $7A38,x
	STA.b $02
	JSL.l CODE_random_number_gen
	SEP.b #$20
	LDA.w DATA_0CB19F,y
	STA.b $19,x
	TAY
	LDA.b ($00),y
	STA.w $7402,x
	LDA.b $10
	AND.b #$0F
	CLC
	ADC.b #$10
	STA.w $7A96,x
	LDA.b #$FF
	STA.w $74A2,x
	REP.b #$20
	RTL

DATA_0CB19F:
	dw $0007,$0009

DATA_0CB1A3:
	dw DATA_0CB1AB,DATA_0CB1BB

DATA_0CB1A7:
	dw DATA_0CB1B3,DATA_0CB1C5

DATA_0CB1AB:
	db $1E,$16,$1E,$16,$1E,$16,$1E,$16

DATA_0CB1B3:
	db $02,$40,$04,$10,$04,$20,$04,$00

DATA_0CB1BB:
	db $1E,$21,$22,$21,$1E,$1F,$20,$1F,$16,$16

DATA_0CB1C5:
	db $02,$02,$10,$02,$02,$02,$10,$02,$20,$00

CODE_0CB1CF:
	LDX.b $12
	LDA.w $7A36,x
	STA.b $00
	LDA.w $7A38,x
	STA.b $02
	LDA.w $7A96,x
	BNE.b CODE_0CB20B
	SEP.b #$20
	LDA.b #$06
	STA.w $74A2,x
	DEC.b $19,x
	BPL.b CODE_0CB20C
	LDA.b #$02
	STA.b $19,x
	TAY
	LDA.w DATA_0CAF00,y
	STA.w $7402,x
	LDA.b $10
	AND.b #$1F
	CLC
	ADC.b #$20
	STA.w $7A96,x
	STZ.b $18,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID75_LitterMouserSqueak
	JSL.l CODE_push_sound_queue
CODE_0CB20B:
	RTL

CODE_0CB20C:
	LDY.b $19,x
	LDA.b ($00),y
	STA.w $7402,x
	LDA.b ($02),y
	STA.w $7A96,x
	REP.b #$20
	RTL

CODE_0CB21B:
	LDA.w #$002F
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098EBF>>16
	LDA.w #FXCODE_098EBF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	RTS

CODE_0CB234:
	JSR.w CODE_0CB21B
	BMI.b CODE_0CB29C
	BEQ.b CODE_0CB29C
	LDA.w $7BB6,x
	CLC
	ADC.w $7BB6,y
	STA.b $00
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	BPL.b CODE_0CB251
	EOR.w #$FFFF
	INC
CODE_0CB251:
	CMP.b $00
	BCS.b CODE_0CB29C
	LDA.w $7BB8,x
	CLC
	ADC.w $7BB8,y
	STA.b $00
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	BPL.b CODE_0CB26B
	EOR.w #$FFFF
	INC
CODE_0CB26B:
	CMP.b $00
	BCS.b CODE_0CB29C
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$10
	STA.b $18,x
	LDA.b #$02
	STA.b $19,x
	LDA.b #$04
	STA.w $7A96,x
	TYA
	STA.b $78,x
	LDA.b #$06
	STA.w $74A2,x
	LDA.w $6FA0,x
	ORA.b #$60
	STA.w $6FA0,x
	REP.b #$20
	LDA.w $7040,x
	AND.w #$FEAF
	STA.w $7040,x
CODE_0CB29C:
	RTS

CODE_0CB29D:
	LDA.w $6FA0,x
	AND.w #$0040
	BNE.b CODE_0CB2C1
	LDY.w $7D36,x
	BPL.b CODE_0CB2C1
	LDA.w $61D6
	BNE.b CODE_0CB2C1
	JSL.l CODE_07FC2F
	BCC.b CODE_0CB2BB
	PLA
	JSL.l CODE_03A5B7
	RTL

CODE_0CB2BB:
	BEQ.b CODE_0CB2C1
	JSL.l CODE_03A858
CODE_0CB2C1:
	RTS

CODE_0CB2C2:
	LDA.w $7542,x
	CMP.w #$0040
	BMI.b CODE_0CB2EA
	LDA.w #$0022
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #$0026
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_099FA5>>16
	LDA.w #FXCODE_099FA5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BPL.b CODE_0CB2EB
CODE_0CB2EA:
	RTS

CODE_0CB2EB:
	LDA.w #!Define_YI_NorSpr030_LittleMouser
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$01
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	REP.b #$20
	PLA
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $1A3: Little Skull Mouser. Raiden: init_little_skill_mouser (sic).
;---------------------------------------------------------------------------
YI_NorSpr1A3_LittleSkullMouser_Init:
init_little_skull_mouser:
;$0CB304
	RTL

;---------------------------------------------------------------------------

DATA_0CB305:
	dw $FE80,$0180

DATA_0CB309:
	dw $0000,$0000,$0002,$0000

CODE_0CB311:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_0CB351
	LDA.w $7860,x
	BIT.w #$000C
	BNE.b CODE_0CB352
	BIT.w #$0002
	BNE.b CODE_0CB35D
	BIT.w #$0001
	BEQ.b CODE_0CB351
	LDA.w #!Define_YI_SoundID1F_HitHead
	JSL.l CODE_push_sound_queue
	JSL.l CODE_03A590
	LDA.b $78,x
	CMP.w #$0003
	BCC.b CODE_0CB349
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_0CB34B
	JML.l CODE_03B078

CODE_0CB349:
	INC.b $78,x
CODE_0CB34B:
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0CB351:
	RTL

CODE_0CB352:
	LSR
	AND.w #$0006
	TAY
	LDA.w DATA_0CB309,y
	STA.w $7400,x
CODE_0CB35D:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$02
	STA.w $7A36,x
	REP.b #$20
	RTL

;---------------------------------------------------------------------------
; Sprite $1A3 main. Raiden: main_little_skull_mouser.
;---------------------------------------------------------------------------
YI_NorSpr1A3_LittleSkullMouser_Main:
main_little_skull_mouser:
;$0CB36A
	LDY.w $7A36,x
	TYX
	JMP.w (DATA_little_skull_mouser_state_ptr,x)

DATA_0CB371:
DATA_little_skull_mouser_state_ptr:             ; 2-entry Little Skull Mouser state ptr (active / despawn)
	dw CODE_0CB375
	dw CODE_0CB455

CODE_0CB375:
	LDX.b $12
	LDA.w $7D38,x
	BNE.b CODE_0CB311
	JSL.l CODE_03AF23
	JSL.l CODE_07FD6C
	BCC.b CODE_0CB394
	JSL.l CODE_03B20B
	SEP.b #$20
	LDA.b #$02
	STA.w $7A36,x
	REP.b #$20
	RTL

CODE_0CB394:
	JSL.l CODE_03A5B7
	JSR.w CODE_0CB406
	LDA.b $18,x
	BNE.b CODE_0CB3D5
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_0CB3C3
	LDY.b #$02
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCC.b CODE_0CB3BE
	LDY.b #$01
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0CB3BE
	LDY.b #$03
CODE_0CB3BE:
	TYA
	STA.w $7402,x
	RTL

CODE_0CB3C3:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7A96,x
	INC.b $18,x
	RTL

CODE_0CB3D5:
	LDA.w $7A96,x
	BNE.b CODE_0CB3F7
	LDA.w $7402,x
	BNE.b CODE_0CB3F8
	LDA.w #!Define_YI_SoundID75_LitterMouserSqueak
	JSL.l CODE_push_sound_queue
	STZ.b $18,x
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.w $7400,x
	LDA.w DATA_0CB305,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0CB3F7:
	RTL

CODE_0CB3F8:
	STZ.w $7402,x
	LDA.w #$0004
	STA.w $7A96,x
	RTL

DATA_0CB402:
	dw $FF00,$0100

CODE_0CB406:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0CB43E
	BEQ.b CODE_0CB43E
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CB43E
	LDA.w $7D38,y
	BEQ.b CODE_0CB43E
	LDX.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BMI.b CODE_0CB424
	INX
	INX
CODE_0CB424:
	LDA.w DATA_0CB402,x
	LDX.b $12
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$02
	STA.w $7A36,x
	REP.b #$20
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	PLA
	RTL

CODE_0CB43E:
	RTS

DATA_0CB43F:
	db $00,$05,$06,$07,$06,$07,$06,$07,$06,$07,$06

DATA_0CB44A:
	db $02,$02,$32,$02,$02,$02,$02,$02,$02,$02,$32

CODE_0CB455:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_0CB471
	LDA.w #!Define_YI_NorSpr030_LittleMouser
	TXY
	JSL.l CODE_spawn_sprite
	SEP.b #$20
	LDA.b #$01
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	REP.b #$20
	RTL

CODE_0CB471:
	STZ.w $7D38,x
	JSL.l CODE_03AF23
	JSL.l CODE_07FD6C
	BCC.b CODE_0CB49A
	JSL.l CODE_03B20B
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	JSL.l CODE_0CFF61
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	JML.l CODE_03A31E

CODE_0CB49A:
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_0CB4A5
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0CB4A5:
	LDA.w $7A98,x
	BNE.b CODE_0CB4D1
	LDA.b $76,x
	CMP.w #$0001
	BNE.b CODE_0CB4B8
	LDA.w #!Define_YI_AmbSpr219
	JSL.l CODE_0C9C7E
CODE_0CB4B8:
	SEP.b #$20
	LDA.b $76,x
	CMP.b #$0B
	BCS.b CODE_0CB4D2
	TAY
	LDA.w DATA_0CB44A,y
	STA.w $7A98,x
	LDA.w DATA_0CB43F,y
	STA.w $7402,x
	INC.b $76,x
	REP.b #$20
CODE_0CB4D1:
	RTL

CODE_0CB4D2:
	REP.b #$20
	LDA.w #!Define_YI_NorSpr030_LittleMouser
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$01
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	REP.b #$20
	RTL

;---------------------------------------------------------------------------

DATA_0CB4EC:
	dw $FF80,$0080

DATA_0CB4F0:
	db $01,$01,$01,$01,$02,$02,$02,$02,$04,$04,$04,$04,$04,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00

;---------------------------------------------------------------------------
; Sprite $1A2: Health (Energy) Star pickup. Raiden: init_star.
;---------------------------------------------------------------------------
YI_NorSpr1A2_HealthStar_Init:
init_star:
;$0CB530
	LDA.w #$0280
	STA.w $7A96,x
CODE_0CB536:
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $1A2 main. Raiden: main_star.
;---------------------------------------------------------------------------
YI_NorSpr1A2_HealthStar_Main:
main_star:
;$0CB537
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_0CB536
	LDA.w $7AF6,x
	BNE.b CODE_0CB59D
	LDY.w $7D36,x
	BPL.b CODE_0CB59D
	LDA.w #!Define_YI_AmbSpr1EF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7142,y
	LDA.w #$0004
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w $70E2,x
	STA.w $0000
	LDA.w $7182,x
	STA.w $0002
	LDA.w #$0003
	STA.w $0004
	JSL.l CODE_03A4C3
	LDA.w $0396
	CLC
	ADC.w #$000A
	STA.w $0396
	LDA.w #$0082
	STA.w $0B7F
	JML.l CODE_despawn_sprite_free_slot

CODE_0CB59D:
	LDA.w $7A96,x
	BNE.b CODE_0CB5A6
	JML.l CODE_03A31E

CODE_0CB5A6:
	LSR
	LSR
	LSR
	LSR
	TAY
	SEP.b #$20
	LDX.b #$05
	LDA.b $14
	AND.w DATA_0CB4F0,y
	BEQ.b CODE_0CB5B8
	LDX.b #$FF
CODE_0CB5B8:
	TXA
	LDX.b $12
	STA.w $74A2,x
	REP.b #$20
	LDA.b $18,x
	BNE.b CODE_0CB605
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_0CB5F6
	LDY.b #$02
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCC.b CODE_0CB5F1
	LDY.b #$01
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0CB5F1
	LDY.b #$03
	CMP.w #$0100
	BCC.b CODE_0CB5F1
	LDY.b #$04
	CMP.w #$0180
	BCC.b CODE_0CB5F1
	LDY.b #$05
CODE_0CB5F1:
	TYA
	STA.w $7402,x
	RTL

CODE_0CB5F6:
	STZ.w $7402,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0002
	STA.w $7A98,x
	INC.b $18,x
	RTL

CODE_0CB605:
	LDA.w $7A98,x
	BNE.b CODE_0CB62D
	LDY.w $7A36,x
	BNE.b CODE_0CB61C
	LDY.w $77C2,x
	TYA
	EOR.w #$0002
	STA.w $7400,x
	INC.w $7A36,x
CODE_0CB61C:
	LDY.w $7400,x
	LDA.w DATA_0CB4EC,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.b $18,x
CODE_0CB62D:
	RTL

;---------------------------------------------------------------------------

DATA_0CB62E:
	dw $FF00,$0100

DATA_0CB632:
	dw $FFE8,$0018

;---------------------------------------------------------------------------
; Sprite $104: Jean de Fillet (fish). Raiden: init_jean_de_fillet.
;---------------------------------------------------------------------------
YI_NorSpr104_JeanDeFillet_Init:
init_jean_de_fillet:
;$0CB636
	JSL.l CODE_03AE60
	JSR.w CODE_0CB7A8
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w $70E2,x
	CLC
	ADC.w DATA_0CB632,y
	STA.w $7A36,x
	LDA.w #$3000
	STA.b $16,x
	LDY.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CPY.b #$03
	BNE.b CODE_0CB671
CODE_0CB663:
	LDA.w $7182,x
	SEC
	SBC.w #$0004
	STA.w $7182,x
	STA.w $7A38,x
	RTL

CODE_0CB671:
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	AND.w #$FF00
	CMP.w #$7E00
	BEQ.b CODE_0CB663
	LDA.w $7182,x
	STA.w $7A38,x
	RTL

;---------------------------------------------------------------------------

ADDR_0CB69E:
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w $7182,x
	STA.w $7A38,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $104 main. Raiden: main_jean_de_fillet.
;---------------------------------------------------------------------------
YI_NorSpr104_JeanDeFillet_Main:
main_jean_de_fillet:
;$0CB6AC
	JSL.l CODE_03AA52
	JSL.l CODE_03AF23
	SEP.b #$20
	LDA.b #$FF
	STA.w $7863,x
	REP.b #$20
	JSR.w CODE_0CB7A8
	JSR.w CODE_0CB90A
	LDY.b $18,x
	TYX
	JMP.w (DATA_jean_de_fillet_state_ptr,x)

DATA_0CB6C9:
DATA_jean_de_fillet_state_ptr:                  ; 4-entry Jean De Fillet state ptr (jump-out / arc / dive / return)
	dw CODE_0CB6D1
	dw CODE_0CB6F5
	dw CODE_0CB74F
	dw CODE_0CB765

CODE_0CB6D1:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CB6F4
	LDA.w #$FA00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.w $7400,x
	LDA.w DATA_0CB62E,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$40
	STA.w $7542,x
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
CODE_0CB6F4:
	RTL

CODE_0CB6F5:
	LDX.b $12
	JSR.w CODE_0CB7EC
	JSR.w CODE_0CB781
	LDA.w $7A38,x
	CLC
	ADC.w #$0010
	CMP.w $7182,x
	BCS.b CODE_0CB73E
	STA.w $7182,x
	LDY.w $7400,x
	LDA.w $7A36,x
	CLC
	ADC.w DATA_0CB632,y
	STA.w $70E2,x
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.w #$3000
	STA.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	SEP.b #$20
	LDA.b #$20
	STA.w $7A96,x
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
	RTL

CODE_0CB73E:
	LDA.b $16,x
	SEC
	SBC.w #$0200
	CMP.w #$D000
	BPL.b CODE_0CB74C
	LDA.w #$D000
CODE_0CB74C:
	STA.b $16,x
	RTL

CODE_0CB74F:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CB764
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
CODE_0CB764:
	RTL

CODE_0CB765:
	LDX.b $12
	LDA.w $7A38,x
	CMP.w $7182,x
	BCC.b CODE_0CB780
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$20
	STA.w $7A96,x
	STZ.b $18,x
	REP.b #$20
CODE_0CB780:
	RTL

CODE_0CB781:
	LDY.w $7400,x
	BNE.b CODE_0CB794
	LDA.w $7A36,x
	CLC
	ADC.w DATA_0CB632,y
	CMP.w $70E2,x
	BPL.b CODE_0CB7A0
CODE_0CB792:
	CLC
	RTS

CODE_0CB794:
	LDA.w $7A36,x
	CLC
	ADC.w DATA_0CB632,y
	CMP.w $70E2,x
	BPL.b CODE_0CB792
CODE_0CB7A0:
	STA.w $70E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEC
	RTS

CODE_0CB7A8:
	REP.b #$10
	LDA.b $16,x
	EOR.w #$FFFF
	INC
	XBA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #FXDATA_550000+$40E1
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$40E1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	SEP.b #$10
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTS

CODE_0CB7EC:
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDY.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0CB82B
	TXY
	TAX
	LDA.l $70001C,x
	AND.w #$F800
	CMP.w #$4000
	BEQ.b CODE_0CB817
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	BMI.b CODE_0CB812
	LDA.l $70001C,x
	BIT.w #$0008
	BEQ.b CODE_0CB889
CODE_0CB812:
	SEP.b #$10
	LDX.b $12
	RTS

CODE_0CB817:
	LDA.l $700018,x
	STA.b $00
	STA.w $0091
	LDA.l $70001A,x
	STA.b $02
	STA.w $0093
	BRA.b CODE_0CB84B

CODE_0CB82B:
	TXY
	TAX
	LDA.l $700024,x
	AND.w #$F800
	CMP.w #$4000
	BNE.b CODE_0CB884
	LDA.l $700020,x
	STA.b $00
	STA.w $0091
	LDA.l $700022,x
	STA.b $02
	STA.w $0093
CODE_0CB84B:
	SEP.b #$10
	LDA.w #$0000
	STA.w $008F
	JSL.l CODE_change_map16
	LDX.b $12
	LDA.w #!Define_YI_AmbSpr1C3
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	AND.w #$FFF0
	STA.w $70A2,y
	LDA.b $02
	AND.w #$FFF0
	STA.w $7142,y
	LDA.w #$000A
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #!Define_YI_SoundID0A_BreakDirt
	JSL.l CODE_push_sound_queue
	RTS

CODE_0CB884:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	BPL.b CODE_0CB89D
CODE_0CB889:
	LDA.l $700024,x
	SEP.b #$10
	LDX.b $12
	BIT.w #$0008
	BEQ.b CODE_0CB8A1
	AND.w #$0010
	BNE.b CODE_0CB8A2
	BRA.b CODE_0CB8DE

CODE_0CB89D:
	SEP.b #$10
	LDX.b $12
CODE_0CB8A1:
	RTS

CODE_0CB8A2:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.b $78,x
	LDA.w #!Define_YI_SoundID5F_Splash1
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr1C7
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7142,y
	LDA.w #$FF40
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0008
	STA.w $7502,y
	LDA.w #$0200
	STA.w $75A2,y
	LDA.w #$0030
	STA.w $7782,y
	RTS

CODE_0CB8DE:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.b $78,x
	LDA.w #!Define_YI_SoundID5F_Splash1
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr1BA
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$001A
	STA.w $7E4C,y
	LDA.w #$0003
	STA.w $7782,y
	RTS

CODE_0CB90A:
	LDY.w $7D36,x
	BPL.b CODE_0CB913
	JSL.l CODE_03A858
CODE_0CB913:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $1AA: Hot Lips. Raiden: init_hot_lips.
;---------------------------------------------------------------------------
YI_NorSpr1AA_HotLips_Init:
init_hot_lips:
;$0CB914
	LDA.w $7182,x
	SEC
	SBC.w #$0004
	LDY.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CPY.b #$03
	BNE.b CODE_0CB926
	SEC
	SBC.w #$0004
CODE_0CB926:
	STA.w $7182,x
	STA.w $7A38,x
CODE_0CB92C:
	SEP.b #$20
	LDA.b #$05
	STA.b $18,x
	TAY
	LDA.w DATA_0CBA90,y
	STA.w $7402,x
	LDA.w DATA_0CBA96,y
	STA.w $7A96,x
	STZ.b $76,x
	REP.b #$20
	RTL

;---------------------------------------------------------------------------

DATA_0CB944:
	dw $FC08,$020D,$0100,$0DFC,$0002,$0008,$0206,$F802
	dw $0000,$0202,$FC08,$020C,$0100,$0CFC,$0002,$0008
	dw $0206,$F802,$0000,$0202,$FC08,$420C,$0100,$0CFC
	dw $0042,$0008,$0206,$F802,$0000,$0202,$FC08,$420D
	dw $0100,$0DFC,$0042,$0008,$0206,$F802,$0000,$0202
	dw $FC08,$421C,$0100,$1CFC,$0042,$0008,$0206,$F802
	dw $0000,$0202,$00F9,$0202,$0902,$0600,$0202,$FC09
	dw $020D,$0200,$0DFC,$0002,$000A,$020A,$FA02,$0201
	dw $0202,$FC0A,$020C,$0300,$0CFC,$0002,$00F7,$0204
	dw $0002,$1CFC,$0042,$FC07,$021C,$0700,$0600,$0202

DATA_0CB9E4:
	dw $FFF2,$FFFE,$FFEC,$FFF8,$FFE6,$FFF2,$FFE0,$FFEC
	dw $FFDA,$FFE6,$FFD4,$FFE0,$FFCE,$FFDA,$FFC8,$FFD4
	dw $FFC2,$FFCE,$FFBC,$FFC8,$FFB6,$FFC2,$FFB0,$FFBC
	dw $FFAA,$FFB6,$FFA4,$FFB0,$FF9E,$FFAA,$FF98,$FFA4
	dw $FF92,$FF9E,$FF8C,$FF98

;---------------------------------------------------------------------------
; Sprite $1AA main. Raiden: main_hot_lips.
;---------------------------------------------------------------------------
YI_NorSpr1AA_HotLips_Main:
main_hot_lips:
;$0CBA2C
	LDY.w $74A2,x
	BMI.b CODE_0CBA71
	LDA.w #DATA_0CB944>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_0CB944
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7402,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $16,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #DATA_0CB9E4
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #DATA_0CB9E4>>16
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0004
	STA.w $600A
	LDA.w #$0004
	STA.w $600C
	LDA.w #$020F
	STA.w $600E
	LDX.b #FXCODE_089822>>16
	LDA.w #FXCODE_089822
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_0CBA71:
	JSL.l CODE_03AF23
	JSR.w CODE_0CBDFC
	LDY.b $76,x
	TYX
	JMP.w (DATA_hot_lips_state_ptr,x)

DATA_0CBA7E:
DATA_hot_lips_state_ptr:                        ; 9-entry Hot Lips state ptr (idle / pucker / inhale / blow / cool-off variants)
	dw CODE_0CBA9C
	dw CODE_0CBAF3
	dw CODE_0CBB2F
	dw CODE_0CBB6C
	dw CODE_0CBB9B
	dw CODE_0CBBD9
	dw CODE_0CBC3E
	dw CODE_0CBC58
	dw CODE_0CBCAE

DATA_0CBA90:
	db $01,$02,$03,$02,$01,$00

DATA_0CBA96:
	db $10,$10,$10,$10,$10,$10

CODE_0CBA9C:
	LDX.b $12
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCS.b CODE_0CBAE0
	STZ.w $7402,x
	LDA.w #$FE00
	STA.w $75E2,x
	LDA.w #$0010
	STA.w $7542,x
	SEP.b #$20
	LDA.b #$05
	STA.b $18,x
	TAY
	LDA.w DATA_0CBA90,y
	STA.w $7402,x
	LDA.w DATA_0CBA96,y
	STA.w $7A96,x
	INC.b $76,x
	INC.b $76,x
	REP.b #$20
	RTL

CODE_0CBAE0:
	LDA.w #$0005
	STA.b $00
	LDA.w #DATA_0CBA90
	STA.b $02
	LDA.w #DATA_0CBA96
	STA.b $04
	JSR.w CODE_0CBE2D
	RTL

CODE_0CBAF3:
	LDX.b $12
	LDA.w $7A38,x
	SEC
	SBC.w #$0004
	CMP.w $7182,x
	BMI.b CODE_0CBB26
	STA.w $7182,x
	STZ.w $75E2,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$03
	STA.b $18,x
	TAY
	LDA.w DATA_0CBB27,y
	STA.w $7402,x
	LDA.w DATA_0CBB2B,y
	STA.w $7A96,x
	INC.b $76,x
	INC.b $76,x
	REP.b #$20
CODE_0CBB26:
	RTL

DATA_0CBB27:
	db $07,$06,$05,$00

DATA_0CBB2B:
	db $02,$30,$08,$50

CODE_0CBB2F:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CBB4C
	SEP.b #$20
	DEC.b $18,x
	BMI.b CODE_0CBB4D
	LDY.b $18,x
	LDA.w DATA_0CBB27,y
	STA.w $7402,x
	LDA.w DATA_0CBB2B,y
	STA.w $7A96,x
	REP.b #$20
CODE_0CBB4C:
	RTL

CODE_0CBB4D:
	LDA.b #$D1
	STA.w $7A98,x
	INC.b $76,x
	INC.b $76,x
	REP.b #$20
	RTL

DATA_0CBB59:
	db $08,$08,$08,$08,$08,$08,$08,$08,$08,$08,$08,$08,$08,$08,$08,$08
	db $08,$08,$10

CODE_0CBB6C:
	LDX.b $12
	LDA.w $7A98,x
	BEQ.b CODE_0CBB92
	JSR.w CODE_0CBD85
	LDA.w $7A96,x
	BNE.b CODE_0CBB8E
	SEP.b #$20
	LDY.b $16,x
	CPY.b #$12
	BCS.b CODE_0CBB94
	INC.b $16,x
	INY
	LDA.w DATA_0CBB59,y
	STA.w $7A96,x
	REP.b #$20
CODE_0CBB8E:
	JSR.w CODE_0CBD09
	RTL

CODE_0CBB92:
	SEP.b #$20
CODE_0CBB94:
	INC.b $76,x
	INC.b $76,x
	REP.b #$20
	RTL

CODE_0CBB9B:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CBBAE
	LDY.b $16,x
	BEQ.b CODE_0CBBB2
	DEC.b $16,x
	LDA.w #$0001
	STA.w $7A96,x
CODE_0CBBAE:
	JSR.w CODE_0CBD09
	RTL

CODE_0CBBB2:
	SEP.b #$20
	LDA.b #$80
	STA.w $7A98,x
	LDA.b #$03
	STA.b $18,x
	TAY
	LDA.w DATA_0CBBD1,y
	STA.w $7402,x
	LDA.w DATA_0CBBD5,y
	STA.w $7A96,x
	INC.b $76,x
	INC.b $76,x
	REP.b #$20
	RTL

DATA_0CBBD1:
	db $00,$01,$00,$04

DATA_0CBBD5:
	db $04,$20,$04,$20

CODE_0CBBD9:
	LDX.b $12
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w #$00A0
	CMP.w #$0140
	BCC.b CODE_0CBC0C
	LDA.w #$0200
	STA.w $75E2,x
	LDA.w #$0010
	STA.w $7542,x
	SEP.b #$20
	STZ.w $7402,x
	INC.b $76,x
	INC.b $76,x
	REP.b #$20
	RTL

CODE_0CBC0C:
	LDA.w $7A98,x
	BEQ.b CODE_0CBC24
	LDA.w #$0003
	STA.b $00
	LDA.w #DATA_0CBBD1
	STA.b $02
	LDA.w #DATA_0CBBD5
	STA.b $04
	JSR.w CODE_0CBE2D
	RTL

CODE_0CBC24:
	SEP.b #$20
	LDA.b #$03
	STA.b $18,x
	TAY
	LDA.w DATA_0CBB27,y
	STA.w $7402,x
	LDA.w DATA_0CBB2B,y
	STA.w $7A96,x
	LDA.b #$04
	STA.b $76,x
	REP.b #$20
	RTL

CODE_0CBC3E:
	LDX.b $12
	LDA.w $7A38,x
	CMP.w $7182,x
	BPL.b CODE_0CBC57
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w $75E2,x
	JMP.w CODE_0CB92C

CODE_0CBC57:
	RTL

CODE_0CBC58:
	LDX.b $12
	LDY.b $16,x
	BNE.b CODE_0CBC9D
	LDA.w $7A38,x
	CLC
	ADC.w #$0010
	CMP.w $7182,x
	BMI.b CODE_0CBC80
	LDA.b $18,x
	BNE.b CODE_0CBC7F
	LDA.w #$0200
	STA.w $75E2,x
	LDA.w #$0010
	STA.w $7542,x
	STZ.w $7402,x
	INC.b $18,x
CODE_0CBC7F:
	RTL

CODE_0CBC80:
	STA.w $7182,x
	STZ.w $75E2,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.b $18,x
	LDA.w #$0140
	STA.w $7A96,x
	SEP.b #$20
	INC.b $76,x
	INC.b $76,x
	REP.b #$20
	RTL

CODE_0CBC9D:
	LDA.w $7A96,x
	BNE.b CODE_0CBCAA
	DEC.b $16,x
	LDA.w #$0000
	STA.w $7A96,x
CODE_0CBCAA:
	JSR.w CODE_0CBD09
	RTL

CODE_0CBCAE:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CBCDE
	LDA.w $7A38,x
	CMP.w $7182,x
	BMI.b CODE_0CBCCC
	STA.w $7182,x
	STZ.w $75E2,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	JMP.w CODE_0CB92C

CODE_0CBCCC:
	LDA.b $18,x
	BNE.b CODE_0CBCDE
	LDA.w #$FE00
	STA.w $75E2,x
	LDA.w #$0010
	STA.w $7542,x
	INC.b $18,x
CODE_0CBCDE:
	RTL

DATA_0CBCDF:
	dw $0001,$0001,$0001,$0001,$0001,$0001,$0001,$0001
	dw $0001,$0001,$0001,$0001,$0001,$0001,$0001,$0001
	dw $0001,$0001,$0003

DATA_0CBD05:
	dw $FD00,$0300

CODE_0CBD09:
	LDA.b $14
	AND.w #$0007
	BNE.b CODE_0CBD17
	LDA.w #!Define_YI_SoundID61_Splash3
	JSL.l CODE_push_sound_queue
CODE_0CBD17:
	LDA.b $16,x
	ASL
	TAY
	LDA.b $14
	AND.w DATA_0CBCDF,y
	BNE.b CODE_0CBD84
	LDY.w $7400,x
	LDA.w DATA_0CBD05,y
	STA.b $00
	LDA.b $16,x
	DEC
	ASL
	ASL
	TAY
	LDA.w DATA_0CB9E4,y
	PHY
	LDY.w $7400,x
	BEQ.b CODE_0CBD3D
	EOR.w #$FFFF
	INC
CODE_0CBD3D:
	PLY
	CLC
	ADC.w $70E2,x
	STA.b $02
	LDA.w $7182,x
	CLC
	ADC.w DATA_0CB9E4+$02,y
	STA.b $04
	LDA.w #!Define_YI_AmbSpr21B
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7002,y
	ORA.w #$0002
	STA.w $7002,y
	LDA.w $7400,x
	STA.w $73C0,y
	LDA.b $02
	STA.w $70A2,y
	LDA.b $04
	STA.w $7142,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0010
	STA.w $7782,y
	LDA.w #$0002
	STA.w $73C2,y
CODE_0CBD84:
	RTS

CODE_0CBD85:
	LDA.w #DATA_0CB9E4>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_0CB9E4
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $16,x
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_089436>>16
	LDA.w #FXCODE_089436
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	BPL.b CODE_0CBDA7
	RTS

CODE_0CBDA7:
	STA.b $16,x
	DEC
	ASL
	ASL
	TAY
	LDA.w DATA_0CB9E4,y
	PHY
	LDY.w $7400,x
	BEQ.b CODE_0CBDBA
	EOR.w #$FFFF
	INC
CODE_0CBDBA:
	PLY
	CLC
	ADC.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	CLC
	ADC.w DATA_0CB9E4+$02,y
	STA.b $02
	LDA.w $7AF6,x
	BNE.b CODE_0CBDF2
	LDA.w #$0004
	STA.w $7AF6,x
	LDA.w #!Define_YI_AmbSpr21E
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	STA.w $70A2,y
	LDA.b $02
	STA.w $7142,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #$0000
	STA.w $73C2,y
CODE_0CBDF2:
	REP.b #$10
	JSL.l CODE_player_death_spike
	SEP.b #$10
	PLA
	RTL

CODE_0CBDFC:
	LDY.w $7D36,x
	BPL.b CODE_0CBE06
	JSL.l CODE_03A858
	RTS

CODE_0CBE06:
	DEY
	BMI.b CODE_0CBE2C
	BEQ.b CODE_0CBE2C
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CBE2C
	LDA.w $7D38,y
	BEQ.b CODE_0CBE2C
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDX.b $12
	SEP.b #$20
	LDA.b #$0E
	STA.b $76,x
	REP.b #$20
	STZ.w $7A96,x
	STZ.b $18,x
CODE_0CBE2C:
	RTS

CODE_0CBE2D:
	LDA.w $7A96,x
	BNE.b CODE_0CBE4B
	SEP.b #$20
	DEC.b $18,x
	BPL.b CODE_0CBE3C
	LDA.b $00
	STA.b $18,x
CODE_0CBE3C:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	LDA.b ($02),y
	STA.w $7402,x
	LDA.b ($04),y
	STA.w $7A96,x
	REP.b #$20
CODE_0CBE4B:
	RTS

;---------------------------------------------------------------------------

DATA_0CBE4C:
	db $06,$1E,$1C,$00,$04,$16,$0D,$00,$05,$1E,$1C,$00,$04,$16,$0C,$00
	db $04,$1E,$1C,$00,$04,$16,$0C,$00,$05,$1E,$1C,$40,$05,$16,$0C,$40
	db $04,$1E,$1C,$40,$05,$16,$0C

DATA_0CBE73:
	db $40,$03,$1E,$1C,$40,$05,$16,$0D,$40,$06,$06,$06,$06,$08,$08,$08
	db $08,$0A,$0A,$0A,$0A

DATA_0CBE88:
	dw $0100,$FF00

DATA_0CBE8C:
	dw $0100,$FF00

DATA_0CBE90:
	dw $0006,$0008,$000A,$000C

;---------------------------------------------------------------------------
; Sprite $1AB: Boo Balloon. Raiden: init_boo_balloon.
;---------------------------------------------------------------------------
YI_NorSpr1AB_BooBalloon_Init:
init_boo_balloon:
;$0CBE98
	LDA.w #$0001
	STA.w $0C7E
	LDA.w DATA_0CBE8C
	STA.w $75E0,x
	LDA.w #$0008
	STA.w $7540,x
	LDA.w DATA_0CBE88
	STA.w $75E2,x
	LDA.w #$0008
	STA.w $7542,x
	LDA.w #$0090
	STA.b $16,x
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEP.b #$20
	STZ.b $76,x
	REP.b #$20
	RTL

;---------------------------------------------------------------------------

DATA_0CBECE:
	db $02,$01,$01,$00,$03,$04,$04,$05

;---------------------------------------------------------------------------
; Sprite $1AB main. Raiden: main_boo_balloon.
;---------------------------------------------------------------------------
YI_NorSpr1AB_BooBalloon_Main:
main_boo_balloon:
;$0CBED6
	LDY.w $74A2,x
	BMI.b CODE_0CBF21
	LDA.w $7402,x
	BEQ.b CODE_0CBEEE
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0018
	TAY
	JSL.l CODE_03AA60
CODE_0CBEEE:
	LDA.w #DATA_0CBE4C>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.b $76,x
	AND.w #$00FF
	ASL
	ASL
	ASL
	CLC
	ADC.w #DATA_0CBE4C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $16,x
	LSR
	LSR
	LSR
	LSR
	AND.w #$001F
	TAY
	LDA.w DATA_0CBE73,y
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0898C1>>16
	LDA.w #FXCODE_0898C1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_0CBF21:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_0CBF2E
	JSR.w CODE_0CC27A
	PLA
	PLY
CODE_0CBF2E:
	JSL.l CODE_03AF23
	JSR.w CODE_0CC01F
	JSR.w CODE_0CC220
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	LDY.b $77,x
	TYX
	JSR.w (DATA_boo_balloon_drift_substate_ptr,x)
	LDA.w $0C7E
	BNE.b CODE_0CBF5E
	LDA.w $7040,x
	ORA.w #$0004
	STA.w $7040,x
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0CBF5E:
	LDY.b #$00
	LDA.w $7400,x
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0CBF6B
	LDY.b #$04
CODE_0CBF6B:
	STY.w $7960
	SEP.b #$20
	LDA.w $7221,x
	BPL.b CODE_0CBF78
	EOR.b #$FF
	INC
CODE_0CBF78:
	CMP.b #$03
	BCC.b CODE_0CBF7E
	LDA.b #$03
CODE_0CBF7E:
	CLC
	ADC.b $00
	TAY
	LDA.w DATA_0CBECE,y
	STA.b $76,x
	REP.b #$20
	LDY.b $18,x
	TYX
	JMP.w (DATA_boo_balloon_phase_ptr,x)

DATA_0CBF8F:
DATA_boo_balloon_phase_ptr:                     ; 4-entry Boo Balloon main-phase ptr (intact / popping / shrinking / despawn)
	dw CODE_0CBF9D
	dw CODE_0CBFA6
	dw CODE_0CBFD6
	dw CODE_0CC006

DATA_0CBF97:
DATA_boo_balloon_drift_substate_ptr:            ; 3-entry Boo Balloon drift sub-state ptr (free-drift / approach / pursuit)
	dw CODE_0CC11F
	dw CODE_0CC156
	dw CODE_0CC1AA

CODE_0CBF9D:
	LDX.b $12
	JSR.w CODE_0CC065
	JSR.w CODE_0CC0F5
	RTL

CODE_0CBFA6:
	LDX.b $12
	LDA.b $78,x
	BNE.b CODE_0CBFBF
	LDA.b $16,x
	CMP.w #$00E0
	BCS.b CODE_0CBFBC
	LDA.b $16,x
	CLC
	ADC.w #$0002
	STA.b $16,x
	RTL

CODE_0CBFBC:
	INC.b $78,x
	RTL

CODE_0CBFBF:
	LDA.b $16,x
	CMP.w #$00CC
	BCC.b CODE_0CBFCF
	LDA.b $16,x
	SEC
	SBC.w #$0002
	STA.b $16,x
	RTL

CODE_0CBFCF:
	JSR.w CODE_0CC065
	JSR.w CODE_0CC0F5
	RTL

CODE_0CBFD6:
	LDX.b $12
	LDA.b $78,x
	BNE.b CODE_0CBFEF
	LDA.b $16,x
	CMP.w #$0120
	BCS.b CODE_0CBFEC
	LDA.b $16,x
	CLC
	ADC.w #$0002
	STA.b $16,x
	RTL

CODE_0CBFEC:
	INC.b $78,x
	RTL

CODE_0CBFEF:
	LDA.b $16,x
	CMP.w #$0100
	BCC.b CODE_0CBFFF
	LDA.b $16,x
	SEC
	SBC.w #$0002
	STA.b $16,x
	RTL

CODE_0CBFFF:
	JSR.w CODE_0CC065
	JSR.w CODE_0CC0F5
	RTL

CODE_0CC006:
	LDX.b $12
	LDA.b $16,x
	CMP.w #$0130
	BCS.b CODE_0CC018
	LDA.b $16,x
	CLC
	ADC.w #$0002
	STA.b $16,x
	RTL

CODE_0CC018:
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	RTL

CODE_0CC01F:
	LDA.w $7402,x
	BEQ.b CODE_0CC064
	LDA.w $7722,x
	BMI.b CODE_0CC064
	REP.b #$10
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $16,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #FXDATA_550000+$40C1
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$40C1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEP.b #$10
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
CODE_0CC064:
	RTS

CODE_0CC065:
	STZ.w $7A36,x
	LDY.w $7D36,x
	BPL.b CODE_0CC072
	JSL.l CODE_03A858
CODE_0CC071:
	RTS

CODE_0CC072:
	DEY
	BMI.b CODE_0CC071
	BEQ.b CODE_0CC071
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CC071
	LDA.w $7D38,y
	BEQ.b CODE_0CC071
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	AND.w #$8000
	ASL
	ROL
	ASL
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	AND.w #$8000
	ASL
	ROL
	ASL
	STA.b $02
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDY.b $00
	LDA.w DATA_0CC276,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b $02
	LDA.w DATA_0CC276,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0CC0AF:
	LDX.b $12
	LDA.w $7A36,x
	BNE.b CODE_0CC071
	INC.w $7A36,x
	LDY.b $18,x
	BNE.b CODE_0CC0CC
	LDA.w #$0001
	STA.w $7402,x
	JSL.l CODE_03AD74
	BCC.b CODE_0CC0ED
	JSR.w CODE_0CC01F
CODE_0CC0CC:
	LDA.w #!Define_YI_SoundID16_DeflateBalloon
	JSL.l CODE_push_sound_queue
	STZ.b $78,x
	SEP.b #$20
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
	LDY.b $18,x
	LDA.w DATA_0CBE90,y
	STA.w $7BB6,x
	LDA.w DATA_0CBE90,y
	STA.w $7BB8,x
	PLA
	RTL

CODE_0CC0ED:
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	PLA
	RTL

CODE_0CC0F5:
	LDY.b $77,x
	BNE.b CODE_0CC11E
	LDA.b $10
	AND.w #$007F
	CMP.w #$003F
	BNE.b CODE_0CC11E
	JSL.l CODE_random_number_gen
	LDA.b $10
	AND.w #$000F
	CLC
	ADC.w #$0020
	STA.w $7A98,x
	JSR.w CODE_0CC174
	SEP.b #$20
	INC.b $77,x
	INC.b $77,x
	REP.b #$20
CODE_0CC11E:
	RTS

CODE_0CC11F:
	LDX.b $12
	LDY.b #$00
	LDA.w $7682,x
	CMP.w #$0020
	BMI.b CODE_0CC12D
	INY
	INY
CODE_0CC12D:
	LDA.w DATA_0CBE88,y
	STA.w $75E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0CC147
	LDA.w $7680,x
	CMP.w #$0060
	BPL.b CODE_0CC146
	LDA.w DATA_0CBE8C
	STA.w $75E0,x
CODE_0CC146:
	RTS

CODE_0CC147:
	LDA.w $7680,x
	CMP.w #$0090
	BMI.b CODE_0CC155
	LDA.w DATA_0CBE8C+$02
	STA.w $75E0,x
CODE_0CC155:
	RTS

CODE_0CC156:
	LDX.b $12
	LDA.w $7A98,x
	BNE.b CODE_0CC174
	LDA.w DATA_0CBE8C+$02
	LDY.w $7221,x
	BMI.b CODE_0CC168
	LDA.w DATA_0CBE8C
CODE_0CC168:
	STA.w $75E0,x
	SEP.b #$20
	INC.b $77,x
	INC.b $77,x
	REP.b #$20
	RTS

CODE_0CC174:
	LDA.w $611C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $611E
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7CD6,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0300
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $75E0,x
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w $75E2,x
	RTS

CODE_0CC1AA:
	LDX.b $12
	LDY.b #$00
	LDA.w $7682,x
	CMP.w #$0020
	BMI.b CODE_0CC1B8
	INY
	INY
CODE_0CC1B8:
	LDA.w DATA_0CBE88,y
	STA.w $75E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0CC1D3
	LDA.w $7680,x
	CMP.w #$0060
	BPL.b CODE_0CC1E1
	LDA.w DATA_0CBE8C
	STA.w $75E0,x
	BRA.b CODE_0CC1E1

CODE_0CC1D3:
	LDA.w $7680,x
	CMP.w #$0090
	BMI.b CODE_0CC1E1
	LDA.w DATA_0CBE8C+$02
	STA.w $75E0,x
CODE_0CC1E1:
	LDA.w $7682,x
	SEC
	SBC.w #$0020
	CLC
	ADC.w #$0008
	CMP.w #$0010
	BCS.b CODE_0CC217
	LDA.w $7680,x
	CMP.w #$00F0
	BCS.b CODE_0CC217
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0040
	STA.w $7A98,x
	LDA.w #$0008
	STA.w $7542,x
	LDA.w #$0008
	STA.w $7540,x
	SEP.b #$20
	STZ.b $77,x
	REP.b #$20
CODE_0CC217:
	RTS

DATA_0CC218:
	dw $0100,$0800

DATA_0CC21C:
	dw $0100,$0800

CODE_0CC220:
	LDA.w $0C7E
	BEQ.b CODE_0CC275
	LDA.w $7680,x
	CLC
	ADC.w #$0020
	CMP.w #$0130
	BCC.b CODE_0CC24D
	LDY.b #$00
	CLC
	ADC.w #$0030
	CMP.w #$0190
	BCC.b CODE_0CC23E
	INY
	INY
CODE_0CC23E:
	LDA.w DATA_0CC218,y
	LDY.w $7681,x
	BMI.b CODE_0CC24A
	EOR.w #$FFFF
	INC
CODE_0CC24A:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0CC24D:
	LDA.w $7682,x
	CLC
	ADC.w #$0020
	CMP.w #$0110
	BCC.b CODE_0CC275
	LDY.b #$00
	CLC
	ADC.w #$0030
	CMP.w #$0170
	BCC.b CODE_0CC266
	INY
	INY
CODE_0CC266:
	LDA.w DATA_0CC21C,y
	LDY.w $7683,x
	BMI.b CODE_0CC272
	EOR.w #$FFFF
	INC
CODE_0CC272:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0CC275:
	RTS

DATA_0CC276:
	dw $0100,$FF00

CODE_0CC27A:
	LDA.w $6150
	CMP.w #$0003
	BCC.b CODE_0CC28A
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_0CC293

CODE_0CC28A:
	LDY.w $77C2,x
	LDA.w DATA_0CC276,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0CC293:
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.w $6162
	STZ.w $6168
	RTS

CODE_0CC2A0:
	JSR.w CODE_0CC0AF
	RTL

;---------------------------------------------------------------------------
; Sprite $1AB head-bop. Raiden: head_bop_boo_balloon.
;---------------------------------------------------------------------------
YI_NorSpr1AB_BooBalloon_StompRt:
head_bop_boo_balloon:
;$0CC2A4
	LDY.w $74A2,x
	BMI.b CODE_0CC2EF
	LDA.w $7402,x
	BEQ.b CODE_0CC2BC
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0018
	TAY
	JSL.l CODE_03AA60
CODE_0CC2BC:
	LDA.w #DATA_0CBE4C>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.b $76,x
	AND.w #$00FF
	ASL
	ASL
	ASL
	CLC
	ADC.w #DATA_0CBE4C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $16,x
	LSR
	LSR
	LSR
	LSR
	AND.w #$001F
	TAY
	LDA.w DATA_0CBE73,y
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0898C1>>16
	LDA.w #FXCODE_0898C1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_0CC2EF:
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	JSL.l CODE_04849E
	JSL.l CODE_despawn_sprite_free_slot
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TYX
	JSR.w (DATA_boo_balloon_pop_payload_ptr,x)
	RTL

DATA_0CC306:
DATA_boo_balloon_pop_payload_ptr:               ; 2-entry Boo Balloon pop-payload ptr (with-payload / empty-pop)
	dw CODE_0CC32B
	dw CODE_0CC30A

CODE_0CC30A:
	LDX.b $12
	LDA.w #$009D
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0CC348
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	RTS

CODE_0CC32B:
	LDX.b $12
	LDA.w #$0115
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0CC348
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
CODE_0CC348:
	RTS

;---------------------------------------------------------------------------

DATA_0CC349:
	db $10,$20,$30,$40,$50,$60,$70,$80,$90,$A0,$B0,$C0,$D0,$E0,$F0,$10
	db $00,$10,$20,$30,$40,$50,$60,$70,$80,$90,$A0,$B0,$C0,$D0,$00,$10

;---------------------------------------------------------------------------
; Sprite $1AD: Kamek (spawns magic projectile sprite $1AE). Raiden: init_kamek_shoots_magic.
;---------------------------------------------------------------------------
YI_NorSpr1AD_MagicShootingKamek_Init:
init_kamek_shoots_magic:
;$0CC369
	JSL.l CODE_03AE60
	LDA.w $70E2,x
	STA.w $7A38,x
	LDA.w $7182,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0000
	STA.w $7402,x
	LDA.w #$0100
	STA.b $76,x
	SEP.b #$20
	LDA.w $7041,x
	AND.b #$27
	STA.w $7041,x
	LDA.b #$FF
	STA.w $74A2,x
	LDA.b #$02
	STA.w $77C0,x
	REP.b #$20
CODE_0CC39A:
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $1AD main. Raiden: main_kamek_shoots_magic.
;---------------------------------------------------------------------------
YI_NorSpr1AD_MagicShootingKamek_Main:
main_kamek_shoots_magic:
;$0CC39B
	LDA.w $7402,x
	BNE.b CODE_0CC3A4
	JSL.l CODE_03AA52
CODE_0CC3A4:
	JSL.l CODE_03AF23
	LDY.b $18,x
	TYX
	JMP.w (DATA_kamek_shoots_magic_state_ptr,x)

DATA_0CC3AE:
DATA_kamek_shoots_magic_state_ptr:              ; 6-entry Magic-Shooting Kamek state ptr ($00 pick-spot / $02 scale-in / $04 wavy-in / $06 cast+volley / $08 scale-out / $0A wavy-out)
	dw kamek_shoots_magic_state_pick_spot
	dw kamek_shoots_magic_state_scale_in
	dw kamek_shoots_magic_state_wavy_in
	dw kamek_shoots_magic_state_cast_volley
	dw kamek_shoots_magic_state_scale_out
	dw kamek_shoots_magic_state_wavy_out

kamek_shoots_magic_state_pick_spot:             ; state $00: GSU floor probe (FXCODE_0AE921) picks a landing column near the camera; re-places Kamek there, then enters scale-in ($02) or wavy-in ($04) on $10 sign
CODE_0CC3BA:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CC39A
	LDA.b $10
	AND.w #$000F
	TAY
	LDA.w DATA_0CC349,y
	AND.w #$00FF
	STA.b $00
	LDA.w !RAM_YI_Global_Layer1XPosLo
	AND.w #$FFF0
	CLC
	ADC.b $00
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	JSL.l CODE_random_number_gen
	LDA.w #$0030
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0040
	STA.w $6020
	LDX.b #FXCODE_0AE921>>16
	LDA.w #FXCODE_0AE921
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	BNE.b CODE_0CC442
	LDY.b #$00
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $70E2,x
	CLC
	ADC.w $7B56,x
	SEC
	SBC.w $611C
	BPL.b CODE_0CC40F
	INY
	INY
CODE_0CC40F:
	TYA
	STA.w $7400,x
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEC
	SBC.w #$0013
	STA.w $7182,x
	STZ.w $7402,x
	LDA.w #!Define_YI_SoundID31_EnterPipe
	JSL.l CODE_push_sound_queue
	LDA.b $10
	BPL.b CODE_0CC443
	LDA.w #$0030
	STA.b $16,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $7862,x
	LDA.b #$05
	STA.w $74A2,x
	LDA.b #$02
	STA.b $18,x
	REP.b #$20
CODE_0CC442:
	RTL

CODE_0CC443:
	LDA.w #$0001
	STA.b $76,x
	LDA.b $10
	AND.w #$003F
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	LDA.w #$003F
	STA.b $78,x
	SEP.b #$20
	LDA.b #$05
	STA.w $74A2,x
	LDA.b #$04
	STA.b $18,x
	REP.b #$20
	JSR.w CODE_0CC6C4
	RTL

DATA_0CC466:
	db $01,$06,$05,$04,$03,$02,$01

DATA_0CC46D:
	db $10,$08,$10,$02,$02,$02,$30

DATA_0CC474:
	dw $FFF0,$0010

kamek_shoots_magic_state_cast_volley:           ; state $06: cast animation ($19,x over DATA_0CC466/46D); spawns a $01AE MagicShot at frame index 1, repeats while $77C0 volleys remain, then picks scale-out ($08) or wavy-out ($0A)
CODE_0CC478:
	LDX.b $12
	JSR.w kamek_shoots_magic_dodge_if_threatened
	JSR.w kamek_shoots_magic_noop_stub
	LDA.w $7A96,x
	BNE.b CODE_0CC4D7
	SEP.b #$20
	DEC.b $19,x
	BMI.b CODE_0CC4D8
	LDY.b $19,x
	LDA.w DATA_0CC46D,y
	STA.w $7A96,x
	LDA.w DATA_0CC466,y
	STA.w $7402,x
	REP.b #$20
	CPY.b #$01
	BNE.b CODE_0CC4D7
	LDY.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_0CC474,y
	STA.b $00
	LDA.w #$01AE
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0CC4D7
	LDA.b $00
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0002
	STA.w $7182,y
	LDA.w $70E2,y
	CLC
	ADC.w $7B56,y
	STA.w $7CD6,y
	LDA.w $7182,y
	CLC
	ADC.w $7B58,y
	STA.w $7CD8,y
CODE_0CC4D7:
	RTL

CODE_0CC4D8:
	DEC.w $77C0,x
	BEQ.b CODE_0CC4F6
	LDA.b #$06
	STA.b $19,x
	TAY
	LDA.b #$08
	STA.w $7A96,x
	LDA.w DATA_0CC466,y
	STA.w $7402,x
	LDA.w $77C2,x
	STA.w $7400,x
	REP.b #$20
	RTL

CODE_0CC4F6:
	LDA.b #$02
	STA.w $77C0,x
	LDA.b #!Define_YI_SoundID31_EnterPipe
	JSL.l CODE_push_sound_queue
	LDA.w $7041,x
	AND.b #$27
	STA.w $7041,x
	STZ.w $7402,x
	LDA.b $10
	AND.b #$01
	PHP
	JSL.l CODE_random_number_gen
	PLP
	BNE.b CODE_0CC524
	LDA.b #$08
	STA.b $18,x
	REP.b #$20
	LDA.w #$0100
	STA.b $16,x
	RTL

CODE_0CC524:
	LDA.b #$0A
	STA.b $18,x
	REP.b #$20
	LDA.w #$0001
	STA.b $76,x
	LDA.b $10
	AND.w #$003F
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	LDA.w #$003F
	STA.b $78,x
	RTL

kamek_shoots_magic_state_scale_in:              ; state $02: grows the GSU scale factor $16,x by $10/frame up to $0100, then advances to the cast state ($06)
CODE_0CC53D:
	LDX.b $12
	JSR.w CODE_0CC5F4
	LDA.b $16,x
	CMP.w #$0100
	BCS.b CODE_0CC550
	CLC
	ADC.w #$0010
	STA.b $16,x
	RTL

CODE_0CC550:
	LDA.w #$0100
	STA.b $16,x
	SEP.b #$20
	LDA.w $7041,x
	ORA.b #$10
	STA.w $7041,x
	LDA.b #$06
	STA.b $19,x
	TAY
	LDA.w DATA_0CC46D,y
	STA.w $7A96,x
	LDA.w DATA_0CC466,y
	STA.w $7402,x
	LDA.b $18,x
	CLC
	ADC.b #$04
	STA.b $18,x
	LDA.w $77C2,x
	STA.w $7400,x
	REP.b #$20
	RTL

kamek_shoots_magic_state_wavy_in:               ; state $04: wavy-distortion materialize -- advances phase $16,x by $76,x (mod $40) while $78,x counts down, then advances to the cast state ($06)
CODE_0CC580:
	LDX.b $12
	JSR.w CODE_0CC679
	DEC.b $78,x
	BMI.b CODE_0CC594
	LDA.b $16,x
	CLC
	ADC.b $76,x
	AND.w #$003F
	STA.b $16,x
	RTL

CODE_0CC594:
	SEP.b #$20
	LDA.w $7041,x
	ORA.b #$10
	STA.w $7041,x
	LDA.b #$06
	STA.b $19,x
	TAY
	LDA.w DATA_0CC46D,y
	STA.w $7A96,x
	LDA.w DATA_0CC466,y
	STA.w $7402,x
	INC.b $18,x
	INC.b $18,x
	LDA.w $77C2,x
	STA.w $7400,x
	REP.b #$20
	RTL

kamek_shoots_magic_state_scale_out:             ; state $08: shrinks $16,x by $10/frame down to $30, then arms the $20-frame re-appear cooldown and resets to state $00
CODE_0CC5BC:
	LDX.b $12
	JSR.w CODE_0CC5F4
	LDA.b $16,x
	CMP.w #$0030
	BCC.b CODE_0CC5CF
	SEC
	SBC.w #$0010
	STA.b $16,x
	RTL

CODE_0CC5CF:
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A2,x
	LDA.b #$20
	STA.w $7A96,x
	STZ.b $18,x
	REP.b #$20
	RTL

kamek_shoots_magic_state_wavy_out:              ; state $0A: wavy-distortion vanish ($78,x countdown), then joins state $08's tail to reset to state $00
CODE_0CC5E0:
	LDX.b $12
	JSR.w CODE_0CC640
	DEC.b $78,x
	BMI.b CODE_0CC5CF
	LDA.b $16,x
	CLC
	ADC.b $76,x
	AND.w #$003F
	STA.b $16,x
	RTL

CODE_0CC5F4:
	LDA.w $7402,x
	BNE.b CODE_0CC63F
	LDA.w $7722,x
	BMI.b CODE_0CC63F
	REP.b #$10
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$001F
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.b $16,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #FXDATA_550000+$60C1
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$60C1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEP.b #$10
	LDX.b #FXCODE_088293>>16
	LDA.w #FXCODE_088293
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
CODE_0CC63F:
	RTS

CODE_0CC640:
	LDA.w $7402,x
	BNE.b CODE_0CC678
	LDA.w $7722,x
	BMI.b CODE_0CC678
	REP.b #$10
	LDA.b $16,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	SEP.b #$10
	LDX.b #FXCODE_089981>>16
	LDA.w #FXCODE_089981
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
CODE_0CC678:
	RTS

CODE_0CC679:
	LDA.w $7402,x
	BNE.b CODE_0CC6C3
	LDA.w $7722,x
	BMI.b CODE_0CC6C3
	REP.b #$10
	LDA.b $16,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #FXDATA_550000+$60C0
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #(FXDATA_550000+$60C0)>>16
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w #$0004
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	SEP.b #$10
	LDX.b #FXCODE_089A4B>>16
	LDA.w #FXCODE_089A4B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
CODE_0CC6C3:
	RTS

CODE_0CC6C4:
	LDA.w $7402,x
	BNE.b CODE_0CC6F2
	LDA.w $7722,x
	BMI.b CODE_0CC6F2
	REP.b #$10
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEP.b #$10
	LDX.b #FXCODE_089A29>>16
	LDA.w #FXCODE_089A29
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
CODE_0CC6F2:
	RTS

kamek_shoots_magic_noop_stub:                   ; reads $7D36,x then branches to the fall-through either way -- no effect (vestigial)
CODE_0CC6F3:
	LDY.w $7D36,x
	BPL.b CODE_0CC6F8
CODE_0CC6F8:
	RTS

kamek_shoots_magic_dodge_if_threatened:         ; forces the vanish path when Yoshi, or the nearest in-flight thrown object (GSU FXCODE_098F33), is inside a $40x$40 px box around Kamek
CODE_0CC6F9:
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCS.b CODE_0CC719
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCC.b CODE_0CC74E
CODE_0CC719:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098F33>>16
	LDA.w #FXCODE_098F33
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_0CC74D
	LDA.w $70E2,x
	SEC
	SBC.w $70E2,y
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCS.b CODE_0CC74D
	LDA.w $7182,x
	SEC
	SBC.w $7182,y
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCC.b CODE_0CC74E
CODE_0CC74D:
	RTS

CODE_0CC74E:
	LDA.w #!Define_YI_SoundID31_EnterPipe
	JSL.l CODE_push_sound_queue
	SEP.b #$20
	LDA.w $7041,x
	AND.b #$27
	STA.w $7041,x
	STZ.w $7402,x
	LDA.b $10
	AND.b #$01
	PHP
	JSL.l CODE_random_number_gen
	PLP
	BNE.b CODE_0CC77B
	LDA.b #$08
	STA.b $18,x
	REP.b #$20
	LDA.w #$0100
	STA.b $16,x
	BRA.b CODE_0CC793

CODE_0CC77B:
	LDA.b #$0A
	STA.b $18,x
	REP.b #$20
	LDA.w #$0001
	STA.b $76,x
	LDA.b $10
	AND.w #$003F
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	LDA.w #$003F
	STA.b $78,x
CODE_0CC793:
	PLA
	RTL

;---------------------------------------------------------------------------
; Sprite $1AD head-bop. Raiden: head_bop_kamek_magic.
;---------------------------------------------------------------------------
YI_NorSpr1AD_MagicShootingKamek_StompRt:
head_bop_kamek_magic:
;$0CC795
; note: bare RTL = $1AD is "immortal but physically present". Yoshi's
; head-bop on Magic-Shooting Kamek does nothing AND doesn't play a
; "denied" cue -- Yoshi simply passes through the sprite. The only
; YI enemy with this exact pattern; other immortals either block
; (Brick-Block) or aren't tangible. See docs/family-kamek.md.
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $1AE: magic projectile spawned by Kamek. Raiden: init_kamek_magic.
;---------------------------------------------------------------------------
YI_NorSpr1AE_MagicShot_Init:
init_kamek_magic:
;$0CC796
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $1AE main. Raiden: main_kamek_magic.
;---------------------------------------------------------------------------
YI_NorSpr1AE_MagicShot_Main:
main_kamek_magic:
;$0CC797
	JSL.l CODE_03AF23
	JSR.w CODE_0CC844
	JSR.w CODE_0CC8D4
	LDA.w $7A96,x
	BNE.b CODE_0CC7BB
	LDA.w $7402,x
	INC
	CMP.w #$000C
	BCC.b CODE_0CC7B2
	LDA.w #$0000
CODE_0CC7B2:
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7A96,x
CODE_0CC7BB:
	LDA.w $7A98,x
	BNE.b CODE_0CC7CD
	LDA.w #$0808
	JSL.l CODE_029BD9
	LDA.w #$0005
	STA.w $7A98,x
CODE_0CC7CD:
	LDY.b $16,x
	TYX
	JMP.w (DATA_kamek_magic_state_ptr,x)

DATA_0CC7D3:
DATA_kamek_magic_state_ptr:                     ; 2-entry magic-shot state ptr (travel / explode)
	dw CODE_0CC7D7
	dw CODE_0CC839

CODE_0CC7D7:
	LDX.b $12
	LDA.w #!Define_YI_SoundID04_SpitOut
	JSL.l CODE_push_sound_queue
	LDA.w $7AF8,x
	BNE.b CODE_0CC838
	LDA.w $611C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $611E
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7CD6,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0200
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $75E0,x
	BPL.b CODE_0CC81A
	EOR.w #$FFFF
	INC
CODE_0CC81A:
	LSR
	LSR
	LSR
	LSR
	STA.w $7540,x
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w $75E2,x
	BPL.b CODE_0CC82D
	EOR.w #$FFFF
	INC
CODE_0CC82D:
	LSR
	LSR
	LSR
	LSR
	STA.w $7542,x
	INC.b $16,x
	INC.b $16,x
CODE_0CC838:
	RTL

CODE_0CC839:
	LDX.b $12
	RTL

DATA_0CC83C:
	dw !Define_YI_NorSpr13E_FlyingFang
	dw !Define_YI_NorSpr108_Milde
	dw !Define_YI_NorSpr01E_Shyguy

CODE_0CC842:
	LDX.b #$01
CODE_0CC844:
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.l $700006,x
	CMP.w #$9D8B
	BEQ.b CODE_0CC858
	SEP.b #$10
	LDX.b $12
	RTS

CODE_0CC858:
	LDA.l $700000,x
	AND.w #$FFF0
	STA.b $00
	STA.w $0091
	LDA.l $700002,x
	AND.w #$FFF0
	STA.b $02
	STA.w $0093
	SEP.b #$10
	LDA.w #$0001
	STA.w $008F
	LDA.w #$0000
	STA.w $0095
	JSL.l CODE_change_map16
	LDA.w #!Define_YI_SoundID15_Growth
	JSL.l CODE_push_sound_queue
	LDX.b $12
	LDA.w #!Define_YI_AmbSpr1E6
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	STA.w $70A2,y
	LDA.b $02
	STA.w $7142,y
	LDA.w #$0006
	STA.w $73C2,y
	STA.w $7E4C,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.b $10
	AND.w #$0006
	TAY
	LDA.w DATA_0CC83C,y
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,y
	LDA.b $00
	STA.w $70E2,y
	LDA.b $02
	STA.w $7182,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	PLA
	RTL

CODE_0CC8D4:
	LDY.w $7D36,x
	BMI.b CODE_0CC8DA
	RTS

CODE_0CC8DA:
	JSL.l CODE_03A858
	PLA
	JML.l CODE_03A31E

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0A0: Tulip (egg-spit catcher / item dispenser). Raiden: init_tulip.
;---------------------------------------------------------------------------
YI_NorSpr0A0_Tulip_Init:
init_tulip:
;$0CC8E3
	JSL.l CODE_03D3F8
	BEQ.b CODE_0CC8ED
	JML.l CODE_03A31E

CODE_0CC8ED:
	STZ.w $7400,x
	JSL.l CODE_03AE8D
	LDA.w #$0100
	STA.b $18,x
	STA.w $7A36,x
	STA.w $7A38,x
	JSR.w CODE_0CCC22
	LDA.w #$0008
	STA.w $7B56,x
	JSL.l CODE_0CC969
	RTL

;---------------------------------------------------------------------------

DATA_0CC90D:
	dw $FD00,$FD80,$FC00,$FC80,$FD40,$FDC0,$FC40,$FCC0

;---------------------------------------------------------------------------
; Sprite $0A0 main. Raiden: main_tulip.
;---------------------------------------------------------------------------
YI_NorSpr0A0_Tulip_Main:
main_tulip:
;$0CC91D
	JSR.w CODE_0CCBD3
	JSL.l CODE_03AF23
	LDY.b $76,x
	TYX
	JMP.w (DATA_tulip_state_ptr,x)

DATA_0CC92A:
DATA_tulip_state_ptr:                           ; 7-entry Tulip state ptr (closed / open / catch / chew / spit / refuse / despawn)
	dw CODE_0CC938
	dw CODE_0CC98E
	dw CODE_0CC9B9
	dw CODE_0CCA44
	dw CODE_0CCAE3
	dw CODE_0CCB1E
	dw CODE_0CCB62

CODE_0CC938:
	LDX.b $12
	JSR.w CODE_0CCC22
	JSR.w CODE_0CCD43
	LDA.b $16,x
	CMP.w #$1FE0
	BCC.b CODE_0CC95B
	LDA.w #$1FE0
	STA.b $16,x
	LDA.w #$00A0
	STA.b $18,x
	SEP.b #$20
	INC.b $76,x
	INC.b $76,x
	REP.b #$20
	BRA.b CODE_0CC969

CODE_0CC95B:
	CLC
	ADC.w #$0055
	STA.b $16,x
	LDA.b $18,x
	SEC
	SBC.w #$0001
	STA.b $18,x
CODE_0CC969:
	LDA.b $16,x
	XBA
	AND.w #$00FF
	LSR
	LSR
	LSR
	STA.b $00
	CLC
	ADC.w #$0008
	STA.w $7B58,x
	LDA.w #$0008
	CLC
	ADC.b $00
	STA.w $7BB6,x
	LDA.w #$000A
	SEC
	SBC.b $00
	STA.w $7BB8,x
	RTL

CODE_0CC98E:
	LDX.b $12
	JSR.w CODE_0CCC22
	JSR.w CODE_0CCD43
	LDA.b $16,x
	BNE.b CODE_0CC9A9
	STZ.b $16,x
	LDA.w #$0100
	STA.b $18,x
	SEP.b #$20
	STZ.b $76,x
	REP.b #$20
	BRA.b CODE_0CC969

CODE_0CC9A9:
	SEC
	SBC.w #$0055
	STA.b $16,x
	LDA.b $18,x
	CLC
	ADC.w #$0001
	STA.b $18,x
	BRA.b CODE_0CC969

CODE_0CC9B9:
	LDX.b $12
	JSR.w CODE_0CCC22
	JSR.w CODE_0CCE17
	LDA.b $16,x
	BNE.b CODE_0CCA12
	STZ.b $16,x
	LDA.w #$0100
	STA.b $18,x
	LDA.w #$0010
	STA.w $7B58,x
	LDA.w #$0008
	STA.w $7BB6,x
	LDA.w #$0006
	STA.w $7BB8,x
	LDA.w !RAM_YI_Level_StarTimerLo
	BEQ.b CODE_0CC9F6
	STA.w !REGISTER_DividendLo
	LDY.b #$0A
	STY.w !REGISTER_Divisor
	NOP #8
	LDA.w !REGISTER_QuotientLo
CODE_0CC9F6:
	SEP.b #$20
	STA.b $00
	LDA.b #$1E
	SEC
	SBC.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	LDA.b #$08
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	INC.b $76,x
	INC.b $76,x
	REP.b #$20
	JSL.l CODE_03D3EB
	RTL

CODE_0CCA12:
	SEC
	SBC.w #$0100
	BPL.b CODE_0CCA1B
	LDA.w #$0000
CODE_0CCA1B:
	STA.b $16,x
	LDA.b $18,x
	CLC
	ADC.w #$0003
	CMP.w #$0100
	BCC.b CODE_0CCA2B
	LDA.w #$0100
CODE_0CCA2B:
	STA.b $18,x
	JMP.w CODE_0CC969

CODE_0CCA30:
	CLC
	ADC.w #$0002
	STA.w $7A36,x
	LDA.w $7A38,x
	SEC
	SBC.w #$0008
	STA.w $7A38,x
	STA.b $18,x
	RTL

CODE_0CCA44:
	LDX.b $12
	JSR.w CODE_0CCCAA
	JSR.w CODE_0CCE17
	LDA.w $7A36,x
	CMP.w #$0120
	BCC.b CODE_0CCA30
	LDA.w #$0120
	STA.w $7A36,x
	LDA.w #$0080
	STA.w $7A38,x
	STA.b $18,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	BEQ.b CODE_0CCA69
	BPL.b CODE_0CCA7D
CODE_0CCA69:
	LDA.w #$0100
	STA.b $00
	LDA.w #$0140
	STA.b $02
	LDA.w #$0010
	STA.b $04
	LDA.w #$0115
	BRA.b CODE_0CCA89

CODE_0CCA7D:
	LDA.w #$0180
	STA.b $00
	STZ.b $02
	STZ.b $04
	LDA.w #$01A2
CODE_0CCA89:
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0CCACD
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,y
	LDA.b $10
	AND.w #$000E
	TAX
	LDA.l DATA_pop_x_speeds,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $10
	LSR
	LSR
	LSR
	LSR
	AND.w #$000E
	TAX
	LDA.w DATA_0CC90D,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDX.b $12
	LDA.b $00
	STA.w $7A96,y
	LDA.b $02
	STA.w $7A98,y
	LDA.b $04
	STA.w $7AF6,y
CODE_0CCACD:
	LDA.w #!Define_YI_SoundID6E_FlyGuyGettingAway
	JSL.l CODE_push_sound_queue
	SEP.b #$20
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	INC.b $76,x
	INC.b $76,x
	REP.b #$20
	RTL

CODE_0CCAE3:
	LDX.b $12
	JSR.w CODE_0CCCAA
	JSR.w CODE_0CCE17
	LDA.w $7A36,x
	CMP.w #$00F1
	BCS.b CODE_0CCB0A
	LDA.w #$00F0
	STA.w $7A36,x
	LDA.w #$0100
	STA.w $7A38,x
	STA.b $18,x
	SEP.b #$20
	INC.b $76,x
	INC.b $76,x
	REP.b #$20
	RTL

CODE_0CCB0A:
	SEC
	SBC.w #$000C
	STA.w $7A36,x
	LDA.w $7A38,x
	CLC
	ADC.w #$0020
	STA.w $7A38,x
	STA.b $18,x
	RTL

CODE_0CCB1E:
	LDX.b $12
	JSR.w CODE_0CCCAA
	JSR.w CODE_0CCE17
	LDA.w $7A36,x
	CMP.w #$0100
	BCC.b CODE_0CCB5A
	LDA.w #$0100
	STA.w $7A36,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_0CCB4E
	LDA.w #$0080
	STA.w $7A96,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEP.b #$20
	INC.b $76,x
	INC.b $76,x
	REP.b #$20
	RTL

CODE_0CCB4E:
	SEP.b #$20
	LDA.b $76,x
	SEC
	SBC.b #$04
	STA.b $76,x
	REP.b #$20
	RTL

CODE_0CCB5A:
	CLC
	ADC.w #$0001
	STA.w $7A36,x
	RTL

CODE_0CCB62:
	LDX.b $12
	JSR.w CODE_0CCCAA
	LDA.w $7A96,x
	BEQ.b CODE_0CCBA9
	LDY.w $74A2,x
	CPY.b #$FF
	BNE.b CODE_0CCB7B
	LDA.w #$0001
	STA.w $74A2,x
	BRA.b CODE_0CCBA8

CODE_0CCB7B:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BIT.w #$FF00
	BEQ.b CODE_0CCB96
	AND.w #$00FF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$00FF
	STA.w $74A2,x
CODE_0CCB96:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0004
	CMP.w #$0100
	BMI.b CODE_0CCBA5
	LDA.w #$0100
CODE_0CCBA5:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_0CCBA8:
	RTL

CODE_0CCBA9:
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
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	JML.l CODE_despawn_sprite_free_slot

CODE_0CCBD3:
	LDY.w $74A2,x
	CPY.b #$FF
	BNE.b CODE_0CCBDD
CODE_0CCBDA:
	SEP.b #$10
	RTS

CODE_0CCBDD:
	REP.b #$10
	LDY.w $7362,x
	BMI.b CODE_0CCBDA
	LDA.w $7722,x
	BMI.b CODE_0CCBDA
	TAX
	LDA.l DATA_03AA0E,x
	STA.w $6000
	LDA.l DATA_03AA0E+$02,x
	STA.w $6002
	LDA.l DATA_03AA0E+$04,x
	STA.w $6004
	LDA.l DATA_03AA0E+$06,x
	STA.w $6006
	LDA.l DATA_03AA0E+$08,x
	STA.w $6008
	LDA.l DATA_03AA0E+$0C,x
	STA.w $600A
	SEP.b #$10
	LDX.b #FXCODE_089AC6>>16
	LDA.w #FXCODE_089AC6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	RTS

CODE_0CCC22:
	REP.b #$10
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$001F
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #FXDATA_550000+$0031
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$0031)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	CLC
	ADC.w #$0020
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEP.b #$10
	LDX.b #FXCODE_088C15>>16
	LDA.w #FXCODE_088C15
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	REP.b #$10
	LDA.b $16,x
	XBA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #FXDATA_550000+$0061
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$0061)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEP.b #$10
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	RTS

CODE_0CCCAA:
	REP.b #$10
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$001F
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #FXDATA_550000+$0031
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$0031)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	CLC
	ADC.w #$0020
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEP.b #$10
	LDX.b #FXCODE_088C15>>16
	LDA.w #FXCODE_088C15
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	REP.b #$10
	LDA.w #$0018
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$001F
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #FXDATA_550000+$0061
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$0061)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEP.b #$10
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
CODE_0CCD3A:
	RTS

DATA_0CCD3B:
	dw $FF00,$0100

DATA_0CCD3F:
	dw $FF00,$0100

CODE_0CCD43:
	LDY.w $7D36,x
	BMI.b CODE_0CCD3A
	PHX
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_0CCD3A
	BEQ.b CODE_0CCD3A
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CCD3A
	LDA.w $7D38,y
	BEQ.b CODE_0CCD3A
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	BMI.b CODE_0CCDCE
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	CLC
	ADC.w #$000E
	CMP.w #$001C
	BCS.b CODE_0CCDCE
	LDA.w $7BB8,x
	INC
	LSR
	STA.b $00
	CLC
	ADC.w $7BB8,y
	STA.b $02
	LDA.w $7CD8,x
	SEC
	SBC.b $00
	SEC
	SBC.w $7CD8,y
	BPL.b CODE_0CCD9D
	EOR.w #$FFFF
	INC
CODE_0CCD9D:
	CMP.b $02
	BEQ.b CODE_0CCDA3
	BPL.b CODE_0CCDCE
CODE_0CCDA3:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TYX
	JSL.l CODE_despawn_sprite_free_slot
	LDX.b $12
	LDA.w #!Define_YI_SoundID14_Gulp
	JSL.l CODE_push_sound_queue
	SEP.b #$20
	LDA.w $7040,x
	AND.b #$F3
	STA.w $7040,x
	LDA.b #$04
	STA.b $76,x
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	PLA
	RTL

CODE_0CCDCE:
	LDA.w #DATA_0CCD3B
	STA.b $00
	LDA.w #DATA_0CCD3F
	STA.b $02
	LDA.w $70E2,x
	SEC
	SBC.w $70E2,y
	BPL.b CODE_0CCDE5
	INC.b $00
	INC.b $00
CODE_0CCDE5:
	LDA.w $7182,x
	SEC
	SBC.w $7182,y
	BPL.b CODE_0CCDF2
	INC.b $02
	INC.b $02
CODE_0CCDF2:
	LDA.b ($00)
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b ($02)
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_0CCE0F
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BCS.b CODE_0CCE0F
	LDA.w #$0040
	STA.w $7542,y
CODE_0CCE0F:
	LDA.w #!Define_YI_SoundID49_Jump
	JSL.l CODE_push_sound_queue
CODE_0CCE16:
	RTS

CODE_0CCE17:
	LDY.w $7D36,x
	BMI.b CODE_0CCE16
	PHX
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_0CCE16
	BEQ.b CODE_0CCE16
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CCE16
	LDA.w $7D38,y
	BEQ.b CODE_0CCE16
	BRA.b CODE_0CCDCE

;---------------------------------------------------------------------------

DATA_0CCE41:
	dw $FF00,$0100

DATA_0CCE45:
	dw $000E,$000C

DATA_0CCE49:
	dw $0061,$04A1

;---------------------------------------------------------------------------
; Sprite $0DF: Piscatory Pete (jumping fish). Raiden: init_piscatory_pete.
;---------------------------------------------------------------------------
YI_NorSpr0DF_PiscatoryPete_Init:
init_piscatory_pete:
;$0CCE4D
	LDY.w $7400,x
	LDA.w DATA_0CCE41,y
	STA.w $75E0,x
	LDA.w #$0004
	STA.w $7540,x
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	STA.b $16,x
	TAY
	LDA.w $7042,x
	ORA.w DATA_0CCE45,y
	STA.w $7042,x
	LDA.w DATA_0CCE49,y
	STA.w $6FA2,x
	SEP.b #$20
	LDA.b #$FF
	STA.b $78,x
	STA.w $7863,x
	REP.b #$20
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0DF main. Raiden: main_piscatory_pete.
;---------------------------------------------------------------------------
YI_NorSpr0DF_PiscatoryPete_Main:
main_piscatory_pete:
;$0CCE83
	JSL.l CODE_03AF23
	JSL.l CODE_0CD017
	JSL.l CODE_0CD053
	JSR.w CODE_0CD00D
	LDY.b $16,x
	TYX
	JMP.w (DATA_piscatory_pete_state_ptr,x)

DATA_0CCE98:
DATA_piscatory_pete_state_ptr:                  ; 2-entry Piscatory Pete state ptr (fixed-direction-leap / homing-leap variant dispatch)
	dw CODE_0CCE9C
	dw CODE_0CCEA8

CODE_0CCE9C:
	LDX.b $12
	LDY.b $18,x
	TYX
	JMP.w (DATA_piscatory_pete_left_substate_ptr,x)

DATA_0CCEA4:
DATA_piscatory_pete_left_substate_ptr:          ; 2-entry left-variant sub-state ptr (underwater / arc)
	dw CODE_0CCEB4
	dw CODE_0CCFB2

CODE_0CCEA8:
	LDX.b $12
	LDY.b $18,x
	TYX
	JMP.w (DATA_piscatory_pete_right_substate_ptr,x)

DATA_0CCEB0:
DATA_piscatory_pete_right_substate_ptr:         ; 2-entry right-variant sub-state ptr (underwater / arc)
	dw CODE_0CCEB4
	dw CODE_0CCF13

CODE_0CCEB4:
	LDX.b $12
	LDA.w $7540,x
	BEQ.b CODE_0CCECF
	ASL
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w $75E0,x
	CLC
	ADC.w $7540,x
	CMP.b $00
	BEQ.b CODE_0CCECF
	BCS.b CODE_0CCEFC
CODE_0CCECF:
	LDA.w $7542,x
	BEQ.b CODE_0CCEE8
	ASL
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w $75E2,x
	CLC
	ADC.w $7542,x
	CMP.b $00
	BEQ.b CODE_0CCEE8
	BCS.b CODE_0CCEFC
CODE_0CCEE8:
	STZ.w $75E0,x
	STZ.w $75E2,x
	SEP.b #$20
	LDA.b #$01
	STA.w $7402,x
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
	RTL

CODE_0CCEFC:
	LDA.w $7A96,x
	BNE.b CODE_0CCF12
	SEP.b #$20
	LDA.b #$04
	STA.w $7A96,x
	LDA.w $7402,x
	EOR.b #$01
	STA.w $7402,x
	REP.b #$20
CODE_0CCF12:
	RTL

CODE_0CCF13:
	LDX.b $12
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	LDA.w $7540,x
	BEQ.b CODE_0CCF37
	ASL
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w $75E0,x
	CLC
	ADC.w $7540,x
	CMP.b $00
	BEQ.b CODE_0CCF37
	BCS.b CODE_0CCF50
CODE_0CCF37:
	LDA.w $7542,x
	BEQ.b CODE_0CCF53
	ASL
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w $75E2,x
	CLC
	ADC.w $7542,x
	CMP.b $00
	BEQ.b CODE_0CCF53
	BCC.b CODE_0CCF53
CODE_0CCF50:
	JMP.w CODE_0CCFD7

CODE_0CCF53:
	LDA.w $611C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $611E
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7CD6,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0200
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $75E0,x
	BPL.b CODE_0CCF88
	EOR.w #$FFFF
	INC
CODE_0CCF88:
	LSR
	LSR
	LSR
	LSR
	LSR
	LSR
	STA.w $7540,x
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w $75E2,x
	BPL.b CODE_0CCF9D
	EOR.w #$FFFF
	INC
CODE_0CCF9D:
	LSR
	LSR
	LSR
	LSR
	LSR
	LSR
	STA.w $7542,x
	SEP.b #$20
	STZ.w $7402,x
	DEC.b $18,x
	DEC.b $18,x
	REP.b #$20
	RTL

CODE_0CCFB2:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_0CCFC2
	LDA.w $7400,x
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0CCFD7
CODE_0CCFC2:
	LDY.w $7400,x
	LDA.w DATA_0CCE41,y
	STA.w $75E0,x
	SEP.b #$20
	STZ.w $7402,x
	DEC.b $18,x
	DEC.b $18,x
	REP.b #$20
	RTL

CODE_0CCFD7:
	LDY.b $19,x
	BNE.b CODE_0CCFF7
	LDA.w $7A96,x
	BNE.b CODE_0CCFF6
	SEP.b #$20
	LDA.b $10
	AND.b #$1F
	BNE.b CODE_0CCFF4
	LDA.b #$08
	STA.w $7A96,x
	LDA.b #$02
	STA.w $7402,x
	INC.b $19,x
CODE_0CCFF4:
	REP.b #$20
CODE_0CCFF6:
	RTL

CODE_0CCFF7:
	LDA.w $7A96,x
	BNE.b CODE_0CD00C
	SEP.b #$20
	LDA.b #$01
	STA.w $7402,x
	LDA.b #$08
	STA.w $7A96,x
	STZ.b $19,x
	REP.b #$20
CODE_0CD00C:
	RTL

CODE_0CD00D:
	LDY.w $7D36,x
	BPL.b CODE_0CD016
	JSL.l CODE_03A858
CODE_0CD016:
	RTS

CODE_0CD017:
	LDY.w $7862,x
	BNE.b CODE_0CD031
	SEP.b #$20
	STZ.b $78,x
	REP.b #$20
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	PLY
	PLA
	RTL

CODE_0CD031:
	LDY.b $78,x
	BNE.b CODE_0CD052
CODE_0CD035:
	STZ.w $75E0,x
	STZ.w $75E2,x
	LDA.w #$0004
	STA.w $7542,x
	SEP.b #$20
	LDA.b #$01
	STA.w $7402,x
	LDA.b #$02
	STA.b $18,x
	DEC.b $78,x
	REP.b #$20
	PLY
	PLA
CODE_0CD052:
	RTL

CODE_0CD053:
	LDA.b $16,x
	BEQ.b CODE_0CD05F
	LDA.w $7860,x
	BIT.w #$000F
	BNE.b CODE_0CD035
CODE_0CD05F:
	RTL

;---------------------------------------------------------------------------

DATA_0CD060:
	db $02,$02,$05,$05

;---------------------------------------------------------------------------
; Sprite $0E0: Preying Mantas (manta ray). Raiden: init_preying_mantas.
;---------------------------------------------------------------------------
YI_NorSpr0E0_PreyingMantas_Init:
init_preying_mantas:
;$0CD064
	LDA.w #$FF00
	STA.w $75E2,x
	LDA.w #$0010
	STA.w $7542,x
	LDA.w $7182,x
	STA.b $18,x
	LDA.w #$0003
	STA.w $7402,x
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	TAY
	LDA.w DATA_0CD060,y
	STA.b $76,x
	RTL

;---------------------------------------------------------------------------

DATA_0CD08B:
	dw $0008,$0004,$0004,$0008

;---------------------------------------------------------------------------
; Sprite $0E0 main. Raiden: main_preying_mantas.
;---------------------------------------------------------------------------
YI_NorSpr0E0_PreyingMantas_Main:
main_preying_mantas:
;$0CD093
	JSL.l CODE_03AF23
	JSR.w CODE_0CD00D
	LDY.b $16,x
	TYX
	JSR.w (DATA_preying_mantas_state_ptr,x)
	RTL

DATA_0CD0A1:
DATA_preying_mantas_state_ptr:                  ; 2-entry Preying Mantas state ptr (cruise / surge)
	dw CODE_0CD0A5
	dw CODE_0CD106

CODE_0CD0A5:
	LDX.b $12
	LDA.w $75E2,x
	BEQ.b CODE_0CD0CD
	LDA.w $7A96,x
	BNE.b CODE_0CD105
	DEC.w $7402,x
	BMI.b CODE_0CD0C4
	SEP.b #$20
	LDY.w $7402,x
	LDA.w DATA_0CD08B,y
	STA.w $7A96,x
	REP.b #$20
	RTS

CODE_0CD0C4:
	LDA.w #$0003
	STA.w $7402,x
	STZ.w $75E2,x
CODE_0CD0CD:
	LDA.w $7542,x
	ASL
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w $75E2,x
	CLC
	ADC.w $7542,x
	CMP.b $00
	BCS.b CODE_0CD105
	LDY.b $77,x
	BNE.b CODE_0CD0F9
	LDA.w #$0080
	STA.w $75E2,x
	SEP.b #$20
	LDA.b $76,x
	STA.b $77,x
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
	RTS

CODE_0CD0F9:
	LDA.w #$FF00
	STA.w $75E2,x
	SEP.b #$20
	DEC.b $77,x
	REP.b #$20
CODE_0CD105:
	RTS

CODE_0CD106:
	LDX.b $12
	LDA.b $18,x
	CMP.w $7182,x
	BPL.b CODE_0CD11D
	STA.w $7182,x
	LDA.w #$FF00
	STA.w $75E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.b $16,x
CODE_0CD11D:
	RTS

;---------------------------------------------------------------------------

DATA_0CD11E:
	dw $0000,$0100

;---------------------------------------------------------------------------
; Sprite $0E1: Loch Nestor. Raiden: init_loch_nestor.
;---------------------------------------------------------------------------
YI_NorSpr0E1_LochNestor_Init:
init_loch_nestor:
;$0CD122
	LDA.w #$00A0
	STA.b $16,x
	LDA.w $70E2,x
	STA.w $7A36,x
	LDA.w $7182,x
	STA.w $7A38,x
	LDY.w $7400,x
	LDA.w DATA_0CD11E,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	JSL.l CODE_03AE60
	SEP.b #$20
	LDA.b #$FF
	STA.w $7863,x
	REP.b #$20
	RTL

;---------------------------------------------------------------------------

DATA_0CD14A:
	dl FXDATA_548000+$40A0
	dl FXDATA_548000+$40C0

DATA_0CD150:
	db $F5,$FE,$F6,$F6

;---------------------------------------------------------------------------
; Sprite $0E1 main. Raiden: main_loch_nestor.
;---------------------------------------------------------------------------
YI_NorSpr0E1_LochNestor_Main:
main_loch_nestor:
;$0CD154
	LDY.w $74A2,x
	BMI.b CODE_0CD18E
	LDA.w $7402,x
	CMP.w #$0002
	BCC.b CODE_0CD18E
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0010
	TAY
	JSL.l CODE_03AA60
	SEP.b #$10
	LDA.w #DATA_0CD150>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_0CD150
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #$0002
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_089B64>>16
	LDA.w #FXCODE_089B64
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_0CD18E:
	JSL.l CODE_03AF23
	JSR.w CODE_0CD3DC
	LDA.w $7A96,x
	BNE.b CODE_0CD1A9
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
CODE_0CD1A9:
	JSR.w CODE_0CD435
	LDA.w $6FA0,x
	BIT.w #$0020
	BEQ.b CODE_0CD1BA
	LDY.b $18,x
	TYX
	JMP.w (DATA_loch_nestor_emerge_substate_ptr,x)

CODE_0CD1BA:
	LDY.b $18,x
	BEQ.b CODE_0CD1D5
	LDA.w $7A98,x
	BNE.b CODE_0CD1D5
	SEP.b #$20
	LDA.w $6FA0,x
	ORA.b #$20
	STA.w $6FA0,x
	STZ.b $18,x
	LDA.b #$04
	STA.b $19,x
	REP.b #$20
CODE_0CD1D5:
	LDY.b $19,x
	TYX
	JMP.w (DATA_loch_nestor_underwater_substate_ptr,x)

DATA_0CD1DB:
DATA_loch_nestor_emerge_substate_ptr:           ; 6-entry Loch Nestor emerge sub-state ptr (used when fully surfaced)
	dw CODE_0CD347
	dw CODE_0CD36E
	dw CODE_0CD387
	dw CODE_0CD3AB
	dw CODE_0CD3B6
	dw CODE_0CD3BD

DATA_0CD1E7:
DATA_loch_nestor_underwater_substate_ptr:       ; 3-entry Loch Nestor underwater sub-state ptr (drift / approach / dive)
	dw CODE_0CD1ED
	dw CODE_0CD228
	dw CODE_0CD287

CODE_0CD1ED:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC
	AND.w #$01FF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	AND.w #$01FE
	REP.b #$10
	TXY
	TAX
	LDA.l DATA_sine_lut_8bit_radians,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CLC
	ADC.w $7A36,y
	STA.w $70E2,y
	LDA.l DATA_cosine_lut_8bit_radians,x
	AND.w #$8000
	ASL
	ROL
	ASL
	STA.w $7400,y
	TYX
	SEP.b #$10
	RTL

CODE_0CD228:
	LDX.b $12
	JSL.l CODE_0CD4AF
	LDA.w $611C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $611E
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7CD6,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0080
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $75E0,x
	BPL.b CODE_0CD263
	EOR.w #$FFFF
	INC
CODE_0CD263:
	LSR
	LSR
	LSR
	LSR
	STA.w $7540,x
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w $75E2,x
	BPL.b CODE_0CD276
	EOR.w #$FFFF
	INC
CODE_0CD276:
	LSR
	LSR
	LSR
	LSR
	STA.w $7542,x
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	RTL

CODE_0CD287:
	LDX.b $12
	JSL.l CODE_0CD4AF
	LDY.b #$00
	LDA.w $70E2,x
	CMP.w $7A36,x
	BPL.b CODE_0CD299
	INY
	INY
CODE_0CD299:
	TYA
	STA.w $7400,x
	STZ.b $00
	LDA.w $70E2,x
	SEC
	SBC.w $7A36,x
	CLC
	ADC.w #$0001
	CMP.w #$0002
	BCS.b CODE_0CD2BD
	LDA.w $7A36,x
	STA.w $70E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	INC.b $00
CODE_0CD2BD:
	LDA.w $7182,x
	SEC
	SBC.w $7A38,x
	CLC
	ADC.w #$0001
	CMP.w #$0002
	BCS.b CODE_0CD2F5
	LDA.w $7A38,x
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.b $00
	BEQ.b CODE_0CD2F5
	LDY.w $7400,x
	LDA.w DATA_0CD11E,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.w $6FA2,x
	AND.b #$E0
	STA.w $6FA2,x
	STZ.b $19,x
	REP.b #$20
	RTL

CODE_0CD2F5:
	LDX.b $12
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0080
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $75E0,x
	BPL.b CODE_0CD32C
	EOR.w #$FFFF
	INC
CODE_0CD32C:
	LSR
	LSR
	LSR
	LSR
	STA.w $7540,x
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w $75E2,x
	BPL.b CODE_0CD33F
	EOR.w #$FFFF
	INC
CODE_0CD33F:
	LSR
	LSR
	LSR
	LSR
	STA.w $7542,x
	RTL

CODE_0CD347:
	LDX.b $12
	LDA.w #$00A0
	CMP.b $16,x
	BCC.b CODE_0CD365
	STA.b $16,x
	LDA.w $6FA0,x
	AND.w #$FFDF
	STA.w $6FA0,x
	LDA.w $7402,x
	AND.w #$0001
	STA.w $7402,x
	RTL

CODE_0CD365:
	LDA.b $16,x
	SEC
	SBC.w #$0002
	STA.b $16,x
	RTL

CODE_0CD36E:
	LDX.b $12
	LDA.b $16,x
	CMP.w #$00EC
	BCC.b CODE_0CD380
CODE_0CD377:
	SEP.b #$20
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
	RTL

CODE_0CD380:
	CLC
	ADC.w #$0002
	STA.b $16,x
	RTL

CODE_0CD387:
	LDX.b $12
	LDA.w #$00CC
CODE_0CD38C:
	CMP.b $16,x
	BCC.b CODE_0CD3A2
	STA.b $16,x
	LDA.w $6FA0,x
	AND.w #$FFDF
	STA.w $6FA0,x
	LDA.w #$0140
	STA.w $7A98,x
	RTL

CODE_0CD3A2:
	LDA.b $16,x
	SEC
	SBC.w #$0001
	STA.b $16,x
	RTL

CODE_0CD3AB:
	LDX.b $12
	LDA.b $16,x
	CMP.w #$0120
	BCC.b CODE_0CD380
	BRA.b CODE_0CD377

CODE_0CD3B6:
	LDX.b $12
	LDA.w #$0100
	BRA.b CODE_0CD38C

CODE_0CD3BD:
	LDX.b $12
	LDA.b $16,x
	CMP.w #$0133
	BCS.b CODE_0CD3CD
	CLC
	ADC.w #$0001
	STA.b $16,x
	RTL

CODE_0CD3CD:
	JSL.l CODE_04849E
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	JML.l CODE_03A31E

CODE_0CD3DC:
	LDA.w $7402,x
	CMP.w #$0002
	BCC.b CODE_0CD434
	LDA.w $7722,x
	BMI.b CODE_0CD434
	REP.b #$10
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $16,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7402,x
	AND.w #$0001
	STA.b $00
	ASL
	CLC
	ADC.b $00
	TAY
	LDA.w DATA_0CD14A,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w DATA_0CD14A+$02,y
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEP.b #$10
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
CODE_0CD434:
	RTS

CODE_0CD435:
	LDA.w $6FA0,x
	BIT.w #$0020
	BNE.b CODE_0CD434
	LDY.w $7D36,x
	BMI.b CODE_0CD4AA
	DEY
	BMI.b CODE_0CD434
	BEQ.b CODE_0CD434
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CD434
	LDA.w $7D38,y
	BEQ.b CODE_0CD45D
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	BRA.b CODE_0CD46C

CODE_0CD45D:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr015_SubmarineTorpedo
	BNE.b CODE_0CD434
	TYX
	JSL.l CODE_0481A1
	LDX.b $12
CODE_0CD46C:
	LDA.w #!Define_YI_SoundID20_SoaringEgg
	JSL.l CODE_push_sound_queue
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w $7542,x
	SEP.b #$20
	LDA.w $7402,x
	ORA.b #$02
	STA.w $7402,x
	LDA.b #$10
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w $6FA0,x
	ORA.b #$20
	STA.w $6FA0,x
	LDA.w $6FA2,x
	ORA.b #$01
	STA.w $6FA2,x
	INC.b $18,x
	INC.b $18,x
	LDA.b #$02
	STA.b $19,x
	REP.b #$20
	PLA
	RTL

CODE_0CD4AA:
	JSL.l CODE_03A858
	RTS

CODE_0CD4AF:
	LDY.w $7862,x
	BNE.b CODE_0CD4C2
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	PLY
	PLA
CODE_0CD4C2:
	RTL

;---------------------------------------------------------------------------

DATA_0CD4C3:
	dw $0001,$0002,$0004,$0008,$0010,$0020,$0040

DATA_0CD4D1:
	dw $FFFE,$FFFD,$FFFB,$FFF7,$FFEF,$FFDF,$FFBF

DATA_0CD4DF:
	dw $0000,$0400,$0800,$0C00,$1000,$1400,$1800

DATA_0CD4ED:
	dw $FFFF,$FFE0

DATA_0CD4F1:
	dw $2005,$0804

;---------------------------------------------------------------------------
; Sprite $071: Big Boo. Raiden: init_boo (label is a bit terse).
;---------------------------------------------------------------------------
YI_NorSpr071_BigBoo_Init:
init_big_boo:
;$0CD4F5
	SEP.b #$20
	LDA.w $70E2,x
	AND.b #$10
	LSR
	LSR
	LSR
	STA.b $76,x
	REP.b #$20
	BNE.b CODE_0CD525
	TXY
	LDX.b #$0C
	LDA.w $0CC4
CODE_0CD50B:
	BIT.w DATA_0CD4C3,x
	BEQ.b CODE_0CD519
	DEX
	DEX
	BPL.b CODE_0CD50B
	TYX
	JML.l CODE_03A31E

CODE_0CD519:
	SEP.b #$20
	TXA
	TYX
	STA.b $18,x
	REP.b #$20
	JSR.w CODE_0CD6A2
	RTL

CODE_0CD525:
	LDA.w $7182,x
	AND.w #$0010
	LSR
	LSR
	LSR
	TAY
	LDA.w $6FA0,x
	AND.w DATA_0CD4ED,y
	STA.w $6FA0,x
	LDA.w $7040,x
	AND.w #$07F0
	ORA.w DATA_0CD4F1,y
	STA.w $7040,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $071 main. Raiden: main_boo.
;---------------------------------------------------------------------------
YI_NorSpr071_BigBoo_Main:
main_big_boo:
;$0CD545
	LDY.b $76,x
	TYX
	JMP.w (DATA_big_boo_state_ptr,x)

DATA_0CD54B:
DATA_big_boo_state_ptr:                         ; 2-entry Big Boo state ptr (active / despawn)
	dw CODE_0CD54F
	dw CODE_0CD926

CODE_0CD54F:
	LDX.b $12
	JSR.w CODE_0CD6CE
	JSL.l CODE_03AF23
	JSL.l CODE_0CD8FC
	JSR.w CODE_0CD6A2
	JSL.l CODE_0CD77C
	LDY.b $77,x
	TYX
	JMP.w (DATA_big_boo_facing_substate_ptr,x)

DATA_0CD569:
DATA_big_boo_facing_substate_ptr:               ; 3-entry Big Boo facing-Yoshi sub-state ptr (advance / cover / pause)
	dw CODE_0CD5FD
	dw CODE_0CD56F
	dw CODE_0CD5CE

CODE_0CD56F:
	LDX.b $12
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BNE.b CODE_0CD5BB
	CMP.w $60C4
	BNE.b CODE_0CD5BB
	LDA.w $7A96,x
	BNE.b CODE_0CD59C
	LDA.w #$0010
	STA.w $7A96,x
	LDA.w #$0001
	STA.w $7402,x
	LDA.b $10
	AND.w #$003F
	BNE.b CODE_0CD59C
	STZ.w $7402,x
CODE_0CD59C:
	SEP.b #$20
	LDA.b #$01
	LDY.w $7A98,x
	BNE.b CODE_0CD5B8
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	LDY.w $7AF6,x
	BNE.b CODE_0CD5B8
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D9|!EXRAMBankMirror,x
	LDY.w $7AF8,x
	BNE.b CODE_0CD5B8
	STA.w $7A36,x
CODE_0CD5B8:
	REP.b #$20
	RTL

CODE_0CD5BB:
	SEP.b #$20
	LDA.b #$01
	STA.w $7402,x
	LDA.b #$10
	STA.w $77C0,x
	INC.b $77,x
	INC.b $77,x
	REP.b #$20
	RTL

CODE_0CD5CE:
	LDX.b $12
	LDY.w $77C0,x
	BEQ.b CODE_0CD5DD
	SEP.b #$20
	DEC.w $77C0,x
	REP.b #$20
	RTL

CODE_0CD5DD:
	SEP.b #$20
	LDA.b #$01
	STA.w $7402,x
	LDA.b #$04
	STA.w $7A96,x
	LDA.b #$08
	STA.w $7A98,x
	LDA.b #$0C
	STA.w $7AF6,x
	LDA.b #$10
	STA.w $7AF8,x
	STZ.b $77,x
	REP.b #$20
	RTL

CODE_0CD5FD:
	LDX.b $12
	JSR.w CODE_0CD803
	LDA.w $7A96,x
	BNE.b CODE_0CD659
	STZ.w $7402,x
	SEP.b #$20
	LDA.w $7A98,x
	BNE.b CODE_0CD622
	STZ.b $78,x
	LDA.w $7AF6,x
	BNE.b CODE_0CD622
	STZ.b $79,x
	LDA.w $7AF8,x
	BNE.b CODE_0CD622
	STZ.w $7A36,x
CODE_0CD622:
	REP.b #$20
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BNE.b CODE_0CD65A
	CMP.w $60C4
	BNE.b CODE_0CD65A
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$08
	STA.w $7A96,x
	LDA.b #$10
	STA.w $7A98,x
	LDA.b #$18
	STA.w $7AF6,x
	LDA.b #$20
	STA.w $7AF8,x
	STZ.w $7402,x
	INC.b $77,x
	INC.b $77,x
	REP.b #$20
CODE_0CD659:
	RTL

CODE_0CD65A:
	STA.w $7400,x
	LDA.w $611C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $611E
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7CD6,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0080
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.b $16,x
	CMP.w #$0100
	BCS.b CODE_0CD69B
	INC.b $16,x
CODE_0CD69B:
	SEP.b #$20
	INC.b $19,x
	REP.b #$20
	RTL

CODE_0CD6A2:
	TXY
	LDX.b $18,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701979|!EXRAMBankMirror,y
	AND.w #$00FF
	ASL
	ASL
	CLC
	ADC.w DATA_0CD4DF,x
	REP.b #$10
	TAX
	LDA.w $70E2,y
	STA.l $7E5DA6,x
	LDA.w $7182,y
	STA.l $7E5DA8,x
	SEP.b #$10
	TYX
CODE_0CD6C5:
	RTS

DATA_0CD6C6:
	dw $0090,$0060,$0030

DATA_0CD6CC:
	db $26,$2E

CODE_0CD6CE:
	LDY.w $74A2,x
	BMI.b CODE_0CD6C5
	LDY.b $18,x
	LDA.w #$7E5DA6
	CLC
	ADC.w DATA_0CD4DF,y
	STA.b $00
	LDY.b #$7E5DA6>>16
	STY.b $02
	SEP.b #$20
	LDY.b $78,x
	LDA.w DATA_0CD6CC,y
	STA.b $0E
	STZ.b $0F
	LDY.b $79,x
	LDA.w DATA_0CD6CC,y
	STA.b $0C
	STZ.b $0D
	LDY.w $7A36,x
	LDA.w DATA_0CD6CC,y
	STA.b $0A
	STZ.b $0B
	REP.b #$20
	LDA.w $7180,x
	AND.w #$00FF
	ASL
	ASL
	ASL
	STA.b $08
	LDY.b #$04
CODE_0CD70F:
	LDA.b $08
	CLC
	ADC.w $796A,y
	STA.w $796A,y
	DEY
	DEY
	BPL.b CODE_0CD70F
	REP.b #$10
	LDA.w $7362,x
	STA.b $06
	LDA.w #$0004
	STA.b $04
CODE_0CD728:
	LDY.b $04
	LDA.b $16,x
	CMP.w DATA_0CD6C6,y
	BCS.b CODE_0CD736
	LDY.w #$0000
	BRA.b CODE_0CD745

CODE_0CD736:
	LDA.b $19,x
	AND.w #$00FF
	SEC
	SBC.w DATA_0CD6C6,y
	AND.w #$00FF
	ASL
	ASL
	TAY
CODE_0CD745:
	PHX
	LDX.b $06
	LDA.b [$00],y
	SEC
	SBC.w !RAM_YI_Global_Layer1XPosLo
	STA.w $6028,x
	INY
	INY
	LDA.b [$00],y
	SEC
	SBC.w !RAM_YI_Global_Layer1YPosLo
	STA.w $602A,x
	LDY.b $04
	LDA.w $602C,x
	AND.w #$FE00
	ORA.w $796A,y
	STA.w $602C,x
	PLX
	LDA.b $06
	CLC
	ADC.w #$0008
	STA.b $06
	DEC.b $04
	DEC.b $04
	BPL.b CODE_0CD728
	SEP.b #$10
	RTS

CODE_0CD77C:
	LDY.w $7D36,x
	BPL.b CODE_0CD785
	JML.l CODE_03A858

CODE_0CD785:
	LDY.b $18,x
	LDA.w #$7E5DA6
	CLC
	ADC.w DATA_0CD4DF,y
	STA.b $00
	LDY.b #$7E5DA6>>16
	STY.b $02
	LDA.w $6120
	CLC
	ADC.w #$0006
	STA.b $06
	ASL
	STA.b $08
	LDA.w $6122
	CLC
	ADC.w #$0006
	STA.b $0A
	ASL
	STA.b $0C
	REP.b #$10
	LDA.w #$0004
	STA.b $04
CODE_0CD7B3:
	LDY.b $04
	LDA.b $16,x
	CMP.w DATA_0CD6C6,y
	BCS.b CODE_0CD7C1
	LDY.w #$0000
	BRA.b CODE_0CD7D0

CODE_0CD7C1:
	LDA.b $19,x
	AND.w #$00FF
	SEC
	SBC.w DATA_0CD6C6,y
	AND.w #$00FF
	ASL
	ASL
	TAY
CODE_0CD7D0:
	LDA.b [$00],y
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611C
	CLC
	ADC.b $06
	CMP.b $08
	BCS.b CODE_0CD7FA
	INY
	INY
	LDA.b [$00],y
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611E
	CLC
	ADC.b $0A
	CMP.b $0C
	BCS.b CODE_0CD7FA
	SEP.b #$10
	JML.l CODE_03A858

CODE_0CD7FA:
	DEC.b $04
	DEC.b $04
	BPL.b CODE_0CD7B3
	SEP.b #$10
	RTL

CODE_0CD803:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0CD818
	BEQ.b CODE_0CD818
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CD818
	LDA.w $7D38,y
	BNE.b CODE_0CD819
CODE_0CD818:
	RTS

CODE_0CD819:
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	LDY.b $18,x
	LDA.w #$7E5DA6
	CLC
	ADC.w DATA_0CD4DF,y
	STA.b $04
	LDY.b #$7E5DA6>>16
	STY.b $06
	JSL.l CODE_0CFF61
	REP.b #$10
	LDA.w #$0004
	STA.b $08
CODE_0CD83A:
	LDY.b $08
	LDA.b $16,x
	CMP.w DATA_0CD6C6,y
	BCS.b CODE_0CD848
	LDY.w #$0000
	BRA.b CODE_0CD857

CODE_0CD848:
	LDA.b $19,x
	AND.w #$00FF
	SEC
	SBC.w DATA_0CD6C6,y
	AND.w #$00FF
	ASL
	ASL
	TAY
CODE_0CD857:
	LDA.b [$04],y
	STA.b $00
	INY
	INY
	LDA.b [$04],y
	STA.b $02
	SEP.b #$10
	LDY.b $08
	STA.w $0008,y
	LDA.b $00
	STA.w $0000,y
	LDA.w #!Define_YI_AmbSpr208
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	STA.w $70A2,y
	LDA.b $02
	STA.w $7142,y
	LDA.w #$0003
	STA.w $7782,y
	LDA.w #$0016
	STA.w $73C2,y
	REP.b #$10
	DEC.b $08
	DEC.b $08
	BPL.b CODE_0CD83A
	SEP.b #$10
	LDY.b $18,x
	LDA.w $0CC4
	AND.w DATA_0CD4D1,y
	STA.w $0CC4
	JSL.l CODE_despawn_sprite_free_slot
	LDA.w #$01A2
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0CD8FA
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0180
	STA.w $7A96,y
	LDA.w #$0004
	STA.b $00
CODE_0CD8C9:
	LDY.b $00
	LDA.w $0000,y
	STA.b $02
	LDA.w $0008,y
	STA.b $04
	LDA.w #$01A2
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0CD8FA
	LDA.b $02
	STA.w $70E2,y
	LDA.b $04
	STA.w $7182,y
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0180
	STA.w $7A96,y
	DEC.b $00
	DEC.b $00
	BPL.b CODE_0CD8C9
CODE_0CD8FA:
	PLA
	RTL

CODE_0CD8FC:
	LDA.w $7680,x
	CLC
	ADC.w #$0080
	CMP.w #$01F0
	BCS.b CODE_0CD914
	LDA.w $7682,x
	CLC
	ADC.w #$0080
	CMP.w #$01F0
	BCC.b CODE_0CD925
CODE_0CD914:
	LDY.b $18,x
	LDA.w $0CC4
	AND.w DATA_0CD4D1,y
	STA.w $0CC4
	PLY
	PLA
	JML.l CODE_03A31E

CODE_0CD925:
	RTL

CODE_0CD926:
	LDX.b $12
	JSL.l CODE_03AF23
	JSL.l CODE_0CDA0C
	LDY.b $77,x
	TYX
	JMP.w (DATA_big_boo_back_substate_ptr,x)

DATA_0CD936:
DATA_big_boo_back_substate_ptr:                 ; 3-entry Big Boo back-facing sub-state ptr (drift / charge / pause)
	dw CODE_0CD99D
	dw CODE_0CD93C
	dw CODE_0CD97D

CODE_0CD93C:
	LDX.b $12
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BNE.b CODE_0CD96A
	CMP.w $60C4
	BNE.b CODE_0CD96A
	LDA.w $7A96,x
	BNE.b CODE_0CD969
	LDA.w #$0010
	STA.w $7A96,x
	LDA.w #$0002
	STA.w $7402,x
	LDA.b $10
	AND.w #$003F
	BNE.b CODE_0CD969
	STZ.w $7402,x
CODE_0CD969:
	RTL

CODE_0CD96A:
	SEP.b #$20
	LDA.b #$02
	STA.w $7402,x
	LDA.b #$10
	STA.w $77C0,x
	INC.b $77,x
	INC.b $77,x
	REP.b #$20
	RTL

CODE_0CD97D:
	LDX.b $12
	LDY.w $77C0,x
	BEQ.b CODE_0CD98C
	SEP.b #$20
	DEC.w $77C0,x
	REP.b #$20
	RTL

CODE_0CD98C:
	SEP.b #$20
	LDA.b #$02
	STA.w $7402,x
	LDA.b #$04
	STA.w $7A96,x
	STZ.b $77,x
	REP.b #$20
	RTL

CODE_0CD99D:
	LDX.b $12
	JSR.w CODE_0CDA16
	LDA.w $7A96,x
	BNE.b CODE_0CD9D2
	STZ.w $7402,x
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BNE.b CODE_0CD9D3
	CMP.w $60C4
	BNE.b CODE_0CD9D3
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$10
	STA.w $7A96,x
	LDA.b #$00
	STA.w $7402,x
	INC.b $77,x
	INC.b $77,x
	REP.b #$20
CODE_0CD9D2:
	RTL

CODE_0CD9D3:
	STA.w $7400,x
	LDA.w $611C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $611E
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7CD6,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0080
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTL

CODE_0CDA0C:
	LDY.w $7D36,x
	BPL.b CODE_0CDA15
	JML.l CODE_03A858

CODE_0CDA15:
	RTL

CODE_0CDA16:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_0CDA2B
	BEQ.b CODE_0CDA2B
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CDA2B
	LDA.w $7D38,y
	BNE.b CODE_0CDA2C
CODE_0CDA2B:
	RTS

CODE_0CDA2C:
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	JSL.l CODE_0CFF61
	JSL.l CODE_despawn_sprite_free_slot
	LDA.w #$01A2
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0CDA5C
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0180
	STA.w $7A96,y
CODE_0CDA5C:
	PLA
	RTL

;---------------------------------------------------------------------------

DATA_0CDA5E:
	dw $0026,$0024,$0050,$0051,$0080,$0081,$00B0,$00B1
	dw $00E0,$00E1,$0110,$0116

DATA_0CDA76:
	dw $0202,$0202,$0404,$0402,$0402,$0404

DATA_0CDA82:
	dw $3535,$3535,$3333,$B335,$3335,$3333

DATA_0CDA8E:
	dw $0404,$0404,$0101,$0104,$0104,$0101

DATA_0CDA9A:
	dw $00D8,$00D8,$00D8,$00D8,$00FA,$00FA,$00D8,$00FA
	dw $00D8,$00FA,$00FA,$00FA

DATA_0CDAB2:
	dw $3E00,$3E00,$3E00,$3E00,$3600,$3600,$3E00,$3600
	dw $3E00,$3600,$3600,$3600

; DATA_kamek_spell_color1_per_boss -- SMWC: BGR15 color of Kamek's first magic spell, 2 bytes
; per boss battle (12 entries).
DATA_0CDACA:
DATA_kamek_spell_color1_per_boss:
	dw $611F,$22DF,$7F00,$23EC,$611F,$22DF,$7F00,$5C13
	dw $611F,$22DF,$7F00,$23EC

; DATA_kamek_spell_color2_per_boss -- SMWC: BGR15 color of Kamek's second magic spell, 2 bytes
; per boss battle (12 entries).
DATA_0CDAE2:
DATA_kamek_spell_color2_per_boss:
	dw $22DF,$7F00,$23EC,$7F00,$7F00,$23EC,$611F,$5D20
	dw $23EC,$611F,$22DF,$611F

; DATA_boss_music_per_battle -- SMWC: per-boss music value (12 entries). $0A = x-4 boss
; music (with level-header music 7/8 swapped to the long intro used in
; Piranha & Raven); $0C = x-8 boss music.
DATA_0CDAFA:
DATA_boss_music_per_battle:
	db $0A,$0C,$0A,$0C,$0A,$0A,$0A,$0C,$0A,$0A,$0A,$0C

;---------------------------------------------------------------------------
; Sprite $048: Kamek in cutscenes (boss-foreshadow flying-in animation).
; Raiden: init_boss_kamek.
;
; See docs/family-kamek.md for the full Kamek variants family
; (4 Kameks: $048 cutscene + $053 Oh-My + $125 attacking/ending + $1AD
; magic-shooting, plus $1AE Magic Shot + 3 boss-arena VFX). Notable:
; boss music is kicked by THIS sprite (state $1C, just before
; despawn), not by the boss itself -- DATA_boss_music_per_battle is
; read here. A level theoretically could not spawn $048 and never
; get the boss music. Also: this Init's 15-state cinematic spends 5
; states on a 2-pass spell-color cast that is deliberately warm-then-
; cool (DATA_kamek_spell_color1_per_boss + ..._color2_per_boss).
;---------------------------------------------------------------------------
YI_NorSpr048_CutsceneKamek_Init:
init_cutscene_kamek:
;$0CDB06
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	BEQ.b CODE_0CDB13
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	BRA.b CODE_0CDB4D

CODE_0CDB13:
	JSL.l CODE_028925
	STZ.w $60B4
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	LSR
	ORA.w !RAM_YI_Level_CurrentWorldLo
	STA.b $76,x
	LDA.w !RAM_YI_Level_LevelHeaderBG2TilesetLo
	CMP.w #$0016
	BNE.b CODE_0CDB47
	SEP.b #$20
	LDA.b #!REGISTER_BG2HorizScrollOffset
	STA.w HDMA[$03].Destination
	LDA.b #!REGISTER_BG2VertScrollOffset
	STA.w HDMA[$04].Destination
	REP.b #$20
	LDA.w #$0100
	STA.w $6096
	BRA.b CODE_0CDB4D

CODE_0CDB47:
	LDA.w #$0100
	STA.w $6098
CODE_0CDB4D:
	LDA.w #$FFFF
	STA.w $0E35
	RTL

;---------------------------------------------------------------------------

DATA_0CDB54:
	db $40,!REGISTER_CGRAMAddress : dl $7E5C98

DATA_0CDB59:
	db $D9 : dw $7E5A18
	db $D9 : dw $7E5A18
	db $00

DATA_0CDB60:
	db $42,!REGISTER_WriteToCGRAMPort : dl $7E5D18

DATA_0CDB65:
	db $D9 : dw $7E5388
	db $D9 : dw $7E543A
	db $00

;---------------------------------------------------------------------------
; Sprite $048 main. Raiden: main_boss_kamek.
;---------------------------------------------------------------------------
YI_NorSpr048_CutsceneKamek_Main:
main_cutscene_kamek:
;$0CDB6C
	JSL.l CODE_03AF23
	JSR.w CODE_0CE526
	LDY.b $16,x
	TYX
	JMP.w (DATA_cutscene_kamek_state_ptr,x)

DATA_0CDB79:
DATA_cutscene_kamek_state_ptr:                  ; 15-phase state table: wait/init/fly-in/talk/msg-box/turn/fly-out + 2 magic sequences + cleanup
	dw CODE_0CDB97
	dw CODE_0CDBD7
	dw CODE_0CDC1B
	dw CODE_0CDC99
	dw CODE_0CDCE8
	dw CODE_0CDD31
	dw CODE_0CDD7B
	dw CODE_0CDDA5
	dw CODE_0CE10E
	dw CODE_0CE34D
	dw CODE_0CDF4B
	dw CODE_0CE214
	dw CODE_0CE404
	dw CODE_0CE4A7
	dw CODE_0CE4CB

CODE_0CDB97:
	LDX.b $12
	LDA.w $1015
	BEQ.b CODE_0CDBBD
	LDA.w $60C6
	BNE.b CODE_0CDBA8
	LDA.w $60C0
	BNE.b CODE_0CDBBD
CODE_0CDBA8:
	LDA.w !RAM_YI_Level_BossHasBeenVisitedBeforeFlagLo
	BNE.b CODE_0CDBBE
	INC.w !RAM_YI_Level_BossHasBeenVisitedBeforeFlagLo
	SEP.b #$20
	LDA.b #$00
	STA.w $7A98,x
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
CODE_0CDBBD:
	RTL

CODE_0CDBBE:
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	LDA.w $0948
	STA.l YI_Global_PaletteMirror[$00].LowByte
	STA.l $702D6C
	STZ.w $0948
	LDY.b #$0E
	STY.b $16,x
	RTL

CODE_0CDBD7:
	LDX.b $12
	LDA.w $7A98,x
	BNE.b CODE_0CDC1A
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w #$0130
	STA.w $70E2,x
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$0040
	STA.w $7182,x
	LDA.w $7182,x
	STA.w $7A36,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
	SEP.b #$20
	LDA.b #$05
	STA.w $74A2,x
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
CODE_0CDC1A:
	RTL

CODE_0CDC1B:
	LDX.b $12
	JSR.w CODE_0CE4ED
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	LDA.w $7680,x
	CMP.w #$00F4
	BMI.b CODE_0CDC43
	LDA.w $7A98,x
	BNE.b CODE_0CDC42
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
CODE_0CDC42:
	RTL

CODE_0CDC43:
	LDA.w #$0005
	STA.w $7402,x
	LDA.w #$0020
	STA.w $7540,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0CDC70
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	SEP.b #$20
	LDA.b #$13
	STA.b $18,x
	LDA.b #$02
	STA.w $7402,x
	LDA.b #$20
	STA.w $7A98,x
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
CODE_0CDC70:
	RTL

DATA_0CDC71:
	db $04,$04,$03,$02,$03,$04,$03,$02,$03,$04,$03,$02,$03,$04,$03,$02
	db $03,$04,$03,$02

DATA_0CDC85:
	db $02,$06,$02,$06,$02,$06,$02,$06,$02,$06,$02,$06,$02,$06,$02,$06
	db $02,$06,$02,$06

CODE_0CDC99:
	LDX.b $12
	JSR.w CODE_0CE4ED
	LDA.w $7A98,x
	BNE.b CODE_0CDCCA
	SEP.b #$20
	LDY.b $18,x
	DEY
	BMI.b CODE_0CDCCB
	STY.b $18,x
	LDA.w DATA_0CDC71,y
	STA.w $7402,x
	LDA.w DATA_0CDC85,y
	STA.w $7A98,x
	REP.b #$20
	TYA
	AND.w #$0007
	CMP.w #$0007
	BNE.b CODE_0CDCCA
	LDA.w #!Define_YI_SoundID5B_KamekTalk
	JSL.l CODE_push_sound_queue
CODE_0CDCCA:
	RTL

CODE_0CDCCB:
	LDA.b #$04
	STA.w $7402,x
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
	LDA.b $76,x
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_0CDA5E,y
	STA.l $704070
	INC.w !RAM_YI_Level_MessageBoxState 
	RTL

CODE_0CDCE8:
	LDX.b $12
	JSR.w CODE_0CE4ED
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_0CDD24
	LDA.w $0948
	STA.l YI_Global_PaletteMirror[$00].LowByte
	STA.l $702D6C
	STZ.w $0948
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$05
	STA.b $18,x
	TAY
	LDA.w DATA_0CDD25,y
	STA.w $7402,x
	LDA.b #$04
	STA.w $7A98,x
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
CODE_0CDD24:
	RTL

DATA_0CDD25:
	db $02,$05,$06,$06,$05,$02

DATA_0CDD2B:
	db $00,$00,$02,$00,$00,$00

CODE_0CDD31:
	LDX.b $12
	JSR.w CODE_0CE4ED
	LDA.w $7A98,x
	BNE.b CODE_0CDD6B
	SEP.b #$20
	DEC.b $18,x
	BMI.b CODE_0CDD6C
	LDY.b $18,x
	LDA.w DATA_0CDD25,y
	STA.w $7402,x
	LDA.w $7400,x
	EOR.w DATA_0CDD2B,y
	STA.w $7400,x
	LDA.b #$04
	STA.w $7A98,x
	REP.b #$20
	LDA.w DATA_0CDD2B,y
	AND.w #$00FF
	BEQ.b CODE_0CDD6B
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0CDD6B:
	RTL

CODE_0CDD6C:
	STZ.w $7402,x
	LDA.b #$04
	STA.w $7A98,x
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
	RTL

CODE_0CDD7B:
	LDX.b $12
	JSR.w CODE_0CE4ED
	LDA.w $7A98,x
	BNE.b CODE_0CDD94
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
CODE_0CDD94:
	LDA.w $7680,x
	CMP.w #$0150
	BCC.b CODE_0CDDA4
	SEP.b #$20
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
CODE_0CDDA4:
	RTL

CODE_0CDDA5:
	LDX.b $12
	SEP.b #$20
	LDA.b #$05
	STA.w $74A2,x
	REP.b #$20
	STZ.w $7400,x
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w #$0130
	STA.w $70E2,x
	LDA.w #$F800
	STA.w $75E0,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7540,x
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$0040
	STA.w $7182,x
	STZ.w $7542,x
	LDA.w #$F800
	STA.w $75E2,x
	STZ.w $7402,x
	LDA.w #$0002
	STA.w $7A98,x
	LDA.w #$0020
	STA.l $70449E
	LDA.w #$03B8
	STA.l $7044A0
	LDA.w #$0000
	STA.l $7044A2
	LDA.w #$FF98
	STA.l $7044A4
	LDA.w #$0000
	STA.l $7044A6
	LDA.w #$0000
	STA.l $7044A8
	LDA.w #$0001
	STA.l $7044AA
	LDA.w #$0000
	STA.l $7044AC
	LDA.w #$1000
	STA.l $7044AE
	LDA.w #$0000
	STA.l $7044B0
	LDA.w #$0020
	STA.l $7044F2
	LDA.w #$0080
	STA.l $7044F4
	LDA.w #$0002
	STA.l $7044F6
	LDA.w #$4000
	STA.l $7044F8
	LDA.w #$0030
	STA.l $7044FA
	LDA.w #$0000
	STA.l $7044FC
	LDA.w #$0000
	STA.l $7044FE
	LDA.w #$0000
	STA.l $704500
	LDA.w #$0000
	STA.l $704502
	LDA.w #$0000
	STA.l $704504
	LDA.w #$0000
	STA.l $704506
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $76,x
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_kamek_spell_color1_per_boss,y
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$44B2
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_08EDAC>>16
	LDA.w #FXCODE_08EDAC
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !RAM_YI_Level_LevelHeaderBG2TilesetLo
	CMP.w #$0016
	BEQ.b CODE_0CDEC1
	LDA.w #$0100
	STA.w $6098
	STA.w !RAM_YI_Global_Layer3XPosLo
	LDA.w #$0000
	STA.w $60A0
	STA.w !RAM_YI_Global_Layer3YPosLo
	BRA.b CODE_0CDED3

CODE_0CDEC1:
	LDA.w #$0100
	STA.w $6096
	STA.w !RAM_YI_Global_Layer2XPosLo
	LDA.w #$0200
	STA.w $609E
	STA.w !RAM_YI_Global_Layer2YPosLo
CODE_0CDED3:
	SEP.b #$20
	LDA.w !RAM_YI_Global_MainScreenLayers
	ORA.w !RAM_YI_Global_SubScreenLayers
	STA.w !RAM_YI_Global_MainScreenLayers
	STA.w !RAM_YI_Global_MainScreenWindowMask
	STZ.w !RAM_YI_Global_SubScreenLayers
	STZ.w !RAM_YI_Global_SubScreenWindowMask
	LDY.b $76,x
	LDA.w DATA_0CDA76,y
	TRB.w !RAM_YI_Global_MainScreenLayers
	TRB.w !RAM_YI_Global_MainScreenWindowMask
	TSB.w !RAM_YI_Global_SubScreenLayers
	TSB.w !RAM_YI_Global_SubScreenWindowMask
	LDA.w DATA_0CDA82,y
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDX.b #$04
CODE_0CDF00:
	LDA.w DATA_0CDB54,x
	STA.w HDMA[$01].Parameters,x
	LDA.w DATA_0CDB60,x
	STA.w HDMA[$02].Parameters,x
	DEX
	BPL.b CODE_0CDF00
	LDA.b #$7E5A18>>16
	STA.w HDMA[$01].IndirectSourceBank
	STA.w HDMA[$02].IndirectSourceBank
	LDX.b #$06
CODE_0CDF19:
	LDA.w DATA_0CDB59,x
	STA.l $7E5C98,x
	LDA.w DATA_0CDB65,x
	STA.l $7E5D18,x
	DEX
	BPL.b CODE_0CDF19
	LDX.b #$58
	LDA.w DATA_0CDA8E,y
CODE_0CDF2F:
	STA.l $7E5A18,x
	DEX
	BPL.b CODE_0CDF2F
	LDX.b $12
	LDA.b #$05
	STA.w $74A2,x
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID18_CoinSpillage
	JSL.l CODE_push_sound_queue
	RTL

CODE_0CDF4B:
	LDX.b $12
	LDA.w #!Define_YI_MusicID_FadeMusicCommand
	STA.w !RAM_YI_Global_PlayMusicLo
	LDA.w #$0002
	STA.w $7400,x
	LDA.w !RAM_YI_Global_Layer1XPosLo
	SEC
	SBC.w #$0040
	STA.w $70E2,x
	LDA.w #$0800
	STA.w $75E0,x
	LDA.b $76,x
	AND.w #$00FF
	ASL
	TAY
	PHD
	LDA.w #$0000
	TCD
	REP.b #$10
	LDA.w DATA_0CDA9A,y
	LDX.w #$6800
	PHY
	JSL.l CODE_00B756
	PLY
	LDX.w DATA_0CDAB2,y
	TXY
	LDX.w #$706800>>16
	STX.b $01
	LDX.w #$706800
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$10
	PLD
	LDX.b $12
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7540,x
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$0040
	STA.w $7182,x
	STZ.w $7542,x
	LDA.w #$F800
	STA.w $75E2,x
	STZ.w $7402,x
	LDA.w #$0002
	STA.w $7A98,x
	LDA.w #$0020
	STA.l $70449E
	LDA.w #$03B8
	STA.l $7044A0
	LDA.w #$0000
	STA.l $7044A2
	LDA.w #$FF98
	STA.l $7044A4
	LDA.w #$0000
	STA.l $7044A6
	LDA.w #$0000
	STA.l $7044A8
	LDA.w #$0001
	STA.l $7044AA
	LDA.w #$0000
	STA.l $7044AC
	LDA.w #$1000
	STA.l $7044AE
	LDA.w #$0000
	STA.l $7044B0
	LDA.w #$0020
	STA.l $7044F2
	LDA.w #$0080
	STA.l $7044F4
	LDA.w #$0002
	STA.l $7044F6
	LDA.w #$4000
	STA.l $7044F8
	LDA.w #$0030
	STA.l $7044FA
	LDA.w #$0000
	STA.l $7044FC
	LDA.w #$0000
	STA.l $7044FE
	LDA.w #$0000
	STA.l $704500
	LDA.w #$0000
	STA.l $704502
	LDA.w #$0000
	STA.l $704504
	LDA.w #$0000
	STA.l $704506
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $76,x
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_kamek_spell_color2_per_boss,y
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$44B2
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_08EDAC>>16
	LDA.w #FXCODE_08EDAC
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !RAM_YI_Level_LevelHeaderBG2TilesetLo
	CMP.w #$0016
	BEQ.b CODE_0CE096
	LDA.w #$0100
	STA.w $6098
	STA.w !RAM_YI_Global_Layer3XPosLo
	LDA.w #$0000
	STA.w $60A0
	STA.w !RAM_YI_Global_Layer3YPosLo
	BRA.b CODE_0CE0A8

CODE_0CE096:
	LDA.w #$0100
	STA.w $6096
	STA.w !RAM_YI_Global_Layer2XPosLo
	LDA.w #$0200
	STA.w $609E
	STA.w !RAM_YI_Global_Layer2YPosLo
CODE_0CE0A8:
	SEP.b #$20
	LDY.b $76,x
	LDA.w DATA_0CDA76,y
	TRB.w !RAM_YI_Global_MainScreenLayers
	TRB.w !RAM_YI_Global_MainScreenWindowMask
	TSB.w !RAM_YI_Global_SubScreenLayers
	TSB.w !RAM_YI_Global_SubScreenWindowMask
	LDA.w DATA_0CDA82,y
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDX.b #$04
CODE_0CE0C3:
	LDA.w DATA_0CDB54,x
	STA.w HDMA[$01].Parameters,x
	LDA.w DATA_0CDB60,x
	STA.w HDMA[$02].Parameters,x
	DEX
	BPL.b CODE_0CE0C3
	LDA.b #$7E5A18>>16
	STA.w HDMA[$01].IndirectSourceBank
	STA.w HDMA[$02].IndirectSourceBank
	LDX.b #$06
CODE_0CE0DC:
	LDA.w DATA_0CDB59,x
	STA.l $7E5C98,x
	LDA.w DATA_0CDB65,x
	STA.l $7E5D18,x
	DEX
	BPL.b CODE_0CE0DC
	LDX.b #$58
	LDA.w DATA_0CDA8E,y
CODE_0CE0F2:
	STA.l $7E5A18,x
	DEX
	BPL.b CODE_0CE0F2
	LDX.b $12
	LDA.b #$05
	STA.w $74A2,x
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID18_CoinSpillage
	JSL.l CODE_push_sound_queue
	RTL

CODE_0CE10E:
	LDX.b $12
	LDA.w $7682,x
	SEC
	SBC.w #$0009
	CMP.w #$0100
	BCS.b CODE_0CE128
	AND.w #$00FF
	CLC
	ADC.w #$0010
	XBA
	STA.l $7044F2
CODE_0CE128:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	AND.w #$FC00
	XBA
	ASL
	ASL
	STA.w $7542,x
	LDA.w $7A98,x
	BNE.b CODE_0CE14E
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7A98,x
CODE_0CE14E:
	LDA.w $7680,x
	CMP.w #$0100
	BCS.b CODE_0CE190
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEC
	SBC.w $72C0,x
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w $7682,x
	CMP.w #$0100
	BCS.b CODE_0CE190
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEC
	SBC.w $72C2,x
	CMP.w #$0100
	BCS.b CODE_0CE190
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_08ECEF>>16
	LDA.w #FXCODE_08ECEF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	NOP #2
	JSL.l CODE_queue_dma_4args	: dl $7E56D0,$703A02 : dw $0348
	LDX.b $12
CODE_0CE190:
	LDA.w $7680,x
	CMP.w #$0100
	BPL.b CODE_0CE1D9
	LDX.b #FXCODE_08EF0B>>16
	LDA.w #FXCODE_08EF0B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	NOP #2
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $01A4
	JSL.l CODE_queue_dma_4args	: dl $7E5388,$7036BA : dw $01A4
	SEP.b #$20
	LDA.w !RAM_YI_Level_LevelHeaderBG2TilesetLo
	CMP.b #$16
	BEQ.b CODE_0CE1CB
	LDA.b #$02
	STA.w !RAM_YI_Global_BG3And4WindowMaskSettings
	BRA.b CODE_0CE1D0

CODE_0CE1CB:
	LDA.b #$20
	STA.w !RAM_YI_Global_BG1And2WindowMaskSettings
CODE_0CE1D0:
	LDA.b #$36
	TSB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDX.b $12
CODE_0CE1D9:
	JSR.w CODE_0CE313
	LDA.w $7A96,x
	BNE.b CODE_0CE213
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w #!Define_YI_AmbSpr220
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0007
	STA.w $73C2,y
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w $7182,x
	STA.w $7142,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w #!Define_YI_SoundID18_CoinSpillage
	JSL.l CODE_push_sound_queue
CODE_0CE213:
	RTL

CODE_0CE214:
	LDX.b $12
	LDA.w $7682,x
	SEC
	SBC.w #$0009
	CMP.w #$0100
	BCS.b CODE_0CE22E
	AND.w #$00FF
	CLC
	ADC.w #$0010
CODE_0CE229:
	XBA
	STA.l $7044F2
CODE_0CE22E:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	AND.w #$FC00
	XBA
	ASL
	ASL
	STA.w $7542,x
	LDA.w $7A98,x
	BNE.b CODE_0CE250
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7A98,x
CODE_0CE250:
	LDA.w $7680,x
	CMP.w #$0100
	BCS.b CODE_0CE292
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEC
	SBC.w $72C0,x
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w $7682,x
	CMP.w #$0100
	BCS.b CODE_0CE292
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEC
	SBC.w $72C2,x
	CMP.w #$0100
	BCS.b CODE_0CE292
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_08EE49>>16
	LDA.w #FXCODE_08EE49
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	NOP #2
	JSL.l CODE_queue_dma_4args	: dl $7E56D0,$703A02 : dw $0348
	LDX.b $12
CODE_0CE292:
	LDA.w $7680,x
	BMI.b CODE_0CE2D8
	LDX.b #FXCODE_08EF0B>>16
	LDA.w #FXCODE_08EF0B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	NOP #2
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $01A4
	JSL.l CODE_queue_dma_4args	: dl $7E5388,$7036BA : dw $01A4
	SEP.b #$20
	LDA.w !RAM_YI_Level_LevelHeaderBG2TilesetLo
	CMP.b #$16
	BEQ.b CODE_0CE2CA
	LDA.b #$02
	STA.w !RAM_YI_Global_BG3And4WindowMaskSettings
	BRA.b CODE_0CE2CF

CODE_0CE2CA:
	LDA.b #$20
	STA.w !RAM_YI_Global_BG1And2WindowMaskSettings
CODE_0CE2CF:
	LDA.b #$36
	TSB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDX.b $12
CODE_0CE2D8:
	JSR.w CODE_0CE313
	LDA.w $7A96,x
	BNE.b CODE_0CE312
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w #!Define_YI_AmbSpr220
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0007
	STA.w $73C2,y
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w $7182,x
	STA.w $7142,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w #!Define_YI_SoundID18_CoinSpillage
	JSL.l CODE_push_sound_queue
CODE_0CE312:
	RTL

CODE_0CE313:
	LDA.w $7680,x
	CLC
	ADC.w #$0060
	CMP.w #$01B0
	BCS.b CODE_0CE32C
	LDA.w $7682,x
	CLC
	ADC.w #$0060
	CMP.w #$01B0
	BCS.b CODE_0CE32C
	RTS

CODE_0CE32C:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w #$0020
	STA.w $7A96,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A2,x
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
	PLA
	RTL

CODE_0CE34D:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CE363
	LDA.w #$0002
	STA.w $1015
	SEP.b #$20
	LDA.b #$01
	STA.w $7A39,x
	REP.b #$20
CODE_0CE363:
	LDA.l $7044F2
	CMP.w #$9800
	BCC.b CODE_0CE375
	SEP.b #$20
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
	RTL

CODE_0CE375:
	LDX.b $12
	LDA.w $7682,x
	SEC
	SBC.w #$0009
	CMP.w #$0100
	BCS.b CODE_0CE38F
	AND.w #$00FF
	CLC
	ADC.w #$0010
	XBA
	STA.l $7044F2
CODE_0CE38F:
	LDA.w $7680,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEC
	SBC.w $72C0,x
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w $7682,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEC
	SBC.w $72C2,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_08ECEF>>16
	LDA.w #FXCODE_08ECEF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	NOP #2
	JSL.l CODE_queue_dma_4args	: dl $7E56D0,$703A02 : dw $0348
	LDX.b $12
	LDX.b #FXCODE_08EF0B>>16
	LDA.w #FXCODE_08EF0B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	NOP #2
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $01A4
	JSL.l CODE_queue_dma_4args	: dl $7E5388,$7036BA : dw $01A4
	SEP.b #$20
	LDA.w !RAM_YI_Level_LevelHeaderBG2TilesetLo
	CMP.b #$16
	BEQ.b CODE_0CE3F5
	LDA.b #$02
	STA.w !RAM_YI_Global_BG3And4WindowMaskSettings
	BRA.b CODE_0CE3FA

CODE_0CE3F5:
	LDA.b #$20
	STA.w !RAM_YI_Global_BG1And2WindowMaskSettings
CODE_0CE3FA:
	LDA.b #$36
	TSB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDX.b $12
	RTL

CODE_0CE404:
	LDX.b $12
	LDA.l $7044F2
	CMP.w #$9800
	BCC.b CODE_0CE418
	SEP.b #$20
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
	RTL

CODE_0CE418:
	LDX.b $12
	LDA.w $7682,x
	SEC
	SBC.w #$0009
	CMP.w #$0100
	BCS.b CODE_0CE432
	AND.w #$00FF
	CLC
	ADC.w #$0010
	XBA
	STA.l $7044F2
CODE_0CE432:
	LDA.w $7680,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEC
	SBC.w $72C0,x
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w $7682,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEC
	SBC.w $72C2,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_08EE49>>16
	LDA.w #FXCODE_08EE49
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	NOP #2
	JSL.l CODE_queue_dma_4args	: dl $7E56D0,$703A02 : dw $0348
	LDX.b $12
	LDX.b #FXCODE_08EF0B>>16
	LDA.w #FXCODE_08EF0B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	NOP #2
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $01A4
	JSL.l CODE_queue_dma_4args	: dl $7E5388,$7036BA : dw $01A4
	SEP.b #$20
	LDA.w !RAM_YI_Level_LevelHeaderBG2TilesetLo
	CMP.b #$16
	BEQ.b CODE_0CE498
	LDA.b #$02
	STA.w !RAM_YI_Global_BG3And4WindowMaskSettings
	BRA.b CODE_0CE49D

CODE_0CE498:
	LDA.b #$20
	STA.w !RAM_YI_Global_BG1And2WindowMaskSettings
CODE_0CE49D:
	LDA.b #$36
	TSB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDX.b $12
	RTL

CODE_0CE4A7:
	LDX.b $12
	LDA.w #$FFFF
	STA.w $1015
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	SEP.b #$20
	LDA.b #$36
	TRB.w !RAM_YI_Global_HDMAEnable
	LDA.b #$20
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	STZ.w !RAM_YI_Global_MainScreenWindowMask
	STZ.w !RAM_YI_Global_SubScreenWindowMask
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
	RTL

CODE_0CE4CB:
	LDX.b $12
	LDA.w $1015
	BEQ.b CODE_0CE4D3
	RTL

CODE_0CE4D3:
	JSR.w CODE_0CE5B1
	LDY.b $76,x
	CPY.b #$0B
	BEQ.b CODE_0CE4E5
	LDA.w DATA_boss_music_per_battle,y
	AND.w #$00FF
	STA.w !RAM_YI_Global_PlayMusicLo
CODE_0CE4E5:
	JML.l CODE_despawn_sprite_free_slot

CODE_0CE4E9:
	JSR.w CODE_0CE4ED
	RTL

CODE_0CE4ED:
	REP.b #$10
	TXY
	LDX.b $78,y
	LDA.l DATA_sine_lut_8bit_radians,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CLC
	ADC.w $7A36,y
	STA.w $7182,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	CLC
	ADC.w #$0008
	AND.w #$01FE
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	TYX
	SEP.b #$10
	RTS

CODE_0CE526:
	LDY.w $7A39,x
	BEQ.b CODE_0CE568
	LDA.b $14
	AND.w #$0003
	BNE.b CODE_0CE568
	SEP.b #$20
	LDA.w $7A38,x
	PHA
	CLC
	ADC.b #$1C
	AND.b #$1E
	TAY
	PLA
	INC
	INC
	AND.b #$1E
	STA.w $7A38,x
	REP.b #$20
	PHB
	LDX.b #$7021C2>>16
	PHX
	PLB
	TYX
	LDY.b #$1C
CODE_0CE550:
	LDA.l DATA_5FE9A8,x
	STA.w $7021C2,y
	STA.w $702F2E,y
	TXA
	DEC
	DEC
	AND.w #$001E
	TAX
	DEY
	DEY
	BPL.b CODE_0CE550
	PLB
	LDX.b $12
CODE_0CE568:
	RTS

DATA_0CE569:
	dl DATA_5FA5CA
	dl $702122
	dl $702122
	dl $702122
	dl $7021A2
	dl $702122
	dl DATA_5FA606
	dl $702122
	dl $702182
	dl DATA_5FA58E
	dl DATA_5FA642
	dl $7021C2
	dl $702102
	dl $702122
	dl $702182
	dl $702122
	dl $702122
	dl $702122
	dl $7021A2
	dl $702122
	dl $702182
	dl $702142
	dl $702142
	dl $702102

CODE_0CE5B1:
	LDA.b $76,x
	ASL
	CLC
	ADC.b $76,x
	TAY
CODE_0CE5B8:
	PHX
	LDA.w DATA_0CE569,y
	STA.b $00
	LDX.w DATA_0CE569+$02,y
	STX.b $02
	LDX.b #$1C
CODE_0CE5C5:
	TXY
	LDA.b [$00],y
	STA.l YI_Global_PaletteMirror[$E1].LowByte,x
	STA.l $702F2E,x
	DEX
	DEX
	BPL.b CODE_0CE5C5
	PLX
	RTS

CODE_0CE5D6:
	PHB
	PHK
	PLB
	JSR.w CODE_0CE5B8
	PLB
	RTL

;---------------------------------------------------------------------------

DATA_0CE5DE:
	dw $FFA0,$0060

DATA_0CE5E2:
	db $02,$00,$03,$00,$02,$01,$04

;---------------------------------------------------------------------------
; Sprite $047: Shy Guy pushing Roger the Potted Ghost. Raiden: init_roger_shy_guy.
;---------------------------------------------------------------------------
YI_NorSpr047_ShyguyPushingRoger_Init:
init_roger_shy_guy:
;$0CE5E9
	LDA.w $70E2,x
	STA.w $7A36,x
	LDA.w DATA_0CE5DE
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$06
	STA.b $76,x
	TAY
	LDA.w DATA_0CE5E2,y
	STA.w $7402,x
	STA.b $00
	LDA.b #$03
	STA.w $7A96,x
	REP.b #$20
	TXY
	LDA.w #!Define_YI_NorSpr047_ShyguyPushingRoger
	JSL.l CODE_03A366
	BCC.b CODE_0CE657
	LDA.w $70E2,x
	CLC
	ADC.w #$0040
	STA.w $70E2,y
	STA.w $7A36,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w DATA_0CE5DE
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	SEP.b #$20
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.b #$02
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701979|!EXRAMBankMirror,y
	LDA.b #$04
	STA.w $74A2,y
	LDA.b #$06
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.b $00
	STA.w $7402,y
	LDA.b #$03
	STA.w $7A96,y
	LDA.b $18,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	REP.b #$20
CODE_0CE657:
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $047 main. Raiden: main_roger_shy_guy.
;---------------------------------------------------------------------------
YI_NorSpr047_ShyguyPushingRoger_Main:
main_roger_shy_guy:
;$0CE658
	JSL.l CODE_03AF23
	JSR.w CODE_0CE94F
	LDY.b $16,x
	TYX
	JMP.w (DATA_roger_pusher_state_ptr,x)

DATA_0CE665:
DATA_roger_pusher_state_ptr:                    ; 2-entry Shyguy-pushing-Roger state ptr (pushing-active / pushing-paused)
	dw CODE_0CE669
	dw CODE_0CE67F

CODE_0CE669:
	LDX.b $12
	LDY.b $19,x
	TYX
	JSR.w (DATA_roger_pusher_phase_ptr,x)
	LDY.b $77,x
	TYX
	JMP.w (DATA_roger_pusher_dir_ptr,x)

DATA_0CE677:
DATA_roger_pusher_phase_ptr:                    ; 2-entry pushing-active phase ptr ($19,x): wind-up / push-shove
	dw CODE_0CE81B
	dw CODE_0CE851

DATA_0CE67B:
DATA_roger_pusher_dir_ptr:                      ; 2-entry pushing-active direction ptr (left-push / right-push)
	dw CODE_0CE68B
	dw CODE_0CE6F1

CODE_0CE67F:
	LDX.b $12
	LDY.b $77,x
	TYX
	JMP.w (DATA_roger_pusher_pause_dir_ptr,x)

DATA_0CE687:
DATA_roger_pusher_pause_dir_ptr:                ; 2-entry pushing-paused direction ptr (left-pause / right-pause)
	dw CODE_0CE731
	dw CODE_0CE774

CODE_0CE68B:
	LDX.b $12
	LDY.b #$00
	LDA.w $7A36,x
	CMP.w $70E2,x
	BMI.b CODE_0CE6A2
	INY
	INY
	SEC
	SBC.w #$0010
	CMP.w $70E2,x
	BMI.b CODE_0CE6AE
CODE_0CE6A2:
	TYA
	STA.w $7400,x
	LDA.w DATA_0CE5DE,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_0CE6B5

CODE_0CE6AE:
	LDA.b $10
	AND.w #$001F
	BEQ.b CODE_0CE6D4
CODE_0CE6B5:
	LDA.w $7A96,x
	BNE.b CODE_0CE6D3
	SEP.b #$20
	DEC.b $76,x
	BPL.b CODE_0CE6C4
	LDA.b #$06
	STA.b $76,x
CODE_0CE6C4:
	LDY.b $76,x
	LDA.w DATA_0CE5E2,y
	STA.w $7402,x
	LDA.b #$03
	STA.w $7A96,x
	REP.b #$20
CODE_0CE6D3:
	RTL

CODE_0CE6D4:
	JSL.l CODE_random_number_gen
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7402,x
	SEP.b #$20
	LDA.b $10
	AND.b #$0F
	CLC
	ADC.b #$10
	STA.w $7A96,x
	INC.b $77,x
	INC.b $77,x
	REP.b #$20
	RTL

CODE_0CE6F1:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CE712
	SEP.b #$20
	DEC.b $76,x
	BMI.b CODE_0CE713
	LDA.w $7400,x
	EOR.b #$02
	STA.w $7400,x
	LDA.b $10
	AND.b #$0F
	CLC
	ADC.b #$10
	STA.w $7A96,x
	REP.b #$20
CODE_0CE712:
	RTL

CODE_0CE713:
	LDA.b #$06
	STA.b $76,x
	TAY
	LDA.w DATA_0CE5E2,y
	STA.w $7402,x
	LDA.b #$03
	STA.w $7A96,x
	STZ.b $77,x
	REP.b #$20
	LDY.w $7400,x
	LDA.w DATA_0CE5DE,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTL

CODE_0CE731:
	LDX.b $12
	LDY.b $19,x
	TYX
	JSR.w (DATA_roger_pusher_pause_phase_ptr,x)
	LDA.w $7A96,x
	BNE.b CODE_0CE757
	SEP.b #$20
	DEC.b $76,x
	BPL.b CODE_0CE748
	LDA.b #$06
	STA.b $76,x
CODE_0CE748:
	LDY.b $76,x
	LDA.w DATA_0CE5E2,y
	STA.w $7402,x
	LDA.b #$01
	STA.w $7A96,x
	REP.b #$20
CODE_0CE757:
	RTL

DATA_0CE758:
	dw DATA_0CE75C,DATA_0CE762

DATA_0CE75C:
	db $05,$09,$08,$07,$06,$05

DATA_0CE762:
	db $0B,$0C,$0B,$0C,$0B,$0C

DATA_0CE768:
	dw $0000,$0008,$FFF0

DATA_0CE76E:
	dw $0008,$0010,$0002

CODE_0CE774:
	LDX.b $12
	LDA.w #$0004
	STA.b $00
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $70E2,y
	CMP.w #$0100
	BCS.b CODE_0CE793
	DEC.b $00
	DEC.b $00
	CMP.w #$0060
	BCC.b CODE_0CE793
	DEC.b $00
	DEC.b $00
CODE_0CE793:
	LDY.b $00
	LDA.w DATA_0CE768,y
	STA.b $02
	LDA.w DATA_0CE76E,y
	STA.b $04
	LDY.b $18,x
	LDA.w $7BB6,y
	ASL
	CLC
	ADC.w $70E2,y
	STA.w $70E2,x
	LDY.b $19,x
	BNE.b CODE_0CE7E8
	LDY.b $18,x
	PHX
	LDX.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	BMI.b CODE_0CE7BC
	INX
	INX
CODE_0CE7BC:
	LDA.w DATA_0CE758,x
	STA.b $00
	TXA
	PLX
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w $7A36,x
	SEC
	SBC.w #$00A0
	CMP.w $70E2,x
	BPL.b CODE_0CE7FD
	LDY.b $18,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	CLC
	ADC.w #$FFF4
	CLC
	ADC.b $02
	CLC
	ADC.b $78,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STZ.b $78,x
	BRA.b CODE_0CE7FD

CODE_0CE7E8:
	LDY.b $18,x
	LDA.w #$FFF4
	CLC
	ADC.b $02
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	PHX
	LDX.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDA.w DATA_0CE758,x
	STA.b $00
	PLX
CODE_0CE7FD:
	LDA.w $7A96,x
	BNE.b CODE_0CE81A
	SEP.b #$20
	DEC.b $76,x
	BPL.b CODE_0CE80C
	LDA.b #$05
	STA.b $76,x
CODE_0CE80C:
	LDY.b $76,x
	LDA.b ($00),y
	STA.w $7402,x
	LDA.b $04
	STA.w $7A96,x
	REP.b #$20
CODE_0CE81A:
	RTL

CODE_0CE81B:
	LDX.b $12
	LDY.b $18,x
	LDA.w $7A36,x
	SEC
	SBC.w #$0030
	CMP.w $70E2,y
	BPL.b CODE_0CE850
	STZ.w $7400,x
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$02
	STA.b $16,x
	LDA.b #$06
	STA.b $76,x
	TAY
	LDA.w DATA_0CE5E2,y
	STA.w $7402,x
	LDA.b #$01
	STA.w $7A96,x
	STZ.b $77,x
	REP.b #$20
	PLA
	RTL

CODE_0CE850:
	RTS

CODE_0CE851:
	LDX.b $12
	LDY.b $18,x
	LDA.w $7A36,x
	SEC
	SBC.w #$003E
	CMP.w $70E2,y
	BPL.b CODE_0CE886
	STZ.w $7400,x
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$02
	STA.b $16,x
	LDA.b #$06
	STA.b $76,x
	TAY
	LDA.w DATA_0CE5E2,y
	STA.w $7402,x
	LDA.b #$01
	STA.w $7A96,x
	STZ.b $77,x
	REP.b #$20
	PLA
	RTL

CODE_0CE886:
	RTS

DATA_0CE887:
DATA_roger_pusher_pause_phase_ptr:              ; 2-entry pushing-paused phase ptr (collision-test / clean-up)
	dw CODE_0CE88B
	dw CODE_0CE8EE

CODE_0CE88B:
	LDX.b $12
	LDY.b $18,x
	LDA.w $7BB8,x
	CLC
	ADC.w $7BB8,y
	STA.b $00
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	BPL.b CODE_0CE8A5
	EOR.w #$FFFF
	INC
CODE_0CE8A5:
	CMP.b $00
	BCS.b CODE_0CE8ED
	LDA.w $7BB6,x
	CLC
	ADC.w $7BB6,y
	STA.b $00
	LDA.w $70E2,x
	SEC
	SBC.w $70E2,y
	BMI.b CODE_0CE8ED
	SEC
	SBC.b $00
	STA.b $02
	BEQ.b CODE_0CE8C4
	BPL.b CODE_0CE8ED
CODE_0CE8C4:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $70E2,x
	CLC
	ADC.b $02
	STA.w $70E2,x
	STZ.w $7402,x
	SEP.b #$20
	LDA.b #$05
	STA.b $76,x
	TAY
	LDA.w DATA_0CE75C,y
	STA.w $7402,x
	LDA.b #$08
	STA.w $7A96,x
	INC.b $77,x
	INC.b $77,x
	REP.b #$20
	PLA
	RTL

CODE_0CE8ED:
	RTS

CODE_0CE8EE:
	LDX.b $12
	LDY.b $18,x
	LDA.w $7BB8,x
	CLC
	ADC.w $7BB8,y
	STA.b $00
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	BPL.b CODE_0CE908
	EOR.w #$FFFF
	INC
CODE_0CE908:
	CMP.b $00
	BCS.b CODE_0CE94E
	LDA.w $7BB6,x
	CLC
	ADC.w $7BB6,y
	STA.b $00
	LDA.w $70E2,x
	SEC
	SBC.w $70E2,y
	BMI.b CODE_0CE94E
	SEC
	SBC.b $00
	STA.b $02
	BEQ.b CODE_0CE927
	BPL.b CODE_0CE94E
CODE_0CE927:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $70E2,x
	CLC
	ADC.b $02
	STA.w $70E2,x
	LDA.w $7402,y
	STA.w $7402,x
	SEP.b #$20
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	STA.b $76,x
	LDA.w $7A96,y
	STA.w $7A96,x
	INC.b $77,x
	INC.b $77,x
	REP.b #$20
	PLA
	RTL

CODE_0CE94E:
	RTS

CODE_0CE94F:
	LDA.w $7682,x
	CLC
	ADC.w #$0050
	CMP.w #$0190
	BCC.b CODE_0CE960
	PLA
	JML.l CODE_03A31E

CODE_0CE960:
	RTS

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $1AF: Floating coin. Raiden: CODE_init_coin.
;---------------------------------------------------------------------------
YI_NorSpr1AF_FloatingCoin_Init:
init_floating_coin:
;$0CE961
	JSL.l CODE_03D3F8
	BEQ.b CODE_0CE96B
	JML.l CODE_03A31E

CODE_0CE96B:
	LDA.w !RAM_YI_Level_LevelHeaderSpritePaletteLo
	CMP.w #$0002
	BNE.b CODE_0CE97C
	LDA.w $7042,x
	ORA.w #$000E
	STA.w $7042,x
CODE_0CE97C:
	STZ.w $7400,x
	LDA.b $14
	LSR
	LSR
	LSR
	AND.w #$0003
	STA.w $7402,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $1AF main. Raiden: main_coin.
;---------------------------------------------------------------------------
YI_NorSpr1AF_FloatingCoin_Main:
main_floating_coin:
;$0CE98B
	LDA.b $14
	LSR
	LSR
	LSR
	AND.w #$0003
	STA.w $7402,x
	LDY.w $7D36,x
	BEQ.b CODE_0CE9BF
	BMI.b CODE_0CE9C0
	DEY
	BEQ.b CODE_0CE9BF
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CE9BF
	LDA.w $7D38,y
	BEQ.b CODE_0CE9BF
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr107_WatermelonSeed
	BEQ.b CODE_0CE9C0
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_0CE9BF
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BCC.b CODE_0CE9C0
CODE_0CE9BF:
	RTL

CODE_0CE9C0:
	LDA.w $70E2,x
	STA.w $0000
	LDA.w $7182,x
	STA.w $0002
	JSL.l CODE_03A520
	LDA.w #!Define_YI_SoundID09_Coin
	JSL.l CODE_push_sound_queue
	JSL.l CODE_03D3EB
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
	JML.l CODE_despawn_sprite_free_slot

;---------------------------------------------------------------------------

DATA_0CE9FE:
	dw $0004,$0002,$000E,$000C

;---------------------------------------------------------------------------
; Sprite $065: Red coin. Raiden: init_red_coin.
;---------------------------------------------------------------------------
YI_NorSpr065_RedCoin_Init:
init_red_coin:
;$0CEA06
	JSL.l CODE_03D3F8
	BEQ.b CODE_0CEA10
	JML.l CODE_03A31E

CODE_0CEA10:
	STZ.w $7400,x
	LDY.b #$00
	LDA.w !RAM_YI_Level_LevelHeaderSpritePaletteLo
	CMP.w #$0002
	BNE.b CODE_0CEA1F
	LDY.b #$04
CODE_0CEA1F:
	STY.b $18,x
	LDA.w !EXRAM_YI_Level_ShowHiddenItemsFlag|!EXRAMBankMirror
	BEQ.b CODE_0CEA28
	INY
	INY
CODE_0CEA28:
	LDA.w $7042,x
	AND.w #$FFF1
	ORA.w DATA_0CE9FE,y
	STA.w $7042,x
	LDA.b $14
	LSR
	LSR
	LSR
	AND.w #$0003
	STA.w $7402,x
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $065 main. Raiden: main_red_coin.
;---------------------------------------------------------------------------
YI_NorSpr065_RedCoin_Main:
main_red_coin:
;$0CEA40
	LDY.b $18,x
	LDA.w !EXRAM_YI_Level_ShowHiddenItemsFlag|!EXRAMBankMirror
	BEQ.b CODE_0CEA49
	INY
	INY
CODE_0CEA49:
	LDA.w $7042,x
	AND.w #$FFF1
	ORA.w DATA_0CE9FE,y
	STA.w $7042,x
	LDA.b $14
	LSR
	LSR
	LSR
	AND.w #$0003
	STA.w $7402,x
	LDY.w $7D36,x
	BEQ.b CODE_0CEA89
	BMI.b CODE_0CEA8A
	DEY
	BEQ.b CODE_0CEA89
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CEA89
	LDA.w $7D38,y
	BEQ.b CODE_0CEA89
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr107_WatermelonSeed
	BEQ.b CODE_0CEA8A
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_0CEA89
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BCC.b CODE_0CEA8A
CODE_0CEA89:
	RTL

CODE_0CEA8A:
	JSL.l CODE_0CEAA5
	JML.l CODE_despawn_sprite_free_slot

CODE_0CEA92:
	PHB
	PHK
	PLB
	PHD
	LDA.w #$7960
	TCD
	JSL.l CODE_0CEAA5
	JSL.l CODE_despawn_sprite_free_slot
	PLD
	PLB
	RTL

CODE_0CEAA5:
	JSL.l CODE_03D3EB
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
	LDY.b $18,x
	INY
	INY
	LDA.w DATA_0CE9FE,y
	JSL.l CODE_03B35B
	RTL

DATA_0CEAD4:
	dw CODE_0CECEC
	dw CODE_0CECEC
	dw CODE_0CECEC
	dw CODE_0CECEC
	dw CODE_0CECEC
	dw CODE_0CECEC

DATA_0CEAE0:
	dw CODE_0CED7B
	dw CODE_0CED7B
	dw CODE_0CED7B
	dw CODE_0CED7B
	dw CODE_0CED7B
	dw CODE_0CED7B

;---------------------------------------------------------------------------

DATA_0CEAEC:
	dw $0004,$0004,$0004,$0004,$0004,$0004

DATA_0CEAF8:
	dw DATA_0CEE64,DATA_0CEE64,DATA_0CEE64,DATA_0CEE64,DATA_0CEE64,DATA_0CEE64

DATA_0CEB04:
	dw DATA_0CEF14,DATA_0CEF14,DATA_0CEF14,DATA_0CEF14,DATA_0CEF14,DATA_0CEF14

;---------------------------------------------------------------------------
; Sprite $1B0: Deflating BG3 balloon. Raiden: init_balloon_bg3.
;---------------------------------------------------------------------------
YI_NorSpr1B0_InflatingBG3Balloon_Init:           ; friendly alias of YI_NorSpr1B0_DeflatingBalloon_Init (template name inverts actual behavior)
YI_NorSpr1B0_DeflatingBalloon_Init:
init_balloon_bg3:
;$0CEB10
	STZ.b $16,x
	LDA.w $7182,x
	STA.b $78,x
	LDA.w #$0030
	STA.w $6126
	LDA.w $7042,x
	AND.w #$FFCF
	ORA.w #$0030
	STA.w $7042,x
	LDA.w !RAM_YI_Global_MainScreenLayers
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !RAM_YI_Level_LevelHeaderBG2TilesetLo
	CMP.w #$0016
	BNE.b CODE_0CEB67
	LDY.b #!REGISTER_BG2HorizScrollOffset
	STY.w HDMA[$03].Destination
	LDY.b #!REGISTER_BG2VertScrollOffset
	STY.w HDMA[$04].Destination
	LDX.b #$1E
CODE_0CEB43:
	LDA.l DATA_5FCD6A,x
	STA.l $702E2E,x
	STA.l YI_Global_PaletteMirror[$61].LowByte,x
	DEX
	DEX
	BPL.b CODE_0CEB43
	LDX.b #$1E
CODE_0CEB55:
	LDA.l DATA_5FCD6A,x
	STA.l $702E4E,x
	STA.l YI_Global_PaletteMirror[$71].LowByte,x
	DEX
	DEX
	BPL.b CODE_0CEB55
	BRA.b CODE_0CEB79

CODE_0CEB67:
	LDX.b #$08
CODE_0CEB69:
	LDA.l DATA_5FE34C,x
	STA.l $702D6C,x
	STA.l YI_Global_PaletteMirror[$00].LowByte,x
	DEX
	DEX
	BNE.b CODE_0CEB69
CODE_0CEB79:
	LDX.b $12
	LDA.w !RAM_YI_Global_MainScreenLayers
	ORA.w !RAM_YI_Global_SubScreenLayers
	AND.w #$000F
	XBA
	ORA.w #$0010
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.w #$0002
	STA.w $7542,x
	LDA.w #$0040
	STA.w $75E2,x
	LDA.w $70E2,x
	SEC
	SBC.w !RAM_YI_Global_Layer1XPosLo
	STA.w $7680,x
	LDA.w $7182,x
	SEC
	SBC.w !RAM_YI_Global_Layer1YPosLo
	STA.w $7682,x
	JSR.w CODE_0CEDE1
	JSR.w CODE_0CED94
	RTL

;---------------------------------------------------------------------------

DATA_0CEBB2:
	dw $0014,$000A

DATA_0CEBB6:
	dw $0001,$FFFF

;---------------------------------------------------------------------------
; Sprite $1B0 main. Raiden: main_balloon_bg3.
;---------------------------------------------------------------------------
YI_NorSpr1B0_InflatingBG3Balloon_Main:           ; friendly alias of YI_NorSpr1B0_DeflatingBalloon_Main (template name inverts actual behavior)
YI_NorSpr1B0_DeflatingBalloon_Main:
main_balloon_bg3:
;$0CEBBA
	JSR.w CODE_0CEDE1
	JSR.w CODE_0CED94
	LDA.b $12
	AND.w #$00FF
	STA.w $6012
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w !RAM_YI_Global_Layer1XPosLo
	STA.w $6014
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w !RAM_YI_Global_Layer1YPosLo
	STA.w $6016
	LDA.w $60C2
	STA.w $6018
	LDX.b #FXCODE_0A8390>>16
	LDA.w #FXCODE_0A8390
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	JSL.l CODE_03AF23
	LDA.w $601A
	BNE.b CODE_0CEBF9
	JMP.w CODE_0CEC71

CODE_0CEBF9:
	BIT.w #$0001
	BEQ.b CODE_0CEC3E
	LDA.w $60AA
	BMI.b CODE_0CEC3E
	STZ.w $60D4
	LDA.w #$0001
	STA.w $61B4
	LDA.b $18,x
	BNE.b CODE_0CEC20
	LDY.b #$04
	STY.b $18,x
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7A96,x
CODE_0CEC20:
	LDA.w #$0200
	STA.w $60AA
	LDA.w $601C
	CLC
	ADC.w #$0002
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C0,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_0CEC3E:
	LDA.w $601A
	AND.w #$001E
	BEQ.b CODE_0CEC71
	PHA
	PHA
	LDY.b #$00
	LDA.w $60A8
	BMI.b CODE_0CEC51
	INY
	INY
CODE_0CEC51:
	PLA
	AND.w DATA_0CEBB2,y
	BEQ.b CODE_0CEC5D
	STZ.w $60A8
	STZ.w $60B4
CODE_0CEC5D:
	PLA
	LDY.b #$00
	AND.w #$0014
	BNE.b CODE_0CEC67
	INY
	INY
CODE_0CEC67:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_0CEBB6,y
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_0CEC71:
	LDA.w $61B2
	ORA.w $61CC
	BNE.b CODE_0CECB0
	LDA.w $6014
	BEQ.b CODE_0CECB0
	BIT.w #$0001
	BEQ.b CODE_0CEC8E
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	BMI.b CODE_0CEC8E
	LDA.w #$0001
	TSB.w $7860
CODE_0CEC8E:
	LDA.w $6014
	AND.w #$001E
	BEQ.b CODE_0CECB0
	PHA
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	BMI.b CODE_0CECA0
	INY
	INY
CODE_0CECA0:
	PLA
	AND.w DATA_0CEBB2,y
	BEQ.b CODE_0CECB0
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
CODE_0CECB0:
	LDY.b $18,x
	TYX
	JMP.w (DATA_deflating_balloon_state_ptr,x)

DATA_0CECB6:
DATA_deflating_balloon_state_ptr:               ; 4-entry Deflating Balloon state ptr (inflate / drift / pop / cleanup)
	dw CODE_0CECBE
	dw CODE_0CECE0
	dw CODE_0CECE6
	dw CODE_0CECDD

CODE_0CECBE:
	LDX.b $12
	LDA.w $75E2,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0CECCD
	EOR.w #$FFFF
	INC
CODE_0CECCD:
	CMP.w $7542,x
	BCS.b CODE_0CECDC
	LDA.w $75E2,x
	EOR.w #$FFFF
	INC
	STA.w $75E2,x
CODE_0CECDC:
	RTL

CODE_0CECDD:
	LDX.b $12
	RTL

CODE_0CECE0:
	LDX.w !RAM_YI_Level_CurrentWorldLo
	JMP.w (DATA_0CEAD4,x)

CODE_0CECE6:
	LDX.w !RAM_YI_Level_CurrentWorldLo
	JMP.w (DATA_0CEAE0,x)

CODE_0CECEC:
	LDX.b $12
	LDA.w $7A98,x
	BNE.b CODE_0CED2F
	LDA.w #$0010
	STA.w $7A98,x
	LDA.w #!Define_YI_SoundID16_DeflateBalloon
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr1DF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	CLC
	ADC.w #$FFF8
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
CODE_0CED2F:
	LDA.w $7A96,x
	BNE.b CODE_0CED5B
	LDA.b $16,x
	SEC
	SBC.w #$0001
	BPL.b CODE_0CED53
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	INC.b $18,x
	INC.b $18,x
	INC.b $18,x
	INC.b $18,x
	STZ.b $16,x
	RTL

CODE_0CED53:
	STA.b $16,x
	LDA.w #$0008
	STA.w $7A96,x
CODE_0CED5B:
	LDY.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_0CEAEC,y
	STA.w $7542,x
CODE_0CED64:
	LDY.b #$00
	LDA.w $7182,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	BPL.b CODE_0CED70
	INY
	INY
CODE_0CED70:
	LDA.w DATA_0CED77,y
	STA.w $75E2,x
	RTL

DATA_0CED77:
	dw $FF00,$0100

CODE_0CED7B:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CED8C
	LDA.w #$0180
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b #$02
	STY.b $18,x
CODE_0CED8C:
	LDA.w #$0008
	STA.w $7542,x
	BRA.b CODE_0CED64

CODE_0CED94:
	LDA.w $7680,x
	CLC
	ADC.w #$00F0
	CMP.w #$0240
	BCC.b CODE_0CEDAE
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !RAM_YI_Global_MainScreenLayers
	STZ.w $0CB2
	PLA
	JML.l CODE_03A31E

CODE_0CEDAE:
	CMP.w #$0200
	BCC.b CODE_0CEDCA
	LDA.w !RAM_YI_Level_LevelHeaderBG2TilesetLo
	CMP.w #$0016
	BNE.b CODE_0CEDC0
	LDA.w #$0002
	BRA.b CODE_0CEDC3

CODE_0CEDC0:
	LDA.w #$0004
CODE_0CEDC3:
	TRB.w !RAM_YI_Global_MainScreenLayers
	TRB.w !RAM_YI_Global_SubScreenLayers
	RTS

CODE_0CEDCA:
	LDA.w !RAM_YI_Level_LevelHeaderBG2TilesetLo
	CMP.w #$0016
	BNE.b CODE_0CEDD7
	LDA.w #$0002
	BRA.b CODE_0CEDDA

CODE_0CEDD7:
	LDA.w #$0004
CODE_0CEDDA:
	TSB.w !RAM_YI_Global_MainScreenLayers
	TSB.w !RAM_YI_Global_SubScreenLayers
	RTS

CODE_0CEDE1:
	LDA.w #$49F6
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$4B36
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$002C
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$449E
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $16,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_0CEB04,y
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_0CEF14>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w DATA_0CEAF8,y
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w #DATA_0CEE64>>16
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7680,x
	CLC
	ADC.w #$0010
	STA.w $6040
	LDA.w $7682,x
	CLC
	ADC.w #$0006
	STA.w $6042
	LDX.b #FXCODE_08E865>>16
	LDA.w #FXCODE_08E865
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	LDA.w !RAM_YI_Level_LevelHeaderBG2TilesetLo
	CMP.w #$0016
	BNE.b CODE_0CEE55
	LDA.w #$0002
	BRA.b CODE_0CEE58

CODE_0CEE55:
	LDA.w #$0004
CODE_0CEE58:
	TSB.w !RAM_YI_Global_MainScreenLayers
	LDA.w #$0018
	TSB.w !RAM_YI_Global_HDMAEnable
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

DATA_0CEE64:
	dw $0000,$0000,$0003,$FFF5,$0008,$FFEB,$000E,$FFE1
	dw $0015,$FFDA,$001C,$FFD3,$0023,$FFCE,$002C,$FFC9
	dw $0034,$FFC5,$003B,$FFC3,$0046,$FFC1,$0050,$FFC1
	dw $005D,$FFC2,$0064,$FFC4,$006B,$FFC7,$0074,$FFCC
	dw $007C,$FFD3,$0081,$FFD8,$0086,$FFDF,$008B,$FFE9
	dw $008E,$FFF3,$008F,$0000,$008F,$0008,$008D,$0012
	dw $008B,$0018,$0087,$0020,$0081,$0029,$007C,$002E
	dw $0075,$0034,$006D,$0039,$0067,$003C,$005D,$003F
	dw $0050,$0040,$0046,$0040,$003B,$003E,$0032,$003B
	dw $002A,$0037,$0023,$0033,$001C,$002E,$0016,$0028
	dw $0011,$0023,$000C,$001D,$0008,$0016,$0003,$000C

DATA_0CEF14:
	dw $0000,$0000,$0000,$FFFF,$0000,$FFFE,$0001,$FFFD
	dw $0001,$FFFC,$0002,$FFFB,$0003,$FFFA,$0004,$FFFA
	dw $0005,$FFF9,$0006,$FFF9,$0007,$FFF9,$0008,$FFF9
	dw $0009,$FFF9,$000A,$FFF9,$000B,$FFFA,$000C,$FFFA
	dw $000D,$FFFB,$000E,$FFFC,$000E,$FFFD,$000F,$FFFE
	dw $000F,$FFFF,$000F,$0000,$000F,$0001,$000F,$0002
	dw $000F,$0003,$000E,$0004,$000E,$0005,$000D,$0006
	dw $000C,$0007,$000B,$0007,$000A,$0008,$0009,$0008
	dw $0008,$0008,$0007,$0008,$0006,$0008,$0005,$0008
	dw $0004,$0007,$0003,$0007,$0002,$0006,$0001,$0005
	dw $0001,$0004,$0000,$0003,$0000,$0002,$0000,$0001

;---------------------------------------------------------------------------
; Sprite $073: Red BG3 balloon pumper. Raiden: init_balloon_pumper_red_bg3.
;---------------------------------------------------------------------------
YI_NorSpr073_BalloonPump_Init:
init_balloon_pumper_red_bg3:
;$0CEFC4
	JSL.l CODE_03AE60
	LDA.w $0CB2
	BNE.b CODE_0CEFD6
	LDA.w #$01B0
	JSL.l CODE_spawn_sprite_init
	BCS.b CODE_0CEFDA
CODE_0CEFD6:
	JML.l CODE_03A31E

CODE_0CEFDA:
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	INC.w $0CB2
	LDA.w $70E2,x
	CLC
	ADC.w #$0010
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0004
	STA.w $7182,y
	STY.b $78,x
	LDA.w #$0100
	STA.b $16,x
	JML.l CODE_028048

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $073 main. Raiden: main_balloon_pumper_red_bg3.
;---------------------------------------------------------------------------
YI_NorSpr073_BalloonPump_Main:
main_balloon_pumper_red_bg3:
;$0CF005
	LDA.w $7362,x
	INC
	INC
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $16,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_088ED3>>16
	LDA.w #FXCODE_088ED3
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	REP.b #$10
	LDY.w $6002
	JSL.l CODE_03AA60
	SEP.b #$10
	LDY.w $74A2,x
	BMI.b CODE_0CF036
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_0CF036
	JSL.l CODE_028048
CODE_0CF036:
	JSL.l CODE_03AF23
	JSR.w CODE_0CF147
	STZ.b $0E
	LDA.w $7C18,x
	CLC
	ADC.w $6000
	CMP.w #$0022
	BPL.b CODE_0CF05C
	STA.w $7C18,x
	JSL.l CODE_03D129
	LDA.b $0E
	BEQ.b CODE_0CF05C
	LDA.w #$0400
	STA.w $60AA
CODE_0CF05C:
	LDY.b $18,x
	TYX
	JMP.w (DATA_balloon_pump_state_ptr,x)

DATA_0CF062:
DATA_balloon_pump_state_ptr:                    ; 3-entry Balloon Pump state ptr (idle / pumping / cleanup)
	dw CODE_0CF06C
	dw CODE_0CF0A9
	dw CODE_0CF135

DATA_0CF068:                                    ; flavor: data (followed by dw); CODE_ name is a documentation bug
	dw $FFFC,$FFE0

CODE_0CF06C:
	LDX.b $12
	LDA.b $0E
	BEQ.b CODE_0CF098
	LDY.b #$00
	LDA.w $60D4
	BEQ.b CODE_0CF07E
	STZ.w $60D4
	INY
	INY
CODE_0CF07E:
	STY.b $19,x
	LDA.w DATA_0CF068,y
	STA.b $76,x
	STZ.w $7A36,x
	LDA.w #!Define_YI_SoundID96_BalloonPump
	JSL.l CODE_push_sound_queue
	SEP.b #$20
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
	RTL

CODE_0CF098:
	LDA.b $16,x
	CLC
	ADC.w #$0010
	CMP.w #$0100
	BCC.b CODE_0CF0A6
	LDA.w #$0100
CODE_0CF0A6:
	STA.b $16,x
	RTL

CODE_0CF0A9:
	LDX.b $12
	LDA.b $0E
	BNE.b CODE_0CF0B8
	SEP.b #$20
	DEC.b $18,x
	DEC.b $18,x
	REP.b #$20
	RTL

CODE_0CF0B8:
	LDA.b $16,x
	CLC
	ADC.b $76,x
	CMP.w #$0020
	BCS.b CODE_0CF0C5
	LDA.w #$0020
CODE_0CF0C5:
	STA.b $16,x
	LDA.b $76,x
	CLC
	ADC.w #$0002
	CMP.w #$FFFC
	BMI.b CODE_0CF0D5
	LDA.w #$FFFC
CODE_0CF0D5:
	STA.b $76,x
	LDA.b $16,x
	CMP.w #$0020
	BEQ.b CODE_0CF134
	LDA.b $76,x
	EOR.w #$FFFF
	INC
	ASL
	ASL
	ASL
	ASL
	ASL
	ASL
	NOP #2
	LDY.b $19,x
	BEQ.b CODE_0CF0F1
	ASL
CODE_0CF0F1:
	CLC
	ADC.w $7A36,x
	STA.b $00
	AND.w #$00FF
	STA.w $7A36,x
	LDY.b $78,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CF134
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr1B0_DeflatingBalloon
	BNE.b CODE_0CF134
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	AND.w #$00FF
	BNE.b CODE_0CF134
	LDA.b $00
	AND.w #$FF00
	XBA
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	CMP.w #$0100
	BCC.b CODE_0CF131
	SEP.b #$20
	INC.b $18,x
	INC.b $18,x
	REP.b #$20
	LDA.w #$0100
CODE_0CF131:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
CODE_0CF134:
	RTL

CODE_0CF135:
	LDX.b $12
	LDA.b $16,x
	CLC
	ADC.b $76,x
	CMP.w #$0020
	BCS.b CODE_0CF144
	LDA.w #$0020
CODE_0CF144:
	STA.b $16,x
	RTL

CODE_0CF147:
	LDA.w $7680,x
	CLC
	ADC.w #$0050
	CMP.w #$0190
	BCS.b CODE_0CF160
	LDA.w $7682,x
	CLC
	ADC.w #$0050
	CMP.w #$0190
	BCS.b CODE_0CF160
CODE_0CF15F:
	RTS

CODE_0CF160:
	LDY.b $78,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CF177
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr1B0_DeflatingBalloon
	BNE.b CODE_0CF177
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	BEQ.b CODE_0CF15F
CODE_0CF177:
	PLA
	JML.l CODE_03A31E

;---------------------------------------------------------------------------

DATA_0CF17C:
	db $00,$01,$02,$03,$04,$05,$00,$01,$02,$03,$04,$05,$00,$01,$02,$03

;---------------------------------------------------------------------------
; Sprite $072: Train Bandit. Raiden: init_train_bandit.
;---------------------------------------------------------------------------
YI_NorSpr072_TrainBandit_Init:
init_train_bandit:
;$0CF18C
	SEP.b #$20
	LDA.b $10
	AND.b #$0F
	TAY
	LDA.w DATA_0CF17C,y
	STA.w $7402,x
	REP.b #$20
	RTL

;---------------------------------------------------------------------------

DATA_0CF19C:
	db $FF,$00,$1F,$FF,$02,$1F,$00,$00,$20,$00,$00,$21,$00,$00,$22,$00
	db $00,$23,$00,$00,$24,$00,$00,$25,$00,$00,$26,$00,$00,$27,$00,$00
	db $28,$FF,$01,$68,$FF,$02,$68,$FF,$01,$69,$FF,$02,$69,$FF,$01,$71
	db $FF,$02,$71,$FF,$C2,$00,$00,$00,$9E

;---------------------------------------------------------------------------
; Sprite $072 main. Raiden: main_train_bandit.
;---------------------------------------------------------------------------
YI_NorSpr072_TrainBandit_Main:
main_train_bandit:
;$0CF1D5
	JSL.l CODE_03AF23
	LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerForm08_Train
	BNE.b CODE_0CF1EB
	LDA.w $61D6
	BNE.b CODE_0CF1EB
	LDA.w $6180
	BNE.b CODE_0CF1FB
CODE_0CF1EB:
	STZ.w $7A98,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7AF6,x
CODE_0CF1FA:
	RTL

CODE_0CF1FB:
	LDA.w $7AF6,x
	BNE.b CODE_0CF1FA
	JSR.w CODE_0CF2F9
	JSR.w CODE_0CF260
	JSR.w CODE_0CF2A1
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0CF214
	EOR.w #$FFFF
	INC
CODE_0CF214:
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0CF21F
	EOR.w #$FFFF
	INC
CODE_0CF21F:
	CMP.b $00
	BPL.b CODE_0CF234
	PHY
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0CF22D
	INY
	INY
CODE_0CF22D:
	TYA
	STA.w $7400,x
	PLY
	BRA.b CODE_0CF23D

CODE_0CF234:
	INY
	INY
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0CF23D
	INY
	INY
CODE_0CF23D:
	TYA
	STA.b $00
	LDA.w $7402,x
	AND.w #$0001
	ORA.b $00
	STA.w $7402,x
	LDA.w $7A96,x
	BNE.b CODE_0CF25F
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
	LDA.w #$0008
	STA.w $7A96,x
CODE_0CF25F:
	RTL

CODE_0CF260:
	LDA.w $7A98,x
	BNE.b CODE_0CF2A0
	LDA.w $611C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $611E
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7CD6,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0080
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0008
	STA.w $7A98,x
CODE_0CF2A0:
	RTS

CODE_0CF2A1:
	LDY.w $7D36,x
	BPL.b CODE_0CF2AA
	JSL.l CODE_03A858
CODE_0CF2AA:
	PHX
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_0CF2A0
	BEQ.b CODE_0CF2A0
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr072_TrainBandit
	BNE.b CODE_0CF2A0
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0CF2DE
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0CF2DE:
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	EOR.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0CF2F4
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0CF2F4:
	RTS

DATA_0CF2F5:
	dw $0001,$FFFF

CODE_0CF2F9:
	LDA.w #DATA_0CF19C>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_0CF19C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0013
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_0AE9AE>>16
	LDA.w #FXCODE_0AE9AE
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	AND.w #$000F
	CMP.w #$000F
	BEQ.b CODE_0CF386
	LDY.b #$00
	AND.w #$0008
	BNE.b CODE_0CF333
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0CF342
CODE_0CF333:
	INY
	INY
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	AND.w #$0004
	BNE.b CODE_0CF355
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0CF355
CODE_0CF342:
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_0CF2F5,y
	STA.w $70E2,x
	BRA.b CODE_0CF384

CODE_0CF355:
	LDY.b #$00
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	AND.w #$0002
	BNE.b CODE_0CF364
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0CF373
CODE_0CF364:
	INY
	INY
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	AND.w #$0001
	BNE.b CODE_0CF386
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0CF386
CODE_0CF373:
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7182,x
	CLC
	ADC.w DATA_0CF2F5,y
	STA.w $7182,x
CODE_0CF384:
	PLA
	RTL

CODE_0CF386:
	RTS

;---------------------------------------------------------------------------

DATA_0CF387:
	dw $FFC0,$0040

;---------------------------------------------------------------------------
; Sprite $12C: Fly Guy / Whirly Guy. Raiden: init_fly_guy.
;---------------------------------------------------------------------------
YI_NorSpr12C_FlyOrWhirlyGuy_Init:
init_fly_guy:
;$0CF38B
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0CF3BF
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
	SEP.b #$20
	LDA.w $70E2,x
	AND.b #$10
	LSR
	LSR
	LSR
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TAY
	REP.b #$20
CODE_0CF3BF:
	DEY
	TYX
	JMP.w (DATA_fly_guy_init_variant_ptr,x)

DATA_0CF3C4:
DATA_fly_guy_init_variant_ptr:                  ; 2-entry Fly Guy / Whirly Guy init variant (by spawn-bit: fly / whirl)
	dw CODE_0CF3C8
	dw CODE_0CF405

CODE_0CF3C8:
	LDX.b $12
	JSL.l CODE_03D3F8
	BEQ.b CODE_0CF3D4
	JML.l CODE_03A31E

CODE_0CF3D4:
	LDA.w $70E2,x
	STA.w $7A36,x
	LDA.w $7182,x
	STA.w $7A38,x
	LDY.w $7400,x
	LDA.w DATA_0CF387,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0080
	STA.w $75E2,x
	LDA.w #$0004
	STA.w $7542,x
	LDA.w #$3106
	STA.w $7040,x
	LDA.w $7042,x
	ORA.w #$0002
	STA.w $7042,x
	RTL

CODE_0CF405:
	LDX.b $12
	LDA.w #$0020
	STA.w $7542,x
	LDA.w #$0200
	STA.w $75E2,x
	LDA.w $6FA2,x
	ORA.w #$0001
	STA.w $6FA2,x
	LDA.w #$2906
	STA.w $7040,x
	RTL

;---------------------------------------------------------------------------

DATA_0CF423:
	dw DATA_0CF87B,DATA_0CF8F3

DATA_0CF427:
	dw $0200,$FE00

;---------------------------------------------------------------------------
; Sprite $12C main. Raiden: main_fly_guy.
;---------------------------------------------------------------------------
YI_NorSpr12C_FlyOrWhirlyGuy_Main:
main_fly_guy:
;$0CF42B
	LDY.w $74A2,x
	BMI.b CODE_0CF44B
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEY
	LDA.w #DATA_0CF87B>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w DATA_0CF423,y
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_09AEC1>>16
	LDA.w #FXCODE_09AEC1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_0CF44B:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_0CF45B
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEY
	TYX
	JMP.w (DATA_fly_guy_stomp_state_ptr,x)

CODE_0CF45B:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEY
	BNE.b CODE_0CF464
	JSR.w CODE_0CF477
CODE_0CF464:
	JSL.l CODE_03AF23
	JSR.w CODE_0CF6D0
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEY
	TYX
	JMP.w (DATA_fly_guy_variant_main_ptr,x)

DATA_0CF473:
DATA_fly_guy_variant_main_ptr:                  ; 2-entry Fly/Whirly Guy variant main ptr (fly variant / whirl variant)
	dw CODE_0CF4D9
	dw CODE_0CF5EC

CODE_0CF477:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_0CF4B0
	LDA.w #$0115
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0CF4B1
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,y
	LDA.w $7042,x
	AND.w #$FFF1
	ORA.w #$0002
	STA.w $7042,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
CODE_0CF4B0:
	RTS

CODE_0CF4B1:
	LDA.w #!Define_YI_NorSpr115_Coin
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,x
	LDA.w $7042,x
	AND.w #$FFF1
	ORA.w #$0002
	STA.w $7042,x
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	PLA
	PLY
	PLA
	RTL

CODE_0CF4D9:
	LDX.b $12
	JSR.w CODE_0CF52B
	LDA.w $7A36,x
	SEC
	SBC.w #$0020
	CMP.w $70E2,x
	BMI.b CODE_0CF4EF
	LDA.w #$0002
	BRA.b CODE_0CF4FB

CODE_0CF4EF:
	CLC
	ADC.w #$0040
	CMP.w $70E2,x
	BPL.b CODE_0CF505
	LDA.w #$0000
CODE_0CF4FB:
	STA.w $7400,x
	TAY
	LDA.w DATA_0CF387,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0CF505:
	JMP.w CODE_0CF6AB

CODE_0CF508:
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_0CF526
	LDA.w #!Define_YI_SoundID3A_StompShyGuy
	JSL.l CODE_push_sound_queue
	JSL.l CODE_03B20B
	JMP.w CODE_0CF5C4

CODE_0CF526:
	JSL.l CODE_03A858
CODE_0CF52A:
	RTS

CODE_0CF52B:
	LDY.w $7D36,x
	BMI.b CODE_0CF508
	DEY
	BMI.b CODE_0CF52A
	BEQ.b CODE_0CF52A
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CF52A
	LDA.w $7D38,y
	BEQ.b CODE_0CF52A
	STZ.b $00
	LDA.w $70E2,x
	CMP.w $70E2,y
	BMI.b CODE_0CF550
	INC.b $00
	INC.b $00
CODE_0CF550:
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDX.b $12
	LDA.w #!Define_YI_SoundID09_Coin
	JSL.l CODE_push_sound_queue
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	LDA.w #$0115
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0CF5C4
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,y
	LDA.w $7042,x
	AND.w #$FFF1
	ORA.w #$0002
	STA.w $7042,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w $7040,x
	SEC
	SBC.w #$0800
	STA.w $7040,x
	LDA.w #$0020
	STA.w $7542,x
	LDA.w #$FE00
	STA.w $75E2,x
	LDY.b $00
	LDA.w DATA_0CF427,y
	STA.w $75E0,x
	LDA.w #$0002
	STA.w $7A98,x
	PLA
	RTL

CODE_0CF5C4:
	LDA.w #!Define_YI_NorSpr115_Coin
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,x
	LDA.w $7042,x
	AND.w #$FFF1
	ORA.w #$0002
	STA.w $7042,x
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	PLA
	JMP.w CODE_0CFF61

CODE_0CF5EC:
	LDX.b $12
	JSR.w CODE_0CF6E6
	SEP.b #$20
	LDA.b $17,x
	INC
	INC
	AND.b #$0E
	STA.b $17,x
	TAY
	LDA.w $7042,x
	AND.b #$F1
	ORA.b $17,x
	STA.w $7042,x
	REP.b #$20
	LDY.b $16,x
	TYX
	JMP.w (DATA_whirly_guy_state_ptr,x)

DATA_0CF60E:
DATA_whirly_guy_state_ptr:                      ; 3-entry Whirly Guy state ptr (hover / dive / recover)
	dw CODE_0CF614
	dw CODE_0CF66A
	dw CODE_0CF698

CODE_0CF614:
	LDX.b $12
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0050
	CMP.w #$00A0
	BCS.b CODE_0CF665
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_0CF665
CODE_0CF636:
	STZ.w $7542,x
	STZ.w $75E2,x
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7182,x
	SEC
	SBC.w #$0060
	STA.w $7A38,x
	LDY.w $77C2,x
	TYA
	EOR.w #$0002
	STA.w $7400,x
	LDY.b $16,x
	INY
	INY
	STY.b $16,x
CODE_0CF665:
	RTL

DATA_0CF666:
	dw $FFC0,$0040

CODE_0CF66A:
	LDX.b $12
	LDY.w $77C2,x
	TYA
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_0CF666,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7182,x
	CMP.w $7A38,x
	BPL.b CODE_0CF697
	LDA.w #$0080
	STA.w $75E2,x
	LDA.w #$0004
	STA.w $7542,x
	LDY.b $16,x
	INY
	INY
	STY.b $16,x
CODE_0CF697:
	RTL

CODE_0CF698:
	LDX.b $12
	LDY.w $77C2,x
	TYA
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_0CF666,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0CF6AB:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	EOR.w $75E2,x
	BMI.b CODE_0CF6CF
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w $75E2,x
	BPL.b CODE_0CF6C0
	EOR.w #$FFFF
	INC
CODE_0CF6C0:
	CMP.w $7542,x
	BCS.b CODE_0CF6CF
	LDA.w $75E2,x
	EOR.w #$FFFF
	INC
	STA.w $75E2,x
CODE_0CF6CF:
	RTL

CODE_0CF6D0:
	LDA.w $7A96,x
	BNE.b CODE_0CF6E5
	LDA.w #$0001
	STA.w $7A96,x
	LDA.w $7402,x
	INC
	AND.w #$0003
	STA.w $7402,x
CODE_0CF6E5:
	RTS

CODE_0CF6E6:
	LDY.w $7D36,x
	BMI.b CODE_0CF729
	DEY
	BMI.b CODE_0CF728
	BEQ.b CODE_0CF728
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CF728
	LDA.w $7D38,y
	BEQ.b CODE_0CF728
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDX.b $12
	LDA.w #!Define_YI_SoundID8F_Correct
	JSL.l CODE_push_sound_queue
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	LDY.b $16,x
	BNE.b CODE_0CF71C
	JSL.l CODE_0CF636
CODE_0CF71C:
	LDY.b $18,x
	CPY.b #$05
	BCS.b CODE_0CF725
	INY
	STY.b $18,x
CODE_0CF725:
	JSR.w CODE_0CF752
CODE_0CF728:
	RTS

CODE_0CF729:
	JSL.l CODE_03A858
	RTS

DATA_0CF72E:
	dw $0200,$0202

DATA_0CF732:
	dw $0000,$0060,$0000,$FFA0,$0080,$FF80

DATA_0CF73E:
	dw $0000,$FD60,$FD00,$FD60,$FE00,$FE00

DATA_0CF74A:
DATA_fly_guy_coin_sound_ids:                    ; sound IDs per coin-drop phase: none / coin / coin / coin-spillage
	dw !Define_YI_SoundID00_None,!Define_YI_SoundID09_Coin,!Define_YI_SoundID09_Coin,!Define_YI_SoundID18_CoinSpillage

CODE_0CF752:
	LDY.b $18,x
	BEQ.b CODE_0CF7A3
	CPY.b #$04
	BCS.b CODE_0CF7A4
	LDA.w DATA_fly_guy_coin_sound_ids,y
	PHY
	JSL.l CODE_push_sound_queue
	PLY
	LDA.w DATA_0CF72E,y
	TAY
CODE_0CF767:
	PHY
	LDA.w DATA_0CF732,y
	STA.b $00
	LDA.w DATA_0CF73E,y
	STA.b $02
	LDY.w $7400,x
	BEQ.b CODE_0CF77F
	LDA.b $00
	EOR.w #$FFFF
	INC
	STA.b $00
CODE_0CF77F:
	LDA.w #$0115
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0CF79E
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $02
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
CODE_0CF79E:
	PLY
	DEY
	DEY
	BNE.b CODE_0CF767
CODE_0CF7A3:
	RTS

CODE_0CF7A4:
	PHY
	JSL.l CODE_spawn_1up_score
	PLY
	CPY.b #$05
	BCC.b CODE_0CF7A3
	PLA
	PLA
	JML.l CODE_kill_sprite_by_hit_special_cases

DATA_0CF7B4:
DATA_fly_guy_stomp_state_ptr:                   ; 2-entry Fly Guy head-bop state ptr (drop-coin / despawn)
	dw CODE_0CF7B8
	dw CODE_0CF82F

CODE_0CF7B8:
	LDX.b $12
	LDA.w #$0115
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0CF802
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,y
	LDA.w $7042,x
	AND.w #$FFF1
	ORA.w #$0002
	STA.w $7042,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDA.w #!Define_YI_NorSpr01E_Shyguy
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0003
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC
	ORA.w $7042,x
	STA.w $7042,x
	BRA.b CODE_0CF82C

CODE_0CF802:
	STZ.w $6162
	STZ.w $6168
	LDA.w #!Define_YI_NorSpr115_Coin
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,x
	LDA.w $7042,x
	AND.w #$FFF1
	ORA.w #$0002
	STA.w $7042,x
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
CODE_0CF82C:
	PLY
	PLA
	RTL

CODE_0CF82F:
	LDX.b $12
	LDA.w #!Define_YI_NorSpr01E_Shyguy
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC
	ORA.w $7042,x
	STA.w $7042,x
	BRA.b CODE_0CF82C

;---------------------------------------------------------------------------
; Sprite $12C head-bop. Raiden: head_bop_fly_guy.
;---------------------------------------------------------------------------
YI_NorSpr12C_FlyOrWhirlyGuy_StompRt:
head_bop_fly_guy:
;$0CF848
	LDY.w $74A2,x
	BMI.b CODE_0CF868
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEY
	LDA.w #DATA_0CF8F3>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_0CF8F3
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_09A7A7>>16
	LDA.w #FXCODE_09A7A7
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_0CF868:
	JSR.w CODE_0CF6D0
	LDA.w $7A98,x
	CMP.w #$0001
	BNE.b CODE_0CF87A
	LDA.w #!Define_YI_SoundID6E_FlyGuyGettingAway
	JSL.l CODE_push_sound_queue
CODE_0CF87A:
	RTL

DATA_0CF87B:
	dw $0002,$8800,$0000,$FA08,$402C,$0000,$2CFA,$0000
	dw $0E01,$402F,$0600,$2F0E,$0240,$1000,$02A0,$0002
	dw $8800,$0000,$FA08,$402D,$0000,$2DFA,$0000,$0E01
	dw $402F,$0600,$2F0E,$0240,$1000,$02A0,$0002,$8800
	dw $0000,$FA08,$403C,$0000,$3CFA,$0000,$0E01,$402F
	dw $0600,$2F0E,$0240,$1000,$02A0,$0002,$8800,$0000
	dw $FA08,$403D,$0000,$3DFA,$0000,$0E01,$402F,$0600
	dw $2F0E,$0240,$1000,$02A0

DATA_0CF8F3:
	dw $0002,$8800,$0000,$FA00,$002C,$0800,$2CFA,$0040
	dw $0E01,$402F,$0600,$2F0E,$0240,$0000,$0088,$0000
	dw $2DFA,$0000,$FA08,$402D,$0100,$2F0E,$0040,$0E06
	dw $402F,$0002,$8800,$0000,$FA00,$003C,$0800,$3CFA
	dw $0040,$0E01,$402F,$0600,$2F0E,$0240,$0000,$0088
	dw $0000,$3DFA,$0000,$FA08,$403D,$0100,$2F0E,$0040
	dw $0E06,$402F

CODE_0CF957:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BPL.b CODE_0CF972
	PHA
	AND.w #$00FF
	ASL
	ASL
	ASL
	ASL
	STA.b $04
	PLA
	AND.w #$7F00
	LSR
	LSR
	LSR
	LSR
	JSL.l CODE_03D3F3
CODE_0CF972:
	RTL

;---------------------------------------------------------------------------

DATA_0CF973:
	dw $0409,$200A,$0409,$1008

DATA_0CF97B:
	dw $040B,$040C,$240D,$040C,$040B,$1008

DATA_0CF987:
	dw $040E,$240F,$040E,$1008

DATA_0CF98F:
	dw $2401,$1000

DATA_0CF993:
	dw $0404,$2005,$0404,$1000

DATA_0CF99B:
	dw $0406,$2007,$0406,$1000

DATA_0CF9A3:
	dw $0404,$2010,$0404,$1000

DATA_0CF9AB:
	dw $0401,$2002,$0401,$1000

DATA_0CF9B3:
	dw $0402,$2003,$0402,$1001

DATA_0CF9BB:
	dw $0400,$2004,$0400,$1001

DATA_0CF9C3:
	dw $0406,$2007,$0406,$1001

DATA_0CF9CB:
	dw DATA_0CF98F : db $02
	dw DATA_0CF993 : db $06
	dw DATA_0CF99B : db $06
	dw DATA_0CF98F : db $02
	dw DATA_0CF993 : db $06
	dw DATA_0CF98F : db $02
	dw DATA_0CF993 : db $06
	dw DATA_0CF98F : db $02

DATA_0CF9E3:
	dw DATA_0CF973 : db $06
	dw DATA_0CF97B : db $0A
	dw DATA_0CF987 : db $06
	dw DATA_0CF973 : db $06
	dw DATA_0CF97B : db $0A
	dw DATA_0CF973 : db $06
	dw DATA_0CF97B : db $0A
	dw DATA_0CF973 : db $06

DATA_0CF9FB:
	dw DATA_0CF9A3 : db $06
	dw DATA_0CF9AB : db $06
	dw DATA_0CF99B : db $06
	dw DATA_0CF9A3 : db $06
	dw DATA_0CF9AB : db $06
	dw DATA_0CF9A3 : db $06
	dw DATA_0CF9AB : db $06
	dw DATA_0CF9A3 : db $06

DATA_0CFA13:
	dw DATA_0CF9B3 : db $06
	dw DATA_0CF9BB : db $06
	dw DATA_0CF9C3 : db $06
	dw DATA_0CF9B3 : db $06
	dw DATA_0CF9BB : db $06
	dw DATA_0CF9B3 : db $06
	dw DATA_0CF9BB : db $06
	dw DATA_0CF9B3 : db $06

DATA_0CFA2B:
	dw DATA_0CF9CB,DATA_0CF9E3,DATA_0CF9E3,DATA_0CF9E3,DATA_0CF9FB,DATA_0CFA13,DATA_0CFA13,DATA_0CF9FB

DATA_0CFA3B:
	dw $000A,$000E,$000C,$0008,$0002,$0000,$0004,$0006

;---------------------------------------------------------------------------
; Sprite $12D: Yoshi sprite used only in the prologue cutscene.
; Raiden: init_yoshi_in_intro_cutscene.
;---------------------------------------------------------------------------
YI_NorSpr12D_PrologueCutsceneYoshi_Init:
init_yoshi_in_intro_cutscene:
;$0CFA4B
	LDY.b $16,x
	LDA.w $7042,x
	ORA.w DATA_0CFA3B,y
	STA.w $7042,x
	LDA.w $7182,x
	STA.b $76,x
	JMP.w CODE_0CFB20

DATA_0CFA5E:
	dw $0020,$0040,$0060,$0080

DATA_0CFA66:
	dw $0004,$0008,$000C,$0010

;---------------------------------------------------------------------------
; Sprite $12D main. Raiden: main_yoshi_in_intro_cutscene.
;---------------------------------------------------------------------------
YI_NorSpr12D_PrologueCutsceneYoshi_Main:
main_yoshi_in_intro_cutscene:
;$0CFA6E
	JSR.w CODE_0CFB64
	LDY.b $16,x
	TYX
	JMP.w (DATA_prologue_yoshi_state_ptr,x)

DATA_0CFA77:
DATA_prologue_yoshi_state_ptr:                  ; 8-entry Prologue Cutscene Yoshi state ptr (intro / posed-frames; idx 1-7 collapse to same handler)
	dw CODE_0CFA87
	dw CODE_0CFAB0
	dw CODE_0CFAB0
	dw CODE_0CFAB0
	dw CODE_0CFAB0
	dw CODE_0CFAB0
	dw CODE_0CFAB0
	dw CODE_0CFAB0

CODE_0CFA87:
	LDX.b $12
	LDA.w $0D27
	CMP.w #$0004
	BCS.b CODE_0CFA94
	JMP.w CODE_0CFAED

CODE_0CFA94:
	LDA.w #!Define_YI_PlayerState04
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$0003
	STA.w $611A
	LDA.w $70E2,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $7182,x
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	JML.l CODE_03A31E

CODE_0CFAB0:
	LDX.b $12
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CMP.w #$01C8
	BCC.b CODE_0CFAED
	LDA.w #$0002
	STA.w $7400,x
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_0CFADF
	LDA.w #$0012
	STA.w $7402,x
	LDA.w $7A98,x
	BNE.b CODE_0CFAEC
	LDA.w #$0011
	STA.w $7402,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0CFADF:
	LDA.b $10
	AND.w #$0003
	ASL
	TAY
	LDA.w DATA_0CFA66,y
	STA.w $7A98,x
CODE_0CFAEC:
	RTL

CODE_0CFAED:
	LDX.b $12
	LDA.b $10
	AND.w #$0003
	ASL
	TAY
	LDA.w DATA_0CFA66,y
	STA.w $7A98,x
	LDA.w $7A96,x
	BNE.b CODE_0CFB1F
	LDY.b $18,x
	DEY
	DEY
	BMI.b CODE_0CFB20
	STY.b $18,x
	LDA.w $7A36,x
	STA.b $00
	INC
	STA.b $02
	SEP.b #$20
	LDA.b ($00),y
	STA.w $7402,x
	LDA.b ($02),y
	STA.w $7A96,x
	REP.b #$20
CODE_0CFB1F:
	RTL

CODE_0CFB20:
	LDY.b $16,x
	LDA.w DATA_0CFA2B,y
	STA.b $00
	LDA.b $10
	AND.w #$0007
	STA.b $02
	ASL
	CLC
	ADC.b $02
	TAY
	LDA.b ($00),y
	STA.w $7A36,x
	STA.b $02
	INC
	STA.b $04
	INY
	INY
	SEP.b #$20
	LDA.b ($00),y
	STA.b $18,x
	TAY
	LDA.b ($02),y
	STA.w $7402,x
	REP.b #$20
	LDA.b $10
	AND.w #$0003
	ASL
	TAY
	LDA.w DATA_0CFA5E,y
	LDY.w $611A
	BEQ.b CODE_0CFB60
	CLC
	ADC.w #$0140
CODE_0CFB60:
	STA.w $7A96,x
	RTL

CODE_0CFB64:
	LDA.b $76,x
	CMP.w $7182,x
	BPL.b CODE_0CFB7A
	STA.w $7182,x
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0001
	STA.w $7860,x
CODE_0CFB7A:
	RTS

DATA_0CFB7B:
DATA_woozy_guy_state_ptr:                       ; 6-entry Woozy Guy state ptr (walk-cycle phases / dizzy / fall)
	dw CODE_0CFC5F
	dw CODE_0CFCA5
	dw CODE_0CFCC2
	dw CODE_0CFC5F
	dw CODE_0CFCFC
	dw CODE_0CFD08

;---------------------------------------------------------------------------

DATA_0CFB87:
	dw $0000,$0002,$0004,$0008

;---------------------------------------------------------------------------
; Sprite $0F3: Woozy Guy. Raiden: init_woozy_guy.
;---------------------------------------------------------------------------
YI_NorSpr0F3_WoozyGuy_Init:
init_woozy_guy:
;$0CFB8F
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_0CFBD4
	SEP.b #$20
	LDA.w $70E2,x
	AND.b #$10
	LSR
	STA.b $00
	LDA.w $7182,x
	AND.b #$10
	ORA.b $00
	LSR
	LSR
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TAY
	REP.b #$20
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	PHY
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	PLY
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BNE.b CODE_0CFBFE
CODE_0CFBD4:
	DEY
	LDA.w $7042,x
	ORA.w DATA_0CFB87,y
	STA.w $7042,x
	JSL.l CODE_03AE11
	SEP.b #$20
	LDA.b #$FF
	STA.w $7863,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	REP.b #$20
	LDA.w #$0100
	STA.b $18,x
	LDA.w #$FFE0
	STA.w $7A36,x
	JSL.l CODE_0CFEDD
	RTL

CODE_0CFBFE:
	DEY
	LDA.w $7042,x
	ORA.w DATA_0CFB87,y
	STA.w $7042,x
	JSL.l CODE_03AE11
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,x
	LDA.w #$0020
	STA.b $18,x
	DEC
	SEP.b #$20
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.b #$FF
	STA.w $7863,x
	REP.b #$20
	LDA.w #$FFE0
	STA.w $7A36,x
	LDY.b #$0A
	STY.b $76,x
	JSL.l CODE_0CFEDD
	RTL

;---------------------------------------------------------------------------

;---------------------------------------------------------------------------
; Sprite $0F3 main. Raiden: main_woozy_guy.
;---------------------------------------------------------------------------
YI_NorSpr0F3_WoozyGuy_Main:
main_woozy_guy:
;$0CFC37
	JSL.l CODE_03AA2E
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_0CFC48
	LDA.w #$0100
	STA.b $18,x
CODE_0CFC48:
	JSR.w CODE_0CFD41
	JSL.l CODE_0CFEDD
	JSR.w CODE_0CFD69
	JSL.l CODE_03AF23
	JSR.w CODE_0CFDFC
	LDY.b $76,x
	TYX
	JMP.w (DATA_woozy_guy_state_ptr,x)

CODE_0CFC5F:
	LDX.b $12
	LDA.w $7A36,x
	PHA
	CLC
	ADC.b $18,x
	STA.b $18,x
	PLA
	BPL.b CODE_0CFC7C
	LDA.b $18,x
	CMP.w #$00A0
	BCS.b CODE_0CFC9A
	LDA.w #$0020
	STA.w $7A36,x
	BRA.b CODE_0CFC9A

CODE_0CFC7C:
	LDA.b $18,x
	CMP.w #$0100
	BCC.b CODE_0CFC9A
	LDA.w #$0100
	STA.b $18,x
	LDA.w #$FFE0
	STA.w $7A36,x
	LDA.w #$0020
	STA.w $7A96,x
	LDY.b $76,x
	INY
	INY
	STY.b $76,x
CODE_0CFC9A:
	RTL

DATA_0CFC9B:
	dw $FF00,$0100

DATA_0CFC9F:
	dw $2000,$E000,$2000

CODE_0CFCA5:
	LDX.b $12
	LDA.b $16,x
	LDY.w $7400,x
	LDA.w DATA_0CFC9B,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7A96,x
	LDY.b $76,x
	INY
	INY
	STY.b $76,x
	RTL

CODE_0CFCC2:
	LDX.b $12
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_0CFCD5
	LDA.b $16,x
	CLC
	ADC.w #$0800
	STA.b $16,x
	RTL

CODE_0CFCD5:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	BNE.b CODE_0CFCE6
	STZ.b $16,x
CODE_0CFCDF:
	LDY.b $76,x
	INY
	INY
	STY.b $76,x
	RTL

CODE_0CFCE6:
	BMI.b CODE_0CFCF2
	LDY.w $7400,x
	LDA.w DATA_0CFC9F,y
	STA.b $16,x
	BRA.b CODE_0CFCDF

CODE_0CFCF2:
	LDY.w $7400,x
	LDA.w DATA_0CFC9F+$02,y
	STA.b $16,x
	BRA.b CODE_0CFCDF

CODE_0CFCFC:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0CFD07
	LDY.b #$00
	STY.b $76,x
CODE_0CFD07:
	RTL

CODE_0CFD08:
	LDX.b $12
	LDA.w $7680,x
	CMP.w #$00F0
	BCS.b CODE_0CFD2F
	LDA.w $7682,x
	CMP.w #$00C0
	BCS.b CODE_0CFD2F
	LDA.b $18,x
	CLC
	ADC.w #$0002
	CMP.w #$0100
	BCS.b CODE_0CFD30
	STA.b $18,x
	DEC
	SEP.b #$20
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	REP.b #$20
CODE_0CFD2F:
	RTL

CODE_0CFD30:
	LDA.w #$0100
	STA.b $18,x
	SEP.b #$20
	LDA.b #$FF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.b $76,x
	REP.b #$20
	RTL

CODE_0CFD41:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_0CFD68
	LDA.w $7D38,x
	BEQ.b CODE_0CFD68
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0180
	CMP.w #$0301
	BCC.b CODE_0CFD68
	LDA.w #$0100
	STA.b $18,x
	LDA.w $7402,x
	AND.w #$00FF
	STA.w $7402,x
CODE_0CFD68:
	RTS

CODE_0CFD69:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_0CFD82
	LDA.w $7D38,x
	BEQ.b CODE_0CFD82
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0180
	CMP.w #$0301
	BCS.b CODE_0CFD83
CODE_0CFD82:
	RTS

CODE_0CFD83:
	PLA
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_0CFD90
	RTL

CODE_0CFD90:
	LDA.w $7D38,x
	DEC
	BEQ.b CODE_0CFD99
	STA.w $7D38,x
CODE_0CFD99:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	TYX
	JMP.w (DATA_woozy_guy_hit_state_ptr,x)

DATA_0CFDA0:
DATA_woozy_guy_hit_state_ptr:                   ; 2-entry Woozy Guy on-hit state ptr (knockback / land)
	dw CODE_0CFDA4
	dw CODE_0CFDCF

CODE_0CFDA4:
	LDX.b $12
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0CFDAF
	INY
	INY
CODE_0CFDAF:
	TYA
	EOR.w $7400,x
	TAY
	LDA.w DATA_0C8D66,y
	STA.b $78,x
	LDA.w $7400,x
	STA.w $7A38,x
	LDA.w #$0100
	STA.b $18,x
	SEP.b #$20
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	REP.b #$20
	RTL

CODE_0CFDCF:
	LDX.b $12
	JSR.w CODE_0CFE63
	JSR.w CODE_0CFE6C
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_0CFDEE
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0CFDE8
	INY
	INY
CODE_0CFDE8:
	LDA.w DATA_0C8D4E,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0CFDEE:
	LDA.b $16,x
	CLC
	ADC.b $78,x
	STA.b $16,x
	LDA.w $7400,x
	STA.w $7A38,x
	RTL

CODE_0CFDFC:
	LDX.b $12
	LDY.w $7D36,x
	BPL.b CODE_0CFE0E
	LDA.w $61D6
	BNE.b CODE_0CFE5E
	PLA
	JSL.l CODE_03A5B7
	RTL

CODE_0CFE0E:
	DEY
	BMI.b CODE_0CFE5E
	BEQ.b CODE_0CFE5E
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0CFE5E
	LDA.w $7D38,y
	BEQ.b CODE_0CFE5E
	JSR.w CODE_0C8EBF
	BCC.b CODE_0CFE28
	JMP.w CODE_0CFEAA

CODE_0CFE28:
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	AND.w #$8000
	ASL
	ROL
	ASL
	STA.b $00
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDX.b $12
	PLA
	LDA.w #!Define_YI_SoundID67_EnemyTumbling
	JSL.l CODE_push_sound_queue
	SEP.b #$20
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	LDA.b #$01
	STA.w $7D38,x
	REP.b #$20
	LDY.b $00
	LDA.w DATA_0C8D4E,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JML.l CODE_0CFDA4

CODE_0CFE5E:
	RTS

DATA_0CFE5F:
	dw $0008,$0004

CODE_0CFE63:
	LDA.w $7400,x
	CMP.w $7A38,x
	BNE.b CODE_0CFE73
	RTS

CODE_0CFE6C:
	LDX.b $12
	LDY.w $7D36,x
	BPL.b CODE_0CFE77
CODE_0CFE73:
	PHY
	JMP.w CODE_0C8F3F

CODE_0CFE77:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	PHX
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_0CFEC0
	BEQ.b CODE_0CFEC0
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$000E
	BCC.b CODE_0CFEC0
	LDA.w $6FA2,y
	AND.w #$6000
	BNE.b CODE_0CFEC0
	JSR.w CODE_0C8EBF
	BCS.b CODE_0CFEAA
	LDA.w $6FA0,y
	AND.w #$0020
	BNE.b CODE_0CFEC0
CODE_0CFEAA:
	LDA.w $70E2,y
	STA.b $00
	LDA.w $7182,y
	STA.b $02
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDX.b $12
	PLA
	JML.l CODE_kill_sprite_by_hit_checked

CODE_0CFEC0:
	RTS

DATA_0CFEC1:
	dw $0007,$0006,$0005,$0004,$0003,$0002,$0001,$0000
	dw $0000,$0000,$0000,$0000

DATA_0CFED9:
	dw FXDATA_540000+$7020,FXDATA_540000+$6020

CODE_0CFEDD:
	LDY.w $7403,x
	BNE.b CODE_0CFF60
	LDY.w $74A2,x
	BMI.b CODE_0CFF60
	LDA.b $18,x
	LSR
	LSR
	LSR
	LSR
	AND.w #$00FE
	TAY
	LDA.w DATA_0CFEC1,y
	STA.b $00
	REP.b #$10
	LDY.w $7362,x
	LDA.w $6002,y
	CLC
	ADC.b $00
	STA.w $6002,y
	SEP.b #$10
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_0CFF60
	LDA.w $7722,x
	BMI.b CODE_0CFF60
	LDY.b #$00
	LDA.w $7D38,x
	BEQ.b CODE_0CFF19
	INY
	INY
CODE_0CFF19:
	LDA.w DATA_0CFED9,y
	STA.b $00
	LDY.b $17,x
	TYA
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TYA
	INC
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $18,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	REP.b #$10
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.b $00
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$6020)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	SEP.b #$10
	LDX.b #FXCODE_0883ED>>16
	LDA.w #FXCODE_0883ED
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
CODE_0CFF60:
	RTL

CODE_0CFF61:
	PHY
	TXY
	JSL.l CODE_03B4DF
	PLY
	RTL

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($0CFF84, incbin, DATA_0CFF84_YI_U2.bin)
else
	%FREE_BYTES($0CFF69, 151, $FF)
endif
%BANK_END(<EndBank>)
endmacro
