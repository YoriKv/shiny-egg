;#############################################################################################################
;# Bank11.asm -- bank $11 mini-battle / mini-game code + per-mini-battle level data blobs.
;#
;# Bank $11 holds the dispatcher and per-type state code for the two "side activity" game modes:
;#   * gamemode $2E -- "bandit minigame" (chase / coin-grab / item-card / watermelon minigames after a level)
;#   * gamemode $30 -- "miniboss / mini battle" (cave room with a small enemy crew, e.g. Bandit fights)
;# Both modes are entered through CODE_gm2e_main_bandit_minigame and CODE_gm30_miniboss_battle; the per-instance variant (which specific
;# minigame or which mini battle) is selected by `$7E:03A7` (the "sub-mode" index) and indexed through
;# the pointer tables that follow each entry point.
;#
;# After all the dispatch + per-variant code, the bank's tail (~$11CA15-$11FD91) is per-mini-battle level
;# data, included as a long stack of `incbin LevelData/DATA_11xxxx.bin` blobs. Each blob is one room's
;# Map16 object/sprite stream in the standard YI level-data format.
;#
;# Contents at a glance:
;#   $11:8000-$11:81xx  CODE_gm2e_main_bandit_minigame      -- gamemode $2E dispatcher
;#   $11:81D9-$11:CA14  CODE_gm30_miniboss_battle + per-variant init/main pairs:
;#                        - checkered-platform mini-battle (init + main)
;#                        - red-balloon mini-battle (init + main)
;#                        - bandit_2 / bandit_3 / bandit_4 mini-battles
;#                        - coin cannon, coin mini-battle, watermelon-pot mini-battle
;#                        - item card (post-level pick-a-prize screen)
;#   $11:CA15-$11:FD91  per-mini-battle LevelData blobs (object/sprite/exit streams)
;#   $11:FD92+          garbage data (V1.1) or free-space pad (V1.0)
;#
;# Cross-references:
;#   Raidenthequick bank11.asm     -- best descriptive labels for this bank (CODE_gm30_miniboss_battle,
;#                                    init_mini_battle_*, main_mini_battle_*, init_item_card, etc.).
;#   see also: ys_enmy*.asm        -- the bandit family lives in the enemy-handler series.
;#   see also: ys_bonus.asm        -- post-level bonus games (related game-mode group).
;#   wiki yoshisisland-disassembly -- gamemode list, sub-mode 03A7 indexing convention.
;#############################################################################################################
macro YIBank11Macros(StartBank, EndBank)
%BANK_START(<StartBank>)

;-------------------------------------------------------------------------
; Gamemode $2E entry -- bandit minigame dispatcher.
; Raidenthequick alias: CODE_gm2e_main_bandit_minigame.
; Initializes the OAM/BG3/scene state for the chosen sub-mode (`$7E:03A7`),
; clears sprite slots, loads the palette, kicks the SuperFX render init
; (FXCODE_08B1EF), then dispatches into the per-variant init at
; DATA_bandit_minigame_init_ptrs,x (16-bit ptr table just below).
; Calls out to:
;   CODE_119D5A                -- bank-local pre-init.
;   CODE_init_oam_and_bg3_tilemap                -- CODE_init_oam_and_bg3_tilemap.
;   CODE_prepare_in_level_states                -- CODE_prepare_in_level_states.
;   CODE_init_oam_buffer                -- CODE_clear_all_sprites / CODE_init_oam_buffer.
;   !RAM_YI_Global_BeginSuperFXProcessingRt  (with FXCODE_08B1EF) -- GSU init.
; Exits with M=8/X=16, sets gamemode to $2F (in-level handler) so the
; next NMI tick continues into normal-level processing.
;-------------------------------------------------------------------------
CODE_118000:
CODE_gm2e_main_bandit_minigame:
	SEP.b #$30
	JSL.l CODE_119D5A
	JSL.l CODE_init_oam_and_bg3_tilemap
	JSL.l CODE_prepare_in_level_states
	JSL.l CODE_clear_all_sprites
	JSL.l CODE_init_oam_buffer
	REP.b #$20
	LDX.b #$1C
CODE_11801A:
	STZ.w !RAM_YI_Level_LevelHeaderBackgroundColorLo,x
	DEX
	DEX
	BPL.b CODE_11801A
	STZ.w !RAM_YI_Level_ItemBeingUsed
	SEP.b #$20
	LDA.w $03A7
	LSR
	TAY
	JSL.l CODE_load_per_world_variant_gfx
	LDX.b #$2A
	JSL.l CODE_init_scene_regs
	JSL.l CODE_hdma_and_gradient_init
	REP.b #$30
	LDA.w #$0020
	STA.w $6126
	LDA.w #$4000
	STA.w $60A4
	STA.w $60A6
	LDY.w #$005C
	LDA.w #$0000
CODE_118050:
	STA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	DEY
	DEY
	DEY
	DEY
	BPL.b CODE_118050
	LDY.w $03A7
	JSL.l CODE_load_yoshi_color_palette
	LDA.b #$09
	STA.w $0127
	JSL.l CODE_prepare_tilemap_dma_queue_l
	LDA.b #!Define_YI_MusicID02_StoryAndLevelTheme
	STA.w !RAM_YI_Global_PlayMusicLo
	STZ.w $0205
	LDX.w $03A7
	JSR.w (DATA_bandit_minigame_init_ptrs,x)
	REP.b #$20
	LDA.w #$8000
	STA.w $61B2
	STZ.w $7DF6
	INC.w $7FEE
	LDX.b #FXCODE_08B1EF>>16
	LDA.w #FXCODE_08B1EF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $03A7
	LSR
	CLC
	ADC.w #$0120
	STA.l $704070
	SEP.b #$20
	STZ.w $038C
	LDA.b #!Define_YI_GameMode2F
	STA.w !RAM_YI_Global_CurrentGameMode
	INC.w !RAM_YI_Level_MessageBoxState 
	LDA.w !RAM_YI_Global_BGModeAndTileSizeSetting
	ORA.b #$40
	STA.w !RAM_YI_Global_BGModeAndTileSizeSetting
	LDA.b #$04
	STA.w !RAM_YI_Level_LevelHeaderAnimationTilesetLo
	STZ.w $0121
	LDA.b #$04
	STA.w $0125
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$D8
	STA.w !REGISTER_VCountTimerLo
	LDA.b #$B1
	STA.w !REGISTER_IRQNMIAndJoypadEnableFlags
	PLB
	RTL

;-------------------------------------------------------------------------
; Per-variant init pointer table for gamemode $2E (bandit minigame).
; Indexed by `JSR.w (DATA_bandit_minigame_init_ptrs,x)` with x = `$7E:03A7` (sub-mode).
; Each entry is a 16-bit pointer into bank $11; CODE_1180E5 is the no-op
; "nothing to init" handler used as filler for empty slots.
;-------------------------------------------------------------------------
DATA_1180CD:
DATA_bandit_minigame_init_ptrs:                                  ; descriptive alias
	dw CODE_1180E8
	dw CODE_1180EE
	dw CODE_1180F4
	dw CODE_11B6DC
	dw CODE_init_mini_battle_gather_coins
	dw CODE_init_mini_battle_pop_balloons_left
	dw CODE_init_mini_battle_pop_balloons_right
	dw CODE_11B764
	dw CODE_1180E5
	dw CODE_init_mini_battle_watermelon_spit
	dw CODE_init_mini_battle_watermelon_spit_2p
	dw CODE_1180FA

CODE_1180E5:
	SEP.b #$30
	RTS

CODE_1180E8:
	LDY.b #$03
	LDX.b #$00
	BRA.b CODE_11810A

CODE_1180EE:
	LDY.b #$04
	LDX.b #$00
	BRA.b CODE_11810A

CODE_1180F4:
	LDY.b #$05
	LDX.b #$00
	BRA.b CODE_11810A

CODE_1180FA:
	LDY.b #$03
	LDX.b #$01
	BRA.b CODE_11810A

CODE_118100:
	LDY.b #$04
	LDX.b #$01
	BRA.b CODE_11810A

CODE_118106:
	LDY.b #$05
	LDX.b #$01
CODE_11810A:
	STY.w $1170
	STX.w $10F2
	LDA.w !RAM_YI_Global_BG1AddressAndSize
	EOR.b #$03
	STA.w !RAM_YI_Global_BG1AddressAndSize
	STA.w !REGISTER_BG1AddressAndSize
	LDA.w !RAM_YI_Global_BG2AddressAndSize
	EOR.b #$03
	STA.w !RAM_YI_Global_BG2AddressAndSize
	STA.w !REGISTER_BG2AddressAndSize
	REP.b #$20
	STZ.b !RAM_YI_Global_Layer1XPosLo
	STZ.b !RAM_YI_Global_Layer1YPosLo
	STZ.b !RAM_YI_Global_Layer2XPosLo
	LDA.w #$0017
	STA.b !RAM_YI_Global_Layer2YPosLo
	STZ.b !RAM_YI_Global_Layer3XPosLo
	STZ.b !RAM_YI_Global_Layer3YPosLo
	LDA.w #$0030
	STA.w $70E2
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w #$00B0
	STA.w $7182
	LDA.w #$00E0
	STA.w $70E4
	LDA.w #$00D8
	STA.w $7184
	LDA.w #$0061
	STA.w $70E6
	LDA.w #$0035
	STA.w $7186
	LDA.w #$00C0
	STA.w $10FE
	LDA.w #$00C0
	STA.w $1100
	STA.w $1164
	STZ.w $1102
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	LDA.w #$0001
	STA.w $797C
	STZ.w $1108
	STZ.w $1128
	STZ.w $1138
	JSL.l CODE_random_number_gen
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	LSR
	BCC.b CODE_118191
	LDA.w #$FFF0
	BRA.b CODE_118194

CODE_118191:
	LDA.w #$0010
CODE_118194:
	STA.w $7224
	STZ.w $797A
	LDA.w #$0001
	STA.w $10F6
	LDA.w #$301F
	STA.l YI_Global_PaletteMirror[$C5].LowByte
	SEP.b #$20
	LDA.b #$B4
	STA.w $118C
	STZ.w !REGISTER_DividendLo
	STA.w !REGISTER_DividendHi
	LDA.b #$48
	STA.w !REGISTER_Divisor
	NOP #8
	LDA.w !REGISTER_QuotientLo
	STA.w $118E
	LDA.w !REGISTER_QuotientHi
	STA.w $118F
	LDA.b #$09
	STA.w !RAM_YI_Global_BGModeAndTileSizeSetting
	STZ.w !RAM_YI_Global_ColorMathSelectAndEnable
	JSR.w CODE_119134
	RTS

;-------------------------------------------------------------------------
; Gamemode $30 entry -- miniboss / mini battle main tick.
; Raidenthequick alias: CODE_gm30_miniboss_battle.
; If a message box is open, ticks the message subsystem (CODE_message_box_handler_entry);
; otherwise dispatches into the per-variant tick at DATA_mini_battle_main_ptrs,x where
; x = `$7E:03A7` (sub-mode). The variant pointers reuse the same routines
; as the gamemode $2E dispatcher (DATA_bandit_minigame_init_ptrs), confirming gm$2E and
; gm$30 share their per-variant Main bodies.
;-------------------------------------------------------------------------
CODE_1181D9:
CODE_gm30_miniboss_battle:                                       ; descriptive alias
	LDA.w !RAM_YI_Level_MessageBoxState
	BEQ.b CODE_1181EA
	JSL.l CODE_message_box_handler_entry
	LDA.w !RAM_YI_Level_MessageBoxState
	BNE.b CODE_1181EA
	JSR.w CODE_118216
CODE_1181EA:
	LDX.w $03A7
	JSR.w (DATA_mini_battle_main_ptrs,x)
	PLB
	RTL

; Per-variant Main pointer table for gamemodes $2E/$30. Indexed by `$7E:03A7`.
DATA_1181F2:
DATA_mini_battle_main_ptrs:                                      ; descriptive alias
	dw CODE_11825E
	dw CODE_11825E
	dw CODE_11825E
	dw CODE_11B6DD
	dw CODE_main_mini_battle_gather_coins
	dw CODE_main_mini_battle_pop_balloons
	dw CODE_main_mini_battle_pop_balloons
	dw CODE_11B765
	dw CODE_1180E5
	dw CODE_main_mini_battle_watermelon_spit
	dw CODE_main_mini_battle_watermelon_spit_2p
	dw CODE_11825E

; Per-sub-mode music ID byte (one byte per `$7E:03A7` slot). Selects which SPC700 song
; ID to load at minigame start. Values $A2-$A7 are mini-battle/minigame tracks.
DATA_11820A:
DATA_mini_battle_music_ids:                                      ; descriptive alias
	db $A2,$A2,$A2,$A3,$A3,$A4,$A4,$A6,$A7,$A5,$A5,$A2

CODE_118216:
	LDA.w $03A7
	LSR
	REP.b #$30
	AND.w #$00FF
	TAY
	LDA.w DATA_mini_battle_music_ids,y
	AND.w #$00FF
	JSL.l CODE_00B753
	LDX.w #$706800>>16
	STX.b $01
	LDX.w #$706800
	LDY.w #$3400
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDX.w #$0000
CODE_11823C:
	LDA.l DATA_5FE3CC,x
	STA.l YI_Global_PaletteMirror[$01].LowByte,x
	INX
	INX
	CPX.w #$001E
	BCC.b CODE_11823C
	SEP.b #$30
	LDA.w !RAM_YI_Global_HDMAEnable
	EOR.b #$20
	STA.w !RAM_YI_Global_HDMAEnable
	LDA.w !RAM_YI_Global_BGModeAndTileSizeSetting
	EOR.b #$40
	STA.w !RAM_YI_Global_BGModeAndTileSizeSetting
	RTS

CODE_11825E:
	REP.b #$20
	LDY.w $1194
	LDA.w $093C,y
	STA.w $0035
	LDA.w $093E,y
	STA.w $0037
	JSL.l CODE_init_oam_buffer
	JSL.l CODE_spr_edge_despawn_draw
	JSR.w CODE_118D8D
	JSR.w CODE_1187FD
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_118293
	LDA.w !RAM_YI_Global_HDMAEnable
	BIT.b #$08
	BNE.b CODE_118290
	JSR.w CODE_11942C
	JSL.l CODE_119C27
CODE_118290:
	JSR.w CODE_1182BB
CODE_118293:
	JSR.w CODE_118D73
	REP.b #$20
	LDA.l $7E4000
	CMP.w #$0020
	BCS.b CODE_1182A4
	JSR.w CODE_11912F
CODE_1182A4:
	LDA.w $10F8
	BEQ.b CODE_1182AD
	JSL.l CODE_handle_sprites
CODE_1182AD:
	REP.b #$20
	LDX.b #FXCODE_08B1EF>>16
	LDA.w #FXCODE_08B1EF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	RTS

CODE_1182BB:
	LDA.w $797C
	ASL
	TAY
	LDA.w DATA_1182CD,y
	STA.b $00
	LDA.w DATA_1182CD+$01,y
	STA.b $01
	JMP.w ($0000)

DATA_1182CD:
	dw CODE_1182D3
	dw CODE_118443
	dw CODE_1184EC

CODE_1182D3:
	REP.b #$30
	LDA.b $30
	AND.w #$0003
	BEQ.b CODE_1182DF
	JMP.w CODE_11836D

CODE_1182DF:
	LDA.w $1164
	AND.w #$01F0
	ASL
	ASL
	ASL
	ASL
	ASL
	ASL
	ORA.w #$001F
	STA.l YI_Global_PaletteMirror[$C5].LowByte
	LDA.w $1164
	INC
	STA.w $1164
	CMP.w #$01FF
	BCC.b CODE_11836D
	LDA.w #$0002
	STA.w $797C
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	BNE.b CODE_11833C
	LDA.w #$0003
	STA.w $797A
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	LDA.w #$00C0
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror
	LDA.w #$009D
	STA.b $00
	SEP.b #$20
	LDA.b #$FE
	STA.w $1107
	LDA.b #$08
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror
	STZ.w $1106
	STZ.w $1126
	STZ.w $1136
	REP.b #$20
	BRA.b CODE_11834D

CODE_11833C:
	LDA.w #$0004
	STA.w $797A
	LDA.w #$0003
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	LDA.w #$009E
	STA.b $00
CODE_11834D:
	REP.b #$30
	LDA.w #$01FF
	STA.w $1164
	LDA.w $1154
	LDA.w $1156
	LDA.w $1144
	LDA.w $1146
	STZ.w $114A
	STZ.w $115A
	STZ.w $116A
	STZ.w $1168
CODE_11836D:
	LDA.w $1168
	BEQ.b CODE_11839D
	DEC.w $1168
	LDA.w $1100
	SEC
	SBC.w #$0003
	STA.w $1100
	LDA.w $10FE
	CLC
	ADC.w #$0003
	CMP.w #$01FF
	BCC.b CODE_11838E
	LDA.w #$01FF
CODE_11838E:
	STA.w $10FE
	LDA.b $30
	AND.w #$0003
	BNE.b CODE_1183D0
	INC.w $7186
	BRA.b CODE_1183D0

CODE_11839D:
	LDA.w $1100
	CLC
	ADC.w #$0003
	CMP.w $1164
	BCC.b CODE_1183AC
	LDA.w $1164
CODE_1183AC:
	STA.w $1100
	LDA.w $10FE
	SEC
	SBC.w #$0003
	CMP.w $1164
	BCS.b CODE_1183BE
	LDA.w $1164
CODE_1183BE:
	STA.w $10FE
	LDA.w $7186
	DEC
	CMP.w #$0090
	BCS.b CODE_1183CD
	LDA.w #$0090
CODE_1183CD:
	STA.w $7186
CODE_1183D0:
	JSR.w CODE_1183D6
	SEP.b #$30
	RTS

CODE_1183D6:
	REP.b #$30
	LDY.w $6092
	LDX.w #$0000
	STZ.b $02
CODE_1183E0:
	STZ.b $00
CODE_1183E2:
	LDA.w $70E6
	CLC
	ADC.b $00
	STA.w $6000,y
	LDA.w $7186
	CLC
	ADC.b $02
	STA.w $6002,y
	LDA.w DATA_118433,x
	AND.w #$00FF
	ORA.w #$2900
	STA.w $6004,y
	LDA.w #$0002
	STA.w $6006,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	INX
	INC.b $04
	INC.b $04
	LDA.b $00
	CLC
	ADC.w #$0010
	STA.b $00
	CMP.w #$0040
	BCC.b CODE_1183E2
	STZ.b $00
	LDA.b $02
	CLC
	ADC.w #$0010
	STA.b $02
	CMP.w #$0040
	BCC.b CODE_1183E0
	STY.w $6092
	SEP.b #$30
	RTS

DATA_118433:
	db $C0,$C2,$C4,$C6,$E0,$E2,$E4,$E6,$C8,$CA,$CC,$CE,$E8,$EA,$EC,$EE

CODE_118443:
	LDY.b #$00
	LDX.b #$04
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	CMP.b #$02
	BEQ.b CODE_118457
	LDA.w $797A
	CMP.b #$02
	BNE.b CODE_11845E
	LDY.b #$02
CODE_118457:
	LDA.w $1105,y
	CMP.b #$FD
	BEQ.b CODE_11846E
CODE_11845E:
	LDA.b #$0D
	STA.b $00
	LDA.b #$03
	STA.b $02
	LDA.b #$00
	JSR.w CODE_119073
	JSR.w CODE_1190EB
CODE_11846E:
	JSR.w CODE_118FDE
	LDA.w $70E2,x
	CMP.b #$26
	BCS.b CODE_1184A9
	LDA.b #$26
	STA.w $70E2,x
	LDA.b #$90
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	LDA.b #$01
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	STZ.w $1154
	STZ.w $1144
	STZ.w $116E
	LDA.b #$08
	STA.w $1168
	LDA.b #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	STZ.w $1194
	JSR.w CODE_1195A7
	JSR.w CODE_1195E8
	BRA.b CODE_1184E8

CODE_1184A9:
	CMP.b #$9D
	BCC.b CODE_1184E8
	LDA.b #$9C
	STA.w $70E2,x
	LDA.b #$90
	STA.w $7182,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	LDA.b #$01
	STA.w $797A
	STZ.w $1156
	STZ.w $1146
	STZ.w $116E
	LDA.b #$08
	STA.w $1168
	LDA.b #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	LDA.w $10F2
	BEQ.b CODE_1184E5
	LDA.b #$04
	STA.w $1194
	JSR.w CODE_1195A7
	JSR.w CODE_1195E8
	BRA.b CODE_1184E8

CODE_1184E5:
	JSR.w CODE_118C58
CODE_1184E8:
	JSR.w CODE_1183D6
	RTS

CODE_1184EC:
	LDA.w $116A
	ASL
	TAY
	LDA.w DATA_1184FE,y
	STA.b $00
	LDA.w DATA_1184FE+$01,y
	STA.b $01
	JMP.w ($0000)

DATA_1184FE:
	dw CODE_11850E
	dw CODE_118532
	dw CODE_118557
	dw CODE_1185A8
	dw CODE_1185CC
	dw CODE_1185F0
	dw CODE_118614
	dw CODE_11867E

CODE_11850E:
	REP.b #$30
	LDA.w #$0004
	STA.b $00
	LDA.w #$0002
	STA.b $0A
	LDA.w #$006A
	STA.b $0C
	LDX.w #$0000
	JSR.w CODE_118682
	JSR.w CODE_1183D6
	INC.w $116A
	LDA.b #!Define_YI_SoundID86_MildePop2
	JSL.l CODE_push_sound_queue
	RTS

CODE_118532:
	REP.b #$30
	LDA.w #$0001
	STA.b $00
	LDA.w #$0002
	STA.b $0A
	LDA.w #$0040
	STA.b $0C
	LDX.w #$0004
	JSR.w CODE_118682
	JSR.w CODE_1183D6
	SEP.b #$30
	INC.w $116A
	LDA.b #$10
	STA.w $1168
	RTS

CODE_118557:
	REP.b #$30
	LDA.w #$0004
	STA.b $00
	LDA.w #$0002
	STA.b $0A
	LDA.w #$0042
	STA.b $0C
	LDX.w #$0005
	JSR.w CODE_118682
	SEP.b #$30
	LDA.b $30
	LSR
	BCS.b CODE_118578
	JSR.w CODE_1183D6
CODE_118578:
	DEC.w $1168
	BNE.b CODE_118585
	INC.w $116A
	LDA.b #$02
	STA.w $1168
CODE_118585:
	REP.b #$30
	LDA.w $10FE
	SEC
	SBC.w #$0010
	BPL.b CODE_118593
	LDA.w #$0001
CODE_118593:
	STA.w $10FE
	LDA.w $1100
	SEC
	SBC.w #$0010
	BPL.b CODE_1185A2
	LDA.w #$0001
CODE_1185A2:
	STA.w $1100
	SEP.b #$30
	RTS

CODE_1185A8:
	REP.b #$30
	LDA.w #$0010
	STA.b $00
	STZ.b $0A
	LDA.w #$00E3
	STA.b $0C
	LDX.w #$0009
	JSR.w CODE_118682
	SEP.b #$30
	DEC.w $1168
	BNE.b CODE_1185CB
	INC.w $116A
	LDA.b #$02
	STA.w $1168
CODE_1185CB:
	RTS

CODE_1185CC:
	REP.b #$30
	LDA.w #$0020
	STA.b $00
	STZ.b $0A
	LDA.w #$00E3
	STA.b $0C
	LDX.w #$0019
	JSR.w CODE_118682
	SEP.b #$30
	DEC.w $1168
	BNE.b CODE_1185EF
	INC.w $116A
	LDA.b #$02
	STA.w $1168
CODE_1185EF:
	RTS

CODE_1185F0:
	REP.b #$30
	LDA.w #$0020
	STA.b $00
	STZ.b $0A
	LDA.w #$00E3
	STA.b $0C
	LDX.w #$0039
	JSR.w CODE_118682
	SEP.b #$30
	DEC.w $1168
	BNE.b CODE_118613
	INC.w $116A
	LDA.b #$02
	STA.w $1168
CODE_118613:
	RTS

CODE_118614:
	REP.b #$30
	LDA.w #$0008
	STA.b $00
	LDA.w #$0002
	STA.b $0A
	LDA.w #$00E5
	STA.b $0C
	LDX.w #$0059
	JSR.w CODE_118682
	SEP.b #$30
	DEC.w $1168
	BNE.b CODE_11867D
	INC.w $116A
	INC.w $10E2
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	CMP.b #$04
	BEQ.b CODE_118644
	INC.w $10E6
	BRA.b CODE_11867A

CODE_118644:
	LDA.w $10F2
	BEQ.b CODE_11864E
	INC.w $10FA
	BRA.b CODE_11867A

CODE_11864E:
	REP.b #$20
	LDA.w #$0011
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_11867A
	PHX
	LDA.w $1170
	SEC
	SBC.w #$0003
	CLC
	ADC.w #$000A
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0080
	STA.w $7182,y
	LDA.w #$0038
	STA.w $70E2,y
	PLX
	INC.w $10F8
	SEP.b #$20
CODE_11867A:
	JSR.w CODE_1191C4
CODE_11867D:
	RTS

CODE_11867E:
	JSR.w CODE_1191C4
	RTS

CODE_118682:
	REP.b #$30
	LDY.w $6092
CODE_118687:
	LDA.w DATA_11873B,x
	CLC
	ADC.w #$0020
	AND.w #$00FF
	CMP.w #$0080
	BCC.b CODE_118699
	ORA.w #$FF00
CODE_118699:
	CLC
	ADC.w $70E6
	STA.w $6000,y
	LDA.w DATA_1186DA,x
	CLC
	ADC.w #$0020
	AND.w #$00FF
	CMP.w #$0080
	BCC.b CODE_1186B2
	ORA.w #$FF00
CODE_1186B2:
	CLC
	ADC.w $7186
	STA.w $6002,y
	LDA.w DATA_11879B,x
	AND.w #$FF00
	ORA.b $0C
	STA.w $6004,y
	LDA.b $0A
	STA.w $6006,y
	INX
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEC.b $00
	BNE.b CODE_118687
	STY.w $6092
	SEP.b #$30
	RTS

DATA_1186DA:
	db $00,$00,$F0,$F0,$F8,$00,$00,$F0,$F0,$08,$08,$00,$00,$F8,$F0,$F0
	db $F8,$08,$F0,$08,$F0,$00,$00,$F8,$F8,$F4,$F4,$EC,$EC,$F4,$F4,$EC
	db $EC,$0C,$0C,$04,$04,$0C,$0C,$04,$04,$10,$10,$08,$08,$F0,$F0,$E8
	db $E8,$00,$00,$F8,$F8,$00,$00,$F8,$F8,$F0,$F0,$E8,$E8,$00,$00,$F8
	db $F8,$10,$10,$08,$08,$18,$18,$10,$10,$10,$10,$08,$08,$00,$00,$F8
	db $F8,$F0,$F0,$E8,$E8,$E8,$E8,$E0,$E0,$F8,$10,$18,$10,$F8,$E0,$D8
	db $E0

DATA_11873B:
	db $00,$F0,$00,$F0,$F8,$F0,$00,$00,$F0,$00,$F8,$F0,$08,$08,$00,$F8
	db $F0,$08,$08,$F0,$F0,$00,$F8,$00,$F8,$F4,$EC,$F4,$EC,$0C,$04,$0C
	db $04,$0C,$04,$0C,$04,$F4,$EC,$F4,$EC,$00,$F8,$00,$F8,$00,$F8,$00
	db $F8,$10,$08,$10,$08,$F0,$E8,$F0,$E8,$F0,$E8,$E8,$F0,$E8,$E0,$E0
	db $E8,$F0,$E8,$E8,$F0,$00,$F8,$F8,$00,$10,$08,$08,$10,$18,$10,$10
	db $18,$10,$08,$08,$10,$00,$F8,$F8,$00,$D8,$E0,$F8,$10,$18,$10,$F8

