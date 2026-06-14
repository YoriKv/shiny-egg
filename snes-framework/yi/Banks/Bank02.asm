macro YIBank02Macros(StartBank, EndBank)
%BANK_START(<StartBank>)

;#############################################################################################################
;# Bank02.asm -- bank $02 sprite handlers and boss code (LoROM PC $010000-$017FFF).
;#
;# Contents at a glance (by SNES address; everything is normal-sprite Init/Main code unless noted):
;#   $02:8000-$02:8047  Yoshi color assignment lookup (per-level color, 12 bytes/world * 8 worlds)
;#   $02:8048-$02:808B  GSU/SuperFX setup helper for compressed-graphic decode requests
;#   $02:808C-$02:80B6  Roger flame spawn helper (CODE_02808C / CODE_0280AC)
;#   $02:80B7-$02:8228  Falling Wall (sprite $036) -- BG3 wall that crumbles
;#   $02:8262-$02:848A  Roger family shared state machine + draw/animation routines
;#   $02:848B-$02:85F8  Roger's Pot (sprite $034) + the pre-Roger pottery animation
;#   $02:85FA-$02:867F  Roger the Potted Ghost (sprite $035) main state machine
;#   $02:8687-$02:8C5C  Roger combat AI: flames, lunges, jumps, fall-back-into-pot
;#   $02:8C5D-$02:8F38  Potted Ghost Flame (sprite $038) -- the projectile Roger spits
;#   $02:8F39-$02:9230  Horizontal Rotating Plank (sprite $039) BG3 platform
;#   $02:9231-$02:933F  Unused sprite $04D stub and Middle Ring (sprite $04F) checkpoint
;#   $02:9340-$02:9D40  Dent of Squishy Platform (sprite $07E) -- the bouncy slime block deformation
;#   $02:9D41-$02:A2D0  Super Star powerup (sprites $059 stationary / $088 collectible) state machine
;#   $02:A2D1-$02:A4E2  Full Egg Spawner (sprite $0AB) -- supplies Yoshi with 6 eggs to start a fight
;#   $02:A4E3-$02:A77C  Hookbill background helpers + Chomp warning signboard (sprites $0D5, $0D8)
;#   $02:A77D-$02:AE60  Falling Rock Platform (sprite $0DE) and 4 falling-stone variants ($137-$13A)
;#   $02:AE61-$02:B528  Key (sprite $027) + the door/boss-door family ($001, $012, $04E, $093, $0CA, $131)
;#   $02:B529-$02:BC93  Teleport (sprite $084) + Goal Ring (sprite $00D) + Yoshi-at-Goal (sprite $08C)
;#   $02:BC94-$02:CA76  Hit Super-Baby-Mario block (sprite $004) and the 5 Grinder monkey variants ($1A5-$1A9)
;#   $02:CA77-$02:D300  Nep-Enut (sprite $0A5) boss / Gargantua Blargg shared underwater boss code
;#   $02:D301-$02:D9A2  Prince Froggy (sprite $045) boss state machine
;#   $02:D9A3-$02:DBD0  Giant Shyguy red/green (sprites $042/$043) + Stomach Acid (sprite $13B)
;#   $02:DBD1-$02:E155  Sluggy the Unshaven (sprite $0D7) boss + Kamek-shrinks-Sluggy cinematic
;#   $02:E156-$02:E289  Pipe / vertical+horizontal entrances (sprites $042 vert, $0D0/$0D1/$147)
;#   $02:E28A-$02:E490  Key-from-Boss (sprite $014) + Boss Explosion (sprite $013) + Lava Log (sprite $000)
;#   $02:E491-$02:F71F  Naval Piranha (sprite $171) boss + its buds (sprite $172) and vines (sprite $002)
;#   $02:F720-$02:FFD7  Naval Piranha data tables (per-bud OAM blocks, animation frames, palette data)
;#
;# Cross-references:
;#   Raidenthequick disassembly/bank02.asm -- best descriptive labels (init_roger, init_naval_piranha, etc.)
;#   Raidenthequick docs/named_main_labels.txt -- bank $02 section
;#   ys_enmy*.asm  -- per-sprite enemy handlers (Roger/OBAKE in ys_enmy3, falling-wall
;#                    in ys_enmy13, pipe entrances in ys_enmy8, boss-explosion in ys_enmy5)
;#   ys_boss1.asm  -- Sluggy the Unshaven (sprite $0D7) boss
;#   ys_boss2.asm  -- Naval Piranha (sprite $171) + buds ($172) + vines ($002) boss
;#   docs/spritestateengine.md  -- sprite engine architecture: normal vs ambient distinction,
;#       per-sprite Init/Main pointer tables, state-byte semantics, EXRAM slot layout.
;#   ../Constants/NormalSpriteIDs.asm  -- the 501-entry sprite-ID -> name table.
;#
;# Conventions in this file:
;#   YI_NorSprXXX_<Name>_Init: / _Main:  templated sprite handler labels (do not rename or remove).
;#   Descriptive aliases (init_<name>:) sit at the same address.  asar accepts multiple
;#   labels at one address; both forms resolve to the same byte.
;#   CODE_/DATA_ labels keep their cart-address-derived names; aliases added where meaning is clear.
;#############################################################################################################

;-------------------------------------------------------------------------
; yoshi_level_colors_LUT: per-level Yoshi color lookup.
; 12 bytes per world * 6 worlds + filler.  Indexed by world*12 + level.
; Color IDs: $00=green $01=light-blue $02=yellow $03=red $04=pink $05=cyan $06=purple $07=brown.
; Raidenthequick: DATA_yoshi_level_colors
;-------------------------------------------------------------------------
DATA_028000:
DATA_yoshi_level_colors:
	db $00,$01,$03,$02,$04,$05,$06,$07,$00,$00,$00,$00,$00,$01,$03,$02
	db $04,$05,$06,$07,$00,$00,$00,$00,$00,$01,$03,$02,$04,$05,$06,$07
	db $00,$00,$00,$00,$00,$01,$03,$02,$04,$05,$06,$07,$00,$00,$00,$00
	db $00,$01,$03,$02,$04,$05,$06,$07,$00,$00,$00,$00,$00,$01,$03,$02
	db $04,$05,$06,$00,$00,$00,$00,$00

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_028048: Sets up SuperFX registers and kicks off a dynamic-tile decompression run.
; Called by sprites needing animation tiles uploaded by the SuperFX chip.
; Inputs: X = current normal-sprite slot index; sprite's $7722 word holds a dyntile index.
; Loads source/destination addresses into R2/R3/R12/R13, then calls
; !RAM_YI_Global_BeginSuperFXProcessingRt which trampolines into FXCODE_088295.
; Side effect: $0CF9 (dyntile-job counter) is incremented.
;-------------------------------------------------------------------------
CODE_028048:
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $16,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$001F
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #FXDATA_548000+$0040
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$0040)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088295>>16
	LDA.w #FXCODE_088295
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_02808C: Helper that spawns ambient sprite $1D4 (Roger's flame trail dust)
; and copies the caller's screen position into the new ambient slot.
; Used by Roger/Potted-Ghost flame to leave behind a particle effect.
; Inputs: X = current sprite slot.  Outputs: Y = new ambient slot index.
;-------------------------------------------------------------------------
CODE_02808C:
	LDA.w #!Define_YI_AmbSpr1D4
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$000B
	STA.w $7E4C,y
	LDA.w #$0006
	STA.w $7782,y
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	RTL

;---------------------------------------------------------------------------

CODE_0280AC:
	JSL.l CODE_02808C
	LDA.w #$0001
	STA.w $7E4E,y
	RTL

;---------------------------------------------------------------------------

; DATA_0280B7 -- 3-entry index table into the BGR palette pool at DATA_falling_wall_palette_pool.
; Indexed by sprite-palette ID; result copied to $70:404A.
DATA_0280B7:
	dw $0022,$0046,$006A

; DATA_falling_wall_palette_pool -- SMWC: falling-wall palette pool (108 bytes). Colors are
; stored as separate B,G,R bytes (not BGR15 words). Indexed via DATA_0280B7.
DATA_0280BD:
DATA_falling_wall_palette_pool:
	db $02,$04,$06,$02,$04,$06,$00,$00,$00,$02,$04,$06,$02,$04,$06,$00
	db $00,$00,$0F,$10,$11,$0D,$07,$05,$0C,$0A,$0A,$0F,$10,$11,$0D,$07
	db $05,$0C,$0A,$0A,$0C,$10,$16,$0D,$07,$05,$0C,$0A,$0A,$0C,$10,$16
	db $0D,$07,$05,$0C,$0A,$0A,$0C,$10,$16,$0D,$07,$05,$0C,$0A,$0A,$0C
	db $10,$16,$0D,$07,$05,$0C,$0A,$0A,$01,$03,$05,$01,$03,$05,$00,$00
	db $00,$01,$03,$05,$01,$03,$05,$00,$00,$00,$07,$0C,$11,$03,$05,$08
	db $05,$09,$0D,$07,$0C,$11,$03,$05,$08,$05,$09,$0D

DATA_028129:
	dw $0028,$FFD8

;-------------------------------------------------------------------------
; Init handler for the (BG3) Falling Wall sprite (sprite ID $036).
; Used as the crumbling wall that drops on Yoshi in castle rooms.
; see also: ys_enmy13.asm.  Raidenthequick: init_falling_wall.
; Caller: %ROUTINE_YI_NorSpr_Init dispatcher.  M=16, X=16.  DBR will be set inside.
; Special case: when BG1 tileset = $0A (uses dark palette set), tweaks OAM YXPPCCCT bit 2.
;-------------------------------------------------------------------------
YI_NorSpr036_FallingWall_Init:
init_falling_wall:                              ; Raidenthequick: init_falling_wall
;$02812D
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo  ; \ pick palette set based on tileset
	CMP.w #$000A                                 ; |  $0A = the dark-castle tileset
	BNE.b CODE_02813E                            ; /
	LDA.w $7042,x                                ; \ flip OAM palette bit (bit 2)
	ORA.w #$0004                                 ; |
	STA.w $7042,x                                ; /
CODE_02813E:
	JSR.w CODE_028183
	STZ.w !RAM_YI_Level_LevelHeaderBG3TilesetLo
	PHB
	PHK
	PLB
	LDY.w $0073
	LDA.w $70E2,x
	CLC
	ADC.w DATA_028129,y
	STA.w $70E2,x
	ORA.w #$0008
	STA.w $7E42
	LDA.w #$0104
	STA.w $0CB8
	STZ.w $7E40
	STZ.w $0CB4
	LDA.w $7042,x
	AND.w #$000E
	TAX
	LDY.w DATA_0280B7,x
	LDX.b #$22
CODE_028172:
	LDA.w DATA_falling_wall_palette_pool,y
	STA.l $70404A,x
	DEY
	DEY
	DEX
	DEX
	BPL.b CODE_028172
	LDX.b $12
	PLB
	RTL

CODE_028183:
	LDA.w $0CB2
	BEQ.b CODE_02818D
	PLA
	JML.l CODE_03A31E

CODE_02818D:
	INC.w $0CB2
	RTS

;---------------------------------------------------------------------------

DATA_028191:
	dw DATA_028197,DATA_0281B1,DATA_0281CB

DATA_028197:
	db $04,$10,$8E,$60,$00,$8E,$60,$00,$00,$60,$10,$00,$60,$04,$00,$00
	db $01,$42,$01,$02,$80,$02,$03,$C2,$03,$00

DATA_0281B1:
	db $04,$08,$E0,$50,$F8,$E0,$50,$F8,$20,$50,$08,$20,$50,$04,$60,$00
	db $01,$A2,$01,$02,$E0,$02,$03,$22,$03,$00

DATA_0281CB:
	db $08,$00,$C8,$60,$D9,$D9,$60,$C8,$00,$60,$D9,$27,$60,$00,$38,$60
	db $27,$27,$60,$38,$00,$60,$27,$D9,$60,$08,$E0,$00,$01,$C2,$01,$02
	db $A1,$02,$03,$83,$03,$04,$60,$04,$05,$42,$05,$06,$21,$06,$07,$03
	db $07

DATA_0281FC:
	dw $FC00,$04FF

DATA_028200:
	dw $0000,$00F0

DATA_028204:
	db $08,$C0,$FF,$00,$00

;-------------------------------------------------------------------------
; Main handler for Falling Wall (sprite $036).
; Sequenced sub-state held in $7A96,x; layer/scroll commit via $7E40.
; Raidenthequick: main_falling_wall.
;-------------------------------------------------------------------------
YI_NorSpr036_FallingWall_Main:
main_falling_wall:                              ; Raidenthequick: main_falling_wall
;$028209
	JSL.l CODE_02841A
	LDA.w $7C16,x
	CLC
	ADC.w #$0070
	CMP.w #$00E1
	LDA.w #$0215
	BCS.b CODE_02822A
	LDA.w #$0710
	LDY.w $7E40
	DEY
	CPY.b #$BF
	BCS.b CODE_02822A
	LDA.w #$0714
CODE_02822A:
	STA.w !RAM_YI_Global_MainScreenLayers
	JSL.l CODE_03AF23
	LDA.w $7A96,x
	BNE.b CODE_02825F
	LDY.w $0CB4
	BNE.b CODE_028262
	LDA.w $7C16,x
	CLC
	ADC.w #$0030
	CMP.w #$0061
	BCS.b CODE_02825F
	LDA.w $7C18,x
	CLC
	ADC.w #$0030
	CMP.w #$0061
	BCS.b CODE_02825F
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState00_Normal
	BNE.b CODE_02825F
	INC.w $0CB4
	INY
CODE_02825F:
	JMP.w CODE_028417

CODE_028262:
	LDA.w $7A36,x
	CLC
	ADC.w DATA_0281FC,y
	CMP.w DATA_028200,y
	BNE.b CODE_028271
	LDA.w DATA_028200,y
CODE_028271:
	STA.w $7A36,x
	LDA.w $7A38,x
	AND.w #$00FF
	CLC
	ADC.w $7A36,x
	STA.w $7A38,x
	AND.w #$FF00
	BPL.b CODE_028289
	ORA.w #$00FF
CODE_028289:
	XBA
	CLC
	ADC.w $7E40
	STA.w $7E40
	SEC
	SBC.w DATA_028204,y
	EOR.w DATA_028200,y
	BMI.b CODE_0282D5
	LDA.w #$0040
	CPY.b #$01
	BEQ.b CODE_0282AD
	LDX.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CPX.b #!Define_YI_PlayerState12_SmushedByWall
	BNE.b CODE_0282AB
	LDA.w #$0100
CODE_0282AB:
	LDX.b $12
CODE_0282AD:
	STA.w $7A96,x
	LDA.w DATA_028204,y
	STA.w $7E40
	STZ.w $7A36,x
	STZ.w $7A38,x
	LDA.w #$0000
	DEY
	BNE.b CODE_0282D2
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	LDA.w #$0060
	STA.w $61C6
	LDA.w #$0003
CODE_0282D2:
	STA.w $0CB4
CODE_0282D5:
	TXY
	REP.b #$10
	LDA.w $7E40
	BIT.w #$0040
	PHP
	BEQ.b CODE_0282E5
	EOR.w #$003F
	INC
CODE_0282E5:
	EOR.w #$00FF
	INC
	AND.w #$003F
	ASL
	TAX
	LDA.l FXDATA_0BBA12,x
	LSR
	PLP
	BNE.b CODE_0282FA
	EOR.w #$FFFF
	INC
CODE_0282FA:
	SEP.b #$20
	STA.w !REGISTER_Mode7MatrixParameterA
	XBA
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.b #$60
	STA.w !REGISTER_Mode7MatrixParameterB
	LDA.w !REGISTER_PPUMultiplicationProductLo
	ASL
	REP.b #$20
	LDA.w !REGISTER_PPUMultiplicationProductMid
	ROL
	STA.w $0CBA
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState12_SmushedByWall
	BNE.b CODE_028322
	STY.w $61B6
	BRA.b CODE_028365

CODE_028322:
	LDA.w $0CB4
	DEC
	BNE.b CODE_028365
	LDA.w $0CB8
	SEC
	SBC.w #$0060
	ASL
	TAX
	LDA.l $702200,x
	STA.b $08
	SEP.b #$20
	STA.w !REGISTER_Mode7MatrixParameterA
	XBA
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.b #$30
	STA.w !REGISTER_Mode7MatrixParameterB
	REP.b #$20
	LDA.w !REGISTER_PPUMultiplicationProductMid
	STA.b $06
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w $70E2,y
	STA.b $02
	BPL.b CODE_02835B
	EOR.w #$FFFF
	INC
CODE_02835B:
	CLC
	ADC.w #$0008
	STA.b $04
	CMP.b $06
	BCC.b CODE_028368
CODE_028365:
	JMP.w CODE_028415

CODE_028368:
	LDA.w $7E40
	AND.w #$00FF
	ASL
	TAX
	LDA.l DATA_sine_lut_8bit_radians,x
	SEP.b #$20
	STA.w !REGISTER_Mode7MatrixParameterA
	XBA
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.b #$70
	STA.w !REGISTER_Mode7MatrixParameterB
	LDA.w !REGISTER_PPUMultiplicationProductMid
	CMP.b #$60
	REP.b #$20
	BCC.b CODE_028365
	LDA.w #$000B
	LDX.w $60C2
	BEQ.b CODE_028396
	LDA.w #$0005
CODE_028396:
	CLC
	ADC.w $7682,y
	SEC
	SBC.w $60B2
	BMI.b CODE_028415
	SEC
	SBC.w $0CBA
	BMI.b CODE_028415
	CMP.w #$0030
	BCS.b CODE_028415
	LDX.w $60C0
	BEQ.b CODE_0283D3
	LDX.w $60AA
	BPL.b CODE_0283B8
	STZ.w $60AA
CODE_0283B8:
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0010
	SEC
	SBC.w $7182,y
	BMI.b CODE_028415
	EOR.w #$FFFF
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_0283D3:
	LDA.w #!Define_YI_PlayerState12_SmushedByWall
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $60B4
	STZ.w $60A8
	STZ.w $60AA
	JSL.l CODE_04F74A
	JSL.l CODE_03BFF7
	INC.w $0D94
	LDA.b $08
	ASL
	TAX
	LDA.l $702200,x
	SEP.b #$20
	STA.w !REGISTER_Mode7MatrixParameterA
	XBA
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.b $04
	STA.w !REGISTER_Mode7MatrixParameterB
	REP.b #$20
	LDA.w !REGISTER_PPUMultiplicationProductMid
	LDX.b $02
	BPL.b CODE_028410
	EOR.w #$FFFF
	INC
CODE_028410:
	STA.w $7E46
	REP.b #$20
CODE_028415:
	SEP.b #$10
CODE_028417:
	LDX.b $12
	RTL

CODE_02841A:
	LDY.b #$00
CODE_02841C:
	PHY
	PHB
	PHK
	PLB
	LDA.w DATA_028191,y
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
	LDA.w #DATA_028197>>16
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08BE9F>>16
	LDA.w #FXCODE_08BE9F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $01A4
	LDA.w !RAM_YI_Global_HDMAEnable
	AND.w #$00E7
	ORA.w #$0010
	STA.w !RAM_YI_Global_HDMAEnable
	PLB
	LDX.b $12
	PLY
	CPY.b #$04
	BEQ.b CODE_02848B
	JSL.l CODE_despawn_sprite
	BCC.b CODE_02848B
	STZ.w $0CB2
CODE_02848B:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Init handler for Roger's Pot (sprite $034).
; Spawns the pre-Roger pottery, then conditionally pairs it with sprite $047
; (Shy Guy pushing Roger).  Loads the pot's CGRAM palette from DATA_5FE67E
; into both the live palette mirror and the global YI palette mirror at row $61.
; Raidenthequick: init_roger.
;-------------------------------------------------------------------------
YI_NorSpr034_RogersPot_Init:
init_roger:                                     ; Raidenthequick: init_roger
;$02848C
	LDA.w #$0035
	JSL.l CODE_spawn_sprite_active
	BCS.b CODE_028499
	JML.l CODE_03A31E

CODE_028499:
	LDA.w #$0006
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	STA.w $7860,y
	TYA
	STA.b $18,x
	JSR.w CODE_0284E1
	LDY.b #$2D
	JSL.l CODE_0CE5D6
	LDA.w #$0047
	TXY
	JSL.l CODE_03A34E
	BCC.b CODE_0284CC
	LDA.w $70E2,x
	CLC
	ADC.w #$0040
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
CODE_0284CC:
	LDX.b #$3C
CODE_0284CE:
	LDA.l DATA_5FE67E,x
	STA.l $702E2E,x
	STA.l YI_Global_PaletteMirror[$61].LowByte,x
	DEX
	DEX
	BPL.b CODE_0284CE
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

CODE_0284E1:
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	RTS

;---------------------------------------------------------------------------

DATA_0284EE:
	dw $0100,$FF00

DATA_0284F2:
	dw $006C,$FFA0

;-------------------------------------------------------------------------
; Main handler for Roger's Pot (sprite $034).
; Mirrors X-speed onto paired ghost slot, syncs positions, plays the
; "Shy Guy pushing pot" interaction.  Raidenthequick: main_roger.
;-------------------------------------------------------------------------
YI_NorSpr034_RogersPot_Main:
main_roger:                                     ; Raidenthequick: main_roger
;$0284F6
	JSL.l CODE_03AF23
	LDY.b $18,x
	JSR.w CODE_0284E1
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $61B4
	BNE.b CODE_02854F
	LDY.w $7D36,x
	BPL.b CODE_02854F
	LDA.w $60B4
	PHA
	JSL.l CODE_03D130
	PLA
	BCS.b CODE_02854F
	CMP.w $60B4
	BEQ.b CODE_02854F
	PHA
	CLC
	ADC.w #$0100
	CMP.w #$0201
	LDY.b #$00
	PLA
	BCC.b CODE_028542
	BPL.b CODE_028539
	LDY.b #$02
CODE_028539:
	LDA.w DATA_0284F2,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w DATA_0284EE,y
CODE_028542:
	STA.w $60B4
	INC.w $61C2
	INC.w $60DC
	JSL.l CODE_0D90A1
CODE_02854F:
	LDY.b $18,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	CMP.w #$0006
	BNE.b CODE_028592
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState02_InCutscene
	BNE.b CODE_0285DB
	LDA.w $1015
	BNE.b CODE_028579
	LDA.w $60C0
	BEQ.b CODE_028571
	LDA.w #$0040
	STA.w $7A96,x
CODE_028571:
	LDA.w $7A96,x
	BNE.b CODE_0285DB
	INC.w $1015
CODE_028579:
	BPL.b CODE_0285DB
	STZ.w $1015
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0180
	STA.w $7A98,y
	LDA.w #$0100
	STA.w $7AF6,y
	BRA.b CODE_0285DB

CODE_028592:
	CMP.w #$0004
	BNE.b CODE_0285DB
	LDA.w $7542,x
	CMP.w #$0040
	BCS.b CODE_0285A2
	INC.w $7542,x
CODE_0285A2:
	LDA.w $7682,x
	CMP.w #$0300
	BCC.b CODE_0285DB
	LDA.w #$0005
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0040
	STA.w $7AF8,y
	LDA.w #$00FF
	STA.w $74A2,y
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	LDA.w #$0060
	STA.w $61C6
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	STA.b $02
	JSL.l CODE_02E1A3
	JML.l CODE_despawn_sprite_free_slot

CODE_0285DB:
	LDA.w $7860,x
	AND.w #$0001
	STA.w $7860,y
	BEQ.b CODE_0285E9
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_0285E9:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Init handler for Roger the Potted Ghost (sprite $035).
; Empty -- Roger is spawned by sprite $034 (RogersPot)'s Init via CODE_03A34E.
; Raidenthequick: init_roger_2.
;-------------------------------------------------------------------------
YI_NorSpr035_RogerThePottedGhost_Init:
init_roger_2:                                   ; Raidenthequick: init_roger_2
;$0285EA
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Main handler for Roger the Potted Ghost (sprite $035).
; State machine dispatched via DATA_roger_state_ptr (jump table on $18,x).
; Uses SuperFX (FXCODE_0A8390) for collision/draw helper.
; Raidenthequick: main_roger_2.  see also: ys_enmy3.asm.
;-------------------------------------------------------------------------
YI_NorSpr035_RogerThePottedGhost_Main:
main_roger_2:                                   ; Raidenthequick: main_roger_2
;$0285EB
	JSR.w CODE_02893E
	JSL.l CODE_03AF23
	LDA.b $18,x
	ASL
	TXY
	TAX
	JSR.w (DATA_roger_state_ptr,x)
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
	BEQ.b CODE_028639
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	LDA.w $60B4
	CLC
	ADC.w #$FF80
	CMP.w #$FC00
	BPL.b CODE_028636
	LDA.w #$FC00
CODE_028636:
	STA.w $60B4
CODE_028639:
	LDA.w $6014
	BEQ.b CODE_028650
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	CLC
	ADC.w #$FF80
	CMP.w #$FE00
	BPL.b CODE_02864D
	LDA.w #$FE00
CODE_02864D:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
CODE_028650:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_028660
	LDA.w $7D38,y
	BEQ.b CODE_028660
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
CODE_028660:
	RTL

; Roger state-pointer table.  Indexed by $18,x * 2 (state index).
; Raidenthequick: DATA_roger_state_ptr.
DATA_028661:
DATA_roger_state_ptr:
	dw CODE_028687
	dw CODE_02879B
	dw CODE_028827
	dw CODE_028874
	dw CODE_0288AA
	dw CODE_0288FF
	dw CODE_02866F

CODE_02866F:
	TYX
	RTS

DATA_028671:
	db $00,$01,$02,$03,$04,$05,$06,$07
	db $08,$09,$08

DATA_02867C:
	db $01,$01,$01,$02,$02,$03,$04,$08
	db $04,$08,$04

CODE_028687:
	TYX
	LDY.w $7041,x
	CPY.b #$20
	BCC.b CODE_02870B
	LDA.w $7AF8,x
	BNE.b CODE_0286B5
	LDY.b $78,x
	INY
	CPY.b #$0C
	BCC.b CODE_0286A0
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDY.b #$08
CODE_0286A0:
	TYA
	STA.b $78,x
	LDA.w DATA_028671-$01,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_02867C-$01,y
	AND.w #$00FF
	STA.w $7AF8,x
CODE_0286B5:
	LDA.w $7A98,x
	BNE.b CODE_0286CC
	LDA.w #$0001
	STA.b $18,x
	LDA.w #$000F
	STA.b $78,x
	LDA.w #$0003
	STA.w $7A38,x
	BRA.b CODE_02870B

CODE_0286CC:
	LDA.w $7AF6,x
	BNE.b CODE_0286F9
	LDA.b $76,x
	CMP.w #$0007
	BCC.b CODE_0286F9
	LDA.w $7C16,x
	CMP.w #$0030
	BCS.b CODE_0286F9
	LDA.w $7C18,x
	CMP.w #$0030
	BCS.b CODE_0286F9
	LDA.w #$0002
	STA.b $18,x
	LDA.w #$000A
	STA.b $76,x
	STZ.w $7AF8,x
	STZ.b $16,x
	BRA.b CODE_02870B

CODE_0286F9:
	LDA.w $7A36,x
	CMP.w #$0800
	BCC.b CODE_02870B
	LDA.w #$0003
	STA.b $18,x
	STZ.b $78,x
	STZ.w $7AF8,x
CODE_02870B:
	LDA.w $7860,x
	BNE.b CODE_028739
	LDA.w #!Define_YI_SoundID82_BossFalling
	JSL.l CODE_push_sound_queue
	LDA.w #$0004
	STA.b $18,x
	LDA.w #$000E
	STA.b $76,x
	STZ.b $16,x
	LDA.w $7182,x
	STA.b $78,x
	LDA.w #$0013
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7AF8,x
	JSL.l CODE_02A982
	RTS

CODE_028739:
	LDA.b $16,x
	CLC
	ADC.w #$0008
	CMP.w #$0101
	BCC.b CODE_028768
	LDA.b $76,x
	INC
	CMP.w #$0009
	BCC.b CODE_028763
	LDY.w $7041,x
	CPY.b #$20
	BCS.b CODE_028760
	LDA.w $7040,x
	CLC
	ADC.w #$6000
	STA.w $7040,x
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
CODE_028760:
	LDA.w #$0007
CODE_028763:
	STA.b $76,x
	LDA.w #$0000
CODE_028768:
	STA.b $16,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	DEC
	BPL.b CODE_028775
CODE_028770:
	STZ.w $7A36,x
	BRA.b CODE_02877C

CODE_028775:
	CLC
	ADC.w $7A36,x
	STA.w $7A36,x
CODE_02877C:
	RTS

DATA_02877D:
	db $06,$05,$04,$03,$02,$01,$0A,$0B
	db $0A,$02,$03,$04,$05,$06,$07

DATA_02878C:
	db $01,$01,$01,$01,$01,$01,$02,$10
	db $02,$01,$01,$01,$01,$01,$10

CODE_02879B:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_0287B7
	LDY.b $78,x
	BNE.b CODE_0287BB
	DEC.w $7A38,x
	BNE.b CODE_0287B9
	LDA.w #$01C0
	STA.w $7A98,x
	STZ.b $18,x
	LDA.w #$0008
	STA.b $78,x
CODE_0287B7:
	BRA.b CODE_028824

CODE_0287B9:
	LDY.b #$0F
CODE_0287BB:
	DEY
	TYA
	STA.b $78,x
	LDA.w DATA_02878C,y
	AND.w #$00FF
	STA.w $7A98,x
	LDA.w DATA_02877D,y
	AND.w #$00FF
	STA.w $7402,x
	CMP.w #$000B
	BNE.b CODE_028824
	LDA.w #$0038
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_028824
	PHY
	LDA.w #!Define_YI_SoundID04_SpitOut
	JSL.l CODE_push_sound_queue
	PLY
	LDA.w $70E2,x
	CLC
	ADC.w $6000
	SEC
	SBC.w #$0008
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w $6002
	CLC
	ADC.w #$0006
	STA.w $7182,y
	LDA.w #$FE80
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0010
	STA.w $7540,y
	LDA.w #$0120
	STA.w $7A96,y
	LDA.w #$0002
	STA.w $7A98,y
	LDA.w #$0020
	STA.w $7AF6,y
	LDX.b $12
CODE_028824:
	JMP.w CODE_02870B

CODE_028827:
	TYX
	LDA.b $76,x
	ASL
	TAY
	LDA.b $16,x
	CLC
	ADC.w DATA_028A41,y
	CMP.w #$0101
	BCC.b CODE_02885B
	LDA.b $76,x
	INC
	CMP.w #$000D
	BCC.b CODE_02884A
	STZ.b $18,x
	LDA.w #$0080
	STA.w $7AF6,x
	LDA.w #$0007
CODE_02884A:
	STA.b $76,x
	CMP.w #$000B
	BNE.b CODE_028858
	LDA.w #!Define_YI_SoundID83_LungeFish
	JSL.l CODE_push_sound_queue
CODE_028858:
	LDA.w #$0000
CODE_02885B:
	STA.b $16,x
	RTS

DATA_02885E:
	db $07,$06,$05,$0C,$0D,$0E,$0F,$10
	db $11,$10,$0F

DATA_028869:
	db $10,$01,$01,$01,$01,$01,$10,$02
	db $20,$02,$10

CODE_028874:
	TYX
	LDA.w $7AF8,x
	BNE.b CODE_0288A5
	LDY.b $78,x
	INY
	CPY.b #$0C
	BCC.b CODE_028890
	STZ.b $18,x
	STZ.w $7A36,x
	LDA.w #$0008
	STA.b $78,x
	STZ.w $7AF6,x
	BRA.b CODE_0288A5

CODE_028890:
	TYA
	STA.b $78,x
	LDA.w DATA_02885E-$01,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_028869-$01,y
	AND.w #$00FF
	STA.w $7AF8,x
CODE_0288A5:
	JMP.w CODE_02870B

DATA_0288A8:
	db $02,$FF

CODE_0288AA:
	TYX
	LDA.w $7182,x
	SEC
	SBC.b $78,x
	CMP.w #$007E
	BCS.b CODE_0288E7
	XBA
	STA.w !REGISTER_DividendLo
	LDY.b #$7E
	STY.w !REGISTER_Divisor
	LDA.w $7AF8,x
	BNE.b CODE_0288DB
	LDY.w $7402,x
	CPY.b #$14
	BEQ.b CODE_0288CC
	INY
CODE_0288CC:
	TYA
	STA.w $7402,x
	LDA.w DATA_0288A8-$13,y
	AND.w #$00FF
	STA.w $7AF8,x
	BRA.b CODE_0288E1

CODE_0288DB:
	NOP #6
CODE_0288E1:
	LDA.w !REGISTER_QuotientLo
	STA.b $16,x
	RTS

CODE_0288E7:
	LDA.b $76,x
	CMP.w #$000E
	BNE.b CODE_0288F2
	INC.b $76,x
	STZ.b $16,x
CODE_0288F2:
	LDA.b $16,x
	CMP.w #$0100
	BCS.b CODE_0288FE
	ADC.w #$0010
	STA.b $16,x
CODE_0288FE:
	RTS

CODE_0288FF:
	TYX
	LDA.w $7AF8,x
	BEQ.b CODE_028906
	RTS

CODE_028906:
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w #$0078
	STA.b $00
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$00C0
	STA.b $02
	JSL.l CODE_0D8ED7
	JSL.l CODE_despawn_sprite_free_slot
	PLA
	RTL

;---------------------------------------------------------------------------

CODE_028922:
	STZ.w $60B4
CODE_028925:
	LDA.w #!Define_YI_PlayerState02_InCutscene
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $617A
	STZ.w $617C
	STZ.w $61D6
	STZ.w $60DE
	STZ.w $60EA
	STZ.w $60E0
	RTL

;---------------------------------------------------------------------------

CODE_02893E:
	LDY.w $74A2,x
	BPL.b CODE_028944
	RTS

CODE_028944:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	CMP.w #$0006
	BNE.b CODE_028958
	LDA.w #$0008
	STA.b $00
	STZ.b $02
	JSR.w CODE_0289CB
	PLA
	RTL

CODE_028958:
	LDA.b $76,x
	ASL
	TAY
	LDA.w DATA_028A33,y
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w DATA_028A33+$02,y
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #DATA_028A5D>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0042
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STZ.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$449E
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $16,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7680,x
	CLC
	ADC.w #$0002
	STA.w $6040
	LDA.w $7682,x
	SEC
	SBC.w #$0008
	STA.w $6042
	LDX.b #FXCODE_08E93B>>16
	LDA.w #FXCODE_08E93B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	LDX.b $12
	LDA.w #$0002
	STA.w !RAM_YI_Global_SubScreenLayers
	LDA.w #$0065
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.w #$0018
	TSB.w !RAM_YI_Global_HDMAEnable
	LDA.l $7045A2
	STA.b $00
	LDA.l $7045A4
	STA.b $02
CODE_0289CB:
	REP.b #$10
	LDY.w $7362,x
	LDX.w #$0003
CODE_0289D3:
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
	BNE.b CODE_0289D3
	LDX.b $12
	LDA.w $7040,x
	CMP.w #$2000
	BCC.b CODE_028A2E
	LDA.l $70459E
	SEC
	SBC.w #$0010
	STA.w $6000
	LDA.l $7045A0
	SEC
	SBC.w #$0004
	STA.w $6002
	LDX.w #$000C
CODE_028A11:
	LDA.w $6000,y
	CLC
	ADC.w $6000
	STA.w $6000,y
	LDA.w $6002,y
	CLC
	ADC.w $6002
	STA.w $6002,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEX
	BNE.b CODE_028A11
CODE_028A2E:
	SEP.b #$10
	LDX.b $12
	RTS

DATA_028A33:
	dw DATA_028A5D,DATA_028AE1,DATA_028B65,DATA_028BE9,DATA_028C6D,DATA_028CF1,DATA_028D75

DATA_028A41:
	dw DATA_028DF9,DATA_028E7D,DATA_028DF9,DATA_028DF9,DATA_028F01,DATA_028F85,DATA_028DF9
	dw DATA_028DF9,DATA_029009,DATA_028BE9

UNk_028A55:
	dw $0008,$0010,$0008,$0008

DATA_028A5D:
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0001,$0001
	dw $0001,$0001,$0001,$0001,$0001,$0001,$0002,$0002
	dw $0002,$0002,$0003,$0003,$0003,$0003,$0004,$0004
	dw $0004,$0004,$0006,$0006,$0006,$0006,$0008,$0008
	dw $0008,$0008,$000A,$000A,$000A,$000A,$000B,$000B
	dw $000B,$000B,$000C,$000C,$000C,$000C,$000D,$000D
	dw $000D,$000D,$000D,$000D,$000D,$000D,$000E,$000E
	dw $000E,$000E,$000E,$000E,$000E,$000E,$000E,$000F
	dw $000F,$0008

DATA_028AE1:
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0001,$0001
	dw $0001,$0001,$0001,$0001,$0001,$0001,$FF02,$FF02
	dw $FF02,$FF02,$FF03,$FF03,$FF03,$FF03,$FE04,$FE04
	dw $FE04,$FE04,$FE06,$FE06,$FE06,$FE06,$FE08,$FE08
	dw $FE08,$FE08,$FE0A,$FE0A,$FE0A,$FE0A,$FE0B,$FE0B
	dw $FE0B,$FE0B,$FF0C,$FF0C,$FF0C,$FF0C,$FF0D,$FF0D
	dw $FF0D,$FF0D,$FF0D,$FF0D,$FF0D,$FF0D,$000E,$000E
	dw $000E,$000E,$000E,$000E,$000E,$000E,$000E,$000F
	dw $000F,$0008

DATA_028B65:
	dw $0000,$0000,$0000,$FF02,$FF02,$FF02,$FD03,$FD03
	dw $FD03,$FD03,$FB04,$FB04,$FB04,$FB04,$F805,$F805
	dw $F805,$F805,$F505,$F505,$F505,$F505,$F206,$F206
	dw $F206,$F206,$F108,$F108,$F108,$F108,$F10B,$F10B
	dw $F10B,$F10B,$F10F,$F10F,$F10F,$F10F,$F210,$F210
	dw $F210,$F210,$F312,$F312,$F312,$F312,$F613,$F613
	dw $F613,$F613,$F912,$F912,$F912,$F912,$FB12,$FB12
	dw $FB12,$FB12,$FE0F,$FE0F,$FE0F,$FE0F,$FE0F,$000F
	dw $000F,$F50B

DATA_028BE9:
	dw $0000,$FF00,$FEFF,$FDFF,$FCFE,$FBFE,$FAFE,$F9FE
	dw $F8FF,$F6FF,$F500,$F300,$F100,$F000,$EFFF,$EEFE
	dw $EDFD,$EBFC,$EAFB,$E9FB,$E8FA,$E7FA,$E5FA,$E4FB
	dw $E3FC,$E2FD,$E1FF,$E100,$E102,$E103,$E105,$E107
	dw $E109,$E10A,$E20C,$E30D,$E30F,$E310,$E411,$E412
	dw $E514,$E615,$E716,$E816,$E917,$EB17,$ED17,$EF16
	dw $F015,$F113,$F211,$F310,$F40F,$F50E,$F60D,$F70C
	dw $F90C,$FA0C,$FB0C,$FC0C,$FD0C,$FE0D,$FF0E,$000F
	dw $000F,$E505

DATA_028C6D:
	dw $0000,$FE01,$FD02,$FC02,$FB03,$FA03,$F703,$F602
	dw $F401,$F300,$F2FF,$F1FE,$EFFC,$EDFB,$EBFA,$E9FA
	dw $E7F8,$E6F5,$E4F2,$E2F1,$E0F0,$DEF0,$DBF0,$D9F2
	dw $D7F4,$D5F7,$D4F9,$D2FB,$D1FD,$D1FF,$D101,$D103
	dw $D105,$D207,$D309,$D40A,$D50C,$D50E,$D610,$D712
	dw $D913,$DA14,$DC14,$DE14,$E015,$E116,$E318,$E519
	dw $E71A,$E91A,$EB1B,$ED1B,$EF1A,$F118,$F316,$F515
	dw $F716,$F917,$FB17,$FD16,$FE14,$FF12,$FF10,$000F
	dw $000F,$D501

DATA_028CF1:
	dw $0000,$FFFF,$FFFD,$FDFB,$FBFA,$F9F9,$F7F8,$F5F8
	dw $F3F8,$F1F9,$EFF9,$ECF9,$E9F9,$E7F7,$E6F5,$E4F3
	dw $E1F2,$DDF3,$D9F2,$D6EF,$D3EE,$CEED,$CAEE,$C6EF
	dw $C3F1,$C0F4,$BEF6,$BBF8,$BAFC,$B900,$B904,$B907
	dw $BA0B,$BA0E,$BB10,$BC12,$BD14,$BF16,$C118,$C318
	dw $C617,$C818,$CA1C,$CC1F,$D020,$D221,$D622,$DB20
	dw $DE1D,$E21A,$E518,$E716,$E914,$EB13,$ED11,$EF10
	dw $F10F,$F40E,$F60D,$F90D,$FB0E,$FD0E,$FF0F,$000F
	dw $000F,$BD04

DATA_028D75:
	dw $0000,$FEFF,$FBFF,$F8FE,$F5FE,$F2FC,$EFFA,$ECF9
	dw $E9F8,$E6F8,$E3F9,$E0F8,$DCF7,$D7F5,$D4F4,$D3F1
	dw $D0EE,$CCED,$C8ED,$C3EE,$C0EA,$BAE9,$B5E9,$B0EA
	dw $ABEC,$A7EF,$A3F3,$9EFA,$9C00,$9A05,$990F,$9A15
	dw $9C1A,$9E1E,$A021,$A323,$A525,$A826,$AC26,$B027
	dw $B526,$BA24,$BD20,$C01C,$C518,$CA16,$D015,$D517
	dw $D91A,$DD1C,$E01C,$E31C,$E61C,$E91C,$EB1B,$ED1A
	dw $F019,$F318,$F617,$F915,$FB13,$FD12,$FF10,$000F
	dw $000F,$9D0F

DATA_028DF9:
	dw $0000,$FD00,$FAFF,$F7FF,$F4FF,$F100,$EEFF,$EBFE
	dw $E8FE,$E5FB,$E1FA,$DDF7,$D7F2,$D1EE,$CCEC,$C7EA
	dw $C0EB,$BAEB,$B5E9,$B0E8,$AAE6,$A4E6,$9EE7,$98EA
	dw $92EC,$8CEE,$88F2,$85F6,$83FA,$82FF,$8205,$830A
	dw $840F,$8613,$8817,$8A19,$8D1C,$901F,$9321,$9623
	dw $9C24,$A125,$A724,$AC22,$B01E,$B81C,$BE1D,$C420
	dw $CA23,$D024,$D623,$DA23,$DE21,$E21F,$E51C,$E919
	dw $EC17,$F016,$F415,$F714,$F912,$FC0F,$FE0C,$000B
	dw $98FE,$8605

DATA_028E7D:
	dw $0000,$FD01,$FA00,$F7FF,$F4FC,$F1FA,$EEF8,$EBF6
	dw $E8F5,$E4F5,$DFF4,$DAF4,$D5F3,$D0F3,$CBF2,$C6F1
	dw $C0ED,$BAEA,$B6E8,$B0E6,$AAE7,$A4E8,$9DE8,$97EB
	dw $91EE,$8CF1,$88F6,$85FA,$83FE,$8201,$8206,$820B
	dw $830F,$8413,$8617,$881B,$8A1E,$8D21,$9123,$9624
	dw $9C24,$A124,$A722,$AB22,$B124,$B824,$BF21,$C51E
	dw $CC1E,$D01F,$D620,$DB21,$DF22,$E322,$E622,$EA22
	dw $ED20,$F01E,$F41B,$F717,$F914,$FC10,$FE0D,$000B
	dw $9CF9,$8606

DATA_028F01:
	dw $0000,$FE00,$FB01,$F902,$F703,$F405,$F106,$EE06
	dw $EA05,$E604,$E203,$DF02,$DB01,$D7FF,$D3FD,$CFFB
	dw $CCFA,$C8F9,$C4F8,$BDF8,$B6F8,$B0F9,$ABFB,$A7FD
	dw $A300,$A003,$9E07,$9D0A,$9C0E,$9B12,$9B16,$9B1A
	dw $9C1E,$9D22,$9E26,$A02A,$A22E,$A432,$A635,$A938
	dw $AD3C,$B240,$B744,$BB47,$C14A,$C74D,$CE4F,$D351
	dw $D752,$DC53,$E053,$E453,$E852,$EC50,$F14D,$F44A
	dw $F747,$F943,$FB3E,$FD37,$FF30,$0027,$001A,$000F
	dw $E037,$9F16

DATA_028F85:
	dw $0000,$00E8,$00CF,$00B8,$00AA,$FF9E,$FE97,$F992
	dw $F390,$ED90,$E991,$E495,$E09A,$DEA2,$DDA9,$DCB1
	dw $DBB8,$D8BE,$D5C2,$D1C6,$CEC9,$CACC,$C6CF,$C2D2
	dw $BED6,$BAD9,$B7DC,$B4E0,$B2E4,$B0E9,$B0ED,$B0F1
	dw $B1F6,$B2FA,$B4FE,$B602,$B805,$BA07,$BD09,$C20B
	dw $C60C,$CB0C,$CF0B,$D30A,$D707,$DA04,$DC01,$DFFE
	dw $E2FB,$E5F7,$E6F4,$E8F1,$EDEE,$F1EF,$F4F2,$F5F5
	dw $F7FA,$F800,$F804,$F908,$FA0B,$FB0D,$FE0F,$000F
	dw $F09F,$B4ED

DATA_029009:
	dw $0000,$FA00,$F400,$EE00,$E800,$E200,$DC00,$D6FF
	dw $D0FF,$CAFC,$C2FC,$BAF9,$AEF5,$A2F2,$98F0,$8EEF
	dw $80F0,$74F0,$6AEE,$60ED,$54EC,$48EC,$3CEC,$30EF
	dw $24F0,$18F2,$10F5,$0AF8,$06FC,$0400,$0404,$0608
	dw $080C,$0C0F,$1012,$1414,$1A16,$2018,$261A,$2C1C
	dw $381C,$421D,$4E1C,$581B,$6018,$7016,$7C17,$8819
	dw $941C,$A01C,$AC1C,$B41C,$BC1A,$C418,$CA16,$D214
	dw $D812,$E011,$E810,$EE10,$F20E,$F80C,$FC09,$0008
	dw $30FF,$0804

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Init handler for Potted Ghost Flame (sprite $038).
; Empty -- spawned by Roger (sprite $035) when he spits a flame.
; Raidenthequick: init_roger_flame.
;-------------------------------------------------------------------------
YI_NorSpr038_PottedGhostFlame_Init:
init_roger_flame:                               ; Raidenthequick: init_roger_flame
;$02908D
	RTL

;---------------------------------------------------------------------------

DATA_02908E:
	dw $0010,$0018

DATA_029092:
	dw $0008,$0016

DATA_029096:
	dw $0000,$0001,$0002,$0003,$0004,$0005,$0004,$0005
	dw $0003,$0002,$0001,$0000

DATA_0290AE:
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0040,$0040
	dw $0000,$0000,$0000,$0000

DATA_0290C6:
	dw $0002,$0002,$0002,$0002,$0008,$0008,$0008,$0008
	dw $0006,$0006,$0006,$0006

DATA_0290DE:
	dw $FF80,$0080,$FF00,$0100

;-------------------------------------------------------------------------
; Main handler for Potted Ghost Flame (sprite $038).
; Bounces/skids along the floor, ends when it hits a wall or Yoshi.
; Raidenthequick: main_roger_flame.
;-------------------------------------------------------------------------
YI_NorSpr038_PottedGhostFlame_Main:
main_roger_flame:                               ; Raidenthequick: main_roger_flame
;$0290E6
	JSL.l CODE_03AF23
	INC.b $16,x
	LDA.w $7A96,x
	BNE.b CODE_02910A
	LDA.w #$0008
	STA.w $7540,x
	STZ.w $75E0,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$FF80
	STA.w $75E2,x
	LDY.b #$02
	BRA.b CODE_029161

CODE_02910A:
	LDY.w $7D36,x
	BPL.b CODE_029113
	JSL.l CODE_03A858
CODE_029113:
	LDA.w $75E0,x
	BNE.b CODE_029127
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_02915F
	STZ.w $7540,x
	LDA.w $7AF6,x
	BNE.b CODE_02915F
	BRA.b CODE_029133

CODE_029127:
	LDA.b $16,x
	BIT.w #$001F
	BNE.b CODE_02915F
	AND.w #$0040
	BNE.b CODE_02914A
CODE_029133:
	LDY.b #$00
	LDA.w $7C16,x
	BPL.b CODE_02913C
	LDY.b #$02
CODE_02913C:
	LDA.w DATA_0290DE,y
	STA.w $75E0,x
	LDA.w #$0002
	STA.w $7540,x
	BRA.b CODE_02915F

CODE_02914A:
	LDY.b #$00
	LDA.w $7C18,x
	BPL.b CODE_029153
	LDY.b #$02
CODE_029153:
	LDA.w DATA_0290DE,y
	STA.w $75E2,x
	LDA.w #$0002
	STA.w $7542,x
CODE_02915F:
	LDY.b #$00
CODE_029161:
	LDA.w $7A98,x
	BNE.b CODE_029195
	LDA.b $18,x
	INC
	INC
	CMP.w DATA_02908E,y
	BNE.b CODE_02917A
	CPY.b #$00
	BEQ.b CODE_029177
	JML.l CODE_03A31E

CODE_029177:
	LDA.w DATA_029092,y
CODE_02917A:
	STA.b $18,x
	TAY
	LDA.w DATA_029096,y
	STA.w $7402,x
	LDA.w $7042,x
	AND.w #$00BF
	ORA.w DATA_0290AE,y
	STA.w $7042,x
	LDA.w DATA_0290C6,y
	STA.w $7A98,x
CODE_029195:
	RTL

;---------------------------------------------------------------------------

DATA_029196:
	db $40,!REGISTER_CGRAMAddress : dl $7E5C18

DATA_02919B:
	db $E9 : dw $7E528C
	db $E9 : dw $7E528C
	db $00

DATA_0291A2:
	db $02,!REGISTER_WriteToCGRAMPort : dl $7E51FC

DATA_0291A7:
	db $02,!REGISTER_WriteToCGRAMPort : dl $7E5244

DATA_0291AC:
	db $02,!REGISTER_BG3HorizScrollOffset : dl $7E51E4

DATA_0291B1:
	db $0B,$15,$1B,$12,$1A,$1F,$18,$1D,$1F,$03,$05,$08,$03,$0A,$11,$08
	db $0F,$17

;-------------------------------------------------------------------------
; Init handler for the (BG3) Horizontal Rotating Plank (sprite $039).
; Programs HDMA channels 1/2/3/6 for the per-scanline Mode-7-style rotation
; effect, seeds the angle/period state, and writes a palette block.
; Raidenthequick: init_spinning_wooden_platform.
;-------------------------------------------------------------------------
YI_NorSpr039_HorizontalRotatingPlank_Init:
init_spinning_wooden_platform:                  ; Raidenthequick: init_spinning_wooden_platform
;$0291C3
	SEP.b #$20
	LDX.b #$04
CODE_0291C7:
	LDA.w DATA_029196,x
	STA.w HDMA[$01].Parameters,x
	LDA.w DATA_0291A2,x
	STA.w HDMA[$02].Parameters,x
	LDA.w DATA_0291AC,x
	STA.w HDMA[$03].Parameters,x
	LDA.w DATA_0291A7,x
	STA.w HDMA[$06].Parameters,x
	DEX
	BPL.b CODE_0291C7
	LDA.b #$7E528C>>16
	STA.w HDMA[$01].IndirectSourceBank
	STA.w HDMA[$02].IndirectSourceBank
	STA.w HDMA[$03].IndirectSourceBank
	STA.w HDMA[$06].IndirectSourceBank
	LDX.b #$06
CODE_0291F2:
	LDA.w DATA_02919B,x
	STA.l $7E5C18,x
	DEX
	BPL.b CODE_0291F2
	LDX.b #$6F
	LDA.b #$09
CODE_029200:
	STA.l $7E528C,x
	DEX
	BPL.b CODE_029200
	REP.b #$20
	LDX.b #$10
CODE_02920B:
	LDA.w DATA_0291B1,x
	STA.l $70404A,x
	DEX
	DEX
	BPL.b CODE_02920B
	LDA.w #$0000
	STA.l YI_Global_PaletteMirror[$0B].LowByte
	STA.l $702D82
	LDX.b $12
	LDA.w $70E2,x
	ORA.w #$0008
	STA.w $70E2,x
	DEC.w $7182,x
	LDA.w #$0040
	STA.b $16,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Main handler for the Horizontal Rotating Plank (sprite $039).
; Uses PPU multiplication ($211B/$211C) to compute the Yoshi-vs-plank
; collision angle each frame.  Raidenthequick: main_spinning_wooden_platform.
;-------------------------------------------------------------------------
YI_NorSpr039_HorizontalRotatingPlank_Main:
main_spinning_wooden_platform:                  ; Raidenthequick: main_spinning_wooden_platform
;$029235
	JSR.w CODE_029316
	LDY.w $7E3E
	BEQ.b CODE_02924A
	LDA.w $7E46
	STA.b $00
	DEY
	CPY.b $12
	BEQ.b CODE_029298
	JMP.w CODE_029306

CODE_02924A:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w $70E2,x
	STA.b $00
	CLC
	ADC.w #$007F
	CMP.w #$00FF
	BCC.b CODE_02925F
	JMP.w CODE_029306

CODE_02925F:
	REP.b #$10
	LDA.b $16,x
	ASL
	TAX
	LDA.l DATA_cosine_lut_8bit_radians,x
	STA.b $02
	BPL.b CODE_029271
	EOR.w #$FFFF
	INC
CODE_029271:
	ASL
	TAX
	LDA.l $702200,x
	LSR
	SEP.b #$30
	STA.w !REGISTER_Mode7MatrixParameterA
	XBA
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.b $00
	STA.w !REGISTER_Mode7MatrixParameterB
	REP.b #$20
	LDA.w !REGISTER_PPUMultiplicationProductMid
	ASL
	LDY.b $03
	BPL.b CODE_029294
	EOR.w #$FFFF
	INC
CODE_029294:
	STA.b $00
	LDX.b $12
CODE_029298:
	STZ.w $7E3E
	LDA.w $60AA
	BMI.b CODE_029306
	LDA.b $00
	CLC
	ADC.w #$0070
	CMP.w #$00E1
	BCS.b CODE_029306
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0020
	CMP.w #$FFF6
	BCC.b CODE_029306
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60AA
	TXA
	INC
	STA.w $7E3E
	INC.w $61B4
	LDA.b $00
	STA.w $7E46
	LDA.b $16,x
	STA.w $7E40
	LDA.w $70E2,x
	STA.w $7E42
	LDA.b $16,x
	ASL
	REP.b #$10
	TAX
	LDA.l DATA_sine_lut_8bit_radians,x
	ASL
	ASL
	ASL
	SEP.b #$30
	STA.w !REGISTER_Mode7MatrixParameterA
	XBA
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.w $7E46
	STA.w !REGISTER_Mode7MatrixParameterB
	REP.b #$20
	LDA.w !REGISTER_PPUMultiplicationProductMid
	EOR.w #$FFFF
	INC
	STA.w $61BA
	LDX.b $12
CODE_029306:
	JSL.l CODE_03AF23
	LDA.b $16,x
	CLC
CODE_02930D:
	ADC.w #$FFFF
	AND.w #$00FF
	STA.b $16,x
CODE_029315:
	RTL

CODE_029316:
	LDA.b $16,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$00D4
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7682,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0030
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w #$0078
	SEC
	SBC.w $7680,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $0CC2
	BEQ.b CODE_02934E
	LDX.b #FXCODE_08C470>>16
	LDA.w #FXCODE_08C470
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JMP.w CODE_02937E

CODE_02934E:
	INC.w $0CC2
	LDX.b #FXCODE_08C450>>16
	LDA.w #FXCODE_08C450
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E51E4,$703516 : dw $00A8
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $01A4
	LDA.w #$0004
	TSB.w !RAM_YI_Global_SubScreenLayers
	LDA.w #$005E
	TSB.w !RAM_YI_Global_HDMAEnable
CODE_02937E:
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Unused sprite slot $04D.  Empty stubs; in the slot reserved between
; Locked Door ($04E) and Middle Ring ($04F).  Raidenthequick: init_unused_4D / main_unused_4D.
;-------------------------------------------------------------------------
YI_NorSpr04D_UnusedSpriteIndex_Init:
init_unused_4D:                                 ; Raidenthequick: init_unused_4D
;$029381:
	RTL

;---------------------------------------------------------------------------

YI_NorSpr04D_UnusedSpriteIndex_Main:
main_unused_4D:                                 ; Raidenthequick: main_unused_4D
;$029382
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Init handler for Middle Ring (sprite $04F) -- the in-level checkpoint.
; Raidenthequick: init_middle_ring.  When passed, transforms_enemies (sub
; at $029417 region) is invoked to morph nearby Shyguys etc.
;-------------------------------------------------------------------------
YI_NorSpr04F_MiddleRing_Init:
init_middle_ring:                               ; Raidenthequick: init_middle_ring
;$029383
	JSL.l CODE_03D406
	LDA.w #$0020
	STA.w $7A36,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Main handler for Middle Ring (sprite $04F).
; Uses FXCODE_08D3F9 (SuperFX) to draw the sparkle/ring animation.
; Hit-tests Yoshi (Yoshi center +-32px X, +-56/+-40px Y); on contact
; arms the checkpoint flag at $7400,x.  Raidenthequick: main_middle_ring.
;-------------------------------------------------------------------------
YI_NorSpr04F_MiddleRing_Main:
main_middle_ring:                               ; Raidenthequick: main_middle_ring
;$02938E
	LDA.w $7362,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $76,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $78,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	SEP.b #$10
	LDX.b #FXCODE_08D3F9>>16
	LDA.w #FXCODE_08D3F9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.b $76,x
	LDA.w $0030
	AND.w #$0003
	BNE.b CODE_0293CF
	LDA.b $78,x
	INC
	CMP.w #$0006
	BCC.b CODE_0293CD
	LDA.w #$0000
CODE_0293CD:
	STA.b $78,x
CODE_0293CF:
	LDY.b $18,x
	BEQ.b CODE_0293D6
	JMP.w CODE_029461

CODE_0293D6:
	JSL.l CODE_03AF23
	LDA.w $7C16,x
	CLC
	ADC.w #$0020
	CMP.w #$0041
	BCS.b CODE_0293F2
	LDA.w $7C18,x
	CLC
	ADC.w #$0038
	CMP.w #$0089
	BCC.b CODE_0293FC
CODE_0293F2:
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
CODE_0293FB:
	RTL

CODE_0293FC:
	LDA.w $7C18,x
	CLC
	ADC.w #$0028
	CMP.w #$0046
	BCS.b CODE_0293FB
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BEQ.b CODE_0293FB
	LDA.w !RAM_YI_Level_TutorialMessageFlagsLo
	AND.w #!Define_YI_TutorialMessage_FirstMidpoint
	BNE.b CODE_029434
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	DEC
	BNE.b CODE_029434					; Note: !Define_YI_LevelID_WatchOutBelow
	LDA.w !RAM_YI_Level_TutorialMessageFlagsLo
	ORA.w #!Define_YI_TutorialMessage_FirstMidpoint
	STA.w !RAM_YI_Level_TutorialMessageFlagsLo
	LDA.w #$0027
	STA.l $704070
	INC.w !RAM_YI_Level_MessageBoxState 
CODE_029434:
	INC.w $0B65
	INC.b $18,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDA.w #$0008
	STA.w $7A98,x
	LDA.w $0396
	CLC
	ADC.w #$0064
	STA.w $0396
	LDA.w #$00DC
	STA.w $0B7F
	RTL

;---------------------------------------------------------------------------

DATA_029459:
	dw $0013,$0021,$002F,$003D

CODE_029461:
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_02946E
	LDA.w $7A98,x
	BEQ.b CODE_02946F
	DEC.w $7A98,x
CODE_02946E:
	RTL

CODE_02946F:
	LDA.w $0396
	BNE.b CODE_02946E
	LDA.w $7A36,x
	CMP.w #$0020
	BNE.b CODE_029485
	PHA
	LDA.w #!Define_YI_SoundID27_CollectSuperStar
	JSL.l CODE_push_sound_queue
	PLA
CODE_029485:
	CLC
	ADC.w #$0002
	CMP.w #$0060
	BCS.b CODE_02949D
	STA.w $7A36,x
	LSR
	LSR
	LSR
	LSR
	ASL
	TAY
	LDA.w DATA_029459-$04,y
	STA.b $78,x
	RTL

CODE_02949D:
	STZ.w $0B65
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	JSL.l CODE_03D3EB
	JSL.l CODE_029507
	LDX.b $12
	JSL.l CODE_despawn_sprite_free_slot
CODE_0294B4:
	LDA.w #$01A2
CODE_0294B7:
	STA.b $0E
	LDY.b #$5C
CODE_0294BB:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$000E
	BCS.b CODE_0294CD
	CMP.w #$0008
	BNE.b CODE_0294FF
	LDA.w $6162
	BNE.b CODE_0294FF
CODE_0294CD:
	LDA.w $6FA2,y
	AND.w #$6000
	BEQ.b CODE_0294EC
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr0CD_BaronVonZeppelinCarryingGiantEgg
	BEQ.b CODE_0294EC
	CMP.w #!Define_YI_NorSpr0CE_BowserFire
	BEQ.b CODE_0294EC
	CMP.w #!Define_YI_NorSpr026_BowserFightGiantEgg
	BNE.b CODE_0294FF
	LDA.w $7D38,y
	BNE.b CODE_0294FF
CODE_0294EC:
	CPY.w $61B6
	BNE.b CODE_0294F4
	STZ.w $61B6
CODE_0294F4:
	LDA.w #$0006
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.b $0E
	STA.w $0B91,y
CODE_0294FF:
	DEY
	DEY
	DEY
	DEY
	BPL.b CODE_0294BB
	RTL

;---------------------------------------------------------------------------

CODE_029506:
	RTL

;---------------------------------------------------------------------------

CODE_029507:
	INC.w !RAM_YI_Level_MiddleRingsTouchedLo
	REP.b #$10
	LDX.w #$020C
CODE_02950F:
	LDA.w $03B2,x
	STA.l $7E79A6,x
	DEX
	DEX
	BPL.b CODE_02950F
	SEP.b #$10
	LDA.w $7DF6
	STA.l $7E7BB0
	BEQ.b CODE_029534
	TAX
CODE_029526:
	LDY.w $7DF6,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	STA.l $7E7BB0,x
	DEX
	DEX
	BNE.b CODE_029526
CODE_029534:
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

DATA_029537:
	dw FXDATA_540000+$0000,FXDATA_548000+$2000,FXDATA_540000+$0000,FXDATA_540000+$0000
	dw FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_548000+$2010
	dw FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000
	dw FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000
	dw FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000
	dw FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000
	dw FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000
	dw FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_548000+$2020
	dw FXDATA_548000+$2060,FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000
	dw FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000
	dw FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000
	dw FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000
	dw FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000
	dw FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000
	dw FXDATA_548000+$2050,FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_540000+$0000
	dw FXDATA_540000+$0000,FXDATA_540000+$0000,FXDATA_548000+$2040,FXDATA_548000+$2030

;---------------------------------------------------------------------------

DATA_0295B7:
	dw $FFF0,$0010

;-------------------------------------------------------------------------
; Init+Main for the Dent-of-Squishy-Platform invisible sprite (sprite $07E).
; This is the deformation tracker for the BG3 "castella" slime block --
; computes the dent depth from Yoshi's Y position and feeds SuperFX (FXCODE
; later) to redraw the block tilemap.  Init falls through into Main.
; Raidenthequick: init_invisible_slime_platform / main_invisible_slime_platform.
;-------------------------------------------------------------------------
YI_NorSpr07E_DentOfSquishyPlatform_Init:
init_invisible_slime_platform:                  ; Raidenthequick: init_invisible_slime_platform
;$0295BB
	JSR.w CODE_0297F3
	LDA.w $0020
	STA.w $7A38,x
	LDA.w $0022
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $0024
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSR.w CODE_02984B
YI_NorSpr07E_DentOfSquishyPlatform_Main:
main_invisible_slime_platform:                  ; Raidenthequick: main_invisible_slime_platform
	JSL.l CODE_03AF23
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $18,x
	BEQ.b CODE_029627
	LDY.b #$00
	LDA.b $76,x
	BPL.b CODE_0295E8
	LDY.b #$02
CODE_0295E8:
	CLC
	ADC.w DATA_0295B7,y
	STA.b $76,x
	BEQ.b CODE_0295F8
	EOR.w DATA_0295B7,y
	BPL.b CODE_0295F8
	JMP.w CODE_0297A3

CODE_0295F8:
	LDY.b #$00
	LDA.w $7A38,x
	JSR.w CODE_029818
	LDY.b #$02
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	JSR.w CODE_029818
	LDY.b #$04
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JSR.w CODE_029818
	STZ.w $61BE
	JML.l CODE_03A31E

;---------------------------------------------------------------------------

DATA_029617:
	dw $0008,$0004,$0000,$0000,$0000,$0000

DATA_029623:
	dw $FFD0,$0030

CODE_029627:
	LDA.b $76,x
	BPL.b CODE_02969E
	LDA.w $60C2
	ASL
	TAY
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_029617,y
	BMI.b CODE_0296AF
	CMP.w #$0008
	BMI.b CODE_02964B
	LDA.w $7182,x
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$0008
CODE_02964B:
	XBA
	LSR
	LSR
	LSR
	EOR.w #$FFFF
	STA.b $76,x
	LDA.w $60AA
	CLC
	ADC.w #$0030
	CMP.w #$0010
	BMI.b CODE_029663
	LDA.w #$0010
CODE_029663:
	STA.w $60AA
	LDA.w #$0002
	STA.w $61DC
	LDA.w $61F0
	CMP.w #$0002
	BCS.b CODE_029681
	LDA.w #$0006
	STA.w $61F0
	LDA.w #!Define_YI_SoundID9B_YoshiHeadStuck
	JSL.l CODE_push_sound_queue
CODE_029681:
	LDY.b #$00
	LDA.w $60B4
	BEQ.b CODE_02969B
	BPL.b CODE_02968C
	INY
	INY
CODE_02968C:
	CLC
	ADC.w DATA_029623,y
	STA.w $60B4
	EOR.w DATA_029623,y
	BMI.b CODE_02969B
	STZ.w $60B4
CODE_02969B:
	JMP.w CODE_029744

CODE_02969E:
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w $6112
	CLC
	ADC.w #$0020
	SEC
	SBC.w $7182,x
	BPL.b CODE_0296B4
CODE_0296AF:
	INC.b $18,x
	JMP.w CODE_0297A3

CODE_0296B4:
	CMP.w #$000A
	BMI.b CODE_0296CA
	LDA.w $7182,x
	SEC
	SBC.w #$0016
	SEC
	SBC.w $6112
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$000A
CODE_0296CA:
	STA.b $00
	LDA.w $60C0
	BEQ.b CODE_0296E8
	LDA.w $60AA
	BPL.b CODE_0296E8
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	LDA.b $00
	ASL
	ASL
	ASL
	ASL
	ADC.w $60AA
	BRA.b CODE_029739

CODE_0296E8:
	INC.w $61B4
	LDY.b $00
	CPY.b #$02
	BCS.b CODE_0296FB
	INC.b $00
	INC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$0000
	BRA.b CODE_029739

CODE_0296FB:
	LDA.w #$0000
	CPY.b #$05
	BCC.b CODE_029705
	LDA.w #$0000
CODE_029705:
	STA.w $60FA
	LDA.w $60F8
	BNE.b CODE_029714
	LDA.w #!Define_YI_SoundID9B_YoshiHeadStuck
	JSL.l CODE_push_sound_queue
CODE_029714:
	LDA.w $60A8
	BPL.b CODE_02971D
	EOR.w #$FFFF
	INC
CODE_02971D:
	LSR
	EOR.w #$FFFF
	INC
	STA.b $02
	LDA.w #$0008
	SEC
	SBC.b $00
	ASL
	ASL
	ASL
	ASL
	CLC
	ADC.b $02
	CMP.w #$FF00
	BPL.b CODE_029739
	LDA.w #$FF00
CODE_029739:
	STA.w $60AA
	LDA.b $00
	XBA
	LSR
	LSR
	LSR
	STA.b $76,x
CODE_029744:
	LDA.w $70E2,x
	AND.w #$FFF0
	STA.b $00
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0008
	STA.w $70E2,x
	AND.w #$FFF0
	SEC
	SBC.b $00
	BEQ.b CODE_0297A3
	BMI.b CODE_029775
	LDA.w $7A38,x
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $7A38,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	PLA
	LDY.b #$00
	BRA.b CODE_029788

CODE_029775:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w $7A38,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	PLA
	LDY.b #$04
CODE_029788:
	PHY
	JSR.w CODE_029818
	JSR.w CODE_0297F3
	PLY
	BNE.b CODE_02979A
	LDA.w $0024
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BRA.b CODE_0297A0

CODE_02979A:
	LDA.w $0020
	STA.w $7A38,x
CODE_0297A0:
	JSR.w CODE_02984B
CODE_0297A3:
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0030
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $70E2,x
	AND.w #$000F
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDY.b $78,x
	CPY.b #$02
	BNE.b CODE_0297C5
	CMP.w #$000D
	BCS.b CODE_0297D0
	BRA.b CODE_0297CE

CODE_0297C5:
	CPY.b #$40
	BNE.b CODE_0297D0
	CMP.w #$0004
	BCC.b CODE_0297D0
CODE_0297CE:
	INC.b $18,x
CODE_0297D0:
	LDA.w DATA_029537,y
	LDY.b $77,x
	BPL.b CODE_0297DB
	CLC
	ADC.w #$0800
CODE_0297DB:
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$0000)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088CDB>>16
	LDA.w #FXCODE_088CDB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CFB
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

CODE_0297F3:
	LDA.w #$0002
	STA.w $008F
	LDA.w $70E2,x
	STA.w $0091
	LDA.w $7182,x
	STA.w $0093
	LDA.w #$6200
	STA.w $0095
	JSL.l CODE_change_map16
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

DATA_029812:
	dw $0000,$0010,$0020

CODE_029818:
	CMP.w #$6106
	BEQ.b CODE_02983C
	STA.w $0095
	LDA.w #$0001
	STA.w $008F
	LDA.w $6EBC
	CLC
	ADC.w DATA_029812,y
	STA.w $0091
	LDA.w $7182,x
	STA.w $0093
	JSL.l CODE_change_map16
	LDX.b $12
CODE_02983C:
	RTS

;---------------------------------------------------------------------------

DATA_02983D:
	dw $0001,$0003,$0002,$0001,$0003,$0002,$0000

CODE_02984B:
	LDA.w $7A38,x
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_02983D,y
	ASL
	ASL
	STA.b $78,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_02983D,y
	ORA.b $78,x
	ASL
	ASL
	STA.b $78,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_02983D,y
	ORA.b $78,x
	ASL
	STA.b $78,x
	RTS

;---------------------------------------------------------------------------

DATA_02987C:
	dw $FF80,$0080

;-------------------------------------------------------------------------
; Init for Stationary Super Star (sprite $059) -- the continuous Super Star
; that hangs in midair in the Star Mario challenge rooms.
; If Yoshi is already in Super Baby Mario form, falls through into the
; shared $088 init logic; otherwise parks the star in a pending state.
; Raidenthequick: init_super_star_continuous.
;-------------------------------------------------------------------------
YI_NorSpr059_StationarySuperStar_Init:
init_super_star_continuous:                     ; Raidenthequick: init_super_star_continuous
;$029880
	LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerForm10_SuperBabyMario
	BEQ.b CODE_02989E
CODE_029888:
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$00FF
	STA.w $74A2,x
	RTL

;-------------------------------------------------------------------------
; Init for the standard Super Star (sprite $088) -- the powerup that triggers
; the Super Baby Mario form (10s timer).  Shares its draw with $059.
; Raidenthequick: init_super_star.
;-------------------------------------------------------------------------
YI_NorSpr088_SuperStar_Init:
init_super_star:                                ; Raidenthequick: init_super_star
	LDY.w $7400,x
	LDA.w DATA_02987C,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_02989E:
	JSL.l CODE_03AE60
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #FXDATA_550000+$60F0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$60F0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088619>>16
	LDA.w #FXCODE_088619
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	LDY.w $74A2,x
	BPL.b CODE_0298F3
	LDA.w #$0005
	STA.w $74A2,x
CODE_0298E8:
	LDA.w #!Define_YI_SoundID30_AppearingStars
	JSL.l CODE_push_sound_queue
	JSL.l CODE_04849E
CODE_0298F3:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Shared Main for both Super Star variants (sprites $059, $088).
; State machine: $18,x indexes DATA_super_star_state_ptr -> [CODE_super_star_state_00_idle_pickup, CODE_super_star_state_01_transform_to_super_baby_mario].
; Activates Super Baby Mario form on Yoshi-collision and plays sound $30.
; Raidenthequick: main_super_star.
;-------------------------------------------------------------------------
YI_NorSpr059_StationarySuperStar_Main:
YI_NorSpr088_SuperStar_Main:
main_super_star:                                ; Raidenthequick: main_super_star
;$0298F4
	LDA.b $18,x
	ASL
	TXY
	TAX
	JMP.w (DATA_super_star_state_ptr,x)

DATA_0298FC:
DATA_super_star_state_ptr:                             ; 2-entry $76,x sub-state dispatch
	dw CODE_super_star_state_00_idle_pickup                                ;  0: idle, watch for Yoshi pickup
	dw CODE_super_star_state_01_transform_to_super_baby_mario                                ;  1: collected, transform-to-SuperBabyMario timer

CODE_029900:
CODE_super_star_state_00_idle_pickup:
	TYX
	JSL.l CODE_03AA2E
	JSL.l CODE_03AF23
	LDA.w $7542,x
	BNE.b CODE_02991D
	LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerForm10_SuperBabyMario
	BEQ.b CODE_02991D
	JSL.l CODE_0298E8
	JMP.w CODE_029888

CODE_02991D:
	JSL.l CODE_029BCA
	LDY.w $7D36,x
	BPL.b CODE_02998C
	LDA.w $7680,x
	CLC
	ADC.w #$0020
	CMP.w #$0120
	BCS.b CODE_02998C
	LDA.w $7682,x
	CLC
	ADC.w #$0020
	CMP.w #$0100
	BCS.b CODE_02998C
	LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	BEQ.b CODE_029951
	LDA.w #!Define_YI_SoundID27_CollectSuperStar
	JSL.l CODE_push_sound_queue
	JSL.l CODE_03A31E
	JMP.w CODE_029A50

CODE_029951:
	LDA.w $61B2
	BPL.b CODE_02998C
	LDA.w $6150
	BEQ.b CODE_02996D
	LDA.w $6162
	BEQ.b CODE_02996D
	LDA.w !EXRAM_YI_Level_Player_AmmoTypeInMouthLo|!EXRAMBankMirror
	CMP.w #$0001
	BEQ.b CODE_02998C
	CMP.w #$0004
	BEQ.b CODE_02998C
CODE_02996D:
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	LDA.w #$00FF
	STA.w $74A2,x
	LDA.w $7040,x
	AND.w #$FFF3
	STA.w $7040,x
	LDA.w #$0020
	STA.w $7A96,x
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	RTL

CODE_02998C:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_02999A
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_02999A:
	RTL

DATA_02999B:
	dw $0100,$FF00

CODE_02999F:
CODE_super_star_state_01_transform_to_super_baby_mario:
	TYX
	LDA.w $7A96,x
	BEQ.b CODE_0299C6
	DEC.w $7A96,x
	CMP.w #$0010
	BNE.b CODE_0299C5
	LDA.w #!Define_YI_SoundID05_Powerup
	JSL.l CODE_push_sound_queue
	LDA.w $7CD6
	STA.b $00
	LDA.w $7CD8
	STA.b $02
	LDA.w #$01E7
	JSL.l CODE_03B577
CODE_0299C5:
	RTL

CODE_0299C6:
	LDA.w #$2000
	STA.w $61B2
	LDA.w #$FFFF
	STA.w $7E48
	JSL.l CODE_04F74A
	LDA.w #!Define_YI_PlayerForm10_SuperBabyMario
	STA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	LDA.w #$0010
	TSB.w $7E08
	LDA.w #$0116
	STA.w $60BE
	LDA.w #$0008
	STA.w $60C0
	LDA.w #$FC00
	STA.w $60AA
	LDA.w $60C4
	EOR.w #$0002
	STA.w $60C4
	STA.w $7400
	TAY
	LDA.w DATA_02999B,y
	STA.w $60B4
	STZ.w $60D2
	STZ.w $61DC
	REP.b #$10
	JSL.l CODE_04EF27
	SEP.b #$10
	JSL.l CODE_03A31E
	PHX
	LDA.w #$0029
	LDY.b #$00
	TYX
	STX.b $12
	JSL.l CODE_spawn_sprite
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	LDA.w $7182
	SEC
	SBC.w #$0008
	STA.w $7182
	JSL.l CODE_03BEB9
	PLX
	LDA.w #FXDATA_520000+$B600
	STA.w $6114
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDA.w #!Define_YI_MusicID02_StoryAndLevelTheme
	STA.w !RAM_YI_Global_PlayMusicLo
	STZ.w $0205
CODE_029A50:
	LDA.w #$0200
	STA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Full Egg Spawner (sprite $0AB) -- placed by levels (typically before a
; boss fight) to top Yoshi's egg trail back up to 6 eggs.
; Raidenthequick: init_full_eggs / main_full_eggs.
;-------------------------------------------------------------------------
YI_NorSpr0AB_FullEggSpawner_Init:
init_full_eggs:                                 ; Raidenthequick: init_full_eggs
;$029A57
	RTL

;---------------------------------------------------------------------------

YI_NorSpr0AB_FullEggSpawner_Main:
main_full_eggs:                                 ; Raidenthequick: main_full_eggs
;$029A58
	JSL.l CODE_03B69D
	LDA.w $7542,x
	BNE.b CODE_029A6E
	LDA.w #!Define_YI_SoundID3A_StompShyGuy
	JSL.l CODE_push_sound_queue
	LDA.w #$0040
	STA.w $7542,x
CODE_029A6E:
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CMP.w #$0010
	BMI.b CODE_029AC5
	LDA.w #$0025
	JSL.l CODE_spawn_sprite_active
	BCS.b CODE_029A9B
	LDA.w #$0025
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0010
	STA.w $7182,x
	JSL.l CODE_03BEB9
	BRA.b CODE_029AC2

CODE_029A9B:
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0010
	STA.w $7182,y
	PHX
	TYX
	STX.b $12
	JSL.l CODE_03BEB9
	PLX
	STX.b $12
	LDA.w $7DF6
	CMP.w #$000C
	BCC.b CODE_029AC6
	JSL.l CODE_03A31E
CODE_029AC2:
	STZ.w !RAM_YI_Level_ItemBeingUsed
CODE_029AC5:
	RTL

CODE_029AC6:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0020
	STA.w $7182,x
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	JML.l CODE_0280AC

;---------------------------------------------------------------------------

DATA_029AE3:
	dw $000F,$0003,$000F,$0405,$000F,$0A07,$010F,$0E0B
	dw $020F,$0203,$020F,$0605,$020F,$0C07,$040F,$0805
	dw $050F,$0E01,$060F,$0E06,$0B0F,$080A,$0C0F,$0E00
	dw $100F,$0009,$100F,$040B,$100F,$0A0D,$110F,$0E06
	dw $120F,$0209,$120F,$060B,$120F,$0C0D,$170F,$0802
	dw $190F,$0809,$1D0F,$0E05
	db $FF

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Background-for-Hookbill-Fight (sprite $0D5) -- the BG that scrolls during
; the Hookbill the Koopa boss fight.  Init empty (BG layer pre-loaded).
; Raidenthequick: init_hookbill_background / main_hookbill_background.
; See docs/bossengine.md.
;-------------------------------------------------------------------------
YI_NorSpr0D5_BackgroundForHookbillFight_Init:
init_hookbill_background:                       ; Raidenthequick: init_hookbill_background
;$029B3C
	RTL

;---------------------------------------------------------------------------

DATA_029B3D:
	dw $7FFF,$7FFF,$7FFF,$7FFF

;-------------------------------------------------------------------------
; Main for Background-for-Hookbill-Fight (sprite $0D5).
; Per-frame: programs SuperFX (FXCODE_089183) to redraw the curved/scrolled
; BG using R1=layer1-x/2 as PLOT origin.  On state $18,x != 0 the SuperFX
; FXCODE_08E167 path paints the cracking-floor animation.
;-------------------------------------------------------------------------
YI_NorSpr0D5_BackgroundForHookbillFight_Main:
main_hookbill_background:                       ; Raidenthequick: main_hookbill_background
;$029B45
	LDA.b $18,x
	BNE.b CODE_029B85
	LDA.w !RAM_YI_Global_Layer1XPosLo
	LSR
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #DATA_029AE3
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	STZ.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w $6092
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #DATA_029AE3>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7180,x
	AND.w #$00FF
	ASL
	ASL
	ASL
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDX.b #FXCODE_089183>>16
	LDA.w #FXCODE_089183
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_029B85:
	JSL.l CODE_03AF23
	LDA.w $0B59
	LSR
	BEQ.b CODE_029BC9
	LDA.w #DATA_029B3D
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_029B3D>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.b $76,x
	CLC
	ADC.w #$0008
	CMP.w #$0100
	BCC.b CODE_029BAD
	JSL.l CODE_03A31E
	LDA.w #$0100
CODE_029BAD:
	STA.b $76,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$00FC
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0004
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08E167>>16
	LDA.w #FXCODE_08E167
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_029BC9:
	RTL

CODE_029BCA:
	LDA.w $7A96,x
	BEQ.b CODE_029BD0
	RTL

CODE_029BD0:
	LDA.w #$0005
	STA.w $7A96,x
	LDA.w #$0808
CODE_029BD9:
	PHA
	AND.w #$00FF
	STA.b $00
	JSL.l CODE_random_number_gen
	LDA.b $0F
	AND.w #$FF00
	ORA.b $00
	STA.w !REGISTER_Multiplicand
	PLA
	AND.w #$FF00
	STA.b $02
	LDA.b $11
	LSR
	LDA.w !REGISTER_ProductOrRemainderHi
	AND.w #$00FF
	BCC.b CODE_029C01
	EOR.w #$FFFF
CODE_029C01:
	ADC.w $70E2,x
	STA.b $00
	JSL.l CODE_random_number_gen
	LDA.b $10
	AND.w #$00FF
	ORA.b $02
	STA.w !REGISTER_Multiplicand
	NOP #2
	LDA.b $11
	LSR
	LDA.w !REGISTER_ProductOrRemainderHi
	AND.w #$00FF
	BCC.b CODE_029C24
	EOR.w #$FFFF
CODE_029C24:
	ADC.w $7182,x
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1DD
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	STA.w $70A2,y
	LDA.b $02
	STA.w $7142,y
	LDA.w #$0004
	STA.w $7E4C,y
	LDA.w #$0006
	STA.w $7782,y
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Chomp Warning Signboard (sprite $0D8) -- the "!" sign hung in levels with
; incoming Chomps to telegraph the danger zone.
; Raidenthequick: init_chomp_signboard / main_chomp_signboard.
;-------------------------------------------------------------------------
YI_NorSpr0D8_ChompWarningSign_Init:
init_chomp_signboard:                           ; Raidenthequick: init_chomp_signboard
;$029C47
	JSL.l CODE_03AE60
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #FXDATA_548000+$00C1
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$00C1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088293>>16
	LDA.w #FXCODE_088293
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

YI_NorSpr0D8_ChompWarningSign_Main:
main_chomp_signboard:                           ; Raidenthequick: main_chomp_signboard
;$029C87
	JML.l CODE_03AA52

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Falling Rock Platform (sprite $0DE) -- a stone slab that drops on a timer
; once Yoshi gets near.  Shares core logic with stones $137-$13A below.
; Raidenthequick: init_falling_rock / main_falling_rock_common.
;-------------------------------------------------------------------------
YI_NorSpr0DE_FallingRockPlatform_Init:
init_falling_rock:                              ; Raidenthequick: init_falling_rock
;$029C8B
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0ACD1E>>16
	LDA.w #FXCODE_0ACD1E
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	BNE.b CODE_029CAE
	STZ.w $61C0
	JML.l CODE_03A31E

CODE_029CAE:
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $70E2,x
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	INC
	STA.w $7182,x
	LDA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	STA.b $76,x
	LSR
	STA.w $7BB6,x
	LDA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	STA.b $78,x
	LSR
	INC
	STA.w $7BB8,x
	LDA.w #$0008
	STA.w $7B56,x
	STA.w $7B58,x
	LDA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	ASL
	ASL
	ASL
	XBA
	ORA.w $7040,x
	STA.w $7040,x
	LDA.w #$0070
	STA.w $7A96,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr0DE_FallingRockPlatform_Main:
main_falling_rock_common:                       ; Raidenthequick: main_falling_rock_common
;$029CEB
	JSR.w CODE_029DF6
	LDA.b $18,x
	BNE.b CODE_029D54
	LDA.b $76,x
	SEC
	SBC.w #$0010
	LSR
	EOR.w #$FFFF
	SEC
	ADC.w $70E2,x
	CLC
	ADC.w $7A36,x
	STA.w $0091
	LDA.b $78,x
	SEC
	SBC.w #$0010
	LSR
	EOR.w #$FFFF
	SEC
	ADC.w $7182,x
	CLC
	ADC.w $7A38,x
	STA.w $0093
	LDA.w #$0001
	STA.w $008F
	LDA.w #$0000
	STA.w $0095
	JSL.l CODE_change_map16
	LDX.b $12
	LDA.w $7A36,x
	CLC
	ADC.w #$0010
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	BCC.b CODE_029D51
	LDA.w $7A38,x
	CLC
	ADC.w #$0010
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	BCC.b CODE_029D4B
	INC.b $18,x
	STZ.w $61C0
CODE_029D4B:
	STA.w $7A38,x
	LDA.w #$0000
CODE_029D51:
	STA.w $7A36,x
CODE_029D54:
	JSL.l CODE_03AF23
	LDA.b $18,x
	BEQ.b CODE_029DC6
	LDA.w $7E2A
	BEQ.b CODE_029D6D
	TXA
	LSR
	LSR
	TAY
	LDA.w $0C98,y
	AND.w #$00FF
	BNE.b CODE_029D9B
CODE_029D6D:
	LDA.b $76,x
	LSR
	ADC.w #$0018
	ADC.w $7680,x
	BMI.b CODE_029D97
	SEC
	SBC.b $76,x
	BCC.b CODE_029D9B
	CMP.w #$0120
	BCS.b CODE_029D97
	LDA.b $78,x
	LSR
	ADC.w #$0018
	ADC.w $7682,x
	BMI.b CODE_029D97
	SEC
	SBC.b $78,x
	BCC.b CODE_029D9B
	CMP.w #$0100
	BCC.b CODE_029D9B
CODE_029D97:
	JML.l CODE_03A31E

CODE_029D9B:
	LDA.w $7A96,x
	DEC
	CMP.w #$0050
	BCS.b CODE_029DC6
	CMP.w #$0040
	BNE.b CODE_029DAF
	LDA.w #$0004
	STA.w $7542,x
CODE_029DAF:
	LDA.b $14
	LSR
	BCC.b CODE_029DC6
	LDA.w $70E2,x
	EOR.w #$0001
	PHA
	SEC
	SBC.w $70E2,x
	STA.w $72C0,x
	PLA
	STA.w $70E2,x
CODE_029DC6:
	JML.l CODE_03D05D

;---------------------------------------------------------------------------

DATA_029DCA:
	dw !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,$7901,$7902,$7909,$790A,$790B,$7903,$7904
	dw $7905,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $7906,$7907,$7908,$0000,$0000,$0000

CODE_029DF6:
	LDA.w $7362,x
	BMI.b CODE_029E34
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7680,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7682,x
	DEC
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.b $78,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7180,x
	AND.w #$00FF
	ASL
	ASL
	ASL
	XBA
	ORA.w $7042,x
	XBA
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDX.b #FXCODE_099126>>16
	LDA.w #FXCODE_099126
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_029E34:
	RTS

;---------------------------------------------------------------------------

DATA_029E35:
	dw $0000,$0000,$0000,$0008

DATA_029E3D:
	dw $FFD8,$FFF0,$FFC0,$FFF0

DATA_029E45:
	dw $0030,$0030,$0030,$0060

DATA_029E4D:
	dw $0060,$0030,$0090,$0030

;-------------------------------------------------------------------------
; Four sized variants of the Falling Stone object (sprites $137-$13A).
; All four share Init and Main; sprite ID picks the bounding box and tile gfx.
; Raidenthequick: init_falling_rock_common.
;
; See docs/family-hazards.md §5 for the full falling-stones breakdown.
; The hitbox encoding $30/$60/$90 literally means "3/6/9 tiles" --
; sprite-ID arithmetic picks one of four (X-width, Y-width) pairs
; from DATA_029E45 / DATA_029E4D. Bonus: $0DE FallingRockPlatform
; (Bank02:2927 init) ALSO shares this Main body byte-identically;
; only its Init differs (probes floor via SuperFX rather than
; per-variant table lookup). And the rock subtly homes in on Yoshi
; during the last 80 frames before falling -- a $14 LSR BCC gate at
; Bank02.asm:3083-3093 nudges X toward Yoshi once $7A96,x < $50.
;-------------------------------------------------------------------------
YI_NorSpr137_3x6FallingStone_Init:
YI_NorSpr138_3x3FallingStone_Init:
YI_NorSpr139_3x9FallingStone_Init:
YI_NorSpr13A_6x3FallingStone_Init:
init_falling_rock_common:                       ; Raidenthequick: init_falling_rock_common
;$029E55
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr137_3x6FallingStone
	ASL
	TAY
	LDA.w $70E2,x
	CLC
	ADC.w DATA_029E35,y
	STA.w $70E2,x
	LDA.w $7182,x
	CLC
	ADC.w DATA_029E3D,y
	STA.w $7182,x
	LDA.w DATA_029E45,y
	STA.b $76,x
	LSR
	STA.w $7BB6,x
	LDA.w DATA_029E4D,y
	STA.b $78,x
	LSR
	INC
	STA.w $7BB8,x
	LDA.w #$0008
	STA.w $7B56,x
	STA.w $7B58,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr137_3x6FallingStone_Main:
YI_NorSpr138_3x3FallingStone_Main:
YI_NorSpr139_3x9FallingStone_Main:
YI_NorSpr13A_6x3FallingStone_Main:
;$029E8F
	JSR.w CODE_029DF6
	LDA.b $18,x
	BEQ.b CODE_029E99
	JMP.w CODE_029F33

CODE_029E99:
	JSL.l CODE_03AF23
	LDA.w $7CD7,x
	AND.w #$000F
	STA.b $00
	LDA.b $78,x
	LSR
	STA.b $02
	LDA.w $7CD8,x
	SEC
	SBC.b $02
	CMP.w #$0800
	BCS.b CODE_029EC4
	AND.w #$0700
	LSR
	LSR
	LSR
	LSR
	ORA.b $00
	TAY
	LDA.w $6CA9,y
	BPL.b CODE_029EC8
CODE_029EC4:
	JML.l CODE_despawn_sprite_free_slot

CODE_029EC8:
	LDA.b $76,x
	LSR
	PHA
	EOR.w #$FFFF
	SEC
	ADC.w $7CD6,x
	CLC
	ADC.w #$0008
	STA.b $00
	LDA.b $02
	CLC
	ADC.w $7CD8,x
	STA.b $02
	PLA
	LSR
	LSR
	LSR
	STA.b $04
CODE_029EE7:
	LDA.b $00
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b $02
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$0003
	BNE.b CODE_029F13
	LDA.b $00
	CLC
	ADC.w #$0010
	STA.b $00
	DEC.b $04
	BNE.b CODE_029EE7
	LDX.b $12
	JMP.w CODE_029FD0

CODE_029F13:
	LDA.w #!Define_YI_SoundID48_LargeBlockLands
	JSL.l CODE_push_sound_queue
	LDX.b $12
	INC.b $18,x
	LDA.w $7182,x
	AND.w #$FFF8
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $61C6
	JMP.w CODE_029FD0

CODE_029F33:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	LSR
	STA.w !REGISTER_Multiplicand
	LDA.w $7A38,x
	LSR
	LSR
	LSR
	LSR
	STA.w !REGISTER_Multiplier
	LDA.b $76,x
	LSR
	EOR.w #$FFFF
	SEC
	ADC.w $7CD6,x
	CLC
	ADC.w $7A36,x
	STA.w $0091
	LDA.b $78,x
	LSR
	EOR.w #$FFFF
	SEC
	ADC.w $7CD8,x
	CLC
	ADC.w $7A38,x
	STA.w $0093
	LDA.w #$0001
	STA.w $008F
	LDA.w $7A36,x
	LSR
	ADC.w !REGISTER_ProductOrRemainderLo
	CLC
	ADC.w $7362,x
	REP.b #$10
	TAY
	LDA.w $6004,y
	SEP.b #$10
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BPL.b CODE_029F96
	AND.w #$7FFF
	CMP.w #$0020
	BCC.b CODE_029F90
	SBC.w #$0010
CODE_029F90:
	CLC
	ADC.w #$0014
	BRA.b CODE_029F9E

CODE_029F96:
	CMP.w #$0020
	BCC.b CODE_029F9E
	SBC.w #$0010
CODE_029F9E:
	TAY
	LDA.w DATA_029DCA,y
	STA.w $0095
	JSL.l CODE_change_map16
	LDX.b $12
	LDA.w $7A36,x
	CLC
	ADC.w #$0010
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	BCC.b CODE_029FCD
	LDA.w $7A38,x
	CLC
	ADC.w #$0010
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	BCC.b CODE_029FC7
	JML.l CODE_despawn_sprite_free_slot

CODE_029FC7:
	STA.w $7A38,x
	LDA.w #$0000
CODE_029FCD:
	STA.w $7A36,x
CODE_029FD0:
	JSL.l CODE_03D05D
	LDY.w $7D36,x
	DEY
	BMI.b CODE_029FE3
	BEQ.b CODE_029FE3
	TYX
	JSL.l CODE_039F91
	LDX.b $12
CODE_029FE3:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Key (sprite $027) -- collectible that opens an adjacent Locked Door.
; Raidenthequick: init_key / main_key.
;-------------------------------------------------------------------------
YI_NorSpr027_Key_Init:
init_key:                                       ; Raidenthequick: init_key
;$029FE4
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	ORA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_02A006
	JSL.l CODE_03D3F8
	BEQ.b CODE_029FF6
	JML.l CODE_despawn_sprite_free_slot

CODE_029FF6:
	JSL.l CODE_02A007
	LDA.w $70E2,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $7182,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_02A006:
	RTL

CODE_02A007:
CODE_init_ice_block_snap:                       ; shared Init prologue: probe the sprite's own cell (FXCODE_0ACE2F); if the page's collision secondary-tag is $17 = ice-block (R7 & $F800 == $B800, pages $89/$8C), centre the sprite inside the ice cube + force a re-init -- the frozen-enemy set-piece of 5-3. NOT a "$B8xx keyhole snap" (old misreading -- R7 is the attribute word, not the tile id). See docs/sprite-neighbor-dependencies.md Class B.
	LDA.w $70E2,x
	AND.w #$FFF0
	ORA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	AND.w #$FFF0
	ORA.w #$0008
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$F800
	CMP.w #$B800
	BNE.b CODE_02A049
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w $6000
	STA.w $70E2,x
	LDA.w $6002
	STA.w $7182,x
	PLA
	PLY
CODE_02A049:
	RTL

;---------------------------------------------------------------------------

YI_NorSpr027_Key_Main:
main_key:                                       ; Raidenthequick: main_key
;$02A04A
	LDA.w $7D38,x
	BEQ.b CODE_02A059
	LDA.b $18,x
	CMP.w #$0002
	BCC.b CODE_02A059
	STZ.w $7D38,x
CODE_02A059:
	JSL.l CODE_03B9DD
	LDA.b $78,x
	BEQ.b CODE_02A064
	JMP.w CODE_02A099

CODE_02A064:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_02A070
	JSL.l CODE_03A58B
CODE_02A070:
	LDY.w $7D36,x
	BPL.b CODE_02A08C
	LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	BNE.b CODE_02A08C
	JSL.l CODE_03C640
	JSL.l CODE_03BEB9
	DEC.w !RAM_YI_Global_SoundQueueSizeLo
	LDA.w #!Define_YI_SoundID1E_PickUpKey
	JML.l CODE_push_sound_queue

CODE_02A08C:
	LDA.w $7182,x
	CMP.w #$0800
	BMI.b CODE_02A098
	JML.l CODE_03A31E

CODE_02A098:
	RTL

CODE_02A099:
	JSL.l CODE_03BB1D
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Door family inits (sprites $001 ClosedDoor, $012 BossDoor, $04E LockedDoor,
; $093 Door, $0CA BigBossDoor for Bowser, $131 LockedDoor variant).
; All share a single Main block (CODE chain below).
; Raidenthequick: init_boss_door_bowser / init_locked_door / CODE_init_locked_door_2 /
;                init_closed_door / CODE_init_door.
;
; See docs/family-misc.md §1 for the full Door family breakdown (6 sprites
; sharing main_door, plus the inverted-polarity key-flag check between $04E
; permanent-lock and $131 flow-lock, and the $0CA Big Boss Door double-wide
; FX tilemap).
;-------------------------------------------------------------------------
YI_NorSpr0CA_BigBossDoor_Init:
init_boss_door_bowser:                          ; Raidenthequick: init_boss_door_bowser
;$02A09E
	JSL.l CODE_03AEBE
	JSL.l CODE_02A153
	LDA.w $70E2,x
	ORA.w #$0008
	STA.w $70E2,x
	LDA.w #$001C
	STA.w $7BB6,x
	LDA.w #$0039
	STA.w $7BB8,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr04E_LockedDoor_Init:
init_locked_door:                               ; Raidenthequick: init_locked_door
;$02A0BC
	JSL.l CODE_03D3F8
	BEQ.b CODE_init_locked_door_2
	LDA.w #!Define_YI_NorSpr001_ClosedDoor
	STA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,x
	BRA.b YI_NorSpr001_ClosedDoor_Init

YI_NorSpr131_LockedDoor_Init:
CODE_init_locked_door_2:                             ; Raidenthequick: CODE_init_locked_door_2
CODE_02A0D4:
	JSL.l CODE_03D3F8
	BNE.b CODE_02A0DF
	INC.w $7A36,x
	BRA.b CODE_02A134

CODE_02A0DF:
	LDA.w #!Define_YI_NorSpr093_Door
	STA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	BRA.b CODE_02A134

YI_NorSpr001_ClosedDoor_Init:
init_closed_door:                               ; Raidenthequick: init_closed_door
;$02A0E7
	LDA.w #$0003
	STA.b $18,x
	LDA.w !RAM_YI_Global_CurrentGameMode
	CMP.w #!Define_YI_GameMode0D
	BNE.b CODE_init_door
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CMP.w $70E2,x
	BNE.b CODE_init_door
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	ADC.w #$000F
	CMP.w $7182,x
	BNE.b CODE_init_door
	LDA.w #$7005
	STA.w $7040,x
	LDA.w #$0002
	STA.b $18,x
	INC.w $7402,x
	LDA.w #$0020
	STA.b $76,x
	LDA.w #$0004
	STA.b $78,x
	LDA.w #$0040
	STA.w $7A96,x
YI_NorSpr012_BossDoor_Init:
YI_NorSpr093_Door_Init:
CODE_init_door:                                      ; Raidenthequick: CODE_init_door
CODE_02A125:
	LDA.w $7722,x
	BPL.b CODE_02A13E
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,x
CODE_02A134:
	JSL.l CODE_03AE60
	JSL.l CODE_02A153
	BRA.b CODE_02A142

CODE_02A13E:
	JSL.l CODE_02A1FD
CODE_02A142:
	JSL.l CODE_02A007
	LDA.w #$000C
	STA.w $7BB6,x
	LDA.w #$0019
	STA.w $7BB8,x
	RTL

;---------------------------------------------------------------------------

CODE_02A153:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr04E_LockedDoor
	BEQ.b CODE_02A190
	CMP.w #!Define_YI_NorSpr131_LockedDoor
	BEQ.b CODE_02A190
	CMP.w #!Define_YI_NorSpr093_Door
	BEQ.b CODE_02A185
	CMP.w #!Define_YI_NorSpr0CA_BigBossDoor
	BEQ.b CODE_02A1C2
	CMP.w #!Define_YI_NorSpr012_BossDoor
	BNE.b CODE_02A17A
	LDA.w #FXDATA_550000+$60C0
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #(FXDATA_550000+$60C0)>>16
	BRA.b CODE_02A199

CODE_02A17A:
	LDA.w #FXDATA_550000+$0021
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #FXDATA_550000>>16
	BRA.b CODE_02A199

CODE_02A185:
	LDA.w #FXDATA_540000+$00F1
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #(FXDATA_540000+$00F1)>>16
	BRA.b CODE_02A199

CODE_02A190:
	LDA.w #FXDATA_550000+$6000
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #(FXDATA_550000+$6000)>>16
CODE_02A199:
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w $6000
	LDA.l DATA_03A9EE,x
	STA.w $6002
	LDX.b #FXCODE_08D317>>16
	LDA.w #FXCODE_08D317
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTL

CODE_02A1C2:
	LDA.w #FXDATA_550000+$60C0
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #(FXDATA_550000+$60C0)>>16
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w $6000
	LDA.l DATA_03A9EE,x
	STA.w $6002
	LDX.b #FXCODE_08D317>>16
	LDA.w #FXCODE_08D317
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b #FXCODE_09F897>>16
	LDA.w #FXCODE_09F897
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

CODE_02A1FD:
	REP.b #$10
	LDY.w $7362,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0CA_BigBossDoor
	BEQ.b CODE_02A247
CODE_02A20A:
	LDA.w $7722,x
	TAX
	LDA.w $6004,y
	AND.w #$FE00
	ORA.l DATA_03AA0E,x
	STA.w $6004,y
	LDA.w $600C,y
	AND.w #$FE00
	ORA.l DATA_03AA0E,x
	STA.w $600C,y
	LDA.w $6014,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$04,x
	STA.w $6014,y
	LDA.w $601C,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$04,x
	STA.w $601C,y
	SEP.b #$10
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

CODE_02A247:
	LDA.w $7722,x
	TAX
	LDA.w $6004,y
	AND.w #$FE00
	ORA.l DATA_03AA0E,x
	STA.w $6004,y
	LDA.w $600C,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$02,x
	STA.w $600C,y
	LDA.w $6014,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$04,x
	STA.w $6014,y
	LDA.w $601C,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$06,x
	STA.w $601C,y
	LDA.w $6024,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$08,x
	STA.w $6024,y
	LDA.w $602C,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$0A,x
	STA.w $602C,y
	LDA.w $6034,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$0C,x
	STA.w $6034,y
	LDA.w $603C,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$0E,x
	STA.w $603C,y
	LDA.w $6044,y
	AND.w #$FE00
	ORA.l DATA_03AA0E,x
	STA.w $6044,y
	LDA.w $604C,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$02,x
	STA.w $604C,y
	LDA.w $6054,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$04,x
	STA.w $6054,y
	LDA.w $605C,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$06,x
	STA.w $605C,y
	LDA.w $6064,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$08,x
	STA.w $6064,y
	LDA.w $606C,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$0A,x
	STA.w $606C,y
	LDA.w $6074,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$0C,x
	STA.w $6074,y
	LDA.w $607C,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$0E,x
	STA.w $607C,y
	SEP.b #$10
CODE_02A31D:
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

DATA_02A320:
	dw $0001,$FFFF,$0008,$FFF8

DATA_02A328:
	dw $0040,$0020,$0040,$0000

;-------------------------------------------------------------------------
; Shared Main for all door variants.  Branches on door state to play the
; open animation, fade the screen, and trigger the screen-exit when Yoshi
; walks into the open doorway.  Raidenthequick: main_door.
;-------------------------------------------------------------------------
YI_NorSpr001_ClosedDoor_Main:
YI_NorSpr012_BossDoor_Main:
YI_NorSpr04E_LockedDoor_Main:
YI_NorSpr093_Door_Main:
YI_NorSpr0CA_BigBossDoor_Main:
YI_NorSpr131_LockedDoor_Main:
main_door:                                      ; Raidenthequick: main_door
;$02A330
	JSL.l CODE_02A1FD
	LDY.b $18,x
	BEQ.b CODE_02A33B
	JMP.w CODE_02A3F0

CODE_02A33B:
	JSL.l CODE_03AF23
	LDA.w $60C0
	BNE.b CODE_02A34C
	LDA.w $7182,x
	CMP.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	BEQ.b CODE_02A34D
CODE_02A34C:
	RTL

CODE_02A34D:
	LDA.w $7C16,x
	CLC
	ADC.w $7BB6,x
	CMP.w $7BB8,x
	BCS.b CODE_02A34C
	LDA.w $0038
	AND.w #$0008
	BEQ.b CODE_02A34C
	LDA.w $61B2
	BPL.b CODE_02A34C
	LDA.w $6150
	BNE.b CODE_02A34C
	LDA.w $7A36,x
	BEQ.b CODE_02A3A7
	LDY.w $7DF6
	BEQ.b CODE_02A34C
	LDA.w $7DF6,y
	TAY
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr027_Key
	BEQ.b CODE_02A388
	LDA.w #!Define_YI_SoundID38_BabyMarioJump
	JML.l CODE_push_sound_queue

CODE_02A388:
	TYX
	JSL.l CODE_03BF87
	JSL.l CODE_03A31E
	LDA.w #!Define_YI_SoundID64_UnlockDoor
	JSL.l CODE_push_sound_queue
	LDX.b $12
	JSL.l CODE_03D3EB
	JSL.l CODE_02A4F4
	LDA.w #$0040
	BRA.b CODE_02A3AA

CODE_02A3A7:
	LDA.w #$0002
CODE_02A3AA:
	STA.w $7A96,x
	INC.b $18,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr0CA_BigBossDoor
	BEQ.b CODE_02A3BD
	LDA.w #$7005
	STA.w $7040,x
CODE_02A3BD:
	LDA.w #!Define_YI_PlayerState0A_EnteringDoor
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $0C8C
	STZ.w $6104
	INC.w $0C8E
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr04E_LockedDoor
	BNE.b CODE_02A3D7
	DEC.w $6104
CODE_02A3D7:
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	STZ.w $60F8
	LDA.w #$0006
	STA.w $61D2
	LDA.w #$0008
	STA.w $6116
CODE_02A3EF:
	RTL

CODE_02A3F0:
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_02A3EF
	CPY.b #$03
	BEQ.b CODE_02A3EF
	LDA.w $7A96,x
	BEQ.b CODE_02A40F
	DEC.w $7A96,x
	BNE.b CODE_02A40E
	CPY.b #$02
	BEQ.b CODE_02A40E
	LDA.w #!Define_YI_SoundID40_OpenDoor
	JSL.l CODE_push_sound_queue
CODE_02A40E:
	RTL

CODE_02A40F:
	JSL.l CODE_02A153
	LDY.b $78,x
	CPY.b #$02
	BCC.b CODE_02A43B
	LDA.b $18,x
	LSR
	BNE.b CODE_02A43B
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	LDA.w $7C16,x
	BEQ.b CODE_02A436
	ASL
	LDA.w #$FFFF
	BCS.b CODE_02A42F
	LDA.w #$0001
CODE_02A42F:
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_02A436:
	LDA.w $7402,x
	BEQ.b CODE_02A43E
CODE_02A43B:
	LDA.w #$0007
CODE_02A43E:
	PHY
	LDY.w $0C8C
	BEQ.b CODE_02A447
	EOR.w #$0007
CODE_02A447:
	STA.w $74A2,x
	PLY
	LDA.b $76,x
	CLC
	ADC.w DATA_02A320,y
	STA.b $76,x
	SEC
	SBC.w DATA_02A328,y
	EOR.w DATA_02A320,y
	BMI.b CODE_02A4B4
	TYA
	LSR
	LSR
	BCS.b CODE_02A47B
	LDA.b $76,x
	SEC
	SBC.w #$003F
	EOR.w #$FFFF
	SEC
	ADC.w #$0040
	STA.b $76,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
	BRA.b CODE_02A480

CODE_02A47B:
	LDA.w DATA_02A328,y
	STA.b $76,x
CODE_02A480:
	INY
	INY
	CPY.b #$08
	BCC.b CODE_02A4F0
	LDA.w #!Define_YI_SoundID41_CloseDoor
	JSL.l CODE_push_sound_queue
	LDA.b $18,x
	LSR
	BNE.b CODE_02A4E7
	LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	BEQ.b CODE_02A4A2
	STZ.w $0C8E
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	STZ.w $0C8C
	BRA.b CODE_02A4E7

CODE_02A4A2:
	LDA.w $6104
	BEQ.b CODE_02A4B5
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	INC.w $0C8C
	LDA.w #$0001
	STA.b $18,x
	STZ.b $78,x
CODE_02A4B4:
	RTL

CODE_02A4B5:
	LDA.w !EXRAM_YI_Player_XPosHi|!EXRAMBankMirror
	AND.w #$000F
	ASL
	ASL
	STA.w $0000
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	AND.w #$0F00
	LSR
	LSR
	ORA.w $0000
CODE_02A4CB:
	STA.w $038E
	LDA.w #!Define_YI_SoundID22_EndFuzzyDistortedMusic
	STA.w !RAM_YI_Global_PlaySoundHighPriorityLo
	LDA.w #$0001
	STA.w $038C
	LDA.w #!Define_YI_GameMode0B
	STA.w !RAM_YI_Global_CurrentGameMode
	JSL.l CODE_save_egg_inventory
	LDX.b $12
	RTL

CODE_02A4E7:
	INC.b $18,x
	LDA.w #$2005
	STA.w $7040,x
	RTL

CODE_02A4F0:
	TYA
	STA.b $78,x
	RTL

;---------------------------------------------------------------------------

CODE_02A4F4:
	LDA.w #!Define_YI_AmbSpr1CD
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$000B
	STA.w $7E4C,y
	STA.w $7E4E,y
	LDA.w #$0004
	STA.w $7782,y
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Teleport Sprite (sprite $084) -- invisible trigger that warps Yoshi to
; the screen-exit pointed to by the level header.
; Raidenthequick: init_teleport_sprite / main_teleport_sprite.
;-------------------------------------------------------------------------
YI_NorSpr084_TeleportSprite_Init:
init_teleport_sprite:                           ; Raidenthequick: init_teleport_sprite
;$02A517
	RTL

;---------------------------------------------------------------------------

YI_NorSpr084_TeleportSprite_Main:
main_teleport_sprite:                           ; Raidenthequick: main_teleport_sprite
;$02A518
	JSL.l CODE_03AF23
	LDY.w $7D36,x
	BPL.b CODE_02A52B
	LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	BNE.b CODE_02A4B5
	LDA.w $61B2
	BMI.b CODE_02A4B5
CODE_02A52B:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Goal Ring (sprite $00D) -- the spinning "Goal!" hoop at the end of each level.
; Plays the end-of-level sequence, rolls the roulette-style bonus item, etc.
; Raidenthequick: init_goal / main_goal.  Sounds dispatched via goal_sounds table
; (Raidenthequick name) co-located near $02B5A0.
;-------------------------------------------------------------------------
YI_NorSpr00D_GoalRing_Init:
init_goal:                                      ; Raidenthequick: init_goal
;$02A52C
	JSL.l CODE_03AEBE
	STZ.w $7400,x
	LDA.w #FXDATA_540000+$4010
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$4010)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0099
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_088619>>16
	LDA.w #FXCODE_088619
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #FXDATA_550000+$60E0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$60E0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	CLC
	ADC.w #$0010
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_088619>>16
	LDA.w #FXCODE_088619
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #FXDATA_540000+$3040
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$3040)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	CLC
	ADC.w #$0010
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0099
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_088619>>16
	LDA.w #FXCODE_088619
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	LDA.w #$6000
	STA.w $7A38,x
	RTL

;---------------------------------------------------------------------------

DATA_02A5ED:
	dw $0001,$0002,$0004,$0008,$0010,$0020,$0040,$0080
	dw $0100,$0200

DATA_02A601:
	dw $0000,$0200,$0280,$02A0,$02A8,$02AA

DATA_02A60D:
	db !Define_YI_SoundID51_ThunderLakituAttacking1,!Define_YI_SoundID52_ThunderLakituAttacking2
	db !Define_YI_SoundID53_ThunderLakituAttacking3,!Define_YI_SoundID54_ThunderLakituAttacking4
	db !Define_YI_SoundID55_ThunderLakituAttacking5,!Define_YI_SoundID56_ThunderLakituAttacking6
	db !Define_YI_SoundID55_ThunderLakituAttacking5,!Define_YI_SoundID54_ThunderLakituAttacking4
	db !Define_YI_SoundID53_ThunderLakituAttacking3,!Define_YI_SoundID52_ThunderLakituAttacking2

YI_NorSpr00D_GoalRing_Main:
main_goal:                                      ; Raidenthequick: main_goal
;$02A617
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_02A663
	LDA.w $0B57
	CMP.w #$0003
	BNE.b CODE_02A63F
	INC.w $0B57
	INC.w $0B57
	REP.b #$10
	LDA.w #$0020
	JSL.l CODE_00B753
	SEP.b #$10
	LDA.w #$D800
	STA.w $0CF9
	LDX.b $12
	BRA.b CODE_02A663

CODE_02A63F:
	LDY.b $79,x
	TYA
	EOR.w #$FFFF
	SEC
	ADC.w #$000A
	STA.w $0B91,x
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	BEQ.b CODE_02A65D
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	LDA.w #$0002
	STA.w $7AF8,x
CODE_02A65D:
	LDA.w $7AF8,x
	STA.w $0B93,x
CODE_02A663:
	LDA.w $0B91,x
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w $0B93,x
	STA.w $600C
	LDA.w $7362,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7680,x
	CLC
	ADC.w #$0018
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7682,x
	SEC
	SBC.w #$0040
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$3000
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w !RAM_YI_Level_FlowersCollectedLo
	ASL
	TAY
	LDA.w DATA_02A601,y
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w $7722,x
	TAX
	LDA.l DATA_03AA0E,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_08E1BE>>16
	LDA.w #FXCODE_08E1BE
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !RAM_YI_Level_MessageBoxState 
	BEQ.b CODE_02A6BE
	JMP.w CODE_02A761

CODE_02A6BE:
	LDA.w $6002
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $6004
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #FXDATA_540000>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	CLC
	ADC.w #$0020
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $600A
	BMI.b CODE_02A6FF
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_088293>>16
	LDA.w #FXCODE_088293
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_02A71C

CODE_02A6FF:
	LDA.l DATA_03A9EE,x
	CLC
	ADC.w #$0010
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_088619>>16
	LDA.w #FXCODE_088619
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_02A71C:
	LDX.b $12
	LDA.w $6008
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #FXDATA_540000>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	CLC
	ADC.w #$0010
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	CLC
	ADC.w #$0010
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $6006
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_088619>>16
	LDA.w #FXCODE_088619
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
CODE_02A761:
	JSL.l CODE_03AF23
	LDA.w $0B57
	BNE.b CODE_02A786
	LDA.w $7680,x
	CLC
	ADC.w #$0060
	CMP.w #$01C0
	BCS.b CODE_02A782
	LDA.w $7682,x
	CLC
	ADC.w #$0060
	CMP.w #$01D0
	BCC.b CODE_02A786
CODE_02A782:
	JML.l CODE_03A31E

CODE_02A786:
	LDA.b $18,x
	ASL
	TXY
	TAX
	JSR.w (DATA_goal_ring_state_ptr,x)
	LDY.w $7A39,x
	TYA
	STA.b $02
	LDA.b $78,x
	STA.b $00
	CLC
	ADC.b $02
	CMP.w #$0A00
	BCC.b CODE_02A7A3
	SBC.w #$0A00
CODE_02A7A3:
	STA.b $78,x
	ORA.w #$00FF
	SEC
	SBC.b $00
	AND.w #$FF00
	BEQ.b CODE_02A7BE
	LDA.w $0B57
	BEQ.b CODE_02A7BE
	LDY.b $79,x
	LDA.w DATA_02A60D,y
	JSL.l CODE_push_sound_queue
CODE_02A7BE:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_02A7C4
CODE_02A7C3:
	RTL

CODE_02A7C4:
	CPY.b #$0B
	BCS.b CODE_02A7C3
	LDA.w $7A38,x
	BEQ.b CODE_02A83F
	SEC
	SBC.w #$0046
	BCC.b CODE_02A7ED
	CMP.w #$0300
	BCS.b CODE_02A7F0
	LDY.w !RAM_YI_Level_CurrentLevelFromMapLo
	CPY.b #!Define_YI_LevelID_PoochyAintStupid
	BNE.b CODE_02A7F0
	REP.b #$10
	LDY.w $6000
	SEP.b #$10
	BEQ.b CODE_02A7ED
	LDA.w #$0300
	BRA.b CODE_02A7F0

CODE_02A7ED:
	LDA.w #$0000
CODE_02A7F0:
	STA.w $7A38,x
	CMP.w #$0000
	BNE.b CODE_02A7C3
	LDY.w $7A36,x
	LDA.w #$0040
	STA.w $7541,y
	LDA.w $79D5,y
	STA.w $721F,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D7|!EXRAMBankMirror,y
	STA.w $7221,y
	LDA.w #$0060
	STA.w $7A98,x
	LDY.b #!Define_YI_SoundID2E_ClankSound7
	LDA.w $6000
	BEQ.b CODE_02A838
	DEC.w !RAM_YI_Level_DoBonusChallengeFlagLo
	LDA.w #!Define_YI_PlayerState24
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$0002
	STA.w $617E
	LDA.w #$0030
	STA.w $6180
	LDA.w #$000F
	JSL.l CODE_spawn_sprite_init
	LDY.b #!Define_YI_SoundID08_1up
CODE_02A838:
	TYA
	JSL.l CODE_push_sound_queue
	BRA.b CODE_02A7C3

CODE_02A83F:
	LDA.w $7A98,x
	BEQ.b CODE_02A845
	RTL

CODE_02A845:
	LDA.w !RAM_YI_Level_DoBonusChallengeFlagLo
	BMI.b CODE_02A853
	PHY
	LDA.w #!Define_YI_SoundID09_Coin
	JSL.l CODE_push_sound_queue
	PLY
CODE_02A853:
	LDA.w #$0004
	STA.w $7A98,x
	TYA
	CLC
	ADC.b $79,x
	AND.w #$00FF
	CMP.w #$000A
	BCC.b CODE_02A868
	SBC.w #$000A
CODE_02A868:
	ASL
	TAY
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	ORA.w DATA_02A5ED,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TYA
	ASL
	REP.b #$10
	TAY
	LDA.w $600E,y
	CLC
	ADC.w $6094
	STA.w $0000
	LDA.w $6010,y
	CLC
	ADC.w $609C
	STA.w $0002
	SEP.b #$10
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CPY.b #$0B
	BCC.b CODE_02A8C0
	LDA.w $6000
	BEQ.b CODE_02A8BD
	LDA.w #!Define_YI_AmbSpr1CD
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $0000
	STA.w $70A2,y
	LDA.w $0002
	STA.w $7142,y
	LDA.w #$000B
	STA.w $7E4C,y
	LDA.w #$0004
	STA.w $7782,y
	RTL

CODE_02A8BD:
	INC.w !RAM_YI_Level_DoBonusChallengeFlagLo
CODE_02A8C0:
	LDA.w #!Define_YI_AmbSpr1E4
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $0000
	STA.w $70A2,y
	LDA.w $0002
	STA.w $7142,y
	LDA.w #$000C
	STA.w $73C2,y
	LDA.w #$0008
	STA.w $7782,y
	RTL

DATA_02A8E0:
DATA_goal_ring_state_ptr:                              ; 4-entry $18,x sub-state dispatch
	dw CODE_goal_ring_state_00_spin_watch                                ;  0: spin, watch for Yoshi cross
	dw CODE_goal_ring_state_01_activate_goal                                ;  1: ring-flash + activate-goal sequence
	dw CODE_goal_ring_state_02_award_items                                ;  2: pause for collected items
	dw CODE_goal_ring_state_03_handoff_to_yoshi_at_goal                                ;  3: hand-off to YoshiAtGoal sprite

CODE_02A8E8:
CODE_goal_ring_state_00_spin_watch:                    ; idle spin; trigger flash when Yoshi passes through
	TYX
	LDA.w $70E2,x
	SEC
	SBC.w #$0080
	CMP.w !RAM_YI_Global_Layer1XPosLo
	BMI.b CODE_02A8F8
	LDA.w #$0EE0
CODE_02A8F8:
	CLC
	ADC.w #$0020
	STA.w $7E1A
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w $70E2,x
	SEC
	SBC.w #$0018
	PHA
	EOR.b $76,x
	ASL
	PLA
	STA.b $76,x
	BCC.b CODE_02A915
	BPL.b CODE_02A916
CODE_02A915:
	RTS

CODE_02A916:
	LDA.w $61B2
	BPL.b CODE_02A915
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w $7182,x
	CLC
	ADC.w #$0070
	CMP.w #$0050
	BCS.b CODE_02A915
	LDA.w #!Define_YI_MusicID05_BonusAndVictoryTheme
	STA.w !RAM_YI_Global_PlayMusicLo
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.w !RAM_YI_Global_CurrentGameMode
	INC.w $0B57
	INC.b $18,x
	LDA.w #!Define_YI_PlayerState14_ActivateGoal
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$0006
	STA.w $60DE
	STZ.w $60EC
	STZ.w $60C4
	STZ.w $60EA
	STZ.w $60E0
	STZ.w $60D4
	STZ.w $60D8
	STZ.w $0C1C
	STZ.w $0C20
	LDA.w #$0001
	STA.w $0C1E
	LDA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $0C23
	LDA.w $70E2,x
	SEC
	SBC.w #$0010
	STA.w $7E1A
	JSL.l CODE_02A98E
CODE_02A981:
	RTS

CODE_02A982:
	LDA.w #!Define_YI_MusicID_StopMusicCommand
	STA.w !RAM_YI_Global_PlayMusicLo
	INC.w $0B59
	INC.w $0B7B
CODE_02A98E:
	JSL.l CODE_04F74D
	LDX.w $7DF6
CODE_02A995:
	DEX
	DEX
	BMI.b CODE_02A9AE
	STX.b $0E
	LDY.w $7DF8,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	SEC
	SBC.w #!Define_YI_NorSpr022_FlashingEgg
	ASL
	TAX
	JSR.w (DATA_goal_award_per_item_ptr,x)
	LDX.b $0E
	BRA.b CODE_02A995

CODE_02A9AE:
	LDX.b $12
	LDA.w #$FFFF
	JML.l CODE_0294B7

DATA_02A9B7:
DATA_goal_award_per_item_ptr:                          ; 10-entry table, indexed by (SpriteID - $022)
                                                  ; visualises each collected item with a bouncing demo
	dw CODE_goal_award_flashing_egg                                ;  $022 FlashingEgg (spawn replacement + arc)
	dw CODE_02A981                                ;  $023 RedEgg (RTS, no demo)
	dw CODE_02A981                                ;  $024 YellowEgg (RTS, no demo)
	dw CODE_02A981                                ;  $025 GreenEgg (RTS, no demo)
	dw CODE_goal_award_giant_egg_trio                                ;  $026 BowserFightGiantEgg (3-egg arc)
	dw CODE_goal_award_key                                ;  $027 Key (clear-key + arc)
	dw CODE_goal_award_huffin_puffin                                ;  $028 HuffinPuffin (boost upward)
	dw CODE_02A981                                ;  $029 GiantEgg (RTS, unused)
	dw CODE_goal_award_giant_egg_trio                                ;  $02A RedGiantEgg (3-egg arc)
	dw CODE_goal_award_giant_egg_trio                                ;  $02B GreenGiantEgg (3-egg arc)

CODE_02A9CB:
CODE_goal_award_flashing_egg:
	TYX
	LDA.w $70E2,x
	STA.w $0000
	LDA.w $7182,x
	STA.w $0002
	LDA.w $7042,x
	STA.w $0004
	PHX
	JSL.l CODE_04F88E
	PLX
	LDA.w #$0006
CODE_02A9E7:
	PHA
	JSL.l CODE_03BF87
	LDA.w #$0115
	TXY
	JSL.l CODE_spawn_sprite
	PLA
	EOR.w $7042,x
	STA.w $7042,x
	LDA.w #$0030
	STA.w $7A96,x
	STA.w $7A98,x
	STA.w $7AF6,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	LDA.w #$FE80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0008
	STA.w $7542,x
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
	RTS

CODE_02AA20:
CODE_goal_award_key:
	TYX
CODE_02AA21:
	JSL.l CODE_02A4F4
	LDA.w #$0000
	BRA.b CODE_02A9E7

CODE_02AA2A:
CODE_goal_award_huffin_puffin:
	TYX
	JSL.l CODE_03BF87
	LDA.w #$FB00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_02AA36:
CODE_goal_award_giant_egg_trio:
	TYX
	LDA.w $7182,x
	STA.b $00
	LDA.w #$0003
	STA.b $02
CODE_02AA41:
	LDA.w #$0115
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_02AA21
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.b $00
	SEC
	SBC.w #$0010
	STA.w $7182,y
	STA.b $00
	LDA.w #$0030
	STA.w $7A96,y
	STA.w $7A98,y
	STA.w $7AF6,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.w #$FE80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0008
	STA.w $7542,y
	LDA.w $6FA2,y
	AND.w #$FFE0
	STA.w $6FA2,y
	DEC.b $02
	BNE.b CODE_02AA41
	JMP.w CODE_02AA21

CODE_02AA86:
CODE_goal_ring_state_01_activate_goal:                 ; ring-flash + force PlayerState02_InCutscene
	TYX
	LDA.w $60DE
	BNE.b CODE_02AB09
	LDA.w #!Define_YI_PlayerState02_InCutscene
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $617A
	STZ.w $617C
	INC.b $18,x
	LDA.w #$0054
	STA.w $7A96,x
	LDY.b #$04
	LDA.w #$008C
	JSL.l CODE_03A34E
	TYA
	INC
	STA.w $7A36,x
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $70E2,y
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0008
	STA.w $7182,y
	LDA.w #$0002
	STA.w $7400,y
	LDA.w $60A8
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w $60AA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.w !RAM_YI_Level_CurrentYoshiColorLo
	ASL
	TAX
	JSR.w CODE_02AC4F
	LDA.w $70E2,x
	CLC
	ADC.w #$0144
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60B4
	STZ.w $60C0
	STZ.w $6162
	STZ.w $6168
	LDX.w !RAM_YI_Level_CurrentLevelFromMapLo
	LDA.l DATA_yoshi_level_colors+$01,x
	AND.w #$00FF
	STA.w !RAM_YI_Level_CurrentYoshiColorLo
	LDX.b $12
	BRA.b CODE_02AB56

CODE_02AB09:
	CMP.w #$0002
	BNE.b CODE_02AB56
	LDA.w #!Define_YI_SoundID4A_YoshiGrunt
	JSL.l CODE_push_sound_queue
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror
	LDY.b #$00
	STY.w $7862
	LDA.w $61B2
	AND.w #$0FFF
	STA.w $61B2
	STZ.b $76
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w $7182,x
	ASL
	ADC.w #$0200
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	LDA.w #$FD40
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	LDA.w #$0010
	STA.w $7542
	LDA.w #$0010
	STA.w $7AF8
	STZ.b $16
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror
	LDA.w #$FFFF
	STA.w $7E48
CODE_02AB56:
	LDA.w $0C23
	CMP.w $7E1A
	BCS.b CODE_02AB64
	ADC.w #$0002
	STA.w $0C23
CODE_02AB64:
	RTS

CODE_02AB65:
CODE_goal_ring_state_02_award_items:                   ; show collected-items tally + scroll camera
	TYX
	LDA.w $7A96,x
	BNE.b CODE_02AB78
	INC.b $18,x
	LDA.w #$0180
	STA.w $7A96,x
	STZ.w $617A
	BRA.b CODE_02AB91

CODE_02AB78:
	CMP.w #$0050
	BNE.b CODE_02AB86
	LDA.w #$000E
	JSL.l CODE_spawn_sprite_init
	BRA.b CODE_02AB91

CODE_02AB86:
	CMP.w #$0040
	BCS.b CODE_02AB91
	LDA.w #$0200
	STA.w $617A
CODE_02AB91:
	LDA.w $7AF6,x
	BNE.b CODE_02ABA7
	LDA.w #$0008
	STA.w $7AF6,x
	LDA.w #$0808
	LDX.b #$00
	JSL.l CODE_029BD9
	LDX.b $12
CODE_02ABA7:
	JMP.w CODE_02AB56

CODE_02ABAA:
CODE_goal_ring_state_03_handoff_to_yoshi_at_goal:
	TYX
	LDA.w $61B2
	BMI.b CODE_02ABF8
	LDA.b $14
	AND.w #$0003
	BNE.b CODE_02ABEA
	LDA.w #!Define_YI_AmbSpr1DF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0006
	STA.w $70A2,y
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0018
	STA.w $7142,y
	LDA.w #$0080
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FFF0
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0003
	STA.w $7E4C,y
	LDA.w #$0004
	STA.w $7782,y
CODE_02ABEA:
	LDA.w #$004C
	STA.w $60BE
	LDA.w #$0180
	STA.w $7A96,x
	BRA.b CODE_02AB91

CODE_02ABF8:
	LDA.w $7A96,x
	LSR
	BNE.b CODE_02AC4E
	BCC.b CODE_02AC07
	LDA.w #$0006
	STA.l $00004D
CODE_02AC07:
	STZ.w $60C4
	LDA.w #$0100
	STA.w $617A
	STZ.w $0C1E
	LDA.w #$0030
	STA.w $7E20
	LDA.w $70E2,x
	CLC
	ADC.w #$0060
	STA.w $7E1A
	LDA.w $60B4
	CMP.w #$0180
	BMI.b CODE_02AC31
	LDA.w #$0180
	STA.w $60B4
CODE_02AC31:
	LDA.w $60B0
	CMP.w #$00F0
	BMI.b CODE_02AC4E
	INC.w $0B57
	INC.w $0B57
	LDY.w $7A36,x
	DEY
	TYX
	JSL.l CODE_03A31E
	LDX.b $12
	JSL.l CODE_03A31E
CODE_02AC4E:
	RTS

CODE_02AC4F:
	REP.b #$10
	PHB
	PEA.w $702000>>8
	PLB
	PLB
	LDA.l DATA_04FB23,x
	TAX
	LDY.w #$001C
CODE_02AC5F:
	LDA.l DATA_master_palette_rom_blob,x
	STA.w $7021E2,y
	STA.w $702F4E,y
	DEX
	DEX
	DEY
	DEY
	BPL.b CODE_02AC5F
	PLB
	SEP.b #$10
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Yoshi at Goal (sprite $08C) -- the static sprite that draws Yoshi
; standing/cheering during the post-goal score tally.
; Raidenthequick: init_yoshi_at_goal / main_yoshi_at_goal.
;-------------------------------------------------------------------------
YI_NorSpr08C_YoshiAtGoal_Init:
init_yoshi_at_goal:                             ; Raidenthequick: init_yoshi_at_goal
;$02AC75
	JSL.l CODE_03AD74
	BCS.b CODE_02AC9D
CODE_02AC7B:
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	RTL

DATA_02AC82:
	dw FXDATA_550000+$6080,FXDATA_550000+$60A0

YI_NorSpr08C_YoshiAtGoal_Main:
main_yoshi_at_goal:                             ; Raidenthequick: main_yoshi_at_goal
;$02AC86
	LDA.w !RAM_YI_Level_CurrentYoshiColorLo
	ASL
	STA.w $6116
	JSL.l CODE_04FB41
	JSL.l CODE_03AA52
	JSL.l CODE_03AF23
	JSL.l CODE_03A590
CODE_02AC9D:
	LDY.b #$00
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_02ACBD
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b #$02
	LDA.w $7A96,x
	BNE.b CODE_02ACBD
	LDA.w #$FD80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0018
	STA.w $7A96,x
CODE_02ACBD:
	TYA
	STA.b $18,x
	LDA.w DATA_02AC82,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$6080)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_088293>>16
	LDA.w #FXCODE_088293
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Hit Super-Baby-Mario Block (sprite $004) -- the block that releases
; the Star Mario super powerup when Yoshi hits it from below.
; Raidenthequick: init_star_item / main_star_item.
;-------------------------------------------------------------------------
YI_NorSpr004_HitSuperBabyMarioBlock_Init:
init_star_item:                                 ; Raidenthequick: init_star_item
;$02ACFC
	LDA.w $7182,x
	STA.b $18,x
	LDA.w #$FD80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

DATA_02AD08:
	db $88,$00

YI_NorSpr004_HitSuperBabyMarioBlock_Main:
main_star_item:                                 ; Raidenthequick: main_star_item
;$02AD0A
	JSL.l CODE_03AF23
	JSL.l CODE_03D127
	LDA.b $76,x
	BNE.b CODE_02AD57
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_02AD57
	INC.b $76,x
	LDA.w !RAM_YI_Level_StarTimerLo
	CMP.w #!Define_YI_Level_SoftMaxStarTimerThreshold
	BCS.b CODE_02AD48
	LDA.b $10
	AND.w #$0007
	BNE.b CODE_02AD48
	LDA.w #$01A2
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_02AD8B
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	RTL

CODE_02AD48:
	LDA.w #$0004
	JSL.l CODE_03A4E9
	LDA.w #!Define_YI_SoundID09_Coin
	JSL.l CODE_push_sound_queue
	RTL

CODE_02AD57:
	LDA.w $7182,x
	SEC
	SBC.b $18,x
	BMI.b CODE_02AD8B
	INC.b $76,x
	LDA.w $70E2,x
	STA.w $0091
	LDA.b $18,x
	STA.w $0093
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w #$0001
	STA.w $008F
	LDA.w #$8A00
	STA.w $0095
	JSL.l CODE_change_map16
	LDX.b $12
	JML.l CODE_03A31E

CODE_02AD8B:
	RTL

;---------------------------------------------------------------------------

DATA_02AD8C:
	dw $FFF7,$0008

;-------------------------------------------------------------------------
; Grinder monkey family inits (sprites $1A5-$1A9):
;   $1A5 -- runs away when Yoshi approaches
;   $1A6 -- carries a watermelon, drops it when hit
;   $1A7 -- hangs from a vine, throws bombs / needlenoses
;   $1A8 -- thieves a coin if Yoshi gets close
;   $1A9 -- hangs from a vine and spits seeds
; All share the Main block (CODE below).
; Raidenthequick: init_grinder_runs_away / _spits_seeds / etc.
;
; See docs/family-misc.md §6 for the full Grinder/Monkey family. The
; variant dispatch uses $701900,x-byte indexing with a -$02 table
; offset; a 6th entry ($0C) is the shared death-pose handler -- so any
; Grinder's death rewrites its variant byte to $0C, letting all
; variants share one dying animation while preserving variant identity
; during alive states.
;-------------------------------------------------------------------------
YI_NorSpr1A5_RunAwayMonkey_Init:
init_grinder_runs_away:                         ; Raidenthequick: init_grinder_runs_away
;$02AD90
	LDA.w #$0002
	JSR.w CODE_02AE77
	LDA.b $10
	AND.w #$0002
	TAY
	JSR.w CODE_02ADC1
	BCS.b CODE_02ADAB
	TYA
	EOR.w #$0002
	TAY
	JSR.w CODE_02ADC1
	BCC.b CODE_02ADBC
CODE_02ADAB:
	TYA
	STA.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_02AD8C,y
	STA.w $70E2,x
	JSR.w CODE_02B348
CODE_02ADBC:
	RTL

;---------------------------------------------------------------------------

DATA_02ADBD:
	dw $FFFF,$0010

CODE_02ADC1:
	LDA.w $7182,x
CODE_02ADC4:
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $70E2,x
	CLC
	ADC.w DATA_02ADBD,y
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	PHY
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	PLY
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$0002
	BNE.b CODE_02ADF5
	LDA.w !REGISTER_SuperFX_R6_MultiplierHi
	AND.w #$00FF
	SEC
	SBC.w #$0099
	LSR
	BEQ.b CODE_02ADF5
	CLC
	RTS

CODE_02ADF5:
	SEC
	RTS

;---------------------------------------------------------------------------

YI_NorSpr1A6_MonkeyWithWatermelon_Init:
init_grinder_spits_seeds:                       ; Raidenthequick: init_grinder_spits_seeds
;$02ADF7
	LDA.w #$0004
	JSR.w CODE_02AE77
CODE_02ADFD:
	JSR.w CODE_02AEA0
	BCS.b CODE_02AE06
	JML.l CODE_03A31E

CODE_02AE06:
	RTL

;---------------------------------------------------------------------------

YI_NorSpr1A9_HangingMonkeySpittingSeeds_Init:
init_grinder_spits_seeds_climbing:              ; Raidenthequick: init_grinder_spits_seeds_climbing
;$02AE07
	LDA.w #$000A
	JSR.w CODE_02AE77
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
	LDA.w $7042,x
	ORA.w #$0030
	STA.w $7042,x
	LDA.w $7400,x
	EOR.w #$0002
	JSL.l CODE_02AE3F
	BRA.b CODE_02ADFD

YI_NorSpr1A7_HangingMonkeyThrowingBombsOrNeedlenoses_Init:
init_seedy_sally:                               ; Raidenthequick: init_seedy_sally
	LDA.w #$0006
	JSR.w CODE_02AE77
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
	LDA.b $10
	AND.w #$0002
CODE_02AE3F:
	TAY
	JSR.w CODE_02ADC1
	BCS.b CODE_02AE61
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$3D3B
	BEQ.b CODE_02AE61
	CMP.w #$3D3C
	BEQ.b CODE_02AE61
	CMP.w #$3D49
	BEQ.b CODE_02AE61
	CMP.w #$3D4A
	BEQ.b CODE_02AE61
	TYA
	EOR.w #$0002
	TAY
CODE_02AE61:
	TYA
	STA.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_02AD8C,y
	STA.w $70E2,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr1A8_TheifMonkey_Init:
init_grinder_grabs_baby_mario:                  ; Raidenthequick: init_grinder_grabs_baby_mario
;$02AE70
	LDA.w #$0008
	JSR.w CODE_02AE77
	RTL

CODE_02AE77:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_02AE9C
	PLA
CODE_02AE7D:
	LDA.w $7042,x
	ORA.w #$0008
	STA.w $7042,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	LDA.w #$0010
	STA.w $7A38,x
	LDA.w #$000C
	JSR.w CODE_02B6B2
	RTL

CODE_02AE9C:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	RTS

;---------------------------------------------------------------------------

CODE_02AEA0:
	LDA.w #$0007
	JSL.l CODE_spawn_sprite_active
CODE_02AEA7:
	BCC.b CODE_02AF10
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w $74A2,x
	AND.w #$0080
	ORA.w #$0005
	STA.w $74A2,y
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	LDA.w $7400,x
	STA.w $7400,y
	LDA.w $7042,x
	STA.w $7042,y
	TYA
	INC
	STA.b $78,x
	LDA.w $7040,x
	AND.w #$FFF3
	STA.w $7040,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr007_Watermelon
	BEQ.b CODE_02AEFA
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0400
	STA.w $75E2,y
	STA.w $7A38,y
	BRA.b CODE_02AF0F

CODE_02AEFA:
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.w $7402,y
	TYX
	LDY.b #$64
	JSL.l CODE_03C878
	LDX.b $12
	REP.b #$20
CODE_02AF0F:
	SEC
CODE_02AF10:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Shared Main for the five Grinder monkey variants.
; Raidenthequick: main_grinder_common.
;-------------------------------------------------------------------------
YI_NorSpr1A5_RunAwayMonkey_Main:
YI_NorSpr1A6_MonkeyWithWatermelon_Main:
YI_NorSpr1A7_HangingMonkeyThrowingBombsOrNeedlenoses_Main:
YI_NorSpr1A8_TheifMonkey_Main:
YI_NorSpr1A9_HangingMonkeySpittingSeeds_Main:
main_grinder_common:                            ; Raidenthequick: main_grinder_common
;$02AF11
	SEP.b #$20
	LDA.w $6FA2,x
	AND.b #$10
	STA.w $77C0,x
	REP.b #$20
	LDA.w $7D96,x
	BNE.b CODE_02AF3B
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_02AF4A
	CMP.w #$000E
	BEQ.b CODE_02AF3B
	LDA.w $7042,x
	AND.w #$00CF
	ORA.w #$0020
	STA.w $7042,x
CODE_02AF3B:
	JSR.w CODE_02B657
	LDA.w $6FA2,x
	AND.w #$FFE0
	ORA.w #$0018
	STA.w $6FA2,x
CODE_02AF4A:
	LDA.w #$C200
	LDY.w $7D38,x
	BEQ.b CODE_02AF68
	LDY.w $7862,x
	DEY
	BMI.b CODE_02AF5F
	STZ.w $7D38,x
	JSL.l CODE_02AE7D
CODE_02AF5F:
	LDA.w #$0011
	STA.w $7402,x
	LDA.w #$C600
CODE_02AF68:
	LDY.w $7A98,x
	BEQ.b CODE_02AF70
	LDA.w #$C000
CODE_02AF70:
	STA.w $6FA0,x
	JSL.l CODE_03AF23
	INC.b $16,x
	JSR.w CODE_02B276
	LDY.b $76,x
	BEQ.b CODE_02AFC8
	LDA.w #$FFC0
	LDY.w $7862,x
	DEY
	BPL.b CODE_02AF94
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_02AFB4
	LDA.w #$0100
CODE_02AF94:
	STA.w $75E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CMP.w #$FFC0
	BCC.b CODE_02AFA5
	LDA.w #$0004
	STA.w $7542,x
CODE_02AFA5:
	LDA.w #$0000
	STA.w $7402,x
	TXY
	LDX.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	JSR.w (DATA_grinder_airborne_ptr-$02,x)
	BRA.b CODE_02AFEA

CODE_02AFB4:
	STZ.b $76,x
	STZ.w $75E0,x
	STZ.w $7540,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
CODE_02AFC8:
	TXY
	LDX.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	JSR.w (DATA_grinder_main_ptr-$02,x)
	LDY.w $7862,x
	DEY
	BMI.b CODE_02AFEA
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_02AFEA
	INC.b $76,x
	LDA.w #$0100
	CMP.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_02AFEA
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_02AFEA:
	JSR.w CODE_02B8C7
	LDY.w $77C0,x
	BEQ.b CODE_02B00B
	LDA.w $7860,x
	AND.w #$0001
	STA.w $7A36,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_02B017
	LDA.w $7042,x
	AND.w #$00CF
	ORA.w #$0020
	BRA.b CODE_02B014

CODE_02B00B:
	STZ.w $7A36,x
	LDA.w $7042,x
	ORA.w #$0030
CODE_02B014:
	STA.w $7042,x
CODE_02B017:
	RTL

DATA_02B018:
DATA_grinder_main_ptr:                                 ; 6-entry per-variant Main, indexed by ($701900-$02)
                                                  ; variant byte set by each init_grinder_* routine above
	dw CODE_grinder_main_run_away                                ;  $02 RunAwayMonkey ($1A5)
	dw CODE_grinder_main_watermelon                                ;  $04 MonkeyWithWatermelon ($1A6)
	dw CODE_grinder_main_hanging_throw                                ;  $06 HangingMonkeyThrowing ($1A7)
	dw CODE_grinder_main_theif                                ;  $08 TheifMonkey ($1A8)
	dw CODE_grinder_main_hanging_spit_seeds                                ;  $0A HangingMonkeySpittingSeeds ($1A9)
	dw CODE_grinder_main_death_pose                                ;  $0C death-pose dispatch (shared)

DATA_02B024:
DATA_grinder_airborne_ptr:                             ; 6-entry per-variant airborne handler
	dw CODE_grinder_airborne_run_away                                ;  $02 RunAwayMonkey
	dw CODE_grinder_airborne_watermelon                                ;  $04 MonkeyWithWatermelon (RTS stub)
	dw CODE_grinder_airborne_hanging_noop                                ;  $06 HangingMonkeyThrowing
	dw CODE_grinder_airborne_theif                                ;  $08 TheifMonkey
	dw CODE_grinder_airborne_hanging_noop                                ;  $0A HangingMonkeySpittingSeeds (shared $06)
	dw CODE_grinder_airborne_death_pose                                ;  $0C death-pose airborne

;---------------------------------------------------------------------------

DATA_02B030:
	db $02,$01,$02,$01,$00,$16,$15,$14,$15,$14,$13,$14,$13,$12,$11

DATA_02B03F:
	db $08,$08,$08,$08,$20,$06,$10,$04,$04,$40,$04,$04,$04,$04,$04
	db $FE,$FF,$FE,$FF,$FD,$FF,$03,$00,$02,$00,$02,$00

CODE_02B05A:
CODE_grinder_main_death_pose:                          ; shared death-anim countdown via DATA_02B030 frames
	TYX
	LDY.w $7A38,x
	BEQ.b CODE_02B098
	JSR.w CODE_02B2BF
	LDA.w $7AF8,x
	BNE.b CODE_02B082
	DEC.w $7A38,x
	BEQ.b CODE_02B082
	LDY.w $7A38,x
	LDA.w DATA_02B030-$01,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_02B03F-$01,y
	AND.w #$00FF
	STA.w $7AF8,x
CODE_02B082:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_02B093
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_02B097
	JSL.l CODE_03A590
CODE_02B093:
	JSL.l CODE_02AE7D
CODE_02B097:
	RTS

CODE_02B098:
	JSR.w CODE_02B6E4
	LDY.b $18,x
	BNE.b CODE_02B0D7
	JSR.w CODE_02B342
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_02B0AD
	JMP.w CODE_02B426

CODE_02B0AD:
	LDA.w $7C16,x
	CLC
	ADC.w #$0020
	CMP.w #$0041
	BCC.b CODE_02B0C8
	LDA.w $77C2,x
	EOR.w #$0002
	AND.w #$00FF
	STA.w $7400,x
	JMP.w CODE_02B3D9

CODE_02B0C8:
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	LDA.w #$FB00
	JMP.w CODE_02B423

CODE_02B0D7:
	DEY
	BNE.b CODE_02B10F
	JSR.w CODE_02B316
	BCC.b CODE_02B0E4
	INC.b $18,x
	STZ.b $16,x
	RTS

CODE_02B0E4:
	LDA.w $7AF8,x
	BNE.b CODE_02B10A
	LDA.w #$0004
	STA.w $7AF8,x
	LDA.w $7402,x
	INC
	CMP.w #$001A
	BCC.b CODE_02B0FB
	LDA.w #$0017
CODE_02B0FB:
	STA.w $7402,x
	ASL
	TAY
	LDA.w $7182,x
	CLC
	ADC.w DATA_02B03F-$1F,y
	STA.w $7182,x
CODE_02B10A:
	RTS

DATA_02B10B:
	dw $0008,$0004

CODE_02B10F:
	JSR.w CODE_02B259
	BCS.b CODE_02B156
	LDA.b $00
	CMP.w #$0020
	BCS.b CODE_02B156
	LDA.w #$0010
	STA.w $7A96,x
	LDY.w $7400,x
	LDA.w $7860,x
	AND.w DATA_02B10B,y
	BNE.b CODE_02B131
	LDA.b $10
	LSR
	BCC.b CODE_02B138
CODE_02B131:
	TYA
	EOR.w #$0002
	STA.w $7400,x
CODE_02B138:
	STZ.b $18,x
	STZ.w $7A38,x
CODE_02B13D:
	LDA.w $6FA2,x
	AND.w #$FFE0
	ORA.w #$0018
	STA.w $6FA2,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	RTS

CODE_02B156:
	JSR.w CODE_02B316
	LDA.b $16,x
	AND.w #$0010
	BEQ.b CODE_02B163
	LDA.w #$0001
CODE_02B163:
	CLC
	ADC.w #$001A
	STA.w $7402,x
	RTS

;---------------------------------------------------------------------------

CODE_02B16B:
CODE_grinder_main_run_away:                            ; $1A5 RunAwayMonkey -- flees Yoshi at speed
	TYX
	LDY.b $18,x
	BEQ.b CODE_02B173
	JMP.w CODE_02B213

CODE_02B173:
	JSR.w CODE_02B342
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_02B189
	LDA.w $7A38,x
	BNE.b CODE_02B186
	JMP.w CODE_02B426

CODE_02B186:
	JMP.w CODE_02B42F

CODE_02B189:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_02B1DC
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_02B1DC
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr007_Watermelon
	BNE.b CODE_02B1DC
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	ORA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	BNE.b CODE_02B1DC
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0000
	STA.w $7542,y
	LDA.w $6FA2,y
	AND.w #$FFE0
	STA.w $6FA2,y
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	TYA
	INC
	STA.b $78,x
	LDA.w $7040,x
	AND.w #$FFF3
	STA.w $7040,x
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $7A38,x
	STZ.w $7AF8,x
CODE_02B1DC:
	JSR.w CODE_02B259
	BCS.b CODE_02B203
	JSR.w CODE_02B6E4
	LDA.b $00
	CMP.w #$0020
	BCS.b CODE_02B1F1
	STZ.w $7A38,x
	JMP.w CODE_02B0C8

CODE_02B1F1:
	LDA.w $77C2,x
	EOR.w #$0002
CODE_02B1F7:
	AND.w #$00FF
	STA.w $7400,x
	STZ.w $7A38,x
	JMP.w CODE_02B3D9

CODE_02B203:
	LDA.w $77C2,x
	JSR.w CODE_02B1F7
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0001
	STA.w $7A38,x
	RTS

CODE_02B213:
	DEY
	BNE.b CODE_02B239
	JSR.w CODE_02B316
	LDA.w #$0003
	BCS.b CODE_02B22E
	LDA.w $60C0
	BEQ.b CODE_02B22B
	LDA.w $7C18,x
	CMP.w #$FFC0
	BPL.b CODE_02B233
CODE_02B22B:
	LDA.w #$0002
CODE_02B22E:
	STA.b $18,x
	STZ.b $16,x
	RTS

CODE_02B233:
	JSR.w CODE_02B6E4
	JMP.w CODE_02B0E4

CODE_02B239:
	DEY
	BNE.b CODE_02B256
	JSR.w CODE_02B259
	BCS.b CODE_02B253
	LDA.w $60C0
	BNE.b CODE_02B24E
	LDA.w $7C18,x
	CMP.w #$FFC0
	BMI.b CODE_02B253
CODE_02B24E:
	DEC.b $18,x
	JMP.w CODE_02B35F

CODE_02B253:
	JMP.w CODE_02B156

CODE_02B256:
	JMP.w CODE_02B10F

CODE_02B259:
	LDA.w $7C16,x
	BPL.b CODE_02B262
	EOR.w #$FFFF
	INC
CODE_02B262:
	STA.b $00
	LDA.w $7C18,x
	BPL.b CODE_02B26D
	EOR.w #$FFFF
	INC
CODE_02B26D:
	STA.b $02
	CLC
	ADC.b $00
	CMP.w #$0080
CODE_02B275:
	RTS

;---------------------------------------------------------------------------

CODE_02B276:
	LDY.w $7D36,x
	BPL.b CODE_02B275
	LDA.w $7A98,x
	BNE.b CODE_02B275
	JSL.l CODE_03D35D
	CPY.b #$06
	BNE.b CODE_02B275
	LDA.w $60AA
	BMI.b CODE_02B275
	LDA.w #$0020
	STA.w $7A98,x
	LDA.w #$FC00
	STA.w $60AA
	LDA.w #$8001
	STA.w $60D2
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_02B2AA
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_02B2AA:
	JSL.l CODE_03A0E5
CODE_02B2AE:
	JSR.w CODE_02B13D
	JSR.w CODE_02B657
	JSL.l CODE_02AE7D
	STZ.b $76,x
	RTS

CODE_02B2BB:
	JSR.w CODE_02B2AE
	RTL

;---------------------------------------------------------------------------

CODE_02B2BF:
	LDY.w $7D36,x
	BPL.b CODE_02B2D1
	LDA.w $7A98,x
	BNE.b CODE_02B2D1
	JSL.l CODE_03D35D
	CPY.b #$04
	BCC.b CODE_02B2D2
CODE_02B2D1:
	RTS

CODE_02B2D2:
	LDA.w #$FFF0
	CPY.b #$00
	BEQ.b CODE_02B2DC
	LDA.w #$0010
CODE_02B2DC:
	SEC
	SBC.w $7C16,x
	PHA
	CLC
	ADC.w $60A8
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLA
	BMI.b CODE_02B2EF
	EOR.w #$FFFF
	INC
CODE_02B2EF:
	CLC
	ADC.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $60A8
	CMP.w #$8000
	ROR
	STA.w $60A8
	JSR.w CODE_02B2AA
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w $7042,x
	ORA.w #$0030
	STA.w $7042,x
	PLA
	RTS

;---------------------------------------------------------------------------

CODE_02B314:
	TAX
	RTS

;---------------------------------------------------------------------------

CODE_02B316:
	JSR.w CODE_02B37F
	BCS.b CODE_02B325
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	PLA
	JMP.w CODE_02B138

CODE_02B325:
	LDA.w $7860,x
	AND.w #$0002
	BNE.b CODE_02B341
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	REP.b #$10
	TAX
	LDA.l $70001F,x
	SEP.b #$10
	TAY
	LDX.b $12
	CPY.b #$9B
	BEQ.b CODE_02B341
	CLC
CODE_02B341:
	RTS

;---------------------------------------------------------------------------

CODE_02B342:
	JSR.w CODE_02B37A
	BCC.b CODE_02B36B
	PLA
CODE_02B348:
	INC.b $18,x
	LDA.w $6FA2,x
	AND.w #$FFE0
	ORA.w #$0006
	STA.w $6FA2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
CODE_02B35F:
	LDA.w #$0019
	STA.w $7402,x
	LDA.w #$0006
	STA.w $7AF8,x
CODE_02B36B:
	RTS

;---------------------------------------------------------------------------

DATA_02B36C:
	dw $0008,$0004

DATA_02B370:
	dw $0007,$0008

DATA_02B374:
	dw $0001,$FFFF,$0001

CODE_02B37A:
	LDA.w $7A96,x
	BNE.b CODE_02B3BB
CODE_02B37F:
	LDY.w $7400,x
CODE_02B382:
	LDA.w $7860,x
	AND.w DATA_02B36C,y
	BNE.b CODE_02B3C7
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CPY.b #$00
	BEQ.b CODE_02B395
	CLC
	ADC.w #$0008
CODE_02B395:
	REP.b #$10
	TAX
	LDA.l $70000F,x
	AND.w #$00FF
	SEP.b #$10
	LDX.b $12
	SEC
	SBC.w #$0099
	LSR
	BNE.b CODE_02B3BB
	LDA.w $70E2,x
	AND.w #$000F
	SEC
	SBC.w DATA_02B370,y
	BEQ.b CODE_02B3C7
	EOR.w DATA_02B374,y
	BMI.b CODE_02B3BD
CODE_02B3BB:
	CLC
	RTS

CODE_02B3BD:
	LDA.w $70E2,x
	CLC
	ADC.w DATA_02B374,y
	STA.w $70E2,x
CODE_02B3C7:
	SEC
	RTS

;---------------------------------------------------------------------------

DATA_02B3C9:
	dw $FFE0,$0020

DATA_02B3CD:
	dw $FE00,$0200

CODE_02B3D1:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_02B42F
CODE_02B3D9:
	LDA.w $7AF8,x
	BEQ.b CODE_02B3E8
CODE_02B3DE:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0003
CODE_02B3E4:
	STA.w $7402,x
	RTS

CODE_02B3E8:
	LDY.w $7400,x
	LDA.w $7CD6,x
	CLC
	ADC.w DATA_02B3C9,y
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	SEC
	SBC.w #$0030
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$0002
	BNE.b CODE_02B420
	LDA.w #$FD00
	LDY.w !REGISTER_SuperFX_R6_MultiplierHi
	CPY.b #$99
	BCC.b CODE_02B423
	CPY.b #$9B
	BCS.b CODE_02B423
CODE_02B420:
	LDA.w #$FA00
CODE_02B423:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_02B426:
	LDY.w $7400,x
	LDA.w DATA_02B3CD,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_02B42F:
	LDA.w #$0005
	STA.w $7AF8,x
	LDA.w #$0004
	STA.w $7402,x
	RTS

;---------------------------------------------------------------------------

DATA_02B43C:
	db $24,$23,$24,$23,$24,$23,$24,$23,$1E,$22,$1E,$22,$1E,$22,$1E,$22
	db $1E,$21,$20

DATA_02B44F:
	db $03,$03,$03,$03,$03,$03,$03,$03,$10,$04,$04,$04,$04,$04,$04,$04
	db $04,$08,$10

DATA_02B462:
	dw $FE80,$0180

DATA_02B466:
	dw $FFF8,$0008

DATA_02B46A:
	dw $FE00,$0200

DATA_02B46E:
	dw $0010,$0020,$0008,$0018

CODE_02B476:
CODE_grinder_main_watermelon:                          ; $1A6 MonkeyWithWatermelon -- throws melon at Yoshi
	TYX
	JSR.w CODE_02B7D1
	LDY.b $18,x
	CPY.b #$03
	BCC.b CODE_02B483
	JMP.w CODE_02BB6B

CODE_02B483:
	JSR.w CODE_02B728
	LDY.b $18,x
	BEQ.b CODE_02B48D
	JMP.w CODE_02B55C

CODE_02B48D:
	LDY.w $7A38,x
	BNE.b CODE_02B495
	JMP.w CODE_02B52E

CODE_02B495:
	LDA.w $7AF8,x
	BNE.b CODE_02B4AD
	DEY
	TYA
	STA.w $7A38,x
	BNE.b CODE_02B4AE
	LDA.w #$0080
	STA.w $7AF8,x
	LDA.w #$001E
	STA.w $7402,x
CODE_02B4AD:
	RTS

CODE_02B4AE:
	LDA.w DATA_02B44F-$01,y
	AND.w #$00FF
	STA.w $7AF8,x
	LDA.w DATA_02B43C-$01,y
	AND.w #$00FF
	STA.w $7402,x
	CMP.w #$0022
	BNE.b CODE_02B4CE
	PHA
	LDA.w #!Define_YI_SoundID14_Gulp
	JSL.l CODE_push_sound_queue
	PLA
CODE_02B4CE:
	CMP.w #$0023
	BNE.b CODE_02B52D
	LDA.w $77C2,x
	EOR.w #$0002
	AND.w #$00FF
	STA.w $7400,x
	LDA.w #$0107
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_02B52D
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,y
	TAX
	LDA.w $6EBC
	CLC
	ADC.w DATA_02B466,x
	STA.w $70E2,y
	LDA.w $6EBE
	SEC
	SBC.w #$0003
	STA.w $7182,y
	LDA.w DATA_02B46A,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.w $7D38,y
	STA.w $7A38,y
	LDA.w $6FA0,y
	AND.w #$F9FF
	STA.w $6FA0,y
	LDA.w #$FFFF
	STA.w $7862,y
	LDA.w #!Define_YI_SoundID45_SpitSeed
	JSL.l CODE_push_sound_queue
	LDX.b $12
CODE_02B52D:
	RTS

CODE_02B52E:
	JSR.w CODE_02B259
	BCS.b CODE_02B53C
	INC.b $18,x
	LDA.w #$0020
	STA.w $7AF6,x
	RTS

CODE_02B53C:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7AF8,x
	BNE.b CODE_02B559
	LDA.w $7680,x
	CMP.w #$00F0
	BCS.b CODE_02B559
	LDA.b $02
	CMP.w #$0020
	BCS.b CODE_02B559
	LDA.w #$0014
	STA.w $7A38,x
CODE_02B559:
	JMP.w CODE_02B62F

CODE_02B55C:
	DEY
	BNE.b CODE_02B5A9
	JSR.w CODE_02B259
	BCC.b CODE_02B569
	LDA.w $7AF6,x
	BEQ.b CODE_02B5B9
CODE_02B569:
	LDA.b $00
	CMP.w #$0020
	BCS.b CODE_02B573
	JMP.w CODE_02B60D

CODE_02B573:
	LDA.w $77C2,x
	EOR.w #$0002
	AND.w #$00FF
	STA.w $7400,x
	TAY
	LDA.w DATA_02B462,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	AND.w DATA_02B36C,y
	BEQ.b CODE_02B591
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_02B591:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_02B5A6
	LDA.b $16,x
	AND.w #$0002
	LSR
	ADC.w #$001C
	STA.w $7402,x
	RTS

CODE_02B5A6:
	JMP.w CODE_02BB55

CODE_02B5A9:
	JSR.w CODE_02B259
	BCS.b CODE_02B5B9
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BEQ.b CODE_02B5CB
CODE_02B5B9:
	STZ.b $18,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$001E
	STA.w $7402,x
	LDA.w #$0020
	STA.w $7AF6,x
CODE_02B5CA:
	RTS

CODE_02B5CB:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $60A8
	BPL.b CODE_02B5D7
	EOR.w #$FFFF
	INC
CODE_02B5D7:
	LSR
	LSR
	LSR
	CLC
	ADC.w #$0018
	CMP.b $00
	BCS.b CODE_02B5E5
	JMP.w CODE_02B620

CODE_02B5E5:
	LDY.b $78,x
	BEQ.b CODE_02B5CA
	LDA.w $77C2,x
	EOR.w #$0002
	TAY
	JSR.w CODE_02B382
	BCC.b CODE_02B60D
	INC.b $18,x
CODE_02B5F7:
	LDA.w $6FA2,x
	AND.w #$FFE0
	ORA.w #$0006
	STA.w $6FA2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	RTS

CODE_02B60D:
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	LDA.w #$FB00
	JSR.w CODE_02BB43
	LDY.w $7400,x
	LDA.w DATA_02B3CD,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_02B620:
	LDA.w #$0007
	LDY.b $00
	CPY.b #$40
	BCC.b CODE_02B62C
	LDA.w #$000F
CODE_02B62C:
	JSR.w CODE_02B6E7
CODE_02B62F:
	LDA.w $7AF8,x
	BNE.b CODE_02B656
	LDA.b $10
	AND.w #$0006
	TAY
	LDA.w DATA_02B46E,y
	LDY.b $00
	CPY.b #$40
	BCS.b CODE_02B644
	LSR
CODE_02B644:
	STA.w $7AF8,x
	LDA.w $7402,x
	INC
	CMP.w #$0020
	BCC.b CODE_02B653
	LDA.w #$001E
CODE_02B653:
	STA.w $7402,x
CODE_02B656:
	RTS

;---------------------------------------------------------------------------

CODE_02B657:
	LDY.b $78,x
	BEQ.b CODE_02B656
	DEY
	BNE.b CODE_02B679
	JSL.l CODE_06C0BB
	LDA.w $70E2,x
	STA.w $70E2
	LDA.w $7182,x
	STA.w $7182
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	LDA.w #$FE80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	BRA.b CODE_02B6AA

CODE_02B679:
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$000A
	STA.w $7182,y
	PHX
	TYX
	STZ.b $18,x
	JSL.l CODE_048066
	TXY
	PLX
	LDA.w $70E2,x
	CMP.w $70E2,y
	LDA.w #$0100
	BCC.b CODE_02B6A1
	LDA.w #$FF00
CODE_02B6A1:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
CODE_02B6AA:
	STZ.b $78,x
CODE_02B6AC:
	STZ.w $7A38,x
	LDA.w #$0002
CODE_02B6B2:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.b $18,x
	STZ.w $7AF8,x
	LDA.w $6FA2,x
	AND.w #$FFE0
	ORA.w #$0018
	STA.w $6FA2,x
	LDA.w $7040,x
	ORA.w #$0004
	STA.w $7040,x
	LDA.w #$0004
	STA.w $74A2,x
	LDA.w #$0040
	STA.w $7542,x
	RTS

;---------------------------------------------------------------------------

DATA_02B6DC:
	dw $0004,$FFFC

DATA_02B6E0:
	dw $0080,$FF80

CODE_02B6E4:
	LDA.w #$000F
CODE_02B6E7:
	AND.b $16,x
	BNE.b CODE_02B723
	LDY.w $7400,x
	LDA.w DATA_02B6E0,y
	PHA
	LDA.w DATA_02B6DC,y
	PHA
	LDA.w #!Define_YI_AmbSpr1D7
	JSL.l CODE_spawn_ambient_sprite
	PLA
	CLC
	ADC.w $70E2,x
	STA.w $70A2,y
	PLA
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w $7182,x
	SEC
	SBC.w #$0009
	STA.w $7142,y
	LDA.w $7400,x
	STA.w $73C0,y
	LDA.w #$0010
	STA.w $7782,y
CODE_02B723:
	RTS

;---------------------------------------------------------------------------

DATA_02B724:
	dw $0008,$0004

CODE_02B728:
	JSR.w CODE_02B37A
	BCC.b CODE_02B74F
	LDA.w #$0003
	STA.b $18,x
	LDA.w #$0020
	STA.w $7AF6,x
	LDA.w #$0018
	STA.w $7402,x
	LDY.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_02B374+$02,y
	STA.w $70E2,x
	PLA
	JMP.w CODE_02B5F7

CODE_02B74F:
	LDA.w $7860,x
	BIT.w #$0001
	BEQ.b CODE_02B760
	LDY.w $7400,x
	AND.w DATA_02B724,y
	BNE.b CODE_02B77B
	RTS

CODE_02B760:
	LDA.w $7A36,x
	BNE.b CODE_02B767
	PLA
	RTS

CODE_02B767:
	LDA.l $70276E,x
	STA.w $70E2,x
	LDA.l $702770,x
	STA.w $7182,x
	STZ.w $7AF6,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_02B77B:
	JSR.w CODE_02B259
	BCS.b CODE_02B79D
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BEQ.b CODE_02B79D
	STA.w $7400,x
	LDA.w #$0002
	STA.b $18,x
	LDA.w #$001E
	STA.w $7402,x
	STZ.w $7AF8,x
	RTS

CODE_02B79D:
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	RTS

;---------------------------------------------------------------------------

CODE_02B7A7:
	LDY.b #$08
	LDA.w $70E2,x
	SEC
	SBC.w #$0010
	BMI.b CODE_02B7BA
	SEC
	SBC.w #$0FD0
	BMI.b CODE_02B7C4
	LDY.b #$04
CODE_02B7BA:
	EOR.w #$FFFF
	SEC
	ADC.w $70E2,x
	STA.w $70E2,x
CODE_02B7C4:
	LDA.w $7680,x
	CLC
	ADC.w #$0020
	CMP.w #$0130
	BCS.b CODE_02B821
	RTS

;---------------------------------------------------------------------------

CODE_02B7D1:
	LDY.b $78,x
	BNE.b CODE_02B7D8
	JMP.w CODE_02B867

CODE_02B7D8:
	LDA.w $6EFF,y
	CMP.w #$0010
	BNE.b CODE_02B85C
	DEY
	BNE.b CODE_02B83B
	LDA.w $7680,x
	CLC
	ADC.w #$0040
	CMP.w #$0170
	BCS.b CODE_02B821
	LDA.w $7682,x
	CLC
	ADC.w #$0040
	CMP.w #$0120
	BCC.b CODE_02B83B
	LDA.w $70E3,x
	AND.w #$000F
	STA.b $00
	LDA.w $7182,x
	CLC
	ADC.w #$0030
	CMP.w #$0800
	BCS.b CODE_02B81E
	AND.w #$0700
	LSR
	LSR
	LSR
	LSR
	ORA.b $00
	TAY
	LDA.w $6CA9,y
	BPL.b CODE_02B821
CODE_02B81E:
	JMP.w CODE_02B657

CODE_02B821:
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
	JSR.w CODE_02B8C7
	PLA
	PLA
	RTL

CODE_02B83B:
	PHY
	JSL.l CODE_03A2F8
	PLY
	BCS.b CODE_02B852
	LDA.w $7542,y
	CMP.w #$0040
	BPL.b CODE_02B85C
	LDA.w $7400,x
	STA.w $7400,y
	RTS

CODE_02B852:
	TYX
	JSL.l CODE_03A31E
	LDX.b $12
	PLA
	PLA
	RTL

CODE_02B85C:
	STZ.b $78,x
	LDA.w $7040,x
	ORA.w #$0004
	STA.w $7040,x
CODE_02B867:
	PLA
	JMP.w CODE_02B6AC

;---------------------------------------------------------------------------

DATA_02B86B:
	dw $0000,$0000,$0000,$0000,$0000,$FFF6,$FFF6,$FFF4
	dw $FFF4,$FFF4,$FFF3,$FFF4,$FFF8,$FFF8,$0000,$0000
	dw $FFF6,$FFF5,$FFF6,$FFFA,$FFFA,$FFF6,$FFF6

DATA_02B899:
	dw $FFEE,$FFEF,$FFF0,$FFF0,$FFF0,$FFFB,$FFFA,$FFFC
	dw $FFFC,$FFFC,$FFFD,$FFFC,$0000,$0000,$FFF0,$FFE5
	dw $FFFC,$FFFD,$FFFC,$0000,$0000,$FFFC,$FFFC

CODE_02B8C7:
	LDY.b $78,x
	BEQ.b CODE_02B90F
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w #$0006
	BEQ.b CODE_02B90F
	LDA.w $7402,x
	CMP.w #$0017
	BCS.b CODE_02B8E1
	LDA.w #$001E
	STA.w $7402,x
CODE_02B8E1:
	ASL
	TAY
	LDA.w $7400,x
	LSR
	LSR
	LDA.w DATA_02B86B-$2E,y
	BCC.b CODE_02B8F1
	EOR.w #$FFFF
	INC
CODE_02B8F1:
	PHA
	LDA.w DATA_02B899-$2E,y
	LDY.b $78,x
	CLC
	ADC.w $7182,x
	STA.w $7181,y
	PLA
	CLC
	ADC.w $70E2,x
	STA.w $70E1,y
	SEP.b #$20
	LDA.b #$FF
	STA.w $7861,y
	REP.b #$20
CODE_02B90F:
	RTS

;---------------------------------------------------------------------------

DATA_02B910:
	db $05,$06,$05,$06,$05,$06,$05,$06,$05,$06,$06,$07,$07,$08,$09,$0A
	db $09,$08,$09,$0B,$0A,$0B,$0C,$0D,$0E,$0F,$10,$1A,$1B,$1A,$1B,$1A
	db $1B,$1A,$1B

DATA_02B933:
	db $08,$08,$08,$08,$08,$08,$08,$08,$10,$02,$02,$02,$02,$02,$02

DATA_02B942:
	dw $0204,$2004,$0820,$0101,$0101,$2004,$1010,$1010
	dw $1010,$1010,$0000,$0000,$0000,$0000,$0000,$0000

DATA_02B962:
	dw $0000,$0000,$0000,$0000,$0005,$0000,$0005,$000C
	dw $000F,$000F,$FFFB,$FFF5,$FFF0,$FFEC,$FFE9,$FFE7
	dw $FFE6,$FFE7,$FFE9,$FFE7,$FFEA,$FFE6,$FFEA,$FFEF
	dw $FFFF,$000B

CODE_02B996:
CODE_grinder_main_hanging_throw:                       ; $1A7 HangingMonkeyThrowingBombsOrNeedlenoses
	TYX
	LDY.w $7A38,x
	CPY.b #$0A
	BCC.b CODE_02B9A5
	CPY.b #$1A
	BCS.b CODE_02B9A5
	JSR.w CODE_02B7D1
CODE_02B9A5:
	LDA.w $7AF8,x
	BEQ.b CODE_02B9AD
	JMP.w CODE_02BA4B

CODE_02B9AD:
	LDY.w $7A38,x
	INY
	CPY.b #$0A
	BCS.b CODE_02B9B8
	JMP.w CODE_02BA21

CODE_02B9B8:
	BNE.b CODE_02B9D8
	PHY
	LDA.w $7182,x
	AND.w #$0010
	BNE.b CODE_02B9C8
	LDA.w #$0060
	BRA.b CODE_02B9CB

CODE_02B9C8:
	LDA.w #$00F9
CODE_02B9CB:
	JSL.l CODE_spawn_sprite_init
	JSR.w CODE_02AEA7
	PLY
	BCS.b CODE_02B9D8
	JMP.w CODE_02BA4B

CODE_02B9D8:
	CPY.b #$15
	BCC.b CODE_02BA21
	BNE.b CODE_02B9F4
	LDA.w $7680,x
	CMP.w #$00F0
	BCS.b CODE_02B9F2
	LDA.w $7682,x
	SEC
	SBC.w #$0008
	CMP.w #$00B0
	BCC.b CODE_02B9F4
CODE_02B9F2:
	LDY.b #$12
CODE_02B9F4:
	CPY.b #$1A
	BNE.b CODE_02BA21
	PHY
	LDA.w #!Define_YI_SoundID75_LitterMouserSqueak
	JSL.l CODE_push_sound_queue
	LDY.b $78,x
	DEY
	TYX
	STZ.b $18,x
	LDA.w $7182,x
	CLC
	ADC.w #$0002
	STA.w $7182,x
	LDA.w #$0400
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.b $76,x
	JSL.l CODE_048072
	LDX.b $12
	STZ.b $78,x
	PLY
CODE_02BA21:
	CPY.b #$0D
	BNE.b CODE_02BA2F
	PHY
	LDY.b $78,x
	LDA.w #$0002
	STA.w $74A1,y
	PLY
CODE_02BA2F:
	LDA.w DATA_02B910-$01,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_02B933-$01,y
	AND.w #$00FF
	STA.w $7AF8,x
	CPY.b #$24
	BCC.b CODE_02BA47
	LDY.b #$00
CODE_02BA47:
	TYA
	STA.w $7A38,x
CODE_02BA4B:
	LDY.w $7A38,x
	CPY.b #$0A
	BCC.b CODE_02BA7C
	CPY.b #$1A
	BCS.b CODE_02BA7C
	TYA
	ASL
	TAY
	LDA.w $7400,x
	LSR
	LSR
	LDA.w DATA_02B942,y
	BCC.b CODE_02BA67
	EOR.w #$FFFF
	INC
CODE_02BA67:
	PHA
	LDA.w DATA_02B962,y
	LDY.b $78,x
	CLC
	ADC.w $7182,x
	STA.w $7181,y
	PLA
	CLC
	ADC.w $70E2,x
	STA.w $70E1,y
CODE_02BA7C:
	RTS

;---------------------------------------------------------------------------

DATA_02BA7D:
	dw $FE80,$0180

CODE_02BA81:
CODE_grinder_main_theif:                               ; $1A8 TheifMonkey -- steals coin then runs
	TYX
	LDY.b $78,x
	BEQ.b CODE_02BA89
	JMP.w CODE_02BAE9

CODE_02BA89:
	LDA.w #$0004
	STA.w $74A2,x
	JSR.w CODE_02BBCE
	LDA.w $7860,x
	ORA.w $7A36,x
	AND.w #$0001
	BEQ.b CODE_02BAD0
	LDA.w $7AF8,x
	BEQ.b CODE_02BAA5
	JMP.w CODE_02B3DE

CODE_02BAA5:
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.w #$0001
	BEQ.b CODE_02BAB1
	TYA
	STA.w $7400,x
CODE_02BAB1:
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.b $10
	AND.w #$0008
	BNE.b CODE_02BAD0
	LDA.w $7C16,x
	CLC
	ADC.w #$0060
	CMP.w #$00C1
	BCS.b CODE_02BAD0
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_02BAD0:
	JSR.w CODE_02B42F
	LDY.w $7400,x
	LDA.w $7860,x
	AND.w DATA_02B36C,y
	BEQ.b CODE_02BAE2
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_02BAE2:
	LDA.w DATA_02BA7D,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_02BAE9:
	LDA.w #$0003
	STA.w $74A2,x
	JSR.w CODE_02B7D1
	JSR.w CODE_02B7A7
	LDY.b $18,x
	CPY.b #$03
	BCC.b CODE_02BAFE
	JMP.w CODE_02BB65

CODE_02BAFE:
	JSR.w CODE_02B728
	LDY.b $18,x
	BNE.b CODE_02BB18
	JSR.w CODE_02B259
	BCC.b CODE_02BB15
	LDA.w $7AF6,x
	BNE.b CODE_02BB15
	INC.b $18,x
	STZ.w $7AF8,x
	RTS

CODE_02BB15:
	JMP.w CODE_02B573

CODE_02BB18:
	DEY
	BNE.b CODE_02BB62
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_02BB55
	JSR.w CODE_02B259
	BCS.b CODE_02BB34
	DEC.b $18,x
	LDA.w #$0020
	STA.w $7AF6,x
	RTS

CODE_02BB34:
	LDA.w $7AF8,x
	BEQ.b CODE_02BB40
	LDA.w #$0025
	STA.w $7402,x
	RTS

CODE_02BB40:
	LDA.w #$FC00
CODE_02BB43:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	STZ.w $7860,x
	STZ.w $7A36,x
CODE_02BB55:
	LDA.w #$0010
	STA.w $7AF8,x
	LDA.w #$0026
	STA.w $7402,x
	RTS

CODE_02BB62:
	JMP.w CODE_02B5A9

;---------------------------------------------------------------------------

CODE_02BB65:
	LDA.w #$0004
	STA.w $74A2,x
CODE_02BB6B:
	CPY.b #$03
	BNE.b CODE_02BBAE
	JSR.w CODE_02B37F
	BCS.b CODE_02BB8F
	JSR.w CODE_02B13D
CODE_02BB77:
	LDA.w #$0002
	STA.b $18,x
	LDA.w #$FC00
	JSR.w CODE_02BB43
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	TAY
	JMP.w CODE_02BAE2

CODE_02BB8F:
	JSR.w CODE_02B325
	BCS.b CODE_02BBA6
	LDA.w $7AF6,x
	BNE.b CODE_02BBAB
	LDA.w $60C0
	BNE.b CODE_02BBA6
	LDA.w $7C18,x
	CMP.w #$FFC0
	BPL.b CODE_02BBAB
CODE_02BBA6:
	INC.b $18,x
	STZ.b $16,x
	RTS

CODE_02BBAB:
	JMP.w CODE_02B0E4

CODE_02BBAE:
	LDA.w $60C0
	BNE.b CODE_02BBBD
	LDA.w $7C18,x
	CMP.w #$FFC0
	BMI.b CODE_02BBBD
	DEC.b $18,x
CODE_02BBBD:
	JSR.w CODE_02B10F
	LDA.b $18,x
	BNE.b CODE_02BBCD
	JSR.w CODE_02BB55
	LDY.w $7400,x
	JMP.w CODE_02BAE2

CODE_02BBCD:
	RTS

;---------------------------------------------------------------------------

CODE_02BBCE:
	LDA.w $61CC
	BNE.b CODE_02BBDB
	LDA.w $61B2
	AND.w #$6000
	BEQ.b CODE_02BBE0
CODE_02BBDB:
	LDY.w $7400,x
	SEC
	RTS

CODE_02BBE0:
	LDY.b #$02
	LDA.w $7CD6
	SEC
	SBC.w $7CD6,x
	BPL.b CODE_02BBF1
	LDY.b #$00
	EOR.w #$FFFF
	INC
CODE_02BBF1:
	CMP.w #$0008
	BCS.b CODE_02BC21
	LDA.w $7CD8
	SEC
	SBC.w $7CD8,x
	CLC
	ADC.w #$0008
	CMP.w #$0011
	BCS.b CODE_02BC21
CODE_02BC06:
	LDA.w #$0001
	STA.b $78,x
	LDA.w $7040,x
	AND.w #$FFF3
	STA.w $7040,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	PHA
	JSL.l CODE_06BE72
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
CODE_02BC21:
	RTS

CODE_02BC22:
	JSR.w CODE_02BC06
	RTL

;---------------------------------------------------------------------------

DATA_02BC26:
	db $2B,$2A,$2B,$2A,$2B,$2A,$2B,$2A,$2C,$29,$2C,$29,$2C,$29,$2C,$29
	db $2C,$28,$27

DATA_02BC39:
	db $03,$03,$03,$03,$03,$03,$03,$03,$10,$04,$04,$04,$04,$04,$04,$04
	db $04,$08,$10

DATA_02BC4C:
	dw $FFF4,$000C

DATA_02BC50:
	dw $FFFF,$FFFF,$FFFE,$FFFE,$FFFD,$0002,$0002,$0001
	dw $0001

DATA_02BC62:
	dw $FFF0,$0010

CODE_02BC66:
CODE_grinder_main_hanging_spit_seeds:                  ; $1A9 HangingMonkeySpittingSeeds
	TYX
	JSR.w CODE_02B7D1
	LDY.b $18,x
	BEQ.b CODE_02BC71
	JMP.w CODE_02BD79

CODE_02BC71:
	LDY.w $7A38,x
	BNE.b CODE_02BC79
	JMP.w CODE_02BD01

CODE_02BC79:
	LDA.w $7AF8,x
	BEQ.b CODE_02BC7F
	RTS

CODE_02BC7F:
	DEY
	TYA
	STA.w $7A38,x
	BNE.b CODE_02BC8D
	LDA.w #$0040
	STA.w $7AF8,x
	RTS

CODE_02BC8D:
	LDA.w DATA_02BC39-$01,y
	AND.w #$00FF
	STA.w $7AF8,x
	LDA.w DATA_02BC26-$01,y
	AND.w #$00FF
	STA.w $7402,x
	CMP.w #$0019
	BNE.b CODE_02BCAD
	PHA
	LDA.w #!Define_YI_SoundID14_Gulp
	JSL.l CODE_push_sound_queue
	PLA
CODE_02BCAD:
	CMP.w #$002A
	BNE.b CODE_02BD00
	LDA.w #$0107
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_02BD00
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,y
	TAX
	LDA.w $6EBC
	CLC
	ADC.w DATA_02BC4C,x
	STA.w $70E2,y
	LDA.w $6EBE
	SEC
	SBC.w #$0001
	STA.w $7182,y
	LDA.w DATA_02B46A,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.w $7D38,y
	STA.w $7A38,y
	LDA.w $6FA0,y
	AND.w #$F9FF
	STA.w $6FA0,y
	LDA.w #$FFFF
	STA.w $7862,y
	LDA.w #!Define_YI_SoundID45_SpitSeed
	JSL.l CODE_push_sound_queue
	LDX.b $12
CODE_02BD00:
	RTS

CODE_02BD01:
	LDA.w $7AF8,x
	BEQ.b CODE_02BD1F
	LDY.b #$2C
	CMP.w #$0020
	BCS.b CODE_02BD1A
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BEQ.b CODE_02BD1A
	LDY.b #$2D
CODE_02BD1A:
	TYA
	STA.w $7402,x
	RTS

CODE_02BD1F:
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BNE.b CODE_02BD3F
	LDY.w $7400,x
	LDA.w $7860,x
	AND.w DATA_02B36C,y
	BNE.b CODE_02BD72
	INC.b $18,x
	LDA.w #$0009
	STA.w $7A38,x
	BRA.b CODE_02BD6B

CODE_02BD3F:
	JSR.w CODE_02B259
	BCS.b CODE_02BD72
	LDA.w $7C18,x
	CLC
	ADC.w #$0008
	CMP.w #$0011
	BCC.b CODE_02BD72
	LDY.w $77C3,x
	LDA.w $7182,x
	CLC
	ADC.w DATA_02BC62,y
	LDY.w $7400,x
	JSR.w CODE_02ADC4
	BCC.b CODE_02BD72
	LDA.w $77C3,x
	CLC
	ADC.w #$0002
	STA.b $18,x
CODE_02BD6B:
	LDA.w #$0019
	STA.w $7402,x
	RTS

CODE_02BD72:
	LDA.w #$0014
	STA.w $7A38,x
	RTS

CODE_02BD79:
	DEY
	BNE.b CODE_02BDAB
	DEC.w $7A38,x
	BNE.b CODE_02BD85
CODE_02BD81:
	STZ.b $18,x
	BRA.b CODE_02BD72

CODE_02BD85:
	LDA.w $7A38,x
	ASL
	TAY
	CPY.b #$08
	BNE.b CODE_02BD97
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_02BD97:
	LDA.w DATA_02BC50,y
	LDY.w $7400,x
	BNE.b CODE_02BDA3
	EOR.w #$FFFF
	INC
CODE_02BDA3:
	CLC
	ADC.w $70E2,x
	STA.w $70E2,x
	RTS

CODE_02BDAB:
	DEY
	BNE.b CODE_02BDB3
	JSR.w CODE_02B0E4
	BRA.b CODE_02BDD9

CODE_02BDB3:
	LDA.w $7AF8,x
	BNE.b CODE_02BDD9
	LDA.w #$0004
	STA.w $7AF8,x
	LDA.w $7402,x
	DEC
	CMP.w #$0017
	BCS.b CODE_02BDCA
	LDA.w #$0019
CODE_02BDCA:
	STA.w $7402,x
	ASL
	TAY
	LDA.w $7182,x
	CLC
	ADC.w $02B026,y
	STA.w $7182,x
CODE_02BDD9:
	LDY.w $7400,x
	JSR.w CODE_02ADC1
	BCS.b CODE_02BDEA
	LDA.w $6EBE
	STA.w $7182,x
CODE_02BDE7:
	JMP.w CODE_02BD81

CODE_02BDEA:
	JSR.w CODE_02B259
	BCS.b CODE_02BDE7
	LDA.w $77C3,x
	AND.w #$00FF
	CLC
	ADC.w #$0002
	CMP.b $18,x
	BNE.b CODE_02BDE7
	RTS

;---------------------------------------------------------------------------

DATA_02BDFE:
	dw $FF80,$0080

CODE_02BE02:
CODE_grinder_airborne_run_away:                        ; $1A5 airborne -- ground-impact recovery
	TYX
CODE_02BE03:
	JSR.w CODE_02B259
	BCS.b CODE_02BE69
CODE_02BE08:
	JSR.w CODE_02B6E4
	SEP.b #$20
	LDA.b #$FF
	STA.w $7862,x
	REP.b #$20
	LDY.w $7400,x
	LDA.w $7860,x
	AND.w DATA_02B36C,y
	BEQ.b CODE_02BE40
CODE_02BE1F:
	STZ.b $76,x
	STZ.w $75E0,x
	STZ.w $7540,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDY.b $78,x
	BNE.b CODE_02BE3D
	LDA.w #$FC00
	JMP.w CODE_02B423

CODE_02BE3D:
	JMP.w CODE_02BB77

CODE_02BE40:
	LDA.w $77C2,x
	AND.w #$00FF
	EOR.w #$0002
	STA.w $7400,x
	TAY
CODE_02BE4D:
	LDA.w DATA_02BDFE,y
	STA.w $75E0,x
CODE_02BE53:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0080
	CMP.w #$0101
	LDA.w #$0004
	BCC.b CODE_02BE65
	LDA.w #$0020
CODE_02BE65:
	STA.w $7540,x
	RTS

CODE_02BE69:
	SEP.b #$20
	LDA.b #$FF
	STA.w $7862,x
	REP.b #$20
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	STZ.w $75E0,x
	BRA.b CODE_02BE53

CODE_02BE80:
CODE_grinder_airborne_watermelon:                      ; $1A6 airborne -- drops melon then re-enters ground
	TYX
	JSR.w CODE_02B7D1
	JMP.w CODE_02BE03

;---------------------------------------------------------------------------

CODE_02BE87:
CODE_grinder_airborne_hanging_noop:                    ; $1A7/$1A9 airborne -- hanging variants RTS stub
	TYX
	RTS

;---------------------------------------------------------------------------

CODE_02BE89:
CODE_grinder_airborne_theif:                           ; $1A8 airborne -- escape arc with stolen coin
	TYX
	LDY.b $78,x
	BNE.b CODE_02BEB2
	LDA.w #$0004
	STA.w $74A2,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $7862,x
	REP.b #$20
	JSR.w CODE_02BBCE
	TYA
	STA.w $7400,x
	LDA.w $7860,x
	AND.w DATA_02B36C,y
	BEQ.b CODE_02BEAF
	JMP.w CODE_02BE1F

CODE_02BEAF:
	JMP.w CODE_02BE4D

CODE_02BEB2:
	LDA.w #$0003
	STA.w $74A2,x
	JSR.w CODE_02B7D1
	JSR.w CODE_02B7A7
	JSR.w CODE_02B259
	BCS.b CODE_02BEC6
	JMP.w CODE_02BE08

CODE_02BEC6:
	JMP.w CODE_02BE69

;---------------------------------------------------------------------------

CODE_02BEC9:
CODE_grinder_airborne_death_pose:                      ; airborne death-anim tail
	TYX
	LDY.w $7A38,x
	BEQ.b CODE_02BEFD
	CPY.b #$04
	BCS.b CODE_02BED9
	LDA.w #$0080
	STA.w $75E2,x
CODE_02BED9:
	LDA.w $7AF8,x
	BNE.b CODE_02BEE7
	DEC.w $7A38,x
	LDA.w #$0010
	STA.w $7AF8,x
CODE_02BEE7:
	JSR.w CODE_02B6E4
	LDA.b $16,x
	AND.w #$0008
	BEQ.b CODE_02BEF7
	LDA.w #$0020
	STA.w $7402,x
CODE_02BEF7:
	STZ.w $75E0,x
	JMP.w CODE_02BE53

CODE_02BEFD:
	JMP.w CODE_02BE08

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Nep-Enut / Gargantua Blargg (sprite $0A5) -- the underwater boss from
; World 2 (Nep-Enut) and World 6 (Gargantua Blargg).  Same code, different
; palette + tileset.  See also: ys_boss1.asm.  Raidenthequick: init_nep_enut.
;-------------------------------------------------------------------------
YI_NorSpr0A5_NepEnut_Init:
init_nep_enut:                                  ; Raidenthequick: init_nep_enut
;$02BF00
	LDA.w $70E2,x
	AND.w #$0010
	STA.b $78,x
	RTL

;---------------------------------------------------------------------------

DATA_02BF09:
	dw $7D8F,$7D8F,$7D8F,$7D8F,$7D8F,$7D8F,$7D8F,$7D8F
	dw $001F,$001E,$001D,$001C,$001B,$001C,$001D,$001E
	dw $7FFF

DATA_02BF2B:
	dw $6CAA,$6CAA,$6CAA,$6CAA,$6CAA,$6CAA,$6CAA,$6CAA
	dw $0015,$0016,$0017,$0018,$0019,$0018,$0017,$0016
	dw $7FFF

DATA_02BF4D:
	dw $7F2F,$7F2F,$7F2F,$7F2F,$7F2F,$7F2F,$7F2F,$7F2F
	dw $01DF,$01DF,$01DF,$01DF,$01DF,$01DF,$01DF,$01DF
	dw $7FFF

DATA_02BF6F:
	dw $0000,$0001,$0002,$0002,$0001,$0000,$0000,$0001
	dw $0002,$0002,$0001

DATA_02BF85:
	dw $000A,$0016

DATA_02BF89:
	dw $FFC0,$0040

DATA_02BF8D:
	dw $0001,$FFFF

YI_NorSpr0A5_NepEnut_Main:
main_nep_enut:                                  ; Raidenthequick: main_nep_enut
;$02BF91
	JSR.w CODE_02C1F4
	JSL.l CODE_03AF23
	LDY.b #$02
	LDA.w $7680,x
	CLC
	ADC.w #$0050
	BMI.b CODE_02BFAB
	SEC
	SBC.w #$01A0
	BMI.b CODE_02BFB9
	LDY.b #$00
CODE_02BFAB:
	EOR.w #$FFFF
	INC
	STA.b $02
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	BRA.b CODE_02BFC4

CODE_02BFB9:
	STZ.b $02
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_02BFC4
	LDY.b #$02
CODE_02BFC4:
	STY.b $00
	LDA.w $7CD6,x
	CLC
	ADC.w DATA_02BF89,y
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_02BFF0
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b $00
	LDA.w DATA_02BF8D,y
	STA.b $02
CODE_02BFF0:
	LDA.w $70E2,x
	CLC
	ADC.b $02
	STA.w $70E2,x
	TXY
	LDA.b $18,x
	ASL
	TAX
	JSR.w (DATA_nep_enut_state_ptr,x)
	STZ.w $7A38,x
	LDA.w $7AF8,x
	BEQ.b CODE_02C015
	AND.w #$FFFE
	TAY
	LDA.w DATA_02BF6F,y
	STA.w $7402,x
	BRA.b CODE_02C028

CODE_02C015:
	LDA.b $10
	AND.w #$003F
	BNE.b CODE_02C028
	LDA.b $14
	AND.w #$0002
	TAY
	LDA.w DATA_02BF85,y
	STA.w $7AF8,x
CODE_02C028:
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
	BEQ.b CODE_02C055
	INC.w $7A38,x
	JSL.l CODE_03A858
CODE_02C055:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_02C06B
	LDA.w $7D38,y
	BEQ.b CODE_02C06B
	LDA.w #$FFFF
	STA.w $7A38,x
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
CODE_02C06B:
	LDY.b #$20
	LDA.w $7AF6,x
	AND.w #$0004
	BNE.b CODE_02C07E
	LDA.b $14
	LSR
	AND.w #$000E
	ORA.b $78,x
	TAY
CODE_02C07E:
	LDA.w DATA_02BF09,y
	STA.l YI_Global_PaletteMirror[$01].LowByte
	STA.l $702D6E
	LDA.w DATA_02BF2B,y
	STA.l YI_Global_PaletteMirror[$02].LowByte
	STA.l $702D70
	LDA.w DATA_02BF4D,y
	STA.l YI_Global_PaletteMirror[$03].LowByte
	STA.l $702D72
	RTL

DATA_02C0A0:
DATA_nep_enut_state_ptr:                               ; 2-entry $18,x sub-state dispatch
	dw CODE_nep_enut_state_00_idle_drift                                ;  0: idle drift, periodic facing flip
	dw CODE_nep_enut_state_01_charge_spit                                ;  1: charge / projectile spit

DATA_02C0A4:
	dw $FE00,$0200

CODE_02C0A8:
CODE_nep_enut_state_00_idle_drift:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_02C0C3
	LDY.w $77C2,x
	LDA.w DATA_02C0A4,y
	STA.w $75E0,x
	LDA.w #$0020
	STA.w $7540,x
	LDA.w #$0040
	STA.w $7A98,x
CODE_02C0C3:
	LDA.b $76,x
	BNE.b CODE_02C0DC
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	CLC
	ADC.w #$0004
	CMP.w #$0101
	BCC.b CODE_02C0D8
	INC.b $76,x
	LDA.w #$0000
CODE_02C0D8:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	RTS

CODE_02C0DC:
	LDY.b $00
	TYA
	CMP.w $7400,x
	BEQ.b CODE_02C0F5
	LDA.b $16,x
	CLC
	ADC.w #$0008
	CMP.w #$0101
	BCC.b CODE_02C102
	TYA
	STA.w $7400,x
	BRA.b CODE_02C0FF

CODE_02C0F5:
	LDA.b $16,x
	BEQ.b CODE_02C105
	SEC
	SBC.w #$0004
	BPL.b CODE_02C102
CODE_02C0FF:
	LDA.w #$0000
CODE_02C102:
	STA.b $16,x
	RTS

CODE_02C105:
	LDA.w $7A96,x
	BNE.b CODE_02C13C
	LDY.w $77C2,x
	TYA
	CMP.w $7400,x
	BNE.b CODE_02C13C
	LDA.w $7C16,x
	CLC
	ADC.w #$0090
	CMP.w #$0121
	BCS.b CODE_02C13C
	LDA.w #!Define_YI_SoundID48_LargeBlockLands
	JSL.l CODE_push_sound_queue
	INC.b $18,x
	STZ.w $7A36,x
	LDA.w #$0003
	STA.b $76,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w #$0080
	STA.w $7A98,x
CODE_02C13C:
	RTS

DATA_02C13D:
	dw $FF00,$0100

CODE_02C141:
CODE_nep_enut_state_01_charge_spit:
	TYX
	LDY.b $76,x
	CPY.b #$04
	BCC.b CODE_02C16C
	LDA.w $7A36,x
	BNE.b CODE_02C16C
	LDA.w $7A38,x
	BEQ.b CODE_02C16C
	STA.w $7A36,x
	BPL.b CODE_02C166
	PHY
	LDA.w #!Define_YI_SoundID7A_HurtNepEnut
	JSL.l CODE_push_sound_queue
	PLY
	LDA.w #$0040
	STA.w $7AF6,x
CODE_02C166:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
CODE_02C16C:
	CPY.b #$07
	BCS.b CODE_02C178
	LDA.w $7A36,x
	BPL.b CODE_02C178
	LDA.w #$0020
CODE_02C178:
	CLC
	ADC.w #$0008
	CLC
	ADC.b $16,x
	CMP.w #$0101
	BCC.b CODE_02C1E9
	INY
	CPY.b #$09
	BCS.b CODE_02C1C7
	CPY.b #$05
	BCC.b CODE_02C1E3
	LDA.w $7A36,x
	BNE.b CODE_02C1BF
	LDA.w $7A98,x
	BNE.b CODE_02C1B7
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BNE.b CODE_02C1BF
	PHY
	TAY
	LDA.w DATA_02C13D,y
	STA.w $75E0,x
	LDA.w #$0010
	STA.w $7540,x
	LDA.w #$0040
	STA.w $7A98,x
	PLY
CODE_02C1B7:
	CPY.b #$07
	BNE.b CODE_02C1E3
	LDY.b #$05
	BRA.b CODE_02C1E3

CODE_02C1BF:
	CPY.b #$05
	BNE.b CODE_02C1E3
	LDY.b #$07
	BRA.b CODE_02C1E3

CODE_02C1C7:
	STZ.b $18,x
	LDA.w #$0020
	LDY.w $7A36,x
	BEQ.b CODE_02C1DE
	LDA.w #$00A0
	LDY.w !RAM_YI_Level_CurrentWorldLo
	CPY.b #!Define_YI_WorldID_World4
	BCS.b CODE_02C1DE
	LDA.w #$0100
CODE_02C1DE:
	STA.w $7A96,x
	LDY.b #$01
CODE_02C1E3:
	TYA
	STA.b $76,x
	LDA.w #$0000
CODE_02C1E9:
	STA.b $16,x
	RTS

DATA_02C1EC:
	dw $0048,$00B0

DATA_02C1F0:
	dw $0040,$00B8

CODE_02C1F4:
	LDA.b $76,x
	ASL
	ASL
	ORA.w $7400,x
	TAY
	LDA.w DATA_02C2DC,y
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w DATA_02C2E0,y
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #DATA_02C304>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$003E
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STZ.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$449E
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $16,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7680,x
	CLC
	ADC.w #$0008
	STA.w $6040
	LDA.w $7682,x
	SEC
	SBC.w #$0008
	STA.w $6042
	LDX.b #FXCODE_08E93B>>16
	LDA.w #FXCODE_08E93B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348
	LDX.b $12
	LDA.w #$0004
	TSB.w !RAM_YI_Global_MainScreenLayers
	LDA.w #$0008
	TRB.w !RAM_YI_Global_BGModeAndTileSizeSetting
	LDA.w #$0018
	TSB.w !RAM_YI_Global_HDMAEnable
	LDY.w $7400,x
	LDX.b #$7C
	LDA.l $70449E,x
	STA.b $00
	LDA.l $7044A0,x
	STA.b $02
	LDX.w DATA_02C1EC,y
	LDA.l $70449E,x
	STA.b $04
	LDA.l $7044A0,x
	STA.b $06
	LDX.w DATA_02C1F0,y
	LDA.l $70449E,x
	STA.b $08
	LDA.l $7044A0,x
	STA.b $0A
	LDX.b $12
	REP.b #$10
	LDY.w $7362,x
	LDX.w #$000A
CODE_02C298:
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
	BNE.b CODE_02C298
	LDA.w $6000,y
	CLC
	ADC.b $04
	STA.w $6000,y
	LDA.w $6002,y
	CLC
	ADC.b $06
	STA.w $6002,y
	LDA.w $6008,y
	CLC
	ADC.b $08
	STA.w $6008,y
	LDA.w $600A,y
	CLC
	ADC.b $0A
	STA.w $600A,y
	SEP.b #$10
	LDX.b $12
	RTS

DATA_02C2DC:
	dw DATA_02C304,DATA_02C304

DATA_02C2E0:
	dw DATA_02C380,DATA_02C570,DATA_02C570,DATA_02C380,DATA_02C380,DATA_02C570,DATA_02C3FC,DATA_02C5EC
	dw DATA_02C4F4,DATA_02C6E4,DATA_02C478,DATA_02C668,DATA_02C4F4,DATA_02C6E4,DATA_02C3FC,DATA_02C5EC
	dw DATA_02C380,DATA_02C570

DATA_02C304:
	dw $0000,$00C0,$00C6,$00C9,$00CB,$00CD,$00CE,$00E8
	dw $0002,$000B,$0013,$0016,$0018,$0015,$0012,$000C
	dw $0001,$00EF,$00DC,$00D7,$00D3,$00CF,$00CF,$00D0
	dw $00D0,$00D1,$00D3,$00D8,$00DF,$00E7,$00F1,$00F1
	dw $00FC,$0008,$0013,$001D,$0024,$0028,$0029,$002A
	dw $002B,$002D,$002E,$002E,$002E,$002E,$002E,$002E
	dw $002E,$002E,$002E,$002E,$002E,$002E,$002E,$002E
	dw $002E,$0030,$0034,$0037,$003B,$003F

DATA_02C380:
	dw $0000,$00C0,$FFC6,$FEC9,$FDCB,$FBCD,$FACE,$FAE8
	dw $FA02,$FA0B,$FA13,$FA16,$FA18,$FA15,$FA12,$FA0C
	dw $FA01,$FAEF,$FADC,$FAD7,$FAD3,$FACF,$F9CF,$F8D0
	dw $F8D0,$F7D1,$F6D3,$F4D8,$F2DF,$F1E7,$F1F1,$F1F1
	dw $F1FC,$F108,$F213,$F41D,$F624,$F728,$F829,$F82A
	dw $F92B,$FA2D,$FA2E,$FA2E,$FA2E,$FA2E,$FA2E,$FA2E
	dw $FA2E,$FA2E,$FA2E,$FA2E,$FA2E,$FA2E,$FA2E,$FA2E
	dw $FA2E,$FB30,$FD34,$FE37,$003B,$003F

DATA_02C3FC:
	dw $0000,$00C0,$FCC6,$F8C9,$F3CB,$ECCD,$E7CE,$E7E8
	dw $E702,$E70B,$E713,$E716,$E718,$E715,$E712,$E70C
	dw $E701,$E7EF,$E7DC,$E7D7,$E7D3,$E6CF,$E2CF,$E0D0
	dw $DED0,$DBD1,$D6D3,$CED8,$C7DF,$C3E7,$C1F1,$C1F1
	dw $C1FC,$C308,$C713,$CE1D,$D624,$DB28,$DE29,$E02A
	dw $E22B,$E62D,$E72E,$E72E,$E72E,$E72E,$E72E,$E72E
	dw $E72E,$E72E,$E72E,$E72E,$E72E,$E72E,$E72E,$E72E
	dw $E72E,$EC30,$F334,$F837,$FD3B,$003F

DATA_02C478:
	dw $0000,$00C0,$FAC5,$F5C8,$E9CB,$DCCD,$C8D0,$C6E8
	dw $C202,$BF0B,$BC13,$B916,$B518,$B015,$AD12,$A90C
	dw $A501,$A1EF,$9EDC,$9DD7,$9DD3,$9BD0,$97D0,$95D2
	dw $93D6,$92DA,$8DDD,$89E1,$86E5,$84EA,$82F1,$82F1
	dw $82FC,$8301,$8508,$890F,$8E15,$9219,$931A,$951B
	dw $971C,$9B1E,$9D1F,$9D1F,$9E20,$A121,$A523,$A924
	dw $AC25,$B027,$B528,$B929,$BC2A,$C02A,$C22B,$C62C
	dw $C82C,$DC31,$E934,$F538,$FA3B,$003F

DATA_02C4F4:
	dw $0000,$00C0,$FCC3,$F9C5,$F1C8,$E8CA,$DCCA,$DAE8
	dw $D701,$D00F,$CB14,$C117,$BA18,$B417,$AF15,$A911
	dw $A40B,$9BFA,$97E6,$96DE,$95D8,$92D4,$8DD3,$8BD5
	dw $8AD7,$8AE1,$88E4,$86E7,$84EC,$83F0,$82F5,$8200
	dw $8206,$840C,$8610,$8916,$8D1B,$9220,$9321,$9523
	dw $9724,$9B26,$9D27,$9E27,$9F27,$A128,$A529,$A92A
	dw $AC2B,$B02C,$B32D,$BA2D,$C12E,$CB2F,$D02F,$D730
	dw $DA31,$E834,$F137,$F93B,$FC3D,$003F

DATA_02C570:
	dw $0000,$00C1,$00C5,$FEC9,$FDCC,$FBD0,$FAD2,$FAD2
	dw $FAD2,$FAD2,$FAD2,$FAD2,$FAD2,$FAD2,$FAD2,$FAD2
	dw $FAD2,$FAD2,$FAD2,$FAD2,$FAD2,$FAD3,$F9D5,$F8D6
	dw $F8D7,$F7D8,$F6DC,$F4E3,$F2ED,$F1F8,$F104,$F10F
	dw $F10F,$F119,$F221,$F428,$F62D,$F72F,$F830,$F830
	dw $F931,$FA31,$FA2D,$FA29,$FA24,$FA11,$FAFF,$FAF4
	dw $FAEE,$FAEB,$FAE8,$FAEA,$FAED,$FAF5,$FAFE,$FA18
	dw $FA32,$FB33,$FD35,$FE37,$FF3A,$0040

DATA_02C5EC:
	dw $0000,$00C1,$FDC5,$F8C9,$F3CC,$ECD0,$E7D2,$E7D2
	dw $E7D2,$E7D2,$E7D2,$E7D2,$E7D2,$E7D2,$E7D2,$E7D2
	dw $E7D2,$E7D2,$E7D2,$E7D2,$E7D2,$E6D3,$E2D5,$E0D6
	dw $DED7,$DBD8,$D6DC,$CEE3,$C7ED,$C3F8,$C104,$C10F
	dw $C10F,$C319,$C721,$CE28,$D62D,$DB2F,$DE30,$E030
	dw $E231,$E631,$E72D,$E729,$E724,$E711,$E7FF,$E7F4
	dw $E7EE,$E7EB,$E7E8,$E7EA,$E7ED,$E7F5,$E7FE,$E718
	dw $E732,$EC33,$F335,$F837,$FC3A,$0040

DATA_02C668:
	dw $0000,$00C1,$FAC5,$F5C8,$E9CC,$DCCF,$C8D4,$C6D4
	dw $C2D5,$C0D6,$BCD6,$B9D7,$B5D8,$B0D9,$ACDB,$A9DC
	dw $A5DD,$A1DF,$9EE0,$9DE1,$9DE1,$9BE2,$97E4,$95E5
	dw $93E6,$92E7,$8EEB,$89F1,$85F8,$83FF,$8204,$820F
	dw $820F,$8416,$861B,$891F,$8D23,$9226,$932A,$952E
	dw $9730,$9B30,$9D2D,$9D29,$9E24,$A111,$A5FF,$A9F4
	dw $ADEE,$B0EB,$B5E8,$B9EA,$BCED,$BFF5,$C2FE,$C618
	dw $C830,$DC33,$E935,$F538,$FA3B,$0040

DATA_02C6E4:
	dw $0000,$00C1,$FCC3,$F9C5,$F1C9,$E8CC,$DACF,$D7D0
	dw $D0D1,$CBD1,$C1D2,$BAD3,$B3D3,$B0D4,$ACD5,$A9D6
	dw $A5D7,$A1D8,$9FD9,$9ED9,$9DD9,$9BDA,$97DC,$95DD
	dw $93DF,$92E0,$8DE5,$89EA,$86F0,$84F4,$82FA,$8200
	dw $820B,$8310,$8414,$8619,$881C,$8A1F,$8A29,$8B2B
	dw $8D2D,$922C,$9528,$9622,$971A,$9B06,$A4F5,$A9EF
	dw $AFEB,$B4E9,$BAE8,$C1E9,$CBEC,$D0F1,$D7FF,$DA18
	dw $DC36,$E836,$F138,$F93B,$FC3D,$0040

;---------------------------------------------------------------------------

DATA_02C760:
	db $43,!REGISTER_BG2HorizScrollOffset : dl $7E5D18

DATA_02C765:
	db $D9 : dw $7E5388
	db $D9 : dw $7E54EC
	db $00

DATA_02C76C:
	dw DATA_02C774,DATA_02C794

DATA_02C770:
	dw DATA_02C7B4,DATA_02C7D4

DATA_02C774:
	dw $0050,$1E48,$3939,$481E,$5000,$48E3,$39C8,$1EB9
	dw $00B1,$E3B9,$C8C8,$B9E3,$B100,$B91E,$C839,$E348

DATA_02C794:
	dw $004E,$1F4A,$3737,$4A1F,$4E00,$4AE2,$37CA,$1FB7
	dw $00B3,$E2B7,$CACA,$B7E2,$B300,$B71F,$CA37,$E24A

DATA_02C7B4:
	dw $0040,$1534,$2D2D,$3415,$4000,$34EC,$2DD4,$15CD
	dw $00C1,$ECCD,$D4D4,$CDEC,$C100,$CD15,$D42D,$EC34

DATA_02C7D4:
	dw $0038,$183B,$2828,$3B18,$3800,$3BE9,$28D9,$18C6
	dw $00C9,$E9C6,$D9D9,$C6E9,$C900,$C618,$D928,$E93B

;-------------------------------------------------------------------------
; Prince Froggy (sprite $045) -- World 3-4 fort boss.  Yoshi is swallowed and
; fights from inside the stomach (sprite $13B Stomach Acid is the hazard).
; See also: ys_boss2.asm.  Raidenthequick: init_prince_froggy.
;-------------------------------------------------------------------------
YI_NorSpr045_PrinceFroggy_Init:
init_prince_froggy:                             ; Raidenthequick: init_prince_froggy
;$02C7F4
	LDA.w $70E2,x
	AND.w #$0010
	BNE.b CODE_02C7FF
	JMP.w CODE_02C8A1

CODE_02C7FF:
	AND.w $7182,x
	BEQ.b CODE_02C873
	INC.w $0B59
	LDA.w #$0017
	JSL.l CODE_spawn_sprite_active
	BCS.b CODE_02C814
	JML.l CODE_03A31E

CODE_02C814:
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w $70E2,x
	SEC
	SBC.w #$0058
	STA.w $70E2,y
	SEC
	SBC.w #$0010
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $7182,x
	SEC
	SBC.w #$0028
	STA.w $7182,y
	SEC
	SBC.w #$0008
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $6FA2,y
	AND.w #$FFE0
	ORA.w #$2000
	STA.w $6FA2,y
	LDA.w #$0000
	STA.w $7542,y
	LDA.w #$0080
	STA.w $7A96,y
	LDA.w #$0060
	STA.w $105C
	JSR.w CODE_02C92C
	LDX.b #$1C
CODE_02C85F:
	LDA.l YI_Global_PaletteMirror[$D1].LowByte,x
	STA.l YI_Global_PaletteMirror[$E1].LowByte,x
	STA.l $702F2E,x
	DEX
	DEX
	BPL.b CODE_02C85F
	LDX.b $12
	BRA.b CODE_02C89D

CODE_02C873:
	LDA.w #$0017
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_02C89D
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$000D
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w $6FA2,y
	ORA.w #$2000
	STA.w $6FA2,y
	LDY.b #$36
	JSL.l CODE_0CE5D6
CODE_02C89D:
	JML.l CODE_03A31E

CODE_02C8A1:
	JSL.l CODE_03AD74
	BCS.b CODE_02C8AA
	JMP.w CODE_02A31D+$01				; Glitch: This jumps to the middle of an instruction!

CODE_02C8AA:
	JSR.w CODE_02C92C
	LDA.w #$0010
	STA.l $7049C6
	DEC
	ASL
	TAX
CODE_02C8B7:
	LDA.w DATA_02C774,x
	STA.l $7049C7,x
	DEX
	DEX
	BPL.b CODE_02C8B7
	LDX.b #$3C
CODE_02C8C4:
	LDA.l DATA_5FE802,x
	STA.l $702E2E,x
	STA.l YI_Global_PaletteMirror[$61].LowByte,x
	DEX
	DEX
	BPL.b CODE_02C8C4
	LDY.b #!REGISTER_BG1HorizScrollOffset
	STY.w HDMA[$03].Destination
	LDY.b #!REGISTER_BG1VertScrollOffset
	STY.w HDMA[$04].Destination
	SEP.b #$20
	LDX.b #$04
CODE_02C8E2:
	LDA.w DATA_02C760,x
	STA.w HDMA[$07].Parameters,x
	DEX
	BPL.b CODE_02C8E2
	LDA.b #$7E5388>>16
	STA.w HDMA[$07].IndirectSourceBank
	LDX.b #$06
CODE_02C8F2:
	LDA.w DATA_02C765,x
	STA.l $7E5D18,x
	DEX
	BPL.b CODE_02C8F2
	REP.b #$20
	LDX.b $12
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7182,x
	LDA.w #$0180
	STA.w $7AF8,x
	LDA.w #$0100
	STA.w $7AF6,x
	STA.w $7A36,x
	INC.w $0C1E
	STZ.w $0C23
	INC.w $0C20
	LDA.w #$070C
	STA.w $0C27
	JML.l CODE_0CDB4D

CODE_02C92C:
	LDY.w $7DF6
	BEQ.b CODE_02C943
CODE_02C931:
	PHY
	LDX.w $7DF6,y
	JSL.l CODE_despawn_sprite_free_slot
	PLY
	DEY
	DEY
	BNE.b CODE_02C931
	STZ.w $7DF6
	LDX.b $12
CODE_02C943:
	RTS

;---------------------------------------------------------------------------

DATA_02C944:
	dw $FFFF,$0001

DATA_02C948:
	dw $FFC0,$0040

DATA_02C94C:
	dw $FE00,$0200

YI_NorSpr045_PrinceFroggy_Main:
main_prince_froggy:                             ; Raidenthequick: main_prince_froggy
; State dispatch via DATA_prince_froggy_state_ptr (Raidenthequick) further below.
;$02C950
	JSR.w CODE_02CDFA
	JSL.l CODE_03AF23
	LDA.w $0CB0
	STA.w !RAM_YI_Global_Layer3YPosLo
	STA.w $60A0
	TXY
	LDA.b $18,x
	ASL
	TAX
	JSR.w (DATA_prince_froggy_state_ptr,x)
	LDA.w #$FC00
	LDY.b $79,x
	BPL.b CODE_02C972
	LDA.w #$0400
CODE_02C972:
	LDY.b #$00
	CLC
	ADC.b $76,x
	BPL.b CODE_02C97B
	LDY.b #$02
CODE_02C97B:
	LDA.b $78,x
	PHA
	SEC
	SBC.w DATA_02C94C,y
	EOR.w DATA_02C948,y
	ASL
	PLA
	BCC.b CODE_02C98F
	CLC
	ADC.w DATA_02C948,y
	STA.b $78,x
CODE_02C98F:
	CLC
	ADC.b $76,x
	STA.b $76,x
	CLC
	ADC.w #$3000
	CMP.w #$6001
	BCC.b CODE_02C9AB
	LDA.b $76,x
	EOR.b $78,x
	BMI.b CODE_02C9AB
	LDA.b $78,x
	EOR.w #$FFFF
	INC
	STA.b $78,x
CODE_02C9AB:
	TXA
	STA.w $6012
	LDA.w $60B0
	STA.w $6014
	LDA.w $60B2
	STA.w $6016
	LDA.w $60C2
	STA.w $6018
	LDX.b #FXCODE_0A8AD0>>16
	LDA.w #FXCODE_0A8AD0
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $601A
	AND.w #$001E
	BEQ.b CODE_02CA03
	ASL
	AND.w $601A
	AND.w #$0014
	BEQ.b CODE_02C9E2
	CMP.w #$0014
	BEQ.b CODE_02CA00
CODE_02C9E2:
	EOR.w #$0014
	LDY.b #$00
	AND.w $601A
	BEQ.b CODE_02C9EE
	LDY.b #$02
CODE_02C9EE:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_02C944,y
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $60B4
	EOR.w DATA_02C944,y
	BPL.b CODE_02CA03
CODE_02CA00:
	STZ.w $60B4
CODE_02CA03:
	LDA.w $601A
	AND.w #$0001
	BEQ.b CODE_02CA67
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CMP.w $6EBE
	BMI.b CODE_02CA67
	LDA.w $60C0
	BEQ.b CODE_02CA1D
	LDA.w $60AA
	BMI.b CODE_02CA67
CODE_02CA1D:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0008
	SEC
	SBC.w $6EBC
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0020
	SEC
	SBC.w $6EBE
	CMP.w #$0080
	BCC.b CODE_02CA3E
	LDA.w #$007F
CODE_02CA3E:
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0060
	STA.w $6004
	LDX.b #FXCODE_0A8DC8>>16
	LDA.w #FXCODE_0A8DC8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState06
	BEQ.b CODE_02CA67
	INC.w $61B4
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w $601C
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_02CA67:
	LDY.w $7D36,x
	DEY
	BPL.b CODE_02CA70
	JMP.w CODE_02CAEF

CODE_02CA70:
	LDA.w $6EBC
	SEC
	SBC.w $7CD6,y
	STA.b $0C
	ASL
	CLC
	ADC.b $0C
	STA.b $0C
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	EOR.b $0C
	STA.b $00
	LDA.w $6EBE
	SEC
	SBC.w $7CD8,y
	STA.b $0E
	ASL
	CLC
	ADC.b $0E
	STA.b $0E
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	EOR.b $0E
	ORA.b $00
	BPL.b CODE_02CAC4
	LDA.w $7542,y
	CMP.w #$0040
	BCC.b CODE_02CACA
	PHB
	TYX
	JSL.l CODE_03B078
	TXY
	PLB
	LDA.b $0C
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $0E
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_02CACA

CODE_02CAC4:
	LDA.w #$0040
	STA.w $7542,y
CODE_02CACA:
	LDA.w $7CD6,y
	SEC
	SBC.w $6EBC
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7CD8,y
	SEC
	SBC.w $6EBE
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0078
	STA.w $6004
	LDX.b #FXCODE_0A8DC8>>16
	LDA.w #FXCODE_0A8DC8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_02CAEF:
	RTL

DATA_02CAF0:
DATA_prince_froggy_state_ptr:                          ; 3-entry $18,x sub-state dispatch
	dw CODE_prince_froggy_state_00_pre_swallow                                ;  0: pre-swallow -- shoot mouth-projectiles
	dw CODE_prince_froggy_state_01_inside_stomach                                ;  1: post-swallow -- inside Froggy's stomach
	dw CODE_prince_froggy_state_02_defeat_stub                                ;  2: defeat / post-uvula-hit

CODE_02CAF6:
CODE_prince_froggy_state_00_pre_swallow:
	TYX
	LDA.w $7AF6,x
	BNE.b CODE_02CB47
	LDA.b $10
	AND.w #$003C
	CLC
	ADC.w #$00C4
	CMP.w #$00D8
	BCC.b CODE_02CB0F
	CMP.w #$00F4
	BCC.b CODE_02CB47
CODE_02CB0F:
	PHA
	LDA.w $7A39,x
	AND.w #$00FF
	STA.b $00
	LSR
	LSR
	ADC.b $00
	LSR
	LSR
	EOR.w #$FFFF
	ADC.w #$0070
	STA.w $7AF6,x
	LDA.w #$013B
	JSL.l CODE_spawn_sprite_active
	PLA
	BCC.b CODE_02CB47
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	PHY
	JSR.w CODE_02D0D9
	PLY
	LDA.b $00
	STA.w $70E2,y
	LDA.b $02
	STA.w $7182,y
CODE_02CB47:
	LDA.w $7AF8,x
	BNE.b CODE_02CBB0
	LDA.w #$0100
	STA.w $7AF8,x
	LDA.w #$002A
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$002C
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0991DB>>16
	LDA.w #FXCODE_0991DB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0002
	BCS.b CODE_02CBB0
	LDA.w #$0043
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0045
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0991DB>>16
	LDA.w #FXCODE_0991DB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	BNE.b CODE_02CBB0
	LDA.b $10
	AND.w #$0001
	CLC
	ADC.w #$0043
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_02CBB0
	LDA.w $70E2,x
	SEC
	SBC.w #$0008
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0074
	STA.w $7182,y
CODE_02CBB0:
	LDA.w $7A96,x
	BEQ.b CODE_02CBF1
	LDA.w $7A98,x
	AND.w #$000F
	CMP.w #$0001
	BNE.b CODE_02CBC7
	LDA.w #!Define_YI_SoundID3F_HitUvula
	JSL.l CODE_push_sound_queue
CODE_02CBC7:
	LDA.w $7A98,x
	AND.w #$0004
	BEQ.b CODE_02CBE6
	LDX.b #$3C
	LDA.w #$7FFF
CODE_02CBD4:
	STA.l YI_Global_PaletteMirror[$61].LowByte,x
	DEX
	DEX
	BPL.b CODE_02CBD4
	LDX.b $12
	LDY.b #$05
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
CODE_02CBE3:
	JMP.w CODE_02CCD3

CODE_02CBE6:
	LDY.b #$45
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.w $7A38,x
	JMP.w CODE_02CC88

CODE_02CBF1:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_02CBE3
	LDA.w $7D38,y
	BEQ.b CODE_02CBE3
	LDA.w $7C76,x
	EOR.w #$FFFF
	INC
	AND.w #$00FF
	XBA
	CMP.w #$FFFF
	BNE.b CODE_02CC0F
	INC
	BRA.b CODE_02CC13

CODE_02CC0F:
	CMP.w #$8000
	ROR
CODE_02CC13:
	STA.b $00
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	ASL
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BCC.b CODE_02CC21
	LDA.w #$0000
CODE_02CC21:
	CLC
	ADC.b $00
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	EOR.w $7C76,x
	ASL
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	BCS.b CODE_02CC36
	EOR.w #$FFFF
	INC
CODE_02CC36:
	CLC
	ADC.b $00
	STA.b $78,x
	BPL.b CODE_02CC41
	EOR.w #$FFFF
	INC
CODE_02CC41:
	PHA
	ASL
	ASL
	ASL
	AND.w #$FF00
	XBA
	CMP.w #$0020
	BCS.b CODE_02CC51
	LDA.w #$0020
CODE_02CC51:
	STA.w $7A96,x
	LDA.w #$0020
	STA.w $7A98,x
	STA.w $61C8
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	PLA
	ASL
	CLC
	ADC.w $7A38,x
	STA.w $7A38,x
	BCC.b CODE_02CC88
	INC.b $18,x
	LDA.w #$0140
	STA.w $7A96,x
	STZ.w $7A38,x
	LDA.w #$0800
	STA.w $61C8
	JSL.l CODE_028925
	JSL.l CODE_02A982
	BRA.b CODE_02CCD3

CODE_02CC88:
	AND.w #$FF00
	XBA
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #DATA_5FD94C
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_5FD94C>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0001
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0007
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08E167>>16
	LDA.w #FXCODE_08E167
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #DATA_5FE8B0
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_5FE8B0>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0061
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$001F
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08E167>>16
	LDA.w #FXCODE_08E167
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_02CCD3:
	LDA.w #DATA_02C774>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.b $14
	AND.w #$0008
	TAY
	BEQ.b CODE_02CCF4
	LDY.b #$02
	LDA.w $7A96,x
	BEQ.b CODE_02CCF4
	LDA.b $14
	AND.w #$0010
	LSR
	LSR
	LSR
	ADC.w #$0004
	TAY
CODE_02CCF4:
	LDA.w DATA_02C76C,y
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDX.b #FXCODE_0A8D8B>>16
	LDA.w #FXCODE_0A8D8B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	RTS

DATA_02CD06:
	dw $0002,$0000,$FFFE,$0000,$0002,$0000,$FFFE,$0000

DATA_02CD16:
	dw $FFFF,$0001

DATA_02CD1A:
	dw $48EC,$492A,$4968,$49A6

DATA_02CD22:
	dw $3958,$3966,$3974,$3982

CODE_02CD2A:
CODE_prince_froggy_state_01_inside_stomach:
	TYX
	LDY.b #$00
	LDA.w $70E2,x
	SEC
	SBC.w #$0008
	CMP.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BEQ.b CODE_02CD47
	BMI.b CODE_02CD3D
	LDY.b #$02
CODE_02CD3D:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_02CD16,y
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_02CD47:
	PHB
	LDA.b $14
	AND.w #$000C
	LSR
	TAY
	REP.b #$10
	LDX.w DATA_02CD22,y
	PHX
	LDX.w DATA_02CD1A,y
	PEA.w $702002>>8
	PLB
	PLB
	LDY.w #$003C
CODE_02CD60:
	LDA.l DATA_master_palette_rom_blob,x
	STA.w $7020C2,y
	DEX
	DEX
	DEY
	DEY
	BPL.b CODE_02CD60
	PLX
	LDY.w #$000C
CODE_02CD71:
	LDA.l DATA_master_palette_rom_blob,x
	STA.w $702002,y
	DEX
	DEX
	DEY
	DEY
	BPL.b CODE_02CD71
	PLB
	SEP.b #$10
	LDA.w #DATA_02C7B4>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.b $14
	AND.w #$0008
	TAY
	BEQ.b CODE_02CD91
	LDY.b #$02
CODE_02CD91:
	LDA.w DATA_02C770,y
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDX.b #FXCODE_0A8D8B>>16
	LDA.w #FXCODE_0A8D8B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_02CDB1
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	INC.b $18,x
	RTS

CODE_02CDB1:
	CMP.w #$0028
	BNE.b CODE_02CDDB
	LDA.w #$8006
CODE_02CDB9:
	STA.w $6106
	LDA.w #!Define_YI_PlayerState06
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $6108
	STZ.w $610A
	STZ.w $61F6
	LDA.w #$0001
	STA.w $610C
	STZ.w $60A8
	STZ.w $60AA
	STZ.w $60DE
	RTS

CODE_02CDDB:
	BCS.b CODE_02CDE1
	LSR.w $6108
	RTS

CODE_02CDE1:
	AND.w #$003F
	BNE.b CODE_02CDF3
	LDA.b $10
	AND.w #$0001
	CLC
	ADC.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
CODE_02CDF3:
	RTS

CODE_02CDF4:
CODE_prince_froggy_state_02_defeat_stub:               ; defeat path takes over outer Main; this is a stub
	TYX
	RTS

DATA_02CDF6:
	dw $0004,$0006

CODE_02CDFA:
	LDA.w $7680,x
	STA.w $6040
	LDA.w $7682,x
	STA.w $6042
	LDX.b #FXCODE_08E4BD>>16
	LDA.w #FXCODE_08E4BD
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #$36BA
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $14
	LDY.w $7A96,x
	BEQ.b CODE_02CE23
	ASL
	ASL
	ASL
	LDY.b #$02
CODE_02CE23:
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w DATA_02CDF6,y
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	ASL
	ASL
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0004
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w !RAM_YI_Global_Layer3XPosLo
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.b $14
	EOR.w #$FFFF
	LSR
	LSR
	LSR
	CLC
	ADC.w !RAM_YI_Global_Layer1YPosLo
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDX.b #FXCODE_0A8F10>>16
	LDA.w #FXCODE_0A8F10
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0690
	LDX.b #FXCODE_0A8C48>>16
	LDA.w #FXCODE_0A8C48
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$0098
	TSB.w !RAM_YI_Global_HDMAEnable
	LDX.b $12
	JSL.l CODE_03AA52
	REP.b #$10
	LDY.w $7362,x
	LDA.l $704582
	SEC
	SBC.w #$0005
	STA.b $00
	CLC
	ADC.w $6020,y
	STA.w $6020,y
	LDA.l $704584
	STA.b $02
	CLC
	ADC.w $6022,y
	STA.w $6022,y
	LDA.w $6028,y
	CLC
	ADC.b $00
	STA.w $6028,y
	LDA.w $602A,y
	CLC
	ADC.b $02
	STA.w $602A,y
	LDX.b $12
	LDA.b $77,x
	AND.w #$00FF
	ASL
	TAX
	LDA.l DATA_sine_lut_8bit_radians,x
	ASL
	ASL
	ASL
	ASL
	AND.w #$FF00
	BPL.b CODE_02CECA
	ORA.w #$00FF
CODE_02CECA:
	XBA
	EOR.w #$FFFF
	SEC
	ADC.b $00
	STA.b $00
	LDA.l DATA_cosine_lut_8bit_radians,x
	ASL
	ASL
	ASL
	ASL
	AND.w #$FF00
	BPL.b CODE_02CEE3
	ORA.w #$00FF
CODE_02CEE3:
	XBA
	CLC
	ADC.b $02
	STA.b $02
	LDX.w #$0004
CODE_02CEEC:
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
	BNE.b CODE_02CEEC
	SEP.b #$10
	LDX.b $12
	LDA.b $00
	CLC
	ADC.w #$0008
	STA.w $7B56,x
	LDA.b $02
	CLC
	ADC.w #$0004
	STA.w $7B58,x
	LDA.b $76,x
	CMP.w $7A36,x
	BEQ.b CODE_02CF6D
	STA.w $7A36,x
	LDY.b #$00
	AND.w #$FF00
	BMI.b CODE_02CF33
	EOR.w #$FF00
	LDY.b #$02
CODE_02CF33:
	XBA
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	TYA
	STA.w $7400,x
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_560000+$6041
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6041)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
CODE_02CF6D:
	RTS

;---------------------------------------------------------------------------

DATA_02CF6E:
	dw $FFA0,$0060

;-------------------------------------------------------------------------
; Giant Shyguy red (sprite ID $043) and green (sprite ID $044).  Mini-boss
; enemies that swallow Yoshi when stomped.  Shared Init for both colours.
;
; NOTE: the two template labels below carry a historical mis-numbering --
; their suffixes read "_042_" / "_043_" but the actual DATA_sprite_inits
; dispatch (Bank03:142-144) places this Init at slots $043 (Red) and $044
; (Green); slot $042 belongs to VerticalPipeEntrance.  The "_042_RedGiant"
; templated label cannot be renamed (it is referenced verbatim by Bank03's
; dl pointer table); corrected-numbering aliases YI_NorSpr043_RedGiantShyguy_Init
; / YI_NorSpr044_GreenGiantShyguy_Init are added at the same address for
; human readability.  The Main, StompRt, and RideYoshiRt sides of these
; sprites already use the correct $043/$044 suffixes.
; Raidenthequick: CODE_init_giant_shyguy / main_giant_shyguy.
;-------------------------------------------------------------------------
YI_NorSpr042_RedGiantShyguy_Init:                    ; historical mis-numbering -- actually slot $043
YI_NorSpr043_GreenGiantShyguy_Init:                  ; historical mis-numbering -- actually slot $044
YI_NorSpr043_RedGiantShyguy_Init:                    ; corrected-numbering alias (slot $043)
YI_NorSpr044_GreenGiantShyguy_Init:                  ; corrected-numbering alias (slot $044)
CODE_init_giant_shyguy:                              ; Raidenthequick: CODE_init_giant_shyguy
CODE_02CF72:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_02CF8F
	LDA.w $6FA0,x
	AND.w #$F9FF
	STA.w $6FA0,x
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
	LDA.w #$0100
	STA.w $75E2,x
CODE_02CF8F:
	LDA.b $10
	AND.w #$0002
	STA.w $7400,x
	TAY
	LDA.w DATA_02CF6E,y
	STA.w $75E0,x
	RTL

;---------------------------------------------------------------------------

DATA_02CF9F:
	db $00,$01,$02,$03,$04,$03,$02

YI_NorSpr043_RedGiantShyguy_Main:
YI_NorSpr044_GreenGiantShyguy_Main:
main_giant_shyguy:                              ; Raidenthequick: main_giant_shyguy
;$02CFA6
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_02CFC9
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w $6FA0,x
	ORA.w #$0600
	STA.w $6FA0,x
	LDA.w $6FA2,x
	ORA.w #$0017
	STA.w $6FA2,x
CODE_02CFC9:
	JSL.l CODE_03AF23
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_02CFED
	INC.b $76,x
	LDA.b $76,x
	CMP.w #$0028
	BCC.b CODE_02D03C
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0300
	STA.w $75E2,x
	LDA.w $6FA2,x
	ORA.w #$0017
	STA.w $6FA2,x
CODE_02CFED:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_02D02D
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w $6FA0,x
	ORA.w #$0600
	STA.w $6FA0,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ASL
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_02D011
	EOR.w #$FFFF
	INC
CODE_02D011:
	LSR
	LSR
	ADC.b $16,x
	CMP.w #$0700
	BCC.b CODE_02D01D
	SBC.w #$0700
CODE_02D01D:
	STA.b $16,x
	XBA
	TAY
	LDA.w DATA_02CF9F,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0020
CODE_02D02D:
	STA.w $7540,x
	LDA.w $75E2,x
	CMP.w #$0400
	BNE.b CODE_02D03C
	JSL.l CODE_03A5B7
CODE_02D03C:
	RTL

;---------------------------------------------------------------------------

CODE_02D03D:
	RTL

;---------------------------------------------------------------------------

CODE_02D03E:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Stomach Acid (sprite $13B) -- the rising acid hazard inside Prince Froggy.
; Raidenthequick: init_froggy_stomach_acid / main_froggy_stomach_acid.
;-------------------------------------------------------------------------
YI_NorSpr13B_StomachAcid_Init:
init_froggy_stomach_acid:                       ; Raidenthequick: init_froggy_stomach_acid
;$02D03F
	RTL

;---------------------------------------------------------------------------

YI_NorSpr13B_StomachAcid_Main:
main_froggy_stomach_acid:                       ; Raidenthequick: main_froggy_stomach_acid
;$02D040
	JSL.l CODE_03AF23
	LDA.w $75E2,x
	BEQ.b CODE_02D04C
	JMP.w CODE_02D09D

CODE_02D04C:
	TXY
	JSR.w CODE_02D0D9
	LDA.b $00
	SEC
	SBC.w $70E2,x
	CLC
	ADC.w #$0008
	CMP.w #$0011
	BCS.b CODE_02D087
	LDA.b $02
	SEC
	SBC.w $7182,x
	CLC
	ADC.w #$0008
	CMP.w #$0011
	BCS.b CODE_02D087
	LDA.b $02
	STA.w $7182,x
	LDA.b $00
	STA.w $70E2,x
	LDA.w #$0006
	STA.w $74A2,x
	INC.b $78,x
	LDA.b $78,x
	CMP.w #$0010
	BCC.b CODE_02D09C
CODE_02D087:
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w $75E2,x
	LDA.w $6FA2,x
	ORA.w #$0001
	STA.w $6FA2,x
	INC.w $7402,x
CODE_02D09C:
	RTL

CODE_02D09D:
	LDY.w $7D36,x
	BEQ.b CODE_02D0A8
	JSL.l CODE_03A858
	BRA.b CODE_02D0AE

CODE_02D0A8:
	LDA.w $7860,x
	LSR
	BCC.b CODE_02D0D8
CODE_02D0AE:
	LDA.w #!Define_YI_SoundID45_SpitSeed
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr221
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$0007
	STA.w $73C2,y
	LDA.w #$0002
	STA.w $7782,y
	JML.l CODE_03A31E

CODE_02D0D8:
	RTL

;---------------------------------------------------------------------------

CODE_02D0D9:
	REP.b #$10
	LDX.b $76,y
	LDA.l $70449E,x
	SEC
	SBC.w #$0008
	LDX.b $18,y
	CLC
	ADC.w $70E2,x
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LSR
	LDX.b $76,y
	CLC
	ADC.l $7044A0,x
	SEC
	SBC.w #$000C
	LDX.b $18,y
	CLC
	ADC.w $7182,x
	STA.b $02
	SEP.b #$10
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

; Sluggy palette gradient tables.  Each row is the BGR-15 colour ramp used while
; Sluggy "wakes up" (Kamek-shrink cinematic flickers between these two ramps).
DATA_02D109:
	dw $3898,$3898,$28A3,$18A7,$08AA,$F8AC,$E8AD,$D8B0
	dw $C8B2,$B8B8,$A0C8,$95E6,$A41C,$0C40,$3870,$3870

DATA_02D129:
	dw $3800,$38F8,$3898,$3898,$28A3,$18A9,$D8B0,$C8B2
	dw $B8B8,$A0C8,$95E6,$A41C,$0C40,$3870,$3870,$3808

;-------------------------------------------------------------------------
; Sluggy the Unshaven (sprite $0D7) -- World 2-4 castle boss.  Kamek
; enlarges a small "Pakkun"/slime into a giant elongated body that the
; SuperFX chip stretch-animates while it lurches across the floor.  This
; Init runs once on spawn: copies a palette gradient (DATA_02D109) into
; CGRAM mirror $702E2E, primes Sluggy's body shape state and clears the
; hitbox-offset words ($7B56/$7B58).  Combat-state byte lives at $18,x;
; the dispatch table is at DATA_sluggy_state_ptr (used by the Main below).
; see also: ys_boss1.asm. See docs/bossengine.md.
;-------------------------------------------------------------------------
YI_NorSpr0D7_SluggyTheUnshaven_Init:
init_sluggy_unshaven:                           ; Raidenthequick: init_sluggy_unshaven
;$02D149
	JSL.l CODE_03AEEB
	LDY.b #$3C
	JSL.l CODE_0CE5D6
	LDA.w #$0010
	STA.l $7049C6
	DEC
	ASL
	TAX
CODE_02D15D:
	LDA.w DATA_02D109,x
	STA.l $7049C7,x
	DEX
	DEX
	BPL.b CODE_02D15D
	LDX.b #$3C
CODE_02D16A:
	LDA.l DATA_5FE54E,x
	STA.l $702E2E,x
	STA.l YI_Global_PaletteMirror[$61].LowByte,x
	DEX
	DEX
	BPL.b CODE_02D16A
	LDX.b $12
	STZ.w $7B56,x
	STZ.w $7B58,x
	LDA.w #$000B
	STA.w $7402,x
	RTL

;---------------------------------------------------------------------------

DATA_02D189:
	dw $FF60,$FF5C,$FF58,$FF54

DATA_02D191:
	dw $FF00,$0100

;-------------------------------------------------------------------------
; Sluggy Main: per-frame state machine.  Dispatches through the table at
; DATA_sluggy_state_ptr keyed by the sluggy state byte ($18,x); writes SuperFX shared
; regs at $6012-$6018 to drive the body shape, then calls FXCODE_0A8390
; (the GSU routine that re-stretches the body sprite each frame).
;
; States 0..4 (see DATA_sluggy_state_ptr below):
;   0 = Pre-combat idle + Kamek arrival cinematic
;   1 = Kamek-enlarge cinematic ($76,x ramps 0 -> $0100 driving body scale)
;   2 = Combat lurch/sway + egg-hit accept (4 hits before defeat)
;   3 = Defeat: body deflates + explosion spawn
;   4 = Post-defeat: body falls + JSL CODE_despawn_sprite_free_slot to boss closer
;
; Kamek arrival cinematic (state 0, see CODE_sluggy_state_arrival below):
;   - Triggered when Yoshi walks within $70 px of the unhatched Sluggy egg.
;   - Plays MusicFade, spawns Kamek (sprite $48) at Sluggy's position via
;     CODE_spawn_sprite_init, arms $7A96 = $80 (Kamek-floats-in timer).
;   - At halfway through ($7A96 == $40), starts boss music ID $09.
;   - At $7A96 == 0, sets $6FA2 bit-0 (Kamek-done flag).
;   - Plays CastleAboutToExplode rumble (sound $87), bumps Sluggy X by +10px,
;     primes the SuperFX palette ramp (DATA_02D109) via JSR CODE_sluggy_run_enlarge_gsu,
;     INCs $18,x to advance to state 1 (enlarge).
;
; Post-state logic in Main (the code after the dispatch call):
;   - GSU output $601A non-zero -> pull player into Sluggy body (chomp).
;   - $6014 non-zero -> nudge eggs away from Sluggy (X-push).
;   - States 0..2 only: check linked egg slot; if hit, transition into
;     egg-impact handling (CODE_02D213 onwards).
; see also: ys_boss1.asm.
;-------------------------------------------------------------------------
YI_NorSpr0D7_SluggyTheUnshaven_Main:
main_sluggy_unshaven:                           ; Raidenthequick: main_sluggy_unshaven
;$02D195
	JSR.w CODE_sluggy_body_predispatch                           ; body predispatch (build segments)
	JSL.l CODE_03AF23                           ; shared sprite housekeeping
	TXY
	LDA.b $18,x                                 ; sluggy state byte
	ASL
	TAX
	JSR.w (DATA_sluggy_state_ptr,x)                       ; dispatch to per-state handler
	TXA
	STA.w $6012                                 ; GSU scratch arg0: sprite slot
	LDA.w $60B0
	STA.w $6014                                 ; GSU scratch arg1: body push-X flag
	LDA.w $60B2
	STA.w $6016                                 ; GSU scratch arg2: body push-Y flag
	LDA.w $60C2
	STA.w $6018                                 ; GSU scratch arg3: body collision-X
	LDX.b #FXCODE_0A8390>>16
	LDA.w #FXCODE_0A8390                        ; GSU: build body OAM
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $601A                                 ; GSU output: player-suck-into-body flag
	BEQ.b CODE_02D1DF
	DEC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror  ; pull player into Sluggy
	LDA.w $093A
	CLC
	ADC.w #$0100                                ; scoot player Y up
	STA.w $093A
	LDA.w $60B4
	BMI.b CODE_02D1DF
	STZ.w $60B4
CODE_02D1DF:
	LDA.w $6014                                 ; X-push request from GSU
	BEQ.b CODE_02D1F6
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	CLC
	ADC.w #$FF80                                ; nudge eggs back from Sluggy
	CMP.w #$FF00
	BPL.b CODE_02D1F3
	LDA.w #$FF00                                ; cap X-vel push
CODE_02D1F3:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
CODE_02D1F6:
	LDA.b $18,x                                 ; state byte
	CMP.w #$0003                                ; >= state 3 (defeat/fall)?
	BCS.b CODE_02D210                           ; yes: skip egg-collision
	LDY.w $7D36,x                               ; linked egg slot
	DEY
	BMI.b CODE_02D210                           ; no linked sprite
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_02D210
	LDA.w $7D38,y                               ; kill-flag
	BNE.b CODE_02D213                           ; egg ready: nudge it
CODE_02D210:
	JMP.w CODE_02D2F3                           ; -> Main exit (RTS to Main wrapper)

CODE_02D213:
	LDA.w $7A38,x
	ASL
	TAX
	LDA.w DATA_02D189,x
	LDX.b $12
	CLC
	ADC.w $70E2,x
	SEC
	SBC.w $7CD6,y
	ASL
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BPL.b CODE_02D235
	LDA.w #$0040
	STA.w $7542,y
CODE_02D235:
	LDX.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	BEQ.b CODE_02D252
	BPL.b CODE_02D240
	LDX.b #$02
CODE_02D240:
	CLC
	ADC.w DATA_02D191,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	EOR.w DATA_02D191,x
	BMI.b CODE_02D252
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
CODE_02D252:
	LDX.b $12
	LDA.w $7CD6,y
	SEC
	SBC.w $70E2,x
	CLC
	ADC.w #$0004
	STA.b $00
	LDA.l $7049CA
	AND.w #$00FF
	CLC
	ADC.w $7182,x
	SEC
	SBC.w $7CD8,y
	BPL.b CODE_02D275
	LDA.w #$0000
CODE_02D275:
	TAY
	AND.w #$00F0
	LSR
	LSR
	LSR
	TAX
	BEQ.b CODE_02D2B5
	PHX
	TYA
	AND.w #$000F
	ASL
	EOR.w #$FFFF
	SEC
	ADC.b $00
	STA.b $02
CODE_02D28D:
	LDA.l $7049C8,x
	AND.w #$FF00
	BPL.b CODE_02D299
	ORA.w #$00FF
CODE_02D299:
	XBA
	CMP.b $02
	BPL.b CODE_02D2A8
	SEP.b #$20
	LDA.b $02
	STA.l $7049C9,x
	REP.b #$20
CODE_02D2A8:
	LDA.b $02
	SEC
	SBC.w #$0020
	STA.b $02
	DEX
	DEX
	BNE.b CODE_02D28D
	PLX
CODE_02D2B5:
	INX
	INX
	TYA
	EOR.w #$000F
	INC
	AND.w #$000F
	ASL
	EOR.w #$FFFF
	SEC
	ADC.b $00
	STA.b $02
CODE_02D2C8:
	LDA.l $7049C8,x
	AND.w #$FF00
	BPL.b CODE_02D2D4
	ORA.w #$00FF
CODE_02D2D4:
	XBA
	CMP.b $02
	BPL.b CODE_02D2E3
	SEP.b #$20
	LDA.b $02
	STA.l $7049C9,x
	REP.b #$20
CODE_02D2E3:
	LDA.b $02
	SEC
	SBC.w #$0020
	STA.b $02
	INX
	INX
	CPX.b #$12
	BCC.b CODE_02D2C8
	LDX.b $12
CODE_02D2F3:
	RTL

; Sluggy main-dispatch table: indexed by sluggy state byte ($18,x) doubled.
; Five states drive the boss across its Kamek-arrival + combat + defeat
; lifecycle.  All handlers RTS (the engine handles RTL itself).
;   state 0: idle / Kamek-arrival cinematic   (CODE_sluggy_state_arrival)
;   state 1: Kamek-enlarge cinematic           (CODE_sluggy_state_enlarge)
;   state 2: combat                            (CODE_sluggy_state_combat)
;   state 3: defeat / shrink                   (CODE_sluggy_state_defeat)
;   state 4: post-defeat fall to floor         (CODE_sluggy_state_fall)
DATA_02D2F4:
DATA_sluggy_state_ptr:
	dw CODE_sluggy_state_arrival                              ; state 0  CODE_sluggy_state_arrival
	dw CODE_sluggy_state_enlarge                              ; state 1  CODE_sluggy_state_enlarge
	dw CODE_sluggy_state_combat                              ; state 2  CODE_sluggy_state_combat
	dw CODE_sluggy_state_defeat                              ; state 3  CODE_sluggy_state_defeat
	dw CODE_sluggy_state_fall                              ; state 4  CODE_sluggy_state_fall

; Pre-Kamek-arrival idle anim frame cycle ($7402,x), driven by $14 & $0018 >> 3
DATA_02D2FE:
DATA_sluggy_idle_anim_frames:
	db $0B,$0C,$0D,$0C

; Pre-enlarge frame cycle (used during arrival cinematic playback).
DATA_02D302:
DATA_sluggy_pre_enlarge_anim_frames:
	db $0D,$0C,$0B,$0C,$0D

; Pre-enlarge per-frame timers paired with DATA_sluggy_pre_enlarge_anim_frames.
DATA_02D307:
DATA_sluggy_pre_enlarge_anim_timers:
	db $20,$04,$04,$01,$01

;-------------------------------------------------------------------------
; CODE_sluggy_state_arrival (state 0): pre-fight idle.
; Waits until Yoshi walks close enough ($7C16 horiz distance < $0070), then:
;   1. Fades current music.                $RAM_PlayMusicLo = $FF
;   2. Spawns Kamek (sprite $48) above Sluggy at his X/Y.
;   3. Sets a $80-frame countdown ($7A96,x) -- the "Kamek floating in" phase.
; Once $6FA2,x bit-0 is set (signal from the Kamek-finished-shrink/enlarge
; helper at the SuperFX side), advances to state 1 via INC $18,x and starts
; the Kamek-enlarge music ($09 = boss theme).  Falls through to the idle anim
; cycle (DATA_sluggy_idle_anim_frames) every frame until Kamek arrives.
;-------------------------------------------------------------------------
CODE_02D30C:
CODE_sluggy_state_arrival:
	TYX
	LDA.w $6FA2,x                               ; bit-0 = "Kamek done" signal
	AND.w #$001F
	BNE.b CODE_sluggy_arrival_done                           ; Kamek done -> begin enlarge
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState02_InCutscene
	BEQ.b CODE_sluggy_arrival_cutscene                           ; already in cutscene: tick down
	LDA.w $7C16,x                               ; Yoshi-relative X distance
	CMP.w #$0070
	BPL.b CODE_sluggy_idle_animate                           ; Yoshi too far: only animate
	LDA.w #!Define_YI_MusicID_FadeMusicCommand  ; fade out castle music
	STA.w !RAM_YI_Global_PlayMusicLo
	LDA.w #$0080                                ; $80-frame "Kamek floats in" timer
	STA.w $7A96,x
	LDA.w #$0048                                ; spawn Kamek (ambient $48)
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_sluggy_idle_animate                           ; spawn failed: skip pos copy
	LDA.w $70E2,x                               ; copy Sluggy's X to Kamek slot
	STA.w $70E2,y
	LDA.w $7182,x                               ; copy Sluggy's Y to Kamek slot
	STA.w $7182,y
; Idle anim path: cycle DATA_sluggy_idle_anim_frames (4-frame) keyed by $14 (global frame counter).
CODE_02D346:
CODE_sluggy_idle_animate:
	LDA.b $14                                   ; global frame counter
	AND.w #$0018
	LSR
	LSR
	LSR
	TAY
	LDA.w DATA_sluggy_idle_anim_frames,y                         ; 4-entry frame cycle
	AND.w #$00FF
	STA.w $7402,x                               ; sprite anim frame
	PLA                                         ; discard JSR return -> RTL out of Main entirely
	RTL

; Cutscene-active path: tick down $7A96 (Kamek-floats-in timer); when
; halfway, kick off boss music ID $09.  When timer hits 0, jiggle anim
; frame and on overflow set $6FA2 bit-0 to signal Kamek-done -> next frame
; the dispatch above transitions to state 1.
CODE_02D35A:
CODE_sluggy_arrival_cutscene:
	LDA.w $7A96,x                               ; Kamek-floats-in timer
	BEQ.b CODE_02D368
	LSR
	BNE.b CODE_sluggy_idle_animate
	LDA.w #!Define_YI_MusicID09_BossBattle ; play boss music ID
	STA.w !RAM_YI_Global_PlayMusicLo
CODE_02D368:
	LDA.b $14
	AND.w #$0003
	BNE.b CODE_02D389
	INC.w $7402,x                               ; advance anim
	LDA.w $7402,x
	CMP.w #$0010
	BCC.b CODE_02D389
	LDA.w $6FA2,x
	ORA.w #$0001                                ; set Kamek-done flag
	STA.w $6FA2,x
	LDA.w #$0040                                ; flash duration for enlarge
	STA.w $7542,x
CODE_02D389:
	PLA
	RTL

; Kamek-done branch (from state 0 entry via $6FA2 bit-0): runs once the
; arrival flag flips.  Plays Splash2 sound + the "Castle about to explode"
; cinematic sound, sets pre-enlarge anim, then JSR CODE_sluggy_run_enlarge_gsu (the SuperFX
; palette ramp routine used by state 1) and bumps Sluggy X by $0A px to
; ready the enlarge animation centred-on-body.  INC $18,x transitions to
; state 1 (CODE_sluggy_state_enlarge).
CODE_02D38B:
CODE_sluggy_arrival_done:
	LDA.w $7860,x                               ; collision flags
	LSR
	BCC.b CODE_02D389                           ; not landed: keep ticking
	LDA.w $7542,x                               ; flash duration
	BEQ.b CODE_sluggy_pre_enlarge_anim
	LDA.w #!Define_YI_SoundID60_Splash2         ; landing splash
	JSL.l CODE_push_sound_queue
	STZ.w $7542,x
	LDA.w $7042,x
	ORA.w #$0080
	STA.w $7042,x
	LDA.w #$0005                                ; sub-state for $76,x pre-enlarge
	STA.b $76,x
	STZ.w $7A96,x
CODE_02D3B1:
CODE_sluggy_pre_enlarge_anim:
	LDA.w $7A96,x
	BNE.b CODE_02D433
	LDA.b $76,x
	BNE.b CODE_sluggy_pre_enlarge_anim_step                           ; still in pre-enlarge frame cycle
	LDA.w $1015                                 ; Kamek-throw signal counter
	BNE.b CODE_02D3C2
	INC.w $1015                                 ; nudge signal
CODE_02D3C2:
	BPL.b CODE_02D433                           ; not signed yet: idle
	STZ.w $1015                                 ; consume signal
	LDA.w #!Define_YI_SoundID87_CastleAboutToExplode  ; rumble sfx
	JSL.l CODE_push_sound_queue
	INC.b $18,x                                 ; STATE 0 -> STATE 1 (enlarge)
	STZ.w $7402,x
	LDA.w $7182,x
	CLC
	ADC.w #$000F                                ; stash baseline Y for enlarge
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$FE80                                ; small upward velocity (Sluggy pops up)
	STA.w $75E0,x
	LDA.w $7042,x
	AND.w #$FF3F
	STA.w $7042,x
	LDA.w $6FA2,x
	AND.w #$FFE0                                ; clear all arrival flags
	STA.w $6FA2,x
	LDA.w $7040,x
	CLC
	ADC.w #$E000
	STA.w $7040,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	STZ.w $7180,x
	REP.b #$20
	LDA.w #$0018                                ; init combat sub-state byte $76,x
	STA.b $76,x
	JSR.w CODE_sluggy_run_enlarge_gsu                           ; prime SuperFX palette ramp via FXCODE_0A8F57
	LDA.w $70E2,x
	CLC
	ADC.w #$000A                                ; recentre by +10px
	STA.w $70E2,x
	PLA
	RTL

; Pre-enlarge anim cycle: walks $76,x backwards through DATA_sluggy_pre_enlarge_anim_frames (5 frames)
; pairing each with a per-frame timer from DATA_sluggy_pre_enlarge_anim_timers.
CODE_02D41D:
CODE_sluggy_pre_enlarge_anim_step:
	DEC.b $76,x
	LDY.b $76,x
	LDA.w DATA_sluggy_pre_enlarge_anim_frames,y
	AND.w #$00FF
	STA.w $7402,x                               ; commit anim frame
	LDA.w DATA_sluggy_pre_enlarge_anim_timers,y
	AND.w #$00FF
	STA.w $7A96,x                               ; commit frame timer
CODE_02D433:
	PLA
	RTL

; Per-hit (egg) reset-timer table for the combat state below ($7A38,x
; counts egg-hits 0..3): after each hit, $7A96,x = DATA_sluggy_egg_hit_cooldowns[hit_count],
; shortening the cooldown as Sluggy nears defeat.
DATA_02D435:
DATA_sluggy_egg_hit_cooldowns:
	db $80,$64,$48,$2C

;-------------------------------------------------------------------------
; CODE_sluggy_state_enlarge (state 1): Kamek's "Magikoopa enlarge" cinematic.
; Ramps a body-scale counter $76,x from 0 -> $0100 in steps of +1 each
; frame; that scale gets pumped through SuperFX FXCODE_0A8F57 along with
; the palette gradient at DATA_02D109 to produce the stretching body
; animation.  $7049C8 (low byte) returns the current body height; the
; sprite Y is locked to the stashed baseline ($701902,x) minus that height
; so Sluggy's feet stay planted while his head rises.
;
; When $76,x reaches $0100, INC $18,x transitions to state 2 (combat) via
; CODE_sluggy_enlarge_to_combat, which clears player cutscene state and primes combat timers.
; The fall-through label CODE_sluggy_reset_combat_tick is reused from CODE_sluggy_state_combat to
; reset combat-tick state (post-hit zero-clear).
;-------------------------------------------------------------------------
CODE_02D439:
CODE_sluggy_state_enlarge:
	TYX
	LDA.b $76,x                                 ; current body-scale
	CMP.w #$0100
	BCS.b CODE_sluggy_enlarge_to_combat                           ; >= $0100: enlarge done -> state 2
	ADC.w #$0001
	CMP.w #$0100
	BCC.b CODE_sluggy_run_enlarge_gsu
	LDA.w #$0100
CODE_02D44C:
CODE_sluggy_run_enlarge_gsu:
	STA.b $76,x                                 ; commit body-scale
	STA.w !REGISTER_SuperFX_R6_MultiplierLo     ; GSU R6 = scale
	LDA.w #DATA_02D109>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_02D109                          ; bank-relative ptr to palette ramp
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDX.b #FXCODE_0A8F57>>16
	LDA.w #FXCODE_0A8F57                        ; GSU: body-enlarge with palette ramp
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.l $7049C8                               ; GSU output: current body height
	AND.w #$00FF
	EOR.w #$FFFF
	SEC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x  ; baseline Y
	STA.w $7182,x                               ; Sluggy Y = baseline - height (feet stay planted)
	RTS

; Enlarge -> combat transition.
CODE_02D47A:
CODE_sluggy_enlarge_to_combat:
	INC.b $18,x                                 ; STATE 1 -> STATE 2 (combat)
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror  ; end player cutscene lock
; Combat-tick reset helper: clears X-vel, flash-duration, and the
; FXDATA_540000+$70xxx scratch buffer that the lurch animation builds in.
; Also used by combat itself after an egg-hit lands (jumps here via JSR
; CODE_sluggy_reset_combat_tick).
CODE_02D47F:
CODE_sluggy_reset_combat_tick:
	STZ.b $78,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.w $7A38,x                               ; egg-hit count -> cooldown LUT
	LDA.w DATA_sluggy_egg_hit_cooldowns,y
	AND.w #$00FF
	STA.w $7A96,x                               ; arm next cooldown
	LDX.b #$1E
	LDA.w #$0000
CODE_02D498:
	STA.l $704C96,x                             ; clear SuperFX scratch ramp
	DEX
	DEX
	BPL.b CODE_02D498
	LDX.b $12
	RTS

; Combat lurch tables -- indexed by $701900,x (0 = lurch-right, 2 = lurch-left).
DATA_02D4A3:
DATA_sluggy_combat_xvel_lurch:
                             dw $0020,$0000     ; X-vel during lurch dir 0/dir 1

DATA_02D4A7:
DATA_sluggy_combat_lurch_step:
                             dw $0004,$FFFE     ; per-frame $78,x ramp delta (lurch out / lurch back)

DATA_02D4AB:
DATA_sluggy_combat_lurch_max:
                             dw $0040,$0000     ; $78,x value at which to flip direction

; Per-egg-hit-count tables (indexed by $7A38,x doubled, 0..3 hits).
DATA_02D4AF:
DATA_sluggy_hit_phase_threshold:
                             dw $0006,$000A,$000E,$0012  ; "lurch progress at which to retract"

DATA_02D4B7:
DATA_sluggy_hit_max_lurch:
                             dw $0200,$01C0,$0180,$0140  ; max sweep height per hit phase

DATA_02D4BF:
DATA_sluggy_hit_top_anchor:
                             dw $00C0,$00D0,$00E0,$00F0  ; upper sweep anchor per hit phase

DATA_02D4C7:
DATA_sluggy_hit_mid_anchor:
                             dw $0060,$0068,$0070,$0078  ; mid-phase anchor per hit phase

DATA_02D4CF:
DATA_sluggy_hit_base_offset:
                             dw $0040,$0030,$0020,$0010  ; base offset per hit phase

;-------------------------------------------------------------------------
; CODE_sluggy_state_combat (state 2): post-Kamek combat loop.
;
; Each frame:
;   - If $7A96,x is exactly 1 (lurch-init): play Tongue sfx, fall to body draw.
;   - Lurch direction tracked in $701900,x (0 or 2).  Body sweeps left/right;
;     when $70E2 >= $00C5 (off-arena), velocity zeroes.  $78,x ramps via
;     DATA_sluggy_combat_lurch_step until it hits DATA_sluggy_combat_lurch_max, then direction flips.  On flip,
;     reset combat tick via CODE_sluggy_reset_combat_tick.
;   - SuperFX FXCODE_0A8FE2 redraws Sluggy's stretched body each frame.
;   - Egg-hit detection: if linked sprite ($7D36,x) is an egg (status $10
;     and $7D38 non-zero) and inside arena, call CODE_kill_sprite_by_hit_special_cases (kill linked
;     sprite), play HurtBoss sfx, INC $7A38,x.  After 4 hits ($7A38 == 4),
;     INC $18,x advances to state 3 (defeat) and re-primes the body-scale
;     ramp via DATA_02D109.
;-------------------------------------------------------------------------
CODE_02D4D7:
CODE_sluggy_state_combat:
	TYX
	LDA.w $7A96,x                               ; lurch-init cooldown
	BEQ.b CODE_sluggy_combat_lurch
	LSR
	BNE.b CODE_sluggy_combat_anim_tick                           ; > 1: just animate
	LDA.w #!Define_YI_SoundID3E_Tongue          ; cooldown == 1: play tongue sfx
	JSL.l CODE_push_sound_queue
	BRA.b CODE_sluggy_combat_anim_tick

; Lurch tick (no cooldown).
CODE_02D4E9:
CODE_sluggy_combat_lurch:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x  ; lurch dir (0 or 2)
	LDA.w $70E2,x
	CMP.w #$00C5                                ; off-arena threshold
	BMI.b CODE_02D4FC
	LDA.w DATA_sluggy_combat_xvel_lurch,y                         ; sweep velocity for dir
	STA.w $7540,x
	BNE.b CODE_02D502
CODE_02D4FC:
	STZ.w $7540,x                               ; off-arena: zero sweep
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_02D502:
	LDA.b $78,x                                 ; lurch-progress ramp
	CLC
	ADC.w DATA_sluggy_combat_lurch_step,y                         ; +step (positive for dir 0, negative for dir 1)
	STA.b $78,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo     ; GSU R6 = ramp progress
	CMP.w DATA_sluggy_combat_lurch_max,y                         ; reached endpoint?
	BNE.b CODE_02D51B
	TYA
	EOR.w #$0002                                ; flip lurch direction
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_sluggy_combat_dir_reset                           ; dir back to 0: full reset
CODE_02D51B:
	LDX.b #FXCODE_0A8FE2>>16                    ; GSU: body lurch render
	LDA.w #FXCODE_0A8FE2
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	BRA.b CODE_sluggy_combat_anim_tick

CODE_02D528:
CODE_sluggy_combat_dir_reset:
	LDX.b #FXCODE_0A8FE2>>16                    ; GSU: body lurch render
	LDA.w #FXCODE_0A8FE2
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	JSR.w CODE_sluggy_reset_combat_tick                           ; clear sweep + arm next lurch
CODE_02D536:
CODE_sluggy_combat_anim_tick:
	LDA.w $7A98,x                               ; secondary anim timer
	BNE.b CODE_02D542
	LDA.b $14
	AND.w #$0007
	BNE.b CODE_sluggy_combat_sweep_height
CODE_02D542:
	LDX.b #FXCODE_0A8FBB>>16                    ; GSU: head/eye sub-anim
	LDA.w #FXCODE_0A8FBB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_02D54D:
CODE_sluggy_combat_sweep_height:
	LDA.w $7A38,x                               ; egg-hit count (0..3)
	ASL
	TAY                                         ; Y = hit_count * 2 (table index)
	LDA.b $16,x                                 ; current sweep position
	SEC
	SBC.w DATA_sluggy_hit_phase_threshold,y                         ; subtract phase threshold
	BPL.b CODE_02D566                           ; still above threshold
	PHY
	LDA.w #!Define_YI_SoundID14_Gulp            ; reached bottom: gulp sfx
	JSL.l CODE_push_sound_queue
	PLY
	LDA.w DATA_sluggy_hit_max_lurch,y                         ; reset to per-phase max
CODE_02D566:
	STA.b $16,x
	CMP.w DATA_sluggy_hit_top_anchor,y
	BCC.b CODE_02D570
	LDA.w DATA_sluggy_hit_top_anchor,y                         ; clamp to upper anchor
CODE_02D570:
	CMP.w DATA_sluggy_hit_mid_anchor,y
	BCS.b CODE_02D57A
	LDA.w DATA_sluggy_hit_top_anchor,y
	SBC.b $16,x                                 ; reflect around upper anchor
CODE_02D57A:
	CLC
	ADC.w DATA_sluggy_hit_base_offset,y                         ; add per-phase base
	JSR.w CODE_sluggy_draw_body_at_scale                           ; dispatch to dyntile-decode helper
	LDA.w $7A98,x
	BEQ.b CODE_sluggy_combat_check_egg
	CMP.w #$0040
	BCC.b CODE_02D5ED
	JMP.w CODE_sluggy_combat_hit_flash                           ; flash-during-hit branch

; Egg-hit detection.  Linked-egg slot in $7D36,x; require valid Y, in-arena
; X (sprite within $0080..$0201 onscreen), and non-zero kill flag at $7D38.
CODE_02D58E:
CODE_sluggy_combat_check_egg:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_02D5ED                           ; no linked sprite
	LDA.w $7680,x
	CLC
	ADC.w #$0080
	CMP.w #$0201
	BCS.b CODE_02D5ED                           ; off-screen
	LDA.w $7D38,y
	BEQ.b CODE_02D5ED                           ; not actually hit
	TYX                                         ; X = egg slot
	JSL.l CODE_kill_sprite_by_hit_special_cases                           ; kill sprite (despawn egg)
	LDA.w #!Define_YI_SoundID78_HurtBoss        ; HurtBoss sfx
	JSL.l CODE_push_sound_queue
	INC.w $7A38,x                               ; bump egg-hit count
	LDA.w $7A38,x
	CMP.w #$0004                                ; 4 hits = dead
	BCC.b CODE_sluggy_combat_arm_iframes
	INC.b $18,x                                 ; STATE 2 -> STATE 3 (defeat)
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0100
	STA.b $78,x
	LDA.w #$0080
	STA.w $7A96,x
	JSL.l CODE_02A982
	LDA.l $7049C6
	DEC
	ASL
	TAX
; Post-egg-hit ramp init: copies DATA_02D109 (palette gradient) into the
; SuperFX scratch ring at $704C76 to flash the body during the i-frames
; after a hit lands.
CODE_02D5DA:
CODE_sluggy_combat_copy_ramp:
	LDA.w DATA_02D109,x
	STA.l $704C76,x
	DEX
	DEX
	BPL.b CODE_sluggy_combat_copy_ramp
	LDX.b $12
CODE_02D5E7:
CODE_sluggy_combat_arm_iframes:
	LDA.w #$0060                                ; $60-frame i-frame window
	STA.w $7A98,x
CODE_02D5ED:
	RTS

; Hit-flash helper: write white ($7FFF) over Sluggy's palette row $61 if
; $7A98 bit-2 high, else restore from $702E2E mirror.  Strobes the body
; during egg-hit i-frames.
CODE_02D5EE:
CODE_sluggy_combat_hit_flash:
	AND.w #$0004                                ; sample bit-2 of timer
	BEQ.b CODE_sluggy_combat_hit_unflash
	LDX.b #$3C
	LDA.w #$7FFF                                ; white
CODE_02D5F8:
	STA.l YI_Global_PaletteMirror[$61].LowByte,x
	DEX
	DEX
	BPL.b CODE_02D5F8
	LDX.b $12
	RTS

CODE_02D603:
CODE_sluggy_combat_hit_unflash:
	LDX.b #$3C
CODE_02D605:
	LDA.l $702E2E,x                             ; restore base palette
	STA.l YI_Global_PaletteMirror[$61].LowByte,x
	DEX
	DEX
	BPL.b CODE_02D605
	LDX.b $12
	RTS

;-------------------------------------------------------------------------
; CODE_sluggy_state_defeat (state 3): Sluggy deflates after the 4th egg-hit.
; Freezes Yoshi (FreezeYoshiFlag = 1), ticks the deflate cooldown $7A96.
; On non-zero cooldown:
;   - When $7A96 == 1, play Growth sfx (the "Kamek shrinks" sound) once.
;   - Flash-strobe palette via CODE_sluggy_combat_hit_flash.
;   - Animate via FXCODE_0A8FBB (the eye sub-anim) + dispatch to body
;     redraw helper CODE_sluggy_draw_body_at_scale with the current body-scale in A.
; On cooldown 0 (deflate finished):
;   - Decrement body-scale $78,x by $0004 per frame; floor at $0010.
;   - When the floor is hit, play Pop sfx, INC $18,x (advance to state 4),
;     clear flags, spawn AmbSpr $1C0 (explosion puff) at Sluggy+head, and
;     re-arm $7A96 = $40 for the post-fall delay.
; Tail: CODE_02D698/CODE_sluggy_draw_body_at_scale reuses the body-draw stub (sets up FX
; registers + JSLs FXCODE_088293 to push tiles to OAM).
;-------------------------------------------------------------------------
CODE_02D614:
CODE_sluggy_state_defeat:
	TYX
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror  ; lock Yoshi during defeat
	LDA.w $7A96,x                               ; deflate cooldown
	BEQ.b CODE_sluggy_defeat_shrink                           ; cooldown done: shrink body
	LSR
	BNE.b CODE_sluggy_defeat_flash_anim
	LDA.w #!Define_YI_SoundID15_Growth          ; play shrink sfx once
	JSL.l CODE_push_sound_queue
CODE_02D62A:
CODE_sluggy_defeat_flash_anim:
	LDA.w $7A96,x
	JSR.w CODE_sluggy_combat_hit_flash                           ; strobe palette during defeat
	LDX.b #FXCODE_0A8FBB>>16
	LDA.w #FXCODE_0A8FBB                        ; GSU: head/eye sub-anim
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.b $78,x
	JMP.w CODE_sluggy_draw_body_at_scale                           ; redraw body at current scale

CODE_02D640:
CODE_sluggy_defeat_shrink:
	LDA.b $78,x                                 ; current body-scale
	SEC
	SBC.w #$0004                                ; shrink per frame
	CMP.w #$0010
	BCS.b CODE_02D698                           ; still > $10: keep shrinking
	LDA.w #!Define_YI_SoundID3B_Pop             ; defeat pop
	JSL.l CODE_push_sound_queue
	INC.b $18,x                                 ; STATE 3 -> STATE 4 (fall)
	LDA.w #$FFFF
	STA.w $7A38,x
	LDA.w $7040,x
	SEC
	SBC.w #$2000                                ; drop a tile-priority bit
	STA.w $7040,x
	LDA.w #$0040                                ; arm fall-state cooldown
	STA.w $7A96,x
	LDA.w #!Define_YI_AmbSpr1C0                 ; spawn ambient explosion puff
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	CLC
	ADC.w $6000                                 ; +head offset from GSU
	SEC
	SBC.w #$0008
	STA.w $70A2,y                               ; ambient X
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w $7142,y                               ; ambient Y
	LDA.w #$0004
	STA.w $7E4C,y
	LDA.w #$0006
	STA.w $7782,y
	LDA.w #$0010                                ; lock body-scale at $10
CODE_02D698:
	STA.b $78,x
CODE_02D69A:
CODE_sluggy_draw_body_at_scale:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo     ; R6 = body-scale
	LDY.w $7722,x                               ; dyntile slot index
	TYX
	LDA.w #$0040
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STZ.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #FXDATA_560000+$60C1
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$60C1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088293>>16
	LDA.w #FXCODE_088293                        ; GSU: dyntile decode + push to OAM
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9                                 ; dyntile job counter
	LDX.b $12
	RTS

;-------------------------------------------------------------------------
; CODE_sluggy_state_fall (state 4): body topples and rolls off-screen.
; Phase A (cooldown != 0 -- initial setup):
;   - When $7A96 == 1, play BossFalling sfx, init fall ramp:
;       $78,x = $1000  (horizontal-roll progress)
;       $76,x = $0100  (body-scale to feed GSU)
;       $75E0,x = 0    (Y-velocity)
;       Kick FXCODE_0A8F57 with DATA_02D129 (alt palette ramp) so the
;       body re-flips its colour gradient.
; Phase B (cooldown == 0 -- per-frame roll):
;   - Decrement $78,x by 8 (or 4 when above ramp threshold).  Floor at 0.
;   - On non-zero roll, scale $76,x = $78 / 16 and render via FXCODE_0A90FF.
;   - On roll == 0 (CODE_sluggy_fall_settle): if Sluggy hasn't hit floor ($7682 < $E0),
;     give Y-velocity $200 and return; once floor hit, JSL CODE_02E19C
;     (boss-fade screen helper) + JSL CODE_despawn_sprite_free_slot (boss-closer cinematic
;     hand-off), clear SubScreen, drop HDMA channels $18, and PLA/RTL out
;     of the Sluggy slot entirely (terminates the entire boss frame).
;-------------------------------------------------------------------------
CODE_02D6CE:
CODE_sluggy_state_fall:
	TYX
	LDA.w $7A96,x                               ; phase-A cooldown
	BEQ.b CODE_sluggy_fall_roll                           ; cooldown done: phase B (roll)
	LDA.w $7A96,x
	LSR
	BNE.b CODE_02D708
	LDA.w #!Define_YI_SoundID82_BossFalling     ; falling sfx
	JSL.l CODE_push_sound_queue
	LDA.w #$1000
	STA.b $78,x                                 ; init roll progress
	STZ.w $75E0,x                               ; zero Y-vel
	LDA.w #$0100
	STA.b $76,x                                 ; init scale param
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #DATA_02D129>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_02D129                          ; alt-palette gradient
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDX.b #FXCODE_0A8F57>>16
	LDA.w #FXCODE_0A8F57                        ; GSU: body-enlarge w/ new gradient
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_02D708:
	RTS

; Phase B: per-frame roll.
CODE_02D709:
CODE_sluggy_fall_roll:
	LDA.b $78,x                                 ; roll progress
	BEQ.b CODE_sluggy_fall_settle                           ; 0: roll done -> floor check
	CMP.w #$0100
	LDA.w #$FFF8                                ; step = -8 typical
	BCC.b CODE_02D720
	LDA.w $75E0,x
	CMP.w #$FFD0
	BMI.b CODE_02D720
	DEC.w $75E0,x                               ; accelerate Y-velocity slowly
CODE_02D720:
	CLC
	ADC.b $78,x
	BPL.b CODE_02D728
	LDA.w #$0000                                ; floor at 0
CODE_02D728:
	STA.b $78,x                                 ; commit roll
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LSR
	LSR
	LSR
	LSR
	STA.b $76,x                                 ; scale = roll / 16
	CMP.w #$0020
	BCS.b CODE_02D73E
	LDA.w #$00FF
	STA.w $74A2,x                               ; near-end: enable fade-out
CODE_02D73E:
	LDA.w #DATA_02D129>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_02D129
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDX.b #FXCODE_0A90FF>>16
	LDA.w #FXCODE_0A90FF                        ; GSU: roll-and-fade body draw
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	RTS

; Roll done: drop to floor, then trigger boss closer.
CODE_02D756:
CODE_sluggy_fall_settle:
	LDA.w $7682,x                               ; current Y-screen
	CMP.w #$00E0                                ; below visible floor?
	BPL.b CODE_sluggy_fall_close_boss
	LDA.w #$0200                                ; not yet: give Y-vel
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_02D765:
CODE_sluggy_fall_close_boss:
	LDA.w $70E2,x
	STA.b $00                                   ; arg0 = X
	LDA.w $7182,x
	STA.b $02                                   ; arg1 = Y
	JSL.l CODE_02E19C                           ; boss-fade screen helper
	JSL.l CODE_despawn_sprite_free_slot                           ; boss closer: queue closer-wall, despawn
	STZ.w !RAM_YI_Global_SubScreenLayers
	LDA.w #$0018
	TRB.w !RAM_YI_Global_HDMAEnable             ; drop HDMA channels 3,4
	PLA                                         ; pop Main's return -> RTL terminates frame
	RTL

;---------------------------------------------------------------------------

; Per-body-segment SuperFX parameter tables (7 segments).  Each row is
; consumed by the per-frame body-stretch dispatcher CODE_sluggy_body_predispatch below via
; an index Y that walks 0,4,8,...,$18 (or starting at $0A when post-defeat).
DATA_02D782:
DATA_sluggy_segment_r8_height:
                             dw $0008,$0008,$0008,$0008,$0010,$0006,$0010  ; R8 = body-segment merge-Y

DATA_02D790:
DATA_sluggy_segment_r9_height:
                             dw $0008,$000F,$000F,$0008,$001F,$001C,$0010  ; R9 = body-segment GP3

DATA_02D79E:
DATA_sluggy_segment_loop_counter:
                             dw FXDATA_560000+$6081,FXDATA_560000+$7081,FXDATA_560000+$6091,FXDATA_560000+$7091,FXDATA_560000+$60A1,FXDATA_560000+$60E1,FXDATA_560000+$60C1

DATA_02D7AC:
DATA_sluggy_segment_r3_purpose:
                             dw $0000,$0000,$0010,$0010,$0020,$0060,$0040  ; R3 = body-segment general-purpose

DATA_02D7BA:
DATA_sluggy_segment_r2_ycoord:
                             dw $0000,$0010,$0000,$0010,$0000,$0000,$0000  ; R2 = body-segment plot-Y

DATA_02D7C8:
DATA_sluggy_segment_gsu_routine:
                             dw FXCODE_088619,FXCODE_088619,FXCODE_088619,FXCODE_088619,FXCODE_088293,FXCODE_088293,FXCODE_088293

;-------------------------------------------------------------------------
; CODE_sluggy_body_predispatch: runs at the top of every Sluggy
; Main frame BEFORE the state-machine dispatch in DATA_sluggy_state_ptr.
; If $18,x == 0 (still in arrival state), jumps to the simple per-segment
; body builder at CODE_sluggy_build_body_segments.
; Otherwise, primes SuperFX color-math + HDMA channels $18 (for the body's
; alpha-blend overlay), runs FXCODE_08E4BD (body-pixel transform setup),
; uploads 840-byte SuperFX scratch ($7E5040 -> $703372), then writes the
; main-screen and color-math enable bits.  Falls into CODE_sluggy_body_elastic_setup which
; configures FXCODE_0A9039 (the elastic body stretch core) and only then
; jumps to the per-segment builder.  Returns RTS to the boss Main, which
; then dispatches the state handler via DATA_sluggy_state_ptr.
;-------------------------------------------------------------------------
CODE_02D7D6:
CODE_sluggy_body_predispatch:
	LDA.b $18,x                                 ; sluggy state byte
	BNE.b CODE_sluggy_body_setup_gsu
	JMP.w CODE_sluggy_build_body_segments                           ; state 0: only build segments

CODE_02D7DD:
CODE_sluggy_body_setup_gsu:
	LDA.w $7680,x
	STA.w $6040                                 ; GSU scratch: BG1X
	LDA.w $7682,x
	STA.w $6042                                 ; GSU scratch: BG1Y
	LDX.b #FXCODE_08E4BD>>16
	LDA.w #FXCODE_08E4BD                        ; GSU: body-pixel transform setup
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E5040,$703372 : dw $0348  ; WRAM->CARTRAM body buffer
	LDA.w #$0215
	STA.w !RAM_YI_Global_MainScreenLayers       ; show BG1/2/4 + sprites
	LDY.b #$75
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.w #$0018
	TSB.w !RAM_YI_Global_HDMAEnable             ; HDMA ch 3+4 for body overlay
	LDX.b $12
	LDA.w $7362,x                               ; body-fadeout flag
	BPL.b CODE_sluggy_body_elastic_setup
	RTS

; CODE_sluggy_body_elastic_setup: configure FXCODE_0A9039 with body offsets,
; then fall into CODE_sluggy_build_body_segments.
CODE_02D817:
CODE_sluggy_body_elastic_setup:
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7680,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7682,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.l $7049DE
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l $7049C8
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.l $7049C8
	SEC
	SBC.l $7049CA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A38,x
	STA.w $6000                                 ; GSU arg0: egg-hit count
	LDA.b $76,x
	STA.w $6002                                 ; GSU arg1: body-scale
	LDX.b #FXCODE_0A9039>>16
	LDA.w #FXCODE_0A9039                        ; GSU: elastic body deform
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $6000                                 ; GSU output: body-base-X
	CLC
	ADC.w #$0010
	STA.w $7B56,x                               ; commit X-hitbox offset
; CODE_sluggy_build_body_segments: walks 7 body segments (Y=$0C..$00 by -4)
; pushing each segment's GSU params through DATA_sluggy_segment_r8_height..DATA_sluggy_segment_gsu_routine.
; The loop body sometimes calls FXCODE_088619 (vertical body slice
; renderer) and sometimes FXCODE_088293 (the standard dyntile-decode
; helper) depending on DATA_sluggy_segment_gsu_routine[y].
CODE_02D863:
CODE_sluggy_build_body_segments:
	LDA.b $76,x                                 ; current body-scale
	CMP.w $7A36,x                               ; same as last frame?
	BEQ.b CODE_02D8C7                           ; yes: skip rebuild
	STA.w $7A36,x                               ; cache new scale
	CMP.w #$0020
	BCS.b CODE_02D875
	LDA.w #$0020
CODE_02D875:
	STA.b $00
	LDY.b #$0C
	LDA.w $7A38,x
	BPL.b CODE_02D880
	DEY
	DEY
CODE_02D880:
	LDA.w $0030
	LSR
	BCC.b CODE_02D888
	DEY
	DEY
CODE_02D888:
	LDA.w DATA_sluggy_segment_r8_height,y
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w DATA_sluggy_segment_r9_height,y
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.b $00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w DATA_sluggy_segment_loop_counter,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_560000+$6081)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w DATA_sluggy_segment_r2_ycoord,y
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w DATA_sluggy_segment_r3_purpose,y
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_088619>>16
	LDA.w DATA_sluggy_segment_gsu_routine,y
	PHY
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLY
	DEY
	DEY
	DEY
	DEY
	BPL.b CODE_02D888
	INC.w $0CF9
	LDX.b $12
CODE_02D8C7:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Vertical Pipe Entrance (sprite $042 -- the duplicate-of-Giant-Shyguy ID
; resolved by the level-data context) and Secret Pipe (sprite $0D1).
; Both Inits set the contact flag bit $0008 on $70E2 and seed the entrance
; cooldown to 1.  The Main below uses $7D36 (player-state pointer) to
; detect "Yoshi is pressing down on the mouth tile".
; see also: ys_enmy8.asm (pipe-entrance sprites).
;-------------------------------------------------------------------------
YI_NorSpr042_VerticalPipeEntrance_Init:
YI_NorSpr0D1_SecretPipeEntrance_Init:
init_vertical_entrance:                         ; Raidenthequick: init_vertical_entrance
;$02D8C8
	LDA.w $70E2,x
	ORA.w #$0008
	STA.w $70E2,x
	LDA.w #$0001
	STA.w $7BB6,x
	STA.w $7BB8,x
	STZ.w $7B58,x
	RTL

;---------------------------------------------------------------------------

; Secret-pipe Main: requires entrance-distance check via CODE_02D985 with
; arg $02 (sniff radius); pipe only accepts entry when carry set on return.
YI_NorSpr0D1_SecretPipeEntrance_Main:
main_hidden_vertical_entrance:                  ; Raidenthequick: main_hidden_vertical_entrance
;$02D8DE
	LDY.b #$02
	JSL.l CODE_02D985
	BCS.b CODE_main_vertical_entrance
	RTL

; Public vertical-pipe Main: skips the distance check; just runs the entrance
; sound + freeze-sprites + player-warp shared path at CODE_main_vertical_entrance.
YI_NorSpr042_VerticalPipeEntrance_Main:
CODE_main_vertical_entrance:                         ; Raidenthequick: CODE_main_vertical_entrance
CODE_02D8E7:
	JSL.l CODE_03AF23
	JSR.w CODE_02D908
	BCC.b CODE_02D907
	LDA.w $0036
	AND.w #$0004
	BEQ.b CODE_02D907
	LDA.w #$0006
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	JSR.w CODE_02CDB9
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $610E
CODE_02D907:
	RTL

CODE_02D908:
	LDY.w $7D36,x
	BPL.b CODE_02D91C
	LDA.w $61B2
	BPL.b CODE_02D91C
	LDA.w $60C0
	ORA.w $6150
	BNE.b CODE_02D91C
	SEC
	RTS

CODE_02D91C:
	CLC
	RTS

;---------------------------------------------------------------------------

DATA_02D91E:
	dw $0008,$FFF8

;-------------------------------------------------------------------------
; Horizontal pipe entrances.  The "to-left" variant just sets the direction
; byte to 2 then falls into the "to-right" Init below; both ultimately call
; FXCODE_0ACE2F to register the entrance hitbox with the SuperFX side.
;-------------------------------------------------------------------------
YI_NorSpr147_HorizontalEntranceToLeft_Init:
init_horizontal_entrance_left:                  ; Raidenthequick: init_horizontal_entrance_left
;$02D922
	INC.b $18,x
	INC.b $18,x
YI_NorSpr0D0_HorizontalEntranceToRight_Init:
init_horizontal_entrance_right:                 ; Raidenthequick: init_horizontal_entrance_right
	LDY.b $18,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_02D91E,y
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	STA.w $7182,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.b $18,x
	LDY.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_02D954
	EOR.w #$0002
CODE_02D954:
	STA.w $7400,x
	RTL

;---------------------------------------------------------------------------

DATA_02D958:
	dw $0001,$0002

; Horizontal pipe Main (shared): direction bit $7400,x selects which side of
; controller D-pad ($0036 & {1,2}) opens the entrance.
YI_NorSpr0D0_HorizontalEntranceToRight_Main:
YI_NorSpr147_HorizontalEntranceToLeft_Main:
main_horizontal_entrance:                       ; Raidenthequick: main_horizontal_entrance
;$02D95C
	JSL.l CODE_03AF23
	JSR.w CODE_02D908
	BCC.b CODE_02D984
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BNE.b CODE_02D984
	TAY
	LDA.w $0036
	AND.w DATA_02D958,y
	BEQ.b CODE_02D984
	TYA
	CLC
	ADC.w #$8002
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	JSR.w CODE_02CDB9
CODE_02D984:
	RTL

;---------------------------------------------------------------------------

CODE_02D985:
	LDA.w $7E08
	AND.w #$0008
	BEQ.b CODE_02D9B6
	LDA.w $0030
	AND.w #$0018
	BEQ.b CODE_02D9B4
CODE_02D995:
	TYA
	PHA
	LDA.w #!Define_YI_AmbSpr224
	JSL.l CODE_spawn_ambient_sprite
	PLA
	STA.w $73C2,y
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$0001
	STA.w $7782,y
CODE_02D9B4:
	SEC
	RTL

CODE_02D9B6:
	CLC
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Key-from-Boss (sprite $014): the giant key dropped after a fortress boss
; dies.  Init relocates the key to Yoshi's position and freezes player input
; (DisableInput state $1A); Main runs the celebratory float-and-collect loop.
; see also: ys_enmy*.asm (boss-followup sprite handlers).
;-------------------------------------------------------------------------
YI_NorSpr014_KeyFromBoss_Init:
init_boss_key:                                  ; Raidenthequick: init_boss_key
;$02D9B8
	LDA.w $61B2
	BPL.b CODE_02D9C3
	JSL.l CODE_03AD74
	BCS.b CODE_02D9C6
CODE_02D9C3:
	JMP.w CODE_02AC7B

CODE_02D9C6:
	JSL.l CODE_04F74A
	LDA.w #!Define_YI_PlayerState1A_DisableInput
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w $60C4
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0028
	STA.w $7182,x
	LDA.w #$0002
	STA.w $74A2,x
	LDA.w #$0020
	STA.b $76,x
	JSR.w CODE_02DB37
	JSL.l CODE_02A4F4
	LDA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $0C23
	LDA.w !RAM_YI_Global_Layer1YPosLo
	STA.w $0C27
	LDA.w #$0001
	STA.w $0C1E
	STA.w $0C20
	RTL

;---------------------------------------------------------------------------

YI_NorSpr014_KeyFromBoss_Main:
;$02DA0E
	JSL.l CODE_03AA52
	TXY
	LDA.b $18,x
	ASL
	TAX
	JSR.w (DATA_key_from_boss_state_ptr,x)
	RTL

DATA_02DA1B:
DATA_key_from_boss_state_ptr:                          ; 5-entry $18,x sub-state dispatch
	dw CODE_key_from_boss_state_00_emerge                                ;  0: emerge from defeated boss
	dw CODE_key_from_boss_state_01_drift_to_yoshi                                ;  1: drift to Yoshi's hand
	dw CODE_key_from_boss_state_02_post_pickup_glow                                ;  2: post-pickup glow
	dw CODE_key_from_boss_state_03_pre_keyhole                                ;  3: pre-keyhole cinema
	dw CODE_key_from_boss_state_04_insert_key                                ;  4: insert/turn key (level-clear)

DATA_02DA25:
	dw $0004,$0004,$0004,$0024,$0014,$0014,$0004,$0005
	dw $00C0,$0020,$0040,$0004,$0034,$0004,$0004,$0004
	dw $0001

DATA_02DA47:
	dw $0125,$0126,$0127,$0128,$0129,$012A,$012B,$012C
	dw $012C,$012C,$012C,$012D,$012E,$012F,$0130,$0000
	dw $0000

DATA_02DA69:
	dw $002B,$002C,$002D,$002E,$002F,$0030,$0031,$0031
	dw $0031,$0031,$0031,$0032,$0032,$0033,$0034,$000D
	dw $000D

CODE_02DA8B:
	JSL.l CODE_06C9D7
	LDA.w $7A98,x
	BNE.b CODE_02DAB9
	LDA.b $78,x
	INC.b $78,x
	ASL
	TAY
	CPY.b #$18
	BNE.b CODE_02DAA7
	PHY
	LDA.w #!Define_YI_SoundID43_MountYoshi
	JSL.l CODE_push_sound_queue
	PLY
CODE_02DAA7:
	LDA.w DATA_02DA25,y
	STA.w $7A98,x
	LDA.w DATA_02DA47,y
	STA.w $60BE
	LDA.w DATA_02DA69,y
	STA.w $7402
CODE_02DAB9:
	RTS

CODE_02DABA:
	LDA.b $14
	AND.w #$0007
	BNE.b CODE_02DAC8
	LDA.w #$1010
	JSL.l CODE_029BD9
CODE_02DAC8:
	RTL

CODE_02DAC9:
CODE_key_from_boss_state_00_emerge:
	TYX
	LDY.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CPY.b #$09
	BNE.b CODE_02DADF
	LDA.w $0C27
	CMP.w #$0080
	BMI.b CODE_02DADF
	DEC.w $0C27
	DEC.w $60A0
CODE_02DADF:
	LDY.b $78,x
	CPY.b #$04
	BCS.b CODE_02DAE8
	JSR.w CODE_02DA8B
CODE_02DAE8:
	LDA.b $76,x
	CLC
	ADC.w #$0002
	CMP.w #$0100
	BCC.b CODE_02DAFE
	INC.b $18,x
	LDA.w #$0001
	STA.w $7542,x
	LDA.w #$0100
CODE_02DAFE:
	STA.b $76,x
	BRA.b CODE_02DB37

CODE_02DB02:
CODE_key_from_boss_state_01_drift_to_yoshi:
	TYX
	JSL.l CODE_02DABA
	LDY.b $78,x
	CPY.b #$05
	BCS.b CODE_02DB10
	JSR.w CODE_02DA8B
CODE_02DB10:
	LDA.w $7C18,x
	SEC
	SBC.w #$FFE4
	BMI.b CODE_02DB37
	INC.b $18,x
	EOR.w #$FFFF
	SEC
	ADC.w $7182,x
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w #$0100
	STA.w $7A36,x
	LDA.w #$00E0
	STA.w $7A38,x
CODE_02DB37:
	LDA.b $14
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
	LDA.w #FXDATA_548000+$40E0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$40E0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTS

DATA_02DB72:
	dw $0010

DATA_02DB74:
	dw $FFF0,$0010

DATA_02DB78:
	dw $0120

DATA_02DB7A:
	dw $FFE0,$00F0

CODE_02DB7E:
CODE_key_from_boss_state_02_post_pickup_glow:
	TYX
	JSL.l CODE_02DABA
	JSR.w CODE_02DA8B
	LDY.b $78,x
	CPY.b #$08
	BNE.b CODE_02DB92
	DEC.w $70E2,x
	DEC.w $7182,x
CODE_02DB92:
	LDY.b $78,x
	CPY.b #$0A
	BCC.b CODE_02DC03
	INC.b $18,x
	LDA.w #!Define_YI_MusicID06_BonusAndBossTheme
	STA.w !RAM_YI_Global_PlayMusicLo
	LDA.w #$00FF
	STA.w $74A2,x
	STZ.b $76,x
	LDY.b #$02
	STY.w $011C
	STZ.w !RAM_YI_Level_LevelHeaderAnimationTilesetLo
	STZ.w !RAM_YI_Level_LevelHeaderAnimationPaletteLo
	LDY.b #$0F
	STY.w !RAM_YI_Level_LevelHeaderBGScrollSettingLo
	STZ.w !RAM_YI_Level_LevelHeaderLevelModeLo
	LDA.w #$1014
	STA.w !RAM_YI_Global_MainScreenLayers
	LDY.b #$69
	STY.w !RAM_YI_Global_BGModeAndTileSizeSetting
	LDY.b #$02
	STY.w !RAM_YI_Global_BG3And4TileDataDesignation
	LDY.b #$34
	STY.w !RAM_YI_Global_BG3AddressAndSize
	STZ.w $0948
	LDA.w #!Define_YI_SoundID64_UnlockDoor
	JSL.l CODE_push_sound_queue
	JSL.l CODE_02A4F4
	REP.b #$10
	LDA.w #$00B0
	JSL.l CODE_00B753
	SEP.b #$10
	LDA.w #$B400
	STA.w $0CF9
	LDX.b #$24
CODE_02DBF1:
	LDA.l DATA_5FFA5E,x
	STA.l YI_Global_PaletteMirror[$01].LowByte,x
	STA.l $702D6E,x
	DEX
	DEX
	BPL.b CODE_02DBF1
	LDX.b $12
CODE_02DC03:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_02DC0B
	JMP.w CODE_02DCDE

CODE_02DC0B:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	TAY
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7A36,x
	SEC
	SBC.w DATA_02DB78,y
	EOR.w DATA_02DB72,y
	STA.b $00
	BMI.b CODE_02DC3B
	LDA.w $7A38,x
	SEC
	SBC.w #$002C
	STA.w $7A38,x
	TYA
	EOR.w #$0002
	TAY
CODE_02DC3B:
	LDA.w $7A38,x
	SEC
	SBC.w DATA_02DB7A,y
	EOR.w DATA_02DB74,y
	STA.b $02
	BMI.b CODE_02DC58
	LDA.w $7A36,x
	SEC
	SBC.w #$002C
	STA.w $7A36,x
	TYA
	EOR.w #$0002
	TAY
CODE_02DC58:
	TYA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $7A36,x
	CLC
	ADC.w DATA_02DB72,y
	STA.w $7A36,x
CODE_02DC66:
	LDA.w $7A38,x
	CLC
	ADC.w DATA_02DB74,y
	STA.w $7A38,x
	LDA.b $00
	EOR.b $02
	BMI.b CODE_02DC7D
	LDA.b $00
	BMI.b CODE_02DC7D
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_02DC7D:
	LDX.b #FXCODE_09A82C>>16
	LDA.w #FXCODE_09A82C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E56D0,$703A02 : dw $0348
	LDA.w #$AAAA
	STA.w !RAM_YI_Global_BG1And2WindowMaskSettings
	LDA.w !RAM_YI_Global_MainScreenLayers
	STA.w !RAM_YI_Global_MainScreenWindowMask
	STZ.w !RAM_YI_Global_BGWindowLogicSettings
	LDY.b #$A0
	STY.w !RAM_YI_Global_ObjectAndColorWindowSettings
	LDY.b #$22
	STY.w !RAM_YI_Global_ColorMathInitialSettings
	LDA.w #$0020
	TSB.w !RAM_YI_Global_HDMAEnable
	LDA.l YI_Global_PaletteMirror[$00].LowByte
	BEQ.b CODE_02DCC6
	STA.w $0948
	LDA.w #$0000
	STA.l YI_Global_PaletteMirror[$00].LowByte
	LDX.b #$20
	STX.w !RAM_YI_Global_ColorMathSelectAndEnable
CODE_02DCC6:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BEQ.b CODE_02DD4B
	REP.b #$10
	LDA.w #$0056
	JSL.l CODE_00B753
	SEP.b #$10
	LDA.w #$A800
	STA.w $0CF9
CODE_02DCDE:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0078
	STA.b $00
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0080
	STA.b $02
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $0C23
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $0C27
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0200
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $0C2A
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w $0C2C
	REP.b #$10
	JSL.l CODE_03D9C6
	SEP.b #$10
	LDA.b $00
	SEC
	SBC.w $0C23
	BEQ.b CODE_02DD37
	EOR.w $0C2A
	BPL.b CODE_02DD37
	LDA.b $00
	STA.w $0C23
CODE_02DD37:
	LDA.b $02
	SEC
	SBC.w $0C27
	BEQ.b CODE_02DD49
	EOR.w $0C2C
	BPL.b CODE_02DD49
	LDA.b $02
	STA.w $0C27
CODE_02DD49:
	LDX.b $12
CODE_02DD4B:
	RTS

DATA_02DD4C:
	db $60,$06,$0A,$0D,$0F,$11,$12,$13,$15,$16,$17,$18,$19,$19,$1A,$1B
	db $1C,$1C,$1D,$1D,$1E,$1E,$1E,$1F,$1F,$1F,$1F,$20,$20,$20,$20,$20
	db $20,$20,$20,$20,$20,$20,$20,$1F,$1F,$1F,$1F,$1E,$1E,$1E,$1D,$1D
	db $1C,$1C,$1B,$1A,$19,$19,$18,$17,$16,$15,$13,$12,$11,$11,$11,$11
	db $12,$12,$12,$13,$13,$13,$14,$14,$14,$15,$15,$15,$16,$16,$16,$17
	db $17,$17,$18,$18,$18,$19,$19,$19,$1A,$1A,$1A,$1B,$1B,$1B,$1C,$1C
	db $1C

CODE_02DDAD:
CODE_key_from_boss_state_03_pre_keyhole:
	TYX
	JSR.w CODE_02DA8B
	LDY.b $78,x
	CPY.b #$0B
	BCS.b CODE_02DDB8
	RTS

CODE_02DDB8:
	LDA.b $76,x
	BNE.b CODE_02DDC5
	LDA.w #!Define_YI_SoundID27_CollectSuperStar
	JSL.l CODE_push_sound_queue
	LDA.b $76,x
CODE_02DDC5:
	CMP.w #$0100
	BCC.b CODE_02DDDF
	LDY.b $78,x
	CPY.b #$10
	BCC.b CODE_02DDE4
	INC.b $18,x
	LDA.w #!Define_YI_PlayerState22_EnterKeyhole
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $60C0
	STZ.w $60C6
	RTS

CODE_02DDDF:
	ADC.w #$0010
	STA.b $76,x
CODE_02DDE4:
	LDA.w #$0030
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$FFD8
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $60A0
	STA.w !RAM_YI_Global_Layer3YPosLo
	STZ.w $6098
	STZ.w !RAM_YI_Global_Layer3XPosLo
	LDA.w #$0260
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	AND.w #$FFF0
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PHB
	LDY.b #$702002>>16
	PHY
	PLB
	REP.b #$10
	LDA.l !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	TAX
	LDY.w #$0000
CODE_02DE32:
	LDA.l DATA_5FFA5E,x
	STA.w $702002,y
	STA.w $702D6E,y
	INX
	INX
	INY
	INY
	CPY.w #$0026
	BCC.b CODE_02DE32
	SEP.b #$10
	PLB
	LDA.w #DATA_02DD4C>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_02DD4C
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	STZ.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w #$005F
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$0080
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0096
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08F05F>>16
	LDA.w #FXCODE_08F05F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E56D0,$703A02 : dw $0348
	LDA.w #$FFFF
	STA.w !RAM_YI_Global_BG1And2WindowMaskSettings
	LDA.w !RAM_YI_Global_MainScreenLayers
	STA.w !RAM_YI_Global_MainScreenWindowMask
	LDA.w #$0155
	STA.w !RAM_YI_Global_BGWindowLogicSettings
	LDA.w #$0000
	STA.l YI_Global_PaletteMirror[$00].LowByte
	LDA.w #$7FFF
	STA.w $0948
	LDY.b #$A0
	LDA.w $60B0
	CMP.w #$0079
	BMI.b CODE_02DEA9
	LDY.b #$A8
CODE_02DEA9:
	STY.w !RAM_YI_Global_ObjectAndColorWindowSettings
	LDY.b #$22
	STY.w !RAM_YI_Global_ColorMathInitialSettings
	LDY.b #$34
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.w #$0020
	STA.w !RAM_YI_Global_HDMAEnable
	LDX.b $12
	RTS

DATA_02DEBF:
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF

CODE_02DEDD:
CODE_key_from_boss_state_04_insert_key:
	LDA.w $60B0
	SEC
	SBC.w #$0078
	BPL.b CODE_02DEE9
	LDA.w #$0000
CODE_02DEE9:
	ASL
	ASL
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$00D1
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #DATA_02DEBF
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #DATA_02DEBF>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_08E167>>16
	LDA.w #FXCODE_08E167
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $60B2
	CMP.w #$0088
	BMI.b CODE_02DF52
	LDA.b $76,x
	CMP.w #$0100
	BNE.b CODE_02DF29
	LDA.w #!Define_YI_SoundID50_MessageAppears
	JSL.l CODE_push_sound_queue
	LDA.b $76,x
CODE_02DF29:
	SEC
	SBC.w #$0010
	STA.b $76,x
	BNE.b CODE_02DF52
	LDX.b #FXCODE_08B3D9>>16
	LDA.w #FXCODE_08B3D9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #!Define_YI_GameMode31
	STA.w !RAM_YI_Global_CurrentGameMode
	LDA.w #$0004
	STA.w !RAM_YI_Global_MainScreenLayers
	STA.w !RAM_YI_Global_MainScreenWindowMask
	STZ.w $0948
	JSL.l CODE_03A31E
CODE_02DF52:
	JMP.w CODE_02DDE4

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Boss-explosion (sprite $013): the white flash + popping sounds played when
; a boss reaches 0 HP.  Init just plays SoundID $74 and seeds a 2048-tick
; despawn counter; Main cycles flash colours (DATA_02DF68) every few frames
; following the duration table DATA_02DF70.
; see also: ys_enmy5.asm.
;-------------------------------------------------------------------------
YI_NorSpr013_BossExplosion_Init:
init_boss_explosion:                            ; Raidenthequick: init_boss_explosion
;$02DF55
	LDA.w #$0002
	STA.b $16,x
CODE_02DF5A:
	LDA.w #!Define_YI_SoundID74_BossExplosion
	JSL.l CODE_push_sound_queue
	LDA.w #$0800
	STA.w $7A38,x
	RTL

;---------------------------------------------------------------------------

DATA_02DF68:
	dw $0000,$7F00,$23EC,$22DF

DATA_02DF70:
	dw $0002,$0004,$0004,$0004,$0004

YI_NorSpr013_BossExplosion_Main:
main_boss_explosion:                            ; Raidenthequick: main_boss_explosion
;$02DF7A
	LDA.w $7402
	CMP.w #$0032
	BNE.b CODE_02DF86
	JSL.l CODE_06C9D7
CODE_02DF86:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	BPL.b CODE_02DF8E
	JMP.w CODE_02E04E

CODE_02DF8E:
	LDA.w #DATA_17A48C>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_17A48C
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w $7680,x
	BPL.b CODE_02DFA2
	LDA.w #$0000
CODE_02DFA2:
	CMP.w #$0100
	BCC.b CODE_02DFAA
	LDA.w #$00FF
CODE_02DFAA:
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	CLC
	ADC.w !RAM_YI_Global_Layer1XPosLo
	STA.w $70E2,x
	LDA.w $7682,x
	BPL.b CODE_02DFBC
	LDA.w #$0000
CODE_02DFBC:
	CMP.w #$00D2
	BCC.b CODE_02DFC4
	LDA.w #$00D1
CODE_02DFC4:
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	CLC
	ADC.w !RAM_YI_Global_Layer1YPosLo
	STA.w $7182,x
	LDA.b $19,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08B2B6>>16
	LDA.w #FXCODE_08B2B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E56D0,$703A02 : dw $0348
	LDX.b $12
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.b $78,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08E132>>16
	LDA.w #FXCODE_08E132
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.l YI_Global_PaletteMirror[$00].LowByte
	BNE.b CODE_02E02A
	LDY.w !RAM_YI_Global_SubScreenLayers
	BEQ.b CODE_02E02A
	SEP.b #$20
	LDA.w !RAM_YI_Global_MainScreenLayers
	ORA.w !RAM_YI_Global_SubScreenLayers
	STA.w !RAM_YI_Global_MainScreenLayers
	STZ.w !RAM_YI_Global_SubScreenLayers
	REP.b #$20
	LDA.w $0948
	STA.l YI_Global_PaletteMirror[$00].LowByte
CODE_02E02A:
	LDA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STA.w $0948
	LDA.w !RAM_YI_Global_MainScreenLayers
	STA.w !RAM_YI_Global_MainScreenWindowMask
	STZ.w !RAM_YI_Global_BG1And2WindowMaskSettings
	LDY.b #$20
	STY.w !RAM_YI_Global_ObjectAndColorWindowSettings
	LDY.b #$10
	STY.w !RAM_YI_Global_ColorMathInitialSettings
	LDY.b #$37
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.w #$0020
	TSB.w !RAM_YI_Global_HDMAEnable
CODE_02E04E:
	JSL.l CODE_03AF23
	LDA.w $7A96,x
	CMP.w #$0140
	BNE.b CODE_02E06C
	LDA.w #$0005
	STA.l $00004D
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BEQ.b CODE_02E08D
	JSL.l CODE_02E195
	BRA.b CODE_02E08D

CODE_02E06C:
	CMP.w #$00C0
	BNE.b CODE_02E08D
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_02E08D
	LDA.w #!Define_YI_SoundID43_MountYoshi
	JSL.l CODE_push_sound_queue
	JSL.l CODE_04F74A
	LDA.w #$012E
	STA.w $60BE
	LDA.w #$0032
	STA.w $7402
CODE_02E08D:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	BPL.b CODE_02E0C8
	LDA.w $7A96,x
	BMI.b CODE_02E0C4
	BEQ.b CODE_02E09A
	RTL

CODE_02E09A:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_02E0C4
	LDA.w #$0006
	STA.l $00004D
	LDA.w #!Define_YI_GameMode31
	STA.w !RAM_YI_Global_CurrentGameMode
	STZ.w !RAM_YI_Global_MainScreenWindowMask
	LDY.b #$00
	STY.w !RAM_YI_Global_ObjectAndColorWindowSettings
	LDY.b #$22
	STY.w !RAM_YI_Global_ColorMathInitialSettings
	LDY.b #$20
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	LDA.w #$0020
	TRB.w !RAM_YI_Global_HDMAEnable
CODE_02E0C4:
	JML.l CODE_03A31E

CODE_02E0C8:
	LDA.w $7A38,x
	SEC
	SBC.w #$0040
	CMP.w #$0100
	BCS.b CODE_02E0D7
	LDA.w #$0100
CODE_02E0D7:
	STA.w $7A38,x
	CLC
	ADC.b $18,x
	STA.b $18,x
	LDA.b $76,x
	CMP.w #$0100
	BCC.b CODE_02E114
	LDA.b $16,x
	BNE.b CODE_02E0ED
	DEC.b $16,x
	RTL

CODE_02E0ED:
	DEC.b $16,x
	DEC.b $16,x
	BNE.b CODE_02E0FE
	LDY.w $61CE
	BEQ.b CODE_02E0FE
	LDA.w #$7FFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_02E0FE:
	STZ.b $18,x
	STZ.b $76,x
	LDA.w $7A36,x
	LDY.w $61CE
	BEQ.b CODE_02E10F
	LDY.b $16,x
	LDA.w DATA_02DF68,y
CODE_02E10F:
	STA.b $78,x
	JMP.w CODE_02DF5A

CODE_02E114:
	LDY.b $16,x
	CLC
	ADC.w DATA_02DF70,y
	CMP.w #$0100
	BCC.b CODE_02E122
	LDA.w #$0100
CODE_02E122:
	STA.b $76,x
	CPY.b #$00
	BEQ.b CODE_02E12D
	CMP.w #$00C0
	BCS.b CODE_02E190
CODE_02E12D:
	LDA.b $14
	AND.w #$0001
	BNE.b CODE_02E190
	LDA.b $10
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $19,x
	AND.w #$00FF
	LSR
	NOP #2
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0500
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0A91E0>>16
	LDA.w #FXCODE_0A91E0
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #!Define_YI_AmbSpr1DD
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	SEC
	SBC.w #$0008
	CLC
	ADC.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $70A2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0008
	CLC
	ADC.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w $7142,y
	LDA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w !REGISTER_SuperFX_R4_LMULTResultLo
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0004
	STA.w $7E4C,y
	LDA.w #$0006
	STA.w $7782,y
CODE_02E190:
	RTL

;---------------------------------------------------------------------------

CODE_02E191:
	JSL.l CODE_despawn_sprite_free_slot
CODE_02E195:
	LDA.w #$0014
	JML.l CODE_spawn_sprite_init

;---------------------------------------------------------------------------

CODE_02E19C:
	LDA.w #$0200
	LDX.b #$00
	BRA.b CODE_02E1A8

CODE_02E1A3:
	LDA.w #$0200
CODE_02E1A6:
	LDX.b #$01
CODE_02E1A8:
	PHA
	LDA.w #$0013
	JSL.l CODE_spawn_sprite_init
	PLA
	BCC.b CODE_02E1DF
	STA.w $7A96,y
	LDA.b $00
	CLC
	ADC.w #$0008
	STA.w $70E2,y
	LDA.b $02
	CLC
	ADC.w #$0008
	STA.w $7182,y
	TXA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	ORA.w !RAM_YI_Level_CurrentWorldLo
	ASL
	TAX
	LDA.l DATA_kamek_spell_color1_per_boss,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.l DATA_kamek_spell_color2_per_boss,x
	STA.w $7A36,y
CODE_02E1DF:
	LDX.b $12
CODE_02E1E1:
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	JML.l CODE_028922

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Lava Log (sprite $000): the bobbing log that surfaces from lava in W3/W6.
; Init sets the float-state byte at $7863,x to $FF (uninitialised marker)
; so Main can lazy-init the bobbing physics from current camera position.
; see also: ys_enmy3.asm.
;-------------------------------------------------------------------------
YI_NorSpr000_LavaLog_Init:
init_floating_log:                              ; Raidenthequick: init_floating_log
;$02E1EB
	JSL.l CODE_03AE60
	STZ.w $7400,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $7863,x
	REP.b #$20
	RTL

;---------------------------------------------------------------------------

DATA_02E1FC:
	dw $0002,$FFFE,$01E0,$01E0,$01E0,$01E0,$01E0,$01E0
	dw $01E0,$01E0,$01E0,$01E0,$01E4,$01E8,$01EC,$01F0
	dw $01F4,$01F8,$01FC,$01FE,$0000,$0000,$0000,$0000
	dw $0002,$0004,$0008,$000C,$0010,$0014,$0018,$001C
	dw $0020,$0020,$0020,$0020,$0020,$0020,$0020,$0020
	dw $0020,$0020

DATA_02E250:
	dw $0004,$0000,$0006,$FFFF

DATA_02E258:
	dw $0080,$0030,$0018,$0010,$000C,$0008,$0008,$0008
	dw $0008

YI_NorSpr000_LavaLog_Main:
main_log:                                       ; Raidenthequick: main_log
;$02E26A
	JSL.l CODE_03AA52
	JSL.l CODE_03AF23
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.l $70000C,x
	AND.w #$0008
	STA.b $04
	LDA.l $700014,x
	AND.w #$0008
	STA.b $08
	SEP.b #$10
	LDX.b $12
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_02E299
	JMP.w CODE_02E2D1

CODE_02E299:
	LDA.w $7862,x
	AND.w #$00FF
	STA.b $06
	BNE.b CODE_02E2A6
	JMP.w CODE_02E3BE

CODE_02E2A6:
	LDA.w $7AF6,x
	BNE.b CODE_02E2D1
	LDY.b #$0E
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CMP.w #$00E0
	BPL.b CODE_02E2CB
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_02E2BE
	EOR.w #$FFFF
	INC
CODE_02E2BE:
	CMP.w #$0040
	BCC.b CODE_02E2D1
	ASL
	ASL
	ASL
	XBA
	AND.w #$000E
	TAY
CODE_02E2CB:
	LDA.w DATA_02E258,y
	STA.w $7AF6,x
CODE_02E2D1:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w #$0020
	CMP.w #$FF80
	BPL.b CODE_02E2E0
	LDA.w #$FF80
CODE_02E2E0:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.l $700002,x
	SEC
	SBC.l $700012,x
	STA.b $02
	LDA.l $700002,x
	SEC
	SBC.l $70000A,x
	PHP
	BPL.b CODE_02E304
	EOR.w #$FFFF
	INC
CODE_02E304:
	ASL
	ASL
	ASL
	ASL
	ASL
	TAX
	LDA.l FXDATA_0BB810,x
	PLP
	BPL.b CODE_02E315
	EOR.w #$FFFF
	INC
CODE_02E315:
	STA.b $00
	LDA.b $02
	PHP
	BPL.b CODE_02E320
	EOR.w #$FFFF
	INC
CODE_02E320:
	ASL
	ASL
	ASL
	ASL
	ASL
	TAX
	LDA.l FXDATA_0BB810,x
	PLP
	BMI.b CODE_02E331
	EOR.w #$FFFF
	INC
CODE_02E331:
	CLC
	ADC.b $00
	LSR
	AND.w #$01FE
	STA.b $00
	LDX.b $12
	LDY.b $78,x
	BEQ.b CODE_02E34E
	TYA
	CLC
	ADC.w #$0008
	CMP.w #$0010
	BCS.b CODE_02E34D
	LDY.w #$0000
CODE_02E34D:
	TYA
CODE_02E34E:
	SEP.b #$10
	STA.b $02
	SEC
	SBC.w $7A36,x
	LDY.b #$00
	AND.w #$0100
	BEQ.b CODE_02E35F
	LDY.b #$02
CODE_02E35F:
	LDA.w $7A36,x
	CLC
	ADC.w DATA_02E1FC,y
	AND.w #$01FE
	STA.w $7A36,x
	SEC
	SBC.b $02
	EOR.w DATA_02E1FC,y
	BMI.b CODE_02E379
	LDA.b $02
	STA.w $7A36,x
CODE_02E379:
	LDA.b $78,x
	BEQ.b CODE_02E39F
	CLC
	ADC.w #$0030
	LSR
	LSR
	LSR
	LSR
	AND.w #$0006
	TAY
	LDA.w $7964,y
	BEQ.b CODE_02E394
	LDY.b #$00
	LDA.b $02
	BRA.b CODE_02E398

CODE_02E394:
	LDA.b $00
	ASL
	ASL
CODE_02E398:
	SEC
	SBC.w #$0010
	AND.w #$01FE
CODE_02E39F:
	LDY.b #$04
	REP.b #$10
	TAX
	LDA.l DATA_sine_lut_8bit_radians,x
	ASL
	SEP.b #$10
	LDX.b $12
	CMP.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_02E3B4
	INY
	INY
CODE_02E3B4:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w DATA_02E250,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_02E3BE:
	LDY.b $78,x
	BEQ.b CODE_02E3D8
	LDA.w $72C0,x
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $7C16,x
	SEC
	SBC.w $72C0,x
	STA.w $7C16,x
	STZ.b $78,x
CODE_02E3D8:
	LDA.w $60AA
	BMI.b CODE_02E440
	LDA.w $7C16,x
	CLC
	ADC.w #$0014
	CMP.w #$0028
	BCS.b CODE_02E440
	TXY
	REP.b #$10
	LDX.w $7A36,y
	LDA.l FXDATA_0BBA12,x
	SEP.b #$20
	STA.w !REGISTER_Mode7MatrixParameterA
	XBA
	STA.w !REGISTER_Mode7MatrixParameterA
	TYX
	LDA.w $7C16,x
	STA.w !REGISTER_Mode7MatrixParameterB
	REP.b #$20
	SEP.b #$10
	LDA.w !REGISTER_PPUMultiplicationProductMid
	CLC
	ADC.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0020
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	CMP.w #$FFF6
else
	CMP.w #$FFF8
endif
	BCC.b CODE_02E440
	INC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$0100
	STA.w $60AA
	INC.w $61B4
	STZ.w $60FA
	LDA.w #$0010
	STA.w $0CCA
	LDA.w $7C16,x
	BNE.b CODE_02E43A
	INC
CODE_02E43A:
	ASL
	AND.w #$01FE
	STA.b $78,x
CODE_02E440:
	LDA.w $7722,x
	LSR
	LSR
	LSR
	SEC
	SBC.w $0030
	AND.w #$0003
	BEQ.b CODE_02E452
	JMP.w CODE_02E48D

CODE_02E452:
	LDA.w $7A36,x
	LSR
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #FXDATA_540000+$4060
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_540000+$4060)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	SEP.b #$10
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
CODE_02E48D:
	RTL

;---------------------------------------------------------------------------

; Universal no-op: TYX (restore sprite index) + RTS.  Used as a dispatch-
; table filler for "this state does nothing this frame" by both the bud
; (DATA_naval_pir_bud_state_ptr) and vine (DATA_naval_pir_vine_state_ptr) tables.
CODE_02E48E:
CODE_naval_pir_state_noop:
	TYX
	RTS

;---------------------------------------------------------------------------

DATA_02E490:
	dw $FFE0,$0020

;-------------------------------------------------------------------------
; Naval Piranha (sprite $171) -- World 3-8 castle boss.  The boss
; itself is the giant chomping piranha head; the buds (sprite $172) and
; the snaking vine/stalks (sprite $002) are spawned as separate normal-
; sprite slots tied back to the boss via global word $1072 (the "boss-slot
; pointer").  Buds and vines locate their parent by reading $1072.
; See docs/bossengine.md.
;
; Init:
;   - $1072 = X (slot index)         -- boss-slot pointer for buds/vines.
;   - $7A36,x = $01FF                -- visible-tiles bitmap (all on).
;   - $701900,x = $01FF              -- body-extension counter (all extended).
;   - $1068 = $001C                  -- HP (28 hits), used by retract math.
;   - $78,x = $0006                  -- tongue-extend progress.
;   - $106E -= 1                     -- player-target sign accumulator.
;   - $76,x = 1                      -- combat sub-state (intro idle).
;   - $1082 = 3                      -- remaining bud-spawn cap counter.
;   - $70E2,x = $0388                -- park at centre of arena (X pixel).
;   - $1074 = parent Y (cached as perch baseline for state $02 rise).
;   - $7182,x += $0060               -- drop Y by ~96 px (start below floor).
;   - $7A38,x = $0070                -- body-bias for OAM.
;   - $1070 = $FFC0                  -- Mode-7 angle / body rotation default.
;   - Spawns a child Piranha Plant (sprite $066) at $0388,$0780 to act as
;     the chomp graphic; child slot index stashed in $108A so the intro can
;     watch for "Yoshi eats the plant" trigger via $7019D6 == $10.
;   - $105A = 0                      -- "setup committed" gate (0,1,2 -> intro).
;   - Copies a 30-byte palette gradient from $702E8C into mirror $E0
;     (15 BGR-15 colours) for body shading.
;
; Bud spawn-list chain ($1076 / $1078):
;   These two WRAM globals hold the slot indices of the two active buds.
;   They are seeded inside intro_commit (CODE_naval_pir_intro_commit -> CODE_naval_pir_spawn_buds_and_vines) and
;   then read every frame by:
;     - the boss state machine (states $00, $0C, $0D, $1E, etc.)
;     - bud Main (sprite $172) -- buds also read $1072 to find parent
;     - vine Main (sprite $002) -- vines use $701978 to find their bud
;   The chain is "2-slot fixed": exactly one bud at $1076, one at $1078,
;   matched to the two vine pairs.  If only one bud is needed, the chain
;   still holds both; the unused slot's $7019D6 == 0 acts as the "idle"
;   marker.
;
; Vine-depth threshold logic (DATA_naval_pir_vine_state_ptr -- vine main-dispatch):
;   Vines look at the boss's "stalk depth" word $7019D6,$1072 every frame
;   and dispatch via DATA_naval_pir_vine_state_ptr based on:
;     depth < $1C  -> retract states (vine pulls back into floor)
;     depth = $1F  AND both buds idle -> extend (vine emerges)
;     depth >= $20 -> extend states (vine fully out)
;   This synchronises all vines to the bud-spawn-list chain via a single
;   global word.  See "Vine Main" block comment below for full table.
; see also: ys_boss2.asm.
;-------------------------------------------------------------------------
YI_NorSpr171_NavalPiranha_Init:
init_naval_piranha:                             ; Raidenthequick: init_naval_piranha
;$02E494
	STX.w $1072
	INC.b $18,x
	LDA.w #$01FF
	STA.w $7A36,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$001C
	STA.w $1068
	LDA.w #$0006
	STA.b $78,x
	DEC.w $106E
	LDY.b #$01
	STY.b $76,x
	LDA.w #$0003                                    ; Naval Piranha HP -- 3 hits to kill.
	                                                ; SMWC tweak target: this immediate's 2 bytes
	                                                ; emit at cart $02:E4B5/$02:E4B6 (default
	                                                ; [03 00] = $0003). Verified cart bytes match.
	STA.w $1082                                     ; current-boss-HP word (multi-boss-shared slot)
	LDA.w #$0388
	STA.w $70E2,x
	LDA.w $7182,x
	STA.w $1074
	CLC
	ADC.w #$0060
	STA.w $7182,x
	LDA.w #$0070
	STA.w $7A38,x
	LDA.w #$FFC0
	STA.w $1070
	LDA.w #!Define_YI_NorSpr066_PiranhaPlant
	TXY
	JSL.l CODE_03A366
	LDA.w #$0388
	STA.w $70E2,y
	LDA.w #$0780
	STA.w $7182,y
	LDA.w #$BC00
	STA.w $6FA0,y
	LDA.w $6FA2,y
	ORA.w #$2000
	STA.w $6FA2,y
	LDA.w #$2C01
	STA.w $7040,y
	LDA.w #$0001
	STA.w $7402,y
	SEP.b #$20
	LDA.b #$2C
	STA.w $7042,y
	STY.w $108A
	STZ.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	LDA.b #$08
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.b #$FF
	STA.w $7863,y
	REP.b #$20
	STZ.w $105A
	LDX.b #$1E
CODE_02E526:
	LDA.l $702E8C,x
	STA.l YI_Global_PaletteMirror[$E0].LowByte,x
	DEX
	DEX
	BPL.b CODE_02E526
	RTL

;---------------------------------------------------------------------------

; Naval Piranha main-dispatch table.  Indexed by $76,x doubled (Y-aligned word
; pointers).  All handlers RTS; the Main wrapper handles RTL.  38 entries
; ($00..$25); ~16 unique handlers (several states reuse the "munch oscillate"
; handler CODE_naval_pir_state_munch_osc or the "retract home" handlers CODE_naval_pir_state_retract_far/CODE_naval_pir_state_return_home).
; A negative $18,x short-circuits the table entirely (defeat post-state -- see
; Main below).
;
; Combat pattern: states $02..$0B form the "rise + tongue lunge + retract"
; combat loop.  States $0F..$15 are the lateral-strike variant.  States $17
; onwards form the death cinematic.  Bud-spawn check happens in state $00.
;
;   $00 CODE_naval_pir_state_bud_spawn_check  CODE_naval_pir_state_bud_spawn_check  decides which bud-spawn or
;                                                     lunge to perform next
;   $01 CODE_naval_pir_state_intro            CODE_naval_pir_state_intro  initial setup + spawn buds
;   $02 CODE_naval_pir_state_rise             CODE_naval_pir_state_rise  rise to perch Y baseline
;   $03 CODE_naval_pir_state_munch_osc        CODE_naval_pir_state_munch_osc  bud-emerge munch + body oscillate
;   $04 CODE_naval_pir_state_retract_far      CODE_naval_pir_state_retract_far  retract toward home (anchor $01C0)
;   $05 CODE_naval_pir_state_chomp            CODE_naval_pir_state_chomp  chomp/bite mouth animation
;   $06 CODE_naval_pir_state_munch_osc        CODE_naval_pir_state_munch_osc  (re-entry)
;   $07 CODE_naval_pir_state_retract_near     CODE_naval_pir_state_retract_near  retract toward home (anchor $01A0)
;   $08 CODE_naval_pir_state_tongue_extend    CODE_naval_pir_state_tongue_extend  extend tongue (body grows)
;   $09 CODE_naval_pir_state_tongue_lunge     CODE_naval_pir_state_tongue_lunge  lunge: spawn 3 projectile sprites ($165)
;   $0A CODE_naval_pir_state_lunge_settle     CODE_naval_pir_state_lunge_settle  settle frame timer after lunge
;   $0B CODE_naval_pir_state_munch_osc        CODE_naval_pir_state_munch_osc  (re-entry)
;   $0C CODE_naval_pir_state_watch_buds       CODE_naval_pir_state_watch_buds  wait for buds to retract, advance to $1A
;   $0D CODE_naval_pir_state_return_home      CODE_naval_pir_state_return_home  glide back to home position
;   $0E CODE_naval_pir_state_sweep            CODE_naval_pir_state_sweep  sideways sweep across arena
;   $0F CODE_naval_pir_state_decel_x          CODE_naval_pir_state_decel_x  brake X-velocity
;   $10 CODE_naval_pir_state_lateral_lunge    CODE_naval_pir_state_lateral_lunge  lateral lunge (perp to player)
;   $11 CODE_naval_pir_state_munch_osc        CODE_naval_pir_state_munch_osc  (re-entry)
;   $12 CODE_naval_pir_state_retract_far      CODE_naval_pir_state_retract_far
;   $13 CODE_naval_pir_state_chomp            CODE_naval_pir_state_chomp
;   $14 CODE_naval_pir_state_munch_osc        CODE_naval_pir_state_munch_osc  (re-entry)
;   $15 CODE_naval_pir_state_return_home      CODE_naval_pir_state_return_home
;   $16 CODE_naval_pir_state_sweep            CODE_naval_pir_state_sweep
;   $17 CODE_naval_pir_state_defeat_grow      CODE_naval_pir_state_defeat_grow  defeat phase 1: head balloon-grows
;   $18 CODE_naval_pir_state_defeat_push      CODE_naval_pir_state_defeat_push  defeat phase 2: lateral push at climax
;   $19 CODE_naval_pir_state_munch_osc        CODE_naval_pir_state_munch_osc  (post-sweep oscillate)
;   $1A CODE_naval_pir_state_post_hit_flash   CODE_naval_pir_state_post_hit_flash  flash + i-frames after egg-hit
;   $1B CODE_naval_pir_state_anim_cycle       CODE_naval_pir_state_anim_cycle  short anim sub-cycle (mouth taunt)
;   $1C CODE_naval_pir_state_retract_far      CODE_naval_pir_state_retract_far
;   $1D CODE_naval_pir_state_chomp            CODE_naval_pir_state_chomp
;   $1E CODE_naval_pir_state_bud_second_wave  CODE_naval_pir_state_bud_second_wave  spawn second bud wave / re-extend
;   $1F CODE_naval_pir_state_return_home      CODE_naval_pir_state_return_home
;   $20 CODE_naval_pir_state_retract_far      CODE_naval_pir_state_retract_far
;   $21 CODE_naval_pir_state_chomp            CODE_naval_pir_state_chomp
;   $22 CODE_naval_pir_state_defeat_explode   CODE_naval_pir_state_defeat_explode  defeat: queue SuperFX boss-explode + sfx
;   $23 CODE_naval_pir_state_defeat_pulse     CODE_naval_pir_state_defeat_pulse  defeat: pulsing scale + palette swap
;   $24 CODE_naval_pir_state_defeat_debris    CODE_naval_pir_state_defeat_debris  defeat: spawn ambient debris ($1E6, $222)
;   $25 CODE_naval_pir_state_defeat_finish    CODE_naval_pir_state_defeat_finish  defeat: PLA/JML to boss closer (03A32E)
DATA_02E533:
DATA_naval_piranha_state_ptr:
	dw CODE_naval_pir_state_bud_spawn_check,CODE_naval_pir_state_intro,CODE_naval_pir_state_rise,CODE_naval_pir_state_munch_osc,CODE_naval_pir_state_retract_far,CODE_naval_pir_state_chomp,CODE_naval_pir_state_munch_osc,CODE_naval_pir_state_retract_near
	dw CODE_naval_pir_state_tongue_extend,CODE_naval_pir_state_tongue_lunge,CODE_naval_pir_state_lunge_settle,CODE_naval_pir_state_munch_osc,CODE_naval_pir_state_watch_buds,CODE_naval_pir_state_return_home,CODE_naval_pir_state_sweep,CODE_naval_pir_state_decel_x
	dw CODE_naval_pir_state_lateral_lunge,CODE_naval_pir_state_munch_osc,CODE_naval_pir_state_retract_far,CODE_naval_pir_state_chomp,CODE_naval_pir_state_munch_osc,CODE_naval_pir_state_return_home,CODE_naval_pir_state_sweep,CODE_naval_pir_state_defeat_grow
	dw CODE_naval_pir_state_defeat_push,CODE_naval_pir_state_munch_osc,CODE_naval_pir_state_post_hit_flash,CODE_naval_pir_state_anim_cycle,CODE_naval_pir_state_retract_far,CODE_naval_pir_state_chomp,CODE_naval_pir_state_bud_second_wave,CODE_naval_pir_state_return_home
	dw CODE_naval_pir_state_retract_far,CODE_naval_pir_state_chomp,CODE_naval_pir_state_defeat_explode,CODE_naval_pir_state_defeat_pulse,CODE_naval_pir_state_defeat_debris,CODE_naval_pir_state_defeat_finish

;-------------------------------------------------------------------------
; Naval Piranha Main: per-frame state machine driven by $76,x (sub-state
; index) through the DATA_naval_piranha_state_ptr pointer table (38 entries: roar / swallow
; / bite / spit / bud-spawn / vine-extend / hurt-flash / defeat / ...).
; A negative $18,x signals "defeat-cinematic" and short-circuits the
; dispatch.  After the sub-state runs, control falls into CODE_02E68E for
; the shared per-frame OAM + hitbox update.
; see also: ys_boss2.asm.
;-------------------------------------------------------------------------
YI_NorSpr171_NavalPiranha_Main:
main_naval_piranha:                             ; Raidenthequick: main_naval_piranha
;$02E57F
	JSR.w CODE_naval_pir_body_oam_setup                           ; body OAM + SuperFX setup
	JSL.l CODE_03AF23                           ; shared sprite housekeeping
	LDY.b $18,x
	BMI.b CODE_02E5AB                           ; $18,x negative: skip dispatch (defeat post-state)
	TXY
	LDA.b $76,x                                 ; combat state byte
	ASL
	TAX
	JSR.w (DATA_naval_piranha_state_ptr,x)                       ; dispatch via state-pointer table
	LDY.w $74A2,x
	BMI.b CODE_naval_pir_main_splash_walk                           ; body-render disabled: skip post-state
	LDY.w $1084                                 ; debris-spawn frame counter
	BNE.b CODE_naval_pir_main_splash_walk                           ; debris in progress: skip post-state
	JSR.w CODE_02E68E                           ; per-frame hitbox/position update
	LDY.b $76,x
	CPY.b #$20                                  ; state >= $20 (defeat phases)?
	BPL.b CODE_02E5AB                           ; yes: skip egg-collision check
	JSR.w CODE_naval_pir_egg_collision                           ; egg-collision detector
	JSR.w CODE_02E8A5                           ; player-collision detector
CODE_02E5AB:
	JSR.w CODE_02E6C3                           ; body redraw + OAM commit
	LDA.w $7AF8,x                               ; defeat-pulse strobe
	BEQ.b CODE_naval_pir_main_splash_walk
	AND.w #$0003
	BNE.b CODE_naval_pir_main_splash_walk
	LDA.w $7042,x
	EOR.w #$0002                                ; flip pal-row bit (defeat strobe)
	STA.w $7042,x
CODE_02E5C1:
CODE_naval_pir_main_splash_walk:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_02E5CA
	EOR.w #$FFFF                                ; abs(X-speed)
	INC
CODE_02E5CA:
	CLC
	ADC.w $1088                                 ; distance-since-last-splash accumulator
	CMP.w #$2000
	BMI.b CODE_02E5E0
	SEC
	SBC.w #$2000
	PHA
	LDA.w #!Define_YI_SoundID5F_Splash1         ; play splash every $2000 px travelled
	JSL.l CODE_push_sound_queue
	PLA
CODE_02E5E0:
	STA.w $1088
	RTL

;-------------------------------------------------------------------------
; CODE_naval_pir_body_oam_setup: runs at top of every Naval
; Piranha Main frame.  Builds OAM body sprites via SuperFX FXCODE_08A062
; (driven by DATA_02FC39 -> DATA_02FCxx OAM tile-block layouts).  Inputs
; loaded into GSU scratch regs $6000..$601E from per-slot WRAM words:
;   $6000 = $1068 (boss HP-derived shape)
;   $6002 = $7A38 (body-bias)
;   $6004 = $106A (body chord-X)
;   $6006 = $106C (body chord-Y)
;   $6008 = $1070 (body angle/rotation)
;   $600A = $7A36 / 2 (visible-tiles bitmap)
;   $600C = $701900 / 2 (body-extension counter)
;   $601E = $1084 (debris-spawn frame counter)
; Returns chord-X/Y in $0C/$0E for downstream sprite-collision checks.
;-------------------------------------------------------------------------
CODE_02E5E4:
CODE_naval_pir_body_oam_setup:
	LDY.w $74A2,x
	BMI.b CODE_02E65D
	JSL.l CODE_03AB1C
	LDA.w $1068
	STA.w $6000
	LDA.w $7A38,x
	STA.w $6002
	LDA.w $106A
	STA.w $6004
	LDA.w $106C
	STA.w $6006
	LDA.w $1070
	STA.w $6008
	LDA.w $7A36,x
	LSR
	STA.w $600A
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LSR
	STA.w $600C
	LDA.w $1084
	STA.w $601E
	LDA.w $7680,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7682,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7400,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #DATA_02FC39>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDY.b $78,x
	TYA
	ASL
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #DATA_02FC39
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDX.b #FXCODE_08A062>>16
	LDA.w #FXCODE_08A062
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.b $0C
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.b $0E
CODE_02E65D:
	RTS

DATA_02E65E:
	dw $0009,$0008,$0007,$0008,$000C,$000C,$0010,$000F
	dw $000E,$0010,$000F,$000E

DATA_02E676:
	dw $FFDA,$FFD1,$FFD7,$FFD8,$FFD7,$FFD6,$FFDA,$FFD9
	dw $FFD7,$FFDA,$FFD9,$FFD7

CODE_02E68E:
	LDA.b $78,x
	AND.w #$00FF
	ASL
	TAY
	LDA.w DATA_02E676,y
	CLC
	ADC.w $106C
	CMP.w #$8000
	ROR
	STA.w $106C
	LDA.w DATA_02E65E,y
	LDY.w $7400,x
	BEQ.b CODE_02E6AF
	EOR.w #$FFFF
	INC
CODE_02E6AF:
	CLC
	ADC.w $106A
	CMP.w #$8000
	ROR
	STA.w $106A
	RTS

DATA_02E6BB:
	dw FXDATA_540000+$60E1,FXDATA_540000+$20A1,FXDATA_540000+$60C1,FXDATA_540000+$20C1

CODE_02E6C3:
	LDY.b $79,x
	LDA.w #(FXDATA_540000+$20A1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w DATA_02E6BB,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDY.b $18,x
	BMI.b CODE_02E71E
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STZ.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088A81>>16
	LDA.w #FXCODE_088A81
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	STA.w $105C
	LDA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	STA.w $105E
	LDA.w $6000
	STA.w $1060
	LDA.w $6002
	STA.w $1062
	LDA.w $6004
	STA.w $1064
	LDA.w $6006
	STA.w $1066
	BRA.b CODE_02E759

CODE_02E71E:
	LDA.w $105C
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w $105E
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w $1060
	STA.w $6000
	LDA.w $1062
	STA.w $6002
	LDA.w $1064
	STA.w $6004
	LDA.w $1066
	STA.w $6006
	LDA.w #$0040
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STZ.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088AF5>>16
	LDA.w #FXCODE_088AF5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
CODE_02E759:
	LDA.b $18,x
	EOR.w #$00FF
	STA.b $18,x
CODE_02E760:
	RTS

;-------------------------------------------------------------------------
; CODE_naval_pir_egg_collision: per-frame egg-hit detector.
; Reads linked sprite slot from $7D36 (egg/projectile), checks if it's
; status $10 (egg) with the kill-flag at $7D38 set.  If so:
;   - If $7AF8 (already-flashing) is set, jump to CODE_02E81A (just kill egg).
;   - Else compare X-relative to $7CD6 against $106E (player-target sign);
;     gate on current state: only states $0E..$10 and $16..$18 take hits.
;   - On accepted hit: zero X/Y vel, set $7AF8 = -1 (flash), arm $1086 RNG
;     to DATA_naval_pir_init_phase_bias[$1082-1], clear $0CE8 (combat timer), decrement $1082
;     (bud-cap counter).  When $1082 reaches 0 -> defeat sequence:
;       - JSL CODE_02A982 screen-shake
;       - play BossDefeated sfx
;       - $00 = $0F, $02 = $20 (advance to state $20)
;     Else (still has buds):
;       - play HurtBoss sfx
;       - $00 = $0E (bud-state cache), $02 = $1C (advance to state $1C)
;   - Cache both buds' $7019D6 into $107C/$107E (for second-wave restore),
;     overwrite buds' $7019D6 with new bud-state $00, advance boss state.
;-------------------------------------------------------------------------
CODE_02E761:
CODE_naval_pir_egg_collision:
	LDA.w $7362,x                               ; body-fade flag
	BMI.b CODE_02E760
	LDY.w $7D36,x                               ; linked egg slot
	DEY
	BMI.b CODE_02E779                           ; no linked sprite
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_02E779
	LDA.w $7D38,y                               ; kill-flag
	BNE.b CODE_02E77C
CODE_02E779:
	JMP.w CODE_02E82B                           ; no hit: try projectile-vs-egg sub-test

CODE_02E77C:
	LDA.w $7AF8,x                               ; already flashing?
	BEQ.b CODE_02E784
CODE_02E781:
	JMP.w CODE_02E81A                           ; yes: just kill egg, no double-hit

CODE_02E784:
	LDA.w $7CD6,y
	SEC
	SBC.w $7CD6,x
	EOR.w $106E
	BMI.b CODE_02E781
	LDY.b $76,x
	CPY.b #$0E
	BMI.b CODE_02E7A2
	CPY.b #$11
	BMI.b CODE_02E781
	CPY.b #$16
	BMI.b CODE_02E7A2
	CPY.b #$19
	BMI.b CODE_02E781
CODE_02E7A2:
	LDA.w #$0409
	STA.b $78,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FFFF
	STA.w $7AF8,x
	LDA.w $1082
	DEC
	ASL
	TAY
	LDA.w DATA_naval_pir_init_phase_bias,y
	STA.w $1086
	STZ.w $0CE8
	DEC.w $1082
	BNE.b CODE_02E7D9
	JSL.l CODE_02A982
	LDA.w #!Define_YI_SoundID80_BossDefeated
	PHA
	LDA.w #$000F
	LDY.b #$20
	BRA.b CODE_02E7E2

CODE_02E7D9:
	LDA.w #!Define_YI_SoundID78_HurtBoss
	PHA
	LDA.w #$000E
	LDY.b #$1C
CODE_02E7E2:
	STA.b $00
	STY.b $02
	PLA
	JSL.l CODE_push_sound_queue
	LDX.b #$00
	LDY.w $1076
CODE_02E7F0:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	STA.w $107C,x
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CPY.w $1076
	BNE.b CODE_02E807
	INX
	INX
	LDY.w $1078
	BRA.b CODE_02E7F0

CODE_02E807:
	LDX.w $7972
	LDY.b $02
	STY.b $76,x
	STZ.w $7A96,x
	LDA.w #$01FF
	STA.w $7A36,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_02E81A:
	LDY.w $7D36,x
	TYX
	DEX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDA.w #!Define_YI_SoundID0B_ShellHit1
	JSL.l CODE_push_sound_queue
	RTS

CODE_02E82B:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098F33>>16
	LDA.w #FXCODE_098F33
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_02E84C
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_02E84C
	LDA.w $7D38,y
	BNE.b CODE_02E84D
CODE_02E84C:
	RTS

CODE_02E84D:
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $7CD8,y
	STA.b $0A
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $7CD6,y
	STA.b $08
	CLC
	ADC.b $0C
	CLC
	ADC.w #$0018
	CMP.w #$0030
	BCS.b CODE_02E88E
	LDA.b $0A
	CLC
	ADC.b $0E
	CLC
	ADC.w #$0018
	CMP.w #$0030
	BCS.b CODE_02E88E
CODE_02E881:
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDA.w #!Define_YI_SoundID0B_ShellHit1
	JSL.l CODE_push_sound_queue
	RTS

CODE_02E88E:
	LDA.b $08
	CLC
	ADC.w #$0008
	CMP.w #$0010
	BCS.b CODE_02E8A4
	LDA.b $0A
	SEC
	SBC.w #$FFF8
	CMP.w #$0050
	BCC.b CODE_02E881
CODE_02E8A4:
	RTS

CODE_02E8A5:
	LDY.b $76,x
	CPY.b #$1C
	BPL.b CODE_02E8FA
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611E
	STA.b $0A
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	SEC
	SBC.w $611C
	STA.b $08
	CLC
	ADC.b $0C
	CLC
	ADC.w #$0018
	CMP.w #$0030
	BCS.b CODE_02E8E4
	LDA.b $0A
	CLC
	ADC.b $0E
	CLC
	ADC.w #$0018
	CMP.w #$0030
	BCS.b CODE_02E8E4
CODE_02E8DF:
	JSL.l CODE_03A858
	RTS

CODE_02E8E4:
	LDA.b $08
	CLC
	ADC.w #$0008
	CMP.w #$0010
	BCS.b CODE_02E8FA
	LDA.b $0A
	SEC
	SBC.w #$FFF8
	CMP.w #$0050
	BCC.b CODE_02E8DF
CODE_02E8FA:
	RTS

; Naval Piranha facing-X-speed magnitudes (Y = 0 face left, 2 face right).
DATA_02E8FB:
DATA_naval_pir_xspeed_facing:
                             dw $0080            ; (also indexed off DATA_naval_pir_xspeed_facing-$01 sometimes)

DATA_02E8FD:
DATA_naval_pir_init_phase_bias:
                             dw $FF80            ; initial $1086 phase counter (3-byte field below)

; Three combat-phase RNG seeds.  $1086 is set to one of these at bud-clear
; time depending on $1082 (remaining-bud-cap counter).  The 16-bit value is
; rotated bit-by-bit each frame in state $00 to drive bud-spawn / lunge /
; sweep decisions.
DATA_02E8FF:
DATA_naval_pir_phase_seeds:
                             dw $6D65,$D8ED,$62D9

;-------------------------------------------------------------------------
; CODE_naval_pir_state_bud_spawn_check ($76,x = $00): "what to do next" decision
; gate.  Runs only when buds have all retracted ($7019D6 == 0 for both buds
; in $1076 and $1078).  The 16-bit RNG $1086 is consumed 2 bits per cycle via
; SEC/ROR to pick one of four outcomes:
;   - bit shifted to carry=1, bit-1 = 1 -> state $0D bud-spawn LEFT
;   - bit shifted to carry=1, bit-1 = 0 -> state $15 bud-spawn RIGHT
;   - bit shifted to carry=0, bit-1 = 0 -> state $0C bud-watch (waits)
;   - bit shifted to carry=0, bit-1 = 1 -> state $07 short-retract + tongue lunge
; The full $1086 word is seeded from DATA_naval_pir_init_phase_bias[$1082 * 2] when it reaches
; $FFFF (exhausted).  $1082 is the remaining-bud-cap counter (starts at 3),
; so the live indices are $1082=3 -> $62D9, $1082=2 -> $D8ED, $1082=1 -> $6D65;
; the $1082=0 slot ($FF80 at DATA_naval_pir_init_phase_bias itself) is unreachable -- the defeat
; branch skips RNG.
;-------------------------------------------------------------------------
CODE_02E905:
CODE_naval_pir_state_bud_spawn_check:
	TYX
	LDA.w $7A96,x                               ; cooldown after last cycle
	BNE.b CODE_02E8FA                           ; still cooling: RTS
	LDA.w $7A98,x                               ; secondary cooldown
	BEQ.b CODE_naval_pir_check_cooldown
	JMP.w CODE_naval_pir_idle_anim_mouth                           ; still cooling: just animate

CODE_02E913:
CODE_naval_pir_check_cooldown:
	LDY.b $78,x                                 ; tongue-extend progress
	BNE.b CODE_02E91F
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x  ; secondary down-counter
	BEQ.b CODE_naval_pir_decide_action
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_02E91F:
	JMP.w CODE_naval_pir_idle_anim                           ; animate eye + mouth, no state change

; Both buds at rest ($7019D6 == 0) -- pick next action via $1086 RNG bits.
CODE_02E922:
CODE_naval_pir_decide_action:
	LDY.w $1076                                 ; slot-index of bud 0
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y  ; bud 0 state
	LDY.w $1078                                 ; slot-index of bud 1
	ORA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y  ; OR bud 1 state
	BNE.b CODE_02E91F                           ; either bud non-zero: keep waiting
	LDA.w $1086                                 ; RNG accumulator
	INC                                         ; reached -1 sentinel?
	BNE.b CODE_naval_pir_rng_dispatch
	LDA.w $1082                                 ; bud-cap remaining (3 -> 0)
	ASL
	TAY
	LDA.w DATA_naval_pir_init_phase_bias,y                         ; reseed RNG from phase table
	STA.w $1086
CODE_02E941:
CODE_naval_pir_rng_dispatch:
	LDA.w $1086
	SEC
	ROR
	BCC.b CODE_naval_pir_pick_lunge_or_watch                           ; bit-0 was 0: tongue-lunge / lateral branch
	LDY.b #$0D                                  ; bit-0 was 1: bud-spawn LEFT default
	SEC
	ROR                                         ; sample bit-1
	BCS.b CODE_naval_pir_kick_bud_emerge
	LDY.b #$15                                  ; bit-1 set: bud-spawn RIGHT instead
CODE_02E950:
CODE_naval_pir_kick_bud_emerge:
	STY.b $76,x                                 ; commit new state ($0D or $15)
	STA.w $1086
	LDY.w $7400,x                               ; facing (0 = left, 2 = right)
	LDA.w DATA_naval_pir_xspeed_facing,y                         ; per-facing X-speed
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0006                                ; arm tongue-extend $78,x = $06
	STA.b $78,x
	LDA.w #$0040                                ; small downward Y-vel
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_02E969:
CODE_naval_pir_arm_buds:
	LDY.w $1076
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDY.w $1078
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #$FFFF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	RTS

; RNG bit-0 = 0 branch: pick between watch-buds path and tongue-lunge path.
CODE_02E985:
CODE_naval_pir_pick_lunge_or_watch:
	SEC
	ROR                                         ; sample bit-1
	BCS.b CODE_naval_pir_kick_tongue_lunge
	STA.w $1086
	LDA.w #$04C0                                ; arm timer $0CE8 (combat-loop pause)
	STA.w $0CE8
	STZ.b $78,x
	LDY.b #$0C
	STY.b $76,x                                 ; -> state $0C watch_buds
	LDY.w $1076
	LDA.w #$0040
	STA.w $7A96,y                               ; arm bud 0 cooldown
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y  ; bud 0 sub-state
	LDY.w $1078
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y  ; bud 1 sub-state
	LDA.w #$00C0
	STA.w $7A96,y                               ; arm bud 1 cooldown
	RTS

; RNG bit-0+bit-1 = 11: tongue-lunge branch (state $07).
CODE_02E9B4:
CODE_naval_pir_kick_tongue_lunge:
	STA.w $1086
	LDY.b #$00
	STY.b $79,x
	LDA.w #$0010
	STA.w $7A96,x
	LDY.b #$07                                  ; -> state $07 retract_near
	STY.b $76,x
	RTS

; Idle eye/mouth animation tick (shared by several "cooling" states).
CODE_02E9C6:
CODE_naval_pir_idle_anim:
	JSR.w CODE_naval_pir_tick_eye                           ; tick eye anim ($78,x)
CODE_02E9C9:
CODE_naval_pir_idle_anim_mouth:
	JSR.w CODE_naval_pir_tick_mouth                           ; tick mouth anim ($79,x), maybe Munch sfx
	LDY.w $77C2,x                               ; collision-with-egg flag
	TYA
	CMP.w $7400,x                               ; same as facing? (= egg from opposite side)
	BEQ.b CODE_02E9DC
	STZ.w $107A
	LDY.b #$1A                                  ; egg-hit -> state $1A flash + i-frames
	STY.b $76,x
CODE_02E9DC:
	RTS

; Eye-anim frame cycle (4 phases): used by CODE_naval_pir_tick_eye below.
DATA_02E9DD:
DATA_naval_pir_eye_anim_frames:
                              db $00,$01,$02,$01

; Tick eye-frame cycle every 8 frames.
CODE_02E9E1:
CODE_naval_pir_tick_eye:
	LDA.w $7A98,x                               ; eye anim cooldown
	BNE.b CODE_02E9FB
	LDA.b $17,x                                 ; eye anim index
	INC
	AND.w #$FF03
	STA.b $17,x
	TAY
	LDA.w DATA_naval_pir_eye_anim_frames,y
	TAY
	STY.b $78,x                                 ; commit eye frame to $78,x
	LDA.w #$0008
	STA.w $7A98,x                               ; rearm 8-frame cooldown
CODE_02E9FB:
	RTS

; Mouth-anim frame pair (closed / open).
DATA_02E9FC:
DATA_naval_pir_mouth_anim_frames:
                              dw $0200,$0204

; Tick mouth anim; on every "open" frame, play the NavalPiranhaMunch sfx.
CODE_02EA00:
CODE_naval_pir_tick_mouth:
	LDA.w $7AF6,x                               ; mouth-anim cooldown
	BNE.b CODE_02EA2B
	LDA.b $16,x                                 ; mouth index
	INC
	AND.w #$FF03
	STA.b $16,x
	TAY
	LDA.w DATA_naval_pir_mouth_anim_frames,y                         ; pick open or closed (alternating)
	TAY
	STY.b $79,x                                 ; commit mouth frame to $79,x
	CPY.b #$04                                  ; "open" frame value?
	BNE.b CODE_02EA1F
	LDA.w #!Define_YI_SoundID7B_NavalPiranhaMunch
	JSL.l CODE_push_sound_queue
CODE_02EA1F:
	LDA.b $10                                   ; randomise cooldown 4..A frames
	AND.w #$0006
	CLC
	ADC.w #$0004
	STA.w $7AF6,x
CODE_02EA2B:
	RTS

;-------------------------------------------------------------------------
; CODE_naval_pir_state_intro ($76,x = $01): per-frame intro / pre-Yoshi-here gate.
; While $105A < 2 (Yoshi hasn't done both setup steps yet):
;   - Watches child piranha-plant slot $108A.  If the player chomps it
;     (status == $10), it triggers the "real" Naval Piranha intro cinematic:
;     player locked to cutscene, spawn ambient sprite $53 (Naval Piranha
;     head-pop debris), shove it offscreen with X-vel $FC00, JSL CODE_02A982
;     (the screen-shake helper), then PLA/JML CODE_despawn_sprite_free_slot to end the
;     piranha-plant slot.  (After this, the boss slot itself takes over.)
;   - Otherwise, when player has scrolled within $02B0 of Boss room edge,
;     starts the boss-room music transition (writes $0C23).
; When $105A >= 2 (player committed to fight): JSL CODE_03D5E4 (Naval
; Piranha HUD/HDMA setup), zero $7722, JSR CODE_naval_pir_spawn_buds_and_vines (spawn buds + vines),
; arm $76,x = $02 (rise), seed RNG with $62D9, set $74A2,x for body-render.
;-------------------------------------------------------------------------
CODE_02EA2C:
CODE_naval_pir_state_intro:
	TYX
	LDY.w $105A                                 ; "setup committed" gate (0,1,2)
	CPY.b #$02
	BPL.b CODE_naval_pir_intro_commit
	LDY.w $108A                                 ; child piranha-plant slot
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CMP.w #$0010                                ; chomped by Yoshi?
	BNE.b CODE_naval_pir_intro_approach_gate
	LDA.w #!Define_YI_PlayerState02_InCutscene
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w $70E2,y
	STA.b $00
	LDA.w #$0053                                ; spawn AmbSpr $53 (Naval debris)
	JSL.l CODE_spawn_sprite_active
	LDA.w $6094                                 ; +$0140 px right of camera
	CLC
	ADC.w #$0140
	STA.w $70E2,y
	LDA.w $609C
	CLC
	ADC.w #$0040
	STA.w $7182,y
	LDA.w #$FC00                                ; fling debris left
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0010
	STA.w $7540,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	JSL.l CODE_02A982                           ; screen-shake helper
	STZ.w $7ECC
	PLA                                         ; pop boss Main's return -> RTL
	JML.l CODE_despawn_sprite_free_slot                           ; queue boss closer, despawn

; Approach gate: when player has scrolled within $02B0 of boss-room edge,
; trigger boss-music transition.
CODE_02EA82:
CODE_naval_pir_intro_approach_gate:
	STZ.w $0C1E
	LDA.w #$02B0
	CMP.w !RAM_YI_Global_Layer1XPosLo
	BPL.b CODE_02EA94
	INC
	STA.w $0C23                                 ; mark layer-1 X for music transition
	INC.w $0C1E
CODE_02EA94:
	RTS

; Player committed -- run the real intro: HUD setup, spawn 2 buds + vine
; pair, arm state $02 (rise).
CODE_02EA95:
CODE_naval_pir_intro_commit:
	JSL.l CODE_03D5E4                           ; Naval Piranha HUD / HDMA setup
	STZ.w $7722,x
	JSR.w CODE_naval_pir_spawn_buds_and_vines                           ; spawn 2 buds + 2 vines
	STZ.w $7400,x                               ; face left
	LDA.w #$00C0
	STA.w $7A96,x
	LDA.w #$0002
	STA.b $76,x                                 ; -> state $02 rise
	LDA.w #$62D9                                ; seed RNG
	STA.w $1086
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $74A2,x                               ; enable body-render flag
	RTS

;-------------------------------------------------------------------------
; CODE_naval_pir_spawn_buds_and_vines: spawns the 2-bud / 2-vine
; child slots that the boss state machine drives.  Walks a 2-iteration loop:
;   pass 0: spawn bud at parent X + DATA_02E490[0] (= -$20)
;   pass 1: spawn bud at parent X + DATA_02E490[2] (= +$20)
; Each bud's slot index is stashed into the bud-spawn list at $1076 (pass 0)
; or $1078 (pass 1) -- this is the "bud spawn-list chain" used by the rest
; of the state machine to find buds without needing to scan sprite slots.
; After each bud spawn, JSR CODE_naval_pir_spawn_vine spawns a vine (sprite $002) anchored
; to that bud (passes the bud slot index in via $04 indirect).
; Bud slot fields written:
;   $70E2,y = parent X + DATA_02E490[i]
;   $7182,y = parent Y
;   $7402,y = 0
;   X-vel = 0, Y-vel = $FF80 (rises out of floor)
;   $7019D6,y = 1 (initial bud sub-state = "emerge")
;-------------------------------------------------------------------------
CODE_02EABD:
CODE_naval_pir_spawn_buds_and_vines:
	LDA.w #$0002
	STA.b $00                                   ; loop counter
	LDA.w #DATA_02E490                          ; ptr to X-offset table
	STA.b $02
	LDA.w #$1076                                ; ptr to bud-slot list ($1076, $1078)
	STA.b $04
CODE_02EACC:
CODE_naval_pir_bud_loop:
	LDA.w #$0172                                ; sprite ID = Naval Piranha bud
	JSL.l CODE_spawn_sprite_active                           ; spawn normal sprite (returns Y = slot)
	LDA.b ($02)                                 ; X-offset for this iteration
	CLC
	ADC.w $70E2,x
	STA.w $70E2,y                               ; bud X = parent X + offset
	LDA.w $7182,x
	STA.w $7182,y                               ; bud Y = parent Y
	LDA.w #$0000
	STA.w $7402,y                               ; clear bud anim frame
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FF80                                ; bud rises out of floor
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y  ; bud sub-state = 1
	TYA
	STA.b ($04)                                 ; STASH bud slot index into $1076/$1078 chain
	JSR.w CODE_naval_pir_spawn_vine                           ; spawn paired vine
	INC.b $02                                   ; advance to next X-offset
	INC.b $02
	INC.b $04                                   ; advance to next chain slot
	INC.b $04
	DEC.b $00
	BNE.b CODE_naval_pir_bud_loop
	RTS

;-------------------------------------------------------------------------
; CODE_naval_pir_spawn_vine: spawns a Naval Piranha vine (sprite
; $002) anchored to the bud just spawned.  The bud's slot index is read from
; the bud-spawn-list chain at ($04) and stashed into the vine's
; $701978 field so the vine's per-frame handler can look up "which bud is
; my parent" without scanning slots.
;-------------------------------------------------------------------------
CODE_02EB0A:
CODE_naval_pir_spawn_vine:
	LDA.w #$0002                                ; sprite ID = Naval Piranha vine
	JSL.l CODE_spawn_sprite_active
	LDA.w $70E2,x
	STA.w $70E2,y                               ; vine X = parent X
	LDA.w $7182,x
	CLC
	ADC.w #$FFB0                                ; vine Y = parent Y - $50 (up 80 px)
	STA.w $7182,y
	LDA.w #$0005
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y  ; vine sub-state 5
	LDA.b ($04)                                 ; bud slot (just stashed)
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y  ; -> vine's "parent bud"
	RTS

;-------------------------------------------------------------------------
; CODE_naval_pir_state_rise ($76,x = $02): Naval Piranha rises from floor to its
; combat perch at Y = $1074 (the parent's stored "perch Y" set during Init).
; Each frame applies Y-vel = -$40 (rise) until $7182 >= $1074, at which
; point clamp Y, zero Y-vel, zero $78,x (tongue-extend), INC $76,x to state $03.
;-------------------------------------------------------------------------
CODE_02EB2D:
CODE_naval_pir_state_rise:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_02EB4B                           ; still cooling: don't move
	LDA.w #$FFC0                                ; Y-vel = -$40 (rise)
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $1074                                 ; perch Y target
	CMP.w $7182,x
	BMI.b CODE_02EB4B                           ; not yet at perch
	STA.w $7182,x                               ; clamp Y to perch
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.b $78,x
	INC.b $76,x                                 ; -> state $03 munch_osc
CODE_02EB4B:
	RTS

; Per-axis position-change deltas (Y indexed: 0 = decrease, 2 = increase).
DATA_02EB4C:
DATA_naval_pir_pos_delta_4:
                          dw $FFFC,$0004        ; +/-$04 step

DATA_02EB50:
DATA_naval_pir_pos_delta_1:
                          dw $FFFF,$0001        ; +/-$01 step

;-------------------------------------------------------------------------
; CODE_naval_pir_state_munch_osc: shared "body oscillates while
; buds munch" handler.  Used by states $03, $06, $0B, $11, $14, $19.
;
; If $7A96 != 0 (cooldown active): fall through to CODE_naval_pir_brake_after_sweep which checks
; the X-vel for state $19 (sweep-end) and zeroes it if near-zero.
;
; Otherwise: every frame, move three trackable values toward defaults:
;   $1070 (Mode-7 angle / body rotation) -> $FFC0  (step $04 via DATA_naval_pir_pos_delta_4)
;   $1068 (boss HP-scaled body shape)     -> $0023 (step $01 via DATA_naval_pir_pos_delta_1)
;   $7A38 (body-bias for OAM)             -> 0     (step $04, AND $01FE)
; Also raise sprite if below perch ($7182 < $1074).
;
; A "settled" flag ($00 on stack) increments when each tracked value reaches
; its target.  When all 4 conditions hit ($00 == 0 by underflow):
;   - state $11: $76,x -> $12 (retract_far)
;   - state $03: arm $7A96 = $40 and $76,x -> $04 (retract_far via INC)
;   - state $06: clear cutscene flags ($0C1E and player state)
;   - others   : INC $76,x to advance to next state
;-------------------------------------------------------------------------
CODE_02EB54:
CODE_naval_pir_state_munch_osc:
	TYX
	LDA.w $7A96,x
	BEQ.b CODE_naval_pir_munch_osc_step
	JMP.w CODE_naval_pir_brake_after_sweep                           ; cooling: just brake X-vel if state $19

CODE_02EB5D:
CODE_naval_pir_munch_osc_step:
	LDA.w $7AF6,x
	BNE.b CODE_02EB73
	SEP.b #$20
	LDA.b $79,x
	LSR
	AND.b #$FE
	STA.b $79,x
	REP.b #$20
	LDA.w #$0004
	STA.w $7AF6,x
CODE_02EB73:
	LDY.b #$04
	STY.b $00
	LDY.b #$00
	LDA.w $1070
	SEC
	SBC.w #$FFBC
	CMP.w #$0008
	BCS.b CODE_02EB8C
	DEC.b $00
	LDA.w #$FFC0
	BRA.b CODE_02EB97

CODE_02EB8C:
	BPL.b CODE_02EB90
	INY
	INY
CODE_02EB90:
	LDA.w $1070
	CLC
	ADC.w DATA_naval_pir_pos_delta_4,y
CODE_02EB97:
	STA.w $1070
	LDY.b #$00
	LDA.w $1068
	SEC
	SBC.w #$0023
	CMP.w #$0002
	BCS.b CODE_02EBAF
	DEC.b $00
	LDA.w #$0024
	BRA.b CODE_02EBBA

CODE_02EBAF:
	BPL.b CODE_02EBB3
	INY
	INY
CODE_02EBB3:
	LDA.w $1068
	CLC
	ADC.w DATA_naval_pir_pos_delta_1,y
CODE_02EBBA:
	STA.w $1068
	LDY.b #$00
	LDA.w $7A38,x
	CLC
	ADC.w #$0004
	CMP.w #$0008
	BCS.b CODE_02EBD2
	DEC.b $00
	LDA.w #$0000
	BRA.b CODE_02EBE3

CODE_02EBD2:
	CMP.w #$00FC
	BMI.b CODE_02EBD9
	INY
	INY
CODE_02EBD9:
	LDA.w $7A38,x
	CLC
	ADC.w DATA_naval_pir_pos_delta_4,y
	AND.w #$01FE
CODE_02EBE3:
	STA.w $7A38,x
	LDA.w #$FFC0
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $1074
	CMP.w $7182,x
	BMI.b CODE_02EBFC
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	DEC.b $00
CODE_02EBFC:
	LDY.b $00
	BNE.b CODE_naval_pir_brake_after_sweep
	LDY.b $76,x
	CPY.b #$11
	BEQ.b CODE_02EC25
	CPY.b #$03
	BEQ.b CODE_02EC1F
	CPY.b #$06
	BNE.b CODE_02EC14
	STZ.w $0C1E
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
CODE_02EC14:
	STZ.b $16,x
	LDA.w #$0003
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.b $76,x
	RTS

CODE_02EC1F:
	LDA.w #$0040
	STA.w $7A96,x
CODE_02EC25:
	INC.b $76,x
	RTS

; State-$19 sweep-brake: if X-vel within +/-$40 of zero, snap to zero (so
; the sweep doesn't keep coasting after retract begins).
CODE_02EC28:
CODE_naval_pir_brake_after_sweep:
	LDY.b $76,x
	CPY.b #$19
	BNE.b CODE_02EC40
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_02EC40
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
CODE_02EC40:
	RTS

;-------------------------------------------------------------------------
; naval_pir_state_retract (CODE_naval_pir_state_retract_near / CODE_naval_pir_state_retract_far): retract toward home.
; Two entrypoints picking the target depth:
;   CODE_naval_pir_state_retract_near (state $07): far retract, target $7A38 = $01A0
;   CODE_naval_pir_state_retract_far (states $04/$12/$1C/$20): near retract, target $7A38 = $01C0
; Each frame moves three trackable values back toward neutral:
;   $1070 += $08  clamped to <= $FFE0  (body angle/rotation toward 0)
;   $1068 = ($1068 + $0026 + 1) / 2    (HP-scaled body shape averaging)
;   $7A38 -= $0010 AND $01FE clamped >= $02  (body depth toward target)
; On full settle ($00 -> 0): clear $16, write $701902 = 4 (or 1 for state
; $20 / $0C for state $04), INC $76,x to next state.
;-------------------------------------------------------------------------
CODE_02EC41:
CODE_naval_pir_state_retract_near:
	LDA.w #$01A0
	BRA.b CODE_naval_pir_retract_common

CODE_02EC46:
CODE_naval_pir_state_retract_far:
	LDA.w #$01C0
CODE_02EC49:
CODE_naval_pir_retract_common:
	STA.b $02                                   ; arg: target body depth
	TYX
	LDA.w $7A96,x
	BNE.b CODE_02ECAA
	LDY.b #$02
	STY.b $00
	LDA.w $1070
	CLC
	ADC.w #$0008
	CMP.w #$FFE0
	BMI.b CODE_02EC66
	DEC.b $00
	LDA.w #$FFE0
CODE_02EC66:
	STA.w $1070
	LDA.w $1068
	CLC
	ADC.w #$0026
	INC
	LSR
	STA.w $1068
	LDA.w $7A38,x
	SEC
	SBC.w #$0010
	AND.w #$01FE
	CMP.b $02
	BPL.b CODE_02EC87
	DEC.b $00
	LDA.b $02
CODE_02EC87:
	STA.w $7A38,x
	LDY.b $00
	BNE.b CODE_02ECAA
	STZ.b $16,x
	LDA.w #$0004
	LDY.b $76,x
	CPY.b #$20
	BNE.b CODE_02EC9E
	LDA.w #$0001
	BRA.b CODE_02ECA5

CODE_02EC9E:
	CPY.b #$04
	BNE.b CODE_02ECA5
	LDA.w #$000C
CODE_02ECA5:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	INC.b $76,x
CODE_02ECAA:
	RTS

;-------------------------------------------------------------------------
; CODE_naval_pir_state_tongue_extend ($76,x = $08): grow body/tongue out toward
; the player.  Each frame decrements $701900,x ("body extension counter")
; by $0010.  When it drops below $0180, arm $7A96 = $08 and INC $76,x
; (advance to state $09 lunge).
;-------------------------------------------------------------------------
CODE_02ECAB:
CODE_naval_pir_state_tongue_extend:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.w #$0010
	CMP.w #$0180
	BPL.b CODE_02ECC3
	LDA.w #$0008
	STA.w $7A96,x
	INC.b $76,x                                 ; -> state $09 tongue_lunge
	LDA.w #$017F
CODE_02ECC3:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_02ECC6:
	RTS

; Projectile-spawn X/Y-velocity tables for the tongue-lunge spawn at
; CODE_naval_pir_state_tongue_lunge (3 projectiles, indexed Y = 2, 4, 6).
DATA_02ECC7:
DATA_naval_pir_proj_xvel:
                        dw $FF38,$FE78,$FDC8    ; X-vels (right-facing; negated below if left)

DATA_02ECCD:
DATA_naval_pir_proj_yvel:
                        dw $FC14,$FC4C,$FCAC    ; Y-vels (negative = upward arc)

;-------------------------------------------------------------------------
; CODE_naval_pir_state_tongue_lunge ($76,x = $09): lunge animation + projectile
; spawn.  Each frame ticks $701900,x back UP by $0010 (tongue retracting).
; On the frame it crosses $01FF (= full retract reached):
;   - Play LungeFish sfx
;   - Compute spawn point at parent X+$0C, Y+$0E (head-of-tongue offset)
;   - Spawn 3 projectiles of sprite ID $0165 (Naval Piranha projectile spit)
;     with per-projectile X/Y-velocities from DATA_naval_pir_proj_xvel/CCD.  X-vels
;     are negated for left-facing.
;   - Arm $7A96 = $10, INC $76,x to state $0A lunge_settle.
;-------------------------------------------------------------------------
CODE_02ECD3:
CODE_naval_pir_state_tongue_lunge:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_02ECC6
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0010
	CMP.w #$01FF
	BMI.b CODE_02ED5B
	LDA.w $70E2,x
	CLC
	ADC.b $0C
	STA.b $00
	LDA.w $7182,x
	CLC
	ADC.b $0E
	STA.b $02
	LDA.w #!Define_YI_SoundID83_LungeFish
	JSL.l CODE_push_sound_queue
	LDA.w #$0006
	STA.b $0A
CODE_02ED01:
	LDY.b $0A
	LDA.w DATA_naval_pir_proj_yvel-$02,y
	STA.b $08
	LDA.w DATA_naval_pir_proj_xvel-$02,y
	LDY.w $7400,x
	BEQ.b CODE_02ED14
	EOR.w #$FFFF
	INC
CODE_02ED14:
	STA.b $06
	LDA.w #$0165
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_02ED50
	LDA.b $00
	STA.w $70E2,y
	LDA.b $02
	STA.w $7182,y
	LDA.b $06
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $08
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.w $7A36,y
	ASL
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	STA.w $7540,y
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	DEC.b $0A
	DEC.b $0A
	BNE.b CODE_02ED01
CODE_02ED50:
	LDA.w #$0010
	STA.w $7A96,x
	INC.b $76,x
	LDA.w #$01FF
CODE_02ED5B:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.b #$00
	CMP.w #$01B0
	BMI.b CODE_02ED6E
	LDY.b #$02
	CMP.w #$01E0
	BMI.b CODE_02ED6E
	LDY.b #$04
CODE_02ED6E:
	STY.b $79,x
	RTS

;-------------------------------------------------------------------------
; CODE_naval_pir_state_lunge_settle ($76,x = $0A): rest frame after the lunge.
; Clears mouth-anim ($79,x), arms $7A96 = $0100, INC $76,x to state $0B
; (munch_osc shared).
;-------------------------------------------------------------------------
CODE_02ED71:
CODE_naval_pir_state_lunge_settle:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_02ED83
	LDY.b #$00
	STY.b $79,x
	LDA.w #$0100                                ; long cool-down before next combat tick
	STA.w $7A96,x
	INC.b $76,x                                 ; -> state $0B munch_osc
CODE_02ED83:
	RTS

;-------------------------------------------------------------------------
; CODE_naval_pir_state_watch_buds ($76,x = $0C): idle gate -- wait until both
; buds are fully retracted ($7019D6,$1076 == 0 and same for $1078).  When
; clear: clear $701902, zero $76,x (back to bud-spawn-check $00).  Else
; tick idle anim and check for egg-hit (jumps to state $1A).
;-------------------------------------------------------------------------
CODE_02ED84:
CODE_naval_pir_state_watch_buds:
	TYX
	LDY.w $1076
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y  ; bud 0 state
	LDY.w $1078
	ORA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y  ; OR bud 1
	BNE.b CODE_naval_pir_watch_buds_anim                           ; either still active: stay
	LDA.w #$0003
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.b $76,x                                 ; -> state $00 bud_spawn_check
	RTS

CODE_02ED9C:
CODE_naval_pir_watch_buds_anim:
	JSR.w CODE_naval_pir_tick_eye                           ; tick eye anim
	JSR.w CODE_naval_pir_tick_mouth                           ; tick mouth anim
	LDY.w $77C2,x                               ; egg-hit flag
	TYA
	CMP.w $7400,x
	BEQ.b CODE_02EDB4
	LDY.b #$0C                                  ; on-hit: remember to return to state $0C
	STY.w $107A
	LDY.b #$1A
	STY.b $76,x                                 ; -> state $1A post_hit_flash
CODE_02EDB4:
	RTS

;-------------------------------------------------------------------------
; CODE_naval_pir_state_decel_x ($76,x = $0F): brake X-velocity to zero.
; Each frame moves X-vel toward 0 by +$0018 magnitude.  When |X-vel| < $0018,
; clear it and the bow-string ($7540), arm $7A96 = $40, INC $76,x to state
; $10 (lateral_lunge).  Otherwise calls CODE_naval_pir_advance_toward_target (the "advance toward
; lateral lunge target" subroutine, shared with sweep states).
;-------------------------------------------------------------------------
CODE_02EDB5:
CODE_naval_pir_state_decel_x:
	TYX
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0018
	CMP.w #$0030
	BCS.b CODE_02EDD1
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7A96,x
	INC.b $76,x                                 ; -> state $10 lateral_lunge
	RTS

CODE_02EDD1:
	JSR.w CODE_naval_pir_advance_toward_target                           ; reuse: advance toward target X
	RTS

; Lateral-lunge Y-velocities (Y indexed: 0,2 = small lunge; 4,6 = big lunge).
DATA_02EDD5:
DATA_naval_pir_lateral_yvels:
                            dw $0100,$FF00,$0200,$FE00

; Lateral-lunge home X-positions (Y = facing: 0 = right $03B0, 2 = left $02E0).
DATA_02EDDD:
DATA_naval_pir_lateral_home_x:
                            dw $03B0,$02E0

;-------------------------------------------------------------------------
; CODE_naval_pir_state_lateral_lunge ($76,x = $10): lateral strike at the player.
; Picks a Y-velocity from DATA_naval_pir_lateral_yvels based on facing + relative player X,
; sets $7540 (bow-string / Y-bias) and applies until the body crosses its
; lateral-home X (DATA_naval_pir_lateral_home_x[facing]).  At that point, clamp X, zero X-vel
; and bow, INC $76,x to state $11 (munch_osc).
;-------------------------------------------------------------------------
CODE_02EDE1:
CODE_naval_pir_state_lateral_lunge:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_02EE23
	LDY.w $7400,x
	TYA
	DEC
	EOR.w $7C16,x
	BMI.b CODE_02EDF7
	TYA
	CLC
	ADC.w #$0004
	TAY
CODE_02EDF7:
	LDA.w DATA_naval_pir_lateral_yvels,y
	STA.w $75E0,x
	LDA.w #$0008
	STA.w $7540,x
	LDY.w $7400,x
	LDA.w $70E2,x
	SEC
	SBC.w DATA_naval_pir_lateral_home_x,y
	STA.b $02
	TYA
	DEC
	EOR.b $02
	BPL.b CODE_02EE23
	LDA.w DATA_naval_pir_lateral_home_x,y
	STA.w $70E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	INC.b $76,x
CODE_02EE23:
	RTS

; Chomp animation cycle (4 frames): closed, half-open + sfx, full-open, half-open.
; Y values 0,2,4,6 indexed.  Value at Y=4 ($040B) triggers the NavalPiranhaMunch sfx.
DATA_02EE24:
DATA_naval_pir_chomp_anim_frames:
                                dw $0009,$020A,$040B,$020A

;-------------------------------------------------------------------------
; CODE_naval_pir_state_chomp: bite/chomp loop.  Used by states
; $05, $13, $1D, $21.  Cycles 4-frame anim DATA_naval_pir_chomp_anim_frames, playing Munch sfx
; on each open frame and decrementing the chomp-count $701902.  When count
; hits 0, INC $76,x to next state.  At state $14, skip cool-down (continues
; immediately).  At state $06 (set by INC from $05): cool $80 frames.
; At state $22 (post-defeat-explode): reset $16 = $1B for stretch sequence.
; Otherwise: cool $40 frames.
;-------------------------------------------------------------------------
CODE_02EE2C:
CODE_naval_pir_state_chomp:
	TYX
	LDA.w $7A98,x                               ; chomp-frame cooldown
	BNE.b CODE_02EE75
	LDA.w #$0004
	STA.w $7A98,x                               ; rearm 4-frame cooldown
	LDA.b $16,x                                 ; chomp anim index
	INC
	INC
	AND.w #$0006                                ; cycle 0,2,4,6
	STA.b $16,x
	TAY
	LDA.w DATA_naval_pir_chomp_anim_frames,y
	STA.b $78,x                                 ; commit anim frame
	CPY.b #$04                                  ; open-mouth frame?
	BNE.b CODE_02EE75
	LDA.w #!Define_YI_SoundID7B_NavalPiranhaMunch
	JSL.l CODE_push_sound_queue
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x  ; chomp count
	BNE.b CODE_02EE75
	INC.b $76,x                                 ; chomp done -> next state
	LDY.b $76,x
	CPY.b #$14
	BEQ.b CODE_02EE75                           ; state $14: no cool-down
	LDA.w #$0080
	CPY.b #$06
	BEQ.b CODE_02EE72
	CPY.b #$22                                  ; defeat-explode chomp?
	BNE.b CODE_02EE6F
	LDA.w #$001B                                ; arm post-defeat stretch idx
	STA.b $16,x
CODE_02EE6F:
	LDA.w #$0040
CODE_02EE72:
	STA.w $7A96,x
CODE_02EE75:
	RTS

; Return-home anchor X positions (Y = facing: 0 = right home $03B0, 2 = left home $02E0).
DATA_02EE76:
DATA_naval_pir_home_x_anchor:
                            dw $03B0,$02E0

;-------------------------------------------------------------------------
; CODE_naval_pir_state_return_home: glide back to home X and home Y.
; Used by states $0D, $15, $1F.  Each frame moves three trackables toward
; home target ($1070 -> $FF80 by -4, $1068 -> $001C by -1, $7A38 -> $0070
; by +4).  When all three settle ($00 underflows), if state == $1F,
; advance with re-arm (special: copy bud states from cache $107C).  Else
; arm $7A96 = $20 and INC $76,x.  Tail logic: if state == $1F and the cache
; of bud states is unloaded (== 0), call CODE_naval_pir_sweep_check_bounds to re-arm buds.
;-------------------------------------------------------------------------
CODE_02EE7A:
CODE_naval_pir_state_return_home:
	TYX
	LDY.b #$05
	STY.b $00
	LDA.w $1070
	SEC
	SBC.w #$0004
	CMP.w #$FF81
	BPL.b CODE_02EE90
	DEC.b $00
	LDA.w #$FF80
CODE_02EE90:
	STA.w $1070
	LDA.w $1068
	DEC
	CMP.w #$001D
	BPL.b CODE_02EEA1
	DEC.b $00
	LDA.w #$001C
CODE_02EEA1:
	STA.w $1068
	LDA.w $7A38,x
	CLC
	ADC.w #$0004
	CMP.w #$0070
	BMI.b CODE_02EEB5
	DEC.b $00
	LDA.w #$0070
CODE_02EEB5:
	STA.w $7A38,x
	LDY.w $7400,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_02EECF
	LDA.w $70E2,x
	SEC
	SBC.w DATA_naval_pir_home_x_anchor,y
	STA.b $02
	TYA
	DEC
	EOR.b $02
	BPL.b CODE_02EEDA
CODE_02EECF:
	DEC.b $00
	LDA.w DATA_naval_pir_home_x_anchor,y
	STA.w $70E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_02EEDA:
	LDA.w $1074
	CLC
	ADC.w #$0010
	CMP.w $7182,x
	BPL.b CODE_02EEEF
	INC
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	DEC.b $00
CODE_02EEEF:
	LDY.b $00
	BNE.b CODE_02EF06
	LDY.b $76,x
	CPY.b #$1F
	BEQ.b CODE_02EF07
	INC.b $76,x
CODE_02EEFB:
	STZ.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7A96,x
CODE_02EF06:
	RTS

CODE_02EF07:
	LDA.w $7042,x
	AND.w #$FFF0
	ORA.w #$000C
	STA.w $7042,x
	STZ.w $7AF8,x
	LDY.w $1076
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDY.w $1078
	ORA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	BNE.b CODE_02EF06
	LDY.b #$16
	STY.b $76,x
	JSR.w CODE_02EEFB
	JMP.w CODE_naval_pir_arm_buds

; Sweep Y-velocity per facing (0 = sweep right Y-vel $FD00, 2 = sweep left $0300).
DATA_02EF2E:
DATA_naval_pir_sweep_yvel:
                         dw $FD00,$0300

; Sweep anim frame pair: (closed-eye $0706, open-eye $0708) for sweep phases.
DATA_02EF32:
DATA_naval_pir_sweep_anim:
                         dw $0706,$0708

; Sweep target-X table (40 entries) indexed by ($7400 facing OR sub-anim
; index from $78,x).  Entries 2..5 are address-shaped ($EF42 etc.) -- used
; as relative-pointer values by the sweep advance code; entries 6+ are
; absolute pixel deltas for the per-frame "lerp toward target X" routine
; CODE_naval_pir_advance_toward_target.
DATA_02EF36:
DATA_naval_pir_sweep_targets:
	dw $02E8,$03A4,$EF42,$EF52,$EF62,$EF72,$0010,$0040
	dw $0080,$00B0,$FFF0,$FFE0,$FFE8,$FFD0,$0010,$0040
	dw $0080,$00B0,$FFF0,$FFE0,$FFE8,$FFD0,$0010,$0040
	dw $0080,$00B0,$FFF0,$FFE0,$FFE8,$FFD0,$0010,$0040
	dw $0080,$00B0,$FFF0,$FFE0,$FFE8,$FFD0

; Post-defeat sweep X-vels (Y = facing: 0 -> $0100 right, 2 -> $FF00 left).
DATA_02EF82:
DATA_naval_pir_post_defeat_xvel:
                               dw $0100,$FF00

;-------------------------------------------------------------------------
; CODE_naval_pir_state_sweep: wide sideways sweep across the
; arena.  Used by states $0E, $16.
; While cool-down running: apply per-facing Y-vel from DATA_naval_pir_sweep_yvel and the
; sweep anim from DATA_naval_pir_sweep_anim.  When the body crosses the arena bounds
; ($70E2 within $0060 of $0320) and the state is NOT $16, INC $76,x and
; brake (sets $7540 = $18 bow-string and zeros Y-vel).  Otherwise falls
; into CODE_naval_pir_advance_toward_target (advance-toward-target) which does the per-frame X-lerp
; against DATA_naval_pir_sweep_targets[facing].
;-------------------------------------------------------------------------
CODE_02EF86:
CODE_naval_pir_state_sweep:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_naval_pir_sweep_check_bounds
	LDY.w $7400,x
	LDA.w DATA_naval_pir_sweep_yvel,y                         ; per-facing Y-vel
	STA.w $75E0,x
	LDA.w #$0010
	STA.w $7540,x
	LDA.w $7A98,x
	BNE.b CODE_naval_pir_sweep_check_bounds
	LDA.b $16,x
	INC
	AND.w #$0003                                ; 4-frame anim cycle
	STA.b $16,x
	TAY
	LDA.w DATA_naval_pir_sweep_anim,y
	TAY
	STY.b $78,x                                 ; commit sweep anim
	LDA.w #$0008
	STA.w $7A98,x
CODE_02EFB5:
CODE_naval_pir_sweep_check_bounds:
	LDY.b $76,x
	CPY.b #$16
	BEQ.b CODE_naval_pir_advance_toward_target                           ; state $16: skip bounds check
	LDA.w $70E2,x
	SEC
	SBC.w #$0320                                ; arena right-bound (-300)
	CMP.w #$0060                                ; within $60 px?
	BCS.b CODE_naval_pir_advance_toward_target
	STZ.w $75E0,x
	LDA.w #$0018
	STA.w $7540,x
	INC.b $76,x                                 ; -> next state (sweep done)
	RTS

;-------------------------------------------------------------------------
; CODE_naval_pir_advance_toward_target: per-frame X-lerp toward
; DATA_naval_pir_sweep_targets[facing*2].  Shared subroutine used by:
;   - state $0F (decel_x via CODE_02EDD1)
;   - state $0E/$16 (sweep via fall-through)
; When the body crosses the target X, snap to target, set $78,x = 6
; (back to RNG/anim init), pick the post-defeat or sweep-end X-vel from
; DATA_naval_pir_post_defeat_xvel, and either advance to next state (sweep) or trigger
; explosion sfx (CODE_naval_pir_trigger_explosion).
;-------------------------------------------------------------------------
CODE_02EFD3:
CODE_naval_pir_advance_toward_target:
	LDY.w $7400,x
	LDA.w $70E2,x
	SEC
	SBC.w DATA_naval_pir_sweep_targets,y
	STA.b $02
	TYA
	DEC
	EOR.b $02
	BMI.b CODE_02F014
	LDA.w DATA_naval_pir_sweep_targets,y
	STA.w $70E2,x
	LDY.b #$06
	STY.b $78,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCS.b CODE_naval_pir_trigger_explosion
	LDA.w #$0040
	STA.w $7A96,x
	LDY.w $7400,x
	LDA.w DATA_naval_pir_post_defeat_xvel,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0008
	STA.w $7540,x
	LDY.b #$19
	STY.b $76,x
CODE_02F014:
	RTS

; Trigger-explosion path: snap to target, play Explosion sfx, queue screen
; shake $61C8 = $20, force state $17 defeat_grow.
CODE_02F015:
CODE_naval_pir_trigger_explosion:
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	LDA.w #$0020
	STA.w $61C8                                 ; screen-shake duration
	LDY.b #$17
	STY.b $76,x                                 ; -> state $17 defeat_grow
	RTS

;-------------------------------------------------------------------------
; CODE_naval_pir_state_defeat_grow ($76,x = $17): head balloon-grows during
; defeat.  Each frame:
;   - Decrease $7A36 by $60 (shrink first), then floor at $0140 (max grow).
;   - Send $7A36/2 to GSU R6, kick FXCODE_0B86B6 (the balloon-radius
;     calculator); R0 output is the chord-X delta.
;   - Re-center $70E2 by chord-X offset using DATA_naval_pir_sweep_targets anchor for facing.
; INC $76,x when balloon reaches max -> state $18 defeat_push.
;-------------------------------------------------------------------------
CODE_02F02D:
CODE_naval_pir_state_defeat_grow:
	TYX
	LDA.w $7A36,x                               ; balloon-radius counter
	SEC
	SBC.w #$0060
	CMP.w #$0140                                ; cap at $0140
	BPL.b CODE_naval_pir_defeat_run_balloon_gsu
	INC.b $76,x                                 ; -> state $18 defeat_push
	LDA.w #$0140
CODE_02F03F:
CODE_naval_pir_defeat_run_balloon_gsu:
	STA.w $7A36,x
	LSR
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0018
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6                        ; GSU: balloon radius math
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w #$0018
	SEC
	SBC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDY.w $7400,x                               ; facing
	BNE.b CODE_02F067
	EOR.w #$FFFF
	INC                                         ; negate for facing-left
CODE_02F067:
	ASL
	CLC
	ADC.w DATA_naval_pir_sweep_targets,y                         ; +per-facing chord-X anchor
	STA.w $70E2,x                               ; recenter X
	RTS

; Defeat-push X-vels (Y = facing: 0 -> $0200 right, 2 -> $FE00 left).
DATA_02F070:
DATA_naval_pir_defeat_push_xvel:
                               dw $0200,$FE00

;-------------------------------------------------------------------------
; CODE_naval_pir_state_defeat_push ($76,x = $18): adds another $40 to the
; balloon radius beyond $0140 until it hits $01FF (full size).  At that
; point, set facing-X-vel, arm bow-string $7540 = $10, cool $40 frames,
; INC $76,x to state $19 (munch_osc one final time before sweep).
;-------------------------------------------------------------------------
CODE_02F074:
CODE_naval_pir_state_defeat_push:
	TYX
	LDA.w $7A36,x
	CLC
	ADC.w #$0040                                ; expand by $40/frame
	CMP.w #$01FF
	BMI.b CODE_naval_pir_defeat_run_balloon_gsu                           ; not full yet: rerun balloon GSU
	LDY.w $7400,x
	LDA.w DATA_naval_pir_defeat_push_xvel,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0010
	STA.w $7540,x
	ASL
	ASL                                         ; * 4
	STA.w $7A96,x                               ; cool $40 frames
	INC.b $76,x                                 ; -> state $19 munch_osc
	LDA.w #$01FF                                ; fix balloon at full
	BRA.b CODE_naval_pir_defeat_run_balloon_gsu

;-------------------------------------------------------------------------
; CODE_naval_pir_state_post_hit_flash ($76,x = $1A): runs after every egg-hit.
; Tick-down $78,x (flash counter); when 0, initialise $7A98 = 3, $78,x = 4,
; INC $76,x to state $1B anim_cycle.  Continues running mouth/eye anim
; sub-cycle every other frame.  Also runs the standard mouth tick on hit
; (CODE_naval_pir_tick_mouth) so the mouth stays animated during invincibility.
;-------------------------------------------------------------------------
CODE_02F09C:
CODE_naval_pir_state_post_hit_flash:
	TYX
	LDA.b $78,x
	BNE.b CODE_02F0AF
	STZ.b $16,x
	LDA.w #$0003
	STA.w $7A98,x
	INC
	STA.b $78,x
	INC.b $76,x
	RTS

CODE_02F0AF:
	LDY.b $78,x
	BEQ.b CODE_02F0C6
	LDA.w $7A98,x
	BNE.b CODE_02F0C6
	LDA.b $78,x
	INC
	AND.w #$FF03
	STA.b $78,x
	LDA.w #$0004
	STA.w $7A98,x
CODE_02F0C6:
	LDY.b $79,x
	BEQ.b CODE_02F0EF
	LDA.w $7AF6,x
	BNE.b CODE_02F0EF
	LDA.b $16,x
	INC
	AND.w #$0003
	STA.b $16,x
	TAY
	LDA.w DATA_naval_pir_mouth_anim_frames,y
	TAY
	STY.b $79,x
	CPY.b #$04
	BNE.b CODE_02F0E9
	LDA.w #!Define_YI_SoundID7B_NavalPiranhaMunch
	JSL.l CODE_push_sound_queue
CODE_02F0E9:
	LDA.w #$0004
	STA.w $7AF6,x
CODE_02F0EF:
	RTS

; Per-frame anim/pose tables for the post-hit "shake head + flip facing"
; sub-cycle in state $1B.  Indexed by $16,x stepping 2..A by +2.
DATA_02F0F0:
DATA_naval_pir_shake_anim:
                             dw $0604,$0605,$0605,$0604,$0003

DATA_02F0FA:
DATA_naval_pir_shake_angle:
                             dw $FFB0,$FFA8,$FFA8,$FFB0,$FFC0

DATA_02F104:
DATA_naval_pir_shake_body:
                             dw $0024,$0020,$0020,$0024,$0024

;-------------------------------------------------------------------------
; CODE_naval_pir_state_anim_cycle ($76,x = $1B): post-hit "shake head" sub-cycle.
; Walks $16,x from 2 to $0A by +2 each cooldown tick, writing one row of
; DATA_naval_pir_shake_anim/F0FA/F104 to $78,x/$1070/$1068.  At index $06 (mid-cycle),
; flip facing ($7400 EOR $02) so the boss shakes side-to-side.  When index
; reaches $0C, EOR-flip the player-target $106E, clear $78 and $16, then
; load $76,x from $107A (resume-state stashed in state $0C / $1A above).
;-------------------------------------------------------------------------
CODE_02F10E:
CODE_naval_pir_state_anim_cycle:
	TYX
	LDA.w $7A98,x                               ; sub-cycle cooldown
	BNE.b CODE_02F155
	INC.b $16,x                                 ; +2 (alternating row index)
	INC.b $16,x
	LDY.b $16,x
	CPY.b #$0C                                  ; cycle complete?
	BMI.b CODE_naval_pir_anim_cycle_step
	LDA.w $106E                                 ; flip player-target sign
	EOR.w #$FFFF
	STA.w $106E
	STZ.b $78,x
	STZ.b $16,x
	LDY.w $107A                                 ; resume-state cache
	STY.b $76,x                                 ; -> resume state
	RTS

CODE_02F131:
CODE_naval_pir_anim_cycle_step:
	LDA.w DATA_naval_pir_shake_anim-$02,y                     ; -2 because Y starts at 2
	STA.b $78,x
	LDA.w DATA_naval_pir_shake_angle-$02,y
	STA.w $1070                                 ; commit body angle
	LDA.w DATA_naval_pir_shake_body-$02,y
	STA.w $1068                                 ; commit body shape
	CPY.b #$06                                  ; mid-cycle: flip facing
	BNE.b CODE_02F14F
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_02F14F:
	LDA.w #$0004                                ; rearm 4-frame cooldown
	STA.w $7A98,x
CODE_02F155:
	RTS

;-------------------------------------------------------------------------
; CODE_naval_pir_state_bud_second_wave ($76,x = $1E): triggers second wave of
; bud activity using the cached pre-hit bud states at $107C.
; Restores both buds' sub-states from $107C cache, sets X-speed magnitude
; from DATA_naval_pir_xspeed_facing[facing], arms $78,x = 6, Y-vel = $40, INC $76,x to $1F.
;-------------------------------------------------------------------------
CODE_02F156:
CODE_naval_pir_state_bud_second_wave:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_02F155
	LDY.b $79,x
	TYA
	LSR
	AND.w #$00FE
	STA.b $00
	LDA.b $79,x
	AND.w #$FF00
	ORA.b $00
	STA.b $79,x
	LDY.b #$02
	STY.b $00
	LDA.w $7A38,x
	CMP.w #$0010
	BPL.b CODE_02F17E
	DEC.b $00
	BRA.b CODE_02F188

CODE_02F17E:
	CLC
	ADC.w #$0004
	AND.w #$01FE
	STA.w $7A38,x
CODE_02F188:
	LDY.b #$00
	LDA.w $1070
	SEC
	SBC.w #$FFBC
	CMP.w #$0008
	BCS.b CODE_02F19D
	DEC.b $00
	LDA.w #$FFC0
	BRA.b CODE_02F1A8

CODE_02F19D:
	BPL.b CODE_02F1A1
	INY
	INY
CODE_02F1A1:
	LDA.w $1070
	CLC
	ADC.w DATA_naval_pir_pos_delta_4,y
CODE_02F1A8:
	STA.w $1070
	LDY.b $00
	BNE.b CODE_02F1DE
	LDX.b #$00
	LDY.w $1076
CODE_02F1B4:
	LDA.w $107C,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	INX
	INX
	CPY.w $1076
	BNE.b CODE_02F1C6
	LDY.w $1078
	BRA.b CODE_02F1B4

CODE_02F1C6:
	LDX.b $12
	LDY.w $7400,x
	LDA.w DATA_naval_pir_xspeed_facing,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0006
	STA.b $78,x
	LDA.w #$0040
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
CODE_02F1DE:
	RTS

;-------------------------------------------------------------------------
; CODE_naval_pir_state_defeat_explode ($76,x = $22): single-frame defeat trigger.
; Calls CODE_02E1A6 with X/Y derived from body offset + parent pos, sound
; ID $0340 (BossDefeated cinematic).  Arms $7A96 = $80 cool-down.
; INC $76,x -> state $23 defeat_pulse.
;-------------------------------------------------------------------------
CODE_02F1DF:
CODE_naval_pir_state_defeat_explode:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_02F204                           ; cooldown active: skip
	LDA.b $0C                                   ; body offset X
	CLC
	ADC.w $70E2,x
	STA.b $00
	LDA.b $0E                                   ; body offset Y
	CLC
	ADC.w $7182,x
	STA.b $02
	LDA.w #$0340                                ; BossDefeated cinematic ID
	JSL.l CODE_02E1A6
	LDA.w #$0080
	STA.w $7A96,x
	INC.b $76,x                                 ; -> state $23 defeat_pulse
CODE_02F204:
	RTS

;-------------------------------------------------------------------------
; CODE_naval_pir_state_defeat_pulse ($76,x = $23): pulsing scale + palette swap
; during defeat cinematic.  Each frame:
;   - Force $7AF8 to 1 if it was set (egg-hits become defeat-pulse markers).
;   - Override sprite priority $7042 low-nibble to $C (above-everything).
;   - When $1070 > 0 and not flashing, INC $1070, arm $7AF6 = 4.
;   - Decrement balloon $7A36 by 8.  When < $00C0, arm $7A96 = $30 and
;     INC $76,x -> state $24 defeat_debris.
;   - Compute palette-row swap index from ($0180 - $7A36) >> 5 (then ASL/ASL/ASL),
;     storing the upper byte into $1080.  If different from last frame ($16),
;     update $16 and call CODE_naval_pir_commit_defeat_palette (the palette-swap helper that writes a
;     DATA_5FE48A..532 entry into CGRAM mirror $7021C4).
;-------------------------------------------------------------------------
CODE_02F205:
CODE_naval_pir_state_defeat_pulse:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_02F26D
	LDA.w $7AF8,x
	BEQ.b CODE_naval_pir_pulse_force_priority
	LDA.w #$0001                                ; downgrade $7AF8 to "defeat-flicker"
	STA.w $7AF8,x
CODE_02F216:
CODE_naval_pir_pulse_force_priority:
	LDA.w $7042,x
	AND.w #$FFF0
	ORA.w #$000C                                ; priority above-everything
	STA.w $7042,x
	LDA.w $1070
	BEQ.b CODE_02F235
	LDA.w $7AF6,x
	BNE.b CODE_02F235
	INC.w $1070                                 ; spin body angle
	LDA.w #$0004
	STA.w $7AF6,x                               ; rearm 4-frame cool
CODE_02F235:
	LDA.w $7A36,x
	SEC
	SBC.w #$0008                                ; shrink balloon -8/frame
	STA.w $7A36,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w #$00C0
	BPL.b CODE_naval_pir_pulse_palette_swap                           ; still big: no advance
	LDA.w #$0030
	STA.w $7A96,x
	INC.b $76,x                                 ; -> state $24 defeat_debris
CODE_02F24F:
CODE_naval_pir_pulse_palette_swap:
	LDA.w #$0180
	SEC
	SBC.w $7A36,x
	BMI.b CODE_02F26D
	AND.w #$01E0
	ASL
	ASL
	ASL
	XBA
	STA.w $1080                                 ; palette-swap index
	CMP.b $16,x
	BEQ.b CODE_02F26D                           ; same as last frame: skip
	STA.b $16,x
	JSR.w CODE_naval_pir_commit_defeat_palette                           ; commit new palette row
	LDX.b $12
CODE_02F26D:
	RTS

; Debris-spawn radius table for CODE_naval_pir_state_defeat_debris.
DATA_02F26E:
DATA_naval_pir_debris_radii:
                           db $10,$18,$00,$08,$20

;-------------------------------------------------------------------------
; CODE_naval_pir_state_defeat_debris ($76,x = $24): spawn debris explosions
; around the boss body during defeat.  Iterates $1084 from 0 to $0015,
; each tick spawning either:
;   - First entry (CODE_02F2C1 path): AmbSpr $1E6 (the "boss-defeat
;     splash flash" -- a coloured ring sprite at boss head + offset).
;   - Per-iteration debris: AmbSpr $222 (small debris chunks at the
;     radius from DATA_naval_pir_debris_radii) via CODE_naval_pir_spawn_debris_chunk.  Plays BreakDirt sfx.
; When $1084 reaches $15, arm $7A96 = $40, INC $76,x to state $25.
;-------------------------------------------------------------------------
CODE_02F273:
CODE_naval_pir_state_defeat_debris:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_02F2CD
	LDY.w $1084
	BNE.b CODE_02F2C1
	LDA.w $70E2,x
	CLC
	ADC.b $0C
	CLC
	ADC.w #$0008
	STA.b $00
	LDA.w $7182,x
	CLC
	ADC.b $0E
	CLC
	ADC.w #$0008
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1E6
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	STA.w $70A2,y
	LDA.b $02
	STA.w $7142,y
	LDA.w #$0004
	STA.w $7782,y
	ASL
	DEC
	STA.w $73C2,y
	STA.w $7E4C,y
	LDY.b #$10
	STY.w $1084
	LDA.w #$0020
	STA.w $7A96,x
	RTS

CODE_02F2C1:
	CPY.b #$15
	BMI.b CODE_02F2CE
	LDA.w #$0040
	STA.w $7A96,x
	INC.b $76,x
CODE_02F2CD:
	RTS

CODE_02F2CE:
	INC.w $1084
	LDA.w $1084
	SEC
	SBC.w #$0010
	TAY
	REP.b #$10
	LDA.w DATA_naval_pir_debris_radii-$01,y
	AND.w #$00FF
	CLC
	ADC.w $7362,x
	CLC
	ADC.w #$0080
	TAY
	LDA.w $6000,y
	CLC
	ADC.w $6094
	CLC
	ADC.w #$0008
	STA.b $00
	LDA.w $6002,y
	CLC
	ADC.w $609C
	CLC
	ADC.w #$0008
	STA.b $02
	SEP.b #$10
	JSR.w CODE_naval_pir_spawn_debris_chunk
	LDA.w #$0008
	STA.w $7A96,x
CODE_02F30F:
	RTS

;-------------------------------------------------------------------------
; CODE_naval_pir_state_defeat_finish ($76,x = $25): wait for debris cooldown
; ($7A96) to drain, then pop the boss Main's return address and JML to
; CODE_despawn_sprite_free_slot (the universal boss closer cinematic).  This is the only
; state that exits via JML (rather than RTS); it terminates the slot.
;-------------------------------------------------------------------------
CODE_02F310:
CODE_naval_pir_state_defeat_finish:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_02F30F                           ; still cooling: RTS via fall-through
	STZ.w $7ECC                                 ; clear pause flag (post-defeat)
	PLA                                         ; pop Main's return -> RTL out of frame
	JML.l CODE_despawn_sprite_free_slot                           ; boss closer

;-------------------------------------------------------------------------
; CODE_naval_pir_spawn_debris_chunk: spawn one AmbSpr $222 (small
; debris chunk) at ($00, $02) and play the BreakDirt sound.
;-------------------------------------------------------------------------
CODE_02F31E:
CODE_naval_pir_spawn_debris_chunk:
	LDA.w #!Define_YI_AmbSpr222
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	AND.w #$FFF0
	STA.w $70A2,y
	LDA.b $02
	AND.w #$FFF0
	STA.w $7142,y
	LDA.w #$000F
	STA.w $73C2,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w #!Define_YI_SoundID0A_BreakDirt
	JSL.l CODE_push_sound_queue
	RTS

;---------------------------------------------------------------------------

; Palette-swap row pointers (7 rows of 14 CGRAM bytes each).  Indexed by
; $1080 (defeat-cinematic phase 0..6).  Each row is written into CGRAM
; mirror $7021C4 by CODE_naval_pir_commit_defeat_palette.
DATA_02F349:
DATA_naval_pir_defeat_palette_rows:
	dw DATA_5FE48A,DATA_5FE4A6,DATA_5FE4C2,DATA_5FE4DE,DATA_5FE4FA,DATA_5FE516,DATA_5FE532

;-------------------------------------------------------------------------
; CODE_naval_pir_commit_defeat_palette: blit a 14-byte palette row
; from DATA_5FE48A..DATA_5FE532 (selected by $1080) into CGRAM mirror at
; $7021C4.  Used during state $23 defeat_pulse to ramp the palette through
; the "boss-defeat colour wash" phases.
;-------------------------------------------------------------------------
CODE_02F357:
CODE_naval_pir_commit_defeat_palette:
	PHD
	LDA.w #$0000
	TCD
	LDA.w $1080
	ASL
	TAX
	LDA.w DATA_naval_pir_defeat_palette_rows,x
	STA.b $00
	PHB
	LDX.b #$7021C4>>16
	PHX
	PLB
	LDX.b #DATA_5FE48A>>16
	STX.b $02
	LDY.b #$00
CODE_02F371:
	LDA.b [$00],y
	STA.w $7021C4,y
	INY
	INY
	CPY.b #$1C
	BCC.b CODE_02F371
	PLB
	PLD
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Naval Piranha Buds (sprite $172) -- the smaller piranhas that snake out
; of the floor during the boss fight.  Init is a no-op: each bud is spawned
; with all state baked into its slot by the parent boss's spawn handler
; (see DATA_naval_piranha_state_ptr's spawn-bud routine inside the Naval Piranha state
; machine above).  Buds inherit position + animation byte from the parent.
; see also: ys_boss2.asm. See docs/bossengine.md.
;-------------------------------------------------------------------------
YI_NorSpr172_NavalPiranhaBuds_Init:
init_naval_bud:                                 ; Raidenthequick: init_naval_bud
;$02F37F
	RTL

;---------------------------------------------------------------------------

; Naval Piranha bud main-dispatch.  Indexed by bud $76,x doubled.  18 entries.
; Many states reuse the same handlers (e.g. CODE_naval_pir_state_noop is the universal
; "TYX/RTS no-op" used as a terminator).
;
;   $00 CODE_bud_state_clamp_perch     CODE_bud_state_clamp_perch  rise + clamp Y to perch Y ($1074)
;   $01 CODE_bud_state_emerge          CODE_bud_state_emerge  emerge animation + check $0CE8 trigger
;   $02 bud_state_seek_to_boss    CODE_02F56B  steer toward boss X (left or right bud)
;   $03 bud_state_settle          CODE_02F633  small Y/anim settle
;   $04 CODE_bud_state_idle_at_boss    CODE_bud_state_idle_at_boss  idle next to boss; advances to attack
;   $05 bud_state_seed_target     CODE_02F6D2  set X to player X
;   $06 bud_state_brake_to_zero   CODE_02F71A  brake X-vel to zero (lunge windup)
;   $07 bud_state_pre_dive_pause  CODE_02F78E  small wait + spawn splash
;   $08 bud_state_post_dive       CODE_02F7D0  ramp anim while diving
;   $09 CODE_bud_state_emerge          CODE_bud_state_emerge  (re-entry: second emergence)
;   $0A CODE_bud_state_idle_at_boss    CODE_bud_state_idle_at_boss  (re-entry)
;   $0B bud_state_arc_back        CODE_02F800  arc back up to boss height
;   $0C CODE_bud_state_clamp_perch     CODE_bud_state_clamp_perch  (re-entry)
;   $0D CODE_bud_state_idle_at_boss    CODE_bud_state_idle_at_boss  (re-entry -- bud_state_idle dispatches to $0E)
;   $0E bud_state_anchored        CODE_naval_pir_state_noop  no-op: bud snapshots its world position
;   $0F bud_state_swing_to_perch  CODE_02F848  swing/lerp Y to perch using DATA_02F844
;   $10 bud_state_post_swing      CODE_02F8AA  brief settle then advance
;   $11 bud_state_terminator      CODE_naval_pir_state_noop  no-op terminator (dispatched once retract done)
DATA_02F380:
DATA_naval_pir_bud_state_ptr:
	dw CODE_bud_state_clamp_perch,CODE_bud_state_emerge,CODE_02F56B,CODE_02F633,CODE_bud_state_idle_at_boss,CODE_02F6D2,CODE_02F71A,CODE_02F78E
	dw CODE_02F7D0,CODE_bud_state_emerge,CODE_bud_state_idle_at_boss,CODE_02F800,CODE_bud_state_clamp_perch,CODE_bud_state_idle_at_boss,CODE_naval_pir_state_noop,CODE_02F848
	dw CODE_02F8AA,CODE_naval_pir_state_noop

; Bud Main: copies its current animation/visible byte ($7042) from the parent
; (boss slot @ $1072) every frame so all buds animate in sync, then dispatches
; through DATA_naval_pir_bud_state_ptr keyed by $76,x (bud sub-state).
YI_NorSpr172_NavalPiranhaBuds_Main:
main_naval_bud:                                 ; Raidenthequick: main_naval_bud
;$02F3A4
	JSR.w CODE_02F3E1
	LDY.w $1072
	LDA.w $7042,y
	STA.w $7042,x
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_naval_pir_bud_state_ptr,x)
	JSR.w CODE_02F438
	LDY.b $76,x
	CPY.b #$0E
	BNE.b CODE_02F3DA
	LDA.w $70E2,x
	SEC
	SBC.w $72C0,x
	STA.w $70E2,x
	LDA.w $7182,x
	SEC
	SBC.w $72C2,x
	STA.w $7182,x
	RTL

CODE_02F3DA:
	JSR.w CODE_02F497
	JSR.w CODE_02F4C1
	RTL

CODE_02F3E1:
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #DATA_02FD7D>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_02FD7D
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDY.w $7041,x
	TYA
	LSR
	LSR
	LSR
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.b $78,x
	STA.w $601E
	LDA.w $7680,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7682,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7400,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_08A201>>16
	LDA.w #FXCODE_08A201
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	RTS

DATA_02F41E:
	db $00,$01,$03,$05,$07,$09,$0A,$0B,$0C,$0D,$0E,$0F,$11,$12,$14,$15
	db $17,$18,$19,$19,$1B,$1B,$1B,$1B,$1A,$19

CODE_02F438:
	LDY.b $76,x
	CPY.b #$0E
	BPL.b CODE_02F47C
	LDA.w $7362,x
	BMI.b CODE_02F47C
	LDA.w $6120
	CLC
	ADC.w #$0006
	ASL
	STA.b $00
	LSR
	CLC
	ADC.w $7C16,x
	CMP.b $00
	BCS.b CODE_02F47C
	LDY.w $7402,x
	LDA.w DATA_02F41E,y
	AND.w #$00FF
	STA.b $00
	CLC
	ADC.w #$0006
	CLC
	ADC.w $6122
	ASL
	STA.b $02
	LSR
	CLC
	ADC.w $7C18,x
	SEC
	SBC.b $00
	CMP.b $02
	BCS.b CODE_02F47C
	JSL.l CODE_03A858
CODE_02F47C:
	RTS

DATA_02F47D:
	db $18,$18,$10,$10,$20,$20,$18,$18,$20,$28,$28,$20,$20,$20,$28,$28
	db $28,$28,$28,$28,$28,$28,$28,$28,$28,$28

CODE_02F497:
	LDY.w $7402,x
	LDA.w DATA_02F47D,y
	TAY
	TYA
	STA.b $00
	LDA.w $7041,x
	AND.w #$FF07
	ORA.b $00
	STA.w $7041,x
	RTS

; CODE_bud_state_clamp_perch (states $00 / $0C): clamp bud Y to perch ($1074),
; zero Y-vel, and fall to anim tick (CODE_02F52F).
CODE_02F4AD:
CODE_bud_state_clamp_perch:
	TYX
	LDA.w $1074                                 ; perch Y target
	CMP.w $7182,x
	BMI.b CODE_02F4BE                           ; bud is above perch: tick anim
	STA.w $7182,x                               ; clamp Y
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.b $76,x                                 ; reset to state $00
CODE_02F4BE:
	JMP.w CODE_02F52F                           ; -> bud anim tick

CODE_02F4C1:
	LDA.w $70E2,x
	CMP.w #$03B0
	BMI.b CODE_02F4CE
	LDA.w #$03AF
	BRA.b CODE_02F4D6

CODE_02F4CE:
	CMP.w #$02D0
	BPL.b CODE_02F4E3
	LDA.w #$02D0
CODE_02F4D6:
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_02F4E3:
	RTS

; CODE_bud_state_emerge (states $01 / $09): tick emergence anim while clamping Y
; to perch.  When anim frame reaches $12 (full open mouth), advance:
;   - If $0CE8 (combat-loop timer) non-zero: state $0D (idle_at_boss re-entry)
;   - Else: INC $76,x to state $02 seek_to_boss
; While in state $01, also continuously check the boss's stalk-depth
; ($7019D6,$1072): when it becomes 0, reset bud state to $00 (retract done).
CODE_02F4E4:
CODE_bud_state_emerge:
	TYX
	LDA.w $1074
	CMP.w $7182,x
	BMI.b CODE_02F4F3
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_02F4F3:
	JSR.w CODE_02F52F                           ; tick anim frame
	LDY.b $76,x
	CPY.b #$01                                  ; specifically state $01?
	BNE.b CODE_bud_emerge_check_advance
	LDY.w $1072                                 ; boss slot
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y  ; boss stalk-depth
	BNE.b CODE_02F506
	STZ.b $76,x                                 ; boss retracted: bud retracts too
CODE_02F506:
	RTS

CODE_02F507:
CODE_bud_emerge_check_advance:
	LDY.w $7402,x
	CPY.b #$12                                  ; anim hit full-open?
	BNE.b CODE_02F51E
	LDA.w $7A98,x
	BNE.b CODE_02F51E
	INC.b $76,x                                 ; advance to next state
	LDA.w $0CE8                                 ; combat-loop timer
	BEQ.b CODE_02F51E
	LDY.b #$0D                                  ; bypass: state $0D idle
	STY.b $76,x
CODE_02F51E:
	RTS

DATA_02F51F:
	db $12,$13,$14,$15,$16,$17,$18,$19,$19,$18,$17,$16,$15,$14,$13,$12

CODE_02F52F:
	LDA.w $7AF6,x
	BNE.b CODE_02F55E
	LDA.b $16,x
	INC
	AND.w #$000F
	STA.b $16,x
	TAY
	LDA.w DATA_02F51F,y
	TAY
	TYA
	STA.w $7402,x
	LDY.b $76,x
	CPY.b #$09
	BEQ.b CODE_02F54F
	CPY.b #$0E
	BMI.b CODE_02F556
CODE_02F54F:
	LDA.w #$0002
	STA.w $7AF6,x
	RTS

CODE_02F556:
	LDA.b $10
	AND.w #$0005
	STA.w $7AF6,x
CODE_02F55E:
	RTS

DATA_02F55F:
	dw $0020,$FFE0

DATA_02F563:
	dw $0001,$FFFF

DATA_02F567:
	dw $03B0,$02D0

CODE_02F56B:
	TYX
	LDA.w $7AF6,x
	BNE.b CODE_02F59B
	LDY.b #$00
	LDA.w $7402,x
	CLC
	ADC.b $16,x
	CMP.w #$0001
	BMI.b CODE_02F585
	INY
	INY
	CMP.w #$0004
	BMI.b CODE_02F58C
CODE_02F585:
	PHA
	LDA.w DATA_02F563,y
	STA.b $16,x
	PLA
CODE_02F58C:
	STA.w $7402,x
	LDA.b $10
	AND.w #$0003
	CLC
	ADC.w #$0004
	STA.w $7AF6,x
CODE_02F59B:
	LDY.b #$00
	CPX.w $1076
	BNE.b CODE_02F5A4
	INY
	INY
CODE_02F5A4:
	TYA
	DEC
	STA.b $06
	LDA.w DATA_02F567,y
	STA.b $04
	LDA.w DATA_02F55F,y
	LDY.w $1072
	CLC
	ADC.w $70E2,y
	STA.b $02
	SEC
	SBC.w $70E2,x
	STA.b $00
	ASL
	ASL
	ASL
	ASL
	PHP
	CMP.w #$0300
	BMI.b CODE_02F5CC
	LDA.w #$0300
CODE_02F5CC:
	CMP.w #$FD00
	BPL.b CODE_02F5D4
	LDA.w #$FD00
CODE_02F5D4:
	STA.w $75E0,x
	PLP
	BPL.b CODE_02F5DE
	EOR.w #$FFFF
	INC
CODE_02F5DE:
	LSR
	LSR
	LSR
	LSR
	STA.w $7540,x
	LDY.w $1072
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CMP.w #$000D
	BMI.b CODE_02F5FF
	CMP.w #$0012
	BMI.b CODE_02F632
	CMP.w #$0015
	BMI.b CODE_02F5FF
	CMP.w #$001A
	BMI.b CODE_02F632
CODE_02F5FF:
	LDA.b $02
	SEC
	SBC.b $04
	EOR.b $06
	BPL.b CODE_02F60C
	LDA.b $04
	BRA.b CODE_02F627

CODE_02F60C:
	LDA.b $00
	CLC
	ADC.w #$0004
	CMP.w #$0008
	BCS.b CODE_02F632
	LDA.w $70E2,y
	LDY.b #$00
	CPX.w $1076
	BNE.b CODE_02F623
	INY
	INY
CODE_02F623:
	CLC
	ADC.w DATA_02F55F,y
CODE_02F627:
	STA.w $70E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	INC.b $76,x
CODE_02F632:
	RTS

CODE_02F633:
	TYX
	LDA.w $7AF6,x
	BNE.b CODE_02F654
	LDA.w $7402,x
	INC
	CMP.w #$0012
	BMI.b CODE_02F647
	STZ.b $76,x
	LDA.w #$0012
CODE_02F647:
	STA.w $7402,x
	LDA.b $10
	AND.w #$0001
	INC
	INC
	STA.w $7AF6,x
CODE_02F654:
	RTS

; CODE_bud_state_idle_at_boss (states $04 / $0A / $0D): bud rests next to boss
; head, waiting for attack trigger ($0CE8 == 0 -> retract to $0A).  Cycles
; mouth-anim (CODE_02F52F).  On every $03..$05 frame, blast Y-velocity to
; lunge upward, ramp $76,x to $06 (brake_to_zero) or $05 (seed_target).
CODE_02F655:
CODE_bud_state_idle_at_boss:
	TYX
	LDA.w $0CE8                                 ; combat-loop timer
	BNE.b CODE_02F661
	LDY.b #$0A                                  ; timer expired: retract to $0A
	STY.b $76,x
	BRA.b CODE_02F666

CODE_02F661:
	LDA.w $7A96,x
	BNE.b CODE_02F6CF
CODE_02F666:
	LDY.w $7402,x
	CPY.b #$13
	BPL.b CODE_02F6CF
	LDA.w $7AF6,x
	BNE.b CODE_02F6CF
	LDA.w $7402,x
	DEC
	BPL.b CODE_02F694
	LDA.w $1074
	CLC
	ADC.w #$0010
	STA.w $7182,x
	LDA.w #$0040
	STA.w $7A96,x
	INC.b $76,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.b $16,x
	LDA.w #$0000
	BRA.b CODE_02F6C5

CODE_02F694:
	LDY.b $76,x
	CPY.b #$0D
	BNE.b CODE_02F6B8
	CMP.w #$0005
	BPL.b CODE_02F6C5
	STA.w $7402,x
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0080
	STA.w $7A96,x
	LDA.w #$0001
	STA.b $16,x
	LDY.b #$06
	STY.b $76,x
	RTS

CODE_02F6B8:
	CMP.w #$0006
	BPL.b CODE_02F6C5
	PHA
	LDA.w #$0040
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	PLA
CODE_02F6C5:
	STA.w $7402,x
	LDA.w #$0002
	STA.w $7AF6,x
	RTS

CODE_02F6CF:
	JMP.w CODE_02F52F

CODE_02F6D2:
	TYX
	LDA.w $0CE8
	BNE.b CODE_02F6DD
	LDY.b #$0A
	STY.b $76,x
	RTS

CODE_02F6DD:
	LDA.w $7A96,x
	BNE.b CODE_02F711
	LDY.b $16,x
	BNE.b CODE_02F6EE
	INC.b $16,x
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $70E2,x
CODE_02F6EE:
	LDA.w $7AF6,x
	BNE.b CODE_02F711
	INC.w $7402,x
	LDY.w $7402,x
	CPY.b #$03
	BMI.b CODE_02F70B
	LDA.b $10
	AND.w #$001F
	CLC
	ADC.w #$0040
	STA.w $7A96,x
	INC.b $76,x
CODE_02F70B:
	LDA.w #$0003
	STA.w $7AF6,x
CODE_02F711:
	RTS

DATA_02F712:
	dw $0004,$FFFC

DATA_02F716:
	dw $FFC0,$0040

CODE_02F71A:
	TYX
	LDA.w $0CE8
	BNE.b CODE_02F72B
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b #$0A
	STY.b $76,x
	RTS

CODE_02F72B:
	LDA.w $7A96,x
	BNE.b CODE_02F745
	LDA.w $7C16,x
	CLC
	ADC.w #$0008
	CMP.w #$0010
	BCS.b CODE_02F745
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	INC.b $76,x
	RTS

CODE_02F745:
	LDY.b #$00
	CPX.w $1076
	BEQ.b CODE_02F74E
	INY
	INY
CODE_02F74E:
	LDA.w DATA_02F712,y
	LDY.b #$00
	CLC
	ADC.w $7C16,x
	BPL.b CODE_02F75B
	INY
	INY
CODE_02F75B:
	LDA.w DATA_02F716,y
	STA.w $75E0,x
	LDA.w #$0010
	STA.w $7540,x
	LDA.w $7AF6,x
	BNE.b CODE_02F78D
	LDA.w $7402,x
	CLC
	ADC.b $16,x
	STA.w $7402,x
	CMP.w #$0003
	BEQ.b CODE_02F77F
	CMP.w #$0005
	BMI.b CODE_02F787
CODE_02F77F:
	LDA.b $16,x
	EOR.w #$FFFF
	INC
	STA.b $16,x
CODE_02F787:
	LDA.w #$0008
	STA.w $7AF6,x
CODE_02F78D:
	RTS

CODE_02F78E:
	TYX
	LDA.w $0CE8
	BNE.b CODE_02F799
	LDY.b #$0A
	STY.b $76,x
	RTS

CODE_02F799:
	LDY.w $7402,x
	BNE.b CODE_02F7CC
	LDA.w #$0020
	STA.w $7A96,x
	STZ.b $16,x
	INC.b $76,x
CODE_02F7A8:
	LDA.w #!Define_YI_AmbSpr1BA
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $1074
	STA.w $7142,y
	LDA.w #$001A
	STA.w $7E4C,y
	LDA.w #!Define_YI_SoundID03_Swim
	STA.w $7782,y
	JSL.l CODE_push_sound_queue
	RTS

CODE_02F7CC:
	DEC.w $7402,x
	RTS

CODE_02F7D0:
	TYX
	LDA.w $0CE8
	BNE.b CODE_02F7DB
	LDY.b #$0A
	STY.b $76,x
	RTS

CODE_02F7DB:
	LDA.w $7A96,x
	BNE.b CODE_02F7FB
	LDY.b $16,x
	BNE.b CODE_02F7E9
	INC.b $16,x
	JSR.w CODE_02F7A8
CODE_02F7E9:
	INC.w $7402,x
	LDY.w $7402,x
	CPY.b #$12
	BMI.b CODE_02F7FB
	LDA.w #$0040
	STA.w $7A98,x
	INC.b $76,x
CODE_02F7FB:
	RTS

DATA_02F7FC:
	dw $0020,$FFE0

CODE_02F800:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_02F843
	LDY.b $16,x
	BNE.b CODE_02F826
	LDA.w #$FFC0
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $16,x
	CPX.w $1076
	BNE.b CODE_02F819
	INY
	INY
CODE_02F819:
	LDA.w DATA_02F7FC,y
	LDY.w $1072
	CLC
	ADC.w $70E2,y
	STA.w $70E2,x
CODE_02F826:
	LDA.w $7AF6,x
	BNE.b CODE_02F843
	INC.w $7402,x
	LDY.w $7402,x
	CPY.b #$12
	BMI.b CODE_02F83D
	LDA.w #$FF80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
CODE_02F83D:
	LDA.w #$0004
	STA.w $7AF6,x
CODE_02F843:
	RTS

DATA_02F844:
	dw $0040,$FFC0

CODE_02F848:
	TYX
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w $7AF6,x
	BNE.b CODE_02F8A4
	LDY.w $7402,x
	CPY.b #$12
	BEQ.b CODE_02F872
	BPL.b CODE_02F868
	INC.w $7402,x
	BRA.b CODE_02F86B

CODE_02F868:
	DEC.w $7402,x
CODE_02F86B:
	LDA.w #$0004
	STA.w $7AF6,x
	RTS

CODE_02F872:
	LDY.b #$00
	LDA.w $1074
	CMP.w $7182,x
	BEQ.b CODE_02F887
	BPL.b CODE_02F880
	INY
	INY
CODE_02F880:
	LDA.w DATA_02F844,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_02F887:
	LDY.w $1072
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CMP.w #$0025
	BNE.b CODE_02F8A4
	LDA.w #$0010
	STA.w $7A38,x
CODE_02F898:
	DEC
	AND.b $10
	CLC
	ADC.w #$0018
	STA.w $7A96,x
	INC.b $76,x
CODE_02F8A4:
	RTS

DATA_02F8A5:
	db $20,$00,$18,$10,$08

CODE_02F8AA:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_02F8FC
	LDY.b $78,x
	CPY.b #$05
	BNE.b CODE_02F8B9
	INC.b $76,x
	RTS

CODE_02F8B9:
	INC.b $78,x
	LDY.b $78,x
	REP.b #$10
	LDA.w DATA_02F8A5-$01,y
	AND.w #$00FF
	CLC
	ADC.w $7362,x
	TAY
	LDA.w $6000,y
	CLC
	ADC.w $6094
	CLC
	ADC.w #$0008
	STA.b $00
	LDA.w $6002,y
	CLC
	ADC.w $609C
	CLC
	ADC.w #$0008
	STA.b $02
	SEP.b #$10
	JSR.w CODE_naval_pir_spawn_debris_chunk
	LDA.b $10
	AND.w #$0007
	CLC
	ADC.w $7A38,x
	STA.w $7A96,x
	LDA.w $7A38,x
	LSR
	STA.w $7A38,x
CODE_02F8FC:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Naval Piranha Vines (sprite $002): the snaking vines/stalks that wrap
; the boss arena.  Init is a no-op (no per-vine setup needed; all
; positioning is driven by the parent boss state).  Main mirrors the
; boss's animation byte each frame and uses the boss's "stalk depth"
; counter ($7019D6) to choose between extend (depth >= $1C) and retract
; (depth < $1C) sub-states from DATA_naval_pir_vine_state_ptr.
; see also: ys_boss2.asm. See docs/bossengine.md.
;-------------------------------------------------------------------------
YI_NorSpr002_NavalPiranhaVines_Init:
init_naval_piranha_stalk:                       ; Raidenthequick: init_naval_piranha_stalk
;$02F8FD
	RTL

;---------------------------------------------------------------------------

; Naval Piranha vine main-dispatch.  Indexed by vine $76,x doubled.
; 7 entries.  Vine "stalk depth" lives at $7019D6,$1072 (the boss's slot)
; and is the single global synchronising all vines:
;
;   depth $00..$1B  -> retract phase (vine sucks back into floor)
;   depth $1F + both buds idle -> "extend trigger" (vine pops out)
;   depth $20..    -> extend phase (vine fully exposed, attacks bud)
;
; Within each phase, the vine's own $76,x walks 0,1,2,3 to step through
; emerge/sweep/return.  Most entries reuse retracted-state handlers.
;
;   $00 CODE_vine_state_emerge        CODE_vine_state_emerge  initial emergence pose
;   $01 vine_state_sweep_check   CODE_02FB78  watch player; if hit, sweep
;   $02 vine_state_settle        CODE_02FBB8  settle to perch Y
;   $03 vine_state_pre_extend    CODE_02FBE3  pre-extension wind-up
;   $04 vine_state_terminator    CODE_naval_pir_state_noop  no-op terminator
;   $05 CODE_vine_state_emerge        CODE_vine_state_emerge  (re-entry)
;   $06 vine_state_sweep_check   CODE_02FB78  (re-entry)
DATA_02F8FE:
DATA_naval_pir_vine_state_ptr:
	dw CODE_vine_state_emerge,CODE_02FB78,CODE_02FBB8,CODE_02FBE3,CODE_naval_pir_state_noop,CODE_vine_state_emerge,CODE_02FB78

; Vine Y-velocity selector: indexed by Y (0/2/4) for (perch / down / up).
DATA_02F90C:
DATA_naval_pir_vine_yvel_selector:
                                 dw $0000,$0040,$FFC0

; Vine Main: mirrors animation byte from boss (slot @ $1072 in $7042) and
; uses the boss's "stalk depth" word ($7019D6,y) to choose between extend
; states (>= 28) and retract states (< 28).
;
; Full per-frame flow:
;   1. Copy boss's $7042 -> vine's $7042 (sync animation visibility).
;   2. JSR CODE_02F9CC (push 8000h marker bytes into SuperFX scratch
;      buffer based on $7A38 count).
;   3. JSL CODE_03AF23 (shared sprite housekeeping).
;   4. Branch on boss stalk-depth ($7019D6,$1072):
;        < $1C       -> retract: reload $7542 from $78,x and zero velocities
;        = $1F + buds idle -> wait at perch with $0000 Y-vel
;        $20..       -> extend: pick Y-vel from DATA_naval_pir_vine_yvel_selector, arm timer 4
;   5. Dispatch via DATA_naval_pir_vine_state_ptr[$76,x doubled].
;   6. Tick anim (CODE_02F9F3), check hit (CODE_02FA09), clamp X to arena
;      bounds (CODE_02FA19).
;   7. If boss in defeat-pulse range ($000E or $0016..$0018), enable
;      flash via $75E2 = $0100 and $7542 = $10..$1F.
YI_NorSpr002_NavalPiranhaVines_Main:
main_naval_piranha_stalk:                       ; Raidenthequick: main_naval_piranha_stalk
;$02F912
	LDY.w $1072
	LDA.w $7042,y
	STA.w $7042,x
	JSR.w CODE_02F9CC
	JSL.l CODE_03AF23
	LDY.w $1072
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CMP.w #$001C
	BMI.b CODE_02F986
	CMP.w #$001F
	BNE.b CODE_02F942
	LDY.w $1076
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDY.w $1078
	ORA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	BEQ.b CODE_02F974
	BRA.b CODE_02F986

CODE_02F942:
	CMP.w #$0020
	BMI.b CODE_02F974
	LDY.b $76,x
	CPY.b #$02
	BPL.b CODE_02F98F
	LDY.b #$02
	STY.b $76,x
	LDY.b #$00
	LDA.w $1074
	CMP.w $7182,x
	BEQ.b CODE_02F963
	PHP
	INY
	INY
	PLP
	BPL.b CODE_02F963
	INY
	INY
CODE_02F963:
	LDA.w DATA_naval_pir_vine_yvel_selector,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w #$0004
	STA.w $7A36,x
	BRA.b CODE_02F98F

CODE_02F974:
	LDA.w $7542,x
	BEQ.b CODE_02F97B
	STA.b $78,x
CODE_02F97B:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	BRA.b CODE_02F9C7

CODE_02F986:
	LDA.b $78,x
	BEQ.b CODE_02F98F
	STA.w $7542,x
	STZ.b $78,x
CODE_02F98F:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_naval_pir_vine_state_ptr,x)
	JSR.w CODE_02F9F3
	JSR.w CODE_02FA09
	JSR.w CODE_02FA19
	LDY.w $1072
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CMP.w #$000E
	BEQ.b CODE_02F9B5
	CMP.w #$0016
	BMI.b CODE_02F9C7
	CMP.w #$0019
	BPL.b CODE_02F9C7
CODE_02F9B5:
	LDA.w #$0100
	STA.w $75E2,x
	LDA.b $10
	AND.w #$000F
	CLC
	ADC.w #$0010
	STA.w $7542,x
CODE_02F9C7:
	RTL

DATA_02F9C8:
	dw $0818,$1000

CODE_02F9CC:
	LDA.w $7A38,x
	BEQ.b CODE_02F9F2
	STA.b $02
	REP.b #$10
	LDA.w $7362,x
	STA.b $00
CODE_02F9DA:
	LDY.b $02
	LDA.w DATA_02F9C8-$01,y
	AND.w #$00FF
	CLC
	ADC.b $00
	TAY
	LDA.w #$8000
	STA.w $6000,y
	DEC.b $02
	BNE.b CODE_02F9DA
	SEP.b #$10
CODE_02F9F2:
	RTS

CODE_02F9F3:
	LDA.w $7A98,x
	BNE.b CODE_02FA08
	LDA.w $7402,x
	INC
	AND.w #$0003
	STA.w $7402,x
	LDA.w $7A36,x
	STA.w $7A98,x
CODE_02FA08:
	RTS

CODE_02FA09:
	LDY.b $76,x
	CPY.b #$02
	BPL.b CODE_02FA18
	LDY.w $7D36,x
	BPL.b CODE_02FA18
	JSL.l CODE_03A858
CODE_02FA18:
	RTS

CODE_02FA19:
	LDY.b $76,x
	CPY.b #$05
	BPL.b CODE_02FA41
	LDA.w $70E2,x
	CMP.w #$03A0
	BMI.b CODE_02FA2C
	LDA.w #$039F
	BRA.b CODE_02FA34

CODE_02FA2C:
	CMP.w #$02F0
	BPL.b CODE_02FA41
	LDA.w #$02F0
CODE_02FA34:
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
CODE_02FA3E:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_02FA41:
	RTS

; Vine sub-dispatch (indexed by paired bud's $7019D6, 0..13).  Inside vine
; state $00 emerge, vines lookup their paired bud's state and pick one of
; two builders:
;   bud state 0,1 -> CODE_02FA70 (vine_build_initial: pick random X offset
;                    around boss, slide bud-side, launch upward)
;   bud state 2+  -> CODE_02FAC7 (vine_build_attack: lerp X via boss
;                    position-from-X-difference, GSU FXCODE_0B86B6 to
;                    interpolate Y, advance bud's $76,x to next state)
DATA_02FA42:
DATA_naval_pir_vine_emerge_dispatch:
	dw CODE_02FA70,CODE_02FA70,CODE_02FAC7,CODE_02FAC7,CODE_02FAC7,CODE_02FAC7,CODE_02FAC7,CODE_02FAC7
	dw CODE_02FAC7,CODE_02FAC7,CODE_02FAC7,CODE_02FAC7,CODE_02FAC7,CODE_02FAC7

; CODE_vine_state_emerge (states $00 / $05): main vine emergence driver.
; Loads paired bud's sub-state via $18,x (= bud slot index) and dispatches
; via DATA_naval_pir_vine_emerge_dispatch to pick the right vine-build routine.
CODE_02FA5E:
CODE_vine_state_emerge:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_02FA6F                           ; cooling: skip
	LDY.b $18,x                                 ; paired bud slot
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y  ; bud sub-state
	ASL
	TXY
	TAX
	JSR.w (DATA_naval_pir_vine_emerge_dispatch,x)                       ; dispatch by bud state
CODE_02FA6F:
	RTS

CODE_02FA70:
	CPX.b #$02
	BMI.b CODE_02FA78
	CPX.b #$0A
	BMI.b CODE_02FA7B
CODE_02FA78:
	TYX
	STZ.b $76,x
CODE_02FA7B:
	TYX
	STZ.w $7400,x
	LDY.w $1072
	LDA.b $10
	PHA
	AND.w #$007F
	SEC
	SBC.w #$0040
	BPL.b CODE_02FA94
	INC.w $7400,x
	INC.w $7400,x
CODE_02FA94:
	CLC
	ADC.w $70E2,y
	STA.w $70E2,x
	PLA
	PHA
	XBA
	AND.w #$001F
	CLC
	ADC.w #$FF70
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0080
	STA.w $75E2,x
	LDA.w #$0002
	STA.w $7542,x
	PLA
	XBA
	AND.w #$0003
	CLC
	ADC.w #$0004
	STA.w $7A36,x
	INC.b $76,x
	RTS

DATA_02FAC3:
	dw $0010,$0030

CODE_02FAC7:
	TYX
	STZ.w $7400,x
	LDA.b $10
	AND.w #$003F
	CLC
	ADC.w #$0040
	LDY.b $18,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	CMP.w #$0400
	BMI.b CODE_02FAF2
	LDA.w #$0400
CODE_02FAF2:
	CMP.w #$FC00
	BPL.b CODE_02FAFA
	LDA.w #$FC00
CODE_02FAFA:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_02FB05
	LDA.w #$0002
	STA.w $7400,x
CODE_02FB05:
	LDX.b #$00
	LDA.w $70E2,y
	LDY.w $1072
	SEC
	SBC.w $70E2,y
	BPL.b CODE_02FB15
	INX
	INX
CODE_02FB15:
	LDA.b $10
	PHA
	AND.w #$003F
	SEC
	SBC.w DATA_02FAC3,x
	LDX.b $12
	LDY.b $18,x
	CLC
	ADC.w $70E2,y
	STA.w $70E2,x
	LDY.w $1072
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CMP.w #$000E
	BEQ.b CODE_02FB3F
	CMP.w #$0016
	BMI.b CODE_02FB53
	CMP.w #$0019
	BPL.b CODE_02FB53
CODE_02FB3F:
	PLA
	LDA.w #$FE80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0003
	STA.w $7A36,x
	LSR
	STA.w $7540,x
	INC.b $76,x
	RTS

CODE_02FB53:
	PLA
	PHA
	XBA
	AND.w #$003F
	CLC
	ADC.w #$FF20
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0100
	STA.w $75E2,x
	LDA.w #$0004
	STA.w $7542,x
	PLA
	AND.w #$0003
	INC
	INC
	STA.w $7A36,x
	INC.b $76,x
	RTS

CODE_02FB78:
	TYX
	LDY.w $7223,x
	BMI.b CODE_02FBB7
	LDA.w $1074
	CLC
	ADC.w #$0018
	CMP.w $7182,x
	BPL.b CODE_02FBB7
	STA.w $7182,x
	LDA.w $7542,x
	CMP.w #$0010
	BPL.b CODE_02FBA9
	LDA.b $10
	AND.w #$007F
	CLC
	ADC.w #$0020
	CMP.w #$0060
	BMI.b CODE_02FBA6
	LDA.w #$0060
CODE_02FBA6:
	STA.w $7A96,x
CODE_02FBA9:
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.b $76,x
CODE_02FBB7:
	RTS

CODE_02FBB8:
	TYX
	LDA.w $1074
	CMP.w $7182,x
	BNE.b CODE_02FBB7
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.w $7402,x
	BNE.b CODE_02FBB7
	LDA.w #$FFFF
	STA.w $7A98,x
	LDY.w $1072
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CMP.w #$0025
	BMI.b CODE_02FBB7
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	JMP.w CODE_02F898

CODE_02FBE3:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_02FC38
	LDY.w $7A38,x
	CPY.b #$04
	BNE.b CODE_02FBF3
	INC.b $76,x
	RTS

CODE_02FBF3:
	INC.w $7A38,x
	LDY.w $7A38,x
	REP.b #$10
	LDA.w DATA_02F9C8-$01,y
	AND.w #$00FF
	CLC
	ADC.w $7362,x
	TAY
	LDA.w $6000,y
	CLC
	ADC.w $6094
	CLC
	ADC.w #$0008
	STA.b $00
	LDA.w $6002,y
	CLC
	ADC.w $609C
	CLC
	ADC.w #$0008
	STA.b $02
	SEP.b #$10
	JSR.w CODE_naval_pir_spawn_debris_chunk
	LDA.b $10
	AND.w #$0007
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $7A96,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LSR
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
CODE_02FC38:
	RTS

DATA_02FC39:
	dw DATA_02FC51,DATA_02FC6A,DATA_02FC83,DATA_02FC9C,DATA_02FCB5,DATA_02FCCE,DATA_02FCE7,DATA_02FD00
	dw DATA_02FD19,DATA_02FD32,DATA_02FD4B,DATA_02FD64

DATA_02FC51:
	db $F6,$FC,$20,$00,$02,$00,$04,$08,$C0,$02,$00,$F4,$08,$40,$02,$09
	db $EA,$08,$80,$02,$09,$DA,$08,$00,$02

DATA_02FC6A:
	db $F7,$FB,$0E,$00,$02,$01,$F4,$28,$C0,$02,$08,$D9,$28,$80,$02,$08
	db $E9,$28,$00,$02,$01,$04,$28,$40,$02

DATA_02FC83:
	db $F8,$FA,$2C,$00,$02,$02,$F4,$22,$40,$02,$07,$D7,$22,$00,$02,$07
	db $E7,$22,$80,$02,$02,$04,$22,$C0,$02

DATA_02FC9C:
	db $F8,$FB,$20,$00,$02,$01,$F4,$28,$C0,$02,$08,$D9,$28,$80,$02,$08
	db $E9,$28,$00,$02,$01,$04,$28,$40,$02

DATA_02FCB5:
	db $FC,$FA,$2E,$00,$02,$02,$F4,$22,$40,$02,$07,$D7,$22,$00,$02,$07
	db $E7,$22,$80,$02,$02,$04,$22,$C0,$02

DATA_02FCCE:
	db $01,$FA,$2E,$00,$02,$04,$F4,$24,$40,$02,$05,$D6,$24,$00,$02,$05
	db $E6,$24,$80,$02,$04,$04,$24,$C0,$02

DATA_02FCE7:
	db $F5,$FC,$20,$00,$02,$FF,$04,$08,$C0,$02,$FF,$F4,$08,$40,$02,$08
	db $EA,$08,$80,$02,$08,$DA,$08,$00,$02

DATA_02FD00:
	db $F6,$FB,$0E,$00,$02,$00,$F4,$28,$C0,$02,$07,$D9,$28,$80,$02,$07
	db $E9,$28,$00,$02,$00,$04,$28,$40,$02

DATA_02FD19:
	db $F7,$FA,$2C,$00,$02,$01,$F4,$22,$40,$02,$06,$D7,$22,$00,$02,$06
	db $E7,$22,$80,$02,$01,$04,$22,$C0,$02

DATA_02FD32:
	db $F5,$FC,$20,$00,$02,$FF,$04,$08,$C0,$02,$FF,$F4,$08,$40,$02,$08
	db $EA,$08,$80,$02,$08,$DA,$08,$00,$02

DATA_02FD4B:
	db $F6,$FB,$0E,$00,$02,$00,$F4,$28,$C0,$02,$07,$D9,$28,$80,$02,$07
	db $E9,$28,$00,$02,$00,$04,$28,$40,$02

DATA_02FD64:
	db $F7,$FA,$2C,$00,$02,$01,$F4,$22,$40,$02,$06,$D7,$22,$00,$02,$06
	db $E7,$22,$80,$02,$01,$04,$22,$C0,$02

DATA_02FD7D:
	dw DATA_02FDB1,DATA_02FDC0,DATA_02FDCF,DATA_02FDD9,DATA_02FDE3,DATA_02FDF7,DATA_02FE0B,DATA_02FE1A
	dw DATA_02FE29,DATA_02FE3D,DATA_02FE56,DATA_02FE6F,DATA_02FE83,DATA_02FE97,DATA_02FEAB,DATA_02FEC4
	dw DATA_02FEDD,DATA_02FEF6,DATA_02FF0F,DATA_02FF28,DATA_02FF41,DATA_02FF5A,DATA_02FF73,DATA_02FF8C
	dw DATA_02FFA5,DATA_02FFBE

DATA_02FDB1:
	db $01,$00,$26,$00,$02,$00,$0C,$3B,$40,$00,$08,$0C,$3A,$40,$00

DATA_02FDC0:
	db $00,$FE,$26,$00,$02,$00,$0C,$0D,$C0,$00,$08,$0C,$0C,$C0,$00

DATA_02FDCF:
	db $00,$FB,$26,$00,$02,$00,$04,$0A,$C0,$02

DATA_02FDD9:
	db $FF,$F6,$26,$00,$02,$00,$04,$2A,$40,$02

DATA_02FDE3:
	db $FF,$F2,$26,$00,$02,$00,$FC,$1D,$40,$00,$08,$FC,$1C,$40,$00,$00
	db $04,$0C,$C0,$02

DATA_02FDF7:
	db $FF,$EE,$26,$00,$02,$08,$FC,$2A,$C0,$00,$00,$FC,$2B,$C0,$00,$00
	db $04,$0A,$C0,$02

DATA_02FE0B:
	db $00,$EC,$26,$00,$02,$00,$04,$08,$C0,$02,$00,$F4,$08,$40,$02

DATA_02FE1A:
	db $02,$E9,$26,$00,$02,$00,$04,$2A,$40,$02,$00,$F4,$0A,$40,$02

DATA_02FE29:
	db $05,$E7,$26,$00,$02,$00,$F4,$0C,$40,$02,$0F,$F3,$0B,$80,$00,$00
	db $04,$0C,$C0,$02

DATA_02FE3D:
	db $06,$E5,$26,$00,$02,$11,$F2,$0B,$80,$00,$09,$F2,$0A,$80,$00,$00
	db $04,$0A,$C0,$02,$00,$F4,$2A,$C0,$02

DATA_02FE56:
	db $08,$E3,$26,$00,$02,$00,$04,$08,$C0,$02,$00,$F4,$08,$40,$02,$11
	db $F2,$09,$80,$00,$09,$F2,$08,$80,$00

DATA_02FE6F:
	db $00,$F4,$0A,$40,$02,$09,$E1,$26,$00,$02,$09,$EA,$2A,$00,$02,$00
	db $04,$2A,$40,$02

DATA_02FE83:
	db $0A,$DE,$26,$00,$02,$09,$EA,$0C,$80,$02,$00,$04,$0C,$C0,$02,$00
	db $F4,$0C,$40,$02

DATA_02FE97:
	db $0A,$DB,$26,$00,$02,$09,$EA,$0A,$80,$02,$00,$04,$0A,$C0,$02,$00
	db $F4,$2A,$C0,$02

DATA_02FEAB:
	db $0A,$D8,$26,$00,$02,$09,$EA,$08,$80,$02,$09,$E2,$18,$00,$02,$00
	db $04,$08,$C0,$02,$00,$F4,$08,$40,$02

DATA_02FEC4:
	db $09,$D5,$26,$00,$02,$09,$EA,$2A,$00,$02,$09,$E2,$1A,$00,$02,$00
	db $04,$2A,$40,$02,$00,$F4,$0A,$40,$02

DATA_02FEDD:
	db $09,$EA,$0C,$80,$02,$08,$D2,$26,$00,$02,$00,$04,$0C,$C0,$02,$00
	db $F4,$0C,$40,$02,$09,$DA,$0C,$00,$02

DATA_02FEF6:
	db $09,$EA,$0A,$80,$02,$06,$CF,$26,$00,$02,$00,$04,$0A,$C0,$02,$00
	db $F4,$2A,$C0,$02,$09,$DA,$2A,$80,$02

DATA_02FF0F:
	db $00,$F4,$08,$40,$02,$04,$CD,$26,$00,$02,$09,$DA,$08,$00,$02,$09
	db $EA,$08,$80,$02,$00,$04,$08,$C0,$02

DATA_02FF28:
	db $04,$CC,$26,$00,$02,$01,$04,$28,$40,$02,$01,$F4,$28,$C0,$02,$08
	db $D9,$28,$80,$02,$08,$E9,$28,$00,$02

DATA_02FF41:
	db $04,$CA,$26,$00,$02,$02,$04,$22,$C0,$02,$02,$F4,$22,$40,$02,$07
	db $D7,$22,$00,$02,$07,$E7,$22,$80,$02

DATA_02FF5A:
	db $04,$C9,$26,$00,$02,$04,$04,$24,$C0,$02,$04,$F4,$24,$40,$02,$05
	db $D6,$24,$00,$02,$05,$E6,$24,$80,$02

DATA_02FF73:
	db $04,$C9,$26,$40,$02,$04,$04,$24,$80,$02,$04,$F4,$24,$00,$02,$03
	db $D6,$24,$40,$02,$03,$E6,$24,$C0,$02

DATA_02FF8C:
	db $04,$CA,$26,$40,$02,$06,$04,$22,$80,$02,$06,$F4,$22,$00,$02,$01
	db $D7,$22,$40,$02,$01,$E7,$22,$C0,$02

DATA_02FFA5:
	db $04,$CC,$26,$40,$02,$07,$04,$28,$00,$02,$07,$F4,$28,$80,$02,$00
	db $D9,$28,$C0,$02,$00,$E9,$28,$40,$02

DATA_02FFBE:
	db $FF,$EA,$08,$C0,$02,$04,$CD,$26,$40,$02,$08,$04,$08,$80,$02,$08
	db $F4,$08,$00,$02,$FF,$DA,$08,$40,$02

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($02FFD7, incbin, DATA_02FFD7_YI_U2.bin)
else
	%FREE_BYTES($02FFD7, 41, $FF)
endif
%BANK_END(<EndBank>)
endmacro
