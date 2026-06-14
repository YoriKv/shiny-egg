;#############################################################################################################
;# Bank05.asm -- bank $05 SNES code (LoROM, HiROM mirror at $C5).
;#
;# Largest bank in the game; contains the Init/Main routines for ~30 normal sprite families,
;# spanning egg blocks, springs, water/lava enemies, throwing/spitting plants, bullet bills,
;# arrow lifts, the POW block, flopsy fish, melon bug, etc.  Most of the bank is sprite code;
;# small data tables (state ptrs, speed tables, GFX ptrs) are interleaved per-sprite.
;#
;# Contents at a glance:
;#   $05:8000-$05:80C3    -- Shared helpers: sprite-to-player delta (GSU r0/r1/r2) +
;#                            speed-vector morph helpers used by Clawdaddy/Wild Piranha/etc.
;#   $05:80C4-$05:8233    -- Egg blocks ($068/$069/$06A: Flashing / Red / Yellow) Init + Main +
;#                            bounce-physics + GSU morph driver tables.
;#   $05:8234-$05:82B4    -- Egg-block state $00/$02 handlers (see DATA_egg_block_state_ptr dispatch).
;#   $05:82B5-$05:8625    -- Spring Ball + Large Spring Ball ($06C/$06F/$148) Init + Main
;#                            (bounce physics, GFX-pointer tables at DATA_058507+).
;#   $05:8627-$05:8CC5    -- Clawdaddy ($070) Init + Main + walk/turn state machine.
;#   $05:8CC6-$05:917C    -- Lava Bubble straight ($080) + following-arc ($081) Init + Main.
;#   $05:917D-$05:974B    -- Chain Chomp ($082) Init + Main + chain segments + bite cycle.
;#   $05:974C-$05:9B2F    -- Swing-of-Grinders / Monkey Swing ($08F) rotating-arm contraption.
;#   $05:9B30-$05:9D94    -- Expanding Block ($094) Init + Main (grow-on-Yoshi-stand).
;#   $05:9D95-$05:9F9E    -- Checkered Blocks blue/red ($095/$096) Init + Main (link toggle).
;#   $05:9F9F-$05:A87B    -- Wild Piranha + upside-down Piranha ($054/$066) Init + Main + chomp.
;#   $05:A87C-$05:ABB1    -- Wild Ptooie Piranha ($09F) Init + Main + spit projectile.
;#   $05:ABB2-$05:B420    -- Small Burt / Burt ($0E7) Init + Main + jump/squash state machine.
;#   $05:B421-$05:B6DD    -- Balloon platform ($052) Init + Main (Yoshi rides, balloon shrinks).
;#   $05:B6DE-$05:B99E    -- End-of-Level Transformation block / Yoshi Block ($098).
;#   $05:B99F-$05:BE68    -- Eggo-Dil ($0EE) body + face ($0EF) + petals ($0F0) Init + Main.
;#   $05:BE69-$05:C46A    -- Flamer Guy jumping ($0EC) + running ($0ED) Init + Main + flame trail.
;#   $05:C46B-$05:CB0A    -- Bucket ($021/$122/$123 plain / bandit / coins) Init + Main +
;#                            two-stage state machine (held-bucket + freed-contents).
;#   $05:CB0B-$05:D1D6    -- Dr. Freezegood ($01C) Init + Main + ice-breath/state ptrs.
;#   $05:D1D7-$05:D660    -- Bullet Bill blasters red/yellow/green ($078/$079/$07A) Init + Main.
;#   $05:D661-$05:D8D9    -- Bullet Bills red/yellow/green ($07B/$07C/$07D) Init + Main + StompRt.
;#   $05:D8DA-$05:DA97    -- Bouncing Bullet Bill (head-bop variant) Init + Main.
;#   $05:DA98-$05:DC73    -- Hint Block / Message Box ($0AD) Init + Main.
;#   $05:DC74-$05:E0F7    -- Boo Man Bluff ($10F) Init + Main (slope-skating boo).
;#   $05:E0F8-$05:E31C    -- Heading Cactus ($0E4) Init + Main (charging cactus).
;#   $05:E31D-$05:EA09    -- Muddy Buddy ($063) Init + Main (slime that splits / sticks).
;#   $05:EA0A-$05:F07E    -- Spooky ($119) Init + Main (revolving ghosts).
;#   $05:F07F-$05:F3EF    -- Arrow Wheel brown/blue ($11E/$11F) Init + Main (rotating ride).
;#   $05:F3F0-$05:F5AC    -- Double-Sided Arrow Lift ($120) Init + Main.
;#   $05:F5AD-$05:F6DD    -- POW Block ($097) Init + Main + dispatch table.
;#   $05:F6DE-$05:F979    -- Flopsy Fish jumps ($141 swim/arc, $142 3-jump) Init + Main.
;#   $05:F97A-$05:FC27    -- Melon Bug ($092) Init + Main (rolls into ball).
;#   $05:FC28-$05:FE1E    -- Shared shell-sound table + hit-handler (reused by egg blocks).
;#   $05:FE1F-$05:FFC3    -- Hit-Green-Egg-Block ($06B) Init + Main.
;#   $05:FFC4-$05:FFFF    -- GarbageData tail (V1.0 freespace; V1.1/U2 inserts DATA_05FFE6).
;#                            Also stub-aliases for glitched sprites $05D / $086.
;#
;# Cross-references:
;#   Raidenthequick bank05.asm     -- best descriptive labels (init_egg_block, main_clawdaddy,
;#                                    main_chain_chomp, init_bucket, main_freezegood, ...).
;#                                    77 named labels in this bank (5.9 percent descriptive coverage).
;#   docs/named_main_labels.txt    -- bank $05 section, this file's label dictionary
;#   docs/spritestateengine.md     -- sprite engine architecture for the NorSpr handlers here.
;#   ys_enmy*.asm                  -- enemy main loop / dispatch concepts (naming/concepts only).
;#   ys_chr.asm                    -- character (player) collision routines that the sprites
;#                                    in this bank call into via cross-bank JSLs.
;#
;# Naming convention used below:
;#   Each templated `YI_NorSpr*_Init/Main` and anonymous `CODE_/DATA_xxxxxx` label is kept
;#   as-is for tooling. Descriptive aliases (Raidenthequick names, lowercase_with_underscores)
;#   are added at the SAME address (asar allows multiple labels per address).
;#############################################################################################################

macro YIBank05Macros(StartBank, EndBank)
%BANK_START(<StartBank>)

;-------------------------------------------------------------------------
; Sprite-to-player horizontal delta + facing-direction helper.
; Called by sprites that use GSU r0/r1/r2 to compute the player offset
; and choose a facing direction (Clawdaddy, Wild Piranha and friends).
; Inputs: X = sprite slot index, $0C = caller-supplied threshold.
; Side effects: writes wildcard_2 + facing_dir + GSU r1/r2.
;-------------------------------------------------------------------------
CODE_058000:
CODE_sprite_player_delta_facing:                 ; Raidenthequick: (CODE_sprite_player_delta_facing) shared GSU delta
	STA.b $0C
	ASL
	STA.b $0E
	LDA.w $7C16,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7C18,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	PHA
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.b $0C
	CMP.b $0E
	BCC.b CODE_058043
	BMI.b CODE_058038
	CMP.w #$0100
	BCS.b CODE_05803D
CODE_058032:
	PLA
	SEC
	SBC.b $0C
	BRA.b CODE_058044

CODE_058038:
	CMP.w #$FF00
	BCC.b CODE_058032
CODE_05803D:
	PLA
	CLC
	ADC.b $0C
	BRA.b CODE_058044

CODE_058043:
	PLA
CODE_058044:
	AND.w #$01FE
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEC
	SBC.w #$0080
	CMP.w #$0100
	BCS.b CODE_05805F
	STZ.w $7400,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w #$0100
	BRA.b CODE_05806C

CODE_05805F:
	LDA.w #$0002
	STA.w $7400,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
CODE_05806C:
	AND.w #$01FE
	STA.w $7A38,x
	RTS

;---------------------------------------------------------------------------

CODE_058073:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w #$0080
	CMP.w #$0100
	BCS.b CODE_0580B5
	LDA.w #$0002
	STA.w $7400,x
	LDA.w #$0100
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BRA.b CODE_0580BB

CODE_0580B5:
	STZ.w $7400,x
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
CODE_0580BB:
	AND.w #$01FE
	STA.w $7A38,x
	RTS

;---------------------------------------------------------------------------

CODE_0580C2:
	TYX
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; EGG BLOCKS (sprites $068 Flashing / $069 Red / $06A Yellow).
; Raidenthequick: init_egg_block / main_flashing_egg_block / main_egg_block.
;
; Three sprite IDs share one Init/Main implementation; the Init computes a
; state index from (spriteID - $068) * 2 into $18,x to pick per-variant
; behavior, sets the initial GSU morph value, then dispatches via
; DATA_egg_block_state_ptr (state $00 / $02 hop / land cycle) on each Main tick.
; The bouncing physics tables live at DATA_05813D / DATA_058149.
;=========================================================================

;-------------------------------------------------------------------------
; Egg-block Init (shared between flashing/red/yellow variants).
;-------------------------------------------------------------------------
YI_NorSpr068_FlashingEggBlock_Init:
YI_NorSpr069_RedEggBlock_Init:
YI_NorSpr06A_YellowEggBlock_Init:
init_egg_block:                             ; Raidenthequick: init_egg_block
;$0580C4
	JSL.l CODE_03D406                       ; standard sprite setup (clear state)
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr068_FlashingEggBlock
	ASL
	STA.b $18,x
	LDA.w #$0100
	STA.w $7A36,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Egg-block Main dispatch table -- state $76,x doubled.
;   00 -- bouncing/hop cycle (CODE_058234)
;   02 -- landed/idle (CODE_05827D)
;-------------------------------------------------------------------------
DATA_0580D9:
DATA_egg_block_state_ptr:                        ; Raidenthequick equivalent: egg_block dispatch
	dw CODE_058234                          ; 00 = hop/bounce phase
	dw CODE_05827D                          ; 02 = landed phase

;-------------------------------------------------------------------------
; Egg-block Main (per-frame). Flashing variant ($068) runs an extra
; pre-tick (CODE_03B75E) for its palette flash; red/yellow start one
; instruction later sharing the rest of the body.
;-------------------------------------------------------------------------
YI_NorSpr068_FlashingEggBlock_Main:
main_flashing_egg_block:                    ; Raidenthequick: main_flashing_egg_block
;$0580DD
	JSL.l CODE_03B75E                       ; palette/flash tick (flashing variant only)
YI_NorSpr069_RedEggBlock_Main:
YI_NorSpr06A_YellowEggBlock_Main:
main_egg_block:                             ; Raidenthequick: main_egg_block
	STZ.w $7400,x
	LDY.w $7402,x
	BEQ.b CODE_0580ED
	JSL.l CODE_03AA52
CODE_0580ED:
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_egg_block_state_ptr,x)
	JSR.w CODE_058120
	LDY.w $7402,x
	BEQ.b CODE_058104
	JSR.w CODE_058161
CODE_058104:
	LDY.b $76,x
	BEQ.b CODE_058109
	RTL

CODE_058109:
	JSL.l CODE_03D291
	LDY.w $61B4
	PHY
	JSL.l CODE_03D22D
	PLY
	CPY.w $61B4
	BNE.b CODE_05811F
	JSL.l CODE_03D127
CODE_05811F:
	RTL

CODE_058120:
	LDY.b $76,x
	BEQ.b CODE_05813C
	LDY.w $7D36,x
	DEY
	BMI.b CODE_05813C
	LDA.w $7182,y
	CMP.w $7182,x
	BPL.b CODE_05813C
	LDA.w $75E2,y
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
CODE_05813C:
	RTS

DATA_05813D:
	dw $0100,$01FF,$00CC,$01FF,$0100,$0199

DATA_058149:
	dw $0050,$FFB0,$0060,$FF9E,$0028,$FFD8

DATA_058155:
	dw FXDATA_540000+$7040,FXDATA_548000+$3070,FXDATA_548000+$2070

DATA_05815B:
	dw (FXDATA_540000+$7040)>>16,(FXDATA_548000+$3070)>>16,(FXDATA_548000+$2070)>>16

CODE_058161:
	LDA.b $18,x
	PHA
	ASL
	TAY
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_05816D
	INY
	INY
CODE_05816D:
	LDA.w DATA_058149,y
	STA.b $00
	PLA
	ASL
	TAY
	LDA.w $7A36,x
	CLC
	ADC.b $00
	CMP.w DATA_05813D,y
	BCS.b CODE_058185
	LDA.w DATA_05813D,y
	BRA.b CODE_05818D

CODE_058185:
	CMP.w DATA_05813D+$02,y
	BCC.b CODE_05818D
	LDA.w DATA_05813D+$02,y
CODE_05818D:
	STA.w $7A36,x
	LDY.b $18,x
	CPY.b #$04
	BEQ.b CODE_0581CE
	PHY
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CMP.w #$FF80
	BMI.b CODE_0581AA
	INY
	INY
	CMP.w #$0200
	BMI.b CODE_0581AA
	INY
	INY
CODE_0581AA:
	LDA.w DATA_058155,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w DATA_05815B,y
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	PLY
	BEQ.b CODE_0581E3
	SEC
	SBC.w #$0100
	LSR
	STA.b $00
	LDA.w #$0100
	SEC
	SBC.b $00
	BRA.b CODE_0581E3

CODE_0581CE:
	LDA.w #FXDATA_540000+$4081
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$4081)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #$00CE
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A36,x
CODE_0581E3:
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w $7722,x
	TAX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	CPY.b #$04
	BNE.b CODE_058210
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_058222

CODE_058210:
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_0882FA>>16
	LDA.w #FXCODE_0882FA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_058222:
	LDX.b $12
	INC.w $0CF9
	RTS

DATA_058228:
	dw $FC00,$FEC0,$FC00

DATA_05822E:
	dw $0040,$0012,$0040

CODE_058234:
	TYX
	LDY.w $7D36,x
	BPL.b CODE_05827C
	LDA.w $7C18,x
	CLC
	ADC.w $6122
	CLC
	ADC.w $7BB8,x
	CMP.w #$0008
	BCS.b CODE_05827C
	LDY.w $60AB
	BPL.b CODE_05827C
	LDY.w $60C0
	BEQ.b CODE_05827C
	STZ.w $60AA
	STZ.w $60D2
	JSL.l CODE_03AD74
	BCC.b CODE_058263
	INC.w $7402,x
CODE_058263:
	LDY.b $18,x
	LDA.w DATA_058228,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w DATA_05822E,y
	STA.w $7542,x
	LDA.w $7182,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEC.w $7182,x
	INC.b $76,x
CODE_05827C:
	RTS

CODE_05827D:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w $7182,x
	BCS.b CODE_05827C
	STA.w $7182,x
	JSL.l CODE_03AEFD
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	TXY
	LDA.b $18,x
	LSR
	CLC
	ADC.w #!Define_YI_NorSpr022_FlashingEgg
	JSL.l CODE_spawn_sprite
	JSL.l CODE_0ED844
	PHX
	TYX
	JSL.l CODE_03B8A8
	PLX
	PLA
	LDA.w #!Define_YI_SoundID3A_StompShyGuy
	JML.l CODE_push_sound_queue

;=========================================================================
; SPRING BALLS (sprites $06C Large / $06F Regular / $148 Large 2nd-variant).
; Raidenthequick: init_large_spring_ball / init_spring_ball /
;                 main_spring_ball / main_large_spring_ball.
;
; Stationary platforms that compress when Yoshi lands then launch him up.
; Large variant has wider bbox (#$000C) and stamps a different sprite-state
; layout. Common Main body lives at YI_NorSpr06F_SpringBall_Main; the
; large variants jump in slightly later sharing the bulk of the code.
;=========================================================================

;-------------------------------------------------------------------------
; Large Spring Ball Init.
;-------------------------------------------------------------------------
YI_NorSpr06C_LargeSpringBall_Init:
YI_NorSpr148_LargeSpringBall_Init:
YI_NorSpr148_FallThroughSpringBall_Init:    ; friendly alias of YI_NorSpr148_LargeSpringBall_Init (the $148 variant lets Yoshi fall through; see Bank05:561-574)
init_large_spring_ball:                     ; Raidenthequick: init_large_spring_ball
;$0582B5
	LDA.w $7722,x                           ; \ first-frame test ($7722 starts negative)
	BPL.b CODE_0582E1                       ; / branch if already initialised
	JSL.l CODE_03AE60
	INC.w $7402,x
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$FFF8
	STA.w $7720,x
	STZ.w $7B58,x
	LDA.w #$000C
	STA.w $7BB6,x
	STA.w $7BB8,x
	LDY.b #$02
	JSL.l CODE_0582FD
	BRA.b CODE_0582E5

CODE_0582E1:
	JSL.l CODE_03AA52
CODE_0582E5:
	JSL.l CODE_02A007
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7182,x
	STA.w $75E0,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Regular Spring Ball Init (Y=$00 path; large variant calls with Y=$02).
;-------------------------------------------------------------------------
YI_NorSpr06F_SpringBall_Init:
init_spring_ball:                           ; Raidenthequick: init_spring_ball
;$0582F7
	JSL.l CODE_02A007
	LDY.b #$00
CODE_0582FD:
	STY.b $0E
	LDA.w #$0004
	STA.w $7BB6,x
	LDA.w #$0100
	STA.w $7A36,x
	STZ.w $7400,x
	LDA.w $7BB8,x
	CLC
	ADC.w $6122
	CLC
	ADC.w $6112
	STA.w $7A38,x
	JSR.w CODE_05851F
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Spring Ball Main (all three variants).
; Dispatches by sprite ID: SpringBall path skips the gravity helper,
; Large variants run CODE_03AA52 (physics) first.
;-------------------------------------------------------------------------
YI_NorSpr06F_SpringBall_Main:
main_spring_ball:                           ; Raidenthequick: main_spring_ball
;$058320
	LDY.w $7402,x                           ; \ skip gravity if Yoshi not touching
	BEQ.b CODE_058329                       ; /
YI_NorSpr06C_LargeSpringBall_Main:
YI_NorSpr148_LargeSpringBall_Main:
YI_NorSpr148_FallThroughSpringBall_Main:    ; friendly alias of YI_NorSpr148_LargeSpringBall_Main (the $148 variant lets Yoshi fall through; see Bank05:561-574)
main_large_spring_ball:                     ; Raidenthequick: main_large_spring_ball
	JSL.l CODE_03AA52                       ; standard physics step
CODE_058329:
	JSL.l CODE_03AF23
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr06F_SpringBall
	BEQ.b CODE_05835F
	INY
	INY
	CMP.w #!Define_YI_NorSpr148_LargeSpringBall
	BNE.b CODE_05835F
	LDA.w $75E0,x
	AND.w #$0001
	BEQ.b CODE_05835F
	AND.w $7860,x
	BNE.b CODE_05835F
	LDA.w $75E0,x
	AND.w #$FFFE
	CMP.w $7182,x
	BPL.b CODE_05835F
	LDA.w $7040,x
	AND.w #$FFF3
	STA.w $7040,x
CODE_05835F:
	STY.b $0E
	JSR.w CODE_05837E
	JSR.w CODE_05847C
	JSR.w CODE_05851F
	LDA.w $7860,x
	AND.w #$0001
	STA.b $00
	LDA.w $75E0,x
	AND.w #$FFFE
	ORA.b $00
	STA.w $75E0,x
	RTL

CODE_05837E:
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	ORA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	BNE.b CODE_0583A0
	LDY.b $18,x
	BEQ.b CODE_05838D
	JMP.w CODE_058430

CODE_05838D:
	LDA.w $6120
	CLC
	ADC.w $7BB6,x
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7C16,x
	CMP.b $00
	BCC.b CODE_0583A1
CODE_0583A0:
	RTS

CODE_0583A1:
	LDA.w $7C18,x
	BMI.b CODE_0583A0
	SEC
	SBC.w $7A38,x
	BPL.b CODE_0583A0
	LDY.w $60C0
	BEQ.b CODE_0583A0
	LDY.w $60AB
	BMI.b CODE_0583A0
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05842F
	LDY.b $0E
	BNE.b CODE_0583D7
	LDA.w $7722,x
	BPL.b CODE_0583DB
	JSL.l CODE_03AD74
	BCC.b CODE_0583DB
	INC.w $7402,x
CODE_0583D7:
	LDY.b #$01
	STY.b $19,x
CODE_0583DB:
	LDA.w $60AA
	LSR
	LSR
	LDY.b $0E
	BNE.b CODE_0583E5
	LSR
CODE_0583E5:
	CLC
	ADC.w #$0100
	CMP.w #$01C0
	BMI.b CODE_0583F1
	LDA.w #$01C0
CODE_0583F1:
	CPY.b #$00
	BEQ.b CODE_05840C
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0140
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86BF>>16
	LDA.w #FXCODE_0B86BF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
CODE_05840C:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $60AA
	STZ.w $60A8
	STZ.w $60B4
	STZ.w $60C0
	LDY.b #$02
	STY.b $76,x
	LDA.w #$0004
	CMP.w $61D6
	BMI.b CODE_05842A
	STA.w $61D6
CODE_05842A:
	INC.w $61B4
	INC.b $18,x
CODE_05842F:
	RTS

CODE_058430:
	LDY.w $60C0
	BEQ.b CODE_058439
	JSR.w CODE_0585A5
	RTS

CODE_058439:
	LDA.w $6120
	CLC
	ADC.w $7BB6,x
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7C16,x
	CMP.b $00
	BCC.b CODE_058450
	JSR.w CODE_058618
	RTS

CODE_058450:
	LDA.w $7CD8,x
	SEC
	SBC.w $7A38,x
	SEC
	SBC.w $611E
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60AA
	LDA.w #$0004
	CMP.w $61D6
	BMI.b CODE_058470
	STA.w $61D6
CODE_058470:
	INC.w $61B4
	RTS

;---------------------------------------------------------------------------

DATA_058474:
	dw $FFF0,$0010,$FFF8,$0008

CODE_05847C:
	LDY.w $7722,x
	BMI.b CODE_0584AB
	LDY.b $19,x
	BEQ.b CODE_0584AB
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_058490
	JMP.w CODE_0584EB

CODE_058490:
	LDY.b $76,x
	CPY.b #$04
	BNE.b CODE_0584AC
	LDY.b $0E
	BNE.b CODE_0584A1
	JSL.l CODE_03AEFD
	STZ.w $7402,x
CODE_0584A1:
	LDY.b #$00
	STY.b $19,x
	LDA.w #$0100
	STA.w $7A36,x
CODE_0584AB:
	RTS

CODE_0584AC:
	TYA
	DEC
	STA.b $00
	LDA.w $7A36,x
	CLC
	ADC.w DATA_058474,y
	STA.w $7A36,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	EOR.b $00
	BMI.b CODE_0584EA
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $7A36,x
	CPY.b #$00
	BEQ.b CODE_0584D5
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.b $76,x
	RTS

CODE_0584D5:
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.b $76,x
	LDA.w #$0140
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID1F_HitHead
	JSL.l CODE_push_sound_queue
CODE_0584EA:
	RTS

CODE_0584EB:
	LDY.b #$04
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0584FC
	LDA.w $7A36,x
	CMP.w #$0100
	BPL.b CODE_0584FC
	INY
	INY
CODE_0584FC:
	LDA.w $7A36,x
	CLC
	ADC.w DATA_058474,y
	STA.w $7A36,x
	RTS

;---------------------------------------------------------------------------

DATA_058507:						; Note: Spring ball graphics pointers
	dw FXDATA_540000+$7050,FXDATA_550000+$40E0

DATA_05850B:
	dw (FXDATA_540000+$7050)>>16,(FXDATA_550000+$40E0)>>16

DATA_05850F:
	dw $0008,$0010

DATA_058513:
	dw $0010,$001C

DATA_058517:
	dw $0E00,$1800

DATA_05851B:
	dw $0008,$000C

CODE_05851F:
	LDY.b $0E
	LDA.w $7722,x
	BPL.b CODE_05852E
	LDA.w DATA_058517+$01,y
	AND.w #$00FF
	BRA.b CODE_05858F

CODE_05852E:
	STZ.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w $7A36,x
	CMP.b $16,x
	BEQ.b CODE_05853D
	STA.b $16,x
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
CODE_05853D:
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0200
	SEC
	SBC.w $7A36,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w DATA_05850B,y
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w DATA_058507,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w DATA_05850F,y
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w DATA_058513,y
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w DATA_058517,y
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	TYA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08D62C>>16
	LDA.w #FXCODE_08D62C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	LDA.w $6020
CODE_05858F:
	LDY.b $0E
	CLC
	ADC.w $6122
	CLC
	ADC.w $6112
	SEC
	SBC.w DATA_05851B,y
	STA.w $7A38,x
CODE_0585A0:
	RTS

;---------------------------------------------------------------------------

DATA_0585A1:
	dw $0280,$0200

CODE_0585A5:
	LDY.b $18,x
	BEQ.b CODE_0585A0
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_058618
	LDY.b $0E
	BNE.b CODE_0585BA
	LDA.w #$00B0
	BRA.b CODE_0585E2

CODE_0585BA:
	LDA.w $7A36,x
	CMP.w #$0140
	BMI.b CODE_0585C5
	LDA.w #$0140
CODE_0585C5:
	PHY
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0130
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	PLY
	SEC
	SBC.w #$0020
CODE_0585E2:
	ASL
	ASL
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w DATA_0585A1,y
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $60AA
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	LDA.w #$0006
	STA.w $60C0
	STA.w $7E0A
	STZ.w $7860,x
CODE_058618:
	LDY.b #$00
	STY.b $18,x
	LDY.b #$04
	STY.b $76,x
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; CLAWDADDY (sprite $070) -- the side-walking crab found in beach/swamp
; stages.  Walks back and forth, randomly pauses + turns, periodically
; raises a claw for a swipe-attack, then ducks to recover.  Combat-state
; byte at $76,x indexes the 5-entry dispatch DATA_clawdaddy_state_ptr:
;   00 walk -> 02 pause -> 04 turn -> 06 swipe -> 08 recover -> 00 walk ...
; The Init at $058627 only primes two wildcard EXRAM bytes (turn-timer
; init = $FFFF, direction-counter = 3); all per-state work happens in Main.
;
; Per-slot state-machine work bytes (per-sprite scratch in the standard
; sprite-slot tables; values persist across frames within one slot):
;   $16,x   -- swipe-flip flag (swipe arc rotates by -$10 or +$20 per frame)
;   $78,x   -- claw open/shut pattern flag (also damage-blink flag in death state)
;   $7A36,x -- "zoom size" claw scale base (state $02 raise / state $04 swipe)
;   $7A38,x -- claw swing angle starting point (state $02 raise)
;
; see also: ys_enmy4.asm.
; Raidenthequick: init_clawdaddy / main_clawdaddy.
;=========================================================================

;-------------------------------------------------------------------------
; Clawdaddy Init -- seeds wildcard 1 = $FFFF (turn timer) and wildcard 2 = 3.
;-------------------------------------------------------------------------
YI_NorSpr070_Clawdaddy_Init:
init_clawdaddy:                             ; Raidenthequick: init_clawdaddy
;$058627
	LDA.w #$FFFF
	STA.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0003
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Clawdaddy main dispatch table (state $76,x doubled).
; Entries match the 5-handler claw-attack cycle: walk patrol -> lift claw
; into ready posture -> wave claw in arc (spawns bubble projectile) ->
; scissor claws open+shut a few times -> tremble/settle -> back to walk.
;   00 -- walk patrol           (CODE_clawdaddy_state_walk)
;   02 -- raise claw / wind-up  (CODE_clawdaddy_state_raise_claw)
;   04 -- claw swipe arc        (CODE_clawdaddy_state_swipe_arc)
;   06 -- scissor open/shut     (CODE_clawdaddy_state_scissor)
;   08 -- tremble / recover     (CODE_clawdaddy_state_recover)
; see also: ys_enmy4.asm.
;-------------------------------------------------------------------------
DATA_058636:
DATA_clawdaddy_state_ptr:                        ; Raidenthequick equivalent
	dw CODE_clawdaddy_state_walk                          ; 00 -- walk patrol
	dw CODE_clawdaddy_state_raise_claw                          ; 02 -- raise claw / wind-up
	dw CODE_clawdaddy_state_swipe_arc                          ; 04 -- claw swipe arc + bubble
	dw CODE_clawdaddy_state_scissor                          ; 06 -- scissor open/shut
	dw CODE_clawdaddy_state_recover                          ; 08 -- tremble / recover

DATA_058640:
DATA_clawdaddy_anim_frames:                      ; 4-frame walk animation tile offsets
	dw $0022,$0024,$0026,$0028

;-------------------------------------------------------------------------
; Clawdaddy Main -- runs claw-collision pre-check then dispatches by state.
; Branches at $058648-$058673 give the claw a chance to crush the player
; whenever the sprite is in damage state ($12) or has the swipe-active
; flag $7D96 set.  Standard sprite update (collision/gravity) at $058658.
; Animation overlay at $058673: when the swing-counter $7AF8 ticks (entered
; from raise_claw and swipe_arc), substitute claw tile offsets from
; DATA_clawdaddy_anim_frames and reverse X-motion + bump animation timers.
; Otherwise dispatch by state (CODE_0586A2) and refresh facing-direction.
;-------------------------------------------------------------------------
YI_NorSpr070_Clawdaddy_Main:
main_clawdaddy:                             ; Raidenthequick: main_clawdaddy
;$058648
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0012
	BEQ.b CODE_058655
	LDA.w $7D96,x
	BEQ.b CODE_058658
CODE_058655:
	JSR.w CODE_clawdaddy_claw_collision_check
CODE_058658:
	JSR.w CODE_058723
	JSL.l CODE_03AF23
	LDA.w $6FA2,x
	AND.w #$0300
	BNE.b CODE_058673
	LDA.w $7860,x
	LSR
	BCC.b CODE_058673
	LDA.w #$0943
	STA.w $6FA2,x
CODE_058673:
	LDA.w #$0022
	STA.w $7042,x
	LDA.w $7AF8,x
	BEQ.b CODE_0586A2
	AND.w #$0006
	TAY
	LDA.w DATA_clawdaddy_anim_frames,y
	STA.w $7042,x
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.w $7A96,x
	INC.w $7A98,x
	INC.w $7AF6,x
	JSR.w CODE_0586C8
	RTL

CODE_0586A2:
	JSR.w CODE_0586C8
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_clawdaddy_state_ptr,x)
	JSR.w CODE_058723
	SEP.b #$20
	LDA.w $7402,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	BEQ.b CODE_0586C5
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	BNE.b CODE_0586C5
	REP.b #$20
	JSL.l CODE_03AEFD
CODE_0586C5:
	REP.b #$20
	RTL

CODE_0586C8:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_058710
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_058710
	LDA.w $7D38,y
	BEQ.b CODE_058710
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_058709
	LDA.w #$000C
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID0C_ShellHit2
	JSL.l CODE_push_sound_queue
	PLA
	RTL

CODE_058709:
	LDA.w #$0040
	STA.w $7AF8,x
	RTS

CODE_058710:
	PLA
	STA.b $00
	JSL.l CODE_03A5B7
	LDA.b $00
	PHA
	RTS

DATA_05871B:
	dw $0000,$FFF0

DATA_05871F:
	dw $0010,$FFF0

CODE_058723:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	BNE.b CODE_058729
	RTS

CODE_058729:
	LDY.w $7400,x
	LDA.w DATA_05871B,y
	CLC
	ADC.w $7CD6,x
	SEC
	SBC.w $6094
	STA.b $0C
	LDA.w $7CD8,x
	SEC
	SBC.w $609C
	STA.b $0E
	JSL.l CODE_03AA52
	LDY.w $7400,x
	LDA.w DATA_05871B+$02,y
	STA.b $00
	LDA.w $7042,x
	AND.w #$0080
	ASL
	ASL
	XBA
	TAY
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_058760
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_058760:
	LDA.w DATA_05871F,y
	STA.b $02
	REP.b #$10
	LDY.w $7362,x
	LDA.b $18,x
	AND.w #$00FF
	CMP.w #$0080
	BCC.b CODE_058777
	ORA.w #$FF00
CODE_058777:
	CLC
	ADC.b $0C
	STA.w $6008,y
	STA.w $6018,y
	CLC
	ADC.b $00
	STA.w $6000,y
	STA.w $6010,y
	LDA.b $19,x
	AND.w #$00FF
	CMP.w #$0080
	BCC.b CODE_058796
	ORA.w #$FF00
CODE_058796:
	CLC
	ADC.b $0E
	STA.w $6012,y
	STA.w $601A,y
	SEC
	SBC.b $02
	STA.w $6002,y
	STA.w $600A,y
	SEP.b #$10
	RTS

; Walk-state X-speed table -- 4 entries indexed by ($RANDM0 & $02) + ($7A36 facing).
; Per-state speeds: +$00B3, +$0059 (face-right slow/fast), -$00B3, -$0059 (face-left).
DATA_0587AB:
DATA_clawdaddy_walk_xspeeds:
	dw $00B3,$0059,$FF4D,$FFA7

; X-launch speeds when player gets in claw range and Clawdaddy lunges --
; -$0166 (face-left) / +$0166 (face-right) lookup via $77C2,x.
DATA_0587B3:
DATA_clawdaddy_lunge_xspeeds:
	dw $FE9A,$0166

;-------------------------------------------------------------------------
; STATE 00 -- Clawdaddy walks back and forth, scans for player, decides to
; lunge.  If player is within ~$28 vertical / ~$50 horizontal of Clawdaddy
; (the inner detection box), seed lunge-X speed from DATA_clawdaddy_lunge_xspeeds
; and switch to state $0201 (state 02 = raise_claw, with $16 ducking flag).
; Otherwise apply a small angular drift to the walk-X-speed every random
; interval to keep the patrol semi-organic.  Falls through to side-collision
; check (CODE_058857: on hitting a wall, push back + flip facing).
;-------------------------------------------------------------------------
CODE_0587B7:
CODE_clawdaddy_state_walk:
	TYX
	LDA.w $7722,x                           ; cross-bank slot index
	BMI.b CODE_0587C1                       ; if invalid skip frame-flip toggle
	JSL.l CODE_03AEFD                       ; ensure walk animation/frame-flip
CODE_0587C1:
	LDA.w $7AF6,x                           ; lunge/stun cooldown still ticking?
	BNE.b CODE_clawdaddy_walk_wall_bounce                       ; yes -- skip detection
	LDA.w $7C18,x                           ; |delta-Y| vs player
	CLC
	ADC.w #$0028
	CMP.w #$0050                            ; within $28 vertical?
	BCS.b CODE_clawdaddy_walk_wall_bounce                       ; no
	LDA.w $7C16,x                           ; |delta-X| vs player
	CLC
	ADC.w #$0050
	CMP.w #$00A0                            ; within $50 horizontal?
	BCS.b CODE_clawdaddy_walk_wall_bounce                       ; no
	SEC
	SBC.w #$0030
	CMP.w #$0040
	BCC.b CODE_clawdaddy_enter_raise_claw
	LDY.w $77C2,x
	LDA.w DATA_clawdaddy_lunge_xspeeds,y
	STA.w $75E0,x
	LDA.w #$000B
	STA.w $7540,x
	LDA.w #$0010
	STA.w $7A96,x
	STZ.w $7A98,x
	BRA.b CODE_clawdaddy_walk_wall_bounce

CODE_058801:
CODE_clawdaddy_enter_raise_claw:                 ; player inside lunge box -> begin attack
	JSL.l CODE_03AD74                       ; LOS check to player (slope/wall)
	BCC.b CODE_clawdaddy_walk_wall_bounce                       ; no LOS -- stay in walk
	LDY.b #$00
	LDA.w $7C16,x                           ; signed dx to player
	BPL.b CODE_058810                       ; right-of-player -> face right (idx 0)
	INY
	INY                                     ; left-of-player  -> face left  (idx 2)
CODE_058810:
	TYA
	STA.w $7400,x                           ; commit facing direction
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x ; stop walking
	STZ.w $7540,x
	STZ.w $7A96,x
	STZ.w $7A98,x
	LDA.w #$0055                            ; $7A36,x init -- "zoom size" claw scale base
	STA.w $7A36,x
	LDA.w #$0002                            ; $78,x = 2 -- claw open/shut pattern flag
	STA.b $78,x
	LDA.w #$0010                            ; $7A38,x = $10 -- claw swing angle starting pt
	STA.w $7A38,x
	LDA.w #$0201                            ; $76 = state 02 (raise), $77 = ducking flag 02
	STA.b $76,x
CODE_058836:
	RTS

;-------------------------------------------------------------------------
; Walk-state side-collision handler -- runs whenever the player is out of
; range OR we just decided to begin attack (fall-through after target lock).
; Detects wall-impact via $7860 (side BG), bounces away + flips facing if
; needed, then applies the random walk-X-speed picked every $20-$3F frames.
;-------------------------------------------------------------------------
CODE_058837:
CODE_clawdaddy_walk_wall_bounce:
	LDA.w $7A98,x
	BNE.b CODE_058836
	LDA.w #$000B
	STA.w $7540,x
	LDA.w $7860,x
	BIT.w #$000C
	BNE.b CODE_058857
	AND.w #$0001
	BNE.b CODE_05888D
	LDA.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	AND.w #$00FF
	BNE.b CODE_05888D
CODE_058857:
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_058875
	AND.w #$FF00
	XBA
	STA.b $00
	LDA.w $7182,x
	SEC
	SBC.b $00
	STA.w $7182,x
CODE_058875:
	STZ.w $75E0,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w #$0020
	STA.w $7A98,x
	LDA.w $7A36,x
	EOR.w #$0004
	STA.w $7A36,x
CODE_05888D:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_058896
	EOR.w #$FFFF
	INC
CODE_058896:
	CLC
	ADC.w $7A38,x
	CMP.w #$0A00
	BCC.b CODE_0588AE
	PHA
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	PLA
	SEC
	SBC.w #$0A00
CODE_0588AE:
	STA.w $7A38,x
	LDA.w $7A96,x
	BNE.b CODE_0588D2
	LDA.b $10
	AND.w #$001F
	PHA
	CLC
	ADC.w #$0020
	STA.w $7A96,x
	PLA
	AND.w #$0002
	CLC
	ADC.w $7A36,x
	TAY
	LDA.w DATA_clawdaddy_walk_xspeeds,y
	STA.w $75E0,x
CODE_0588D2:
	RTS

; Claw-zoom delta table -- indexed by $77 (ducking flag).
;   $77=0 -> shrink claw by -$0018 / frame; $77=1 -> grow by +$0008.
DATA_0588D3:
DATA_clawdaddy_raise_claw_zoom:
	dw $FFE8,$0008

;-------------------------------------------------------------------------
; STATE 02 -- Clawdaddy raises one claw (scales the $7A36,x "zoom size" factor
; $7A36,x up toward $E3).  When fully raised, randomises:
;   $79,x = scissor-count (number of open/shut cycles, 4..7 derived from
;           $10 bits 0-3),
;   $76,x = state 04 (swipe_arc) with stop-timer $7A98 = $10 frames,
;   $7A36 clamped to $E3.
; When zoom falls below $55, abort the attack: random cool-down ($10..$2F
; frames) seeded into $7AF6 and return to walk (state 01).
; Always runs swipe-collision pre-check CODE_clawdaddy_claw_collision_check at end.
;-------------------------------------------------------------------------
CODE_0588D7:
CODE_clawdaddy_state_raise_claw:
	TYX
	LDA.w #$0001
	STA.w $7402,x                           ; mark "attacking" facing-mirror flag
	LDY.b $77,x                             ; $77 -- shrink/grow direction flag
	LDA.w $7A36,x                           ; current claw-zoom
	CLC
	ADC.w DATA_clawdaddy_raise_claw_zoom,y                     ; +$08 (grow) or -$18 (shrink)
	CMP.w #$00E3
	BMI.b CODE_clawdaddy_raise_abort                       ; not yet at max -> check min
	STZ.b $78,x                             ; $78,x = 0 -- claws now closed
	LDA.b $10
	PHA
	AND.w #$0002
	CLC
	ADC.w #$0004                            ; scissor-count base 4 + parity bit
	TAY
	STZ.b $16,x                             ; $16,x = 0 (swipe-flip flag normal)
	PLA
	AND.w #$0003
	BNE.b CODE_058905
	INY
	INY
	INY
	INY                                     ; bump scissor-count by 4 (8 total)
CODE_058905:
	CLC
	ADC.b $76,x
	INC
	AND.w #$00FF
	CMP.w #$0004
	BCC.b CODE_058917
	TYA
	LSR
	TAY
	LDA.w #$0004                            ; clamp -> state 04 (swipe_arc)
CODE_058917:
	STA.b $76,x                             ; advance to swipe_arc state
	STY.b $79,x                             ; remember scissor-count for later state
	LDA.w #$0010
	STA.w $7A98,x                           ; stop-timer = $10 frames
	LDA.w #$00E3
	BRA.b CODE_058946

CODE_058926:
CODE_clawdaddy_raise_abort:                      ; zoom fell below $55 -- abort attack
	CMP.w #$0055
	BPL.b CODE_058946
	STZ.w $7402,x                           ; clear "attacking" flag
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0010                            ; $10..$2F random cooldown
	STA.w $7AF6,x
	DEC.b $76,x                             ; -> state 01 (back to walk via fallthrough)
	LDY.b #$00
	LDA.w $75E0,x                           ; preserve facing direction from XSpeed sign
	BPL.b CODE_058945
	LDY.b #$04
CODE_058945:
	TYA
CODE_058946:
	STA.w $7A36,x                           ; commit clamped zoom value
	JSR.w CODE_clawdaddy_claw_collision_check                       ; check claw-vs-player collision now
CODE_05894C:
	RTS

; Swipe-arc speeds -- indexed by $16 swipe-flip flag:
;   $16=0 (normal sweep): rotate by -$10 per frame;
;   $16=2 (reverse sweep): rotate by +$20 per frame.
DATA_05894D:
DATA_clawdaddy_swipe_arc_speed:
	dw $FFF0,$0020

;-------------------------------------------------------------------------
; STATE 04 -- Claw swipe arc.  Rotates the claw's swing angle ($7A38,x)
; through fixed sweep ranges:
;   normal direction ($16=0): sweep $100..$190 (down arc, hits player);
;   reverse direction ($16=2): sweep $90..$100 (back-swing).
; When the arc completes (angle hits $0010), decrement scissor-counter
; and either advance to state 06 (scissor) or stay swinging.
; The "bubble" spit projectile (AmbSpr1D4) spawns at arc apex when
; CODE_clawdaddy_swipe_collide_and_damage reports a successful GSU connect ($02 != 0); plays SoundID45.
;-------------------------------------------------------------------------
CODE_058951:
CODE_clawdaddy_state_swipe_arc:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_05894C
	STZ.b $02
	LDY.b $16,x
	LDA.w $7A38,x
	CLC
	ADC.w DATA_clawdaddy_swipe_arc_speed,y
	AND.w #$01FE
	CPY.b #$00
	BNE.b CODE_05897A
	CMP.w #$0190
	BCS.b CODE_05898B
	CMP.w #$0100
	BCC.b CODE_05898B
	LDA.w #$0190
	LDY.b #$02
	BRA.b CODE_05898B

CODE_05897A:
	CMP.w #$0090
	BCC.b CODE_05898B
	CMP.w #$0100
	BCS.b CODE_05898B
	LDA.w #$0090
	INC.b $02
	LDY.b #$00
CODE_05898B:
	STY.b $16,x
	STA.w $7A38,x
	CMP.w #$0010
	BNE.b CODE_0589A5
	DEC.b $79,x
	LDY.b $79,x
	BNE.b CODE_0589A5
	LDA.w #$FFFF
	STA.b $16,x
	LDA.w #$0001
	STA.b $76,x
CODE_0589A5:
	JSR.w CODE_clawdaddy_swipe_collide_and_damage
	LDY.b $02
	BEQ.b CODE_058A07
	LDA.w $7182,x
	CLC
	ADC.w #$0014
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7CD6,x
	CLC
	ADC.b $00
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w #!Define_YI_SoundID45_SpitSeed
	LDY.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_058A03
	LDA.w #!Define_YI_AmbSpr1D4
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$000B
	STA.w $7E4C,y
	LDA.w #$0006
	STA.w $7782,y
	LDA.w $7CD6,x
	CLC
	ADC.b $00
	SEC
	SBC.w #$0008
	STA.w $70A2,y
	LDA.w $7CD8,x
	CLC
	ADC.w $6022
	SEC
	SBC.w #$0010
	STA.w $7142,y
	LDA.w #!Define_YI_SoundID1F_HitHead
CODE_058A03:
	JSL.l CODE_push_sound_queue
CODE_058A07:
	RTS

;-------------------------------------------------------------------------
; STATE 06 -- Scissor open/shut.  Every 4 frames flips $78,x
; between open/closed, decrements scissor-count ($79,x); when zero
; advance to state 08 (recover, $16=FFFF sentinel).  Plays SoundID37
; (flutter-jump) on each open-frame to give the "clack" cue.
; Damage gate: claw-vs-player pre-check CODE_clawdaddy_claw_collision_check returning carry-set
; means the claw connects -> CODE_03A858 (player damage routine).
;-------------------------------------------------------------------------
CODE_058A08:
CODE_clawdaddy_state_scissor:
	TYX
	LDA.w $7A98,x                           ; stop-timer still ticking?
	BNE.b CODE_058A07                       ; yes -- hold posture
	LDA.w $7A96,x                           ; scissor-pace timer (4-frame interval)
	BNE.b CODE_058A41                       ; not time to flip yet
	LDA.w #$0004
	STA.w $7A96,x                           ; reset 4-frame pace
	LDA.b $78,x                             ; claw pattern flag
	EOR.w #$0002                            ; toggle open/closed
	STA.b $78,x
	BNE.b CODE_058A29                       ; if just closed, no sound
	LDA.w #!Define_YI_SoundID37_FlutterJump ; "clack" on open-frame
	JSL.l CODE_push_sound_queue
CODE_058A29:
	DEC.b $79,x                             ; scissor-count
	LDY.b $79,x
	BNE.b CODE_058A38
	LDA.w #$FFFF
	STA.b $16,x                             ; sentinel = done scissoring
	INC
	INC
	STA.b $76,x                             ; $76 += 2 -> state 08 (recover)
CODE_058A38:
	JSR.w CODE_clawdaddy_claw_collision_check                       ; claw-collision check
	BCC.b CODE_058A41                       ; no hit
	JSL.l CODE_03A858                       ; player damage
CODE_058A41:
	RTS

;-------------------------------------------------------------------------
; STATE 08 -- Tremble / recover.  Continues to rotate $7A38 by +$10 per
; frame (using same $01FE wrap) but now in cool-down mode: when angle
; hits $0010 the scissor-count decrements; when count hits zero return
; to walk (state 0A wraps to 00 via $76 += 2).  Each non-final tick
; plays SoundID1F (hit-head) for the post-attack shudder cue.
;-------------------------------------------------------------------------
CODE_058A42:
CODE_clawdaddy_state_recover:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_058A41                       ; stop-timer holds posture
	LDA.w $7A38,x                           ; rotation angle
	CLC
	ADC.w #$0010
	AND.w #$01FE                            ; wrap mod 256
	STA.w $7A38,x
	CMP.w #$0010                            ; passed start?
	BNE.b CODE_058A72                       ; no -- just refresh claw collision
	DEC.b $79,x                             ; one shudder cycle done
	LDY.b $79,x
	BNE.b CODE_058A6B                       ; not zero -- play tick sound
	LDA.w #$FFFF
	STA.b $16,x                             ; sentinel reset
	INC
	INC
	STA.b $76,x                             ; $76 += 2 -> wraps back to walk (state 00)
	BRA.b CODE_058A72

CODE_058A6B:
	LDA.w #!Define_YI_SoundID1F_HitHead     ; shudder tick
	JSL.l CODE_push_sound_queue
CODE_058A72:
	JMP.w CODE_clawdaddy_swipe_collide_and_damage

;-------------------------------------------------------------------------
; Shared "swipe collision then damage" helper -- called by swipe_arc and
; recover states.  CODE_clawdaddy_claw_collision_check builds the claw hitbox via GSU, then if
; carry set (player overlap) jumps to player-damage CODE_03A858.
;-------------------------------------------------------------------------
CODE_058A75:
CODE_clawdaddy_swipe_collide_and_damage:
	JSR.w CODE_clawdaddy_claw_collision_check                       ; claw-collision check
	BCC.b CODE_058A7E                       ; no hit
	JSL.l CODE_03A858                       ; player damage
CODE_058A7E:
	RTS

; Claw OAM GSU pattern pointers -- indexed by $78,x claw pattern flag:
;   $78=0 -- closed claw (single-tile GSU template at $40001);
;   $78=2 -- open claw   (two-tile  GSU template at $40021).
DATA_058A7F:
DATA_clawdaddy_claw_gfx:
	dw FXDATA_540000+$4001,FXDATA_540000+$4021

; Claw-tip OAM X-offset table -- indexed by facing ($7400,x):
;   face-right: -$08; face-left: +$08.  Used to place the damage hitbox.
DATA_058A83:
DATA_clawdaddy_claw_xoffset:
	dw $FFF8,$0008

;-------------------------------------------------------------------------
; Clawdaddy claw-collision pre-check + GSU draw helper.
; Returns carry set if the swung claw overlaps the player's bounding box.
; Inputs : $7402,x ("attacking" flag) must be non-zero for the check to
;          actually run -- the early RTS path silently returns no-hit so
;          the caller can also use this routine purely as the OAM-render
;          driver (called from raise_claw / swipe_arc to draw the arm).
; Calls  : FXCODE_08D645 ("arm scale + rotate -> sub-OAM tiles"),
;          FXCODE_098F33 ("place sub-OAM at sprite slot with palette").
; Side-FX: stores claw-tip relative XY into $18-$19,x for downstream code.
;-------------------------------------------------------------------------
CODE_058A87:
CODE_clawdaddy_claw_collision_check:
	LDY.w $7402,x
	BEQ.b CODE_058A7E
	LDY.b $78,x
	LDA.w DATA_clawdaddy_claw_gfx,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$4001)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	SEC
	SBC.w #$0040
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w $7400,x
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$EC00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08D645>>16
	LDA.w #FXCODE_08D645
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	LDY.w $7400,x
	LDA.w DATA_clawdaddy_claw_xoffset,y
	CLC
	ADC.w $6020
	STA.b $00
	TAY
	STY.b $18,x
	LDY.w $6022
	STY.b $19,x
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098F33>>16
	LDA.w #FXCODE_098F33
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_058B48
	LDA.w $6120
	CLC
	ADC.w #$0008
	STA.b $0C
	ASL
	STA.b $0E
	LDA.b $00
	CLC
	ADC.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	CLC
	ADC.b $0C
	CMP.b $0E
	BCS.b CODE_058B48
	LDA.w $6122
	CLC
	ADC.w #$0008
	STA.b $0C
	ASL
	STA.b $0E
	LDA.w $6022
	CLC
	ADC.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	CLC
	ADC.b $0C
	CMP.b $0E
	BCS.b CODE_058B48
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
CODE_058B48:
	LDA.w $7C16,x
	CLC
	ADC.w $6020
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_058B6F
	LDA.w $7C18,x
	CLC
	ADC.w $6022
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_058B6F
	LDA.w $61D6
	BNE.b CODE_058B6F
	SEC
	RTS

CODE_058B6F:
	CLC
	RTS

;---------------------------------------------------------------------------

CODE_058B71:
	JSL.l CODE_03AE60
	LDA.w #$0049
	STA.w $7A36,x
	JSR.w CODE_058C74
	RTL

;---------------------------------------------------------------------------

DATA_058B7F:
	dw $FFA7,$0059

DATA_058B83:
	dw $0020,$FFE0

DATA_058B87:
	dw FXDATA_540000+$20E1,FXDATA_540000+$0041

CODE_058B8B:
	JSL.l CODE_03AA52
	JSL.l CODE_03AF23
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0003
	BEQ.b CODE_058BA3
	RTL

CODE_058BA3:
	SEP.b #$20
	LDA.b #$04
	STA.w $74A2,x
	REP.b #$20
	LDA.w #$0002
	STA.w $7540,x
	STA.w $7542,x
	LDA.w $7400,x
	EOR.w $60C4
	BNE.b CODE_058BD0
	STZ.w $7542,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7A98,x
	LDY.b #$02
	BRA.b CODE_058BFE

CODE_058BD0:
	LDA.w $7A98,x
	BNE.b CODE_058BFC
	LDA.w #$0040
	STA.w $7A98,x
	LDA.b $10
	PHA
	AND.w #$0001
	BEQ.b CODE_058BEC
	LDY.w $77C2,x
	LDA.w DATA_058B7F,y
	STA.w $75E0,x
CODE_058BEC:
	PLA
	XBA
	AND.w #$0001
	BEQ.b CODE_058BFC
	LDY.w $77C3,x
	LDA.w DATA_058B7F,y
	STA.w $75E2,x
CODE_058BFC:
	LDY.b #$00
CODE_058BFE:
	LDA.w $7A36,x
	CLC
	ADC.w DATA_058B83,y
	CMP.w #$00E3
	BMI.b CODE_058C0F
	LDA.w #$00E3
	BRA.b CODE_058C17

CODE_058C0F:
	CMP.w #$0049
	BPL.b CODE_058C17
	LDA.w #$0049
CODE_058C17:
	STA.w $7A36,x
	LDA.w $7C16,x
	EOR.w #$FFFF
	INC
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7C18,x
	EOR.w #$FFFF
	INC
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w #$0080
	CMP.w #$0100
	BCS.b CODE_058C58
	LDA.w #$0002
	STA.w $7400,x
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	EOR.w #$FFFF
	INC
	CLC
	ADC.w #$0100
	BRA.b CODE_058C5E

CODE_058C58:
	STZ.w $7400,x
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
CODE_058C5E:
	AND.w #$01FE
	STA.w $7A38,x
	JSR.w CODE_058C74
	LDA.w $6020
	CMP.w #$0002
	BNE.b CODE_058C73
	JSL.l CODE_03A858
CODE_058C73:
	RTL

CODE_058C74:
	LDA.w #(FXDATA_540000+$0041)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w DATA_058B87,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w $7C16,x
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w $7C18,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $61D6
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$1A00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08D67A>>16
	LDA.w #FXCODE_08D67A
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; LAVA BUBBLES (sprites $080 Straight-jump / $081 Following-arc).
; Raidenthequick: init_lava_bubble / main_lava_bubble /
;                 init_lava_bubble_arcing.
; Two variants: $080 jumps straight up out of lava; $081 follows an arc
; tracking the player. Both share the Main loop body.
;=========================================================================

;-------------------------------------------------------------------------
; Straight Lava Bubble Init -- snapshots the spawn Y as the launch base.
;-------------------------------------------------------------------------
YI_NorSpr080_StraightLavaBubble_Init:
init_lava_bubble:                           ; Raidenthequick: init_lava_bubble
;$058CC6
	LDA.w $7182,x                           ; remember spawn Y as resting lava-line
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $7863,x
	REP.b #$20
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Lava Bubble state ptr (state $76,x doubled): 00=in flight, 02=in lava.
;-------------------------------------------------------------------------
DATA_058CD6:
DATA_lava_bubble_state_ptr:
	dw CODE_058D45                          ; 00 = in flight
	dw CODE_058D82                          ; 02 = sinking back into lava

;-------------------------------------------------------------------------
; Lava Bubble Main (shared $080 + $081).
;-------------------------------------------------------------------------
YI_NorSpr080_StraightLavaBubble_Main:
YI_NorSpr081_FollowingLavaBubble_Main:
main_lava_bubble:                           ; Raidenthequick: main_lava_bubble
;$058CDA
	LDA.w $7722,x
	BMI.b CODE_058CE3
	JSL.l CODE_03AA52
CODE_058CE3:
	JSL.l CODE_03AF23
	LDY.w $7D36,x
	BPL.b CODE_058CF2
	JSL.l CODE_03A858
	BRA.b CODE_058CF8

CODE_058CF2:
	JSL.l CODE_0DC14C
	BCS.b CODE_058D40
CODE_058CF8:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr080_StraightLavaBubble
	BEQ.b CODE_058D03
	JMP.w CODE_058E5F

CODE_058D03:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_lava_bubble_state_ptr,x)
	LDY.b $76,x
	BEQ.b CODE_058D40
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0020
	CMP.w #$0100
	BMI.b CODE_058D3D
	AND.w #$00FF
	PHA
	LDA.w #!Define_YI_AmbSpr1D6
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0003
	STA.w $7E4C,y
	ASL
	STA.w $7782,y
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	PLA
CODE_058D3D:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_058D40:
	RTL

DATA_058D41:
	dw $0009,$0012

CODE_058D45:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_058D81
	JSL.l CODE_03AD74
	BCC.b CODE_058D81
	LDA.b $10
	AND.w #$0002
	STA.b $78,x
	TAY
	LDA.w DATA_058D41,y
	STA.w $7542,x
	LDA.w #$FD34
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID39_PiranhaPlantMunch
	JSL.l CODE_push_sound_queue
	SEP.b #$20
	LDA.w $7042,x
	AND.b #$7F
	STA.w $7042,x
	LDA.b #$02
	STA.w $74A2,x
	REP.b #$20
	STZ.b $18,x
	INC.b $76,x
CODE_058D81:
	RTS

CODE_058D82:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w $7182,x
	BPL.b CODE_058DAA
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	JSL.l CODE_03AEFD
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A2,x
	REP.b #$20
	LDA.w #$0060
	STA.w $7A98,x
	DEC.b $76,x
	RTS

CODE_058DAA:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_058DB5
	EOR.w #$FFFF
	INC
	BRA.b CODE_058DC9

CODE_058DB5:
	LDY.b $18,x
	BNE.b CODE_058DC9
	PHA
	INC.b $18,x
	SEP.b #$20
	LDA.w $7042,x
	ORA.b #$80
	STA.w $7042,x
	REP.b #$20
	PLA
CODE_058DC9:
	LSR
	CMP.w #$0080
	BPL.b CODE_058DD4
	LDA.w #$0080
	BRA.b CODE_058DDC

CODE_058DD4:
	CMP.w #$0200
	BMI.b CODE_058DDC
	LDA.w #$01FF
CODE_058DDC:
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #(FXDATA_548000+$00B0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_548000+$00B0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
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
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Following (arcing) Lava Bubble Init -- spawns with arc that tracks
; the player's X horizontally instead of jumping straight up.
;-------------------------------------------------------------------------
YI_NorSpr081_FollowingLavaBubble_Init:
init_lava_bubble_arcing:                    ; Raidenthequick: init_lava_bubble_arcing
;$058E1B
	LDA.w $7182,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $7863,x
	REP.b #$20
	RTL

;---------------------------------------------------------------------------

DATA_058E2B:
DATA_lava_bubble_arc_state_ptr:                  ; 6-entry $76,x sub-state dispatch (FollowingLavaBubble $081)
	dw CODE_058F11                                ;  0: submerged in lava (rest)
	dw CODE_058F57                                ;  1: tracking-arc rise
	dw CODE_05908F                                ;  2: apex / fall toward Yoshi
	dw CODE_0590B4                                ;  3: descend / fall arc
	dw CODE_059118                                ;  4: splash settle
	dw CODE_059151                                ;  5: post-splash cooldown

DATA_058E37:
	dw $0080,$0100,$0180,$0200,$FF80,$FF00,$FE80,$FE00

DATA_058E47:
	dw $0008,$0000

DATA_058E4B:
	dw $FFFF,$FFFF,$0008,$0000

DATA_058E53:
	dw $0008,$FFF8

DATA_058E57:
	dw $0000,$0000,$0008,$FFF8

CODE_058E5F:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_lava_bubble_arc_state_ptr,x)
	LDY.b $76,x
	BNE.b CODE_058E6C
CODE_058E6B:
	RTL

CODE_058E6C:
	CPY.b #$03
	BEQ.b CODE_058E7C
	CPY.b #$04
	BEQ.b CODE_058E7C
	LDA.w $0030
	AND.w #$0007
	BNE.b CODE_058E6B
CODE_058E7C:
	LDA.w #!Define_YI_AmbSpr1D6
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0003
	STA.w $7E4C,y
	ASL
	STA.w $7782,y
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.b $76,x
	CMP.w #$0003
	BEQ.b CODE_058EA5
	CMP.w #$0004
	BNE.b CODE_058F0C
CODE_058EA5:
	PHY
	LDY.b $16,x
	LDA.w DATA_058E53,y
	STA.b $08
	LDA.w DATA_058E57,y
	STA.b $0A
	LDA.w DATA_058E47,y
	BPL.b CODE_058EC2
	LDA.w $7974
	AND.w #$0001
	BEQ.b CODE_058EC2
	LDA.w #$0008
CODE_058EC2:
	STA.b $04
	LDA.w DATA_058E4B,y
	BPL.b CODE_058ED4
	LDA.w $7974
	AND.w #$0001
	BEQ.b CODE_058ED4
	LDA.w #$0008
CODE_058ED4:
	STA.b $06
	LDA.b $10
	PHA
	AND.w #$0006
	CLC
	ADC.b $04
	TAY
	LDA.w DATA_058E37,y
	STA.b $00
	PLA
	XBA
	AND.w #$0006
	CLC
	ADC.b $06
	TAY
	LDA.w DATA_058E37,y
	PLY
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w $70A2,y
	CLC
	ADC.b $08
	STA.w $70A2,y
	LDA.w $7142,y
	CLC
	ADC.b $0A
	STA.w $7142,y
CODE_058F0C:
	RTL

DATA_058F0D:
	dw $FF4D,$00B3

CODE_058F11:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_058F47
	JSL.l CODE_03AD74
	BCC.b CODE_058F47
	LDA.w $77C2,x
	TAY
	STY.b $77,x
	LDA.w DATA_058F0D,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FD34
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0009
	STA.w $7542,x
	SEP.b #$20
	LDA.b #$02
	STA.w $74A2,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID39_PiranhaPlantMunch
	JSL.l CODE_push_sound_queue
	INC.b $76,x
CODE_058F47:
	RTS

DATA_058F48:
	db $04,$06,$06,$00,$FF,$FF,$06,$02,$FF,$FF,$06,$00,$00,$FF,$06

CODE_058F57:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w $7182,x
	BPL.b CODE_058F82
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	JSL.l CODE_03AEFD
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A2,x
	REP.b #$20
	LDA.w #$0060
	STA.w $7A98,x
	DEC.b $76,x
	RTS

CODE_058F82:
	LDA.w #$0001
	LDY.w $7223,x
	BPL.b CODE_058F8B
	INC
CODE_058F8B:
	ORA.w #$0004
	LDY.w $7221,x
	BPL.b CODE_058F96
	EOR.w #$000C
CODE_058F96:
	TAY
	AND.w $7860,x
	BEQ.b CODE_059008
	STY.b $02
	TAY
	LDA.w DATA_058F48-$01,y
	AND.w #$00FF
	CMP.w #$00FF
	BNE.b CODE_058FD4
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_058FB3
	EOR.w #$FFFF
	INC
CODE_058FB3:
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_058FBE
	EOR.w #$FFFF
	INC
CODE_058FBE:
	CMP.b $00
	BPL.b CODE_058FCB
	LDA.b $02
	AND.w #$0008
	LSR
	LSR
	BRA.b CODE_058FD4

CODE_058FCB:
	LDA.b $02
	AND.w #$0002
	CLC
	ADC.w #$0004
CODE_058FD4:
	STA.b $16,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $7A36,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BPL.b CODE_058FEA
	EOR.w #$FFFF
	INC
	BRA.b CODE_058FFA

CODE_058FEA:
	CMP.w #$0100
	BPL.b CODE_058FFA
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$00C0
	STA.b $18,x
CODE_058FFA:
	STA.b $78,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	INC.b $76,x
	RTS

CODE_059008:
	JSR.w CODE_058073
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w #$0080
	AND.w #$01FE
	STA.w $7A38,x
	STZ.w $7400,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_05901E:
	BPL.b CODE_059024
	EOR.w #$FFFF
	INC
CODE_059024:
	LSR
	CMP.w #$0080
	BPL.b CODE_05902F
	LDA.w #$0080
	BRA.b CODE_059037

CODE_05902F:
	CMP.w #$0200
	BMI.b CODE_059037
	LDA.w #$01FE
CODE_059037:
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	STA.w $6022
	LSR
	LSR
	LSR
	STA.b $00
	LDA.w #$0110
	SEC
	SBC.b $00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	STA.w $6024
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #(FXDATA_548000+$00B0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_548000+$00B0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	PHX
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	PLX
	LDX.b #FXCODE_08855F>>16
	LDA.w #FXCODE_08855F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	LDY.b $76,x
	CPY.b #$01
	BNE.b CODE_05908E
	LDA.w $6022
	STA.b $18,x
CODE_05908E:
	RTS

CODE_05908F:
	TYX
	LDA.b $78,x
	SEC
	SBC.w #$00A0
	STA.b $78,x
	JSR.w CODE_05901E
	LDA.w $6022
	CMP.w #$0080
	BNE.b CODE_0590AB
	LDA.w $6024
	STA.w $7A38,x
	INC.b $76,x
CODE_0590AB:
	RTS

DATA_0590AC:
	dw $00C0,$0040,$0080,$0000

CODE_0590B4:
	TYX
	LDA.w $7A38,x
	CLC
	ADC.w #$0020
	CMP.w #$0154
	BMI.b CODE_0590C6
	INC.b $76,x
	LDA.w #$0154
CODE_0590C6:
	STA.w $7A38,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0200
	SEC
	SBC.w !REGISTER_SuperFX_R6_MultiplierLo
	LSR
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #(FXDATA_548000+$00B0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_548000+$00B0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDY.b $16,x
	LDA.w DATA_0590AC,y
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000A
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08855F>>16
	LDA.w #FXCODE_08855F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	RTS

CODE_059118:
	TYX
	LDA.w $7A38,x
	SEC
	SBC.w #$0060
	CMP.w #$0100
	BPL.b CODE_0590C6
	LDA.w $7A36,x
	LDY.b $16,x
	CPY.b #$04
	BCS.b CODE_059132
	EOR.w #$FFFF
	INC
CODE_059132:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CPY.b #$04
	BCC.b CODE_059140
	EOR.w #$FFFF
	INC
CODE_059140:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0009
	STA.w $7542,x
	LDA.w #$0010
	STA.b $78,x
	INC.b $76,x
	RTS

CODE_059151:
	TYX
	JSR.w CODE_058073
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w #$0080
	AND.w #$01FE
	STA.w $7A38,x
	STZ.w $7400,x
	LDA.b $78,x
	CLC
	ADC.w #$0060
	STA.b $78,x
	JSR.w CODE_05901E
	LDA.w $6022
	DEC
	CMP.b $18,x
	BMI.b CODE_05917C
	LDY.b #$01
	STY.b $76,x
CODE_05917C:
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; CHAIN CHOMP (sprite $082) -- the chained jumping-chomp.  Anchored to a
; fixed post at spawn-X+4 (stored in $0DFD), the chomp body lunges toward
; Yoshi whenever he comes within range of the chain length.
;
; CHAIN-SEGMENT DATA MODEL (level-scope WRAM, single-instance only!):
;   $0DFD/$0DFF/$0E01/$0E03   -- chain-segment X-positions, head -> tail
;   $0E05/$0E07/$0E09/$0E0B   -- chain-segment Y-positions, head -> tail
;   $0E0D                     -- target zoom for in-air sweep    (state 08)
;   $0E0F                     -- saved X-speed during lunge       (state 02)
;   $0E11                     -- chain-rumble OAM-jitter timer (16 frames; drives CODE_chain_chomp_rumble_loop)
;   $0E13                     -- "alive" flag (cleared on player damage frame)
;   All four segments are seeded at spawn coords + 8 Y-offset by Init; per
;   frame the CODE_chain_chomp_update_chain helper interpolates them between the anchor and
;   the body's current XY via GSU (FXCODE_08D776 family).  Because the
;   addresses are bank-scope (not per-sprite-slot indexed), only one Chain
;   Chomp can be alive at a time -- a second instance would overwrite the
;   first's chain.
;
; STATE DISPATCH ($76,x doubled, DATA_chain_chomp_state_ptr):
;   00 -- anchor idle / scan for player              (CODE_chain_chomp_state_idle)
;   02 -- pre-lunge bounce-on-ground wind-up         (CODE_chain_chomp_state_windup)
;   04 -- lunge snap-shut at apex                    (CODE_chain_chomp_state_snap)
;   06 -- chain-retract / tail-wag transition        (CODE_chain_chomp_state_chain_retract)
;   08 -- airborne forward lunge arc                 (CODE_chain_chomp_state_lunge)
;   0A -- recoil back to anchor / settle             (CODE_chain_chomp_state_recoil)
;
; The GSU tables at DATA_chain_chomp_gfx_ptrs supply per-frame chain-segment GFX ptrs
; (head animation $1080/$1090/$10A0/$1090 + tail base $4000/$4020/$4040/
; $4020), selected via the per-segment counter $18,x.
; see also: ys_enmy4.asm.
; Raidenthequick: init_chain_chomp / main_chain_chomp.
;=========================================================================

;-------------------------------------------------------------------------
; Chain Chomp Init -- standard sprite init, then build the 4-segment chain
; (all segments share the spawn anchor coord at +4X/+8Y), seed head-zoom
; at $0100 (anchor scale = body-touching), clear the alive flag $0E13,
; and run the chain-render helper once to settle OAM.
;-------------------------------------------------------------------------
YI_NorSpr082_ChainChomp_Init:
init_chain_chomp:                           ; Raidenthequick: init_chain_chomp
;$05917D
	JSL.l CODE_03AE60                       ; standard sprite init
	LDA.w $70E2,x                           ; spawn-X
	CLC
	ADC.w #$0004                            ; anchor stake = spawn-X + 4
	STA.w $0DFD                             ; chain seg 0 X (head)
	STA.w $0DFF                             ; chain seg 1 X
	STA.w $0E01                             ; chain seg 2 X
	STA.w $0E03                             ; chain seg 3 X (tail, at stake)
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x ; anchor-X cache
	LDA.w $7182,x                           ; spawn-Y
	CLC
	ADC.w #$0008                            ; chain Y origin = spawn-Y + 8
	STA.w $0E05                             ; chain seg 0 Y (head)
	STA.w $0E07                             ; chain seg 1 Y
	STA.w $0E09                             ; chain seg 2 Y
	STA.w $0E0B                             ; chain seg 3 Y (tail)
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x ; anchor-Y cache
	LDA.w #$0100                            ; head zoom = anchor-attached
	STA.w $7A36,x
	STZ.w $0E13                             ; alive flag clear (no recent damage)
	JSR.w CODE_chain_chomp_update_chain                       ; settle chain render once
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Chain Chomp main dispatch table (state $76,x doubled).
; Bite cycle: anchor-wait -> ground bounce wind-up -> snap-shut on apex ->
;             chain retracts as body returns -> airborne lunge arc ->
;             recoil back to settle at anchor.
;-------------------------------------------------------------------------
DATA_0591BA:
DATA_chain_chomp_state_ptr:
	dw CODE_chain_chomp_state_idle                          ; 00 -- anchor idle / scan player
	dw CODE_chain_chomp_state_windup                          ; 02 -- pre-lunge bounce wind-up
	dw CODE_chain_chomp_state_snap                          ; 04 -- snap-shut at apex (no motion)
	dw CODE_chain_chomp_state_chain_retract                          ; 06 -- chain-retract transition
	dw CODE_chain_chomp_state_lunge                          ; 08 -- airborne lunge arc
	dw CODE_chain_chomp_state_recoil                          ; 0A -- recoil back to anchor

;-------------------------------------------------------------------------
; Chain-segment GSU GFX pointers -- 4-frame head animation + 4-frame tail
; (anchor post) animation in one combined table.  Selected by per-segment
; counter $18,x via DATA_chain_chomp_gfx_ptrs,y in CODE_chain_chomp_update_chain:
;   index 0..3 -- chomp head body frames at $1080/$1090/$10A0/$1090
;   index 4..7 -- anchor stake frames     at $4000/$4020/$4040/$4020
; The bank constant FXDATA_548000>>16 is also written separately so all
; entries are routed through the same SuperFX cluster.
;-------------------------------------------------------------------------
DATA_0591C6:
DATA_chain_chomp_gfx_ptrs:
	dw FXDATA_548000+$1080,FXDATA_548000+$1090,FXDATA_548000+$10A0,FXDATA_548000+$1090
	dw FXDATA_548000+$4000,FXDATA_548000+$4020,FXDATA_548000+$4040,FXDATA_548000+$4020

;-------------------------------------------------------------------------
; Idle-state X-speed lookup -- indexed by "player vs anchor" side bit:
;   index 0 -- player is to the right of anchor -> +$0200 / frame
;   index 1 -- player is to the left            -> -$0200 / frame
; Used to "pull" the body toward the player along the ground each frame
; while the bite-cooldown timer $7540 is still running down.
;-------------------------------------------------------------------------
DATA_0591D6:
DATA_chain_chomp_idle_xspeeds:
	dw $0200,$FE00

;-------------------------------------------------------------------------
; Chain Chomp Main -- always-active body.
; Top: pick OAM stride ($08) based on $7041 (large-OAM vs small-OAM mode)
;   then optionally blink the chomp on damage frames via $0A = $8000 XOR.
; Middle: in states 02..0A (airborne) with $0E11 ground-clear timer set,
;   route OAM coords through the per-segment "rumble" jitter loop
;   CODE_chain_chomp_rumble_loop (randomises +0/+1 px on X and Y for body shake).
; Lower: standard collision/gravity (CODE_03AF23), dispatch state, refresh
;   chain via CODE_chain_chomp_update_chain, then process side-BG bounce-back and damage
;   handoff if a Yoshi-shot connects (CODE_chain_chomp_handle_shot_damage path).
;-------------------------------------------------------------------------
YI_NorSpr082_ChainChomp_Main:
main_chain_chomp:                           ; Raidenthequick: main_chain_chomp
;$0591DA
	LDY.w $7041,x
	BPL.b CODE_0591E8
	JSL.l CODE_03ABFA
	LDA.w #$0080
	BRA.b CODE_0591EF

CODE_0591E8:
	JSL.l CODE_03AA52                       ; small-OAM mode -- player delta + facing
	LDA.w #$0020                            ; OAM stride for small mode
CODE_0591EF:
	STA.b $08                               ; cache stride
	STZ.b $0A                               ; clear blink mask
	LDY.b $78,x                             ; $78,x -- damage-blink/pattern flag
	BEQ.b CODE_chain_chomp_oam_loop
	CPY.b #$02
	BPL.b CODE_chain_chomp_oam_loop
	LDA.w $7974                             ; frame counter
	AND.w #$0004
	BNE.b CODE_chain_chomp_oam_loop
	LDA.w #$8000                            ; flip palette XOR for blink
	STA.b $0A
CODE_059208:
CODE_chain_chomp_oam_loop:                       ; pour chain segments into OAM
	PHX
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.b $08
	TAY                                     ; Y = OAM start + stride
	LDA.b $76,x
	CMP.w #$0002
	BMI.b CODE_chain_chomp_oam_quiet                       ; state 00 (idle) -- no rumble
	LDA.w $0E11                             ; ground-clip rumble timer
	BEQ.b CODE_chain_chomp_oam_quiet                       ; expired -- no rumble
	LDX.w #$0006
;-------------------------------------------------------------------------
; Per-segment rumble jitter loop -- adds 0/+1 px X/Y from RNG $10 to each
; chain segment's OAM position to give the airborne chomp visible shake.
; Iterates X = 6 down to 0 (4 segments * 2 bytes per coord-pair stride).
;-------------------------------------------------------------------------
CODE_059221:
CODE_chain_chomp_rumble_loop:
	LDA.b $10
	PHA
	AND.w #$0001                            ; jitter X by 0 or 1 px
	CLC
	ADC.w $0DFD,x                           ; segment X
	SEC
	SBC.w $6094                             ; minus camera X
	STA.w $6000,y                           ; OAM X
	PLA
	PHA
	XBA
	AND.w #$0001                            ; jitter Y by 0 or 1 px
	CLC
	ADC.w $0E05,x                           ; segment Y
	SEC
	SBC.w $609C                             ; minus camera Y
	STA.w $6002,y                           ; OAM Y
	TYA
	CLC
	ADC.w #$0008                            ; next OAM entry
	TAY
	PLA
	LSR
	STA.b $10                               ; advance RNG by 1 bit
	DEX
	DEX
	BPL.b CODE_chain_chomp_rumble_loop
	BRA.b CODE_059280

;-------------------------------------------------------------------------
; Non-rumble segment OAM emit (idle / pre-airborne states) -- straight
; copy of segment XY to OAM, with palette XOR ($0A blink mask) applied.
;-------------------------------------------------------------------------
CODE_059253:
CODE_chain_chomp_oam_quiet:
	LDX.w #$0006
CODE_059256:
CODE_chain_chomp_quiet_loop:
	LDA.w $0DFD,x
	SEC
	SBC.w $6094
	CLC
	ADC.b $0A
	STA.w $6000,y
	LDA.w $0E05,x
	SEC
	SBC.w $609C
	STA.w $6002,y
	LDA.w $6004,y
	AND.w #$3FFF
	STA.w $6004,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEX
	DEX
	BPL.b CODE_chain_chomp_quiet_loop
CODE_059280:
	SEP.b #$10
	PLX
	JSL.l CODE_03AF23                       ; standard collision/gravity
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_chain_chomp_state_ptr,x)                   ; dispatch by state
	JSR.w CODE_chain_chomp_update_chain                       ; refresh chain segments
	STZ.w $7540,x
	LDA.w $603C                             ; was alive flag set this frame?
	STA.w $0E13
	BEQ.b CODE_0592FC
	LDA.w #$0010
	STA.w $0E11                             ; arm 16-frame chain-rumble OAM-jitter timer
	LDY.w $7223,x
	BPL.b CODE_chain_chomp_idle_pull
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x                           ; rewind Y by gravity delta
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0592B5:
CODE_chain_chomp_idle_pull:                      ; in idle, pull body toward player
	LDY.b $76,x
	CPY.b #$02
	BPL.b CODE_chain_chomp_xspeed_brake                       ; airborne -- skip pull
	LDA.w $7860,x
	LSR
	BCS.b CODE_chain_chomp_xspeed_brake                       ; on wall -- skip pull
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.w #$0004
	CMP.w $70E2,x                           ; anchor X vs body X
	BPL.b CODE_0592D1
	INY
	INY                                     ; player on left -> negative pull
CODE_0592D1:
	LDA.w DATA_chain_chomp_idle_xspeeds,y                     ; +/-$0200 pull speed
	STA.w $75E0,x
	LDA.w #$0020
	STA.w $7540,x
	BRA.b CODE_059304

CODE_0592DF:
CODE_chain_chomp_xspeed_brake:                   ; airborne: brake when crossing anchor
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0004
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0592FC                       ; same sign -- no brake
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x                           ; rewind X
	STA.w $70E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0592FC:
	LDA.w $0E11
	BEQ.b CODE_059304
	DEC.w $0E11                             ; tick rumble timer down
CODE_059304:
	LDY.b $76,x
	CPY.b #$04
	BMI.b CODE_chain_chomp_handle_shot_damage                       ; idle / windup -- run shot-vs-player handoff
	RTL

;-------------------------------------------------------------------------
; Shot-vs-player damage handoff (state < 04 only).  When the player is
; standing on a Yoshi egg-shot that intercepts the chomp during anchor
; idle, throw the chomp upward + sideways at the shot's speed (clamped
; to +-$0200 X) and snap the chomp into state 02 with hop-flag $01 so
; the windup short-circuits to anchor cooldown.
;-------------------------------------------------------------------------
CODE_05930B:
CODE_chain_chomp_handle_shot_damage:
	JSL.l CODE_03A5B7                       ; standard collision check
	LDY.w $7D36,x
	DEY
	BMI.b CODE_059371
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_059371
	LDA.w $7D38,y
	BEQ.b CODE_059371
	LDA.w $7040,y
	LSR
	PHP
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	PLP
	BCS.b CODE_059339
	CMP.w #$8000
	ROR
CODE_059339:
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$0200
	BMI.b CODE_059345
	LDA.w #$0200
CODE_059345:
	CMP.w #$FE00
	BPL.b CODE_05934D
	LDA.w #$FE00
CODE_05934D:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FB00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	TYX
	LDA.w #!Define_YI_SoundID79_HurtGhost
	JSL.l CODE_push_sound_queue
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDA.w #$0001
	STA.b $16,x
	LDY.b #$01
	STY.b $76,x
CODE_059371:
	RTL

;-------------------------------------------------------------------------
; Chain Chomp chain-segment render helper.
; Snapshots the 4 chain segments ($0DFD/$0E05 series) into GSU scratch
; ($6020..), kicks the appropriate GSU routine based on current state +
; relative position to anchor + ground-clip flag, then writes the GSU's
; updated segment positions back to $0DFD/$0E05.
; GSU routine choice:
;   state 06 (chain_retract)             -> FXCODE_08D776 (straighten)
;   state 02..0A airborne, above-anchor  -> FXCODE_08D776 or FXCODE_08D883/F0
;     (08D883 when alive flag $0E13 set; 08D8F0 when cleared)
;   state >=04 fully airborne            -> FXCODE_08D7FA (full arc bend)
;
; FXCODE_08D883 vs FXCODE_08D8F0 visual difference (verified by reading
; SuperFX bodies at yi/SuperFX/Banks/Bank08.asm:13274 and :13345):
;   - 08D883 (alive): segments interpolate smoothly between anchor and
;     body in BOTH X and Y via DIV2 (the WITH R1 ADD #4 + WITH R2 ADD #4
;     prelude + symmetric per-axis DIV2 loop) -- the chain bends in a
;     natural curve as the body sweeps through the lunge arc.
;   - 08D8F0 (just-hit, $0E13 cleared): only Y interpolates via DIV2;
;     X uses a clamp-to-body computation (LDW (R4), conditional branch on
;     segment_X - body_X sign, compare |diff| against R10, snap to body_X
;     +/- R10 if exceeded -- the CODE_08D92C / CODE_08D938 branches).
;     Effect: the chain "collapses" / whips toward the body in X while
;     still trailing in Y -- the on-hit recoil animation.
; R10 (the clamp half-width) is loaded by the SNES-side caller before
; the JSL to !RAM_YI_Global_BeginSuperFXProcessingRt; see CODE_05945A
; siblings.  No sound trigger; both routines are visual-only.
;-------------------------------------------------------------------------
CODE_059372:
CODE_chain_chomp_update_chain:
	LDY.b $76,x
	CPY.b #$02
	BNE.b CODE_05938D
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_059388
	LDA.w $7860,x
	LSR
	BCS.b CODE_059394
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_059394
CODE_059388:
	JSR.w CODE_058073                       ; shared speed-vector morph (CODE_sprite_player_delta_facing family)
	BRA.b CODE_059394

CODE_05938D:
	CPY.b #$04
	BPL.b CODE_059394
	STZ.w $7A38,x                           ; in pre-arc states, clear arc accumulator
CODE_059394:
	LDY.b #$06
CODE_059396:
	LDA.w $0DFD,y
	STA.w $6020,y
	LDA.w $0E05,y
	STA.w $6028,y
	DEY
	DEY
	BPL.b CODE_059396
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.w #$0004
	BPL.b CODE_0593C9
	EOR.w #$FFFF
	INC
CODE_0593C9:
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEC
	SBC.w #$0008
	BPL.b CODE_0593E0
	EOR.w #$FFFF
	INC
CODE_0593E0:
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$1000
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	XBA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w $7402,x
	STA.w $6040
	LDA.b $76,x
	LSR
	DEC
	STA.w $6042
	LDA.w $7A36,x
	STA.w $604C
	LDA.w $7A38,x
	LSR
	STA.w $604A
	LDY.b $18,x
	LDA.w #(FXDATA_548000+$1080)>>16
	STA.w $605A
	LDA.w DATA_chain_chomp_gfx_ptrs,y
	STA.w $6058
	PHX
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w $6046
	LDA.l DATA_03A9EE,x
	STA.w $6044
	PLX
	LDY.b $76,x
	CPY.b #$03
	BEQ.b CODE_05945A
	CPY.b #$02
	BPL.b CODE_059465
	LDA.w $7182,x
	CLC
	ADC.w #$0007
	CMP.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	BMI.b CODE_05945A
	LDY.w $0E13
	BEQ.b CODE_05944F
	LDX.b #FXCODE_08D883>>16
	LDA.w #FXCODE_08D883
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_05946E

CODE_05944F:
	LDX.b #FXCODE_08D8F0>>16
	LDA.w #FXCODE_08D8F0
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_05946E

CODE_05945A:
	LDX.b #FXCODE_08D776>>16
	LDA.w #FXCODE_08D776
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_05946E

CODE_059465:
	LDX.b #FXCODE_08D7FA>>16
	LDA.w #FXCODE_08D7FA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_05946E:
	LDX.b $12
	INC.w $0CF9
	LDY.b #$06
CODE_059475:
	LDA.w $6020,y
	STA.w $0DFD,y
	LDA.w $6028,y
	STA.w $0E05,y
	DEY
	DEY
	BPL.b CODE_059475
	RTS

; Long-range surprise-lunge X-speeds -- indexed by face-direction:
;   face-right: -$0180; face-left: +$0180.  Used by CODE_chain_chomp_state_idle
;   when the player triggers a surprise overhead lunge instead of patrol.
DATA_059486:
DATA_chain_chomp_surprise_xspeeds:
	dw $FE80,$0180

; Close-range bite lunge X-speeds -- indexed by face-direction:
;   face-right: -$0500; face-left: +$0500.  Used when the player is in
;   the chomp's immediate strike zone.
DATA_05948A:
DATA_chain_chomp_bite_xspeeds:
	dw $FB00,$0500

;-------------------------------------------------------------------------
; STATE 00 -- Anchor idle.  Anchored body waits and scans for player.
; If post-bite cooldown $7AF6 is still active, slide ground X-speed back
; to zero on wall-hit and recenter via CODE_chain_chomp_chain_anim_fast.  Otherwise check if
; player is within +-$40 horizontal: if not, randomise an X-step + leap;
; if yes, kick into bite (state 04) via close-range lunge.  The branch at
; $0594D3 chooses between a "telegraphed leap" path (DATA_chain_chomp_surprise_xspeeds) and an
; "immediate bite" path (DATA_chain_chomp_bite_xspeeds) based on RNG bits in $10.
;-------------------------------------------------------------------------
CODE_05948E:
CODE_chain_chomp_state_idle:
	TYX
	LDA.w $7AF6,x                           ; bite cooldown timer
	BEQ.b CODE_0594A1                       ; expired -- scan for player
	LDA.w $7860,x                           ; side BG flag
	LSR
	BCC.b CODE_05949D                       ; no wall -- centre
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x ; wall hit -- stop
CODE_05949D:
	JSR.w CODE_chain_chomp_chain_anim_fast                       ; centre body toward anchor
	RTS

CODE_0594A1:
	LDA.w $7C16,x                           ; |dx| to player
	CLC
	ADC.w #$0040
	CMP.w #$0080                            ; within +-$40 px horizontally?
	BCC.b CODE_0594D9                       ; yes -- skip surprise-leap branch
	LDA.b $10                               ; RNG -- pick surprise-leap?
	BIT.w #$0003
	BEQ.b CODE_chain_chomp_choose_facing
	PHA
	AND.w #$0003
	INC
	STA.b $16,x                             ; leap count
	PLA
	XBA
	AND.w #$0002
	STA.w $7400,x                           ; facing for leap
	TAY
	LDA.w DATA_chain_chomp_surprise_xspeeds,y                     ; surprise X-speed
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FE00                            ; leap Y-speed (-$0200)
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	JMP.w CODE_059561                       ; -> $76 += 2 (state 02 windup)

CODE_0594D3:
CODE_chain_chomp_choose_facing:                  ; either RNG-pick or face-player
	XBA
	BIT.w #$0003
	BEQ.b CODE_0594DE
CODE_0594D9:
	LDY.w $77C2,x                           ; face toward player
	BRA.b CODE_0594E5

CODE_0594DE:
	LDA.w $7400,x
	EOR.w #$0002                            ; face away from current facing
	TAY
CODE_0594E5:
	LDA.w DATA_chain_chomp_bite_xspeeds,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $0E0F
	TYA
	STA.w $7400,x
	LDA.b $10
	PHP
	AND.w #$01FF
	CLC
	ADC.w #$0300
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	PLP
	BMI.b CODE_chain_chomp_idle_bark
	LDA.w #$0080
	STA.w $7A36,x
	STZ.w $7A38,x
	LDA.w #$01FE
	STA.w $0E0D
	LDA.w #$0050
	STA.b $16,x
	JSL.l CODE_03AEFD
	LDA.w #!Define_YI_SoundID83_LungeFish
	JSL.l CODE_push_sound_queue
	JSL.l CODE_03ADD0
	BCS.b CODE_059537
	LDA.w #$0100
	STA.w $0E0D
	JSL.l CODE_03AD74
	BRA.b CODE_059540

CODE_059537:
	INC.w $7402,x
	LDA.w #$A005
	STA.w $7040,x
CODE_059540:
	LDA.w #$00A0
	STA.w $7A98,x
	STZ.w $7542,x
	LDY.b #$04
	STY.b $76,x
	PLA
	RTL

CODE_05954F:
CODE_chain_chomp_idle_bark:                      ; non-attack frame -- play bark
	LDA.w #!Define_YI_SoundID7B_NavalPiranhaMunch ; "rwarf!" bite-warn snd
	JSL.l CODE_push_sound_queue
	LDA.w #$0060
	STA.w $7A98,x                           ; sit for $60 frames
	STZ.w $7542,x
	INC.b $76,x                             ; -> state 02 (windup)
CODE_059561:
	INC.b $76,x
	RTS

;-------------------------------------------------------------------------
; STATE 02 -- Pre-lunge wind-up.  On the ground, body bounces (walking-tap
; sound each step), counts down $16 hops; or if the alive flag $0E13 was
; cleared (player took damage earlier), short-circuits to anchor cooldown.
; When $16 reaches zero (last hop), launches into airborne lunge by setting
; Y-speed to -$0200 (continues into state 04 via $0595BF fall-through).
;-------------------------------------------------------------------------
CODE_059564:
CODE_chain_chomp_state_windup:
	TYX
	LDY.w $0E13                             ; alive flag
	BNE.b CODE_05957B                       ; player just took damage -> short-circuit
	LDA.w $7860,x                           ; on ground?
	LSR
	BCC.b CODE_05958D                       ; airborne -- skip hop
	LDA.w #!Define_YI_SoundID26_WalkingTapTap ; "tap" each bounce
	JSL.l CODE_push_sound_queue
	DEC.b $16,x                             ; hop count
	BNE.b CODE_059587                       ; more hops left
CODE_05957B:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7AF6,x                           ; $20-frame cooldown then back to idle
	DEC.b $76,x                             ; -> state 00 (idle)
	RTS

CODE_059587:
	LDA.w #$FE00                            ; final hop launches: Y-speed = -$0200
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_05958D:
	JSR.w CODE_chain_chomp_chain_anim_step                       ; advance chain anim counter
	RTS

;-------------------------------------------------------------------------
; STATE 04 -- Snap shut.  At lunge apex, kill XY speed and start the bite
; cooldown ($7AF6 = $20 frames, $7542 = $40).  $7A98 wait-frames first --
; while ticking, the body's still moving, so don't snap yet.  Sets per-
; segment GFX index to "fully clenched" via $18 = 4.
;-------------------------------------------------------------------------
CODE_059591:
CODE_chain_chomp_state_snap:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_chain_chomp_snap_apex_check                       ; airborne -- not yet at apex
	STZ.b $76,x                             ; -> state 00 (back to idle)
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7AF6,x                           ; $20-frame post-bite cooldown
	ASL
	STA.w $7542,x                           ; $40-frame stun-resist timer
	RTS

CODE_0595AA:
CODE_chain_chomp_snap_apex_check:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_0595BA                       ; X moving -- defer snap
	LDA.w $7860,x
	LSR
	BCS.b CODE_0595BF                       ; on ground -- snap immediately
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_0595BF                       ; at peak (Y speed zero) -- snap
CODE_0595BA:
	LDY.b #$04                              ; mid-air clenched GFX index
	STY.b $18,x
	RTS

CODE_0595BF:
	BRA.b CODE_chain_chomp_chain_anim_step

;-------------------------------------------------------------------------
; Anchor-recenter helper (entered from idle-state cooldown branch) --
; fast-step (8-frame pace, 2-frame substep) the chain animation counter
; toward index 0 (anchor-resting GFX).
;-------------------------------------------------------------------------
CODE_0595C1:
CODE_chain_chomp_chain_anim_fast:
	LDA.w #$0008
	STA.b $00
	LSR
	BRA.b CODE_0595D6

;-------------------------------------------------------------------------
; Lunge-state animation helper -- 16-frame pace for slower mid-air loop.
;-------------------------------------------------------------------------
CODE_0595C9:
CODE_chain_chomp_chain_anim_lunge:
	LDA.w #$0010
	BRA.b CODE_0595D1

;-------------------------------------------------------------------------
; Standard chain animation step helper -- 8-frame pace, 2-frame substep.
; Advances $18,x (GFX index) by 2 every $7A96 frames, wraps at $00 mask,
; plays SoundID64 "unlock-door" cue when the index hits the clench frame
; ($08), which is the audible "kachunk" of the chain reaching the body.
;-------------------------------------------------------------------------
CODE_0595CE:
CODE_chain_chomp_chain_anim_step:
	LDA.w #$0008
CODE_0595D1:
	STA.b $00
	LDA.w #$0002
CODE_0595D6:
	STA.b $02
	LDA.w $7A96,x                           ; substep timer
	BNE.b CODE_0595FC                       ; still in current frame
	LDA.b $02
	STA.w $7A96,x                           ; reset substep
	LDA.b $18,x                             ; current GFX index
	INC
	INC                                     ; advance by 2 (next frame)
	CMP.b $00
	BCC.b CODE_0595EE                       ; not at wrap
	LSR
	AND.w #$FFF8                            ; wrap to base anchor frame
CODE_0595EE:
	STA.b $18,x
	CMP.w #$0008
	BNE.b CODE_0595FC
	LDA.w #!Define_YI_SoundID64_UnlockDoor  ; "kachunk" -- chain hit body
	JSL.l CODE_push_sound_queue
CODE_0595FC:
	RTS

;-------------------------------------------------------------------------
; STATE 06 -- Chain retract / tail-wag transition.  Slides the anchor
; cache (701900/701902) by per-frame deltas $72C0/$72C2 (this is the
; "the world is moving" scroll compensation since the anchor is in
; world-space), then steps the chain animation.  Used as a one-frame
; bridge after a snap to prepare for the next lunge.
;-------------------------------------------------------------------------
CODE_0595FD:
CODE_chain_chomp_state_chain_retract:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w $72C0,x                           ; scroll-delta X
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w $72C2,x                           ; scroll-delta Y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BRA.b CODE_chain_chomp_chain_anim_step                       ; advance chain anim

; Lunge zoom-rate table -- indexed by $7040 bit 15 (alive variant flag):
;   normal: +$001C per frame; "extra-large" variant: +$002C per frame.
DATA_059614:
DATA_chain_chomp_lunge_zoom_rate:
	dw $001C,$002C

; Lunge X-speed table -- indexed by sign of saved lunge-speed ($0E0F):
;   pre-lunge faced left  ($0E0F<0): +$0180 (lunge right)
;   pre-lunge faced right ($0E0F>=0): -$0180 (lunge left)
DATA_059618:
DATA_chain_chomp_lunge_xspeeds:
	dw $0180,$FE80

;-------------------------------------------------------------------------
; Lunge arc zoom-target sequence -- 16 entries (8 per arc).  Indexed by
; ((alive-flag bit 15) >> 11) + $7A38 arc-progress.  Per CODE_chain_chomp_lunge_main
; (Bank05.asm:3349):
;   - Each frame: body zoom $7A36 grows toward target $0E0D at +/-zoom_rate.
;   - When the body reaches $0E0D, advance $7A38 by 2 and load the NEXT
;     entry into $0E0D.  $7A38 walks 0,2,4,6,8,A,C,E (capped at $E).
;   - When the body matches the arc's BASE entry (arc_targets[base]), arm
;     $0E11 = $10 (16-frame rumble timer; drives chain-segment OAM jitter
;     in CODE_chain_chomp_rumble_loop at Bank05.asm:2685, NOT a ground-
;     collision effect).
; The "alternating-pair {zoom, ground-Y}" framing in earlier comments was
; wrong: BOTH columns are body-zoom targets, sequenced so the body
; oscillates between full size ($0100/$01FE) and progressively smaller
; compressed values, producing the lunge "bob" animation.
;   upper arc (small chomp, alive-bit=0):  $0100 $00C4 $0100 $00D8 $0100 $00F0 $0100 $0100
;   lower arc (big chomp,  alive-bit=1):   $01FE $013C $01FE $0174 $01FE $019A $01FE $01FE
; No sound queue is triggered by reading from this table; $0E11 is purely
; a visual-rumble timer.
;-------------------------------------------------------------------------
DATA_05961C:
DATA_chain_chomp_lunge_arc_targets:
	dw $0100,$00C4,$0100,$00D8,$0100,$00F0,$0100,$0100
	dw $01FE,$013C,$01FE,$0174,$01FE,$019A,$01FE,$01FE

;-------------------------------------------------------------------------
; STATE 08 -- Airborne lunge arc.  Two phases controlled by $7A98 timer:
;   $7A98 > 0 -- arc setup: pick X-speed from DATA_chain_chomp_lunge_xspeeds
;                based on saved lunge direction ($0E0F), seed $7542 = $40
;                stun-resist, advance to state 0A;
;   $7A98 == 0 -- main arc loop: grow body zoom $7A36 toward target $0E0D
;                at +/-$001C-$002C per frame (rate from $7040 variant flag).
;                When zoom reaches target, set $0E11 = $10 (chain-rumble
;                OAM-jitter timer), and remap $7A38 to the next arc step.
; Tail of state: if hop count $16 hits zero, jump to lunge-anim helper
; (CODE_chain_chomp_chain_anim_lunge, slower 16-frame chain cycle).
;-------------------------------------------------------------------------
CODE_05963C:
CODE_chain_chomp_state_lunge:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_chain_chomp_lunge_main                       ; setup already done -- main loop
	LDA.w #$0040
	STA.w $7542,x                           ; $40-frame stun-resist
	LDY.b #$00
	LDA.w $0E0F                             ; sign of saved lunge X-speed
	BMI.b CODE_059651
	INY
	INY
CODE_059651:
	LDA.w DATA_chain_chomp_lunge_xspeeds,y                     ; lunge X-speed
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x                             ; -> state 0A (recoil) on next frame
	RTS

CODE_05965A:
CODE_chain_chomp_lunge_main:                     ; arc growth loop
	LDA.w $7040,x
	AND.w #$8000
	XBA
	ASL
	ASL
	XBA
	TAY
	LDA.w $7A38,x
	AND.w #$0002
	BEQ.b CODE_05967E
	LDA.w $7A36,x
	SEC
	SBC.w DATA_chain_chomp_lunge_zoom_rate,y
	STA.w $7A36,x
	CMP.w $0E0D
	BPL.b CODE_0596D1
	BRA.b CODE_05968E

CODE_05967E:
	LDA.w $7A36,x
	CLC
	ADC.w DATA_chain_chomp_lunge_zoom_rate,y
	STA.w $7A36,x
	DEC
	CMP.w $0E0D
	BMI.b CODE_0596D1
CODE_05968E:
	LDA.w $0E0D
	STA.w $7A36,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A38,x
	INC
	INC
	CMP.w #$0010
	BMI.b CODE_0596A7
	LDA.w #$000E
CODE_0596A7:
	STA.w $7A38,x
	LDA.w $7040,x
	AND.w #$8000
	XBA
	LSR
	LSR
	LSR
	STA.b $00
	CLC
	ADC.w $7A38,x
	TAY
	LDA.w DATA_chain_chomp_lunge_arc_targets,y
	STA.w $0E0D
	LDY.b $00
	LDA.w DATA_chain_chomp_lunge_arc_targets,y
	CMP.w $7A36,x
	BNE.b CODE_0596D1
	LDA.w #$0010
	STA.w $0E11
CODE_0596D1:
	LDA.b $16,x
	BNE.b CODE_0596D8
	JMP.w CODE_chain_chomp_chain_anim_lunge

CODE_0596D8:
	LDY.b #$0C
	STY.b $18,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ORA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_0596EA
	LDA.b $16,x
	BEQ.b CODE_0596EA
	DEC.b $16,x
CODE_0596EA:
	RTS

; Recoil zoom-shrink rate -- indexed by $7040 bit 15 variant flag:
;   normal: -$0006 per frame; "extra-large" variant: -$0008 per frame.
DATA_0596EB:
DATA_chain_chomp_recoil_rate:
	dw $0006,$0008

;-------------------------------------------------------------------------
; STATE 0A -- Recoil back to anchor.  Shrinks body zoom $7A36 by recoil
; rate (DATA_chain_chomp_recoil_rate) per frame.  When zoom falls below $80
; (body very close to anchor), reset state machine back to state 00
; (idle) -- the two exit paths differ in whether we also reload sprite
; flags ($7040 = $4005 for the "extra-large" variant) and unwind a
; cross-bank JSL stack frame.  Pinning $18 = 8 chooses the recoiling
; GFX index in the chain anim table.
;-------------------------------------------------------------------------
CODE_0596EF:
CODE_chain_chomp_state_recoil:
	TYX
	LDA.w $7860,x
	AND.w #$0001                            ; foot on ground?
	BEQ.b CODE_0596FB
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x ; brake
CODE_0596FB:
	LDY.b #$08                              ; recoiling GFX frame
	STY.b $18,x
	LDA.w $7040,x                           ; variant flag (bit 15)
	AND.w #$8000
	XBA
	ASL
	ASL
	XBA
	TAY
	LDA.w $7A36,x                           ; current zoom
	SEC
	SBC.w DATA_chain_chomp_recoil_rate,y                     ; shrink
	CMP.w #$0080                            ; reached anchor scale?
	BPL.b CODE_059748                       ; no -- keep shrinking
	LDA.w #$0020
	STA.w $7AF6,x                           ; $20-frame anchor settle
	LDY.w $7041,x
	BPL.b CODE_chain_chomp_recoil_short_reset                       ; small-OAM variant -- short reset
	JSL.l CODE_03AEFD                       ; ensure animation reset
	JSL.l CODE_03AD74                       ; LOS / facing recompute
	DEC.w $7402,x
	LDA.w #$4005                            ; large-variant sprite flags
	STA.w $7040,x
	STZ.w $7A38,x
	STZ.b $18,x
	STZ.b $76,x                             ; -> state 00 (idle)
	LDA.w #$0100                            ; restore anchor zoom
	STA.w $7A36,x
	PLA                                     ; unwind JSL frame
	RTL

CODE_059741:
CODE_chain_chomp_recoil_short_reset:             ; small-OAM variant
	STZ.b $18,x
	STZ.b $76,x                             ; -> state 00 (idle)
	LDA.w #$0100                            ; restore anchor zoom
CODE_059748:
	STA.w $7A36,x
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; SWING-OF-GRINDERS / MONKEY SWING (sprite $08F).
; Raidenthequick: init_swing_of_grinders / main_swing_of_grinders.
; Rotating contraption with grinders on each end; uses GSU SIN/COS lookups
; for the orbit math.
;=========================================================================

YI_NorSpr08F_MonkeySwing_Init:
init_swing_of_grinders:                     ; Raidenthequick: init_swing_of_grinders
;$05974C
	JSL.l CODE_03AE60                       ; standard sprite init
	LDA.w $7722,x                           ; snapshot state for orbit phase
	STA.b $18,x
	JSL.l CODE_03AE60                       ; second-pass init (extra slots)
	LDA.w #$FE40
	STA.w $75E0,x
	STA.w $75E2,x
	LDA.w #$8000
	STA.w $7A36,x
	STA.w $7A38,x
	LDA.w #$0018
	STA.w $7AF8,x
	JSR.w CODE_059A9F
	RTL

;---------------------------------------------------------------------------

YI_NorSpr08F_MonkeySwing_Main:
main_swing_of_grinders:                     ; Raidenthequick: main_swing_of_grinders
;$059775
	JSR.w CODE_0597A9
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0006
	BNE.b CODE_059792
	LDA.w $7722,x
	BMI.b CODE_059789
	JSL.l CODE_03AEFD
CODE_059789:
	LDA.b $18,x
	STA.w $7722,x
	JSL.l CODE_03AEFD
CODE_059792:
	JSL.l CODE_03AF23
	JSR.w CODE_05988A
	JSR.w CODE_05989A
	JSR.w CODE_0599DD
	JSR.w CODE_059A9F
	RTL

DATA_0597A3:
	dw $FFF0,$0010,$FFF0

CODE_0597A9:
	LDY.w $7A37,x
	TYA
	ASL
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDY.w $7A39,x
	TYA
	ASL
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7A38,x
	SEC
	SBC.w $7A36,x
	XBA
	TAY
	TYA
	CPY.b #$00
	BPL.b CODE_0597CD
	ORA.w #$FF00
CODE_0597CD:
	ASL
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7400,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_0B950A>>16
	LDA.w #FXCODE_0B950A
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	JSL.l CODE_03AA52
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0020
	PHA
	TAY
	JSL.l CODE_03AA60
	LDA.w $7722,x
	STA.b $00
	LDA.b $18,x
	STA.w $7722,x
	REP.b #$10
	PLA
	CLC
	ADC.w #$0020
	PHA
	TAY
	JSL.l CODE_03AA60
	REP.b #$10
	PLA
	CLC
	ADC.w #$0020
	TAY
	JSL.l CODE_03AA60
	LDA.b $00
	STA.w $7722,x
	LDA.w $7680,x
	CLC
	ADC.w #$0008
	LDY.w $7400,x
	CLC
	ADC.w DATA_0597A3,y
	STA.b $00
	LDA.w DATA_0597A3+$02,y
	STA.b $02
	LDA.w $7682,x
	SEC
	SBC.w #$0008
	STA.b $04
	LDA.w #$6020
	STA.b $06
	LDA.w #$0004
	STA.b $0A
	REP.b #$10
	LDY.w $7362,x
CODE_05984A:
	LDA.b ($06)
	CLC
	ADC.b $00
	STA.w $6000,y
	STA.w $6010,y
	CLC
	ADC.b $02
	STA.w $6008,y
	STA.w $6018,y
	INC.b $06
	INC.b $06
	LDA.b ($06)
	CLC
	ADC.b $04
	STA.w $6002,y
	STA.w $600A,y
	CLC
	ADC.w #$0010
	STA.w $6012,y
	STA.w $601A,y
	DEC.b $0A
	BEQ.b CODE_059887
	INC.b $06
	INC.b $06
	TYA
	CLC
	ADC.w #$0020
	TAY
	BRA.b CODE_05984A

CODE_059887:
	SEP.b #$10
CODE_059889:
	RTS

CODE_05988A:
	JSL.l CODE_despawn_sprite
	BCC.b CODE_059889
	LDA.b $18,x
	STA.w $7722,x
	PLA
	JML.l CODE_03AEFD

CODE_05989A:
	LDY.b #$0C
	LDA.w $61B2
	BIT.w #$6000
	BNE.b CODE_059889
	LDY.w $61CC
	BNE.b CODE_059889
	AND.w #$8000
	BEQ.b CODE_0598D6
CODE_0598AE:
	LDA.w $7C16,x
	CLC
	ADC.w $6020,y
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_0598CE
	LDA.w $7C18,x
	CLC
	ADC.w $6022,y
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCC.b CODE_059911
CODE_0598CE:
	TYA
	SEC
	SBC.w #$0004
	TAY
	BPL.b CODE_0598AE
CODE_0598D6:
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6
	STA.b $00
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8
	STA.b $02
	LDY.b #$0C
CODE_0598EA:
	LDA.b $00
	CLC
	ADC.w $6020,y
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_059908
	LDA.b $02
	CLC
	ADC.w $6022,y
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCC.b CODE_059911
CODE_059908:
	TYA
	SEC
	SBC.w #$0004
	TAY
	BPL.b CODE_0598EA
	RTS

CODE_059911:
	STY.b $00
	LDA.w $6020,y
	STA.b $02
	LDA.w $6022,y
	STA.b $04
	CPY.b #$08
	BMI.b CODE_059923
	INX
	INX
CODE_059923:
	LDA.w #$0040
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BPL.b CODE_05992E
	LDA.w #$FFC0
CODE_05992E:
	CLC
	ADC.w $7A37,x
	AND.w #$00FF
	ASL
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$FC00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w $7400,x
	BEQ.b CODE_059959
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	EOR.w #$FFFF
	INC
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
CODE_059959:
	LDA.w #$01A8
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0599D8
	LDA.w $70E2,x
	CLC
	ADC.b $02
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.b $04
	STA.w $7182,y
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	TYX
	JSL.l CODE_02BC22
	LDX.b $12
	LDY.b #$0C
CODE_05998F:
	STY.b $06
	CPY.b $00
	BEQ.b CODE_0599C0
	LDA.w $6020,y
	STA.b $02
	LDA.w $6022,y
	STA.b $04
	LDA.w #$01A5
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_0599D8
	LDA.w $70E2,x
	CLC
	ADC.b $02
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.b $04
	STA.w $7182,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
CODE_0599C0:
	LDY.b $06
	TYA
	SEC
	SBC.w #$0004
	TAY
	BPL.b CODE_05998F
	JSL.l CODE_03AEFD
	LDA.b $18,x
	STA.w $7722,x
	PLA
	JML.l CODE_despawn_sprite_free_slot

CODE_0599D8:
	RTS

;---------------------------------------------------------------------------

DATA_0599D9:
	dw $FFFA,$0006

CODE_0599DD:
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.w $75E0,x
	BEQ.b CODE_059A06
	STA.b $00
	BPL.b CODE_0599EE
	INY
	INY
CODE_0599EE:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w DATA_0599D9,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.w $75E0,x
	EOR.b $00
	BPL.b CODE_059A06
	LDA.w $75E0,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_059A06:
	LDY.w $7A37,x
	TYA
	SEC
	SBC.w #$0040
	STA.b $00
	LDA.w $7A36,x
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $7A36,x
	XBA
	AND.w #$00FF
	SEC
	SBC.w #$0040
	EOR.b $00
	BPL.b CODE_059A3B
	LDA.b $00
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_059A3B
	LDA.w $75E0,x
	EOR.w #$FFFF
	INC
	STA.w $75E0,x
CODE_059A3B:
	LDA.w $7AF8,x
	BNE.b CODE_059A9E
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEC
	SBC.w $75E2,x
	BEQ.b CODE_059A69
	STA.b $00
	BPL.b CODE_059A51
	INY
	INY
CODE_059A51:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w DATA_0599D9,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEC
	SBC.w $75E2,x
	EOR.b $00
	BPL.b CODE_059A69
	LDA.w $75E2,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_059A69:
	LDY.w $7A39,x
	TYA
	SEC
	SBC.w #$0040
	STA.b $00
	LDA.w $7A38,x
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7A38,x
	XBA
	AND.w #$00FF
	SEC
	SBC.w #$0040
	EOR.b $00
	BPL.b CODE_059A9E
	LDA.b $00
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_059A9E
	LDA.w $75E2,x
	EOR.w #$FFFF
	INC
	STA.w $75E2,x
CODE_059A9E:
	RTS

;---------------------------------------------------------------------------

CODE_059A9F:
	LDA.w #FXDATA_548000+$4060
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$4060)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	SEC
	SBC.w $7A36,x
	BPL.b CODE_059AB7
	LDA.w #$0000
CODE_059AB7:
	STA.b $06
	LSR
	STA.b $04
	LDA.w $7A38,x
	CLC
	ADC.w $7A36,x
	LSR
	CLC
	ADC.b $04
	XBA
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
	LDA.w #FXDATA_548000+$4060
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$4060)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	CLC
	ADC.b $06
	XBA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.b $18,x
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

;=========================================================================
; EXPANDING BLOCK (sprite $094).
; Raidenthequick: init_expansion_block / main_expansion_block.
; A floating platform that expands when Yoshi steps on it.
;=========================================================================
YI_NorSpr094_ExpandingBlock_Init:
init_expansion_block:                       ; Raidenthequick: init_expansion_block
;$059B30
	JSL.l CODE_03AE60
	LDA.w $7182,x
	STA.b $78,x
	LDA.w #$0100
	STA.w $7A36,x
	STZ.w $7400,x
	JSR.w CODE_059BA7
	RTL

;---------------------------------------------------------------------------

DATA_059B46:
DATA_expansion_block_state_ptr:                  ; 4-entry $76,x sub-state dispatch (Expanding Block $094)
; note: state 0 (CODE_0580C2) is a one-frame respawn-reset stub from the engine; the platform's real idle behaviour lives in state 1 ("expanding"). State 0 is dead-but-reachable. The "Growth" SFX plays on the contract->idle transition, i.e. on SHRINKING -- the sound is about re-appearance, not size change. See docs/family-platforms.md §7.
	dw CODE_0580C2                              ;  0: idle (stub)
	dw CODE_059BE7                              ;  1: expanding
	dw CODE_059C15                              ;  2: fully expanded
	dw CODE_059C42                              ;  3: contracting

YI_NorSpr094_ExpandingBlock_Main:
main_expansion_block:                       ; Raidenthequick: main_expansion_block
;$059B4E
	JSL.l CODE_03AA52
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_expansion_block_state_ptr,x)
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0003
	BNE.b CODE_059B70
	JSR.w CODE_059BA7
CODE_059B70:
	LDA.b $76,x
	PHA
	LDA.w #$0700
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0800
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$000A
	STA.b $0A
	STZ.b $02
	LDY.b #$01
	STY.b $09
	STY.b $06
	DEY
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	JSL.l CODE_059C6F
	PLA
	CMP.b $76,x
	BEQ.b CODE_059BA6
	LDA.w #!Define_YI_SoundID15_Growth
	JSL.l CODE_push_sound_queue
CODE_059BA6:
	RTL

CODE_059BA7:
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #(FXDATA_540000+$7040)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_540000+$7040
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w $7722,x
	TAX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	ASL
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_0882FA>>16
	LDA.w #FXCODE_0882FA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	RTS

CODE_059BE7:
	TYX
	LDY.w $7223,x
	BMI.b CODE_059C11
	LDA.w $7860,x
	AND.w #$0003
	BEQ.b CODE_059BF9
	INC.b $18,x
	BRA.b CODE_059C03

CODE_059BF9:
	LDA.b $78,x
	CMP.w $7182,x
	BPL.b CODE_059C11
	STA.w $7182,x
CODE_059C03:
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	INC.b $76,x
	LDA.w #$0120
	STA.w $7A96,x
CODE_059C11:
	JSR.w CODE_059C2F
	RTS

CODE_059C15:
	TYX
	LDA.b $18,x
	BEQ.b CODE_059C22
	LDA.w $7860,x
	AND.w #$0003
	BEQ.b CODE_059C27
CODE_059C22:
	LDA.w $7A96,x
	BNE.b CODE_059C2F
CODE_059C27:
	LDA.w #$0040
	STA.w $7542,x
	INC.b $76,x
CODE_059C2F:
	LDA.w $7A36,x
	CLC
	ADC.w #$0010
	CMP.w #$0200
	BMI.b CODE_059C3E
	LDA.w #$01FF
CODE_059C3E:
	STA.w $7A36,x
	RTS

CODE_059C42:
	TYX
	LDA.b $78,x
	INC
	CMP.w $7182,x
	BPL.b CODE_059C55
	DEC
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
CODE_059C55:
	LDA.w $7A36,x
	SEC
	SBC.w #$0018
	CMP.w #$0100
	BPL.b CODE_059C6B
	LDA.w #$0100
	LDY.w $7542,x
	BNE.b CODE_059C6B
	STZ.b $76,x
CODE_059C6B:
	STA.w $7A36,x
	RTS

;---------------------------------------------------------------------------

CODE_059C6F:
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	STY.b $08
	LDA.w $6120
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w $6122
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_0B8578>>16
	LDA.w #FXCODE_0B8578
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	STZ.b $04
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611C
	STA.b $0C
	CLC
	ADC.w $603C
	CMP.w $6038
	BCC.b CODE_059CA4
	RTL

CODE_059CA4:
	LDA.w #$0008
	LDY.b $09
	BEQ.b CODE_059CC7
	CPY.b #$01
	BNE.b CODE_059CBC
	LDA.w #$0010
	SEC
	SBC.w $6036
	SEC
	SBC.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	BRA.b CODE_059CC7

CODE_059CBC:
	LDA.w #$FFF0
	CLC
	ADC.w $6036
	SEC
	SBC.w !REGISTER_SuperFX_R3_GeneralPurposeLo
CODE_059CC7:
	CLC
	ADC.w $7182,x
	SEC
	SBC.w $611E
	SEC
	SBC.w $6112
	STA.b $0E
	CLC
	ADC.w $603E
	CMP.w $603A
	BCS.b CODE_059D29
	LDA.w $603E
	SEC
	SBC.b $0A
	STA.b $00
	LDA.b $0E
	BPL.b CODE_059CFA
	PHA
	LDA.b $00
	EOR.w #$FFFF
	INC
	STA.b $00
	PLA
	CMP.b $00
	BMI.b CODE_059D2A
	BRA.b CODE_059CFE

CODE_059CFA:
	CMP.b $00
	BPL.b CODE_059D2A
CODE_059CFE:
	LDY.b $08
	BNE.b CODE_059D6A
	INC.b $04
	LDA.w $60A8
	EOR.b $0C
	BMI.b CODE_059D28
	LDA.w $603C
	INC
	LDY.b $0D
	BMI.b CODE_059D18
	INC.b $04
	EOR.w #$FFFF
CODE_059D18:
	CLC
	ADC.b $0C
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STZ.w $60A8
	STZ.w $60B4
CODE_059D28:
	CLC
CODE_059D29:
	RTL

CODE_059D2A:
	LDA.b $0E
	BPL.b CODE_059D6C
	LDY.b $02
	BNE.b CODE_059D39
	LDA.b $0E
	EOR.w $60AA
	BMI.b CODE_059D6A
CODE_059D39:
	LDY.b $08
	BNE.b CODE_059D6A
	LDY.b #$04
	STY.b $04
	LDA.b $0E
	CLC
	ADC.w $603E
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60AA
	STZ.w $60D2
	LDY.b $06
	BEQ.b CODE_059D6A
	LDA.b $76,x
	BNE.b CODE_059D6A
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	INC.b $76,x
CODE_059D6A:
	SEC
	RTL

CODE_059D6C:
	LDA.b $0E
	EOR.w $60AA
	BMI.b CODE_059D6A
	LDY.b #$08
	STY.b $04
	LDA.b $0E
	SEC
	SBC.w $603E
	CLC
	ADC.w #$0002
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDY.b #$00
	STY.w !EXRAM_YI_Player_SubYPosLo|!EXRAMBankMirror
	STZ.w $60AA
	INC.w $61B4
	CLC
	RTL

;---------------------------------------------------------------------------

;=========================================================================
; CHECKERED BLOCKS (sprites $095 Blue / $096 Red).
; Raidenthequick: init_checkered_block / main_checkered_block.
; Switchable blocks: blue solid <-> red solid, toggled by ! switch.
;=========================================================================
YI_NorSpr095_BlueCheckeredBlock_Init:
YI_NorSpr096_RedCheckeredBlock_Init:
init_checkered_block:                       ; Raidenthequick: init_checkered_block
;$059D95
	JSL.l CODE_03AE60
	LDA.w #$0100
	STA.w $7A36,x
	STA.w $7A38,x
	STZ.b $16,x
	JSR.w CODE_059E99
	RTL

;---------------------------------------------------------------------------

DATA_059DA8:
DATA_checkered_block_state_ptr:                  ; 4-entry $76,x sub-state dispatch
	dw CODE_059EF3                              ;  0: horizontal sweep
	dw CODE_059F50                              ;  1: vertical sweep
	dw CODE_0580C2                              ;  2: GSU delta-facing (shared stub)
	dw CODE_0580C2                              ;  3: GSU delta-facing (shared stub)

DATA_059DB0:
	dw FXDATA_548000+$10B0,FXDATA_548000+$0060

DATA_059DB4:
	dw $0600,$0E00

DATA_059DB8:
	dw $0A00,$0600

YI_NorSpr095_BlueCheckeredBlock_Main:
YI_NorSpr096_RedCheckeredBlock_Main:
main_checkered_block:                       ; Raidenthequick: main_checkered_block
;$059DBC
	JSL.l CODE_03AA52
	LDY.b $76,x
	CPY.b #$01
	BEQ.b CODE_059DCC
	JSL.l CODE_03AF23
	BRA.b CODE_059DD3

CODE_059DCC:
	JSL.l CODE_03B716
	JSR.w CODE_059E99
CODE_059DD3:
	JSR.w CODE_059E06
	JSR.w CODE_059E6F
	JSL.l CODE_059C6F
	BCS.b CODE_059DF3
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C0,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C2,x
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_059DF3:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_checkered_block_state_ptr,x)
	LDA.w $70E2,x
	STA.b $18,x
	LDA.w $7182,x
	STA.b $78,x
	RTL

CODE_059E06:
	LDY.b $76,x
	CPY.b #$02
	BMI.b CODE_059E6E
	BNE.b CODE_059E36
	LDA.w $70E2,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_059E1B
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BMI.b CODE_059E5C
CODE_059E1B:
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
	BRA.b CODE_059E5C

CODE_059E36:
	LDA.w $7182,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_059E43
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BMI.b CODE_059E5C
CODE_059E43:
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
CODE_059E5C:
	LDA.w $70E2,x
	SEC
	SBC.b $18,x
	STA.w $72C0,x
	LDA.w $7182,x
	SEC
	SBC.b $78,x
	STA.w $72C2,x
CODE_059E6E:
	RTS

CODE_059E6F:
	LDY.b $16,x
	LDA.w DATA_059DB4,y
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w DATA_059DB8,y
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$000A
	STA.b $0A
	STZ.b $02
	LDY.b #$00
	STY.b $09
	TYA
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	INY
	STY.b $06
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A38,x
	RTS

CODE_059E99:
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDY.b $16,x
	LDA.w #(FXDATA_548000+$0060)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w DATA_059DB0,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w $7722,x
	TAX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0010
	CPY.b #$00
	BEQ.b CODE_059EDD
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_059EED

CODE_059EDD:
	LSR
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_0882FA>>16
	LDA.w #FXCODE_0882FA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_059EED:
	LDX.b $12
	INC.w $0CF9
	RTS

CODE_059EF3:
	TYX
	LDY.w $7D36,x
	BMI.b CODE_059F10
	DEY
	BMI.b CODE_059F4F
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_059F4F
	LDA.w $7D38,y
	BEQ.b CODE_059F4F
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	BRA.b CODE_059F19

CODE_059F10:
	STZ.w $60B4
	STZ.w $60A8
	STZ.w $60AA
CODE_059F19:
	LDA.w $7CD6,x
	STA.b $00
	LDA.w $7CD8,x
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1E7
	JSL.l CODE_spawn_ambient_stomp_puff_common
	LDY.b #$02
	STY.b $16,x
	LDA.w #$0021
	STA.w $7A96,x
	LDA.w #$0080
	STA.w $7A36,x
	LDA.w #$01FF
	STA.w $7A38,x
	LDA.w #!Define_YI_SoundID05_Powerup
	JSL.l CODE_push_sound_queue
	INC.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	INC.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	INC.b $76,x
CODE_059F4F:
	RTS

CODE_059F50:
	TYX
	LDY.w $7A96,x
	BNE.b CODE_059F9E
	LDA.w $7A36,x
	CLC
	ADC.w #$0004
	CMP.w #$0100
	BMI.b CODE_059F65
	LDA.w #$0100
CODE_059F65:
	STA.w $7A36,x
	LDA.w $7A38,x
	SEC
	SBC.w #$0008
	CMP.w #$0100
	BPL.b CODE_059F77
	LDA.w #$0100
CODE_059F77:
	STA.w $7A38,x
	ORA.w $7A36,x
	CMP.w #$0100
	BNE.b CODE_059F9E
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr095_BlueCheckeredBlock
	BNE.b CODE_059F90
	JSL.l CODE_init_red_platform
	BRA.b CODE_059F96

CODE_059F90:
	JSL.l CODE_init_pink_platform
	INC.b $76,x
CODE_059F96:
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	INC.b $76,x
CODE_059F9E:
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; WILD PIRANHA (sprites $054 Upside-down / $066 Upright).
; Raidenthequick: init_wild_piranha / main_wild_piranha.
; Snapping plant that lunges when Yoshi gets close; both orientations
; share the same Init/Main, differing only in vertical anchor.
;
; See docs/family-piranhas.md for the full carnivorous-plant family
; breakdown -- $054/$066 17-state machine + $09F Ptooie + $0F8/$04C
; Blow Hard + $164/$165 Nipper, plus the $00DD CloseWall trigger that
; fires from the child head (W2 boss-defeat path runs through here).
;=========================================================================
YI_NorSpr054_UpsideDownPiranhaPlant_Init:
YI_NorSpr066_PiranhaPlant_Init:
init_wild_piranha:                          ; Raidenthequick: init_wild_piranha
;$059F9F
	INC.w $7402,x
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	JSL.l CODE_0EB8B7
	BNE.b CODE_059FBF
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w $70E2,x
CODE_059FBF:
	RTL

;---------------------------------------------------------------------------

DATA_059FC0:
DATA_wild_piranha_state_ptr:                     ; 17-entry $76,x sub-state dispatch (both Piranha variants)
	dw CODE_05A11E                              ;  $0: idle, watching for Yoshi
	dw CODE_05A169                              ;  $1: emerge / open mouth
	dw CODE_05A36C                              ;  $2: chomp attempt
	dw CODE_05A456                              ;  $3: grab Yoshi onto stem
	dw CODE_05A5AF                              ;  $4: Yoshi caught, chew animation
	dw CODE_05A402                              ;  $5: ejection / drop Yoshi
	dw CODE_05A5DA                              ;  $6: retract head
	dw CODE_05A5DF                              ;  $7: retract phase 2
	dw CODE_05A5F1                              ;  $8: defeated -- fall over
	dw CODE_05A622                              ;  $9: defeat secondary
	dw CODE_05A65E                              ;  $A: defeat finish
	dw CODE_05A6A6                              ;  $B: hit-stun
	dw CODE_05A6BE                              ;  $C: hit-stun recover
	dw CODE_05A6E8                              ;  $D: respawn / re-arm
	dw CODE_05A719                              ;  $E: misc helper
	dw CODE_05A738                              ;  $F: misc helper 2
	dw CODE_05A758                              ; $10: stub / end-of-table

DATA_059FE2:                                    ; flavor: data (followed by dw); CODE_ name is a documentation bug
	dw $0010,$0000

YI_NorSpr054_UpsideDownPiranhaPlant_Main:
YI_NorSpr066_PiranhaPlant_Main:
main_wild_piranha:                          ; Raidenthequick: main_wild_piranha
;$059FE6
	LDA.b $18,x
	AND.w #$00FF
	CMP.w #$0080
	BMI.b CODE_059FF3
	ORA.w #$FF00
CODE_059FF3:
	STA.b $0C
	LDA.b $19,x
	AND.w #$00FF
	CMP.w #$0080
	BMI.b CODE_05A002
	ORA.w #$FF00
CODE_05A002:
	LDY.w $7042,x
	BPL.b CODE_05A00B
	CLC
	ADC.w #$0010
CODE_05A00B:
	STA.b $0E
	LDA.w $7402,x
	BNE.b CODE_05A015
	JSR.w CODE_05A769
CODE_05A015:
	LDY.b $76,x
	CPY.b #$04
	BNE.b CODE_05A022
	LDY.w !EXRAM_YI_NorSprXXX_PiranhaPlant_GrabbedYoshiFlag|!EXRAMBankMirror,x
	BEQ.b CODE_05A02D
	BRA.b CODE_05A02A

CODE_05A022:
	CPY.b #$03
	BMI.b CODE_05A02D
	CPY.b #$06
	BPL.b CODE_05A02D
CODE_05A02A:
	STZ.w $611A
CODE_05A02D:
	LDA.w $7D96,x
	BEQ.b CODE_05A040
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr054_UpsideDownPiranhaPlant
	BNE.b CODE_05A040
	LDA.w #$8840
	STA.w $6FA2,x
CODE_05A040:
	LDY.b $76,x
	CPY.b #$10
	BEQ.b CODE_05A04A
	JSL.l CODE_03AF23
CODE_05A04A:
	JSL.l CODE_03A2C7
	BCC.b CODE_05A07B
	LDY.b $76,x
	CPY.b #$08
	BPL.b CODE_05A07B
	CPY.b #$02
	BMI.b CODE_05A076
	CPY.b #$06
	BPL.b CODE_05A09F
	CPY.b #$04
	BNE.b CODE_05A067
	LDY.w !EXRAM_YI_NorSprXXX_PiranhaPlant_GrabbedYoshiFlag|!EXRAMBankMirror,x
	BEQ.b CODE_05A076
CODE_05A067:
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$0070
	STA.w $61D6
	STZ.w $0D94
	STZ.w $61B6
CODE_05A076:
	JML.l CODE_03A31E

CODE_05A07A:
	RTL

CODE_05A07B:
	LDY.b $76,x
	CPY.b #$08
	BMI.b CODE_05A09F
	LDY.w $7D36,x
	DEY
	BMI.b CODE_05A0A2
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05A0A2
	LDA.w $7D38,y
	BEQ.b CODE_05A0A2
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDY.b #$10
	STY.b $76,x
	BRA.b CODE_05A0A2

CODE_05A09F:
	JSR.w CODE_05A0C3
CODE_05A0A2:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_wild_piranha_state_ptr,x)
	LDA.w #$0008
	STA.w $7B56,x
	STA.w $7B58,x
	LDA.w $7402,x
	BNE.b CODE_05A0C2
	LDA.b $0C
	STA.w $7B56,x
	LDA.b $0E
	STA.w $7B58,x
CODE_05A0C2:
	RTL

CODE_05A0C3:
	LDY.w $7D36,x
	BNE.b CODE_05A11D
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098F33>>16
	LDA.w #FXCODE_098F33
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_05A11D
	LDA.w $7BB6,y
	CLC
	ADC.w #$0006
	STA.b $00
	ASL
	STA.b $02
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $7CD6,y
	CLC
	ADC.b $00
	CMP.b $02
	BCS.b CODE_05A11D
	LDA.w $7BB8,y
	CLC
	ADC.w #$0006
	STA.b $00
	ASL
	STA.b $02
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $7CD8,y
	CLC
	ADC.b $00
	CMP.b $02
	BCS.b CODE_05A11D
	INY
	TYA
	STA.w $7D36,x
CODE_05A11D:
	RTS

CODE_05A11E:
	TYX
	PLA
	STA.b $00
	JSL.l CODE_03A5B7
	LDA.b $00
	PHA
	LDA.w $7A98,x
	BNE.b CODE_05A168
	LDA.w $7C16,x
	CLC
	ADC.w #$0070
	CMP.w #$00E0
	BCS.b CODE_05A168
	LDA.w $7C18,x
	CLC
	ADC.w #$0070
	CMP.w #$00E0
	BCS.b CODE_05A168
	LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerForm10_SuperBabyMario
	BEQ.b CODE_05A168
	JSL.l CODE_03AD74
	BCC.b CODE_05A168
	LDA.w #$84A8
	STA.w $6FA0,x							; Todo: Is this a pointer?
	LDA.w #$3D51
	STA.w $7040,x
	LDA.w #$0055
	STA.w $7A36,x
	INC.b $76,x
CODE_05A168:
	RTS

CODE_05A169:
	TYX
	LDY.w $7D36,x
	DEY
	BMI.b CODE_05A19B
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05A19B
	LDA.w $7D38,y
	BEQ.b CODE_05A19B
	JSR.w CODE_05A96C
	LDA.w $7A38,x
	LDY.w $7400,x
	BEQ.b CODE_05A192
	EOR.w #$FFFF
	SEC
	ADC.w #$0100
	AND.w #$01FE
CODE_05A192:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0206
	STA.b $76,x
	RTS

CODE_05A19B:
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0003
	BNE.b CODE_05A1C0
	STZ.w $7402,x
	JSR.w CODE_05A24A
	JSR.w CODE_05A800
	JSR.w CODE_05A336
	LDY.w !RAM_YI_Level_FreeMovementFlag
	BNE.b CODE_05A1C0
	LDY.w $7AF8,x
	BEQ.b CODE_05A1C1
CODE_05A1C0:
	RTS

CODE_05A1C1:
	LDA.w $6120
	CLC
	ADC.w #$0004
	ASL
	STA.b $04
	LSR
	CLC
	ADC.w $70E2,x
	CLC
	ADC.b $0C
	SEC
	SBC.w $611C
	STA.b $00
	CMP.b $04
	BCS.b CODE_05A1C0
	LDA.w $6122
	CLC
	ADC.w #$0004
	ASL
	STA.b $04
	LSR
	CLC
	ADC.w $7182,x
	CLC
	ADC.b $0E
	SEC
	SBC.w $611E
	STA.b $02
	CMP.b $04
	BCS.b CODE_05A1C0
	LDA.w $7A36,x
	SEC
	SBC.w #$0100
	ORA.w $61D6
	ORA.w $0D94
	BNE.b CODE_05A249
	JSL.l CODE_03BFF7
	LDA.w #$A041
	STA.w $6FA2,x
	LDA.w #$3D01
	STA.w $7040,x
	INC.w $0D94
	LDY.w $7E48
	BMI.b CODE_05A224
	TYA
	STA.w $0D96
CODE_05A224:
	LDA.b $00
	STA.w !EXRAM_YI_NorSprXXX_PiranhaPlant_GrabbedYoshiFlag|!EXRAMBankMirror,x
	LDA.b $02
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSL.l CODE_04F74A
	LDA.w #!Define_YI_PlayerState1A_DisableInput
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$0021
	STA.w $60BE
	LDA.w #$0202
	STA.b $76,x
	JSR.w CODE_05A800
	JSR.w CODE_05A352
CODE_05A249:
	RTS

CODE_05A24A:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_05A27F
	LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerForm10_SuperBabyMario
	BEQ.b CODE_05A27F
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611C
	CLC
	ADC.w #$0070
	CMP.w #$00E0
	BCS.b CODE_05A27F
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611E
	CLC
	ADC.w #$0070
	CMP.w #$00E0
	BCC.b CODE_05A2B8
CODE_05A27F:
	LDA.w $7A36,x
	SEC
	SBC.w #$0020
	CMP.w #$0055
	BPL.b CODE_05A2C7
	JSL.l CODE_03AEFD
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_05A29D
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0100
	STA.w $7A98,x
CODE_05A29D:
	LDA.w #$0001
	STA.w $7402,x
	LDA.w #$BE00
	STA.w $6FA0,x
	LDA.w #$3DD1
	STA.w $7040,x
	DEC.b $76,x
	LDA.w #$0055
	STA.w $7A36,x
	RTS

CODE_05A2B8:
	LDA.w $7A36,x
	CLC
	ADC.w #$0040
	CMP.w #$0100
	BMI.b CODE_05A2C7
	LDA.w #$0100
CODE_05A2C7:
	STA.w $7A36,x
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611E
	LDY.w $7042,x
	BPL.b CODE_05A2EC
	EOR.w #$FFFF
	INC
CODE_05A2EC:
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w #$0080
	CMP.w #$0100
	BCS.b CODE_05A31A
	STZ.w $7400,x
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CMP.w #$0100
	BMI.b CODE_05A314
	LDA.w #$0100
CODE_05A314:
	CLC
	ADC.w #$0100
	BRA.b CODE_05A32F

CODE_05A31A:
	LDA.w #$0002
	STA.w $7400,x
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CMP.w #$0080
	BMI.b CODE_05A32B
	LDA.w #$0000
CODE_05A32B:
	EOR.w #$FFFF
	INC
CODE_05A32F:
	AND.w #$01FE
	STA.w $7A38,x
	RTS

CODE_05A336:
	LDA.w $7A96,x
	BNE.b CODE_05A352
	LDA.w #$0008
	STA.w $7A96,x
	LDA.b $77,x
	EOR.w #$0002
	STA.b $77,x
	TAY
	BEQ.b CODE_05A352
	LDA.w #!Define_YI_SoundID39_PiranhaPlantMunch
	JSL.l CODE_push_sound_queue
CODE_05A352:
	LDA.w $6022
	STA.b $0C
	TAY
	STY.b $18,x
	LDA.w $6020
	TAY
	STY.b $19,x
	LDY.w $7042,x
	BPL.b CODE_05A369
	CLC
	ADC.w #$0010
CODE_05A369:
	STA.b $0E
	RTS

CODE_05A36C:
	TYX
	STX.w $61B6
	LDA.w $70E2,x
	CLC
	ADC.b $0C
	STA.b $00
	LDA.w $7182,x
	CLC
	ADC.b $0E
	STA.b $02
	LDA.w !EXRAM_YI_NorSprXXX_PiranhaPlant_GrabbedYoshiFlag|!EXRAMBankMirror,x
	STA.b $04
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $06
	JSL.l CODE_049B42
	PHA
	LDA.b $04
	STA.w !EXRAM_YI_NorSprXXX_PiranhaPlant_GrabbedYoshiFlag|!EXRAMBankMirror,x
	LDA.b $06
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.b $08
	SEC
	SBC.w $611C
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.b $0A
	SEC
	SBC.w $611E
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	PLA
	BNE.b CODE_05A3ED
	STZ.w !EXRAM_YI_NorSprXXX_PiranhaPlant_GrabbedYoshiFlag|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0005
	STA.b $76,x
	LDA.w #$0020
	STA.b $16,x
	STZ.w $611A
	LDY.w $7E48
	BMI.b CODE_05A3E7
	LDA.w #$00FF
	STA.w $74A2,y
	DEC.b $76,x
	DEC.b $76,x
	INC.w !EXRAM_YI_NorSprXXX_PiranhaPlant_GrabbedYoshiFlag|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.b $16,x
	LDA.w #!Define_YI_SoundID14_Gulp
	JSL.l CODE_push_sound_queue
CODE_05A3E7:
	JSR.w CODE_05A800
	JSR.w CODE_05A352
CODE_05A3ED:
	RTS

DATA_05A3EE:
	dw $0008,$FFF8

DATA_05A3F2:
	dw $0110,$0100

DATA_05A3F6:
	dw $FC80,$0380

DATA_05A3FA:
	dw $FC00,$0400

DATA_05A3FE:
	dw $0004,$FFFC

CODE_05A402:
	TYX
	LDA.w $7042,x
	AND.w #$FFE0
	ORA.w #$0024
	STA.w $7042,x
	LDA.w $7A36,x
	CMP.w #$0100
	BMI.b CODE_05A464
	LDA.w $7042,x
	AND.w #$FFE0
	ORA.w #$0022
	STA.w $7042,x
	LDA.w $0035
	AND.w #$CFF0
	CMP.w $0D98
	BEQ.b CODE_05A464
	STA.w $0D98
	CMP.w #$0000
	BEQ.b CODE_05A464
	LDA.b $16,x
	CMP.w #$0005
	BMI.b CODE_05A464
	SEC
	SBC.w #$0010
	CMP.w #$0004
	BPL.b CODE_05A449
	LDA.w #$0004
CODE_05A449:
	AND.w #$FFFC
	STA.b $16,x
	LDA.w #$00C0
	STA.w $7A36,x
	BRA.b CODE_05A464

CODE_05A456:
	TYX
	LDY.w $7E48
	CPY.b #$00
	BMI.b CODE_05A464
	LDA.w #$00FF
	STA.w $74A2,y
CODE_05A464:
	LDY.b #$00
	LDA.w $7A38,x
	BEQ.b CODE_05A47C
	CMP.w #$0100
	BPL.b CODE_05A472
	INY
	INY
CODE_05A472:
	CLC
	ADC.w DATA_05A3FE,y
	AND.w #$01FC
	STA.w $7A38,x
CODE_05A47C:
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0003
	BEQ.b CODE_05A48E
	JMP.w CODE_05A58C

CODE_05A48E:
	LDA.b $16,x
	AND.w #$0002
	TAY
	LDA.w $7A36,x
	CLC
	ADC.w DATA_05A3EE,y
	CMP.w DATA_05A3F2,y
	BEQ.b CODE_05A4A3
	JMP.w CODE_05A583

CODE_05A4A3:
	DEC.b $16,x
	DEC.b $16,x
	BEQ.b CODE_05A4AC
	JMP.w CODE_05A580

CODE_05A4AC:
	PHY
	LDY.b $76,x
	CPY.b #$05
	BNE.b CODE_05A4B6
	JMP.w CODE_05A540

CODE_05A4B6:
	LDY.w $7400,x
	LDA.w DATA_05A3FA,y
	STA.b $00
	LDY.w $7E48
	LDA.w $70E2,x
	CLC
	ADC.b $0C
	SEC
	SBC.w #$0008
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.b $0E
	SEC
	SBC.w #$0008
	STA.w $7182,y
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	CPY.b #$00
	BNE.b CODE_05A520
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	STZ.b $16
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	LDA.w #$0010
	STA.w $7AF8
	LDA.w $61B2
	AND.w #$0FFF
	STA.w $61B2
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
	BRA.b CODE_05A523

CODE_05A520:
	STZ.w $0390
CODE_05A523:
	PHX
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	ASL
	TAX
	SEP.b #$20
	LDA.l FXDATA_0A9F1A,x
	STA.w $74A2,y
	REP.b #$20
	PLX
	LDA.w #$FFFF
	STA.w $0D96
	STA.w $7E48
	BRA.b CODE_05A56D

CODE_05A540:
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDY.w $7400,x
	LDA.w DATA_05A3F6,y
	STA.w $60A8
	STA.w $60B4
	LDA.w #$0070
	STA.w $61D6
	STZ.w $0D94
	STZ.w $61B6
	LDA.w #$0060
	STA.w $7AF8,x
	LDA.w #$8841
	STA.w $6FA2,x
	LDA.w #$3D51
	STA.w $7040,x
CODE_05A56D:
	LDA.w #!Define_YI_SoundID14_Gulp
	JSL.l CODE_push_sound_queue
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w #$0204
	STA.b $76,x
	PLY
CODE_05A580:
	LDA.w DATA_05A3F2,y
CODE_05A583:
	STA.w $7A36,x
	JSR.w CODE_05A800
	JSR.w CODE_05A352
CODE_05A58C:
	LDA.w $70E2,x
	CLC
	ADC.b $0C
	SEC
	SBC.w $611C
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $7182,x
	CLC
	ADC.b $0E
	SEC
	SBC.w $611E
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	RTS

CODE_05A5AF:
	TYX
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_05A5B8
	JSR.w CODE_05A58C
CODE_05A5B8:
	LDA.w $7A96,x
	BNE.b CODE_05A5D9
	CPY.b #$00
	BNE.b CODE_05A5C6
	LDY.b #$01
	STY.b $76,x
	RTS

CODE_05A5C6:
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.b $16,x
	LDA.w #$0005
	STA.b $76,x
	JSR.w CODE_05A800
	JSR.w CODE_05A352
CODE_05A5D9:
	RTS

CODE_05A5DA:
	JSR.w CODE_05AAFC
	BRA.b CODE_05A5E8

CODE_05A5DF:
	PLA
	STA.b $00
	JSR.w CODE_05AB77
	LDA.b $00
	PHA
CODE_05A5E8:
	JSR.w CODE_05A990
	JSR.w CODE_05A800
	JMP.w CODE_05A352

CODE_05A5F1:
	TYX
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CMP.w #$0300
	BMI.b CODE_05A621
	LDA.w #!Define_YI_MusicID_FadeMusicCommand
	STA.w !RAM_YI_Global_PlayMusicLo
	LDA.w #$00DD
	JSL.l CODE_spawn_sprite_active
	LDA.w #!Define_YI_PlayerState02_InCutscene
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$0026
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0042
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	STZ.w $60A8
	STA.w $60B4
	INC.b $76,x
CODE_05A621:
	RTS

CODE_05A622:
	TYX
	LDY.w $105A
	BEQ.b CODE_05A65D
	JSL.l CODE_03AD74
	BCC.b CODE_05A65D
	LDA.w #$84A8
	STA.w $6FA0,x
	LDA.w #$3D51
	STA.w $7040,x
	LDA.w #$0055
	STA.w $7A36,x
	LDA.w #$0040
	STA.w $7AF6,x
	LDA.w #!Define_YI_MusicID09_BossBattle
	STA.w !RAM_YI_Global_PlayMusicLo
	INC.b $76,x
	LDA.w #$0048
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_05A65D
	LDA.w #$0010
	STA.w $70E2,y
CODE_05A65D:
	RTS

CODE_05A65E:
	TYX
	LDY.w !RAM_YI_Level_BossHasBeenVisitedBeforeFlagLo
	BEQ.b CODE_05A669
	LDA.w $1015
	BNE.b CODE_05A66F
CODE_05A669:
	LDA.l $704070
	BEQ.b CODE_05A67F
CODE_05A66F:
	STA.w $7A96,x
	LDY.b #$00
	STY.b $77,x
	JSR.w CODE_05A800
	JSR.w CODE_05A336
	INC.b $76,x
	RTS

CODE_05A67F:
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0003
	BNE.b CODE_05A69A
	STZ.w $7402,x
	JSR.w CODE_05A2B8
	JSR.w CODE_05A800
	JSR.w CODE_05A336
CODE_05A69A:
	LDA.w $7AF6,x
	BNE.b CODE_05A6A5
	INC.w $1015
	DEC.w $7AF6,x
CODE_05A6A5:
	RTS

CODE_05A6A6:
	TYX
	LDA.w $1015
	BPL.b CODE_05A6BD
	LDA.w #$0020
	STA.w $7AF6,x
	LDA.w #$FFFF
	STA.w $7A96,x
	STZ.w $1015
	INC.b $76,x
CODE_05A6BD:
	RTS

CODE_05A6BE:
	TYX
	LDA.w $7AF6,x
	BNE.b CODE_05A6E7
	LDA.w $7A38,x
	CLC
	ADC.w #$0002
	AND.w #$01FE
	CMP.w #$0030
	BNE.b CODE_05A6DE
	LDA.w #$0020
	STA.w $7AF6,x
	INC.b $76,x
	LDA.w #$0030
CODE_05A6DE:
	STA.w $7A38,x
	JSR.w CODE_05A800
	JSR.w CODE_05A336
CODE_05A6E7:
	RTS

CODE_05A6E8:
	TYX
	LDA.w $7AF6,x
	BNE.b CODE_05A6E7
	LDA.w $7A38,x
	SEC
	SBC.w #$0010
	AND.w #$01FE
	CMP.w #$01D0
	BNE.b CODE_05A6DE
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$8840
	STA.w $6FA2,x
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.b $78,x
	INC.b $76,x
	LDA.w #$01D0
	BRA.b CODE_05A6DE

CODE_05A719:
	TYX
	LDA.w $7182,x
	CMP.b $78,x
	BMI.b CODE_05A727
	LDA.w #$8841
	STA.w $6FA2,x
CODE_05A727:
	LDA.w $7682,x
	CMP.w #$0100
	BMI.b CODE_05A737
	LDA.w #$0080
	STA.w $7AF6,x
	INC.b $76,x
CODE_05A737:
	RTS

CODE_05A738:
	TYX
	LDA.w $7AF6,x
	BNE.b CODE_05A746
	INC.w $105A
	PLA
	JML.l CODE_03A31E

CODE_05A746:
	CMP.w #$0030
	BNE.b CODE_05A757
	LDA.w #$0260
	STA.w $61C6
	LDA.w #$01C0
	STA.w $61C8
CODE_05A757:
	RTS

CODE_05A758:
	TYX
	LDA.w $7042,x
	EOR.w #$0002
	STA.w $7042,x
	RTS

DATA_05A763:
	dw $0010,$FFF0,$0000

CODE_05A769:
	JSL.l CODE_03AA52
	LDA.w $7042,x
	AND.w #$0080
	ASL
	ASL
	XBA
	TAY
	LDA.w DATA_05A763,y
	STA.b $02
	LDA.w DATA_05A763+$02,y
	STA.b $04
	LDY.w $7400,x
	LDA.w DATA_05A763,y
	STA.b $00
	LDA.w DATA_05A763+$02,y
	REP.b #$10
	LDY.w $7362,x
	CLC
	ADC.b $0C
	CLC
	ADC.w $7680,x
	STA.w $6000,y
	STA.w $6010,y
	CLC
	ADC.b $00
	STA.w $6008,y
	STA.w $6018,y
	LDA.b $0E
	CLC
	ADC.b $04
	CLC
	ADC.w $7682,x
	STA.w $6002,y
	STA.w $600A,y
	CLC
	ADC.b $02
	STA.w $6012,y
	STA.w $601A,y
	LDA.b $76,x
	CMP.w #$0006
	BMI.b CODE_05A7D0
	LDA.w $1015
	BMI.b CODE_05A7F9
	CMP.w #$0002
	BPL.b CODE_05A7F9
CODE_05A7D0:
	LDA.w $7D96,x
	BNE.b CODE_05A7F9
	LDA.w $6024,y
	AND.w #$F1FF
	ORA.w #$0200
	STA.w $6024,y
	LDA.w $602C,y
	AND.w #$F1FF
	ORA.w #$0200
	STA.w $602C,y
	LDA.w $6034,y
	AND.w #$F1FF
	ORA.w #$0200
	STA.w $6034,y
CODE_05A7F9:
	SEP.b #$10
	RTS

DATA_05A7FC:
	dw FXDATA_540000+$60E1,FXDATA_540000+$60C1

CODE_05A800:
	LDA.w $7402,x
	BNE.b CODE_05A87B
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	TAY
	BMI.b CODE_05A813
	CLC
	ADC.w #$0100
CODE_05A813:
	SEC
	SBC.w #$00C0
	LSR
	LSR
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	SEC
	SBC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDY.b $77,x
	LDA.w DATA_05A7FC,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$60C1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0C00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7400,x
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08D5F1>>16
	LDA.w #FXCODE_08D5F1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	LDY.w $7042,x
	BPL.b CODE_05A87B
	LDA.w $6020
	EOR.w #$FFFF
	INC
	STA.w $6020
CODE_05A87B:
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; WILD PTOOIE PIRANHA (sprite $09F).
; Raidenthequick: init_wild_ptooie_piranha / main_wild_ptooie_piranha.
; Spits a tracking projectile; main runs the projectile's launch arc.
;=========================================================================
YI_NorSpr09F_PtooiePiranhaPlant_Init:
init_wild_ptooie_piranha:                   ; Raidenthequick: init_wild_ptooie_piranha
;$05A87C
	JSL.l CODE_03AE60
	LDA.w #$0100
	STA.w $7A36,x
	LDA.w #$01C0
	STA.w $7A38,x
	LDA.w #$0003
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	JSR.w CODE_05A9F0
	LDA.b $16,x
	LDY.w $7400,x
	BEQ.b CODE_05A8A0
	CLC
	ADC.w #$0008
CODE_05A8A0:
	TAY
	LDA.w DATA_05AA10,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSR.w CODE_05A800
	RTL

;---------------------------------------------------------------------------

DATA_05A8AB:
DATA_ptooie_piranha_state_ptr:                   ; 4-entry $76,x sub-state dispatch (Ptooie $09F)
	dw CODE_05A9CB                              ;  0: idle pace, blow needle ball
	dw CODE_05AA20                              ;  1: charge / re-load
	dw CODE_05AAFC                              ;  2: spit / drop ball
	dw CODE_05AB77                              ;  3: defeated

YI_NorSpr09F_PtooiePiranhaPlant_Main:
main_wild_ptooie_piranha:                   ; Raidenthequick: main_wild_ptooie_piranha
;$05A8B3
	LDY.b $18,x
	TYA
	CPY.b #$00
	BPL.b CODE_05A8BD
	ORA.w #$FF00
CODE_05A8BD:
	STA.b $0C
	STA.w $7B56,x
	LDY.b $19,x
	TYA
	CPY.b #$00
	BPL.b CODE_05A8CC
	ORA.w #$FF00
CODE_05A8CC:
	STA.b $0E
	STA.w $7B58,x
	JSR.w CODE_05A769
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_ptooie_piranha_state_ptr,x)
	JSR.w CODE_05A94C
	JSR.w CODE_05A990
	JSR.w CODE_05A800
	LDY.w $6022
	STY.b $18,x
	LDY.w $6020
	STY.b $19,x
	RTL

CODE_05A8F4:
	LDA.w $7C16,x
	EOR.w #$FFFF
	INC
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7C18,x
	EOR.w #$FFFF
	INC
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
CODE_05A916:
	STA.b $00
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w #$0004
	CMP.w #$0008
	BCS.b CODE_05A929
	LDA.b $00
	BRA.b CODE_05A945

CODE_05A929:
	BPL.b CODE_05A939
	CMP.w #$FF00
	BMI.b CODE_05A93E
CODE_05A930:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEC
	SBC.w #$0004
	BRA.b CODE_05A945

CODE_05A939:
	CMP.w #$0100
	BPL.b CODE_05A930
CODE_05A93E:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w #$0004
CODE_05A945:
	AND.w #$01FE
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTS

CODE_05A94C:
	LDY.b $76,x
	CPY.b #$02
	BPL.b CODE_05A98F
	LDY.w $7D36,x
	BEQ.b CODE_05A98F
	DEY
	BPL.b CODE_05A95F
	JSL.l CODE_03A858
	RTS

CODE_05A95F:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05A98F
	LDA.w $7D38,y
	BEQ.b CODE_05A98F
CODE_05A96C:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	PHP
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDA.w #!Define_YI_SoundID0B_ShellHit1
	JSL.l CODE_push_sound_queue
	LDY.b #$00
	PLP
	BPL.b CODE_05A983
	INY
	INY
CODE_05A983:
	STY.b $78,x
	LDA.w #$0020
	STA.w $7AF8,x
	LDY.b #$02
	STY.b $76,x
CODE_05A98F:
	RTS

CODE_05A990:
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w #$0080
	AND.w #$01FE
	CMP.w #$00E8
	BMI.b CODE_05A9B5
	CMP.w #$0118
	BMI.b CODE_05A9C2
	INY
	INY
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEC
	SBC.w #$0100
	EOR.w #$FFFF
	INC
	BRA.b CODE_05A9B8

CODE_05A9B5:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_05A9B8:
	AND.w #$01FE
	STA.w $7A38,x
	TYA
	STA.w $7400,x
CODE_05A9C2:
	RTS

DATA_05A9C3:
	dw $0004,$FFFC

DATA_05A9C7:
	dw $0100,$00E0

CODE_05A9CB:
	TYX
	LDA.w $7AF8,x
	BNE.b CODE_05AA0F
	LDA.b $16,x
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_05A9C3,y
	STA.b $00
	CLC
	ADC.w $7A36,x
	STA.w $7A36,x
	SEC
	SBC.w DATA_05A9C7,y
	EOR.b $00
	BMI.b CODE_05AA0C
	DEC.b $16,x
	BPL.b CODE_05AA0C
CODE_05A9F0:
	LDA.w #$0010
	STA.w $7AF8,x
	LDA.w #$0004
	STA.b $16,x
	LDA.w $70E2,x
	AND.w #$0010
	BNE.b CODE_05AA07
	LDY.b #$06
	STY.b $16,x
CODE_05AA07:
	LDA.w #$0001
	STA.b $76,x
CODE_05AA0C:
	JSR.w CODE_05A8F4
CODE_05AA0F:
	RTS

DATA_05AA10:
	dw $0190,$01A8,$01A8,$0198,$0170,$0158,$0158,$0168

CODE_05AA20:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_05AA2A
	LDY.b #$00
	STY.b $77,x
CODE_05AA2A:
	LDA.w $7AF8,x
	BNE.b CODE_05AA0F
	LDA.b $16,x
	BPL.b CODE_05AA41
	LDA.w #$0010
	STA.w $7AF8,x
	LDA.w #$000B
	STA.b $16,x
	STZ.b $76,x
	RTS

CODE_05AA41:
	LDY.w $7400,x
	BEQ.b CODE_05AA4A
	CLC
	ADC.w #$0008
CODE_05AA4A:
	TAY
	LDA.w DATA_05AA10,y
	PHA
	PHY
	JSR.w CODE_05A916
	PLY
	PLA
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_05AA0F
	LDA.w $70E2,x
	AND.w #$0010
	BNE.b CODE_05AA64
	STZ.b $16,x
CODE_05AA64:
	DEC.b $16,x
	DEC.b $16,x
	LDA.w #$0010
	STA.w $7A98,x
	LDA.w #$0040
	STA.w $7AF8,x
	LDY.b #$02
	STY.b $77,x
	LDA.w #$00F9
	JSL.l CODE_spawn_sprite_init
	BCS.b CODE_05AA87
	LDA.w #$FFFF
	STA.b $16,x
	RTS

CODE_05AA87:
	LDA.w $70E2,x
	CLC
	ADC.b $0C
	SEC
	SBC.w #$0008
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.b $0E
	SEC
	SBC.w #$0008
	STA.w $7182,y
	LDA.w #$0040
	STA.w $7542,y
	LDA.w #$0400
	STA.w $75E2,y
	PHY
	LDA.w #$FA00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	PLY
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $7400,x
	STA.w $7400,y
	LDA.w #!Define_YI_SoundID14_Gulp
	JSL.l CODE_push_sound_queue
	RTS

DATA_05AAE0:
	dw $FFF0,$FFF0,$FFFC,$FFFC

DATA_05AAE8:
	dw $FFF0,$0010,$FFFC,$0004

DATA_05AAF0:
	dw $0140,$01C0,$0100,$0000

DATA_05AAF8:
	db $22,$22,$24,$20

CODE_05AAFC:
	TYX
	LDA.w $7AF8,x
	BNE.b CODE_05AB33
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr09F_PtooiePiranhaPlant
	BNE.b CODE_05AB1B
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w DATA_05AAF8-$01,y
	AND.w #$00FF
	STA.w $7042,x
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_05AB25
CODE_05AB1B:
	LDA.w #!Define_YI_SoundID25_DyingPiranha
	JSL.l CODE_push_sound_queue
	INC.b $76,x
	RTS

CODE_05AB25:
	LDA.w #$0010
	STA.w $7AF8,x
	LDA.w #$000B
	STA.b $16,x
	STZ.b $76,x
	RTS

CODE_05AB33:
	LDY.b $78,x
	BMI.b CODE_05AB53
	LDA.w DATA_05AAE0,y
	AND.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w DATA_05AAE8,y
	AND.w #$01FE
	CMP.w DATA_05AAF0,y
	BNE.b CODE_05AB50
	LDA.w DATA_05AAF0,y
	LDY.b #$FF
	STY.b $78,x
CODE_05AB50:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_05AB53:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr09F_PtooiePiranhaPlant
	BNE.b CODE_05AB76
	LDA.w $7974
	BIT.w #$0003
	BNE.b CODE_05AB76
	AND.w #$0004
	LSR
	LSR
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TAY
	LDA.w DATA_05AAF8-$01,y
	AND.w #$00FF
	STA.w $7042,x
CODE_05AB76:
	RTS

CODE_05AB77:
	TYX
	LDA.w $7A36,x
	SEC
	SBC.w #$0004
	CMP.w #$0030
	BPL.b CODE_05AB92
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	PLA
	JML.l CODE_kill_sprite_by_hit_special_cases

CODE_05AB92:
	STA.w $7A36,x
	LDA.w $7A98,x
	BNE.b CODE_05ABA9
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w $7042,x
	EOR.w #$000E
	STA.w $7042,x
CODE_05ABA9:
	RTS

;---------------------------------------------------------------------------

DATA_05ABAA:
	dw $0030,$FFD0

DATA_05ABAE:
	dw $FEC0,$0140

;=========================================================================
; SMALL BURT / BURT (sprite $0E7).
; Raidenthequick: init_small_burt / main_small_burt.
; The pants-dropping pink enemy. State machine handles walk, jump,
; squash-on-landing, and bounce-back behavior.
;=========================================================================
YI_NorSpr0E7_Burt_Init:
init_small_burt:                            ; Raidenthequick: init_small_burt
;$05ABB2
	JSL.l CODE_03AE60
	LDA.w #$0003
	STA.w $7A38,x
	LDA.w #$0100
	STA.w $7A36,x
	SEP.b #$20
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	REP.b #$20
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_05ABD6
	LDA.w $70E2,x
	AND.w #$0010
	BEQ.b CODE_05ABFA
CODE_05ABD6:
	LDA.w #$03FF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDY.b #$0C
	STY.b $76,x
	LDA.w #$0034
	STA.w $7542,x
	LDA.w #$0340
	STA.w $75E2,x
	LDA.w #$0002
	STA.w $0EED
	AND.b $78,x
	STA.b $78,x
	JSR.w CODE_05B035
	RTL

CODE_05ABFA:
	LDY.w $7400,x
	LDA.w DATA_05ABAA,y
	STA.b $00
	LDA.w DATA_05ABAE,y
	STA.b $04
	LDA.w #$00E7
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_05AC1F
	STY.b $02
	TYX
	JSL.l CODE_03AD74
	BCS.b CODE_05AC23
	JSL.l CODE_03A31E
	LDX.b $12
CODE_05AC1F:
	JML.l CODE_03A31E

CODE_05AC23:
	LDX.b $12
	LDY.b $02
	LDA.w $70E2,x
	CLC
	ADC.b $00
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w $7400,x
	STA.w $7400,y
	TYA
	ORA.w #$0300
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TXA
	ORA.w #$0300
CODE_05AC47:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	TXA
	XBA
	ORA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	INC
	STA.w $7A38,y
	LDA.w #$0100
	STA.w $7A36,y
	LDA.b $04
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FB00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0140
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	SEP.b #$20
	LDA.w $74A0,x
	STA.w $74A0,y
	TYA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	REP.b #$20
	TYX
	JSR.w CODE_05B035
	LDX.b $12
	STZ.w $0EED
	JSR.w CODE_05B035
	RTL

;---------------------------------------------------------------------------

DATA_05AC8E:
DATA_small_burt_state_ptr:                       ; 16-entry $76,x sub-state dispatch (Burt the Bashful)
	dw CODE_small_burt_state_00_idle_watch                                ;  $0: idle / inflate-watch
	dw CODE_small_burt_state_01_inflate                                ;  $1: inflate
	dw CODE_small_burt_state_02_deflate                                ;  $2: deflate
	dw CODE_small_burt_state_03_hop_forward                                ;  $3: hop forward
	dw CODE_05B182                                ;  $4: shared facing-toggle helper
	dw CODE_05B18B                                ;  $5: shared post-hop helper
	dw CODE_0580C2                                ;  $6: shared GSU delta-facing
	dw CODE_05B1A9                                ;  $7: inflated-and-hopping
	dw CODE_05B205                                ;  $8: bounce-on-Yoshi
	dw CODE_05B257                                ;  $9: post-bounce launch
	dw CODE_05B2EA                                ;  $A: airborne / flying
	dw CODE_05B34F                                ;  $B: airborne settle
	dw CODE_05B3AB                                ;  $C: defeat fall
	dw CODE_05B3E3                                ;  $D: defeat finish
	dw CODE_05B182                                ;  $E: (reuse facing-toggle helper)
	dw CODE_05B18B                                ;  $F: (reuse post-hop helper)

YI_NorSpr0E7_Burt_Main:
main_small_burt:                            ; Raidenthequick: main_small_burt
;$05ACAE
	LDY.w $74A2,x
	BMI.b CODE_05ACB6
	JSR.w CODE_05AD19
CODE_05ACB6:
	JSR.w CODE_05AE61
	JSL.l CODE_03AF23
	LDA.w #$0018
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$000E
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0200
	SEC
	SBC.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_0B86EC>>16
	LDA.w #FXCODE_0B86EC
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $0E
	JSR.w CODE_05ADA6
	JSR.w CODE_05AF09
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_small_burt_state_ptr,x)
	JSR.w CODE_05B035
CODE_05AD00:
	RTL

CODE_05AD01:
	CMP.w #$00E7
	BNE.b CODE_05AD00
	JSR.w CODE_05AE7E
	JML.l CODE_despawn_sprite_free_slot

DATA_05AD0D:
	dw $009E,$002E,$002F

DATA_05AD13:
	dw $FFFF,$0001,$0003

CODE_05AD19:
	LDY.b #$00
	LDA.b $76,x
	CMP.w #$000A
	BEQ.b CODE_05AD3E
	CMP.w #$000B
	BEQ.b CODE_05AD3E
	LDA.w $7860,x
	LSR
	BCS.b CODE_05AD50
	LDA.b $76,x
	CMP.w #$0006
	BEQ.b CODE_05AD50
	CMP.w #$0008
	BEQ.b CODE_05AD3E
	CMP.w #$000D
	BNE.b CODE_05AD47
CODE_05AD3E:
	LDA.w $7AF6,x
	BEQ.b CODE_05AD50
	INY
	INY
	BRA.b CODE_05AD50

CODE_05AD47:
	INY
	INY
	LDA.w $7AF6,x
	BNE.b CODE_05AD50
	INY
	INY
CODE_05AD50:
	LDA.w DATA_05AD0D,y
	STA.b $00
	LDA.w DATA_05AD13,y
	STA.w $7A38,x
	REP.b #$10
	LDY.w $7362,x
	BMI.b CODE_05ADA3
	LDA.w $6004,y
	AND.w #$FF00
	ORA.b $00
	STA.w $6004,y
	LDA.w $600C,y
	AND.w #$FF00
	ORA.b $00
	STA.w $600C,y
	TYA
	CLC
	ADC.w #$0010
	TAY
	PHY
	JSL.l CODE_03AA60
	REP.b #$10
	PLY
	LDA.w #$0004
	STA.b $02
	LDA.w $7A38,x
	STA.b $00
CODE_05AD90:
	LDA.w $6002,y
	SEC
	SBC.b $00
	STA.w $6002,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEC.b $02
	BNE.b CODE_05AD90
CODE_05ADA3:
	SEP.b #$10
CODE_05ADA5:
	RTS

CODE_05ADA6:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_05ADB3:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_05ADA5
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05ADA5
	LDA.w $7D38,y
	BNE.b CODE_05ADD2
CODE_05ADC7:
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_05ADB3

CODE_05ADD2:
	LDA.w $6FA2,y
	AND.w #$4000
	BNE.b CODE_05ADC7
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
CODE_05ADDF:
	JSL.l CODE_05AE0B
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BMI.b CODE_05ADF1
	SEP.b #$20
	LDA.b #$FF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,y
	REP.b #$20
CODE_05ADF1:
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	PLA
	JML.l CODE_kill_sprite_by_hit

DATA_05ADFF:
	dw $0000,$FE6B,$0195

DATA_05AE05:
	dw $FE00,$FE11,$FE11

CODE_05AE0B:
	PHB
	PHK
	PLB
	LDA.w !RAM_YI_Level_StarTimerLo
	STA.b $06
	LDY.b #$06
CODE_05AE15:
	TYA
	STA.b $00
	LDA.w DATA_05ADFF-$02,y
	STA.b $02
	LDA.w DATA_05AE05-$02,y
	STA.b $04
	LDA.b $06
	CLC
	ADC.w #$000A
	STA.b $06
	CMP.w #!Define_YI_Level_SoftMaxStarTimerThreshold+$0A
	BMI.b CODE_05AE34
	LDA.w #$0115
	BRA.b CODE_05AE37

CODE_05AE34:
	LDA.w #$01A2
CODE_05AE37:
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_05AE5F
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.b $02
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $04
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0011
	STA.w $7AF6,y
	LDY.b $00
	DEY
	DEY
	BNE.b CODE_05AE15
CODE_05AE5F:
	PLB
	RTL

CODE_05AE61:
	LDA.w $7D96,x
	BEQ.b CODE_05AE71
	STZ.w $6FA2,x
	LDA.w #$3155
	STA.w $7040,x
	BRA.b CODE_05AE7E

CODE_05AE71:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_05AED4
	CMP.w #$0008
	BEQ.b CODE_05AE95
CODE_05AE7E:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BPL.b CODE_05AE84
	RTS

CODE_05AE84:
	SEP.b #$20
	LDA.b #$FF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,y
	STA.w $74A0,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	REP.b #$20
	BRA.b CODE_05AE9A

CODE_05AE95:
	LDA.w $75E0,x
	BNE.b CODE_05AED2
CODE_05AE9A:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_05AED2
	SEP.b #$20
	LDA.b #$FF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	REP.b #$20
	LDA.w #$000C
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	EOR.w #$0002
	STA.w $0EED
	LDA.w #$0034
	STA.w $7542,y
	LDA.w #$0340
	STA.w $75E2,y
	STA.w $75E0,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	AND.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
CODE_05AED2:
	PLA
	RTL

CODE_05AED4:
	JSL.l CODE_03A2B0
	BCC.b CODE_05AF04
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_05AEEA
	TYX
	JSL.l CODE_03A2B0
	BCC.b CODE_05AF02
	JSL.l CODE_03A31E
CODE_05AEEA:
	LDX.b $12
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BMI.b CODE_05AEFD
	SEP.b #$20
	LDA.b #$FF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,y
	STA.w $74A0,x
	REP.b #$20
CODE_05AEFD:
	PLA
	JML.l CODE_03A31E

CODE_05AF02:
	LDX.b $12
CODE_05AF04:
	RTS

DATA_05AF05:
	dw $0100,$FF00

CODE_05AF09:
	LDY.w $0D94
	BNE.b CODE_05AF68
	CPX.w $61B6
	BNE.b CODE_05AF78
	LDA.b $78,x
	AND.w #$0002
	BEQ.b CODE_05AF78
	LDA.w $60FC
	BIT.w #$0007
	BNE.b CODE_05AF62
	LDY.w $7223,x
	BPL.b CODE_05AF46
	AND.w #$0018
	BEQ.b CODE_05AF46
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
	LDA.w $7CD8,x
	SEC
	SBC.w $72C2,x
	STA.w $7CD8,x
	STZ.w $72C2,x
CODE_05AF46:
	LDA.w $6120
	CLC
	ADC.w $7BB6,x
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $611C
	SEC
	SBC.w $7CD6,x
	CMP.b $00
	BCS.b CODE_05AF62
	LDY.w $60AB
	BPL.b CODE_05AFD1
CODE_05AF62:
	LDA.w #$0010
	STA.w $7AF8,x
CODE_05AF68:
	LDA.b $78,x
	AND.w #$0001
	STA.b $78,x
	CPX.w $61B6
	BNE.b CODE_05AF77
	STZ.w $61B6
CODE_05AF77:
	RTS

CODE_05AF78:
	LDA.w $6120
	CLC
	ADC.w $7BB6,x
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $611C
	SEC
	SBC.w $7CD6,x
	CMP.b $00
	BCS.b CODE_05AF68
	LDA.b $0E
	SEC
	SBC.w $6122
	SEC
	SBC.w $611E
	BPL.b CODE_05AF68
	CMP.w #$FFF0
	BCS.b CODE_05AFA3
CODE_05AFA0:
	JMP.w CODE_05B02B

CODE_05AFA3:
	LDY.w $60AB
	BMI.b CODE_05AFA0
	LDA.w $60FC
	BIT.w #$0018
	BEQ.b CODE_05AFB5
	AND.w #$01E0
	BEQ.b CODE_05B02B
CODE_05AFB5:
	LDY.w $60D4
	BEQ.b CODE_05AFBD
	JMP.w CODE_05ADDF

CODE_05AFBD:
	LDY.w $61B6
	BEQ.b CODE_05AFC7
	CPX.w $61B6
	BNE.b CODE_05B02B
CODE_05AFC7:
	STX.w $61B6
	LDA.b $78,x
	ORA.w #$0002
	STA.b $78,x
CODE_05AFD1:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05AFF6
	LDA.b $78,x
	AND.w #$0001
	BNE.b CODE_05AFF6
	LDY.b $76,x
	CPY.b #$0A
	BEQ.b CODE_05AFF6
	LDA.w #$0004
	STA.w $7AF6,x
	LDY.b #$0A
	STY.b $76,x
	STZ.w $60A8
	STZ.w $60B4
CODE_05AFF6:
	LDA.b $0E
	SEC
	SBC.w $6122
	SEC
	SBC.w $611E
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$0180
	LDY.w $72C1,x
	BMI.b CODE_05B012
	LDA.w #$0060
CODE_05B012:
	AND.w $60FC
	BNE.b CODE_05B021
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C0,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_05B021:
	STZ.w $60AA
	STZ.w $60D4
	INC.w $61B4
	RTS

CODE_05B02B:
	LDY.w $7D36,x
	BPL.b CODE_05B034
	JSL.l CODE_03A858
CODE_05B034:
	RTS

CODE_05B035:
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0200
	SEC
	SBC.w !REGISTER_SuperFX_R6_MultiplierLo
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	ASL
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #(FXDATA_548000+$00E1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_548000+$00E1
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

CODE_05B07C:
CODE_small_burt_state_00_idle_watch:
	TYX
CODE_05B07D:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_05B0CD
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	BMI.b CODE_05B0CD
	LDA.w $70E2,x
	SEC
	SBC.w $70E2,y
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_05B0CD
	LDA.b $0E
	SEC
	SBC.w #$000E
	STA.b $00
	SEC
	SBC.w $7182,y
	BPL.b CODE_05B0CD
	CMP.w #$FFF8
	BMI.b CODE_05B0CD
	LDA.b $00
	STA.w $7182,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w $7542,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0002
	STA.w $7AF6,y
	LDA.w #$0006
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	INC.b $78,x
	LDY.b #$01
	STY.b $76,x
CODE_05B0CD:
	RTS

CODE_05B0CE:
CODE_small_burt_state_01_inflate:
	TYX
	LDA.w $7A36,x
	CMP.w #$0160
	BMI.b CODE_05B13B
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05B119
	LDA.w #$FA00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0034
	STA.w $7542,y
	LDA.w #$0340
	STA.w $75E2,y
	LDA.w #$0004
	STA.w $7AF6,y
	LDA.w #$0180
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	PHY
	LDA.w $7400,y
	TAY
	LDA.w DATA_05ABAE,y
	PLY
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0007
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #!Define_YI_SoundID34_BurtJump
	JSL.l CODE_push_sound_queue
CODE_05B119:
	LDA.b $78,x
	AND.w #$0002
	BEQ.b CODE_05B132
	LDA.w #$FC00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
CODE_05B132:
	STZ.b $78,x
	INC.b $76,x
	LDA.w #$0160
	BRA.b CODE_05B13F

CODE_05B13B:
	CLC
	ADC.w #$0008
CODE_05B13F:
	STA.w $7A36,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7A36,y
	LDA.b $0E
	SEC
	SBC.w #$000E
	STA.w $7182,y
	RTS

CODE_05B152:
CODE_small_burt_state_02_deflate:
	TYX
	LDA.w $7A36,x
	CMP.w #$00C0
	BPL.b CODE_05B162
	INC.b $76,x
	LDA.w #$00C0
	BRA.b CODE_05B166

CODE_05B162:
	SEC
	SBC.w #$0018
CODE_05B166:
	STA.w $7A36,x
	RTS

CODE_05B16A:
CODE_small_burt_state_03_hop_forward:
	TYX
	LDA.w $7A36,x
	CMP.w #$0100
	BMI.b CODE_05B17A
	STZ.b $76,x
	LDA.w #$0100
	BRA.b CODE_05B17E

CODE_05B17A:
	CLC
	ADC.w #$0008
CODE_05B17E:
	STA.w $7A36,x
	RTS

CODE_05B182:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_05B1CB
	INC.b $76,x
	RTS

CODE_05B18B:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05B1A8
	INC
	STA.w $7AF6,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b #$09
	LDA.b $76,x
	CMP.w #$0005
	BEQ.b CODE_05B1A6
	LDY.b #$0D
CODE_05B1A6:
	STY.b $76,x
CODE_05B1A8:
	RTS

CODE_05B1A9:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_05B1CB
	LDA.w #$0100
	STA.w $7A36,x
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05B1CA
	LDA.w #$0004
	STA.w $7AF6,x
	STA.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
CODE_05B1CA:
	RTS

CODE_05B1CB:
	EOR.w #$FFFF
	INC
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $18,x
	ASL
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0040
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_0B86D1>>16
	LDA.w #FXCODE_0B86D1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #$0100
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w $7A36,x
	LSR
	STA.w $7A36,x
	RTS

DATA_05B1F9:
	dw $0100,$00C0,$0160

DATA_05B1FF:
	dw $0008,$FFF0,$0010

CODE_05B205:
	TYX
	LDA.b $16,x
	TAY
	AND.w #$0002
	BEQ.b CODE_05B218
	LDA.w $7A36,x
	CMP.w DATA_05B1F9,y
	BPL.b CODE_05B24F
	BRA.b CODE_05B220

CODE_05B218:
	LDA.w $7A36,x
	CMP.w DATA_05B1F9,y
	BMI.b CODE_05B24F
CODE_05B220:
	DEC.b $16,x
	DEC.b $16,x
	BPL.b CODE_05B24A
	PHY
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0010
	STA.w $7A96,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0009
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDY.b #$00
	STY.b $76,x
	LDA.w $0EED
	EOR.w #$0002
	STA.w $0EED
	PLY
CODE_05B24A:
	LDA.w DATA_05B1F9,y
	BRA.b CODE_05B253

CODE_05B24F:
	CLC
	ADC.w DATA_05B1FF,y
CODE_05B253:
	STA.w $7A36,x
CODE_05B256:
	RTS

CODE_05B257:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_05B256
	LDA.w $7A36,x
	CMP.w #$0140
	BMI.b CODE_05B2E2
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w $7CD6,y
	SEC
	SBC.w $7CD6,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCC.b CODE_05B288
	BPL.b CODE_05B282
	LDA.w #$FFC0
	BRA.b CODE_05B285

CODE_05B282:
	LDA.w #$0040
CODE_05B285:
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
CODE_05B288:
	LDA.w #$05C0
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	STZ.w $7400,x
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_05B2AA
	LDA.w #$0002
	STA.w $7400,x
CODE_05B2AA:
	LDA.w #$FB00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0140
	STA.b $18,x
	LDA.w #$0004
	STA.w $7AF6,x
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	STZ.w $7860,x
	LDA.w #!Define_YI_SoundID34_BurtJump
	JSL.l CODE_push_sound_queue
	LDA.b $78,x
	AND.w #$0002
	BEQ.b CODE_05B2DD
	STZ.w $61B4
	STZ.b $78,x
	LDA.w #$0010
	STA.w $7AF8,x
CODE_05B2DD:
	LDA.w #$0140
	BRA.b CODE_05B2E6

CODE_05B2E2:
	CLC
	ADC.w #$0006
CODE_05B2E6:
	STA.w $7A36,x
	RTS

CODE_05B2EA:
	TYX
	LDY.w $7223,x
	BMI.b CODE_05B2FB
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05B2FB
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_05B2FB:
	LDA.w $7A36,x
	CMP.w #$0160
	BMI.b CODE_05B344
	LDA.b $78,x
	AND.w #$0002
	BNE.b CODE_05B317
	STZ.w $61B4
	LDA.w #$0004
	STA.w $7AF6,x
	INC.b $76,x
	BRA.b CODE_05B33F

CODE_05B317:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_05B33F
	LDA.w $7860,y
	LSR
	BCC.b CODE_05B33F
	LDA.w #$0009
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	BEQ.b CODE_05B33F
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #$0010
	STA.w $7A96,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STY.w $0EED
CODE_05B33F:
	LDA.w #$0160
	BRA.b CODE_05B348

CODE_05B344:
	CLC
	ADC.w #$0008
CODE_05B348:
	STA.w $7A36,x
	JSR.w CODE_05B07D
	RTS

CODE_05B34F:
	TYX
	LDY.w $7223,x
	BMI.b CODE_05B360
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05B360
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_05B360:
	LDA.w $7A36,x
	CMP.w #$0100
	BPL.b CODE_05B3A0
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BPL.b CODE_05B371
	LDY.b #$0C
	BRA.b CODE_05B399

CODE_05B371:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w $0EED
	BEQ.b CODE_05B397
	LDA.w $7860,y
	LSR
	BCC.b CODE_05B39B
	LDA.w #$0010
	STA.w $7A96,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0009
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STY.w $0EED
CODE_05B397:
	LDY.b #$00
CODE_05B399:
	STY.b $76,x
CODE_05B39B:
	LDA.w #$0100
	BRA.b CODE_05B3A4

CODE_05B3A0:
	SEC
	SBC.w #$0010
CODE_05B3A4:
	JMP.w CODE_05B348

DATA_05B3A7:
	dw $0008,$FFF8

CODE_05B3AB:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05B3CF
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b #$00
	LDA.w $7A36,x
	CMP.w #$0100
	BNE.b CODE_05B3D0
	LDA.w #$0004
	STA.w $7AF6,x
	LDA.w #$0020
	STA.w $7A96,x
	INC.b $76,x
CODE_05B3CF:
	RTS

CODE_05B3D0:
	BMI.b CODE_05B3D4
	INY
	INY
CODE_05B3D4:
	CLC
	ADC.w DATA_05B3A7,y
	AND.w #$FFF8
	STA.w $7A36,x
	RTS

DATA_05B3DF:
	dw $FF22,$00DE

CODE_05B3E3:
	TYX
	LDA.w $7A36,x
	CMP.w #$0140
	BMI.b CODE_05B415
	LDY.w $7400,x
	LDA.w DATA_05B3DF,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FA00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0180
	STA.b $18,x
	LDA.w #$0004
	STA.w $7AF6,x
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID34_BurtJump
	JSL.l CODE_push_sound_queue
	LDA.w #$0140
	BRA.b CODE_05B419

CODE_05B415:
	CLC
	ADC.w #$0008
CODE_05B419:
	STA.w $7A36,x
	RTS

;---------------------------------------------------------------------------

DATA_05B41D:
	db $20,$22,$24,$28

;=========================================================================
; BALLOON PLATFORM (sprite $052).
; Raidenthequick: init_balloon / main_balloon.
; Inflatable ride: Yoshi mounts, the balloon shrinks over time, pops.
;=========================================================================
YI_NorSpr052_BalloonPlatform_Init:
init_balloon:                               ; Raidenthequick: init_balloon
;$05B421
	LDA.w $70E2,x
	BIT.w #$0010
	BEQ.b CODE_05B455
	AND.w #$FFE0
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$00FF
	STA.w $74A2,x
	LDA.w #$0060
	STA.w $6FA0,x
	LDA.w #$4000
	STA.w $6FA2,x
	LDA.w #$0002
	STA.w $7040,x
	STZ.w $7542,x
	INC.b $76,x
	LDY.w !RAM_YI_Level_NorSpr_BalloonGeneratorActiveFlagLo
	BNE.b CODE_05B454
	INC.w !RAM_YI_Level_NorSpr_BalloonGeneratorActiveFlagLo
CODE_05B454:
	RTL

CODE_05B455:
	LDY.w $0FEB
	BNE.b CODE_05B469
	JSL.l CODE_03AE60
	INC.w $0FEB
	LDA.w $7722,x
	STA.w $0FE9
	BRA.b CODE_05B46F

CODE_05B469:
	LDA.w $0FE9
	STA.w $7722,x
CODE_05B46F:
	INC.w $0FED
	LDA.w #$0040
	STA.w $7A96,x
	STA.w $75E0,x
	LDA.w #$0004
	STA.w $7540,x
	SEP.b #$20
	LDA.b $10
	AND.b #$03
	TAY
	LDA.w DATA_05B41D,y
	STA.w $7042,x
	REP.b #$20
	LDA.w #FXDATA_550000+$0041
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$0041)>>16
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
	RTL

;---------------------------------------------------------------------------

YI_NorSpr052_BalloonPlatform_Main:
main_balloon:                               ; Raidenthequick: main_balloon
;$05B4CC
	LDY.b $76,x
	BEQ.b CODE_05B4D3
	JMP.w CODE_05B52B

CODE_05B4D3:
	JSL.l CODE_03AA52
	JSL.l CODE_03AF23
	JSL.l CODE_03A2C7
	BCC.b CODE_05B50F
	LDA.w $7722,x
	CMP.w $0FE9
	BEQ.b CODE_05B4F3
	JSL.l CODE_03AEFD
	LDA.w $0FE9
	STA.w $7722,x
CODE_05B4F3:
	DEC.w $0FED
	BEQ.b CODE_05B500
	LDA.w #$FFFF
	STA.w $7722,x
	BRA.b CODE_05B503

CODE_05B500:
	STZ.w $0FEB
CODE_05B503:
	CPX.w $61B6
	BNE.b CODE_05B50B
	STZ.w $61B6
CODE_05B50B:
	JML.l CODE_03A31E

CODE_05B50F:
	JSR.w CODE_05B565
	JSR.w CODE_05B6B0
	LDA.w $7A96,x
	BNE.b CODE_05B52A
	LDA.w #$0080
	STA.w $7A96,x
	LDA.w $75E0,x
	EOR.w #$FFFF
	INC
	STA.w $75E0,x
CODE_05B52A:
	RTL

CODE_05B52B:
	JSL.l CODE_03AF23
	LDY.w !RAM_YI_Level_NorSpr_BalloonGeneratorActiveFlagLo
	BEQ.b CODE_05B50B
	LDA.w $7680,x
	CLC
	ADC.w #$0040
	CMP.w #$0180
	BCS.b CODE_05B50B
	LDA.w $7A96,x
	BNE.b CODE_05B564
	LDA.w #$0052
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_05B564
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $70E2,y
	LDA.w $609C
	CLC
	ADC.w #$0100
	STA.w $7182,y
	LDA.w #$0240
	STA.w $7A96,x
CODE_05B564:
	RTL

CODE_05B565:
	LDY.w $60AB
	BMI.b CODE_05B5B0
	LDY.w $0D94
	BNE.b CODE_05B5B0
	LDA.w $60FC
	AND.w #$0018
	BNE.b CODE_05B5B0
	LDA.w $7C16,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_05B5B0
	LDA.b $78,x
	LSR
	LSR
	LSR
	LSR
	CLC
	ADC.w $7182,x
	CLC
	ADC.w #$0000
	SEC
	SBC.w $611E
	SEC
	SBC.w $6122
	STA.b $00
	CPX.w $61B6
	BNE.b CODE_05B5AB
	LDA.w $75E2,x
	CMP.w #$FF40
	BEQ.b CODE_05B5B8
	JMP.w CODE_05B64D

CODE_05B5AB:
	CMP.w #$FFF8
	BCS.b CODE_05B5EE
CODE_05B5B0:
	CPX.w $61B6
	BNE.b CODE_05B5CE
	STZ.w $61B6
CODE_05B5B8:
	LDA.w #$0040
	STA.w $75E0,x
	LDA.w #$FF40
	STA.w $75E2,x
	LDA.w $7C16,x
	ASL
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_05B5CE:
	LDY.b $18,x
	BEQ.b CODE_05B5ED
	LDA.b $78,x
	SEC
	SBC.w #$0010
	STA.b $78,x
	CMP.w #$0010
	BPL.b CODE_05B5ED
	STZ.b $18,x
	STZ.b $78,x
	JSL.l CODE_03AEFD
	LDA.w $0FE9
	STA.w $7722,x
CODE_05B5ED:
	RTS

CODE_05B5EE:
	LDY.w $60C0
	BEQ.b CODE_05B5B0
	LDY.w $61B6
	BNE.b CODE_05B5CE
	STX.w $61B6
	LDA.w $60AA
	LSR
	LSR
	CMP.w #$0060
	BMI.b CODE_05B608
	LDA.w #$0060
CODE_05B608:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	ASL
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CMP.w #$00C0
	BMI.b CODE_05B618
	LDA.w #$00C0
CODE_05B618:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FFD0
	STA.w $75E2,x
	LDA.w $60A8
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $75E0,x
	JSL.l CODE_03AD74
	BCC.b CODE_05B64D
	STZ.b $78,x
	STZ.w $7A38,x
	LDA.w #$0010
	STA.w $7A36,x
	INC.b $18,x
CODE_05B64D:
	LDA.w $60FC
	AND.w #$0007
	BEQ.b CODE_05B65D
	LDY.w $7223,x
	BMI.b CODE_05B65D
	JMP.w CODE_05B5B0

CODE_05B65D:
	LDY.b $18,x
	BEQ.b CODE_05B692
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.b $78,x
	BMI.b CODE_05B670
	LDA.b $78,x
	CLC
	ADC.w $7A36,x
	BRA.b CODE_05B690

CODE_05B670:
	LDA.w $7A38,x
	BNE.b CODE_05B685
	INC.w $7A38,x
	LDA.w $7A36,x
	LSR
	STA.w $7A36,x
	LDA.w #$0020
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_05B685:
	LDA.b $78,x
	CMP.w $7A36,x
	BEQ.b CODE_05B690
	SEC
	SBC.w $7A36,x
CODE_05B690:
	STA.b $78,x
CODE_05B692:
	LDA.b $00
	INC
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C0,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STZ.w $60C0
	STZ.w $60AA
	INC.w $61B4
	RTS

CODE_05B6B0:
	LDA.w $7722,x
	CMP.w $0FE9
	BEQ.b CODE_05B6DD
	LDA.b $78,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w $6000
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08D584>>16
	LDA.w #FXCODE_08D584
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
CODE_05B6DD:
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; YOSHI / END-TRANSFORMATION BLOCK (sprite $098).
; Raidenthequick: init_yoshi_block / main_yoshi_block / DATA_yoshi_block_ptr.
; The end-of-level Yoshi-shaped block: stops the morph transformation,
; restores normal Yoshi. Internal dispatch via DATA_yoshi_block_ptr.
;=========================================================================
YI_NorSpr098_EndTransformationBlock_Init:
init_yoshi_block:                           ; Raidenthequick: init_yoshi_block
;$05B6DE
	LDA.w $61F4
	BEQ.b CODE_05B6E8
	LDA.w $0C8A
	BNE.b CODE_05B6F3
CODE_05B6E8:
	LDY.b #$03
	STY.b $76,x
	LDA.w #$00FF
	STA.w $74A2,x
	RTL

CODE_05B6F3:
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1E6
	JSL.l CODE_spawn_ambient_stomp_puff_common
	JSL.l CODE_03AE60
	LDA.w $70E2,x
	STA.b $18,x
	DEC.w $7182,x
	LDA.w $7182,x
	STA.b $78,x
	STZ.w $7400,x
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STZ.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #(FXDATA_548000+$60C0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_548000+$60C0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
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
	RTL

;---------------------------------------------------------------------------

DATA_05B754:
DATA_yoshi_block_ptr:                            ; Raidenthequick: DATA_yoshi_block_ptr
	dw CODE_0580C2                          ; 00 = idle (RTS stub)
	dw CODE_05B7D1                          ; 02 = touched / dispense
	dw CODE_05B85A                          ; 04 = cleanup

YI_NorSpr098_EndTransformationBlock_Main:
main_yoshi_block:                           ; Raidenthequick: main_yoshi_block
;$05B75A
	JSL.l CODE_03AA52
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_05B76D
	JSL.l CODE_03B69D
CODE_05B76D:
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState18_SentTowardsBabyMario
	BEQ.b CODE_05B7B6
	TXY
	LDA.b $76,x
	CMP.w #$0003
	BNE.b CODE_05B793
	LDA.w $61F4
	BEQ.b CODE_05B7D0
	LDA.w $0C8A
	BEQ.b CODE_05B7D0
	LDA.w #$0002
	STA.w $74A2,x
	STZ.b $76,x
	JML.l CODE_05B6F3

CODE_05B793:
	ASL
	TAX
	JSR.w (DATA_yoshi_block_ptr,x)
	JSR.w CODE_05B88C
	BCS.b CODE_05B7B6
	LDA.w $7E16
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $0C8A
	BEQ.b CODE_05B7AE
	INC.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	INC.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
CODE_05B7AE:
	LDA.w #!Define_YI_SoundID20_SoaringEgg
	JSL.l CODE_push_sound_queue
	RTL

CODE_05B7B6:
	LDA.w $61F4
	BNE.b CODE_05B7D0
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1E6
	JSL.l CODE_spawn_ambient_stomp_puff_common
	JML.l CODE_03A31E

CODE_05B7D0:
	RTL

CODE_05B7D1:
	TYX
	LDY.w $7A36,x
	BNE.b CODE_05B7FB
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w $75E0,x
	BMI.b CODE_05B859
	LDA.b $18,x
	SEC
	SBC.w $70E2,x
	CLC
	ADC.w #$0004
	CMP.w #$0008
	BCS.b CODE_05B859
	LDA.b $18,x
	STA.w $70E2,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_05B81D

CODE_05B7FB:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	EOR.w $75E2,x
	BMI.b CODE_05B859
	LDA.b $78,x
	SEC
	SBC.w $7182,x
	CLC
	ADC.w #$0004
	CMP.w #$0008
	BCS.b CODE_05B859
	LDA.b $78,x
	STA.w $7182,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_05B81D:
	LDA.w $0C8A
	BNE.b CODE_05B825
	STZ.b $76,x
	RTS

CODE_05B825:
	LDA.w #$0020
	STA.w $7A98,x
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDA.w $70E2,x
	STA.w $70E2
	LDA.w $7182,x
	STA.w $7182
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	LDA.w #$0018
	STA.w $7542
	LDA.w #$0080
	STA.w $75E2
	LDY.b #$07
	STY.b $76
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	INC.b $76,x
CODE_05B859:
	RTS

CODE_05B85A:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_05B859
	LDA.w #!Define_YI_AmbSpr1D4
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7142,y
	LDA.w #$000B
	STA.w $7E4C,y
	LDA.w #$0006
	STA.w $7782,y
	PLA
	JML.l CODE_03A31E

; 2-entry signed bounce-velocity lookup. Consumer code (CODE_05B88C / collision
; helper) computes a signed delta into scratch byte $00 (index = 0 if the
; delta is negative, 2 if positive), then loads DATA_05B888,y to set
; XSpeedLo / YSpeedLo. Index 0 = $FC00 (negative push, -$0400); index 2 =
; $0400 (positive push, +$0400). Two reads -- one for X-bounce (line 7844),
; one for Y-bounce (line 7875) -- both index into the same table.
DATA_endtrans_bounce_velocity_by_sign:
DATA_05B888:
	dw $FC00,$0400

CODE_05B88C:
	LDY.b $76,x
	BEQ.b CODE_05B896
	JSL.l CODE_03D127
	SEC
CODE_05B895:
	RTS

CODE_05B896:
	STZ.w $7A36,x
	LDA.w #$0E00
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$1000
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w $6120
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w $6122
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_0B8578>>16
	LDA.w #FXCODE_0B8578
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611C
	STA.b $0C
	CLC
	ADC.w $603C
	CMP.w $6038
	BCS.b CODE_05B895
	LDA.w #$FFF0
	CLC
	ADC.w $6036
	SEC
	SBC.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	CLC
	ADC.w $7182,x
	SEC
	SBC.w $611E
	SEC
	SBC.w $6112
	STA.b $0E
	CLC
	ADC.w $603E
	CMP.w $603A
	BCS.b CODE_05B960
	LDA.w $603E
	SEC
	SBC.w #$0010
	STA.b $00
	LDA.b $0E
	BPL.b CODE_05B91D
	PHA
	LDA.b $00
	EOR.w #$FFFF
	INC
	STA.b $00
	PLA
	CMP.b $00
	BMI.b CODE_05B962
	BRA.b CODE_05B921

CODE_05B91D:
	CMP.b $00
	BPL.b CODE_05B962
CODE_05B921:
	LDA.w $60A8
	EOR.b $0C
	BMI.b CODE_05B960
	STZ.b $00
	LDA.w $603C
	LDY.b $0D
	BMI.b CODE_05B939
	INC.b $00
	INC.b $00
	EOR.w #$FFFF
	INC
CODE_05B939:
	CLC
	ADC.b $0C
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDY.b $00
	LDA.w DATA_05B888,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w $75E0,x
	LDA.w #$0040
	STA.w $7540,x
	STZ.w $60A8
	STZ.w $60B4
	BRA.b CODE_05B998

CODE_05B960:
	SEC
	RTS

CODE_05B962:
	STZ.b $00
	LDA.w $603E
	LDY.b $0F
	BMI.b CODE_05B973
	INC.b $00
	INC.b $00
	EOR.w #$FFFF
	INC
CODE_05B973:
	CLC
	ADC.b $0E
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDY.b $00
	LDA.w DATA_05B888,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w $75E2,x
	LDA.w #$0040
	STA.w $7542,x
	STZ.w $60AA
	INC.w $7A36,x
CODE_05B998:
	STZ.w $60D2
	INC.b $76,x
	CLC
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; EGGO-DIL family (sprites $0EE Body / $0EF Face / $0F0 Petal).
; Raidenthequick: init_eggo_dil / main_eggo_dil / init_eggo_dil_face /
;                 main_eggo_dil_face / init_eggo_dil_petal / main_eggo_dil_petal.
; The eyeball-flower enemy: body spawns child face + 8 petal sprites,
; petals orbit, body deactivates when face is eggsplodied.
;=========================================================================
YI_NorSpr0EE_EggoDilBody_Init:              ; friendly alias of YI_NorSpr0EE_EggoDil_Init (the invisible parent slot; visible enemy is the $0EF face child)
YI_NorSpr0EE_EggoDil_Init:
init_eggo_dil:                              ; Raidenthequick: init_eggo_dil
;$05B99F
	LDY.w $0EDF
	BEQ.b CODE_05B9A8
	JML.l CODE_03A31E

CODE_05B9A8:
	INC.w $0EDF
	LDY.b #$08
CODE_05B9AD:
	LDA.w $0EE1,y
	BMI.b CODE_05B9C3
	BEQ.b CODE_05B9BD
	PHY
	TAY
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	PLY
CODE_05B9BD:
	LDA.w #$FFFF
	STA.w $0EE1,y
CODE_05B9C3:
	DEY
	DEY
	BPL.b CODE_05B9AD
	RTL

;---------------------------------------------------------------------------

YI_NorSpr0EE_EggoDilBody_Main:              ; friendly alias of YI_NorSpr0EE_EggoDil_Main (the invisible parent slot; visible enemy is the $0EF face child)
YI_NorSpr0EE_EggoDil_Main:
main_eggo_dil:                              ; Raidenthequick: main_eggo_dil
;$05B9C8
	STZ.w $7400,x
	JSL.l CODE_03AF23
	LDA.b $18,x
	BNE.b CODE_05B9ED
	LDA.w #$00EF
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_05B9ED
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	STX.w $0EDD
	INC.b $18,x
CODE_05B9ED:
	RTL

;---------------------------------------------------------------------------

YI_NorSpr0EF_EggoDilFace_Init:
init_eggo_dil_face:                         ; Raidenthequick: init_eggo_dil_face
;$05B9EE
	JSR.w CODE_05BBD5
	RTL

;---------------------------------------------------------------------------

DATA_05B9F2:
DATA_eggo_dil_face_state_ptr:                    ; 5-entry $76,x sub-state dispatch (Eggo-Dil face)
	dw CODE_05BC14                              ;  0: idle / wait for trigger
	dw CODE_05BCBE                              ;  1: emerge
	dw CODE_05BCE8                              ;  2: hop / shake
	dw CODE_05BD3E                              ;  3: post-defeat
	dw CODE_05BD3E                              ;  4: post-defeat (shared)

YI_NorSpr0EF_EggoDilFace_Main:
main_eggo_dil_face:                         ; Raidenthequick: main_eggo_dil_face
;$05B9FC
	STZ.w $7400,x
	JSR.w CODE_05BA36
	JSR.w CODE_05BB09
	JSL.l CODE_03AF23
	LDY.w $0EDF
	BPL.b CODE_05BA1E
	LDX.w $0EDD
	JSL.l CODE_03A31E
	LDX.b $12
	STZ.w $0EDF
	JML.l CODE_03A31E

CODE_05BA1E:
	JSL.l CODE_03A2C7
	BCC.b CODE_05BA2A
	LDY.b #$FF
	STY.w $0EDF
	RTL

CODE_05BA2A:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_eggo_dil_face_state_ptr,x)
	JSR.w CODE_05BBD5
	RTL

CODE_05BA36:
	LDY.w $7722,x
	BPL.b CODE_05BA52
	REP.b #$10
	LDY.w $7362,x
	LDA.w #$8000
	STA.w $6000,y
	STA.w $6008,y
	STA.w $6010,y
	STA.w $6018,y
	SEP.b #$10
	RTS

CODE_05BA52:
	JSL.l CODE_03AA52
	LDA.w $7A38,x
	SEC
	SBC.w #$0080
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7A36,x
	PHA
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0004
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0B86FA>>16
	LDA.w #FXCODE_0B86FA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $00
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.b $04
	PLA
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$000A
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	REP.b #$10
	LDY.w $7362,x
	LDA.w $7CD6,x
	SEC
	SBC.b $00
	SEC
	SBC.w $6094
	STA.b $00
	SEC
	SBC.w #$0010
	STA.b $02
	LDA.w $7182,x
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $78,x
	SEC
	SBC.b $04
	SEC
	SBC.w $609C
	STA.b $04
	LDA.b $02
	STA.w $6000,y
	STA.w $6010,y
	LDA.b $00
	STA.w $6008,y
	STA.w $6018,y
	LDA.b $04
	STA.w $6012,y
	STA.w $601A,y
	SEC
	SBC.w #$0010
	STA.w $6002,y
	STA.w $600A,y
	LDY.w #$0000
	LDA.w $7A38,x
	CLC
	ADC.w #$0010
	AND.w #$01FE
	CMP.w #$0020
	BCC.b CODE_05BAFF
	INY
	CMP.w #$0110
	BPL.b CODE_05BAFF
	INY
CODE_05BAFF:
	SEP.b #$10
	TYA
	LDY.w $0EDD
	STA.w $7402,y
CODE_05BB08:
	RTS

CODE_05BB09:
	LDY.b $18,x
	BEQ.b CODE_05BB08
	LDA.w $61C6
	BEQ.b CODE_05BB75
	LDA.w $0EEB
	STA.b $00
	LDY.b #$08
CODE_05BB19:
	LDX.w $0EE1,y
	BMI.b CODE_05BB52
	LDA.b $00
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0200
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	PHY
	PHX
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	PLY
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0008
	STA.w $7540,x
CODE_05BB52:
	LDA.b $00
	CLC
	ADC.w #$0066
	AND.w #$01FE
	STA.b $00
	DEY
	DEY
	BPL.b CODE_05BB19
	LDX.b $12
	STZ.b $18,x
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w #$0008
	STA.b $16,x
	LDY.b #$04
	STY.b $76,x
	RTS

CODE_05BB75:
	LDA.w $7CD6,x
	SEC
	SBC.w #$0008
	STA.b $00
	LDA.b $78,x
	SEC
	SBC.w #$0008
	STA.b $02
	LDA.w $0EEB
	STA.b $06
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.b #$08
CODE_05BB93:
	LDX.w $0EE1,y
	BMI.b CODE_05BBC3
	LDA.b $06
	SEC
	SBC.w #$0080
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	PHX
	PHY
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLY
	PLX
	LDA.b $00
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $70E2,x
	LDA.b $02
	SEC
	SBC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $7182,x
CODE_05BBC3:
	LDA.b $06
	CLC
	ADC.w #$0066
	AND.w #$01FE
	STA.b $06
	DEY
	DEY
	BPL.b CODE_05BB93
	LDX.b $12
CODE_05BBD4:
	RTS

CODE_05BBD5:
	LDY.w $7722,x
	BMI.b CODE_05BBD4
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #FXDATA_550000+$0060
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$0060)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
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
CODE_05BC13:
	RTS

CODE_05BC14:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_05BC13
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_05BC2D
	LDY.b #$08
CODE_05BC21:
	LDA.w $0EE1,y
	BPL.b CODE_05BC13
	DEY
	DEY
	BPL.b CODE_05BC21
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_05BC2D:
	LDA.w $7722,x
	BPL.b CODE_05BC38
	JSL.l CODE_03AD74
	BCC.b CODE_05BC13
CODE_05BC38:
	LDA.w $7A36,x
	CLC
	ADC.w #$0010
	CMP.w #$00E0
	BPL.b CODE_05BC48
CODE_05BC44:
	STA.w $7A36,x
	RTS

CODE_05BC48:
	CMP.w #$0100
	BMI.b CODE_05BC5A
	LDA.w #$0100
	LDY.b $18,x
	BEQ.b CODE_05BC63
	STA.w $7A36,x
	INC.b $76,x
	RTS

CODE_05BC5A:
	LDY.b $18,x
	BEQ.b CODE_05BC63
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BRA.b CODE_05BC44

CODE_05BC63:
	STA.w $7A36,x
	LDA.w $7CD6,x
	SEC
	SBC.w #$0008
	STA.b $02
	LDA.b $78,x
	SEC
	SBC.w #$0008
	STA.b $04
	LDA.w #$0005
	STA.b $00
CODE_05BC7C:
	LDA.w #$00F0
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_05BCA2
	LDA.b $02
	STA.w $70E2,y
	LDA.b $04
	STA.w $7182,y
	TYA
	PHA
	LDA.b $00
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	TAY
	PLA
	STA.w $0EDF,y
	DEC.b $00
	BNE.b CODE_05BC7C
	BRA.b CODE_05BCB2

CODE_05BCA2:
	LDA.b $00
	BEQ.b CODE_05BCB2
	ASL
	TAY
	LDA.w #$FFFF
	STA.w $0EDF,y
	DEC.b $00
	BRA.b CODE_05BCA2

CODE_05BCB2:
	LDA.w #$0003
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $0EEB
	INC.b $18,x
	RTS

CODE_05BCBE:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC
	CMP.w #$0014
	BNE.b CODE_05BCE4
	LDA.b $10
	AND.w #$0003
	CLC
	ADC.w #$0005
	STA.b $16,x
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w #$0030
	STA.w $7A98,x
	INC.b $76,x
	LDA.w #$0010
CODE_05BCE4:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTS

CODE_05BCE8:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_05BD2F
	LDA.w $7A98,x
	BNE.b CODE_05BD0C
	LDA.w #$0020
	DEC.b $16,x
	BPL.b CODE_05BD06
	LDA.w #$0008
	STA.b $16,x
	STA.w $7A96,x
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	RTS

CODE_05BD06:
	BNE.b CODE_05BD09
	LSR
CODE_05BD09:
	STA.w $7A98,x
CODE_05BD0C:
	LDA.b $16,x
	AND.w #$0001
	ASL
	ASL
	ASL
	SEC
	SBC.w #$0004
	CLC
	ADC.w $7A38,x
	AND.w #$01FE
	STA.w $7A38,x
	LDA.w $0EEB
	CLC
	ADC.w #$0004
	AND.w #$01FE
	STA.w $0EEB
CODE_05BD2F:
	RTS

DATA_05BD30:
	dw $FFF0,$0010

DATA_05BD34:
	dw $0080,$00E0,$00A0,$00F0,$00C0

CODE_05BD3E:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_05BD2F
	LDA.b $16,x
	AND.w #$0002
CODE_05BD49:
	PHP
	TAY
	LDA.w DATA_05BD30,y
	CLC
	ADC.w $7A36,x
	LDY.b $16,x
	PLP
	BNE.b CODE_05BD5E
	CMP.w DATA_05BD34,y
	BPL.b CODE_05BD6C
	BRA.b CODE_05BD63

CODE_05BD5E:
	CMP.w DATA_05BD34,y
	BMI.b CODE_05BD6C
CODE_05BD63:
	DEC.b $16,x
	DEC.b $16,x
	BMI.b CODE_05BD70
	LDA.w DATA_05BD34,y
CODE_05BD6C:
	STA.w $7A36,x
	RTS

CODE_05BD70:
	LDA.w #!Define_YI_AmbSpr1E8
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7CD6,x
	SEC
	SBC.w #$0008
	STA.w $70A2,y
	LDA.b $78,x
	SEC
	SBC.w #$0008
	STA.w $7142,y
	LDA.w #$0003
	STA.w $73C2,y
	INC
	STA.w $7782,y
	LDY.b $76,x
	CPY.b #$04
	BEQ.b CODE_05BDEA
	LDA.w $0EEB
	STA.b $06
	LDA.w #$0200
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.b #$08
CODE_05BDA7:
	LDX.w $0EE1,y
	BMI.b CODE_05BDD9
	LDA.b $06
	SEC
	SBC.w #$0080
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	PHY
	PHX
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	PLY
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_05BDD9:
	LDA.b $06
	CLC
	ADC.w #$0066
	AND.w #$01FE
	STA.b $06
	DEY
	DEY
	BPL.b CODE_05BDA7
	LDX.b $12
CODE_05BDEA:
	LDA.w #$00C0
	STA.w $7A96,x
	STZ.w $7A36,x
	STZ.w $7A38,x
	STZ.b $18,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.b $76,x
	JSL.l CODE_03AEFD
	RTS

;---------------------------------------------------------------------------

YI_NorSpr0F0_EggoDilPetal_Init:
init_eggo_dil_petal:                        ; Raidenthequick: init_eggo_dil_petal
;$05BE02
	RTL

;---------------------------------------------------------------------------

YI_NorSpr0F0_EggoDilPetal_Main:
main_eggo_dil_petal:                        ; Raidenthequick: main_eggo_dil_petal
;$05BE03
	STZ.w $7400,x
	LDY.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CPY.b #$10
	BEQ.b CODE_05BE12
	JSR.w CODE_05BE5A
	BRA.b CODE_05BE24

CODE_05BE12:
	LDA.w $7D38,x
	BEQ.b CODE_05BE24
	JSL.l CODE_03A2C7
	BCC.b CODE_05BE24
	JSR.w CODE_05BE5A
	JML.l CODE_03A31E

CODE_05BE24:
	JSL.l CODE_03AF23
	LDY.w $0EDF
	BMI.b CODE_05BE3A
	JSL.l CODE_03A2C7
	BCC.b CODE_05BE4B
	JSR.w CODE_05BE5A
	JML.l CODE_03A31E

CODE_05BE3A:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ORA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_05BE4B
	JSR.w CODE_05BE5A
	LDA.w #$0040
	STA.w $7542,x
CODE_05BE4B:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_05BE55
	JML.l CODE_0DC0F0

CODE_05BE55:
	JSL.l CODE_03A5B7
	RTL

CODE_05BE5A:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_05BE68
	LDA.w #$FFFF
	STA.w $0EDF,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_05BE68:
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; FLAMER GUYS (sprites $0EC Jumping / $0ED Running).
; Raidenthequick: init_flamer_guy / main_flamer_guy.
; Fire-trail enemies; both variants share Init/Main, differing only in
; their jump/run mode parameter.
;=========================================================================
YI_NorSpr0EC_JumpingFlamerGuy_Init:
YI_NorSpr0ED_RunningFlamerGuy_Init:
init_flamer_guy:                            ; Raidenthequick: init_flamer_guy
;$05BE69
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w #$FFFF
	BNE.b CODE_05BE83
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_05BE83
	JSL.l CODE_03AD74
	BCS.b CODE_05BE89
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	RTL

CODE_05BE83:
	JSL.l CODE_03AE60
	INC.b $78,x
CODE_05BE89:
	LDA.w #$0100
	STA.w $7A36,x
	LDY.w $7400,x
	STY.b $79,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0005
	STA.w $74A2,x
	JSR.w CODE_05C16C
	RTL

;---------------------------------------------------------------------------

DATA_05BEA4:
DATA_flamer_guy_state_ptr:                       ; 7-entry $76,x sub-state dispatch (Flamer Guys $0EC/$0ED)
	dw CODE_05C1C4                              ;  0: idle / walk
	dw CODE_05C202                              ;  1: ignite charge
	dw CODE_05C233                              ;  2: flame-on (running/jumping)
	dw CODE_05C2D3                              ;  3: airborne (jump variant)
	dw CODE_05C3A9                              ;  4: lands, brief cooldown
	dw CODE_05C3DD                              ;  5: flame-out / recover
	dw CODE_05C450                              ;  6: revert-to-shyguy

YI_NorSpr0EC_JumpingFlamerGuy_Main:
YI_NorSpr0ED_RunningFlamerGuy_Main:
main_flamer_guy:                            ; Raidenthequick: main_flamer_guy
;$05BEB2
	LDA.w $7D96,x
	BEQ.b CODE_05BEDA
	JSR.w CODE_05BF99
	JSR.w CODE_05C06E
	LDA.w $7D96,x
	PHA
	TXY
	LDA.w #!Define_YI_NorSpr01E_Shyguy
	JSL.l CODE_spawn_sprite
	PLA
	STA.w $7D96,x
	LDA.w #$0022
	STA.w $7042,x
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JMP.w CODE_05BF69

CODE_05BEDA:
	LDY.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CPY.b #$08
	BNE.b CODE_05BF00
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0100
	STA.w $7A36,x
	LDY.w $74A2,x
	BMI.b CODE_05BF69
CODE_05BEF5:
	JSR.w CODE_05BF99
	JSR.w CODE_05C06E
	JSR.w CODE_05C16C
	BRA.b CODE_05BF69

CODE_05BF00:
	CPY.b #$10
	BNE.b CODE_05BEF5
	LDY.w $7D38,x
	BEQ.b CODE_05BF63
	LDA.w #$0011
	STA.w $7402,x
	LDA.b $79,x
	AND.w #$00FF
	CMP.w $7400,x
	PHP
	BEQ.b CODE_05BF2C
	LDY.w $7400,x
	STY.b $79,x
	LDA.w $7A38,x
	EOR.w #$FFFF
	INC
	AND.w #$01FE
	STA.w $7A38,x
CODE_05BF2C:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_05BF4F
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCS.b CODE_05BF4F
	LDA.w $7A36,x
	SEC
	SBC.w #$0020
	CMP.w #$0060
	BPL.b CODE_05BF4C
	LDA.w #$0060
CODE_05BF4C:
	STA.w $7A36,x
CODE_05BF4F:
	JSR.w CODE_05BF99
	JSR.w CODE_05C06E
	JSR.w CODE_05C16C
	PLP
	BNE.b CODE_05BF69
	LDA.w #$0005
	STA.w $74A2,x
	BRA.b CODE_05BF69

CODE_05BF63:
	JSR.w CODE_05BF99
	JSR.w CODE_05C06E
CODE_05BF69:
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_flamer_guy_state_ptr,x)
	JSR.w CODE_05C16C
	LDA.b $79,x
	AND.w #$00FF
	CMP.w $7400,x
	BEQ.b CODE_05BF8F
	LDA.w $7A38,x
	EOR.w #$FFFF
	INC
	AND.w #$01FE
	STA.w $7A38,x
CODE_05BF8F:
	LDY.w $7400,x
	STY.b $79,x
	JSL.l CODE_03A5B7
	RTL

CODE_05BF99:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0EC_JumpingFlamerGuy
	BEQ.b CODE_05BFA4
	JMP.w CODE_05C014

CODE_05BFA4:
	LDY.b $76,x
	CPY.b #$00
	BEQ.b CODE_05BFD2
	LDA.w $7A36,x
	LDY.b $78,x
	BEQ.b CODE_05BFC1
	CMP.w #$00A0
	BPL.b CODE_05BFBB
	LDA.w #$00A0
	BRA.b CODE_05BFCF

CODE_05BFBB:
	SEC
	SBC.w #$0010
	BRA.b CODE_05BFCF

CODE_05BFC1:
	CMP.w #$0100
	BMI.b CODE_05BFCB
	LDA.w #$0100
	BRA.b CODE_05BFCF

CODE_05BFCB:
	CLC
	ADC.w #$0008
CODE_05BFCF:
	STA.w $7A36,x
CODE_05BFD2:
	LDY.b $78,x
	BNE.b CODE_05C013
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	LDY.w $7400,x
	BEQ.b CODE_05BFEA
	EOR.w #$FFFF
	INC
CODE_05BFEA:
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	EOR.w #$FFFF
	INC
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	AND.w #$01FE
	STA.w $7A38,x
CODE_05C013:
	RTS

CODE_05C014:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.w $7400,x
	BEQ.b CODE_05C020
	EOR.w #$FFFF
	INC
CODE_05C020:
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	AND.w #$01FE
	SEC
	SBC.w $7A38,x
	PHP
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCS.b CODE_05C042
	PLP
	BPL.b CODE_05C04E
	BRA.b CODE_05C045

CODE_05C042:
	PLP
	BMI.b CODE_05C04E
CODE_05C045:
	LDA.w $7A38,x
	SEC
	SBC.w #$0010
	BRA.b CODE_05C055

CODE_05C04E:
	LDA.w $7A38,x
	CLC
	ADC.w #$0010
CODE_05C055:
	AND.w #$01FE
	STA.w $7A38,x
CODE_05C05B:
	RTS

DATA_05C05C:
	db $0C,$0C,$0C,$0C,$0D,$0D,$0C,$0B,$0A,$0B,$0C,$0D,$10,$10,$10,$10
	db $10,$08

CODE_05C06E:
	LDY.w $74A2,x
	BMI.b CODE_05C05B
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0018
	TAY
	PHY
	JSL.l CODE_03AA60
	LDA.w $7AF8,x
	BNE.b CODE_05C096
	LDA.w #$0004
	STA.w $7AF8,x
	LDA.b $19,x
	INC
	AND.w #$0003
	TAY
	STY.b $19,x
CODE_05C096:
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7A38,x
	SEC
	SBC.w #$0080
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_0B86FA>>16
	LDA.w #FXCODE_0B86FA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDY.b $79,x
	BNE.b CODE_05C0CB
	EOR.w #$FFFF
	INC
CODE_05C0CB:
	CLC
	ADC.w $7CD6,x
	SEC
	SBC.w $6094
	STA.b $02
	SEC
	SBC.w #$0010
	STA.b $00
	LDY.w $7402,x
	LDA.w DATA_05C05C,y
	AND.w #$00FF
	STA.b $04
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	SEC
	SBC.b $04
	SEC
	SBC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEC
	SBC.w $609C
	STA.b $04
	REP.b #$10
	PLY
	LDA.b $79,x
	AND.w #$00FF
	BEQ.b CODE_05C10E
	LDA.b $00
	PHA
	LDA.b $02
	STA.b $00
	PLA
	STA.b $02
CODE_05C10E:
	LDA.b $19,x
	AND.w #$0002
	BEQ.b CODE_05C143
	LDA.b $00
	PHA
	LDA.b $02
	STA.b $00
	PLA
	STA.b $02
	LDA.w $6004,y
	EOR.w #$4000
	STA.w $6004,y
	LDA.w $600C,y
	EOR.w #$4000
	STA.w $600C,y
	LDA.w $6014,y
	EOR.w #$4000
	STA.w $6014,y
	LDA.w $601C,y
	EOR.w #$4000
	STA.w $601C,y
CODE_05C143:
	LDA.b $00
	STA.w $6000,y
	STA.w $6010,y
	LDA.b $02
	STA.w $6008,y
	STA.w $6018,y
	LDA.b $04
	STA.w $6012,y
	STA.w $601A,y
	SEC
	SBC.w #$0010
	STA.w $6002,y
	STA.w $600A,y
	SEP.b #$10
	RTS

DATA_05C168:
	dw FXDATA_550000+$4040,FXDATA_550000+$6040

CODE_05C16C:
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $19,x
	AND.w #$0002
	TAY
	LDA.w $7A38,x
	CPY.b #$00
	BEQ.b CODE_05C18C
	EOR.w #$FFFF
	INC
	AND.w #$01FE
CODE_05C18C:
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $19,x
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_05C168,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$4040)>>16
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

CODE_05C1C4:
	TYX
	LDA.w $7A36,x
	CMP.w #$0100
	BMI.b CODE_05C1F6
	LDY.b #$04
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0EC_JumpingFlamerGuy
	BNE.b CODE_05C1EF
	LDY.b #$00
	STY.b $78,x
	LDA.w #$0140
	STA.w $7A38,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.b #$02
CODE_05C1EF:
	STY.b $76,x
	LDA.w #$0100
	BRA.b CODE_05C1FA

CODE_05C1F6:
	CLC
	ADC.w #$0010
CODE_05C1FA:
	STA.w $7A36,x
	RTS

DATA_05C1FE:
	dw $FE00,$0200

CODE_05C202:
	TYX
	LDA.b $18,x
	AND.w #$0003
	BEQ.b CODE_05C21D
	AND.w #$0001
	BEQ.b CODE_05C214
	LDA.w #$FC00
	BRA.b CODE_05C220

CODE_05C214:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	BRA.b CODE_05C220

CODE_05C21D:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_05C220:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.w $7400,x
	LDA.w DATA_05C1FE,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b #$00
	STY.b $78,x
	INC.b $76,x
	RTS

CODE_05C233:
	TYX
	LDY.w $7402,x
	CPY.b #$11
	BNE.b CODE_05C24C
	LDA.b $18,x
	BIT.w #$000C
	BEQ.b CODE_05C24C
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7182,x
CODE_05C24C:
	LDY.w $7860,x
	STY.b $18,x
	TYA
	AND.w #$000F
	BEQ.b CODE_05C29F
	AND.w #$000C
	BEQ.b CODE_05C271
	LDY.w $7402,x
	CPY.b #$0C
	BMI.b CODE_05C271
	CPY.b #$11
	BPL.b CODE_05C271
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w $7182,x
CODE_05C271:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
	INC.b $78,x
	LDA.w #$0011
	STA.w $7402,x
	INC.b $76,x
	RTS

CODE_05C29F:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	PHP
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_05C2B2
	PLP
	LDA.w #$000E
	BRA.b CODE_05C2CF

CODE_05C2B2:
	CLC
	ADC.w #$01C0
	CMP.w #$0400
	BCS.b CODE_05C2C6
	LDA.w #$000F
	PLP
	BPL.b CODE_05C2CF
	LDA.w #$000D
	BRA.b CODE_05C2CF

CODE_05C2C6:
	LDA.w #$0010
	PLP
	BPL.b CODE_05C2CF
	LDA.w #$000C
CODE_05C2CF:
	STA.w $7402,x
	RTS

CODE_05C2D3:
	TYX
	LDA.w $7A36,x
	CMP.w #$0090
	BNE.b CODE_05C2E6
	LDA.w #$0040
	STA.w $7542,x
	LDY.b #$01
	STY.b $76,x
CODE_05C2E6:
	JSR.w CODE_05C312
	RTS

DATA_05C2EA:
	dw $0080,$0100,$0180,$0200,$FF80,$FF00,$FE80,$FE00

DATA_05C2FA:
	dw $0008,$0000

DATA_05C2FE:
	dw $FFFF,$FFFF,$0008,$0000

DATA_05C306:
	dw $0008,$FFF8

DATA_05C30A:
	dw $0000,$0000,$0008,$FFF8

CODE_05C312:
	LDA.w #!Define_YI_AmbSpr1D6
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0003
	STA.w $7E4C,y
	ASL
	STA.w $7782,y
	LDA.w #$0022
	STA.w $7002,y
	PHY
	LDA.b $18,x
	BIT.w #$000C
	BNE.b CODE_05C33A
	AND.w #$0002
	CLC
	ADC.w #$0004
	BRA.b CODE_05C341

CODE_05C33A:
	AND.w #$0004
	EOR.w #$0004
	LSR
CODE_05C341:
	TAY
	LDA.w DATA_05C306,y
	STA.b $08
	LDA.w DATA_05C30A,y
	STA.b $0A
	LDA.w DATA_05C2FA,y
	BPL.b CODE_05C35B
	LDA.b $10
	AND.w #$0008
	BEQ.b CODE_05C35B
	LDA.w #$0008
CODE_05C35B:
	STA.b $04
	LDA.w DATA_05C2FE,y
	BPL.b CODE_05C36C
	LDA.b $10
	AND.w #$0020
	BEQ.b CODE_05C36C
	LDA.w #$0008
CODE_05C36C:
	STA.b $06
	LDA.b $10
	PHA
	AND.w #$0006
	CLC
	ADC.b $04
	TAY
	LDA.w DATA_05C2EA,y
	STA.b $00
	PLA
	XBA
	AND.w #$0006
	CLC
	ADC.b $06
	TAY
	LDA.w DATA_05C2EA,y
	PLY
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w $70E2,x
	CLC
	ADC.b $08
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.b $0A
	STA.w $7142,y
	RTS

DATA_05C3A5:
	dw $FE00,$0200

CODE_05C3A9:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_05C3C7
	LDY.w $7400,x
	LDA.w DATA_05C3A5,y
	STA.w $75E0,x
	LDA.w #$0030
	STA.w $7AF6,x
	LDA.w #$0004
	STA.w $7402,x
	INC.b $76,x
	RTS

CODE_05C3C7:
	LDA.w $7A98,x
	BNE.b CODE_05C3DC
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w $7402,x
	INC
	AND.w #$0003
	STA.w $7402,x
CODE_05C3DC:
	RTS

CODE_05C3DD:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_05C3F6
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_05C3FA
	STZ.w $7540,x
	LDA.w #$0010
	STA.w $7402,x
	INC.b $76,x
CODE_05C3F6:
	INC.w $7AF6,x
	RTS

CODE_05C3FA:
	LDA.w #$0010
	STA.w $7540,x
	LDA.w $7AF6,x
	BNE.b CODE_05C426
	STZ.w $75E0,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_05C426
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w #$0060
	STA.w $7A96,x
	STZ.w $7402,x
	DEC.b $76,x
	RTS

CODE_05C426:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_05C42F
	EOR.w #$FFFF
	INC
CODE_05C42F:
	CLC
	ADC.b $16,x
	CMP.w #$0400
	BMI.b CODE_05C44D
	PHA
	LDA.w $7402,x
	SEC
	SBC.w #$0003
	AND.w #$0007
	CLC
	ADC.w #$0004
	STA.w $7402,x
	PLA
	AND.w #$03FF
CODE_05C44D:
	STA.b $16,x
	RTS

CODE_05C450:
	TYX
	INC.w $7AF6,x
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05C46A
	LDA.w #$0010
	STA.w $7A96,x
	LDA.w #$000E
	STA.w $7402,x
	DEC.b $76,x
CODE_05C46A:
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; BUCKET family (sprites $021 plain / $122 with Bandit / $123 with Coins).
; Raidenthequick: init_bucket / DATA_bucket_obj_state_ptr / main_bucket_obj /
;                 bucket_state_ptr / main_bucket.
;
; Two-stage state machine: while carried by a Bandit, runs bucket_obj
; state ptr ($05C4A3 -> 4 states); after release, switches to bucket
; state ptr ($05C8AE -> 4 states) for the contents-spill animation.
;=========================================================================
YI_NorSpr021_Bucket_Init:
YI_NorSpr122_BucketWithBandit_Init:
YI_NorSpr123_BucketWithCoins_Init:
init_bucket:                                ; Raidenthequick: init_bucket
;$05C46B
	JSL.l CODE_03AE60
	LDA.w #$0100
	STA.w $7A36,x
	LDA.w $70E2,x
	CLC
	ADC.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $7182,x
	SEC
	SBC.w #$0006
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.w $7400,x
	JSR.w CODE_05C59F
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr021_Bucket
	BNE.b CODE_05C4A2
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	STA.b $16,x
CODE_05C4A2:
	RTL

;---------------------------------------------------------------------------

DATA_05C4A3:
DATA_bucket_obj_state_ptr:                       ; 5-entry $76,x sub-state dispatch (bucket-with-bandit/coins)
	dw CODE_05C5EB                              ;  0: idle (hangs in air)
	dw CODE_05C6B1                              ;  1: knocked, swing
	dw CODE_05C70D                              ;  2: tip / dispense contents
	dw CODE_05C766                              ;  3: empty rocking
	dw CODE_05C79E                              ;  4: settle / despawn

YI_NorSpr122_BucketWithBandit_Main:
YI_NorSpr123_BucketWithCoins_Main:
main_bucket_obj:                            ; Raidenthequick: main_bucket_obj
;$05C4AD
	JSR.w CODE_05C4D5
	JSL.l CODE_03AF23
	JSL.l CODE_03A2C7
	BCC.b CODE_05C4C6
	LDY.b $18,x
	BEQ.b CODE_05C4C2
	JML.l CODE_despawn_sprite_free_slot

CODE_05C4C2:
	JML.l CODE_03A31E

CODE_05C4C6:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_bucket_obj_state_ptr,x)
	JSR.w CODE_05C571
	JSR.w CODE_05C591
	RTL

CODE_05C4D5:
	JSL.l CODE_03AA52
	LDA.w $7A39,x
	AND.w #$00FF
	ASL
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$000A
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	REP.b #$10
	LDY.w $7362,x
	LDA.w $7542,x
	BNE.b CODE_05C552
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$FFFC
	SEC
	SBC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $6094
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w #$FFFC
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $7182,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $609C
	STA.b $02
	LDA.b $00
	STA.w $6008,y
	STA.w $6018,y
	SEC
	SBC.w #$0010
	STA.w $6000,y
	STA.w $6010,y
	LDA.b $02
	STA.w $6012,y
	STA.w $601A,y
	SEC
	SBC.w #$0010
	STA.w $6002,y
	STA.w $600A,y
CODE_05C552:
	LDA.w $7362,x
	CLC
	ADC.w #$0020
	TAY
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.w $6094
	STA.w $6000,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEC
	SBC.w $609C
	STA.w $6002,y
	SEP.b #$10
	RTS

CODE_05C571:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_05C590
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05C590
	LDA.w $7D38,y
	BEQ.b CODE_05C590
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDA.w #!Define_YI_SoundID2E_ClankSound7
	JSL.l CODE_push_sound_queue
CODE_05C590:
	RTS

CODE_05C591:
	LDA.w $7722,x
	BMI.b CODE_05C5E2
	LDA.w $7A38,x
	CMP.b $78,x
	BEQ.b CODE_05C5E2
	STA.b $78,x
CODE_05C59F:
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0200
	SEC
	SBC.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $7A39,x
	TYA
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #(FXDATA_550000+$20C0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_550000+$20C0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
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
CODE_05C5E2:
	RTS

DATA_05C5E3:
DATA_bucket_dispense_ptr:                        ; 2-entry per-variant dispense routine
	dw CODE_05C7D4                              ;  $122 BucketWithBandit -- spawn bandit child
	dw CODE_05C7F9                              ;  $123 BucketWithCoins -- shower coins

DATA_05C5E7:
	dw $0020,$0115

CODE_05C5EB:
	TYX
	LDY.w $7D36,x
	DEY
	BMI.b CODE_05C5E2
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05C5E2
	LDA.w $7D38,y
	BEQ.b CODE_05C5E2
	LDA.w $7CD6,y
	SEC
	SBC.w $7CD6,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7CD8,y
	SEC
	SBC.w $7CD8,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w $7D36,x
	DEY
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CMP.w #$0100
	BMI.b CODE_05C633
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	EOR.w #$FFFF
	INC
	BRA.b CODE_05C6A6

CODE_05C633:
	SEC
	SBC.w #$0070
	CMP.w #$0020
	BCS.b CODE_05C682
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BMI.b CODE_05C654
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BPL.b CODE_05C654
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.b #$04
	STY.b $76,x
	RTS

CODE_05C654:
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	LDY.b #$FF
	STY.b $16,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr122_BucketWithBandit
	ASL
	TAY
	STY.b $00
	LDA.w DATA_05C5E7,y
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_05C67F
	STY.b $16,x
	LDX.b $00
	JSR.w (DATA_bucket_dispense_ptr,x)
CODE_05C67F:
	INC.b $76,x
	RTS

CODE_05C682:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BMI.b CODE_05C6A3
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BPL.b CODE_05C6A3
	LDA.w $7542,y
	BNE.b CODE_05C6A3
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	PHP
	LDA.w #$0800
	PLP
	BPL.b CODE_05C6A6
	LDA.w #$F800
	BRA.b CODE_05C6A6

CODE_05C6A3:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
CODE_05C6A6:
	STA.b $16,x
	LDY.b #$02
	STY.b $76,x
	RTS

DATA_05C6AD:
	dw $FFF8,$0000

CODE_05C6B1:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w #$0006
	CMP.w $7182,x
	BPL.b CODE_05C6C7
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
CODE_05C6C7:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr122_BucketWithBandit
	ASL
	TAY
	STY.b $02
	LDA.w DATA_05C6AD,y
	STA.b $00
	LDY.b $16,x
	BMI.b CODE_05C6FA
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0002
	BEQ.b CODE_05C6FC
	CMP.w #$0010
	BNE.b CODE_05C6FA
	LDA.w $7182,y
	CLC
	ADC.b $00
	CMP.w $7182,x
	BMI.b CODE_05C6FC
	TYX
	JSL.l CODE_03A31E
	LDX.b $12
CODE_05C6FA:
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	LDA.w $7542,x
	ORA.w $7222,x
	BNE.b CODE_05C6FC
endif
	STZ.b $76,x
CODE_05C6FC:
	RTS

; DATA_question_bucket_rotation_offsets -- SMWC: '?' bucket rotation effect table (8 word entries).
DATA_05C6FD:
DATA_question_bucket_rotation_offsets:
	dw $0020,$0040,$FFC0,$FFE0,$0040,$0040,$FFC0,$FFC0

CODE_05C70D:
	TYX
	LDA.w $7A38,x
	CLC
	ADC.b $16,x
	STA.w $7A38,x
	SEC
	SBC.w #$7C00
	CMP.w #$0800
	BCS.b CODE_05C729
	LDA.w #$0010
	STA.w $7A96,x
	INC.b $76,x
	RTS

CODE_05C729:
	LDY.b #$00
CODE_05C72B:
	LDA.w $7A38,x
	BMI.b CODE_05C736
	TYA
	CLC
	ADC.w #$0004
	TAY
CODE_05C736:
	LDA.b $16,x
	BPL.b CODE_05C73C
	INY
	INY
CODE_05C73C:
	CLC
	ADC.w DATA_question_bucket_rotation_offsets,y
	STA.b $00
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_05C75D
	LDA.w $7A38,x
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCS.b CODE_05C75D
	STZ.w $7A38,x
	STZ.b $76,x
	RTS

CODE_05C75D:
	LDA.b $00
	STA.b $16,x
	RTS

DATA_05C762:
DATA_bucket_empty_state_ptr:                     ; 2-entry per-variant empty-rocking handler
	dw CODE_05C82A                              ;  $122 BucketWithBandit empty
	dw CODE_05C85F                              ;  $123 BucketWithCoins empty

CODE_05C766:
	TYX
	LDY.b #$08
	LDA.w $7A38,x
	CLC
	ADC.b $16,x
	STA.w $7A38,x
	SEC
	SBC.w #$7C00
	CMP.w #$0800
	BCS.b CODE_05C72B
	LDA.w $7A96,x
	BNE.b CODE_05C729
	LDA.w #$8000
	STA.w $7A38,x
	TXY
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr122_BucketWithBandit
	ASL
	TAX
	JSR.w (DATA_bucket_empty_state_ptr,x)
	LDA.w #$0030
	STA.w $7A96,x
	STA.b $18,x
	INC.b $76,x
	RTS

CODE_05C79E:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_05C7D3
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$8000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $6FA2,x
	AND.w #$001F
	BEQ.b CODE_05C7D3
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05C7D3
	LDA.w #$2000
	STA.w $6FA2,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID2F_ClankSound8
	JSL.l CODE_push_sound_queue
CODE_05C7D3:
	RTS

CODE_05C7D4:
	LDX.b $12
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0004
	STA.w $7182,y
	LDA.w #$000C
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #$0017
	STA.w $7402,y
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	RTS

CODE_05C7F9:
	LDX.b $12
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0004
	STA.w $7182,y
	LDA.w #$FE80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FFFF
	STA.w $7A96,y
	STA.w $7A98,y
	STA.w $7AF6,y
	LDA.w #$0007
	STA.w $74A2,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	RTS

CODE_05C82A:
	TYX
	LDA.w #$0020
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_05C84A
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7182,y
	LDA.w #$0017
	STA.w $7402,y
CODE_05C84A:
	RTS

DATA_05C84B:
	dw $0004,$0000,$FFFC,$FFFF,$0002

DATA_05C855:
	dw $FFFC,$0004,$0002,$FFFE,$FFF8

CODE_05C85F:
	TYX
	LDY.b #$08
CODE_05C862:
	PHY
	LDA.w DATA_05C84B,y
	STA.b $00
	LDA.w DATA_05C855,y
	STA.b $02
	LDA.w #$0115
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_05C8AC
	LDA.w $70E2,x
	CLC
	ADC.b $00
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.b $02
	STA.w $7182,y
	LDA.w #$FFFF
	STA.w $7A96,y
	STA.w $7A98,y
	STA.w $7AF6,y
	LDA.w #$0007
	STA.w $74A2,y
	LDA.w #$0400
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	PLY
	DEY
	DEY
	BPL.b CODE_05C862
	PHY
CODE_05C8AC:
	PLY
	RTS

;---------------------------------------------------------------------------

DATA_05C8AE:
DATA_bucket_main_state_ptr:                      ; 4-entry $76,x sub-state dispatch (Bucket $021)
	dw CODE_05C8F6                              ;  0: idle (slot-machine display)
	dw CODE_05C922                              ;  1: rolling animation
	dw CODE_05C958                              ;  2: stopped, award contents
	dw CODE_0580C2                              ;  3: GSU delta-facing (shared stub)

YI_NorSpr021_Bucket_Main:
main_bucket:                                ; Raidenthequick: main_bucket
;$05C8B6
	JSR.w CODE_05C4D5
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_bucket_main_state_ptr,x)
	JSR.w CODE_05C571
	JSR.w CODE_05C591
	LDY.b $76,x
	CPY.b #$02
	BMI.b CODE_05C8F5
	LDA.w $7C16,x
	CLC
	ADC.w #$0014
	CMP.w #$0028
	BCS.b CODE_05C8F5
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w #$000C
	BPL.b CODE_05C8F5
	CMP.w #$FFE4
	BMI.b CODE_05C8F5
	LDA.w #$0010
	STA.w $0CCA
CODE_05C8F5:
	RTL

CODE_05C8F6:
	TYX
	LDY.w $7D36,x
	DEY
	BMI.b CODE_05C921
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05C921
	LDA.w $7D38,y
	BEQ.b CODE_05C921
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$8000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	INC.b $76,x
CODE_05C921:
	RTS

CODE_05C922:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05C943
	LDA.w #$4000
	STA.w $6FA2,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.b #$03
	STY.b $76,x
	LDA.w #!Define_YI_SoundID2F_ClankSound8
	JSL.l CODE_push_sound_queue
	RTS

CODE_05C943:
	LDY.w $7862,x
	BEQ.b CODE_05C953
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LSR
	LSR
	LSR
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
CODE_05C953:
	RTS

DATA_05C954:
	dw $0200,$FF80

CODE_05C958:
	TYX
	LDY.b #$02
	LDA.w $7862,x
	AND.w #$00FF
	BNE.b CODE_05C965
	DEY
	DEY
CODE_05C965:
	LDA.w DATA_05C954,y
	STA.w $75E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_05C974
	EOR.w #$FFFF
	INC
CODE_05C974:
	CLC
	ADC.w #$0080
	AND.w #$FF00
	XBA
	ASL
	ASL
	ASL
	ASL
	CLC
	ADC.w #$0010
	STA.w $7542,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $7862,x
	REP.b #$20
	JSR.w CODE_05C9A4
	RTS

;---------------------------------------------------------------------------

DATA_05C994:
	dw $FFF0,$0010

DATA_05C998:
	dw $0080,$FF80

DATA_05C99C:
	dw $000C,$0002

DATA_05C9A0:
	dw $0008,$FFFE

CODE_05C9A4:
	LDY.b $16,x
	LDA.w DATA_05C99C,y
	STA.w $7720,x
	LDY.w $60AB
	BMI.b CODE_05C9B6
	LDY.w $0D94
	BEQ.b CODE_05C9C4
CODE_05C9B6:
	CPX.w $61B6
	BNE.b CODE_05C9C1
	STZ.w $61B6
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
CODE_05C9C1:
	JMP.w CODE_05CA90

CODE_05C9C4:
	CPX.w $61B6
	BNE.b CODE_05C9DD
	LDA.w $7C16,x
	SEC
	SBC.w $72C0,x
	STA.w $7C16,x
	LDA.w $7C18,x
	SEC
	SBC.w $72C2,x
	STA.w $7C18,x
CODE_05C9DD:
	LDA.w $7C16,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_05C9B6
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	CLC
	ADC.w #$0008
	BPL.b CODE_05C9B6
	CMP.w #$FFF8
	BMI.b CODE_05C9B6
	STA.b $00
	LDY.w $61B6
	BNE.b CODE_05CA10
	LDA.w $7C16,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STX.w $61B6
	LDY.b #!Define_YI_PlayerState02_InCutscene
	STY.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
CODE_05CA10:
	CPX.w $61B6
	BNE.b CODE_05C9C1
	LDY.b $16,x
	LDA.w DATA_05C9A0,y
	STA.w $7720,x
	LDA.w $6086
	ORA.w $6088
	ORA.w #$0C00
	AND.w $0035
	STA.w $617A
	LDA.w $0037
	AND.w #$FCFF
	STA.w $617C
	LDA.b $00
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC
	SEC
	ADC.w $72C2,x
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC.w $61B4
	LDA.w #$0010
	CMP.w $61D6
	BMI.b CODE_05CA51
	STA.w $61D6
CODE_05CA51:
	STZ.w $60A8
	STZ.w $60B4
	STZ.w $60AA
	STZ.w !EXRAM_YI_Player_SubXPosLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Player_SubYPosLo|!EXRAMBankMirror
	STZ.w $60D4
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w #$FFFD
	BEQ.b CODE_05CA75
	BPL.b CODE_05CA72
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BRA.b CODE_05CA75

CODE_05CA72:
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_05CA75:
	LDA.w $7C16,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDY.w $6150
	BNE.b CODE_05CA90
	LDA.w $0036
	AND.w #$0003
	BNE.b CODE_05CAC6
CODE_05CA90:
	LDA.w $7A38,x
	BEQ.b CODE_05CAB2
	BPL.b CODE_05CA9D
	CLC
	ADC.w #$0080
	BRA.b CODE_05CAA1

CODE_05CA9D:
	SEC
	SBC.w #$0080
CODE_05CAA1:
	STA.w $7A38,x
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCS.b CODE_05CAB2
	STZ.w $7A38,x
	STZ.b $18,x
CODE_05CAB2:
	STZ.w $75E0,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC
	INC
	CMP.w #$0004
	BCS.b CODE_05CAC5
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
CODE_05CAC5:
	RTS

CODE_05CAC6:
	AND.w #$0002
	STA.w $60C4
	TAY
	LDA.w DATA_05C998,y
	STA.w $75E0,x
	LDA.w #$0002
	STA.w $7540,x
	LDA.b $18,x
	CLC
	ADC.w DATA_05C994,y
	CMP.w #$0100
	BMI.b CODE_05CAE7
	LDA.w #$0100
CODE_05CAE7:
	CMP.w #$FF00
	BPL.b CODE_05CAEF
	LDA.w #$FF00
CODE_05CAEF:
	STA.b $18,x
	LDA.w $7A38,x
	CLC
	ADC.b $18,x
	CMP.w #$1000
	BMI.b CODE_05CAFF
	LDA.w #$1000
CODE_05CAFF:
	CMP.w #$F000
	BPL.b CODE_05CB07
	LDA.w #$F000
CODE_05CB07:
	STA.w $7A38,x
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; DR. FREEZEGOOD (sprite $01C).
; Raidenthequick: init_freezegood / DATA_freezegood_state_ptr / main_freezegood.
; Ice-shooter enemy: throws ice projectile that freezes Yoshi in place.
; State machine dispatch lives at DATA_freezegood_state_ptr ($05CB5E).
;=========================================================================
YI_NorSpr01C_DrFreezegood_Init:
init_freezegood:                            ; Raidenthequick: init_freezegood
;$05CB0B
	LDY.b $77,x
	BEQ.b CODE_05CB25
	JSL.l CODE_03AD74
	BCS.b CODE_05CB21
	LDY.b $77,x
	LDA.w #$0000
	STA.w $7A38,y
	JML.l CODE_03A31E

CODE_05CB21:
	JSR.w CODE_05CC2E
	RTL

CODE_05CB25:
	JSL.l CODE_03AE60
	JSR.w CODE_05CC2E
	LDA.w $70E2,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $04
	LDA.w $7182,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSL.l CODE_03D400
	BNE.b CODE_05CB59
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
	STA.b $18,x
	REP.b #$20
CODE_05CB59:
	LDY.b #$02
	STY.b $76,x
	RTL

;---------------------------------------------------------------------------

DATA_05CB5E:
DATA_freezegood_state_ptr:                       ; 3-entry $76,x sub-state dispatch (Dr. Freezegood $01C)
	dw CODE_05D0A8                              ;  0: skis along ski-lift
	dw CODE_05D0C7                              ;  1: skis at ground
	dw CODE_05D0E4                              ;  2: hit / disabled

YI_NorSpr01C_DrFreezegood_Main:
main_freezegood:                            ; Raidenthequick: main_freezegood
;$05CB64
	JSL.l CODE_03AA52
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_05CB7A
	CMP.w #$0012
	BNE.b CODE_05CB77
	PLY
	PLA
CODE_05CB77:
	JSR.w CODE_05D152
CODE_05CB7A:
	JSL.l CODE_03AF23
	JSR.w CODE_05CB93
	JSR.w CODE_05CBBC
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_freezegood_state_ptr,x)
	JSR.w CODE_05CC1F
	JSR.w CODE_05CC68
	RTL

CODE_05CB93:
	LDA.w $7A36,x
	BIT.w #$FF00
	BEQ.b CODE_05CB9E
	ORA.w #$FF00
CODE_05CB9E:
	STA.b $00
	LDA.w $7A38,x
	SEC
	SBC.b $00
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CLC
	ADC.b $00
	AND.w #$01FE
	STA.w $7A36,x
CODE_05CBB7:
	RTS

DATA_05CBB8:
	dw $FD00,$0300

CODE_05CBBC:
	LDY.b $77,x
	BNE.b CODE_05CBB7
	LDY.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	BEQ.b CODE_05CBD0
	PHP
	LDY.b #$00
	PLP
	BPL.b CODE_05CBCD
	INY
	INY
CODE_05CBCD:
	LDA.w DATA_05CBB8,y
CODE_05CBD0:
	STA.w $75E0,x
	LDA.w #$0000
	LDY.b $19,x
	BNE.b CODE_05CC06
	LDA.w $7A38,x
	LDY.w $7400,x
	BEQ.b CODE_05CBE6
	EOR.w #$FFFF
	INC
CODE_05CBE6:
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BPL.b CODE_05CC06
	EOR.w #$FFFF
	INC
CODE_05CC06:
	CLC
	ADC.w #$0004
	STA.w $7540,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ASL
	BPL.b CODE_05CC17
	EOR.w #$FFFF
	INC
CODE_05CC17:
	XBA
	AND.w #$00FF
	STA.w $7720,x
	RTS

CODE_05CC1F:
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0003
	BNE.b CODE_05CC67
CODE_05CC2E:
	LDA.w #FXDATA_540000+$2041
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$2041)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A36,x
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
CODE_05CC67:
	RTS

CODE_05CC68:
	LDY.w $7D36,x
	BEQ.b CODE_05CC67
	BMI.b CODE_05CCA6
	SEP.b #$20
	LDA.b #$00
	STA.b $19,x
	REP.b #$20
	LDA.w $6EFF,y
	CMP.w #$0010
	BNE.b CODE_05CC67
	LDA.w $7D37,y
	BEQ.b CODE_05CC67
	LDA.w $7541,y
	STA.b $00
	TYX
	DEX
	JSL.l CODE_kill_sprite_by_hit_checked
	BCC.b CODE_05CC9C
	LDA.w $6FA0,x
	ORA.w #$0200
	STA.w $6FA0,x
	PLA
	RTL

CODE_05CC9C:
	LDA.b $00
	CMP.w #$0040
	BCS.b CODE_05CC67
	JMP.w CODE_05D152

CODE_05CCA6:
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_05CCD1
	LDY.b #$00
	STY.b $19,x
	LDY.w $60AB
	BMI.b CODE_05CD15
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	LDA.w #$FC00
	STA.w $60AA
	JMP.w CODE_05D152

CODE_05CCD1:
	LDA.w $7C16,x
	BPL.b CODE_05CCE0
	CLC
	ADC.w $6120
	CLC
	ADC.w $7BB6,x
	BRA.b CODE_05CCE8

CODE_05CCE0:
	SEC
	SBC.w $6120
	SEC
	SBC.w $7BB6,x
CODE_05CCE8:
	STA.b $06
	STZ.b $00
	LDY.b $19,x
	BEQ.b CODE_05CCF5
	JSR.w CODE_05CD55
	BRA.b CODE_05CCF9

CODE_05CCF5:
	JSL.l CODE_05CDF9
CODE_05CCF9:
	LDA.w $60FC
	AND.b $00
	BEQ.b CODE_05CD14
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $603E
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_05CD14:
	RTS

CODE_05CD15:
	LDA.w $60A8
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FE00
	LDY.w $77C2,x
	BEQ.b CODE_05CD36
	LDA.w #$0200
CODE_05CD36:
	STA.w $60A8
	STA.w $60B4
	LDA.w #$FC00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	RTS

DATA_05CD49:
	dw $0280,$FD80

DATA_05CD4D:
	dw $0002,$FFFE

DATA_05CD51:
	dw $0180,$0060

CODE_05CD55:
	LDA.b $78,x
	AND.w #$FF00
	STA.b $04
	LDA.w $0035
	BIT.b $04
	BEQ.b CODE_05CD68
	AND.w $6084
	BEQ.b CODE_05CD7F
CODE_05CD68:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.b $06
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $60A8
	STA.w $60B4
	LDY.b #$00
	STY.b $19,x
	RTS

CODE_05CD7F:
	LDA.b $05
	AND.w #$0002
	TAY
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.b $06
	CLC
	ADC.w DATA_05CD4D,y
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $7C16,x
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_05CD9F
	LDA.w DATA_05CD51,y
	STA.b $00
CODE_05CD9F:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_05CDAD
	SEC
	SBC.w $60A8
	EOR.w $7C16,x
	BPL.b CODE_05CDF5
CODE_05CDAD:
	LDA.w $60DE
	ORA.w $6150
	BNE.b CODE_05CDF8
	INC.w $61C2
	LDA.w $60A8
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.b $0E
	CLC
	ADC.w #$0280
	LDY.b #$00
	CMP.w #$0500
	BCC.b CODE_05CDF0
	BPL.b CODE_05CDEB
	INY
	INY
CODE_05CDEB:
	LDA.w DATA_05CD49,y
	STA.b $0E
CODE_05CDF0:
	LDA.b $0E
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_05CDF5:
	INC.w $60DC
CODE_05CDF8:
	RTS

CODE_05CDF9:
	LDY.w $60C0
	BEQ.b CODE_05CE01
	JMP.w CODE_05CE4B

CODE_05CE01:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_05CE0E
	LDA.w $60A8
	BNE.b CODE_05CE21
	JMP.w CODE_05CFF0

CODE_05CE0E:
	LDA.w $60A8
	BNE.b CODE_05CE1C
	LDA.w $7C16,x
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_05CE4B
CODE_05CE1B:
	RTL

CODE_05CE1C:
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_05CE2C
CODE_05CE21:
	LDA.w $7C16,x
	EOR.w $60A8
	BMI.b CODE_05CE1B
	JMP.w CODE_05CF16

CODE_05CE2C:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w $60A8
	EOR.w $60A8
	BPL.b CODE_05CE43
	LDA.w $7C16,x
	EOR.w $60A8
	BMI.b CODE_05CE21
	JMP.w CODE_05CF16

CODE_05CE43:
	LDA.w $7C16,x
	EOR.w $60A8
	BPL.b CODE_05CE21
CODE_05CE4B:
	LDA.w $0035
	AND.w #$0300
	BEQ.b CODE_05CE7A
	AND.w #$0200
	DEC
	EOR.w $7C16,x
	BPL.b CODE_05CE7A
	LDA.w $60A8
	BPL.b CODE_05CE65
	EOR.w #$FFFF
	INC
CODE_05CE65:
	AND.w #$FF00
	XBA
	INC
	LDY.w $77C2,x
	BEQ.b CODE_05CE73
	EOR.w #$FFFF
	INC
CODE_05CE73:
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_05CE7A:
	LDA.w #$0160
	STA.w $093A
	LDA.w $60C0
	ORA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	ORA.w $60DE
	ORA.w $6150
	BNE.b CODE_05CE9F
	LDA.w $7974
	AND.w #$0007
	ASL
	TAX
	LDA.l FXDATA_0AF6AF,x
	STA.w $60BE
	LDX.b $12
CODE_05CE9F:
	LDY.w $77C2,x
	TYA
	EOR.w #$0002
	DEC
	ASL
	CLC
	ADC.b $06
CODE_05CEAB:
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w $6120
	LDY.w $77C2,x
	BNE.b CODE_05CEBA
	EOR.w #$FFFF
	INC
CODE_05CEBA:
	CLC
	ADC.w $611C
	STA.b $02
	STA.w $6020
	STA.w $6024
	LDA.w $611E
	SEC
	SBC.w #$0004
	STA.w $6022
	CLC
	ADC.w #$0008
	STA.w $6026
	STZ.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_0AEA19>>16
	LDA.w #FXCODE_0AEA19
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w $6020
	SEC
	SBC.b $02
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	BEQ.b CODE_05CF15
	LDY.w $77C2,x
	TYA
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_05CF15
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $60A8
	STZ.w $60B4
CODE_05CF15:
	RTL

CODE_05CF16:
	LDA.w $0035
	AND.w #$0300
	BNE.b CODE_05CF21
	JMP.w CODE_05CE4B

CODE_05CF21:
	AND.w #$0200
	DEC
	EOR.w $7C16,x
	BMI.b CODE_05CF2D
	JMP.w CODE_05CE9F

CODE_05CF2D:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_05CF37
	EOR.w $60A8
	BPL.b CODE_05CF55
CODE_05CF37:
	LDA.w $60A8
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	LDY.w $60C0
	BEQ.b CODE_05CF68
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	BRA.b CODE_05CF68

CODE_05CF55:
	LDA.w $60A8
	AND.w #$FF00
	XBA
	TAY
	BPL.b CODE_05CF62
	ORA.w #$FF00
CODE_05CF62:
	LDY.w $60C0
	BNE.b CODE_05CF68
	ASL
CODE_05CF68:
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.b $08
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_05CF8C
	EOR.w $60A8
	BPL.b CODE_05CF8C
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w $60A8
	CLC
	ADC.w #$0200
	CMP.w #$0400
	BCC.b CODE_05CF8C
	JSR.w CODE_05CD15
	RTL

CODE_05CF8C:
	LDA.b $08
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $60A8
	STA.w $60B4
	INC.b $19,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr01C_DrFreezegood
	BNE.b CODE_05CFB8
	STZ.b $16,x
	LDA.w $0035
	AND.w #$0300
	CMP.w #$0300
	BNE.b CODE_05CFB1
	AND.w #$0100
CODE_05CFB1:
	ORA.w #$0010
	STA.b $78,x
	BRA.b CODE_05CFF0

CODE_05CFB8:
	TAY
	PHY
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0010
	STA.b $78,x
	LDA.w $0035
	AND.w #$0300
	CMP.w #$0300
	BNE.b CODE_05CFD0
	AND.w #$0100
CODE_05CFD0:
	PLY
	CPY.b #!Define_YI_NorSpr09E_ChompRock
	BEQ.b CODE_05CFDA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BRA.b CODE_05CFDD

CODE_05CFDA:
	STA.w $7A36,x
CODE_05CFDD:
	LDY.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	BEQ.b CODE_05CFE5
	JMP.w CODE_05CE9F

CODE_05CFE5:
	LDY.w $77C2,x
	TYA
	DEC
	ASL
	SEC
	SBC.b $06
	BRA.b CODE_05CFF6

CODE_05CFF0:
	LDA.b $06
	EOR.w #$FFFF
	INC
CODE_05CFF6:
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	STA.b $02
	LDA.w $7BB6,x
	LDY.w $77C2,x
	BEQ.b CODE_05D007
	EOR.w #$FFFF
	INC
CODE_05D007:
	CLC
	ADC.w $7CD6,x
	STA.b $02
	STA.w $6020
	STA.w $6024
	LDA.w $7CD8,x
	SEC
	SBC.w #$0004
	STA.w $6022
	CLC
	ADC.w #$0008
	STA.w $6026
	STZ.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_0AEA19>>16
	LDA.w #FXCODE_0AEA19
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w $6020
	SEC
	SBC.b $02
	CLC
	ADC.w $70E2,x
	STA.w $70E2,x
	LDA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	BEQ.b CODE_05D0A7
	LDY.b $07
	BPL.b CODE_05D04C
	EOR.w #$FFFF
	INC
CODE_05D04C:
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w $6120
	LDY.w $77C2,x
	BNE.b CODE_05D05B
	EOR.w #$FFFF
	INC
CODE_05D05B:
	CLC
	ADC.w $611C
	STA.b $02
	STA.w $6020
	STA.w $6024
	LDA.w $611E
	SEC
	SBC.w #$0004
	STA.w $6022
	CLC
	ADC.w #$0008
	STA.w $6026
	STZ.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_0AEA19>>16
	LDA.w #FXCODE_0AEA19
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w $6020
	SEC
	SBC.b $02
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $60A8
	STZ.w $60B4
CODE_05D0A7:
	RTL

CODE_05D0A8:
	TYX
	LDA.w $7C16,x
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_05D0C6
	LDY.w $77C2,x
	TYA
	CMP.w $7400,x
	BEQ.b CODE_05D0C6
	LDA.w #$0040
	STA.w $7A96,x
	INC.b $76,x
CODE_05D0C6:
	RTS

CODE_05D0C7:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_05D0E3
	LDY.b $77,x
	LDA.w #$0000
	STA.w $7A38,y
	TAY
	STY.b $77,x
	LDA.w $7040,x
	ORA.w #$0004
	STA.w $7040,x
	INC.b $76,x
CODE_05D0E3:
	RTS

CODE_05D0E4:
	TYX
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_05D13F
	LDA.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	ASL
	PHP
	BIT.w #$FF00
	BEQ.b CODE_05D0FA
	ORA.w #$FF00
CODE_05D0FA:
	LDY.w $7400,x
	BEQ.b CODE_05D103
	EOR.w #$FFFF
	INC
CODE_05D103:
	STA.w $7A38,x
	PLP
	BNE.b CODE_05D124
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_05D124
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDY.w $77C2,x
	TYA
	STA.w $7400,x
	BRA.b CODE_05D13F

CODE_05D124:
	LDY.w $7720,x
	CPY.b #$04
	BPL.b CODE_05D12E
	INC.w $7720,x
CODE_05D12E:
	LDA.w $7860,x
	BIT.w #$000C
	BEQ.b CODE_05D13F
	JMP.w CODE_05D152

CODE_05D139:
	STZ.w $7A38,x
	STZ.w $7720,x
CODE_05D13F:
	LDY.b $18,x
	CPY.b #$06
	BNE.b CODE_05D151
	LDA.w $7C16,x
	CLC
	ADC.w #$0030
	CMP.w #$0060
	BCC.b CODE_05D152
CODE_05D151:
	RTS

CODE_05D152:
	LDY.b $18,x
	BEQ.b CODE_05D18B
	DEY
	DEY
	BNE.b CODE_05D160
	JSL.l CODE_0D9329
	BRA.b CODE_05D17F

CODE_05D160:
	DEY
	DEY
	BNE.b CODE_05D16A
	JSL.l CODE_spawn_1up_score
	BRA.b CODE_05D17F

CODE_05D16A:
	LDA.w #$019B
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_05D151
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
CODE_05D17F:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $04
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSL.l CODE_03D3F3
CODE_05D18B:
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
	BPL.b CODE_05D1B8
	LDA.w #$0000
CODE_05D1B8:
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #!Define_YI_SoundID37_FlutterJump
	JSL.l CODE_push_sound_queue
	LDY.b $77,x
	BEQ.b CODE_05D1CC
	LDA.w #$0000
	STA.w $7A38,y
CODE_05D1CC:
	PLA
	JML.l CODE_03A31E

;---------------------------------------------------------------------------

DATA_05D1D1:
	dw $0022,$0024,$0020

;=========================================================================
; BULLET BILL BLASTERS (sprites $078 Red / $079 Yellow / $07A Green).
; Raidenthequick: init_bullet_bill_blaster / main_bullet_bill_blaster.
; The cannon-mouth sprite that spawns Bullet Bills periodically;
; variant chooses fire rate and projectile sprite ID.
;
; See docs/family-cannons.md for the full projectile-weapon family
; breakdown. Notable: $07A Green Blaster runs an extra SuperFX LOS
; probe at Init storing the result at GenericTable701902, but the
; per-fire gate at CODE_05D602 reads GenericTable701900 -- looks like
; a stale-slot-field read, flagged as a potential genuine bug. Also:
; all 3 Bullet Bill projectile flavors ($07B/$07C/$07D) silently morph
; to Green via CODE_05D71D when tongued -- the Yoshi-eats-Bullet-Bill
; animation is implemented for ONE variant only ($07D).
;=========================================================================
YI_NorSpr078_RedBulletBillShooter_Init:
YI_NorSpr079_YellowBulletBillShooter_Init:
YI_NorSpr07A_GreenBulletBillShooter_Init:
init_bullet_bill_blaster:                   ; Raidenthequick: init_bullet_bill_blaster
;$05D1D7
	LDA.w #$0100
	STA.w $7A36,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr078_RedBulletBillShooter
	ASL
	TAY
	STY.b $18,x
	LDA.w DATA_05D1D1,y
	STA.w $7042,x
	CPY.b #$02
	BNE.b CODE_05D22E
	JSL.l CODE_03AE60
	LDY.b #$04
	STY.b $77,x
	JSR.w CODE_05D32B
	LDA.w $7C16,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7C18,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEC
	SBC.w #$0080
	CMP.w #$0100
	BCS.b CODE_05D228
	STZ.w $7400,x
	BRA.b CODE_05D22E

CODE_05D228:
	LDA.w #$0002
	STA.w $7400,x
CODE_05D22E:
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TAY
	STY.b $19,x
	RTL

;---------------------------------------------------------------------------

DATA_05D238:
DATA_bullet_bill_blaster_state_ptr:              ; 3-entry $76,x sub-state dispatch
	dw CODE_05D4FA                              ;  0: idle, watch for fire window
	dw CODE_05D577                              ;  1: fire bullet bill
	dw CODE_05D5A1                              ;  2: post-fire cooldown

DATA_05D23E:
	dw $0010,$FFF0

DATA_05D242:
	dw $FFF8,$0008

YI_NorSpr078_RedBulletBillShooter_Main:
YI_NorSpr079_YellowBulletBillShooter_Main:
YI_NorSpr07A_GreenBulletBillShooter_Main:
main_bullet_bill_blaster:                   ; Raidenthequick: main_bullet_bill_blaster
;$05D246
	JSR.w CODE_05D2B9
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BMI.b CODE_05D275
	LDA.w $7D96,x
	BNE.b CODE_05D260
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_05D260
	LDA.w $0B65
	BEQ.b CODE_05D26F
CODE_05D260:
	TYX
	JSL.l CODE_03A31E
	LDX.b $12
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BRA.b CODE_05D275

CODE_05D26F:
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
CODE_05D275:
	JSL.l CODE_03AF23
	JSR.w CODE_05D37E
	TXY
	LDA.b $76,x
	AND.w #$00FF
	ASL
	TAX
	JSR.w (DATA_bullet_bill_blaster_state_ptr,x)
	JSR.w CODE_05D32B
	JSR.w CODE_05D43A
	LDY.b $18,x
	CPY.b #$02
	BNE.b CODE_05D2B8
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BMI.b CODE_05D2B8
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr07C_YellowBulletBill
	BNE.b CODE_05D2B2
	LDA.w $7D96,y
	BNE.b CODE_05D2B2
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
CODE_05D2A8:
	CMP.w #$0010
	BEQ.b CODE_05D2B8
	CMP.w #$0002
	BEQ.b CODE_05D2B8
CODE_05D2B2:
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_05D2B8:
	RTL

CODE_05D2B9:
	LDY.w $7723,x
	BMI.b CODE_05D324
	LDY.w $7400,x
	LDA.w DATA_05D23E,y
	STA.b $00
	LDA.w DATA_05D242,y
	STA.b $02
	LDA.w #$FFF0
	LDY.w $7042,x
	BPL.b CODE_05D2D6
	LDA.w #$0010
CODE_05D2D6:
	STA.b $04
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0008
	TAY
	LDA.w $7680,x
	CLC
	ADC.b $02
	STA.w $6000,y
	STA.w $6010,y
	CLC
	ADC.b $00
	STA.w $6008,y
	STA.w $6018,y
	LDA.w $7682,x
	CLC
	ADC.b $04
	STA.w $6002,y
	STA.w $600A,y
	SEC
	SBC.b $04
	STA.w $6012,y
	STA.w $601A,y
	LDA.w $6006,y
	ORA.w #$0002
	STA.w $6006,y
	STA.w $600E,y
	STA.w $6016,y
	STA.w $601E,y
	JSL.l CODE_03AA60
	SEP.b #$10
CODE_05D324:
	RTS

DATA_05D325:
	dw FXDATA_548000+$0010,FXDATA_548000+$0000,FXDATA_548000+$3000

CODE_05D32B:
	LDY.w $7723,x
	BMI.b CODE_05D37D
	LDY.b $77,x
	LDA.w DATA_05D325,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$0000)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7400,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	STZ.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08D6EB>>16
	LDA.w #FXCODE_08D6EB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
CODE_05D37D:
	RTS

CODE_05D37E:
	LDA.w #$0005
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w $6120
	STA.b $04
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7C16,x
	CMP.b $00
	BCS.b CODE_05D37D
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w $6122
	ASL
	STA.b $02
	LSR
	CLC
	ADC.w $7C18,x
	CMP.b $02
	BCS.b CODE_05D37D
	CMP.w #$0008
	BCS.b CODE_05D3E6
	LDY.w $60AB
	BPL.b CODE_05D37D
	STZ.w $60D2
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60AA
CODE_05D3E5:
	RTS

CODE_05D3E6:
	SEC
	SBC.b $02
	CMP.w #$FFF6
	BCC.b CODE_05D407
	LDY.w $60C0
	BEQ.b CODE_05D3F8
	LDY.w $60AB
	BMI.b CODE_05D3E5
CODE_05D3F8:
	INC.w $61B4
	INC
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60AA
	RTS

CODE_05D407:
	LDA.w $60A8
	BNE.b CODE_05D413
	LDA.w $60C4
	EOR.w #$0002
	DEC
CODE_05D413:
	STA.b $06
	EOR.w $7C16,x
	BMI.b CODE_05D439
	LDA.b $04
	LDY.b $07
	BMI.b CODE_05D424
	EOR.w #$FFFF
	INC
CODE_05D424:
	CLC
	ADC.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STZ.w $60A8
	STZ.w $60B4
CODE_05D439:
	RTS

CODE_05D43A:
	LDY.b $79,x
	BEQ.b CODE_05D439
	LDY.b #$00
	STY.b $79,x
	LDA.w $7A38,x
	SEC
	SBC.w #$0100
	EOR.w $6024
	BMI.b CODE_05D457
	LDA.w $6024
	EOR.w #$FFFF
	STA.w $6024
CODE_05D457:
	LDA.w #!Define_YI_AmbSpr1D5
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0006
	STA.w $7E4C,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w $70E2,x
	SEC
	SBC.w $6022
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	SEC
	SBC.w $6020
	STA.w $7142,y
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BMI.b CODE_05D439
	LDA.w #$0100
	STA.w $7A36,y
	LDA.w $7A38,x
	STA.w $7A38,y
	LDA.w $70E2,x
	SEC
	SBC.w $6022
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	SEC
	SBC.w $6020
	STA.w $7182,y
	LDA.w $7400,x
	STA.w $7400,y
	LDA.w $6024
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $6026
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$6820
	STA.w $6FA0,y
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	SEC
	SBC.w #!Define_YI_NorSpr07B_RedBulletBill
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0030
	STA.w $7A98,y
	LDA.w #$0200
	STA.w $7AF6,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	ORA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTS

DATA_05D4F6:
	dw $0000,$0100

CODE_05D4FA:
	TYX
	LDY.b $18,x
	CPY.b #$02
	BNE.b CODE_05D531
	LDA.w #$0004
	JSR.w CODE_sprite_player_delta_facing
	LDA.w $7A98,x
	BNE.b CODE_05D530
	LDY.b $19,x
	BEQ.b CODE_05D520
	LDA.w $7680,x
	CLC
	ADC.w #$0010
	CMP.w #$0110
	BCS.b CODE_05D530
	LDY.b #$00
	STY.b $19,x
CODE_05D520:
	JSR.w CODE_05D602
	BCC.b CODE_05D530
	LDA.w #$0174
	STA.w $7A36,x
	LDA.w #$0001
	STA.b $76,x
CODE_05D530:
	RTS

CODE_05D531:
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	TAY
	LDA.w DATA_05D4F6,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w $7A98,x
	BNE.b CODE_05D576
	LDY.b $19,x
	BEQ.b CODE_05D55A
	LDA.w $7680,x
	CLC
	ADC.w #$0010
	CMP.w #$0110
	BCS.b CODE_05D576
	LDY.b #$00
	STY.b $19,x
CODE_05D55A:
	JSL.l CODE_03AD74
	BCC.b CODE_05D576
	JSR.w CODE_05D602
	BCS.b CODE_05D56B
	JSL.l CODE_03AEFD
	BRA.b CODE_05D576

CODE_05D56B:
	LDA.w #$0174
	STA.w $7A36,x
	LDA.w #$0001
	STA.b $76,x
CODE_05D576:
	RTS

CODE_05D577:
	TYX
	LDA.w $7A36,x
	CLC
	ADC.w #$0004
	CMP.w #$01FF
	BMI.b CODE_05D595
	LDY.b #$02
	STY.b $16,x
	LDA.w #$0102
	STA.b $78,x
	LDA.w #$0202
	STA.b $76,x
	LDA.w #$01FF
CODE_05D595:
	STA.w $7A36,x
	RTS

DATA_05D599:
	dw $0010,$FFF0

DATA_05D59D:
	dw $0004,$0000

CODE_05D5A1:
	TYX
	LDY.b $78,x
	LDA.w $7A36,x
	CLC
	ADC.w DATA_05D599,y
	CMP.w #$01FF
	BMI.b CODE_05D5C0
	LDY.b #$02
	STY.b $77,x
	LDA.b $78,x
	EOR.w #$0002
	STA.b $78,x
	LDA.w #$01FF
	BRA.b CODE_05D5FE

CODE_05D5C0:
	CMP.w #$0199
	BPL.b CODE_05D5FE
	LDA.b $78,x
	EOR.w #$0002
	STA.b $78,x
	LDA.w #$0199
	DEC.b $16,x
	BNE.b CODE_05D5FE
	LDY.b #$00
	LDA.b $18,x
	AND.w #$00FF
	CMP.w #$0002
	BEQ.b CODE_05D5E1
	INY
	INY
CODE_05D5E1:
	LDA.w #$0100
	STA.w $7A98,x
	LDA.w DATA_05D59D,y
	STA.b $77,x
	LDA.w #$0100
	STA.w $7A36,x
	TYA
	BEQ.b CODE_05D5F9
	JSL.l CODE_03AEFD
CODE_05D5F9:
	LDY.b #$00
	STY.b $76,x
	RTS

CODE_05D5FE:
	STA.w $7A36,x
	RTS

; note: when variant = $02 (Green Blaster $07A), this gate reads
; GenericTable701900 to decide whether to fire. But init_bullet_bill_blaster
; (line 11108) stores the FXCODE_0BBCF8 line-of-sight probe result into
; GenericTable701902, NOT 701900. The Init does also derive the $7400
; facing flag from the same LOS value, so the LOS isn't unused -- but
; the 701902 write itself looks orphaned. Either intentional latent
; storage (read elsewhere we haven't traced) or genuine bug. See docs/
; family-cannons.md open Q.
CODE_05D602:
	LDY.b $18,x
	CPY.b #$02
	BNE.b CODE_05D613
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	AND.w #$00FF
	CMP.w #$0080
	BMI.b CODE_05D635
CODE_05D613:
	TYA
	LSR
	CLC
	ADC.w #$007B
	TXY
	JSL.l CODE_03A34E
	BCC.b CODE_05D635
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr07D_GreenBulletBill
	BEQ.b CODE_05D639
	PHX
	TYX
	JSL.l CODE_03AD74
	BCS.b CODE_05D637
	JSL.l CODE_03A31E
	PLX
CODE_05D635:
	CLC
	RTS

CODE_05D637:
	TXY
	PLX
CODE_05D639:
	TYA
	SEP.b #$20
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	REP.b #$20
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w $7042,x
	STA.w $7042,y
	SEP.b #$20
	LDA.b #$FF
	STA.w $7863,x
	REP.b #$20
	SEC
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; BULLET BILLS (sprites $07B Red biting / $07D Green tracking).
; Raidenthequick: init_biting_bullet_bill / init_bullet_bill /
;                 main_biting_bullet_bill / main_bullet_bill /
;                 head_bop_special_bullet_bill / head_bop_bullet_bill.
; Red bites (Yoshi can be eaten); Green tracks Yoshi vertically.
;=========================================================================
YI_NorSpr07B_RedBulletBill_Init:
init_biting_bullet_bill:                    ; Raidenthequick: init_biting_bullet_bill
;$05D661
	JSR.w CODE_05D77F
YI_NorSpr07D_GreenBulletBill_Init:
init_bullet_bill:                           ; Raidenthequick: init_bullet_bill
	RTL

;---------------------------------------------------------------------------

YI_NorSpr07B_RedBulletBill_Main:
main_biting_bullet_bill:                    ; Raidenthequick: main_biting_bullet_bill
;$05D665
	LDY.w $74A2,x
	BMI.b CODE_05D673
	LDY.w $7723,x
	BMI.b CODE_05D673
	JSL.l CODE_03AA52
CODE_05D673:
	JSR.w CODE_05D71D
	JSL.l CODE_03AF23
	LDY.b $76,x
	BNE.b CODE_05D68B
	LDA.w $7A98,x
	BNE.b CODE_05D688
	INC.b $76,x
	JSR.w CODE_05D883
CODE_05D688:
	JMP.w CODE_05D6E8

CODE_05D68B:
	LDA.w $7AF6,x
	BNE.b CODE_05D6E2
	LDA.b $16,x
	BNE.b CODE_05D6C5
	LDY.b $76,x
	DEY
	BEQ.b CODE_05D6BC
	LDA.w #!Define_YI_AmbSpr1CD
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$000B
	STA.w $7E4C,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	JML.l CODE_03A31E

CODE_05D6BC:
	LDA.w #$0018
	STA.b $16,x
	INC.b $76,x
	BRA.b CODE_05D6C7

CODE_05D6C5:
	DEC.b $16,x
CODE_05D6C7:
	LDA.w $7042,x
	EOR.w #$000E
	STA.w $7042,x
	LDA.w $7A36,x
	SEC
	SBC.w #$0004
	CMP.w #$0040
	BPL.b CODE_05D6DF
	LDA.w #$0040
CODE_05D6DF:
	STA.w $7A36,x
CODE_05D6E2:
	JSR.w CODE_05D883
	JSR.w CODE_058073
CODE_05D6E8:
	JSR.w CODE_05D76A
	BRA.b CODE_05D6FA

YI_NorSpr07D_GreenBulletBill_Main:
main_bullet_bill:                           ; Raidenthequick: main_bullet_bill
;$05D6ED
	JSR.w CODE_05D71D
	JSL.l CODE_03AF23
	LDA.w #$0004
	STA.w $74A2,x
CODE_05D6FA:
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	JSR.w CODE_05D7BB
	LDA.w $7A96,x
	BNE.b CODE_05D718
	LDA.w #$0006
	STA.w $7A96,x
	LDA.b $78,x
	EOR.w #$0002
	STA.b $78,x
CODE_05D718:
	RTL

DATA_05D719:
	dw $FE00,$0200

CODE_05D71D:
	LDY.w $7D38,x
	BEQ.b CODE_05D765
	LDY.w $7722,x
	BMI.b CODE_05D72B
	JSL.l CODE_03AEFD
CODE_05D72B:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	PHA
	LDA.w $7042,x
	PHA
	TXY
	LDA.w #!Define_YI_NorSpr07D_GreenBulletBill
	JSL.l CODE_spawn_sprite
	LDY.w $7400,x
	LDA.w DATA_05D719,y
	STA.w $75E0,x
	LDA.w #$0040
	STA.w $7542,x
	STA.w $7540,x
	LDA.w #$6820
	STA.w $6FA0,x
	PLA
	STA.w $7042,x
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLA
	RTL

CODE_05D765:
	RTS

DATA_05D766:
	dw FXDATA_548000+$1000,FXDATA_548000+$0020

CODE_05D76A:
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0003
	BNE.b CODE_05D7BA
	LDA.w #$0004
	STA.w $74A2,x
CODE_05D77F:
	LDY.b $78,x
	LDA.w DATA_05D766,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$0020)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7A36,x
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
CODE_05D7BA:
	RTS

CODE_05D7BB:
	LDA.w #$000C
	JSR.w CODE_05D833
	BCS.b CODE_05D7BA
	LDA.w $7C18,x
	SEC
	SBC.b $02
	CMP.w #$FFF8
	BCC.b CODE_05D820
	LDY.w $60C0
	BEQ.b CODE_05D832
	LDY.w $60AB
	BMI.b CODE_05D832
	LDA.w $60FC
	AND.w #$0018
	BNE.b CODE_05D7F5
	LDA.w #$FA00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	STZ.w $60D4
	LDA.w #$8001
	STA.w $60D2
CODE_05D7F5:
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0016
	STA.w $7542,x
	LDA.w #$02CC
	STA.w $75E2,x
	STZ.b $78,x
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
	LDA.w #!Define_YI_SoundID0B_ShellHit1
	JSL.l CODE_push_sound_queue
	RTS

CODE_05D820:
	LDA.w #$0006
	JSR.w CODE_05D833
	BCS.b CODE_05D832
	STZ.w $60AA
	STZ.w $60D2
	JSL.l CODE_03A858
CODE_05D832:
	RTS

CODE_05D833:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w !REGISTER_SuperFX_R4_LMULTResultLo
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w $6120
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7C16,x
	CMP.b $00
	BCS.b CODE_05D87E
	LDA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w $6122
	STA.b $02
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7C18,x
	CMP.b $00
CODE_05D87E:
	RTS

DATA_05D87F:
	dw $009C,$FF64

CODE_05D883:
	LDA.w #$0005
	STA.w $7542,x
	STA.w $7540,x
	LDA.w $7A98,x
	BNE.b CODE_05D8B5
	LDA.w #$0040
	STA.w $7A98,x
	LDY.b #$00
	LDA.w $7C16,x
	BMI.b CODE_05D8A0
	INY
	INY
CODE_05D8A0:
	LDA.w DATA_05D87F,y
	STA.w $75E0,x
	LDY.b #$00
	LDA.w $7C18,x
	BMI.b CODE_05D8AF
	INY
	INY
CODE_05D8AF:
	LDA.w DATA_05D87F,y
	STA.w $75E2,x
CODE_05D8B5:
	RTS

;---------------------------------------------------------------------------

YI_NorSpr07B_RedBulletBill_StompRt:
YI_NorSpr07C_YellowBulletBill_StompRt:
;$05D8B6
	JSL.l CODE_03AA52
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_05D8D5
	LDA.w $7A38,x
	CLC
	ADC.w #$0002
	AND.w #$01FE
	STA.w $7A38,x
	JSR.w CODE_05D76A
CODE_05D8D5:
	RTL

;---------------------------------------------------------------------------

YI_NorSpr07D_GreenBulletBill_StompRt:
;$05D8D6
	JML.l CODE_head_bop_common

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Yellow Bullet Bill (bouncing variant) -- Raidenthequick:
;   init_bouncing_bullet_bill / main_bouncing_bullet_bill.
; Bounces along the ground; 4-state dispatch (launch / mid-air / land / wait).
;-------------------------------------------------------------------------
YI_NorSpr07C_YellowBulletBill_Init:
init_bouncing_bullet_bill:                  ; Raidenthequick: init_bouncing_bullet_bill
;$05D8DA
	JSR.w CODE_05D923
	RTL

;---------------------------------------------------------------------------

DATA_05D8DE:
DATA_bouncing_bullet_bill_state_ptr:
	dw CODE_05D962                          ; 00 = launch
	dw CODE_05D9F2                          ; 02 = mid-air bounce
	dw CODE_05DA6A                          ; 04 = landing
	dw CODE_05DA81                          ; 06 = wait

YI_NorSpr07C_YellowBulletBill_Main:
main_bouncing_bullet_bill:                  ; Raidenthequick: main_bouncing_bullet_bill
;$05D8E6
	LDY.w $74A2,x
	BMI.b CODE_05D8F4
	LDY.w $7723,x
	BMI.b CODE_05D8F4
	JSL.l CODE_03AA52
CODE_05D8F4:
	JSR.w CODE_05D71D
	LDA.w $7D96,x
	BEQ.b CODE_05D8FF
	STZ.w $6FA2,x
CODE_05D8FF:
	JSL.l CODE_03AF23
	LDA.w #$0004
	STA.w $74A2,x
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_bouncing_bullet_bill_state_ptr,x)
	JSR.w CODE_05D923
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.b $78,x
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	JSR.w CODE_05D7BB
	RTL

CODE_05D923:
	LDA.w #FXDATA_548000+$0020
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$0020)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $78,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
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

CODE_05D962:
	TYX
	LDA.w #$0100
	STA.b $78,x
	STA.w $7A36,x
	JSR.w CODE_05D96F
	RTS

CODE_05D96F:
	LDA.w $7860,x
	AND.w #$000F
	BEQ.b CODE_05D9C5
	TAY
	STY.b $02
	LDA.w DATA_058F48-$01,y
	AND.w #$00FF
	CMP.w #$00FF
	BNE.b CODE_05D9AF
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_05D98E
	EOR.w #$FFFF
	INC
CODE_05D98E:
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_05D999
	EOR.w #$FFFF
	INC
CODE_05D999:
	CMP.b $00
	BPL.b CODE_05D9A6
	LDA.b $02
	AND.w #$0008
	LSR
	LSR
	BRA.b CODE_05D9AF

CODE_05D9A6:
	LDA.b $02
	AND.w #$0002
	CLC
	ADC.w #$0004
CODE_05D9AF:
	STA.b $16,x
	LDA.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	AND.w #$00FF
	STA.b $18,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.b #$01
	STY.b $76,x
	PLA
	RTS

CODE_05D9C5:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTS

DATA_05D9D2:
	dw $FE58,$FE80,$FEAC,$FF00,$FEAC,$FE80,$FE54,$0200
	dw $FFA8,$FF80,$FF54,$FE00,$FE54,$FE80,$FEA8,$FF00

CODE_05D9F2:
	TYX
	LDA.w $7A36,x
	SEC
	SBC.w #$0008
	CMP.w #$00A0
	BPL.b CODE_05DA5D
	LDY.b $16,x
	CPY.b #$04
	BPL.b CODE_05DA0A
	LDA.w #$000E
	BRA.b CODE_05DA16

CODE_05DA0A:
	LDA.b $18,x
	CLC
	ADC.w #$0038
	AND.w #$00F0
	LSR
	LSR
	LSR
CODE_05DA16:
	LDY.w $7400,x
	BEQ.b CODE_05DA1F
	CLC
	ADC.w #$0010
CODE_05DA1F:
	TAY
	LDA.w DATA_05D9D2,y
	LDY.w $7400,x
	BNE.b CODE_05DA2E
	SEC
	SBC.w $7A38,x
	BRA.b CODE_05DA32

CODE_05DA2E:
	CLC
	ADC.w $7A38,x
CODE_05DA32:
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0166
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	JSR.w CODE_058073
	INC.b $76,x
	LDA.w #$00A0
CODE_05DA5D:
	STA.w $7A36,x
	LDA.w #$0200
	SEC
	SBC.w $7A36,x
	STA.b $78,x
	RTS

CODE_05DA6A:
	TYX
	JSR.w CODE_05D96F
	LDA.w $7A36,x
	CLC
	ADC.w #$0008
	CMP.w #$0130
	BMI.b CODE_05DA7F
	INC.b $76,x
	LDA.w #$0130
CODE_05DA7F:
	BRA.b CODE_05DA5D

CODE_05DA81:
	TYX
	JSR.w CODE_05D96F
	LDA.w $7A36,x
	SEC
	SBC.w #$0004
	CMP.w #$0100
	BPL.b CODE_05DA96
	STZ.b $76,x
	LDA.w #$0100
CODE_05DA96:
	BRA.b CODE_05DA5D

;---------------------------------------------------------------------------

;=========================================================================
; HINT BLOCK / MESSAGE BOX (sprite $0AD).
; Raidenthequick: init_hint_block / main_hint_block.
; The "?" stationary block. Touching opens a message-box dialog
; (gamemode handler lives in Bank01).
;=========================================================================
YI_NorSpr0AD_MessageBox_Init:
init_hint_block:                            ; Raidenthequick: init_hint_block
;$05DA98
	JSL.l CODE_03AE60
	LDA.w #$0100
	STA.w $7A36,x
	LDA.w $7182,x
	STA.b $78,x
	LDA.w #$0001
	STA.w $7402,x
	JSR.w CODE_05DB79
	RTL

;---------------------------------------------------------------------------

DATA_05DAB1:
DATA_hint_block_state_ptr:                       ; 3-entry $76,x sub-state dispatch (Message Box $0AD)
	dw CODE_0580C2                              ;  0: GSU delta-facing stub (idle)
	dw CODE_05DBC8                              ;  1: hit, animate-bounce
	dw CODE_05DC05                              ;  2: open dialog

DATA_05DAB7:
	dw FXDATA_550000+$6010,FXDATA_550000+$7010

DATA_05DABB:
	dw $0018,$FFE8

DATA_05DABF:
	dw $0020,$FFE0

YI_NorSpr0AD_MessageBox_Main:
main_hint_block:                            ; Raidenthequick: main_hint_block
;$05DAC3
	JSL.l CODE_03AA52
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_05DADA
	JSL.l CODE_03B69D
	JSL.l CODE_03B716
CODE_05DADA:
	STZ.w $7400,x
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_hint_block_state_ptr,x)
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_05DAF4
	LDY.b $76,x
	BEQ.b CODE_05DAF7
CODE_05DAF4:
	JSR.w CODE_05DB79
CODE_05DAF7:
	LDY.b $76,x
	BNE.b CODE_05DB74
	LDY.w $60AB
	BPL.b CODE_05DB46
	LDY.w $60C0
	BEQ.b CODE_05DB46
	LDA.w $7C16,x
	CLC
	ADC.w #$000C
	CMP.w #$0018
	BCS.b CODE_05DB46
	LDA.w $7C18,x
	CMP.w #$FFE8
	BMI.b CODE_05DB46
	CMP.w #$FFF0
	BPL.b CODE_05DB46
	STZ.w $60AA
	STZ.w $60D2
CODE_05DB24:
	DEC.w $7182,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0034
	STA.w $7542,x
	STZ.w $7A38,x
	INC.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	INC.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDA.w #!Define_YI_SoundID32_HitMessageBox
	JSL.l CODE_push_sound_queue
	INC.b $76,x
	RTL

CODE_05DB46:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_05DB60
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05DB60
	LDA.w $7D38,y
	BEQ.b CODE_05DB60
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	BRA.b CODE_05DB24

CODE_05DB60:
	LDA.w $7A98,x
	BNE.b CODE_05DB74
	LDA.w #$0008
	STA.w $7A98,x
	LDA.w $7A38,x
	EOR.w #$0002
	STA.w $7A38,x
CODE_05DB74:
	JSL.l CODE_03D127
	RTL

CODE_05DB79:
	LDY.w $7A38,x
	LDA.w DATA_05DAB7,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$6010)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	SEC
	SBC.w #$0100
	LSR
	STA.b $00
	LDA.w #$0100
	SEC
	SBC.b $00
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w $7722,x
	TAX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_0882FA>>16
	LDA.w #FXCODE_0882FA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
	RTS

CODE_05DBC8:
	TYX
	LDA.b $78,x
	CMP.w $7182,x
	BPL.b CODE_05DBDF
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $76,x
	RTS

CODE_05DBDF:
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_05DBE8
	INY
	INY
CODE_05DBE8:
	LDA.w $7A36,x
	CLC
	ADC.w DATA_05DABB,y
	CMP.w #$00A0
	BPL.b CODE_05DBF9
	LDA.w #$00A0
	BRA.b CODE_05DC01

CODE_05DBF9:
	CMP.w #$01FF
	BMI.b CODE_05DC01
	LDA.w #$01FF
CODE_05DC01:
	STA.w $7A36,x
	RTS

CODE_05DC05:
	TYX
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $7A36,x
	CLC
	ADC.w DATA_05DABF,y
	CPY.b #$00
	BEQ.b CODE_05DC58
	CMP.w #$0100
	BPL.b CODE_05DC66
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	LSR
	TAY
	LDA.w $7182,x
	AND.w #$0010
	BEQ.b CODE_05DC2E
	INY
	INY
CODE_05DC2E:
	TYA
	STA.b $00
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	ASL
	ASL
	CLC
	ADC.b $00
	STA.l $704070
	CMP.w #$0001
	BNE.b CODE_05DC4E
	LDA.w !EXRAM_YI_Global_EggThrowSetting|!EXRAMBankMirror
	BEQ.b CODE_05DC4E
	LDA.w #$011C
	STA.l $704070
CODE_05DC4E:
	INC.w !RAM_YI_Level_MessageBoxState 
	STZ.b $76,x
	LDA.w #$0100
	BRA.b CODE_05DC66

CODE_05DC58:
	CMP.w #$0160
	BMI.b CODE_05DC66
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0160
CODE_05DC66:
	STA.w $7A36,x
	RTS

;---------------------------------------------------------------------------

DATA_05DC6A:
	dw $FFC0,$0040

DATA_05DC6E:
	dw $0100,$FF00,$0100

;=========================================================================
; BOO MAN BLUFF (sprite $10F).
; Raidenthequick: init_boo_man_bluff / main_boo_man_bluff.
; Slope-skating Boo Guy: slides down slopes carrying a sled.
;=========================================================================
YI_NorSpr10F_BooManBluff_Init:
init_boo_man_bluff:                         ; Raidenthequick: init_boo_man_bluff
;$05DC74
	LDY.w $7400,x
	LDA.w DATA_05DC6A,y
	STA.w $75E0,x
	LDA.w #$0006
	STA.w $7540,x
	LDY.b #$00
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CMP.w $7182,x
	BMI.b CODE_05DC8F
	INY
	INY
CODE_05DC8F:
	LDA.w DATA_05DC6E,y
	STA.w $75E2,x
	LDA.w DATA_05DC6E+$02,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7182,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0026
	STA.w $7042,x
	RTL

;---------------------------------------------------------------------------

DATA_05DCA8:
DATA_boo_man_bluff_state_ptr:                    ; 11-entry $76,x sub-state dispatch (Boo-Man Bluff $10F)
	dw CODE_05DF60                              ;  $0: invisible, follow Yoshi
	dw CODE_05DF9B                              ;  $1: prep visible
	dw CODE_05DFCC                              ;  $2: become visible / charge
	dw CODE_05DFDE                              ;  $3: pursue Yoshi
	dw CODE_05E010                              ;  $4: pause / about-to-pounce
	dw CODE_05E027                              ;  $5: lunge
	dw CODE_05E04A                              ;  $6: post-lunge recover
	dw CODE_05E069                              ;  $7: prepare to vanish
	dw CODE_05E087                              ;  $8: vanish-back-to-invisible
	dw CODE_05E0B3                              ;  $9: hit-stun
	dw CODE_05E0DC                              ;  $A: defeat / despawn

YI_NorSpr10F_BooManBluff_Main:
main_boo_man_bluff:                         ; Raidenthequick: main_boo_man_bluff
;$05DCBE
	JSL.l CODE_03AF23
	LDY.w $7D36,x
	BPL.b CODE_05DCFB
	JSL.l CODE_03A858
	LDY.b $76,x
	CPY.b #$0A
	BEQ.b CODE_05DCFF
	LDA.w #$FFFF
	STA.w $7AF6,x
	LDA.w #$0100
	STA.w $7A98,x
	LDA.w #$0007
	STA.w $7402,x
	LDA.w #$FC00
	STA.w $75E2,x
	STZ.w $75E0,x
	LDA.w #$0008
	STA.w $7542,x
	STA.w $7540,x
	LDY.b #$0A
	STY.b $76,x
	BRA.b CODE_05DCFF

CODE_05DCFB:
	JSL.l CODE_03A5B7
CODE_05DCFF:
	JSR.w CODE_05DD1A
	LDY.b $78,x
	BNE.b CODE_05DD0E
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_boo_man_bluff_state_ptr,x)
CODE_05DD0E:
	JSR.w CODE_05DF1E
	RTL

DATA_05DD12:
	dw $FF00,$0100

DATA_05DD16:
	dw $FE80,$0180

CODE_05DD1A:
	LDA.w $7AF6,x
	BNE.b CODE_05DD4B
	LDA.w $61F2
	BEQ.b CODE_05DD27
	JMP.w CODE_05DE0B

CODE_05DD27:
	LDY.b $76,x
	CPY.b #$02
	BEQ.b CODE_05DD35
	CPY.b #$03
	BEQ.b CODE_05DD35
	CPY.b #$09
	BNE.b CODE_05DD4C
CODE_05DD35:
	LDA.w #$0003
	STA.w $7402,x
	INC
	STA.w $7A98,x
	LDA.w #$FFFF
	STA.w $7AF6,x
	STZ.b $78,x
	LDY.b #$07
	STY.b $76,x
CODE_05DD4B:
	RTS

CODE_05DD4C:
	CPY.b #$04
	BNE.b CODE_05DD89
	STZ.w $75E0,x
	STZ.w $75E2,x
	LDA.w $7C16,x
	BPL.b CODE_05DD5F
	EOR.w #$FFFF
	INC
CODE_05DD5F:
	LSR
	LSR
	STA.w $7540,x
	LDA.w $7C18,x
	BPL.b CODE_05DD6D
	EOR.w #$FFFF
	INC
CODE_05DD6D:
	LSR
	LSR
	STA.w $7542,x
	LDA.w #$0002
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w #$FFFF
	STA.w $7AF6,x
	LDY.b #$06
	STY.b $76,x
	RTS

CODE_05DD89:
	CPY.b #$06
	BNE.b CODE_05DDA0
	LDA.w #$0003
	STA.w $7402,x
	INC
	STA.w $7A98,x
	LDA.w #$FFFF
	STA.w $7AF6,x
	INC.b $76,x
	RTS

CODE_05DDA0:
	CPY.b #$07
	BNE.b CODE_05DDC0
	LDA.w #$0005
	STA.w $7402,x
	DEC
	STA.w $7A98,x
	DEC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $7400,x
	STA.b $16,x
	LDA.w #$FFFF
	STA.w $7AF6,x
	INC.b $76,x
	RTS

CODE_05DDC0:
	CPY.b #$08
	BNE.b CODE_05DE0A
	STZ.b $78,x
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_05DDF5
	LDY.b #$00
	LDA.w $7182,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_05DDD7
	INY
	INY
CODE_05DDD7:
	LDA.w DATA_05DC6E,y
	STA.w $75E2,x
	LDA.w DATA_05DC6E+$02,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.w $7400,x
	LDA.w DATA_05DC6A,y
	STA.w $75E0,x
	LDA.w #$0100
	STA.w $7A96,x
	STZ.b $76,x
	RTS

CODE_05DDF5:
	LDA.w #$0005
	STA.w $7402,x
	DEC
	STA.w $7A98,x
	LDA.w $7400,x
	STA.b $16,x
	LDA.w #$FFFF
	STA.w $7AF6,x
CODE_05DE0A:
	RTS

CODE_05DE0B:
	LDY.b $76,x
	BEQ.b CODE_05DE13
	CPY.b #$07
	BNE.b CODE_05DE4B
CODE_05DE13:
	STZ.w $75E0,x
	STZ.w $75E2,x
	LDA.w #$0010
	STA.w $7540,x
	STA.w $7542,x
	LDA.w #$FFFF
	STA.w $7AF6,x
	LDY.b #$02
	LDA.w $6EB4
	STA.w $7A38,x
	LDA.w $6EB2
	STA.w $7A36,x
	SEC
	SBC.w $70E2,x
	STA.b $00
	LDA.w $7400,x
	STA.b $16,x
	DEC
	EOR.b $00
	BPL.b CODE_05DE48
	LDY.b #$03
CODE_05DE48:
	STY.b $76,x
	RTS

CODE_05DE4B:
	CPY.b #$02
	BEQ.b CODE_05DE57
	CPY.b #$03
	BEQ.b CODE_05DE57
	CPY.b #$09
	BNE.b CODE_05DE9E
CODE_05DE57:
	STZ.b $78,x
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w #$FFFF
	STA.w $7AF6,x
	LDY.b #$00
	LDA.w $6EB2
	CMP.w $70E2,x
	BMI.b CODE_05DE71
	INY
	INY
CODE_05DE71:
	TYA
	CMP.w $7400,x
	BEQ.b CODE_05DE87
	LDA.w #$0009
	STA.w $7402,x
	LDA.w $7400,x
	STA.b $16,x
	LDY.b #$09
	STY.b $76,x
	RTS

CODE_05DE87:
	LDA.w $6EB2
	STA.w $7A36,x
	LDA.w $6EB4
	STA.w $7A38,x
	LDA.w #$0002
	STA.w $7402,x
	LDY.b #$04
	STY.b $76,x
	RTS

CODE_05DE9E:
	CPY.b #$04
	BNE.b CODE_05DF15
	LDA.w $6EB2
	STA.w $7A36,x
	LDA.w $6EB4
	STA.w $7A38,x
CODE_05DEAE:
	LDA.w #$0040
	STA.w $7AF6,x
	LDA.w $7C16,x
	BPL.b CODE_05DEBD
	EOR.w #$FFFF
	INC
CODE_05DEBD:
	LSR
	LSR
	LSR
	STA.w $7540,x
	LDA.w $7C18,x
	BPL.b CODE_05DECC
	EOR.w #$FFFF
	INC
CODE_05DECC:
	LSR
	LSR
	LSR
	STA.w $7542,x
	LDY.b #$00
	LDA.w $7A36,x
	CMP.w $70E2,x
	BMI.b CODE_05DEDE
	INY
	INY
CODE_05DEDE:
	LDA.w DATA_05DD12,y
	STA.w $75E0,x
	TYA
	CMP.w $7400,x
	BEQ.b CODE_05DF02
	LDA.w #$FFFF
	STA.w $7AF6,x
	LDA.w $7400,x
	STA.b $16,x
	DEC.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
	LDY.b #$05
	STY.b $76,x
CODE_05DF02:
	LDY.b #$00
	LDA.w $7A38,x
	CMP.w $7182,x
	BMI.b CODE_05DF0E
	INY
	INY
CODE_05DF0E:
	LDA.w DATA_05DD16,y
	STA.w $75E2,x
CODE_05DF14:
	RTS

CODE_05DF15:
	CPY.b #$08
	BNE.b CODE_05DF14
	STZ.b $78,x
	JMP.w CODE_05DE13

CODE_05DF1E:
	LDA.w $75E0,x
	BNE.b CODE_05DF3F
	LDA.w $7540,x
	BEQ.b CODE_05DF3F
	DEC
	STA.b $00
	ASL
	STA.w $7962
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.b $00
	CMP.b $02
	BCS.b CODE_05DF3F
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
CODE_05DF3F:
	LDA.w $75E2,x
	BNE.b CODE_05DF5F
	LDA.w $7542,x
	BEQ.b CODE_05DF5F
	DEC
	STA.b $00
	ASL
	STA.b $02
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.b $00
	CMP.b $02
	BCS.b CODE_05DF5F
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
CODE_05DF5F:
	RTS

CODE_05DF60:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_05DF7F
	STZ.w $75E0,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ORA.w $7540,x
	BNE.b CODE_05DF7F
	LDA.w $7400,x
	STA.b $16,x
	LDA.w #$0005
	STA.w $7402,x
	INC.b $76,x
	RTS

CODE_05DF7F:
	LDA.w #$0006
	STA.w $7540,x
	STA.w $7542,x
	LDY.b #$00
	LDA.w $7182,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_05DF94
	INY
	INY
CODE_05DF94:
	LDA.w DATA_05DC6E,y
	STA.w $75E2,x
	RTS

CODE_05DF9B:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_05DFC9
	LDA.w $7400,x
	CMP.b $16,x
	BEQ.b CODE_05DFBD
	STZ.w $7402,x
	LDA.w #$0100
	STA.w $7A96,x
	LDY.w $7400,x
	LDA.w DATA_05DC6A,y
	STA.w $75E0,x
	STZ.b $76,x
	RTS

CODE_05DFBD:
	EOR.w #$0002
	STA.w $7400,x
	LDA.w #$0008
	STA.w $7A98,x
CODE_05DFC9:
	JMP.w CODE_05DF7F

CODE_05DFCC:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_05E00F
	DEC.w $7402,x
	LDY.w $7402,x
	CPY.b #$03
	BEQ.b CODE_05E009
	BRA.b CODE_05DFEB

CODE_05DFDE:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_05E00F
	LDA.w $7400,x
	CMP.b $16,x
	BEQ.b CODE_05E000
CODE_05DFEB:
	LDA.w #$0008
	STA.w $7402,x
	LDA.w #$0040
	STA.w $7AF6,x
	STZ.w $75E0,x
	STZ.w $75E2,x
	INC.b $78,x
	RTS

CODE_05E000:
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_05E009:
	LDA.w #$0004
	STA.w $7A98,x
CODE_05E00F:
	RTS

CODE_05E010:
	TYX
	LDY.w $7402,x
	CPY.b #$07
	BEQ.b CODE_05E026
	LDA.w $7A98,x
	BNE.b CODE_05E026
	LDA.w #$0007
	STA.w $7402,x
	JSR.w CODE_05DEAE
CODE_05E026:
	RTS

CODE_05E027:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_05E049
	LDA.w $7400,x
	CMP.b $16,x
	BEQ.b CODE_05E03D
	STZ.w $7AF6,x
	DEC.w $7402,x
	DEC.b $76,x
	RTS

CODE_05E03D:
	EOR.w #$0002
	STA.w $7400,x
	LDA.w #$0004
	STA.w $7A98,x
CODE_05E049:
	RTS

CODE_05E04A:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_05E068
	LDY.w $7402,x
	CPY.b #$08
	BEQ.b CODE_05E05D
	LDA.w #$0008
	STA.w $7402,x
CODE_05E05D:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ORA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_05E068
	STZ.w $7AF6,x
CODE_05E068:
	RTS

CODE_05E069:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_05E086
	INC.w $7402,x
	LDY.w $7402,x
	CPY.b #$05
	BNE.b CODE_05E080
	STZ.w $7AF6,x
	STZ.w $7402,x
	RTS

CODE_05E080:
	LDA.w #$0004
	STA.w $7A98,x
CODE_05E086:
	RTS

CODE_05E087:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_05E0B2
	LDY.w $7402,x
	BNE.b CODE_05E09B
	LDA.w #$0010
	STA.w $7AF6,x
	INC.b $78,x
	RTS

CODE_05E09B:
	LDA.w $7400,x
	CMP.b $16,x
	BEQ.b CODE_05E0AC
	LDA.w #$0010
	STA.w $7A98,x
	STZ.w $7402,x
	RTS

CODE_05E0AC:
	EOR.w #$0002
	STA.w $7400,x
CODE_05E0B2:
	RTS

CODE_05E0B3:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_05E0DB
	LDA.w $7400,x
	CMP.b $16,x
	BEQ.b CODE_05E0CF
	LDA.w #$0020
	STA.w $7AF6,x
	LDA.w #$0008
	STA.w $7402,x
	INC.b $78,x
	RTS

CODE_05E0CF:
	EOR.w #$0002
	STA.w $7400,x
	LDA.w #$0004
	STA.w $7A98,x
CODE_05E0DB:
	RTS

CODE_05E0DC:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_05E0EA
	STZ.w $7AF6,x
	LDY.b #$04
	STY.b $76,x
	RTS

CODE_05E0EA:
	LDA.w $7182,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BPL.b CODE_05E0F5
	STZ.w $75E0,x
CODE_05E0F5:
	JMP.w CODE_05DF7F

;---------------------------------------------------------------------------

;=========================================================================
; HEADING CACTUS (sprite $0E4).
; Raidenthequick: init_heading_cactus / main_heading_cactus.
; Cactus that charges when Yoshi enters its line of sight.
;=========================================================================
YI_NorSpr0E4_HeadingCactus_Init:
init_heading_cactus:                        ; Raidenthequick: init_heading_cactus
;$05E0F8
	DEC.b $18,x
	LDA.w #$00E5
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_05E122
	LDA.w $70E2,x
	STA.w $70E2,y
	STA.w $7A36,y
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,y
	STY.b $18,x
	LDA.w #$0005
	STA.w $7A36,x
	LDY.b #$02
	STY.b $76,x
CODE_05E122:
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.w !RAM_YI_Level_CurrentWorldLo
	BEQ.b CODE_05E130				; Note: !Define_YI_WorldID_World1
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_05E130:
	RTL

;---------------------------------------------------------------------------

DATA_05E131:
DATA_heading_cactus_state_ptr:                   ; 6-entry $76,x sub-state dispatch (Heading Cactus $0E4)
	dw CODE_05E179                              ;  0: idle, await wind-up
	dw CODE_05E1A4                              ;  1: wind-up animation
	dw CODE_05E1EF                              ;  2: spit needlenose projectile
	dw CODE_05E28F                              ;  3: post-spit cooldown
	dw CODE_05E2C2                              ;  4: hit / disabled
	dw CODE_05E300                              ;  5: defeat / despawn

YI_NorSpr0E4_HeadingCactus_Main:
main_heading_cactus:                        ; Raidenthequick: main_heading_cactus
;$05E13D
	JSL.l CODE_03AF23
	LDY.b $18,x
	BMI.b CODE_05E149
	JSL.l CODE_03A5B7
CODE_05E149:
	LDY.b $18,x
	BMI.b CODE_05E170
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05E162
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	BNE.b CODE_05E162
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr0E5_GreenNeedlenose
	BEQ.b CODE_05E170
CODE_05E162:
	LDY.b #$FF
	STY.b $18,x
	LDA.w #$0060
	STA.w $7A98,x
	LDY.b #$05
	STY.b $76,x
CODE_05E170:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_heading_cactus_state_ptr,x)
	RTL

CODE_05E179:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_05E1A3
	LDA.w #$00E5
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_05E1A3
	LDA.w $70E2,x
	STA.w $70E2,y
	STA.w $7A36,y
	LDA.w $7182,x
	DEC
	DEC
	STA.w $7182,y
	STY.b $18,x
	LDA.w #$0020
	STA.w $7A98,x
	INC.b $76,x
CODE_05E1A3:
	RTS

CODE_05E1A4:
	TYX
	LDY.b $18,x
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $7A98,x
	BNE.b CODE_05E1D6
	LDA.w #$0002
	STA.w $7A98,x
	LDA.w $7182,y
	DEC
	STA.w $7182,y
	SEC
	SBC.w $7182,x
	CMP.w #$FFF3
	BNE.b CODE_05E1D6
	LDA.w #$0020
	STA.w $7A98,x
	LDA.w #$0005
	STA.w $7A36,x
	INC.b $76,x
CODE_05E1D6:
	RTS

DATA_05E1D7:
	db $03,$04,$03,$02,$01

DATA_05E1DC:
	db $04,$04,$03,$02,$01

DATA_05E1E1:
	db $00,$08,$02,$01,$02

DATA_05E1E6:
	db $00,$00,$02,$01,$02

DATA_05E1EB:
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	db $F2,$F0,$EA,$E4,$E2
else
	db $F0,$EA,$E4,$E2
endif

CODE_05E1EF:
	TYX
	LDA.w $7A98,x
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	BEQ.b +
	JMP.w CODE_05E276

+:
else
	BNE.b CODE_05E206
endif
	DEC.w $7A36,x
	BPL.b CODE_05E217
	INC.b $78,x
	LDY.b $78,x
	CPY.b #$03
	BNE.b CODE_05E204
	STZ.b $78,x
CODE_05E204:
	INC.b $76,x
CODE_05E206:
	RTS

DATA_05E207:
	dw $FC00,$FBC0

DATA_05E20B:
	dw $FB00,$FA00

DATA_05E20F:
	dw $0020,$0030

DATA_05E213:
	dw $0300,$0300

CODE_05E217:
	LDY.w $7A36,x
	CPY.b #$01
	BNE.b CODE_05E24B
	PHY
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w DATA_05E20F,y
	STA.b $00
	LDA.w DATA_05E213,y
	STA.b $02
	LDA.w DATA_05E207,y
	LDY.b $78,x
	CPY.b #$02
	BNE.b CODE_05E23B
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w DATA_05E20B,y
CODE_05E23B:
	LDY.b $18,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.b $00
	STA.w $7542,y
	LDA.b $02
	STA.w $75E2,y
	PLY
CODE_05E24B:
	LDA.b $78,x
	CMP.w #$0002
	BEQ.b CODE_05E260
	LDA.w DATA_05E1D7,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_05E1E1,y
	BRA.b CODE_05E26C

CODE_05E260:
	LDA.w DATA_05E1DC,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_05E1E6,y
CODE_05E26C:
	AND.w #$00FF
	STA.w $7A98,x
	CPY.b #$01
	BMI.b CODE_05E288
CODE_05E276:
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	LDY.b $18,x
	LDA.w $7222,y
	BMI.b CODE_05E288
	LDY.w $7402,x
	LDA.w DATA_05E1EB,y
else
	LDY.w $7402,x
	LDA.w DATA_05E1EB-$01,y
endif
	LDY.b $18,x
	ORA.w #$FF00
	CLC
	ADC.w $7182,x
	STA.w $7182,y
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	LDA.w #$0000
	STA.w $7222,y
endif
CODE_05E288:
	RTS

DATA_05E289:
	dw $FFE2,$FFE4,$FFE4

CODE_05E28F:
	TYX
	LDA.b $78,x
	ASL
	TAY
	LDA.w DATA_05E289,y
	LDY.b $18,x
	CLC
	ADC.w $7182,x
	CMP.w $7182,y
	BPL.b CODE_05E2B6
	STA.w $7182,y
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	LDA.w #$0000
	STA.w $7222,y
else
	LDA.w #$0000
	STA.w $7542,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
endif
	LDA.w #$0002
	STA.w $7A98,x
	INC.b $76,x
CODE_05E2B6:
	RTS

DATA_05E2B7:
	db $F2,$F0,$EA,$E4
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	db $E4
endif

DATA_05E2BB:
	db $04,$01,$01,$01

DATA_05E2BF:
	db $10,$01,$01

CODE_05E2C2:
	TYX
	LDA.w $7A98,x
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	BEQ.b +
	LDY.w $7402,x
	BRA.b CODE_05E2F0

+:
else
	BNE.b CODE_05E2FF
endif
	DEC.w $7402,x
	LDY.w $7402,x
	BNE.b CODE_05E2DB
	LDA.w #$0005
	STA.w $7A36,x
	LDA.w #$0002
	STA.b $76,x
CODE_05E2DB:
	LDA.b $78,x
	CMP.w #$0002
	BNE.b CODE_05E2E7
	LDA.w DATA_05E2BF,y
	BRA.b CODE_05E2EA

CODE_05E2E7:
	LDA.w DATA_05E2BB,y
CODE_05E2EA:
	AND.w #$00FF
	STA.w $7A98,x
CODE_05E2F0:
	LDA.w DATA_05E2B7,y
	LDY.b $18,x
	ORA.w #$FF00
	CLC
	ADC.w $7182,x
	STA.w $7182,y
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	LDA.w #$0000
	STA.w $7222,y
endif
CODE_05E2FF:
	RTS

CODE_05E300:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_05E31C
	LDA.w #$0008
	STA.w $7A98,x
	DEC.w $7402,x
	BPL.b CODE_05E31C
	STZ.w $7402,x
	LDA.w #$0180
	STA.w $7A96,x
	STZ.b $76,x
CODE_05E31C:
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; MUDDY BUDDY (sprite $063).
; Raidenthequick: init_muddy_buddy / main_muddy_buddy.
; Mud-throwing enemy: splat-attack on Yoshi.
;=========================================================================
YI_NorSpr063_MuddyBuddy_Init:
init_muddy_buddy:                           ; Raidenthequick: init_muddy_buddy
;$05E31D
	JSL.l CODE_03AE60
	LDA.w #$0100
	STA.w $7A36,x
	STA.w $7A38,x
	JSR.w CODE_05E63A
	RTL

;---------------------------------------------------------------------------

DATA_05E32E:
DATA_muddy_buddy_state_ptr:                      ; 10-entry $76,x sub-state dispatch (Muddy Buddy $063)
	dw CODE_05E6F7                              ;  $0: idle / float
	dw CODE_05E75E                              ;  $1: shared (alt-of-$4)
	dw CODE_05E7AC                              ;  $2: charge attack
	dw CODE_05E7D5                              ;  $3: throw mud
	dw CODE_05E75E                              ;  $4: (shared with $1)
	dw CODE_05E82A                              ;  $5: post-throw recover
	dw CODE_05E85D                              ;  $6: hit-stun
	dw CODE_05E898                              ;  $7: post-hit drift
	dw CODE_05E898                              ;  $8: (shared)
	dw CODE_05E937                              ;  $9: defeat

DATA_05E342:
	dw $0200,$FE00

YI_NorSpr063_MuddyBuddy_Main:
main_muddy_buddy:                           ; Raidenthequick: main_muddy_buddy
;$05E346
	JSR.w CODE_05E3EE
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_05E358
	LDY.b $18,x
	BEQ.b CODE_05E358
	JSR.w CODE_05E524
CODE_05E358:
	JSL.l CODE_03AF23
	JSR.w CODE_05E6BD
	JSR.w CODE_05E6D9
	JSR.w CODE_05E44C
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_muddy_buddy_state_ptr,x)
	JSR.w CODE_05E63A
	CPX.w $61B6
	BNE.b CODE_05E379
	JSR.w CODE_05E67D
CODE_05E378:
	RTL

CODE_05E379:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_05E391

CODE_05E388:
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_05E391:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_05E378
	BEQ.b CODE_05E378
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05E388
	LDA.w $7D38,y
	BEQ.b CODE_05E388
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_05E3B4
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BCC.b CODE_05E3C3
CODE_05E3B4:
	LDA.w $6FA2,y
	AND.w #$4000
	BNE.b CODE_05E388
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	BRA.b CODE_05E388

CODE_05E3C3:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	BNE.b CODE_05E388
	PHX
	LDX.b #$00
	LDA.w $6000
	BPL.b CODE_05E3D2
	INX
	INX
CODE_05E3D2:
	LDA.l DATA_05E342,x
	PLX
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0040
	STA.w $7542,y
	LDA.w #$0001
	STA.w $7D38,y
	BRA.b CODE_05E388

CODE_05E3EE:
	LDA.w $7042,x
	AND.w #$FF00
	BNE.b CODE_05E447
	LDY.w $74A2,x
	BMI.b CODE_05E447
	JSL.l CODE_03AA52
	LDA.w $7680,x
	CLC
	ADC.w #$0004
	STA.b $00
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0002
	STA.b $02
	REP.b #$10
	LDY.w $7362,x
CODE_05E418:
	PHY
	LDA.w $6020,y
	SEC
	SBC.b $00
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEP.b #$10
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	PLY
	LDA.b $00
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $6020,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEC.b $02
	BNE.b CODE_05E418
	SEP.b #$10
	LDX.b $12
CODE_05E447:
	RTS

DATA_05E448:
	dw $0100,$FF00

CODE_05E44C:
	LDY.b $76,x
	CPY.b #$09
	BPL.b CODE_05E447
	LDA.w #$000E
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CLC
	ADC.w $6122
	STA.b $00
	CPX.w $61B6
	BNE.b CODE_05E47A
	JMP.w CODE_05E508

CODE_05E47A:
	LDY.b $76,x
	CPY.b #$05
	BMI.b CODE_05E483
	JMP.w CODE_05E524

CODE_05E483:
	LDY.w $7D36,x
	BPL.b CODE_05E447
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	SEC
	SBC.w $611E
	SEC
	SBC.b $00
	CMP.w #$FFF8
	BCS.b CODE_05E4CD
	LDY.w $77C2,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_05E4B6
	TYA
	CMP.w $7400,x
	BNE.b CODE_05E4B6
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w $60A8
	STA.w $60A8
	STA.w $60B4
CODE_05E4B6:
	LDA.w $60A8
	CLC
	ADC.w DATA_05E448,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0001
	STA.w $7D38,x
	RTS

CODE_05E4CD:
	LDY.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	BNE.b CODE_05E551
	LDY.w $61B6
	BNE.b CODE_05E551
	STX.w $61B6
	INC.b $18,x
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w $70E2,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$7440
	STA.w $6FA0,x
	LDA.w #$0401
	STA.w $6FA2,x
	LDA.w #$3105
	STA.w $7040,x
	STZ.w $7402,x
	LDA.w #$0008
	STA.w $7BB6,x
	STA.w $7BB8,x
	LDY.b #$05
	STY.b $76,x
CODE_05E508:
	LDY.w $0D94
	BNE.b CODE_05E51F
	LDY.w $7862,x
	BNE.b CODE_05E51F
	LDA.w $0035
	AND.w #$0400
	BNE.b CODE_05E524
	LDA.w $61D6
	BEQ.b CODE_05E552
CODE_05E51F:
	CPX.w $61B6
	BNE.b CODE_05E551
CODE_05E524:
	STZ.w $61B6
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.b $18,x
	LDA.w #$7480
	STA.w $6FA0,x
	LDA.w #$0C01
	STA.w $6FA2,x
	LDA.w #$3155
	STA.w $7040,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0006
	STA.w $7BB6,x
	STA.w $7BB8,x
	LDY.b #$09
	STY.b $76,x
CODE_05E551:
	RTS

CODE_05E552:
	LDA.w $611C
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $611E
	SEC
	SBC.w $6122
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_05E584
	LDY.w $7223,x
	BPL.b CODE_05E584
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_05E584:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_05E5B2
	LDA.w $60FC
	AND.w #$01E0
	BEQ.b CODE_05E5B2
	AND.w #$0180
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_05E5B2
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_05E5B2:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_05E5C1
	BPL.b CODE_05E5BE
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BRA.b CODE_05E5C1

CODE_05E5BE:
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_05E5C1:
	LDA.w $70E2,x
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $7182,x
	CLC
	ADC.w #$0012
	SEC
	SBC.b $00
	SEC
	SBC.w $611E
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $6084
	ORA.w #$0700
	EOR.w #$FFFF
	STA.b $00
	LDA.w $0035
	AND.b $00
	STA.w $617A
	LDA.w $0037
	AND.b $00
	STA.w $617C
	LDA.w $6150
	ORA.w $60DE
	BNE.b CODE_05E617
	LDA.w $0036
	AND.w #$0003
	BEQ.b CODE_05E617
	AND.w #$0002
	STA.w $60C4
	EOR.w #$0002
	STA.w $7400,x
CODE_05E617:
	LDA.w #!Define_YI_PlayerState02_InCutscene
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $60A8
	STZ.w $60AA
	STZ.w $60D4
	INC.w $61B4
	LDY.b #$40
	LDA.w $0035
	AND.w $6084
	BEQ.b CODE_05E635
	LDY.b #$20
CODE_05E635:
	TYA
	STA.w $7542,x
	RTS

CODE_05E63A:
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #(FXDATA_540000+$4000)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_540000+$4000
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
	RTS

CODE_05E67D:
	LDY.w $7223,x
	BMI.b CODE_05E6BC
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098F9C>>16
	LDA.w #FXCODE_098F9C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_05E68F:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_05E6BC
	BEQ.b CODE_05E6BC
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05E6BC
	LDA.w $7D38,y
	BNE.b CODE_05E6BC
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDA.w #!Define_YI_SoundID1D_ObjectLanding
	JSL.l CODE_push_sound_queue
	LDX.b #FXCODE_098FFE>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_05E68F

CODE_05E6BC:
	RTS

CODE_05E6BD:
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_05E6D8
	AND.w #$0008
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_05E6D8
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
CODE_05E6D8:
	RTS

CODE_05E6D9:
	CPX.w $61B6
	BNE.b CODE_05E6F2
	LDA.w $7680,x
	BMI.b CODE_05E6E8
	CMP.w #$00F0
	BMI.b CODE_05E6F2
CODE_05E6E8:
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_05E6F2:
	RTS

DATA_05E6F3:
	dw $FF00,$0100

CODE_05E6F7:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_05E71B
	LDA.b $11
	AND.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_05E6F3,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0020
	STA.w $7A96,x
	INC.b $76,x
	RTS

CODE_05E71B:
	LDY.w $77C2,x
	TYA
	CMP.w $7400,x
	BNE.b CODE_05E751
	LDA.w $7C16,x
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCS.b CODE_05E751
	LDA.w $7C18,x
	CLC
	ADC.w #$0030
	CMP.w #$0060
	BCS.b CODE_05E751
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0001
	STA.b $16,x
	LDA.w #$0008
	STA.w $7A96,x
	STZ.w $7402,x
	LDY.b #$02
	STY.b $76,x
CODE_05E751:
	RTS

DATA_05E752:
	db $02,$03,$04,$03,$03,$02,$01,$02,$02,$02,$02,$01

CODE_05E75E:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_05E779
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0020
	STA.w $7A96,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7402,x
	STZ.b $76,x
	RTS

CODE_05E779:
	LDY.b $76,x
	CPY.b #$04
	BEQ.b CODE_05E782
	JSR.w CODE_05E71B
CODE_05E782:
	LDA.w $7A98,x
	BNE.b CODE_05E7A9
	LDY.w $7402,x
	INY
	CPY.b #$07
	BMI.b CODE_05E791
	LDY.b #$01
CODE_05E791:
	TYA
	STA.w $7402,x
	LDY.b $76,x
	CPY.b #$04
	BNE.b CODE_05E7A0
	CLC
	ADC.w #$0006
	TAY
CODE_05E7A0:
	LDA.w DATA_05E752-$01,y
	AND.w #$00FF
	STA.w $7A98,x
CODE_05E7A9:
	RTS

DATA_05E7AA:
	db $0C,$00

CODE_05E7AC:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_05E7CE
	LDY.b $16,x
	LDA.w DATA_05E7AA,y
	TAY
	JSR.w CODE_05E9C6
	BNE.b CODE_05E7CE
	DEC.b $16,x
	BPL.b CODE_05E7CE
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0001
	STA.b $16,x
	INC.b $76,x
CODE_05E7CE:
	RTS

DATA_05E7CF:
	db $18,$24

DATA_05E7D1:
	dw $FE00,$0200

CODE_05E7D5:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05E80B
	STZ.w $7402,x
	LDY.b $16,x
	LDA.w DATA_05E7CF,y
	TAY
	JSR.w CODE_05E9C6
	BNE.b CODE_05E80A
	DEC.b $16,x
	BPL.b CODE_05E80A
	LDY.w $7400,x
	LDA.w DATA_05E7D1,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0020
	STA.w $7A96,x
	STZ.w $7402,x
	INC.b $76,x
CODE_05E80A:
	RTS

CODE_05E80B:
	LDY.b #$18
	JSR.w CODE_05E9C6
CODE_05E810:
	LDA.w $7A98,x
	BNE.b CODE_05E829
	LDY.w $7402,x
	INY
	CPY.b #$07
	BMI.b CODE_05E81F
	LDY.b #$01
CODE_05E81F:
	TYA
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7A98,x
CODE_05E829:
	RTS

CODE_05E82A:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05E84D
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.b $78,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7402,x
	LDY.b #$30
	JSR.w CODE_05E9C6
	BNE.b CODE_05E84C
	LDA.w #$0001
	STA.b $16,x
	INC.b $76,x
CODE_05E84C:
	RTS

CODE_05E84D:
	JSR.w CODE_05E909
	LDA.w $0035
	AND.w $6084
	BEQ.b CODE_05E84C
	JMP.w CODE_05E810

CODE_05E85B:
	RTS

DATA_05E85C:
	db $3C

CODE_05E85D:
	TYX
	LDY.b #$07
	LDA.w $0035
	BIT.w $6084
	BNE.b CODE_05E86E
	BIT.w #$0300
	BEQ.b CODE_05E876
	INY
CODE_05E86E:
	STY.b $76,x
	LDA.w #$0001
	STA.b $16,x
	RTS

CODE_05E876:
	LDA.b $78,x
	BEQ.b CODE_05E880
	CMP.w #$8000
	ROR
	STA.b $78,x
CODE_05E880:
	LDY.b $16,x
	BMI.b CODE_05E88F
	LDA.w DATA_05E85C-$01,y
	TAY
	JSR.w CODE_05E9C6
	BNE.b CODE_05E88F
	DEC.b $16,x
CODE_05E88F:
	RTS

DATA_05E890:
	db $54,$48,$78,$6C

DATA_05E894:
	dw $FB80,$FD00

CODE_05E898:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05E8D8
	LDA.b $16,x
	BMI.b CODE_05E8E2
	LDY.b $76,x
	CPY.b #$07
	BEQ.b CODE_05E8AF
	CLC
	ADC.w #$0002
CODE_05E8AF:
	TAY
	LDA.w DATA_05E890,y
	TAY
	JSR.w CODE_05E9C6
	BNE.b CODE_05E8D7
	DEC.b $16,x
	BPL.b CODE_05E8D7
	LDA.b $76,x
	SEC
	SBC.w #$0007
	ASL
	TAY
	LDA.w DATA_05E894,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID35_FrogHop
	JSL.l CODE_push_sound_queue
	LDA.b $78,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_05E8D7:
	RTS

CODE_05E8D8:
	JSR.w CODE_05E909
	LDY.b #$18
	JSR.w CODE_05E9C6
	BNE.b CODE_05E8E6
CODE_05E8E2:
	LDY.b #$05
	STY.b $76,x
CODE_05E8E6:
	LDA.w $0035
	AND.w $6084
	BEQ.b CODE_05E8D7
	JMP.w CODE_05E810

DATA_05E8F1:
	dw $0020,$FFE0,$0010,$FFF0

DATA_05E8F9:
	dw $0400,$FC00,$0200,$FE00

DATA_05E901:
	dw $FFFF,$0000,$FFFF,$0000

CODE_05E909:
	LDA.w $0036
	AND.w #$0003
	BEQ.b CODE_05E936
	AND.w #$0002
	CPY.b #$00
	BEQ.b CODE_05E91C
	CLC
	ADC.w #$0004
CODE_05E91C:
	TAY
	LDA.w DATA_05E8F1,y
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w DATA_05E8F9,y
	EOR.w DATA_05E901,y
	BPL.b CODE_05E936
	LDA.w DATA_05E8F9,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_05E936:
	RTS

CODE_05E937:
	TYX
	LDY.b #$18
	JSR.w CODE_05E9C6
	BNE.b CODE_05E941
	STZ.b $76,x
CODE_05E941:
	RTS

DATA_05E942:
	dw $0012,$01C0,$0024,$0012,$00A0,$0024,$000F,$00C0
	dw $001E,$000F,$0180,$001E,$000C,$0100,$0018,$000C
	dw $0100,$0018,$000C,$01C0,$0018,$000C,$00A0,$0018
	dw $0020,$01E0,$0040,$0020,$0040,$0040,$000C,$0100
	dw $0018,$000C,$0100,$0018,$0014,$00E0,$0028,$0014
	dw $0140,$0028,$0024,$0080,$0048,$0010,$0160,$0020
	dw $0008,$01C0,$0010,$0008,$0080,$0010,$0014,$00F0
	dw $0028,$0014,$0120,$0028,$0024,$00C0,$0048,$0010
	dw $0130,$0020

CODE_05E9C6:
	LDA.w #$0002
	STA.b $00
CODE_05E9CB:
	LDA.w $7A36,x
	CMP.w DATA_05E942+$02,y
	BEQ.b CODE_05E9EF
	BMI.b CODE_05E9DB
	SEC
	SBC.w DATA_05E942,y
	BRA.b CODE_05E9DF

CODE_05E9DB:
	CLC
	ADC.w DATA_05E942,y
CODE_05E9DF:
	STA.w $7A36,x
	SEC
	SBC.w DATA_05E942+$02,y
	CLC
	ADC.w DATA_05E942,y
	CMP.w DATA_05E942+$04,y
	BCS.b CODE_05E9F7
CODE_05E9EF:
	DEC.b $00
	LDA.w DATA_05E942+$02,y
	STA.w $7A36,x
CODE_05E9F7:
	CPX.b $12
	BNE.b CODE_05EA05
	INX
	INX
	TYA
	CLC
	ADC.w #$0006
	TAY
	BRA.b CODE_05E9CB

CODE_05EA05:
	LDX.b $12
	LDY.b $00
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; SPOOKY (sprite $119).
; Raidenthequick: init_spooky / main_spooky.
; Revolving group of ghost faces.
;=========================================================================
YI_NorSpr119_Spooky_Init:
init_spooky:                                ; Raidenthequick: init_spooky
;$05EA0A
	JSL.l CODE_03AE60
	LDA.w #$0004
	STA.w $7720,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	JSR.w CODE_05EC10
	RTL

;---------------------------------------------------------------------------

DATA_05EA1B:
	dw FXDATA_550000+$0040,FXDATA_550000+$0020,FXDATA_550000+$0000

DATA_05EA21:
DATA_spooky_state_ptr:                           ; 5-entry $76,x sub-state dispatch (Spooky $119)
	dw CODE_05EC54                              ;  0: revolving idle
	dw CODE_05ECF2                              ;  1: pause / phase prep
	dw CODE_05ED3A                              ;  2: charge swap
	dw CODE_05EDFD                              ;  3: split / re-form
	dw CODE_05EC54                              ;  4: (re-uses idle)

YI_NorSpr119_Spooky_Main:
main_spooky:                                ; Raidenthequick: main_spooky
;$05EA2B
	JSR.w CODE_05EB40
	LDY.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CPY.b #$08
	BEQ.b CODE_05EA60
	CPY.b #$0C
	BEQ.b CODE_05EA4E
	CPY.b #$06
	BEQ.b CODE_05EA40
	JMP.w CODE_05EAAF

CODE_05EA40:
	LDY.b $78,x
	BEQ.b CODE_05EA4B
	JSR.w CODE_05EBD0
	JSL.l CODE_06BEC1
CODE_05EA4B:
	JMP.w CODE_05EAAF

CODE_05EA4E:
	LDY.b $78,x
	BEQ.b CODE_05EA57
	JSR.w CODE_05EF52
	BRA.b CODE_05EA5A

CODE_05EA57:
	JSR.w CODE_05EEF7
CODE_05EA5A:
	PLA
	PLY
	JML.l CODE_03A31E

CODE_05EA60:
	LDY.w $6150
	CPY.b #$03
	BEQ.b CODE_05EA6B
	CPY.b #$04
	BNE.b CODE_05EA96
CODE_05EA6B:
	LDY.b $78,x
	BEQ.b CODE_05EA78
	LDA.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	JSR.w CODE_05EBD0
CODE_05EA78:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05EA8A
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
CODE_05EA8A:
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.w $6162
	PLA
	PLY
	RTL

CODE_05EA96:
	LDY.b $18,x
	BNE.b CODE_05EAAC
	LDA.w #$3101
	STA.w $7040,x
	LDY.b $78,x
	BEQ.b CODE_05EAA9
	JSR.w CODE_05EF52
	BRA.b CODE_05EAAC

CODE_05EAA9:
	JSR.w CODE_05EEF7
CODE_05EAAC:
	JSR.w CODE_05EF9F
CODE_05EAAF:
	JSL.l CODE_03AF23
	LDY.b $76,x
	CPY.b #$03
	BEQ.b CODE_05EAD7
	CPY.b #$02
	BNE.b CODE_05EAD3
	LDY.w $7223,x
	BMI.b CODE_05EAD3
	LDA.w $7C16,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_05EAD3
	LDA.w $7C18,x
	BMI.b CODE_05EAD7
CODE_05EAD3:
	JSL.l CODE_03A5B7
CODE_05EAD7:
	JSR.w CODE_05EBA4
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_spooky_state_ptr,x)
	SEP.b #$20
	LDA.w $7A98,x
	BNE.b CODE_05EAF8
	LDA.b #$08
	STA.w $7A98,x
	DEC.b $19,x
	DEC.b $19,x
	BPL.b CODE_05EAF8
	LDY.b #$04
	STY.b $19,x
CODE_05EAF8:
	REP.b #$20
	LDA.w $7540,x
	BEQ.b CODE_05EB13
	ASL
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w $7540,x
	CMP.b $00
	BCS.b CODE_05EB13
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_05EB13:
	LDY.b $79,x
	BNE.b CODE_05EB3C
	LDA.w $7974
	AND.w #$0003
	BNE.b CODE_05EB3C
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEC
	CLC
	ADC.w $7720,x
	BMI.b CODE_05EB2E
	CMP.w #$000C
	BMI.b CODE_05EB39
CODE_05EB2E:
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	EOR.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	PLA
CODE_05EB39:
	STA.w $7720,x
CODE_05EB3C:
	JSR.w CODE_05EBFC
	RTL

CODE_05EB40:
	LDY.w $7402,x
	BNE.b CODE_05EBA3
	JSL.l CODE_03AA52
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w $7400,x
	BEQ.b CODE_05EB6F
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	EOR.w #$FFFF
	INC
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
CODE_05EB6F:
	LDA.w #$FFF8
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	REP.b #$10
	LDY.w $7362,x
	LDA.w #$0004
	STA.b $00
CODE_05EB83:
	LDA.w $6000,y
	CLC
	ADC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $6000,y
	LDA.w $6002,y
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $6002,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEC.b $00
	BNE.b CODE_05EB83
	SEP.b #$10
CODE_05EBA3:
	RTS

CODE_05EBA4:
	JSL.l CODE_03A2C7
	BCC.b CODE_05EBB3
	LDY.b $78,x
	BNE.b CODE_05EBB8
	PLA
	JML.l CODE_03A31E

CODE_05EBB3:
	LDY.b $78,x
	BNE.b CODE_05EBBE
	RTS

CODE_05EBB8:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_05EBBE:
	LDA.w $61CC
	BNE.b CODE_05EBD0
	LDA.w $70E2,x
	STA.w $70E2
	LDA.w $7182,x
	STA.w $7182
	RTS

CODE_05EBD0:
	LDY.b #$04
	STY.w $74A2
	STZ.w $7AF8
	STZ.w $7860
	LDA.w #$B220
	STA.w $6FA0
	STZ.b $18
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	LDA.w $61B2
	AND.w #$0FFF
	STA.w $61B2
	LDY.b #$00
	STY.b $78,x
	STY.b $76,x
	LDA.w #$0020
	STA.w $7AF6,x
	RTS

CODE_05EBFC:
	LDY.w $7402,x
	BNE.b CODE_05EC4B
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0001
	BNE.b CODE_05EC4B
CODE_05EC10:
	LDY.b $19,x
	LDA.w DATA_05EA1B,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$0000)>>16
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
CODE_05EC4B:
	RTS

DATA_05EC4C:
	dw $FF00,$0100

DATA_05EC50:
	dw $FE80,$0180

CODE_05EC54:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_05EC77
	STZ.w $7AF6,x
	STZ.w $7AF8,x
	LDA.w $7A38,x
	BEQ.b CODE_05EC6E
	CLC
	ADC.w #$0002
	CMP.w #$0004
	BCS.b CODE_05EC80
CODE_05EC6E:
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_05EC77:
	LDY.w $7400,x
	LDA.w DATA_05EC4C,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_05EC80:
	JSR.w CODE_05EE64
	LDY.b $76,x
	BNE.b CODE_05ECDF
	LDA.w $7400,x
	DEC
	EOR.w $7C16,x
	BPL.b CODE_05ECDF
	LDA.w $7C16,x
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_05ECDF
	LDA.w $7C18,x
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_05ECDF
	LDA.w $7A38,x
	CLC
	ADC.w #$0020
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDY.w $7400,x
	LDA.w DATA_05EC50,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $75E2,x
	LDA.w #$0008
	STA.w $7542,x
	LSR
	STA.w $7540,x
	LDA.w #$FE80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$8C83
	STA.w $6FA2,x
	INC.b $79,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $7720,x
	INC.b $76,x
	RTS

CODE_05ECDF:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05ECF1
	LDA.w #$8E83
	STA.w $6FA2,x
	LDY.b #$00
	STY.b $79,x
CODE_05ECF1:
	RTS

CODE_05ECF2:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCS.b CODE_05ED0B
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	INC.b $76,x
	RTS

CODE_05ED0B:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0180
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0040
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDX.b #FXCODE_08A320>>16
	LDA.w #FXCODE_08A320
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEC
	SBC.w #$0020
	AND.w #$01FE
	STA.w $7A38,x
	RTS

CODE_05ED3A:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w #$0010
	CMP.w #$0110
	BEQ.b CODE_05ED68
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STZ.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDX.b #FXCODE_08A320>>16
	LDA.w #FXCODE_08A320
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $7A38,x
	RTS

CODE_05ED68:
	LDA.w #$0200
	STA.w $75E2,x
	LDA.w #$0020
	STA.w $7542,x
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05ED92
	LDY.w $7400,x
	LDA.w DATA_05EC4C,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$8E83
	STA.w $6FA2,x
	LDY.b #$00
	STY.b $79,x
	STZ.b $76,x
	RTS

CODE_05ED92:
	LDA.w $7C16,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_05EDF4
	LDA.w $7C18,x
	BPL.b CODE_05EDF4
	CMP.w #$FFE8
	BMI.b CODE_05EDF4
	LDA.w $61B2
	BPL.b CODE_05EDF4
	AND.w #$0FFF
	ORA.w #$4000
	STA.w $61B2
	LDA.w #!Define_YI_SoundID3C_InedibleObject
	JSL.l CODE_push_sound_queue
	LDA.w #$FFFF
	STA.w $7AF8
	STA.w $7E48
	LDA.w #$0004
	STA.b $76
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	LDY.b #$FF
	STY.w $74A2
	STX.b $18
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	LDA.w #$B260
	STA.w $6FA0
	LDA.w #$604F
	STA.w $6FA2
	INC.b $78,x
	LDA.w #$0020
	STA.w $7A96,x
	STA.w $61EC
	INC.b $76,x
CODE_05EDF4:
	RTS

DATA_05EDF5:
	dw $0006,$FFFA

DATA_05EDF9:
	dw $FF00,$0100

CODE_05EDFD:
	TYX
	LDA.w $60C4
	STA.w $7400,x
	LDA.w $7A96,x
	BNE.b CODE_05EE2A
	STA.w $61EC
	LDA.w #$0080
	STA.w $61D6
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_05EDF9,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
CODE_05EE2A:
	LDA.w $0035
	AND.w #$CFF0
	CMP.w $0D98
	BEQ.b CODE_05EE44
	STA.w $0D98
	LDA.w $7A96,x
	SEC
	SBC.w #$0002
	BMI.b CODE_05EE44
	STA.w $7A96,x
CODE_05EE44:
	LDY.w $60C4
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_05EDF5,y
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0006
	STA.w $7182,x
	RTS

DATA_05EE5C:
	dw $0002,$FFFE

DATA_05EE60:
	dw $0020,$01E0

CODE_05EE64:
	LDA.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	AND.w #$00FF
	BEQ.b CODE_05EEAA
	ASL
	LDY.w $7400,x
	BEQ.b CODE_05EE79
	EOR.w #$FFFF
	INC
	AND.w #$01FE
CODE_05EE79:
	STA.b $00
	CMP.w $7A38,x
	BEQ.b CODE_05EEA9
	LDY.b #$00
	LDA.b $00
	SEC
	SBC.w $7A38,x
	PHP
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCS.b CODE_05EE97
	PLP
	BPL.b CODE_05EE9C
	BRA.b CODE_05EE9A

CODE_05EE97:
	PLP
	BMI.b CODE_05EE9C
CODE_05EE9A:
	INY
	INY
CODE_05EE9C:
	LDA.w $7A38,x
	CLC
	ADC.w DATA_05EE5C,y
	AND.w #$01FE
	STA.w $7A38,x
CODE_05EEA9:
	RTS

CODE_05EEAA:
	LDA.w $7AF6,x
	ORA.w $7AF8,x
	BNE.b CODE_05EEF2
	LDA.w #$0002
	STA.w $7AF8,x
	LDY.b $16,x
	LDA.w $7A38,x
	CLC
	ADC.w DATA_05EE5C,y
	AND.w #$01FE
	BIT.w #$0100
	BEQ.b CODE_05EECC
	ORA.w #$FF00
CODE_05EECC:
	CPY.b #$00
	BNE.b CODE_05EED7
	CMP.w #$0020
	BMI.b CODE_05EEEC
	BRA.b CODE_05EEDC

CODE_05EED7:
	CMP.w #$FFE0
	BPL.b CODE_05EEEC
CODE_05EEDC:
	LDA.b $16,x
	EOR.w #$0002
	STA.b $16,x
	LDA.w #$0020
	STA.w $7AF6,x
	LDA.w DATA_05EE60,y
CODE_05EEEC:
	AND.w #$01FE
	STA.w $7A38,x
CODE_05EEF2:
	RTS

DATA_05EEF3:
	dw $FFF8,$0008

CODE_05EEF7:
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	TAY
	LDA.w DATA_05EEF3,y
	STA.b $04
	LDA.w #$001E
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_05EF30
	LDA.w $70E2,x
	CLC
	ADC.b $04
	STA.w $70E2,y
	LDA.w $7182,x
	AND.w #$FFF0
	STA.w $7182,y
	LDA.w $7400,x
	STA.w $7400,y
	LDA.w #$0001
	STA.w $7D38,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
CODE_05EF30:
	LDA.w $6152
	STA.w $7A36,x
	STZ.w $6164
	LDA.w #$FFFC
	STA.w $6166
	LDA.w #$0001
	STA.w $7402,x
	LDA.w #$0005
	STA.w $74A2,x
	INC.b $18,x
	RTS

DATA_05EF4E:
	dw $FFF8,$0008

CODE_05EF52:
	JSL.l CODE_06BEBA
	LDY.b #$04
	STY.w $74A2
	STZ.b $18
	LDY.w $7400,x
	LDA.w DATA_05EF4E,y
	STA.b $00
	LDA.w #$0020
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_05EF30
	LDA.w $70E2,x
	CLC
	ADC.b $00
	STA.w $70E2,y
	STA.b $04
	LDA.w $7182,x
	AND.w #$FFF0
	CLC
	ADC.w #$0010
	STA.w $7182,y
	STA.b $06
	JSL.l CODE_048D5F
	JMP.w CODE_05EF30

DATA_05EF8F:
	dw $0008,$FFF8

DATA_05EF93:
	dw $0008,$FFF8

DATA_05EF97:
	dw $FFF8,$0008,$FFE8,$0018

CODE_05EF9F:
	LDA.w $60C4
	AND.w #$0002
	TAY
	STA.w $7400,x
	LDA.w $7402,x
	CMP.w #$0003
	BMI.b CODE_05EFB4
	JMP.w CODE_05F020

CODE_05EFB4:
	LDA.w $6152
	BEQ.b CODE_05EFD8
	CLC
	ADC.w #$0008
	CMP.w #$0010
	BCS.b CODE_05EFCA
	LDA.w DATA_05EF8F,y
	STA.w $6152
	BRA.b CODE_05EFD8

CODE_05EFCA:
	LDA.w $6152
	SEC
	SBC.w $7A36,x
	CLC
	ADC.w $6164
	STA.w $6164
CODE_05EFD8:
	LDA.w $7A98,x
	BNE.b CODE_05EFEE
	LDA.w #$0002
	STA.w $7A98,x
	INC.w $7402,x
	LDA.w $7402,x
	CMP.w #$0003
	BEQ.b CODE_05EFF1
CODE_05EFEE:
	JMP.w CODE_05F074

CODE_05EFF1:
	LDA.w $6164
	CLC
	ADC.w $6152
	PHA
	AND.w #$8000
	STA.b $06
	PLA
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCC.b CODE_05F011
	LDA.w $6152
	EOR.b $06
	BMI.b CODE_05F072
	BRA.b CODE_05F074

CODE_05F011:
	INC.w $7402,x
	LDA.w $6152
	EOR.b $06
	BPL.b CODE_05F074
	INC.w $7402,x
	BRA.b CODE_05F074

CODE_05F020:
	LDA.w $6152
	BEQ.b CODE_05F074
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_05F044
	LDA.w DATA_05EF8F,y
	STA.w $6152
	LDA.w $6164
	CLC
	ADC.w DATA_05EF97,y
	STA.w $6164
	CLC
	ADC.w DATA_05EF93,y
	BRA.b CODE_05F04B

CODE_05F044:
	LDA.w $6164
	CLC
	ADC.w $6152
CODE_05F04B:
	PHA
	AND.w #$8000
	STA.b $06
	PLA
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_05F06B
	LDY.b #$04
	LDA.w $6152
	EOR.b $06
	BPL.b CODE_05F065
	INY
CODE_05F065:
	TYA
	STA.w $7402,x
	BRA.b CODE_05F074

CODE_05F06B:
	LDA.w $6152
	EOR.b $06
	BPL.b CODE_05F074
CODE_05F072:
	PLA
	RTL

CODE_05F074:
	LDA.w $6152
	STA.w $7A36,x
	RTS

;---------------------------------------------------------------------------

DATA_05F07B:
	dw $0480,$0240

;=========================================================================
; ARROW WHEEL (sprites $11E Brown / $11F Blue).
; Raidenthequick: init_arrow_wheel / main_arrow_wheel.
; Rotating wheel ride; arrow buttons spin it.
;=========================================================================
YI_NorSpr11E_BrownArrowWheel_Init:
YI_NorSpr11F_BlueArrowWheel_Init:
init_arrow_wheel:                           ; Raidenthequick: init_arrow_wheel
;$05F07F
	JSL.l CODE_03AE60
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr11E_BrownArrowWheel
	ASL
	TAY
	LDA.w DATA_05F07B,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0100
	STA.w $7A36,x
	JSR.w CODE_05F3B6
	RTL

;---------------------------------------------------------------------------

YI_NorSpr11E_BrownArrowWheel_Main:
YI_NorSpr11F_BlueArrowWheel_Main:
main_arrow_wheel:                           ; Raidenthequick: main_arrow_wheel
;$05F09F
	STZ.w $7400,x
	JSL.l CODE_03AA52
	JSL.l CODE_05F0FA
	JSR.w CODE_05F0F3
	JSR.w CODE_05F1F6
	JSR.w CODE_05F2F6
	JSR.w CODE_05F34C
	JSR.w CODE_05F3B6
	LDY.b $18,x
	BEQ.b CODE_05F0F2
	LDA.w $7A96,x
	BNE.b CODE_05F0F2
	LDA.w $7A98,x
	BNE.b CODE_05F0E2
	LDA.w $7A36,x
	SEC
	SBC.w #$0020
	STA.w $7A36,x
	CMP.w #$0010
	BPL.b CODE_05F0E2
	CPX.w $61B6
	BNE.b CODE_05F0DE
	STZ.w $61B6
CODE_05F0DE:
	JML.l CODE_03A31E

CODE_05F0E2:
	LDY.b #$FF
	LDA.w $7974
	AND.w #$0001
	BNE.b CODE_05F0EE
	LDY.b #$05
CODE_05F0EE:
	TYA
	STA.w $74A2,x
CODE_05F0F2:
	RTL

CODE_05F0F3:
	JSL.l CODE_03A2F8
	BCS.b CODE_05F113
	RTS

CODE_05F0FA:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_05F112
	LDY.w $7D38,x
	BNE.b CODE_05F115
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_05F114
CODE_05F112:
	PLY
CODE_05F113:
	PLA
CODE_05F114:
	RTL

CODE_05F115:
	LDA.w #$0040
	STA.w $7540,x
	STZ.w $75E0,x
	STZ.w $75E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_05F133
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
CODE_05F133:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_05F145
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
CODE_05F145:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ORA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_05F18C
	LDY.w $7D36,x
	DEY
	BMI.b CODE_05F1BB
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05F1BB
	LDA.w $6FA0,y
	AND.w #$0020
	BNE.b CODE_05F1BB
	PHY
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	PLY
	LDA.w #$0000
	STA.w $7540,y
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDX.b $12
	LDA.w #$0040
	STA.w $7542,y
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	JSL.l CODE_03B53D
CODE_05F18C:
	JSL.l CODE_03AEFD
	LDA.b $78,x
	PHA
	LDA.w $7A36,x
	PHA
	LDA.w $7A38,x
	PHA
	TXY
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	JSL.l CODE_spawn_sprite
	PLA
	STA.w $7A38,x
	PLA
	STA.w $7A36,x
	PLA
	STA.b $78,x
	LDA.w #CODE_spr_state_init_entry
	STA.b $00
	LDA.w #CODE_spr_state_init_entry>>16
	STA.b $02
	JMP.w [$7960]

CODE_05F1BB:
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_05F1CF
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_05F1E6

CODE_05F1CF:
	LDA.w $7860,x
	AND.w #$0003
	BEQ.b CODE_05F1E6
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
	BRA.b CODE_05F18C

CODE_05F1E6:
	PLY
	PLA
	RTL

;---------------------------------------------------------------------------

DATA_05F1E9:
	db $00,$00,$00,$01,$01,$01,$03,$03,$04,$05,$06,$07,$08

CODE_05F1F6:
	LDY.w $60AB
	BMI.b CODE_05F200
	LDY.w $0D94
	BEQ.b CODE_05F203
CODE_05F200:
	JMP.w CODE_05F2D6

CODE_05F203:
	CPX.w $61B6
	BNE.b CODE_05F223
	LDA.w $60FC
	AND.w #$01E0
	BEQ.b CODE_05F219
	AND.w #$0180
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_05F223
CODE_05F219:
	LDA.w $7C16,x
	SEC
	SBC.w $72C0,x
	STA.w $7C16,x
CODE_05F223:
	LDA.w $7C16,x
	CLC
	ADC.w #$000C
	CMP.w #$0018
	BCS.b CODE_05F200
	LDA.w $7C16,x
	BPL.b CODE_05F238
	EOR.w #$FFFF
	INC
CODE_05F238:
	STA.b $16,x
	TAY
	LDA.w DATA_05F1E9,y
	AND.w #$00FF
	CPX.w $61B6
	BNE.b CODE_05F254
	SEC
	SBC.w #$0027
	SEC
	SBC.w $6112
	CLC
	ADC.w $7182,x
	BRA.b CODE_05F29B

CODE_05F254:
	CLC
	ADC.w $7C18,x
	SEC
	SBC.w $6112
	STA.b $00
	CMP.w #$001B
	BPL.b CODE_05F2D6
	CMP.w #$0012
	BMI.b CODE_05F2D6
	LDY.w $61B6
	BEQ.b CODE_05F270
	JMP.w CODE_05F2DE

CODE_05F270:
	STX.w $61B6
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr11F_BlueArrowWheel
	BNE.b CODE_05F28D
	LDY.b $18,x
	BNE.b CODE_05F28D
	LDA.w #$018B
	STA.w $7A96,x
	LDA.w #$0200
	STA.w $7A98,x
	INC.b $18,x
CODE_05F28D:
	LDA.b $00
	SEC
	SBC.w #$001B
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C2,x
CODE_05F29B:
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC.w $61B4
	STZ.w $60AA
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C0,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $60FC
	BIT.w #$0018
	BEQ.b CODE_05F2C4
	AND.w #$01E0
	BNE.b CODE_05F2C4
	LDA.w $7860,x
	ORA.w #$0002
	STA.w $7860,x
CODE_05F2C4:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr120_DoubledSidedArrowLift
	BEQ.b CODE_05F2F5
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTS

CODE_05F2D6:
	CPX.w $61B6
	BNE.b CODE_05F2DE
	STZ.w $61B6
CODE_05F2DE:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr120_DoubledSidedArrowLift
	BEQ.b CODE_05F2F5
	SEC
	SBC.w #!Define_YI_NorSpr11E_BrownArrowWheel
	ASL
	TAY
	LDA.w DATA_05F07B,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_05F2F5:
	RTS

CODE_05F2F6:
	LDA.b $78,x
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	PHA
	AND.w #$FE00
	XBA
	EOR.w #$FFFF
	INC
	CLC
	ADC.w $7A38,x
	AND.w #$01FE
	STA.w $7A38,x
	PLA
	AND.w #$01FF
	STA.b $78,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.b $75,x
	AND.w #$0100
	CLC
	ADC.w $7A38,x
	AND.w #$01FE
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_05F34C:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_05F37B
	LDA.w $7860,x
	AND.w #$0003
	BEQ.b CODE_05F37B
	DEC
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_05F37B
	LDA.w $7A38,x
	EOR.w #$FFFF
	INC
	SEC
	SBC.w #$0100
	AND.w #$01FE
	STA.w $7A38,x
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
CODE_05F37B:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_05F3A8
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_05F3A8
	SEC
	SBC.w #$0008
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_05F3A8
	LDA.w $7A38,x
	EOR.w #$FFFF
	INC
	AND.w #$01FE
	STA.w $7A38,x
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
CODE_05F3A8:
	RTS

CODE_05F3A9:
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #FXDATA_550000+$4000
	LDY.b #(FXDATA_550000+$4000)>>16
	BRA.b CODE_05F3C1

CODE_05F3B6:
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #FXDATA_540000+$2061
	LDY.b #(FXDATA_540000+$2061)>>16
CODE_05F3C1:
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	TYA
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A38,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
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

;=========================================================================
; DOUBLE-SIDED ARROW LIFT (sprite $120).
; Raidenthequick: init_double_ended_arrow_lift / main_double_ended_arrow_lift.
; Platform that travels back and forth between arrow markers.
;=========================================================================
YI_NorSpr120_DoubledSidedArrowLift_Init:
init_double_ended_arrow_lift:               ; Raidenthequick: init_double_ended_arrow_lift
;$05F3F0
	JSL.l CODE_03AE60
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	INC
	BEQ.b CODE_05F40B
	INC
	BEQ.b CODE_05F405
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	AND.w #$0010
	BEQ.b CODE_05F40B
CODE_05F405:
	LDA.w #$0020
	STA.w $7042,x
CODE_05F40B:
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w $7A36,x
	SEC
	SBC.w $7A38,x
	BEQ.b CODE_05F428
	AND.w #$00FF
	BEQ.b CODE_05F422
	LDY.b #$01
	STY.b $18,x
	BRA.b CODE_05F428

CODE_05F422:
	LDA.w $7A36,x
	STA.w $7A38,x
CODE_05F428:
	LDA.w #$0340
	STA.w $75E2,x
	JSR.w CODE_05F3A9
	RTL

;---------------------------------------------------------------------------

DATA_05F432:
DATA_double_arrow_lift_state_ptr:                ; 2-entry $18,x sub-state dispatch
	dw CODE_05F52E                              ;  0: idle / waiting
	dw CODE_05F57D                              ;  1: travel toward target

YI_NorSpr120_DoubledSidedArrowLift_Main:
main_double_ended_arrow_lift:               ; Raidenthequick: main_double_ended_arrow_lift
;$05F436
	STZ.w $7400,x
	JSL.l CODE_03AA52
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_05F45B
	LDY.w $74A2,x
	BPL.b CODE_05F45B
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w $7A36,x
	AND.w #$0040
	BEQ.b CODE_05F45B
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_05F45B:
	JSL.l CODE_05F0FA
	JSR.w CODE_05F0F3
	JSR.w CODE_05F1F6
	JSR.w CODE_05F2F6
	JSR.w CODE_05F34C
	JSR.w CODE_05F47B
	TXY
	LDA.b $18,x
	ASL
	TAX
	JSR.w (DATA_double_arrow_lift_state_ptr,x)
	JSR.w CODE_05F3A9
	RTL

CODE_05F47A:
	RTS

CODE_05F47B:
	LDA.w $7A96,x
	BNE.b CODE_05F47A
	LDY.w $7D36,x
	DEY
	BMI.b CODE_05F47A
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05F47A
	LDA.w $7D38,y
	BEQ.b CODE_05F47A
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	PHY
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	PLY
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	PHA
	LDA.w $7C76,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7C78,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	PLA
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	PHP
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCS.b CODE_05F4F9
	PLP
	BPL.b CODE_05F4FC
	BRA.b CODE_05F501

CODE_05F4F9:
	PLP
	BPL.b CODE_05F501
CODE_05F4FC:
	LDA.w #$F000
	BRA.b CODE_05F504

CODE_05F501:
	LDA.w #$1000
CODE_05F504:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	PHP
	LDA.w $7A38,x
	LDY.b $18,x
	BEQ.b CODE_05F512
	LDA.w $7A36,x
CODE_05F512:
	PLP
	BPL.b CODE_05F51B
	CLC
	ADC.w #$0080
	BRA.b CODE_05F51F

CODE_05F51B:
	SEC
	SBC.w #$0080
CODE_05F51F:
	AND.w #$01FE
	STA.w $7A36,x
	INY
	INY
	STY.b $77,x
	LDY.b #$01
	STY.b $18,x
	RTS

CODE_05F52E:
	TYX
	LDA.w $75E2,x
	CLC
	ADC.w $75E0,x
	PHA
	AND.w #$00FF
	STA.w $75E0,x
	PLA
	AND.w #$FF00
	BPL.b CODE_05F546
	ORA.w #$00FF
CODE_05F546:
	XBA
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BPL.b CODE_05F55F
	LDA.b $76,x
	EOR.w #$0001
	STA.b $76,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.w $75E0,x
	BRA.b CODE_05F572

CODE_05F55F:
	CMP.w #$0100
	BMI.b CODE_05F57C
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.w $75E0,x
	CPX.w $61B6
	BEQ.b CODE_05F57C
CODE_05F572:
	LDA.w $75E2,x
	EOR.w #$FFFF
	INC
	STA.w $75E2,x
CODE_05F57C:
	RTS

CODE_05F57D:
	TYX
	LDA.w $7A38,x
	SEC
	SBC.w $7A36,x
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_05F5A6
	LDY.b $77,x
	DEY
	STY.b $77,x
	BPL.b CODE_05F5A6
	LDA.w $7A36,x
	STA.w $7A38,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.b $18,x
CODE_05F5A6:
	RTS

;---------------------------------------------------------------------------

DATA_05F5A7:
	dw $0100,$00A0,$0060

;=========================================================================
; POW BLOCK (sprite $097).
; Raidenthequick: init_POW / main_pow_block.
; Hits with egg cause screen-wide enemy clear.
;=========================================================================
YI_NorSpr097_POWBlock_Init:
init_POW:                                   ; Raidenthequick: init_POW
;$05F5AD
	LDY.w $0E25
	CPY.b #$06
	BNE.b CODE_05F5B8
	JML.l CODE_03A31E

CODE_05F5B8:
	JSL.l CODE_03AE60
	LDY.w $0E25
	LDA.w DATA_05F5A7,y
	STA.w $7A36,x
	STZ.w $7400,x
	JSR.w CODE_05F67D
	RTL

;---------------------------------------------------------------------------

DATA_05F5CC:
DATA_pow_block_state_ptr:                        ; 3-entry $76,x sub-state dispatch (POW Block $097)
	dw CODE_0580C2                              ;  0: idle (GSU delta-facing stub)
	dw CODE_05F6BF                              ;  1: detonate -- spawn screen-wide kill effect
	dw CODE_0580C2                              ;  2: post-detonate (stub)

YI_NorSpr097_POWBlock_Main:
main_pow_block:                             ; Raidenthequick: main_pow_block
;$05F5D2
	JSL.l CODE_03AA52
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_pow_block_state_ptr,x)
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0003
	BNE.b CODE_05F5F4
	JSR.w CODE_05F67D
CODE_05F5F4:
	LDA.w #$0E00
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0010
	STA.b $0A
	STZ.b $02
	LDY.b #$02
	STY.b $09
	LDY.b #$00
	STZ.b $06
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A36,x
	JSL.l CODE_059C6F
	LDY.b $04
	BNE.b CODE_05F629
	LDY.b $76,x
	CPY.b #$02
	BNE.b CODE_05F628
	STZ.b $76,x
CODE_05F628:
	RTL

CODE_05F629:
	CPY.b #$04
	BNE.b CODE_05F628
	LDY.b $76,x
	BNE.b CODE_05F628
	LDA.w #$0020
	STA.w $61C6
	JSL.l CODE_0294B4
	INC.b $76,x
	LDA.w #!Define_YI_SoundID1F_HitHead
	JSL.l CODE_push_sound_queue
	INC.w $0E25
	INC.w $0E25
	LDY.w $0E25
	CPY.b #$06
	BNE.b CODE_05F67C
	LDA.w #!Define_YI_AmbSpr1D4
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7142,y
	LDA.w #$000B
	STA.w $7E4C,y
	LDA.w #$0006
	STA.w $7782,y
	JSL.l CODE_03AEFD
	JSL.l CODE_03A31E
CODE_05F67C:
	RTL

CODE_05F67D:
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STZ.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #(FXDATA_548000+$60A0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_548000+$60A0
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

CODE_05F6BF:
	TYX
	LDY.w $0E25
	LDA.w $7A36,x
	CMP.w DATA_05F5A7,y
	BPL.b CODE_05F6D2
	INC.b $76,x
	LDA.w DATA_05F5A7,y
	BRA.b CODE_05F6D6

CODE_05F6D2:
	SEC
	SBC.w #$0010
CODE_05F6D6:
	STA.w $7A36,x
	RTS

;---------------------------------------------------------------------------

DATA_05F6DA:
	dw $FFC0,$0040

;=========================================================================
; FLOPSY FISH (sprites $141 swim+arc / $142 3-jump).
; Raidenthequick: init_flopsy_fish_jumps / main_flopsy_fish_jumps.
; Water enemy: $141 swims and arc-jumps; $142 performs 3-jump pattern.
;=========================================================================
YI_NorSpr141_SwimmingAndArcJumpingFlopsyFish_Init:
YI_NorSpr142_3JumpFlopsyFish_Init:
init_flopsy_fish_jumps:                     ; Raidenthequick: init_flopsy_fish_jumps
;$05F6DE
	SEP.b #$20
	LDA.b #$FF
	STA.w $7863,x
	REP.b #$20
	LDA.w $7182,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w $70E2,x
	PHA
	SEC
	SBC.w $6094
	STA.b $00
	PLA
	AND.w #$0010
	EOR.w #$0010
	LSR
	LSR
	LSR
	STA.w $7400,x
	LDY.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CPY.b #!Define_YI_NorSpr041_Stork
	BEQ.b CODE_05F737
	LDA.b $00
	LDY.w $7400,x
	BNE.b CODE_05F719
	CMP.w #$0120
	BMI.b CODE_05F733
	BRA.b CODE_05F71E

CODE_05F719:
	CMP.w #$FFE0
	BPL.b CODE_05F733
CODE_05F71E:
	JSL.l CODE_03AE60
	LDY.b #$03
	STY.b $16,x
	JSR.w CODE_05F872
	LDY.w $7400,x
	LDA.w DATA_05F84C,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTL

CODE_05F733:
	JML.l CODE_03A31E

CODE_05F737:
	TAY
	LDA.w $70E2,x
	CLC
	ADC.w DATA_05F6DA,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	JSR.w CODE_05F7C3
	RTL

;---------------------------------------------------------------------------

DATA_05F746:
DATA_flopsy_fish_jumps_state_ptr:                ; 4-entry $76,x sub-state dispatch (Flopsy Fish $141/$142 jumps)
	dw CODE_05F850                              ;  0: swim / wait
	dw CODE_05F8DD                              ;  1: arc-jump
	dw CODE_05F922                              ;  2: airborne / falling
	dw CODE_0580C2                              ;  3: GSU delta-facing (stub)

YI_NorSpr141_SwimmingAndArcJumpingFlopsyFish_Main:
YI_NorSpr142_3JumpFlopsyFish_Main:
main_flopsy_fish_jumps:                     ; Raidenthequick: main_flopsy_fish_jumps
;$05F74E
	JSR.w CODE_05F76D
	JSL.l CODE_05F79A
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_flopsy_fish_jumps_state_ptr,x)
	JSR.w CODE_05F7C3
	JSL.l CODE_03A5B7
	RTL

DATA_05F769:
	db $03,$04,$05,$04

CODE_05F76D:
	LDA.w $7722,x
	BMI.b CODE_05F799
	LDA.w $7362,x
	BMI.b CODE_05F799
	LDY.w $74A2,x
	BMI.b CODE_05F799
	JSL.l CODE_03AA52
	REP.b #$10
	LDY.w $7362,x
	LDA.w $6000,y
	STA.w $6020,y
	LDA.w $6002,y
	STA.w $6022,y
	LDA.w $6004,y
	STA.w $6024,y
	SEP.b #$10
CODE_05F799:
	RTS

CODE_05F79A:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$000C
	BNE.b CODE_05F7C2
	CPX.w $61B6
	BNE.b CODE_05F7AA
	STZ.w $61B6
CODE_05F7AA:
	LDA.w $7722,x
	BMI.b CODE_05F7B3
	JSL.l CODE_03AEFD
CODE_05F7B3:
	LDA.w #$0004
	STA.w $7402,x
	LDA.w $7042,x
	ORA.w #$0080
	STA.w $7042,x
CODE_05F7C2:
	RTL

CODE_05F7C3:
	LDA.w $7722,x
	BMI.b CODE_05F83F
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEC
	SBC.w #$0040
	CMP.w #$0080
	BCS.b CODE_05F804
	LDA.w #$0080
	SEC
	SBC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BRA.b CODE_05F807

CODE_05F804:
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
CODE_05F807:
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #FXDATA_550000+$4020
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$4020)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
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
CODE_05F83F:
	RTS

DATA_05F840:
	dw $0001,$000E

DATA_05F844:
	dw $080A,$080A

DATA_05F848:
	dw $000E,$0001

DATA_05F84C:
	dw $FEF8,$0108

CODE_05F850:
	TYX
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_05F88C
	SEC
	SBC.w #$0020
	CMP.w #$0040
	BCS.b CODE_05F8AF
	JSL.l CODE_03AD74
	BCC.b CODE_05F88C
	INC.b $16,x
CODE_05F872:
	JSR.w CODE_05F953
	LDA.w #$FA80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$002E
	STA.w $7542,x
	LDA.w #$0011
	STA.w $7402,x
	LDY.b #$02
	STY.b $76,x
	RTS

CODE_05F88C:
	STA.b $00
	LDA.w $7400,x
	DEC
	EOR.b $00
	BMI.b CODE_05F8AF
	LDY.w $7400,x
	STY.b $78,x
	LDA.w DATA_05F848,y
	STA.w $7402,x
	LDA.w #$0008
	STA.w $7A98,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $18,x
	INC.b $76,x
	RTS

CODE_05F8AF:
	LDY.w $7400,x
	LDA.w DATA_05F84C,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A98,x
	BNE.b CODE_05F8D8
	LDA.b $18,x
	INC
	AND.w #$0003
	STA.b $18,x
	TAY
	LDA.w DATA_05F840,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_05F844,y
	AND.w #$00FF
	STA.w $7A98,x
CODE_05F8D8:
	RTS

DATA_05F8D9:
	db $0F,$01,$10,$0E

CODE_05F8DD:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_05F921
	LDA.w #$0008
	STA.w $7A98,x
	INC.b $18,x
	LDA.b $18,x
	CMP.w #$0003
	BNE.b CODE_05F8F5
	DEC.b $76,x
	RTS

CODE_05F8F5:
	LDY.b $78,x
	BNE.b CODE_05F906
	CMP.w #$0002
	PHP
	LDA.b $18,x
	CLC
	ADC.w #$0002
	TAY
	BRA.b CODE_05F90C

CODE_05F906:
	CMP.w #$0001
	PHP
	LDY.b $18,x
CODE_05F90C:
	LDA.w DATA_05F8D9-$01,y
	AND.w #$00FF
	STA.w $7402,x
	PLP
	BNE.b CODE_05F921
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_05F921:
	RTS

CODE_05F922:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w $7182,x
	BPL.b CODE_05F952
	JSR.w CODE_05F953
	DEC.b $16,x
	BNE.b CODE_05F94C
	LDY.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CPY.b #!Define_YI_NorSpr041_Stork
	BEQ.b CODE_05F93C
	INC.b $76,x
	RTS

CODE_05F93C:
	JSL.l CODE_03AEFD
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w $7402,x
	STZ.b $76,x
	RTS

CODE_05F94C:
	LDA.w #$FA80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_05F952:
	RTS

CODE_05F953:
	LDA.w #!Define_YI_AmbSpr1FE
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$0006
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #!Define_YI_SoundID03_Swim
	JSL.l CODE_push_sound_queue
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; MELON BUG (sprite $092).
; Raidenthequick: init_melon_bug / main_melon_bug.
; Pill-bug enemy: rolls into a ball when threatened.
;=========================================================================
YI_NorSpr092_MelonBug_Init:
init_melon_bug:                             ; Raidenthequick: init_melon_bug
;$05F97A
	RTL

;---------------------------------------------------------------------------

DATA_05F97B:
DATA_melon_bug_state_ptr:                        ; 3-entry $76,x sub-state dispatch (Melon Bug $092)
	dw CODE_05FA42                              ;  0: walk / patrol
	dw CODE_05FA81                              ;  1: roll into ball
	dw CODE_05FAC7                              ;  2: rolling-ball post-roll

YI_NorSpr092_MelonBug_Main:
main_melon_bug:                             ; Raidenthequick: main_melon_bug
;$05F981
	JSL.l CODE_03AF23
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0008
	CMP.w #$0010
	BCS.b CODE_05F994
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_05F994:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_melon_bug_state_ptr,x)
	LDA.w #$0040
	STA.w $7542,x
	LDY.b $76,x
	DEY
	BNE.b CODE_05F9C0
	LDY.w $7402,x
	CPY.b #$02
	BPL.b CODE_05F9C0
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$00A0
	CMP.w #$0140
	BCS.b CODE_05F9C0
	LDA.w #$0008
	STA.w $7542,x
CODE_05F9C0:
	LDY.w $7402,x
	CPY.b #$02
	BMI.b CODE_05F9CE
	JSR.w CODE_05FB2E
	JSR.w CODE_05FC2F
	RTL

CODE_05F9CE:
	STZ.b $18,x
	LDY.w $7D36,x
	DEY
	BMI.b CODE_05FA21
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05FA3D
	LDA.w $7D38,y
	BEQ.b CODE_05FA3D
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	CMP.w #$0300
	BMI.b CODE_05F9EE
	LDA.w #$0300
CODE_05F9EE:
	CMP.w #$FD00
	BPL.b CODE_05F9F6
	LDA.w #$FD00
CODE_05F9F6:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0002
	STA.w $7402,x
	STA.b $76,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BMI.b CODE_05FA13
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BPL.b CODE_05FA13
	TYX
	JML.l CODE_kill_sprite_by_hit_checked

CODE_05FA13:
	CMP.w #!Define_YI_NorSpr167_GreenKoopaShell
	BCC.b CODE_05FA3D
	CMP.w #!Define_YI_NorSpr170_AquaLakitu
	BCS.b CODE_05FA3D
	JSR.w CODE_05FD1A
	RTL

CODE_05FA21:
	LDY.w $7D36,x
	BPL.b CODE_05FA3D
	LDA.w #!Define_YI_SoundID62_MelonBugBump
	STA.b $18,x
	JSL.l CODE_push_sound_queue
	LDA.w #$0010
	STA.w $7AF6,x
	LDA.w #$0002
	STA.w $7402,x
	STA.b $76,x
CODE_05FA3D:
	JSL.l CODE_03A5B7
	RTL

CODE_05FA42:
	TYX
	LDY.w $77C2,x
	TYA
	STA.w $7400,x
	STZ.w $7402,x
	LDA.w $7A96,x
	BNE.b CODE_05FA7C
	STZ.b $78,x
	LDA.w $7C16,x
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCS.b CODE_05FA74
	LDA.w $7C18,x
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_05FA74
	LDA.w #$0002
	STA.w $7402,x
	STA.b $78,x
CODE_05FA74:
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
CODE_05FA7C:
	RTS

DATA_05FA7D:
	dw $0010,$0060

CODE_05FA81:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05FA95
	LDY.b $78,x
	STY.b $76,x
	LDA.w DATA_05FA7D,y
	STA.w $7A96,x
	RTS

CODE_05FA95:
	LDY.b $78,x
	BNE.b CODE_05FAC6
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$00A0
	CMP.w #$0140
	BCS.b CODE_05FAC0
	LDA.w $7A98,x
	BNE.b CODE_05FAB9
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
CODE_05FAB9:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTS

CODE_05FAC0:
	LDA.w #$0001
	STA.w $7402,x
CODE_05FAC6:
	RTS

CODE_05FAC7:
	TYX
	JSR.w CODE_05FDBA
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05FAFF
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BMI.b CODE_05FAE6
	LSR
	CMP.w #$0100
	BMI.b CODE_05FAE6
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_05FAE6:
	LDA.w $75E0,x
	ORA.w $7A96,x
	ORA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_05FAFF
	LDY.w $7D36,x
	BMI.b CODE_05FAFF
	LDA.w #$0010
	STA.w $7A96,x
	STZ.b $76,x
	RTS

CODE_05FAFF:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_05FB08
	EOR.w #$FFFF
	INC
CODE_05FB08:
	CLC
	ADC.w $7A38,x
	CMP.w #$0400
	BCC.b CODE_05FB20
	SEC
	SBC.w #$0400
	PHA
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
	PLA
CODE_05FB20:
	STA.w $7A38,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTS

;---------------------------------------------------------------------------

DATA_05FB2A:
	dw $0180,$FE80

CODE_05FB2E:
	LDA.w $7AF6,x
	BNE.b CODE_05FB38
	LDY.w $7D36,x
	BMI.b CODE_05FB3B
CODE_05FB38:
	STZ.b $18,x
	RTS

CODE_05FB3B:
	LDY.b $18,x
	BNE.b CODE_05FB48
	LDA.w #!Define_YI_SoundID62_MelonBugBump
	STA.b $18,x
	JSL.l CODE_push_sound_queue
CODE_05FB48:
	LDA.w $0036
	AND.w #$0003
	BEQ.b CODE_05FB59
	AND.w #$0002
	DEC
	EOR.w $7C16,x
	BMI.b CODE_05FBD5
CODE_05FB59:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_05FBA8
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0300
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	EOR.w $60A8
	BMI.b CODE_05FB97
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w $60A8
	EOR.w $60A8
	BMI.b CODE_05FBA8
	LDA.w $7C16,x
	EOR.w $60A8
	BPL.b CODE_05FBA8
	BRA.b CODE_05FB9F

CODE_05FB97:
	LDA.w $7C16,x
	EOR.w $60A8
	BPL.b CODE_05FBA8
CODE_05FB9F:
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $60A8
	STA.w $60B4
CODE_05FBA8:
	LDA.w $7C16,x
	BPL.b CODE_05FBB7
	CLC
	ADC.w $6120
	CLC
	ADC.w $7BB6,x
	BRA.b CODE_05FBBF

CODE_05FBB7:
	SEC
	SBC.w $6120
	SEC
	SBC.w $7BB6,x
CODE_05FBBF:
	STA.b $06
	JSL.l CODE_05CE7A
	LDA.w $60DE
	ORA.w $6150
	BNE.b CODE_05FBD4
	LDY.w $77C2,x
	TYA
	STA.w $60C4
CODE_05FBD4:
	RTS

CODE_05FBD5:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w $60A8
	BPL.b CODE_05FBF2
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w $60A8
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $60A8
	STA.w $60B4
	RTS

CODE_05FBF2:
	LDY.w $77C2,x
	LDA.w $60A8
	CLC
	ADC.w DATA_05FB2A,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $60A8
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$00C0
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $60A8
	STA.w $60B4
CODE_05FC1F:
	RTS

DATA_05FC20:
	dw $0080,$FF80,$FD00,$0300

;-------------------------------------------------------------------------
; Shell-hit sound IDs (ShellHit2..ShellHit8). Indexed by hit-count to
; produce the rising pitch sequence when something is repeatedly bonked.
; Raidenthequick: DATA_shell_sound_ids_b05.
;-------------------------------------------------------------------------
DATA_05FC28:
DATA_shell_sound_ids_b05:                        ; Raidenthequick: DATA_shell_sound_ids_b05
	db !Define_YI_SoundID0C_ShellHit2,!Define_YI_SoundID0D_ShellHit3,!Define_YI_SoundID0E_ShellHit4,!Define_YI_SoundID0F_ShellHit5
	db !Define_YI_SoundID10_ShellHit6,!Define_YI_SoundID11_ShellHit7,!Define_YI_SoundID12_ShellHit8

CODE_05FC2F:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_05FC3C:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_05FC1F
	BEQ.b CODE_05FC1F
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05FC9C
	LDA.w $6FA2,y
	AND.w #$6000
	BEQ.b CODE_05FC8C
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr0FA_Flower
	BEQ.b CODE_05FC79
	CMP.w #!Define_YI_NorSpr110_Flower
	BEQ.b CODE_05FC79
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BMI.b CODE_05FC9C
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BPL.b CODE_05FC9C
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	BNE.b CODE_05FC9C
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	JMP.w CODE_05FD58

CODE_05FC79:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CMP.w #$0002
	BNE.b CODE_05FC9C
	INC.w $7D38,x
	LDA.w #$0620
	STA.w $6FA0,x
	BRA.b CODE_05FC1F

CODE_05FC8C:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr092_MelonBug
	BNE.b CODE_05FCA3
	LDA.w $7A36,x
	BEQ.b CODE_05FC9E
	STZ.w $7A36,x
CODE_05FC9C:
	BRA.b CODE_05FCE1

CODE_05FC9E:
	JSR.w CODE_05FCED
	BRA.b CODE_05FCE1

CODE_05FCA3:
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC
	CMP.w #$0009
	BPL.b CODE_05FCB0
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_05FCB0:
	PLA
	CMP.w #!Define_YI_NorSpr167_GreenKoopaShell
	BCC.b CODE_05FCC0
	CMP.w #!Define_YI_NorSpr170_AquaLakitu
	BCS.b CODE_05FCC0
	JSR.w CODE_05FD0D
	BRA.b CODE_05FCC7

CODE_05FCC0:
	PHY
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	PLY
CODE_05FCC7:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w #$0008
	BMI.b CODE_05FCD6
	TYX
	JSL.l CODE_spawn_1up_score
	BRA.b CODE_05FCE1

CODE_05FCD6:
	TAY
	LDA.w DATA_shell_sound_ids_b05-$01,y
	AND.w #$00FF
	JSL.l CODE_push_sound_queue
CODE_05FCE1:
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JMP.w CODE_05FC3C

CODE_05FCED:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BNE.b CODE_05FCF8
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_05FD00
	RTS

CODE_05FCF8:
	JSR.w CODE_05FD58
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_05FD08
CODE_05FD00:
	PHX
	TYX
	PLY
	JSR.w CODE_05FD58
	LDX.b $12
CODE_05FD08:
	RTS

DATA_05FD09:
	dw $FE00,$0200

CODE_05FD0D:
	CMP.w #$0169
	BCS.b CODE_05FD1A
	LDA.w $7D38,y
	BEQ.b CODE_05FD1A
	JSR.w CODE_05FD58
CODE_05FD1A:
	PHY
	TYX
	JSL.l CODE_0CFF61
	JSL.l CODE_kill_sprite_by_hit_checked
	PLY
	LDA.w $7CD6,x
	LDX.b #$00
	CMP.w $7CD6,y
	BPL.b CODE_05FD31
	INX
	INX
CODE_05FD31:
	LDA.w DATA_05FD09,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w #$0040
	STA.w $7542,y
	LDA.w #$0400
	STA.w $75E2,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LDX.b $12
	RTS

CODE_05FD58:
	PHY
	JSL.l CODE_03B288
	PLY
	PHY
	LDA.w $7CD6,y
	LDY.b #$00
	CMP.w $7CD6,x
	BPL.b CODE_05FD6B
	INY
	INY
CODE_05FD6B:
	LDA.w DATA_05FD09,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0840
	STA.w $6FA2,x
	LDA.w $7042,x
	ORA.w #$0080
	STA.w $7042,x
	PLY
	RTS

DATA_05FD8E:
	dw $0008,$0008,$0010,$0020,$0020,$0010,$0008,$0000
	dw $0008,$0010,$0020,$0040,$0040,$0020,$0010

DATA_05FDAC:
	dw $0000,$0300,$021F,$0180,$FE80,$FDE1,$FD00

CODE_05FDBA:
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,x
	AND.w #$00FF
	BNE.b CODE_05FDD8
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_05FE1B
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_05FDD3
	LDY.b #$0E
CODE_05FDD3:
	LDA.w #$0000
	BRA.b CODE_05FDFB

CODE_05FDD8:
	CMP.w #$0080
	BMI.b CODE_05FDE8
	ORA.w #$FF00
	LDY.b #$04
	CLC
	ADC.w #$0020
	BRA.b CODE_05FDEE

CODE_05FDE8:
	LDY.b #$0A
	SEC
	SBC.w #$0020
CODE_05FDEE:
	BEQ.b CODE_05FDF8
	BMI.b CODE_05FDF6
	DEY
	DEY
	BRA.b CODE_05FDF8

CODE_05FDF6:
	INY
	INY
CODE_05FDF8:
	LDA.w DATA_05FDAC,y
CODE_05FDFB:
	STA.w $75E0,x
	ASL
	STA.b $00
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_05FE12
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w $75E0,x
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_05FE18
CODE_05FE12:
	TYA
	CLC
	ADC.w #$0010
	TAY
CODE_05FE18:
	LDA.w DATA_05FD8E,y
CODE_05FE1B:
	STA.w $7540,x
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; HIT GREEN EGG BLOCK (sprite $06B).
; Raidenthequick: init_hit_green_egg_block / main_hit_green_egg_block.
; The egg-block after it has been hit -- handles the bounce-and-fade-out.
;=========================================================================
YI_NorSpr06B_GreenEggBlock_Init:
init_hit_green_egg_block:                   ; Raidenthequick: init_hit_green_egg_block
;$05FE1F
	JSL.l CODE_03AD74
	BCC.b CODE_05FE33
	JSL.l CODE_05FF7E
	LDA.w $7040,x
	CLC
	ADC.w #$1801
	STA.w $7040,x
CODE_05FE33:
	INC.w $0C02
	LDA.w $70E2,x
	STA.b $18,x
	LDA.w $7182,x
	STA.b $76,x
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.b $78,x
	RTL

;---------------------------------------------------------------------------

DATA_05FE4A:
	dw $00F0,$00D8,$0100,$00C8,$00E0,$00F8,$00D0,$00E8

DATA_05FE5A:
	dw $FD30,$FD78,$FD00,$FDA8,$FD60,$FD18,$FD90,$FD48

DATA_05FE6A:
	dw $0300,$FD00

YI_NorSpr06B_GreenEggBlock_Main:
main_hit_green_egg_block:                   ; Raidenthequick: main_hit_green_egg_block
;$05FE6E
	LDA.w $7722,x
	ORA.w $7362,x
	BMI.b CODE_05FE7A
	JSL.l CODE_03AA52
CODE_05FE7A:
	JSL.l CODE_03AF23
	JSL.l CODE_03D127
	LDY.w $7D36,x
	DEY
	BMI.b CODE_05FE9D
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_05FE9D
	LDA.w $6FA2,y
	AND.w #$0800
	BEQ.b CODE_05FE9D
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
CODE_05FE9D:
	LDA.w $7A38,x
	BPL.b CODE_05FEC2
	LDA.b $18,x
	STA.w $0091
	LDA.b $76,x
	STA.w $0093
	LDA.w #$0001
	STA.w $008F
	LDA.w #$5F04
	STA.w $0095
	JSL.l CODE_change_map16
	LDX.b $12
	JML.l CODE_03A31E

CODE_05FEC2:
	LDY.w $7A36,x
	CLC
	ADC.w DATA_05FE6A,y
	STA.w $7A38,x
	BPL.b CODE_05FED5
	LDA.w #$00FF
	STA.w $74A2,x
	RTL

CODE_05FED5:
	CMP.w #$1800
	BMI.b CODE_05FF2D
	LDA.w #$0002
	STA.w $7A36,x
	LDX.b #FXCODE_0991D5>>16
	LDA.w #FXCODE_0991D5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0006
	BCS.b CODE_05FF2D
	LDA.w #$0025
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_05FF2D
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w $0C02
	AND.w #$0007
	ASL
	TAX
	LDA.w DATA_05FE5A,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w DATA_05FE4A,x
	LDX.b $12
	BIT.b $78,x
	BPL.b CODE_05FF23
	EOR.w #$FFFF
	INC
CODE_05FF23:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #!Define_YI_SoundID04_SpitOut
	JSL.l CODE_push_sound_queue
CODE_05FF2D:
	LDA.w $7A39,x
	AND.w #$00FF
	ASL
	TAX
	LDA.l DATA_sine_lut_8bit_radians,x
	TAY
	STY.w !REGISTER_Mode7MatrixParameterA
	XBA
	TAY
	STY.w !REGISTER_Mode7MatrixParameterA
	LDY.b #$20
	STY.w !REGISTER_Mode7MatrixParameterB
	LDA.l DATA_cosine_lut_8bit_radians,x
	PHA
	LDX.b $12
	LDA.b $76,x
	CLC
	ADC.w !REGISTER_PPUMultiplicationProductMid
	STA.w $7182,x
	PLY
	STY.w !REGISTER_Mode7MatrixParameterA
	PLY
	STY.w !REGISTER_Mode7MatrixParameterA
	LDY.b #$20
	STY.w !REGISTER_Mode7MatrixParameterB
	LDA.w #$0020
	SEC
	SBC.w !REGISTER_PPUMultiplicationProductMid
	BIT.b $78,x
	BPL.b CODE_05FF73
	EOR.w #$FFFF
	INC
CODE_05FF73:
	CLC
	ADC.b $18,x
	STA.w $70E2,x
	LDA.w $7722,x
	BMI.b CODE_05FFC3
CODE_05FF7E:
	LDA.w $7A39,x
	BIT.b $78,x
	BMI.b CODE_05FF89
	EOR.w #$FFFF
	INC
CODE_05FF89:
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
	LDA.w #FXDATA_540000+$7040
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$7040)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	SEP.b #$10
	LDX.b #FXCODE_08835F>>16
	LDA.w #FXCODE_08835F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
CODE_05FFC3:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Glitched-sprite stubs (sprites $05D, $086).
; These templated labels resolve into the bank's freespace tail and never
; execute meaningful code. Raidenthequick names this region
; junk_sprite_pointer -- spawning either spriteID jumps into freespace
; bytes (V1.0 = $FF padding, V1.1/U2 = GarbageData fill).
; Intentionally left as-is: the labels exist only because the templated
; SpriteID -> Init/Main macros require coverage for every ID.
;-------------------------------------------------------------------------
YI_NorSpr05D_GlitchedSprite_Init:
YI_NorSpr086_GlitchedSprite_Init:
YI_NorSpr05D_GlitchedSprite_Main:
YI_NorSpr086_GlitchedSprite_Main:
junk_sprite_pointer:                        ; Raidenthequick: junk_sprite_pointer
;$05FFC4
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($05FFE6, incbin, DATA_05FFE6_YI_U2.bin)
else
	%FREE_BYTES($05FFC4, 60, $FF)
endif
%BANK_END(<EndBank>)
endmacro