DATA_11879B:
	db $E0,$F0,$B0,$70,$30,$30,$B2,$F2,$72,$32,$B0,$F0,$30,$70,$F0,$30
	db $70,$B0,$F0,$70,$B0,$30,$30,$70,$B0,$F0,$F0,$B0,$70,$30,$F0,$B0
	db $70,$30,$F0,$B0,$70,$30,$F0,$B0,$70,$30,$F0,$B0,$70,$30,$F0,$B0
	db $70,$30,$F0,$B0,$70,$30,$F0,$B0,$70,$30,$F0,$B0,$30,$70,$F0,$B0
	db $30,$70,$F0,$B0,$30,$70,$F0,$B0,$30,$70,$F0,$B0,$30,$70,$F0,$B0
	db $30,$70,$F0,$B0,$30,$70,$F0,$B0,$30,$70,$30,$30,$30,$70,$70,$70
	db $70,$30

CODE_1187FD:
	LDA.w $797A
	ASL
	TAY
	LDA.w DATA_11880F,y
	STA.b $00
	LDA.w DATA_11880F+$01,y
	STA.b $01
	JMP.w ($0000)

DATA_11880F:
	dw CODE_118819
	dw CODE_1188FB
	dw CODE_118A1F
	dw CODE_118B0E
	dw CODE_118C54

CODE_118819:
	LDY.w $1156
	LDA.w $1146
	BEQ.b CODE_118826
	DEC.w $1146
	BRA.b CODE_118835

CODE_118826:
	INY
	CPY.b #$04
	BCC.b CODE_11882D
	LDY.b #$00
CODE_11882D:
	STY.w $1156
	LDA.b #$10
	STA.w $1146
CODE_118835:
	REP.b #$30
	TYA
	ASL
	ASL
	CLC
	ADC.w $1156
	ASL
	TAX
	LDY.w $6092
	LDA.w #$0005
	STA.b $00
CODE_118848:
	LDA.w DATA_1188AB,x
	CLC
	ADC.w $70E4
	STA.w $6000,y
	LDA.w DATA_1188D3,x
	CLC
	ADC.w $7184
	STA.w $6002,y
	LDA.w DATA_118883,x
	STA.w $6004,y
	AND.w #$FF00
	SEC
	SBC.w #$3100
	BEQ.b CODE_11886E
	LDA.w #$0002
CODE_11886E:
	STA.w $6006,y
	INX
	INX
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEC.b $00
	BNE.b CODE_118848
	STY.w $6092
	SEP.b #$30
	RTS

DATA_118883:
	dw $319E,$319E,$318B,$318A,$3388,$319E,$319E,$318B
	dw $318A,$3388,$3388,$319E,$319E,$318B,$318A,$319E
	dw $319E,$318B,$318A,$3388

DATA_1188AB:
	dw $FFEB,$FFE0,$FFE8,$FFE0,$FFE0,$FFEB,$FFE0,$FFE8
	dw $FFE0,$FFDF,$FFDE,$FFEB,$FFE0,$FFE8,$FFE0,$FFEB
	dw $FFE0,$FFE8,$FFE0,$FFDF

DATA_1188D3:
	dw $FFF0,$FFF0,$FFED,$FFED,$FFDE,$FFF0,$FFF0,$FFED
	dw $FFED,$FFDE,$FFDF,$FFF0,$FFF0,$FFED,$FFED,$FFF0
	dw $FFF0,$FFED,$FFED,$FFDE

CODE_1188FB:
	LDA.w $10F2
	BEQ.b CODE_118903
	JMP.w CODE_1189A5

CODE_118903:
	LDA.w $118A
	BEQ.b CODE_118919
	JSR.w CODE_119B79
	DEC.w $118A
	BEQ.b CODE_118913
	JMP.w CODE_1189A1

CODE_118913:
	STZ.w $116E
	JSR.w CODE_118C58
CODE_118919:
	LDA.w $116E
	ASL
	TAX
	LDA.w $1172,x
	DEC
	STA.w $1172,x
	BNE.b CODE_11894B
	JSL.l CODE_random_number_gen
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	CMP.b #$02
	BCS.b CODE_11893F
	LDA.b #$20
	STA.w $118A
	LDA.b #!Define_YI_SoundID90_Incorrect
	JSL.l CODE_push_sound_queue
	BRA.b CODE_1189A1

CODE_11893F:
	INC.w $116E
	LDA.b #!Define_YI_SoundID8F_Correct
	JSL.l CODE_push_sound_queue
	JSR.w CODE_1199F8
CODE_11894B:
	DEC.w $1166
	BEQ.b CODE_118958
	JSR.w CODE_119AC6
	JSR.w CODE_119B99
	BRA.b CODE_1189A1

CODE_118958:
	LDA.b #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	LDA.b #!Define_YI_SoundID08_1up
	JSL.l CODE_push_sound_queue
	LDA.b #!Define_YI_SoundID38_BabyMarioJump
	JSL.l CODE_push_sound_queue
	LDA.b #$02
	STA.w $797A
	LDA.b #$01
	STA.w $797C
	STZ.w $1146
	STZ.w $1156
	LDA.b #$FD
	STA.w $1107
	LDA.b #$FD
	STA.w $1109
	STZ.w $1106
	STZ.w $1108
	STZ.w $1126
	STZ.w $1128
	LDA.b #$F0
	STA.w $7224
	STZ.w $1138
	STZ.w $1168
	STZ.w $116A
	JSR.w CODE_11942C
CODE_1189A1:
	JSR.w CODE_118819
	RTS

CODE_1189A5:
	LDA.w $118A
	BEQ.b CODE_1189BC
	DEC.w $118A
	BNE.b CODE_1189B5
	STZ.w $116E
	JSR.w CODE_1195E8
CODE_1189B5:
	JSR.w CODE_118819
	JSR.w CODE_119B79
	RTS

CODE_1189BC:
	JSR.w CODE_119B99
	REP.b #$20
	DEC.w $116C
	BNE.b CODE_1189EA
CODE_1189C6:
	LDA.w #!Define_YI_SoundID90_Incorrect
	JSL.l CODE_push_sound_queue
	LDA.w #$0020
	STA.w $118A
	LDA.w $118C
	STA.w $116C
	REP.b #$20
	LDA.w #$0048
	STA.w $1192
	STZ.w $1190
	JSR.w CODE_119BF4
	JMP.w CODE_118A19

CODE_1189EA:
	JSR.w CODE_119AC6
	REP.b #$20
	LDA.w $116E
	ASL
	TAX
	LDA.b $37
	BEQ.b CODE_118A19
	CMP.w $1172,x
	BNE.b CODE_1189C6
	LDA.w #!Define_YI_SoundID8F_Correct
	JSL.l CODE_push_sound_queue
	INC.w $116E
	LDA.w $1170
	CMP.w $116E
	BCC.b CODE_118A14
	JSR.w CODE_119902
	BRA.b CODE_118A19

CODE_118A14:
	SEP.b #$20
	JMP.w CODE_118958

CODE_118A19:
	SEP.b #$20
	JSR.w CODE_118819
	RTS

CODE_118A1F:
	LDA.b #$20
	STA.b $00
	LDA.b #$04
	STA.b $02
	LDX.b #$02
	LDA.b #$00
	JSR.w CODE_119073
	LDA.w $7184
	CMP.b #$D8
	BCC.b CODE_118A43
	LDA.b #$D8
	STA.w $7184
	STZ.w $797A
	STZ.w $1146
	STZ.w $1156
CODE_118A43:
	LDA.w $1107
	CLC
	ADC.b #$03
	TAY
	LDA.w DATA_118A8F,y
	TAX
	REP.b #$30
	LDA.w #$0005
	STA.b $00
	LDY.w $6092
CODE_118A58:
	LDA.w $70E4
	CLC
	ADC.w DATA_118ABE,x
	STA.w $6000,y
	LDA.w $7184
	CLC
	ADC.w DATA_118A96,x
	STA.w $6002,y
	LDA.w DATA_118AE6,x
	STA.w $6004,y
	AND.w #$0200
	BEQ.b CODE_118A7A
	LDA.w #$0002
CODE_118A7A:
	STA.w $6006,y
	INX
	INX
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEC.b $00
	BNE.b CODE_118A58
	STY.w $6092
	SEP.b #$30
	RTS

DATA_118A8F:
	db $00,$0A,$0A,$14,$14,$14,$1E

DATA_118A96:
	dw $FFE2,$FFEF,$FFF0,$FFED,$FFED,$FFEF,$FFF0,$FFE8
	dw $FFE8,$FFD9,$FFF0,$FFF0,$FFDA,$FFE8,$FFE8,$FFF1
	dw $FFF1,$FFE2,$FFEF,$FFEF

DATA_118ABE:
	dw $FFDE,$FFEA,$FFE3,$FFE8,$FFE0,$FFE3,$FFE8,$FFE8
	dw $FFE0,$FFE2,$FFE8,$FFE3,$FFE0,$FFE8,$FFE0,$FFE5
	dw $FFE0,$FFDF,$FFE8,$FFE0

DATA_118AE6:
	dw $3388,$319A,$319E,$318B,$318A,$719A,$719A,$318B
	dw $318A,$3388,$B19B,$B19B,$3388,$318B,$318A,$319E
	dw $319E,$3388,$318B,$318A

CODE_118B0E:
	LDX.b #$02
	LDA.b #$20
	STA.b $00
	LDA.b #$04
	STA.b $02
	LDA.b #$00
	JSR.w CODE_119073
	LDA.w $7182,x
	CMP.b #$D8
	BCC.b CODE_118B4D
	LDA.b #$D8
	STA.w $7182,x
	LDA.w $70E2,x
	CLC
	ADC.b #$F6
	STA.w $70EA
	LDA.w $7182,x
	CLC
	ADC.b #$F8
	STA.w $718A
	JSR.w CODE_118F1F
	LDA.b $30
	AND.b #$30
	LSR
	LSR
	LSR
	LSR
	TAY
	LDA.w DATA_118B96,y
	TAX
	BRA.b CODE_118B59

CODE_118B4D:
	JSR.w CODE_1190EB
	LDA.w $1105,x
	INC
	INC
	TAY
	LDX.w DATA_118B9A,y
CODE_118B59:
	REP.b #$30
	LDY.w $6092
	LDA.w #$0005
	STA.b $00
CODE_118B63:
	LDA.w $70E4
	CLC
	ADC.w DATA_118BDC,x
	STA.w $6000,y
	LDA.w $7184
	CLC
	ADC.w DATA_118BA0,x
	STA.w $6002,y
	LDA.w DATA_118C18,x
	STA.w $6004,y
	AND.w #$0200
	XBA
	STA.w $6006,y
	INX
	INX
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEC.b $00
	BNE.b CODE_118B63
	STY.w $6092
	SEP.b #$30
	RTS

DATA_118B96:
	dw $281E,$2832

DATA_118B9A:
	db $00,$0A,$14,$1E,$28,$32

DATA_118BA0:
	dw $FFF1,$FFF1,$FFE2,$FFEF,$FFEF,$FFE4,$FFF2,$FFF2
	dw $FFF1,$FFF1,$FFF3,$FFF3,$FFE6,$FFF3,$FFF3,$FFF3
	dw $FFF3,$FFE5,$FFF2,$FFF2,$FFF3,$FFF3,$FFE4,$FFF2
	dw $FFF2,$FFF3,$FFF3,$FFE4,$FFF2,$FFF2

DATA_118BDC:
	dw $FFE5,$FFE0,$FFDF,$FFE8,$FFE0,$FFDF,$FFE4,$FFDF
	dw $FFE9,$FFE1,$FFDC,$FFE1,$FFDF,$FFE9,$FFE1,$FFDC
	dw $FFE1,$FFDF,$FFE9,$FFE1,$FFDC,$FFE1,$FFE0,$FFE9
	dw $FFE1,$FFDC,$FFE1,$FFE1,$FFE9,$FFE1

DATA_118C18:
	dw $319E,$319E,$3388,$318B,$318A,$3388,$319A,$319A
	dw $318B,$318A,$319B,$319B,$3388,$318B,$318A,$319B
	dw $319B,$3388,$318B,$318A,$319B,$319B,$3388,$318B
	dw $318A,$319B,$319B,$3388,$318B,$318A

CODE_118C54:
	JMP.w CODE_118819

CODE_118C57:
	RTS

CODE_118C58:
	JSR.w CODE_119BF4
	LDX.b #$0B
CODE_118C5D:
	STZ.w $1172,x
	DEX
	BPL.b CODE_118C5D
	LDA.w $1165
	BEQ.b CODE_118C78
	LDA.w $1164
	CMP.b #$80
	BCC.b CODE_118C78
	JSL.l CODE_random_number_gen
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	BMI.b CODE_118CB6
CODE_118C78:
	LDA.w $1170
	ASL
	TAX
	STZ.b $00
CODE_118C7F:
	JSL.l CODE_random_number_gen
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.b #$1F
	CMP.b #$18
	BCC.b CODE_118C98
	CMP.b #$1C
	BCS.b CODE_118C95
	SEC
	SBC.b #$18
	BRA.b CODE_118C98

CODE_118C95:
	SEC
	SBC.b #$08
CODE_118C98:
	CLC
	ADC.b #$08
	STA.w $1172,x
	CLC
	ADC.b $00
	STA.b $00
	DEX
	DEX
	BPL.b CODE_118C7F
	LDA.b $00
	CMP.b #$B4
	BCC.b CODE_118CAF
	LDA.b #$B4
CODE_118CAF:
	STA.w $1166
	JSR.w CODE_11976D
	RTS

CODE_118CB6:
	JSL.l CODE_random_number_gen
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.b #$7F
	CLC
	ADC.b #$30
	STA.w $1166
	STA.w !REGISTER_DividendLo
	STZ.w !REGISTER_DividendHi
	LDA.w $1170
	INC
	STA.w !REGISTER_Divisor
	NOP #8
	LDA.w !REGISTER_QuotientLo
	STA.b $00
	LDA.w $1170
	ASL
	STA.b $0A
	LDX.b #$00
	STZ.b $02
CODE_118CE9:
	LDA.b $00
	STA.w $1172,x
	CLC
	ADC.b $02
	STA.b $02
	INX
	INX
	CPX.b $0A
	BNE.b CODE_118CE9
	LDA.w $1166
	SEC
	SBC.b $02
	STA.w $1172,x
	JSL.l CODE_random_number_gen
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.b #$06
	TAX
	JSR.w (DATA_118D16,x)
	JSR.w CODE_11976D
	STZ.w $116E
	RTS

DATA_118D16:
	dw CODE_118D1F
	dw CODE_118D1F
	dw CODE_118D4B
	dw CODE_118D4B

CODE_118D1E:
	RTS

CODE_118D1F:
	LDA.w $1170
	ASL
	TAY
	STZ.b $00
CODE_118D26:
	LDA.w $1172,y
	SEC
	SBC.b #$08
	CLC
	ADC.b $00
	STA.b $00
	LDA.b #$08
	STA.w $1172,y
	DEY
	DEY
	CPY.b #$02
	BNE.b CODE_118D26
	LDA.b $00
	LSR
	CLC
	ADC.w $1172
	STA.w $1172
	INC
	STA.w $1174
	RTS

CODE_118D4B:
	LDA.w $1170
	DEC
	ASL
	TAY
	PHY
	STZ.b $00
CODE_118D54:
	LDA.w $1172,y
	SEC
	SBC.b #$08
	CLC
	ADC.b $00
	STA.b $00
	LDA.b #$08
	STA.w $1172,y
	DEY
	DEY
	BPL.b CODE_118D54
	PLY
	LDA.w $1174,y
	CLC
	ADC.b $00
	STA.w $1174,y
	RTS

CODE_118D73:
	LDA.w $038C
	BNE.b CODE_118D88
	REP.b #$20
	LDA.w $70E2
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $7182
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEP.b #$20
CODE_118D88:
	JSL.l CODE_04FA67
	RTS

CODE_118D8D:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	ASL
	TAY
	LDA.w DATA_118D9F,y
	STA.b $00
	LDA.w DATA_118D9F+$01,y
	STA.b $01
	JMP.w ($0000)

DATA_118D9F:
	dw CODE_118DA9
	dw CODE_118DBB
	dw CODE_118DEA
	dw CODE_118E1C
	dw CODE_118E7C

CODE_118DA9:
	JSL.l CODE_random_number_gen
	REP.b #$20
	LDX.b #FXCODE_0BC6C5>>16
	LDA.w #FXCODE_0BC6C5
	JSL.l !RAM_YI_Global_RT_00DECF
	SEP.b #$20
	RTS

CODE_118DBB:
	JSR.w CODE_119845
	LDY.w $1154
	LDA.w $1144
	BEQ.b CODE_118DCB
	DEC.w $1144
	BRA.b CODE_118DDB

CODE_118DCB:
	INY
	CPY.b #$04
	BCC.b CODE_118DD2
	LDY.b #$00
CODE_118DD2:
	STY.w $1154
	LDA.w DATA_118DE6,y
	STA.w $1144
CODE_118DDB:
	LDA.w DATA_118DE2,y
	STA.w $60BE
	RTS

DATA_118DE2:
	db $0D,$00,$4D,$00

DATA_118DE6:
	db $20,$06,$06,$06

CODE_118DEA:
	LDA.b #$20
	STA.b $00
	LDA.b #$04
	STA.b $02
	LDX.b #$00
	TXA
	JSR.w CODE_119073
	LDA.w $7182
	CMP.b #$B0
	BCC.b CODE_118E0D
	LDA.b #$B0
	STA.w $7182
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	STZ.w $1154
	STZ.w $1144
CODE_118E0D:
	LDA.w $1105
	BPL.b CODE_118E16
	LDA.b #$06
	BRA.b CODE_118E18

CODE_118E16:
	LDA.b #$07
CODE_118E18:
	STA.w $60BE
	RTS

CODE_118E1C:
	LDY.w $1154
	LDA.w $1144
	BEQ.b CODE_118E29
	DEC.w $1144
	BRA.b CODE_118E39

CODE_118E29:
	INY
	CPY.b #$11
	BCC.b CODE_118E30
	LDY.b #$10
CODE_118E30:
	STY.w $1154
	LDA.w DATA_118E6A,y
	STA.w $1144
CODE_118E39:
	LDA.w DATA_118E59,y
	STA.w $60BE
	CPY.b #$10
	BNE.b CODE_118E58
	LDA.w $70E2
	CLC
	ADC.b #$28
	STA.w $70EA
	LDA.w $7182
	CLC
	ADC.b #$24
	STA.w $718A
	JSR.w CODE_118F1F
CODE_118E58:
	RTS

DATA_118E59:
	db $74,$73,$72,$71,$70,$6F,$74,$73,$72,$71,$70,$6F,$6C,$6D,$6E,$6D
	db $6E

DATA_118E6A:
	db $03,$03,$03,$03,$03,$03,$03,$03,$03,$03,$03,$03,$03,$03,$03,$03
	db $03

CODE_118E7B:
	RTS

CODE_118E7C:
	LDA.w $10F2
	BEQ.b CODE_118E85
	LDY.b #$00
	BRA.b CODE_118EE4

CODE_118E85:
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror
	BNE.b CODE_118EB2
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror
	INC
	INC
	CMP.b #$1E
	BCC.b CODE_118E98
	LDA.b #$1E
CODE_118E98:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror
	LSR
	TAY
	LDA.w DATA_118F0F,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror
	CPY.b #$04
	BNE.b CODE_118EB2
	LDA.b #$FC
	STA.w $1105
	STZ.w $1104
	STZ.w $1124
CODE_118EB2:
	LDA.w $1105
	BNE.b CODE_118EBE
	LDA.w $7182
	CMP.b #$B0
	BEQ.b CODE_118EE1
CODE_118EBE:
	LDA.b #$20
	STA.b $00
	LDA.b #$04
	STA.b $02
	LDX.b #$00
	TXA
	JSR.w CODE_119073
	LDA.w $7182
	CMP.b #$B0
	BCC.b CODE_118EE1
	LDA.b #$B0
	STA.w $7182
	STZ.w $1105
	STZ.w $1104
	STZ.w $1124
CODE_118EE1:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror
CODE_118EE4:
	REP.b #$20
	LDA.w DATA_118EEF,y
	STA.w $60BE
	SEP.b #$20
	RTS

DATA_118EEF:
	dw $0000,$01AA,$01AC,$01AD,$01AB,$0021,$0022,$0023
	dw $0024,$0025,$0026,$0027,$01AC,$01AD,$01AC,$0000

DATA_118F0F:
	dw $2030,$0802,$030C,$0303,$0303,$2203,$0402,$FF02

CODE_118F1F:
	LDA.w $114C
	BEQ.b CODE_118F29
	DEC.w $114C
	BRA.b CODE_118F3B

CODE_118F29:
	INC.w $115C
	LDA.b #$03
	STA.w $114C
	LDA.w $115C
	CMP.b #$06
	BNE.b CODE_118F3B
	STZ.w $115C
CODE_118F3B:
	LDA.w $115C
	ASL
	ASL
	ASL
	TAX
	REP.b #$30
	LDA.w #$0004
	STA.b $00
	LDY.w $6092
CODE_118F4C:
	LDA.w DATA_118F7E,x
	CLC
	ADC.w $70EA
	STA.w $6000,y
	LDA.w #$FFE0
	CLC
	ADC.w $718A
	STA.w $6002,y
	LDA.w DATA_118FAE,x
	STA.w $6004,y
	LDA.w #$0000
	STA.w $6006,y
	INX
	INX
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEC.b $00
	BNE.b CODE_118F4C
	STY.w $6092
	SEP.b #$30
	RTS

DATA_118F7E:
	dw $FFEC,$FFEC,$FFF8,$FFE0,$FFEF,$FFE9,$FFF7,$FFE1
	dw $FFE2,$FFF2,$FFE6,$FFF6,$FFE4,$FFF4,$FFE4,$FFF4
	dw $FFE6,$FFF6,$FFE2,$FFF2,$FFE9,$FFF7,$FFE1,$FFEF

DATA_118FAE:
	dw $351A,$350A,$350A,$351A,$351A,$350A,$350A,$351A
	dw $351A,$351A,$350A,$350A,$351A,$351A,$350A,$350A
	dw $351A,$351A,$350A,$350A,$351A,$351A,$350A,$350A

CODE_118FDE:
	LDY.w $116A
	INC.w $1168
	LDA.w $1168
	CMP.w DATA_119055,y
	BCC.b CODE_118FF2
	STZ.w $1168
	INC.w $116A
CODE_118FF2:
	TYA
	ASL
	TAY
	LDA.w DATA_119002,y
	STA.b $00
	LDA.w DATA_119002+$01,y
	STA.b $01
	JMP.w ($0000)

DATA_119002:
	dw CODE_119014
	dw CODE_119034
	dw CODE_119034
	dw CODE_119014
	dw CODE_119014
	dw CODE_119034
	dw CODE_119034
	dw CODE_119014
	dw CODE_119014

CODE_119014:
	REP.b #$20
	LDA.w $1100
	SEC
	SBC.w DATA_11905F,y
	STA.w $1100
	LDA.w $10FE
	CLC
	ADC.w DATA_11905F,y
	CMP.w #$01FF
	BCC.b CODE_11902F
	LDA.w #$01FF
CODE_11902F:
	STA.w $10FE
	BRA.b CODE_119052

CODE_119034:
	REP.b #$20
	LDA.w $10FE
	SEC
	SBC.w DATA_11905F,y
	STA.w $10FE
	LDA.w $1100
	CLC
	ADC.w DATA_11905F,y
	CMP.w #$01FF
	BCC.b CODE_11904F
	LDA.w #$01FF
CODE_11904F:
	STA.w $1100
CODE_119052:
	SEP.b #$20
	RTS

DATA_119055:
	db $10,$13,$10,$10,$0E,$0E,$0E,$0E,$0E,$0E

DATA_11905F:
	dw $0006,$0005,$0004,$0004,$0004,$0004,$0004,$0003
	dw $0003,$0003

CODE_119073:
	PHA
	LDA.w $1124,x
	CLC
	ADC.w $1104,x
	STA.w $1124,x
	LDY.b #$00
	LDA.w $1105,x
	BPL.b CODE_119086
	DEY
CODE_119086:
	STY.b $07
	ADC.w $7182,x
	STA.w $7182,x
	LDA.w $7183,x
	ADC.b $07
	STA.w $7183,x
	LDA.w $1104,x
	CLC
	ADC.b $00
	STA.w $1104,x
	LDA.w $1105,x
	ADC.b #$00
	STA.w $1105,x
	CMP.b $02
	BMI.b CODE_1190BA
	LDA.w $1104,x
	CMP.b #$80
	BCC.b CODE_1190BA
	LDA.b $02
	STA.w $1105,x
	STZ.w $1104,x
CODE_1190BA:
	PLA
	BEQ.b CODE_1190EA
	LDA.b $02
	EOR.b #$FF
	INC
	STA.b $07
	LDA.w $1104,x
	SEC
	SBC.b $01
	STA.w $1104,x
	LDA.w $1105,x
	SBC.b #$00
	STA.w $1105,x
	CMP.b $07
	BPL.b CODE_1190EA
	LDA.w $1104,x
	CMP.b #$80
	BCS.b CODE_1190EA
	LDA.b $07
	STA.w $1105,x
	LDA.b #$FF
	STA.w $1104,x
CODE_1190EA:
	RTS

CODE_1190EB:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ASL
	ASL
	ASL
	ASL
	STA.b $01
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LSR
	LSR
	LSR
	LSR
	CMP.b #$08
	BCC.b CODE_119101
	ORA.b #$F0
CODE_119101:
	STA.b $00
	LDY.b #$00
	CMP.b #$00
	BPL.b CODE_11910A
	DEY
CODE_11910A:
	STY.b $02
	LDA.w $1134,x
	CLC
	ADC.b $01
	STA.w $1134,x
	LDA.b #$00
	ROL
	PHA
	ROR
	LDA.w $70E2,x
	ADC.b $00
	STA.w $70E2,x
	LDA.w $70E3,x
	ADC.b $02
	STA.w $70E3,x
	PLA
	CLC
	ADC.b $00
	RTS

CODE_11912F:
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_119168
CODE_119134:
	REP.b #$20
	LDA.w $1100
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w $10FE
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $1102
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #(FXDATA_548000+$40E1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #FXDATA_548000+$40E1
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STZ.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088945>>16
	LDA.w #FXCODE_088945
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	SEP.b #$30
CODE_119168:
	RTS

CODE_119169:
	REP.b #$30
	LDA.w $10E6
	BEQ.b CODE_119175
	LDA.w #$009E
	BRA.b CODE_119178

CODE_119175:
	LDA.w #$009D
CODE_119178:
	STA.b $00
	ASL
	CLC
	ADC.b $00
	TAX
	LDA.l DATA_06F95E,x
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.l DATA_06F95E+$02,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$4E00
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	SEP.b #$10
	LDX.b #FXCODE_08A980>>16
	LDA.w #FXCODE_08A980
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$30
	LDX.w #$704E00
	LDA.w #$704E00>>16
	STA.b $01
	LDY.w #$3C00
	LDA.w #$0800
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	RTS

