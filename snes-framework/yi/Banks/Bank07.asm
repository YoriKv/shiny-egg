;#############################################################################################################
;# Bank07.asm -- bank $07 normal-sprite handlers (Init/Main pairs for sprite IDs $0F1..$1A4).
;#
;# All routines are reachable via the normal-sprite Init/Main dispatchers in Bank $03 (see
;# Routines/ROUTINE_YI_NorSpr*_*.asm). Each Init builds initial sprite state from level-header data;
;# each Main runs every frame the sprite is active. State is held in the per-slot EXRAM tables
;# (!EXRAM_YI_Level_NorSpr_*) and the bank-0x6F00-shaped DP-relative tables ($6FA0, $7000, ...).
;#
;# Bank-$07's "shape" is dominated by enemy variety: standard mobs, Lakitu family, Koopa family,
;# Baron Von Zeppelin payload variants, and the keyhole-cork that gates level-clear in fort/castle
;# levels.
;#
;# Contents at a glance (ranges keyed off the ;$07xxxx address comments at each handler entry):
;#   $078000..$0780C2 -- Egg Plant Shooting Bubbles ($0F1) Init + Main (bubble-spit decoration)
;#   $0780C3..$07853F -- Egg Plant ($0F4) Init + Main (sproutable egg dispenser)
;#   $078540..$0788A6 -- Shyguy On Stilts ($0F2) Init + Main + StompRt
;#   $0788A7..$079024 -- Slugger ($0F5) Init + Main (W2-3 baseball-bat shy guy)
;#   $079025..$07940F -- Long Spear Guy ($0FB) + Short Spear Guy ($0FC) shared Init/Main
;#   $079410..$079590 -- Snifit ($113) Init + Main (round bubble-firing shy guy)
;#   $079591..$079627 -- Snifit Bullet ($114) Init + Main
;#   $079628..$079FCF -- Poochy ($0FF) Init + Main (rideable dog over lava/spikes)
;#   $079FD0..$07A679 -- Green Glove ($11A) Init + Main (egg-juggling shy guy)
;#   $07A67A..$07AB50 -- Lakitu ($11B) Init + Main + StompRt
;#   $07AB51..$07ADD6 -- Horizontal ($12F) + Vertical ($130) Lava Drops Init + Main
;#   $07ADD7..$07B051 -- Fat Guy ($12B) Init + Main (big bouncing shy guy)
;#   $07B052..$07B28D -- Dangling Fang ($13D) + Flying Fang ($13E) Init + Main
;#   $07B28E..$07B6A2 -- Swimming + Swimming&Jumping Flopsy Fish ($13F/$140) shared Init/Main
;#   $07B6A3..$07B9ED -- Blue + Pink Sluggy ($145/$146) shared Init/Main/StompRt
;#   $07B9EE..$07BB1F -- Arrow Clouds ($149..$150) + Rotating Arrow Cloud ($151) shared dispatch
;#   $07BB20..$07BE8F -- Flutter ($152) Init + Main
;#   $07BE90..$07C2D5 -- Spray Fish ($143) Init + Main
;#   $07C2D6..$07C688 -- Wall Lakitu ($157) Init + Main + StompRt
;#   $07C689..$07C967 -- Walking Grunt ($159) + Running Grunt ($15A) shared Init/Main
;#   $07C968..$07CEAF -- Dancing Spear Guy ($15B) Init + Main
;#   $07CEB0..$07D856 -- Zeus Guy ($0FD) Init + Main + StompRt + Zeus Guy Blast ($0FE) Init/Main
;#   $07D857..$07E3BC -- Koopa Shells ($167/$168) + Naked/Shelled Koopas ($169..$16C) (shared)
;#                       Init / Main / StompRt
;#   $07E3BD..$07E7B4 -- Parakoopas Green/RedH/RedV ($16D/$16E/$16F) shared Init/Main/StompRt
;#   $07E7B5..$07EB4B -- Aqua Lakitu ($170) Init + Main + StompRt
;#   $07EB4C..$07F117 -- Thunder Lakitu ($166) Init + Main + StompRt
;#   $07F118..$07FB23 -- Baron Von Zeppelin payload variants ($173..$17E, $0CD)
;#                       plus the Baron itself ($17F) at $07FB24
;#   $07FDBF..$07FF46 -- Keyhole Cork ($1A4) Init + Main (fort/castle level-clear trigger)
;#   $07FF50..$07FFFF -- bank-tail garbage data (V1.1 ROM only -- 185 free bytes in V1.0)
;#
;# Cross-references:
;#   ../../../yoshisisland-disassembly/disassembly/bank07.asm -- Raidenthequick's V1.0 disassembly;
;#                       primary source of the init_bubble_plant / init_egg_plant / init_lakitu /
;#                       CODE_init_zeus_guy / init_thunder_lakitu / init_bvz / init_cork aliases.
;#   ../Constants/NormalSpriteIDs.asm        -- the !Define_YI_NorSpr* sprite-ID symbols.
;#   ../Memory/SRAM_SpriteSlots.asm          -- layout of the $70:0EC0..$701DF8 per-slot tables.
;#   docs/spritestateengine.md               -- sprite engine architecture + ID space + Init/Main convention.
;#   see also: ys_enmy.asm, ys_enmy2.asm, ys_enmy6.asm -- enemy main + Lakitu/Koopa families.
;#############################################################################################################

macro YIBank07Macros(StartBank, EndBank)
%BANK_START(<StartBank>)

;-------------------------------------------------------------------------
; Egg Plant Shooting Bubbles ($0F1) -- Init handler.
; The bubble-spitting plant decoration: writes the per-slot fire-cycle
; timer ($7A98 = 6 sub-frames, $7A96 = 90-frame cooldown). Main runs the
; bubble-spawn cadence + the per-slot animation index $18,x.
; Raidenthequick: init_bubble_plant.
;-------------------------------------------------------------------------
YI_NorSpr0F1_EggPlantShootingBubbles_Init:
init_bubble_plant:                         ; Raidenthequick: init_bubble_plant
;$078000
	LDA.w #$0006
	STA.w $7A98,x
	LDA.w #$005A
	STA.w $7A96,x
	RTL

;---------------------------------------------------------------------------

DATA_07800D:
	db $00,$06,$07

DATA_078010:
	db $04,$04,$04,$14,$02,$20,$02,$04

DATA_078018:
	db $00,$02,$01,$02,$05,$03,$05,$04

;-------------------------------------------------------------------------
; Egg Plant Shooting Bubbles ($0F1) -- Main handler.
; Per frame: shared sprite tick ($03AF23) + collision-with-Yoshi check
; via CODE_078425, then tick the bubble-spit timer; when it expires,
; bump the animation index and re-arm. Raidenthequick: main_bubble_plant.
;-------------------------------------------------------------------------
YI_NorSpr0F1_EggPlantShootingBubbles_Main:
main_bubble_plant:                         ; Raidenthequick: main_bubble_plant
;$078020
	JSL.l CODE_03AF23
	JSR.w CODE_078425
	LDA.b $16,x
	BNE.b CODE_078055
	LDA.w $7A96,x
	BEQ.b CODE_078055
	LDA.w $7A98,x
	BEQ.b CODE_078036
	RTL

CODE_078036:
	LDA.w #$0006
	STA.w $7A98,x
	LDA.b $18,x
	INC
	CMP.w #$0003
	BCC.b CODE_078047
	LDA.w #$0000
CODE_078047:
	STA.b $18,x
	TAY
	LDA.w DATA_07800D,y
	AND.w #$00FF
	STA.w $7402,x
	BRA.b CODE_0780C0

CODE_078055:
	LDA.w $7AF6,x
	BNE.b CODE_0780AB
	LDA.b $16,x
	TAY
	INC.b $16,x
	LDA.w DATA_078010,y
	AND.w #$00FF
	STA.w $7AF6,x
	LDA.w DATA_078018,y
	AND.w #$00FF
	STA.w $7402,x
	CPY.b #$04
	BNE.b CODE_0780C0
	LDA.w #$0019
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	JSL.l CODE_spawn_sprite_init
else
	JSL.l CODE_spawn_sprite_active
endif
	BCC.b CODE_0780C0
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0018
	STA.w $7182,y
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0004
	STA.w $7402,y
	LDA.w #$000A
	STA.w $7A98,y
	LDA.w $6FA0,y
	AND.w #$F9FF
	STA.w $6FA0,y
	BRA.b CODE_0780C0

CODE_0780AB:
	LSR
	BNE.b CODE_0780C0
	LDA.b $16,x
	CMP.w #$0008
	BNE.b CODE_0780C0
	STZ.b $16,x
	STZ.w $7402,x
	LDA.w #$005A
	STA.w $7A96,x
CODE_0780C0:
	RTL

;---------------------------------------------------------------------------

DATA_0780C1:
	db $FF,$9F

;-------------------------------------------------------------------------
; Egg Plant ($0F4) -- Init handler.
; The breakable plant that grows eggs Yoshi can collect. Init builds the
; growth-cycle state and palette. Raidenthequick: init_egg_plant.
;-------------------------------------------------------------------------
YI_NorSpr0F4_EggPlant_Init:
init_egg_plant:                            ; Raidenthequick: init_egg_plant
;$0780C3
	JSL.l CODE_02A007
	SEP.b #$20
	LDA.w $70E2,x
	AND.b #$10
	LSR
	LSR
	LSR
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LSR
	TAY
	LDA.w $6FA3,x
	AND.w DATA_0780C1,y
	STA.w $6FA3,x
	LDY.b #$03
	STY.b $18,x
	LDA.w DATA_078119,y
	STA.w $7402,x
	LDA.w DATA_07811D,y
	STA.w $7A96,x
	REP.b #$20
	BRA.b CODE_07810C

;-------------------------------------------------------------------------
; Egg Plant ($0F4) -- Main handler.
; Cycles through growth phases, spawns an egg when ripe, regrows after
; pluck. Largest of the plant-family Mains (~500 lines).
; Raidenthequick: main_egg_plant.
;-------------------------------------------------------------------------
YI_NorSpr0F4_EggPlant_Main:
main_egg_plant:                            ; Raidenthequick: main_egg_plant
;$0780F3
	JSL.l CODE_03AF23
	JSR.w CODE_078425
	LDA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	ORA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	BEQ.b CODE_078103
	RTL

CODE_078103:
	JSR.w CODE_078411
	LDY.b $16,x
	TYX
	JSR.w (DATA_egg_plant_state_ptr,x)
CODE_07810C:
	LDA.w $60C0
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTL

DATA_078113:
DATA_egg_plant_state_ptr:                       ; 3-phase egg-plant state ptr (grow / ripe-egg / regrow)
	dw CODE_07813D
	dw CODE_07838A
	dw CODE_0783C9

DATA_078119:
	db $02,$01,$02,$00

DATA_07811D:
	db $04,$02,$02,$04

DATA_078121:
	dw $0000,$0080,$FF80,$0100,$FF00,$0040,$FFC0,$00C0

DATA_078131:
	dw $0040,$FFC0,$0080,$FF80,$0100,$FF00

CODE_07813D:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07815B
	LDY.b $18,x
	DEY
	BMI.b CODE_07815C
	STY.b $18,x
	SEP.b #$20
	LDA.w DATA_078119,y
	STA.w $7402,x
	LDA.w DATA_07811D,y
	STA.w $7A96,x
	REP.b #$20
CODE_07815B:
	RTS

CODE_07815C:
	SEP.b #$20
	INC.b $16,x
	INC.b $16,x
	LDY.b #$03
	STY.b $18,x
	LDA.w DATA_078382,y
	STA.w $7402,x
	LDA.w DATA_078386,y
	STA.w $7A96,x
	REP.b #$20
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TYX
	JMP.w (DATA_egg_plant_variant_ptr,x)

DATA_07817B:
DATA_egg_plant_variant_ptr:                     ; 2-entry egg-plant PROJECTILE variant dispatch (by $70E2 bit-4 / cell-column parity: even = spits Green Eggs $025, odd = spits Bouncing Needlenoses $163). NOT a visual variant (old misgloss).
	dw CODE_07817F
	dw CODE_078297

CODE_07817F:
	LDX.b $12
	LDX.b #FXCODE_0991D5>>16
	LDA.w #FXCODE_0991D5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0006
	BCS.b CODE_0781FB
	CMP.w #$0005
	BEQ.b CODE_0781A0
	LDY.b $17,x
	BEQ.b CODE_0781A0
	JMP.w CODE_078238

CODE_0781A0:
	LDA.b $10
	AND.w #$0007
	ASL
	CMP.b $78,x
	BNE.b CODE_0781AF
	INC
	INC
	AND.w #$000E
CODE_0781AF:
	STA.b $78,x
	TAY
	LDA.w DATA_078121,y
	STA.b $00
	LDA.w #$0025
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0781FB
	LDA.w #$0002
	STA.w $74A2,y
	STA.w $7A36,y
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0014
	STA.w $7182,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FA00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0040
	STA.w $7542,y
	LDA.w $6FA2,y
	AND.w #$FFE0
	STA.w $6FA2,y
	LDA.w #!Define_YI_SoundID14_Gulp
	JSL.l CODE_push_sound_queue
	RTS

CODE_0781FB:
	LDA.w #!Define_YI_AmbSpr1DF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0014
	STA.w $7142,y
	LDA.w #$0005
	STA.w $7E4C,y
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w #$0002
	STA.w $7462,y
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #!Define_YI_SoundID37_FlutterJump
	JSL.l CODE_push_sound_queue
	RTS

CODE_078238:
	LDA.w #$0006
	SEC
	SBC.w !REGISTER_SuperFX_R6_MultiplierLo
	DEC
	STA.b $00
	LDY.b #$00
	STY.b $17,x
CODE_078246:
	LDA.b $00
	ASL
	TAY
	LDA.w DATA_078131,y
	STA.b $02
	LDA.w #$0025
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_07828F
	LDA.w #$0002
	STA.w $74A2,y
	STA.w $7A36,y
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0014
	STA.w $7182,y
	LDA.b $02
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FA00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0040
	STA.w $7542,y
	LDA.w $6FA2,y
	AND.w #$FFE0
	STA.w $6FA2,y
	DEC.b $00
	BPL.b CODE_078246
CODE_07828F:
	LDA.w #!Define_YI_SoundID14_Gulp
	JSL.l CODE_push_sound_queue
	RTS

CODE_078297:
	LDX.b $12
	LDX.b #FXCODE_0991D5>>16
	LDA.w #FXCODE_0991D5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0006
	BCS.b CODE_0782DE
	STA.b $00
	LDA.w #$0163
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0164
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0991DB>>16
	LDA.w #FXCODE_0991DB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CLC
	ADC.b $00
	STA.b $00
	CMP.w #$0006
	BCS.b CODE_0782DE
	CMP.w #$0005
	BEQ.b CODE_0782E1
	LDY.b $17,x
	BEQ.b CODE_0782E1
	JMP.w CODE_078330

CODE_0782DE:
	JMP.w CODE_0781FB

CODE_0782E1:
	LDA.b $10
	AND.w #$0007
	ASL
	CMP.b $78,x
	BNE.b CODE_0782F0
	INC
	INC
	AND.w #$000E
CODE_0782F0:
	STA.b $78,x
	TAY
	LDA.w DATA_078121,y
	STA.b $00
	LDA.w #$0163
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_0782DE
	LDA.w #$0002
	STA.w $74A2,y
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0014
	STA.w $7182,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FA00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0040
	STA.w $7542,y
	LDA.w #!Define_YI_SoundID14_Gulp
	JSL.l CODE_push_sound_queue
	RTS

CODE_078330:
	LDA.w #$0006
	SEC
	SBC.b $00
	DEC
	STA.b $00
	LDY.b #$00
	STY.b $17,x
CODE_07833D:
	LDA.b $00
	ASL
	TAY
	LDA.w DATA_078131,y
	STA.b $02
	LDA.w #$0163
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_07837A
	LDA.w #$0002
	STA.w $74A2,y
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0014
	STA.w $7182,y
	LDA.b $02
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FA00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0040
	STA.w $7542,y
	DEC.b $00
	BPL.b CODE_07833D
CODE_07837A:
	LDA.w #!Define_YI_SoundID14_Gulp
	JSL.l CODE_push_sound_queue
	RTS

DATA_078382:
	db $09,$0A,$09,$08

DATA_078386:
	db $02,$08,$02,$04

CODE_07838A:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_0783A8
	LDY.b $18,x
	DEY
	BMI.b CODE_0783A9
	STY.b $18,x
	SEP.b #$20
	LDA.w DATA_078382,y
	STA.w $7402,x
	LDA.w DATA_078386,y
	STA.w $7A96,x
	REP.b #$20
CODE_0783A8:
	RTS

CODE_0783A9:
	SEP.b #$20
	INC.b $16,x
	INC.b $16,x
	LDY.b #$02
	STY.b $18,x
	LDA.w DATA_0783C6,y
	STA.w $7402,x
	LDA.b #$06
	STA.w $7A96,x
	LDA.b #$20
	STA.w $7A98,x
	REP.b #$20
	RTS

DATA_0783C6:
	db $07,$06,$00

CODE_0783C9:
	LDX.b $12
	LDY.b $17,x
	BNE.b CODE_0783D4
	LDA.w $7A98,x
	BNE.b CODE_0783DC
CODE_0783D4:
	LDA.w $7402,x
	CMP.w #$0000
	BEQ.b CODE_0783FA
CODE_0783DC:
	LDA.w $7A96,x
	BNE.b CODE_0783F9
	LDY.b $18,x
	DEY
	BPL.b CODE_0783E8
	LDY.b #$02
CODE_0783E8:
	STY.b $18,x
	SEP.b #$20
	LDA.b #$06
	STA.w $7A96,x
	LDA.w DATA_0783C6,y
	STA.w $7402,x
	REP.b #$20
CODE_0783F9:
	RTS

CODE_0783FA:
	SEP.b #$20
	STZ.b $16,x
	LDY.b #$03
	STY.b $18,x
	LDA.w DATA_078119,y
	STA.w $7402,x
	LDA.w DATA_07811D,y
	STA.w $7A96,x
	REP.b #$20
	RTS

CODE_078411:
	LDA.w $60D4
	BEQ.b CODE_078424
	LDA.w $60C0
	BNE.b CODE_078424
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_078424
	LDY.b #$01
	STY.b $17,x
CODE_078424:
	RTS

CODE_078425:
	LDA.w #$0040
	STA.w $7542,x
	LDA.w $7CD6,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7BB6,x
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w $7BB8,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_09933A>>16
	LDA.w #FXCODE_09933A
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_078485
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CMP.w #$0008
	BPL.b CODE_078485
	CPY.b $12
	BCC.b CODE_078486
CODE_07845F:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	CMP.w #$0100
	BPL.b CODE_07846A
	LDA.w #$0100
CODE_07846A:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7CD8,y
	SEC
	SBC.w $7BB8,y
	SEC
	SBC.w #$000E
	STA.w $7182,x
	LDA.w $70E2,x
	CLC
	ADC.w $72C0,y
	STA.w $70E2,x
CODE_078485:
	RTS

CODE_078486:
	STY.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	JSL.l CODE_03A366
	BCS.b CODE_078495
	LDY.b $00
	BRA.b CODE_07845F

CODE_078495:
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.b $16,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	LDA.b $18,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.b $76,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.b $78,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.w $7A36,x
	STA.w $7A36,y
	LDA.w $7A38,x
	STA.w $7A38,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDA.w $7A96,x
	STA.w $7A96,y
	LDA.w $7A98,x
	STA.w $7A98,y
	LDA.w $7AF6,x
	STA.w $7AF6,y
	LDA.w $7AF8,x
	STA.w $7AF8,y
	LDA.w $7402,x
	STA.w $7402,y
	LDA.w $7860,x
	STA.w $7860,y
	LDA.w $7720,x
	STA.w $7720,y
	LDA.w $7680,x
	STA.w $7680,y
	LDA.w $7682,x
	STA.w $7682,y
	LDA.w $6FA2,x
	STA.w $6FA2,y
	SEP.b #$20
	LDA.w $74A0,x
	STA.w $74A0,y
	REP.b #$20
	PLA
	JML.l CODE_despawn_sprite_free_slot

;---------------------------------------------------------------------------

; Note: Green baseball boy routine

DATA_078518:
	db $00,$01,$02,$03,$04,$05,$06,$07,$08,$09,$0A,$0B,$0C,$0D,$0E,$0F
	db $10,$11,$12,$13,$14,$15,$16,$17

DATA_078530:
	dw $FFA0,$0060

DATA_078534:
	dw $0060,$FFA0

DATA_078538:
	dw $0000,$0002,$0004,$0008

;-------------------------------------------------------------------------
; Shyguy On Stilts ($0F2) -- Init handler.
; Stilt Guys walk on tall stilts; stomp knocks them off and they keep
; walking shorter. Init sets walk speed + initial leg-height frames.
; Raidenthequick: init_stilt_guy.
;-------------------------------------------------------------------------
YI_NorSpr0F2_ShyguyOnStilts_Init:
init_stilt_guy:                            ; Raidenthequick: init_stilt_guy
;$078540
 	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_07856B
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	STA.b $00
	LDA.w $7182,x
	AND.w #$0010
	ORA.b $00
	LSR
	LSR
	TAY
	LDA.w DATA_078538,y
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w $7042,x
	ORA.w DATA_078538,y
	STA.w $7042,x
	BRA.b CODE_078575

CODE_07856B:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC
	ORA.w $7042,x
	STA.w $7042,x
CODE_078575:
	LDA.w #$0003
	STA.w $7A96,x
	LDA.w #$0000
	STA.w $7402,x
	LDY.w $7400,x
	LDA.w #$0001
	STA.b $18,x
	LDA.w $7860,x
	STA.b $78,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Shyguy On Stilts ($0F2) -- Main handler.
; Walking + edge-detect + Yoshi-contact damage. After stomp jumps to
; StompRt which downsizes the stilt sprite. Raidenthequick: main_stilt_guy.
;-------------------------------------------------------------------------
YI_NorSpr0F2_ShyguyOnStilts_Main:
main_stilt_guy:                            ; Raidenthequick: main_stilt_guy
;$07858F
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_0785A8
	STZ.w $6162
	STZ.w $6168
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	PLY
	PLA
	JSR.w CODE_07874D
CODE_0785A8:
	JSL.l CODE_03AF23
	LDY.w $7D36,x
	BPL.b CODE_07860A
	LDA.w $60D4
	BEQ.b CODE_07860A
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_07860A
	LDY.w $7400,x
	LDA.w DATA_078530,y
	STA.b $00
	LDA.w #!Define_YI_AmbSpr1F7
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w $7400,x
	STA.w $73C0,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$00C0
	STA.w $7782,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC
	ORA.w $7002,y
	STA.w $7002,y
	JSL.l CODE_0CFF61
	JML.l CODE_kill_sprite_by_hit

CODE_07860A:
	LDA.b $16,x
	TAX
	JMP.w (DATA_stilt_guy_state_ptr,x)

DATA_078610:
DATA_stilt_guy_state_ptr:                       ; 2-entry stilt-guy state ptr: standing-walk / squashed-runaway
	dw CODE_078644
	dw CODE_0786C6

DATA_078614:
	dw $0000,$FFFF,$0000,$FFFF,$0000,$FFFF,$FFFE,$FFFF
	dw $FFFE,$FFFF,$FFFE,$FFFF,$0000,$FFFF,$0000,$FFFF
	dw $0000,$0000,$FFFE,$FFFE,$FFFE,$FFFF,$FFFE,$FFFF

CODE_078644:
	LDX.b $12
	JSR.w CODE_0786EE
	LDA.w $7860,x
	STA.b $78,x
	JSR.w CODE_078737
	JSL.l CODE_03A5B7
	LDA.w $7A96,x
	BNE.b CODE_0786C5
	LDA.w #$0003
	STA.w $7A96,x
	LDA.w $7402,x
	STA.b $00
	CLC
	ADC.b $18,x
	CMP.w #$0018
	BCC.b CODE_078670
	LDA.w #$0000
CODE_078670:
	STA.w $7402,x
	LDA.b $18,x
	BPL.b CODE_078689
	LDA.b $00
	ASL
	TAY
	LDA.w DATA_078614,y
	LDY.w $7400,x
	BNE.b CODE_0786A2
	EOR.w #$FFFF
	INC
	BRA.b CODE_0786A2

CODE_078689:
	CLC
	ADC.b $00
	CMP.w #$0018
	BCC.b CODE_078694
	LDA.w #$0000
CODE_078694:
	ASL
	TAY
	LDA.w DATA_078614,y
	LDY.w $7400,x
	BEQ.b CODE_0786A2
	EOR.w #$FFFF
	INC
CODE_0786A2:
	CLC
	ADC.w $70E2,x
	STA.w $70E2,x
	LDA.b $18,x
	BPL.b CODE_0786C5
	LDA.w $7402,x
	BEQ.b CODE_0786B7
	CMP.w #$000C
	BNE.b CODE_0786C5
CODE_0786B7:
	LDA.w #$0001
	STA.b $18,x
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_0786C5:
	RTL

CODE_0786C6:
	LDX.b $12
	LDA.w $7860,x
	STA.b $78,x
	JSL.l CODE_03A5B7
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_0786E3
	DEC.b $76,x
	BMI.b CODE_0786E4
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0786E3:
	RTL

CODE_0786E4:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $16,x
	RTL

DATA_0786EA:
	dw $0008,$0004

CODE_0786EE:
	LDA.w $7400,x
	LDY.b $18,x
	BPL.b CODE_0786F8
	EOR.w #$0002
CODE_0786F8:
	TAY
	LDA.w $7860,x
	AND.w DATA_0786EA,y
	BEQ.b CODE_07870A
	LDA.b $18,x
	EOR.w #$FFFF
	INC
	STA.b $18,x
	RTS

CODE_07870A:
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_07872F
	LDA.b $78,x
	BIT.w #$0001
	BEQ.b CODE_078730
	LDA.l $70276E,x
	STA.w $70E2,x
	LDA.l $702770,x
	STA.w $7182,x
	LDA.b $18,x
	EOR.w #$FFFF
	INC
	STA.b $18,x
CODE_07872F:
	RTS

CODE_078730:
	LDA.w $7860,x
	STA.b $78,x
	PLA
	RTL

CODE_078737:
	LDY.w $7D36,x
	BPL.b CODE_078754
	LDA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	BNE.b CODE_078749
	JSL.l CODE_07FC2F
	BEQ.b CODE_078753
	BCS.b CODE_078753
CODE_078749:
	JSL.l CODE_03A858
CODE_07874D:
	LDY.w $77C2,x
	JMP.w CODE_07880B

CODE_078753:
	RTS

CODE_078754:
	DEY
	BMI.b CODE_078753
	BEQ.b CODE_078753
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_078753
	LDA.w $7D38,y
	BEQ.b CODE_078753
	LDA.w $7CD8,x
	SEC
	SBC.w #$0008
	CMP.w $7CD8,y
	BPL.b CODE_07878C
	PHY
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	PLY
	LDX.b $12
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	AND.w #$8000
	ASL
	ROL
	ASL
	TAY
	JMP.w CODE_07880B

CODE_07878C:
	LDA.w $7542,y
	CMP.w #$0040
	BMI.b CODE_078798
	PLA
	JMP.w CODE_078826

CODE_078798:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.b $00
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	LDA.w #!Define_YI_AmbSpr1F7
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w $7400,x
	STA.w $73C0,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$00C0
	STA.w $7782,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC
	ORA.w $7002,y
	STA.w $7002,y
	LDA.w #!Define_YI_NorSpr01E_Shyguy
	STA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	LDA.w $7040,x
	AND.w #$07FF
	ORA.w #$1800
	STA.w $7040,x
	SEP.b #$20
	STZ.w $7180,x
	REP.b #$20
	STZ.w $7402,x
	LDA.w $7182,x
	SEC
	SBC.w #$0020
	STA.w $7182,x
	PLA
	JML.l CODE_kill_sprite_by_hit_special_cases

CODE_07880B:
	LDA.w DATA_078534,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0015
	STA.w $7402,x
	LDA.w #$0003
	STA.b $76,x
	LDY.b #$02
	STY.b $16,x
	PLA
	RTL

DATA_078822:
	dw $0080,$FF80

CODE_078826:
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
;-------------------------------------------------------------------------
; Shyguy On Stilts ($0F2) -- Stomp/head-bop routine.
; Removes the stilts (shrinks the Y position + swaps sprite ID to a
; plain shy-guy). Raidenthequick: head_bop_stilt_guy.
;-------------------------------------------------------------------------
YI_NorSpr0F2_ShyguyOnStilts_StompRt:
head_bop_stilt_guy:                        ; Raidenthequick: head_bop_stilt_guy
	PHX
	LDA.w #!Define_YI_AmbSpr1F7
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC
	ORA.w $7002,y
	STA.w $7002,y
	LDA.w $7400,x
	STA.w $73C0,y
	TAX
	LDA.w DATA_0791BA,x
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$00C0
	STA.w $7782,y
	PLX
	PHY
	JSL.l CODE_despawn_sprite_clear_graphics
	PLY
	LDA.w #!Define_YI_NorSpr01E_Shyguy
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w $7182,x
	SEC
	SBC.w #$0018
	STA.w $7182,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_07888A
	CMP.w #$000E
	BNE.b CODE_078890
CODE_07888A:
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
CODE_078890:
	RTL

;---------------------------------------------------------------------------

DATA_078891:
	dw $FF80,$0080

DATA_078895:
	db $16,$17,$18,$17,$19,$17,$18,$17,$19,$17,$18,$17,$19,$17,$17,$1A
	db $1B,$1A

;-------------------------------------------------------------------------
; Slugger ($0F5) -- Init handler.
; The W2-3 baseball-bat Shy Guy. Hits eggs back at Yoshi. Init seeds
; the swing-cycle timer. Raidenthequick: init_slugger.
;-------------------------------------------------------------------------
YI_NorSpr0F5_Slugger_Init:
init_slugger:                              ; Raidenthequick: init_slugger
;$0788A7
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_0788B3
	LDA.w $70E2,x
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_0788B3:
	LDA.w DATA_078932
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A96,x
	LDY.w $7400,x
	LDA.w DATA_078891,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

DATA_0788CF:
	dw $FF00,$0100

;-------------------------------------------------------------------------
; Slugger ($0F5) -- Main handler.
; Per frame: walk, watch for incoming eggs, swing-on-arrival, deflect
; back as projectile damaging Yoshi. Raidenthequick: main_slugger.
;-------------------------------------------------------------------------
YI_NorSpr0F5_Slugger_Main:
main_slugger:                              ; Raidenthequick: main_slugger
;$0788D3
	LDA.w $7042,x
	AND.w #$FFF1
	LDY.w $7D38,x
	BEQ.b CODE_0788E1
	ORA.w #$0004
CODE_0788E1:
	STA.w $7042,x
	JSL.l CODE_03AF23
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_0788F0
	JMP.w CODE_078EC3

CODE_0788F0:
	LDA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	BNE.b CODE_0788FB
	JSL.l CODE_07FC2A
	BCS.b CODE_07890A
CODE_0788FB:
	JSL.l CODE_03A5B7
	JSR.w CODE_078DE5
	TXY
	LDA.b $16,x
	ASL
	TAX
	JMP.w (DATA_slugger_state_ptr,x)

CODE_07890A:
	LDY.w $77C2,x
	LDA.w DATA_0788CF,y
	STA.w $60A8
	STA.w $60B4
	LDA.w $6FA2,x
	AND.w #$FCFF
	STA.w $6FA2,x
	LDA.w #DATA_078895
	STA.b $00
	JSR.w CODE_07A580
	RTL

DATA_078928:
DATA_slugger_state_ptr:                         ; 5-entry Slugger state ptr: walk / pick-up-bat / wind-up / swing / cooldown
	dw CODE_078937
	dw CODE_078A26
	dw CODE_078AEA
	dw CODE_078BB5
	dw CODE_078CD4

DATA_078932:
	db $00,$01,$02,$03,$04

CODE_078937:
	TYX
	LDA.w $7400,x
	TAY
	LDA.w DATA_078891,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JSR.w CODE_078EF1
	BCC.b CODE_078962
	JSR.w CODE_078F2C
	BCC.b CODE_078962
	JSR.w CODE_078F27
	BCC.b CODE_078962
	LDA.w #$0030
	STA.b $04
	STA.b $08
	ASL
	STA.b $06
	STA.b $0A
	JSR.w CODE_078CF1
	BMI.b CODE_07898D
CODE_078962:
	LDA.w #$0003
	STA.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $02
	STA.w $7400,x
	LDA.w #$0000
	STA.b $18,x
	TAY
	LDA.w DATA_078CB2,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_078CC3,y
	AND.w #$00FF
	STA.w $7A96,x
	STZ.b $76,x
	JSR.w CODE_07A218
	RTL

CODE_07898D:
	LDA.w #$0020
	STA.b $04
	STA.b $08
	ASL
	STA.b $06
	STA.b $0A
	JSR.w CODE_078D33
	BMI.b CODE_0789C9
	LDA.w #$0002
	STA.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $02
	STA.w $7400,x
	LDA.w #$0000
	STA.b $18,x
	TAY
	LDA.w DATA_078ADE,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_078AE2,y
	AND.w #$00FF
	STA.w $7A96,x
	STZ.b $76,x
	JSR.w CODE_07A218
	RTL

CODE_0789C9:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0789DD
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC
	SEC
	SBC.w #$0018
	CMP.w $70E2,x
	BPL.b CODE_0789EA
	BRA.b CODE_0789FA

CODE_0789DD:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC
	CLC
	ADC.w #$0018
	CMP.w $70E2,x
	BPL.b CODE_0789FA
CODE_0789EA:
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_078891,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0789FA:
	LDA.w $7A96,x
	BNE.b CODE_078A1D
	LDA.b $18,x
	INC
	CMP.w #$0005
	BCC.b CODE_078A0A
	LDA.w #$0000
CODE_078A0A:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	TAY
	LDA.w DATA_078932,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A96,x
CODE_078A1D:
	RTL

DATA_078A1E:
	db $08,$07,$06,$05

DATA_078A22:
	db $20,$04,$04,$10

CODE_078A26:
	TYX
	JSR.w CODE_078EF1
	BCC.b CODE_078A47
	JSR.w CODE_078F2C
	BCC.b CODE_078A47
	JSR.w CODE_078F27
	BCC.b CODE_078A47
	LDA.w #$0030
	STA.b $04
	STA.b $08
	ASL
	STA.b $06
	STA.b $0A
	JSR.w CODE_078CF1
	BMI.b CODE_078A72
CODE_078A47:
	LDA.w #$0003
	STA.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $02
	STA.w $7400,x
	LDA.w #$0000
	STA.b $18,x
	TAY
	LDA.w DATA_078CB2,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_078CC3,y
	AND.w #$00FF
	STA.w $7A96,x
	STZ.b $76,x
	JSR.w CODE_07A218
	RTL

CODE_078A72:
	LDA.w #$0020
	STA.b $04
	STA.b $08
	ASL
	STA.b $06
	STA.b $0A
	JSR.w CODE_078D33
	BMI.b CODE_078AAE
	LDA.w #$0002
	STA.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $02
	STA.w $7400,x
	LDA.w #$0000
	STA.b $18,x
	TAY
	LDA.w DATA_078ADE,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_078AE2,y
	AND.w #$00FF
	STA.w $7A96,x
	STZ.b $76,x
	JSR.w CODE_07A218
	RTL

CODE_078AAE:
	LDA.w $7A96,x
	BNE.b CODE_078ADD
	LDA.b $18,x
	INC
	CMP.w #$0004
	BCC.b CODE_078AC7
	LDA.w #$0000
	STA.w $7A96,x
	LDA.w #$0004
	STA.b $16,x
	RTL

CODE_078AC7:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	TAY
	LDA.w DATA_078A1E,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_078A22,y
	AND.w #$00FF
	STA.w $7A96,x
CODE_078ADD:
	RTL

DATA_078ADE:
	db $05,$06,$07,$08

DATA_078AE2:
	db $04,$02,$02,$02

DATA_078AE6:
	dw $FFE8,$0018

CODE_078AEA:
	TYX
	JSR.w CODE_078EF1
	BCC.b CODE_078B1C
	JSR.w CODE_078F2C
	BCC.b CODE_078B1C
	JSR.w CODE_078F27
	BCC.b CODE_078B1C
	LDA.w #$0018
	STA.b $04
	STA.b $08
	ASL
	STA.b $06
	STA.b $0A
	JSR.w CODE_078D33
	BPL.b CODE_078B1C
	LDA.w #$0030
	STA.b $04
	STA.b $08
	ASL
	STA.b $06
	STA.b $0A
	JSR.w CODE_078CF1
	BMI.b CODE_078B47
CODE_078B1C:
	LDA.w #$0003
	STA.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $02
	STA.w $7400,x
	LDA.w #$0000
	STA.b $18,x
	TAY
	LDA.w DATA_078CB2,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_078CC3,y
	AND.w #$00FF
	STA.w $7A96,x
	STZ.b $76,x
	JSR.w CODE_07A218
	RTL

CODE_078B47:
	LDA.w #$0020
	STA.b $04
	STA.b $08
	ASL
	STA.b $06
	STA.b $0A
	JSR.w CODE_078D33
	BPL.b CODE_078B8E
	LDA.w #$0001
	STA.b $16,x
	LDA.b $02
	STA.w $7400,x
	LDA.w #$0000
	STA.b $18,x
	TAY
	LDA.w DATA_078A1E,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_078A22,y
	AND.w #$00FF
	STA.w $7A96,x
	RTL

CODE_078B7B:
	CMP.w $7400,x
	BEQ.b CODE_078B8E
	STA.w $7400,x
	TAY
	LDA.w $70E2,x
	CLC
	ADC.w DATA_078AE6,y
	STA.w $70E2,x
CODE_078B8E:
	LDA.w $7A96,x
	BNE.b CODE_078BB4
	LDA.b $18,x
	INC
	CMP.w #$0004
	BCC.b CODE_078B9E
	LDA.w #$0003
CODE_078B9E:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	TAY
	LDA.w DATA_078ADE,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_078AE2,y
	AND.w #$00FF
	STA.w $7A96,x
CODE_078BB4:
	RTL

CODE_078BB5:
	LDX.b $12
	LDY.b $18,x
	CPY.b #$08
	BCC.b CODE_078BC2
	JSR.w CODE_078F2C
	BCC.b CODE_078BEB
CODE_078BC2:
	LDA.b $18,x
	SEC
	SBC.w #$0001
	CMP.w #$0007
	BCC.b CODE_078C0B
	CMP.w #$0010
	BCS.b CODE_078BE8
	LDA.w #$0030
	STA.b $04
	STA.b $08
	ASL
	STA.b $06
	STA.b $0A
	JSR.w CODE_078CF1
	BMI.b CODE_078BE8
	TYA
	CMP.b $78,x
	BNE.b CODE_078BEB
CODE_078BE8:
	JMP.w CODE_078C84

CODE_078BEB:
	LDA.b $02
	STA.w $7400,x
	LDA.w #$0000
	STA.b $18,x
	TAY
	LDA.w DATA_078CB2,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_078CC3,y
	AND.w #$00FF
	STA.w $7A96,x
	STZ.b $76,x
	RTL

CODE_078C0B:
	LDA.b $76,x
	BNE.b CODE_078C84
	JSR.w CODE_078E3E
	JSR.w CODE_078F76
	JSR.w CODE_078FA0
	LDA.w #$0008
	STA.b $04
	ASL
	STA.b $06
	LDA.w #$0010
	STA.b $08
	ASL
	STA.b $0A
	JSR.w CODE_078CF1
	BMI.b CODE_078C84
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_078C47
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BCS.b CODE_078C47
	LDA.w #$0001
	STA.w $7A36,y
	SEP.b #$20
	STA.w $77C0,y
	REP.b #$20
CODE_078C47:
	LDA.w $70E2,y
	SEC
	SBC.w $72C0,y
	STA.w $70E2,y
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w $7182,y
	SEC
	SBC.w $72C2,y
	STA.w $7182,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	TYA
	STA.b $78,x
	INC.b $76,x
	LDA.w $7CD6,y
	STA.b $00
	LDA.w $7CD8,y
	STA.b $02
	JSR.w CODE_07FD16
	LDA.w #!Define_YI_SoundID67_EnemyTumbling
	JSL.l CODE_push_sound_queue
CODE_078C84:
	LDA.w $7A96,x
	BNE.b CODE_078CB1
	LDA.b $18,x
	INC
	CMP.w #$0011
	BCC.b CODE_078C9B
	LDA.w #$0000
	STA.w $7A96,x
	INC.b $16,x
	BRA.b CODE_078CB1

CODE_078C9B:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	TAY
	LDA.w DATA_078CB2,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_078CC3,y
	AND.w #$00FF
	STA.w $7A96,x
CODE_078CB1:
	RTL

DATA_078CB2:
	db $08,$06,$09,$0A,$0B,$0C,$0D,$0E,$0F,$10,$11,$12,$13,$14,$15,$09
	db $05

DATA_078CC3:
	db $01,$01,$01,$01,$01,$01,$01,$01,$20,$01,$01,$01,$02,$02,$03,$03
	db $10

CODE_078CD4:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_078CF0
	LDA.w #$0000
	STA.b $16,x
	STZ.b $18,x
	LDA.w DATA_078932
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A96,x
CODE_078CF0:
	RTL

CODE_078CF1:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	PHX
	LDX.b #FXCODE_098F33>>16
	LDA.w #FXCODE_098F33
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_078D32
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	PHA
	AND.w #$8000
	ASL
	ROL
	ASL
	STA.b $02
	PLA
	CLC
	ADC.b $04
	CMP.b $06
CODE_078D1B:
	BCS.b CODE_078D2F
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	CLC
	ADC.b $08
	CMP.b $0A
	BCS.b CODE_078D2F
	CPY.b #$00
	BRA.b CODE_078D32

CODE_078D2F:
	LDA.w #$FFFF
CODE_078D32:
	RTS

CODE_078D33:
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	PHA
	AND.w #$8000
	ASL
	ROL
	ASL
	STA.b $02
	PLA
	CLC
	ADC.b $04
	CMP.b $06
	BCS.b CODE_078D5D
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.b $08
	CMP.b $0A
	BCS.b CODE_078D5D
	LDA.b $02
	BRA.b CODE_078D60

CODE_078D5D:
	LDA.w #$FFFF
CODE_078D60:
	RTS

DATA_078D61:
	dw $000A,$FFF6,$000A,$FFF6,$000A,$FFF6,$000B,$FFF5
	dw $000A,$FFF6,$0008,$FFF8,$000C,$FFF4,$000F,$FFF1
	dw $0008,$FFF8,$0010,$FFF0,$0008,$FFF8,$FFEC,$0014
	dw $FFEE,$0012,$FFFA,$0006,$0008,$FFF8,$0009,$FFF7
	dw $0001,$FFFF,$FFF6,$000A,$FFEC,$0014,$FFEE,$0012
	dw $0001,$FFFF,$000F,$FFF1

DATA_078DB9:
	dw $FFF7,$FFF6,$FFF5,$FFF6,$FFF8,$FFF3,$FFF3,$FFF1
	dw $FFED,$FFF7,$0009,$0004,$FFF4,$FFEC,$FFEE,$FFF1
	dw $FFEC,$FFEC,$FFF7,$0009,$000D,$0006

CODE_078DE5:
	LDA.w $6122
	ASL
	CLC
	ADC.w #$0004
	STA.b $00
	LDA.w $6120
	ASL
	CLC
	ADC.w #$0004
	STA.b $02
	LDA.w $7402,x
	ASL
	TAY
	LDA.w $7CD8,x
	CLC
	ADC.w DATA_078DB9,y
	SEC
	SBC.w $611E
	CLC
	ADC.w $6122
	CLC
	ADC.w #$0002
	CMP.b $00
	BCS.b CODE_078E39
	LDA.w $7402,x
	ASL
	ASL
	ORA.w $7400,x
	TAY
	LDA.w $7CD6,x
	CLC
	ADC.w DATA_078D61,y
	SEC
	SBC.w $611C
	CLC
	ADC.w $6120
	CLC
	ADC.w #$0002
	CMP.b $02
	BCS.b CODE_078E39
	JSL.l CODE_03A858
CODE_078E39:
	RTS

DATA_078E3A:
	dw $FE00,$0200

CODE_078E3E:
	LDA.b $76
	CMP.w #$000B
	BNE.b CODE_078EC2
	LDA.w $7BB8
	ASL
	CLC
	ADC.w #$0004
	STA.b $00
	LDA.w $7BB6
	ASL
	CLC
	ADC.w #$0004
	STA.b $02
	LDA.w $7402,x
	ASL
	TAY
	LDA.w $7CD8,x
	CLC
	ADC.w DATA_078DB9,y
	SEC
	SBC.w $7CD8
	CLC
	ADC.w $7BB8
	CLC
	ADC.w #$0002
	CMP.b $00
	BCS.b CODE_078E95
	LDA.w $7402,x
	ASL
	ASL
	ORA.w $7400,x
	TAY
	LDA.w $7CD6,x
	CLC
	ADC.w DATA_078D61,y
	SEC
	SBC.w $7CD6
	CLC
	ADC.w $7BB6
	CLC
	ADC.w #$0002
	CMP.b $02
	BCC.b CODE_078E9B
CODE_078E95:
	LDY.w $7D36,x
	DEY
	BNE.b CODE_078EC2
CODE_078E9B:
	LDY.w $7400,x
	LDA.w DATA_078E3A,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	LDA.w $7CD6
	STA.b $00
	LDA.w $7CD8
	STA.b $02
	JSR.w CODE_07FD16
	LDA.w #!Define_YI_SoundID67_EnemyTumbling
	JSL.l CODE_push_sound_queue
CODE_078EC2:
	RTS

CODE_078EC3:
	LDY.w $7D36,x
	BPL.b CODE_078EDA
	LDA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	BEQ.b CODE_078ED1
	JML.l CODE_kill_sprite_by_hit

CODE_078ED1:
	JSL.l CODE_07FC2F
	BCC.b CODE_078EDA
	JMP.w CODE_07890A

CODE_078EDA:
	LDA.w #DATA_078895
	STA.b $00
	JSR.w CODE_07A623
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_078EF0
	LDA.w $6FA2,x
	ORA.w #$0100
	STA.w $6FA2,x
CODE_078EF0:
	RTL

CODE_078EF1:
	LDA.b $76
	CMP.w #$000B
	BNE.b CODE_078F25
	LDA.w $70E2,x
	SEC
	SBC.w $70E2
	STA.b $02
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_078F25
	LDY.b #$00
	LDA.b $02
	BPL.b CODE_078F12
	INY
	INY
CODE_078F12:
	TYA
	STA.b $02
	LDA.w $7182,x
	SEC
	SBC.w $7182
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCC.b CODE_078F26
CODE_078F25:
	SEC
CODE_078F26:
	RTS

CODE_078F27:
	LDA.w #$011D
	BRA.b CODE_078F2F

CODE_078F2C:
	LDA.w #$009E
CODE_078F2F:
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098EBF>>16
	LDA.w #FXCODE_098EBF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_078F70
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	PHA
	AND.w #$8000
	ASL
	ROL
	ASL
	STA.b $02
	PLA
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_078F70
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCC.b CODE_078F71
CODE_078F70:
	SEC
CODE_078F71:
	RTS

DATA_078F72:
	dw $FC00,$0400

CODE_078F76:
	LDY.w $7400,x
	LDA.w DATA_078F72,y
	STA.b $0E
	LDA.w #$009E
	JSR.w CODE_078FD4
	BCS.b CODE_078F9F
	LDA.b $0E
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w $7CD6,y
	STA.b $00
	LDA.w $7CD8,y
	STA.b $02
	JSR.w CODE_07FD16
	LDA.w #!Define_YI_SoundID67_EnemyTumbling
	JSL.l CODE_push_sound_queue
CODE_078F9F:
	RTS

CODE_078FA0:
	LDY.w $7400,x
	LDA.w DATA_078F72,y
	STA.b $0E
	LDA.w #$011D
	JSR.w CODE_078FD4
	BCS.b CODE_078FD3
	LDA.b $0E
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $7CD6,y
	STA.b $00
	LDA.w $7CD8,y
	STA.b $02
	JSR.w CODE_07FD16
	LDA.w #!Define_YI_SoundID67_EnemyTumbling
	JSL.l CODE_push_sound_queue
CODE_078FD3:
	RTS

CODE_078FD4:
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098EBF>>16
	LDA.w #FXCODE_098EBF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_07901F
	LDA.w $7BB8,x
	CLC
	ADC.w $7BB8,y
	STA.b $00
	LDA.w $7BB6,x
	CLC
	ADC.w $7BB6,y
	STA.b $02
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	BPL.b CODE_07900A
	EOR.w #$FFFF
	INC
CODE_07900A:
	CMP.b $00
	BCS.b CODE_079020
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	BPL.b CODE_07901B
	EOR.w #$FFFF
	INC
CODE_07901B:
	CMP.b $02
	BCC.b CODE_079020
CODE_07901F:
	SEC
CODE_079020:
	RTS

;---------------------------------------------------------------------------

DATA_079021:
	dw $FFA8,$0058

;-------------------------------------------------------------------------
; Long Spear Guy ($0FB) -- Init handler.
; Spear Guys come in long and short variants -- both share the same
; Main below but enter via slightly different Init shims to set spear
; length / X-offset. Raidenthequick: init_spear_guy_long.
;-------------------------------------------------------------------------
YI_NorSpr0FB_LongSpearGuy_Init:
init_spear_guy_long:                       ; Raidenthequick: init_spear_guy_long
;$079025
	LDA.w #DATA_079261
	STA.b $18,x
	LDA.w #$0800
	BRA.b CODE_079037

;-------------------------------------------------------------------------
; Short Spear Guy ($0FC) -- Init handler. (Falls through to shared body.)
; Raidenthequick: init_spear_guy_short.
;-------------------------------------------------------------------------
YI_NorSpr0FC_ShortSpearGuy_Init:
init_spear_guy_short:                      ; Raidenthequick: init_spear_guy_short
;$07902F
	LDA.w #DATA_07926D
	STA.b $18,x
	LDA.w #$0000
CODE_079037:
	STA.b $78,x
	LDA.w #$0004
	STA.b $16,x
	SEP.b #$20
	TAY
	LDA.b #$04
	STA.w $7A96,x
	LDA.w DATA_07906F,y
	STA.w $7402,x
	TAY
	LDA.w DATA_079078,y
	STA.w $7B56,x
	LDA.w DATA_07907E,y
	STA.w $7BB6,x
	REP.b #$20
	LDY.w $7400,x
	LDA.w DATA_079021,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0003
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

DATA_07906B:
	dw $0004,$0002

DATA_07906F:
	db $04,$03,$02,$01,$00,$04,$04,$30,$01

DATA_079078:
	db $08,$08,$08,$08,$08,$06

DATA_07907E:
	db $06,$06,$06,$06,$06,$0A

DATA_079084:
	dw $0020,$0020

DATA_079088:
	dw $0200,$FE00

DATA_07908C:
	dw $FFE0,$0020

;-------------------------------------------------------------------------
; Spear Guy ($0FB/$0FC) -- shared Main handler.
; Both Long and Short Spear Guys run this body. Per-frame stab-cycle
; animation + damage check. Raidenthequick: main_spear_guy.
;-------------------------------------------------------------------------
YI_NorSpr0FB_LongSpearGuy_Main:
YI_NorSpr0FC_ShortSpearGuy_Main:
main_spear_guy:                            ; Raidenthequick: main_spear_guy
;$079090
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BEQ.b CODE_07909B
	JMP.w CODE_0790D1

CODE_07909B:
	LDA.w $77C2,x
	AND.w #$00FF
	EOR.w $7400,x
	BEQ.b CODE_0790A9
CODE_0790A6:
	JMP.w CODE_0791BF

CODE_0790A9:
	LDA.w $6150
	CMP.w #$0003
	BCS.b CODE_0790A6
	LDA.w #!Define_YI_SoundID3C_InedibleObject
	JSL.l CODE_push_sound_queue
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.w $6162
	STZ.w $6168
	PLA
	PLY
	JSL.l CODE_03AF23
	JSR.w CODE_079377
	LDY.b #$02
	BRA.b CODE_0790E1

CODE_0790D1:
	JSL.l CODE_03AF23
	JSL.l CODE_03A5B7
	JSR.w CODE_079279
	BPL.b CODE_0790E1
	JMP.w CODE_079135

CODE_0790E1:
	LDA.w DATA_07906B,y
	STA.b $76,x
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w #$0005
	STA.w $7402,x
	TAY
	LDA.w DATA_079078,y
	AND.w #$00FF
	STA.w $7B56,x
	LDA.w DATA_07907E,y
	AND.w #$00FF
	STA.w $7BB6,x
	LDA.w $6FA2,x
	AND.w #$FC3F
	ORA.w #$0080
	STA.w $6FA2,x
	LDA.w $7040,x
	ORA.w #$0004
	STA.w $7040,x
	LDY.w $7D36,x
	DEY
	BMI.b CODE_079135
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_079135
	LDA.w $7D38,y
	BEQ.b CODE_079135
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	JSR.w CODE_079377
CODE_079135:
	TXY
	LDX.b $76,y
	JMP.w (DATA_spear_guy_state_ptr,x)

DATA_07913B:
DATA_spear_guy_state_ptr:                       ; 3-entry Spear Guy state ptr: walk / throw / recover
	dw CODE_079141
	dw CODE_07916F
	dw CODE_0791BE

CODE_079141:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_07916E
	DEC.b $16,x
	BPL.b CODE_079150
	LDA.w #$0004
	STA.b $16,x
CODE_079150:
	SEP.b #$20
	LDY.b $16,x
	LDA.b #$04
	STA.w $7A96,x
	LDA.w DATA_07906F,y
	STA.w $7402,x
	TAY
	LDA.w DATA_079078,y
	STA.w $7B56,x
	LDA.w DATA_07907E,y
	STA.w $7BB6,x
	REP.b #$20
CODE_07916E:
	RTL

CODE_07916F:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_079178
	STZ.w $7540,x
CODE_079178:
	LDA.w $7A96,x
	BNE.b CODE_0791B9
	LDA.w #$0004
	STA.b $16,x
	SEP.b #$20
	TAY
	LDA.b #$04
	STA.w $7A96,x
	LDA.w DATA_07906F,y
	STA.w $7402,x
	TAY
	LDA.w DATA_079078,y
	STA.w $7B56,x
	LDA.w DATA_07907E,y
	STA.w $7BB6,x
	REP.b #$20
	LDY.w $7400,x
	LDA.w DATA_079021,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.b $76,x
	LDA.w $6FA2,x
	AND.w #$FC3F
	ORA.w #$0140
	STA.w $6FA2,x
CODE_0791B9:
	RTL

DATA_0791BA:
	dw $FF00,$0100

CODE_0791BE:
	TYX
CODE_0791BF:
	JSR.w CODE_0791E7
	JSL.l CODE_despawn_sprite_clear_graphics
	LDA.w #!Define_YI_NorSpr01E_Shyguy
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC
	ORA.w $7042,x
	STA.w $7042,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_0791E6
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
CODE_0791E6:
	RTL

CODE_0791E7:
	PHX
	LDA.w #!Define_YI_AmbSpr1EA
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w $7400,x
	STA.w $73C0,y
	TAX
	LDA.w DATA_0791BA,x
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0020
	STA.w $7782,y
	PLX
	PHX
	LDA.w #!Define_YI_AmbSpr1EB
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w $7000,y
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	STA.w $7000,y
	LDA.w $7400,x
	STA.w $73C0,y
	EOR.w #$0002
	TAX
	LDA.w DATA_0791BA,x
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0020
	STA.w $7782,y
	PLX
	RTS

DATA_079251:
	dw $0040,$0000

DATA_079255:
	dw $0008,$0009,$0009,$0008,$0008,$000A

DATA_079261:
	dw $FFE9,$FFEB,$FFEA,$FFE9,$FFE8,$FFEF

DATA_07926D:
	dw $FFF5,$FFF7,$FFF6,$FFF5,$FFF4,$FFF9

CODE_079279:
	JSR.w CODE_07931E
	LDY.w $7D36,x
	BEQ.b CODE_0792B9
	BMI.b CODE_0792B9
	DEY
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0792B9
	LDA.w $7D38,y
	BEQ.b CODE_0792B9
	LDX.b $12
	LDA.w $7C76,x
	AND.w #$8000
	ASL
	ROL
	ASL
	EOR.w $7400,x
	BEQ.b CODE_0792A3
	TAY
	RTS

CODE_0792A3:
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDX.b $12
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	JSR.w CODE_0791E7
	PLA
	JML.l CODE_kill_sprite_by_hit_checked

CODE_0792B9:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	PHX
	LDX.b #FXCODE_098F33>>16
	LDA.w #FXCODE_098F33
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_07931D
	LDA.w $7400,x
	LSR
	LSR
	ROR
	STA.b $00
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	STA.b $02
	EOR.b $00
	BMI.b CODE_07931B
	LDA.b $02
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BMI.b CODE_07931B
	LDA.b $02
	CLC
	ADC.w #$0018
	CMP.w #$0030
	BCS.b CODE_07931B
	LDA.b $02
	BPL.b CODE_0792FC
	EOR.w #$FFFF
	INC
CODE_0792FC:
	STA.b $04
	LSR
	STA.b $02
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	STA.b $00
	EOR.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	BMI.b CODE_07931B
	LDA.b $00
	CLC
	ADC.b $02
	CMP.b $04
	BCS.b CODE_07931B
	LDY.b #$02
	RTS

CODE_07931B:
	LDY.b #$FF
CODE_07931D:
	RTS

CODE_07931E:
	LDY.w $7D36,x
	BMI.b CODE_079376
	LDA.w $6122
	ASL
	STA.b $02
	LDA.b $18,x
	STA.b $00
	LDA.w $7402,x
	ASL
	TAY
	LDA.w $7182,x
	CLC
	ADC.b ($00),y
	SEC
	SBC.w $611E
	CLC
	ADC.w $6122
	CMP.b $02
	BCS.b CODE_079376
	LDA.w $7402,x
	ASL
	TAY
	LDA.w DATA_079255,y
	LDY.w $7400,x
	BEQ.b CODE_079358
	EOR.w #$FFFF
	CLC
	ADC.w #$0009
CODE_079358:
	STA.b $00
	LDA.w $6120
	ASL
	STA.b $02
	LDA.w $70E2,x
	CLC
	ADC.b $00
	SEC
	SBC.w $611C
	CLC
	ADC.w $6120
	CMP.b $02
	BCS.b CODE_079376
	JSL.l CODE_03A858
CODE_079376:
	RTS

CODE_079377:
	LDY.w $7400,x
	LDA.w DATA_079084,y
	STA.w $7540,x
	LDA.w DATA_079088,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w DATA_07908C,y
	STA.b $00
	LDA.w #!Define_YI_AmbSpr1E0
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $73C0,y
	LDA.w #$0004
	STA.w $7782,y
	STA.w $7E4C,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FFF0
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$000C
	STA.w $7142,y
	RTS

;---------------------------------------------------------------------------

DATA_0793C0:
	dw $FFA8,$0058

DATA_0793C4:
	dw $0100,$FF00

DATA_0793C8:
	dw $FFEC,$0005

DATA_0793CC:
	dw $FFF3,$FFFD

DATA_0793D0:
	dw $FFF8,$FFF8

DATA_0793D4:
	dw $0000,$0001,$0002,$0003,$0004

DATA_0793DE:
	dw $0005,$0006,$0007,$0008,$0009,$0008,$0005

DATA_0793EC:
	dw $0010,$0020,$0002,$0002,$0006,$0008,$0010

;-------------------------------------------------------------------------
; Snifit ($113) -- Init handler.
; Bubble-firing Snifits walk along a fixed path and shoot snorts. Init
; lays the patrol bounds + initial direction. Raidenthequick: CODE_init_snifit.
;-------------------------------------------------------------------------
YI_NorSpr113_Snifit_Init:
CODE_init_snifit:                               ; Raidenthequick: CODE_init_snifit
CODE_0793FA:
	LDY.w $7400,x
	LDA.w DATA_0793C0,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w DATA_0793D4
	STA.w $7402,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Snifit ($113) -- Main handler.
; Raidenthequick: main_snifit.
;-------------------------------------------------------------------------
YI_NorSpr113_Snifit_Main:
main_snifit:                               ; Raidenthequick: main_snifit
;$079410
	JSL.l CODE_03AF23
	LDA.b $16,x
	TAX
	JSR.w (DATA_snifit_state_ptr,x)
	JSL.l CODE_03A5B7
	RTL

DATA_07941F:
DATA_snifit_state_ptr:                          ; 2-entry Snifit state ptr: roaming / shooting
	dw CODE_079423
	dw CODE_079476

CODE_079423:
	LDX.b $12
	LDA.w $7680,x
	CMP.w #$00F0
	BCS.b CODE_079432
	LDA.w $7A98,x
	BEQ.b CODE_079454
CODE_079432:
	LDA.w $7A96,x
	BNE.b CODE_079475
	LDA.w #$0004
	STA.w $7A96,x
	LDA.b $18,x
	INC
	INC
	CMP.w #$000A
	BCC.b CODE_079449
	LDA.w #$0000
CODE_079449:
	STA.b $18,x
	TAY
	LDA.w DATA_0793D4,y
	STA.w $7402,x
	BRA.b CODE_079475

CODE_079454:
	STZ.b $18,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w DATA_0793EC
	STA.w $7A96,x
	LDA.w DATA_0793DE
	STA.w $7402,x
	LDA.w $6FA2,x
	AND.w #$F83F
	ORA.w #$0400
	STA.w $6FA2,x
	INC.b $16,x
	INC.b $16,x
CODE_079475:
	RTS

CODE_079476:
	LDX.b $12
	LDA.b $76,x
	BEQ.b CODE_079486
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_079486
	STZ.w $7540,x
	STZ.b $76,x
CODE_079486:
	LDA.w $7A96,x
	BNE.b CODE_0794B5
	LDA.b $18,x
	INC
	INC
	CMP.w #$000E
	BCS.b CODE_0794B8
	STA.b $18,x
	TAY
	LDA.w DATA_0793EC,y
	STA.w $7A96,x
	LDA.w DATA_0793DE,y
	STA.w $7402,x
	TYX
	JMP.w (DATA_snifit_shoot_anim_ptr,x)

DATA_0794A7:
DATA_snifit_shoot_anim_ptr:                     ; 7-entry Snifit shoot-animation frame dispatch (most frames idle, two emit projectile)
	dw CODE_0794B5
	dw CODE_0794D3
	dw CODE_07950D
	dw CODE_0794B5
	dw CODE_0794B5
	dw CODE_0794B5
	dw CODE_0794B5

CODE_0794B5:
	LDX.b $12
	RTS

CODE_0794B8:
	STZ.b $16,x
	STZ.b $18,x
	LDA.w $6FA2,x
	AND.w #$F83F
	ORA.w #$0140
	STA.w $6FA2,x
	LDA.w #$0080
	STA.w $7A98,x
	JSL.l CODE_init_snifit
	RTS

CODE_0794D3:
	LDX.b $12
	LDY.w $7400,x
	LDA.w DATA_0793CC,y
	STA.b $00
	LDA.w #!Define_YI_AmbSpr1F5
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7CD6,x
	CLC
	ADC.b $00
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$000A
	STA.w $7142,y
	LDA.w $7400,x
	STA.w $73C0,y
	LDA.w #$0006
	STA.w $7E4C,y
	STA.w $7782,y
	LDA.w #$0002
	STA.w $7E4E,y
	RTS

CODE_07950D:
	LDX.b $12
	INC.b $76,x
	LDY.w $7400,x
	LDA.w DATA_0793C4,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0010
	STA.w $7540,x
	LDA.w DATA_07958D,y
	STA.b $00
	LDA.w DATA_0793C8,y
	STA.b $02
	LDA.w DATA_0793D0,y
	STA.b $04
	LDA.w #$0114
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_079556
	LDA.w $7CD6,x
	CLC
	ADC.b $02
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0001
	STA.w $7182,y
	LDA.w $7400,x
	STA.w $7400,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
CODE_079556:
	LDA.w #!Define_YI_AmbSpr1F6
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7CD6,x
	CLC
	ADC.b $04
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0004
	STA.w $7142,y
	LDA.w $7400,x
	STA.w $73C0,y
	LDA.w #$0002
	STA.w $7E4C,y
	STA.w $7782,y
	LDA.w #$0005
	STA.w $7E4E,y
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	RTS

;---------------------------------------------------------------------------

DATA_07958D:
	dw $FE00,$0200

;-------------------------------------------------------------------------
; Snifit Bullet ($114) -- Init handler.
; The bubble projectile spawned by Snifit's snort.
; Raidenthequick: init_snifit_bullet.
;-------------------------------------------------------------------------
YI_NorSpr114_SnifitBullet_Init:
init_snifit_bullet:                        ; Raidenthequick: init_snifit_bullet
;$079591
	LDY.w $7400,x
	LDA.w DATA_07958D,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Snifit Bullet ($114) -- Main handler.
; Linear travel + Yoshi-contact damage. Despawns off-screen.
; Raidenthequick: main_snifit_bullet.
;-------------------------------------------------------------------------
YI_NorSpr114_SnifitBullet_Main:
main_snifit_bullet:                        ; Raidenthequick: main_snifit_bullet
;$07959B
	JSL.l CODE_03AF23
	LDY.w $7D36,x
	BPL.b CODE_0795A8
	JSL.l CODE_03A858
CODE_0795A8:
	RTL

;---------------------------------------------------------------------------

DATA_0795A9:
	db $03,$04,$05,$06

DATA_0795AD:
	db $08,$02

DATA_0795AF:
	db $01,$02,$01,$00,$01,$02,$01,$00,$01,$02,$01,$00,$01,$02,$01,$00
	db $01,$02,$01,$00

DATA_0795C3:
	db $08,$09,$08,$07,$08,$0C,$0B,$0A,$08,$0C,$0B,$0A,$08,$09,$08,$07

DATA_0795D3:
	db $0E,$0F,$10,$0F,$0E,$0D,$0E,$0F,$10,$0F,$0E,$0D,$0E,$0F,$10,$0F
	db $0E,$0D

DATA_0795E5:
	db $00,$11,$11,$00,$00,$11,$11,$00,$00,$11,$11,$00,$00

DATA_0795F2:
	db $08,$03,$03,$05,$05,$03,$03,$05,$05,$03,$03,$05,$05

DATA_0795FF:
	db $00,$02,$00,$00,$00,$02,$00,$00,$00,$02,$00,$00,$00,$00,$FF,$00
	db $01

DATA_079610:
	dw $FC80,$0380,$FF00,$0100,$0008,$0004,$0100,$FF00

DATA_079620:
	dw $FFE0,$0020

DATA_079624:
	db $06,$04,$02,$02

;-------------------------------------------------------------------------
; Poochy ($0FF) -- Init handler.
; Poochy is the rideable dog that lets Yoshi cross lava/spikes safely.
; Init sets up the path-follower state + the "Yoshi-mounted" flag.
; Raidenthequick: init_poochy.
;-------------------------------------------------------------------------
YI_NorSpr0FF_Poochy_Init:
init_poochy:                               ; Raidenthequick: init_poochy
;$079628
	LDA.w !RAM_YI_Level_NorSpr_PoochyExistsFlagLo
	BEQ.b CODE_079631
	JML.l CODE_03A31E

CODE_079631:
	INC.w !RAM_YI_Level_NorSpr_PoochyExistsFlagLo
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Poochy ($0FF) -- Main handler.
; Path-following dog with rider-attachment physics. ~1200-line body --
; one of the largest sprite Mains in the bank. Handles tail-wag anim,
; foot-step sound triggers, jump physics, and the "Yoshi rides on top"
; offset chain. Raidenthequick: main_poochy.
;-------------------------------------------------------------------------
YI_NorSpr0FF_Poochy_Main:
main_poochy:                               ; Raidenthequick: main_poochy
;$079635
	JSL.l CODE_03AF23
	JSL.l CODE_03A5B7
	LDA.w $7182,x
	CMP.w #$0800
	BMI.b CODE_07964C
	STZ.w !RAM_YI_Level_NorSpr_PoochyExistsFlagLo
	JML.l CODE_03A31E

CODE_07964C:
	JSR.w CODE_079D3D
	JSR.w CODE_079EA0
	JSR.w CODE_079B88
	JSR.w CODE_079C71
	JSR.w CODE_079CBC
	LDA.w !RAM_YI_Level_NorSpr_PoochyExistsFlagLo
	BNE.b CODE_079669
	LDA.w $7040,x
	ORA.w #$0004
	STA.w $7040,x
CODE_079669:
	LDA.b $16,x
	TAX
	JSR.w (DATA_poochy_state_ptr,x)
	RTL

DATA_079670:
DATA_poochy_state_ptr:                          ; 3-entry Poochy main-state ptr: idle-walk / bouncing / unused-2
	dw CODE_07967A
	dw CODE_0799AE
	dw CODE_079A3B

DATA_079676:
	dw $001D,$FFE3

CODE_07967A:
	LDX.b $12
	JSR.w CODE_079960
	LDY.b $77,x
	BEQ.b CODE_079696
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	TYX
	JMP.w (DATA_poochy_active_substate_ptr,x)

DATA_07968A:
DATA_poochy_active_substate_ptr:                ; 6-entry Poochy active sub-state ptr (Yoshi-mounted variants)
	dw CODE_0797EE
	dw CODE_0797EE
	dw CODE_0798D9
	dw CODE_07992B
	dw CODE_0798D9
	dw CODE_07992B

CODE_079696:
	LDA.w !RAM_YI_Level_NorSpr_PoochyExistsFlagLo
	BNE.b CODE_07969E
	JMP.w CODE_079B48

CODE_07969E:
	LDA.w #$0300
	STA.b $00
	ASL
	STA.b $02
	JSR.w CODE_079C2E
	BCS.b CODE_0796EF
	LDA.w $60DE
	BNE.b CODE_0796B6
	LDY.b $76,x
	BEQ.b CODE_0796B6
	BPL.b CODE_0796CB
CODE_0796B6:
	LDA.w $7A98,x
	BNE.b CODE_0796E0
	LDA.w $77C2,x
	AND.w #$00FF
	DEC
	STA.b $02
	LDA.w $7C16,x
	STA.b $00
	BRA.b CODE_0796FD

CODE_0796CB:
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	STA.b $00
	AND.w #$8000
	ASL
	ROL
	ASL
	DEC
	STA.b $02
	JMP.w CODE_079825

CODE_0796E0:
	LDA.w $7400,x
	TAY
	DEC
	STA.b $02
	LDA.w DATA_079676,y
	STA.b $00
	JMP.w CODE_079825

CODE_0796EF:
	LDY.b $76,x
	BEQ.b CODE_0796FA
	BPL.b CODE_0796CB
	LDA.w $7A98,x
	BNE.b CODE_0796E0
CODE_0796FA:
	JMP.w CODE_07976A

CODE_0796FD:
	STZ.w $75E0,x
	LDA.w #$0010
	STA.w $7540,x
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BNE.b CODE_07974E
	LDA.b $00
	BPL.b CODE_079719
	EOR.w #$FFFF
	INC
CODE_079719:
	CMP.w #$0030
	BMI.b CODE_07974E
	LDA.w $7540,x
	ASL
	STA.b $04
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w $7540,x
	CMP.b $04
	BCS.b CODE_07973D
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.b $02
	INC
	CMP.w $7400,x
	BNE.b CODE_07976A
CODE_07973D:
	LDY.w $7400,x
	LDA.w DATA_079610,y
	STA.w $75E0,x
	LDA.w #$0030
	STA.w $7540,x
	BRA.b CODE_0797B8

CODE_07974E:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_07975C
	LDA.w $7400,x
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0797B8
CODE_07975C:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.b $02
	INC
	CMP.w $7400,x
	BEQ.b CODE_079783
CODE_07976A:
	LDY.b #$02
	STY.b $77,x
	LDY.b #$0C
	STY.b $18,x
	SEP.b #$20
	LDA.w DATA_0795F2,y
	STA.w $7A96,x
	LDA.w DATA_0795E5,y
	STA.w $7402,x
	REP.b #$20
	RTS

CODE_079783:
	LDA.w $7A96,x
	BNE.b CODE_0797B7
	LDY.b #$00
	LDA.w $60DE
	BEQ.b CODE_079791
	LDY.b #$01
CODE_079791:
	LDA.w DATA_0795AD,y
	AND.w #$00FF
	STA.w $7A96,x
	LDA.b $18,x
	DEC
	AND.w #$0003
	STA.b $18,x
	TAY
	LDA.w DATA_0795AF,y
	AND.w #$00FF
	STA.w $7402,x
	CPY.b #$00
	BNE.b CODE_0797B7
	LDA.w #!Define_YI_SoundIDA2_Poochy
	JSL.l CODE_push_sound_queue
CODE_0797B7:
	RTS

CODE_0797B8:
	LDA.w $7A96,x
	BNE.b CODE_0797ED
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0797C6
	EOR.w #$FFFF
	INC
CODE_0797C6:
	XBA
	SEP.b #$20
	AND.b #$03
	TAY
	LDA.w DATA_079624,y
	STA.w $7A96,x
	LDA.b $18,x
	INC
	AND.b #$03
	STA.b $18,x
	TAY
	LDA.w DATA_0795A9,y
	STA.w $7402,x
	REP.b #$20
	CPY.b #$00
	BNE.b CODE_0797ED
	LDA.w #!Define_YI_SoundIDA2_Poochy
	JSL.l CODE_push_sound_queue
CODE_0797ED:
	RTS

CODE_0797EE:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_079815
	LDY.b $18,x
	DEY
	BMI.b CODE_079816
	STY.b $18,x
	SEP.b #$20
	LDA.w $7400,x
	EOR.w DATA_0795FF,y
	STA.w $7400,x
	LDA.w DATA_0795E5,y
	STA.w $7402,x
	LDA.w DATA_0795F2,y
	STA.w $7A96,x
	REP.b #$20
CODE_079815:
	RTS

CODE_079816:
	LDY.b #$00
	STY.b $77,x
	LDY.b $76,x
	BPL.b CODE_079822
	LDY.b #$00
	STY.b $76,x
CODE_079822:
	STZ.b $18,x
	RTS

CODE_079825:
	STZ.w $75E0,x
	LDA.w #$0010
	STA.w $7540,x
	LDA.b $00
	CLC
	ADC.w #$001C
	CMP.w #$0038
	BCC.b CODE_07986A
	LDA.w $7540,x
	ASL
	STA.b $04
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w $7540,x
	CMP.b $04
	BCS.b CODE_079858
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.b $02
	INC
	CMP.w $7400,x
	BNE.b CODE_07988E
CODE_079858:
	LDY.w $7400,x
	LDA.w DATA_079610,y
	STA.w $75E0,x
	LDA.w #$0030
	STA.w $7540,x
	JMP.w CODE_0797B8

CODE_07986A:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_079876
	EOR.b $02
	BPL.b CODE_079876
	JMP.w CODE_0797B8

CODE_079876:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.b $02
	INC
	CMP.w $7400,x
	BNE.b CODE_07988E
	LDY.b $76,x
	LDA.w $7D38,y
	BEQ.b CODE_079891
	JMP.w CODE_079783

CODE_07988E:
	JMP.w CODE_07976A

CODE_079891:
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCC.b CODE_0798A4
	JMP.w CODE_07997B

CODE_0798A4:
	SEP.b #$20
	LDA.b $10
	AND.b #$06
	CLC
	ADC.b #$04
	STA.b $77,x
	TAX
	REP.b #$20
	JMP.w (DATA_0798B5,x)

DATA_0798B5:
	dw CODE_0798C1
	dw CODE_0798C1
	dw CODE_0798C1
	dw CODE_079913
	dw CODE_0798C1
	dw CODE_079948

CODE_0798C1:
	LDX.b $12
	LDA.w #$000F
	STA.b $18,x
	TAY
	LDA.w DATA_0795C3,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A96,x
	RTS

CODE_0798D9:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07990D
	DEC.b $18,x
	BMI.b CODE_07990E
	LDY.b $18,x
	LDA.w DATA_0795C3,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A96,x
	CPY.b #$09
	BNE.b CODE_07990D
	LDY.b $76,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0040
	STA.w $7542,y
	LDA.w #$0001
	STA.w $7D38,y
CODE_07990D:
	RTS

CODE_07990E:
	LDY.b #$00
	STY.b $77,x
	RTS

CODE_079913:
	LDX.b $12
	LDA.w #$0011
	STA.b $18,x
	TAY
	LDA.w DATA_0795D3,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7A96,x
	RTS

CODE_07992B:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_079947
	DEC.b $18,x
	BMI.b CODE_07990E
	LDY.b $18,x
	LDA.w DATA_0795D3,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7A96,x
CODE_079947:
	RTS

CODE_079948:
	LDX.b $12
	LDA.w #$0013
	STA.b $18,x
	TAY
	LDA.w DATA_0795AF,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7A96,x
	RTS

CODE_079960:
	LDY.w $7862,x
	BNE.b CODE_07996D
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_0799A7
CODE_07996D:
	LDA.w $7860,x
	BIT.w #$000C
	BNE.b CODE_07997A
	RTS

DATA_079976:
	dw $FF00,$0100

CODE_07997A:
	PLA
CODE_07997B:
	LDA.b $78,x
	BNE.b CODE_07998D
	LDA.w #$0006
	STA.w $7A96,x
	LDA.w #$000D
	STA.w $7402,x
	INC.b $78,x
CODE_07998D:
	LDY.w $7400,x
	LDA.w DATA_079976,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w $7A96,x
	BNE.b CODE_0799A6
	LDA.w #$FA00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.b $78,x
CODE_0799A6:
	RTS

CODE_0799A7:
	LDA.w #$0002
	STA.b $16,x
	PLA
	RTS

CODE_0799AE:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0799BA
	LDY.w $7862,x
	BNE.b CODE_0799F2
CODE_0799BA:
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_0799F2
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_0799D0
	LDY.w $7400,x
	LDA.w DATA_079976,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_0799D0:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCS.b CODE_0799E1
	LDA.w #$0004
	BRA.b CODE_0799EE

CODE_0799E1:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_0799EB
	LDA.w #$0003
	BRA.b CODE_0799EE

CODE_0799EB:
	LDA.w #$0005
CODE_0799EE:
	STA.w $7402,x
	RTS

CODE_0799F2:
	LDA.w #$0000
	STA.b $16,x
	RTS

CODE_0799F8:
	LDA.w $7860,x
	BIT.w #$000C
	BEQ.b CODE_079A26
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0040
	STA.w $7542,x
	STZ.b $18,x
	STZ.b $76,x
	STZ.b $78,x
	STZ.w $7A36,x
	STZ.w $7A38,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BRA.b CODE_0799A7

CODE_079A26:
	RTS

CODE_079A27:
	STZ.b $76,x
	STZ.b $78,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.b $18,x
	LDA.w #$0004
	STA.b $16,x
	RTS

DATA_079A39:
	db $05,$06

CODE_079A3B:
	LDX.b $12
	LDA.b $78,x
	TAX
	JMP.w (DATA_079A43,x)

DATA_079A43:
	dw CODE_079A47
	dw CODE_079B17

CODE_079A47:
	LDX.b $12
	JSR.w CODE_0799F8
	JSR.w CODE_079AB5
	JSR.w CODE_079A6F
	LDA.w $7A96,x
	BNE.b CODE_079A6E
	SEP.b #$20
	LDA.b $18,x
	EOR.b #$01
	STA.b $18,x
	LDY.b $18,x
	LDA.w DATA_079A39,y
	STA.w $7402,x
	LDA.b #$04
	STA.w $7A96,x
	REP.b #$20
CODE_079A6E:
	RTS

CODE_079A6F:
	LDA.w $7AF6,x
	BNE.b CODE_079AB0
	LDY.w $7862,x
	BEQ.b CODE_079A8D
	LDA.w #$FF00
	STA.w $75E2,x
	LDA.w #$0020
	STA.w $7542,x
	LDA.w #$0000
	STA.w $7AF6,x
	BRA.b CODE_079AB0

CODE_079A8D:
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0040
	STA.w $7542,x
	STZ.b $18,x
	STZ.b $76,x
	STZ.b $78,x
	STZ.w $7A36,x
	STZ.w $7A38,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0000
	STA.b $16,x
CODE_079AB0:
	RTS

DATA_079AB1:
	dw $FE00,$0200

CODE_079AB5:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098F33>>16
	LDA.w #FXCODE_098F33
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_079AF4
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_079AF4
	CMP.w #!Define_YI_NorSpr026_BowserFightGiantEgg
	BCS.b CODE_079AF4
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	STA.b $00
	LDA.w $7400,x
	DEC
	EOR.b $00
	BPL.b CODE_079AFF
CODE_079AEA:
	LDY.w $7400,x
	LDA.w DATA_079AB1,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_079AF4:
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BEQ.b CODE_079AEA
CODE_079AFF:
	LDA.w #$0002
	STA.b $78,x
	LDA.w #$0003
	STA.b $18,x
	LDA.w #$0004
	STA.w $7A96,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

DATA_079B13:
	db $00,$11,$11,$00

CODE_079B17:
	LDX.b $12
	JSR.w CODE_079A6F
	LDA.w $7A96,x
	BNE.b CODE_079B42
	DEC.b $18,x
	BMI.b CODE_079B43
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_079B13,y
	STA.w $7402,x
	LDA.b #$04
	STA.w $7A96,x
	CPY.b #$01
	BNE.b CODE_079B40
	LDA.w $7400,x
	EOR.b #$02
	STA.w $7400,x
CODE_079B40:
	REP.b #$20
CODE_079B42:
	RTS

CODE_079B43:
	STZ.b $18,x
	STZ.b $78,x
	RTS

CODE_079B48:
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BNE.b CODE_079B76
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_079B6D
	STZ.w $75E0,x
	LDA.w #$0010
	STA.w $7540,x
	LDA.w $7400,x
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_079B73
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_079B6D:
	STZ.w $7540,x
	JMP.w CODE_07976A

CODE_079B73:
	JMP.w CODE_0797B8

CODE_079B76:
	LDY.w $7400,x
	LDA.w DATA_079610,y
	STA.w $75E0,x
	LDA.w #$0030
	STA.w $7540,x
	JMP.w CODE_0797B8

CODE_079B88:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098F33>>16
	LDA.w #FXCODE_098F33
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_079BCB
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_079BCB
	CMP.w #!Define_YI_NorSpr026_BowserFightGiantEgg
	BCS.b CODE_079BCB
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCS.b CODE_079BCB
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCS.b CODE_079BCB
	STY.b $76,x
CODE_079BCB:
	LDY.b $76,x
	BEQ.b CODE_079C2D
	BMI.b CODE_079C2D
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_079C05
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_079C05
	CMP.w #!Define_YI_NorSpr026_BowserFightGiantEgg
	BCS.b CODE_079C05
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	BNE.b CODE_079C05
	LDA.w $7680,y
	CLC
	ADC.w #$0030
	CMP.w #$0150
	BCS.b CODE_079C05
	LDA.w $7682,y
	CLC
	ADC.w #$0030
	CMP.w #$0150
	BCS.b CODE_079C05
	BRA.b CODE_079C11

CODE_079C05:
	LDA.w #$0020
	STA.w $7A98,x
	LDY.b #$FF
	STY.b $76,x
	BRA.b CODE_079C1D

CODE_079C11:
	LDA.w $7680,x
	CLC
	ADC.w #$0028
	CMP.w #$0128
	BCC.b CODE_079C2D
CODE_079C1D:
	STZ.w $7A98,x
	LDY.b #$00
	STY.b $76,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $75E0,x
CODE_079C2D:
	RTS

CODE_079C2E:
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	STA.b $08
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	PHA
	BPL.b CODE_079C45
	EOR.w #$FFFF
	INC
CODE_079C45:
	STA.b $04
	PLA
	CLC
	ADC.b $00
	CMP.b $02
	BCS.b CODE_079C6C
	LDA.b $04
	ASL
	STA.b $04
	ASL
	STA.b $06
	LDA.b $08
	CLC
	ADC.b $04
	CMP.b $06
	BCC.b CODE_079C6C
	LDA.b $08
	CLC
	ADC.w #$0020
	BPL.b CODE_079C6B
	SEC
	BRA.b CODE_079C6C

CODE_079C6B:
	CLC
CODE_079C6C:
	RTS

DATA_079C6D:
	dw $0200,$FE00

CODE_079C71:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_079CB7
	BEQ.b CODE_079CB7
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_079CB7
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_079CB7
	CMP.w #!Define_YI_NorSpr026_BowserFightGiantEgg
	BCS.b CODE_079CB7
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	BNE.b CODE_079CB7
	LDA.w #$0001
	STA.w $7D38,y
	LDA.w #$0040
	STA.w $7542,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $7C76,x
	AND.w #$8000
	ASL
	ROL
	ASL
	TAX
	LDA.w DATA_079C6D,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDX.b $12
CODE_079CB7:
	RTS

DATA_079CB8:
	dw $0100,$FF00

CODE_079CBC:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_079CC9
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_079CF6
CODE_079CC9:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_079CD6:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_079CF6
	BEQ.b CODE_079CF6
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$000E
	BCC.b CODE_079CF7
	LDA.w $6FA2,y
	BIT.w #$6000
	BNE.b CODE_079CF7
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDX.b $12
CODE_079CF6:
	RTS

CODE_079CF7:
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_079CD6

CODE_079D02:
	LDA.w #$0001
	STA.w $7D38,y
	LDA.w #$0400
	STA.w $75E2,y
	LDA.w #$0040
	STA.w $7542,y
	LDA.w #$0000
	STA.w $7540,y
	STA.w $7860,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w $7C76,y
	AND.w #$8000
	ASL
	ROL
	ASL
	TAX
	LDA.w DATA_079CB8,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDX.b $12
	RTS

DATA_079D39:
	dw $0008,$0004

CODE_079D3D:
	LDY.w $77C0,x
	BNE.b CODE_079D52
	JSL.l CODE_07FC2A
	BCS.b CODE_079D49
	RTS

CODE_079D49:
	STZ.b $76,x
	SEP.b #$20
	INC.w $77C0,x
	REP.b #$20
CODE_079D52:
	JSR.w CODE_079CBC
	JSR.w CODE_079EA0
	LDY.w $7D36,x
	BPL.b CODE_079D74
	LDA.w $60AA
	BMI.b CODE_079D74
	LDA.w $60FC
	AND.w #$0007
	BNE.b CODE_079D74
	LDA.w $7182,x
	SEC
	SBC.w #$0022
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_079D74:
	LDY.b $77,x
	TYX
	JMP.w (DATA_079D7A,x)

DATA_079D7A:
	dw CODE_079D82
	dw CODE_079E1F
	dw CODE_079E26
	dw CODE_079E3E

CODE_079D82:
	LDX.b $12
	JSL.l CODE_07FC2F
	BCC.b CODE_079DDD
	LDA.w $60C4
	CMP.w $7400,x
	BEQ.b CODE_079DBE
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_079DA2
	LDY.w $7862,x
	BEQ.b CODE_079E19
	LDA.w $7860,x
CODE_079DA2:
	LDY.w $7400,x
	AND.w DATA_079D39,y
	BNE.b CODE_079E02
	LDY.w $7400,x
	LDA.w DATA_079610,y
	STA.w $75E0,x
	LDA.w #$0008
	STA.w $7540,x
CODE_079DB9:
	JSR.w CODE_0797B8
	BRA.b CODE_079E1D

CODE_079DBE:
	JSR.w CODE_079E7E
	BNE.b CODE_079DB9
	SEP.b #$20
	LDY.b #$02
	STY.b $77,x
	LDY.b #$03
	STY.b $18,x
	LDA.w DATA_0795F2,y
	STA.w $7A96,x
	LDA.w DATA_0795E5,y
	STA.w $7402,x
	REP.b #$20
	BRA.b CODE_079E1D

CODE_079DDD:
	JSR.w CODE_079E7E
	BNE.b CODE_079DB9
	LDA.w #$0000
	STA.b $16,x
	STZ.b $18,x
	STZ.b $76,x
	STZ.b $78,x
	STZ.w $7A36,x
	STZ.w $7A38,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEP.b #$20
	STZ.w $77C0,x
	REP.b #$20
	BRA.b CODE_079E1D

CODE_079E02:
	STZ.w $7540,x
	SEP.b #$20
	LDY.b #$04
	STY.b $77,x
	LDA.b #$06
	STA.w $7A96,x
	LDA.b #$0D
	STA.w $7402,x
	REP.b #$20
	BRA.b CODE_079E1D

CODE_079E19:
	LDY.b #$06
	STY.b $77,x
CODE_079E1D:
	PLA
	RTL

CODE_079E1F:
	LDX.b $12
	JSR.w CODE_0797EE
	BRA.b CODE_079E1D

CODE_079E26:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_079E1D
	LDY.w $7400,x
	LDA.w DATA_079976,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FA00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_079E19

CODE_079E3E:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_079E4E
	LDY.w $7400,x
	LDA.w DATA_079976,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_079E4E:
	LDY.w $7862,x
	BNE.b CODE_079E78
	LDY.b #$04
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCC.b CODE_079E72
	LDY.b #$03
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_079E72
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_079E78
	LDY.b #$05
CODE_079E72:
	TYA
	STA.w $7402,x
	BRA.b CODE_079E1D

CODE_079E78:
	LDY.b #$00
	STY.b $77,x
	BRA.b CODE_079E1D

CODE_079E7E:
	STZ.w $75E0,x
	LDA.w #$0040
	STA.w $7540,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_079E97
	AND.w #$8000
	ASL
	ROL
	ASL
	EOR.w $7400,x
	BNE.b CODE_079E9F
CODE_079E97:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDY.b #$00
CODE_079E9F:
	RTS

CODE_079EA0:
	LDY.w $7862,x
	BEQ.b CODE_079EB2
	LDA.w #$FF00
	STA.w $75E2,x
	LDA.w #$0020
	STA.w $7542,x
	RTS

CODE_079EB2:
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0040
	STA.w $7542,x
	RTS

;---------------------------------------------------------------------------

DATA_079EBF:
	db $00,$01,$02,$03,$04

DATA_079EC4:
	db $05,$06

DATA_079EC6:
	db $07,$08,$09,$0A,$0B,$0C,$0D,$0E,$0F,$10,$11,$12,$13,$12,$11,$14
	db $15,$05

DATA_079ED8:
	db $18,$19,$1A,$19,$1B,$19,$1A,$19,$1B,$19,$1A,$19,$1B,$19,$19,$1C
	db $1D,$1C

DATA_079EEA:
	db $04,$04,$10,$04,$04,$04,$20,$03,$02,$01,$01,$01,$10,$04,$04,$04
	db $04,$10

DATA_079EFC:
	dw $0000,$0002,$0004,$0008

DATA_079F04:
	dw $FFA0,$0060

DATA_079F08:
	dw $0006,$FFFA

DATA_079F0C:
	dw $0001,$FFFF

DATA_079F10:
	dw $FFFD,$0003,$FFFE,$0002,$FFFE,$0002,$FFFD,$0003
	dw $FFFD,$0003,$FFFE,$0002,$FFFC,$0004,$FFFC,$0004
	dw $0000,$0000,$0002,$FFFE,$0003,$FFFD,$0005,$FFFB
	dw $0009,$FFF7,$000F,$FFF1,$000F,$FFF1,$000C,$FFF4
	dw $FFFF,$0001,$FFF8,$0008,$FFF8,$0008,$FFF8,$0008
	dw $FFFA,$0006,$FFFD,$0003,$FFEC,$0014,$FFF6,$000A

DATA_079F70:
	dw $FFF8,$FFF8,$FFF7,$FFF7,$FFF6,$FFF6,$FFF7,$FFF7
	dw $FFF8,$FFF8,$FFF8,$FFF8,$FFF8,$FFF8,$FFF7,$FFF7
	dw $FFF7,$FFF7,$FFF5,$FFF5,$FFF6,$FFF6,$FFF7,$FFF7
	dw $FFF7,$FFF7,$FFFD,$FFFD,$FFFB,$FFFB,$FFF8,$FFF8
	dw $FFF0,$FFF0,$FFF8,$FFF8,$FFFA,$FFFA,$FFFB,$FFFB
	dw $FFF8,$FFF8,$FFF7,$FFF7,$FFFC,$FFFC,$FFEA,$FFEA

;-------------------------------------------------------------------------
; Green Glove ($11A) -- Init handler.
; Egg-juggling Shy Guy. Catches Yoshi's eggs and throws them back.
; Raidenthequick: init_green_glove.
;-------------------------------------------------------------------------
YI_NorSpr11A_GreenGlove_Init:
init_green_glove:                          ; Raidenthequick: init_green_glove
;$079FD0
	LDA.w #$FFFF
	STA.b $76,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	JSR.w CODE_07A0EB
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Green Glove ($11A) -- Main handler.
; Per frame: walk, catch-incoming-egg detection (overlaps Slugger
; pattern), launch-return projectile. Raidenthequick: main_green_glove.
;-------------------------------------------------------------------------
YI_NorSpr11A_GreenGlove_Main:
main_green_glove:                          ; Raidenthequick: main_green_glove
;$079FDC
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_079FE9
	LDA.w $7D96,x
	BEQ.b CODE_07A022
CODE_079FE9:
	LDA.w $7040,x
	ORA.w #$0004
	LDA.w $7040,x
	LDY.b $76,x
	BMI.b CODE_07A022
	LDA.w #$0040
	STA.w $7542,y
	LDA.w #$0001
	STA.w $7D38,y
	STA.w $74A2,y
	LDA.w #$0000
	STA.w $7A36,y
	LDA.w $6FA0,y
	AND.w #$FFBF
	STA.w $6FA0,y
	LDA.w $7040,y
	ORA.w #$0004
	STA.w $7040,y
	LDA.w #$FFFF
	STA.b $76,x
CODE_07A022:
	JSL.l CODE_03AF23
	LDA.w $7040,x
	AND.w #$000C
	BNE.b CODE_07A040
	JSL.l CODE_03A2F8
	BCC.b CODE_07A040
	LDY.b $76,x
	BMI.b CODE_07A03F
	TYX
	JSL.l CODE_03A31E
	LDX.b $12
CODE_07A03F:
	RTL

CODE_07A040:
	LDA.w $7402,x
	CMP.w #$000D
	BNE.b CODE_07A059
	LDA.b $14
	AND.w #$0006
	TAY
	LDA.w $7042,x
	AND.w #$FFF1
	ORA.w DATA_079EFC,y
	BRA.b CODE_07A05F

CODE_07A059:
	LDA.w $7042,x
	AND.w #$FFF1
CODE_07A05F:
	STA.w $7042,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_07A06A
	JMP.w CODE_07A54E

CODE_07A06A:
	LDA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	BNE.b CODE_07A075
	JSL.l CODE_07FC2A
	BCS.b CODE_07A080
CODE_07A075:
	JSL.l CODE_03A5B7
	LDA.b $16,x
	TAX
	JSR.w (DATA_green_glove_state_ptr,x)
	RTL

CODE_07A080:
	LDY.b $76,x
	BMI.b CODE_07A0B0
	LDA.w #$0040
	STA.w $7542,y
	LDA.w #$0001
	STA.w $7D38,y
	STA.w $74A2,y
	LDA.w #$0000
	STA.w $7A36,y
	LDA.w $6FA0,y
	AND.w #$FFBF
	STA.w $6FA0,y
	LDA.w $7040,y
	ORA.w #$0004
	STA.w $7040,y
	LDA.w #$FFFF
	STA.b $76,x
CODE_07A0B0:
	LDY.w $77C2,x
	LDA.w DATA_0788CF,y
	STA.w $60A8
	STA.w $60B4
	LDY.b $76,x
	BMI.b CODE_07A0D8
	LDA.w $6FA0,y
	AND.w #$FFBF
	STA.w $6FA0,y
	LDA.w #$0000
	STA.w $7A36,y
	STA.w $7D38,y
	LDA.w #$0040
	STA.w $7542,x
CODE_07A0D8:
	LDA.w #DATA_079ED8
	STA.b $00
	JSR.w CODE_07A580
	RTL

DATA_07A0E1:
DATA_green_glove_state_ptr:                     ; 5-entry Green Glove state ptr: walk / catch / hold / throw / look-up
	dw CODE_07A111
	dw CODE_07A230
	dw CODE_07A31B
	dw CODE_07A38D
	dw CODE_07A355

CODE_07A0EB:
	LDY.w $7400,x
	LDA.w DATA_079F04,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $18,x
	LDA.w DATA_079EBF
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w #$007C
	STA.w $7A98,x
	LDA.w #$0000
	STA.b $16,x
	RTS

CODE_07A111:
	LDX.b $12
	JSR.w CODE_07A538
	BMI.b CODE_07A129
	JSL.l CODE_07FC1F
	BPL.b CODE_07A126
	LDA.w $77C2,x
	AND.w #$00FF
	STA.b $02
CODE_07A126:
	JMP.w CODE_07A202

CODE_07A129:
	JSR.w CODE_07A171
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_07A139
	AND.w #$000C
	BEQ.b CODE_07A146
CODE_07A139:
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	JMP.w CODE_07A1EB

CODE_07A146:
	LDA.w $7A96,x
	BNE.b CODE_07A170
	LDA.w $7A98,x
	BNE.b CODE_07A153
	JSR.w CODE_07A1EB
CODE_07A153:
	SEP.b #$20
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	INC
	CMP.b #$05
	BCC.b CODE_07A15F
	LDA.b #$00
CODE_07A15F:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	TAY
	LDA.w DATA_079EBF,y
	STA.w $7402,x
	LDA.b #$04
	STA.w $7A96,x
	REP.b #$20
CODE_07A170:
	RTS

CODE_07A171:
	LDY.w $7D36,x
	DEY
	BEQ.b CODE_07A1EA
	BMI.b CODE_07A1EA
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07A1EA
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_07A1EA
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BCS.b CODE_07A1EA
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	BNE.b CODE_07A1EA
	LDA.w $7A36,y
	BMI.b CODE_07A1EA
	LDA.w #$0005
	STA.w $74A2,y
	LDA.w #$0000
	STA.w $7540,y
	STA.w $7542,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w $7D38,y
	STA.w $7402,y
	LDA.w $6FA0,y
	ORA.w #$0040
	STA.w $6FA0,y
	LDA.w $6FA2,y
	AND.w #$FFE0
	STA.w $6FA2,y
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	LDA.w #$FFFF
	STA.w $7A36,y
	TYA
	STA.b $76,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w $7040,x
	AND.w #$FFF3
	STA.w $7040,x
	PLA
	JMP.w CODE_07A302

CODE_07A1EA:
	RTS

CODE_07A1EB:
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_079F04,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$007C
	STA.w $7A98,x
	RTS

CODE_07A202:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $02
	STA.w $7400,x
	LDA.w #$0016
	STA.w $7402,x
	LDA.w #$0002
	STA.b $16,x
	STZ.w $7A96,x
CODE_07A218:
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_07A225
	AND.w #$000C
	BEQ.b CODE_07A22F
CODE_07A225:
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
CODE_07A22F:
	RTS

CODE_07A230:
	LDX.b $12
	LDY.w $7D36,x
	DEY
	BEQ.b CODE_07A23A
	BPL.b CODE_07A23D
CODE_07A23A:
	JMP.w CODE_07A2DB

CODE_07A23D:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07A23A
	LDA.w $7D38,y
	BEQ.b CODE_07A23A
	JSL.l CODE_07FC0D
	BPL.b CODE_07A253
CODE_07A250:
	JMP.w CODE_07A2DB

CODE_07A253:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_07A250
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BCS.b CODE_07A2DB
	LDA.w $7542,y
	CMP.w #$0040
	BCS.b CODE_07A278
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7540,x
CODE_07A278:
	LDA.w #$0005
	STA.w $74A2,y
	LDA.w #$0000
	STA.w $7540,y
	STA.w $7542,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w $7D38,y
	STA.w $7402,y
	LDA.w #$FFFF
	STA.w $7A36,y
	LDA.w $6FA0,y
	ORA.w #$0040
	STA.w $6FA0,y
	LDA.w $6FA2,y
	AND.w #$FFE0
	STA.w $6FA2,y
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	TYA
	AND.w #$00FF
	STA.b $76,x
	LDA.w $7040,x
	AND.w #$FFF3
	STA.w $7040,x
	LDA.w $7CD8,x
	SEC
	SBC.w #$0010
	SEC
	SBC.w $7CD8,y
	BCC.b CODE_07A2D5
	JSR.w CODE_07A4D3
	BRA.b CODE_07A2D8

CODE_07A2D5:
	JSR.w CODE_07A474
CODE_07A2D8:
	JMP.w CODE_07A342

CODE_07A2DB:
	LDA.w $7A96,x
	BNE.b CODE_07A2FE
	JSR.w CODE_07A538
	BMI.b CODE_07A2FF
	JSL.l CODE_07FC1F
	BPL.b CODE_07A2F3
	LDA.w $77C2,x
	AND.w #$00FF
	STA.b $02
CODE_07A2F3:
	LDA.b $02
	STA.w $7400,x
	LDA.w #$0040
	STA.w $7A96,x
CODE_07A2FE:
	RTS

CODE_07A2FF:
	JMP.w CODE_07A0EB

CODE_07A302:
	LDA.w #$0004
	STA.b $16,x
	STZ.b $18,x
	LDA.w DATA_079EC4
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A96,x
	JMP.w CODE_07A3C4

CODE_07A31B:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07A33F
	LDA.b $18,x
	INC
	CMP.w #$0002
	BCC.b CODE_07A32D
	JMP.w CODE_07A372

CODE_07A32D:
	STA.b $18,x
	TAY
	LDA.w DATA_079EC4,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A96,x
CODE_07A33F:
	JMP.w CODE_07A3C4

CODE_07A342:
	LDA.w #!Define_YI_SoundID23_GroundPound
	JSL.l CODE_push_sound_queue
	LDA.w #$0008
	STA.b $16,x
	LDA.w #$003E
	STA.w $7A96,x
	RTS

CODE_07A355:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_07A367
	LDA.w $7400,x
	LSR
	LSR
	ROR
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_07A3C4
CODE_07A367:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w $7A96,x
	BNE.b CODE_07A3C4
CODE_07A372:
	LDA.w #$0006
	STA.b $16,x
	STZ.b $18,x
	LDA.w DATA_079EC6
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_079EEA
	AND.w #$00FF
	STA.w $7A96,x
	BRA.b CODE_07A3C4

CODE_07A38D:
	LDX.b $12
	LDA.w $77C2,x
	STA.w $7400,x
	LDA.w $7A96,x
	BNE.b CODE_07A3B7
	LDA.b $18,x
	INC
	CMP.w #$0012
	BCS.b CODE_07A3EC
	STA.b $18,x
	TAY
	LDA.w DATA_079EC6,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_079EEA,y
	AND.w #$00FF
	STA.w $7A96,x
CODE_07A3B7:
	LDA.b $18,x
	CMP.w #$000B
	BEQ.b CODE_07A3EF
	BCS.b CODE_07A3EB
	JSL.l CODE_0EB14D
CODE_07A3C4:
	LDA.w $7402,x
	ASL
	ASL
	ORA.w $7400,x
	TAY
	LDA.w DATA_079F10,y
	STA.b $00
	LDA.w DATA_079F70,y
	STA.b $02
	LDY.b $76,x
	LDA.w $70E2,x
	CLC
	ADC.b $00
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.b $02
	STA.w $7182,y
CODE_07A3EB:
	RTS

CODE_07A3EC:
	JMP.w CODE_07A0EB

CODE_07A3EF:
	JSL.l CODE_0EB148
	LDA.w $611C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $611E
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDY.b $76,x
	LDA.w $7CD6,y
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7CD8,y
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$06F0
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.b $76,x
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.w $7542,y
	STA.w $7D38,y
	LDA.w #$0001
	STA.w $7A36,y
	STA.w $74A2,y
	SEP.b #$20
	STA.w $77C0,y
	REP.b #$20
	LDA.w $6FA0,y
	AND.w #$FFBF
	STA.w $6FA0,y
	LDA.w $7040,y
	ORA.w #$0004
	STA.w $7040,y
	LDA.w #$FFFF
	STA.b $76,x
	LDA.w $7040,x
	ORA.w #$0004
	STA.w $7040,x
	LDA.w #!Define_YI_SoundID20_SoaringEgg
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_SoundID4A_YoshiGrunt
	JSL.l CODE_push_sound_queue
	RTS

CODE_07A474:
	PHY
	LDA.w $7402,x
	ASL
	ASL
	ORA.w $7400,x
	TAY
	LDA.w DATA_079F10,y
	STA.b $00
	LDA.w DATA_079F70,y
	STA.b $02
	PLY
	LDA.w $70E2,x
	CLC
	ADC.b $00
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.b $02
	STA.w $7182,y
	LDY.w $7400,x
	LDA.w DATA_079F08,y
	STA.b $00
	LDA.w #!Define_YI_AmbSpr1F6
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7400,x
	STA.w $73C0,y
	LDA.w $70E2,x
	SEC
	SBC.b $00
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0007
	STA.w $7142,y
	LDA.w #$0002
	STA.w $7E4C,y
	STA.w $7782,y
	LDA.w #$0005
	STA.w $7E4E,y
	RTS

CODE_07A4D3:
	LDA.w #$0017
	STA.w $7402,x
	PHY
	LDA.w $7402,x
	ASL
	ASL
	ORA.w $7400,x
	TAY
	LDA.w DATA_079F10,y
	STA.b $00
	LDA.w DATA_079F70,y
	STA.b $02
	PLY
	LDA.w $70E2,x
	CLC
	ADC.b $00
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.b $02
	STA.w $7182,y
	LDY.w $7400,x
	LDA.w DATA_079F0C,y
	STA.b $00
	LDA.w #!Define_YI_AmbSpr1F9
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7400,x
	STA.w $73C0,y
	LDA.w $70E2,x
	SEC
	SBC.b $00
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$000B
	STA.w $7142,y
	LDA.w #$0002
	STA.w $7E4C,y
	STA.w $7782,y
	LDA.w #$0005
	STA.w $7E4E,y
	RTS

CODE_07A538:
	LDA.w #$0030
	STA.b $04
	ASL
	STA.b $06
	LDA.w #$0020
	STA.b $08
	CLC
	ADC.w #$0030
	STA.b $0A
	JMP.w CODE_078CF1

CODE_07A54E:
	LDY.w $7D36,x
	BPL.b CODE_07A565
	LDA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	BEQ.b CODE_07A55C
	JML.l CODE_kill_sprite_by_hit

CODE_07A55C:
	JSL.l CODE_07FC2A
	BCC.b CODE_07A565
	JMP.w CODE_07A0B0

CODE_07A565:
	LDA.w #DATA_079ED8
	STA.b $00
	JSR.w CODE_07A623
	RTL

;---------------------------------------------------------------------------

DATA_07A56E:
	db $20,$20,$02,$02,$02,$02,$02,$02,$02,$02,$02,$02,$02,$02,$20,$06
	db $18,$10

CODE_07A580:
	LDA.w $60D4
	BNE.b CODE_07A5CA
	JSL.l CODE_03B20B
	LDY.w $77C0,x
	CPY.b #$02
	BCS.b CODE_07A5CA
	SEP.b #$20
	INC.w $77C0,x
	LDA.b ($00)
	STA.w $7402,x
	LDA.w DATA_07A56E
	STA.w $7A96,x
	REP.b #$20
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	LDA.w $7CD6,x
	STA.b $00
	LDA.w $7CD8,x
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1E7
	JSL.l CODE_spawn_ambient_stomp_puff_common
	RTS

CODE_07A5CA:
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	JSL.l CODE_0CFF61
	JSL.l CODE_despawn_sprite_free_slot
	LDA.w #$0004
	STA.b $00
	JSR.w CODE_07A5EF
	PLA
	RTL

DATA_07A5E3:
	dw $0000,$0100,$FF00

DATA_07A5E9:
	dw $FD80,$FE00,$FE00

CODE_07A5EF:
	PHX
	LDX.b $00
	LDA.w DATA_07A5E3,x
	STA.b $02
	LDA.w DATA_07A5E9,x
	STA.b $04
	PLX
	LDA.w #$0115
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_07A622
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.b $02
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $04
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	DEC.b $00
	DEC.b $00
	BPL.b CODE_07A5EF
CODE_07A622:
	RTS

;---------------------------------------------------------------------------

CODE_07A623:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_07A658
	LDA.w $7A96,x
	BNE.b CODE_07A658
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	INC
	CMP.w #$0012
	BCS.b CODE_07A659
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	TAY
	LDA.b ($00),y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_07A56E,y
	AND.w #$00FF
	STA.w $7A96,x
	CPY.b #$10
	BNE.b CODE_07A658
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_07A658:
	RTS

CODE_07A659:
	LDY.w $77C0,x
	PHY
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	TXY
	JSL.l CODE_spawn_sprite
	SEP.b #$20
	PLA
	STA.w $77C0,x
	REP.b #$20
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$FFFF
	STA.b $76,x
	RTS

;---------------------------------------------------------------------------

DATA_07A676:
	dw $FE80,$0180

;-------------------------------------------------------------------------
; Lakitu ($11B) -- Init handler.
; Standard cloud-riding Lakitu. Throws Spiny Eggs at Yoshi. Init reads
; spawn-side, builds the cloud anchor + Spiny-spawn timer.
; Raidenthequick: init_lakitu.
;-------------------------------------------------------------------------
YI_NorSpr11B_Lakitu_Init:
init_lakitu:                               ; Raidenthequick: init_lakitu
;$07A67A
	LDA.w !RAM_YI_Level_NorSpr_LakituActiveFlagLo
	BEQ.b CODE_07A683
	JML.l CODE_03A31E

CODE_07A683:
	LDA.w #$0001
	STA.w !RAM_YI_Level_NorSpr_LakituActiveFlagLo
	LDA.w #$0200
	STA.w $75E0,x
	LDA.w #$0200
	STA.w $75E2,x
	LDA.w #$0008
	STA.w $7540,x
	LDA.w #$0008
	STA.w $7542,x
	LDA.w #DATA_07A6FA
	STA.w $7A36,x
	JSR.w CODE_07A84D
	LDA.w $70E2,x
	AND.w #$0010
	BEQ.b CODE_07A6F9
	LDY.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_07A676,y
	AND.w #$FFE0
	STA.b $00
	LDA.w #$011B
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_07A6F9
	LDA.b $00
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$0200
	STA.w $75E0,y
	LDA.w #$0200
	STA.w $75E2,y
	LDA.w #$0008
	STA.w $7540,y
	LDA.w #$0008
	STA.w $7542,y
	LDA.w #DATA_07A6FE
	STA.w $7A36,y
	TYX
	JSR.w CODE_07A84D
	LDX.b $12
CODE_07A6F9:
	RTL

;---------------------------------------------------------------------------

DATA_07A6FA:
	dw $0088,$0068

DATA_07A6FE:
	dw $0098,$0058

;-------------------------------------------------------------------------
; Lakitu ($11B) -- Main handler.
; Per frame: hover-and-pursue Yoshi within bounds, spawn Spiny Eggs on
; cooldown, flee on Yoshi proximity if low HP. ~450 lines.
; Raidenthequick: main_lakitu.
;-------------------------------------------------------------------------
YI_NorSpr11B_Lakitu_Main:
main_lakitu:                               ; Raidenthequick: main_lakitu
;$07A702
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_07A751
	LDA.w #$011C
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_07A741
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	TYA
	AND.w #$00FF
	INC
	STA.w $6162
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	TXA
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	JSL.l CODE_07A956
	BRA.b CODE_07A74A

CODE_07A741:
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.w $6162
CODE_07A74A:
	STZ.w $6168
	PLA
	PLY
	BRA.b CODE_07A754

CODE_07A751:
	JSR.w CODE_07A9C6
CODE_07A754:
	JSL.l CODE_03AF23
	JSR.w CODE_07AA37
	LDA.w $77C2,x
	STA.w $7400,x
	LDA.w !RAM_YI_Level_NorSpr_LakituActiveFlagLo
	BNE.b CODE_07A783
	LDA.w #$FC00
	STA.w $75E0,x
	STA.w $75E2,x
	LDA.w #$0040
	STA.w $7542,x
	STA.w $7540,x
	LDA.w $7040,x
	ORA.w #$0004
	STA.w $7040,x
	BRA.b CODE_07A800

CODE_07A783:
	LDA.w $77C2,x
	LSR
	LSR
	ROR
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_07A793
	LDA.w #$0010
	BRA.b CODE_07A796

CODE_07A793:
	LDA.w #$0008
CODE_07A796:
	STA.w $7540,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_07A7A2
	EOR.w #$FFFF
	INC
CODE_07A7A2:
	CMP.w #$0080
	BCC.b CODE_07A7C8
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	AND.w #$8000
	ASL
	ROL
	ASL
	TAY
	LDA.w $7A36,x
	STA.b $00
	LDA.w $7680,x
	CMP.b ($00),y
	BPL.b CODE_07A7C2
	LDA.w #$0200
	BRA.b CODE_07A7C5

CODE_07A7C2:
	LDA.w #$FE00
CODE_07A7C5:
	STA.w $75E0,x
CODE_07A7C8:
	LDA.w $7682,x
	SEC
	SBC.w #$0030
	EOR.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_07A7D9
	LDA.w #$0010
	BRA.b CODE_07A7DC

CODE_07A7D9:
	LDA.w #$0008
CODE_07A7DC:
	STA.w $7542,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_07A7E8
	EOR.w #$FFFF
	INC
CODE_07A7E8:
	CMP.w #$0100
	BCC.b CODE_07A800
	LDA.w $7682,x
	CMP.w #$0030
	BPL.b CODE_07A7FA
	LDA.w #$0200
	BRA.b CODE_07A7FD

CODE_07A7FA:
	LDA.w #$FE00
CODE_07A7FD:
	STA.w $75E2,x
CODE_07A800:
	LDA.b $14
	AND.w #$0007
	BNE.b CODE_07A83C
	LDA.w #!Define_YI_AmbSpr1F8
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0002
	STA.w $73C2,y
	LDA.w #$0008
	STA.w $7782,y
	LDA.w $7CD6,x
	SEC
	SBC.w #$0008
	SEC
	SBC.w $72C0,x
	STA.w $70A2,y
	LDA.b $10
	AND.w #$0007
	CLC
	ADC.w $7CD8,x
	SEC
	SBC.w #$0008
	SEC
	SBC.w $72C2,x
	STA.w $7142,y
CODE_07A83C:
	LDA.b $16,x
	TAX
	JSR.w (DATA_lakitu_state_ptr,x)
	JSL.l CODE_03A5B7
	RTL

DATA_07A847:
DATA_lakitu_state_ptr:                          ; 3-entry Lakitu state ptr: cruise / cruise / throw-spiny
	dw CODE_07A869
	dw CODE_07A869
	dw CODE_07A8E6

CODE_07A84D:
	LDA.b $10
	AND.w #$007F
	CLC
	ADC.w #$0080
	STA.w $7A96,x
	STZ.w $7402,x
	STZ.b $16,x
	LDA.w #$0003
	STA.b $76,x
	LDA.w #CODE_07A896
	STA.b $78,x
	RTS

CODE_07A869:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07A881
	LDA.w $7680,x
	ORA.w $7682,x
	AND.w #$FF00
	BEQ.b CODE_07A88F
	LDA.w #$0050
	STA.w $7A96,x
CODE_07A881:
	AND.b $76,x
	BNE.b CODE_07A88E
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
CODE_07A88E:
	RTS

CODE_07A88F:
	LDA.b $78,x
	STA.b $00
	JMP.w ($0000+$7960)

CODE_07A896:
	LDA.w #$0050
	STA.w $7A96,x
	LDA.w #$0002
	STA.w $7402,x
	LDA.w #$0002
	STA.b $16,x
	LDA.w #$0007
	STA.b $76,x
	LDA.w #CODE_07A8CC
	STA.b $78,x
	RTS

DATA_07A8B2:
	db $0C,$02,$02,$02,$02,$02,$02,$02,$02,$06,$10,$40,$20

DATA_07A8BF:
	db $04,$05,$06,$07,$08,$09,$0A,$0B,$0A,$0C,$0A,$0D,$0E

CODE_07A8CC:
	STZ.b $76,x
	LDA.w DATA_07A8B2
	AND.w #$00FF
	STA.w $7A96,x
	LDA.w DATA_07A8BF
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0004
	STA.b $16,x
	RTS

CODE_07A8E6:
	LDX.b $12
	LDA.w $7680,x
	ORA.w $7682,x
	AND.w #$FF00
	BNE.b CODE_07A903
	LDA.w $7A96,x
	BEQ.b CODE_07A8FB
	JMP.w CODE_07A928

CODE_07A8FB:
	LDA.b $76,x
	INC
	CMP.w #$000D
	BCC.b CODE_07A906
CODE_07A903:
	JMP.w CODE_07A84D

CODE_07A906:
	STA.b $76,x
	TAY
	LDA.w DATA_07A8B2,y
	AND.w #$00FF
	STA.w $7A96,x
	LDA.w DATA_07A8BF,y
	AND.w #$00FF
	STA.w $7402,x
	CPY.b #$0C
	BNE.b CODE_07A928
	JSL.l CODE_0EB148
	JSR.w CODE_07AA8D
	BRA.b CODE_07A944

CODE_07A928:
	LDA.b $76,x
	CMP.w #$000B
	BCC.b CODE_07A944
	CMP.w #$000C
	BCS.b CODE_07A944
	JSL.l CODE_0EB14D
	STZ.w $7540,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_07A944:
	RTS

CODE_07A945:
	LDA.w $7CD6,x
	STA.b $00
	LDA.w $7CD8,x
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1E6
	JSL.l CODE_spawn_ambient_stomp_puff_common
CODE_07A956:
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w $75E0,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$000F
	STA.w $7402,x
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$0280
	STA.w $7AF8,x
	RTL

DATA_07A97E:
	dw $0010,$0018,$0010,$0018,$0000,$0008,$0000,$0008
	dw $0000,$0008,$0000,$0008,$0000,$0008,$0008,$0010
	dw $0008,$0010,$0010,$0018,$0010,$0018,$0010,$0018
	dw $0010,$0018,$0010,$0018,$0010,$0018

DATA_07A9BA:
	dw $0008,$000A

DATA_07A9BE:
	dw $0000,$0200,$0400,$0800

CODE_07A9C6:
	LDY.w $74A2,x
	BMI.b CODE_07AA36
	REP.b #$10
	LDA.w $7402,x
	CMP.w #$000F
	BEQ.b CODE_07AA16
	ASL
	ASL
	TAY
	LDA.w DATA_07A97E,y
	STA.b $00
	LDA.w DATA_07A97E+$02,y
	STA.b $02
	LDA.b $14
	AND.w #$0008
	LSR
	LSR
	TAY
	LDA.w DATA_07A9BA,y
	STA.b $04
	LDA.w $7362,x
	CLC
	ADC.b $00
	TAY
	LDA.w $6004,y
	AND.w #$FFF0
	ORA.b $04
	STA.w $6004,y
	LDA.w $7362,x
	CLC
	ADC.b $02
	TAY
	LDA.w $6004,y
	AND.w #$FFF0
	ORA.b $04
	STA.w $6004,y
	LDA.w $7402,x
CODE_07AA16:
	CMP.w #$000D
	BNE.b CODE_07AA34
	LDA.b $14
	AND.w #$0006
	TAY
	LDA.w DATA_07A9BE,y
	STA.b $00
	LDY.w $7362,x
	LDA.w $6004,y
	AND.w #$F1FF
	ORA.b $00
	STA.w $6004,y
CODE_07AA34:
	SEP.b #$10
CODE_07AA36:
	RTS

CODE_07AA37:
	LDY.w $7D36,x
	BMI.b CODE_07AA5A
	DEY
	BEQ.b CODE_07AA59
	BMI.b CODE_07AA59
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07AA59
	LDA.w $7D38,y
	BEQ.b CODE_07AA59
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	PLA
	JMP.w CODE_07A945

CODE_07AA59:
	RTS

CODE_07AA5A:
	JSL.l CODE_07FC2F
	BCS.b CODE_07AA67
	BEQ.b CODE_07AA66
	JSL.l CODE_03A858
CODE_07AA66:
	RTS

CODE_07AA67:
	LDA.w #$011C
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_07AA81
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	TXA
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
CODE_07AA81:
	JSL.l CODE_03B20B
	PLA
	JMP.w CODE_07A945

DATA_07AA89:
	dw $FFF0,$0000

CODE_07AA8D:
	LDA.w $611C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $611E
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDY.w $7400,x
	LDA.w $7CD6,x
	CLC
	ADC.w DATA_07AA89,y
	STA.b $00
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0200
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #$011D
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_07AAE3
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.b $00
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w $7182,y
CODE_07AAE3:
	RTS

DATA_07AAE4:
	dw $FFC0,$0140

DATA_07AAE8:
	dw $FFC0,$0140

YI_NorSpr11B_Lakitu_StompRt:
head_bop_lakitu:                           ; Raidenthequick: head_bop_lakitu
;$07AAEC
	LDA.w $7682,x
	AND.w #$FF00
	BEQ.b CODE_07AB48
	BMI.b CODE_07AB48
	LDA.w #$FFFF
	STA.w $74A2,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7AF8,x
	BNE.b CODE_07AB48
	LDA.w #$0005
	STA.w $74A2,x
	LDA.w #$0200
	STA.w $75E0,x
	LDA.w #$0200
	STA.w $75E2,x
	LDA.w #$0008
	STA.w $7540,x
	LDA.w #$0008
	STA.w $7542,x
	JSR.w CODE_07A84D
	LDY.w $0073
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w DATA_07AAE4,y
	STA.w $70E2,x
	LDY.w $0075
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w DATA_07AAE8,y
	STA.w $7182,x
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
CODE_07AB48:
	RTL

;---------------------------------------------------------------------------

DATA_07AB49:
DATA_lava_drop_x_endpoint_offset:               ; left/right horizontal-lava-drop pixel endpoint relative to spawn X
	dw $FFD0,$0030

DATA_07AB4D:
DATA_lava_drop_x_speed:                         ; left/right horizontal-lava-drop subpixel X velocity
	dw $FE00,$0200

YI_NorSpr12F_HorizontalLavaDrop_Init:
init_lava_drop_horizontal:                 ; Raidenthequick: init_lava_drop_horizontal
;$07AB51
	LDA.w $70E2,x
	CLC
	ADC.w DATA_lava_drop_x_endpoint_offset
	STA.b $18,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_lava_drop_x_endpoint_offset+$02
	STA.b $76,x
	LDA.w #$0004
	STA.w $7540,x
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_lava_drop_x_speed,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $70E2,x
	SEC
	SBC.w DATA_lava_drop_x_endpoint_offset,y
	STA.w $70E2,x
	LDA.w #$0003
	STA.w $7A96,x
	RTL

;---------------------------------------------------------------------------

DATA_07AB90:
	db $00,$09,$08,$07,$06,$05,$04,$00

DATA_07AB98:
	dw $0008,$FFF8

YI_NorSpr12F_HorizontalLavaDrop_Main:
main_lava_drop_horizontal:                 ; Raidenthequick: main_lava_drop_horizontal
;$07AB9C
	JSL.l CODE_03AF23
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_07AC1C
	LDA.b $18,x
	CMP.w $70E2,x
	BCS.b CODE_07AC05
	LDA.b $76,x
	CMP.w $70E2,x
	BCC.b CODE_07AC05
	LDA.w $7A96,x
	BNE.b CODE_07ABC8
	LDA.w #$0003
	STA.w $7A96,x
	LDA.w $7402,x
	INC
	AND.w #$0003
	STA.w $7402,x
CODE_07ABC8:
	LDA.b $14
	AND.w #$0007
	BNE.b CODE_07AC03
	LDY.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_07AB98,y
	STA.b $00
	LDA.w #!Define_YI_AmbSpr1FA
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $10
	AND.w #$0006
	SEC
	SBC.w #$0002
	CLC
	ADC.w $7182,x
	STA.w $7142,y
	LDA.b $00
	STA.w $70A2,y
	LDA.w #$0006
	STA.w $7782,y
	LDA.w #$0003
	STA.w $73C2,y
CODE_07AC03:
	BRA.b CODE_07AC19

CODE_07AC05:
	STA.w $70E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w #$0007
	STA.b $78,x
	LDA.w #$0004
	STA.w $7A96,x
CODE_07AC19:
	JMP.w CODE_07FC4B

CODE_07AC1C:
	LDA.w $7A96,x
	BNE.b CODE_07AC19
	LDA.w #$0004
	STA.w $7A96,x
	LDA.b $78,x
	DEC
	BMI.b CODE_07AC47
	STA.b $78,x
	TAY
	LDA.w DATA_07AB90,y
	AND.w #$00FF
	STA.w $7402,x
	CPY.b #$00
	BNE.b CODE_07AC19
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	BRA.b CODE_07AC19

CODE_07AC47:
	LDA.w $7400,x
	TAY
	LDA.w DATA_lava_drop_x_speed,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.w $7540,x
	LDA.w #$0003
	STA.w $7A96,x
	BRA.b CODE_07AC19

;---------------------------------------------------------------------------

YI_NorSpr130_VerticalLavaDrop_Init:
init_lava_drop_vertical:                   ; Raidenthequick: init_lava_drop_vertical
;$07AC5F
	LDA.w $7182,x
	CLC
	ADC.w DATA_lava_drop_x_endpoint_offset
	STA.b $18,x
	LDA.w $7182,x
	CLC
	ADC.w DATA_lava_drop_x_endpoint_offset+$02
	STA.b $76,x
	LDA.w #$0004
	STA.w $7542,x
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	EOR.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	TAY
	LDA.w DATA_lava_drop_x_speed,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7182,x
	SEC
	SBC.w DATA_lava_drop_x_endpoint_offset,y
	STA.w $7182,x
	LDA.w DATA_07ACCA,y
	STA.b $00
	LDY.b $78,x
	LDA.b ($00),y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0003
	STA.w $7A96,x
	LDA.w #$0003
	STA.b $78,x
	RTL

;---------------------------------------------------------------------------

DATA_07ACB2:
	db $00,$01,$02,$03

DATA_07ACB6:
	db $0A,$0B,$0C,$0D

DATA_07ACBA:
	db $0D,$09,$08,$07,$06,$05,$04,$00

DATA_07ACC2:
	db $03,$13,$12,$11,$10,$0F,$0E,$0A

DATA_07ACCA:
	dw DATA_07ACB2,DATA_07ACB6

DATA_07ACCE:
	dw DATA_07ACBA,DATA_07ACC2

YI_NorSpr130_VerticalLavaDrop_Main:
main_lava_drop_vertical:                   ; Raidenthequick: main_lava_drop_vertical
;$07ACD2
	JSL.l CODE_03AF23
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_07ACDE
	JMP.w CODE_07AD75

CODE_07ACDE:
	LDA.b $18,x
	CMP.w $7182,x
	BCS.b CODE_07AD4D
	LDA.b $76,x
	CMP.w $7182,x
	BCC.b CODE_07AD4D
	LDA.w $7A96,x
	BNE.b CODE_07AD11
	LDA.w #$0003
	STA.w $7A96,x
	LDY.b $16,x
	LDA.w DATA_07ACCA,y
	STA.b $00
	DEC.b $78,x
	BPL.b CODE_07AD07
	LDA.w #$0003
	STA.b $78,x
CODE_07AD07:
	LDY.b $78,x
	LDA.b ($00),y
	AND.w #$00FF
	STA.w $7402,x
CODE_07AD11:
	LDA.b $14
	AND.w #$0007
	BNE.b CODE_07AD4B
	LDY.b $16,x
	LDA.w $7182,x
	CLC
	ADC.w DATA_07AB98,y
	STA.b $00
	LDA.w #!Define_YI_AmbSpr1FB
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $10
	AND.w #$0006
	SEC
	SBC.w #$0002
	CLC
	ADC.w $70E2,x
	STA.w $70A2,y
	LDA.b $00
	STA.w $7142,y
	LDA.w #$0006
	STA.w $7782,y
	LDA.w #$0003
	STA.w $73C2,y
CODE_07AD4B:
	BRA.b CODE_07AD72

CODE_07AD4D:
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w #$0007
	STA.b $78,x
	LDA.w #$0004
	STA.w $7A96,x
	LDY.b $16,x
	LDA.w DATA_07ACCE,y
	STA.b $00
	LDY.b $78,x
	LDA.b ($00),y
	AND.w #$00FF
	STA.w $7402,x
CODE_07AD72:
	JMP.w CODE_07FC4B

CODE_07AD75:
	LDY.b $16,x
	LDA.w DATA_07ACCE,y
	STA.b $00
	LDA.w $7A96,x
	BNE.b CODE_07AD72
	DEC.b $78,x
	BMI.b CODE_07AD97
	LDY.b $78,x
	LDA.b ($00),y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A96,x
	BRA.b CODE_07AD72

CODE_07AD97:
	LDA.w #$0004
	STA.w $7542,x
	LDA.w #$0003
	STA.w $7A96,x
	LDA.w #$0003
	STA.b $78,x
	LDA.b $16,x
	EOR.w #$0002
	STA.b $16,x
	TAY
	LDA.w DATA_lava_drop_x_speed,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w DATA_07ACCA,y
	STA.b $00
	LDY.b $78,x
	LDA.b ($00),y
	AND.w #$00FF
	STA.w $7402,x
	BRA.b CODE_07AD72

;---------------------------------------------------------------------------

DATA_07ADC7:
	dw $FFA0,$0060

DATA_07ADCB:
	dw $FF00,$0100

DATA_07ADCF:
	dw $002A,$002B

DATA_07ADD3:
	dw $0002,$0000

YI_NorSpr12B_FatGuy_Init:
init_fat_guy:                              ; Raidenthequick: init_fat_guy
;$07ADD7
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_07AE0C
	LDA.w #$002A
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$002C
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0991DB>>16
	LDA.w #FXCODE_0991DB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0003
	BCC.b CODE_07ADFF
	JML.l CODE_03A31E

CODE_07ADFF:
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_07AE0C:
	TAY
	DEY
	LDA.w $7042,x
	ORA.w DATA_07ADD3,y
	STA.w $7042,x
	LDA.w DATA_07ADCF,y
	STA.b $78,x
	TYX
	JMP.w (DATA_fat_guy_init_variant_ptr,x)

DATA_07AE20:
DATA_fat_guy_init_variant_ptr:                  ; 2-entry Fat Guy spawn-variant init ptr (small / big)
	dw CODE_07AE24
	dw CODE_07AE46

CODE_07AE24:
	LDX.b $12
	LDY.w $7400,x
	LDA.w DATA_07ADC7,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0000
	STA.b $16,x
	LDA.w #$0003
	STA.w $7A96,x
	LDA.w DATA_07AE7A
	AND.w #$00FF
	STA.w $7402,x
	STZ.b $18,x
	RTL

CODE_07AE46:
	LDX.b $12
	LDY.w $7400,x
	LDA.w DATA_07ADCB,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0002
	STA.b $16,x
	LDA.w #$0002
	STA.w $7A96,x
	LDA.w DATA_07AEAD
	AND.w #$00FF
	STA.w $7402,x
	STZ.b $18,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr12B_FatGuy_Main:
main_fat_guy:                              ; Raidenthequick: main_fat_guy
;$07AE68
	JSL.l CODE_03AF23
	LDA.b $16,x
	TAX
	JMP.w (DATA_fat_guy_state_ptr,x)

DATA_07AE72:
DATA_fat_guy_state_ptr:                         ; 4-entry Fat Guy main-state ptr (walk / turn / fall / squashed)
	dw CODE_07AE86
	dw CODE_07AEAF
	dw CODE_07AED8
	dw CODE_07AF0E

DATA_07AE7A:
	db $04,$05,$06,$07,$08,$09,$0A,$0B,$0C,$0D,$0E,$0F

CODE_07AE86:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07AEAA
	LDA.w #$0003
	STA.w $7A96,x
	LDA.b $18,x
	INC
	CMP.w #$000C
	BCC.b CODE_07AE9E
	LDA.w #$0000
CODE_07AE9E:
	STA.b $18,x
	TAY
	LDA.w DATA_07AE7A,y
	AND.w #$00FF
	STA.w $7402,x
CODE_07AEAA:
	JMP.w CODE_07AF4A

DATA_07AEAD:
	db $10,$11

CODE_07AEAF:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07AECD
	LDA.w #$0002
	STA.w $7A96,x
	LDA.b $18,x
	EOR.w #$0001
CODE_07AEC1:
	STA.b $18,x
	TAY
	LDA.w DATA_07AEAD,y
	AND.w #$00FF
	STA.w $7402,x
CODE_07AECD:
	JMP.w CODE_07AF4A

DATA_07AED0:
	db $13,$02,$01,$00

DATA_07AED4:
	db $04,$03,$02,$02

CODE_07AED8:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07AEF5
	DEC.b $18,x
	BMI.b CODE_07AEF8
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07AED0,y
	STA.w $7402,x
	LDA.w DATA_07AED4,y
	STA.w $7A96,x
	REP.b #$20
CODE_07AEF5:
	JMP.w CODE_07AF4A

CODE_07AEF8:
	BRA.b CODE_07AF24

DATA_07AEFA:
	db $00,$01,$02,$01,$00,$15,$16,$17

DATA_07AF02:
	db $03,$03,$05,$03,$02,$04,$05,$0F

DATA_07AF0A:
	dw $0100,$FF00

CODE_07AF0E:
	LDX.b $12
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_07AF1B
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_07AF1B:
	LDA.w $7A96,x
	BNE.b CODE_07AF4A
	DEC.b $18,x
	BPL.b CODE_07AF36
CODE_07AF24:
	LDA.w $77C2,x
	AND.w #$00FF
	EOR.w #$0002
	STA.w $7400,x
	JSL.l CODE_07AE46
	BRA.b CODE_07AF4A

CODE_07AF36:
	LDY.b $18,x
	LDA.w DATA_07AEFA,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_07AF02,y
	AND.w #$00FF
	STA.w $7A96,x
CODE_07AF4A:
	LDY.w $7D36,x
	BMI.b CODE_07AF90
	DEY
	BMI.b CODE_07AF8F
	BEQ.b CODE_07AF8F
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07AF8F
	LDA.w $7D38,y
	BEQ.b CODE_07AF8F
	LDA.w $7542,y
	CMP.w #$0040
	BPL.b CODE_07AFE3
	PHY
	JSL.l CODE_kill_sprite_by_hit_checked
	PLY
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PHY
	JSL.l CODE_03B53D
	PLX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
CODE_07AF8F:
	RTL

CODE_07AF90:
	LDA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	BNE.b CODE_07AF9D
	JSL.l CODE_07FC2F
	BCS.b CODE_07AFA1
	BEQ.b CODE_07AF8F
CODE_07AF9D:
	JML.l CODE_03A858

CODE_07AFA1:
	LDA.w $60D4
	BEQ.b CODE_07AFA9
	JMP.w CODE_07B04B

CODE_07AFA9:
	LDA.w #!Define_YI_SoundID15_Growth
	JSL.l CODE_push_sound_queue
	LDA.w #$FC00
	STA.w $60AA
	LDA.w #$0008
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.b $16,x
	LDA.w #$0003
	STA.b $18,x
	TAY
	LDA.w DATA_07AED0,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_07AED4,y
	AND.w #$00FF
	STA.w $7A96,x
	RTL

CODE_07AFE3:
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BMI.b CODE_07AF8F
	PHY
	LDA.w #!Define_YI_SoundID15_Growth
	JSL.l CODE_push_sound_queue
	PLY
	LDX.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BPL.b CODE_07B001
	INX
	INX
CODE_07B001:
	LDA.w DATA_07AF0A,x
	STA.b $00
	LDX.b $12
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	LDA.w #$0006
	STA.b $16,x
	LDA.w #$0007
	STA.b $18,x
	TAY
	LDA.w DATA_07AEFA,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_07AF02,y
	AND.w #$00FF
	STA.w $7A96,x
	RTL

CODE_07B04B:
	JSL.l CODE_03A79C
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

YI_NorSpr13D_DanglingFang_Init:
init_fang_dangling:                        ; Raidenthequick: init_fang_dangling
;$07B052
	LDA.w #$0004
	STA.w $7402,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr13D_DanglingFang_Main:
main_fang_dangling:                        ; Raidenthequick: main_fang_dangling
;$07B059
	JSR.w CODE_07B253
	JSL.l CODE_03AF23
	LDY.w $7A38,x
	BEQ.b CODE_07B068
	JMP.w CODE_07B24F

CODE_07B068:
	JSR.w CODE_07B194
	LDA.b $16,x
	TAX
	JSR.w (DATA_fang_dangling_state_ptr,x)
	JSL.l CODE_03A5B7
	RTL

DATA_07B076:
DATA_fang_dangling_state_ptr:                   ; 3-entry Dangling Fang state ptr: cling / fall / land
	dw CODE_07B080
	dw CODE_07B0D1
	dw CODE_07B14A

DATA_07B07C:
	dw $FFFF,$0000

CODE_07B080:
	LDX.b $12
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	CLC
	ADC.w #$0020
	BPL.b CODE_07B0C6
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCS.b CODE_07B0C6
	LDA.w #$0194
	STA.b $18,x
	JSR.w CODE_07B177
	LDA.w #$0000
	STA.w $7402,x
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_07B0B6
	INY
	INY
CODE_07B0B6:
	LDA.w DATA_07B0CD,y
	STA.w $7A96,x
	LDA.w #$0040
	STA.w $7AF6,x
	INC.b $16,x
	INC.b $16,x
CODE_07B0C6:
	RTS

DATA_07B0C7:
	db $00,$01,$02,$03,$02,$01

DATA_07B0CD:
	dw $0003,$0001

CODE_07B0D1:
	LDX.b $12
	JSR.w CODE_07B165
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	CLC
	ADC.w #$0010
	BMI.b CODE_07B0F5
	LDA.b $18,x
	CLC
	ADC.w #$0004
	AND.w #$01FE
	STA.b $18,x
	JSR.w CODE_07B177
	INC.b $16,x
	INC.b $16,x
CODE_07B0F5:
	LDA.w $7A96,x
	BNE.b CODE_07B11D
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_07B103
	INY
	INY
CODE_07B103:
	LDA.w DATA_07B0CD,y
	STA.w $7A96,x
	LDA.b $78,x
	DEC
	BPL.b CODE_07B111
	LDA.w #$0005
CODE_07B111:
	STA.b $78,x
	TAY
	LDA.w DATA_07B0C7,y
	AND.w #$00FF
	STA.w $7402,x
CODE_07B11D:
	LDA.w $7A98,x
	BNE.b CODE_07B149
	LDA.w #!Define_YI_AmbSpr1FC
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7142,y
	LDA.w #$003C
	STA.w $7782,y
	LDA.w #$000C
	STA.w $7A98,x
CODE_07B149:
	RTS

CODE_07B14A:
	LDX.b $12
	LDA.b $18,x
	BNE.b CODE_07B156
	LDY.b $76,x
	BNE.b CODE_07B162
	INC.b $76,x
CODE_07B156:
	CLC
	ADC.w #$0004
	AND.w #$01FE
	STA.b $18,x
	JSR.w CODE_07B177
CODE_07B162:
	JMP.w CODE_07B0F5

CODE_07B165:
	LDA.w $7AF6,x
	BEQ.b CODE_07B176
	AND.w #$0003
	BNE.b CODE_07B176
	LDA.w #!Define_YI_SoundID1B_MaceTick
	JSL.l CODE_push_sound_queue
CODE_07B176:
	RTS

CODE_07B177:
	REP.b #$10
	TXY
	TAX
	LDA.l DATA_sine_lut_8bit_radians,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.l DATA_cosine_lut_8bit_radians,x
	LDX.w $7400,y
	EOR.w DATA_07B07C,x
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	TYX
	SEP.b #$10
	RTS

CODE_07B194:
	LDY.w $7D36,x
	BPL.b CODE_07B1A5
	JSL.l CODE_07FC2F
	BCS.b CODE_07B1A5
	BEQ.b CODE_07B1A5
	JSL.l CODE_03A858
CODE_07B1A5:
	RTS

;---------------------------------------------------------------------------

DATA_07B1A6:
	dw $FEA0,$0160,$0020,$FFE0

DATA_07B1AE:
	dw $F800,$0800

DATA_07B1B2:
	dw $FF80,$0080

YI_NorSpr13E_FlyingFang_Init:
CODE_init_fang_flying:                          ; Raidenthequick: CODE_init_fang_flying
CODE_07B1B6:
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	TAY
	LDA.w $7182,x
	STA.b $18,x
	LDA.w DATA_07B1A6,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w DATA_07B1AE,y
	STA.w $75E2,x
	LDA.w #$0008
	STA.w $7542,x
	LDY.w $7400,x
	LDA.w DATA_07B1B2,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0000
	STA.w $7402,x
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_07B1EF
	INY
	INY
CODE_07B1EF:
	LDA.w DATA_07B0CD,y
	STA.w $7A96,x
	LDA.w #$0040
	STA.w $7AF6,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr13E_FlyingFang_Main:
main_fang_flying:                          ; Raidenthequick: main_fang_flying
;$07B1FC
	LDA.w $7A36,x
	BEQ.b CODE_07B20F
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_07B20F
	DEC.w !RAM_YI_Level_NorSpr_SpawnedBatGeneratorBatsLo
	STZ.w $7A36,x
CODE_07B20F:
	JSR.w CODE_07B253
	JSL.l CODE_03AF23
	JSL.l CODE_07FC64
	BCC.b CODE_07B22B
	LDA.w $7A36,x
	BEQ.b CODE_07B227
	DEC.w !RAM_YI_Level_NorSpr_SpawnedBatGeneratorBatsLo
	STZ.w $7A36,x
CODE_07B227:
	JML.l CODE_03A31E

CODE_07B22B:
	JSR.w CODE_07B165
	LDY.w $7A38,x
	BNE.b CODE_07B24F
	JSR.w CODE_07B194
	LDY.b #$00
	LDA.w $7182,x
	CMP.b $18,x
	BPL.b CODE_07B241
	INY
	INY
CODE_07B241:
	LDA.w DATA_07B1AE,y
	STA.w $75E2,x
	JSR.w CODE_07B0F5
	JSL.l CODE_03A5B7
	RTL

CODE_07B24F:
	JSR.w CODE_07B0F5
	RTL

CODE_07B253:
	LDA.w $7D38,x
	BEQ.b CODE_07B281
	STZ.w $7D38,x
	LDA.w #$0001
	STA.w $7A38,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$FF00
	STA.w $75E2,x
	LDA.w #$0020
	STA.w $75E0,x
	LDA.w #$0200
	LDY.w $7221,x
	BPL.b CODE_07B27E
	LDA.w #$FE00
CODE_07B27E:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_07B281:
	RTS

;---------------------------------------------------------------------------

DATA_07B282:
	dw $0020,$FFE0

DATA_07B286:
	dw $FF00,$0100

DATA_07B28A:
	dw $0100,$FF00

YI_NorSpr13F_SwimmingFlopsyFish_Init:
YI_NorSpr140_SwimmingAndJumpingFlopsyFish_Init:
init_flopsy_fish:                          ; Raidenthequick: init_flopsy_fish
;$07B28E
; note: the only level-conditional Init branch in the Fish family. Lake Shore Paradise's water-line is 4 px lower in BG terms than the spawn data assumes, so this Init nudges Y +$0004. Suggests the level data was finalized before the fish-init was tuned (or vice versa). See docs/family-fish.md.
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	CMP.w #!Define_YI_LevelID_LakeShoreParadise
	BNE.b CODE_07B2A0
	LDA.w $7182,x
	CLC
	ADC.w #$0004
	STA.w $7182,x
CODE_07B2A0:
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w $70E2,x
	STA.b $18,x
	CLC
	ADC.w DATA_07B282,y
	STA.w $70E2,x
	LDA.w DATA_07B286,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0003
	STA.b $76,x
	TAY
	LDA.w DATA_07B2EB,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_07B2EF,y
	AND.w #$00FF
	STA.w $7A96,x
	LDA.w $7182,x
	CLC
	ADC.w #$0004
	STA.w $7A36,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

DATA_07B2EB:
	dw $0E00,$0100

DATA_07B2EF:
	db $08,$0A,$08,$0A

YI_NorSpr13F_SwimmingFlopsyFish_Main:
main_flopsy_fish_swim:                     ; Raidenthequick: main_flopsy_fish_swim
;$07B2F3
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$000C
	BNE.b CODE_07B301
	LDA.w #$0003
	STA.w $7402,x
CODE_07B301:
	JSL.l CODE_03AF23
	LDA.b $16,x
	TAX
	JSR.w (DATA_flopsy_fish_state_ptr,x)
	JSL.l CODE_03A5B7
	RTL

YI_NorSpr140_SwimmingAndJumpingFlopsyFish_Main:
main_flopsy_fish_jump:                     ; Raidenthequick: main_flopsy_fish_jump
;$07B310
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$000C
	BNE.b CODE_07B31E
	LDA.w #$0003
	STA.w $7402,x
CODE_07B31E:
	JSL.l CODE_03AF23
	JSR.w CODE_07B33E
	LDA.b $16,x
	TAX
	JSR.w (DATA_flopsy_fish_state_ptr,x)
	JSL.l CODE_03A5B7
	RTL

DATA_07B330:
DATA_flopsy_fish_state_ptr:                     ; 7-entry shared Flopsy Fish state ptr (swim cycle + jump arc phases)
	dw CODE_07B35F
	dw CODE_07B3FE
	dw CODE_07B455
	dw CODE_07B492
	dw CODE_07B53D
	dw CODE_07B580
	dw CODE_07B5D6

CODE_07B33E:
	LDA.w $7A38,x
	BNE.b CODE_07B35E
	LDA.b $10
	AND.w #$003F
	BNE.b CODE_07B35E
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	INC.w $7A38,x
	LDA.w #$0004
	STA.b $16,x
CODE_07B35E:
	RTS

CODE_07B35F:
	LDX.b $12
	JSR.w CODE_07B645
	LDA.w $70E2,x
	SEC
	SBC.b $18,x
	PHA
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCS.b CODE_07B3BB
	STZ.w $7540,x
	PLA
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCC.b CODE_07B387
	LDA.w #$0004
	STA.w $7540,x
CODE_07B387:
	LDY.b #$00
	LDA.w $70E2,x
	CMP.b $18,x
	BCC.b CODE_07B392
	INY
	INY
CODE_07B392:
	LDA.w DATA_07B28A,y
	STA.w $75E0,x
	LDA.w $7A96,x
	BNE.b CODE_07B3BA
	DEC.b $76,x
	BPL.b CODE_07B3A6
	LDA.w #$0003
	STA.b $76,x
CODE_07B3A6:
	LDY.b $76,x
	LDA.w DATA_07B2EB,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_07B2EF,y
	AND.w #$00FF
	STA.w $7A96,x
CODE_07B3BA:
	RTS

CODE_07B3BB:
	PLA
	AND.w #$8000
	ASL
	ROL
	ASL
	TAY
	LDA.b $18,x
	CLC
	ADC.w DATA_07B282,y
	STA.w $70E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w #$0008
	STA.w $7A96,x
	LDA.w #$0004
	STA.b $76,x
	LDA.w #$0000
	STA.w $7402,x
	LDA.w DATA_07B3F0,y
	STA.b $78,x
	INC.w $7A38,x
	INC.b $16,x
	INC.b $16,x
	RTS

DATA_07B3F0:
	dw DATA_07B3F9,DATA_07B3F4

DATA_07B3F4:
	db $00,$0E,$10,$0E,$00

DATA_07B3F9:
	db $00,$01,$0F,$01,$00

CODE_07B3FE:
	LDX.b $12
	JSR.w CODE_07B645
	LDA.w $7A96,x
	BNE.b CODE_07B42D
	DEC.b $76,x
	BMI.b CODE_07B42E
	LDY.b $76,x
	CPY.b #$02
	BNE.b CODE_07B41B
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_07B41B:
	LDA.w #$0008
	STA.w $7A96,x
	LDA.b $78,x
	STA.b $00
	LDA.b ($00),y
	AND.w #$00FF
	STA.w $7402,x
CODE_07B42D:
	RTS

CODE_07B42E:
	STZ.w $7A38,x
CODE_07B431:
	LDA.w #$0003
	STA.b $76,x
	TAY
	LDA.w DATA_07B2EB,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_07B2EF,y
	AND.w #$00FF
	STA.w $7A96,x
	LDY.w $7400,x
	LDA.w DATA_07B286,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $16,x
	RTS

CODE_07B455:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07B46E
	DEC.b $76,x
	BMI.b CODE_07B46F
	LDY.b $76,x
	LDA.w #$0002
	STA.w $7A96,x
	LDA.w #$0002
	STA.w $7402,x
CODE_07B46E:
	RTS

CODE_07B46F:
	LDA.w #$0002
	STA.b $76,x
	TAY
	LDA.w DATA_07B48F,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0006
	STA.w $7A96,x
	LDA.w #$F900
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $16,x
	INC.b $16,x
	RTS

DATA_07B48F:
	db $05,$04,$03

CODE_07B492:
	LDX.b $12
	JSR.w CODE_07B674
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0100
	BMI.b CODE_07B4A3
	JMP.w CODE_07B52F

CODE_07B4A3:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_07B4DD
	LDA.w $7182,x
	CMP.w $7A36,x
	BPL.b CODE_07B4DD
	LDA.w #!Define_YI_AmbSpr1FE
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7A36,x
	SEC
	SBC.w #$0008
	STA.w $7142,y
	LDA.w #$0006
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #!Define_YI_SoundID03_Swim
	JSL.l CODE_push_sound_queue
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_07B4DD:
	LDA.w $7182,x
	CMP.w $7A36,x
	BPL.b CODE_07B50F
	LDA.w $7A98,x
	BNE.b CODE_07B50F
	LDA.w #!Define_YI_AmbSpr1FD
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$000F
	STA.w $73C2,y
	LDA.w #$0003
	STA.w $7782,y
	LDA.w #$0006
	STA.w $7A98,x
CODE_07B50F:
	LDA.w $7A96,x
	BNE.b CODE_07B52E
	DEC.b $76,x
	BPL.b CODE_07B51D
	LDA.w #$0002
	STA.b $76,x
CODE_07B51D:
	LDY.b $76,x
	LDA.w DATA_07B48F,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0006
	STA.w $7A96,x
CODE_07B52E:
	RTS

CODE_07B52F:
	LDA.w #$0006
	STA.w $7402,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.b $16,x
	INC.b $16,x
	RTS

CODE_07B53D:
	LDX.b $12
	JSR.w CODE_07B674
	LDY.b #$06
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0100
	CMP.w #$0100
	BCC.b CODE_07B55E
	LDY.b #$07
	CMP.w #$0180
	BCC.b CODE_07B55E
	CMP.w #$0200
	BCS.b CODE_07B563
	LDY.b #$08
CODE_07B55E:
	TYA
	STA.w $7402,x
	RTS

CODE_07B563:
	LDA.w #$0002
	STA.b $76,x
	TAY
	LDA.w DATA_07B57D,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0006
	STA.w $7A96,x
	INC.b $16,x
	INC.b $16,x
	RTS

DATA_07B57D:
	db $0B,$0A,$09

CODE_07B580:
	LDX.b $12
	JSR.w CODE_07B674
	LDA.w $7A36,x
	SEC
	SBC.w $7182,x
	CMP.w #$0020
	BCC.b CODE_07B5B1
	LDA.w $7A96,x
	BNE.b CODE_07B5B0
	DEC.b $76,x
	BPL.b CODE_07B59F
	LDA.w #$0002
	STA.b $76,x
CODE_07B59F:
	LDY.b $76,x
	LDA.w DATA_07B57D,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0006
	STA.w $7A96,x
CODE_07B5B0:
	RTS

CODE_07B5B1:
	LDA.w #$0003
	STA.b $76,x
	TAY
	LDA.w DATA_07B5CE,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_07B5D2,y
	AND.w #$00FF
	STA.w $7A96,x
	INC.b $16,x
	INC.b $16,x
	RTS

DATA_07B5CE:
	db $01,$02,$0D,$0C

DATA_07B5D2:
	db $08,$0C,$08,$08

CODE_07B5D6:
	LDX.b $12
	JSR.w CODE_07B674
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_07B615
	LDA.w $7182,x
	CMP.w $7A36,x
	BMI.b CODE_07B615
	LDA.w #!Define_YI_AmbSpr1FE
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7A36,x
	SEC
	SBC.w #$0008
	STA.w $7142,y
	LDA.w #$0006
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #!Define_YI_SoundID03_Swim
	JSL.l CODE_push_sound_queue
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_07B615:
	LDA.w $7A96,x
	BNE.b CODE_07B638
	DEC.b $76,x
	BPL.b CODE_07B624
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	JMP.w CODE_07B431

CODE_07B624:
	LDY.b $76,x
	LDA.w DATA_07B5CE,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_07B5D2,y
	AND.w #$00FF
	STA.w $7A96,x
CODE_07B638:
	RTS

DATA_07B639:
	dw $0040,$FFC0

DATA_07B63D:
	dw $0008,$0008

DATA_07B641:
	dw $0000,$0004

CODE_07B645:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	AND.w #$8000
	ASL
	ROL
	ASL
	TAY
	LDA.w $7CD8,x
	CLC
	ADC.w DATA_07B641,y
	LDY.b #$00
	CMP.w $7A36,x
	BMI.b CODE_07B65F
	INY
	INY
CODE_07B65F:
	LDA.w DATA_07B639,y
	STA.w $75E2,x
	LDA.w DATA_07B63D,y
	STA.w $7542,x
	RTS

DATA_07B66C:
	dw $0400,$FF00

DATA_07B670:
	dw $0040,$0040

CODE_07B674:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	AND.w #$8000
	ASL
	ROL
	ASL
	TAY
	LDA.w $7CD8,x
	CLC
	ADC.w DATA_07B641,y
	LDY.b #$00
	CMP.w $7A36,x
	BMI.b CODE_07B68E
	INY
	INY
CODE_07B68E:
	LDA.w DATA_07B66C,y
	STA.w $75E2,x
	LDA.w DATA_07B670,y
	STA.w $7542,x
	RTS

;---------------------------------------------------------------------------

DATA_07B69B:
	dw $FFE0,$0020

DATA_07B69F:
	dw $0060,$0030

YI_NorSpr145_BlueSluggy_Init:
init_sluggy_blue:                          ; Raidenthequick: init_sluggy_blue
;$07B6A3
	LDY.w $7400,x
	LDA.w DATA_07B69B,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
YI_NorSpr146_PinkSluggy_Init:
init_sluggy_pink:                          ; Raidenthequick: init_sluggy_pink
	LDA.w #$0008
	STA.w $7A96,x
	LDA.w #$0003
	STA.b $18,x
	TAY
	LDA.w DATA_07B74B,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0100
	STA.w $7542,x
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	TAY
	LDA.w DATA_07B69F,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr145_BlueSluggy_Main:
YI_NorSpr146_PinkSluggy_Main:
main_sluggy:                               ; Raidenthequick: main_sluggy
;$07B6DC
	LDA.w $7D38,x
	BEQ.b CODE_07B704
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_07B704
	LDA.w #$0005
	STA.w $7402,x
	LDA.w $7042,x
	AND.w #$FF7F
	STA.w $7042,x
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
CODE_07B704:
	JSL.l CODE_03AF23
	JSL.l CODE_07B853
	LDA.b $16,x
	TAX
	JSR.w (DATA_sluggy_pink_blue_state_ptr,x)
	JML.l CODE_07B830

DATA_07B716:
DATA_sluggy_pink_blue_state_ptr:                ; 4-entry shared Pink/Blue Sluggy state ptr (idle / spit / chase / despawn) -- distinct from the Sluggy-the-Unshaven boss table in Bank02
	dw CODE_07B71E
	dw CODE_07B774
	dw CODE_07B7C1
	dw CODE_07B82B

CODE_07B71E:
	LDX.b $12
	JSL.l CODE_07FC7B
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BCS.b CODE_07B74F
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.b $18,x
	TAY
	LDA.w DATA_07B76F,y
	AND.w #$00FF
	STA.w $7402,x
	INC.b $16,x
	INC.b $16,x
	RTS

DATA_07B74B:
	db $01,$02,$01,$00

CODE_07B74F:
	LDA.w $7A96,x
	BNE.b CODE_07B76E
	LDA.w #$0008
	STA.w $7A96,x
	DEC.b $18,x
	BPL.b CODE_07B763
	LDA.w #$0003
	STA.b $18,x
CODE_07B763:
	LDY.b $18,x
	LDA.w DATA_07B74B,y
	AND.w #$00FF
	STA.w $7402,x
CODE_07B76E:
	RTS

DATA_07B76F:
	db $04,$03,$02,$01,$00

CODE_07B774:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07B790
	LDA.w #$0004
	STA.w $7A96,x
	DEC.b $18,x
	BMI.b CODE_07B791
	LDY.b $18,x
	LDA.w DATA_07B76F,y
	AND.w #$00FF
	STA.w $7402,x
CODE_07B790:
	RTS

CODE_07B791:
	LDA.w $7182,x
	CLC
	ADC.w #$0004
	STA.w $7182,x
	LDA.w #$0005
	STA.w $7402,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0005
	STA.b $18,x
	INC.b $16,x
	INC.b $16,x
	RTS

DATA_07B7B7:
	db $02,$01,$00,$01,$02

DATA_07B7BC:
	db $10,$04,$04,$01,$01

CODE_07B7C1:
	LDX.b $12
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_07B7FE
	LDA.b $76,x
	BNE.b CODE_07B7E1
	LDA.w #!Define_YI_SoundID60_Splash2
	JSL.l CODE_push_sound_queue
	LDA.w $7042,x
	ORA.w #$0080
	STA.w $7042,x
	INC.b $76,x
CODE_07B7E1:
	LDA.w $7A96,x
	BNE.b CODE_07B7FE
	DEC.b $18,x
	BMI.b CODE_07B7FF
	LDY.b $18,x
	LDA.w DATA_07B7B7,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_07B7BC,y
	AND.w #$00FF
	STA.w $7A96,x
CODE_07B7FE:
	RTS

CODE_07B7FF:
	LDA.w #$0008
	STA.w $7A96,x
	LDA.w #$0003
	STA.b $18,x
	TAY
	LDA.w DATA_07B74B,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w $6FA2,x
	ORA.w #$0100
	STA.w $6FA2,x
	LDY.w $7400,x
	LDA.w DATA_07B69B,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.b $16,x
	INC.b $16,x
	RTS

CODE_07B82B:
	LDX.b $12
	JMP.w CODE_07B74F

CODE_07B830:
	LDY.w $7D36,x
	BPL.b CODE_07B852
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_07B845
	JSL.l CODE_07FC2A
	BCS.b CODE_07B849
	BEQ.b CODE_07B852
CODE_07B845:
	JML.l CODE_03A858

CODE_07B849:
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_07B852:
	RTL

CODE_07B853:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_07B8B2
	BEQ.b CODE_07B8B2
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07B8B2
	LDA.w $7D38,y
	BEQ.b CODE_07B8B2
	LDA.w #!Define_YI_SoundID62_MelonBugBump
	JSL.l CODE_push_sound_queue
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
	LDA.w #$0005
	STA.w $7402,x
	LDA.w $7042,x
	AND.w #$FF7F
	STA.w $7042,x
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	INC.b $78,x
	PLY
	PLA
CODE_07B8B2:
	RTL

DATA_07B8B3:
	dw $0021,$0023,$0025

YI_NorSpr145_BlueSluggy_StompRt:
YI_NorSpr146_PinkSluggy_StompRt:
head_bop_sluggy:                           ; Raidenthequick: head_bop_sluggy
;$07B8B9
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	BNE.b CODE_07B938
	LDA.w $7A38,x
	BNE.b CODE_07B928
	LDA.w $60AA
	BMI.b CODE_07B91F
	LDA.w #$0001
	STA.w $61B4
	LDA.w $7A36,x
	BNE.b CODE_07B8F3
	LDA.w #$0003
	STA.w $7A96,x
	LDA.w #$0002
	STA.w $7402,x
	LDA.w #$0100
	STA.w $60AA
	LDA.w $7182,x
	SEC
	SBC.w #$0020
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC.w $7A36,x
	RTL

CODE_07B8F3:
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0010
	CMP.w #$0004
	BMI.b CODE_07B939
	PHA
	ASL
	ASL
	ASL
	ASL
	STA.w $60AA
	PLA
	LDY.b #$02
	CMP.w #$0018
	BCS.b CODE_07B91A
	DEY
	CMP.w #$0010
	BCS.b CODE_07B91A
	DEY
CODE_07B91A:
	TYA
	STA.w $7402,x
	RTL

CODE_07B91F:
	LDA.w #$0003
	STA.w $7A96,x
	INC.w $7A38,x
CODE_07B928:
	LDA.w $7A96,x
	BNE.b CODE_07B938
	DEC.w $7402,x
	BMI.b CODE_07B939
	LDA.w #$0003
	STA.w $7A96,x
CODE_07B938:
	RTL

CODE_07B939:
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A2,x
	REP.b #$20
	LDA.w #!Define_YI_AmbSpr1EE
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0008
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.w $7CD8,x
	STA.w $7142,y
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	JML.l CODE_despawn_sprite_free_slot

;---------------------------------------------------------------------------

DATA_07B96C:
DATA_arrow_cloud_clank_sound_ids:               ; 8 descending clank-pitch IDs for arrow-cloud bounce
	dw !Define_YI_SoundID2F_ClankSound8,!Define_YI_SoundID2E_ClankSound7,!Define_YI_SoundID2D_ClankSound6,!Define_YI_SoundID2C_ClankSound5
	dw !Define_YI_SoundID2B_ClankSound4,!Define_YI_SoundID2A_ClankSound3,!Define_YI_SoundID29_ClankSound2,!Define_YI_SoundID28_ClankSound1

DATA_07B97C:
	dw $FA58,$F800,$FA58,$0000,$05A8,$0800,$05A8,$0000

DATA_07B98C:
	dw $FA58,$0000,$05A8,$0800,$05A8,$0000,$FA58,$F800

DATA_07B99C:
	dw $0000,$0002,$0004,$0008

;-------------------------------------------------------------------------
; Arrow Clouds ($149..$150) -- 8 directional variants share an Init body.
; Each per-direction entry just loads its DATA_07B97C/DATA_07B98C index
; into A (0 / 2 / 4 / 6 / 8 / A / C / E) and falls through into the
; shared CODE_07B9CA which writes that index to $18,x.
; $151 RotatingArrowCloud has its own init at $07B9EE.
;
; See docs/family-clouds.md for the full Lakitu + cloud-family breakdown
; (~35 sprites: Lakitu riders, morph bubbles, winged-cloud item-pop variants,
; small cloud foes, projectiles). The arrow-cloud direction-index is documented
; there as 1 byte driving 4 parallel lookups: x-vel + y-vel + clank pitch + OAM frame.
;-------------------------------------------------------------------------
YI_NorSpr149_UpArrowCloud_Init:
CODE_init_arrow_cloud_up:                       ; Raidenthequick: CODE_init_arrow_cloud_up
CODE_07B9A4:
	LDA.w #$000E                           ; direction index $E -> "up"
	BRA.b CODE_07B9CA

YI_NorSpr14A_UpRightArrowCloud_Init:
init_arrow_cloud_upright:                  ; Raidenthequick: init_arrow_cloud_upright
	LDA.w #$000C
	BRA.b CODE_07B9CA

YI_NorSpr14B_RightArrowCloud_Init:
init_arrow_cloud_right:                    ; Raidenthequick: init_arrow_cloud_right
	LDA.w #$000A
	BRA.b CODE_07B9CA

YI_NorSpr14C_DownRightArrowCloud_Init:
init_arrow_cloud_downright:                ; Raidenthequick: init_arrow_cloud_downright
	LDA.w #$0008
	BRA.b CODE_07B9CA

YI_NorSpr14D_DownArrowCloud_Init:
init_arrow_cloud_down:                     ; Raidenthequick: init_arrow_cloud_down
	LDA.w #$0006
	BRA.b CODE_07B9CA

YI_NorSpr14E_DownLeftArrowCloud_Init:
init_arrow_cloud_downleft:                 ; Raidenthequick: init_arrow_cloud_downleft
	LDA.w #$0004
	BRA.b CODE_07B9CA

YI_NorSpr14F_LeftArrowCloud_Init:
init_arrow_cloud_left:                     ; Raidenthequick: init_arrow_cloud_left
	LDA.w #$0002
	BRA.b CODE_07B9CA

YI_NorSpr150_UpLeftArrowCloud_Init:
init_arrow_cloud_upleft:                   ; Raidenthequick: init_arrow_cloud_upleft
	LDA.w #$0000
CODE_07B9CA:
	STA.b $18,x
	LDA.w #$0002
	STA.w $7402,x
	STA.b $76,x
	LDA.w #$0008
	STA.w $7A96,x
	STZ.w $7400,x
	LDA.b $10
	AND.w #$0003
	ASL
	TAY
	LDA.w $7042,x
	ORA.w DATA_07B99C,y
	STA.w $7042,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr151_RotatingArrowCloud_Init:
init_arrow_cloud_rotating:                 ; Raidenthequick: init_arrow_cloud_rotating
;$07B9EE
	LDY.b #$03
	STY.w !REGISTER_Multiplicand
	LDA.b $10
	AND.w #$0007
	INC
	TAY
	STY.w !REGISTER_Multiplier
	LDA.w #$0017
	STA.b $76,x
	LDA.w #$0008
	STA.w $7A96,x
	LDA.w !REGISTER_ProductOrRemainderLo
	DEC
	STA.w $7402,x
	STA.w !REGISTER_DividendLo
	LDY.b #$03
	STY.w !REGISTER_Divisor
	STZ.w $7400,x
	LDA.b $10
	AND.w #$0003
	ASL
	TAY
	LDA.w $7042,x
	ORA.w DATA_07B99C,y
	STA.w $7042,x
	LDA.w !REGISTER_QuotientLo
	ASL
	STA.b $18,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr149_UpArrowCloud_Main:
YI_NorSpr14A_UpRightArrowCloud_Main:
YI_NorSpr14B_RightArrowCloud_Main:
YI_NorSpr14C_DownRightArrowCloud_Main:
YI_NorSpr14D_DownArrowCloud_Main:
YI_NorSpr14E_DownLeftArrowCloud_Main:
YI_NorSpr14F_LeftArrowCloud_Main:
YI_NorSpr150_UpLeftArrowCloud_Main:
main_arrow_cloud:                          ; shared dispatch for 8 directional arrow clouds
;$07BA31
	JSL.l CODE_03AF23
	JSL.l CODE_07BA78
	JSR.w CODE_07BA62
	RTL

YI_NorSpr151_RotatingArrowCloud_Main:
main_arrow_cloud_rotating:                 ; Raidenthequick: main_arrow_cloud_rotating
;$07BA3D
	JSL.l CODE_03AF23
	LDA.w $7402,x
	STA.w !REGISTER_DividendLo
	LDY.b #$03
	STY.w !REGISTER_Divisor
	NOP #8
	LDA.w !REGISTER_QuotientLo
	ASL
	STA.b $18,x
	JSL.l CODE_07BA78
	JSR.w CODE_07BA62
	RTL

CODE_07BA62:
	LDA.w $7A96,x
	BNE.b CODE_07BA77
	DEC.w $7402,x
	BPL.b CODE_07BA71
	LDA.b $76,x
	STA.w $7402,x
CODE_07BA71:
	LDA.w #$0008
	STA.w $7A96,x
CODE_07BA77:
	RTS

CODE_07BA78:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_07BA9A
	BEQ.b CODE_07BA9A
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07BA9A
	LDA.w $7D38,y
	BEQ.b CODE_07BA9A
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_07BA9A
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BCC.b CODE_07BA9D
CODE_07BA9A:
	JMP.w CODE_07BB13

CODE_07BA9D:
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$0000
	STA.w $7542,y
	LDA.b $18,x
	TAX
	LDA.w DATA_07B97C,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w DATA_07B98C,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FFFF
	STA.w $7A96,y
	INC
	SEP.b #$20
	STA.w $77C0,y
	REP.b #$20
	LDX.b $12
	JSL.l CODE_039F2B
	LDA.w #!Define_YI_AmbSpr200
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$0080
	STA.w $7782,y
	LDA.w $7042,x
	AND.w #$000E
	ORA.w $7002,y
	STA.w $7002,y
	LDA.b $18,x
	LSR
	STA.w $73C2,y
	LDA.w #!Define_YI_SoundID20_SoaringEgg
	JSL.l CODE_push_sound_queue
	LDY.b $18,x
	LDA.w DATA_arrow_cloud_clank_sound_ids,y
	JSL.l CODE_push_sound_queue
	JSL.l CODE_despawn_sprite_free_slot
	PLY
	PLA
CODE_07BB13:
	RTL

;---------------------------------------------------------------------------

DATA_07BB14:
	dw $FF80,$0080

DATA_07BB18:
	dw $FFE0,$0020

DATA_07BB1C:
	dw $0800,$F800

YI_NorSpr152_Flutter_Init:
init_flutter:                              ; Raidenthequick: init_flutter
;$07BB20
	LDY.w $7400,x
	LDA.w DATA_07BB14,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	TAY
	LDA.w $7182,x
	STA.b $18,x
	CLC
	ADC.w DATA_07BB18,y
	STA.w $7182,x
	LDA.w DATA_07BB1C,y
	STA.w $75E2,x
	LDA.w #$0008
	STA.w $7542,x
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w #$0003
	STA.b $76,x
	TAY
	LDA.w DATA_07BB8A,y
	AND.w #$00FF
	STA.w $7402,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr152_Flutter_Main:
main_flutter:                              ; Raidenthequick: main_flutter
;$07BB61
	LDA.w $7D38,x
	BEQ.b CODE_07BB72
	LDA.w $6FA0,x
	AND.w #$FFDF
	ORA.w #$0200
	STA.w $6FA0,x
CODE_07BB72:
	JSL.l CODE_03AF23
	JSL.l CODE_07BE69
	JSL.l CODE_07E336
	LDA.b $16,x
	TAX
	JMP.w (DATA_flutter_state_ptr,x)

DATA_07BB84:
DATA_flutter_state_ptr:                         ; 3-entry Flutter main-state ptr: fly / dive / cling-recover
	dw CODE_07BB8E
	dw CODE_07BC9E
	dw CODE_07BD21

DATA_07BB8A:
	db $01,$02,$01,$00

CODE_07BB8E:
	LDX.b $12
	JSL.l CODE_07BBC9
	LDA.w $7A96,x
	BNE.b CODE_07BBB3
	DEC.b $76,x
	BPL.b CODE_07BBA2
	LDA.w #$0003
	STA.b $76,x
CODE_07BBA2:
	LDY.b $76,x
	LDA.w DATA_07BB8A,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A96,x
CODE_07BBB3:
	LDY.b #$00
	LDA.w $7182,x
	CMP.b $18,x
	BMI.b CODE_07BBBE
	INY
	INY
CODE_07BBBE:
	LDA.w DATA_07BB1C,y
	STA.w $75E2,x
	RTL

DATA_07BBC5:
	dw $0100,$FF00

CODE_07BBC9:
	LDY.w $7D36,x
	BPL.b CODE_07BBF3
	JSL.l CODE_07FC2F
	BEQ.b CODE_07BC05
	BCC.b CODE_07BBEF
	LDA.w $60A8
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $60AA
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	JSL.l CODE_03B20B
	BRA.b CODE_07BC1B

CODE_07BBEF:
	JML.l CODE_03A858

CODE_07BBF3:
	DEY
	BMI.b CODE_07BC05
	BEQ.b CODE_07BC05
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07BC05
	LDA.w $7D38,y
	BNE.b CODE_07BC08
CODE_07BC05:
	JMP.w CODE_07BC8F

CODE_07BC08:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
CODE_07BC1B:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0100
	STA.w $7542,x
	STA.w $7540,x
	STZ.w $75E2,x
	LDA.w #$0006
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	TAY
	LDA.w DATA_07BC90,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_07BC97,y
	AND.w #$00FF
	STA.w $7A96,x
	LDY.w $77C2,x
	LDA.w DATA_07BBC5,y
	STA.b $00
	LDA.w #!Define_YI_AmbSpr202
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w $7142,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0020
	STA.w $7502,y
	LDA.w #$0400
	STA.w $75A2,y
	LDA.w #$0040
	STA.w $7782,y
	LDA.w #$0002
	STA.b $16,x
	PLY
	PLA
CODE_07BC8F:
	RTL

DATA_07BC90:
	db $03,$04,$05,$06,$05,$04,$03

DATA_07BC97:
	db $02,$02,$02,$04,$02,$02,$02

CODE_07BC9E:
	LDX.b $12
	JSL.l CODE_07BE33
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BMI.b CODE_07BCB5
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_07BCB5:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	EOR.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BPL.b CODE_07BCC6
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_07BCC6:
	LDA.w $7A96,x
	BNE.b CODE_07BCE5
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	BMI.b CODE_07BCE6
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	LDA.w DATA_07BC90,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_07BC97,y
	AND.w #$00FF
	STA.w $7A96,x
CODE_07BCE5:
	RTL

CODE_07BCE6:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0003
	STA.b $76,x
	TAY
	LDA.w DATA_07BD19,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7A96,x
	LDA.w #$0040
	STA.w $7A98,x
	LDA.w #$0004
	STA.b $16,x
	RTL

DATA_07BD19:
	db $08,$09,$08,$07

DATA_07BD1D:
	dw $FFF0,$0000

CODE_07BD21:
	LDX.b $12
	LDA.w $7A98,x
	BEQ.b CODE_07BD31
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
CODE_07BD31:
	JSL.l CODE_07BE33
	LDA.w $7A96,x
	BNE.b CODE_07BD54
	DEC.b $76,x
	BPL.b CODE_07BD43
	LDA.w #$0003
	STA.b $76,x
CODE_07BD43:
	LDY.b $76,x
	LDA.w DATA_07BD19,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7A96,x
CODE_07BD54:
	LDA.w $7AF6,x
	BNE.b CODE_07BDA7
	LDA.w #$000E
	STA.w $7AF6,x
	LDY.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_07BD1D,y
	STA.b $00
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.b $02
	LDA.w #$FE00
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.b $04
	LDA.w #$FE00
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.b $06
	LDA.w #$0002
	STA.b $08
	JSR.w CODE_07BDE8
	LDY.w $7400,x
	LDA.b $00
	CLC
	ADC.w #$0010
	STA.b $00
	LDA.w #$0200
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.b $04
	STZ.b $08
	JSR.w CODE_07BDE8
CODE_07BDA7:
	LDA.b $78,x
	BNE.b CODE_07BDE7
	LDA.w $7A98,x
	BNE.b CODE_07BDE7
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
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $78,x
CODE_07BDE7:
	RTL

CODE_07BDE8:
	LDA.w #!Define_YI_AmbSpr203
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	STA.w $70A2,y
	LDA.b $02
	STA.w $7142,y
	LDA.b $04
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $06
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $75A0,y
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $75A0,y
	LDA.w $75A2,y
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w $75A2,y
	LDA.w $7968
	STA.w $73C0,y
	LDA.w #$0040
	STA.w $7502,y
	STA.w $7500,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #$0006
	STA.w $73C2,y
	RTS

CODE_07BE33:
	LDY.w $7D36,x
	BPL.b CODE_07BE4F
	JSL.l CODE_07FC2F
	BEQ.b CODE_07BE68
	BCC.b CODE_07BE4B
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	JML.l CODE_03B20B

CODE_07BE4B:
	JML.l CODE_03A858

CODE_07BE4F:
	DEY
	BMI.b CODE_07BE68
	BEQ.b CODE_07BE68
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07BE68
	LDA.w $7D38,y
	BEQ.b CODE_07BE68
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
CODE_07BE68:
	RTL

CODE_07BE69:
	LDA.w $7A36,x
	BEQ.b CODE_07BE8F
	LDA.w $7680,x
	CLC
	ADC.w #$0050
	CMP.w #$0190
	BCS.b CODE_07BE86
	LDA.w $7682,x
	CLC
	ADC.w #$0050
	CMP.w #$0190
	BCC.b CODE_07BE8F
CODE_07BE86:
	DEC.w $0C6C
	PLY
	PLA
	JML.l CODE_03A31E

CODE_07BE8F:
	RTL

;---------------------------------------------------------------------------

YI_NorSpr143_SprayFish_Init:
init_spray_fish:                           ; Raidenthequick: init_spray_fish
;$07BE90
	LDA.w $70E2,x
	SEC
	SBC.w #$0020
	STA.b $76,x
	CLC
	ADC.w #$0040
	STA.b $78,x
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7182,x
	STA.w $7A38,x
	SEC
	SBC.w #$001C
	STA.w $7A36,x
	RTL

;---------------------------------------------------------------------------

DATA_07BEB4:
	dw $FFF0,$FFFB,$FFEA,$FFF5,$FFE4,$FFEF,$FFDE,$FFE9
	dw $FFD8,$FFE3,$FFD2,$FFDD,$FFCC,$FFD7,$FFC6,$FFD1
	dw $FFC0,$FFCB,$FFBA,$FFC5,$FFB4,$FFBF,$FFAE,$FFB9
	dw $FFA8,$FFB3,$FFA2,$FFAD,$FF9C,$FFA7,$FF96,$FFA1
	dw $FF90,$FF9B,$FF8A,$FF95

YI_NorSpr143_SprayFish_Main:
main_spray_fish:                           ; Raidenthequick: main_spray_fish
;$07BEFC
	LDY.w $74A2,x
	BMI.b CODE_07BF23
	LDA.w $7402,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $16,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #DATA_07BEB4
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #DATA_07BEB4>>16
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_089332>>16
	LDA.w #FXCODE_089332
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_07BF23:
	JSL.l CODE_03AF23
	LDA.b $18,x
	TAX
	JMP.w (DATA_spray_fish_state_ptr,x)

DATA_07BF2D:
DATA_spray_fish_state_ptr:                      ; 6-entry Spray Fish state ptr: idle / wind-up / spray / pause / re-aim / despawn
	dw CODE_07BF39
	dw CODE_07BFBF
	dw CODE_07BFF3
	dw CODE_07C04E
	dw CODE_07C0B1
	dw CODE_07C0DD

CODE_07BF39:
	LDX.b $12
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	LDA.w $7A96,x
	BNE.b CODE_07BF81
	LDA.w $7C18,x
	SEC
	SBC.w #$0018
	CMP.w #$00A0
	BCS.b CODE_07BF81
	LDY.w $77C2,x
	DEY
	BMI.b CODE_07BF5F
	EOR.w #$FFFF
	INC
CODE_07BF5F:
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CMP.b $76,x
	BPL.b CODE_07BF6B
	LDA.b $76,x
	BRA.b CODE_07BF71

CODE_07BF6B:
	CMP.b $78,x
	BMI.b CODE_07BF71
	LDA.b $78,x
CODE_07BF71:
	STA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCS.b CODE_07BF82
CODE_07BF81:
	RTL

CODE_07BF82:
	LDA.w #!Define_YI_AmbSpr1BA
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7A36,x
	STA.w $7142,y
	LDA.w #$001A
	STA.w $7E4C,y
	LDA.w #$0003
	STA.w $7782,y
	LDA.w #!Define_YI_SoundID61_Splash3
	JSL.l CODE_push_sound_queue
	LDA.w #$0018
	STA.w $7A96,x
	LDA.w $7A38,x
	STA.w $7182,x
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $18,x
	INC.b $18,x
	RTL

CODE_07BFBF:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07BFDC
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.w $7402,x
	LDA.w #$0030
	STA.w $7A98,x
	LDA.w #$00D1
	STA.w $7AF6,x
	INC.b $18,x
	INC.b $18,x
CODE_07BFDC:
	JSR.w CODE_07C285
	RTL

DATA_07BFE0:
	db $01,$01,$01,$01,$01,$01,$01,$01,$01,$01,$01,$01,$01,$01,$01,$01
	db $01,$01,$C0

CODE_07BFF3:
	LDX.b $12
	LDA.w $7A98,x
	BNE.b CODE_07BFDC
	LDA.w #$0002
	STA.w $7402,x
	LDA.b $14
	AND.w #$0003
	BNE.b CODE_07C00E
	LDA.w #!Define_YI_SoundID51_ThunderLakituAttacking1
	JSL.l CODE_push_sound_queue
CODE_07C00E:
	LDA.w $7AF6,x
	BEQ.b CODE_07C046
	JSL.l CODE_07C192
	LDA.b $16,x
	CMP.w #$0012
	BEQ.b CODE_07C026
	LDA.w $7A96,x
	CMP.w #$0002
	BCS.b CODE_07C02B
CODE_07C026:
	LDA.w $7A96,x
	BNE.b CODE_07C03F
CODE_07C02B:
	LDA.b $16,x
	CMP.w #$0012
	BCS.b CODE_07C046
	INC
	STA.b $16,x
	TAY
	LDA.w DATA_07BFE0,y
	AND.w #$00FF
	STA.w $7A96,x
CODE_07C03F:
	JSR.w CODE_07C11A
	JSR.w CODE_07C285
	RTL

CODE_07C046:
	INC.b $18,x
	INC.b $18,x
	JSR.w CODE_07C285
	RTL

CODE_07C04E:
	LDX.b $12
	LDA.b $16,x
	BEQ.b CODE_07C09D
	JSR.w CODE_07C11A
	LDA.w $7A98,x
	BNE.b CODE_07C0AD
	DEC.b $16,x
	BNE.b CODE_07C095
	LDA.w #!Define_YI_AmbSpr1BA
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7A36,x
	STA.w $7142,y
	LDA.w #$001A
	STA.w $7E4C,y
	LDA.w #$0003
	STA.w $7782,y
	LDA.w #!Define_YI_SoundID61_Splash3
	JSL.l CODE_push_sound_queue
	LDA.w #$0018
	STA.w $7A96,x
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7402,x
CODE_07C095:
	LDA.w #$0001
	STA.w $7A98,x
	BRA.b CODE_07C0AD

CODE_07C09D:
	LDA.w $7A96,x
	BNE.b CODE_07C0AD
	LDA.w #$0040
	STA.w $7A96,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.b $18,x
CODE_07C0AD:
	JSR.w CODE_07C285
	RTL

CODE_07C0B1:
	LDX.b $12
	LDA.b $16,x
	BEQ.b CODE_07C0BD
	DEC.b $16,x
	JSR.w CODE_07C11A
	RTL

CODE_07C0BD:
	LDA.w #$0000
	STA.w $7402,x
	LDA.w $7A38,x
	CMP.w $7182,x
	BPL.b CODE_07C0D9
	STA.w $7182,x
	LDA.w #$0140
	STA.w $7A96,x
	INC.b $18,x
	INC.b $18,x
	RTL

CODE_07C0D9:
	INC.w $7182,x
	RTL

CODE_07C0DD:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07C0EF
	LDA.w #$0040
	STA.w $7A96,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.b $18,x
CODE_07C0EF:
	RTL

DATA_07C0F0:
	dw $0001,$0001,$0001,$0001,$0001,$0001,$0001,$0001
	dw $0001,$0001,$0001,$0001,$0001,$0001,$0001,$0001
	dw $0001,$0001,$0003

DATA_07C116:
	dw $FC00,$0400

CODE_07C11A:
	LDA.b $16,x
	ASL
	TAY
	LDA.b $14
	AND.w DATA_07C0F0,y
	BNE.b CODE_07C189
	LDY.w $7400,x
	LDA.w DATA_07C116,y
	STA.b $00
	LDA.b $16,x
	DEC
	ASL
	ASL
	TAY
	LDA.w DATA_07BEB4,y
	PHY
	LDY.w $7400,x
	BEQ.b CODE_07C140
	EOR.w #$FFFF
	INC
CODE_07C140:
	PLY
	CLC
	ADC.w $70E2,x
	STA.b $02
	INY
	INY
	LDA.w $7182,x
	CLC
	ADC.w DATA_07BEB4,y
	STA.b $04
	LDA.w #!Define_YI_AmbSpr206
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7002,y
	ORA.w #$0006
	STA.w $7002,y
	LDA.w $7400,x
	STA.w $73C0,y
	LDA.b $02
	STA.w $70A2,y
	LDA.b $04
	STA.w $7142,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0010
	STA.w $7782,y
	LDA.w #$0002
	STA.w $73C2,y
CODE_07C189:
	RTS

DATA_07C18A:
	dw $FE00,$0200

DATA_07C18E:
	dw $0180,$0060

CODE_07C192:
	LDA.w #DATA_07BEB4>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_07BEB4
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $16,x
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_089436>>16
	LDA.w #FXCODE_089436
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	BPL.b CODE_07C1B6
	JMP.w CODE_07C284

CODE_07C1B6:
	STA.b $16,x
	DEC
	ASL
	ASL
	TAY
	LDA.w DATA_07BEB4,y
	PHY
	LDY.w $7400,x
	BEQ.b CODE_07C1C9
	EOR.w #$FFFF
	INC
CODE_07C1C9:
	PLY
	CLC
	ADC.w $70E2,x
	STA.b $00
	INY
	INY
	LDA.w $7182,x
	CLC
	ADC.w DATA_07BEB4,y
	STA.b $02
	LDA.w $7AF8,x
	BNE.b CODE_07C203
	LDA.w #$0004
	STA.w $7AF8,x
	LDA.w #!Define_YI_AmbSpr204
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	STA.w $70A2,y
	LDA.b $02
	STA.w $7142,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #$0001
	STA.w $73C2,y
CODE_07C203:
	LDA.b $10
	AND.w #$0003
	XBA
	LSR
	CLC
	ADC.w #$0100
	STA.b $04
	LDA.b $10
	AND.w #$0001
	BEQ.b CODE_07C21F
	LDA.b $04
	EOR.w #$FFFF
	INC
	STA.b $04
CODE_07C21F:
	LDA.b $10
	AND.w #$000C
	XBA
	LSR
	LSR
	LSR
	CLC
	ADC.w #$0100
	STA.b $06
	LDA.b $10
	AND.w #$0100
	BNE.b CODE_07C23D
	LDA.b $06
	EOR.w #$FFFF
	INC
	STA.b $06
CODE_07C23D:
	LDA.w #!Define_YI_AmbSpr205
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7002,y
	ORA.w #$0006
	STA.w $7002,y
	LDA.b $00
	STA.w $70A2,y
	LDA.b $02
	STA.w $7142,y
	LDA.b $04
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0006
	STA.w $7782,y
	LDA.w #$0002
	STA.w $73C2,y
	LDY.w $7400,x
	LDA.w $60FC
	AND.w DATA_07C18E,y
	BNE.b CODE_07C27F
	LDA.w DATA_07C18A,y
	STA.w $60A8
	STA.w $60B4
CODE_07C27F:
	PLY
	PLA
	JSR.w CODE_07C285
CODE_07C284:
	RTL

CODE_07C285:
	LDY.w $7D36,x
	BMI.b CODE_07C2AF
	DEY
	BMI.b CODE_07C2AE
	BEQ.b CODE_07C2AE
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07C2AE
	LDA.w $7D38,y
	BEQ.b CODE_07C2AE
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	LDA.w #$0008
	STA.b $18,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
CODE_07C2AE:
	RTS

CODE_07C2AF:
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_07C2C5
	JSL.l CODE_03B20B
	BRA.b CODE_07C2C9

CODE_07C2C5:
	JSL.l CODE_03A858
CODE_07C2C9:
	RTS

;---------------------------------------------------------------------------

DATA_07C2CA:
	dw $FFFF,$0005

DATA_07C2CE:
	dw $0030,$0060

DATA_07C2D2:
	dw $0000,$0100

YI_NorSpr157_WallLakitu_Init:
init_lakitu_wall:                          ; Raidenthequick: init_lakitu_wall
;$07C2D6
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	STA.b $16,x
	TAY
	LDA.w DATA_07C2CA,y
	STA.w $74A2,x
	LDA.w DATA_07C2CE,y
	STA.w $7A96,x
	LDA.w $7040,x
	AND.w #$FEFF
	ORA.w DATA_07C2D2,y
	STA.w $7040,x
	LDA.w #$0000
	STA.w $7402,x
	LDA.w $7182,x
	CLC
	ADC.w #$000B
	STA.w $7182,x
	RTL

;---------------------------------------------------------------------------

CODE_07C30B:
	LDA.b $00
	STA.w $70E2,y
	LDA.b $02
	CLC
	ADC.w #$000B
	STA.w $7182,y
	LDA.w #$FFFF
	STA.w $74A2,y
	LDA.w #$0030
	STA.w $7A96,y
	LDA.w $7040,y
	AND.w #$FEFF
	STA.w $7040,y
	LDA.w #$0000
	STA.w $7402,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	RTL

;---------------------------------------------------------------------------

YI_NorSpr157_WallLakitu_Main:
main_lakitu_wall:                          ; Raidenthequick: main_lakitu_wall
;$07C344
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_07C351
	LDA.w $7D38,x
	BEQ.b CODE_07C373
CODE_07C351:
	LDA.w #$0010
	STA.w $7402,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	BEQ.b CODE_07C39D
	LDA.w #$0040
	STA.w $0CD6
	DEC.w $0C4E
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	LDA.w $7040,x
	ORA.w #$0004
	STA.w $7040,x
	BRA.b CODE_07C39D

CODE_07C373:
	LDY.w $74A2,x
	BMI.b CODE_07C39D
	LDA.w $7402,x
	CMP.w #$000E
	BNE.b CODE_07C39D
	LDA.b $14
	AND.w #$0006
	TAY
	LDA.w DATA_07A9BE,y
	STA.b $00
	REP.b #$10
	LDY.w $7362,x
	LDA.w $6004,y
	AND.w #$F1FF
	ORA.b $00
	STA.w $6004,y
	SEP.b #$10
CODE_07C39D:
	JSL.l CODE_03AF23
	LDA.b $16,x
	TAX
	JMP.w (DATA_wall_lakitu_state_ptr,x)

DATA_07C3A7:
DATA_wall_lakitu_state_ptr:                     ; 2-entry Wall Lakitu top-state ptr: peeking / launching
	dw CODE_07C3AB
	dw CODE_07C3CF

CODE_07C3AB:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	BEQ.b CODE_07C3BF
	JSL.l CODE_07FC64
	BCC.b CODE_07C3BF
	DEC.w $0C4E
	JML.l CODE_03A31E

CODE_07C3BF:
	LDA.b $18,x
	TAX
	JMP.w (DATA_wall_lakitu_peek_substate_ptr,x)

DATA_07C3C5:
DATA_wall_lakitu_peek_substate_ptr:             ; 5-entry Wall Lakitu peek sub-state ptr (hide / wait / appear / aim / throw)
	dw CODE_07C3DB
	dw DATA_07C467
	dw CODE_07C40B
	dw CODE_07C50C
	dw CODE_07C4A1

CODE_07C3CF:
	LDX.b $12
	LDA.b $18,x
	TAX
	JMP.w (DATA_wall_lakitu_launch_substate_ptr,x)

DATA_07C3D7:
DATA_wall_lakitu_launch_substate_ptr:           ; 2-entry Wall Lakitu launch sub-state ptr (aim / throw)
	dw CODE_07C40B
	dw CODE_07C50C

CODE_07C3DB:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07C40A
	LDA.w #$0005
	STA.w $74A2,x
	LDA.w $7040,x
	ORA.w #$0100
	STA.w $7040,x
	LDA.w #$0003
	STA.b $76,x
	TAY
	LDA.w DATA_07C467,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0003
	STA.w $7A96,x
	INC.b $18,x
	INC.b $18,x
CODE_07C40A:
	RTL

CODE_07C40B:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07C43C
	LDA.w $7680,x
	ORA.w $7682,x
	AND.w #$FF00
	BNE.b CODE_07C43C
	LDA.w #$0012
	STA.b $76,x
	TAY
	LDA.w DATA_07C4E6,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_07C4F9,y
	AND.w #$00FF
	STA.w $7A96,x
	INC.b $18,x
	INC.b $18,x
	JMP.w CODE_07C5D8

CODE_07C43C:
	LDA.w $7A98,x
	BNE.b CODE_07C464
	LDA.w $7A36,x
	BEQ.b CODE_07C44B
	STZ.w $7A36,x
	BRA.b CODE_07C455

CODE_07C44B:
	LDA.b $10
	AND.w #$000F
	BNE.b CODE_07C464
	INC.w $7A36,x
CODE_07C455:
	LDA.w #$0010
	STA.w $7A98,x
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_07C464:
	JMP.w CODE_07C5D8

DATA_07C467:
	db $01,$03,$04,$05

CODE_07C46B:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07C487
	DEC.b $76,x
	BMI.b CODE_07C48A
	LDY.b $76,x
	LDA.w DATA_07C467,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0003
	STA.w $7A96,x
CODE_07C487:
	JMP.w CODE_07C5D8

CODE_07C48A:
	LDA.w #$0000
	STA.w $7402,x
	LDA.w #$0060
	STA.w $7A96,x
	INC.b $18,x
	INC.b $18,x
	JMP.w CODE_07C5D8

DATA_07C49D:
	db $05,$04,$03,$01

CODE_07C4A1:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07C4BD
	DEC.b $76,x
	BMI.b CODE_07C4C0
	LDY.b $76,x
	LDA.w DATA_07C49D,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0003
	STA.w $7A96,x
CODE_07C4BD:
	JMP.w CODE_07C5D8

CODE_07C4C0:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	BNE.b CODE_07C4DF
	STZ.b $76,x
	LDA.w #$0030
	STA.w $7A96,x
	LDA.w #$FFFF
	STA.w $74A2,x
	LDA.w $7040,x
	AND.w #$FEFF
	STA.w $7040,x
	STZ.b $18,x
	RTL

CODE_07C4DF:
	DEC.w $0C4E
	JML.l CODE_03A31E

DATA_07C4E6:
	db $0F,$0E,$0B,$0D,$0B,$0C,$0B,$0A,$09,$08,$07,$06,$04,$03,$02,$03
	db $02,$03,$02

DATA_07C4F9:
	db $20,$40,$10,$06,$02,$02,$02,$02,$02,$02,$02,$02,$0C,$08,$08,$08
	db $08,$08,$08

CODE_07C50C:
	LDX.b $12
	LDA.w $7680,x
	ORA.w $7682,x
	AND.w #$FF00
	BEQ.b CODE_07C51C
	JMP.w CODE_07C5A9

CODE_07C51C:
	LDA.b $76,x
	CMP.w #$0002
	BCC.b CODE_07C52C
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
CODE_07C52C:
	LDA.w $7A96,x
	BNE.b CODE_07C582
	DEC.b $76,x
	BMI.b CODE_07C5A9
	LDY.b $76,x
	LDA.w DATA_07C4E6,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_07C4F9,y
	AND.w #$00FF
	STA.w $7A96,x
	CPY.b #$01
	BNE.b CODE_07C566
	LDA.w $611C
	SEC
	SBC.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $611E
	SEC
	SBC.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.w $7A38,x
	BRA.b CODE_07C588

CODE_07C566:
	CPY.b #$00
	BNE.b CODE_07C582
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $02
	LDA.w $7A38,x
	STA.b $04
	JSL.l CODE_07FCB3
	JSR.w CODE_07C632
	BRA.b CODE_07C5A7

CODE_07C582:
	LDY.b $76,x
	CPY.b #$01
	BNE.b CODE_07C5A7
CODE_07C588:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $02
	LDA.w $7A38,x
	STA.b $04
	JSL.l CODE_07FCB8
	LDA.w $7A38,x
	INC
	CMP.w #$0020
	BCS.b CODE_07C5A7
	STA.w $7A38,x
CODE_07C5A7:
	BRA.b CODE_07C5D8

CODE_07C5A9:
	LDA.b $16,x
	BEQ.b CODE_07C5BF
	LDA.w #$0000
	STA.w $7402,x
	LDA.w #$0060
	STA.w $7A96,x
	STZ.b $76,x
	STZ.b $18,x
	BRA.b CODE_07C5D8

CODE_07C5BF:
	LDA.w #$0003
	STA.b $76,x
	TAY
	LDA.w DATA_07C49D,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0003
	STA.w $7A96,x
	INC.b $18,x
	INC.b $18,x
CODE_07C5D8:
	LDY.w $7D36,x
	BMI.b CODE_07C5F9
	DEY
	BMI.b CODE_07C5F8
	BEQ.b CODE_07C5F8
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07C5F8
	LDA.w $7D38,y
	BEQ.b CODE_07C5F8
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	BRA.b CODE_07C60C

CODE_07C5F8:
	RTL

CODE_07C5F9:
	JSL.l CODE_07FC2F
	BEQ.b CODE_07C5F8
	BCC.b CODE_07C5F8
	JSL.l CODE_03B20B
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
CODE_07C60C:
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0010
	STA.w $7402,x
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	RTL

CODE_07C62E:
	JML.l CODE_03A858

CODE_07C632:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDY.w $7400,x
	LDA.w $7CD6,x
	CLC
	ADC.w DATA_07AA89,y
	STA.b $00
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0380
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #$011D
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_07C688
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.b $00
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w $7182,y
CODE_07C688:
	RTS

YI_NorSpr157_WallLakitu_StompRt:
head_bop_lakitu_wall:                      ; Raidenthequick: head_bop_lakitu_wall
;$07C689
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	BEQ.b CODE_07C6A1
	LDA.w #$0040
	STA.w $0CD6
	JSL.l CODE_07FC64
	BCC.b CODE_07C6A1
	DEC.w $0C4E
	JML.l CODE_03A31E

CODE_07C6A1:
	RTL

;---------------------------------------------------------------------------

DATA_07C6A2:
	dw $FFA0,$0060

YI_NorSpr159_WalkingGrunt_Init:
init_grunt_walking:                        ; Raidenthequick: init_grunt_walking
;$07C6A6
	LDY.w $7400,x
	LDA.w DATA_07C6A2,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w #$0004
	STA.b $18,x
	TAY
	LDA.w DATA_07C714,y
	AND.w #$00FF
	STA.w $7402,x
	STZ.b $16,x
	RTL

;---------------------------------------------------------------------------

DATA_07C6C7:
	dw $FF00,$0100

YI_NorSpr15A_RunningGrunt_Init:
init_grunt_running:                        ; Raidenthequick: init_grunt_running
;$07C6CB
	LDY.w $7400,x
	LDA.w DATA_07C6C7,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0003
	STA.w $7A96,x
	LDA.w #$0001
	STA.b $18,x
	TAY
	LDA.w DATA_07C73F,y
	AND.w #$00FF
	STA.w $7402,x
	STZ.b $16,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr159_WalkingGrunt_Main:
main_grunt_walking:                        ; Raidenthequick: main_grunt_walking
;$07C6EC
	JSL.l CODE_03AF23
	LDA.b $16,x
	TAX
	JMP.w (DATA_grunt_walking_state_ptr,x)

DATA_07C6F6:
DATA_grunt_walking_state_ptr:                   ; 5-entry Walking Grunt state ptr (walk / turn / jump-prep / jump / land)
	dw CODE_07C719
	dw CODE_07C79D
	dw CODE_07C7EB
	dw CODE_07C76A
	dw CODE_07C83A

YI_NorSpr15A_RunningGrunt_Main:
main_grunt_running:                        ; Raidenthequick: main_grunt_running
;$07C700
	JSL.l CODE_03AF23
	LDA.b $16,x
	TAX
	JMP.w (DATA_grunt_running_state_ptr,x)

DATA_07C70A:
DATA_grunt_running_state_ptr:                   ; 5-entry Running Grunt state ptr (run / turn / jump-prep / jump / land)
	dw CODE_07C741
	dw CODE_07C79D
	dw CODE_07C7EB
	dw CODE_07C76A
	dw CODE_07C83A

DATA_07C714:
	db $04,$03,$02,$01,$00

CODE_07C719:
	LDX.b $12
	JSL.l CODE_07C866
	LDA.w $7A96,x
	BNE.b CODE_07C73E
	DEC.b $18,x
	BPL.b CODE_07C72D
	LDA.w #$0004
	STA.b $18,x
CODE_07C72D:
	LDY.b $18,x
	LDA.w DATA_07C714,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A96,x
CODE_07C73E:
	RTL

DATA_07C73F:
	db $08,$07

CODE_07C741:
	LDX.b $12
	JSL.l CODE_07C866
	LDA.w #DATA_07C73F
	STA.b $00
CODE_07C74C:
	LDA.w $7A96,x
	BNE.b CODE_07C767
	LDA.b $18,x
	EOR.w #$0001
	STA.b $18,x
	TAY
	LDA.b ($00),y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0003
	STA.w $7A96,x
CODE_07C767:
	RTL

DATA_07C768:
	db $06,$05

CODE_07C76A:
	LDX.b $12
	JSL.l CODE_07C923
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	BEQ.b CODE_07C796
	LDA.w $7A98,x
	BNE.b CODE_07C796
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7A98,x
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
CODE_07C796:
	LDA.w #DATA_07C768
	STA.b $00
	BRA.b CODE_07C74C

CODE_07C79D:
	LDX.b $12
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_07C7C8
	SEP.b #$20
	LDA.b #$10
	STA.b $18,x
	TAY
	LDA.w DATA_07C7C9,y
	STA.w $7402,x
	LDA.w DATA_07C7DA,y
	STA.w $7A96,x
	LDA.b $76,x
	STA.w $7400,x
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_07C7C8:
	RTL

DATA_07C7C9:
	db $0D,$0A,$0C,$0A,$0B,$0A,$0C,$0A,$0B,$0A,$0C,$0A,$0B,$0A,$09,$10
	db $0F

DATA_07C7DA:
	db $42,$12,$02,$02,$02,$02,$02,$02,$02,$02,$02,$02,$02,$08,$20,$02
	db $02

CODE_07C7EB:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07C808
	DEC.b $18,x
	BMI.b CODE_07C809
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07C7C9,y
	STA.w $7402,x
	LDA.w DATA_07C7DA,y
	STA.w $7A96,x
	REP.b #$20
CODE_07C808:
	RTL

CODE_07C809:
	LDY.w $7400,x
	LDA.w DATA_07C6C7,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0003
	STA.w $7A96,x
	LDA.w #$0001
	STA.b $18,x
	TAY
	LDA.w DATA_07C768,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0003
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	INC.b $16,x
	INC.b $16,x
	RTL

DATA_07C832:
	db $12,$13,$12,$11

DATA_07C836:
	db $40,$03,$03,$03

CODE_07C83A:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07C857
	DEC.b $18,x
	BMI.b CODE_07C858
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07C832,y
	STA.w $7402,x
	LDA.w DATA_07C836,y
	STA.w $7A96,x
	REP.b #$20
CODE_07C857:
	RTL

CODE_07C858:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr159_WalkingGrunt
	BNE.b CODE_07C863
	JMP.w YI_NorSpr159_WalkingGrunt_Init

CODE_07C863:
	JMP.w YI_NorSpr15A_RunningGrunt_Init

CODE_07C866:
	LDY.w $7D36,x
	BPL.b CODE_07C86E
	JMP.w CODE_07C8F8

CODE_07C86E:
	DEY
	BEQ.b CODE_07C873
	BPL.b CODE_07C876
CODE_07C873:
	JMP.w CODE_07C8F7

CODE_07C876:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07C8F7
	LDA.w $7D38,y
	BEQ.b CODE_07C8F7
	LDA.w #$000E
	STA.w $7402,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	AND.w #$8000
	ASL
	ROL
	ASL
	STA.b $76,x
	PHY
	JSL.l CODE_03B53D
	PLX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	LDA.w #!Define_YI_AmbSpr207
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$000E
	STA.w $7142,y
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w #$0100
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$00C0
	STA.w $7782,y
	LDA.w $7400,x
	STA.w $73C0,y
	INC.b $16,x
	INC.b $16,x
	PLY
	PLA
CODE_07C8F7:
	RTL

CODE_07C8F8:
	JSL.l CODE_07FC2F
	BEQ.b CODE_07C922
	BCC.b CODE_07C91E
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$03
	STA.b $18,x
	TAY
	LDA.w DATA_07C832,y
	STA.w $7402,x
	LDA.w DATA_07C836,y
	STA.w $7A96,x
	LDA.b #$08
	STA.b $16,x
	REP.b #$20
	PLY
	PLA
CODE_07C91E:
	JSL.l CODE_03A858
CODE_07C922:
	RTL

CODE_07C923:
	LDY.w $7D36,x
	BMI.b CODE_07C963
	DEY
	BMI.b CODE_07C962
	BEQ.b CODE_07C962
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07C962
	LDA.w $7D38,y
	BEQ.b CODE_07C962
	PHY
	JSL.l CODE_kill_sprite_by_hit_checked
	PLY
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PHY
	JSL.l CODE_03B53D
	PLX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	PLY
	PLA
CODE_07C962:
	RTL

CODE_07C963:
	JSL.l CODE_03A5B7
	RTL

;---------------------------------------------------------------------------

YI_NorSpr15B_DancingSpearGuy_Init:
init_spear_guy_dancing:                    ; Raidenthequick: init_spear_guy_dancing
;$07C968
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_07C9BE
	LDA.w $0C50
	BNE.b CODE_07C976
	JML.l CODE_03A31E

CODE_07C976:
	STZ.w $7400,x
	LDA.w $7B58,x
	SEC
	SBC.w #$0004
	STA.w $7B58,x
	LDA.w $7BB8,x
	CLC
	ADC.w #$0002
	STA.w $7BB8,x
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	TAY
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $0CD8
	BEQ.b CODE_07C9B4
	LDA.w $70E2,x
	CLC
	ADC.w $0C62,y
	STA.w $70E2,x
	LDA.w $0C58,y
	STA.b $16,x
	TAX
	JSR.w (DATA_spear_guy_dancing_dance_state_ptr,x)
	RTL

CODE_07C9B4:
	LDA.w $70E2,x
	CLC
	ADC.w $0C5E,y
	STA.w $70E2,x
CODE_07C9BE:
	LDA.w #$0004
	STA.b $16,x
	TAX
	JSR.w (DATA_spear_guy_dancing_dance_state_ptr,x)
	RTL

YI_NorSpr15B_DancingSpearGuy_Main:
main_spear_guy_dancing:                    ; Raidenthequick: main_spear_guy_dancing
;$07C9C8
	JSL.l CODE_03AF23
	INC.w $0C66
	JSR.w CODE_07CE47
	LDA.w $0CD8
	BEQ.b CODE_07C9EC
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7400,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEY
	LDA.w $0C58,y
	STA.b $16,x
	TAX
	JSR.w (DATA_spear_guy_dancing_dance_state_ptr,x)
	BRA.b CODE_07C9F2

CODE_07C9EC:
	LDA.b $16,x
	TAX
	JSR.w (DATA_spear_guy_dancing_solo_state_ptr,x)
CODE_07C9F2:
	JSL.l CODE_03A5B7
	RTL

DATA_07C9F7:
DATA_spear_guy_dancing_dance_state_ptr:         ; 9-entry Dancing Spear Guy dance/throw choreography state ptr (when conductor sprite present)
	dw CODE_07CA2B
	dw CODE_07CAA9
	dw CODE_07CB31
	dw CODE_07CB86
	dw CODE_07CBE0
	dw CODE_07CC58
	dw CODE_07CCCA
	dw CODE_07CD28
	dw CODE_07CDA9

DATA_07CA09:
DATA_spear_guy_dancing_solo_state_ptr:          ; 9-entry Dancing Spear Guy solo state ptr (no conductor, follow-Yoshi behavior)
	dw CODE_07CA44
	dw CODE_07CAC2
	dw CODE_07CB4A
	dw CODE_07CBA8
	dw CODE_07CC0B
	dw CODE_07CC71
	dw CODE_07CCE3
	dw CODE_07CD41
	dw CODE_07CDC2

DATA_07CA1B:
	dw $FE00,$0200

DATA_07CA1F:
	db $07,$03,$02,$01,$00,$06

DATA_07CA25:
	db $08,$08,$08,$08,$08,$08

CODE_07CA2B:
	LDX.b $12
	LDA.w #$0005
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07CA1F,y
	STA.w $7402,x
	LDA.w DATA_07CA25,y
	STA.w $7A96,x
	REP.b #$20
	RTS

CODE_07CA44:
	LDX.b $12
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_07CA51
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_07CA51:
	LDA.w $7A96,x
	BNE.b CODE_07CA8E
	DEC.b $18,x
	BMI.b CODE_07CA8F
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07CA1F,y
	STA.w $7402,x
	LDA.w DATA_07CA25,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$03
	BNE.b CODE_07CA8E
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	LDA.w #$0040
	STA.w $7542,x
	LDY.w $7400,x
	LDA.w DATA_07CA1B,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_07CA8E:
	RTS

CODE_07CA8F:
	LDA.w #$0004
	STA.b $16,x
	TAX
	JSR.w (DATA_spear_guy_dancing_dance_state_ptr,x)
	RTS

DATA_07CA99:
	dw $0200,$FE00

DATA_07CA9D:
	db $06,$00,$05,$04,$03,$07

DATA_07CAA3:
	db $08,$08,$08,$08,$08,$08

CODE_07CAA9:
	LDX.b $12
	LDA.w #$0005
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07CA9D,y
	STA.w $7402,x
	LDA.w DATA_07CAA3,y
	STA.w $7A96,x
	REP.b #$20
	RTS

CODE_07CAC2:
	LDX.b $12
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_07CACF
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_07CACF:
	LDA.w $7A96,x
	BNE.b CODE_07CB0C
	DEC.b $18,x
	BMI.b CODE_07CB0D
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07CA9D,y
	STA.w $7402,x
	LDA.w DATA_07CAA3,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$03
	BNE.b CODE_07CB0C
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	LDA.w #$0040
	STA.w $7542,x
	LDY.w $7400,x
	LDA.w DATA_07CA99,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_07CB0C:
	RTS

CODE_07CB0D:
	LDA.w #$0004
	STA.b $16,x
	TAX
	JSR.w (DATA_spear_guy_dancing_dance_state_ptr,x)
	RTS

DATA_07CB17:
	db $00,$05,$04,$03,$02,$01,$00,$05,$04,$03,$02,$01,$00

DATA_07CB24:
	db $02,$04,$04,$04,$04,$04,$04,$04,$04,$04,$04,$04,$02

CODE_07CB31:
	LDX.b $12
	LDA.w #$000C
	STA.b $18,x
	TAY
	SEP.b #$20
	LDA.w DATA_07CB17,y
	STA.w $7402,x
	LDA.w DATA_07CB24,y
	STA.w $7A96,x
	REP.b #$20
	RTS

CODE_07CB4A:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07CB67
	DEC.b $18,x
	BMI.b CODE_07CB68
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07CB17,y
	STA.w $7402,x
	LDA.w DATA_07CB24,y
	STA.w $7A96,x
	REP.b #$20
CODE_07CB67:
	RTS

CODE_07CB68:
	LDA.w #$0004
	STA.b $16,x
	TAX
	JSR.w (DATA_spear_guy_dancing_dance_state_ptr,x)
	RTS

DATA_07CB72:
	dw $FFAB,$0055

DATA_07CB76:
	db $08,$09,$0A,$0B,$0B,$0A,$09,$08

DATA_07CB7E:
	db $06,$06,$06,$06,$06,$06,$06,$06

CODE_07CB86:
	LDX.b $12
	LDA.w #$0007
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07CB76,y
	STA.w $7402,x
	LDA.w DATA_07CB7E,y
	STA.w $7A96,x
	REP.b #$20
	LDY.w $7400,x
	LDA.w DATA_07CB72,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_07CBA8:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07CBD2
	DEC.b $18,x
	BMI.b CODE_07CBD3
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07CB76,y
	STA.w $7402,x
	LDA.w DATA_07CB7E,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$03
	BNE.b CODE_07CBD2
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_07CBD2:
	RTS

CODE_07CBD3:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.b $16,x
	TAX
	JSR.w (DATA_spear_guy_dancing_dance_state_ptr,x)
	RTS

CODE_07CBE0:
	LDX.b $12
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.w #$0007
	STA.b $18,x
	TAY
	SEP.b #$20
	LDA.w DATA_07CB76,y
	STA.w $7402,x
	LDA.w DATA_07CB7E,y
	STA.w $7A96,x
	REP.b #$20
	LDY.w $7400,x
	LDA.w DATA_07CB72,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_07CC0B:
	LDX.b $12						; Optimization: Rogue copy/pasting strikes!
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07CC37
	DEC.b $18,x
	BMI.b CODE_07CC38
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07CB76,y
	STA.w $7402,x
	LDA.w DATA_07CB7E,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$03
	BNE.b CODE_07CC37
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_07CC37:
	RTS

CODE_07CC38:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.w #$0004
	STA.b $16,x
	TAX
	JSR.w (DATA_spear_guy_dancing_dance_state_ptr,x)
	RTS

DATA_07CC4E:
	db $0C,$0D,$0E,$0D,$0C

DATA_07CC53:
	db $08,$04,$18,$04,$08

CODE_07CC58:
	LDX.b $12
	LDA.w #$0004
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07CC4E,y
	STA.w $7402,x
	LDA.w DATA_07CC53,y
	STA.w $7A96,x
	REP.b #$20
	RTS

CODE_07CC71:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07CCA7
	DEC.b $18,x
	BMI.b CODE_07CCA8
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07CC4E,y
	STA.w $7402,x
	LDA.w DATA_07CC53,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$02
	BNE.b CODE_07CCA7
	LDA.w #$FE08
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	LDA.w #$002A
	STA.w $7542,x
CODE_07CCA7:
	RTS

CODE_07CCA8:
	LDA.w #$0004
	STA.b $16,x
	TAX
	JSR.w (DATA_spear_guy_dancing_dance_state_ptr,x)
	RTS

DATA_07CCB2:
	db $03,$03,$03,$07,$03,$03,$03,$07

DATA_07CCBA:
	db $00,$00,$00,$06,$00,$00,$00,$06

DATA_07CCC2:
	db $06,$06,$06,$06,$06,$06,$06,$06

CODE_07CCCA:
	LDX.b $12
	LDA.w #$0007
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07CCB2,y
	STA.w $7402,x
	LDA.w DATA_07CCC2,y
	STA.w $7A96,x
	REP.b #$20
	RTS

CODE_07CCE3:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07CD1D
	DEC.b $18,x
	BMI.b CODE_07CD1E
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07CCB2,y
	STA.w $7402,x
	LDA.w DATA_07CCC2,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$06
	BEQ.b CODE_07CD08
	CPY.b #$02
	BNE.b CODE_07CD1D
CODE_07CD08:
	LDA.w #$FE80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	LDA.w #$0040
	STA.w $7542,x
CODE_07CD1D:
	RTS

CODE_07CD1E:
	LDA.w #$0004
	STA.b $16,x
	TAX
	JSR.w (DATA_spear_guy_dancing_dance_state_ptr,x)
	RTS

CODE_07CD28:
	LDX.b $12
	LDA.w #$0007
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07CCBA,y
	STA.w $7402,x
	LDA.w DATA_07CCC2,y
	STA.w $7A96,x
	REP.b #$20
	RTS

CODE_07CD41:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07CD7B
	DEC.b $18,x
	BMI.b CODE_07CD7C
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07CCBA,y
	STA.w $7402,x
	LDA.w DATA_07CCC2,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$06
	BEQ.b CODE_07CD66
	CPY.b #$02
	BNE.b CODE_07CD7B
CODE_07CD66:
	LDA.w #$FE80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	LDA.w #$0040
	STA.w $7542,x
CODE_07CD7B:
	RTS

CODE_07CD7C:
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.w #$0004
	STA.b $16,x
	TAX
	JSR.w (DATA_spear_guy_dancing_dance_state_ptr,x)
	RTS

DATA_07CD8F:
	db $0F,$10,$10,$0F,$10,$10,$0F,$10,$10,$0F,$10,$10,$0F

DATA_07CD9C:
	db $02,$04,$04,$04,$04,$04,$04,$04,$04,$04,$04,$04,$02

CODE_07CDA9:
	LDX.b $12
	LDA.w #$000C
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07CD8F,y
	STA.w $7402,x
	LDA.w DATA_07CD9C,y
	STA.w $7A96,x
	REP.b #$20
	RTS

CODE_07CDC2:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07CDF8
	DEC.b $18,x
	BMI.b CODE_07CDF9
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07CD8F,y
	STA.w $7402,x
	LDA.w DATA_07CD9C,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$0A
	BEQ.b CODE_07CDEF
	CPY.b #$07
	BEQ.b CODE_07CDEF
	CPY.b #$04
	BEQ.b CODE_07CDEF
	CPY.b #$01
	BNE.b CODE_07CDF8
CODE_07CDEF:
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_07CDF8:
	RTS

CODE_07CDF9:
	LDA.w #$0004
	STA.b $16,x
	TAX
	JSR.w (DATA_spear_guy_dancing_dance_state_ptr,x)
	RTS

DATA_07CE03:
	dw $0010,$000F,$000E,$000C,$000D,$000E,$0010,$000C
	dw $0005,$0002,$0003,$0006,$000E,$000E,$000E,$0007
	dw $0008

DATA_07CE25:
	dw $FFE4,$FFE2,$FFE1,$FFE0,$FFDF,$FFE1,$FFE7,$FFE3
	dw $FFE2,$FFE3,$FFE4,$FFE3,$FFE6,$FFE3,$FFDE,$FFE4
	dw $FFE3

CODE_07CE47:
	LDA.w $7402,x
	ASL
	TAY
	LDA.w $6122
	CLC
	ADC.w #$0001
	STA.b $00
	LDA.w DATA_07CE25,y
	CLC
	ADC.w $7182,x
	SEC
	SBC.w $611E
	BPL.b CODE_07CE66
	EOR.w #$FFFF
	INC
CODE_07CE66:
	CMP.b $00
	BCS.b CODE_07CE98
	LDA.w $6120
	CLC
	ADC.w #$0001
	STA.b $00
	LDA.w DATA_07CE03,y
	LDY.w $7400,x
	BEQ.b CODE_07CE82
	EOR.w #$FFFF
	CLC
	ADC.w #$0009
CODE_07CE82:
	CLC
	ADC.w $70E2,x
	SEC
	SBC.w $611C
	BPL.b CODE_07CE90
	EOR.w #$FFFF
	INC
CODE_07CE90:
	CMP.b $00
	BCS.b CODE_07CE98
	JSL.l CODE_03A858
CODE_07CE98:
	RTS

;---------------------------------------------------------------------------

DATA_07CE99:
	dw $FF00,$0100

;-------------------------------------------------------------------------
; Zeus Guy ($0FD) -- Init handler.
; The masked shy guy that hops along ceilings/floors and fires a tracking
; lightning blast ($0FE Zeus Guy Blast). Init clears the state word,
; installs the per-state pointer table (DATA_07D08D), and seeds shared
; setup via CODE_07D0A1.
; Raidenthequick: CODE_init_zeus_guy.
;-------------------------------------------------------------------------
YI_NorSpr0FD_ZeusGuy_Init:
CODE_init_zeus_guy:                             ; Raidenthequick: CODE_init_zeus_guy
CODE_07CE9D:
	STZ.b $16,x                            ; state := 0 (idle / walking)
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	LDA.w #DATA_07D08D                     ; per-state pointer table
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSR.w CODE_07D0A1
	RTL

;---------------------------------------------------------------------------

DATA_07CEAC:
	dw $0200,$FE00

;-------------------------------------------------------------------------
; Zeus Guy ($0FD) -- Main handler.
; Dispatches on the per-slot state ($16,x) through DATA_07D08D:
;   - walking, charging, firing blast ($0FE), recovering.
; Walking phase clamps x-speed from DATA_07CEAC by spawn-side ($7400,x).
; Raidenthequick: main_zeus_guy.
;-------------------------------------------------------------------------
YI_NorSpr0FD_ZeusGuy_Main:
main_zeus_guy:                             ; Raidenthequick: main_zeus_guy
;$07CEB0
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_07CEF4
	LDA.w $6150
	CMP.w #$0003
	BCS.b CODE_07CED8
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	TAY
	LDA.w DATA_07CEAC,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0001
	STA.w $7540,x
	BRA.b CODE_07CEE6

CODE_07CED8:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_07CEE6
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_07CEE6:
	STZ.w $6162
	STZ.w $6168
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	PLY
	PLA
CODE_07CEF4:
	JSL.l CODE_03AF23
	LDA.w $7540,x
	BEQ.b CODE_07CF00
	JMP.w CODE_07D80C

CODE_07CF00:
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $7042,x
	AND.w #$FFF1
	STA.w $7042,x
	TAX
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098F33>>16
	LDA.w #FXCODE_098F33
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $7A38,x
	LDA.w $7402,x
	CMP.w #$0000
	BNE.b CODE_07CF32
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
CODE_07CF32:
	JSR.w CODE_07D4DF
	JSR.w CODE_07D550
	JSR.w CODE_07D5D2
	LDA.b $16,x
	CMP.w #$0004
	BCS.b CODE_07CF61
	LDY.w $7A38,x
	BMI.b CODE_07CF61
	JSL.l CODE_07FC1F
	BMI.b CODE_07CF61
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	AND.w #$8000
	ASL
	ROL
	ASL
	STA.w $7400,x
	STZ.b $16,x
	INC.b $76,x
CODE_07CF61:
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_07CF75
	STZ.w $7A36,x
	LDA.b $16,x
	TAX
	JSR.w (DATA_zeus_guy_hit_state_ptr,x)
	JMP.w CODE_07D79D

CODE_07CF75:
	LDA.w $7A36,x
	BEQ.b CODE_07CF83
	LDY.w $7400,x
	LDA.w DATA_07CE99,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_07CF83:
	LDA.w #$0020
	STA.w $7402,x
	STZ.w $7A96,x
	LDA.w #$000C
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	LDA.w #$0002
	STA.b $18,x
	JMP.w CODE_07D79D

DATA_07CF9A:
DATA_zeus_guy_hit_state_ptr:                    ; 4-entry Zeus Guy on-hit state ptr (taken-hit phase variants)
	dw CODE_07D00E
	dw CODE_07D031
	dw CODE_07D05B
	dw CODE_07D072

DATA_07CFA2:
DATA_zeus_guy_main_state_ptr:                   ; 7-entry Zeus Guy main state ptr (walk / wind-up / fire / recover / variants)
	dw CODE_07D0A1
	dw CODE_07D123
	dw CODE_07D239
	dw CODE_07D2B4
	dw CODE_07D327
	dw CODE_07D39D
	dw CODE_07D492

DATA_07CFB0:
DATA_zeus_guy_anim_state_ptr:                   ; 7-entry Zeus Guy per-state animation handler ptr
	dw CODE_07D0D5
	dw CODE_07D13E
	dw CODE_07D283
	dw CODE_07D2FF
	dw CODE_07D372
	dw CODE_07D3C7
	dw CODE_07D49F

DATA_07CFBE:
	dw $0004,$0006,$0008,$000A,$0004,$0006,$0008,$0004
	dw $0006,$0008,$0004,$0006,$0008,$0004,$0006,$0008

DATA_07CFDE:
	dw $0004,$0006,$0008,$0004,$0006,$0008,$0004,$0006
	dw $0008,$0004,$0006,$0008,$0004,$0006,$0008,$0004

DATA_07CFFE:
	dw $000A,$000A,$000A,$000A,$000A,$0004,$0006,$0008

CODE_07D00E:
	LDX.b $12
	LDA.w #DATA_07D08D
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.b $76,x
	BEQ.b CODE_07D02A
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	AND.w #$0002
	EOR.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	TAX
	JMP.w (DATA_zeus_guy_main_state_ptr,x)

CODE_07D02A:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	TAX
	JMP.w (DATA_zeus_guy_anim_state_ptr,x)

CODE_07D031:
	LDX.b $12
	LDA.w #DATA_07D091
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.b $76,x
	BEQ.b CODE_07D02A
	LDA.b $10
	AND.w #$0007
	BEQ.b CODE_07D049
	LDA.w #$0000
	BRA.b CODE_07D054

CODE_07D049:
	LDA.b $10
	AND.w #$0038
	LSR
	LSR
	TAY
	LDA.w DATA_07CFFE,y
CODE_07D054:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	TAX
	JMP.w (DATA_zeus_guy_main_state_ptr,x)

CODE_07D05B:
	LDX.b $12
	LDA.b $76,x
	BEQ.b CODE_07D02A
	LDA.b $10
	AND.w #$000F
	ASL
	TAY
	LDA.w DATA_07CFBE,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	TAX
	JMP.w (DATA_zeus_guy_main_state_ptr,x)

CODE_07D072:
	LDX.b $12
	LDA.b $76,x
	BEQ.b CODE_07D02A
	LDA.b $10
	AND.w #$000F
	ASL
	TAY
	LDA.w DATA_07CFDE,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	TAX
	JMP.w (DATA_zeus_guy_main_state_ptr,x)

DATA_07D089:
	db $00,$1F,$1E,$1D

DATA_07D08D:
	db $20,$02,$02,$02

DATA_07D091:
	db $08,$02,$02,$02

DATA_07D095:
	dw $0008,$0004

DATA_07D099:
	dw $FFFC,$0004

DATA_07D09D:
	dw $FFFE,$0002

CODE_07D0A1:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $00
	LDA.w #$0003
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07D089,y
	STA.w $7402,x
	LDA.b ($00),y
	STA.w $7A96,x
	REP.b #$20
	LDY.w $7400,x
	LDA.w $7860,x
	AND.w DATA_07D095,y
	BNE.b CODE_07D0D2
	LDA.w $70E2,x
	CLC
	ADC.w DATA_07D099,y
	STA.w $70E2,x
CODE_07D0D2:
	STZ.b $76,x
	RTS

CODE_07D0D5:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07D10F
	DEC.b $18,x
	BMI.b CODE_07D110
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.b $00
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07D089,y
	STA.w $7402,x
	LDA.b ($00),y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$02
	BNE.b CODE_07D10F
	LDY.w $7400,x
	LDA.w $7860,x
	AND.w DATA_07D095,y
	BNE.b CODE_07D10F
	LDA.w $70E2,x
	CLC
	ADC.w DATA_07D09D,y
	STA.w $70E2,x
CODE_07D10F:
	RTS

CODE_07D110:
	INC.b $76,x
	RTS

DATA_07D113:
	db $00,$1D,$1E,$1F

DATA_07D117:
	dw $0002,$FFFE

DATA_07D11B:
	dw $0004,$FFFC

DATA_07D11F:
	dw $0004,$0008

CODE_07D123:
	LDX.b $12
	LDA.w #$0003
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07D113,y
	STA.w $7402,x
	LDA.w DATA_07D08D,y
	STA.w $7A96,x
	REP.b #$20
	STZ.b $76,x
	RTS

CODE_07D13E:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07D18F
	DEC.b $18,x
	BMI.b CODE_07D190
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07D113,y
	STA.w $7402,x
	LDA.w DATA_07D08D,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$01
	BNE.b CODE_07D176
	LDY.w $7400,x
	LDA.w $7860,x
	AND.w DATA_07D11F,y
	BNE.b CODE_07D18F
	LDA.w $70E2,x
	CLC
	ADC.w DATA_07D117,y
	STA.w $70E2,x
	BRA.b CODE_07D18F

CODE_07D176:
	CPY.b #$00
	BNE.b CODE_07D18F
	LDY.w $7400,x
	LDA.w $7860,x
	AND.w DATA_07D11F,y
	BNE.b CODE_07D18F
	LDA.w $70E2,x
	CLC
	ADC.w DATA_07D11B,y
	STA.w $70E2,x
CODE_07D18F:
	RTS

CODE_07D190:
	INC.b $76,x
	RTS

DATA_07D193:
	db $01,$02,$03,$02,$01,$00

DATA_07D199:
	db $02,$01,$08,$01,$02,$08

DATA_07D19F:
	dw $FFFE,$FFFF

DATA_07D1A3:
	db $04,$05,$06,$07,$08,$09,$08,$07,$06,$05,$04,$00

DATA_07D1AF:
	db $02,$02,$02,$02,$01,$01,$01,$02,$02,$02,$02,$08

DATA_07D1BB:
	dw $FFFD,$FFFE,$FFFF

DATA_07D1C1:
	db $17,$16,$15,$14,$13,$12,$11,$10,$0F,$0E,$0D,$0C,$0B,$0A,$00

DATA_07D1D0:
	db $02,$02,$02,$02,$02,$02,$02,$02,$02,$02,$02,$02,$02,$02,$08

DATA_07D1DF:
	dw $FFFA,$FFFB,$FFFC,$FFFD,$FFFE,$FFFF

DATA_07D1EB:
	db $1C,$18,$19,$1A,$19,$18,$00

DATA_07D1F2:
	db $12,$01,$02,$30,$02,$02,$08

DATA_07D1F9:
	dw $FFF0,$0010

DATA_07D1FD:
	dw $0000,$0002,$0004,$0008

DATA_07D205:
	dw $0008,$FFF8

DATA_07D209:
	dw $0001,$0000,$0001,$0000,$0003,$0002,$0003,$0002
	dw $0005,$0004,$0005,$0004,$0007,$0006,$0007,$0006
	dw $0009,$0008,$0009,$0008,$000B,$000A,$000B,$000A

CODE_07D239:
	LDX.b $12
	JSR.w CODE_07D61E
	LDA.w #$0005
	STA.b $18,x
	LDY.w $7A38,x
	BMI.b CODE_07D267
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	BPL.b CODE_07D255
	EOR.w #$FFFF
	INC
CODE_07D255:
	LSR
	LSR
	LSR
	CMP.w #$0002
	BCS.b CODE_07D267
	ASL
	TAY
	LDA.b $18,x
	CLC
	ADC.w DATA_07D19F,y
	STA.b $18,x
CODE_07D267:
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07D193,y
	STA.w $7402,x
	LDA.w DATA_07D199,y
	STA.w $7A96,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID3C_InedibleObject
	JSL.l CODE_push_sound_queue
	STZ.b $76,x
	RTS

CODE_07D283:
	LDX.b $12
	JSR.w CODE_07D61E
	LDA.w $7A96,x
	BNE.b CODE_07D2AA
	DEC.b $18,x
	BMI.b CODE_07D2AB
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07D193,y
	STA.w $7402,x
	LDA.w DATA_07D199,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$02
	BNE.b CODE_07D2AA
	JSR.w CODE_07D701
CODE_07D2AA:
	RTS

CODE_07D2AB:
	LDA.w #$0000
	STA.w $7402,x
	INC.b $76,x
	RTS

CODE_07D2B4:
	LDX.b $12
	JSR.w CODE_07D61E
	LDA.w #$000B
	STA.b $18,x
	LDY.w $7A38,x
	BMI.b CODE_07D2E3
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	BPL.b CODE_07D2D0
	EOR.w #$FFFF
	INC
CODE_07D2D0:
	LSR
	LSR
	LSR
	LSR
	CMP.w #$0003
	BCS.b CODE_07D2E3
	ASL
	TAY
	LDA.b $18,x
	CLC
	ADC.w DATA_07D1BB,y
	STA.b $18,x
CODE_07D2E3:
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07D1A3,y
	STA.w $7402,x
	LDA.w DATA_07D1AF,y
	STA.w $7A96,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID3C_InedibleObject
	JSL.l CODE_push_sound_queue
	STZ.b $76,x
	RTS

CODE_07D2FF:
	LDX.b $12
	JSR.w CODE_07D61E
	LDA.w $7A96,x
	BNE.b CODE_07D326
	DEC.b $18,x
	BMI.b CODE_07D2AB
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07D1A3,y
	STA.w $7402,x
	LDA.w DATA_07D1AF,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$05
	BNE.b CODE_07D326
	JSR.w CODE_07D701
CODE_07D326:
	RTS

CODE_07D327:
	LDX.b $12
	JSR.w CODE_07D61E
	LDA.w #$000E
	STA.b $18,x
	LDY.w $7A38,x
	BMI.b CODE_07D356
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	BPL.b CODE_07D343
	EOR.w #$FFFF
	INC
CODE_07D343:
	LSR
	LSR
	LSR
	LSR
	CMP.w #$0006
	BCS.b CODE_07D356
	ASL
	TAY
	LDA.b $18,x
	CLC
	ADC.w DATA_07D1DF,y
	STA.b $18,x
CODE_07D356:
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07D1C1,y
	STA.w $7402,x
	LDA.w DATA_07D1D0,y
	STA.w $7A96,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID3C_InedibleObject
	JSL.l CODE_push_sound_queue
	STZ.b $76,x
	RTS

CODE_07D372:
	LDX.b $12
	JSR.w CODE_07D61E
	LDA.w $7A96,x
	BNE.b CODE_07D399
	DEC.b $18,x
	BMI.b CODE_07D39A
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07D1C1,y
	STA.w $7402,x
	LDA.w DATA_07D1D0,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$05
	BNE.b CODE_07D399
	JSR.w CODE_07D701
CODE_07D399:
	RTS

CODE_07D39A:
	JMP.w CODE_07D2AB

CODE_07D39D:
	LDX.b $12
	LDA.w #$0006
	STA.b $18,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	TAY
	LDA.w DATA_07D1EB,y
	STA.w $7402,x
	LDA.w DATA_07D1F2,y
	STA.w $7A96,x
	LDA.b #$2E
	STA.w $77C0,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID3C_InedibleObject
	JSL.l CODE_push_sound_queue
	STZ.b $76,x
	RTS

CODE_07D3C7:
	LDX.b $12
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7402,x
	CMP.w #$001A
	BNE.b CODE_07D43A
	LDA.w $7A98,x
	BNE.b CODE_07D41F
	LDY.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_07D205,y
	STA.b $00
	LDY.w $77C0,x
	LDA.w DATA_07D209,y
	STA.b $02
	DEY
	DEY
	BPL.b CODE_07D3F3
	LDY.b #$02
CODE_07D3F3:
	SEP.b #$20
	TYA
	STA.w $77C0,x
	REP.b #$20
	LDA.w #!Define_YI_AmbSpr228
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7142,y
	LDA.b $02
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	STA.w $7A98,x
CODE_07D41F:
	LDA.b $14
	AND.w #$0003
	ASL
	TAY
	LDA.w $7042,x
	ORA.w DATA_07D1FD,y
	STA.w $7042,x
	CPY.b #$00
	BNE.b CODE_07D43A
	LDA.w #!Define_YI_SoundID0E_ShellHit4
	JSL.l CODE_push_sound_queue
CODE_07D43A:
	LDA.w $7A96,x
	BNE.b CODE_07D487
	DEC.b $18,x
	BPL.b CODE_07D446
	JMP.w CODE_07D2AB

CODE_07D446:
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07D1EB,y
	STA.w $7402,x
	LDA.w DATA_07D1F2,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$00
	BNE.b CODE_07D487
	LDY.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_07D1F9,y
	STA.b $00
	LDA.w #$00FE
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_07D487
	LDA.w $7400,x
	STA.w $7400,y
	LDA.b $00
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	TYX
	JSL.l YI_NorSpr0FE_ZeusGuyBlast_Init
CODE_07D487:
	LDX.b $12
	RTS

DATA_07D48A:
	db $00,$21,$20,$21

DATA_07D48E:
	db $04,$04,$00,$20

CODE_07D492:
	LDX.b $12
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0003
	STA.b $18,x
	STZ.b $76,x
	RTS

CODE_07D49F:
	LDX.b $12
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_07D4D1
	LDA.w $7A96,x
	BNE.b CODE_07D4D1
	DEC.b $18,x
	BMI.b CODE_07D4D2
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07D48A,y
	STA.w $7402,x
	LDA.w DATA_07D48E,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$02
	BNE.b CODE_07D4D1
	LDA.w #$FA80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.w $7A36,x
CODE_07D4D1:
	RTS

CODE_07D4D2:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	INC.b $76,x
	RTS

DATA_07D4DB:
	dw $FFE0,$0020

CODE_07D4DF:
	STZ.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0080
	STA.b $00
	STA.b $04
	ASL
	STA.b $02
	STA.b $06
	JSL.l CODE_07FCFB
	BCS.b CODE_07D547
	LDA.w #$0002
	STA.b $16,x
	LDA.w #$0020
	STA.b $00
	ASL
	STA.b $02
	LDA.w #$0010
	STA.b $04
	ASL
	STA.b $06
	JSL.l CODE_07FCFB
	BCS.b CODE_07D547
	LDY.w $7400,x
	LDA.w DATA_07D4DB,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0010
	STA.b $00
	ASL
	STA.b $02
	LDA.w #$0010
	STA.b $04
	ASL
	STA.b $06
	JSL.l CODE_07FCFB
	BCS.b CODE_07D533
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_07D533:
	LDA.w #$0004
	STA.b $16,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	CMP.w #$0000
	BEQ.b CODE_07D545
	CMP.w #$0002
	BNE.b CODE_07D547
CODE_07D545:
	INC.b $76,x
CODE_07D547:
	RTS

DATA_07D548:
	dw $0008,$0004

DATA_07D54C:
	dw $FFEC,$0014

CODE_07D550:
	LDY.w $7400,x
	LDA.w $7CD6,x
	CLC
	ADC.w DATA_07D54C,y
	STA.b $00
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$F800
	CMP.w #$4000
	BEQ.b CODE_07D5A0
	LDA.b $00
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7CD8,x
	SEC
	SBC.w #$0008
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$F800
	CMP.w #$4000
	BNE.b CODE_07D5B5
CODE_07D5A0:
	LDA.w #$0006
	STA.b $16,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	CMP.w #$0000
	BEQ.b CODE_07D5B2
	CMP.w #$0002
	BNE.b CODE_07D5B4
CODE_07D5B2:
	INC.b $76,x
CODE_07D5B4:
	RTS

CODE_07D5B5:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	CMP.w #$000C
	BEQ.b CODE_07D5D1
	LDY.w $7400,x
	LDA.w $7860,x
	AND.w DATA_07D548,y
	BEQ.b CODE_07D5D1
	LDA.w #$000C
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	JSR.w CODE_07D492
CODE_07D5D1:
	RTS

CODE_07D5D2:
	LDY.w $7A38,x
	BMI.b CODE_07D619
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	STA.b $00
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCS.b CODE_07D619
	LDA.b $00
	BPL.b CODE_07D5F1
	EOR.w #$FFFF
	INC
CODE_07D5F1:
	ASL
	STA.b $00
	ASL
	STA.b $02
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	CLC
	ADC.b $00
	CMP.b $02
	BCS.b CODE_07D619
	LDA.w #$0006
	STA.b $16,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	CMP.w #$0000
	BEQ.b CODE_07D617
	CMP.w #$0002
	BNE.b CODE_07D619
CODE_07D617:
	INC.b $76,x
CODE_07D619:
	RTS

DATA_07D61A:
	dw $FFF0,$0010

CODE_07D61E:
	LDA.w $7400,x
	DEC
	STA.b $00
	LDY.w $7D36,x
	BMI.b CODE_07D64F
	DEY
	BEQ.b CODE_07D64F
	BMI.b CODE_07D64F
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07D64F
	LDA.w $7D38,y
	BEQ.b CODE_07D64F
	LDA.w $7400,x
	DEC
	STA.b $02
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	EOR.b $02
	BMI.b CODE_07D64F
	JMP.w CODE_07D6A2

CODE_07D64F:
	LDY.w $7A38,x
	BMI.b CODE_07D6A2
	LDA.w $7BB8,x
	CLC
	ADC.w #$0008
	CLC
	ADC.w $7BB8,y
	STA.b $04
	ASL
	STA.b $02
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	CLC
	ADC.b $04
	CMP.b $02
	BCS.b CODE_07D6A2
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	STA.b $02
	EOR.b $00
	BPL.b CODE_07D6A2
	LDA.w $7BB6,x
	CLC
	ADC.w #$0008
	CLC
	ADC.w $7BB6,y
	STA.b $04
	LDA.b $02
	BPL.b CODE_07D694
	EOR.w #$FFFF
	INC
CODE_07D694:
	CMP.b $04
	BCS.b CODE_07D6A2
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDX.b $12
CODE_07D6A2:
	LDA.w $7BB8,x
	CLC
	ADC.w $6122
	STA.b $02
	ASL
	STA.b $04
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	CLC
	ADC.b $02
	CMP.w $7964
	BCS.b CODE_07D700
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	STA.b $02
	EOR.b $00
	BPL.b CODE_07D700
	LDA.w $7BB6,x
	CLC
	ADC.w #$0008
	CLC
	ADC.w $6120
	STA.b $04
	LDA.b $02
	BPL.b CODE_07D6DF
	EOR.w #$FFFF
	INC
CODE_07D6DF:
	CMP.b $04
	BCS.b CODE_07D700
	LDA.w $61D6
	BNE.b CODE_07D6FC
	LDY.w $7400,x
	LDA.w $7CD6,x
	CLC
	ADC.w DATA_07D61A,y
	STA.b $00
	LDA.w $7CD8,x
	STA.b $02
	JSR.w CODE_07FD16
CODE_07D6FC:
	JSL.l CODE_03A858
CODE_07D700:
	RTS

CODE_07D701:
	LDY.w $7400,x
	LDA.w $7CD6,x
	CLC
	ADC.w DATA_07D54C,y
	STA.b $00
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7CD8,x
	STA.b $02
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$F800
	CMP.w #$4000
	BNE.b CODE_07D731
	JSR.w CODE_07D75C
CODE_07D731:
	LDA.b $00
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7CD8,x
	SEC
	SBC.w #$0008
	STA.b $02
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$F800
	CMP.w #$4000
	BNE.b CODE_07D75B
	JSR.w CODE_07D75C
CODE_07D75B:
	RTS

CODE_07D75C:
	LDA.w #$0000
	STA.w $008F
	LDA.b $00
	STA.w $0091
	LDA.b $02
	STA.w $0093
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

CODE_07D79D:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_07D7EA
	LDY.w $7D36,x
	BMI.b CODE_07D7EB
	DEY
	BMI.b CODE_07D7EA
	BEQ.b CODE_07D7EA
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07D7EA
	LDA.w $7D38,y
	BEQ.b CODE_07D7EA
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
CODE_07D7CE:
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$0010
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07D835,y
	STA.w $7402,x
	LDA.w DATA_07D846,y
	STA.w $7A96,x
	REP.b #$20
CODE_07D7EA:
	RTL

CODE_07D7EB:
	LDA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	BNE.b CODE_07D805
	JSL.l CODE_07FC2F
	BCC.b CODE_07D803
CODE_07D7F6:
	JSL.l CODE_03B20B
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	BRA.b CODE_07D7CE

CODE_07D803:
	BEQ.b CODE_07D809
CODE_07D805:
	JSL.l CODE_03A858
CODE_07D809:
	RTL

DATA_07D80A:
	db $01,$20

CODE_07D80C:
	LDY.b #$00
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_07D817
	INY
CODE_07D817:
	LDA.w DATA_07D80A,y
	AND.w #$00FF
	STA.w $7540,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_07D82E
	LDA.w $7400,x
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_07D834
CODE_07D82E:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
CODE_07D834:
	RTL

DATA_07D835:
	db $2A,$2B,$2A,$2B,$2A,$2B,$2A,$2A,$29,$28,$27,$26,$25,$24,$23,$22
	db $00

DATA_07D846:
	db $20,$02,$02,$02,$02,$02,$02,$22,$02,$02,$80,$02,$04,$02,$02,$04
	db $02

YI_NorSpr0FD_ZeusGuy_StompRt:
head_bop_zeus_guy:                         ; Raidenthequick: head_bop_zeus_guy
;$07D857
	LDA.w $7042,x
	AND.w #$FFF1
	STA.w $7042,x
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_07D86B
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_07D86B:
	LDA.w $7A96,x
	BNE.b CODE_07D898
	DEC.b $18,x
	BMI.b CODE_07D8B0
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07D835,y
	STA.w $7402,x
	LDA.w DATA_07D846,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$0F
	BNE.b CODE_07D898
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_07D898
	LDA.w #$FE80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_07D898:
	JSL.l CODE_07FD6C
	BEQ.b CODE_07D8A7
	PHP
	LDA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	BNE.b CODE_07D8AB
	PLP
	BCS.b CODE_07D8A8
CODE_07D8A7:
	RTL

CODE_07D8A8:
	JMP.w CODE_07D7F6

CODE_07D8AB:
	PLP
	JML.l CODE_kill_sprite_by_hit

CODE_07D8B0:
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	JML.l CODE_init_zeus_guy

;---------------------------------------------------------------------------

DATA_07D8BA:
	db $01,$02,$03,$04,$05,$06,$07,$08,$09,$0A,$0B,$0A,$09,$08,$07,$06
	db $05,$04,$03,$02,$01,$00

DATA_07D8D0:
	dw $FF00,$0100

YI_NorSpr0FE_ZeusGuyBlast_Init:
init_zeus_guy_blast:                       ; Raidenthequick: init_zeus_guy_blast
;$07D8D4
	LDA.w #$0015
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07D8BA,y
	STA.w $7402,x
	LDA.b #$01
	STA.w $7A96,x
	REP.b #$20
	LDY.w $7400,x
	LDA.w DATA_07D8D0,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr0FE_ZeusGuyBlast_Main:
main_zeus_guy_blast:                       ; Raidenthequick: main_zeus_guy_blast
;$07D8F3
	JSL.l CODE_03AF23
	LDA.w $7A96,x
	BNE.b CODE_07D91E
	DEC.b $18,x
	BPL.b CODE_07D905
	LDA.w #$0015
	STA.b $18,x
CODE_07D905:
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07D8BA,y
	STA.w $7402,x
	LDA.w $7402,x
	EOR.b #$01
	STA.w $7402,x
	LDA.b #$01
	STA.w $7A96,x
	REP.b #$20
CODE_07D91E:
	LDY.w $7D36,x
	BPL.b CODE_07D955
	LDA.w #!Define_YI_AmbSpr20A
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	SEC
	SBC.w #$0004
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0004
	STA.w $7142,y
	LDA.w #$0008
	STA.w $7782,y
	LDA.w #$0004
	STA.w $73C2,y
	STA.w $7E4C,y
	JSL.l CODE_03A858
	JSL.l CODE_03A31E
CODE_07D955:
	RTL

;---------------------------------------------------------------------------

YI_NorSpr167_GreenKoopaShell_Init:
YI_NorSpr168_RedKoopaShell_Init:
init_koopa_shell:                          ; Raidenthequick: init_koopa_shell
;$07D956
	LDA.w #$0002
	STA.b $78,x
	RTL

;---------------------------------------------------------------------------

DATA_07D95C:
	dw $0380,$FC80

DATA_07D960:
	dw $FE40,$FF00

YI_NorSpr167_GreenKoopaShell_Main:
YI_NorSpr168_RedKoopaShell_Main:
main_koopa_shell:                          ; Raidenthequick: main_koopa_shell
;$07D964
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	LDA.w $6FA0,x
	ORA.w #$0600
	STA.w $6FA0,x
endif
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_07D971
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	BRA.b CODE_07D976

CODE_07D971:
	LDA.w $7D38,x
	BNE.b CODE_07D980
CODE_07D976:
	JSL.l CODE_03AF23
	JSL.l CODE_07E336
	BRA.b CODE_07D994

CODE_07D980:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	BEQ.b CODE_07D986
	RTL

CODE_07D986:
	LDA.w $7D38,x
	CMP.w #$0002
	BCC.b CODE_07D991
	DEC.w $7D38,x
CODE_07D991:
	JSR.w CODE_07DC8C
CODE_07D994:
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_07D9AA
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	CMP.w #$0002
	BCS.b CODE_07D9AD
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	BRA.b CODE_07D9AD

CODE_07D9AA:
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
CODE_07D9AD:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	CMP.w #$0001
	BNE.b CODE_07D9CF
	LDA.w #!Define_YI_SoundID1D_ObjectLanding
	JSL.l CODE_push_sound_queue
	LDA.b $76,x
	CMP.w #$0002
	BCS.b CODE_07D9CF
	LDA.b $76,x
	ASL
	TAY
	LDA.w DATA_07D960,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
CODE_07D9CF:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0180
	CMP.w #$0301
	BCS.b CODE_07DA52
	LDY.w $7D38,x
	CPY.b #$02
	BCS.b CODE_07D9E7
	LDY.w $7D36,x
	BMI.b CODE_07D9EA
CODE_07D9E7:
	JMP.w CODE_07DA7A

CODE_07D9EA:
	JSL.l CODE_07FC2F
	BCC.b CODE_07D9F9
	JSL.l CODE_03B20B
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	BRA.b CODE_07D9FC

CODE_07D9F9:
	LDA.w #!Define_YI_SoundID0B_ShellHit1
CODE_07D9FC:
	JSL.l CODE_push_sound_queue
	LDA.w $61D6
	CMP.w #$0020
	BCS.b CODE_07DA0E
	LDA.w #$0020
	STA.w $61D6
CODE_07DA0E:
	LDA.w $60A8
	BPL.b CODE_07DA17
	EOR.w #$FFFF
	INC
CODE_07DA17:
	STA.b $00
	CMP.w #$0300
	BMI.b CODE_07DA26
	LDA.b $00
	CLC
	ADC.w #$0080
	BRA.b CODE_07DA29

CODE_07DA26:
	LDA.w #$0380
CODE_07DA29:
	STA.b $00
	EOR.w #$FFFF
	INC
	STA.b $02
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	AND.w #$8000
	ASL
	ROL
	ASL
	TAY
	LDA.w $7960,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w #$0001
	STA.w $7D38,x
	RTL

CODE_07DA52:
	LDA.w $7860,x
	AND.w #$000E
	BEQ.b CODE_07DA61
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
CODE_07DA61:
	LDA.w $7A96,x
	BNE.b CODE_07DA76
	LDA.w $7402,x
	INC
	AND.w #$0003
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A96,x
CODE_07DA76:
	JSR.w CODE_07DAA8
	RTL

CODE_07DA7A:
	LDA.w $7A98,x
	BNE.b CODE_07DA9B
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_07DA8B
	JSR.w CODE_07DAA8
	RTL

CODE_07DA8B:
	LDA.b $76,x
	CMP.w #$0002
	BCC.b CODE_07DA95
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_07DA95:
	STZ.w $7D38,x
	JSR.w CODE_07DC43
CODE_07DA9B:
	RTL

DATA_07DA9C:
DATA_koopa_shell_hit_sound_ids:                 ; 7-step ascending shell-impact sound chain (last step pinned at SoundID12)
; note: entries 7 and 8 are BOTH SoundID12_ShellHit8 -- the chain plateaus at the 8th hit, not the 9th. Almost certainly an iterative-tuning artefact (compare the SMW shell sound which escalates uniformly); not a tunable design. See docs/family-koopas.md.
	db !Define_YI_SoundID0C_ShellHit2,!Define_YI_SoundID0D_ShellHit3,!Define_YI_SoundID0E_ShellHit4,!Define_YI_SoundID0F_ShellHit5
	db !Define_YI_SoundID10_ShellHit6,!Define_YI_SoundID11_ShellHit7,!Define_YI_SoundID12_ShellHit8,!Define_YI_SoundID12_ShellHit8

DATA_07DAA4:
	dw $0200,$FE00

CODE_07DAA8:
	LDY.w $7D36,x
	BPL.b CODE_07DADC
	LDA.w $7D38,x
	CMP.w #$0002
	BCS.b CODE_07DADC
	JSL.l CODE_07FC2F
	BCC.b CODE_07DAD5
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JSL.l CODE_03B20B
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_07DAD4
	STZ.w $7D38,x
CODE_07DAD4:
	RTS

CODE_07DAD5:
	BEQ.b CODE_07DADB
	JSL.l CODE_03A858
CODE_07DADB:
	RTS

CODE_07DADC:
	DEY
	BMI.b CODE_07DB5C
	BEQ.b CODE_07DB5C
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07DB5C
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_07DAF6
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BCC.b CODE_07DAFB
CODE_07DAF6:
	CMP.w #!Define_YI_NorSpr107_WatermelonSeed
	BNE.b CODE_07DB00
CODE_07DAFB:
	LDA.w $7D38,y
	BNE.b CODE_07DB1A
CODE_07DB00:
	LDA.w $6FA2,y
	BIT.w #$6000
	BNE.b CODE_07DB5C
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr167_GreenKoopaShell
	BCC.b CODE_07DB15
	CMP.w #!Define_YI_NorSpr170_AquaLakitu
	BCC.b CODE_07DB5D
CODE_07DB15:
	LDA.w $7D38,y
	BEQ.b CODE_07DB1D
CODE_07DB1A:
	JMP.w CODE_07DC05

CODE_07DB1D:
	LDA.w $6FA0,y
	BIT.w #$0020
	BNE.b CODE_07DB5C
	LDA.w $7A36,x
	INC
	CMP.w #$0009
	BCS.b CODE_07DB31
	STA.w $7A36,x
CODE_07DB31:
	CMP.w #$0008
	BCC.b CODE_07DB3F
	PHX
	PHY
	TYX
	JSL.l CODE_spawn_1up_score
	PLY
	PLX
CODE_07DB3F:
	TYX
	JSL.l CODE_0CFF61
	JSL.l CODE_despawn_sprite_free_slot
	LDX.b $12
CODE_07DB4A:
	LDY.w $7A36,x
	DEY
	CPY.b #$07
	BCS.b CODE_07DB5C
	LDA.w DATA_koopa_shell_hit_sound_ids,y
	AND.w #$00FF
	JSL.l CODE_push_sound_queue
CODE_07DB5C:
	RTS

CODE_07DB5D:
	CMP.w #!Define_YI_NorSpr169_GreenNakedKoopa
	BCS.b CODE_07DB9F
	LDA.w $7D38,y
	BEQ.b CODE_07DB9F
	PHY
	JSL.l CODE_03B288
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	LDA.w $7C77,x
	AND.b #$80
	ASL
	ROL
	ASL
	EOR.b #$02
	TAY
	REP.b #$20
	LDA.w DATA_07DAA4,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	PLY
CODE_07DB9F:
	LDA.w $7A36,x
	INC
	CMP.w #$0009
	BCS.b CODE_07DBAB
	STA.w $7A36,x
CODE_07DBAB:
	CMP.w #$0008
	BCC.b CODE_07DBB9
	PHX
	PHY
	TYX
	JSL.l CODE_spawn_1up_score
	PLY
	PLX
CODE_07DBB9:
	PHY
	TYX
	JSL.l CODE_0CFF61
	JSL.l CODE_kill_sprite_by_hit_checked
	PLY
	LDX.b $12
	SEP.b #$20
	LDA.w $7C77,x
	AND.b #$80
	ASL
	ROL
	ASL
	TAX
	REP.b #$20
	LDA.w DATA_07DAA4,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w #$0040
	STA.w $7542,y
	LDA.w #$0400
	STA.w $75E2,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $6FA2,y
	ORA.w #$0020
	STA.w $6FA2,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LDX.b $12
	JMP.w CODE_07DB4A

CODE_07DC05:
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	BCS.b CODE_07DC42
	JSL.l CODE_03B288
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	LDA.w $7C77,x
	AND.b #$80
	ASL
	ROL
	ASL
	EOR.b #$02
	TAY
	REP.b #$20
	LDA.w DATA_07DAA4,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_07DC42:
	RTS

CODE_07DC43:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_07DC8B
	BEQ.b CODE_07DC8B
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07DC8B
	LDA.w $7D38,y
	BEQ.b CODE_07DC8B
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr167_GreenKoopaShell
	BCC.b CODE_07DC65
	CMP.w #!Define_YI_NorSpr169_GreenNakedKoopa
	BCC.b CODE_07DC8B
CODE_07DC65:
	STZ.b $00
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	BPL.b CODE_07DC74
	INC.b $00
	INC.b $00
CODE_07DC74:
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	BCS.b CODE_07DC8B
	LDX.b $12
	LDY.b $00
	LDA.w DATA_07D95C,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0001
	STA.w $7D38,x
CODE_07DC8B:
	RTS

CODE_07DC8C:
	LDA.w $7860,x
	AND.w #$000E
	BEQ.b CODE_07DC8B
	BIT.w #$0008
	BNE.b CODE_07DCED
	BIT.w #$0004
	BNE.b CODE_07DCC7
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	REP.b #$10
	TAX
	LDA.l $70001C,x
	AND.w #$F800
	CMP.w #$4000
	BNE.b CODE_07DCC4
	LDA.l $700018,x
	STA.b $00
	STA.w $0091
	LDA.l $70001A,x
	STA.b $02
	STA.w $0093
	BRA.b CODE_07DD11

CODE_07DCC4:
	JMP.w CODE_07DD49

CODE_07DCC7:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	REP.b #$10
	TAX
	LDA.l $700014,x
	AND.w #$F800
	CMP.w #$4000
	BNE.b CODE_07DD49
	LDA.l $700010,x
	STA.b $00
	STA.w $0091
	LDA.l $700012,x
	STA.b $02
	STA.w $0093
	BRA.b CODE_07DD11

CODE_07DCED:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	REP.b #$10
	TAX
	LDA.l $70000C,x
	AND.w #$F800
	CMP.w #$4000
	BNE.b CODE_07DD49
	LDA.l $700008,x
	STA.b $00
	STA.w $0091
	LDA.l $70000A,x
	STA.b $02
	STA.w $0093
CODE_07DD11:
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
CODE_07DD49:
	SEP.b #$10
	LDX.b $12
	RTS

DATA_07DD4E:
	dw $FFA0,$0060

;---------------------------------------------------------------------------

YI_NorSpr169_GreenNakedKoopa_Init:
YI_NorSpr16A_RedNakedKoopa_Init:
init_koopa_naked:                          ; Raidenthequick: init_koopa_naked
;$07DD52
	LDY.w $7400,x
	LDA.w DATA_07DD4E,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$010A
	STA.w $7A36,x
	LDA.w $7860,x
	STA.w $7A38,x
	SEP.b #$20
	STZ.w $7402,x
	LDA.b #$05
	STA.w $7A96,x
	LDA.b #$00
	STA.b $16,x
	REP.b #$20
	RTL

;---------------------------------------------------------------------------

; See docs/family-koopas.md for the full Goomba + Koopa + Parakoopa
; family breakdown. The 4 "green vs red" Koopa variants collapse to
; just 2 physical Init/Main bodies; the color split is encoded via
; 2-entry dispatch tables + SpriteID range-tests.

YI_NorSpr16B_GreenKoopa_Init:
YI_NorSpr16C_RedKoopa_Init:
init_koopa:                                ; Raidenthequick: init_koopa
;$07DD78
	LDY.w $7400,x
	LDA.w DATA_07DD4E,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$000A
	STA.w $7A36,x
	LDA.w $7860,x
	STA.w $7A38,x
	SEP.b #$20
	STZ.w $7402,x
	LDA.b #$05
	STA.w $7A96,x
	LDA.b #$00
	STA.b $16,x
	REP.b #$20
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr169_GreenNakedKoopa_Main:
YI_NorSpr16A_RedNakedKoopa_Main:
main_koopa_naked:                          ; Raidenthequick: main_koopa_naked
;$07DDA1
	LDX.b #FXCODE_08949D>>16
	LDA.w #FXCODE_08949D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	JSL.l CODE_03AF23
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_07DDC6
	LDA.w $7A38,x
	BIT.w #$0001
	BNE.b CODE_07DDC6
	LDA.w #$0002
	STA.w $7A98,x
CODE_07DDC6:
	LDA.b $16,x
	TAX
	JSR.w (DATA_koopa_naked_state_ptr,x)
	JSL.l CODE_03A5B7
	RTL

DATA_07DDD1:
DATA_koopa_naked_state_ptr:                     ; 4-entry Naked Koopa state ptr: walk / turn / on-shell-pickup / squashed
	dw CODE_07DE7F
	dw CODE_07DFFF
	dw CODE_07E12D
	dw CODE_07E1B4

YI_NorSpr16B_GreenKoopa_Main:
YI_NorSpr16C_RedKoopa_Main:
main_koopa:                                ; Raidenthequick: main_koopa
;$07DDD9
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_07DDE4
	JMP.w CODE_07E234

CODE_07DDE4:
	LDX.b #FXCODE_08949D>>16
	LDA.w #FXCODE_08949D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	JSL.l CODE_03AF23
	JSL.l CODE_07E35B
	JSL.l CODE_03A5B7
	JSL.l CODE_07E2A1
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_07DE15
	LDA.w $7A38,x
	BIT.w #$0001
	BNE.b CODE_07DE15
	LDA.w #$0002
	STA.w $7A98,x
CODE_07DE15:
	LDA.b $16,x
	TAX
	JSR.w (DATA_koopa_shelled_state_ptr,x)
	RTL

DATA_07DE1C:
DATA_koopa_shelled_state_ptr:                   ; 3-entry shelled Koopa state ptr: walk / turn / panic
	dw CODE_07DE2A
	dw CODE_07DFFF
	dw CODE_07E0C6

DATA_07DE22:
	db $07,$06,$05,$04,$03,$02,$01,$00

CODE_07DE2A:
	LDX.b $12
	JSR.w CODE_07E1E4
	BEQ.b CODE_07DE36
	JSR.w CODE_07E1F3
	BRA.b CODE_07DE39

CODE_07DE36:
	JSR.w CODE_07E1FD
CODE_07DE39:
	JSR.w CODE_07E303
	JSR.w CODE_07E250
	LDA.w $7A98,x
	BNE.b CODE_07DE4F
	LDY.w $7400,x
	LDA.w DATA_07DD4E,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_07DE67

CODE_07DE4F:
	LDA.w #$000C
	STA.w $7402,x
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_07DE7E
	LDA.w #$0008
	STA.w $7402,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_07DE67:
	LDA.w $7A96,x
	BNE.b CODE_07DE7E
	SEP.b #$20
	LDA.w $7402,x
	INC
	AND.b #$07
	STA.w $7402,x
	LDA.b #$05
	STA.w $7A96,x
	REP.b #$20
CODE_07DE7E:
	RTS

CODE_07DE7F:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	BEQ.b CODE_07DE89
	JMP.w CODE_07DF0D

CODE_07DE89:
	LDA.w $7AF6,x
	BNE.b CODE_07DF0D
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_099856>>16
	LDA.w #FXCODE_099856
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	BMI.b CODE_07DF0D
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8,y
	CLC
	ADC.w #$0010
	CMP.w #$0020
	BCS.b CODE_07DF0D
	LDA.w $7400,x
	DEC
	STA.b $00
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	STA.b $02
	EOR.b $00
	BPL.b CODE_07DF0D
	LDA.b $02
	BPL.b CODE_07DED5
	EOR.w #$FFFF
	INC
CODE_07DED5:
	CMP.w #$0020
	BCS.b CODE_07DF0D
	ASL
	ASL
	ASL
	LDY.b $03
	BMI.b CODE_07DEE5
	EOR.w #$FFFF
	INC
CODE_07DEE5:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7542,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	STA.w $7A38,x
	LDA.w #$000C
	STA.w $7402,x
	RTS

CODE_07DF0D:
	JSR.w CODE_07E1E4
	BEQ.b CODE_07DF17
	JSR.w CODE_07E1F3
	BRA.b CODE_07DF1A

CODE_07DF17:
	JSR.w CODE_07E1FD
CODE_07DF1A:
	JSR.w CODE_07E303
	JSR.w CODE_07E250
	LDA.w $7A98,x
	BNE.b CODE_07DF49
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	LDY.w $7400,x
	LDA.w DATA_07DD4E,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A96,x
	BNE.b CODE_07DF48
	SEP.b #$20
	LDA.w $7402,x
	INC
	AND.b #$07
	STA.w $7402,x
	LDA.b #$05
	STA.w $7A96,x
	REP.b #$20
CODE_07DF48:
	RTS

CODE_07DF49:
	LDA.w #$000C
	LDY.w $7223,x
	BMI.b CODE_07DF54
	LDA.w #$0010
CODE_07DF54:
	STA.w $7402,x
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_07DF93
	LDY.w $7D36,x
	BMI.b CODE_07DF90
	DEY
	BMI.b CODE_07DF90
	BEQ.b CODE_07DF90
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr167_GreenKoopaShell
	BCC.b CODE_07DF90
	CMP.w #!Define_YI_NorSpr169_GreenNakedKoopa
	BCS.b CODE_07DF90
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07DF90
	LDA.w $7D38,y
	BNE.b CODE_07DF90
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BNE.b CODE_07DF90
	LDA.w $7860,y
	BIT.w #$0001
	BNE.b CODE_07DF94
CODE_07DF90:
	JMP.w CODE_07DFEF

CODE_07DF93:
	RTS

CODE_07DF94:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr167_GreenKoopaShell
	BNE.b CODE_07DFA1
	LDA.w #!Define_YI_NorSpr16B_GreenKoopa
	BRA.b CODE_07DFA4

CODE_07DFA1:
	LDA.w #!Define_YI_NorSpr16C_RedKoopa
CODE_07DFA4:
	PHY
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7182,x
	LDA.w #$FFF8
	STA.w $7720,x
	LDA.w #$0004
	STA.b $16,x
	LDA.w #$0004
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07E05C,y
	STA.w $7402,x
	LDA.w DATA_07E061,y
	STA.w $7A96,x
	REP.b #$20
	LDA.w #$000A
	STA.w $7A36,x
	LDA.w $7860,x
	STA.w $7A38,x
	PLX
	JSL.l CODE_03A31E
	LDX.b $12
	RTS

CODE_07DFEF:
	LDA.w #$0040
	STA.w $7542,x
	JMP.w CODE_07E042

CODE_07DFF8:
	RTS

DATA_07DFF9:
	db $08,$09,$0A,$0A,$09,$08

CODE_07DFFF:
	LDX.b $12
	LDA.w $7860,x
	STA.w $7A38,x
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_07E01A
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	BRA.b CODE_07E042

CODE_07E01A:
	LDA.w $7A96,x
	BNE.b CODE_07E041
	DEC.b $18,x
	BMI.b CODE_07E042
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07DFF9,y
	STA.w $7402,x
	LDA.b #$05
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$02
	BNE.b CODE_07E041
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_07E041:
	RTS

CODE_07E042:
	LDY.w $7400,x
	LDA.w DATA_07DD4E,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	STZ.w $7402,x
	LDA.b #$05
	STA.w $7A96,x
	LDA.b #$00
	STA.b $16,x
	REP.b #$20
	RTS

DATA_07E05C:
	db $08,$0D,$0C,$0B,$0E

DATA_07E061:
	db $0A,$08,$10,$08,$60

DATA_07E066:
	dw $FFFE,$0002,$0002,$FFFE,$FFFE,$0002,$0002,$FFFE
	dw $FFFE,$0002,$0002,$FFFE,$FFFE,$0002,$0002,$FFFE
	dw $FFFE,$0002,$0002,$FFFE,$FFFE,$0002,$0002,$FFFE
	dw $FFFE,$0002,$0002,$FFFE,$FFFE,$0002,$0002,$FFFE
	dw $FFFE,$0002,$0002,$FFFE,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000

CODE_07E0C6:
	LDX.b $12
	LDA.b $18,x
	CMP.w #$0004
	BNE.b CODE_07E0E1
	LDA.w $7A96,x
	LSR
	BCS.b CODE_07E0E1
	ASL
	TAY
	LDA.w $70E2,x
	CLC
	ADC.w DATA_07E066,y
	STA.w $70E2,x
CODE_07E0E1:
	LDA.w $7A96,x
	BNE.b CODE_07E125
	DEC.b $18,x
	BMI.b CODE_07E126
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07E05C,y
	STA.w $7402,x
	LDA.w DATA_07E061,y
	STA.w $7A96,x
	REP.b #$20
	CPY.b #$03
	BNE.b CODE_07E10F
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w $7182,x
	STZ.w $7720,x
	BRA.b CODE_07E125

CODE_07E10F:
	CPY.b #$02
	BNE.b CODE_07E125
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	AND.w #$FFFE
	STA.w $7860,x
	STA.w $7A38,x
CODE_07E125:
	RTS

CODE_07E126:
	JMP.w CODE_07E042

DATA_07E129:
	dw $FFE0,$0020

CODE_07E12D:
	LDX.b $12
	LDA.w $7400,x
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_07E193
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_07E193
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_07E191
	LDA.w $6FA0,x
	ORA.w #$0200
	STA.w $6FA0,x
	LDA.b $14
	AND.w #$0003
	BNE.b CODE_07E191
	LDY.w $7400,x
	LDA.w DATA_07E129,y
	STA.b $00
	LDA.w #!Define_YI_AmbSpr1E0
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $73C0,y
	LDA.w #$0004
	STA.w $7782,y
	STA.w $7E4C,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FFF0
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0014
	STA.w $7142,y
CODE_07E191:
	PLA
	RTL

CODE_07E193:
	LDA.w $6FA0,x
	ORA.w #$0200
	STA.w $6FA0,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0008
	STA.w $7A96,x
	LDA.w #$0001
	STA.b $18,x
	LDA.w #$0006
	STA.b $16,x
	PLA
	RTL

CODE_07E1B4:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07E1CB
	DEC.b $18,x
	BMI.b CODE_07E1CD
	LDA.w #$000D
	STA.w $7402,x
	LDA.w #$0008
	STA.w $7A96,x
CODE_07E1CB:
	PLA
	RTL

CODE_07E1CD:
	STZ.b $18,x
	JSR.w CODE_07E1E4
	BNE.b CODE_07E1DD
	LDA.w $6FA2,x
	ORA.w #$0200
	STA.w $6FA2,x
CODE_07E1DD:
	JMP.w CODE_07E042

DATA_07E1E0:
	dw !Define_YI_NorSpr16A_RedNakedKoopa
	dw !Define_YI_NorSpr16C_RedKoopa

CODE_07E1E4:
	LDY.b #$02
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
CODE_07E1E9:
	CMP.w DATA_07E1E0,y
	BEQ.b CODE_07E1F2
	DEY
	DEY
	BPL.b CODE_07E1E9
CODE_07E1F2:
	RTS

CODE_07E1F3:
	LDA.w $7860,x
	BIT.w #$000C
	BNE.b CODE_07E20F
	BRA.b CODE_07E229

CODE_07E1FD:
	LDA.w $7860,x
	BIT.w #$000C
	BNE.b CODE_07E20F
	BIT.w #$0001
	BNE.b CODE_07E229
	LDA.w $7A38,x
	BEQ.b CODE_07E229
CODE_07E20F:
	LDA.w #$0005
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07DFF9,y
	STA.w $7402,x
	LDA.b #$05
	STA.w $7A96,x
	LDA.b #$02
	STA.b $16,x
	REP.b #$20
	PLA
CODE_07E229:
	LDA.w $7860,x
	STA.w $7A38,x
	RTS

DATA_07E230:
	dw !Define_YI_NorSpr16B_GreenKoopa
	dw !Define_YI_NorSpr16D_GreenParakoopa

CODE_07E234:
	LDY.b #$02
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
CODE_07E239:
	CMP.w DATA_07E230,y
	BEQ.b CODE_07E247
	DEY
	DEY
	BPL.b CODE_07E239
	LDA.w #!Define_YI_NorSpr168_RedKoopaShell
	BRA.b CODE_07E24A

CODE_07E247:
	LDA.w #!Define_YI_NorSpr167_GreenKoopaShell
CODE_07E24A:
	TXY
	JSL.l CODE_spawn_sprite
	RTL

CODE_07E250:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_07E2A0
	BEQ.b CODE_07E2A0
	LDA.w $7D38,y
	BNE.b CODE_07E2A0
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr169_GreenNakedKoopa
	BCC.b CODE_07E2A0
	CMP.w #!Define_YI_NorSpr16E_RedHorizontalParakoopa
	BCS.b CODE_07E2A0
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07E2A0
	LDA.w $7400,x
	DEC
	STA.b $00
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	EOR.b $00
	BPL.b CODE_07E2A0
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0005
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07DFF9,y
	STA.w $7402,x
	LDA.b #$05
	STA.w $7A96,x
	LDA.b #$02
	STA.b $16,x
	REP.b #$20
	PLA
CODE_07E2A0:
	RTS

CODE_07E2A1:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_07E302
	BEQ.b CODE_07E302
	LDA.w $7D38,y
	BEQ.b CODE_07E302
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr167_GreenKoopaShell
	BCC.b CODE_07E2BB
	CMP.w #!Define_YI_NorSpr169_GreenNakedKoopa
	BCC.b CODE_07E302
CODE_07E2BB:
	STZ.b $00
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	BPL.b CODE_07E2CA
	INC.b $00
	INC.b $00
CODE_07E2CA:
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr16B_GreenKoopa
	BNE.b CODE_07E2DE
	LDA.w #!Define_YI_NorSpr167_GreenKoopaShell
	BRA.b CODE_07E2E1

CODE_07E2DE:
	LDA.w #!Define_YI_NorSpr168_RedKoopaShell
CODE_07E2E1:
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7A98,x
	LDA.w #$0001
	STA.w $7D38,x
	LDY.b $00
	LDA.w DATA_07D95C,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLY
	PLA
CODE_07E302:
	RTL

CODE_07E303:
	LDA.w $61D6
	BNE.b CODE_07E335
	LDY.w $7D36,x
	BPL.b CODE_07E335
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BEQ.b CODE_07E335
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0005
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07DFF9,y
	STA.w $7402,x
	LDA.b #$05
	STA.w $7A96,x
	LDA.b #$02
	STA.b $16,x
	REP.b #$20
	PLA
CODE_07E335:
	RTS

CODE_07E336:
	LDY.w $7D36,x
	BPL.b CODE_07E35A
	LDA.w $60D4
	BEQ.b CODE_07E35A
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_07E35A
	JSL.l CODE_0CFF61
	PLY
	PLA
	JML.l CODE_kill_sprite_by_hit

CODE_07E35A:
	RTL

CODE_07E35B:
	LDY.w $7D36,x
	BPL.b CODE_07E398
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_07E398
	LDA.w $60D4
	BEQ.b CODE_07E37F
	JSL.l CODE_0CFF61
	PLY
	PLA
	JML.l CODE_kill_sprite_by_hit

CODE_07E37F:
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	PLY
	PLA
	JML.l CODE_03B20B

CODE_07E398:
	RTL

CODE_07E399:
	LDA.w $7040,x
	BIT.w #$0003
	BEQ.b CODE_07E3AC
	LDX.b #FXCODE_08949D>>16
	LDA.w #FXCODE_08949D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_07E3AC:
	STZ.w $7402,x
	LDA.w $7040,x
	AND.w #$07FC
	ORA.w #$0800
	STA.w $7040,x
	BRA.b CODE_07E3C8

YI_NorSpr169_GreenNakedKoopa_StompRt:
YI_NorSpr16A_RedNakedKoopa_StompRt:
head_bop_koopa_naked:                      ; Raidenthequick: head_bop_koopa_naked
;$07E3BD
	LDX.b #FXCODE_08949D>>16
	LDA.w #FXCODE_08949D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
YI_NorSpr167_GreenKoopaShell_StompRt:
YI_NorSpr168_RedKoopaShell_StompRt:
CODE_07E3C8:
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
	LDA.w $7042,x
	ORA.w #$00B0
	STA.w $7042,x
	RTL

DATA_07E3DB:
	dw $0400,$FC00

YI_NorSpr16B_GreenKoopa_StompRt:
head_bop_koopa_green:                      ; Raidenthequick: head_bop_koopa_green
;$07E3DF
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_07E399
	LDX.b #FXCODE_08949D>>16
	LDA.w #FXCODE_08949D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #$0167
	STA.b $00
	LDA.w #!Define_YI_NorSpr169_GreenNakedKoopa
	BRA.b CODE_07E411

YI_NorSpr16C_RedKoopa_StompRt:
head_bop_koopa_red:                        ; Raidenthequick: head_bop_koopa_red
;$07E3F9
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_07E399
	LDX.b #FXCODE_08949D>>16
	LDA.w #FXCODE_08949D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #$0168
	STA.b $00
	LDA.w #!Define_YI_NorSpr16A_RedNakedKoopa
CODE_07E411:
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	TAY
	LDA.w DATA_07E3DB,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7AF6,x
	LDA.w #$010A
	STA.w $7A36,x
	LDA.w $7860,x
	STA.w $7A38,x
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	LDA.w #$000C
	STA.w $7402,x
	LDA.w #$0020
	STA.w $7540,x
	LDA.w $6FA0,x
	AND.w #$FDFF
	STA.w $6FA0,x
	LDA.w $6FA2,x
	AND.w #$FCFF
	STA.w $6FA2,x
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.b $00
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_07E482
	LDA.w #$0020
	STA.w $7A98,y
	LDA.w $7400,x
	STA.w $7400,y
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
CODE_07E482:
	RTL

;---------------------------------------------------------------------------

DATA_07E483:
	dw $FF80,$0080

YI_NorSpr16D_GreenParakoopa_Init:
init_parakoopa_green:                      ; Raidenthequick: init_parakoopa_green
;$07E487
	LDA.w #$002A
	STA.w $7A36,x
	LDA.w #$0010
	STA.w $7542,x
	LDA.w #$0100
	STA.w $75E2,x
CODE_07E499:
	LDY.w $7400,x
	LDA.w DATA_07E483,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0008
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7A96,x
	LDA.w #$0000
	STA.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

DATA_07E4BD:
	dw $0030,$FFD0

DATA_07E4C1:
	dw $0004,$FFFC

DATA_07E4C5:
	dw $FEE0,$0120

DATA_07E4C9:
	dw $FED0,$0130

DATA_07E4CD:
	dw $F800,$0800

YI_NorSpr16E_RedHorizontalParakoopa_Init:
init_parakoopa_red_horizontal:             ; Raidenthequick: init_parakoopa_red_horizontal
;$07E4D1
	LDA.w #$002A
	STA.w $7A36,x
	LDA.w $70E2,x
	STA.b $18,x
	AND.w #$0010
	LSR
	LSR
	LSR
	EOR.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_07E4C5,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w DATA_07E4CD,y
	STA.w $75E0,x
	STA.w $75E2,x
	LDA.w #$0004
	STA.w $7540,x
	LDA.w #$0008
	STA.w $7542,x
	LDA.w $7182,x
	STA.b $76,x
	CLC
	ADC.w DATA_07E4C1,y
	STA.w $7182,x
	LDA.w #$0008
	STA.w $7402,x
	LDA.w #$0003
	STA.w $7A96,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr16F_RedVerticalParakoopa_Init:
init_parakoopa_red_vertical:               ; Raidenthequick: init_parakoopa_red_vertical
;$07E520
	LDA.w #$002A
	STA.w $7A36,x
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	EOR.w #$0002
	TAY
	LDA.w $7182,x
	STA.b $18,x
	LDA.w DATA_07E4C9,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w DATA_07E4CD,y
	STA.w $75E2,x
	LDA.w #$0004
	STA.w $7542,x
	LDA.w #$0008
	STA.w $7402,x
	LDA.w DATA_07E593,y
	STA.w $7A96,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr16D_GreenParakoopa_Main:
main_parakoopa_green:                      ; Raidenthequick: main_parakoopa_green
;$07E55A
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_07E56A
	STZ.b $00
	JSR.w CODE_07FD34
	JMP.w CODE_07E234

CODE_07E56A:
	LDX.b #FXCODE_08949D>>16
	LDA.w #FXCODE_08949D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	JSL.l CODE_03AF23
	JSL.l CODE_07E35B
	JSL.l CODE_03A5B7
	JSL.l CODE_07E6B7
	JSR.w CODE_07E6E9
	LDA.b $16,x
	TAX
	JSR.w (DATA_parakoopa_green_state_ptr,x)
	RTL

DATA_07E58F:
DATA_parakoopa_green_state_ptr:                 ; 2-entry Green Parakoopa state ptr: hop / stomped
	dw CODE_07E597
	dw CODE_07E5CD

DATA_07E593:
	dw $0002,$0004

CODE_07E597:
	LDX.b $12
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_07E5B8
	LDA.w $7A96,x
	BNE.b CODE_07E5B7
	DEC.w $7402,x
	BPL.b CODE_07E5B1
	LDA.w #$0008
	STA.w $7402,x
CODE_07E5B1:
	LDA.w #$0002
	STA.w $7A96,x
CODE_07E5B7:
	RTS

CODE_07E5B8:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0008
	STA.w $7A96,x
	LDA.w #$0009
	STA.w $7402,x
	LDA.w #$0002
	STA.b $16,x
	RTS

CODE_07E5CD:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07E5D8
	JSL.l CODE_07E499
CODE_07E5D8:
	RTS

YI_NorSpr16E_RedHorizontalParakoopa_Main:
main_parakoopa_red_horizontal:             ; Raidenthequick: main_parakoopa_red_horizontal
;$07E5D9
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_07E5E9
	STZ.b $00
	JSR.w CODE_07FD34
	JMP.w CODE_07E234

CODE_07E5E9:
	LDX.b #FXCODE_08949D>>16
	LDA.w #FXCODE_08949D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	JSL.l CODE_03AF23
	JSL.l CODE_07E35B
	JSL.l CODE_03A5B7
	JSL.l CODE_07E6B7
	LDY.b #$00
	LDA.w $70E2,x
	CMP.b $18,x
	BPL.b CODE_07E60F
	INY
	INY
CODE_07E60F:
	LDA.w DATA_07E4CD,y
	STA.w $75E0,x
	LDA.w $7400,x
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_07E627
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_07E627:
	LDY.b #$00
	LDA.w $7182,x
	CMP.b $76,x
	BPL.b CODE_07E632
	INY
	INY
CODE_07E632:
	LDA.w DATA_07E4CD,y
	STA.w $75E2,x
	LDA.w $7A96,x
	BNE.b CODE_07E64E
	DEC.w $7402,x
	BPL.b CODE_07E648
	LDA.w #$0008
	STA.w $7402,x
CODE_07E648:
	LDA.w #$0003
	STA.w $7A96,x
CODE_07E64E:
	RTL

YI_NorSpr16F_RedVerticalParakoopa_Main:
main_parakoopa_red_vertical:               ; Raidenthequick: main_parakoopa_red_vertical
;$07E64F
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_07E65F
	STZ.b $00
	JSR.w CODE_07FD34
	JMP.w CODE_07E234

CODE_07E65F:
	LDX.b #FXCODE_08949D>>16
	LDA.w #FXCODE_08949D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	JSL.l CODE_03AF23
	JSL.l CODE_07E35B
	JSL.l CODE_03A5B7
	JSL.l CODE_07E6B7
	LDY.b #$00
	LDA.w $7182,x
	CMP.b $18,x
	BPL.b CODE_07E685
	INY
	INY
CODE_07E685:
	LDA.w DATA_07E4CD,y
	STA.w $75E2,x
	LDA.w $7A96,x
	BNE.b CODE_07E6B6
	DEC.w $7402,x
	BPL.b CODE_07E69B
	LDA.w #$0008
	STA.w $7402,x
CODE_07E69B:
	LDY.b #$00
	LDA.w #$0100
	BIT.w $75E2,x
	BPL.b CODE_07E6A8
	LDA.w #$FF00
CODE_07E6A8:
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_07E6B0
	INY
	INY
CODE_07E6B0:
	LDA.w DATA_07E593,y
	STA.w $7A96,x
CODE_07E6B6:
	RTL

CODE_07E6B7:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_07E6E8
	BEQ.b CODE_07E6E8
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07E6E8
	LDA.w $7D38,y
	BEQ.b CODE_07E6E8
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr167_GreenKoopaShell
	BCC.b CODE_07E6D9
	CMP.w #!Define_YI_NorSpr169_GreenNakedKoopa
	BCC.b CODE_07E6E8
CODE_07E6D9:
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	PLY
	PLA
CODE_07E6E8:
	RTL

CODE_07E6E9:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_07E72F
	BEQ.b CODE_07E72F
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07E72F
	LDA.w $7D38,y
	BNE.b CODE_07E72F
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr169_GreenNakedKoopa
	BCC.b CODE_07E72F
	CMP.w #!Define_YI_NorSpr16E_RedHorizontalParakoopa
	BCS.b CODE_07E72F
	LDA.w $7400,x
	DEC
	STA.b $00
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	EOR.b $00
	BPL.b CODE_07E72F
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_07E72F:
	RTS

YI_NorSpr16D_GreenParakoopa_StompRt:
head_bop_parakoopa_green:                  ; Raidenthequick: head_bop_parakoopa_green
;$07E730
	LDA.w $7AF8,x
	BNE.b CODE_07E740
	STZ.b $00
	JSR.w CODE_07FD34
	LDA.w #$FFFF
	STA.w $7AF8,x
CODE_07E740:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_07E748
	JMP.w CODE_07E399

CODE_07E748:
	LDA.w #!Define_YI_NorSpr16B_GreenKoopa
	BRA.b CODE_07E768

YI_NorSpr16E_RedHorizontalParakoopa_StompRt:
YI_NorSpr16F_RedVerticalParakoopa_StompRt:
head_bop_parakoopa_red:                    ; Raidenthequick: head_bop_parakoopa_red
;$07E74D
	LDA.w $7AF8,x
	BNE.b CODE_07E75D
	STZ.b $00
	JSR.w CODE_07FD34
	LDA.w #$FFFF
	STA.w $7AF8,x
CODE_07E75D:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_07E765
	JMP.w CODE_07E399

CODE_07E765:
	LDA.w #!Define_YI_NorSpr16C_RedKoopa
CODE_07E768:
	PHA
	LDX.b #FXCODE_08949D>>16
	LDA.w #FXCODE_08949D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLA
	LDX.b $12
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$000A
	STA.w $7A36,x
	LDA.w $7860,x
	STA.w $7A38,x
	RTL

;---------------------------------------------------------------------------

DATA_07E78D:
	dw $0018,$0018,$0018,$0018,$0010,$0008,$0004,$0003
	dw $0000,$0000,$0000,$0000,$0000,$0001,$0000,$0004
	dw $0008,$000C

DATA_07E7B1:
	dw $FF80,$0080

YI_NorSpr170_AquaLakitu_Init:
init_lakitu_aqua:                          ; Raidenthequick: init_lakitu_aqua
;$07E7B5
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_07E7CD
	LDA.w $70E2,x
	AND.w #$0010
	BEQ.b CODE_07E7C4
	INY
	INY
CODE_07E7C4:
	SEP.b #$20
	TYA
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	REP.b #$20
CODE_07E7CD:
	LDA.w #$0004
	STA.b $16,x
	JSR.w CODE_07E842
	RTL

;---------------------------------------------------------------------------

YI_NorSpr170_AquaLakitu_Main:
main_lakitu_aqua:                          ; Raidenthequick: main_lakitu_aqua
;$07E7D6
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$000C
	BEQ.b CODE_07E7E3
	CMP.w #$0008
	BNE.b CODE_07E7E9
CODE_07E7E3:
	LDA.w #$0012
	STA.w $7402,x
CODE_07E7E9:
	LDY.w $74A2,x
	BMI.b CODE_07E813
	LDA.w $7402,x
	CMP.w #$000B
	BNE.b CODE_07E813
	LDA.b $14
	AND.w #$0006
	TAY
	LDA.w DATA_07A9BE,y
	STA.b $00
	REP.b #$10
	LDY.w $7362,x
	LDA.w $6014,y
	AND.w #$F1FF
	ORA.b $00
	STA.w $6014,y
	SEP.b #$10
CODE_07E813:
	JSL.l CODE_03AF23
	JSR.w CODE_07EADE
	LDY.b $16,x
	TYX
	JSR.w (DATA_lakitu_aqua_state_ptr,x)
	JSL.l CODE_03A5B7
	RTL

DATA_07E825:
DATA_lakitu_aqua_state_ptr:                     ; 3-entry Aqua Lakitu state ptr (cruise / throw / pause)
	dw CODE_07E873
	dw CODE_07E915
	dw CODE_07E82B

CODE_07E82B:
	LDX.b $12
	LDA.w $7680,x
	CMP.w #$00F0
	BCS.b CODE_07E872
	LDA.w $7682,x
	CMP.w #$00D0
	BCS.b CODE_07E872
	LDA.w #$0002
	STA.b $16,x
CODE_07E842:
	LDA.w $6FA0,x
	AND.w #$7F9F
	STA.w $6FA0,x
	LDA.w $7040,x
	ORA.w #$0100
	STA.w $7040,x
	LDA.w #$000C
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07E8AE,y
	STA.w $7A96,x
	LDA.w DATA_07E896,y
	STA.w $7402,x
	ASL
	TAY
	REP.b #$20
	LDA.w DATA_07E78D,y
	STA.w $7B58,x
CODE_07E872:
	RTS

CODE_07E873:
	LDX.b $12
	JSR.w CODE_07EA77
	LDA.w $7A96,x
	BNE.b CODE_07E895
	LDA.w #$0008
	STA.w $7A96,x
	LDA.w $7402,x
	INC
	AND.w #$0001
	STA.w $7402,x
	ASL
	TAY
	LDA.w DATA_07E78D,y
	STA.w $7B58,x
CODE_07E895:
	RTS

DATA_07E896:
	db $01,$02,$03,$11,$10,$0F,$0D,$0E,$0D,$0C,$0B,$09,$08,$09,$0A,$09
	db $08,$07,$06,$05,$04,$03,$02,$01

DATA_07E8AE:
	db $04,$04,$38,$02,$02,$02,$02,$04,$02,$20,$40,$20,$04,$02,$02,$02
	db $02,$02,$02,$02,$02,$20,$02,$02

DATA_07E8C6:
	dw $FE00,$0200,$FE00,$0200

DATA_07E8CE:
	dw $0000,$0000,$FF80,$FF80

DATA_07E8D6:
	dw $FFC0,$0040,$FFD0,$0030

DATA_07E8DE:
	dw $0010,$0010,$001C,$001C

CODE_07E8E6:
	LDA.w #$0008
	STA.w $7A96,x
	LDA.w #$0000
	STA.w $7402,x
	ASL
	TAY
	LDA.w DATA_07E78D,y
	STA.w $7B58,x
	LDA.w #$0080
	STA.w $7A98,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEY
	BNE.b CODE_07E90F
	LDY.w $7400,x
	LDA.w DATA_07E7B1,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_07E90F:
	LDA.w #$0000
	STA.b $16,x
	RTS

CODE_07E915:
	LDX.b $12
	LDA.w $7680,x
	ORA.w $7682,x
	AND.w #$FF00
	BNE.b CODE_07E8E6
	LDA.w $7A96,x
	BEQ.b CODE_07E92A
	JMP.w CODE_07E9AA

CODE_07E92A:
	DEC.b $18,x
	BMI.b CODE_07E8E6
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_07E8AE,y
	STA.w $7A96,x
	LDA.w DATA_07E896,y
	STA.w $7402,x
	ASL
	TAY
	REP.b #$20
	LDA.w DATA_07E78D,y
	STA.w $7B58,x
	LDA.b $18,x
	CMP.w #$0013
	BNE.b CODE_07E97A
	LDA.w #!Define_YI_AmbSpr201
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7142,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #!Define_YI_SoundID03_Swim
	JSL.l CODE_push_sound_queue
	RTS

CODE_07E97A:
	CMP.w #$0002
	BNE.b CODE_07E9E3
	LDA.w #!Define_YI_AmbSpr1BA
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w $7142,y
	LDA.w #$001A
	STA.w $7E4C,y
	LDA.w #$0003
	STA.w $7782,y
	LDA.w #!Define_YI_SoundID03_Swim
	JSL.l CODE_push_sound_queue
	RTS

CODE_07E9AA:
	LDA.b $18,x
CODE_07E9AC:
	CMP.w #$000A
	BNE.b CODE_07E9E2
CODE_07E9B1:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEY
	TYA
	ASL
	ORA.w $7400,x
	TAY
	LDA.w $70E2,x
	CLC
	ADC.w DATA_07E8D6,y
	STA.b $00
	LDA.w $7182,x
	SEC
	SBC.w DATA_07E8DE,y
	STA.b $02
	LDA.w $7A38,x
	STA.b $04
	JSL.l CODE_07FCB8
	LDA.w $7A38,x
	INC
	CMP.w #$0020
	BCS.b CODE_07E9E2
	STA.w $7A38,x
CODE_07E9E2:
	RTS

CODE_07E9E3:
	CMP.w #$0012
	BNE.b CODE_07E9FB
	LDA.w $6FA0,x
	AND.w #$7F9F
	STA.w $6FA0,x
	LDA.w $7040,x
	ORA.w #$0100
	STA.w $7040,x
	RTS

CODE_07E9FB:
	CMP.w #$0004
	BNE.b CODE_07EA13
	LDA.w $6FA0,x
	ORA.w #$C060
	STA.w $6FA0,x
	LDA.w $7040,x
	AND.w #$FEFF
	STA.w $7040,x
	RTS

CODE_07EA13:
	CMP.w #$000A
	BNE.b CODE_07EA1D
	STZ.w $7A38,x
	BRA.b CODE_07E9B1

CODE_07EA1D:
	CMP.w #$0009
	BNE.b CODE_07E9AC
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEY
	TYA
	ASL
	ORA.w $7400,x
	TAY
	PHY
	LDA.w $70E2,x
	CLC
	ADC.w DATA_07E8D6,y
	STA.b $00
	LDA.w $7182,x
	SEC
	SBC.w DATA_07E8DE,y
	STA.b $02
	LDA.w $7A38,x
	STA.b $04
	JSL.l CODE_07FCB3
	PLY
	LDA.w DATA_07E8C6,y
	STA.b $00
	LDA.w DATA_07E8CE,y
	STA.b $02
	LDA.w #$0099
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_07E9E2
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $02
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	RTS

CODE_07EA77:
	LDA.w $7A98,x
	BNE.b CODE_07EAD9
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCC.b CODE_07EAD9
	SEC
	SBC.w #$0020
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCS.b CODE_07EAD9
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_07EAD9
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0017
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_07E8AE,y
	STA.w $7A96,x
	LDA.w DATA_07E896,y
	STA.w $7402,x
	ASL
	TAY
	REP.b #$20
	LDA.w DATA_07E78D,y
	STA.w $7B58,x
	LDA.w #$0002
	STA.b $16,x
	PLA
CODE_07EAD9:
	RTS

DATA_07EADA:
	dw $0000,$0010

CODE_07EADE:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEY
	BNE.b CODE_07EB44
	LDY.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_07EADA,y
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
	CMP.w #$77C2
	BCC.b CODE_07EB1D
	CMP.w #$77C6
	BCC.b CODE_07EB44
	CMP.w #$77D0
	BCC.b CODE_07EB1D
	CMP.w #$77D6
	BCC.b CODE_07EB44
CODE_07EB1D:
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w $7CD6,x
	SEC
	SBC.w $72C0,x
	STA.w $7CD6,x
CODE_07EB44:
	RTS

YI_NorSpr170_AquaLakitu_StompRt:
head_bop_lakitu_aqua:                      ; Raidenthequick: head_bop_lakitu_aqua
;$07EB45
	LDA.w #$0012
	STA.w $7402,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr166_ThunderLakitu_Init:
init_lakitu_thunder:                       ; Raidenthequick: init_lakitu_thunder
;$07EB4C
	LDA.w #$0001
	STA.w !RAM_YI_Level_NorSpr_FireLakituActiveFlagLo
	LDA.w !RAM_YI_Global_MainScreenLayers
	STA.b $76,x
	LDA.w #$0010
	STA.w $7540,x
	STA.w $7542,x
	LDA.w #$0200
	STA.w $75E2,x
	STA.w $75E0,x
	LDA.w $70E2,x
	AND.w #$0010
	BEQ.b CODE_07EBAD
	LDY.w $0073
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w DATA_07F0C3,y
	STA.b $00
	LDA.w #$0166
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_07EBAD
	LDA.w !RAM_YI_Global_MainScreenLayers
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.b $00
	STA.w $70E2,y
	LDA.w !RAM_YI_Global_Layer1YPosLo
	SEC
	SBC.w #$0030
	STA.w $7182,y
	LDA.w #$0010
	STA.w $7540,y
	STA.w $7542,y
	LDA.w #$0200
	STA.w $75E2,y
	STA.w $75E0,y
CODE_07EBAD:
	RTL

;---------------------------------------------------------------------------

YI_NorSpr166_ThunderLakitu_Main:
main_lakitu_thunder:                       ; Raidenthequick: main_lakitu_thunder
;$07EBAE
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_07EBBB
	JSR.w CODE_07EF4A
	BRA.b CODE_07EC14

CODE_07EBBB:
	PHA
	JSR.w CODE_07EFD2
	PLA
	CMP.w #$0008
	BNE.b CODE_07EC14
	LDA.w #$011C
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_07EC06
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7182,y
	LDA.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	TYA
	AND.w #$00FF
	INC
	STA.w $6162
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	TXA
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	JSL.l CODE_07F06B
	BRA.b CODE_07EC0F

CODE_07EC06:
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.w $6162
CODE_07EC0F:
	STZ.w $6168
	PLA
	PLY
CODE_07EC14:
	JSL.l CODE_03AF23
	JSL.l CODE_07EF98
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	LDA.b $16,x
	TAX
	JSR.w (DATA_lakitu_thunder_state_ptr,x)
	JSR.w CODE_07EFE9
	LDA.w !RAM_YI_Level_NorSpr_FireLakituActiveFlagLo
	BNE.b CODE_07EC4E
	LDA.w #$F800
	STA.w $75E2,x
	STA.w $75E0,x
	LDA.w #$0040
	STA.w $7542,x
	STA.w $7540,x
	LDA.w $7040,x
	ORA.w #$0004
	STA.w $7040,x
CODE_07EC4E:
	LDA.b $14
	AND.w #$0007
	BNE.b CODE_07EC86
	LDA.w #!Define_YI_AmbSpr1F8
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0002
	STA.w $73C2,y
	LDA.w #$0008
	STA.w $7782,y
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70A2,y
	LDA.b $10
	AND.w #$0007
	CLC
	ADC.w $7182,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $72C2,x
	STA.w $7142,y
CODE_07EC86:
	JSL.l CODE_03A5B7
	RTL

DATA_07EC8B:
DATA_lakitu_thunder_state_ptr:                  ; 4-entry Thunder Lakitu state ptr (cruise / charge / strike / recover)
	dw CODE_07ECA7
	dw CODE_07ED63
	dw CODE_07EE47
	dw CODE_07EEFF

DATA_07EC93:
	dw $0030,$FFD0

DATA_07EC97:
	dw $0008,$0010

DATA_07EC9B:
	dw $0200,$FE00

DATA_07EC9F:
	dw $0008,$0010

DATA_07ECA3:
	dw $0200,$FE00

CODE_07ECA7:
	LDX.b $12
	JSR.w CODE_07ECC4
	LDA.w $7A98,x
	BNE.b CODE_07ECC3
	JSR.w CODE_07F027
	BCS.b CODE_07ECC3
	LDA.w #$0001
	STA.w $7402,x
	STA.b $18,x
	LDA.w #$0002
	STA.b $16,x
CODE_07ECC3:
	RTS

CODE_07ECC4:
	LDY.b #$00
	DEC
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_07ECCE
	INY
	INY
CODE_07ECCE:
	LDA.w DATA_07EC97,y
	STA.w $7540,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	AND.w #$8000
	ASL
	ROL
	ASL
	TAY
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_07EC93,y
	LDY.b #$00
	CMP.w $70E2,x
	BPL.b CODE_07ECEE
	INY
	INY
CODE_07ECEE:
	LDA.w DATA_07EC9B,y
	STA.w $75E0,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_07ECFD
	EOR.w #$FFFF
	INC
CODE_07ECFD:
	CMP.w #$0100
	BCC.b CODE_07ED14
	LDY.b #$00
	LDA.w $7682,x
	CMP.w #$0030
	BMI.b CODE_07ED0E
	INY
	INY
CODE_07ED0E:
	LDA.w DATA_07ECA3,y
	STA.w $75E2,x
CODE_07ED14:
	LDY.b #$00
	LDA.w $7682,x
	SEC
	SBC.w #$0030
	EOR.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_07ED24
	INY
	INY
CODE_07ED24:
	LDA.w DATA_07EC9F,y
	STA.w $7542,x
	LDA.w $7682,x
	CLC
	ADC.w #$0080
	CMP.w #$0200
	BCC.b CODE_07ED4A
	LDA.w $75E2,x
	CLC
	ADC.w #$0800
	CMP.w #$1000
	BCS.b CODE_07ED4A
	LDA.w $75E2,x
	ASL
	ASL
	STA.w $75E2,x
CODE_07ED4A:
	RTS

DATA_07ED4B:
	dw $0004,$000C

DATA_07ED4F:
	dw $FFFE,$0002

DATA_07ED53:
	dw $0006,$000C

DATA_07ED57:
	dw $000F,$000F,$000F,$000F,$000F,$000F

CODE_07ED63:
	LDX.b $12
	JSR.w CODE_07ECC4
	JSR.w CODE_07F027
	BCC.b CODE_07ED70
	JMP.w CODE_07EF06

CODE_07ED70:
	LDA.b $18,x
	PHA
	AND.w #$0004
	LSR
	TAY
	LDA.w DATA_07ED4B,y
	STA.b $00
	PLA
	LSR
	LSR
	LSR
	CMP.w #$0005
	BCC.b CODE_07ED89
	LDA.w #$0005
CODE_07ED89:
	STA.b $02
	ASL
	TAY
	LDA.b $18,x
	AND.w DATA_07ED57,y
	BNE.b CODE_07ED9B
	LDA.w #!Define_YI_SoundID51_ThunderLakituAttacking1
	JSL.l CODE_push_sound_queue
CODE_07ED9B:
	LDY.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_07ED4F,y
	STA.b $04
	LDA.w #!Define_YI_AmbSpr20D
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $02
	STA.w $73C2,y
	LDA.w #$0001
	STA.w $7782,y
	LDA.b $04
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0018
	STA.w $7142,y
	LDA.w $7002,y
	AND.w #$FFF1
	ORA.b $00
	STA.w $7002,y
	LDY.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_07ED53,y
	STA.b $00
	LDA.w #!Define_YI_AmbSpr20E
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $18,x
	LSR
	AND.w #$0007
	STA.w $73C2,y
	LDA.w #$0001
	STA.w $7782,y
	LDA.b $00
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0020
	STA.w $7142,y
	LDA.b $18,x
	INC
	CMP.w #$0040
	BCS.b CODE_07EE0F
	STA.b $18,x
	RTS

CODE_07EE0F:
	LDA.w !RAM_YI_Global_MainScreenLayers
	STA.b $76,x
	ORA.w !RAM_YI_Global_SubScreenLayers
	AND.w #$000F
	XBA
	ORA.w #$0010
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.w #$0002
	STA.w $7402,x
	LDA.w #$0018
	STA.w $7A96,x
	LDA.w #$0004
	STA.b $16,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTS

DATA_07EE3F:
	dw $0000,$7C00,$03E0,$001F

CODE_07EE47:
	LDX.b $12
	JSR.w CODE_07F027
	BCC.b CODE_07EE54
	JSR.w CODE_07EFD2
	JMP.w CODE_07EF06

CODE_07EE54:
	LDA.b $14
	AND.w #$0007
	BNE.b CODE_07EE62
	LDA.w #!Define_YI_SoundID51_ThunderLakituAttacking1
	JSL.l CODE_push_sound_queue
CODE_07EE62:
	LDA.w $7402,x
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_07ED4B,y
	STA.b $00
	LDA.w #!Define_YI_AmbSpr20D
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0001
	STA.w $7782,y
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0018
	STA.w $7142,y
	LDA.w $7002,y
	AND.w #$FFF1
	ORA.b $00
	STA.w $7002,y
	LDA.w $7A96,x
	BEQ.b CODE_07EEBF
	AND.w #$0003
	BNE.b CODE_07EEBE
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
	LDA.b $14
	AND.w #$000C
	LSR
	TAY
	LDA.w DATA_07EE3F,y
	STA.l YI_Global_PaletteMirror[$00].LowByte
CODE_07EEBE:
	RTS

CODE_07EEBF:
	JSR.w CODE_07EFD2
	LDA.w #$0030
	STA.w $7A96,x
	LDA.w #$0004
	STA.w $7402,x
	LDA.w #$0006
	STA.b $16,x
	LDA.w #$00A2
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_07EEFA
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$0005
	STA.w $7402,y
	LDA.w #$0200
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $60A8
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
CODE_07EEFA:
	RTS

DATA_07EEFB:
	dw $FE00,$0200

CODE_07EEFF:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07EF3F
CODE_07EF06:
	LDA.b $10
	AND.w #$007F
	CLC
	ADC.w #$0080
	STA.w $7A98,x
	LDA.w #$0010
	STA.w $7540,x
	STA.w $7542,x
	LDA.b $10
	AND.w #$0001
	ASL
	TAY
	LDA.w DATA_07EEFB,y
	STA.w $75E0,x
	LDA.b $10
	AND.w #$0002
	TAY
	LDA.w DATA_07EEFB,y
	STA.w $75E2,x
	LDA.w #$0000
	STA.w $7402,x
	LDA.w #$0000
	STA.b $16,x
CODE_07EF3F:
	RTS

DATA_07EF40:
	dw $000A,$000A,$000A,$0022,$000A

CODE_07EF4A:
	LDY.w $74A2,x
	BMI.b CODE_07EF97
	LDA.b $14
	AND.w #$0008
	BEQ.b CODE_07EF97
	LDA.w $7402,x
	CMP.w #$0005
	BCS.b CODE_07EF97
	ASL
	TAY
	LDA.w $7180,x
	AND.w #$00FF
	ASL
	ASL
	ASL
	CLC
	ADC.w DATA_07EF40,y
	STA.b $00
	REP.b #$10
	LDA.w $7362,x
	CLC
	ADC.w #$0008
	TAY
	LDA.w $6004,y
	AND.w #$FE00
	ORA.b $00
	STA.w $6004,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	LDA.w $6004,y
	AND.w #$FE00
	ORA.b $00
	STA.w $6004,y
	SEP.b #$10
CODE_07EF97:
	RTS

CODE_07EF98:
	LDY.w $7D36,x
	DEY
	BEQ.b CODE_07EFD1
	BMI.b CODE_07EFD1
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07EFD1
	LDA.w $7D38,y
	BEQ.b CODE_07EFD1
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	LDA.w $7CD6,x
	STA.b $00
	LDA.w $7CD8,x
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1E6
	JSL.l CODE_spawn_ambient_stomp_puff_common
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	JSL.l CODE_07F06B
	PLY
	PLA
CODE_07EFD1:
	RTL

CODE_07EFD2:
	LDA.w !RAM_YI_Global_ColorMathSelectAndEnable
	AND.w #$FF7F
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.l $702D6C
	STA.l YI_Global_PaletteMirror[$00].LowByte
	LDA.b $76,x
	STA.w !RAM_YI_Global_MainScreenLayers
	RTS

CODE_07EFE9:
	LDA.w $7A38,x
	BNE.b CODE_07F009
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w #$0010
	CMP.w $70E2,x
	BPL.b CODE_07F026
	CLC
	ADC.w #$00D0
	CMP.w $70E2,x
	BMI.b CODE_07F026
	LDA.w #$0001
	STA.w $7A38,x
CODE_07F009:
	LDA.w !RAM_YI_Level_NorSpr_FireLakituActiveFlagLo
	BEQ.b CODE_07F026
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w #$0010
	CMP.w $70E2,x
	BPL.b CODE_07F023
	CLC
	ADC.w #$00D0
	CMP.w $70E2,x
	BPL.b CODE_07F026
CODE_07F023:
	STA.w $70E2,x
CODE_07F026:
	RTS

CODE_07F027:
	LDA.w $7680,x
	CLC
	ADC.w #$0030
	CMP.w #$0150
	BCS.b CODE_07F03D
	LDA.w $7682,x
	CLC
	ADC.w #$0030
	CMP.w #$0150
CODE_07F03D:
	RTS

YI_NorSpr166_ThunderLakitu_StompRt:
head_bop_lakitu_thunder:                   ; Raidenthequick: head_bop_lakitu_thunder
;$07F03E
	LDA.w $7A36,x
	TAX
	JMP.w (DATA_lakitu_thunder_stomp_state_ptr,x)

DATA_07F045:
DATA_lakitu_thunder_stomp_state_ptr:            ; 3-entry Thunder Lakitu head-bop state ptr (spawn drop / fall / despawn)
	dw CODE_07F04B
	dw CODE_07F08D
	dw CODE_07F0C7

CODE_07F04B:
	LDX.b $12
	LDA.w #$011C
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_07F06B
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7182,y
	TXA
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
CODE_07F06B:
	JSR.w CODE_07EFD2
	LDA.w #$0005
	STA.w $7402,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.w $7A36,x
	INC.w $7A36,x
	RTL

CODE_07F08D:
	LDX.b $12
	LDA.w $7680,x
	CLC
	ADC.w #$0050
	CMP.w #$0190
	BCS.b CODE_07F0A7
	LDA.w $7682,x
	CLC
	ADC.w #$0050
	CMP.w #$0190
	BCC.b CODE_07F0C2
CODE_07F0A7:
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FFFF
	STA.w $74A2,x
	LDA.w #$0280
	STA.w $7A96,x
	INC.w $7A36,x
	INC.w $7A36,x
CODE_07F0C2:
	RTL

DATA_07F0C3:
	dw $FFD0,$0110

CODE_07F0C7:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_07F10B
	LDY.w $0073
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w DATA_07F0C3,y
	STA.w $70E2,x
	LDA.w !RAM_YI_Global_Layer1YPosLo
	SEC
	SBC.w #$0030
	STA.w $7182,x
	LDA.w #$0010
	STA.w $7540,x
	STA.w $7542,x
	LDA.w #$0200
	STA.w $75E2,x
	STA.w $75E0,x
	LDA.w #$0005
	STA.w $74A2,x
	STZ.b $16,x
	STZ.w $7402,x
	STZ.w $7A36,x
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
CODE_07F10B:
	RTL

;---------------------------------------------------------------------------

DATA_07F10C:
	db $00,$02,$04,$08

DATA_07F110:
	dw $FFC0,$0040

DATA_07F114:
	dw $FF80,$0080

;-------------------------------------------------------------------------
; Baron Von Zeppelin payload Init handlers ($173..$17E + $0CD).
; See docs/family-bvz.md for the full family breakdown (13 sprites,
; 4 Main bodies, payload-index dispatch tables, SuperFX glyph chunks).
;
; The Baron itself ($17F, see ~$07FB24) is a balloon enemy that drops a
; payload onto Yoshi. Each payload variant has its own NorSpr ID so the
; level data can pick which one a given Baron carries:
;   $173 ShyGuy   $174 Needlenose   $175 Bomb       $176 Bandit
;   $177 LargeSpringBall            $178 1up        $179 Key
;   $17A Coins    $17B Watermelon   $17C FireWatermelon
;   $17D IcyWatermelon              $17E CrateWith6Stars
;   $0CD GiantEgg
; Each variant Init falls through into the shared CODE_07F12B / _07F19E /
; _07F1AA path that stamps the payload type byte ($7A36,x) and clones
; spawn-side state. Visuals come from per-variant SuperFX glyph chunks.
; Raidenthequick: init_bvz_*.
;-------------------------------------------------------------------------
YI_NorSpr17A_BaronVonZeppelinCarryingCoins_Init:
init_bvz_coins:                            ; Raidenthequick: init_bvz_coins
;$07F118
	LDA.w #$000E
	BRA.b CODE_07F12B

YI_NorSpr179_BaronVonZeppelinCarryingKey_Init:
init_bvz_key:                              ; Raidenthequick: init_bvz_key
	JSR.w CODE_07F28B
	LDA.w #$000C
	BRA.b CODE_07F12B

YI_NorSpr178_BaronVonZeppelinCarrying1up_Init:
init_bvz_1up:                              ; Raidenthequick: init_bvz_1up
	JSR.w CODE_07F28B
	LDA.w #$000A
CODE_07F12B:
	STA.w $7A36,x
	LDA.w $7400,x
	STA.b $78,x
	TAY
	STZ.w $7400,x
	BRA.b CODE_07F1AA

YI_NorSpr177_BaronVonZeppelinCarryingLargeSpringBall_Init:
init_bvz_large_spring_ball:                ; Raidenthequick: init_bvz_large_spring_ball
	JSL.l CODE_03AE60
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #(FXDATA_550000+$40E0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_550000+$40E0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
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
	LDA.w #$0008
	BRA.b CODE_07F19E

YI_NorSpr17D_BaronVonZeppelinCarryingIcyWatermelon_Init:
init_bvz_watermelon_icy:                   ; Raidenthequick: init_bvz_watermelon_icy
	LDA.w #$0014
	BRA.b CODE_07F19E

YI_NorSpr17C_BaronVonZeppelinCarryingFireWatermelon_Init:
init_bvz_watermelon_fire:                  ; Raidenthequick: init_bvz_watermelon_fire
	LDA.w #$0012
	BRA.b CODE_07F19E

YI_NorSpr17B_BaronVonZeppelinCarryingWatermelon_Init:
init_bvz_watermelon:                       ; Raidenthequick: init_bvz_watermelon
	LDA.w #$0010
	BRA.b CODE_07F19E

YI_NorSpr176_BaronVonZeppelinCarryingBandit_Init:
init_bvz_bandit:                           ; Raidenthequick: init_bvz_bandit
	LDA.w #$0006
	BRA.b CODE_07F19E

YI_NorSpr175_BaronVonZeppelinCarryingBomb_Init:
init_bvz_bomb:                             ; Raidenthequick: init_bvz_bomb
	LDA.w #$0004
	BRA.b CODE_07F19E

YI_NorSpr174_BaronVonZeppelinCarryingNeedlenose_Init:
init_bvz_needlenose:                       ; Raidenthequick: init_bvz_needlenose
	LDA.w #$0002
	BRA.b CODE_07F19E

YI_NorSpr173_BaronVonZeppelinCarryingShyGuy_Init:
init_bvz_shyguy:                           ; Raidenthequick: init_bvz_shyguy
	LDA.w #$0000
CODE_07F19E:
	STA.w $7A36,x
	LDA.w #$FFFF
	STA.b $78,x
	LDA.w $7400,x
	TAY
CODE_07F1AA:
	LDA.w DATA_07F110,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b $10
	AND.b #$03
	TAY
	LDA.w DATA_07F10C,y
	STA.b $18,x
	REP.b #$20
	LDA.w #$0800
	STA.w $75E2,x
	LDA.w #$0004
	STA.w $7542,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr0CD_BaronVonZeppelinCarryingGiantEgg_Init:
init_bvz_giant_egg:                        ; Raidenthequick: init_bvz_giant_egg
;%07F1CB
	LDA.w #$0018
	STA.w $7A36,x
	LDA.w #$FFFF
	STA.b $78,x
	LDA.w $7400,x
	TAY
	LDA.w DATA_07F114,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b $10
	AND.b #$03
	TAY
	LDA.w DATA_07F10C,y
	STA.b $18,x
	REP.b #$20
	LDA.w #$0800
	STA.w $75E2,x
	LDA.w #$0004
	STA.w $7542,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr17E_BaronVonZeppelinCarryingCrateWith6Stars_Init:
init_bvz_crate_6_stars:                    ; Raidenthequick: init_bvz_crate_6_stars
	JSL.l CODE_03AE60
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #(FXDATA_550000+$2080)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_550000+$2080
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
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
	LDA.w #$0016
	STA.w $7A36,x
	LDA.w $7400,x
	STA.b $78,x
	TAY
	STZ.w $7400,x
	LDA.w DATA_07F110,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b $10
	AND.b #$03
	TAY
	LDA.w DATA_07F10C,y
	LSR
	STA.b $18,x
	LDA.b $10
	AND.b #$0C
	LSR
	LSR
	TAY
	LDA.w DATA_07F10C,y
	LSR
	STA.b $19,x
	LDA.b $10
	AND.b #$30
	LSR
	LSR
	LSR
	LSR
	TAY
	LDA.w DATA_07F10C,y
	LSR
	STA.b $76,x
	LDA.b #$03
	STA.b $77,x
	REP.b #$20
	LDA.w #$0800
	STA.w $75E2,x
	LDA.w #$0004
	STA.w $7542,x
	RTL

CODE_07F28B:
	JSL.l CODE_03D3F8
	BEQ.b CODE_07F296
	PLA
	JML.l CODE_03A31E

CODE_07F296:
	LDA.w $70E2,x
	ASL
	ASL
	ASL
	ASL
	AND.w #$FF00
	STA.b $00
	LDA.w $7182,x
	LSR
	LSR
	LSR
	LSR
	AND.w #$00FF
	ORA.b $00
	STA.w $7A38,x
	RTS

YI_NorSpr173_BaronVonZeppelinCarryingShyGuy_Main:
YI_NorSpr174_BaronVonZeppelinCarryingNeedlenose_Main:
YI_NorSpr175_BaronVonZeppelinCarryingBomb_Main:
YI_NorSpr176_BaronVonZeppelinCarryingBandit_Main:
main_bvz_simple:                           ; shared Main for 4 simple-payload Barons
;$07F2B2
	STZ.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_0895B9>>16
	LDA.w #FXCODE_0895B9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	JSR.w CODE_07F9C9
	JSL.l CODE_03AF23
	JSR.w CODE_07F412
	JSR.w CODE_07F746
	JSR.w CODE_07F3DB
	RTL

YI_NorSpr177_BaronVonZeppelinCarryingLargeSpringBall_Main:
main_bvz_large_spring_ball:                ; Raidenthequick: main_bvz_large_spring_ball
;$07F2D1
	JSL.l CODE_03AA52
	STZ.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_0895B9>>16
	LDA.w #FXCODE_0895B9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	JSL.l CODE_03AF23
	JSR.w CODE_07F538
	JSR.w CODE_07F497
	JSR.w CODE_07F3DB
	RTL

YI_NorSpr0CD_BaronVonZeppelinCarryingGiantEgg_Main:
YI_NorSpr17B_BaronVonZeppelinCarryingWatermelon_Main:
YI_NorSpr17C_BaronVonZeppelinCarryingFireWatermelon_Main:
main_bvz_drop_payload:                     ; shared Main for plain-drop payloads
;$07F2F1
	STZ.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_0895B9>>16
	LDA.w #FXCODE_0895B9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	JSR.w CODE_07F9C9
	JSL.l CODE_03AF23
	JSR.w CODE_07F538
	JSR.w CODE_07F497
	JSR.w CODE_07F3DB
	RTL

YI_NorSpr17D_BaronVonZeppelinCarryingIcyWatermelon_Main:
main_bvz_watermelon_icy:                   ; Raidenthequick: main_bvz_watermelon_icy
;$07F310
	STZ.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_0895B9>>16
	LDA.w #FXCODE_0895B9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	JSR.w CODE_07F9C9
	JSL.l CODE_03AF23
	JSR.w CODE_07F538
	JSR.w CODE_07F497
	JSR.w CODE_07F3DB
	JSL.l CODE_melon_icy_freeze_tick
	RTL

YI_NorSpr178_BaronVonZeppelinCarrying1up_Main:
YI_NorSpr179_BaronVonZeppelinCarryingKey_Main:
YI_NorSpr17A_BaronVonZeppelinCarryingCoins_Main:
main_bvz_swing_payload:                    ; shared Main for the swinging-grip payloads
;$07F333
	LDA.b $78,x
	LSR
	LSR
	ROR
	LSR
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_0895B9>>16
	LDA.w #FXCODE_0895B9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	JSR.w CODE_07F9C9
	JSL.l CODE_03AF23
	LDA.w $7400,x
	BEQ.b CODE_07F35A
	LDA.b $78,x
	EOR.w #$0002
	STA.b $78,x
CODE_07F35A:
	STZ.w $7400,x
	JSR.w CODE_07F538
	JSR.w CODE_07F497
	JSR.w CODE_07F3DB
	RTL

DATA_07F367:
	db $04,$F7,$04,$F3,$00,$E5,$0B,$F8,$0D,$F5,$0C,$E8,$FD,$F9,$FB,$F5
	db $F4

DATA_07F378:
	db $E8,$08,$F8,$09,$F4,$07,$E7,$00,$F8,$FF,$F4,$F9

DATA_07F384:
	db $E7,$04,$F8,$04,$F4,$00

DATA_07F38A:
	db $E6

DATA_07F38B:
	dw DATA_07F38A,DATA_07F384,DATA_07F378

YI_NorSpr17E_BaronVonZeppelinCarryingCrateWith6Stars_Main:
main_bvz_crate_6_stars:                    ; Raidenthequick: main_bvz_crate_6_stars
;$07F391
	JSL.l CODE_03AA52
	LDA.w #DATA_07F38B>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.b $77,x
	DEC
	ASL
	TAY
	LDA.w DATA_07F38B,y
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.b $78,x
	LSR
	LSR
	ROR
	LSR
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_0895F4>>16
	LDA.w #FXCODE_0895F4
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	JSL.l CODE_03AF23
	LDA.w $7400,x
	BEQ.b CODE_07F3CA
	LDA.b $78,x
	EOR.w #$0002
	STA.b $78,x
CODE_07F3CA:
	STZ.w $7400,x
	JSR.w CODE_07F6E7
	JSR.w CODE_07F582
	JSR.w CODE_07F3DB
	RTL

DATA_07F3D7:
	dw $F800,$0800

CODE_07F3DB:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCC.b CODE_07F3F7
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	AND.w #$8000
	ASL
	ROL
	ASL
	TAY
	LDA.w DATA_07F3D7,y
	STA.w $75E2,x
CODE_07F3F7:
	RTS

DATA_07F3F8:
	dw $FFE8,$FFE8,$FFE8,$FFE0,$FFE8,$FFE8,$FFE8,$FFE8
	dw $FFE8,$FFE8,$FFE8,$0000,$FFE0

CODE_07F412:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_07F497
	BEQ.b CODE_07F497
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07F497
	LDA.w $7D38,y
	BEQ.b CODE_07F497
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	LDY.w $7A36,x
	LDA.w DATA_07F3F8,y
	STA.b $00
	LDA.w #$017F
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_07F461
	LDA.b $18,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w $7400,x
	STA.w $7400,y
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.b $00
	STA.w $7182,y
	BRA.b CODE_07F487

CODE_07F461:
	LDA.w #!Define_YI_AmbSpr1EF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.b $00
	CLC
	ADC.w #$0008
	STA.w $7142,y
CODE_07F487:
	LDX.b $12
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	PLA
	JML.l CODE_039F91

CODE_07F497:
	LDA.w $6FA0,x
	AND.w #$0400
	BEQ.b CODE_07F4B3
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098F33>>16
	LDA.w #FXCODE_098F33
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BPL.b CODE_07F4B4
CODE_07F4B3:
	RTS

CODE_07F4B4:
	LDA.w $7BB6,y
	CLC
	ADC.w #$0006
	STA.b $00
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	BPL.b CODE_07F4CA
	EOR.w #$FFFF
	INC
CODE_07F4CA:
	CMP.b $00
	BCS.b CODE_07F4B3
	LDA.w $7BB8,y
	CLC
	ADC.w #$0006
	STA.b $00
	LDA.w $7A36,x
	TAX
	LDA.w DATA_07F3F8,x
	LDX.b $12
	CLC
	ADC.w $7182,x
	CLC
	ADC.w #$0008
	STA.b $04
	SEC
	SBC.w $7CD8,y
	BPL.b CODE_07F4F4
	EOR.w #$FFFF
	INC
CODE_07F4F4:
	CMP.b $00
	BCS.b CODE_07F4B3
	LDA.w $7542,y
	CMP.w #$0040
	BCC.b CODE_07F507
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
CODE_07F507:
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr1EF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.b $04
	STA.w $7142,y
	LDA.w $7A36,x
	TAX
	LDA.w DATA_bvz_payload_sprite_ids,x
	JSR.w (DATA_bvz_payload_drop_ptr,x)
	PLA
	RTL

CODE_07F538:
	LDY.w $7D36,x
	BPL.b CODE_07F57E
	LDY.w $7A36,x
	LDA.w $7182,x
	CLC
	ADC.w DATA_07F3F8,y
	CLC
	ADC.w #$0008
	STA.b $00
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr1EF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.b $00
	STA.w $7142,y
	LDY.w $7A36,x
	TYX
	LDA.w DATA_bvz_payload_sprite_ids,x
	JSR.w (DATA_bvz_payload_drop_ptr,x)
	PLA
	RTL

CODE_07F57E:
	RTS

DATA_07F57F:
	db $38,$50,$68

CODE_07F582:
	SEP.b #$20
	LDA.b $76,x
	BPL.b CODE_07F592
	LDA.b $19,x
	BPL.b CODE_07F59C
	LDA.b $18,x
	STA.b $76,x
	BRA.b CODE_07F5A4

CODE_07F592:
	LDA.b $19,x
	BPL.b CODE_07F5A8
	LDA.b $18,x
	STA.b $19,x
	BRA.b CODE_07F5A4

CODE_07F59C:
	LDA.b $19,x
	STA.b $76,x
	LDA.b $18,x
	STA.b $19,x
CODE_07F5A4:
	LDA.b #$FF
	STA.b $18,x
CODE_07F5A8:
	STZ.b $03
	LDA.b $77,x
	STA.b $02
	DEC
	ASL
	TAY
	REP.b #$20
	LDA.w DATA_07F38B,y
	STA.b $00
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098F33>>16
	LDA.w #FXCODE_098F33
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BPL.b CODE_07F5CD
	RTS

CODE_07F5CD:
	LDA.w $7BB6,y
	CLC
	ADC.w #$0003
	STA.b $0C
	LDA.w $7BB8,y
	CLC
	ADC.w #$0003
	STA.b $0E
CODE_07F5DF:
	LDA.b ($00)
	AND.w #$00FF
	BIT.w #$0080
	BEQ.b CODE_07F5EC
	ORA.w #$FF00
CODE_07F5EC:
	CLC
	ADC.w $7182,x
	CLC
	ADC.w #$0008
	STA.b $04
	DEC.b $00
	LDA.b ($00)
	AND.w #$00FF
	BIT.w #$0080
	BEQ.b CODE_07F605
	ORA.w #$FF00
CODE_07F605:
	CLC
	ADC.w $70E2,x
	CLC
	ADC.w #$0008
	STA.b $06
	SEC
	SBC.w $7CD6,y
	BPL.b CODE_07F619
	EOR.w #$FFFF
	INC
CODE_07F619:
	CMP.b $0C
	BCC.b CODE_07F620
CODE_07F61D:
	JMP.w CODE_07F6B3

CODE_07F620:
	LDA.b $04
	SEC
	SBC.w $7CD8,y
	BPL.b CODE_07F62C
	EOR.w #$FFFF
	INC
CODE_07F62C:
	CMP.b $0E
	BCS.b CODE_07F61D
	LDA.w $7542,y
	CMP.w #$0040
	BCC.b CODE_07F63F
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
CODE_07F63F:
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	LDA.w #!Define_YI_AmbSpr1EF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.b $06
	STA.w $70A2,y
	LDA.b $04
	STA.w $7142,y
	LDA.w #$00C0
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	DEC.b $77,x
	REP.b #$20
	BNE.b CODE_07F67F
	JSR.w CODE_07F8C9
	BRA.b CODE_07F6B1

CODE_07F67F:
	SEP.b #$20
	LDY.b $77,x
	DEY
	LDA.w $7041,x
	AND.b #$07
	ORA.w DATA_07F57F,y
	STA.w $7041,x
	LDA.b #$FF
	LDY.b $02
	CPY.b #$03
	BNE.b CODE_07F6A5
	STA.b $18,x
	LDA.b $19,x
	PHA
	LDA.b $76,x
	STA.b $19,x
	PLA
	STA.b $76,x
	BRA.b CODE_07F6AF

CODE_07F6A5:
	CPY.b #$02
	BNE.b CODE_07F6AD
	STA.b $19,x
	BRA.b CODE_07F6AF

CODE_07F6AD:
	STA.b $76,x
CODE_07F6AF:
	REP.b #$20
CODE_07F6B1:
	PLA
	RTL

CODE_07F6B3:
	LDA.b $00
	SEC
	SBC.w #$0005
	STA.b $00
	DEC.b $02
	BEQ.b CODE_07F6C2
	JMP.w CODE_07F5DF

CODE_07F6C2:
	RTS

DATA_07F6C3:
	dw $0008

DATA_07F6C5:
	dw $0001,$000F

DATA_07F6C9:
	dw $FFFC,$0014,$0008

DATA_07F6CF:
	dw $FFEE

DATA_07F6D1:
	dw $FFEF,$FFEF

DATA_07F6D5:
	dw $FFF0,$FFF0,$FFEC

DATA_07F6DB:
	dw DATA_07F6C3,DATA_07F6C5,DATA_07F6C9

DATA_07F6E1:
	dw DATA_07F6CF,DATA_07F6D1,DATA_07F6D5

CODE_07F6E7:
	LDY.w $7D36,x
	BPL.b CODE_07F745
	LDY.b $77,x
	DEY
	PHY
	TYA
	ASL
	TAY
	LDA.w DATA_07F6DB,y
	STA.b $0C
	LDA.w DATA_07F6E1,y
	STA.b $0E
	PLY
CODE_07F6FE:
	PHY
	ASL
	AND.w #$00FF
	STA.b $04
	TYA
	ASL
	TAY
	LDA.w $70E2,x
	CLC
	ADC.b ($0C),y
	STA.b $06
	LDA.w $7182,x
	CLC
	ADC.b ($0E),y
	STA.b $08
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr1EF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.b $06
	STA.w $70A2,y
	LDA.b $08
	STA.w $7142,y
	PLY
	DEY
	BPL.b CODE_07F6FE
	JSR.w CODE_07F8C9
	PLA
	RTL

CODE_07F745:
	RTS

CODE_07F746:
	LDA.w $7680,x
	CMP.w #$00F0
	BCS.b CODE_07F7A2
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w #$0004
	CMP.w #$0008
	BCS.b CODE_07F7A2
	LDA.w #!Define_YI_SoundID0E_ShellHit4
	JSL.l CODE_push_sound_queue
	LDY.w $7A36,x
	LDA.w DATA_07F3F8,y
	STA.b $00
	LDA.w #$017F
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_07F796
	LDA.b $18,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w $7400,x
	STA.w $7400,y
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.b $00
	STA.w $7182,y
CODE_07F796:
	LDA.w $7A36,x
	TAX
	LDA.w DATA_bvz_payload_sprite_ids,x
	JSR.w (DATA_bvz_payload_drop_ptr,x)
	PLA
	RTL

CODE_07F7A2:
	RTS

DATA_07F7A3:
DATA_bvz_payload_sprite_ids:                    ; 13 sprite IDs ordered by Baron Von Zeppelin payload index ($7A36,x)
	dw !Define_YI_NorSpr01E_Shyguy
	dw !Define_YI_NorSpr163_BouncingNeedlenose
	dw !Define_YI_NorSpr060_Bomb
	dw !Define_YI_NorSpr020_Bandit
	dw !Define_YI_NorSpr148_LargeSpringBall
	dw !Define_YI_NorSpr100_Bubbled1up
	dw !Define_YI_NorSpr027_Key
	dw !Define_YI_NorSpr115_Coin
	dw !Define_YI_NorSpr007_Watermelon
	dw !Define_YI_NorSpr009_FireWatermelon
	dw !Define_YI_NorSpr005_IcyWatermelon
	dw !Define_YI_NorSpr10E_CrateWith6Stars
	dw !Define_YI_NorSpr026_BowserFightGiantEgg

DATA_07F7BD:
DATA_bvz_payload_drop_ptr:                      ; 13-entry Baron Von Zeppelin payload-drop handler ptr (one per payload index)
	dw CODE_07F7D7
	dw CODE_07F857
	dw CODE_07F808
	dw CODE_07F82C
	dw CODE_07F982
	dw CODE_07F974
	dw CODE_07F86D
	dw CODE_07F908
	dw CODE_07F8A6
	dw CODE_07F8A6
	dw CODE_07F8A6
	dw CODE_07F8C9
	dw CODE_07F9AD

CODE_07F7D7:
	LDX.b $12
	TXY
	JSL.l CODE_spawn_sprite
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	LDA.w #$0004
	STA.b $16,x
	LDA.w $7042,x
	ORA.w #$0002
	STA.w $7042,x
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_07F807
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
CODE_07F807:
	RTS

CODE_07F808:
	LDX.b $12
	TXY
	JSL.l CODE_spawn_sprite
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	LDA.w #$0001
	STA.b $78,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_07F82B
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
CODE_07F82B:
	RTS

CODE_07F82C:
	LDX.b $12
	TXY
	JSL.l CODE_spawn_sprite
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	LDA.w #$000C
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #$0017
	STA.w $7402,y
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_07F856
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
CODE_07F856:
	RTS

CODE_07F857:
	LDX.b $12
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_07F86C
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
CODE_07F86C:
	RTS

CODE_07F86D:
	LDX.b $12
	PHA
	LDA.w $7A38,x
	PHA
	AND.w #$FF00
	LSR
	LSR
	LSR
	LSR
	STA.b $00
	PLA
	AND.w #$00FF
	ASL
	ASL
	ASL
	ASL
	STA.b $02
	TXY
	PLA
	JSL.l CODE_spawn_sprite
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.b $02
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_07F8A5
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
CODE_07F8A5:
	RTS

CODE_07F8A6:
	LDX.b $12
	TXY
	JSL.l CODE_spawn_sprite
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	JSL.l CODE_048066
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_07F8C8
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
CODE_07F8C8:
	RTS

CODE_07F8C9:
	LDX.b $12
	JSL.l CODE_03AEFD
	TXY
	LDA.w #!Define_YI_NorSpr10E_CrateWith6Stars
	JSL.l CODE_spawn_sprite
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7182,x
	LDA.w #$0001
	STA.b $16,x
	PHB
	LDY.b #YI_NorSpr003_CrateWithKey_Init>>16
	PHY
	PLB
	JSL.l YI_NorSpr003_CrateWithKey_Init
	PLB
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	RTS

DATA_07F900:
	dw $0100,$0080,$FF00,$FE80

CODE_07F908:
	LDX.b $12
	TXY
	JSL.l CODE_spawn_sprite
	JSL.l CODE_init_coin
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID18_CoinSpillage
	JSL.l CODE_push_sound_queue
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_07F931
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
CODE_07F931:
	LDA.w #$0006
	STA.b $00
CODE_07F936:
	JSL.l CODE_random_number_gen
	LDY.b $00
	LDA.w DATA_07F900,y
	STA.b $02
	LDA.w #$0115
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_07F973
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.b $10
	AND.w #$00FF
	CLC
	ADC.b $02
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $10
	AND.w #$01FF
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	DEC.b $00
	DEC.b $00
	BPL.b CODE_07F936
CODE_07F973:
	RTS

CODE_07F974:
	LDX.b $12
	JSL.l CODE_spawn_1up_score
	JSR.w CODE_07FB0A
	JSL.l CODE_despawn_sprite_free_slot
	RTS

CODE_07F982:
	LDX.b $12
	PHA
	JSL.l CODE_03AEFD
	PLA
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	ORA.w #$0001
	STA.w $7182,x
	PHB
	LDY.b #YI_NorSpr06C_LargeSpringBall_Init>>16
	PHY
	PLB
	JSL.l YI_NorSpr06C_LargeSpringBall_Init
	PLB
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	RTS

CODE_07F9AD:
	LDX.b $12
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0040
	STA.w $7542,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_07F9C8
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
CODE_07F9C8:
	RTS

CODE_07F9C9:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BEQ.b CODE_07F9D2
	RTS

CODE_07F9D2:
	LDA.w $7A36,x
	TAX
	LDA.w DATA_bvz_payload_sprite_ids,x
	JMP.w (DATA_bvz_payload_release_ptr,x)

DATA_07F9DC:
DATA_bvz_payload_release_ptr:                   ; 13-entry Baron Von Zeppelin payload release handler ptr (one per payload index)
	dw CODE_07F9F9
	dw CODE_07FA2C
	dw CODE_07FA2C
	dw CODE_07F9F6
	dw CODE_07F9F6
	dw CODE_07FABE
	dw CODE_07F9F6
	dw CODE_07FA6F
	dw CODE_07FA2C
	dw CODE_07FA2C
	dw CODE_07FA2C
	dw CODE_07F9F6
	dw CODE_07FA16

CODE_07F9F6:
	LDX.b $12
	RTS

CODE_07F9F9:
	PHA
	TXA
	ASL
	TAX
	LDY.b $12
	PLA
	JSL.l CODE_spawn_sprite
	TXY
	LDX.b $12
	LDA.w $7042,x
	ORA.w #$0002
	STA.w $7042,x
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BRA.b CODE_07FA3A

CODE_07FA16:
	PHA
	TXA
	ASL
	TAX
	LDY.b $12
	PLA
	JSL.l CODE_spawn_sprite
	TXY
	LDX.b $12
	LDA.w #$0040
	STA.w $7542,x
	BRA.b CODE_07FA3A

CODE_07FA2C:
	PHA
	TXA
	ASL
	TAX
	LDY.b $12
	PLA
	JSL.l CODE_spawn_sprite
	TXY
	LDX.b $12
CODE_07FA3A:
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	LDA.w $7182,x
	CLC
	ADC.w DATA_07F3F8,y
	CLC
	ADC.w #$0008
	STA.b $00
	LDA.w #!Define_YI_AmbSpr1EF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.b $00
	STA.w $7142,y
	RTS

CODE_07FA6F:
	PHA
	TXA
	ASL
	TAX
	LDY.b $12
	PLA
	JSL.l CODE_spawn_sprite
	TXY
	LDX.b $12
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID18_CoinSpillage
	JSL.l CODE_push_sound_queue
	STZ.w $6168
	LDA.w $7182,x
	CLC
	ADC.w DATA_07F3F8,y
	CLC
	ADC.w #$0008
	STA.b $00
	LDA.w #!Define_YI_AmbSpr1EF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.b $00
	STA.w $7142,y
	JMP.w CODE_07F931

CODE_07FABE:
	LDA.w #!Define_YI_SoundID18_CoinSpillage
	JSL.l CODE_push_sound_queue
	TXA
	ASL
	TAY
	LDX.b $12
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	STZ.w $6162
	STZ.w $6168
	LDA.w $7182,x
	CLC
	ADC.w DATA_07F3F8,y
	CLC
	ADC.w #$0008
	STA.b $00
	LDA.w #!Define_YI_AmbSpr1EF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.b $00
	STA.w $7142,y
	JSR.w CODE_07FB0A
	JMP.w CODE_07F974

CODE_07FB0A:
	LDA.w $7A38,x
	PHA
	AND.w #$FF00
	LSR
	LSR
	LSR
	LSR
	STA.b $04
	PLA
	AND.w #$00FF
	ASL
	ASL
	ASL
	ASL
	JSL.l CODE_03D3F3
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Baron Von Zeppelin ($17F) -- Init handler.
; Sets x-speed from DATA_07F110 by spawn-side ($7400,x), then picks one of
; four animation phases from DATA_07F10C using the low 2 bits of the global
; tick byte ($10) -- so co-spawned Barons stagger their wing-flap anim.
; Raidenthequick: init_baron.
;-------------------------------------------------------------------------
YI_NorSpr17F_BaronVonZeppelin_Init:
init_baron:                                ; Raidenthequick: init_baron
;$07FB24
	LDA.w $7400,x                          ; spawn-side index (0 = LR, 1 = RL)
	TAY
	LDA.w DATA_07F110,y                    ; -> $FFC0 or $0040 x-speed
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b $10                              ; global tick byte
	AND.b #$03                             ; -> 0..3 anim-phase seed
	TAY
	LDA.w DATA_07F10C,y                    ; -> $00 / $02 / $04 / $08
	STA.b $18,x                            ; per-slot anim index
	REP.b #$20
	RTL

;---------------------------------------------------------------------------

YI_NorSpr17F_BaronVonZeppelin_Main:
;$07FB3D
	STZ.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_0895B9>>16
	LDA.w #FXCODE_0895B9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	JSL.l CODE_03AF23
	LDA.b $16,x
	TAX
	JMP.w (DATA_baron_main_state_ptr,x)

DATA_07FB55:
DATA_baron_main_state_ptr:                      ; 2-entry Baron Von Zeppelin main state ptr: drift / drop-payload
	dw CODE_07FB59
	dw CODE_07FB5F

CODE_07FB59:
	LDX.b $12
	JSR.w CODE_07FB8B
	RTL

CODE_07FB5F:
	LDX.b $12
	JSR.w CODE_07F3DB
	LDA.w $611C
	SEC
	SBC.w #$0008
	STA.w $70E2,x
	LDA.w $7182,x
	CLC
	ADC.w #$0016
	CLC
	ADC.b $78,x
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $60C4
	EOR.w #$0002
	STA.w $7400,x
	LDA.b $78,x
	BEQ.b CODE_07FB8A
	DEC.b $78,x
CODE_07FB8A:
	RTL

CODE_07FB8B:
	LDY.w $7D36,x
	DEY
	BEQ.b CODE_07FBD2
	BMI.b CODE_07FBD2
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_07FBD2
	LDA.w $7D38,y
	BEQ.b CODE_07FBD2
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr1EF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.w $7CD8,x
	STA.w $7142,y
	PLA
	JML.l CODE_despawn_sprite_free_slot

CODE_07FBD2:
	RTS

CODE_07FBD3:
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611C
	BNE.b CODE_07FC0C
	LDA.w $6122
	CLC
	ADC.w #$0004
	STA.b $00
	LDA.w $7182,x
	CLC
	ADC.w #$0016
	SEC
	SBC.w $611E
	CLC
	ADC.b $00
	CMP.b $00
	BCS.b CODE_07FC0C
	STA.b $78,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0080
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $16,x
	INC.b $16,x
	PLA
	RTL

CODE_07FC0C:
	RTS

CODE_07FC0D:
	LDA.w $7400,x
	LSR
	LSR
	ROR
	STA.b $00
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	EOR.b $00
	RTL

CODE_07FC1F:
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6,y
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	RTL

CODE_07FC2A:
	LDY.w $7D36,x
	BPL.b CODE_07FC49
CODE_07FC2F:
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF6
	BCC.b CODE_07FC4A
	LDA.w $60AA
	BMI.b CODE_07FC46
	SEC
	RTL

CODE_07FC46:
	LDA.w #$0000
CODE_07FC49:
	CLC
CODE_07FC4A:
	RTL

CODE_07FC4B:
	LDY.w $7D36,x
	BPL.b CODE_07FC54
	JSL.l CODE_03A858
CODE_07FC54:
	RTL

CODE_07FC55:
	LDA.w $7182,x
	CMP.w #$0800
	BMI.b CODE_07FC63
	PLY
	PLA
	JML.l CODE_03A31E

CODE_07FC63:
	RTL

CODE_07FC64:
	LDA.w $7680,x
	CLC
	ADC.w #$0040
	CMP.w #$0180
	BCS.b CODE_07FC7A
	LDA.w $7682,x
	CLC
	ADC.w #$0040
	CMP.w #$0180
CODE_07FC7A:
	RTL

CODE_07FC7B:
	LDA.w $7860,x
	BIT.w #$0002
	BNE.b CODE_07FCAA
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_07FCAA:
	RTL

DATA_07FCAB:
	dw $0000,$0002,$0004,$0008

CODE_07FCB3:
	LDA.w #$0010
	BRA.b CODE_07FCBB

CODE_07FCB8:
	LDA.w #$0001
CODE_07FCBB:
	STA.b $08
	LDA.b $14
	BIT.w #$0007
	BNE.b CODE_07FCCD
	LDA.w #!Define_YI_SoundID50_MessageAppears
	JSL.l CODE_push_sound_queue
	LDA.b $14
CODE_07FCCD:
	AND.w #$0003
	ASL
	TAY
	LDA.w DATA_07FCAB,y
	STA.b $06
	LDA.w #!Define_YI_AmbSpr1E2
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	STA.w $70A2,y
	LDA.b $02
	STA.w $7142,y
	LDA.b $08
	STA.w $7782,y
	LDA.w $7002,y
	ORA.b $06
	STA.w $7002,y
	LDA.b $04
	STA.w $7E4C,y
	RTL

CODE_07FCFB:
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.b $00
	CMP.b $02
	BCS.b CODE_07FD15
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	CLC
	ADC.b $04
	CMP.b $06
CODE_07FD15:
	RTL

CODE_07FD16:
	LDA.w #!Define_YI_AmbSpr1E9
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	STA.w $70A2,y
	LDA.b $02
	STA.w $7142,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #$0022
	STA.w $7002,y
	RTS

CODE_07FD34:
	LDA.w #!Define_YI_AmbSpr211
	BRA.b CODE_07FD3C

CODE_07FD39:
	LDA.w #!Define_YI_AmbSpr210
CODE_07FD3C:
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7002,y
	AND.w #$FFF1
	ORA.b $00
	STA.w $7002,y
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$0001
	STA.w $7782,y
	LDA.w #$0017
	STA.w $73C2,y
	RTS

CODE_07FD68:
	JSR.w CODE_07FD39
	RTL

CODE_07FD6C:
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	BPL.b CODE_07FD79
	EOR.w #$FFFF
	INC
CODE_07FD79:
	SEC
	SBC.w $7BB6,x
	SEC
	SBC.w $6120
	BPL.b CODE_07FDB5
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	STA.b $00
	BPL.b CODE_07FD92
	EOR.w #$FFFF
	INC
CODE_07FD92:
	SEC
	SBC.w $7BB8,x
	SEC
	SBC.w $6122
	BPL.b CODE_07FDB5
	LDA.b $00
	SEC
	SBC.w $7BB8,x
	SEC
	SBC.w $6122
	CMP.w #$FFF8
	BCS.b CODE_07FDB0
	LDA.w #$0001
	BRA.b CODE_07FDB8

CODE_07FDB0:
	LDA.w $60AA
	BPL.b CODE_07FDBA
CODE_07FDB5:
	LDA.w #$0000
CODE_07FDB8:
	CLC
	RTL

CODE_07FDBA:
	LDA.w #$0001
	SEC
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Keyhole Cork ($1A4) -- Init handler.
; The cork that plugs the keyhole at the end of every fort/castle level.
; When Yoshi runs into it carrying the world Key, the cork pops and the
; level-clear sequence fires.
; Init snaps the sprite onto the 8-pixel-aligned grid (x += 8, y -= 7) so
; the keyhole tile lines up with BG art, then calls CODE_03D3F8 to verify
; the host BG tile is the expected keyhole. If not, it self-destructs.
; Raidenthequick: init_cork.
;-------------------------------------------------------------------------
YI_NorSpr1A4_KeyholeCork_Init:
init_cork:                                 ; Raidenthequick: init_cork
;$07FDBF
	LDA.w $70E2,x
	CLC
	ADC.w #$0008                           ; x += 8 (snap to 8-px grid)
	STA.w $70E2,x
	LDA.w $7182,x
	SEC
	SBC.w #$0007                           ; y -= 7 (line up with keyhole tile)
	STA.w $7182,x
	JSL.l CODE_03D3F8                      ; verify host BG tile is keyhole
	BEQ.b CODE_07FDE0                      ; if not -> despawn path
	JSR.w CODE_07FF25
	JML.l CODE_03A31E                      ; -> normal sprite-spawn finalize

CODE_07FDE0:
	RTL

;---------------------------------------------------------------------------

DATA_07FDE1:
	db $10,$10,$20

YI_NorSpr1A4_KeyholeCork_Main:
;$07FDE4
	JSL.l CODE_03AF23
	JSL.l CODE_03D127
	JSL.l CODE_03D291
	LDA.b $76,x
	BEQ.b CODE_07FE56
	LDA.w $7A96,x
	BNE.b CODE_07FE55
	LDA.b $76,x
	CMP.w #$0003
	BEQ.b CODE_07FE20
	BCS.b CODE_07FE55
	TAY
	LDA.w $7182,x
	SEC
	SBC.w #$0002
	STA.w $7182,x
	LDA.w DATA_07FDE1,y
	AND.w #$00FF
	STA.w $7A96,x
	LDA.w #!Define_YI_SoundID40_OpenDoor
	JSL.l CODE_push_sound_queue
	INC.b $76,x
	RTL

CODE_07FE20:
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	LDA.w #$F800
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_AmbSpr21A
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7142,y
	LDA.w #$0001
	STA.w $7782,y
	LDA.w #$000B
	STA.w $7E4C,y
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	INC.b $76,x
CODE_07FE55:
	RTL

CODE_07FE56:
	JSR.w CODE_07FEFF
	BNE.b CODE_07FE73
	LDY.w $7D36,x
	BMI.b CODE_07FE63
	JMP.w CODE_07FEE5

CODE_07FE63:
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF6
	BCS.b CODE_07FECF
CODE_07FE73:
	LDY.w $7DF6
	BEQ.b CODE_07FEE4
	LDA.w $7DF6,y
	TAY
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr027_Key
	BNE.b CODE_07FEE4
	TYX
	JSL.l CODE_03BF87
	JSL.l CODE_03A31E
	LDX.b $12
	JSL.l CODE_03D3EB
	JSR.w CODE_07FF25
	LDA.w $7182,x
	SEC
	SBC.w #$0002
	STA.w $7182,x
	LDA.w #$0008
	STA.w $7A96,x
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
	LDA.w #!Define_YI_SoundID40_OpenDoor
	JSL.l CODE_push_sound_queue
	INC.b $76,x
	RTL

CODE_07FECF:
	LDA.b $18,x
	BNE.b CODE_07FEE4
	LDA.w $60D4
	BEQ.b CODE_07FEE4
	LDA.w $7182,x
	CLC
	ADC.w #$0004
	STA.w $7182,x
	INC.b $18,x
CODE_07FEE4:
	RTL

CODE_07FEE5:
	DEY
	BMI.b CODE_07FEE4
	BEQ.b CODE_07FEE4
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_07FEE4
	LDA.w $7D38,x
	BEQ.b CODE_07FEE4
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDX.b $12
	RTL

CODE_07FEFF:
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.b $00
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.b $02
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$7D24
	RTS

CODE_07FF25:
	JSR.w CODE_07FEFF
	BNE.b CODE_07FF46
	LDA.w #$0001
	STA.w $008F
	LDA.w #$7D22
	STA.w $0095
	LDA.b $00
	STA.w $0091
	LDA.b $02
	STA.w $0093
	JSL.l CODE_change_map16
	LDX.b $12
CODE_07FF46:
	RTS

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($07FF50, incbin, DATA_07FF50_YI_U2.bin)
else
	%FREE_BYTES($07FF47, 185, $FF)
endif
%BANK_END(<EndBank>)
endmacro