; Bonus-game state-machine dispatcher. Jumps via DATA_1191D9 (3-entry
; pointer table) indexed by $10E2 to one of: CODE_11922A / CODE_1192B6 /
; CODE_1191DF. Called from the AmbSpr $22D popup-tail handler on first
; frame to advance the minigame scene. Does NOT itself award the 1up
; -- the 1up SFX was queued earlier by CODE_009A96 (=
; CODE_ambient_helper_init_1up_popup_state) at $22B's spawn site.
CODE_1191B8:
CODE_bonus_game_state_dispatcher:
	SEP.b #$20
	PHB
	LDA.b #DATA_1191D9>>16
	PHA
	PLB
	JSR.w CODE_1191C4
	PLB
	RTL

CODE_1191C4:
	SEP.b #$20
	LDA.w $10E2
	DEC
	ASL
	TAY
	LDA.w DATA_1191D9,y
	STA.b $00
	LDA.w DATA_1191D9+$01,y
	STA.b $01
	JMP.w ($0000)

DATA_1191D9:
	dw CODE_11922A
	dw CODE_1192B6
	dw CODE_1191DF

CODE_1191DF:
	REP.b #$20
	DEC.w !RAM_YI_Global_Layer2YPosLo
	INC.w !RAM_YI_Global_Layer2XPosLo
	LDA.w $10E6
	BNE.b CODE_1191FE
	LDA.w $10FA
	BEQ.b CODE_11920D
	LDA.w $03A7
	CMP.w #$0014
	BEQ.b CODE_1191FE
	LDA.w $60C0
	BNE.b CODE_11920D
CODE_1191FE:
	LDA.w #$0001
	STA.w $10F4
	DEC.w $10E4
	BNE.b CODE_11920D
	JSL.l CODE_11AD2A
CODE_11920D:
	SEP.b #$20
	LDA.w $10FC
	BEQ.b CODE_119229
	DEC.w $10FC
	BNE.b CODE_119229
	LDA.w $03A7
	CMP.b #$06
	BCC.b CODE_119229
	CMP.b #$14
	BCS.b CODE_119229
	LDA.b #!Define_YI_MusicID06_BonusAndBossTheme
	STA.w !RAM_YI_Global_PlayMusicLo
CODE_119229:
	RTS

CODE_11922A:
	JSR.w CODE_119169
	SEP.b #$20
	LDA.b #$42
	STA.w HDMA[$05].Parameters
	LDA.b #!REGISTER_BG2HorizScrollOffset
	STA.w HDMA[$05].Destination
	LDA.b #$7E5B98
	STA.w HDMA[$05].SourceLo
	LDA.b #$7E5B98>>8
	STA.w HDMA[$05].SourceHi
	LDA.b #$7E5B98>>16
	STA.w HDMA[$05].SourceBank
	LDA.b #$7E
	STA.w HDMA[$05].IndirectSourceBank
	PHB
	LDA.b #$7E5040>>16
	PHA
	PLB
	STZ.w $7E5040
	STZ.w $7E5042
	STZ.w $7E5BAD
	LDA.b #$20
	STA.w $7E5B98
	STA.w $7E5B9B
	STA.w $7E5B9E
	STA.w $7E5BA1
	STA.w $7E5BA4
	STA.w $7E5BA7
	STA.w $7E5BAA
	REP.b #$20
	LDA.w #$5040
	STA.w $7E5B99
	STA.w $7E5B9F
	STA.w $7E5BA5
	STA.w $7E5BAB
	LDA.w #$5042
	STA.w $7E5B9C
	STA.w $7E5BA2
	STA.w $7E5BA8
	SEP.b #$20
	PLB
	LDX.w $10E6
	LDA.w DATA_1192B3,x
	STA.w !RAM_YI_Global_PlayMusicLo
	LDA.b #$20
	TSB.w !RAM_YI_Global_HDMAEnable
	INC.w $10E2
	LDA.w $10F6
	BEQ.b CODE_1192AB
	JSR.w CODE_11942C
CODE_1192AB:
	JSR.w CODE_119305
	JSL.l CODE_119CCB
	RTS

DATA_1192B3:
	db $05,$07,$06

CODE_1192B6:
	REP.b #$20
	LDA.w $10E0
	CLC
	ADC.w #$0008
	STA.w $10E0
	CMP.w #$0100
	BCC.b CODE_119302
	SEP.b #$20
	LDA.w !RAM_YI_Global_HDMAEnable
	EOR.b #$20
	STA.w !RAM_YI_Global_HDMAEnable
	LDA.b #$01
	STA.w !RAM_YI_Global_Layer2XPosHi
	STZ.w !RAM_YI_Global_Layer2XPosLo
	LDA.b #$3C
	STA.w !RAM_YI_Global_BG2AddressAndSize
	STA.w !REGISTER_BG2AddressAndSize
	INC.w $10E2
	LDA.w $10E6
	BNE.b CODE_1192F4
	LDA.w $03A7
	CMP.b #$06
	BCC.b CODE_1192F4
	CMP.b #$14
	BCC.b CODE_1192F8
CODE_1192F4:
	LDA.b #$E0
	BRA.b CODE_1192FA

CODE_1192F8:
	LDA.b #$01
CODE_1192FA:
	STA.w $10E4
	LDA.b #$FF
	STA.w $10FC
CODE_119302:
	SEP.b #$20
	RTS

CODE_119305:
	REP.b #$30
	LDA.l $7E4000
	TAX
	LDA.w $10F2
	BEQ.b CODE_119314
	LDA.w #$0003
CODE_119314:
	CLC
	ADC.w $10E6
	ASL
	TAY
	LDA.w DATA_119336,y
	TAY
CODE_11931E:
	LDA.w DATA_119340,y
	STA.l $7E4002,x
	INX
	INX
	INY
	INY
	INC
	BNE.b CODE_11931E
	DEX
	DEX
	TXA
	STA.l $7E4000
	SEP.b #$30
	RTS

DATA_119336:
	dw $0000,$00BA,$00EC,$002E,$0074

DATA_119340:
	db $AC,$35,$11,$00,$20,$25,$21,$25,$22,$25,$7F,$21,$23,$25,$24,$25
	db $32,$E5,$7F,$25,$30,$A5,$CC,$35,$11,$00,$30,$25,$21,$A5,$21,$A5
	db $7F,$21,$33,$25,$34,$25,$32,$25,$7F,$25,$29,$25,$FF,$FF,$A9,$35
	db $1D,$00,$27,$25,$25,$25,$21,$25,$20,$25,$26,$25,$27,$25,$7F,$21
	db $4E,$25,$7F,$21,$23,$25,$24,$25,$32,$E5,$31,$E5,$7F,$21,$30,$A5
	db $C9,$35,$1D,$00,$39,$25,$35,$25,$36,$25,$30,$25,$35,$25,$37,$25
	db $7F,$21,$5E,$25,$7F,$21,$33,$25,$34,$25,$32,$25,$31,$25,$7F,$21
	db $29,$25,$FF,$FF,$AA,$35,$1D,$00,$27,$2D,$25,$2D,$21,$2D,$20,$2D
	db $26,$2D,$27,$2D,$7F,$21,$4F,$2D,$7F,$21,$23,$2D,$24,$2D,$32,$ED
	db $31,$ED,$7F,$21,$30,$AD,$CA,$35,$1D,$00,$39,$2D,$35,$2D,$36,$2D
	db $30,$2D,$35,$2D,$37,$2D,$7F,$21,$5F,$2D,$7F,$21,$33,$2D,$34,$2D
	db $32,$2D,$31,$2D,$7F,$21,$29,$2D,$FF,$FF,$AC,$35,$13,$00,$20,$2D
	db $21,$2D,$22,$2D,$7F,$21,$25,$2D,$21,$2D,$31,$ED,$26,$2D,$7F,$21
	db $30,$AD,$CC,$35,$13,$00,$30,$2D,$21,$AD,$21,$AD,$7F,$21,$35,$2D
	db $21,$AD,$31,$2D,$35,$2D,$7F,$21,$29,$2D,$FF,$FF

CODE_11942C:
	LDA.w $1170
	SEC
	SBC.b #$03
	ASL
	TAX
	REP.b #$30
	LDA.w DATA_119457,x
	TAY
	LDA.l $7E4000
	TAX
CODE_11943F:
	LDA.w DATA_11945D,y
	STA.l $7E4002,x
	INX
	INX
	INY
	INY
	INC
	BNE.b CODE_11943F
	DEX
	DEX
	TXA
	STA.l $7E4000
	SEP.b #$30
	RTS

DATA_119457:
	dw $0000,$005E,$00CC

DATA_11945D:
	db $C5,$34,$07,$80,$55,$A5,$45,$25,$45,$25,$45,$25,$DA,$34,$07,$80
	db $55,$E5,$45,$65,$45,$65,$45,$65,$C6,$34,$27,$40,$56,$A5,$47,$35
	db $23,$40,$60,$25,$67,$35,$23,$40,$60,$25,$E7,$68,$23,$40,$FF,$00
	db $07,$69,$23,$40,$FF,$00,$27,$69,$23,$40,$FF,$00,$45,$35,$03,$00
	db $65,$25,$66,$25,$65,$35,$03,$00,$55,$25,$76,$25,$59,$35,$03,$00
	db $72,$65,$70,$65,$79,$35,$03,$00,$74,$65,$73,$65,$FF,$FF,$C3,$34
	db $07,$80,$55,$A5,$45,$25,$45,$25,$45,$25,$DC,$34,$07,$80,$55,$E5
	db $45,$65,$45,$65,$45,$65,$C4,$34,$2F,$40,$56,$A5,$45,$35,$27,$40
	db $60,$25,$65,$35,$27,$40,$60,$25,$E5,$68,$2B,$40,$FF,$00,$05,$69
	db $2B,$40,$FF,$00,$25,$69,$2B,$40,$FF,$00,$43,$35,$07,$00,$70,$25
	db $71,$25,$67,$25,$66,$25,$63,$35,$07,$00,$73,$25,$74,$25,$75,$25
	db $76,$25,$59,$35,$07,$00,$72,$65,$71,$25,$71,$25,$70,$65,$79,$35
	db $07,$00,$74,$65,$74,$25,$74,$25,$73,$65,$FF,$FF,$C1,$34,$07,$80
	db $55,$A5,$45,$25,$45,$25,$45,$25,$DE,$34,$07,$80,$55,$E5,$45,$65
	db $45,$65,$45,$65,$C2,$34,$37,$40,$56,$A5,$43,$35,$2B,$40,$60,$25
	db $63,$35,$2B,$40,$60,$25,$E3,$68,$33,$40,$FF,$00,$03,$69,$33,$40
	db $FF,$00,$23,$69,$33,$40,$FF,$00,$41,$35,$0B,$00,$70,$25,$71,$25
	db $71,$25,$71,$25,$67,$25,$66,$25,$61,$35,$0B,$00,$73,$25,$74,$25
	db $74,$25,$74,$25,$75,$25,$76,$25,$59,$35,$0B,$00,$72,$65,$71,$25
	db $71,$25,$71,$25,$71,$25,$70,$65,$79,$35,$0B,$00,$74,$65,$74,$25
	db $74,$25,$74,$25,$74,$25,$73,$65,$FF,$FF

CODE_1195A7:
	REP.b #$20
	LDA.w $118C
	STA.w $116C
	STZ.w $1190
	LDA.w #$0048
	STA.w $1192
	STZ.w $116E
	JSR.w CODE_119BF4
	REP.b #$20
	LDA.w $1170
	ASL
	TAX
CODE_1195C5:
	JSL.l CODE_random_number_gen
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.w #$000E
	TAY
	LDA.w DATA_1196B7,y
	CMP.w $1174,x
	BEQ.b CODE_1195C5
	STA.w $1172,x
	LDA.w DATA_1196C7,y
	STA.w $117E,x
	DEX
	DEX
	BPL.b CODE_1195C5
	SEP.b #$20
	RTS

CODE_1195E8:
	REP.b #$30
	LDX.w $1170
	LDA.w DATA_119767,x
	AND.w #$00FF
	STA.b $0A
	LDA.l $7E4000
	TAX
	LDA.w #$68A4
	CLC
	ADC.b $0A
	STA.l $7E4002,x
	LDA.w $1170
	INC
	ASL
	ASL
	DEC
	ASL
	DEC
	ORA.w #$4000
	STA.l $7E4004,x
	LDA.w #$31DF
	STA.l $7E4006,x
	TXA
	CLC
	ADC.w #$0006
	TAX
	LDY.w #$0000
CODE_119624:
	TYA
	ASL
	ASL
	CLC
	ADC.w #$6884
	CLC
	ADC.b $0A
	STA.l $7E4002,x
	CLC
	ADC.w #$0020
	STA.l $7E400C,x
	CLC
	ADC.w #$0020
	STA.l $7E4016,x
	LDA.w #$0005
	STA.l $7E4004,x
	STA.l $7E400E,x
	STA.l $7E4018,x
	PHY
	TYA
	ASL
	TAY
	LDA.w $117E,y
	TAY
	LDA.w DATA_1196D7,y
	STA.l $7E4006,x
	LDA.w DATA_1196D7+$02,y
	STA.l $7E4008,x
	LDA.w DATA_1196D7+$04,y
	STA.l $7E400A,x
	LDA.w DATA_1196D7+$06,y
	STA.l $7E4010,x
	LDA.w DATA_1196D7+$08,y
	STA.l $7E4012,x
	LDA.w DATA_1196D7+$0A,y
	STA.l $7E4014,x
	LDA.w DATA_1196D7+$0C,y
	STA.l $7E401A,x
	LDA.w DATA_1196D7+$0E,y
	STA.l $7E401C,x
	LDA.w DATA_1196D7+$10,y
	STA.l $7E401E,x
	PLY
	TXA
	CLC
	ADC.w #$001E
	TAX
	CPY.w $1170
	BEQ.b CODE_1196A8
	INY
	JMP.w CODE_119624

CODE_1196A8:
	LDA.w #$FFFF
	STA.l $7E4002,x
	TXA
	STA.l $7E4000
	SEP.b #$30
	RTS

DATA_1196B7:
	dw $0100,$0200,$0400,$0800,$8000,$4000,$0080,$0040

DATA_1196C7:
	dw $0000,$0012,$0024,$0036,$0048,$005A,$006C,$007E

DATA_1196D7:
	dw $3DCC,$3DCD,$75CC,$3DDC,$3DDD,$75DC,$BDCC,$BDCD
	dw $F5CC,$35CC,$3DCD,$7DCC,$35DC,$3DDD,$7DDC,$B5CC
	dw $BDCD,$FDCC,$3DCC,$3DCD,$7DCC,$3DDC,$3DDD,$7DDC
	dw $B5CC,$B5CD,$F5CC,$35CC,$35CD,$75CC,$3DDC,$3DDD
	dw $7DDC,$BDCC,$BDCD,$FDCC,$29CE,$29CF,$69CE,$29DE
	dw $29EF,$69DE,$A9CE,$A9CF,$E9CE,$2DCE,$2DCF,$6DCE
	dw $2DDE,$2DFE,$6DDE,$ADCE,$ADCF,$EDCE,$35CE,$35CF
	dw $75CE,$35DE,$35EE,$75DE,$B5CE,$B5CF,$F5CE,$31CE
	dw $31CF,$71CE,$31DE,$31FF,$71DE,$B1CE,$B1CF,$F1CE

DATA_119767:
	dw $0000,$6400,$6062

CODE_11976D:
	REP.b #$30
	LDX.w $1170
	LDA.w DATA_119767,x
	AND.w #$00FF
	STA.b $0A
	LDA.l $7E4000
	TAX
	LDA.w #$68A4
	CLC
	ADC.b $0A
	STA.l $7E4002,x
	LDA.w $1170
	INC
	ASL
	ASL
	DEC
	ASL
	DEC
	ORA.w #$4000
	STA.l $7E4004,x
	LDA.w #$31DF
	STA.l $7E4006,x
	TXA
	CLC
	ADC.w #$0006
	TAX
	LDY.w #$0000
CODE_1197A9:
	TYA
	ASL
	ASL
	CLC
	ADC.w #$6884
	CLC
	ADC.b $0A
	STA.l $7E4002,x
	CLC
	ADC.w #$0020
	STA.l $7E400C,x
	CLC
	ADC.w #$0020
	STA.l $7E4016,x
	LDA.w #$0005
	STA.l $7E4004,x
	STA.l $7E400E,x
	STA.l $7E4018,x
	LDA.w DATA_119833
	STA.l $7E4006,x
	LDA.w DATA_119833+$02
	STA.l $7E4008,x
	LDA.w DATA_119833+$04
	STA.l $7E400A,x
	LDA.w DATA_119833+$06
	STA.l $7E4010,x
	LDA.w DATA_119833+$08
	STA.l $7E4012,x
	LDA.w DATA_119833+$0A
	STA.l $7E4014,x
	LDA.w DATA_119833+$0C
	STA.l $7E401A,x
	LDA.w DATA_119833+$0E
	STA.l $7E401C,x
	LDA.w DATA_119833+$10
	STA.l $7E401E,x
	TXA
	CLC
	ADC.w #$001E
	TAX
	CPY.w $1170
	BEQ.b CODE_119824
	INY
	JMP.w CODE_1197A9

CODE_119824:
	LDA.w #$FFFF
	STA.l $7E4002,x
	TXA
	STA.l $7E4000
	SEP.b #$30
	RTS

DATA_119833:
	dw $75ED,$35EC,$35ED,$35FB,$35FC,$35FD,$34FF,$35EB
	dw $34FF

CODE_119845:
	LDA.w $118A
	BEQ.b CODE_119859
	DEC.w $118A
	BNE.b CODE_119855
	STZ.w $116E
	JSR.w CODE_1195E8
CODE_119855:
	JSR.w CODE_119B79
	RTS

CODE_119859:
	JSR.w CODE_119B99
	REP.b #$20
	DEC.w $116C
	BNE.b CODE_119887
CODE_119863:
	LDA.w #!Define_YI_SoundID90_Incorrect
	JSL.l CODE_push_sound_queue
	LDA.w #$0020
	STA.w $118A
	LDA.w $118C
	STA.w $116C
	REP.b #$20
	LDA.w #$0048
	STA.w $1192
	STZ.w $1190
	JSR.w CODE_119BF4
	JMP.w CODE_1198FF

CODE_119887:
	JSR.w CODE_119AC6
	REP.b #$20
	LDA.w $116E
	ASL
	TAX
	LDA.b $37
	BEQ.b CODE_1198FF
	CMP.w $1172,x
	BNE.b CODE_119863
	LDA.w #!Define_YI_SoundID8F_Correct
	JSL.l CODE_push_sound_queue
	INC.w $116E
	LDA.w $1170
	CMP.w $116E
	BCC.b CODE_1198B1
	JSR.w CODE_119902
	BRA.b CODE_1198FF

CODE_1198B1:
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_SoundID08_1up
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_SoundID34_BurtJump
	JSL.l CODE_push_sound_queue
	SEP.b #$20
	LDA.b #$02
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror
	LDA.b #$01
	STA.w $797C
	STZ.w $1144
	STZ.w $1154
	LDA.b #$FD
	STA.w $1105
	LDA.b #$FD
	STA.w $1109
	STZ.w $1104
	STZ.w $1108
	STZ.w $1124
	STZ.w $1128
	LDA.b #$10
	STA.w $7224
	STZ.w $1138
	STZ.w $1168
	STZ.w $116A
	JSR.w CODE_11942C
CODE_1198FF:
	SEP.b #$20
	RTS

CODE_119902:
	REP.b #$30
	LDA.w $1170
	DEC
	DEC
	DEC
	ASL
	STA.b $00
	ASL
	ASL
	CLC
	ADC.b $00
	STA.b $00
	LDA.w $116E
	DEC
	ASL
	CLC
	ADC.b $00
	TAY
	LDA.l $7E4000
	TAX
	LDA.w DATA_1199DA,y
	STA.l $7E4002,x
	CLC
	ADC.w #$0020
	STA.l $7E400C,x
	CLC
	ADC.w #$0020
	STA.l $7E4016,x
	LDA.w #$0005
	STA.l $7E4004,x
	STA.l $7E400E,x
	STA.l $7E4018,x
	LDA.w $116E
	DEC
	ASL
	TAY
	LDA.w $117E,y
	TAY
	LDA.w DATA_1196D7,y
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E4006,x
	LDA.w DATA_1196D7+$02,y
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E4008,x
	LDA.w DATA_1196D7+$04,y
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E400A,x
	LDA.w DATA_1196D7+$06,y
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E4010,x
	LDA.w DATA_1196D7+$08,y
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E4012,x
	LDA.w DATA_1196D7+$0A,y
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E4014,x
	LDA.w DATA_1196D7+$0C,y
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E401A,x
	LDA.w DATA_1196D7+$0E,y
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E401C,x
	LDA.w DATA_1196D7+$10,y
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E401E,x
	LDA.w #$FFFF
	STA.l $7E4020,x
	TXA
	CLC
	ADC.w #$001E
	STA.l $7E4000
	SEP.b #$30
	RTS

DATA_1199DA:
	dw $68E8,$68EC,$68F0,$0000,$0000,$68E6,$68EA,$68EE
	dw $68F2,$0000,$68E4,$68E8,$68EC,$68F0,$68F4

CODE_1199F8:
	REP.b #$30
	LDA.w $1170
	DEC
	DEC
	DEC
	ASL
	STA.b $00
	ASL
	ASL
	CLC
	ADC.b $00
	STA.b $00
	LDA.w $116E
	DEC
	ASL
	CLC
	ADC.b $00
	TAY
	LDA.l $7E4000
	TAX
	LDA.w DATA_1199DA,y
	STA.l $7E4002,x
	CLC
	ADC.w #$0020
	STA.l $7E400C,x
	CLC
	ADC.w #$0020
	STA.l $7E4016,x
	LDA.w #$0005
	STA.l $7E4004,x
	STA.l $7E400E,x
	STA.l $7E4018,x
	LDA.w DATA_119833
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E4006,x
	LDA.w DATA_119833+$02
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E4008,x
	LDA.w DATA_119833+$04
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E400A,x
	LDA.w DATA_119833+$06
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E4010,x
	LDA.w DATA_119833+$08
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E4012,x
	LDA.w DATA_119833+$0A
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E4014,x
	LDA.w DATA_119833+$0C
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E401A,x
	LDA.w DATA_119833+$0E
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E401C,x
	LDA.w DATA_119833+$10
	AND.w #$E3FF
	ORA.w #$1800
	STA.l $7E401E,x
	LDA.w #$FFFF
	STA.l $7E4020,x
	TXA
	CLC
	ADC.w #$001E
	STA.l $7E4000
	SEP.b #$30
	RTS

CODE_119AC6:
	JSR.w CODE_119ACC
	JMP.w CODE_119B1E

CODE_119ACC:
	REP.b #$30
	LDY.w $6092
	LDA.w $1170
	DEC
	DEC
	DEC
	ASL
	TAX
	LDA.w DATA_119B73,x
	STA.b $00
	LDA.w $116E
	ASL
	ASL
	ASL
	ASL
	ASL
	CLC
	ADC.b $00
	STA.w $6000,y
	STA.w $6010,y
	CLC
	ADC.w #$0008
	STA.w $6008,y
	STA.w $6018,y
	LDA.w $118A
	BNE.b CODE_119B0A
	LDA.b $30
	AND.w #$0010
	BEQ.b CODE_119B0A
	LDA.w #$0026
	BRA.b CODE_119B0D

CODE_119B0A:
	LDA.w #$0024
CODE_119B0D:
	STA.w $6002,y
	STA.w $600A,y
	CLC
	ADC.w #$0008
	STA.w $6012,y
	STA.w $601A,y
	RTS

CODE_119B1E:
	LDA.b $30
	AND.w #$0010
	BNE.b CODE_119B3F
	LDA.w #$3300
	STA.w $6004,y
	ORA.w #$0010
	STA.w $6014,y
	LDA.w #$7300
	STA.w $600C,y
	ORA.w #$0010
	STA.w $601C,y
	BRA.b CODE_119B57

CODE_119B3F:
	LDA.w #$3300
	STA.w $6004,y
	ORA.w #$0011
	STA.w $6014,y
	LDA.w #$7300
	STA.w $600C,y
	ORA.w #$0011
	STA.w $601C,y
CODE_119B57:
	REP.b #$30
	LDA.w #$0000
	STA.w $6006,y
	STA.w $600E,y
	STA.w $6016,y
	STA.w $601E,y
	TYA
	CLC
	ADC.w #$0020
	STA.w $6092
	SEP.b #$30
	RTS

DATA_119B73:
	dw $0044,$0034,$0024

CODE_119B79:
	JSR.w CODE_119ACC
	REP.b #$30
	LDA.w #$3901
	STA.w $6004,y
	LDA.w #$7901
	STA.w $600C,y
	LDA.w #$B901
	STA.w $6014,y
	LDA.w #$F901
	STA.w $601C,y
	JMP.w CODE_119B57

CODE_119B99:
	INC.w $1191
	REP.b #$30
	LDA.w $1190
	SEC
	SBC.w $118E
	BMI.b CODE_119BE9
	STA.w $1190
	DEC.w $1192
	LDA.l $7E4000
	TAX
	LDA.w #$0047
	SEC
	SBC.w $1192
	LSR
	LSR
	CLC
	ADC.w #$3547
	STA.l $7E4002,x
	LDA.w #$0001
	STA.l $7E4004,x
	LDA.w $1192
	AND.w #$0003
	ASL
	TAY
	LDA.w DATA_119BEC,y
	STA.l $7E4006,x
	LDA.w #$FFFF
	STA.l $7E4008,x
	TXA
	CLC
	ADC.w #$0006
	STA.l $7E4000
CODE_119BE9:
	SEP.b #$30
	RTS

DATA_119BEC:
	dw $2564,$2563,$2562,$2561

CODE_119BF4:
	REP.b #$30
	LDY.w #$0000
	LDA.l $7E4000
	TAX
CODE_119BFE:
	LDA.w DATA_119C1F,y
	STA.l $7E4002,x
	INX
	INX
	INY
	INY
	INC
	BNE.b CODE_119BFE
	DEX
	DEX
	TXA
	STA.l $7E4000
	LDA.w #$0048
	STA.w $1192
	STZ.w $1190
	SEP.b #$30
	RTS

DATA_119C1F:
	dw $3547,$4023,$2556,$FFFF

CODE_119C27:
	LDX.b #$00
CODE_119C29:
	LDA.w DATA_119CC4,x
	STA.l $7E5B18,x
	BEQ.b CODE_119C35
	INX
	BRA.b CODE_119C29

CODE_119C35:
	REP.b #$30
	LDX.w #$007E
	LDA.w #$00FF
CODE_119C3D:
	STA.l $7E552C,x
	STA.l $7E55AC,x
	STA.l $7E562C,x
	STA.l $7E56AC,x
	DEX
	DEX
	BPL.b CODE_119C3D
	SEP.b #$20
	LDX.w #((!REGISTER_Window1LeftPositionDesignation&$0000FF)<<8)+$41
	STX.w HDMA[$03].Parameters
	LDX.w #$7E5B18
	STX.w HDMA[$03].SourceLo
	LDA.b #$7E5B18>>16
	STA.w HDMA[$03].SourceBank
	LDA.b #$7E
	STA.w HDMA[$03].IndirectSourceBank
	LDA.b #$30
	STA.w !RAM_YI_Global_BG1And2WindowMaskSettings
	LDA.b #$30
	STA.w !RAM_YI_Global_BG3And4WindowMaskSettings
	LDA.b #$20
	STA.w !RAM_YI_Global_ObjectAndColorWindowSettings
	LDA.b #$00
	STA.w !RAM_YI_Global_MainScreenWindowMask
	LDA.b #$00
	STA.w !RAM_YI_Global_SubScreenWindowMask
	LDA.b #$17
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.b #$02
	STA.w !RAM_YI_Global_SubScreenLayers
	LDA.b #$10
	STA.w !RAM_YI_Global_ColorMathInitialSettings
	LDA.b #$72
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	REP.b #$20
	LDA.w $1170
	SEC
	SBC.w #$0003
	ASL
	TAX
	LDA.w DATA_119CBE,x
	LDX.w #$0058
CODE_119CA7:
	STA.l $7E552C,x
	INX
	INX
	CPX.w #$00A0
	BNE.b CODE_119CA7
	LDA.w !RAM_YI_Global_HDMAEnable
	ORA.w #$0008
	STA.w !RAM_YI_Global_HDMAEnable
	SEP.b #$30
	RTL

DATA_119CBE:
	db $30,$D0,$20,$E0,$10,$F0

DATA_119CC4:
	db $F8,$2C,$55,$F8,$1C,$56,$00

CODE_119CCB:
	LDX.b #$00
CODE_119CCD:
	LDA.w DATA_119CC4,x
	STA.l $7E5B18,x
	BEQ.b CODE_119CD9
	INX
	BRA.b CODE_119CCD

CODE_119CD9:
	REP.b #$30
	LDX.w #$007E
	LDA.w #$00FF
CODE_119CE1:
	STA.l $7E552C,x
	STA.l $7E55AC,x
	STA.l $7E562C,x
	STA.l $7E56AC,x
	DEX
	DEX
	BPL.b CODE_119CE1
	SEP.b #$20
	LDX.w #((!REGISTER_Window1LeftPositionDesignation&$0000FF)<<8)+$41
	STX.w HDMA[$03].Parameters
	LDX.w #$7E5B18
	STX.w HDMA[$03].SourceLo
	LDA.b #$7E5B18>>16
	STA.w HDMA[$03].SourceBank
	LDA.b #$7E
	STA.w HDMA[$03].IndirectSourceBank
	LDA.b #$30
	STA.w !RAM_YI_Global_BG1And2WindowMaskSettings
	LDA.b #$30
	STA.w !RAM_YI_Global_BG3And4WindowMaskSettings
	LDA.b #$20
	STA.w !RAM_YI_Global_ObjectAndColorWindowSettings
	LDA.b #$00
	STA.w !RAM_YI_Global_MainScreenWindowMask
	LDA.b #$00
	STA.w !RAM_YI_Global_SubScreenWindowMask
	LDA.b #$17
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.b #$02
	STA.w !RAM_YI_Global_SubScreenLayers
	LDA.b #$10
	STA.w !RAM_YI_Global_ColorMathInitialSettings
	STZ.w !RAM_YI_Global_ColorMathSelectAndEnable
	REP.b #$20
	LDA.w #$7F94
	STA.w $0948
	LDA.w #$FF00
	LDX.w #$0000
CODE_119D46:
	STA.l $7E552C,x
	INX
	INX
	CPX.w #$01C0
	BNE.b CODE_119D46
	LDA.w #$0028
	STA.w !RAM_YI_Global_HDMAEnable
	SEP.b #$30
	RTL

CODE_119D5A:
	REP.b #$30
	LDX.w #$007E
	LDA.w #$00FF
CODE_119D62:
	STA.l $7E552C,x
	STA.l $7E55AC,x
	STA.l $7E562C,x
	STA.l $7E56AC,x
	DEX
	DEX
	BPL.b CODE_119D62
	SEP.b #$30
	LDA.w !RAM_YI_Global_ObjectAndColorWindowSettings
	EOR.b #$03
	STA.w !RAM_YI_Global_ObjectAndColorWindowSettings
	LDA.w !RAM_YI_Global_MainScreenWindowMask
	EOR.b #$10
	STA.w !RAM_YI_Global_MainScreenWindowMask
	LDA.w !RAM_YI_Global_HDMAEnable
	AND.b #$F7
	STA.w !RAM_YI_Global_HDMAEnable
	RTL

;-------------------------------------------------------------------------
; CODE_init_mini_battle_pop_balloons_left / CODE_init_mini_battle_pop_balloons_right -- Per-variant init for the popping-balloons
; mini-battle (gm2e/gm30 sub-mode slots 5 and 6 in DATA_bandit_minigame_init_ptrs). The two
; entry points just seed $113C with 0 vs 1 (left/right facing variant)
; then drop into the shared init body at CODE_119D9D. Spawns 2x sprite
; $1B4 (CheckeredPlatform), 10x sprite $1B6 (Balloon), and 1x sprite
; $1B5 (PoppingBalloonsBandit) to populate the arena.
;-------------------------------------------------------------------------
CODE_init_mini_battle_pop_balloons_left:
CODE_119D91:
	REP.b #$20
	LDA.w #$0000
	BRA.b CODE_119D9D

CODE_init_mini_battle_pop_balloons_right:
CODE_119D98:
	REP.b #$20
	LDA.w #$0001
CODE_119D9D:
	STA.w $113C
	REP.b #$20
	STZ.b !RAM_YI_Global_Layer1XPosLo
	STZ.b !RAM_YI_Global_Layer1YPosLo
	STZ.b !RAM_YI_Global_Layer2XPosLo
	LDA.w #$0017
	STA.b !RAM_YI_Global_Layer2YPosLo
	STZ.b !RAM_YI_Global_Layer3XPosLo
	STZ.b !RAM_YI_Global_Layer3YPosLo
	SEP.b #$20
	LDA.w !RAM_YI_Global_BG1AddressAndSize
	EOR.b #$03
	STA.w !RAM_YI_Global_BG1AddressAndSize
	STA.w !REGISTER_BG1AddressAndSize
	LDA.w !RAM_YI_Global_BG2AddressAndSize
	EOR.b #$03
	STA.w !RAM_YI_Global_BG2AddressAndSize
	STA.w !REGISTER_BG2AddressAndSize
	REP.b #$30
	LDA.w #$00B0
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w $1144
	LDA.w #$0020
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $1142
	STZ.w $6CAA
	STA.w !RAM_YI_Level_StarTimerLo
	LDX.w #$01FE
	LDA.w #$0000
CODE_119DE9:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	DEX
	DEX
	BPL.b CODE_119DE9
	LDX.w #$001E
	LDA.w #$0100
CODE_119DF7:
	STA.l $7F81A0,x
	DEX
	DEX
	BPL.b CODE_119DF7
	LDX.w #$0160
CODE_119E02:
	LDA.w #$0100
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	STA.l $7F801E,x
	TXA
	SEC
	SBC.w #$0020
	TAX
	BNE.b CODE_119E02
	LDX.w #$0018
	LDA.w #$3800
CODE_119E1B:
	STA.l $7F80A0,x
	DEX
	DEX
	CPX.w #$0006
	BCS.b CODE_119E1B
	LDA.w #$0100
	STA.l $7F8002
	STA.l $7F8004
	STA.l $7F801A
	STA.l $7F801C
	STZ.w !RAM_YI_Global_ColorMathSelectAndEnable
	SEP.b #$10
	LDA.w #$01B4
	JSL.l CODE_spawn_sprite_init
	LDA.w #$01B4
	JSL.l CODE_spawn_sprite_init
	LDX.b #$0A
CODE_119E4E:
	LDA.w #$01B6
	JSL.l CODE_spawn_sprite_init
	DEX
	BNE.b CODE_119E4E
	LDA.w #$01B5
	JSL.l CODE_spawn_sprite_init
	STZ.w $1132
	LDA.w #$0100
	STA.w $1134
	STA.w $1136
	LDX.b #$00
	LDA.w #$F000
	STA.w $7ECE
	STA.w $7ECC
	JSR.w CODE_11A008
	SEP.b #$30
	JSL.l CODE_handle_sprites
	LDA.b #$09
	STA.w !RAM_YI_Global_BGModeAndTileSizeSetting
	STZ.w !RAM_YI_Global_ColorMathSelectAndEnable
	RTS

;-------------------------------------------------------------------------
; CODE_main_mini_battle_pop_balloons -- Per-variant main tick for the popping-balloons mini-battle
; (gm2e/gm30 sub-mode slots 5 and 6 in DATA_mini_battle_main_ptrs). Each frame: clears
; OAM, latches the player coords for the bandit's projectile AI, and
; advances per-sub-state from $7E:1104 with the standard render+SuperFX
; pipeline.
;-------------------------------------------------------------------------
CODE_main_mini_battle_pop_balloons:
CODE_119E88:
	JSL.l CODE_init_oam_buffer
	REP.b #$20
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $1142
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w $1144
	LDA.w $1104
	BEQ.b CODE_119ED0
	LDA.w $60FC
	AND.w #$0001
	EOR.w #$0001
	ORA.w $60AA
	BEQ.b CODE_119EC1
	STZ.w $0035
	STZ.w $0036
	STZ.w $0037
	STZ.w $0038
	LDA.w #$006B
	STA.w $60BE
	BRA.b CODE_119ED0

CODE_119EC1:
	STZ.w $1104
	LDA.w #$0096
	STA.w $61D6
	STZ.w $60A8
	STZ.w $60B4
CODE_119ED0:
	LDA.w $61D6
	CMP.w #$0080
	BCS.b CODE_119EDB
	STZ.w $61D6
CODE_119EDB:
	SEP.b #$20
	JSL.l CODE_spr_edge_despawn_draw
	JSL.l CODE_04FA67
	LDA.w $10F4
	BNE.b CODE_119EF1
	JSR.w CODE_119F13
	JSL.l CODE_04DD9E
CODE_119EF1:
	LDA.w $1104
	BNE.b CODE_119EF9
	JSR.w CODE_119F89
CODE_119EF9:
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_119F05
	JSL.l CODE_handle_sprites
	JSR.w CODE_119F40
CODE_119F05:
	REP.b #$20
	LDX.b #FXCODE_08B1EF>>16
	LDA.w #FXCODE_08B1EF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	RTS

CODE_119F13:
	REP.b #$20
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	BPL.b CODE_119F3D
	CMP.w #$FFF0
	BCS.b CODE_119F3D
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CMP.w #$0030
	BCS.b CODE_119F2F
	STZ.w $60A8
	LDA.w #$0030
	BRA.b CODE_119F3A

CODE_119F2F:
	CMP.w #$00C1
	BCC.b CODE_119F3A
	STZ.w $60A8
	LDA.w #$00C0
CODE_119F3A:
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_119F3D:
	SEP.b #$20
	RTS

CODE_119F40:
	REP.b #$20
	LDA.w $10F4
	BEQ.b CODE_119F48
	RTS

CODE_119F48:
	LDA.w $0030
	AND.w #$000F
	BNE.b CODE_119F85
	LDA.w $113A
	BNE.b CODE_119F6E
	DEC.w $1134
	INC.w $1136
	LDA.w $1136
	CMP.w #$0101
	BCC.b CODE_119F85
	LDA.w $113A
	EOR.w #$0001
	STA.w $113A
	BRA.b CODE_119F85

CODE_119F6E:
	INC.w $1134
	DEC.w $1136
	LDA.w $1134
	CMP.w #$0101
	BCC.b CODE_119F85
	LDA.w $113A
	EOR.w #$0001
	STA.w $113A
CODE_119F85:
	JSR.w CODE_11A008
	RTS

CODE_119F89:
	REP.b #$20
	LDA.w $60AA
	BMI.b CODE_119FCF
	LDA.w $60D4
	BNE.b CODE_119FA3
	LDA.w #$0004
	STA.b $00
	JSR.w CODE_119FD2
	CPY.b #$00
	BEQ.b CODE_119FCF
	BRA.b CODE_119FAF

CODE_119FA3:
	LDA.w #$0008
	STA.b $00
	JSR.w CODE_119FD2
	CPY.b #$00
	BEQ.b CODE_119FCF
CODE_119FAF:
	LDA.w $7182,y
	SEC
	SBC.w #$0020
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $72C0,y
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w #$0001
	STA.w $61B4
	LDA.w #$0400
	STA.w $60AA
CODE_119FCF:
	SEP.b #$20
	RTS

CODE_119FD2:
	LDY.b #$00
	LDX.w $1100
	JSR.w CODE_119FDD
	LDX.w $1102
CODE_119FDD:
	LDA.w $70E2,x
	SEC
	SBC.w #$000C
	CMP.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BCS.b CODE_11A007
	CLC
	ADC.w #$0028
	CMP.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BCC.b CODE_11A007
	LDA.w $7182,x
	SEC
	SBC.w #$0020
	CMP.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	BCS.b CODE_11A007
	CLC
	ADC.b $00
	CMP.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	BCC.b CODE_11A007
	TXY
CODE_11A007:
	RTS

CODE_11A008:
	LDA.w $1132
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $1134
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $1136
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.l DATA_03A9CE
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #FXDATA_548000+$40E1
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$40E1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_0884A5>>16
	LDA.w #FXCODE_0884A5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	RTS

CODE_11A041:
	LDA.l DATA_03A9CE+$08
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE+$08
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	BRA.b CODE_11A05F

CODE_11A051:
	LDA.l DATA_03A9CE+$10
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE+$10
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
CODE_11A05F:
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #FXDATA_548000+$40E1
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #FXDATA_548000+$40E1>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDX.b #FXCODE_0884A5>>16
	LDA.w #FXCODE_0884A5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.w $7972
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Sprite $1B4 -- Checkered Platform (mini-battle "Watch out below!"-style room).
; Raidenthequick alias: init_mini_battle_checkered_platform.
; Init: pulls per-slot X/Y from DATA_11A0B2/DATA_11A0CA using a slot counter
; at $10FE, optionally seeds the X-speed from DATA_11A0E2 (alternating
; left/right via $113C), and stamps its OAM index into $1100,y so the
; "main" tick can find this platform by slot.
;-------------------------------------------------------------------------
YI_NorSpr1B4_MinigameCheckeredPlatform_Init:
;$11A08D
	LDY.w $10FE
	LDA.w DATA_11A0B2,y
	STA.w $70E2,x
	LDA.w DATA_11A0CA,y
	STA.w $7182,x
	TXA
	STA.w $1100,y
	LDA.w $113C
	BEQ.b CODE_11A0A8
	LDA.w DATA_11A0E2,y
CODE_11A0A8:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.w $10FE
	INC.w $10FE
	RTL

;---------------------------------------------------------------------------

DATA_11A0B2:
	dw $0010,$00D8,$0010,$00D0,$0028,$0058,$0088,$00B8
	dw $0010,$0050,$0090,$00D0

DATA_11A0CA:
	dw $0090,$0090,$0073,$0073,$0033,$0033,$0033,$0033
	dw $00B3,$00B3,$00B3,$00B3

DATA_11A0E2:
	dw $0080,$FF80

;-------------------------------------------------------------------------
; Sprite $1B6 -- Red Balloon (mini-battle "Pop the balloons" room).
; Raidenthequick alias: init_mini_battle_red_balloon.
; Same slot-pull pattern as $1B4 but uses $1100/$1102 to remember the
; first two balloons by OAM index (mini-battle scoring tracks them).
;-------------------------------------------------------------------------
YI_NorSpr1B6_MinigameBalloon_Init:
;$11A0E6
	LDY.w $10FE
	LDA.w DATA_11A0B2,y
	STA.w $70E2,x
	LDA.w DATA_11A0CA,y
	STA.w $7182,x
	INC.w $10FE
	INC.w $10FE
	CPY.b #$04
	BEQ.b CODE_11A108
	CPY.b #$06
	BNE.b CODE_11A10D
	LDA.w $1102
	BRA.b CODE_11A10B

CODE_11A108:
	LDA.w $1100
CODE_11A10B:
	STA.b $78,x
CODE_11A10D:
	STZ.w $7722,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Sprite $1B4 Main tick -- Checkered Platform.
; Raidenthequick alias: main_mini_battle_checkered_platform.
; Drives left/right motion + edge-bounce; clears the platform once the
; mini-battle's win condition flag ($10F4) is set.
;-------------------------------------------------------------------------
YI_NorSpr1B4_MinigameCheckeredPlatform_Main:
;$11A111
	LDA.w $10F4
	BEQ.b CODE_11A11A
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTL

CODE_11A11A:
	LDA.w $70E2,x
	CMP.w #$0080
	BCS.b CODE_11A14C
	LDA.w $70E2,x
	CMP.w #$0050
	BCC.b CODE_11A132
	LDA.w #$0050
	STA.w $70E2,x
	BRA.b CODE_11A140

CODE_11A132:
	CMP.w #$0010
	BCS.b CODE_11A174
	LDA.w #$0010
	STA.w $70E2,x
	STZ.w $72C0,x
CODE_11A140:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_11A174

CODE_11A14C:
	LDA.w $70E2,x
	CMP.w #$00D0
	BCC.b CODE_11A15C
	LDA.w #$00D0
	STA.w $70E2,x
	BRA.b CODE_11A16A

CODE_11A15C:
	CMP.w #$0090
	BCS.b CODE_11A174
	LDA.w #$0090
	STA.w $70E2,x
	STZ.w $72C0,x
CODE_11A16A:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_11A174:
	RTL

;-------------------------------------------------------------------------
; Sprite $1B6 Main tick -- Red Balloon.
; Raidenthequick alias: main_mini_battle_red_balloon.
; Idle bob; on pop, awards minigame points and despawns.
;-------------------------------------------------------------------------
YI_NorSpr1B6_MinigameBalloon_Main:
;$11A175
	LDA.b $78,x
	BEQ.b CODE_11A180
	TAY
	LDA.w $70E2,y
	STA.w $70E2,x
CODE_11A180:
	LDA.b $76,x
	ASL
	TAY
	LDA.w DATA_11A193,y
	STA.w $0000
	LDA.w DATA_11A193+$01,y
	STA.w $0001
	JMP.w ($0000)

DATA_11A193:
	dw CODE_11A661
	dw CODE_11A392
	dw CODE_11A3CF
	dw CODE_11A40F
	dw CODE_11A44E
	dw CODE_11A490
	dw CODE_11A514
	dw CODE_11A333
	dw CODE_11A1A9
	dw CODE_11A1E9
	dw CODE_11A22B

CODE_11A1A9:
	JSL.l CODE_03AA52
	LDA.w $7A38,x
	CMP.w #$0020
	BCC.b CODE_11A1BC
	LDA.w #$0007
	STA.b $76,x
	BRA.b CODE_11A1C6

CODE_11A1BC:
	CLC
	ADC.w #$0008
	AND.w #$00FF
	STA.w $7A38,x
CODE_11A1C6:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w #$00C0
	BCC.b CODE_11A1E5
	SEC
	SBC.w #$0020
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$000C
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.w $7182,x
	INC.w $7182,x
CODE_11A1E5:
	JSR.w CODE_11A4F4
	RTL

CODE_11A1E9:
	JSL.l CODE_03AA52
	LDA.w $7A38,x
	BEQ.b CODE_11A1BC
	CMP.w #$00E0
	BCS.b CODE_11A1BC
	LDA.w #$0007
	STA.b $76,x
	BRA.b CODE_11A208

CODE_11A1FE:
	SEC
	SBC.w #$0008
	AND.w #$00FF
	STA.w $7A38,x
CODE_11A208:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w #$00C0
	BCC.b CODE_11A227
	SEC
	SBC.w #$0020
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$000C
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.w $7182,x
	INC.w $7182,x
CODE_11A227:
	JSR.w CODE_11A4F4
	RTL

CODE_11A22B:
	JSL.l CODE_03AA52
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEC
	SBC.w #$0020
	CMP.w #$0060
	BCS.b CODE_11A2B5
	JSL.l CODE_03A31E
	JSR.w CODE_bandit_minigame_coin_result_rng
	CMP.w #!Define_YI_AmbSpr22B
	BNE.b CODE_11A256
	INC.w $10F4
	LDA.w #$0001
	STA.w $10E6
	STA.w $10E2
	LDA.w #!Define_YI_AmbSpr22B
CODE_11A256:
	PHA
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	CLC
	ADC.w #$0020
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7142,y
	PLA
	PHX
	TYX
	CMP.w #!Define_YI_AmbSpr22B
	BNE.b CODE_11A280
	JSL.l CODE_11A30D
	JSR.w CODE_11A2CC
	BRA.b CODE_11A284

CODE_11A280:
	JSL.l CODE_11A2E1
CODE_11A284:
	PLX
	LDA.w #!Define_YI_AmbSpr1DC
	JSL.l CODE_spawn_ambient_sprite
	PHX
	LDX.w $112E
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7142,y
	LDA.w #$000B
	STA.w $7E4C,y
	LDA.w #$0002
	STA.w $7782,y
	PLX
	LDA.w #!Define_YI_SoundID46_BonusGameBoardFalls
	JSL.l CODE_push_sound_queue
	RTL

CODE_11A2B5:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0006
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.w $7182,x
	INC.w $7182,x
	JSR.w CODE_11A4F4
	RTL

CODE_11A2CC:
	LDA.w $70A2,x
	CLC
	ADC.w #$FFF4
	STA.w $70A2,x
	LDA.w $7142,x
	CLC
	ADC.w #$FFE0
	STA.w $7142,x
	RTS

CODE_11A2E1:
	LDA.w #$0003
	STA.w $7782,x
	STZ.w $7E4E,x
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0028
	STA.w $7502,x
	LDA.w #$0001
	STA.w $7462,x
	LDA.w #!Define_YI_SoundID86_MildePop2
	JSL.l CODE_push_sound_queue
	LDA.w #$00FF
	STA.w $7462,x
	RTL

CODE_11A30D:
	LDA.w #$0002
	STA.w $7782,x
	STA.w $7E4C,x
	STZ.w $7E4E,x
	STZ.w $7E8C,x
	STZ.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7502,x
	LDA.w #$0001
	STA.w $7462,x
	LDA.w #!Define_YI_SoundID86_MildePop2
	JSL.l CODE_push_sound_queue
	RTL

CODE_11A333:
	JSL.l CODE_03AA52
	STZ.w $0000
	LDA.w $7A38,x
	BEQ.b CODE_11A35D
	INC.w $0000
	CMP.w #$0080
	BCS.b CODE_11A353
	SEC
	SBC.w #$0004
	AND.w #$00FF
	STA.w $7A38,x
	BRA.b CODE_11A35D

CODE_11A353:
	CLC
	ADC.w #$0004
	AND.w #$00FF
	STA.w $7A38,x
CODE_11A35D:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w #$0100
	BEQ.b CODE_11A384
	INC.w $0000
	CLC
	ADC.w #$0010
	CMP.w #$0100
	BCC.b CODE_11A374
	LDA.w #$0100
CODE_11A374:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	SEC
	SBC.w #$0006
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEC.w $7182,x
CODE_11A384:
	LDA.w $0000
	BNE.b CODE_11A38E
	STZ.b $76,x
	STZ.w $7A36,x
CODE_11A38E:
	JSR.w CODE_11A4F4
	RTL

CODE_11A392:
	JSL.l CODE_03AA52
	LDA.w $7A38,x
	CMP.w #$0020
	BCC.b CODE_11A3A5
	LDA.w #$0007
	STA.b $76,x
	BRA.b CODE_11A3AF

CODE_11A3A5:
	CLC
	ADC.w #$0004
	AND.w #$00FF
	STA.w $7A38,x
CODE_11A3AF:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w #$00C0
	BCC.b CODE_11A3CB
	SEC
	SBC.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0006
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.w $7182,x
CODE_11A3CB:
	JSR.w CODE_11A4F4
	RTL

CODE_11A3CF:
	JSL.l CODE_03AA52
	LDA.w $7A38,x
	CMP.w #$0020
	BCC.b CODE_11A3E2
	LDA.w #$0007
	STA.b $76,x
	BRA.b CODE_11A3EC

CODE_11A3E2:
	CLC
	ADC.w #$0008
	AND.w #$00FF
	STA.w $7A38,x
CODE_11A3EC:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w #$00C0
	BCC.b CODE_11A40B
	SEC
	SBC.w #$0020
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$000C
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.w $7182,x
	INC.w $7182,x
CODE_11A40B:
	JSR.w CODE_11A4F4
	RTL

CODE_11A40F:
	JSL.l CODE_03AA52
	LDA.w $7A38,x
	BEQ.b CODE_11A424
	CMP.w #$00E0
	BCS.b CODE_11A424
	LDA.w #$0007
	STA.b $76,x
	BRA.b CODE_11A42E

CODE_11A424:
	SEC
	SBC.w #$0004
	AND.w #$00FF
	STA.w $7A38,x
CODE_11A42E:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w #$00C0
	BCC.b CODE_11A44A
	SEC
	SBC.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0006
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.w $7182,x
CODE_11A44A:
	JSR.w CODE_11A4F4
	RTL

CODE_11A44E:
	JSL.l CODE_03AA52
	LDA.w $7A38,x
	BEQ.b CODE_11A463
	CMP.w #$00E0
	BCS.b CODE_11A463
	LDA.w #$0007
	STA.b $76,x
	BRA.b CODE_11A42E

CODE_11A463:
	SEC
	SBC.w #$0008
	AND.w #$00FF
	STA.w $7A38,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w #$00C0
	BCC.b CODE_11A48C
	SEC
	SBC.w #$0020
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$000C
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.w $7182,x
	INC.w $7182,x
CODE_11A48C:
	JSR.w CODE_11A4F4
	RTL

CODE_11A490:
	JSL.l CODE_03AA52
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w #$00C0
	BCC.b CODE_11A4AF
	SBC.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0006
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.w $7182,x
CODE_11A4AF:
	LDA.w $60C0
	BNE.b CODE_11A4EB
	INC.w $61B4
	LDA.w #$0100
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LSR
	LSR
	LSR
	LSR
	STA.w $0000
	LDA.w #$001C
	SEC
	SBC.w $0000
	STA.w $0000
	LDA.w $7182,x
	SEC
	SBC.w $0000
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	JSR.w CODE_11A741
	STA.b $76,x
	CMP.w #$0001
	BEQ.b CODE_11A4E8
	CMP.w #$0003
	BNE.b CODE_11A4F0
CODE_11A4E8:
	JSR.w CODE_11A6F0
CODE_11A4EB:
	LDA.w #$0007
	STA.b $76,x
CODE_11A4F0:
	JSR.w CODE_11A4F4
	RTL

CODE_11A4F4:
	LDA.w $7A36,x
	BPL.b CODE_11A4FD
	JSR.w CODE_11A051
	RTS

CODE_11A4FD:
	JSR.w CODE_11A041
	LDA.b $78,x
	BEQ.b CODE_11A50F
	TAY
	LDA.w $72C0,y
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_11A50F:
	RTS

DATA_11A510:
	dw $0001,$0002

CODE_11A514:
	JSL.l CODE_03AA52
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEC
	SBC.w #$0020
	CMP.w #$0060
	BCC.b CODE_11A527
	JMP.w CODE_11A5FA

CODE_11A527:
	JSL.l CODE_03A31E
	JSR.w CODE_bandit_minigame_coin_result_rng
	NOP
	CMP.w #!Define_YI_AmbSpr22B
	BNE.b CODE_11A5B3
	LDA.w $10E2
	BEQ.b CODE_11A53E
	LDA.w #!Define_YI_AmbSpr22C
	BRA.b CODE_11A5B3

CODE_11A53E:
	LDA.w #$F0F0
	STA.w $1130
	STZ.w $10E6
	LDA.w #$0001
	STA.w $10E2
	LDX.w $112E
	LDA.w #$0004
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	LDA.w #$0011
	LDY.b #$5C
CODE_11A55B:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	BEQ.b CODE_11A566
	DEY
	DEY
	DEY
	DEY
	BRA.b CODE_11A55B

CODE_11A566:
	LDA.w #$0011
	JSL.l CODE_03A34E
	BCC.b CODE_11A5AD
	LDA.w $113C
	ASL
	TAX
	LDA.w DATA_11A510,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0080
	STA.w $7182,y
	LDA.w #$0078
	STA.w $70E2,y
	TYX
	LDA.w #!Define_YI_AmbSpr22E
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	CLC
	ADC.w #$FFF0
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$FFF0
	STA.w $7142,y
	LDA.w #$0003
	STA.w $7782,y
	TYX
	JSL.l CODE_ambient_helper_init_22E_state
CODE_11A5AD:
	LDX.w $7972
	LDA.w #!Define_YI_AmbSpr22B
CODE_11A5B3:
	PHA
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	CLC
	ADC.w #$0020
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7142,y
	LDA.w #$0002
	STA.w $7782,y
	PLA
	PHX
	TYX
	CMP.w #!Define_YI_AmbSpr22B
	BNE.b CODE_11A5F4
	JSL.l CODE_11A30D
	LDA.w $70A2,x
	CLC
	ADC.w #$FFF4
	STA.w $70A2,x
	LDA.w $7142,x
	CLC
	ADC.w #$FFE0
	STA.w $7142,x
	BRA.b CODE_11A5F8

CODE_11A5F4:
	JSL.l CODE_11A2E1
CODE_11A5F8:
	PLX
	RTL

CODE_11A5FA:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.w #$0006
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.w $7182,x
	INC.w $7182,x
	LDA.w #$0200
	STA.w $60AA
	STZ.w $60C0
	JSR.w CODE_11A4F4
	RTL

; Bandit minigame coin-result RNG. Returns either $022B (jackpot row
; head) or $022C (regular row head) -- the consumer code at
; CODE_11A22B / CODE_11A527 then JSL CODE_spawn_ambient_sprite with
; the result. Selected outcome cascades into the bonus-game 1up popup
; chain (see CODE_ambient_main_bonus_1up_jackpot_head /
; CODE_ambient_main_bonus_1up_regular_head in Bank00).
CODE_11A61A:
CODE_bandit_minigame_coin_result_rng:
	PHY
	JSL.l CODE_random_number_gen
	LDY.w $1130
	BMI.b CODE_11A62F
	SEP.b #$20
	LDA.b $10
	AND.b #$1F
	CMP.w DATA_11A657,y
	BCC.b CODE_11A636
CODE_11A62F:
	REP.b #$20
	LDA.w #!Define_YI_AmbSpr22C
	BRA.b CODE_11A652

CODE_11A636:
	REP.b #$20
	LDA.w #$F0F0
	STA.w $1130
	LDY.b #$3C
	LDA.w #$0000
CODE_11A643:
	STA.w !EXRAM_YI_Level_AmbSpr_SpriteExistsFlag|!EXRAMBankMirror,y
	STA.w $7782,y
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	DEC
	STA.w $7462,y
	INC
endif
	DEY
	DEY
	DEY
	DEY
	BPL.b CODE_11A643
	LDA.w #!Define_YI_AmbSpr22B
CODE_11A652:
	INC.w $1130
	PLY
	RTS

DATA_11A657:
	db $01,$01,$03,$03,$03,$07,$07,$0F,$0F,$FF

CODE_11A661:
	JSR.w CODE_11A665
	RTL

CODE_11A665:
	LDA.w $60AA
	BPL.b CODE_11A66D
	JMP.w CODE_11A6EF

CODE_11A66D:
	LDA.w $60AB
	AND.w #$00FF
	INC
	STA.w $0000
	LDA.w $70E2,x
	SEC
	SBC.w #$0008
	CMP.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BCS.b CODE_11A6EF
	CLC
	ADC.w #$0020
	CMP.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BCC.b CODE_11A6EF
	LDA.w $7182,x
	SEC
	SBC.w #$001C
	CMP.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	BCS.b CODE_11A6EF
	CLC
	ADC.w $0000
	CMP.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	BCC.b CODE_11A6EF
	LDA.w $7182,x
	SEC
	SBC.w #$001C
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC.w $61B4
	LDA.w #$0001
	STA.w $7A36,x
	STZ.w $1104
	JSR.w CODE_11A741
	STA.b $76,x
	JSR.w CODE_11A6F0
	LDA.w #$FF00
	STA.w $7ECE
	STA.w $7ECC
	LDA.w #$0008
	STA.w $7722,x
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0000
	STA.w $7A38,x
	JSR.w CODE_11A041
	LDA.b $78,x
	BEQ.b CODE_11A6EF
	TAY
	LDA.w $72C0,y
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_11A6EF:
	RTS

CODE_11A6F0:
	CMP.w #$0005
	BCS.b CODE_11A72C
	ASL
	TAY
	LDA.w $10FA
	BNE.b CODE_11A702
	LDA.w #$0008
	STA.w $60C0
CODE_11A702:
	LDA.w DATA_11A737,y
	STA.w $60AA
	LDA.w DATA_11A72D,y
	STA.w $60A8
	STA.w $60B4
	STZ.w $60D4
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	LDA.b $76,x
	LSR
	BCS.b CODE_11A72C
	STZ.w $61B4
	LDA.w #$006B
	STA.w $60BE
	INC.w $1104
CODE_11A72C:
	RTS

DATA_11A72D:
	dw $0000,$FF00,$FE80,$0100,$0180

DATA_11A737:
	dw $0000,$0000,$FC00,$0000,$FC00

CODE_11A741:
	STZ.w $0002
	LDA.w $60AB
	AND.w #$00FF
	INC
	CMP.w #$0008
	BCC.b CODE_11A753
	INC.w $0002
CODE_11A753:
	LDA.w $70E2,x
	SEC
	SBC.w #$0004
	CMP.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BCS.b CODE_11A772
	CLC
	ADC.w #$0018
	CMP.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BCC.b CODE_11A76D
	LDA.w #$0005
	BRA.b CODE_11A775

CODE_11A76D:
	LDA.w #$0003
	BRA.b CODE_11A775

CODE_11A772:
	LDA.w #$0001
CODE_11A775:
	CLC
	ADC.w $0002
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Sprite $1B5 -- Bandit (popping-balloons mini-battle variant).
; Raidenthequick alias: init_mini_battle_bandit_2 / main_mini_battle_bandit_2.
; Companion sprite to $1B6 (red balloons): the bandit pops/scores balloons.
;-------------------------------------------------------------------------
YI_NorSpr1B5_PoppingBalloonsBandit_Init:
;$11A77A
	LDA.w #$00C0
	STA.w $70E2,x
	LDA.w #$00C0
	STA.w $7182,x
	LDA.w #$0009
	STA.w $7402,x
	STX.w $112E
	RTL

;---------------------------------------------------------------------------

YI_NorSpr1B5_PoppingBalloonsBandit_Main:
;$11A790
	LDA.w $10F4
	BEQ.b CODE_11A79E
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
CODE_11A79E:
	JSR.w CODE_11AA97
	JSR.w CODE_11ABB2
	STX.w $112E
	LDA.b $18,x
	ASL
	TAX
	JSR.w (DATA_11A80A,x)
	LDA.b $18,x
	CMP.w #$0002
	BEQ.b CODE_11A7C1
	JSR.w CODE_11AA00
	JSR.w CODE_11AA47
	JSR.w CODE_11A96A
	JSR.w CODE_11A89B
CODE_11A7C1:
	LDA.w $10F4
	BEQ.b CODE_11A7D9
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w #$0009
	STA.w $7402,x
	STZ.w $74A2,x
	RTL

CODE_11A7D9:
	LDA.b $18,x
	CMP.w #$0002
	BEQ.b CODE_11A7FD
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_11A7E9
	EOR.w #$FFFF
	INC
CODE_11A7E9:
	CMP.w #$0040
	BCC.b CODE_11A7FD
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ROL
	ROL
	ROL
	AND.w #$0002
	EOR.w #$0002
	STA.w $7400,x
CODE_11A7FD:
	LDA.w $70E2,x
	STA.w $113E
	LDA.w $7182,x
	STA.w $1140
	RTL

DATA_11A80A:
	dw CODE_11AAD8
	dw CODE_11ABAB
	dw CODE_11A859
	dw CODE_11A82B
	dw CODE_11A814

CODE_11A814:
	LDX.w $112E
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w #$0009
	STA.w $7402,x
	STZ.w $74A2,x
	PLA
	RTL

CODE_11A82B:
	LDX.w $112E
	LDA.w $110A
	ROL
	ROL
	ROL
	AND.w #$0002
	TAY
	LDA.w DATA_11A855,y
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $1116
	CMP.w #$0004
	BCS.b CODE_11A854
	LDA.w #$FA00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
	STZ.b $18,x
CODE_11A854:
	RTS

DATA_11A855:
	dw $0008,$FFF8

CODE_11A859:
	LDX.w $112E
	LDA.w $7860,x
	LSR
	BCS.b CODE_11A869
	LDA.w #$001A
	STA.w $7402,x
	RTS

CODE_11A869:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A38,x
	TAY
	LDA.w DATA_11A892,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w $7A96,x
	BNE.b CODE_11A891
	LDA.w #$0004
	STA.w $7A96,x
	INC.w $7A38,x
	LDA.w $7A38,x
	CMP.w #$0008
	BCC.b CODE_11A891
	STZ.b $18,x
CODE_11A891:
	RTS

DATA_11A892:
	db $16,$15,$16,$15,$16,$15,$16,$15

CODE_11A89A:
	RTS

CODE_11A89B:
	LDA.b $18,x
	CMP.w #$0002
	BEQ.b CODE_11A89A
	LDA.w $1104
	BNE.b CODE_11A89A
	LDA.w $1112
	CMP.w #$0010
	BCS.b CODE_11A89A
	LDA.w $1118
	CMP.w #$0010
	BCS.b CODE_11A89A
	CMP.w #$0006
	BCC.b CODE_11A8FB
	JSR.w CODE_11A94D
	LDA.w $110C
	BPL.b CODE_11A8E2
	LDA.w #$0002
	STA.b $18,x
	STZ.w $7A38,x
	LDA.w $7CD6,x
	STA.b $00
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.b $02
	LDY.b #!Define_YI_SoundID3A_StompShyGuy
	JSL.l CODE_03A0E7
	BRA.b CODE_11A8FB

CODE_11A8E2:
	LDA.w $611C
	STA.b $00
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.b $02
	LDY.b #!Define_YI_SoundID3A_StompShyGuy
	JSL.l CODE_03A0E7
	LDA.w #$006B
	STA.w $60BE
	INC.w $1104
CODE_11A8FB:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ROL
	ROL
	ROL
	AND.w #$0002
	TAY
	LDA.w DATA_11A966,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w $60A8
	STA.w $60B4
	STZ.w $60D4
	LDA.w $60C0
	BEQ.b CODE_11A927
	LDA.w $110C
	BMI.b CODE_11A927
	STZ.w $60AA
	BRA.b CODE_11A933

CODE_11A927:
	LDA.w #$0008
	STA.w $60C0
	LDA.w #$FA00
	STA.w $60AA
CODE_11A933:
	LDA.b $76,x
	BEQ.b CODE_11A941
	LDA.w $110C
	BMI.b CODE_11A941
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_11A94C

CODE_11A941:
	LDA.w #$0001
	STA.b $76,x
	LDA.w #$FB00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_11A94C:
	RTS

CODE_11A94D:
	LDA.w $1142
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.w $1144
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $113E
	STA.w $70E2,x
	LDA.w $1140
	STA.w $7182,x
	RTS

DATA_11A966:
	dw $FE00,$0200

CODE_11A96A:
	LDA.b $76,x
	BEQ.b CODE_11A9B1
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_11A9B1
	LDY.b #$5C
CODE_11A975:
	LDA.w $7A36,y
	BNE.b CODE_11A9AB
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr1B6_MinigameBalloon
	BNE.b CODE_11A9AB
	LDA.w $70E2,y
	CMP.w $7CD6,x
	BCS.b CODE_11A9AB
	CLC
	ADC.w #$0020
	CMP.w $7CD6,x
	BCC.b CODE_11A9AB
	LDA.w $7182,y
	SEC
	SBC.w #$0010
	CMP.w $7182,x
	BCS.b CODE_11A9AB
	CLC
	ADC.w #$0004
	CMP.w $7182,x
	BCC.b CODE_11A9AB
	JMP.w CODE_11A9B2

CODE_11A9AB:
	DEY
	DEY
	DEY
	DEY
	BPL.b CODE_11A975
CODE_11A9B1:
	RTS

CODE_11A9B2:
	LDA.w $70E2,y
	CLC
	ADC.w #$0008
	CMP.w $7CD6,x
	BCS.b CODE_11A9CC
	CLC
	ADC.w #$0010
	CMP.w $7CD6,x
	BCC.b CODE_11A9D1
	LDA.w #$000A
	BRA.b CODE_11A9D4

CODE_11A9CC:
	LDA.w #$0008
	BRA.b CODE_11A9D4

CODE_11A9D1:
	LDA.w #$0009
CODE_11A9D4:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #$FFFF
	STA.w $7A36,y
	LDA.w #$FFF0
	STA.w $7ECE
	STA.w $7ECC
	LDA.w #$0010
	STA.w $7722,y
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDA.w #$0000
	STA.w $7A38,y
	TYX
	JSR.w CODE_11A051
	RTS

CODE_11AA00:
	LDA.b $76,x
	BNE.b CODE_11AA1A
	LDA.w $7A96,x
	BNE.b CODE_11AA12
	LDA.w #$0003
	STA.w $7A96,x
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
CODE_11AA12:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	AND.w #$0001
	BRA.b CODE_11AA43

CODE_11AA1A:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_11AA24
	LDA.w #$0018
	BRA.b CODE_11AA43

CODE_11AA24:
	LDA.w $1114
	CMP.w #$0010
	BCS.b CODE_11AA40
	JSL.l CODE_random_number_gen
	LDA.b $10
	AND.w #$0007
	BNE.b CODE_11AA3B
	JSL.l CODE_029BD9
CODE_11AA3B:
	LDA.w #$001A
	BRA.b CODE_11AA43

CODE_11AA40:
	LDA.w #$0017
CODE_11AA43:
	STA.w $7402,x
	RTS

CODE_11AA47:
	LDY.w $1100
	JSR.w CODE_11AA54
	LDA.b $78,x
	BNE.b CODE_11AA96
	LDY.w $1102
CODE_11AA54:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_11AA94
	LDA.w $70E2,y
	CMP.w $7CD6,x
	BCS.b CODE_11AA94
	CLC
	ADC.w #$0020
	CMP.w $7CD6,x
	BCC.b CODE_11AA94
	LDA.w $7182,y
	SEC
	SBC.w #$0010
	CMP.w $7182,x
	BCS.b CODE_11AA94
	CLC
	ADC.w #$0008
	CMP.w $7182,x
	BCC.b CODE_11AA94
	LDY.w $1122
	LDA.w $7182,y
	SEC
	SBC.w #$0010
	STA.w $7182,x
	LDA.w #$0001
	STA.b $78,x
	STZ.b $76,x
	RTS

CODE_11AA94:
	STZ.b $78,x
CODE_11AA96:
	RTS

CODE_11AA97:
	LDA.w $7182,x
	BPL.b CODE_11AAB9
	LDA.w $70E2,x
	CMP.w #$0030
	BCS.b CODE_11AAAC
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0030
	BRA.b CODE_11AAD4

CODE_11AAAC:
	CMP.w #$00C1
	BCC.b CODE_11AAD4
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$00C0
	BRA.b CODE_11AAD4

CODE_11AAB9:
	LDA.w $70E2,x
	CMP.w #$0010
	BCS.b CODE_11AAC9
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0010
	BRA.b CODE_11AAD4

CODE_11AAC9:
	CMP.w #$00E1
	BCC.b CODE_11AAD4
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$00E0
CODE_11AAD4:
	STA.w $70E2,x
	RTS

CODE_11AAD8:
	LDX.w $112E
	LDA.w $7860,x
	LSR
	BCS.b CODE_11AAEC
	LDA.b $78,x
	BNE.b CODE_11AAEC
	LDA.w #$0001
	STA.b $76,x
	BRA.b CODE_11AAEE

CODE_11AAEC:
	STZ.b $76,x
CODE_11AAEE:
	LDA.b $78,x
	CMP.w #$0001
	BNE.b CODE_11AB3C
	LDA.w $111A
	CMP.w #$0004
	BNE.b CODE_11AB0A
	LDA.w $1114
	CMP.w #$0002
	BCS.b CODE_11AB72
	LDA.w #$FB80
	BRA.b CODE_11AB61

CODE_11AB0A:
	LDY.w $1122
	LDA.w $72C0,y
	CLC
	ADC.w $70E2,x
	STA.w $70E2,x
	LDA.w $70E2,x
	CMP.w #$0020
	BCC.b CODE_11AB37
	CMP.w #$00D0
	BCS.b CODE_11AB37
	LDA.w $110A
	ROL
	ROL
	ROL
	AND.w #$0002
	STA.b $00
	LDA.w $110A
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_11AB83

CODE_11AB37:
	LDA.w #$FA00
	BRA.b CODE_11AB61

CODE_11AB3C:
	LDA.b $76,x
	BNE.b CODE_11AB72
	LDA.w $1114
	CMP.w #$0004
	BCS.b CODE_11AB72
	LDA.w $111A
	BEQ.b CODE_11AB5E
	CMP.w #$0070
	BCC.b CODE_11AB59
	LDA.w #$0003
	STA.b $18,x
	BRA.b CODE_11AB72

CODE_11AB59:
	LDA.w #$FA00
	BRA.b CODE_11AB61

CODE_11AB5E:
	LDA.w #$FB00
CODE_11AB61:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0001
	STA.b $76,x
	STZ.b $78,x
	LDA.w #!Define_YI_SoundID38_BabyMarioJump
	JSL.l CODE_push_sound_queue
CODE_11AB72:
	LDA.w $1108
	ROL
	ROL
	ROL
	AND.w #$0002
	STA.b $00
	LDA.w $1108
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_11AB83:
	AND.w #$8000
	BEQ.b CODE_11AB94
	LDA.b $76,x
	BNE.b CODE_11AB91
	LDA.w #$0000
	BRA.b CODE_11AB94

CODE_11AB91:
	LDA.w #$0004
CODE_11AB94:
	CLC
	ADC.b $00
	TAY
	LDA.w DATA_11ABA3,y
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

DATA_11ABA3:
	dw $0008,$FFF8,$0038,$FFC8

CODE_11ABAB:
	LDX.w $112E
	JMP.w CODE_11ABAB

CODE_11ABB1:
	RTS

CODE_11ABB2:
	LDA.w $611C
	SEC
	SBC.w $7CD6,x
	STA.w $1106
	BPL.b CODE_11ABC2
	EOR.w #$FFFF
	INC
CODE_11ABC2:
	STA.w $1112
	LDA.w $611E
	SEC
	SBC.w $7182,x
	STA.w $110C
	BPL.b CODE_11ABD5
	EOR.w #$FFFF
	INC
CODE_11ABD5:
	STA.w $1118
	LDA.b $76,x
	BEQ.b CODE_11ABEF
	LDY.w $1120
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr1B6_MinigameBalloon
	BNE.b CODE_11ABEF
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	BEQ.b CODE_11ABEF
	JMP.w CODE_11AC87

CODE_11ABEF:
	STZ.w $1120
	STZ.w $1122
	LDY.b #$5C
CODE_11ABF7:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	BEQ.b CODE_11AC4C
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr1B6_MinigameBalloon
	BNE.b CODE_11AC29
	LDA.w $7A36,y
	BNE.b CODE_11AC4C
	LDA.w $7CD6,y
	CLC
	ADC.w #$0008
	STA.w $7CD6,y
	LDA.w $7CD8,y
	CLC
	ADC.w #$0005
	STA.w $7CD8,y
	LDA.w #$0002
	STA.b $08
	PHY
	JSR.w CODE_11ACD0
	PLY
	BRA.b CODE_11AC4C

CODE_11AC29:
	CMP.w #!Define_YI_NorSpr1B4_MinigameCheckeredPlatform
	BNE.b CODE_11AC4C
	LDA.w $7CD6,y
	CLC
	ADC.w #$0008
	STA.w $7CD6,y
	LDA.w $7CD8,y
	CLC
	ADC.w #$FFF8
	STA.w $7CD8,y
	LDA.w #$0004
	STA.b $08
	PHY
	JSR.w CODE_11ACD0
	PLY
CODE_11AC4C:
	DEY
	DEY
	DEY
	DEY
	BPL.b CODE_11ABF7
	LDY.b #$02
	LDA.w $1118
	CMP.w $111A
	BCS.b CODE_11AC68
	CMP.w #$0010
	BCS.b CODE_11AC68
	LDA.w $61D6
	BNE.b CODE_11AC68
	LDY.b #$00
CODE_11AC68:
	LDA.w $1106,y
	STA.w $1124
	LDA.w $110C,y
	STA.w $1126
	LDA.w $1112,y
	STA.w $1128
	LDA.w $1118,y
	STA.w $112A
	LDA.w $111E,y
	STA.w $112C
	RTS

CODE_11AC87:
	LDY.w $1120
	LDA.w $7CD6,y
	CLC
	ADC.w #$0008
	STA.w $7CD6,y
	LDA.w $7CD8,y
	CLC
	ADC.w #$0005
	STA.w $7CD8,y
	LDA.w #$0002
	STA.b $08
	STZ.w $1120
	JSR.w CODE_11ACD0
	LDY.w $1122
	LDA.w $7CD6,y
	CLC
	ADC.w #$0008
	STA.w $7CD6,y
	LDA.w $7CD8,y
	CLC
	ADC.w #$FFF8
	STA.w $7CD8,y
	LDA.w #$0004
	STA.b $08
	STZ.w $1122
	JSR.w CODE_11ACD0
	LDY.b #$00
	JMP.w CODE_11AC4C

CODE_11ACD0:
	LDA.w $7CD6,y
	SEC
	SBC.w $7CD6,x
	STA.b $00
	BPL.b CODE_11ACDF
	EOR.w #$FFFF
	INC
CODE_11ACDF:
	STA.b $04
	LDA.w $7CD8,y
	CLC
	ADC.w #$0008
	SEC
	SBC.w $7CD8,x
	STA.b $02
	BPL.b CODE_11ACF4
	EOR.w #$FFFF
	INC
CODE_11ACF4:
	STA.b $06
	STY.b $0A
	LDY.b $08
	LDA.w $111E,y
	BEQ.b CODE_11AD0F
	LDA.w $1118,y
	CMP.b $06
	BCC.b CODE_11AD29
	BNE.b CODE_11AD0F
	LDA.w $1112,y
	CMP.b $04
	BCC.b CODE_11AD29
CODE_11AD0F:
	LDA.b $00
	STA.w $1106,y
	LDA.b $02
	STA.w $110C,y
	LDA.b $04
	STA.w $1112,y
	LDA.b $06
	STA.w $1118,y
	LDA.b $0A
	STA.w $111E,y
	TAY
CODE_11AD29:
	RTS

CODE_11AD2A:
	PHP
	SEP.b #$30
	LDA.w $1135
	PHA
	LDA.b #$7F
	STA.w $1135
	JSL.l CODE_save_game
	PLA
	STA.w $1135
	LDA.w $0374
	CMP.b #$FF
	BNE.b CODE_11AD4C
	LDA.b #!Define_YI_GameMode1F
	STA.w !RAM_YI_Global_CurrentGameMode
	BRA.b CODE_11AD77

CODE_11AD4C:
	LDA.w $0376
	STA.l $7F7FC2
	LDA.b #$00
	STA.l $7F7FC3
	INC
	STA.w $038C
	LDA.b #!Define_YI_GameMode0B
	STA.w !RAM_YI_Global_CurrentGameMode
	REP.b #$20
	LDA.w $0374
	STA.l $7F7FC0
	LDA.w #$01C0
	STA.w $038E
	LDA.w $0377
	STA.w !RAM_YI_Level_StarTimerLo
CODE_11AD77:
	PLP
	RTL

;-------------------------------------------------------------------------
; CODE_init_mini_battle_gather_coins -- Per-variant init for the gather-coins / coin-cannon
; mini-battle (gm2e/gm30 sub-mode slot 4 in DATA_bandit_minigame_init_ptrs).
; Resets scroll, sets BG1/2 addresses + mode 9, clears tile grid, then
; spawns sprite $1B1 (CoinCannon) and sprite $1B3 (GatherCoinsBandit) --
; the two actors that drive this mini-battle.
;-------------------------------------------------------------------------
CODE_init_mini_battle_gather_coins:
CODE_11AD79:
	REP.b #$20
	STZ.b !RAM_YI_Global_Layer1XPosLo
	STZ.b !RAM_YI_Global_Layer1YPosLo
	STZ.b !RAM_YI_Global_Layer2XPosLo
	STZ.b !RAM_YI_Global_Layer2YPosLo
	STZ.b !RAM_YI_Global_Layer3XPosLo
	STZ.b !RAM_YI_Global_Layer3YPosLo
	SEP.b #$20
	LDA.b #$69
	STA.w !RAM_YI_Global_BG1AddressAndSize
	STA.w !REGISTER_BG1AddressAndSize
	LDA.b #$39
	STA.w !RAM_YI_Global_BG2AddressAndSize
	STA.w !REGISTER_BG2AddressAndSize
	LDA.b #$09
	STA.w !RAM_YI_Global_BGModeAndTileSizeSetting
	STA.w !REGISTER_BGModeAndTileSizeSetting
	STZ.w !RAM_YI_Global_HDMAEnable
	STZ.w !RAM_YI_Global_ColorMathSelectAndEnable
	REP.b #$30
	LDA.w #$00B0
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$0030
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STZ.w $6CAA
	STA.w !RAM_YI_Level_StarTimerLo
	LDA.w #$0030
	STA.w $10EC
	LDA.w #$0001
	STA.w $10EE
	STZ.w $10E8
	STZ.w $10EA
	LDX.w #$01FE
	LDA.w #$0000
CODE_11ADD3:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	DEX
	DEX
	BPL.b CODE_11ADD3
	LDX.w #$001E
	LDA.w #$0100
CODE_11ADE1:
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	STA.l $7F81A0,x
	DEX
	DEX
	BPL.b CODE_11ADE1
	LDX.w #$0160
CODE_11ADF0:
	LDA.w #$0100
	STA.l !RAM_YI_Level_LevelDataBuffer,x
	STA.l $7F801E,x
	TXA
	SEC
	SBC.w #$0020
	TAX
	BNE.b CODE_11ADF0
	SEP.b #$10
	LDA.w #$01B1
	JSL.l CODE_spawn_sprite_init
	LDA.w #$01B3
	JSL.l CODE_spawn_sprite_init
	SEP.b #$30
	JSL.l CODE_handle_sprites
	RTS

;-------------------------------------------------------------------------
; CODE_main_mini_battle_gather_coins -- Per-variant main tick for the gather-coins mini-battle
; (gm2e/gm30 sub-mode slot 4 in DATA_mini_battle_main_ptrs). Each frame: clears OAM,
; runs render dispatch, ticks SuperFX render, and dispatches one of three
; sub-state handlers via DATA_11AE3F indexed by $7E:10F8 ("phase").
;-------------------------------------------------------------------------
CODE_main_mini_battle_gather_coins:
CODE_11AE1A:
	JSL.l CODE_init_oam_buffer
	JSL.l CODE_spr_edge_despawn_draw
	JSL.l CODE_04FA67
	STZ.w $03BA
	LDA.w $10F8
	ASL
	TAX
	JSR.w (DATA_11AE3F,x)
	REP.b #$20
	LDX.b #FXCODE_08B1EF>>16
	LDA.w #FXCODE_08B1EF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	RTS

DATA_11AE3F:
	dw CODE_11AE47
	dw CODE_11AEAC
	dw CODE_11AEC9

DATA_11AE45:
	db $06,$04

CODE_11AE47:
	JSL.l CODE_04DD9E
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_11AEA9
	JSL.l CODE_handle_sprites
	REP.b #$30
	JSR.w CODE_11AEDC
	SEP.b #$10
	LDA.w $10F8
	BEQ.b CODE_11AEA9
	LDX.b #$5C
CODE_11AE62:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	BEQ.b CODE_11AE73
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w $7540,x
CODE_11AE73:
	DEX
	DEX
	DEX
	DEX
	BPL.b CODE_11AE62
	LDA.w $10EC
	BNE.b CODE_11AEA9
	LDA.w $10E6
	BNE.b CODE_11AEA9
	LDA.w #$0011
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_11AEA9
	JSL.l CODE_random_number_gen
	AND.w #$0001
	TAX
	LDA.w DATA_11AE45,x
	AND.w #$00FF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0080
	STA.w $7182,y
	LDA.w #$0070
	STA.w $70E2,y
CODE_11AEA9:
	SEP.b #$20
	RTS

CODE_11AEAC:
	JSL.l CODE_04DD9E
	JSL.l CODE_handle_sprites
	LDA.w $10FA
	BEQ.b CODE_11AEC4
	LDA.w $60C0
	BNE.b CODE_11AEC4
	INC.w $10F8
	INC.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
CODE_11AEC4:
	JSL.l CODE_bonus_game_state_dispatcher
	RTS

CODE_11AEC9:
	JSL.l CODE_04DD9E
	JSL.l CODE_handle_sprites
	LDA.b #$01
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STA.w $10FA
	JMP.w CODE_11AEC4

CODE_11AEDC:
	CLC
	SED
	LDA.w $10E8
	ADC.w $03BA
	STA.w $10E8
	CLD
	DEC.w $10EE
	BNE.b CODE_11AF2B
	SEC
	SED
	LDA.w $10EC
	SBC.w #$0001
	STA.w $10EC
	CLD
	BNE.b CODE_11AF16
	LDY.w #$0000
	LDA.w $10E8
	CMP.w $10EA
	BCS.b CODE_11AF07
	INY
CODE_11AF07:
	STY.w $10E6
	INY
	STY.w $10F8
	LDA.w #$0001
	STA.w $10E2
	BRA.b CODE_11AF2B

CODE_11AF16:
	LDA.w $10EC
	CMP.w #$0006
	BCS.b CODE_11AF25
	LDA.w #!Define_YI_SoundID7F_SwitchTimerEnding
	JSL.l CODE_push_sound_queue
CODE_11AF25:
	LDA.w #$003F
	STA.w $10EE
CODE_11AF2B:
	PHB
	LDA.w #$7E8000>>16
	PHA
	PLB
	LDX.w $7E4800
	LDA.w #$3484
	STA.w $0000,x
	CLC
	ADC.w #$0020
	STA.w $0010,x
	LDA.w #$348F
	STA.w $0020,x
	ADC.w #$0020
	STA.w $0030,x
	LDA.w #$349A
	STA.w $0040,x
	ADC.w #$0020
	STA.w $0050,x
	LDA.w #$0180
	STA.w $0002,x
	STA.w $0012,x
	STA.w $0022,x
	STA.w $0032,x
	STA.w $0042,x
	STA.w $0052,x
	LDA.w #$0018
	STA.w $0004,x
	STA.w $0014,x
	STA.w $0024,x
	STA.w $0034,x
	STA.w $0044,x
	STA.w $0054,x
	TXA
	ADC.w #$000C
	STA.w $0005,x
	ADC.w #$0010
	STA.w $0015,x
	ADC.w #$0010
	STA.w $0025,x
	ADC.w #$0010
	STA.w $0035,x
	ADC.w #$0010
	STA.w $0045,x
	ADC.w #$0010
	STA.w $0055,x
	LDA.w #$007E
	STA.w $0007,x
	STA.w $0017,x
	STA.w $0027,x
	STA.w $0037,x
	STA.w $0047,x
	STA.w $0057,x
	LDA.w #$0004
	STA.w $0008,x
	STA.w $0018,x
	STA.w $0028,x
	STA.w $0038,x
	STA.w $0048,x
	STA.w $0058,x
	TXA
	ADC.w #$0010
	STA.w $000A,x
	ADC.w #$0010
	STA.w $001A,x
	ADC.w #$0010
	STA.w $002A,x
	ADC.w #$0010
	STA.w $003A,x
	ADC.w #$0010
	STA.w $004A,x
	ADC.w #$0010
	STA.w $005A,x
	STA.w $7E4800
	PLB
	PLB
	TXA
	SEC
	SBC.w #$7E4802
	TAX
	LDA.w $10E8
	TAY
	AND.w #$00F0
	LSR
	LSR
	LSR
	LSR
	ORA.w #$2900
	STA.l $7E480E,x
	ORA.w #$0010
	STA.l $7E481E,x
	TYA
	AND.w #$000F
	ORA.w #$2900
	STA.l $7E4810,x
	ORA.w #$0010
	STA.l $7E4820,x
	LDA.w $10EC
	TAY
	AND.w #$00F0
	LSR
	LSR
	LSR
	LSR
	ORA.w #$2900
	STA.l $7E482E,x
	ORA.w #$0010
	STA.l $7E483E,x
	TYA
	AND.w #$000F
	ORA.w #$2900
	STA.l $7E4830,x
	ORA.w #$0010
	STA.l $7E4840,x
	LDA.w $10EA
	TAY
	AND.w #$00F0
	LSR
	LSR
	LSR
	LSR
	ORA.w #$2900
	STA.l $7E484E,x
	ORA.w #$0010
	STA.l $7E485E,x
	TYA
	AND.w #$000F
	ORA.w #$2900
	STA.l $7E4850,x
	ORA.w #$0010
	STA.l $7E4860,x
	RTS

;---------------------------------------------------------------------------

DATA_11B084:
	dw $FF00,$0100

;-------------------------------------------------------------------------
; Sprite $1B1 -- Coin Cannon (fires coin pickups in a mini-battle room).
; Raidenthequick aliases: init_coin_cannon / main_coin_cannon.
; The Cannon is the spawner; the actual coin pickups it produces are sprite $1B2.
;-------------------------------------------------------------------------
YI_NorSpr1B1_CoinCannon_Init:
;$11B088
	LDA.w #$0038
	STA.w $7182,x
	LDA.w #$0070
	STA.w $70E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w DATA_11B084,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7A96,x
	STZ.b $78,x
	STZ.w $7A36,x
	LDA.w #$0100
	STA.w $7A38,x
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.b $16,x
	STZ.w $7722,x
CODE_11B0BC:
	LDA.w #FXDATA_550000+$0080
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$0080)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
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
	INC.w $0CF9
	LDX.b $12
CODE_11B0FA:
	RTL

;---------------------------------------------------------------------------

; DATA_gather_coins_cannon_rotation_distances -- SMWC: Gather-Coins bandit mini-game; cannon rotation
; distance table (2 word entries).
DATA_11B0FB:
DATA_gather_coins_cannon_rotation_distances:
	dw $0020,$00E0

; DATA_gather_coins_track_distances -- SMWC: Gather-Coins bandit mini-game; cannon+platform
; track-travel distance table (2 word entries).
DATA_11B0FF:
DATA_gather_coins_track_distances:
	dw $0018,$00C8

; DATA_gather_coins_cannon_rotation_speeds -- SMWC: Gather-Coins bandit mini-game; cannon rotation
; speed table (2 word entries).
DATA_11B103:
DATA_gather_coins_cannon_rotation_speeds:
	dw $0002,$FFFE

DATA_11B107:
	dw $0133,$014D,$0166,$0133,$0100

DATA_11B111:
	dw $00CD,$00B3,$009A,$0100,$0100

DATA_11B11B:
	dw $000A,$000A,$0010,$0004,$0000

YI_NorSpr1B1_CoinCannon_Main:
;$11B125
	LDA.w $10F8
	BNE.b CODE_11B0FA
	LDA.w $7A96,x
	BEQ.b CODE_11B15B
	INC.b $16,x
	LDA.b $16,x
	AND.w #$0003
	BEQ.b CODE_11B13B
CODE_11B138:
	JMP.w CODE_11B218

CODE_11B13B:
	LDY.b $78,x
	LDA.w $7A36,x
	CLC
	ADC.w DATA_gather_coins_cannon_rotation_speeds,y
	AND.w #$00FF
	STA.w $7A36,x
	CMP.w DATA_gather_coins_cannon_rotation_distances,y
	BNE.b CODE_11B158
	TYA
	AND.w #$00FF
	EOR.w #$0002
	STA.b $78,x
CODE_11B158:
	JMP.w CODE_11B214

CODE_11B15B:
	LDA.w $7AF6,x
	BNE.b CODE_11B138
	INC.b $18,x
	LDA.b $18,x
	ASL
	TAY
	CPY.b #$08
	BEQ.b CODE_11B16D
CODE_11B16A:
	JMP.w CODE_11B1F3

CODE_11B16D:
	PHY
	LDA.w #$01B2
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_11B16A
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w $7182,y
	LDA.w $7A36,x
	CLC
	ADC.w #$0040
	AND.w #$00FF
	ASL
	TAX
	LDA.l DATA_sine_lut_8bit_radians,x
	ASL
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.l DATA_cosine_lut_8bit_radians,x
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDX.b $12
	LDA.w #!Define_YI_AmbSpr22A
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7A36,x
	STA.w $7E8C,y
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$002C
	STA.w !EXRAM_YI_Level_AmbSpr_GenericTable7018C0|!EXRAMBankMirror,y
	LDA.w #$000C
	STA.w !EXRAM_YI_Level_AmbSpr_GenericTable7018C2|!EXRAMBankMirror,y
	LDA.w #$0000
	STA.w $73C2,y
	LDA.w #$0003
	STA.w $7782,y
	LDA.w #$0004
	STA.w $7E8E,y
	LDA.w #$0024
	STA.w $7002,y
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	PLY
CODE_11B1F3:
	LDA.w DATA_11B107,y
	STA.w $7A38,x
	LDA.w DATA_11B111,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w DATA_11B11B,y
	STA.w $7AF6,x
	BNE.b CODE_11B214
	STZ.b $18,x
	LDA.b $10
	AND.w #$003F
	ADC.w #$0040
	STA.w $7A96,x
CODE_11B214:
	JSL.l CODE_11B0BC
CODE_11B218:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w $7680,x
	CMP.w DATA_gather_coins_track_distances,y
	BNE.b CODE_11B23A
	STZ.w $70E1,x
	LDA.w DATA_gather_coins_track_distances,y
	STA.w $70E2,x
	TYA
	EOR.w #$0002
	TAY
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w DATA_11B084,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_11B23A:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Sprite $1B2 -- Minigame Coin (the coin pickup spawned by the cannon $1B1).
; Raidenthequick aliases: init_mini_battle_coin / main_mini_battle_coin.
; Facing direction is seeded from initial X-speed sign so it flies the right way.
;-------------------------------------------------------------------------
YI_NorSpr1B2_MinigameCoin_Init:
;$11B23B
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_11B244
	INY
	INY
CODE_11B244:
	TYA
	STA.w $7400,x
	RTL

;---------------------------------------------------------------------------

DATA_11B249:
	dw $0006,$0000

YI_NorSpr1B2_MinigameCoin_Main:
;$11B24D
	LDA.w $10F8
	BEQ.b CODE_11B255
	JMP.w CODE_11B30A

CODE_11B255:
	LDY.w $7D36,x
	BEQ.b CODE_11B2C4
	BMI.b CODE_11B284
	DEY
	LDA.w $7A36,y
	BNE.b CODE_11B2C4
	CLC
	SED
	LDA.w $10EA
	ADC.w #$0001
	STA.w $10EA
	CLD
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC.w $03BA
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	SEC
	SBC.w #$0004
	STA.b $02
	BRA.b CODE_11B2A0

CODE_11B284:
	LDA.w $61D6
	CMP.w #$0081
	BCS.b CODE_11B2C4
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.b $00
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0004
	STA.b $02
CODE_11B2A0:
	LDA.w #$0003
	JSL.l CODE_03B481
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	TAX
	LDA.w $7002,y
	AND.w #$FFF0
	ORA.w DATA_11B249,x
	STA.w $7002,y
	LDX.b $12
	LDA.w #!Define_YI_SoundID09_Coin
	JSL.l CODE_push_sound_queue
	JML.l CODE_03A31E

CODE_11B2C4:
	LDA.w $7860,x
	LSR
	BCC.b CODE_11B2F9
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_11B2F9
	LSR
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CMP.w #$FFF0
	BCS.b CODE_11B2E5
	LDA.w #!Define_YI_SoundID2C_ClankSound5
	JSL.l CODE_push_sound_queue
	BRA.b CODE_11B2F9

CODE_11B2E5:
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_11B2F1
	EOR.w #$FFFF
	INC
CODE_11B2F1:
	CMP.w #$0010
	BCS.b CODE_11B2F9
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_11B2F9:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_11B30A
	LDA.w #$0034
	STA.w $7042,x
	LDA.w #$0003
	STA.w $74A2,x
CODE_11B30A:
	LDA.w $0030
	LSR
	LSR
	LSR
	AND.w #$0003
	STA.w $7402,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Sprite $1B3 -- Bandit (gather-coins mini-battle variant).
; Raidenthequick aliases: init_mini_battle_bandit / main_mini_battle_bandit.
; Companion to coin cannon $1B1 + coin $1B2: the bandit races Yoshi for coins.
;-------------------------------------------------------------------------
YI_NorSpr1B3_GatherCoinsBandit_Init:
;$11B317
	LDA.w #$00C0
	STA.w $7182,x
	LDA.w #$00C0
	STA.w $70E2,x
	LDA.w #$0009
	STA.w $7402,x
CODE_11B329:
	RTL

;---------------------------------------------------------------------------

YI_NorSpr1B3_GatherCoinsBandit_Main:
;$11B32A
	LDA.w $10F8
	BNE.b CODE_11B329
	LDA.w $61D6
	CMP.w #$0081
	BCS.b CODE_11B33A
	STZ.w $61D6
CODE_11B33A:
	LDA.w $7680,x
	CMP.w #$0010
	BCS.b CODE_11B352
	LDA.w #$0010
	SEC
	SBC.w $7680,x
	CLC
	ADC.w $70E2,x
	STA.w $70E2,x
	BRA.b CODE_11B36B

CODE_11B352:
	LDA.w $7680,x
	SEC
	SBC.w #$00E0
	BMI.b CODE_11B375
	CMP.w #$0020
	BCC.b CODE_11B36B
	STA.b $00
	LDA.w $70E2,x
	SEC
	SBC.b $00
	STA.w $70E2,x
CODE_11B36B:
	STZ.b $18,x
	LDA.w $7A36,x
	BEQ.b CODE_11B375
	STZ.w $7A36,x
CODE_11B375:
	LDA.b $18,x
	ASL
	TAY
	LDA.w DATA_11B381,y
	STA.b $00
	JMP.w ($0000+$7960)

DATA_11B381:
	dw CODE_11B38B
	dw CODE_11B41A
	dw CODE_11B4CB
	dw CODE_11B632
	dw CODE_11B6BD

CODE_11B38B:
	LDA.w $61D6
	BNE.b CODE_11B39A
	LDA.b $10
	AND.w #$00FF
	CMP.w #$00A0
	BCC.b CODE_11B3C2
CODE_11B39A:
	TXA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098DDA>>16
	LDA.w #FXCODE_098DDA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_11B3C2
	STA.b $76,x
	TAY
	LDA.w $70E2,y
	STA.b $00
	LDA.w #$0200
	STA.b $02
	INC.b $18,x
	BRA.b CODE_11B3D7

CODE_11B3C2:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.b $00
	LDA.w #$0200
	STA.b $02
	LDA.w #$0002
	STA.b $18,x
	LDA.w #$0050
	STA.w $7A96,x
CODE_11B3D7:
	LDA.b $00
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.b $02
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.b #$02
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_11B407
	DEY
	DEY
CODE_11B407:
	TYA
	STA.w $7400,x
	LDA.w #$0001
	STA.w $7402,x
	LDA.w #$0003
	STA.w $7A98,x
	STZ.b $78,x
	RTL

CODE_11B41A:
	LDY.b $76,x
	LDA.w $70E2,y
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0300
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.b $76,x
	LDA.w $70E2,x
	SEC
	SBC.w $70E2,y
	BEQ.b CODE_11B458
	EOR.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_11B45E
CODE_11B458:
	LDA.w $70E2,y
	STA.w $70E2,x
CODE_11B45E:
	LDA.w $7860,y
	LSR
	BCS.b CODE_11B495
	LDA.w $7182,y
	CMP.w #$00A0
	BCS.b CODE_11B495
	LDA.w $7860,x
	LSR
	BCC.b CODE_11B495
	LDA.w $70E2,y
	SEC
	SBC.w $70E2,x
	CLC
	ADC.w #$0038
	CMP.w #$0070
	BCS.b CODE_11B495
	LDA.w $7860,x
	LSR
	BCC.b CODE_11B495
	LDA.w #$FA00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID38_BabyMarioJump
	JSL.l CODE_push_sound_queue
CODE_11B495:
	LDY.b $76,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	BNE.b CODE_11B4A4
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $18,x
	STZ.w $7A36,x
CODE_11B4A4:
	LDY.b #$09
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_11B4BE
	LDA.w $7A98,x
	BNE.b CODE_11B4C2
	LDA.w #$0003
	STA.w $7A98,x
	LDY.w $7402,x
	DEY
	BPL.b CODE_11B4BE
	LDY.b #$01
CODE_11B4BE:
	TYA
	STA.w $7402,x
CODE_11B4C2:
	RTL

DATA_11B4C3:
	dw $FD00,$0300

DATA_11B4C7:
	dw $0300,$FD00

CODE_11B4CB:
	LDY.w $7D36,x
	BPL.b CODE_11B4D3
	JMP.w CODE_11B570

CODE_11B4D3:
	LDA.w $7860,x
	LSR
	BCC.b CODE_11B502
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w $70E2,x
	CLC
	ADC.w #$0038
	CMP.w #$0070
	BCS.b CODE_11B502
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0017
	STA.w $7402,x
	LDA.w #$0003
	STA.b $18,x
	LDA.w #!Define_YI_SoundID38_BabyMarioJump
	JSL.l CODE_push_sound_queue
	RTL

CODE_11B502:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0200
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	BEQ.b CODE_11B53C
	EOR.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_11B542
CODE_11B53C:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $70E2,x
CODE_11B542:
	LDA.w $7A96,x
	BEQ.b CODE_11B567
	LDY.b #$09
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_11B561
	LDA.w $7A98,x
	BNE.b CODE_11B56F
	LDA.w #$0003
	STA.w $7A98,x
	LDY.w $7402,x
	DEY
	BPL.b CODE_11B561
	LDY.b #$01
CODE_11B561:
	TYA
	STA.w $7402,x
	BRA.b CODE_11B56F

CODE_11B567:
	LDA.w #$0009
	STA.w $7402,x
	STZ.b $18,x
CODE_11B56F:
	RTL

CODE_11B570:
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_11B5D7
	LDY.b #!Define_YI_SoundID3A_StompShyGuy
	JSL.l CODE_03A0E7
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	LDA.w #$0001
	STA.w $7A36,x
	LDA.b $18,x
	CMP.w #$0003
	BNE.b CODE_11B5BD
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_11B5A8
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_11B5BD

CODE_11B5A8:
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.w $77C2,x
	LDA.w DATA_11B4C7,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0017
	STA.w $7402,x
CODE_11B5BD:
	LDA.w #$0008
	STA.w $60C0
	LDA.w #$FA00
	STA.w $60AA
	LDY.w $77C2,x
	LDA.w DATA_11B4C3,y
	STA.w $60A8
	STA.w $60B4
	BRA.b CODE_11B62C

CODE_11B5D7:
	LDA.w $7C18,x
	CLC
	ADC.w $6122
	CLC
	ADC.w $7BB8,x
	CMP.w #$0008
	BCC.b CODE_11B5F0
	LDA.w #!Define_YI_SoundID34_BurtJump
	JSL.l CODE_push_sound_queue
	BRA.b CODE_11B5A8

CODE_11B5F0:
	LDA.w #!Define_YI_SoundID17_YoshiHurt
	JSL.l CODE_push_sound_queue
	JSL.l CODE_04F74A
	LDA.w #$00C0
	STA.w $61D6
	STZ.w $60D4
	LDA.w $60C0
	BNE.b CODE_11B617
	LDA.w $60AA
	BPL.b CODE_11B5A8
	EOR.w #$FFFF
	INC
	STA.w $60AA
	BRA.b CODE_11B617

CODE_11B617:
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.w $77C2,x
	LDA.w DATA_11B4C7,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0017
	STA.w $7402,x
CODE_11B62C:
	LDA.w #$0003
	STA.b $18,x
	RTL

CODE_11B632:
	LDA.w $7A36,x
	BNE.b CODE_11B640
	LDY.w $7D36,x
	BPL.b CODE_11B640
	JSL.l CODE_11B570
CODE_11B640:
	LDY.b #$18
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_11B648
	DEY
CODE_11B648:
	TYA
	STA.w $7402,x
	LDA.w $7860,x
	LSR
	BCC.b CODE_11B678
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.b $18,x
	LDA.w #$0019
	STA.w $7402,x
	STZ.b $78,x
	LDA.w #$0004
	STA.w $7A98,x
	STZ.w $7181,x
	LDA.w #$00C0
	STA.w $7182,x
	LDA.w $7A36,x
	BEQ.b CODE_11B678
	LDA.w #$0006
	STA.b $78,x
CODE_11B678:
	RTL

DATA_11B679:
	dw $0019,$001A,$001B,$001C,$001D,$0009,$0012,$0013
	dw $0014,$0015,$0016,$0015,$0016,$0015,$0016,$0015
	dw $0009

DATA_11B69B:
	dw $0004,$0004,$0008,$0002,$0002,$0000,$0004,$0004
	dw $0004,$0014,$0002,$0002,$0002,$0002,$0002,$0014
	dw $0000

CODE_11B6BD:
	LDA.w $7A98,x
	BNE.b CODE_11B6DB
	INC.b $78,x
	LDA.b $78,x
	ASL
	TAY
	LDA.w DATA_11B679,y
	STA.w $7402,x
	LDA.w DATA_11B69B,y
	STA.w $7A98,x
	BNE.b CODE_11B6DB
	STZ.b $18,x
	STZ.w $7A36,x
CODE_11B6DB:
	RTL

CODE_11B6DC:
	RTS

CODE_11B6DD:
	RTS

DATA_11B6DE:
	dw $2520,$2521,$2522,$257F,$2523,$2524,$E532,$A530

DATA_11B6EE:
	dw $2530,$A521,$A521,$257F,$2533,$2534,$2532,$2529

DATA_11B6FE:
	dw $2D20,$2D21,$2D22,$2D7F,$2D25,$2D21,$ED31,$2D26
	dw $AD30

DATA_11B710:
	dw $2D30,$AD21,$AD21,$2D7F,$2D35,$AD21,$2D31,$2D35
	dw $2D29,$0003,$0006

DATA_11B726:
	dw $0005,$0007

DATA_11B72A:
	dw DATA_11B72A_End
.Transfer1:
	dw $35AC,$0180 : db !REGISTER_WriteToVRAMPortLo : dl DATA_11B6DE : dw $0010,DATA_11B72A_Transfer2
.Transfer2:
	dw $35CC,$0180 : db !REGISTER_WriteToVRAMPortLo : dl DATA_11B6EE : dw $0010,DATA_11B72A_End
.End:

DATA_11B744:
	dw DATA_11B744_End
.Transfer1:
	dw $35AC,$0180 : db !REGISTER_WriteToVRAMPortLo : dl DATA_11B6FE : dw $0012,DATA_11B744_Transfer2
.Transfer2:
	dw $35CC,$0180 : db !REGISTER_WriteToVRAMPortLo : dl DATA_11B710 : dw $0012,DATA_11B744_End
.End:

CODE_11B75E:
	RTL

CODE_11B75F:
	RTL

CODE_11B760:
	RTL

CODE_11B761:
	RTL

CODE_11B762:
	RTL

CODE_11B763:
	RTL

CODE_11B764:
	RTS

CODE_11B765:
	RTS

CODE_11B766:
	RTL

CODE_11B767:
	RTL

CODE_11B768:
	RTL

CODE_11B769:
	RTL

CODE_11B76A:
	RTL

CODE_11B76B:
	RTL

CODE_11B76C:
	RTL

CODE_11B76D:
	RTL

;-------------------------------------------------------------------------
; CODE_init_mini_battle_watermelon_spit -- Per-variant init for the watermelon seed-spit mini-battle
; (gm2e/gm30 sub-mode slot 9 in DATA_bandit_minigame_init_ptrs). Sets BG mode 9, points the
; level-data ptr at DATA_15FCEB (the arena's compressed header), spawns
; one sprite $1B7 (SeedSpittingMinigameBandit), then spawns six sprite
; $1B8 (WatermelonPot) instances at hard-coded X/Y positions.
;-------------------------------------------------------------------------
CODE_init_mini_battle_watermelon_spit:
CODE_11B76E:
	REP.b #$20
	STZ.b !RAM_YI_Global_Layer1XPosLo
	STZ.b !RAM_YI_Global_Layer1YPosLo
	STZ.b !RAM_YI_Global_Layer2XPosLo
	STZ.b !RAM_YI_Global_Layer2YPosLo
	STZ.b !RAM_YI_Global_Layer3XPosLo
	STZ.b !RAM_YI_Global_Layer3YPosLo
	LDY.b #$69
	STY.w !RAM_YI_Global_BG1AddressAndSize
	STY.w !REGISTER_BG1AddressAndSize
	LDY.b #$39
	STY.w !RAM_YI_Global_BG2AddressAndSize
	STY.w !REGISTER_BG2AddressAndSize
	LDY.b #$09
	STY.w !RAM_YI_Global_BGModeAndTileSizeSetting
	STY.w !REGISTER_BGModeAndTileSizeSetting
	LDY.b #$00
	STY.w !RAM_YI_Global_HDMAEnable
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	REP.b #$20
	LDA.w #$00B0
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$0030
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STZ.w $6CAA
	STA.w !RAM_YI_Level_StarTimerLo
	STZ.w $03BC
	LDA.w #$0008
	STA.w $1100
	STA.w $1102
	LDA.w #$FFFF
	STA.w $6EB6
	STA.w $6EB8
	STA.w $6EBA
	STZ.w $6CAA
	LDA.w #DATA_15FCEB
	STA.b !RAM_YI_Level_LevelDataPtrLo
	LDA.w #$0001
	STA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	LDA.w #$01B7
	JSL.l CODE_spawn_sprite_init
	LDA.w #$01B8
	JSL.l CODE_spawn_sprite_init
	LDA.w #$0030
	STA.w $70E2,y
	LDA.w #$0050
	STA.w $7182,y
	LDA.w #$01B8
	JSL.l CODE_spawn_sprite_init
	LDA.w #$00B0
	STA.w $70E2,y
	LDA.w #$0040
	STA.w $7182,y
	LDA.w #$01B8
	JSL.l CODE_spawn_sprite_init
	LDA.w #$0020
	STA.w $70E2,y
	LDA.w #$0090
	STA.w $7182,y
	LDA.w #$01B8
	JSL.l CODE_spawn_sprite_init
	LDA.w #$00A0
	STA.w $70E2,y
	LDA.w #$0080
	STA.w $7182,y
	LDA.w #$01B8
	JSL.l CODE_spawn_sprite_init
	LDA.w #$0090
	STA.w $70E2,y
	LDA.w #$00C0
	STA.w $7182,y
	LDA.w #$01B8
	JSL.l CODE_spawn_sprite_init
	LDA.w #$00E0
	STA.w $70E2,y
	LDA.w #$00C0
	STA.w $7182,y
	JSL.l CODE_handle_sprites
	LDA.b #DATA_15FCEB>>16
	STA.b !RAM_YI_Level_LevelDataPtrBank
	JSL.l CODE_load_level_object_stream
	RTS

;-------------------------------------------------------------------------
; CODE_main_mini_battle_watermelon_spit -- Per-variant main tick for the watermelon seed-spit
; mini-battle (gm2e/gm30 sub-mode slot 9 in DATA_mini_battle_main_ptrs). Per-frame
; render+OAM+SuperFX pipeline; the spitting bandit and watermelon pot
; sprites carry their own per-instance state.
;-------------------------------------------------------------------------
CODE_main_mini_battle_watermelon_spit:
CODE_11B85C:
	JSL.l CODE_init_oam_buffer
	LDA.b #$30
	STA.w $6126
	JSL.l CODE_spr_edge_despawn_draw
	JSL.l CODE_04FA67
	STZ.w $03BA
	LDA.w $10F8
	ASL
	TAX
	JSR.w (DATA_11B886,x)
	REP.b #$20
	LDX.b #FXCODE_08B1EF>>16
	LDA.w #FXCODE_08B1EF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	RTS

DATA_11B886:
	dw CODE_11B88C
	dw CODE_11B89D
	dw CODE_11B8C2

CODE_11B88C:
	JSL.l CODE_04DD9E
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_11B89C
	JSL.l CODE_handle_sprites
	JSR.w CODE_11B8E2
CODE_11B89C:
	RTS

CODE_11B89D:
	JSL.l CODE_04DD9E
	JSL.l CODE_handle_sprites
	LDA.w $10FA
	BEQ.b CODE_11B8BF
	LDA.w $60C0
	BNE.b CODE_11B8BF
	REP.b #$20
	LDA.w #$0080
	STA.w $10F0
	SEP.b #$20
	INC.w $10F8
	INC.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
CODE_11B8BF:
	JMP.w CODE_11AEC4

CODE_11B8C2:
	JSL.l CODE_04DD9E
	JSL.l CODE_handle_sprites
	REP.b #$20
	DEC.w $10F0
	BNE.b CODE_11B8D5
	JSL.l CODE_11AD2A
CODE_11B8D5:
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	JMP.w CODE_11AEC4

DATA_11B8DE:
	dw $0001,$0002

CODE_11B8E2:
	LDA.w $03BC
	BEQ.b CODE_11B8FD
	LDA.w $03BC
	ASL
	STA.b $04
	LDA.w $1100
	SEC
	SBC.b $04
	BPL.b CODE_11B8F7
	LDA.b #$00
CODE_11B8F7:
	STA.w $1100
	STZ.w $03BC
CODE_11B8FD:
	PHB
	LDA.b #$7E4800>>16
	PHA
	PLB
	REP.b #$30
	LDX.w $7E4800
	LDA.w #$3483
	STA.w $0000,x
	LDA.w #$3495
	STA.w $001C,x
	LDA.w #$0180
	STA.w $0002,x
	STA.w $001E,x
	LDA.w #$0018
	STA.w $0004,x
	STA.w $0020,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $0005,x
	ADC.w #$001C
	STA.w $0021,x
	LDA.w #$007E
	STA.w $0007,x
	STA.w $0023,x
	LDA.w #$0010
	STA.w $0008,x
	STA.w $0024,x
	TXA
	ADC.w #$001C
	STA.w $000A,x
	ADC.w #$001C
	STA.w $0026,x
	STA.w $7E4800
	PLB
	TXA
	SEC
	SBC.w #$4802
	STA.b $04
	TAX
	LDY.w $1100
	LDA.w #$0008
	SEC
	SBC.w $1100
	STA.b $06
	CMP.w #$0008
	BEQ.b CODE_11B986
	LDA.w #$2948
CODE_11B972:
	STA.l $7E480E,x
	INX
	INX
	DEY
	BNE.b CODE_11B972
	LDA.w #$2949
	STA.l $7E480C,x
	LDA.b $06
	BEQ.b CODE_11B993
CODE_11B986:
	LDA.w #$2946
CODE_11B989:
	STA.l $7E480E,x
	INX
	INX
	DEC.b $06
	BNE.b CODE_11B989
CODE_11B993:
	LDX.b $04
	LDY.w $1102
	LDA.w #$0008
	SEC
	SBC.w $1102
	STA.b $06
	CMP.w #$0008
	BEQ.b CODE_11B9BD
	LDA.w #$2948
CODE_11B9A9:
	STA.l $7E482A,x
	INX
	INX
	DEY
	BNE.b CODE_11B9A9
	LDA.w #$2949
	STA.l $7E4828,x
	LDA.b $06
	BEQ.b CODE_11B9CA
CODE_11B9BD:
	LDA.w #$2946
CODE_11B9C0:
	STA.l $7E482A,x
	INX
	INX
	DEC.b $06
	BNE.b CODE_11B9C0
CODE_11B9CA:
	LDY.w #$0002
	LDA.w $1100
	BEQ.b CODE_11B9DA
	LDA.w $1102
	BNE.b CODE_11B9F9
	LDY.w #$0000
CODE_11B9DA:
	TYA
	LSR
	STA.w $10E6
	LDA.w DATA_11B726,y
	STA.b !RAM_YI_Global_PlayMusicLo
	LDA.w DATA_11B8DE,y
	STA.w $10F8
	LDA.w #$0200
	STA.w $10F0
	JSR.w CODE_11B9FC
	LDA.w #$0001
	STA.w $10E2
CODE_11B9F9:
	SEP.b #$30
	RTS

CODE_11B9FC:
	LDX.w #$005C
CODE_11B9FF:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	BEQ.b CODE_11BA28
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr1B7_SeedSpittingMinigameBandit
	BNE.b CODE_11BA17
	CPY.w #$0000
	BNE.b CODE_11BA17
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
CODE_11BA17:
	LDA.w $6FA2,x
	AND.w #$6000
	BNE.b CODE_11BA28
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w $7540,x
CODE_11BA28:
	STZ.w $7A38,x
	DEX
	DEX
	DEX
	DEX
	BPL.b CODE_11B9FF
	CPY.w #$0000
	BNE.b CODE_11BA68
	LDA.w $10F2
	BNE.b CODE_11BA68
	SEP.b #$10
	LDA.w #$0011
	LDY.b #$04
	JSL.l CODE_03A34E
	JSL.l CODE_random_number_gen
	AND.w #$0003
	CMP.w #$0003
	BNE.b CODE_11BA55
	LDA.w #$0000
CODE_11BA55:
	CLC
	ADC.w #$0007
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0098
	STA.w $7182,y
	LDA.w #$0078
	STA.w $70E2,y
CODE_11BA68:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Sprite $1B7 -- Bandit (seed-spitting mini-battle).
; Raidenthequick aliases: init_mini_battle_bandit_3 / main_mini_battle_bandit_3.
; Used in the "spit watermelon seeds at the bandit" room.
;-------------------------------------------------------------------------
YI_NorSpr1B7_SeedSpittingMinigameBandit_Init:
;$11BA69
	LDA.w #$00C0
	STA.w $7182,x
	LDA.w #$00C0
	STA.w $70E2,x
	LDA.w #$0004
	STA.w $7A96,x
	RTL

;---------------------------------------------------------------------------

DATA_11BA7C:
	dw $0002,$0003,$0004,$0005,$0006,$0007,$0000,$0001
	dw $0008,$0009,$000A,$000B,$000C,$000D,$000E,$000F
	dw $0010,$0011,$0012,$0013,$0014,$0015,$0016,$0017
	dw $0018,$0019,$001A,$001B,$001A

DATA_11BAB6:
	dw $0004,$0004,$0004,$0004,$0004,$0004,$0000,$0000
	dw $0002,$0002,$0008,$0008,$0000,$0000,$0000,$0000
	dw $0000,$0002,$0002,$0002,$0002,$0002,$0002,$0002
	dw $0002,$0000,$0000,$0000,$0000

DATA_11BAF0:
	dw $0000,$0006,$0008,$000A,$000C,$0013,$0019

DATA_11BAFE:
	dw $0006,$0008,$000A,$000C,$0013,$0019,$001D

DATA_11BB0C:
	dw $0008,$0000

YI_NorSpr1B7_SeedSpittingMinigameBandit_Main:
;$11BB10
	LDA.w $10F8
	BEQ.b CODE_11BB1E
	LDA.w #$0005
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	JMP.w CODE_11BC1B

CODE_11BB1E:
	LDY.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_11BB0C,y
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	REP.b #$10
	LDA.w #$0010
	STA.b $00
	LDA.w #$0600
	LDY.w !REGISTER_SuperFX_R6_MultiplierLo
	BEQ.b CODE_11BB55
	LDY.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BNE.b CODE_11BB55
	STZ.b $00
	LDA.w #$0000
CODE_11BB55:
	STA.b $02
	SEP.b #$10
	LDA.w $6FA0,x
	AND.w #$F9FF
	ORA.b $02
	STA.w $6FA0,x
	LDA.w $7040,x
	AND.w #$FFEF
	ORA.b $00
	STA.w $7040,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_11BB98
	LDY.w $7D36,x
	BEQ.b CODE_11BBD9
	BMI.b CODE_11BBD9
	DEY
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr107_WatermelonSeed
	BNE.b CODE_11BBD9
	LDA.w $7A38,y
	BNE.b CODE_11BBD9
	LDA.w $7AF6,x
	BNE.b CODE_11BBD9
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	BRA.b CODE_11BBB0

CODE_11BB98:
	PLA
	PLY
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w $7AF6,x
	BNE.b CODE_11BBD9
	LDA.w $1102
	BEQ.b CODE_11BBB0
	DEC.w $1102
	DEC.w $1102
CODE_11BBB0:
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.b $18,x
	LDA.w #$0080
	STA.w $7AF6,x
	LDA.w #$0020
	STA.w $7042,x
	LDA.w #!Define_YI_SoundID75_LitterMouserSqueak
	JSL.l CODE_push_sound_queue
	LDA.w $1102
	BEQ.b CODE_11BBD9
	DEC.w $1102
	DEC.w $1102
CODE_11BBD9:
	SEP.b #$20
	LDY.b #$04
	LDA.w $7AF6,x
	AND.b #$04
	BEQ.b CODE_11BBE6
	LDY.b #$FF
CODE_11BBE6:
	TYA
	STA.w $74A2,x
	REP.b #$20
	LDA.w $7680,x
	CMP.w #$0010
	BCS.b CODE_11BC04
	LDA.w #$0010
	SEC
	SBC.w $7680,x
	CLC
	ADC.w $70E2,x
	STA.w $70E2,x
	BRA.b CODE_11BC18

CODE_11BC04:
	LDA.w $7680,x
	SEC
	SBC.w #$00E0
	BMI.b CODE_11BC1B
	STA.b $00
	LDA.w $70E2,x
	SEC
	SBC.b $00
	STA.w $70E2,x
CODE_11BC18:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_11BC1B:
	PEA.w CODE_11BC2A-$01
	LDA.b $18,x
	ASL
	TAY
	LDA.w DATA_11BCE7,y
	STA.b $00
	JMP.w ($0000+$7960)
CODE_11BC2A:
	LDA.w $110A
	BEQ.b CODE_11BC30
CODE_11BC2F:
	RTL

CODE_11BC30:
	LDA.w $7A98,x
	BNE.b CODE_11BC2F
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_11BC41
	LDA.w #$0013
	STA.w $7402,x
	RTL

CODE_11BC41:
	BPL.b CODE_11BC47
	EOR.w #$FFFF
	INC
CODE_11BC47:
	CMP.w #$0100
	BCS.b CODE_11BC5B
	LDA.w #$0005
	CMP.w $110E
	BEQ.b CODE_11BC67
	STA.w $110E
	ASL
	TAY
	BRA.b CODE_11BC83

CODE_11BC5B:
	LDA.w $110E
	BEQ.b CODE_11BC67
	STZ.w $110E
	LDY.b #$00
	BRA.b CODE_11BC83

CODE_11BC67:
	LDA.w $7860,x
	LSR
	BCS.b CODE_11BC73
	LDA.w #$0001
	STA.w $110C
CODE_11BC73:
	LDA.w $110E
	ASL
	TAY
	LDA.b $16,x
	INC
	CMP.w DATA_11BAFE,y
	BNE.b CODE_11BC86
	STZ.w $110C
CODE_11BC83:
	LDA.w DATA_11BAF0,y
CODE_11BC86:
	STA.b $16,x
	ASL
	TAY
	LDA.w DATA_11BA7C,y
	STA.w $7402,x
	LDA.w DATA_11BAB6,y
	STA.w $7A98,x
	LDA.w $110C
	BEQ.b CODE_11BCE6
	LDA.w $7860,x
	LSR
	BCC.b CODE_11BCBC
	STZ.w $110C
	STZ.w $110E
	LDY.b #$00
	LDA.w DATA_11BAF0,y
	STA.b $16,x
	LDA.w DATA_11BA7C,y
	STA.w $7402,x
	LDA.w DATA_11BAB6,y
	STA.w $7A98,x
	BRA.b CODE_11BCE6

CODE_11BCBC:
	LDY.b #$00
	LDA.w $7182,x
	CMP.w #$FD00
	BCC.b CODE_11BCDE
	INY
	CMP.w #$FF00
	BCC.b CODE_11BCDE
	INY
	CMP.w #$0000
	BCC.b CODE_11BCDE
	CMP.w #$0100
	BCC.b CODE_11BCDE
	INY
	CMP.w #$0300
	BCC.b CODE_11BCDE
	INY
CODE_11BCDE:
	TYA
	CLC
	ADC.w #$000C
	STA.w $7402,x
CODE_11BCE6:
	RTL

DATA_11BCE7:
	dw CODE_11BCF3
	dw CODE_11BD7C
	dw CODE_11C013
	dw CODE_11C2CF
	dw CODE_11C3E1
	dw CODE_11BCFD

CODE_11BCF3:
	LDA.w $1104
	BEQ.b CODE_11BCFE
	LDA.w #$0002
	STA.b $18,x
CODE_11BCFD:
	RTS

CODE_11BCFE:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098DDA>>16
	LDA.w #FXCODE_098DDA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_11BD7B
	STA.b $76,x
	TAY
	LDA.w $7860,x
	LSR
	BCC.b CODE_11BD7B
	LDA.w $70E2,y
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7182,y
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0200
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	BPL.b CODE_11BD69
	LDY.b $76,x
	LDA.w $7182,x
	SEC
	SBC.w $7182,y
	CMP.w #$0020
	BCS.b CODE_11BD5C
	LDA.w #$FC00
	BRA.b CODE_11BD5F

CODE_11BD5C:
	LDA.w #$FA80
CODE_11BD5F:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID38_BabyMarioJump
	JSL.l CODE_push_sound_queue
CODE_11BD69:
	LDY.b #$02
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_11BD75
	LDY.b #$00
CODE_11BD75:
	TYA
	STA.w $7400,x
	INC.b $18,x
CODE_11BD7B:
	RTS

CODE_11BD7C:
	LDA.w $6150
	BEQ.b CODE_11BDAE
	LDA.w !EXRAM_YI_Level_Player_AmmoTypeInMouthLo|!EXRAMBankMirror
	BEQ.b CODE_11BDAE
	LDA.b $02
	BEQ.b CODE_11BDAE
	LDA.w $7860,x
	LSR
	BCC.b CODE_11BDAE
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0010
	CMP.w #$0031
	BCS.b CODE_11BDAE
	LDA.w #$FA80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID38_BabyMarioJump
	JSL.l CODE_push_sound_queue
	RTS

CODE_11BDAE:
	LDY.w $7D36,x
	BEQ.b CODE_11BDEE
	BMI.b CODE_11BDEE
	DEY
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_11BDEE
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr007_Watermelon
	BEQ.b CODE_11BDCB
	CMP.w #!Define_YI_NorSpr009_FireWatermelon
	BNE.b CODE_11BDEE
CODE_11BDCB:
	STA.w $1104
	LDA.w #$0003
	STA.w $1106
	TYX
	JSL.l CODE_03A31E
	LDX.b $12
	INC.b $18,x
	RTS

CODE_11BDDE:
	LDA.w $0030
	AND.w #$0008
	LSR
	LSR
	LSR
	ORA.w #$000A
	STA.w $7402,x
	RTS

CODE_11BDEE:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_098DDA>>16
	LDA.w #FXCODE_098DDA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_11BDDE
	STA.b $76,x
	LDA.b $78,x
	BEQ.b CODE_11BE31
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_11BE20
	LDA.w $70E2,x
	CMP.w #$0010
	BCS.b CODE_11BE2E
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $7400,x
	BRA.b CODE_11BE2E

CODE_11BE20:
	LDA.w $70E2,x
	CMP.w #$00E0
	BCC.b CODE_11BE2E
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $7400,x
CODE_11BE2E:
	JMP.w CODE_11BEC4

CODE_11BE31:
	LDA.w $7860,x
	LSR
	BCS.b CODE_11BE3A
	JMP.w CODE_11BED0

CODE_11BE3A:
	LDY.b #$00
	LDA.w $70E2,x
	SEC
	SBC.w #$0080
	BPL.b CODE_11BE47
	LDY.b #$02
CODE_11BE47:
	TYA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $7400,x
	LDY.b $76,x
	LDA.w $70E2,x
	SEC
	SBC.w $70E2,y
	CLC
	ADC.w #$0010
	CMP.w #$0021
	BCS.b CODE_11BED0
	LDA.w $7182,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	SEC
	SBC.w $7182,y
	CLC
	ADC.w #$0020
	LDY.b #$01
	CMP.w #$0031
	BCC.b CODE_11BED0
	BMI.b CODE_11BEC1
	CMP.w #$00A1
	BCS.b CODE_11BED0
	LDA.w #$FE00
	LDY.w $70E2,x
	CPY.b #$31
	BCS.b CODE_11BE89
	LDA.w #$0200
CODE_11BE89:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w $70E2,x
	SEC
	SBC.w #$0010
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDY.b #$02
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_11BEC1
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	PHY
	LDA.w #!Define_YI_SoundID38_BabyMarioJump
	JSL.l CODE_push_sound_queue
	PLY
CODE_11BEC1:
	TYA
	STA.b $78,x
CODE_11BEC4:
	LDA.b $78,x
	ASL
	TAY
	LDA.w DATA_11BF47-$02,y
	STA.b $00
	JMP.w ($0000+$7960)

CODE_11BED0:
	LDY.b $76,x
	LDA.w $70E2,y
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7182,y
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0200
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.b #$02
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_11BF07
	LDY.b #$00
CODE_11BF07:
	TYA
	STA.w $7400,x
	LDA.w $7860,x
	LSR
	BCC.b CODE_11BF46
	LDA.w $7860,x
	AND.w DATA_11C00B,y
	BEQ.b CODE_11BF26
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID38_BabyMarioJump
	JSL.l CODE_push_sound_queue
CODE_11BF26:
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	BPL.b CODE_11BF46
	LDY.b $76,x
	LDA.w $7182,x
	SEC
	SBC.w $7182,y
	CMP.w #$0020
	BCC.b CODE_11BF46
	LDA.w #$FA80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID38_BabyMarioJump
	JSL.l CODE_push_sound_queue
CODE_11BF46:
	RTS

DATA_11BF47:
	dw CODE_11BF53
	dw CODE_11BF9E

DATA_11BF4B:
	dw $FE00,$0200

DATA_11BF4F:
	dw $FFF0,$0010

CODE_11BF53:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w DATA_11BF4B,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7860,x
	LSR
	BCC.b CODE_11BF8F
	LDA.w $70E2,x
	CLC
	ADC.w DATA_11BF4F,y
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_11BF8F
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID38_BabyMarioJump
	JSL.l CODE_push_sound_queue
CODE_11BF8F:
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CMP.w #$0028
	BCC.b CODE_11BF9D
	STZ.b $78,x
CODE_11BF9D:
	RTS

CODE_11BF9E:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7400,x
	LDY.w $7400,x
	LDA.w $7860,x
	LSR
	BCC.b CODE_11BFDD
	LDA.w $70E2,x
	CLC
	ADC.w DATA_11BF4F,y
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_11BFDD
	LDA.w #$FA80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID38_BabyMarioJump
	JSL.l CODE_push_sound_queue
CODE_11BFDD:
	LDY.b $76,x
	LDA.w $70E2,x
	SEC
	SBC.w $70E2,y
	CLC
	ADC.w #$0010
	CMP.w #$0021
	BCC.b CODE_11BFFA
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0002
	STA.w $7400,x
	STZ.b $78,x
CODE_11BFFA:
	RTS

DATA_11BFFB:
	dw $FFEC,$0014

DATA_11BFFF:
	dw $FFF7,$0009

DATA_11C003:
	dw $FFF0,$0010,$0000,$0000

DATA_11C00B:
	dw $0008,$0004

DATA_11C00F:
	dw $FF00,$0100

CODE_11C013:
	LDA.w $7A36,x
	BNE.b CODE_11C04E
	LDY.b #$02
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0010
	BMI.b CODE_11C030
	LDY.b #$04
	CMP.w #$0031
	BCS.b CODE_11C030
	LDY.b #$06
CODE_11C030:
	TYA
	STA.w $7A36,x
	LDY.b #$02
	LDA.w $70E2,x
	CMP.w #$0020
	BCC.b CODE_11C048
	LDY.b #$00
	CMP.w #$00D0
	BCS.b CODE_11C048
	LDY.w $60C4
CODE_11C048:
	TYA
	STA.w $7A38,x
	BRA.b CODE_11C064

CODE_11C04E:
	LDA.w $70E2,x
	CMP.w #$00E0
	BCS.b CODE_11C05B
	CMP.w #$0012
	BCS.b CODE_11C064
CODE_11C05B:
	LDA.w $7A38,x
	EOR.w #$0002
	STA.w $7A38,x
CODE_11C064:
	PEA.w CODE_11C072-$01
	LDY.w $7A36,x
	LDA.w DATA_11C085-$02,y
	STA.b $00
	JMP.w ($0000+$7960)
CODE_11C072:
	LDA.w $7A36,x
	BEQ.b CODE_11C084
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_11C080
	LDY.b #$02
CODE_11C080:
	TYA
	STA.w $7400,x
CODE_11C084:
	RTS

DATA_11C085:
	dw CODE_11C08B
	dw CODE_11C0EF
	dw CODE_11C1D2

CODE_11C08B:
	LDY.w $7A38,x
	LDA.w $7860,x
	AND.w DATA_11C00B,y
	BNE.b CODE_11C09C
	LDA.w DATA_11C00F,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_11C09C:
	LDA.w $7860,x
	LSR
	BCC.b CODE_11C0EE
	LDA.w $70E2,x
	CLC
	ADC.w DATA_11BF4F,y
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_11C0D3
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID38_BabyMarioJump
	JSL.l CODE_push_sound_queue
CODE_11C0D3:
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0010
	CMP.w #$0031
	BCC.b CODE_11C0E5
	BMI.b CODE_11C0EE
CODE_11C0E5:
	STZ.w $7A36,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_11C0EE:
	RTS

CODE_11C0EF:
	LDY.w $7A38,x
	LDA.w $7860,x
	AND.w DATA_11C00B,y
	BNE.b CODE_11C100
	LDA.w DATA_11C00F,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_11C100:
	LDA.w $7860,x
	LSR
	BCC.b CODE_11C121
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0010
	BMI.b CODE_11C118
	CMP.w #$0031
	BCS.b CODE_11C122
CODE_11C118:
	STZ.w $7A36,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_11C121:
	RTS

CODE_11C122:
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.b $04
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	SEC
	SBC.w #$0040
	STA.b $06
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BNE.b CODE_11C19D
	LDA.b $04
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b $06
	CLC
	ADC.w #$0010
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$0001
	BNE.b CODE_11C18C
	LDA.b $04
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b $06
	CLC
	ADC.w #$0020
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$0001
	BEQ.b CODE_11C19D
CODE_11C18C:
	LDA.w #$FA80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID38_BabyMarioJump
	JSL.l CODE_push_sound_queue
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_11C19D:
	LDY.w $7A38,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_11BF4F,y
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_11C1D1
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID38_BabyMarioJump
	JSL.l CODE_push_sound_queue
CODE_11C1D1:
	RTS

CODE_11C1D2:
	LDA.w $7A96,x
	BNE.b CODE_11C21F
	LDY.w $7A38,x
	LDA.w $7860,x
	AND.w DATA_11C00B,y
	BNE.b CODE_11C1E8
	LDA.w DATA_11C00F,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_11C1E8:
	LDA.w $7860,x
	LSR
	BCC.b CODE_11C21F
	LDA.w $70E2,x
	CLC
	ADC.w DATA_11BF4F,y
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_11C220
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID38_BabyMarioJump
	JSL.l CODE_push_sound_queue
CODE_11C21F:
	RTS

CODE_11C220:
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0010
	CMP.w #$0031
	BCS.b CODE_11C2AA
	LDA.w $61D6
	BNE.b CODE_11C21F
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w $70E2,x
	CLC
	ADC.w #$0060
	CMP.w #$00C1
	BCS.b CODE_11C21F
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $02
	BEQ.b CODE_11C2B4
	INC.b $18,x
	LDY.b #$02
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CMP.w $70E2,x
	BCS.b CODE_11C25D
	LDY.b #$00
CODE_11C25D:
	TYA
	STA.w $7400,x
	LDA.w #$001E
	STA.w $7A96,x
CODE_11C267:
	STZ.w $7402,x
	LDA.w $7182,x
	CLC
	ADC.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDY.b #$00
	LDA.w $1104
	CMP.w #$0009
	BEQ.b CODE_11C280
	LDY.b #$04
CODE_11C280:
	TYA
	ORA.w $7400,x
	TAY
	LDA.w $70E2,x
	CLC
	ADC.w DATA_11BFFB,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w DATA_11C003,y
	STA.w $7A38,x
	LDA.w #$0030
	STA.w $7042,x
	LDY.b #$06
	STY.w $1108
	LDA.w #$0001
	STA.w $110A
	STZ.w $7A36,x
	RTS

CODE_11C2AA:
	STZ.w $7A36,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

CODE_11C2B4:
	LDY.w $60C4
	LDA.w DATA_11C00F,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.b $10
	TAY
	CPY.b #$F8
	BCC.b CODE_11C2CE
	TYA
	AND.w #$003F
	STA.w $7A96,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_11C2CE:
	RTS

CODE_11C2CF:
	LDA.w $7A96,x
	BNE.b CODE_11C308
	LDA.w $1108
	BNE.b CODE_11C309
	LDA.w #$0002
	DEC.w $1106
	BNE.b CODE_11C2E7
	STZ.w $1104
	LDA.w #$0000
CODE_11C2E7:
	STA.b $18,x
	STZ.w $110E
	LDY.b #$00
	LDA.w DATA_11BAF0,y
	STA.b $16,x
	LDA.w DATA_11BA7C,y
	STA.w $7402,x
	LDA.w DATA_11BAB6,y
	STA.w $7A98,x
	LDA.w #$0020
	STA.w $7042,x
	STZ.w $110A
CODE_11C308:
	RTS

CODE_11C309:
	LDA.w #$0001
	STA.w $7402,x
	LDA.w $1104
	CMP.w #$0007
	BNE.b CODE_11C371
	LDY.w $7400,x
	LDA.w $7182,x
	CLC
	ADC.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_11BFFF,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0006
	STA.w $7A96,x
	LDA.w #$0107
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_11C36F
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $7182,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $70E2,y
	LDA.w #$0001
	STA.w $7D38,y
	STA.w $7A38,y
	LDA.w $7400,x
	STA.w $7400,y
	TAX
	LDA.w #$FC00
	CPX.b #$00
	BEQ.b CODE_11C363
	LDA.w #$0400
CODE_11C363:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #!Define_YI_SoundID45_SpitSeed
	JSL.l CODE_push_sound_queue
	LDX.b $12
CODE_11C36F:
	BRA.b CODE_11C3DD

CODE_11C371:
	LDA.w #$0018
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_11C3DD
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $7182,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $70E2,y
	LDA.w #$0001
	STA.w $7A38,y
	LDA.w $7400,x
	STA.w $7400,y
	LDA.w #$0010
	STA.w $7A96,y
	LDA.w $7042,y
	AND.w #$00F1
	ORA.w #$0006
	STA.w $7042,y
	SEP.b #$20
	LDA.b #$29
	STA.w $7180,y
	REP.b #$20
	LDA.w #$0002
	STA.w $7A96,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	BEQ.b CODE_11C3D3
	STZ.w $1108
	RTS

CODE_11C3D3:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	CLC
	ADC.w $7A38,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
CODE_11C3DD:
	DEC.w $1108
	RTS

CODE_11C3E1:
	LDA.w $7860,x
	LSR
	BCC.b CODE_11C44A
	LDA.w $7AF8,x
	BNE.b CODE_11C3F5
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $7AF8,x
CODE_11C3F5:
	AND.w #$0008
	LSR
	LSR
	LSR
	ORA.w #$0008
	STA.w $7402,x
	LDA.w $7AF8,x
	CMP.w #$0001
	BNE.b CODE_11C44A
	STZ.b $18,x
	LDA.w #$0002
	STA.w $7402,x
	LDA.w $110A
	BEQ.b CODE_11C44A
	LDA.w $1108
	BEQ.b CODE_11C43A
	CMP.w #$0006
	BEQ.b CODE_11C428
	LDA.w $1104
	CMP.w #$0009
	BEQ.b CODE_11C43A
CODE_11C428:
	LDA.w #$0003
	STA.b $18,x
	LDA.w #$0030
	STA.w $7042,x
	LDA.w #$0001
	STA.w $7402,x
	RTS

CODE_11C43A:
	STZ.w $110A
	LDA.w $1106
	BEQ.b CODE_11C44A
	DEC.w $1106
	BNE.b CODE_11C44A
	STZ.w $1104
CODE_11C44A:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Sprite $1B8 -- Watermelon Pot (seed-source for the seed-spit mini-battles).
; Raidenthequick aliases: init_mini_battle_watermelon_pot / main_mini_battle_watermelon_pot.
;-------------------------------------------------------------------------
YI_NorSpr1B8_WatermelonPot_Init:
;$11C44B
	LDY.w !REGISTER_SoftwareLatchForHVCounter
	LDY.w !REGISTER_PPUStatusFlag2
	LDA.w !REGISTER_HCounter
	CLC
	ADC.b $10
	STA.b $10
	AND.w #$00FF
	STA.w $7A96,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr1B8_WatermelonPot_Main:
;$11C460
	LDA.b $18,x
	ASL
	TAY
	LDA.w DATA_11C46C,y
	STA.b $00
	JMP.w ($0000+$7960)

DATA_11C46C:
	dw CODE_11C482
	dw CODE_11C4E3
	dw CODE_11C4F3

DATA_11C472:
	dw $0007,$0007,$0009,$0007,$0007,$0009,$0007,$0007

CODE_11C482:
	LDA.w $7A96,x
	BNE.b CODE_11C4E2
	LDA.w $10FE
	CMP.w #$0002
	BEQ.b CODE_11C4DC
	INC.w $1110
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.w #$0007
	ASL
	TAY
	LDA.w DATA_11C472,y
	TAY
	CMP.w #$0007
	BEQ.b CODE_11C4B2
	LDA.w $1110
	CMP.w #$0004
	BCC.b CODE_11C4B0
	STZ.w $1110
	BRA.b CODE_11C4B2

CODE_11C4B0:
	LDY.b #$07
CODE_11C4B2:
	TYA
	JSL.l CODE_spawn_sprite_active
	LDA.w $6FA0,y
	AND.w #$F9FF
	ORA.w #$0200
	STA.w $6FA0,y
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	TYA
	STA.b $76,x
	LDA.w #$0010
	STA.b $16,x
	INC.w $10FE
	INC.b $18,x
CODE_11C4DC:
	LDA.w #$0100
	STA.w $7A96,x
CODE_11C4E2:
	RTL

CODE_11C4E3:
	LDY.b $76,x
	LDA.w $7182,y
	DEC
	STA.w $7182,y
	DEC.b $16,x
	BNE.b CODE_11C4F2
	INC.b $18,x
CODE_11C4F2:
	RTL

CODE_11C4F3:
	LDY.b $76,x
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	BNE.b CODE_11C505
	STZ.b $18,x
	LDA.w #$0100
	STA.w $7A96,x
	DEC.w $10FE
CODE_11C505:
	RTL

;-------------------------------------------------------------------------
; CODE_init_mini_battle_watermelon_spit_2p -- Per-variant init for the two-player watermelon seed-spit
; mini-battle (gm2e/gm30 sub-mode slot 10 in DATA_bandit_minigame_init_ptrs). Mirror of the
; one-player init at CODE_init_mini_battle_watermelon_spit, but spawns sprite $1B9
; (P2SeedSpittingMinigameBandit) for the second seed-spitter instead of
; $1B7. Same six WatermelonPot ($1B8) layout.
;-------------------------------------------------------------------------
CODE_init_mini_battle_watermelon_spit_2p:
CODE_11C506:
	REP.b #$20
	STZ.b !RAM_YI_Global_Layer1XPosLo
	STZ.b !RAM_YI_Global_Layer1YPosLo
	STZ.b !RAM_YI_Global_Layer2XPosLo
	STZ.b !RAM_YI_Global_Layer2YPosLo
	STZ.b !RAM_YI_Global_Layer3XPosLo
	STZ.b !RAM_YI_Global_Layer3YPosLo
	LDY.b #$69
	STY.w !RAM_YI_Global_BG1AddressAndSize
	STY.w !REGISTER_BG1AddressAndSize
	LDY.b #$39
	STY.w !RAM_YI_Global_BG2AddressAndSize
	STY.w !REGISTER_BG2AddressAndSize
	LDY.b #$09
	STY.w !RAM_YI_Global_BGModeAndTileSizeSetting
	STY.w !REGISTER_BGModeAndTileSizeSetting
	LDY.b #$00
	STY.w !RAM_YI_Global_HDMAEnable
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	REP.b #$20
	LDA.w #$00B0
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$0030
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STZ.w $6CAA
	STA.w !RAM_YI_Level_StarTimerLo
	STZ.w $03BC
	LDA.w #$0008
	STA.w $1100
	STA.w $1102
	LDA.w #$0001
	STA.w $10F2
	LDA.w #$FFFF
	STA.w $6EB6
	STA.w $6EB8
	STA.w $6EBA
	STZ.w $6CAA
	LDA.w #DATA_15FCEB
	STA.b !RAM_YI_Level_LevelDataPtrLo
	LDA.w #$0001
	STA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	LDA.w #$01B9
	JSL.l CODE_spawn_sprite_init
	LDA.w #$01B8
	JSL.l CODE_spawn_sprite_init
	LDA.w #$0030
	STA.w $70E2,y
	LDA.w #$0050
	STA.w $7182,y
	LDA.w #$01B8
	JSL.l CODE_spawn_sprite_init
	LDA.w #$00B0
	STA.w $70E2,y
	LDA.w #$0040
	STA.w $7182,y
	LDA.w #$01B8
	JSL.l CODE_spawn_sprite_init
	LDA.w #$0020
	STA.w $70E2,y
	LDA.w #$0090
	STA.w $7182,y
	LDA.w #$01B8
	JSL.l CODE_spawn_sprite_init
	LDA.w #$00A0
	STA.w $70E2,y
	LDA.w #$0080
	STA.w $7182,y
	LDA.w #$01B8
	JSL.l CODE_spawn_sprite_init
	LDA.w #$0090
	STA.w $70E2,y
	LDA.w #$00C0
	STA.w $7182,y
	LDA.w #$01B8
	JSL.l CODE_spawn_sprite_init
	LDA.w #$00E0
	STA.w $70E2,y
	LDA.w #$00C0
	STA.w $7182,y
	JSL.l CODE_handle_sprites
	LDA.b #DATA_15FCEB>>16
	STA.b !RAM_YI_Level_LevelDataPtrBank
	JSL.l CODE_load_level_object_stream
	RTS

;-------------------------------------------------------------------------
; CODE_main_mini_battle_watermelon_spit_2p -- Per-variant main tick for the two-player watermelon
; seed-spit mini-battle (gm2e/gm30 sub-mode slot 10 in DATA_mini_battle_main_ptrs).
; Per-frame OAM clear + render + SuperFX tick, with a victory-pose branch
; once $7E:1100 / $7E:1102 (the two players' remaining-watermelon counts)
; resolve.
;-------------------------------------------------------------------------
CODE_main_mini_battle_watermelon_spit_2p:
CODE_11C5FA:
	JSL.l CODE_init_oam_buffer
	LDA.b #$30
	STA.w $6126
	JSL.l CODE_spr_edge_despawn_draw
	JSL.l CODE_04FA67
	STZ.w $03BA
	LDA.w $1100
	BEQ.b CODE_11C618
	LDA.w $1102
	BNE.b CODE_11C622
CODE_11C618:
	LDA.b #$01
	STA.w $10FA
	JSR.w CODE_11AEC4
	BRA.b CODE_11C632

CODE_11C622:
	JSL.l CODE_04DD9E
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_11C632
	JSL.l CODE_handle_sprites
	JSR.w CODE_11B8E2
CODE_11C632:
	REP.b #$20
	LDX.b #FXCODE_08B1EF>>16
	LDA.w #FXCODE_08B1EF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Sprite $1B9 -- Bandit phase-2 (advanced seed-spitting mini-battle).
; Raidenthequick aliases: init_mini_battle_bandit_4 / main_mini_battle_bandit_4.
; A faster / harder seed-spit bandit variant (the "P2" suggests phase 2).
;-------------------------------------------------------------------------
YI_NorSpr1B9_P2SeedSpittingMinigameBandit_Init:
;$11C640
	LDA.w #$00C0
	STA.w $7182,x
	LDA.w #$00C0
	STA.w $70E2,x
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w #$0030
	STA.w $7042,x
	RTL

;---------------------------------------------------------------------------

DATA_11C659:
	dw $FFF0,$0010,$FF00,$0100

DATA_11C661:
	dw $0040,$FFC0

DATA_11C665:
	dw $FDC0,$0240,$FDC0,$0240

DATA_11C66D:
	dw $0010,$00E0

DATA_11C671:
	dw $0010,$00E0,$0011,$0012

YI_NorSpr1B9_P2SeedSpittingMinigameBandit_Main:
;$11C679
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BNE.b CODE_11C6A2
	LDY.w $7D36,x
	BEQ.b CODE_11C6D8
	BMI.b CODE_11C6D8
	DEY
	LDA.w $7AF6,x
	BNE.b CODE_11C6D8
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr107_WatermelonSeed
	BNE.b CODE_11C6D8
	LDA.w $7A38,y
	BNE.b CODE_11C6D8
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	BRA.b CODE_11C6BA

CODE_11C6A2:
	PLA
	PLY
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w $7AF6,x
	BNE.b CODE_11C6D8
	LDA.w $1102
	BEQ.b CODE_11C6BA
	DEC.w $1102
	DEC.w $1102
CODE_11C6BA:
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0080
	STA.w $7AF6,x
	LDA.w #!Define_YI_SoundID75_LitterMouserSqueak
	JSL.l CODE_push_sound_queue
	LDA.w $1102
	BEQ.b CODE_11C6D8
	DEC.w $1102
	DEC.w $1102
CODE_11C6D8:
	LDA.w #$0010
	LDY.w $7AF6,x
	BEQ.b CODE_11C6E3
	LDA.w #$0000
CODE_11C6E3:
	STA.b $00
	LDA.w $7040,x
	AND.w #$FFEF
	ORA.b $00
	STA.w $7040,x
	SEP.b #$20
	LDY.b #$04
	LDA.w $7AF6,x
	AND.b #$04
	BEQ.b CODE_11C6FD
	LDY.b #$FF
CODE_11C6FD:
	TYA
	STA.w $74A2,x
	REP.b #$20
	LDY.w $7400,x
	BNE.b CODE_11C720
	LDA.w $7680,x
	CMP.w #$0010
	BCS.b CODE_11C737
	LDA.w #$0010
	SEC
	SBC.w $7680,x
	CLC
	ADC.w $70E2,x
	STA.w $70E2,x
	BRA.b CODE_11C734

CODE_11C720:
	LDA.w $7680,x
	SEC
	SBC.w #$00E0
	BMI.b CODE_11C737
	STA.b $00
	LDA.w $70E2,x
	SEC
	SBC.b $00
	STA.w $70E2,x
CODE_11C734:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_11C737:
	LDA.w $1104
	BNE.b CODE_11C767
	LDY.w $7D36,x
	BEQ.b CODE_11C780
	BMI.b CODE_11C780
	DEY
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_11C767
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr007_Watermelon
	BEQ.b CODE_11C759
	CMP.w #!Define_YI_NorSpr009_FireWatermelon
	BNE.b CODE_11C780
CODE_11C759:
	STA.w $1104
	LDA.w #$0003
	STA.w $1106
	TYX
	JSL.l CODE_03A31E
CODE_11C767:
	LDA.w $110A
	BNE.b CODE_11C775
	LDA.w $0942
	ASL
	BPL.b CODE_11C780
	JSR.w CODE_11C267
CODE_11C775:
	JSR.w CODE_11C2CF
	LDA.w #$0030
	STA.w $7042,x
	BRA.b CODE_11C79E

CODE_11C780:
	LDA.w $110C
	BNE.b CODE_11C79E
	LDA.w $0941
	AND.w #$0004
	BEQ.b CODE_11C79E
	LDA.w $1112
	BNE.b CODE_11C79B
	LDA.w #$0004
	STA.w $7BB8,x
	STA.w $1112
CODE_11C79B:
	JMP.w CODE_11C82B

CODE_11C79E:
	LDA.w #$0006
	STA.w $7BB8,x
	STZ.w $1112
	LDY.b #$C0
	LDA.w $0940
	BPL.b CODE_11C7D8
	LDY.b #$20
	LDA.w $110C
	BNE.b CODE_11C7D8
	LDA.w $7860,x
	LSR
	BCC.b CODE_11C7D8
	LDA.w $0942
	BPL.b CODE_11C7D8
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	PHY
	LDA.w #!Define_YI_SoundID38_BabyMarioJump
	JSL.l CODE_push_sound_queue
	PLY
	LDA.w #$0001
	STA.w $110C
	STA.w $7A96,x
CODE_11C7D8:
	TYA
	STA.w $7542,x
	LDA.w $0941
	AND.w #$0003
	BEQ.b CODE_11C82B
	AND.w #$0001
	ASL
	TAY
	EOR.w $7400,x
	BEQ.b CODE_11C803
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CPY.b #$02
	BEQ.b CODE_11C7F9
	EOR.w #$FFFF
	INC
CODE_11C7F9:
	CMP.w #$00C0
	BPL.b CODE_11C803
	TYA
	ORA.w #$0004
	TAY
CODE_11C803:
	LDA.w $70E2,x
	CMP.w DATA_11C66D,y
	BEQ.b CODE_11C82B
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w DATA_11C659,y
	CMP.w DATA_11C665,y
	BEQ.b CODE_11C81A
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_11C81A:
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_11C84A
	BMI.b CODE_11C825
	LDY.b #$02
CODE_11C825:
	TYA
	STA.w $7400,x
	BRA.b CODE_11C84A

CODE_11C82B:
	LDA.w $110C
	BNE.b CODE_11C84A
	LDY.w $7400,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_11C84A
	CLC
	ADC.w DATA_11C661,y
	STA.b $00
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_11C845
	STZ.b $00
CODE_11C845:
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_11C84A:
	LDA.w $110A
	BNE.b CODE_11C8BF
	LDA.w $110C
	BEQ.b CODE_11C88E
	LDA.w $7860,x
	LSR
	BCC.b CODE_11C875
	LDA.w $7A96,x
	BNE.b CODE_11C8BF
	LDY.b #$00
	LDA.w $110C
	INC
	AND.w #$0003
	STA.w $110C
	BEQ.b CODE_11C88C
	ASL
	TAY
	LDA.w DATA_11C671,y
	TAY
	BRA.b CODE_11C8BB

CODE_11C875:
	LDY.b #$0E
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0100
	CMP.w #$0200
	BCC.b CODE_11C88C
	LDY.b #$0C
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_11C88C
	LDY.b #$10
CODE_11C88C:
	BRA.b CODE_11C8BB

CODE_11C88E:
	LDA.w $1112
	BEQ.b CODE_11C897
	LDY.b #$1B
	BRA.b CODE_11C8BB

CODE_11C897:
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_11C8BB
	LDA.w $7A96,x
	BNE.b CODE_11C8BF
	LDA.w #$0004
	STA.w $7A96,x
	INC.b $16,x
	LDA.b $16,x
	ASL
	TAY
	CPY.b #$0C
	BNE.b CODE_11C8B7
	LDY.b #$00
	STZ.b $16,x
CODE_11C8B7:
	LDA.w DATA_11BA7C,y
	TAY
CODE_11C8BB:
	TYA
	STA.w $7402,x
CODE_11C8BF:
	RTL

;---------------------------------------------------------------------------

DATA_11C8C0:
	dw FXDATA_538000+$0070,FXDATA_538000+$2070,FXDATA_538000+$008C,FXDATA_538000+$0054,FXDATA_538000+$00A8,FXDATA_538000+$001C,FXDATA_538000+$208C,FXDATA_538000+$208C
	dw FXDATA_538000+$20A8,FXDATA_538000+$2000,FXDATA_538000+$201C,FXDATA_538000+$2038

; Item-Card card-face graphic-data pointers, indexed by the sprite's wildcard
; slot ($18,x). NOT a prize selector -- only 3 distinct pointers populate the
; 12 slots (DATA_5FC860 x9, DATA_5FDFFC x2, DATA_5FC87E x1), so the variant
; byte picks which of three card-face graphic blobs to render, not which
; prize the card awards. (The actual prize selection is driven by
; $701978,x and the ($1170 - $03) + $0A formula in the bonus-game dispatcher.)
DATA_item_card_face_graphic_ptr:
DATA_11C8D8:
	dw DATA_5FC860,DATA_5FDFFC,DATA_5FC860,DATA_5FC860,DATA_5FC860,DATA_5FC860,DATA_5FC87E,DATA_5FC860
	dw DATA_5FDFFC,DATA_5FC860,DATA_5FC860,DATA_5FC860

;-------------------------------------------------------------------------
; Sprite $011 -- Item Card (the post-level pick-a-prize screen sprite).
; Raidenthequick alias: init_item_card / main_item_card.
; Picks one of three card-face graphic blobs from DATA_item_card_face_graphic_ptr
; (NOT a prize selector -- only 3 distinct pointers for 12 slots; the real prize
; lookup happens elsewhere via $701978,x), then copies $1C bytes of card-face
; graphic data into the SuperFX scratch RAM at $7021C2 (used by CODE_03AE60
; to render the spinning card).
;-------------------------------------------------------------------------
YI_NorSpr011_ItemCard_Init:
;$11C8F0
	JSL.l CODE_03AE60
	LDA.b $18,x
	ASL
	TAY
	LDA.w DATA_11C8D8-$02,y
	STA.b $00
	PHB
	LDY.b #DATA_5FC860>>16
	PHY
	PLB
	LDX.b #$1C
	TXY
CODE_11C905:
	LDA.b ($00),y
	STA.l YI_Global_PaletteMirror[$E1].LowByte,x
	DEY
	DEY
	DEX
	DEX
	BPL.b CODE_11C905
	PLB
	LDX.w $7972
	LDA.w #$0020
	STA.b $76,x
CODE_11C91A:
	LDA.b $76,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.b $78,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.b $18,x
	ASL
	TAY
	LDA.w DATA_11C8C0-$02,y
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #(FXDATA_538000+$0070)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_089BE1>>16
	LDA.w #FXCODE_089BE1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	BRA.b CODE_11C99D

CODE_11C954:
	LDA.b $76,x
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.b $78,x
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.b $18,x
	ASL
	TAY
	LDA.w DATA_11C8C0-$02,y
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
else
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
endif
	LDA.w #(FXDATA_538000+$0070)>>16
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_538000+$0070)>>16
endif
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_089BC5>>16
	LDA.w #FXCODE_089BC5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
CODE_11C99D:
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

YI_NorSpr011_ItemCard_Main:
;$11C9A0
	PEA.w CODE_11C9B0-$01
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	ASL
	TAY
	LDA.w DATA_11C9BD,y
	STA.b $00
	JMP.w ($0000+$7960)
CODE_11C9B0:
	JSL.l CODE_11C91A
	JSL.l CODE_02DABA
	JSL.l CODE_03AA52
	RTL

DATA_11C9BD:
	dw CODE_11C9C1
	dw CODE_11C9DD

CODE_11C9C1:
	LDA.b $76,x
	CLC
	ADC.w #$0002
	STA.b $76,x
	CMP.w #$0100
	BNE.b CODE_11C9D1
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
CODE_11C9D1:
	LDA.b $78,x
	CLC
	ADC.w #$0003
	AND.w #$00FF
	STA.b $78,x
	RTS

CODE_11C9DD:
	LDY.w $7D36,x
	BEQ.b CODE_11CA04
	BPL.b CODE_11CA04
	LDA.w #!Define_YI_SoundID36_CollectFlower
	JSL.l CODE_push_sound_queue
	JSL.l CODE_02A4F4
	JSL.l CODE_03A31E
	INC.w $10FA
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	CMP.w #$000A
	BCS.b CODE_11CA07
	JSL.l CODE_109CA6
	LDX.b $12
CODE_11CA04:
	JMP.w CODE_11C9D1

CODE_11CA07:
	SBC.w #$000A
	INC
	CLC
	ADC.w !RAM_YI_Level_CurrentLifeCountLo
	STA.w !RAM_YI_Level_CurrentLifeCountLo
	JMP.w CODE_11C9D1

;=========================================================================
; Per-mini-battle LevelData blobs ($11:CA15 - $11:FD91).
; Each `DATA_11xxxx` below is one mini-battle / minigame room's Map16
; object/sprite stream (standard YI level-data format -- header bit-pack,
; object stream, screen exits, sprite stream). The level-data pointer
; table (DATA_17F7C3 in V1.0 / DATA_0FE822 in V1.1) refers to these
; addresses for the minigame "levels" assigned to gamemodes $2E/$30.
;=========================================================================
DATA_level_05_obj:
	incbin "LevelData/DATA_level_05_obj.bin"

DATA_level_3E_obj:
	incbin "LevelData/DATA_level_3E_obj.bin"

DATA_level_6F_obj:
	incbin "LevelData/DATA_level_6F_obj.bin"

DATA_level_9A_obj:
	incbin "LevelData/DATA_level_9A_obj.bin"

DATA_level_05_spr:
	incbin "LevelData/DATA_level_05_spr.bin"

DATA_level_3E_spr:
	incbin "LevelData/DATA_level_3E_spr.bin"

DATA_level_6F_spr:
	incbin "LevelData/DATA_level_6F_spr.bin"

DATA_level_9A_spr:
	incbin "LevelData/DATA_level_9A_spr.bin"

DATA_level_15_obj:
	incbin "LevelData/DATA_level_15_obj.bin"

DATA_level_4D_obj:
	incbin "LevelData/DATA_level_4D_obj.bin"

DATA_level_7B_obj:
	incbin "LevelData/DATA_level_7B_obj.bin"

DATA_level_A3_obj:
	incbin "LevelData/DATA_level_A3_obj.bin"

DATA_11DC0F:							; shared obj stream -- Ptrs[$BF] and Ptrs[$D0] both reference this
								; label (two pointer-table entries pointing at the same 3-byte
								; cart address). Kept as DATA_11DC0F (not renamed to a per-level
								; name) because the per-level scheme requires unique label-per-id
								; and these two ids share data. Editor reads it via
								; DATA_level_BF_obj.bin (which is a copy of these bytes -- kept
								; as a convenience, not used by the build).
	incbin "LevelData/DATA_11DC0F.bin"

DATA_level_C9_obj:
	incbin "LevelData/DATA_level_C9_obj.bin"

DATA_level_D5_obj:
	incbin "LevelData/DATA_level_D5_obj.bin"

DATA_level_D7_obj:
	incbin "LevelData/DATA_level_D7_obj.bin"

DATA_level_15_spr:
	incbin "LevelData/DATA_level_15_spr.bin"

DATA_level_4D_spr:
	incbin "LevelData/DATA_level_4D_spr.bin"

DATA_level_7B_spr:
	incbin "LevelData/DATA_level_7B_spr.bin"

DATA_level_A3_spr:
	incbin "LevelData/DATA_level_A3_spr.bin"

DATA_level_BF_spr:
	incbin "LevelData/DATA_level_BF_spr.bin"

DATA_level_C9_spr:
	incbin "LevelData/DATA_level_C9_spr.bin"

DATA_level_D0_spr:
	incbin "LevelData/DATA_level_D0_spr.bin"

DATA_level_D5_spr:
	incbin "LevelData/DATA_level_D5_spr.bin"

DATA_level_D7_spr:
	incbin "LevelData/DATA_level_D7_spr.bin"

DATA_level_21_obj:
	incbin "LevelData/DATA_level_21_obj.bin"

DATA_level_58_obj:
	incbin "LevelData/DATA_level_58_obj.bin"

DATA_level_85_obj:
	incbin "LevelData/DATA_level_85_obj.bin"

DATA_level_21_spr:
	incbin "LevelData/DATA_level_21_spr.bin"

DATA_level_58_spr:
	incbin "LevelData/DATA_level_58_spr.bin"

DATA_level_85_spr:
	incbin "LevelData/DATA_level_85_spr.bin"

DATA_level_2D_obj:
	incbin "LevelData/DATA_level_2D_obj.bin"

DATA_level_64_obj:
	incbin "LevelData/DATA_level_64_obj.bin"

DATA_level_90_obj:
	incbin "LevelData/DATA_level_90_obj.bin"

DATA_level_B5_obj:
	incbin "LevelData/DATA_level_B5_obj.bin"

DATA_level_2D_spr:
	incbin "LevelData/DATA_level_2D_spr.bin"

DATA_level_64_spr:
	incbin "LevelData/DATA_level_64_spr.bin"

DATA_level_90_spr:
	incbin "LevelData/DATA_level_90_spr.bin"

DATA_level_B5_spr:
	incbin "LevelData/DATA_level_B5_spr.bin"

DATA_level_35_obj:
	incbin "LevelData/DATA_level_35_obj.bin"

DATA_level_6C_obj:
	incbin "LevelData/DATA_level_6C_obj.bin"

DATA_level_98_obj:
	incbin "LevelData/DATA_level_98_obj.bin"

DATA_level_B9_obj:
	incbin "LevelData/DATA_level_B9_obj.bin"

DATA_level_35_spr:
	incbin "LevelData/DATA_level_35_spr.bin"

DATA_level_6C_spr:
	incbin "LevelData/DATA_level_6C_spr.bin"

DATA_level_98_spr:
	incbin "LevelData/DATA_level_98_spr.bin"

DATA_level_B9_spr:
	incbin "LevelData/DATA_level_B9_spr.bin"

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($11FD92, incbin, DATA_11FD92_YI_U2.bin)
else
	%FREE_BYTES($11FD87, 633, $FF)
endif
%BANK_END(<EndBank>)
endmacro
